import { spClone, type SpBase, type SpMoment, type SpRun } from "@/components/sp-lab/spKit";
import { v6norm, v6parse } from "./sxNet";

/**
 * SRv6 uSID Lab — compressed SRv6 (RFC 9800 NEXT-CSID, IOS XR "micro-segment" F3216) as one model: locators, uSIDs,
 * the headend's carrier packing, every hop's shift, MTU, policy and VPN traffic.
 *
 *   CE1 ─ R1 ─ R2 ─ R3 ─ R4 ─ R5 ─ R6 ─ R7 ─ R8 ─ CE8        chain: metric 10, 2 ms per link
 *                    └─ (50, 3 ms) ─┘   └─ (50, 1 ms) ─┘      R3–R5 alternate, R6–R8 express (low delay, high metric)
 *
 * - Format F3216: block fcbb:bb00::/32 + 16-bit uSIDs; a 128-bit carrier holds 6 uSIDs. Each router's locator MAIN is
 *   fcbb:bb00:N::/48 with `micro-segment behavior unode psp-usd` (micro) → uN fcbb:bb00:N::, uA fcbb:bb00:N:e00k::
 *   (local ID block, per interface), PE uDT4 for VRF CUST after the uAs. Without micro the locator is classic: End
 *   fcbb:bb00:N:1::, End.X fcbb:bb00:N:4k:: (one SID per 128-bit entry, cannot be packed).
 * - R1 steers CUST traffic to R8 (color 10, uDT4 fcbb:bb00:8:e002::) into policy GREEN, explicit segment list PATH-A.
 *   With `sid-format usid-f3216` R1 packs consecutive uSID SIDs (same block) into carriers of 6 uSIDs, never splitting
 *   a SID; a classic SID (or no sid-format) takes a whole 128-bit entry. Only the first SID is verified (reachable).
 * - Data plane: H.Encaps.Red (DA = first entry, SRH = the rest). At each router: active uSID = DA bits 32–47. Own uN /
 *   local uA/uDT4 → execute: shift the remaining uSIDs left (Segments Left unchanged); carrier exhausted → next SRH
 *   entry (SL−1); uA forwards out its adjacency; uDT4 decapsulates. Else route the DA on the /48 locators.
 * - Overhead = 40 (outer IPv6) + SRH (8 + 16 × remaining entries); core IPv6 MTU 1500 — a 1430-byte packet fits only
 *   with 64 bytes of overhead or less.
 */

export type UR = "R1" | "R2" | "R3" | "R4" | "R5" | "R6" | "R7" | "R8";
export const U_ROUTERS: UR[] = ["R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8"];
export const U_N: Record<UR, number> = { R1: 1, R2: 2, R3: 3, R4: 4, R5: 5, R6: 6, R7: 7, R8: 8 };
export const U_LO = (r: UR) => `2001:db8::${U_N[r]}`;
export const BLOCK = [0xfcbb, 0xbb00];
export const BLOCK_TEXT = "fcbb:bb00::/32";
export const CAP = 6;
export const MTU6 = 1500;
export const hx = (n: number) => n.toString(16);
export const locOf = (r: UR) => `fcbb:bb00:${U_N[r]}::`;
export const uN = (r: UR) => `fcbb:bb00:${U_N[r]}::`;
export type IfName = "ge-0/0/0" | "ge-0/0/1" | "ge-0/0/2" | "ge-0/0/3";
export const CE = { CE1: { r: "R1" as UR, host: "10.1.1.10", lan: "10.1.1.0/24" }, CE8: { r: "R8" as UR, host: "10.8.1.10", lan: "10.8.1.0/24" } };

export interface ULink {
  id: string;
  a: UR;
  ai: IfName;
  b: UR;
  bi: IfName;
  metric: number;
  ms: number;
}
export const U_LINKS: ULink[] = [
  { id: "R1-R2", a: "R1", ai: "ge-0/0/0", b: "R2", bi: "ge-0/0/0", metric: 10, ms: 2 },
  { id: "R2-R3", a: "R2", ai: "ge-0/0/1", b: "R3", bi: "ge-0/0/0", metric: 10, ms: 2 },
  { id: "R3-R4", a: "R3", ai: "ge-0/0/1", b: "R4", bi: "ge-0/0/0", metric: 10, ms: 2 },
  { id: "R4-R5", a: "R4", ai: "ge-0/0/1", b: "R5", bi: "ge-0/0/0", metric: 10, ms: 2 },
  { id: "R5-R6", a: "R5", ai: "ge-0/0/1", b: "R6", bi: "ge-0/0/0", metric: 10, ms: 2 },
  { id: "R6-R7", a: "R6", ai: "ge-0/0/1", b: "R7", bi: "ge-0/0/0", metric: 10, ms: 2 },
  { id: "R7-R8", a: "R7", ai: "ge-0/0/1", b: "R8", bi: "ge-0/0/0", metric: 10, ms: 2 },
  { id: "R3-R5", a: "R3", ai: "ge-0/0/2", b: "R5", bi: "ge-0/0/2", metric: 50, ms: 3 },
  { id: "R6-R8", a: "R6", ai: "ge-0/0/2", b: "R8", bi: "ge-0/0/1", metric: 50, ms: 1 },
];
export interface UIfInfo {
  ifn: IfName;
  peer: UR;
  link: ULink;
}
export function uIfs(r: UR): UIfInfo[] {
  return U_LINKS.flatMap((l) => (l.a === r ? [{ ifn: l.ai, peer: l.b, link: l }] : l.b === r ? [{ ifn: l.bi, peer: l.a, link: l }] : [])).sort((x, y) => x.ifn.localeCompare(y.ifn));
}
export const uIfTo = (r: UR, p: UR) => uIfs(r).find((i) => i.peer === p);
export const linkIp = (l: ULink, r: UR) => `2001:db8:30:${U_LINKS.indexOf(l) + 1}::${l.a === r ? 1 : 2}`;

