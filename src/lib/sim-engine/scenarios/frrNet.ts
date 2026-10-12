import { spClone, type SpBase, type SpMoment, type SpRun } from "@/components/sp-lab/spKit";

/**
 * RSVP-TE Fast Reroute Lab network — the guided lesson's six routers.
 *
 *   CE1 ── R1 ── R3 ════ R5 ── R7 ── R6 ── CE6        primary tunnel-te1: R1–R3–R5–R7–R6 (metric 10 per link)
 *                 ╲     │     ╱                       R3–R4 15 · R4–R5 15 · R4–R7 20 (the detour links)
 *                  ╲─── R4 ──╱                        ════ R3–R5 crosses a DWDM system: when it fails, the light stays
 *                                                       on at both routers (a silent failure) — only BFD sees it fast
 *
 * Loopbacks R1 1.1.1.1 · R3 3.3.3.3 · R4 4.4.4.4 · R5 5.5.5.5 · R7 7.7.7.7 · R6 6.6.6.6 (IS-IS L2 with TE). R1 heads
 * tunnel-te1 (Junos LSP "TO-R6"), 500 Mbps, requesting node protection. Every core interface runs automatic bypass
 * creation (IOS XR `auto-tunnel backup`, Junos `link-protection`).
 *
 * Modeled (RFC 4090 facility backup, RFC 5880 BFD):
 * - Primary LSPs: CSPF on the TED (TE interface on both ends, link up, enough reservable bandwidth, explicit hops);
 *   an LSP keeps its path while it is valid; `reoptimize` moves it to the best path.
 * - Protection request per LSP: none / link / node (XR `fast-reroute` [protect node], Junos link-protection /
 *   node-link-protection).
 * - Bypasses at each Point of Local Repair (the router before the protected resource), per protected interface:
 *   automatic — an NHOP bypass to the next hop avoiding the link, and (unless nhop-only / no-node-protection) an NNHOP
 *   bypass to the next-next hop avoiding the next router, for each next-next hop of a protected LSP; manual — a tunnel
 *   bound to the interface (XR backup-path, Junos `link-protection bypass`). A bypass is up when CSPF finds its path.
 * - Binding: node-protection requested → NNHOP bypass if one is up, else NHOP; link protection → NHOP. The tail's
 *   upstream (penultimate hop) can only have NHOP protection.
 * - Failure drills: a link (loss of light — detected in 10 ms — or, on R3–R5, silent: BFD 3 × 15 ms or IS-IS hold time
 *   30 s) or a router (its neighbors lose light, except across R3–R5). The PLR switches to a bypass that avoids the
 *   failure in ~10 ms after detection; without one the headend learns it (PathErr / IS-IS) and re-signals (~1.5 s more).
 *   The headend then re-optimizes onto a new path (make-before-break) and the bypass is released.
 */

export type FrR = "R1" | "R3" | "R4" | "R5" | "R7" | "R6";
export type FrCe = "CE1" | "CE6";
export const FR_ROUTERS: FrR[] = ["R1", "R3", "R4", "R5", "R7", "R6"];
export const FR_LO: Record<FrR, string> = { R1: "1.1.1.1", R3: "3.3.3.3", R4: "4.4.4.4", R5: "5.5.5.5", R7: "7.7.7.7", R6: "6.6.6.6" };
export const CE_NET: Record<FrCe, { net: string; host: string; r: FrR; ifn: string }> = {
  CE1: { net: "10.1.1.0/24", host: "10.1.1.10", r: "R1", ifn: "ge-0/0/2" },
  CE6: { net: "10.6.6.0/24", host: "10.6.6.20", r: "R6", ifn: "ge-0/0/2" },
};
export const IMPLICIT_NULL = 3;
export type IfName = "ge-0/0/0" | "ge-0/0/1" | "ge-0/0/2";
export const DETECT = { light: 10, bfd: 45, isis: 30000, switch: 10, headend: 1500 };

export interface FrLink {
  id: string;
  a: FrR;
  ai: IfName;
  aip: string;
  b: FrR;
  bi: IfName;
  bip: string;
  metric: number;
  /** Crosses a transport system: a failure keeps the light on (silent). */
  silent?: boolean;
}
export const FR_LINKS: FrLink[] = [
  { id: "R1-R3", a: "R1", ai: "ge-0/0/0", aip: "192.0.2.0", b: "R3", bi: "ge-0/0/0", bip: "192.0.2.1", metric: 10 },
  { id: "R3-R5", a: "R3", ai: "ge-0/0/1", aip: "192.0.2.2", b: "R5", bi: "ge-0/0/0", bip: "192.0.2.3", metric: 10, silent: true },
  { id: "R5-R7", a: "R5", ai: "ge-0/0/1", aip: "192.0.2.4", b: "R7", bi: "ge-0/0/0", bip: "192.0.2.5", metric: 10 },
  { id: "R7-R6", a: "R7", ai: "ge-0/0/1", aip: "192.0.2.6", b: "R6", bi: "ge-0/0/0", bip: "192.0.2.7", metric: 10 },
  { id: "R3-R4", a: "R3", ai: "ge-0/0/2", aip: "192.0.2.8", b: "R4", bi: "ge-0/0/0", bip: "192.0.2.9", metric: 15 },
  { id: "R4-R5", a: "R4", ai: "ge-0/0/1", aip: "192.0.2.10", b: "R5", bi: "ge-0/0/2", bip: "192.0.2.11", metric: 15 },
  { id: "R4-R7", a: "R4", ai: "ge-0/0/2", aip: "192.0.2.12", b: "R7", bi: "ge-0/0/2", bip: "192.0.2.13", metric: 20 },
];
export const linkById = (id: string) => FR_LINKS.find((l) => l.id === id)!;
export const linkOf = (x: FrR, y: FrR) => FR_LINKS.find((l) => (l.a === x && l.b === y) || (l.a === y && l.b === x));
export const ipOn = (r: FrR, peer: FrR) => {
  const l = linkOf(r, peer)!;
  return l.a === r ? l.aip : l.bip;
};
export interface FrIfInfo {
  r: FrR;
  ifn: IfName;
  ip: string;
  peer: FrR;
  link: FrLink;
}
export function ifsOf(r: FrR): FrIfInfo[] {
  return FR_LINKS.filter((l) => l.a === r || l.b === r)
    .map((l) => (l.a === r ? { r, ifn: l.ai, ip: l.aip, peer: l.b, link: l } : { r, ifn: l.bi, ip: l.bip, peer: l.a, link: l }))
    .sort((x, y) => x.ifn.localeCompare(y.ifn));
}
export const ifToward = (r: FrR, peer: FrR) => ifsOf(r).find((x) => x.peer === peer)?.ifn;
export const routerByIp = (ip: string): FrR | undefined => FR_ROUTERS.find((r) => FR_LO[r] === ip) ?? FR_LINKS.flatMap((l) => [[l.aip, l.a] as const, [l.bip, l.b] as const]).find(([x]) => x === ip)?.[1];

