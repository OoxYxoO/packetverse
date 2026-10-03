import type { PacketVisual } from "../types";
import type { LabModel } from "@/lib/practice-lab/types";
import { ADDR, IPV4_INITIAL_TTL, TCP_ISN, TCP_PORT, eth, ipLayer } from "./firstConnection";

/**
 * TCP LAB — a pure, deterministic TCP model for the TCP Practice Lab on the first-connection network
 * (Laptop → SW1 → R1 → Server). Independent of the guided lesson (it never reads or writes its state).
 *
 * Semantics follow RFC 9293, for exactly what the lab teaches:
 *   - each endpoint keeps its OWN connection state (TCB): state, ISS, SND.UNA, SND.NXT, IRS, RCV.NXT and a
 *     retransmission queue; connections are found by their 4-tuple;
 *   - SYN consumes one sequence number; data advances SND.NXT / RCV.NXT by its payload length;
 *     an ACK number is the next byte expected;
 *   - a SYN to a port with no listener is answered with <SEQ=0><ACK=SEG.SEQ+SEG.LEN><CTL=RST,ACK> (§3.10.7.1),
 *     and a SYN-SENT endpoint receiving an acceptable RST closes ("connection refused");
 *   - a segment that is not acceptable (a duplicate) is answered with <SEQ=SND.NXT><ACK=RCV.NXT><CTL=ACK>
 *     and changes nothing; a SYN-SENT endpoint drops an ACK that carries neither SYN nor RST;
 *   - lost segments are recovered only by retransmitting the same sequence range from the retransmission queue.
 *
 * Deliberately NOT modelled (and never shown as numbers): window, checksum, urgent pointer, TCP options (MSS…),
 * timer durations, FIN / orderly close. The retransmission timer is a learner-controlled lab event.
 * Lab-chosen values (real stacks pick random ISNs; payload contents are lab data, not a real TLS/HTTP message)
 * are declared once below.
 */

// ---------------------------------------------------------------------------------------------------------------
// Network and lab-chosen values
// ---------------------------------------------------------------------------------------------------------------
export type TcpLabNode = "laptop" | "switch" | "router" | "server";
export type TcpHost = "client" | "server";
export interface TcpEndpoint {
  ip: string;
  port: number;
}
export type TcpState = "CLOSED" | "LISTEN" | "SYN-SENT" | "SYN-RECEIVED" | "ESTABLISHED";
export type TcpFlag = "SYN" | "ACK" | "PSH" | "RST";

/** The three connection attempts the lab can make. `main` is the guided lesson's own connection. */
export type TcpConnId = "main" | "refused" | "incident";
export const TCP_LAB_CONNS: Record<TcpConnId, { clientPort: number; serverPort: number; clientIsn: number; serverIsn: number; label: string }> = {
  main: { clientPort: TCP_PORT.client, serverPort: TCP_PORT.server, clientIsn: TCP_ISN.client, serverIsn: TCP_ISN.server, label: "HTTPS connection" },
  // Lab-chosen ISN for a second attempt from a new ephemeral port to a port where nothing listens.
  refused: { clientPort: TCP_PORT.client + 1, serverPort: 8443, clientIsn: 700, serverIsn: 0, label: "attempt to :8443" },
  // Lab-chosen ISNs for the incident's connection attempt.
  incident: { clientPort: TCP_PORT.client + 2, serverPort: TCP_PORT.server, clientIsn: 900, serverIsn: 2000, label: "incident attempt" },
};
/** Ports with a listening socket on the Server. */
export const TCP_LAB_LISTENING: number[] = [TCP_PORT.server];
/** Lab application data: fixed ASCII payloads (1 byte per character). */
export const TCP_LAB_PAYLOADS = { first: "HELLO", second: "WORLD" } as const;

export const TCP_LAB_PATH: Record<"c2s" | "s2c", TcpLabNode[]> = { c2s: ["laptop", "switch", "router", "server"], s2c: ["server", "router", "switch", "laptop"] };
/** Where a lab-injected loss happens: on R1, the only router on the path. */
const DROP_NODE: TcpLabNode = "router";

