import { spClone, type SpBase, type SpMoment, type SpRun } from "@/components/sp-lab/spKit";
import { v6norm } from "./sxNet";

/**
 * SRv6 TI-LFA Lab — one model for every adjacency, SID, route, backup, packet and drill (IOS XR, RFC 9855 / RFC 8986).
 *
 *                     P2 ─────10───── PE2          primary PE1–P1–P2–PE2 (metric 10 each)
 *            10 (DWDM, silent) │ 50     │ 70        protection P1–P3–P4 (10, 10), P4–P2 50, P4–PE2 70
 *   CE1 ─ PE1 ─10─ P1         P4 ───────┘          PLR P1 protects link P1–P2 (and node P2) for PE2
 *                   └─10─ P3 ─10─┘
 *
 * - Loopback0 2001:db8:ffff::N, SRv6 locator MAIN 2001:db8:110:N::/64 (N: PE1 1, P1 11, P2 12, P3 13, P4 14, PE2 2);
 *   IS-IS advertises the locator only with `segment-routing srv6 locator MAIN` (isisLoc). SIDs: End :1, End.X :40+k
 *   (interface order, PSP/USD), PE End.DT4 for VRF CUST-A after them. CUST-A traffic CE1 ↔ CE2 is an SRv6 L3VPN flow:
 *   PE1 encapsulates with DA = PE2's End.DT4 (and back).
 * - FRR per interface (IOS XR): `fast-reroute per-prefix` (classic LFA), `… ti-lfa`, `… tiebreaker node-protecting`;
 *   BFD per interface. Backups = post-convergence SPF avoiding the link (or the next-hop node), encoded as the PLR's
 *   outgoing interface plus End / End.X SIDs against the pre-failure shortest paths ([End X, End.X X→Y] collapses to
 *   End.X X→Y, which is routed to X's locator anyway).
 * - Repair data plane: the PLR encapsulates (H.Encaps.Red, DA = first repair SID, SRH for the rest); the last repair
 *   SID's USD flavor decapsulates and exposes the original packet. During a drill every router except the PLR still
 *   uses its pre-failure table (stale FIB) — which is why a repair must force its way past them.
 * - Drill timing: detection by loss of light 10 ms, BFD 150 ms or the IS-IS hold time 30 s (P1–P2 is a silent DWDM
 *   link); then a local switch (15 ms) or IS-IS convergence (800 ms).
 */

export type T6R = "PE1" | "P1" | "P2" | "P3" | "P4" | "PE2";
export const T6_ROUTERS: T6R[] = ["PE1", "P1", "P2", "P3", "P4", "PE2"];
export const T6_N: Record<T6R, number> = { PE1: 1, P1: 11, P2: 12, P3: 13, P4: 14, PE2: 2 };
export const T6_LO = (r: T6R) => `2001:db8:ffff::${T6_N[r]}`;
export const locOf = (r: T6R) => `2001:db8:110:${T6_N[r]}::`;
export const sidOf = (r: T6R, fn: number) => `2001:db8:110:${T6_N[r]}:${fn.toString(16)}::`;
export type IfName = "ge-0/0/0" | "ge-0/0/1" | "ge-0/0/2" | "ge-0/0/3";
export const DETECT = { light: 10, bfd: 150, isis: 30000 };
export const SWITCH_MS = 15;
export const CONVERGE_MS = 800;
export const CE = { CE1: { pe: "PE1" as T6R, host: "10.10.1.10", lan: "10.10.1.0/24" }, CE2: { pe: "PE2" as T6R, host: "10.20.1.10", lan: "10.20.1.0/24" } };

export interface T6Link {
  id: string;
  a: T6R;
  ai: IfName;
  b: T6R;
  bi: IfName;
  metric: number;
  silent?: boolean;
}
export const T6_LINKS: T6Link[] = [
  { id: "PE1-P1", a: "PE1", ai: "ge-0/0/0", b: "P1", bi: "ge-0/0/0", metric: 10 },
  { id: "P1-P2", a: "P1", ai: "ge-0/0/1", b: "P2", bi: "ge-0/0/0", metric: 10, silent: true },
  { id: "P2-PE2", a: "P2", ai: "ge-0/0/1", b: "PE2", bi: "ge-0/0/0", metric: 10 },
  { id: "P1-P3", a: "P1", ai: "ge-0/0/2", b: "P3", bi: "ge-0/0/0", metric: 10 },
  { id: "P3-P4", a: "P3", ai: "ge-0/0/1", b: "P4", bi: "ge-0/0/0", metric: 10 },
  { id: "P4-P2", a: "P4", ai: "ge-0/0/1", b: "P2", bi: "ge-0/0/2", metric: 50 },
  { id: "P4-PE2", a: "P4", ai: "ge-0/0/2", b: "PE2", bi: "ge-0/0/1", metric: 70 },
];
export const linkIp = (l: T6Link, r: T6R) => `2001:db8:20:${T6_LINKS.indexOf(l) + 1}::${l.a === r ? 1 : 2}`;
export interface T6IfInfo {
  ifn: IfName;
  peer: T6R;
  link: T6Link;
}
export function t6Ifs(r: T6R): T6IfInfo[] {
  return T6_LINKS.flatMap((l) => (l.a === r ? [{ ifn: l.ai, peer: l.b, link: l }] : l.b === r ? [{ ifn: l.bi, peer: l.a, link: l }] : [])).sort((x, y) => x.ifn.localeCompare(y.ifn));
}
export const t6IfTo = (r: T6R, peer: T6R) => t6Ifs(r).find((i) => i.peer === peer);
export const ll = (r: T6R) => `fe80::${T6_N[r]}`;

