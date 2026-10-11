/**
 * OSPF Lab network — the OSPF lesson's Area 0 diamond, with a LAN and a host behind every router:
 *
 *                    R2 (2.2.2.2) — LAN 192.168.2.0/24 — H2
 *            10.0.12/30 /      \ 10.0.24/30
 *   H1 — R1 (1.1.1.1)            R4 (4.4.4.4) — LAN 192.168.4.0/24 — H4
 *            10.0.13/30 \      / 10.0.34/30
 *                    R3 (3.3.3.3) — LAN 192.168.3.0/24 — H3
 *
 * Costs as in the lesson: R1–R2 10, R2–R4 10, R1–R3 20, R3–R4 5 (both ends). Interfaces: ge-0/0/1 and ge-0/0/2
 * toward the neighbors, ge-0/0/0 the LAN, lo0 the router ID. Everything is COMPUTED from the configuration as the
 * converged result of OSPFv2 on point-to-point links:
 *   - Neighbors form only if both ends run OSPF on the link, neither is passive, and area, hello and dead intervals
 *     match. If the interface MTUs differ, the neighbor gets stuck in EXSTART (database description packets refused).
 *   - Each router originates a Router-LSA: a point-to-point link to every FULL neighbor (its own interface cost) and a
 *     stub network for every OSPF interface (the LAN, the link subnets, the loopback). LSAs flood to every router
 *     reachable over FULL adjacencies; every router in that part of the area has the same LSDB.
 *   - Each router runs SPF (Dijkstra) over its own LSDB — a link counts only if both ends list each other — and
 *     installs the cheapest path to every stub network (equal costs: up to two next hops, ECMP).
 *   - The routing table picks the longest match, then the lowest administrative distance: connected 0, static 1,
 *     OSPF 110 — a leftover static route beats OSPF.
 * A neighbor that goes SILENT (link up, packets lost) is only declared down when the dead interval (40 s) expires.
 */

export type OsRouter = "R1" | "R2" | "R3" | "R4";
export type OsHost = "H1" | "H2" | "H3" | "H4";
export type OsDev = OsRouter | OsHost;
export type OsLink = "L12" | "L13" | "L24" | "L34";
export const OS_ROUTERS: OsRouter[] = ["R1", "R2", "R3", "R4"];
export const OS_HOSTS: OsHost[] = ["H1", "H2", "H3", "H4"];
export const OS_LINKS: OsLink[] = ["L12", "L13", "L24", "L34"];
export const OS_IFS = ["ge-0/0/0", "ge-0/0/1", "ge-0/0/2", "lo0"] as const;
export type OsIf = (typeof OS_IFS)[number];
export const isRouter = (d: string): d is OsRouter => /^R\d$/.test(d);
export const isHost = (d: string): d is OsHost => /^H\d$/.test(d);
export const RID: Record<OsRouter, string> = { R1: "1.1.1.1", R2: "2.2.2.2", R3: "3.3.3.3", R4: "4.4.4.4" };
export const HOST_OF: Record<OsRouter, OsHost> = { R1: "H1", R2: "H2", R3: "H3", R4: "H4" };
export const ROUTER_OF: Record<OsHost, OsRouter> = { H1: "R1", H2: "R2", H3: "R3", H4: "R4" };
export const HOST_IP: Record<OsHost, string> = { H1: "192.168.1.10", H2: "192.168.2.10", H3: "192.168.3.10", H4: "192.168.4.10" };
export const LINK_ENDS: Record<OsLink, [OsRouter, OsIf, OsRouter, OsIf]> = { L12: ["R1", "ge-0/0/1", "R2", "ge-0/0/1"], L13: ["R1", "ge-0/0/2", "R3", "ge-0/0/1"], L24: ["R2", "ge-0/0/2", "R4", "ge-0/0/1"], L34: ["R3", "ge-0/0/2", "R4", "ge-0/0/2"] };
export const LINK_TEXT: Record<OsLink, string> = { L12: "R1–R2", L13: "R1–R3", L24: "R2–R4", L34: "R3–R4" };
export const IF_ADDR: Record<OsRouter, Record<OsIf, { ip: string; prefix: number }>> = {
  R1: { "ge-0/0/0": { ip: "192.168.1.1", prefix: 24 }, "ge-0/0/1": { ip: "10.0.12.1", prefix: 30 }, "ge-0/0/2": { ip: "10.0.13.1", prefix: 30 }, lo0: { ip: "1.1.1.1", prefix: 32 } },
  R2: { "ge-0/0/0": { ip: "192.168.2.1", prefix: 24 }, "ge-0/0/1": { ip: "10.0.12.2", prefix: 30 }, "ge-0/0/2": { ip: "10.0.24.1", prefix: 30 }, lo0: { ip: "2.2.2.2", prefix: 32 } },
  R3: { "ge-0/0/0": { ip: "192.168.3.1", prefix: 24 }, "ge-0/0/1": { ip: "10.0.13.2", prefix: 30 }, "ge-0/0/2": { ip: "10.0.34.1", prefix: 30 }, lo0: { ip: "3.3.3.3", prefix: 32 } },
  R4: { "ge-0/0/0": { ip: "192.168.4.1", prefix: 24 }, "ge-0/0/1": { ip: "10.0.24.2", prefix: 30 }, "ge-0/0/2": { ip: "10.0.34.2", prefix: 30 }, lo0: { ip: "4.4.4.4", prefix: 32 } },
};
export const OSPF_AD = 110;
export const STATIC_AD = 1;
export const DEFAULT_COST = 1;
export const pk = (r: string, i: string) => `${r} ${i}`;
export const ipNum = (ip: string) => ip.split(".").reduce((a, o) => a * 256 + Number(o), 0);
export const netOf = (ip: string, prefix: number) => {
  const m = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const n = (ipNum(ip) & m) >>> 0;
  return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
};
export const inNet = (ip: string, net: string, prefix: number) => netOf(ip, prefix) === net;
export const isIp = (s: string) => /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(s) && s.split(".").every((o) => Number(o) <= 255);

