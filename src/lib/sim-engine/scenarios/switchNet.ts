/**
 * Switching Lab network — two learning bridges in one broadcast domain, simulated frame copy by frame copy.
 *
 *   HOST-A ─ ge-0/0/1 ┐                     ┌ ge-0/0/1 ─ HOST-B
 *                     SW1 ══ ge-0/0/23 ══ SW2
 *   HOST-D ─ ge-0/0/2 ┘    ·· ge-0/0/24 ··  └ ge-0/0/2 ─ HOST-C
 *            ge-0/0/3 (spare)               ge-0/0/3 (spare)
 *
 * The same network as the guided lesson (switchingFundamentals.ts): same hosts, MACs, ports and the cabled-but-disabled
 * second link ge-0/0/24. A third cable (ge-0/0/22) can be plugged in the engineering workspace.
 *
 * What is modeled, and how:
 * - Each switch has ITS OWN forwarding database. It learns a MAC only from the SOURCE of a frame arriving on one of its
 *   own ports, against that port. Nothing is ever copied between switches.
 * - Lookup per switch: broadcast → flood; unknown unicast → flood; known → one port; known on the ingress port → filter.
 *   A flood never goes back out the ingress port and uses only ports whose link is up.
 * - Static entries (configuration) win over learning: the MAC is not relearned elsewhere and never ages.
 * - Dynamic entries age out after the aging time (300 s) without a frame SOURCED by that MAC. A port going down
 *   flushes what was learned on it (both common switch behaviors).
 * - Time: frames move in "waves" — one wave is one link crossing, a few microseconds on a real LAN. The lab clock (for
 *   aging and logs) moves 1 s per action, or by `wait`.
 * - Identical copies (same frame, same link, same wave) are kept as ONE group with a count, so a storm that doubles
 *   every hop is represented exactly without drawing every copy.
 * - Loops: with two active paths and no loop prevention (no STP runs in this lab) copies come back forever — Ethernet
 *   has no TTL. A run shows SN_WAVES waves after its last injected frame; copies still on a link are kept in
 *   `circ` and keep moving at the next action: the loop is never "stopped" by the lab, only by removing a path.
 * - Hosts accept frames for their own MAC or broadcast. A host answers an ARP request for its IP, and a ping
 *   (data frame with wantReply) addressed to it — once per frame and run (a real host answers every duplicate copy; the
 *   lab answers the first so the drawing stays readable; the extra copies are still counted as received).
 */

export type SnSw = "SW1" | "SW2";
export type SnHost = "HOST-A" | "HOST-B" | "HOST-C" | "HOST-D" | "HOST-E";
export type SnDev = SnSw | SnHost;
export const SN_SWITCHES: SnSw[] = ["SW1", "SW2"];
export const SN_HOSTS: SnHost[] = ["HOST-A", "HOST-D", "HOST-B", "HOST-C", "HOST-E"];
export const SN_PORTS = ["ge-0/0/1", "ge-0/0/2", "ge-0/0/3", "ge-0/0/22", "ge-0/0/23", "ge-0/0/24"] as const;
export type SnPort = (typeof SN_PORTS)[number];
export type SnUplink = "ge-0/0/22" | "ge-0/0/23" | "ge-0/0/24";
export const SN_UPLINKS: SnUplink[] = ["ge-0/0/23", "ge-0/0/24", "ge-0/0/22"];
export const isUplink = (p: string): p is SnUplink => p === "ge-0/0/22" || p === "ge-0/0/23" || p === "ge-0/0/24";
export const BCAST = "FF:FF:FF:FF:FF:FF";
export const SN_MAC: Record<SnHost, string> = { "HOST-A": "00:11:22:33:55:0A", "HOST-B": "00:11:22:33:55:0B", "HOST-C": "00:11:22:33:55:0C", "HOST-D": "00:11:22:33:55:0D", "HOST-E": "00:11:22:33:55:0E" };
export const SN_IP: Record<SnHost, string> = { "HOST-A": "192.168.50.10", "HOST-B": "192.168.50.20", "HOST-C": "192.168.50.30", "HOST-D": "192.168.50.40", "HOST-E": "192.168.50.50" };
export const SN_AGING = 300;
/** Waves a run shows after its last injected frame. A drawing limit — not a protocol mechanism. */
export const SN_WAVES = 10;
/** Copies in one group are counted exactly up to here; a real link would be saturated long before. */
export const SN_MAX_COPIES = 1_000_000;
const other = (sw: SnSw): SnSw => (sw === "SW1" ? "SW2" : "SW1");
const portIdx = (p: string) => SN_PORTS.indexOf(p as SnPort);

// ---------------------------------------------------------------------------------------------------------------
// Configuration (what an engineer can change) and the physical layer derived from it
// ---------------------------------------------------------------------------------------------------------------
export interface SnStatic {
  mac: string;
  port: SnPort;
}
export interface SnSwCfg {
  shut: SnPort[];
  statics: SnStatic[];
  aging: number;
}
export interface SnAttach {
  sw: SnSw;
  port: SnPort;
}
export interface SnCfg {
  sw: Record<SnSw, SnSwCfg>;
  /** Cables between SW1 and SW2 (same port number at both ends). */
  cables: Record<SnUplink, boolean>;
  hosts: Record<SnHost, { mac: string; at?: SnAttach }>;
}
export function snHealthy(): SnCfg {
  return {
    sw: { SW1: { shut: ["ge-0/0/24"], statics: [], aging: SN_AGING }, SW2: { shut: ["ge-0/0/24"], statics: [], aging: SN_AGING } },
    cables: { "ge-0/0/22": false, "ge-0/0/23": true, "ge-0/0/24": true },
    hosts: {
      "HOST-A": { mac: SN_MAC["HOST-A"], at: { sw: "SW1", port: "ge-0/0/1" } },
      "HOST-D": { mac: SN_MAC["HOST-D"], at: { sw: "SW1", port: "ge-0/0/2" } },
      "HOST-B": { mac: SN_MAC["HOST-B"], at: { sw: "SW2", port: "ge-0/0/1" } },
      "HOST-C": { mac: SN_MAC["HOST-C"], at: { sw: "SW2", port: "ge-0/0/2" } },
      "HOST-E": { mac: SN_MAC["HOST-E"] },
    },
  };
}
export const snCloneCfg = (c: SnCfg): SnCfg => JSON.parse(JSON.stringify(c)) as SnCfg;

