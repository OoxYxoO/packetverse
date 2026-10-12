import { spClone, type SpBase, type SpMoment, type SpRun } from "@/components/sp-lab/spKit";

/**
 * SR-MPLS Lab network — the guided lesson's diamond, running IS-IS with Segment Routing and no LDP.
 *
 *            R2 ──10── R4                 top path R1–R2–R4–R6: metric 10 per link (30)
 *        10 ╱            ╲ 10             bottom path R1–R3–R5–R6: metric 15 per link (45)
 *   H1 ── R1              R6 ── H6        H1 192.168.1.10 behind R1, H6 192.168.6.20 behind R6
 *        15 ╲            ╱ 15
 *            R3 ──15── R5
 *
 * Loopbacks 10.0.0.N (Rn), prefix-SID index N, SRGB 16000–23999 (index range 8000) on every router: Node SID labels
 * 16001…16006, exactly as in the guided lesson. Links 10.1.XY.0/24 (Rx .X, Ry .Y). R1 and R6 exchange the two customer
 * prefixes by iBGP between loopbacks; R2–R5 run no BGP, so customer traffic must be labeled.
 *
 * Modeled (RFC 8402, RFC 8660 SR-MPLS, RFC 8667 IS-IS SR extensions):
 * - IS-IS L2 adjacency when both ends run IS-IS on the link; SPF on outgoing metrics (deterministic first next hop).
 * - A router is SR-capable when SR is enabled (IOS XR `segment-routing mpls` under the IS-IS address family, Junos
 *   `source-packet-routing`) and it has an SRGB (IOS XR default 16000–23999; Junos `srgb start-label … index-range …`).
 *   It advertises its SRGB in the Router Capability TLV and a Prefix-SID (index) for its loopback.
 * - Two routers claiming one index: the RFC 8660 tie-breaks end with the numerically smaller prefix, so 10.0.0.5 keeps
 *   the index and 10.0.0.6 has none.
 * - Label table (per router): for every Prefix-SID whose index fits the router's SRGB, local label = own SRGB start +
 *   index; outgoing label = next hop's SRGB start + index, or pop (PHP) when the next hop owns the SID. Next hop not
 *   SR-capable, or index outside its SRGB: IOS XR programs "Unlabelled" (the label is removed, the packet continues as
 *   IP); Junos programs nothing. Adjacency SIDs: one per adjacency, locally significant (IOS XR dynamic 24000 +
 *   10 × own index + neighbor index as in the guided lesson; Junos from 299776 the same way): pop, out of that link.
 * - Data plane: R1 resolves 192.168.6.0/24 (BGP next hop 10.0.0.6) over R6's Node SID — IOS XR falls back to plain IP
 *   when there is no SR label; Junos needs the next hop in inet.3, otherwise the route is unusable. Every hop acts on
 *   the top label only. A segment list sent from R1 is executed from its first segment at R1 itself; a label R1 does
 *   not own or know is dropped there. IOS XR `ping sr-mpls nil-fec labels …` imposes the whole list on an interface.
 */

export type SrR = "R1" | "R2" | "R3" | "R4" | "R5" | "R6";
export const SR_ROUTERS: SrR[] = ["R1", "R2", "R3", "R4", "R5", "R6"];
export const SR_IDX: Record<SrR, number> = { R1: 1, R2: 2, R3: 3, R4: 4, R5: 5, R6: 6 };
export const SR_LO: Record<SrR, string> = { R1: "10.0.0.1", R2: "10.0.0.2", R3: "10.0.0.3", R4: "10.0.0.4", R5: "10.0.0.5", R6: "10.0.0.6" };
export type SrOs = "xr" | "junos";
export type IfName = "ge-0/0/0" | "ge-0/0/1" | "ge-0/0/2";
export const IMPLICIT_NULL = 3;
export const SRGB0 = { start: 16000, range: 8000 };
export const HOSTS = { H1: { ip: "192.168.1.10", net: "192.168.1.0", gw: "192.168.1.1", r: "R1" as SrR }, H6: { ip: "192.168.6.20", net: "192.168.6.0", gw: "192.168.6.1", r: "R6" as SrR } };
export type SrHost = keyof typeof HOSTS;
export const LAN_IF: IfName = "ge-0/0/2";

export interface SrLink {
  id: string;
  a: SrR;
  ai: IfName;
  b: SrR;
  bi: IfName;
  metric: number;
}
export const SR_LINKS: SrLink[] = [
  { id: "R1-R2", a: "R1", ai: "ge-0/0/0", b: "R2", bi: "ge-0/0/0", metric: 10 },
  { id: "R2-R4", a: "R2", ai: "ge-0/0/1", b: "R4", bi: "ge-0/0/0", metric: 10 },
  { id: "R4-R6", a: "R4", ai: "ge-0/0/1", b: "R6", bi: "ge-0/0/0", metric: 10 },
  { id: "R1-R3", a: "R1", ai: "ge-0/0/1", b: "R3", bi: "ge-0/0/0", metric: 15 },
  { id: "R3-R5", a: "R3", ai: "ge-0/0/1", b: "R5", bi: "ge-0/0/0", metric: 15 },
  { id: "R5-R6", a: "R5", ai: "ge-0/0/1", b: "R6", bi: "ge-0/0/1", metric: 15 },
];
export const linkIp = (l: SrLink, r: SrR) => `10.1.${SR_IDX[l.a]}${SR_IDX[l.b]}.${SR_IDX[r]}`;
export interface SrIfInfo {
  ifn: IfName;
  ip: string;
  peer: SrR;
  peerIf: IfName;
  peerIp: string;
  link: SrLink;
}
export function srIfs(r: SrR): SrIfInfo[] {
  return SR_LINKS.flatMap((l) => (l.a === r ? [{ ifn: l.ai, ip: linkIp(l, r), peer: l.b, peerIf: l.bi, peerIp: linkIp(l, l.b), link: l }] : l.b === r ? [{ ifn: l.bi, ip: linkIp(l, r), peer: l.a, peerIf: l.ai, peerIp: linkIp(l, l.a), link: l }] : [])).sort((x, y) => x.ifn.localeCompare(y.ifn));
}
export const srIfTo = (r: SrR, peer: SrR) => srIfs(r).find((i) => i.peer === peer);
export const routerOfLo = (ip: string) => SR_ROUTERS.find((r) => SR_LO[r] === ip);

