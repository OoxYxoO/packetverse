/**
 * STP Lab network — three switches cabled in a triangle (the STP/RSTP lesson's network), one host on each, a spare
 * port on SW3 where a "small switch" can be plugged in, and everything an engineer can change about spanning tree.
 *
 *   SW1 ge-0/0/1 ── SW2 ge-0/0/1   (L12)        HOST-A — SW1 ge-0/0/10
 *   SW1 ge-0/0/2 ── SW3 ge-0/0/1   (L13)        HOST-B — SW2 ge-0/0/10
 *   SW2 ge-0/0/2 ── SW3 ge-0/0/2   (L23)        HOST-C — SW3 ge-0/0/10
 *                                               ROGUE  — SW3 ge-0/0/11 (only when plugged in)
 *
 * The control plane is COMPUTED from the configuration, as the converged result of IEEE 802.1D-2004 RSTP (or legacy
 * 802.1D STP): Bridge ID = priority + MAC; the lowest is root; every other bridge's Root Port is the port with the
 * lowest root path cost (the sum of the costs of the RECEIVING ports along the path), ties broken by the lowest
 * neighbor Bridge ID, then the lowest neighbor Port ID, then the lowest own Port ID; on each segment the bridge with
 * the better {root cost, Bridge ID, Port ID} owns the Designated port and the other end is Alternate (Discarding).
 *
 * Timing is modeled where it changes what works: a port that newly needs to forward does so
 *   - at once: edge ports, an RSTP Alternate port taking over as Root Port, an RSTP Designated port whose RSTP
 *     neighbor agrees (proposal/agreement);
 *   - after 2 × forward delay (30 s: Discarding/Listening 15 s, then Learning 15 s): legacy STP ports, and RSTP ports
 *     with no RSTP neighbor to agree (a host port that isn't edge, a port toward a bridge that sends no BPDUs);
 *   - plus max age (20 s) when a legacy bridge loses its root information indirectly.
 * Guards: an edge port that hears BPDUs stops being edge — unless BPDU guard err-disables it; root guard refuses to let
 * a port become Root Port (it is held "root-inconsistent", Discarding). A port taken out of spanning tree (Cisco
 * bpdufilter, Junos `rstp interface … disable`) forwards and sends/hears no BPDUs. A topology change flushes MAC
 * entries learned on non-edge ports.
 *
 * The data plane is simulated hop by hop over the forwarding ports (learning, flooding, filtering), so a loop really
 * loops: copies circulate, MACs flap, hosts receive duplicates. All lab-only; nothing here touches lesson progress.
 */

export type StSw = "SW1" | "SW2" | "SW3";
export type StBridge = StSw | "ROGUE";
export type StHost = "HOST-A" | "HOST-B" | "HOST-C";
export type StDev = StBridge | StHost;
export type StLink = "L12" | "L13" | "L23";
export const ST_SWITCHES: StSw[] = ["SW1", "SW2", "SW3"];
export const ST_HOSTS: StHost[] = ["HOST-A", "HOST-B", "HOST-C"];
export const ST_LINKS: StLink[] = ["L12", "L13", "L23"];
export const ST_PORTS = ["ge-0/0/1", "ge-0/0/2", "ge-0/0/10", "ge-0/0/11"] as const;
export type StPort = (typeof ST_PORTS)[number];
export const BCAST = "FF:FF:FF:FF:FF:FF";
export const BPDU_MAC = "01:80:C2:00:00:00";
export const ST_AGING = 300;
export const FWD_DELAY = 15;
export const MAX_AGE = 20;
export const DEFAULT_COST = 20000;
export const ROGUE_PRIORITY = 4096;
export const isSw = (d: string): d is StSw => d === "SW1" || d === "SW2" || d === "SW3";
export const isBridge = (d: string): d is StBridge => isSw(d) || d === "ROGUE";
export const isHost = (d: string): d is StHost => d.startsWith("HOST-");
export const BRIDGE_MAC: Record<StBridge, string> = { SW1: "00:00:5E:00:53:01", SW2: "00:00:5E:00:53:02", SW3: "00:00:5E:00:53:03", ROGUE: "00:00:5E:00:53:99" };
export const HOST_MAC: Record<StHost, string> = { "HOST-A": "00:11:22:33:77:0A", "HOST-B": "00:11:22:33:77:0B", "HOST-C": "00:11:22:33:77:0C" };
export const HOST_IP: Record<StHost, string> = { "HOST-A": "192.168.70.10", "HOST-B": "192.168.70.20", "HOST-C": "192.168.70.30" };
export const HOST_SW: Record<StHost, StSw> = { "HOST-A": "SW1", "HOST-B": "SW2", "HOST-C": "SW3" };
export const HOST_PORT = "ge-0/0/10";
export const SPARE = "ge-0/0/11";
export const LINK_ENDS: Record<StLink, [StSw, StPort, StSw, StPort]> = { L12: ["SW1", "ge-0/0/1", "SW2", "ge-0/0/1"], L13: ["SW1", "ge-0/0/2", "SW3", "ge-0/0/1"], L23: ["SW2", "ge-0/0/2", "SW3", "ge-0/0/2"] };
/** Port number (for the Port ID 128.N) of each port. */
export const PORT_NUM: Record<StPort, number> = { "ge-0/0/1": 1, "ge-0/0/2": 2, "ge-0/0/10": 10, "ge-0/0/11": 11 };
export const PORT_PRI = 128;
export const portId = (p: string) => PORT_PRI * 4096 + (PORT_NUM[p as StPort] ?? 1);
export const portIdText = (p: string) => `${PORT_PRI}.${PORT_NUM[p as StPort] ?? 1}`;
export const pk = (dev: string, port: string) => `${dev} ${port}`;

// ---------------------------------------------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------------------------------------------
export type StProto = "rstp" | "stp" | "none";
export interface StPortCfg {
  cost: number;
  edge: boolean;
  bpduGuard: boolean;
  rootGuard: boolean;
  /** Taken out of spanning tree (Cisco bpdufilter / Junos rstp interface … disable). */
  stpOff: boolean;
  shut: boolean;
}
export interface StSwCfg {
  proto: StProto;
  priority: number;
  ports: Record<StPort, StPortCfg>;
}
export interface StCfg {
  sw: Record<StSw, StSwCfg>;
  links: Record<StLink, boolean>;
  /** Host cables plugged in. */
  hosts: Record<StHost, boolean>;
  /** The small switch plugged into SW3 ge-0/0/11. */
  rogue: boolean;
}
const port = (o: Partial<StPortCfg> = {}): StPortCfg => ({ cost: DEFAULT_COST, edge: false, bpduGuard: false, rootGuard: false, stpOff: false, shut: false, ...o });
const swCfg = (priority: number): StSwCfg => ({ proto: "rstp", priority, ports: { "ge-0/0/1": port(), "ge-0/0/2": port(), "ge-0/0/10": port({ edge: true }), "ge-0/0/11": port({ edge: true }) } });
export function stHealthy(): StCfg {
  return { sw: { SW1: swCfg(24576), SW2: swCfg(32768), SW3: swCfg(32768) }, links: { L12: true, L13: true, L23: true }, hosts: { "HOST-A": true, "HOST-B": true, "HOST-C": true }, rogue: false };
}
export const stClone = <T>(c: T): T => JSON.parse(JSON.stringify(c)) as T;

// ---------------------------------------------------------------------------------------------------------------
// Physical layer
// ---------------------------------------------------------------------------------------------------------------
export function stPeer(cfg: StCfg, sw: StSw, p: string): { dev: StDev; port: string; link?: StLink } | undefined {
  for (const l of ST_LINKS) {
    const [a, ap, b, bp] = LINK_ENDS[l];
    if (!cfg.links[l]) continue;
    if (a === sw && ap === p) return { dev: b, port: bp, link: l };
    if (b === sw && bp === p) return { dev: a, port: ap, link: l };
  }
  if (p === HOST_PORT) {
    const h = ST_HOSTS.find((x) => HOST_SW[x] === sw);
    return h && cfg.hosts[h] ? { dev: h, port: "eth0" } : undefined;
  }
  if (p === SPARE && sw === "SW3" && cfg.rogue) return { dev: "ROGUE", port: "ge-0/0/1" };
  return undefined;
}
/** Physically up: cable present, both ends enabled and not err-disabled. */
export function stPortUp(cfg: StCfg, errdis: string[], sw: StSw, p: string): boolean {
  const pc = cfg.sw[sw].ports[p as StPort];
  if (!pc || pc.shut || errdis.includes(pk(sw, p))) return false;
  const peer = stPeer(cfg, sw, p);
  if (!peer) return false;
  if (isSw(peer.dev)) return !cfg.sw[peer.dev].ports[peer.port as StPort].shut && !errdis.includes(pk(peer.dev, peer.port));
  return true;
}
export const stPortStatus = (cfg: StCfg, errdis: string[], sw: StSw, p: string): "connected" | "notconnect" | "disabled" | "err-disabled" => (errdis.includes(pk(sw, p)) ? "err-disabled" : cfg.sw[sw].ports[p as StPort].shut ? "disabled" : stPortUp(cfg, errdis, sw, p) ? "connected" : "notconnect");
export function stPortRole(cfg: StCfg, sw: StSw, p: string): string {
  const peer = stPeer(cfg, sw, p);
  if (!peer) return p === SPARE ? "spare (nothing plugged in)" : "nothing plugged in";
  if (peer.dev === "ROGUE") return "a small switch (ROGUE)";
  return isSw(peer.dev) ? `${peer.dev} (switch)` : peer.dev;
}