/** What is physically plugged into a port (whatever its admin state). */
export function snPeer(cfg: SnCfg, sw: SnSw, port: string): { dev: SnDev; port: string } | undefined {
  if (isUplink(port)) return cfg.cables[port] ? { dev: other(sw), port } : undefined;
  const h = SN_HOSTS.find((x) => cfg.hosts[x].at?.sw === sw && cfg.hosts[x].at?.port === port);
  return h ? { dev: h, port: "eth0" } : undefined;
}
export const snShut = (cfg: SnCfg, sw: SnSw, port: string) => cfg.sw[sw].shut.includes(port as SnPort);
/** A port forwards only if it is enabled, cabled, and (for an uplink) enabled at the far end too. */
export function snPortUp(cfg: SnCfg, sw: SnSw, port: string): boolean {
  if (snShut(cfg, sw, port)) return false;
  const p = snPeer(cfg, sw, port);
  if (!p) return false;
  return isSw(p.dev) ? !snShut(cfg, p.dev, port) : true;
}
export const snPortStatus = (cfg: SnCfg, sw: SnSw, port: string): "connected" | "notconnect" | "disabled" => (snShut(cfg, sw, port) ? "disabled" : snPortUp(cfg, sw, port) ? "connected" : "notconnect");
export const isSw = (d: string): d is SnSw => d === "SW1" || d === "SW2";
export const snHostLinkUp = (cfg: SnCfg, h: SnHost) => {
  const at = cfg.hosts[h].at;
  return !!at && snPortUp(cfg, at.sw, at.port);
};
/** Active SW1↔SW2 paths right now. */
export const snActiveUplinks = (cfg: SnCfg) => SN_UPLINKS.filter((p) => snPortUp(cfg, "SW1", p));
export const snLoop = (cfg: SnCfg) => snActiveUplinks(cfg).length > 1;
export const snHostAt = (cfg: SnCfg, sw: SnSw, port: string) => SN_HOSTS.find((x) => cfg.hosts[x].at?.sw === sw && cfg.hosts[x].at?.port === port);
/** Which host a MAC belongs to (the first attached one, then any). */
export function snMacName(cfg: SnCfg | undefined, mac: string): string {
  if (mac === BCAST) return "broadcast";
  const c = cfg ?? snHealthy();
  return SN_HOSTS.find((h) => c.hosts[h].mac === mac && c.hosts[h].at) ?? SN_HOSTS.find((h) => c.hosts[h].mac === mac) ?? (Object.keys(SN_MAC) as SnHost[]).find((h) => SN_MAC[h] === mac) ?? mac;
}
/** What a port leads to, from this switch's point of view. */
export function snPortRole(cfg: SnCfg, sw: SnSw, port: string): string {
  if (isUplink(port)) return cfg.cables[port] ? `uplink → ${other(sw)}` : "spare · no cable";
  const h = snHostAt(cfg, sw, port);
  return h ? `access → ${h}` : "access · nothing plugged in";
}

// ---------------------------------------------------------------------------------------------------------------
// Frames, tables, counters, captures, runs
// ---------------------------------------------------------------------------------------------------------------
export type SnFrameKind = "arp-req" | "arp-rep" | "data" | "data-rep";
export interface SnFrame {
  id: number;
  src: string;
  dst: string;
  kind: SnFrameKind;
  /** The host that built it (its MAC is `src`). */
  from: SnHost;
  /** The host it is meant for (ARP: whose IP is asked; data: the destination). */
  target?: SnHost;
  bytes: number;
  wantReply?: boolean;
  /** The frame this one answers. */
  answers?: number;
}
export interface SnEntry {
  mac: string;
  port: SnPort;
  type: "dynamic" | "static";
  /** Lab clock (s) when a frame from this MAC was last seen (dynamic entries). */
  seen: number;
}
export interface SnCtr {
  inF: number;
  outF: number;
  inB: number;
  outB: number;
  inBytes: number;
  outBytes: number;
}
const ZERO: SnCtr = { inF: 0, outF: 0, inB: 0, outB: 0, inBytes: 0, outBytes: 0 };
/** One group of identical copies crossing one link in one wave. */
export interface SnHop {
  from: SnDev;
  fromPort: string;
  to: SnDev;
  toPort: string;
  frame: SnFrame;
  n: number;
  /** The copies never arrived (why). */
  lost?: string;
}
export type SnLearn = "learned" | "refreshed" | "moved" | "static";
export type SnKind = "broadcast" | "unknown" | "known" | "filter" | "blackhole";
export interface SnDecision {
  sw: SnSw;
  port: SnPort;
  frame: SnFrame;
  n: number;
  learn: SnLearn;
  movedFrom?: string;
  kind: SnKind;
  hit?: { port: string; type: "dynamic" | "static" };
  out: SnPort[];
}
export interface SnRx {
  host: SnHost;
  frame: SnFrame;
  n: number;
  accepted: boolean;
  /** Accepted by the NIC (same MAC) but the packet is for another host's IP. */
  wrongHost?: boolean;
}
export interface SnSnap {
  fdb: Record<SnSw, SnEntry[]>;
  counters: Record<string, SnCtr>;
}
export interface SnWave {
  k: number;
  hops: SnHop[];
  decisions: SnDecision[];
  rx: SnRx[];
  /** Frames that a host built and sent this wave (they ride `hops`). */
  sent: SnFrame[];
  snap: SnSnap;
}
export interface SnSend {
  from: SnHost;
  to: SnHost | "broadcast";
  /** Broadcast: an ARP request for this host's IP (it answers). */
  arpFor?: SnHost;
  /** Unicast: a ping (the destination answers). */
  reply?: boolean;
}
export interface SnResult {
  send: SnSend;
  frame: SnFrame;
  /** Copies the intended host accepted. */
  delivered: number;
  /** Copies some other host's NIC accepted (same MAC). */
  wrong: number;
  reply?: SnFrame;
  replyDelivered?: number;
  /** The frame never left the sender (link down / unplugged). */
  stuck?: boolean;
}
export interface SnRun {
  id: number;
  cmd: string;
  clock: number;
  waves: SnWave[];
  capFrom: number;
  results: SnResult[];
  /** Copies still on a link when the run's drawing ended (only with a loop). */
  left: number;
  /** Copies lost because their link went down. */
  lostOnLinks: number;
  moves: number;
  /** Moves that went straight back (flapping). */
  flaps: number;
  /** No new frame: the network kept forwarding copies already in flight. */
  background?: boolean;
  cfgSeq: number;
  /** Counters when the run began (what the run added = after − before). */
  before: Record<string, SnCtr>;
}
export interface SnCap {
  n: number;
  run: number;
  wave: number;
  /** "SW1 ge-0/0/23" or a host name. */
  point: string;
  dir: "in" | "out";
  frame: SnFrame;
  count: number;
}
export interface SnMove {
  sw: SnSw;
  mac: string;
  from: string;
  to: string;
  clock: number;
  run: number;
  wave: number;
  /** It came back from where it last went: back and forth. */
  flap: boolean;
}
export interface SnSyslog {
  clock: number;
  sw: SnSw;
  ev: "up" | "down" | "admin-down" | "flap" | "move";
  port?: string;
  mac?: string;
  from?: string;
  to?: string;
}
export interface SnLogLine {
  seq: number;
  text: string;
  tone: "info" | "ok" | "warn";
}
export type SnTicketId = "moved" | "uplink" | "static" | "dup-mac" | "loop";
export interface SnState {
  cfg: SnCfg;
  fdb: Record<SnSw, SnEntry[]>;
  counters: Record<string, SnCtr>;
  /** Lab clock, seconds. */
  clock: number;
  /** Copies on a link when the last run's drawing ended (a loop keeps them alive). */
  circ: SnHop[];
  captures: SnCap[];
  capN: number;
  moves: SnMove[];
  syslog: SnSyslog[];
  runs: SnRun[];
  last?: SnRun;
  seq: number;
  frameSeq: number;
  /** Bumped by every change to the network (configuration, cabling, cleared tables). */
  cfgSeq: number;
  log: SnLogLine[];
  ticket?: SnTicketId;
}

