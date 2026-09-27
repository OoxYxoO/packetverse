import type { PacketLayer, PacketVisual, PVEvent, PVEventType, ScenarioStep } from "../types";
import type { PacketMutation, ProcessingStage } from "@/components/network3d/types";
import type { FundHop } from "@/components/lesson/fundamentalsTrace";

/**
 * VLANs & Trunking — the third Fundamentals lesson. HOST-A (VLAN 10) and HOST-C (VLAN 20) on SW1, HOST-B (VLAN 10)
 * and HOST-D (VLAN 20) on SW2, SW1 ge-0/0/24 ↔ SW2 ge-0/0/24 an IEEE 802.1Q trunk.
 *
 * Modeled exactly (IEEE 802.1Q concepts):
 * - Hosts send and receive ordinary UNTAGGED frames on access ports; the switch classifies each frame into the
 *   port's access VLAN on ingress.
 * - FDB entries and lookups are keyed by (VLAN, MAC) — VLAN 20 never uses VLAN 10 state.
 * - Flooding (unknown unicast / broadcast) stays inside the frame's VLAN: access ports of that VLAN, plus trunks
 *   whose allowed list contains it — never the ingress port.
 * - On a trunk the frame carries a 4-byte 802.1Q tag inserted AFTER the source MAC and BEFORE the original
 *   EtherType: TPID 0x8100 + TCI (PCP 3 bits, DEI 1 bit, VID 12 bits). The tag does not replace the EtherType.
 *   Adding or removing the tag changes the frame, so the FCS is recomputed.
 * - The tag is removed on access egress. Hosts never see it.
 * - Fault: VLAN 10 is removed from SW1's trunk allowed list (SW1 flushes VLAN 10 entries learned on the trunk).
 *   VLAN 10 frames have no eligible egress and are dropped; VLAN 20 keeps working. Repair: allow VLAN 10.
 * Native-VLAN behaviour is intentionally NOT modeled (Deep Dive context only). Inter-VLAN routing is not simulated.
 */

export type VlanHost = "HOST-A" | "HOST-B" | "HOST-C" | "HOST-D";
export type VlanSwitch = "SW1" | "SW2";
export type VlanDevice = VlanHost | VlanSwitch;
export const VLAN_DEVICES: VlanDevice[] = ["HOST-A", "HOST-C", "SW1", "SW2", "HOST-B", "HOST-D"];

/** Documentation MAC range (RFC 7042: 00-00-5E-00-53-xx). */
export const VLAN_MAC: Record<VlanHost, string> = { "HOST-A": "00:00:5E:00:53:0A", "HOST-B": "00:00:5E:00:53:0B", "HOST-C": "00:00:5E:00:53:0C", "HOST-D": "00:00:5E:00:53:0D" };
export const HOST_VLAN: Record<VlanHost, number> = { "HOST-A": 10, "HOST-B": 10, "HOST-C": 20, "HOST-D": 20 };
export const TRUNK_PORT = "ge-0/0/24";
export const TPID = "0x8100";
export const BCAST = "FF:FF:FF:FF:FF:FF";

export interface PortCfg {
  port: string;
  mode: "access" | "trunk";
  vlan?: number;
  peer: VlanDevice;
}
export const SWITCH_PORTS: Record<VlanSwitch, PortCfg[]> = {
  SW1: [
    { port: "ge-0/0/1", mode: "access", vlan: 10, peer: "HOST-A" },
    { port: "ge-0/0/2", mode: "access", vlan: 20, peer: "HOST-C" },
    { port: TRUNK_PORT, mode: "trunk", peer: "SW2" },
  ],
  SW2: [
    { port: "ge-0/0/1", mode: "access", vlan: 10, peer: "HOST-B" },
    { port: "ge-0/0/2", mode: "access", vlan: 20, peer: "HOST-D" },
    { port: TRUNK_PORT, mode: "trunk", peer: "SW1" },
  ],
};
export const hostAttach = (h: VlanHost): { sw: VlanSwitch; port: string } => {
  const sw: VlanSwitch = h === "HOST-A" || h === "HOST-C" ? "SW1" : "SW2";
  return { sw, port: SWITCH_PORTS[sw].find((p) => p.peer === h)!.port };
};

export interface VlanFdbEntry {
  vlan: number;
  mac: string;
  port: string;
}

export interface VlanState {
  hops: FundHop[];
  fdb: Record<VlanSwitch, VlanFdbEntry[]>;
  allowed: Record<VlanSwitch, number[]>;
  packet?: PacketVisual;
  flood: { id: string; fromId: string; toId: string; packet: PacketVisual }[];
  note?: { device: VlanDevice; text: string };
  faultActive: boolean;
  repairAttempt?: { choice: string; correct: boolean };
  repaired: boolean;
}

export const createVlanState = (): VlanState => ({ hops: [], fdb: { SW1: [], SW2: [] }, allowed: { SW1: [10, 20], SW2: [10, 20] }, flood: [], faultActive: false, repaired: false });

// ---------------------------------------------------------------------------------------------------------------
// Frames — the tag appears ONLY on tagged frames
// ---------------------------------------------------------------------------------------------------------------
const PAYLOAD: PacketLayer = { name: "Payload", color: "#60a5fa", fields: [{ label: "Carries", value: "IPv4 packet" }] };
const FCS: PacketLayer = { name: "FCS", color: "#94a3b8", fields: [{ label: "Frame Check Sequence", value: "CRC-32 over the frame" }] };

