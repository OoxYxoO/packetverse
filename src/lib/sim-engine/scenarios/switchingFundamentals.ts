import type { PacketVisual, PVEvent, PVEventType, ScenarioStep } from "../types";
import type { ProcessingStage } from "@/components/network3d/types";
import type { FundHop } from "@/components/lesson/fundamentalsTrace";

/**
 * Switching Fundamentals: Multi-Switch Forwarding — two learning bridges (SW1, SW2) in ONE broadcast domain.
 *
 *   HOST-A ─ SW1 ═══ SW2 ─ HOST-B
 *            │  (ge-0/0/23 primary, ge-0/0/24 secondary)
 *          HOST-D         HOST-C (on SW2)
 *
 * Modeled exactly (IEEE 802.1D / 802.1Q transparent-bridge behaviour):
 * - Each bridge has its OWN forwarding database. Nothing synchronises them: a bridge learns a MAC only when a frame
 *   SOURCED by that MAC arrives on one of its own ports, and it learns it against that ingress port.
 * - Every bridge performs its own destination lookup: known unicast → one port; unknown unicast → flood (destination
 *   MAC unchanged); broadcast FF:FF:FF:FF:FF:FF → flood. A flood never goes back out the ingress port, and only uses
 *   ports whose link is forwarding.
 * - Hosts filter on destination MAC. A switch never modifies the frame.
 * - Loop incident: the secondary SW1↔SW2 link is enabled while NO loop-prevention protocol (no STP or equivalent) runs.
 *   Each copy that arrives on one inter-switch port is flooded out the other one, so copies circulate forever.
 *   Ordinary Ethernet has no TTL / hop-limit field, so nothing in the frame ever stops them. The lesson shows three
 *   waves and then stops the VISUALIZATION — that limit is a teaching choice, not a protocol mechanism.
 * - MAC "flapping" is ordinary source learning: the same source MAC keeps arriving on different ports, so the entry
 *   keeps moving. When copies arrive at the same instant the processing order is timing-dependent; the model processes
 *   them in port order.
 * - Disabling a port flushes the dynamic entries learned on it (common managed-switch behaviour, as in the Ethernet lesson).
 * No STP election or port-state logic exists in this lesson.
 */

export const BROADCAST_MAC = "FF:FF:FF:FF:FF:FF";
export const SWF_MAC = { "HOST-A": "00:11:22:33:55:0A", "HOST-B": "00:11:22:33:55:0B", "HOST-C": "00:11:22:33:55:0C", "HOST-D": "00:11:22:33:55:0D" } as const;
/** IPv4 addresses appear only inside the ARP payload description — this lesson forwards on MAC addresses alone. */
export const SWF_IP = { "HOST-A": "192.168.50.10", "HOST-B": "192.168.50.20", "HOST-C": "192.168.50.30", "HOST-D": "192.168.50.40" } as const;
export type SwfHost = keyof typeof SWF_MAC;
export type SwfSwitch = "SW1" | "SW2";
export type SwfDevice = SwfHost | SwfSwitch;
export const SWF_HOSTS: SwfHost[] = ["HOST-A", "HOST-D", "HOST-B", "HOST-C"];
export const SWF_DEVICES: SwfDevice[] = ["HOST-A", "HOST-D", "SW1", "SW2", "HOST-B", "HOST-C"];

export const PRIMARY_PORT = "ge-0/0/23";
export const SECONDARY_PORT = "ge-0/0/24";
export const EDGE_PRIMARY = "sw-primary";
export const EDGE_SECONDARY = "sw-secondary";
export type PortKind = "access" | "primary" | "secondary";
export interface SwfPort {
  port: string;
  peer: SwfDevice;
  peerPort: string;
  kind: PortKind;
}
export const SWF_PORTS: Record<SwfSwitch, SwfPort[]> = {
  SW1: [
    { port: "ge-0/0/1", peer: "HOST-A", peerPort: "eth0", kind: "access" },
    { port: "ge-0/0/2", peer: "HOST-D", peerPort: "eth0", kind: "access" },
    { port: PRIMARY_PORT, peer: "SW2", peerPort: PRIMARY_PORT, kind: "primary" },
    { port: SECONDARY_PORT, peer: "SW2", peerPort: SECONDARY_PORT, kind: "secondary" },
  ],
  SW2: [
    { port: "ge-0/0/1", peer: "HOST-B", peerPort: "eth0", kind: "access" },
    { port: "ge-0/0/2", peer: "HOST-C", peerPort: "eth0", kind: "access" },
    { port: PRIMARY_PORT, peer: "SW1", peerPort: PRIMARY_PORT, kind: "primary" },
    { port: SECONDARY_PORT, peer: "SW1", peerPort: SECONDARY_PORT, kind: "secondary" },
  ],
};
export const HOST_ATTACH: Record<SwfHost, { sw: SwfSwitch; port: string }> = {
  "HOST-A": { sw: "SW1", port: "ge-0/0/1" },
  "HOST-D": { sw: "SW1", port: "ge-0/0/2" },
  "HOST-B": { sw: "SW2", port: "ge-0/0/1" },
  "HOST-C": { sw: "SW2", port: "ge-0/0/2" },
};
/** Waves drawn during the loop incident. A VISUALIZATION limit only — the real loop has no end. */
export const LOOP_WAVES_SHOWN = 3;

export interface SwfFdbEntry {
  mac: string;
  port: string;
  type: "dynamic";
}
export interface SwfCopy {
  id: string;
  fromId: string;
  toId: string;
  packet: PacketVisual;
  edgeId?: string;
}
/** A frame copy sitting on an inter-switch link, about to be processed by `sw` on `ingress`. */
export interface InFlightCopy {
  sw: SwfSwitch;
  ingress: string;
  frame: PacketVisual;
}
export interface MacMove {
  sw: SwfSwitch;
  mac: string;
  from: string;
  to: string;
  wave: number;
}
export interface LoopStats {
  /** Last wave processed (1…LOOP_WAVES_SHOWN), or "drain" after the repair. */
  wave: number;
  drained: boolean;
  /** Copies of the ONE looping broadcast transmitted by the switches so far. */
  framesSent: number;
  /** Copies of that broadcast each host has received so far (1 would be normal). */
  received: Record<SwfHost, number>;
  /** Copies still travelling between the switches. */
  circulating: number;
  moves: MacMove[];
}
export interface SwfState {
  hops: FundHop[];
  fdb: Record<SwfSwitch, SwfFdbEntry[]>;
  /** Primary SW1↔SW2 link is always forwarding. The secondary is disabled until the incident. */
  secondaryUp: boolean;
  packet?: PacketVisual;
  /** Which parallel SW1↔SW2 edge the main packet is on (undefined for host links). */
  packetEdge?: string;
  flood: SwfCopy[];
  /** Per-copy annotations for callouts, e.g. "×2 copies". Never part of the frame. */
  copyNotes: Record<string, string>;
  /** Latest forwarding/filtering decision, for callouts and inspectors — never part of the frame. */
  decision?: { device: SwfDevice; text: string };
  inFlight: InFlightCopy[];
  loop?: LoopStats;
  faultActive: boolean;
  repairAttempt?: { choice: string; correct: boolean };
  repaired: boolean;
}

export const createSwfState = (): SwfState => ({ hops: [], fdb: { SW1: [], SW2: [] }, secondaryUp: false, flood: [], copyNotes: {}, inFlight: [], faultActive: false, repaired: false });

