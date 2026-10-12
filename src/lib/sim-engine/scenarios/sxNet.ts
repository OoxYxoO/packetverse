import { spClone, type SpBase, type SpMoment, type SpRun } from "@/components/sp-lab/spKit";

/**
 * SRv6 Foundations Lab network — the guided lesson's hexagon, IS-IS for IPv6 with SRv6 on IOS XR.
 *
 *            R2 ──10── R3               top R1–R2–R3–R6: metric 10 per link (cost 30)
 *        10 ╱            ╲ 10           bottom R1–R4–R5–R6: metric 5 per link (cost 15, the default path)
 *   H1 ── R1              R6 ── H6      H1 2001:db8:1::10 · H6 2001:db8:6::20 (LAN prefixes in IS-IS: plain IPv6 works)
 *         5 ╲            ╱ 5            Loopback0 2001:db8::N/128 · links 2001:db8:XY::N/64 · interface mtu 9216
 *            R4 ──5─── R5
 *
 * SRv6 (RFC 8402, 8754, 8986; IOS XR):
 * - Each router has locator MAIN = 2001:db8:100:N::/64 under `segment-routing srv6 locators`; enabled in IS-IS
 *   (`address-family ipv6 unicast segment-routing srv6 locator MAIN`) it is advertised (SRv6 Locator TLV) and IS-IS
 *   allocates the router's End SID 2001:db8:100:N:1:: (End, PSP/USD flavors) and an End.X SID per adjacency
 *   (2001:db8:100:N:40::, :41:: …). The local SID table is what the router DOES with them.
 * - Transit routers only need IPv6: they forward on the destination address by longest match (the /64 locator route).
 * - R1 encapsulates test traffic toward H6 in an outer IPv6 header (H.Encaps.Red, the IOS XR default): source =
 *   `encapsulation source-address`, DA = the first SID; the SRH carries the remaining SIDs in reverse order, and none is
 *   added for a single SID. End: SL > 0 → SL−1, DA = Segment List[SL] (PSP: remove the SRH when SL reaches 0); SL = 0 →
 *   USD: remove the outer header and forward the inner packet. A packet to a router's locator with no matching local SID
 *   is dropped (ICMPv6 unreachable). Packets larger than an interface's IPv6 MTU (mtu − 14) are dropped (Packet Too
 *   Big) — the outer header and the SRH count.
 */

export type SxR = "R1" | "R2" | "R3" | "R4" | "R5" | "R6";
export const SX_ROUTERS: SxR[] = ["R1", "R2", "R3", "R4", "R5", "R6"];
export const SX_IDX: Record<SxR, number> = { R1: 1, R2: 2, R3: 3, R4: 4, R5: 5, R6: 6 };
export const SX_LO = (r: SxR) => `2001:db8::${SX_IDX[r]}`;
export type IfName = "ge-0/0/0" | "ge-0/0/1" | "ge-0/0/2";
export const SX_HOSTS = { H1: { ip: "2001:db8:1::10", net: "2001:db8:1::", gw: "2001:db8:1::1", r: "R1" as SxR, ifn: "ge-0/0/2" as IfName }, H6: { ip: "2001:db8:6::20", net: "2001:db8:6::", gw: "2001:db8:6::1", r: "R6" as SxR, ifn: "ge-0/0/2" as IfName } };
export type SxHost = keyof typeof SX_HOSTS;
export const CORE_MTU = 9216;
export const DEFAULT_MTU = 1514;

export interface SxLink {
  id: string;
  a: SxR;
  ai: IfName;
  b: SxR;
  bi: IfName;
  metric: number;
}
export const SX_LINKS: SxLink[] = [
  { id: "R1-R2", a: "R1", ai: "ge-0/0/0", b: "R2", bi: "ge-0/0/0", metric: 10 },
  { id: "R2-R3", a: "R2", ai: "ge-0/0/1", b: "R3", bi: "ge-0/0/0", metric: 10 },
  { id: "R3-R6", a: "R3", ai: "ge-0/0/1", b: "R6", bi: "ge-0/0/0", metric: 10 },
  { id: "R1-R4", a: "R1", ai: "ge-0/0/1", b: "R4", bi: "ge-0/0/0", metric: 5 },
  { id: "R4-R5", a: "R4", ai: "ge-0/0/1", b: "R5", bi: "ge-0/0/0", metric: 5 },
  { id: "R5-R6", a: "R5", ai: "ge-0/0/1", b: "R6", bi: "ge-0/0/1", metric: 5 },
];
export const sxLinkIp = (l: SxLink, r: SxR) => `2001:db8:${SX_IDX[l.a]}${SX_IDX[l.b]}::${SX_IDX[r]}`;
export interface SxIfInfo {
  ifn: IfName;
  ip: string;
  peer: SxR;
  peerIf: IfName;
  peerIp: string;
  link: SxLink;
}
export function sxIfs(r: SxR): SxIfInfo[] {
  return SX_LINKS.flatMap((l) => (l.a === r ? [{ ifn: l.ai, ip: sxLinkIp(l, r), peer: l.b, peerIf: l.bi, peerIp: sxLinkIp(l, l.b), link: l }] : l.b === r ? [{ ifn: l.bi, ip: sxLinkIp(l, r), peer: l.a, peerIf: l.ai, peerIp: sxLinkIp(l, l.a), link: l }] : [])).sort((x, y) => x.ifn.localeCompare(y.ifn));
}
export const sxIfTo = (r: SxR, peer: SxR) => sxIfs(r).find((i) => i.peer === peer);

