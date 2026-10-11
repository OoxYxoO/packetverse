/**
 * LACP Lab network — two switches joined by three parallel cables, two hosts on each (the LACP lesson's network, one
 * cable and one host per switch more):
 *
 *   HOST-A — SW1 ge-0/0/1        SW1 ge-0/0/22 ═ SW2 ge-0/0/22        SW2 ge-0/0/1 — HOST-B
 *   HOST-D — SW1 ge-0/0/2        SW1 ge-0/0/23 ═ SW2 ge-0/0/23        SW2 ge-0/0/2 — HOST-C
 *                                SW1 ge-0/0/24 ═ SW2 ge-0/0/24
 *
 * Per member each switch is configured with a channel group (1 or 2: Cisco Port-channel1/2 · Junos ae0/ae1) and a
 * mode: LACP active, LACP passive, static "on" (no LACP), or not in a group at all. The bundle is COMPUTED, as the
 * converged result of IEEE 802.1AX:
 *   - LACP needs at least one active end; passive ↔ passive never exchanges an LACPDU.
 *   - An LACP member that hears no LACPDUs is suspended (it carries nothing); a static member bundles regardless.
 *   - Members of one group must all lead to the same partner group (same partner key): a member whose partner is in
 *     another group is suspended on this side.
 *   - Static "on" facing a port that does not bundle at all is caught by the EtherChannel misconfiguration guard:
 *     the static Port-channel is err-disabled.
 * Flows are spread over the members that are distributing at BOTH ends with a clearly labeled modeled hash:
 * (last octet of source IPv4 + last octet of destination IPv4) mod (number of members) — one flow, one member; real
 * platforms hash their own fields. A member can fail SILENTLY (light lost in one direction through a media converter:
 * the link stays up, frames are lost): each switch notices only when LACPDUs stop — after 3 s with the fast rate, 90 s
 * with the slow (default) one.
 * Spanning tree (RSTP, SW1 root) runs over the LOGICAL links: a Port-channel is one link (cost 20000 / number of
 * members); members outside any bundle are separate links, and all but the best are blocked.
 */

export type LcSw = "SW1" | "SW2";
export type LcHost = "HOST-A" | "HOST-D" | "HOST-B" | "HOST-C";
export type LcDev = LcSw | LcHost;
export const LC_SWITCHES: LcSw[] = ["SW1", "SW2"];
export const LC_HOSTS: LcHost[] = ["HOST-A", "HOST-D", "HOST-B", "HOST-C"];
export const LC_MEMBERS = ["ge-0/0/22", "ge-0/0/23", "ge-0/0/24"] as const;
export type LcMember = (typeof LC_MEMBERS)[number];
export const LC_HOST_PORTS = ["ge-0/0/1", "ge-0/0/2"] as const;
export type LcPort = LcMember | (typeof LC_HOST_PORTS)[number];
export const LC_PORTS: LcPort[] = ["ge-0/0/1", "ge-0/0/2", "ge-0/0/22", "ge-0/0/23", "ge-0/0/24"];
export const BCAST = "FF:FF:FF:FF:FF:FF";
export const LACP_MAC = "01:80:C2:00:00:02";
export const LC_AGING = 300;
export const SLOW_TIMEOUT = 90;
export const FAST_TIMEOUT = 3;
export const MEMBER_COST = 20000;
export const isSw = (d: string): d is LcSw => d === "SW1" || d === "SW2";
export const isHost = (d: string): d is LcHost => d.startsWith("HOST-");
export const otherSw = (s: LcSw): LcSw => (s === "SW1" ? "SW2" : "SW1");
export const SYS_MAC: Record<LcSw, string> = { SW1: "00:00:5E:00:53:11", SW2: "00:00:5E:00:53:22" };
export const HOST_MAC: Record<LcHost, string> = { "HOST-A": "00:11:22:33:88:0A", "HOST-D": "00:11:22:33:88:0D", "HOST-B": "00:11:22:33:88:0B", "HOST-C": "00:11:22:33:88:0C" };
export const HOST_IP: Record<LcHost, string> = { "HOST-A": "192.168.80.10", "HOST-D": "192.168.80.11", "HOST-B": "192.168.80.20", "HOST-C": "192.168.80.21" };
export const HOST_AT: Record<LcHost, { sw: LcSw; port: LcPort }> = { "HOST-A": { sw: "SW1", port: "ge-0/0/1" }, "HOST-D": { sw: "SW1", port: "ge-0/0/2" }, "HOST-B": { sw: "SW2", port: "ge-0/0/1" }, "HOST-C": { sw: "SW2", port: "ge-0/0/2" } };
export const portNum = (p: string) => +p.split("/").pop()!;
export const pk = (dev: string, port: string) => `${dev} ${port}`;

// ---------------------------------------------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------------------------------------------
export type LcMode = "active" | "passive" | "on" | "off";
export interface LcMemberCfg {
  group: 1 | 2;
  mode: LcMode;
  /** This side asks its partner for LACPDUs every second (Cisco lacp rate fast · Junos lacp periodic fast). */
  fast: boolean;
  shut: boolean;
}
export interface LcSwCfg {
  members: Record<LcMember, LcMemberCfg>;
}
export interface LcCfg {
  sw: Record<LcSw, LcSwCfg>;
  /** Cables between the switches. */
  cables: Record<LcMember, boolean>;
}
const mem = (o: Partial<LcMemberCfg> = {}): LcMemberCfg => ({ group: 1, mode: "active", fast: false, shut: false, ...o });
export function lcHealthy(): LcCfg {
  return {
    sw: {
      SW1: { members: { "ge-0/0/22": mem({ mode: "off" }), "ge-0/0/23": mem(), "ge-0/0/24": mem() } },
      SW2: { members: { "ge-0/0/22": mem({ mode: "off" }), "ge-0/0/23": mem(), "ge-0/0/24": mem() } },
    },
    cables: { "ge-0/0/22": false, "ge-0/0/23": true, "ge-0/0/24": true },
  };
}
export const lcClone = <T>(c: T): T => JSON.parse(JSON.stringify(c)) as T;
export const poName = (vendor: "cisco" | "juniper", g: number) => (vendor === "cisco" ? `Po${g}` : `ae${g - 1}`);

