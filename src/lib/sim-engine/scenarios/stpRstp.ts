import type { PacketVisual, PVEvent, PVEventType, ScenarioStep } from "../types";
import type { ProcessingStage } from "@/components/network3d/types";
import type { FundHop } from "@/components/lesson/fundamentalsTrace";

/**
 * STP/RSTP: Building a Loop-Free Layer 2 — three bridges in a triangle, one host each. RSTP (IEEE 802.1D-2004 /
 * 802.1w) is the operational model: port roles Root / Designated / Alternate (plus Disabled for a down link), port
 * states Discarding / Learning / Forwarding.
 *
 * Modeled exactly:
 * - Bridge ID = configured priority, then bridge MAC as tie-break. Lowest Bridge ID becomes root.
 * - Every bridge compares priority vectors {Root ID, Root Path Cost, sender Bridge ID, sender Port ID, receiving
 *   Port ID}; lower is better. A non-root bridge's Root Port is the port offering the best vector toward the root.
 *   On each segment the bridge advertising the better vector owns the Designated port; the other end, if it is not
 *   that bridge's Root Port, is Alternate (Discarding).
 * - BPDUs travel to 01:80:C2:00:00:00 in an IEEE 802.3 frame with LLC 0x42/0x42/0x03 — link-local bridge control
 *   traffic, never forwarded as customer data and never carried in IP.
 * - Only Forwarding ports carry customer frames; a Discarding port neither forwards nor learns. Root / Designated
 *   ports forward only after RSTP synchronization (the proposal/agreement handshake — described, not stepped).
 * - A topology change flushes dynamic FDB entries learned on non-edge ports.
 * - Incident: RSTP participation is disabled on SW3's SW2-facing port and the port is forced to forward. That is an
 *   intentional, unsafe teaching misconfiguration — not an edge-port feature.
 * Link path cost is the scenario's configured value (20000 per link), not derived from bandwidth here.
 */

export type StpSw = "SW1" | "SW2" | "SW3";
export type StpHost = "HOST-A" | "HOST-B" | "HOST-C";
export type StpDevice = StpSw | StpHost;
export type LinkId = "L12" | "L13" | "L23";
export const STP_SWITCHES: StpSw[] = ["SW1", "SW2", "SW3"];
export const STP_DEVICES: StpDevice[] = ["HOST-A", "SW1", "SW2", "SW3", "HOST-B", "HOST-C"];
export const LINK_COST = 20000;
export const BPDU_DST = "01:80:C2:00:00:00";
export const BROADCAST_MAC = "FF:FF:FF:FF:FF:FF";
export const BRIDGES: Record<StpSw, { priority: number; mac: string }> = {
  SW1: { priority: 24576, mac: "00:00:5E:00:53:01" },
  SW2: { priority: 32768, mac: "00:00:5E:00:53:02" },
  SW3: { priority: 32768, mac: "00:00:5E:00:53:03" },
};
export const HOST_MAC: Record<StpHost, string> = { "HOST-A": "00:11:22:33:77:0A", "HOST-B": "00:11:22:33:77:0B", "HOST-C": "00:11:22:33:77:0C" };
export const HOST_IP: Record<StpHost, string> = { "HOST-A": "192.168.70.10", "HOST-B": "192.168.70.20", "HOST-C": "192.168.70.30" };
export const PORT_PRIORITY = 128;

export interface StpPort {
  port: string;
  num: number;
  peer: StpDevice;
  peerPort: string;
  link: LinkId | "edge";
}
export const STP_PORTS: Record<StpSw, StpPort[]> = {
  SW1: [
    { port: "ge-0/0/1", num: 1, peer: "SW2", peerPort: "ge-0/0/1", link: "L12" },
    { port: "ge-0/0/2", num: 2, peer: "SW3", peerPort: "ge-0/0/1", link: "L13" },
    { port: "ge-0/0/10", num: 10, peer: "HOST-A", peerPort: "eth0", link: "edge" },
  ],
  SW2: [
    { port: "ge-0/0/1", num: 1, peer: "SW1", peerPort: "ge-0/0/1", link: "L12" },
    { port: "ge-0/0/2", num: 2, peer: "SW3", peerPort: "ge-0/0/2", link: "L23" },
    { port: "ge-0/0/10", num: 10, peer: "HOST-B", peerPort: "eth0", link: "edge" },
  ],
  SW3: [
    { port: "ge-0/0/1", num: 1, peer: "SW1", peerPort: "ge-0/0/2", link: "L13" },
    { port: "ge-0/0/2", num: 2, peer: "SW2", peerPort: "ge-0/0/2", link: "L23" },
    { port: "ge-0/0/10", num: 10, peer: "HOST-C", peerPort: "eth0", link: "edge" },
  ],
};
export const HOST_ATTACH: Record<StpHost, { sw: StpSw; port: string }> = { "HOST-A": { sw: "SW1", port: "ge-0/0/10" }, "HOST-B": { sw: "SW2", port: "ge-0/0/10" }, "HOST-C": { sw: "SW3", port: "ge-0/0/10" } };
export const pk = (sw: StpSw, port: string) => `${sw}:${port}`;
export const portDef = (sw: StpSw, port: string) => STP_PORTS[sw].find((p) => p.port === port)!;
/**
 * IEEE 802.1D-2004 Port Identifier — a 16-bit value: the port priority (0–240 in steps of 16) occupies the top 4 bits
 * and the port number (1–4095) the low 12 bits. For the user-facing priority value that is (priority << 8) | port,
 * e.g. priority 128 port 1 → 0x8001, port 2 → 0x8002, port 23 → 0x8017.
 */
export function encodePortId(priority: number, portNumber: number): number {
  if (!Number.isInteger(priority) || priority < 0 || priority > 240 || priority % 16 !== 0) throw new Error(`Port priority ${priority} must be 0–240 in steps of 16`);
  if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 0x0fff) throw new Error(`Port number ${portNumber} must be 1–4095`);
  return (priority << 8) | portNumber;
}
export const portIdOf = (sw: StpSw, port: string) => encodePortId(PORT_PRIORITY, portDef(sw, port).num);
/** 0x8002 (128.2): the encoded 16-bit value, then priority (top 4 bits × 16) and port number (low 12 bits). */
export const portIdText = (id: number) => `0x${id.toString(16).toUpperCase().padStart(4, "0")} (${(id >> 12) * 16}.${id & 0x0fff})`;
/**
 * BPDU Message Age: the root sends 0; a bridge relaying root information adds MESSAGE_AGE_INCREMENT to the age it
 * received on its Root Port. This teaching scenario models the increment as 1 per bridge hop from the root. It is a
 * timer field and is tracked separately from Root Path Cost (a path metric).
 */
export const MESSAGE_AGE_INCREMENT = 1;

// ---------------------------------------------------------------------------------------------------------------
// Priority vectors
// ---------------------------------------------------------------------------------------------------------------
export interface BridgeId {
  priority: number;
  mac: string;
}
export const bridgeIdOf = (sw: StpSw): BridgeId => BRIDGES[sw];
export const bidText = (b: BridgeId) => `${b.priority} / ${b.mac}`;
export const bidName = (b: BridgeId) => STP_SWITCHES.find((s) => BRIDGES[s].mac === b.mac) ?? b.mac;
const macNum = (m: string) => parseInt(m.replace(/:/g, ""), 16);
/** Negative when a < b (a is better). Priority first; the MAC only breaks a priority tie. */
export const cmpBid = (a: BridgeId, b: BridgeId) => a.priority - b.priority || macNum(a.mac) - macNum(b.mac);
/** What a Designated port advertises: {Root ID, Root Path Cost, sender Bridge ID, sender Port ID}. */
export interface Vector {
  rootId: BridgeId;
  cost: number;
  senderId: BridgeId;
  senderPortId: number;
  /** BPDU Message Age carried with this information — not part of the priority-vector comparison. */
  messageAge: number;
}
export const cmpVector = (a: Vector, b: Vector) => cmpBid(a.rootId, b.rootId) || a.cost - b.cost || cmpBid(a.senderId, b.senderId) || a.senderPortId - b.senderPortId;
export const vectorText = (v: Vector) => `Root ${bidName(v.rootId)} · cost ${v.cost} · from ${bidName(v.senderId)} ${portIdText(v.senderPortId).split(" ")[0]}`;

// ---------------------------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------------------------
export type PortRole = "Root" | "Designated" | "Alternate" | "Disabled" | "Edge" | "Non-RSTP";
export type PortState = "Discarding" | "Learning" | "Forwarding";
export interface FdbEntry {
  mac: string;
  port: string;
}
export interface StpCopy {
  id: string;
  fromId: string;
  toId: string;
  packet: PacketVisual;
}
export interface InFlight {
  sw: StpSw;
  ingress: string;
  frame: PacketVisual;
}
export interface LoopStats {
  wave: number;
  framesSent: number;
  received: Record<StpHost, number>;
  circulating: number;
  moves: { sw: StpSw; from: string; to: string }[];
}
export interface StpState {
  hops: FundHop[];
  linkUp: Record<LinkId, boolean>;
  /** Ports where RSTP participation is disabled (incident). */
  rstpOff: string[];
  /** Last BPDU information received and processed on each port. */
  rx: Record<string, Vector | undefined>;
  /** Root / Designated ports that have completed RSTP synchronization and may forward. */
  synced: Record<string, boolean>;
  fdb: Record<StpSw, FdbEntry[]>;
  packet?: PacketVisual;
  flood: StpCopy[];
  copyNotes: Record<string, string>;
  decision?: { device: StpDevice; text: string };
  inFlight: InFlight[];
  loop?: LoopStats;
  faultActive: boolean;
  repairAttempt?: { choice: string; correct: boolean };
  repaired: boolean;
}
export const createStpState = (): StpState => ({ hops: [], linkUp: { L12: true, L13: true, L23: true }, rstpOff: [], rx: {}, synced: {}, fdb: { SW1: [], SW2: [], SW3: [] }, flood: [], copyNotes: {}, inFlight: [], faultActive: false, repaired: false });

