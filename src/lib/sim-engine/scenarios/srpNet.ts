import { spClone, type SpBase, type SpMoment, type SpRun } from "@/components/sp-lab/spKit";

/**
 * SR Policy Lab network — the SR-MPLS lesson's diamond plus the guided lesson's R3–R4 cross-link, on IOS XR.
 *
 *            R2 ──10── R4                 metrics (IGP = TE): top 10, bottom 15, R3–R4 30
 *        10 ╱   BLUE   │╲ 10 BLUE+GOLD    affinities: top BLUE, R4–R6 BLUE+GOLD, bottom and R3–R4 GOLD
 *   H1 ── R1      30 GOLD│  R6 ── H6 192.168.6.20 (colored 100: GOLD) · H60 192.168.60.20 (no color: default)
 *        15 ╲   GOLD   │╱ 15 GOLD
 *            R3 ──15── R5
 *
 * Segment routing as in the SR-MPLS Lab (IS-IS, SRGB 16000–23999, Node SID index = router number, Adjacency SIDs
 * 24000 + 10 × own + neighbor: R3→R5 24035, R3→R4 24034). R1 is the SR-TE headend:
 * - SR Policy GOLD: color 100, end-point 10.0.0.6, binding SID 30001; candidate paths preference 200 (explicit
 *   segment-list GOLD-EXPLICIT = 16003, 24035, 16006) and preference 100 (dynamic, metric type TE, constraint affinity
 *   include-any GOLD). The active candidate is the valid one with the highest preference (RFC 9256).
 * - Explicit validity (IOS XR): the first label must resolve at the headend; later labels are not checked — a wrong
 *   label further down is only found by traffic. Dynamic: the headend's CSPF over the IS-IS TE topology (each router
 *   floods its interfaces' affinities and TE metric), the segment list is the shortest encoding of the computed path.
 * - Steering (automated steering): R6 sets extended community color 100 on 192.168.6.0/24 when exporting to R1. A BGP
 *   route with color C and next hop E is steered into the policy (C, E) when it is up. Otherwise it resolves over the
 *   next hop's Node SID like any other route (the IOS XR default). 192.168.60.0/24 carries no color.
 * - The BSID is a local label at R1 that stands for the active segment list.
 */

export type SpR = "R1" | "R2" | "R3" | "R4" | "R5" | "R6";
export const SP_ROUTERS: SpR[] = ["R1", "R2", "R3", "R4", "R5", "R6"];
export const SP_IDX: Record<SpR, number> = { R1: 1, R2: 2, R3: 3, R4: 4, R5: 5, R6: 6 };
export const SP_LO: Record<SpR, string> = { R1: "10.0.0.1", R2: "10.0.0.2", R3: "10.0.0.3", R4: "10.0.0.4", R5: "10.0.0.5", R6: "10.0.0.6" };
export type IfName = "ge-0/0/0" | "ge-0/0/1" | "ge-0/0/2" | "ge-0/0/3";
export const IMPLICIT_NULL = 3;
export const SRGB = { start: 16000, range: 8000 };
export const COLOR = 100;
export type Aff = "BLUE" | "GOLD";
export const AFF_BIT: Record<Aff, number> = { BLUE: 0, GOLD: 1 };
export type SpHost = "H1" | "H6" | "H60";
export const SP_HOSTS: Record<SpHost, { ip: string; net: string; gw: string; r: SpR; ifn: IfName; colored: boolean }> = {
  H1: { ip: "192.168.1.10", net: "192.168.1.0", gw: "192.168.1.1", r: "R1", ifn: "ge-0/0/2", colored: false },
  H6: { ip: "192.168.6.20", net: "192.168.6.0", gw: "192.168.6.1", r: "R6", ifn: "ge-0/0/2", colored: true },
  H60: { ip: "192.168.60.20", net: "192.168.60.0", gw: "192.168.60.1", r: "R6", ifn: "ge-0/0/3", colored: false },
};

export interface SpLink {
  id: string;
  a: SpR;
  ai: IfName;
  b: SpR;
  bi: IfName;
  metric: number;
  aff: Aff[];
}
export const SP_LINKS: SpLink[] = [
  { id: "R1-R2", a: "R1", ai: "ge-0/0/0", b: "R2", bi: "ge-0/0/0", metric: 10, aff: ["BLUE"] },
  { id: "R2-R4", a: "R2", ai: "ge-0/0/1", b: "R4", bi: "ge-0/0/0", metric: 10, aff: ["BLUE"] },
  { id: "R4-R6", a: "R4", ai: "ge-0/0/1", b: "R6", bi: "ge-0/0/0", metric: 10, aff: ["BLUE", "GOLD"] },
  { id: "R1-R3", a: "R1", ai: "ge-0/0/1", b: "R3", bi: "ge-0/0/0", metric: 15, aff: ["GOLD"] },
  { id: "R3-R5", a: "R3", ai: "ge-0/0/1", b: "R5", bi: "ge-0/0/0", metric: 15, aff: ["GOLD"] },
  { id: "R5-R6", a: "R5", ai: "ge-0/0/1", b: "R6", bi: "ge-0/0/1", metric: 15, aff: ["GOLD"] },
  { id: "R3-R4", a: "R3", ai: "ge-0/0/2", b: "R4", bi: "ge-0/0/2", metric: 30, aff: ["GOLD"] },
];
export const spLinkIp = (l: SpLink, r: SpR) => `10.1.${SP_IDX[l.a]}${SP_IDX[l.b]}.${SP_IDX[r]}`;
export interface SpIfInfo {
  ifn: IfName;
  ip: string;
  peer: SpR;
  peerIf: IfName;
  peerIp: string;
  link: SpLink;
}
export function spIfs(r: SpR): SpIfInfo[] {
  return SP_LINKS.flatMap((l) => (l.a === r ? [{ ifn: l.ai, ip: spLinkIp(l, r), peer: l.b, peerIf: l.bi, peerIp: spLinkIp(l, l.b), link: l }] : l.b === r ? [{ ifn: l.bi, ip: spLinkIp(l, r), peer: l.a, peerIf: l.ai, peerIp: spLinkIp(l, l.a), link: l }] : [])).sort((x, y) => x.ifn.localeCompare(y.ifn));
}
export const spIfTo = (r: SpR, peer: SpR) => spIfs(r).find((i) => i.peer === peer);
export const spRouterOfLo = (ip: string) => SP_ROUTERS.find((r) => SP_LO[r] === ip);
export const adjLabel = (r: SpR, n: SpR) => 24000 + 10 * SP_IDX[r] + SP_IDX[n];