export const ctrKey = (dev: SnDev, port?: string) => (isSw(dev) ? `${dev} ${port}` : dev);
function emptyCounters(): Record<string, SnCtr> {
  const c: Record<string, SnCtr> = {};
  for (const sw of SN_SWITCHES) for (const p of SN_PORTS) c[`${sw} ${p}`] = { ...ZERO };
  for (const h of SN_HOSTS) c[h] = { ...ZERO };
  return c;
}
export function createSwitchNet(cfg: SnCfg = snHealthy()): SnState {
  return { cfg, fdb: { SW1: [], SW2: [] }, counters: emptyCounters(), clock: 0, circ: [], captures: [], capN: 0, moves: [], syslog: [], runs: [], seq: 0, frameSeq: 0, cfgSeq: 0, log: [{ seq: 0, text: "Lab ready: SW1 and SW2 tables empty · ge-0/0/23 up · ge-0/0/24 cabled but disabled on both switches · no loop prevention (STP off)", tone: "info" }] };
}

/** The switch's table as its CLI shows it: static entries, then learned ones (a learned entry never shadows a static). */
export function snTable(cfg: SnCfg, fdb: Record<SnSw, SnEntry[]>, sw: SnSw): SnEntry[] {
  const st = cfg.sw[sw].statics.map((x) => ({ mac: x.mac, port: x.port, type: "static" as const, seen: 0 }));
  return [...st, ...fdb[sw].filter((e) => !st.some((x) => x.mac === e.mac))].sort((a, b) => a.mac.localeCompare(b.mac));
}
export const snLookup = (cfg: SnCfg, fdb: Record<SnSw, SnEntry[]>, sw: SnSw, mac: string) => snTable(cfg, fdb, sw).find((e) => e.mac === mac);

// ---------------------------------------------------------------------------------------------------------------
// Frame labels (lesson words)
// ---------------------------------------------------------------------------------------------------------------
export const snShortMac = (m: string) => (m === BCAST ? "FF:FF:FF:FF:FF:FF" : `…${m.slice(-5)}`);
export function snFrameName(f: SnFrame): string {
  if (f.kind === "arp-req") return `ARP request (who has ${SN_IP[f.target!]}?)`;
  if (f.kind === "arp-rep") return "ARP reply";
  if (f.kind === "data-rep") return "ping reply";
  return f.wantReply ? "ping" : "frame";
}
export const snDstName = (cfg: SnCfg, f: SnFrame) => (f.dst === BCAST ? "broadcast" : snMacName(cfg, f.dst));

// ---------------------------------------------------------------------------------------------------------------
// The simulation
// ---------------------------------------------------------------------------------------------------------------
interface Work {
  s: SnState;
  fdb: Record<SnSw, SnEntry[]>;
  counters: Record<string, SnCtr>;
  captures: SnCap[];
  capN: number;
  moves: SnMove[];
  syslog: SnSyslog[];
  runId: number;
}
const cloneFdb = (f: Record<SnSw, SnEntry[]>) => ({ SW1: f.SW1.map((e) => ({ ...e })), SW2: f.SW2.map((e) => ({ ...e })) });
const cloneCtr = (c: Record<string, SnCtr>) => Object.fromEntries(Object.entries(c).map(([k, v]) => [k, { ...v }]));
const cap = (n: number) => Math.min(SN_MAX_COPIES, n);

function count(w: Work, h: SnHop, wave: number) {
  const b = h.frame.dst === BCAST;
  const tx = w.counters[ctrKey(h.from, h.fromPort)];
  const rx = w.counters[ctrKey(h.to, h.toPort)];
  tx.outF = cap(tx.outF + h.n);
  tx.outBytes = cap(tx.outBytes + h.n * h.frame.bytes);
  if (b) tx.outB = cap(tx.outB + h.n);
  if (h.lost) return;
  rx.inF = cap(rx.inF + h.n);
  rx.inBytes = cap(rx.inBytes + h.n * h.frame.bytes);
  if (b) rx.inB = cap(rx.inB + h.n);
  w.captures.push({ n: ++w.capN, run: w.runId, wave, point: isSw(h.from) ? `${h.from} ${h.fromPort}` : h.from, dir: "out", frame: h.frame, count: h.n });
  w.captures.push({ n: ++w.capN, run: w.runId, wave, point: isSw(h.to) ? `${h.to} ${h.toPort}` : h.to, dir: "in", frame: h.frame, count: h.n });
}

/** One switch, one group of copies arriving on one port. */
function bridge(w: Work, sw: SnSw, h: SnHop, wave: number): { d: SnDecision; next: SnHop[] } {
  const cfg = w.s.cfg;
  const port = h.toPort as SnPort;
  const f = h.frame;
  const statics = cfg.sw[sw].statics;
  let learn: SnLearn = "learned";
  let movedFrom: string | undefined;
  if (statics.some((x) => x.mac === f.src)) learn = "static";
  else {
    const prior = w.fdb[sw].find((e) => e.mac === f.src);
    if (prior && prior.port === port) {
      learn = "refreshed";
      prior.seen = w.s.clock;
    } else {
      if (prior) {
        learn = "moved";
        movedFrom = prior.port;
        const back = [...w.moves].reverse().find((m) => m.sw === sw && m.mac === f.src);
        const flap = !!back && back.from === port && back.to === prior.port;
        w.moves.push({ sw, mac: f.src, from: prior.port, to: port, clock: w.s.clock, run: w.runId, wave, flap });
        w.syslog.push({ clock: w.s.clock, sw, ev: flap ? "flap" : "move", mac: f.src, from: prior.port, to: port });
      }
      w.fdb[sw] = [...w.fdb[sw].filter((e) => e.mac !== f.src), { mac: f.src, port, type: "dynamic" as const, seen: w.s.clock }].sort((a, b) => a.mac.localeCompare(b.mac));
    }
  }
  const up = SN_PORTS.filter((p) => p !== port && snPortUp(cfg, sw, p));
  let kind: SnKind;
  let out: SnPort[] = [];
  let hit: SnDecision["hit"];
  if (f.dst === BCAST) {
    kind = "broadcast";
    out = up;
  } else {
    const e = snLookup(cfg, w.fdb, sw, f.dst);
    if (!e) {
      kind = "unknown";
      out = up;
    } else {
      hit = { port: e.port, type: e.type };
      if (e.port === port) kind = "filter";
      else if (!snPortUp(cfg, sw, e.port)) kind = "blackhole";
      else {
        kind = "known";
        out = [e.port];
      }
    }
  }
  const next = out.map((p) => {
    const peer = snPeer(cfg, sw, p)!;
    return { from: sw as SnDev, fromPort: p as string, to: peer.dev, toPort: peer.port, frame: f, n: h.n };
  });
  return { d: { sw, port, frame: f, n: h.n, learn, movedFrom, kind, hit, out }, next };
}

