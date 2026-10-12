import { spClone, type SpBase, type SpLine, type SpMoment, type SpRun, type SpTok } from "@/components/sp-lab/spKit";

/**
 * IS-IS Lab network — a six-router provider core, simulated control plane first.
 *
 *            P1 ───────── P2                 PE1 ge-0/0/0 ↔ P1 ge-0/0/0   192.0.2.0/31
 *          ╱  │             ╲                P1  ge-0/0/1 ↔ P2 ge-0/0/0   192.0.2.2/31
 *       PE1   │ (P1–P3 rung)  PE2            P2  ge-0/0/1 ↔ PE2 ge-0/0/0  192.0.2.4/31
 *          ╲  │             ╱                PE1 ge-0/0/1 ↔ P3 ge-0/0/0   192.0.2.6/31
 *            P3 ───────── P4                 P3  ge-0/0/1 ↔ P4 ge-0/0/0   192.0.2.8/31
 *                                            P4  ge-0/0/1 ↔ PE2 ge-0/0/1  192.0.2.10/31
 *                                            P1  ge-0/0/2 ↔ P3 ge-0/0/2   192.0.2.12/31 (cabled, IS-IS not enabled)
 *
 * PE1, P1, P2 and PE2 are the routers of the guided lesson (same System IDs, loopbacks and P1–P2 interfaces); P3 and
 * P4 add a second path so that SPF, metrics, ECMP and the overload bit have something to decide.
 *
 * Modeled (ISO/IEC 10589, RFC 1195, RFC 5303, RFC 5305, RFC 5309, RFC 3277-style hello padding):
 * - A router runs IS-IS when it has the process and a NET. Area = the NET minus System ID and NSEL.
 * - Every core link is a point-to-point circuit (no DIS, no pseudonode). Hellos (P2P IIH) ride straight in 802.3/LLC
 *   frames: they need the interface in IS-IS (and, on Junos, `family iso` on the unit) — no IP involved.
 * - The levels a circuit runs = the router's is-type ∩ the circuit's circuit-type. Two ends form an adjacency at the
 *   levels they share; Level 1 additionally needs the same area, Level 2 does not care about areas.
 * - Hello padding: each IIH is padded to the interface MTU (MTU − 17 bytes of 802.3/LLC header). A neighbor whose MTU
 *   is smaller drops those frames as giants, so it never hears the larger side — a one-way failure.
 * - Hello authentication (HMAC-MD5): a router with a key drops hellos without the right key; a router without a key
 *   accepts hellos regardless (it ignores the authentication TLV).
 * - Three-way handshake (RFC 5303): UP when both hear each other; a router that hears its neighbor but is not heard
 *   back stays INIT.
 * - LSPs: each router originates one LSP per level it runs, listing UP adjacencies (TLV 22, its own outgoing metric)
 *   and its prefixes (TLV 135: Loopback0 /32 and the /31 of each IS-IS interface). Any content change → sequence + 1.
 *   LSPs flood over UP adjacencies of that level; a router that can no longer be reached keeps a stale copy (it ages
 *   out after 1200 s; the lab clock never gets that far).
 * - SPF per router per level on its own LSDB: a link counts only if both ends list each other (two-way check); a node
 *   with the overload bit is never used for transit (its own prefixes stay reachable). Equal-cost paths are all kept.
 * - RIB: connected routes beat IS-IS; an L1 route beats an L2 route for the same prefix. Forwarding is hop-by-hop
 *   longest-prefix match; with equal-cost next hops a flow is hashed onto one of them (deterministically per flow).
 * - Timing: a local change is acted on at once; an adjacency lost because the neighbor stopped hearing us goes Down
 *   after the 30 s hold time (the lab clock jumps). Hellos every 10 s.
 */

export type IsR = "PE1" | "P1" | "P2" | "PE2" | "P3" | "P4";
export const IS_ROUTERS: IsR[] = ["PE1", "P1", "P2", "PE2", "P3", "P4"];
export type IfName = "ge-0/0/0" | "ge-0/0/1" | "ge-0/0/2";
export type Lvl = 1 | 2;
export type IsType = "level-1" | "level-1-2" | "level-2-only";
export const IS_SYS: Record<IsR, string> = { PE1: "0000.0000.0001", P1: "0000.0000.0002", P2: "0000.0000.0003", PE2: "0000.0000.0004", P3: "0000.0000.0005", P4: "0000.0000.0006" };
export const IS_LO: Record<IsR, string> = { PE1: "10.0.0.1", P1: "10.0.0.2", P2: "10.0.0.3", PE2: "10.0.0.4", P3: "10.0.0.5", P4: "10.0.0.6" };
export const IS_AREA = "49.0001";
export const HOLD = 30;
export const HELLO = 10;
export const LSP_LIFE = 1200;
export const DEFAULT_MTU = 1514;
export const isNetOf = (r: IsR, area = IS_AREA) => `${area}.${IS_SYS[r]}.00`;

export interface IsLink {
  id: string;
  a: IsR;
  ai: IfName;
  aip: string;
  b: IsR;
  bi: IfName;
  bip: string;
  net: string;
}
export const IS_LINKS: IsLink[] = [
  { id: "PE1-P1", a: "PE1", ai: "ge-0/0/0", aip: "192.0.2.0", b: "P1", bi: "ge-0/0/0", bip: "192.0.2.1", net: "192.0.2.0" },
  { id: "P1-P2", a: "P1", ai: "ge-0/0/1", aip: "192.0.2.2", b: "P2", bi: "ge-0/0/0", bip: "192.0.2.3", net: "192.0.2.2" },
  { id: "P2-PE2", a: "P2", ai: "ge-0/0/1", aip: "192.0.2.4", b: "PE2", bi: "ge-0/0/0", bip: "192.0.2.5", net: "192.0.2.4" },
  { id: "PE1-P3", a: "PE1", ai: "ge-0/0/1", aip: "192.0.2.6", b: "P3", bi: "ge-0/0/0", bip: "192.0.2.7", net: "192.0.2.6" },
  { id: "P3-P4", a: "P3", ai: "ge-0/0/1", aip: "192.0.2.8", b: "P4", bi: "ge-0/0/0", bip: "192.0.2.9", net: "192.0.2.8" },
  { id: "P4-PE2", a: "P4", ai: "ge-0/0/1", aip: "192.0.2.10", b: "PE2", bi: "ge-0/0/1", bip: "192.0.2.11", net: "192.0.2.10" },
  { id: "P1-P3", a: "P1", ai: "ge-0/0/2", aip: "192.0.2.12", b: "P3", bi: "ge-0/0/2", bip: "192.0.2.13", net: "192.0.2.12" },
];
export interface IsIfInfo {
  r: IsR;
  ifn: IfName;
  ip: string;
  peer: IsR;
  peerIf: IfName;
  peerIp: string;
  link: IsLink;
}
export function isIfs(r: IsR): IsIfInfo[] {
  return IS_LINKS.flatMap((l) => (l.a === r ? [{ r, ifn: l.ai, ip: l.aip, peer: l.b, peerIf: l.bi, peerIp: l.bip, link: l }] : l.b === r ? [{ r, ifn: l.bi, ip: l.bip, peer: l.a, peerIf: l.ai, peerIp: l.aip, link: l }] : [])).sort((x, y) => x.ifn.localeCompare(y.ifn));
}
export const isIf = (r: IsR, ifn: string) => isIfs(r).find((i) => i.ifn === ifn);
export const isIfTo = (r: IsR, peer: IsR) => isIfs(r).find((i) => i.peer === peer);
/** Documentation MACs (RFC 7042): 00:00:5E:00:53:<router><if>. */
export const isMac = (r: IsR, ifn: IfName) => `00:00:5E:00:53:${(IS_ROUTERS.indexOf(r) + 1).toString(16).toUpperCase()}${ifn.slice(-1)}`;

// ---------------------------------------------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------------------------------------------
export interface IsIf {
  isis: boolean;
  passive: boolean;
  circuit: IsType;
  metric: number;
  mtu: number;
  /** HMAC-MD5 hello key ("" = none). */
  key: string;
  shut: boolean;
  /** Junos `family iso` on the unit (IOS XR needs nothing: CLNS runs on any IS-IS interface). */
  iso: boolean;
}
export interface IsRtr {
  /** `router isis CORE` / `protocols isis` present. */
  on: boolean;
  net: string;
  isType: IsType;
  overload: boolean;
  /** Loopback0 / lo0.0 in IS-IS (passive). */
  lo: boolean;
  ifs: Partial<Record<IfName, IsIf>>;
}
export type IsCfg = Record<IsR, IsRtr>;
const ifc = (isis = true): IsIf => ({ isis, passive: false, circuit: "level-1-2", metric: 10, mtu: DEFAULT_MTU, key: "", shut: false, iso: true });
export function isHealthy(): IsCfg {
  const c = {} as IsCfg;
  for (const r of IS_ROUTERS) {
    const ifs: Partial<Record<IfName, IsIf>> = {};
    for (const i of isIfs(r)) ifs[i.ifn] = ifc(i.link.id !== "P1-P3");
    c[r] = { on: true, net: isNetOf(r), isType: "level-2-only", overload: false, lo: true, ifs };
  }
  return c;
}
export const NET_RE = /^[0-9a-f]{2}(\.[0-9a-f]{4}){1,4}\.[0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4}\.00$/i;
export const areaOf = (net: string) => net.split(".").slice(0, -4).join(".");
export const sysOf = (net: string) => net.split(".").slice(-4, -1).join(".");
export const levelsOfType = (t: IsType): Lvl[] => (t === "level-1" ? [1] : t === "level-2-only" ? [2] : [1, 2]);
/** Does this router run IS-IS at all? */
export const isRunning = (c: IsCfg, r: IsR) => c[r].on && NET_RE.test(c[r].net);
/** The levels an interface runs (is-type ∩ circuit-type), or [] if it sends no hellos. */
export function ifLevels(c: IsCfg, r: IsR, ifn: IfName): Lvl[] {
  const i = c[r].ifs[ifn];
  if (!i || !isRunning(c, r) || !i.isis || i.shut || !i.iso) return [];
  const a = levelsOfType(c[r].isType);
  const b = levelsOfType(i.circuit);
  return a.filter((l) => b.includes(l));
}
export const linkUp = (s: { phys: Record<string, boolean>; cfg: IsCfg }, l: IsLink) => s.phys[l.id] && !s.cfg[l.a].ifs[l.ai]?.shut && !s.cfg[l.b].ifs[l.bi]?.shut;