export function untaggedFrame(id: string, from: string, to: string, src: string, dst: string): PacketVisual {
  const bc = dst === BCAST;
  return {
    id,
    protocol: "ETHERNET",
    from,
    to,
    broadcast: bc,
    badge: bc ? "BCAST" : "FRAME",
    summary: `${bc ? "Ethernet broadcast" : "Ethernet frame"} (untagged) — ${src} → ${dst}`,
    layers: [{ name: "Ethernet II Header", color: "#94a3b8", fields: [{ label: "Destination MAC", value: dst }, { label: "Source MAC", value: src }, { label: "EtherType", value: "0x0800 (IPv4)" }] }, PAYLOAD, FCS],
  };
}

export function taggedFrame(id: string, from: string, to: string, src: string, dst: string, vid: number): PacketVisual {
  const bc = dst === BCAST;
  return {
    id,
    protocol: "ETHERNET",
    from,
    to,
    broadcast: bc,
    badge: `VID ${vid}`,
    summary: `802.1Q-tagged ${bc ? "broadcast" : "frame"} VID ${vid} — ${src} → ${dst}`,
    layers: [
      { name: "Ethernet Addresses", color: "#94a3b8", fields: [{ label: "Destination MAC", value: dst }, { label: "Source MAC", value: src }] },
      {
        name: "802.1Q Tag",
        color: "#a78bfa",
        fields: [
          { label: "TPID", value: TPID },
          { label: "PCP (3 bits)", value: "0" },
          { label: "DEI (1 bit)", value: "0" },
          { label: "VID (12 bits)", value: `${vid}` },
        ],
      },
      { name: "EtherType (original)", color: "#94a3b8", fields: [{ label: "EtherType", value: "0x0800 (IPv4)" }] },
      PAYLOAD,
      FCS,
    ],
  };
}

const fld = (p: PacketVisual, label: string) => p.layers.flatMap((l) => l.fields).find((f) => f.label === label)?.value ?? "";
export const frameVid = (p: PacketVisual): number | undefined => (p.layers.some((l) => l.name === "802.1Q Tag") ? Number(fld(p, "VID (12 bits)")) : undefined);
const dstOf = (p: PacketVisual) => fld(p, "Destination MAC");
const srcOf = (p: PacketVisual) => fld(p, "Source MAC");
export const vlanMacName = (mac: string) => (mac === BCAST ? "broadcast" : ((Object.keys(VLAN_MAC) as VlanHost[]).find((h) => VLAN_MAC[h] === mac) ?? mac));

export function vlanStack(p: PacketVisual, changed = false) {
  const vid = frameVid(p);
  return [
    { id: "mac", text: `dst ${dstOf(p)} · src ${srcOf(p)}`, tone: "generic" as const },
    ...(vid !== undefined ? [{ id: "tag", text: `802.1Q · TPID ${TPID} · PCP 0 · DEI 0 · VID ${vid}`, tone: "vpn" as const, justChanged: changed }] : []),
    { id: "type", text: "EtherType 0x0800", tone: "generic" as const },
    { id: "payload", text: "IPv4 packet", tone: "ip" as const },
    { id: "fcs", text: `FCS${changed ? " (recomputed)" : ""}`, tone: "generic" as const, justChanged: changed },
  ];
}

// ---------------------------------------------------------------------------------------------------------------
// 802.1Q bridge (pure)
// ---------------------------------------------------------------------------------------------------------------
export const SW_STAGES: ProcessingStage[] = [
  { id: "rx", label: "Receive on port" },
  { id: "classify", label: "Classify VLAN (access VLAN or tag VID)" },
  { id: "learn", label: "Learn (VLAN, source MAC) → port" },
  { id: "lookup", label: "Look up (VLAN, destination MAC)" },
  { id: "filter", label: "Egress filter: VLAN member / trunk allowed list" },
  { id: "tag", label: "Tag on trunk · untag on access · FCS" },
  { id: "tx", label: "Transmit" },
];
export const HOST_TX_STAGES: ProcessingStage[] = [
  { id: "build", label: "Build ordinary Ethernet frame (no tag)" },
  { id: "tx", label: "Transmit" },
];
export const HOST_RX_STAGES: ProcessingStage[] = [
  { id: "rx", label: "Receive untagged frame" },
  { id: "filter", label: "Destination MAC = mine or broadcast?" },
  { id: "deliver", label: "Accept or discard" },
];
const withDetail = (base: ProcessingStage[], d: Partial<Record<string, string>>): ProcessingStage[] => base.map((s) => (d[s.id] ? { ...s, detail: d[s.id] } : s));

export interface VlanBridgeResult {
  vlan: number;
  fdb: VlanFdbEntry[];
  kind: "known-unicast" | "unknown-unicast" | "broadcast";
  lookupResult: string;
  /** Ports the frame leaves, and whether it is tagged there. */
  out: { port: string; tagged: boolean; peer: VlanDevice }[];
  /** Trunk ports that would have been used but filter this VLAN. */
  filtered: string[];
}

export function vlanBridge(s: VlanState, sw: VlanSwitch, ingress: string, frame: PacketVisual): VlanBridgeResult {
  const inCfg = SWITCH_PORTS[sw].find((p) => p.port === ingress)!;
  const vlan = inCfg.mode === "access" ? inCfg.vlan! : (frameVid(frame) ?? 0);
  const src = srcOf(frame);
  const dst = dstOf(frame);
  const fdb = [...s.fdb[sw].filter((e) => !(e.vlan === vlan && e.mac === src)), { vlan, mac: src, port: ingress }].sort((a, b) => a.vlan - b.vlan || a.mac.localeCompare(b.mac));
  const member = (p: PortCfg) => (p.mode === "access" ? p.vlan === vlan : s.allowed[sw].includes(vlan));
  const others = SWITCH_PORTS[sw].filter((p) => p.port !== ingress);
  const filteredTrunks = others.filter((p) => p.mode === "trunk" && !s.allowed[sw].includes(vlan)).map((p) => p.port);
  const toOut = (ps: PortCfg[]) => ps.filter(member).map((p) => ({ port: p.port, tagged: p.mode === "trunk", peer: p.peer }));
  if (dst === BCAST) return { vlan, fdb, kind: "broadcast", lookupResult: `broadcast — flood VLAN ${vlan}`, out: toOut(others), filtered: filteredTrunks };
  const hit = fdb.find((e) => e.vlan === vlan && e.mac === dst);
  if (!hit) return { vlan, fdb, kind: "unknown-unicast", lookupResult: `(${vlan}, ${dst}) not in FDB — flood VLAN ${vlan}`, out: toOut(others), filtered: filteredTrunks };
  const port = others.find((p) => p.port === hit.port);
  return { vlan, fdb, kind: "known-unicast", lookupResult: `(${vlan}, ${dst}) → ${hit.port}`, out: port ? toOut([port]) : [], filtered: port && port.mode === "trunk" && !s.allowed[sw].includes(vlan) ? [port.port] : [] };
}

