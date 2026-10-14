import type { PacketVisual, PVEvent, PVEventType, ScenarioStep } from "../types";
import type { ProcessingStage } from "@/components/network3d/types";
import type { FundHop } from "@/components/lesson/fundamentalsTrace";
import { fieldOf, icmpPacket, packetStack, type IcmpEcho } from "./fundamentalsPackets";
import { inPrefix } from "./enterpriseEdgePackets";
import { withNotes, type NotebookEntry } from "./troubleshootingCommon";

/**
 * Routing Troubleshooting: Route Selection & Blackholes — CLIENT — R1 — R2 — R3 — SERVER-LAN (SERVER-A, SERVER-B).
 *
 * Modeled exactly:
 * - OSPF area 0 between R1, R2 and R3 (point-to-point /31 links, interface cost 10). Adjacencies Full, three router
 *   LSAs, identical LSDBs. R1's OSPF route to 172.16.20.0/24 is via 192.0.2.1 with cost 30 (10 + 10 + R3's LAN 10).
 * - Route selection: the FIB entry for a destination is the LONGEST matching prefix. Route preference (Juniper-style
 *   preference / Cisco-style administrative distance) only chooses between candidates for the SAME prefix — it can never
 *   make a /24 beat a /32.
 * - A discard route drops silently (no ICMP); a reject route would answer ICMP unreachable.
 * - Only routers decrement TTL; ICMP echoes use the shared byte-accurate builders (RFC 791/792 checksums computed).
 * Incident (truth, never shown before diagnosis): a stale static 172.16.20.20/32 → discard on R1, left from a
 * maintenance change. OSPF stays healthy and its /24 stays installed; only SERVER-A (the /32) is blackholed at R1.
 */

export type RtDevice = "CLIENT" | "R1" | "R2" | "R3" | "SERVER-A" | "SERVER-B";
export const RT_DEVICES: RtDevice[] = ["CLIENT", "R1", "R2", "R3", "SERVER-A", "SERVER-B"];
export const IP = { client: "10.10.10.10", r1Lan: "10.10.10.1", r1T: "192.0.2.0", r2a: "192.0.2.1", r2b: "192.0.2.2", r3T: "192.0.2.3", r3Lan: "172.16.20.1", srvA: "172.16.20.20", srvB: "172.16.20.30" } as const;
export const MAC = { CLIENT: "00:00:5E:00:53:C1", R1_LAN: "00:00:5E:00:53:11", R1_T: "00:00:5E:00:53:12", R2_A: "00:00:5E:00:53:21", R2_B: "00:00:5E:00:53:22", R3_T: "00:00:5E:00:53:31", R3_LAN: "00:00:5E:00:53:32", SRV_A: "00:00:5E:00:53:A0", SRV_B: "00:00:5E:00:53:B0" } as const;
export const SERVER_LAN = "172.16.20.0";
export const OSPF_COST = 10;
export const RID = { R1: "1.1.1.1", R2: "2.2.2.2", R3: "3.3.3.3" } as const;
export type Router = "R1" | "R2" | "R3";

export type RouteSource = "connected" | "ospf" | "static";
export interface RibRoute {
  prefix: string;
  len: number;
  source: RouteSource;
  /** Preference (Juniper-style; lower wins). Only compared between routes for the same prefix. */
  pref: number;
  nextHop?: string;
  iface?: string;
  metric?: number;
  action: "forward" | "discard";
  note?: string;
}
export const PREF: Record<RouteSource, number> = { connected: 0, static: 5, ospf: 10 };
export const PREF_TEXT: Record<RouteSource, string> = { connected: "connected", static: "static (pref 5 · Cisco-style AD 1)", ospf: "OSPF (pref 10 · Cisco-style AD 110)" };
export const DISCARD_32: RibRoute = { prefix: IP.srvA, len: 32, source: "static", pref: PREF.static, action: "discard", note: "static discard" };

const R1_BASE: RibRoute[] = [
  { prefix: "10.10.10.0", len: 24, source: "connected", pref: 0, iface: "ge-0/0/0", action: "forward" },
  { prefix: "192.0.2.0", len: 31, source: "connected", pref: 0, iface: "ge-0/0/1", action: "forward" },
  { prefix: "192.0.2.2", len: 31, source: "ospf", pref: PREF.ospf, nextHop: IP.r2a, iface: "ge-0/0/1", metric: 20, action: "forward" },
  { prefix: SERVER_LAN, len: 24, source: "ospf", pref: PREF.ospf, nextHop: IP.r2a, iface: "ge-0/0/1", metric: 30, action: "forward" },
];
export const R2_RIB: RibRoute[] = [
  { prefix: "192.0.2.0", len: 31, source: "connected", pref: 0, iface: "ge-0/0/0", action: "forward" },
  { prefix: "192.0.2.2", len: 31, source: "connected", pref: 0, iface: "ge-0/0/1", action: "forward" },
  { prefix: "10.10.10.0", len: 24, source: "ospf", pref: PREF.ospf, nextHop: IP.r1T, iface: "ge-0/0/0", metric: 20, action: "forward" },
  { prefix: SERVER_LAN, len: 24, source: "ospf", pref: PREF.ospf, nextHop: IP.r3T, iface: "ge-0/0/1", metric: 20, action: "forward" },
];
export const R3_RIB: RibRoute[] = [
  { prefix: "192.0.2.2", len: 31, source: "connected", pref: 0, iface: "ge-0/0/0", action: "forward" },
  { prefix: SERVER_LAN, len: 24, source: "connected", pref: 0, iface: "ge-0/0/1", action: "forward" },
  { prefix: "10.10.10.0", len: 24, source: "ospf", pref: PREF.ospf, nextHop: IP.r2b, iface: "ge-0/0/0", metric: 30, action: "forward" },
];
export const routeKey = (r: RibRoute) => `${r.prefix}/${r.len}`;
export const routeText = (r: RibRoute) => `${routeKey(r)} ${r.source}${r.action === "discard" ? " → discard" : r.nextHop ? ` via ${r.nextHop} ${r.iface}` : ` ${r.iface}`}${r.metric !== undefined ? ` metric ${r.metric}` : ""}`;
/** FIB lookup: longest prefix first; preference only among equal-length candidates. */
export function fibLookup(rib: RibRoute[], dst: string): { matches: RibRoute[]; chosen?: RibRoute } {
  const matches = rib.filter((r) => inPrefix(dst, r.prefix, r.len)).sort((a, b) => b.len - a.len || a.pref - b.pref);
  return { matches, chosen: matches[0] };
}

