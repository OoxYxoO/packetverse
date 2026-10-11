/**
 * BGP Lab network — the BGP lesson's enterprise multihoming, with the destination AS modeled as a router and a LAN
 * behind each enterprise router:
 *
 *                           R5 (AS65030) — 203.0.113.0/24 — SRV 203.0.113.10
 *                          /              \
 *          R3 (ISP-A, AS65010)          R4 (ISP-B, AS65020)
 *                 | eBGP 192.0.2.0/30        | eBGP 198.51.100.0/30
 *   H1 — R1 (AS65001) —— iBGP 10.0.12.0/30 —— R2 (AS65001) — H2
 *   192.0.2.128/26                                 192.0.2.192/26
 *
 * Design (the healthy configuration): ISP-A is the primary — R1 sets LOCAL_PREF 200 on routes from ISP-A, so both
 * enterprise routers exit through it; R2 prepends AS65001 twice toward ISP-B, so the internet comes back through
 * ISP-A; both enterprise routers announce only their own prefixes to the ISPs (no transit); the iBGP session uses
 * next-hop-self. The ISP routers (R3–R5) are not ours: their state is visible as a looking glass, not configurable.
 *
 * Everything is COMPUTED from the configuration as the converged result of BGP-4:
 *   - A session is Established when the link is up, neither side has shut it, and each side's configured remote-as is
 *     the other's real AS (otherwise the OPEN is refused: "bad peer AS" — the session stays Active).
 *   - Routes flow per session: eBGP prepends the sender's AS and sets itself as next hop; a receiver drops routes
 *     that already carry its own AS (loop prevention); iBGP passes routes learned from eBGP (never from another iBGP
 *     peer) and keeps the next hop unless next-hop-self is set; policies apply on the way in (LOCAL_PREF) and out
 *     (own prefixes only, AS-path prepending).
 *   - Best path, in order: locally originated, highest LOCAL_PREF, shortest AS_PATH, lowest MED (only between paths
 *     from the same neighboring AS), eBGP over iBGP, lowest router ID. A path whose next hop can't be resolved is
 *     ignored ("inaccessible").
 *   - The routing table: connected 0, eBGP 20, iBGP 200 (Junos: BGP 170 for both).
 */

export type BgRouter = "R1" | "R2" | "R3" | "R4" | "R5";
export type BgHost = "H1" | "H2" | "SRV";
export type BgDev = BgRouter | BgHost;
export type BgLink = "L13" | "L24" | "L12" | "L35" | "L45";
export const BG_ROUTERS: BgRouter[] = ["R1", "R2", "R3", "R4", "R5"];
export const BG_OURS: BgRouter[] = ["R1", "R2"];
export const BG_HOSTS: BgHost[] = ["H1", "H2", "SRV"];
export const BG_LINKS: BgLink[] = ["L13", "L24", "L12", "L35", "L45"];
export const isRouter = (d: string): d is BgRouter => /^R\d$/.test(d);
export const isOurs = (d: string): d is "R1" | "R2" => d === "R1" || d === "R2";
export const ASN: Record<BgRouter, number> = { R1: 65001, R2: 65001, R3: 65010, R4: 65020, R5: 65030 };
export const RID: Record<BgRouter, string> = { R1: "1.1.1.1", R2: "2.2.2.2", R3: "3.3.3.3", R4: "4.4.4.4", R5: "5.5.5.5" };
export const ROLE: Record<BgRouter, string> = { R1: "enterprise (to ISP-A)", R2: "enterprise (to ISP-B)", R3: "ISP-A", R4: "ISP-B", R5: "AS65030 (destination)" };
export const LINK_ENDS: Record<BgLink, [BgRouter, string, BgRouter, string]> = {
  L13: ["R1", "192.0.2.1", "R3", "192.0.2.2"],
  L24: ["R2", "198.51.100.1", "R4", "198.51.100.2"],
  L12: ["R1", "10.0.12.1", "R2", "10.0.12.2"],
  L35: ["R3", "100.64.35.1", "R5", "100.64.35.2"],
  L45: ["R4", "100.64.45.1", "R5", "100.64.45.2"],
};
export const LINK_TEXT: Record<BgLink, string> = { L13: "R1–R3 (ISP-A)", L24: "R2–R4 (ISP-B)", L12: "R1–R2", L35: "R3–R5", L45: "R4–R5" };
export const LINK_PREFIX: Record<BgLink, string> = { L13: "192.0.2.0/30", L24: "198.51.100.0/30", L12: "10.0.12.0/30", L35: "100.64.35.0/30", L45: "100.64.45.0/30" };
export const LAN: Record<"R1" | "R2" | "R5", { prefix: string; gw: string; host: BgHost; ip: string }> = {
  R1: { prefix: "192.0.2.128/26", gw: "192.0.2.129", host: "H1", ip: "192.0.2.130" },
  R2: { prefix: "192.0.2.192/26", gw: "192.0.2.193", host: "H2", ip: "192.0.2.194" },
  R5: { prefix: "203.0.113.0/24", gw: "203.0.113.1", host: "SRV", ip: "203.0.113.10" },
};
export const HOST_IP: Record<BgHost, string> = { H1: LAN.R1.ip, H2: LAN.R2.ip, SRV: LAN.R5.ip };
export const ROUTER_OF: Record<BgHost, "R1" | "R2" | "R5"> = { H1: "R1", H2: "R2", SRV: "R5" };
export type BgSession = "R1-R3" | "R2-R4" | "R1-R2" | "R3-R5" | "R4-R5";
export const SESSIONS: Record<BgSession, { a: BgRouter; b: BgRouter; link: BgLink; type: "eBGP" | "iBGP" }> = {
  "R1-R3": { a: "R1", b: "R3", link: "L13", type: "eBGP" },
  "R2-R4": { a: "R2", b: "R4", link: "L24", type: "eBGP" },
  "R1-R2": { a: "R1", b: "R2", link: "L12", type: "iBGP" },
  "R3-R5": { a: "R3", b: "R5", link: "L35", type: "eBGP" },
  "R4-R5": { a: "R4", b: "R5", link: "L45", type: "eBGP" },
};
export const BG_SESSIONS = Object.keys(SESSIONS) as BgSession[];
export const ipNum = (ip: string) => ip.split(".").reduce((a, o) => a * 256 + Number(o), 0);
export const inPrefix = (ip: string, prefix: string) => {
  const [net, len] = prefix.split("/");
  const m = +len === 0 ? 0 : (0xffffffff << (32 - +len)) >>> 0;
  return ((ipNum(ip) & m) >>> 0) === ((ipNum(net) & m) >>> 0);
};
export const isIp = (s: string) => /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(s) && s.split(".").every((o) => Number(o) <= 255);
/** This router's address on a session, and the peer's. */
export function sessAddr(sess: BgSession, r: BgRouter): { mine: string; peer: string; peerRouter: BgRouter } {
  const { a, b, link } = SESSIONS[sess];
  const [, ai, , bi] = LINK_ENDS[link];
  return r === a ? { mine: ai, peer: bi, peerRouter: b } : { mine: bi, peer: ai, peerRouter: a };
}
export const sessionsOf = (r: BgRouter) => BG_SESSIONS.filter((x) => SESSIONS[x].a === r || SESSIONS[x].b === r);
export const sessionBetween = (r: BgRouter, peerIp: string) => sessionsOf(r).find((x) => sessAddr(x, r).peer === peerIp);

