import { spClone, type SpBase, type SpMoment, type SpRun } from "@/components/sp-lab/spKit";
import { locPrefix, v6norm, v6parse } from "./sxNet";

/**
 * SRv6 Endpoint Behaviors Lab network — the guided lesson's hexagon with the R3–R4 cross-link and R6's customers,
 * IS-IS for IPv6 with SRv6 on IOS XR; R6 offers VRF services whose SIDs BGP allocates.
 *
 *            R2 ──10── R3 ───10──── R6 ── CE6   2001:db8:c6::6   (VRF CUST6, Gi0/0/0/2)
 *        10 ╱         20╲         ╱ │ ╲── CE4-A 10.10.1.8         (VRF CUST4, Gi0/0/0/3)
 *   H1 ── R1             ╲       ╱5 │  ╲── CE4-B 10.10.2.8         (VRF CUST4, Gi0/0/0/4)
 *         5 ╲             ╲     ╱
 *            R4 ───5──── R5 ───
 *
 * Endpoint behaviors (RFC 8986), as IOS XR allocates them under locator MAIN (2001:db8:100:N::/64):
 * - IS-IS: End (function 1) and one End.X per adjacency (0x40, 0x41, … in interface order).
 * - BGP on R6: per VRF address family with `segment-routing srv6 locator MAIN` — `alloc mode per-vrf` gives one
 *   End.DT4 (IPv4) / End.DT6 (IPv6) SID per VRF (decapsulate, look the inner packet up in the VRF); `alloc mode per-ce`
 *   gives one End.DX4 / End.DX6 per attached CE (decapsulate, send to that CE — no lookup). Dynamic functions continue
 *   after the End.X SIDs.
 * - Processing: End / End.X need SL > 0 or decapsulate at SL 0 (USD); service behaviors (DT/DX) are valid only as the
 *   last segment (SL 0) and only for the right inner family; DT looks up the VRF, DX delivers to its CE whatever the
 *   inner destination.
 * - R1 sends test traffic from H1 with an explicit segment list (H.Encaps.Red, source 2001:db8::1).
 */

export type EbR = "R1" | "R2" | "R3" | "R4" | "R5" | "R6";
export const EB_ROUTERS: EbR[] = ["R1", "R2", "R3", "R4", "R5", "R6"];
export const EB_IDX: Record<EbR, number> = { R1: 1, R2: 2, R3: 3, R4: 4, R5: 5, R6: 6 };
export const EB_LO = (r: EbR) => `2001:db8::${EB_IDX[r]}`;
export type IfName = "ge-0/0/0" | "ge-0/0/1" | "ge-0/0/2" | "ge-0/0/3" | "ge-0/0/4";
export type Vrf = "CUST4" | "CUST6";
export type CeId = "CE6" | "CE4-A" | "CE4-B";
export const EB_CES: Record<CeId, { ip: string; net: string; len: number; gw: string; ifn: IfName; vrf: Vrf; fam: 4 | 6 }> = {
  CE6: { ip: "2001:db8:c6::6", net: "2001:db8:c6::", len: 64, gw: "2001:db8:c6::1", ifn: "ge-0/0/2", vrf: "CUST6", fam: 6 },
  "CE4-A": { ip: "10.10.1.8", net: "10.10.1.0", len: 24, gw: "10.10.1.1", ifn: "ge-0/0/3", vrf: "CUST4", fam: 4 },
  "CE4-B": { ip: "10.10.2.8", net: "10.10.2.0", len: 24, gw: "10.10.2.1", ifn: "ge-0/0/4", vrf: "CUST4", fam: 4 },
};
export const CE_IDS: CeId[] = ["CE6", "CE4-A", "CE4-B"];
export const H1 = { ip: "2001:db8:1::10", net: "2001:db8:1::", gw: "2001:db8:1::1", ifn: "ge-0/0/2" as IfName };

