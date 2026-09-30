import type { PacketVisual, PVEvent, PVEventType, ScenarioStep } from "../types";
import type { PacketStackFrame, ProcessingStage } from "@/components/network3d/types";
import type { FundHop } from "@/components/lesson/fundamentalsTrace";
import { fieldOf, icmpPacket, packetStack, type IcmpEcho } from "./fundamentalsPackets";
import { withNotes, type NotebookEntry } from "./troubleshootingCommon";

/**
 * Layer 1 Troubleshooting: Link, Optics & Errors — CLIENT — ACCESS-SW — DIST-SW — SERVER, one 1000BASE-LX uplink
 * (ACCESS-SW ge-0/0/47 ↔ DIST-SW ge-0/0/47, single-mode fiber, 1310 nm).
 *
 * Modeled exactly:
 * - Physical/interface state is separate from everything above it: admin state, operational state, speed, duplex,
 *   media, carrier transitions, last change, and counters (input/output packets, input errors, CRC/FCS errors, output
 *   errors). Counters are cumulative since the last clear — they are read by DELTA between two snapshots.
 * - Receive power at one end is the PEER's transmit power minus the loss of the fiber path between them. ACCESS-SW's Rx
 *   describes the DIST-SW → ACCESS-SW fiber; DIST-SW's Rx describes the other fiber.
 * - A receiver with marginal signal can keep link (oper UP) while mis-reading bits: frames arrive with a bad FCS, fail
 *   the CRC-32 check and are discarded at ingress (CRC and input-error counters +1). Nothing above Layer 1 changes:
 *   VLANs, MAC tables and addressing are untouched.
 * - ICMP echoes are byte-accurate (shared builders: RFC 791 / RFC 792 checksums computed).
 * Thresholds: PACKETVERSE LESSON THRESHOLDS (below), chosen for teaching. Real limits come from the transceiver's own
 * digital-optical-monitoring (DOM) thresholds and datasheet — never treat these numbers as universal vendor limits.
 * Incident (truth, never shown before diagnosis): attenuation on the DIST-SW → ACCESS-SW fiber path (e.g. a dirty or
 * damaged connector) lowers ACCESS-SW's receive power into the marginal band. The link stays UP but errors.
 */

export type L1Device = "CLIENT" | "ACCESS-SW" | "DIST-SW" | "SERVER";
export const L1_DEVICES: L1Device[] = ["CLIENT", "ACCESS-SW", "DIST-SW", "SERVER"];
export const L1_IP = { CLIENT: "10.30.30.10", SERVER: "10.30.30.20" } as const;
export const L1_MAC = { CLIENT: "00:00:5E:00:53:31", SERVER: "00:00:5E:00:53:32" } as const;
export const UPLINK = "ge-0/0/47";
export const MEDIA = "1000BASE-LX · single-mode fiber · 1310 nm";

/** PacketVerse lesson thresholds (dBm) — teaching values, not vendor limits. */
export const PV_THRESH = { normalMin: -14.0, marginalMin: -22.0 } as const;
export type RxBand = "normal" | "marginal" | "loss-of-signal";
export const rxBand = (dbm: number): RxBand => (dbm >= PV_THRESH.normalMin ? "normal" : dbm >= PV_THRESH.marginalMin ? "marginal" : "loss-of-signal");
export const RX_BAND_TEXT: Record<RxBand, string> = { normal: "within the PacketVerse normal band (≥ −14.0 dBm)", marginal: "below the PacketVerse normal band (−14.0 dBm): marginal — link can stay up while bits are misread", "loss-of-signal": "below −22.0 dBm: loss of signal — link down" };
export const dbm = (v: number) => `${v.toFixed(1)} dBm`;

export type Sw = "ACCESS-SW" | "DIST-SW";
export interface Optics {
  tx: number;
  rx: number;
}
export const HEALTHY_OPTICS: Record<Sw, Optics> = { "ACCESS-SW": { tx: -5.0, rx: -6.3 }, "DIST-SW": { tx: -5.1, rx: -6.2 } };
export const FAULT_RX = -19.8;
export const REPAIRED_RX = -6.4;

export interface IfCounters {
  inPkts: number;
  inErrors: number;
  crc: number;
  outPkts: number;
  outErrors: number;
  carrierTransitions: number;
}
/** ACCESS-SW ge-0/0/47 already carries CRC errors from a past event (lifetime counters, never cleared). */
export const HISTORIC_CRC = 3912;
export const WINDOW_S = 30;
export const WINDOW_PKTS = 48_210;
export const WINDOW_CRC_FAULT = 127;

export interface Snapshot {
  label: string;
  /** Lesson clock, seconds. */
  t: number;
  sw: Sw;
  c: IfCounters;
}
export interface PingRecord {
  seq: number;
  result: "reply" | "timeout";
}
export interface L1State {
  hops: FundHop[];
  packet?: PacketVisual;
  flood: { id: string; fromId: string; toId: string; packet: PacketVisual }[];
  /** Truth. */
  optics: Record<Sw, Optics>;
  counters: Record<Sw, IfCounters>;
  admin: Record<Sw, "up" | "down">;
  oper: Record<Sw, "up" | "down">;
  lastFlap: Record<Sw, string>;
  /** Evidence collected so far (what the lesson has actually looked at). */
  snapshots: Snapshot[];
  /** Optical readings the lesson has actually taken (label, lesson clock, both ends). */
  opticsLog: { label: string; t: number; optics: Record<Sw, Optics> }[];
  pings: { series: string; sent: number; received: number; lost: number[] }[];
  notebook: NotebookEntry[];
  clock: number;
  decision?: { device: L1Device; text: string };
  faultActive: boolean;
  repairAttempt?: { choice: string; correct: boolean };
  repaired: boolean;
}
const baseCounters = (sw: Sw): IfCounters => (sw === "ACCESS-SW" ? { inPkts: 918_402_117, inErrors: HISTORIC_CRC, crc: HISTORIC_CRC, outPkts: 871_550_904, outErrors: 0, carrierTransitions: 2 } : { inPkts: 871_550_311, inErrors: 0, crc: 0, outPkts: 918_402_730, outErrors: 0, carrierTransitions: 2 });
export function createL1State(): L1State {
  return {
    hops: [],
    flood: [],
    optics: { "ACCESS-SW": { ...HEALTHY_OPTICS["ACCESS-SW"] }, "DIST-SW": { ...HEALTHY_OPTICS["DIST-SW"] } },
    counters: { "ACCESS-SW": baseCounters("ACCESS-SW"), "DIST-SW": baseCounters("DIST-SW") },
    admin: { "ACCESS-SW": "up", "DIST-SW": "up" },
    oper: { "ACCESS-SW": "up", "DIST-SW": "up" },
    lastFlap: { "ACCESS-SW": "41 days ago", "DIST-SW": "41 days ago" },
    snapshots: [],
    opticsLog: [],
    pings: [],
    notebook: [],
    clock: 0,
    faultActive: false,
    repaired: false,
  };
}

