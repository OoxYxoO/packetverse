import type { PacketVisual } from "../types";
import type { LabModel } from "@/lib/practice-lab/types";
import {
  ETH_MAC,
  ETH_REPAIR_CORRECT,
  ageFdb,
  applyEthRepair,
  bridge,
  createEthState,
  deskPortNeighbor,
  ethFrame,
  hostAccepts,
  lookup,
  macName,
  moveHostBBack,
  moveHostBToDesk,
  sw1PortNeighbor,
  BROADCAST_MAC,
  type EthDevice,
  type EthHost,
  type EthState,
  type EthSwitch,
} from "./ethernetSwitching";

/**
 * Ethernet Lab — the Practice Lab model for Ethernet & Switching, on the lesson's own network (SW1, DESK-SW,
 * HOST-A/B/C). Pure: the generic lab runner decides WHEN `start`/`arrive` run (animated or instant); this file
 * decides WHAT happens, and every protocol decision is delegated to the lesson's scenario module:
 *   bridge()            source learning + destination lookup + flood/forward/filter (SW1 and DESK-SW)
 *   hostAccepts()       NIC destination-MAC filter
 *   ageFdb()            timestamp-derived aging
 *   moveHostBToDesk / moveHostBBack   the lesson's link-down flush / link-up-teaches-nothing behaviour
 *   applyEthRepair()    clearing the stale dynamic entry
 * Only the orchestration of frame copies across links ("waves") lives here. Nothing here touches the guided
 * lesson's ScenarioEngine or the progress store.
 *
 * Timing: a frame leaves its host at `start` (wave 0). Each `arrive` delivers every copy currently on a link:
 * a switch learns the SOURCE MAC against the ingress port, looks up the DESTINATION, and puts its copies on the
 * egress links (the next wave); a host accepts or discards. State changes only at those arrival boundaries.
 * Lab time (`net.clock`) moves only through the "time" action — sends are instantaneous.
 */

export type EthLabAction = { type: "send"; src: EthHost; dst: EthHost | "broadcast" } | { type: "time"; seconds: number } | { type: "move-b"; to: "desk" | "sw1" } | { type: "clear-b" };

export type EthSegmentOutcome = "accepted" | "discarded" | "forwarded" | "dead-end" | "filtered";
/** One copy of the frame on one link: leaves `from` out of `egress` at wave `wave`, arrives at `to` on `ingress` at wave + 1. */
export interface EthSegment {
  id: string;
  from: EthDevice;
  to: EthDevice;
  egress: string;
  ingress: string;
  wave: number;
  /** What `to` did with it — set when it arrives. */
  outcome?: EthSegmentOutcome;
}

export type EthLearnKind = "learned" | "refreshed" | "moved";
export interface EthLearn {
  sw: EthSwitch;
  mac: string;
  port: string;
  kind: EthLearnKind;
  /** Previous port, for a move. */
  from?: string;
}
export interface EthSwitchDecision {
  sw: EthSwitch;
  ingress: string;
  kind: "unknown-unicast" | "known-unicast" | "broadcast";
  egress: string[];
  lookupResult: string;
}

export interface EthTransmission {
  id: number;
  src: EthHost;
  dst: EthHost | "broadcast";
  frame: PacketVisual;
  /** Lab clock when it was sent. */
  clock: number;
  /** Arrivals processed so far. */
  wave: number;
  /** Total arrivals this frame takes (from a dry run at `start`). */
  waves: number;
  segments: EthSegment[];
  learned: EthLearn[];
  decisions: EthSwitchDecision[];
  received: { host: EthHost; accepted: boolean }[];
}

export interface EthFdbChange {
  sw: EthSwitch;
  mac: string;
  port: string;
  age?: number;
}
export type EthLabEvent =
  | { type: "send"; txId: number }
  | { type: "time"; seconds: number; from: number; to: number; expired: EthFdbChange[] }
  | { type: "move-b"; to: "desk" | "sw1"; flushed: EthFdbChange[]; staleKept?: EthFdbChange }
  | { type: "clear-b"; removed?: EthFdbChange };

export interface EthLabLogEntry {
  id: number;
  tag: string;
  text: string;
  kind?: "learn" | "info" | "warning";
}

export interface EthLabState {
  net: EthState;
  tx?: EthTransmission;
  /** Number of actions taken; the latest event's id. */
  seq: number;
  last?: EthLabEvent;
  log: EthLabLogEntry[];
}

