import type { PacketVisual } from "../types";
import type { LabModel } from "@/lib/practice-lab/types";
import { ETH_MAC, FDB_AGING_SEC, SW1_PORTS, DESK_PORTS, ageFdb, createEthState, ethFrame, frameDst, frameSrc, learn, lookup, macName, BROADCAST_MAC, type EthDevice, type EthHost, type EthState, type EthSwitch, type FdbEntry } from "./ethernetSwitching";

/**
 * Ethernet Lab — the Practice Lab model for Ethernet & Switching, on the lesson's own network (SW1, DESK-SW,
 * HOST-A/B/C). Pure: the generic lab runner decides WHEN `start`/`arrive` run (animated or instant); this file
 * decides WHAT happens. Learning, lookup and aging use the lesson's scenario module (learn / lookup / ageFdb), so the
 * guided lesson and the lab follow the same rules. On top of the lesson's network, the lab adds what an engineer can
 * touch and observe:
 *
 *   configuration    SW1 static MAC entries, the aging time, ports shut down (IOS shutdown / Junos disable)
 *   physical         HOST-B moving between SW1 and the hot desk, cables unplugged, a NIC with a cloned MAC
 *   evidence         per-port counters, a capture of every frame at every port it crossed, MAC moves (flaps)
 *   tickets          Layer-2 incidents built from those same mechanisms (never a special case in the bridge)
 *
 * Timing: a frame leaves its host at `start` (wave 0). Each `arrive` delivers every copy currently on a link: a switch
 * learns the SOURCE MAC against the ingress port, looks up the DESTINATION, and puts its copies on the egress links
 * (the next wave); a host's NIC accepts or discards. State changes only at those arrival boundaries. Lab time
 * (`net.clock`) moves only through the "time" action — sends are instantaneous.
 */

export type EthTicketId = "cable" | "stale" | "dupmac" | "static" | "flood";
export interface EthStatic {
  mac: string;
  port: string;
}
/** SW1's configuration (what IOS `show running-config` / Junos `show configuration` show). */
export interface EthLabCfg {
  aging: number;
  statics: EthStatic[];
  /** Ports administratively down (IOS shutdown / Junos disable). */
  shut: string[];
}
export const ETH_DEFAULT_CFG: EthLabCfg = { aging: FDB_AGING_SEC, statics: [], shut: [] };

export type EthLabAction =
  | { type: "send"; src: EthHost; dst: EthHost | "broadcast" }
  | { type: "time"; seconds: number }
  | { type: "move-b"; to: "desk" | "sw1" }
  | { type: "cable"; host: EthHost; plugged: boolean }
  /** Clear SW1's dynamic entries: all, one MAC, or those learned on one port (IOS clear mac address-table dynamic …, Junos clear ethernet-switching table …). */
  | { type: "clear"; mac?: string; port?: string }
  /** Apply SW1's configuration (IOS lines take effect on Enter; Junos on commit). */
  | { type: "config"; cfg: EthLabCfg; line: string }
  /** A host's NIC MAC: undefined = its burned-in address. */
  | { type: "nic-mac"; host: EthHost; mac?: string }
  | { type: "ticket"; id: EthTicketId }
  /** A brand-new network (empty tables, default configuration, no traffic yet); the log carries on. */
  | { type: "fresh" }
  /** Several actions applied instantly, as one event (setups). */
  | { type: "batch"; actions: EthLabAction[]; text: string };

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

export type EthLearnKind = "learned" | "refreshed" | "moved" | "static";
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
  /** The entry the lookup hit (known unicast). */
  hit?: { port: string; type: "dynamic" | "static" };
  /** Wave at which the frame arrived at this switch. */
  wave: number;
}