// ---------------------------------------------------------------------------------------------------------------
// Adjacencies
// ---------------------------------------------------------------------------------------------------------------
export type AdjState = "UP" | "INIT";
export interface IsAdj {
  nbr: IsR;
  state: AdjState;
  lvls: Lvl[];
  since: number;
}
/** Keyed "R|ge-0/0/n": the adjacency this router holds on that interface. */
export type AdjMap = Record<string, IsAdj>;
export const adjKey = (r: IsR, ifn: string) => `${r}|${ifn}`;
/** Why `rx` does not accept the hellos `tx` sends on this link (undefined = accepted). */
export function hearFail(c: IsCfg, phys: Record<string, boolean>, l: IsLink, tx: IsR, rx: IsR): string | undefined {
  const txi = tx === l.a ? l.ai : l.bi;
  const rxi = rx === l.a ? l.ai : l.bi;
  const T = c[tx].ifs[txi]!;
  const R = c[rx].ifs[rxi]!;
  if (!phys[l.id] || T.shut || R.shut) return "link down";
  const tl = ifLevels(c, tx, txi);
  if (!tl.length) return "sends no hellos";
  if (T.passive) return "passive (sends no hellos)";
  const rl = ifLevels(c, rx, rxi);
  if (!rl.length || R.passive) return "not listening";
  if (T.mtu - 17 > R.mtu - 17) return `giant (padded IIH ${T.mtu - 17} B > MTU ${R.mtu - 17} B)`;
  if (R.key && R.key !== T.key) return T.key ? "authentication failed (wrong key)" : "authentication TLV not found";
  const common = tl.filter((x) => rl.includes(x)).filter((x) => x === 2 || areaOf(c[tx].net) === areaOf(c[rx].net));
  if (!common.length) {
    const lvlCommon = tl.filter((x) => rl.includes(x));
    return lvlCommon.length ? "area mismatch (Level 1 needs the same area)" : `no common level (IIH circuit type ${tl.join("/")} vs ${rl.join("/")})`;
  }
  return undefined;
}
export function commonLevels(c: IsCfg, l: IsLink): Lvl[] {
  const a = ifLevels(c, l.a, l.ai);
  const b = ifLevels(c, l.b, l.bi);
  return a.filter((x) => b.includes(x)).filter((x) => x === 2 || areaOf(c[l.a].net) === areaOf(c[l.b].net));
}
export function computeAdj(c: IsCfg, phys: Record<string, boolean>, prev: AdjMap, clock: number): AdjMap {
  const out: AdjMap = {};
  for (const l of IS_LINKS) {
    const aHearsB = !hearFail(c, phys, l, l.b, l.a);
    const bHearsA = !hearFail(c, phys, l, l.a, l.b);
    const lv = commonLevels(c, l);
    const set = (r: IsR, ifn: IfName, nbr: IsR, state: AdjState) => {
      const k = adjKey(r, ifn);
      const p = prev[k];
      out[k] = { nbr, state, lvls: lv, since: p && p.state === state && p.nbr === nbr ? p.since : clock };
    };
    if (aHearsB) set(l.a, l.ai, l.b, bHearsA ? "UP" : "INIT");
    if (bHearsA) set(l.b, l.bi, l.a, aHearsB ? "UP" : "INIT");
  }
  return out;
}
export const upAdj = (adj: AdjMap, r: IsR, lvl: Lvl) => isIfs(r).filter((i) => adj[adjKey(r, i.ifn)]?.state === "UP" && adj[adjKey(r, i.ifn)].lvls.includes(lvl));

// ---------------------------------------------------------------------------------------------------------------
// LSPs and the link-state database
// ---------------------------------------------------------------------------------------------------------------
export interface IsPfx {
  p: string;
  len: number;
  metric: number;
}
export interface IsLsp {
  orig: IsR;
  lvl: Lvl;
  seq: number;
  gen: number;
  ol: boolean;
  area: string;
  nbrs: { to: IsR; metric: number }[];
  pfx: IsPfx[];
  csum: number;
}
/** Per router: per level: originator → the copy it holds. */
export type DbMap = Record<IsR, Record<Lvl, Partial<Record<IsR, IsLsp>>>>;
const content = (l: Omit<IsLsp, "seq" | "gen" | "csum">) => JSON.stringify([l.ol, l.area, l.nbrs, l.pfx]);
/** ISO 10589 Fletcher checksum over a byte serialization of the LSP (from the LSP ID to the end, lifetime excluded). */
function lspChecksum(l: Omit<IsLsp, "csum">): number {
  const bytes: number[] = [];
  const push = (s: string) => {
    for (const ch of s) bytes.push(ch.charCodeAt(0) & 0xff);
  };
  push(`${IS_SYS[l.orig]}.00-00`);
  bytes.push((l.seq >> 24) & 0xff, (l.seq >> 16) & 0xff, (l.seq >> 8) & 0xff, l.seq & 0xff, 0, 0, l.ol ? 0x04 | 0x03 : 0x03);
  push(content(l));
  let c0 = 0;
  let c1 = 0;
  for (const b of bytes) {
    c0 = (c0 + b) % 255;
    c1 = (c1 + c0) % 255;
  }
  const n = bytes.length;
  const k = 13;
  let x = ((((n - k) * c0 - c1) % 255) + 255) % 255;
  let y = ((((-(n - k + 1) * c0 + c1) % 255) + 255 * 255) % 255) % 255;
  if (x === 0) x = 255;
  if (y === 0) y = 255;
  return (x << 8) | y;
}
/** What router r would put in its LSP for level lvl right now (undefined = it doesn't run that level). */
export function lspBody(c: IsCfg, adj: AdjMap, r: IsR, lvl: Lvl): Omit<IsLsp, "seq" | "gen" | "csum"> | undefined {
  if (!isRunning(c, r) || !levelsOfType(c[r].isType).includes(lvl)) return undefined;
  const nbrs = upAdj(adj, r, lvl)
    .map((i) => ({ to: adj[adjKey(r, i.ifn)].nbr, metric: c[r].ifs[i.ifn]!.metric }))
    .sort((a, b) => IS_ROUTERS.indexOf(a.to) - IS_ROUTERS.indexOf(b.to));
  const pfx: IsPfx[] = [];
  if (c[r].lo) pfx.push({ p: IS_LO[r], len: 32, metric: 10 });
  for (const i of isIfs(r)) if (ifLevels(c, r, i.ifn).includes(lvl)) pfx.push({ p: i.link.net, len: 31, metric: c[r].ifs[i.ifn]!.metric });
  return { orig: r, lvl, ol: c[r].overload, area: areaOf(c[r].net), nbrs, pfx };
}

// ---------------------------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------------------------
export interface IsSnap {
  adj: AdjMap;
  db: DbMap;
}
export interface IsSys {
  t: number;
  dev: IsR;
  kind: "adj-up" | "adj-down" | "adj-init" | "auth" | "spf" | "commit";
  ifn?: IfName;
  nbr?: IsR;
  lvl?: Lvl;
  why?: string;
}
export interface IsCap {
  t: number;
  /** "R|ge-0/0/n". */
  at: string;
  dir: "in" | "out";
  kind: "IIH" | "LSP" | "CSNP" | "PSNP" | "ICMP" | "UDP";
  text: string;
  drop?: string;
}
export interface IsCtr {
  iihIn: number;
  iihOut: number;
  iihDrop: number;
  lspIn: number;
  lspOut: number;
  giants: number;
  authFail: number;
  pktIn: number;
  pktOut: number;
}
export interface IsSpf {
  t: number;
  lvl: Lvl;
  trig: string;
  first: string;
  nodes: number;
}
export interface IsPath {
  hops: { r: IsR; inIf?: IfName; outIf?: IfName; ecmp: number }[];
  result: "ok" | "unreach" | "ttl";
  at: IsR;
}
export interface IsTest {
  id: number;
  kind: "ping" | "trace";
  from: IsR;
  src: string;
  dst: string;
  fwd: IsPath;
  back?: IsPath;
  ok: boolean;
  cfgSeq: number;
}
export interface IsState extends SpBase<IsSnap> {
  cfg: IsCfg;
  hist: Record<IsR, IsRtr[]>;
  phys: Record<string, boolean>;
  adj: AdjMap;
  own: Record<IsR, Partial<Record<Lvl, IsLsp>>>;
  db: DbMap;
  sys: IsSys[];
  caps: IsCap[];
  ctr: Record<string, IsCtr>;
  spf: Record<IsR, IsSpf[]>;
  tests: IsTest[];
  /** Challenge 6: PE1's IS-IS was wiped (so rebuilding it can be checked). */
  wiped?: boolean;
}

export type IsAction =
  | { type: "cfg"; dev: IsR; cfg: IsRtr; text: string }
  | { type: "link"; link: string; up: boolean }
  | { type: "ping"; from: IsR; dst: string; src?: string }
  | { type: "trace"; from: IsR; dst: string; src?: string }
  | { type: "ticket"; id: IsTicketId }
  | { type: "wipe-pe1" }
  | { type: "clear-counters" }
  /** Learn: a configuration change described in plain words (applied to every router listed). */
  | { type: "set"; changes: { dev: IsR; f: (r: IsRtr) => void }[]; text: string }
  /** Learn: start from an empty core and let everything come up. */
  | { type: "boot" };