// ---------------------------------------------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------------------------------------------
export interface BgNbrCfg {
  /** The remote AS this router expects. */
  remoteAs: number;
  shut: boolean;
  /** iBGP: send routes with this router as next hop. */
  nhs: boolean;
  /** Inbound: set LOCAL_PREF on routes from this neighbor. */
  lpIn?: number;
  /** Outbound: extra copies of the own AS prepended. */
  prepend: number;
  /** Outbound (eBGP): announce only routes originated in this AS. */
  ownOnly: boolean;
}
export interface BgRouterCfg {
  nbrs: Partial<Record<BgSession, BgNbrCfg>>;
  /** Prefixes this router originates (network statements). */
  networks: string[];
}
export interface BgCfg {
  r: Record<BgRouter, BgRouterCfg>;
  links: Record<BgLink, boolean>;
}
const nbr = (remoteAs: number, o: Partial<BgNbrCfg> = {}): BgNbrCfg => ({ remoteAs, shut: false, nhs: false, prepend: 0, ownOnly: false, ...o });
export function bgHealthy(): BgCfg {
  return {
    r: {
      R1: { nbrs: { "R1-R3": nbr(65010, { lpIn: 200, ownOnly: true }), "R1-R2": nbr(65001, { nhs: true }) }, networks: [LAN.R1.prefix] },
      R2: { nbrs: { "R2-R4": nbr(65020, { prepend: 2, ownOnly: true }), "R1-R2": nbr(65001, { nhs: true }) }, networks: [LAN.R2.prefix] },
      R3: { nbrs: { "R1-R3": nbr(65001), "R3-R5": nbr(65030) }, networks: [] },
      R4: { nbrs: { "R2-R4": nbr(65001), "R4-R5": nbr(65030) }, networks: [] },
      R5: { nbrs: { "R3-R5": nbr(65010), "R4-R5": nbr(65020) }, networks: [LAN.R5.prefix] },
    },
    links: { L13: true, L24: true, L12: true, L35: true, L45: true },
  };
}
export const bgClone = <T>(c: T): T => JSON.parse(JSON.stringify(c)) as T;