function merge(hops: SnHop[]): SnHop[] {
  const m = new Map<string, SnHop>();
  for (const h of hops) {
    const k = `${h.frame.id}|${h.from}|${h.fromPort}|${h.to}`;
    const prev = m.get(k);
    if (prev) prev.n = cap(prev.n + h.n);
    else m.set(k, { ...h });
  }
  return [...m.values()];
}

function buildFrame(s: SnState, w: { id: number }, x: SnSend): SnFrame {
  const id = ++w.id;
  const mac = s.cfg.hosts[x.from].mac;
  if (x.to === "broadcast") return { id, src: mac, dst: BCAST, kind: "arp-req", from: x.from, target: x.arpFor ?? (x.from === "HOST-A" ? "HOST-C" : "HOST-A"), bytes: 64 };
  return { id, src: mac, dst: s.cfg.hosts[x.to].mac, kind: "data", from: x.from, target: x.to, bytes: 128, wantReply: x.reply };
}

/** Run frames through the network (and any copies still in flight). Sends are injected one after the other, each once the previous exchange has gone quiet (or after SN_WAVES waves, if a loop never lets it). */
function simulate(s0: SnState, sends: SnSend[], cmd: string): SnState {
  const s: SnState = { ...s0, seq: s0.seq + 1 };
  const runId = s.seq;
  const w: Work = { s, fdb: cloneFdb(s.fdb), counters: cloneCtr(s.counters), captures: [...s.captures], capN: s.capN, moves: [...s.moves], syslog: [...s.syslog], runId };
  const ids = { id: s.frameSeq };
  const results: SnResult[] = [];
  const waves: SnWave[] = [];
  const queue = [...sends];
  let lostOnLinks = 0;
  let hops: SnHop[] = s.circ.filter((h) => {
    const ok = isSw(h.from) && snPortUp(s.cfg, h.from, h.fromPort);
    if (!ok) lostOnLinks += h.n;
    return ok;
  });
  const replied = new Set<number>();
  let sinceInject = 0;
  const inject = (): SnFrame | undefined => {
    const x = queue.shift();
    if (!x) return undefined;
    const f = buildFrame(s, ids, x);
    const at = s.cfg.hosts[x.from].at;
    const r: SnResult = { send: x, frame: f, delivered: 0, wrong: 0 };
    results.push(r);
    sinceInject = 0;
    if (!at || !snPortUp(s.cfg, at.sw, at.port)) {
      r.stuck = true;
      return f;
    }
    hops.push({ from: x.from, fromPort: "eth0", to: at.sw, toPort: at.port, frame: f, n: 1 });
    return f;
  };
  let sent: SnFrame[] = [];
  const first = inject();
  if (first) sent.push(first);
  for (let k = 0; k < 400; k++) {
    if (!hops.length) {
      if (!queue.length) break;
      const f = inject();
      if (f) sent.push(f);
      if (!hops.length) continue;
    }
    if (sinceInject >= SN_WAVES) {
      if (!queue.length) break;
      const f = inject();
      if (f) sent.push(f);
    }
    const wave: SnWave = { k: waves.length, hops, decisions: [], rx: [], sent, snap: { fdb: w.fdb, counters: w.counters } };
    sent = [];
    let next: SnHop[] = [];
    for (const h of hops) count(w, h, wave.k);
    // Hosts receive
    for (const h of hops.filter((x) => !isSw(x.to) && !x.lost)) {
      const host = h.to as SnHost;
      const nic = s.cfg.hosts[host];
      const accepted = h.frame.dst === BCAST || h.frame.dst === nic.mac;
      const meant = h.frame.target === host;
      const wrongHost = accepted && h.frame.dst !== BCAST && !meant;
      wave.rx.push({ host, frame: h.frame, n: h.n, accepted, wrongHost });
      const res = results.find((r) => r.frame.id === h.frame.id) ?? results.find((r) => r.reply?.id === h.frame.id);
      if (res && accepted) {
        if (res.frame.id === h.frame.id) {
          if (meant) res.delivered = cap(res.delivered + h.n);
          else if (wrongHost) res.wrong = cap(res.wrong + h.n);
        } else if (meant) res.replyDelivered = cap((res.replyDelivered ?? 0) + h.n);
      }
      // Answers: ARP request for my IP, or a ping to me.
      const asks = (h.frame.kind === "arp-req" && meant) || (h.frame.kind === "data" && h.frame.wantReply && meant && accepted);
      if (asks && !replied.has(h.frame.id) && h.frame.from !== host) {
        replied.add(h.frame.id);
        const at = nic.at;
        // The reply is meant for the host that asked (whatever port its MAC is learned on).
        const rep: SnFrame = { id: ++ids.id, src: nic.mac, dst: h.frame.src, kind: h.frame.kind === "arp-req" ? "arp-rep" : "data-rep", from: host, target: h.frame.from, bytes: h.frame.kind === "arp-req" ? 64 : 128, answers: h.frame.id };
        if (res && res.frame.id === h.frame.id) res.reply = rep;
        if (at && snPortUp(s.cfg, at.sw, at.port)) {
          next.push({ from: host, fromPort: "eth0", to: at.sw, toPort: at.port, frame: rep, n: 1 });
          sent = [...sent, rep];
        }
      }
    }
    // Switches: SW1 then SW2, each in port order (simultaneous arrivals are timing-dependent on real hardware).
    for (const sw of SN_SWITCHES) {
      const here = hops.filter((x) => x.to === sw && !x.lost).sort((a, b) => portIdx(a.toPort) - portIdx(b.toPort) || a.frame.id - b.frame.id);
      for (const h of here) {
        const r = bridge(w, sw, h, wave.k);
        wave.decisions.push(r.d);
        next = next.concat(r.next);
      }
    }
    wave.snap = { fdb: cloneFdb(w.fdb), counters: cloneCtr(w.counters) };
    waves.push(wave);
    hops = merge(next);
    sinceInject++;
    if (!queue.length && sinceInject >= SN_WAVES) break;
  }
  const left = hops.filter((h) => isSw(h.to)).reduce((a, h) => a + h.n, 0);
  const runMoves = w.moves.length - s.moves.length;
  const run: SnRun = { id: runId, cmd, clock: s.clock, waves, capFrom: s.capN + 1, results, left: cap(left), lostOnLinks, moves: runMoves, flaps: w.moves.slice(s.moves.length).filter((m) => m.flap).length, background: !sends.length, cfgSeq: s.cfgSeq, before: s.counters };
  const captures = w.captures.length > 1500 ? w.captures.slice(-1500) : w.captures;
  const lines: SnLogLine[] = [];
  for (const r of results) lines.push({ seq: runId, text: resultText(s.cfg, r), tone: r.delivered && (!r.send.reply && r.send.to !== "broadcast" ? true : r.replyDelivered || r.send.to === "broadcast") ? "ok" : "warn" });
  if (left) lines.push({ seq: runId, text: `${left === SN_MAX_COPIES ? "≥" : ""}${left.toLocaleString("en-US")} cop${left === 1 ? "y" : "ies"} still circulating between SW1 and SW2 — nothing in an Ethernet frame stops them`, tone: "warn" });
  if (runMoves) lines.push({ seq: runId, text: `${runMoves} MAC move${runMoves === 1 ? "" : "s"} during this run`, tone: "warn" });
  return { ...s, fdb: w.fdb, counters: w.counters, captures, capN: w.capN, moves: w.moves.slice(-400), syslog: w.syslog.slice(-400), circ: hops, runs: [...s.runs.slice(-30), run], last: run, frameSeq: ids.id, log: [...s.log, { seq: runId, text: cmd, tone: "info" }, ...lines] };
}

