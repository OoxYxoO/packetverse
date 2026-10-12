import { spClone, type SpBase, type SpMoment, type SpRun } from "@/components/sp-lab/spKit";
import { locPrefix, v6norm, v6parse } from "./sxNet";

/**
 * SRv6 Policy Lab network — the guided lesson's diamond with the R3–R4 cross-link, IS-IS for IPv6 with SRv6 on IOS XR,
 * SR policies on R1 instantiated by a controller (PCE), and R6's customer VRF behind an End.DT6 service SID.
 *
 *            R2 ──10/20ms── R4               IGP metric / one-way delay per link
 *   10/20ms ╱               │╲ 10/20ms       top R1–R2–R4–R6: IGP 30, 60 ms (the IGP shortest path)
 *   CL1─ R1       20/15ms   │  R6 ─ RX66 2001:db8:66::6  (color 100: the low-latency app)
 *   15/5ms ╲                │╱ 15/5ms   └─ RX67 2001:db8:67::7  (no color)
 *            R3 ──15/5ms─── R5               bottom R1–R3–R5–R6: IGP 45, 15 ms · cross R3–R4: 20, 15 ms
 *
 * - SIDs (IOS XR, locator MAIN 2001:db8:100:N::/64): End :1, End.X :40+k per adjacency (interface order); R6's BGP
 *   allocates End.DT6 for the global IPv6 table (both receiver prefixes); R1 allocates the binding SID (End.B6.Encaps) of each policy.
 * - Policy (RFC 9256): ⟨R1, color, end-point⟩, candidates by preference — explicit (a list of SIDs, valid when every
 *   SID exists and the first is reachable) or dynamic (computed by the PCE on the TE database: metric igp or delay,
 *   encoded as End / End.X SIDs). The valid candidate with the highest preference is active.
 * - Steering: R6 colors 2001:db8:66::/64 with 100; a colored route whose color and BGP next hop (R6's loopback) match a
 *   policy that is up uses it: R1 pushes [policy SIDs…, service SID]. Otherwise only the service SID (IGP path).
 * - Latency in tests is the real sum of link delays.
 */

export type PR = "R1" | "R2" | "R3" | "R4" | "R5" | "R6";
export const P_ROUTERS: PR[] = ["R1", "R2", "R3", "R4", "R5", "R6"];
export const P_IDX: Record<PR, number> = { R1: 1, R2: 2, R3: 3, R4: 4, R5: 5, R6: 6 };
export const P_LO = (r: PR) => `2001:db8::${P_IDX[r]}`;
export type IfName = "ge-0/0/0" | "ge-0/0/1" | "ge-0/0/2" | "ge-0/0/3";
export type Rx = "RX66" | "RX67";
export const P_RX: Record<Rx, { ip: string; net: string; gw: string; ifn: IfName; color?: number }> = {
  RX66: { ip: "2001:db8:66::6", net: "2001:db8:66::", gw: "2001:db8:66::1", ifn: "ge-0/0/2", color: 100 },
  RX67: { ip: "2001:db8:67::7", net: "2001:db8:67::", gw: "2001:db8:67::1", ifn: "ge-0/0/3" },
};
export const CL1 = { ip: "2001:db8:11::10", net: "2001:db8:11::", gw: "2001:db8:11::1" };

export interface PLink {
  id: string;
  a: PR;
  ai: IfName;
  b: PR;
  bi: IfName;
  metric: number;
  ms: number;
}
export const P_LINKS: PLink[] = [
  { id: "R1-R2", a: "R1", ai: "ge-0/0/0", b: "R2", bi: "ge-0/0/0", metric: 10, ms: 20 },
  { id: "R2-R4", a: "R2", ai: "ge-0/0/1", b: "R4", bi: "ge-0/0/0", metric: 10, ms: 20 },
  { id: "R4-R6", a: "R4", ai: "ge-0/0/1", b: "R6", bi: "ge-0/0/0", metric: 10, ms: 20 },
  { id: "R1-R3", a: "R1", ai: "ge-0/0/1", b: "R3", bi: "ge-0/0/0", metric: 15, ms: 5 },
  { id: "R3-R5", a: "R3", ai: "ge-0/0/1", b: "R5", bi: "ge-0/0/0", metric: 15, ms: 5 },
  { id: "R5-R6", a: "R5", ai: "ge-0/0/1", b: "R6", bi: "ge-0/0/1", metric: 15, ms: 5 },
  { id: "R3-R4", a: "R3", ai: "ge-0/0/2", b: "R4", bi: "ge-0/0/2", metric: 20, ms: 15 },
];
export const pLinkIp = (l: PLink, r: PR) => `2001:db8:${P_IDX[l.a]}${P_IDX[l.b]}::${P_IDX[r]}`;
export interface PIfInfo {
  ifn: IfName;
  ip: string;
  peer: PR;
  peerIf: IfName;
  link: PLink;
}
export function pIfs(r: PR): PIfInfo[] {
  return P_LINKS.flatMap((l) => (l.a === r ? [{ ifn: l.ai, ip: pLinkIp(l, r), peer: l.b, peerIf: l.bi, link: l }] : l.b === r ? [{ ifn: l.bi, ip: pLinkIp(l, r), peer: l.a, peerIf: l.ai, link: l }] : [])).sort((x, y) => x.ifn.localeCompare(y.ifn));
}
export const pIfTo = (r: PR, peer: PR) => pIfs(r).find((i) => i.peer === peer);
const fn = (r: PR, f: number) => `2001:db8:100:${P_IDX[r]}:${f.toString(16)}::`;
export const pEnd = (r: PR) => fn(r, 1);