export const ETH_HOSTS: EthHost[] = ["HOST-A", "HOST-B", "HOST-C"];

export const createEthLabState = (): EthLabState => ({ net: createEthState(), seq: 0, log: [{ id: 0, tag: "t=0s", text: "Lab ready: SW1 and DESK-SW tables empty · HOST-B on SW1 ge-0/0/2 · all links up", kind: "info" }] });

/** Where a host is plugged in right now. */
export function hostAttachment(net: EthState, host: EthHost): { sw: EthSwitch; port: string } {
  if (host === "HOST-A") return { sw: "SW1", port: "ge-0/0/1" };
  if (host === "HOST-C") return { sw: "SW1", port: "ge-0/0/3" };
  return net.hostB === "SW1 ge-0/0/2" ? { sw: "SW1", port: "ge-0/0/2" } : { sw: "DESK-SW", port: "port 2" };
}

const neighborOf = (net: EthState, sw: EthSwitch, port: string) => (sw === "SW1" ? sw1PortNeighbor(net, port) : deskPortNeighbor(net, port));
/** The port a copy arrives on at the far end of `sw`'s `port`. */
const peerIngress = (sw: EthSwitch, port: string) => (sw === "SW1" && port === "ge-0/0/4" ? "port 1" : sw === "DESK-SW" && port === "port 1" ? "ge-0/0/4" : "eth0");
const isSwitch = (d: EthDevice): d is EthSwitch => d === "SW1" || d === "DESK-SW";
const name = (mac: string) => (mac === BROADCAST_MAC ? "broadcast" : macName(mac));
const tag = (net: EthState) => `t=${net.clock}s`;

export const isInFlight = (s: EthLabState) => !!s.tx && s.tx.segments.some((g) => g.wave === s.tx!.wave && !g.outcome);

function pushLog(log: EthLabLogEntry[], net: EthState, entries: { text: string; kind?: EthLabLogEntry["kind"] }[]): EthLabLogEntry[] {
  let id = log.length ? log[log.length - 1].id : 0;
  return [...log, ...entries.map((e) => ({ id: ++id, tag: tag(net), text: e.text, kind: e.kind }))];
}

/** Deliver every copy currently on a link (one wave). */
function arriveOnce(s: EthLabState): EthLabState {
  const tx = s.tx;
  if (!tx || !isInFlight(s)) return s;
  let net = s.net;
  const segments = [...tx.segments];
  const learned = [...tx.learned];
  const decisions = [...tx.decisions];
  const received = [...tx.received];
  const logs: { text: string; kind?: EthLabLogEntry["kind"] }[] = [];
  const src = tx.frame.layers[0].fields.find((f) => f.label === "Source MAC")!.value;
  const dst = tx.frame.layers[0].fields.find((f) => f.label === "Destination MAC")!.value;

  segments.forEach((seg, i) => {
    if (seg.wave !== tx.wave || seg.outcome) return;
    if (!isSwitch(seg.to)) {
      const accepted = hostAccepts(seg.to, tx.frame);
      segments[i] = { ...seg, outcome: accepted ? "accepted" : "discarded" };
      received.push({ host: seg.to, accepted });
      logs.push({ text: accepted ? `${seg.to} accepted: destination ${dst} ${dst === BROADCAST_MAC ? "is the broadcast address" : "is its own MAC"}` : `${seg.to} discarded: destination ${dst} is ${name(dst)}, not ${seg.to}`, kind: accepted ? "info" : "warning" });
      return;
    }
    const sw = seg.to;
    const prior = lookup(net.fdb[sw], src);
    const r = bridge(net, sw, seg.ingress, tx.frame);
    net = { ...net, fdb: { ...net.fdb, [sw]: r.fdb } };
    const kind: EthLearnKind = !prior ? "learned" : prior.port !== seg.ingress ? "moved" : "refreshed";
    learned.push({ sw, mac: src, port: seg.ingress, kind, from: kind === "moved" ? prior!.port : undefined });
    decisions.push({ sw, ingress: seg.ingress, kind: r.kind, egress: r.egress, lookupResult: r.lookupResult });
    logs.push({ text: `${sw} ${kind === "learned" ? "learned" : kind === "moved" ? `moved ${prior!.port} →` : "refreshed"} ${name(src)} (source ${src}) on ${seg.ingress}`, kind: kind === "refreshed" ? "info" : "learn" });
    const out = r.egress.map((port) => ({ port, to: neighborOf(net, sw, port) })).filter((c): c is { port: string; to: EthDevice } => c.to !== undefined);
    const what = r.kind === "broadcast" ? "broadcast → flood" : r.kind === "unknown-unicast" ? `lookup ${dst}: miss → flood` : `lookup ${dst}: hit → forward`;
    logs.push({ text: `${sw} ${what}${out.length ? ` out ${out.map((o) => o.port).join(", ")}` : r.kind === "known-unicast" ? " — destination is on the ingress port: filter" : " — no other port is up: nothing to send"}`, kind: out.length ? "info" : "warning" });
    segments[i] = { ...seg, outcome: out.length ? "forwarded" : r.kind === "known-unicast" ? "filtered" : "dead-end" };
    out.forEach((o) => segments.push({ id: `${seg.id}.${o.to}`, from: sw, to: o.to, egress: o.port, ingress: peerIngress(sw, o.port), wave: tx.wave + 1 }));
  });

  const next: EthTransmission = { ...tx, wave: tx.wave + 1, segments, learned, decisions, received };
  const done = !next.segments.some((g) => g.wave === next.wave);
  if (done && dst !== BROADCAST_MAC && !received.some((r) => r.accepted)) logs.push({ text: `Frame lost: no copy reached ${name(dst)}`, kind: "warning" });
  return { ...s, net, tx: next, log: pushLog(s.log, net, logs) };
}

