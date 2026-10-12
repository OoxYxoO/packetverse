import { spClone, type SpBase, type SpLine, type SpMoment, type SpRun } from "@/components/sp-lab/spKit";

/**
 * RSVP-TE Lab network — the guided lesson's six routers, with real traffic on the links.
 *
 *                 R2 ──────── R4                  top:    R1–R2–R4–R6, IGP metric 10 per link (cost 30)
 *               ╱              │ ╲                bottom: R1–R3–R5–R6, IGP metric 15 per link (cost 45)
 *   CE1 ── R1                  │   R6 ── CE6      R4–R5:  metric 25 (the lab adds it — a second way around)
 *  10.1.1.0/24 ╲               │ ╱   10.6.6.0/24
 *                 R3 ──────── R5
 *
 * Loopbacks R1 1.1.1.1 … R6 6.6.6.6 (IS-IS Level 2 with TE extensions, TE router ID = Loopback0). R1 is the headend of
 * tunnel-te1 (Junos LSP "TO-R6"), the video service from CE1 to CE6: 500 Mbps. R3 is the headend of tunnel-te10
 * ("CUST-B"), another customer's 400 Mbps from R3 to R5. R2–R4 is busy with best-effort traffic (800 Mbps of 1 Gbps),
 * so its RSVP reservable bandwidth is set to 200 Mbps — the headroom that is really left.
 *
 * Modeled (RFC 3209 RSVP-TE, RFC 5305 IS-IS TE, RFC 4090 is the next lesson):
 * - TED: a link direction is flooded by the router it leaves when the link is up, IS-IS TE is on at that router and
 *   the interface is a TE interface (XR `mpls traffic-eng interface`, Junos `protocols mpls interface`). It carries the
 *   TE metric (admin-weight / te-metric, default = IGP metric), max reservable bandwidth (the RSVP interface bandwidth;
 *   0 without one), unreserved bandwidth at each of the 8 priorities and the attribute flags (affinity colors).
 * - CSPF at the headend: drop link directions not in the TED in both directions (two-way check), down, short of the
 *   requested bandwidth at the LSP's setup priority, or failing the affinity (include = all listed colors, exclude =
 *   none of them); explicit paths: strict hops must be adjacent, loose hops are reached by CSPF, the rest to the tail
 *   is computed; shortest by TE metric. Path options are tried in order.
 * - Placement and preemption: LSPs are placed best setup priority first; an LSP may use bandwidth held by LSPs whose
 *   hold priority is worse than its setup priority (they are preempted). Same priority: the LSP already up keeps its
 *   path (no re-optimization in this lab); an LSP keeps its current path while it is still valid.
 * - Signaling: PATH downstream with the ERO and the bandwidth, RESV upstream with the labels; each hop reserves on its
 *   outgoing interface. Tail: implicit-null (PHP). Labels: IOS XR from 24000, Junos from 299776 (lab OS).
 * - Forwarding: the headend uses an LSP for the tail's loopback and the prefixes behind the tail only with
 *   `autoroute announce` (IOS XR) / IS-IS `traffic-engineering shortcuts` (Junos); otherwise traffic follows IS-IS.
 * - Traffic: each link direction has best-effort load; the CUST-B flow (400 Mbps R3 → R5) and the tested flow are added
 *   on the links they actually cross. Above 1000 Mbps the link drops the excess — a reservation is a promise in the
 *   control plane, not extra capacity.
 */

export type TeR = "R1" | "R2" | "R3" | "R4" | "R5" | "R6";
export type TeCe = "CE1" | "CE6";
export const TE_ROUTERS: TeR[] = ["R1", "R2", "R3", "R4", "R5", "R6"];
export const TE_LO: Record<TeR, string> = { R1: "1.1.1.1", R2: "2.2.2.2", R3: "3.3.3.3", R4: "4.4.4.4", R5: "5.5.5.5", R6: "6.6.6.6" };
export const CE_NET: Record<TeCe, { net: string; host: string; r: TeR; ifn: string }> = {
  CE1: { net: "10.1.1.0/24", host: "10.1.1.10", r: "R1", ifn: "ge-0/0/2" },
  CE6: { net: "10.6.6.0/24", host: "10.6.6.20", r: "R6", ifn: "ge-0/0/2" },
};
export const CUSTB_NET = "10.5.5.0/24";
export const IMPLICIT_NULL = 3;
export const LINK_MBPS = 1000;
export const AFFINITY: Record<string, number> = { BLUE: 0, GOLD: 1, RED: 2 };
export const AFF_NAMES = Object.keys(AFFINITY);
export type IfName = "ge-0/0/0" | "ge-0/0/1" | "ge-0/0/2";

export interface TeLink {
  id: string;
  a: TeR;
  ai: IfName;
  aip: string;
  b: TeR;
  bi: IfName;
  bip: string;
  metric: number;
  /** Best-effort traffic a→b and b→a (Mbps). */
  load: [number, number];
}
export const TE_LINKS: TeLink[] = [
  { id: "R1-R2", a: "R1", ai: "ge-0/0/0", aip: "192.0.2.0", b: "R2", bi: "ge-0/0/0", bip: "192.0.2.1", metric: 10, load: [100, 100] },
  { id: "R2-R4", a: "R2", ai: "ge-0/0/1", aip: "192.0.2.2", b: "R4", bi: "ge-0/0/0", bip: "192.0.2.3", metric: 10, load: [800, 800] },
  { id: "R4-R6", a: "R4", ai: "ge-0/0/1", aip: "192.0.2.4", b: "R6", bi: "ge-0/0/0", bip: "192.0.2.5", metric: 10, load: [100, 100] },
  { id: "R1-R3", a: "R1", ai: "ge-0/0/1", aip: "192.0.2.6", b: "R3", bi: "ge-0/0/0", bip: "192.0.2.7", metric: 15, load: [50, 50] },
  { id: "R3-R5", a: "R3", ai: "ge-0/0/1", aip: "192.0.2.8", b: "R5", bi: "ge-0/0/0", bip: "192.0.2.9", metric: 15, load: [50, 50] },
  { id: "R5-R6", a: "R5", ai: "ge-0/0/1", aip: "192.0.2.10", b: "R6", bi: "ge-0/0/1", bip: "192.0.2.11", metric: 15, load: [50, 50] },
  { id: "R4-R5", a: "R4", ai: "ge-0/0/2", aip: "192.0.2.12", b: "R5", bi: "ge-0/0/2", bip: "192.0.2.13", metric: 25, load: [100, 100] },
];
export const linkById = (id: string) => TE_LINKS.find((l) => l.id === id)!;
export const linkOf = (x: TeR, y: TeR) => TE_LINKS.find((l) => (l.a === x && l.b === y) || (l.a === y && l.b === x));
export const ifToward = (r: TeR, peer: TeR): IfName | undefined => {
  const l = linkOf(r, peer);
  return l ? (l.a === r ? l.ai : l.bi) : undefined;
};
export const ipOn = (r: TeR, peer: TeR) => {
  const l = linkOf(r, peer)!;
  return l.a === r ? l.aip : l.bip;
};
export interface TeIfInfo {
  r: TeR;
  ifn: IfName;
  ip: string;
  peer: TeR;
  peerIp: string;
  link: TeLink;
}
export function ifsOf(r: TeR): TeIfInfo[] {
  return TE_LINKS.filter((l) => l.a === r || l.b === r)
    .map((l) => (l.a === r ? { r, ifn: l.ai, ip: l.aip, peer: l.b, peerIp: l.bip, link: l } : { r, ifn: l.bi, ip: l.bip, peer: l.a, peerIp: l.aip, link: l }))
    .sort((x, y) => x.ifn.localeCompare(y.ifn));
}
export const routerByIp = (ip: string): TeR | undefined => TE_ROUTERS.find((r) => TE_LO[r] === ip) ?? TE_LINKS.flatMap((l) => [[l.aip, l.a] as const, [l.bip, l.b] as const]).find(([x]) => x === ip)?.[1];