// ---------------------------------------------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------------------------------------------
export interface PIf {
  isis: boolean;
  metric: number;
  /** Advertised delay (µs) for the PCE's TE database. */
  delay: number;
}
export interface PCand {
  pref: number;
  kind: "explicit" | "dynamic";
  sids?: string[];
  metric?: "igp" | "delay";
}
export interface PPolicy {
  name: string;
  color: number;
  endpoint: string;
  cands: PCand[];
}
export interface PRtr {
  isisLoc: boolean;
  ifs: Partial<Record<IfName, PIf>>;
  /** R6: BGP exports 2001:db8:66::/64 with color 100. */
  colorOut: boolean;
  /** R1: the policies the controller instantiated. */
  policies: PPolicy[];
  /** End.X functions re-allocated after an adjacency flap (otherwise 0x40 + interface position). */
  xfn: Partial<Record<IfName, number>>;
}
export type PCfg = Record<PR, PRtr>;
export const LL_COLOR = 100;
export function pHealthy(): PCfg {
  const c = {} as PCfg;
  for (const r of P_ROUTERS) {
    const ifs: Partial<Record<IfName, PIf>> = {};
    for (const i of pIfs(r)) ifs[i.ifn] = { isis: true, metric: i.link.metric, delay: i.link.ms * 1000 };
    c[r] = { isisLoc: true, ifs, colorOut: r === "R6", policies: [], xfn: {} };
  }
  c.R1.policies = [{ name: "LOW-LATENCY", color: LL_COLOR, endpoint: P_LO("R6"), cands: [{ pref: 200, kind: "explicit", sids: ["2001:db8:100:3:41::"] }, { pref: 100, kind: "dynamic", metric: "delay" }] }];
  return c;
}