// ---------------------------------------------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------------------------------------------
export interface UEntry {
  idx: number;
  sid: string;
}
export interface URtr {
  micro: boolean;
  isisLoc: boolean;
  /** uA (or End.X) function overrides after an adjacency was re-created. */
  xfn: Partial<Record<IfName, number>>;
  /** R1 only. */
  fmt?: boolean;
  lists?: Record<string, UEntry[]>;
}
export type UCfg = Record<UR, URtr>;
export const LIST = "PATH-A";
export const HEALTHY_LIST: UEntry[] = [
  { idx: 10, sid: "fcbb:bb00:2::" },
  { idx: 20, sid: "fcbb:bb00:3::" },
  { idx: 30, sid: "fcbb:bb00:4::" },
  { idx: 40, sid: "fcbb:bb00:5::" },
  { idx: 50, sid: "fcbb:bb00:6:e002::" },
];
export function uHealthy(): UCfg {
  const c = {} as UCfg;
  for (const r of U_ROUTERS) c[r] = { micro: true, isisLoc: true, xfn: {} };
  c.R1.fmt = true;
  c.R1.lists = { [LIST]: spClone(HEALTHY_LIST) };
  return c;
}

// ---------------------------------------------------------------------------------------------------------------
// Derived state
// ---------------------------------------------------------------------------------------------------------------
export type UBeh = "uN" | "uA" | "uDT4" | "uB6" | "End" | "End.X" | "End.DT4" | "End.B6";
export interface USid {
  sid: string;
  behavior: UBeh;
  micro: boolean;
  ifn?: IfName;
  peer?: UR;
  /** The 16-bit uSID(s) this SID contributes to a carrier (micro only). */
  usids?: number[];
}
export interface URoute {
  dst: UR;
  cost: number;
  nh?: { r: UR; ifn: IfName };
  path: UR[];
}
export interface UCarrier {
  hextets: number[];
  text: string;
  usids: number[];
  sids: string[];
  classic: boolean;
}
export interface UEncoding {
  sids: string[]; // the SID list in order (policy SIDs + service SID)
  entries: UCarrier[];
  classicEntries: number; // 1 per SID
  srhBytes: number;
  overhead: number;
  classicSrhBytes: number;
  classicOverhead: number;
  why?: string;
}
export interface UPolicy {
  up: boolean;
  why?: string;
  sids: string[];
}
export interface UView {
  adj: Record<string, boolean>;
  rib: Record<UR, URoute[]>;
  sids: Record<UR, USid[]>;
  service: string;
  policy: UPolicy;
  green: UEncoding; // what R1 pushes for CUST → R8
}
const adjUp = (c: UCfg, l: ULink) => !!l && !!c[l.a] && !!c[l.b];
function spf(root: UR): URoute[] {
  const d = new Map<UR, { cost: number; prev?: UR; first?: { r: UR; ifn: IfName } }>([[root, { cost: 0 }]]);
  const done = new Set<UR>();
  while (done.size < U_ROUTERS.length) {
    const u = U_ROUTERS.filter((r) => !done.has(r) && d.has(r)).sort((a, b) => d.get(a)!.cost - d.get(b)!.cost || U_N[a] - U_N[b])[0];
    if (!u) break;
    done.add(u);
    for (const i of uIfs(u)) {
      const cost = d.get(u)!.cost + i.link.metric;
      if (!d.has(i.peer) || cost < d.get(i.peer)!.cost) d.set(i.peer, { cost, prev: u, first: u === root ? { r: i.peer, ifn: i.ifn } : d.get(u)!.first });
    }
  }
  return U_ROUTERS.filter((r) => r !== root && d.has(r)).map((r) => {
    const path: UR[] = [r];
    let x = r;
    while (d.get(x)?.prev) path.unshift((x = d.get(x)!.prev!));
    return { dst: r, cost: d.get(r)!.cost, nh: d.get(r)!.first, path };
  });
}
export const fmtSid = (h: number[]) => {
  const parts = h.map((x) => hx(x));
  let end = parts.length;
  while (end > 0 && parts[end - 1] === "0") end--;
  if (end === parts.length) return parts.join(":");
  return `${parts.slice(0, end).join(":")}::`;
};
export const hext = (ip: string) => v6parse(ip) ?? [0, 0, 0, 0, 0, 0, 0, 0];
const ownerOfNode = (n: number) => U_ROUTERS.find((r) => U_N[r] === n);
export function uView(c: UCfg): UView {
  const adj: Record<string, boolean> = {};
  for (const l of U_LINKS) adj[l.id] = adjUp(c, l);
  const rib = {} as UView["rib"];
  for (const r of U_ROUTERS) rib[r] = spf(r);
  const sids = {} as UView["sids"];
  for (const r of U_ROUTERS) {
    const n = U_N[r];
    const ifs = uIfs(r);
    const list: USid[] = [];
    if (c[r].micro) {
      list.push({ sid: uN(r), behavior: "uN", micro: true, usids: [n] });
      ifs.forEach((i, k) => {
        const f = c[r].xfn[i.ifn] ?? 0xe000 + k;
        list.push({ sid: `fcbb:bb00:${n}:${hx(f)}::`, behavior: "uA", micro: true, ifn: i.ifn, peer: i.peer, usids: [n, f] });
      });
      if (r === "R8" || r === "R1") list.push({ sid: `fcbb:bb00:${n}:${hx(0xe000 + ifs.length)}::`, behavior: "uDT4", micro: true, usids: [n, 0xe000 + ifs.length] });
      if (r === "R1") list.push({ sid: `fcbb:bb00:${n}:${hx(0xe001 + ifs.length)}::`, behavior: "uB6", micro: true, usids: [n, 0xe001 + ifs.length] });
    } else {
      list.push({ sid: `fcbb:bb00:${n}:1::`, behavior: "End", micro: false });
      ifs.forEach((i, k) => list.push({ sid: `fcbb:bb00:${n}:${hx(0x40 + k)}::`, behavior: "End.X", micro: false, ifn: i.ifn, peer: i.peer }));
      if (r === "R8" || r === "R1") list.push({ sid: `fcbb:bb00:${n}:${hx(0x40 + ifs.length)}::`, behavior: "End.DT4", micro: false });
      if (r === "R1") list.push({ sid: `fcbb:bb00:${n}:${hx(0x41 + ifs.length)}::`, behavior: "End.B6", micro: false });
    }
    sids[r] = list;
  }
  const service = sids.R8.find((x) => x.behavior === "uDT4" || x.behavior === "End.DT4")!.sid;
  // Policy GREEN: explicit PATH-A, verified at the first SID only.
  const entries = [...(c.R1.lists?.[LIST] ?? [])].sort((a, b) => a.idx - b.idx);
  const psids = entries.map((e) => v6norm(e.sid) ?? e.sid);
  let policy: UPolicy;
  if (!psids.length) policy = { up: false, why: "segment list PATH-A is empty", sids: [] };
  else {
    const first = sidOwner(sids, psids[0]);
    const firstRoute = ownerByLocator(psids[0]);
    policy = !first && !firstRoute ? { up: false, why: `first SID ${psids[0]} is unreachable`, sids: psids } : firstRoute && !c[firstRoute].isisLoc ? { up: false, why: `first SID ${psids[0]} is unreachable (no route to its locator)`, sids: psids } : { up: true, sids: psids };
  }
  const green = encode(c, sids, policy.up ? [...psids, service] : [service]);
  return { adj, rib, sids, service, policy, green };
}
export const sidOwner = (sids: Record<UR, USid[]>, sid: string) => U_ROUTERS.find((r) => sids[r].some((x) => x.sid === v6norm(sid)));
/** The router whose /48 locator covers an address (block fcbb:bb00, third hextet = node). */
export const ownerByLocator = (ip: string): UR | undefined => {
  const h = v6parse(ip);
  return h && h[0] === BLOCK[0] && h[1] === BLOCK[1] ? ownerOfNode(h[2]) : undefined;
};
/** The headend's encoding of a SID list: carriers of uSIDs (with sid-format) or one 128-bit entry per SID. */
export function encode(c: UCfg, sids: Record<UR, USid[]>, list: string[]): UEncoding {
  const entries: UCarrier[] = [];
  let cur: { usids: number[]; sids: string[] } | undefined;
  const flush = () => {
    if (!cur) return;
    const h = [...BLOCK, ...cur.usids];
    while (h.length < 8) h.push(0);
    entries.push({ hextets: h, text: fmtSid(h), usids: cur.usids, sids: cur.sids, classic: false });
    cur = undefined;
  };
  for (const s of list) {
    const o = sidOwner(sids, s);
    const x = o ? sids[o].find((y) => y.sid === v6norm(s)) : undefined;
    const us = x?.micro ? x.usids : undefined;
    const h = hext(s);
    // A uSID-format SID with no owner (stale): still a well-formed uSID SID — its uSIDs come from its own bits.
    const parsed = !x && h[0] === BLOCK[0] && h[1] === BLOCK[1] && h.slice(4).every((y) => y === 0) ? h.slice(2, 4).filter((y, i) => i === 0 || y !== 0) : undefined;
    const u = us ?? parsed;
    if (c.R1.fmt && u) {
      if (cur && cur.usids.length + u.length > CAP) flush();
      if (!cur) cur = { usids: [], sids: [] };
      cur.usids.push(...u);
      cur.sids.push(v6norm(s)!);
      continue;
    }
    flush();
    entries.push({ hextets: h, text: v6norm(s) ?? s, usids: [], sids: [v6norm(s) ?? s], classic: true });
  }
  flush();
  const srh = (n: number) => (n > 1 ? 8 + 16 * (n - 1) : 0);
  return { sids: list.map((s) => v6norm(s) ?? s), entries, classicEntries: list.length, srhBytes: srh(entries.length), overhead: 40 + srh(entries.length), classicSrhBytes: srh(list.length), classicOverhead: 40 + srh(list.length) };
}
export const localSid = (v: UView, r: UR, ip: string): USid | undefined => {
  const h = hext(ip);
  if (h[0] !== BLOCK[0] || h[1] !== BLOCK[1]) return undefined;
  // micro SIDs match on block + active uSID (/48); classic SIDs on the full SID.
  const exact = v.sids[r].find((x) => !x.micro && x.sid === v6norm(ip));
  if (exact) return exact;
  const active = h[2];
  if (active === U_N[r]) return v.sids[r].find((x) => x.behavior === "uN");
  return v.sids[r].find((x) => x.micro && x.behavior !== "uN" && x.behavior !== "uB6" && x.usids![1] === active);
};