// ---------------------------------------------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------------------------------------------
export interface OsIfCfg {
  ospf: boolean;
  area: number;
  cost: number;
  passive: boolean;
  hello: number;
  dead: number;
  mtu: number;
  shut: boolean;
}
export interface OsStatic {
  prefix: string;
  len: number;
  nh: string;
}
export interface OsRouterCfg {
  ifs: Record<OsIf, OsIfCfg>;
  statics: OsStatic[];
}
export interface OsCfg {
  r: Record<OsRouter, OsRouterCfg>;
  links: Record<OsLink, boolean>;
}
const ifc = (o: Partial<OsIfCfg> = {}): OsIfCfg => ({ ospf: true, area: 0, cost: DEFAULT_COST, passive: false, hello: 10, dead: 40, mtu: 1500, shut: false, ...o });
const COSTS: Record<OsRouter, Partial<Record<OsIf, number>>> = { R1: { "ge-0/0/1": 10, "ge-0/0/2": 20 }, R2: { "ge-0/0/1": 10, "ge-0/0/2": 10 }, R3: { "ge-0/0/1": 20, "ge-0/0/2": 5 }, R4: { "ge-0/0/1": 10, "ge-0/0/2": 5 } };
export function osHealthy(): OsCfg {
  const router = (r: OsRouter): OsRouterCfg => ({ ifs: { "ge-0/0/0": ifc({ passive: true }), "ge-0/0/1": ifc({ cost: COSTS[r]["ge-0/0/1"] }), "ge-0/0/2": ifc({ cost: COSTS[r]["ge-0/0/2"] }), lo0: ifc({ passive: true }) }, statics: [] });
  return { r: { R1: router("R1"), R2: router("R2"), R3: router("R3"), R4: router("R4") }, links: { L12: true, L13: true, L24: true, L34: true } };
}
export const osClone = <T>(c: T): T => JSON.parse(JSON.stringify(c)) as T;

// ---------------------------------------------------------------------------------------------------------------
// Adjacencies, LSDB, SPF, routing tables — computed
// ---------------------------------------------------------------------------------------------------------------
export type OsNbrState = "FULL" | "EXSTART" | "INIT" | "DOWN";
export interface OsAdj {
  link: OsLink;
  state: OsNbrState;
  /** Why it isn't FULL (for logs, explanations). */
  why?: string;
}
export interface OsLsa {
  origin: OsRouter;
  seq: number;
  links: { nbr: OsRouter; cost: number; via: OsIf }[];
  stubs: { net: string; len: number; cost: number; via: OsIf }[];
}
export interface OsRoute {
  net: string;
  len: number;
  proto: "C" | "L" | "S" | "O";
  ad: number;
  metric: number;
  hops: { nh?: string; via: OsIf }[];
}
export interface OsView {
  adj: Record<OsLink, OsAdj>;
  /** Each router's LSDB (LSAs it holds). */
  lsdb: Record<OsRouter, OsLsa[]>;
  /** Each router's SPF result: cost and first hops to every reachable router. */
  spf: Record<OsRouter, Partial<Record<OsRouter, { cost: number; first: { nbr: OsRouter; via: OsIf }[] }>>>;
  rib: Record<OsRouter, OsRoute[]>;
}
export function osIfUp(cfg: OsCfg, r: OsRouter, i: OsIf): boolean {
  const c = cfg.r[r].ifs[i];
  if (c.shut) return false;
  if (i === "lo0" || i === "ge-0/0/0") return true;
  const l = OS_LINKS.find((x) => (LINK_ENDS[x][0] === r && LINK_ENDS[x][1] === i) || (LINK_ENDS[x][2] === r && LINK_ENDS[x][3] === i))!;
  const [a, ai, b, bi] = LINK_ENDS[l];
  return cfg.links[l] && !cfg.r[a].ifs[ai].shut && !cfg.r[b].ifs[bi].shut;
}
export const linkOf = (r: OsRouter, i: OsIf) => OS_LINKS.find((x) => (LINK_ENDS[x][0] === r && LINK_ENDS[x][1] === i) || (LINK_ENDS[x][2] === r && LINK_ENDS[x][3] === i));
export const peerOf = (r: OsRouter, i: OsIf): { r: OsRouter; i: OsIf } | undefined => {
  const l = linkOf(r, i);
  if (!l) return undefined;
  const [a, ai, b, bi] = LINK_ENDS[l];
  return a === r ? { r: b, i: bi } : { r: a, i: ai };
};
export function osAdjacencies(cfg: OsCfg, silent: Partial<Record<OsLink, number>> = {}, clock = 0): Record<OsLink, OsAdj> {
  const out = {} as Record<OsLink, OsAdj>;
  for (const l of OS_LINKS) {
    const [a, ai, b, bi] = LINK_ENDS[l];
    const A = cfg.r[a].ifs[ai];
    const B = cfg.r[b].ifs[bi];
    let st: OsAdj = { link: l, state: "FULL" };
    if (!osIfUp(cfg, a, ai)) st = { link: l, state: "DOWN", why: "the link is down" };
    else if (!A.ospf || !B.ospf) st = { link: l, state: "DOWN", why: `OSPF is not enabled on ${!A.ospf ? `${a} ${ai}` : `${b} ${bi}`}` };
    else if (A.passive || B.passive) st = { link: l, state: "DOWN", why: `${A.passive ? `${a} ${ai}` : `${b} ${bi}`} is passive: it sends no Hellos` };
    else if (A.area !== B.area) st = { link: l, state: "DOWN", why: `area mismatch: ${a} ${ai} is in area ${A.area}, ${b} ${bi} in area ${B.area}` };
    else if (A.hello !== B.hello || A.dead !== B.dead) st = { link: l, state: "DOWN", why: `hello/dead mismatch: ${a} ${A.hello}/${A.dead} s, ${b} ${B.hello}/${B.dead} s` };
    else if (A.mtu !== B.mtu) st = { link: l, state: "EXSTART", why: `MTU mismatch: ${a} ${ai} ${A.mtu}, ${b} ${bi} ${B.mtu} — database description packets are refused` };
    else if (silent[l] !== undefined && clock - silent[l]! >= A.dead) st = { link: l, state: "DOWN", why: `dead timer expired: no Hello for ${A.dead} s (the link is still up)` };
    out[l] = st;
  }
  return out;
}
const lsaOf = (cfg: OsCfg, adj: Record<OsLink, OsAdj>, r: OsRouter, seq: number): OsLsa => {
  const links: OsLsa["links"] = [];
  const stubs: OsLsa["stubs"] = [];
  for (const i of OS_IFS) {
    const c = cfg.r[r].ifs[i];
    if (!c.ospf || !osIfUp(cfg, r, i)) continue;
    const a = IF_ADDR[r][i];
    const l = linkOf(r, i);
    if (l && adj[l].state === "FULL") links.push({ nbr: peerOf(r, i)!.r, cost: c.cost, via: i });
    stubs.push({ net: netOf(a.ip, a.prefix), len: a.prefix, cost: i === "lo0" ? 1 : c.cost, via: i });
  }
  return { origin: r, seq, links, stubs };
};
export function osCompute(cfg: OsCfg, silent: Partial<Record<OsLink, number>> = {}, clock = 0, seqs: Record<OsRouter, number> = { R1: 1, R2: 1, R3: 1, R4: 1 }): OsView {
  const adj = osAdjacencies(cfg, silent, clock);
  const all: Record<OsRouter, OsLsa> = { R1: lsaOf(cfg, adj, "R1", seqs.R1), R2: lsaOf(cfg, adj, "R2", seqs.R2), R3: lsaOf(cfg, adj, "R3", seqs.R3), R4: lsaOf(cfg, adj, "R4", seqs.R4) };
  // Flooding domain: routers connected by FULL adjacencies (in one area — the lab's flooding is per connected part).
  const lsdb = {} as Record<OsRouter, OsLsa[]>;
  for (const r of OS_ROUTERS) {
    const seen = new Set<OsRouter>([r]);
    const q: OsRouter[] = [r];
    while (q.length) {
      const x = q.shift()!;
      for (const l of OS_LINKS) {
        if (adj[l].state !== "FULL") continue;
        const [a, , b] = LINK_ENDS[l];
        const n = a === x ? b : b === x ? a : undefined;
        if (n && !seen.has(n)) {
          seen.add(n);
          q.push(n);
        }
      }
    }
    lsdb[r] = OS_ROUTERS.filter((x) => seen.has(x)).map((x) => all[x]);
  }
  const spf = {} as OsView["spf"];
  const rib = {} as OsView["rib"];
  for (const r of OS_ROUTERS) {
    const db = lsdb[r];
    const has = (x: OsRouter) => db.find((l) => l.origin === x);
    const res: OsView["spf"][OsRouter] = { [r]: { cost: 0, first: [] } };
    const done = new Set<OsRouter>();
    for (let k = 0; k < 4; k++) {
      const cand = (Object.keys(res) as OsRouter[]).filter((x) => !done.has(x)).sort((x, y) => res[x]!.cost - res[y]!.cost)[0];
      if (!cand) break;
      done.add(cand);
      const lsa = has(cand);
      if (!lsa) continue;
      for (const ln of lsa.links) {
        const back = has(ln.nbr)?.links.some((x) => x.nbr === cand);
        if (!back) continue;
        const c = res[cand]!.cost + ln.cost;
        const first = cand === r ? [{ nbr: ln.nbr, via: ln.via }] : res[cand]!.first;
        const cur = res[ln.nbr];
        if (!cur || c < cur.cost) res[ln.nbr] = { cost: c, first: [...first] };
        else if (c === cur.cost && !done.has(ln.nbr)) res[ln.nbr] = { cost: c, first: [...cur.first, ...first.filter((f) => !cur.first.some((g) => g.via === f.via))].slice(0, 2) };
      }
    }
    spf[r] = res;
    // Routing table
    const routes: OsRoute[] = [];
    for (const i of OS_IFS) {
      if (!osIfUp(cfg, r, i)) continue;
      const a = IF_ADDR[r][i];
      routes.push({ net: netOf(a.ip, a.prefix), len: a.prefix, proto: "C", ad: 0, metric: 0, hops: [{ via: i }] });
      if (a.prefix < 32) routes.push({ net: a.ip, len: 32, proto: "L", ad: 0, metric: 0, hops: [{ via: i }] });
    }
    for (const st of cfg.r[r].statics) {
      const via = OS_IFS.find((i) => osIfUp(cfg, r, i) && i !== "lo0" && inNet(st.nh, netOf(IF_ADDR[r][i].ip, IF_ADDR[r][i].prefix), IF_ADDR[r][i].prefix));
      if (via) routes.push({ net: st.prefix, len: st.len, proto: "S", ad: STATIC_AD, metric: 0, hops: [{ nh: st.nh, via }] });
    }
    const best: Record<string, OsRoute> = {};
    for (const x of db) {
      if (x.origin === r) continue;
      const p = res[x.origin];
      if (!p) continue;
      for (const sn of x.stubs) {
        const key = `${sn.net}/${sn.len}`;
        if (routes.some((q) => q.proto === "C" && q.net === sn.net && q.len === sn.len)) continue;
        const metric = p.cost + sn.cost;
        const hops = p.first.map((f) => ({ nh: IF_ADDR[f.nbr][peerOf(r, f.via)!.i].ip, via: f.via }));
        const cur = best[key];
        if (!cur || metric < cur.metric) best[key] = { net: sn.net, len: sn.len, proto: "O", ad: OSPF_AD, metric, hops };
        else if (metric === cur.metric) best[key] = { ...cur, hops: [...cur.hops, ...hops.filter((h) => !cur.hops.some((g) => g.via === h.via))].slice(0, 2) };
      }
    }
    routes.push(...Object.values(best));
    rib[r] = routes;
  }
  return { adj, lsdb, spf, rib };
}
/** Routes the router would USE (per prefix: lowest AD), plus the ones it keeps but doesn't use. */
export function osFib(view: OsView, r: OsRouter): { used: OsRoute[]; hidden: OsRoute[] } {
  const by: Record<string, OsRoute[]> = {};
  for (const x of view.rib[r]) (by[`${x.net}/${x.len}`] ??= []).push(x);
  const used: OsRoute[] = [];
  const hidden: OsRoute[] = [];
  for (const list of Object.values(by)) {
    const s = [...list].sort((a, b) => a.ad - b.ad || a.metric - b.metric);
    used.push(s[0]);
    hidden.push(...s.slice(1));
  }
  return { used: used.sort((a, b) => ipNum(a.net) - ipNum(b.net) || a.len - b.len), hidden };
}
export function osLookup(view: OsView, r: OsRouter, ip: string): OsRoute | undefined {
  return osFib(view, r)
    .used.filter((x) => inNet(ip, x.net, x.len))
    .sort((a, b) => b.len - a.len)[0];
}