// ---------------------------------------------------------------------------------------------------------------
// The spanning tree, computed
// ---------------------------------------------------------------------------------------------------------------
export interface Bid {
  priority: number;
  mac: string;
}
const macNum = (m: string) => parseInt(m.replace(/:/g, ""), 16);
export const cmpBid = (a: Bid, b: Bid) => a.priority - b.priority || macNum(a.mac) - macNum(b.mac);
export const bidOf = (cfg: StCfg, b: StBridge): Bid => ({ priority: b === "ROGUE" ? ROGUE_PRIORITY : cfg.sw[b].priority, mac: BRIDGE_MAC[b] });
export const bidName = (b: Bid) => (Object.keys(BRIDGE_MAC) as StBridge[]).find((x) => BRIDGE_MAC[x] === b.mac) ?? b.mac;
export type StRole = "Root" | "Designated" | "Alternate" | "Disabled" | "Non-STP" | "No-STP" | "Root-inc";
export interface StPortInfo {
  role: StRole;
  /** Operational edge (configured edge and no BPDU heard). */
  edge: boolean;
  /** The port hears BPDUs from a neighbor bridge. */
  hearsBpdu: boolean;
  /** The bridge whose BPDU wins on this segment (designated bridge) and its root cost. */
  desBridge?: StBridge;
  desCost?: number;
  desPort?: string;
  /** Legacy timers on this port (this bridge or its neighbor runs 802.1D). */
  legacy: boolean;
}
export interface StBridgeInfo {
  root: StBridge;
  cost: number;
  rootPort?: StPort | "ge-0/0/1";
  /** Bridges in this bridge's spanning tree (its component). */
  members: StBridge[];
}
export interface StTree {
  bridges: Partial<Record<StBridge, StBridgeInfo>>;
  ports: Record<string, StPortInfo>;
  /** Ports with BPDU guard that heard BPDUs: must be err-disabled. */
  guardHits: string[];
}
const ROGUE_PORT = "ge-0/0/1";
/** Bridge ports that take part in spanning tree and are physically up, with their neighbor. */
function stpLinks(cfg: StCfg, errdis: string[]): { a: StBridge; ap: string; b: StBridge; bp: string }[] {
  const out: { a: StBridge; ap: string; b: StBridge; bp: string }[] = [];
  const on = (sw: StSw, p: string) => cfg.sw[sw].proto !== "none" && !cfg.sw[sw].ports[p as StPort].stpOff;
  for (const l of ST_LINKS) {
    const [a, ap, b, bp] = LINK_ENDS[l];
    if (cfg.links[l] && stPortUp(cfg, errdis, a, ap) && on(a, ap) && on(b, bp)) out.push({ a, ap, b, bp });
  }
  if (cfg.rogue && stPortUp(cfg, errdis, "SW3", SPARE) && on("SW3", SPARE)) out.push({ a: "SW3", ap: SPARE, b: "ROGUE", bp: ROGUE_PORT });
  return out;
}
const costOf = (cfg: StCfg, b: StBridge, p: string) => (b === "ROGUE" ? DEFAULT_COST : cfg.sw[b].ports[p as StPort].cost);
export function stTree(cfg: StCfg, errdis: string[]): StTree {
  const guardHits: string[] = [];
  const blocked = new Set<string>(); // root-inconsistent ports
  let links = stpLinks(cfg, errdis);
  // Edge ports that hear BPDUs: BPDU guard → err-disable.
  for (const L of links)
    for (const [b, p] of [
      [L.a, L.ap],
      [L.b, L.bp],
    ] as [StBridge, string][])
      if (isSw(b) && cfg.sw[b].ports[p as StPort].bpduGuard) guardHits.push(pk(b, p));
  if (guardHits.length) links = links.filter((L) => !guardHits.includes(pk(L.a, L.ap)) && !guardHits.includes(pk(L.b, L.bp)));
  let bridges: Partial<Record<StBridge, StBridgeInfo>> = {};
  for (let iter = 0; iter < 4; iter++) {
    const live = links.filter((L) => !blocked.has(pk(L.a, L.ap)) && !blocked.has(pk(L.b, L.bp)));
    const nodes = [...ST_SWITCHES.filter((s) => cfg.sw[s].proto !== "none"), ...(cfg.rogue ? (["ROGUE"] as StBridge[]) : [])];
    bridges = {};
    const seen = new Set<StBridge>();
    for (const start of nodes) {
      if (seen.has(start)) continue;
      const comp: StBridge[] = [start];
      seen.add(start);
      for (let i = 0; i < comp.length; i++)
        for (const L of live) {
          const n = L.a === comp[i] ? L.b : L.b === comp[i] ? L.a : undefined;
          if (n && !seen.has(n)) {
            seen.add(n);
            comp.push(n);
          }
        }
      const root = comp.reduce((x, y) => (cmpBid(bidOf(cfg, y), bidOf(cfg, x)) < 0 ? y : x));
      // Bellman-Ford with the tie-breaks of the priority vector.
      const dist: Partial<Record<StBridge, number>> = { [root]: 0 };
      for (let k = 0; k < 6; k++)
        for (const L of live)
          for (const [me, mp, nb] of [
            [L.a, L.ap, L.b],
            [L.b, L.bp, L.a],
          ] as [StBridge, string, StBridge][]) {
            if (dist[nb] === undefined || me === root) continue;
            const c = dist[nb]! + costOf(cfg, me, mp);
            if (dist[me] === undefined || c < dist[me]!) dist[me] = c;
          }
      for (const b of comp) {
        let best: { c: number; nb: StBridge; np: string; mp: string } | undefined;
        if (b !== root)
          for (const L of live)
            for (const [me, mp, nb, np] of [
              [L.a, L.ap, L.b, L.bp],
              [L.b, L.bp, L.a, L.ap],
            ] as [StBridge, string, StBridge, string][]) {
              if (me !== b || dist[nb] === undefined) continue;
              const c = dist[nb]! + costOf(cfg, me, mp);
              const better = !best || c < best.c || (c === best.c && (cmpBid(bidOf(cfg, nb), bidOf(cfg, best.nb)) < 0 || (cmpBid(bidOf(cfg, nb), bidOf(cfg, best.nb)) === 0 && (portId(np) < portId(best.np) || (portId(np) === portId(best.np) && portId(mp) < portId(best.mp))))));
              if (better) best = { c, nb, np, mp };
            }
        bridges[b] = { root, cost: b === root ? 0 : best!.c, rootPort: best?.mp as StPort | undefined, members: comp };
      }
    }
    // Root guard: a guarded port that became Root Port is held inconsistent; recompute without it.
    const hit = links.find((L) => [[L.a, L.ap] as const, [L.b, L.bp] as const].some(([b, p]) => isSw(b) && cfg.sw[b].ports[p as StPort].rootGuard && bridges[b]?.rootPort === p && !blocked.has(pk(b, p))));
    if (!hit) break;
    for (const [b, p] of [
      [hit.a, hit.ap],
      [hit.b, hit.bp],
    ] as [StBridge, string][])
      if (isSw(b) && cfg.sw[b].ports[p as StPort].rootGuard && bridges[b]?.rootPort === p) blocked.add(pk(b, p));
  }
  const ports: Record<string, StPortInfo> = {};
  const legacyAt = (b: StBridge) => b !== "ROGUE" && cfg.sw[b].proto === "stp";
  for (const sw of ST_SWITCHES)
    for (const p of ST_PORTS) {
      const pc = cfg.sw[sw].ports[p];
      const up = stPortUp(cfg, errdis, sw, p) && !guardHits.includes(pk(sw, p));
      const L = links.find((x) => (x.a === sw && x.ap === p) || (x.b === sw && x.bp === p));
      const nb = L ? (L.a === sw ? { b: L.b, p: L.bp } : { b: L.a, p: L.ap }) : undefined;
      const hearsBpdu = !!L && !pc.stpOff && cfg.sw[sw].proto !== "none";
      const legacy = legacyAt(sw) || (!!nb && legacyAt(nb.b));
      const base = { edge: pc.edge && !hearsBpdu, hearsBpdu, legacy };
      if (!up) ports[pk(sw, p)] = { ...base, role: "Disabled", edge: false };
      else if (cfg.sw[sw].proto === "none") ports[pk(sw, p)] = { ...base, role: "No-STP", edge: false };
      else if (pc.stpOff) ports[pk(sw, p)] = { ...base, role: "Non-STP", edge: false, desBridge: sw, desCost: bridges[sw]?.cost, desPort: p };
      else if (blocked.has(pk(sw, p))) ports[pk(sw, p)] = { ...base, role: "Root-inc" };
      else if (!nb) ports[pk(sw, p)] = { ...base, role: "Designated", desBridge: sw, desCost: bridges[sw]?.cost, desPort: p };
      else {
        const me = bridges[sw]!;
        const them = bridges[nb.b]!;
        if (me.rootPort === p) ports[pk(sw, p)] = { ...base, role: "Root", desBridge: nb.b, desCost: them.cost, desPort: nb.p };
        else {
          const mine = me.cost - them.cost || cmpBid(bidOf(cfg, sw), bidOf(cfg, nb.b)) || portId(p) - portId(nb.p);
          const iWin = them.rootPort === nb.p || mine < 0;
          ports[pk(sw, p)] = iWin ? { ...base, role: "Designated", desBridge: sw, desCost: me.cost, desPort: p } : { ...base, role: "Alternate", desBridge: nb.b, desCost: them.cost, desPort: nb.p };
        }
      }
    }
  return { bridges, ports, guardHits };
}
export const forwardingRole = (r: StRole) => r === "Root" || r === "Designated" || r === "Non-STP" || r === "No-STP";
export const roleShortCisco = (r: StRole) => ({ Root: "Root", Designated: "Desg", Alternate: "Altn", Disabled: "Disa", "Non-STP": "Desg", "No-STP": "—", "Root-inc": "Desg" })[r];
export const roleShortJunos = (r: StRole) => ({ Root: "ROOT", Designated: "DESG", Alternate: "ALT", Disabled: "DIS", "Non-STP": "DESG", "No-STP": "—", "Root-inc": "DESG" })[r];