// ---------------------------------------------------------------------------------------------------------------
// Derived state
// ---------------------------------------------------------------------------------------------------------------
export interface PSid {
  sid: string;
  behavior: "End" | "End.X" | "End.DT6" | "End.B6.Encaps";
  ifn?: IfName;
  peer?: PR;
  policy?: string;
}
export interface PNh {
  nh: PR;
  ifn: IfName;
}
export interface PRoute {
  dst: PR;
  cost: number;
  nh?: PNh;
  path: PR[];
}
export interface PCandEval {
  cand: PCand;
  valid: boolean;
  why?: string;
  sids: string[];
  path?: PR[];
  cost?: number;
}
export interface PPolEval {
  pol: PPolicy;
  cands: PCandEval[];
  active?: PCandEval;
  up: boolean;
  bsid?: string;
}
export interface PView {
  adj: Record<string, boolean>;
  spf: Record<PR, PRoute[]>;
  sids: Record<PR, PSid[]>;
  pols: PPolEval[];
  service: string;
}
const adjUp = (c: PCfg, l: PLink) => !!c[l.a].ifs[l.ai]?.isis && !!c[l.b].ifs[l.bi]?.isis;
function spf(c: PCfg, root: PR, w: (u: PR, i: PIfInfo) => number) {
  const d = new Map<PR, { cost: number; prev?: PR; first?: PNh }>([[root, { cost: 0 }]]);
  const done = new Set<PR>();
  while (true) {
    const u = P_ROUTERS.filter((r) => !done.has(r) && d.has(r)).sort((a, b) => d.get(a)!.cost - d.get(b)!.cost || P_IDX[a] - P_IDX[b])[0];
    if (!u) break;
    done.add(u);
    for (const i of pIfs(u)) {
      if (!adjUp(c, i.link)) continue;
      const cost = d.get(u)!.cost + w(u, i);
      if (!d.has(i.peer) || cost < d.get(i.peer)!.cost) d.set(i.peer, { cost, prev: u, first: u === root ? { nh: i.peer, ifn: i.ifn } : d.get(u)!.first });
    }
  }
  return P_ROUTERS.filter((r) => r !== root && d.has(r)).map((r) => {
    const path: PR[] = [r];
    let x = r;
    while (d.get(x)?.prev) path.unshift((x = d.get(x)!.prev!));
    return { dst: r, cost: d.get(r)!.cost, nh: d.get(r)!.first, path };
  });
}
/** Encode a path from R1 as End / End.X SIDs against IGP shortest paths (the service SID covers the last stretch). */
function encode(c: PCfg, sp: Record<PR, PRoute[]>, sids: Record<PR, PSid[]>, path: PR[]): string[] | undefined {
  const out: string[] = [];
  let i = 0;
  const end = (r: PR) => sids[r].find((x) => x.behavior === "End")?.sid;
  while (i < path.length - 1) {
    let best = i;
    for (let j = i + 1; j < path.length; j++) {
      const rt = sp[path[i]].find((x) => x.dst === path[j]);
      if (rt && rt.path.join() === path.slice(i, j + 1).join()) best = j;
      else break;
    }
    if (best === path.length - 1) break;
    if (best === i) {
      const x = sids[path[i]].find((y) => y.behavior === "End.X" && y.peer === path[i + 1]);
      if (!x) return undefined;
      out.push(x.sid);
      i += 1;
    } else {
      const e = end(path[best]);
      if (!e) return undefined;
      out.push(e);
      i = best;
    }
  }
  return out;
}
export const sidOwner = (sids: Record<PR, PSid[]>, sid: string) => P_ROUTERS.find((r) => sids[r].some((x) => x.sid === v6norm(sid)));
export function pView(c: PCfg): PView {
  const adj: Record<string, boolean> = {};
  for (const l of P_LINKS) adj[l.id] = adjUp(c, l);
  const sp = {} as PView["spf"];
  for (const r of P_ROUTERS) sp[r] = spf(c, r, (u, i) => c[u].ifs[i.ifn]!.metric);
  const sids = {} as PView["sids"];
  for (const r of P_ROUTERS) {
    sids[r] = [];
    if (!c[r].isisLoc) continue;
    sids[r].push({ sid: fn(r, 1), behavior: "End" });
    // End.X functions follow the interface order and stay put when another adjacency goes down; an adjacency that was
    // re-established may come back with a new function (xfn).
    pIfs(r).forEach((i, k) => {
      if (adj[i.link.id]) sids[r].push({ sid: fn(r, c[r].xfn[i.ifn] ?? 0x40 + k), behavior: "End.X", ifn: i.ifn, peer: i.peer });
    });
    let f = 0x40 + pIfs(r).length + Object.keys(c[r].xfn).length;
    if (r === "R6") sids[r].push({ sid: fn(r, f++), behavior: "End.DT6" });
    if (r === "R1") for (const p of c.R1.policies) sids[r].push({ sid: fn(r, f++), behavior: "End.B6.Encaps", policy: p.name });
  }
  const service = sids.R6.find((x) => x.behavior === "End.DT6")?.sid ?? "";
  const delaySpf = spf(c, "R1", (u, i) => c[u].ifs[i.ifn]!.delay);
  const pols: PPolEval[] = c.R1.policies.map((pol) => {
    const epR = P_ROUTERS.find((r) => P_LO(r) === v6norm(pol.endpoint));
    const cands: PCandEval[] = pol.cands.map((cand) => {
      if (!epR) return { cand, valid: false, why: `end-point ${pol.endpoint} is not a router in the topology`, sids: [] };
      if (!c.R1.isisLoc) return { cand, valid: false, why: "SRv6 is not enabled on the headend", sids: [] };
      if (cand.kind === "explicit") {
        const list = (cand.sids ?? []).map((x) => v6norm(x)).filter((x): x is string => !!x);
        if (!list.length) return { cand, valid: false, why: "empty segment list", sids: [] };
        const missing = list.find((x) => !sidOwner(sids, x));
        if (missing) return { cand, valid: false, why: `SID ${missing} is not in the SR database (no router advertises it)`, sids: list };
        const first = sidOwner(sids, list[0])!;
        if (first !== "R1" && !sp.R1.find((x) => x.dst === first)?.nh) return { cand, valid: false, why: `first SID ${list[0]} is unreachable`, sids: list };
        return { cand, valid: true, sids: list };
      }
      const rt = (cand.metric === "igp" ? sp.R1 : delaySpf).find((x) => x.dst === epR);
      if (!rt) return { cand, valid: false, why: "no path to the end-point", sids: [] };
      const enc = encode(c, sp, sids, rt.path);
      if (!enc) return { cand, valid: false, why: "the path cannot be encoded with SIDs (a router on it has no SRv6)", sids: [] };
      return { cand, valid: true, sids: enc, path: rt.path, cost: rt.cost };
    });
    const active = [...cands].filter((x) => x.valid).sort((a, b) => b.cand.pref - a.cand.pref)[0];
    return { pol, cands, active, up: !!active, bsid: sids.R1.find((x) => x.policy === pol.name)?.sid };
  });
  return { adj, spf: sp, sids, pols, service };
}
export const pSid = (v: PView, r: PR, sid: string) => v.sids[r].find((x) => x.sid === v6norm(sid));
export const llPol = (v: PView) => v.pols.find((p) => p.pol.name === "LOW-LATENCY");
/** What R1 pushes for a receiver: [policy SIDs…, service SID] when steered, else [service SID]. */
export function pSteer(c: PCfg, v: PView, rx: Rx): { sids: string[]; via: string; pol?: PPolEval; why?: string } {
  const colored = !!P_RX[rx].color && c.R6.colorOut;
  if (!v.service) return { sids: [], via: "no service SID", why: "R6 advertises no service SID for the global IPv6 table" };
  if (!colored) return { sids: [v.service], via: P_RX[rx].color ? "not steered — the route carries no color" : "not steered (no color)" };
  const pol = v.pols.find((p) => p.pol.color === P_RX[rx].color && v6norm(p.pol.endpoint) === P_LO("R6"));
  if (!pol) return { sids: [v.service], via: `not steered — no policy with color ${P_RX[rx].color} and end-point ${P_LO("R6")}` };
  if (!pol.up) return { sids: [v.service], via: `not steered — policy ${pol.pol.name} is down`, pol };
  return { sids: [...pol.active!.sids, v.service], via: `policy ${pol.pol.name}, preference ${pol.active!.cand.pref} (${pol.active!.cand.kind})`, pol };
}