// ---------------------------------------------------------------------------------------------------------------
// Runs and state
// ---------------------------------------------------------------------------------------------------------------
export type OsPktKind = "echo" | "echo-rep" | "hello" | "lsu" | "ttl-exceeded";
export interface OsPkt {
  id: number;
  kind: OsPktKind;
  src: string;
  dst: string;
  ttl: number;
  from: OsDev;
  /** For hellos: the sender's parameters. For LSUs: whose LSA. */
  info?: { rid?: string; area?: number; hello?: number; dead?: number; seen?: string[]; origin?: OsRouter; seq?: number };
  flow?: string;
}
export interface OsHop {
  from: OsDev;
  fromIf: string;
  to: OsDev;
  toIf: string;
  pkt: OsPkt;
}
export interface OsDecision {
  r: OsRouter;
  inIf: string;
  pkt: OsPkt;
  route?: OsRoute;
  outIf?: string;
  nh?: string;
  drop?: string;
  ecmp?: string;
}
export interface OsRx {
  dev: OsDev;
  pkt: OsPkt;
  ok: boolean;
  why: string;
}
export interface OsWave {
  k: number;
  hops: OsHop[];
  decisions: OsDecision[];
  rx: OsRx[];
}
export type OsSend = { from: OsHost | OsRouter; to: string; kind: "ping" | "trace" };
export interface OsResult {
  send: OsSend;
  replied: boolean;
  fail?: string;
  path: OsDev[];
  ttl?: number;
  /** traceroute: the routers that answered, in order. */
  trace?: { hop: number; ip: string; who: OsDev }[];
}
export interface OsRun {
  id: number;
  cmd: string;
  clock: number;
  kind: "traffic" | "hello" | "flood";
  waves: OsWave[];
  results: OsResult[];
  cfgSeq: number;
}
export interface OsCap {
  n: number;
  run: number;
  wave: number;
  point: string;
  dir: "in" | "out";
  pkt: OsPkt;
}
export interface OsSyslog {
  clock: number;
  r: OsRouter;
  ev: "adj" | "mismatch" | "up" | "down";
  ifn: string;
  nbr?: OsRouter;
  from?: OsNbrState;
  to?: OsNbrState;
  text?: string;
}
export interface OsLogLine {
  seq: number;
  text: string;
  tone: "info" | "ok" | "warn";
}
export type OsTicketId = "area" | "mtu" | "lan" | "cost" | "static";
export interface OsState {
  cfg: OsCfg;
  view: OsView;
  seqs: Record<OsRouter, number>;
  silent: Partial<Record<OsLink, number>>;
  clock: number;
  captures: OsCap[];
  capN: number;
  syslog: OsSyslog[];
  runs: OsRun[];
  last?: OsRun;
  seq: number;
  pktSeq: number;
  cfgSeq: number;
  /** The router whose LSA changed last (for the flood view). */
  lastOrigin?: OsRouter;
  log: OsLogLine[];
  ticket?: OsTicketId;
  /** Junos commit history per device, newest first: its configuration before each commit (rollback 1, 2…). */
  rb?: Partial<Record<OsRouter, string[]>>;
}
export function createOsNet(cfg: OsCfg = osHealthy()): OsState {
  const seqs = { R1: 1, R2: 1, R3: 1, R4: 1 };
  return { cfg, view: osCompute(cfg, {}, 0, seqs), seqs, silent: {}, clock: 10800, captures: [], capN: 0, syslog: [], runs: [], seq: 0, pktSeq: 0, cfgSeq: 0, log: [] };
}
export const routeText = (x: OsRoute) => `${x.net}/${x.len}`;
export function osOwner(cfg: OsCfg, ip: string): OsDev | undefined {
  const h = OS_HOSTS.find((x) => HOST_IP[x] === ip);
  if (h) return h;
  return OS_ROUTERS.find((r) => OS_IFS.some((i) => IF_ADDR[r][i].ip === ip && osIfUp(cfg, r, i)));
}
export const nbrName = (r: OsRouter) => `${r} (${RID[r]})`;