const emptyDb = (): DbMap => Object.fromEntries(IS_ROUTERS.map((r) => [r, { 1: {}, 2: {} }])) as DbMap;
const zeroCtr = (): IsCtr => ({ iihIn: 0, iihOut: 0, iihDrop: 0, lspIn: 0, lspOut: 0, giants: 0, authFail: 0, pktIn: 0, pktOut: 0 });
export const ctrKey = (r: IsR, ifn: string) => `${r} ${ifn}`;

/** A converged, healthy core, as after a normal morning (no run on screen). */
export function createIsNet(seq = 0): IsState {
  const cfg = isHealthy();
  const phys = Object.fromEntries(IS_LINKS.map((l) => [l.id, true]));
  const base: IsState = {
    seq,
    cfgSeq: 0,
    clock: 3600,
    runs: [],
    log: [],
    cfg,
    hist: Object.fromEntries(IS_ROUTERS.map((r) => [r, []])) as unknown as Record<IsR, IsRtr[]>,
    phys,
    adj: {},
    own: Object.fromEntries(IS_ROUTERS.map((r) => [r, {}])) as IsState["own"],
    db: emptyDb(),
    sys: [],
    caps: [],
    ctr: Object.fromEntries(IS_ROUTERS.flatMap((r) => isIfs(r).map((i) => [ctrKey(r, i.ifn), zeroCtr()]))),
    spf: Object.fromEntries(IS_ROUTERS.map((r) => [r, []])) as unknown as Record<IsR, IsSpf[]>,
    tests: [],
  };
  // Converge silently: adjacencies, LSPs (sequence numbers that look like a morning of uptime), synchronized LSDBs.
  base.adj = computeAdj(cfg, phys, {}, 0);
  for (const r of IS_ROUTERS)
    for (const l of [1, 2] as Lvl[]) {
      const b = lspBody(cfg, base.adj, r, l);
      if (b) base.own[r][l] = withSum({ ...b, seq: 3 + (IS_ROUTERS.indexOf(r) % 3), gen: base.clock - 120 - IS_ROUTERS.indexOf(r) * 97 });
    }
  base.db = flood(cfg, base.adj, base.own, emptyDb());
  for (const r of IS_ROUTERS) base.spf[r].push({ t: 2, lvl: 2, trig: "NEWADJ", first: `${r}.00-00`, nodes: 6 });
  // The log since boot: every adjacency came up a few seconds after power-on.
  for (const [k, a] of Object.entries(base.adj)) {
    const [r, ifn] = k.split("|") as [IsR, IfName];
    base.sys.push({ t: 2 + IS_ROUTERS.indexOf(r), dev: r, kind: "adj-up", ifn, nbr: a.nbr, lvl: 2 });
  }
  base.sys.sort((x, y) => x.t - y.t);
  base.log.push({ seq: 0, t: base.clock, text: "Six-router Level-2 core, converged: every adjacency Up, every LSDB identical.", tone: "info" });
  return base;
}
const withSum = (l: Omit<IsLsp, "csum">): IsLsp => ({ ...l, csum: lspChecksum(l) });
/** LSP refresh: every router re-originates an unchanged LSP 900 s after the last version (sequence + 1, new lifetime). */
export const LSP_REFRESH = 900;
function refresh(s: IsState) {
  let any = false;
  for (const r of IS_ROUTERS)
    for (const lvl of [1, 2] as Lvl[]) {
      const l = s.own[r][lvl];
      if (l && s.clock - l.gen >= LSP_REFRESH) {
        s.own[r][lvl] = withSum({ ...l, seq: l.seq + 1, gen: s.clock });
        any = true;
      }
    }
  if (any) s.db = flood(s.cfg, s.adj, s.own, s.db);
}

/** Copy every originator's current LSP to every router that can reach it over UP adjacencies; keep stale copies. */
function flood(c: IsCfg, adj: AdjMap, own: IsState["own"], prevDb: DbMap): DbMap {
  const db = spClone(prevDb);
  for (const lvl of [1, 2] as Lvl[]) {
    for (const r of IS_ROUTERS) {
      if (!isRunning(c, r) || !levelsOfType(c[r].isType).includes(lvl)) {
        db[r][lvl] = {};
        continue;
      }
      for (const o of reachOver(adj, r, lvl)) {
        const l = own[o][lvl];
        if (l) db[r][lvl][o] = l;
      }
      const mine = own[r][lvl];
      if (mine) db[r][lvl][r] = mine;
    }
  }
  return db;
}
/** Routers reachable from r through UP adjacencies of one level (flooding scope). */
export function reachOver(adj: AdjMap, r: IsR, lvl: Lvl): IsR[] {
  const seen = new Set<IsR>([r]);
  const q: IsR[] = [r];
  while (q.length) {
    const x = q.shift()!;
    for (const i of upAdj(adj, x, lvl)) {
      const n = adj[adjKey(x, i.ifn)].nbr;
      if (!seen.has(n) && adj[adjKey(n, i.peerIf)]?.state === "UP") {
        seen.add(n);
        q.push(n);
      }
    }
  }
  return [...seen];
}
/** Flooding waves of one LSP from its originator: wave k = links crossed at distance k. */
function floodWaves(adj: AdjMap, from: IsR, lvl: Lvl): { a: IsR; b: IsR; ifn: IfName }[][] {
  const waves: { a: IsR; b: IsR; ifn: IfName }[][] = [];
  const seen = new Set<IsR>([from]);
  let front: IsR[] = [from];
  while (front.length) {
    const wave: { a: IsR; b: IsR; ifn: IfName }[] = [];
    const next: IsR[] = [];
    for (const x of front)
      for (const i of upAdj(adj, x, lvl)) {
        const n = adj[adjKey(x, i.ifn)].nbr;
        if (adj[adjKey(n, i.peerIf)]?.state !== "UP" || seen.has(n)) continue;
        wave.push({ a: x, b: n, ifn: i.ifn });
        if (!next.includes(n)) next.push(n);
      }
    next.forEach((n) => seen.add(n));
    if (wave.length) waves.push(wave);
    front = next;
  }
  return waves;
}

// ---------------------------------------------------------------------------------------------------------------
// SPF, RIB, forwarding
// ---------------------------------------------------------------------------------------------------------------
export interface SpfNode {
  r: IsR;
  dist: number;
  /** First-hop neighbors (ECMP) from the root. */
  first: IsR[];
  /** Predecessors on shortest paths. */
  prev: IsR[];
}
export function spfTree(db: DbMap, root: IsR, lvl: Lvl): SpfNode[] {
  const lsdb = db[root][lvl];
  if (!lsdb[root]) return [];
  const dist = new Map<IsR, number>([[root, 0]]);
  const first = new Map<IsR, Set<IsR>>([[root, new Set()]]);
  const prev = new Map<IsR, Set<IsR>>([[root, new Set()]]);
  const done = new Set<IsR>();
  for (;;) {
    let u: IsR | undefined;
    for (const [k, d] of dist) if (!done.has(k) && (u === undefined || d < dist.get(u)!)) u = k;
    if (!u) break;
    done.add(u);
    const lu = lsdb[u];
    if (!lu) continue;
    if (u !== root && lu.ol) continue; // overload: reachable, never transit
    for (const e of lu.nbrs) {
      const lv = lsdb[e.to];
      if (!lv || !lv.nbrs.some((x) => x.to === u)) continue; // two-way check
      const nd = dist.get(u)! + e.metric;
      const viaFirst = u === root ? new Set([e.to]) : first.get(u)!;
      const cur = dist.get(e.to);
      if (cur === undefined || nd < cur) {
        dist.set(e.to, nd);
        first.set(e.to, new Set(viaFirst));
        prev.set(e.to, new Set([u]));
      } else if (nd === cur && !done.has(e.to)) {
        viaFirst.forEach((f) => first.get(e.to)!.add(f));
        prev.get(e.to)!.add(u);
      }
    }
  }
  return [...done].map((r) => ({ r, dist: dist.get(r)!, first: [...first.get(r)!].sort((a, b) => IS_ROUTERS.indexOf(a) - IS_ROUTERS.indexOf(b)), prev: [...prev.get(r)!] })).sort((a, b) => a.dist - b.dist || IS_ROUTERS.indexOf(a.r) - IS_ROUTERS.indexOf(b.r));
}
export interface IsRoute {
  p: string;
  len: number;
  kind: "C" | "L" | "i L1" | "i L2";
  metric: number;
  nh: { ip: string; ifn: IfName; nbr: IsR }[];
  /** For "C"/"L": the interface. */
  ifn?: string;
}
export const ipNum = (ip: string) => ip.split(".").reduce((a, o) => a * 256 + Number(o), 0);
export const inPfx = (ip: string, p: string, len: number) => len === 0 || Math.floor(ipNum(ip) / 2 ** (32 - len)) === Math.floor(ipNum(p) / 2 ** (32 - len));
export function isRib(c: IsCfg, phys: Record<string, boolean>, adj: AdjMap, db: DbMap, r: IsR): IsRoute[] {
  const out: IsRoute[] = [];
  out.push({ p: IS_LO[r], len: 32, kind: "L", metric: 0, nh: [], ifn: "lo0" });
  for (const i of isIfs(r)) {
    if (!linkUp({ phys, cfg: c }, i.link)) continue;
    out.push({ p: i.link.net, len: 31, kind: "C", metric: 0, nh: [], ifn: i.ifn });
    out.push({ p: i.ip, len: 32, kind: "L", metric: 0, nh: [], ifn: i.ifn });
  }
  const isisRoutes = new Map<string, IsRoute>();
  for (const lvl of [2, 1] as Lvl[]) {
    const tree = spfTree(db, r, lvl);
    for (const node of tree) {
      const l = db[r][lvl][node.r];
      if (!l) continue;
      for (const pf of l.pfx) {
        if (out.some((x) => x.p === pf.p && x.len === pf.len)) continue;
        const cost = node.dist + pf.metric;
        const key = `${pf.p}/${pf.len}`;
        const cur = isisRoutes.get(key);
        const nh = node.r === r ? [] : node.first.map((f) => {
          const i = isIfs(r).find((x) => adj[adjKey(r, x.ifn)]?.nbr === f && adj[adjKey(r, x.ifn)]?.state === "UP")!;
          return { ip: i.peerIp, ifn: i.ifn, nbr: f };
        });
        if (node.r === r) continue;
        const kind = lvl === 1 ? "i L1" : "i L2";
        if (!cur || (lvl === 1 && cur.kind === "i L2") || (cur.kind === kind && cost < cur.metric)) isisRoutes.set(key, { p: pf.p, len: pf.len, kind, metric: cost, nh });
        else if (cur.kind === kind && cost === cur.metric) for (const h of nh) if (!cur.nh.some((x) => x.ip === h.ip)) cur.nh.push(h);
      }
    }
  }
  for (const rt of isisRoutes.values()) rt.nh.sort((a, b) => a.ifn.localeCompare(b.ifn));
  return [...out, ...isisRoutes.values()].sort((a, b) => ipNum(a.p) - ipNum(b.p) || a.len - b.len);
}
export function lookup(rib: IsRoute[], ip: string): IsRoute | undefined {
  return rib.filter((x) => inPfx(ip, x.p, x.len)).sort((a, b) => b.len - a.len)[0];
}
export const ownerOf = (ip: string): IsR | undefined => IS_ROUTERS.find((r) => IS_LO[r] === ip || isIfs(r).some((i) => i.ip === ip));
/** Deterministic per-flow choice among equal-cost next hops. */
const flowHash = (src: string, dst: string, r: IsR) => (ipNum(src) * 31 + ipNum(dst) * 17 + IS_ROUTERS.indexOf(r) * 7) % 9973;
export function forward(c: IsCfg, phys: Record<string, boolean>, adj: AdjMap, db: DbMap, from: IsR, src: string, dst: string, ttl = 64): IsPath {
  const hops: IsPath["hops"] = [];
  let r = from;
  let inIf: IfName | undefined;
  for (let k = 0; k < ttl; k++) {
    if (IS_LO[r] === dst || isIfs(r).some((i) => i.ip === dst)) {
      hops.push({ r, inIf, ecmp: 0 });
      return { hops, result: "ok", at: r };
    }
    const rt = lookup(isRib(c, phys, adj, db, r), dst);
    if (!rt) {
      hops.push({ r, inIf, ecmp: 0 });
      return { hops, result: "unreach", at: r };
    }
    if (rt.kind === "C") {
      const i = isIf(r, rt.ifn!)!;
      hops.push({ r, inIf, outIf: i.ifn, ecmp: 1 });
      if (i.peerIp === dst && linkUp({ phys, cfg: c }, i.link)) {
        hops.push({ r: i.peer, inIf: i.peerIf, ecmp: 0 });
        return { hops, result: "ok", at: i.peer };
      }
      return { hops, result: "unreach", at: r };
    }
    const pick = rt.nh[flowHash(src, dst, r) % rt.nh.length];
    hops.push({ r, inIf, outIf: pick.ifn, ecmp: rt.nh.length });
    const i = isIf(r, pick.ifn)!;
    inIf = i.peerIf;
    r = i.peer;
  }
  return { hops, result: "ttl", at: r };
}