// ---------------------------------------------------------------------------------------------------------------
// RSTP computation (pure, from the state's received BPDU information)
// ---------------------------------------------------------------------------------------------------------------
export const participates = (s: StpState, sw: StpSw, port: string) => !s.rstpOff.includes(pk(sw, port));
const linkIsUp = (s: StpState, p: StpPort) => p.link === "edge" || s.linkUp[p.link];

export interface BridgeInfo {
  rootId: BridgeId;
  cost: number;
  rootPort?: string;
  /** Message Age this bridge puts in the BPDUs it sends (0 when it is, or believes it is, the root). */
  messageAge: number;
}
export function bridgeInfo(s: StpState, sw: StpSw): BridgeInfo {
  const own: BridgeInfo = { rootId: bridgeIdOf(sw), cost: 0, messageAge: 0 };
  let best: { v: Vector; port: string; localId: number } | undefined;
  for (const p of STP_PORTS[sw]) {
    if (p.link === "edge" || !linkIsUp(s, p) || !participates(s, sw, p.port)) continue;
    const r = s.rx[pk(sw, p.port)];
    if (!r) continue;
    const v: Vector = { ...r, cost: r.cost + LINK_COST, messageAge: r.messageAge + MESSAGE_AGE_INCREMENT };
    const localId = portIdOf(sw, p.port);
    if (!best || cmpVector(v, best.v) < 0 || (cmpVector(v, best.v) === 0 && localId < best.localId)) best = { v, port: p.port, localId };
  }
  if (best && cmpBid(best.v.rootId, own.rootId) < 0) return { rootId: best.v.rootId, cost: best.v.cost, rootPort: best.port, messageAge: best.v.messageAge };
  return own;
}
/** The vector this bridge advertises out of `port` when that port is Designated. */
export function designatedVector(s: StpState, sw: StpSw, port: string): Vector {
  const b = bridgeInfo(s, sw);
  return { rootId: b.rootId, cost: b.cost, senderId: bridgeIdOf(sw), senderPortId: portIdOf(sw, port), messageAge: b.messageAge };
}
export function portRole(s: StpState, sw: StpSw, port: string): PortRole {
  const p = portDef(sw, port);
  if (p.link === "edge") return "Edge";
  if (!linkIsUp(s, p)) return "Disabled";
  if (!participates(s, sw, port)) return "Non-RSTP";
  const b = bridgeInfo(s, sw);
  if (b.rootPort === port) return "Root";
  const r = s.rx[pk(sw, port)];
  if (!r) return "Designated";
  return cmpVector(r, designatedVector(s, sw, port)) < 0 ? "Alternate" : "Designated";
}
export function portState(s: StpState, sw: StpSw, port: string): PortState {
  const role = portRole(s, sw, port);
  if (role === "Edge" || role === "Non-RSTP") return "Forwarding";
  if (role === "Disabled" || role === "Alternate") return "Discarding";
  return s.synced[pk(sw, port)] ? "Forwarding" : "Discarding";
}
export const roleShort = (r: PortRole) => (r === "Designated" ? "DP" : r === "Root" ? "RP" : r === "Alternate" ? "ALT" : r === "Disabled" ? "DIS" : r === "Edge" ? "EDGE" : "NO-RSTP");
export const stateShort = (st: PortState) => (st === "Forwarding" ? "FWD" : st === "Learning" ? "LRN" : "DISC");

/** Deliver the BPDU a Designated port sends to its peer: the peer stores the vector (if it participates). */
function deliver(s: StpState, sw: StpSw, port: string): StpState {
  const p = portDef(sw, port);
  if (p.link === "edge" || !s.linkUp[p.link] || !participates(s, sw, port)) return s;
  const peer = p.peer as StpSw;
  if (!participates(s, peer, p.peerPort)) return s;
  return { ...s, rx: { ...s.rx, [pk(peer, p.peerPort)]: designatedVector(s, sw, port) } };
}
/** Repeat BPDU exchange on every Designated port until nothing changes (RSTP reconvergence, not stepped). */
function converge(s: StpState): StpState {
  let cur = s;
  for (let i = 0; i < 6; i++) {
    let next = cur;
    for (const sw of STP_SWITCHES) for (const p of STP_PORTS[sw]) if (p.link !== "edge" && portRole(next, sw, p.port) === "Designated") next = deliver(next, sw, p.port);
    if (JSON.stringify(next.rx) === JSON.stringify(cur.rx)) return next;
    cur = next;
  }
  return cur;
}
/** Proposal/agreement completes: Root and Designated ports may forward; other ports lose their sync. */
function synchronize(s: StpState): StpState {
  const synced: Record<string, boolean> = {};
  for (const sw of STP_SWITCHES)
    for (const p of STP_PORTS[sw]) {
      const r = portRole(s, sw, p.port);
      if (r === "Root" || r === "Designated") synced[pk(sw, p.port)] = true;
    }
  return { ...s, synced };
}
/** Topology change: dynamic entries on non-edge ports are flushed. */
const flushNonEdge = (s: StpState): StpState => ({ ...s, fdb: { SW1: s.fdb.SW1.filter((e) => e.port === "ge-0/0/10"), SW2: s.fdb.SW2.filter((e) => e.port === "ge-0/0/10"), SW3: s.fdb.SW3.filter((e) => e.port === "ge-0/0/10") } });

export function portSummary(s: StpState, sw: StpSw) {
  return STP_PORTS[sw].map((p) => ({ port: p.port, peer: p.peer, link: p.link, up: linkIsUp(s, p), rstp: participates(s, sw, p.port), role: portRole(s, sw, p.port), state: portState(s, sw, p.port), rx: s.rx[pk(sw, p.port)] }));
}
export const topologyLine = (s: StpState) =>
  STP_SWITCHES.map((sw) => {
    const b = bridgeInfo(s, sw);
    return `${sw}: root ${bidName(b.rootId)}${b.rootPort ? ` via ${b.rootPort} (cost ${b.cost})` : " (itself)"}`;
  }).join(" · ");

// ---------------------------------------------------------------------------------------------------------------
// Frames
// ---------------------------------------------------------------------------------------------------------------
const flagsFor = (role: PortRole, st: PortState) => {
  const roleBits = role === "Designated" ? 0x0c : role === "Root" ? 0x08 : role === "Alternate" ? 0x04 : 0;
  const proposal = role === "Designated" && st !== "Forwarding" ? 0x02 : 0;
  const lrn = st !== "Discarding" ? 0x10 : 0;
  const fwd = st === "Forwarding" ? 0x20 : 0;
  return roleBits | proposal | lrn | fwd;
};
const flagsText = (f: number) => {
  const role = (f >> 2) & 3;
  const parts = [["Unknown", "Alternate/Backup", "Root", "Designated"][role]];
  if (f & 0x02) parts.push("Proposal");
  if (f & 0x10) parts.push("Learning");
  if (f & 0x20) parts.push("Forwarding");
  if (f & 0x40) parts.push("Agreement");
  return `0x${f.toString(16).toUpperCase().padStart(2, "0")} (${parts.join(" · ")})`;
};
export const portMac = (sw: StpSw, port: string) => `02:00:00:00:0${sw.slice(2)}:${String(portDef(sw, port).num).padStart(2, "0")}`;

/** An RST BPDU (802.3 + LLC + RST BPDU), built from what `sw` currently advertises on `port`. */
export function bpdu(s: StpState, id: string, sw: StpSw, port: string): PacketVisual {
  const v = designatedVector(s, sw, port);
  const flags = flagsFor(portRole(s, sw, port), portState(s, sw, port));
  const peer = portDef(sw, port).peer;
  return {
    id,
    protocol: "ETHERNET",
    from: sw,
    to: peer,
    badge: "BPDU",
    summary: `RST BPDU — ${sw} ${port} → ${BPDU_DST}`,
    layers: [
      { name: "IEEE 802.3 Header", color: "#94a3b8", fields: [{ label: "Destination MAC", value: BPDU_DST }, { label: "Source MAC", value: portMac(sw, port) }, { label: "Length", value: "39" }] },
      { name: "LLC", color: "#a78bfa", fields: [{ label: "DSAP", value: "0x42" }, { label: "SSAP", value: "0x42" }, { label: "Control", value: "0x03 (UI)" }] },
      {
        name: "RST BPDU",
        color: "#22d3ee",
        fields: [
          { label: "Protocol Identifier", value: "0x0000" },
          { label: "Protocol Version", value: "2 (RSTP)" },
          { label: "BPDU Type", value: "0x02 (Rapid Spanning Tree BPDU)" },
          { label: "Flags", value: flagsText(flags) },
          { label: "Root ID", value: bidText(v.rootId) },
          { label: "Root Path Cost", value: String(v.cost) },
          { label: "Bridge ID", value: bidText(v.senderId) },
          { label: "Port ID", value: portIdText(v.senderPortId) },
          { label: "Message Age", value: String(v.messageAge) },
          { label: "Max Age", value: "20" },
          { label: "Hello Time", value: "2" },
          { label: "Forward Delay", value: "15" },
          { label: "Version 1 Length", value: "0" },
        ],
      },
    ],
  };
}
export const fieldOf = (p: PacketVisual, label: string) => p.layers.flatMap((l) => l.fields).find((f) => f.label === label)?.value ?? "";
export const frameDst = (p: PacketVisual) => fieldOf(p, "Destination MAC");
export const frameSrc = (p: PacketVisual) => fieldOf(p, "Source MAC");
export const isBpdu = (p: PacketVisual) => p.layers.some((l) => l.name === "RST BPDU");