/** Traffic for `seconds` across the uplink. Errors appear only on the side whose receiver is marginal (truth). */
function runTraffic(s: L1State, seconds: number): L1State {
  const k = seconds / WINDOW_S;
  const pk = Math.round(WINDOW_PKTS * k);
  const err = (sw: Sw) => (rxBand(s.optics[sw].rx) === "marginal" ? Math.round(WINDOW_CRC_FAULT * k) : 0);
  const next = (sw: Sw, peer: Sw): IfCounters => {
    const c = s.counters[sw];
    const e = err(sw);
    return { ...c, inPkts: c.inPkts + pk - e, inErrors: c.inErrors + e, crc: c.crc + e, outPkts: c.outPkts + Math.round(WINDOW_PKTS * k * (peer === "ACCESS-SW" ? 0.94 : 1.06)) };
  };
  return { ...s, clock: s.clock + seconds, counters: { "ACCESS-SW": next("ACCESS-SW", "DIST-SW"), "DIST-SW": next("DIST-SW", "ACCESS-SW") } };
}
export const snapshotsOf = (s: L1State, sw: Sw) => s.snapshots.filter((x) => x.sw === sw);
export function deltaOf(s: L1State, sw: Sw): { from: Snapshot; to: Snapshot; crc: number; inErrors: number; inPkts: number; outErrors: number } | undefined {
  const xs = snapshotsOf(s, sw);
  if (xs.length < 2) return undefined;
  const [a, b] = xs.slice(-2);
  return { from: a, to: b, crc: b.c.crc - a.c.crc, inErrors: b.c.inErrors - a.c.inErrors, inPkts: b.c.inPkts - a.c.inPkts, outErrors: b.c.outErrors - a.c.outErrors };
}
const snap = (s: L1State, label: string): L1State => ({ ...s, snapshots: [...s.snapshots, { label, t: s.clock, sw: "ACCESS-SW", c: { ...s.counters["ACCESS-SW"] } }, { label, t: s.clock, sw: "DIST-SW", c: { ...s.counters["DIST-SW"] } }] });

// ---------------------------------------------------------------------------------------------------------------
// Packets
// ---------------------------------------------------------------------------------------------------------------
export const ECHO_ID = 0x0701;
const echo = (kind: IcmpEcho["kind"], seq: number): IcmpEcho => ({ kind, identifier: ECHO_ID, sequence: seq, dataLength: 56 });
export function pingPacket(id: string, kind: IcmpEcho["kind"], seq: number, from: L1Device, to: L1Device, corrupted = false): PacketVisual {
  const req = kind === "echo-request";
  const p = icmpPacket({ id, from, to, ethSrc: req ? L1_MAC.CLIENT : L1_MAC.SERVER, ethDst: req ? L1_MAC.SERVER : L1_MAC.CLIENT, ip: { src: req ? L1_IP.CLIENT : L1_IP.SERVER, dst: req ? L1_IP.SERVER : L1_IP.CLIENT, ttl: 64, id: (req ? 0x3100 : 0x5200) + seq, df: false }, icmp: echo(kind, seq) });
  if (!corrupted) return p;
  return { ...p, summary: `${p.summary} · received with a bad FCS`, layers: p.layers.map((l) => (l.name === "FCS" ? { ...l, fields: [{ label: "Frame Check Sequence", value: "CRC-32 recomputed by the receiver ≠ FCS carried in the frame" }] } : l)) };
}
export const isCorrupted = (p: PacketVisual) => p.layers.some((l) => l.name === "FCS" && l.fields.some((f) => f.value.includes("≠")));
export function l1Stack(p: PacketVisual): PacketStackFrame[] {
  return [...packetStack(p), { id: "fcs", text: isCorrupted(p) ? "FCS · CRC-32 check FAILED at the receiver" : "FCS · CRC-32 check passed", tone: "generic" }];
}

// ---------------------------------------------------------------------------------------------------------------
// Stages and hops
// ---------------------------------------------------------------------------------------------------------------
export const SWITCH_STAGES: ProcessingStage[] = [
  { id: "phy", label: "PHY / optics: receive light → bits (Rx power)" },
  { id: "fcs", label: "MAC: FCS (CRC-32) check — bad frames discarded, counted" },
  { id: "learn", label: "Learn source MAC" },
  { id: "fwd", label: "Forward by destination MAC" },
  { id: "tx", label: "Transmit (output counters)" },
];
export const HOST_STAGES: ProcessingStage[] = [
  { id: "app", label: "ping: send echo / wait for reply (timeout)" },
  { id: "tx", label: "Build Ethernet + IPv4 + ICMP, transmit" },
  { id: "rx", label: "Receive: FCS → IPv4 → ICMP" },
];
export const L1_STAGES: Record<L1Device, ProcessingStage[]> = { CLIENT: HOST_STAGES, SERVER: HOST_STAGES, "ACCESS-SW": SWITCH_STAGES, "DIST-SW": SWITCH_STAGES };
const withDetail = (st: ProcessingStage[], d: Partial<Record<string, string>>) => st.map((x) => (d[x.id] ? { ...x, detail: d[x.id] } : x));
const ev = (type: PVEventType, stepId: string, message: string): PVEvent => ({ type, stepId, timestamp: Date.now(), message });
const idle = (s: L1State): L1State => ({ ...s, packet: undefined, flood: [], decision: undefined });
function hop(stepId: string, device: L1Device, o: { active: string; details: Partial<Record<string, string>>; lookupType: string; key: string; result: string; action: string; reason: string; input: string; output: string; ingress?: string; egress?: string; next?: L1Device; before?: PacketVisual; after?: PacketVisual }): FundHop {
  return { stepId, device, stages: withDetail(L1_STAGES[device], o.details), activeStageId: o.active, ingressInterfaceId: o.ingress, egressInterfaceId: o.egress, lookupType: o.lookupType, lookupKey: o.key, lookupResult: o.result, action: o.action, reason: o.reason, input: o.input, output: o.output, nextHopId: o.next, before: o.before ? l1Stack(o.before) : undefined, after: o.after ? l1Stack(o.after) : undefined };
}
const note = (s: L1State, stepId: string, d: L1Device, o: { active: string; details: Partial<Record<string, string>>; action: string; reason: string; key: string; result: string; ingress?: string }): L1State => ({ ...s, hops: [...s.hops, hop(stepId, d, { ...o, lookupType: `${d} evidence`, input: o.key, output: o.result })] });
export const PORT: Record<L1Device, Record<string, string>> = { CLIENT: { "ACCESS-SW": "eth0" }, "ACCESS-SW": { CLIENT: "ge-0/0/1", "DIST-SW": UPLINK }, "DIST-SW": { "ACCESS-SW": UPLINK, SERVER: "ge-0/0/2" }, SERVER: { "DIST-SW": "eth0" } };