// ---------------------------------------------------------------------------------------------------------------
// The data plane
// ---------------------------------------------------------------------------------------------------------------
export interface PHop {
  from: string;
  to: string;
  da: string;
  sl?: number;
  note: string;
}
export interface PWalk {
  hops: PHop[];
  ok: boolean;
  path: string[];
  why?: string;
  ms: number;
}
export function pWalk(c: PCfg, v: PView, sids0: string[], inner: string): PWalk {
  const list = sids0.map((x) => v6norm(x)!);
  let da = list[0];
  const rest = [...list.slice(1)].reverse();
  let sl = rest.length;
  let r: PR = "R1";
  const w: PWalk = { hops: [], ok: false, path: ["CL1", "R1"], ms: 0 };
  const go = (to: PR, note: string) => {
    w.hops.push({ from: r, to, da, sl: sl || undefined, note });
    w.ms += c[r].ifs[pIfTo(r, to)!.ifn]!.delay / 1000;
    r = to;
    w.path.push(to);
  };
  for (let ttl = 0; ttl < 24; ttl++) {
    const s = pSid(v, r, da);
    if (s) {
      if (s.behavior === "End" || s.behavior === "End.X") {
        if (sl === 0) {
          w.why = `${r}: ${da} is ${s.behavior} with no segment left — not a service SID`;
          return w;
        }
        sl -= 1;
        const next = rest[sl];
        w.hops.push({ from: r, to: r, da: next, sl: sl || undefined, note: `${r}: ${da} is its ${s.behavior}${s.peer ? ` toward ${s.peer}` : ""} → SL ${sl + 1}→${sl}, DA = ${next}` });
        da = next;
        if (s.behavior === "End.X") {
          const i = pIfTo(r, s.peer!)!;
          go(i.peer, `${r}: End.X — out ${i.ifn} to ${i.peer}`);
        }
        continue;
      }
      if (s.behavior === "End.DT6") {
        if (sl !== 0) {
          w.why = `${r}: End.DT6 with segments left — dropped`;
          return w;
        }
        const rx = (Object.keys(P_RX) as Rx[]).find((x) => v6norm(P_RX[x].ip) === v6norm(inner));
        w.hops.push({ from: r, to: r, da: inner, note: `${r}: ${da} is End.DT6 (global IPv6 table) → decapsulate, look up ${inner}` });
        if (!rx) {
          w.why = `${r}: the global IPv6 table has no route to ${inner}`;
          return w;
        }
        w.hops.push({ from: r, to: rx, da: inner, note: `${r}: delivered to ${rx}` });
        w.path.push(rx);
        w.ok = true;
        return w;
      }
    }
    const h = v6parse(da);
    const owner = h && P_ROUTERS.find((x) => c[x].isisLoc && h[0] === 0x2001 && h[1] === 0xdb8 && h[2] === 0x100 && h[3] === P_IDX[x]);
    if (owner === r) {
      w.why = `${r} owns ${locPrefix(P_IDX[r])}/64 but has no local SID ${da} — dropped`;
      return w;
    }
    const rt = owner && v.spf[r].find((x) => x.dst === owner);
    if (!rt?.nh) {
      w.why = `${r} has no route to ${da} — dropped`;
      return w;
    }
    go(rt.nh.nh, `${r}: ${da} → ${owner}'s locator → ${rt.nh.nh}`);
  }
  w.why = "Hop limit exceeded";
  return w;
}