// ---------------------------------------------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------------------------------------------
export interface T6If {
  isis: boolean;
  metric: number;
  frr: boolean;
  tilfa: boolean;
  node: boolean;
  bfd: boolean;
}
export interface T6Rtr {
  isisLoc: boolean;
  ifs: Partial<Record<IfName, T6If>>;
}
export type T6Cfg = Record<T6R, T6Rtr>;
export function t6Healthy(): T6Cfg {
  const c = {} as T6Cfg;
  for (const r of T6_ROUTERS) {
    const ifs: Partial<Record<IfName, T6If>> = {};
    for (const i of t6Ifs(r)) ifs[i.ifn] = { isis: true, metric: i.link.metric, frr: true, tilfa: true, node: true, bfd: !!i.link.silent };
    c[r] = { isisLoc: true, ifs };
  }
  return c;
}

// ---------------------------------------------------------------------------------------------------------------
// Derived state
// ---------------------------------------------------------------------------------------------------------------
export interface T6Nh {
  nh: T6R;
  ifn: IfName;
}
export interface T6Route {
  dst: T6R;
  cost: number;
  nh?: T6Nh;
  path: T6R[];
}
export interface T6Sid {
  sid: string;
  behavior: "End" | "End.X" | "End.DT4";
  ifn?: IfName;
  peer?: T6R;
}
export interface T6Backup {
  kind: "ti-lfa" | "lfa";
  protect: "link" | "node";
  nh: T6Nh;
  /** Repair SIDs (in order); empty = the outgoing interface alone is enough. */
  repair: string[];
  path: T6R[];
  cost: number;
}
export interface T6Prot {
  dst: T6R;
  nh: T6Nh;
  cost: number;
  backup?: T6Backup;
  noBackup?: string;
}
export interface T6View {
  adj: Record<string, boolean>;
  rib: Record<T6R, T6Route[]>;
  sids: Record<T6R, T6Sid[]>;
  prot: Record<T6R, T6Prot[]>;
}
type Excl = { link?: string; node?: T6R };
const adjUp = (c: T6Cfg, l: T6Link, ex: Excl = {}) => !!c[l.a].ifs[l.ai]?.isis && !!c[l.b].ifs[l.bi]?.isis && l.id !== ex.link && l.a !== ex.node && l.b !== ex.node;
function spf(c: T6Cfg, root: T6R, ex: Excl = {}): T6Route[] {
  const d = new Map<T6R, { cost: number; prev?: T6R; first?: T6Nh }>([[root, { cost: 0 }]]);
  const done = new Set<T6R>();
  while (done.size < T6_ROUTERS.length) {
    const u = T6_ROUTERS.filter((r) => !done.has(r) && d.has(r)).sort((a, b) => d.get(a)!.cost - d.get(b)!.cost || T6_N[a] - T6_N[b])[0];
    if (!u) break;
    done.add(u);
    for (const i of t6Ifs(u)) {
      if (!adjUp(c, i.link, ex)) continue;
      const cost = d.get(u)!.cost + (c[u].ifs[i.ifn]?.metric ?? 10);
      if (!d.has(i.peer) || cost < d.get(i.peer)!.cost) d.set(i.peer, { cost, prev: u, first: u === root ? { nh: i.peer, ifn: i.ifn } : d.get(u)!.first });
    }
  }
  return T6_ROUTERS.filter((r) => r !== root && d.has(r)).map((r) => {
    const path: T6R[] = [r];
    let x = r;
    while (d.get(x)?.prev) path.unshift((x = d.get(x)!.prev!));
    return { dst: r, cost: d.get(r)!.cost, nh: d.get(r)!.first, path };
  });
}
export const endOf = (v: { sids: Record<T6R, T6Sid[]> }, r: T6R) => v.sids[r].find((x) => x.behavior === "End")?.sid;
export const endXOf = (v: { sids: Record<T6R, T6Sid[]> }, r: T6R, peer: T6R) => v.sids[r].find((x) => x.behavior === "End.X" && x.peer === peer)?.sid;
export const dt4Of = (v: { sids: Record<T6R, T6Sid[]> }, r: T6R) => v.sids[r].find((x) => x.behavior === "End.DT4")?.sid;
/** Encode a post-convergence path (PLR first) as repair SIDs against the pre-failure shortest paths. */
function encode(rib: Record<T6R, T6Route[]>, sids: Record<T6R, T6Sid[]>, path: T6R[]): string[] | undefined {
  const segs: { sid: string; kind: "end" | "x"; node: T6R }[] = [];
  let i = 1; // the PLR's own first hop is its outgoing interface — no SID needed
  while (i < path.length - 1) {
    let best = i;
    for (let j = i + 1; j < path.length; j++) {
      const rt = rib[path[i]].find((x) => x.dst === path[j]);
      if (rt && rt.path.join() === path.slice(i, j + 1).join()) best = j;
      else break;
    }
    if (best === path.length - 1) break;
    if (best === i) {
      const x = endXOf({ sids }, path[i], path[i + 1]);
      if (!x) return undefined;
      segs.push({ sid: x, kind: "x", node: path[i] });
      i += 1;
    } else {
      // From the PLR the first segment target must also be on the PLR's own (pre-failure) path via the OIF.
      const e = endOf({ sids }, path[best]);
      if (!e) return undefined;
      segs.push({ sid: e, kind: "end", node: path[best] });
      i = best;
    }
  }
  // [End X, End.X X→Y] → End.X X→Y (routed to X's locator anyway).
  const out: string[] = [];
  for (let k = 0; k < segs.length; k++) {
    if (segs[k].kind === "end" && segs[k + 1]?.kind === "x" && segs[k + 1].node === segs[k].node) continue;
    out.push(segs[k].sid);
  }
  return out;
}
export function t6View(c: T6Cfg): T6View {
  const adj: Record<string, boolean> = {};
  for (const l of T6_LINKS) adj[l.id] = adjUp(c, l);
  const rib = {} as T6View["rib"];
  for (const r of T6_ROUTERS) rib[r] = spf(c, r);
  const sids = {} as T6View["sids"];
  for (const r of T6_ROUTERS) {
    sids[r] = [];
    if (!c[r].isisLoc) continue;
    sids[r].push({ sid: sidOf(r, 1), behavior: "End" });
    t6Ifs(r).forEach((i, k) => {
      if (adj[i.link.id]) sids[r].push({ sid: sidOf(r, 0x40 + k), behavior: "End.X", ifn: i.ifn, peer: i.peer });
    });
    if (r === "PE1" || r === "PE2") sids[r].push({ sid: sidOf(r, 0x40 + t6Ifs(r).length), behavior: "End.DT4" });
  }
  const prot = {} as T6View["prot"];
  for (const r of T6_ROUTERS) {
    prot[r] = [];
    for (const d of T6_ROUTERS) {
      if (d === r) continue;
      const rt = rib[r].find((x) => x.dst === d);
      if (!rt?.nh) continue;
      const p: T6Prot = { dst: d, nh: rt.nh, cost: rt.cost };
      const f = t6Frr(c, r, rt.nh.ifn);
      if (f.on) {
        const lid = t6Ifs(r).find((x) => x.ifn === rt.nh!.ifn)!.link.id;
        const nodeProt = f.node && rt.nh.nh !== d;
        const post = spf(c, r, nodeProt ? { node: rt.nh.nh } : { link: lid }).find((x) => x.dst === d);
        const linkOnly = spf(c, r, { link: lid }).find((x) => x.dst === d);
        const pc = post ?? linkOnly;
        const protect = post && nodeProt ? "node" : "link";
        if (!pc?.nh) p.noBackup = "no path to the destination avoids the protected resource";
        else if (f.ti) {
          if (!c[r].isisLoc) p.noBackup = "SRv6 is not enabled on this router, so it cannot encapsulate a repair";
          else {
            const path = [r, ...pc.path.slice(1)];
            const repair = encode(rib, sids, path);
            if (!repair) p.noBackup = `the repair needs an SRv6 SID that ${path.slice(1).find((x) => !c[x].isisLoc) ?? "a router on the path"} doesn't have`;
            else p.backup = { kind: "ti-lfa", protect, nh: pc.nh, repair, path, cost: pc.cost };
          }
        } else {
          const dist = (a: T6R, b: T6R) => (a === b ? 0 : rib[a].find((x) => x.dst === b)?.cost ?? Infinity);
          const cand = t6Ifs(r).filter((i) => i.ifn !== rt.nh!.ifn && adj[i.link.id]).find((i) => dist(i.peer, d) < dist(i.peer, r) + dist(r, d));
          if (cand) p.backup = { kind: "lfa", protect: "link", nh: { nh: cand.peer, ifn: cand.ifn }, repair: [], path: [r, ...(rib[cand.peer].find((x) => x.dst === d)?.path ?? [cand.peer, d])], cost: (c[r].ifs[cand.ifn]?.metric ?? 10) + dist(cand.peer, d) };
          else p.noBackup = "no loop-free alternate (classic LFA) exists — TI-LFA is not enabled";
        }
      }
      prot[r].push(p);
    }
  }
  return { adj, rib, sids, prot };
}
export function t6Frr(c: T6Cfg, r: T6R, ifn: IfName) {
  const f = c[r].ifs[ifn];
  if (!f) return { on: false, ti: false, node: false };
  return { on: f.frr, ti: f.frr && f.tilfa, node: f.frr && f.tilfa && f.node };
}
export const t6Prot = (v: T6View, r: T6R, d: T6R) => v.prot[r].find((p) => p.dst === d);
/** Which router a v6 address (loopback, locator/SID) belongs to. */
export const ownerOf = (ip: string): T6R | undefined => {
  const n = v6norm(ip);
  if (!n) return undefined;
  return T6_ROUTERS.find((r) => n === T6_LO(r) || n.startsWith(`2001:db8:110:${T6_N[r]}:`) || n === `2001:db8:110:${T6_N[r]}::`);
};

