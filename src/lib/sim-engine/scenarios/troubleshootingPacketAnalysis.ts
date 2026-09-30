import type { PacketVisual, PVEvent, PVEventType, ScenarioStep } from "../types";
import type { PacketStackFrame, ProcessingStage } from "@/components/network3d/types";
import type { FundHop } from "@/components/lesson/fundamentalsTrace";
import { fieldIn, flagsName, ip4Frame, tcpField, tcpLength, tcpPacket, type TcpSeg, type TcpWire } from "./enterpriseEdgePackets";
import { withNotes, type NotebookEntry } from "./troubleshootingCommon";

/**
 * Packet Analysis: Read the Evidence — CLIENT — SW1 — R1 — SERVER, one TCP/443 service.
 *
 * Modeled exactly:
 * - Ethernet II + IPv4 + TCP segments built by the shared byte-accurate builders (RFC 791 header checksum, RFC 9293
 *   TCP header, checksum over the RFC 1071 pseudo-header). Flag bytes are real (SYN 0x02, SYN+ACK 0x12, ACK 0x10,
 *   PSH+ACK 0x18, FIN+ACK 0x11). A SYN-ACK acknowledges the client's ISN + 1; data advances the sequence by its length.
 * - The retransmitted SYN reuses the SAME initial sequence number (only the IP Identification changes); the client's
 *   initial retransmission timeout is 1 s (RFC 6298). A server in SYN-RECEIVED that sees the duplicate SYN answers with
 *   another SYN-ACK carrying the same sequence and acknowledgment numbers (as common implementations such as Linux do).
 * - Only R1 routes, so TTL drops by exactly one crossing R1; SW1 forwards frames unchanged; R1 rewrites MACs.
 * - The application bytes on TCP/443 are a teaching abstraction: only their lengths are shown. On a real 443 service they
 *   would be TLS records, which this lesson does not decode or invent.
 * Capture points (clocks synchronized in this lab): CLIENT side = SW1 mirror of the client's access port ge-0/0/1;
 * R1 server side = R1 ge-0/0/1; SERVER = the server's own NIC. Absolute sequence numbers are shown (small ISNs keep the
 * arithmetic readable; real ISNs are random 32-bit values).
 * Incident (truth, never shown before diagnosis): an intermittent drop condition on R1's client-facing egress
 * (ge-0/0/0) discards 1 of every 6 frames queued there (modeled deterministically: the 1st, 7th, 13th … after it
 * starts). The first casualty is the first SYN-ACK of a new connection. No RST is ever sent: the port is open.
 */

export type PaDevice = "CLIENT" | "SW1" | "R1" | "SERVER";
export const PA_DEVICES: PaDevice[] = ["CLIENT", "SW1", "R1", "SERVER"];
export const PA = { client: "10.10.10.10", gw: "10.10.10.1", r1Srv: "10.20.20.1", server: "10.20.20.20", clientLen: 24, serverLen: 24 } as const;
export const PA_MAC = { CLIENT: "00:00:5E:00:53:10", R1_LAN: "00:00:5E:00:53:01", R1_SRV: "00:00:5E:00:53:02", SERVER: "00:00:5E:00:53:20" } as const;
export const BCAST = "FF:FF:FF:FF:FF:FF";
export const SERVICE_PORT = 443;
export const INITIAL_TTL = 64;
export const MSS = 1460;
export const RTO_US = 1_000_000;
export const REQ_LEN = 120;
export const RESP_LEN = 380;
/** The drop condition discards 1 of every DROP_EVERY frames offered to R1 ge-0/0/0 egress while it is active. */
export const DROP_EVERY = 6;

export type FlowId = "healthy" | "incident" | "verify";
export const FLOW: Record<FlowId, { sport: number; isnC: number; isnS: number; t0: number; ipIdC: number; ipIdS: number }> = {
  healthy: { sport: 51000, isnC: 1000, isnS: 5000, t0: 1_000, ipIdC: 0x1a00, ipIdS: 0x5b00 },
  incident: { sport: 51001, isnC: 2000, isnS: 6000, t0: 10_000_000, ipIdC: 0x1b00, ipIdS: 0x5c00 },
  verify: { sport: 51002, isnC: 3000, isnS: 7000, t0: 30_000_000, ipIdC: 0x1c00, ipIdS: 0x5d00 },
};
export const tupleOf = (f: FlowId) => `TCP ${PA.client}:${FLOW[f].sport} ↔ ${PA.server}:${SERVICE_PORT}`;

// Capture points
export type CapId = "client" | "r1" | "server";
export const CAPTURES: { id: CapId; label: string; where: string; device: PaDevice }[] = [
  { id: "client", label: "CLIENT side", where: "SW1 mirror of ge-0/0/1 (CLIENT's access port)", device: "SW1" },
  { id: "r1", label: "R1 server side", where: "R1 ge-0/0/1 (toward SERVER)", device: "R1" },
  { id: "server", label: "SERVER", where: "SERVER eth0 (host capture)", device: "SERVER" },
];
export interface CapRow {
  no: number;
  us: number;
  flow: FlowId | "arp";
  src: string;
  dst: string;
  proto: "TCP" | "ARP";
  info: string;
  ttl?: number;
  ipLen?: number;
  ethSrc: string;
  ethDst: string;
  /** Analysis computed from THIS capture's own earlier rows (like a capture tool's expert info). */
  analysis?: string;
  /** Flow/direction/seq/flags/length signature used to recognize a repeat at this capture point. */
  sig?: string;
}
export const secs = (us: number) => (us / 1_000_000).toFixed(6);

// Interfaces and counters
export interface PaIface {
  device: PaDevice;
  name: string;
  addr?: string;
  mac?: string;
  peer: PaDevice;
  link: string;
}
export const PA_IFACES: PaIface[] = [
  { device: "CLIENT", name: "eth0", addr: `${PA.client}/24`, mac: PA_MAC.CLIENT, peer: "SW1", link: "L-C-SW1" },
  { device: "SW1", name: "ge-0/0/1", peer: "CLIENT", link: "L-C-SW1" },
  { device: "SW1", name: "ge-0/0/24", peer: "R1", link: "L-SW1-R1" },
  { device: "R1", name: "ge-0/0/0", addr: `${PA.gw}/24`, mac: PA_MAC.R1_LAN, peer: "SW1", link: "L-SW1-R1" },
  { device: "R1", name: "ge-0/0/1", addr: `${PA.r1Srv}/24`, mac: PA_MAC.R1_SRV, peer: "SERVER", link: "L-R1-S" },
  { device: "SERVER", name: "eth0", addr: `${PA.server}/24`, mac: PA_MAC.SERVER, peer: "R1", link: "L-R1-S" },
];
export interface Counters {
  inPkts: number;
  outPkts: number;
  outDrops: number;
}
const zero = (): Counters => ({ inPkts: 0, outPkts: 0, outDrops: 0 });
export const ifKey = (d: PaDevice, n: string) => `${d}:${n}`;

// ---------------------------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------------------------
export type HostTcp = "CLOSED" | "LISTEN" | "SYN_SENT" | "SYN_RECEIVED" | "ESTABLISHED" | "FIN_WAIT" | "TIME_WAIT";
export interface FlowResult {
  flow: FlowId;
  synSent: number;
  established?: number;
  synRetransmits: number;
}
export interface PaState {
  hops: FundHop[];
  packet?: PacketVisual;
  flood: { id: string; fromId: string; toId: string; packet: PacketVisual }[];
  captures: Record<CapId, CapRow[]>;
  counters: Record<string, Counters>;
  clientArp: Record<string, string>;
  clientTcp: HostTcp;
  serverTcp: HostTcp;
  flows: Partial<Record<FlowId, FlowResult>>;
  notebook: NotebookEntry[];
  /** Truth: intermittent drop condition on R1 ge-0/0/0 egress, and how many frames it has been offered so far. */
  dropCondition: boolean;
  faultEgress: number;
  decision?: { device: PaDevice; text: string };
  faultActive: boolean;
  repairAttempt?: { choice: string; correct: boolean };
  repaired: boolean;
}
export function createPaState(): PaState {
  const counters: Record<string, Counters> = {};
  for (const i of PA_IFACES) counters[ifKey(i.device, i.name)] = zero();
  return { hops: [], flood: [], captures: { client: [], r1: [], server: [] }, counters, clientArp: {}, clientTcp: "CLOSED", serverTcp: "LISTEN", flows: {}, notebook: [], dropCondition: false, faultEgress: 0, faultActive: false, repaired: false };
}