// ---------------------------------------------------------------------------------------------------------------
// State and actions
// ---------------------------------------------------------------------------------------------------------------
export interface PSnap {
  view: PView;
}
export interface PTest {
  id: number;
  to: Rx;
  sids: string[];
  via: string;
  ok: boolean;
  path: string[];
  why?: string;
  ms: number;
  activePref?: number;
  trace: PHop[];
  cfgSeq: number;
  t: number;
}
export interface PSys {
  t: number;
  dev: PR;
  kind: "commit" | "adj-up" | "adj-down" | "policy";
  peer?: string;
}
export interface PState extends SpBase<PSnap> {
  cfg: PCfg;
  hist: Record<PR, PRtr[]>;
  view: PView;
  sys: PSys[];
  tests: PTest[];
}
export type PTicketId = "staleendx" | "r3srv6" | "color" | "endpoint" | "pref";
export type PAction =
  | { type: "cfg"; dev: PR; cfg: PRtr; text: string }
  | { type: "set"; changes: { dev: PR; f: (c: PRtr) => void }[]; text: string }
  | { type: "policy"; pol: PPolicy; text: string }
  | { type: "link"; id: string; up: boolean }
  | { type: "flap" }
  | { type: "send"; to: Rx }
  | { type: "ticket"; id: PTicketId };

const cl = (o: PState): PState => ({ ...spClone(o), runs: o.runs, last: o.last });
export function createPNet(seq = 0): PState {
  const cfg = pHealthy();
  const view = pView(cfg);
  const s: PState = { seq, cfgSeq: 0, clock: 3600, runs: [], log: [{ seq, t: 3600, text: "Policy LOW-LATENCY (color 100 → R6) is up on R1: the explicit candidate (preference 200, R3's End.X toward R5) is active.", tone: "info" }], cfg, hist: Object.fromEntries(P_ROUTERS.map((r) => [r, []])) as unknown as Record<PR, PRtr[]>, view, sys: [], tests: [] };
  for (const l of P_LINKS) s.sys.push({ t: 15, dev: l.a, kind: "adj-up", peer: l.b }, { t: 15, dev: l.b, kind: "adj-up", peer: l.a });
  return s;
}
export function pSend(s0: PState, to: Rx): PState {
  const s = cl(s0);
  s.clock += 2;
  const st = pSteer(s.cfg, s.view, to);
  const inner = P_RX[to].ip;
  const w: PWalk = st.sids.length ? pWalk(s.cfg, s.view, st.sids, inner) : { hops: [], ok: false, path: ["CL1", "R1"], why: st.why, ms: 0 };
  w.hops.unshift({ from: "CL1", to: "R1", da: inner, note: `CLIENT1 sends to ${inner}` });
  const snap = { view: s.view };
  const cmd = `CLIENT1 → ${to} (${inner})`;
  const moments: SpMoment<PSnap>[] = [{ tokens: [], lines: [{ text: `R1: ${P_RX[to].net}/64 → ${st.via}: H.Encaps.Red with [${st.sids.join(", ")}].`, tone: "info" }], snap }];
  for (const h of w.hops) moments.push({ tokens: h.from !== h.to ? [{ from: h.from, to: h.to, label: h.from === "CL1" || h.to.startsWith("RX") ? "IPv6" : `DA ${h.da.replace("2001:db8:100:", "…")}${h.sl ? ` SL${h.sl}` : ""}`, color: h.from === "CL1" || h.to.startsWith("RX") ? "green" : h.sl ? "violet" : "cyan" }] : [], lines: [{ text: h.note, tone: "learn" }], snap });
  if (w.why) moments.push({ tokens: [], lines: [{ text: w.why, tone: "warn" }], snap });
  moments.push({ tokens: [], lines: [{ text: w.ok ? `${cmd}: delivered via ${w.path.join(" → ")}, ${w.ms} ms one way.` : `${cmd}: failed — ${w.why}`, tone: w.ok ? "ok" : "bad" }], snap });
  const t: PTest = { id: s.tests.length + 1, to, sids: st.sids, via: st.via, ok: w.ok, path: w.path, why: w.why, ms: w.ms, activePref: st.pol?.active?.cand.pref, trace: w.hops, cfgSeq: s.cfgSeq, t: s.clock };
  s.tests = [...s.tests, t].slice(-40);
  const run: SpRun<PSnap> = { id: s.runs.length + 1 + s.seq * 1000, cmd, kind: "test", moments, ok: w.ok };
  s.runs = [...s.runs, run];
  s.last = run;
  s.log = [...s.log, { seq: s.seq, t: s.clock, text: `${cmd}: ${w.ok ? `${w.ms} ms via ${st.via}` : w.why}`, tone: w.ok ? "ok" : "warn" }];
  return s;
}
function converge(prev: PState, s: PState, why: string, show = true): PState {
  const view = pView(s.cfg);
  s.view = view;
  const snap = { view };
  const lines: { text: string; tone: "ok" | "bad" | "learn" }[] = [];
  for (const l of P_LINKS)
    if (prev.view.adj[l.id] !== view.adj[l.id]) {
      lines.push({ text: `IS-IS ${l.a}–${l.b} ${view.adj[l.id] ? "Up" : "down"}.`, tone: view.adj[l.id] ? "ok" : "bad" });
      s.sys.push({ t: s.clock, dev: l.a, kind: view.adj[l.id] ? "adj-up" : "adj-down", peer: l.b }, { t: s.clock, dev: l.b, kind: view.adj[l.id] ? "adj-up" : "adj-down", peer: l.a });
    }
  for (const p of view.pols) {
    const q = prev.view.pols.find((x) => x.pol.name === p.pol.name);
    const k = (x?: PPolEval) => (x?.active ? `${x.active.cand.pref}:${x.active.sids.join(",")}` : "down");
    if (k(p) !== k(q)) {
      lines.push({ text: p.active ? `R1: policy ${p.pol.name} — preference ${p.active.cand.pref} (${p.active.cand.kind}) active, [${p.active.sids.join(", ")}].` : `R1: policy ${p.pol.name} is down — no valid candidate.`, tone: p.active ? "learn" : "bad" });
      s.sys.push({ t: s.clock, dev: "R1", kind: "policy", peer: p.pol.name });
    }
  }
  if (show && lines.length) {
    const run: SpRun<PSnap> = { id: s.runs.length + 1 + s.seq * 1000, cmd: why, kind: "converge", moments: [{ tokens: [], lines: lines.slice(0, 10), snap }] };
    s.runs = [...s.runs, run];
    s.last = run;
  }
  return s;
}