// ---------------------------------------------------------------------------------------------------------------
// The data plane
// ---------------------------------------------------------------------------------------------------------------
export interface UHop {
  at: UR | "CE1" | "CE8";
  to?: UR | "CE1" | "CE8";
  da?: string;
  sl?: number;
  srh: string[];
  active?: string;
  note: string;
  kind: "fwd" | "exec" | "shift" | "next" | "deliver" | "drop" | "encap";
}
export interface UWalk {
  ok: boolean;
  path: string[];
  hops: UHop[];
  ms: number;
  why?: string;
  bytes: number;
}
export function uWalk(c: UCfg, v: UView, size: number): UWalk {
  const enc = v.green;
  const w: UWalk = { ok: false, path: ["CE1", "R1"], hops: [], ms: 0, bytes: size + enc.overhead };
  const ent = enc.entries.map((e) => [...e.hextets]);
  let da = ent[0];
  let sl = ent.length - 1;
  const rest = () => ent.slice(1, sl + 1).map((x) => fmtSid(x)).reverse();
  w.hops.push({ at: "CE1", to: "R1", srh: [], note: `CE1 sends a ${size}-byte IPv4 packet to ${CE.CE8.host}`, kind: "fwd" });
  w.hops.push({ at: "R1", da: fmtSid(da), sl, srh: rest(), active: hx(da[2]), note: `R1: VRF CUST → ${CE.CE8.lan} via R8, color 10 → ${v.policy.up ? "policy GREEN" : `not steered (${v.policy.why})`}; H.Encaps.Red: DA ${fmtSid(da)}${sl ? `, SRH with ${sl} entr${sl > 1 ? "ies" : "y"}` : ", no SRH"} — ${w.bytes} bytes on the wire`, kind: "encap" });
  if (w.bytes > MTU6) {
    w.why = `R1: ${w.bytes} bytes exceeds the core IPv6 MTU of ${MTU6} (overhead ${enc.overhead} bytes) — dropped (ICMP packet too big)`;
    w.hops.push({ at: "R1", srh: [], note: w.why, kind: "drop" });
    return w;
  }
  let r: UR = "R1";
  const go = (to: UR, note: string) => {
    w.hops.push({ at: r, to, da: fmtSid(da), sl, srh: rest(), active: hx(da[2]), note, kind: "fwd" });
    w.ms += uIfTo(r, to)!.link.ms;
    r = to;
    w.path.push(to);
  };
  const advance = (ls: USid): boolean => {
    // shift within the carrier, or move to the next SRH entry
    const remaining = da.slice(3);
    if (ls.micro && remaining.some((x) => x !== 0)) {
      da = [...BLOCK, ...remaining, 0];
      w.hops.push({ at: r, da: fmtSid(da), sl, srh: rest(), active: hx(da[2]), note: `${r}: ${ls.behavior} → shift: next uSID ${hx(da[2])} becomes active (Segments Left stays ${sl})`, kind: "shift" });
      return true;
    }
    if (sl > 0) {
      sl -= 1;
      da = [...ent[ent.length - 1 - sl]];
      w.hops.push({ at: r, da: fmtSid(da), sl, srh: rest(), active: hx(da[2]), note: `${r}: ${ls.micro ? "carrier exhausted" : ls.behavior} → copy the next SRH entry into the DA: ${fmtSid(da)} (Segments Left ${sl + 1} → ${sl})`, kind: "next" });
      return true;
    }
    return false;
  };
  for (let ttl = 0; ttl < 40; ttl++) {
    const ls = localSid(v, r, fmtSid(da));
    if (ls) {
      if (ls.behavior === "uDT4" || ls.behavior === "End.DT4") {
        const last = da.slice(3).every((x) => x === 0) && sl === 0;
        if (!last && ls.micro) {
          w.why = `${r}: uDT4 is not the last uSID — dropped`;
          w.hops.push({ at: r, srh: [], note: w.why, kind: "drop" });
          return w;
        }
        w.hops.push({ at: r, srh: [], note: `${r}: ${fmtSid(da)} → ${ls.behavior} (VRF CUST) → decapsulate, look up ${CE.CE8.host}`, kind: "exec" });
        w.hops.push({ at: r, to: "CE8", srh: [], note: `${r} → CE8: delivered`, kind: "deliver" });
        w.path.push("CE8");
        w.ok = true;
        return w;
      }
      w.hops.push({ at: r, da: fmtSid(da), sl, srh: rest(), active: hx(da[2]), note: `${r}: active ${ls.micro ? `uSID ${hx(da[2])}` : `SID ${fmtSid(da)}`} matches its ${ls.behavior}${ls.peer ? ` toward ${ls.peer}` : ""}`, kind: "exec" });
      if (!advance(ls)) {
        w.why = `${r}: ${ls.behavior} with nothing left to execute — dropped`;
        w.hops.push({ at: r, srh: [], note: w.why, kind: "drop" });
        return w;
      }
      if (ls.behavior === "uA" || ls.behavior === "End.X") {
        go(ls.peer!, `${r}: ${ls.behavior} — out ${ls.ifn} to ${ls.peer}`);
      }
      continue;
    }
    const o = ownerByLocator(fmtSid(da));
    if (o === r) {
      w.why = `${r}: no local SID for ${fmtSid(da)} (active ${hx(da[2])}) — dropped`;
      w.hops.push({ at: r, srh: [], note: w.why, kind: "drop" });
      return w;
    }
    const rt = o && c[o].isisLoc ? v.rib[r].find((x) => x.dst === o) : undefined;
    if (!rt?.nh) {
      w.why = `${r}: no route to ${fmtSid(da)} — the active uSID ${hx(da[2])} is ${o ? `${o}'s, but its locator is not in IS-IS` : "not a node: a local uSID only means something at its own router"} — dropped`;
      w.hops.push({ at: r, srh: [], note: w.why, kind: "drop" });
      return w;
    }
    go(rt.nh.r, `${r}: DA ${fmtSid(da)} → ${o}'s locator ${locOf(o!)}/48 → ${rt.nh.r}`);
  }
  w.why = "hop limit exceeded";
  return w;
}