// ---------------------------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------------------------
export interface OspfView {
  neighbors: { router: Router; peer: Router; state: "Full"; iface: string }[];
  lsas: { lsid: string; adv: Router; seq: string }[];
}
export const OSPF: OspfView = {
  neighbors: [
    { router: "R1", peer: "R2", state: "Full", iface: "ge-0/0/1" },
    { router: "R2", peer: "R1", state: "Full", iface: "ge-0/0/0" },
    { router: "R2", peer: "R3", state: "Full", iface: "ge-0/0/1" },
    { router: "R3", peer: "R2", state: "Full", iface: "ge-0/0/0" },
  ],
  lsas: [
    { lsid: RID.R1, adv: "R1", seq: "0x80000004" },
    { lsid: RID.R2, adv: "R2", seq: "0x80000006" },
    { lsid: RID.R3, adv: "R3", seq: "0x80000005" },
  ],
};
export interface RtState {
  hops: FundHop[];
  packet?: PacketVisual;
  flood: { id: string; fromId: string; toId: string; packet: PacketVisual }[];
  /** Truth: R1's RIB (the /32 discard is present only during the incident). */
  r1Rib: RibRoute[];
  ospf: OspfView;
  /** Per-destination counters: packets R1 discarded, packets R2 received. */
  r1Discards: Record<string, number>;
  r2Rx: Record<string, number>;
  pings: { label: string; dst: string; sent: number; received: number }[];
  traces: { label: string; dst: string; hops: string[] }[];
  notebook: NotebookEntry[];
  decision?: { device: RtDevice; text: string };
  faultActive: boolean;
  repairAttempt?: { choice: string; correct: boolean };
  repaired: boolean;
}
export const createRtState = (): RtState => ({ hops: [], flood: [], r1Rib: R1_BASE, ospf: OSPF, r1Discards: {}, r2Rx: {}, pings: [], traces: [], notebook: [], faultActive: false, repaired: false });
export const hasDiscard = (s: RtState) => s.r1Rib.some((r) => r.action === "discard");

// ---------------------------------------------------------------------------------------------------------------
// Packets and hops
// ---------------------------------------------------------------------------------------------------------------
export const ECHO_ID = 0x1616;
const echo = (kind: IcmpEcho["kind"], seq: number): IcmpEcho => ({ kind, identifier: ECHO_ID, sequence: seq, dataLength: 56 });
type Link = "C-R1" | "R1-R2" | "R2-R3" | "R3-SA" | "R3-SB";
const LINK_MAC: Record<Link, [string, string]> = { "C-R1": [MAC.CLIENT, MAC.R1_LAN], "R1-R2": [MAC.R1_T, MAC.R2_A], "R2-R3": [MAC.R2_B, MAC.R3_T], "R3-SA": [MAC.R3_LAN, MAC.SRV_A], "R3-SB": [MAC.R3_LAN, MAC.SRV_B] };
const LINK_END: Record<Link, [RtDevice, RtDevice]> = { "C-R1": ["CLIENT", "R1"], "R1-R2": ["R1", "R2"], "R2-R3": ["R2", "R3"], "R3-SA": ["R3", "SERVER-A"], "R3-SB": ["R3", "SERVER-B"] };
const TTL_ON: Record<Link, number> = { "C-R1": 64, "R1-R2": 63, "R2-R3": 62, "R3-SA": 61, "R3-SB": 61 };
/** An echo request (or reply, reversed) as it exists on one link. */
export function echoOn(id: string, link: Link, dst: string, seq: number, reply = false): PacketVisual {
  const [a, b] = LINK_END[link];
  const [ma, mb] = LINK_MAC[link];
  const ttl = reply ? 64 + 61 - TTL_ON[link] : TTL_ON[link];
  return icmpPacket({ id, from: reply ? b : a, to: reply ? a : b, ethSrc: reply ? mb : ma, ethDst: reply ? ma : mb, ip: { src: reply ? dst : IP.client, dst: reply ? IP.client : dst, ttl, id: (reply ? 0x6200 : 0x2600) + seq, df: false }, icmp: echo(reply ? "echo-reply" : "echo-request", seq) });
}

export const ROUTER_STAGES: ProcessingStage[] = [
  { id: "rx", label: "Receive frame addressed to this router" },
  { id: "match", label: "Collect every RIB route that matches the destination" },
  { id: "lpm", label: "Longest prefix wins; preference only breaks equal-prefix ties" },
  { id: "action", label: "FIB action: forward (next hop, interface) or discard" },
  { id: "tx", label: "TTL − 1, new Ethernet header, transmit" },
];
export const HOST_STAGES: ProcessingStage[] = [
  { id: "app", label: "ping / traceroute" },
  { id: "tx", label: "Off-link → default gateway 10.10.10.1 / 172.16.20.1" },
  { id: "rx", label: "Receive" },
];
export const RT_STAGES: Record<RtDevice, ProcessingStage[]> = { CLIENT: HOST_STAGES, "SERVER-A": HOST_STAGES, "SERVER-B": HOST_STAGES, R1: ROUTER_STAGES, R2: ROUTER_STAGES, R3: ROUTER_STAGES };
const withDetail = (st: ProcessingStage[], d: Partial<Record<string, string>>) => st.map((x) => (d[x.id] ? { ...x, detail: d[x.id] } : x));
const ev = (type: PVEventType, stepId: string, message: string): PVEvent => ({ type, stepId, timestamp: Date.now(), message });
const idle = (s: RtState): RtState => ({ ...s, packet: undefined, flood: [], decision: undefined });
function hop(stepId: string, device: RtDevice, o: { active: string; details: Partial<Record<string, string>>; lookupType: string; key: string; result: string; action: string; reason: string; input: string; output: string; ingress?: string; egress?: string; next?: RtDevice; before?: PacketVisual; after?: PacketVisual }): FundHop {
  return { stepId, device, stages: withDetail(RT_STAGES[device], o.details), activeStageId: o.active, ingressInterfaceId: o.ingress, egressInterfaceId: o.egress, lookupType: o.lookupType, lookupKey: o.key, lookupResult: o.result, action: o.action, reason: o.reason, input: o.input, output: o.output, nextHopId: o.next, before: o.before ? packetStack(o.before) : undefined, after: o.after ? packetStack(o.after) : undefined };
}
const evidence = (s: RtState, stepId: string, d: RtDevice, o: { active: string; details: Partial<Record<string, string>>; action: string; reason: string; key: string; result: string }): RtState => ({ ...s, hops: [...s.hops, hop(stepId, d, { ...o, lookupType: `${d} evidence`, input: o.key, output: o.result })] });
const ribFor = (s: RtState, r: Router) => (r === "R1" ? s.r1Rib : r === "R2" ? R2_RIB : R3_RIB);