// ---------------------------------------------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------------------------------------------
export interface SpIf {
  isis: boolean;
  metric: number;
  /** segment-routing traffic-eng → interface → affinity → name … */
  aff: Aff[];
}
export interface SpCand {
  pref: number;
  kind: "explicit" | "dynamic";
  /** explicit: the segment-list name. */
  list?: string;
  /** dynamic: metric type and include-any affinities. */
  metric?: "te" | "igp";
  include?: Aff[];
}
export interface SpPolicy {
  name: string;
  color?: number;
  endpoint?: string;
  bsid?: number;
  cands: SpCand[];
}
/** A segment-list entry: IOS XR `index N address ipv4 A` (resolved and validated hop by hop against the topology) or
 * `index N mpls label L` (taken as is; only the first one is checked at the headend). */
export type SpSeg = ({ addr: string } | { label: number }) & { idx: number };
export interface SpRtr {
  sr: boolean;
  sid?: number;
  ifs: Partial<Record<IfName, SpIf>>;
  /** R1 only: segment lists and policies. */
  lists: Record<string, SpSeg[]>;
  policies: SpPolicy[];
  /** R6 only: the export policy that colors 192.168.6.0/24 is attached to the session toward R1. */
  colorOut?: boolean;
}
export type SpCfg = Record<SpR, SpRtr>;
export function spHealthy(): SpCfg {
  const c = {} as SpCfg;
  for (const r of SP_ROUTERS) {
    const ifs: Partial<Record<IfName, SpIf>> = {};
    for (const i of spIfs(r)) ifs[i.ifn] = { isis: true, metric: i.link.metric, aff: [...i.link.aff] };
    c[r] = { sr: true, sid: SP_IDX[r], ifs, lists: {}, policies: [] };
  }
  c.R1.lists = { "GOLD-EXPLICIT": [{ idx: 10, addr: SP_LO.R3 }, { idx: 20, addr: "10.1.35.5" }, { idx: 30, addr: SP_LO.R6 }] };
  c.R1.policies = [{ name: "GOLD", color: COLOR, endpoint: SP_LO.R6, bsid: 30001, cands: [{ pref: 200, kind: "explicit", list: "GOLD-EXPLICIT" }, { pref: 100, kind: "dynamic", metric: "te", include: ["GOLD"] }] }];
  c.R6.colorOut = true;
  return c;
}

// ---------------------------------------------------------------------------------------------------------------
// Derived state: IGP, SR labels, policies
// ---------------------------------------------------------------------------------------------------------------
export interface SpNh {
  nh: SpR;
  ifn: IfName;
  ip: string;
}
export interface SpRoute {
  dst: SpR;
  cost: number;
  nh?: SpNh;
  path: SpR[];
}
export type SpOut = number | "Pop" | "Unlabelled";
export interface SpEntry {
  label: number;
  kind: "pfx" | "adj" | "bsid";
  to: SpR;
  index?: number;
  own?: boolean;
  out?: SpOut;
  nh?: SpNh;
  why?: string;
  /** BSID: the segment list it stands for. */
  list?: number[];
  policy?: string;
}
export interface SpCandEval {
  cand: SpCand;
  valid: boolean;
  why: string;
  labels: number[];
  path?: SpR[];
  cost?: number;
}
export interface SpPolEval {
  pol: SpPolicy;
  up: boolean;
  why?: string;
  cands: SpCandEval[];
  active?: SpCandEval;
}
export interface SpView {
  adj: Record<string, boolean>;
  rib: Record<SpR, SpRoute[]>;
  sids: { index: number; owner: SpR }[];
  table: Record<SpR, SpEntry[]>;
  pols: SpPolEval[];
}
export const spAdjUp = (c: SpCfg, l: SpLink) => !!c[l.a].ifs[l.ai]?.isis && !!c[l.b].ifs[l.bi]?.isis;