// ---------------------------------------------------------------------------------------------------------------
// Step helpers
// ---------------------------------------------------------------------------------------------------------------
const ev = (type: PVEventType, stepId: string, message: string): PVEvent => ({ type, stepId, timestamp: Date.now(), message });
const push = (s: VlanState, hop: FundHop, patch: Partial<VlanState> = {}): VlanState => ({ ...s, ...patch, hops: [...s.hops, hop] });

function hostSend(s: VlanState, stepId: string, host: VlanHost, dst: string): VlanState {
  const at = hostAttach(host);
  const frame = untaggedFrame(`${stepId}-f`, host, at.sw, VLAN_MAC[host], dst);
  const hop: FundHop = {
    stepId,
    device: host,
    stages: withDetail(HOST_TX_STAGES, { build: `dst ${dst} · src ${VLAN_MAC[host]} · no VLAN tag`, tx: `eth0 → ${at.sw} ${at.port}` }),
    activeStageId: "tx",
    egressInterfaceId: "eth0",
    lookupType: "Frame addressing",
    lookupKey: dst,
    lookupResult: dst === BCAST ? "broadcast" : `unicast to ${vlanMacName(dst)}`,
    action: "SEND (untagged)",
    reason: `${host} sends an ordinary Ethernet frame. It has no idea which VLAN it is in — that is ${at.sw}'s configuration.`,
    input: "(originated here)",
    output: `untagged frame to ${at.sw} ${at.port}`,
    nextHopId: at.sw,
    after: vlanStack(frame),
  };
  return push(s, hop, { packet: frame, flood: [], note: { device: host, text: `${host}: untagged` } });
}

/**
 * One switch processes `frame` arriving on `ingress`. stage "classify" stops after learning (the frame is shown
 * still arriving); stage "tx" emits it on every egress port, tagged or untagged per port.
 */
function switchStep(s: VlanState, stepId: string, sw: VlanSwitch, ingress: string, frame: PacketVisual, stage: "classify" | "tx", fromDevice: VlanDevice): VlanState {
  const r = vlanBridge(s, sw, ingress, frame);
  const inCfg = SWITCH_PORTS[sw].find((p) => p.port === ingress)!;
  const classify = inCfg.mode === "access" ? `access port ${ingress} → VLAN ${r.vlan}` : `trunk ${ingress} · tag VID ${r.vlan} (allowed: ${s.allowed[sw].join(", ")})`;
  const kindText = r.kind === "known-unicast" ? "known unicast" : r.kind === "broadcast" ? "broadcast flood" : "unknown-unicast flood";
  const outText = r.out.length ? r.out.map((o) => `${o.port} ${o.tagged ? `tagged VID ${r.vlan}` : "untagged"}`).join(", ") : "no eligible port";
  const filterText = r.filtered.length ? `${r.filtered.join(", ")} filters VLAN ${r.vlan}` : `members of VLAN ${r.vlan} only`;
  const wasTagged = frameVid(frame) !== undefined;
  const mutations: PacketMutation[] = [];
  if (stage === "tx" && r.out.some((o) => o.tagged) && !wasTagged) mutations.push({ type: "VLAN_ADD", detail: `802.1Q VID ${r.vlan}` });
  if (stage === "tx" && r.out.some((o) => !o.tagged) && wasTagged) mutations.push({ type: "VLAN_REMOVE", detail: `VID ${r.vlan} removed for access port` });
  const dropped = stage === "tx" && r.out.length === 0;
  const hop: FundHop = {
    stepId,
    device: sw,
    stages: withDetail(SW_STAGES, {
      rx: `on ${ingress} (${inCfg.mode})`,
      classify,
      learn: `(${r.vlan}, ${srcOf(frame)}) → ${ingress}`,
      ...(stage === "tx" ? { lookup: r.lookupResult, filter: filterText, tag: r.out.length ? r.out.map((o) => (o.tagged ? `add VID ${r.vlan}` : "untagged")).join(" · ") : "—", tx: dropped ? "DROPPED — nothing to send" : outText } : {}),
    }),
    activeStageId: stage === "classify" ? "learn" : dropped ? "filter" : "tx",
    ingressInterfaceId: ingress,
    egressInterfaceId: stage === "tx" ? r.out[0]?.port : undefined,
    egressInterfaceIds: stage === "tx" ? r.out.map((o) => o.port) : undefined,
    lookupType: `FDB (VLAN ${r.vlan})`,
    lookupKey: stage === "classify" ? `classify on ${ingress}` : `(${r.vlan}, ${dstOf(frame)})`,
    lookupResult: stage === "classify" ? `VLAN ${r.vlan}` : r.lookupResult,
    action: stage === "classify" ? `CLASSIFY VLAN ${r.vlan}` : dropped ? `DROP (VLAN ${r.vlan} filtered)` : `${kindText.toUpperCase()} · VLAN ${r.vlan}`,
    reason:
      stage === "classify"
        ? inCfg.mode === "access"
          ? `The frame arrived untagged on an access port configured for VLAN ${r.vlan}, so it belongs to VLAN ${r.vlan}. ${sw} learns the source MAC in VLAN ${r.vlan} only.`
          : `The frame arrived on the trunk with 802.1Q VID ${r.vlan}, which is in the allowed list, so it stays in VLAN ${r.vlan}.`
        : dropped
          ? `The only path for VLAN ${r.vlan} is ${TRUNK_PORT}, and VLAN ${r.vlan} is not in its allowed list (${s.allowed[sw].join(", ") || "none"}). With no eligible egress port, the frame is dropped. The link itself is up.`
          : `${kindText} inside VLAN ${r.vlan}: out ${outText}. Ports in other VLANs are never considered.`,
    input: `${wasTagged ? `tagged VID ${frameVid(frame)}` : "untagged"} · ${dstOf(frame)} ← ${srcOf(frame)} on ${ingress}`,
    output: stage === "tx" ? (dropped ? "dropped" : outText) : `classified VLAN ${r.vlan}`,
    nextHopId: stage === "tx" ? r.out[0]?.peer : undefined,
    before: vlanStack(frame),
    after: stage === "tx" && r.out[0] ? vlanStack(r.out[0].tagged ? taggedFrame("x", sw, r.out[0].peer, srcOf(frame), dstOf(frame), r.vlan) : untaggedFrame("x", sw, r.out[0].peer, srcOf(frame), dstOf(frame)), r.out[0].tagged !== wasTagged) : undefined,
    mutations: mutations.length ? mutations : undefined,
  };
  const note = { device: sw as VlanDevice, text: stage === "classify" ? `${sw}: ${inCfg.mode === "access" ? `access VLAN ${r.vlan}` : `trunk VID ${r.vlan}`}` : dropped ? `${sw}: VLAN ${r.vlan} not allowed on ${TRUNK_PORT} — dropped` : `${sw}: VLAN ${r.vlan} ${kindText}` };
  const next = push(s, hop, { fdb: { ...s.fdb, [sw]: r.fdb } });
  if (stage === "classify") return { ...next, packet: { ...frame, from: fromDevice, to: sw }, flood: [], note };
  const mk = (o: { port: string; tagged: boolean; peer: VlanDevice }) => (o.tagged ? taggedFrame(`${stepId}-${o.peer}`, sw, o.peer, srcOf(frame), dstOf(frame), r.vlan) : untaggedFrame(`${stepId}-${o.peer}`, sw, o.peer, srcOf(frame), dstOf(frame)));
  const [main, ...rest] = r.out;
  return { ...next, packet: main ? mk(main) : undefined, flood: rest.map((o) => ({ id: `${stepId}-${o.peer}`, fromId: sw, toId: o.peer, packet: mk(o) })), note };
}