// ---------------------------------------------------------------------------------------------------------------
// The bundle, computed
// ---------------------------------------------------------------------------------------------------------------
export type LcMemberState = "bundled" | "suspended" | "individual" | "down" | "errdis" | "hot";
export interface LcMemberInfo {
  state: LcMemberState;
  /** Why it is in that state (for the CLI flags and the explanations). */
  why: string;
  /** LACPDUs are exchanged on this member. */
  lacp: boolean;
  /** Partner group (key) seen on this member, if LACP talks. */
  partnerGroup?: number;
}
export interface LcLogical {
  id: string;
  /** "po": a Port-channel on both ends; "single": one cable used as a normal link. */
  kind: "po" | "single";
  ends: Record<LcSw, string>;
  members: LcMember[];
  cost: number;
  stp: "fwd" | "blk";
}
export interface LcBundle {
  members: Record<string, LcMemberInfo>;
  /** Port-channels that are err-disabled by the misconfiguration guard. */
  poErr: string[];
  logical: LcLogical[];
}
export const linkUp = (cfg: LcCfg, m: LcMember) => cfg.cables[m] && !cfg.sw.SW1.members[m].shut && !cfg.sw.SW2.members[m].shut;
const isLacp = (mo: LcMode) => mo === "active" || mo === "passive";
export function lcBundle(cfg: LcCfg, silentDetected: Record<string, boolean> = {}): LcBundle {
  const members: Record<string, LcMemberInfo> = {};
  const poErr: string[] = [];
  for (const m of LC_MEMBERS) {
    const a = cfg.sw.SW1.members[m];
    const b = cfg.sw.SW2.members[m];
    const set = (sw: LcSw, info: LcMemberInfo) => (members[pk(sw, m)] = info);
    if (!linkUp(cfg, m)) {
      for (const sw of LC_SWITCHES) set(sw, { state: "down", why: !cfg.cables[m] ? "no cable" : cfg.sw[sw].members[m].shut ? "administratively down" : "the far end is shut", lacp: false });
      continue;
    }
    for (const [sw, me, them] of [
      ["SW1", a, b],
      ["SW2", b, a],
    ] as [LcSw, LcMemberCfg, LcMemberCfg][]) {
      if (me.mode === "off") set(sw, { state: "individual", why: "not in a channel group: a normal switch port", lacp: false });
      else if (me.mode === "on") set(sw, { state: "bundled", why: them.mode === "on" ? "static bundle (no LACP)" : "static bundle — the far end does not run a static bundle", lacp: false });
      else if (!isLacp(them.mode)) set(sw, { state: "suspended", why: them.mode === "on" ? "LACP currently not enabled on the remote port (it is static “on”)" : "no LACPDUs from the far end (it is not in a channel group)", lacp: false });
      else if (me.mode === "passive" && them.mode === "passive") set(sw, { state: "suspended", why: "both ends passive: nobody starts LACP", lacp: false });
      else set(sw, { state: "bundled", why: "LACP negotiated", lacp: true, partnerGroup: them.group });
    }
  }
  // Partner consistency: within each group on each side, every LACP member must lead to the same partner group.
  for (const sw of LC_SWITCHES)
    for (const g of [1, 2] as const) {
      const ms = LC_MEMBERS.filter((m) => cfg.sw[sw].members[m].group === g && members[pk(sw, m)].lacp && members[pk(sw, m)].state === "bundled");
      const want = ms[0] ? members[pk(sw, ms[0])].partnerGroup : undefined;
      for (const m of ms.slice(1))
        if (members[pk(sw, m)].partnerGroup !== want) members[pk(sw, m)] = { ...members[pk(sw, m)], state: "suspended", why: `its partner port is in ${poName("cisco", members[pk(sw, m)].partnerGroup!)} on ${otherSw(sw)}, the other members' in ${poName("cisco", want!)}: one Port-channel can only lead to one partner Port-channel` };
    }
  // A member is only usable if it is bundled at BOTH ends; a bundled LACP member whose far end suspended it is out.
  for (const m of LC_MEMBERS)
    for (const sw of LC_SWITCHES) {
      const me = members[pk(sw, m)];
      const them = members[pk(otherSw(sw), m)];
      if (me.state === "bundled" && me.lacp && them.state !== "bundled") members[pk(sw, m)] = { ...me, state: "suspended", why: `${otherSw(sw)} does not aggregate this port (partner out of sync)` };
    }
  // Silent failures detected by LACP timeout.
  for (const k of Object.keys(silentDetected)) if (silentDetected[k] && members[k]?.state === "bundled" && members[k].lacp) members[k] = { ...members[k], state: "suspended", why: "LACPDUs stopped arriving: the partner timed out (expired)" };
  // Misconfiguration guard: a static Port-channel whose far end doesn't bundle those cables.
  for (const sw of LC_SWITCHES)
    for (const g of [1, 2] as const) {
      const ms = LC_MEMBERS.filter((m) => cfg.sw[sw].members[m].group === g && cfg.sw[sw].members[m].mode === "on" && linkUp(cfg, m));
      if (ms.some((m) => cfg.sw[otherSw(sw)].members[m].mode === "off")) {
        poErr.push(pk(sw, `Po${g}`));
        for (const m of ms) members[pk(sw, m)] = { ...members[pk(sw, m)], state: "errdis", why: "EtherChannel misconfiguration guard: the far end treats these cables as separate links" };
      }
    }
  // Logical links between the switches.
  const logical: LcLogical[] = [];
  for (const g1 of [1, 2] as const) {
    const ms = LC_MEMBERS.filter((m) => cfg.sw.SW1.members[m].group === g1 && members[pk("SW1", m)].state === "bundled" && members[pk("SW2", m)].state === "bundled");
    if (!ms.length) continue;
    const g2 = cfg.sw.SW2.members[ms[0]].group;
    logical.push({ id: `Po${g1}`, kind: "po", ends: { SW1: `Po${g1}`, SW2: `Po${g2}` }, members: ms, cost: Math.round(MEMBER_COST / ms.length), stp: "fwd" });
  }
  for (const m of LC_MEMBERS) if (members[pk("SW1", m)].state === "individual" && members[pk("SW2", m)].state === "individual") logical.push({ id: m, kind: "single", ends: { SW1: m, SW2: m }, members: [m], cost: MEMBER_COST, stp: "fwd" });
  // RSTP (SW1 is root): SW2 keeps the cheapest logical link (then the lowest port id on SW1's side) and blocks the rest.
  if (logical.length > 1) {
    const order = (l: LcLogical) => l.cost * 10000 + (l.kind === "po" ? 2048 + +l.ends.SW1.slice(2) : portNum(l.ends.SW1));
    const best = [...logical].sort((x, y) => order(x) - order(y))[0];
    for (const l of logical) l.stp = l === best ? "fwd" : "blk";
  }
  return { members, poErr, logical };
}