function spf(c: SpCfg, root: SpR, linkCost: (from: SpR, i: SpIfInfo) => number | undefined): Map<SpR, { cost: number; prev?: SpR; first?: SpNh }> {
  const d = new Map<SpR, { cost: number; prev?: SpR; first?: SpNh }>([[root, { cost: 0 }]]);
  const done = new Set<SpR>();
  while (done.size < SP_ROUTERS.length) {
    const u = SP_ROUTERS.filter((r) => !done.has(r) && d.has(r)).sort((a, b) => d.get(a)!.cost - d.get(b)!.cost || SP_IDX[a] - SP_IDX[b])[0];
    if (!u) break;
    done.add(u);
    for (const i of spIfs(u)) {
      if (!spAdjUp(c, i.link)) continue;
      const m = linkCost(u, i);
      if (m === undefined) continue;
      const cost = d.get(u)!.cost + m;
      if (!d.has(i.peer) || cost < d.get(i.peer)!.cost) d.set(i.peer, { cost, prev: u, first: u === root ? { nh: i.peer, ifn: i.ifn, ip: i.peerIp } : d.get(u)!.first });
    }
  }
  return d;
}
const pathTo = (d: Map<SpR, { prev?: SpR }>, r: SpR) => {
  const p: SpR[] = [r];
  let x = r;
  while (d.get(x)?.prev) p.unshift((x = d.get(x)!.prev!));
  return p;
};
function igp(c: SpCfg, root: SpR): SpRoute[] {
  const d = spf(c, root, (u, i) => c[u].ifs[i.ifn]?.metric ?? 10);
  return SP_ROUTERS.filter((r) => r !== root && d.has(r)).map((r) => ({ dst: r, cost: d.get(r)!.cost, nh: d.get(r)!.first, path: pathTo(d, r) }));
}
/** The shortest segment encoding of a path: Node SIDs wherever the plain IGP already goes, Adjacency SIDs elsewhere. */
export function encodePath(rib: Record<SpR, SpRoute[]>, path: SpR[]): number[] {
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
      out.push(adjLabel(path[i], path[i + 1]));
      i += 1;
    } else {
      out.push(SRGB.start + SP_IDX[path[best]]);
      i = best;
    }
  }
  return out;
}
export function spView(c: SpCfg): SpView {
  const adj: Record<string, boolean> = {};
  for (const l of SP_LINKS) adj[l.id] = spAdjUp(c, l);
  const rib = {} as Record<SpR, SpRoute[]>;
  for (const r of SP_ROUTERS) rib[r] = igp(c, r);
  const sids = SP_ROUTERS.filter((r) => c[r].sr && c[r].sid !== undefined).map((r) => ({ index: c[r].sid!, owner: r }));
  const table = {} as Record<SpR, SpEntry[]>;
  for (const r of SP_ROUTERS) {
    table[r] = [];
    if (!c[r].sr) continue;
    for (const s of sids) {
      const label = SRGB.start + s.index;
      if (s.owner === r) {
        table[r].push({ label, kind: "pfx", to: r, index: s.index, own: true });
        continue;
      }
      const rt = rib[r].find((x) => x.dst === s.owner);
      if (!rt?.nh) continue;
      const n = rt.nh.nh;
      const out: SpOut = n === s.owner ? "Pop" : c[n].sr ? label : "Unlabelled";
      table[r].push({ label, kind: "pfx", to: s.owner, index: s.index, out, nh: rt.nh, why: out === "Unlabelled" ? `next hop ${n} is not SR-capable` : undefined });
    }
    for (const i of spIfs(r)) if (adj[i.link.id]) table[r].push({ label: adjLabel(r, i.peer), kind: "adj", to: i.peer, out: "Pop", nh: { nh: i.peer, ifn: i.ifn, ip: i.peerIp } });
  }
  const pols = c.R1.sr ? c.R1.policies.map((p) => evalPolicy(c, rib, table, p)) : [];
  for (const p of pols) if (p.up && p.pol.bsid !== undefined) table.R1.push({ label: p.pol.bsid, kind: "bsid", to: spRouterOfLo(p.pol.endpoint ?? "") ?? "R6", out: "Pop", list: p.active!.labels, policy: p.pol.name });
  for (const r of SP_ROUTERS) table[r].sort((a, b) => a.label - b.label);
  return { adj, rib, sids, table, pols };
}
function evalPolicy(c: SpCfg, rib: Record<SpR, SpRoute[]>, table: Record<SpR, SpEntry[]>, p: SpPolicy): SpPolEval {
  const ep = spRouterOfLo(p.endpoint ?? "");
  if (p.color === undefined || !p.endpoint) return { pol: p, up: false, why: "no color / end-point configured", cands: [] };
  const cands = [...p.cands].sort((a, b) => b.pref - a.pref).map((k): SpCandEval => {
    if (k.kind === "explicit") {
      const segs = k.list ? c.R1.lists[k.list] : undefined;
      if (!segs || !segs.length) return { cand: k, valid: false, why: k.list ? `segment-list ${k.list} is not defined` : "no segment list", labels: [] };
      const r = resolveList(c, table, segs);
      if (r.why) return { cand: k, valid: false, why: r.why, labels: r.labels };
      if (!table.R1.some((e) => e.label === r.labels[0] && e.kind !== "bsid")) return { cand: k, valid: false, why: `first SID ${r.labels[0]} is not resolvable at R1`, labels: r.labels };
      return { cand: k, valid: true, why: segs.every((x) => "addr" in x) ? "every hop resolved" : "first SID resolved (MPLS labels: the rest is not checked)", labels: r.labels };
    }
    if (!ep) return { cand: k, valid: false, why: `end-point ${p.endpoint} is not in the topology`, labels: [] };
    const d = spf(c, "R1", (u, i) => {
      const f = c[u].ifs[i.ifn]!;
      if (k.include?.length && !f.aff.some((a) => k.include!.includes(a))) return undefined;
      return f.metric;
    });
    if (!d.has(ep)) return { cand: k, valid: false, why: `no path to ${p.endpoint} with affinity include-any ${k.include?.join(", ") ?? "—"}`, labels: [] };
    const path = pathTo(d, ep);
    return { cand: k, valid: true, why: `CSPF path ${path.join(" → ")}, metric ${d.get(ep)!.cost}`, labels: encodePath(rib, path), path, cost: d.get(ep)!.cost };
  });
  const active = cands.find((x) => x.valid);
  return { pol: p, up: !!active, why: active ? undefined : "no valid candidate path", cands, active };
}
/** Resolve a segment list: addresses become Prefix-SIDs (loopbacks) or Adjacency SIDs (the remote end of an up adjacency). */
export function resolveList(c: SpCfg, table: Record<SpR, SpEntry[]>, segs: SpSeg[]): { labels: number[]; why?: string } {
  const labels: number[] = [];
  for (const x of [...segs].sort((a, b) => a.idx - b.idx)) {
    if ("label" in x) {
      labels.push(x.label);
      continue;
    }
    const lo = spRouterOfLo(x.addr);
    if (lo) {
      if (!c[lo].sr || c[lo].sid === undefined) return { labels, why: `${x.addr} has no Prefix-SID` };
      labels.push(SRGB.start + c[lo].sid!);
      continue;
    }
    const l = SP_LINKS.find((k) => spLinkIp(k, k.a) === x.addr || spLinkIp(k, k.b) === x.addr);
    if (!l) return { labels, why: `${x.addr} is not in the topology` };
    const to = spLinkIp(l, l.a) === x.addr ? l.a : l.b;
    const from = to === l.a ? l.b : l.a;
    if (!spAdjUp(c, l) || !table[from].some((e) => e.kind === "adj" && e.to === to)) return { labels, why: `no adjacency ${from} → ${to} (${x.addr}): link ${l.id} is down` };
    labels.push(adjLabel(from, to));
  }
  return { labels };
}
export const segText = (x: SpSeg) => ("addr" in x ? `address ipv4 ${x.addr}` : `mpls label ${x.label}`);
export const spEntry = (v: SpView, r: SpR, label: number) => v.table[r].find((e) => e.label === label);
/** Is this candidate the active one? (By identity of preference and kind: snapshots are deep copies.) */
export const isActive = (p: SpPolEval | undefined, k: SpCandEval) => !!p?.active && p.active.cand.pref === k.cand.pref && p.active.cand.kind === k.cand.kind;
/** The policy a BGP route is steered into, if any: color matches, end-point = next hop, policy up. */
export function steering(c: SpCfg, v: SpView, h: SpHost): { pol?: SpPolEval; colored: boolean; why: string } {
  const host = SP_HOSTS[h];
  const colored = host.colored && !!c.R6.colorOut;
  if (!colored) return { colored, why: host.colored ? "R6 no longer colors the route (no color community)" : "the route carries no color" };
  const nh = SP_LO[host.r];
  const pol = v.pols.find((p) => p.pol.color === COLOR && p.pol.endpoint === nh);
  if (!pol) return { colored, why: `no SR policy for color ${COLOR}, end-point ${nh}` };
  if (!pol.up) return { colored, pol, why: `SR policy ${pol.pol.name} is down (no valid candidate path)` };
  return { colored, pol, why: `steered into SR policy ${pol.pol.name} (color ${COLOR}, end-point ${nh})` };
}