/** A router processes an echo toward `dst`: RIB matches, LPM, FIB action. Truth (the live RIB) decides the outcome. */
function routerStep(s: RtState, stepId: string, r: Router, inLink: Link, outLink: Link | undefined, dst: string, seq: number): { state: RtState; forwarded: boolean } {
  const inPkt = echoOn(`${stepId}-in`, inLink, dst, seq);
  const { matches, chosen } = fibLookup(ribFor(s, r), dst);
  const discard = chosen?.action === "discard";
  const outPkt = !discard && outLink ? echoOn(`${stepId}-out`, outLink, dst, seq) : undefined;
  const h = hop(stepId, r, {
    active: discard ? "action" : "tx",
    ingress: r === "R1" ? "ge-0/0/0" : "ge-0/0/0",
    egress: discard ? undefined : chosen?.iface,
    details: {
      rx: `echo seq ${seq} → ${dst} · TTL ${fieldOf(inPkt, /^IPv4/, "TTL")}`,
      match: matches.map(routeText).join(" | "),
      lpm: `longest match: /${chosen?.len} (${chosen ? PREF_TEXT[chosen.source] : "none"})${matches.filter((m) => m.len === chosen?.len).length > 1 ? " · preference compared between equal prefixes" : " · no equal-prefix tie, preference not consulted"}`,
      action: discard ? `${routeKey(chosen!)} → DISCARD (silently; no ICMP)` : `forward via ${chosen?.nextHop ?? "connected"} ${chosen?.iface}`,
      ...(outPkt ? { tx: `TTL ${fieldOf(inPkt, /^IPv4/, "TTL")} → ${fieldOf(outPkt, /^IPv4/, "TTL")} · ${fieldOf(outPkt, /^Ethernet/, "Source MAC")} → ${fieldOf(outPkt, /^Ethernet/, "Destination MAC")}` } : {}),
    },
    lookupType: `${r} FIB`,
    key: dst,
    result: discard ? `${routeKey(chosen!)} discard` : routeText(chosen!),
    action: discard ? "DISCARD" : "ROUTE",
    reason: discard ? `Two routes match ${dst}: ${matches.map(routeKey).join(" and ")}. The /32 is the longest prefix, so it wins before preference is even considered — and its action is discard. The packet is dropped here, silently.` : `The longest matching route is ${routeKey(chosen!)}. Destination IP unchanged; TTL − 1; new Ethernet addresses.`,
    input: `ICMP echo → ${dst}`,
    output: discard ? "nothing (discarded)" : `→ ${chosen?.nextHop ?? dst}`,
    before: inPkt,
    after: outPkt,
  });
  let n: RtState = { ...idle(s), hops: [...s.hops, h], packet: outPkt ?? inPkt, decision: { device: r, text: discard ? `${r}: lookup chose ${routeKey(chosen!)} discard` : `${r}: ${routeKey(chosen!)} via ${chosen?.nextHop ?? "connected"}` } };
  if (discard) n = { ...n, r1Discards: { ...n.r1Discards, [dst]: (n.r1Discards[dst] ?? 0) + 1 } };
  if (!discard && r === "R1") n = { ...n, r2Rx: { ...n.r2Rx, [dst]: (n.r2Rx[dst] ?? 0) + 1 } };
  return { state: n, forwarded: !discard };
}
function clientTx(s: RtState, stepId: string, dst: string, seq: number): RtState {
  const p = echoOn(`${stepId}-pkt`, "C-R1", dst, seq);
  const h = hop(stepId, "CLIENT", { active: "tx", egress: "eth0", details: { app: `ping ${dst} seq ${seq}`, tx: `${dst} is off-link → gateway ${IP.r1Lan} (${MAC.R1_LAN}) · TTL 64` }, lookupType: "CLIENT route", key: dst, result: `via ${IP.r1Lan}`, action: "TX ECHO", reason: "The client's part is correct: remote destination, frame to the gateway's MAC, IPv4 destination unchanged.", input: "ping", output: "echo → R1", next: "R1", after: p });
  return { ...idle(s), hops: [...s.hops, h], packet: p };
}
/** Summarized traffic: run `n` echoes through the RIB truth without animating each. */
function pingRun(s: RtState, label: string, dst: string, n = 5): RtState {
  const { chosen } = fibLookup(s.r1Rib, dst);
  const ok = chosen?.action === "forward";
  return { ...s, pings: [...s.pings, { label, dst, sent: n, received: ok ? n : 0 }], r1Discards: ok ? s.r1Discards : { ...s.r1Discards, [dst]: (s.r1Discards[dst] ?? 0) + n }, r2Rx: ok ? { ...s.r2Rx, [dst]: (s.r2Rx[dst] ?? 0) + n } : s.r2Rx };
}
function traceRun(s: RtState, label: string, dst: string): RtState {
  const { chosen } = fibLookup(s.r1Rib, dst);
  const hops = chosen?.action === "forward" ? [IP.r1Lan, IP.r2a, IP.r3T, dst] : [IP.r1Lan, "* * *", "* * *", "* * *"];
  return { ...s, traces: [...s.traces, { label, dst, hops }] };
}