// ---------------------------------------------------------------------------------------------------------------
// Segments and packets
// ---------------------------------------------------------------------------------------------------------------
export type Dir = "c2s" | "s2c";
export interface SegSpec {
  flow: FlowId;
  dir: Dir;
  seg: TcpSeg;
  /** IP Identification of this datagram. */
  ipId: number;
  /** Time the sender puts it on the wire, µs. */
  t: number;
}
const wireAt = (x: SegSpec, where: "sender" | "after-r1"): TcpWire => {
  const [src, dst] = x.dir === "c2s" ? [PA.client, PA.server] : [PA.server, PA.client];
  return { src, dst, ttl: where === "sender" ? INITIAL_TTL : INITIAL_TTL - 1, ipId: x.ipId, seg: x.seg };
};
/** The frame as it exists on one link (MACs and TTL are what that link actually carries). */
export function segPacket(id: string, x: SegSpec, from: PaDevice, to: PaDevice): PacketVisual {
  const clientSide = from === "CLIENT" || to === "CLIENT" || ((from === "SW1" || to === "SW1") && (from === "R1" || to === "R1"));
  if (x.dir === "c2s") return clientSide ? tcpPacket(id, from, to, PA_MAC.CLIENT, PA_MAC.R1_LAN, wireAt(x, "sender")) : tcpPacket(id, from, to, PA_MAC.R1_SRV, PA_MAC.SERVER, wireAt(x, "after-r1"));
  return clientSide ? tcpPacket(id, from, to, PA_MAC.R1_LAN, PA_MAC.CLIENT, wireAt(x, "after-r1")) : tcpPacket(id, from, to, PA_MAC.SERVER, PA_MAC.R1_SRV, wireAt(x, "sender"));
}
export function arpPacket(id: string, kind: "request" | "reply", from: PaDevice, to: PaDevice): PacketVisual {
  const req = kind === "request";
  return {
    id,
    protocol: "ARP",
    from,
    to,
    broadcast: req,
    badge: "ARP",
    summary: req ? `ARP request — who has ${PA.gw}? tell ${PA.client}` : `ARP reply — ${PA.gw} is at ${PA_MAC.R1_LAN}`,
    layers: [
      { name: "Ethernet II Header", color: "#94a3b8", fields: [{ label: "Destination MAC", value: req ? BCAST : PA_MAC.CLIENT }, { label: "Source MAC", value: req ? PA_MAC.CLIENT : PA_MAC.R1_LAN }, { label: "EtherType", value: "0x0806 (ARP)" }] },
      {
        name: "ARP",
        color: "#f59e0b",
        fields: [
          { label: "Hardware / Protocol", value: "1 (Ethernet) / 0x0800 (IPv4)" },
          { label: "Operation", value: req ? "1 (request)" : "2 (reply)" },
          { label: "Sender MAC", value: req ? PA_MAC.CLIENT : PA_MAC.R1_LAN },
          { label: "Sender IP", value: req ? PA.client : PA.gw },
          { label: "Target MAC", value: req ? "00:00:00:00:00:00" : PA_MAC.CLIENT },
          { label: "Target IP", value: req ? PA.gw : PA.client },
        ],
      },
      { name: "FCS", color: "#94a3b8", fields: [{ label: "Frame Check Sequence", value: "CRC-32 over the frame" }] },
    ],
  };
}
export const isArp = (p: PacketVisual) => p.layers.some((l) => l.name === "ARP");

const flagText = (seg: TcpSeg) => {
  const n = flagsName(seg);
  return n === "SYN-ACK" ? "SYN, ACK" : n === "PSH-ACK" ? "PSH, ACK" : n === "FIN-ACK" ? "FIN, ACK" : n;
};
export const segInfo = (x: SegSpec) => {
  const len = x.seg.payloadLength ?? 0;
  return `${x.seg.sport} → ${x.seg.dport} [${flagText(x.seg)}] Seq=${x.seg.seq}${x.seg.flags.includes("ACK") ? ` Ack=${x.seg.ack}` : ""} Win=64240 Len=${len}${x.seg.mss ? ` MSS=${x.seg.mss}` : ""}`;
};

/** Where each capture point sees a segment (µs after the sender transmits), in path order. */
const OFFSETS: Record<Dir, { cap: CapId; dt: number; ttl: number; eth: [string, string] }[]> = {
  c2s: [
    { cap: "client", dt: 50, ttl: INITIAL_TTL, eth: [PA_MAC.CLIENT, PA_MAC.R1_LAN] },
    { cap: "r1", dt: 300, ttl: INITIAL_TTL - 1, eth: [PA_MAC.R1_SRV, PA_MAC.SERVER] },
    { cap: "server", dt: 400, ttl: INITIAL_TTL - 1, eth: [PA_MAC.R1_SRV, PA_MAC.SERVER] },
  ],
  s2c: [
    { cap: "server", dt: 0, ttl: INITIAL_TTL, eth: [PA_MAC.SERVER, PA_MAC.R1_SRV] },
    { cap: "r1", dt: 100, ttl: INITIAL_TTL, eth: [PA_MAC.SERVER, PA_MAC.R1_SRV] },
    { cap: "client", dt: 350, ttl: INITIAL_TTL - 1, eth: [PA_MAC.R1_LAN, PA_MAC.CLIENT] },
  ],
};

const sigOf = (x: SegSpec) => `${x.flow}|${x.dir}|${x.seg.seq}|${flagText(x.seg)}|${x.seg.payloadLength ?? 0}`;

/**
 * Move one segment through the network and record it at every capture point it actually passes. Truth decides how
 * far it gets: while the drop condition is active, R1 ge-0/0/0 discards 1 of every DROP_EVERY frames offered to it
 * (output-drop counter +1), so such a frame never reaches the CLIENT-side capture. A capture flags "TCP
 * Retransmission" only from ITS OWN earlier rows — as a capture tool does.
 */
function transit(s: PaState, x: SegSpec): { state: PaState; delivered: boolean } {
  const captures = { ...s.captures };
  const counters = { ...s.counters };
  const bump = (k: string, f: keyof Counters) => (counters[k] = { ...counters[k], [f]: counters[k][f] + 1 });
  let faultEgress = s.faultEgress;
  let delivered = true;
  const [src, dst] = x.dir === "c2s" ? [PA.client, PA.server] : [PA.server, PA.client];
  const info = segInfo(x);
  const sig = sigOf(x);
  const ipLen = 20 + tcpLength(x.seg);
  for (const o of OFFSETS[x.dir]) {
    if (x.dir === "s2c" && o.cap === "client") {
      // R1 routes it out ge-0/0/0 toward SW1 / CLIENT.
      if (s.dropCondition) {
        faultEgress += 1;
        if ((faultEgress - 1) % DROP_EVERY === 0) {
          bump(ifKey("R1", "ge-0/0/0"), "outDrops");
          delivered = false;
          break;
        }
      }
      bump(ifKey("R1", "ge-0/0/0"), "outPkts");
    }
    if (x.dir === "c2s" && o.cap === "r1") bump(ifKey("R1", "ge-0/0/1"), "outPkts");
    const rows = captures[o.cap];
    const row: CapRow = { no: rows.length + 1, us: x.t + o.dt, flow: x.flow, src: `${src}:${x.seg.sport}`, dst: `${dst}:${x.seg.dport}`, proto: "TCP", info, ttl: o.ttl, ipLen, ethSrc: o.eth[0], ethDst: o.eth[1], analysis: rows.some((r) => r.sig === sig) ? "TCP Retransmission" : undefined, sig };
    captures[o.cap] = [...rows, row];
  }
  if (x.dir === "c2s") {
    bump(ifKey("CLIENT", "eth0"), "outPkts");
    bump(ifKey("R1", "ge-0/0/0"), "inPkts");
    bump(ifKey("SERVER", "eth0"), "inPkts");
  } else {
    bump(ifKey("SERVER", "eth0"), "outPkts");
    bump(ifKey("R1", "ge-0/0/1"), "inPkts");
    if (delivered) bump(ifKey("CLIENT", "eth0"), "inPkts");
  }
  return { state: { ...s, captures, counters, faultEgress }, delivered };
}

function arpRows(s: PaState, t: number): PaState {
  const rows = s.captures.client;
  const req: CapRow = { no: rows.length + 1, us: t, flow: "arp", src: PA_MAC.CLIENT, dst: BCAST, proto: "ARP", info: `Who has ${PA.gw}? Tell ${PA.client}`, ethSrc: PA_MAC.CLIENT, ethDst: BCAST };
  const rep: CapRow = { no: rows.length + 2, us: t + 180, flow: "arp", src: PA_MAC.R1_LAN, dst: PA_MAC.CLIENT, proto: "ARP", info: `${PA.gw} is at ${PA_MAC.R1_LAN}`, ethSrc: PA_MAC.R1_LAN, ethDst: PA_MAC.CLIENT };
  return { ...s, captures: { ...s.captures, client: [...rows, req, rep] } };
}

// Segment catalog per flow (sequence arithmetic lives here and nowhere else)
const F = FLOW;
export const seg = {
  syn: (f: FlowId, attempt = 0): SegSpec => ({ flow: f, dir: "c2s", seg: { sport: F[f].sport, dport: SERVICE_PORT, seq: F[f].isnC, ack: 0, flags: ["SYN"], mss: MSS }, ipId: F[f].ipIdC + attempt, t: F[f].t0 + attempt * RTO_US }),
  synAck: (f: FlowId, t: number, attempt = 0): SegSpec => ({ flow: f, dir: "s2c", seg: { sport: SERVICE_PORT, dport: F[f].sport, seq: F[f].isnS, ack: F[f].isnC + 1, flags: ["SYN", "ACK"], mss: MSS }, ipId: F[f].ipIdS + attempt, t }),
  ack: (f: FlowId, t: number): SegSpec => ({ flow: f, dir: "c2s", seg: { sport: F[f].sport, dport: SERVICE_PORT, seq: F[f].isnC + 1, ack: F[f].isnS + 1, flags: ["ACK"] }, ipId: F[f].ipIdC + 2, t }),
  req: (f: FlowId, t: number): SegSpec => ({ flow: f, dir: "c2s", seg: { sport: F[f].sport, dport: SERVICE_PORT, seq: F[f].isnC + 1, ack: F[f].isnS + 1, flags: ["PSH", "ACK"], payloadLength: REQ_LEN }, ipId: F[f].ipIdC + 3, t }),
  resp: (f: FlowId, t: number): SegSpec => ({ flow: f, dir: "s2c", seg: { sport: SERVICE_PORT, dport: F[f].sport, seq: F[f].isnS + 1, ack: F[f].isnC + 1 + REQ_LEN, flags: ["PSH", "ACK"], payloadLength: RESP_LEN }, ipId: F[f].ipIdS + 2, t }),
  ack2: (f: FlowId, t: number): SegSpec => ({ flow: f, dir: "c2s", seg: { sport: F[f].sport, dport: SERVICE_PORT, seq: F[f].isnC + 1 + REQ_LEN, ack: F[f].isnS + 1 + RESP_LEN, flags: ["ACK"] }, ipId: F[f].ipIdC + 4, t }),
  finC: (f: FlowId, t: number): SegSpec => ({ flow: f, dir: "c2s", seg: { sport: F[f].sport, dport: SERVICE_PORT, seq: F[f].isnC + 1 + REQ_LEN, ack: F[f].isnS + 1 + RESP_LEN, flags: ["FIN", "ACK"] }, ipId: F[f].ipIdC + 5, t }),
  finS: (f: FlowId, t: number): SegSpec => ({ flow: f, dir: "s2c", seg: { sport: SERVICE_PORT, dport: F[f].sport, seq: F[f].isnS + 1 + RESP_LEN, ack: F[f].isnC + 2 + REQ_LEN, flags: ["FIN", "ACK"] }, ipId: F[f].ipIdS + 3, t }),
  lastAck: (f: FlowId, t: number): SegSpec => ({ flow: f, dir: "c2s", seg: { sport: F[f].sport, dport: SERVICE_PORT, seq: F[f].isnC + 2 + REQ_LEN, ack: F[f].isnS + 2 + RESP_LEN, flags: ["ACK"] }, ipId: F[f].ipIdC + 6, t }),
};