// ---------------------------------------------------------------------------------------------------------------
// Frames, runs, state
// ---------------------------------------------------------------------------------------------------------------
export type StFrameKind = "arp-req" | "arp-rep" | "echo" | "echo-rep" | "bpdu";
export interface StBpdu {
  root: Bid;
  cost: number;
  bridge: Bid;
  port: string;
  tc: boolean;
  proto: "rstp" | "stp";
}
export interface StFrame {
  id: number;
  src: string;
  dst: string;
  kind: StFrameKind;
  sip: string;
  dip: string;
  from: StDev;
  bpdu?: StBpdu;
}
export interface StCtr {
  inF: number;
  outF: number;
  inB: number;
  outB: number;
  bpduIn: number;
  bpduOut: number;
  drops: number;
}
const ZERO: StCtr = { inF: 0, outF: 0, inB: 0, outB: 0, bpduIn: 0, bpduOut: 0, drops: 0 };
export interface StHop {
  from: StDev;
  fromPort: string;
  to: StDev;
  toPort: string;
  frame: StFrame;
  n: number;
}
export interface StDecision {
  sw: StSw;
  port: string;
  frame: StFrame;
  n: number;
  /** Why the frame was dropped at ingress (port not forwarding), if it was. */
  drop?: string;
  learn?: "learned" | "refreshed" | "moved" | "learning-only";
  movedFrom?: string;
  kind?: "broadcast" | "unknown" | "known" | "filter";
  out: string[];
}
export interface StRx {
  dev: StHost | StBridge;
  port: string;
  frame: StFrame;
  n: number;
  why: string;
  ok: boolean;
}
export interface StWave {
  k: number;
  hops: StHop[];
  decisions: StDecision[];
  rx: StRx[];
  notes: { dev: StDev; text: string; tone: "info" | "ok" | "bad" | "learn" }[];
  snap: StSnap;
}
export interface StSnap {
  fdb: Record<StSw, StEntry[]>;
  counters: Record<string, StCtr>;
}
export interface StEntry {
  mac: string;
  port: string;
  seen: number;
}
export type StSend = { from: StHost; to: StHost; kind: "ping" | "arp" };
export interface StResult {
  send: StSend;
  replied: boolean;
  answered?: boolean;
  fail?: string;
  /** Switches the echo request crossed, in order (first copy that reached the destination). */
  path: StDev[];
  /** Copies of the ARP broadcast each host received. */
  bcastCopies: Partial<Record<StHost, number>>;
}
export interface StRun {
  id: number;
  cmd: string;
  clock: number;
  kind: "traffic" | "hello";
  waves: StWave[];
  results: StResult[];
  /** Copies still circulating between the switches when the drawing stopped. */
  left: number;
  flaps: number;
  cfgSeq: number;
}
export interface StCap {
  n: number;
  run: number;
  wave: number;
  point: string;
  dir: "in" | "out";
  frame: StFrame;
  count: number;
}
export interface StSyslog {
  clock: number;
  sw: StSw;
  ev: "up" | "down" | "admin-down" | "errdis" | "rootinc" | "rootinc-clear" | "flap" | "tc" | "newroot" | "role";
  port?: string;
  text?: string;
  mac?: string;
  ports?: [string, string];
}
export interface StLogLine {
  seq: number;
  text: string;
  tone: "info" | "ok" | "warn";
}
export type StTicketId = "loop" | "rogue" | "cost" | "edge" | "legacy";
export interface StState {
  cfg: StCfg;
  tree: StTree;
  errdis: string[];
  /** Clock time from which each port may forward (after RSTP agreement or legacy timers). */
  fwdAt: Record<string, number>;
  /** When each port's timers started (for Listening/Learning display). */
  since: Record<string, number>;
  fdb: Record<StSw, StEntry[]>;
  arp: Record<StHost, Record<string, string>>;
  counters: Record<string, StCtr>;
  clock: number;
  captures: StCap[];
  capN: number;
  syslog: StSyslog[];
  runs: StRun[];
  last?: StRun;
  seq: number;
  frameSeq: number;
  cfgSeq: number;
  tcCount: Record<StSw, number>;
  lastTc: Record<StSw, number>;
  log: StLogLine[];
  ticket?: StTicketId;
  /** Junos commit history per switch, newest first: its configuration before each commit (rollback 1, 2…). */
  rb?: Partial<Record<StSw, string[]>>;
}
function emptyCounters(): Record<string, StCtr> {
  const c: Record<string, StCtr> = {};
  for (const sw of ST_SWITCHES) for (const p of ST_PORTS) c[pk(sw, p)] = { ...ZERO };
  for (const h of ST_HOSTS) c[h] = { ...ZERO };
  return c;
}
export function createStNet(cfg: StCfg = stHealthy()): StState {
  const tree = stTree(cfg, []);
  const errdis = [...tree.guardHits];
  const t = errdis.length ? stTree(cfg, errdis) : tree;
  const fwdAt: Record<string, number> = {};
  for (const k of Object.keys(t.ports)) fwdAt[k] = -1000;
  return { cfg, tree: t, errdis, fwdAt, since: {}, fdb: { SW1: [], SW2: [], SW3: [] }, arp: { "HOST-A": {}, "HOST-B": {}, "HOST-C": {} }, counters: emptyCounters(), clock: 3600, captures: [], capN: 0, syslog: [], runs: [], seq: 0, frameSeq: 0, cfgSeq: 0, tcCount: { SW1: 0, SW2: 0, SW3: 0 }, lastTc: { SW1: 0, SW2: 0, SW3: 0 }, log: [] };
}

/** What a port is doing right now: its role, and whether its timers let it forward / learn yet. */
export function stPortState(s: StState, sw: StSw, p: string): { role: StRole; state: "FWD" | "LRN" | "LIS" | "BLK" | "BKN"; edge: boolean; wait: number } {
  const info = s.tree.ports[pk(sw, p)];
  if (s.errdis.includes(pk(sw, p))) return { role: "Disabled", state: "BKN", edge: false, wait: 0 };
  if (!info || info.role === "Disabled") return { role: "Disabled", state: "BLK", edge: false, wait: 0 };
  if (info.role === "Alternate" || info.role === "Root-inc") return { role: info.role, state: info.role === "Root-inc" ? "BKN" : "BLK", edge: info.edge, wait: 0 };
  const at = s.fwdAt[pk(sw, p)] ?? -1000;
  const wait = Math.max(0, at - s.clock);
  if (!wait) return { role: info.role, state: "FWD", edge: info.edge, wait: 0 };
  return { role: info.role, state: wait <= FWD_DELAY ? "LRN" : info.legacy ? "LIS" : "BLK", edge: info.edge, wait };
}
export const stForwards = (s: StState, sw: StSw, p: string) => stPortState(s, sw, p).state === "FWD";
const stLearns = (s: StState, sw: StSw, p: string) => ["FWD", "LRN"].includes(stPortState(s, sw, p).state);
export function stMacName(mac: string): string {
  if (mac === BCAST) return "broadcast";
  if (mac === BPDU_MAC) return "STP multicast";
  return ST_HOSTS.find((h) => HOST_MAC[h] === mac) ?? (Object.keys(BRIDGE_MAC) as StBridge[]).find((b) => BRIDGE_MAC[b] === mac) ?? mac;
}
export const stShortMac = (m: string) => (m === BCAST ? "FF:FF:FF:FF:FF:FF" : m === BPDU_MAC ? "01:80:C2:00:00:00" : `…${m.slice(-5)}`);
export function stFrameName(f: StFrame): string {
  if (f.kind === "bpdu") return `${f.bpdu!.proto === "rstp" ? "RST" : "Config"} BPDU · root ${bidName(f.bpdu!.root)} · cost ${f.bpdu!.cost}${f.bpdu!.tc ? " · TC" : ""}`;
  if (f.kind === "arp-req") return `ARP request (who has ${f.dip}?)`;
  if (f.kind === "arp-rep") return `ARP reply (${f.sip} is at ${stShortMac(f.src)})`;
  if (f.kind === "echo-rep") return `ping reply ${f.sip} → ${f.dip}`;
  return `ping ${f.sip} → ${f.dip}`;
}
export const stTable = (fdb: Record<StSw, StEntry[]>, sw: StSw) => [...fdb[sw]].sort((a, b) => a.mac.localeCompare(b.mac));
export const stLookup = (fdb: Record<StSw, StEntry[]>, sw: StSw, mac: string) => fdb[sw].find((e) => e.mac === mac);