// ---------------------------------------------------------------------------------------------------------------
// Frames — real Ethernet II fields only (no FDB result, flood list or wave number ever goes in the frame)
// ---------------------------------------------------------------------------------------------------------------
const ETH_COLOR = "#94a3b8";
export function swfFrame(id: string, from: string, to: string, src: string, dst: string, payload: { etherType: "0x0800" | "0x0806"; carries: string }): PacketVisual {
  const bcast = dst === BROADCAST_MAC;
  return {
    id,
    protocol: payload.etherType === "0x0806" ? "ARP" : "ETHERNET",
    from,
    to,
    broadcast: bcast,
    badge: bcast ? "BCAST" : "FRAME",
    summary: `${bcast ? "Ethernet broadcast" : "Ethernet frame"} — ${src} → ${dst}`,
    layers: [
      {
        name: "Ethernet II Header",
        color: ETH_COLOR,
        fields: [
          { label: "Destination MAC", value: dst },
          { label: "Source MAC", value: src },
          { label: "EtherType", value: payload.etherType === "0x0800" ? "0x0800 (IPv4)" : "0x0806 (ARP)" },
        ],
      },
      { name: "Payload", color: payload.etherType === "0x0800" ? "#60a5fa" : "#f59e0b", fields: [{ label: "Carries", value: payload.carries }] },
      { name: "FCS", color: ETH_COLOR, fields: [{ label: "Frame Check Sequence", value: "CRC-32 over the frame" }] },
    ],
  };
}
const fieldOf = (p: PacketVisual, label: string) => p.layers[0]?.fields.find((f) => f.label === label)?.value ?? "";
export const frameDst = (p: PacketVisual) => fieldOf(p, "Destination MAC");
export const frameSrc = (p: PacketVisual) => fieldOf(p, "Source MAC");
export function frameStack(p: PacketVisual) {
  return [
    { id: "eth", text: `Ethernet II · dst ${frameDst(p)} · src ${frameSrc(p)} · ${fieldOf(p, "EtherType")}`, tone: "generic" as const },
    { id: "payload", text: `Payload · ${p.layers[1]?.fields[0]?.value ?? ""}`, tone: "ip" as const },
    { id: "fcs", text: "FCS · CRC-32", tone: "generic" as const },
  ];
}
export const macName = (mac: string): string => {
  if (mac === BROADCAST_MAC) return "broadcast";
  return (Object.keys(SWF_MAC) as SwfHost[]).find((h) => SWF_MAC[h] === mac) ?? mac;
};
const ipv4 = (carries: string) => ({ etherType: "0x0800" as const, carries });
const arpReq = (sender: SwfHost, target: SwfHost) => ({ etherType: "0x0806" as const, carries: `ARP request — who has ${SWF_IP[target]}? tell ${SWF_IP[sender]}` });
export const unicastFrame = (id: string, src: SwfHost, dst: SwfHost) => swfFrame(id, src, HOST_ATTACH[src].sw, SWF_MAC[src], SWF_MAC[dst], ipv4(`IPv4 packet ${SWF_IP[src]} → ${SWF_IP[dst]}`));
export const broadcastFrame = (id: string, src: SwfHost, target: SwfHost) => swfFrame(id, src, HOST_ATTACH[src].sw, SWF_MAC[src], BROADCAST_MAC, arpReq(src, target));

// ---------------------------------------------------------------------------------------------------------------
// Stage tables
// ---------------------------------------------------------------------------------------------------------------
export const SW_STAGES: ProcessingStage[] = [
  { id: "rx", label: "Receive frame + check FCS" },
  { id: "learn", label: "Learn SOURCE MAC → ingress port (this switch's own FDB)" },
  { id: "lookup", label: "Look up DESTINATION MAC in this switch's FDB" },
  { id: "decide", label: "Forward, flood or filter" },
  { id: "tx", label: "Transmit on forwarding ports (frame unchanged)" },
];
export const HOST_TX_STAGES: ProcessingStage[] = [
  { id: "build", label: "Build Ethernet II frame" },
  { id: "fcs", label: "Append FCS" },
  { id: "tx", label: "Transmit on the link" },
];
export const HOST_RX_STAGES: ProcessingStage[] = [
  { id: "rx", label: "Receive + check FCS" },
  { id: "filter", label: "Destination MAC = my MAC or broadcast?" },
  { id: "deliver", label: "Accept to upper layer, or discard" },
];
const withDetail = (base: ProcessingStage[], d: Partial<Record<string, string>>): ProcessingStage[] => base.map((s) => (d[s.id] ? { ...s, detail: d[s.id] } : s));
const ev = (type: PVEventType, stepId: string, message: string): PVEvent => ({ type, stepId, timestamp: Date.now(), message });

// ---------------------------------------------------------------------------------------------------------------
// Bridge logic (pure) — one bridge, one frame, one ingress port
// ---------------------------------------------------------------------------------------------------------------
export const portInfo = (sw: SwfSwitch, port: string) => SWF_PORTS[sw].find((p) => p.port === port);
export const portForwarding = (s: SwfState, sw: SwfSwitch, port: string) => portInfo(sw, port)?.kind !== "secondary" || s.secondaryUp;
export const forwardingPorts = (s: SwfState, sw: SwfSwitch) => SWF_PORTS[sw].filter((p) => portForwarding(s, sw, p.port)).map((p) => p.port);
export const edgeForPort = (port: string) => (port === PRIMARY_PORT ? EDGE_PRIMARY : port === SECONDARY_PORT ? EDGE_SECONDARY : undefined);
export const isTrunk = (port: string) => port === PRIMARY_PORT || port === SECONDARY_PORT;

export function learn(fdb: SwfFdbEntry[], mac: string, port: string): SwfFdbEntry[] {
  return [...fdb.filter((e) => e.mac !== mac), { mac, port, type: "dynamic" as const }].sort((a, b) => a.mac.localeCompare(b.mac));
}
export const lookup = (fdb: SwfFdbEntry[], mac: string) => fdb.find((e) => e.mac === mac);

export type BridgeKind = "unknown-unicast" | "known-unicast" | "broadcast" | "filter";
export interface BridgeResult {
  fdb: SwfFdbEntry[];
  learned: string;
  moved?: { from: string; to: string };
  kind: BridgeKind;
  egress: string[];
  lookupResult: string;
}
export function bridge(s: SwfState, sw: SwfSwitch, ingress: string, frame: PacketVisual): BridgeResult {
  const src = frameSrc(frame);
  const dst = frameDst(frame);
  const prior = lookup(s.fdb[sw], src);
  const fdb = learn(s.fdb[sw], src, ingress);
  const moved = prior && prior.port !== ingress ? { from: prior.port, to: ingress } : undefined;
  const learned = moved ? `${src} MOVED ${moved.from} → ${ingress}` : prior ? `${src} refreshed on ${ingress}` : `${src} learned on ${ingress}`;
  const others = forwardingPorts(s, sw).filter((p) => p !== ingress);
  if (dst === BROADCAST_MAC) return { fdb, learned, moved, kind: "broadcast", egress: others, lookupResult: "broadcast address — flood" };
  const hit = lookup(fdb, dst);
  if (!hit) return { fdb, learned, moved, kind: "unknown-unicast", egress: others, lookupResult: `${dst} not in ${sw}'s FDB — unknown unicast` };
  if (hit.port === ingress) return { fdb, learned, moved, kind: "filter", egress: [], lookupResult: `${dst} → ${hit.port} (the ingress port) — filter` };
  return { fdb, learned, moved, kind: "known-unicast", egress: [hit.port], lookupResult: `${dst} → ${hit.port}` };
}

const kindText = (k: BridgeKind) => (k === "broadcast" ? "BROADCAST → flood" : k === "unknown-unicast" ? "UNKNOWN UNICAST → flood" : k === "known-unicast" ? "KNOWN UNICAST → forward" : "FILTER");
const lookupWord = (k: BridgeKind) => (k === "known-unicast" || k === "filter" ? "HIT" : k === "broadcast" ? "BROADCAST" : "MISS");
export const fdbLine = (s: SwfState, sw: SwfSwitch) => (s.fdb[sw].length ? s.fdb[sw].map((e) => `${macName(e.mac)} → ${e.port}`).join(", ") : "empty");

/** Copies leaving `sw` out of `egress`: the main packet prefers an inter-switch copy (the one that continues). */
function emit(sw: SwfSwitch, stepId: string, frame: PacketVisual, egress: string[]) {
  const copies = egress
    .map((port) => {
      const info = portInfo(sw, port)!;
      const id = `${stepId}-${info.peer}${isTrunk(port) ? `-${port.slice(-2)}` : ""}`;
      return { id, fromId: sw, toId: info.peer, packet: { ...frame, id, from: sw, to: info.peer }, edgeId: edgeForPort(port) };
    })
    .sort((a, b) => Number(!!b.edgeId) - Number(!!a.edgeId));
  const [main, ...rest] = copies;
  return { main, rest };
}

// ---------------------------------------------------------------------------------------------------------------
// Device actions
// ---------------------------------------------------------------------------------------------------------------
function hostSend(s: SwfState, stepId: string, host: SwfHost, frame: PacketVisual): SwfState {
  const at = HOST_ATTACH[host];
  const hop: FundHop = {
    stepId,
    device: host,
    stages: withDetail(HOST_TX_STAGES, { build: `dst ${frameDst(frame)} · src ${frameSrc(frame)}`, tx: `eth0 → ${at.sw} ${at.port}` }),
    activeStageId: "tx",
    egressInterfaceId: "eth0",
    lookupType: "Frame addressing",
    lookupKey: `destination ${frameDst(frame)}`,
    lookupResult: frameDst(frame) === BROADCAST_MAC ? "broadcast — every host in the Layer-2 domain" : `unicast to ${macName(frameDst(frame))}`,
    action: "SEND",
    reason: `${host} builds an Ethernet II frame with its own MAC (${SWF_MAC[host]}) as the source and transmits it on its only link, to ${at.sw} ${at.port}.`,
    input: "(originated here)",
    output: `${frameDst(frame)} ← ${frameSrc(frame)}`,
    nextHopId: at.sw,
    after: frameStack(frame),
  };
  return { ...s, hops: [...s.hops, hop], packet: frame, packetEdge: undefined, flood: [], copyNotes: {}, decision: { device: host, text: `${host} → ${at.sw} ${at.port}` } };
}