// ---------------------------------------------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------------------------------------------
export interface FrIfCfg {
  te: boolean;
  /** RSVP bandwidth (kbps); undefined = no RSVP. */
  rsvp?: number;
  /** BFD for RSVP / IS-IS on the interface. */
  bfd: boolean;
  /** Automatic bypasses for LSPs leaving through this interface. */
  auto: boolean;
  /** Automatic bypasses: link protection only (NHOP). */
  nhopOnly: boolean;
  shut: boolean;
}
export interface FrHop {
  idx: number;
  ip: string;
  kind: "strict" | "loose" | "exclude";
}
export type FrProt = "off" | "link" | "node";
export interface FrTunnel {
  id: number;
  name: string;
  dst: string;
  bw: number;
  /** path option: dynamic, or explicit by name */
  path?: string;
  frr: FrProt;
  autoroute: boolean;
  shut: boolean;
  /** A manual bypass bound to this protected interface (XR backup-path / Junos link-protection bypass). */
  bypassFor?: IfName;
}
export interface FrCfg {
  ifs: Record<IfName, FrIfCfg>;
  paths: Record<string, FrHop[]>;
  tunnels: FrTunnel[];
}
export type FrConfig = Record<FrR, FrCfg>;

export const frTunnel1 = (): FrTunnel => ({ id: 1, name: "TO-R6", dst: FR_LO.R6, bw: 500000, frr: "node", autoroute: true, shut: false });
export function frHealthy(): FrConfig {
  const c = {} as FrConfig;
  for (const r of FR_ROUTERS) {
    const ifs = {} as Record<IfName, FrIfCfg>;
    for (const x of ifsOf(r)) ifs[x.ifn] = { te: true, rsvp: 1000000, bfd: !!x.link.silent, auto: true, nhopOnly: false, shut: false };
    c[r] = { ifs, paths: {}, tunnels: [] };
  }
  c.R1.tunnels = [frTunnel1()];
  return c;
}

// ---------------------------------------------------------------------------------------------------------------
// TED, CSPF, IGP
// ---------------------------------------------------------------------------------------------------------------
export interface FrFail {
  links: string[];
  nodes: FrR[];
}
const nodeUp = (f: FrFail, r: FrR) => !f.nodes.includes(r);
export const linkAlive = (c: FrConfig, f: FrFail, l: FrLink) => !c[l.a].ifs[l.ai].shut && !c[l.b].ifs[l.bi].shut && !f.links.includes(l.id) && nodeUp(f, l.a) && nodeUp(f, l.b);
/** Usable for TE: alive, TE interface and RSVP on both ends. */
export const teUsable = (c: FrConfig, f: FrFail, l: FrLink) => linkAlive(c, f, l) && c[l.a].ifs[l.ai].te && c[l.b].ifs[l.bi].te && c[l.a].ifs[l.ai].rsvp !== undefined && c[l.b].ifs[l.bi].rsvp !== undefined;
function dijkstra(from: FrR, to: FrR, ok: (l: FrLink) => boolean, avoid: Set<FrR> = new Set()): FrR[] | undefined {
  const dist: Partial<Record<FrR, { cost: number; path: FrR[] }>> = { [from]: { cost: 0, path: [from] } };
  const done = new Set<FrR>();
  for (;;) {
    const cur = FR_ROUTERS.filter((r) => dist[r] && !done.has(r)).sort((x, y) => dist[x]!.cost - dist[y]!.cost || FR_ROUTERS.indexOf(x) - FR_ROUTERS.indexOf(y))[0];
    if (!cur) break;
    done.add(cur);
    for (const l of FR_LINKS) {
      if ((l.a !== cur && l.b !== cur) || !ok(l)) continue;
      const nb = l.a === cur ? l.b : l.a;
      if (avoid.has(nb) && nb !== to) continue;
      const cost = dist[cur]!.cost + l.metric;
      if (!dist[nb] || cost < dist[nb]!.cost) dist[nb] = { cost, path: [...dist[cur]!.path, nb] };
    }
  }
  return dist[to]?.path;
}
export const igpPath = (c: FrConfig, f: FrFail, from: FrR, to: FrR) => dijkstra(from, to, (l) => linkAlive(c, f, l));
export const pathCost = (p: FrR[]) => p.slice(1).reduce((a, x, i) => a + linkOf(p[i], x)!.metric, 0);
/** CSPF from `from` to `to` over TE-usable links, following an explicit path if given, avoiding links / nodes. */
export function cspf(c: FrConfig, f: FrFail, from: FrR, to: FrR, hops: FrHop[] | undefined, avoidLink?: string, avoidNode?: FrR): { path?: FrR[]; why?: string } {
  const ok = (l: FrLink) => teUsable(c, f, l) && l.id !== avoidLink && l.a !== avoidNode && l.b !== avoidNode;
  const exclude = new Set<FrR>((hops ?? []).filter((h) => h.kind === "exclude").map((h) => routerByIp(h.ip)).filter((x): x is FrR => !!x));
  const okX = (l: FrLink) => ok(l) && !exclude.has(l.a === from ? l.b : l.a) && !(exclude.has(l.a) || exclude.has(l.b));
  const list = (hops ?? []).filter((h) => h.kind !== "exclude").sort((a, b) => a.idx - b.idx);
  let path: FrR[] = [from];
  for (const h of [...list, ...(list.length && routerByIp(list[list.length - 1].ip) === to ? [] : [{ idx: 9999, ip: FR_LO[to], kind: "loose" as const }])]) {
    const target = routerByIp(h.ip);
    const cur = path[path.length - 1];
    if (!target) return { why: `${h.ip} is not in the TED` };
    if (target === cur) continue;
    if (h.kind === "strict") {
      const l = linkOf(cur, target);
      if (!l) return { why: `strict hop ${h.ip} is not adjacent to ${cur}` };
      if (!okX(l)) return { why: `the link ${cur}–${target} can't be used` };
      path = [...path, target];
    } else {
      const seg = dijkstra(cur, target, okX, new Set(path));
      if (!seg) return { why: `no path to ${h.ip}${avoidNode ? ` avoiding ${avoidNode}` : avoidLink ? ` avoiding ${avoidLink}` : ""}` };
      path = [...path, ...seg.slice(1)];
    }
  }
  return { path };
}

