import type { PacketLayer, PacketVisual, PVEvent, PVEventType, ScenarioStep } from "../types";
import type { PacketStackFrame, ProcessingStage } from "@/components/network3d/types";
import type { FundHop } from "@/components/lesson/fundamentalsTrace";
import { fieldOf, icmpPacket, type IcmpEcho } from "./fundamentalsPackets";
import { withNotes, type NotebookEntry } from "./troubleshootingCommon";

/**
 * MPLS Troubleshooting: Transport, VPN Routes & Labels — CE1 — PE1 — P1 — P2 — PE2 — CE2, one L3VPN (VRF CUST-A).
 *
 * Modeled exactly (RFC 3031/3032 MPLS, RFC 5036 LDP, RFC 4364 BGP/MPLS IP VPNs):
 * - Transport: an IGP carries the PE loopbacks; LDP binds labels to them. For FEC 10.0.0.4/32 P1 advertises 16004,
 *   P2 advertises 17004 and PE2 advertises implicit-null (3), so P2 pops the transport label (PHP). The LSP toward
 *   10.0.0.1 mirrors it (P2 17001, P1 16001, PE1 implicit-null).
 * - VPN control plane: MP-BGP VPNv4 (AFI 1 / SAFI 128) between PE loopbacks. A VPNv4 route = RD + IPv4 prefix, with
 *   the VPN label and Route Target extended communities. The RD only makes prefixes unique; the RT is import/export
 *   POLICY metadata — never a label, never used for forwarding.
 * - The VPN (service) label comes from the VPNv4 route; the transport label comes from LDP. PE1 imposes both (VPN label
 *   bottom-of-stack S=1, transport label on top); P routers look only at the top label and never at customer routes;
 *   PE2 uses the VPN label to select VRF CUST-A.
 * - MPLS shim: label(20) · TC(3) · S(1) · TTL(8), shown with its computed 32-bit value; labelled frames use EtherType
 *   0x8847. The provider does not propagate the customer TTL into the labels (MPLS TTL starts at 255); the customer
 *   IPv4 TTL is decremented by PE1 and PE2 only. ICMP echoes use the shared byte-accurate builders.
 * Incident (truth, never shown before diagnosis): PE2 exports CUST-A with RT 65000:200 instead of 65000:100. The
 * VPNv4 route still reaches PE1 (same RD:prefix, label and next hop) but fails CUST-A's import policy, so 10.50.2.0/24
 * leaves PE1's VRF and CE1's traffic dies at PE1's VRF lookup — before any label is pushed.
 */

export type MpDevice = "CE1" | "PE1" | "P1" | "P2" | "PE2" | "CE2";
export const MP_DEVICES: MpDevice[] = ["CE1", "PE1", "P1", "P2", "PE2", "CE2"];
export const LOOP = { PE1: "10.0.0.1", P1: "10.0.0.2", P2: "10.0.0.3", PE2: "10.0.0.4" } as const;
export const CUST = { ce1Lan: "10.50.1.0", ce2Lan: "10.50.2.0", ce1: "10.50.1.1", ce2: "10.50.2.1", pe1Ce: "10.60.1.1", ce1Pe: "10.60.1.2", pe2Ce: "10.60.2.1", ce2Pe: "10.60.2.2" } as const;
export const VRF = "CUST-A";
export const RD = { PE1: "65000:1", PE2: "65000:2" } as const;
export const RT_INTENDED = "65000:100";
export const RT_WRONG = "65000:200";
export const VPN_LABEL = { PE1: 24001, PE2: 24002 } as const;
export const LDP_LABEL = { toPE2: { P1: 16004, P2: 17004 }, toPE1: { P2: 17001, P1: 16001 } } as const;
export const IMPLICIT_NULL = 3;
export const MPLS_TTL = 255;

export const MAC = {
  CE1: "00:00:5E:00:53:E1", PE1_CE: "00:00:5E:00:53:A1", PE1_CORE: "00:00:5E:00:53:A2", P1_A: "00:00:5E:00:53:B1", P1_B: "00:00:5E:00:53:B2",
  P2_A: "00:00:5E:00:53:C1", P2_B: "00:00:5E:00:53:C2", PE2_CORE: "00:00:5E:00:53:D1", PE2_CE: "00:00:5E:00:53:D2", CE2: "00:00:5E:00:53:E2",
} as const;

// ---------------------------------------------------------------------------------------------------------------
// Control-plane objects
// ---------------------------------------------------------------------------------------------------------------
export interface VpnRoute {
  rd: string;
  prefix: string;
  len: number;
  nextHop: string;
  label: number;
  rts: string[];
  from: "PE1" | "PE2";
}
export const vpnKey = (r: VpnRoute) => `${r.rd}:${r.prefix}/${r.len}`;
export const VRF_IMPORT = [RT_INTENDED];
export const PE1_LOCAL: VpnRoute = { rd: RD.PE1, prefix: CUST.ce1Lan, len: 24, nextHop: LOOP.PE1, label: VPN_LABEL.PE1, rts: [RT_INTENDED], from: "PE1" };
export const pe2Route = (rt: string): VpnRoute => ({ rd: RD.PE2, prefix: CUST.ce2Lan, len: 24, nextHop: LOOP.PE2, label: VPN_LABEL.PE2, rts: [rt], from: "PE2" });
export interface VrfEntry {
  prefix: string;
  len: number;
  via: string;
  vpnLabel?: number;
  transport?: number;
  source: "local" | "imported";
}
export const LDP_SESSIONS = [
  { a: "PE1", b: "P1" },
  { a: "P1", b: "P2" },
  { a: "P2", b: "PE2" },
] as const;
export const LFIB: Record<"PE1" | "P1" | "P2" | "PE2", string[]> = {
  PE1: [`FEC ${LOOP.PE2}/32 → push ${LDP_LABEL.toPE2.P1} → P1`, `VPN label ${VPN_LABEL.PE1} → VRF ${VRF}`],
  P1: [`in ${LDP_LABEL.toPE2.P1} → swap ${LDP_LABEL.toPE2.P2} → P2`, `in ${LDP_LABEL.toPE1.P1} → pop (PHP) → PE1`],
  P2: [`in ${LDP_LABEL.toPE2.P2} → pop (PHP) → PE2`, `in ${LDP_LABEL.toPE1.P2} → swap ${LDP_LABEL.toPE1.P1} → P1`],
  PE2: [`FEC ${LOOP.PE1}/32 → push ${LDP_LABEL.toPE1.P2} → P2`, `VPN label ${VPN_LABEL.PE2} → VRF ${VRF}`],
};