// ---------------------------------------------------------------------------------------------------------------
// The data plane
// ---------------------------------------------------------------------------------------------------------------
interface Hop {
  from: string;
  to: string;
  labels: number[];
  note: string;
}
export interface SpWalk {
  hops: Hop[];
  ok: boolean;
  at: string;
  why?: string;
  path: string[];
  steered?: string;
}
const hostOf = (ip: string): SpHost | undefined => (Object.keys(SP_HOSTS) as SpHost[]).find((h) => SP_HOSTS[h].ip === ip);
export function spWalk(c: SpCfg, v: SpView, start: SpR, stack0: number[], dst: string): SpWalk {
  const w: SpWalk = { hops: [], ok: false, at: start, path: [start] };
  let r: SpR = start;
  let stack = [...stack0];
  const send = (nh: SpNh, note: string) => {
    w.hops.push({ from: r, to: nh.nh, labels: [...stack], note });
    r = nh.nh;
    w.path.push(r);
  };
  for (let ttl = 0; ttl < 24; ttl++) {
    w.at = r;
    if (stack.length) {
      const top = stack[0];
      const e = spEntry(v, r, top);
      if (!e) {
        w.why = `${r} has no entry for label ${top}${v.table[r].length ? "" : ` (${r} is not SR-capable)`} — dropped`;
        return w;
      }
      if (e.kind === "bsid") {
        stack = [...e.list!, ...stack.slice(1)];
        w.hops.push({ from: r, to: r, labels: [...stack], note: `${r}: ${top} is the binding SID of policy ${e.policy} → replaced by its active segment list [${e.list!.join(", ")}]` });
        continue;
      }
      if (e.kind === "adj") {
        stack = stack.slice(1);
        send(e.nh!, `${r}: ${top} is its Adjacency SID toward ${e.to} → pop, out ${e.nh!.ifn}`);
        continue;
      }
      if (e.own) {
        stack = stack.slice(1);
        w.hops.push({ from: r, to: r, labels: [...stack], note: `${r}: ${top} is its own Node SID → pop${stack.length ? `, the next segment is ${stack[0]}` : ""}` });
        continue;
      }
      if (e.out === "Unlabelled") {
        stack = stack.slice(1);
        send(e.nh!, `${r}: ${top} → Unlabelled (${e.why}), out ${e.nh!.ifn}`);
        continue;
      }
      if (e.out === "Pop") {
        stack = stack.slice(1);
        send(e.nh!, `${r}: ${top} = Node SID of ${e.to}, next hop owns it → pop (PHP), out ${e.nh!.ifn}`);
        continue;
      }
      stack = [e.out!, ...stack.slice(1)];
      send(e.nh!, `${r}: ${top} = Node SID of ${e.to} → swap to ${e.out}, out ${e.nh!.ifn}`);
      continue;
    }
    const lo = spRouterOfLo(dst);
    if (lo === r) {
      w.ok = true;
      return w;
    }
    const h = hostOf(dst);
    if (h && SP_HOSTS[h].r === r) {
      w.hops.push({ from: r, to: h, labels: [], note: `${r}: ${dst} is on its LAN → delivered to ${h}` });
      w.path.push(h);
      w.at = h;
      w.ok = true;
      return w;
    }
    if (lo) {
      const rt = v.rib[r].find((x) => x.dst === lo);
      if (!rt?.nh) {
        w.why = `${r} has no route to ${dst} — dropped`;
        return w;
      }
      send(rt.nh, `${r}: IP to ${dst} via IS-IS, out ${rt.nh.ifn}`);
      continue;
    }
    if (h && (r === "R1" || r === "R6")) {
      const far = SP_HOSTS[h].r;
      if (r === "R1") {
        const st = steering(c, v, h);
        if (st.pol?.up) {
          stack = [...st.pol.active!.labels];
          w.steered = st.pol.pol.name;
          w.hops.push({ from: r, to: r, labels: [...stack], note: `${r}: ${dst} → BGP route with color ${COLOR}, next hop ${SP_LO[far]} → ${st.why}: push [${stack.join(", ")}] (${st.pol.active!.cand.kind}, preference ${st.pol.active!.cand.pref})` });
          continue;
        }
        if (st.colored) w.hops.push({ from: r, to: r, labels: [], note: `${r}: ${dst} carries color ${COLOR}, but ${st.why} → resolved over the next hop instead` });
      }
      const e = spEntry(v, r, SRGB.start + SP_IDX[far]);
      if (!e || e.out === undefined || e.out === "Unlabelled" || !e.nh) {
        w.why = `${r}: no label toward ${SP_LO[far]} for ${dst} — dropped`;
        return w;
      }
      stack = e.out === "Pop" ? [] : [e.out];
      send(e.nh, `${r}: ${dst} → BGP next hop ${SP_LO[far]} → push ${far}'s Node SID${e.out === "Pop" ? " (popped: next hop owns it)" : ` ${e.out}`}, out ${e.nh.ifn}`);
      continue;
    }
    w.why = `${r} has no route to ${dst} (the core runs no BGP) — dropped`;
    return w;
  }
  w.why = "TTL expired";
  return w;
}