// ---------------------------------------------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------------------------------------------
export interface TeIfCfg {
  /** A TE interface (XR mpls traffic-eng interface / Junos protocols mpls interface). */
  te: boolean;
  /** RSVP interface bandwidth in kbps (undefined = no RSVP on the interface). */
  rsvp?: number;
  /** Affinity colors (attribute-names / admin-group). */
  attr: string[];
  /** TE metric override (admin-weight / te-metric). */
  teMetric?: number;
  shut: boolean;
}
export interface TeHop {
  /** XR explicit-path index (Junos keeps the order). */
  idx: number;
  ip: string;
  strict: boolean;
}
export interface TePathOpt {
  idx: number;
  kind: "dynamic" | "explicit";
  path?: string;
}
export interface TeTunnel {
  /** XR tunnel-te number. */
  id: number;
  /** Junos LSP name. */
  name: string;
  dst: string;
  /** Requested bandwidth in kbps. */
  bw: number;
  setup: number;
  hold: number;
  opts: TePathOpt[];
  include: string[];
  exclude: string[];
  autoroute: boolean;
  shut: boolean;
}
export interface TeCfg {
  /** IS-IS floods TE information from this router. */
  isisTe: boolean;
  ifs: Record<IfName, TeIfCfg>;
  paths: Record<string, TeHop[]>;
  tunnels: TeTunnel[];
  /** Junos `protocols isis traffic-engineering shortcuts`: every LSP from this router is used by IS-IS. */
  shortcuts?: boolean;
}
/** Whether IS-IS uses the LSP (XR autoroute announce per tunnel, Junos shortcuts per router). */
export const autorouted = (c: TeCfg, t: TeTunnel) => t.autoroute || !!c.shortcuts;
export type TeConfig = Record<TeR, TeCfg>;

const ifc = (rsvp: number, attr: string[]): TeIfCfg => ({ te: true, rsvp, attr, shut: false });
export const tunnel1 = (): TeTunnel => ({ id: 1, name: "TO-R6", dst: TE_LO.R6, bw: 500000, setup: 7, hold: 7, opts: [{ idx: 10, kind: "dynamic" }], include: [], exclude: [], autoroute: true, shut: false });
export const custB = (): TeTunnel => ({ id: 10, name: "CUST-B", dst: TE_LO.R5, bw: 400000, setup: 7, hold: 7, opts: [{ idx: 10, kind: "dynamic" }], include: [], exclude: [], autoroute: true, shut: false });
export function teHealthy(): TeConfig {
  const c = {} as TeConfig;
  for (const r of TE_ROUTERS) {
    const ifs = {} as Record<IfName, TeIfCfg>;
    for (const x of ifsOf(r)) {
      const top = ["R1-R2", "R2-R4", "R4-R6"].includes(x.link.id);
      ifs[x.ifn] = ifc(x.link.id === "R2-R4" ? 200000 : 1000000, x.link.id === "R4-R5" ? ["RED"] : [top ? "BLUE" : "GOLD"]);
    }
    c[r] = { isisTe: true, ifs, paths: {}, tunnels: [] };
  }
  c.R1.tunnels = [tunnel1()];
  c.R3.tunnels = [custB()];
  return c;
}

// ---------------------------------------------------------------------------------------------------------------
// IGP (IS-IS) — SPF on IGP metrics over up links
// ---------------------------------------------------------------------------------------------------------------
export const linkUp = (c: TeConfig, l: TeLink) => !c[l.a].ifs[l.ai].shut && !c[l.b].ifs[l.bi].shut;
export function igpPaths(c: TeConfig, from: TeR): Record<TeR, { cost: number; path: TeR[] } | undefined> {
  const dist: Partial<Record<TeR, { cost: number; path: TeR[] }>> = { [from]: { cost: 0, path: [from] } };
  const done = new Set<TeR>();
  for (;;) {
    const cur = TE_ROUTERS.filter((r) => dist[r] && !done.has(r)).sort((x, y) => dist[x]!.cost - dist[y]!.cost)[0];
    if (!cur) break;
    done.add(cur);
    for (const l of TE_LINKS) {
      if (!linkUp(c, l) || (l.a !== cur && l.b !== cur)) continue;
      const nb = l.a === cur ? l.b : l.a;
      const cost = dist[cur]!.cost + l.metric;
      if (!dist[nb] || cost < dist[nb]!.cost) dist[nb] = { cost, path: [...dist[cur]!.path, nb] };
    }
  }
  return dist as Record<TeR, { cost: number; path: TeR[] } | undefined>;
}

// ---------------------------------------------------------------------------------------------------------------
// TED and CSPF
// ---------------------------------------------------------------------------------------------------------------
export interface TeDir {
  link: TeLink;
  from: TeR;
  to: TeR;
  ifn: IfName;
  ip: string;
  /** Flooded by `from` (in the TED). */
  inTed: boolean;
  up: boolean;
  teMetric: number;
  maxRes: number;
  attr: string[];
}
export const dirKey = (from: TeR, to: TeR) => `${from}>${to}`;
export function tedDirs(c: TeConfig): TeDir[] {
  const out: TeDir[] = [];
  for (const l of TE_LINKS) {
    for (const [from, to, ifn, ip] of [
      [l.a, l.b, l.ai, l.aip],
      [l.b, l.a, l.bi, l.bip],
    ] as [TeR, TeR, IfName, string][]) {
      const ic = c[from].ifs[ifn];
      const up = linkUp(c, l);
      out.push({ link: l, from, to, ifn, ip, up, inTed: up && c[from].isisTe && ic.te, teMetric: ic.teMetric ?? l.metric, maxRes: ic.rsvp ?? 0, attr: ic.attr });
    }
  }
  return out;
}
export interface TeResv {
  key: string;
  /** Headend and tunnel id of the LSP holding it. */
  lsp: string;
  bw: number;
  hold: number;
}
export const lspKey = (r: TeR, id: number) => `${r}:${id}`;
/** Unreserved bandwidth (kbps) on a direction at priority p, given the reservations so far. */
export function unreserved(d: TeDir, resv: TeResv[], p: number, ignore?: string) {
  return d.maxRes - resv.filter((x) => x.key === dirKey(d.from, d.to) && x.hold <= p && x.lsp !== ignore).reduce((a, x) => a + x.bw, 0);
}
export type CspfWhy = "bandwidth" | "affinity" | "topology" | "explicit" | "dest";
export interface CspfResult {
  ok: boolean;
  path?: TeR[];
  cost?: number;
  why?: CspfWhy;
  detail?: string;
}
interface CspfIn {
  dirs: TeDir[];
  resv: TeResv[];
  bw: number;
  setup: number;
  include: string[];
  exclude: string[];
  self?: string;
}
function usable(d: TeDir, q: CspfIn, dirs: TeDir[], skip: Partial<Record<CspfWhy, boolean>> = {}) {
  const back = dirs.find((x) => x.from === d.to && x.to === d.from)!;
  if (!d.up) return false;
  if (!skip.topology && !(d.inTed && back.inTed)) return false;
  if (!skip.bandwidth && unreserved(d, q.resv, q.setup, q.self) < q.bw) return false;
  if (!skip.affinity && (!q.include.every((a) => d.attr.includes(a)) || q.exclude.some((a) => d.attr.includes(a)))) return false;
  return true;
}
function shortest(q: CspfIn, from: TeR, to: TeR, avoid: Set<TeR>, skip: Partial<Record<CspfWhy, boolean>> = {}): { path: TeR[]; cost: number } | undefined {
  const dist: Partial<Record<TeR, { cost: number; path: TeR[] }>> = { [from]: { cost: 0, path: [from] } };
  const done = new Set<TeR>();
  for (;;) {
    const cur = TE_ROUTERS.filter((r) => dist[r] && !done.has(r)).sort((x, y) => dist[x]!.cost - dist[y]!.cost || TE_ROUTERS.indexOf(x) - TE_ROUTERS.indexOf(y))[0];
    if (!cur) break;
    done.add(cur);
    for (const d of q.dirs) {
      if (d.from !== cur || (avoid.has(d.to) && d.to !== to) || !usable(d, q, q.dirs, skip)) continue;
      const cost = dist[cur]!.cost + d.teMetric;
      if (!dist[d.to] || cost < dist[d.to]!.cost) dist[d.to] = { cost, path: [...dist[cur]!.path, d.to] };
    }
  }
  return dist[to];
}
/** CSPF for one path option. */
export function cspf(c: TeConfig, head: TeR, t: TeTunnel, opt: TePathOpt, resv: TeResv[], self?: string): CspfResult {
  const tail = routerByIp(t.dst);
  if (!tail || TE_LO[tail] !== t.dst) return { ok: false, why: "dest", detail: `${t.dst} is not a TE router ID in the TED` };
  const q: CspfIn = { dirs: tedDirs(c), resv, bw: t.bw, setup: t.setup, include: t.include, exclude: t.exclude, self };
  const route = (skip: Partial<Record<CspfWhy, boolean>>): CspfResult => {
    if (opt.kind === "dynamic") {
      const r = shortest(q, head, tail, new Set(), skip);
      return r ? { ok: true, ...r } : { ok: false };
    }
    const hops = c[head].paths[opt.path ?? ""];
    if (!hops) return { ok: false, why: "explicit", detail: `explicit path ${opt.path} is not defined` };
    let path: TeR[] = [head];
    let cost = 0;
    const list = [...hops];
    list.sort((x, y) => x.idx - y.idx);
    if (!list.length || routerByIp(list[list.length - 1].ip) !== tail) list.push({ idx: 9999, ip: t.dst, strict: false });
    for (const h of list) {
      const target = routerByIp(h.ip);
      const cur = path[path.length - 1];
      if (!target) return { ok: false, why: "explicit", detail: `${h.ip} is not an address in the TED` };
      if (target === cur) continue;
      if (h.strict) {
        const d = q.dirs.find((x) => x.from === cur && x.to === target);
        if (!d) return { ok: false, why: "explicit", detail: `strict hop ${h.ip} (${target}) is not adjacent to ${cur}` };
        if (!usable(d, q, q.dirs, skip)) return { ok: false };
        path = [...path, target];
        cost += d.teMetric;
      } else {
        const seg = shortest(q, cur, target, new Set(path), skip);
        if (!seg) return { ok: false };
        path = [...path, ...seg.path.slice(1)];
        cost += seg.cost;
      }
    }
    return { ok: true, path, cost };
  };
  const r = route({});
  if (r.ok || r.why) return r;
  // Name the constraint that ruled out every path, the way an engineer would find it.
  if (route({ bandwidth: true }).ok) return { ok: false, why: "bandwidth", detail: `no path has ${t.bw} kbps unreserved at priority ${t.setup}` };
  if (route({ affinity: true }).ok) return { ok: false, why: "affinity", detail: "no path meets the affinity constraints" };
  if (route({ bandwidth: true, affinity: true }).ok) return { ok: false, why: "bandwidth", detail: "no path meets both the bandwidth and the affinity constraints" };
  return { ok: false, why: "topology", detail: `no path to ${t.dst} in the TED (missing or one-way TE links)` };
}