// ---------------------------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------------------------
export interface TcpSegment {
  src: TcpEndpoint;
  dst: TcpEndpoint;
  flags: TcpFlag[];
  seq: number;
  /** Present only when the ACK flag is set (otherwise the field carries no meaning). */
  ack?: number;
  /** Application bytes ("" for none). */
  payload: string;
}
/** Bytes of sequence space a segment occupies: payload length, +1 for SYN (no FIN in this lab). */
export const segLen = (g: TcpSegment) => g.payload.length + (g.flags.includes("SYN") ? 1 : 0);
export const hasFlag = (g: TcpSegment, f: TcpFlag) => g.flags.includes(f);

/** One retransmission-queue entry: a segment sent but not yet acknowledged. */
export interface TcpUnacked {
  seq: number;
  flags: TcpFlag[];
  payload: string;
}
/** One endpoint's view of one connection (a TCB), or the Server's listening socket. */
export interface TcpTcb {
  host: TcpHost;
  conn?: TcpConnId;
  local: TcpEndpoint;
  /** Undefined for a listening socket. */
  remote?: TcpEndpoint;
  state: TcpState;
  iss?: number;
  sndUna?: number;
  sndNxt?: number;
  irs?: number;
  rcvNxt?: number;
  unacked: TcpUnacked[];
  /** Bytes delivered in order to the application. */
  delivered: string;
  /** Why a client attempt ended (shown to the "application"). */
  error?: "refused";
}

export type TcpCapturePoint = "laptop" | "r1-lan" | "r1-server" | "server";
/** One segment on the wire. Created once, complete and never changed afterwards. */
export interface TcpCaptureRecord {
  no: number;
  conn: TcpConnId;
  dir: "c2s" | "s2c";
  seg: TcpSegment;
  retransmission: boolean;
  /** Capture points the segment passes, in order (all of them if delivered; up to R1's ingress if dropped there). */
  points: TcpCapturePoint[];
  outcome: "delivered" | "dropped";
  drop?: { at: TcpLabNode; reason: "lab-loss" | "return-path-fault" };
  /** Lab action number that sent it. */
  action: number;
}
export interface TcpPending {
  from: TcpHost;
  conn: TcpConnId;
  seg: TcpSegment;
}
export interface TcpTransit {
  no: number;
  path: TcpLabNode[];
  hop: number;
  /** Hops until it is delivered (path end) or dropped (at R1). */
  hops: number;
}

export type TcpLabAction =
  | { type: "connect"; conn: TcpConnId }
  /** Transmit the oldest queued response (an endpoint's reply to what it just processed). */
  | { type: "deliver" }
  | { type: "send-data"; conn: TcpConnId; payload: string; dropAtR1?: boolean }
  /** Lab event: `host`'s retransmission timer expires for its oldest unacknowledged segment. */
  | { type: "timer"; host: TcpHost; conn: TcpConnId }
  | { type: "fault" }
  | { type: "repair" };

export type TcpLabEvent =
  | { type: "send"; no: number }
  | { type: "fault" }
  | { type: "repair" }
  | { type: "noop"; reason: string };

export interface TcpLabLogEntry {
  id: number;
  tag: string;
  text: string;
  kind?: "state" | "info" | "warning";
}

export interface TcpLabState {
  seq: number;
  sockets: { client: TcpTcb[]; server: TcpTcb[] };
  pending: TcpPending[];
  capture: TcpCaptureRecord[];
  tx?: TcpTransit;
  /** Lab fault: R1 drops TCP segments travelling from the Server toward the Laptop. */
  returnPathFault: boolean;
  last?: TcpLabEvent;
  log: TcpLabLogEntry[];
}

// ---------------------------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------------------------
const CLIENT_IP = ADDR.laptop.ip;
const SERVER_IP = ADDR.server.ip;
const ep = (ip: string, port: number): TcpEndpoint => ({ ip, port });
const sameEp = (a: TcpEndpoint | undefined, b: TcpEndpoint) => !!a && a.ip === b.ip && a.port === b.port;
export const epText = (e: TcpEndpoint) => `${e.ip}:${e.port}`;
export const flagText = (f: TcpFlag[]) => f.join(", ");

const LISTENER = (): TcpTcb => ({ host: "server", local: ep("0.0.0.0", TCP_PORT.server), state: "LISTEN", unacked: [], delivered: "" });