/** Ordinary customer frame (Ethernet II + IPv4 payload description, or an ARP request for broadcasts). */
export function dataFrame(id: string, src: StpHost, dst: StpHost | "broadcast"): PacketVisual {
  const bcast = dst === "broadcast";
  const dmac = bcast ? BROADCAST_MAC : HOST_MAC[dst];
  return {
    id,
    protocol: bcast ? "ARP" : "ETHERNET",
    from: src,
    to: HOST_ATTACH[src].sw,
    broadcast: bcast,
    badge: bcast ? "BCAST" : "FRAME",
    summary: `${bcast ? "Ethernet broadcast" : "Ethernet frame"} — ${HOST_MAC[src]} → ${dmac}`,
    layers: [
      { name: "Ethernet II Header", color: "#94a3b8", fields: [{ label: "Destination MAC", value: dmac }, { label: "Source MAC", value: HOST_MAC[src] }, { label: "EtherType", value: bcast ? "0x0806 (ARP)" : "0x0800 (IPv4)" }] },
      { name: "Payload", color: bcast ? "#f59e0b" : "#60a5fa", fields: [{ label: "Carries", value: bcast ? `ARP request — who has ${HOST_IP["HOST-B"]}? tell ${HOST_IP[src]}` : `IPv4 packet ${HOST_IP[src]} → ${HOST_IP[dst]}` }] },
      { name: "FCS", color: "#94a3b8", fields: [{ label: "Frame Check Sequence", value: "CRC-32 over the frame" }] },
    ],
  };
}
export const macName = (m: string) => (m === BROADCAST_MAC ? "broadcast" : ((Object.keys(HOST_MAC) as StpHost[]).find((h) => HOST_MAC[h] === m) ?? m));
export function frameStack(p: PacketVisual) {
  if (isBpdu(p)) return [
    { id: "eth", text: `802.3 · dst ${frameDst(p)} · src ${frameSrc(p)} · length 39`, tone: "generic" as const },
    { id: "llc", text: "LLC · DSAP 0x42 · SSAP 0x42 · UI", tone: "generic" as const },
    { id: "bpdu", text: `RST BPDU · Root ${fieldOf(p, "Root ID")} · cost ${fieldOf(p, "Root Path Cost")} · Bridge ${fieldOf(p, "Bridge ID")}`, tone: "vpn" as const },
  ];
  return [
    { id: "eth", text: `Ethernet II · dst ${frameDst(p)} · src ${frameSrc(p)}`, tone: "generic" as const },
    { id: "payload", text: `Payload · ${fieldOf(p, "Carries")}`, tone: "ip" as const },
  ];
}

// ---------------------------------------------------------------------------------------------------------------
// Stages and hop helpers
// ---------------------------------------------------------------------------------------------------------------
export const RSTP_STAGES: ProcessingStage[] = [
  { id: "rx", label: "Receive BPDU (01:80:C2:00:00:00) — link-local, not forwarded" },
  { id: "compare", label: "Compare priority vector: Root ID → cost → Bridge ID → Port ID" },
  { id: "roles", label: "Select Root Port · Designated / Alternate per segment" },
  { id: "state", label: "Port state: Discarding → Forwarding after synchronization" },
];
export const BRIDGE_STAGES: ProcessingStage[] = [
  { id: "rx", label: "Receive frame · ingress port must be Forwarding" },
  { id: "learn", label: "Learn SOURCE MAC → ingress port" },
  { id: "lookup", label: "Look up DESTINATION MAC" },
  { id: "tx", label: "Transmit only on Forwarding ports" },
];
export const HOST_STAGES: ProcessingStage[] = [
  { id: "build", label: "Build Ethernet frame" },
  { id: "tx", label: "Transmit / receive on eth0" },
  { id: "deliver", label: "Accept own MAC or broadcast" },
];
const withDetail = (base: ProcessingStage[], d: Partial<Record<string, string>>): ProcessingStage[] => base.map((x) => (d[x.id] ? { ...x, detail: d[x.id] } : x));
const ev = (type: PVEventType, stepId: string, message: string): PVEvent => ({ type, stepId, timestamp: Date.now(), message });
const push = (s: StpState, hop: FundHop, patch: Partial<StpState> = {}): StpState => ({ ...s, ...patch, hops: [...s.hops, hop] });
const idle = (s: StpState): StpState => ({ ...s, packet: undefined, flood: [], copyNotes: {}, decision: undefined });
const rolesLine = (s: StpState, sw: StpSw) => portSummary(s, sw).filter((p) => p.link !== "edge").map((p) => `${p.port} ${roleShort(p.role)}/${stateShort(p.state)}`).join(" · ");

/** A bridge's RSTP processing hop (after the state change has been applied to `after`). */
function rstpHop(before: StpState, after: StpState, stepId: string, sw: StpSw, o: { ingress?: string; action: string; reason: string; key: string; frame?: PacketVisual; active?: string }): FundHop {
  const b0 = bridgeInfo(before, sw);
  const b1 = bridgeInfo(after, sw);
  return {
    stepId,
    device: sw,
    stages: withDetail(RSTP_STAGES, {
      rx: o.ingress ? `on ${o.ingress}` : "local event",
      compare: `root was ${bidName(b0.rootId)} (cost ${b0.cost}) → now ${bidName(b1.rootId)} (cost ${b1.cost})`,
      roles: rolesLine(after, sw),
      state: portSummary(after, sw).filter((p) => p.link !== "edge").map((p) => `${p.port} ${p.state}`).join(" · "),
    }),
    activeStageId: o.active ?? "roles",
    ingressInterfaceId: o.ingress,
    lookupType: `${sw} RSTP priority vectors`,
    lookupKey: o.key,
    lookupResult: `Root ${bidName(b1.rootId)} · cost ${b1.cost} · Root Port ${b1.rootPort ?? "none (root bridge)"}`,
    action: o.action,
    reason: o.reason,
    input: o.frame ? `BPDU ${fieldOf(o.frame, "Root ID")} cost ${fieldOf(o.frame, "Root Path Cost")} from ${fieldOf(o.frame, "Bridge ID")}` : o.key,
    output: rolesLine(after, sw),
    before: o.frame ? frameStack(o.frame) : undefined,
  };
}

function hostSend(s: StpState, stepId: string, host: StpHost, frame: PacketVisual): StpState {
  const at = HOST_ATTACH[host];
  const hop: FundHop = {
    stepId,
    device: host,
    stages: withDetail(HOST_STAGES, { build: `dst ${frameDst(frame)} · src ${frameSrc(frame)}`, tx: `eth0 → ${at.sw} ${at.port}` }),
    activeStageId: "tx",
    egressInterfaceId: "eth0",
    lookupType: "Frame addressing",
    lookupKey: `destination ${frameDst(frame)}`,
    lookupResult: frameDst(frame) === BROADCAST_MAC ? "broadcast" : `unicast to ${macName(frameDst(frame))}`,
    action: "SEND",
    reason: `${host} sends an ordinary customer frame to ${at.sw} ${at.port} (an edge port, Forwarding).`,
    input: "(originated here)",
    output: `${frameDst(frame)} ← ${frameSrc(frame)}`,
    nextHopId: at.sw,
    after: frameStack(frame),
  };
  return push(s, hop, { packet: frame, flood: [], copyNotes: {}, decision: { device: host, text: `${host} → ${at.sw}` } });
}