// ---------------------------------------------------------------------------------------------------------------
// State and actions
// ---------------------------------------------------------------------------------------------------------------
export interface SpSnap {
  view: SpView;
}
export interface SpTest {
  id: number;
  kind: "ping" | "probe";
  from: string;
  dst: string;
  stack?: number[];
  ok: boolean;
  path: string[];
  steered?: string;
  why?: string;
  labels: number[][];
  cfgSeq: number;
  t: number;
}
export interface SpSys {
  t: number;
  dev: SpR;
  kind: "commit" | "adj-up" | "adj-down" | "policy-up" | "policy-down" | "cand-change";
  peer?: string;
}
export interface SpState extends SpBase<SpSnap> {
  cfg: SpCfg;
  hist: Record<SpR, SpRtr[]>;
  view: SpView;
  sys: SpSys[];
  tests: SpTest[];
}
export type SpTicketId = "pref" | "color" | "endpoint" | "srdisabled" | "listtypo";
export type SpAction =
  | { type: "cfg"; dev: SpR; cfg: SpRtr; text: string }
  | { type: "set"; changes: { dev: SpR; f: (c: SpRtr) => void }[]; text: string }
  | { type: "ping"; to: SpHost }
  | { type: "probe"; stack: number[] }
  | { type: "link"; id: string; up: boolean }
  | { type: "ticket"; id: SpTicketId };