// ---------------------------------------------------------------------------------------------------------------
// Changes
// ---------------------------------------------------------------------------------------------------------------
function recompute(s: OsState, cfg: OsCfg, text: string, silent = s.silent, clock = s.clock): OsState {
  const prev = s.view;
  const tmp = osCompute(cfg, silent, clock, s.seqs);
  // New LSA sequence numbers for routers whose LSA content changed.
  const seqs = { ...s.seqs };
  let lastOrigin = s.lastOrigin;
  for (const r of OS_ROUTERS) {
    const a = prev.lsdb[r].find((l) => l.origin === r);
    const b = tmp.lsdb[r].find((l) => l.origin === r);
    if (JSON.stringify({ ...a, seq: 0 }) !== JSON.stringify({ ...b, seq: 0 })) {
      seqs[r]++;
      lastOrigin = r;
    }
  }
  const view = osCompute(cfg, silent, clock, seqs);
  const syslog = [...s.syslog];
  for (const l of OS_LINKS) {
    const o = prev.adj[l];
    const n = view.adj[l];
    const [a, ai, b, bi] = LINK_ENDS[l];
    if (osIfUp(s.cfg, a, ai) !== osIfUp(cfg, a, ai)) for (const [r, i] of [[a, ai], [b, bi]] as [OsRouter, OsIf][]) syslog.push({ clock, r, ev: osIfUp(cfg, a, ai) ? "up" : "down", ifn: i });
    if (o.state !== n.state) for (const [r, i, nb] of [[a, ai, b], [b, bi, a]] as [OsRouter, OsIf, OsRouter][]) syslog.push({ clock, r, ev: "adj", ifn: i, nbr: nb, from: o.state, to: n.state, text: n.why });
    if (n.state === "DOWN" && n.why && /mismatch/.test(n.why) && o.why !== n.why) for (const [r, i] of [[a, ai], [b, bi]] as [OsRouter, OsIf][]) syslog.push({ clock, r, ev: "mismatch", ifn: i, text: n.why });
  }
  const seq = s.seq + 1;
  return { ...s, cfg, view, seqs, silent, clock, syslog: syslog.slice(-200), seq, cfgSeq: s.cfgSeq + 1, lastOrigin, log: [...s.log, { seq, text, tone: "info" }] };
}
function tick(s: OsState, seconds: number): OsState {
  const clock = s.clock + seconds;
  const before = JSON.stringify(osAdjacencies(s.cfg, s.silent, s.clock));
  const after = JSON.stringify(osAdjacencies(s.cfg, s.silent, clock));
  if (before === after) return { ...s, clock };
  const r = recompute(s, s.cfg, "Dead timer expired on a silent neighbor: the adjacency is torn down and SPF runs again", s.silent, clock);
  return { ...r, cfgSeq: s.cfgSeq };
}