/** One bridge forwards a customer frame. Frames arriving on a Discarding port are dropped (no learning). */
function bridgeData(s: StpState, stepId: string, sw: StpSw, ingress: string, frame: PacketVisual): StpState {
  const inState = portState(s, sw, ingress);
  const src = frameSrc(frame);
  const dst = frameDst(frame);
  if (inState !== "Forwarding") {
    const hop: FundHop = {
      stepId,
      device: sw,
      stages: withDetail(BRIDGE_STAGES, { rx: `on ${ingress} — ${portRole(s, sw, ingress)} / ${inState}: discarded`, learn: "no learning on a Discarding port" }),
      activeStageId: "rx",
      ingressInterfaceId: ingress,
      lookupType: `${sw} port state`,
      lookupKey: `${ingress} ${portRole(s, sw, ingress)}`,
      lookupResult: `${inState} — customer frames are neither forwarded nor learned`,
      action: "DISCARD (RSTP)",
      reason: `${ingress} is physically up and still receives BPDUs, but RSTP holds it ${portRole(s, sw, ingress)} / ${inState}. Customer data arriving there is dropped, so this copy goes nowhere.`,
      input: `${dst} ← ${src} on ${ingress}`,
      output: "discarded",
      before: frameStack(frame),
    };
    return push(s, hop, { packet: undefined, flood: [], copyNotes: {}, decision: { device: sw, text: `${sw}: ${ingress} Discarding — customer frame dropped` } });
  }
  const prior = s.fdb[sw].find((e) => e.mac === src);
  const fdb = [...s.fdb[sw].filter((e) => e.mac !== src), { mac: src, port: ingress }].sort((a, b) => a.mac.localeCompare(b.mac));
  const fwdPorts = STP_PORTS[sw].filter((p) => p.port !== ingress && portState(s, sw, p.port) === "Forwarding").map((p) => p.port);
  const hit = dst === BROADCAST_MAC ? undefined : fdb.find((e) => e.mac === dst);
  const egress = dst === BROADCAST_MAC || !hit ? fwdPorts : hit.port === ingress ? [] : [hit.port];
  const kind = dst === BROADCAST_MAC ? "BROADCAST → flood" : hit ? "KNOWN UNICAST → forward" : "UNKNOWN UNICAST → flood";
  const skipped = STP_PORTS[sw].filter((p) => p.port !== ingress && portState(s, sw, p.port) !== "Forwarding").map((p) => `${p.port} (${portRole(s, sw, p.port)}/${portState(s, sw, p.port)})`);
  const hop: FundHop = {
    stepId,
    device: sw,
    stages: withDetail(BRIDGE_STAGES, { rx: `on ${ingress} (Forwarding)`, learn: prior && prior.port !== ingress ? `${macName(src)} MOVED ${prior.port} → ${ingress}` : `${macName(src)} → ${ingress}`, lookup: dst === BROADCAST_MAC ? "broadcast" : hit ? `${macName(dst)} → ${hit.port}` : `${macName(dst)} unknown`, tx: egress.length ? `out ${egress.join(", ")}${skipped.length ? ` · not ${skipped.join(", ")}` : ""}` : "nothing to send" }),
    activeStageId: "tx",
    ingressInterfaceId: ingress,
    egressInterfaceId: egress[0],
    egressInterfaceIds: egress,
    lookupType: `${sw} FDB + port states`,
    lookupKey: `destination ${dst}`,
    lookupResult: kind,
    action: kind,
    reason: `${sw} uses only Forwarding ports for customer data.${skipped.length ? ` ${skipped.join(", ")} ${skipped.length === 1 ? "is" : "are"} not Forwarding, so ${skipped.length === 1 ? "it is" : "they are"} left out.` : ""}`,
    input: `${dst} ← ${src} on ${ingress}`,
    output: egress.length ? `same frame out ${egress.join(", ")}` : "not forwarded",
    nextHopId: egress[0] ? portDef(sw, egress[0]).peer : undefined,
    before: frameStack(frame),
    after: frameStack(frame),
  };
  const copies = egress.map((port) => {
    const peer = portDef(sw, port).peer;
    const cid = `${stepId}-${sw}-${peer}`;
    return { id: cid, fromId: sw, toId: peer, packet: { ...frame, id: cid, from: sw, to: peer } };
  });
  const [main, ...rest] = copies;
  return push({ ...s, fdb: { ...s.fdb, [sw]: fdb } }, hop, { packet: main?.packet, flood: rest, copyNotes: {}, decision: { device: sw, text: `${sw}: ${kind}${egress.length ? ` · out ${egress.join(", ")}` : ""}` } });
}

/** One wave: every copy waiting at the listed bridges is bridged; copies sent to other bridges wait for the next wave. */
function dataWave(s: StpState, stepId: string, sws: StpSw[], wave: number): StpState {
  let working = s;
  const hops: FundHop[] = [];
  const next: InFlight[] = [];
  const hostCounts = new Map<StpHost, number>();
  const trunk: StpCopy[] = [];
  const moves: LoopStats["moves"] = [];
  let sent = 0;
  for (const sw of sws) {
    const here = working.inFlight.filter((f) => f.sw === sw).sort((a, b) => a.ingress.localeCompare(b.ingress));
    const lines: string[] = [];
    const egAll = new Set<string>();
    for (const f of here) {
      if (portState(working, sw, f.ingress) !== "Forwarding") {
        lines.push(`copy on ${f.ingress}: Discarding — dropped`);
        continue;
      }
      const src = frameSrc(f.frame);
      const prior = working.fdb[sw].find((e) => e.mac === src);
      if (prior && prior.port !== f.ingress) moves.push({ sw, from: prior.port, to: f.ingress });
      working = { ...working, fdb: { ...working.fdb, [sw]: [...working.fdb[sw].filter((e) => e.mac !== src), { mac: src, port: f.ingress }].sort((a, b) => a.mac.localeCompare(b.mac)) } };
      const eg = STP_PORTS[sw].filter((p) => p.port !== f.ingress && portState(working, sw, p.port) === "Forwarding");
      lines.push(`copy on ${f.ingress} → out ${eg.map((p) => p.port).join(", ") || "none"}`);
      for (const p of eg) {
        egAll.add(p.port);
        sent++;
        if (p.link === "edge") hostCounts.set(p.peer as StpHost, (hostCounts.get(p.peer as StpHost) ?? 0) + 1);
        else {
          next.push({ sw: p.peer as StpSw, ingress: p.peerPort, frame: f.frame });
          const cid = `${stepId}-${sw}-${p.peer}-${trunk.length}`;
          trunk.push({ id: cid, fromId: sw, toId: p.peer, packet: { ...f.frame, id: cid, from: sw, to: p.peer } });
        }
      }
    }
    const eg = [...egAll];
    hops.push({
      stepId,
      device: sw,
      stages: withDetail(BRIDGE_STAGES, { rx: `${here.length} cop${here.length === 1 ? "y" : "ies"} on ${here.map((h) => h.ingress).join(" + ") || "—"}`, learn: moves.filter((m) => m.sw === sw).map((m) => `HOST-A moved ${m.from} → ${m.to}`).join(" · ") || "source learned", lookup: "broadcast — flood", tx: lines.join(" · ") }),
      activeStageId: "tx",
      ingressInterfaceId: here[0]?.ingress,
      egressInterfaceId: eg[0],
      egressInterfaceIds: eg,
      lookupType: `${sw} FDB + port states`,
      lookupKey: `destination ${BROADCAST_MAC}`,
      lookupResult: lines.join(" · ") || "nothing arrived",
      action: `WAVE ${wave} · FLOOD`,
      reason: `${sw} floods each arriving copy out every Forwarding port except the one it arrived on. Nothing in the frame changes and nothing counts down.`,
      input: `${here.length} broadcast cop${here.length === 1 ? "y" : "ies"}`,
      output: eg.length ? `copies out ${eg.join(", ")}` : "nothing sent",
      nextHopId: eg[0] ? portDef(sw, eg[0]).peer : undefined,
      before: here[0] ? frameStack(here[0].frame) : undefined,
    });
  }
  const frame = s.inFlight.find((f) => sws.includes(f.sw))?.frame;
  const hostCopies: StpCopy[] = [...hostCounts.entries()].map(([h]) => {
    const cid = `${stepId}-${h}`;
    return { id: cid, fromId: HOST_ATTACH[h].sw, toId: h, packet: { ...frame!, id: cid, from: HOST_ATTACH[h].sw, to: h } };
  });
  const notes: Record<string, string> = {};
  hostCopies.forEach((c) => {
    const n = hostCounts.get(c.toId as StpHost) ?? 0;
    if (n > 1) notes[c.id] = `×${n}`;
  });
  const prev = s.loop ?? { wave: 0, framesSent: 0, received: { "HOST-A": 0, "HOST-B": 0, "HOST-C": 0 }, circulating: 0, moves: [] };
  const received = { ...prev.received };
  hostCounts.forEach((n, h) => (received[h] += n));
  const rest = working.inFlight.filter((f) => !sws.includes(f.sw));
  // A copy sent toward a port that is not Forwarding is dropped the moment it arrives — it never circulates.
  const kept = next.filter((n) => portState(working, n.sw, n.ingress) === "Forwarding");
  const loop: LoopStats = { wave, framesSent: prev.framesSent + sent, received, circulating: kept.length + rest.length, moves: [...prev.moves, ...moves] };
  const [main, ...others] = [...trunk, ...hostCopies];
  return { ...working, hops: [...s.hops, ...hops], inFlight: [...rest, ...kept], loop, packet: main?.packet, flood: others, copyNotes: notes, decision: { device: sws[0], text: `Wave ${wave}: ${sent} copies sent` } };
}