export interface EbLink {
  id: string;
  a: EbR;
  ai: IfName;
  b: EbR;
  bi: IfName;
  metric: number;
}
export const EB_LINKS: EbLink[] = [
  { id: "R1-R2", a: "R1", ai: "ge-0/0/0", b: "R2", bi: "ge-0/0/0", metric: 10 },
  { id: "R2-R3", a: "R2", ai: "ge-0/0/1", b: "R3", bi: "ge-0/0/0", metric: 10 },
  { id: "R3-R6", a: "R3", ai: "ge-0/0/1", b: "R6", bi: "ge-0/0/0", metric: 10 },
  { id: "R1-R4", a: "R1", ai: "ge-0/0/1", b: "R4", bi: "ge-0/0/0", metric: 5 },
  { id: "R4-R5", a: "R4", ai: "ge-0/0/1", b: "R5", bi: "ge-0/0/0", metric: 5 },
  { id: "R5-R6", a: "R5", ai: "ge-0/0/1", b: "R6", bi: "ge-0/0/1", metric: 5 },
  { id: "R3-R4", a: "R3", ai: "ge-0/0/2", b: "R4", bi: "ge-0/0/2", metric: 20 },
];
export const ebLinkIp = (l: EbLink, r: EbR) => `2001:db8:${EB_IDX[l.a]}${EB_IDX[l.b]}::${EB_IDX[r]}`;
export interface EbIfInfo {
  ifn: IfName;
  ip: string;
  peer: EbR;
  peerIf: IfName;
  peerIp: string;
  link: EbLink;
}
export function ebIfs(r: EbR): EbIfInfo[] {
  return EB_LINKS.flatMap((l) => (l.a === r ? [{ ifn: l.ai, ip: ebLinkIp(l, r), peer: l.b, peerIf: l.bi, peerIp: ebLinkIp(l, l.b), link: l }] : l.b === r ? [{ ifn: l.bi, ip: ebLinkIp(l, r), peer: l.a, peerIf: l.ai, peerIp: ebLinkIp(l, l.a), link: l }] : [])).sort((x, y) => x.ifn.localeCompare(y.ifn));
}
export const ebIfTo = (r: EbR, peer: EbR) => ebIfs(r).find((i) => i.peer === peer);
const fnSid = (loc: number, fn: number) => `2001:db8:100:${loc.toString(16)}:${fn.toString(16)}::`;
export const ebEnd = (r: EbR) => fnSid(EB_IDX[r], 1);

// ---------------------------------------------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------------------------------------------
export interface EbIf {
  isis: boolean;
  metric: number;
}
export interface EbVrfAf {
  /** `segment-routing srv6` under the VRF address family, with this locator name (undefined = not configured). */
  loc?: string;
  mode: "per-vrf" | "per-ce";
}
export interface EbRtr {
  sr6: boolean;
  loc?: number;
  isisLoc: boolean;
  ifs: Partial<Record<IfName, EbIf>>;
  /** R6 only: the VRF of each customer interface (undefined = not in a VRF), and BGP's SRv6 allocation per VRF. */
  ceVrf: Partial<Record<IfName, Vrf | undefined>>;
  vrfs: Partial<Record<Vrf, EbVrfAf>>;
}
export type EbCfg = Record<EbR, EbRtr>;
export function ebHealthy(): EbCfg {
  const c = {} as EbCfg;
  for (const r of EB_ROUTERS) {
    const ifs: Partial<Record<IfName, EbIf>> = {};
    for (const i of ebIfs(r)) ifs[i.ifn] = { isis: true, metric: i.link.metric };
    c[r] = { sr6: true, loc: EB_IDX[r], isisLoc: true, ifs, ceVrf: {}, vrfs: {} };
  }
  c.R6.ceVrf = { "ge-0/0/2": "CUST6", "ge-0/0/3": "CUST4", "ge-0/0/4": "CUST4" };
  c.R6.vrfs = { CUST4: { loc: "MAIN", mode: "per-vrf" }, CUST6: { loc: "MAIN", mode: "per-vrf" } };
  return c;
}