// ---------------------------------------------------------------------------------------------------------------
// IPv6 helpers
// ---------------------------------------------------------------------------------------------------------------
/** "2001:db8::1" → 8 hextets, or undefined when it isn't an IPv6 address. */
export function v6parse(raw: string): number[] | undefined {
  const s = raw.trim().toLowerCase();
  if (!/^[0-9a-f:]+$/.test(s) || (s.match(/::/g) ?? []).length > 1) return undefined;
  const [h, t] = s.includes("::") ? s.split("::") : [s, undefined];
  const head = h ? h.split(":") : [];
  const tail = t !== undefined && t ? t.split(":") : [];
  if ([...head, ...tail].some((x) => !/^[0-9a-f]{1,4}$/.test(x))) return undefined;
  const fill = t !== undefined ? 8 - head.length - tail.length : 0;
  if ((t === undefined && head.length !== 8) || fill < 0 || (t !== undefined && fill < 1)) return undefined;
  return [...head, ...Array(fill).fill("0"), ...tail].map((x) => parseInt(x, 16));
}
/** RFC 5952 text. */
export function v6fmt(h: number[]): string {
  let bs = -1;
  let bl = 0;
  for (let i = 0; i < 8; ) {
    if (h[i] !== 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < 8 && h[j] === 0) j++;
    if (j - i > bl && j - i >= 2) {
      bs = i;
      bl = j - i;
    }
    i = j;
  }
  const t = (a: number[]) => a.map((x) => x.toString(16)).join(":");
  return bs < 0 ? t(h) : `${t(h.slice(0, bs))}::${t(h.slice(bs + bl))}`;
}
export const v6norm = (raw: string) => {
  const h = v6parse(raw);
  return h ? v6fmt(h) : undefined;
};
const inPrefix = (h: number[], p: number[], len: number) => {
  for (let i = 0; i < 8; i++) {
    const bits = Math.max(0, Math.min(16, len - 16 * i));
    if (bits === 0) return true;
    const mask = (0xffff << (16 - bits)) & 0xffff;
    if ((h[i] & mask) !== (p[i] & mask)) return false;
  }
  return true;
};
export const locPrefix = (hex4: number) => `2001:db8:100:${hex4.toString(16)}::`;
export const endSid = (hex4: number) => `2001:db8:100:${hex4.toString(16)}:1::`;
export const endXSid = (hex4: number, k: number) => `2001:db8:100:${hex4.toString(16)}:${(0x40 + k).toString(16)}::`;

// ---------------------------------------------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------------------------------------------
export interface SxIf {
  isis: boolean;
  metric: number;
  mtu: number;
}
export interface SxRtr {
  /** `segment-routing srv6` with locator MAIN; loc = the locator's 4th hextet (2001:db8:100:<loc>::/64). */
  sr6: boolean;
  loc?: number;
  /** Locator MAIN enabled under IS-IS address-family ipv6 segment-routing srv6. */
  isisLoc: boolean;
  /** `encapsulation source-address`. */
  encap?: string;
  /** Loopback1 with 2001:db8:100:<N>::1/64, passive in IS-IS (an old plain-IPv6 advertisement of the locator range). */
  lo1: boolean;
  ifs: Partial<Record<IfName, SxIf>>;
}
export type SxCfg = Record<SxR, SxRtr>;
export function sxHealthy(): SxCfg {
  const c = {} as SxCfg;
  for (const r of SX_ROUTERS) {
    const ifs: Partial<Record<IfName, SxIf>> = {};
    for (const i of sxIfs(r)) ifs[i.ifn] = { isis: true, metric: i.link.metric, mtu: CORE_MTU };
    c[r] = { sr6: true, loc: SX_IDX[r], isisLoc: true, encap: r === "R1" ? SX_LO("R1") : undefined, lo1: false, ifs };
  }
  return c;
}