// ---------------------------------------------------------------------------------------------------------------
// Primary LSPs and bypasses
// ---------------------------------------------------------------------------------------------------------------
export type FrOs = "xr" | "junos";
export const LABEL_BASE: Record<FrOs, number> = { xr: 24000, junos: 299776 };
export interface FrBypass {
  key: string;
  plr: FrR;
  ifn: IfName;
  /** NHOP (protects the link) or NNHOP (protects the next router). */
  type: "nhop" | "nnhop";
  tail: FrR;
  /** The router (NNHOP) or link (NHOP) it avoids. */
  avoids: string;
  manual?: number;
  name: string;
  up: boolean;
  path?: FrR[];
  why?: string;
  labels: Partial<Record<FrR, number>>;
}
export interface FrLsp {
  key: string;
  head: FrR;
  id: number;
  name: string;
  tail?: FrR;
  state: "up" | "down" | "admin-down";
  path?: FrR[];
  why?: string;
  labels: Partial<Record<FrR, number>>;
  /** Protection bound at each hop (PLR router → bypass key), when FRR is requested. */
  prot: Partial<Record<FrR, string>>;
}
export interface FrView {
  lsps: FrLsp[];
  bypasses: FrBypass[];
}
const frSlot = (c: FrConfig, head: FrR, id: number) => FR_ROUTERS.flatMap((r) => c[r].tunnels.filter((t) => !t.bypassFor).map((t) => `${r}:${t.id}`)).indexOf(`${head}:${id}`) + 1;
const lspLabels = (os: FrOs, path: FrR[], slot: number): Partial<Record<FrR, number>> => Object.fromEntries(path.slice(1).map((x, i) => [x, i === path.length - 2 ? IMPLICIT_NULL : LABEL_BASE[os] + 100 * FR_ROUTERS.indexOf(x) + slot]));
export const frLspKey = (r: FrR, id: number) => `${r}:${id}`;
export function frPlace(c: FrConfig, f: FrFail, os: FrOs, prev?: FrView, reopt = false): FrView {
  const lsps: FrLsp[] = [];
  for (const r of FR_ROUTERS) {
    for (const t of c[r].tunnels) {
      if (t.bypassFor) continue;
      const key = frLspKey(r, t.id);
      const tail = routerByIp(t.dst);
      const base: FrLsp = { key, head: r, id: t.id, name: t.name, tail: tail && FR_LO[tail] === t.dst ? tail : undefined, state: "down", labels: {}, prot: {} };
      if (t.shut) {
        lsps.push({ ...base, state: "admin-down", why: "administratively down" });
        continue;
      }
      if (!nodeUp(f, r)) {
        lsps.push({ ...base, why: `${r} is down` });
        continue;
      }
      if (!base.tail) {
        lsps.push({ ...base, why: t.dst ? `${t.dst} is not a TE router ID` : "no destination configured" });
        continue;
      }
      const hops = t.path ? c[r].paths[t.path] : undefined;
      if (t.path && !hops) {
        lsps.push({ ...base, why: `explicit path ${t.path} is not defined` });
        continue;
      }
      const old = prev?.lsps.find((l) => l.key === key);
      const keep = !reopt && old?.state === "up" && old.path && old.path.every((x, i) => i === 0 || teUsable(c, f, linkOf(old.path![i - 1], x)!)) && old.path[old.path.length - 1] === base.tail;
      const res = keep ? { path: old!.path } : cspf(c, f, r, base.tail, hops);
      if (!res.path) {
        lsps.push({ ...base, why: res.why ?? "no path" });
        continue;
      }
      lsps.push({ ...base, state: "up", path: res.path, labels: lspLabels(os, res.path, frSlot(c, r, t.id)) });
    }
  }
  // Bypasses: automatic per protected interface, manual bypass tunnels.
  const bypasses: FrBypass[] = [];
  const add = (b: Omit<FrBypass, "key" | "labels" | "up" | "path" | "why">, hops?: FrHop[]) => {
    const key = `${b.plr}:${b.ifn}:${b.type}:${b.tail}${b.manual ? `:m${b.manual}` : ""}`;
    if (bypasses.some((x) => x.key === key)) return;
    const avoidLink = b.type === "nhop" ? linkOf(b.plr, b.tail)!.id : undefined;
    const avoidNode = b.type === "nnhop" ? (b.avoids as FrR) : undefined;
    const res = nodeUp(f, b.plr) ? cspf(c, f, b.plr, b.tail, hops, avoidLink, avoidNode) : { why: `${b.plr} is down` };
    // An automatic bypass is only built where the topology has a way around at all (a single-homed router has none).
    if (!b.manual && !res.path && !dijkstra(b.plr, b.tail, (l) => linkAlive(c, f, l) && l.id !== avoidLink && l.a !== avoidNode && l.b !== avoidNode)) return;
    const slot = 50 + bypasses.length;
    bypasses.push({ ...b, key, up: !!res.path, path: res.path, why: res.why, labels: res.path ? lspLabels(os, res.path, slot) : {} });
  };
  for (const r of FR_ROUTERS) {
    for (const x of ifsOf(r)) {
      const ic = c[r].ifs[x.ifn];
      // Which LSPs leave r through this interface, wanting protection?
      const through = lsps.filter((l) => l.state === "up" && l.path!.indexOf(r) >= 0 && l.path![l.path!.indexOf(r) + 1] === x.peer && c[l.head].tunnels.find((t) => t.id === l.id)!.frr !== "off");
      if (ic.auto && through.length) {
        add({ plr: r, ifn: x.ifn, type: "nhop", tail: x.peer, avoids: x.link.id, name: `auto NHOP to ${x.peer}` });
        if (!ic.nhopOnly)
          for (const l of through) {
            const nn = l.path![l.path!.indexOf(r) + 2];
            if (nn) add({ plr: r, ifn: x.ifn, type: "nnhop", tail: nn, avoids: x.peer, name: `auto NNHOP to ${nn}` });
          }
      }
      for (const t of c[r].tunnels.filter((y) => y.bypassFor === x.ifn && !y.shut)) {
        const tail = routerByIp(t.dst);
        if (!tail) continue;
        const type = tail === x.peer ? "nhop" : "nnhop";
        add({ plr: r, ifn: x.ifn, type, tail, avoids: type === "nhop" ? x.link.id : x.peer, manual: t.id, name: os === "xr" ? `tunnel-te${t.id}` : t.name }, t.path ? c[r].paths[t.path] : undefined);
      }
    }
  }
  // Binding.
  for (const l of lsps) {
    if (l.state !== "up") continue;
    const want = c[l.head].tunnels.find((t) => t.id === l.id)!.frr;
    if (want === "off") continue;
    l.path!.slice(0, -1).forEach((r, i) => {
      const n = l.path![i + 1];
      const nn = l.path![i + 2];
      const ifn = ifToward(r, n)!;
      const cands = bypasses.filter((b) => b.plr === r && b.ifn === ifn && b.up);
      const nnhop = want === "node" && nn ? cands.find((b) => b.type === "nnhop" && b.tail === nn) : undefined;
      const nhop = cands.find((b) => b.type === "nhop" && b.tail === n);
      const pick = nnhop ?? nhop;
      if (pick) l.prot[r] = pick.key;
    });
  }
  return { lsps, bypasses };
}
export const frLspOf = (v: FrView, head: FrR, id: number) => v.lsps.find((l) => l.key === frLspKey(head, id));