// ---------------------------------------------------------------------------------------------------------------
// Derived state
// ---------------------------------------------------------------------------------------------------------------
export type Behavior = "End" | "End.X" | "End.DT4" | "End.DT6" | "End.DX4" | "End.DX6";
export interface EbSid {
  sid: string;
  behavior: Behavior;
  /** End.X: the adjacency; DT: the VRF; DX: the CE. */
  ifn?: IfName;
  peer?: EbR;
  vrf?: Vrf;
  ce?: CeId;
  owner: "isis-CORE" | "bgp-65000";
}
export interface EbNh {
  nh: EbR;
  ifn: IfName;
}
export interface EbView {
  adj: Record<string, boolean>;
  spf: Record<EbR, { dst: EbR; cost: number; nh?: EbNh; path: EbR[] }[]>;
  sids: Record<EbR, EbSid[]>;
  /** Why a configured VRF has no SID. */
  vrfWhy: Partial<Record<Vrf, string>>;
  /** VRF tables on R6: connected customer prefixes. */
  vrfTable: Record<Vrf, CeId[]>;
}
const adjUp = (c: EbCfg, l: EbLink) => !!c[l.a].ifs[l.ai]?.isis && !!c[l.b].ifs[l.bi]?.isis;
function spf(c: EbCfg, root: EbR) {
  const d = new Map<EbR, { cost: number; prev?: EbR; first?: EbNh }>([[root, { cost: 0 }]]);
  const done = new Set<EbR>();
  while (true) {
    const u = EB_ROUTERS.filter((r) => !done.has(r) && d.has(r)).sort((a, b) => d.get(a)!.cost - d.get(b)!.cost || EB_IDX[a] - EB_IDX[b])[0];
    if (!u) break;
    done.add(u);
    for (const i of ebIfs(u)) {
      if (!adjUp(c, i.link)) continue;
      const cost = d.get(u)!.cost + (c[u].ifs[i.ifn]?.metric ?? 10);
      if (!d.has(i.peer) || cost < d.get(i.peer)!.cost) d.set(i.peer, { cost, prev: u, first: u === root ? { nh: i.peer, ifn: i.ifn } : d.get(u)!.first });
    }
  }
  return EB_ROUTERS.filter((r) => r !== root && d.has(r)).map((r) => {
    const path: EbR[] = [r];
    let x = r;
    while (d.get(x)?.prev) path.unshift((x = d.get(x)!.prev!));
    return { dst: r, cost: d.get(r)!.cost, nh: d.get(r)!.first, path };
  });
}
export const ebAdvertises = (c: EbCfg, r: EbR) => c[r].sr6 && c[r].loc !== undefined && c[r].isisLoc;
export function ebView(c: EbCfg): EbView {
  const adj: Record<string, boolean> = {};
  for (const l of EB_LINKS) adj[l.id] = adjUp(c, l);
  const sp = {} as EbView["spf"];
  for (const r of EB_ROUTERS) sp[r] = spf(c, r);
  const sids = {} as EbView["sids"];
  const vrfWhy: EbView["vrfWhy"] = {};
  const vrfTable: EbView["vrfTable"] = { CUST4: [], CUST6: [] };
  for (const ce of CE_IDS) {
    const v = c.R6.ceVrf[EB_CES[ce].ifn];
    if (v && v === EB_CES[ce].vrf) vrfTable[v].push(ce);
  }
  for (const r of EB_ROUTERS) {
    sids[r] = [];
    if (!ebAdvertises(c, r)) continue;
    const loc = c[r].loc!;
    sids[r].push({ sid: fnSid(loc, 1), behavior: "End", owner: "isis-CORE" });
    // End.X functions follow the interface order and stay put when another adjacency goes down.
    ebIfs(r).forEach((i, k) => {
      if (adj[i.link.id]) sids[r].push({ sid: fnSid(loc, 0x40 + k), behavior: "End.X", ifn: i.ifn, peer: i.peer, owner: "isis-CORE" });
    });
    let fn = 0x40 + ebIfs(r).length;
    if (r !== "R6") continue;
    for (const v of ["CUST4", "CUST6"] as Vrf[]) {
      const af = c.R6.vrfs[v];
      if (!af) continue;
      if (!af.loc) {
        vrfWhy[v] = "no segment-routing srv6 under the VRF address family";
        continue;
      }
      if (af.loc !== "MAIN") {
        vrfWhy[v] = `locator ${af.loc} does not exist`;
        continue;
      }
      if (af.mode === "per-vrf") sids[r].push({ sid: fnSid(loc, fn++), behavior: v === "CUST4" ? "End.DT4" : "End.DT6", vrf: v, owner: "bgp-65000" });
      else for (const ce of vrfTable[v]) sids[r].push({ sid: fnSid(loc, fn++), behavior: v === "CUST4" ? "End.DX4" : "End.DX6", vrf: v, ce, ifn: EB_CES[ce].ifn, owner: "bgp-65000" });
    }
  }
  return { adj, spf: sp, sids, vrfWhy, vrfTable };
}
export const ebSid = (v: EbView, r: EbR, sid: string) => v.sids[r].find((x) => x.sid === v6norm(sid));
export const ebSidOwner = (v: EbView, sid: string) => EB_ROUTERS.find((r) => v.sids[r].some((x) => x.sid === v6norm(sid)));
/** The router whose advertised locator contains this address (by longest match), and the next hop from r. */
export function ebRoute(c: EbCfg, v: EbView, r: EbR, dst: string): { owner?: EbR; nh?: EbNh; own?: boolean } {
  const h = v6parse(dst);
  if (!h) return {};
  const o = EB_ROUTERS.find((x) => ebAdvertises(c, x) && h[0] === 0x2001 && h[1] === 0xdb8 && h[2] === 0x100 && h[3] === c[x].loc);
  if (!o) return {};
  if (o === r) return { owner: o, own: true };
  const rt = v.spf[r].find((x) => x.dst === o);
  return { owner: o, nh: rt?.nh };
}
export const ebBehaviorSid = (v: EbView, b: Behavior, x?: { vrf?: Vrf; ce?: CeId }) => v.sids.R6.find((s) => s.behavior === b && (!x?.vrf || s.vrf === x.vrf) && (!x?.ce || s.ce === x.ce))?.sid;