// ---------------------------------------------------------------------------------------------------------------
// Sessions, paths, best path, routing tables — computed
// ---------------------------------------------------------------------------------------------------------------
export type BgState = "Established" | "Active" | "Idle (Admin)" | "Idle";
export interface BgSess {
  state: BgState;
  why?: string;
}
export interface BgPath {
  prefix: string;
  asPath: number[];
  nextHop: string;
  localPref: number;
  med: number;
  /** "local" = originated here. */
  from: BgRouter | "local";
  sess?: BgSession;
  type: "local" | "eBGP" | "iBGP";
  valid: boolean;
  invalidWhy?: string;
  best: boolean;
  /** Why this path won (best) or lost. */
  reason?: string;
}
export interface BgRoute {
  prefix: string;
  proto: "C" | "L" | "B";
  ad: number;
  nh?: string;
  /** Outgoing link address on this router (for forwarding). */
  via?: string;
  path?: BgPath;
}
export interface BgView {
  sess: Record<BgSession, BgSess>;
  /** Per router: every path known, per prefix (Loc-RIB with candidates). */
  paths: Record<BgRouter, BgPath[]>;
  /** Per session and direction: what was advertised from → to (Adj-RIB-Out). */
  adv: Record<string, BgPath[]>;
  rib: Record<BgRouter, BgRoute[]>;
}
export const advKey = (from: BgRouter, to: BgRouter) => `${from}>${to}`;
export function bgSessions(cfg: BgCfg): Record<BgSession, BgSess> {
  const out = {} as Record<BgSession, BgSess>;
  for (const s of BG_SESSIONS) {
    const { a, b, link } = SESSIONS[s];
    const A = cfg.r[a].nbrs[s]!;
    const B = cfg.r[b].nbrs[s]!;
    if (!cfg.links[link]) out[s] = { state: "Idle", why: "the link is down" };
    else if (A.shut || B.shut) out[s] = { state: "Idle (Admin)", why: `${A.shut ? a : b} has shut the session` };
    else if (A.remoteAs !== ASN[b]) out[s] = { state: "Active", why: `${a} expects AS ${A.remoteAs}, but ${b} is AS ${ASN[b]}: the OPEN is refused (bad peer AS)` };
    else if (B.remoteAs !== ASN[a]) out[s] = { state: "Active", why: `${b} expects AS ${B.remoteAs}, but ${a} is AS ${ASN[a]}: the OPEN is refused (bad peer AS)` };
    else out[s] = { state: "Established" };
  }
  return out;
}
const connectedOf = (cfg: BgCfg, r: BgRouter): { prefix: string; addr: string }[] => [
  ...BG_LINKS.filter((l) => cfg.links[l] && (LINK_ENDS[l][0] === r || LINK_ENDS[l][2] === r)).map((l) => ({ prefix: LINK_PREFIX[l], addr: LINK_ENDS[l][0] === r ? LINK_ENDS[l][1] : LINK_ENDS[l][3] })),
  ...(r in LAN ? [{ prefix: LAN[r as "R1"].prefix, addr: LAN[r as "R1"].gw }] : []),
];
const better = (x: BgPath, y: BgPath): { win: boolean; why: string } | undefined => {
  if ((x.type === "local") !== (y.type === "local")) return { win: x.type === "local", why: "locally originated" };
  if (x.localPref !== y.localPref) return { win: x.localPref > y.localPref, why: `LOCAL_PREF ${Math.max(x.localPref, y.localPref)} > ${Math.min(x.localPref, y.localPref)}` };
  if (x.asPath.length !== y.asPath.length) return { win: x.asPath.length < y.asPath.length, why: `shorter AS_PATH (${Math.min(x.asPath.length, y.asPath.length)} < ${Math.max(x.asPath.length, y.asPath.length)})` };
  if (x.asPath[0] === y.asPath[0] && x.med !== y.med) return { win: x.med < y.med, why: `lower MED (same neighboring AS)` };
  if (x.type !== y.type) return { win: x.type === "eBGP", why: "eBGP over iBGP" };
  const rx = x.from === "local" ? "0" : RID[x.from];
  const ry = y.from === "local" ? "0" : RID[y.from];
  if (rx !== ry) return { win: ipNum(rx) < ipNum(ry), why: "lower router ID" };
  return undefined;
};
export function bgCompute(cfg: BgCfg): BgView {
  const sess = bgSessions(cfg);
  const conn: Record<BgRouter, { prefix: string; addr: string }[]> = Object.fromEntries(BG_ROUTERS.map((r) => [r, connectedOf(cfg, r)])) as Record<BgRouter, { prefix: string; addr: string }[]>;
  const paths = Object.fromEntries(BG_ROUTERS.map((r) => [r, [] as BgPath[]])) as Record<BgRouter, BgPath[]>;
  const adv: Record<string, BgPath[]> = {};
  // Originated paths.
  const local = (r: BgRouter): BgPath[] => cfg.r[r].networks.filter((p) => conn[r].some((c) => c.prefix === p)).map((p) => ({ prefix: p, asPath: [], nextHop: "0.0.0.0", localPref: 100, med: 0, from: "local", type: "local", valid: true, best: false }));
  const resolvable = (r: BgRouter, nh: string) => conn[r].some((c) => inPrefix(nh, c.prefix));
  const select = (r: BgRouter, list: BgPath[]): BgPath[] => {
    const byPfx: Record<string, BgPath[]> = {};
    for (const p of list) (byPfx[p.prefix] ??= []).push(p);
    const out: BgPath[] = [];
    for (const ps of Object.values(byPfx)) {
      const valid = ps.map((p) => ({ ...p, valid: p.type === "local" || resolvable(r, p.nextHop), invalidWhy: p.type === "local" || resolvable(r, p.nextHop) ? undefined : `next hop ${p.nextHop} is not reachable (inaccessible)`, best: false, reason: undefined as string | undefined }));
      let best: (typeof valid)[number] | undefined;
      for (const p of valid.filter((v) => v.valid)) {
        if (!best) best = p;
        else {
          const c = better(p, best);
          if (c?.win) best = p;
        }
      }
      for (const p of valid) {
        if (p === best) p.best = true;
        if (best && p !== best && p.valid) p.reason = better(best, p)?.why ?? "older path";
      }
      if (best) {
        const others = valid.filter((v) => v !== best && v.valid);
        best.reason = others.length ? others.map((o) => better(best!, o)?.why ?? "older path").join("; ") : "only valid path";
      }
      out.push(...valid);
    }
    return out;
  };
  for (const r of BG_ROUTERS) paths[r] = select(r, local(r));
  for (let round = 0; round < 8; round++) {
    const recv = Object.fromEntries(BG_ROUTERS.map((r) => [r, [...local(r)] as BgPath[]])) as Record<BgRouter, BgPath[]>;
    for (const s of BG_SESSIONS) {
      if (sess[s].state !== "Established") continue;
      const { type } = SESSIONS[s];
      for (const from of [SESSIONS[s].a, SESSIONS[s].b]) {
        const { peerRouter: to, mine } = sessAddr(s, from);
        const nc = cfg.r[from].nbrs[s]!;
        const out: BgPath[] = [];
        for (const p of paths[from].filter((x) => x.best)) {
          if (type === "iBGP" && p.type === "iBGP") continue; // iBGP split horizon
          if (type === "eBGP" && nc.ownOnly && p.asPath.length > 0) continue; // only own prefixes
          if (type === "eBGP") out.push({ ...p, asPath: [...Array(1 + nc.prepend).fill(ASN[from]), ...p.asPath], nextHop: mine, localPref: 100, med: 0, from, sess: s, type: "eBGP" });
          else out.push({ ...p, nextHop: nc.nhs || p.type === "local" ? mine : p.nextHop, from, sess: s, type: "iBGP" });
        }
        adv[advKey(from, to)] = out;
        const tc = cfg.r[to].nbrs[s]!;
        for (const p of out) {
          if (type === "eBGP" && p.asPath.includes(ASN[to])) continue; // loop prevention
          recv[to].push({ ...p, localPref: type === "eBGP" ? (tc.lpIn ?? 100) : p.localPref });
        }
      }
    }
    const next = Object.fromEntries(BG_ROUTERS.map((r) => [r, select(r, recv[r])])) as Record<BgRouter, BgPath[]>;
    const same = JSON.stringify(next) === JSON.stringify(paths);
    for (const r of BG_ROUTERS) paths[r] = next[r];
    if (same) break;
  }
  for (const s of BG_SESSIONS) for (const from of [SESSIONS[s].a, SESSIONS[s].b]) adv[advKey(from, sessAddr(s, from).peerRouter)] ??= [];
  const rib = {} as Record<BgRouter, BgRoute[]>;
  for (const r of BG_ROUTERS) {
    const routes: BgRoute[] = [];
    for (const c of conn[r]) routes.push({ prefix: c.prefix, proto: "C", ad: 0, via: c.addr }, { prefix: `${c.addr}/32`, proto: "L", ad: 0, via: c.addr });
    for (const p of paths[r].filter((x) => x.best && x.type !== "local")) {
      const via = conn[r].find((c) => inPrefix(p.nextHop, c.prefix))?.addr;
      routes.push({ prefix: p.prefix, proto: "B", ad: p.type === "eBGP" ? 20 : 200, nh: p.nextHop, via, path: p });
    }
    rib[r] = routes;
  }
  return { sess, paths, adv, rib };
}
export function bgLookup(view: BgView, r: BgRouter, ip: string): BgRoute | undefined {
  return view.rib[r].filter((x) => inPrefix(ip, x.prefix)).sort((a, b) => +b.prefix.split("/")[1] - +a.prefix.split("/")[1] || a.ad - b.ad)[0];
}
export const ownerOf = (cfg: BgCfg, ip: string): BgDev | undefined => (BG_HOSTS.find((h) => HOST_IP[h] === ip) as BgDev | undefined) ?? BG_ROUTERS.find((r) => connectedOf(cfg, r).some((c) => c.addr === ip));

