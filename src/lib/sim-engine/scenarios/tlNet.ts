import { spClone, type SpBase, type SpMoment, type SpRun } from "@/components/sp-lab/spKit";

/**
 * SR TI-LFA Lab network — the guided lesson's six routers, IS-IS with SR-MPLS and TI-LFA.
 *
 *                      R4                    R1–R2 10 · R2–R4 10 · R4–R6 10 (primary R1 → R6, cost 30)
 *                 10 ╱    ╲ 10               R2–R3 15 · R3–R5 15 · R5–R6 15 (post-convergence path)
 *   H1 ── R1 ── R2 ════      ── R6 ── H6     ════ R2–R4 crosses a DWDM system: when it fails the light stays on at
 *            10    ╲15         ╱15                both routers (silent) — BFD (3 × 50 ms) sees it, IS-IS alone only
 *                   R3 ──15── R5                  after its 30 s hold time
 *
 * Loopbacks 10.0.0.N, Node SID 16000 + N, Adjacency SIDs 24000 + 10 × own + neighbor; R1 and R6 exchange
 * 192.168.1.0/24 and 192.168.6.0/24 by iBGP (BGP-free core). Every core interface runs TI-LFA (IOS XR
 * `fast-reroute per-prefix` + `ti-lfa`, node-protecting tiebreaker; Junos `post-convergence-lfa node-protection`).
 *
 * Modeled (RFC 9855 TI-LFA, RFC 5286 LFA, RFC 5880 BFD):
 * - For every destination whose primary next hop is a protected interface, the router (the PLR) computes the
 *   post-convergence path with the link (or, node-protecting, the next hop) removed, and encodes it from the PLR's
 *   point of view against the pre-failure shortest paths: Node SIDs wherever the old shortest path already follows it,
 *   Adjacency SIDs where it doesn't. With `fast-reroute per-prefix` alone (no ti-lfa) only a classic loop-free
 *   alternate is used: a neighbor N with dist(N, D) < dist(N, PLR) + dist(PLR, D).
 * - Failure drills: link R2–R4, link R3–R5, router R4. Detection: loss of light 10 ms, silent R2–R4 BFD 150 ms or IS-IS
 *   hold time 30 s. A PLR with a backup that avoids the failure switches in ~15 ms; otherwise traffic waits for IS-IS
 *   convergence (~800 ms). A repair or post-convergence path through a router without SR loses labeled traffic until
 *   the failure is repaired. Both directions are measured (H1 → H6 and H6 → H1).
 */

export type TlR = "R1" | "R2" | "R3" | "R4" | "R5" | "R6";
export const TL_ROUTERS: TlR[] = ["R1", "R2", "R3", "R4", "R5", "R6"];
export const TL_IDX: Record<TlR, number> = { R1: 1, R2: 2, R3: 3, R4: 4, R5: 5, R6: 6 };
export const TL_LO: Record<TlR, string> = { R1: "10.0.0.1", R2: "10.0.0.2", R3: "10.0.0.3", R4: "10.0.0.4", R5: "10.0.0.5", R6: "10.0.0.6" };
export type TlOs = "xr" | "junos";
export type IfName = "ge-0/0/0" | "ge-0/0/1" | "ge-0/0/2";
export const SRGB_START = 16000;
export const DETECT = { light: 10, bfd: 150, isis: 30000 };
export const SWITCH_MS = 15;
export const CONVERGE_MS = 800;
export const TL_HOSTS = { H1: { ip: "192.168.1.10", net: "192.168.1.0", gw: "192.168.1.1", r: "R1" as TlR }, H6: { ip: "192.168.6.20", net: "192.168.6.0", gw: "192.168.6.1", r: "R6" as TlR } };
export type TlHost = keyof typeof TL_HOSTS;

export interface TlLink {
  id: string;
  a: TlR;
  ai: IfName;
  b: TlR;
  bi: IfName;
  metric: number;
  silent?: boolean;
}
export const TL_LINKS: TlLink[] = [
  { id: "R1-R2", a: "R1", ai: "ge-0/0/0", b: "R2", bi: "ge-0/0/0", metric: 10 },
  { id: "R2-R4", a: "R2", ai: "ge-0/0/1", b: "R4", bi: "ge-0/0/0", metric: 10, silent: true },
  { id: "R4-R6", a: "R4", ai: "ge-0/0/1", b: "R6", bi: "ge-0/0/0", metric: 10 },
  { id: "R2-R3", a: "R2", ai: "ge-0/0/2", b: "R3", bi: "ge-0/0/0", metric: 15 },
  { id: "R3-R5", a: "R3", ai: "ge-0/0/1", b: "R5", bi: "ge-0/0/0", metric: 15 },
  { id: "R5-R6", a: "R5", ai: "ge-0/0/1", b: "R6", bi: "ge-0/0/1", metric: 15 },
];
export const tlLinkIp = (l: TlLink, r: TlR) => `10.1.${TL_IDX[l.a]}${TL_IDX[l.b]}.${TL_IDX[r]}`;
export interface TlIfInfo {
  ifn: IfName;
  ip: string;
  peer: TlR;
  peerIf: IfName;
  peerIp: string;
  link: TlLink;
}
export function tlIfs(r: TlR): TlIfInfo[] {
  return TL_LINKS.flatMap((l) => (l.a === r ? [{ ifn: l.ai, ip: tlLinkIp(l, r), peer: l.b, peerIf: l.bi, peerIp: tlLinkIp(l, l.b), link: l }] : l.b === r ? [{ ifn: l.bi, ip: tlLinkIp(l, r), peer: l.a, peerIf: l.ai, peerIp: tlLinkIp(l, l.a), link: l }] : [])).sort((x, y) => x.ifn.localeCompare(y.ifn));
}
export const tlIfTo = (r: TlR, peer: TlR) => tlIfs(r).find((i) => i.peer === peer);
export const tlRouterOfLo = (ip: string) => TL_ROUTERS.find((r) => TL_LO[r] === ip);
export const tlAdj = (os: TlOs, r: TlR, n: TlR) => (os === "xr" ? 24000 : 299776) + 10 * TL_IDX[r] + TL_IDX[n];
/** R1 and R6 have fewer core links: their LAN uses the remaining port. */
export const lanIf = (r: TlR): IfName | undefined => (r === "R1" ? "ge-0/0/1" : r === "R6" ? "ge-0/0/2" : undefined);