function startSend(s: EthLabState, a: Extract<EthLabAction, { type: "send" }>): EthLabState {
  const at = hostAttachment(s.net, a.src);
  const dstMac = a.dst === "broadcast" ? BROADCAST_MAC : ETH_MAC[a.dst];
  const id = s.seq + 1;
  const frame = ethFrame(`lab-${id}`, a.src, at.sw, ETH_MAC[a.src], dstMac, a.dst === "broadcast" ? "0x0806" : "0x0800");
  const tx: EthTransmission = { id, src: a.src, dst: a.dst, frame, clock: s.net.clock, wave: 0, waves: 0, segments: [{ id: `${id}`, from: a.src, to: at.sw, egress: "eth0", ingress: at.port, wave: 0 }], learned: [], decisions: [], received: [] };
  const started: EthLabState = {
    ...s,
    seq: id,
    tx,
    last: { type: "send", txId: id },
    log: pushLog(s.log, s.net, [{ text: `${a.src} sends ${a.dst === "broadcast" ? "a broadcast" : `to ${a.dst}`}: dst ${dstMac} · src ${ETH_MAC[a.src]} · EtherType ${a.dst === "broadcast" ? "0x0806" : "0x0800"} → ${at.sw} ${at.port}` }]),
  };
  // Dry run (pure) to know how many arrivals this frame takes — used for animation and Replay, never applied here.
  let probe = started;
  let waves = 0;
  while (isInFlight(probe) && waves < 16) {
    probe = arriveOnce(probe);
    waves++;
  }
  return { ...started, tx: { ...tx, waves } };
}

function applyTime(s: EthLabState, seconds: number): EthLabState {
  const from = s.net.clock;
  const to = from + seconds;
  const expired: EthFdbChange[] = [];
  const fdb = { ...s.net.fdb };
  (["SW1", "DESK-SW"] as EthSwitch[]).forEach((sw) => {
    const r = ageFdb(fdb[sw], to);
    fdb[sw] = r.kept;
    r.expired.forEach((x) => expired.push({ sw, mac: x.entry.mac, port: x.entry.port, age: x.age }));
  });
  const net: EthState = { ...s.net, clock: to, fdb };
  const logs = [{ text: `${seconds} s pass (lab clock ${from} → ${to} s)` }, ...expired.map((x) => ({ text: `${x.sw}: ${name(x.mac)} on ${x.port} expired — last seen as a source ${x.age} s ago (> 300 s aging time)`, kind: "warning" as const }))];
  if (!expired.length) logs.push({ text: "No entry is older than the 300 s aging time — nothing expired" });
  return { ...s, net, seq: s.seq + 1, last: { type: "time", seconds, from, to, expired }, log: pushLog(s.log, net, logs) };
}