// ---------------------------------------------------------------------------------------------------------------
// Protocol steps
// ---------------------------------------------------------------------------------------------------------------
function bpduStep(s: StpState, stepId: string, sends: { sw: StpSw; port: string }[], action: string, reason: string): StpState {
  const frames = sends.map((x, i) => ({ ...x, f: bpdu(s, `${stepId}-bpdu-${i}`, x.sw, x.port) }));
  let next = s;
  for (const x of sends) next = deliver(next, x.sw, x.port);
  const hops: FundHop[] = frames.map((x) => {
    const p = portDef(x.sw, x.port);
    return rstpHop(s, next, stepId, p.peer as StpSw, { ingress: p.peerPort, action, reason, key: `BPDU from ${x.sw}`, frame: x.f, active: "roles" });
  });
  const [main, ...rest] = frames;
  return {
    ...next,
    hops: [...s.hops, ...hops],
    packet: main.f,
    flood: rest.map((r) => ({ id: r.f.id, fromId: r.sw, toId: portDef(r.sw, r.port).peer, packet: r.f })),
    copyNotes: {},
    decision: { device: portDef(main.sw, main.port).peer, text: `${portDef(main.sw, main.port).peer}: ${topologyLine(next).split(" · ").find((t) => t.startsWith(portDef(main.sw, main.port).peer)) ?? ""}` },
  };
}

export const STP_REPAIR_OPTIONS = [
  { id: "restore-rstp", label: "Re-enable RSTP participation on SW3 ge-0/0/2 (the SW2-facing port)" },
  { id: "clear-fdb", label: "Clear the MAC tables on all three switches" },
  { id: "raise-ttl", label: "Raise the IPv4 TTL on HOST-A" },
  { id: "disable-host-c", label: "Disconnect HOST-C" },
  { id: "change-mac", label: "Give HOST-A a new MAC address" },
] as const;
export const STP_REPAIR_CORRECT = "restore-rstp";
export function applyStpRepair(s: StpState, choice: string): StpState {
  const correct = choice === STP_REPAIR_CORRECT;
  if (!correct) return { ...s, repairAttempt: { choice, correct } };
  const restored: StpState = { ...s, rstpOff: [], repairAttempt: { choice, correct }, repaired: true, faultActive: false };
  const conv = flushNonEdge(synchronize(converge(restored)));
  return { ...conv, inFlight: [], loop: conv.loop ? { ...conv.loop, circulating: 0 } : conv.loop, packet: undefined, flood: [], copyNotes: {}, decision: { device: "SW3", text: "SW3 ge-0/0/2: RSTP participation restored" } };
}

// ---------------------------------------------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------------------------------------------
const pkt = (s: StpState) => s.packet;
const arrived = (f: PacketVisual, from: StpDevice, to: StpDevice) => ({ ...f, from, to });
const F = {
  cBcast: () => dataFrame("c-bcast", "HOST-C", "broadcast"),
  bToC: () => dataFrame("b-to-c", "HOST-B", "HOST-C"),
  bToC2: () => dataFrame("b-to-c-after", "HOST-B", "HOST-C"),
  loop: () => dataFrame("loop-a", "HOST-A", "broadcast"),
  verify: () => dataFrame("verify-a", "HOST-A", "broadcast"),
};