export function paStack(p: PacketVisual): PacketStackFrame[] {
  if (isArp(p))
    return [
      { id: "eth", text: `Ethernet · dst ${fieldIn(p, /^Ethernet/, "Destination MAC")} · src ${fieldIn(p, /^Ethernet/, "Source MAC")} · EtherType 0x0806`, tone: "generic" },
      { id: "arp", text: `ARP · op ${fieldIn(p, /^ARP$/, "Operation").split(" ")[0]} · ${fieldIn(p, /^ARP$/, "Sender IP")} → target ${fieldIn(p, /^ARP$/, "Target IP")}`, tone: "vpn" },
    ];
  return [
    { id: "eth", text: `Ethernet · dst ${fieldIn(p, /^Ethernet/, "Destination MAC")} · src ${fieldIn(p, /^Ethernet/, "Source MAC")} · EtherType 0x0800`, tone: "generic" },
    ip4Frame(p),
    { id: "tcp", text: `TCP · ${tcpField(p, "Source Port")} → ${tcpField(p, "Destination Port")} · ${p.badge} · seq ${tcpField(p, "Sequence Number")} · ack ${tcpField(p, "Acknowledgment Number").split(" ")[0]} · csum ${tcpField(p, "Checksum")}`, tone: "transport" },
  ];
}

// ---------------------------------------------------------------------------------------------------------------
// Stages and hop helpers
// ---------------------------------------------------------------------------------------------------------------
export const HOST_STAGES: ProcessingStage[] = [
  { id: "app", label: "Socket / TCP state machine" },
  { id: "route", label: "Route lookup: on-link or via default gateway" },
  { id: "arp", label: "ARP cache: next-hop MAC" },
  { id: "tx", label: "Build Ethernet + IPv4 + TCP, transmit" },
  { id: "rx", label: "Receive: MAC → IPv4 → TCP (checksum, seq/ack)" },
];
export const SWITCH_STAGES: ProcessingStage[] = [
  { id: "rx", label: "Receive frame on port (FCS checked)" },
  { id: "learn", label: "Learn source MAC" },
  { id: "fwd", label: "Forward by destination MAC (frame unchanged)" },
  { id: "mirror", label: "Mirror copy to the capture (SPAN of ge-0/0/1)" },
];
export const ROUTER_STAGES: ProcessingStage[] = [
  { id: "rx", label: "Receive frame addressed to R1's MAC" },
  { id: "lookup", label: "IPv4 longest-prefix match" },
  { id: "ttl", label: "TTL − 1, header checksum recomputed" },
  { id: "rewrite", label: "ARP next hop, rewrite Ethernet addresses" },
  { id: "tx", label: "Egress queue → transmit (output counters)" },
];
export const STAGES: Record<PaDevice, ProcessingStage[]> = { CLIENT: HOST_STAGES, SERVER: HOST_STAGES, SW1: SWITCH_STAGES, R1: ROUTER_STAGES };
const withDetail = (st: ProcessingStage[], d: Partial<Record<string, string>>) => st.map((x) => (d[x.id] ? { ...x, detail: d[x.id] } : x));
const ev = (type: PVEventType, stepId: string, message: string): PVEvent => ({ type, stepId, timestamp: Date.now(), message });
const idle = (s: PaState): PaState => ({ ...s, packet: undefined, flood: [], decision: undefined });
function hop(stepId: string, device: PaDevice, o: { active: string; details: Partial<Record<string, string>>; lookupType: string; key: string; result: string; action: string; reason: string; input: string; output: string; ingress?: string; egress?: string; next?: PaDevice; before?: PacketVisual; after?: PacketVisual }): FundHop {
  return { stepId, device, stages: withDetail(STAGES[device], o.details), activeStageId: o.active, ingressInterfaceId: o.ingress, egressInterfaceId: o.egress, lookupType: o.lookupType, lookupKey: o.key, lookupResult: o.result, action: o.action, reason: o.reason, input: o.input, output: o.output, nextHopId: o.next, before: o.before ? paStack(o.before) : undefined, after: o.after ? paStack(o.after) : undefined };
}
const csumOf = (p: PacketVisual) => tcpField(p, "Checksum");

/** A packet step whose segment enters the network now: it transits (captures and counters update from truth) and is
 *  animated on the chosen link. */
function segStep(s0: PaState, stepId: string, x: SegSpec, from: PaDevice, to: PaDevice, hops: FundHop[]): PaState {
  const { state } = transit(idle(s0), x);
  return showStep(state, s0.hops, stepId, x, from, to, hops);
}
/** A packet step that shows a segment ALREADY recorded by an earlier step on a later link (no second transit). */
function showStep(s0: PaState, prevHops: FundHop[], stepId: string, x: SegSpec, from: PaDevice, to: PaDevice, hops: FundHop[]): PaState {
  const p = segPacket(`${stepId}-pkt`, x, from, to);
  return { ...idle(s0), hops: [...prevHops, ...hops.map((h) => ({ ...h, before: h.before ?? paStack(p) }))], packet: p };
}
const later = (s: PaState, stepId: string, x: SegSpec, from: PaDevice, to: PaDevice, hops: FundHop[]) => showStep(s, s.hops, stepId, x, from, to, hops);
const clientTx = (stepId: string, x: SegSpec, action: string, reason: string, tcp: string): FundHop => {
  const p = segPacket("", x, "CLIENT", "SW1");
  return hop(stepId, "CLIENT", { active: "tx", egress: "eth0", details: { app: `socket ${tupleOf(x.flow)} · ${tcp}`, route: `${PA.server} not in 10.10.10.0/24 → default gateway ${PA.gw}`, arp: `${PA.gw} → ${PA_MAC.R1_LAN} (cached)`, tx: `${flagsName(x.seg)} seq ${x.seg.seq}${x.seg.flags.includes("ACK") ? ` ack ${x.seg.ack}` : ""} · TTL ${INITIAL_TTL} · TCP csum ${csumOf(p)}` }, lookupType: "CLIENT TCP + routing", key: tupleOf(x.flow), result: `${flagsName(x.seg)} → ${PA.gw} (${PA_MAC.R1_LAN})`, action, reason, input: tcp, output: `${flagsName(x.seg)} on the wire`, next: "SW1", after: p });
};
const sw1Hop = (stepId: string, p: PacketVisual, dir: Dir): FundHop =>
  hop(stepId, "SW1", { active: "mirror", ingress: dir === "c2s" ? "ge-0/0/1" : "ge-0/0/24", egress: dir === "c2s" ? "ge-0/0/24" : "ge-0/0/1", details: { rx: `frame from ${fieldIn(p, /^Ethernet/, "Source MAC")}`, fwd: `dst ${fieldIn(p, /^Ethernet/, "Destination MAC")} → ${dir === "c2s" ? "ge-0/0/24 (R1)" : "ge-0/0/1 (CLIENT)"}`, mirror: "copy to the CLIENT-side capture — the frame itself is not changed" }, lookupType: "SW1 MAC table", key: fieldIn(p, /^Ethernet/, "Destination MAC"), result: dir === "c2s" ? "ge-0/0/24" : "ge-0/0/1", action: "FORWARD + MIRROR", reason: "A switch forwards by MAC without touching IP: TTL, IP addresses and TCP fields leave SW1 exactly as they arrived. The mirror is how the CLIENT-side capture sees this frame.", input: "Ethernet frame", output: "same frame", next: dir === "c2s" ? "R1" : "CLIENT", before: p, after: p });
const r1Fwd = (stepId: string, x: SegSpec, p: PacketVisual): FundHop =>
  hop(stepId, "R1", { active: "tx", ingress: x.dir === "c2s" ? "ge-0/0/0" : "ge-0/0/1", egress: x.dir === "c2s" ? "ge-0/0/1" : "ge-0/0/0", details: { lookup: `${x.dir === "c2s" ? PA.server : PA.client} matches ${x.dir === "c2s" ? "10.20.20.0/24 connected ge-0/0/1" : "10.10.10.0/24 connected ge-0/0/0"}`, ttl: `TTL ${INITIAL_TTL} → ${INITIAL_TTL - 1}`, rewrite: x.dir === "c2s" ? `src ${PA_MAC.R1_SRV} → dst ${PA_MAC.SERVER}` : `src ${PA_MAC.R1_LAN} → dst ${PA_MAC.CLIENT}` }, lookupType: "R1 IPv4 FIB", key: x.dir === "c2s" ? PA.server : PA.client, result: x.dir === "c2s" ? "connected ge-0/0/1" : "connected ge-0/0/0", action: "ROUTE", reason: "R1 is the only routing hop: it decrements TTL (64 → 63), recomputes the IPv4 header checksum and writes new Ethernet addresses. Ports, sequence and acknowledgment numbers pass untouched.", input: `${flagsName(x.seg)} TTL ${INITIAL_TTL}`, output: `${flagsName(x.seg)} TTL ${INITIAL_TTL - 1}`, next: x.dir === "c2s" ? "SERVER" : "SW1", after: p });