// ---------------------------------------------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------------------------------------------
export interface TlIf {
  isis: boolean;
  metric: number;
  /** IOS XR `fast-reroute per-prefix`. */
  frr: boolean;
  /** Junos `link-protection` (classic LFA). */
  lp: boolean;
  /** IOS XR `fast-reroute per-prefix ti-lfa`; Junos `post-convergence-lfa`. */
  tilfa: boolean;
  /** Node-protecting (IOS XR tiebreaker node-protecting index 100; Junos post-convergence-lfa node-protection). */
  node: boolean;
  bfd: boolean;
}
export interface TlRtr {
  sr: boolean;
  sid?: number;
  /** Junos `backup-spf-options use-post-convergence-lfa` and `use-source-packet-routing`. */
  pcl: boolean;
  spr: boolean;
  ifs: Partial<Record<IfName, TlIf>>;
}
export type TlCfg = Record<TlR, TlRtr>;
export function tlHealthy(): TlCfg {
  const c = {} as TlCfg;
  for (const r of TL_ROUTERS) {
    const ifs: Partial<Record<IfName, TlIf>> = {};
    for (const i of tlIfs(r)) ifs[i.ifn] = { isis: true, metric: i.link.metric, frr: true, lp: false, tilfa: true, node: true, bfd: !!i.link.silent };
    c[r] = { sr: true, sid: TL_IDX[r], pcl: true, spr: true, ifs };
  }
  return c;
}

// ---------------------------------------------------------------------------------------------------------------
// Derived state: SPF, labels, TI-LFA backups
// ---------------------------------------------------------------------------------------------------------------
export interface TlNh {
  nh: TlR;
  ifn: IfName;
  ip: string;
}
export interface TlRoute {
  dst: TlR;
  cost: number;
  nh?: TlNh;
  path: TlR[];
}
export interface TlBackup {
  kind: "ti-lfa" | "lfa";
  protect: "link" | "node";
  nh: TlNh;
  /** Repair segments pushed above the destination's label (top first). */
  repair: number[];
  /** The post-convergence path the repair follows, from the PLR. */
  path: TlR[];
  pq?: TlR;
  cost: number;
}
export interface TlPrefix {
  dst: TlR;
  label: number;
  own?: boolean;
  nh?: TlNh;
  out?: number | "Pop" | "Unlabelled";
  backup?: TlBackup;
  /** Why the prefix has no backup though its interface asks for one. */
  noBackup?: string;
}
export interface TlView {
  adj: Record<string, boolean>;
  rib: Record<TlR, TlRoute[]>;
  pfx: Record<TlR, TlPrefix[]>;
}
type Excl = { link?: string; node?: TlR };
const adjUp = (c: TlCfg, l: TlLink, ex: Excl = {}) => !!c[l.a].ifs[l.ai]?.isis && !!c[l.b].ifs[l.bi]?.isis && l.id !== ex.link && l.a !== ex.node && l.b !== ex.node;
function spf(c: TlCfg, root: TlR, ex: Excl = {}): TlRoute[] {
  const d = new Map<TlR, { cost: number; prev?: TlR; first?: TlNh }>([[root, { cost: 0 }]]);
  const done = new Set<TlR>();
  while (done.size < TL_ROUTERS.length) {
    const u = TL_ROUTERS.filter((r) => !done.has(r) && d.has(r)).sort((a, b) => d.get(a)!.cost - d.get(b)!.cost || TL_IDX[a] - TL_IDX[b])[0];
    if (!u) break;
    done.add(u);
    for (const i of tlIfs(u)) {
      if (!adjUp(c, i.link, ex)) continue;
      const cost = d.get(u)!.cost + (c[u].ifs[i.ifn]?.metric ?? 10);
      if (!d.has(i.peer) || cost < d.get(i.peer)!.cost) d.set(i.peer, { cost, prev: u, first: u === root ? { nh: i.peer, ifn: i.ifn, ip: i.peerIp } : d.get(u)!.first });
    }
  }
  return TL_ROUTERS.filter((r) => r !== root && d.has(r)).map((r) => {
    const path: TlR[] = [r];
    let x = r;
    while (d.get(x)?.prev) path.unshift((x = d.get(x)!.prev!));
    return { dst: r, cost: d.get(r)!.cost, nh: d.get(r)!.first, path };
  });
}
const lbl = (c: TlCfg, r: TlR) => (c[r].sr && c[r].sid !== undefined ? SRGB_START + c[r].sid! : undefined);
/** Encode a path from its first router as segments, against the pre-failure shortest paths. */
function encode(c: TlCfg, os: TlOs, rib: Record<TlR, TlRoute[]>, path: TlR[], dst: TlR): number[] | undefined {
  const out: number[] = [];
  let i = 0;
  while (i < path.length - 1) {
    let best = i;
    for (let j = i + 1; j < path.length; j++) {
      const rt = rib[path[i]].find((x) => x.dst === path[j]);
      if (rt && rt.path.join() === path.slice(i, j + 1).join()) best = j;
      else break;
    }
    if (best === i) {
      out.push(tlAdj(os, path[i], path[i + 1]));
      i += 1;
    } else {
      if (path[best] === dst) break;
      const l = lbl(c, path[best]);
      if (l === undefined) return undefined;
      out.push(l);
      i = best;
    }
  }
  return out;
}
export function tlView(c: TlCfg, os: TlOs): TlView {
  const adj: Record<string, boolean> = {};
  for (const l of TL_LINKS) adj[l.id] = adjUp(c, l);
  const rib = {} as Record<TlR, TlRoute[]>;
  for (const r of TL_ROUTERS) rib[r] = spf(c, r);
  const pfx = {} as Record<TlR, TlPrefix[]>;
  for (const r of TL_ROUTERS) {
    pfx[r] = [];
    if (!c[r].sr) continue;
    for (const d of TL_ROUTERS) {
      const label = lbl(c, d);
      if (label === undefined) continue;
      if (d === r) {
        pfx[r].push({ dst: d, label, own: true });
        continue;
      }
      const rt = rib[r].find((x) => x.dst === d);
      if (!rt?.nh) continue;
      const out = rt.nh.nh === d ? "Pop" : c[rt.nh.nh].sr ? label : "Unlabelled";
      const p: TlPrefix = { dst: d, label, nh: rt.nh, out };
      const f = tlProt(c, os, r, rt.nh.ifn);
      if (f.on) {
        const nodeProt = f.node && rt.nh.nh !== d;
        const ex: Excl = nodeProt ? { node: rt.nh.nh } : { link: rt.nh.ifn ? tlIfs(r).find((x) => x.ifn === rt.nh!.ifn)!.link.id : undefined };
        const post = spf(c, r, ex).find((x) => x.dst === d);
        const linkOnly = spf(c, r, { link: tlIfs(r).find((x) => x.ifn === rt.nh!.ifn)!.link.id }).find((x) => x.dst === d);
        const pc = post ?? linkOnly;
        const prot = post ? (nodeProt ? "node" : "link") : "link";
        if (!pc?.nh) p.noBackup = "no path to the destination avoids the protected resource";
        else if (pc.path.slice(1).some((x) => !c[x].sr)) p.noBackup = `${pc.path.slice(1).find((x) => !c[x].sr)} on the post-convergence path is not SR-capable`;
        else if (f.ti) {
          const repair = encode(c, os, rib, [r, ...pc.path.slice(1)], d);
          if (!repair) p.noBackup = "the repair needs a Prefix-SID a router on the path doesn't have";
          else {
            const pq = pc.path.slice(1).find((x) => x !== d && repair.includes(lbl(c, x) ?? -1));
            p.backup = { kind: "ti-lfa", protect: prot, nh: pc.nh, repair, path: [r, ...pc.path.slice(1)], pq, cost: pc.cost };
          }
        } else {
          // Classic LFA: a neighbor whose own shortest path to d doesn't come back through r.
          const dist = (a: TlR, b: TlR) => (a === b ? 0 : rib[a].find((x) => x.dst === b)?.cost ?? Infinity);
          const cand = tlIfs(r).filter((i) => i.ifn !== rt.nh!.ifn && adj[i.link.id]).find((i) => dist(i.peer, d) < dist(i.peer, r) + dist(r, d));
          if (cand) p.backup = { kind: "lfa", protect: "link", nh: { nh: cand.peer, ifn: cand.ifn, ip: cand.peerIp }, repair: [], path: [r, ...(rib[cand.peer].find((x) => x.dst === d)?.path ?? [cand.peer, d])], cost: (c[r].ifs[cand.ifn]?.metric ?? 10) + dist(cand.peer, d) };
          else p.noBackup = "no loop-free alternate (classic LFA) exists — TI-LFA is not enabled";
        }
      }
      pfx[r].push(p);
    }
  }
  return { adj, rib, pfx };
}
/** What an interface's fast-reroute configuration amounts to on this OS. */
export function tlProt(c: TlCfg, os: TlOs, r: TlR, ifn: IfName) {
  const f = c[r].ifs[ifn];
  if (!f) return { on: false, ti: false, node: false };
  const ti = os === "xr" ? f.frr && f.tilfa : f.tilfa && c[r].pcl && c[r].spr;
  return { on: os === "xr" ? f.frr : f.lp || f.tilfa, ti, node: ti && f.node };
}
export const tlPfx = (v: TlView, r: TlR, d: TlR) => v.pfx[r].find((p) => p.dst === d);
/** The labels the PLR imposes on the backup next hop (top first): the repair, then the destination's label —
 * minus a top Node SID that belongs to the backup neighbor itself (it would pop it at once). */