export interface EthTransmission {
  id: number;
  src: EthHost;
  dst: EthHost | "broadcast";
  frame: PacketVisual;
  clock: number;
  wave: number;
  waves: number;
  segments: EthSegment[];
  learned: EthLearn[];
  decisions: EthSwitchDecision[];
  received: { host: EthHost; accepted: boolean }[];
  /** First capture number of this frame (captures of this transmission have no >= capFrom). */
  capFrom: number;
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
  | { type: "cable"; host: EthHost; plugged: boolean; flushed: EthFdbChange[] }
  | { type: "clear"; removed: EthFdbChange[] }
  | { type: "config"; line: string; removed: EthFdbChange[] }
  | { type: "nic-mac"; host: EthHost; mac: string }
  | { type: "ticket"; id: EthTicketId }
  | { type: "fresh" }
  | { type: "batch"; text: string };

export interface EthLabLogEntry {
  id: number;
  tag: string;
  text: string;
  kind?: "learn" | "info" | "warning";
}
export interface EthCounters {
  inFrames: number;
  outFrames: number;
  inBcast: number;
  outBcast: number;
}
/** One frame seen at one port, in one direction — what a capture at that port would show. */
export interface EthCapture {
  no: number;
  tx: number;
  clock: number;
  dev: EthDevice;
  iface: string;
  dir: "in" | "out";
  src: string;
  dst: string;
  etherType: string;
  /** What the device did with it (arrivals): learned/flooded/forwarded/accepted/discarded… */
  note?: string;
}
/** A MAC that moved between ports (IOS logs repeated moves as MACFLAP). */
export interface EthMove {
  clock: number;
  seq: number;
  sw: EthSwitch;
  mac: string;
  from: string;
  to: string;
  flap: boolean;
}

export interface EthLabState {
  net: EthState;
  tx?: EthTransmission;
  /** Number of actions taken; the latest event's id. */
  seq: number;
  last?: EthLabEvent;
  log: EthLabLogEntry[];
  cfg: EthLabCfg;
  /** Hosts whose cable is unplugged. */
  unplugged: EthHost[];
  /** NIC MACs that differ from the burned-in address (a cloned MAC). */
  nicMac: Partial<Record<EthHost, string>>;
  /** Keyed `${device} ${iface}` (SW1 ge-0/0/1, DESK-SW port 1, HOST-A eth0). */
  counters: Record<string, EthCounters>;
  captures: EthCapture[];
  capNo: number;
  moves: EthMove[];
  ticket?: EthTicketId;
}

export const ETH_HOSTS: EthHost[] = ["HOST-A", "HOST-B", "HOST-C"];
const ALL_IFACES = [...SW1_PORTS.map((p) => `SW1 ${p}`), ...DESK_PORTS.map((p) => `DESK-SW ${p}`), ...ETH_HOSTS.map((h) => `${h} eth0`)];
const zero = (): EthCounters => ({ inFrames: 0, outFrames: 0, inBcast: 0, outBcast: 0 });
const freshCounters = () => Object.fromEntries(ALL_IFACES.map((k) => [k, zero()]));

export const createEthLabState = (): EthLabState => ({
  // HOST-B starts on SW1, so the hot-desk port has no link.
  net: { ...createEthState(), downPorts: ["DESK-SW port 2"] },
  seq: 0,
  log: [{ id: 0, tag: "t=0s", text: "Lab ready: SW1 and DESK-SW tables empty · HOST-B on SW1 ge-0/0/2 · all links up", kind: "info" }],
  cfg: ETH_DEFAULT_CFG,
  unplugged: [],
  nicMac: {},
  counters: freshCounters(),
  captures: [],
  capNo: 0,
  moves: [],
});

/** The MAC a host's NIC uses (and accepts frames for). */
export const nicMacOf = (s: EthLabState, h: EthHost) => s.nicMac[h] ?? ETH_MAC[h];

/** Where a host is plugged in right now (the port at the other end of its cable). */
export function hostAttachment(net: EthState, host: EthHost): { sw: EthSwitch; port: string } {
  if (host === "HOST-A") return { sw: "SW1", port: "ge-0/0/1" };
  if (host === "HOST-C") return { sw: "SW1", port: "ge-0/0/3" };
  return net.hostB === "SW1 ge-0/0/2" ? { sw: "SW1", port: "ge-0/0/2" } : { sw: "DESK-SW", port: "port 2" };
}
/** The host's link: where its cable goes, and whether there is link (cable in, switch port not shut). */
export function hostLink(s: EthLabState, host: EthHost) {
  const at = hostAttachment(s.net, host);
  const shut = at.sw === "SW1" && s.cfg.shut.includes(at.port);
  return { ...at, plugged: !s.unplugged.includes(host), shut, up: !s.unplugged.includes(host) && !shut };
}

/** Which device is at the far end of a switch port, if the link is up. */
export function portNeighbor(s: EthLabState, sw: EthSwitch, port: string): EthDevice | undefined {
  if (s.net.downPorts.includes(`${sw} ${port}`)) return undefined;
  if (sw === "SW1") {
    if (port === "ge-0/0/1") return "HOST-A";
    if (port === "ge-0/0/2") return s.net.hostB === "SW1 ge-0/0/2" ? "HOST-B" : undefined;
    if (port === "ge-0/0/3") return "HOST-C";
    if (port === "ge-0/0/4") return "DESK-SW";
    return undefined;
  }
  if (port === "port 1") return "SW1";
  if (port === "port 2") return s.net.hostB === "DESK-SW port 2" ? "HOST-B" : undefined;
  return undefined;
}
/** What is physically connected to a switch port (whether or not the link is up). */
export function portCable(s: EthLabState, sw: EthSwitch, port: string): EthDevice | undefined {
  if (sw === "SW1") return port === "ge-0/0/1" ? "HOST-A" : port === "ge-0/0/2" ? (s.net.hostB === "SW1 ge-0/0/2" && !s.unplugged.includes("HOST-B") ? "HOST-B" : undefined) : port === "ge-0/0/3" ? "HOST-C" : port === "ge-0/0/4" ? "DESK-SW" : undefined;
  return port === "port 1" ? "SW1" : port === "port 2" && s.net.hostB === "DESK-SW port 2" && !s.unplugged.includes("HOST-B") ? "HOST-B" : undefined;
}
const portsOf = (sw: EthSwitch): readonly string[] => (sw === "SW1" ? SW1_PORTS : DESK_PORTS);
const upPorts = (s: EthLabState, sw: EthSwitch) => portsOf(sw).filter((p) => portNeighbor(s, sw, p) !== undefined);
/** The port a copy arrives on at the far end of `sw`'s `port`. */
const peerIngress = (sw: EthSwitch, port: string) => (sw === "SW1" && port === "ge-0/0/4" ? "port 1" : sw === "DESK-SW" && port === "port 1" ? "ge-0/0/4" : "eth0");
const isSwitch = (d: EthDevice): d is EthSwitch => d === "SW1" || d === "DESK-SW";
const name = (mac: string) => (mac === BROADCAST_MAC ? "broadcast" : macName(mac));
const tag = (net: EthState) => `t=${net.clock}s`;

/** Recompute which switch ports have no link (moved host, unplugged cables, shut ports), flushing what was learned on ports that just went down. */
function relink(s: EthLabState): { s: EthLabState; flushed: EthFdbChange[] } {
  const down = new Set<string>();
  // HOST-B's cable is in exactly one of SW1 ge-0/0/2 and DESK-SW port 2: the other one has no link.
  if (s.net.hostB !== "SW1 ge-0/0/2") down.add("SW1 ge-0/0/2");
  if (s.net.hostB !== "DESK-SW port 2") down.add("DESK-SW port 2");
  for (const h of s.unplugged) {
    const at = hostAttachment(s.net, h);
    down.add(`${at.sw} ${at.port}`);
  }
  for (const p of s.cfg.shut) down.add(`SW1 ${p}`);
  // DESK-SW's uplink goes down with SW1 ge-0/0/4 (same cable).
  if (down.has("SW1 ge-0/0/4")) down.add("DESK-SW port 1");
  const before = new Set(s.net.downPorts);
  const newlyDown = [...down].filter((p) => !before.has(p));
  const flushed: EthFdbChange[] = [];
  const fdb = { ...s.net.fdb };
  for (const sw of ["SW1", "DESK-SW"] as EthSwitch[])
    fdb[sw] = fdb[sw].filter((e) => {
      const gone = newlyDown.includes(`${sw} ${e.port}`);
      if (gone) flushed.push({ sw, mac: e.mac, port: e.port });
      return !gone;
    });
  return { s: { ...s, net: { ...s.net, downPorts: [...down].sort(), fdb } }, flushed };
}

/** SW1's table as the CLI shows it: static entries (never age, never relearn) plus learned ones. */
export function swTable(s: EthLabState, sw: EthSwitch): { mac: string; port: string; type: "dynamic" | "static"; age?: number }[] {
  const statics = sw === "SW1" ? s.cfg.statics.map((x) => ({ mac: x.mac, port: x.port, type: "static" as const })) : [];
  const dyn = s.net.fdb[sw].filter((e) => !statics.some((x) => x.mac === e.mac)).map((e) => ({ mac: e.mac, port: e.port, type: "dynamic" as const, age: s.net.clock - e.lastSeen }));
  return [...statics, ...dyn].sort((a, b) => a.port.localeCompare(b.port) || a.mac.localeCompare(b.mac));
}

/** One frame through one learning bridge (statics first; a static MAC is never relearned). Never modifies the frame. */
function labBridge(s: EthLabState, sw: EthSwitch, ingress: string, frame: PacketVisual) {
  const src = frameSrc(frame);
  const dst = frameDst(frame);
  const statics = sw === "SW1" ? s.cfg.statics : [];
  const staticSrc = statics.some((x) => x.mac === src);
  const prior = lookup(s.net.fdb[sw], src);
  const fdb: FdbEntry[] = staticSrc ? s.net.fdb[sw] : learn(s.net.fdb[sw], src, ingress, s.net.clock);
  const learnKind: EthLearnKind = staticSrc ? "static" : !prior ? "learned" : prior.port !== ingress ? "moved" : "refreshed";
  const others = upPorts(s, sw).filter((p) => p !== ingress);
  if (dst === BROADCAST_MAC) return { fdb, learnKind, prior, kind: "broadcast" as const, egress: others, lookupResult: "broadcast address — flood" };
  const st = statics.find((x) => x.mac === dst);
  const dyn = lookup(fdb, dst);
  const hit = st ? { port: st.port, type: "static" as const } : dyn ? { port: dyn.port, type: "dynamic" as const } : undefined;
  if (!hit) return { fdb, learnKind, prior, kind: "unknown-unicast" as const, egress: others, lookupResult: `${dst} not in the table — unknown unicast` };
  const egress = hit.port === ingress || portNeighbor(s, sw, hit.port) === undefined ? [] : [hit.port];
  return { fdb, learnKind, prior, kind: "known-unicast" as const, egress, hit, lookupResult: `${dst} → ${hit.port}${hit.type === "static" ? " (static)" : ""}` };
}

export const isInFlight = (s: EthLabState) => !!s.tx && s.tx.segments.some((g) => g.wave === s.tx!.wave && !g.outcome);

function pushLog(log: EthLabLogEntry[], net: EthState, entries: { text: string; kind?: EthLabLogEntry["kind"] }[]): EthLabLogEntry[] {
  let id = log.length ? log[log.length - 1].id : 0;
  return [...log, ...entries.map((e) => ({ id: ++id, tag: tag(net), text: e.text, kind: e.kind }))].slice(-200);
}
/** Record one frame at one port: a capture line and that port's counters. */
function observe(s: EthLabState, tx: EthTransmission, dev: EthDevice, iface: string, dir: "in" | "out", note?: string): EthLabState {
  const src = frameSrc(tx.frame);
  const dst = frameDst(tx.frame);
  const key = `${dev} ${iface}`;
  const c = { ...(s.counters[key] ?? zero()) };
  const bc = dst === BROADCAST_MAC ? 1 : 0;
  if (dir === "in") {
    c.inFrames++;
    c.inBcast += bc;
  } else {
    c.outFrames++;
    c.outBcast += bc;
  }
  const no = s.capNo + 1;
  const etherType = tx.frame.layers[0].fields.find((f) => f.label === "EtherType")?.value ?? "";
  return { ...s, capNo: no, counters: { ...s.counters, [key]: c }, captures: [...s.captures, { no, tx: tx.id, clock: s.net.clock, dev, iface, dir, src, dst, etherType, note }].slice(-400) };
}

/** Deliver every copy currently on a link (one wave). */
function arriveOnce(s0: EthLabState): EthLabState {
  const tx = s0.tx;
  if (!tx || !isInFlight(s0)) return s0;
  let s = s0;
  const segments = [...tx.segments];
  const learned = [...tx.learned];
  const decisions = [...tx.decisions];
  const received = [...tx.received];
  const moves = [...s.moves];
  const logs: { text: string; kind?: EthLabLogEntry["kind"] }[] = [];
  const src = frameSrc(tx.frame);
  const dst = frameDst(tx.frame);

  segments.forEach((seg, i) => {
    if (seg.wave !== tx.wave || seg.outcome) return;
    if (!isSwitch(seg.to)) {
      const host = seg.to as EthHost;
      const mine = nicMacOf(s, host);
      const accepted = dst === mine || dst === BROADCAST_MAC;
      segments[i] = { ...seg, outcome: accepted ? "accepted" : "discarded" };
      received.push({ host, accepted });
      s = observe(s, tx, host, "eth0", "in", accepted ? (dst === BROADCAST_MAC ? "accepted (broadcast)" : "accepted (its own MAC)") : `discarded (for ${name(dst)})`);
      logs.push({ text: accepted ? `${host} accepted: destination ${dst} ${dst === BROADCAST_MAC ? "is the broadcast address" : "is its own MAC"}` : `${host} discarded: destination ${dst} is ${name(dst)}, not ${host}`, kind: accepted ? "info" : "warning" });
      return;
    }
    const sw = seg.to;
    const r = labBridge(s, sw, seg.ingress, tx.frame);
    s = { ...s, net: { ...s.net, fdb: { ...s.net.fdb, [sw]: r.fdb } } };
    learned.push({ sw, mac: src, port: seg.ingress, kind: r.learnKind, from: r.learnKind === "moved" ? r.prior!.port : undefined });
    if (r.learnKind === "moved") {
      // A MAC that keeps moving between ports is "flapping": two hosts with one MAC, or a loop.
      const recent = moves.some((m) => m.sw === sw && m.mac === src && s.net.clock - m.clock <= 60 && (m.from === seg.ingress || m.to === r.prior!.port));
      moves.push({ clock: s.net.clock, seq: s.seq, sw, mac: src, from: r.prior!.port, to: seg.ingress, flap: recent });
    }
    decisions.push({ sw, ingress: seg.ingress, kind: r.kind, egress: r.egress, lookupResult: r.lookupResult, hit: r.kind === "known-unicast" ? r.hit : undefined, wave: tx.wave });
    const out = r.egress.map((port) => ({ port, to: portNeighbor(s, sw, port) })).filter((c): c is { port: string; to: EthDevice } => c.to !== undefined);
    const what = r.kind === "broadcast" ? "broadcast → flood" : r.kind === "unknown-unicast" ? "unknown → flood" : out.length ? `known → ${out[0].port}` : "known → no egress";
    s = observe(s, tx, sw, seg.ingress, "in", `${r.learnKind === "static" ? "source is static (not learned)" : `${r.learnKind} ${name(src)}`} · ${what}`);
    logs.push({ text: `${sw} ${r.learnKind === "learned" ? "learned" : r.learnKind === "moved" ? `moved ${r.prior!.port} →` : r.learnKind === "static" ? "kept its static entry for" : "refreshed"} ${name(src)} (source ${src}) on ${seg.ingress}`, kind: r.learnKind === "refreshed" ? "info" : "learn" });
    const lookupText = r.kind === "broadcast" ? "broadcast → flood" : r.kind === "unknown-unicast" ? `lookup ${dst}: miss → flood` : `lookup ${dst}: hit ${r.hit!.port}${r.hit!.type === "static" ? " (static)" : ""} → forward`;
    logs.push({ text: `${sw} ${lookupText}${out.length ? ` out ${out.map((o) => o.port).join(", ")}` : r.kind === "known-unicast" ? (r.hit!.port === seg.ingress ? " — destination is on the ingress port: filter" : ` — ${r.hit!.port} has no link: dropped`) : " — no other port is up: nothing to send"}`, kind: out.length ? "info" : "warning" });
    segments[i] = { ...seg, outcome: out.length ? "forwarded" : r.kind === "known-unicast" ? "filtered" : "dead-end" };
    for (const o of out) {
      s = observe(s, tx, sw, o.port, "out");
      segments.push({ id: `${seg.id}.${o.to}`, from: sw, to: o.to, egress: o.port, ingress: peerIngress(sw, o.port), wave: tx.wave + 1 });
    }
  });

  const next: EthTransmission = { ...tx, wave: tx.wave + 1, segments, learned, decisions, received };
  const done = !next.segments.some((g) => g.wave === next.wave);
  if (done && dst !== BROADCAST_MAC && !received.some((r) => r.accepted && nicMacOf(s, r.host) === dst)) logs.push({ text: `Frame lost: no NIC with ${dst} received it`, kind: "warning" });
  if (done && dst !== BROADCAST_MAC && received.filter((r) => r.accepted).length > 1) logs.push({ text: `${received.filter((r) => r.accepted).length} hosts accepted a frame for ${dst}: two NICs use the same MAC`, kind: "warning" });
  return { ...s, moves: moves.slice(-60), tx: next, log: pushLog(s.log, s.net, logs) };
}

function startSend(s: EthLabState, a: Extract<EthLabAction, { type: "send" }>): EthLabState {
  const at = hostLink(s, a.src);
  const srcMac = nicMacOf(s, a.src);
  const dstMac = a.dst === "broadcast" ? BROADCAST_MAC : ETH_MAC[a.dst];
  const id = s.seq + 1;
  const etherType = a.dst === "broadcast" ? "0x0806" : "0x0800";
  const frame = ethFrame(`lab-${id}`, a.src, at.sw, srcMac, dstMac, etherType);
  const tx: EthTransmission = { id, src: a.src, dst: a.dst, frame, clock: s.net.clock, wave: 0, waves: 0, segments: [], learned: [], decisions: [], received: [], capFrom: s.capNo + 1 };
  let started: EthLabState = { ...s, seq: id, tx, last: { type: "send", txId: id } };
  if (!at.up) {
    // No link: the NIC has nowhere to put the frame.
    return { ...started, log: pushLog(s.log, s.net, [{ text: `${a.src} can't send: ${at.plugged ? `${at.sw} ${at.port} is shut down` : "its cable is unplugged"} (no link)`, kind: "warning" }]) };
  }
  started = observe(started, tx, a.src, "eth0", "out");
  started = {
    ...started,
    tx: { ...tx, segments: [{ id: `${id}`, from: a.src, to: at.sw, egress: "eth0", ingress: at.port, wave: 0 }] },
    log: pushLog(s.log, s.net, [{ text: `${a.src} sends ${a.dst === "broadcast" ? "a broadcast" : `to ${a.dst}`}: dst ${dstMac} · src ${srcMac} · EtherType ${etherType} → ${at.sw} ${at.port}` }]),
  };
  // Dry run (pure) to know how many arrivals this frame takes — used for animation and Replay, never applied here.
  let probe = started;
  let waves = 0;
  while (isInFlight(probe) && waves < 16) {
    probe = arriveOnce(probe);
    waves++;
  }
  return { ...started, tx: { ...started.tx!, waves } };
}

function applyTime(s: EthLabState, seconds: number): EthLabState {
  const from = s.net.clock;
  const to = from + seconds;
  const expired: EthFdbChange[] = [];
  const fdb = { ...s.net.fdb };
  (["SW1", "DESK-SW"] as EthSwitch[]).forEach((sw) => {
    const r = ageFdb(fdb[sw], to, sw === "SW1" ? s.cfg.aging : FDB_AGING_SEC);
    fdb[sw] = r.kept;
    r.expired.forEach((x) => expired.push({ sw, mac: x.entry.mac, port: x.entry.port, age: x.age }));
  });
  const net: EthState = { ...s.net, clock: to, fdb };
  const logs = [{ text: `${seconds} s pass (lab clock ${from} → ${to} s)` }, ...expired.map((x) => ({ text: `${x.sw}: ${name(x.mac)} on ${x.port} expired — last seen as a source ${x.age} s ago (> ${x.sw === "SW1" ? s.cfg.aging : FDB_AGING_SEC} s aging time)`, kind: "warning" as const }))];
  if (!expired.length) logs.push({ text: "No entry is older than the aging time — nothing expired" });
  return { ...s, net, seq: s.seq + 1, last: { type: "time", seconds, from, to, expired }, log: pushLog(s.log, net, logs) };
}

function applyMove(s: EthLabState, to: "desk" | "sw1"): EthLabState {
  if ((to === "desk") === (s.net.hostB === "DESK-SW port 2")) return s;
  const moved: EthLabState = { ...s, net: { ...s.net, hostB: to === "desk" ? "DESK-SW port 2" : "SW1 ge-0/0/2" } };
  const r = relink(moved);
  const kept = lookup(r.s.net.fdb.SW1, ETH_MAC["HOST-B"]);
  const lines =
    to === "desk"
      ? [
          { text: "HOST-B unplugged from SW1 ge-0/0/2 — link DOWN", kind: "warning" as const },
          { text: r.flushed.length ? `${r.flushed.map((f) => `${f.sw} flushed ${name(f.mac)} (learned on ${f.port})`).join("; ")}` : "Nothing had been learned on the ports that went down" },
          { text: "HOST-B plugged into DESK-SW port 2 — no switch learns anything until HOST-B sends" },
        ]
      : [
          { text: "HOST-B unplugged from DESK-SW port 2 — DESK-SW port 2 DOWN", kind: "warning" as const },
          { text: r.flushed.length ? `${r.flushed.map((f) => `${f.sw} flushed ${name(f.mac)} (learned on ${f.port})`).join("; ")}` : "Nothing had been learned on the ports that went down" },
          { text: "HOST-B plugged into SW1 ge-0/0/2 — link UP. A link coming up teaches SW1 no MAC addresses" },
          // Neutral fact only — the incident asks the learner to discover what this means.
          { text: "SW1 ge-0/0/4 stayed up: nothing learned behind it was flushed" },
        ];
  return { ...r.s, seq: s.seq + 1, last: { type: "move-b", to, flushed: r.flushed, staleKept: to === "sw1" && kept && kept.port !== "ge-0/0/2" ? { sw: "SW1", mac: kept.mac, port: kept.port } : undefined }, log: pushLog(s.log, r.s.net, lines) };
}

function applyCable(s: EthLabState, host: EthHost, plugged: boolean): EthLabState {
  if (plugged === !s.unplugged.includes(host)) return s;
  const r = relink({ ...s, unplugged: plugged ? s.unplugged.filter((h) => h !== host) : [...s.unplugged, host] });
  const at = hostAttachment(s.net, host);
  return {
    ...r.s,
    seq: s.seq + 1,
    last: { type: "cable", host, plugged, flushed: r.flushed },
    log: pushLog(s.log, r.s.net, [
      { text: plugged ? `${host}'s cable plugged into ${at.sw} ${at.port} — link UP (nothing is learned until ${host} sends)` : `${host}'s cable unplugged from ${at.sw} ${at.port} — link DOWN`, kind: plugged ? "info" : "warning" },
      ...(r.flushed.length ? [{ text: r.flushed.map((f) => `${f.sw} flushed ${name(f.mac)} (learned on ${f.port})`).join("; ") }] : []),
    ]),
  };
}

function applyClear(s: EthLabState, a: Extract<EthLabAction, { type: "clear" }>): EthLabState {
  const removed: EthFdbChange[] = [];
  const kept = s.net.fdb.SW1.filter((e) => {
    const hit = (a.mac ? e.mac === a.mac : true) && (a.port ? e.port === a.port : true);
    if (hit) removed.push({ sw: "SW1", mac: e.mac, port: e.port });
    return !hit;
  });
  const what = a.mac ? `the entry for ${name(a.mac)}` : a.port ? `the entries learned on ${a.port}` : "all dynamic entries";
  const net = { ...s.net, fdb: { ...s.net.fdb, SW1: kept } };
  return { ...s, net, seq: s.seq + 1, last: { type: "clear", removed }, log: pushLog(s.log, net, [{ text: removed.length ? `SW1 cleared ${what}: ${removed.map((r) => `${name(r.mac)} → ${r.port}`).join(", ")}` : `SW1: no dynamic entry matched (${what})`, kind: removed.length ? "warning" : "info" }]) };
}

function applyConfig(s: EthLabState, cfg: EthLabCfg, line: string): EthLabState {
  // A static entry replaces any learned entry for that MAC; a shorter aging time expires old entries at once.
  const removed: EthFdbChange[] = [];
  let fdb = s.net.fdb.SW1.filter((e) => {
    const st = cfg.statics.some((x) => x.mac === e.mac);
    if (st) removed.push({ sw: "SW1", mac: e.mac, port: e.port });
    return !st;
  });
  if (cfg.aging !== s.cfg.aging) {
    const r = ageFdb(fdb, s.net.clock, cfg.aging);
    fdb = r.kept;
    r.expired.forEach((x) => removed.push({ sw: "SW1", mac: x.entry.mac, port: x.entry.port, age: x.age }));
  }
  const r = relink({ ...s, cfg, net: { ...s.net, fdb: { ...s.net.fdb, SW1: fdb } } });
  const all = [...removed, ...r.flushed];
  return { ...r.s, seq: s.seq + 1, last: { type: "config", line, removed: all }, log: pushLog(s.log, r.s.net, [{ text: `SW1 configuration: ${line}` }, ...(all.length ? [{ text: `SW1 table: removed ${all.map((x) => `${name(x.mac)} → ${x.port}`).join(", ")}`, kind: "warning" as const }] : [])]) };
}

function applyNicMac(s: EthLabState, host: EthHost, mac?: string): EthLabState {
  const nicMac = { ...s.nicMac };
  if (!mac || mac === ETH_MAC[host]) delete nicMac[host];
  else nicMac[host] = mac;
  const now = nicMac[host] ?? ETH_MAC[host];
  return { ...s, nicMac, seq: s.seq + 1, last: { type: "nic-mac", host, mac: now }, log: pushLog(s.log, s.net, [{ text: `${host}'s NIC now uses ${now}${now === ETH_MAC[host] ? " (its burned-in address)" : ` — the burned-in address is ${ETH_MAC[host]}`}`, kind: "info" }]) };
}

/** Apply an action and every arrival at once (for setups and the instant runner). */
export function runInstant(s: EthLabState, a: EthLabAction): EthLabState {
  let next = start(s, a);
  for (let k = 0; isInFlight(next) && k < 16; k++) next = arriveOnce(next);
  return next;
}

/** The network as each ticket's user finds it. Built only from ordinary actions: every symptom comes from the same bridge. */
const BASELINE: EthLabAction[] = [
  { type: "send", src: "HOST-A", dst: "HOST-B" },
  { type: "send", src: "HOST-B", dst: "HOST-A" },
  { type: "send", src: "HOST-C", dst: "broadcast" },
];
export const ETH_TICKETS: Record<EthTicketId, { title: string; report: string; setup: EthLabAction[] }> = {
  cable: { title: "HOST-B is unreachable", report: "“Nothing I send to HOST-B arrives. HOST-A and HOST-C talk fine.”", setup: [...BASELINE, { type: "cable", host: "HOST-B", plugged: false }] },
  stale: { title: "HOST-B is back, but unreachable", report: "“HOST-B's user worked at the hot desk this morning and is back at their own desk. Since then HOST-A can't reach HOST-B. Every link light is on.”", setup: [...BASELINE, { type: "move-b", to: "desk" }, { type: "send", src: "HOST-B", dst: "HOST-A" }, { type: "move-b", to: "sw1" }] },
  dupmac: {
    title: "HOST-B keeps losing traffic",
    report: "“HOST-B works, then stops, then works again. Someone set up HOST-C yesterday.”",
    setup: [...BASELINE, { type: "nic-mac", host: "HOST-C", mac: ETH_MAC["HOST-B"] }, { type: "send", src: "HOST-B", dst: "HOST-A" }, { type: "send", src: "HOST-C", dst: "HOST-A" }],
  },
  static: { title: "HOST-B never receives anything", report: "“HOST-B was moved back to its desk weeks ago. Since then nothing reaches it, even after rebooting it and sending traffic from it.”", setup: [...BASELINE, { type: "config", cfg: { ...ETH_DEFAULT_CFG, statics: [{ mac: ETH_MAC["HOST-B"], port: "ge-0/0/4" }] }, line: "mac address-table static 0011.2233.440b vlan 1 interface GigabitEthernet1/0/4" }] },
  flood: {
    title: "HOST-C sees HOST-B's traffic",
    report: "“HOST-C's capture shows frames addressed to HOST-B. Is someone sending them to the wrong place?”",
    setup: [...BASELINE, { type: "time", seconds: 200 }, { type: "send", src: "HOST-A", dst: "HOST-C" }, { type: "send", src: "HOST-C", dst: "HOST-A" }, { type: "time", seconds: 150 }],
  },
};

function applyTicket(s0: EthLabState, id: EthTicketId): EthLabState {
  let s = createEthLabState();
  for (const a of ETH_TICKETS[id].setup) s = runInstant(s, a);
  // The ticket starts from what the user has now; earlier traffic belongs to before the report.
  const net = s.net;
  return { ...s, tx: undefined, seq: s0.seq + 1, ticket: id, counters: freshCounters(), captures: [], capNo: s.capNo, moves: s.moves.map((m) => ({ ...m, seq: -1 })), last: { type: "ticket", id }, log: pushLog(s0.log, net, [{ text: `Ticket loaded: ${ETH_TICKETS[id].title} — ${ETH_TICKETS[id].report}`, kind: "warning" }]) };
}

function start(s: EthLabState, a: EthLabAction): EthLabState {
  switch (a.type) {
    case "send":
      return startSend(s, a);
    case "time":
      return applyTime(s, a.seconds);
    case "move-b":
      return applyMove(s, a.to);
    case "cable":
      return applyCable(s, a.host, a.plugged);
    case "clear":
      return applyClear(s, a);
    case "config":
      return applyConfig(s, a.cfg, a.line);
    case "nic-mac":
      return applyNicMac(s, a.host, a.mac);
    case "ticket":
      return applyTicket(s, a.id);
    case "fresh": {
      const n = createEthLabState();
      return { ...n, seq: s.seq + 1, capNo: s.capNo, last: { type: "fresh" }, log: pushLog(s.log, n.net, [{ text: "A fresh network: both tables empty, default configuration, HOST-B on SW1 ge-0/0/2" }]) };
    }
    case "batch": {
      let n = s;
      for (const x of a.actions) n = runInstant(n, x);
      return { ...n, seq: s.seq + 1, last: { type: "batch", text: a.text }, log: pushLog(n.log, n.net, [{ text: a.text }]) };
    }
  }
}

/** What the SW1 CLI can see changes this (MAC → port entries, link state, configuration, counters). */
export const ethLabCliRevision = (s: EthLabState) => `${s.seq}|${s.tx?.wave ?? 0}`;

export const ETH_LAB_MODEL: LabModel<EthLabState, EthLabAction> = {
  initial: createEthLabState,
  hops: (s, a) => (a.type === "send" ? startSend(s, a).tx!.waves : 0),
  start,
  arrive: arriveOnce,
  revision: ethLabCliRevision,
};

/** Copies to draw at `wave` (0…tx.waves): those on a link, and those that ended at a device (resting there). Pure — Replay uses it with a replay wave and never touches lab state. */
export function ethVisibleSegments(tx: EthTransmission, wave: number): { seg: EthSegment; moving: boolean }[] {
  return tx.segments.filter((g) => g.wave === wave || (g.wave < wave && g.outcome && g.outcome !== "forwarded")).map((seg) => ({ seg, moving: seg.wave === wave }));
}

/** Did a unicast frame reach its destination host? */
export const ethDelivered = (tx: EthTransmission) => tx.dst !== "broadcast" && tx.received.some((r) => r.host === tx.dst && r.accepted);

/** Captures at one device port, newest last. */
export const capturesAt = (s: EthLabState, dev: EthDevice, iface: string) => s.captures.filter((c) => c.dev === dev && c.iface === iface);