export function createTcpLabState(): TcpLabState {
  return {
    seq: 0,
    sockets: { client: [], server: [LISTENER()] },
    pending: [],
    capture: [],
    returnPathFault: false,
    log: [{ id: 0, tag: "#0", text: `Lab ready: Server listening on TCP ${TCP_PORT.server} · Laptop has no connection · ARP already resolved (see the ARP Lab)`, kind: "info" }],
  };
}

function pushLog(s: TcpLabState, entries: { text: string; kind?: TcpLabLogEntry["kind"] }[]): TcpLabLogEntry[] {
  let id = s.log[s.log.length - 1]?.id ?? 0;
  return [...s.log, ...entries.map((e) => ({ id: ++id, tag: `#${s.seq}`, text: e.text, kind: e.kind }))];
}

/** The TCB a host would use for a segment: exact 4-tuple match first, then (server) a listener on the port. */
function findTcb(tcbs: TcpTcb[], local: TcpEndpoint, remote: TcpEndpoint): number {
  const exact = tcbs.findIndex((t) => t.state !== "LISTEN" && t.state !== "CLOSED" && t.local.port === local.port && t.local.ip === local.ip && sameEp(t.remote, remote));
  return exact;
}
export const tcbFor = (s: TcpLabState, host: TcpHost, conn: TcpConnId) => s.sockets[host].find((t) => t.conn === conn);

const replaceTcb = (s: TcpLabState, host: TcpHost, i: number, t: TcpTcb | undefined): TcpLabState["sockets"] => {
  const list = [...s.sockets[host]];
  if (t === undefined) list.splice(i, 1);
  else if (i < 0) list.push(t);
  else list[i] = t;
  return { ...s.sockets, [host]: list };
};

const dirFor = (host: TcpHost): "c2s" | "s2c" => (host === "client" ? "c2s" : "s2c");
const ALL_POINTS: Record<"c2s" | "s2c", TcpCapturePoint[]> = { c2s: ["laptop", "r1-lan", "r1-server", "server"], s2c: ["server", "r1-server", "r1-lan", "laptop"] };

/** Put one segment on the wire: its full fate is decided now (deterministic), revealed hop by hop. */
function transmit(s: TcpLabState, from: TcpHost, conn: TcpConnId, seg: TcpSegment, retransmission: boolean, labDrop: boolean): TcpLabState {
  const dir = dirFor(from);
  const path = TCP_LAB_PATH[dir];
  const faultDrop = dir === "s2c" && s.returnPathFault;
  const dropped = labDrop || faultDrop;
  const dropHop = path.indexOf(DROP_NODE);
  const no = s.capture.length + 1;
  const rec: TcpCaptureRecord = {
    no,
    conn,
    dir,
    seg,
    retransmission,
    // R1's ingress interface sees the segment; its egress never does when R1 drops it.
    points: dropped ? ALL_POINTS[dir].slice(0, 2) : ALL_POINTS[dir],
    outcome: dropped ? "dropped" : "delivered",
    drop: dropped ? { at: DROP_NODE, reason: faultDrop ? "return-path-fault" : "lab-loss" } : undefined,
    action: s.seq,
  };
  return { ...s, capture: [...s.capture, rec], tx: { no, path, hop: 0, hops: dropped ? dropHop : path.length - 1 } };
}

const describe = (g: TcpSegment) => `${flagText(g.flags)} seq=${g.seq}${g.ack !== undefined ? ` ack=${g.ack}` : ""}${g.payload ? ` len=${g.payload.length}` : ""}`;