export function tlBackupStack(c: TlCfg, p: TlPrefix): number[] {
  const b = p.backup;
  if (!b) return [];
  let st = [...b.repair, ...(b.nh.nh === p.dst ? [] : [p.label])];
  if (b.repair.length && lbl(c, b.nh.nh) === st[0]) st = st.slice(1);
  return st;
}

// ---------------------------------------------------------------------------------------------------------------
// The data plane: pings and the failure drill
// ---------------------------------------------------------------------------------------------------------------
export interface TlHop {
  from: string;
  to: string;
  labels: number[];
  note: string;
}
export interface TlWalk {
  hops: TlHop[];
  ok: boolean;
  path: string[];
  why?: string;
}
/** Carry a packet from router `start` toward IP `dst`. `fail` marks a failed resource the forwarding planes of `stale`
 * routers don't know about yet (they still use pre-failure state); `repairAt` is the PLR switched to its backup. */
function walk(c: TlCfg, v: TlView, start: TlR, dst: string, opt: { failLink?: string; failNode?: TlR; repairAt?: TlR } = {}): TlWalk {
  const w: TlWalk = { hops: [], ok: false, path: [start] };
  let r: TlR = start;
  let stack: number[] = [];
  const isDown = (from: TlR, to: TlR) => opt.failNode === to || (opt.failLink && tlIfTo(from, to)?.link.id === opt.failLink);
  const send = (nh: TlNh, note: string) => {
    if (isDown(r, nh.nh)) {
      w.why = `${r} sends toward ${nh.nh}, but ${opt.failNode === nh.nh ? `${nh.nh} has failed` : `the link ${tlIfTo(r, nh.nh)!.link.id} is down`} — lost`;
      return false;
    }
    w.hops.push({ from: r, to: nh.nh, labels: [...stack], note });
    r = nh.nh;
    w.path.push(r);
    return true;
  };
  const far = (ip: string): TlR | undefined => (ip.startsWith("192.168.6.") ? "R6" : ip.startsWith("192.168.1.") ? "R1" : undefined);
  for (let ttl = 0; ttl < 24; ttl++) {
    if (stack.length) {
      const top = stack[0];
      const own = v.pfx[r].find((p) => p.label === top && p.own);
      if (own) {
        stack = stack.slice(1);
        w.hops.push({ from: r, to: r, labels: [...stack], note: `${r}: ${top} is its own Node SID → pop` });
        continue;
      }
      const adjN = tlIfs(r).find((i) => tlAdj("xr", r, i.peer) === top || tlAdj("junos", r, i.peer) === top);
      if (adjN && c[r].sr) {
        stack = stack.slice(1);
        if (!send({ nh: adjN.peer, ifn: adjN.ifn, ip: adjN.peerIp }, `${r}: ${top} is its Adjacency SID toward ${adjN.peer} → pop`)) return w;
        continue;
      }
      const p = v.pfx[r].find((x) => x.label === top);
      if (!p || !p.nh) {
        w.why = `${r} has no entry for label ${top}${c[r].sr ? "" : ` (${r} is not SR-capable)`} — dropped`;
        return w;
      }
      const useBackup = opt.repairAt === r && p.backup && isDown(r, p.nh.nh);
      if (useBackup) {
        const b = p.backup!;
        const inner = b.nh.nh === p.dst ? [] : [top];
        stack = [...b.repair, ...inner, ...stack.slice(1)];
        if (b.kind === "ti-lfa" && b.repair.length && lbl(c, b.nh.nh) === stack[0]) stack = stack.slice(1);
        if (!send(b.nh, `${r}: primary next hop ${p.nh.nh} is gone → ${b.kind === "ti-lfa" ? `TI-LFA backup: push [${b.repair.join(", ")}]` : `LFA backup via ${b.nh.nh}`}, out ${b.nh.ifn}`)) return w;
        continue;
      }
      if (p.out === "Unlabelled") {
        stack = stack.slice(1);
        if (!send(p.nh, `${r}: ${top} → Unlabelled (next hop ${p.nh.nh} is not SR-capable)`)) return w;
        continue;
      }
      if (p.out === "Pop") {
        stack = stack.slice(1);
        if (!send(p.nh, `${r}: ${top} → pop (PHP), out ${p.nh.ifn}`)) return w;
        continue;
      }
      if (!send(p.nh, `${r}: ${top} → swap ${p.out}, out ${p.nh.ifn}`)) return w;
      continue;
    }
    const lo = tlRouterOfLo(dst);
    if (lo === r) {
      w.ok = true;
      return w;
    }
    const h = (Object.keys(TL_HOSTS) as TlHost[]).find((x) => TL_HOSTS[x].ip === dst);
    if (h && TL_HOSTS[h].r === r) {
      w.hops.push({ from: r, to: h, labels: [], note: `${r}: delivered to ${h}` });
      w.path.push(h);
      w.ok = true;
      return w;
    }
    const f = far(dst);
    if (f && (r === "R1" || r === "R6") && f !== r) {
      const p = tlPfx(v, r, f);
      if (!p?.nh || p.out === "Unlabelled") {
        w.why = v.rib[r].some((x) => x.dst === f) ? `${r}: no SR label toward ${TL_LO[f]} — dropped` : `${r} has no route to ${TL_LO[f]} — dropped`;
        return w;
      }
      const useBackup = opt.repairAt === r && p.backup && isDown(r, p.nh.nh);
      if (useBackup) {
        const b = p.backup!;
        stack = b.nh.nh === f ? [...b.repair] : [...b.repair, p.label];
        if (b.kind === "ti-lfa" && b.repair.length && lbl(c, b.nh.nh) === stack[0]) stack = stack.slice(1);
        if (!send(b.nh, `${r}: ${dst} → ${f}'s Node SID, primary next hop gone → backup via ${b.nh.nh}, push [${stack.join(", ")}]`)) return w;
        continue;
      }
      stack = p.out === "Pop" ? [] : [p.out as number];
      if (!send(p.nh, `${r}: ${dst} → BGP next hop ${TL_LO[f]} → push ${f}'s Node SID${p.out === "Pop" ? " (popped)" : ` ${p.out}`}, out ${p.nh.ifn}`)) return w;
      continue;
    }
    w.why = `${r} has no route to ${dst} (the core runs no BGP) — dropped`;
    return w;
  }
  w.why = "TTL expired";
  return w;
}