// ---------------------------------------------------------------------------------------------------------------
// Configuration changes: recompute the tree, time the transitions, flush on topology change
// ---------------------------------------------------------------------------------------------------------------
function applyCfg(s: StState, cfg: StCfg, text: string): StState {
  const oldTree = s.tree;
  const syslog = [...s.syslog];
  const notes: string[] = [];
  // Err-disable is sticky: it stays until the port is shut / no shut (Cisco) or cleared (Junos); a port that is shut now loses it.
  let errdis = s.errdis.filter((k) => {
    const [sw, p] = k.split(" ");
    return !cfg.sw[sw as StSw].ports[p as StPort].shut;
  });

  let tree = stTree(cfg, errdis);
  if (tree.guardHits.length) {
    for (const k of tree.guardHits) {
      const [sw, p] = k.split(" ") as [StSw, string];
      syslog.push({ clock: s.clock, sw, ev: "errdis", port: p });
      notes.push(`${sw} ${p}: BPDU received on a BPDU-guard edge port → err-disabled`);
    }
    errdis = [...errdis, ...tree.guardHits];
    tree = stTree(cfg, errdis);
  }
  const fwdAt = { ...s.fwdAt };
  const since = { ...s.since };
  const fdb = { SW1: [...s.fdb.SW1], SW2: [...s.fdb.SW2], SW3: [...s.fdb.SW3] };
  const tcCount = { ...s.tcCount };
  const lastTc = { ...s.lastTc };
  let tc = false;
  for (const sw of ST_SWITCHES) {
    const oldRoot = oldTree.bridges[sw]?.root;
    const newRoot = tree.bridges[sw]?.root;
    if (oldRoot && newRoot && oldRoot !== newRoot) syslog.push({ clock: s.clock, sw, ev: "newroot", text: newRoot });
    for (const p of ST_PORTS) {
      const k = pk(sw, p);
      const o = oldTree.ports[k];
      const n = tree.ports[k];
      const wasUp = o && o.role !== "Disabled";
      const isUp = n.role !== "Disabled";
      if (wasUp !== isUp) syslog.push({ clock: s.clock, sw, ev: isUp ? "up" : cfg.sw[sw].ports[p].shut ? "admin-down" : "down", port: p });
      if (n.role === "Root-inc" && o?.role !== "Root-inc") syslog.push({ clock: s.clock, sw, ev: "rootinc", port: p });
      if (o?.role === "Root-inc" && n.role !== "Root-inc") syslog.push({ clock: s.clock, sw, ev: "rootinc-clear", port: p });
      if (!isUp) fdb[sw] = fdb[sw].filter((e) => e.port !== p);
      const was = !!o && forwardingRole(o.role) && wasUp;
      const now = forwardingRole(n.role);
      if (!now || (was && o!.legacy === n.legacy)) continue;
      // Newly forwarding: when may it forward?
      let delay = 0;
      if (n.role === "Non-STP" || n.role === "No-STP" || n.edge) delay = 0;
      else if (n.legacy) {
        delay = 2 * FWD_DELAY;
        const oldRp = oldTree.bridges[sw]?.rootPort;
        const indirect = n.role === "Root" && !!oldRp && oldRp !== p && tree.ports[pk(sw, oldRp)]?.role !== "Disabled";
        if (indirect) delay += MAX_AGE;
      } else if (n.role === "Root" && o?.role === "Alternate") delay = 0;
      else if (n.hearsBpdu) delay = 0;
      else delay = 2 * FWD_DELAY;
      fwdAt[k] = s.clock + delay;
      since[k] = s.clock;
      if (!n.edge && n.role !== "Non-STP" && n.role !== "No-STP") tc = true;
      if (o && o.role !== n.role && o.role !== "Disabled") syslog.push({ clock: s.clock, sw, ev: "role", port: p, text: `${o.role} → ${n.role}` });
    }
  }
  if (tc) {
    for (const sw of ST_SWITCHES) {
      if (cfg.sw[sw].proto === "none") continue;
      fdb[sw] = fdb[sw].filter((e) => tree.ports[pk(sw, e.port)]?.edge);
      tcCount[sw]++;
      lastTc[sw] = s.clock;
      syslog.push({ clock: s.clock, sw, ev: "tc" });
    }
    notes.push("topology change: every switch flushed the MAC entries learned on non-edge ports");
  }
  const seq = s.seq + 1;
  return { ...s, cfg, tree, errdis, fwdAt, since, fdb, syslog, tcCount, lastTc, seq, cfgSeq: s.cfgSeq + 1, log: [...s.log, { seq, text: text + (notes.length ? ` — ${notes.join("; ")}` : ""), tone: notes.some((x) => /err-disabled/.test(x)) ? "warn" : "info" }] };
}