const serverRx = (stepId: string, x: SegSpec, from: string, to: string, reason: string): FundHop => hop(stepId, "SERVER", { active: "rx", ingress: "eth0", details: { rx: `${flagsName(x.seg)} seq ${x.seg.seq} · TCP checksum verified`, app: `${from} → ${to}` }, lookupType: "SERVER TCP", key: tupleOf(x.flow), result: to, action: `RX ${flagsName(x.seg)}`, reason, input: `${flagsName(x.seg)} TTL ${INITIAL_TTL - 1}`, output: to });
const serverTx = (stepId: string, x: SegSpec, reason: string): FundHop => {
  const p = segPacket("", x, "SERVER", "R1");
  return hop(stepId, "SERVER", { active: "tx", egress: "eth0", details: { app: `socket ${tupleOf(x.flow)}`, route: `${PA.client} not in 10.20.20.0/24 → gateway ${PA.r1Srv}`, arp: `${PA.r1Srv} → ${PA_MAC.R1_SRV} (cached)`, tx: `${flagsName(x.seg)} seq ${x.seg.seq} ack ${x.seg.ack} · TTL ${INITIAL_TTL} · TCP csum ${csumOf(p)}` }, lookupType: "SERVER TCP + routing", key: tupleOf(x.flow), result: `${flagsName(x.seg)} → ${PA.r1Srv}`, action: `TX ${flagsName(x.seg)}`, reason, input: "TCP state machine", output: `${flagsName(x.seg)} on the wire`, next: "R1", after: p });
};
const clientRx = (stepId: string, x: SegSpec, to: string, reason: string): FundHop => hop(stepId, "CLIENT", { active: "rx", ingress: "eth0", details: { rx: `${flagsName(x.seg)} seq ${x.seg.seq} ack ${x.seg.ack} · TTL ${INITIAL_TTL - 1} · checksum verified`, app: to }, lookupType: "CLIENT TCP", key: tupleOf(x.flow), result: to, action: `RX ${flagsName(x.seg)}`, reason, input: flagsName(x.seg), output: to });
const note = (s: PaState, stepId: string, d: PaDevice, o: { active: string; details: Partial<Record<string, string>>; action: string; reason: string; key: string; result: string }): PaState => ({ ...s, hops: [...s.hops, hop(stepId, d, { ...o, lookupType: `${d} evidence`, input: o.key, output: o.result })] });

// ---------------------------------------------------------------------------------------------------------------
// Repair
// ---------------------------------------------------------------------------------------------------------------
export const PA_REPAIR_OPTIONS = [
  { id: "clear-drop", label: "Clear the drop condition on R1's client-facing egress (ge-0/0/0)" },
  { id: "change-port", label: "Move the server application from TCP/443 to another port" },
  { id: "client-mask", label: "Change CLIENT's subnet mask" },
  { id: "clear-arp", label: "Clear the ARP caches on CLIENT and R1" },
  { id: "restart-dns", label: "Restart the DNS resolver" },
  { id: "raise-mtu", label: "Increase the MTU on R1's interfaces" },
] as const;
export const PA_REPAIR_CORRECT = "clear-drop";
export function applyPaRepair(s: PaState, choice: string): PaState {
  const correct = choice === PA_REPAIR_CORRECT;
  if (!correct) return { ...s, repairAttempt: { choice, correct } };
  return { ...idle(s), dropCondition: false, faultActive: false, repaired: true, repairAttempt: { choice, correct }, decision: { device: "R1", text: "R1 ge-0/0/0: egress drop condition cleared" } };
}

// ---------------------------------------------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------------------------------------------
const pkt = (s: PaState) => s.packet;
const rowsOf = (s: PaState, cap: CapId, f: FlowId) => s.captures[cap].filter((r) => r.flow === f);
export const flowSummary = (s: PaState, cap: CapId, f: FlowId) => rowsOf(s, cap, f).map((r) => r.info.match(/\[(.+?)\]/)?.[1] ?? r.info).join(" · ");
const H = "healthy" as const;
const I = "incident" as const;
const V = "verify" as const;

// Times (µs): each response is sent 50 µs after its trigger arrives at the server; the client answers 50 µs after arrival.
const T = {
  hSynAck: FLOW.healthy.t0 + 450,
  hAck: FLOW.healthy.t0 + 450 + 350 + 50,
  hReq: FLOW.healthy.t0 + 450 + 350 + 100,
  hResp: FLOW.healthy.t0 + 450 + 350 + 100 + 400 + 2000,
  hAck2: FLOW.healthy.t0 + 450 + 350 + 100 + 400 + 2000 + 350 + 50,
  hFinC: FLOW.healthy.t0 + 5000,
  hFinS: FLOW.healthy.t0 + 5000 + 450,
  hLast: FLOW.healthy.t0 + 5000 + 450 + 350 + 50,
  iSynAck: FLOW.incident.t0 + 450,
  iSynAck2: FLOW.incident.t0 + RTO_US + 450,
  iAck: FLOW.incident.t0 + RTO_US + 450 + 350 + 50,
  iReq: FLOW.incident.t0 + RTO_US + 450 + 350 + 100,
  iResp: FLOW.incident.t0 + RTO_US + 450 + 350 + 100 + 400 + 2000,
  vSynAck: FLOW.verify.t0 + 450,
  vAck: FLOW.verify.t0 + 450 + 350 + 50,
  vReq: FLOW.verify.t0 + 450 + 350 + 100,
  vResp: FLOW.verify.t0 + 450 + 350 + 100 + 400 + 2000,
};
export const PA_TIMES = T;