// ---------------------------------------------------------------------------------------------------------------
// The data plane
// ---------------------------------------------------------------------------------------------------------------
export interface T6Hdr {
  src: string;
  da: string;
  /** Remaining segments after the DA (an SRH), in order. */
  rest: string[];
}
export interface T6Pkt {
  hdrs: T6Hdr[]; // [0] = outermost
  inner: { src: string; dst: string };
}
export interface T6Hop {
  from: string;
  to: string;
  hdrs: T6Hdr[];
  note: string;
  repair?: boolean;
}
export interface T6Walk {
  hops: T6Hop[];
  ok: boolean;
  path: string[];
  why?: string;
  loop?: boolean;
}
export type Naive = "plain" | "p2end";
interface WalkOpt {
  failLink?: string;
  failNode?: T6R;
  repairAt?: T6R;
  naive?: Naive;
}
const ceOfPe = (r: T6R) => (r === "PE1" ? "CE1" : r === "PE2" ? "CE2" : undefined);
function walk(c: T6Cfg, v: T6View, start: T6R, pkt0: T6Pkt, opt: WalkOpt = {}): T6Walk {
  const w: T6Walk = { hops: [], ok: false, path: [start] };
  let r: T6R = start;
  let pkt: T6Pkt = spClone(pkt0);
  const seen = new Map<string, number>();
  const isDown = (from: T6R, to: T6R) => opt.failNode === to || (!!opt.failLink && t6IfTo(from, to)?.link.id === opt.failLink);
  const send = (to: T6R, note: string, repair = false) => {
    if (isDown(r, to)) {
      w.why = `${r} sends toward ${to}, but ${opt.failNode === to ? `${to} has failed` : `link ${t6IfTo(r, to)!.link.id.replace("-", "–")} is down`} — lost`;
      return false;
    }
    w.hops.push({ from: r, to, hdrs: spClone(pkt.hdrs), note, repair });
    r = to;
    w.path.push(to);
    return true;
  };
  for (let ttl = 0; ttl < 32; ttl++) {
    const key = `${r}|${pkt.hdrs.map((h) => h.da).join(">")}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
    if ((seen.get(key) ?? 0) > 2) {
      w.why = `forwarding loop: ${w.path.slice(-4).join(" → ")} … (stale tables send it back)`;
      w.loop = true;
      return w;
    }
    const top = pkt.hdrs[0];
    if (!top) {
      w.why = "no outer header";
      return w;
    }
    const ls = v.sids[r].find((x) => x.sid === v6norm(top.da));
    if (ls) {
      if (ls.behavior === "End.DT4") {
        if (pkt.hdrs.length > 1 || top.rest.length) {
          w.why = `${r}: End.DT4 with more segments or headers outside — dropped`;
          return w;
        }
        const ce = ceOfPe(r)!;
        w.hops.push({ from: r, to: r, hdrs: [], note: `${r}: ${top.da} is its End.DT4 (CUST-A) → decapsulate, look up ${pkt.inner.dst}` });
        w.hops.push({ from: r, to: ce, hdrs: [], note: `${r} → ${ce}: delivered` });
        w.path.push(ce);
        w.ok = CE[ce].host === pkt.inner.dst;
        if (!w.ok) w.why = `${ce} has no host ${pkt.inner.dst}`;
        return w;
      }
      if (top.rest.length) {
        const next = top.rest[0];
        pkt.hdrs[0] = { ...top, da: next, rest: top.rest.slice(1) };
        w.hops.push({ from: r, to: r, hdrs: spClone(pkt.hdrs), note: `${r}: ${top.da} is its ${ls.behavior} → next segment ${next}` });
      } else {
        pkt = { ...pkt, hdrs: pkt.hdrs.slice(1) };
        w.hops.push({ from: r, to: r, hdrs: spClone(pkt.hdrs), note: `${r}: ${top.da} is its ${ls.behavior} (USD) → remove the repair header, expose ${pkt.hdrs[0]?.da ?? "the packet"}`, repair: true });
      }
      if (ls.behavior === "End.X") {
        if (!send(ls.peer!, `${r}: End.X — out ${ls.ifn} to ${ls.peer}`, true)) return w;
      }
      continue;
    }
    const owner = ownerOf(top.da);
    const rt = owner ? v.rib[r].find((x) => x.dst === owner) : undefined;
    if (owner === r) {
      w.why = `${r} owns ${top.da}'s locator but has no such SID — dropped`;
      return w;
    }
    // Is the DA's locator advertised (owner has isisLoc)?
    if (!rt?.nh || !c[owner!].isisLoc) {
      w.why = `${r} has no route to ${top.da} — dropped`;
      return w;
    }
    if (isDown(r, rt.nh.nh) && opt.repairAt === r) {
      if (opt.naive === "plain") {
        if (!send("P3", `${r}: primary next hop ${rt.nh.nh} is gone → hand-built reroute: send the packet unchanged to P3`)) return w;
        continue;
      }
      if (opt.naive === "p2end") {
        if (pkt.hdrs.length === 1) pkt.hdrs.unshift({ src: T6_LO(r), da: sidOf("P2", 1), rest: [] });
        if (!send("P3", `${r}: primary next hop ${rt.nh.nh} is gone → hand-built repair: encapsulate to P2's End ${sidOf("P2", 1)}, out to P3`, true)) return w;
        continue;
      }
      const p = t6Prot(v, r, owner!);
      if (p?.backup) {
        const b = p.backup;
        if (b.kind === "ti-lfa" && b.repair.length) pkt.hdrs.unshift({ src: T6_LO(r), da: b.repair[0], rest: b.repair.slice(1) });
        if (!send(b.nh.nh, `${r}: primary next hop ${rt.nh.nh} is gone → ${b.kind === "ti-lfa" ? (b.repair.length ? `TI-LFA: H.Encaps.Red with [${b.repair.join(", ")}]` : "TI-LFA: the outgoing interface alone is enough") : "LFA backup"}, out ${b.nh.ifn} to ${b.nh.nh}`, true)) return w;
        continue;
      }
    }
    if (!send(rt.nh.nh, `${r}: DA ${top.da} → ${owner}'s locator → ${rt.nh.nh}`)) return w;
  }
  w.why = "hop limit exceeded";
  return w;
}
export type Dir = "fwd" | "rev";
export const flowPkt = (v: T6View, dir: Dir): { start: T6R; pkt: T6Pkt; label: string } => {
  const [a, b] = dir === "fwd" ? (["CE1", "CE2"] as const) : (["CE2", "CE1"] as const);
  const pe = CE[a].pe;
  const far = CE[b].pe;
  return { start: pe, label: `${a} → ${b}`, pkt: { hdrs: [{ src: T6_LO(pe), da: dt4Of(v, far) ?? sidOf(far, 0x40 + t6Ifs(far).length), rest: [] }], inner: { src: CE[a].host, dst: CE[b].host } } };
};
export type T6Fail = { link?: string; node?: T6R };
export interface T6FlowResult {
  flow: string;
  affected: boolean;
  plr?: T6R;
  next?: T6R;
  detect?: "light" | "bfd" | "isis";
  detectMs?: number;
  how: "unaffected" | "local" | "converge" | "lost" | "loop";
  backup?: T6Backup;
  lossMs: number;
  why: string;
  walk?: T6Walk;
}
export interface T6Drill {
  id: number;
  what: string;
  fail: T6Fail;
  naive?: Naive;
  results: T6FlowResult[];
  cfgSeq: number;
}
export function failText(f: T6Fail) {
  return f.node ? `router ${f.node} fails` : `link ${f.link!.replace("-", "–")} fails`;
}
function flowResult(c: T6Cfg, v: T6View, dir: Dir, fail: T6Fail, naive?: Naive): T6FlowResult {
  const { start, pkt, label } = flowPkt(v, dir);
  const pre = walk(c, v, start, pkt);
  let plr: T6R | undefined;
  for (let i = 1; i < pre.path.length; i++) {
    const a = pre.path[i - 1] as T6R;
    const b = pre.path[i] as T6R;
    if ((fail.node && b === fail.node) || (fail.link && t6IfTo(a, b)?.link.id === fail.link)) {
      plr = a;
      break;
    }
  }
  if (!plr) return { flow: label, affected: false, how: "unaffected", lossMs: 0, why: "the failure is not on its path" };
  const next = pre.path[pre.path.indexOf(plr) + 1] as T6R;
  const link = t6IfTo(plr, next)!.link;
  const silent = !!link.silent && !fail.node;
  const bfd = !!c[plr].ifs[t6IfTo(plr, next)!.ifn]?.bfd && !!c[next].ifs[t6IfTo(next, plr)!.ifn]?.bfd;
  const detect = !silent ? "light" : bfd ? "bfd" : "isis";
  const detectMs = DETECT[detect];
  const base = { flow: label, affected: true, plr, next, detect, detectMs } as const;
  const nv = plr === "P1" ? naive : undefined; // the hand-built experiments live on P1 only
  const rep = walk(c, v, start, pkt, { failLink: fail.link, failNode: fail.node, repairAt: plr, naive: nv });
  const usedRepair = rep.hops.some((h) => h.from === plr && h.repair);
  const owner = ownerOf(pkt.hdrs[0].da)!;
  const p = t6Prot(v, plr, owner);
  if (rep.ok && usedRepair) return { ...base, how: "local", backup: nv ? undefined : p?.backup, lossMs: detectMs + SWITCH_MS, why: `${plr} switched to its ${nv ? "hand-built reroute" : "backup"} ${detect === "isis" ? "only after the IS-IS hold time" : "right after detection"}`, walk: rep };
  if (nv && rep.loop) return { ...base, how: "loop", lossMs: Infinity, why: `the hand-built ${nv === "plain" ? "reroute" : "repair"} loops: ${rep.why}`, walk: rep };
  const failed = spClone(c);
  if (fail.link) {
    const l = T6_LINKS.find((x) => x.id === fail.link)!;
    failed[l.a].ifs[l.ai]!.isis = false;
    failed[l.b].ifs[l.bi]!.isis = false;
  }
  if (fail.node) for (const i of t6Ifs(fail.node)) failed[fail.node].ifs[i.ifn]!.isis = false;
  const fv = t6View(failed);
  const after = walk(failed, fv, start, flowPkt(fv, dir).pkt);
  if (!after.ok) return { ...base, how: "lost", lossMs: Infinity, why: `even after convergence the traffic is lost — ${after.why}`, walk: rep };
  const why = usedRepair ? `the repair failed — ${rep.why}` : p?.noBackup ? `${plr} has no backup: ${p.noBackup}` : t6Frr(c, plr, t6IfTo(plr, next)!.ifn).on ? `${plr}'s backup doesn't avoid the failure` : `${plr} has no fast reroute on ${t6IfTo(plr, next)!.ifn}`;
  return { ...base, how: "converge", lossMs: detectMs + CONVERGE_MS, why: `${why} — traffic waits for IS-IS to converge`, walk: rep };
}