// ---------------------------------------------------------------------------------------------------------------
// Data plane and BPDUs
// ---------------------------------------------------------------------------------------------------------------
interface Item {
  dev: StDev;
  port: string;
  frame: StFrame;
  n: number;
}
interface Work {
  s: StState;
  fdb: Record<StSw, StEntry[]>;
  counters: Record<string, StCtr>;
  captures: StCap[];
  capN: number;
  syslog: StSyslog[];
  runId: number;
  flaps: number;
  waves: StWave[];
}
const MAX_WAVES = 10;
function snapOf(w: Work): StSnap {
  return { fdb: { SW1: [...w.fdb.SW1], SW2: [...w.fdb.SW2], SW3: [...w.fdb.SW3] }, counters: JSON.parse(JSON.stringify(w.counters)) };
}
function bump(w: Work, key: string, dir: "in" | "out", f: StFrame, n: number) {
  const c = w.counters[key];
  if (!c) return;
  if (f.kind === "bpdu") {
    if (dir === "in") c.bpduIn += n;
    else c.bpduOut += n;
    return;
  }
  if (dir === "in") {
    c.inF += n;
    if (f.dst === BCAST) c.inB += n;
  } else {
    c.outF += n;
    if (f.dst === BCAST) c.outB += n;
  }
}
function capture(w: Work, wave: number, h: StHop) {
  const pt = (d: StDev, p: string) => (isSw(d) ? pk(d, p) : d === "ROGUE" ? undefined : d);
  const a = pt(h.from, h.fromPort);
  const b = pt(h.to, h.toPort);
  if (a) w.captures.push({ n: ++w.capN, run: w.runId, wave, point: a, dir: "out", frame: h.frame, count: h.n });
  if (b) w.captures.push({ n: ++w.capN, run: w.runId, wave, point: b, dir: "in", frame: h.frame, count: h.n });
  if (isSw(h.from)) bump(w, pk(h.from, h.fromPort), "out", h.frame, h.n);
  else if (isHost(h.from)) bump(w, h.from, "out", h.frame, h.n);
  if (isSw(h.to)) bump(w, pk(h.to, h.toPort), "in", h.frame, h.n);
  else if (isHost(h.to)) bump(w, h.to, "in", h.frame, h.n);
}
function egress(w: Work, sw: StSw, p: string, f: StFrame, n: number): StHop | undefined {
  const peer = stPeer(w.s.cfg, sw, p);
  if (!peer) return undefined;
  return { from: sw, fromPort: p, to: peer.dev, toPort: peer.port, frame: f, n };
}
const merge = (items: Item[]): Item[] => {
  const m = new Map<string, Item>();
  for (const it of items) {
    const k = `${it.dev}|${it.port}|${it.frame.id}`;
    const e = m.get(k);
    if (e) e.n += it.n;
    else m.set(k, { ...it });
  }
  return [...m.values()];
};
/** Flood / forward a set of frames until they die out (or MAX_WAVES). Returns what each host received. */
function propagate(w: Work, start: StHop[], onHost: (h: StHost, f: StFrame, n: number, port: string) => { ok: boolean; why: string }): { left: number } {
  let hops = start;
  for (let guard = 0; guard < MAX_WAVES && hops.length; guard++) {
    const k = w.waves.length;
    hops.forEach((h) => capture(w, k, h));
    const decisions: StDecision[] = [];
    const rx: StRx[] = [];
    const next: Item[] = [];
    for (const h of hops) {
      if (isHost(h.to)) {
        const r = onHost(h.to, h.frame, h.n, h.toPort);
        rx.push({ dev: h.to, port: h.toPort, frame: h.frame, n: h.n, ...r });
      } else if (h.to === "ROGUE") rx.push({ dev: "ROGUE", port: h.toPort, frame: h.frame, n: h.n, ok: false, why: "the small switch has no other port in use: the frame ends there" });
      else next.push({ dev: h.to, port: h.toPort, frame: h.frame, n: h.n });
    }
    const out: StHop[] = [];
    for (const it of merge(next)) {
      const sw = it.dev as StSw;
      const f = it.frame;
      const st = stPortState(w.s, sw, it.port);
      const d: StDecision = { sw, port: it.port, frame: f, n: it.n, out: [] };
      if (!stForwards(w.s, sw, it.port)) {
        d.drop = st.role === "Alternate" ? "the port is Alternate (Discarding): RSTP blocks data on it" : st.role === "Root-inc" ? "the port is held root-inconsistent by root guard (Discarding)" : st.state === "LRN" ? `the port is Learning (${st.wait} s until it forwards): it learns the source but forwards nothing` : `the port is ${st.state === "LIS" ? "Listening" : "Discarding"} (${st.wait} s until it forwards)`;
        w.counters[pk(sw, it.port)].drops += it.n;
        if (stLearns(w.s, sw, it.port)) learn(w, sw, f.src, it.port, d);
        decisions.push(d);
        continue;
      }
      learn(w, sw, f.src, it.port, d);
      const fwdPorts = ST_PORTS.filter((p) => p !== it.port && stForwards(w.s, sw, p) && stPeer(w.s.cfg, sw, p));
      const hit = f.dst === BCAST ? undefined : stLookup(w.fdb, sw, f.dst);
      if (f.dst === BCAST) d.kind = "broadcast";
      else if (!hit) d.kind = "unknown";
      else if (hit.port === it.port) d.kind = "filter";
      else d.kind = "known";
      d.out = d.kind === "broadcast" || d.kind === "unknown" ? fwdPorts : d.kind === "filter" ? [] : stForwards(w.s, sw, hit!.port) ? [hit!.port] : [];
      for (const p of d.out) {
        const e = egress(w, sw, p, f, it.n);
        if (e) out.push(e);
      }
      decisions.push(d);
    }
    w.waves.push({ k, hops, decisions, rx, notes: [], snap: snapOf(w) });
    hops = out;
  }
  return { left: hops.filter((h) => isSw(h.to)).reduce((a, h) => a + h.n, 0) };
}
function learn(w: Work, sw: StSw, mac: string, p: string, d: StDecision) {
  const e = w.fdb[sw].find((x) => x.mac === mac);
  if (!e) {
    w.fdb[sw] = [...w.fdb[sw], { mac, port: p, seen: w.s.clock }];
    d.learn = d.drop ? "learning-only" : "learned";
  } else if (e.port !== p) {
    d.learn = "moved";
    d.movedFrom = e.port;
    w.fdb[sw] = w.fdb[sw].map((x) => (x.mac === mac ? { ...x, port: p, seen: w.s.clock } : x));
    w.flaps++;
    w.syslog.push({ clock: w.s.clock, sw, ev: "flap", mac, ports: [e.port, p] });
  } else {
    d.learn = "refreshed";
    w.fdb[sw] = w.fdb[sw].map((x) => (x.mac === mac ? { ...x, seen: w.s.clock } : x));
  }
}
function newFrame(s: { frameSeq: number }, f: Omit<StFrame, "id">): StFrame {
  return { ...f, id: ++s.frameSeq };
}
function simulate(s0: StState, sends: StSend[], cmd: string): StState {
  const s: StState = { ...s0, clock: s0.clock + 1 };
  // Aging.
  const fdb0 = { SW1: s.fdb.SW1.filter((e) => s.clock - e.seen < ST_AGING), SW2: s.fdb.SW2.filter((e) => s.clock - e.seen < ST_AGING), SW3: s.fdb.SW3.filter((e) => s.clock - e.seen < ST_AGING) };
  const runId = s.runs.length + 1;
  const w: Work = { s, fdb: fdb0, counters: JSON.parse(JSON.stringify(s.counters)), captures: [...s.captures], capN: s.capN, syslog: [...s.syslog], runId, flaps: 0, waves: [] };
  const arp = JSON.parse(JSON.stringify(s.arp)) as StState["arp"];
  const seqHolder = { frameSeq: s.frameSeq };
  const results: StResult[] = [];
  let left = 0;
  for (const x of sends) {
    const r: StResult = { send: x, replied: false, path: [], bcastCopies: {} };
    results.push(r);
    const src = x.from;
    const dst = x.to;
    if (!s.cfg.hosts[src] || !stForwardsHost(s, src)) {
      r.fail = !s.cfg.hosts[src] ? `${src} is unplugged` : `${src}'s switch port isn't forwarding yet (${stPortState(s, HOST_SW[src], HOST_PORT).wait} s to go): nothing it sends gets past ${HOST_SW[src]}`;
    }
    const firstHop = (f: StFrame) => ({ from: src as StDev, fromPort: "eth0", to: HOST_SW[src] as StDev, toPort: HOST_PORT, frame: f, n: 1 });
    // 1. ARP (if needed)
    let mac = arp[src][HOST_IP[dst]];
    if (!mac || x.kind === "arp") {
      const req = newFrame(seqHolder, { src: HOST_MAC[src], dst: BCAST, kind: "arp-req", sip: HOST_IP[src], dip: HOST_IP[dst], from: src });
      let heard = false;
      const res = s.cfg.hosts[src]
        ? propagate(w, [firstHop(req)], (h, f, n) => {
            r.bcastCopies[h] = (r.bcastCopies[h] ?? 0) + n;
            if (f.dip === HOST_IP[h]) {
              heard = true;
              return { ok: true, why: `${h}: “that's my address” — answers${n > 1 ? ` (got ${n} copies of the same request!)` : ""}` };
            }
            return { ok: true, why: `${h}: not my address — ignores it${n > 1 ? ` (${n} copies!)` : ""}` };
          })
        : { left: 0 };
      left += res.left;
      if (!heard) {
        r.fail = r.fail ?? `${src}'s ARP request never reached ${dst}`;
        continue;
      }
      arp[dst][HOST_IP[src]] = HOST_MAC[src];
      const rep = newFrame(seqHolder, { src: HOST_MAC[dst], dst: HOST_MAC[src], kind: "arp-rep", sip: HOST_IP[dst], dip: HOST_IP[src], from: dst });
      let got = false;
      if (s.cfg.hosts[dst])
        left += propagate(w, [{ from: dst, fromPort: "eth0", to: HOST_SW[dst], toPort: HOST_PORT, frame: rep, n: 1 }], (h, f, n) => {
          if (h === src && f.dst === HOST_MAC[h]) {
            got = true;
            return { ok: true, why: `${h}: learns ${HOST_IP[dst]} is at ${stShortMac(f.src)}${n > 1 ? ` (${n} copies)` : ""}` };
          }
          return { ok: false, why: `${h}: not for me — discards${n > 1 ? ` (${n} copies)` : ""}` };
        }).left;
      if (!got) {
        r.fail = r.fail ?? `${dst}'s ARP reply never reached ${src}`;
        continue;
      }
      arp[src][HOST_IP[dst]] = HOST_MAC[dst];
      mac = HOST_MAC[dst];
      if (x.kind === "arp") {
        r.answered = true;
        continue;
      }
    }
    // 2. Echo + reply
    const echo = newFrame(seqHolder, { src: HOST_MAC[src], dst: mac, kind: "echo", sip: HOST_IP[src], dip: HOST_IP[dst], from: src });
    let arrived = false;
    const waveStart = w.waves.length;
    if (s.cfg.hosts[src])
      left += propagate(w, [firstHop(echo)], (h, f, n) => {
        if (h === dst) {
          arrived = true;
          return { ok: true, why: `${h}: ping for me — replies${n > 1 ? ` (got ${n} copies!)` : ""}` };
        }
        return { ok: false, why: `${h}: not for me — discards${n > 1 ? ` (${n} copies)` : ""}` };
      }).left;
    // The path: switches that forwarded the echo toward the destination (the first decision chain).
    r.path = [src, ...pathOf(w.waves.slice(waveStart), echo.id, dst)];
    if (!arrived) {
      r.fail = r.fail ?? `the ping never reached ${dst}${w.waves.slice(waveStart).some((wv) => wv.decisions.some((d) => d.frame.id === echo.id && d.drop)) ? " (dropped by a port that isn't forwarding)" : ""}`;
      continue;
    }
    const rep = newFrame(seqHolder, { src: HOST_MAC[dst], dst: HOST_MAC[src], kind: "echo-rep", sip: HOST_IP[dst], dip: HOST_IP[src], from: dst });
    let back = false;
    if (s.cfg.hosts[dst])
      left += propagate(w, [{ from: dst, fromPort: "eth0", to: HOST_SW[dst], toPort: HOST_PORT, frame: rep, n: 1 }], (h, f, n) => {
        if (h === src) {
          back = true;
          return { ok: true, why: `${h}: the reply came back${n > 1 ? ` (${n} copies)` : ""}` };
        }
        return { ok: false, why: `${h}: not for me — discards` };
      }).left;
    r.replied = back;
    if (!back) r.fail = r.fail ?? `${dst}'s reply never reached ${src}`;
  }
  const run: StRun = { id: runId, cmd, clock: s.clock, kind: "traffic", waves: w.waves, results, left, flaps: w.flaps, cfgSeq: s.cfgSeq };
  const seq = s.seq + 1;
  const tone = results.every((x) => x.replied || x.answered) && !left ? "ok" : "warn";
  const summary = results.map((x) => (x.replied ? `${x.send.from} → ${x.send.to}: reply came back` : x.answered ? `${x.send.from}: ARP answered` : `${x.send.from} → ${x.send.to}: FAILED — ${x.fail}`)).join(" · ");
  return { ...s, fdb: w.fdb, arp, counters: w.counters, captures: w.captures.slice(-1500), capN: w.capN, syslog: w.syslog.slice(-200), runs: [...s.runs, run].slice(-40), last: run, seq, frameSeq: seqHolder.frameSeq, log: [...s.log, { seq, text: `${cmd}: ${summary}${left ? ` · ${left.toLocaleString("en-US")} copies still circulating` : ""}${w.flaps ? ` · ${w.flaps} MAC moves` : ""}`, tone }] };
}
const stForwardsHost = (s: StState, h: StHost) => s.cfg.hosts[h] && stForwards(s, HOST_SW[h], HOST_PORT);
function pathOf(waves: StWave[], id: number, dst: StHost): StDev[] {
  // Walk back from the first wave where dst received the frame.
  const wi = waves.findIndex((w) => w.rx.some((r) => r.dev === dst && r.frame.id === id));
  if (wi < 0) {
    const seen: StDev[] = [];
    for (const w of waves) for (const d of w.decisions) if (d.frame.id === id && !seen.includes(d.sw)) seen.push(d.sw);
    return seen;
  }
  const chain: StDev[] = [dst];
  let cur: StDev = dst;
  for (let i = wi; i >= 0; i--) {
    const h = waves[i].hops.find((x) => x.frame.id === id && x.to === cur);
    if (!h) break;
    if (isSw(h.from)) chain.unshift(h.from);
    cur = h.from;
  }
  return chain.slice(0, -1);
}