// ---------------------------------------------------------------------------------------------------------------
// Forwarding
// ---------------------------------------------------------------------------------------------------------------
export function frRoute(c: FrConfig, f: FrFail, v: FrView, from: FrR, to: FrR): { via: "tunnel" | "igp"; lsp?: FrLsp; path: FrR[] } | undefined {
  if (from === to) return { via: "igp", path: [from] };
  const t = c[from].tunnels.find((x) => !x.bypassFor && x.autoroute && !x.shut && x.dst === FR_LO[to] && frLspOf(v, from, x.id)?.state === "up");
  if (t) {
    const l = frLspOf(v, from, t.id)!;
    return { via: "tunnel", lsp: l, path: l.path! };
  }
  const p = igpPath(c, f, from, to);
  return p ? { via: "igp", path: p } : undefined;
}

// ---------------------------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------------------------
export interface FrSnap {
  view: FrView;
  fail: FrFail;
}
export interface FrDrillResult {
  lsp: string;
  name: string;
  /** The router that detects and should repair. */
  plr?: FrR;
  detect: "light" | "bfd" | "isis" | "-";
  detectMs: number;
  how: "local" | "headend" | "none" | "unaffected";
  bypass?: string;
  lossMs: number;
  why: string;
  newPath?: FrR[];
}
export interface FrDrill {
  id: number;
  what: string;
  results: FrDrillResult[];
  cfgSeq: number;
  /** Configuration commits so far (a drill proves a fix only if it ran after the last commit). */
  commits: number;
}
export interface FrTest {
  id: number;
  from: FrCe;
  ok: boolean;
  path: string[];
  via: string;
  why?: string;
  cfgSeq: number;
}
export interface FrSys {
  t: number;
  dev: FrR;
  kind: "up" | "down" | "commit" | "frr" | "bfd";
  what?: string;
  why?: string;
}
export interface FrState extends SpBase<FrSnap> {
  os: FrOs;
  cfg: FrConfig;
  hist: Record<FrR, FrCfg[]>;
  fail: FrFail;
  view: FrView;
  sys: FrSys[];
  tests: FrTest[];
  drills: FrDrill[];
  since: Record<string, number>;
  wiped?: boolean;
}
export type FrAction =
  | { type: "cfg"; dev: FrR; cfg: FrCfg; text: string }
  | { type: "set"; changes: { dev: FrR; f: (c: FrCfg) => void }[]; text: string }
  | { type: "drill"; what: string }
  | { type: "restore" }
  | { type: "reopt"; dev?: FrR }
  | { type: "test"; from: FrCe }
  | { type: "ticket"; id: FrTicketId }
  | { type: "os"; os: FrOs }
  | { type: "wipe-r3" };

const cl = (o: FrState): FrState => ({ ...spClone(o), runs: o.runs, last: o.last });
const NOFAIL: FrFail = { links: [], nodes: [] };
export function createFrNet(seq = 0, os: FrOs = "xr"): FrState {
  const cfg = frHealthy();
  const view = frPlace(cfg, NOFAIL, os);
  const s: FrState = { seq, os, cfgSeq: 0, clock: 3600, runs: [], log: [{ seq, t: 3600, text: "tunnel-te1 (R1 → R6, 500 Mbps) is up on R1–R3–R5–R7–R6 with node protection requested; every PLR has its bypasses ready.", tone: "info" }], cfg, hist: Object.fromEntries(FR_ROUTERS.map((r) => [r, []])) as unknown as Record<FrR, FrCfg[]>, fail: { links: [], nodes: [] }, view, sys: [], tests: [], drills: [], since: {} };
  for (const l of view.lsps) if (l.state === "up") {
    s.since[l.key] = 40;
    s.sys.push({ t: 40, dev: l.head, kind: "up", what: l.name });
  }
  return s;
}
export const lspName = (os: FrOs, l: { id: number; name: string }) => (os === "xr" ? `tunnel-te${l.id}` : l.name);
/** The next hop of a bypass's protected interface (the NHOP router). */
export const nhopOf = (b: FrBypass) => (b.type === "nhop" ? b.tail : (b.avoids as FrR));
/** Auto-tunnel numbering on IOS XR: tunnel-te1000 upward per PLR (auto-tunnel backup tunnel-id min 1000). */
export const autoId = (v: FrView, b: FrBypass) => 1000 + v.bypasses.filter((x) => x.plr === b.plr && !x.manual).indexOf(b);
export const byName = (os: FrOs, b: FrBypass, v?: FrView) =>
  b.manual ? b.name : os === "xr" ? (v ? `tunnel-te${autoId(v, b)}` : `${b.type === "nhop" ? "NHOP" : "NNHOP"} auto-tunnel to ${FR_LO[b.tail]}`) : b.type === "nhop" ? `Bypass->${ipOn(b.tail, b.plr)}` : `Bypass->${ipOn(nhopOf(b), b.plr)}->${ipOn(b.tail, nhopOf(b))}`;