const cl = (o: SpState): SpState => ({ ...spClone(o), runs: o.runs, last: o.last });
export function createSrpNet(seq = 0): SpState {
  const cfg = spHealthy();
  const view = spView(cfg);
  const s: SpState = { seq, cfgSeq: 0, clock: 3600, runs: [], log: [{ seq, t: 3600, text: "IS-IS with segment routing is up everywhere. R1 runs SR policy GOLD (color 100, end-point 10.0.0.6): the explicit candidate (preference 200) is active. R6 colors 192.168.6.0/24 with 100; 192.168.60.0/24 has no color.", tone: "info" }], cfg, hist: Object.fromEntries(SP_ROUTERS.map((r) => [r, []])) as unknown as Record<SpR, SpRtr[]>, view, sys: [], tests: [] };
  for (const l of SP_LINKS) s.sys.push({ t: 15, dev: l.a, kind: "adj-up", peer: l.b }, { t: 15, dev: l.b, kind: "adj-up", peer: l.a });
  s.sys.push({ t: 40, dev: "R1", kind: "policy-up", peer: "GOLD" });
  return s;
}
const color = (labels: number[]) => (labels.length > 1 ? "violet" : labels.length ? "cyan" : "green");
function record(s: SpState, kind: SpTest["kind"], cmd: string, from: string, dst: string, walks: { w: SpWalk; what: string }[], stack?: number[]) {
  const snap = { view: s.view };
  const moments: SpMoment<SpSnap>[] = [];
  for (const { w, what } of walks) {
    moments.push({ tokens: [], lines: [{ text: what, tone: "info" }], snap });
    for (const h of w.hops) moments.push({ tokens: h.from !== h.to ? [{ from: h.from, to: h.to, label: h.labels.length ? h.labels.join(" | ") : "IP", color: color(h.labels) }] : [], lines: [{ text: h.note, tone: h.labels.length ? "learn" : "info" }], snap });
    if (w.why) moments.push({ tokens: [], lines: [{ text: w.why, tone: "warn" }], snap });
  }
  const ok = walks.every((x) => x.w.ok);
  const why = walks.find((x) => !x.w.ok)?.w.why;
  const main = walks[0].w;
  moments.push({ tokens: [], lines: [{ text: ok ? `${cmd}: success — path ${main.path.join(" → ")}${main.steered ? ` (policy ${main.steered})` : ""}.` : `${cmd}: failed — ${why}`, tone: ok ? "ok" : "bad" }], snap });
  const t: SpTest = { id: s.tests.length + 1, kind, from, dst, stack, ok, path: main.path, steered: main.steered, why, labels: main.hops.filter((h) => h.from !== h.to).map((h) => h.labels), cfgSeq: s.cfgSeq, t: s.clock };
  s.tests = [...s.tests, t].slice(-40);
  const run: SpRun<SpSnap> = { id: s.runs.length + 1 + s.seq * 1000, cmd, kind: "test", moments, ok };
  s.runs = [...s.runs, run];
  s.last = run;
  s.log = [...s.log, { seq: s.seq, t: s.clock, text: `${cmd}: ${ok ? `success (${main.path.join(" → ")}${main.steered ? `, policy ${main.steered}` : ""})` : why}`, tone: ok ? "ok" : "warn" }];
  return s;
}
export function srpPing(s0: SpState, to: SpHost): SpState {
  const s = cl(s0);
  s.clock += 2;
  const go = spWalk(s.cfg, s.view, "R1", [], SP_HOSTS[to].ip);
  go.hops.unshift({ from: "H1", to: "R1", labels: [], note: `H1 sends an echo request to ${SP_HOSTS[to].ip}` });
  go.path.unshift("H1");
  const walks = [{ w: go, what: `H1 → ${SP_HOSTS[to].ip} (${to}${SP_HOSTS[to].colored ? ", the GOLD application" : ", default traffic"})` }];
  if (go.ok) {
    const back = spWalk(s.cfg, s.view, "R6", [], SP_HOSTS.H1.ip);
    back.hops.unshift({ from: to, to: "R6", labels: [], note: `${to} answers ${SP_HOSTS.H1.ip}` });
    back.path.unshift(to);
    walks.push({ w: back, what: `${to} → ${SP_HOSTS.H1.ip}: the echo reply (no policy on the way back)` });
  }
  return record(s, "ping", `ping ${SP_HOSTS[to].ip} from H1`, "H1", SP_HOSTS[to].ip, walks);
}
export function srpProbe(s0: SpState, stack: number[]): SpState {
  const s = cl(s0);
  s.clock += 2;
  const w = spWalk(s.cfg, s.view, "R1", stack, SP_LO.R6);
  return record(s, "probe", `R1 sends to 10.0.0.6 with [${stack.join(", ")}]`, "R1", SP_LO.R6, [{ w, what: `R1 imposes [${stack.join(", ")}] and executes the first segment itself.` }], stack);
}
function converge(prev: SpState, s: SpState, why: string, show = true): SpState {
  const view = spView(s.cfg);
  s.view = view;
  const snap = { view };
  const moments: SpMoment<SpSnap>[] = [];
  for (const l of SP_LINKS)
    if (prev.view.adj[l.id] !== view.adj[l.id]) {
      moments.push({ tokens: view.adj[l.id] ? [{ from: l.a, to: l.b, label: "IIH", color: "cyan" }] : [], lines: [{ text: `IS-IS ${l.a}–${l.b} ${view.adj[l.id] ? "Up" : "goes down"}.`, tone: view.adj[l.id] ? "ok" : "bad" }], snap });
      s.sys.push({ t: s.clock, dev: l.a, kind: view.adj[l.id] ? "adj-up" : "adj-down", peer: l.b }, { t: s.clock, dev: l.b, kind: view.adj[l.id] ? "adj-up" : "adj-down", peer: l.a });
    }
  const lines: { text: string; tone: "ok" | "bad" | "learn" }[] = [];
  for (const p of view.pols) {
    const was = prev.view.pols.find((x) => x.pol.name === p.pol.name);
    if (!was || was.up !== p.up) {
      lines.push({ text: `SR policy ${p.pol.name} (color ${p.pol.color ?? "—"}, end-point ${p.pol.endpoint ?? "—"}) is ${p.up ? "up" : `down — ${p.why}`}.`, tone: p.up ? "ok" : "bad" });
      s.sys.push({ t: s.clock, dev: "R1", kind: p.up ? "policy-up" : "policy-down", peer: p.pol.name });
    }
    for (const k of p.cands) {
      const wk = was?.cands.find((x) => x.cand.pref === k.cand.pref && x.cand.kind === k.cand.kind);
      if (wk && wk.valid !== k.valid) lines.push({ text: `${p.pol.name}: candidate preference ${k.cand.pref} (${k.cand.kind}) is now ${k.valid ? "valid" : `invalid — ${k.why}`}.`, tone: k.valid ? "ok" : "bad" });
      else if (wk && k.valid && wk.labels.join() !== k.labels.join()) lines.push({ text: `${p.pol.name}: candidate preference ${k.cand.pref} recomputed → [${k.labels.join(", ")}] (${k.why}).`, tone: "learn" });
    }
    const a = p.active ? `${p.active.cand.pref}/${p.active.cand.kind}` : "";
    const b = was?.active ? `${was.active.cand.pref}/${was.active.cand.kind}` : "";
    if (was && a !== b && p.active) {
      lines.push({ text: `${p.pol.name}: the active candidate is now preference ${p.active.cand.pref} (${p.active.cand.kind}) — [${p.active.labels.join(", ")}].`, tone: "learn" });
      s.sys.push({ t: s.clock, dev: "R1", kind: "cand-change", peer: p.pol.name });
    }
  }
  for (const p of prev.view.pols) if (!view.pols.some((x) => x.pol.name === p.pol.name)) lines.push({ text: `SR policy ${p.pol.name} removed.`, tone: "bad" });
  if (lines.length) moments.push({ tokens: [], lines: lines.slice(0, 10), snap });
  if (show && moments.length) {
    const run: SpRun<SpSnap> = { id: s.runs.length + 1 + s.seq * 1000, cmd: why, kind: "converge", moments };
    s.runs = [...s.runs, run];
    s.last = run;
  }
  return s;
}