export type TlFail = { link?: string; node?: TlR };
export interface TlFlowResult {
  flow: string;
  affected: boolean;
  plr?: TlR;
  detect?: "light" | "bfd" | "isis";
  detectMs?: number;
  how: "unaffected" | "local" | "converge" | "lost";
  backup?: TlBackup;
  lossMs: number;
  why: string;
  repairPath?: string[];
  next?: TlR;
}
export interface TlDrill {
  id: number;
  what: string;
  results: TlFlowResult[];
  cfgSeq: number;
}
export function failText(f: TlFail) {
  return f.node ? `router ${f.node} fails` : `link ${f.link!.replace("-", "–")} fails`;
}
/** What a failure does to one direction of the customer flow. */
function flowResult(c: TlCfg, os: TlOs, v: TlView, src: TlR, dstIp: string, label: string, fail: TlFail): TlFlowResult {
  const pre = walk(c, v, src, dstIp);
  const usesFailed = pre.path.some((x, i) => (fail.node && x === fail.node) || (fail.link && i > 0 && tlIfTo(pre.path[i - 1] as TlR, x as TlR)?.link.id === fail.link));
  if (!usesFailed) return { flow: label, affected: false, how: "unaffected", lossMs: 0, why: "the failure is not on its path" };
  // The PLR: the router just before the failed resource on the path.
  let plr: TlR | undefined;
  for (let i = 1; i < pre.path.length; i++) {
    const a = pre.path[i - 1] as TlR;
    const b = pre.path[i] as TlR;
    if ((fail.node && b === fail.node) || (fail.link && tlIfTo(a, b)?.link.id === fail.link)) {
      plr = a;
      break;
    }
  }
  const next = pre.path[pre.path.indexOf(plr!) + 1] as TlR;
  const link = tlIfTo(plr!, next)!.link;
  const silent = !!link.silent && !fail.node;
  const bfd = !!c[plr!].ifs[tlIfTo(plr!, next)!.ifn]?.bfd && !!c[next].ifs[tlIfTo(next, plr!)!.ifn]?.bfd;
  const detect = !silent ? "light" : bfd ? "bfd" : "isis";
  const detectMs = DETECT[detect];
  const base = { flow: label, affected: true, plr, next, detect, detectMs } as const;
  // Local repair at the PLR?
  const rep = walk(c, v, src, dstIp, { failLink: fail.link, failNode: fail.node, repairAt: plr });
  const after = (() => {
    const failed = spClone(c);
    if (fail.link) {
      const l = TL_LINKS.find((x) => x.id === fail.link)!;
      failed[l.a].ifs[l.ai]!.isis = false;
      failed[l.b].ifs[l.bi]!.isis = false;
    }
    if (fail.node) for (const i of tlIfs(fail.node)) failed[fail.node].ifs[i.ifn]!.isis = false;
    return walk(failed, tlView(failed, os), src, dstIp);
  })();
  const egress: TlR = dstIp.startsWith("192.168.6.") ? "R6" : "R1";
  const p = tlPfx(v, plr!, egress);
  const usedBackup = rep.hops.find((h) => h.from === plr && /backup/.test(h.note));
  if (rep.ok && usedBackup) return { ...base, how: "local", backup: p?.backup ?? undefined, lossMs: detectMs + SWITCH_MS, why: `${plr} switched to its backup ${detect === "isis" ? "only after the IS-IS hold time" : "right after detection"}`, repairPath: rep.path };
  if (!after.ok) return { ...base, how: "lost", lossMs: Infinity, why: `even after convergence the traffic is lost — ${after.why}`, repairPath: rep.path };
  const noBk = p?.noBackup;
  const why = usedBackup ? `the backup failed — ${rep.why}` : noBk ? `${plr} has no backup: ${noBk}` : tlProt(c, os, plr!, tlIfTo(plr!, next)!.ifn).on ? `${plr}'s backup doesn't avoid the failure` : `${plr} has no fast reroute on ${tlIfTo(plr!, next)!.ifn}`;
  return { ...base, how: "converge", lossMs: detectMs + CONVERGE_MS, why: `${why} — traffic waits for IS-IS to converge`, repairPath: after.path };
}