// ---------------------------------------------------------------------------------------------------------------
// Actions (start)
// ---------------------------------------------------------------------------------------------------------------
function start(s0: TcpLabState, a: TcpLabAction): TcpLabState {
  const s: TcpLabState = { ...s0, seq: s0.seq + 1, tx: undefined };
  const noop = (reason: string): TcpLabState => ({ ...s, last: { type: "noop", reason }, log: pushLog(s, [{ text: reason, kind: "info" }]) });

  if (a.type === "fault") {
    if (s.returnPathFault) return noop("The return-path fault is already active");
    // Deliberately neutral log text: the learner must find WHERE traffic stops from evidence.
    return { ...s, returnPathFault: true, last: { type: "fault" }, log: pushLog(s, [{ text: "Ticket opened: “the site never loads” — reproduce it", kind: "warning" }]) };
  }
  if (a.type === "repair") {
    if (!s.returnPathFault) return noop("Nothing to repair: the return path is healthy");
    return { ...s, returnPathFault: false, last: { type: "repair" }, log: pushLog(s, [{ text: "Repair: R1 forwards Server → Laptop TCP again (return path restored). Not verified yet — prove it with traffic.", kind: "warning" }]) };
  }

  if (a.type === "connect") {
    const c = TCP_LAB_CONNS[a.conn];
    if (tcbFor(s, "client", a.conn)) return noop(`The ${c.label} was already opened`);
    const local = ep(CLIENT_IP, c.clientPort);
    const remote = ep(SERVER_IP, c.serverPort);
    const tcb: TcpTcb = { host: "client", conn: a.conn, local, remote, state: "SYN-SENT", iss: c.clientIsn, sndUna: c.clientIsn, sndNxt: c.clientIsn + 1, unacked: [{ seq: c.clientIsn, flags: ["SYN"], payload: "" }], delivered: "" };
    const seg: TcpSegment = { src: local, dst: remote, flags: ["SYN"], seq: c.clientIsn, payload: "" };
    const next = { ...s, sockets: replaceTcb(s, "client", -1, tcb), last: { type: "send" as const, no: s.capture.length + 1 }, log: pushLog(s, [{ text: `Client ${epText(local)}: CLOSED → SYN-SENT · sends SYN seq=${c.clientIsn} to ${epText(remote)}`, kind: "state" }]) };
    return transmit(next, "client", a.conn, seg, false, false);
  }

  if (a.type === "deliver") {
    const [p, ...rest] = s.pending;
    if (!p) return noop("No segment is waiting to be sent");
    const next = { ...s, pending: rest, last: { type: "send" as const, no: s.capture.length + 1 }, log: pushLog(s, [{ text: `${p.from === "client" ? "Client" : "Server"} sends ${describe(p.seg)}` }]) };
    return transmit(next, p.from, p.conn, p.seg, false, false);
  }

  if (a.type === "send-data") {
    const i = s.sockets.client.findIndex((t) => t.conn === a.conn);
    const t = s.sockets.client[i];
    if (!t || t.state !== "ESTABLISHED" || t.sndNxt === undefined || t.rcvNxt === undefined) return noop("Application data needs an ESTABLISHED connection");
    if (!a.payload) return noop("No application bytes to send");
    const seg: TcpSegment = { src: t.local, dst: t.remote!, flags: ["PSH", "ACK"], seq: t.sndNxt, ack: t.rcvNxt, payload: a.payload };
    const tcb: TcpTcb = { ...t, sndNxt: t.sndNxt + a.payload.length, unacked: [...t.unacked, { seq: t.sndNxt, flags: ["PSH", "ACK"], payload: a.payload }] };
    const next = { ...s, sockets: replaceTcb(s, "client", i, tcb), last: { type: "send" as const, no: s.capture.length + 1 }, log: pushLog(s, [{ text: `Client sends ${a.payload.length} bytes "${a.payload}" seq=${seg.seq} · SND.NXT ${t.sndNxt} → ${tcb.sndNxt}` }]) };
    return transmit(next, "client", a.conn, seg, false, !!a.dropAtR1);
  }

  // timer: retransmit the oldest unacknowledged segment — same sequence number, same bytes; SND.NXT does not move.
  const i = s.sockets[a.host].findIndex((t) => t.conn === a.conn);
  const t = s.sockets[a.host][i];
  const u = t?.unacked[0];
  if (!t || !u || t.remote === undefined) return noop(`${a.host === "client" ? "The client" : "The server"} has nothing unacknowledged to retransmit`);
  const ackField = u.flags.includes("SYN") && !u.flags.includes("ACK") ? undefined : t.rcvNxt;
  const seg: TcpSegment = { src: t.local, dst: t.remote, flags: u.flags, seq: u.seq, ack: ackField, payload: u.payload };
  const next = { ...s, last: { type: "send" as const, no: s.capture.length + 1 }, log: pushLog(s, [{ text: `${a.host === "client" ? "Client" : "Server"} retransmission timer expired (lab event) → retransmits ${describe(seg)}`, kind: "warning" }]) };
  return transmit(next, a.host, a.conn, seg, true, false);
}