// ---------------------------------------------------------------------------------------------------------------
// Frames, runs, state
// ---------------------------------------------------------------------------------------------------------------
export type LcFrameKind = "arp-req" | "arp-rep" | "echo" | "echo-rep" | "lacpdu";
export interface LcFrame {
  id: number;
  src: string;
  dst: string;
  kind: LcFrameKind;
  sip: string;
  dip: string;
  from: LcDev;
  /** The flow (for the hash): last octets of the IPs. */
  flow?: string;
}
export interface LcCtr {
  inF: number;
  outF: number;
  lacpIn: number;
  lacpOut: number;
  drops: number;
}
const ZERO: LcCtr = { inF: 0, outF: 0, lacpIn: 0, lacpOut: 0, drops: 0 };
export interface LcHop {
  from: LcDev;
  fromPort: string;
  to: LcDev;
  toPort: string;
  frame: LcFrame;
  /** For inter-switch hops: the logical link (Po1 / ge-0/0/22) it belongs to. */
  via?: string;
}
export interface LcDecision {
  sw: LcSw;
  port: string;
  /** The logical port the frame arrived on (Po1, or the physical port). */
  logical: string;
  frame: LcFrame;
  drop?: string;
  learn?: "learned" | "refreshed" | "moved";
  kind?: "broadcast" | "unknown" | "known" | "filter";
  out: { logical: string; member: string; hash?: string }[];
}
export interface LcRx {
  dev: LcHost | LcSw;
  port: string;
  frame: LcFrame;
  ok: boolean;
  why: string;
}
export interface LcSnap {
  fdb: Record<LcSw, LcEntry[]>;
  counters: Record<string, LcCtr>;
}
export interface LcEntry {
  mac: string;
  port: string;
  seen: number;
}
export interface LcWave {
  k: number;
  hops: LcHop[];
  decisions: LcDecision[];
  rx: LcRx[];
  snap: LcSnap;
}
export type LcSend = { from: LcHost; to: LcHost; kind: "ping" | "arp" };
export interface LcResult {
  send: LcSend;
  replied: boolean;
  answered?: boolean;
  fail?: string;
  /** The member the echo request crossed, and the member the reply crossed. */
  memberOut?: string;
  memberBack?: string;
}
export interface LcRun {
  id: number;
  cmd: string;
  clock: number;
  kind: "traffic" | "lacp";
  waves: LcWave[];
  results: LcResult[];
  cfgSeq: number;
}
export interface LcCap {
  n: number;
  run: number;
  wave: number;
  point: string;
  dir: "in" | "out";
  frame: LcFrame;
}
export interface LcSyslog {
  clock: number;
  sw: LcSw;
  ev: "bundle" | "unbundle" | "suspend" | "up" | "down" | "errdis" | "timeout" | "stp";
  port: string;
  text?: string;
}
export interface LcLogLine {
  seq: number;
  text: string;
  tone: "info" | "ok" | "warn";
}
export type LcTicketId = "static" | "group" | "passive" | "rate" | "nolag";
export interface LcState {
  cfg: LcCfg;
  bundle: LcBundle;
  /** Members failed silently (link up, frames lost) and when. */
  silent: Partial<Record<LcMember, number>>;
  fdb: Record<LcSw, LcEntry[]>;
  arp: Record<LcHost, Record<string, string>>;
  counters: Record<string, LcCtr>;
  clock: number;
  captures: LcCap[];
  capN: number;
  syslog: LcSyslog[];
  runs: LcRun[];
  last?: LcRun;
  seq: number;
  frameSeq: number;
  cfgSeq: number;
  log: LcLogLine[];
  ticket?: LcTicketId;
  /** Junos commit history per device, newest first: its configuration before each commit (rollback 1, 2…). */
  rb?: Partial<Record<LcSw, string[]>>;
}
function emptyCounters(): Record<string, LcCtr> {
  const c: Record<string, LcCtr> = {};
  for (const sw of LC_SWITCHES) for (const p of LC_PORTS) c[pk(sw, p)] = { ...ZERO };
  for (const h of LC_HOSTS) c[h] = { ...ZERO };
  return c;
}
/** Which (side, member) pairs have noticed a silent failure by now. */
export function silentDetected(cfg: LcCfg, silent: LcState["silent"], clock: number): Record<string, boolean> {
  const d: Record<string, boolean> = {};
  for (const m of LC_MEMBERS) {
    const t = silent[m];
    if (t === undefined) continue;
    for (const sw of LC_SWITCHES) d[pk(sw, m)] = clock - t >= (cfg.sw[sw].members[m].fast ? FAST_TIMEOUT : SLOW_TIMEOUT);
  }
  return d;
}
export function createLcNet(cfg: LcCfg = lcHealthy()): LcState {
  return { cfg, bundle: lcBundle(cfg), silent: {}, fdb: { SW1: [], SW2: [] }, arp: { "HOST-A": {}, "HOST-D": {}, "HOST-B": {}, "HOST-C": {} }, counters: emptyCounters(), clock: 7200, captures: [], capN: 0, syslog: [], runs: [], seq: 0, frameSeq: 0, cfgSeq: 0, log: [] };
}
/** The logical port of a physical port on a switch (Po1 for a bundled member). */
export function logicalOf(s: LcState, sw: LcSw, p: string): string {
  if (!(LC_MEMBERS as readonly string[]).includes(p)) return p;
  const info = s.bundle.members[pk(sw, p)];
  if (info?.state === "bundled") return `Po${s.cfg.sw[sw].members[p as LcMember].group}`;
  return p;
}
/** The logical inter-switch link a logical port on `sw` belongs to. */
export const lcLogicalLink = (s: LcState, sw: LcSw, logical: string) => s.bundle.logical.find((l) => l.ends[sw] === logical);
/** Forwarding logical ports of a switch: host ports + inter-switch logical links that STP forwards. */
function fwdLogical(s: LcState, sw: LcSw): string[] {
  return [...LC_HOST_PORTS.filter((p) => !!LC_HOSTS.find((h) => HOST_AT[h].sw === sw && HOST_AT[h].port === p)), ...s.bundle.logical.filter((l) => l.stp === "fwd").map((l) => l.ends[sw])];
}
/** The modeled hash: which member of a logical link carries this flow. */
export function hashMember(s: LcState, sw: LcSw, l: LcLogical, f: LcFrame): { member: LcMember; text: string } {
  const sideMembers = l.members.filter((m) => !(silentDetected(s.cfg, s.silent, s.clock)[pk(sw, m)]));
  const list = sideMembers.length ? sideMembers : l.members;
  if (list.length === 1) return { member: list[0], text: "only member" };
  const [a, b] = (f.flow ?? "0-0").split("-").map(Number);
  const i = (a + b) % list.length;
  return { member: list[i], text: `(${a} + ${b}) mod ${list.length} = ${i} → ${list[i]}` };
}
export function lcMacName(mac: string): string {
  if (mac === BCAST) return "broadcast";
  if (mac === LACP_MAC) return "Slow Protocols";
  return LC_HOSTS.find((h) => HOST_MAC[h] === mac) ?? (LC_SWITCHES.find((s) => SYS_MAC[s] === mac) as string | undefined) ?? mac;
}
export const lcShortMac = (m: string) => (m === BCAST ? "FF:FF:FF:FF:FF:FF" : `…${m.slice(-5)}`);
export function lcFrameName(f: LcFrame): string {
  if (f.kind === "lacpdu") return "LACPDU";
  if (f.kind === "arp-req") return `ARP request (who has ${f.dip}?)`;
  if (f.kind === "arp-rep") return `ARP reply (${f.sip} is at ${lcShortMac(f.src)})`;
  if (f.kind === "echo-rep") return `ping reply ${f.sip} → ${f.dip}`;
  return `ping ${f.sip} → ${f.dip}`;
}
export const lcTable = (fdb: Record<LcSw, LcEntry[]>, sw: LcSw) => [...fdb[sw]].sort((a, b) => a.mac.localeCompare(b.mac));