function hostReceive(s: VlanState, stepId: string, host: VlanHost, frame: PacketVisual): VlanState {
  const dst = dstOf(frame);
  const mine = dst === VLAN_MAC[host] || dst === BCAST;
  const hop: FundHop = {
    stepId,
    device: host,
    stages: withDetail(HOST_RX_STAGES, { rx: "no 802.1Q tag", filter: `${dst} → ${mine ? "match" : "no match"}`, deliver: mine ? "accepted" : "discarded" }),
    activeStageId: "deliver",
    ingressInterfaceId: "eth0",
    lookupType: "Destination-MAC filter",
    lookupKey: dst,
    lookupResult: mine ? "accepted" : "discarded",
    action: mine ? "ACCEPT" : "DISCARD",
    reason: `${host} receives an ordinary untagged frame — exactly what the sender transmitted. The VLAN tag existed only on the trunk.`,
    input: `untagged · ${dst} ← ${srcOf(frame)}`,
    output: mine ? "delivered" : "discarded",
    before: vlanStack(frame),
  };
  return push(s, hop, { note: { device: host, text: `${host}: ${mine ? "accepted" : "discarded"}` } });
}

const idle = (s: VlanState): VlanState => ({ ...s, packet: undefined, flood: [], note: undefined });
const lastPkt = (s: VlanState) => s.packet!;
const A = VLAN_MAC["HOST-A"];
const B = VLAN_MAC["HOST-B"];
const C = VLAN_MAC["HOST-C"];
const D = VLAN_MAC["HOST-D"];
const fdbText = (s: VlanState, sw: VlanSwitch) => (s.fdb[sw].length ? s.fdb[sw].map((e) => `V${e.vlan} ${vlanMacName(e.mac)}→${e.port}`).join(", ") : "empty");

// ---------------------------------------------------------------------------------------------------------------
// Repair
// ---------------------------------------------------------------------------------------------------------------
export const VLAN_REPAIR_OPTIONS = [
  { id: "allow-10", label: `Add VLAN 10 to SW1 ${TRUNK_PORT}'s allowed VLAN list` },
  { id: "bounce", label: `Shut / no-shut the ${TRUNK_PORT} trunk link` },
  { id: "move-a", label: "Move HOST-A's access port to VLAN 20" },
  { id: "route", label: "Add an IP route between the two switches" },
] as const;
export const VLAN_REPAIR_CORRECT = "allow-10";
export function applyVlanRepair(s: VlanState, choice: string): VlanState {
  const correct = choice === VLAN_REPAIR_CORRECT;
  if (!correct) return { ...s, repairAttempt: { choice, correct } };
  return { ...s, repairAttempt: { choice, correct }, repaired: true, faultActive: false, allowed: { ...s.allowed, SW1: [10, 20] }, note: { device: "SW1", text: `SW1: ${TRUNK_PORT} allows 10, 20` } };
}