// ---------------------------------------------------------------------------------------------------------------
// Runs and state
// ---------------------------------------------------------------------------------------------------------------
export type BgPktKind = "echo" | "echo-rep" | "update" | "open";
export interface BgPkt {
  id: number;
  kind: BgPktKind;
  src: string;
  dst: string;
  ttl: number;
  from: BgDev;
  upd?: { prefixes: string[]; asPath: number[]; nextHop: string; localPref?: number };
}
export interface BgHop {
  from: BgDev;
  to: BgDev;
  pkt: BgPkt;
}
export interface BgDecision {
  r: BgRouter;
  pkt: BgPkt;
  route?: BgRoute;
  drop?: string;
}
export interface BgRx {
  dev: BgDev;
  pkt: BgPkt;
  ok: boolean;
  why: string;
}
export interface BgWave {
  k: number;
  hops: BgHop[];
  decisions: BgDecision[];
  rx: BgRx[];
}
export type BgSend = { from: BgHost | BgRouter; to: string; kind: "ping" | "trace" };
export interface BgResult {
  send: BgSend;
  replied: boolean;
  fail?: string;
  path: BgDev[];
  backPath?: BgDev[];
  trace?: { hop: number; ip: string; who: BgDev }[];
}
export interface BgRun {
  id: number;
  cmd: string;
  clock: number;
  kind: "traffic" | "updates";
  waves: BgWave[];
  results: BgResult[];
  cfgSeq: number;
}
export interface BgCap {
  n: number;
  run: number;
  wave: number;
  point: string;
  dir: "in" | "out";
  pkt: BgPkt;
}
export interface BgSyslog {
  clock: number;
  r: BgRouter;
  ev: "up" | "down" | "notify";
  peer: string;
  text?: string;
}
export interface BgLogLine {
  seq: number;
  text: string;
  tone: "info" | "ok" | "warn";
}
export type BgTicketId = "nhs" | "remoteas" | "localpref" | "prepend" | "leak";
export interface BgStateAll {
  cfg: BgCfg;
  view: BgView;
  clock: number;
  captures: BgCap[];
  capN: number;
  syslog: BgSyslog[];
  runs: BgRun[];
  last?: BgRun;
  seq: number;
  pktSeq: number;
  cfgSeq: number;
  log: BgLogLine[];
  ticket?: BgTicketId;
  /** Junos commit history per device, newest first: its configuration before each commit (rollback 1, 2…). */
  rb?: Partial<Record<"R1" | "R2", string[]>>;
}
export type BgNet = BgStateAll;
export function createBgNet(cfg: BgCfg = bgHealthy()): BgNet {
  return { cfg, view: bgCompute(cfg), clock: 14400, captures: [], capN: 0, syslog: [], runs: [], seq: 0, pktSeq: 0, cfgSeq: 0, log: [] };
}
function recompute(s: BgNet, cfg: BgCfg, text: string): BgNet {
  const view = bgCompute(cfg);
  const syslog = [...s.syslog];
  for (const x of BG_SESSIONS) {
    const o = s.view.sess[x];
    const n = view.sess[x];
    if (o.state === n.state) continue;
    for (const r of [SESSIONS[x].a, SESSIONS[x].b]) {
      const peer = sessAddr(x, r).peer;
      if (o.state === "Established") syslog.push({ clock: s.clock, r, ev: "down", peer, text: n.why });
      if (n.state === "Established") syslog.push({ clock: s.clock, r, ev: "up", peer });
      if (n.state === "Active" && /bad peer AS/.test(n.why ?? "")) syslog.push({ clock: s.clock, r, ev: "notify", peer, text: n.why });
    }
  }
  const seq = s.seq + 1;
  return { ...s, cfg, view, syslog: syslog.slice(-200), seq, cfgSeq: s.cfgSeq + 1, log: [...s.log, { seq, text, tone: "info" }] };
}