export const stpRstpSteps: ScenarioStep<StpState>[] = [
  {
    id: "intro",
    label: "Three switches, three cables",
    narrative: "SW1, SW2 and SW3 are cabled in a triangle, with one host on each. Every inter-switch link is physically up — so there is a loop in the cabling. In Switching Fundamentals a loop like this was fixed by unplugging a cable. Here a control protocol, RSTP, keeps every cable and still makes the forwarding topology loop-free.",
  },
  {
    id: "topology",
    label: "Bridge IDs and costs",
    narrative: `Bridge ID = priority, then MAC. SW1 ${bidText(BRIDGES.SW1)}, SW2 ${bidText(BRIDGES.SW2)}, SW3 ${bidText(BRIDGES.SW3)}. Every inter-switch link has the scenario's configured RSTP path cost ${LINK_COST}. Host ports are edge ports.`,
  },
  {
    id: "self-root",
    label: "Everyone claims to be root",
    narrative: "Before hearing anyone else, each bridge assumes it is the root and advertises itself: Root ID = its own Bridge ID, Root Path Cost 0. Its inter-switch ports start as Designated but Discarding — nothing forwards customer data yet. Here SW2's claim leaves toward SW3; SW1 and SW3 send their own claims too.",
    run: (s) => {
      const f = bpdu(s, "self-sw2", "SW2", "ge-0/0/2");
      const copies = [bpdu(s, "self-sw1", "SW1", "ge-0/0/1"), bpdu(s, "self-sw3", "SW3", "ge-0/0/1")];
      const hop = rstpHop(s, s, "self-root", "SW2", { action: "CLAIM ROOT", reason: "With no BPDU received yet, SW2's own Bridge ID is the best it knows. Every bridge starts this way.", key: "own Bridge ID", active: "compare" });
      return { state: push(idle(s), hop, { packet: f, flood: copies.map((c) => ({ id: c.id, fromId: c.from, toId: c.to, packet: c })) }), events: [ev("PACKET_SENT", "self-root", "Self-root BPDUs")] };
    },
    packet: pkt,
    whatChanged: () => ["Each bridge: Root ID = itself, cost 0", "All inter-switch ports Designated / Discarding"],
  },
  {
    id: "bpdu-anatomy",
    label: "What a BPDU carries",
    narrative: `An RST BPDU travels in an IEEE 802.3 frame to ${BPDU_DST} with LLC 0x42/0x42 — a reserved, link-local bridge address: a bridge consumes it and never forwards it like customer traffic, and there is no IP header. Inside: Protocol Version 2, BPDU Type 0x02, Flags (the sending port's role and state), Root ID, Root Path Cost, Bridge ID and Port ID.`,
    packet: pkt,
  },
  {
    id: "predict-root",
    label: "Predict: who becomes root?",
    narrative: "The three claims are about to be compared.",
    packet: pkt,
    question: {
      prompt: "Which bridge becomes the root, and why?",
      options: [
        { id: "sw1", label: "SW1 — its priority 24576 is lower than 32768, so its Bridge ID is lowest" },
        { id: "sw3", label: "SW3 — the highest MAC wins" },
        { id: "sw2", label: "SW2 — with equal priority, the lowest MAC among SW2/SW3 wins overall" },
        { id: "mac", label: "SW1 — it has the lowest MAC, and MAC is always compared first" },
      ],
      correctOptionId: "sw1",
      explanation: "Bridge IDs are compared priority first. SW1's 24576 beats 32768, so SW1 is root regardless of MACs. The MAC only breaks a tie between equal priorities — like SW2 vs SW3 later.",
    },
  },
  {
    id: "predict-root-rp",
    label: "Predict: the root's own ports",
    narrative: "Right now every bridge still believes it is the root. Once the comparison settles, exactly one of them really will be.",
    question: {
      prompt: "Does the root bridge SW1 have a Root Port?",
      options: [
        { id: "no", label: "No — the root is the destination of every Root Port; its inter-switch ports are Designated" },
        { id: "yes-one", label: "Yes — its lowest-numbered inter-switch port" },
        { id: "yes-both", label: "Yes — both inter-switch ports are Root Ports" },
        { id: "alt", label: "Its ports are Alternate until another bridge agrees" },
      ],
      correctOptionId: "no",
      explanation: "A Root Port is a non-root bridge's best path toward the root. The root has no path to itself, so it has no Root Port. Its ports on SW1–SW2 and SW1–SW3 are Designated.",
    },
  },
  {
    id: "sw2-learns-root",
    label: "SW2 hears SW1",
    narrative: `SW1's BPDU (Root ${bidText(BRIDGES.SW1)}, cost 0) reaches SW2 on ge-0/0/1. It beats SW2's own claim, so SW2 accepts SW1 as root: Root Path Cost 0 + ${LINK_COST} = ${LINK_COST}, and ge-0/0/1 becomes SW2's Root Port.`,
    run: (s) => ({ state: bpduStep(s, "sw2-learns-root", [{ sw: "SW1", port: "ge-0/0/1" }], "NEW ROOT · ROOT PORT", `SW1's vector (Root SW1, cost 0) is better than SW2's own (Root SW2). SW2 adopts SW1 as root; the port it heard that on, ge-0/0/1, offers cost ${LINK_COST} and becomes the Root Port.`), events: [ev("ROUTE_LOOKUP", "sw2-learns-root", "SW2 adopts SW1 as root")] }),
    packet: pkt,
    whatChanged: (_p, n) => [`SW2: ${topologyLine(n).split(" · ")[1]}`],
  },
  {
    id: "predict-sw3-rp",
    label: "Predict: SW3's Root Port",
    narrative: "SW3 has two inter-switch ports: ge-0/0/1 straight to SW1 and ge-0/0/2 toward SW2.",
    question: {
      prompt: "Which SW3 port becomes its Root Port?",
      options: [
        { id: "p1", label: `ge-0/0/1 — it reaches the root directly, cost ${LINK_COST}` },
        { id: "p2", label: `ge-0/0/2 — through SW2, cost ${LINK_COST * 2}` },
        { id: "lowest", label: "Whichever port has the lowest number, regardless of cost" },
        { id: "both", label: "Both — SW3 needs two Root Ports for redundancy" },
      ],
      correctOptionId: "p1",
      explanation: `A non-root bridge picks exactly one Root Port: the one with the best vector toward the root. ge-0/0/1 offers ${LINK_COST}, through SW2 would cost ${LINK_COST * 2}. Port numbers only matter when everything else ties.`,
    },
  },
  {
    id: "sw3-learns-root",
    label: "SW3 hears SW1",
    narrative: `SW1's BPDU reaches SW3 on ge-0/0/1. SW3 accepts SW1 as root with cost ${LINK_COST}; ge-0/0/1 becomes SW3's Root Port.`,
    run: (s) => ({ state: bpduStep(s, "sw3-learns-root", [{ sw: "SW1", port: "ge-0/0/2" }], "NEW ROOT · ROOT PORT", `SW1's vector beats SW3's own claim. ge-0/0/1 reaches the root at cost ${LINK_COST}, the best SW3 has — it becomes the Root Port.`), events: [ev("ROUTE_LOOKUP", "sw3-learns-root", "SW3 adopts SW1 as root")] }),
    packet: pkt,
    whatChanged: (_p, n) => [`SW3: ${topologyLine(n).split(" · ")[2]}`],
  },
  {
    id: "root-ports",
    label: "Root Ports chosen",
    narrative: `SW1: no Root Port (it is the root); ge-0/0/1 and ge-0/0/2 are Designated. SW2: Root Port ge-0/0/1, cost ${LINK_COST}. SW3: Root Port ge-0/0/1, cost ${LINK_COST}. One question is left: the SW2–SW3 segment.`,
    run: (s) => {
      const hop = rstpHop(s, s, "root-ports", "SW1", { action: "ROOT BRIDGE", reason: "No received vector beats SW1's own Bridge ID, so SW1 is root: cost 0, no Root Port, every inter-switch port Designated.", key: "own Bridge ID", active: "roles" });
      return { state: push(idle(s), hop), events: [ev("STEP_ENTERED", "root-ports", "Root Ports chosen")] };
    },
    whatChanged: (_p, n) => [topologyLine(n)],
  },
  {
    id: "predict-designated",
    label: "Predict: the SW2–SW3 segment",
    narrative: `SW2 and SW3 are about to send BPDUs to each other. Both will say: Root SW1, Root Path Cost ${LINK_COST}.`,
    question: {
      prompt: "Which side becomes Designated on the SW2↔SW3 segment, and why?",
      options: [
        { id: "sw2", label: `SW2 — Root ID and cost tie, so the lower sender Bridge ID (${bidText(BRIDGES.SW2)}) wins` },
        { id: "sw3", label: "SW3 — the higher MAC is preferred" },
        { id: "both", label: "Both — each side of a segment is Designated" },
        { id: "cost", label: "Neither: the side with the lower link cost wins, and the costs differ" },
      ],
      correctOptionId: "sw2",
      explanation: `Same Root ID (SW1), same Root Path Cost (${LINK_COST}). The next tie-break is the sender's Bridge ID: both have priority 32768, so the MAC decides, and :02 is lower than :03. SW2's port is Designated; SW3's end becomes Alternate.`,
    },
  },
  {
    id: "cross-bpdus",
    label: "SW2 and SW3 exchange BPDUs",
    narrative: `SW2 sends Root SW1 · cost ${LINK_COST} · Bridge ${bidText(BRIDGES.SW2)}; SW3 sends the same with Bridge ${bidText(BRIDGES.SW3)}. Each side compares. SW2's vector is better, so SW2's ge-0/0/2 stays Designated. SW3's ge-0/0/2 receives a better vector than it would send, and it is not SW3's Root Port — so it becomes Alternate.`,
    run: (s) => ({ state: bpduStep(s, "cross-bpdus", [{ sw: "SW2", port: "ge-0/0/2" }, { sw: "SW3", port: "ge-0/0/2" }], "DESIGNATED / ALTERNATE", `On the SW2–SW3 segment the best vector wins the Designated port: Root and cost tie, SW2's Bridge ID is lower. SW3's ge-0/0/2 hears better information than it would advertise, so it becomes Alternate — a ready backup path to the root.`), events: [ev("ROUTE_LOOKUP", "cross-bpdus", "SW3 ge-0/0/2 Alternate")] }),
    packet: pkt,
    whatChanged: (_p, n) => [`SW2: ${rolesLine(n, "SW2")}`, `SW3: ${rolesLine(n, "SW3")}`],
  },
  {
    id: "sync-forwarding",
    label: "Root and Designated ports forward",
    narrative: "Once the roles agree, RSTP synchronizes each point-to-point link (the proposal/agreement handshake in the Deep Dive) and Root and Designated ports move to Forwarding — after RSTP convergence, not instantly. SW3's Alternate port stays Discarding.",
    run: (s) => {
      const next = synchronize(s);
      const hop = rstpHop(s, next, "sync-forwarding", "SW3", { action: "SYNC · FORWARDING", reason: "Root and Designated ports have been synchronized with their neighbours and may forward. The Alternate port keeps discarding customer frames.", key: "role agreement", active: "state" });
      return { state: push(idle(next), hop), events: [ev("STEP_ENTERED", "sync-forwarding", "Ports forwarding")] };
    },
    whatChanged: (_p, n) => STP_SWITCHES.map((sw) => `${sw}: ${rolesLine(n, sw)}`),
  },
  {
    id: "predict-alt-down",
    label: "Predict: is the Alternate port down?",
    narrative: "Look at SW3 ge-0/0/2 in the inspector.",
    question: {
      prompt: "Is SW3's Alternate port physically down?",
      options: [
        { id: "no", label: "No — the link is up and the port still receives BPDUs; RSTP just doesn't forward customer data on it" },
        { id: "yes", label: "Yes — RSTP shuts the port down" },
        { id: "unplugged", label: "Yes — RSTP asks the technician to unplug it" },
        { id: "disabled", label: "It is administratively disabled until another link fails" },
      ],
      correctOptionId: "no",
      explanation: "Alternate/Discarding is a protocol state, not a link state. The cable is up, BPDUs keep arriving from SW2, and the port stays ready to take over if SW3's Root Port loses its path.",
    },
  },
  {
    id: "final-tree",
    label: "A loop-free tree",
    narrative: "Active topology: SW1–SW2 and SW1–SW3 forward; SW2–SW3 is physically up but not used for customer data because SW3's end is Alternate/Discarding. Three cables, no loop.",
    run: (s) => ({ state: idle(s), events: [] }),
    whatChanged: (_p, n) => STP_SWITCHES.map((sw) => `${sw}: ${rolesLine(n, sw)}`),
  },
  {
    id: "c-bcast-send",
    label: "HOST-C sends a broadcast",
    narrative: "Customer traffic now. HOST-C sends an ordinary broadcast (an ARP request). Only Forwarding ports will carry it.",
    run: (s) => ({ state: hostSend(idle(s), "c-bcast-send", "HOST-C", F.cBcast()), events: [ev("PACKET_SENT", "c-bcast-send", "HOST-C broadcasts")] }),
    packet: pkt,
  },
  {
    id: "c-bcast-sw3",
    label: "SW3 floods on Forwarding ports",
    narrative: "SW3 learns HOST-C on its edge port and floods — out ge-0/0/1 toward SW1 only. ge-0/0/2 is Alternate/Discarding, so the broadcast is not sent there.",
    run: (s) => ({ state: bridgeData(s, "c-bcast-sw3", "SW3", "ge-0/0/10", arrived(F.cBcast(), "HOST-C", "SW3")), events: [ev("PACKET_SENT", "c-bcast-sw3", "SW3 floods")] }),
    packet: pkt,
  },
  {
    id: "c-bcast-sw1",
    label: "SW1 floods",
    narrative: "SW1 learns HOST-C → ge-0/0/2 and floods to HOST-A and toward SW2.",
    run: (s) => ({ state: bridgeData(s, "c-bcast-sw1", "SW1", "ge-0/0/2", arrived(F.cBcast(), "SW3", "SW1")), events: [ev("PACKET_SENT", "c-bcast-sw1", "SW1 floods")] }),
    packet: pkt,
  },
  {
    id: "c-bcast-sw2",
    label: "SW2 floods — including toward SW3",
    narrative: "SW2 learns HOST-C → ge-0/0/1 and floods to HOST-B and out ge-0/0/2: SW2's end of the cross-link is Designated/Forwarding, so the copy really is transmitted onto the SW2–SW3 cable.",
    run: (s) => ({ state: bridgeData(s, "c-bcast-sw2", "SW2", "ge-0/0/1", arrived(F.cBcast(), "SW1", "SW2")), events: [ev("PACKET_SENT", "c-bcast-sw2", "SW2 floods")] }),
    packet: pkt,
  },
  {
    id: "predict-alt-data",
    label: "Predict: the copy reaches SW3",
    narrative: "That copy arrives at SW3 on ge-0/0/2 — the Alternate/Discarding port.",
    packet: pkt,
    question: {
      prompt: "Can customer data enter SW3 through its Alternate/Discarding port?",
      options: [
        { id: "no", label: "No — SW3 discards it: no learning, no forwarding; only BPDUs are processed there" },
        { id: "yes", label: "Yes — the link is up, so SW3 forwards it to HOST-C" },
        { id: "learn", label: "SW3 learns the source MAC but doesn't forward" },
        { id: "reflect", label: "SW3 sends it back to SW2" },
      ],
      correctOptionId: "no",
      explanation: "A Discarding port drops customer frames in both directions and does not learn from them. That is exactly what stops the broadcast from going round the triangle, while BPDUs keep the port informed.",
    },
  },
  {
    id: "c-bcast-sw3-discard",
    label: "SW3 discards on the Alternate port",
    narrative: "SW3 drops the copy on ge-0/0/2. HOST-A, HOST-B and HOST-C each received the broadcast once, and nothing loops.",
    run: (s) => ({ state: bridgeData(s, "c-bcast-sw3-discard", "SW3", "ge-0/0/2", arrived(F.cBcast(), "SW2", "SW3")), events: [ev("PACKET_DROPPED", "c-bcast-sw3-discard", "Discarded on Alternate port")] }),
    whatChanged: () => ["Copy dropped on SW3 ge-0/0/2 (Alternate/Discarding)", "Each host got the broadcast once"],
  },
  {
    id: "b-to-c-send",
    label: "HOST-B → HOST-C",
    narrative: "HOST-B sends a unicast frame to HOST-C. The two hosts' switches share a cable — watch which path the frame actually takes.",
    run: (s) => ({ state: hostSend(idle(s), "b-to-c-send", "HOST-B", F.bToC()), events: [ev("PACKET_SENT", "b-to-c-send", "HOST-B → HOST-C")] }),
    packet: pkt,
  },
  {
    id: "b-to-c-sw2",
    label: "SW2 forwards toward the root",
    narrative: "SW2 learned HOST-C behind ge-0/0/1 (the broadcast came that way), so the frame leaves toward SW1 — not across the SW2–SW3 cable.",
    run: (s) => ({ state: bridgeData(s, "b-to-c-sw2", "SW2", "ge-0/0/10", arrived(F.bToC(), "HOST-B", "SW2")), events: [ev("PACKET_SENT", "b-to-c-sw2", "SW2 → SW1")] }),
    packet: pkt,
  },
  {
    id: "b-to-c-sw1",
    label: "SW1 forwards to SW3",
    narrative: "SW1 finds HOST-C behind ge-0/0/2 and forwards to SW3.",
    run: (s) => ({ state: bridgeData(s, "b-to-c-sw1", "SW1", "ge-0/0/1", arrived(F.bToC(), "SW2", "SW1")), events: [ev("PACKET_SENT", "b-to-c-sw1", "SW1 → SW3")] }),
    packet: pkt,
  },
  {
    id: "b-to-c-sw3",
    label: "SW3 delivers to HOST-C",
    narrative: "SW3 delivers on its edge port. Data path: HOST-B → SW2 → SW1 → SW3 → HOST-C. The SW2–SW3 cable exists and carries BPDUs, but no customer data while SW3's end is Alternate.",
    run: (s) => ({ state: bridgeData(s, "b-to-c-sw3", "SW3", "ge-0/0/1", arrived(F.bToC(), "SW1", "SW3")), events: [ev("PACKET_SENT", "b-to-c-sw3", "SW3 → HOST-C")] }),
    packet: pkt,
    whatChanged: () => ["Customer path: SW2 → SW1 → SW3", "Control plane still active on SW2–SW3"],
  },
  {
    id: "predict-after-fail",
    label: "Predict: if SW3 loses its root link",
    narrative: "The SW1–SW3 cable is about to fail. SW3 also hears SW2 on ge-0/0/2: Root SW1, cost 20000.",
    question: {
      prompt: "If SW1–SW3 fails, what happens to SW3's Alternate port toward SW2?",
      options: [
        { id: "root", label: `It becomes SW3's Root Port (cost ${LINK_COST} + ${LINK_COST} = ${LINK_COST * 2}) and forwards after RSTP reconverges` },
        { id: "stays", label: "It stays Alternate — Alternate ports never change" },
        { id: "sw3-root", label: "SW3 becomes root, so the port is Designated" },
        { id: "down", label: "It goes down too, to be safe" },
      ],
      correctOptionId: "root",
      explanation: `An Alternate port is exactly a pre-computed backup path to the root. With the direct link gone, SW2's advertisement (cost ${LINK_COST}) plus the link cost gives ${LINK_COST * 2}, the best SW3 has left.`,
    },
  },
  {
    id: "fail-link",
    label: "The SW1–SW3 link fails",
    narrative: "The SW1–SW3 cable fails. SW1 ge-0/0/2 and SW3 ge-0/0/1 lose link. SW3 has just lost its Root Port.",
    run: (s) => {
      const rx = { ...s.rx, [pk("SW1", "ge-0/0/2")]: undefined, [pk("SW3", "ge-0/0/1")]: undefined };
      const synced = { ...s.synced, [pk("SW1", "ge-0/0/2")]: false, [pk("SW3", "ge-0/0/1")]: false };
      const next: StpState = { ...idle(s), linkUp: { ...s.linkUp, L13: false }, rx, synced };
      const hop = rstpHop(s, next, "fail-link", "SW3", { ingress: "ge-0/0/1", action: "LINK DOWN · ROOT PORT LOST", reason: "SW3's Root Port lost link, and with it the root information it held. RSTP recomputes: the only remaining information about SW1 is what SW2 advertises on ge-0/0/2.", key: "ge-0/0/1 link down", active: "compare" });
      return { state: push(next, hop), events: [ev("STEP_ENTERED", "fail-link", "SW1–SW3 down")] };
    },
    whatChanged: () => ["SW1 ge-0/0/2 and SW3 ge-0/0/1: link down"],
  },
  {
    id: "sw3-reconverge",
    label: "The Alternate takes over",
    narrative: `ge-0/0/2 becomes SW3's Root Port with Root Path Cost ${LINK_COST * 2}. After RSTP reconvergence it is Forwarding. The topology change flushes dynamic MAC entries learned on non-edge ports, so switches relearn over the new tree.`,
    run: (s) => {
      const next = flushNonEdge(synchronize(converge(s)));
      const hop = rstpHop(s, next, "sw3-reconverge", "SW3", { ingress: "ge-0/0/2", action: "ALTERNATE → ROOT · FORWARDING", reason: `The Alternate port already held SW2's information, so it can take over the Root Port role immediately and move to Forwarding once synchronized — no need to wait for timers. Root Path Cost is now ${LINK_COST} + ${LINK_COST} = ${LINK_COST * 2}.`, key: "best remaining vector", active: "state" });
      return { state: push(idle(next), hop), events: [ev("ROUTE_LOOKUP", "sw3-reconverge", "SW3 Root Port via SW2")] };
    },
    whatChanged: (_p, n) => [`SW3: ${rolesLine(n, "SW3")}`, topologyLine(n).split(" · ")[2], "Topology change: dynamic entries on non-edge ports flushed"],
  },
  {
    id: "b-to-c-after-send",
    label: "HOST-B → HOST-C again",
    narrative: "HOST-B sends to HOST-C. SW2's table was flushed by the topology change, so this frame is unknown unicast at SW2.",
    run: (s) => {
      const sent = hostSend(idle(s), "b-to-c-after-send", "HOST-B", F.bToC2());
      return { state: bridgeData(sent, "b-to-c-after-send", "SW2", "ge-0/0/10", arrived(F.bToC2(), "HOST-B", "SW2")), events: [ev("PACKET_SENT", "b-to-c-after-send", "SW2 floods")] };
    },
    packet: pkt,
    whatChanged: () => ["SW2 floods toward SW1 and — now — across SW2–SW3"],
  },
  {
    id: "b-to-c-after-sw3",
    label: "SW3 accepts on its new Root Port",
    narrative: "The copy arrives on SW3 ge-0/0/2, now Root/Forwarding, and SW3 delivers it to HOST-C. The SW2–SW3 cable carries customer data because the tree changed.",
    run: (s) => ({ state: bridgeData(s, "b-to-c-after-sw3", "SW3", "ge-0/0/2", arrived(F.bToC2(), "SW2", "SW3")), events: [ev("PACKET_SENT", "b-to-c-after-sw3", "SW3 → HOST-C")] }),
    packet: pkt,
    whatChanged: () => ["Customer path now: SW2 → SW3"],
  },
  {
    id: "restore-link",
    label: "SW1–SW3 is repaired",
    narrative: "The SW1–SW3 cable is replaced. BPDUs flow again, SW3's direct path (cost 20000) is better than the path via SW2 (40000): ge-0/0/1 becomes Root again and, after RSTP reconverges, ge-0/0/2 returns to Alternate/Discarding.",
    run: (s) => {
      const up: StpState = { ...idle(s), linkUp: { ...s.linkUp, L13: true } };
      const next = flushNonEdge(synchronize(converge(up)));
      const hop = rstpHop(s, next, "restore-link", "SW3", { ingress: "ge-0/0/1", action: "LINK UP · ROLES RESTORED", reason: `SW1's BPDU arrives again on ge-0/0/1 with cost 0: ${LINK_COST} beats ${LINK_COST * 2}. ge-0/0/1 is Root again; ge-0/0/2 now hears better information from SW2 than it would send and returns to Alternate.`, key: "ge-0/0/1 link up", active: "roles" });
      return { state: push(next, hop), events: [ev("STEP_ENTERED", "restore-link", "SW1–SW3 up")] };
    },
    whatChanged: (_p, n) => STP_SWITCHES.map((sw) => `${sw}: ${rolesLine(n, sw)}`),
  },
  {
    id: "incident-intro",
    label: "Incident: an unsafe change",
    narrative: "During a change window someone disables RSTP participation on SW3 ge-0/0/2 (the SW2-facing port) and forces it to forward customer data. This is an intentional, unsafe misconfiguration in the teaching scenario. Soon the helpdesk sees floods of duplicate traffic and unstable MAC tables.",
    run: (s) => {
      const off: StpState = { ...idle(s), rstpOff: [pk("SW3", "ge-0/0/2")], faultActive: true };
      const hop = rstpHop(s, off, "incident-intro", "SW3", { ingress: "ge-0/0/2", action: "RSTP DISABLED ON PORT", reason: "The port no longer sends or processes BPDUs, so RSTP cannot give it a role. It has been forced to forward.", key: "ge-0/0/2 configuration", active: "state" });
      return { state: push(off, hop), events: [ev("STEP_ENTERED", "incident-intro", "RSTP disabled on SW3 ge-0/0/2")] };
    },
    whatChanged: (_p, n) => [`SW3: ${rolesLine(n, "SW3")}`, `SW2: ${rolesLine(n, "SW2")}`],
  },
  {
    id: "incident-bpdu",
    label: "SW2's BPDUs go unheard",
    narrative: "SW2 keeps sending BPDUs on its Designated ge-0/0/2. SW3's ge-0/0/2 no longer takes part in RSTP, so that information is not used to make it Alternate. Nothing tells SW3 to stop forwarding there.",
    run: (s) => {
      const f = bpdu(s, "incident-bpdu", "SW2", "ge-0/0/2");
      const hop = rstpHop(s, s, "incident-bpdu", "SW3", { ingress: "ge-0/0/2", action: "BPDU NOT PROCESSED", reason: "RSTP is not running on this port, so the better information from SW2 never enters SW3's role selection.", key: "BPDU from SW2", frame: f, active: "rx" });
      return { state: push(idle(s), hop, { packet: f }), events: [ev("PACKET_SENT", "incident-bpdu", "BPDU ignored")] };
    },
    packet: pkt,
  },
  {
    id: "loop-send",
    label: "HOST-A broadcasts",
    narrative: "HOST-A sends one ordinary broadcast.",
    run: (s) => {
      const f = F.loop();
      const sent = hostSend(idle(s), "loop-send", "HOST-A", f);
      return { state: { ...sent, inFlight: [{ sw: "SW1", ingress: "ge-0/0/10", frame: arrived(f, "HOST-A", "SW1") }], loop: undefined }, events: [ev("PACKET_SENT", "loop-send", "HOST-A broadcasts")] };
    },
    packet: pkt,
  },
  {
    id: "wave-1",
    label: "Wave 1: SW1 floods",
    narrative: "SW1 floods to SW2 and SW3 — correct so far.",
    run: (s) => ({ state: dataWave(s, "wave-1", ["SW1"], 1), events: [ev("PACKET_SENT", "wave-1", "Wave 1")] }),
    packet: pkt,
  },
  {
    id: "wave-2",
    label: "Wave 2: both ends of the cross-link forward",
    narrative: "SW2 floods its copy to HOST-B and across to SW3; SW3 floods its copy to HOST-C and across to SW2. SW3's ge-0/0/2 forwards and accepts customer data, so both copies cross the SW2–SW3 link — each heading back toward SW1.",
    run: (s) => ({ state: dataWave(s, "wave-2", ["SW2", "SW3"], 2), events: [ev("PACKET_SENT", "wave-2", "Wave 2")] }),
    packet: pkt,
  },
  {
    id: "wave-3",
    label: "Wave 3: the loop is complete",
    narrative: "SW2 and SW3 each receive the other's copy on the cross-link: HOST-B and HOST-C get the broadcast a second time, both switches see HOST-A's source on a different port, and two copies head for SW1 again — which will send them round once more. The visualization stops here for clarity; Ethernet itself has no TTL field that would end this loop.",
    run: (s) => ({ state: dataWave(s, "wave-3", ["SW2", "SW3"], 3), events: [ev("PACKET_SENT", "wave-3", "Wave 3")] }),
    packet: pkt,
    whatChanged: (_p, n) => [`Copies sent: ${n.loop?.framesSent ?? 0}`, `HOST-B ×${n.loop?.received["HOST-B"] ?? 0}, HOST-C ×${n.loop?.received["HOST-C"] ?? 0}`, `MAC moves: ${n.loop?.moves.length ?? 0}`, `Still circulating: ${n.loop?.circulating ?? 0}`],
  },
  {
    id: "trouble-question",
    label: "Diagnose the incident",
    narrative: "All three cables were already in place yesterday without a loop. What changed is one port's configuration.",
    question: {
      prompt: "Why does disabling RSTP participation on SW3's cross-link port recreate the loop?",
      options: [
        { id: "rstp", label: "That port can no longer be made Alternate/Discarding, so all three links forward and the triangle is a loop again" },
        { id: "fdb", label: "The MAC tables filled up and started flooding" },
        { id: "root", label: "SW3 became the root bridge" },
        { id: "ttl", label: "The broadcast's TTL was too high" },
      ],
      correctOptionId: "rstp",
      explanation: "RSTP made the triangle safe by leaving exactly one port on the loop non-forwarding. With RSTP off on that port, nothing can hold it Discarding, the forced-forwarding port carries data, and Ethernet frames have no TTL to stop them.",
    },
  },
  {
    id: "diagnostic-layers",
    label: "Troubleshooting layers",
    narrative: "Walk the layers: cabling, RSTP participation, port roles/states, and customer delivery.",
  },
  {
    id: "repair-challenge",
    label: "Repair the loop protection",
    narrative: "Choose the change that fixes the cause you identified.",
    action: (s, payload) => ({ state: applyStpRepair(s, (payload as { choice: string }).choice), events: [ev("STEP_ENTERED", "repair-challenge", `Repair attempt: ${(payload as { choice: string }).choice}`)] }),
    requiresState: (s) => s.repaired,
  },
  {
    id: "verify-bpdu",
    label: "Verify: SW3 hears SW2 again",
    narrative: `With RSTP running on SW3 ge-0/0/2, SW2's BPDU (Root SW1, cost ${LINK_COST}, Bridge ${bidText(BRIDGES.SW2)}) is processed again. After RSTP reconvergence the port is Alternate/Discarding; the copies still in transit are delivered one last time and every path now ends at an edge port or that discarding port.`,
    run: (s) => ({ state: bpduStep(s, "verify-bpdu", [{ sw: "SW2", port: "ge-0/0/2" }], "ALTERNATE AGAIN", "SW2's better information arrives on a participating port again: SW3 ge-0/0/2 is Alternate/Discarding."), events: [ev("ROUTE_LOOKUP", "verify-bpdu", "SW3 ge-0/0/2 Alternate")] }),
    packet: pkt,
    whatChanged: (_p, n) => [`SW3: ${rolesLine(n, "SW3")}`, "Loop broken"],
  },
  {
    id: "verify-send",
    label: "Verify: one broadcast",
    narrative: "HOST-A broadcasts again.",
    run: (s) => {
      const f = F.verify();
      const sent = hostSend(idle(s), "verify-send", "HOST-A", f);
      return { state: { ...sent, inFlight: [{ sw: "SW1", ingress: "ge-0/0/10", frame: arrived(f, "HOST-A", "SW1") }], loop: undefined }, events: [ev("PACKET_SENT", "verify-send", "HOST-A broadcasts")] };
    },
    packet: pkt,
  },
  {
    id: "verify-sw1",
    label: "Verify: SW1 floods",
    narrative: "SW1 floods to SW2 and SW3.",
    run: (s) => ({ state: dataWave(s, "verify-sw1", ["SW1"], 1), events: [ev("PACKET_SENT", "verify-sw1", "SW1 floods")] }),
    packet: pkt,
  },
  {
    id: "verify-tree",
    label: "Verify: each host once",
    narrative: "SW2 floods to HOST-B and across to SW3; SW3 floods to HOST-C only, and drops SW2's copy on its Alternate/Discarding port. Every host received the broadcast exactly once, and nothing is left circulating.",
    run: (s) => ({ state: dataWave(s, "verify-tree", ["SW2", "SW3"], 2), events: [ev("PACKET_SENT", "verify-tree", "Tree delivery")] }),
    packet: pkt,
    whatChanged: (_p, n) => [`HOST-B ×${n.loop?.received["HOST-B"] ?? 0}, HOST-C ×${n.loop?.received["HOST-C"] ?? 0}`, `Still circulating: ${n.loop?.circulating ?? 0}`],
  },
  {
    id: "stp-vs-lacp",
    label: "What RSTP does — and doesn't",
    narrative: "RSTP turned a physical loop into a loop-free logical tree and brought the backup path in when the primary failed. It does not add bandwidth: the Alternate link carries no customer data until it is needed. Making parallel links act as ONE link is a different problem — link aggregation (the LACP lesson).",
    run: (s) => ({ state: idle(s), events: [] }),
  },
  {
    id: "complete",
    label: "Lesson complete",
    narrative: "Root election by lowest Bridge ID, one Root Port per non-root bridge, a Designated port per segment, an Alternate port held Discarding, fast takeover after a failure — and what happens when a port is taken out of RSTP.",
  },
];

export const fdbRows = (s: StpState, sw: StpSw) => s.fdb[sw].map((e) => ({ label: `${macName(e.mac)} (${e.mac})`, value: e.port }));