/** One hello: every Designated port of every bridge running spanning tree sends a BPDU. */
function hello(s0: StState): StState {
  const s: StState = { ...s0, clock: s0.clock + 2 };
  const runId = s.runs.length + 1;
  const w: Work = { s, fdb: s.fdb, counters: JSON.parse(JSON.stringify(s.counters)), captures: [...s.captures], capN: s.capN, syslog: [...s.syslog], runId, flaps: 0, waves: [] };
  const seqHolder = { frameSeq: s.frameSeq };
  const hops: StHop[] = [];
  const t = s.tree;
  const tcRecent = (sw: StSw) => s.clock - s.lastTc[sw] < 2 * 2 + 2 && s.tcCount[sw] > 0;
  for (const sw of ST_SWITCHES) {
    if (s.cfg.sw[sw].proto === "none") continue;
    const b = t.bridges[sw];
    if (!b) continue;
    for (const p of ST_PORTS) {
      const info = t.ports[pk(sw, p)];
      if (!info || info.role !== "Designated") continue;
      const peer = stPeer(s.cfg, sw, p);
      if (!peer) continue;
      const f = newFrame(seqHolder, { src: BRIDGE_MAC[sw], dst: BPDU_MAC, kind: "bpdu", sip: "", dip: "", from: sw, bpdu: { root: bidOf(s.cfg, b.root), cost: b.cost, bridge: bidOf(s.cfg, sw), port: p, tc: tcRecent(sw), proto: s.cfg.sw[sw].proto === "stp" ? "stp" : "rstp" } });
      hops.push({ from: sw, fromPort: p, to: peer.dev, toPort: peer.port, frame: f, n: 1 });
    }
  }
  if (s.cfg.rogue) {
    const r = t.bridges.ROGUE;
    if (r && stPortUp(s.cfg, s.errdis, "SW3", SPARE)) {
      const f = newFrame(seqHolder, { src: BRIDGE_MAC.ROGUE, dst: BPDU_MAC, kind: "bpdu", sip: "", dip: "", from: "ROGUE", bpdu: { root: bidOf(s.cfg, r.root), cost: r.cost, bridge: bidOf(s.cfg, "ROGUE"), port: ROGUE_PORT, tc: false, proto: "rstp" } });
      if (r.root === "ROGUE") hops.push({ from: "ROGUE", fromPort: ROGUE_PORT, to: "SW3", toPort: SPARE, frame: f, n: 1 });
    }
  }
  const k = 0;
  hops.forEach((h) => capture(w, k, h));
  const rx: StRx[] = hops.map((h) => {
    if (isHost(h.to)) return { dev: h.to, port: h.toPort, frame: h.frame, n: 1, ok: false, why: `${h.to}: a BPDU (01:80:C2:00:00:00) — hosts ignore it` };
    if (h.to === "ROGUE") return { dev: "ROGUE", port: h.toPort, frame: h.frame, n: 1, ok: true, why: "ROGUE: worse than its own Bridge ID — it keeps claiming root" };
    const sw = h.to as StSw;
    const info = t.ports[pk(sw, h.toPort)];
    const b = h.frame.bpdu!;
    if (s.cfg.sw[sw].ports[h.toPort as StPort].stpOff) return { dev: sw, port: h.toPort, frame: h.frame, n: 1, ok: false, why: `${sw} ${h.toPort}: spanning tree is off on this port — the BPDU is silently dropped` };
    if (s.cfg.sw[sw].proto === "none") return { dev: sw, port: h.toPort, frame: h.frame, n: 1, ok: false, why: `${sw}: spanning tree is not running — it doesn't process BPDUs` };
    const why =
      info?.role === "Root"
        ? `best path to root ${bidName(b.root)}: ${b.cost} + this port's cost ${s.cfg.sw[sw].ports[h.toPort as StPort].cost} = ${t.bridges[sw]?.cost} → this is ${sw}'s Root Port`
        : info?.role === "Alternate"
          ? `another path to root ${bidName(b.root)} (via ${bidName(b.bridge)}), not ${sw}'s best → Alternate, Discarding`
          : info?.role === "Root-inc"
            ? `a BETTER root (${bidName(b.root)}) offered on a root-guard port → ignored, port held root-inconsistent`
            : `${bidName(b.root)} as root — ${sw} keeps its own role here`;
    return { dev: sw, port: h.toPort, frame: h.frame, n: 1, ok: true, why: `${sw} ${h.toPort}: ${why}` };
  });
  w.waves.push({ k, hops, decisions: [], rx, notes: [], snap: snapOf(w) });
  const run: StRun = { id: runId, cmd: "Hello: every Designated port sends a BPDU", clock: s.clock, kind: "hello", waves: w.waves, results: [], left: 0, flaps: 0, cfgSeq: s.cfgSeq };
  const seq = s.seq + 1;
  return { ...s, counters: w.counters, captures: w.captures.slice(-1500), capN: w.capN, runs: [...s.runs, run].slice(-40), last: run, seq, frameSeq: seqHolder.frameSeq, log: [...s.log, { seq, text: `BPDUs sent: ${hops.length} (one per Designated port)`, tone: "info" }] };
}

// ---------------------------------------------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------------------------------------------
export type StAction =
  | { type: "traffic"; sends: StSend[]; cmd?: string }
  | { type: "hello" }
  | { type: "wait"; seconds: number }
  | { type: "clear"; sw: StSw }
  | { type: "clear-arp"; dev: StHost }
  | { type: "clear-counters"; sw?: StSw }
  | { type: "cfg"; cfg: StCfg; text: string; junosCommit?: StSw }
  | { type: "link"; link: StLink; up: boolean }
  | { type: "host"; host: StHost; up: boolean }
  | { type: "reseat"; host: StHost }
  | { type: "rogue"; up: boolean }
  | { type: "clear-errdis"; sw: StSw; port: string }
  | { type: "ticket"; id: StTicketId }
  | { type: "fresh" };