// ---------------------------------------------------------------------------------------------------------------
// State and actions
// ---------------------------------------------------------------------------------------------------------------
export interface TlSnap {
  view: TlView;
}
export interface TlTest {
  id: number;
  from: string;
  dst: string;
  ok: boolean;
  path: string[];
  why?: string;
  labels: number[][];
  cfgSeq: number;
  t: number;
}
export interface TlSys {
  t: number;
  dev: TlR;
  kind: "commit" | "adj-up" | "adj-down" | "bfd-down" | "frr";
  peer?: string;
}
export interface TlState extends SpBase<TlSnap> {
  os: TlOs;
  cfg: TlCfg;
  hist: Record<TlR, TlRtr[]>;
  view: TlView;
  sys: TlSys[];
  tests: TlTest[];
  drills: TlDrill[];
  wiped?: boolean;
}
export type TlTicketId = "notilfa" | "reverse" | "bfd" | "repairsr" | "lfaonly";
export type TlAction =
  | { type: "cfg"; dev: TlR; cfg: TlRtr; text: string }
  | { type: "set"; changes: { dev: TlR; f: (c: TlRtr) => void }[]; text: string }
  | { type: "ping" }
  | { type: "drill"; fail: TlFail }
  | { type: "link"; id: string; up: boolean }
  | { type: "ticket"; id: TlTicketId }
  | { type: "wipe-r4" }
  | { type: "os"; os: TlOs };