// ---------------------------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------------------------
export interface MpState {
  hops: FundHop[];
  packet?: PacketVisual;
  flood: { id: string; fromId: string; toId: string; packet: PacketVisual }[];
  /** Truth: RT PE2 attaches when exporting CUST-A. */
  pe2ExportRt: string;
  /** PE1's VPNv4 table (received paths) and VRF CUST-A. */
  pe1Vpnv4: VpnRoute[];
  pe1Vrf: VrfEntry[];
  pe2Vrf: VrfEntry[];
  bgp: "Established";
  pe1VrfDrops: number;
  pings: { label: string; from: string; to: string; sent: number; received: number }[];
  notebook: NotebookEntry[];
  decision?: { device: MpDevice; text: string };
  faultActive: boolean;
  repairAttempt?: { choice: string; correct: boolean };
  repaired: boolean;
}
const PE1_VRF_LOCAL: VrfEntry[] = [
  { prefix: CUST.ce1Lan, len: 24, via: `CE1 ${CUST.ce1Pe}`, source: "local" },
  { prefix: "10.60.1.0", len: 30, via: "ge-0/0/0 (to CE1)", source: "local" },
];
const PE2_VRF: VrfEntry[] = [
  { prefix: CUST.ce2Lan, len: 24, via: `CE2 ${CUST.ce2Pe}`, source: "local" },
  { prefix: "10.60.2.0", len: 30, via: "ge-0/0/1 (to CE2)", source: "local" },
  { prefix: CUST.ce1Lan, len: 24, via: `${LOOP.PE1} (BGP)`, vpnLabel: VPN_LABEL.PE1, transport: LDP_LABEL.toPE1.P2, source: "imported" },
];
export const createMpState = (): MpState => ({ hops: [], flood: [], pe2ExportRt: RT_INTENDED, pe1Vpnv4: [PE1_LOCAL], pe1Vrf: PE1_VRF_LOCAL, pe2Vrf: PE2_VRF, bgp: "Established", pe1VrfDrops: 0, pings: [], notebook: [], faultActive: false, repaired: false });
export const vrfLookup = (vrf: VrfEntry[], dst: string) => vrf.filter((e) => inNet(dst, e.prefix, e.len)).sort((a, b) => b.len - a.len)[0];
const ipNum = (ip: string) => ip.split(".").reduce((a, o) => a * 256 + Number(o), 0);
const inNet = (ip: string, net: string, len: number) => len === 0 || Math.floor(ipNum(ip) / 2 ** (32 - len)) === Math.floor(ipNum(net) / 2 ** (32 - len));
export const importable = (r: VpnRoute) => r.rts.some((rt) => VRF_IMPORT.includes(rt));

/** PE1 processes a VPNv4 update from PE2: it replaces any earlier path for the same RD:prefix, then runs import policy. */
export function pe1Receive(s: MpState, r: VpnRoute): MpState {
  const vpnv4 = [...s.pe1Vpnv4.filter((x) => vpnKey(x) !== vpnKey(r)), r];
  const vrfBase = s.pe1Vrf.filter((e) => !(e.prefix === r.prefix && e.len === r.len && e.source === "imported"));
  const vrf = importable(r) ? [...vrfBase, { prefix: r.prefix, len: r.len, via: `${r.nextHop} (BGP)`, vpnLabel: r.label, transport: LDP_LABEL.toPE2.P1, source: "imported" as const }] : vrfBase;
  return { ...s, pe1Vpnv4: vpnv4, pe1Vrf: vrf };
}

