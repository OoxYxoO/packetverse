import type { PacketVisual } from "../types";
import type { LabModel } from "@/lib/practice-lab/types";
import {
  BROADCAST_MAC,
  HOST_ATTACH,
  LOOP_WAVES_SHOWN,
  SECONDARY_PORT,
  SWF_HOSTS,
  SWF_MAC,
  SWF_REPAIR_CORRECT,
  SWF_REPAIR_OPTIONS,
  applySwfRepair,
  broadcastFrame,
  bridge,
  createSwfState,
  frameDst,
  frameSrc,
  hostAccepts,
  lookup,
  macName,
  portInfo,
  unicastFrame,
  type BridgeKind,
  type SwfDevice,
  type SwfHost,
  type SwfState,
  type SwfSwitch,
} from "./switchingFundamentals";

/**
 * Switching Lab — the Practice Lab model for Switching Fundamentals, on the lesson's own two-switch network (SW1,
 * SW2, HOST-A/B/C/D, primary ge-0/0/23, secondary ge-0/0/24). Pure: the generic lab runner decides WHEN
 * `start`/`arrive` run (animated or instant); every protocol decision is delegated to the lesson's scenario module:
 *   bridge()            per-switch source learning + destination lookup + flood / forward / FILTER, using only that
 *                       switch's FDB and its FORWARDING ports (ge-0/0/24 only while the fault enables it)
 *   portInfo()          which device/port is at the other end of an egress port
 *   hostAccepts()       NIC destination-MAC filter
 *   applySwfRepair()    the lesson's repair: disable ge-0/0/24 on both switches, flush entries learned on it, and
 *                       lose the copy that was on that cable
 *   LOOP_WAVES_SHOWN    the lesson's documented VISUALIZATION limit for the loop
 * Only the orchestration of frame copies across links ("waves") lives here (a local copy of the Ethernet Lab's
 * approach — no shared Layer-2 code). Nothing here touches the guided lesson or progress.
 *
 * Loop honesty: with both inter-switch links forwarding and no loop prevention, a flood never ends — Ethernet has no
 * TTL. Each transmission is drawn for at most LOOP_WAVES_SHOWN bridge waves (exactly like the guided lesson); copies
 * that would reach a switch after that are kept as `circulating` — still in the network, never "stopped". Same-switch
 * arrivals in one wave are processed in port order, as the scenario documents for simultaneous copies.
 */

export type SwfLabAction =
  | { type: "send"; src: SwfHost; dst: SwfHost | "broadcast"; arpFor?: SwfHost }
  | { type: "clear"; sw: SwfSwitch }
  | { type: "enable-secondary" }
  | { type: "repair"; choice: string };

export const SWF_LAB_REPAIRS = SWF_REPAIR_OPTIONS;

export type SwfSegmentOutcome = "accepted" | "discarded" | "forwarded" | "filtered" | "dead-end" | "circulating";
/** One copy of the frame on one link: leaves `from` out of `egress` at wave `wave`, arrives at `to` on `ingress` at wave + 1. */
export interface SwfSegment {
  id: string;
  from: SwfDevice;
  to: SwfDevice;
  egress: string;
  ingress: string;
  wave: number;
  outcome?: SwfSegmentOutcome;
}

export type SwfLearnKind = "learned" | "refreshed" | "moved";
export interface SwfLearn {
  sw: SwfSwitch;
  mac: string;
  port: string;
  kind: SwfLearnKind;
  from?: string;
  /** Bridge wave in which this happened (a MAC can move several times in one loop). */
  wave: number;
}
export interface SwfSwitchDecision {
  sw: SwfSwitch;
  ingress: string;
  /** The lesson's explicit outcome set: unknown-unicast, known-unicast, broadcast or filter. */
  kind: BridgeKind;
  egress: string[];
  lookupResult: string;
  wave: number;
}

export interface SwfTransmission {
  id: number;
  /** "drain" = the copies left on ge-0/0/23 after the repair, delivered with one link forwarding. */
  kind: "send" | "drain";
  src: SwfHost;
  dst: SwfHost | "broadcast";
  frame: PacketVisual;
  wave: number;
  waves: number;
  /** Bridge waves processed so far (capped at LOOP_WAVES_SHOWN). */
  bridgeWaves: number;
  segments: SwfSegment[];
  learned: SwfLearn[];
  decisions: SwfSwitchDecision[];
  received: { host: SwfHost; accepted: boolean }[];
}