// ---------------------------------------------------------------------------------------------------------------
// Arrival — the receiving endpoint processes the segment (RFC 9293 §3.10.7)
// ---------------------------------------------------------------------------------------------------------------
function receive(s: TcpLabState, rec: TcpCaptureRecord): TcpLabState {
  const g = rec.seg;
  const host: TcpHost = rec.dir === "c2s" ? "server" : "client";
  const who = host === "server" ? "Server" : "Client";
  const idx = findTcb(s.sockets[host], g.dst, g.src);
  const t = idx >= 0 ? s.sockets[host][idx] : undefined;
  const reply = (seg: TcpSegment): TcpPending => ({ from: host, conn: rec.conn, seg });
  const log = (entries: { text: string; kind?: TcpLabLogEntry["kind"] }[]) => pushLog(s, entries);

  // --- No connection for this 4-tuple
  if (!t) {
    if (host === "server" && hasFlag(g, "SYN") && !hasFlag(g, "ACK")) {
      if (TCP_LAB_LISTENING.includes(g.dst.port)) {
        const c = TCP_LAB_CONNS[rec.conn];
        const tcb: TcpTcb = { host: "server", conn: rec.conn, local: g.dst, remote: g.src, state: "SYN-RECEIVED", irs: g.seq, rcvNxt: g.seq + 1, iss: c.serverIsn, sndUna: c.serverIsn, sndNxt: c.serverIsn + 1, unacked: [{ seq: c.serverIsn, flags: ["SYN", "ACK"], payload: "" }], delivered: "" };
        const synAck: TcpSegment = { src: g.dst, dst: g.src, flags: ["SYN", "ACK"], seq: c.serverIsn, ack: g.seq + 1, payload: "" };
        return { ...s, sockets: replaceTcb(s, "server", -1, tcb), pending: [...s.pending, reply(synAck)], log: log([{ text: `Server: SYN for listening port ${g.dst.port} → new connection ${epText(g.dst)} ↔ ${epText(g.src)} in SYN-RECEIVED · RCV.NXT=${tcb.rcvNxt} · SYN-ACK seq=${c.serverIsn} ack=${synAck.ack} queued`, kind: "state" }]) };
      }
      // Reachable host, nothing listening: the Server's TCP replies RST,ACK (no connection is created).
      const rst: TcpSegment = { src: g.dst, dst: g.src, flags: ["RST", "ACK"], seq: 0, ack: g.seq + segLen(g), payload: "" };
      return { ...s, pending: [...s.pending, reply(rst)], log: log([{ text: `Server: nothing listens on port ${g.dst.port} → RST,ACK seq=0 ack=${rst.ack} queued (no connection created)`, kind: "warning" }]) };
    }
    return { ...s, log: log([{ text: `${who}: no connection for ${epText(g.dst)} ↔ ${epText(g.src)} — segment ignored`, kind: "info" }]) };
  }

  // --- SYN-SENT (client)
  if (t.state === "SYN-SENT") {
    const acceptableAck = g.ack !== undefined && t.sndUna! < g.ack && g.ack <= t.sndNxt!;
    if (hasFlag(g, "RST")) {
      if (!acceptableAck) return { ...s, log: log([{ text: `${who}: RST with an unacceptable ACK — ignored` }]) };
      const tcb: TcpTcb = { ...t, state: "CLOSED", unacked: [], error: "refused" };
      return { ...s, sockets: replaceTcb(s, host, idx, tcb), log: log([{ text: `${who} ${epText(t.local)}: RST,ACK accepted → SYN-SENT → CLOSED · the application sees “connection refused”`, kind: "state" }]) };
    }
    if (hasFlag(g, "SYN") && acceptableAck) {
      const tcb: TcpTcb = { ...t, state: "ESTABLISHED", irs: g.seq, rcvNxt: g.seq + 1, sndUna: g.ack, unacked: t.unacked.filter((u) => u.seq + u.payload.length + (u.flags.includes("SYN") ? 1 : 0) > g.ack!) };
      const ack: TcpSegment = { src: t.local, dst: t.remote!, flags: ["ACK"], seq: tcb.sndNxt!, ack: tcb.rcvNxt, payload: "" };
      return { ...s, sockets: replaceTcb(s, host, idx, tcb), pending: [...s.pending, reply(ack)], log: log([{ text: `${who}: SYN-ACK ack=${g.ack} acknowledges its SYN · IRS=${g.seq}, RCV.NXT=${tcb.rcvNxt} → SYN-SENT → ESTABLISHED · ACK seq=${ack.seq} ack=${ack.ack} queued`, kind: "state" }]) };
    }
    // An ACK without SYN or RST does not move a SYN-SENT endpoint (RFC 9293: drop the segment).
    return { ...s, log: log([{ text: `${who}: ${describe(g)} carries no SYN — dropped while SYN-SENT (state unchanged)`, kind: "info" }]) };
  }

  // --- Synchronized states (SYN-RECEIVED, ESTABLISHED): sequence acceptability first
  // Exactly the next expected byte (this lab never reorders): anything earlier is a duplicate.
  if (g.seq !== t.rcvNxt) {
    // Duplicate (already received) → re-acknowledge what we expect next; no state changes.
    const ack: TcpSegment = { src: t.local, dst: t.remote!, flags: ["ACK"], seq: t.sndNxt!, ack: t.rcvNxt, payload: "" };
    return { ...s, pending: [...s.pending, reply(ack)], log: log([{ text: `${who}: duplicate ${describe(g)} (expects ${t.rcvNxt}) — nothing new; re-ACK ack=${t.rcvNxt} queued`, kind: "info" }]) };
  }
  let tcb: TcpTcb = { ...t };
  const notes: string[] = [];
  if (g.ack !== undefined && hasFlag(g, "ACK") && g.ack > t.sndUna! && g.ack <= t.sndNxt!) {
    tcb = { ...tcb, sndUna: g.ack, unacked: t.unacked.filter((u) => u.seq + u.payload.length + (u.flags.includes("SYN") ? 1 : 0) > g.ack!) };
    notes.push(`SND.UNA ${t.sndUna} → ${g.ack}`);
    if (t.state === "SYN-RECEIVED") {
      tcb = { ...tcb, state: "ESTABLISHED" };
      notes.push("SYN-RECEIVED → ESTABLISHED");
    }
  }
  let pending = s.pending;
  if (g.payload) {
    tcb = { ...tcb, rcvNxt: t.rcvNxt! + g.payload.length, delivered: t.delivered + g.payload };
    notes.push(`${g.payload.length} bytes "${g.payload}" delivered to the application · RCV.NXT ${t.rcvNxt} → ${tcb.rcvNxt}`);
    pending = [...pending, reply({ src: t.local, dst: t.remote!, flags: ["ACK"], seq: tcb.sndNxt!, ack: tcb.rcvNxt, payload: "" })];
    notes.push(`ACK ack=${tcb.rcvNxt} queued`);
  }
  return { ...s, sockets: replaceTcb(s, host, idx, tcb), pending, log: log([{ text: `${who}: ${describe(g)} accepted${notes.length ? ` · ${notes.join(" · ")}` : " · nothing new to acknowledge"}`, kind: notes.some((n) => n.includes("→ ESTABLISHED")) ? "state" : undefined }]) };
}