// ---------------------------------------------------------------------------------------------------------------
// Derived state
// ---------------------------------------------------------------------------------------------------------------
export interface SxNh {
  nh: SxR;
  ifn: IfName;
  ip: string;
}
export interface SxRoute {
  pfx: string;
  len: number;
  kind: "C" | "L" | "i L2";
  owner?: SxR;
  cost: number;
  nh?: SxNh;
  ifn?: IfName;
  locator?: boolean;
}
export interface SxLocalSid {
  sid: string;
  behavior: "End" | "End.X";
  ctx: string;
  ifn?: IfName;
  peer?: SxR;
}
export interface SxView {
  adj: Record<string, boolean>;
  spf: Record<SxR, { dst: SxR; cost: number; nh?: SxNh; path: SxR[] }[]>;
  rib: Record<SxR, SxRoute[]>;
  sids: Record<SxR, SxLocalSid[]>;
  /** Locators advertised in IS-IS, by owner. */
  locs: { owner: SxR; pfx: string }[];
}
const adjUp = (c: SxCfg, l: SxLink) => !!c[l.a].ifs[l.ai]?.isis && !!c[l.b].ifs[l.bi]?.isis;
function spf(c: SxCfg, root: SxR) {
  const d = new Map<SxR, { cost: number; prev?: SxR; first?: SxNh }>([[root, { cost: 0 }]]);
  const done = new Set<SxR>();
  while (true) {
    const u = SX_ROUTERS.filter((r) => !done.has(r) && d.has(r)).sort((a, b) => d.get(a)!.cost - d.get(b)!.cost || SX_IDX[a] - SX_IDX[b])[0];
    if (!u) break;
    done.add(u);
    for (const i of sxIfs(u)) {
      if (!adjUp(c, i.link)) continue;
      const cost = d.get(u)!.cost + (c[u].ifs[i.ifn]?.metric ?? 10);
      if (!d.has(i.peer) || cost < d.get(i.peer)!.cost) d.set(i.peer, { cost, prev: u, first: u === root ? { nh: i.peer, ifn: i.ifn, ip: i.peerIp } : d.get(u)!.first });
    }
  }
  return SX_ROUTERS.filter((r) => r !== root && d.has(r)).map((r) => {
    const path: SxR[] = [r];
    let x = r;
    while (d.get(x)?.prev) path.unshift((x = d.get(x)!.prev!));
    return { dst: r, cost: d.get(r)!.cost, nh: d.get(r)!.first, path };
  });
}
export const advertisesLoc = (c: SxCfg, r: SxR) => c[r].sr6 && c[r].loc !== undefined && c[r].isisLoc;
export function sxView(c: SxCfg): SxView {
  const adj: Record<string, boolean> = {};
  for (const l of SX_LINKS) adj[l.id] = adjUp(c, l);
  const sp = {} as SxView["spf"];
  for (const r of SX_ROUTERS) sp[r] = spf(c, r);
  const locs = SX_ROUTERS.filter((r) => advertisesLoc(c, r)).map((r) => ({ owner: r, pfx: locPrefix(c[r].loc!) }));
  const rib = {} as SxView["rib"];
  const sids = {} as SxView["sids"];
  for (const r of SX_ROUTERS) {
    const out: SxRoute[] = [{ pfx: SX_LO(r), len: 128, kind: "L", cost: 0, ifn: undefined }];
    for (const i of sxIfs(r)) out.push({ pfx: `2001:db8:${SX_IDX[i.link.a]}${SX_IDX[i.link.b]}::`, len: 64, kind: "C", cost: 0, ifn: i.ifn }, { pfx: i.ip, len: 128, kind: "L", cost: 0, ifn: i.ifn });
    const h = (Object.keys(SX_HOSTS) as SxHost[]).find((x) => SX_HOSTS[x].r === r);
    if (h) out.push({ pfx: SX_HOSTS[h].net, len: 64, kind: "C", cost: 0, ifn: SX_HOSTS[h].ifn });
    if (c[r].lo1) out.push({ pfx: locPrefix(SX_IDX[r]), len: 64, kind: "C", cost: 0 });
    for (const o of SX_ROUTERS) {
      if (o === r) continue;
      const rt = sp[r].find((x) => x.dst === o);
      if (!rt?.nh) continue;
      out.push({ pfx: SX_LO(o), len: 128, kind: "i L2", owner: o, cost: rt.cost, nh: rt.nh });
      const ho = (Object.keys(SX_HOSTS) as SxHost[]).find((x) => SX_HOSTS[x].r === o);
      if (ho) out.push({ pfx: SX_HOSTS[ho].net, len: 64, kind: "i L2", owner: o, cost: rt.cost + 10, nh: rt.nh });
      if (advertisesLoc(c, o)) out.push({ pfx: locPrefix(c[o].loc!), len: 64, kind: "i L2", owner: o, cost: rt.cost + 1, nh: rt.nh, locator: true });
      if (c[o].lo1) out.push({ pfx: locPrefix(SX_IDX[o]), len: 64, kind: "i L2", owner: o, cost: rt.cost + 10, nh: rt.nh });
      for (const l of SX_LINKS) if (l.a === o && l.b !== r && !out.some((x) => x.pfx === `2001:db8:${SX_IDX[l.a]}${SX_IDX[l.b]}::`) && adj[l.id]) {
        const near = [l.a, l.b].map((x) => sp[r].find((y) => y.dst === x)).filter((x): x is NonNullable<typeof x> => !!x?.nh).sort((a, b) => a.cost - b.cost)[0];
        if (near) out.push({ pfx: `2001:db8:${SX_IDX[l.a]}${SX_IDX[l.b]}::`, len: 64, kind: "i L2", cost: near.cost + l.metric, nh: near.nh });
      }
    }
    if (advertisesLoc(c, r)) out.push({ pfx: locPrefix(c[r].loc!), len: 64, kind: "L", cost: 0, locator: true });
    rib[r] = out;
    sids[r] = advertisesLoc(c, r) ? [{ sid: endSid(c[r].loc!), behavior: "End", ctx: "'default':1" }, ...sxIfs(r).flatMap((i, k) => (adj[i.link.id] ? [{ sid: endXSid(c[r].loc!, k), behavior: "End.X" as const, ctx: `[${i.ifn}, Link-Local]`, ifn: i.ifn, peer: i.peer }] : []))] : [];
  }
  return { adj, spf: sp, rib, sids, locs };
}
/** Longest-prefix match in r's IPv6 table. */
export function sxLookup(v: SxView, r: SxR, dst: string): SxRoute | undefined {
  const h = v6parse(dst);
  if (!h) return undefined;
  return v.rib[r].filter((x) => inPrefix(h, v6parse(x.pfx)!, x.len)).sort((a, b) => b.len - a.len)[0];
}
export const sxLocalSid = (v: SxView, r: SxR, dst: string) => v.sids[r].find((x) => x.sid === v6norm(dst));
export const sidOwner = (v: SxView, sid: string) => SX_ROUTERS.find((r) => v.sids[r].some((x) => x.sid === v6norm(sid)));