/** A ping frame crossing one link; the receiving switch runs the FCS check against the TRUE receive quality. */
function pingHop(s0: L1State, stepId: string, kind: IcmpEcho["kind"], seq: number, from: L1Device, to: L1Device, corrupt: boolean): L1State {
  const s = idle(s0);
  const p = pingPacket(`${stepId}-pkt`, kind, seq, from, to, corrupt);
  const hops: FundHop[] = [];
  if (from === "CLIENT" || from === "SERVER") hops.push(hop(stepId, from, { active: "tx", egress: "eth0", details: { app: `ping ${kind === "echo-request" ? L1_IP.SERVER : L1_IP.CLIENT} seq ${seq}`, tx: `ICMP ${kind === "echo-request" ? "Echo Request" : "Echo Reply"} · ${fieldOf(p, /^ICMP/, "Checksum")}` }, lookupType: `${from} ICMP`, key: `seq ${seq}`, result: "transmitted", action: kind === "echo-request" ? "TX ECHO" : "TX REPLY", reason: "Same subnet (10.30.30.0/24): the frame goes straight to the peer's MAC through both switches.", input: "ping", output: "frame on the wire", next: to, after: p }));
  if (to === "ACCESS-SW" || to === "DIST-SW") {
    const port = PORT[to][from];
    const uplinkRx = port === UPLINK;
    hops.push(
      hop(stepId, to, {
        active: corrupt ? "fcs" : "fwd",
        ingress: port,
        egress: corrupt ? undefined : to === "ACCESS-SW" ? (kind === "echo-reply" ? "ge-0/0/1" : UPLINK) : kind === "echo-request" ? "ge-0/0/2" : UPLINK,
        details: { phy: uplinkRx ? `Rx ${dbm(s.optics[to].rx)} on ${UPLINK}` : `copper access port ${port}`, fcs: corrupt ? "CRC-32 over the received bits ≠ FCS in the frame → DISCARD · CRC +1 · input errors +1" : "CRC-32 matches the FCS → frame accepted" },
        lookupType: `${to} ${port} receive`,
        key: `${kind === "echo-request" ? "echo" : "reply"} seq ${seq}`,
        result: corrupt ? "discarded (bad FCS)" : "forwarded",
        action: corrupt ? "FCS FAIL · DROP" : "FORWARD",
        reason: corrupt ? "The frame arrived with bits that no longer match its Frame Check Sequence. Ethernet cannot repair it, so the MAC layer discards it and counts a CRC/FCS error and an input error. Nothing above Layer 1/2 ever sees it — the ping simply times out." : "FCS good. The switch forwards by MAC; the frame is unchanged.",
        input: `frame on ${port}`,
        output: corrupt ? "nothing (discarded)" : "forwarded",
        before: p,
      }),
    );
  }
  let n: L1State = { ...s, hops: [...s0.hops, ...hops], packet: p, decision: corrupt ? { device: to, text: `${to} ${PORT[to][from]}: FCS check failed → discarded` } : undefined };
  if (corrupt) {
    const sw = to as Sw;
    n = { ...n, counters: { ...n.counters, [sw]: { ...n.counters[sw], crc: n.counters[sw].crc + 1, inErrors: n.counters[sw].inErrors + 1 } } };
  }
  return n;
}