// ---------------------------------------------------------------------------------------------------------------
// Repair
// ---------------------------------------------------------------------------------------------------------------
export const RT_REPAIR_OPTIONS = [
  { id: "remove-32", label: "Remove the static 172.16.20.20/32 discard route from R1" },
  { id: "restart-ospf", label: "Restart OSPF on R1, R2 and R3" },
  { id: "lower-metric", label: "Lower the OSPF cost toward 172.16.20.0/24" },
  { id: "clear-arp", label: "Clear the ARP cache on R1" },
  { id: "restart-r2", label: "Restart R2" },
  { id: "server-gw", label: "Change SERVER-A's default gateway" },
  { id: "default", label: "Add another default route on R1" },
] as const;
export const RT_REPAIR_CORRECT = "remove-32";
export function applyRtRepair(s: RtState, choice: string): RtState {
  const correct = choice === RT_REPAIR_CORRECT;
  if (!correct) return { ...s, repairAttempt: { choice, correct } };
  return { ...idle(s), r1Rib: s.r1Rib.filter((r) => !(r.prefix === IP.srvA && r.len === 32)), faultActive: false, repaired: true, repairAttempt: { choice, correct }, decision: { device: "R1", text: "R1: static 172.16.20.20/32 discard removed" } };
}

// ---------------------------------------------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------------------------------------------
const pkt = (s: RtState) => s.packet;
export const ribText = (rib: RibRoute[]) => rib.map(routeText).join(" · ");
const ospfLine = (s: RtState) => `${s.ospf.neighbors.filter((n) => n.router < n.peer).map((n) => `${n.router}–${n.peer} ${n.state}`).join(", ")} · LSDB ${s.ospf.lsas.map((l) => `${l.adv} ${l.seq}`).join(", ")}`;
const lookupLine = (s: RtState, dst: string) => {
  const { matches, chosen } = fibLookup(s.r1Rib, dst);
  return `${dst}: matches ${matches.map(routeKey).join(", ")} → ${chosen ? `${routeKey(chosen)} ${chosen.action === "discard" ? "discard" : `via ${chosen.nextHop}`}` : "none"}`;
};

function walkForward(s0: RtState, stepId: string, dst: string, seq: number, leg: "r1" | "r2" | "r3"): RtState {
  const lastLink: Link = dst === IP.srvA ? "R3-SA" : "R3-SB";
  if (leg === "r1") return routerStep(s0, stepId, "R1", "C-R1", "R1-R2", dst, seq).state;
  if (leg === "r2") return routerStep(s0, stepId, "R2", "R1-R2", "R2-R3", dst, seq).state;
  const n = routerStep(s0, stepId, "R3", "R2-R3", lastLink, dst, seq).state;
  const srv: RtDevice = dst === IP.srvA ? "SERVER-A" : "SERVER-B";
  const p = echoOn("", lastLink, dst, seq);
  return { ...n, hops: [...n.hops, hop(stepId, srv, { active: "rx", ingress: "eth0", details: { rx: `echo from ${IP.client} · TTL ${fieldOf(p, /^IPv4/, "TTL")}` }, lookupType: `${srv} host`, key: `echo seq ${seq}`, result: "reply via 172.16.20.1", action: "RX ECHO", reason: "Three routers, three TTL decrements (64 → 61).", input: "echo", output: "echo reply", before: p })] };
}