// ---------------------------------------------------------------------------------------------------------------
// State and actions
// ---------------------------------------------------------------------------------------------------------------
export interface T6Snap {
  view: T6View;
}
export interface T6Test {
  id: number;
  flow: string;
  walk: T6Walk;
  cfgSeq: number;
}
export interface T6Sys {
  t: number;
  dev: T6R;
  kind: "commit" | "adj-up" | "adj-down" | "bfd-down" | "frr";
  peer?: string;
}
export interface T6State extends SpBase<T6Snap> {
  cfg: T6Cfg;
  hist: Record<T6R, T6Rtr[]>;
  view: T6View;
  sys: T6Sys[];
  tests: T6Test[];
  drills: T6Drill[];
}
export type T6TicketId = "notilfa" | "p4srv6" | "node" | "bfd" | "reverse";
export type T6Action =
  | { type: "cfg"; dev: T6R; cfg: T6Rtr; text: string }
  | { type: "set"; changes: { dev: T6R; f: (c: T6Rtr) => void }[]; text: string }
  | { type: "ping"; dir: Dir }
  | { type: "drill"; fail: T6Fail; naive?: Naive }
  | { type: "wipe-p1" }
  | { type: "ticket"; id: T6TicketId };

const cl = (o: T6State): T6State => ({ ...spClone(o), runs: o.runs, last: o.last });
export function createT6Net(seq = 0): T6State {
  const cfg = t6Healthy();
  const s: T6State = { seq, cfgSeq: 0, clock: 3600, runs: [], log: [{ seq, t: 3600, text: "IS-IS with SRv6 and TI-LFA (node-protecting) runs on every core interface; BFD guards the silent DWDM link P1–P2.", tone: "info" }], cfg, hist: Object.fromEntries(T6_ROUTERS.map((r) => [r, []])) as unknown as Record<T6R, T6Rtr[]>, view: t6View(cfg), sys: [], tests: [], drills: [] };
  for (const l of T6_LINKS) s.sys.push({ t: 15, dev: l.a, kind: "adj-up", peer: l.b }, { t: 15, dev: l.b, kind: "adj-up", peer: l.a });
  return s;
}
const short = (x: string) => x.replace("2001:db8:110:", "…:");
const tok = (h: T6Hop) => (h.from !== h.to ? [{ from: h.from, to: h.to, label: h.hdrs.length ? `DA ${short(h.hdrs[0].da)}${h.hdrs.length > 1 ? " (+inner)" : ""}` : "IPv4", color: h.hdrs.length > 1 ? "amber" : h.hdrs.length ? "violet" : "green" }] : []);
export function t6Ping(s0: T6State, dir: Dir): T6State {
  const s = cl(s0);
  s.clock += 2;
  const f = flowPkt(s.view, dir);
  const w = walk(s.cfg, s.view, f.start, f.pkt);
  w.hops.unshift({ from: dir === "fwd" ? "CE1" : "CE2", to: f.start, hdrs: [], note: `${f.label.split(" ")[0]} sends ${f.pkt.inner.src} → ${f.pkt.inner.dst}; ${f.start} encapsulates with DA ${f.pkt.hdrs[0].da} (the far PE's End.DT4)` });
  w.path.unshift(dir === "fwd" ? "CE1" : "CE2");
  const t: T6Test = { id: s.tests.length + 1, flow: f.label, walk: w, cfgSeq: s.cfgSeq };
  s.tests = [...s.tests, t].slice(-40);
  const snap = { view: s.view };
  const moments: SpMoment<T6Snap>[] = w.hops.map((h) => ({ tokens: tok(h), lines: [{ text: h.note, tone: "learn" }], snap }));
  moments.push({ tokens: [], lines: [{ text: w.ok ? `${f.label}: delivered via ${w.path.join(" → ")}.` : `${f.label}: failed — ${w.why}`, tone: w.ok ? "ok" : "bad" }], snap });
  const run: SpRun<T6Snap> = { id: s.runs.length + 1 + s.seq * 1000, cmd: f.label, kind: "test", moments, ok: w.ok };
  s.runs = [...s.runs, run];
  s.last = run;
  s.log = [...s.log, { seq: s.seq, t: s.clock, text: `${f.label}: ${w.ok ? "delivered" : w.why}`, tone: w.ok ? "ok" : "warn" }];
  return s;
}
export const lossText = (ms: number) => (ms === Infinity ? "until the failure is repaired" : ms >= 1000 ? `~${(ms / 1000).toFixed(ms >= 10000 ? 0 : 1)} s` : `~${ms} ms`);
export function t6Drill(s0: T6State, fail: T6Fail, naive?: Naive): T6State {
  const s = cl(s0);
  s.clock += 5;
  const results = (["fwd", "rev"] as Dir[]).map((d) => flowResult(s.cfg, s.view, d, fail, naive));
  const what = `${failText(fail)}${naive ? ` (hand-built ${naive === "plain" ? "reroute" : "repair to P2's End"})` : ""}`;
  const d: T6Drill = { id: s.drills.length + 1, what, fail, naive, results, cfgSeq: s.cfgSeq };
  s.drills = [...s.drills, d].slice(-20);
  const snap = { view: s.view };
  const moments: SpMoment<T6Snap>[] = [{ tokens: [], lines: [{ text: `Drill: ${what}.`, tone: "warn" }], snap }];
  for (const r of results) {
    if (!r.affected) {
      moments.push({ tokens: [], lines: [{ text: `${r.flow}: not affected.`, tone: "info" }], snap });
      continue;
    }
    moments.push({ tokens: [], lines: [{ text: `${r.flow}: ${r.plr} detects the failure by ${r.detect === "light" ? "loss of light" : r.detect === "bfd" ? "BFD" : "the IS-IS hold time"} (${lossText(r.detectMs!)}).`, tone: r.detect === "isis" ? "warn" : "learn" }], snap });
    for (const h of r.walk?.hops ?? []) moments.push({ tokens: tok(h), lines: [{ text: h.note, tone: h.repair ? "learn" : "info" }], snap });
    moments.push({ tokens: [], lines: [{ text: `${r.flow}: ${r.how === "local" ? "repaired locally" : r.how === "converge" ? "waits for convergence" : r.how === "loop" ? "loops" : "lost"} — traffic lost ${lossText(r.lossMs)}. ${r.why}.`, tone: r.how === "local" && r.lossMs < 1000 ? "ok" : "bad" }], snap });
  }
  const run: SpRun<T6Snap> = { id: s.runs.length + 1 + s.seq * 1000, cmd: `Drill: ${what}`, kind: "test", moments, ok: results.every((r) => !r.affected || (r.how === "local" && r.lossMs < 1000)) };
  s.runs = [...s.runs, run];
  s.last = run;
  s.log = [...s.log, { seq: s.seq, t: s.clock, text: `Drill ${what}: ${results.map((r) => `${r.flow} ${r.affected ? lossText(r.lossMs) : "unaffected"}`).join(" · ")}`, tone: run.ok ? "ok" : "warn" }];
  return s;
}
function converge(prev: T6State, s: T6State, why: string, show = true): T6State {
  const view = t6View(s.cfg);
  s.view = view;
  const lines: { text: string; tone: "ok" | "bad" | "learn" }[] = [];
  for (const l of T6_LINKS)
    if (prev.view.adj[l.id] !== view.adj[l.id]) {
      lines.push({ text: `IS-IS ${l.a}–${l.b} ${view.adj[l.id] ? "Up" : "down"}.`, tone: view.adj[l.id] ? "ok" : "bad" });
      s.sys.push({ t: s.clock, dev: l.a, kind: view.adj[l.id] ? "adj-up" : "adj-down", peer: l.b }, { t: s.clock, dev: l.b, kind: view.adj[l.id] ? "adj-up" : "adj-down", peer: l.a });
    }
  for (const r of T6_ROUTERS) {
    const k = (v: T6View) => v.prot[r].filter((p) => p.backup).map((p) => `${p.dst}:${p.backup!.kind}:${p.backup!.repair.join(",")}`).join(";");
    if (k(prev.view) !== k(view)) {
      const n = view.prot[r].filter((p) => p.backup).length;
      lines.push({ text: `${r}: ${n} of ${view.prot[r].length} destinations have a backup now.`, tone: "learn" });
      s.sys.push({ t: s.clock, dev: r, kind: "frr" });
    }
  }
  if (show && lines.length) {
    const run: SpRun<T6Snap> = { id: s.runs.length + 1 + s.seq * 1000, cmd: why, kind: "converge", moments: [{ tokens: [], lines: lines.slice(0, 10), snap: { view } }] };
    s.runs = [...s.runs, run];
    s.last = run;
  }
  return s;
}