// ---------------------------------------------------------------------------------------------------------------
// The customer flow and the failure drill
// ---------------------------------------------------------------------------------------------------------------
export function frFlow(s: FrState, from: FrCe) {
  const to: FrCe = from === "CE1" ? "CE6" : "CE1";
  const a = CE_NET[from].r;
  const b = CE_NET[to].r;
  if (!nodeUp(s.fail, a) || !nodeUp(s.fail, b)) return { ok: false, path: [from], via: "—", why: "the PE is down" };
  const r = frRoute(s.cfg, s.fail, s.view, a, b);
  if (!r) return { ok: false, path: [from, a], via: "—", why: `${a} has no route to ${CE_NET[to].net}` };
  return { ok: true, path: [from, ...r.path, to], via: r.via === "tunnel" ? `${lspName(s.os, r.lsp!)} (RSVP-TE)` : "IS-IS", why: undefined as string | undefined };
}
/** What a failure does: who detects it, how fast, and whether a bypass that avoids it saves the LSP. */
export const commitCount = (s: FrState) => FR_ROUTERS.reduce((a, r) => a + s.hist[r].length, 0);
export function frDrill(s0: FrState, what: string): FrState {
  const s = cl(s0);
  const [kind, id] = what.split(":");
  // Every drill starts from a repaired network with each LSP on its best path.
  s.fail = { links: [], nodes: [] };
  s.view = frPlace(s.cfg, s.fail, s.os, undefined, true);
  const before = s.view;
  const nf: FrFail = { links: [...s.fail.links, ...(kind === "link" ? [id] : [])], nodes: [...s.fail.nodes, ...(kind === "node" ? [id as FrR] : [])] };
  const results: FrDrillResult[] = [];
  const snapBefore = { view: spClone(before), fail: spClone(s.fail) };
  const moments: SpMoment<FrSnap>[] = [];
  const label = kind === "link" ? `${id.replace("-", "–")} fails` : `${id} fails`;
  moments.push({ tokens: [], lines: [{ text: `${label}${kind === "link" && linkById(id).silent ? " — inside the DWDM system: both routers keep their light" : kind === "node" ? " — power lost" : " — loss of light at both ends"}.`, tone: "bad" }], bad: kind === "link" ? [id] : FR_LINKS.filter((l) => l.a === id || l.b === id).map((l) => l.id), snap: snapBefore });
  for (const l of before.lsps) {
    if (l.state !== "up" || !l.path) continue;
    const t = s.cfg[l.head].tunnels.find((x) => x.id === l.id)!;
    // The first hop of the LSP that is hit.
    let hitAt = -1;
    l.path.slice(0, -1).forEach((r, i) => {
      if (hitAt >= 0) return;
      const n = l.path![i + 1];
      if ((kind === "link" && linkOf(r, n)!.id === id) || (kind === "node" && n === id)) hitAt = i;
    });
    if (kind === "node" && l.path[0] === id) hitAt = 0;
    if (hitAt < 0) {
      results.push({ lsp: l.key, name: lspName(s.os, l), detect: "-", detectMs: 0, how: "unaffected", lossMs: 0, why: "the failure is not on its path" });
      continue;
    }
    const plr = l.path[hitAt];
    const n = l.path[hitAt + 1];
    const lk = linkOf(plr, n)!;
    const silent = !!lk.silent;
    const ifn = ifToward(plr, n)!;
    const bfd = s.cfg[plr].ifs[ifn].bfd && s.cfg[n].ifs[ifToward(n, plr)!].bfd;
    const detect: FrDrillResult["detect"] = !silent ? "light" : bfd ? "bfd" : "isis";
    const detectMs = DETECT[detect];
    const bk = l.prot[plr];
    const b = bk ? before.bypasses.find((x) => x.key === bk) : undefined;
    const survives = !!b?.path && b.path.every((x, i) => i === 0 || linkAlive(s.cfg, nf, linkOf(b.path![i - 1], x)!)) && !b.path.slice(1).includes(id as FrR) && (kind !== "node" || b.type === "nnhop");
    let how: FrDrillResult["how"];
    let why: string;
    if (t.frr === "off") {
      how = "headend";
      why = `${lspName(s.os, l)} doesn't request fast reroute — no PLR protects it`;
    } else if (!b) {
      how = "headend";
      why = `${plr} has no bypass for ${lspName(s.os, l)} on its interface toward ${n}`;
    } else if (!survives) {
      how = "headend";
      why = kind === "node" && b.type === "nhop" ? `${plr}'s bypass is NHOP: it ends at ${n}, the router that failed` : `${plr}'s bypass crosses the failure`;
    } else {
      how = "local";
      why = `${plr} switches to ${byName(s.os, b, before)} (${b.path!.join("→")})`;
    }
    const lossMs = how === "local" ? detectMs + DETECT.switch : detectMs + DETECT.headend;
    results.push({ lsp: l.key, name: lspName(s.os, l), plr, detect, detectMs, how, bypass: how === "local" ? b!.key : undefined, lossMs, why });
  }
  // The network after the failure: LSPs re-signaled by their headends.
  s.fail = nf;
  s.clock += 5;
  s.cfgSeq += 1;
  const after = frPlace(s.cfg, s.fail, s.os, before);
  s.view = after;
  for (const r of results) {
    if (r.how === "unaffected") continue;
    const nl = after.lsps.find((x) => x.key === r.lsp);
    r.newPath = nl?.state === "up" ? nl.path : undefined;
    if (!r.newPath && r.how !== "local") {
      r.how = "none";
      r.why += "; the headend finds no other path";
      r.lossMs = Infinity;
    }
  }
  const snapAfter = { view: spClone(after), fail: spClone(s.fail) };
  for (const r of results.filter((x) => x.how !== "unaffected")) {
    const l = before.lsps.find((x) => x.key === r.lsp)!;
    const detTxt = r.detect === "light" ? "loss of light: 10 ms" : r.detect === "bfd" ? "BFD (3 × 15 ms): 45 ms" : "no light lost, no BFD — IS-IS hold time: 30 s";
    moments.push({ tokens: [], lines: [{ text: `${r.plr} detects it — ${detTxt}.`, tone: r.detect === "isis" ? "bad" : "info" }], views: { [r.plr!]: { ring: "hit", bubble: { text: r.detect === "isis" ? "detects after 30 s" : "failure detected", tone: r.detect === "isis" ? "bad" : "warn" } } }, snap: snapBefore });
    if (r.how === "local") {
      const b = before.bypasses.find((x) => x.key === r.bypass)!;
      const mpLabel = l.labels[b.tail];
      moments.push({
        tokens: b.path!.slice(1).map((x, i) => ({ from: b.path![i], to: x, label: i === 0 ? `${b.labels[x] === IMPLICIT_NULL ? "" : `${b.labels[x]} + `}${mpLabel === IMPLICIT_NULL ? "IP" : mpLabel}` : `${mpLabel === IMPLICIT_NULL ? "IP" : mpLabel}`, color: "amber", delay: i * 500 })),
        lines: [{ text: `Local repair at ${r.plr}: it swaps to ${b.tail}'s label ${mpLabel === IMPLICIT_NULL ? "(implicit-null — plain IP)" : mpLabel} — what the merge point ${b.tail} expects — and pushes the bypass label on top. ${b.tail} receives exactly its normal label. Traffic lost: ~${r.lossMs} ms.`, tone: "ok" }],
        hot: b.path!.slice(1).map((x, i) => linkOf(b.path![i], x)!.id),
        views: { [b.tail]: { ring: "on", bubble: { text: "merge point", tone: "yes" } } },
        snap: snapBefore,
      });
      s.sys.push({ t: s.clock, dev: r.plr!, kind: "frr", what: r.name, why: byName(s.os, b, before) });
    } else {
      moments.push({ tokens: [], lines: [{ text: `No local repair: ${r.why}. ${r.how === "none" ? "Traffic stays down until the failure is repaired." : `${l.head} hears about it (PathErr, IS-IS) and re-signals a new path: traffic lost for ~${(r.lossMs / 1000).toFixed(r.lossMs >= 10000 ? 0 : 1)} s.`}`, tone: "bad" }], views: { [r.plr!]: { ring: "bad", bubble: { text: "no usable bypass", tone: "bad" } } }, snap: snapBefore });
    }
    if (r.newPath) moments.push({ tokens: r.newPath.slice(1).map((x, i) => ({ from: r.newPath![i], to: x, label: "PATH", color: "cyan", delay: i * 400 })), lines: [{ text: `${l.head} re-signals ${r.name} on ${r.newPath.join("→")} (make-before-break); ${r.how === "local" ? "the bypass is released." : "traffic flows again."}`, tone: "learn" }], snap: snapAfter });
    s.sys.push({ t: s.clock, dev: l.head, kind: r.newPath ? "up" : "down", what: r.name, why: r.why });
  }
  const d: FrDrill = { id: s.drills.length + 1, what, results, cfgSeq: s.cfgSeq, commits: commitCount(s) };
  s.drills = [...s.drills, d].slice(-20);
  const main = results.find((x) => x.lsp === "R1:1") ?? results[0];
  const run: SpRun<FrSnap> = { id: s.runs.length + 1 + s.seq * 1000, cmd: `Drill: ${label}`, kind: "drill", moments, ok: !main || main.how === "unaffected" || (main.how === "local" && main.lossMs < 1000) };
  s.runs = [...s.runs, run];
  s.last = run;
  s.log = [...s.log, { seq: s.seq, t: s.clock, text: `Drill — ${label}: ${results.filter((x) => x.how !== "unaffected").map((x) => `${x.name} ${x.how === "local" ? `locally repaired (~${x.lossMs >= 1000 ? `${(x.lossMs / 1000).toFixed(0)} s — detection was late` : `${x.lossMs} ms`})` : x.how === "none" ? "down" : `re-signaled by the headend (~${(x.lossMs / 1000).toFixed(1)} s lost)`}`).join(", ") || "nothing affected"}.`, tone: run.ok ? "ok" : "warn" }];
  return s;
}
function flowRun(s: FrState, t: FrTest): SpRun<FrSnap> {
  const snap = { view: spClone(s.view), fail: spClone(s.fail) };
  const r = t.path.slice(1, -1) as FrR[];
  const l = t.via.includes("RSVP") ? s.view.lsps.find((x) => x.path?.join() === r.join()) : undefined;
  const moments: SpMoment<FrSnap>[] = [];
  r.forEach((x, i) => {
    if (i === 0) return;
    const lab = l?.labels[x];
    moments.push({ tokens: [{ from: r[i - 1], to: x, label: l ? (lab === IMPLICIT_NULL ? "IP" : `label ${lab}`) : "IP", color: l ? "violet" : "green" }], lines: [{ text: l ? (i === 1 ? `${r[0]} pushes ${lab}.` : lab === IMPLICIT_NULL ? `${r[i - 1]} pops (PHP).` : `${r[i - 1]} swaps to ${lab}.`) : `${r[i - 1]}: IS-IS route → ${x}.`, tone: "info" }], snap });
  });
  moments.push({ tokens: [], lines: [{ text: t.ok ? `${t.from}'s traffic arrives via ${t.via}.` : t.why ?? "dropped", tone: t.ok ? "ok" : "bad" }], snap });
  return { id: s.runs.length + 1 + s.seq * 1000, cmd: `traffic from ${t.from}`, kind: "test", moments, ok: t.ok };
}