// ---------------------------------------------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------------------------------------------
export const vlanFundamentalsSteps: ScenarioStep<VlanState>[] = [
  {
    id: "intro",
    label: "Two switches, two VLANs",
    narrative: "Four hosts share one physical network: two switches joined by one link. VLAN 10 (HOST-A, HOST-B) and VLAN 20 (HOST-C, HOST-D) will behave as two separate LANs on that same hardware.",
  },
  {
    id: "why-vlans",
    label: "Why VLANs?",
    narrative: "Without VLANs, every host here is in one broadcast domain: every broadcast reaches all four. A VLAN splits one switched network into several Layer-2 broadcast domains, with no extra switches.",
  },
  {
    id: "access-ports",
    label: "Access ports",
    narrative: "Host-facing ports are ACCESS ports, each configured with one VLAN: SW1 ge-0/0/1 (HOST-A) and SW2 ge-0/0/1 (HOST-B) are VLAN 10; SW1 ge-0/0/2 (HOST-C) and SW2 ge-0/0/2 (HOST-D) are VLAN 20. Hosts send and receive ordinary, untagged Ethernet.",
  },
  {
    id: "predict-classify",
    label: "Predict: which VLAN?",
    narrative: "HOST-A's frames carry no VLAN information at all.",
    question: {
      prompt: "How does SW1 know HOST-A's untagged frame belongs to VLAN 10?",
      options: [
        { id: "port", label: "From the ingress port's access VLAN configuration" },
        { id: "host", label: "HOST-A writes VLAN 10 into the frame" },
        { id: "ip", label: "From HOST-A's IP subnet" },
        { id: "mac", label: "From HOST-A's MAC vendor prefix" },
      ],
      correctOptionId: "port",
      explanation: "Classification happens on ingress: an untagged frame arriving on an access port is placed in that port's configured VLAN. The host does nothing special, and the switch never looks at IP addresses to do this.",
    },
  },
  {
    id: "trunk-intro",
    label: "The trunk",
    narrative: `SW1 ${TRUNK_PORT} ↔ SW2 ${TRUNK_PORT} is an 802.1Q TRUNK carrying both VLANs over one link. Frames on it carry a tag saying which VLAN they belong to. Allowed VLANs on both ends: 10, 20.`,
  },
  {
    id: "a-sends",
    label: "HOST-A sends to HOST-B",
    narrative: `HOST-A sends an untagged frame: destination ${B}, source ${A}.`,
    run: (s) => ({ state: hostSend(s, "a-sends", "HOST-A", B), events: [ev("PACKET_SENT", "a-sends", "HOST-A → HOST-B")] }),
    packet: (s) => s.packet,
  },
  {
    id: "sw1-classify",
    label: "SW1 classifies: VLAN 10",
    narrative: `The frame arrives untagged on access port ge-0/0/1 (VLAN 10). SW1 learns (VLAN 10, ${A}) → ge-0/0/1. Everything that follows happens inside VLAN 10 only.`,
    run: (s) => ({ state: switchStep(s, "sw1-classify", "SW1", "ge-0/0/1", lastPkt(s), "classify", "HOST-A"), events: [ev("MAC_LEARNED", "sw1-classify", "SW1 learns HOST-A in VLAN 10")] }),
    packet: (s) => s.packet,
    whatChanged: (_p, n) => [`SW1 FDB: ${fdbText(n, "SW1")}`],
  },
  {
    id: "predict-tag",
    label: "Predict: where is the tag?",
    narrative: `(VLAN 10, ${B}) is not in SW1's FDB, so SW1 will flood within VLAN 10. The only other VLAN 10 path is the trunk.`,
    packet: (s) => s.packet,
    question: {
      prompt: "Where does this frame carry an 802.1Q VLAN 10 tag?",
      options: [
        { id: "trunk", label: "Only on the trunk between SW1 and SW2" },
        { id: "all", label: "On every link, from HOST-A to HOST-B" },
        { id: "access", label: "Only on HOST-A's and HOST-B's access links" },
        { id: "none", label: "Nowhere — VLANs never change the frame" },
      ],
      correctOptionId: "trunk",
      explanation: "The tag exists only where two VLANs share a link — the trunk. SW1 adds it on trunk egress; SW2 removes it on access egress. Hosts send and receive untagged frames.",
    },
  },
  {
    id: "sw1-tags",
    label: "SW1 floods in VLAN 10 → trunk, tagged",
    narrative: `Unknown unicast in VLAN 10: SW1 floods to VLAN 10 ports except the ingress — only the trunk. HOST-C's port (VLAN 20) is not a candidate. On ${TRUNK_PORT} the frame gets an 802.1Q tag with VID 10, and a new FCS.`,
    run: (s) => ({ state: switchStep(s, "sw1-tags", "SW1", "ge-0/0/1", untaggedFrame("a-sends-f", "HOST-A", "SW1", A, B), "tx", "HOST-A"), events: [ev("PACKET_SENT", "sw1-tags", "SW1 → trunk, VID 10")] }),
    packet: (s) => s.packet,
    whatChanged: () => ["Tag added: TPID 0x8100, VID 10", "HOST-C (VLAN 20) not flooded", "FCS recomputed"],
  },
  {
    id: "tag-anatomy",
    label: "Inside the 802.1Q tag",
    narrative: `The 4-byte tag sits after the source MAC and before the ORIGINAL EtherType (which is still there, 0x0800): TPID ${TPID} marks the frame as tagged; the 16-bit TCI holds PCP (3 bits, priority), DEI (1 bit) and VID (12 bits) = 10.`,
    packet: (s) => s.packet,
  },
  {
    id: "sw2-ingress",
    label: "SW2 reads VID 10",
    narrative: `SW2 receives the tagged frame on its trunk. VID 10 is allowed, so the frame stays in VLAN 10. SW2 learns (VLAN 10, ${A}) → ${TRUNK_PORT}.`,
    run: (s) => ({ state: switchStep(s, "sw2-ingress", "SW2", TRUNK_PORT, lastPkt(s), "classify", "SW1"), events: [ev("MAC_LEARNED", "sw2-ingress", "SW2 learns HOST-A in VLAN 10")] }),
    packet: (s) => s.packet,
    whatChanged: (_p, n) => [`SW2 FDB: ${fdbText(n, "SW2")}`],
  },
  {
    id: "sw2-untag",
    label: "SW2 → HOST-B, untagged",
    narrative: "SW2 floods within VLAN 10 except the trunk: only ge-0/0/1 (HOST-B). Access egress removes the tag — HOST-B gets the same ordinary frame HOST-A sent. HOST-D (VLAN 20) is untouched.",
    run: (s) => ({ state: switchStep(s, "sw2-untag", "SW2", TRUNK_PORT, taggedFrame("sw1-tags-SW2", "SW1", "SW2", A, B, 10), "tx", "SW1"), events: [ev("PACKET_SENT", "sw2-untag", "SW2 → HOST-B untagged")] }),
    packet: (s) => s.packet,
    whatChanged: () => ["Tag removed on access egress", "HOST-D not flooded"],
  },
  {
    id: "b-accepts",
    label: "HOST-B accepts",
    narrative: "HOST-B sees its own MAC and accepts the frame. It never saw a VLAN tag.",
    run: (s) => ({ state: { ...hostReceive(s, "b-accepts", "HOST-B", untaggedFrame("x", "SW2", "HOST-B", A, B)), packet: undefined, flood: [] }, events: [ev("PACKET_RECEIVED", "b-accepts", "HOST-B accepts")] }),
  },
  {
    id: "b-replies",
    label: "HOST-B replies",
    narrative: `Untagged reply: destination ${A}, source ${B}.`,
    run: (s) => ({ state: hostSend(s, "b-replies", "HOST-B", A), events: [ev("PACKET_SENT", "b-replies", "HOST-B replies")] }),
    packet: (s) => s.packet,
  },
  {
    id: "reply-trunk",
    label: "SW2: known unicast over the trunk",
    narrative: `SW2 learns (VLAN 10, ${B}) → ge-0/0/1, finds (VLAN 10, ${A}) → ${TRUNK_PORT}, and sends the frame tagged VID 10.`,
    run: (s) => ({ state: switchStep(s, "reply-trunk", "SW2", "ge-0/0/1", lastPkt(s), "tx", "HOST-B"), events: [ev("PACKET_SENT", "reply-trunk", "SW2 → SW1 VID 10")] }),
    packet: (s) => s.packet,
    whatChanged: (_p, n) => [`SW2 FDB: ${fdbText(n, "SW2")}`],
  },
  {
    id: "reply-delivered",
    label: "SW1 → HOST-A, untagged",
    narrative: `SW1 reads VID 10, learns (VLAN 10, ${B}) → ${TRUNK_PORT}, finds HOST-A on ge-0/0/1 and removes the tag.`,
    run: (s) => ({ state: switchStep(s, "reply-delivered", "SW1", TRUNK_PORT, lastPkt(s), "tx", "SW2"), events: [ev("PACKET_SENT", "reply-delivered", "SW1 → HOST-A")] }),
    packet: (s) => s.packet,
    whatChanged: (_p, n) => [`SW1 FDB: ${fdbText(n, "SW1")}`],
  },
  {
    id: "c-sends",
    label: "VLAN 20: HOST-C → HOST-D",
    narrative: `Now the other VLAN. HOST-C sends an untagged frame to ${D}. SW1 classifies it into VLAN 20 (access port ge-0/0/2).`,
    run: (s) => {
      const sent = hostSend(s, "c-sends", "HOST-C", D);
      return { state: switchStep(sent, "c-sends", "SW1", "ge-0/0/2", lastPkt(sent), "classify", "HOST-C"), events: [ev("PACKET_SENT", "c-sends", "HOST-C → HOST-D")] };
    },
    packet: (s) => s.packet,
    whatChanged: (_p, n) => [`SW1 FDB: ${fdbText(n, "SW1")}`],
  },
  {
    id: "c-trunk",
    label: "VLAN 20 on the trunk: VID 20",
    narrative: "Unknown in VLAN 20, so SW1 floods VLAN 20 ports except ingress — the trunk — tagged VID 20. HOST-A's port (VLAN 10) is not a candidate.",
    run: (s) => ({ state: switchStep(s, "c-trunk", "SW1", "ge-0/0/2", untaggedFrame("c-sends-f", "HOST-C", "SW1", C, D), "tx", "HOST-C"), events: [ev("PACKET_SENT", "c-trunk", "SW1 → trunk VID 20")] }),
    packet: (s) => s.packet,
  },
  {
    id: "d-delivered",
    label: "SW2 → HOST-D, untagged",
    narrative: "SW2 reads VID 20, learns (VLAN 20, HOST-C) on the trunk, floods VLAN 20 except the trunk — only HOST-D — and removes the tag.",
    run: (s) => ({ state: switchStep(s, "d-delivered", "SW2", TRUNK_PORT, lastPkt(s), "tx", "SW1"), events: [ev("PACKET_SENT", "d-delivered", "SW2 → HOST-D")] }),
    packet: (s) => s.packet,
    whatChanged: (_p, n) => [`SW2 FDB: ${fdbText(n, "SW2")}`],
  },
  {
    id: "predict-fdb-scope",
    label: "Predict: VLAN-scoped lookups",
    narrative: `SW1's FDB now holds VLAN 10 and VLAN 20 entries side by side.`,
    run: (s) => ({ state: idle(s), events: [] }),
    question: {
      prompt: `A VLAN 20 frame arrives at SW1 addressed to ${A} (HOST-A's MAC, known in VLAN 10). What does SW1 do?`,
      options: [
        { id: "scoped", label: "Look up (VLAN 20, that MAC): not found → flood within VLAN 20 only" },
        { id: "cross", label: "Use the VLAN 10 entry and deliver it to HOST-A" },
        { id: "drop", label: "Drop it because the MAC belongs to another VLAN" },
        { id: "all", label: "Flood it to every port on SW1" },
      ],
      correctOptionId: "scoped",
      explanation: "FDB entries are keyed by (VLAN, MAC). A VLAN 20 frame can only ever match VLAN 20 entries, and can only leave through VLAN 20 ports — it can never reach HOST-A's VLAN 10 port.",
    },
  },
  {
    id: "vlan-scoped-fdb",
    label: "VLAN-scoped FDB",
    narrative: "Look at the FDB panel: every entry has a VLAN. VLAN 10 and VLAN 20 each have their own MAC-to-port view of the same switch.",
  },
  {
    id: "predict-broadcast",
    label: "Predict: a VLAN 10 broadcast",
    narrative: `HOST-A is about to send a broadcast to ${BCAST}.`,
    question: {
      prompt: "Which hosts receive HOST-A's broadcast?",
      options: [
        { id: "b", label: "Only HOST-B" },
        { id: "bcd", label: "HOST-B, HOST-C and HOST-D" },
        { id: "c", label: "HOST-C only — it shares SW1" },
        { id: "none", label: "None — broadcasts don't cross trunks" },
      ],
      correctOptionId: "b",
      explanation: "A broadcast floods within its VLAN only. VLAN 10 is HOST-A and HOST-B; the trunk carries it (tagged VID 10) because VLAN 10 is allowed there. HOST-C and HOST-D share the hardware, not the broadcast domain.",
    },
  },
  {
    id: "a-broadcast",
    label: "HOST-A broadcasts",
    narrative: `Untagged broadcast: destination ${BCAST}. SW1 classifies it into VLAN 10.`,
    run: (s) => {
      const sent = hostSend(s, "a-broadcast", "HOST-A", BCAST);
      return { state: switchStep(sent, "a-broadcast", "SW1", "ge-0/0/1", lastPkt(sent), "classify", "HOST-A"), events: [ev("PACKET_SENT", "a-broadcast", "HOST-A broadcasts")] };
    },
    packet: (s) => s.packet,
  },
  {
    id: "bcast-sw1",
    label: "SW1: flood VLAN 10 only",
    narrative: "VLAN 10 ports except ingress: only the trunk (tagged VID 10). HOST-C, on SW1 itself, receives nothing.",
    run: (s) => ({ state: switchStep(s, "bcast-sw1", "SW1", "ge-0/0/1", untaggedFrame("a-broadcast-f", "HOST-A", "SW1", A, BCAST), "tx", "HOST-A"), events: [ev("PACKET_SENT", "bcast-sw1", "SW1 floods VLAN 10")] }),
    packet: (s) => s.packet,
    whatChanged: () => ["HOST-C: not a VLAN 10 member — nothing sent"],
  },
  {
    id: "bcast-sw2",
    label: "SW2: flood VLAN 10 only",
    narrative: "SW2 floods VLAN 10 ports except the trunk: only HOST-B, untagged. HOST-D receives nothing.",
    run: (s) => ({ state: switchStep(s, "bcast-sw2", "SW2", TRUNK_PORT, lastPkt(s), "tx", "SW1"), events: [ev("PACKET_SENT", "bcast-sw2", "SW2 floods VLAN 10")] }),
    packet: (s) => s.packet,
    whatChanged: () => ["HOST-B receives it", "HOST-D: not a VLAN 10 member — nothing sent"],
  },
  {
    id: "isolation-note",
    label: "Layer-2 isolation",
    narrative: "That is the whole point of a VLAN: a separate Layer-2 broadcast domain. The isolation comes from switch VLAN membership, not from IP subnets or routing.",
    run: (s) => ({ state: idle(s), events: [] }),
  },
  {
    id: "predict-inter-vlan",
    label: "Predict: VLAN 10 → VLAN 20?",
    narrative: "HOST-A now wants to talk to HOST-C, which is on the same switch but in VLAN 20.",
    question: {
      prompt: "What is needed for HOST-A (VLAN 10) to reach HOST-C (VLAN 20)?",
      options: [
        { id: "l3", label: "A Layer-3 function — a router, or a Layer-3 switch / IRB interface" },
        { id: "trunk", label: "Nothing — they're on the same switch" },
        { id: "tag", label: "HOST-A tagging its frames VID 20" },
        { id: "fdb", label: "A static FDB entry for HOST-C in VLAN 10" },
      ],
      correctOptionId: "l3",
      explanation: "Pure Layer-2 switching never moves a frame from one VLAN to another. Inter-VLAN traffic must be routed by a Layer-3 device. That is covered in a routing lesson and is not simulated here.",
    },
  },
  {
    id: "break-intro",
    label: "Incident: a ticket arrives",
    narrative: "After a change window, users report: HOST-A cannot reach HOST-B. HOST-C ↔ HOST-D is fine. All link lights are green.",
    run: (s) => ({ state: idle(s), events: [] }),
  },
  {
    id: "fault-injected",
    label: "The change",
    narrative: `During the change, SW1 ${TRUNK_PORT}'s trunk configuration was edited. The link stayed up; SW1 flushed the VLAN entries it no longer carries on that port.`,
    run: (s) => ({
      state: { ...idle(s), faultActive: true, allowed: { ...s.allowed, SW1: [20] }, fdb: { ...s.fdb, SW1: s.fdb.SW1.filter((e) => !(e.port === TRUNK_PORT && e.vlan === 10)) }, note: { device: "SW1", text: `SW1: ${TRUNK_PORT} config changed` } },
      events: [ev("STEP_ENTERED", "fault-injected", "SW1 trunk configuration changed")],
    }),
    whatChanged: (_p, n) => [`SW1 FDB: ${fdbText(n, "SW1")}`],
  },
  {
    id: "fault-a-sends",
    label: "HOST-A tries HOST-B",
    narrative: "HOST-A sends an untagged frame to HOST-B. SW1 classifies it into VLAN 10 as usual.",
    run: (s) => {
      const sent = hostSend(s, "fault-a-sends", "HOST-A", B);
      return { state: switchStep(sent, "fault-a-sends", "SW1", "ge-0/0/1", lastPkt(sent), "classify", "HOST-A"), events: [ev("PACKET_SENT", "fault-a-sends", "HOST-A → HOST-B")] };
    },
    packet: (s) => s.packet,
  },
  {
    id: "fault-drop",
    label: "SW1 has nowhere to send it",
    narrative: `(VLAN 10, HOST-B) is unknown, so SW1 would flood within VLAN 10 — but the trunk no longer carries VLAN 10. No eligible port: the frame is dropped at SW1. HOST-B never sees it.`,
    run: (s) => ({ state: switchStep(s, "fault-drop", "SW1", "ge-0/0/1", untaggedFrame("fault-a-sends-f", "HOST-A", "SW1", A, B), "tx", "HOST-A"), events: [ev("PACKET_DROPPED", "fault-drop", "VLAN 10 frame dropped at SW1")] }),
    whatChanged: () => ["Frame dropped — no VLAN 10 egress"],
  },
  {
    id: "fault-vlan20-works",
    label: "Meanwhile, VLAN 20 works",
    narrative: "HOST-C → HOST-D crosses the same trunk, tagged VID 20, and is delivered. Same cable, same switches, same ports up.",
    run: (s) => {
      const sent = hostSend(s, "fault-vlan20-works", "HOST-C", D);
      return { state: switchStep(sent, "fault-vlan20-works", "SW1", "ge-0/0/2", lastPkt(sent), "tx", "HOST-C"), events: [ev("PACKET_SENT", "fault-vlan20-works", "VLAN 20 crosses the trunk")] };
    },
    packet: (s) => s.packet,
    whatChanged: () => ["VLAN 20 frame tagged VID 20 on the trunk"],
  },
  {
    id: "trouble-question",
    label: "Diagnose the incident",
    narrative: "The trunk link is up, all host ports are up, and VLAN 20 crosses the trunk normally.",
    question: {
      prompt: "Why can VLAN 20 continue while VLAN 10 fails?",
      options: [
        { id: "allowed", label: "VLAN 10 is missing from SW1's trunk allowed-VLAN list" },
        { id: "link", label: "The trunk link is physically down" },
        { id: "stp", label: "Spanning Tree is blocking the trunk" },
        { id: "ip", label: "The IP route between VLAN 10 and VLAN 20 is missing" },
      ],
      correctOptionId: "allowed",
      explanation: "A physical or STP problem would stop BOTH VLANs on that link. Only VLAN 10 is affected because the trunk filters per VLAN: its allowed list now contains 20 only. IP routing isn't involved — HOST-A and HOST-B are in the same VLAN.",
    },
  },
  {
    id: "diagnostic-layers",
    label: "Troubleshooting layers",
    narrative: "Walk the layers: physical, access-port VLANs, trunk allowed list, host addressing.",
  },
  {
    id: "repair-challenge",
    label: "Repair the trunk",
    narrative: "Choose the change that fixes the cause you identified.",
    action: (s, payload) => ({ state: applyVlanRepair(s, (payload as { choice: string }).choice), events: [ev("STEP_ENTERED", "repair-challenge", `Repair attempt: ${(payload as { choice: string }).choice}`)] }),
    requiresState: (s) => s.repaired,
  },
  {
    id: "verify-vlan10",
    label: "Verify: VLAN 10 crosses again",
    narrative: "HOST-A → HOST-B again: SW1 floods VLAN 10 onto the trunk, tagged VID 10.",
    run: (s) => {
      const sent = hostSend(s, "verify-vlan10", "HOST-A", B);
      return { state: switchStep(sent, "verify-vlan10", "SW1", "ge-0/0/1", lastPkt(sent), "tx", "HOST-A"), events: [ev("PACKET_SENT", "verify-vlan10", "VLAN 10 on the trunk again")] };
    },
    packet: (s) => s.packet,
  },
  {
    id: "verify-delivered",
    label: "Verify: HOST-B reached",
    narrative: "SW2 removes the tag and delivers the frame to HOST-B. HOST-C ↔ HOST-D was never interrupted.",
    run: (s) => {
      const fwd = switchStep(s, "verify-delivered", "SW2", TRUNK_PORT, lastPkt(s), "tx", "SW1");
      const done = hostReceive(fwd, "verify-delivered", "HOST-B", untaggedFrame("x", "SW2", "HOST-B", A, B));
      return { state: { ...done, packet: fwd.packet, flood: fwd.flood }, events: [ev("PACKET_RECEIVED", "verify-delivered", "HOST-B receives")] };
    },
    packet: (s) => s.packet,
  },
  {
    id: "complete",
    label: "Lesson complete",
    narrative: "Access ports classify, trunks tag, FDBs are per VLAN, broadcasts stay inside their VLAN, and a trunk filters VLANs one by one.",
  },
];

export const vlanFdbRows = (s: VlanState, sw: VlanSwitch) => s.fdb[sw].map((e) => ({ label: `VLAN ${e.vlan} · ${e.mac}`, value: `${e.port} (${vlanMacName(e.mac)})` }));
export { A as VLAN_A_MAC, B as VLAN_B_MAC, C as VLAN_C_MAC, D as VLAN_D_MAC };