// ---------------------------------------------------------------------------------------------------------------
// LSP placement (with preemption), labels
// ---------------------------------------------------------------------------------------------------------------
export interface TeLsp {
  key: string;
  head: TeR;
  id: number;
  name: string;
  tail?: TeR;
  state: "up" | "down" | "admin-down";
  path?: TeR[];
  opt?: number;
  /** Why it is down (or the last failure of the options tried before the one that worked). */
  why?: string;
  whyKind?: CspfWhy | "preempted";
  /** Labels per hop (the label each router asked its upstream to use): implicit-null at the tail. */
  labels: Partial<Record<TeR, number>>;
  preemptedBy?: string;
  tried: { idx: number; ok: boolean; detail?: string }[];
  /** Bandwidth (kbps) reserved by the instance that is up. */
  bw: number;
  /** A larger bandwidth was requested but couldn't be signaled: the existing LSP stays up at its old bandwidth. */
  resizeFailed?: string;
}
export interface TeView {
  lsps: TeLsp[];
  resv: TeResv[];
}
export type TeOs = "xr" | "junos";
export const LABEL_BASE: Record<TeOs, number> = { xr: 24000, junos: 299776 };
const allTunnels = (c: TeConfig) => TE_ROUTERS.flatMap((r) => c[r].tunnels.map((t) => ({ r, t })));
export function lspSlot(c: TeConfig, key: string) {
  return allTunnels(c).findIndex((x) => lspKey(x.r, x.t.id) === key);
}
const reserve = (path: TeR[], lsp: string, bw: number, hold: number): TeResv[] => path.slice(0, -1).map((r, i) => ({ key: dirKey(r, path[i + 1]), lsp, bw, hold }));
export function placeLsps(c: TeConfig, os: TeOs, prev?: TeView): TeView {
  const order = allTunnels(c).sort((x, y) => {
    // Incumbent: up before and not asking for more bandwidth than it holds (a resize competes like a new LSP).
    const inc = (k: string, t: TeTunnel) => {
      const o = prev?.lsps.find((l) => l.key === k);
      return o?.state === "up" && o.bw >= t.bw ? 0 : 1;
    };
    return x.t.setup - y.t.setup || inc(lspKey(x.r, x.t.id), x.t) - inc(lspKey(y.r, y.t.id), y.t) || TE_ROUTERS.indexOf(x.r) - TE_ROUTERS.indexOf(y.r) || x.t.id - y.t.id;
  });
  let resv: TeResv[] = [];
  const lsps: TeLsp[] = [];
  for (const { r, t } of order) {
    const key = lspKey(r, t.id);
    const tail = routerByIp(t.dst);
    const base: TeLsp = { key, head: r, id: t.id, name: t.name, tail: tail && TE_LO[tail] === t.dst ? tail : undefined, state: "down", labels: {}, tried: [], bw: t.bw };
    if (t.shut) {
      lsps.push({ ...base, state: "admin-down", why: "administratively down" });
      continue;
    }
    const old = prev?.lsps.find((l) => l.key === key);
    let placed: { path: TeR[]; opt: number } | undefined;
    let fail: CspfResult | undefined;
    // Keep the current path while it is still valid (same option).
    if (old?.state === "up" && old.path && old.opt !== undefined) {
      const o = t.opts.find((x) => x.idx === old.opt);
      if (o) {
        const q: CspfIn = { dirs: tedDirs(c), resv, bw: t.bw, setup: t.setup, include: t.include, exclude: t.exclude };
        const okPath = old.path.every((x, i) => i === 0 || usable(q.dirs.find((d) => d.from === old.path![i - 1] && d.to === x)!, q, q.dirs));
        const still = okPath && (o.kind === "dynamic" || cspf(c, r, t, o, resv).path?.join() === old.path.join() || explicitStillMatches(c, r, t, o, old.path, resv));
        if (still) placed = { path: old.path, opt: o.idx };
      }
    }
    if (!placed) {
      for (const o of [...t.opts].sort((a, b) => a.idx - b.idx)) {
        const res = cspf(c, r, t, o, resv);
        base.tried.push({ idx: o.idx, ok: res.ok, detail: res.detail });
        if (res.ok && res.path) {
          placed = { path: res.path, opt: o.idx };
          break;
        }
        fail = res;
      }
    }
    if (!t.opts.length) {
      lsps.push({ ...base, why: "no path-option configured", whyKind: "topology" });
      continue;
    }
    // Make-before-break: a resize that can't be signaled leaves the current LSP up at the bandwidth it has.
    if (!placed && old?.state === "up" && old.path && old.bw < t.bw && t.opts.some((o) => o.idx === old.opt)) {
      const q: CspfIn = { dirs: tedDirs(c), resv, bw: old.bw, setup: t.setup, include: t.include, exclude: t.exclude };
      if (old.path.every((x, i) => i === 0 || usable(q.dirs.find((d) => d.from === old.path![i - 1] && d.to === x)!, q, q.dirs))) {
        placed = { path: old.path, opt: old.opt! };
        base.bw = old.bw;
        base.resizeFailed = fail?.detail ?? "no path";
      }
    }
    if (!placed) {
      lsps.push({ ...base, why: fail?.detail ?? "no path", whyKind: fail?.why });
      continue;
    }
    resv = [...resv, ...reserve(placed.path, key, base.bw, t.hold)];
    const slot = lspSlot(c, key) + 1;
    const labels: Partial<Record<TeR, number>> = {};
    placed.path.forEach((x, i) => {
      if (i === 0) return;
      labels[x] = i === placed!.path.length - 1 ? IMPLICIT_NULL : LABEL_BASE[os] + 100 * TE_ROUTERS.indexOf(x) + slot;
    });
    lsps.push({ ...base, state: "up", path: placed.path, opt: placed.opt, labels });
  }
  // Preemption: an LSP that was up, is not up on the same path now, and whose old path would still fit if the LSPs with
  // a better setup priority than its hold priority were not there.
  for (const l of lsps) {
    const old = prev?.lsps.find((x) => x.key === l.key);
    if (old?.state !== "up" || !old.path || (l.state === "up" && l.path?.join() === old.path.join())) continue;
    const t = c[l.head].tunnels.find((x) => x.id === l.id);
    if (!t || t.shut) continue;
    const winners = lsps.filter((x) => x.key !== l.key && x.state === "up" && (c[x.head].tunnels.find((y) => y.id === x.id)?.setup ?? 8) < t.hold);
    const others = resv.filter((x) => x.lsp !== l.key && !winners.some((w) => w.key === x.lsp));
    const q: CspfIn = { dirs: tedDirs(c), resv: others, bw: t.bw, setup: t.setup, include: t.include, exclude: t.exclude };
    const fits = old.path.every((x, i) => i === 0 || usable(q.dirs.find((d) => d.from === old.path![i - 1] && d.to === x)!, q, q.dirs));
    if (fits && winners.some((w) => w.path?.some((x, i) => i > 0 && old.path!.join(">").includes(`${w.path![i - 1]}>${x}`)))) {
      l.preemptedBy = winners.map((w) => w.name).join(", ");
      if (l.state !== "up") {
        l.whyKind = "preempted";
        l.why = `preempted by ${l.preemptedBy} (better priority), and ${l.why ?? "no other path"}`;
      }
    }
  }
  return { lsps: TE_ROUTERS.flatMap((r) => c[r].tunnels.map((t) => lsps.find((l) => l.key === lspKey(r, t.id))!)), resv };
}
function explicitStillMatches(c: TeConfig, r: TeR, t: TeTunnel, o: TePathOpt, path: TeR[], resv: TeResv[]) {
  const hops = c[r].paths[o.path ?? ""];
  if (!hops) return false;
  return hops.every((h) => path.includes(routerByIp(h.ip) ?? ("-" as TeR))) && cspf(c, r, t, o, resv).ok;
}
export const lspOf = (v: TeView, head: TeR, id: number) => v.lsps.find((l) => l.key === lspKey(head, id));
export const tunnelOf = (c: TeConfig, head: TeR, id: number) => c[head].tunnels.find((t) => t.id === id);