// ---------------------------------------------------------------------------------------------------------------
// Changes
// ---------------------------------------------------------------------------------------------------------------
function converge(prev: FrState, s: FrState, why: string, reopt = false, show = true): FrState {
  const view = frPlace(s.cfg, s.fail, s.os, prev.view, reopt);
  s.view = view;
  const snap = { view: spClone(view), fail: spClone(s.fail) };
  const moments: SpMoment<FrSnap>[] = [];
  for (const l of view.lsps) {
    const o = prev.view.lsps.find((x) => x.key === l.key);
    const name = lspName(s.os, l);
    if (l.state === "up" && (o?.state !== "up" || o.path?.join() !== l.path!.join())) {
      moments.push({ tokens: l.path!.slice(1).map((x, i) => ({ from: l.path![i], to: x, label: "PATH", color: "cyan", delay: i * 400 })), lines: [{ text: `${name} ${o?.state === "up" ? "moves to" : "comes up on"} ${l.path!.join("→")}.`, tone: "ok" }], hot: l.path!.slice(1).map((x, i) => linkOf(l.path![i], x)!.id), snap });
      if (o?.state !== "up") {
        s.since[l.key] = s.clock;
        s.sys.push({ t: s.clock, dev: l.head, kind: "up", what: l.name });
      }
    } else if (l.state !== "up" && o?.state === "up") {
      moments.push({ tokens: [], lines: [{ text: `${name} goes down: ${l.why}.`, tone: "bad" }], snap });
      s.sys.push({ t: s.clock, dev: l.head, kind: "down", what: l.name, why: l.why });
    }
    const protNow = Object.keys(l.prot).length;
    const protWas = o ? Object.keys(o.prot).length : 0;
    if (l.state === "up" && JSON.stringify(o?.prot ?? {}) !== JSON.stringify(l.prot)) moments.push({ tokens: [], lines: [{ text: `${name}: protected at ${protNow ? Object.keys(l.prot).map((r) => `${r} (${view.bypasses.find((b) => b.key === l.prot[r as FrR])!.type.toUpperCase()})`).join(", ") : "no hop"}${protWas > protNow ? " — protection lost" : ""}.`, tone: protNow ? "learn" : "warn" }], snap });
  }
  for (const b of view.bypasses) {
    const o = prev.view.bypasses.find((x) => x.key === b.key);
    if (!o || o.up !== b.up) moments.push({ tokens: b.up ? b.path!.slice(1).map((x, i) => ({ from: b.path![i], to: x, label: "PATH (bypass)", color: "amber", delay: i * 300 })) : [], lines: [{ text: `${b.plr}: ${b.type.toUpperCase()} bypass to ${b.tail} ${b.up ? `up on ${b.path!.join("→")}` : `down — ${b.why}`}.`, tone: b.up ? "info" : "warn" }], snap });
  }
  for (const o of prev.view.bypasses) if (!view.bypasses.some((b) => b.key === o.key)) moments.push({ tokens: [], lines: [{ text: `${o.plr}: ${o.type.toUpperCase()} bypass to ${o.tail} removed.`, tone: "warn" }], snap });
  if (show && moments.length) {
    const run: SpRun<FrSnap> = { id: s.runs.length + 1 + s.seq * 1000, cmd: why, kind: "converge", moments: moments.slice(0, 12) };
    s.runs = [...s.runs, run];
    s.last = run;
  }
  return s;
}