const cl = (o: TlState): TlState => ({ ...spClone(o), runs: o.runs, last: o.last });
export function createTlNet(seq = 0, os: TlOs = "xr"): TlState {
  const cfg = tlHealthy();
  const view = tlView(cfg, os);
  const s: TlState = { seq, os, cfgSeq: 0, clock: 3600, runs: [], log: [{ seq, t: 3600, text: "IS-IS with SR-MPLS is up; every core interface runs TI-LFA with node protection, and BFD runs on the silent R2–R4 link. Every router has a backup for every destination it can protect.", tone: "info" }], cfg, hist: Object.fromEntries(TL_ROUTERS.map((r) => [r, []])) as unknown as Record<TlR, TlRtr[]>, view, sys: [], tests: [], drills: [] };
  for (const l of TL_LINKS) s.sys.push({ t: 15, dev: l.a, kind: "adj-up", peer: l.b }, { t: 15, dev: l.b, kind: "adj-up", peer: l.a });
  return s;
}
const color = (labels: number[]) => (labels.length > 1 ? "violet" : labels.length ? "cyan" : "green");
export function tlPing(s0: TlState): TlState {
  const s = cl(s0);
  s.clock += 2;
  const go = walk(s.cfg, s.view, "R1", TL_HOSTS.H6.ip);
  go.hops.unshift({ from: "H1", to: "R1", labels: [], note: "H1 sends an echo request to 192.168.6.20" });
  go.path.unshift("H1");
  const back = go.ok ? walk(s.cfg, s.view, "R6", TL_HOSTS.H1.ip) : undefined;
  if (back) {
    back.hops.unshift({ from: "H6", to: "R6", labels: [], note: "H6 answers 192.168.1.10" });
    back.path.unshift("H6");
  }
  const snap = { view: s.view };
  const moments: SpMoment<TlSnap>[] = [];
  for (const w of [go, back].filter((x): x is TlWalk => !!x)) {
    for (const h of w.hops) moments.push({ tokens: h.from !== h.to ? [{ from: h.from, to: h.to, label: h.labels.length ? h.labels.join(" | ") : "IP", color: color(h.labels) }] : [], lines: [{ text: h.note, tone: h.labels.length ? "learn" : "info" }], snap });
    if (w.why) moments.push({ tokens: [], lines: [{ text: w.why, tone: "warn" }], snap });
  }
  const ok = go.ok && !!back?.ok;
  const why = go.why ?? back?.why;
  moments.push({ tokens: [], lines: [{ text: ok ? `ping 192.168.6.20 from H1: success — ${go.path.join(" → ")}.` : `ping 192.168.6.20 from H1: failed — ${why}`, tone: ok ? "ok" : "bad" }], snap });
  const t: TlTest = { id: s.tests.length + 1, from: "H1", dst: TL_HOSTS.H6.ip, ok, path: go.path, why, labels: go.hops.filter((h) => h.from !== h.to).map((h) => h.labels), cfgSeq: s.cfgSeq, t: s.clock };
  s.tests = [...s.tests, t].slice(-40);
  const run: SpRun<TlSnap> = { id: s.runs.length + 1 + s.seq * 1000, cmd: "ping 192.168.6.20 from H1", kind: "test", moments, ok };
  s.runs = [...s.runs, run];
  s.last = run;
  s.log = [...s.log, { seq: s.seq, t: s.clock, text: `ping 192.168.6.20 from H1: ${ok ? "success" : why}`, tone: ok ? "ok" : "warn" }];
  return s;
}
export const lossText = (ms: number) => (ms === Infinity ? "until the failure is repaired" : ms >= 1000 ? `~${(ms / 1000).toFixed(ms >= 10000 ? 0 : 1)} s` : `~${ms} ms`);
export function tlDrill(s0: TlState, fail: TlFail): TlState {
  const s = cl(s0);
  s.clock += 5;
  const v = s.view;
  const results = [flowResult(s.cfg, s.os, v, "R1", TL_HOSTS.H6.ip, "H1 → H6", fail), flowResult(s.cfg, s.os, v, "R6", TL_HOSTS.H1.ip, "H6 → H1", fail)];
  const snap = { view: v };
  const moments: SpMoment<TlSnap>[] = [{ tokens: [], lines: [{ text: `Drill: ${failText(fail)}. H1 and H6 exchange a steady stream; each direction is measured.`, tone: "info" }], snap }];
  for (const r of results) {
    if (!r.affected) {
      moments.push({ tokens: [], lines: [{ text: `${r.flow}: not affected (${r.why}).`, tone: "ok" }], snap });
      continue;
    }
    const det = r.detect === "light" ? "loss of light: 10 ms" : r.detect === "bfd" ? "BFD (3 × 50 ms): 150 ms" : "silent failure, no BFD — IS-IS hold time: 30 s";
    moments.push({ tokens: [], lines: [{ text: `${r.flow}: ${r.plr} is the point of local repair. It detects the failure — ${det}.`, tone: r.detect === "isis" ? "bad" : "info" }], views: { [r.plr!]: { ring: "hit", bubble: { text: "failure detected", tone: "warn" } } }, snap });
    if (r.how === "local" && r.repairPath) {
      const hops = r.repairPath;
      moments.push({ tokens: hops.slice(0, -1).map((x, i) => ({ from: x, to: hops[i + 1], label: i === 0 ? `repair ${r.backup?.repair.join(" | ") || r.backup?.kind}` : "→", color: "amber", delay: i * 300 })), lines: [{ text: `${r.flow}: ${r.plr} switches to its ${r.backup?.kind === "lfa" ? "LFA" : "TI-LFA"} backup in ~${SWITCH_MS} ms — ${r.backup ? `[${r.backup.repair.join(", ") || "no extra label"}] via ${r.backup.nh.nh}` : "backup"}. Traffic lost: ${lossText(r.lossMs)}.`, tone: r.lossMs < 1000 ? "ok" : "warn" }], snap });
    } else moments.push({ tokens: [], lines: [{ text: `${r.flow}: ${r.why}. Traffic lost${r.lossMs === Infinity ? " " : ": "}${lossText(r.lossMs)}.`, tone: "bad" }], snap });
  }
  moments.push({ tokens: [], lines: [{ text: "IS-IS converges; every router moves to the post-convergence path and the backups are recomputed. Then the failure is repaired.", tone: "info" }], snap });
  const d: TlDrill = { id: s.drills.length + 1, what: failText(fail), results, cfgSeq: s.cfgSeq };
  s.drills = [...s.drills, d].slice(-20);
  const ok = results.every((r) => !r.affected || (r.how === "local" && r.lossMs < 1000));
  const run: SpRun<TlSnap> = { id: s.runs.length + 1 + s.seq * 1000, cmd: `Drill: ${failText(fail)}`, kind: "drill", moments, ok };
  s.runs = [...s.runs, run];
  s.last = run;
  for (const r of results.filter((x) => x.affected)) {
    const t0 = s.clock;
    if (r.detect === "bfd") s.sys.push({ t: t0, dev: r.plr!, kind: "bfd-down", peer: r.next });
    if (r.how === "local") s.sys.push({ t: t0, dev: r.plr!, kind: "frr", peer: r.next });
    s.sys.push({ t: t0 + (r.detect === "isis" ? 30 : 0), dev: r.plr!, kind: "adj-down", peer: r.next }, { t: t0 + 40, dev: r.plr!, kind: "adj-up", peer: r.next });
  }
  s.log = [...s.log, { seq: s.seq, t: s.clock, text: `Drill — ${failText(fail)}: ${results.map((r) => `${r.flow} ${r.affected ? (r.how === "local" ? `repaired locally (${lossText(r.lossMs)})` : r.how === "lost" ? "lost until repaired" : `waits for convergence (${lossText(r.lossMs)})`) : "unaffected"}`).join(", ")}.`, tone: ok ? "ok" : "warn" }];
  return s;
}
function converge(prev: TlState, s: TlState, why: string, show = true): TlState {
  const view = tlView(s.cfg, s.os);
  s.view = view;
  const snap = { view };
  const moments: SpMoment<TlSnap>[] = [];
  for (const l of TL_LINKS)
    if (prev.view.adj[l.id] !== view.adj[l.id]) {
      moments.push({ tokens: [], lines: [{ text: `IS-IS ${l.a}–${l.b} ${view.adj[l.id] ? "Up" : "goes down"}.`, tone: view.adj[l.id] ? "ok" : "bad" }], snap });
      s.sys.push({ t: s.clock, dev: l.a, kind: view.adj[l.id] ? "adj-up" : "adj-down", peer: l.b }, { t: s.clock, dev: l.b, kind: view.adj[l.id] ? "adj-up" : "adj-down", peer: l.a });
    }
  const lines: { text: string; tone: "ok" | "bad" | "learn" }[] = [];
  for (const r of TL_ROUTERS)
    for (const p of view.pfx[r]) {
      const q = prev.view.pfx[r].find((x) => x.dst === p.dst);
      const a = p.backup ? `${p.backup.kind}:${p.backup.nh.nh}:${p.backup.repair.join(",")}` : "";
      const b = q?.backup ? `${q.backup.kind}:${q.backup.nh.nh}:${q.backup.repair.join(",")}` : "";
      if (a !== b) lines.push({ text: p.backup ? `${r} → ${p.dst}: backup ${p.backup.kind === "lfa" ? "LFA" : "TI-LFA"} via ${p.backup.nh.nh}${p.backup.repair.length ? ` [${p.backup.repair.join(", ")}]` : ""}.` : `${r} → ${p.dst}: no backup${p.noBackup ? ` (${p.noBackup})` : ""}.`, tone: p.backup ? "learn" : "bad" });
    }
  if (lines.length) moments.push({ tokens: [], lines: lines.slice(0, 10), snap });
  if (show && moments.length) {
    const run: SpRun<TlSnap> = { id: s.runs.length + 1 + s.seq * 1000, cmd: why, kind: "converge", moments };
    s.runs = [...s.runs, run];
    s.last = run;
  }
  return s;
}

