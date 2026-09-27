import type { PacketVisual, PVEvent, PVEventType, ScenarioStep } from "../types";
import type { ProcessingStage } from "@/components/network3d/types";
import type { FundHop } from "@/components/lesson/fundamentalsTrace";

/**
 * Ethernet & Switching — the first Fundamentals lesson. One learning bridge (SW1, IEEE 802.1D behaviour) with three
 * hosts and an unmanaged hot-desk switch (DESK-SW) on ge-0/0/4.
 *
 * Modeled exactly (IEEE 802.1D / 802.1Q transparent-bridge concepts):
 * - A switch learns ONLY from the SOURCE MAC of a frame, against the ingress port.
 * - Destination lookup: known unicast → one egress port; unknown unicast → flood to every other port in the
 *   broadcast domain (never back out the ingress port) with the destination MAC left unchanged; broadcast
 *   (FF:FF:FF:FF:FF:FF) → flooded because it is addressed to everyone, regardless of FDB contents.
 * - Hosts filter on destination MAC: a flooded unicast not addressed to them is discarded.
 * - Dynamic entries age out after the aging time (IEEE 802.1D recommended default 300 s) without refresh.
 * - A port going DOWN flushes the dynamic entries learned on it (the common managed-switch behaviour); a port that
 *   stays UP keeps them — which is exactly how a stale entry survives behind DESK-SW in the incident.
 * The frame itself is never modified by a switch.
 */

export const BROADCAST_MAC = "FF:FF:FF:FF:FF:FF";
export const ETH_MAC = { "HOST-A": "00:11:22:33:44:0A", "HOST-B": "00:11:22:33:44:0B", "HOST-C": "00:11:22:33:44:0C" } as const;
export type EthHost = keyof typeof ETH_MAC;
export type EthSwitch = "SW1" | "DESK-SW";
export type EthDevice = EthHost | EthSwitch;
export const ETH_DEVICES: EthDevice[] = ["HOST-A", "HOST-B", "HOST-C", "SW1", "DESK-SW"];
/** IEEE 802.1D recommended default aging time. */
export const FDB_AGING_SEC = 300;

/** SW1 port map. HOST-B starts on ge-0/0/2; DESK-SW (unmanaged) is permanently on ge-0/0/4. */
export const SW1_PORTS = ["ge-0/0/1", "ge-0/0/2", "ge-0/0/3", "ge-0/0/4"] as const;
export const DESK_PORTS = ["port 1", "port 2"] as const;
export type HostBLocation = "SW1 ge-0/0/2" | "DESK-SW port 2";

export interface FdbEntry {
  mac: string;
  port: string;
  type: "dynamic";
  /** Scenario clock (seconds) when this MAC was last seen as a SOURCE on this port. */
  lastSeen: number;
}

export interface EthFloodCopy {
  id: string;
  fromId: string;
  toId: string;
  packet: PacketVisual;
}

export type EthDecisionKind = "learn" | "unknown-unicast" | "known-unicast" | "broadcast" | "accept" | "discard" | "lost";

export interface EthState {
  hops: FundHop[];
  fdb: Record<EthSwitch, FdbEntry[]>;
  clock: number;
  hostB: HostBLocation;
  /** Ports that are currently down (no link). */
  downPorts: string[];
  packet?: PacketVisual;
  flood: EthFloodCopy[];
  /** The latest forwarding/filtering decision, for callouts and inspectors — never part of the frame. */
  decision?: { device: EthDevice; kind: EthDecisionKind; text: string };
  faultActive: boolean;
  repairAttempt?: { choice: string; correct: boolean };
  repaired: boolean;
}

export function createEthState(): EthState {
  return { hops: [], fdb: { SW1: [], "DESK-SW": [] }, clock: 0, hostB: "SW1 ge-0/0/2", downPorts: [], flood: [], faultActive: false, repaired: false };
}

// ---------------------------------------------------------------------------------------------------------------
// Frames — only real Ethernet II fields
// ---------------------------------------------------------------------------------------------------------------
const ETH_COLOR = "#94a3b8";
export function ethFrame(id: string, from: string, to: string, src: string, dst: string, etherType: "0x0800" | "0x0806"): PacketVisual {
  const bcast = dst === BROADCAST_MAC;
  return {
    id,
    protocol: etherType === "0x0806" ? "ARP" : "ETHERNET",
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
          { label: "EtherType", value: etherType === "0x0800" ? "0x0800 (IPv4)" : "0x0806 (ARP)" },
        ],
      },
      { name: "Payload", color: etherType === "0x0800" ? "#60a5fa" : "#f59e0b", fields: [{ label: "Carries", value: etherType === "0x0800" ? "IPv4 packet" : "ARP request" }] },
      { name: "FCS", color: ETH_COLOR, fields: [{ label: "Frame Check Sequence", value: "CRC-32 over the frame" }] },
    ],
  };
}

const fieldOf = (p: PacketVisual, label: string) => p.layers[0]?.fields.find((f) => f.label === label)?.value ?? "";
export const frameDst = (p: PacketVisual) => fieldOf(p, "Destination MAC");
export const frameSrc = (p: PacketVisual) => fieldOf(p, "Source MAC");

/** Wire-level frame stack for device traces — the same fields the packet carries. */
export function frameStack(p: PacketVisual) {
  return [
    { id: "eth", text: `Ethernet II · dst ${frameDst(p)} · src ${frameSrc(p)} · ${fieldOf(p, "EtherType")}`, tone: "generic" as const },
    { id: "payload", text: `Payload · ${p.layers[1]?.fields[0]?.value ?? ""}`, tone: "ip" as const },
    { id: "fcs", text: "FCS · CRC-32", tone: "generic" as const },
  ];
}

export const macName = (mac: string): string => {
  if (mac === BROADCAST_MAC) return "broadcast";
  const hit = (Object.keys(ETH_MAC) as EthHost[]).find((h) => ETH_MAC[h] === mac);
  return hit ?? mac;
};