export const rtSteps: ScenarioStep<RtState>[] = [
  // ---- Define / Scope ---
  {
    id: "intro",
    label: "Three routers, two servers",
    narrative: `CLIENT (${IP.client}/24, gateway ${IP.r1Lan}) reaches SERVER-A (${IP.srvA}) and SERVER-B (${IP.srvB}) on 172.16.20.0/24 through R1, R2 and R3. The routers run OSPF area 0 on /31 links (cost ${OSPF_COST} each). This lesson is about how a router CHOOSES a route — and how a perfectly healthy routing protocol can coexist with a blackhole.`,
    run: (s) => ({ state: withNotes(idle(s), "intro", [{ kind: "observation", text: `Service: CLIENT → SERVER-A ${IP.srvA} and SERVER-B ${IP.srvB} (172.16.20.0/24 behind R3)`, source: "design" }]), events: [ev("STEP_ENTERED", "intro", "scope")] }),
  },
  {
    id: "ospf-state",
    label: "OSPF: adjacencies and LSDB",
    narrative: `R1–R2 and R2–R3 adjacencies are Full. All three routers hold the same three router LSAs (${OSPF.lsas.map((l) => `${l.adv} ${l.seq}`).join(", ")}). SPF gives R1 172.16.20.0/24 via ${IP.r2a}, cost 30 (10 + 10 + R3's LAN interface 10).`,
    run: (s) => ({ state: withNotes(evidence(idle(s), "ospf-state", "R1", { active: "match", details: { match: ospfLine(s) }, action: "OSPF STATE", reason: "Adjacency Full + identical LSDBs = the routers agree on the topology. That is the control plane; what the router actually does with a packet is decided by its forwarding table.", key: "show ospf neighbor / database", result: "Full · 3 LSAs" }), "ospf-state", [{ kind: "observation", text: `OSPF: ${ospfLine(s)}`, source: "show ospf", rung: "Routing / forwarding" }]), events: [ev("STEP_ENTERED", "ospf-state", "ospf")] }),
  },
  {
    id: "base-rib",
    label: "Baseline: R1's routing table",
    narrative: `R1: ${R1_BASE.map(routeText).join("; ")}. One route covers the whole server LAN.`,
    run: (s) => ({ state: withNotes(evidence(idle(s), "base-rib", "R1", { active: "match", details: { match: ribText(s.r1Rib) }, action: "RIB", reason: "The RIB holds every usable route from every source; the best per prefix is installed in the FIB.", key: "show route (R1)", result: `${s.r1Rib.length} routes` }), "base-rib", [{ kind: "observation", text: `R1 RIB: ${ribText(s.r1Rib)}`, source: "R1", rung: "Routing / forwarding" }]), events: [ev("STEP_ENTERED", "base-rib", "rib")] }),
  },
  {
    id: "base-echo",
    label: "Baseline: echo to SERVER-A",
    narrative: `CLIENT sends an echo to ${IP.srvA}: Ethernet to R1's MAC, TTL 64.`,
    run: (s) => ({ state: clientTx(s, "base-echo", IP.srvA, 1), events: [ev("PACKET_SENT", "base-echo", "echo")] }),
    packet: pkt,
  },
  {
    id: "base-r1",
    label: "Baseline: R1 looks it up",
    narrative: `R1: only 172.16.20.0/24 (OSPF) matches ${IP.srvA} → via ${IP.r2a}. TTL 64 → 63.`,
    run: (s) => ({ state: walkForward(s, "base-r1", IP.srvA, 1, "r1"), events: [ev("PACKET_SENT", "base-r1", "R1")] }),
    packet: pkt,
  },
  {
    id: "base-r2",
    label: "Baseline: R2 forwards",
    narrative: `R2: 172.16.20.0/24 via ${IP.r3T}. TTL 63 → 62.`,
    run: (s) => ({ state: walkForward(s, "base-r2", IP.srvA, 1, "r2"), events: [ev("PACKET_SENT", "base-r2", "R2")] }),
    packet: pkt,
  },
  {
    id: "base-r3",
    label: "Baseline: R3 delivers",
    narrative: `R3: 172.16.20.0/24 is connected on ge-0/0/1. TTL 62 → 61, frame to SERVER-A's MAC.`,
    run: (s) => ({ state: walkForward(s, "base-r3", IP.srvA, 1, "r3"), events: [ev("PACKET_SENT", "base-r3", "R3")] }),
    packet: pkt,
  },
  {
    id: "q-ttl",
    label: "Question: what changed on the way?",
    narrative: "The echo left CLIENT with TTL 64 and arrived at SERVER-A with TTL 61.",
    question: {
      prompt: "Which fields changed between CLIENT and SERVER-A, and which did not?",
      options: [
        { id: "ttl", label: "TTL fell by one at each of the three routers and the Ethernet addresses were rewritten per link; source and destination IP never changed" },
        { id: "ip", label: "The destination IP changed at each router" },
        { id: "none", label: "Nothing changed" },
        { id: "mac", label: "Only the destination IP and TTL changed" },
      ],
      correctOptionId: "ttl",
      explanation: "Routers rewrite Layer 2 per hop and decrement TTL; the IPv4 destination is what they route on, so it never changes (no NAT here).",
    },
  },
  {
    id: "base-summary",
    label: "Baseline: both servers reachable",
    narrative: "Pings: SERVER-A 5/5, SERVER-B 5/5. Traceroute to either: 10.10.10.1 → 192.0.2.1 → 192.0.2.3 → server. The replies come back with TTL 61.",
    run: (s) => {
      let n = pingRun(pingRun(idle(s), "baseline", IP.srvA), "baseline", IP.srvB);
      n = traceRun(traceRun(n, "baseline", IP.srvA), "baseline", IP.srvB);
      const p = echoOn("base-summary-pkt", "R3-SA", IP.srvA, 1, true);
      return { state: withNotes({ ...n, packet: p }, "base-summary", [{ kind: "observation", text: "Baseline: SERVER-A 5/5, SERVER-B 5/5; traceroute 4 hops to each", source: "ping + traceroute" }]), events: [ev("PACKET_SENT", "base-summary", "reply")] };
    },
    packet: pkt,
  },
  // ---- Incident ---
  {
    id: "incident-intro",
    label: "Incident: one server unreachable",
    narrative: "The morning after a maintenance window: 'SERVER-A is down'. Nobody reports SERVER-B. Scope before touching anything — the evidence may already rule out whole layers.",
    run: (s) => ({ state: withNotes({ ...idle(s), r1Rib: [...s.r1Rib, DISCARD_32], faultActive: true }, "incident-intro", [{ kind: "symptom", text: "SERVER-A unreachable after a maintenance window", source: "user report" }]), events: [ev("STEP_ENTERED", "incident-intro", "incident")] }),
  },
  {
    id: "inc-ping-b",
    label: "SERVER-B still works",
    narrative: `Ping ${IP.srvB}: 5/5. R1 picks 172.16.20.0/24 via ${IP.r2a} — the same OSPF route, the same next hop, the same links as SERVER-A would use.`,
    run: (s) => {
      let n = clientTx(s, "inc-ping-b", IP.srvB, 11);
      n = routerStep(n, "inc-ping-b", "R1", "C-R1", "R1-R2", IP.srvB, 11).state;
      return { state: withNotes(pingRun(n, "incident", IP.srvB), "inc-ping-b", [{ kind: "observation", text: `SERVER-B 5/5 via R1 → R2 → R3 (${lookupLine(n, IP.srvB)})`, source: "ping + R1 lookup", rung: "Routing / forwarding" }, { kind: "inference", text: "Links, OSPF, R2, R3 and the server LAN work — the failure is specific to SERVER-A" }]), events: [ev("PACKET_SENT", "inc-ping-b", "SERVER-B")] };
    },
    packet: pkt,
  },
  {
    id: "q-server-b",
    label: "Question: why SERVER-B matters",
    narrative: "SERVER-A and SERVER-B share the same subnet, path and OSPF route.",
    question: {
      prompt: "Why does SERVER-B working matter?",
      options: [
        { id: "scope", label: "It proves the shared path — links, OSPF, R2, R3, the LAN — works, so the fault is specific to SERVER-A's address or the server itself" },
        { id: "irrelevant", label: "It doesn't — different servers are unrelated" },
        { id: "ospf", label: "It proves OSPF is broken" },
        { id: "luck", label: "It is a coincidence" },
      ],
      correctOptionId: "scope",
      explanation: "A working neighbor on the same path is the cheapest, strongest scoping evidence you can get. Now find what differs for 172.16.20.20.",
    },
  },
  {
    id: "inc-ospf",
    label: "OSPF: unchanged",
    narrative: "OSPF neighbors: Full. LSDB: the same three LSAs with the same sequence numbers as the baseline. 172.16.20.0/24 via 192.0.2.1 is still in R1's routing table.",
    run: (s) => ({ state: withNotes(evidence(idle(s), "inc-ospf", "R1", { active: "match", details: { match: ospfLine(s) }, action: "OSPF STATE", reason: "No adjacency change, no LSA change: the routing protocol is not what changed.", key: "show ospf neighbor / database", result: "identical to baseline" }), "inc-ospf", [{ kind: "observation", text: "OSPF adjacencies Full, LSDB identical to baseline; OSPF /24 still installed", source: "show ospf", rung: "Routing / forwarding" }, { kind: "ruled-out", text: "OSPF failure (adjacencies and LSDB unchanged)" }]), events: [ev("STEP_ENTERED", "inc-ospf", "ospf")] }),
  },
  {
    id: "q-ospf-proof",
    label: "Question: healthy OSPF?",
    narrative: "OSPF is Full and synchronized.",
    question: {
      prompt: "Does a healthy OSPF adjacency prove forwarding is correct for every destination?",
      options: [
        { id: "no", label: "No — OSPF only supplies candidate routes; the forwarding decision is the FIB's longest-prefix match over ALL sources" },
        { id: "yes", label: "Yes — if OSPF is Full, every destination in its routes is reachable" },
        { id: "lsdb", label: "Only if the LSDB has more than two LSAs" },
        { id: "bgp", label: "Only if BGP is also up" },
      ],
      correctOptionId: "no",
      explanation: "Other route sources (connected, static, BGP) compete in the same RIB. A more specific route from any of them overrides OSPF for the addresses it covers.",
    },
  },
  {
    id: "inc-echo-a",
    label: "Echo to SERVER-A",
    narrative: `CLIENT sends an echo to ${IP.srvA}, exactly as before — gateway MAC, TTL 64. The client's part is fine.`,
    run: (s) => ({ state: clientTx(s, "inc-echo-a", IP.srvA, 21), events: [ev("PACKET_SENT", "inc-echo-a", "echo A")] }),
    packet: pkt,
  },
  {
    id: "inc-r1-a",
    label: "R1's lookup for 172.16.20.20",
    narrative: "Inspect R1's pipeline for this packet: which routes match, which one wins, and what is its action?",
    run: (s) => {
      const n = routerStep(s, "inc-r1-a", "R1", "C-R1", "R1-R2", IP.srvA, 21).state;
      return { state: withNotes(n, "inc-r1-a", [{ kind: "observation", text: `R1 lookup: ${lookupLine(n, IP.srvA)}`, source: "R1 forwarding pipeline", rung: "Routing / forwarding" }]), events: [ev("PACKET_SENT", "inc-r1-a", "R1 lookup")] };
    },
    packet: pkt,
  },
  {
    id: "q-matches",
    label: "Question: which routes match?",
    narrative: `R1's table now includes ${routeText(DISCARD_32)} alongside 172.16.20.0/24 OSPF.`,
    question: {
      prompt: `Which of R1's routes match ${IP.srvA}?`,
      options: [
        { id: "both", label: "Both 172.16.20.0/24 (OSPF) and 172.16.20.20/32 (static discard)" },
        { id: "ospf", label: "Only the OSPF /24" },
        { id: "static", label: "Only the /32" },
        { id: "none", label: "Neither" },
      ],
      correctOptionId: "both",
      explanation: "A /24 covers .0–.255, so it matches; a /32 matches exactly one address — this one. Matching is the first step; choosing is the second.",
    },
  },
  {
    id: "inc-r2-counters",
    label: "R2 and SERVER-A see nothing",
    narrative: `During the failing ping, R2 received 0 packets for ${IP.srvA} and SERVER-A's own capture is empty. R1's discard counter for the /32 rose by 5. The packet stops at R1.`,
    run: (s) => {
      const n = pingRun(idle(s), "incident", IP.srvA);
      return { state: withNotes(evidence(n, "inc-r2-counters", "R2", { active: "rx", details: { rx: `packets received for ${IP.srvA}: ${n.r2Rx[IP.srvA] ?? 0} (baseline ping delivered ${s.pings.find((p) => p.label === "baseline" && p.dst === IP.srvA)?.received ?? 0})`, match: `R1 discards for ${IP.srvA}: ${n.r1Discards[IP.srvA] ?? 0}` }, action: "COUNTERS", reason: "Absence downstream plus a rising discard counter upstream pins the drop to R1.", key: `R2 input for ${IP.srvA}`, result: "0 in this attempt" }), "inc-r2-counters", [{ kind: "observation", text: `SERVER-A 0/5; R2 received nothing new for ${IP.srvA}; R1 discard count ${n.r1Discards[IP.srvA]}`, source: "counters + server capture", rung: "Routing / forwarding" }, { kind: "inference", text: "The packet dies at R1" }]), events: [ev("STEP_ENTERED", "inc-r2-counters", "counters")] };
    },
  },
  {
    id: "q-where",
    label: "Question: where does it disappear?",
    narrative: "R2 sees nothing; R1's discard counter rises.",
    question: {
      prompt: "Where does the packet to SERVER-A disappear?",
      options: [
        { id: "r1", label: "At R1: its FIB action for 172.16.20.20 is discard, so it never leaves toward R2" },
        { id: "r2", label: "At R2" },
        { id: "server", label: "At SERVER-A, which ignores pings" },
        { id: "client", label: "At CLIENT, which never sends it" },
      ],
      correctOptionId: "r1",
      explanation: "CLIENT sends it (its trace shows TX to R1), R1 discards it, nothing downstream sees it. A discard route drops silently — no ICMP back.",
    },
  },
  {
    id: "inc-trace",
    label: "Traceroute: where it stops",
    narrative: "traceroute 172.16.20.30: 10.10.10.1 → 192.0.2.1 → 192.0.2.3 → 172.16.20.30. traceroute 172.16.20.20: 10.10.10.1, then * * * — probes die silently after the first hop. (A reject route would have answered ICMP 'unreachable' instead.)",
    run: (s) => {
      const n = traceRun(traceRun(idle(s), "incident", IP.srvB), "incident", IP.srvA);
      return { state: withNotes(evidence(n, "inc-trace", "CLIENT", { active: "app", details: { app: n.traces.filter((t) => t.label === "incident").map((t) => `${t.dst}: ${t.hops.join(" → ")}`).join(" | ") }, action: "TRACEROUTE", reason: "The last hop that answers bounds where probes die. Silence after R1 matches a silent discard at R1.", key: "traceroute ×2", result: "SERVER-A stops after 10.10.10.1" }), "inc-trace", [{ kind: "observation", text: "traceroute SERVER-A: 10.10.10.1 then * * *; SERVER-B: full 4 hops", source: "traceroute" }]), events: [ev("STEP_ENTERED", "inc-trace", "trace")] };
    },
  },
  {
    id: "inc-server-a-ok",
    label: "SERVER-A answers R3",
    narrative: `From R3, ping ${IP.srvA} (source ${IP.r3Lan}): 5/5. SERVER-A is up, its address and gateway are fine, and the server LAN works. The server is not the problem.`,
    run: (s) => {
      const p = icmpPacket({ id: "inc-server-a-ok-pkt", from: "R3", to: "SERVER-A", ethSrc: MAC.R3_LAN, ethDst: MAC.SRV_A, ip: { src: IP.r3Lan, dst: IP.srvA, ttl: 64, id: 0x3301, df: false }, icmp: echo("echo-request", 1) });
      const h = hop("inc-server-a-ok", "R3", { active: "tx", egress: "ge-0/0/1", details: { action: `${IP.srvA} → 172.16.20.0/24 connected ge-0/0/1`, tx: `echo from ${IP.r3Lan} · 5/5 replies` }, lookupType: "R3 test ping", key: IP.srvA, result: "5/5", action: "TEST PING", reason: "Testing from the far side proves the destination itself is healthy.", input: "ping", output: "5/5", after: p });
      return { state: withNotes({ ...idle(s), hops: [...s.hops, h], packet: p, pings: [...s.pings, { label: "from R3", dst: IP.srvA, sent: 5, received: 5 }] }, "inc-server-a-ok", [{ kind: "observation", text: `R3 → SERVER-A: 5/5`, source: "R3 test ping" }, { kind: "ruled-out", text: "SERVER-A down / misconfigured (answers R3)" }]), events: [ev("PACKET_SENT", "inc-server-a-ok", "R3 ping")] };
    },
    packet: pkt,
  },
  {
    id: "q-lpm",
    label: "Question: /32 vs /24",
    narrative: "Both routes match 172.16.20.20.",
    question: {
      prompt: "Why does the /32 beat the /24?",
      options: [
        { id: "lpm", label: "Longest-prefix match: the most specific matching prefix wins, before anything else is compared" },
        { id: "pref", label: "Static routes have a better preference than OSPF, so they always win" },
        { id: "newer", label: "It was configured more recently" },
        { id: "metric", label: "It has a lower metric" },
      ],
      correctOptionId: "lpm",
      explanation: "Prefix length is evaluated first. Even if the static route had the WORST possible preference, a /32 still beats a /24 for the address it covers.",
    },
  },
  {
    id: "q-pref",
    label: "Question: when does preference count?",
    narrative: "Static has preference 5 (Cisco-style AD 1); OSPF has 10 (AD 110).",
    question: {
      prompt: "When is route preference (administrative distance) considered?",
      options: [
        { id: "equal", label: "Only between candidate routes for the SAME prefix and length — e.g. a static 172.16.20.0/24 vs an OSPF 172.16.20.0/24" },
        { id: "always", label: "Always first, before prefix length" },
        { id: "never", label: "Never — only metrics matter" },
        { id: "ties", label: "Only when metrics are equal across different prefixes" },
      ],
      correctOptionId: "equal",
      explanation: "Preference picks which SOURCE's route for one prefix goes into the FIB. Different prefix lengths are different FIB entries; lookup then picks the longest match.",
    },
  },
  {
    id: "inc-rib-fib",
    label: "RIB vs FIB",
    narrative: `R1 RIB: 172.16.20.0/24 OSPF (active for its prefix) and 172.16.20.20/32 static discard (active for its prefix). Both are in the FIB as separate entries. Lookup for .30 → /24; lookup for .20 → /32 → discard.`,
    run: (s) => ({ state: withNotes(evidence(idle(s), "inc-rib-fib", "R1", { active: "lpm", details: { match: ribText(s.r1Rib), lpm: `${lookupLine(s, IP.srvA)} | ${lookupLine(s, IP.srvB)}` }, action: "RIB / FIB", reason: "A route being present for a subnet does not mean every address in it follows that route: a more specific entry can carve addresses out.", key: "show route 172.16.20.20 / .30", result: "different FIB entries" }), "inc-rib-fib", [{ kind: "observation", text: `${lookupLine(s, IP.srvA)} · ${lookupLine(s, IP.srvB)}`, source: "R1 FIB", rung: "Routing / forwarding" }, { kind: "hypothesis", text: "The /32 discard on R1 blackholes SERVER-A" }]), events: [ev("STEP_ENTERED", "inc-rib-fib", "fib")] }),
  },
  {
    id: "q-rib-fib",
    label: "Question: RIB presence vs FIB behavior",
    narrative: "'The /24 is right there in the routing table!'",
    question: {
      prompt: "What distinguishes a route's presence in the RIB from the FIB's behavior for one address?",
      options: [
        { id: "lookup", label: "The FIB holds one best route per prefix; each packet uses the longest matching prefix — so a present /24 can be overridden for specific addresses by a /32" },
        { id: "same", label: "Nothing — if it is in the RIB, packets use it" },
        { id: "ospf", label: "The FIB only contains OSPF routes" },
        { id: "time", label: "The FIB is updated once a day" },
      ],
      correctOptionId: "lookup",
      explanation: "Check the lookup for the exact destination ('show route 172.16.20.20' / 'show ip route 172.16.20.20'), not just the presence of the subnet.",
    },
  },
  {
    id: "q-metric",
    label: "Question: tune OSPF?",
    narrative: "Someone proposes lowering the OSPF cost to make the /24 'more attractive'.",
    question: {
      prompt: "Why will lowering the OSPF metric not fix this?",
      options: [
        { id: "lpm", label: "Metrics compare routes within OSPF for the same prefix; they cannot make a /24 beat a /32 in the FIB" },
        { id: "slow", label: "It would, but OSPF converges too slowly" },
        { id: "works", label: "It would fix it" },
        { id: "static", label: "Static routes have no metric" },
      ],
      correctOptionId: "lpm",
      explanation: "The /24 is already the best OSPF route and already installed. The problem is not its quality — it is the more specific discard.",
    },
  },
  {
    id: "inc-config",
    label: "Where did the /32 come from?",
    narrative: "R1's configuration history: during last night's change, 'static route 172.16.20.20/32 discard' was added to blackhole SERVER-A while it was migrated, with a note to remove it afterwards. The removal never happened.",
    run: (s) => ({ state: withNotes(evidence(idle(s), "inc-config", "R1", { active: "action", details: { action: `static ${routeKey(DISCARD_32)} discard — added in maintenance change, never removed` }, action: "CONFIG HISTORY", reason: "Configuration history explains how the evidence came to be; the evidence already identified what.", key: "show configuration / commit history", result: "temporary blackhole left behind" }), "inc-config", [{ kind: "observation", text: "Change record: /32 discard added as a temporary measure during SERVER-A's migration; not removed", source: "R1 config history" }]), events: [ev("STEP_ENTERED", "inc-config", "config")] }),
  },
  {
    id: "diagnostic-layers",
    label: "Walk the evidence ladder",
    narrative: "Evidence already scoped this above Layer 3 addressing: the lowest broken dependency consistent with it is R1's forwarding decision.",
  },
  {
    id: "predict-cause",
    label: "Predict: root cause",
    narrative: "Put it together.",
    question: {
      prompt: "What is the root cause?",
      options: [
        { id: "discard", label: "A stale static 172.16.20.20/32 discard route on R1 wins longest-prefix match for SERVER-A" },
        { id: "ospf", label: "OSPF lost the route to 172.16.20.0/24" },
        { id: "server", label: "SERVER-A is down" },
        { id: "arp", label: "R3 has a stale ARP entry for SERVER-A" },
      ],
      correctOptionId: "discard",
      explanation: "OSPF is unchanged, SERVER-B works through the same /24, R2 never sees SERVER-A's packets, and R1's own lookup selects the /32 discard.",
    },
    run: (s) => ({ state: withNotes(idle(s), "predict-cause", [{ kind: "root-cause", text: "Stale static 172.16.20.20/32 discard on R1 (longest-prefix match beats the OSPF /24)", source: "R1 FIB + counters" }]), events: [] }),
  },
  // ---- Repair ---
  {
    id: "repair-challenge",
    label: "Repair R1",
    narrative: "Choose the change that fixes the cause you identified.",
    action: (s, payload) => ({ state: applyRtRepair(s, (payload as { choice: string }).choice), events: [ev("STEP_ENTERED", "repair-challenge", `Repair attempt: ${(payload as { choice: string }).choice}`)] }),
    requiresState: (s) => s.repaired,
  },
  // ---- Verify ---
  {
    id: "ver-rib",
    label: "Verify: lookup for .20",
    narrative: `R1's table is back to four routes. Lookup for ${IP.srvA}: only 172.16.20.0/24 OSPF matches → via ${IP.r2a}. OSPF adjacencies and LSDB are untouched by the repair.`,
    run: (s) => ({ state: withNotes(evidence(idle(s), "ver-rib", "R1", { active: "lpm", details: { match: ribText(s.r1Rib), lpm: lookupLine(s, IP.srvA) }, action: "RIB / FIB", reason: "The repair removed exactly one route; nothing else changed.", key: `show route ${IP.srvA}`, result: "172.16.20.0/24 via 192.0.2.1" }), "ver-rib", [{ kind: "observation", text: `After repair: ${lookupLine(s, IP.srvA)}; OSPF ${ospfLine(s)}`, source: "R1" }]), events: [ev("STEP_ENTERED", "ver-rib", "rib")] }),
  },
  {
    id: "ver-echo",
    label: "Verify: echo to SERVER-A",
    narrative: "CLIENT pings SERVER-A again.",
    run: (s) => ({ state: clientTx(s, "ver-echo", IP.srvA, 31), events: [ev("PACKET_SENT", "ver-echo", "echo")] }),
    packet: pkt,
  },
  {
    id: "ver-r1",
    label: "Verify: R1 forwards",
    narrative: `R1 matches only the /24 now and forwards to ${IP.r2a}. TTL 64 → 63.`,
    run: (s) => ({ state: walkForward(s, "ver-r1", IP.srvA, 31, "r1"), events: [ev("PACKET_SENT", "ver-r1", "R1")] }),
    packet: pkt,
  },
  {
    id: "ver-r2",
    label: "Verify: R2 receives it",
    narrative: "R2 receives a packet for 172.16.20.20 for the first time since the incident began, and forwards it. TTL 63 → 62.",
    run: (s) => ({ state: walkForward(s, "ver-r2", IP.srvA, 31, "r2"), events: [ev("PACKET_SENT", "ver-r2", "R2")] }),
    packet: pkt,
  },
  {
    id: "ver-r3",
    label: "Verify: SERVER-A receives it",
    narrative: "R3 delivers it on the server LAN. TTL 61 at SERVER-A.",
    run: (s) => ({ state: walkForward(s, "ver-r3", IP.srvA, 31, "r3"), events: [ev("PACKET_SENT", "ver-r3", "R3")] }),
    packet: pkt,
  },
  {
    id: "ver-summary",
    label: "Verify: pings and traceroute",
    narrative: "SERVER-A 5/5, SERVER-B still 5/5; traceroute to SERVER-A shows all four hops again. OSPF never changed.",
    run: (s) => {
      let n = pingRun(pingRun(idle(s), "after repair", IP.srvA), "after repair", IP.srvB);
      n = traceRun(n, "after repair", IP.srvA);
      const p = echoOn("ver-summary-pkt", "R3-SA", IP.srvA, 31, true);
      return { state: withNotes({ ...n, packet: p }, "ver-summary", [{ kind: "verified", text: `SERVER-A 5/5 and traceroute complete (${n.traces.at(-1)!.hops.join(" → ")}); SERVER-B 5/5; OSPF unchanged`, source: "ping + traceroute" }]), events: [ev("PACKET_SENT", "ver-summary", "reply")] };
    },
    packet: pkt,
    question: {
      prompt: "What proves the repair?",
      options: [
        { id: "path", label: "R1's lookup for 172.16.20.20 now selects the /24 via R2, R2 and SERVER-A receive the packets, and ping/traceroute to SERVER-A succeed — with OSPF unchanged" },
        { id: "config", label: "The static route no longer appears in the configuration" },
        { id: "ospf", label: "OSPF adjacencies are Full" },
        { id: "serverb", label: "SERVER-B still works" },
      ],
      correctOptionId: "path",
      explanation: "OSPF was Full throughout and SERVER-B always worked. The proof is the changed lookup and the packets that now reach R2 and SERVER-A.",
    },
  },
  // ---- Complete ---
  {
    id: "operations",
    label: "On real routers",
    narrative: "Juniper-style: show route 172.16.20.20 (the exact lookup, with the active route marked), show route 172.16.20.0/24 exact, show route forwarding-table destination 172.16.20.20, show ospf neighbor. Cisco-style: show ip route 172.16.20.20, show ip cef 172.16.20.20, show ip ospf neighbor. Always look up the failing address itself — not just the subnet.",
  },
  {
    id: "complete",
    label: "Lesson complete",
    narrative: "Healthy OSPF, a perfectly good /24 — and a forgotten /32 discard that won longest-prefix match for one address. Scoped by a working neighbor, located by the router's own lookup and counters, repaired by removing one route, proven by the packets that now reach the server.",
  },
];