// ---------------------------------------------------------------------------------------------------------------
// Applying changes (one place: configuration, links) and the run that shows the control plane reacting
// ---------------------------------------------------------------------------------------------------------------
const C = { iih: "cyan", lsp: "violet", snp: "amber", data: "green", bad: "red" } as const;
function addCap(s: IsState, at: string, dir: "in" | "out", kind: IsCap["kind"], text: string, drop?: string) {
  s.caps.push({ t: s.clock, at, dir, kind, text, drop });
  if (s.caps.length > 400) s.caps.splice(0, s.caps.length - 400);
}
const ctr = (s: IsState, r: IsR, ifn: string) => (s.ctr[ctrKey(r, ifn)] ??= zeroCtr());
export const isLspId = (r: IsR) => `${r}.00-00`;
export const hex8 = (n: number) => `0x${n.toString(16).padStart(8, "0")}`;

/** Recompute adjacencies → LSPs → LSDBs after a change, and build the run that shows it, moment by moment. */
function converge(prev: IsState, next: IsState, why: string, opts: { show?: boolean; holdRemote?: boolean } = {}): IsState {
  const s = next;
  refresh(s);
  const oldAdj = prev.adj;
  const newAdj = computeAdj(s.cfg, s.phys, oldAdj, s.clock);
  // Adjacencies lost because the neighbor stopped hearing us (not a local change, not a dead link) wait for the hold time.
  const lost = Object.keys(oldAdj).filter((k) => oldAdj[k].state === "UP" && newAdj[k]?.state !== "UP");
  const born = Object.keys(newAdj).filter((k) => newAdj[k].state === "UP" && oldAdj[k]?.state !== "UP");
  const initNow = Object.keys(newAdj).filter((k) => newAdj[k].state === "INIT" && oldAdj[k]?.state !== "INIT");
  const linkOf = (k: string) => {
    const [r, ifn] = k.split("|") as [IsR, IfName];
    return isIf(r, ifn)!;
  };
  const remoteLoss = lost.some((k) => {
    const i = linkOf(k);
    return linkUp(s, i.link) && ifLevels(s.cfg, i.r, i.ifn).length > 0;
  });
  if (remoteLoss && opts.holdRemote !== false) s.clock += HOLD;
  for (const k of Object.keys(newAdj)) {
    const p = oldAdj[k];
    const n = newAdj[k];
    if (!p || p.state !== n.state || p.nbr !== n.nbr) n.since = s.clock;
  }
  s.adj = newAdj;

  // Syslog: adjacency changes and why, plus drops the receiver can see.
  for (const k of lost) {
    const i = linkOf(k);
    const peerHears = !hearFail(s.cfg, s.phys, i.link, i.r, i.peer);
    const meHears = !hearFail(s.cfg, s.phys, i.link, i.peer, i.r);
    const why2 = !linkUp(s, i.link) ? "interface down" : !meHears ? "hold time expired" : !peerHears ? "neighbor no longer lists us (3-way)" : "level change";
    s.sys.push({ t: s.clock, dev: i.r, kind: "adj-down", ifn: i.ifn, nbr: oldAdj[k].nbr, lvl: oldAdj[k].lvls[0] ?? 2, why: why2 });
  }
  for (const k of born) {
    const i = linkOf(k);
    s.sys.push({ t: s.clock, dev: i.r, kind: "adj-up", ifn: i.ifn, nbr: newAdj[k].nbr, lvl: newAdj[k].lvls[0] ?? 2 });
  }
  for (const k of initNow) {
    const i = linkOf(k);
    s.sys.push({ t: s.clock, dev: i.r, kind: "adj-init", ifn: i.ifn, nbr: newAdj[k].nbr });
  }
  // Receivers that drop hellos log what they can see (authentication); MTU giants only show in interface counters.
  for (const l of IS_LINKS)
    for (const [tx, rx] of [
      [l.a, l.b],
      [l.b, l.a],
    ] as [IsR, IsR][]) {
      const f = hearFail(s.cfg, s.phys, l, tx, rx);
      const rxi = rx === l.a ? l.ai : l.bi;
      if (f?.startsWith("authentication") && hearFail(prev.cfg, prev.phys, l, tx, rx) !== f) s.sys.push({ t: s.clock, dev: rx, kind: "auth", ifn: rxi, nbr: tx, why: f });
    }

  // LSPs: re-originate on any content change.
  const changed: { r: IsR; lvl: Lvl }[] = [];
  for (const r of IS_ROUTERS)
    for (const lvl of [1, 2] as Lvl[]) {
      const b = lspBody(s.cfg, s.adj, r, lvl);
      const old = prev.own[r][lvl];
      if (!b) {
        if (old) delete s.own[r][lvl];
        continue;
      }
      if (!old || content(old) !== content(b)) {
        s.own[r][lvl] = withSum({ ...b, seq: (old?.seq ?? 0) + 1, gen: s.clock });
        changed.push({ r, lvl });
      }
    }
  const oldDb = prev.db;
  s.db = flood(s.cfg, s.adj, s.own, oldDb);

  // SPF log: every router whose LSDB changed ran SPF.
  for (const r of IS_ROUTERS)
    for (const lvl of [1, 2] as Lvl[]) {
      const a = JSON.stringify(oldDb[r][lvl]);
      const b = JSON.stringify(s.db[r][lvl]);
      if (a !== b && isRunning(s.cfg, r)) {
        const trigOrig = changed.find((x) => x.lvl === lvl && s.db[r][lvl][x.r])?.r;
        s.spf[r].push({ t: s.clock, lvl, trig: born.length && !lost.length ? "NEWADJ" : lost.length ? "DELADJ" : "NEWLSP", first: trigOrig ? isLspId(trigOrig) : isLspId(r), nodes: Object.keys(s.db[r][lvl]).length });
      }
    }

  // Counters and captures for the control-plane activity (one hello per direction per link per change, LSPs flooded).
  for (const l of IS_LINKS)
    for (const [tx, rx] of [
      [l.a, l.b],
      [l.b, l.a],
    ] as [IsR, IsR][]) {
      const txi = tx === l.a ? l.ai : l.bi;
      const rxi = rx === l.a ? l.ai : l.bi;
      if (!ifLevels(s.cfg, tx, txi).length || s.cfg[tx].ifs[txi]!.passive || !linkUp(s, l)) continue;
      const f = hearFail(s.cfg, s.phys, l, tx, rx);
      const hellos = HOLD / HELLO;
      ctr(s, tx, txi).iihOut += hellos;
      if (f === "not listening") continue;
      ctr(s, rx, rxi).iihIn += f?.startsWith("giant") ? 0 : hellos;
      if (f?.startsWith("giant")) ctr(s, rx, rxi).giants += hellos;
      else if (f?.startsWith("authentication")) {
        ctr(s, rx, rxi).authFail += hellos;
        ctr(s, rx, rxi).iihDrop += hellos;
      }
      else if (f) ctr(s, rx, rxi).iihDrop += hellos;
      const st = s.adj[adjKey(tx, txi)];
      const tw = st?.state === "UP" ? "Up" : st?.state === "INIT" ? "Initializing" : "Down";
      const text = `P2P IIH · circuit type L${ifLevels(s.cfg, tx, txi).join("/L")} · area ${areaOf(s.cfg[tx].net)} · 3-way ${tw}${st ? ` (nbr ${IS_SYS[st.nbr]})` : ""} · padded to ${s.cfg[tx].ifs[txi]!.mtu - 17} B${s.cfg[tx].ifs[txi]!.key ? " · auth HMAC-MD5" : ""}`;
      if (changed.length || lost.length || born.length || initNow.length) {
        addCap(s, adjKey(tx, txi), "out", "IIH", text);
        addCap(s, adjKey(rx, rxi), "in", "IIH", text, f);
      }
    }

  const run = opts.show === false ? undefined : convergeRun(prev, s, { lost, born, initNow, changed }, why);
  if (run) {
    s.runs = [...s.runs, run];
    s.last = run;
  }
  return s;
}