// ---------------------------------------------------------------------------------------------------------------
// The data plane
// ---------------------------------------------------------------------------------------------------------------
export interface EbHop {
  from: string;
  to: string;
  da: string;
  sl?: number;
  list?: string[];
  outer: boolean;
  note: string;
}
export interface EbWalk {
  hops: EbHop[];
  ok: boolean;
  path: string[];
  why?: string;
  /** Where the inner packet ended up (a CE, possibly the wrong one). */
  deliveredTo?: CeId;
}
export const famOf = (ip: string): 4 | 6 => (ip.includes(":") ? 6 : 4);
const inV4 = (ip: string, net: string, len: number) => {
  const n = (x: string) => x.split(".").reduce((a, o) => a * 256 + +o, 0);
  return Math.floor(n(ip) / 2 ** (32 - len)) === Math.floor(n(net) / 2 ** (32 - len));
};
export const ceOf = (ip: string) => CE_IDS.find((ce) => (EB_CES[ce].fam === 4 ? famOf(ip) === 4 && inV4(ip, EB_CES[ce].net, 24) : v6norm(ip)?.startsWith("2001:db8:c6:")));
export function ebWalk(c: EbCfg, v: EbView, sids0: string[], inner: string): EbWalk {
  const list = sids0.map((x) => v6norm(x)!);
  let da = list[0];
  let srh: { sl: number; list: string[] } | undefined = list.length > 1 ? { sl: list.length - 1, list: [...list.slice(1)].reverse() } : undefined;
  let r: EbR = "R1";
  const w: EbWalk = { hops: [{ from: "H1", to: "R1", da: inner, outer: false, note: `H1 sends to ${inner} (IPv${famOf(inner)})` }], ok: false, path: ["H1", "R1"] };
  const hop = (to: EbR, note: string) => {
    w.hops.push({ from: r, to, da, sl: srh?.sl, list: srh?.list, outer: true, note });
    r = to;
    w.path.push(to);
  };
  for (let ttl = 0; ttl < 24; ttl++) {
    const s = ebSid(v, r, da);
    if (s) {
      const sl = srh?.sl ?? 0;
      if (s.behavior === "End" || s.behavior === "End.X") {
        if (sl > 0) {
          const nsl = sl - 1;
          const next = srh!.list[nsl];
          w.hops.push({ from: r, to: r, da: next, sl: nsl === 0 ? undefined : nsl, list: nsl === 0 ? undefined : srh!.list, outer: true, note: `${r}: ${da} is its ${s.behavior}${s.peer ? ` (toward ${s.peer})` : ""} → Segments Left ${sl} → ${nsl}, DA = ${next}${nsl === 0 ? " (PSP: SRH removed)" : ""}` });
          da = next;
          srh = nsl === 0 ? undefined : { sl: nsl, list: srh!.list };
          if (s.behavior === "End.X") {
            const i = ebIfs(r).find((x) => x.ifn === s.ifn)!;
            hop(i.peer, `${r}: End.X — out ${s.ifn} to ${i.peer}, whatever the routing table says`);
          }
          continue;
        }
        w.why = `${r}: ${da} is a ${s.behavior} SID with no segment left — there is no service behind it, the inner packet is not for ${r}`;
        return w;
      }
      // Service behaviors: final segment only, right family.
      if (sl !== 0) {
        w.why = `${r}: ${da} is ${s.behavior}, but ${sl} segment${sl > 1 ? "s are" : " is"} still left — a decapsulation behavior must be the last segment; dropped`;
        return w;
      }
      const fam = famOf(inner);
      const need = s.behavior.endsWith("4") ? 4 : 6;
      if (fam !== need) {
        w.why = `${r}: ${s.behavior} expects an inner IPv${need} packet, this one is IPv${fam} — dropped`;
        return w;
      }
      if (s.behavior === "End.DT4" || s.behavior === "End.DT6") {
        const ce = v.vrfTable[s.vrf!].find((x) => ceOf(inner) === x);
        w.hops.push({ from: r, to: r, da: inner, outer: false, note: `${r}: ${da} is ${s.behavior} (VRF ${s.vrf}) → outer header removed, look up ${inner} in VRF ${s.vrf}${ce ? ` → ${EB_CES[ce].net}/${EB_CES[ce].len} → ${ce}` : ""}` });
        if (!ce) {
          w.why = `${r}: VRF ${s.vrf} has no route to ${inner} — dropped`;
          return w;
        }
        w.hops.push({ from: r, to: ce, da: inner, outer: false, note: `${r}: delivered to ${ce}` });
        w.path.push(ce);
        w.deliveredTo = ce;
        w.ok = true;
        return w;
      }
      // DX: straight to its CE.
      const ce = s.ce!;
      w.hops.push({ from: r, to: r, da: inner, outer: false, note: `${r}: ${da} is ${s.behavior} toward ${ce} → outer header removed, the inner packet goes to ${ce} without any lookup` });
      w.hops.push({ from: r, to: ce, da: inner, outer: false, note: `${r}: sent to ${ce}` });
      w.path.push(ce);
      w.deliveredTo = ce;
      if (ceOf(inner) !== ce) {
        w.why = `${ce} received a packet for ${inner} — not its address; the wrong customer got it`;
        return w;
      }
      w.ok = true;
      return w;
    }
    const rt = ebRoute(c, v, r, da);
    if (rt.own) {
      w.why = `${r} owns the locator of ${da} but has no such local SID — dropped (ICMPv6 destination unreachable)`;
      return w;
    }
    if (!rt.nh) {
      w.why = `${r} has no route to ${da} — dropped`;
      return w;
    }
    hop(rt.nh.nh, `${r}: ${da} → ${rt.owner}'s locator → plain IPv6 forwarding to ${rt.nh.nh}`);
  }
  w.why = "Hop limit exceeded";
  return w;
}