// ---------------------------------------------------------------------------------------------------------------
// Changes
// ---------------------------------------------------------------------------------------------------------------
function recompute(s: LcState, cfg: LcCfg, text: string, silent = s.silent, clock = s.clock): LcState {
  const old = s.bundle;
  const bundle = lcBundle(cfg, silentDetected(cfg, silent, clock));
  const syslog = [...s.syslog];
  const notes: string[] = [];
  for (const sw of LC_SWITCHES)
    for (const m of LC_MEMBERS) {
      const o = old.members[pk(sw, m)];
      const n = bundle.members[pk(sw, m)];
      if (o.state === n.state) continue;
      if ((o.state === "down") !== (n.state === "down")) syslog.push({ clock, sw, ev: n.state === "down" ? "down" : "up", port: m });
      if (n.state === "bundled") syslog.push({ clock, sw, ev: "bundle", port: m, text: `Po${cfg.sw[sw].members[m].group}` });
      else if (o.state === "bundled") syslog.push({ clock, sw, ev: /expired|timed out/.test(n.why) ? "timeout" : "unbundle", port: m, text: `Po${cfg.sw[sw].members[m].group}` });
      if (n.state === "suspended") syslog.push({ clock, sw, ev: "suspend", port: m, text: n.why });
      if (n.state === "errdis" && o.state !== "errdis") syslog.push({ clock, sw, ev: "errdis", port: `Po${cfg.sw[sw].members[m].group}` });
    }
  for (const l of bundle.logical) {
    const o = old.logical.find((x) => x.id === l.id);
    if (o && o.stp !== l.stp) {
      syslog.push({ clock, sw: "SW2", ev: "stp", port: l.ends.SW2, text: l.stp === "blk" ? "Alternate (blocking)" : "Root (forwarding)" });
      notes.push(`spanning tree: SW2 ${l.ends.SW2} → ${l.stp === "blk" ? "blocking" : "forwarding"}`);
    }
  }
  // Entries learned on a port that left (or a member that changed logical port) are flushed.
  const fdb = { SW1: [...s.fdb.SW1], SW2: [...s.fdb.SW2] };
  for (const sw of LC_SWITCHES) {
    const valid = new Set([...LC_HOST_PORTS, ...bundle.logical.filter((l) => l.stp === "fwd").map((l) => l.ends[sw])] as string[]);
    fdb[sw] = fdb[sw].filter((e) => valid.has(e.port));
  }
  const seq = s.seq + 1;
  return { ...s, cfg, bundle, silent, clock, syslog: syslog.slice(-200), fdb, seq, cfgSeq: s.cfgSeq + 1, log: [...s.log, { seq, text: text + (notes.length ? ` — ${notes.join("; ")}` : ""), tone: "info" }] };
}
/** Time passing can change the bundle (LACP timeouts). */
function tick(s: LcState, seconds: number): LcState {
  const clock = s.clock + seconds;
  const before = JSON.stringify(lcBundle(s.cfg, silentDetected(s.cfg, s.silent, s.clock)).members);
  const after = JSON.stringify(lcBundle(s.cfg, silentDetected(s.cfg, s.silent, clock)).members);
  if (before === after) return { ...s, clock };
  const r = recompute(s, s.cfg, "LACP timeout", s.silent, clock);
  return { ...r, cfgSeq: s.cfgSeq, log: [...r.log.slice(0, -1), { seq: r.seq, text: `LACPDUs stopped on a silent member: ${LC_SWITCHES.filter((sw) => LC_MEMBERS.some((m) => silentDetected(s.cfg, s.silent, clock)[pk(sw, m)] && !silentDetected(s.cfg, s.silent, s.clock)[pk(sw, m)])).join(" and ")} timed it out and removed it from the bundle`, tone: "warn" }] };
}