const cl = (o: IsState): IsState => ({ ...spClone(o), runs: o.runs, last: o.last });
function adjSnap(s: IsState, adj: AdjMap, db: DbMap): IsSnap {
  return { adj: spClone(adj), db: spClone(db) };
}
/** The moments of a convergence: hellos and the handshake, lost adjacencies, LSP flooding waves, SPF results. */
function convergeRun(prev: IsState, s: IsState, d: { lost: string[]; born: string[]; initNow: string[]; changed: { r: IsR; lvl: Lvl }[] }, why: string): SpRun<IsSnap> | undefined {
  if (!d.lost.length && !d.born.length && !d.initNow.length && !d.changed.length) return undefined;
  const moments: SpMoment<IsSnap>[] = [];
  const iOf = (k: string) => {
    const [r, ifn] = k.split("|") as [IsR, IfName];
    return isIf(r, ifn)!;
  };
  // 1. Adjacencies that went away.
  if (d.lost.length) {
    const toks: SpTok[] = [];
    const lines: SpLine[] = [];
    const bad: string[] = [];
    const seen = new Set<string>();
    for (const k of d.lost) {
      const i = iOf(k);
      bad.push(i.link.id);
      if (seen.has(i.link.id)) continue;
      seen.add(i.link.id);
      const fwd = hearFail(s.cfg, s.phys, i.link, i.peer, i.r);
      const rev = hearFail(s.cfg, s.phys, i.link, i.r, i.peer);
      if (linkUp(s, i.link)) {
        if (fwd && fwd !== "sends no hellos") toks.push({ from: i.peer, to: i.r, label: "IIH ✕", color: C.bad, stay: true, lane: -2.4 });
        if (rev && rev !== "sends no hellos") toks.push({ from: i.r, to: i.peer, label: "IIH ✕", color: C.bad, stay: true, lane: 2.4 });
      }
      const reason = !linkUp(s, i.link) ? "the link is down" : fwd && rev ? `${i.r} rejects ${i.peer}'s hellos (${fwd}) and ${i.peer} rejects ${i.r}'s (${rev})` : fwd ? `${i.r} no longer accepts ${i.peer}'s hellos: ${fwd}` : rev ? `${i.peer} no longer accepts ${i.r}'s hellos: ${rev}` : "the circuits no longer share a level";
      lines.push({ text: `${i.r}–${i.peer} adjacency lost: ${reason}.`, tone: "bad" });
    }
    if (s.clock > prev.clock + 1) lines.push({ text: `Hold time: ${HOLD} s without an acceptable hello before the adjacency is declared Down.`, tone: "info" });
    moments.push({ tokens: toks, lines, bad, snap: adjSnap(s, s.adj, prev.db) });
  }
  // 2. New adjacencies: the three-way handshake (all links in parallel).
  const newLinks = [...new Set([...d.born, ...d.initNow].map((k) => iOf(k).link.id))].map((id) => IS_LINKS.find((l) => l.id === id)!);
  if (newLinks.length) {
    const mid: AdjMap = spClone(prev.adj);
    const toks1: SpTok[] = [];
    const lines1: SpLine[] = [];
    for (const l of newLinks) {
      const aHears = !hearFail(s.cfg, s.phys, l, l.b, l.a);
      const bHears = !hearFail(s.cfg, s.phys, l, l.a, l.b);
      toks1.push({ from: l.a, to: l.b, label: "IIH (sees —)", color: bHears ? C.iih : C.bad, lane: -2.4, stay: !bHears });
      toks1.push({ from: l.b, to: l.a, label: "IIH (sees —)", color: aHears ? C.iih : C.bad, lane: 2.4, stay: !aHears });
      if (aHears) mid[adjKey(l.a, l.ai)] = { nbr: l.b, state: "INIT", lvls: commonLevels(s.cfg, l), since: s.clock };
      if (bHears) mid[adjKey(l.b, l.bi)] = { nbr: l.a, state: "INIT", lvls: commonLevels(s.cfg, l), since: s.clock };
      const fa = hearFail(s.cfg, s.phys, l, l.b, l.a);
      const fb = hearFail(s.cfg, s.phys, l, l.a, l.b);
      lines1.push({ text: `${l.a} ↔ ${l.b}: hellos over the link (802.3/LLC, no IP). ${aHears && bHears ? "Each hears the other but isn't listed yet → both Initializing." : aHears ? `${l.a} hears ${l.b} → Initializing; ${l.b} drops ${l.a}'s hellos (${fb}).` : `${l.b} hears ${l.a} → Initializing; ${l.a} drops ${l.b}'s hellos (${fa}).`}`, tone: aHears && bHears ? "info" : "warn" });
    }
    moments.push({ tokens: toks1, lines: lines1, hot: newLinks.map((l) => l.id), snap: adjSnap(s, mid, prev.db) });
    const up = newLinks.filter((l) => !hearFail(s.cfg, s.phys, l, l.b, l.a) && !hearFail(s.cfg, s.phys, l, l.a, l.b));
    if (up.length) {
      const toks2: SpTok[] = [];
      for (const l of up) {
        toks2.push({ from: l.a, to: l.b, label: `IIH (sees ${l.b})`, color: C.iih, lane: -2.4 });
        toks2.push({ from: l.b, to: l.a, label: `IIH (sees ${l.a})`, color: C.iih, lane: 2.4 });
      }
      moments.push({ tokens: toks2, lines: up.map((l) => ({ text: `${l.a} and ${l.b} each hear their own System ID in the other's three-way TLV → adjacency Up (Level ${commonLevels(s.cfg, l).join("+")}).`, tone: "ok" as const })), hot: up.map((l) => l.id), snap: adjSnap(s, s.adj, prev.db) });
      const csnp: SpTok[] = [];
      for (const l of up) {
        csnp.push({ from: l.a, to: l.b, label: "CSNP", color: C.snp, lane: -2.4 });
        csnp.push({ from: l.b, to: l.a, label: "CSNP", color: C.snp, lane: 2.4 });
      }
      moments.push({ tokens: csnp, lines: [{ text: "New adjacency: each side sends a CSNP (a summary of every LSP it holds). Whatever the other side is missing or holds older is sent; PSNPs acknowledge and request.", tone: "info" }], hot: up.map((l) => l.id), snap: adjSnap(s, s.adj, prev.db) });
    }
  }
  // 3. LSP flooding, wave by wave (all changed LSPs together).
  if (d.changed.length) {
    const lvl2 = d.changed.filter((x) => x.lvl === 2);
    const set = lvl2.length ? lvl2 : d.changed;
    const waves = set.map((x) => ({ x, w: floodWaves(s.adj, x.r, x.lvl) }));
    const depth = Math.max(0, ...waves.map((w) => w.w.length));
    const db: DbMap = spClone(prev.db);
    // The originators install their new LSP first.
    for (const x of d.changed) {
      const l = s.own[x.r][x.lvl];
      if (l) db[x.r][x.lvl][x.r] = l;
      else delete db[x.r][x.lvl][x.r];
    }
    moments.push({
      tokens: [],
      lines: set.slice(0, 6).map(({ r, lvl }) => {
        const l = s.own[r][lvl];
        const old = prev.own[r][lvl];
        const diff = l && old ? lspDiff(old, l) : l ? "first LSP" : "no longer runs this level";
        return { text: `${r} re-originates its Level-${lvl} LSP ${isLspId(r)}: sequence ${l ? hex8(l.seq) : "—"} (${diff}).`, tone: "learn" as const };
      }),
      views: Object.fromEntries(set.map(({ r }) => [r, { ring: "on" as const, badge: { text: `seq ${s.own[r][set[0].lvl]?.seq ?? "—"}`, tone: "warn" as const } }])),
      snap: { adj: spClone(s.adj), db: spClone(db) },
    });
    for (let k = 0; k < depth; k++) {
      const toks: SpTok[] = [];
      const hot = new Set<string>();
      const got: string[] = [];
      for (const { x, w } of waves) {
        for (const e of w[k] ?? []) {
          toks.push({ from: e.a, to: e.b, label: `LSP ${x.r} #${s.own[x.r][x.lvl]?.seq}`, color: C.lsp, lane: (IS_ROUTERS.indexOf(e.a) < IS_ROUTERS.indexOf(e.b) ? -2.4 : 2.4) + toks.filter((t) => t.from === e.a && t.to === e.b).length * (IS_ROUTERS.indexOf(e.a) < IS_ROUTERS.indexOf(e.b) ? -2.4 : 2.4) });
          const i = isIfTo(e.a, e.b)!;
          hot.add(i.link.id);
          const l = s.own[x.r][x.lvl];
          if (l) db[e.b][x.lvl][x.r] = l;
          got.push(`${e.b} ← ${x.r}`);
          ctr(s, e.a, i.ifn).lspOut++;
          ctr(s, e.b, i.peerIf).lspIn++;
          addCap(s, adjKey(e.a, i.ifn), "out", "LSP", `L${x.lvl} LSP ${isLspId(x.r)} seq ${hex8(l?.seq ?? 0)}`);
          addCap(s, adjKey(e.b, i.peerIf), "in", "LSP", `L${x.lvl} LSP ${isLspId(x.r)} seq ${hex8(l?.seq ?? 0)}`);
        }
      }
      moments.push({ tokens: toks, lines: [{ text: `Flooding, hop ${k + 1}: ${got.slice(0, 6).join(" · ")}${got.length > 6 ? " …" : ""}. Each receiver installs the newer copy, acknowledges it (PSNP) and floods it on every other adjacency — never back where it came from.`, tone: "learn" }], hot: [...hot], snap: { adj: spClone(s.adj), db: spClone(db) } });
    }
  }
  // 4. SPF: what changed in the routing tables that matter (PEs first).
  const ribLines: SpLine[] = [];
  for (const r of ["PE1", "PE2", "P1", "P2", "P3", "P4"] as IsR[]) {
    const a = isRib(prev.cfg, prev.phys, prev.adj, prev.db, r).filter((x) => x.kind.startsWith("i"));
    const b = isRib(s.cfg, s.phys, s.adj, s.db, r).filter((x) => x.kind.startsWith("i"));
    const lo = (rs: IsRoute[], ip: string) => rs.find((x) => x.p === ip && x.len === 32);
    for (const dst of IS_ROUTERS.filter((x) => x !== r)) {
      const ra = lo(a, IS_LO[dst]);
      const rb = lo(b, IS_LO[dst]);
      const fmt = (x?: IsRoute) => (x ? `metric ${x.metric} via ${x.nh.map((h) => h.nbr).join(" + ")}` : "no route");
      if (fmt(ra) !== fmt(rb)) ribLines.push({ text: `${r}: SPF → ${IS_LO[dst]} (${dst}) ${fmt(rb)} (was ${fmt(ra)}).`, tone: rb ? "ok" : "bad" });
    }
  }
  if (ribLines.length) moments.push({ tokens: [], lines: ribLines.slice(0, 8).concat(ribLines.length > 8 ? [{ text: `… ${ribLines.length - 8} more route changes on other routers.`, tone: "info" }] : []), snap: { adj: spClone(s.adj), db: spClone(s.db) } });
  else if (d.changed.length) moments.push({ tokens: [], lines: [{ text: "Every router ran SPF on its updated LSDB. No loopback route changed: the change didn't alter any shortest path.", tone: "info" }], snap: { adj: spClone(s.adj), db: spClone(s.db) } });
  if (!moments.length) return undefined;
  return { id: s.runs.length + 1 + s.seq * 1000, cmd: why, kind: "converge", moments };
}
function lspDiff(a: IsLsp, b: IsLsp): string {
  const out: string[] = [];
  const an = new Map(a.nbrs.map((x) => [x.to, x.metric]));
  const bn = new Map(b.nbrs.map((x) => [x.to, x.metric]));
  for (const [k, v] of bn) if (!an.has(k)) out.push(`+ neighbor ${k}`);
  else if (an.get(k) !== v) out.push(`metric to ${k} ${an.get(k)} → ${v}`);
  for (const k of an.keys()) if (!bn.has(k)) out.push(`− neighbor ${k}`);
  const ap = new Set(a.pfx.map((x) => `${x.p}/${x.len}`));
  const bp = new Set(b.pfx.map((x) => `${x.p}/${x.len}`));
  for (const p of bp) if (!ap.has(p)) out.push(`+ ${p}`);
  for (const p of ap) if (!bp.has(p)) out.push(`− ${p}`);
  if (a.ol !== b.ol) out.push(b.ol ? "overload bit set" : "overload bit cleared");
  return out.join(", ") || "refresh";
}