// ---------------------------------------------------------------------------------------------------------------
// Data plane and UPDATE view
// ---------------------------------------------------------------------------------------------------------------
interface Work {
  s: BgNet;
  captures: BgCap[];
  capN: number;
  runId: number;
  waves: BgWave[];
  pktSeq: number;
}
function capture(w: Work, wave: number, h: BgHop) {
  w.captures.push({ n: ++w.capN, run: w.runId, wave, point: h.from, dir: "out", pkt: h.pkt }, { n: ++w.capN, run: w.runId, wave, point: h.to, dir: "in", pkt: h.pkt });
}
/** The device on the other end of a router's address `via` toward next hop `nh`. */
function nextDevice(cfg: BgCfg, r: BgRouter, nh: string): BgDev | undefined {
  for (const l of BG_LINKS) {
    if (!cfg.links[l]) continue;
    const [a, ai, b, bi] = LINK_ENDS[l];
    if (a === r && bi === nh) return b;
    if (b === r && ai === nh) return a;
  }
  return undefined;
}
function route(w: Work, from: BgDev, pkt: BgPkt, onDeliver: (d: BgDev, p: BgPkt) => void, onTtl?: (r: BgRouter) => void): BgDev[] {
  const s = w.s;
  const path: BgDev[] = [from];
  let cur: BgDev = from;
  let p = { ...pkt };
  let first = true;
  const visits: Record<string, number> = {};
  for (let guard = 0; guard < 20; guard++) {
    const k = w.waves.length;
    const wave: BgWave = { k, hops: [], decisions: [], rx: [] };
    w.waves.push(wave);
    if (!isRouter(cur)) {
      if (HOST_IP[cur] === p.dst) {
        wave.rx.push({ dev: cur, pkt: p, ok: true, why: `${cur}: for me` });
        onDeliver(cur, p);
        return path;
      }
      const r = ROUTER_OF[cur];
      const h: BgHop = { from: cur, to: r, pkt: p };
      wave.hops.push(h);
      capture(w, k, h);
      cur = r;
      path.push(r);
      first = false;
      continue;
    }
    const r = cur;
    if (connectedOf(s.cfg, r).some((c) => c.addr === p.dst)) {
      wave.rx.push({ dev: r, pkt: p, ok: true, why: `${r}: ${p.dst} is my own address` });
      onDeliver(r, p);
      return path;
    }
    const d: BgDecision = { r, pkt: p };
    wave.decisions.push(d);
    visits[r] = (visits[r] ?? 0) + 1;
    if (visits[r] >= 3) {
      d.drop = "routing loop: the packet keeps coming back";
      return path;
    }
    if (!first && p.ttl <= 1) {
      d.drop = "TTL expired";
      onTtl?.(r);
      return path;
    }
    if (!first) p = { ...p, ttl: p.ttl - 1 };
    first = false;
    const rt = bgLookup(s.view, r, p.dst);
    if (!rt) {
      d.drop = `no route to ${p.dst}`;
      return path;
    }
    d.route = rt;
    if (rt.proto !== "B") {
      const lan = (r in LAN) && inPrefix(p.dst, LAN[r as "R1"].prefix) ? LAN[r as "R1"] : undefined;
      if (lan) {
        if (lan.ip !== p.dst) {
          d.drop = `nobody owns ${p.dst} on the LAN`;
          return path;
        }
        const hh: BgHop = { from: r, to: lan.host, pkt: p };
        w.waves.push({ k: k + 1, hops: [hh], decisions: [], rx: [{ dev: lan.host, pkt: p, ok: true, why: `${lan.host}: for me` }] });
        capture(w, k + 1, hh);
        path.push(lan.host);
        onDeliver(lan.host, p);
        return path;
      }
      const dev = nextDevice(s.cfg, r, p.dst);
      if (!dev) {
        d.drop = `nobody owns ${p.dst} on the link`;
        return path;
      }
      const h: BgHop = { from: r, to: dev, pkt: p };
      wave.hops.push(h);
      capture(w, k, h);
      cur = dev;
      path.push(dev);
      continue;
    }
    const dev = rt.nh ? nextDevice(s.cfg, r, rt.nh) : undefined;
    if (!dev) {
      d.drop = `next hop ${rt.nh} isn't on a connected link`;
      return path;
    }
    const h: BgHop = { from: r, to: dev, pkt: p };
    wave.hops.push(h);
    capture(w, k, h);
    cur = dev;
    path.push(dev);
  }
  return path;
}
function srcIp(s: BgNet, dev: BgDev, dst: string): string {
  if (!isRouter(dev)) return HOST_IP[dev];
  const rt = bgLookup(s.view, dev, dst);
  return rt?.via ?? connectedOf(s.cfg, dev)[0]?.addr ?? RID[dev];
}
function simulate(s0: BgNet, sends: BgSend[], cmd: string): BgNet {
  const s = { ...s0, clock: s0.clock + 1 };
  const runId = s.runs.length + 1;
  const w: Work = { s, captures: [...s.captures], capN: s.capN, runId, waves: [], pktSeq: s.pktSeq };
  const results: BgResult[] = [];
  for (const x of sends) {
    const r: BgResult = { send: x, replied: false, path: [] };
    results.push(r);
    const src = srcIp(s, x.from, x.to);
    if (x.kind === "trace") {
      r.trace = [];
      for (let ttl = 1; ttl <= 8; ttl++) {
        let reached: BgDev | undefined;
        let exp: BgRouter | undefined;
        route(w, x.from, { id: ++w.pktSeq, kind: "echo", src, dst: x.to, ttl, from: x.from }, (d) => (reached = d), (rr) => (exp = rr));
        if (exp) r.trace.push({ hop: ttl, ip: srcIp(s, exp, src), who: exp });
        else if (reached) {
          r.trace.push({ hop: ttl, ip: x.to, who: reached });
          r.replied = true;
          break;
        } else {
          r.trace.push({ hop: ttl, ip: "*", who: x.from });
          break;
        }
      }
      r.path = [x.from, ...r.trace.filter((t) => t.ip !== "*").map((t) => t.who)];
      if (!r.replied) r.fail = "traceroute stopped";
      continue;
    }
    let got: BgDev | undefined;
    const startWave = w.waves.length;
    r.path = route(w, x.from, { id: ++w.pktSeq, kind: "echo", src, dst: x.to, ttl: 64, from: x.from }, (d) => (got = d));
    if (!got) {
      const d = w.waves.slice(startWave).flatMap((wv) => wv.decisions).find((dd) => dd.drop);
      r.fail = d ? `${d.r}: ${d.drop}` : "the ping never arrived";
      continue;
    }
    let back = false;
    const bw = w.waves.length;
    r.backPath = route(w, got, { id: ++w.pktSeq, kind: "echo-rep", src: x.to, dst: src, ttl: 64, from: got }, (d) => (back = d === x.from));
    r.replied = back;
    if (!back) {
      const d = w.waves.slice(bw).flatMap((wv) => wv.decisions).find((dd) => dd.drop);
      r.fail = d ? `the reply was dropped at ${d.r}: ${d.drop}` : "the reply never came back";
    }
  }
  const run: BgRun = { id: runId, cmd, clock: s.clock, kind: "traffic", waves: w.waves, results, cfgSeq: s.cfgSeq };
  const seq = s.seq + 1;
  const summary = results.map((x) => (x.replied ? `${x.send.from} → ${x.send.to}: ${x.send.kind === "trace" ? "trace" : "reply"} via ${x.path.filter(isRouter).join(" → ")}${x.backPath ? ` (back ${x.backPath.filter(isRouter).join(" → ")})` : ""}` : `${x.send.from} → ${x.send.to}: FAILED — ${x.fail}`)).join(" · ");
  return { ...s, captures: w.captures.slice(-1500), capN: w.capN, runs: [...s.runs, run].slice(-40), last: run, seq, pktSeq: w.pktSeq, log: [...s.log, { seq, text: `${cmd}: ${summary}`, tone: results.every((x) => x.replied) ? "ok" : "warn" }] };
}
/** The converged advertisements, shown as UPDATE messages: origins first, then each hop outward. */
function updates(s0: BgNet): BgNet {
  const s = { ...s0, clock: s0.clock + 1 };
  const runId = s.runs.length + 1;
  const w: Work = { s, captures: [...s.captures], capN: s.capN, runId, waves: [], pktSeq: s.pktSeq };
  const order: [BgRouter, BgRouter][][] = [
    [["R5", "R3"], ["R5", "R4"], ["R1", "R2"], ["R2", "R1"]],
    [["R3", "R1"], ["R4", "R2"], ["R1", "R3"], ["R2", "R4"]],
    [["R1", "R2"], ["R2", "R1"], ["R3", "R5"], ["R4", "R5"]],
  ];
  const sent = new Set<string>();
  for (const step of order) {
    const k = w.waves.length;
    const wave: BgWave = { k, hops: [], decisions: [], rx: [] };
    for (const [from, to] of step) {
      const list = s.view.adv[advKey(from, to)] ?? [];
      for (const p of list) {
        const key = `${from}>${to}>${p.prefix}`;
        if (sent.has(key)) continue;
        sent.add(key);
        const pkt: BgPkt = { id: ++w.pktSeq, kind: "update", src: from, dst: to, ttl: 1, from, upd: { prefixes: [p.prefix], asPath: p.asPath, nextHop: p.nextHop, localPref: p.type === "iBGP" ? p.localPref : undefined } };
        const h: BgHop = { from, to, pkt };
        wave.hops.push(h);
        capture(w, k, h);
        const got = s.view.paths[to].find((x) => x.prefix === p.prefix && x.from === from);
        const loop = p.type === "eBGP" && p.asPath.includes(ASN[to]);
        const why = loop ? `${to}: my own AS ${ASN[to]} is in the AS_PATH → dropped (loop prevention)` : !got ? `${to}: not kept` : got.best ? `${to}: ${p.prefix} via ${from} → BEST (${got.reason})` : !got.valid ? `${to}: ${p.prefix} via ${from} → not usable: ${got.invalidWhy}` : `${to}: ${p.prefix} via ${from} → kept, not best (${got.reason})`;
        wave.rx.push({ dev: to, pkt, ok: !!got?.best, why });
      }
    }
    if (wave.hops.length) w.waves.push(wave);
  }
  const run: BgRun = { id: runId, cmd: "BGP UPDATEs (what each router announces to each peer)", clock: s.clock, kind: "updates", waves: w.waves, results: [], cfgSeq: s.cfgSeq };
  const seq = s.seq + 1;
  return { ...s, captures: w.captures.slice(-1500), capN: w.capN, runs: [...s.runs, run].slice(-40), last: run, seq, pktSeq: w.pktSeq, log: [...s.log, { seq, text: `UPDATEs sent: ${w.waves.reduce((a, x) => a + x.hops.length, 0)}`, tone: "info" }] };
}