// ---------------------------------------------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------------------------------------------
export interface TlTicketDef {
  id: TlTicketId;
  title: string;
  report: string;
  reproLabel: string;
  repro: TlAction[];
  fault: (c: TlCfg) => void;
}
const drill = (fail: TlFail): TlAction => ({ type: "drill", fail });
export const TL_TICKETS: TlTicketDef[] = [
  {
    id: "notilfa",
    title: "A one-second freeze",
    report: "“When R2–R4 failed last night, the H6 application froze for about a second — downstream only. R2 was replaced last week from a minimal template.” Run the drill to see it.",
    reproLabel: "drill: R2–R4 fails",
    repro: [drill({ link: "R2-R4" })],
    fault: (c) => {
      Object.assign(c.R2.ifs["ge-0/0/1"]!, { frr: false, lp: false, tilfa: false, node: false });
    },
  },
  {
    id: "reverse",
    title: "Only the replies stall",
    report: "“After the last R2–R4 failure, H6's answers to H1 stalled for about a second, while H1 → H6 kept flowing. R4's configuration was regenerated recently.”",
    reproLabel: "drill: R2–R4 fails",
    repro: [drill({ link: "R2-R4" })],
    fault: (c) => {
      Object.assign(c.R4.ifs["ge-0/0/0"]!, { frr: false, lp: false, tilfa: false, node: false });
    },
  },
  {
    id: "bfd",
    title: "Thirty seconds of silence",
    report: "“The DWDM card carrying R2–R4 failed. TI-LFA was ready on R2 and R4, yet traffic stopped for about half a minute. The interfaces never went down.”",
    reproLabel: "drill: R2–R4 fails",
    repro: [drill({ link: "R2-R4" })],
    fault: (c) => {
      c.R2.ifs["ge-0/0/1"]!.bfd = false;
      c.R4.ifs["ge-0/0/0"]!.bfd = false;
    },
  },
  {
    id: "repairsr",
    title: "Protected, then black",
    report: "“TI-LFA is configured on every interface. When R2–R4 failed, H1 ↔ H6 went dark in both directions and only came back when the link was repaired. R3 came back from an RMA the day before.”",
    reproLabel: "drill: R2–R4 fails",
    repro: [drill({ link: "R2-R4" })],
    fault: (c) => {
      c.R3.sr = false;
    },
  },
  {
    id: "lfaonly",
    title: "Fast reroute is configured…",
    report: "“R4 has fast reroute configured on its link to R2 — we checked. Still, when R2–R4 failed, H6 → H1 stalled for about a second.”",
    reproLabel: "drill: R2–R4 fails",
    repro: [drill({ link: "R2-R4" })],
    fault: (c) => {
      Object.assign(c.R4.ifs["ge-0/0/0"]!, { frr: true, lp: true, tilfa: false, node: false });
    },
  },
];
export const tlTicket = (id: string) => TL_TICKETS.find((t) => t.id === id)!;
export function tlTicketState(id: TlTicketId, seq = 0, os: TlOs = "xr"): TlState {
  const s = createTlNet(seq, os);
  const nx = cl(s);
  tlTicket(id).fault(nx.cfg);
  const out = converge(s, nx, "", false);
  out.ticket = id;
  out.runs = [];
  out.last = undefined;
  out.log = [...out.log, { seq, t: out.clock, text: `Ticket opened: ${tlTicket(id).title}.`, tone: "warn" }];
  return out;
}
export function tlApply(s0: TlState, a: TlAction): TlState {
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
      const l = TL_LINKS.find((x) => x.id === a.id)!;
      const s = cl(s0);
      s.cfg[l.a].ifs[l.ai]!.isis = a.up;
      s.cfg[l.b].ifs[l.bi]!.isis = a.up;
      s.cfgSeq += 1;
      s.clock += 1;
      s.log = [...s.log, { seq: s.seq, t: s.clock, text: `${l.id} ${a.up ? "restored" : "stays down (after convergence)"}.`, tone: a.up ? "ok" : "warn" }];
      return converge(s0, s, `${l.id} ${a.up ? "restored" : "down"}`);
    }
    case "wipe-r4": {
      const s = cl(s0);
      for (const i of tlIfs("R4")) Object.assign(s.cfg.R4.ifs[i.ifn]!, { frr: false, lp: false, tilfa: false, node: false, bfd: false });
      s.wiped = true;
      s.cfgSeq += 1;
      s.clock += 1;
      s.log = [...s.log, { seq: s.seq, t: s.clock, text: "R4: fast reroute and BFD removed from every interface — rebuild them from its console.", tone: "warn" }];
      return converge(s0, s, "R4: protection wiped");
    }
    case "ping":
      return tlPing(s0);
    case "drill":
      return tlDrill(s0, a.fail);
    case "ticket":
      return tlTicketState(a.id, s0.seq + 1, s0.os);
    case "os":
      return createTlNet(s0.seq + 1, a.os);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Diagnosis, proofs, ladder