/** One bridge processes `frame` (arrived on `ingress`) up to `stage`, and at "tx" emits it out of every egress port. */
function switchStep(s: SwfState, stepId: string, sw: SwfSwitch, ingress: string, frame: PacketVisual, stage: "learn" | "lookup" | "tx"): SwfState {
  const r = bridge(s, sw, ingress, frame);
  const kt = kindText(r.kind);
  const detail: Partial<Record<string, string>> = { rx: `on ${ingress}`, learn: r.learned };
  if (stage !== "learn") {
    detail.lookup = r.lookupResult;
    detail.decide = r.egress.length ? `${kt} · out ${r.egress.join(", ")}` : kt;
  }
  if (stage === "tx") detail.tx = r.egress.length ? `out ${r.egress.join(", ")}` : "nothing to send";
  const hop: FundHop = {
    stepId,
    device: sw,
    stages: withDetail(SW_STAGES, detail),
    activeStageId: stage,
    ingressInterfaceId: ingress,
    egressInterfaceId: stage === "tx" ? r.egress[0] : undefined,
    egressInterfaceIds: stage === "tx" ? r.egress : undefined,
    lookupType: `${sw} FDB (its own MAC table)`,
    lookupKey: stage === "learn" ? `source ${frameSrc(frame)}` : `destination ${frameDst(frame)}`,
    lookupResult: stage === "learn" ? r.learned : r.lookupResult,
    action: stage === "learn" ? "LEARN" : stage === "lookup" ? `LEARN + LOOKUP · ${lookupWord(r.kind)}` : kt,
    reason:
      stage === "learn"
        ? `${sw} records where the SENDER is, from ${sw}'s own point of view: source ${frameSrc(frame)} arrived on ${ingress}. No other switch is told.`
        : r.kind === "broadcast"
          ? `The destination is ${BROADCAST_MAC}, addressed to every station — ${sw} floods it out every forwarding port except ${ingress}, whatever its FDB holds.`
          : r.kind === "unknown-unicast"
            ? `${frameDst(frame)} is not in ${sw}'s own FDB, so ${sw} cannot pick one port: it floods the unicast frame (destination unchanged) out every forwarding port except ${ingress}. What another switch knows does not matter.`
            : r.kind === "known-unicast"
              ? `${frameDst(frame)} is in ${sw}'s own FDB on ${r.egress[0]} — the frame leaves only that port.`
              : `${frameDst(frame)} is behind the port it arrived on — nothing to send.`,
    input: `${frameDst(frame)} ← ${frameSrc(frame)} on ${ingress}`,
    output: stage === "tx" ? (r.egress.length ? `same frame out ${r.egress.join(", ")}` : "not forwarded") : stage === "learn" ? r.learned : r.lookupResult,
    nextHopId: stage === "tx" && r.egress[0] ? portInfo(sw, r.egress[0])?.peer : undefined,
    before: frameStack(frame),
    after: stage === "tx" ? frameStack(frame) : undefined,
  };
  const next: SwfState = { ...s, fdb: { ...s.fdb, [sw]: r.fdb }, hops: [...s.hops, hop], copyNotes: {} };
  const decision = { device: sw as SwfDevice, text: stage === "learn" ? `${sw} learned ${macName(frameSrc(frame))} on ${ingress}` : `${sw}: ${kt}${r.egress.length ? ` · out ${r.egress.join(", ")}` : ""}` };
  if (stage !== "tx") return { ...next, packet: { ...frame, from: frame.from, to: sw }, packetEdge: s.packetEdge, flood: [], decision };
  const { main, rest } = emit(sw, stepId, frame, r.egress);
  return { ...next, packet: main?.packet, packetEdge: main?.edgeId, flood: rest, decision };
}

function hostReceive(s: SwfState, stepId: string, host: SwfHost, frame: PacketVisual): SwfState {
  const dst = frameDst(frame);
  const mine = dst === SWF_MAC[host] || dst === BROADCAST_MAC;
  const hop: FundHop = {
    stepId,
    device: host,
    stages: withDetail(HOST_RX_STAGES, { rx: "FCS OK", filter: `${dst} vs my ${SWF_MAC[host]} → ${mine ? "match" : "no match"}`, deliver: mine ? "accepted" : "discarded" }),
    activeStageId: "deliver",
    ingressInterfaceId: "eth0",
    lookupType: "Destination-MAC filter",
    lookupKey: dst,
    lookupResult: mine ? (dst === BROADCAST_MAC ? "broadcast — accepted" : "my MAC — accepted") : `not ${SWF_MAC[host]} — discarded`,
    action: mine ? "ACCEPT" : "DISCARD",
    reason: mine ? `The destination MAC is ${dst === BROADCAST_MAC ? "the broadcast address" : `${host}'s own MAC`}, so the NIC passes the payload up.` : `The frame reached ${host} only because a switch flooded it. Its destination is ${dst} (${macName(dst)}), not ${SWF_MAC[host]}, so the NIC drops it.`,
    input: `${dst} ← ${frameSrc(frame)}`,
    output: mine ? "payload delivered to the upper layer" : "dropped by the NIC",
    before: frameStack(frame),
  };
  return { ...s, hops: [...s.hops, hop], decision: { device: host, text: `${host}: ${mine ? "accepted" : "discarded"} (dst ${macName(dst)})` } };
}

// ---------------------------------------------------------------------------------------------------------------
// Loop waves — every copy sitting at `sw` is bridged in turn; copies it sends onto an inter-switch link arrive at
// the other switch for the next wave. Nothing in the frame changes, so nothing ever stops them.
// ---------------------------------------------------------------------------------------------------------------
const emptyReceived = (): Record<SwfHost, number> => ({ "HOST-A": 0, "HOST-D": 0, "HOST-B": 0, "HOST-C": 0 });

function loopWave(s: SwfState, stepId: string, sw: SwfSwitch, wave: number, drain = false): SwfState {
  const here = s.inFlight.filter((f) => f.sw === sw).sort((a, b) => a.ingress.localeCompare(b.ingress));
  const elsewhere = s.inFlight.filter((f) => f.sw !== sw);
  let working = s;
  const moves: MacMove[] = [];
  const perCopy: string[] = [];
  const learnLines: string[] = [];
  const out: { port: string; frame: PacketVisual }[] = [];
  for (const f of here) {
    const r = bridge(working, sw, f.ingress, f.frame);
    if (r.moved) moves.push({ sw, mac: frameSrc(f.frame), from: r.moved.from, to: f.ingress, wave });
    learnLines.push(r.learned);
    perCopy.push(`copy in ${f.ingress} → out ${r.egress.join(", ") || "none"}`);
    working = { ...working, fdb: { ...working.fdb, [sw]: r.fdb } };
    r.egress.forEach((port) => out.push({ port, frame: f.frame }));
  }
  const frame = here[0]?.frame;
  const hostCounts = new Map<SwfHost, number>();
  const nextInFlight: InFlightCopy[] = [];
  const trunkCopies: SwfCopy[] = [];
  out.forEach((o, i) => {
    const info = portInfo(sw, o.port)!;
    if (info.peer === "SW1" || info.peer === "SW2") {
      nextInFlight.push({ sw: info.peer, ingress: info.peerPort, frame: o.frame });
      const id = `${stepId}-${info.peer}-${o.port.slice(-2)}-${i}`;
      trunkCopies.push({ id, fromId: sw, toId: info.peer, packet: { ...o.frame, id, from: sw, to: info.peer }, edgeId: edgeForPort(o.port) });
    } else hostCounts.set(info.peer as SwfHost, (hostCounts.get(info.peer as SwfHost) ?? 0) + 1);
  });
  const hostCopies: SwfCopy[] = [...hostCounts.entries()].map(([h]) => {
    const id = `${stepId}-${h}`;
    return { id, fromId: sw, toId: h, packet: { ...frame!, id, from: sw, to: h } };
  });
  const notes: Record<string, string> = {};
  hostCopies.forEach((c) => {
    const n = hostCounts.get(c.toId as SwfHost) ?? 0;
    if (n > 1) notes[c.id] = `×${n}`;
  });
  const prev = s.loop ?? { wave: 0, drained: false, framesSent: 0, received: emptyReceived(), circulating: 0, moves: [] };
  const received = { ...prev.received };
  hostCounts.forEach((n, h) => (received[h] += n));
  const circulating = nextInFlight.length + elsewhere.length;
  const loop: LoopStats = { wave: drain ? prev.wave : wave, drained: drain && circulating === 0, framesSent: prev.framesSent + out.length, received, circulating, moves: [...prev.moves, ...moves] };
  const egressAll = [...new Set(out.map((o) => o.port))];
  const movesText = moves.map((m) => `${macName(m.mac)} moved ${m.from} → ${m.to}`);
  const hop: FundHop = {
    stepId,
    device: sw,
    stages: withDetail(SW_STAGES, {
      rx: `${here.length} cop${here.length === 1 ? "y" : "ies"} on ${here.map((h) => h.ingress).join(" + ")}`,
      learn: movesText.length ? movesText.join(" · ") : learnLines.join(" · "),
      lookup: "broadcast address — flood",
      decide: perCopy.join(" · "),
      tx: `${out.length} cop${out.length === 1 ? "y" : "ies"} sent`,
    }),
    activeStageId: "tx",
    ingressInterfaceId: here[0]?.ingress,
    egressInterfaceId: egressAll[0],
    egressInterfaceIds: egressAll,
    lookupType: `${sw} FDB (its own MAC table)`,
    lookupKey: `destination ${BROADCAST_MAC}`,
    lookupResult: `broadcast — each copy flooded out every other forwarding port${movesText.length ? ` · ${movesText.join(" · ")}` : ""}`,
    action: drain ? "FLOOD · LOOP DRAINS" : `WAVE ${wave} · FLOOD ×${here.length}`,
    reason: drain
      ? `${sw} floods the last copy out its access ports. With ${SECONDARY_PORT} disabled there is no second inter-switch port to send it back on, so nothing returns: the loop has drained.`
      : here.length > 1
        ? `${sw} handles each arriving copy as a brand-new broadcast: learn the source, flood out every forwarding port except the one it came in on. A copy that came in on one inter-switch port therefore leaves on the OTHER one. The frame is unchanged — Ethernet has no TTL to count down.`
        : `${sw} floods the broadcast out every forwarding port except ${here[0]?.ingress ?? "the ingress"} — including BOTH inter-switch links, because both are forwarding and nothing is blocking either.`,
    input: `${here.length} × ${frame ? `${frameDst(frame)} ← ${frameSrc(frame)}` : "(none)"}`,
    output: `${out.length} copies: ${egressAll.join(", ")}`,
    nextHopId: trunkCopies[0]?.toId ?? hostCopies[0]?.toId,
    before: frame ? frameStack(frame) : undefined,
    after: frame ? frameStack(frame) : undefined,
  };
  const all = [...trunkCopies, ...hostCopies];
  const [main, ...rest] = all;
  const decision = { device: sw as SwfDevice, text: drain ? `${sw}: last copy flooded to access ports — loop drained` : `Wave ${wave} · ${sw} floods ${here.length} cop${here.length === 1 ? "y" : "ies"} → ${out.length} copies` };
  return { ...working, hops: [...s.hops, hop], inFlight: [...elsewhere, ...nextInFlight], loop, packet: main?.packet, packetEdge: main?.edgeId, flood: rest, copyNotes: notes, decision };
}