// ---------------------------------------------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------------------------------------------
export interface SrIf {
  isis: boolean;
  metric: number;
  /** Junos: family mpls on unit 0 (IOS XR needs no MPLS interface configuration for SR-MPLS). */
  fam: boolean;
  /** Junos: the interface under protocols mpls. */
  mplsIf: boolean;
}
export interface SrRtr {
  /** Loopback0 / lo0.0 in IS-IS (passive). */
  lo: boolean;
  /** IOS XR `segment-routing mpls` under the IS-IS IPv4 address family; Junos `protocols isis source-packet-routing`. */
  sr: boolean;
  /** The SRGB (IOS XR `segment-routing global-block`, default 16000–23999; Junos `srgb start-label … index-range …`). */
  srgb?: { start: number; range: number };
  /** Prefix-SID index of the loopback (IOS XR `prefix-sid index`, Junos `node-segment ipv4-index`). */
  sid?: number;
  ifs: Partial<Record<IfName, SrIf>>;
}
export type SrCfg = Record<SrR, SrRtr>;
export function srHealthy(): SrCfg {
  const c = {} as SrCfg;
  for (const r of SR_ROUTERS) {
    const ifs: Partial<Record<IfName, SrIf>> = {};
    for (const i of srIfs(r)) ifs[i.ifn] = { isis: true, metric: i.link.metric, fam: true, mplsIf: true };
    c[r] = { lo: true, sr: true, srgb: { ...SRGB0 }, sid: SR_IDX[r], ifs };
  }
  return c;
}
/** The SRGB in force: IOS XR falls back to its default block when none is configured. */
export const srgbOf = (c: SrRtr, os: SrOs) => (c.srgb ?? (os === "xr" ? SRGB0 : undefined));
export const srCapable = (c: SrRtr, os: SrOs) => c.sr && !!srgbOf(c, os);
export const ifMpls = (c: SrRtr, os: SrOs, ifn: IfName) => os === "xr" || (!!c.ifs[ifn]?.fam && !!c.ifs[ifn]?.mplsIf);

// ---------------------------------------------------------------------------------------------------------------
// Derived state
// ---------------------------------------------------------------------------------------------------------------
export interface SrNh {
  nh: SrR;
  ifn: IfName;
  ip: string;
}
export interface SrRoute {
  dst: SrR;
  cost: number;
  nh?: SrNh;
  path: SrR[];
}
export interface SrSid {
  index: number;
  owner: SrR;
  prefix: string;
  /** Lost an index conflict: advertised, but no router uses it. */
  lost?: SrR;
}
export type SrOut = number | "Pop" | "Unlabelled";
export interface SrEntry {
  label: number;
  kind: "pfx" | "adj";
  /** Prefix SID: the owner; adjacency SID: the neighbor. */
  to: SrR;
  index?: number;
  own?: boolean;
  out?: SrOut;
  nh?: SrNh;
  why?: string;
}
export interface SrView {
  adj: Record<string, boolean>;
  rib: Record<SrR, SrRoute[]>;
  sids: SrSid[];
  conflicts: { index: number; winner: SrR; loser: SrR }[];
  table: Record<SrR, SrEntry[]>;
  /** Why a router has no label for a prefix SID (out of range, not SR-capable…). */
  missing: Record<SrR, { index: number; owner: SrR; why: string }[]>;
}
export const adjUp = (c: SrCfg, l: SrLink) => !!c[l.a].ifs[l.ai]?.isis && !!c[l.b].ifs[l.bi]?.isis;
export const adjSidLabel = (os: SrOs, r: SrR, n: SrR) => (os === "xr" ? 24000 : 299776) + 10 * SR_IDX[r] + SR_IDX[n];