export function resultText(cfg: SnCfg, r: SnResult): string {
  const to = r.send.to === "broadcast" ? `broadcast (ARP for ${r.send.arpFor ?? r.frame.target})` : r.send.to;
  if (r.stuck) return `${r.send.from} → ${to}: never left ${r.send.from} — its link is down`;
  if (r.send.to === "broadcast") return `${r.send.from} → ${to}: ${r.delivered ? `${r.frame.target} got it${r.delivered > 1 ? ` (${r.delivered} copies)` : ""}` : `${r.frame.target} never got it`}${r.reply ? ` · ARP reply ${r.replyDelivered ? "reached" : "never reached"} ${r.send.from}` : ""}`;
  const main = r.delivered ? `delivered${r.delivered > 1 ? ` (${r.delivered} copies)` : ""}` : r.wrong ? `NOT delivered — ${r.wrong} cop${r.wrong > 1 ? "ies" : "y"} accepted by another NIC using ${snShortMac(r.frame.dst)}` : "NOT delivered";
  return `${r.send.from} → ${to}: ${main}${r.send.reply ? (r.reply ? ` · reply ${r.replyDelivered ? "came back" : "never came back"}` : r.delivered ? "" : " · no reply") : ""}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------------------------------------------
export type SnAction =
  | { type: "traffic"; sends: SnSend[]; cmd?: string }
  | { type: "run" }
  | { type: "wait"; seconds: number }
  | { type: "clear"; sw: SnSw; mac?: string; port?: string; text?: string }
  | { type: "clear-counters"; sw?: SnSw }
  | { type: "cfg"; cfg: SnCfg; text: string }
  | { type: "move"; host: SnHost; to?: SnAttach; text?: string }
  | { type: "ticket"; id: SnTicketId }
  | { type: "fresh" };

const sendText = (x: SnSend) => (x.to === "broadcast" ? `${x.from} broadcasts an ARP request for ${x.arpFor ?? "?"}` : `${x.from} ${x.reply ? "pings" : "sends a frame to"} ${x.to}`);
export const snSendCmd = (sends: SnSend[]) => sends.map(sendText).join(", then ");

/** Apply a change of configuration or cabling: links that went down flush what was learned on them, and are logged. */
function applyCfg(s: SnState, cfg: SnCfg, text: string): SnState {
  const fdb = cloneFdb(s.fdb);
  const syslog = [...s.syslog];
  const notes: string[] = [];
  for (const sw of SN_SWITCHES)
    for (const p of SN_PORTS) {
      const was = snPortUp(s.cfg, sw, p);
      const now = snPortUp(cfg, sw, p);
      if (was && !now) {
        const gone = fdb[sw].filter((e) => e.port === p);
        fdb[sw] = fdb[sw].filter((e) => e.port !== p);
        syslog.push({ clock: s.clock, sw, ev: snShut(cfg, sw, p) ? "admin-down" : "down", port: p });
        notes.push(`${sw} ${p} went down${gone.length ? ` — flushed ${gone.map((e) => snMacName(cfg, e.mac)).join(", ")}` : ""}`);
      } else if (!was && now) {
        syslog.push({ clock: s.clock, sw, ev: "up", port: p });
        notes.push(`${sw} ${p} came up (a link coming up teaches the switch nothing until frames arrive)`);
      }
    }
  // A static entry replaces any learned entry for that MAC.
  for (const sw of SN_SWITCHES) fdb[sw] = fdb[sw].filter((e) => !cfg.sw[sw].statics.some((x) => x.mac === e.mac));
  const seq = s.seq + 1;
  return { ...s, cfg, fdb, syslog, seq, cfgSeq: s.cfgSeq + 1, log: [...s.log, { seq, text, tone: "info" }, ...notes.map((t) => ({ seq, text: t, tone: "warn" as const }))] };
}
function tick(s: SnState, seconds: number): SnState {
  const clock = s.clock + seconds;
  const fdb = cloneFdb(s.fdb);
  const notes: string[] = [];
  for (const sw of SN_SWITCHES) {
    const aging = s.cfg.sw[sw].aging;
    const gone = fdb[sw].filter((e) => clock - e.seen >= aging);
    if (gone.length) notes.push(`${sw}: ${gone.map((e) => snMacName(s.cfg, e.mac)).join(", ")} aged out (${aging} s without a frame from ${gone.length > 1 ? "them" : "it"})`);
    fdb[sw] = fdb[sw].filter((e) => clock - e.seen < aging);
  }
  return { ...s, clock, fdb, log: [...s.log, ...notes.map((t) => ({ seq: s.seq, text: t, tone: "warn" as const }))] };
}
/** Copies travelling between the switches right now (a loop keeps them alive). */
export const snCirculating = (s: Pick<SnState, "circ">) => s.circ.filter((h) => isSw(h.to)).reduce((a, h) => a + h.n, 0);
/** Whatever else happens, copies already in flight keep moving. */
const keepForwarding = (s: SnState, why: string) => (s.circ.length ? simulate(s, [], why) : s);

export function snApply(s0: SnState, a: SnAction): SnState {
  if (a.type === "fresh") return { ...createSwitchNet(), seq: s0.seq + 1 };
  if (a.type === "ticket") return snTicketState(a.id, s0.seq + 1);
  let s = tick(s0, a.type === "wait" ? a.seconds : 1);
  switch (a.type) {
    case "traffic":
      return simulate(s, a.sends, a.cmd ?? snSendCmd(a.sends));
    case "run":
      return s.circ.length ? simulate(s, [], "Let the network keep forwarding") : { ...s, log: [...s.log, { seq: s.seq, text: "Nothing is in flight: every frame has been delivered or discarded", tone: "info" }] };
    case "wait":
      s = { ...s, log: [...s.log, { seq: s.seq, text: `Waited ${a.seconds} s (lab clock ${s.clock} s)`, tone: "info" }] };
      return keepForwarding(s, `${a.seconds} s later — the loop never paused (the lab shows its last ${SN_WAVES} hops)`);
    case "clear": {
      const fdb = cloneFdb(s.fdb);
      const gone = fdb[a.sw].filter((e) => (!a.mac || e.mac === a.mac) && (!a.port || e.port === a.port));
      fdb[a.sw] = fdb[a.sw].filter((e) => !gone.includes(e));
      const seq = s.seq + 1;
      s = { ...s, fdb, seq, cfgSeq: s.cfgSeq + 1, log: [...s.log, { seq, text: a.text ?? `${a.sw}: cleared ${gone.length ? gone.map((e) => snMacName(s.cfg, e.mac)).join(", ") : "nothing (no matching learned entry)"} — ${other(a.sw)} keeps its own table`, tone: "warn" }] };
      return keepForwarding(s, "Meanwhile the copies already in flight keep moving");
    }
    case "clear-counters": {
      const counters = cloneCtr(s.counters);
      for (const k of Object.keys(counters)) if (!a.sw || k.startsWith(`${a.sw} `)) counters[k] = { ...ZERO };
      return { ...s, counters, log: [...s.log, { seq: s.seq, text: `Counters cleared${a.sw ? ` on ${a.sw}` : ""}`, tone: "info" }] };
    }
    case "cfg":
      return keepForwarding(applyCfg(s, a.cfg, a.text), "The copies still in flight keep moving on whatever links are left");
    case "move": {
      const cfg = snCloneCfg(s.cfg);
      cfg.hosts[a.host].at = a.to;
      return keepForwarding(applyCfg(s, cfg, a.text ?? (a.to ? `${a.host} is now plugged into ${a.to.sw} ${a.to.port}` : `${a.host} unplugged`)), "Meanwhile the copies already in flight keep moving");
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Tickets — the same network with ONE real thing wrong, reached through normal traffic first (tables are learned, not typed)
// ---------------------------------------------------------------------------------------------------------------
export interface SnTicket {
  id: SnTicketId;
  title: string;
  report: string;
  repro: SnSend[];
  reproLabel: string;
  cause: SnCause;
}
export type SnCause = "second-link" | "stale" | "uplink-down" | "static" | "dup-mac" | "sync" | "ttl" | "full";
export const SN_CAUSES: { id: SnCause; label: string }[] = [
  { id: "stale", label: "A switch still points a MAC at the port where that host used to be (stale entry)" },
  { id: "uplink-down", label: "The SW1↔SW2 uplink is down, so frames can't cross between the switches" },
  { id: "static", label: "A configured (static) MAC entry sends the frames out the wrong port" },
  { id: "dup-mac", label: "Two devices are using the same MAC address" },
  { id: "second-link", label: "Two active SW1↔SW2 paths with no loop prevention: a Layer-2 loop" },
  { id: "sync", label: "SW1 and SW2 haven't synchronized their MAC tables yet" },
  { id: "ttl", label: "The frames' TTL runs out between the switches" },
  { id: "full", label: "A MAC table is full, so the switch can't learn" },
];
export const SN_TICKETS: SnTicket[] = [
  { id: "moved", title: "The printer moved floors", report: "“Facilities moved HOST-D (a printer that only answers, never starts a conversation) from floor 1 to floor 2 this morning — SW2, port ge-0/0/3. Since then HOST-B can't reach it. It was fine yesterday.”", repro: [{ from: "HOST-B", to: "HOST-D", reply: true }], reproLabel: "HOST-B pings HOST-D", cause: "stale" },
  { id: "uplink", title: "Floor 1 can't reach floor 2", report: "“Since last night's maintenance window, nobody on SW1 can reach anyone on SW2. People on the same floor can still work together.”", repro: [{ from: "HOST-A", to: "HOST-C", reply: true }], reproLabel: "HOST-A pings HOST-C", cause: "uplink-down" },
  { id: "static", title: "HOST-C is unreachable from HOST-A", report: "“HOST-A can't reach HOST-C. Odd detail: HOST-D's owner says their capture shows frames addressed to HOST-C arriving at HOST-D.”", repro: [{ from: "HOST-A", to: "HOST-C", reply: true }], reproLabel: "HOST-A pings HOST-C", cause: "static" },
  { id: "dup-mac", title: "HOST-A keeps dropping off", report: "“HOST-A works, then stops answering, then works again. A new virtual machine (HOST-E) was cloned and started on floor 2 this morning.”", repro: [{ from: "HOST-A", to: "HOST-B", reply: true }, { from: "HOST-E", to: "broadcast", arpFor: "HOST-B" }, { from: "HOST-D", to: "HOST-A", reply: true }, { from: "HOST-A", to: "HOST-B", reply: true }], reproLabel: "A normal minute of traffic (A, E and D talking)", cause: "dup-mac" },
  { id: "loop", title: "Everything crawls since “redundancy” was added", report: "“Someone enabled the second cable between the floors (ge-0/0/24) for redundancy. Since then the whole network crawls, the switch port lights flash non-stop, and nobody can reach anybody reliably.”", repro: [{ from: "HOST-A", to: "broadcast", arpFor: "HOST-C" }], reproLabel: "HOST-A asks who has HOST-C (ARP broadcast)", cause: "second-link" },
];
export const snTicket = (id: SnTicketId) => SN_TICKETS.find((t) => t.id === id)!;

/** Normal traffic that makes every switch learn every host, as on any working morning. */
const WARMUP: SnSend[] = [
  { from: "HOST-A", to: "broadcast", arpFor: "HOST-C" },
  { from: "HOST-A", to: "HOST-C", reply: true },
  { from: "HOST-D", to: "broadcast", arpFor: "HOST-B" },
  { from: "HOST-D", to: "HOST-B", reply: true },
];
function warm(): SnState {
  let s = createSwitchNet();
  s = simulate(s, WARMUP, "Morning traffic");
  return s;
}
/** Evidence starts clean at the beginning of the ticket: no old runs, captures, counters or log lines — tables keep what normal traffic taught them. */
const shift = (s: SnState, seq: number, ticket: SnTicketId, text: string): SnState => ({ ...s, seq, ticket, runs: [], last: undefined, captures: [], capN: 0, counters: emptyCounters(), moves: [], syslog: [], circ: [], clock: s.clock + 60, log: [{ seq, text, tone: "info" }] });

export function snTicketState(id: SnTicketId, seq: number): SnState {
  let s = warm();
  if (id === "moved") {
    const cfg = snCloneCfg(s.cfg);
    cfg.hosts["HOST-D"].at = { sw: "SW2", port: "ge-0/0/3" };
    s = applyCfg(s, cfg, "HOST-D moved to SW2 ge-0/0/3");
  } else if (id === "uplink") {
    const cfg = snCloneCfg(s.cfg);
    cfg.sw.SW2.shut = [...cfg.sw.SW2.shut, "ge-0/0/23"];
    s = applyCfg(s, cfg, "maintenance");
  } else if (id === "static") {
    const cfg = snCloneCfg(s.cfg);
    cfg.sw.SW1.statics = [{ mac: SN_MAC["HOST-C"], port: "ge-0/0/2" }];
    s = applyCfg(s, cfg, "old static entry");
  } else if (id === "dup-mac") {
    const cfg = snCloneCfg(s.cfg);
    cfg.hosts["HOST-E"] = { mac: SN_MAC["HOST-A"], at: { sw: "SW2", port: "ge-0/0/3" } };
    s = applyCfg(s, cfg, "HOST-E started");
  } else {
    const cfg = snCloneCfg(s.cfg);
    cfg.sw.SW1.shut = [];
    cfg.sw.SW2.shut = [];
    s = applyCfg(s, cfg, "ge-0/0/24 enabled on both switches");
  }
  return { ...shift(s, seq, id, `Ticket opened: ${snTicket(id).title}`), cfgSeq: 0 };
}

/** The latest run of the ticket's own test, if any (ran after the ticket opened). */
export function snLastRepro(s: SnState): SnRun | undefined {
  if (!s.ticket) return undefined;
  const t = snTicket(s.ticket);
  return [...s.runs].reverse().find((r) => !r.background && r.results.length === t.repro.length && r.results.every((x, i) => x.send.from === t.repro[i].from && x.send.to === t.repro[i].to));
}
export interface SnProof {
  label: string;
  ok: boolean;
  detail: string;
}
const okRes = (r?: SnResult) => !!r && r.delivered === 1 && (!r.send.reply || r.replyDelivered === 1) && !r.wrong;
export function snProofs(s: SnState): SnProof[] {
  if (!s.ticket) return [];
  const run = snLastRepro(s);
  const fresh = !!run && run.cfgSeq === s.cfgSeq;
  const c = s.cfg;
  const tbl = (sw: SnSw, h: SnHost) => snLookup(c, s.fdb, sw, c.hosts[h].mac);
  const test = (label: string, pick: (r: SnRun) => boolean, detail: string): SnProof => ({ label, ok: !!run && fresh && pick(run), detail: !run ? "not run yet" : !fresh ? "the network changed since the last test — run it again" : detail });
  switch (s.ticket) {
    case "moved":
      return [
        test("A fresh test: HOST-B pings HOST-D and the reply comes back", (r) => okRes(r.results[0]), run ? resultText(c, run.results[0]) : ""),
        { label: "SW2 points HOST-D at ge-0/0/3, where it is plugged in", ok: tbl("SW2", "HOST-D")?.port === "ge-0/0/3", detail: `SW2: HOST-D → ${tbl("SW2", "HOST-D")?.port ?? "no entry"}` },
        { label: "SW1 doesn't point HOST-D at a wrong port (no entry, or its uplink ge-0/0/23)", ok: !tbl("SW1", "HOST-D") || tbl("SW1", "HOST-D")?.port === "ge-0/0/23", detail: `SW1: HOST-D → ${tbl("SW1", "HOST-D")?.port ?? "no entry"}` },
      ];
    case "uplink":
      return [
        { label: "ge-0/0/23 is up on both switches", ok: snPortUp(c, "SW1", "ge-0/0/23"), detail: `SW1 ${snPortStatus(c, "SW1", "ge-0/0/23")} · SW2 ${snPortStatus(c, "SW2", "ge-0/0/23")}` },
        test("A fresh test: HOST-A pings HOST-C and the reply comes back", (r) => okRes(r.results[0]), run ? resultText(c, run.results[0]) : ""),
        { label: "SW2 has learned HOST-A behind its uplink", ok: tbl("SW2", "HOST-A")?.port === "ge-0/0/23", detail: `SW2: HOST-A → ${tbl("SW2", "HOST-A")?.port ?? "no entry"}` },
      ];
    case "static":
      return [
        { label: "No wrong static entry for HOST-C on SW1", ok: !c.sw.SW1.statics.some((x) => x.mac === SN_MAC["HOST-C"] && x.port !== "ge-0/0/23"), detail: c.sw.SW1.statics.length ? c.sw.SW1.statics.map((x) => `${snMacName(c, x.mac)} → ${x.port} (static)`).join(", ") : "no static entries" },
        test("A fresh test: HOST-A pings HOST-C and the reply comes back", (r) => okRes(r.results[0]), run ? resultText(c, run.results[0]) : ""),
        { label: "SW1 has learned HOST-C behind its uplink (ge-0/0/23)", ok: tbl("SW1", "HOST-C")?.port === "ge-0/0/23" && tbl("SW1", "HOST-C")?.type === "dynamic", detail: `SW1: HOST-C → ${tbl("SW1", "HOST-C")?.port ?? "no entry"}${tbl("SW1", "HOST-C")?.type === "static" ? " (static)" : ""}` },
      ];
    case "dup-mac": {
      const macs = SN_HOSTS.filter((h) => snHostLinkUp(c, h)).map((h) => c.hosts[h].mac);
      return [
        { label: "No two connected devices share a MAC", ok: new Set(macs).size === macs.length, detail: new Set(macs).size === macs.length ? "every connected NIC has its own MAC" : "HOST-A and HOST-E both use 00:11:22:33:55:0A" },
        test("A fresh minute of traffic: HOST-D reaches HOST-A, replies come back", (r) => r.results.every((x) => x.send.to === "broadcast" || okRes(x)) && !r.results.some((x) => x.wrong), run ? run.results.filter((x) => x.send.to !== "broadcast").map((x) => resultText(c, x)).join(" · ") : ""),
        test("No MAC moved between ports during that test", (r) => r.moves === 0, run ? `${run.moves} move(s)` : ""),
      ];
    }
    case "loop":
      return [
        { label: "Only one SW1↔SW2 path is forwarding", ok: snActiveUplinks(c).length === 1, detail: `forwarding: ${snActiveUplinks(c).join(", ") || "none"}` },
        { label: "No copies are left circulating", ok: s.circ.length === 0, detail: s.circ.length ? `${snCirculating(s)} still in flight` : "none in flight" },
        test("A fresh broadcast: every host gets exactly one copy, HOST-C answers", (r) => !r.left && SN_HOSTS.filter((h) => snHostLinkUp(c, h) && h !== "HOST-A").every((h) => r.waves.flatMap((wv) => wv.rx).filter((x) => x.host === h).reduce((a, x) => a + x.n, 0) === 1) && r.results[0].replyDelivered === 1, run ? `${resultText(c, run.results[0])}${run.left ? ` · ${run.left} still circulating` : ""}` : ""),
        test("No MAC flapped between ports during that test", (r) => r.flaps === 0, run ? `${run.flaps} flap(s)${run.moves ? ` · ${run.moves} entr${run.moves > 1 ? "ies" : "y"} corrected once` : ""}` : ""),
      ];
  }
}

/** Feedback on a diagnosis, from the evidence in this network (never just "wrong"). */
export function snCauseFeedback(s: SnState, cause: SnCause): { right: boolean; text: string } {
  const c = s.cfg;
  const t = s.ticket ? snTicket(s.ticket) : undefined;
  const right = !!t && t.cause === cause;
  const where = (sw: SnSw, h: SnHost) => snLookup(c, s.fdb, sw, c.hosts[h].mac)?.port ?? "no entry";
  const flaps = s.moves.length;
  const circ = snCirculating(s);
  const ups = snActiveUplinks(c);
  const text: Record<SnCause, string> = {
    stale: right ? `Yes. HOST-D is plugged into SW2 ge-0/0/3, but SW2 kept its old entry HOST-D → ge-0/0/23 (its uplink): it learned that when HOST-D's frames used to arrive from SW1, and a silent host never sends a frame to correct it. SW1 flushed HOST-D when ge-0/0/2 went down, so the frame SW2 sends up the uplink is flooded at SW1 — away from HOST-D.` : `Compare each switch's entries with where the hosts are plugged in: ${SN_HOSTS.filter((h) => c.hosts[h].at).map((h) => `${h} on ${c.hosts[h].at!.sw} ${c.hosts[h].at!.port}`).join(", ")}. SW1 says HOST-A → ${where("SW1", "HOST-A")}, HOST-C → ${where("SW1", "HOST-C")}; SW2 says HOST-A → ${where("SW2", "HOST-A")}, HOST-C → ${where("SW2", "HOST-C")}. ${s.ticket === "moved" ? "" : "Nothing points at a port its host has left."}`,
    "uplink-down": right ? `Yes. SW2 ge-0/0/23 is administratively shut (show interfaces status: disabled), so SW1's end is notconnect. Frames from SW1 hosts are flooded on SW1 only — the uplink counters don't move and SW2 never learns them.` : `The uplink is ${snPortUp(c, "SW1", "ge-0/0/23") ? "up on both ends (connected)" : "down"}${ups.length > 1 ? ` — and so is ${ups.filter((p) => p !== "ge-0/0/23").join(", ")}` : ""}. ${snPortUp(c, "SW1", "ge-0/0/23") ? "Frames do cross it: look at the ge-0/0/23 counters and at what SW2 learned behind it." : ""}`,
    static: right ? `Yes. SW1's table shows HOST-C → ge-0/0/2 as STATIC (show mac address-table static / show running-config). Static entries win over learning, so SW1 sends every frame for HOST-C to HOST-D's port — and never relearns HOST-C from its own frames arriving on ge-0/0/23. HOST-C → HOST-A still works: that direction doesn't use the entry.` : `${SN_SWITCHES.some((sw) => c.sw[sw].statics.length) ? `There are static entries (${SN_SWITCHES.flatMap((sw) => c.sw[sw].statics.map((x) => `${sw}: ${snMacName(c, x.mac)} → ${x.port}`)).join(", ")}) — check whether they match where the hosts are.` : "Neither switch has a static entry: every entry in both tables is DYNAMIC (learned)."}`,
    "dup-mac": right ? `Yes. HOST-E (SW2 ge-0/0/3) uses 00:11:22:33:55:0A — HOST-A's MAC. Each time either one sends, both switches move that MAC to the new port (SW1: ge-0/0/1 ↔ ge-0/0/23; SW2: ge-0/0/23 ↔ ge-0/0/3), and frames for HOST-A go wherever the last sender was. Not a loop: broadcasts arrive once, nothing circulates, counters are normal.` : `${flaps ? `MACs did move (${flaps} move${flaps > 1 ? "s" : ""}), so ask why: ${circ ? "copies are circulating — a loop also moves MACs" : "nothing circulates and broadcasts arrive once, so it's not a loop"}.` : "No MAC moved between ports, so no two senders are fighting over one MAC."} Connected NICs: ${SN_HOSTS.filter((h) => snHostLinkUp(c, h)).map((h) => `${h} ${snShortMac(c.hosts[h].mac)}`).join(", ")}.`,
    "second-link": right ? `Yes. ${ups.join(" and ")} both forward between SW1 and SW2 and nothing blocks one of them (no STP). Every flooded frame goes out both uplinks and each copy comes back on the other one — forever: ${(snLastRepro(s)?.left ?? circ).toLocaleString("en-US")} copies were still in flight after your test, every host received the same broadcast many times, and MACs flap between the two uplinks.` : `${ups.length > 1 ? "There are two forwarding uplinks — but check whether the symptom matches a loop." : `Only ${ups[0] ?? "no"} uplink forwards between SW1 and SW2${c.cables["ge-0/0/24"] ? " (ge-0/0/24 is cabled but disabled)" : ""}: there is no second path.`} ${circ ? "" : "Nothing is circulating, and each broadcast reached each host once."}`,
    sync: "Switches never synchronize MAC tables — there is no such mechanism in Ethernet. Each switch learns only from the source MAC of frames arriving on its own ports, so different contents in SW1 and SW2 are normal. The question is whether each entry is RIGHT for where the host is now.",
    ttl: "Ethernet frames have no TTL. Switches forward a frame unchanged; only routers decrement the IP TTL — and there is no router in this broadcast domain. (That is exactly why a Layer-2 loop never dies on its own.)",
    full: `The tables hold ${snTable(c, s.fdb, "SW1").length} (SW1) and ${snTable(c, s.fdb, "SW2").length} (SW2) entries — a real switch has room for thousands (show mac address-table count). They are not full.`,
  };
  return { right, text: text[cause] };
}