// ---------------------------------------------------------------------------------------------------------------
// The data plane
// ---------------------------------------------------------------------------------------------------------------
export interface SxPkt {
  /** Outer header (when encapsulated). */
  outer?: { src: string; da: string; srh?: { sl: number; list: string[] } };
  inner: { src: string; dst: string };
  /** Size of the inner packet in bytes. */
  size: number;
}
export const pktSize = (p: SxPkt) => p.size + (p.outer ? 40 + (p.outer.srh ? 8 + 16 * p.outer.srh.list.length : 0) : 0);
export interface SxHop {
  from: string;
  to: string;
  pkt: SxPkt;
  note: string;
}
export interface SxWalk {
  hops: SxHop[];
  ok: boolean;
  path: string[];
  why?: string;
  icmp?: "unreach" | "toobig" | "noroute";
}
/** H.Encaps.Red on the headend: DA = first SID, SRH = the rest in reverse (none for a single SID). */
export function encapsulate(src: string, sids: string[], inner: SxPkt["inner"], size: number): SxPkt {
  const list = sids.map((x) => v6norm(x)!);
  return { inner, size, outer: { src, da: list[0], srh: list.length > 1 ? { sl: list.length - 1, list: [...list.slice(1)].reverse() } : undefined } };
}
export function sxWalk(c: SxCfg, v: SxView, start: SxR, pkt0: SxPkt): SxWalk {
  const w: SxWalk = { hops: [], ok: false, path: [start] };
  let r: SxR = start;
  let p: SxPkt = spClone(pkt0);
  for (let ttl = 0; ttl < 32; ttl++) {
    const da = p.outer ? p.outer.da : p.inner.dst;
    if (p.outer) {
      const ls = sxLocalSid(v, r, da);
      if (ls) {
        const srh = p.outer.srh;
        if (srh && srh.sl > 0) {
          const sl = srh.sl - 1;
          const nda = srh.list[sl];
          const psp = sl === 0;
          p = { ...p, outer: { ...p.outer, da: nda, srh: psp ? undefined : { sl, list: srh.list } } };
          w.hops.push({ from: r, to: r, pkt: spClone(p), note: `${r}: ${da} is its ${ls.behavior} SID → Segments Left ${sl + 1} → ${sl}, DA = ${nda}${psp ? " (PSP: SRH removed)" : ""}` });
          if (ls.behavior === "End.X") {
            const i = sxIfs(r).find((x) => x.ifn === ls.ifn)!;
            if (!send({ nh: i.peer, ifn: i.ifn, ip: i.peerIp }, `${r}: End.X — out ${ls.ifn} to ${i.peer}`)) return w;
          }
          continue;
        }
        p = { inner: p.inner, size: p.size };
        w.hops.push({ from: r, to: r, pkt: spClone(p), note: `${r}: ${da} is its ${ls.behavior} SID, Segments Left 0 → USD: outer IPv6 header removed, inner packet to ${p.inner.dst}` });
        if (ls.behavior === "End.X") {
          const i = sxIfs(r).find((x) => x.ifn === ls.ifn)!;
          if (!send({ nh: i.peer, ifn: i.ifn, ip: i.peerIp }, `${r}: End.X — out ${ls.ifn} to ${i.peer}`)) return w;
        }
        continue;
      }
      // Its own locator (or the Loopback1 /64) but no local SID: drop.
      const own = sxLookup(v, r, da);
      if (own && (own.kind === "L" || own.kind === "C") && own.len === 64 && own.pfx.startsWith("2001:db8:100:")) {
        w.why = `${r} owns ${own.pfx}/64 but has no local SID ${da} — dropped (ICMPv6 destination unreachable)`;
        w.icmp = "unreach";
        return w;
      }
    }
    // Inner delivery
    if (!p.outer) {
      const h = (Object.keys(SX_HOSTS) as SxHost[]).find((x) => SX_HOSTS[x].ip === p.inner.dst);
      if (h && SX_HOSTS[h].r === r) {
        w.hops.push({ from: r, to: h, pkt: spClone(p), note: `${r}: delivered to ${h}` });
        w.path.push(h);
        w.ok = true;
        return w;
      }
      if (v6norm(p.inner.dst) === v6norm(SX_LO(r))) {
        w.ok = true;
        return w;
      }
    }
    const rt = sxLookup(v, r, da);
    if (!rt?.nh) {
      w.why = `${r} has no route to ${da} — dropped${rt ? "" : " (ICMPv6 no route)"}`;
      w.icmp = "noroute";
      return w;
    }
    if (!send(rt.nh, `${r}: ${da} matches ${rt.pfx}/${rt.len}${rt.locator ? ` (${rt.owner}'s locator)` : ""} → plain IPv6 forwarding to ${rt.nh.nh}`)) return w;
  }
  w.why = "Hop limit exceeded";
  return w;
  function send(nh: SxNh, note: string): boolean {
    const mtu = (c[r].ifs[nh.ifn]?.mtu ?? DEFAULT_MTU) - 14;
    if (pktSize(p) > mtu) {
      w.why = `${r}: ${pktSize(p)}-byte packet exceeds the IPv6 MTU ${mtu} of ${nh.ifn} toward ${nh.nh} — dropped (ICMPv6 Packet Too Big)`;
      w.icmp = "toobig";
      return false;
    }
    w.hops.push({ from: r, to: nh.nh, pkt: spClone(p), note });
    r = nh.nh;
    w.path.push(r);
    return true;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// State and actions
// ---------------------------------------------------------------------------------------------------------------
export interface SxSnap {
  view: SxView;
}
export interface SxTest {
  id: number;
  kind: "plain" | "srv6" | "ping";
  from: SxR;
  sids: string[];
  dst: string;
  size: number;
  ok: boolean;
  path: string[];
  why?: string;
  icmp?: SxWalk["icmp"];
  srh: boolean;
  /** What each hop carried: the outer header (if any) and the packet size on the wire. */
  trace: { from: string; to: string; da: string; sl?: number; list?: string[]; outer: boolean; bytes: number; note: string }[];
  cfgSeq: number;
  t: number;
}
export interface SxSys {
  t: number;
  dev: SxR;
  kind: "commit" | "adj-up" | "adj-down" | "sid";
  peer?: string;
}
export interface SxState extends SpBase<SxSnap> {
  cfg: SxCfg;
  hist: Record<SxR, SxRtr[]>;
  view: SxView;
  sys: SxSys[];
  tests: SxTest[];
  wiped?: boolean;
}
export type SxTicketId = "nosid" | "locator" | "notisis" | "encap" | "mtu";
export type SxAction =
  | { type: "cfg"; dev: SxR; cfg: SxRtr; text: string }
  | { type: "set"; changes: { dev: SxR; f: (c: SxRtr) => void }[]; text: string }
  | { type: "plain"; size?: number }
  | { type: "send"; sids: string[]; size?: number }
  | { type: "ping"; from: SxR; dst: string }
  | { type: "ticket"; id: SxTicketId }
  | { type: "wipe-r3" };

const cl = (o: SxState): SxState => ({ ...spClone(o), runs: o.runs, last: o.last });
export function createSxNet(seq = 0): SxState {
  const cfg = sxHealthy();
  const view = sxView(cfg);
  const s: SxState = { seq, cfgSeq: 0, clock: 3600, runs: [], log: [{ seq, t: 3600, text: "IS-IS for IPv6 is up. Every router advertises its SRv6 locator 2001:db8:100:N::/64 and has instantiated its End SID 2001:db8:100:N:1::.", tone: "info" }], cfg, hist: Object.fromEntries(SX_ROUTERS.map((r) => [r, []])) as unknown as Record<SxR, SxRtr[]>, view, sys: [], tests: [] };
  for (const l of SX_LINKS) s.sys.push({ t: 15, dev: l.a, kind: "adj-up", peer: l.b }, { t: 15, dev: l.b, kind: "adj-up", peer: l.a });
  return s;
}
export const DEFAULT_SIZE = 1400;
export const BIG = 1460;
function record(s: SxState, w: SxWalk, t: Omit<SxTest, "id" | "ok" | "path" | "why" | "icmp" | "cfgSeq" | "t" | "trace">, cmd: string, pre: string[]) {
  const snap = { view: s.view };
  const moments: SpMoment<SxSnap>[] = pre.map((x) => ({ tokens: [], lines: [{ text: x, tone: "info" as const }], snap }));
  for (const h of w.hops) moments.push({ tokens: h.from !== h.to ? [{ from: h.from, to: h.to, label: h.pkt.outer ? `DA ${h.pkt.outer.da.replace("2001:db8:", "…")}${h.pkt.outer.srh ? ` SL${h.pkt.outer.srh.sl}` : ""}` : "IPv6", color: h.pkt.outer ? (h.pkt.outer.srh ? "violet" : "cyan") : "green" }] : [], lines: [{ text: h.note, tone: h.pkt.outer ? "learn" : "info" }], snap });
  if (w.why) moments.push({ tokens: [], lines: [{ text: w.why, tone: "warn" }], snap });
  moments.push({ tokens: [], lines: [{ text: w.ok ? `${cmd}: success — ${w.path.join(" → ")}.` : `${cmd}: failed — ${w.why}`, tone: w.ok ? "ok" : "bad" }], snap });
  const trace = w.hops.map((h) => ({ from: h.from, to: h.to, da: h.pkt.outer?.da ?? h.pkt.inner.dst, sl: h.pkt.outer?.srh?.sl, list: h.pkt.outer?.srh?.list, outer: !!h.pkt.outer, bytes: pktSize(h.pkt), note: h.note }));
  const test: SxTest = { ...t, id: s.tests.length + 1, ok: w.ok, path: w.path, why: w.why, icmp: w.icmp, trace, cfgSeq: s.cfgSeq, t: s.clock };
  s.tests = [...s.tests, test].slice(-40);
  const run: SpRun<SxSnap> = { id: s.runs.length + 1 + s.seq * 1000, cmd, kind: "test", moments, ok: w.ok };
  s.runs = [...s.runs, run];
  s.last = run;
  s.log = [...s.log, { seq: s.seq, t: s.clock, text: `${cmd}: ${w.ok ? "success" : w.why}`, tone: w.ok ? "ok" : "warn" }];
  return s;
}
export function sxPlain(s0: SxState, size = DEFAULT_SIZE): SxState {
  const s = cl(s0);
  s.clock += 2;
  const p: SxPkt = { inner: { src: SX_HOSTS.H1.ip, dst: SX_HOSTS.H6.ip }, size };
  const w = sxWalk(s.cfg, s.view, "R1", p);
  w.hops.unshift({ from: "H1", to: "R1", pkt: p, note: `H1 sends ${size} bytes to ${SX_HOSTS.H6.ip}` });
  w.path.unshift("H1");
  return record(s, w, { kind: "plain", from: "R1", sids: [], dst: SX_HOSTS.H6.ip, size, srh: false }, `ping ${SX_HOSTS.H6.ip} from H1 (plain IPv6)`, []);
}
export function sxSend(s0: SxState, sids0: string[], size = DEFAULT_SIZE): SxState {
  const s = cl(s0);
  s.clock += 2;
  const sids = sids0.map((x) => v6norm(x)).filter((x): x is string => !!x);
  const inner = { src: SX_HOSTS.H1.ip, dst: SX_HOSTS.H6.ip };
  const cmd = `H1 → H6 via R1, segment list [${sids.join(", ")}]`;
  if (!s.cfg.R1.sr6 || !s.cfg.R1.encap) {
    const w: SxWalk = { hops: [{ from: "H1", to: "R1", pkt: { inner, size }, note: `H1 sends ${size} bytes to ${inner.dst}` }], ok: false, path: ["H1", "R1"], why: `R1 cannot encapsulate: ${!s.cfg.R1.sr6 ? "SRv6 is not enabled" : "no SRv6 encapsulation source address is configured"}` };
    return record(s, w, { kind: "srv6", from: "R1", sids, dst: inner.dst, size, srh: sids.length > 1 }, cmd, []);
  }
  const p = encapsulate(s.cfg.R1.encap, sids, inner, size);
  const w = sxWalk(s.cfg, s.view, "R1", p);
  w.hops.unshift({ from: "H1", to: "R1", pkt: { inner, size }, note: `H1 sends ${size} bytes to ${inner.dst}` });
  w.path.unshift("H1");
  const pre = [`R1 encapsulates (H.Encaps.Red): outer source ${s.cfg.R1.encap}, DA ${sids[0]}${sids.length > 1 ? `, SRH Segment List [${p.outer!.srh!.list.map((x, i) => `${i}: ${x}`).join(", ")}], Segments Left ${p.outer!.srh!.sl}` : ", no SRH (one SID)"} — ${pktSize(p)} bytes.`];
  return record(s, w, { kind: "srv6", from: "R1", sids, dst: inner.dst, size, srh: sids.length > 1 }, cmd, pre);
}
/** A router's own ping to an IPv6 address (a SID answers when it is instantiated: End with SL 0 processes ICMPv6). */
export function sxPingWalk(c: SxCfg, v: SxView, from: SxR, dst: string): SxWalk {
  const n = v6norm(dst)!;
  const w: SxWalk = { hops: [], ok: false, path: [from] };
  let r = from;
  for (let ttl = 0; ttl < 16; ttl++) {
    if (sxLocalSid(v, r, n) || v6norm(SX_LO(r)) === n || sxIfs(r).some((i) => v6norm(i.ip) === n) || (c[r].lo1 && v6norm(`${locPrefix(SX_IDX[r])}1`) === n)) {
      w.ok = true;
      return w;
    }
    const rt = sxLookup(v, r, n);
    if (rt && (rt.kind === "C" || rt.kind === "L") && rt.len === 64) {
      w.why = `${r} has no address or local SID ${n}`;
      w.icmp = "unreach";
      return w;
    }
    if (!rt?.nh) {
      w.why = `${r} has no route to ${n}`;
      w.icmp = "noroute";
      return w;
    }
    w.hops.push({ from: r, to: rt.nh.nh, pkt: { inner: { src: SX_LO(from), dst: n }, size: 100 }, note: `${r} → ${rt.nh.nh}` });
    r = rt.nh.nh;
    w.path.push(r);
  }
  return w;
}
function sxPing(s0: SxState, from: SxR, dst: string): SxState {
  const s = cl(s0);
  s.clock += 2;
  const w = sxPingWalk(s.cfg, s.view, from, dst);
  return record(s, w, { kind: "ping", from, sids: [], dst: v6norm(dst)!, size: 100, srh: false }, `ping ${v6norm(dst)} from ${from}`, []);
}
function converge(prev: SxState, s: SxState, why: string, show = true): SxState {
  const view = sxView(s.cfg);
  s.view = view;
  const snap = { view };
  const lines: { text: string; tone: "ok" | "bad" | "learn" }[] = [];
  for (const l of SX_LINKS)
    if (prev.view.adj[l.id] !== view.adj[l.id]) {
      lines.push({ text: `IS-IS ${l.a}–${l.b} ${view.adj[l.id] ? "Up" : "down"}.`, tone: view.adj[l.id] ? "ok" : "bad" });
      s.sys.push({ t: s.clock, dev: l.a, kind: view.adj[l.id] ? "adj-up" : "adj-down", peer: l.b }, { t: s.clock, dev: l.b, kind: view.adj[l.id] ? "adj-up" : "adj-down", peer: l.a });
    }
  for (const r of SX_ROUTERS) {
    const a = prev.view.sids[r].find((x) => x.behavior === "End")?.sid;
    const b = view.sids[r].find((x) => x.behavior === "End")?.sid;
    if (a !== b) {
      lines.push({ text: b ? `${r}: End SID ${b} allocated; locator ${locPrefix(s.cfg[r].loc!)}/64 advertised.` : `${r}: no End SID; its locator is no longer advertised as an SRv6 locator.`, tone: b ? "learn" : "bad" });
      s.sys.push({ t: s.clock, dev: r, kind: "sid", peer: b ?? "" });
    }
  }
  if (show && lines.length) {
    const run: SpRun<SxSnap> = { id: s.runs.length + 1 + s.seq * 1000, cmd: why, kind: "converge", moments: [{ tokens: [], lines: lines.slice(0, 10), snap }] };
    s.runs = [...s.runs, run];
    s.last = run;
  }
  return s;
}

// ---------------------------------------------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------------------------------------------
export interface SxTicketDef {
  id: SxTicketId;
  title: string;
  report: string;
  reproLabel: string;
  repro: SxAction[];
  fault: (c: SxCfg) => void;
}
export const VIA_R3 = [endSid(3), endSid(6)];
export const VIA_R5 = [endSid(5), endSid(6)];
export const TO_R6 = [endSid(6)];
const send = (sids: string[]): SxAction => ({ type: "send", sids });
export const SX_TICKETS: SxTicketDef[] = [
  {
    id: "nosid",
    title: "Steered through R3, lost at R3",
    report: "“Test traffic steered with [R3's End SID, R6's End SID] disappears. Plain IPv6 and the default SRv6 path work. R3 was migrated to SRv6 last night; its locator range is reachable — we pinged 2001:db8:100:3::1.”",
    reproLabel: "send [R3 End, R6 End]",
    repro: [send(VIA_R3)],
    fault: (c) => {
      c.R3.isisLoc = false;
      c.R3.lo1 = true;
    },
  },
  {
    id: "locator",
    title: "R5's SID doesn't exist",
    report: "“The runbook says R5's End SID is 2001:db8:100:5:1::. Traffic steered through it is dropped right at R1. R5 was re-provisioned from a template.”",
    reproLabel: "send [R5 End, R6 End]",
    repro: [send(VIA_R5)],
    fault: (c) => {
      c.R5.loc = 0x50;
    },
  },
  {
    id: "notisis",
    title: "Nothing reaches R6's SID",
    report: "“Every SRv6 test toward R6's End SID fails at R1 with no route, yet plain IPv6 to H6 works and show segment-routing srv6 locator on R6 shows MAIN up.”",
    reproLabel: "send [R6 End]",
    repro: [send(TO_R6)],
    fault: (c) => {
      c.R6.isisLoc = false;
    },
  },
  {
    id: "encap",
    title: "R1 sends nothing",
    report: "“After R1's SRv6 config was rewritten, no SRv6 test leaves R1 at all. The locators and SIDs look fine everywhere.”",
    reproLabel: "send [R6 End]",
    repro: [send(TO_R6)],
    fault: (c) => {
      c.R1.encap = undefined;
    },
  },
  {
    id: "mtu",
    title: "Big packets vanish",
    report: "“Plain IPv6 with 1460-byte packets works. The same packets steered over SRv6 through R5 are lost; small ones get through. R4's interfaces were re-templated.”",
    reproLabel: "send [R5 End, R6 End] (1460 bytes)",
    repro: [{ type: "send", sids: VIA_R5, size: BIG }],
    fault: (c) => {
      c.R4.ifs["ge-0/0/1"]!.mtu = DEFAULT_MTU;
    },
  },
];
export const sxTicket = (id: string) => SX_TICKETS.find((t) => t.id === id)!;
export function sxTicketState(id: SxTicketId, seq = 0): SxState {
  const s = createSxNet(seq);
  const nx = cl(s);
  sxTicket(id).fault(nx.cfg);
  const out = converge(s, nx, "", false);
  out.ticket = id;
  out.runs = [];
  out.last = undefined;
  out.log = [...out.log, { seq, t: out.clock, text: `Ticket opened: ${sxTicket(id).title}.`, tone: "warn" }];
  return out;
}
export function sxApply(s0: SxState, a: SxAction): SxState {
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
    case "wipe-r3": {
      const s = cl(s0);
      Object.assign(s.cfg.R3, { sr6: false, loc: undefined, isisLoc: false });
      s.wiped = true;
      s.cfgSeq += 1;
      s.clock += 1;
      s.log = [...s.log, { seq: s.seq, t: s.clock, text: "R3: SRv6 removed (segment-routing srv6 and the IS-IS locator) — rebuild it from its console.", tone: "warn" }];
      return converge(s0, s, "R3: SRv6 wiped");
    }
    case "plain":
      return sxPlain(s0, a.size);
    case "send":
      return sxSend(s0, a.sids, a.size);
    case "ping":
      return sxPing(s0, a.from, a.dst);
    case "ticket":
      return sxTicketState(a.id, s0.seq + 1);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Diagnosis, proofs, ladder
// ---------------------------------------------------------------------------------------------------------------
export const SX_CAUSES: { id: string; label: string }[] = [
  { id: "nosid", label: "R3's locator range is routed, but R3 has no End SID" },
  { id: "locator", label: "R5's locator is configured with the wrong prefix" },
  { id: "notisis", label: "R6's locator is configured but not enabled in IS-IS" },
  { id: "encap", label: "R1 has no SRv6 encapsulation source address" },
  { id: "mtu", label: "An interface on the path has a too-small MTU for encapsulated packets" },
  { id: "transit", label: "A transit router doesn't support SRv6" },
  { id: "order", label: "The segment list is encoded in the wrong order" },
];
const lastSend = (s: SxState) => s.tests.filter((t) => t.kind === "srv6").at(-1);
export function sxCauseFeedback(s: SxState, cause: string): { right: boolean; text: string } {
  const t = s.ticket as SxTicketId | undefined;
  if (cause === t) {
    const txt: Record<SxTicketId, string> = {
      nosid: "Yes. R3's locator is no longer enabled in IS-IS, so IS-IS allocated no End SID — but the migration left Loopback1 with 2001:db8:100:3::1/64 advertised as a plain prefix. Everyone still routes 2001:db8:100:3:1:: to R3 (the ping to ::1 works), and R3 drops it: the locator route answers “how do I reach R3?”, only a local SID answers “what does R3 do with this address?”.",
      locator: "Yes. R5's template set locator MAIN to 2001:db8:100:50::/64, so its End SID is 2001:db8:100:50:1::. Nobody advertises 2001:db8:100:5::/64 any more, and R1 has no route for the runbook's SID — the SID is derived from the locator, not configured separately.",
      notisis: "Yes. R6 has locator MAIN under segment-routing srv6, but no `segment-routing srv6 locator MAIN` under IS-IS. The locator is never advertised, IS-IS allocates no End SID, and no router has a route to 2001:db8:100:6::/64. Plain IPv6 to H6 doesn't need any of that.",
      encap: "Yes. R1's `encapsulation source-address` is gone. H.Encaps needs a source for the outer IPv6 header; without it R1 doesn't encapsulate at all. The rest of the network was never involved.",
      mtu: "Yes. R4's interface toward R5 lost `mtu 9216` and is back at 1514 — 1500 bytes for IPv6. A 1460-byte packet fits as plain IPv6, but encapsulated with two SIDs it carries an outer header (40) and an SRH with one entry (8 + 16): 1524 bytes, over 1500 — dropped with Packet Too Big. Small packets fit, which is why only the big ones vanish. SRv6 cores need headroom for the encapsulation.",
    };
    return { right: true, text: txt[t] };
  }
  switch (cause) {
    case "transit":
      return { right: false, text: "Transit routers forward SRv6 packets as ordinary IPv6 on the destination address — they don't need SRv6 at all." };
    case "order":
      return { right: false, text: "R1 builds the SRH itself from the list you give it: the last segment at index 0, Segments Left pointing at the next one. Look at what happens to the packet, not at the encoding." };
    case "nosid":
      return { right: false, text: "R3 has its End SID (show segment-routing srv6 sid on R3)." };
    case "locator":
      return { right: false, text: s.cfg.R5.loc === 5 ? "R5's locator is 2001:db8:100:5::/64, as documented." : "Check R5's locator." };
    case "notisis":
      return { right: false, text: "Every locator, R6's included, is enabled in IS-IS." };
    case "encap":
      return { right: false, text: "R1 has its encapsulation source address (2001:db8::1)." };
    case "mtu":
      return { right: false, text: "Every core interface has mtu 9216." };
  }
  return { right: false, text: lastSend(s) ? "That doesn't match the evidence." : "Send the test traffic first." };
}
export function sxProofs(s: SxState): { label: string; ok: boolean; detail: string }[] {
  const t = s.ticket as SxTicketId | undefined;
  if (!t) return [];
  const fresh = s.tests.filter((x) => x.cfgSeq === s.cfgSeq && x.kind === "srv6");
  const ok = (sids: string[], min = DEFAULT_SIZE) => fresh.some((x) => x.ok && x.sids.join() === sids.join() && x.size >= min);
  switch (t) {
    case "nosid":
      return [{ label: "R3 has its End SID 2001:db8:100:3:1::", ok: !!sxLocalSid(s.view, "R3", endSid(3)), detail: "show segment-routing srv6 sid on R3" }, { label: "A fresh test via [R3 End, R6 End] reaches H6", ok: ok(VIA_R3), detail: "send it again after the fix" }];
    case "locator":
      return [{ label: "R5's End SID is 2001:db8:100:5:1:: again", ok: !!sxLocalSid(s.view, "R5", endSid(5)), detail: "show segment-routing srv6 locator on R5" }, { label: "A fresh test via [R5 End, R6 End] reaches H6", ok: ok(VIA_R5), detail: "send it again after the fix" }];
    case "notisis":
      return [{ label: "R1 has a route to R6's locator", ok: !!sxLookup(s.view, "R1", endSid(6))?.locator, detail: "show route ipv6 2001:db8:100:6:1:: on R1" }, { label: "A fresh test via [R6 End] reaches H6", ok: ok(TO_R6), detail: "send it again after the fix" }];
    case "encap":
      return [{ label: "R1 has an encapsulation source address", ok: !!s.cfg.R1.encap, detail: "show segment-routing srv6 manager on R1" }, { label: "A fresh test via [R6 End] reaches H6", ok: ok(TO_R6), detail: "send it again after the fix" }];
    case "mtu":
      return [{ label: "R4's interface toward R5 has mtu 9216 again", ok: s.cfg.R4.ifs["ge-0/0/1"]!.mtu >= 9000, detail: "show ipv6 interface on R4" }, { label: "A fresh 1460-byte test via [R5 End, R6 End] reaches H6", ok: ok(VIA_R5, BIG), detail: "send it again with 1460 bytes after the fix" }];
  }
}
export function sxLadder(s: SxState): { k: string; title: string; text: string }[] {
  const v = s.view;
  const t = lastSend(s);
  const plain = s.tests.filter((x) => x.kind === "plain").at(-1);
  const missingLoc = SX_ROUTERS.filter((r) => !advertisesLoc(s.cfg, r));
  const smallMtu = SX_ROUTERS.flatMap((r) => sxIfs(r).filter((i) => (s.cfg[r].ifs[i.ifn]!.mtu ?? DEFAULT_MTU) < 9000).map((i) => `${r} toward ${i.peer}`));
  return [
    { k: "symptom", title: "What happened to the test?", text: t ? (t.ok ? `Delivered via ${t.path.join(" → ")}.` : `Lost — ${t.why}.`) : "Send SRv6 test traffic first." },
    { k: "underlay", title: "Does plain IPv6 work?", text: plain ? (plain.ok ? `Yes: ${plain.path.join(" → ")}.` : `No: ${plain.why}.`) : "Send a plain IPv6 ping to compare." },
    { k: "encap", title: "Can R1 encapsulate?", text: s.cfg.R1.sr6 && s.cfg.R1.encap ? `Yes: source ${s.cfg.R1.encap}.` : "No: no encapsulation source address." },
    { k: "locators", title: "Is every locator advertised, with the documented prefix?", text: `${v.locs.map((l) => `${l.owner} ${l.pfx}/64`).join(", ") || "none"}${missingLoc.length ? ` — missing: ${missingLoc.join(", ")}` : ""}.` },
    { k: "sids", title: "Does every SID in the list exist on its owner?", text: t ? t.sids.map((x) => `${x}: ${sidOwner(v, x) ? `End on ${sidOwner(v, x)}` : sxLookup(v, "R1", x)?.nh ? "routed, but no router has it" : "no route"}`).join(" · ") : "—" },
    { k: "mtu", title: "Is there headroom for the encapsulation?", text: smallMtu.length ? `No: ${smallMtu.join(", ")} at mtu 1514 (1500 for IPv6).` : "Yes: mtu 9216 on every core interface." },
  ];
}