// ---------------------------------------------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------------------------------------------
export type FrTicketId = "node" | "nofrr" | "bypassdown" | "plr" | "bfd";
export interface FrTicketDef {
  id: FrTicketId;
  title: string;
  report: string;
  reproLabel: string;
  repro: FrAction[];
  fault: (s: FrState) => void;
}
export const FR_TICKETS: FrTicketDef[] = [
  {
    id: "node",
    title: "FRR was ready — R5 died anyway",
    report: "“tunnel-te1 showed fast reroute ready. Last night R5 lost power and the video froze for more than a second. R3, R4 and R7 were all fine. Someone tidied up R3's protection settings last month.” Run the drill to see it.",
    reproLabel: "drill: R5 fails",
    repro: [{ type: "drill", what: "node:R5" }],
    fault: (s) => {
      s.cfg.R3.ifs["ge-0/0/1"].nhopOnly = true;
    },
  },
  {
    id: "nofrr",
    title: "Protection configured, nothing protected",
    report: "“The R5–R7 fiber was cut: 1.5 s of frozen video. Automatic bypasses are configured on every core interface, as always. tunnel-te1 was rebuilt from a template on Monday.”",
    reproLabel: "drill: R5–R7 fails",
    repro: [{ type: "drill", what: "link:R5-R7" }],
    fault: (s) => {
      s.cfg.R1.tunnels[0].frr = "off";
    },
  },
  {
    id: "bypassdown",
    title: "Node protection quietly gone",
    report: "“R5 rebooted during maintenance and the video was down for the whole reboot — not even the usual 1.5 s reroute. tunnel-te1 still requests node protection. The day before, R4's interface toward R7 was moved to a new line card.”",
    reproLabel: "drill: R5 fails",
    repro: [{ type: "drill", what: "node:R5" }],
    fault: (s) => {
      s.cfg.R4.ifs["ge-0/0/2"].te = false;
    },
  },
  {
    id: "plr",
    title: "One cut repaired in milliseconds, the next one not",
    report: "“Last month an R3–R5 failure was repaired in milliseconds. Yesterday the R5–R7 fiber was cut and the video froze for 1.5 s. Nothing changed on R3 or R1.”",
    reproLabel: "drill: R5–R7 fails",
    repro: [{ type: "drill", what: "link:R5-R7" }],
    fault: (s) => {
      s.cfg.R5.ifs["ge-0/0/1"].auto = false;
    },
  },
  {
    id: "bfd",
    title: "Thirty seconds of frozen video",
    report: "“The DWDM system between R3 and R5 failed. The bypasses were ready, yet the video froze for half a minute. R3's line card toward R5 was swapped last week.”",
    reproLabel: "drill: R3–R5 fails",
    repro: [{ type: "drill", what: "link:R3-R5" }],
    fault: (s) => {
      s.cfg.R3.ifs["ge-0/0/1"].bfd = false;
    },
  },
];
export const frTicket = (id: string) => FR_TICKETS.find((t) => t.id === id)!;
export function frTicketState(id: FrTicketId, seq = 0, os: FrOs = "xr"): FrState {
  const s = createFrNet(seq, os);
  const nx = cl(s);
  frTicket(id).fault(nx);
  const out = converge(s, nx, "", false, false);
  out.ticket = id;
  out.runs = [];
  out.last = undefined;
  out.log = [...out.log, { seq, t: out.clock, text: `Ticket opened: ${frTicket(id).title}.`, tone: "warn" }];
  return out;
}