// ---------------------------------------------------------------------------------------------------------------
// State and actions
// ---------------------------------------------------------------------------------------------------------------
export interface EbSnap {
  view: EbView;
}
export interface EbTest {
  id: number;
  sids: string[];
  inner: string;
  ok: boolean;
  path: string[];
  why?: string;
  deliveredTo?: CeId;
  trace: EbHop[];
  cfgSeq: number;
  t: number;
}
export interface EbSys {
  t: number;
  dev: EbR;
  kind: "commit" | "adj-up" | "adj-down" | "sid";
  peer?: string;
}
export interface EbState extends SpBase<EbSnap> {
  cfg: EbCfg;
  hist: Record<EbR, EbRtr[]>;
  view: EbView;
  sys: EbSys[];
  tests: EbTest[];
  wiped?: boolean;
}
export type EbTicketId = "perce" | "dt6af" | "vrfif" | "endx" | "locname";
export type EbAction =
  | { type: "cfg"; dev: EbR; cfg: EbRtr; text: string }
  | { type: "set"; changes: { dev: EbR; f: (c: EbRtr) => void }[]; text: string }
  | { type: "send"; sids: string[]; inner: string }
  | { type: "ticket"; id: EbTicketId }
  | { type: "wipe-r6" };

const cl = (o: EbState): EbState => ({ ...spClone(o), runs: o.runs, last: o.last });
export function createEbNet(seq = 0): EbState {
  const cfg = ebHealthy();
  const view = ebView(cfg);
  const s: EbState = { seq, cfgSeq: 0, clock: 3600, runs: [], log: [{ seq, t: 3600, text: "SRv6 is up on every router. On R6, BGP allocated End.DT4 for VRF CUST4 and End.DT6 for VRF CUST6.", tone: "info" }], cfg, hist: Object.fromEntries(EB_ROUTERS.map((r) => [r, []])) as unknown as Record<EbR, EbRtr[]>, view, sys: [], tests: [] };
  for (const l of EB_LINKS) s.sys.push({ t: 15, dev: l.a, kind: "adj-up", peer: l.b }, { t: 15, dev: l.b, kind: "adj-up", peer: l.a });
  return s;
}
export function ebSend(s0: EbState, sids0: string[], inner: string): EbState {
  const s = cl(s0);
  s.clock += 2;
  const sids = sids0.map((x) => v6norm(x)).filter((x): x is string => !!x);
  const w = ebWalk(s.cfg, s.view, sids, inner);
  const cmd = `H1 → ${inner} via [${sids.join(", ")}]`;
  const snap = { view: s.view };
  const moments: SpMoment<EbSnap>[] = [{ tokens: [], lines: [{ text: `R1 encapsulates (H.Encaps.Red): DA ${sids[0]}${sids.length > 1 ? `, SRH [${[...sids.slice(1)].reverse().map((x, i) => `${i}: ${x}`).join(", ")}], Segments Left ${sids.length - 1}` : ", no SRH"}.`, tone: "info" }], snap }];
  for (const h of w.hops) moments.push({ tokens: h.from !== h.to ? [{ from: h.from, to: h.to, label: h.outer ? `DA ${h.da.replace("2001:db8:100:", "…")}${h.sl !== undefined ? ` SL${h.sl}` : ""}` : `IPv${famOf(h.da)}`, color: h.outer ? (h.sl !== undefined ? "violet" : "cyan") : "green" }] : [], lines: [{ text: h.note, tone: h.outer ? "learn" : "info" }], snap });
  if (w.why) moments.push({ tokens: [], lines: [{ text: w.why, tone: "warn" }], snap });
  moments.push({ tokens: [], lines: [{ text: w.ok ? `${cmd}: delivered to ${w.deliveredTo}.` : `${cmd}: failed — ${w.why}`, tone: w.ok ? "ok" : "bad" }], snap });
  const t: EbTest = { id: s.tests.length + 1, sids, inner, ok: w.ok, path: w.path, why: w.why, deliveredTo: w.deliveredTo, trace: w.hops, cfgSeq: s.cfgSeq, t: s.clock };
  s.tests = [...s.tests, t].slice(-40);
  const run: SpRun<EbSnap> = { id: s.runs.length + 1 + s.seq * 1000, cmd, kind: "test", moments, ok: w.ok };
  s.runs = [...s.runs, run];
  s.last = run;
  s.log = [...s.log, { seq: s.seq, t: s.clock, text: `${cmd}: ${w.ok ? `delivered to ${w.deliveredTo}` : w.why}`, tone: w.ok ? "ok" : "warn" }];
  return s;
}
function converge(prev: EbState, s: EbState, why: string, show = true): EbState {
  const view = ebView(s.cfg);
  s.view = view;
  const snap = { view };
  const lines: { text: string; tone: "ok" | "bad" | "learn" }[] = [];
  for (const l of EB_LINKS)
    if (prev.view.adj[l.id] !== view.adj[l.id]) {
      lines.push({ text: `IS-IS ${l.a}–${l.b} ${view.adj[l.id] ? "Up" : "down"}.`, tone: view.adj[l.id] ? "ok" : "bad" });
      s.sys.push({ t: s.clock, dev: l.a, kind: view.adj[l.id] ? "adj-up" : "adj-down", peer: l.b }, { t: s.clock, dev: l.b, kind: view.adj[l.id] ? "adj-up" : "adj-down", peer: l.a });
    }
  for (const r of EB_ROUTERS) {
    const k = (x: EbSid) => `${x.sid} ${x.behavior}${x.vrf ? ` ${x.vrf}` : ""}${x.ce ? ` ${x.ce}` : ""}${x.peer ? ` → ${x.peer}` : ""}`;
    const a = new Set(prev.view.sids[r].map(k));
    const b = new Set(view.sids[r].map(k));
    for (const x of b) if (!a.has(x)) lines.push({ text: `${r}: SID ${x} allocated.`, tone: "learn" });
    for (const x of a) if (!b.has(x)) lines.push({ text: `${r}: SID ${x} withdrawn.`, tone: "bad" });
    if ([...a].join() !== [...b].join()) s.sys.push({ t: s.clock, dev: r, kind: "sid" });
  }
  if (show && lines.length) {
    const run: SpRun<EbSnap> = { id: s.runs.length + 1 + s.seq * 1000, cmd: why, kind: "converge", moments: [{ tokens: [], lines: lines.slice(0, 12), snap }] };
    s.runs = [...s.runs, run];
    s.last = run;
  }
  return s;
}