// ---------------------------------------------------------------------------------------------------------------
// Traffic
// ---------------------------------------------------------------------------------------------------------------
interface Work {
  s: LcState;
  fdb: Record<LcSw, LcEntry[]>;
  counters: Record<string, LcCtr>;
  captures: LcCap[];
  capN: number;
  runId: number;
  waves: LcWave[];
}
const snapOf = (w: Work): LcSnap => ({ fdb: { SW1: [...w.fdb.SW1], SW2: [...w.fdb.SW2] }, counters: JSON.parse(JSON.stringify(w.counters)) });
function capture(w: Work, wave: number, h: LcHop) {
  const pt = (d: LcDev, p: string) => (isSw(d) ? pk(d, p) : d);
  w.captures.push({ n: ++w.capN, run: w.runId, wave, point: pt(h.from, h.fromPort), dir: "out", frame: h.frame }, { n: ++w.capN, run: w.runId, wave, point: pt(h.to, h.toPort), dir: "in", frame: h.frame });
  const out = w.counters[pt(h.from, h.fromPort)];
  const inn = w.counters[pt(h.to, h.toPort)];
  if (h.frame.kind === "lacpdu") {
    if (out) out.lacpOut++;
    if (inn) inn.lacpIn++;
  } else {
    if (out) out.outF++;
    if (inn) inn.inF++;
  }
}
function learn(w: Work, sw: LcSw, mac: string, port: string, d: LcDecision) {
  const e = w.fdb[sw].find((x) => x.mac === mac);
  if (!e) {
    w.fdb[sw] = [...w.fdb[sw], { mac, port, seen: w.s.clock }];
    d.learn = "learned";
  } else if (e.port !== port) {
    w.fdb[sw] = w.fdb[sw].map((x) => (x.mac === mac ? { ...x, port, seen: w.s.clock } : x));
    d.learn = "moved";
  } else {
    w.fdb[sw] = w.fdb[sw].map((x) => (x.mac === mac ? { ...x, seen: w.s.clock } : x));
    d.learn = "refreshed";
  }
}
/** Send one frame from a host and follow it until it is delivered or dropped. */
function propagate(w: Work, start: LcHop, onHost: (h: LcHost, f: LcFrame) => { ok: boolean; why: string }, onCross?: (member: string) => void) {
  let hops: LcHop[] = [start];
  const s = w.s;
  for (let guard = 0; guard < 6 && hops.length; guard++) {
    const k = w.waves.length;
    hops.forEach((h) => capture(w, k, h));
    const decisions: LcDecision[] = [];
    const rx: LcRx[] = [];
    const next: LcHop[] = [];
    for (const h of hops) {
      if (isHost(h.to)) {
        rx.push({ dev: h.to, port: h.toPort, frame: h.frame, ...onHost(h.to, h.frame) });
        continue;
      }
      const sw = h.to as LcSw;
      const f = h.frame;
      const logical = logicalOf(s, sw, h.toPort);
      const d: LcDecision = { sw, port: h.toPort, logical, frame: f, out: [] };
      const isMember = (LC_MEMBERS as readonly string[]).includes(h.toPort);
      const m = h.toPort as LcMember;
      if (isMember && s.silent[m] !== undefined) {
        d.drop = `${h.toPort}: the light never arrives (silent failure) — the frame is lost on the cable`;
        decisions.push(d);
        continue;
      }
      if (isMember) {
        const info = s.bundle.members[pk(sw, m)];
        const ll = lcLogicalLink(s, sw, logical);
        if (info.state === "suspended" || info.state === "errdis") {
          d.drop = `${h.toPort} is ${info.state === "errdis" ? "err-disabled" : "suspended"} — ${info.why}`;
          w.counters[pk(sw, h.toPort)].drops++;
          decisions.push(d);
          continue;
        }
        if (ll && ll.stp === "blk") {
          d.drop = `${logical} is blocked by spanning tree (Alternate): data is discarded`;
          w.counters[pk(sw, h.toPort)].drops++;
          decisions.push(d);
          continue;
        }
        if (!ll) {
          d.drop = `${h.toPort} is not a working link to ${otherSw(sw)}`;
          decisions.push(d);
          continue;
        }
      }
      learn(w, sw, f.src, logical, d);
      const outs = fwdLogical(s, sw).filter((lp) => lp !== logical);
      const hit = f.dst === BCAST ? undefined : w.fdb[sw].find((e) => e.mac === f.dst);
      let targets: string[];
      if (f.dst === BCAST) d.kind = "broadcast";
      else if (!hit) d.kind = "unknown";
      else if (hit.port === logical) d.kind = "filter";
      else d.kind = "known";
      if (d.kind === "broadcast" || d.kind === "unknown") targets = outs;
      else if (d.kind === "filter") targets = [];
      else targets = outs.includes(hit!.port) ? [hit!.port] : [];
      for (const lp of targets) {
        const ll = lcLogicalLink(s, sw, lp);
        if (ll) {
          const hm = hashMember(s, sw, ll, f);
          d.out.push({ logical: lp, member: hm.member, hash: ll.kind === "po" ? hm.text : undefined });
          onCross?.(hm.member);
          next.push({ from: sw, fromPort: hm.member, to: otherSw(sw), toPort: hm.member, frame: f, via: lp });
        } else {
          const h2 = LC_HOSTS.find((x) => HOST_AT[x].sw === sw && HOST_AT[x].port === lp);
          d.out.push({ logical: lp, member: lp });
          if (h2) next.push({ from: sw, fromPort: lp, to: h2, toPort: "eth0", frame: f });
        }
      }
      decisions.push(d);
    }
    w.waves.push({ k, hops, decisions, rx, snap: snapOf(w) });
    hops = next;
  }
}
function simulate(s0: LcState, sends: LcSend[], cmd: string): LcState {
  const s = tick(s0, 1);
  const runId = s.runs.length + 1;
  const age = (sw: LcSw) => s.fdb[sw].filter((e) => s.clock - e.seen < LC_AGING);
  const w: Work = { s, fdb: { SW1: age("SW1"), SW2: age("SW2") }, counters: JSON.parse(JSON.stringify(s.counters)), captures: [...s.captures], capN: s.capN, runId, waves: [] };
  const arp = JSON.parse(JSON.stringify(s.arp)) as LcState["arp"];
  let frameSeq = s.frameSeq;
  const nf = (f: Omit<LcFrame, "id">): LcFrame => ({ ...f, id: ++frameSeq });
  const flow = (a: LcHost, b: LcHost) => `${HOST_IP[a].split(".")[3]}-${HOST_IP[b].split(".")[3]}`;
  const start = (h: LcHost, f: LcFrame): LcHop => ({ from: h, fromPort: "eth0", to: HOST_AT[h].sw, toPort: HOST_AT[h].port, frame: f });
  const results: LcResult[] = [];
  for (const x of sends) {
    const r: LcResult = { send: x, replied: false };
    results.push(r);
    const { from, to } = x;
    let mac = arp[from][HOST_IP[to]];
    if (!mac || x.kind === "arp") {
      let heard = false;
      propagate(w, start(from, nf({ src: HOST_MAC[from], dst: BCAST, kind: "arp-req", sip: HOST_IP[from], dip: HOST_IP[to], from, flow: flow(from, to) })), (h, f) => {
        if (f.dip === HOST_IP[h]) {
          heard = true;
          return { ok: true, why: `${h}: that's my address — answers` };
        }
        return { ok: true, why: `${h}: not my address — ignores it` };
      });
      if (!heard) {
        r.fail = `${from}'s ARP request never reached ${to}`;
        continue;
      }
      arp[to][HOST_IP[from]] = HOST_MAC[from];
      let got = false;
      propagate(w, start(to, nf({ src: HOST_MAC[to], dst: HOST_MAC[from], kind: "arp-rep", sip: HOST_IP[to], dip: HOST_IP[from], from: to, flow: flow(to, from) })), (h) => (h === from ? ((got = true), { ok: true, why: `${h}: learns ${HOST_IP[to]}'s MAC` }) : { ok: false, why: `${h}: not for me` }));
      if (!got) {
        r.fail = `${to}'s ARP reply never came back to ${from}`;
        continue;
      }
      arp[from][HOST_IP[to]] = HOST_MAC[to];
      mac = HOST_MAC[to];
      if (x.kind === "arp") {
        r.answered = true;
        continue;
      }
    }
    let arrived = false;
    propagate(
      w,
      start(from, nf({ src: HOST_MAC[from], dst: mac, kind: "echo", sip: HOST_IP[from], dip: HOST_IP[to], from, flow: flow(from, to) })),
      (h) => (h === to ? ((arrived = true), { ok: true, why: `${h}: ping for me — replies` }) : { ok: false, why: `${h}: not for me` }),
      (m) => (r.memberOut = r.memberOut ?? m),
    );
    if (!arrived) {
      r.fail = `the ping never reached ${to}${r.memberOut ? ` (it was hashed onto ${r.memberOut})` : ""}`;
      continue;
    }
    let back = false;
    propagate(
      w,
      start(to, nf({ src: HOST_MAC[to], dst: HOST_MAC[from], kind: "echo-rep", sip: HOST_IP[to], dip: HOST_IP[from], from: to, flow: flow(to, from) })),
      (h) => (h === from ? ((back = true), { ok: true, why: `${h}: the reply came back` }) : { ok: false, why: `${h}: not for me` }),
      (m) => (r.memberBack = r.memberBack ?? m),
    );
    r.replied = back;
    if (!back) r.fail = `${to}'s reply never came back${r.memberBack ? ` (hashed onto ${r.memberBack})` : ""}`;
  }
  const run: LcRun = { id: runId, cmd, clock: s.clock, kind: "traffic", waves: w.waves, results, cfgSeq: s.cfgSeq };
  const seq = s.seq + 1;
  const summary = results.map((x) => (x.replied ? `${x.send.from} → ${x.send.to}: reply came back (out on ${x.memberOut ?? "—"}, back on ${x.memberBack ?? "—"})` : x.answered ? `${x.send.from}: ARP answered` : `${x.send.from} → ${x.send.to}: FAILED — ${x.fail}`)).join(" · ");
  return { ...s, fdb: w.fdb, arp, counters: w.counters, captures: w.captures.slice(-1500), capN: w.capN, runs: [...s.runs, run].slice(-40), last: run, seq, frameSeq, log: [...s.log, { seq, text: `${cmd}: ${summary}`, tone: results.every((x) => x.replied || x.answered) ? "ok" : "warn" }] };
}
/** One round of LACPDUs on every member where LACP runs (active ends send; passive ends answer). */
function lacpRound(s0: LcState): LcState {
  const s = tick(s0, 1);
  const runId = s.runs.length + 1;
  const w: Work = { s, fdb: s.fdb, counters: JSON.parse(JSON.stringify(s.counters)), captures: [...s.captures], capN: s.capN, runId, waves: [] };
  let frameSeq = s.frameSeq;
  const hops: LcHop[] = [];
  const rx: LcRx[] = [];
  for (const m of LC_MEMBERS) {
    if (!linkUp(s.cfg, m)) continue;
    for (const sw of LC_SWITCHES) {
      const me = s.cfg.sw[sw].members[m];
      const them = s.cfg.sw[otherSw(sw)].members[m];
      const talks = me.mode === "active" || (me.mode === "passive" && them.mode === "active");
      if (!talks) continue;
      const f: LcFrame = { id: ++frameSeq, src: SYS_MAC[sw], dst: LACP_MAC, kind: "lacpdu", sip: "", dip: "", from: sw };
      hops.push({ from: sw, fromPort: m, to: otherSw(sw), toPort: m, frame: f });
      const peer = otherSw(sw);
      const info = s.bundle.members[pk(peer, m)];
      const lost = s.silent[m] !== undefined;
      const why = lost ? `${peer} ${m}: nothing arrives — the cable is silently broken` : them.mode === "off" || them.mode === "on" ? `${peer} ${m}: not running LACP — the LACPDU is ignored` : `${peer} ${m}: partner ${sw} (key ${me.group}, ${me.mode}) → ${info.state === "bundled" ? "in sync: collecting + distributing" : `not aggregated: ${info.why}`}`;
      rx.push({ dev: peer, port: m, frame: f, ok: !lost && info.state === "bundled", why });
    }
  }
  hops.forEach((h) => capture(w, 0, h));
  w.waves.push({ k: 0, hops, decisions: [], rx, snap: snapOf(w) });
  const run: LcRun = { id: runId, cmd: "One round of LACPDUs", clock: s.clock, kind: "lacp", waves: w.waves, results: [], cfgSeq: s.cfgSeq };
  const seq = s.seq + 1;
  return { ...s, counters: w.counters, captures: w.captures.slice(-1500), capN: w.capN, runs: [...s.runs, run].slice(-40), last: run, seq, frameSeq, log: [...s.log, { seq, text: `LACPDUs sent: ${hops.length}`, tone: "info" }] };
}