export function frApply(s0: FrState, a: FrAction): FrState {
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
    case "drill":
      return frDrill(s0, a.what);
    case "restore": {
      const s = cl(s0);
      s.fail = { links: [], nodes: [] };
      s.cfgSeq += 1;
      s.clock += 30;
      s.log = [...s.log, { seq: s.seq, t: s.clock, text: "Every failed link and router is repaired. LSPs keep their current paths until they are re-optimized.", tone: "ok" }];
      return converge(s0, s, "Failures repaired");
    }
    case "reopt": {
      const s = cl(s0);
      s.clock += 2;
      s.log = [...s.log, { seq: s.seq, t: s.clock, text: `Re-optimization${a.dev ? ` on ${a.dev}` : ""}: every LSP is moved to its best path now.`, tone: "info" }];
      return converge(s0, s, "Re-optimize the LSPs", true);
    }
    case "test": {
      const s = cl(s0);
      s.clock += 2;
      const r = frFlow(s, a.from);
      const t: FrTest = { id: s.tests.length + 1, from: a.from, ok: r.ok, path: r.path, via: r.via, why: r.why, cfgSeq: s.cfgSeq };
      s.tests = [...s.tests, t].slice(-40);
      const run = flowRun(s, t);
      s.runs = [...s.runs, run];
      s.last = run;
      s.log = [...s.log, { seq: s.seq, t: s.clock, text: `traffic from ${a.from}: ${r.ok ? `delivered via ${r.via}` : r.why}`, tone: r.ok ? "ok" : "warn" }];
      return s;
    }
    case "ticket":
      return frTicketState(a.id, s0.seq + 1, s0.os);
    case "os":
      return createFrNet(s0.seq + 1, a.os);
    case "wipe-r3": {
      const s = cl(s0);
      for (const x of ifsOf("R3")) Object.assign(s.cfg.R3.ifs[x.ifn], { auto: false, nhopOnly: false });
      s.cfg.R3.tunnels = s.cfg.R3.tunnels.filter((t) => !t.bypassFor);
      s.cfg.R1.tunnels.forEach((t) => (t.frr = "off"));
      s.wiped = true;
      s.cfgSeq += 1;
      s.clock += 1;
      s.log = [...s.log, { seq: s.seq, t: s.clock, text: "R3's protection and tunnel-te1's fast-reroute request were removed.", tone: "warn" }];
      return converge(s0, s, "Protection removed from R3 and tunnel-te1");
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Diagnosis, proofs, ladder
// ---------------------------------------------------------------------------------------------------------------
export const FR_CAUSES: { id: string; label: string }[] = [
  { id: "node", label: "The PLR only has link (NHOP) protection — nothing protects against the next router failing" },
  { id: "nofrr", label: "The LSP doesn't request fast reroute" },
  { id: "bypassdown", label: "The node-protecting bypass can't be signaled (a link on its path isn't usable for TE)" },
  { id: "plr", label: "The PLR for the failed link has no bypass configured" },
  { id: "bfd", label: "The PLR detects the failure too late (no BFD on a silent link)" },
  { id: "igp", label: "IS-IS is too slow to converge" },
  { id: "headend", label: "The headend has no alternative path" },
];
const lastDrill = (s: FrState) => s.drills[s.drills.length - 1];
export function frCauseFeedback(s: FrState, cause: string): { right: boolean; consequence?: boolean; text: string } {
  const t = s.ticket as FrTicketId | undefined;
  const xr = s.os === "xr";
  if (cause === t) {
    const txt: Record<FrTicketId, string> = {
      node: `Yes. R3's interface toward R5 builds only NHOP bypasses (${xr ? "auto-tunnel backup nhop-only" : "link-protection no-node-protection"}). An NHOP bypass ends at R5 — when R5 itself dies, it leads nowhere. tunnel-te1 asked for node protection, but no NNHOP bypass to R7 exists, so R3 can't repair locally and R1 has to re-signal: more than a second lost.`,
      nofrr: `Yes. The rebuilt tunnel-te1 no longer requests protection (${xr ? "no fast-reroute" : "no link-protection / node-link-protection"}). Automatic bypasses are only built for LSPs that ask for protection, and only those LSPs are bound to bypasses: every failure now waits for the headend.`,
      bypassdown: `Yes. R4's new interface toward R7 isn't a TE interface, so R3's NNHOP bypass (R3–R4–R7) can't be signaled. tunnel-te1 falls back to the NHOP bypass to R5 — useless when R5 itself fails.`,
      plr: `Yes. For R5–R7 the point of local repair is R5, not R3. R5's interface toward R7 has no automatic bypass (${xr ? "auto-tunnel backup" : "link-protection"} is missing), so nothing repairs locally and R1 re-signals.`,
      bfd: `Yes. R3–R5 crosses a DWDM system: when it fails, both routers keep their light. Only BFD notices within milliseconds — and BFD is gone from R3's swapped interface. R3 learns about the failure when IS-IS gives up after 30 s; the bypass was ready the whole time.`,
    };
    return { right: true, text: txt[t] };
  }
  const d = lastDrill(s);
  const main = d?.results.find((x) => x.lsp === "R1:1");
  switch (cause) {
    case "igp":
      return { right: false, text: "Fast reroute exists so that recovery doesn't wait for IS-IS. The question is why the PLR couldn't repair locally." };
    case "headend":
      return { right: false, text: main?.newPath ? `R1 did find another path (${main.newPath.join("→")}) — after the outage. Local repair should have made that outage invisible.` : "Look at the PLR first: local repair doesn't need the headend." };
    case "node":
      return { right: false, text: s.cfg.R3.ifs["ge-0/0/1"].nhopOnly ? "R3 is NHOP-only, but that isn't what this failure needed." : "R3 builds NNHOP bypasses too (not NHOP-only)." };
    case "nofrr":
      return { right: false, text: "tunnel-te1 requests fast reroute (show mpls traffic-eng tunnels 1: Fast Reroute: Enabled)." };
    case "bypassdown":
      return { right: false, text: s.view.bypasses.filter((b) => !b.up).length ? `A bypass is down (${s.view.bypasses.filter((b) => !b.up).map((b) => `${b.plr} → ${b.tail}`).join(", ")}) but that isn't what this failure needed.` : "Every bypass that should exist is up." };
    case "plr":
      return { right: false, text: main?.plr ? `The PLR for this failure (${main.plr}) has a bypass on its interface.` : "Run the drill first." };
    case "bfd":
      return { right: false, text: main ? (main.detect === "isis" ? "Detection was slow, but it isn't the first problem here." : `Detection was fast: ${main.detect === "light" ? "loss of light, 10 ms" : "BFD, 45 ms"}.`) : "Run the drill first." };
  }
  return { right: false, text: d ? "That doesn't match the evidence." : "Run the drill first." };
}
export function frProofs(s: FrState): { label: string; ok: boolean; detail: string }[] {
  const t = s.ticket as FrTicketId | undefined;
  if (!t) return [];
  const want = frTicket(t).repro[0] as { type: "drill"; what: string };
  const last = s.drills[s.drills.length - 1];
  const lastFresh = last && last.what === want.what && last.commits === commitCount(s) && commitCount(s) > 0 ? last : undefined;
  const res = lastFresh?.results.find((x) => x.lsp === "R1:1");
  const drillOk = !!res && res.how === "local" && res.lossMs < 100;
  const proofDrill = { label: `A fresh drill (${want.what.replace(":", " ").replace("-", "–")}) is repaired locally in under 100 ms`, ok: drillOk, detail: res ? `${res.how === "local" ? `local repair at ${res.plr}, ~${res.lossMs} ms` : res.why}` : "run the drill again after the fix" };
  const base = s.fail.links.length || s.fail.nodes.length ? frPlace(s.cfg, { links: [], nodes: [] }, s.os) : s.view;
  const l = frLspOf(base, "R1", 1);
  switch (t) {
    case "node":
      return [{ label: "R3 has an NNHOP bypass to R7 for tunnel-te1", ok: !!l?.prot.R3 && base.bypasses.find((b) => b.key === l.prot.R3)?.type === "nnhop", detail: "show mpls traffic-eng fast-reroute database on R3" }, proofDrill];
    case "nofrr":
      return [{ label: "tunnel-te1 requests node protection again", ok: s.cfg.R1.tunnels.find((x) => x.id === 1)?.frr === "node", detail: "fast-reroute protect node / node-link-protection" }, proofDrill];
    case "bypassdown":
      return [{ label: "R3's NNHOP bypass to R7 is up", ok: base.bypasses.some((b) => b.plr === "R3" && b.type === "nnhop" && b.tail === "R7" && b.up), detail: "show mpls traffic-eng tunnels backup on R3" }, proofDrill];
    case "plr":
      return [{ label: "R5 protects tunnel-te1 on its interface toward R7", ok: !!l?.prot.R5, detail: "show mpls traffic-eng fast-reroute database on R5" }, proofDrill];
    case "bfd":
      return [{ label: "BFD runs on R3–R5 again", ok: s.cfg.R3.ifs["ge-0/0/1"].bfd && s.cfg.R5.ifs["ge-0/0/0"].bfd, detail: "show bfd session on R3" }, proofDrill];
  }
}
export function frLadder(s: FrState): { k: string; title: string; text: string }[] {
  const d = lastDrill(s);
  const main = d?.results.find((x) => x.lsp === "R1:1");
  const base = s.fail.links.length || s.fail.nodes.length ? frPlace(s.cfg, { links: [], nodes: [] }, s.os) : s.view;
  const l = frLspOf(base, "R1", 1);
  const t1 = s.cfg.R1.tunnels.find((x) => x.id === 1);
  return [
    { k: "drill", title: "What did the drill show?", text: main ? `${d!.what.replace("link:", "").replace("node:", "").replace("-", "–")} fails: ${main.how === "local" ? (main.lossMs < 1000 ? `repaired locally at ${main.plr} in ~${main.lossMs} ms` : `repaired locally at ${main.plr} — but only after ~${(main.lossMs / 1000).toFixed(0)} s`) : main.how === "unaffected" ? "tunnel-te1 not affected" : `${main.why} — ~${main.lossMs === Infinity ? "∞" : (main.lossMs / 1000).toFixed(1)} s lost`}.` : "Run the drill first." },
    { k: "want", title: "Does tunnel-te1 request protection?", text: t1 ? (t1.frr === "off" ? "No: fast reroute is off." : `Yes: ${t1.frr} protection.`) : "tunnel-te1 is not configured." },
    { k: "plr", title: "Which router is the PLR, and what bypass is bound?", text: main?.plr ? `${main.plr}: ${l?.prot[main.plr] ? `${base.bypasses.find((b) => b.key === l.prot[main.plr!])!.type.toUpperCase()} bypass to ${base.bypasses.find((b) => b.key === l.prot[main.plr!])!.tail}` : "none bound"}.` : "Run the drill first." },
    { k: "bypass", title: "Are the bypasses up?", text: base.bypasses.filter((b) => !b.up).map((b) => `${b.plr} ${b.type.toUpperCase()} to ${b.tail} down (${b.why})`).join(" · ") || "Every bypass is up." },
    { k: "detect", title: "How fast did the PLR detect it?", text: main ? (main.detect === "light" ? "Loss of light: 10 ms." : main.detect === "bfd" ? "BFD: 45 ms." : main.detect === "isis" ? "Silent failure without BFD: IS-IS hold time, 30 s." : "—") : "Run the drill first." },
  ];
}