/** A copy still between the switches when the visualization paused — the real loop keeps forwarding it. */
export interface SwfCirculating {
  sw: SwfSwitch;
  ingress: string;
  frame: PacketVisual;
}

export type SwfLabEvent =
  | { type: "send"; txId: number }
  | { type: "clear"; sw: SwfSwitch; removed: { mac: string; port: string }[] }
  | { type: "enable-secondary" }
  | { type: "repair"; choice: string; correct: boolean; cleared?: boolean; flushed?: { sw: SwfSwitch; mac: string }[]; lost?: number; drained?: number };

export interface SwfLabLogEntry {
  id: number;
  tag: string;
  text: string;
  kind?: "learn" | "info" | "warning";
}

/** What the last looping transmission left behind — the incident's evidence (kept until the repair). */
export interface SwfLoopEvidence {
  txId: number;
  copies: Record<SwfHost, number>;
  moves: { sw: SwfSwitch; mac: string; from: string; to: string; wave: number }[];
}

export interface SwfLabState {
  net: SwfState;
  tx?: SwfTransmission;
  /** Copies still looping between SW1 and SW2 (only while ge-0/0/24 forwards). */
  circulating: SwfCirculating[];
  loopEvidence?: SwfLoopEvidence;
  /** Number of actions taken; the latest event's id. */
  seq: number;
  last?: SwfLabEvent;
  log: SwfLabLogEntry[];
}

export const SWF_LAB_HOSTS: SwfHost[] = SWF_HOSTS;

export const createSwfLabState = (): SwfLabState => ({ net: createSwfState(), circulating: [], seq: 0, log: [{ id: 0, tag: "#0", text: "Lab ready: SW1 and SW2 tables empty · ge-0/0/23 forwarding · ge-0/0/24 disabled · no loop prevention configured", kind: "info" }] });

const isSwitch = (d: SwfDevice): d is SwfSwitch => d === "SW1" || d === "SW2";
const name = (mac: string) => (mac === BROADCAST_MAC ? "broadcast" : macName(mac));

export const isInFlight = (s: SwfLabState) => !!s.tx && s.tx.segments.some((g) => g.wave === s.tx!.wave && !g.outcome);

function pushLog(log: SwfLabLogEntry[], seq: number, entries: { text: string; kind?: SwfLabLogEntry["kind"] }[]): SwfLabLogEntry[] {
  let id = log.length ? log[log.length - 1].id : 0;
  return [...log, ...entries.map((e) => ({ id: ++id, tag: `#${seq}`, text: e.text, kind: e.kind }))];
}