// ---------------------------------------------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------------------------------------------
export interface SpTicketDef {
  id: SpTicketId;
  title: string;
  report: string;
  reproLabel: string;
  repro: SpAction[];
  fault: (c: SpCfg) => void;
}
export const SP_TICKETS: SpTicketDef[] = [
  {
    id: "pref",
    title: "Not the engineered path",
    report: "“GOLD traffic reaches H6, no loss. But the capture on R1's link to R3 doesn't show the planned stack [16003, 24035, 16006]. Policy GOLD is up.”",
    reproLabel: "ping 192.168.6.20 from H1",
    repro: [{ type: "ping", to: "H6" }],
    fault: (c) => {
      c.R1.policies[0].cands[0].pref = 80;
    },
  },
  {
    id: "color",
    title: "GOLD on the default path",
    report: "“Since R6's BGP template was cleaned up, the GOLD application to 192.168.6.20 runs over R2 and R4 like everything else. Policy GOLD on R1 is up.”",
    reproLabel: "ping 192.168.6.20 from H1",
    repro: [{ type: "ping", to: "H6" }],
    fault: (c) => {
      c.R6.colorOut = false;
    },
  },
  {
    id: "endpoint",
    title: "After the policy was re-created",
    report: "“Policy GOLD on R1 was deleted and re-created from notes. It's up, R6 still colors the route, but GOLD traffic now takes R2 and R4.”",
    reproLabel: "ping 192.168.6.20 from H1",
    repro: [{ type: "ping", to: "H6" }],
    fault: (c) => {
      c.R1.policies[0].endpoint = "10.0.0.66";
    },
  },
  {
    id: "srdisabled",
    title: "Only GOLD is broken",
    report: "“After maintenance on R5, H1 can't reach the GOLD server 192.168.6.20 — but 192.168.60.20 works, and policy GOLD on R1 says it's up.”",
    reproLabel: "ping 192.168.6.20 from H1",
    repro: [{ type: "ping", to: "H6" }],
    fault: (c) => {
      c.R5.sr = false;
    },
  },
  {
    id: "listtypo",
    title: "A segment list from the change ticket",
    report: "“The GOLD segment list was re-typed from the change ticket, with MPLS labels instead of addresses. The policy is up with its explicit path active, yet GOLD traffic to 192.168.6.20 is lost. Default traffic is fine.”",
    reproLabel: "ping 192.168.6.20 from H1",
    repro: [{ type: "ping", to: "H6" }],
    fault: (c) => {
      c.R1.lists["GOLD-EXPLICIT"] = [{ idx: 10, label: 16003 }, { idx: 20, label: 24053 }, { idx: 30, label: 16006 }];
    },
  },
];
export const spTicket = (id: string) => SP_TICKETS.find((t) => t.id === id)!;
export function srpTicketState(id: SpTicketId, seq = 0): SpState {
  const s = createSrpNet(seq);
  const nx = cl(s);
  spTicket(id).fault(nx.cfg);
  const out = converge(s, nx, "", false);
  out.ticket = id;
  out.runs = [];
  out.last = undefined;
  out.log = [...out.log, { seq, t: out.clock, text: `Ticket opened: ${spTicket(id).title}.`, tone: "warn" }];
  return out;
}
export function srpApply(s0: SpState, a: SpAction): SpState {
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
      const l = SP_LINKS.find((x) => x.id === a.id)!;
      const s = cl(s0);
      s.cfg[l.a].ifs[l.ai]!.isis = a.up;
      s.cfg[l.b].ifs[l.bi]!.isis = a.up;
      s.cfgSeq += 1;
      s.clock += 1;
      s.log = [...s.log, { seq: s.seq, t: s.clock, text: `${l.id} ${a.up ? "back up" : "fails"}.`, tone: a.up ? "ok" : "warn" }];
      return converge(s0, s, `${l.id} ${a.up ? "restored" : "fails"}`);
    }
    case "ping":
      return srpPing(s0, a.to);
    case "probe":
      return srpProbe(s0, a.stack);
    case "ticket":
      return srpTicketState(a.id, s0.seq + 1);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Diagnosis, proofs, ladder