// ---------------------------------------------------------------------------------------------------------------
// Traffic tests
// ---------------------------------------------------------------------------------------------------------------
function testRun(s: IsState, t: IsTest): SpRun<IsSnap> {
  const moments: SpMoment<IsSnap>[] = [];
  const snap = { adj: spClone(s.adj), db: spClone(s.db) };
  const leg = (p: IsPath, label: string, back: boolean) => {
    for (let k = 0; k < p.hops.length; k++) {
      const h = p.hops[k];
      const nx = p.hops[k + 1];
      if (!nx) {
        if (p.result === "ok") moments.push({ tokens: [], lines: [{ text: back ? `${h.r}: the reply is home — ${t.from} received it.` : `${h.r}: ${t.dst} is mine → ${t.kind === "trace" ? "answers each probe (ICMP port unreachable at the end)" : "sends an echo reply"}.`, tone: "ok" }], views: { [h.r]: { ring: "target" } }, snap });
        else if (p.result === "unreach") moments.push({ tokens: [], lines: [{ text: `${h.r}: no route to ${back ? t.src : t.dst} → the packet is dropped${back ? "" : `; ${h.r} returns ICMP unreachable to ${t.src}`}.`, tone: "bad" }], views: { [h.r]: { ring: "bad", bubble: { text: "no route", tone: "bad" } } }, snap });
        else moments.push({ tokens: [], lines: [{ text: `${h.r}: TTL expired — the packet was looping.`, tone: "bad" }], views: { [h.r]: { ring: "bad" } }, snap });
        break;
      }
      const i = isIf(h.r, h.outIf!)!;
      const rt = lookup(isRib(s.cfg, s.phys, s.adj, s.db, h.r), back ? t.src : t.dst);
      moments.push({
        tokens: [{ from: h.r, to: nx.r, label, color: back ? "amber" : "green" }],
        lines: [{ text: `${h.r}: ${back ? t.src : t.dst} matches ${rt ? `${rt.p}/${rt.len} (${rt.kind === "C" ? "connected" : `IS-IS ${rt.kind.slice(2)}, metric ${rt.metric}`})` : "?"} → out ${i.ifn} to ${nx.r}${h.ecmp > 1 ? ` (one of ${h.ecmp} equal-cost next hops; this flow hashes here)` : ""}.`, tone: "info" }],
        hot: [i.link.id],
        snap,
      });
    }
  };
  leg(t.fwd, t.kind === "trace" ? "probe" : "echo", false);
  if (t.back) leg(t.back, "reply", true);
  const path = t.fwd.hops.map((h) => h.r).join(" → ");
  return { id: s.runs.length + 1 + s.seq * 1000, cmd: `${t.kind === "trace" ? "traceroute" : "ping"} ${t.dst} from ${t.from} (path ${path})`, kind: t.kind, moments, ok: t.ok };
}
export function runTest(s0: IsState, kind: "ping" | "trace", from: IsR, dst: string, src?: string): IsState {
  const s = cl(s0);
  s.clock += 2;
  refresh(s);
  const source = src ?? IS_LO[from];
  const fwd = forward(s.cfg, s.phys, s.adj, s.db, from, source, dst);
  let back: IsPath | undefined;
  if (fwd.result === "ok") back = forward(s.cfg, s.phys, s.adj, s.db, fwd.at, dst, source);
  const ok = fwd.result === "ok" && back?.result === "ok";
  const t: IsTest = { id: s.tests.length + 1, kind, from, src: source, dst, fwd, back, ok, cfgSeq: s.cfgSeq };
  s.tests = [...s.tests, t].slice(-40);
  for (const p of [fwd, back])
    for (const h of p?.hops ?? []) {
      if (h.outIf) ctr(s, h.r, h.outIf).pktOut++;
      if (h.inIf) ctr(s, h.r, h.inIf).pktIn++;
    }
  for (const h of fwd.hops) {
    if (h.outIf) addCap(s, adjKey(h.r, h.outIf), "out", kind === "trace" ? "UDP" : "ICMP", `${kind === "trace" ? "UDP probe" : "ICMP echo"} ${source} → ${dst}`);
    if (h.inIf) addCap(s, adjKey(h.r, h.inIf), "in", kind === "trace" ? "UDP" : "ICMP", `${kind === "trace" ? "UDP probe" : "ICMP echo"} ${source} → ${dst}`);
  }
  const run = testRun(s, t);
  s.runs = [...s.runs, run];
  s.last = run;
  s.log = [...s.log, { seq: s.seq, t: s.clock, text: `${kind === "trace" ? "traceroute" : "ping"} ${dst} from ${from}: ${ok ? "success" : fwd.result === "unreach" ? `unreachable at ${fwd.at}` : fwd.result === "ttl" ? "loop" : `no reply (return path fails at ${back?.at})`} · path ${fwd.hops.map((h) => h.r).join("→")}`, tone: ok ? "ok" : "warn" }];
  return s;
}