function spf(c: SrCfg, root: SrR): SrRoute[] {
  const dist: Partial<Record<SrR, number>> = { [root]: 0 };
  const first: Partial<Record<SrR, SrNh>> = {};
  const prev: Partial<Record<SrR, SrR>> = {};
  const done = new Set<SrR>();
  while (done.size < SR_ROUTERS.length) {
    const u = SR_ROUTERS.filter((r) => !done.has(r) && dist[r] !== undefined).sort((a, b) => dist[a]! - dist[b]! || SR_IDX[a] - SR_IDX[b])[0];
    if (!u) break;
    done.add(u);
    for (const i of srIfs(u)) {
      if (!adjUp(c, i.link)) continue;
      const d = dist[u]! + (c[u].ifs[i.ifn]?.metric ?? 10);
      if (dist[i.peer] === undefined || d < dist[i.peer]!) {
        dist[i.peer] = d;
        prev[i.peer] = u;
        first[i.peer] = u === root ? { nh: i.peer, ifn: i.ifn, ip: i.peerIp } : first[u];
      }
    }
  }
  return SR_ROUTERS.filter((r) => dist[r] !== undefined && r !== root && c[r].lo).map((r) => {
    const path: SrR[] = [r];
    let x = r;
    while (prev[x]) path.unshift((x = prev[x]!));
    return { dst: r, cost: dist[r]! + 0, nh: first[r], path };
  });
}
export function srView(c: SrCfg, os: SrOs): SrView {
  const adj: Record<string, boolean> = {};
  for (const l of SR_LINKS) adj[l.id] = adjUp(c, l);
  const rib = {} as Record<SrR, SrRoute[]>;
  for (const r of SR_ROUTERS) rib[r] = spf(c, r);
  // Prefix-SIDs and conflicts
  const claims = SR_ROUTERS.filter((r) => srCapable(c[r], os) && c[r].sid !== undefined && c[r].lo);
  const sids: SrSid[] = [];
  const conflicts: SrView["conflicts"] = [];
  for (const r of claims) {
    const idx = c[r].sid!;
    const other = claims.find((x) => x !== r && c[x].sid === idx);
    if (other) {
      const winner = SR_IDX[r] < SR_IDX[other] ? r : other;
      if (winner !== r) {
        sids.push({ index: idx, owner: r, prefix: SR_LO[r], lost: winner });
        if (!conflicts.some((x) => x.index === idx)) conflicts.push({ index: idx, winner, loser: r });
        continue;
      }
    }
    sids.push({ index: idx, owner: r, prefix: SR_LO[r] });
  }
  const table = {} as Record<SrR, SrEntry[]>;
  const missing = {} as SrView["missing"];
  for (const r of SR_ROUTERS) {
    table[r] = [];
    missing[r] = [];
    const g = srgbOf(c[r], os);
    if (!srCapable(c[r], os) || !g) continue;
    for (const s of sids.filter((x) => !x.lost)) {
      if (s.index >= g.range) {
        missing[r].push({ index: s.index, owner: s.owner, why: `index ${s.index} is outside ${r}'s SRGB (${g.start}–${g.start + g.range - 1})` });
        continue;
      }
      const label = g.start + s.index;
      if (s.owner === r) {
        table[r].push({ label, kind: "pfx", to: r, index: s.index, own: true });
        continue;
      }
      const rt = rib[r].find((x) => x.dst === s.owner);
      if (!rt?.nh) {
        missing[r].push({ index: s.index, owner: s.owner, why: `no IS-IS route to ${s.prefix}` });
        continue;
      }
      const n = rt.nh.nh;
      const ng = srgbOf(c[n], os);
      let out: SrOut | undefined;
      let why: string | undefined;
      if (!ifMpls(c[r], os, rt.nh.ifn)) why = `${rt.nh.ifn} is not enabled for MPLS (family mpls / protocols mpls)`;
      else if (n === s.owner) out = "Pop";
      else if (!srCapable(c[n], os) || !ng) why = `next hop ${n} is not SR-capable`;
      else if (s.index >= ng.range) why = `index ${s.index} is outside next hop ${n}'s SRGB`;
      else out = ng.start + s.index;
      if (out === undefined && os === "xr") out = "Unlabelled";
      if (out === undefined) {
        missing[r].push({ index: s.index, owner: s.owner, why: why! });
        continue;
      }
      table[r].push({ label, kind: "pfx", to: s.owner, index: s.index, out, nh: rt.nh, why });
    }
    for (const i of srIfs(r)) if (adj[i.link.id] && ifMpls(c[r], os, i.ifn)) table[r].push({ label: adjSidLabel(os, r, i.peer), kind: "adj", to: i.peer, out: "Pop", nh: { nh: i.peer, ifn: i.ifn, ip: i.peerIp } });
    table[r].sort((a, b) => a.label - b.label);
  }
  return { adj, rib, sids, conflicts, table, missing };
}
export const sidOf = (v: SrView, r: SrR) => v.sids.find((s) => s.owner === r && !s.lost);
export const entry = (v: SrView, r: SrR, label: number) => v.table[r].find((e) => e.label === label);
/** How R1 (or R6) sends a packet to the other's BGP next hop: the label it pushes, or IP, or nothing. */
export function resolveNh(v: SrView, c: SrCfg, os: SrOs, r: SrR, nhR: SrR): { push?: number[]; nh?: SrNh; ip?: boolean; why?: string } {
  const s = sidOf(v, nhR);
  const g = srgbOf(c[r], os);
  const rt = v.rib[r].find((x) => x.dst === nhR);
  if (!rt?.nh) return { why: `no IS-IS route to ${SR_LO[nhR]}` };
  if (s && g && srCapable(c[r], os)) {
    const e = entry(v, r, g.start + s.index);
    if (e && e.out !== undefined && e.out !== "Unlabelled") return { push: e.out === "Pop" ? [] : [e.out], nh: e.nh };
  }
  if (os === "xr") return { ip: true, nh: rt.nh, why: s ? `no SR label toward ${SR_LO[nhR]} (Unlabelled)` : `${nhR}'s loopback has no Prefix-SID` };
  return { why: s ? `${SR_LO[nhR]} has no SR route in inet.3` : `${nhR}'s loopback has no Prefix-SID: ${SR_LO[nhR]} is not in inet.3` };
}