// ---------------------------------------------------------------------------------------------------------------
// State and actions
// ---------------------------------------------------------------------------------------------------------------
export interface USnap {
  view: UView;
}
export interface UTest {
  id: number;
  size: number;
  walk: UWalk;
  entries: number;
  overhead: number;
  steered: boolean;
  cfgSeq: number;
}
export interface USys {
  t: number;
  dev: UR;
  kind: "commit" | "adj-up" | "policy";
  peer?: string;
}
export interface UState extends SpBase<USnap> {
  cfg: UCfg;
  hist: Record<UR, URtr[]>;
  view: UView;
  sys: USys[];
  tests: UTest[];
  /** Set when PATH-A was emptied with the "Empty PATH-A" action (the rebuild challenge). */
  wiped?: boolean;
}
export type UTicketId = "usidloc" | "order" | "stalelib" | "r2loc" | "format";
export type UAction =
  | { type: "cfg"; dev: UR; cfg: URtr; text: string }
  | { type: "set"; changes: { dev: UR; f: (c: URtr) => void }[]; text: string }
  | { type: "ping"; size: number }
  | { type: "wipe-list" }
  | { type: "ticket"; id: UTicketId };

const cl = (o: UState): UState => ({ ...spClone(o), runs: o.runs, last: o.last });
export function createUNet(seq = 0): UState {
  const cfg = uHealthy();
  const s: UState = { seq, cfgSeq: 0, clock: 3600, runs: [], log: [{ seq, t: 3600, text: "Every locator runs micro-segment (uSID F3216); R1 packs policy GREEN's segment list into 2 carriers.", tone: "info" }], cfg, hist: Object.fromEntries(U_ROUTERS.map((r) => [r, []])) as unknown as Record<UR, URtr[]>, view: uView(cfg), sys: [], tests: [] };
  for (const l of U_LINKS) s.sys.push({ t: 15, dev: l.a, kind: "adj-up", peer: l.b }, { t: 15, dev: l.b, kind: "adj-up", peer: l.a });
  return s;
}
const short = (x?: string) => (x ?? "").replace("fcbb:bb00:", "…:");
export function uPing(s0: UState, size: number): UState {
  const s = cl(s0);
  s.clock += 2;
  const w = uWalk(s.cfg, s.view, size);
  const t: UTest = { id: s.tests.length + 1, size, walk: w, entries: s.view.green.entries.length, overhead: s.view.green.overhead, steered: s.view.policy.up, cfgSeq: s.cfgSeq };
  s.tests = [...s.tests, t].slice(-40);
  const snap = { view: s.view };
  const moments: SpMoment<USnap>[] = w.hops.map((h) => ({ tokens: h.to && h.at !== h.to ? [{ from: h.at, to: h.to, label: h.da ? `DA ${short(h.da)}` : "IPv4", color: h.da ? "violet" : "green" }] : [], lines: [{ text: h.note, tone: h.kind === "drop" ? "warn" : h.kind === "shift" || h.kind === "next" ? "learn" : "info" }], snap }));
  moments.push({ tokens: [], lines: [{ text: w.ok ? `CE1 → CE8 (${size} B): delivered via ${w.path.join(" → ")}, ${w.ms} ms.` : `CE1 → CE8 (${size} B): failed — ${w.why}`, tone: w.ok ? "ok" : "bad" }], snap });
  const run: SpRun<USnap> = { id: s.runs.length + 1 + s.seq * 1000, cmd: `CE1 → CE8 (${size} B)`, kind: "test", moments, ok: w.ok };
  s.runs = [...s.runs, run];
  s.last = run;
  s.log = [...s.log, { seq: s.seq, t: s.clock, text: `CE1 → CE8 ${size} B: ${w.ok ? `delivered, ${w.ms} ms, ${t.entries} entr${t.entries > 1 ? "ies" : "y"}` : w.why}`, tone: w.ok ? "ok" : "warn" }];
  return s;
}
function converge(prev: UState, s: UState, why: string, show = true): UState {
  const view = uView(s.cfg);
  s.view = view;
  const lines: { text: string; tone: "ok" | "bad" | "learn" }[] = [];
  const k = (v: UView) => v.green.entries.map((e) => e.text).join(" | ");
  if (k(prev.view) !== k(view)) lines.push({ text: `R1 now pushes ${view.green.entries.length} entr${view.green.entries.length > 1 ? "ies" : "y"}: ${view.green.entries.map((e) => short(e.text)).join(" | ")} (overhead ${view.green.overhead} B).`, tone: "learn" });
  if (prev.view.policy.up !== view.policy.up) {
    lines.push({ text: `Policy GREEN ${view.policy.up ? "up" : `down — ${view.policy.why}`}.`, tone: view.policy.up ? "ok" : "bad" });
    s.sys.push({ t: s.clock, dev: "R1", kind: "policy", peer: "GREEN" });
  }
  if (show && lines.length) {
    const run: SpRun<USnap> = { id: s.runs.length + 1 + s.seq * 1000, cmd: why, kind: "converge", moments: [{ tokens: [], lines, snap: { view } }] };
    s.runs = [...s.runs, run];
    s.last = run;
  }
  return s;
}