export const paSteps: ScenarioStep<PaState>[] = [
  // ---- Define / Scope -----------------------------------------------------------------------------------------
  {
    id: "intro",
    label: "One client, one service",
    narrative: `CLIENT (${PA.client}/24, gateway ${PA.gw}) reaches SERVER (${PA.server}/24) on TCP/${SERVICE_PORT} through switch SW1 and router R1. Before anything breaks, you will learn to read a healthy conversation — because a capture only means something when you know what normal looks like. The application bytes are a teaching abstraction: only their lengths are shown (on a real 443 service they would be TLS records).`,
    run: (s) => ({ state: withNotes(idle(s), "intro", [{ kind: "observation", text: `Service under test: ${PA.server}:${SERVICE_PORT}/TCP from ${PA.client}`, source: "ticket scope" }]), events: [ev("STEP_ENTERED", "intro", "scope")] }),
  },
  {
    id: "capture-points",
    label: "Where can you look?",
    narrative: "Three capture points, clocks synchronized in this lab: (1) CLIENT side — SW1 mirrors CLIENT's access port ge-0/0/1; (2) R1 server side — R1 ge-0/0/1, facing SERVER; (3) SERVER — a capture on the server's own NIC. Every capture only shows what passed THAT point. Something absent from one capture was not seen there — it may still exist elsewhere.",
    run: (s) => ({ state: withNotes(note(idle(s), "capture-points", "SW1", { active: "mirror", details: { mirror: "SPAN session: ge-0/0/1 both directions → capture" }, action: "CAPTURE POINTS", reason: "Choose capture points that bracket the path. Two captures on either side of a device tell you whether that device passed a packet.", key: "3 capture points", result: "CLIENT side · R1 server side · SERVER" }), "capture-points", [{ kind: "observation", text: "Capture points: CLIENT side (SW1 mirror), R1 ge-0/0/1, SERVER eth0", source: "method" }]), events: [ev("STEP_ENTERED", "capture-points", "captures")] }),
  },
  {
    id: "predict-capture",
    label: "Predict: same packet, two captures",
    narrative: "CLIENT sends one SYN. It is recorded at the CLIENT-side capture and again at the SERVER capture.",
    question: {
      prompt: "Which fields will differ between the CLIENT-side and SERVER copies of that same SYN?",
      options: [
        { id: "ttl-mac", label: "TTL (64 vs 63) and the Ethernet source/destination MACs — R1 routes it in between" },
        { id: "ip", label: "The destination IP address" },
        { id: "seq", label: "The TCP sequence number" },
        { id: "none", label: "Nothing — a packet is identical everywhere" },
      ],
      correctOptionId: "ttl-mac",
      explanation: "R1 is a routing hop: it decrements TTL and writes new MAC addresses. SW1 changes nothing. IP addresses, ports, sequence and acknowledgment numbers are end-to-end and stay the same — that is what lets you match copies of one packet across captures.",
    },
  },
  // ---- Baseline -----------------------------------------------------------------------------------------------
  {
    id: "base-arp-req",
    label: "Baseline: ARP for the gateway",
    narrative: `${PA.server} is not in CLIENT's 10.10.10.0/24, so the next hop is the gateway ${PA.gw}. CLIENT has no MAC for it yet and broadcasts an ARP request (EtherType 0x0806). ARP never leaves the LAN — only the CLIENT-side capture can see it.`,
    run: (s) => {
      const p = arpPacket("base-arp-req-pkt", "request", "CLIENT", "SW1");
      const n = arpRows(idle(s), FLOW.healthy.t0 - 400);
      const h = hop("base-arp-req", "CLIENT", { active: "arp", egress: "eth0", details: { route: `${PA.server} → via ${PA.gw}`, arp: `${PA.gw}: no entry → ARP request (broadcast)` }, lookupType: "CLIENT ARP cache", key: PA.gw, result: "miss", action: "ARP REQUEST", reason: "A host resolves the MAC of its NEXT HOP, not of the final destination. The server is remote, so the next hop is the gateway.", input: `next hop ${PA.gw}`, output: `ARP who-has ${PA.gw}`, next: "SW1", after: p });
      return { state: { ...n, hops: [...s.hops, h], packet: p }, events: [ev("PACKET_SENT", "base-arp-req", "ARP request")] };
    },
    packet: pkt,
  },
  {
    id: "base-arp-rep",
    label: "Baseline: ARP reply",
    narrative: `R1 answers with a unicast ARP reply: ${PA.gw} is at ${PA_MAC.R1_LAN}. CLIENT caches it. Every IPv4 frame CLIENT sends to any remote host will now carry this destination MAC.`,
    run: (s) => {
      const p = arpPacket("base-arp-rep-pkt", "reply", "SW1", "CLIENT");
      const h = hop("base-arp-rep", "CLIENT", { active: "arp", ingress: "eth0", details: { arp: `learn ${PA.gw} → ${PA_MAC.R1_LAN}` }, lookupType: "CLIENT ARP cache", key: PA.gw, result: PA_MAC.R1_LAN, action: "ARP LEARN", reason: "The ARP reply is unicast back to the asker. The cache entry lets CLIENT build Ethernet frames for the gateway.", input: "ARP reply", output: "cache updated", before: p });
      return { state: { ...idle(s), hops: [...s.hops, h], packet: p, clientArp: { [PA.gw]: PA_MAC.R1_LAN } }, events: [ev("PACKET_SENT", "base-arp-rep", "ARP reply")] };
    },
    packet: pkt,
  },
  {
    id: "base-syn",
    label: "Baseline: SYN",
    narrative: `CLIENT opens a connection from port ${FLOW.healthy.sport}: a SYN with sequence ${FLOW.healthy.isnC} (its initial sequence number) and an MSS option. No ACK flag — there is nothing to acknowledge yet. Flags byte 0x02.`,
    run: (s) => {
      const x = seg.syn(H);
      const p = segPacket("", x, "CLIENT", "SW1");
      return { state: { ...segStep(s, "base-syn", x, "CLIENT", "SW1", [clientTx("base-syn", x, "TX SYN", "connect() starts the three-way handshake: SYN carries the client's initial sequence number.", "CLOSED → SYN_SENT"), sw1Hop("base-syn", p, "c2s")]), clientTcp: "SYN_SENT", flows: { ...s.flows, healthy: { flow: H, synSent: x.t, synRetransmits: 0 } } }, events: [ev("PACKET_SENT", "base-syn", "SYN")] };
    },
    packet: pkt,
  },
  {
    id: "q-syn",
    label: "Question: SYN without ACK",
    narrative: "Look at the SYN in the packet inspector: Flags 0x02 (SYN), Acknowledgment Number not set.",
    question: {
      prompt: "What does a SYN without the ACK flag mean?",
      options: [
        { id: "open", label: "The sender is opening a new connection — it has nothing to acknowledge yet" },
        { id: "refused", label: "The connection was refused" },
        { id: "data", label: "The sender is transmitting application data" },
        { id: "close", label: "The sender is closing the connection" },
      ],
      correctOptionId: "open",
      explanation: "A bare SYN is the first segment of a handshake. Its sequence number is the sender's ISN. It carries no data and acknowledges nothing.",
    },
  },
  {
    id: "base-syn-srv",
    label: "Baseline: SYN reaches SERVER",
    narrative: "R1 routes the SYN out ge-0/0/1: TTL 64 → 63, new MAC addresses, same IP addresses, ports and sequence number. The R1-side and SERVER captures record it; SERVER moves from LISTEN to SYN_RECEIVED.",
    run: (s) => {
      const x = seg.syn(H);
      const p = segPacket("", x, "R1", "SERVER");
      return { state: { ...later(s, "base-syn-srv", x, "R1", "SERVER", [r1Fwd("base-syn-srv", x, p), serverRx("base-syn-srv", x, "LISTEN", "SYN_RECEIVED", "A SYN for a listening port moves the server to SYN_RECEIVED; it will answer with SYN-ACK.")]), serverTcp: "SYN_RECEIVED" }, events: [ev("PACKET_SENT", "base-syn-srv", "SYN at server")] };
    },
    packet: pkt,
  },
  {
    id: "base-synack",
    label: "Baseline: SYN-ACK",
    narrative: `SERVER answers with SYN-ACK: its own ISN ${FLOW.healthy.isnS} and Acknowledgment ${FLOW.healthy.isnC + 1} — the client's ISN + 1, because a SYN consumes one sequence number. Flags 0x12.`,
    run: (s) => {
      const x = seg.synAck(H, T.hSynAck);
      return { state: segStep(s, "base-synack", x, "SERVER", "R1", [serverTx("base-synack", x, "The SYN-ACK proves the port is open: a listening application accepted the SYN. It acknowledges ISN + 1 and offers the server's own ISN.")]), events: [ev("PACKET_SENT", "base-synack", "SYN-ACK")] };
    },
    packet: pkt,
  },
  {
    id: "q-synack",
    label: "Question: what SYN-ACK tells you",
    narrative: `The SYN-ACK: Seq ${FLOW.healthy.isnS}, Ack ${FLOW.healthy.isnC + 1}.`,
    question: {
      prompt: "What does this SYN-ACK tell you?",
      options: [
        { id: "listening", label: "The server received the SYN, the port is listening, and it acknowledges the client's ISN + 1" },
        { id: "established", label: "The connection is fully established on both sides" },
        { id: "data", label: "The server has sent application data" },
        { id: "client", label: "The client accepted the server's connection" },
      ],
      correctOptionId: "listening",
      explanation: "SYN+ACK is the second handshake segment. The client still has to acknowledge the server's ISN before both sides are ESTABLISHED.",
    },
  },
  {
    id: "base-synack-cl",
    label: "Baseline: SYN-ACK reaches CLIENT",
    narrative: "R1 routes the SYN-ACK back out ge-0/0/0 (TTL 64 → 63). The CLIENT-side capture records it with TTL 63 — the SERVER capture showed TTL 64. Same packet, different capture point.",
    run: (s) => {
      const x = seg.synAck(H, T.hSynAck);
      const p = segPacket("", x, "SW1", "CLIENT");
      const n = later(s, "base-synack-cl", x, "SW1", "CLIENT", [r1Fwd("base-synack-cl", x, segPacket("", x, "R1", "SW1")), sw1Hop("base-synack-cl", p, "s2c"), clientRx("base-synack-cl", x, "SYN_SENT → ESTABLISHED (after sending ACK)", "The SYN-ACK acknowledges the client's SYN. The client will ACK the server's ISN + 1.")]);
      return { state: n, events: [ev("PACKET_SENT", "base-synack-cl", "SYN-ACK at client")] };
    },
    packet: pkt,
  },
  {
    id: "base-ack",
    label: "Baseline: ACK — established",
    narrative: `CLIENT completes the handshake: ACK ${FLOW.healthy.isnS + 1}. Both sides are ESTABLISHED. The handshake took ${((T.hAck - FLOW.healthy.t0) / 1000).toFixed(2)} ms from SYN to ACK at the CLIENT-side capture — remember that number.`,
    run: (s) => {
      const x = seg.ack(H, T.hAck);
      const p = segPacket("", x, "CLIENT", "SW1");
      const n = segStep(s, "base-ack", x, "CLIENT", "SW1", [clientTx("base-ack", x, "TX ACK", "The third handshake segment acknowledges the server's ISN + 1.", "SYN_SENT → ESTABLISHED"), sw1Hop("base-ack", p, "c2s")]);
      return { state: withNotes({ ...n, clientTcp: "ESTABLISHED", serverTcp: "ESTABLISHED", flows: { ...n.flows, healthy: { ...n.flows.healthy!, established: x.t } } }, "base-ack", [{ kind: "observation", text: `Healthy handshake: SYN → SYN-ACK → ACK in ${((T.hAck - FLOW.healthy.t0) / 1000).toFixed(2)} ms, no retransmissions`, source: "CLIENT-side capture" }]), events: [ev("PACKET_SENT", "base-ack", "ACK")] };
    },
    packet: pkt,
  },
  {
    id: "base-req",
    label: "Baseline: client request",
    narrative: `CLIENT sends ${REQ_LEN} bytes (PSH, ACK). Sequence ${FLOW.healthy.isnC + 1}: the first byte of data takes the sequence number right after the SYN. The receive window field (64240) tells the server how much more it may send before waiting.`,
    run: (s) => {
      const x = seg.req(H, T.hReq);
      const p = segPacket("", x, "CLIENT", "SW1");
      return { state: segStep(s, "base-req", x, "CLIENT", "SW1", [clientTx("base-req", x, "TX DATA", `${REQ_LEN} application bytes. The next sequence number will be ${FLOW.healthy.isnC + 1 + REQ_LEN}.`, "ESTABLISHED"), sw1Hop("base-req", p, "c2s")]), events: [ev("PACKET_SENT", "base-req", "request")] };
    },
    packet: pkt,
  },
  {
    id: "base-resp",
    label: "Baseline: server response",
    narrative: `SERVER answers with ${RESP_LEN} bytes. Its Acknowledgment is ${FLOW.healthy.isnC + 1 + REQ_LEN}: "I have every byte up to ${FLOW.healthy.isnC + REQ_LEN}; send ${FLOW.healthy.isnC + 1 + REQ_LEN} next."`,
    run: (s) => {
      const x = seg.resp(H, T.hResp);
      // The request itself also crossed to the server before this response; its rows are already recorded by base-req.
      return { state: segStep(s, "base-resp", x, "SERVER", "R1", [serverTx("base-resp", x, `Response data. ACK ${x.seg.ack} acknowledges all ${REQ_LEN} request bytes.`)]), events: [ev("PACKET_SENT", "base-resp", "response")] };
    },
    packet: pkt,
  },
  {
    id: "q-seqack",
    label: "Question: sequence vs acknowledgment",
    narrative: `Request: Seq ${FLOW.healthy.isnC + 1}, Len ${REQ_LEN}. Response: Ack ${FLOW.healthy.isnC + 1 + REQ_LEN}.`,
    question: {
      prompt: `Why is the server's Acknowledgment Number ${FLOW.healthy.isnC + 1 + REQ_LEN}?`,
      options: [
        { id: "next", label: `It is the next byte the server expects: ${FLOW.healthy.isnC + 1} + ${REQ_LEN} bytes received` },
        { id: "count", label: "It counts packets received so far" },
        { id: "random", label: "It is a random number chosen by the server" },
        { id: "window", label: "It is the server's receive window" },
      ],
      correctOptionId: "next",
      explanation: "Sequence numbers count bytes, not packets. An acknowledgment names the next byte expected, so it acknowledges everything before it cumulatively.",
    },
  },
  {
    id: "base-ack2",
    label: "Baseline: client acknowledges",
    narrative: `CLIENT acknowledges the response: ACK ${FLOW.healthy.isnS + 1 + RESP_LEN}. Every byte both ways is now accounted for.`,
    run: (s) => {
      const x = seg.ack2(H, T.hAck2);
      const p = segPacket("", x, "CLIENT", "SW1");
      return { state: segStep(s, "base-ack2", x, "CLIENT", "SW1", [clientTx("base-ack2", x, "TX ACK", `Cumulative ACK of all ${RESP_LEN} response bytes.`, "ESTABLISHED"), sw1Hop("base-ack2", p, "c2s")]), events: [ev("PACKET_SENT", "base-ack2", "ACK")] };
    },
    packet: pkt,
  },
  {
    id: "base-fin",
    label: "Baseline: client closes",
    narrative: "CLIENT is done and sends FIN, ACK (flags 0x11). A FIN consumes one sequence number, just like a SYN.",
    run: (s) => {
      const x = seg.finC(H, T.hFinC);
      const p = segPacket("", x, "CLIENT", "SW1");
      return { state: { ...segStep(s, "base-fin", x, "CLIENT", "SW1", [clientTx("base-fin", x, "TX FIN", "Orderly close: FIN says 'no more data from me'.", "ESTABLISHED → FIN_WAIT"), sw1Hop("base-fin", p, "c2s")]), clientTcp: "FIN_WAIT" }, events: [ev("PACKET_SENT", "base-fin", "FIN")] };
    },
    packet: pkt,
  },
  {
    id: "base-fin-srv",
    label: "Baseline: server closes",
    narrative: `SERVER acknowledges the FIN (Ack ${FLOW.healthy.isnC + 2 + REQ_LEN}) and closes its own side with FIN, ACK.`,
    run: (s) => {
      const x = seg.finS(H, T.hFinS);
      return { state: { ...segStep(s, "base-fin-srv", x, "SERVER", "R1", [serverTx("base-fin-srv", x, "The server acknowledges the client's FIN and sends its own.")]), serverTcp: "CLOSED" }, events: [ev("PACKET_SENT", "base-fin-srv", "FIN")] };
    },
    packet: pkt,
  },
  {
    id: "base-last-ack",
    label: "Baseline: final ACK",
    narrative: `CLIENT sends the final ACK (${FLOW.healthy.isnS + 2 + RESP_LEN}). A clean conversation: no retransmissions, no resets, every byte acknowledged. Keep this capture as your baseline.`,
    run: (s) => {
      const x = seg.lastAck(H, T.hLast);
      const p = segPacket("", x, "CLIENT", "SW1");
      const n = segStep(s, "base-last-ack", x, "CLIENT", "SW1", [clientTx("base-last-ack", x, "TX ACK", "The last segment of an orderly close.", "FIN_WAIT → TIME_WAIT"), sw1Hop("base-last-ack", p, "c2s")]);
      const segs = rowsOf(n, "client", H).length;
      return { state: withNotes({ ...n, clientTcp: "CLOSED", serverTcp: "LISTEN" }, "base-last-ack", [{ kind: "observation", text: `Baseline flow 51000: ${segs} TCP segments, 0 retransmissions, orderly FIN close`, source: "all three captures" }]), events: [ev("PACKET_SENT", "base-last-ack", "ACK")] };
    },
    packet: pkt,
  },
  {
    id: "q-flow",
    label: "Question: one flow",
    narrative: "The captures now hold ARP frames and TCP segments in both directions.",
    question: {
      prompt: "How do you decide which packets belong to the same TCP connection?",
      options: [
        { id: "tuple", label: `The five-tuple: protocol TCP, ${PA.client}:${FLOW.healthy.sport} and ${PA.server}:${SERVICE_PORT} — in either direction` },
        { id: "mac", label: "The same destination MAC address" },
        { id: "time", label: "Packets captured within the same second" },
        { id: "ttl", label: "The same TTL value" },
      ],
      correctOptionId: "tuple",
      explanation: "A flow is identified by protocol plus source/destination address and port. Replies swap source and destination but belong to the same five-tuple. MACs and TTLs change hop by hop.",
    },
  },
  // ---- Incident -----------------------------------------------------------------------------------------------
  {
    id: "incident-intro",
    label: "Incident: slow to connect",
    narrative: "A user reports: 'sometimes the service takes over a second to open, then works normally'. That is a symptom, not a diagnosis. Capture first; decide later. A new connection starts from port 51001.",
    run: (s) => ({ state: withNotes({ ...idle(s), faultActive: true, dropCondition: true, faultEgress: 0 }, "incident-intro", [{ kind: "symptom", text: "Intermittent: connection sometimes takes > 1 s to open, then works", source: "user report" }]), events: [ev("STEP_ENTERED", "incident-intro", "incident")] }),
  },
  {
    id: "inc-syn",
    label: "SYN (port 51001)",
    narrative: `t = ${secs(FLOW.incident.t0 + 50)} s at the CLIENT-side capture: SYN, sequence ${FLOW.incident.isnC}.`,
    run: (s) => {
      const x = seg.syn(I);
      const p = segPacket("", x, "CLIENT", "SW1");
      return { state: { ...segStep(s, "inc-syn", x, "CLIENT", "SW1", [clientTx("inc-syn", x, "TX SYN", "A new connection: SYN with the client's ISN.", "CLOSED → SYN_SENT"), sw1Hop("inc-syn", p, "c2s")]), clientTcp: "SYN_SENT", flows: { ...s.flows, incident: { flow: I, synSent: x.t, synRetransmits: 0 } } }, events: [ev("PACKET_SENT", "inc-syn", "SYN")] };
    },
    packet: pkt,
  },
  {
    id: "inc-syn-srv",
    label: "SYN at SERVER",
    narrative: "The SYN crosses R1. Both the R1-side and SERVER captures record it. SERVER moves to SYN_RECEIVED.",
    run: (s) => {
      const x = seg.syn(I);
      const p = segPacket("", x, "R1", "SERVER");
      return { state: { ...later(s, "inc-syn-srv", x, "R1", "SERVER", [r1Fwd("inc-syn-srv", x, p), serverRx("inc-syn-srv", x, "LISTEN", "SYN_RECEIVED", "The port is listening; SERVER will answer.")]), serverTcp: "SYN_RECEIVED" }, events: [ev("PACKET_SENT", "inc-syn-srv", "SYN at server")] };
    },
    packet: pkt,
  },
  {
    id: "inc-synack",
    label: "SYN-ACK leaves SERVER",
    narrative: `SERVER sends SYN-ACK (Seq ${FLOW.incident.isnS}, Ack ${FLOW.incident.isnC + 1}). The SERVER capture and the R1-side capture both record it heading back toward CLIENT.`,
    run: (s) => {
      const x = seg.synAck(I, T.iSynAck);
      return { state: segStep(s, "inc-synack", x, "SERVER", "R1", [serverTx("inc-synack", x, "The server did its job: SYN-ACK for the open port.")]), events: [ev("PACKET_SENT", "inc-synack", "SYN-ACK")] };
    },
    packet: pkt,
  },
  {
    id: "inc-wait",
    label: "CLIENT waits",
    narrative: "Nothing arrives at the CLIENT-side capture. CLIENT stays in SYN_SENT; its retransmission timer (1 s for a SYN) is running. Look at the three captures before reading on.",
    run: (s) => ({ state: withNotes(note(idle(s), "inc-wait", "CLIENT", { active: "app", details: { app: "SYN_SENT · retransmission timer 1.000 s running · no segment received for this socket" }, action: "WAITING", reason: "TCP cannot tell 'my SYN was lost' from 'the answer was lost': it only knows nothing came back before the timer expired.", key: tupleOf(I), result: "no SYN-ACK received" }), "inc-wait", [{ kind: "observation", text: "CLIENT-side capture: SYN at 10.000050, then nothing for flow 51001", source: "CLIENT-side capture" }]), events: [ev("STEP_ENTERED", "inc-wait", "waiting")] }),
  },
  {
    id: "inc-syn-retx",
    label: "SYN again, 1 s later",
    narrative: `t = ${secs(FLOW.incident.t0 + RTO_US + 50)} s: CLIENT sends a SYN with the SAME sequence number ${FLOW.incident.isnC} and the same ports — only the IP Identification differs. The CLIENT-side capture flags it as a retransmission.`,
    run: (s) => {
      const x = seg.syn(I, 1);
      const p = segPacket("", x, "CLIENT", "SW1");
      return { state: { ...segStep(s, "inc-syn-retx", x, "CLIENT", "SW1", [clientTx("inc-syn-retx", x, "RETRANSMIT SYN", "The retransmission timer expired with no SYN-ACK, so the client resends the identical SYN (same ISN). It does not start a new connection.", "SYN_SENT (retransmission 1)"), sw1Hop("inc-syn-retx", p, "c2s")]), flows: { ...s.flows, incident: { ...s.flows.incident!, synRetransmits: 1 } } }, events: [ev("PACKET_SENT", "inc-syn-retx", "SYN retransmission")] };
    },
    packet: pkt,
  },
  {
    id: "q-retx",
    label: "Question: spotting a retransmission",
    narrative: "Compare the two SYNs of flow 51001 at the CLIENT-side capture.",
    question: {
      prompt: "What evidence shows the second SYN is a retransmission, not a new connection?",
      options: [
        { id: "same", label: "Same five-tuple and same sequence number, about one retransmission timeout (1 s) later" },
        { id: "ipid", label: "A different IP Identification value" },
        { id: "ttl", label: "A different TTL" },
        { id: "flag", label: "It carries a special retransmit flag in the TCP header" },
      ],
      correctOptionId: "same",
      explanation: "TCP has no retransmit flag. A capture tool infers it: same flow, same sequence, same flags, seen again. A new connection would use a new source port and a new ISN.",
    },
  },
  {
    id: "inc-syn-retx-srv",
    label: "SERVER sees the SYN again",
    narrative: "The retransmitted SYN crosses R1. At the SERVER capture it is the second SYN with sequence 2000 — so the SERVER capture flags it as a retransmission too. SERVER is still in SYN_RECEIVED: it already answered the first SYN.",
    run: (s) => {
      const x = seg.syn(I, 1);
      const p = segPacket("", x, "R1", "SERVER");
      const n = later(s, "inc-syn-retx-srv", x, "R1", "SERVER", [r1Fwd("inc-syn-retx-srv", x, p), serverRx("inc-syn-retx-srv", x, "SYN_RECEIVED", "SYN_RECEIVED (duplicate SYN)", "A duplicate of a SYN it already answered: the server's SYN-ACK evidently did not arrive, so it answers again.")]);
      return { state: withNotes(n, "inc-syn-retx-srv", [{ kind: "observation", text: "SERVER capture: SYN 10.000400, SYN-ACK 10.000450, SYN again 11.000400", source: "SERVER capture" }]), events: [ev("PACKET_SENT", "inc-syn-retx-srv", "duplicate SYN")] };
    },
    packet: pkt,
  },
  {
    id: "q-server-got",
    label: "Question: did the first SYN arrive?",
    narrative: "CLIENT retransmitted its SYN.",
    question: {
      prompt: "Does the repeated SYN prove the server never received the first SYN?",
      options: [
        { id: "no", label: "No — the client only knows it got no SYN-ACK; the SYN or the SYN-ACK could have been lost" },
        { id: "yes", label: "Yes — a retransmitted SYN always means the first SYN was lost" },
        { id: "closed", label: "Yes — it means the port was closed" },
        { id: "dns", label: "It proves a DNS failure" },
      ],
      correctOptionId: "no",
      explanation: "Retransmission tells you the sender got no answer in time. The SERVER capture settles which direction failed: the first SYN arrived and a SYN-ACK went out.",
    },
  },
  {
    id: "inc-synack2",
    label: "SERVER answers again",
    narrative: `SERVER sends SYN-ACK again — the same Seq ${FLOW.incident.isnS} and Ack ${FLOW.incident.isnC + 1}. The SERVER and R1-side captures label it a retransmission: they already saw this SYN-ACK once.`,
    run: (s) => {
      const x = seg.synAck(I, T.iSynAck2, 1);
      return { state: segStep(s, "inc-synack2", x, "SERVER", "R1", [serverTx("inc-synack2", x, "Answering the duplicate SYN with the same SYN-ACK (same sequence and acknowledgment numbers).")]), events: [ev("PACKET_SENT", "inc-synack2", "SYN-ACK again")] };
    },
    packet: pkt,
  },
  {
    id: "inc-synack2-cl",
    label: "SYN-ACK reaches CLIENT",
    narrative: "This time the SYN-ACK arrives. At the CLIENT-side capture it is the FIRST SYN-ACK of flow 51001, so it is NOT flagged as a retransmission there — the same packet the SERVER capture called a retransmission.",
    run: (s) => {
      const x = seg.synAck(I, T.iSynAck2, 1);
      const p = segPacket("", x, "SW1", "CLIENT");
      const n = later(s, "inc-synack2-cl", x, "SW1", "CLIENT", [r1Fwd("inc-synack2-cl", x, segPacket("", x, "R1", "SW1")), sw1Hop("inc-synack2-cl", p, "s2c"), clientRx("inc-synack2-cl", x, "SYN_SENT → ESTABLISHED (after ACK)", "The first SYN-ACK this client has seen for the connection.")]);
      return { state: n, events: [ev("PACKET_SENT", "inc-synack2-cl", "SYN-ACK at client")] };
    },
    packet: pkt,
  },
  {
    id: "inc-ack",
    label: "ACK — established, late",
    narrative: `CLIENT sends ACK; the connection is ESTABLISHED about ${((T.iAck - FLOW.incident.t0) / 1_000_000).toFixed(3)} s after the first SYN, then the request and response flow normally. Symptom reproduced: a slow open, then normal behavior.`,
    run: (s) => {
      const x = seg.ack(I, T.iAck);
      const p = segPacket("", x, "CLIENT", "SW1");
      let n = segStep(s, "inc-ack", x, "CLIENT", "SW1", [clientTx("inc-ack", x, "TX ACK", "Handshake completes — one retransmission timeout late.", "SYN_SENT → ESTABLISHED"), sw1Hop("inc-ack", p, "c2s")]);
      n = transit(n, seg.req(I, T.iReq)).state;
      n = transit(n, seg.resp(I, T.iResp)).state;
      return { state: withNotes({ ...n, clientTcp: "ESTABLISHED", serverTcp: "ESTABLISHED", flows: { ...n.flows, incident: { ...n.flows.incident!, established: x.t } } }, "inc-ack", [{ kind: "observation", text: `Flow 51001 established after ${((T.iAck - FLOW.incident.t0) / 1_000_000).toFixed(3)} s with 1 SYN retransmission; data then normal`, source: "CLIENT-side capture" }]), events: [ev("PACKET_SENT", "inc-ack", "ACK")] };
    },
    packet: pkt,
  },
  // ---- Diagnose -----------------------------------------------------------------------------------------------
  {
    id: "compare-captures",
    label: "Line up the three captures",
    narrative: "Put flow 51001 side by side. SERVER capture: SYN, SYN-ACK, SYN (retransmission), SYN-ACK (retransmission). R1-side capture: the same four, in the same order. CLIENT-side capture: SYN, SYN (retransmission), SYN-ACK — the first SYN-ACK is missing there. Open the capture panel and check each row yourself.",
    run: (s) => ({ state: withNotes(note(idle(s), "compare-captures", "R1", { active: "rx", details: { rx: `R1-side capture, flow 51001: ${flowSummary(s, "r1", I)}` }, action: "CORRELATE", reason: "Match rows across captures by five-tuple plus sequence/acknowledgment numbers — never by MAC or TTL, which change at R1.", key: "flow 51001", result: "first SYN-ACK: seen at SERVER and R1-side, absent at CLIENT side" }), "compare-captures", [
      { kind: "observation", text: `SERVER: ${flowSummary(s, "server", I)}`, source: "SERVER capture" },
      { kind: "observation", text: `R1 server side: ${flowSummary(s, "r1", I)}`, source: "R1 ge-0/0/1 capture" },
      { kind: "observation", text: `CLIENT side: ${flowSummary(s, "client", I)}`, source: "CLIENT-side capture" },
      { kind: "inference", text: "The first SYN arrived and was answered; the first SYN-ACK passed R1's server-facing interface but never reached the CLIENT-side capture" },
    ]), events: [ev("STEP_ENTERED", "compare-captures", "correlate")] }),
  },
  {
    id: "q-which-capture",
    label: "Question: proof of a response",
    narrative: "Three captures, one missing SYN-ACK.",
    question: {
      prompt: "Which capture point proves the server generated a response to the first SYN?",
      options: [
        { id: "server", label: "The SERVER capture (and the R1-side capture) — both show the first SYN-ACK leaving toward CLIENT" },
        { id: "client", label: "The CLIENT-side capture" },
        { id: "none", label: "None — a retransmitted SYN means no response was ever sent" },
        { id: "arp", label: "The ARP exchange at the start" },
      ],
      correctOptionId: "server",
      explanation: "The SYN-ACK at 10.000450 on the SERVER capture — and at 10.000550 on R1 ge-0/0/1 — shows a response existed. The CLIENT-side capture can only show that it never arrived there.",
    },
  },
  {
    id: "q-missing",
    label: "Question: a missing packet",
    narrative: "The first SYN-ACK is present on R1 ge-0/0/1 and absent from the CLIENT-side capture.",
    question: {
      prompt: "What can you conclude from a packet missing at one capture point?",
      options: [
        { id: "between", label: "It was not seen there; with the client's retransmission as corroboration, it was lost between R1's server side and the CLIENT side" },
        { id: "never", label: "The packet never existed anywhere" },
        { id: "server", label: "The server must be down" },
        { id: "closed", label: "The port is closed" },
      ],
      correctOptionId: "between",
      explanation: "Absence is evidence only for the place you looked. A capture can miss packets itself (a busy mirror session can drop copies). Here the client's own behavior — retransmitting because nothing arrived — agrees with the capture, so the loss is real and lies between the two observation points.",
    },
  },
  {
    id: "q-closed",
    label: "Question: a closed port",
    narrative: "The first hypothesis on the ticket was 'port 443 is closed'.",
    question: {
      prompt: "How would a closed TCP port look different in these captures?",
      options: [
        { id: "rst", label: "SERVER would answer the SYN immediately with RST, ACK — no SYN-ACK, no waiting, no retransmission" },
        { id: "same", label: "Exactly like this: silence, then a retransmitted SYN" },
        { id: "icmp", label: "SERVER would send a SYN-ACK with a zero window" },
        { id: "arp", label: "SERVER would stop answering ARP" },
      ],
      correctOptionId: "rst",
      explanation: "Refusal is fast and explicit: a RST (for TCP) comes straight back. Loss is silent: the sender waits for a timer. This incident shows SYN-ACKs from the server — the port is open.",
    },
  },
  {
    id: "r1-counters",
    label: "Check R1's interface counters",
    narrative: "Test the inference with a second, independent source. R1 ge-0/0/0 (the client-facing interface): output drops were 0 before flow 51001 and 1 after its first SYN-ACK; output packets rose for every frame it did forward. Inspect R1's interfaces to see the counters.",
    run: (s) => {
      const c = s.counters[ifKey("R1", "ge-0/0/0")];
      const n = note(idle(s), "r1-counters", "R1", { active: "tx", details: { tx: `ge-0/0/0 output: ${c.outPkts} packets · ${c.outDrops} output drop${c.outDrops === 1 ? "" : "s"} (delta +1 during flow 51001's handshake)` }, action: "COUNTERS", reason: "An egress drop counter that rose exactly once, in the window where one server→client frame vanished, corroborates the capture evidence from an independent source.", key: "R1 ge-0/0/0 output drops", result: `${c.outDrops} (delta +1)` });
      return { state: withNotes(n, "r1-counters", [{ kind: "observation", text: `R1 ge-0/0/0 output drops: 0 → ${c.outDrops} during flow 51001's handshake`, source: "R1 interface counters", rung: "Physical / interface" }, { kind: "hypothesis", text: "A drop condition on R1's client-facing egress discards server→client frames" }, { kind: "ruled-out", text: "Port closed (SYN-ACKs were sent; no RST)" }, { kind: "ruled-out", text: "Addressing/ARP (the same path works a second later)" }]), events: [ev("STEP_ENTERED", "r1-counters", "counters")] };
    },
  },
  {
    id: "diagnostic-layers",
    label: "Walk the evidence ladder",
    narrative: "Each rung below is checked against evidence you already have. The lowest failing dependency is the one to fix — not the most familiar protocol.",
  },
  {
    id: "predict-cause",
    label: "Predict: root cause",
    narrative: "Put the evidence together.",
    question: {
      prompt: "What explains every observation?",
      options: [
        { id: "return", label: "A drop condition on the return path at R1's client-facing egress discarded the first SYN-ACK" },
        { id: "closed", label: "TCP port 443 on SERVER is closed" },
        { id: "slow", label: "SERVER was too slow and never answered the first SYN" },
        { id: "arp", label: "CLIENT's ARP entry for the gateway was missing" },
      ],
      correctOptionId: "return",
      explanation: "SERVER answered (its capture), the answer passed R1's server side (R1-side capture), never reached the CLIENT side (CLIENT-side capture + client retransmission), and R1 ge-0/0/0 counted one output drop in that window.",
    },
    run: (s) => ({ state: withNotes(idle(s), "predict-cause", [{ kind: "root-cause", text: "Intermittent drop condition on R1 ge-0/0/0 egress (return path toward CLIENT)", source: "captures + R1 counters" }]), events: [] }),
  },
  // ---- Repair -------------------------------------------------------------------------------------------------
  {
    id: "repair-challenge",
    label: "Repair the return path",
    narrative: "Choose the change that fixes the cause you identified.",
    action: (s, payload) => ({ state: applyPaRepair(s, (payload as { choice: string }).choice), events: [ev("STEP_ENTERED", "repair-challenge", `Repair attempt: ${(payload as { choice: string }).choice}`)] }),
    requiresState: (s) => s.repaired,
  },
  // ---- Verify -------------------------------------------------------------------------------------------------
  {
    id: "ver-syn",
    label: "Verify: new connection",
    narrative: `A configuration change is not proof. Repeat the connection (port ${FLOW.verify.sport}) and capture again.`,
    run: (s) => {
      const x = seg.syn(V);
      const p = segPacket("", x, "CLIENT", "SW1");
      const n = segStep(s, "ver-syn", x, "CLIENT", "SW1", [clientTx("ver-syn", x, "TX SYN", "Verification: the same service, a fresh connection.", "CLOSED → SYN_SENT"), sw1Hop("ver-syn", p, "c2s")]);
      return { state: { ...n, clientTcp: "SYN_SENT", serverTcp: "SYN_RECEIVED", flows: { ...n.flows, verify: { flow: V, synSent: x.t, synRetransmits: 0 } } }, events: [ev("PACKET_SENT", "ver-syn", "SYN")] };
    },
    packet: pkt,
  },
  {
    id: "ver-synack",
    label: "Verify: SYN-ACK leaves SERVER",
    narrative: "SERVER answers with SYN-ACK, exactly as before the fix — the server was never the problem.",
    run: (s) => {
      const x = seg.synAck(V, T.vSynAck);
      return { state: segStep(s, "ver-synack", x, "SERVER", "R1", [serverTx("ver-synack", x, "SYN-ACK for the verification connection.")]), events: [ev("PACKET_SENT", "ver-synack", "SYN-ACK")] };
    },
    packet: pkt,
  },
  {
    id: "ver-synack-cl",
    label: "Verify: SYN-ACK reaches CLIENT",
    narrative: "This time the first SYN-ACK arrives at the CLIENT side. R1 ge-0/0/0 output drops: unchanged.",
    run: (s) => {
      const x = seg.synAck(V, T.vSynAck);
      const p = segPacket("", x, "SW1", "CLIENT");
      const n = later(s, "ver-synack-cl", x, "SW1", "CLIENT", [r1Fwd("ver-synack-cl", x, segPacket("", x, "R1", "SW1")), sw1Hop("ver-synack-cl", p, "s2c"), clientRx("ver-synack-cl", x, "SYN_SENT → ESTABLISHED (after ACK)", "First SYN-ACK arrives on the first try.")]);
      return { state: n, events: [ev("PACKET_SENT", "ver-synack-cl", "SYN-ACK at client")] };
    },
    packet: pkt,
  },
  {
    id: "ver-ack",
    label: "Verify: established on time",
    narrative: `ACK, then request and response. Established ${((T.vAck - FLOW.verify.t0) / 1000).toFixed(2)} ms after the SYN — no retransmission.`,
    run: (s) => {
      const x = seg.ack(V, T.vAck);
      const p = segPacket("", x, "CLIENT", "SW1");
      let n = segStep(s, "ver-ack", x, "CLIENT", "SW1", [clientTx("ver-ack", x, "TX ACK", "Handshake complete on the first attempt.", "SYN_SENT → ESTABLISHED"), sw1Hop("ver-ack", p, "c2s")]);
      n = transit(n, seg.req(V, T.vReq)).state;
      n = transit(n, seg.resp(V, T.vResp)).state;
      return { state: { ...n, clientTcp: "ESTABLISHED", serverTcp: "ESTABLISHED", flows: { ...n.flows, verify: { ...n.flows.verify!, established: x.t } } }, events: [ev("PACKET_SENT", "ver-ack", "ACK")] };
    },
    packet: pkt,
  },
  {
    id: "ver-compare",
    label: "Compare broken vs repaired",
    narrative: "Same service, same path, two captures. Broken (51001): SYN, SYN retransmission, established after ~1.001 s. Repaired (51002): SYN, SYN-ACK, ACK in under 1 ms, R1 ge-0/0/0 output drops still 1 (no new drops). That comparison — not the configuration change — is the proof.",
    run: (s) => {
      const drops = s.counters[ifKey("R1", "ge-0/0/0")].outDrops;
      return { state: withNotes(note(idle(s), "ver-compare", "CLIENT", { active: "rx", details: { rx: `51001: ${flowSummary(s, "client", I)} · 51002: ${flowSummary(s, "client", V)}` }, action: "COMPARE", reason: "Verification compares the symptom's signature before and after, with the same instruments: capture timing, retransmission count and the drop counter's delta.", key: "flow 51001 vs 51002", result: `retransmissions 1 → 0 · R1 drops delta 0 (total ${drops})` }), "ver-compare", [{ kind: "verified", text: `Flow 51002: SYN → SYN-ACK → ACK in ${((T.vAck - FLOW.verify.t0) / 1000).toFixed(2)} ms, 0 retransmissions; R1 ge-0/0/0 output drops unchanged (${drops})`, source: "CLIENT-side capture + R1 counters" }]), events: [] };
    },
    question: {
      prompt: "What proves the repair?",
      options: [
        { id: "trace", label: "A new capture: first-try SYN → SYN-ACK → ACK with no retransmission, and R1's drop counter no longer increasing" },
        { id: "config", label: "The configuration change was accepted without error" },
        { id: "ping", label: "One successful ping to the server" },
        { id: "counter", label: "R1's output-drop counter reading 0" },
      ],
      correctOptionId: "trace",
      explanation: "The repair is proven by the symptom's absence under the same test. Note the counter still reads 1: repairs do not erase history — watch its delta.",
    },
  },
  // ---- Complete -----------------------------------------------------------------------------------------------
  {
    id: "operations",
    label: "On real tools",
    narrative: "The same method with real tools: capture with tcpdump or Wireshark at two or more points; filter one flow (for example tcp.port == 51001 in Wireshark or 'tcp port 51001' in tcpdump); let the tool flag retransmissions (Wireshark: tcp.analysis.retransmission); check clock sync before comparing timestamps across captures; and confirm drops with interface counters (show interfaces … on the router).",
  },
  {
    id: "complete",
    label: "Lesson complete",
    narrative: "Capture points, five-tuples, flags, sequence and acknowledgment arithmetic, retransmissions, and the difference between silence and refusal — then a loss located by correlating three captures and a counter, repaired, and verified with a new capture.",
  },
];