// ---------------------------------------------------------------------------------------------------------------
// Stage tables
// ---------------------------------------------------------------------------------------------------------------
export const SW_STAGES: ProcessingStage[] = [
  { id: "rx", label: "Receive frame + check FCS" },
  { id: "learn", label: "Learn SOURCE MAC → ingress port" },
  { id: "lookup", label: "Look up DESTINATION MAC" },
  { id: "decide", label: "Forward, flood or filter" },
  { id: "tx", label: "Transmit (frame unchanged)" },
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

// ---------------------------------------------------------------------------------------------------------------
// Bridge logic (pure)
// ---------------------------------------------------------------------------------------------------------------
/** Where SW1 is physically connected to each neighbour right now. */
export function sw1PortNeighbor(s: EthState, port: string): EthDevice | undefined {
  if (s.downPorts.includes(`SW1 ${port}`)) return undefined;
  if (port === "ge-0/0/1") return "HOST-A";
  if (port === "ge-0/0/2") return s.hostB === "SW1 ge-0/0/2" ? "HOST-B" : undefined;
  if (port === "ge-0/0/3") return "HOST-C";
  if (port === "ge-0/0/4") return "DESK-SW";
  return undefined;
}
export function deskPortNeighbor(s: EthState, port: string): EthDevice | undefined {
  if (port === "port 1") return "SW1";
  if (port === "port 2") return s.hostB === "DESK-SW port 2" ? "HOST-B" : undefined;
  return undefined;
}
const neighborOf = (s: EthState, sw: EthSwitch, port: string) => (sw === "SW1" ? sw1PortNeighbor(s, port) : deskPortNeighbor(s, port));
const portsOf = (sw: EthSwitch): readonly string[] => (sw === "SW1" ? SW1_PORTS : DESK_PORTS);
const upPorts = (s: EthState, sw: EthSwitch) => portsOf(sw).filter((p) => neighborOf(s, sw, p) !== undefined);

/** Source learning: add or refresh (MAC → ingress port). A MAC seen on a new port MOVES there. */
export function learn(fdb: FdbEntry[], mac: string, port: string, now: number): FdbEntry[] {
  return [...fdb.filter((e) => e.mac !== mac), { mac, port, type: "dynamic" as const, lastSeen: now }].sort((a, b) => a.mac.localeCompare(b.mac));
}
export function lookup(fdb: FdbEntry[], mac: string): FdbEntry | undefined {
  return fdb.find((e) => e.mac === mac);
}

export interface BridgeResult {
  fdb: FdbEntry[];
  learned: string;
  kind: "unknown-unicast" | "known-unicast" | "broadcast";
  egress: string[];
  lookupResult: string;
}
/** One frame through one learning bridge. Never modifies the frame. */
export function bridge(s: EthState, sw: EthSwitch, ingress: string, frame: PacketVisual): BridgeResult {
  const src = frameSrc(frame);
  const dst = frameDst(frame);
  const prior = lookup(s.fdb[sw], src);
  const fdb = learn(s.fdb[sw], src, ingress, s.clock);
  const learned = prior && prior.port !== ingress ? `${src} MOVED ${prior.port} → ${ingress}` : prior ? `${src} refreshed on ${ingress}` : `${src} learned on ${ingress}`;
  const others = upPorts(s, sw).filter((p) => p !== ingress);
  if (dst === BROADCAST_MAC) return { fdb, learned, kind: "broadcast", egress: others, lookupResult: "broadcast address — flood" };
  const hit = lookup(fdb, dst);
  if (!hit) return { fdb, learned, kind: "unknown-unicast", egress: others, lookupResult: `${dst} not in FDB — unknown unicast` };
  return { fdb, learned, kind: "known-unicast", egress: hit.port === ingress ? [] : [hit.port], lookupResult: `${dst} → ${hit.port}` };
}

// ---------------------------------------------------------------------------------------------------------------
// Step helpers
// ---------------------------------------------------------------------------------------------------------------
const ev = (type: PVEventType, stepId: string, message: string): PVEvent => ({ type, stepId, timestamp: Date.now(), message });

function hostSend(s: EthState, stepId: string, host: EthHost, frame: PacketVisual, nextHop: EthDevice): EthState {
  const port = host === "HOST-B" ? (s.hostB === "SW1 ge-0/0/2" ? "eth0 → SW1 ge-0/0/2" : "eth0 → DESK-SW port 2") : `eth0 → SW1 ${host === "HOST-A" ? "ge-0/0/1" : "ge-0/0/3"}`;
  const hop: FundHop = {
    stepId,
    device: host,
    stages: withDetail(HOST_TX_STAGES, { build: `dst ${frameDst(frame)} · src ${frameSrc(frame)}`, tx: port }),
    activeStageId: "tx",
    egressInterfaceId: "eth0",
    lookupType: "Frame addressing",
    lookupKey: `destination ${frameDst(frame)}`,
    lookupResult: frameDst(frame) === BROADCAST_MAC ? "broadcast — every host in the domain" : `unicast to ${macName(frameDst(frame))}`,
    action: "SEND",
    reason: `${host} builds an Ethernet II frame with its own MAC as the source and transmits it on its only link.`,
    input: "(originated here)",
    output: `${frameDst(frame)} ← ${frameSrc(frame)}`,
    nextHopId: nextHop,
    after: frameStack(frame),
  };
  return { ...s, hops: [...s.hops, hop], packet: frame, flood: [], decision: undefined };
}

/** SW1/DESK-SW processes `frame` (already sitting at the switch) up to the stage given, and emits it out of every egress port. */
function switchStep(s: EthState, stepId: string, sw: EthSwitch, ingress: string, frame: PacketVisual, stage: "learn" | "lookup" | "tx", stayAt?: { from: string; to: string }): EthState {
  const r = bridge(s, sw, ingress, frame);
  const fdb = { ...s.fdb, [sw]: r.fdb };
  const kindText = r.kind === "broadcast" ? "BROADCAST → flood" : r.kind === "unknown-unicast" ? "UNKNOWN UNICAST → flood" : r.egress.length ? "KNOWN UNICAST → forward" : "FILTER (destination is on the ingress port)";
  const stageDetail: Partial<Record<string, string>> = { rx: `on ${ingress}`, learn: r.learned };
  if (stage !== "learn") {
    stageDetail.lookup = r.lookupResult;
    stageDetail.decide = r.egress.length ? `${kindText} · out ${r.egress.join(", ")}` : kindText;
  }
  if (stage === "tx") stageDetail.tx = r.egress.length ? `out ${r.egress.join(", ")}` : "nothing to send";
  const hop: FundHop = {
    stepId,
    device: sw,
    stages: withDetail(SW_STAGES, stageDetail),
    activeStageId: stage,
    ingressInterfaceId: ingress,
    egressInterfaceId: stage === "tx" ? r.egress[0] : undefined,
    egressInterfaceIds: stage === "tx" ? r.egress : undefined,
    lookupType: "FDB (MAC table)",
    lookupKey: stage === "learn" ? `source ${frameSrc(frame)}` : `destination ${frameDst(frame)}`,
    lookupResult: stage === "learn" ? r.learned : r.lookupResult,
    action: stage === "learn" ? "LEARN" : stage === "lookup" ? `LOOKUP · ${r.kind === "known-unicast" ? "HIT" : r.kind === "broadcast" ? "BROADCAST" : "MISS"}` : kindText,
    reason:
      stage === "learn"
        ? `${sw} records WHERE the sender lives: the source MAC ${frameSrc(frame)} arrived on ${ingress}. The destination field is never used for learning.`
        : r.kind === "broadcast"
          ? `The destination is ${BROADCAST_MAC}, addressed to every station — ${sw} floods it out every other port regardless of what the FDB holds.`
          : r.kind === "unknown-unicast"
            ? `${frameDst(frame)} is not in ${sw}'s FDB, so ${sw} cannot know which port leads to it: it floods the frame (destination MAC unchanged) out every other port.`
            : `${frameDst(frame)} is in ${sw}'s FDB on ${r.egress[0] ?? ingress} — the frame leaves only that port.`,
    input: `${frameDst(frame)} ← ${frameSrc(frame)} on ${ingress}`,
    output: stage === "tx" ? (r.egress.length ? `same frame out ${r.egress.join(", ")}` : "not forwarded") : stage === "learn" ? r.learned : r.lookupResult,
    nextHopId: stage === "tx" ? (r.egress[0] ? neighborOf(s, sw, r.egress[0]) : undefined) : undefined,
    before: frameStack(frame),
    after: frameStack(frame),
  };
  const next: EthState = { ...s, fdb, hops: [...s.hops, hop] };
  const decision = { device: sw as EthDevice, kind: (stage === "learn" ? "learn" : r.kind) as EthDecisionKind, text: stage === "learn" ? `${sw} learned ${macName(frameSrc(frame))} (${frameSrc(frame)}) on ${ingress}` : `${sw}: ${kindText}${r.egress.length ? ` · out ${r.egress.join(", ")}` : ""}` };
  if (stage !== "tx") return { ...next, packet: stayAt ? { ...frame, from: stayAt.from, to: stayAt.to } : frame, flood: [], decision };
  const copies = r.egress.map((port) => ({ port, to: neighborOf(s, sw, port) })).filter((c): c is { port: string; to: EthDevice } => c.to !== undefined);
  const [main, ...rest] = copies;
  return {
    ...next,
    packet: main ? { ...frame, id: `${stepId}-${main.to}`, from: sw, to: main.to } : undefined,
    flood: rest.map((c) => ({ id: `${stepId}-${c.to}`, fromId: sw, toId: c.to, packet: { ...frame, id: `${stepId}-${c.to}`, from: sw, to: c.to } })),
    decision,
  };
}

function hostReceive(s: EthState, stepId: string, host: EthHost, frame: PacketVisual): EthState {
  const dst = frameDst(frame);
  const mine = dst === ETH_MAC[host] || dst === BROADCAST_MAC;
  const hop: FundHop = {
    stepId,
    device: host,
    stages: withDetail(HOST_RX_STAGES, { rx: "FCS OK", filter: `${dst} vs my ${ETH_MAC[host]} → ${mine ? "match" : "no match"}`, deliver: mine ? "accepted" : "discarded" }),
    activeStageId: "deliver",
    ingressInterfaceId: "eth0",
    lookupType: "Destination-MAC filter",
    lookupKey: dst,
    lookupResult: mine ? (dst === BROADCAST_MAC ? "broadcast — accepted" : "my MAC — accepted") : `not ${ETH_MAC[host]} — discarded`,
    action: mine ? "ACCEPT" : "DISCARD",
    reason: mine ? `The destination MAC is ${dst === BROADCAST_MAC ? "the broadcast address" : `${host}'s own MAC`}, so the NIC passes the payload up.` : `The frame reached ${host} only because it was flooded; its destination is ${dst} (${macName(dst)}), not ${ETH_MAC[host]}, so the NIC drops it.`,
    input: `${dst} ← ${frameSrc(frame)}`,
    output: mine ? "payload delivered to the upper layer" : "dropped by the NIC",
    before: frameStack(frame),
  };
  return { ...s, hops: [...s.hops, hop], decision: { device: host, kind: mine ? "accept" : "discard", text: `${host}: ${mine ? "accepted" : "discarded"} (dst ${macName(dst)})` } };
}

const aToB = (id: string) => ethFrame(id, "HOST-A", "SW1", ETH_MAC["HOST-A"], ETH_MAC["HOST-B"], "0x0800");
const bToA = (id: string, from: string, to: string) => ethFrame(id, from, to, ETH_MAC["HOST-B"], ETH_MAC["HOST-A"], "0x0800");
const cBcast = (id: string) => ethFrame(id, "HOST-C", "SW1", ETH_MAC["HOST-C"], BROADCAST_MAC, "0x0806");

const fdbLine = (sw: EthSwitch, s: EthState) => (s.fdb[sw].length ? s.fdb[sw].map((e) => `${macName(e.mac)} → ${e.port}`).join(", ") : "empty");

// ---------------------------------------------------------------------------------------------------------------
// Repair
// ---------------------------------------------------------------------------------------------------------------
export const ETH_REPAIR_OPTIONS = [
  { id: "clear-stale", label: "Clear SW1's stale dynamic FDB entry for HOST-B (00:11:22:33:44:0B)" },
  { id: "arp", label: "Have HOST-A send an ARP request for HOST-B" },
  { id: "static-ge4", label: "Add a static FDB entry: HOST-B → ge-0/0/4" },
  { id: "replace-cable", label: "Replace the ge-0/0/4 cable to DESK-SW" },
] as const;
export const ETH_REPAIR_CORRECT = "clear-stale";

export function applyEthRepair(s: EthState, choice: string): EthState {
  const correct = choice === ETH_REPAIR_CORRECT;
  if (!correct) return { ...s, repairAttempt: { choice, correct } };
  return { ...s, repairAttempt: { choice, correct }, repaired: true, faultActive: false, fdb: { ...s.fdb, SW1: s.fdb.SW1.filter((e) => e.mac !== ETH_MAC["HOST-B"]) }, packet: undefined, flood: [], decision: { device: "SW1", kind: "learn", text: "SW1: dynamic entry for HOST-B cleared" } };
}

// ---------------------------------------------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------------------------------------------
const idle = (s: EthState): EthState => ({ ...s, packet: undefined, flood: [], decision: undefined });

export const ethernetSwitchingSteps: ScenarioStep<EthState>[] = [
  {
    id: "intro",
    label: "One switch, one LAN",
    narrative: "Three hosts and a small hot-desk switch hang off one Ethernet switch, SW1. Everything here is one broadcast domain. In this lesson you will watch SW1 build its forwarding table (FDB) purely from the frames it sees.",
  },
  {
    id: "frame-anatomy",
    label: "Anatomy of an Ethernet frame",
    narrative: "An Ethernet II frame carries: Destination MAC (who it is for), Source MAC (who sent it), EtherType (what the payload is — 0x0800 IPv4, 0x0806 ARP), the payload, and a 4-byte FCS (a CRC-32 the receiver uses to detect corruption). A switch reads the two MAC fields; it never rewrites them.",
  },
  {
    id: "mac-addresses",
    label: "MAC addresses and ports",
    narrative: "Each NIC has a 48-bit MAC: HOST-A 00:11:22:33:44:0A, HOST-B …:0B, HOST-C …:0C. SW1's ports are ge-0/0/1 (HOST-A), ge-0/0/2 (HOST-B), ge-0/0/3 (HOST-C) and ge-0/0/4 (DESK-SW, an unmanaged desk switch with one free port).",
  },
  {
    id: "predict-empty-fdb",
    label: "Predict: SW1's FDB at boot",
    narrative: "SW1 has just powered on. No one has configured any MAC address on it.",
    question: {
      prompt: "What does SW1's forwarding database (MAC table) contain right now?",
      options: [
        { id: "empty", label: "Nothing — dynamic entries only appear as frames arrive" },
        { id: "all", label: "All three host MACs, read from the cables at link-up" },
        { id: "bcast", label: "Only the broadcast address FF:FF:FF:FF:FF:FF" },
        { id: "ips", label: "The hosts' IP addresses" },
      ],
      correctOptionId: "empty",
      explanation: "A learning switch starts empty. It learns a MAC only when a frame FROM that MAC arrives on a port. Link-up tells it nothing about addresses, and a switch's FDB maps MACs to ports — not IP addresses.",
    },
  },
  {
    id: "a-sends",
    label: "HOST-A sends to HOST-B",
    narrative: "HOST-A transmits a frame: destination 00:11:22:33:44:0B (HOST-B), source 00:11:22:33:44:0A (itself), EtherType 0x0800. It arrives on SW1 ge-0/0/1.",
    run: (s) => ({ state: hostSend(s, "a-sends", "HOST-A", aToB("a-sends-frame"), "SW1"), events: [ev("PACKET_SENT", "a-sends", "HOST-A → HOST-B frame sent")] }),
    packet: (s) => s.packet,
    whatChanged: () => ["HOST-A built a unicast frame for HOST-B's MAC", "The frame is on the wire toward SW1 ge-0/0/1"],
  },
  {
    id: "predict-learn",
    label: "Predict: what does SW1 learn?",
    narrative: "The frame has arrived on ge-0/0/1. SW1 is about to update its FDB.",
    packet: (s) => s.packet,
    question: {
      prompt: "What does SW1 learn from this one frame?",
      options: [
        { id: "src", label: "00:11:22:33:44:0A (HOST-A) lives behind ge-0/0/1" },
        { id: "dst", label: "00:11:22:33:44:0B (HOST-B) lives behind ge-0/0/2" },
        { id: "both", label: "Both MACs, from the source and destination fields" },
        { id: "none", label: "Nothing until HOST-B replies" },
      ],
      correctOptionId: "src",
      explanation: "Learning uses the SOURCE MAC and the INGRESS port — the only fact the frame proves is where its sender is. The destination field says who it is for, not where they are.",
    },
  },
  {
    id: "sw1-learns-a",
    label: "SW1 learns HOST-A",
    narrative: "SW1 checks the FCS, then records 00:11:22:33:44:0A → ge-0/0/1 as a dynamic entry.",
    run: (s) => ({ state: switchStep(s, "sw1-learns-a", "SW1", "ge-0/0/1", aToB("a-sends-frame"), "learn"), events: [ev("MAC_LEARNED", "sw1-learns-a", "SW1 learns HOST-A on ge-0/0/1")] }),
    packet: (s) => s.packet,
    whatChanged: (_p, n) => [`SW1 FDB: ${fdbLine("SW1", n)}`],
  },
  {
    id: "sw1-lookup-miss",
    label: "Destination lookup: miss",
    narrative: "Now SW1 looks up the DESTINATION MAC 00:11:22:33:44:0B. It has never seen a frame from HOST-B, so there is no entry.",
    run: (s) => ({ state: switchStep(s, "sw1-lookup-miss", "SW1", "ge-0/0/1", aToB("a-sends-frame"), "lookup"), events: [ev("ROUTE_LOOKUP", "sw1-lookup-miss", "SW1 FDB lookup for HOST-B: miss")] }),
    packet: (s) => s.packet,
    whatChanged: () => ["FDB lookup for 00:11:22:33:44:0B: no entry", "This frame is an UNKNOWN UNICAST"],
  },
  {
    id: "predict-flood",
    label: "Predict: why flood?",
    narrative: "SW1 is about to send this frame out several ports.",
    packet: (s) => s.packet,
    question: {
      prompt: "Why will SW1 flood this unicast frame?",
      options: [
        { id: "unknown", label: "Its destination MAC is not in the FDB, so SW1 cannot pick one port" },
        { id: "rewrite", label: "SW1 rewrites the destination to FF:FF:FF:FF:FF:FF first" },
        { id: "always", label: "Switches flood every frame" },
        { id: "arp", label: "SW1 must run ARP to find HOST-B" },
      ],
      correctOptionId: "unknown",
      explanation: "Unknown-unicast flooding: the destination stays 00:11:22:33:44:0B, but with no FDB entry SW1 sends a copy out every other port in the broadcast domain so it reaches HOST-B wherever it is. Nothing is rewritten, and switches don't use ARP to forward.",
    },
  },
  {
    id: "flood-unknown",
    label: "Flood: every port except ingress",
    narrative: "SW1 sends identical copies out ge-0/0/2, ge-0/0/3 and ge-0/0/4 — never back out ge-0/0/1 where it arrived. Every copy still carries destination 00:11:22:33:44:0B.",
    run: (s) => ({ state: switchStep(s, "flood-unknown", "SW1", "ge-0/0/1", aToB("a-sends-frame"), "tx"), events: [ev("PACKET_SENT", "flood-unknown", "SW1 floods unknown unicast")] }),
    packet: (s) => s.packet,
    whatChanged: (_p, n) => [`Copies out: ${n.hops[n.hops.length - 1]?.egressInterfaceIds?.join(", ") ?? ""}`, "Destination MAC unchanged: 00:11:22:33:44:0B", "ge-0/0/1 (ingress) excluded"],
  },
  {
    id: "b-accepts",
    label: "HOST-B accepts",
    narrative: "HOST-B's NIC compares the destination MAC with its own: 00:11:22:33:44:0B — a match. The payload is passed up.",
    run: (s) => ({ state: { ...hostReceive(s, "b-accepts", "HOST-B", aToB("a-sends-frame")), packet: undefined, flood: [] }, events: [ev("PACKET_RECEIVED", "b-accepts", "HOST-B accepts the frame")] }),
    whatChanged: () => ["HOST-B: destination MAC matches — accepted"],
  },
  {
    id: "c-discards",
    label: "HOST-C discards",
    narrative: "HOST-C got a copy only because of the flood. Its destination is HOST-B's MAC, not HOST-C's, so HOST-C's NIC discards it. (DESK-SW also got a copy; with nothing on its free port, it goes no further.)",
    run: (s) => ({ state: hostReceive(s, "c-discards", "HOST-C", aToB("a-sends-frame")), events: [ev("PACKET_DROPPED", "c-discards", "HOST-C discards a frame not addressed to it")] }),
    whatChanged: () => ["HOST-C: destination MAC is not mine — discarded"],
  },
  {
    id: "b-replies",
    label: "HOST-B replies",
    narrative: "HOST-B answers: destination 00:11:22:33:44:0A, source 00:11:22:33:44:0B. It arrives on SW1 ge-0/0/2.",
    run: (s) => ({ state: hostSend(s, "b-replies", "HOST-B", bToA("b-replies-frame", "HOST-B", "SW1"), "SW1"), events: [ev("PACKET_SENT", "b-replies", "HOST-B replies")] }),
    packet: (s) => s.packet,
    whatChanged: () => ["HOST-B's reply is on its way to SW1 ge-0/0/2"],
  },
  {
    id: "sw1-learns-b",
    label: "SW1 learns HOST-B",
    narrative: "Source learning again: 00:11:22:33:44:0B → ge-0/0/2. Then SW1 looks up the destination 00:11:22:33:44:0A — it already has that entry.",
    run: (s) => ({ state: switchStep(s, "sw1-learns-b", "SW1", "ge-0/0/2", bToA("b-replies-frame", "HOST-B", "SW1"), "lookup"), events: [ev("MAC_LEARNED", "sw1-learns-b", "SW1 learns HOST-B on ge-0/0/2")] }),
    packet: (s) => s.packet,
    whatChanged: (_p, n) => [`SW1 FDB: ${fdbLine("SW1", n)}`, "Lookup 00:11:22:33:44:0A → ge-0/0/1 (hit)"],
  },
  {
    id: "known-unicast-reply",
    label: "Known unicast: one port only",
    narrative: "Because HOST-A is known, the reply leaves ONLY ge-0/0/1. HOST-C and DESK-SW see nothing.",
    run: (s) => ({ state: switchStep(s, "known-unicast-reply", "SW1", "ge-0/0/2", bToA("b-replies-frame", "HOST-B", "SW1"), "tx"), events: [ev("PACKET_SENT", "known-unicast-reply", "SW1 forwards known unicast to ge-0/0/1")] }),
    packet: (s) => s.packet,
    whatChanged: () => ["Forwarded out ge-0/0/1 only — no flood"],
  },
  {
    id: "predict-resend",
    label: "Predict: the second A → B frame",
    narrative: "HOST-A sends another frame to HOST-B.",
    run: (s) => ({ state: idle(s), events: [] }),
    question: {
      prompt: "What does SW1 do with the next HOST-A → HOST-B frame?",
      options: [
        { id: "known", label: "Forward it out ge-0/0/2 only — HOST-B is now in the FDB" },
        { id: "flood", label: "Flood it again, like the first one" },
        { id: "bcast", label: "Convert it to a broadcast" },
        { id: "drop", label: "Drop it, because HOST-A's entry already exists" },
      ],
      correctOptionId: "known",
      explanation: "HOST-B's reply taught SW1 that 00:11:22:33:44:0B is behind ge-0/0/2. From now on HOST-A → HOST-B is known unicast. An existing source entry is simply refreshed.",
    },
  },
  {
    id: "resend-a",
    label: "HOST-A sends again",
    narrative: "Same addressing as before: destination HOST-B, source HOST-A.",
    run: (s) => ({ state: hostSend(s, "resend-a", "HOST-A", aToB("resend-a-frame"), "SW1"), events: [ev("PACKET_SENT", "resend-a", "HOST-A → HOST-B again")] }),
    packet: (s) => s.packet,
    whatChanged: () => ["Frame on the wire toward SW1 ge-0/0/1"],
  },
  {
    id: "resend-forward",
    label: "Known unicast to HOST-B",
    narrative: "SW1 refreshes HOST-A's entry, finds 00:11:22:33:44:0B → ge-0/0/2, and forwards out that single port.",
    run: (s) => ({ state: switchStep(s, "resend-forward", "SW1", "ge-0/0/1", aToB("resend-a-frame"), "tx"), events: [ev("PACKET_SENT", "resend-forward", "SW1 forwards known unicast to ge-0/0/2")] }),
    packet: (s) => s.packet,
    whatChanged: () => ["Known unicast: out ge-0/0/2 only", "HOST-C never sees this frame"],
  },
  {
    id: "broadcast-intro",
    label: "Broadcast frames",
    narrative: "Some frames are meant for everyone: destination FF:FF:FF:FF:FF:FF. An ARP request is the classic example (the ARP lesson covers what's inside). Watch how SW1 treats one.",
    run: (s) => ({ state: idle(s), events: [] }),
  },
  {
    id: "c-broadcast",
    label: "HOST-C sends a broadcast",
    narrative: "HOST-C transmits: destination FF:FF:FF:FF:FF:FF, source 00:11:22:33:44:0C, EtherType 0x0806.",
    run: (s) => ({ state: hostSend(s, "c-broadcast", "HOST-C", cBcast("c-broadcast-frame"), "SW1"), events: [ev("PACKET_SENT", "c-broadcast", "HOST-C broadcasts")] }),
    packet: (s) => s.packet,
    whatChanged: () => ["Broadcast frame toward SW1 ge-0/0/3"],
  },
  {
    id: "broadcast-flood",
    label: "Broadcast flood",
    narrative: "SW1 learns 00:11:22:33:44:0C → ge-0/0/3 (source learning still applies), then floods the broadcast out ge-0/0/1, ge-0/0/2 and ge-0/0/4. Every host accepts it — it is addressed to all of them.",
    run: (s) => ({ state: switchStep(s, "broadcast-flood", "SW1", "ge-0/0/3", cBcast("c-broadcast-frame"), "tx"), events: [ev("PACKET_SENT", "broadcast-flood", "SW1 floods broadcast")] }),
    packet: (s) => s.packet,
    whatChanged: (_p, n) => [`SW1 FDB: ${fdbLine("SW1", n)}`, "Broadcast flooded out every port except ge-0/0/3"],
  },
  {
    id: "predict-broadcast-vs-unknown",
    label: "Predict: two kinds of flood",
    narrative: "Both the first HOST-A → HOST-B frame and this broadcast were flooded.",
    run: (s) => ({ state: idle(s), events: [] }),
    question: {
      prompt: "SW1 now knows every host. Which frame would STILL be flooded?",
      options: [
        { id: "bcast", label: "A broadcast to FF:FF:FF:FF:FF:FF — it is addressed to everyone" },
        { id: "unicast", label: "A unicast to HOST-B" },
        { id: "neither", label: "Neither — a full FDB stops all flooding" },
        { id: "both", label: "Both, because flooding is a timer" },
      ],
      correctOptionId: "bcast",
      explanation: "Unknown unicast floods because the lookup MISSED; once the MAC is learned, it stops. A broadcast floods because its destination means 'all stations' — no FDB entry can ever change that.",
    },
  },
  {
    id: "fdb-aging",
    label: "FDB aging",
    narrative: `Dynamic entries don't live forever. HOST-A and HOST-B keep exchanging frames (each frame they SOURCE refreshes their entry), but HOST-C goes silent. After ${FDB_AGING_SEC} s without a frame from HOST-C, its entry ages out. A frame to HOST-C would now be unknown unicast again.`,
    run: (s) => {
      const clock = s.clock + FDB_AGING_SEC + 10;
      const refresh = (fdb: FdbEntry[]) => fdb.filter((e) => e.mac !== ETH_MAC["HOST-C"]).map((e) => ({ ...e, lastSeen: clock - 5 }));
      const hop: FundHop = {
        stepId: "fdb-aging",
        device: "SW1",
        stages: [
          { id: "timer", label: "Aging timer per dynamic entry", detail: `aging time ${FDB_AGING_SEC} s` },
          { id: "refresh", label: "Refresh on each source frame", detail: "HOST-A, HOST-B refreshed" },
          { id: "expire", label: "Remove expired entries", detail: "HOST-C silent > 300 s → removed" },
        ],
        activeStageId: "expire",
        lookupType: "FDB aging",
        lookupKey: `aging time ${FDB_AGING_SEC} s`,
        lookupResult: "00:11:22:33:44:0C expired",
        action: "AGE OUT",
        reason: "An entry is refreshed only when that MAC appears as a SOURCE. HOST-C sent nothing for longer than the aging time.",
        input: `FDB: ${fdbLine("SW1", s)}`,
        output: `FDB: ${s.fdb.SW1.filter((e) => e.mac !== ETH_MAC["HOST-C"]).map((e) => `${macName(e.mac)} → ${e.port}`).join(", ")}`,
      };
      return { state: { ...idle(s), clock, fdb: { SW1: refresh(s.fdb.SW1), "DESK-SW": refresh(s.fdb["DESK-SW"]) }, hops: [...s.hops, hop] }, events: [ev("MAC_LEARNED", "fdb-aging", "HOST-C entry aged out")] };
    },
    whatChanged: (_p, n) => [`Clock +${FDB_AGING_SEC + 10} s`, `SW1 FDB: ${fdbLine("SW1", n)}`, "HOST-C's entry aged out; A and B were refreshed by their own traffic"],
  },
  {
    id: "move-intro",
    label: "HOST-B moves to the hot desk",
    narrative: "HOST-B is unplugged from ge-0/0/2 and plugged into DESK-SW's free port. ge-0/0/2 goes DOWN, and SW1 flushes the dynamic entries learned on that port (the usual managed-switch behaviour on link-down). SW1 has NOT been told where HOST-B went — nothing can tell it except a frame from HOST-B.",
    run: (s) => {
      const hop: FundHop = {
        stepId: "move-intro",
        device: "SW1",
        stages: [
          { id: "link", label: "Port state change", detail: "ge-0/0/2 → DOWN" },
          { id: "flush", label: "Flush dynamic entries on that port", detail: "HOST-B entry removed" },
          { id: "wait", label: "Wait for a source frame", detail: "new location unknown" },
        ],
        activeStageId: "wait",
        ingressInterfaceId: "ge-0/0/2",
        lookupType: "Port event",
        lookupKey: "ge-0/0/2 link down",
        lookupResult: "dynamic entries on ge-0/0/2 flushed",
        action: "FLUSH",
        reason: "A port going down means the MACs learned on it are no longer reachable there. The switch does not learn a NEW location from a link event.",
        input: `FDB: ${fdbLine("SW1", s)}`,
        output: `FDB: ${s.fdb.SW1.filter((e) => e.port !== "ge-0/0/2").map((e) => `${macName(e.mac)} → ${e.port}`).join(", ") || "empty"}`,
      };
      return { state: { ...idle(s), hostB: "DESK-SW port 2", downPorts: ["SW1 ge-0/0/2"], fdb: { ...s.fdb, SW1: s.fdb.SW1.filter((e) => e.port !== "ge-0/0/2") }, hops: [...s.hops, hop] }, events: [ev("STEP_ENTERED", "move-intro", "HOST-B moved to DESK-SW")] };
    },
    whatChanged: (_p, n) => ["HOST-B now on DESK-SW port 2 (SW1 ge-0/0/4 side)", "SW1 ge-0/0/2 DOWN", `SW1 FDB: ${fdbLine("SW1", n)}`],
  },
  {
    id: "predict-after-move",
    label: "Predict: where is HOST-B?",
    narrative: "HOST-B has not sent a single frame since moving.",
    question: {
      prompt: "What does SW1 know about HOST-B's location right now?",
      options: [
        { id: "unknown", label: "Nothing — it will learn ge-0/0/4 only from a frame HOST-B sources" },
        { id: "detected", label: "ge-0/0/4 — SW1 detected the cable move" },
        { id: "ask", label: "It asks DESK-SW, which reports HOST-B" },
        { id: "a-frame", label: "It learns HOST-B's port the next time HOST-A sends to HOST-B" },
      ],
      correctOptionId: "unknown",
      explanation: "Switches never learn from a destination field or from a link event. Until HOST-B transmits from its new port, SW1 has no entry for it; a frame to HOST-B would be flooded as unknown unicast.",
    },
  },
  {
    id: "b-sends-from-desk",
    label: "HOST-B speaks from the new port",
    narrative: "HOST-B sends a frame to HOST-A. It enters DESK-SW on port 2 — DESK-SW is an unmanaged switch, but it is still a learning bridge.",
    run: (s) => {
      const f = bToA("b-desk-frame", "HOST-B", "DESK-SW");
      return { state: hostSend(s, "b-sends-from-desk", "HOST-B", f, "DESK-SW"), events: [ev("PACKET_SENT", "b-sends-from-desk", "HOST-B sends from DESK-SW")] };
    },
    packet: (s) => s.packet,
    whatChanged: () => ["HOST-B → DESK-SW port 2"],
  },
  {
    id: "desk-forwards",
    label: "DESK-SW forwards to SW1",
    narrative: "DESK-SW learns 00:11:22:33:44:0B → port 2. It has no entry for HOST-A (A's frames to B have been known unicast, so none reached DESK-SW), so it floods — and its only other port is port 1, toward SW1.",
    run: (s) => ({ state: switchStep(s, "desk-forwards", "DESK-SW", "port 2", bToA("b-desk-frame", "HOST-B", "DESK-SW"), "tx"), events: [ev("MAC_LEARNED", "desk-forwards", "DESK-SW learns HOST-B on port 2")] }),
    packet: (s) => s.packet,
    whatChanged: (_p, n) => [`DESK-SW FDB: ${fdbLine("DESK-SW", n)}`],
  },
  {
    id: "sw1-relearns-b",
    label: "SW1 relearns HOST-B on ge-0/0/4",
    narrative: "The frame arrives on SW1 ge-0/0/4. Source learning records 00:11:22:33:44:0B → ge-0/0/4 — the move is now known, and only because HOST-B sent a frame. HOST-A is known, so the frame leaves ge-0/0/1 only.",
    run: (s) => ({ state: switchStep(s, "sw1-relearns-b", "SW1", "ge-0/0/4", bToA("b-desk-frame", "HOST-B", "DESK-SW"), "tx"), events: [ev("MAC_LEARNED", "sw1-relearns-b", "SW1 learns HOST-B on ge-0/0/4")] }),
    packet: (s) => s.packet,
    whatChanged: (_p, n) => [`SW1 FDB: ${fdbLine("SW1", n)}`, "Known unicast to HOST-A out ge-0/0/1"],
  },
  {
    id: "break-intro",
    label: "Incident: a ticket arrives",
    narrative: "Later, HOST-B's user returns to their old desk. The helpdesk ticket: 'HOST-A can no longer reach HOST-B.' Every cable shows link lights.",
    run: (s) => ({ state: idle(s), events: [] }),
  },
  {
    id: "fault-injected",
    label: "The physical change",
    narrative: "HOST-B was unplugged from DESK-SW and plugged back into SW1 ge-0/0/2 (now UP). DESK-SW is still connected to ge-0/0/4, so ge-0/0/4 never went down. HOST-B has not transmitted anything since reconnecting.",
    run: (s) => {
      const hop: FundHop = {
        stepId: "fault-injected",
        device: "SW1",
        stages: [
          { id: "link", label: "Port state change", detail: "ge-0/0/2 → UP" },
          { id: "keep", label: "ge-0/0/4 stays UP", detail: "no flush — entries kept" },
          { id: "wait", label: "Wait for a source frame", detail: "none from HOST-B yet" },
        ],
        activeStageId: "wait",
        ingressInterfaceId: "ge-0/0/2",
        lookupType: "Port event",
        lookupKey: "ge-0/0/2 link up",
        lookupResult: "no FDB change",
        action: "LINK UP",
        reason: "A port coming up teaches the switch nothing about which MACs are behind it. ge-0/0/4 stayed up, so nothing learned there was flushed.",
        input: `FDB: ${fdbLine("SW1", s)}`,
        output: `FDB: ${fdbLine("SW1", s)}`,
      };
      return { state: { ...idle(s), hostB: "SW1 ge-0/0/2", downPorts: [], faultActive: true, fdb: { ...s.fdb, "DESK-SW": s.fdb["DESK-SW"].filter((e) => e.port !== "port 2") }, hops: [...s.hops, hop] }, events: [ev("STEP_ENTERED", "fault-injected", "HOST-B back on ge-0/0/2")] };
    },
    whatChanged: (_p, n) => ["HOST-B physically on SW1 ge-0/0/2 (UP)", "ge-0/0/4 to DESK-SW stayed UP", `SW1 FDB: ${fdbLine("SW1", n)}`],
  },
  {
    id: "stale-send",
    label: "HOST-A tries again",
    narrative: "HOST-A sends a frame to 00:11:22:33:44:0B.",
    run: (s) => ({ state: hostSend(s, "stale-send", "HOST-A", aToB("stale-frame"), "SW1"), events: [ev("PACKET_SENT", "stale-send", "HOST-A → HOST-B")] }),
    packet: (s) => s.packet,
    whatChanged: () => ["Frame toward SW1 ge-0/0/1"],
  },
  {
    id: "stale-forward",
    label: "SW1 forwards by its FDB",
    narrative: "SW1 looks up 00:11:22:33:44:0B and gets a hit. It forwards the frame out that single port, exactly as a switch should for known unicast.",
    run: (s) => ({ state: switchStep(s, "stale-forward", "SW1", "ge-0/0/1", aToB("stale-frame"), "tx"), events: [ev("PACKET_SENT", "stale-forward", "SW1 forwards by FDB entry")] }),
    packet: (s) => s.packet,
    whatChanged: (_p, n) => [`Lookup result: ${n.hops[n.hops.length - 1]?.lookupResult ?? ""}`],
  },
  {
    id: "stale-lost",
    label: "The frame goes nowhere",
    narrative: "DESK-SW receives the frame on port 1. It has no entry for HOST-B any more (its port 2 went down), so it would flood — but its only other port is empty. HOST-B, sitting on ge-0/0/2, never sees the frame.",
    run: (s) => {
      const f = aToB("stale-frame");
      const hop: FundHop = {
        stepId: "stale-lost",
        device: "DESK-SW",
        stages: withDetail(SW_STAGES, { rx: "on port 1", learn: `${ETH_MAC["HOST-A"]} refreshed on port 1`, lookup: `${ETH_MAC["HOST-B"]} not in FDB`, decide: "flood — but no other port is up", tx: "nothing to send" }),
        activeStageId: "tx",
        ingressInterfaceId: "port 1",
        lookupType: "FDB (MAC table)",
        lookupKey: `destination ${ETH_MAC["HOST-B"]}`,
        lookupResult: "miss — no eligible egress port",
        action: "LOST",
        reason: "The frame was delivered to the wrong branch of the LAN. HOST-B is not behind DESK-SW any more.",
        input: `${frameDst(f)} ← ${frameSrc(f)} on port 1`,
        output: "not forwarded",
        before: frameStack(f),
      };
      return { state: { ...s, packet: undefined, flood: [], hops: [...s.hops, hop], fdb: { ...s.fdb, "DESK-SW": learn(s.fdb["DESK-SW"], ETH_MAC["HOST-A"], "port 1", s.clock) }, decision: { device: "DESK-SW", kind: "lost", text: "DESK-SW: HOST-B unknown, no other port up — frame lost" } }, events: [ev("PACKET_DROPPED", "stale-lost", "Frame never reaches HOST-B")] };
    },
    whatChanged: () => ["HOST-B received nothing", "No error was reported by any device"],
  },
  {
    id: "trouble-question",
    label: "Diagnose the incident",
    narrative: "Links are up, HOST-B's MAC is unchanged, and SW1 forwarded the frame without complaint.",
    question: {
      prompt: "What is the root cause?",
      options: [
        { id: "stale", label: "SW1's dynamic FDB entry for HOST-B still points to ge-0/0/4" },
        { id: "mac", label: "HOST-B's MAC address changed when it moved" },
        { id: "arp", label: "HOST-A's ARP cache has the wrong MAC for HOST-B" },
        { id: "flood", label: "SW1's flooding is broken" },
      ],
      correctOptionId: "stale",
      explanation: "The entry was learned while HOST-B was behind DESK-SW. ge-0/0/4 never went down, and HOST-B hasn't sourced a frame from ge-0/0/2 yet, so SW1 still believes the old location and forwards (not floods) toward it. HOST-A's frame already carried the correct destination MAC.",
    },
  },
  {
    id: "diagnostic-layers",
    label: "Troubleshooting layers",
    narrative: "Walk the layers: physical links, addressing, the switch's FDB, and host delivery.",
  },
  {
    id: "repair-challenge",
    label: "Repair the forwarding state",
    narrative: "Choose the change that fixes the cause you identified.",
    action: (s, payload) => ({ state: applyEthRepair(s, (payload as { choice: string }).choice), events: [ev("STEP_ENTERED", "repair-challenge", `Repair attempt: ${(payload as { choice: string }).choice}`)] }),
    requiresState: (s) => s.repaired,
  },
  {
    id: "verify-send",
    label: "Verify: HOST-A sends",
    narrative: "With the stale entry gone, HOST-A sends to HOST-B again.",
    run: (s) => ({ state: hostSend(s, "verify-send", "HOST-A", aToB("verify-frame"), "SW1"), events: [ev("PACKET_SENT", "verify-send", "HOST-A → HOST-B")] }),
    packet: (s) => s.packet,
    whatChanged: (_p, n) => [`SW1 FDB: ${fdbLine("SW1", n)}`],
  },
  {
    id: "verify-flood",
    label: "Verify: unknown unicast flood",
    narrative: "HOST-B is unknown now, so SW1 floods out ge-0/0/2, ge-0/0/3 and ge-0/0/4. HOST-B, on ge-0/0/2, receives and accepts it.",
    run: (s) => ({ state: switchStep(s, "verify-flood", "SW1", "ge-0/0/1", aToB("verify-frame"), "tx"), events: [ev("PACKET_SENT", "verify-flood", "SW1 floods unknown unicast")] }),
    packet: (s) => s.packet,
    whatChanged: () => ["Flooded out every other port", "HOST-B on ge-0/0/2 receives it"],
  },
  {
    id: "verify-reply",
    label: "Verify: HOST-B replies",
    narrative: "HOST-B replies from ge-0/0/2. SW1 learns 00:11:22:33:44:0B → ge-0/0/2 — the correct location — and forwards to HOST-A as known unicast.",
    run: (s) => {
      const f = bToA("verify-reply-frame", "HOST-B", "SW1");
      const sent = hostSend(s, "verify-reply", "HOST-B", f, "SW1");
      return { state: switchStep(sent, "verify-reply", "SW1", "ge-0/0/2", f, "tx"), events: [ev("MAC_LEARNED", "verify-reply", "SW1 learns HOST-B on ge-0/0/2")] };
    },
    packet: (s) => s.packet,
    whatChanged: (_p, n) => [`SW1 FDB: ${fdbLine("SW1", n)}`],
  },
  {
    id: "verify-known",
    label: "Verify: known unicast again",
    narrative: "HOST-A's next frame to HOST-B is known unicast out ge-0/0/2 only. Service restored.",
    run: (s) => {
      const f = aToB("verify-known-frame");
      const sent = hostSend(s, "verify-known", "HOST-A", f, "SW1");
      return { state: switchStep(sent, "verify-known", "SW1", "ge-0/0/1", f, "tx"), events: [ev("PACKET_SENT", "verify-known", "Known unicast to HOST-B")] };
    },
    packet: (s) => s.packet,
    whatChanged: () => ["Out ge-0/0/2 only — HOST-B reached"],
  },
  {
    id: "switch-vs-router",
    label: "Switch vs router",
    narrative: "Everything SW1 did used MAC addresses inside one broadcast domain, and it never changed the frame. A router works one layer up: it forwards between different IP networks and builds a NEW Ethernet frame on every hop — that's the IPv4 lesson.",
    run: (s) => ({ state: idle(s), events: [] }),
  },
  {
    id: "complete",
    label: "Lesson complete",
    narrative: "You watched source learning, unknown-unicast flooding, known-unicast forwarding, broadcast, aging, a MAC move and a stale-entry incident — all from one switch's FDB.",
  },
];

/** Name each device's current FDB for inspectors. */
export const ethFdbRows = (s: EthState, sw: EthSwitch) => s.fdb[sw].map((e) => ({ label: `${e.mac} (${macName(e.mac)})`, value: `${e.port} · ${e.type} · age ${Math.max(0, s.clock - e.lastSeen)} s` }));