// ---------------------------------------------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------------------------------------------
export interface UTicketDef {
  id: UTicketId;
  title: string;
  report: string;
  reproLabel: string;
  repro: UAction[];
  fault: (c: UCfg) => void;
}
const small: UAction = { type: "ping", size: 100 };
const big: UAction = { type: "ping", size: 1430 };
const setIdx = (c: UCfg, idx: number, sid: string) => {
  const e = c.R1.lists![LIST].find((x) => x.idx === idx);
  if (e) e.sid = sid;
};
export const U_TICKETS: UTicketDef[] = [
  {
    id: "usidloc",
    title: "Big packets die after R4's maintenance",
    report: "“Since last night's work on R4, CUST's 1430-byte transfers between site 1 and site 8 fail; small pings work. The provisioning tool says it re-synchronized PATH-A with the SIDs R4 now advertises.”",
    reproLabel: "ping 100 B and 1430 B",
    repro: [small, big],
    fault: (c) => {
      c.R4.micro = false;
      setIdx(c, 30, "fcbb:bb00:4:1::");
    },
  },
  {
    id: "order",
    title: "GREEN got slower",
    report: "“GREEN's latency from site 1 to site 8 went from 11 to 15 ms after a change to PATH-A. Nothing is down. The R4–R5 link is suddenly carrying GREEN three times.”",
    reproLabel: "ping 100 B",
    repro: [small],
    fault: (c) => {
      setIdx(c, 30, "fcbb:bb00:5::");
      setIdx(c, 40, "fcbb:bb00:4::");
    },
  },
  {
    id: "stalelib",
    title: "GREEN dies at R6",
    report: "“After R6's line card toward R8 was replaced, all GREEN traffic from site 1 to site 8 is dropped. Plain IGP traffic through R6 is fine. The policy is up on R1.”",
    reproLabel: "ping 100 B",
    repro: [small],
    fault: (c) => {
      c.R6.xfn["ge-0/0/2"] = 0xe003;
    },
  },
  {
    id: "r2loc",
    title: "GREEN down, everything else up",
    report: "“Since R2 was upgraded, policy GREEN on R1 is down and site 8's traffic takes the long way (14 ms instead of 11). R2 forwards plain IPv6 normally.”",
    reproLabel: "ping 100 B",
    repro: [small],
    fault: (c) => {
      c.R2.isisLoc = false;
    },
  },
  {
    id: "format",
    title: "A new headend, a fatter header",
    report: "“R1 was replaced with a fresh chassis and the config was restored by hand. Since then 1430-byte packets to site 8 fail and capture shows six 128-bit SIDs on every GREEN packet.”",
    reproLabel: "ping 100 B and 1430 B",
    repro: [small, big],
    fault: (c) => {
      c.R1.fmt = false;
    },
  },
];
export const uTicket = (id: string) => U_TICKETS.find((t) => t.id === id)!;
export function uTicketState(id: UTicketId, seq = 0): UState {
  const s = createUNet(seq);
  const nx = cl(s);
  uTicket(id).fault(nx.cfg);
  const out = converge(s, nx, "", false);
  out.ticket = id;
  out.runs = [];
  out.last = undefined;
  out.log = [...out.log, { seq, t: out.clock, text: `Ticket opened: ${uTicket(id).title}.`, tone: "warn" }];
  return out;
}
export function uApply(s0: UState, a: UAction): UState {
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
    case "wipe-list": {
      const s = cl(s0);
      s.cfg.R1.lists![LIST] = [];
      s.wiped = true;
      s.cfgSeq += 1;
      s.clock += 1;
      s.log = [...s.log, { seq: s.seq, t: s.clock, text: "R1: segment list PATH-A was emptied.", tone: "warn" }];
      return converge(s0, s, "R1: PATH-A emptied");
    }
    case "ping":
      return uPing(s0, a.size);
    case "ticket":
      return uTicketState(a.id, s0.seq + 1);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Diagnosis, proofs, ladder
// ---------------------------------------------------------------------------------------------------------------
export const U_CAUSES: { id: string; label: string }[] = [
  { id: "usidloc", label: "R4's locator lost its micro-segment behavior, so its SID can't be packed" },
  { id: "order", label: "Two uSIDs in PATH-A are in the wrong order" },
  { id: "stalelib", label: "PATH-A carries R6's old local uSID for the express link" },
  { id: "r2loc", label: "R2's locator is not advertised, so the first uSID is unreachable" },
  { id: "format", label: "R1 has no uSID SID format, so it doesn't pack at all" },
  { id: "mtu", label: "The core MTU is too small" },
  { id: "igp", label: "An IGP metric changed the path" },
];
const lastT = (s: UState) => s.tests.at(-1);
export function uCauseFeedback(s: UState, cause: string): { right: boolean; text: string } {
  const t = s.ticket as UTicketId | undefined;
  if (cause === t) {
    const txt: Record<UTicketId, string> = {
      usidloc: "Yes. R4's locator MAIN lost “micro-segment behavior unode psp-usd”: R4 now allocates a classic End SID, fcbb:bb00:4:1::, and the tool put that into PATH-A. A classic SID can't share a carrier, so R1 builds three entries instead of two: [2,3] | R4's classic SID | [5,6,e002,8,e002]. Overhead grows from 64 to 80 bytes and a 1430-byte packet no longer fits the 1500-byte MTU. Same path, bigger header.",
      order: "Yes. PATH-A lists R5 (index 30) before R4 (index 40). uSIDs execute in carrier order: R3 routes to R5 via R4 (transit), R5 sends it back to R4, R4 forwards to R6 via R5 again. R4–R5 is crossed three times; nothing drops, it just takes longer.",
      stalelib: "Yes. The new card re-created R6's adjacency to R8 and IOS XR allocated its uA as e003. PATH-A still carries fcbb:bb00:6:e002::. At R6, after uN 6 shifts, e002 is active — R6 has no local uSID e002 any more, and a local-ID uSID is never routed elsewhere. Dropped at R6.",
      r2loc: "Yes. R2's IS-IS no longer advertises fcbb:bb00:2::/48. PATH-A starts with R2's uN, R1 can't reach it, so GREEN is down and CUST falls back to the IGP path with only R8's uDT4 — over R7, 13 ms. Compressed forwarding is plain IPv6 routing on locators: every node in the carrier must be reachable.",
      format: "Yes. The hand-restored config lost “sid-format usid-f3216” under segment-lists on R1. Without it R1 treats every SID as a classic 128-bit entry: six entries, 128 bytes of overhead. The routers would process the carriers fine — R1 just never packs them.",
    };
    return { right: true, text: txt[t] };
  }
  const v = s.view;
  switch (cause) {
    case "mtu":
      return { right: false, text: "The core MTU (1500 for IPv6) is unchanged; the question is why the header grew." };
    case "igp":
      return { right: false, text: "All IGP metrics are as designed (chain 10, alternates 50)." };
    case "usidloc":
      return { right: false, text: s.cfg.R4.micro ? "R4's locator runs micro-segment (show segment-routing srv6 locator: flag U)." : "R4 is classic — but is that the only problem?" };
    case "order":
      return { right: false, text: "PATH-A's uSIDs are in path order." };
    case "stalelib":
      return { right: false, text: "PATH-A's uA for R6 matches R6's current uA toward R8." };
    case "r2loc":
      return { right: false, text: v.policy.up ? "GREEN is up and its first uSID is reachable." : "GREEN is down — check why." };
    case "format":
      return { right: false, text: "R1 has sid-format usid-f3216 and packs the list." };
  }
  return { right: false, text: lastT(s) ? "That doesn't match the evidence." : "Reproduce it first." };
}
export function uProofs(s: UState): { label: string; ok: boolean; detail: string }[] {
  const t = s.ticket as UTicketId | undefined;
  if (!t) return [];
  const fresh = (size: number, pred: (x: UTest) => boolean = () => true) => s.tests.some((x) => x.cfgSeq === s.cfgSeq && x.size === size && x.walk.ok && pred(x));
  const two = { label: "R1 pushes the design's 2 entries (64 bytes of overhead)", ok: s.view.green.entries.length === 2 && s.view.policy.up, detail: "show segment-routing traffic-eng policy on R1" };
  const p100 = { label: "A fresh 100-byte ping is delivered over the express path (R6 → R8, 11 ms)", ok: fresh(100, (x) => x.walk.ms === 11), detail: "ping after the fix" };
  const p1430 = { label: "A fresh 1430-byte ping is delivered", ok: fresh(1430), detail: "ping 1430 bytes after the fix" };
  switch (t) {
    case "usidloc":
    case "format":
      return [two, p1430, p100];
    default:
      return [two, p100];
  }
}
export function uLadder(s: UState): { k: string; title: string; text: string }[] {
  const v = s.view;
  const t = [...s.tests].reverse().find((x) => x.cfgSeq === s.cfgSeq && !x.walk.ok) ?? lastT(s);
  const enc = v.green;
  return [
    { k: "symptom", title: "What does the customer see?", text: t ? (t.walk.ok ? `${t.size} B delivered via ${t.walk.path.join(" → ")}, ${t.walk.ms} ms.` : `${t.size} B: ${t.walk.why}.`) : "Ping first." },
    { k: "policy", title: "Is GREEN up and steering CUST?", text: v.policy.up ? `up — PATH-A [${v.policy.sids.join(", ")}]` : `down — ${v.policy.why}; CUST uses only R8's uDT4.` },
    { k: "locs", title: "Is every locator micro-segment and reachable?", text: U_ROUTERS.map((r) => `${r} ${s.cfg[r].micro ? "uSID" : "classic"}${s.cfg[r].isisLoc ? "" : " (not in IS-IS)"}`).join(" · ") },
    { k: "pack", title: "How does R1 pack the list?", text: `${s.cfg.R1.fmt ? "sid-format usid-f3216" : "no uSID format — no packing"}: ${enc.entries.length} entr${enc.entries.length > 1 ? "ies" : "y"} [${enc.entries.map((e) => e.text).join(" | ")}], overhead ${enc.overhead} B (classic would be ${enc.classicOverhead} B).` },
    { k: "order", title: "Is the uSID order the path order?", text: enc.entries.flatMap((e) => (e.classic ? [`[${e.text}]`] : e.usids.map(hx))).join(" → ") },
    { k: "local", title: "Do the local uSIDs still exist at their nodes?", text: v.policy.sids.filter((x) => hext(x)[3] >= 0xe000).map((x) => { const o = ownerByLocator(x); const ok = o && v.sids[o].some((y) => y.sid === v6norm(x)); return `${x} at ${o}: ${ok ? "present" : "NOT present"}`; }).join(" · ") || "PATH-A uses no local uSID." },
  ];
}