// ---------------------------------------------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------------------------------------------
export type LcAction =
  | { type: "traffic"; sends: LcSend[]; cmd?: string }
  | { type: "lacp" }
  | { type: "wait"; seconds: number }
  | { type: "clear"; sw: LcSw }
  | { type: "clear-counters" }
  | { type: "cfg"; cfg: LcCfg; text: string; junosCommit?: LcSw }
  | { type: "cable"; member: LcMember; up: boolean }
  | { type: "silent"; member: LcMember; on: boolean }
  | { type: "ticket"; id: LcTicketId }
  | { type: "fresh" };
export const sendText = (x: LcSend) => (x.kind === "arp" ? `${x.from} broadcasts an ARP request for ${x.to}` : `${x.from} pings ${x.to}`);
export function lcApply(s: LcState, a: LcAction): LcState {
  switch (a.type) {
    case "traffic":
      return simulate(s, a.sends, a.cmd ?? a.sends.map(sendText).join(", then "));
    case "lacp":
      return lacpRound(s);
    case "wait": {
      const t = tick(s, a.seconds);
      const seq = t.seq + 1;
      return { ...t, seq, log: [...t.log, { seq, text: `${a.seconds} s pass`, tone: "info" }] };
    }
    case "clear":
      return { ...s, fdb: { ...s.fdb, [a.sw]: [] } };
    case "clear-counters":
      return { ...s, counters: emptyCounters() };
    case "cfg": {
      const next = recompute(s, a.cfg, a.text);
      if (!a.junosCommit) return next;
      const d = a.junosCommit;
      return { ...next, rb: { ...s.rb, [d]: [JSON.stringify(s.cfg.sw[d]), ...(s.rb?.[d] ?? [])].slice(0, 49) } };
    }
    case "cable": {
      const cfg = lcClone(s.cfg);
      cfg.cables[a.member] = a.up;
      const silent = { ...s.silent };
      if (!a.up) delete silent[a.member];
      return recompute(s, cfg, `${a.member} cable ${a.up ? "plugged in" : "unplugged"}`, silent);
    }
    case "silent": {
      const silent = { ...s.silent };
      if (a.on) silent[a.member] = s.clock;
      else delete silent[a.member];
      return recompute(s, s.cfg, a.on ? `${a.member}: the media converter fails — the link stays UP but no light gets through` : `${a.member}: the media converter is replaced`, silent);
    }
    case "ticket":
      return lcTicketState(a.id, s.seq + 1);
    case "fresh":
      return { ...createLcNet(), seq: s.seq + 1 };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------------------------------------------
export type LcCause = "static" | "group" | "passive" | "rate" | "nolag" | "cable" | "stp-member" | "hash";
export const LC_CAUSES: { id: LcCause; label: string }[] = [
  { id: "cable", label: "A cable between the switches is unplugged" },
  { id: "static", label: "One end is a static bundle (“on”), the other runs LACP" },
  { id: "passive", label: "Both ends are LACP passive" },
  { id: "group", label: "A member is in the wrong channel group on one switch" },
  { id: "rate", label: "LACP's slow rate takes 90 s to notice a silent member" },
  { id: "nolag", label: "The cables aren't bundled at all" },
  { id: "stp-member", label: "Spanning tree is blocking one member of the bundle" },
  { id: "hash", label: "The load-balancing hash is broken" },
];
export interface LcTicket {
  id: LcTicketId;
  title: string;
  report: string;
  repro: LcAction[];
  reproLabel: string;
  cause: LcCause;
  good: (s: LcState, run: LcRun) => { ok: boolean; why: string };
}
const TWO: LcSend[] = [
  { from: "HOST-A", to: "HOST-B", kind: "ping" },
  { from: "HOST-A", to: "HOST-C", kind: "ping" },
];
const allOk = (run: LcRun) => run.results.every((r) => r.replied);
const spread = (run: LcRun) => new Set(run.results.map((r) => r.memberOut)).size > 1;
export const LC_TICKETS: LcTicket[] = [
  {
    id: "static",
    title: "Floor 1 and floor 2 can't talk",
    report: "“After SW2 was replaced last night, nobody on SW1 reaches anybody on SW2. Both uplink cables show link lights.”",
    repro: [{ type: "traffic", sends: [{ from: "HOST-A", to: "HOST-B", kind: "ping" }] }],
    reproLabel: "HOST-A pings HOST-B",
    cause: "static",
    good: (_s, run) => ({ ok: allOk(run), why: allOk(run) ? "the reply came back" : run.results[0]?.fail ?? "no reply" }),
  },
  {
    id: "group",
    title: "The uplink is only half as fast",
    report: "“Since yesterday's change on SW2, the SW1–SW2 uplink tops out at 1 Gb/s. Both cables are up and nothing is down.”",
    repro: [{ type: "traffic", sends: TWO }],
    reproLabel: "HOST-A pings HOST-B and HOST-C (two flows)",
    cause: "group",
    good: (_s, run) => ({ ok: allOk(run) && spread(run), why: `${run.results.map((r) => `${r.send.to.replace("HOST-", "")} via ${r.memberOut ?? "—"}`).join(", ")}${allOk(run) ? "" : " · a ping failed"}` }),
  },
  {
    id: "passive",
    title: "The uplink never comes up",
    report: "“We ‘standardized’ the uplink configuration on both switches this morning. Since then the Port-channel is down and the floors are cut off.”",
    repro: [{ type: "traffic", sends: [{ from: "HOST-A", to: "HOST-B", kind: "ping" }] }],
    reproLabel: "HOST-A pings HOST-B",
    cause: "passive",
    good: (_s, run) => ({ ok: allOk(run), why: allOk(run) ? "the reply came back" : run.results[0]?.fail ?? "no reply" }),
  },
  {
    id: "rate",
    title: "A minute and a half of lost traffic",
    report: "“When a media converter on one uplink cable died, the link LED stayed green and some users lost the network for about 90 seconds — others were fine.”",
    repro: [{ type: "silent", member: "ge-0/0/24", on: false }, { type: "wait", seconds: 100 }, { type: "silent", member: "ge-0/0/24", on: true }, { type: "wait", seconds: 5 }, { type: "traffic", sends: [{ from: "HOST-A", to: "HOST-C", kind: "ping" }] }],
    reproLabel: "Fail ge-0/0/24 silently, wait 5 s, then HOST-A pings HOST-C",
    cause: "rate",
    good: (_s, run) => ({ ok: allOk(run), why: allOk(run) ? `the reply came back (via ${run.results[0].memberOut})` : run.results[0]?.fail ?? "no reply" }),
  },
  {
    id: "nolag",
    title: "One cable does all the work",
    report: "“Monitoring shows ge-0/0/24 between SW1 and SW2 carrying nothing at all; ge-0/0/23 carries everything. Somebody ‘cleaned up’ the uplink config on both switches.”",
    repro: [{ type: "traffic", sends: TWO }],
    reproLabel: "HOST-A pings HOST-B and HOST-C (two flows)",
    cause: "nolag",
    good: (_s, run) => ({ ok: allOk(run) && spread(run), why: `${run.results.map((r) => `${r.send.to.replace("HOST-", "")} via ${r.memberOut ?? "—"}`).join(", ")}${allOk(run) ? "" : " · a ping failed"}` }),
  },
];
export const lcTicket = (id: LcTicketId) => LC_TICKETS.find((t) => t.id === id)!;
const MORNING: LcSend[] = [...TWO, { from: "HOST-D", to: "HOST-B", kind: "ping" }];
/** The healthy network after a normal morning of traffic: bundles negotiated, tables learned. */
export function lcWarm(cfg: LcCfg = lcHealthy()): LcState {
  return lcApply(createLcNet(cfg), { type: "traffic", sends: MORNING, cmd: "Morning traffic" });
}
export function lcTicketState(id: LcTicketId, seq: number): LcState {
  const cfg = lcHealthy();
  if (id === "static") for (const m of ["ge-0/0/23", "ge-0/0/24"] as LcMember[]) cfg.sw.SW2.members[m].mode = "on";
  if (id === "group") cfg.sw.SW2.members["ge-0/0/24"].group = 2;
  if (id === "passive") for (const sw of LC_SWITCHES) for (const m of ["ge-0/0/23", "ge-0/0/24"] as LcMember[]) cfg.sw[sw].members[m].mode = "passive";
  if (id === "nolag") for (const sw of LC_SWITCHES) for (const m of ["ge-0/0/23", "ge-0/0/24"] as LcMember[]) cfg.sw[sw].members[m].mode = "off";
  let s = createLcNet(cfg);
  s = lcApply(s, { type: "traffic", sends: MORNING, cmd: "Morning traffic" });
  return { ...s, seq, ticket: id, runs: [], last: undefined, captures: [], capN: 0, counters: emptyCounters(), cfgSeq: 0, log: [{ seq, text: `Ticket opened: ${lcTicket(id).title}`, tone: "info" }] };
}
export function lcLastRepro(s: LcState): LcRun | undefined {
  if (!s.ticket) return undefined;
  const want = lcTicket(s.ticket).repro.filter((a): a is Extract<LcAction, { type: "traffic" }> => a.type === "traffic").at(-1)!.sends;
  return [...s.runs].reverse().find((r) => r.kind === "traffic" && r.results.length === want.length && r.results.every((x, i) => x.send.from === want[i].from && x.send.to === want[i].to && x.send.kind === want[i].kind));
}
export interface LcProof {
  label: string;
  ok: boolean;
  detail: string;
}
const memberStates = (s: LcState, sw: LcSw) => LC_MEMBERS.filter((m) => s.cfg.cables[m]).map((m) => `${m} ${s.bundle.members[pk(sw, m)].state}`).join(", ");
export function lcProofs(s: LcState): LcProof[] {
  if (!s.ticket) return [];
  const t = lcTicket(s.ticket);
  const run = lcLastRepro(s);
  const fresh = !!run && run.cfgSeq === s.cfgSeq;
  const g = run ? t.good(s, run) : undefined;
  const test: LcProof = { label: `A fresh test: ${/^[A-Z][a-z]/.test(t.reproLabel) ? t.reproLabel[0].toLowerCase() + t.reproLabel.slice(1) : t.reproLabel} — and it works`, ok: !!g?.ok && fresh, detail: !run ? "not run yet" : !fresh ? "the network changed since the last test — run it again" : g!.why };
  const po = s.bundle.logical.find((l) => l.kind === "po");
  const both = { label: "Both cables are bundled at both ends (Po1 with 2 members)", ok: !!po && po.members.length >= 2 && po.stp === "fwd", detail: `SW1: ${memberStates(s, "SW1")} · SW2: ${memberStates(s, "SW2")}` };
  switch (s.ticket) {
    case "static":
    case "passive":
    case "group":
    case "nolag":
      return [both, test];
    case "rate":
      return [{ label: "Both switches ask for fast LACPDUs on the uplink members (3 s detection)", ok: LC_SWITCHES.every((sw) => (["ge-0/0/23", "ge-0/0/24"] as LcMember[]).every((m) => s.cfg.sw[sw].members[m].fast)), detail: LC_SWITCHES.map((sw) => `${sw}: ${(["ge-0/0/23", "ge-0/0/24"] as LcMember[]).map((m) => `${m} ${s.cfg.sw[sw].members[m].fast ? "fast" : "slow"}`).join(", ")}`).join(" · ") }, test];
  }
}
export function lcCauseFeedback(s: LcState, cause: LcCause): { right: boolean; consequence?: boolean; text: string } {
  const c = s.cfg;
  const t = s.ticket ? lcTicket(s.ticket) : undefined;
  const right = !!t && t.cause === cause;
  const st = (sw: LcSw) => memberStates(s, sw);
  const text: Record<LcCause, string> = {
    cable: `The uplink cables are plugged in: ${LC_MEMBERS.filter((m) => c.cables[m]).join(", ")} — link up at both ends.${s.silent["ge-0/0/24"] !== undefined ? " (ge-0/0/24's link is up too — that is exactly what a silent failure looks like.)" : ""}`,
    static: right ? `Yes. SW2's uplink ports are a static bundle (Cisco channel-group 1 mode on · Junos ae0 without lacp) — they send no LACPDUs. SW1 runs LACP active, hears nothing back, and suspends both members (show etherchannel summary: (s); log: LACP currently not enabled on the remote port). SW2 happily forwards into its static bundle, SW1 drops everything that arrives. Both ends must speak LACP (or both be static).` : `Both ends run LACP on the uplink members (SW1: ${LC_MEMBERS.map((m) => c.sw.SW1.members[m].mode).join("/")}, SW2: ${LC_MEMBERS.map((m) => c.sw.SW2.members[m].mode).join("/")}).`,
    passive: right ? "Yes. Both ends are LACP passive: a passive port only answers LACPDUs, it never starts. Nobody sends the first one, so neither end ever finds a partner and every member stays suspended — the Port-channel is down. At least one end must be active (normally both)." : `At least one end is active: SW1 ${LC_MEMBERS.map((m) => c.sw.SW1.members[m].mode).join("/")}, SW2 ${LC_MEMBERS.map((m) => c.sw.SW2.members[m].mode).join("/")}.`,
    group: right ? `Yes. On SW2, ge-0/0/24 is in channel-group 2 (Po2 / ae1) while ge-0/0/23 is in channel-group 1. LACP tells SW1 so (partner key 2 on ge-0/0/24, key 1 on ge-0/0/23). One Port-channel can only lead to one partner Port-channel, so SW1 keeps ge-0/0/23 and suspends ge-0/0/24: the bundle runs on one cable. On SW1, show lacp neighbor (Junos: show lacp interfaces) shows the two different partner keys.` : `Every uplink member is in channel group 1 on both switches (SW1: ${st("SW1")} · SW2: ${st("SW2")}).`,
    rate: right ? `Yes. The uplink members use LACP's slow rate (an LACPDU every 30 s, timeout 90 s). When ge-0/0/24's media converter died, the link stayed up, so only LACP could notice — after 90 s. Until then the hash kept sending some flows onto the dead cable. With the fast rate (Cisco lacp rate fast · Junos lacp periodic fast) LACPDUs come every second and the member is removed after 3 s.` : `The uplink members ${LC_MEMBERS.some((m) => c.sw.SW1.members[m].fast) ? "use the fast LACP rate" : "use the slow rate — but no member has failed silently here"}.`,
    nolag: right ? "Yes. The uplink ports aren't in any channel group on either switch: they are two separate links between the same two switches. Spanning tree sees two paths, keeps one (ge-0/0/23) and blocks the other (ge-0/0/24 Alternate on SW2) — exactly what it should do with two parallel links. Bundle them into a Port-channel and spanning tree sees ONE link, with both cables carrying traffic." : `The uplink cables are bundled (SW1: ${st("SW1")}).`,
    "stp-member": "Spanning tree never sees the members of a bundle: it runs on the Port-channel as one logical port (Po1 / ae0). It can block a whole Port-channel, never one member of it.",
    hash: "The hash works as designed: each flow (source + destination) always maps to one member, so different flows spread over the members. A hash can be uneven, but it never sends traffic onto a member that isn't bundled.",
  };
  return { right, text: text[cause] };
}