/** Deliver every copy currently on a link (one wave). */
function arriveOnce(s: SwfLabState): SwfLabState {
  const tx = s.tx;
  if (!tx || !isInFlight(s)) return s;
  let net = s.net;
  const segments = [...tx.segments];
  const learned = [...tx.learned];
  const decisions = [...tx.decisions];
  const received = [...tx.received];
  const circulating = [...s.circulating];
  const logs: { text: string; kind?: SwfLabLogEntry["kind"] }[] = [];
  const src = frameSrc(tx.frame);
  const dst = frameDst(tx.frame);
  // This wave's arrivals: hosts first, then each switch's copies in port order (the scenario's documented order).
  const here = segments.map((g, i) => ({ g, i })).filter(({ g }) => g.wave === tx.wave && !g.outcome);
  here.sort((a, b) => Number(isSwitch(a.g.to)) - Number(isSwitch(b.g.to)) || a.g.to.localeCompare(b.g.to) || a.g.ingress.localeCompare(b.g.ingress));
  const bridgeWave = here.some(({ g }) => isSwitch(g.to));
  const paused = bridgeWave && tx.bridgeWaves >= LOOP_WAVES_SHOWN;
  const waveNo = tx.bridgeWaves + (bridgeWave && !paused ? 1 : 0);

  here.forEach(({ g: seg, i }) => {
    if (!isSwitch(seg.to)) {
      const accepted = hostAccepts(seg.to, tx.frame);
      segments[i] = { ...seg, outcome: accepted ? "accepted" : "discarded" };
      received.push({ host: seg.to, accepted });
      const n = received.filter((r) => r.host === seg.to).length;
      logs.push({ text: accepted ? `${seg.to} accepted${n > 1 ? ` copy #${n}` : ""}: destination ${dst} ${dst === BROADCAST_MAC ? "is the broadcast address" : "is its own MAC"}` : `${seg.to} discarded: destination ${dst} is ${name(dst)}, not ${seg.to}`, kind: accepted ? (n > 1 ? "warning" : "info") : "warning" });
      return;
    }
    if (paused) {
      segments[i] = { ...seg, outcome: "circulating" };
      circulating.push({ sw: seg.to, ingress: seg.ingress, frame: tx.frame });
      return;
    }
    const sw = seg.to;
    const prior = lookup(net.fdb[sw], src);
    const r = bridge(net, sw, seg.ingress, tx.frame);
    net = { ...net, fdb: { ...net.fdb, [sw]: r.fdb } };
    const kind: SwfLearnKind = r.moved ? "moved" : prior ? "refreshed" : "learned";
    learned.push({ sw, mac: src, port: seg.ingress, kind, from: r.moved?.from, wave: waveNo });
    decisions.push({ sw, ingress: seg.ingress, kind: r.kind, egress: r.egress, lookupResult: r.lookupResult, wave: waveNo });
    logs.push({ text: `${sw} ${kind === "learned" ? "learned" : kind === "moved" ? `MOVED ${r.moved!.from} →` : "refreshed"} ${name(src)} (source ${src}) on ${seg.ingress} — in its own table`, kind: kind === "refreshed" ? "info" : kind === "moved" ? "warning" : "learn" });
    const out = r.egress.map((port) => ({ port, info: portInfo(sw, port)! }));
    const what =
      r.kind === "broadcast"
        ? "broadcast → flood"
        : r.kind === "unknown-unicast"
          ? `lookup ${dst}: miss in ${sw}'s table → flood`
          : r.kind === "known-unicast"
            ? `lookup ${dst}: hit in ${sw}'s table → forward`
            : `lookup ${dst}: hit on ${seg.ingress}, the port it arrived on → FILTER (nothing sent)`;
    logs.push({ text: `${sw} ${what}${out.length ? ` out ${out.map((o) => o.port).join(", ")}` : ""}`, kind: out.length ? "info" : "warning" });
    segments[i] = { ...seg, outcome: out.length ? "forwarded" : r.kind === "filter" ? "filtered" : "dead-end" };
    out.forEach((o) => segments.push({ id: `${seg.id}.${o.info.peer}${o.port.slice(-2)}`, from: sw, to: o.info.peer, egress: o.port, ingress: o.info.peerPort, wave: tx.wave + 1 }));
  });

  if (paused) {
    const n = here.filter(({ g }) => isSwitch(g.to)).length;
    logs.push({ text: `Visualization paused after ${LOOP_WAVES_SHOWN} bridge waves — ${n} cop${n === 1 ? "y is" : "ies are"} still circulating. Ethernet has no TTL: the real loop does not stop.`, kind: "warning" });
  }
  const next: SwfTransmission = { ...tx, wave: tx.wave + 1, bridgeWaves: waveNo, segments, learned, decisions, received };
  const loopEvidence: SwfLoopEvidence | undefined = paused
    ? { txId: tx.id, copies: Object.fromEntries(SWF_HOSTS.map((h) => [h, received.filter((r) => r.host === h).length])) as Record<SwfHost, number>, moves: learned.filter((l) => l.kind === "moved").map((l) => ({ sw: l.sw, mac: l.mac, from: l.from!, to: l.port, wave: l.wave })) }
    : s.loopEvidence;
  const done = !next.segments.some((g) => g.wave === next.wave);
  if (done && tx.kind === "send" && dst !== BROADCAST_MAC && !received.some((x) => x.accepted)) logs.push({ text: `Not delivered: no copy reached ${name(dst)}`, kind: "warning" });
  return { ...s, net, tx: next, circulating, loopEvidence, log: pushLog(s.log, s.seq, logs) };
}

/** Dry run (pure) to know how many arrivals a transmission takes — used for animation and Replay, never applied here. */
function withWaves(started: SwfLabState): SwfLabState {
  let probe = started;
  let waves = 0;
  while (isInFlight(probe) && waves < 24) {
    probe = arriveOnce(probe);
    waves++;
  }
  return { ...started, tx: { ...started.tx!, waves } };
}

function startSend(s: SwfLabState, a: Extract<SwfLabAction, { type: "send" }>): SwfLabState {
  const at = HOST_ATTACH[a.src];
  const id = s.seq + 1;
  const target = a.arpFor ?? SWF_HOSTS.find((h) => h !== a.src)!;
  const frame = a.dst === "broadcast" ? broadcastFrame(`swlab-${id}`, a.src, target) : unicastFrame(`swlab-${id}`, a.src, a.dst);
  const tx: SwfTransmission = { id, kind: "send", src: a.src, dst: a.dst, frame, wave: 0, waves: 0, bridgeWaves: 0, segments: [{ id: `${id}`, from: a.src, to: at.sw, egress: "eth0", ingress: at.port, wave: 0 }], learned: [], decisions: [], received: [] };
  return withWaves({
    ...s,
    seq: id,
    tx,
    last: { type: "send", txId: id },
    log: pushLog(s.log, id, [{ text: `${a.src} sends ${a.dst === "broadcast" ? `a broadcast (ARP request for ${target})` : `to ${a.dst}`}: dst ${frameDst(frame)} · src ${SWF_MAC[a.src]} → ${at.sw} ${at.port}` }]),
  });
}

/** Lab action, equivalent to clearing one switch's dynamic MAC table. Only that switch forgets; the other keeps its own table. */
function applyClear(s: SwfLabState, sw: SwfSwitch): SwfLabState {
  const removed = s.net.fdb[sw].map((e) => ({ mac: e.mac, port: e.port }));
  const net: SwfState = { ...s.net, fdb: { ...s.net.fdb, [sw]: [] } };
  const seq = s.seq + 1;
  return {
    ...s,
    net,
    seq,
    last: { type: "clear", sw, removed },
    log: pushLog(s.log, seq, [{ text: removed.length ? `${sw}: dynamic entries cleared (${removed.map((r) => name(r.mac)).join(", ")}). ${sw === "SW1" ? "SW2" : "SW1"} keeps its own table` : `${sw} had no dynamic entries to clear`, kind: "warning" }]),
  };
}

/** The fault: ge-0/0/24 is enabled on BOTH switches, so both SW1↔SW2 links forward — and nothing prevents a loop. */
function applyEnable(s: SwfLabState): SwfLabState {
  if (s.net.secondaryUp) return s;
  const seq = s.seq + 1;
  return {
    ...s,
    net: { ...s.net, secondaryUp: true },
    seq,
    last: { type: "enable-secondary" },
    log: pushLog(s.log, seq, [{ text: `${SECONDARY_PORT} enabled on SW1 and SW2 "for redundancy" — two SW1↔SW2 links now forward. No loop prevention (no STP) runs in this lab.`, kind: "warning" }]),
  };
}

/**
 * A repair attempt. Correct: the lesson's applySwfRepair (ge-0/0/24 down on both switches, entries learned on it
 * flushed, the copy on that cable lost) — the copies left on ge-0/0/23 then drain with one forwarding link.
 * "Clear the FDBs" really empties both tables (the guided lesson's point: the loop just relearns). The other choices
 * change nothing — and have no side effect that could accidentally stop a loop.
 */
function applyRepair(s: SwfLabState, choice: string): SwfLabState {
  const seq = s.seq + 1;
  const label = SWF_LAB_REPAIRS.find((r) => r.id === choice)?.label ?? choice;
  if (choice !== SWF_REPAIR_CORRECT) {
    const cleared = choice === "clear-fdb";
    const net = cleared ? { ...s.net, fdb: { SW1: [], SW2: [] } } : s.net;
    return {
      ...s,
      net,
      seq,
      last: { type: "repair", choice, correct: false, cleared },
      log: pushLog(s.log, seq, [{ text: `Tried: ${label} — ${cleared ? "both tables emptied, but" : "no effect:"} ${s.circulating.length} cop${s.circulating.length === 1 ? "y is" : "ies are"} still circulating over both links`, kind: "warning" }]),
    };
  }
  const inFlight = s.circulating.map((c) => ({ sw: c.sw, ingress: c.ingress, frame: c.frame }));
  const flushed = (["SW1", "SW2"] as SwfSwitch[]).flatMap((sw) => s.net.fdb[sw].filter((e) => e.port === SECONDARY_PORT).map((e) => ({ sw, mac: e.mac })));
  const repaired = applySwfRepair({ ...s.net, inFlight }, choice);
  const remaining = repaired.inFlight;
  const lost = inFlight.length - remaining.length;
  const net: SwfState = { ...repaired, inFlight: [], loop: undefined, packet: undefined, packetEdge: undefined, flood: [], copyNotes: {} };
  const base: SwfLabState = {
    ...s,
    net,
    seq,
    circulating: [],
    loopEvidence: undefined,
    last: { type: "repair", choice, correct: true, flushed, lost, drained: remaining.length },
    log: pushLog(s.log, seq, [
      { text: `Repair: ${label}. SW1 and SW2 flushed entries learned on ${SECONDARY_PORT}${flushed.length ? ` (${flushed.map((f) => `${f.sw}: ${name(f.mac)}`).join(", ")})` : ""}.`, kind: "warning" },
      { text: `${lost} circulating cop${lost === 1 ? "y was" : "ies were"} lost with the ${SECONDARY_PORT} link; ${remaining.length} still on ${remaining[0]?.ingress ?? "ge-0/0/23"} — draining now.` },
    ]),
  };
  if (!remaining.length) return base;
  const first = remaining[0];
  const tx: SwfTransmission = {
    id: seq,
    kind: "drain",
    src: macName(frameSrc(first.frame)) as SwfHost,
    dst: frameDst(first.frame) === BROADCAST_MAC ? "broadcast" : (macName(frameDst(first.frame)) as SwfHost),
    frame: first.frame,
    wave: 0,
    waves: 0,
    bridgeWaves: 0,
    segments: remaining.map((c, i) => ({ id: `${seq}d${i}`, from: (c.sw === "SW1" ? "SW2" : "SW1") as SwfSwitch, to: c.sw, egress: c.ingress, ingress: c.ingress, wave: 0 })),
    learned: [],
    decisions: [],
    received: [],
  };
  return withWaves({ ...base, tx });
}

function start(s: SwfLabState, a: SwfLabAction): SwfLabState {
  if (a.type === "send") return startSend(s, a);
  if (a.type === "enable-secondary") return applyEnable(s);
  if (a.type === "repair") return applyRepair(s, a.choice);
  return applyClear(s, a.sw);
}

/** What the switches' CLIs can see changes this (MAC → port entries, link state). Refreshes do not. */
export const swfLabCliRevision = (s: SwfLabState) => `${(["SW1", "SW2"] as SwfSwitch[]).map((sw) => s.net.fdb[sw].map((e) => `${e.mac}@${e.port}`).join(",")).join("|")}|${s.net.secondaryUp}`;

export const SWF_LAB_MODEL: LabModel<SwfLabState, SwfLabAction> = {
  initial: createSwfLabState,
  hops: (s, a) => {
    if (a.type === "send") return startSend(s, a).tx!.waves;
    if (a.type === "repair" && a.choice === SWF_REPAIR_CORRECT && s.circulating.length) return applyRepair(s, a.choice).tx?.waves ?? 0;
    return 0;
  },
  start,
  arrive: arriveOnce,
  revision: swfLabCliRevision,
};

/** Copies to draw at `wave` (0…tx.waves): those on a link, and those that ended at a device. Pure — Replay uses it with a replay wave and never touches lab state. */
export function swfVisibleSegments(tx: SwfTransmission, wave: number): { seg: SwfSegment; moving: boolean }[] {
  return tx.segments.filter((g) => g.wave === wave || (g.wave < wave && g.outcome && g.outcome !== "forwarded")).map((seg) => ({ seg, moving: seg.wave === wave }));
}

export const swfDelivered = (tx: SwfTransmission) => tx.dst !== "broadcast" && tx.received.some((r) => r.host === tx.dst && r.accepted);

/** Copies of this transmission each host received (1 = normal for a broadcast; more = duplicates). */
export const swfCopiesPerHost = (tx: SwfTransmission) => Object.fromEntries(SWF_HOSTS.map((h) => [h, tx.received.filter((r) => r.host === h).length])) as Record<SwfHost, number>;