// ---------------------------------------------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------------------------------------------
export interface PTicketDef {
  id: PTicketId;
  title: string;
  report: string;
  reproLabel: string;
  repro: PAction[];
  fault: (c: PCfg) => void;
}
const sendLL: PAction = { type: "send", to: "RX66" };
export const P_TICKETS: PTicketDef[] = [
  {
    id: "staleendx",
    title: "The engineered path isn't active",
    report: "“After last night's R3–R5 maintenance the link is back, R3 shows its End.X SIDs, IPv6 is fine — but policy LOW-LATENCY runs on its dynamic candidate (preference 100) instead of the explicit one (200).”",
    reproLabel: "send to RX66",
    repro: [sendLL],
    fault: (c) => {
      c.R3.xfn["ge-0/0/1"] = 0x43;
    },
  },
  {
    id: "r3srv6",
    title: "Explicit candidate invalid after an upgrade",
    report: "“R3 was upgraded. Since then LOW-LATENCY uses its dynamic candidate; the explicit one is invalid. Traffic still arrives in 15 ms.”",
    reproLabel: "send to RX66",
    repro: [sendLL],
    fault: (c) => {
      c.R3.isisLoc = false;
    },
  },
  {
    id: "color",
    title: "The app takes the long way",
    report: "“The low-latency app (RX66) sees 60 ms instead of 15. Policy LOW-LATENCY is up with its explicit candidate active. R6's BGP export policy was rewritten.”",
    reproLabel: "send to RX66",
    repro: [sendLL],
    fault: (c) => {
      c.R6.colorOut = false;
    },
  },
  {
    id: "endpoint",
    title: "Re-created, and the app is slow",
    report: "“The controller re-created policy LOW-LATENCY last night. Since then the low-latency app (RX66) sees 60 ms instead of 15. Nothing changed in the network.”",
    reproLabel: "send to RX66",
    repro: [sendLL],
    fault: (c) => {
      c.R1.policies[0].endpoint = "2001:db8::66";
    },
  },
  {
    id: "pref",
    title: "The wrong candidate wins",
    report: "“Both candidates of LOW-LATENCY are valid, yet the dynamic one (preference 100) is active. Someone edited the policy on the controller.”",
    reproLabel: "send to RX66",
    repro: [sendLL],
    fault: (c) => {
      c.R1.policies[0].cands[0].pref = 20;
    },
  },
];
export const pTicket = (id: string) => P_TICKETS.find((t) => t.id === id)!;
export function pTicketState(id: PTicketId, seq = 0): PState {
  const s = createPNet(seq);
  const nx = cl(s);
  pTicket(id).fault(nx.cfg);
  const out = converge(s, nx, "", false);
  out.ticket = id;
  out.runs = [];
  out.last = undefined;
  out.log = [...out.log, { seq, t: out.clock, text: `Ticket opened: ${pTicket(id).title}.`, tone: "warn" }];
  return out;
}
export function pApply(s0: PState, a: PAction): PState {
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
    case "policy": {
      const s = cl(s0);
      const i = s.cfg.R1.policies.findIndex((p) => p.name === a.pol.name);
      if (i >= 0) s.cfg.R1.policies[i] = spClone(a.pol);
      else s.cfg.R1.policies.push(spClone(a.pol));
      s.cfgSeq += 1;
      s.clock += 1;
      s.log = [...s.log, { seq: s.seq, t: s.clock, text: `Controller → R1: ${a.text}`, tone: "info" }];
      return converge(s0, s, `Controller: ${a.text}`);
    }
    case "link": {
      const l = P_LINKS.find((x) => x.id === a.id)!;
      const s = cl(s0);
      s.cfg[l.a].ifs[l.ai]!.isis = a.up;
      s.cfg[l.b].ifs[l.bi]!.isis = a.up;
      s.cfgSeq += 1;
      s.clock += 1;
      s.log = [...s.log, { seq: s.seq, t: s.clock, text: `${l.id} ${a.up ? "restored" : "failed"}.`, tone: a.up ? "ok" : "warn" }];
      return converge(s0, s, `${l.id} ${a.up ? "restored" : "failed"}`);
    }
    case "flap": {
      // R3–R5 goes down and comes back; R3 allocates its End.X toward R5 from the next free function.
      const s = cl(s0);
      const used = new Set(s.view.sids.R3.map((x) => x.sid));
      let f = 0x43;
      while (used.has(`2001:db8:100:3:${f.toString(16)}::`) || Object.values(s.cfg.R3.xfn).includes(f)) f++;
      s.cfg.R3.xfn["ge-0/0/1"] = f;
      s.cfgSeq += 1;
      s.clock += 1;
      s.sys.push({ t: s.clock, dev: "R3", kind: "adj-down", peer: "R5" }, { t: s.clock + 20, dev: "R3", kind: "adj-up", peer: "R5" }, { t: s.clock, dev: "R5", kind: "adj-down", peer: "R3" }, { t: s.clock + 20, dev: "R5", kind: "adj-up", peer: "R3" });
      s.log = [...s.log, { seq: s.seq, t: s.clock, text: `R3–R5 flapped; R3 re-allocated its End.X toward R5 as 2001:db8:100:3:${f.toString(16)}::.`, tone: "warn" }];
      return converge(s0, s, "R3–R5 flap");
    }
    case "send":
      return pSend(s0, a.to);
    case "ticket":
      return pTicketState(a.id, s0.seq + 1);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Diagnosis, proofs, ladder
// ---------------------------------------------------------------------------------------------------------------
export const P_CAUSES: { id: string; label: string }[] = [
  { id: "staleendx", label: "The explicit list names an End.X SID that R3 re-allocated" },
  { id: "r3srv6", label: "R3 no longer runs SRv6, so its End.X SID is gone" },
  { id: "color", label: "R6 no longer colors the app's route" },
  { id: "endpoint", label: "The policy's end-point doesn't match R6" },
  { id: "pref", label: "The explicit candidate's preference is below the dynamic one" },
  { id: "delay", label: "The delay measurement on the bottom links is wrong" },
  { id: "tilfa", label: "TI-LFA moved the traffic" },
];
const lastLL = (s: PState) => s.tests.filter((t) => t.to === "RX66").at(-1);
export function pCauseFeedback(s: PState, cause: string): { right: boolean; text: string } {
  const t = s.ticket as PTicketId | undefined;
  if (cause === t) {
    const txt: Record<PTicketId, string> = {
      staleendx: "Yes. When R3–R5 flapped, R3 re-allocated its End.X SIDs: the one toward R5 is now …:3:43::, not …:3:41::. The explicit segment list still names …:3:41::, which no router advertises — so the explicit candidate is invalid and the dynamic one (100) is active. Dynamic SIDs can change; explicit lists that hard-code them must be updated (or built from the adjacency).",
      r3srv6: "Yes. After the upgrade R3's locator is no longer enabled in IS-IS, so R3 has no End or End.X SIDs at all. The explicit list's End.X SID is gone → invalid. The dynamic candidate still works: its list [R5 End] only needs R3 to forward plain IPv6.",
      color: "Yes. R6's export policy no longer sets color 100 on 2001:db8:66::/64. The policy is fine, but nothing is steered into it: R1 sends the app's traffic with only the service SID, over the IGP's top path — 60 ms.",
      endpoint: "Yes. The re-created policy's end-point is 2001:db8::66 instead of R6's loopback 2001:db8::6. No router owns that address, so neither candidate can be valid and the policy is down — and even if it were up, the app's route (color 100, next hop 2001:db8::6) would match no policy (100, 2001:db8::6). Either way nothing is steered: the IGP path, 60 ms.",
      pref: "Yes. The explicit candidate's preference was changed to 20. Both candidates are valid; the highest preference among the valid ones wins — 100 beats 20.",
    };
    return { right: true, text: txt[t] };
  }
  switch (cause) {
    case "delay":
      return { right: false, text: "The advertised delays are 5 ms on the bottom links, 20 ms on the top — as measured." };
    case "tilfa":
      return { right: false, text: "TI-LFA is local repair after a failure; nothing failed. Candidate selection happens on the headend." };
    case "staleendx":
      return { right: false, text: llPol(s.view)?.cands.find((x) => x.cand.kind === "explicit")?.valid ? "The explicit list's SIDs all exist." : "The explicit list is invalid, but not because of a re-allocated SID — check why." };
    case "r3srv6":
      return { right: false, text: "R3 runs SRv6 (show segment-routing srv6 sid on R3)." };
    case "color":
      return { right: false, text: "R6 still colors 2001:db8:66::/64 with 100." };
    case "endpoint":
      return { right: false, text: "The policy's end-point is R6's loopback 2001:db8::6." };
    case "pref":
      return { right: false, text: "The explicit candidate has preference 200, above the dynamic 100." };
  }
  return { right: false, text: lastLL(s) ? "That doesn't match the evidence." : "Send traffic to RX66 first." };
}
export function pProofs(s: PState): { label: string; ok: boolean; detail: string }[] {
  const t = s.ticket as PTicketId | undefined;
  if (!t) return [];
  const p = llPol(s.view);
  const fresh = s.tests.filter((x) => x.cfgSeq === s.cfgSeq && x.to === "RX66").at(-1);
  const explicitActive = { label: "The explicit candidate (preference 200) is active", ok: p?.active?.cand.kind === "explicit" && p.active.cand.pref === 200, detail: "show segment-routing traffic-eng policy on R1" };
  const fast = { label: "A fresh test to RX66 is steered into the policy, 15 ms", ok: !!fresh?.ok && fresh.ms === 15 && /^policy/.test(fresh.via), detail: "send to RX66 again after the fix" };
  switch (t) {
    case "staleendx":
    case "r3srv6":
    case "pref":
      return [explicitActive, fast];
    case "color":
      return [{ label: "2001:db8:66::/64 carries color 100 on R1", ok: s.cfg.R6.colorOut, detail: "show bgp ipv6 unicast 2001:db8:66::/64 on R1" }, fast];
    case "endpoint":
      return [{ label: "The policy's end-point is 2001:db8::6", ok: v6norm(p?.pol.endpoint ?? "") === P_LO("R6"), detail: "show segment-routing traffic-eng policy on R1" }, fast];
  }
}
export function pLadder(s: PState): { k: string; title: string; text: string }[] {
  const v = s.view;
  const t = lastLL(s);
  const p = llPol(v);
  return [
    { k: "symptom", title: "What does the app see?", text: t ? (t.ok ? `${t.ms} ms via ${t.path.join(" → ")} — ${t.via}.` : `lost — ${t.why}.`) : "Send to RX66 first." },
    { k: "steer", title: "Is the app's route colored and matched to a policy?", text: `${s.cfg.R6.colorOut ? "color 100 on 2001:db8:66::/64" : "no color on 2001:db8:66::/64"}; policy end-point ${p?.pol.endpoint ?? "—"} vs BGP next hop ${P_LO("R6")}.` },
    { k: "policy", title: "Is the policy up, and which candidate is active?", text: p ? (p.active ? `up — preference ${p.active.cand.pref} (${p.active.cand.kind}).` : "down.") : "no policy." },
    { k: "cands", title: "Why is each candidate valid or invalid?", text: p ? p.cands.map((x) => `${x.cand.pref} ${x.cand.kind}: ${x.valid ? `valid [${x.sids.join(", ")}]` : `invalid — ${x.why}`}`).join(" · ") : "—" },
    { k: "sids", title: "Do the explicit list's SIDs exist where they should?", text: p?.cands.filter((x) => x.cand.kind === "explicit").flatMap((x) => (x.cand.sids ?? []).map((y) => `${y} → ${sidOwner(v.sids, y) ? `${pSid(v, sidOwner(v.sids, y)!, y)!.behavior} on ${sidOwner(v.sids, y)}` : "nobody"}`)).join(" · ") || "—" },
    { k: "r3", title: "What are R3's End.X SIDs now?", text: v.sids.R3.filter((x) => x.behavior === "End.X").map((x) => `${x.sid} → ${x.peer}`).join(", ") || "none (no SRv6 on R3)" },
  ];
}
export { locPrefix, v6norm };