// ---------------------------------------------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------------------------------------------
export type IsTicketId = "level" | "loopback" | "mtu" | "overload" | "metric";
export interface IsTicketDef {
  id: IsTicketId;
  title: string;
  report: string;
  reproLabel: string;
  repro: IsAction[];
  fault: (c: IsCfg) => void;
}
export const IS_TICKETS: IsTicketDef[] = [
  {
    id: "level",
    title: "The top path carries nothing",
    report: "“Since this morning's change on P2, monitoring shows zero traffic on the P1–P2 link. Both ports are up and error-free. PE1 and PE2 still reach each other.”",
    reproLabel: "trace from PE1 to PE2's loopback",
    repro: [{ type: "trace", from: "PE1", dst: "10.0.0.4" }],
    fault: (c) => {
      c.P2.ifs["ge-0/0/0"]!.circuit = "level-1";
    },
  },
  {
    id: "loopback",
    title: "PE2 is unreachable — by loopback only",
    report: "“The BGP sessions to PE2 (they run between loopbacks) dropped after PE2's software upgrade. PE2's core links are up and the NOC can ping PE2's interface addresses.”",
    reproLabel: "ping PE2's loopback 10.0.0.4 from PE1",
    repro: [{ type: "ping", from: "PE1", dst: "10.0.0.4" }],
    fault: (c) => {
      c.PE2.lo = false;
    },
  },
  {
    id: "mtu",
    title: "P3–P4 never comes back",
    report: "“We enabled jumbo frames on P4 last night. Since then the P3–P4 link has no IS-IS neighbor, although the link is up. P4 says it sees P3; P3 says it sees nothing.”",
    reproLabel: "trace from PE1 to P4's loopback",
    repro: [{ type: "trace", from: "PE1", dst: "10.0.0.6" }],
    fault: (c) => {
      c.P4.ifs["ge-0/0/0"]!.mtu = 9014;
    },
  },
  {
    id: "overload",
    title: "Nothing transits P1",
    report: "“After last night's maintenance window on P1, no transit traffic crosses P1 — in either direction — yet P1's links and adjacencies look perfectly healthy and P1 itself answers pings.”",
    reproLabel: "trace from PE1 to PE2's loopback",
    repro: [{ type: "trace", from: "PE1", dst: "10.0.0.4" }],
    fault: (c) => {
      c.P1.overload = true;
    },
  },
  {
    id: "metric",
    title: "Two directions, two paths",
    report: "“Since yesterday, PE1's traffic to PE2 never uses the top path (P1–P2) any more — it all crowds onto P3–P4. PE2's traffic back to PE1 still spreads over both paths. Nobody touched PE1 or PE2.”",
    reproLabel: "trace PE1 → PE2, then PE2 → PE1",
    repro: [
      { type: "trace", from: "PE1", dst: "10.0.0.4" },
      { type: "trace", from: "PE2", dst: "10.0.0.1" },
    ],
    fault: (c) => {
      c.P1.ifs["ge-0/0/1"]!.metric = 100;
    },
  },
];
export const isTicket = (id: string) => IS_TICKETS.find((t) => t.id === id)!;
/** A ticket's network: the healthy morning core with the fault already converged (no run on screen). */
export function isTicketState(id: IsTicketId, seq = 0): IsState {
  const s = createIsNet(seq);
  const next = cl(s);
  isTicket(id).fault(next.cfg);
  const out = converge(s, next, "", { show: false });
  out.ticket = id;
  out.runs = [];
  out.last = undefined;
  out.caps = [];
  out.log = [...out.log, { seq, t: out.clock, text: `Ticket opened: ${isTicket(id).title}.`, tone: "warn" }];
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// The one entry point
// ---------------------------------------------------------------------------------------------------------------
export function isApply(s0: IsState, a: IsAction): IsState {
  switch (a.type) {
    case "cfg": {
      const s = cl(s0);
      s.hist = { ...s.hist, [a.dev]: [spClone(s0.cfg[a.dev]), ...s0.hist[a.dev]].slice(0, 5) };
      s.cfg[a.dev] = spClone(a.cfg);
      s.cfgSeq += 1;
      s.clock += 1;
      s.sys.push({ t: s.clock, dev: a.dev, kind: "commit" });
      s.log = [...s.log, { seq: s.seq, t: s.clock, text: `${a.dev}: ${a.text}`, tone: "info", dev: a.dev }];
      return converge(s0, s, `${a.dev}: ${a.text}`);
    }
    case "set": {
      const s = cl(s0);
      for (const ch of a.changes) ch.f(s.cfg[ch.dev]);
      s.cfgSeq += 1;
      s.clock += 1;
      s.log = [...s.log, { seq: s.seq, t: s.clock, text: a.text, tone: "info" }];
      return converge(s0, s, a.text);
    }
    case "link": {
      const s = cl(s0);
      s.phys = { ...s.phys, [a.link]: a.up };
      s.clock += 1;
      s.cfgSeq += 1;
      s.log = [...s.log, { seq: s.seq, t: s.clock, text: `Link ${a.link} ${a.up ? "restored" : "failed"}.`, tone: a.up ? "ok" : "warn" }];
      return converge(s0, s, `Link ${a.link} ${a.up ? "comes back up" : "fails"}`);
    }
    case "ping":
    case "trace":
      return runTest(s0, a.type, a.from, a.dst, a.src);
    case "ticket":
      return isTicketState(a.id, s0.seq + 1);
    case "wipe-pe1": {
      const s = cl(s0);
      s.cfg.PE1 = { ...s.cfg.PE1, on: false, net: "", lo: false, overload: false, isType: "level-1-2", ifs: Object.fromEntries(Object.entries(s.cfg.PE1.ifs).map(([k, v]) => [k, { ...v!, isis: false, circuit: "level-1-2" as IsType, metric: 10, key: "", passive: false }])) };
      s.wiped = true;
      s.cfgSeq += 1;
      s.clock += 1;
      s.log = [...s.log, { seq: s.seq, t: s.clock, text: "PE1's IS-IS configuration was removed (router isis / protocols isis and the NET).", tone: "warn" }];
      return converge(s0, s, "PE1 loses its whole IS-IS configuration");
    }
    case "clear-counters": {
      const s = cl(s0);
      s.ctr = Object.fromEntries(Object.keys(s.ctr).map((k) => [k, zeroCtr()]));
      return s;
    }
    case "boot": {
      // Learn: every router starts with links up but no adjacency; let the whole core come up.
      const s = cl(s0);
      const empty = cl(s0);
      empty.adj = {};
      empty.own = Object.fromEntries(IS_ROUTERS.map((r) => [r, {}])) as IsState["own"];
      empty.db = emptyDb();
      s.clock = 0;
      return converge(empty, { ...s, clock: 0, own: empty.own, db: empty.db, adj: {} }, "The core powers up: hellos, adjacencies, LSPs, SPF");
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Diagnosis
// ---------------------------------------------------------------------------------------------------------------
export const IS_CAUSES: { id: string; label: string }[] = [
  { id: "level", label: "The two ends of a link share no IS-IS level (is-type / circuit-type)" },
  { id: "area", label: "The routers are configured in different IS-IS areas" },
  { id: "loopback", label: "A router's loopback is not advertised into IS-IS" },
  { id: "mtu", label: "An MTU mismatch: one side's padded hellos are too big for the other" },
  { id: "auth", label: "Hello authentication keys don't match" },
  { id: "overload", label: "A router is still advertising the overload bit" },
  { id: "metric", label: "A metric was changed on one side of a link" },
  { id: "link", label: "A physical link or interface is down" },
];
const lastTest = (s: IsState) => s.tests[s.tests.length - 1];
export function isCauseFeedback(s: IsState, cause: string): { right: boolean; consequence?: boolean; text: string } {
  const t = s.ticket as IsTicketId | undefined;
  const anyDown = IS_LINKS.filter((l) => !linkUp(s, l));
  const sameArea = IS_ROUTERS.every((r) => areaOf(s.cfg[r].net) === IS_AREA);
  if (cause === t) {
    const txt: Record<IsTicketId, string> = {
      level: "Yes. P2's ge-0/0/0 now runs circuit-type level-1, but P2 is a Level-2-only router: that circuit runs no level at all, so it sends no usable hellos and accepts none. P1 holds no adjacency to P2, P1 and P2 dropped each other from their LSPs, and SPF routes everything over P3–P4.",
      loopback: "Yes. PE2's LSP still lists its neighbors and its /31s, but no 10.0.0.4/32: Loopback0 is no longer an IS-IS interface. Every router has a route to PE2's links, none to its loopback, so sessions built between loopbacks fail.",
      mtu: "Yes. P4's ge-0/0/0 has MTU 9014 and pads its hellos to ~9 KB; P3's interface (MTU 1514) drops them as giants. P4 hears P3's small hellos (P4: Initializing), P3 hears nothing (no entry): a one-way adjacency that never reaches Up.",
      overload: "Yes. P1's LSP carries the overload bit (OL = 1). Every router's SPF still reaches P1 itself but refuses to compute paths through it, so P1 carries no transit traffic while its adjacencies stay Up.",
      metric: "Yes. P1's ge-0/0/1 (toward P2) has metric 100. Metrics are outgoing and per direction: PE1 → PE2 costs 120 over the top and 30 over P3/P4, so PE1 uses only the bottom; PE2 → PE1 still pays P2's metric 10 toward P1, so both paths stay equal at 40. Same links, different costs per direction.",
    };
    return { right: true, text: txt[t] };
  }
  switch (cause) {
    case "level":
      return { right: false, text: "Compare the circuit types on both ends of every link that lost its adjacency (show isis interface): here the levels all line up. Level 2 is configured end to end." };
    case "area":
      return { right: false, text: sameArea ? "Every NET carries area 49.0001 — and even if one didn't, Level-2 adjacencies form across areas. Only Level 1 requires the same area." : "Areas differ here, but these are Level-2 adjacencies: Level 2 ignores the area. That isn't what is stopping anything." };
    case "loopback":
      return { right: false, text: "Read each router's LSP (show isis database detail): every LSP still advertises its loopback /32. Loopback reachability isn't the problem." };
    case "mtu":
      return { right: false, text: "Compare MTUs on both ends of each link (show interfaces): they match, and no interface is counting giants." };
    case "auth":
      return { right: false, text: "No hello-password / hello-authentication-key is configured anywhere, and no router logs an authentication failure." };
    case "overload":
      return { right: false, text: "Look at the ATT/P/OL column of show isis database: no LSP has the overload bit set." };
    case "metric":
      return { right: false, text: t === "overload" ? "Every interface still has metric 10 in both directions. The path changed without any metric changing — look at what each LSP says about its originator." : "Every interface still has metric 10, in both directions. Something else changed the path." };
    case "link":
      return anyDown.length ? { right: false, text: `${anyDown.map((l) => l.id).join(", ")} is down, but that's not this ticket's change.` } : { right: false, consequence: t === "level" || t === "mtu", text: "Every physical link is up (show interfaces brief / terse) and passes traffic at Layer 2. The failure is in IS-IS, above the link." };
  }
  return { right: false, text: "That doesn't match the evidence." };
}

/** What still needs to be true for the current ticket to be closed (each with its evidence). */
export function isProofs(s: IsState): { label: string; ok: boolean; detail: string }[] {
  const t = s.ticket as IsTicketId | undefined;
  if (!t) return [];
  const fresh = s.tests.filter((x) => x.cfgSeq === s.cfgSeq);
  const adjUp = (a: IsR, b: IsR) => {
    const i = isIfTo(a, b)!;
    return s.adj[adjKey(a, i.ifn)]?.state === "UP" && s.adj[adjKey(b, i.peerIf)]?.state === "UP";
  };
  const path = (x: IsTest) => x.fwd.hops.map((h) => h.r);
  switch (t) {
    case "level":
      return [
        { label: "P1–P2 adjacency Up on both routers", ok: adjUp("P1", "P2"), detail: `P1 ${s.adj[adjKey("P1", "ge-0/0/1")]?.state ?? "none"} · P2 ${s.adj[adjKey("P2", "ge-0/0/0")]?.state ?? "none"}` },
        { label: "Both ends run Level 2", ok: ifLevels(s.cfg, "P2", "ge-0/0/0").includes(2) && ifLevels(s.cfg, "P1", "ge-0/0/1").includes(2), detail: `P1 ge-0/0/1 L${ifLevels(s.cfg, "P1", "ge-0/0/1").join("/") || "—"} · P2 ge-0/0/0 L${ifLevels(s.cfg, "P2", "ge-0/0/0").join("/") || "—"}` },
        { label: "A fresh trace from PE1 to 10.0.0.4 succeeds with the top path back in SPF", ok: fresh.some((x) => x.kind === "trace" && x.from === "PE1" && x.dst === "10.0.0.4" && x.ok) && (lookup(isRib(s.cfg, s.phys, s.adj, s.db, "PE1"), "10.0.0.4")?.nh.length ?? 0) === 2, detail: "run the test again after the fix (PE1 should have two equal-cost next hops again)" },
      ];
    case "loopback": {
      const has = !!s.db.PE1[2].PE2?.pfx.some((p) => p.p === "10.0.0.4");
      return [
        { label: "PE2's LSP advertises 10.0.0.4/32 again", ok: has, detail: has ? `seq ${hex8(s.db.PE1[2].PE2!.seq)} lists it` : "PE1's copy of PE2.00-00 has no 10.0.0.4/32" },
        { label: "A fresh ping from PE1 to 10.0.0.4 succeeds", ok: fresh.some((x) => x.from === "PE1" && x.dst === "10.0.0.4" && x.ok), detail: "run the user's test again after the fix" },
      ];
    }
    case "mtu":
      return [
        { label: "P3–P4 adjacency Up on both routers", ok: adjUp("P3", "P4"), detail: `P3 ${s.adj[adjKey("P3", "ge-0/0/1")]?.state ?? "none"} · P4 ${s.adj[adjKey("P4", "ge-0/0/0")]?.state ?? "none"}` },
        { label: "Both ends of P3–P4 have the same MTU", ok: s.cfg.P3.ifs["ge-0/0/1"]!.mtu === s.cfg.P4.ifs["ge-0/0/0"]!.mtu, detail: `P3 ${s.cfg.P3.ifs["ge-0/0/1"]!.mtu} · P4 ${s.cfg.P4.ifs["ge-0/0/0"]!.mtu}` },
        { label: "A fresh trace from PE1 to 10.0.0.6 succeeds", ok: fresh.some((x) => x.from === "PE1" && x.dst === "10.0.0.6" && x.ok), detail: "run the user's test again after the fix" },
      ];
    case "overload":
      return [
        { label: "P1's LSP no longer carries the overload bit", ok: !s.db.PE1[2].P1?.ol, detail: `OL = ${s.db.PE1[2].P1?.ol ? 1 : 0} in PE1's copy of P1.00-00` },
        { label: "SPF uses P1 for transit again (PE1 → 10.0.0.4 has two equal-cost paths)", ok: (lookup(isRib(s.cfg, s.phys, s.adj, s.db, "PE1"), "10.0.0.4")?.nh.length ?? 0) === 2, detail: `next hops: ${lookup(isRib(s.cfg, s.phys, s.adj, s.db, "PE1"), "10.0.0.4")?.nh.map((h) => h.nbr).join(", ") ?? "none"}` },
        { label: "A fresh trace from PE1 to 10.0.0.4 succeeds", ok: fresh.some((x) => x.from === "PE1" && x.dst === "10.0.0.4" && x.ok), detail: "run the user's test again after the fix" },
      ];
    case "metric": {
      const f = fresh.filter((x) => x.kind === "trace");
      const there = f.find((x) => x.from === "PE1" && x.dst === "10.0.0.4" && x.ok);
      const back = f.find((x) => x.from === "PE2" && x.dst === "10.0.0.1" && x.ok);
      const m1 = s.cfg.P1.ifs["ge-0/0/1"]!.metric;
      const m2 = s.cfg.P2.ifs["ge-0/0/0"]!.metric;
      const a = lookup(isRib(s.cfg, s.phys, s.adj, s.db, "PE1"), "10.0.0.4");
      const b = lookup(isRib(s.cfg, s.phys, s.adj, s.db, "PE2"), "10.0.0.1");
      const fmt = (x?: IsRoute) => (x ? `metric ${x.metric} via ${x.nh.map((h) => h.nbr).join(" + ")}` : "no route");
      return [
        { label: "P1–P2 has the same metric in both directions", ok: m1 === m2, detail: `P1 → P2 ${m1} · P2 → P1 ${m2}` },
        { label: "PE1 → PE2 and PE2 → PE1 cost the same and use both paths again", ok: !!a && !!b && a.metric === b.metric && a.nh.length === 2 && b.nh.length === 2, detail: `PE1 → 10.0.0.4 ${fmt(a)} · PE2 → 10.0.0.1 ${fmt(b)}` },
        { label: "Fresh traces both ways succeed", ok: !!there && !!back, detail: there && back ? `${path(there).join("→")} / ${path(back).join("→")} (with two equal paths, each flow hashes onto one)` : "trace PE1 → 10.0.0.4 and PE2 → 10.0.0.1 after the fix" },
      ];
    }
  }
}

/** The evidence ladder for the open ticket, read from the network (no answers given away in the titles). */
export function isLadder(s: IsState): { k: string; title: string; text: string }[] {
  const t = lastTest(s);
  const linksWithoutAdj = IS_LINKS.filter((l) => l.id !== "P1-P3" && linkUp(s, l) && !(s.adj[adjKey(l.a, l.ai)]?.state === "UP" && s.adj[adjKey(l.b, l.bi)]?.state === "UP"));
  const init = Object.entries(s.adj).filter(([, v]) => v.state === "INIT");
  const ol = IS_ROUTERS.filter((r) => s.db.PE1[2][r]?.ol);
  const noLo = IS_ROUTERS.filter((r) => s.db.PE1[2][r] && !s.db.PE1[2][r]!.pfx.some((p) => p.p === IS_LO[r]));
  const m = IS_LINKS.filter((l) => s.cfg[l.a].ifs[l.ai]!.metric !== s.cfg[l.b].ifs[l.bi]!.metric);
  return [
    { k: "test", title: "What did the test actually show?", text: t ? `${t.kind === "trace" ? "traceroute" : "ping"} ${t.dst} from ${t.from}: ${t.ok ? "success" : "failed"} · path ${t.fwd.hops.map((h) => h.r).join(" → ")}${t.fwd.result === "unreach" ? ` · ${t.fwd.at} had no route` : ""}.` : "Run the user's test first." },
    { k: "phys", title: "Are the links up underneath IS-IS?", text: IS_LINKS.every((l) => linkUp(s, l)) ? "Every link is up/up (show interfaces brief / terse). Whatever is wrong is above Layer 1/2." : `Down: ${IS_LINKS.filter((l) => !linkUp(s, l)).map((l) => l.id).join(", ")}.` },
    { k: "adj", title: "Does every core link have an adjacency Up at both ends?", text: linksWithoutAdj.length ? `No adjacency (or only one side) on: ${linksWithoutAdj.map((l) => l.id).join(", ")}${init.length ? ` · one-way: ${init.map(([k, v]) => `${k.split("|")[0]} sees ${v.nbr} (Initializing)`).join(", ")}` : ""}. Compare both ends: levels, MTU, keys, network type.` : "Yes: every cabled IS-IS link has a two-way adjacency (the P1–P3 rung is not running IS-IS by design)." },
    { k: "lsdb", title: "What does each LSP say about its originator?", text: `${ol.length ? `Overload bit set in: ${ol.map((r) => isLspId(r)).join(", ")}. ` : "No LSP has the overload bit. "}${noLo.length ? `No loopback /32 in: ${noLo.map((r) => isLspId(r)).join(", ")}.` : "Every LSP advertises its loopback /32."}` },
    { k: "metrics", title: "Are the metrics the same in both directions of every link?", text: m.length ? `Different per direction on: ${m.map((l) => `${l.id} (${l.a} ${s.cfg[l.a].ifs[l.ai]!.metric} / ${l.b} ${s.cfg[l.b].ifs[l.bi]!.metric})`).join(", ")}.` : "Yes: metric 10 everywhere, both directions." },
    { k: "spf", title: "What did SPF install on PE1 and PE2?", text: ["PE1", "PE2"].map((r) => {
      const dst = r === "PE1" ? "10.0.0.4" : "10.0.0.1";
      const rt = lookup(isRib(s.cfg, s.phys, s.adj, s.db, r as IsR), dst);
      return `${r} → ${dst}: ${rt && rt.kind.startsWith("i") ? `metric ${rt.metric} via ${rt.nh.map((h) => h.nbr).join(" + ")}` : rt ? "connected" : "no route"}`;
    }).join(" · ") },
  ];
}