// ---------------------------------------------------------------------------------------------------------------
// Forwarding and traffic
// ---------------------------------------------------------------------------------------------------------------
/** The prefixes behind each router (its loopback, its customer network). */
export function prefixesBehind(r: TeR): string[] {
  return [`${TE_LO[r]}/32`, ...(Object.values(CE_NET).filter((x) => x.r === r).map((x) => x.net)), ...(r === "R5" ? [CUSTB_NET] : [])];
}
export interface TeRoute {
  via: "igp" | "tunnel";
  tunnel?: TeLsp;
  path: TeR[];
  cost: number;
}
/** How `from` forwards toward router `to` (autoroute / shortcuts make a tunnel to `to` the route). */
export function routeTo(c: TeConfig, v: TeView, from: TeR, to: TeR): TeRoute | undefined {
  if (from === to) return { via: "igp", path: [from], cost: 0 };
  const t = c[from].tunnels.find((x) => autorouted(c[from], x) && !x.shut && x.dst === TE_LO[to] && lspOf(v, from, x.id)?.state === "up");
  const igp = igpPaths(c, from)[to];
  if (t) {
    const l = lspOf(v, from, t.id)!;
    return { via: "tunnel", tunnel: l, path: l.path!, cost: igp?.cost ?? 0 };
  }
  return igp ? { via: "igp", path: igp.path, cost: igp.cost } : undefined;
}
/** The full forwarding path from `from` to the router owning `to`, re-deciding at each router (tunnels end at the tail). */
export function forwardPath(c: TeConfig, v: TeView, from: TeR, to: TeR): { path: TeR[]; segments: { via: "igp" | "tunnel"; tunnel?: TeLsp; path: TeR[] }[] } | undefined {
  let at = from;
  const path: TeR[] = [from];
  const segments: { via: "igp" | "tunnel"; tunnel?: TeLsp; path: TeR[] }[] = [];
  for (let guard = 0; at !== to && guard < 8; guard++) {
    const r = routeTo(c, v, at, to);
    if (!r) return undefined;
    if (r.via === "tunnel") {
      segments.push({ via: "tunnel", tunnel: r.tunnel, path: r.path });
      path.push(...r.path.slice(1));
      at = r.path[r.path.length - 1];
    } else {
      const nx = r.path[1];
      const lastSeg = segments[segments.length - 1];
      if (lastSeg?.via === "igp") lastSeg.path.push(nx);
      else segments.push({ via: "igp", path: [at, nx] });
      path.push(nx);
      at = nx;
    }
  }
  return at === to ? { path, segments } : undefined;
}
export interface TeFlow {
  id: string;
  from: TeR;
  to: TeR;
  mbps: number;
}
/** CUST-B's own traffic (R3 → R5), present unless the customer was decommissioned. */
export const custBFlow = (s: { custB: boolean }): TeFlow[] => (s.custB ? [{ id: "custb", from: "R3", to: "R5", mbps: 400 }] : []);
export function linkLoads(c: TeConfig, v: TeView, flows: TeFlow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const l of TE_LINKS) {
    out[dirKey(l.a, l.b)] = linkUp(c, l) ? l.load[0] : 0;
    out[dirKey(l.b, l.a)] = linkUp(c, l) ? l.load[1] : 0;
  }
  for (const f of flows) {
    const fp = forwardPath(c, v, f.from, f.to);
    fp?.path.forEach((x, i) => {
      if (i > 0) out[dirKey(fp.path[i - 1], x)] += f.mbps;
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------------------------
export interface TeSnap {
  view: TeView;
}
export interface TeTest {
  id: number;
  from: TeCe;
  to: TeCe;
  mbps: number;
  ok: boolean;
  path: string[];
  via: string;
  lossPct: number;
  hot?: string;
  why?: string;
  cfgSeq: number;
}
export interface TeSys {
  t: number;
  dev: TeR;
  kind: "up" | "down" | "commit" | "preempt";
  what?: string;
  why?: string;
}
export interface TeState extends SpBase<TeSnap> {
  os: TeOs;
  cfg: TeConfig;
  hist: Record<TeR, TeCfg[]>;
  view: TeView;
  sys: TeSys[];
  tests: TeTest[];
  /** CUST-B still sends its 400 Mbps. */
  custB: boolean;
  since: Record<string, number>;
  wiped?: boolean;
}
export type TeAction =
  | { type: "cfg"; dev: TeR; cfg: TeCfg; text: string }
  | { type: "set"; changes: { dev: TeR; f: (c: TeCfg) => void }[]; text: string }
  | { type: "link"; link: string; up: boolean }
  | { type: "test"; from: TeCe; mbps: number }
  | { type: "cspf"; dev: TeR; id: number }
  | { type: "ticket"; id: TeTicketId }
  | { type: "os"; os: TeOs }
  | { type: "custb"; on: boolean }
  | { type: "reload"; dev: TeR }
  | { type: "wipe-r1" };

const cl = (o: TeState): TeState => ({ ...spClone(o), runs: o.runs, last: o.last });
export function createTeNet(seq = 0, os: TeOs = "xr"): TeState {
  const cfg = teHealthy();
  const view = placeLsps(cfg, os);
  const s: TeState = { seq, os, cfgSeq: 0, clock: 3600, runs: [], log: [{ seq, t: 3600, text: "IS-IS and RSVP-TE converged: tunnel-te1 (R1 → R6, 500 Mbps) and CUST-B (R3 → R5, 400 Mbps) are up.", tone: "info" }], cfg, hist: Object.fromEntries(TE_ROUTERS.map((r) => [r, []])) as unknown as Record<TeR, TeCfg[]>, view, sys: [], tests: [], custB: true, since: {} };
  for (const l of view.lsps) if (l.state === "up") {
    s.since[l.key] = 40;
    s.sys.push({ t: 40, dev: l.head, kind: "up", what: l.name });
  }
  return s;
}

// ---------------------------------------------------------------------------------------------------------------
// The customer flow test
// ---------------------------------------------------------------------------------------------------------------
export const DEMAND: Record<TeCe, number> = { CE1: 500, CE6: 300 };
const peerCe = (ce: TeCe): TeCe => (ce === "CE1" ? "CE6" : "CE1");
export function teFlow(s: TeState, from: TeCe, mbps: number) {
  const to = peerCe(from);
  const a = CE_NET[from].r;
  const b = CE_NET[to].r;
  const fp = forwardPath(s.cfg, s.view, a, b);
  if (!fp) return { ok: false, path: [from, a], via: "—", lossPct: 100, why: `${a} has no route to ${CE_NET[to].net}`, segments: [] };
  const loads = linkLoads(s.cfg, s.view, custBFlow(s));
  let worst = 0;
  let hot: string | undefined;
  fp.path.forEach((x, i) => {
    if (i === 0) return;
    const k = dirKey(fp.path[i - 1], x);
    const total = loads[k] + mbps;
    const loss = total > LINK_MBPS ? (total - LINK_MBPS) / total : 0;
    if (loss > worst) {
      worst = loss;
      hot = k;
    }
  });
  const seg0 = fp.segments[0];
  const via = seg0?.via === "tunnel" ? `${s.os === "xr" ? `tunnel-te${seg0.tunnel!.id}` : seg0.tunnel!.name} (RSVP-TE)` : "IS-IS shortest path";
  const lossPct = Math.round(worst * 100);
  const hotTxt = hot ? hot.replace(">", "→") : "";
  return {
    ok: lossPct === 0,
    path: [from, ...fp.path, to],
    via,
    lossPct,
    hot: hot ? hot.replace(">", "-") : undefined,
    why: lossPct ? `${hotTxt} would carry ${hot ? loads[hot] + mbps : 0} Mbps on a 1000 Mbps link — ${lossPct}% of the flow is dropped` : undefined,
    segments: fp.segments,
  };
}
function flowRun(s: TeState, t: TeTest, segs: ReturnType<typeof teFlow>["segments"]): SpRun<TeSnap> {
  const snap = { view: spClone(s.view) };
  const moments: SpMoment<TeSnap>[] = [];
  const a = CE_NET[t.from].r;
  moments.push({ tokens: [{ from: t.from, to: a, label: `${t.mbps} Mbps`, color: "green" }], lines: [{ text: `${t.from} sends a ${t.mbps} Mbps flow to ${CE_NET[t.to].net}.`, tone: "info" }], snap });
  for (const sg of segs) {
    if (sg.via === "tunnel" && sg.tunnel) {
      const l = sg.tunnel;
      const name = s.os === "xr" ? `tunnel-te${l.id}` : l.name;
      sg.path.forEach((x, i) => {
        if (i === 0) return;
        const prevR = sg.path[i - 1];
        const lab = l.labels[x];
        const inLab = l.labels[prevR];
        const action = i === 1 ? `push ${lab === IMPLICIT_NULL ? "nothing (one hop)" : lab}` : lab === IMPLICIT_NULL ? `pop ${inLab} (PHP)` : `swap ${inLab} → ${lab}`;
        const bad = t.hot === `${prevR}-${x}`;
        moments.push({ tokens: [{ from: prevR, to: x, label: lab === IMPLICIT_NULL ? "IP" : `label ${lab}`, color: bad ? "red" : "violet" }], lines: [{ text: i === 1 ? `${prevR}: ${CE_NET[t.to].net} is routed into ${name} (${s.os === "xr" ? "autoroute announce" : "IS-IS shortcuts"}) → ${action}.` : `${prevR}: ${action}.`, tone: "learn" }], hot: [`${prevR}-${x}`, `${x}-${prevR}`], bad: bad ? [`${prevR}-${x}`] : undefined, snap });
      });
    } else {
      sg.path.forEach((x, i) => {
        if (i === 0) return;
        const prevR = sg.path[i - 1];
        const bad = t.hot === `${prevR}-${x}`;
        moments.push({ tokens: [{ from: prevR, to: x, label: "IP", color: bad ? "red" : "green" }], lines: [{ text: `${prevR}: IS-IS route toward ${CE_NET[t.to].net} → ${x}.`, tone: "info" }], hot: [`${prevR}-${x}`], bad: bad ? [`${prevR}-${x}`] : undefined, snap });
      });
    }
  }
  if (t.ok) moments.push({ tokens: [{ from: CE_NET[t.to].r, to: t.to, label: `${t.mbps} Mbps`, color: "green" }], lines: [{ text: `${t.to} receives the whole ${t.mbps} Mbps — no link on the way is overloaded.`, tone: "ok" }], snap });
  else moments.push({ tokens: [], lines: [{ text: t.why ?? "dropped", tone: "bad" }], views: t.hot ? { [t.hot.split("-")[0]]: { ring: "bad", bubble: { text: `${t.lossPct}% dropped`, tone: "bad" } } } : undefined, snap });
  return { id: s.runs.length + 1 + s.seq * 1000, cmd: `${t.mbps} Mbps from ${t.from} to ${t.to}`, kind: "test", moments, ok: t.ok };
}
export function teTest(s0: TeState, from: TeCe, mbps: number): TeState {
  const s = cl(s0);
  s.clock += 2;
  const r = teFlow(s, from, mbps);
  const t: TeTest = { id: s.tests.length + 1, from, to: peerCe(from), mbps, ok: r.ok, path: r.path, via: r.via, lossPct: r.lossPct, hot: r.hot, why: r.why, cfgSeq: s.cfgSeq };
  s.tests = [...s.tests, t].slice(-40);
  const run = flowRun(s, t, r.segments);
  s.runs = [...s.runs, run];
  s.last = run;
  s.log = [...s.log, { seq: s.seq, t: s.clock, text: `${mbps} Mbps ${from} → ${t.to} via ${r.via}: ${r.ok ? "delivered" : r.why}`, tone: r.ok ? "ok" : "warn" }];
  return s;
}

// ---------------------------------------------------------------------------------------------------------------
// Changes: TED flooding, CSPF, PATH / RESV, preemption
// ---------------------------------------------------------------------------------------------------------------
const mb = (kbps: number) => `${Math.round(kbps / 1000)} Mbps`;
export const lspLabel = (os: TeOs, l: { id: number; name: string }) => (os === "xr" ? `tunnel-te${l.id}` : l.name);
function signalMoments(s: TeState, l: TeLsp, t: TeTunnel, snap: TeSnap): SpMoment<TeSnap>[] {
  const ms: SpMoment<TeSnap>[] = [];
  const p = l.path!;
  const name = lspLabel(s.os, l);
  const ero = p.slice(1).map((x) => TE_LO[x]).join(" → ");
  ms.push({ tokens: p.slice(1).map((x, i) => ({ from: p[i], to: x, label: "PATH", color: "cyan", delay: i * 500 })), lines: [{ text: `${l.head} signals ${name}: PATH with ERO ${ero}, ${mb(t.bw)} requested, setup/hold priority ${t.setup}/${t.hold}. Each hop checks it can admit the bandwidth on its outgoing interface and passes PATH on.`, tone: "info" }], hot: p.slice(1).map((x, i) => `${p[i]}-${x}`), snap });
  const back = [...p].reverse();
  ms.push({
    tokens: back.slice(1).map((x, i) => ({ from: back[i], to: x, label: `RESV ${l.labels[back[i]] === IMPLICIT_NULL ? "imp-null" : l.labels[back[i]]}`, color: "violet", delay: i * 500, lane: 1 })),
    lines: [{ text: `${p[p.length - 1]} answers with RESV: label implicit-null (pop before me). Going upstream, every hop reserves ${mb(t.bw)} on its outgoing interface and picks its own label: ${p.slice(1, -1).map((x) => `${x} ${l.labels[x]}`).join(", ") || "none — one hop"}.`, tone: "learn" }],
    snap,
  });
  ms.push({ tokens: [], lines: [{ text: `${name} is up on ${p.join(" → ")}. IS-IS floods the new unreserved bandwidth of every link it reserved on.`, tone: "ok" }], views: { [l.head]: { ring: "on", bubble: { text: `${name} up`, tone: "yes" } } }, snap });
  return ms;
}
function converge(prev: TeState, s: TeState, why: string, show = true): TeState {
  const view = placeLsps(s.cfg, s.os, prev.view);
  s.view = view;
  const snap = { view: spClone(view) };
  const moments: SpMoment<TeSnap>[] = [];
  // TED changes
  const pd = tedDirs(prev.cfg);
  const nd = tedDirs(s.cfg);
  const ted: SpLine[] = [];
  for (const d of nd) {
    const o = pd.find((x) => x.from === d.from && x.to === d.to)!;
    if (o.inTed !== d.inTed) ted.push({ text: `${d.from}: ${d.from}→${d.to} ${d.inTed ? "is flooded in the TED again" : d.up ? "is no longer a TE link — removed from the TED" : "is down — removed from IS-IS and the TED"}.`, tone: d.inTed ? "ok" : "warn" });
    else if (d.inTed && (o.maxRes !== d.maxRes || o.teMetric !== d.teMetric || o.attr.join() !== d.attr.join())) ted.push({ text: `${d.from} floods ${d.from}→${d.to}: ${o.maxRes !== d.maxRes ? `reservable ${mb(d.maxRes)}` : ""}${o.teMetric !== d.teMetric ? ` TE metric ${d.teMetric}` : ""}${o.attr.join() !== d.attr.join() ? ` colors ${d.attr.join(" ") || "none"}` : ""}.`, tone: "info" });
  }
  if (ted.length) moments.push({ tokens: [], lines: ted.slice(0, 6), snap });
  for (const l of view.lsps) {
    const o = prev.view.lsps.find((x) => x.key === l.key);
    const t = s.cfg[l.head].tunnels.find((x) => x.id === l.id)!;
    const name = lspLabel(s.os, l);
    const samePath = o?.state === "up" && l.state === "up" && o.path?.join() === l.path?.join();
    const resized = samePath && JSON.stringify(prev.cfg[l.head].tunnels.find((x) => x.id === l.id)) !== JSON.stringify(t);
    if (samePath && l.resizeFailed) {
      if (o?.resizeFailed !== l.resizeFailed || resized) moments.push({ tokens: [], lines: [{ text: `${name}: the new bandwidth (${mb(t.bw)}) can't be signaled — ${l.resizeFailed}. Make-before-break keeps the existing LSP up on ${l.path!.join("→")} with ${mb(l.bw)} reserved.`, tone: "warn" }], snap });
      continue;
    }
    if (samePath && !resized) continue;
    if (l.preemptedBy && o?.state === "up") {
      moments.push({ tokens: o.path!.slice(1).map((x, i) => ({ from: o.path![i + 1], to: o.path![i], label: "PathErr preempt", color: "red", delay: i * 300 })).reverse(), lines: [{ text: `${name} is preempted on its path: ${l.preemptedBy} has a better setup priority than ${name}'s hold priority ${t.hold}, so the hops give the bandwidth to it.`, tone: "bad" }], snap });
      s.sys.push({ t: s.clock, dev: l.head, kind: "preempt", what: l.name, why: l.preemptedBy });
    }
    if (l.state === "up") {
      if (o?.state === "up" && !samePath) moments.push({ tokens: [], lines: [{ text: `${name} moves from ${o.path!.join("→")} to ${l.path!.join("→")} (make-before-break: the new LSP is signaled before the old one is torn down).`, tone: "learn" }], snap });
      if (l.tried.some((x) => !x.ok)) moments.push({ tokens: [], lines: l.tried.filter((x) => !x.ok).map((x) => ({ text: `${l.head}: path-option ${x.idx} fails CSPF — ${x.detail ?? "no path meets the constraints"}.`, tone: "warn" as const })), snap });
      moments.push(...signalMoments(s, l, t, snap));
      if (o?.state !== "up") {
        s.since[l.key] = s.clock;
        s.sys.push({ t: s.clock, dev: l.head, kind: "up", what: l.name });
      }
    } else if (o?.state === "up" || !o) {
      if (o?.state === "up" && o.path) moments.push({ tokens: o.path.slice(1).map((x, i) => ({ from: o.path![i], to: x, label: "PathTear", color: "red", delay: i * 300 })), lines: [{ text: `${name} goes down: ${l.why}. ${l.head} tears it down (PathTear) and every hop releases the reservation.`, tone: "bad" }], snap });
      else moments.push({ tokens: [], lines: [{ text: `${name}: ${l.why}.`, tone: "bad" }], snap });
      s.sys.push({ t: s.clock, dev: l.head, kind: "down", what: l.name, why: l.why });
    } else if (o.why === "reload") {
      moments.push({ tokens: [], lines: [{ text: `${name} can't come back after the reload: ${l.why}.`, tone: "bad" }], snap });
      s.sys.push({ t: s.clock, dev: l.head, kind: "down", what: l.name, why: l.why });
    } else if (o.why !== l.why) moments.push({ tokens: [], lines: [{ text: `${name} stays down: ${l.why}.`, tone: "warn" }], snap });
  }
  if (show && moments.length) {
    const run: SpRun<TeSnap> = { id: s.runs.length + 1 + s.seq * 1000, cmd: why, kind: "converge", moments };
    s.runs = [...s.runs, run];
    s.last = run;
  }
  return s;
}
/** A CSPF computation, explained (Learn): prune, then shortest path — nothing is signaled. */
function cspfRun(s0: TeState, dev: TeR, id: number): TeState {
  const s = cl(s0);
  const t = tunnelOf(s.cfg, dev, id);
  if (!t) return s;
  const snap = { view: spClone(s.view) };
  const name = lspLabel(s.os, t);
  const others = s.view.resv.filter((x) => x.lsp !== lspKey(dev, id));
  const dirs = tedDirs(s.cfg);
  const pruned: SpLine[] = [];
  const bad: string[] = [];
  for (const d of dirs) {
    const un = unreserved(d, others, t.setup);
    if (!d.inTed) pruned.push({ text: `${d.from}→${d.to}: not in the TED.`, tone: "warn" });
    else if (un < t.bw) {
      pruned.push({ text: `${d.from}→${d.to}: ${mb(un)} unreserved < ${mb(t.bw)} → pruned.`, tone: "warn" });
      bad.push(`${d.from}-${d.to}`);
    } else if (!t.include.every((a) => d.attr.includes(a)) || t.exclude.some((a) => d.attr.includes(a))) {
      pruned.push({ text: `${d.from}→${d.to}: colors ${d.attr.join(" ") || "none"} fail the affinity → pruned.`, tone: "warn" });
      bad.push(`${d.from}-${d.to}`);
    }
  }
  const opt = t.opts[0] ?? { idx: 10, kind: "dynamic" as const };
  const res = cspf(s.cfg, dev, t, opt, others, lspKey(dev, id));
  const moments: SpMoment<TeSnap>[] = [
    { tokens: [], lines: [{ text: `${dev} runs CSPF for ${name}: ${mb(t.bw)} to ${t.dst}${t.include.length ? `, include ${t.include.join(" ")}` : ""}${t.exclude.length ? `, exclude ${t.exclude.join(" ")}` : ""}. Step 1 — prune every link direction that can't carry it:`, tone: "info" }, ...(pruned.length ? pruned.filter((x) => x.text.includes("pruned")).slice(0, 6) : [{ text: "nothing is pruned.", tone: "ok" as const }])], bad, snap },
    { tokens: [], lines: [{ text: res.ok ? `Step 2 — shortest path by TE metric on what is left: ${res.path!.join(" → ")} (TE cost ${res.cost}). This becomes the ERO.` : `Step 2 — no path is left: ${res.detail}.`, tone: res.ok ? "ok" : "bad" }], hot: res.path ? res.path.slice(1).map((x, i) => `${res.path![i]}-${x}`) : undefined, bad, snap },
  ];
  const run: SpRun<TeSnap> = { id: s.runs.length + 1 + s.seq * 1000, cmd: `${dev}: CSPF for ${name}`, kind: "cspf", moments, ok: res.ok };
  s.runs = [...s.runs, run];
  s.last = run;
  return s;
}

// ---------------------------------------------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------------------------------------------
export type TeTicketId = "bw" | "telink" | "explicit" | "affinity" | "autoroute";
export interface TeTicketDef {
  id: TeTicketId;
  title: string;
  report: string;
  reproLabel: string;
  repro: TeAction[];
  fault: (s: TeState) => void;
}
const flow = (mbps: number): TeAction => ({ type: "test", from: "CE1", mbps });
export const TE_TICKETS: TeTicketDef[] = [
  {
    id: "bw",
    title: "The video upgrade that never came up",
    report: "“The video service was upgraded to 700 Mbps in last night's window (tunnel-te1 resized, R1 reloaded). Since then the stream breaks up. Also on the change list: CUST-B (R3 → R5) was decommissioned last week.”",
    reproLabel: "send 700 Mbps from CE1 to CE6",
    repro: [flow(700)],
    fault: (s) => {
      s.custB = false;
      s.cfg.R1.tunnels[0].bw = 700000;
    },
  },
  {
    id: "telink",
    title: "The tunnel that lost its path",
    report: "“R3's line card toward R5 was replaced on Tuesday. The link is up and IS-IS is fine, but the video tunnel and CUST-B's tunnel have been down since, and the video stream is choppy.”",
    reproLabel: "send 500 Mbps from CE1 to CE6",
    repro: [flow(500)],
    fault: (s) => {
      s.cfg.R3.ifs["ge-0/0/1"].te = false;
    },
  },
  {
    id: "explicit",
    title: "Pinned, and never came up",
    report: "“Last night we pinned the video tunnel to the R3 side with an explicit path, as primary path-option. It has not come up since.”",
    reproLabel: "send 500 Mbps from CE1 to CE6",
    repro: [flow(500)],
    fault: (s) => {
      s.cfg.R1.paths["VIA-R3"] = [
        { idx: 1, ip: TE_LO.R3, strict: true },
        { idx: 2, ip: TE_LO.R4, strict: true },
        { idx: 3, ip: TE_LO.R6, strict: true },
      ];
      s.cfg.R1.tunnels[0].opts = [{ idx: 10, kind: "explicit", path: "VIA-R3" }];
    },
  },
  {
    id: "affinity",
    title: "Down after the color audit",
    report: "“The video tunnel must only use GOLD links (that's in its config). After yesterday's link-color audit on R5 it is down.”",
    reproLabel: "send 500 Mbps from CE1 to CE6",
    repro: [flow(500)],
    fault: (s) => {
      s.cfg.R1.tunnels[0].include = ["GOLD"];
      s.cfg.R5.ifs["ge-0/0/1"].attr = ["BLUE"];
    },
  },
  {
    id: "autoroute",
    title: "Up, reserved — and unused",
    report: "“tunnel-te1 is up with 500 Mbps reserved on the R3 side — the NOC checked — and still the video stream is choppy. A template was re-applied to R1 last night.”",
    reproLabel: "send 500 Mbps from CE1 to CE6",
    repro: [flow(500)],
    fault: (s) => {
      s.cfg.R1.tunnels[0].autoroute = false;
    },
  },
];
export const teTicket = (id: string) => TE_TICKETS.find((t) => t.id === id)!;
export function teTicketState(id: TeTicketId, seq = 0, os: TeOs = "xr"): TeState {
  const s = createTeNet(seq, os);
  const nx = cl(s);
  teTicket(id).fault(nx);
  // The "bw" change came with a reload of R1: its LSPs are signaled from scratch, CUST-B is the incumbent.
  if (id === "bw") s.view = { ...s.view, lsps: s.view.lsps.map((l) => (l.head === "R1" ? { ...l, state: "down" as const, path: undefined } : l)), resv: s.view.resv.filter((x) => !x.lsp.startsWith("R1:")) };
  const out = converge(s, nx, "", false);
  out.ticket = id;
  out.runs = [];
  out.last = undefined;
  // A ticket is the network after the change; the LSP has been down (or unused) since.
  out.log = [...out.log, { seq, t: out.clock, text: `Ticket opened: ${teTicket(id).title}.`, tone: "warn" }];
  return out;
}

export function teApply(s0: TeState, a: TeAction): TeState {
  switch (a.type) {
    case "cfg": {
      const s = cl(s0);
      s.hist[a.dev] = [spClone(s0.cfg[a.dev]), ...s.hist[a.dev]].slice(0, 20);
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
      const l = linkById(a.link);
      s.cfg[l.a].ifs[l.ai].shut = !a.up;
      s.cfg[l.b].ifs[l.bi].shut = !a.up;
      s.cfgSeq += 1;
      s.clock += 1;
      const txt = `${l.a}–${l.b} ${a.up ? "restored" : "fails (fiber cut)"}`;
      s.log = [...s.log, { seq: s.seq, t: s.clock, text: txt, tone: a.up ? "ok" : "warn" }];
      return converge(s0, s, txt);
    }
    case "test":
      return teTest(s0, a.from, a.mbps);
    case "cspf":
      return cspfRun(s0, a.dev, a.id);
    case "ticket":
      return teTicketState(a.id, s0.seq + 1, s0.os);
    case "os":
      return createTeNet(s0.seq + 1, a.os);
    case "custb": {
      const s = cl(s0);
      s.custB = a.on;
      s.cfgSeq += 1;
      s.log = [...s.log, { seq: s.seq, t: s.clock, text: a.on ? "CUST-B sends 400 Mbps again." : "CUST-B stops sending.", tone: "info" }];
      return s;
    }
    case "reload": {
      // A reload: the router's own LSPs are signaled again from scratch — they are no longer incumbents.
      const base = cl(s0);
      base.view = { lsps: s0.view.lsps.map((l) => (l.head === a.dev ? { ...l, state: "down" as const, path: undefined, why: "reload" } : l)), resv: s0.view.resv.filter((x) => !x.lsp.startsWith(`${a.dev}:`)) };
      const s = cl(base);
      s.clock += 120;
      s.cfgSeq += 1;
      s.log = [...s.log, { seq: s.seq, t: s.clock, text: `${a.dev} reloaded: its LSPs are signaled again from scratch.`, tone: "warn" }];
      return converge(base, s, `${a.dev} reloads`);
    }
    case "wipe-r1": {
      const s = cl(s0);
      s.cfg.R1.tunnels = [];
      s.cfg.R1.paths = {};
      s.wiped = true;
      s.cfgSeq += 1;
      s.clock += 1;
      s.log = [...s.log, { seq: s.seq, t: s.clock, text: "R1's tunnels and explicit paths were removed.", tone: "warn" }];
      return converge(s0, s, "R1 loses its whole TE tunnel configuration");
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Diagnosis, proofs, evidence ladder
// ---------------------------------------------------------------------------------------------------------------
export const TE_CAUSES: { id: string; label: string }[] = [
  { id: "bw", label: "No path has enough unreserved bandwidth (a stale reservation holds it)" },
  { id: "telink", label: "A link is missing from the TED (not a TE interface on one end)" },
  { id: "explicit", label: "The explicit path can't be followed (a strict hop isn't adjacent)" },
  { id: "affinity", label: "The affinity constraint prunes every path (a link's color changed)" },
  { id: "autoroute", label: "The tunnel is up but traffic isn't routed into it (no autoroute / shortcuts)" },
  { id: "rsvp", label: "RSVP isn't running on the routers" },
  { id: "igp", label: "IS-IS lost the route to R6" },
];
const lastTest = (s: TeState) => s.tests[s.tests.length - 1];
export function teCauseFeedback(s: TeState, cause: string): { right: boolean; consequence?: boolean; text: string } {
  const t = s.ticket as TeTicketId | undefined;
  const xr = s.os === "xr";
  if (cause === t) {
    const txt: Record<TeTicketId, string> = {
      bw: "Yes. tunnel-te1 now asks for 700 Mbps. The top path has 200 Mbps reservable (R2–R4) and R3–R5 has only 600 Mbps unreserved — CUST-B's tunnel on R3 still holds 400 Mbps although the customer is gone. CSPF finds no path, the tunnel is down, and the video falls back to IS-IS over R2–R4, which is already carrying 800 Mbps.",
      telink: `Yes. R3's new interface toward R5 isn't a TE interface (${xr ? "missing under mpls traffic-eng" : "missing from protocols mpls"}): R3 no longer floods R3→R5, so R3–R5 fails the TED's two-way check. Every other way around crosses R2–R4 (200 Mbps reservable), so neither the video tunnel nor CUST-B finds a path, and the video falls back to IS-IS over the busy R2–R4.`,
      explicit: "Yes. The explicit path VIA-R3 lists 3.3.3.3 strict, then 4.4.4.4 strict — R3 has no link to R4. CSPF rejects the only path option, and with no dynamic fallback the tunnel stays down.",
      affinity: "Yes. tunnel-te1 includes GOLD. The audit recolored R5's interface toward R6 BLUE, so R5→R6 fails the affinity; the top links are BLUE anyway. Every path is pruned.",
      autoroute: `Yes. tunnel-te1 is up and reserved, but ${xr ? "autoroute announce" : "IS-IS traffic-engineering shortcuts"} is gone: R1's route to 10.6.6.0/24 is the IS-IS route via R2, so the video still crosses the busy R2–R4 link and the reservation sits unused.`,
    };
    return { right: true, text: txt[t] };
  }
  const t1 = lspOf(s.view, "R1", 1);
  switch (cause) {
    case "rsvp":
      return { right: false, text: `RSVP is running: ${lspLabel(s.os, { id: 10, name: "CUST-B" })} on R3 is ${lspOf(s.view, "R3", 10)?.state ?? "up"}, and every core interface has an RSVP bandwidth.` };
    case "igp":
      return { right: false, text: "IS-IS reaches 6.6.6.6 from R1 (show route 6.6.6.6) — the traffic does get there, over the IS-IS path." };
    case "bw": {
      const gone = tedDirs(s.cfg).filter((d) => d.up && !d.inTed);
      if (t1?.state === "up") return { right: false, text: "tunnel-te1 is up with its bandwidth reserved — bandwidth isn't what stops it." };
      if (gone.length) return { right: false, text: `CSPF can only say "no path with enough bandwidth" — but ${gone.map((d) => `${d.from}→${d.to}`).join(", ")} isn't in the TED at all. Look at the topology before the numbers.` };
      return { right: false, text: `CSPF's verdict isn't about bandwidth: ${t1?.why ?? ""}.` };
    }
    case "telink":
      return { right: false, text: "Every link is in the TED in both directions (show mpls traffic-eng topology / show ted database)." };
    case "explicit":
      return { right: false, text: s.cfg.R1.tunnels.some((x) => x.opts.some((o) => o.kind === "explicit")) ? "The explicit path's hops are adjacent." : "tunnel-te1 has no explicit path — it is dynamic." };
    case "affinity":
      return { right: false, text: s.cfg.R1.tunnels[0]?.include.length || s.cfg.R1.tunnels[0]?.exclude.length ? "The affinity still leaves a path." : "tunnel-te1 has no affinity constraint." };
    case "autoroute":
      return { right: false, text: t1?.state === "up" ? "Traffic is routed into tunnel-te1." : "The tunnel isn't even up — routing into it can't be the first problem." };
  }
  return { right: false, text: lastTest(s) ? "That doesn't match the evidence." : "Run the user's test first." };
}
export function teProofs(s: TeState): { label: string; ok: boolean; detail: string }[] {
  const t = s.ticket as TeTicketId | undefined;
  if (!t) return [];
  const fresh = s.tests.filter((x) => x.cfgSeq === s.cfgSeq);
  const t1 = lspOf(s.view, "R1", 1);
  const tun = tunnelOf(s.cfg, "R1", 1);
  const need = t === "bw" ? 700 : 500;
  const flowOk = fresh.some((x) => x.from === "CE1" && x.mbps >= need && x.ok && x.via.includes("RSVP-TE"));
  const up = { label: `tunnel-te1 is up with at least ${need} Mbps reserved`, ok: t1?.state === "up" && (tun?.bw ?? 0) >= need * 1000 && t1.bw >= need * 1000, detail: t1?.state === "up" ? t1.path!.join(" → ") : t1?.why ?? "not configured" };
  const proof = { label: `A fresh ${need} Mbps flow from CE1 is delivered through the tunnel`, ok: flowOk, detail: "run the test again after the fix" };
  switch (t) {
    case "bw":
      return [{ label: "R3–R5 has room for 700 Mbps", ok: t1?.state === "up" && !t1.resizeFailed && t1.bw >= 700000, detail: "the stale CUST-B reservation is released (show rsvp session on R3)" }, up, proof];
    case "telink":
      return [{ label: "R3→R5 is back in the TED", ok: tedDirs(s.cfg).some((d) => d.from === "R3" && d.to === "R5" && d.inTed), detail: "show mpls traffic-eng topology" }, up, proof];
    case "explicit":
      return [{ label: "tunnel-te1's path option can be followed", ok: t1?.state === "up", detail: t1?.state === "up" ? `path-option ${t1.opt}` : t1?.why ?? "" }, up, proof];
    case "affinity":
      return [{ label: "R5→R6 is GOLD again", ok: s.cfg.R5.ifs["ge-0/0/1"].attr.includes("GOLD"), detail: s.cfg.R5.ifs["ge-0/0/1"].attr.join(" ") || "no colors" }, up, proof];
    case "autoroute":
      return [{ label: "R1 routes 10.6.6.0/24 into tunnel-te1", ok: routeTo(s.cfg, s.view, "R1", "R6")?.via === "tunnel", detail: "show route 10.6.6.20 on R1" }, up, proof];
  }
}
export function teLadder(s: TeState): { k: string; title: string; text: string }[] {
  const t = lastTest(s);
  const down = s.view.lsps.filter((l) => l.state !== "up");
  const missing = tedDirs(s.cfg).filter((d) => d.up && !d.inTed);
  const r1 = routeTo(s.cfg, s.view, "R1", "R6");
  return [
    { k: "test", title: "What did the flow test show?", text: t ? `${t.mbps} Mbps ${t.from} → ${t.to} via ${t.via}: ${t.ok ? "delivered" : t.why}.` : "Run the user's test first." },
    { k: "lsp", title: "Is every LSP up?", text: down.length ? down.map((l) => `${lspLabel(s.os, l)} on ${l.head}: ${l.state} — ${l.why}`).join(" · ") : "Yes: every configured LSP is up." },
    { k: "ted", title: "Is every up link in the TED, both ways?", text: missing.length ? missing.map((d) => `${d.from}→${d.to} not flooded`).join(" · ") : "Yes." },
    { k: "resv", title: "Where is the bandwidth reserved?", text: s.view.lsps.filter((l) => l.state === "up").map((l) => `${lspLabel(s.os, l)} ${mb(tunnelOf(s.cfg, l.head, l.id)!.bw)} on ${l.path!.join("→")}`).join(" · ") || "No reservation." },
    { k: "route", title: "Does R1 route the video into the tunnel?", text: r1?.via === "tunnel" ? `Yes: 10.6.6.0/24 via ${lspLabel(s.os, r1.tunnel!)}.` : `No: 10.6.6.0/24 via IS-IS (${r1?.path.join("→") ?? "no route"}).` },
  ];
}