// ---------------------------------------------------------------------------------------------------------------
export const TL_CAUSES: { id: string; label: string }[] = [
  { id: "notilfa", label: "The PLR for H1 → H6 has no fast reroute on the protected link" },
  { id: "reverse", label: "The PLR for H6 → H1 has no fast reroute on the protected link" },
  { id: "bfd", label: "Nothing detects the silent failure quickly (no BFD)" },
  { id: "repairsr", label: "A router on the repair path has no segment routing" },
  { id: "lfaonly", label: "Only classic LFA runs, and no loop-free alternate exists" },
  { id: "headend", label: "The headend's SR policy didn't switch candidates fast enough" },
  { id: "bypass", label: "The RSVP bypass tunnel was down" },
];
const lastDrill = (s: TlState) => s.drills[s.drills.length - 1];
export function tlCauseFeedback(s: TlState, cause: string): { right: boolean; text: string } {
  const t = s.ticket as TlTicketId | undefined;
  const xr = s.os === "xr";
  if (cause === t) {
    const txt: Record<TlTicketId, string> = {
      notilfa: `Yes. R2's interface toward R4 has no ${xr ? "fast-reroute per-prefix / ti-lfa" : "post-convergence-lfa"}: R2 computes no backup. When R2–R4 fails, BFD detects it in 150 ms and R2 then waits for IS-IS to converge — about a second of loss for H1 → H6. The reverse direction is protected by R4.`,
      reverse: `Yes. R4's interface toward R2 lost TI-LFA in the regenerated configuration. H6 → H1 enters the failure at R4 — R4 is the PLR for that direction — and without a backup it waits for convergence. R2 protects the other direction, so H1 → H6 is fine.`,
      bfd: "Yes. BFD was removed from both ends of R2–R4. The DWDM failure keeps the light on, so neither router sees the link go down until the IS-IS hold time expires — 30 s. TI-LFA was ready the whole time; it just wasn't triggered.",
      repairsr: "Yes. R3 came back without segment routing. Every path around R2–R4 runs through R3, so neither R2 nor R4 can build a repair: the interfaces ask for TI-LFA, the backup column stays empty. Worse, after convergence the traffic reaches R3 unlabelled — and R3, in a BGP-free core, has no route to the customer prefixes. Only the repaired link brings it back.",
      lfaonly: `Yes. R4 runs ${xr ? "fast-reroute per-prefix without ti-lfa" : "loop-free alternates without post-convergence-lfa"}: classic LFA only. For 10.0.0.1 (R1, via R2) its only other neighbor, R6, isn't loop-free: R6's shortest path to R1 goes back through R4 (30 vs 10 + 20). No alternate, no backup — the traffic waits for convergence.`,
    };
    return { right: true, text: txt[t] };
  }
  switch (cause) {
    case "headend":
      return { right: false, text: "No SR policy is involved, and TI-LFA is local: the router next to the failure repairs, not a headend." };
    case "bypass":
      return { right: false, text: "There are no RSVP tunnels here: TI-LFA repairs with SR labels computed from IS-IS." };
    case "notilfa":
      return { right: false, text: tlProt(s.cfg, s.os, "R2", "ge-0/0/1").ti ? "R2 runs TI-LFA on its link to R4. (Configured is not the same as a backup, though — check that it has one.)" : "R2 does have fast reroute on its link to R4 — look at which kind, and whether it produced a backup." };
    case "reverse":
      return { right: false, text: tlProt(s.cfg, s.os, "R4", "ge-0/0/0").on ? (tlProt(s.cfg, s.os, "R4", "ge-0/0/0").ti ? "R4 runs TI-LFA on its link to R2." : "R4 does have fast reroute on its link to R2 — look at which kind, and whether it produced a backup.") : "R4 has no fast reroute toward R2 — but that is not all: check H1 → H6 too." };
    case "bfd":
      return { right: false, text: "BFD runs on both ends of R2–R4: the silent failure is detected in 150 ms." };
    case "repairsr":
      return { right: false, text: "Every router on the repair path runs segment routing." };
    case "lfaonly":
      return { right: false, text: "No interface runs classic LFA alone: wherever fast reroute is configured, it is TI-LFA." };
  }
  return { right: false, text: lastDrill(s) ? "That doesn't match the evidence." : "Run the drill first." };
}
export function tlProofs(s: TlState): { label: string; ok: boolean; detail: string }[] {
  const t = s.ticket as TlTicketId | undefined;
  if (!t) return [];
  const d = s.drills.filter((x) => x.cfgSeq === s.cfgSeq && x.what === "link R2–R4 fails").at(-1);
  const both = !!d && d.results.every((r) => !r.affected || (r.how === "local" && r.lossMs < 1000));
  const proof = { label: "A fresh drill: both directions repaired locally, under 1 s", ok: both, detail: "run the drill again after the fix" };
  const xr = s.os === "xr";
  const fr = xr ? "show isis fast-reroute" : "show isis backup spf results";
  switch (t) {
    case "notilfa":
      return [{ label: "R2 has a TI-LFA backup toward R6", ok: tlPfx(s.view, "R2", "R6")?.backup?.kind === "ti-lfa", detail: `${fr} on R2` }, proof];
    case "reverse":
      return [{ label: "R4 has a TI-LFA backup toward R1", ok: tlPfx(s.view, "R4", "R1")?.backup?.kind === "ti-lfa", detail: `${fr} on R4` }, proof];
    case "bfd":
      return [{ label: "BFD runs on both ends of R2–R4", ok: !!s.cfg.R2.ifs["ge-0/0/1"]?.bfd && !!s.cfg.R4.ifs["ge-0/0/0"]?.bfd, detail: "show bfd session on R2" }, proof];
    case "repairsr":
      return [{ label: "R3 runs segment routing again", ok: s.cfg.R3.sr && !!tlPfx(s.view, "R3", "R6"), detail: xr ? "show mpls forwarding on R3" : "show route table mpls.0 on R3" }, proof];
    case "lfaonly":
      return [{ label: "R4 has a TI-LFA backup toward R1", ok: tlPfx(s.view, "R4", "R1")?.backup?.kind === "ti-lfa", detail: `${fr} on R4` }, proof];
  }
}
export function tlLadder(s: TlState): { k: string; title: string; text: string }[] {
  const d = lastDrill(s);
  const v = s.view;
  const notSr = TL_ROUTERS.filter((r) => !s.cfg[r].sr);
  const cov = (["R2", "R4", "R6"] as TlR[]).map((r) => {
    const target = r === "R2" ? "R6" : "R1";
    const p = tlPfx(v, r, target);
    return `${r} → ${target}: ${p?.backup ? `${p.backup.kind === "lfa" ? "LFA" : "TI-LFA"} via ${p.backup.nh.nh}${p.backup.repair.length ? ` [${p.backup.repair.join(", ")}]` : ""}` : `no backup${p?.noBackup ? ` (${p.noBackup})` : ""}`}`;
  });
  const bfd = s.cfg.R2.ifs["ge-0/0/1"]?.bfd && s.cfg.R4.ifs["ge-0/0/0"]?.bfd;
  return [
    { k: "drill", title: "What did the drill show?", text: d ? `${d.what}: ${d.results.map((r) => `${r.flow} ${r.affected ? (r.how === "local" ? `repaired by ${r.plr} (${lossText(r.lossMs)})` : `${r.how === "lost" ? "lost" : "not repaired"} — ${r.why} (${lossText(r.lossMs)})`) : "unaffected"}`).join(" · ")}.` : "Run the drill first." },
    { k: "plr", title: "Which router is the point of local repair for each direction?", text: "H1 → H6 enters R2–R4 at R2; H6 → H1 enters it at R4. A router failure of R4 makes R2 and R6 the PLRs." },
    { k: "detect", title: "How fast is the failure detected?", text: bfd ? "R2–R4 is silent (DWDM): BFD on both ends detects it in 150 ms. Other links lose light: 10 ms." : "R2–R4 is silent and BFD is missing on one end: only the IS-IS hold time (30 s) detects it." },
    { k: "backup", title: "Does each PLR have a backup that avoids the failure?", text: cov.join(" · ") },
    { k: "repair", title: "Can every router on the repair path execute its labels?", text: notSr.length ? `No: ${notSr.join(", ")} has no segment routing.` : "Yes: segment routing on every router." },
    { k: "post", title: "Does the post-convergence path work?", text: (() => { const failed = spClone(s.cfg); failed.R2.ifs["ge-0/0/1"]!.isis = false; failed.R4.ifs["ge-0/0/0"]!.isis = false; const w = walk(failed, tlView(failed, s.os), "R1", TL_HOSTS.H6.ip); return w.ok ? `Yes: ${w.path.join(" → ")}.` : `No: ${w.why}.`; })() },
  ];
}