// ---------------------------------------------------------------------------------------------------------------
// The data plane
// ---------------------------------------------------------------------------------------------------------------
interface Hop {
  from: SrR | SrHost;
  to: SrR | SrHost;
  labels: number[];
  note: string;
}
export interface SrWalk {
  hops: Hop[];
  notes: string[];
  ok: boolean;
  at: SrR | SrHost;
  why?: string;
  path: string[];
}
const custNet = (ip: string): SrHost | undefined => (ip.startsWith("192.168.1.") ? "H1" : ip.startsWith("192.168.6.") ? "H6" : undefined);
/** Carry one packet from router `start` holding `stack`, toward IP `dst`; `headend` = the stack was imposed at start. */
export function srWalk(c: SrCfg, v: SrView, os: SrOs, start: SrR, stack0: number[], dst: string, firstHop?: SrNh, endOnEmpty = false): SrWalk {
  const w: SrWalk = { hops: [], notes: [], ok: false, at: start, path: [start] };
  let r: SrR = start;
  let stack = [...stack0];
  const send = (nh: SrNh, note: string) => {
    w.hops.push({ from: r, to: nh.nh, labels: [...stack], note });
    r = nh.nh;
    w.path.push(r);
  };
  if (firstHop) send(firstHop, `${start}: imposes [${stack.join(", ")}] and sends it out ${firstHop.ifn} to ${firstHop.nh}`);
  for (let ttl = 0; ttl < 20; ttl++) {
    w.at = r;
    if (endOnEmpty && !stack.length) {
      w.ok = true;
      w.notes.push(`${r}: the last label is gone — it answers the echo request`);
      return w;
    }
    if (stack.length) {
      const top = stack[0];
      const e = entry(v, r, top);
      if (!e) {
        w.why = `${r} has no entry for label ${top}${v.table[r].length ? "" : ` (${r} is not SR-capable)`} — dropped`;
        w.notes.push(w.why);
        return w;
      }
      if (e.kind === "adj") {
        stack = stack.slice(1);
        send(e.nh!, `${r}: ${top} is its Adjacency SID toward ${e.to} → pop, out ${e.nh!.ifn}${stack.length ? `, the next segment is ${stack[0]}` : ""}`);
        continue;
      }
      if (e.own) {
        stack = stack.slice(1);
        w.notes.push(`${r}: ${top} is its own Node SID → pop${stack.length ? `, the next segment is ${stack[0]}` : ", the packet is plain IP again"}`);
        w.hops.push({ from: r, to: r, labels: [...stack], note: w.notes.at(-1)! });
        continue;
      }
      if (e.out === "Unlabelled") {
        stack = stack.slice(1);
        send(e.nh!, `${r}: ${top} → Unlabelled (${e.why}) → the label is removed, out ${e.nh!.ifn}${stack.length ? ` with [${stack.join(", ")}]` : " as plain IP"}`);
        continue;
      }
      if (e.out === "Pop") {
        stack = stack.slice(1);
        send(e.nh!, `${r}: ${top} = Node SID of ${e.to}, the next hop owns it → pop (PHP), out ${e.nh!.ifn}`);
        continue;
      }
      stack = [e.out!, ...stack.slice(1)];
      send(e.nh!, `${r}: ${top} = Node SID of ${e.to} (index ${e.index}) → swap to ${e.out} (${e.nh!.nh}'s SRGB), out ${e.nh!.ifn}`);
      continue;
    }
    // Plain IP
    const lo = routerOfLo(dst);
    if (lo === r) {
      w.ok = true;
      w.notes.push(`${r}: ${dst} is its own loopback — received`);
      return w;
    }
    const h = custNet(dst);
    if (h && HOSTS[h].r === r) {
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
        w.notes.push(w.why);
        return w;
      }
      send(rt.nh, `${r}: IP to ${dst} via IS-IS, out ${rt.nh.ifn}`);
      continue;
    }
    if (h && (r === "R1" || r === "R6")) {
      const far = HOSTS[h].r;
      const res = resolveNh(v, c, os, r, far);
      if (res.push) {
        stack = res.push;
        send(res.nh!, `${r}: ${dst} → BGP next hop ${SR_LO[far]} → ${res.push.length ? `push ${res.push[0]} (${far}'s Node SID)` : "no label (the next hop owns the SID)"}, out ${res.nh!.ifn}`);
        continue;
      }
      if (res.ip) {
        send(res.nh!, `${r}: ${dst} → BGP next hop ${SR_LO[far]}, but ${res.why} → sent as plain IP, out ${res.nh!.ifn}`);
        continue;
      }
      w.why = `${r}: the BGP route to ${dst} is unusable — ${res.why}`;
      w.notes.push(w.why);
      return w;
    }
    w.why = `${r} has no route to ${dst} (the core runs no BGP) — dropped`;
    w.notes.push(w.why);
    return w;
  }
  w.why = "TTL expired (loop)";
  return w;
}

// ---------------------------------------------------------------------------------------------------------------
// State and actions
// ---------------------------------------------------------------------------------------------------------------
export interface SrSnap {
  view: SrView;
}
export interface SrTest {
  id: number;
  kind: "ping" | "probe" | "nilfec";
  from: string;
  dst: string;
  stack?: number[];
  ok: boolean;
  path: string[];
  why?: string;
  /** Labels each hop carried (for the path view). */
  labels: number[][];
  cfgSeq: number;
  t: number;
}
export interface SrSys {
  t: number;
  dev: SrR;
  kind: "commit" | "adj-up" | "adj-down" | "sid-conflict" | "srgb-range";
  peer?: string;
}
export interface SrState extends SpBase<SrSnap> {
  os: SrOs;
  cfg: SrCfg;
  hist: Record<SrR, SrRtr[]>;
  view: SrView;
  sys: SrSys[];
  tests: SrTest[];
  wiped?: boolean;
}
export type SrTicketId = "srgb" | "nosid" | "srdisabled" | "dupsid" | "metric";
export type SrAction =
  | { type: "cfg"; dev: SrR; cfg: SrRtr; text: string }
  | { type: "set"; changes: { dev: SrR; f: (c: SrRtr) => void }[]; text: string }
  | { type: "ping"; from: SrHost }
  /** `portable`: the stack is written with IOS XR Adjacency SID numbers (24000 + …); on Junos they become 299776 + …. */
  | { type: "probe"; stack: number[]; dst?: string; from?: SrR; portable?: boolean }
  | { type: "nilfec"; stack: number[]; ifn: IfName; from?: SrR }
  | { type: "ticket"; id: SrTicketId }
  | { type: "os"; os: SrOs }
  | { type: "wipe-r6" };

const cl = (o: SrState): SrState => ({ ...spClone(o), runs: o.runs, last: o.last });
export function createSrNet(seq = 0, os: SrOs = "xr"): SrState {
  const cfg = srHealthy();
  const view = srView(cfg, os);
  const s: SrState = { seq, os, cfgSeq: 0, clock: 3600, runs: [], log: [{ seq, t: 3600, text: "IS-IS is up on every link; every router advertises SRGB 16000–23999 and a Prefix-SID for its loopback (index = router number). R1 and R6 exchange the customer prefixes by iBGP. No LDP runs anywhere.", tone: "info" }], cfg, hist: Object.fromEntries(SR_ROUTERS.map((r) => [r, []])) as unknown as Record<SrR, SrRtr[]>, view, sys: [], tests: [] };
  for (const l of SR_LINKS) s.sys.push({ t: 15, dev: l.a, kind: "adj-up", peer: l.b }, { t: 15, dev: l.b, kind: "adj-up", peer: l.a });
  return s;
}
const color = (labels: number[]) => (labels.length > 1 ? "violet" : labels.length ? "cyan" : "green");
function record(s: SrState, kind: SrTest["kind"], cmd: string, from: string, dst: string, walks: { w: SrWalk; what: string }[], stack?: number[]) {
  const moments: SpMoment<SrSnap>[] = [];
  const snap = { view: s.view };
  for (const { w, what } of walks) {
    moments.push({ tokens: [], lines: [{ text: what, tone: "info" }], snap });
    for (const h of w.hops) moments.push({ tokens: h.from !== h.to ? [{ from: h.from, to: h.to, label: h.labels.length ? h.labels.join(" | ") : "IP", color: color(h.labels) }] : [], lines: [{ text: h.note, tone: h.labels.length ? "learn" : "info" }], snap });
    if (w.why) moments.push({ tokens: [], lines: [{ text: w.why, tone: "warn" }], snap });
  }
  const ok = walks.every((x) => x.w.ok);
  const why = walks.find((x) => !x.w.ok)?.w.why;
  const main = walks[0].w;
  moments.push({ tokens: [], lines: [{ text: ok ? `${cmd}: success — path ${main.path.join(" → ")}.` : `${cmd}: failed — ${why}`, tone: ok ? "ok" : "bad" }], snap });
  const t: SrTest = { id: s.tests.length + 1, kind, from, dst, stack, ok, path: main.path, why, labels: main.hops.filter((h) => h.from !== h.to).map((h) => h.labels), cfgSeq: s.cfgSeq, t: s.clock };
  s.tests = [...s.tests, t].slice(-40);
  const run: SpRun<SrSnap> = { id: s.runs.length + 1 + s.seq * 1000, cmd, kind: "test", moments, ok };
  s.runs = [...s.runs, run];
  s.last = run;
  s.log = [...s.log, { seq: s.seq, t: s.clock, text: `${cmd}: ${ok ? `success (${main.path.join(" → ")})` : why}`, tone: ok ? "ok" : "warn" }];
  return s;
}
export function srPing(s0: SrState, from: SrHost): SrState {
  const s = cl(s0);
  s.clock += 2;
  const to: SrHost = from === "H1" ? "H6" : "H1";
  const r0 = HOSTS[from].r;
  const go = srWalk(s.cfg, s.view, s.os, r0, [], HOSTS[to].ip);
  go.hops.unshift({ from, to: r0, labels: [], note: `${from} sends an echo request to ${HOSTS[to].ip} (gateway ${r0})` });
  go.path.unshift(from);
  const walks = [{ w: go, what: `${from} → ${HOSTS[to].ip}: the echo request` }];
  if (go.ok) {
    const back = srWalk(s.cfg, s.view, s.os, HOSTS[to].r, [], HOSTS[from].ip);
    back.hops.unshift({ from: to, to: HOSTS[to].r, labels: [], note: `${to} answers ${HOSTS[from].ip}` });
    back.path.unshift(to);
    walks.push({ w: back, what: `${to} → ${HOSTS[from].ip}: the echo reply` });
  }
  return record(s, "ping", `ping ${HOSTS[to].ip} from ${from}`, from, HOSTS[to].ip, walks);
}
/** A segment list executed from R1 (the headend's first segment is executed at R1). */
export function srProbe(s0: SrState, stack: number[], dst = SR_LO.R6, from: SrR = "R1"): SrState {
  const s = cl(s0);
  s.clock += 2;
  const w = srWalk(s.cfg, s.view, s.os, from, stack, dst);
  return record(s, "probe", `${from} sends to ${dst} with segment list [${stack.join(", ")}]`, from, dst, [{ w, what: `${from} imposes [${stack.join(", ")}]: it executes the first segment itself.` }], stack);
}
/** IOS XR `ping sr-mpls nil-fec labels … output interface … nexthop …`: the whole list leaves on one interface. */
export function srNilFec(s0: SrState, stack: number[], ifn: IfName, from: SrR = "R1"): SrState {
  const s = cl(s0);
  s.clock += 2;
  const i = srIfs(from).find((x) => x.ifn === ifn)!;
  // The echo request is addressed to 127.0.0.1: whichever router receives it with no label left answers.
  const w = srWalk(s.cfg, s.view, s.os, from, stack, "127.0.0.1", { nh: i.peer, ifn, ip: i.peerIp }, true);
  return record(s, "nilfec", `ping sr-mpls nil-fec labels ${stack.join(",")} output interface ${ifn}`, from, String(w.at), [{ w, what: `${from} sends an MPLS echo request out ${ifn} with [${stack.join(", ")}] — no lookup of the first label at R1.` }], stack);
}

function converge(prev: SrState, s: SrState, why: string, show = true): SrState {
  const view = srView(s.cfg, s.os);
  s.view = view;
  const snap = { view };
  const moments: SpMoment<SrSnap>[] = [];
  for (const l of SR_LINKS)
    if (prev.view.adj[l.id] !== view.adj[l.id]) {
      moments.push({ tokens: view.adj[l.id] ? [{ from: l.a, to: l.b, label: "IIH", color: "cyan" }] : [], lines: [{ text: `IS-IS ${l.a}–${l.b} ${view.adj[l.id] ? "Up" : "goes down"}.`, tone: view.adj[l.id] ? "ok" : "bad" }], snap });
      s.sys.push({ t: s.clock, dev: l.a, kind: view.adj[l.id] ? "adj-up" : "adj-down", peer: l.b }, { t: s.clock, dev: l.b, kind: view.adj[l.id] ? "adj-up" : "adj-down", peer: l.a });
    }
  for (const x of view.conflicts)
    if (!prev.view.conflicts.some((y) => y.index === x.index && y.loser === x.loser)) {
      moments.push({ tokens: [], lines: [{ text: `Prefix-SID conflict: ${x.winner} (${SR_LO[x.winner]}) and ${x.loser} (${SR_LO[x.loser]}) both claim index ${x.index}. Every router keeps ${SR_LO[x.winner]}; ${SR_LO[x.loser]} has no SID.`, tone: "bad" }], snap });
      for (const r of SR_ROUTERS) s.sys.push({ t: s.clock, dev: r, kind: "sid-conflict", peer: `${x.index}` });
    }
  const lines: { text: string; tone: "ok" | "bad" | "learn" }[] = [];
  for (const r of SR_ROUTERS) {
    const was = new Map(prev.view.table[r].map((e) => [`${e.kind}${e.label}`, e]));
    const now = new Map(view.table[r].map((e) => [`${e.kind}${e.label}`, e]));
    for (const [k, e] of now) {
      const p = was.get(k);
      if (!p) lines.push({ text: `${r}: installs ${e.label} (${e.kind === "adj" ? `Adj-SID → ${e.to}` : e.own ? "own Node SID" : `Node SID of ${e.to}, out ${e.out}`}).`, tone: "ok" });
      else if (p.out !== e.out || p.nh?.nh !== e.nh?.nh) lines.push({ text: `${r}: ${e.label} now ${e.out} via ${e.nh?.nh ?? "—"} (was ${p.out} via ${p.nh?.nh ?? "—"}).`, tone: "learn" });
    }
    for (const [k, e] of was) if (!now.has(k)) lines.push({ text: `${r}: removes ${e.label} (${e.kind === "adj" ? `Adj-SID → ${e.to}` : `Node SID of ${e.to}`}).`, tone: "bad" });
    for (const m of view.missing[r]) if (!prev.view.missing[r].some((x) => x.index === m.index && x.why === m.why)) {
      lines.push({ text: `${r}: no label for index ${m.index} (${m.owner}) — ${m.why}.`, tone: "bad" });
      if (/SRGB/.test(m.why)) s.sys.push({ t: s.clock, dev: r, kind: "srgb-range", peer: `${m.index}` });
    }
  }
  if (lines.length) moments.push({ tokens: [], lines: lines.slice(0, 12), snap });
  if (show && moments.length) {
    const run: SpRun<SrSnap> = { id: s.runs.length + 1 + s.seq * 1000, cmd: why, kind: "converge", moments };
    s.runs = [...s.runs, run];
    s.last = run;
  }
  return s;
}

// ---------------------------------------------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------------------------------------------
export interface SrTicketDef {
  id: SrTicketId;
  title: string;
  report: string;
  reproLabel: string;
  repro: SrAction[];
  fault: (c: SrCfg) => void;
}
export const SR_TICKETS: SrTicketDef[] = [
  {
    id: "srgb",
    title: "After R2's template change",
    report: "“R2's segment-routing settings were replaced by a template overnight. Since then H1 can't reach H6. IS-IS is up everywhere and R2 still advertises its Prefix-SID.”",
    reproLabel: "ping 192.168.6.20 from H1",
    repro: [{ type: "ping", from: "H1" }],
    fault: (c) => {
      c.R2.srgb = { start: 16000, range: 5 };
    },
  },
  {
    id: "nosid",
    title: "R6's loopback was re-created",
    report: "“R6's Loopback0 was deleted and re-created during a software upgrade. IS-IS is up, R1 has an IS-IS route to 10.0.0.6, but H1 and H6 can't reach each other.”",
    reproLabel: "ping 192.168.6.20 from H1",
    repro: [{ type: "ping", from: "H1" }],
    fault: (c) => {
      c.R6.sid = undefined;
    },
  },
  {
    id: "srdisabled",
    title: "R4 came back from maintenance",
    report: "“R4 was rebuilt from its backup. Its IS-IS adjacencies to R2 and R6 are up, every router has every loopback in its routing table, but H1 can't reach H6.”",
    reproLabel: "ping 192.168.6.20 from H1",
    repro: [{ type: "ping", from: "H1" }],
    fault: (c) => {
      c.R4.sr = false;
    },
  },
  {
    id: "dupsid",
    title: "A copy-paste on R5",
    report: "“R5's IS-IS configuration was copied from R6 and edited. Since then H1 can't reach H6 — though nothing changed on R1, R2, R4 or R6.”",
    reproLabel: "ping 192.168.6.20 from H1",
    repro: [{ type: "ping", from: "H1" }],
    fault: (c) => {
      c.R5.sid = 6;
    },
  },
  {
    id: "metric",
    title: "Slower since the maintenance",
    report: "“Since the maintenance on R1, H1 ↔ H6 works but latency went up. The customer's traffic should use the top path (R2, R4).”",
    reproLabel: "ping 192.168.6.20 from H1",
    repro: [{ type: "ping", from: "H1" }],
    fault: (c) => {
      c.R1.ifs["ge-0/0/0"]!.metric = 100;
    },
  },
];
export const srTicket = (id: string) => SR_TICKETS.find((t) => t.id === id)!;
export function srTicketState(id: SrTicketId, seq = 0, os: SrOs = "xr"): SrState {
  const s = createSrNet(seq, os);
  const nx = cl(s);
  srTicket(id).fault(nx.cfg);
  const out = converge(s, nx, "", false);
  out.ticket = id;
  out.runs = [];
  out.last = undefined;
  out.log = [...out.log, { seq, t: out.clock, text: `Ticket opened: ${srTicket(id).title}.`, tone: "warn" }];
  return out;
}

export function srApply(s0: SrState, a: SrAction): SrState {
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
    case "ping":
      return srPing(s0, a.from);
    case "probe":
      return srProbe(s0, a.portable && s0.os === "junos" ? a.stack.map((l) => (l >= 24000 && l < 25000 ? l - 24000 + 299776 : l)) : a.stack, a.dst, a.from);
    case "nilfec":
      return srNilFec(s0, a.stack, a.ifn, a.from);
    case "ticket":
      return srTicketState(a.id, s0.seq + 1, s0.os);
    case "os":
      return createSrNet(s0.seq + 1, a.os);
    case "wipe-r6": {
      const s = cl(s0);
      s.cfg.R6.sr = false;
      s.cfg.R6.srgb = undefined;
      s.cfg.R6.sid = undefined;
      s.wiped = true;
      s.cfgSeq += 1;
      s.clock += 1;
      s.log = [...s.log, { seq: s.seq, t: s.clock, text: "R6's segment-routing configuration was deleted: no SR, no SRGB, no Prefix-SID. IS-IS itself still runs.", tone: "warn" }];
      return converge(s0, s, "R6 loses its segment-routing configuration");
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Diagnosis, proofs, ladder
// ---------------------------------------------------------------------------------------------------------------
export const SR_CAUSES: { id: string; label: string }[] = [
  { id: "srgb", label: "A router's SRGB is too small for the indexes in use" },
  { id: "nosid", label: "The destination's loopback has no Prefix-SID" },
  { id: "srdisabled", label: "Segment routing is not enabled on a router in the path" },
  { id: "dupsid", label: "Two routers claim the same Prefix-SID index" },
  { id: "metric", label: "An IS-IS metric sends the Node SID down the wrong path" },
  { id: "ldp", label: "LDP is not running on the core links" },
  { id: "adjsid", label: "An Adjacency SID is used at the wrong router" },
];
const lastTest = (s: SrState) => s.tests[s.tests.length - 1];
export const srTopPath = (s: SrState) => s.view.rib.R1.find((x) => x.dst === "R6")?.path.join("-") === "R1-R2-R4-R6";
export function srCauseFeedback(s: SrState, cause: string): { right: boolean; text: string } {
  const t = s.ticket as SrTicketId | undefined;
  const xr = s.os === "xr";
  if (cause === t) {
    const txt: Record<SrTicketId, string> = {
      srgb: `Yes. R2's template set an SRGB of 16000–16004 (range 5). Indexes 5 and 6 don't fit, so R2 programs no label for 16006 — and R1 can't send 16006 to R2 either, since R2's SRGB has no slot for index 6. ${xr ? "R1 programs 16006 as Unlabelled and sends the customer packet as plain IP; R2 has no BGP route to 192.168.6.20 and drops it." : "Junos installs nothing: R1 has no SR route to 10.0.0.6 in inet.3 and the BGP route is unusable."}`,
      nosid: `Yes. R6's re-created loopback lost its Prefix-SID: no router has a label for 10.0.0.6. ${xr ? "R1 sends the customer packet as plain IP (no SR label toward 10.0.0.6) and R2 — BGP-free — drops it." : "10.0.0.6 is not in inet.3, so R1's BGP route to 192.168.6.0/24 is unusable."} IS-IS reachability alone isn't enough in a BGP-free core.`,
      srdisabled: `Yes. R4's backup has no segment-routing ${xr ? "mpls under the IS-IS address family" : "(source-packet-routing)"}. R4 advertises no SRGB, so R2 has no label to send toward 10.0.0.6 through R4 ${xr ? "(Unlabelled: the packet reaches R4 as plain IP, and R4 has no BGP route)" : "and installs nothing; the route back at R1 is unusable"}.`,
      dupsid: "Yes. R5 now also claims index 6. The routers resolve the conflict in favor of the numerically smaller prefix, 10.0.0.5: label 16006 now leads to R5, and R6's loopback has no SID at all. Traffic for R6 can't be labeled, and anything sent with 16006 ends at R5.",
      metric: "Yes. R1's interface toward R2 has metric 100. The Node SID follows the IGP shortest path, so 16006 now leaves R1 toward R3 (metric 45 instead of 30 via R2). Nothing is broken in segment routing — the IGP decides where a Node SID goes.",
    };
    return { right: true, text: txt[t] };
  }
  const lt = lastTest(s);
  switch (cause) {
    case "ldp":
      return { right: false, text: "This network runs no LDP at all, by design: IS-IS distributes every label. Look at the SR state." };
    case "adjsid":
      return { right: false, text: "The customer's traffic uses R6's Node SID, not a segment list. Adjacency SIDs aren't involved." };
    case "srgb":
      return { right: false, text: "Every router's SRGB is 16000–23999: every index fits." };
    case "nosid":
      return { right: false, text: "R6's loopback has Prefix-SID index 6." };
    case "srdisabled":
      return { right: false, text: "Segment routing is enabled on every router." };
    case "dupsid":
      return { right: false, text: "Every router has its own index: no conflict." };
    case "metric":
      return { right: false, text: "The metrics are as designed: the shortest path R1→R6 is R2, R4 (cost 30)." };
  }
  return { right: false, text: lt ? "That doesn't match the evidence." : "Run the user's test first." };
}
export function srProofs(s: SrState): { label: string; ok: boolean; detail: string }[] {
  const t = s.ticket as SrTicketId | undefined;
  if (!t) return [];
  const fresh = s.tests.filter((x) => x.cfgSeq === s.cfgSeq && x.kind === "ping" && x.from === "H1");
  const xr = s.os === "xr";
  const proof = { label: "A fresh ping 192.168.6.20 from H1 succeeds", ok: fresh.some((x) => x.ok), detail: "run the test again after the fix" };
  const lbl = xr ? "show mpls forwarding" : "show route table mpls.0";
  switch (t) {
    case "srgb":
      return [{ label: "R2's SRGB covers every index (16000–23999)", ok: (srgbOf(s.cfg.R2, s.os)?.range ?? 0) > 6, detail: `${lbl} on R2` }, proof];
    case "nosid":
      return [{ label: "R6's loopback has Prefix-SID index 6", ok: sidOf(s.view, "R6")?.index === 6, detail: xr ? "show isis segment-routing label table on R1" : "show route table inet.3 on R1" }, proof];
    case "srdisabled":
      return [{ label: "R4 is SR-capable and programs 16006", ok: !!entry(s.view, "R4", 16006), detail: `${lbl} on R4` }, proof];
    case "dupsid":
      return [{ label: "No Prefix-SID conflict; 16006 leads to R6", ok: !s.view.conflicts.length && sidOf(s.view, "R6")?.index === 6, detail: xr ? "show isis segment-routing label table on R1" : "show isis database extensive on R1" }, proof];
    case "metric":
      return [{ label: "R1 reaches R6 via R2 and R4 again", ok: srTopPath(s), detail: xr ? "traceroute sr-mpls 10.0.0.6/32 on R1" : "show route table inet.3 on R1" }, { ...proof, label: "A fresh ping from H1 takes R2 and R4", ok: fresh.some((x) => x.ok && x.path.includes("R2") && x.path.includes("R4")) }];
  }
}
export function srLadder(s: SrState): { k: string; title: string; text: string }[] {
  const t = lastTest(s);
  const v = s.view;
  const adjDown = SR_LINKS.filter((l) => !v.adj[l.id]).map((l) => l.id);
  const notSr = SR_ROUTERS.filter((r) => !srCapable(s.cfg[r], s.os));
  const noSid = SR_ROUTERS.filter((r) => !sidOf(v, r));
  const miss = SR_ROUTERS.flatMap((r) => v.missing[r].filter((m) => m.owner === "R6" || m.owner === "R1").map((m) => `${r}: no label for ${m.owner} — ${m.why}`));
  const unl = SR_ROUTERS.flatMap((r) => v.table[r].filter((e) => e.out === "Unlabelled").map((e) => `${r}: ${e.label} Unlabelled (${e.why})`));
  const p = v.rib.R1.find((x) => x.dst === "R6")?.path;
  return [
    { k: "test", title: "What did the test show?", text: t ? `${t.kind === "ping" ? `ping ${t.dst} from ${t.from}` : `R1 → ${t.dst} [${t.stack?.join(", ")}]`}: ${t.ok ? `success via ${t.path.join(" → ")}` : t.why}.` : "Run the user's test first." },
    { k: "igp", title: "Is IS-IS up, and which path does R1 → R6 take?", text: `${adjDown.length ? `Adjacencies down: ${adjDown.join(", ")}. ` : "Every adjacency is up. "}Shortest path R1 → R6: ${p ? p.join(" → ") : "none"}.` },
    { k: "srcap", title: "Is every router SR-capable, with an SRGB that fits?", text: notSr.length ? `Not SR-capable: ${notSr.join(", ")}.` : SR_ROUTERS.filter((r) => (srgbOf(s.cfg[r], s.os)?.range ?? 0) <= 6).map((r) => `${r}'s SRGB is too small (${srgbOf(s.cfg[r], s.os)!.start}–${srgbOf(s.cfg[r], s.os)!.start + srgbOf(s.cfg[r], s.os)!.range - 1})`).join(" · ") || "Yes: SRGB 16000–23999 on every router." },
    { k: "sid", title: "Does every loopback have its own Prefix-SID?", text: [...v.conflicts.map((x) => `index ${x.index} claimed by ${x.winner} and ${x.loser} — ${x.winner} keeps it`), ...(noSid.length ? [`no SID in use for: ${noSid.join(", ")}`] : [])].join(" · ") || "Yes: index 1–6, one each." },
    { k: "labels", title: "Is 16006 programmed hop by hop toward R6?", text: [...miss, ...unl].join(" · ") || "Yes: every router has a label for R1 and R6, with an outgoing label or PHP." },
    { k: "bgp", title: "Does R1 send the customer traffic labeled?", text: (() => { const r = resolveNh(v, s.cfg, s.os, "R1", "R6"); return r.push ? `Yes: 192.168.6.0/24 via 10.0.0.6, push ${r.push[0] ?? "nothing (PHP)"}.` : r.ip ? `No: ${r.why} — plain IP into a BGP-free core.` : `No: ${r.why}.`; })() },
  ];
}