function arrive(s: TcpLabState): TcpLabState {
  if (!s.tx || s.tx.hop >= s.tx.hops) return s;
  const tx = { ...s.tx, hop: s.tx.hop + 1 };
  const next = { ...s, tx };
  if (tx.hop < tx.hops) return next;
  const rec = s.capture[tx.no - 1];
  if (rec.outcome === "dropped") {
    // A lab-injected loss is the learner's own experiment, so it is named. The incident's drop is silent, like on a
    // real network: no device reports it — only the captures show where the segment stopped.
    if (rec.drop!.reason === "return-path-fault") return next;
    return { ...next, log: pushLog(next, [{ text: `Segment #${rec.no} (${describe(rec.seg)}) lost at R1 — lab-injected loss; the Server never receives it`, kind: "warning" }]) };
  }
  return receive(next, rec);
}

// ---------------------------------------------------------------------------------------------------------------
// Model + derived views
// ---------------------------------------------------------------------------------------------------------------
export const TCP_LAB_MODEL: LabModel<TcpLabState, TcpLabAction> = {
  initial: createTcpLabState,
  hops: (s, a) => start(s, a).tx?.hops ?? 0,
  start,
  arrive,
};

export const isInFlight = (s: TcpLabState) => !!s.tx && s.tx.hop < s.tx.hops;
export const currentRecord = (s: TcpLabState) => (s.tx ? s.capture[s.tx.no - 1] : undefined);