// ---------------------------------------------------------------------------------------------------------------
export const SP_CAUSES: { id: string; label: string }[] = [
  { id: "pref", label: "The explicit candidate's preference is below the dynamic one" },
  { id: "color", label: "The route no longer carries color 100" },
  { id: "endpoint", label: "The policy's end-point doesn't match the route's next hop" },
  { id: "srdisabled", label: "A router on the explicit path has no segment routing" },
  { id: "listtypo", label: "The explicit segment list contains a wrong label" },
  { id: "rsvp", label: "The policy's path state was lost on a transit router" },
  { id: "affinity", label: "A link lost its GOLD affinity" },
];
const lastTest = (s: SpState) => s.tests[s.tests.length - 1];
export const goldPol = (s: SpState) => s.view.pols.find((p) => p.pol.name === "GOLD");
export function srpCauseFeedback(s: SpState, cause: string): { right: boolean; text: string } {
  const t = s.ticket as SpTicketId | undefined;
  if (cause === t) {
    const txt: Record<SpTicketId, string> = {
      pref: "Yes. The explicit candidate's preference is 80, below the dynamic candidate's 100. Both are valid, so the dynamic one is active: same physical path, but encoded [16005, 16006]. Nothing is broken — the policy simply does what its preferences say.",
      color: "Yes. R6's cleaned-up template dropped the route-policy that sets color 100 on 192.168.6.0/24. R1 still has policy GOLD up, but no route asks for color 100: the GOLD prefix resolves over R6's Node SID like everything else.",
      endpoint: "Yes. The re-created policy's end-point is 10.0.0.66. The colored route's next hop is 10.0.0.6, so (100, 10.0.0.6) matches no policy and the route resolves normally. The policy is up — for an end-point nobody uses.",
      srdisabled: "Yes. R5 lost segment routing. The explicit list still validates (only its first SID is checked at the headend), so the policy stays up — but after R3's Adjacency SID the packet reaches R5 with 16006 on top, and R5 has no label table. Default traffic never touches R5.",
      listtypo: "Yes. The re-typed list says 24053 — R5's Adjacency SID toward R3 — instead of 24035. With MPLS labels R1 validates only the first SID, so the policy stays up; R3 receives 24053, has no such label, and drops the packet. Addresses would have been validated hop by hop.",
    };
    return { right: true, text: txt[t] };
  }
  switch (cause) {
    case "rsvp":
      return { right: false, text: "SR policies keep no state on transit routers — that was RSVP-TE. Everything is in the headend and the packet." };
    case "affinity":
      return { right: false, text: "Every link keeps its affinities; the dynamic candidate computes the same GOLD path as before." };
    case "pref":
      return { right: false, text: "The explicit candidate has preference 200, above the dynamic 100." };
    case "color":
      return { right: false, text: "R6 still sets color 100 on 192.168.6.0/24." };
    case "endpoint":
      return { right: false, text: "The policy's end-point is 10.0.0.6, the route's next hop." };
    case "srdisabled":
      return { right: false, text: "Every router runs segment routing." };
    case "listtypo":
      return { right: false, text: "The segment list resolves to the planned [16003, 24035, 16006]." };
  }
  return { right: false, text: lastTest(s) ? "That doesn't match the evidence." : "Run the user's test first." };
}
export function srpProofs(s: SpState): { label: string; ok: boolean; detail: string }[] {
  const t = s.ticket as SpTicketId | undefined;
  if (!t) return [];
  const fresh = s.tests.filter((x) => x.cfgSeq === s.cfgSeq && x.kind === "ping" && x.dst === SP_HOSTS.H6.ip);
  const g = goldPol(s);
  const viaExplicit = fresh.some((x) => x.ok && x.steered === "GOLD" && x.labels.some((l) => l.join() === "24035,16006"));
  const proof = { label: "A fresh ping to 192.168.6.20 rides the explicit path", ok: viaExplicit, detail: "ping again after the fix: R1 → R3 carries [24035, 16006]" };
  switch (t) {
    case "pref":
      return [{ label: "The explicit candidate (preference above 100) is active", ok: g?.active?.cand.kind === "explicit", detail: "show segment-routing traffic-eng policy color 100 on R1" }, proof];
    case "color":
      return [{ label: "192.168.6.0/24 carries color 100 again", ok: !!s.cfg.R6.colorOut, detail: "show bgp ipv4 unicast 192.168.6.0/24 on R1" }, proof];
    case "endpoint":
      return [{ label: "Policy GOLD's end-point is 10.0.0.6", ok: g?.pol.endpoint === SP_LO.R6, detail: "show segment-routing traffic-eng policy on R1" }, proof];
    case "srdisabled":
      return [{ label: "R5 programs 16006 again", ok: !!spEntry(s.view, "R5", 16006), detail: "show mpls forwarding on R5" }, proof];
    case "listtypo":
      return [{ label: "GOLD-EXPLICIT resolves to [16003, 24035, 16006]", ok: resolveList(s.cfg, s.view.table, s.cfg.R1.lists["GOLD-EXPLICIT"] ?? []).labels.join() === "16003,24035,16006", detail: "show segment-routing traffic-eng policy on R1" }, proof];
  }
}
export function srpLadder(s: SpState): { k: string; title: string; text: string }[] {
  const t = lastTest(s);
  const v = s.view;
  const g = goldPol(s);
  const notSr = SP_ROUTERS.filter((r) => !s.cfg[r].sr);
  const st = steering(s.cfg, v, "H6");
  return [
    { k: "test", title: "What did the test show?", text: t ? `${t.kind === "ping" ? `ping ${t.dst}` : `[${t.stack?.join(", ")}]`}: ${t.ok ? `success via ${t.path.join(" → ")}${t.steered ? ` (policy ${t.steered})` : " (not steered)"}` : t.why}.` : "Run the user's test first." },
    { k: "sr", title: "Is IS-IS up and every router SR-capable?", text: `${SP_LINKS.filter((l) => !v.adj[l.id]).map((l) => `${l.id} down`).join(", ") || "Every adjacency up"}; ${notSr.length ? `no segment routing on ${notSr.join(", ")}` : "segment routing on every router"}.` },
    { k: "policy", title: "Is policy GOLD up, with the right color and end-point?", text: g ? `${g.up ? "Up" : `Down — ${g.why}`}; color ${g.pol.color ?? "none"}, end-point ${g.pol.endpoint ?? "none"}, BSID ${g.pol.bsid ?? "none"}.` : "No policy GOLD." },
    { k: "cands", title: "Which candidates are valid, which is active?", text: g ? g.cands.map((k) => `preference ${k.cand.pref} ${k.cand.kind}: ${k.valid ? "valid" : `invalid (${k.why})`}${isActive(g, k) ? " — ACTIVE" : ""} [${k.labels.join(", ")}]`).join(" · ") : "—" },
    { k: "steer", title: "Is the GOLD route steered into the policy?", text: `${st.colored ? "192.168.6.0/24 carries color 100" : "192.168.6.0/24 has no color"}: ${st.why}.` },
    { k: "labels", title: "Does every label in the active list exist where it is executed?", text: (() => { if (!g?.active) return "No active list."; const w = spWalk(s.cfg, v, "R1", g.active.labels, SP_LO.R6); return w.ok ? `Yes: [${g.active.labels.join(", ")}] reaches R6 via ${w.path.join(" → ")}.` : `No: ${w.why}.`; })() },
  ];
}