function applyMove(s: EthLabState, to: "desk" | "sw1"): EthLabState {
  if (to === "desk") {
    if (s.net.hostB !== "SW1 ge-0/0/2") return s;
    const flushed = s.net.fdb.SW1.filter((e) => e.port === "ge-0/0/2").map((e) => ({ sw: "SW1" as EthSwitch, mac: e.mac, port: e.port }));
    const net = moveHostBToDesk(s.net);
    return {
      ...s,
      net,
      seq: s.seq + 1,
      last: { type: "move-b", to, flushed },
      log: pushLog(s.log, net, [
        { text: "HOST-B unplugged from SW1 ge-0/0/2 — link DOWN", kind: "warning" },
        { text: flushed.length ? `SW1 flushed the dynamic entries learned on ge-0/0/2: ${flushed.map((f) => name(f.mac)).join(", ")}` : "SW1 had no entries on ge-0/0/2 to flush" },
        { text: "HOST-B plugged into DESK-SW port 2 — SW1 learns nothing until HOST-B sends" },
      ]),
    };
  }
  if (s.net.hostB === "SW1 ge-0/0/2") return s;
  const flushed = s.net.fdb["DESK-SW"].filter((e) => e.port === "port 2").map((e) => ({ sw: "DESK-SW" as EthSwitch, mac: e.mac, port: e.port }));
  const net = moveHostBBack(s.net);
  const kept = lookup(net.fdb.SW1, ETH_MAC["HOST-B"]);
  return {
    ...s,
    net,
    seq: s.seq + 1,
    last: { type: "move-b", to, flushed, staleKept: kept && kept.port !== "ge-0/0/2" ? { sw: "SW1", mac: kept.mac, port: kept.port } : undefined },
    log: pushLog(s.log, net, [
      { text: "HOST-B unplugged from DESK-SW port 2 — DESK-SW port 2 DOWN", kind: "warning" },
      { text: flushed.length ? `DESK-SW flushed the entries learned on port 2: ${flushed.map((f) => name(f.mac)).join(", ")}` : "DESK-SW had no entries on port 2 to flush" },
      { text: "HOST-B plugged into SW1 ge-0/0/2 — link UP. A link coming up teaches SW1 no MAC addresses" },
      kept && kept.port !== "ge-0/0/2" ? { text: `SW1 ${kept.port} never went down, so SW1 still maps HOST-B → ${kept.port} (stale)`, kind: "warning" } : { text: "SW1 has no entry for HOST-B" },
    ]),
  };
}

function applyClear(s: EthLabState): EthLabState {
  const prior = lookup(s.net.fdb.SW1, ETH_MAC["HOST-B"]);
  const net = applyEthRepair(s.net, ETH_REPAIR_CORRECT);
  return {
    ...s,
    net,
    seq: s.seq + 1,
    last: { type: "clear-b", removed: prior ? { sw: "SW1", mac: prior.mac, port: prior.port } : undefined },
    log: pushLog(s.log, net, [{ text: prior ? `SW1: dynamic entry HOST-B → ${prior.port} cleared. HOST-B is now unknown to SW1` : "SW1 had no entry for HOST-B to clear", kind: prior ? "warning" : "info" }]),
  };
}

function start(s: EthLabState, a: EthLabAction): EthLabState {
  if (a.type === "send") return startSend(s, a);
  if (a.type === "time") return applyTime(s, a.seconds);
  if (a.type === "move-b") return applyMove(s, a.to);
  return applyClear(s);
}

export const ETH_LAB_MODEL: LabModel<EthLabState, EthLabAction> = {
  initial: createEthLabState,
  hops: (s, a) => (a.type === "send" ? startSend(s, a).tx!.waves : 0),
  start,
  arrive: arriveOnce,
};

/** Copies to draw at `wave` (0…tx.waves): those on a link, and those that ended at a device (resting there). Pure — Replay uses it with a replay wave and never touches lab state. */
export function ethVisibleSegments(tx: EthTransmission, wave: number): { seg: EthSegment; moving: boolean }[] {
  return tx.segments.filter((g) => g.wave === wave || (g.wave < wave && g.outcome && g.outcome !== "forwarded")).map((seg) => ({ seg, moving: seg.wave === wave }));
}

/** Did a unicast frame reach its destination host? */
export const ethDelivered = (tx: EthTransmission) => tx.dst !== "broadcast" && tx.received.some((r) => r.host === tx.dst && r.accepted);