/** Capture points that have seen record `rec` so far (the in-flight record reveals its points hop by hop). */
export function visiblePoints(s: TcpLabState, rec: TcpCaptureRecord): TcpCapturePoint[] {
  if (!s.tx || s.tx.no !== rec.no || s.tx.hop >= s.tx.hops) return rec.points;
  // In flight: the sender's point, plus R1's two interfaces once the segment has reached R1 (one if R1 drops it).
  const atOrPastR1 = s.tx.hop >= s.tx.path.indexOf(DROP_NODE);
  return rec.points.slice(0, atOrPastR1 ? Math.min(rec.points.length, 3) : 1);
}
/** Outcome as of now: the in-flight record is "in flight" until its last hop. */
export const recordOutcome = (s: TcpLabState, rec: TcpCaptureRecord): TcpCaptureRecord["outcome"] | "in-flight" => (s.tx?.no === rec.no && s.tx.hop < s.tx.hops ? "in-flight" : rec.outcome);

/**
 * The frame as it crosses one link of its path (`link` = 0 for the sender's own link). Ethernet is rewritten by
 * R1 and the TTL drops by one there; the switch changes nothing. TCP fields are the segment's own.
 */
export function tcpLabPacket(rec: TcpCaptureRecord, link: number): PacketVisual {
  const g = rec.seg;
  const afterRouter = link >= (rec.dir === "c2s" ? 2 : 1);
  const ether =
    rec.dir === "c2s"
      ? afterRouter
        ? eth(ADDR.routerWan.mac, ADDR.server.mac)
        : eth(ADDR.laptop.mac, ADDR.gateway.mac)
      : afterRouter
        ? eth(ADDR.gateway.mac, ADDR.laptop.mac)
        : eth(ADDR.server.mac, ADDR.routerWan.mac);
  const fields = [
    { label: "Source Port", value: String(g.src.port) },
    { label: "Destination Port", value: String(g.dst.port) },
    { label: "Sequence", value: String(g.seq) },
    { label: "Acknowledgment", value: g.ack !== undefined ? String(g.ack) : "0 (not valid — ACK flag clear)" },
    { label: "Header Length", value: "20 bytes (no options in this lab)" },
    { label: "Flags", value: flagText(g.flags) },
    { label: "Payload Length", value: `${g.payload.length} bytes` },
  ];
  return {
    id: `tcp-${rec.no}-${link}`,
    protocol: "TCP",
    from: rec.dir === "c2s" ? "laptop" : "server",
    to: rec.dir === "c2s" ? "server" : "laptop",
    summary: describe(g),
    layers: [
      ether,
      ipLayer(g.src.ip, g.dst.ip, afterRouter ? IPV4_INITIAL_TTL - 1 : IPV4_INITIAL_TTL),
      { name: "TCP", color: "var(--pv-proto-tcp)", fields },
      ...(g.payload ? [{ name: "Application data", color: "var(--pv-proto-generic, #94a3b8)", fields: [{ label: "Bytes", value: `"${g.payload}" (${g.payload.length} bytes, lab data)` }] }] : []),
    ],
  };
}

/** Byte-stream view of one direction of a connection, from the sender's and receiver's TCBs. */
export function byteStream(s: TcpLabState, conn: TcpConnId) {
  const c = tcbFor(s, "client", conn);
  const sv = tcbFor(s, "server", conn);
  if (!c || c.iss === undefined) return undefined;
  const sent = c.unacked.filter((u) => u.payload).map((u) => ({ seq: u.seq, payload: u.payload }));
  return { iss: c.iss, sndUna: c.sndUna!, sndNxt: c.sndNxt!, serverRcvNxt: sv?.rcvNxt, delivered: sv?.delivered ?? "", unackedData: sent };
}