// ---------------------------------------------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------------------------------------------
export type BgAction =
  | { type: "traffic"; sends: BgSend[]; cmd?: string }
  | { type: "updates" }
  | { type: "cfg"; cfg: BgCfg; text: string; junosCommit?: "R1" | "R2" }
  | { type: "link"; link: BgLink; up: boolean }
  | { type: "ticket"; id: BgTicketId }
  | { type: "fresh" };
export const sendText = (x: BgSend) => `${x.from} ${x.kind === "trace" ? "traceroutes" : "pings"} ${x.to}`;
export function bgApply(s: BgNet, a: BgAction): BgNet {
  switch (a.type) {
    case "traffic":
      return simulate(s, a.sends, a.cmd ?? a.sends.map(sendText).join(", then "));
    case "updates":
      return updates(s);
    case "cfg": {
      const next = recompute(s, a.cfg, a.text);
      if (!a.junosCommit) return next;
      const d = a.junosCommit;
      return { ...next, rb: { ...s.rb, [d]: [JSON.stringify(s.cfg.r[d]), ...(s.rb?.[d] ?? [])].slice(0, 49) } };
    }
    case "link": {
      const cfg = bgClone(s.cfg);
      cfg.links[a.link] = a.up;
      return recompute(s, cfg, `${LINK_TEXT[a.link]} link ${a.up ? "restored" : "cut"}`);
    }
    case "ticket":
      return bgTicketState(a.id, s.seq + 1);
    case "fresh":
      return { ...createBgNet(), seq: s.seq + 1 };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------------------------------------------
export type BgCause = "nhs" | "remoteas" | "localpref" | "prepend" | "leak" | "link" | "med" | "igp";
export const BG_CAUSES: { id: BgCause; label: string }[] = [
  { id: "link", label: "A link to an ISP is down" },
  { id: "remoteas", label: "A BGP neighbor is configured with the wrong AS" },
  { id: "nhs", label: "iBGP passes an ISP next hop the other router can't reach" },
  { id: "localpref", label: "LOCAL_PREF no longer makes ISP-A the preferred exit" },
  { id: "prepend", label: "AS-path prepending is on the wrong router" },
  { id: "leak", label: "We announce routes that aren't ours to an ISP" },
  { id: "med", label: "MED makes the ISPs choose the wrong entry" },
  { id: "igp", label: "The routers inside the enterprise can't reach each other" },
];
export interface BgTicket {
  id: BgTicketId;
  title: string;
  report: string;
  repro: BgAction[];
  reproLabel: string;
  cause: BgCause;
  good: (s: BgNet, run: BgRun) => { ok: boolean; why: string };
}
const routersOf = (p: BgDev[] = []) => p.filter(isRouter);
export const BG_TICKETS: BgTicket[] = [
  {
    id: "nhs",
    title: "Floor 2 leaves through the backup ISP",
    report: "“ISP-A is our primary contract, but traffic from H2 (behind R2) to the internet goes out through ISP-B. H1 is fine. Someone ‘cleaned up’ R1's BGP config.”",
    repro: [{ type: "traffic", sends: [{ from: "H2", to: HOST_IP.SRV, kind: "trace" }] }],
    reproLabel: "H2 traceroutes SRV",
    cause: "nhs",
    good: (_s, run) => {
      const p = routersOf(run.results[0]?.path);
      return { ok: !!run.results[0]?.replied && p.includes("R3") && !p.includes("R4"), why: run.results[0]?.replied ? `out via ${p.join(" → ")}` : `failed: ${run.results[0]?.fail}` };
    },
  },
  {
    id: "remoteas",
    title: "No failover to ISP-B",
    report: "“When ISP-A's link went down during maintenance, the whole office lost the internet — the backup through ISP-B never took over. The R2–R4 link is up.”",
    repro: [{ type: "link", link: "L13", up: true }, { type: "link", link: "L13", up: false }, { type: "traffic", sends: [{ from: "H1", to: HOST_IP.SRV, kind: "ping" }] }],
    reproLabel: "Cut ISP-A's link, then H1 pings SRV",
    cause: "remoteas",
    good: (_s, run) => ({ ok: !!run.results[0]?.replied, why: run.results[0]?.replied ? `reply via ${routersOf(run.results[0].path).join(" → ")}` : `failed: ${run.results[0]?.fail}` }),
  },
  {
    id: "localpref",
    title: "Floor 2 leaves through the backup ISP (again)",
    report: "“Same complaint as last month: H2's internet traffic goes through ISP-B instead of ISP-A. This time all BGP sessions are up and R2 has a valid ISP-A path.”",
    repro: [{ type: "traffic", sends: [{ from: "H2", to: HOST_IP.SRV, kind: "trace" }] }],
    reproLabel: "H2 traceroutes SRV",
    cause: "localpref",
    good: (_s, run) => {
      const p = routersOf(run.results[0]?.path);
      return { ok: !!run.results[0]?.replied && p.includes("R3") && !p.includes("R4"), why: run.results[0]?.replied ? `out via ${p.join(" → ")}` : `failed: ${run.results[0]?.fail}` };
    },
  },
  {
    id: "prepend",
    title: "The internet comes back the wrong way",
    report: "“Our replies from the internet now arrive through ISP-B (metered, expensive) — outbound still uses ISP-A. A change was made ‘to make ISP-B the backup’.”",
    repro: [{ type: "traffic", sends: [{ from: "SRV", to: HOST_IP.H1, kind: "trace" }] }],
    reproLabel: "SRV traceroutes H1",
    cause: "prepend",
    good: (_s, run) => {
      const p = routersOf(run.results[0]?.path);
      return { ok: !!run.results[0]?.replied && p.includes("R3"), why: run.results[0]?.replied ? `in via ${p.join(" → ")}` : `failed: ${run.results[0]?.fail}` };
    },
  },
  {
    id: "leak",
    title: "ISP-B says we're leaking routes",
    report: "“ISP-B's NOC called: we are announcing 203.0.113.0/24 to them — a prefix that isn't ours, with ISP-A's AS in the path. They threaten to shut the session. Check what R2 sends.”",
    repro: [{ type: "updates" }],
    reproLabel: "Send the BGP UPDATEs",
    cause: "leak",
    good: (s) => {
      const out = s.view.adv[advKey("R2", "R4")] ?? [];
      const bad = out.filter((p) => !p.prefix.startsWith("192.0.2."));
      return { ok: bad.length === 0 && out.length > 0, why: `R2 announces to ISP-B: ${out.map((p) => p.prefix).join(", ") || "nothing"}` };
    },
  },
];
export const bgTicket = (id: BgTicketId) => BG_TICKETS.find((t) => t.id === id)!;
export function bgTicketState(id: BgTicketId, seq: number): BgNet {
  const cfg = bgHealthy();
  if (id === "nhs") cfg.r.R1.nbrs["R1-R2"]!.nhs = false;
  if (id === "remoteas") cfg.r.R2.nbrs["R2-R4"]!.remoteAs = 65200;
  if (id === "localpref") delete cfg.r.R1.nbrs["R1-R3"]!.lpIn;
  if (id === "prepend") {
    cfg.r.R2.nbrs["R2-R4"]!.prepend = 0;
    cfg.r.R1.nbrs["R1-R3"]!.prepend = 2;
  }
  if (id === "leak") cfg.r.R2.nbrs["R2-R4"]!.ownOnly = false;
  const s = createBgNet(cfg);
  return { ...s, seq, ticket: id, log: [{ seq, text: `Ticket opened: ${bgTicket(id).title}`, tone: "info" }] };
}
export function bgLastRepro(s: BgNet): BgRun | undefined {
  if (!s.ticket) return undefined;
  const t = bgTicket(s.ticket);
  const lastAct = t.repro.at(-1)!;
  if (lastAct.type === "updates") return [...s.runs].reverse().find((r) => r.kind === "updates");
  const want = (lastAct as Extract<BgAction, { type: "traffic" }>).sends;
  return [...s.runs].reverse().find((r) => r.kind === "traffic" && r.results.length === want.length && r.results.every((x, i) => x.send.from === want[i].from && x.send.to === want[i].to && x.send.kind === want[i].kind));
}
export interface BgProof {
  label: string;
  ok: boolean;
  detail: string;
}
export function bgProofs(s: BgNet): BgProof[] {
  if (!s.ticket) return [];
  const t = bgTicket(s.ticket);
  const run = bgLastRepro(s);
  const fresh = !!run && run.cfgSeq === s.cfgSeq;
  const g = run ? t.good(s, run) : undefined;
  const test: BgProof = { label: `A fresh test: ${t.reproLabel} — and it works`, ok: !!g?.ok && fresh, detail: !run ? "not run yet" : !fresh ? "the network changed since the last test — run it again" : g!.why };
  const est = BG_SESSIONS.filter((x) => s.cfg.links[SESSIONS[x].link]).every((x) => s.view.sess[x].state === "Established");
  const sessP: BgProof = { label: "Every BGP session on a working link is Established", ok: est, detail: BG_SESSIONS.map((x) => `${x} ${s.view.sess[x].state}`).join(" · ") };
  const r2best = s.view.paths.R2.find((p) => p.prefix === LAN.R5.prefix && p.best);
  switch (s.ticket) {
    case "nhs":
    case "localpref":
      return [{ label: "R2's best path to 203.0.113.0/24 is via R1 (ISP-A)", ok: r2best?.from === "R1", detail: r2best ? `best via ${r2best.from} — ${r2best.reason}` : "no best path" }, test];
    case "remoteas":
      return [sessP, test];
    case "prepend": {
      const r5 = s.view.paths.R5.find((p) => p.prefix === LAN.R1.prefix && p.best);
      return [{ label: "AS65030 reaches us through ISP-A (shorter AS_PATH there)", ok: r5?.from === "R3", detail: r5 ? `R5 best via ${r5.from}: AS_PATH ${r5.asPath.join(" ")}` : "no path" }, test];
    }
    case "leak":
      return [{ label: "R2 announces only our own prefixes to ISP-B", ok: (s.view.adv[advKey("R2", "R4")] ?? []).every((p) => p.prefix.startsWith("192.0.2.")), detail: (s.view.adv[advKey("R2", "R4")] ?? []).map((p) => `${p.prefix} [${p.asPath.join(" ")}]`).join(", ") || "nothing" }, test];
  }
}
export function bgCauseFeedback(s: BgNet, cause: BgCause): { right: boolean; consequence?: boolean; text: string } {
  const c = s.cfg;
  const t = s.ticket ? bgTicket(s.ticket) : undefined;
  const right = !!t && t.cause === cause;
  const r2 = s.view.paths.R2.filter((p) => p.prefix === LAN.R5.prefix);
  const viaR1 = r2.find((p) => p.from === "R1");
  const text: Record<BgCause, string> = {
    link: `The ISP links are ${c.links.L13 && c.links.L24 ? "both up" : `not all up (${!c.links.L13 ? "ISP-A cut — part of the test" : ""}${!c.links.L24 ? " ISP-B down" : ""})`}: show ip interface brief / show interfaces terse.`,
    remoteas: right ? `Yes. R2 is configured with neighbor 198.51.100.2 remote-as 65200 — ISP-B is AS 65020. R4's OPEN says “AS 65020”, R2 expects 65200 and answers with a NOTIFICATION (OPEN message error: bad peer AS). The session never reaches Established (show ip bgp summary: Active), so R2 learns nothing from ISP-B. Nobody noticed while ISP-A was up — until it went down.` : `Every neighbor's remote-as matches (sessions: ${BG_SESSIONS.map((x) => `${x} ${s.view.sess[x].state}`).join(", ")}).`,
    nhs: right ? `Yes. R1 no longer sets next-hop-self toward R2. iBGP keeps the next hop R1 learned from ISP-A: 192.0.2.2. R2 has no route to 192.0.2.0/30 (it isn't in the enterprise IGP), so the ISP-A path is “inaccessible” on R2 — ignored by best-path selection. R2's only usable path is its own ISP-B route.` : `R2's paths via R1 have a reachable next hop${viaR1 ? ` (${viaR1.nextHop}${viaR1.valid ? ", valid" : ", INVALID"})` : ""}.`,
    localpref: right ? `Yes. R1 no longer sets LOCAL_PREF 200 on routes from ISP-A, so both exits have LOCAL_PREF 100 and AS_PATH length 2. R2's tie-break is “eBGP over iBGP”: it prefers its own ISP-B route over the ISP-A route R1 sends it. R2's ISP-A path is valid — just not preferred (show ip bgp 203.0.113.0: compare localpref).` : `LOCAL_PREF is as designed: R2's path via R1 has localpref ${viaR1?.localPref ?? "—"}.`,
    prepend: right ? `Yes. The prepending moved to R1: AS65001 is announced to ISP-A as “65001 65001 65001” and to ISP-B as plain “65001”. AS65030 compares AS_PATH lengths (65010 65001 65001 65001 vs 65020 65001) and prefers ISP-B for traffic toward us. Prepending belongs on the BACKUP link (R2 → ISP-B).` : `Prepending is on R2 toward ISP-B (${c.r.R2.nbrs["R2-R4"]?.prepend} extra copies), as designed.`,
    leak: right ? "Yes. R2's announcements to ISP-B are no longer limited to our own prefixes (prefix-list OWN out / export OWN-ONLY is gone). R2's best path to 203.0.113.0/24 is the one R1 learned from ISP-A and sent over iBGP; without the filter R2 passes it on to ISP-B (AS_PATH 65001 65001 65001 65010 65030): we offer ISP-B a path to AS65030 through our office and ISP-A — transit between our two ISPs. ISP-B happens to prefer its direct path, but a leak like this can attract other networks' traffic onto a small office link." : `R2's announcements to ISP-B are limited to our own prefixes (prefix-list OWN out / export OWN-ONLY): ${(s.view.adv[advKey("R2", "R4")] ?? []).map((p) => p.prefix).join(", ") || "nothing right now — that session is down"}.`,
    med: "MED is only compared between paths from the same neighboring AS. Our two ISPs are different ASes, so MED plays no part here — AS_PATH length (prepending) is what steers them.",
    igp: "R1 and R2 reach each other (10.0.12.0/30 connected, the iBGP session is Established).",
  };
  return { right, text: text[cause] };
}