// ---------------------------------------------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------------------------------------------
export interface T6TicketDef {
  id: T6TicketId;
  title: string;
  report: string;
  reproLabel: string;
  repro: T6Action[];
  fault: (c: T6Cfg) => void;
}
const cut12: T6Action = { type: "drill", fail: { link: "P1-P2" } };
export const T6_TICKETS: T6TicketDef[] = [
  {
    id: "notilfa",
    title: "The cut wasn't protected",
    report: "“Last night's P1–P2 fiber cut took CUST-A's VPN down for almost a second, HQ to site 2. P1 is supposed to repair locally in tens of milliseconds. Someone touched P1's IS-IS interface config last week.”",
    reproLabel: "drill: cut P1–P2",
    repro: [cut12],
    fault: (c) => {
      c.P1.ifs["ge-0/0/1"]!.tilfa = false;
    },
  },
  {
    id: "p4srv6",
    title: "TI-LFA on, still no backup",
    report: "“P1 has TI-LFA configured toward P2, but show isis fast-reroute shows no backup for PE2, and a drill of the P1–P2 cut loses ~1 s. P4 was upgraded on Tuesday.”",
    reproLabel: "drill: cut P1–P2",
    repro: [cut12],
    fault: (c) => {
      c.P4.isisLoc = false;
    },
  },
  {
    id: "node",
    title: "P2's reload hurt",
    report: "“The planned reload of P2 took CUST-A down for almost a second. A P1–P2 fiber cut drill last month was fine (~165 ms). Why would losing the router be different?”",
    reproLabel: "drill: P2 fails",
    repro: [{ type: "drill", fail: { node: "P2" } }],
    fault: (c) => {
      c.P1.ifs["ge-0/0/1"]!.node = false;
    },
  },
  {
    id: "bfd",
    title: "30 seconds on a DWDM cut",
    report: "“An amplifier failed in the P1–P2 DWDM span. The interfaces stayed up and CUST-A lost traffic for about 30 seconds, although TI-LFA is configured and shows a backup.”",
    reproLabel: "drill: cut P1–P2",
    repro: [cut12],
    fault: (c) => {
      c.P1.ifs["ge-0/0/1"]!.bfd = false;
    },
  },
  {
    id: "reverse",
    title: "Only one direction survived",
    report: "“During the P1–P2 cut, HQ's traffic to site 2 recovered within milliseconds — but site 2's replies took almost a second. TI-LFA is on in P1, we checked.”",
    reproLabel: "drill: cut P1–P2",
    repro: [cut12],
    fault: (c) => {
      Object.assign(c.P2.ifs["ge-0/0/0"]!, { frr: false, tilfa: false, node: false });
    },
  },
];
export const t6Ticket = (id: string) => T6_TICKETS.find((t) => t.id === id)!;
export function t6TicketState(id: T6TicketId, seq = 0): T6State {
  const s = createT6Net(seq);
  const nx = cl(s);
  t6Ticket(id).fault(nx.cfg);
  const out = converge(s, nx, "", false);
  out.ticket = id;
  out.runs = [];
  out.last = undefined;
  out.log = [...out.log, { seq, t: out.clock, text: `Ticket opened: ${t6Ticket(id).title}.`, tone: "warn" }];
  return out;
}
export function t6Apply(s0: T6State, a: T6Action): T6State {
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
    case "wipe-p1": {
      const s = cl(s0);
      for (const f of Object.values(s.cfg.P1.ifs)) if (f) Object.assign(f, { frr: false, tilfa: false, node: false, bfd: false });
      s.cfgSeq += 1;
      s.clock += 1;
      s.log = [...s.log, { seq: s.seq, t: s.clock, text: "P1: all fast-reroute and BFD configuration was removed.", tone: "warn" }];
      return converge(s0, s, "P1: no fast-reroute, no BFD");
    }
    case "ping":
      return t6Ping(s0, a.dir);
    case "drill":
      return t6Drill(s0, a.fail, a.naive);
    case "ticket":
      return t6TicketState(a.id, s0.seq + 1);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Diagnosis, proofs, ladder
// ---------------------------------------------------------------------------------------------------------------
export const T6_CAUSES: { id: string; label: string }[] = [
  { id: "notilfa", label: "P1's interface toward P2 runs per-prefix LFA, not TI-LFA" },
  { id: "p4srv6", label: "P4 has no SRv6 SIDs, so the repair can't be encoded" },
  { id: "node", label: "P1's protection toward P2 is link-protecting only" },
  { id: "bfd", label: "BFD is missing on P1's side of the silent P1–P2 link" },
  { id: "reverse", label: "P2 has no fast reroute toward P1 for the reverse direction" },
  { id: "metric", label: "The backup path's metrics are too high" },
  { id: "microloop", label: "A micro-loop after convergence" },
];
const lastDrill = (s: T6State) => s.drills[s.drills.length - 1];
export function t6CauseFeedback(s: T6State, cause: string): { right: boolean; text: string } {
  const t = s.ticket as T6TicketId | undefined;
  if (cause === t) {
    const txt: Record<T6TicketId, string> = {
      notilfa: "Yes. P1's Gi0/0/0/1 still has “fast-reroute per-prefix” but lost “fast-reroute per-prefix ti-lfa”. Classic LFA needs a neighbor whose own shortest path to PE2 doesn't come back through P1 — P3's comes back (P3→P1→P2→PE2, 30 vs 30). No LFA, no backup: CUST-A waits for IS-IS to converge.",
      p4srv6: "Yes. After the upgrade P4's IS-IS no longer has “segment-routing srv6 locator MAIN”, so P4 has no End or End.X SIDs. The only safe repair has to force P4 out of its link to P2 (P4's own stale route to P2 goes back via P1) — and without P4's End.X there is no SID to say so. TI-LFA installs no backup.",
      node: "Yes. P1's Gi0/0/0/1 lost “fast-reroute per-prefix tiebreaker node-protecting index 100”. Its backup [P4 End.X→P2] protects the link — it merges back at P2. When P2 itself dies, the repair delivers the traffic to a dead router. Node protection picks [P4 End.X→PE2], bypassing P2.",
      bfd: "Yes. P1–P2 runs over DWDM: when the span fails the interfaces stay up, so only BFD notices quickly. P1's Gi0/0/0/1 lost “bfd fast-detect ipv6”, so the BFD session is down and P1 waits for the IS-IS hold time (30 s) before it uses its perfectly good backup.",
      reverse: "Yes. Protection is per router and per direction. P1 protects CE1 → CE2; the replies cross P2 → P1, and P2's Gi0/0/0/0 lost its whole fast-reroute configuration. P2 computes no backup toward PE1, so the replies wait for convergence.",
    };
    return { right: true, text: txt[t] };
  }
  switch (cause) {
    case "metric":
      return { right: false, text: "The backup path's metrics are fine — it's the post-convergence path; metrics decide which path, not whether there is protection." };
    case "microloop":
      return { right: false, text: "Micro-loops happen after convergence; this loss happens before it, at the PLR." };
    case "notilfa":
      return { right: false, text: "P1's interface toward P2 has TI-LFA." };
    case "p4srv6":
      return { right: false, text: "P4 has its End and End.X SIDs." };
    case "node":
      return { right: false, text: "P1's protection toward P2 is node-protecting." };
    case "bfd":
      return { right: false, text: "BFD is up on both sides of P1–P2." };
    case "reverse":
      return { right: false, text: "P2 has fast reroute (TI-LFA) toward P1." };
  }
  return { right: false, text: lastDrill(s) ? "That doesn't match the evidence." : "Run the drill first." };
}
export function t6Proofs(s: T6State): { label: string; ok: boolean; detail: string }[] {
  const t = s.ticket as T6TicketId | undefined;
  if (!t) return [];
  const d = [...s.drills].reverse().find((x) => x.cfgSeq === s.cfgSeq && !x.naive && (t === "node" ? x.fail.node === "P2" : x.fail.link === "P1-P2"));
  const ok = (flow: string) => !!d?.results.find((r) => r.flow === flow && r.how === "local" && r.lossMs < 1000);
  const p = t6Prot(s.view, t === "reverse" ? "P2" : "P1", t === "reverse" ? "PE1" : "PE2");
  const bk = { label: `${t === "reverse" ? "P2" : "P1"} has a TI-LFA backup ${t === "node" ? "that avoids P2" : ""}`.trim(), ok: !!p?.backup && p.backup.kind === "ti-lfa" && (t !== "node" || p.backup.protect === "node"), detail: "show isis fast-reroute" };
  const dr = { label: `A fresh drill (${t === "node" ? "P2 fails" : "P1–P2 cut"}) is repaired locally in both directions, under a second`, ok: ok("CE1 → CE2") && ok("CE2 → CE1"), detail: "run the drill again after the fix" };
  if (t === "bfd") return [{ label: "BFD is up on P1–P2", ok: s.cfg.P1.ifs["ge-0/0/1"]!.bfd && s.cfg.P2.ifs["ge-0/0/0"]!.bfd, detail: "show bfd session on P1" }, dr];
  return [bk, dr];
}
export function t6Ladder(s: T6State): { k: string; title: string; text: string }[] {
  const d = lastDrill(s);
  const v = s.view;
  const bad = d?.results.find((r) => r.affected && !(r.how === "local" && r.lossMs < 1000)) ?? d?.results.find((r) => r.affected);
  const plr = bad?.plr ?? "P1";
  const next = bad?.next ?? "P2";
  const dst: T6R = bad?.flow === "CE2 → CE1" ? "PE1" : "PE2";
  const ifn = t6IfTo(plr, next)!.ifn;
  const f = s.cfg[plr].ifs[ifn]!;
  const p = t6Prot(v, plr, dst);
  return [
    { k: "symptom", title: "What did the drill cost?", text: d ? d.results.map((r) => `${r.flow}: ${r.affected ? `${lossText(r.lossMs)} (${r.how})` : "unaffected"}`).join(" · ") : "Run a drill first." },
    { k: "plr", title: "Who is the PLR, and how does it detect the failure?", text: bad ? `${plr} (next hop ${next}); detection by ${bad.detect === "light" ? "loss of light" : bad.detect === "bfd" ? "BFD" : "the IS-IS hold time — 30 s"}.` : "—" },
    { k: "bfd", title: "Is BFD up where the link is silent?", text: t6IfTo(plr, next)!.link.silent ? `${plr} ${f.bfd ? "BFD on" : "no BFD"} · ${next} ${s.cfg[next].ifs[t6IfTo(next, plr)!.ifn]!.bfd ? "BFD on" : "no BFD"}` : "this link signals loss of light itself." },
    { k: "frr", title: `What does ${plr}'s interface toward ${next} ask for?`, text: `${f.frr ? "per-prefix" : "no fast-reroute"}${f.tilfa ? " + TI-LFA" : ""}${f.node ? " + node-protecting" : ""}.` },
    { k: "backup", title: `Does ${plr} have a backup for ${dst}?`, text: p?.backup ? `${p.backup.kind === "ti-lfa" ? `TI-LFA (${p.backup.protect})` : "LFA"} via ${p.backup.nh.nh}, repair [${p.backup.repair.join(", ") || "none"}], path ${p.backup.path.join(" → ")}.` : `none — ${p?.noBackup ?? "no fast reroute"}.` },
    { k: "sids", title: "Do the routers on the repair path have SRv6 SIDs?", text: T6_ROUTERS.filter((r) => !["PE1", "PE2"].includes(r)).map((r) => `${r} ${s.cfg[r].isisLoc ? "✓" : "✗ no locator"}`).join(" · ") },
  ];
}