// ---------------------------------------------------------------------------------------------------------------
// Traffic, hellos, flooding
// ---------------------------------------------------------------------------------------------------------------
interface Work {
  s: OsState;
  captures: OsCap[];
  capN: number;
  runId: number;
  waves: OsWave[];
  pktSeq: number;
}
function capture(w: Work, wave: number, h: OsHop) {
  const pt = (d: OsDev, i: string) => (isRouter(d) ? pk(d, i) : d);
  w.captures.push({ n: ++w.capN, run: w.runId, wave, point: pt(h.from, h.fromIf), dir: "out", pkt: h.pkt }, { n: ++w.capN, run: w.runId, wave, point: pt(h.to, h.toIf), dir: "in", pkt: h.pkt });
}
const flowHash = (src: string, dst: string) => (+src.split(".")[3] + +dst.split(".")[3]) % 2;
/** Route one IPv4 packet hop by hop from a device until it is delivered, dropped or expires. */
function route(w: Work, from: OsDev, pkt: OsPkt, onDeliver: (dev: OsDev, p: OsPkt) => void, onTtl?: (r: OsRouter, p: OsPkt) => void): OsDev[] {
  const s = w.s;
  const path: OsDev[] = [from];
  let cur: OsDev = from;
  let inIf = "";
  let p = { ...pkt };
  const visits: Record<string, number> = {};
  for (let guard = 0; guard < 24; guard++) {
    const k = w.waves.length;
    const wave: OsWave = { k, hops: [], decisions: [], rx: [] };
    w.waves.push(wave);
    if (isHost(cur)) {
      const r = ROUTER_OF[cur];
      if (osOwner(s.cfg, p.dst) === cur) {
        wave.rx.push({ dev: cur, pkt: p, ok: true, why: `${cur}: for me` });
        onDeliver(cur, p);
        return path;
      }
      // Host: send everything else to its gateway.
      const h: OsHop = { from: cur, fromIf: "eth0", to: r, toIf: "ge-0/0/0", pkt: p };
      wave.hops.push(h);
      capture(w, k, h);
      inIf = "ge-0/0/0";
      cur = r;
      path.push(r);
      continue;
    }
    const r = cur as OsRouter;
    // Delivered to the router itself?
    if (OS_IFS.some((i) => IF_ADDR[r][i].ip === p.dst && osIfUp(s.cfg, r, i))) {
      wave.rx.push({ dev: r, pkt: p, ok: true, why: `${r}: ${p.dst} is my own address` });
      onDeliver(r, p);
      return path;
    }
    const d: OsDecision = { r, inIf, pkt: p };
    wave.decisions.push(d);
    visits[r] = (visits[r] ?? 0) + 1;
    if (visits[r] >= 3) {
      const loop = [...new Set(path.slice(-4).filter(isRouter))].join(" ↔ ");
      d.drop = `routing loop (${loop}): the packet keeps bouncing until its TTL runs out`;
      return path;
    }
    if (inIf && p.ttl <= 1) {
      d.drop = "TTL expired";
      onTtl?.(r, p);
      return path;
    }
    if (inIf) p = { ...p, ttl: p.ttl - 1 };
    const rt = osLookup(s.view, r, p.dst);
    if (!rt) {
      d.drop = `no route to ${p.dst} in ${r}'s routing table`;
      return path;
    }
    d.route = rt;
    const pick = rt.hops.length > 1 ? flowHash(p.src, p.dst) % rt.hops.length : 0;
    const hop = rt.hops[pick];
    if (rt.hops.length > 1) d.ecmp = `two equal-cost paths (${rt.hops.map((x) => x.via).join(", ")}): this flow hashes onto ${hop.via}`;
    d.outIf = hop.via;
    d.nh = hop.nh;
    if (rt.proto === "C" || rt.proto === "L") {
      // Directly connected: deliver to the host on the LAN, or the neighbor on a link.
      if (hop.via === "ge-0/0/0") {
        const h = HOST_OF[r];
        if (HOST_IP[h] !== p.dst) {
          d.drop = `nobody owns ${p.dst} on the LAN`;
          return path;
        }
        const hh: OsHop = { from: r, fromIf: "ge-0/0/0", to: h, toIf: "eth0", pkt: p };
        w.waves.push({ k: k + 1, hops: [hh], decisions: [], rx: [{ dev: h, pkt: p, ok: true, why: `${h}: for me` }] });
        capture(w, k + 1, hh);
        path.push(h);
        onDeliver(h, p);
        return path;
      }
    }
    const peer = peerOf(r, hop.via as OsIf);
    if (!peer) {
      d.drop = "no neighbor on that interface";
      return path;
    }
    const l = linkOf(r, hop.via as OsIf)!;
    const h: OsHop = { from: r, fromIf: hop.via, to: peer.r, toIf: peer.i, pkt: p };
    wave.hops.push(h);
    capture(w, k, h);
    if (s.silent[l] !== undefined) {
      wave.rx.push({ dev: peer.r, pkt: p, ok: false, why: `${LINK_TEXT[l]}: the packet is lost on the silently failed link` });
      return path;
    }
    cur = peer.r;
    inIf = peer.i;
    path.push(peer.r);
  }
  return path;
}
function srcIpOf(s: OsState, dev: OsDev, dst: string): string {
  if (isHost(dev)) return HOST_IP[dev];
  const rt = osLookup(s.view, dev, dst);
  const via = (rt?.hops[0]?.via ?? "lo0") as OsIf;
  return IF_ADDR[dev][via].ip;
}
function simulate(s0: OsState, sends: OsSend[], cmd: string): OsState {
  const s = tick(s0, 1);
  const runId = s.runs.length + 1;
  const w: Work = { s, captures: [...s.captures], capN: s.capN, runId, waves: [], pktSeq: s.pktSeq };
  const results: OsResult[] = [];
  for (const x of sends) {
    const r: OsResult = { send: x, replied: false, path: [] };
    results.push(r);
    const src = srcIpOf(s, x.from, x.to);
    if (x.kind === "trace") {
      r.trace = [];
      for (let ttl = 1; ttl <= 8; ttl++) {
        let reached: OsDev | undefined;
        let expiredAt: OsRouter | undefined;
        const p: OsPkt = { id: ++w.pktSeq, kind: "echo", src, dst: x.to, ttl, from: x.from, flow: `${src}-${x.to}` };
        route(w, x.from, p, (dev) => (reached = dev), (rr) => (expiredAt = rr));
        if (expiredAt) r.trace.push({ hop: ttl, ip: srcIpOf(s, expiredAt, src), who: expiredAt });
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
      if (!r.replied) r.fail = `traceroute stopped after ${r.trace.length - 1} hop(s)`;
      continue;
    }
    let got: OsDev | undefined;
    let ttlAt = 0;
    const p: OsPkt = { id: ++w.pktSeq, kind: "echo", src, dst: x.to, ttl: 64, from: x.from, flow: `${src}-${x.to}` };
    const startWave = w.waves.length;
    r.path = route(w, x.from, p, (dev, pp) => ((got = dev), (ttlAt = pp.ttl)));
    if (!got) {
      const d = w.waves.slice(startWave).flatMap((wv) => wv.decisions).find((dd) => dd.drop);
      const lost = w.waves.slice(startWave).flatMap((wv) => wv.rx).find((rx) => !rx.ok);
      r.fail = d?.drop ? `${d.r}: ${d.drop}` : lost ? lost.why : "the ping never arrived";
      continue;
    }
    let back = false;
    let backTtl = 0;
    const rep: OsPkt = { id: ++w.pktSeq, kind: "echo-rep", src: x.to, dst: src, ttl: 64, from: got, flow: `${x.to}-${src}` };
    route(w, got, rep, (dev, pp) => ((back = dev === x.from), (backTtl = pp.ttl)));
    r.replied = back;
    r.ttl = backTtl || ttlAt;
    if (!back) {
      const d = w.waves.slice(startWave).flatMap((wv) => wv.decisions).filter((dd) => dd.pkt.kind === "echo-rep").find((dd) => dd.drop);
      r.fail = d?.drop ? `the reply was dropped at ${d.r}: ${d.drop}` : "the reply never came back";
    }
  }
  const run: OsRun = { id: runId, cmd, clock: s.clock, kind: "traffic", waves: w.waves, results, cfgSeq: s.cfgSeq };
  const seq = s.seq + 1;
  const summary = results.map((x) => (x.replied ? `${x.send.from} → ${x.send.to}: ${x.send.kind === "trace" ? "trace" : "reply"} via ${x.path.filter(isRouter).join(" → ")}` : `${x.send.from} → ${x.send.to}: FAILED — ${x.fail}`)).join(" · ");
  return { ...s, captures: w.captures.slice(-1500), capN: w.capN, runs: [...s.runs, run].slice(-40), last: run, seq, pktSeq: w.pktSeq, log: [...s.log, { seq, text: `${cmd}: ${summary}`, tone: results.every((x) => x.replied) ? "ok" : "warn" }] };
}
function hellos(s0: OsState): OsState {
  const s = tick(s0, 10);
  const runId = s.runs.length + 1;
  const w: Work = { s, captures: [...s.captures], capN: s.capN, runId, waves: [], pktSeq: s.pktSeq };
  const wave: OsWave = { k: 0, hops: [], decisions: [], rx: [] };
  for (const l of OS_LINKS) {
    const [a, ai, b, bi] = LINK_ENDS[l];
    if (!osIfUp(s.cfg, a, ai)) continue;
    for (const [r, i, pr, pi] of [
      [a, ai, b, bi],
      [b, bi, a, ai],
    ] as [OsRouter, OsIf, OsRouter, OsIf][]) {
      const c = s.cfg.r[r].ifs[i];
      if (!c.ospf || c.passive) continue;
      const seen = s.view.adj[l].state !== "DOWN" ? [RID[pr]] : [];
      const p: OsPkt = { id: ++w.pktSeq, kind: "hello", src: IF_ADDR[r][i].ip, dst: "224.0.0.5", ttl: 1, from: r, info: { rid: RID[r], area: c.area, hello: c.hello, dead: c.dead, seen } };
      const h: OsHop = { from: r, fromIf: i, to: pr, toIf: pi, pkt: p };
      wave.hops.push(h);
      capture(w, 0, h);
      const pc = s.cfg.r[pr].ifs[pi];
      const lost = s.silent[l] !== undefined;
      const why = lost ? `${pr} ${pi}: nothing arrives (the link is silently broken)` : !pc.ospf ? `${pr} ${pi}: OSPF isn't enabled here — the Hello is ignored` : pc.passive ? `${pr} ${pi}: passive — Hellos are neither sent nor processed` : pc.area !== c.area ? `${pr} ${pi}: area ${c.area} ≠ my area ${pc.area} → discarded (mismatched area)` : pc.hello !== c.hello || pc.dead !== c.dead ? `${pr} ${pi}: hello/dead ${c.hello}/${c.dead} ≠ mine ${pc.hello}/${pc.dead} → discarded` : pc.mtu !== c.mtu ? `${pr} ${pi}: Hello accepted (2-WAY) — but the database exchange fails: MTU ${c.mtu} ≠ ${pc.mtu} → stuck in EXSTART` : `${pr} ${pi}: Hello from ${RID[r]} listing me → neighbor ${s.view.adj[l].state}`;
      wave.rx.push({ dev: pr, pkt: p, ok: !lost && s.view.adj[l].state === "FULL", why });
    }
  }
  w.waves.push(wave);
  const run: OsRun = { id: runId, cmd: "Hellos on every OSPF interface", clock: s.clock, kind: "hello", waves: w.waves, results: [], cfgSeq: s.cfgSeq };
  const seq = s.seq + 1;
  return { ...s, captures: w.captures.slice(-1500), capN: w.capN, runs: [...s.runs, run].slice(-40), last: run, seq, pktSeq: w.pktSeq, log: [...s.log, { seq, text: `Hellos sent: ${wave.hops.length}`, tone: "info" }] };
}
/** The latest LSA of `origin` flooding over FULL adjacencies, wave by wave. */
function flood(s0: OsState, origin: OsRouter): OsState {
  const s = tick(s0, 1);
  const runId = s.runs.length + 1;
  const w: Work = { s, captures: [...s.captures], capN: s.capN, runId, waves: [], pktSeq: s.pktSeq };
  const lsa = s.view.lsdb[origin].find((l) => l.origin === origin)!;
  const have = new Set<OsRouter>([origin]);
  let frontier: OsRouter[] = [origin];
  for (let k = 0; k < 4 && frontier.length; k++) {
    const wave: OsWave = { k, hops: [], decisions: [], rx: [] };
    const next: OsRouter[] = [];
    for (const r of frontier)
      for (const l of OS_LINKS) {
        if (s.view.adj[l].state !== "FULL") continue;
        const [a, ai, b, bi] = LINK_ENDS[l];
        const [me, mi, pr, pi] = a === r ? [a, ai, b, bi] : b === r ? [b, bi, a, ai] : [];
        if (!me) continue;
        const p: OsPkt = { id: ++w.pktSeq, kind: "lsu", src: IF_ADDR[me as OsRouter][mi as OsIf].ip, dst: "224.0.0.5", ttl: 1, from: me as OsRouter, info: { origin, seq: lsa.seq } };
        const h: OsHop = { from: me as OsRouter, fromIf: mi as string, to: pr as OsRouter, toIf: pi as string, pkt: p };
        if (have.has(pr as OsRouter)) continue;
        wave.hops.push(h);
        capture(w, k, h);
        have.add(pr as OsRouter);
        next.push(pr as OsRouter);
        wave.rx.push({ dev: pr as OsRouter, pkt: p, ok: true, why: `${pr}: ${origin}'s Router-LSA seq 0x${(0x80000000 + lsa.seq).toString(16)} is newer → install it, acknowledge, flood it on, run SPF` });
      }
    w.waves.push(wave);
    frontier = next;
  }
  const missing = OS_ROUTERS.filter((r) => !have.has(r));
  const run: OsRun = { id: runId, cmd: `${origin}'s Router-LSA floods`, clock: s.clock, kind: "flood", waves: w.waves, results: [], cfgSeq: s.cfgSeq };
  const seq = s.seq + 1;
  return { ...s, captures: w.captures.slice(-1500), capN: w.capN, runs: [...s.runs, run].slice(-40), last: run, seq, pktSeq: w.pktSeq, log: [...s.log, { seq, text: `${origin}'s LSA flooded to ${[...have].filter((r) => r !== origin).join(", ") || "nobody"}${missing.length ? ` — never reached ${missing.join(", ")} (no FULL adjacency path)` : ""}`, tone: missing.length ? "warn" : "info" }] };
}

// ---------------------------------------------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------------------------------------------
export type OsAction =
  | { type: "traffic"; sends: OsSend[]; cmd?: string }
  | { type: "hello" }
  | { type: "flood"; origin?: OsRouter }
  | { type: "wait"; seconds: number }
  | { type: "cfg"; cfg: OsCfg; text: string; junosCommit?: OsRouter }
  | { type: "link"; link: OsLink; up: boolean }
  | { type: "silent"; link: OsLink; on: boolean }
  | { type: "ticket"; id: OsTicketId }
  | { type: "fresh" };
export const sendText = (x: OsSend) => `${x.from} ${x.kind === "trace" ? "traceroutes" : "pings"} ${x.to}`;
export function osApply(s: OsState, a: OsAction): OsState {
  switch (a.type) {
    case "traffic":
      return simulate(s, a.sends, a.cmd ?? a.sends.map(sendText).join(", then "));
    case "hello":
      return hellos(s);
    case "flood":
      return flood(s, a.origin ?? s.lastOrigin ?? "R1");
    case "wait": {
      const t = tick(s, a.seconds);
      const seq = t.seq + 1;
      return { ...t, seq, log: [...t.log, { seq, text: `${a.seconds} s pass`, tone: "info" }] };
    }
    case "cfg": {
      const next = recompute(s, a.cfg, a.text);
      if (!a.junosCommit) return next;
      const d = a.junosCommit;
      return { ...next, rb: { ...s.rb, [d]: [JSON.stringify(s.cfg.r[d]), ...(s.rb?.[d] ?? [])].slice(0, 49) } };
    }
    case "link": {
      const cfg = osClone(s.cfg);
      cfg.links[a.link] = a.up;
      const silent = { ...s.silent };
      if (!a.up) delete silent[a.link];
      return recompute(s, cfg, `${LINK_TEXT[a.link]} link ${a.up ? "restored" : "cut"}`, silent);
    }
    case "silent": {
      const silent = { ...s.silent };
      if (a.on) silent[a.link] = s.clock;
      else delete silent[a.link];
      return recompute(s, s.cfg, a.on ? `${LINK_TEXT[a.link]}: the link stays UP but packets stop getting through` : `${LINK_TEXT[a.link]}: repaired`, silent);
    }
    case "ticket":
      return osTicketState(a.id, s.seq + 1);
    case "fresh":
      return { ...createOsNet(), seq: s.seq + 1 };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------------------------------------------
export type OsCause = "area" | "mtu" | "lan" | "cost" | "static" | "link" | "hello" | "spf";
export const OS_CAUSES: { id: OsCause; label: string }[] = [
  { id: "link", label: "A link between two routers is down" },
  { id: "area", label: "The two ends of a link are in different areas" },
  { id: "hello", label: "Hello / dead timers don't match on a link" },
  { id: "mtu", label: "The two ends of a link have different MTUs" },
  { id: "lan", label: "A LAN isn't advertised into OSPF" },
  { id: "cost", label: "An interface cost makes OSPF prefer a longer path" },
  { id: "static", label: "A static route overrides what OSPF computed" },
  { id: "spf", label: "The routers' databases disagree, so SPF gives wrong answers" },
];
export interface OsTicket {
  id: OsTicketId;
  title: string;
  report: string;
  repro: OsAction[];
  reproLabel: string;
  cause: OsCause;
  good: (s: OsState, run: OsRun) => { ok: boolean; why: string };
}
const via = (run: OsRun) => run.results[0]?.path.filter(isRouter) ?? [];
const viaR2 = (s: OsState, run: OsRun) => {
  const r = run.results[0];
  const p = via(run);
  return { ok: !!r?.replied && p.includes("R2") && !p.includes("R3"), why: r?.replied ? `the traffic went ${p.join(" → ")}` : `no reply: ${r?.fail}` };
};
export const OS_TICKETS: OsTicket[] = [
  {
    id: "area",
    title: "Floor 1 → floor 4 takes the long way",
    report: "“Since R2 was re-provisioned yesterday, traffic from H1 to H4 goes through R3. The R1–R2 link is up and clean.”",
    repro: [{ type: "traffic", sends: [{ from: "H1", to: HOST_IP.H4, kind: "trace" }] }],
    reproLabel: "H1 traceroutes H4",
    cause: "area",
    good: viaR2,
  },
  {
    id: "mtu",
    title: "Traffic avoids the new R2–R4 circuit",
    report: "“After the WAN provider changed the R2–R4 circuit, H1 → H4 detours through R3. The provider says the circuit tests clean.”",
    repro: [{ type: "traffic", sends: [{ from: "H1", to: HOST_IP.H4, kind: "trace" }] }],
    reproLabel: "H1 traceroutes H4",
    cause: "mtu",
    good: viaR2,
  },
  {
    id: "lan",
    title: "Nobody can reach floor 4",
    report: "“After R4's configuration was rebuilt, nobody reaches H4 or anything on 192.168.4.0/24. R4 itself is reachable and all its neighbors are FULL.”",
    repro: [{ type: "traffic", sends: [{ from: "H1", to: HOST_IP.H4, kind: "ping" }] }],
    reproLabel: "H1 pings H4",
    cause: "lan",
    good: (_s, run) => ({ ok: !!run.results[0]?.replied, why: run.results[0]?.replied ? "the reply came back" : `no reply: ${run.results[0]?.fail}` }),
  },
  {
    id: "cost",
    title: "Floor 1 → floor 4 is slow",
    report: "“H1 → H4 has been slower since last week's maintenance window. All neighbors are FULL, nothing is down.”",
    repro: [{ type: "traffic", sends: [{ from: "H1", to: HOST_IP.H4, kind: "trace" }] }],
    reproLabel: "H1 traceroutes H4",
    cause: "cost",
    good: viaR2,
  },
  {
    id: "static",
    title: "A failure the network should survive",
    report: "“When the R3–R4 link failed this morning, H1 lost floor 4 completely — although R1–R2–R4 was fine. OSPF shows all the right routes.”",
    repro: [{ type: "link", link: "L34", up: true }, { type: "link", link: "L34", up: false }, { type: "traffic", sends: [{ from: "H1", to: HOST_IP.H4, kind: "ping" }] }],
    reproLabel: "Cut R3–R4, then H1 pings H4",
    cause: "static",
    good: (_s, run) => ({ ok: !!run.results[0]?.replied, why: run.results[0]?.replied ? `the reply came back via ${via(run).join(" → ")}` : `no reply: ${run.results[0]?.fail}` }),
  },
];
export const osTicket = (id: OsTicketId) => OS_TICKETS.find((t) => t.id === id)!;
export function osTicketState(id: OsTicketId, seq: number): OsState {
  const cfg = osHealthy();
  if (id === "area") cfg.r.R2.ifs["ge-0/0/1"].area = 1;
  if (id === "mtu") cfg.r.R4.ifs["ge-0/0/1"].mtu = 1400;
  if (id === "lan") cfg.r.R4.ifs["ge-0/0/0"].ospf = false;
  if (id === "cost") cfg.r.R1.ifs["ge-0/0/1"].cost = 100;
  if (id === "static") cfg.r.R1.statics.push({ prefix: "192.168.4.0", len: 24, nh: "10.0.13.2" });
  const s = createOsNet(cfg);
  return { ...s, seq, ticket: id, log: [{ seq, text: `Ticket opened: ${osTicket(id).title}`, tone: "info" }] };
}
export function osLastRepro(s: OsState): OsRun | undefined {
  if (!s.ticket) return undefined;
  const want = osTicket(s.ticket).repro.filter((a): a is Extract<OsAction, { type: "traffic" }> => a.type === "traffic").at(-1)!.sends;
  return [...s.runs].reverse().find((r) => r.kind === "traffic" && r.results.length === want.length && r.results.every((x, i) => x.send.from === want[i].from && x.send.to === want[i].to && x.send.kind === want[i].kind));
}
export interface OsProof {
  label: string;
  ok: boolean;
  detail: string;
}
export function osProofs(s: OsState): OsProof[] {
  if (!s.ticket) return [];
  const t = osTicket(s.ticket);
  const run = osLastRepro(s);
  const fresh = !!run && run.cfgSeq === s.cfgSeq;
  const g = run ? t.good(s, run) : undefined;
  const test: OsProof = { label: `A fresh test: ${t.reproLabel} — and it works`, ok: !!g?.ok && fresh, detail: !run ? "not run yet" : !fresh ? "the network changed since the last test — run it again" : g!.why };
  const allFull = OS_LINKS.every((l) => !s.cfg.links[l] || s.view.adj[l].state === "FULL");
  const fullP: OsProof = { label: "Every working link has a FULL adjacency", ok: allFull, detail: OS_LINKS.map((l) => `${LINK_TEXT[l]} ${s.cfg.links[l] ? s.view.adj[l].state : "cut"}`).join(" · ") };
  const r4 = osLookup(s.view, "R1", HOST_IP.H4);
  switch (s.ticket) {
    case "area":
    case "mtu":
      return [fullP, test];
    case "lan":
      return [{ label: "R1 has an OSPF route to 192.168.4.0/24", ok: r4?.proto === "O" && r4.net === "192.168.4.0", detail: r4 ? `${r4.proto} ${routeText(r4)}` : "no route" }, test];
    case "cost":
      return [{ label: "R1's route to 192.168.4.0/24 costs 21 via R2 (10 + 10 + the LAN's 1)", ok: r4?.proto === "O" && r4.metric === 21, detail: r4 ? `${r4.proto} ${routeText(r4)} metric ${r4.metric} via ${r4.hops.map((h) => h.nh).join(", ")}` : "no route" }, test];
    case "static":
      return [{ label: "R1 uses OSPF (not a static route) for 192.168.4.0/24", ok: r4?.proto === "O", detail: r4 ? `${r4.proto === "S" ? "static" : r4.proto === "O" ? "OSPF" : r4.proto} ${routeText(r4)} via ${r4.hops.map((h) => h.nh).join(", ")}` : "no route" }, test];
  }
}
export function osCauseFeedback(s: OsState, cause: OsCause): { right: boolean; consequence?: boolean; text: string } {
  const c = s.cfg;
  const t = s.ticket ? osTicket(s.ticket) : undefined;
  const right = !!t && t.cause === cause;
  const adj = OS_LINKS.map((l) => `${LINK_TEXT[l]} ${c.links[l] ? s.view.adj[l].state : "cut"}`).join(", ");
  const r4 = osLookup(s.view, "R1", HOST_IP.H4);
  const text: Record<OsCause, string> = {
    link: `Every link is physically up${c.links.L34 ? "" : " except R3–R4 — which is part of the user's test: the network must survive it"} (show ip interface brief / show interfaces terse).`,
    area: right ? "Yes. R2's interface toward R1 is in area 1, R1's in area 0. Hellos carry the area ID; each router discards Hellos from another area (Cisco logs “mismatched area ID”), so R1 and R2 never become neighbors — R1–R2 doesn't appear in show ip ospf neighbor at all. SPF can't use the link, and R1 reaches R4 the only way left: via R3 (20 + 5 = 25)." : `Areas match on every link (${OS_LINKS.map((l) => `${LINK_TEXT[l]}: ${c.r[LINK_ENDS[l][0]].ifs[LINK_ENDS[l][1]].area}/${c.r[LINK_ENDS[l][2]].ifs[LINK_ENDS[l][3]].area}`).join(", ")}).`,
    hello: `Hello/dead intervals match on every link (10/40 s).`,
    mtu: right ? "Yes. R4's interface toward R2 has MTU 1400, R2's 1500. Hellos don't check the MTU, so R2 and R4 do see each other — but database description packets carry the interface MTU, and a router refuses DBDs that advertise a larger MTU than its own: R4 (1400) refuses R2's (1500), so the exchange never completes. The neighbor is stuck in EXSTART, never FULL, so SPF can't use R2–R4." : `MTUs match on every link (${OS_LINKS.filter((l) => c.links[l]).map((l) => `${LINK_TEXT[l]} ${c.r[LINK_ENDS[l][0]].ifs[LINK_ENDS[l][1]].mtu}/${c.r[LINK_ENDS[l][2]].ifs[LINK_ENDS[l][3]].mtu}`).join(", ")}).`,
    lan: right ? "Yes. R4's LAN interface ge-0/0/0 isn't in OSPF (no ip ospf … area 0 / not under protocols ospf area 0). R4's Router-LSA has no stub network for 192.168.4.0/24, so no other router learns it: R1 has no route and drops the ping. R4's neighbors are all FULL — adjacencies and advertised networks are separate questions." : `Every LAN is advertised: R1 has ${r4 ? `${r4.proto} ${routeText(r4)}` : "no route"} for floor 4.`,
    cost: right ? `Yes. R1's interface toward R2 has cost 100 (it should be 10). R1's SPF compares the paths to R4: via R2 = 100 + 10 = 110, via R3 = 20 + 5 = 25. The lower total wins, so the traffic goes R1 → R3 → R4. Costs are per interface and per direction: the return path (R4's choice) is unaffected.` : `Interface costs are as designed (R1 ${c.r.R1.ifs["ge-0/0/1"].cost}/${c.r.R1.ifs["ge-0/0/2"].cost}).`,
    static: right ? "Yes. R1 has a leftover static route: ip route 192.168.4.0 255.255.255.0 10.0.13.2 (via R3). A static route has administrative distance 1, OSPF 110: R1 uses the static and keeps the OSPF route only as a backup it never uses. When R3–R4 fails, R3 sends the traffic back to R1 (its OSPF path), R1 sends it to R3 again… until the TTL expires. Remove the static and OSPF's own path (via R2) takes over." : `R1 has no static route: it uses ${r4 ? (r4.proto === "S" ? "a static route" : "the route OSPF computed") : "no route at all"} for floor 4 (show ip route 192.168.4.0).`,
    spf: `Every router holds the same LSAs from the routers it is connected to (show ip ospf database is identical on R1–R4 within the connected area). SPF only works with what it is given: the question is what is MISSING from the database. Adjacencies now: ${adj}.`,
  };
  return { right, text: text[cause] };
}