// ---------------------------------------------------------------------------------------------------------------
// Repair
// ---------------------------------------------------------------------------------------------------------------
export const L1_REPAIR_OPTIONS = [
  { id: "restore-optics", label: `Restore ACCESS-SW ${UPLINK} receive optical level (clean / reseat / replace the DIST-SW → ACCESS-SW fiber path)` },
  { id: "clear-counters", label: `Clear the counters on ACCESS-SW ${UPLINK}` },
  { id: "change-dns", label: "Point CLIENT at a different DNS server" },
  { id: "fix-vlan", label: "Change the VLAN list on the uplink" },
  { id: "routing-metric", label: "Lower the routing metric toward SERVER" },
  { id: "firewall", label: "Add a firewall rule permitting ICMP and TCP" },
] as const;
export const L1_REPAIR_CORRECT = "restore-optics";
export function applyL1Repair(s: L1State, choice: string): L1State {
  const correct = choice === L1_REPAIR_CORRECT;
  if (!correct) return { ...s, repairAttempt: { choice, correct } };
  // Cleaning/reseating the connector briefly removes light: the link goes down and back up (carrier transitions +2).
  const bump = (sw: Sw): IfCounters => ({ ...s.counters[sw], carrierTransitions: s.counters[sw].carrierTransitions + 2 });
  return {
    ...idle(s),
    optics: { ...s.optics, "ACCESS-SW": { ...s.optics["ACCESS-SW"], rx: REPAIRED_RX } },
    counters: { "ACCESS-SW": bump("ACCESS-SW"), "DIST-SW": bump("DIST-SW") },
    lastFlap: { "ACCESS-SW": "just now (reseat)", "DIST-SW": "just now (reseat)" },
    faultActive: false,
    repaired: true,
    repairAttempt: { choice, correct },
    decision: { device: "ACCESS-SW", text: `ACCESS-SW ${UPLINK}: receive level restored` },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------------------------------------------
const pkt = (s: L1State) => s.packet;
const fmt = (n: number) => n.toLocaleString("en-US");
export const counterLine = (c: IfCounters) => `in ${fmt(c.inPkts)} · input errors ${fmt(c.inErrors)} · CRC ${fmt(c.crc)} · out ${fmt(c.outPkts)} · output errors ${fmt(c.outErrors)} · carrier transitions ${c.carrierTransitions}`;
const readOptics = (s: L1State, stepId: string, label: string): L1State =>
  note({ ...idle(s), opticsLog: [...s.opticsLog, { label, t: s.clock, optics: { "ACCESS-SW": { ...s.optics["ACCESS-SW"] }, "DIST-SW": { ...s.optics["DIST-SW"] } } }] }, stepId, "ACCESS-SW", { active: "phy", ingress: UPLINK, details: { phy: `ACCESS-SW ${UPLINK}: Tx ${dbm(s.optics["ACCESS-SW"].tx)} · Rx ${dbm(s.optics["ACCESS-SW"].rx)} | DIST-SW ${UPLINK}: Tx ${dbm(s.optics["DIST-SW"].tx)} · Rx ${dbm(s.optics["DIST-SW"].rx)}` }, action: "READ OPTICS", reason: "Digital optical monitoring (DOM) reports each transceiver's transmit and receive power. A receiver's Rx is the peer's Tx minus the loss of the fiber between them.", key: "DOM readings", result: `ACCESS Rx ${dbm(s.optics["ACCESS-SW"].rx)} · DIST Rx ${dbm(s.optics["DIST-SW"].rx)}` });
const takeSnap = (s: L1State, stepId: string, label: string): L1State => {
  const n = snap(idle(s), label);
  const d = deltaOf(n, "ACCESS-SW");
  return note(n, stepId, "ACCESS-SW", { active: "fcs", ingress: UPLINK, details: { fcs: `${label} @ t=${n.clock} s · ${counterLine(n.counters["ACCESS-SW"])}${d ? ` · Δ CRC ${d.crc >= 0 ? "+" : ""}${d.crc} over ${d.to.t - d.from.t} s` : ""}` }, action: "SNAPSHOT", reason: "A counter is cumulative since it was last cleared. One reading tells you the past; two readings a known time apart tell you what is happening now.", key: `show interfaces ${UPLINK} (${label})`, result: d ? `Δ CRC ${d.crc >= 0 ? "+" : ""}${d.crc} · Δ input errors +${d.inErrors} in ${d.to.t - d.from.t} s` : `CRC ${fmt(n.counters["ACCESS-SW"].crc)} (lifetime)` });
};
const pingSeries = (s: L1State, series: string, lost: number[]): L1State => ({ ...s, pings: [...s.pings, { series, sent: 100, received: 100 - lost.length, lost }] });

export const l1Steps: ScenarioStep<L1State>[] = [
  // ---- Define / Scope ---
  {
    id: "intro",
    label: "Two switches, one fiber uplink",
    narrative: `CLIENT (${L1_IP.CLIENT}) and SERVER (${L1_IP.SERVER}) share one subnet across ACCESS-SW and DIST-SW. Everything between the switches rides one uplink: ACCESS-SW ${UPLINK} ↔ DIST-SW ${UPLINK}, ${MEDIA}. This lesson is about the physical layer — the part of the network that turns light into bits.`,
    run: (s) => ({ state: withNotes(idle(s), "intro", [{ kind: "observation", text: `Path: CLIENT → ACCESS-SW → ${UPLINK} fiber → DIST-SW → SERVER (one subnet, no router)`, source: "topology" }]), events: [ev("STEP_ENTERED", "intro", "scope")] }),
  },
  {
    id: "interface-anatomy",
    label: "Admin state vs operational state",
    narrative: `An interface has an ADMIN state (what the configuration asks for: up, or 'disable'd) and an OPERATIONAL state (what the hardware achieved: does it have a valid signal and link?). ACCESS-SW ${UPLINK}: admin up, oper up, 1000 Mb/s full duplex, ${MEDIA}, 2 carrier transitions, last change 41 days ago.`,
    run: (s) => ({ state: note(idle(s), "interface-anatomy", "ACCESS-SW", { active: "phy", ingress: UPLINK, details: { phy: `admin ${s.admin["ACCESS-SW"]} · oper ${s.oper["ACCESS-SW"]} · 1000 Mb/s · full duplex · ${MEDIA} · autonegotiation complete (1000BASE-X: duplex/pause) · carrier transitions ${s.counters["ACCESS-SW"].carrierTransitions} · last change ${s.lastFlap["ACCESS-SW"]}` }, action: "INTERFACE STATE", reason: "Admin down = someone disabled it. Oper down with admin up = no valid signal or link partner. Oper up says the link trained — not that every bit arrives intact.", key: `show interfaces ${UPLINK}`, result: "admin up · oper up" }), events: [ev("STEP_ENTERED", "interface-anatomy", "state")] }),
  },
  {
    id: "q-admin-oper",
    label: "Question: admin vs oper",
    narrative: "Another port on DIST-SW shows: admin up, oper down.",
    question: {
      prompt: "What does 'admin up, oper down' tell you?",
      options: [
        { id: "signal", label: "It is enabled in configuration but has no usable link — e.g. no signal, a cable or optic problem, or a peer that is down" },
        { id: "admin", label: "Someone disabled it in the configuration" },
        { id: "healthy", label: "It is healthy but idle" },
        { id: "vlan", label: "Its VLAN is missing" },
      ],
      correctOptionId: "signal",
      explanation: "Administratively down means a 'shutdown/disable' is configured. Admin up with oper down means the port wants to run but the physical link did not come up — look at the cable, optic, signal and the peer.",
    },
  },
  // ---- Baseline ---
  {
    id: "base-optics",
    label: "Baseline: optical readings",
    narrative: `Read the transceivers' digital optical monitoring (DOM): DIST-SW Tx ${dbm(HEALTHY_OPTICS["DIST-SW"].tx)} → ACCESS-SW Rx ${dbm(HEALTHY_OPTICS["ACCESS-SW"].rx)}; ACCESS-SW Tx ${dbm(HEALTHY_OPTICS["ACCESS-SW"].tx)} → DIST-SW Rx ${dbm(HEALTHY_OPTICS["DIST-SW"].rx)}. About 1.2 dB of path loss each way. PacketVerse lesson thresholds: normal ≥ −14.0 dBm; −14.0 to −22.0 dBm marginal; below −22.0 dBm loss of signal (teaching values — real limits come from the optic's DOM thresholds and datasheet).`,
    run: (s) => ({ state: withNotes(readOptics(s, "base-optics", "baseline"), "base-optics", [{ kind: "observation", text: `Baseline optics: ACCESS Rx ${dbm(HEALTHY_OPTICS["ACCESS-SW"].rx)}, DIST Rx ${dbm(HEALTHY_OPTICS["DIST-SW"].rx)} (both normal)`, source: "DOM", rung: "Physical / interface" }]), events: [ev("STEP_ENTERED", "base-optics", "optics")] }),
  },
  {
    id: "q-rx-side",
    label: "Question: which Rx?",
    narrative: "Each fiber carries light in one direction.",
    question: {
      prompt: "Which reading describes the fiber that carries light FROM DIST-SW TO ACCESS-SW?",
      options: [
        { id: "access-rx", label: "ACCESS-SW's Rx — it measures what arrives from DIST-SW's transmitter" },
        { id: "access-tx", label: "ACCESS-SW's Tx" },
        { id: "dist-rx", label: "DIST-SW's Rx" },
        { id: "any", label: "Any of them — all four measure the same thing" },
      ],
      correctOptionId: "access-rx",
      explanation: "Receive power = the peer's transmit power minus the path loss. DIST-SW Tx − ACCESS-SW Rx is the loss of the DIST → ACCESS fiber.",
    },
  },
  {
    id: "base-snap-1",
    label: "Baseline: counter snapshot 1",
    narrative: `ACCESS-SW ${UPLINK}: CRC errors ${fmt(HISTORIC_CRC)}. That looks alarming — but the counters were never cleared, and the last change was 41 days ago. One reading tells you about the past.`,
    run: (s) => ({ state: takeSnap(s, "base-snap-1", "baseline #1"), events: [ev("STEP_ENTERED", "base-snap-1", "snapshot")] }),
  },
  {
    id: "base-snap-2",
    label: "Baseline: snapshot 2, 30 s later",
    narrative: `${WINDOW_S} s and ~${fmt(WINDOW_PKTS)} frames later: CRC still ${fmt(HISTORIC_CRC)}. Delta 0. The big number is history; right now the link is clean.`,
    run: (s) => {
      const n = takeSnap(runTraffic(s, WINDOW_S), "base-snap-2", "baseline #2");
      return { state: withNotes(n, "base-snap-2", [{ kind: "observation", text: `Baseline: CRC delta 0 over ${WINDOW_S} s (lifetime ${fmt(HISTORIC_CRC)} is old history)`, source: `ACCESS-SW ${UPLINK} counters`, rung: "Physical / interface" }]), events: [ev("STEP_ENTERED", "base-snap-2", "snapshot")] };
    },
  },
  {
    id: "q-lifetime",
    label: "Question: a big lifetime counter",
    narrative: `A colleague sees 'CRC ${fmt(HISTORIC_CRC)}' and wants to replace the optic.`,
    question: {
      prompt: `The CRC counter reads ${fmt(HISTORIC_CRC)}. Is the link corrupting frames right now?`,
      options: [
        { id: "delta", label: "You cannot tell from one reading — compare two snapshots over a known interval; here the delta is 0" },
        { id: "yes", label: "Yes — any non-zero CRC count means an active fault" },
        { id: "no", label: "No — CRC counters are irrelevant on fiber" },
        { id: "clear", label: "Clear the counters and the problem is solved" },
      ],
      correctOptionId: "delta",
      explanation: "Counters accumulate since the last clear (or boot). A large lifetime value can come from one event weeks ago. Current health is the rate: delta ÷ interval.",
    },
  },
  {
    id: "base-ping-req",
    label: "Baseline: ping crosses the uplink",
    narrative: "CLIENT pings SERVER. The Echo Request leaves ACCESS-SW on the uplink; DIST-SW's receiver checks the FCS — it matches.",
    run: (s) => ({ state: pingHop(s, "base-ping-req", "echo-request", 1, "ACCESS-SW", "DIST-SW", false), events: [ev("PACKET_SENT", "base-ping-req", "echo")] }),
    packet: pkt,
  },
  {
    id: "base-ping-reply",
    label: "Baseline: reply crosses back",
    narrative: `The Echo Reply comes back on the DIST-SW → ACCESS-SW fiber. ACCESS-SW receives it at ${dbm(HEALTHY_OPTICS["ACCESS-SW"].rx)}; the CRC-32 it computes matches the frame's FCS, so it forwards the frame to CLIENT.`,
    run: (s) => ({ state: pingHop(s, "base-ping-reply", "echo-reply", 1, "DIST-SW", "ACCESS-SW", false), events: [ev("PACKET_SENT", "base-ping-reply", "reply")] }),
    packet: pkt,
  },
  {
    id: "base-ping-summary",
    label: "Baseline: 100 pings",
    narrative: "100 pings: 100 replies, 0% loss. Baseline recorded: optics normal, CRC delta 0, no loss.",
    run: (s) => ({ state: withNotes(note(pingSeries(runTraffic(idle(s), 10), "baseline", []), "base-ping-summary", "CLIENT", { active: "app", details: { app: `ping ${L1_IP.SERVER}: 100 sent · 100 received · 0% loss` }, action: "PING SUMMARY", reason: "A baseline turns 'normal' into numbers you can compare against later.", key: "ping ×100", result: "0% loss" }), "base-ping-summary", [{ kind: "observation", text: "Baseline: 100/100 ping replies", source: "CLIENT" }]), events: [ev("STEP_ENTERED", "base-ping-summary", "ping")] }),
  },
  // ---- Incident ---
  {
    id: "incident-intro",
    label: "Incident: 'the network is flaky'",
    narrative: "Three days later: users say file transfers to SERVER are slow and sometimes stall, and the monitoring dashboard shows occasional ping loss. Nobody changed anything. Start again from facts.",
    run: (s) => ({ state: withNotes({ ...idle(runTraffic(s, 60)), optics: { ...s.optics, "ACCESS-SW": { ...s.optics["ACCESS-SW"], rx: FAULT_RX } }, faultActive: true }, "incident-intro", [{ kind: "symptom", text: "Intermittent: slow/stalling transfers to SERVER, occasional ping loss", source: "users + monitoring" }]), events: [ev("STEP_ENTERED", "incident-intro", "incident")] }),
  },
  {
    id: "inc-ping-ok",
    label: "Ping seq 36: reply arrives",
    narrative: "Most replies still arrive: seq 36 crosses the uplink and passes the FCS check at ACCESS-SW.",
    run: (s) => ({ state: pingHop(s, "inc-ping-ok", "echo-reply", 36, "DIST-SW", "ACCESS-SW", false), events: [ev("PACKET_SENT", "inc-ping-ok", "reply 36")] }),
    packet: pkt,
  },
  {
    id: "inc-ping-bad",
    label: "Ping seq 37: reply never reaches CLIENT",
    narrative: `The reply to seq 37 reaches ACCESS-SW ${UPLINK}, but the CRC-32 computed over the received bits does not match the FCS in the frame. The frame is discarded — CLIENT's ping times out. Inspect ACCESS-SW's processing for this frame.`,
    run: (s) => ({ state: pingHop(s, "inc-ping-bad", "echo-reply", 37, "DIST-SW", "ACCESS-SW", true), events: [ev("PACKET_SENT", "inc-ping-bad", "reply 37")] }),
    packet: pkt,
  },
  {
    id: "inc-ping-summary",
    label: "100 pings: 1% loss",
    narrative: "100 pings: 99 replies, 1 lost (seq 37). The loss is small and intermittent — exactly the kind of fault that makes TCP transfers crawl while 'ping mostly works'.",
    run: (s) => ({ state: withNotes(note(pingSeries(runTraffic(idle(s), 10), "incident", [37]), "inc-ping-summary", "CLIENT", { active: "app", details: { app: `ping ${L1_IP.SERVER}: 100 sent · 99 received · 1% loss (seq 37)` }, action: "PING SUMMARY", reason: "Loss is a symptom. Every layer below the application could cause it — find which layer's evidence changed.", key: "ping ×100", result: "1% loss" }), "inc-ping-summary", [{ kind: "observation", text: "Incident: 99/100 ping replies (seq 37 lost)", source: "CLIENT" }, { kind: "observation", text: `Reply seq 37 failed the FCS check at ACCESS-SW ${UPLINK}`, source: "ACCESS-SW receive pipeline", rung: "Physical / interface" }]), events: [ev("STEP_ENTERED", "inc-ping-summary", "ping")] }),
  },
  {
    id: "q-scope",
    label: "Question: where to look first",
    narrative: "Every frame between CLIENT and SERVER crosses the uplink. One reply was discarded at the uplink with a bad FCS.",
    question: {
      prompt: "What is the most useful next step?",
      options: [
        { id: "iface", label: `Examine ACCESS-SW ${UPLINK}: state, error counters (as deltas) and optical readings` },
        { id: "dns", label: "Change CLIENT's DNS server" },
        { id: "reboot", label: "Reboot SERVER" },
        { id: "firewall", label: "Open more ports on the firewall" },
      ],
      correctOptionId: "iface",
      explanation: "The evidence already points at one interface's receive path. Gather that interface's facts before changing anything anywhere else.",
    },
  },
  {
    id: "inc-iface-state",
    label: `ACCESS-SW ${UPLINK}: still UP`,
    narrative: `admin up · oper up · 1000 Mb/s full · carrier transitions 2 · last change 41 days ago. No flap, no renegotiation. The link is UP — and that proves less than it seems.`,
    run: (s) => ({ state: withNotes(note(idle(s), "inc-iface-state", "ACCESS-SW", { active: "phy", ingress: UPLINK, details: { phy: `admin ${s.admin["ACCESS-SW"]} · oper ${s.oper["ACCESS-SW"]} · 1000 Mb/s full · carrier transitions ${s.counters["ACCESS-SW"].carrierTransitions} · last change ${s.lastFlap["ACCESS-SW"]}` }, action: "INTERFACE STATE", reason: "Oper UP means the receiver still has enough signal to hold link. It does not mean every bit is decoded correctly.", key: `show interfaces ${UPLINK}`, result: "admin up · oper up · stable" }), "inc-iface-state", [{ kind: "observation", text: `${UPLINK} admin up / oper up, no carrier transitions since baseline`, source: "ACCESS-SW", rung: "Physical / interface" }]), events: [ev("STEP_ENTERED", "inc-iface-state", "state")] }),
  },
  {
    id: "q-up-fault",
    label: "Question: UP but faulty?",
    narrative: "The interface is UP and has not flapped.",
    question: {
      prompt: "Can an interface be operationally UP and still have a Layer-1 fault?",
      options: [
        { id: "yes", label: "Yes — a marginal signal can hold link while bits are misread, causing CRC errors and loss" },
        { id: "no", label: "No — any Layer-1 fault brings the link down" },
        { id: "only-copper", label: "Only on copper, never on fiber" },
        { id: "only-admin", label: "Only if it is administratively down" },
      ],
      correctOptionId: "yes",
      explanation: "Link state is binary; signal quality is not. Between a clean signal and loss of signal lies a band where the link stays up and errors climb.",
    },
  },
  {
    id: "inc-snap-1",
    label: "Counter snapshot 1",
    narrative: `ACCESS-SW ${UPLINK} input errors and CRC: higher than at the baseline — but the lifetime number alone still cannot say what is happening now. Take a second reading.`,
    run: (s) => ({ state: takeSnap(s, "inc-snap-1", "incident #1"), events: [ev("STEP_ENTERED", "inc-snap-1", "snapshot")] }),
  },
  {
    id: "inc-snap-2",
    label: "Snapshot 2: the delta",
    narrative: `${WINDOW_S} s later: CRC +${WINDOW_CRC_FAULT}, input errors +${WINDOW_CRC_FAULT}, output errors +0, out of ~${fmt(WINDOW_PKTS)} frames received. DIST-SW ${UPLINK} (the other direction): CRC +0. Errors are happening now — and only on frames arriving at ACCESS-SW.`,
    run: (s) => {
      const n = takeSnap(runTraffic(s, WINDOW_S), "inc-snap-2", "incident #2");
      const d = deltaOf(n, "ACCESS-SW")!;
      const dd = deltaOf(n, "DIST-SW")!;
      return { state: withNotes(n, "inc-snap-2", [{ kind: "observation", text: `ACCESS-SW ${UPLINK}: CRC delta +${d.crc}, input errors +${d.inErrors} in ${d.to.t - d.from.t} s; output errors +${d.outErrors}`, source: "counter deltas", rung: "Physical / interface" }, { kind: "observation", text: `DIST-SW ${UPLINK}: CRC delta +${dd.crc} (other direction clean)`, source: "counter deltas" }, { kind: "inference", text: "Corruption is one-directional: frames arriving at ACCESS-SW over the DIST → ACCESS fiber" }]), events: [ev("STEP_ENTERED", "inc-snap-2", "snapshot")] };
    },
  },
  {
    id: "q-crc",
    label: "Question: which counter?",
    narrative: `CRC +${WINDOW_CRC_FAULT} and input errors +${WINDOW_CRC_FAULT}.`,
    question: {
      prompt: "Which counter indicates corrupted Ethernet frames?",
      options: [
        { id: "crc", label: "CRC / FCS errors — the frame's check sequence did not match the received bits" },
        { id: "out-drops", label: "Output drops" },
        { id: "in-pkts", label: "Input packets" },
        { id: "carrier", label: "Carrier transitions" },
      ],
      correctOptionId: "crc",
      explanation: "A CRC/FCS error means the bits changed between transmitter and receiver. Input errors is the umbrella count (it includes CRC). Drops are frames discarded for other reasons, such as full queues; carrier transitions count link up/down events.",
    },
  },
  {
    id: "q-delta",
    label: "Question: why deltas?",
    narrative: "Snapshot 1 and snapshot 2 were taken 30 s apart.",
    question: {
      prompt: "Why compare counter deltas instead of reading the counter once?",
      options: [
        { id: "rate", label: "Counters are cumulative; only the change over a known interval shows whether errors are happening now, and how fast" },
        { id: "reset", label: "Counters reset themselves every 30 seconds" },
        { id: "precision", label: "A single reading is rounded" },
        { id: "vendor", label: "Only some vendors keep counters" },
      ],
      correctOptionId: "rate",
      explanation: `+${WINDOW_CRC_FAULT} CRC in ${WINDOW_S} s against ~${fmt(WINDOW_PKTS)} frames is a live error rate. ${fmt(HISTORIC_CRC)} lifetime errors from weeks ago is not.`,
    },
  },
  {
    id: "inc-optics",
    label: "Read the optics",
    narrative: `DOM now: DIST-SW Tx ${dbm(HEALTHY_OPTICS["DIST-SW"].tx)} (unchanged) → ACCESS-SW Rx ${dbm(FAULT_RX)} (baseline ${dbm(HEALTHY_OPTICS["ACCESS-SW"].rx)}). ACCESS-SW Tx ${dbm(HEALTHY_OPTICS["ACCESS-SW"].tx)} → DIST-SW Rx ${dbm(HEALTHY_OPTICS["DIST-SW"].rx)} (normal). With the PacketVerse thresholds, ${dbm(FAULT_RX)} is in the marginal band: enough to hold link, not enough to decode every bit.`,
    run: (s) => ({ state: withNotes(readOptics(s, "inc-optics", "incident"), "inc-optics", [{ kind: "observation", text: `ACCESS-SW Rx ${dbm(s.optics["ACCESS-SW"].rx)} (baseline ${dbm(HEALTHY_OPTICS["ACCESS-SW"].rx)}); DIST-SW Tx unchanged ${dbm(s.optics["DIST-SW"].tx)}`, source: "DOM", rung: "Physical / interface" }, { kind: "inference", text: `≈${(HEALTHY_OPTICS["DIST-SW"].tx - s.optics["ACCESS-SW"].rx).toFixed(1)} dB lost on the DIST → ACCESS path (baseline ≈${(HEALTHY_OPTICS["DIST-SW"].tx - HEALTHY_OPTICS["ACCESS-SW"].rx).toFixed(1)} dB): the transmitter is fine, the path is not` }]), events: [ev("STEP_ENTERED", "inc-optics", "optics")] }),
  },
  {
    id: "q-rx-peer",
    label: "Question: whose signal?",
    narrative: `DIST-SW Tx ${dbm(HEALTHY_OPTICS["DIST-SW"].tx)}, ACCESS-SW Rx ${dbm(FAULT_RX)}.`,
    question: {
      prompt: "ACCESS-SW's Rx dropped while DIST-SW's Tx stayed normal. What does that isolate?",
      options: [
        { id: "path", label: "The loss is in the DIST → ACCESS light path: the fiber, a connector or patch panel, or the ACCESS-SW receiver" },
        { id: "dist-tx", label: "DIST-SW's transmitter is failing" },
        { id: "both", label: "Both directions are equally degraded" },
        { id: "software", label: "A software bug on DIST-SW" },
      ],
      correctOptionId: "path",
      explanation: "A healthy Tx at the far end plus a low Rx at the near end places the loss between them. The opposite direction reads normal, which rules out a shared cause such as the whole cable being cut.",
    },
  },
  {
    id: "hypotheses",
    label: "Rule out the usual suspects",
    narrative: "Tickets suggest DNS, a VLAN mismatch, a routing metric or a firewall policy. Test each against the evidence you already hold.",
    run: (s) => ({ state: withNotes(idle(s), "hypotheses", [{ kind: "ruled-out", text: "DNS — pings by IP address fail too; frames die before any application" }, { kind: "ruled-out", text: "VLAN mismatch — 99% of frames cross; a VLAN mismatch would drop all of them, with good FCS" }, { kind: "ruled-out", text: "Routing metric — CLIENT and SERVER share a subnet; there is no routing hop" }, { kind: "ruled-out", text: "Firewall policy — no filter between the switches; discards are FCS failures" }, { kind: "hypothesis", text: "Attenuation on the DIST → ACCESS fiber path corrupts bits at ACCESS-SW's receiver" }]), events: [ev("STEP_ENTERED", "hypotheses", "hypotheses")] }),
    question: {
      prompt: "Why is DNS irrelevant here?",
      options: [
        { id: "l1", label: "Pings to an IP address are lost too, and the lost frames fail an Ethernet FCS check — below anything DNS touches" },
        { id: "cache", label: "Because DNS answers are cached" },
        { id: "udp", label: "Because DNS uses UDP" },
        { id: "relevant", label: "DNS is the most likely cause" },
      ],
      correctOptionId: "l1",
      explanation: "DNS translates names to addresses before traffic starts. Here frames addressed by IP are corrupted in flight — a physical-layer signature.",
    },
  },
  {
    id: "diagnostic-layers",
    label: "Walk the evidence ladder",
    narrative: "The lowest failing rung is the one to fix. Everything above it is healthy or only showing the symptom.",
  },
  {
    id: "predict-cause",
    label: "Predict: root cause",
    narrative: "Combine the facts: link UP and stable, CRC rising only on ACCESS-SW ingress, ACCESS Rx far below baseline while DIST Tx is normal.",
    question: {
      prompt: "What is the root cause?",
      options: [
        { id: "optical", label: `Degraded receive light at ACCESS-SW ${UPLINK}: attenuation on the DIST → ACCESS fiber path` },
        { id: "duplex", label: "A duplex mismatch" },
        { id: "vlan", label: "VLAN 10 is missing on the uplink" },
        { id: "server", label: "SERVER's NIC driver" },
      ],
      correctOptionId: "optical",
      explanation: "A duplex mismatch shows late collisions and errors in both directions on copper; fiber at 1 Gb/s is full duplex. The evidence is one-directional and tied to a receive level.",
    },
    run: (s) => ({ state: withNotes(idle(s), "predict-cause", [{ kind: "root-cause", text: `Low receive optical level on ACCESS-SW ${UPLINK} (DIST → ACCESS fiber path attenuation)`, source: "DOM + CRC deltas" }]), events: [] }),
  },
  {
    id: "q-clear-counters",
    label: "Question: clear the counters?",
    narrative: "Someone proposes: 'Just clear the counters and see if the errors are gone.'",
    question: {
      prompt: "Does clearing the counters fix the fault?",
      options: [
        { id: "no", label: "No — it only resets the numbers; the light level, and the errors, are unchanged" },
        { id: "yes", label: "Yes — the errors are stored in the counters" },
        { id: "sometimes", label: "Only if done twice" },
        { id: "reboot", label: "Only if the switch is rebooted too" },
      ],
      correctOptionId: "no",
      explanation: "Clearing is a measurement convenience (it makes the next delta easy to read). It changes nothing physical — and it destroys history you may need.",
    },
  },
  // ---- Repair ---
  {
    id: "repair-challenge",
    label: "Repair the physical path",
    narrative: "Choose the change that fixes the cause you identified.",
    action: (s, payload) => ({ state: applyL1Repair(s, (payload as { choice: string }).choice), events: [ev("STEP_ENTERED", "repair-challenge", `Repair attempt: ${(payload as { choice: string }).choice}`)] }),
    requiresState: (s) => s.repaired,
  },
  // ---- Verify ---
  {
    id: "ver-optics",
    label: "Verify: optics",
    narrative: `After cleaning and reseating the connector on the DIST → ACCESS path: ACCESS-SW Rx ${dbm(REPAIRED_RX)} — back in the normal band. The link went down and up during the reseat: carrier transitions +2, last change 'just now'. It is UP again.`,
    run: (s) => ({ state: withNotes(readOptics(s, "ver-optics", "after repair"), "ver-optics", [{ kind: "observation", text: `ACCESS-SW Rx ${dbm(s.optics["ACCESS-SW"].rx)} (normal); carrier transitions ${s.counters["ACCESS-SW"].carrierTransitions} (+2 from the reseat)`, source: "DOM + interface" }]), events: [ev("STEP_ENTERED", "ver-optics", "optics")] }),
  },
  {
    id: "ver-snap-1",
    label: "Verify: snapshot 1",
    narrative: "The CRC total is still higher than it was at the baseline — nobody cleared it, and a repair does not erase history. On its own, this reading says nothing about now. The next reading decides.",
    run: (s) => ({ state: takeSnap(s, "ver-snap-1", "verify #1"), events: [ev("STEP_ENTERED", "ver-snap-1", "snapshot")] }),
  },
  {
    id: "ver-snap-2",
    label: "Verify: snapshot 2 — delta 0",
    narrative: `${WINDOW_S} s later: CRC delta 0, input errors delta 0, interface still UP. The counter's total is unchanged from snapshot 1 — which is exactly the point.`,
    run: (s) => {
      const n = takeSnap(runTraffic(s, WINDOW_S), "ver-snap-2", "verify #2");
      const d = deltaOf(n, "ACCESS-SW")!;
      return { state: withNotes(n, "ver-snap-2", [{ kind: "verified", text: `ACCESS-SW ${UPLINK}: CRC delta +${d.crc} over ${d.to.t - d.from.t} s (total ${fmt(d.to.c.crc)} kept — history not erased)`, source: "counter deltas" }]), events: [ev("STEP_ENTERED", "ver-snap-2", "snapshot")] };
    },
  },
  {
    id: "ver-ping-reply",
    label: "Verify: replies cross cleanly",
    narrative: `A reply crosses the DIST → ACCESS fiber and passes the FCS check at ${dbm(REPAIRED_RX)}.`,
    run: (s) => ({ state: pingHop(s, "ver-ping-reply", "echo-reply", 37, "DIST-SW", "ACCESS-SW", false), events: [ev("PACKET_SENT", "ver-ping-reply", "reply")] }),
    packet: pkt,
  },
  {
    id: "ver-ping-summary",
    label: "Verify: 100 pings",
    narrative: "100 pings: 100 replies, 0% loss. Transfers run at full speed again.",
    run: (s) => ({ state: withNotes(note(pingSeries(runTraffic(idle(s), 10), "verify", []), "ver-ping-summary", "CLIENT", { active: "app", details: { app: `ping ${L1_IP.SERVER}: 100 sent · 100 received · 0% loss` }, action: "PING SUMMARY", reason: "The same test that showed the symptom now shows it gone.", key: "ping ×100", result: "0% loss" }), "ver-ping-summary", [{ kind: "verified", text: "100/100 ping replies after the repair (was 99/100)", source: "CLIENT" }]), events: [ev("STEP_ENTERED", "ver-ping-summary", "ping")] }),
    question: {
      prompt: "What proves the repair?",
      options: [
        { id: "all", label: "Normal Rx level, CRC delta 0 over a fresh interval with traffic, and the original ping test back to 0% loss" },
        { id: "up", label: "The interface is UP" },
        { id: "zero", label: "The CRC counter reads 0" },
        { id: "ticket", label: "No new user complaints for a minute" },
      ],
      correctOptionId: "all",
      explanation: "UP proved nothing before the fix, so it proves nothing after. The counter total never returns to 0 unless cleared — its delta is what matters — and the symptom's own test must pass again.",
    },
  },
  // ---- Complete ---
  {
    id: "operations",
    label: "On real switches",
    narrative: "The same evidence on real equipment — the syntax is vendor-specific. Juniper-style: show interfaces ge-0/0/47 extensive (errors, CRC, carrier transitions), show interfaces diagnostics optics ge-0/0/47 (Tx/Rx power and the optic's own alarm thresholds). Cisco-style: show interfaces Gi1/0/47 counters errors, show interfaces transceiver detail. Take two snapshots a known interval apart, and compare against the transceiver's own DOM thresholds.",
  },
  {
    id: "complete",
    label: "Lesson complete",
    narrative: "Admin vs operational state, Tx/Rx direction, CRC/FCS errors read as deltas, and a link that stayed UP while its receiver misread bits — located from evidence, repaired at the physical layer, and proven with fresh counters and the original test.",
  },
];