// ---------------------------------------------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------------------------------------------
/** The SIDs in the healthy network (what the runbook documents). */
export const DOC = { endR3: ebEnd("R3"), endXR3R4: fnSid(3, 0x42), dt4: fnSid(6, 0x42), dt6: fnSid(6, 0x43), endR6: ebEnd("R6") };
export interface EbTicketDef {
  id: EbTicketId;
  title: string;
  report: string;
  reproLabel: string;
  repro: EbAction[];
  fault: (c: EbCfg) => void;
}
const send = (sids: string[], inner: string): EbAction => ({ type: "send", sids, inner });
export const EB_TICKETS: EbTicketDef[] = [
  {
    id: "perce",
    title: "CUST4's service SID vanished",
    report: "“Since a BGP template was applied to VRF CUST4 on R6, tests to CE4-B (10.10.2.8) with the documented CUST4 SID 2001:db8:100:6:42:: show up at CE4-A instead — and CE6's tests fail too.”",
    reproLabel: "send [CUST4 SID] to 10.10.2.8",
    repro: [send([DOC.dt4], "10.10.2.8")],
    fault: (c) => {
      c.R6.vrfs.CUST4!.mode = "per-ce";
    },
  },
  {
    id: "dt6af",
    title: "The IPv6 customer is unreachable",
    report: "“Since VRF CUST6 was re-created on R6, nothing reaches CE6 (2001:db8:c6::6) with the documented CUST6 SID. CUST4 works.”",
    reproLabel: "send [CUST6 SID] to 2001:db8:c6::6",
    repro: [send([DOC.dt6], "2001:db8:c6::6")],
    fault: (c) => {
      c.R6.vrfs.CUST6!.loc = undefined;
    },
  },
  {
    id: "vrfif",
    title: "Only CE4-B is lost",
    report: "“Traffic with the CUST4 SID reaches CE4-A but not CE4-B (10.10.2.8). CE4-B's port on R6 was moved to a new line card.”",
    reproLabel: "send [CUST4 SID] to 10.10.2.8",
    repro: [send([DOC.dt4], "10.10.2.8")],
    fault: (c) => {
      c.R6.ceVrf["ge-0/0/4"] = undefined;
    },
  },
  {
    id: "endx",
    title: "Policy B lost at R3",
    report: "“The test path through R3's link to R4 — [R3 End.X → R4, CUST4 SID] — dies at R3. Plain End through R3 works. R3–R4 was re-cabled yesterday.”",
    reproLabel: "send [R3 End.X → R4, CUST4 SID] to 10.10.2.8",
    repro: [send([DOC.endXR3R4, DOC.dt4], "10.10.2.8")],
    fault: (c) => {
      c.R3.ifs["ge-0/0/2"]!.isis = false;
    },
  },
  {
    id: "locname",
    title: "No CUST4 SID after the change",
    report: "“A change on R6 ‘standardized locator names’. Since then CUST4 traffic dies at R6 with the documented SID; End and End.X through R6 still work, and the CUST4 config looks complete.”",
    reproLabel: "send [CUST4 SID] to 10.10.1.8",
    repro: [send([DOC.dt4], "10.10.1.8")],
    fault: (c) => {
      c.R6.vrfs.CUST4!.loc = "MAIN6";
    },
  },
];
export const ebTicket = (id: string) => EB_TICKETS.find((t) => t.id === id)!;
export function ebTicketState(id: EbTicketId, seq = 0): EbState {
  const s = createEbNet(seq);
  const nx = cl(s);
  ebTicket(id).fault(nx.cfg);
  const out = converge(s, nx, "", false);
  out.ticket = id;
  out.runs = [];
  out.last = undefined;
  out.log = [...out.log, { seq, t: out.clock, text: `Ticket opened: ${ebTicket(id).title}.`, tone: "warn" }];
  return out;
}
export function ebApply(s0: EbState, a: EbAction): EbState {
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
    case "wipe-r6": {
      const s = cl(s0);
      s.cfg.R6.vrfs = {};
      s.wiped = true;
      s.cfgSeq += 1;
      s.clock += 1;
      s.log = [...s.log, { seq: s.seq, t: s.clock, text: "R6: SRv6 removed from both VRFs in BGP — rebuild the service SIDs from its console.", tone: "warn" }];
      return converge(s0, s, "R6: VRF SRv6 wiped");
    }
    case "send":
      return ebSend(s0, a.sids, a.inner);
    case "ticket":
      return ebTicketState(a.id, s0.seq + 1);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Diagnosis, proofs, ladder
// ---------------------------------------------------------------------------------------------------------------
export const EB_CAUSES: { id: string; label: string }[] = [
  { id: "perce", label: "VRF CUST4 allocates per CE (End.DX4) instead of per VRF (End.DT4)" },
  { id: "dt6af", label: "VRF CUST6 has no SRv6 under its address family" },
  { id: "vrfif", label: "CE4-B's interface is not in VRF CUST4" },
  { id: "endx", label: "R3's adjacency to R4 is down, so its End.X SID is gone" },
  { id: "locname", label: "VRF CUST4 points to a locator that doesn't exist" },
  { id: "order", label: "The service SID is not the last segment" },
  { id: "family", label: "The inner packet's family doesn't match the behavior" },
];
const lastTest = (s: EbState) => s.tests.at(-1);
export function ebCauseFeedback(s: EbState, cause: string): { right: boolean; text: string } {
  const t = s.ticket as EbTicketId | undefined;
  if (cause === t) {
    const txt: Record<EbTicketId, string> = {
      perce: "Yes. The template set `alloc mode per-ce` on VRF CUST4. BGP now allocates one End.DX4 SID per CE instead of one End.DT4 — and because the SIDs are dynamic, the numbers moved: …:6:42:: is now End.DX4 toward CE4-A, …:6:43:: End.DX4 toward CE4-B, End.DT6 moved to …:6:44::. The documented CUST4 SID now cross-connects everything to CE4-A without a lookup, and the documented CUST6 SID hits an IPv4-only DX4. A DX SID never looks at the inner destination.",
      dt6af: "Yes. The re-created VRF CUST6 has no `segment-routing srv6` / `locator MAIN` under its BGP address family, so BGP allocated no End.DT6 SID. The address …:6:43:: is routed to R6 and dropped there.",
      vrfif: "Yes. CE4-B's interface lost `vrf CUST4` in the move, so 10.10.2.0/24 is no longer in VRF CUST4. R6 executes End.DT4 correctly — decapsulates and looks 10.10.2.8 up in CUST4 — and finds nothing. The SID is fine; the table behind it is incomplete.",
      endx: "Yes. R3's interface toward R4 is no longer in IS-IS, so the adjacency is down and IS-IS withdrew its End.X SID (…:3:42::). The test's first segment no longer exists on R3; R3 drops it. End.X SIDs live and die with their adjacency.",
      locname: "Yes. VRF CUST4's address family now says `locator MAIN6`, but the router's locator is still called MAIN. BGP can't allocate from a locator that doesn't exist, so CUST4 has no End.DT4 SID — and the dynamic numbering shifted CUST6's End.DT6 onto …:6:42::, the documented CUST4 SID, which now rejects IPv4 packets.",
    };
    return { right: true, text: txt[t] };
  }
  switch (cause) {
    case "order":
      return { right: false, text: "The service SID is the last (or only) segment in the test — the final-segment check passes." };
    case "family":
      return { right: false, text: "The inner packet's family matches the service (IPv4 for CUST4, IPv6 for CUST6)." };
    case "perce":
      return { right: false, text: s.cfg.R6.vrfs.CUST4?.mode === "per-vrf" ? "VRF CUST4 allocates per VRF (End.DT4)." : "Check VRF CUST4's alloc mode." };
    case "dt6af":
      return { right: false, text: "VRF CUST6 has SRv6 with locator MAIN under its address family." };
    case "vrfif":
      return { right: false, text: "Every customer interface on R6 is in its VRF." };
    case "endx":
      return { right: false, text: "R3's End.X SIDs are all there, including toward R4." };
    case "locname":
      return { right: false, text: "Both VRFs use locator MAIN, which exists." };
  }
  return { right: false, text: lastTest(s) ? "That doesn't match the evidence." : "Send the test first." };
}
export function ebProofs(s: EbState): { label: string; ok: boolean; detail: string }[] {
  const t = s.ticket as EbTicketId | undefined;
  if (!t) return [];
  const fresh = s.tests.filter((x) => x.cfgSeq === s.cfgSeq);
  const ok = (sids: string[], inner: string) => fresh.some((x) => x.ok && x.sids.join() === sids.join() && x.inner === inner);
  const rep = ebTicket(t).repro[0] as Extract<EbAction, { type: "send" }>;
  const proof = { label: `A fresh test ${rep.inner === "2001:db8:c6::6" ? "to CE6" : `to ${rep.inner}`} with the documented SIDs is delivered`, ok: ok(rep.sids, rep.inner), detail: "send it again after the fix" };
  switch (t) {
    case "perce":
      return [{ label: "R6 has End.DT4 for CUST4 at …:6:42:: again", ok: ebSid(s.view, "R6", DOC.dt4)?.behavior === "End.DT4", detail: "show segment-routing srv6 sid on R6" }, proof];
    case "dt6af":
      return [{ label: "R6 has End.DT6 for CUST6", ok: ebSid(s.view, "R6", DOC.dt6)?.behavior === "End.DT6", detail: "show segment-routing srv6 sid on R6" }, proof];
    case "vrfif":
      return [{ label: "10.10.2.0/24 is in VRF CUST4", ok: s.view.vrfTable.CUST4.includes("CE4-B"), detail: "show route vrf CUST4 on R6" }, proof];
    case "endx":
      return [{ label: "R3 has its End.X toward R4 again", ok: ebSid(s.view, "R3", DOC.endXR3R4)?.peer === "R4", detail: "show segment-routing srv6 sid on R3" }, proof];
    case "locname":
      return [{ label: "VRF CUST4 allocates from locator MAIN", ok: s.cfg.R6.vrfs.CUST4?.loc === "MAIN", detail: "show running-config router bgp on R6" }, proof];
  }
}
export function ebLadder(s: EbState): { k: string; title: string; text: string }[] {
  const v = s.view;
  const t = lastTest(s);
  const svc = t ? t.sids[t.sids.length - 1] : undefined;
  const owner = svc ? ebSidOwner(v, svc) : undefined;
  const ss = owner && svc ? ebSid(v, owner, svc) : undefined;
  return [
    { k: "symptom", title: "Where did the test die?", text: t ? (t.ok ? `Delivered to ${t.deliveredTo} via ${t.path.join(" → ")}.` : `${t.path.at(-1)}: ${t.why}.`) : "Send a test first." },
    { k: "sids", title: "Does every SID in the list exist on its owner?", text: t ? t.sids.map((x) => { const o = ebSidOwner(v, x); return `${x}: ${o ? `${ebSid(v, o, x)!.behavior} on ${o}` : "no router has it"}`; }).join(" · ") : "—" },
    { k: "order", title: "Is the service SID the last segment?", text: t ? (t.sids.slice(0, -1).some((x) => { const o = ebSidOwner(v, x); return o && /DT|DX/.test(ebSid(v, o, x)!.behavior); }) ? "No: a DT/DX SID is not last." : "Yes.") : "—" },
    { k: "family", title: "Does the inner family match the behavior?", text: t && ss && /DT|DX/.test(ss.behavior) ? (famOf(t.inner) === (ss.behavior.endsWith("4") ? 4 : 6) ? `Yes: IPv${famOf(t.inner)} for ${ss.behavior}.` : `No: IPv${famOf(t.inner)} into ${ss.behavior}.`) : "—" },
    { k: "vrf", title: "What do R6's VRFs allocate, and what is in them?", text: (["CUST4", "CUST6"] as Vrf[]).map((x) => `${x}: ${v.sids.R6.filter((y) => y.vrf === x).map((y) => `${y.behavior}${y.ce ? `→${y.ce}` : ""}`).join(", ") || `no SID${v.vrfWhy[x] ? ` (${v.vrfWhy[x]})` : ""}`}; routes ${v.vrfTable[x].join(", ") || "none"}`).join(" · ") },
    { k: "endx", title: "Are R3's End.X SIDs all there?", text: v.sids.R3.filter((x) => x.behavior === "End.X").map((x) => `${x.sid} → ${x.peer}`).join(", ") || "none" },
  ];
}
export { locPrefix, v6norm };