// ---------------------------------------------------------------------------------------------------------------
// Packets
// ---------------------------------------------------------------------------------------------------------------
export const shimValue = (label: number, s: 0 | 1, ttl: number, tc = 0) => ((label << 12) | (tc << 9) | (s << 8) | ttl) >>> 0;
export const hex8 = (n: number) => `0x${n.toString(16).toUpperCase().padStart(8, "0")}`;
function labelLayer(role: "transport" | "VPN", label: number, s: 0 | 1, ttl: number): PacketLayer {
  return {
    name: `MPLS ${role === "transport" ? "Transport" : "VPN"} Label`,
    color: role === "transport" ? "#f472b6" : "#a78bfa",
    fields: [
      { label: "Label", value: `${label} (${role === "transport" ? "from LDP" : "from the VPNv4 route"})` },
      { label: "TC", value: "0" },
      { label: "S (bottom of stack)", value: String(s) },
      { label: "TTL", value: String(ttl) },
      { label: "Shim (32 bits)", value: hex8(shimValue(label, s, ttl)) },
    ],
  };
}
export type Hop = "CE1-PE1" | "PE1-P1" | "P1-P2" | "P2-PE2" | "PE2-CE2";
const HOP_END: Record<Hop, [MpDevice, MpDevice]> = { "CE1-PE1": ["CE1", "PE1"], "PE1-P1": ["PE1", "P1"], "P1-P2": ["P1", "P2"], "P2-PE2": ["P2", "PE2"], "PE2-CE2": ["PE2", "CE2"] };
const HOP_MAC: Record<Hop, [string, string]> = { "CE1-PE1": [MAC.CE1, MAC.PE1_CE], "PE1-P1": [MAC.PE1_CORE, MAC.P1_A], "P1-P2": [MAC.P1_B, MAC.P2_A], "P2-PE2": [MAC.P2_B, MAC.PE2_CORE], "PE2-CE2": [MAC.PE2_CE, MAC.CE2] };
/** Customer echo CE1 → CE2 as it exists on one link (labels only inside the core, and only when PE1 has a VRF route). */
export function custEcho(id: string, hop: Hop, seq: number): PacketVisual {
  const [a, b] = HOP_END[hop];
  const [ma, mb] = HOP_MAC[hop];
  const ipTtl = hop === "CE1-PE1" ? 64 : hop === "PE2-CE2" ? 62 : 63;
  const base = icmpPacket({ id, from: a, to: b, ethSrc: ma, ethDst: mb, ip: { src: CUST.ce1, dst: CUST.ce2, ttl: ipTtl, id: 0x5000 + seq, df: false }, icmp: { kind: "echo-request", identifier: 0x0a0b, sequence: seq, dataLength: 56 } as IcmpEcho });
  const labels: PacketLayer[] =
    hop === "PE1-P1" ? [labelLayer("transport", LDP_LABEL.toPE2.P1, 0, MPLS_TTL), labelLayer("VPN", VPN_LABEL.PE2, 1, MPLS_TTL)] : hop === "P1-P2" ? [labelLayer("transport", LDP_LABEL.toPE2.P2, 0, MPLS_TTL - 1), labelLayer("VPN", VPN_LABEL.PE2, 1, MPLS_TTL)] : hop === "P2-PE2" ? [labelLayer("VPN", VPN_LABEL.PE2, 1, MPLS_TTL)] : [];
  if (!labels.length) return base;
  const eth = base.layers[0];
  const eth2: PacketLayer = { ...eth, fields: eth.fields.map((f) => (f.label === "EtherType" ? { ...f, value: "0x8847 (MPLS unicast)" } : f)) };
  return { ...base, protocol: "MPLS", badge: labels.length === 2 ? "2 labels" : "VPN label", summary: `${labels.map((l) => fieldOf({ ...base, layers: [l] }, /MPLS/, "Label").split(" ")[0]).join(" / ")} · ICMP ${CUST.ce1} → ${CUST.ce2}`, layers: [eth2, ...labels, ...base.layers.slice(1)] };
}
export function bgpUpdate(id: string, from: MpDevice, to: MpDevice, r: VpnRoute): PacketVisual {
  return {
    id,
    protocol: "BGP",
    from,
    to,
    badge: "VPNv4 UPDATE",
    summary: `MP-BGP UPDATE ${vpnKey(r)} · RT ${r.rts.join(", ")} · label ${r.label} · NH ${r.nextHop}`,
    layers: [
      { name: "Transport (not expanded)", color: "#94a3b8", fields: [{ label: "Carried in", value: `TCP/179 session ${LOOP.PE2} → ${LOOP.PE1}, itself label-switched across the core` }] },
      { name: "BGP UPDATE", color: "#fb7185", fields: [{ label: "Type", value: "2 (UPDATE)" }, { label: "ORIGIN", value: "IGP" }, { label: "AS_PATH", value: "empty (iBGP)" }, { label: "LOCAL_PREF", value: "100" }] },
      { name: "MP_REACH_NLRI", color: "#a78bfa", fields: [{ label: "AFI / SAFI", value: "1 (IPv4) / 128 (MPLS-labeled VPN)" }, { label: "Next hop", value: r.nextHop }, { label: "NLRI", value: `RD ${r.rd} · ${r.prefix}/${r.len}` }, { label: "VPN label", value: String(r.label) }] },
      { name: "Extended Communities", color: "#fbbf24", fields: r.rts.map((rt) => ({ label: "Route Target", value: rt })) },
    ],
  };
}
export const isBgp = (p: PacketVisual) => p.protocol === "BGP";
export function mpStack(p: PacketVisual): PacketStackFrame[] {
  if (isBgp(p)) return [{ id: "bgp", text: `BGP UPDATE · ${fieldOf(p, /^MP_REACH/, "NLRI")} · label ${fieldOf(p, /^MP_REACH/, "VPN label")}`, tone: "vpn" }, { id: "rt", text: `RT ${p.layers.find((l) => l.name === "Extended Communities")!.fields.map((f) => f.value).join(", ")}`, tone: "generic" }];
  const out: PacketStackFrame[] = [{ id: "eth", text: `Ethernet · ${fieldOf(p, /^Ethernet/, "EtherType")}`, tone: "generic" }];
  for (const l of p.layers.filter((x) => x.name.startsWith("MPLS"))) out.push({ id: l.name, text: `${l.name.replace("MPLS ", "")} ${l.fields[0].value.split(" ")[0]} · S=${l.fields[2].value} · TTL ${l.fields[3].value}`, tone: "vpn" });
  out.push({ id: "ip", text: `IPv4 ${fieldOf(p, /^IPv4/, "Source")} → ${fieldOf(p, /^IPv4/, "Destination")} · TTL ${fieldOf(p, /^IPv4/, "TTL")}`, tone: "ip" });
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Stages and hops
// ---------------------------------------------------------------------------------------------------------------
export const PE_STAGES: ProcessingStage[] = [
  { id: "rx", label: "Receive (customer interface in VRF, or labelled from the core)" },
  { id: "bgp", label: "MP-BGP: VPNv4 table · import policy (RT) · VRF install" },
  { id: "vrf", label: "VRF lookup (customer destination)" },
  { id: "nh", label: "Resolve BGP next hop → transport LSP (LDP label)" },
  { id: "impose", label: "Impose VPN + transport labels / dispose VPN label" },
  { id: "tx", label: "Transmit" },
];
export const P_STAGES: ProcessingStage[] = [
  { id: "rx", label: "Receive labelled frame (EtherType 0x8847)" },
  { id: "lfib", label: "LFIB lookup on the TOP label only" },
  { id: "op", label: "Swap / pop (PHP); inner labels and IP untouched" },
  { id: "tx", label: "Transmit" },
];
export const CE_STAGES: ProcessingStage[] = [
  { id: "app", label: "Customer IP routing / ping" },
  { id: "tx", label: "Transmit plain IPv4 to the PE" },
  { id: "rx", label: "Receive" },
];
export const MP_STAGES: Record<MpDevice, ProcessingStage[]> = { CE1: CE_STAGES, CE2: CE_STAGES, PE1: PE_STAGES, PE2: PE_STAGES, P1: P_STAGES, P2: P_STAGES };
const withDetail = (st: ProcessingStage[], d: Partial<Record<string, string>>) => st.map((x) => (d[x.id] ? { ...x, detail: d[x.id] } : x));
const ev = (type: PVEventType, stepId: string, message: string): PVEvent => ({ type, stepId, timestamp: Date.now(), message });
const idle = (s: MpState): MpState => ({ ...s, packet: undefined, flood: [], decision: undefined });
function hop(stepId: string, device: MpDevice, o: { active: string; details: Partial<Record<string, string>>; lookupType: string; key: string; result: string; action: string; reason: string; input: string; output: string; ingress?: string; egress?: string; next?: MpDevice; before?: PacketVisual; after?: PacketVisual }): FundHop {
  return { stepId, device, stages: withDetail(MP_STAGES[device], o.details), activeStageId: o.active, ingressInterfaceId: o.ingress, egressInterfaceId: o.egress, lookupType: o.lookupType, lookupKey: o.key, lookupResult: o.result, action: o.action, reason: o.reason, input: o.input, output: o.output, nextHopId: o.next, before: o.before ? mpStack(o.before) : undefined, after: o.after ? mpStack(o.after) : undefined };
}
const evidence = (s: MpState, stepId: string, d: MpDevice, o: { active: string; details: Partial<Record<string, string>>; action: string; reason: string; key: string; result: string }): MpState => ({ ...s, hops: [...s.hops, hop(stepId, d, { ...o, lookupType: `${d} evidence`, input: o.key, output: o.result })] });
export const vrfText = (vrf: VrfEntry[]) => vrf.map((e) => `${e.prefix}/${e.len} ${e.source === "imported" ? `via ${e.via} VPN ${e.vpnLabel} / LDP ${e.transport}` : e.via}`).join(" · ");
const vpnText = (r: VpnRoute) => `${vpnKey(r)} NH ${r.nextHop} label ${r.label} RT ${r.rts.join(",")}${importable(r) ? " · imported" : " · NOT imported (RT not in CUST-A import)"}`;

// Steps' building blocks -------------------------------------------------------------------------------------------
function updateStep(s: MpState, stepId: string): MpState {
  const r = pe2Route(s.pe2ExportRt);
  const p = bgpUpdate(`${stepId}-pkt`, "PE2", "P2", r);
  const h = hop(stepId, "PE2", { active: "bgp", egress: "ge-0/0/0", details: { bgp: `export ${VRF}: ${CUST.ce2Lan}/24 with RD ${RD.PE2}, RT ${s.pe2ExportRt}, VPN label ${VPN_LABEL.PE2}, next hop ${LOOP.PE2}` }, lookupType: "PE2 VRF export", key: `${VRF} ${CUST.ce2Lan}/24`, result: `VPNv4 UPDATE RT ${s.pe2ExportRt}`, action: "BGP EXPORT", reason: "PE2 turns its CUST-A route into a VPNv4 route: prepend the RD, allocate a VPN label, attach the export Route Target(s), advertise to its MP-BGP peer.", input: `${VRF} route`, output: "UPDATE → PE1", next: "P2", after: p });
  return { ...idle(s), hops: [...s.hops, h], packet: p };
}
function pe1RxStep(s: MpState, stepId: string): MpState {
  const r = pe2Route(s.pe2ExportRt);
  const n = pe1Receive(s, r);
  const p = bgpUpdate(`${stepId}-pkt`, "P1", "PE1", r);
  const imp = importable(r);
  const h = hop(stepId, "PE1", { active: imp ? "nh" : "bgp", ingress: "ge-0/0/1", details: { bgp: `received ${vpnKey(r)} RT ${r.rts.join(",")} label ${r.label} · ${VRF} import RT ${VRF_IMPORT.join(",")} → ${imp ? "MATCH → install in VRF" : "no match → not imported"}`, ...(imp ? { nh: `next hop ${r.nextHop} → IGP route + LDP label ${LDP_LABEL.toPE2.P1} via P1` } : {}) }, lookupType: "PE1 VPNv4 import", key: vpnKey(r), result: imp ? `${VRF}: ${r.prefix}/24 installed` : `kept in VPNv4 table, absent from ${VRF}`, action: imp ? "IMPORT" : "NOT IMPORTED", reason: imp ? "The route carries a Route Target in CUST-A's import list, so it is installed in the VRF; its next hop resolves through the LDP LSP to PE2." : "The route arrived intact — RD, label and next hop are fine — but none of its Route Targets is in CUST-A's import list. Received is not imported.", input: "VPNv4 UPDATE", output: imp ? "VRF route" : "no VRF route", before: p });
  return { ...idle(n), hops: [...s.hops, h], packet: p, decision: { device: "PE1", text: imp ? `PE1: RT ${r.rts[0]} matches → imported` : `PE1: received RT ${r.rts[0]} — not in ${VRF} import` } };
}
function ceTx(s: MpState, stepId: string, seq: number): MpState {
  const p = custEcho(`${stepId}-pkt`, "CE1-PE1", seq);
  const h = hop(stepId, "CE1", { active: "tx", egress: "ge-0/0/0", details: { app: `ping ${CUST.ce2} source ${CUST.ce1}`, tx: `default route → PE1 ${CUST.pe1Ce} · plain IPv4, TTL 64` }, lookupType: "CE1 route", key: CUST.ce2, result: `via ${CUST.pe1Ce}`, action: "TX ECHO", reason: "The customer router knows nothing about MPLS: it sends plain IPv4 to its PE.", input: "ping", output: "IPv4 → PE1", next: "PE1", after: p });
  return { ...idle(s), hops: [...s.hops, h], packet: p };
}
function pe1Forward(s: MpState, stepId: string, seq: number): MpState {
  const inP = custEcho("in", "CE1-PE1", seq);
  const route = vrfLookup(s.pe1Vrf, CUST.ce2);
  if (!route || route.source !== "imported") {
    const h = hop(stepId, "PE1", { active: "vrf", ingress: "ge-0/0/0", details: { rx: `IPv4 ${CUST.ce1} → ${CUST.ce2} on ge-0/0/0 (VRF ${VRF})`, vrf: `${VRF} lookup ${CUST.ce2}: no matching route (table: ${vrfText(s.pe1Vrf)}) → drop` }, lookupType: `PE1 VRF ${VRF}`, key: CUST.ce2, result: "no route → dropped", action: "NO VRF ROUTE", reason: "No route for 10.50.2.1 exists in CUST-A, so PE1 has no VPN label and no BGP next hop to resolve: nothing to impose. The packet is dropped here — it never enters the MPLS core.", input: "IPv4 from CE1", output: "nothing", before: inP });
    return { ...idle(s), hops: [...s.hops, h], packet: inP, pe1VrfDrops: s.pe1VrfDrops + 1, decision: { device: "PE1", text: `PE1: ${VRF} has no route for ${CUST.ce2}` } };
  }
  const out = custEcho(`${stepId}-pkt`, "PE1-P1", seq);
  const h = hop(stepId, "PE1", { active: "impose", ingress: "ge-0/0/0", egress: "ge-0/0/1", details: { vrf: `${VRF}: ${CUST.ce2} → ${route.prefix}/${route.len} via ${route.via}`, nh: `BGP next hop ${LOOP.PE2} → LDP label ${LDP_LABEL.toPE2.P1} via P1`, impose: `push VPN ${VPN_LABEL.PE2} (S=1) then transport ${LDP_LABEL.toPE2.P1} (S=0) · MPLS TTL ${MPLS_TTL} · IP TTL 64 → 63` }, lookupType: `PE1 VRF ${VRF}`, key: CUST.ce2, result: `push ${LDP_LABEL.toPE2.P1} / ${VPN_LABEL.PE2}`, action: "PUSH 2 LABELS", reason: "Two labels, two jobs: the transport label gets the packet to PE2 across the core; the VPN label tells PE2 which VRF the packet belongs to.", input: "IPv4 from CE1", output: "labelled frame → P1", next: "P1", before: inP, after: out });
  return { ...idle(s), hops: [...s.hops, h], packet: out };
}
function pStep(s: MpState, stepId: string, r: "P1" | "P2", seq: number): MpState {
  const inP = custEcho("in", r === "P1" ? "PE1-P1" : "P1-P2", seq);
  const out = custEcho(`${stepId}-pkt`, r === "P1" ? "P1-P2" : "P2-PE2", seq);
  const top = r === "P1" ? LDP_LABEL.toPE2.P1 : LDP_LABEL.toPE2.P2;
  const h = hop(stepId, r, { active: "op", ingress: "ge-0/0/0", egress: "ge-0/0/1", details: { rx: `labelled frame, top label ${top}`, lfib: `in ${top} → ${r === "P1" ? `swap ${LDP_LABEL.toPE2.P2} → P2` : "pop (PHP: PE2 advertised implicit-null) → PE2"}`, op: r === "P1" ? `outer ${top} → ${LDP_LABEL.toPE2.P2}, MPLS TTL ${MPLS_TTL} → ${MPLS_TTL - 1}; VPN label ${VPN_LABEL.PE2} and customer IP untouched` : `outer label removed; VPN label ${VPN_LABEL.PE2} is now on top; customer IP untouched` }, lookupType: `${r} LFIB`, key: `label ${top}`, result: r === "P1" ? `swap ${LDP_LABEL.toPE2.P2}` : "pop", action: r === "P1" ? "SWAP" : "POP (PHP)", reason: `${r} looks only at the top label. It has no VRF and no customer routes — it never sees 10.50.2.1 as a destination.`, input: `top label ${top}`, output: r === "P1" ? `top label ${LDP_LABEL.toPE2.P2}` : `VPN label ${VPN_LABEL.PE2} on top`, next: r === "P1" ? "P2" : "PE2", before: inP, after: out });
  return { ...idle(s), hops: [...s.hops, h], packet: out };
}
function pe2Deliver(s: MpState, stepId: string, seq: number): MpState {
  const inP = custEcho("in", "P2-PE2", seq);
  const out = custEcho(`${stepId}-pkt`, "PE2-CE2", seq);
  const h = hop(stepId, "PE2", { active: "impose", ingress: "ge-0/0/0", egress: "ge-0/0/1", details: { rx: `VPN label ${VPN_LABEL.PE2} (bottom of stack)`, impose: `label ${VPN_LABEL.PE2} → VRF ${VRF}: pop`, vrf: `${VRF}: ${CUST.ce2} → 10.50.2.0/24 via CE2 ${CUST.ce2Pe} · IP TTL 63 → 62` }, lookupType: "PE2 VPN label", key: `label ${VPN_LABEL.PE2}`, result: `${VRF} → CE2`, action: "VPN → VRF", reason: "The VPN (service) label selects the VRF; a normal IP lookup inside CUST-A then reaches CE2.", input: "VPN label", output: "IPv4 → CE2", next: "CE2", before: inP, after: out });
  const hc = hop(stepId, "CE2", { active: "rx", ingress: "ge-0/0/0", details: { rx: `echo from ${CUST.ce1} · TTL 62` }, lookupType: "CE2", key: "echo", result: "reply", action: "RX ECHO", reason: "Plain IPv4 again — the customer never sees a label.", input: "echo", output: "echo reply" });
  return { ...idle(s), hops: [...s.hops, h, hc], packet: out };
}
function pingRun(s: MpState, label: string): MpState {
  const ok = vrfLookup(s.pe1Vrf, CUST.ce2)?.source === "imported";
  return { ...s, pings: [...s.pings, { label, from: CUST.ce1, to: CUST.ce2, sent: 5, received: ok ? 5 : 0 }], pe1VrfDrops: ok ? s.pe1VrfDrops : s.pe1VrfDrops + 5 };
}

// ---------------------------------------------------------------------------------------------------------------
// Repair
// ---------------------------------------------------------------------------------------------------------------
export const MP_REPAIR_OPTIONS = [
  { id: "fix-rt", label: "Restore PE2's CUST-A export Route Target from 65000:200 to 65000:100" },
  { id: "reset-ldp", label: "Reset the LDP sessions in the core" },
  { id: "igp-metric", label: "Increase the IGP metric on the P1–P2 link" },
  { id: "global-static", label: "Add a global-table static route to 10.50.2.0/24 on PE1" },
  { id: "restart-p1", label: "Restart P1" },
  { id: "ce1-mask", label: "Change CE1's LAN subnet mask" },
  { id: "clear-arp", label: "Clear ARP on the core routers" },
] as const;
export const MP_REPAIR_CORRECT = "fix-rt";
export function applyMpRepair(s: MpState, choice: string): MpState {
  const correct = choice === MP_REPAIR_CORRECT;
  if (!correct) return { ...s, repairAttempt: { choice, correct } };
  return { ...idle(s), pe2ExportRt: RT_INTENDED, faultActive: false, repaired: true, repairAttempt: { choice, correct }, decision: { device: "PE2", text: `PE2 ${VRF} export RT → ${RT_INTENDED}` } };
}

// ---------------------------------------------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------------------------------------------
const pkt = (s: MpState) => s.packet;
const receivedLine = (s: MpState) => s.pe1Vpnv4.filter((r) => r.from === "PE2").map(vpnText).join(" · ") || "none";

export const mpSteps: ScenarioStep<MpState>[] = [
  // ---- Define / Scope ---
  {
    id: "intro",
    label: "One VPN across an MPLS core",
    narrative: `Customer site 1 (CE1, ${CUST.ce1Lan}/24) reaches site 2 (CE2, ${CUST.ce2Lan}/24) through a provider L3VPN, VRF ${VRF}. The core PE1 — P1 — P2 — PE2 runs an IGP for the loopbacks (10.0.0.1–4/32) and LDP for transport labels; PE1 and PE2 exchange VPNv4 routes over MP-BGP. Five planes, each of which can fail on its own.`,
    run: (s) => ({ state: withNotes(idle(s), "intro", [{ kind: "observation", text: `Service: ${VRF} site ${CUST.ce1Lan}/24 ↔ ${CUST.ce2Lan}/24 over PE1–P1–P2–PE2`, source: "service design" }]), events: [ev("STEP_ENTERED", "intro", "scope")] }),
  },
  {
    id: "design",
    label: "RD and RT: two different jobs",
    narrative: `PE1 uses RD ${RD.PE1}, PE2 uses RD ${RD.PE2}: the RD makes each VPNv4 prefix globally unique, even if two customers reuse 10.50.2.0/24. The Route Target ${RT_INTENDED} is policy: PEs export it on ${VRF} routes and ${VRF} imports only routes that carry it.`,
    run: (s) => ({ state: evidence(idle(s), "design", "PE1", { active: "bgp", details: { bgp: `${VRF}: RD ${RD.PE1} (PE1) / ${RD.PE2} (PE2) · import ${VRF_IMPORT.join(",")} · export ${RT_INTENDED}` }, action: "VRF DESIGN", reason: "RD = uniqueness of the prefix; RT = which VRFs may import it. Neither is a label.", key: `${VRF} design`, result: `RT ${RT_INTENDED}` }), events: [ev("STEP_ENTERED", "design", "design")] }),
  },
  {
    id: "q-rd-rt",
    label: "Question: RD vs RT",
    narrative: `RD ${RD.PE2}, RT ${RT_INTENDED}.`,
    question: {
      prompt: "What does each one do?",
      options: [
        { id: "roles", label: "The RD makes the VPNv4 prefix unique; the RT is policy metadata that decides which VRFs import the route" },
        { id: "same", label: "They are two names for the same value" },
        { id: "label", label: "The RT is the MPLS label pushed on the packet" },
        { id: "rd-import", label: "The RD decides which VRF imports the route" },
      ],
      correctOptionId: "roles",
      explanation: "RD + prefix = the VPNv4 NLRI. RTs are BGP extended communities compared against each VRF's import policy. Neither ever appears in a data-plane packet.",
    },
  },
  // ---- Baseline ---
  {
    id: "base-update",
    label: "Baseline: PE2 advertises 10.50.2.0/24",
    narrative: `PE2 exports ${VRF}'s 10.50.2.0/24 as VPNv4 route ${RD.PE2}:10.50.2.0/24 with RT ${RT_INTENDED}, VPN label ${VPN_LABEL.PE2} and next hop ${LOOP.PE2}, over its MP-BGP session to PE1.`,
    run: (s) => ({ state: updateStep(s, "base-update"), events: [ev("PACKET_SENT", "base-update", "UPDATE")] }),
    packet: pkt,
  },
  {
    id: "base-import",
    label: "Baseline: PE1 imports it",
    narrative: `PE1 receives the route: RT ${RT_INTENDED} is in ${VRF}'s import list, so 10.50.2.0/24 is installed in the VRF. Its next hop ${LOOP.PE2} resolves through the LDP LSP: push ${LDP_LABEL.toPE2.P1} toward P1.`,
    run: (s) => ({ state: withNotes(pe1RxStep(s, "base-import"), "base-import", [{ kind: "observation", text: `Baseline PE1 ${VRF}: ${vrfText(pe1Receive(s, pe2Route(s.pe2ExportRt)).pe1Vrf)}`, source: "PE1 VRF" }]), events: [ev("PACKET_SENT", "base-import", "import")] }),
    packet: pkt,
  },
  {
    id: "base-ce1",
    label: "Baseline: CE1 sends plain IPv4",
    narrative: `CE1 pings ${CUST.ce2} from ${CUST.ce1}. Plain IPv4, TTL 64, to PE1.`,
    run: (s) => ({ state: ceTx(s, "base-ce1", 1), events: [ev("PACKET_SENT", "base-ce1", "echo")] }),
    packet: pkt,
  },
  {
    id: "base-pe1",
    label: "Baseline: PE1 pushes two labels",
    narrative: `PE1: VRF lookup → 10.50.2.0/24 via ${LOOP.PE2}. It pushes the VPN label ${VPN_LABEL.PE2} (bottom, S=1), then the transport label ${LDP_LABEL.toPE2.P1} (top). Customer IP TTL 64 → 63; MPLS TTL starts at ${MPLS_TTL}.`,
    run: (s) => ({ state: pe1Forward(s, "base-pe1", 1), events: [ev("PACKET_SENT", "base-pe1", "push")] }),
    packet: pkt,
  },
  {
    id: "q-labels",
    label: "Question: why two labels?",
    narrative: `Top ${LDP_LABEL.toPE2.P1}, bottom ${VPN_LABEL.PE2}.`,
    question: {
      prompt: "What does each label solve?",
      options: [
        { id: "two", label: "The outer (transport) label carries the packet across the core to PE2; the inner (VPN) label tells PE2 which VRF — which customer — it belongs to" },
        { id: "backup", label: "The second label is a backup in case the first is lost" },
        { id: "rd", label: "The inner label is the RD" },
        { id: "qos", label: "One label is for QoS, the other for TTL" },
      ],
      correctOptionId: "two",
      explanation: "Transport comes from LDP (per PE loopback); the VPN label comes from PE2's VPNv4 route (per VRF or prefix).",
    },
  },
  {
    id: "base-p1",
    label: "Baseline: P1 swaps the outer label",
    narrative: `P1 looks at the top label ${LDP_LABEL.toPE2.P1} only: swap → ${LDP_LABEL.toPE2.P2}, MPLS TTL 255 → 254. The VPN label and the customer packet underneath are untouched.`,
    run: (s) => ({ state: pStep(s, "base-p1", "P1", 1), events: [ev("PACKET_SENT", "base-p1", "swap")] }),
    packet: pkt,
  },
  {
    id: "q-p-routes",
    label: "Question: P routers and customer routes",
    narrative: "P1 forwarded a customer packet.",
    question: {
      prompt: "Do P routers need the customer's routes?",
      options: [
        { id: "no", label: "No — they switch on the top (transport) label only and know only the provider's loopbacks" },
        { id: "yes", label: "Yes — every router on the path needs 10.50.2.0/24" },
        { id: "vrf", label: "They need a copy of VRF CUST-A" },
        { id: "bgp", label: "They need the VPNv4 routes via BGP" },
      ],
      correctOptionId: "no",
      explanation: "That is the point of the design: customer state lives only on PEs. P routers never inspect the VPN label or the customer IP header to make a forwarding decision.",
    },
  },
  {
    id: "base-p2",
    label: "Baseline: P2 pops (PHP)",
    narrative: `PE2 advertised implicit-null for its loopback, so P2 pops the transport label (penultimate-hop popping). PE2 receives the frame with only the VPN label ${VPN_LABEL.PE2}.`,
    run: (s) => ({ state: pStep(s, "base-p2", "P2", 1), events: [ev("PACKET_SENT", "base-p2", "pop")] }),
    packet: pkt,
  },
  {
    id: "base-pe2",
    label: "Baseline: PE2 delivers to CE2",
    narrative: `PE2: label ${VPN_LABEL.PE2} → VRF ${VRF}; IP lookup → CE2. Customer IP TTL 63 → 62. Ping 5/5.`,
    run: (s) => ({ state: withNotes(pingRun(pe2Deliver(s, "base-pe2", 1), "baseline"), "base-pe2", [{ kind: "observation", text: "Baseline: CE1 → CE2 5/5; stack PE1→P1 16004/24002, P1→P2 17004/24002, P2→PE2 24002", source: "ping + packet walk" }]), events: [ev("PACKET_SENT", "base-pe2", "deliver")] }),
    packet: pkt,
  },
  // ---- Incident ---
  {
    id: "incident-intro",
    label: "Incident: site 2 unreachable",
    narrative: "After a configuration change on PE2 ('tidy up CUST-A policy'), site 1 can no longer reach site 2. The provider's monitoring shows the core healthy. Scope by plane: underlay, transport, VPN control plane, VRF, data plane.",
    run: (s) => ({ state: withNotes({ ...idle(s), pe2ExportRt: RT_WRONG, faultActive: true }, "incident-intro", [{ kind: "symptom", text: "CE1 cannot reach 10.50.2.0/24 after a PE2 change; core monitoring green", source: "customer ticket" }]), events: [ev("STEP_ENTERED", "incident-intro", "incident")] }),
  },
  {
    id: "inc-update",
    label: "PE2 sends a new UPDATE",
    narrative: `The change makes PE2 re-advertise ${RD.PE2}:10.50.2.0/24. Inspect the UPDATE: RD, next hop, VPN label, Route Target.`,
    run: (s) => ({ state: updateStep(s, "inc-update"), events: [ev("PACKET_SENT", "inc-update", "UPDATE")] }),
    packet: pkt,
  },
  {
    id: "inc-pe1-rx",
    label: "PE1 receives it",
    narrative: "The update replaces the earlier path for the same RD:prefix in PE1's VPNv4 table. Inspect PE1's import decision.",
    run: (s) => {
      const n = pe1RxStep(s, "inc-pe1-rx");
      return { state: withNotes(n, "inc-pe1-rx", [{ kind: "observation", text: `PE1 VPNv4 table: ${receivedLine(n)}`, source: "PE1 show route table bgp.l3vpn", rung: "Policy / service-specific" }]), events: [ev("PACKET_SENT", "inc-pe1-rx", "received")] };
    },
    packet: pkt,
  },
  {
    id: "inc-ce1",
    label: "CE1's packet reaches PE1",
    narrative: `CE1 pings ${CUST.ce2} again. PE1 receives the plain IPv4 packet on its ${VRF} interface. Inspect PE1's VRF lookup.`,
    run: (s) => {
      let n = ceTx(s, "inc-ce1", 11);
      n = pe1Forward(n, "inc-ce1", 11);
      return { state: withNotes(pingRun(n, "incident"), "inc-ce1", [{ kind: "observation", text: `PE1 ${VRF} lookup ${CUST.ce2}: no route; packet dropped at PE1 (no labels imposed); ping 0/5`, source: "PE1 forwarding", rung: "Policy / service-specific" }]), events: [ev("PACKET_SENT", "inc-ce1", "echo")] };
    },
    packet: pkt,
  },
  {
    id: "inc-transport",
    label: "Transport plane: PE1 → PE2",
    narrative: `PE1's IGP route to ${LOOP.PE2}/32 is present; LDP sessions PE1–P1, P1–P2, P2–PE2 are Operational; PE1 holds label ${LDP_LABEL.toPE2.P1} for FEC ${LOOP.PE2}/32; LSP ping to ${LOOP.PE2}: 5/5. The transport LSP works end to end.`,
    run: (s) => ({ state: withNotes(evidence(idle(s), "inc-transport", "PE1", { active: "nh", details: { nh: `IGP ${LOOP.PE2}/32 via P1 · LDP ${LDP_SESSIONS.map((l) => `${l.a}–${l.b}`).join(", ")} Operational · FEC ${LOOP.PE2}/32 → push ${LDP_LABEL.toPE2.P1} · LSP ping 5/5` }, action: "TRANSPORT OK", reason: "Underlay and transport are healthy: PE1 can label-switch to PE2's loopback.", key: `ping mpls ldp ${LOOP.PE2}/32`, result: "5/5" }), "inc-transport", [{ kind: "observation", text: `Transport: IGP to ${LOOP.PE2}, LDP Operational, LFIB label ${LDP_LABEL.toPE2.P1}, LSP ping 5/5`, source: "PE1", rung: "Routing / forwarding" }, { kind: "ruled-out", text: "Underlay / LDP transport failure" }]), events: [ev("STEP_ENTERED", "inc-transport", "transport")] }),
  },
  {
    id: "q-loopback",
    label: "Question: loopback reachability",
    narrative: "PE1 reaches PE2's loopback over the LSP.",
    question: {
      prompt: "Does successful PE1 → PE2 loopback reachability prove the VPN works?",
      options: [
        { id: "no", label: "No — it proves the transport plane; the VPN also needs the route in the VRF, and a VPN label for it" },
        { id: "yes", label: "Yes — if the PEs reach each other, the VPN works" },
        { id: "ldp", label: "Only if LDP is also Operational" },
        { id: "ttl", label: "Only if TTL propagation is on" },
      ],
      correctOptionId: "no",
      explanation: "Transport is necessary, not sufficient. The customer packet also needs a VRF route to give it a next hop and a VPN label.",
    },
  },
  {
    id: "inc-bgp",
    label: "VPN control plane: MP-BGP",
    narrative: `PE1 ↔ PE2 MP-BGP session (VPNv4): Established. Routes received from ${LOOP.PE2}: 1. The route is in PE1's VPNv4 table — RD ${RD.PE2}, label ${VPN_LABEL.PE2}, next hop ${LOOP.PE2}.`,
    run: (s) => ({ state: withNotes(evidence(idle(s), "inc-bgp", "PE1", { active: "bgp", details: { bgp: `session ${LOOP.PE1}–${LOOP.PE2} ${s.bgp} · received: ${receivedLine(s)}` }, action: "BGP OK", reason: "The session is up and the route arrives — the control plane is delivering routes.", key: "show bgp summary / show route receive-protocol bgp", result: `${s.bgp} · 1 received` }), "inc-bgp", [{ kind: "observation", text: `MP-BGP ${s.bgp}; received ${receivedLine(s)}`, source: "PE1 BGP", rung: "Policy / service-specific" }, { kind: "ruled-out", text: "BGP session down / route not advertised" }]), events: [ev("STEP_ENTERED", "inc-bgp", "bgp")] }),
  },
  {
    id: "q-established",
    label: "Question: Established",
    narrative: "MP-BGP is Established and the route was received.",
    question: {
      prompt: "Does MP-BGP Established prove the route is imported into the VRF?",
      options: [
        { id: "no", label: "No — Established means routes can be exchanged; import into a VRF is a separate policy decision on the receiving PE" },
        { id: "yes", label: "Yes — received routes are always installed" },
        { id: "rd", label: "Yes, as long as the RD is unique" },
        { id: "label", label: "Only if the VPN label is below 100000" },
      ],
      correctOptionId: "no",
      explanation: "The VPNv4 table holds what was received; each VRF holds only what its import policy accepted.",
    },
  },
  {
    id: "inc-vrf",
    label: "VRF: what CUST-A contains",
    narrative: `PE1 ${VRF} (import RT ${VRF_IMPORT.join(",")}): 10.50.1.0/24 and the PE–CE /30 — no 10.50.2.0/24. PE2's ${VRF} still holds 10.50.1.0/24 from PE1 (RT ${RT_INTENDED}): the reverse direction is fine.`,
    run: (s) => ({ state: withNotes(evidence(idle(s), "inc-vrf", "PE1", { active: "vrf", details: { vrf: `PE1 ${VRF}: ${vrfText(s.pe1Vrf)} | PE2 ${VRF}: ${vrfText(s.pe2Vrf)}` }, action: "VRF TABLES", reason: "Received ≠ imported. The route sits in the VPNv4 table but not in the customer's VRF.", key: `show route table ${VRF}`, result: "10.50.2.0/24 absent on PE1" }), "inc-vrf", [{ kind: "observation", text: `PE1 ${VRF}: ${vrfText(s.pe1Vrf)} — 10.50.2.0/24 absent`, source: `PE1 ${VRF}`, rung: "Policy / service-specific" }, { kind: "observation", text: `PE2 ${VRF} has 10.50.1.0/24 from PE1 (RT ${RT_INTENDED})`, source: `PE2 ${VRF}` }, { kind: "hypothesis", text: `PE2's route carries an RT that ${VRF} on PE1 does not import` }]), events: [ev("STEP_ENTERED", "inc-vrf", "vrf")] }),
  },
  {
    id: "q-rd",
    label: "Question: what is the RD for?",
    narrative: `PE2's route uses RD ${RD.PE2}.`,
    question: {
      prompt: "What is the RD used for?",
      options: [
        { id: "unique", label: "To make the VPNv4 prefix unique, so overlapping customer prefixes stay distinct in BGP" },
        { id: "import", label: "To decide which VRF imports the route" },
        { id: "label", label: "It is the VPN label" },
        { id: "forward", label: "P routers forward on it" },
      ],
      correctOptionId: "unique",
      explanation: "Here the RD is correct and unique. It plays no part in the import decision.",
    },
  },
  {
    id: "q-rt",
    label: "Question: what is the RT for?",
    narrative: `The received route carries RT ${RT_WRONG}; ${VRF} imports ${RT_INTENDED}.`,
    question: {
      prompt: "What is the RT used for?",
      options: [
        { id: "policy", label: "Import/export policy: a VRF imports routes carrying any of its import RTs" },
        { id: "unique", label: "Making prefixes unique" },
        { id: "label", label: "Choosing the transport label" },
        { id: "nh", label: "Resolving the BGP next hop" },
      ],
      correctOptionId: "policy",
      explanation: `RT ${RT_WRONG} matches no import RT of ${VRF} on PE1, so the route is not imported.`,
    },
  },
  {
    id: "q-received-absent",
    label: "Question: received but absent",
    narrative: "The route is in PE1's VPNv4 table but not in its VRF.",
    question: {
      prompt: "Why can a received VPNv4 route be absent from the VRF?",
      options: [
        { id: "rt", label: "None of its Route Targets matches the VRF's import policy (or an import policy rejects it)" },
        { id: "rd", label: "Its RD differs from the local RD" },
        { id: "label", label: "Its VPN label is too high" },
        { id: "ldp", label: "LDP is down" },
      ],
      correctOptionId: "rt",
      explanation: "RDs usually differ between PEs — that is normal and irrelevant to import. An unresolvable next hop can also hide a route, but here the next hop resolves (LSP ping 5/5).",
    },
  },
  {
    id: "inc-pe2-config",
    label: "Compare PE2's export with the design",
    narrative: `PE2 ${VRF}: export RT ${RT_WRONG}. Service design for ${VRF}: RT ${RT_INTENDED} on both PEs. PE1 ${VRF}: import and export ${RT_INTENDED}. The change on PE2 replaced the export community.`,
    run: (s) => ({ state: withNotes(evidence(idle(s), "inc-pe2-config", "PE2", { active: "bgp", details: { bgp: `PE2 ${VRF} export ${s.pe2ExportRt} · design ${RT_INTENDED} · PE1 import ${VRF_IMPORT.join(",")}` }, action: "CONFIG vs DESIGN", reason: "Compare each side's policy with the intended service design.", key: `PE2 ${VRF} policy`, result: `export ${s.pe2ExportRt} (design ${RT_INTENDED})` }), "inc-pe2-config", [{ kind: "observation", text: `PE2 ${VRF} exports RT ${s.pe2ExportRt}; design says ${RT_INTENDED}`, source: "PE2 config vs service design" }]), events: [ev("STEP_ENTERED", "inc-pe2-config", "config")] }),
  },
  {
    id: "q-ldp-reset",
    label: "Question: reset LDP?",
    narrative: "Someone proposes clearing all LDP sessions 'to refresh the labels'.",
    question: {
      prompt: "Why would resetting LDP not fix this?",
      options: [
        { id: "plane", label: "LDP only builds transport labels, which already work; the failure is VPN route import on PE1, which LDP never touches" },
        { id: "slow", label: "LDP resets take too long" },
        { id: "works", label: "It would fix it" },
        { id: "bgp", label: "Because LDP runs over BGP" },
      ],
      correctOptionId: "plane",
      explanation: "Fix the plane that failed. Resetting a healthy plane only adds an outage — and after it, the route would still carry the wrong RT.",
    },
  },
  {
    id: "diagnostic-layers",
    label: "Troubleshoot by plane",
    narrative: "Underlay, transport, VPN control plane, VRF, data plane — which is the first plane that fails?",
  },
  {
    id: "predict-cause",
    label: "Predict: root cause",
    narrative: "Put it together.",
    question: {
      prompt: "What is the root cause?",
      options: [
        { id: "rt", label: `PE2 exports ${VRF} with RT ${RT_WRONG}; PE1's ${VRF} imports only ${RT_INTENDED}, so the received route is not imported` },
        { id: "ldp", label: "LDP has no label for PE2's loopback" },
        { id: "rd", label: "PE2 uses a different RD from PE1" },
        { id: "bgp", label: "The MP-BGP session is down" },
      ],
      correctOptionId: "rt",
      explanation: "Transport works, BGP is Established and delivers the route, the RDs are correctly unique — only the RT fails CUST-A's import policy.",
    },
    run: (s) => ({ state: withNotes(idle(s), "predict-cause", [{ kind: "root-cause", text: `PE2 ${VRF} export RT ${RT_WRONG} (design ${RT_INTENDED}) → route received but not imported on PE1`, source: "VPNv4 table + VRF + config" }]), events: [] }),
  },
  // ---- Repair ---
  {
    id: "repair-challenge",
    label: "Repair the VPN policy",
    narrative: "Choose the change that fixes the cause you identified.",
    action: (s, payload) => ({ state: applyMpRepair(s, (payload as { choice: string }).choice), events: [ev("STEP_ENTERED", "repair-challenge", `Repair attempt: ${(payload as { choice: string }).choice}`)] }),
    requiresState: (s) => s.repaired,
  },
  // ---- Verify ---
  {
    id: "ver-update",
    label: "Verify: corrected UPDATE",
    narrative: `PE2 re-advertises ${RD.PE2}:10.50.2.0/24 with RT ${RT_INTENDED}. Same RD, same label ${VPN_LABEL.PE2}, same next hop — only the RT changed.`,
    run: (s) => ({ state: updateStep(s, "ver-update"), events: [ev("PACKET_SENT", "ver-update", "UPDATE")] }),
    packet: pkt,
  },
  {
    id: "ver-import",
    label: "Verify: PE1 imports",
    narrative: `RT ${RT_INTENDED} matches ${VRF}'s import: 10.50.2.0/24 is installed in the VRF with VPN label ${VPN_LABEL.PE2}; next hop ${LOOP.PE2} resolves to LDP label ${LDP_LABEL.toPE2.P1}.`,
    run: (s) => ({ state: withNotes(pe1RxStep(s, "ver-import"), "ver-import", [{ kind: "observation", text: `PE1 ${VRF} after repair: ${vrfText(pe1Receive(s, pe2Route(s.pe2ExportRt)).pe1Vrf)}`, source: `PE1 ${VRF}` }]), events: [ev("PACKET_SENT", "ver-import", "import")] }),
    packet: pkt,
  },
  {
    id: "ver-ce1",
    label: "Verify: CE1 sends again",
    narrative: `CE1 pings ${CUST.ce2}.`,
    run: (s) => ({ state: ceTx(s, "ver-ce1", 21), events: [ev("PACKET_SENT", "ver-ce1", "echo")] }),
    packet: pkt,
  },
  {
    id: "ver-pe1",
    label: "Verify: two labels pushed",
    narrative: `PE1 now finds 10.50.2.0/24 in ${VRF}: push VPN ${VPN_LABEL.PE2} + transport ${LDP_LABEL.toPE2.P1}. This stack did not exist during the incident.`,
    run: (s) => ({ state: pe1Forward(s, "ver-pe1", 21), events: [ev("PACKET_SENT", "ver-pe1", "push")] }),
    packet: pkt,
  },
  {
    id: "ver-p1",
    label: "Verify: P1 swaps",
    narrative: `P1: ${LDP_LABEL.toPE2.P1} → ${LDP_LABEL.toPE2.P2}; inner label ${VPN_LABEL.PE2} untouched.`,
    run: (s) => ({ state: pStep(s, "ver-p1", "P1", 21), events: [ev("PACKET_SENT", "ver-p1", "swap")] }),
    packet: pkt,
  },
  {
    id: "ver-p2",
    label: "Verify: P2 pops",
    narrative: `P2 pops the transport label (PHP); PE2 receives VPN label ${VPN_LABEL.PE2}.`,
    run: (s) => ({ state: pStep(s, "ver-p2", "P2", 21), events: [ev("PACKET_SENT", "ver-p2", "pop")] }),
    packet: pkt,
  },
  {
    id: "ver-pe2",
    label: "Verify: CE2 receives it",
    narrative: `PE2: label ${VPN_LABEL.PE2} → ${VRF} → CE2. CE2 receives plain IPv4, TTL 62, and replies. Ping 5/5.`,
    run: (s) => ({ state: withNotes(pingRun(pe2Deliver(s, "ver-pe2", 21), "after repair"), "ver-pe2", [{ kind: "verified", text: `RT ${RT_INTENDED} restored → route imported → stack ${LDP_LABEL.toPE2.P1}/${VPN_LABEL.PE2} → CE2; CE1 → CE2 5/5; LDP/IGP untouched`, source: "VRF + packet walk + ping" }]), events: [ev("PACKET_SENT", "ver-pe2", "deliver")] }),
    packet: pkt,
    question: {
      prompt: "What proves restoration?",
      options: [
        { id: "chain", label: "The route is imported into PE1's CUST-A, customer packets leave PE1 with the two-label stack, reach CE2, and the ping succeeds" },
        { id: "bgp", label: "The BGP session is Established" },
        { id: "config", label: "PE2's configuration shows RT 65000:100" },
        { id: "lsp", label: "LSP ping to 10.0.0.4 succeeds" },
      ],
      correctOptionId: "chain",
      explanation: "BGP was Established and the LSP worked throughout. The proof is the route in the VRF and customer traffic end to end.",
    },
  },
  // ---- Complete ---
  {
    id: "operations",
    label: "On real routers",
    narrative: "By plane. Transport — Juniper-style: show ldp session, show route table inet.3, ping mpls ldp 10.0.0.4/32; Cisco-style: show mpls ldp neighbor, show mpls forwarding-table, ping mpls ipv4 10.0.0.4/32. VPN control plane — Juniper-style: show route table bgp.l3vpn.0 extensive (RD, label, communities), show route table CUST-A.inet.0; Cisco-style: show bgp vpnv4 unicast all 10.50.2.0 (RT, label), show ip route vrf CUST-A. Compare the received route's RT with the VRF's import policy.",
  },
  {
    id: "complete",
    label: "Lesson complete",
    narrative: "Five planes: underlay and transport healthy, MP-BGP Established and delivering the route — and a Route Target that stopped it at the VRF door. Found plane by plane, repaired at the export policy, proven by the two-label stack that finally left PE1.",
  },
];