// ---------------------------------------------------------------------------------------------------------------
// Repair
// ---------------------------------------------------------------------------------------------------------------
export const SWF_REPAIR_OPTIONS = [
  { id: "disable-secondary", label: `Disable the secondary SW1↔SW2 link (${SECONDARY_PORT} on both switches)` },
  { id: "clear-fdb", label: "Clear the FDBs on SW1 and SW2" },
  { id: "raise-ttl", label: "Raise the IPv4 TTL on HOST-A" },
  { id: "change-mac", label: "Give HOST-A a new MAC address" },
  { id: "restart-b", label: "Restart HOST-B" },
] as const;
export const SWF_REPAIR_CORRECT = "disable-secondary";

/** Correct repair: the secondary link goes down on both ends. Entries learned on it are flushed, and the copy that was on that cable is lost with the link. */
export function applySwfRepair(s: SwfState, choice: string): SwfState {
  const correct = choice === SWF_REPAIR_CORRECT;
  if (!correct) return { ...s, repairAttempt: { choice, correct } };
  const flush = (fdb: SwfFdbEntry[]) => fdb.filter((e) => e.port !== SECONDARY_PORT);
  const inFlight = s.inFlight.filter((f) => f.ingress !== SECONDARY_PORT);
  return {
    ...s,
    repairAttempt: { choice, correct },
    repaired: true,
    secondaryUp: false,
    fdb: { SW1: flush(s.fdb.SW1), SW2: flush(s.fdb.SW2) },
    inFlight,
    loop: s.loop ? { ...s.loop, circulating: inFlight.length } : s.loop,
    packet: undefined,
    packetEdge: undefined,
    flood: [],
    copyNotes: {},
    decision: { device: "SW1", text: `${SECONDARY_PORT} disabled on SW1 and SW2 — one Layer-2 path left` },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------------------------------------------
const idle = (s: SwfState): SwfState => ({ ...s, packet: undefined, packetEdge: undefined, flood: [], copyNotes: {}, decision: undefined });
const pkt = (s: SwfState) => s.packet;
const A = SWF_MAC["HOST-A"];
const B = SWF_MAC["HOST-B"];

/** Frames reused across several steps (same frame, different device). */
const F = {
  first: () => unicastFrame("first-a-b", "HOST-A", "HOST-B"),
  reply: () => unicastFrame("reply-b-a", "HOST-B", "HOST-A"),
  resend: () => unicastFrame("resend-a-b", "HOST-A", "HOST-B"),
  dToA: () => unicastFrame("local-d-a", "HOST-D", "HOST-A"),
  aToD: () => unicastFrame("local-a-d", "HOST-A", "HOST-D"),
  cToD: () => unicastFrame("partial-c-d", "HOST-C", "HOST-D"),
  dBcast: () => broadcastFrame("bcast-d", "HOST-D", "HOST-C"),
  loop: () => broadcastFrame("loop-a", "HOST-A", "HOST-B"),
  symptom: () => unicastFrame("symptom-d-a", "HOST-D", "HOST-A"),
  verifyBcast: () => broadcastFrame("verify-a", "HOST-A", "HOST-B"),
  verifyUni: () => unicastFrame("verify-b-a", "HOST-B", "HOST-A"),
};
/** The flooded copy `sw` sent toward `to` at `stepId`, as it arrives there. */
const arrived = (f: PacketVisual, from: SwfDevice, to: SwfDevice) => ({ ...f, from, to });

export const switchingFundamentalsSteps: ScenarioStep<SwfState>[] = [
  {
    id: "intro",
    label: "Two switches, one LAN",
    narrative: "HOST-A and HOST-D hang off SW1; HOST-B and HOST-C hang off SW2; SW1 and SW2 are joined by an inter-switch link. All four hosts are in ONE Layer-2 broadcast domain. The Ethernet lesson showed one switch learning. This lesson is about what changes when a frame has to cross two of them.",
  },
  {
    id: "topology",
    label: "Ports and links",
    narrative: `SW1: ge-0/0/1 → HOST-A, ge-0/0/2 → HOST-D, ${PRIMARY_PORT} → SW2. SW2: ge-0/0/1 → HOST-B, ge-0/0/2 → HOST-C, ${PRIMARY_PORT} → SW1. A second cable between the switches (${SECONDARY_PORT} on both) is plugged in but DISABLED, so exactly one SW1↔SW2 path forwards. MACs: HOST-A ${A}, HOST-B ${B}, HOST-C ${SWF_MAC["HOST-C"]}, HOST-D ${SWF_MAC["HOST-D"]}.`,
  },
  {
    id: "predict-fdbs",
    label: "Predict: one table or two?",
    narrative: "Both switches have just booted. Neither has seen a frame yet.",
    question: {
      prompt: "How do SW1 and SW2 keep track of where each MAC address is?",
      options: [
        { id: "own", label: "Each switch builds its own FDB from the frames it receives — nothing is shared" },
        { id: "shared", label: "They share one MAC table over the inter-switch link" },
        { id: "sync", label: "SW1 learns, then copies its table to SW2 every few seconds" },
        { id: "root", label: "Only SW1 keeps a table; SW2 asks SW1 for every frame" },
      ],
      correctOptionId: "own",
      explanation: "Ordinary learning bridges are independent. Each one fills its own forwarding database from the source MACs of frames arriving on its own ports. No protocol here copies entries between switches.",
    },
  },
  {
    id: "a-sends",
    label: "HOST-A sends to HOST-B",
    narrative: `HOST-A transmits a unicast frame: destination ${B} (HOST-B), source ${A}. It arrives on SW1 ge-0/0/1.`,
    run: (s) => ({ state: hostSend(idle(s), "a-sends", "HOST-A", F.first()), events: [ev("PACKET_SENT", "a-sends", "HOST-A → HOST-B")] }),
    packet: pkt,
    whatChanged: () => ["Unicast frame for HOST-B's MAC on the wire to SW1 ge-0/0/1"],
  },
  {
    id: "sw1-learn-lookup",
    label: "SW1: learn A, look up B",
    narrative: `SW1 learns ${A} → ge-0/0/1 in ITS OWN FDB. Then it looks up the destination ${B}: SW1 has never seen a frame from HOST-B, so the lookup misses.`,
    run: (s) => ({ state: switchStep(s, "sw1-learn-lookup", "SW1", "ge-0/0/1", F.first(), "lookup"), events: [ev("MAC_LEARNED", "sw1-learn-lookup", "SW1 learns HOST-A; lookup HOST-B misses")] }),
    packet: pkt,
    whatChanged: (_p, n) => [`SW1 FDB: ${fdbLine(n, "SW1")}`, `SW2 FDB: ${fdbLine(n, "SW2")}`, "SW1 lookup for HOST-B: MISS"],
  },
  {
    id: "sw1-flood",
    label: "SW1 floods the unknown unicast",
    narrative: `SW1 sends copies out ge-0/0/2 (HOST-D) and ${PRIMARY_PORT} (SW2) — never back out ge-0/0/1, and not out the disabled ${SECONDARY_PORT}. Every copy is still a UNICAST frame for ${B}; nothing turned it into a broadcast.`,
    run: (s) => ({ state: switchStep(s, "sw1-flood", "SW1", "ge-0/0/1", F.first(), "tx"), events: [ev("PACKET_SENT", "sw1-flood", "SW1 floods unknown unicast")] }),
    packet: pkt,
    whatChanged: () => [`Copies out ge-0/0/2 and ${PRIMARY_PORT}`, `Destination MAC unchanged: ${B}`],
  },
  {
    id: "d-discards",
    label: "HOST-D discards its copy",
    narrative: `HOST-D got a copy only because SW1 flooded. The destination is ${B}, not HOST-D's ${SWF_MAC["HOST-D"]}, so HOST-D's NIC discards it.`,
    run: (s) => ({ state: { ...hostReceive(s, "d-discards", "HOST-D", arrived(F.first(), "SW1", "HOST-D")), packet: arrived(F.first(), "SW1", "SW2"), packetEdge: EDGE_PRIMARY, flood: [], copyNotes: {} }, events: [ev("PACKET_DROPPED", "d-discards", "HOST-D discards")] }),
    packet: pkt,
    whatChanged: () => ["HOST-D: destination MAC is not mine — discarded", "The other copy is still on its way to SW2"],
  },
  {
    id: "predict-sw2",
    label: "Predict: what does SW2 know?",
    narrative: `The copy reaches SW2 on ${PRIMARY_PORT}. SW1 already knows where HOST-A is.`,
    packet: pkt,
    question: {
      prompt: "Why does SW2 need to learn HOST-A separately from SW1?",
      options: [
        { id: "own", label: "SW2 has its own FDB; it learns HOST-A only from a HOST-A frame arriving on one of its own ports" },
        { id: "copied", label: "It doesn't — SW1's entry was copied to SW2 when it flooded the frame" },
        { id: "dst", label: "SW2 learns HOST-A from the frame's destination field" },
        { id: "never", label: "SW2 never learns HOST-A because HOST-A isn't attached to it" },
      ],
      correctOptionId: "own",
      explanation: `Learning is hop by hop. SW1's table is invisible to SW2. SW2 sees a frame with source ${A} arriving on ${PRIMARY_PORT}, so it records HOST-A → ${PRIMARY_PORT}: from SW2's point of view, HOST-A is "somewhere behind SW1".`,
    },
  },
  {
    id: "sw2-learn",
    label: "SW2 learns HOST-A",
    narrative: `SW2 records ${A} → ${PRIMARY_PORT} in its own FDB. The same MAC now sits in two tables with two different ports: ge-0/0/1 on SW1, ${PRIMARY_PORT} on SW2.`,
    run: (s) => ({ state: switchStep(s, "sw2-learn", "SW2", PRIMARY_PORT, arrived(F.first(), "SW1", "SW2"), "learn"), events: [ev("MAC_LEARNED", "sw2-learn", "SW2 learns HOST-A on ge-0/0/23")] }),
    packet: pkt,
    whatChanged: (_p, n) => [`SW1 FDB: ${fdbLine(n, "SW1")}`, `SW2 FDB: ${fdbLine(n, "SW2")}`],
  },
  {
    id: "sw2-flood",
    label: "SW2: its own lookup misses too",
    narrative: `SW2 looks up ${B} in ITS FDB — empty for HOST-B — so SW2 floods too: out ge-0/0/1 (HOST-B) and ge-0/0/2 (HOST-C), never back out ${PRIMARY_PORT}.`,
    run: (s) => ({ state: switchStep(s, "sw2-flood", "SW2", PRIMARY_PORT, arrived(F.first(), "SW1", "SW2"), "tx"), events: [ev("PACKET_SENT", "sw2-flood", "SW2 floods unknown unicast")] }),
    packet: pkt,
    whatChanged: () => ["SW2 lookup for HOST-B: MISS", "Copies out ge-0/0/1 and ge-0/0/2 — destination still HOST-B"],
  },
  {
    id: "predict-c",
    label: "Predict: why HOST-C?",
    narrative: "HOST-C is about to receive a copy of a frame addressed to HOST-B.",
    packet: pkt,
    question: {
      prompt: "Why does HOST-C receive the first HOST-A → HOST-B frame?",
      options: [
        { id: "flood", label: "SW2 had no FDB entry for HOST-B, so it flooded the unknown unicast out every other forwarding port" },
        { id: "bcast", label: "The frame became a broadcast when it crossed SW1" },
        { id: "sw1", label: "SW1 told SW2 to send it everywhere" },
        { id: "c-mac", label: "HOST-C's MAC matches the destination" },
      ],
      correctOptionId: "flood",
      explanation: `The frame is still unicast to ${B}. SW2's own lookup missed, so SW2 flooded. HOST-C will receive it and discard it, because the destination is not its MAC.`,
    },
  },
  {
    id: "b-accepts",
    label: "HOST-B accepts",
    narrative: `HOST-B's NIC sees destination ${B} — its own MAC — and passes the payload up.`,
    run: (s) => ({ state: { ...hostReceive(s, "b-accepts", "HOST-B", arrived(F.first(), "SW2", "HOST-B")), packet: undefined, packetEdge: undefined, flood: [], copyNotes: {} }, events: [ev("PACKET_RECEIVED", "b-accepts", "HOST-B accepts")] }),
    whatChanged: () => ["HOST-B: destination MAC matches — accepted"],
  },
  {
    id: "c-discards",
    label: "HOST-C discards",
    narrative: `HOST-C compares ${B} with its own ${SWF_MAC["HOST-C"]}: no match, so its NIC drops the copy.`,
    run: (s) => ({ state: hostReceive(s, "c-discards", "HOST-C", arrived(F.first(), "SW2", "HOST-C")), events: [ev("PACKET_DROPPED", "c-discards", "HOST-C discards")] }),
    whatChanged: () => ["HOST-C: not my MAC — discarded"],
  },
  {
    id: "b-replies",
    label: "HOST-B replies",
    narrative: `HOST-B answers: destination ${A}, source ${B}. It arrives on SW2 ge-0/0/1.`,
    run: (s) => ({ state: hostSend(idle(s), "b-replies", "HOST-B", F.reply()), events: [ev("PACKET_SENT", "b-replies", "HOST-B → HOST-A")] }),
    packet: pkt,
    whatChanged: () => ["Reply on the wire to SW2 ge-0/0/1"],
  },
  {
    id: "sw2-reply",
    label: "SW2: learn B, known unicast to SW1",
    narrative: `SW2 learns ${B} → ge-0/0/1. It already has HOST-A → ${PRIMARY_PORT} from the first frame, so the reply is KNOWN unicast: it leaves ${PRIMARY_PORT} only. HOST-C sees nothing.`,
    run: (s) => ({ state: switchStep(s, "sw2-reply", "SW2", "ge-0/0/1", F.reply(), "tx"), events: [ev("PACKET_SENT", "sw2-reply", "SW2 forwards known unicast")] }),
    packet: pkt,
    whatChanged: (_p, n) => [`SW2 FDB: ${fdbLine(n, "SW2")}`, `Lookup HOST-A → ${PRIMARY_PORT} (hit)`],
  },
  {
    id: "sw1-reply",
    label: "SW1: learn B, known unicast to A",
    narrative: `SW1 learns ${B} → ${PRIMARY_PORT} — HOST-B is behind SW2 from SW1's point of view. HOST-A is known on ge-0/0/1, so the reply goes there only, and HOST-A accepts it.`,
    run: (s) => ({ state: switchStep(s, "sw1-reply", "SW1", PRIMARY_PORT, arrived(F.reply(), "SW2", "SW1"), "tx"), events: [ev("PACKET_SENT", "sw1-reply", "SW1 forwards known unicast")] }),
    packet: pkt,
    whatChanged: (_p, n) => [`SW1 FDB: ${fdbLine(n, "SW1")}`, "Lookup HOST-A → ge-0/0/1 (hit)"],
  },
  {
    id: "fdb-compare",
    label: "Same MACs, different ports",
    narrative: `Both switches now know HOST-A and HOST-B, but each from its own position. SW1: HOST-A → ge-0/0/1 (local), HOST-B → ${PRIMARY_PORT}. SW2: HOST-A → ${PRIMARY_PORT}, HOST-B → ge-0/0/1 (local). An entry on an inter-switch port only means "somewhere beyond the other switch".`,
    run: (s) => ({ state: idle(s), events: [] }),
    whatChanged: (_p, n) => [`SW1 FDB: ${fdbLine(n, "SW1")}`, `SW2 FDB: ${fdbLine(n, "SW2")}`],
  },
  {
    id: "predict-resend",
    label: "Predict: the second A → B frame",
    narrative: "HOST-A sends another frame to HOST-B.",
    question: {
      prompt: "How is the second HOST-A → HOST-B frame forwarded?",
      options: [
        { id: "two", label: `Two separate lookups: SW1 hits HOST-B → ${PRIMARY_PORT}, then SW2 hits HOST-B → ge-0/0/1` },
        { id: "one", label: "SW1 makes one decision for the whole path; SW2 just passes it along" },
        { id: "flood", label: "Both switches flood it again" },
        { id: "sw2-only", label: "Only SW2 looks it up, because HOST-B is attached to SW2" },
      ],
      correctOptionId: "two",
      explanation: "There is no end-to-end MAC decision. Each bridge looks up the destination in its own table and picks one of its own ports. Both lookups now hit, so nothing is flooded anywhere.",
    },
  },
  {
    id: "resend-a",
    label: "HOST-A sends again",
    narrative: `Same addressing: destination ${B}, source ${A}, into SW1 ge-0/0/1.`,
    run: (s) => ({ state: hostSend(idle(s), "resend-a", "HOST-A", F.resend()), events: [ev("PACKET_SENT", "resend-a", "HOST-A → HOST-B again")] }),
    packet: pkt,
  },
  {
    id: "resend-sw1",
    label: "Lookup 1: SW1 hit",
    narrative: `SW1 refreshes HOST-A, finds ${B} → ${PRIMARY_PORT} in its FDB, and forwards out that single port. HOST-D sees nothing.`,
    run: (s) => ({ state: switchStep(s, "resend-sw1", "SW1", "ge-0/0/1", F.resend(), "tx"), events: [ev("PACKET_SENT", "resend-sw1", "SW1 known unicast")] }),
    packet: pkt,
    whatChanged: () => [`SW1 lookup: HOST-B → ${PRIMARY_PORT} (hit) — no flood`],
  },
  {
    id: "resend-sw2",
    label: "Lookup 2: SW2 hit",
    narrative: `SW2 performs its OWN lookup: ${B} → ge-0/0/1. The frame leaves that port only. HOST-C sees nothing.`,
    run: (s) => ({ state: switchStep(s, "resend-sw2", "SW2", PRIMARY_PORT, arrived(F.resend(), "SW1", "SW2"), "tx"), events: [ev("PACKET_SENT", "resend-sw2", "SW2 known unicast")] }),
    packet: pkt,
    whatChanged: () => ["SW2 lookup: HOST-B → ge-0/0/1 (hit) — no flood"],
  },
  {
    id: "d-sends",
    label: "HOST-D speaks to HOST-A",
    narrative: `HOST-D, silent so far, sends a unicast frame to HOST-A: destination ${A}, source ${SWF_MAC["HOST-D"]}. Both hosts hang off SW1.`,
    run: (s) => ({ state: hostSend(idle(s), "d-sends", "HOST-D", F.dToA()), events: [ev("PACKET_SENT", "d-sends", "HOST-D → HOST-A")] }),
    packet: pkt,
  },
  {
    id: "sw1-local",
    label: "Local switching on SW1",
    narrative: `SW1 learns HOST-D → ge-0/0/2. HOST-A is known on ge-0/0/1, so the frame goes there and nowhere else. It never touches ${PRIMARY_PORT}, so SW2 does not see it — and does not learn HOST-D.`,
    run: (s) => ({ state: switchStep(s, "sw1-local", "SW1", "ge-0/0/2", F.dToA(), "tx"), events: [ev("PACKET_SENT", "sw1-local", "SW1 switches locally")] }),
    packet: pkt,
    whatChanged: (_p, n) => [`SW1 FDB: ${fdbLine(n, "SW1")}`, `SW2 FDB: ${fdbLine(n, "SW2")} — no HOST-D`],
  },
  {
    id: "a-to-d",
    label: "HOST-A answers HOST-D locally",
    narrative: `HOST-A replies to HOST-D. SW1 finds HOST-D → ge-0/0/2 and forwards it straight there. Local traffic between two hosts on the same switch stays on that switch.`,
    run: (s) => {
      const f = F.aToD();
      return { state: switchStep(hostSend(idle(s), "a-to-d", "HOST-A", f), "a-to-d", "SW1", "ge-0/0/1", f, "tx"), events: [ev("PACKET_SENT", "a-to-d", "SW1 switches locally")] };
    },
    packet: pkt,
    whatChanged: () => ["SW1 lookup: HOST-D → ge-0/0/2 (hit)", `${PRIMARY_PORT} unused — SW2 still has no entry for HOST-D`],
  },
  {
    id: "predict-partial",
    label: "Predict: one flow, two answers",
    narrative: "HOST-C (on SW2) is about to send a unicast frame to HOST-D (on SW1). Compare what each switch has learned so far.",
    question: {
      prompt: "Can SW1 know HOST-D while SW2 still floods a frame addressed to HOST-D?",
      options: [
        { id: "yes", label: "Yes — SW2 has never seen a frame from HOST-D, so it floods; SW1 knows HOST-D and forwards to one port" },
        { id: "no-both-flood", label: "No — if one switch floods, every switch floods" },
        { id: "no-both-know", label: "No — SW2 learned HOST-D when SW1 did" },
        { id: "drop", label: "SW2 drops frames for MACs it doesn't know" },
      ],
      correctOptionId: "yes",
      explanation: "Each bridge decides from its own table. HOST-D's frames never crossed the inter-switch link, so SW2 has no entry and must flood. When the copy reaches SW1, SW1's own lookup hits.",
    },
  },
  {
    id: "c-sends",
    label: "HOST-C sends to HOST-D",
    narrative: `Destination ${SWF_MAC["HOST-D"]}, source ${SWF_MAC["HOST-C"]}, into SW2 ge-0/0/2.`,
    run: (s) => ({ state: hostSend(idle(s), "c-sends", "HOST-C", F.cToD()), events: [ev("PACKET_SENT", "c-sends", "HOST-C → HOST-D")] }),
    packet: pkt,
  },
  {
    id: "sw2-partial",
    label: "SW2: unknown unicast → flood",
    narrative: `SW2 learns HOST-C → ge-0/0/2 and looks up HOST-D: MISS. It floods out ge-0/0/1 (HOST-B, which will discard it) and ${PRIMARY_PORT}.`,
    run: (s) => ({ state: switchStep(s, "sw2-partial", "SW2", "ge-0/0/2", F.cToD(), "tx"), events: [ev("PACKET_SENT", "sw2-partial", "SW2 floods — HOST-D unknown here")] }),
    packet: pkt,
    whatChanged: (_p, n) => ["SW2 lookup HOST-D: MISS → flood", `SW2 FDB: ${fdbLine(n, "SW2")}`],
  },
  {
    id: "sw1-partial",
    label: "SW1: known unicast → one port",
    narrative: `SW1 learns HOST-C → ${PRIMARY_PORT}, then looks up HOST-D: HIT on ge-0/0/2. Same frame, same destination — flooded at SW2, forwarded to one port at SW1. Two bridges, two independent lookups.`,
    run: (s) => ({ state: switchStep(s, "sw1-partial", "SW1", PRIMARY_PORT, arrived(F.cToD(), "SW2", "SW1"), "tx"), events: [ev("PACKET_SENT", "sw1-partial", "SW1 forwards known unicast")] }),
    packet: pkt,
    whatChanged: (_p, n) => ["SW1 lookup HOST-D: HIT → ge-0/0/2 only", `SW1 FDB: ${fdbLine(n, "SW1")}`],
  },
  {
    id: "bcast-send",
    label: "HOST-D sends a broadcast",
    narrative: `HOST-D sends an ARP request (the ARP lesson covers what's inside): destination ${BROADCAST_MAC}, source ${SWF_MAC["HOST-D"]}, EtherType 0x0806. What matters here is only how the switches treat the broadcast address.`,
    run: (s) => ({ state: hostSend(idle(s), "bcast-send", "HOST-D", F.dBcast()), events: [ev("PACKET_SENT", "bcast-send", "HOST-D broadcasts")] }),
    packet: pkt,
  },
  {
    id: "bcast-sw1",
    label: "SW1 floods the broadcast",
    narrative: `SW1 refreshes HOST-D on ge-0/0/2 and floods the broadcast out ge-0/0/1 (HOST-A) and ${PRIMARY_PORT} — every forwarding port except the ingress. ${SECONDARY_PORT} is disabled, so it is not used.`,
    run: (s) => ({ state: switchStep(s, "bcast-sw1", "SW1", "ge-0/0/2", F.dBcast(), "tx"), events: [ev("PACKET_SENT", "bcast-sw1", "SW1 floods broadcast")] }),
    packet: pkt,
    whatChanged: () => [`Broadcast out ge-0/0/1 and ${PRIMARY_PORT}`],
  },
  {
    id: "bcast-sw2",
    label: "SW2 floods it on",
    narrative: `SW2 receives the broadcast on ${PRIMARY_PORT}, learns HOST-D → ${PRIMARY_PORT} (the first frame from HOST-D it has ever seen) and floods out ge-0/0/1 and ge-0/0/2. HOST-A, HOST-B and HOST-C each got exactly one copy: the broadcast reached the whole Layer-2 domain, across both switches.`,
    run: (s) => ({ state: switchStep(s, "bcast-sw2", "SW2", PRIMARY_PORT, arrived(F.dBcast(), "SW1", "SW2"), "tx"), events: [ev("PACKET_SENT", "bcast-sw2", "SW2 floods broadcast")] }),
    packet: pkt,
    whatChanged: (_p, n) => [`SW2 FDB: ${fdbLine(n, "SW2")}`, "One copy per host — the whole broadcast domain"],
  },
  {
    id: "predict-bcast-vs-unknown",
    label: "Predict: two kinds of flood",
    narrative: "The very first HOST-A → HOST-B frame was flooded, and so was this broadcast.",
    packet: pkt,
    question: {
      prompt: "SW2 now knows every host. Which of these would SW2 still flood?",
      options: [
        { id: "bcast", label: `A broadcast to ${BROADCAST_MAC} — it is addressed to every station` },
        { id: "unicast", label: "A unicast to HOST-B" },
        { id: "neither", label: "Neither — a full FDB stops all flooding" },
        { id: "both", label: "Both, because flooding is how multi-switch LANs work" },
      ],
      correctOptionId: "bcast",
      explanation: "Unknown unicast is flooded because a lookup MISSED, and stops being flooded once the bridge learns the destination. A broadcast is flooded because of what its destination means — every station — and no FDB entry ever changes that.",
    },
  },
  {
    id: "incident-intro",
    label: "Incident: a cable for 'redundancy'",
    narrative: `A technician enables ${SECONDARY_PORT} on SW1 and SW2 "for redundancy". Now BOTH SW1↔SW2 links forward. No STP or any other loop-prevention mechanism is running in this modeled incident. Soon, users report duplicate traffic and a very busy network.`,
    run: (s) => {
      const hop: FundHop = {
        stepId: "incident-intro",
        device: "SW1",
        stages: [
          { id: "link", label: "Port state change", detail: `${SECONDARY_PORT} → enabled, forwarding` },
          { id: "l2", label: "Loop prevention", detail: "none running in this incident" },
          { id: "paths", label: "SW1↔SW2 forwarding paths", detail: `2 (${PRIMARY_PORT}, ${SECONDARY_PORT})` },
        ],
        activeStageId: "paths",
        ingressInterfaceId: SECONDARY_PORT,
        lookupType: "Port event",
        lookupKey: `${SECONDARY_PORT} enabled`,
        lookupResult: "two forwarding links between the same two bridges",
        action: "LINK ENABLED",
        reason: `${SECONDARY_PORT} is now a forwarding port on both switches. A learning bridge floods out every forwarding port, so from now on floods use both inter-switch links.`,
        input: `SW1↔SW2 forwarding links: ${PRIMARY_PORT}`,
        output: `SW1↔SW2 forwarding links: ${PRIMARY_PORT}, ${SECONDARY_PORT}`,
      };
      return { state: { ...idle(s), secondaryUp: true, faultActive: true, hops: [...s.hops, hop] }, events: [ev("STEP_ENTERED", "incident-intro", "Secondary link enabled")] };
    },
    whatChanged: () => [`${SECONDARY_PORT} forwarding on SW1 and SW2`, "Two active SW1↔SW2 links", "No loop prevention running"],
  },
  {
    id: "predict-loop",
    label: "Predict: a broadcast now",
    narrative: "HOST-A is about to send an ordinary broadcast (another ARP request).",
    question: {
      prompt: "How many copies of HOST-A's broadcast will SW1 send toward SW2?",
      options: [
        { id: "two", label: "Two — one out each forwarding inter-switch port" },
        { id: "one", label: "One — a switch only ever uses one link to a neighbour switch" },
        { id: "zero", label: "None — broadcasts stay on the switch they entered" },
        { id: "load", label: "One, alternating between the links for load sharing" },
      ],
      correctOptionId: "two",
      explanation: "Flooding means every forwarding port except the ingress. SW1 has no idea the two ports lead to the same switch — each is just a forwarding port — so one copy leaves on each.",
    },
  },
  {
    id: "loop-send",
    label: "HOST-A broadcasts",
    narrative: `HOST-A sends an ARP request: destination ${BROADCAST_MAC}, source ${A}. It enters SW1 on ge-0/0/1.`,
    run: (s) => {
      const f = F.loop();
      const sent = hostSend(idle(s), "loop-send", "HOST-A", f);
      return { state: { ...sent, inFlight: [{ sw: "SW1", ingress: "ge-0/0/1", frame: arrived(f, "HOST-A", "SW1") }], loop: undefined }, events: [ev("PACKET_SENT", "loop-send", "HOST-A broadcasts")] };
    },
    packet: pkt,
  },
  {
    id: "wave-1",
    label: "Wave 1: SW1 floods on both links",
    narrative: `SW1 refreshes HOST-A on ge-0/0/1 and floods: ge-0/0/2 (HOST-D), ${PRIMARY_PORT} AND ${SECONDARY_PORT}. Two copies of the same broadcast are now heading to SW2.`,
    run: (s) => ({ state: loopWave(s, "wave-1", "SW1", 1), events: [ev("PACKET_SENT", "wave-1", "Wave 1")] }),
    packet: pkt,
    whatChanged: (_p, n) => [`Copies sent: ${n.loop?.framesSent ?? 0}`, `Copies between the switches: ${n.loop?.circulating ?? 0}`],
  },
  {
    id: "wave-2",
    label: "Wave 2: SW2 floods both copies",
    narrative: `SW2 receives one copy on ${PRIMARY_PORT} and one on ${SECONDARY_PORT}, and treats EACH as a new broadcast. The copy from ${PRIMARY_PORT} is flooded to HOST-B, HOST-C and out ${SECONDARY_PORT}; the copy from ${SECONDARY_PORT} to HOST-B, HOST-C and out ${PRIMARY_PORT}. HOST-B and HOST-C each receive the broadcast twice, and two copies head back to SW1. SW2 also sees source ${A} on ${PRIMARY_PORT}, then on ${SECONDARY_PORT}.`,
    run: (s) => ({ state: loopWave(s, "wave-2", "SW2", 2), events: [ev("PACKET_SENT", "wave-2", "Wave 2")] }),
    packet: pkt,
    whatChanged: (_p, n) => [`HOST-B received ${n.loop?.received["HOST-B"] ?? 0} copies, HOST-C ${n.loop?.received["HOST-C"] ?? 0}`, `SW2: HOST-A → ${n.fdb.SW2.find((e) => e.mac === A)?.port ?? "?"}`, `Copies sent so far: ${n.loop?.framesSent ?? 0}`],
  },
  {
    id: "predict-ttl",
    label: "Predict: what stops it?",
    narrative: "IPv4 packets carry a TTL that each router decrements. Look at the frame in the inspector.",
    packet: pkt,
    question: {
      prompt: "Does an Ethernet frame carry a TTL that stops this Layer-2 loop?",
      options: [
        { id: "no", label: "No — the Ethernet header has destination, source and EtherType, but no hop count" },
        { id: "yes", label: "Yes — every switch decrements an Ethernet TTL and drops the frame at zero" },
        { id: "fcs", label: "Yes — the FCS changes on every hop and eventually fails" },
        { id: "ipv4", label: "The IPv4 TTL inside stops it, because switches decrement it" },
      ],
      correctOptionId: "no",
      explanation: "Ordinary Ethernet forwarding has no TTL. A switch forwards the frame unchanged — it does not even look at the IPv4 header inside, and this ARP frame has no IPv4 header at all. Nothing in the frame ever runs out.",
    },
  },
  {
    id: "wave-3",
    label: "Wave 3: back at SW1",
    narrative: `Both copies return to SW1 — one on ${PRIMARY_PORT}, one on ${SECONDARY_PORT}. SW1 floods each again: HOST-A receives its OWN broadcast back (twice), HOST-D gets two more copies, and two new copies head to SW2. SW1 has now seen source ${A} arrive on ge-0/0/1, then on the inter-switch ports: its HOST-A entry moves off the real host port.`,
    run: (s) => ({ state: loopWave(s, "wave-3", "SW1", 3), events: [ev("PACKET_SENT", "wave-3", "Wave 3")] }),
    packet: pkt,
    whatChanged: (_p, n) => [`SW1: HOST-A → ${n.fdb.SW1.find((e) => e.mac === A)?.port ?? "?"} (HOST-A is really on ge-0/0/1)`, `Copies sent so far: ${n.loop?.framesSent ?? 0}`, `Still between the switches: ${n.loop?.circulating ?? 0}`],
  },
  {
    id: "wave-stop",
    label: "The visualization stops here",
    narrative: `The visualization stops here for clarity; Ethernet itself has no TTL field that would terminate this forwarding loop. In the real network the two copies keep circling after wave ${LOOP_WAVES_SHOWN}, every wave re-delivers the broadcast to every host, and every NEW broadcast or unknown-unicast frame adds more copies that never leave. With more redundant paths, each copy would multiply on every pass. That is a broadcast storm.`,
    run: (s) => ({ state: idle(s), events: [] }),
    whatChanged: (_p, n) => [`Wave ${n.loop?.wave ?? 0} of an endless loop shown`, `${n.loop?.circulating ?? 0} copies still circulating`, "Stopped by the lesson, not by any protocol field"],
  },
  {
    id: "predict-flap",
    label: "Predict: the moving MAC",
    narrative: "Open SW1 and SW2: HOST-A's entry has moved between ports although HOST-A never moved.",
    question: {
      prompt: "Why is HOST-A's MAC moving between inter-switch ports during the loop?",
      options: [
        { id: "looped", label: "Looped copies carrying HOST-A's source MAC keep arriving on different ports, and source learning records the latest one" },
        { id: "corrupt", label: "The switches randomly corrupt their FDBs under load" },
        { id: "host-moved", label: "HOST-A is physically moving between switches" },
        { id: "dst", label: "The switches learn from the destination MAC FF:FF:FF:FF:FF:FF" },
      ],
      correctOptionId: "looped",
      explanation: "Nothing is broken inside the switches. Source learning does exactly what it always does: the same source MAC arrives on ge-0/0/1, then on an inter-switch port, then on the other one, so the entry follows it. That constant movement is called MAC flapping.",
    },
  },
  {
    id: "symptom-send",
    label: "Symptom: HOST-D → HOST-A",
    narrative: "Freeze the moment. HOST-D sends an ordinary unicast frame to HOST-A, on the same switch.",
    run: (s) => ({ state: hostSend(idle(s), "symptom-send", "HOST-D", F.symptom()), events: [ev("PACKET_SENT", "symptom-send", "HOST-D → HOST-A")] }),
    packet: pkt,
  },
  {
    id: "symptom-sw1",
    label: "Symptom: misdirected unicast",
    narrative: "SW1 looks up HOST-A and gets a HIT — but on an inter-switch port, because the looped copies moved the entry. The frame is sent toward SW2 instead of out ge-0/0/1, one port away from HOST-A. Known unicast is now unreliable too.",
    run: (s) => ({ state: switchStep(s, "symptom-sw1", "SW1", "ge-0/0/2", F.symptom(), "tx"), events: [ev("PACKET_SENT", "symptom-sw1", "SW1 forwards toward the wrong port")] }),
    packet: pkt,
    whatChanged: (_p, n) => [`SW1 lookup HOST-A → ${n.fdb.SW1.find((e) => e.mac === A)?.port ?? "?"} (real port: ge-0/0/1)`],
  },
  {
    id: "trouble-question",
    label: "Diagnose the incident",
    narrative: "Duplicate broadcasts, a copy count that never stops growing, a flapping MAC and misdirected unicast — all since the cabling change.",
    question: {
      prompt: "What is the root cause?",
      options: [
        { id: "loop", label: "Two active SW1↔SW2 links with no loop prevention form a Layer-2 loop" },
        { id: "fdb", label: "SW1's FDB is corrupted and needs clearing" },
        { id: "host", label: "HOST-A's NIC is sending duplicate frames" },
        { id: "arp", label: "Too many ARP requests on the LAN" },
      ],
      correctOptionId: "loop",
      explanation: "Every symptom follows from the loop. Floods leave on both inter-switch links, come back on the other one, and Ethernet has nothing to stop them. The FDB movement is a consequence, and HOST-A sent its broadcast only once.",
    },
  },
  {
    id: "diagnostic-layers",
    label: "Troubleshooting layers",
    narrative: "Walk the layers: physical links, Layer-2 topology, the FDBs, and host delivery.",
  },
  {
    id: "repair-challenge",
    label: "Repair the Layer-2 topology",
    narrative: "Choose the change that fixes the cause you identified.",
    action: (s, payload) => ({ state: applySwfRepair(s, (payload as { choice: string }).choice), events: [ev("STEP_ENTERED", "repair-challenge", `Repair attempt: ${(payload as { choice: string }).choice}`)] }),
    requiresState: (s) => s.repaired,
  },
  {
    id: "verify-drain",
    label: "Verify: the loop drains",
    narrative: `${SECONDARY_PORT} is down on both switches: the copy that was on that cable is gone, and entries learned on it were flushed. The one copy left on ${PRIMARY_PORT} reaches SW2, which floods it to HOST-B and HOST-C — and has no second inter-switch port to send it back on. Nothing is circulating any more.`,
    run: (s) => ({ state: loopWave(s, "verify-drain", "SW2", s.loop?.wave ?? LOOP_WAVES_SHOWN, true), events: [ev("PACKET_SENT", "verify-drain", "Loop drains")] }),
    packet: pkt,
    whatChanged: (_p, n) => [`Copies circulating: ${n.loop?.circulating ?? 0}`, `SW2: HOST-A → ${n.fdb.SW2.find((e) => e.mac === A)?.port ?? "no entry"}`],
  },
  {
    id: "verify-send",
    label: "Verify: one broadcast",
    narrative: `HOST-A broadcasts again. SW1 learns HOST-A → ge-0/0/1 — back on the real host port — and floods out ge-0/0/2 and ${PRIMARY_PORT} only.`,
    run: (s) => {
      const f = F.verifyBcast();
      return { state: switchStep(hostSend(idle(s), "verify-send", "HOST-A", f), "verify-send", "SW1", "ge-0/0/1", f, "tx"), events: [ev("PACKET_SENT", "verify-send", "SW1 floods once")] };
    },
    packet: pkt,
    whatChanged: (_p, n) => [`SW1: HOST-A → ${n.fdb.SW1.find((e) => e.mac === A)?.port ?? "?"}`, `One copy toward SW2 (${PRIMARY_PORT})`],
  },
  {
    id: "verify-sw2",
    label: "Verify: one copy per host",
    narrative: "SW2 floods the single copy to HOST-B and HOST-C. Every host receives the broadcast exactly once, and nothing comes back.",
    run: (s) => ({ state: switchStep(s, "verify-sw2", "SW2", PRIMARY_PORT, arrived(F.verifyBcast(), "SW1", "SW2"), "tx"), events: [ev("PACKET_SENT", "verify-sw2", "SW2 floods once")] }),
    packet: pkt,
    whatChanged: (_p, n) => [`SW2: HOST-A → ${n.fdb.SW2.find((e) => e.mac === A)?.port ?? "?"}`, "Broadcast delivered once per host"],
  },
  {
    id: "verify-unicast-sw2",
    label: "Verify: known unicast (SW2)",
    narrative: `HOST-B sends a unicast frame to HOST-A. SW2 finds HOST-A → ${PRIMARY_PORT} and forwards it there only.`,
    run: (s) => {
      const f = F.verifyUni();
      return { state: switchStep(hostSend(idle(s), "verify-unicast-sw2", "HOST-B", f), "verify-unicast-sw2", "SW2", "ge-0/0/1", f, "tx"), events: [ev("PACKET_SENT", "verify-unicast-sw2", "SW2 known unicast")] };
    },
    packet: pkt,
  },
  {
    id: "verify-unicast-sw1",
    label: "Verify: known unicast (SW1)",
    narrative: "SW1 finds HOST-A → ge-0/0/1 and forwards it there. The entries are stable and point at the right ports again. Service restored.",
    run: (s) => ({ state: switchStep(s, "verify-unicast-sw1", "SW1", PRIMARY_PORT, arrived(F.verifyUni(), "SW2", "SW1"), "tx"), events: [ev("PACKET_SENT", "verify-unicast-sw1", "SW1 known unicast")] }),
    packet: pkt,
    whatChanged: (_p, n) => [`SW1 FDB: ${fdbLine(n, "SW1")}`, `SW2 FDB: ${fdbLine(n, "SW2")}`],
  },
  {
    id: "loop-prevention",
    label: "Why loop prevention exists",
    narrative: "Redundant links are valuable — but with plain learning bridges, two active paths between the same switches form a loop. Real networks keep the redundancy and run a loop-prevention protocol so only a loop-free set of links forwards at any moment. The standard class of mechanism is the Spanning Tree Protocol family, covered in a later Enterprise lesson. Here, the fix was simply to go back to one forwarding path.",
    run: (s) => ({ state: idle(s), events: [] }),
  },
  {
    id: "complete",
    label: "Lesson complete",
    narrative: "Each bridge learned on its own, looked up on its own, and flooded or forwarded on its own — which is why a frame can be known at one switch and unknown at the next, why a broadcast reaches the whole domain, and why a second active path turned into an endless loop.",
  },
];

/** FDB rows for inspectors and panels. */
export const swfFdbRows = (s: SwfState, sw: SwfSwitch) => s.fdb[sw].map((e) => ({ label: `${e.mac} (${macName(e.mac)})`, value: `${e.port} · ${e.type}${isTrunk(e.port) ? " · beyond the other switch" : " · local"}` }));