export const sendText = (x: StSend) => (x.kind === "arp" ? `${x.from} broadcasts an ARP request for ${HOST_IP[x.to]} (${x.to})` : `${x.from} pings ${x.to}`);
export const LINK_TEXT: Record<StLink, string> = { L12: "SW1↔SW2", L13: "SW1↔SW3", L23: "SW2↔SW3" };
export function stApply(s: StState, a: StAction): StState {
  switch (a.type) {
    case "traffic":
      return simulate(s, a.sends, a.cmd ?? a.sends.map(sendText).join(", then "));
    case "hello":
      return hello(s);
    case "wait": {
      const seq = s.seq + 1;
      return { ...s, clock: s.clock + a.seconds, seq, log: [...s.log, { seq, text: `${a.seconds} s pass`, tone: "info" }] };
    }
    case "clear": {
      const seq = s.seq + 1;
      return { ...s, fdb: { ...s.fdb, [a.sw]: [] }, seq, log: [...s.log, { seq, text: `${a.sw}: MAC table cleared`, tone: "info" }] };
    }
    case "clear-arp":
      return { ...s, arp: { ...s.arp, [a.dev]: {} } };
    case "clear-counters": {
      const c = { ...s.counters };
      for (const k of Object.keys(c)) if (!a.sw || k.startsWith(a.sw)) c[k] = { ...ZERO };
      return { ...s, counters: c };
    }
    case "cfg": {
      const next = applyCfg(s, a.cfg, a.text);
      if (!a.junosCommit) return next;
      const d = a.junosCommit;
      return { ...next, rb: { ...s.rb, [d]: [JSON.stringify(s.cfg.sw[d]), ...(s.rb?.[d] ?? [])].slice(0, 49) } };
    }
    case "link": {
      const cfg = stClone(s.cfg);
      cfg.links[a.link] = a.up;
      return applyCfg(s, cfg, `${LINK_TEXT[a.link]} cable ${a.up ? "plugged back in" : "unplugged"}`);
    }
    case "host": {
      const cfg = stClone(s.cfg);
      cfg.hosts[a.host] = a.up;
      return applyCfg(s, cfg, `${a.host} cable ${a.up ? "plugged in" : "unplugged"}`);
    }
    case "reseat": {
      const down = stClone(s.cfg);
      down.hosts[a.host] = false;
      const mid = applyCfg(s, down, `${a.host} cable unplugged`);
      const up = stClone(mid.cfg);
      up.hosts[a.host] = true;
      return applyCfg({ ...mid, clock: mid.clock + 1 }, up, `${a.host} cable plugged back in (reseated)`);
    }
    case "rogue": {
      const cfg = stClone(s.cfg);
      cfg.rogue = a.up;
      return applyCfg(s, cfg, a.up ? "Someone plugs a small switch into SW3 ge-0/0/11 (its bridge priority is 4096)" : "The small switch is unplugged from SW3 ge-0/0/11");
    }
    case "clear-errdis": {
      const errdis = s.errdis.filter((k) => k !== pk(a.sw, a.port));
      return applyCfg({ ...s, errdis }, stClone(s.cfg), `${a.sw} ${a.port}: err-disabled state cleared`);
    }
    case "ticket":
      return stTicketState(a.id, s.seq + 1);
    case "fresh":
      return { ...createStNet(), seq: s.seq + 1 };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Tickets — the network after a normal morning, with ONE real thing wrong
// ---------------------------------------------------------------------------------------------------------------
export type StCause = "loop" | "rogue" | "cost" | "priority" | "edge" | "legacy" | "link" | "host";
export const ST_CAUSES: { id: StCause; label: string }[] = [
  { id: "link", label: "An inter-switch link is down" },
  { id: "loop", label: "A switch port has been taken out of spanning tree" },
  { id: "rogue", label: "Another switch took over as root through an unprotected port" },
  { id: "priority", label: "A bridge priority was changed and the root moved" },
  { id: "cost", label: "A port cost makes a switch choose the wrong Root Port" },
  { id: "edge", label: "A host port is not an edge port" },
  { id: "legacy", label: "A switch runs legacy STP (802.1D) instead of RSTP" },
  { id: "host", label: "A host's network card is faulty" },
];
export interface StTicket {
  id: StTicketId;
  title: string;
  report: string;
  /** The user's test: actions to run (the last one is the traffic that matters). */
  repro: StAction[];
  reproLabel: string;
  cause: StCause;
  /** Is the user's test good, judged from its run? */
  good: (s: StState, run: StRun) => { ok: boolean; why: string };
}
const pingOk = (run: StRun) => run.results.every((r) => r.replied);
const cleanBcast = (run: StRun) => !run.left && run.results.every((r) => Object.values(r.bcastCopies).every((n) => (n ?? 0) <= 1));
export const ST_TICKETS: StTicket[] = [
  {
    id: "loop",
    title: "The whole LAN crawls",
    report: "“After last night's maintenance on SW3, everything is slow. Link lights flash nonstop and the switches log MAC moves.”",
    repro: [{ type: "traffic", sends: [{ from: "HOST-A", to: "HOST-B", kind: "arp" }] }],
    reproLabel: "HOST-A broadcasts one ARP request",
    cause: "loop",
    good: (_s, run) => ({ ok: cleanBcast(run) && run.results.every((r) => r.answered), why: cleanBcast(run) ? "each host got the broadcast once; nothing circulates" : `${run.left.toLocaleString("en-US")} copies still circulating · ${run.flaps} MAC moves · copies per host ${Object.entries(run.results[0]?.bcastCopies ?? {}).map(([h, n]) => `${h.replace("HOST-", "")} ${n}`).join(", ")}` }),
  },
  {
    id: "rogue",
    title: "Floor 1 ↔ floor 2 got slow",
    report: "“Since the contractors were on floor 3 yesterday, traffic between HOST-A (SW1) and HOST-B (SW2) is sluggish. Nothing is down, and nobody touched SW1 or SW2.”",
    repro: [{ type: "traffic", sends: [{ from: "HOST-A", to: "HOST-B", kind: "ping" }] }],
    reproLabel: "HOST-A pings HOST-B",
    cause: "rogue",
    good: (_s, run) => {
      const r = run.results[0];
      const via = r?.path.filter(isSw) ?? [];
      return { ok: !!r?.replied && !via.includes("SW3"), why: r?.replied ? `the ping went ${via.join(" → ")}` : `no reply: ${r?.fail}` };
    },
  },
  {
    id: "cost",
    title: "Floor 3's uplink sits idle",
    report: "“The SW1↔SW3 link shows almost no traffic, while SW2 carries everything for floor 3. Someone ‘optimised’ SW3 last week.”",
    repro: [{ type: "traffic", sends: [{ from: "HOST-C", to: "HOST-A", kind: "ping" }] }],
    reproLabel: "HOST-C pings HOST-A",
    cause: "cost",
    good: (_s, run) => {
      const r = run.results[0];
      const via = r?.path.filter(isSw) ?? [];
      return { ok: !!r?.replied && !via.includes("SW2"), why: r?.replied ? `the ping went ${via.join(" → ")}` : `no reply: ${r?.fail}` };
    },
  },
  {
    id: "edge",
    title: "HOST-B has no network for half a minute",
    report: "“Every time HOST-B's cable is reseated (or the PC reboots), it gets no network for about 30 seconds. Its DHCP times out.”",
    repro: [{ type: "reseat", host: "HOST-B" }, { type: "traffic", sends: [{ from: "HOST-B", to: "HOST-A", kind: "ping" }] }],
    reproLabel: "Reseat HOST-B's cable, then HOST-B pings HOST-A at once",
    cause: "edge",
    good: (_s, run) => ({ ok: pingOk(run), why: pingOk(run) ? "the ping worked right after the reseat" : `no reply: ${run.results[0]?.fail}` }),
  },
  {
    id: "legacy",
    title: "Failover takes forever on floor 3",
    report: "“During yesterday's fibre test, the SW1↔SW3 link was unplugged and floor 3 lost the network for 30 seconds or more. On floors 1 and 2 a link failure is a blip.”",
    repro: [{ type: "link", link: "L13", up: true }, { type: "wait", seconds: 60 }, { type: "link", link: "L13", up: false }, { type: "traffic", sends: [{ from: "HOST-C", to: "HOST-A", kind: "ping" }] }],
    reproLabel: "Unplug the SW1↔SW3 cable, then HOST-C pings HOST-A at once",
    cause: "legacy",
    good: (_s, run) => ({ ok: pingOk(run), why: pingOk(run) ? "the ping worked right after the failure" : `no reply: ${run.results[0]?.fail}` }),
  },
];
export const stTicket = (id: StTicketId) => ST_TICKETS.find((t) => t.id === id)!;
const WARM: StSend[] = [
  { from: "HOST-A", to: "HOST-B", kind: "ping" },
  { from: "HOST-B", to: "HOST-C", kind: "ping" },
  { from: "HOST-C", to: "HOST-A", kind: "ping" },
];
export function stWarm(cfg: StCfg = stHealthy()): StState {
  let s = createStNet(cfg);
  s = stApply(s, { type: "traffic", sends: WARM, cmd: "Morning traffic" });
  return s;
}
export function stTicketState(id: StTicketId, seq: number): StState {
  const cfg = stHealthy();
  if (id === "loop") cfg.sw.SW3.ports["ge-0/0/2"].stpOff = true;
  if (id === "rogue") cfg.rogue = true;
  if (id === "cost") cfg.sw.SW3.ports["ge-0/0/1"].cost = 200000;
  if (id === "edge") cfg.sw.SW2.ports[HOST_PORT].edge = false;
  if (id === "legacy") cfg.sw.SW3.proto = "stp";
  // The broken configuration has been in place a while: the network converged on it, and the morning's traffic ran.
  let s = createStNet(cfg);
  if (id !== "loop") s = stApply(s, { type: "traffic", sends: WARM, cmd: "Morning traffic" });
  const t = stTicket(id);
  return { ...s, seq, ticket: id, runs: [], last: undefined, captures: [], capN: 0, counters: emptyCounters(), cfgSeq: 0, log: [{ seq, text: `Ticket opened: ${t.title}`, tone: "info" }] };
}
/** The last run of the ticket's test (its final traffic action). */
export function stLastRepro(s: StState): StRun | undefined {
  if (!s.ticket) return undefined;
  const t = stTicket(s.ticket);
  const want = t.repro.filter((a): a is Extract<StAction, { type: "traffic" }> => a.type === "traffic").at(-1)!.sends;
  return [...s.runs].reverse().find((r) => r.kind === "traffic" && r.results.length === want.length && r.results.every((x, i) => x.send.from === want[i].from && x.send.to === want[i].to && x.send.kind === want[i].kind));
}
export interface StProof {
  label: string;
  ok: boolean;
  detail: string;
}
export function stProofs(s: StState): StProof[] {
  if (!s.ticket) return [];
  const t = stTicket(s.ticket);
  const run = stLastRepro(s);
  const fresh = !!run && run.cfgSeq === s.cfgSeq;
  const g = run ? t.good(s, run) : undefined;
  const test: StProof = { label: `A fresh test: ${/^[A-Z][a-z]/.test(t.reproLabel) ? t.reproLabel[0].toLowerCase() + t.reproLabel.slice(1) : t.reproLabel} — and it works`, ok: !!g?.ok && fresh, detail: !run ? "not run yet" : !fresh ? "the network changed since the last test — run it again" : g!.why };
  const c = s.cfg;
  const root = s.tree.bridges.SW1?.root;
  switch (s.ticket) {
    case "loop": {
      const off = ST_SWITCHES.flatMap((sw) => ST_PORTS.filter((p) => c.sw[sw].ports[p].stpOff && p !== HOST_PORT).map((p) => `${sw} ${p}`));
      return [{ label: "Every inter-switch port takes part in spanning tree", ok: !off.length, detail: off.length ? `out of spanning tree: ${off.join(", ")}` : "all inter-switch ports run RSTP" }, { label: "Exactly one port of the triangle is Alternate (Discarding)", ok: ST_SWITCHES.flatMap((sw) => ["ge-0/0/1", "ge-0/0/2"].map((p) => s.tree.ports[pk(sw, p)]?.role)).filter((r) => r === "Alternate").length === 1, detail: alternates(s) }, test];
    }
    case "rogue":
      return [{ label: "SW1 is the root bridge again", ok: root === "SW1", detail: `root: ${root}` }, { label: "SW3 ge-0/0/11 can't let a switch take over (BPDU guard, root guard, or nothing plugged in)", ok: !c.rogue || c.sw.SW3.ports[SPARE].bpduGuard || c.sw.SW3.ports[SPARE].rootGuard || c.sw.SW3.ports[SPARE].shut, detail: `SW3 ge-0/0/11: ${c.rogue ? "small switch still plugged in" : "nothing plugged in"} · bpdu guard ${c.sw.SW3.ports[SPARE].bpduGuard ? "on" : "off"} · root guard ${c.sw.SW3.ports[SPARE].rootGuard ? "on" : "off"}` }, test];
    case "cost":
      return [{ label: "SW3's Root Port is its link to SW1 (ge-0/0/1)", ok: s.tree.bridges.SW3?.rootPort === "ge-0/0/1", detail: `SW3 root port ${s.tree.bridges.SW3?.rootPort ?? "none"} · cost via ge-0/0/1 ${c.sw.SW3.ports["ge-0/0/1"].cost}` }, test];
    case "edge":
      return [{ label: "HOST-B's port is an edge port", ok: s.tree.ports[pk("SW2", HOST_PORT)]?.edge ?? false, detail: `SW2 ge-0/0/10 edge: ${c.sw.SW2.ports[HOST_PORT].edge ? "yes" : "no"}` }, test];
    case "legacy":
      return [{ label: "Every switch runs RSTP", ok: ST_SWITCHES.every((sw) => c.sw[sw].proto === "rstp"), detail: ST_SWITCHES.map((sw) => `${sw} ${c.sw[sw].proto.toUpperCase()}`).join(" · ") }, test];
  }
}
const alternates = (s: StState) => ST_SWITCHES.flatMap((sw) => ["ge-0/0/1", "ge-0/0/2"].filter((p) => s.tree.ports[pk(sw, p)]?.role === "Alternate").map((p) => `${sw} ${p}`)).join(", ") || "none — every inter-switch port forwards";
export function stCauseFeedback(s: StState, cause: StCause): { right: boolean; consequence?: boolean; text: string } {
  const c = s.cfg;
  const t = s.ticket ? stTicket(s.ticket) : undefined;
  const right = !!t && t.cause === cause;
  const root = s.tree.bridges.SW1?.root ?? "?";
  const run = stLastRepro(s);
  const text: Record<StCause, string> = {
    link: `All three inter-switch links are ${ST_LINKS.every((l) => c.links[l]) ? "up (show interfaces status / terse: connected)" : `not up: ${ST_LINKS.filter((l) => !c.links[l]).map((l) => LINK_TEXT[l]).join(", ")} — but that is part of the test, and the network is built to survive one link failure`}.`,
    loop: right ? `Yes. SW3 ge-0/0/2 has been taken out of spanning tree (Cisco: spanning-tree bpdufilter enable · Junos: rstp interface ge-0/0/2 disable). It sends and hears no BPDUs, so nothing ever puts it in Discarding: it forwards, and SW2's end — hearing no BPDU — forwards too. All three links forward: a loop. ${run ? `The test: ${run.left.toLocaleString("en-US")} copies still circulating, ${run.flaps} MAC moves.` : ""}` : `Every inter-switch port runs spanning tree; one port is Alternate: ${alternates(s)}.`,
    rogue: right ? `Yes. The small switch on SW3 ge-0/0/11 has bridge priority 4096 — better than SW1's ${c.sw.SW1.priority}. The spare port was edge but had no BPDU guard or root guard, so on hearing its BPDUs it simply became an ordinary RSTP port and the small switch won the election and is now the root. Every switch re-pointed its Root Port toward SW3, and the Alternate moved to ${alternates(s)} — so HOST-A ↔ HOST-B now detours through SW3.` : `The root bridge is ${root}${root === "SW1" ? ", as designed" : ""}.`,
    priority: `Bridge priorities: ${ST_SWITCHES.map((sw) => `${sw} ${c.sw[sw].priority}`).join(", ")} — unchanged from the design (SW1 lowest). ${root !== "SW1" ? (root === "ROGUE" ? "Yet the Root ID names a bridge that is none of SW1, SW2 or SW3. Where does it come from? Follow the Root Ports toward it." : `Yet ${root} is root: compare the Root ID with the priorities above.`) : "The root is SW1."}`,
    cost: right ? `Yes. SW3 ge-0/0/1 (toward SW1) has cost ${c.sw.SW3.ports["ge-0/0/1"].cost}. SW3 compares its paths to the root: via ge-0/0/1 = 0 + ${c.sw.SW3.ports["ge-0/0/1"].cost}; via SW2 = ${s.tree.bridges.SW2?.cost} + ${c.sw.SW3.ports["ge-0/0/2"].cost} = ${(s.tree.bridges.SW2?.cost ?? 0) + c.sw.SW3.ports["ge-0/0/2"].cost}. The lower wins, so ge-0/0/2 is Root Port and ge-0/0/1 Alternate: floor 3's traffic to floor 1 detours through SW2. The cost that counts is the one on the RECEIVING port.` : `Port costs: ${ST_SWITCHES.map((sw) => `${sw} ${c.sw[sw].ports["ge-0/0/1"].cost}/${c.sw[sw].ports["ge-0/0/2"].cost}`).join(", ")} — all default (20000).`,
    edge: right ? `Yes. SW2 ge-0/0/10 (HOST-B) is not an edge port. When its link comes up, RSTP proposes to the neighbor — but a PC never answers a proposal, so the port falls back to the slow path: Discarding, then Learning, ${2 * FWD_DELAY} s in total, before it forwards. Edge (Cisco spanning-tree portfast · Junos edge) lets it forward at once.` : `The host ports are edge: ${ST_HOSTS.map((h) => `${h} ${c.sw[HOST_SW[h]].ports[HOST_PORT].edge ? "edge" : "NOT edge"}`).join(", ")}.`,
    legacy: right ? `Yes. SW3 runs legacy 802.1D STP (Cisco spanning-tree mode pvst · Junos protocols stp). When its Root Port's link failed, the Alternate port could not take over at once: legacy STP goes Listening (${FWD_DELAY} s) then Learning (${FWD_DELAY} s) — ${2 * FWD_DELAY} s without forwarding (plus ${MAX_AGE} s of max age when the failure is indirect). RSTP's Alternate port becomes Root Port immediately.` : `All switches run RSTP: ${ST_SWITCHES.map((sw) => `${sw} ${c.sw[sw].proto.toUpperCase()}`).join(", ")}.`,
    host: "The hosts' network cards work: each one sends and receives normally whenever the switch port in front of it forwards. Look at the switches, not the hosts.",
  };
  return { right, text: text[cause] };
}
