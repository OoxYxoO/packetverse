import { spClone, type SpBase, type SpMoment, type SpRun } from "@/components/sp-lab/spKit";
import { v6norm, v6parse } from "./sxNet";

/**
 * SRv6 L3VPN Lab — one model for every VRF, route, SID, session, table and packet (IOS XR, RFC 9252 / RFC 4364).
 *
 *                         RR1 (route reflector, 2001:db8:ffff::99)
 *                          │
 *   CE1 ─┐                 │                 ┌─ CE2   CUST-A  10.20.1.0/24 · 2001:db8:ca:20::/64
 *   CE4 ─┼─ PE1 ──── P1 ───┴──── P2 ──── PE2 ┼─ CE3   CUST-A  10.20.2.0/24 · 2001:db8:ca:30::/64
 *   CE6 ─┘   (IS-IS IPv6 + SRv6, metric 10)  └─ CE5   CUST-B  10.20.1.0/24 (same as CE2's!)
 *   CE1 CUST-A 10.10.1.0/24 · 2001:db8:ca:10::/64 · CE4 CUST-B 10.10.1.0/24 (same as CE1's) · CE6 CUST-A 10.10.6.0/24 (spare)
 *
 * - Underlay: Loopback0 2001:db8:ffff::N (BGP next hops) and SRv6 locators MAIN 2001:db8:100:N::/64 are separate
 *   prefixes; IS-IS advertises the locator only with `segment-routing srv6 locator MAIN` (isisLoc) — the guided incident.
 * - VRFs: CUST-A (dual-stack, RT 65000:100, RD 65000:1 / 65000:2), CUST-B (IPv4, RT 65000:200, RD 65000:11 / :12).
 *   PE–CE routing is static; `redistribute static` / `redistribute connected` put routes into BGP.
 * - Service SIDs: BGP allocates per VRF address family (End.DT4 / End.DT6, `alloc mode per-vrf`) or per CE next hop
 *   (End.DX4 / End.DX6, `alloc mode per-ce`; connected routes keep the per-VRF SID) from the PE's locator, after End
 *   :1 and End.X :40+k. An af without `segment-routing srv6` advertises its routes with no SRv6 service SID.
 * - Control plane: PE1/PE2 ↔ RR1 iBGP over loopbacks, families vpnv4 / vpnv6 negotiated per session; PEs keep only
 *   routes whose RT one of their VRFs imports (RT filtering); RR1 keeps everything.
 * - Install: an imported route is installed in the VRF only with a service SID whose locator the PE can reach.
 * - Data plane: ingress VRF lookup → H.Encaps.Red (DA = the service SID, no SRH) → P routers route on the locator →
 *   egress executes the SID (DT: VRF lookup, DX: straight to its CE) → CE → host; pings are round trips.
 */

export type SvR = "PE1" | "P1" | "P2" | "PE2" | "RR1";
export const SV_ROUTERS: SvR[] = ["PE1", "P1", "P2", "PE2", "RR1"];
export const SV_PES = ["PE1", "PE2"] as const;
export type Pe = (typeof SV_PES)[number];
export const SV_LO: Record<SvR, string> = { PE1: "2001:db8:ffff::1", P1: "2001:db8:ffff::11", P2: "2001:db8:ffff::12", PE2: "2001:db8:ffff::2", RR1: "2001:db8:ffff::99" };
export const SV_LOC: Partial<Record<SvR, string>> = { PE1: "1", P1: "11", P2: "12", PE2: "2" };
export const locOf = (r: SvR) => (SV_LOC[r] ? `2001:db8:100:${SV_LOC[r]}::` : undefined);
export const sidText = (r: SvR, fn: number) => `2001:db8:100:${SV_LOC[r]}:${fn.toString(16)}::`;
export type IfName = "ge-0/0/0" | "ge-0/0/1" | "ge-0/0/2" | "ge-0/0/3";
export type Vrf = "CUST-A" | "CUST-B";
export const SV_VRFS: Vrf[] = ["CUST-A", "CUST-B"];
export type Fam = "ipv4" | "ipv6";
export const AS = 65000;

export interface SvLink {
  id: string;
  a: SvR;
  ai: IfName;
  b: SvR;
  bi: IfName;
  net: string;
}
export const SV_LINKS: SvLink[] = [
  { id: "PE1-P1", a: "PE1", ai: "ge-0/0/0", b: "P1", bi: "ge-0/0/0", net: "2001:db8:10:1::" },
  { id: "P1-P2", a: "P1", ai: "ge-0/0/1", b: "P2", bi: "ge-0/0/0", net: "2001:db8:10:2::" },
  { id: "P2-PE2", a: "P2", ai: "ge-0/0/1", b: "PE2", bi: "ge-0/0/0", net: "2001:db8:10:3::" },
  { id: "P1-RR1", a: "P1", ai: "ge-0/0/2", b: "RR1", bi: "ge-0/0/0", net: "2001:db8:10:4::" },
];
export const linkIp = (l: SvLink, r: SvR) => `${l.net}${l.a === r ? 1 : 2}`;
export interface SvCoreIf {
  ifn: IfName;
  peer: SvR;
  link: SvLink;
  ip: string;
}
export function coreIfs(r: SvR): SvCoreIf[] {
  return SV_LINKS.flatMap((l) => (l.a === r ? [{ ifn: l.ai, peer: l.b, link: l, ip: linkIp(l, r) }] : l.b === r ? [{ ifn: l.bi, peer: l.a, link: l, ip: linkIp(l, r) }] : [])).sort((x, y) => x.ifn.localeCompare(y.ifn));
}

export type Ce = "CE1" | "CE2" | "CE3" | "CE4" | "CE5" | "CE6";
export const SV_CES: Ce[] = ["CE1", "CE2", "CE3", "CE4", "CE5", "CE6"];
export interface CeDef {
  pe: Pe;
  ifn: IfName;
  vrf: Vrf;
  link4: string; // /24, PE .1, CE .2
  link6?: string; // /64, PE ::1, CE ::2
  lan4: string; // /24
  lan6?: string; // /64
  host4: string;
  host6?: string;
}
export const SV_CE: Record<Ce, CeDef> = {
  CE1: { pe: "PE1", ifn: "ge-0/0/1", vrf: "CUST-A", link4: "192.168.11.", link6: "2001:db8:c1::", lan4: "10.10.1.", lan6: "2001:db8:ca:10::", host4: "10.10.1.10", host6: "2001:db8:ca:10::a" },
  CE4: { pe: "PE1", ifn: "ge-0/0/2", vrf: "CUST-B", link4: "192.168.14.", lan4: "10.10.1.", host4: "10.10.1.10" },
  CE6: { pe: "PE1", ifn: "ge-0/0/3", vrf: "CUST-A", link4: "192.168.16.", lan4: "10.10.6.", host4: "10.10.6.10" },
  CE2: { pe: "PE2", ifn: "ge-0/0/1", vrf: "CUST-A", link4: "192.168.22.", link6: "2001:db8:c2::", lan4: "10.20.1.", lan6: "2001:db8:ca:20::", host4: "10.20.1.10", host6: "2001:db8:ca:20::a" },
  CE3: { pe: "PE2", ifn: "ge-0/0/2", vrf: "CUST-A", link4: "192.168.23.", link6: "2001:db8:c3::", lan4: "10.20.2.", lan6: "2001:db8:ca:30::", host4: "10.20.2.10", host6: "2001:db8:ca:30::a" },
  CE5: { pe: "PE2", ifn: "ge-0/0/3", vrf: "CUST-B", link4: "192.168.25.", lan4: "10.20.1.", host4: "10.20.1.10" },
};
export const ceOnIf = (pe: SvR, ifn: string) => SV_CES.find((c) => SV_CE[c].pe === pe && SV_CE[c].ifn === ifn);
export const pfx4 = (net: string) => `${net}0/24`;
export const pfx6 = (net: string) => `${net}/64`;

// ---------------------------------------------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------------------------------------------
export interface VrfAf {
  imp: string[];
  exp: string[];
}
export interface BgpVrfAf {
  srv6?: string; // locator name under `segment-routing srv6`, undefined = no SRv6 for this af
  srv6On: boolean; // `segment-routing srv6` present
  mode: "per-vrf" | "per-ce";
  rs: boolean;
  rc: boolean;
}
export interface Static {
  vrf: Vrf;
  fam: Fam;
  pfx: string;
  nh: string;
}
export interface SvRtr {
  ifs: Partial<Record<IfName, { isis?: boolean; vrf?: Vrf }>>;
  isisLoc: boolean;
  vrfs: Partial<Record<Vrf, Partial<Record<Fam, VrfAf>>>>;
  statics: Static[];
  bgp?: { nbr: { vpnv4: boolean; vpnv6: boolean }; vrf: Partial<Record<Vrf, { rd?: string; af: Partial<Record<Fam, BgpVrfAf>> }>> };
  rr?: Record<Pe, { vpnv4: boolean; vpnv6: boolean }>;
}
export type SvCfg = Record<SvR, SvRtr>;
export const RT: Record<Vrf, string> = { "CUST-A": "65000:100", "CUST-B": "65000:200" };
export const RD: Record<Pe, Record<Vrf, string>> = { PE1: { "CUST-A": "65000:1", "CUST-B": "65000:11" }, PE2: { "CUST-A": "65000:2", "CUST-B": "65000:12" } };
const af = (): BgpVrfAf => ({ srv6: "MAIN", srv6On: true, mode: "per-vrf", rs: true, rc: true });
export function svHealthy(): SvCfg {
  const c = {} as SvCfg;
  for (const r of SV_ROUTERS) {
    const ifs: SvRtr["ifs"] = {};
    for (const i of coreIfs(r)) ifs[i.ifn] = { isis: true };
    c[r] = { ifs, isisLoc: r !== "RR1", vrfs: {}, statics: [] };
  }
  for (const pe of SV_PES) {
    const x = c[pe];
    x.vrfs = { "CUST-A": { ipv4: { imp: [RT["CUST-A"]], exp: [RT["CUST-A"]] }, ipv6: { imp: [RT["CUST-A"]], exp: [RT["CUST-A"]] } }, "CUST-B": { ipv4: { imp: [RT["CUST-B"]], exp: [RT["CUST-B"]] } } };
    x.bgp = { nbr: { vpnv4: true, vpnv6: true }, vrf: { "CUST-A": { rd: RD[pe]["CUST-A"], af: { ipv4: af(), ipv6: af() } }, "CUST-B": { rd: RD[pe]["CUST-B"], af: { ipv4: af() } } } };
    for (const ce of SV_CES.filter((y) => SV_CE[y].pe === pe)) {
      const d = SV_CE[ce];
      x.ifs[d.ifn] = { vrf: d.vrf };
      if (ce === "CE6") continue; // the spare site: interface ready, no route yet
      x.statics.push({ vrf: d.vrf, fam: "ipv4", pfx: pfx4(d.lan4), nh: `${d.link4}2` });
      if (d.lan6) x.statics.push({ vrf: d.vrf, fam: "ipv6", pfx: pfx6(d.lan6), nh: `${d.link6}2` });
    }
  }
  c.RR1.rr = { PE1: { vpnv4: true, vpnv6: true }, PE2: { vpnv4: true, vpnv6: true } };
  return c;
}

// ---------------------------------------------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------------------------------------------
export const famOf = (ip: string): Fam => (ip.includes(":") ? "ipv6" : "ipv4");
export function inPfx(ip: string, pfx: string): boolean {
  const [net, len] = pfx.split("/");
  if (famOf(ip) !== famOf(net)) return false;
  if (famOf(ip) === "ipv4") {
    const a = ip.split(".").map(Number);
    const b = net.split(".").map(Number);
    const n = +len / 8;
    return a.length === 4 && b.slice(0, n).every((x, i) => x === a[i]);
  }
  const a = v6parse(ip);
  const b = v6parse(net);
  if (!a || !b) return false;
  return b.slice(0, +len / 16).every((x, i) => x === a[i]);
}
export const pfxLen = (pfx: string) => +pfx.split("/")[1];
/** The PE's own address on a CE-facing interface, per family. */
export const peIfIp = (ce: Ce, fam: Fam) => (fam === "ipv4" ? `${SV_CE[ce].link4}1` : SV_CE[ce].link6 ? `${SV_CE[ce].link6}1` : undefined);
export const ceIfIp = (ce: Ce, fam: Fam) => (fam === "ipv4" ? `${SV_CE[ce].link4}2` : SV_CE[ce].link6 ? `${SV_CE[ce].link6}2` : undefined);
export const ceHost = (ce: Ce, fam: Fam) => (fam === "ipv4" ? SV_CE[ce].host4 : SV_CE[ce].host6);

// ---------------------------------------------------------------------------------------------------------------
// Derived state
// ---------------------------------------------------------------------------------------------------------------
export type Beh = "End" | "End.X" | "End.DT4" | "End.DT6" | "End.DX4" | "End.DX6";
export interface SvSid {
  sid: string;
  behavior: Beh;
  owner: "isis" | "bgp";
  ifn?: IfName;
  peer?: SvR;
  vrf?: Vrf;
  ce?: Ce;
}
export interface V6Route {
  pfx: string;
  kind: "connected" | "local" | "isis";
  nh?: { r: SvR; ifn: IfName };
  cost: number;
  what: string;
}
export interface VpnRoute {
  pe: Pe;
  vrf: Vrf;
  fam: Fam;
  rd: string;
  pfx: string;
  rts: string[];
  nh: string; // BGP next hop = PE loopback
  sid?: string;
  behavior?: Beh;
  kind: "static" | "connected";
  localNh: string; // for the originating PE's own table
}
export interface Imported {
  route: VpnRoute;
  vrf: Vrf;
  nhOk: boolean;
  sidOk: boolean;
  installed: boolean;
  why?: string;
}
export interface VrfRoute {
  pfx: string;
  kind: "connected" | "static" | "bgp";
  ce?: Ce;
  nh?: string;
  imp?: Imported;
}
export interface Session {
  pe: Pe;
  up: boolean;
  vpnv4: boolean;
  vpnv6: boolean;
  why?: string;
}
export interface SvView {
  adj: Record<string, boolean>;
  rib: Record<SvR, V6Route[]>;
  sids: Record<SvR, SvSid[]>;
  vpn: VpnRoute[];
  sessions: Record<Pe, Session>;
  rrTable: VpnRoute[];
  received: Record<Pe, VpnRoute[]>;
  imported: Record<Pe, Imported[]>;
  vrfRib: Record<Pe, Record<Vrf, Record<Fam, VrfRoute[]>>>;
}
const adjUp = (c: SvCfg, l: SvLink) => !!c[l.a].ifs[l.ai]?.isis && !!c[l.b].ifs[l.bi]?.isis;
const famAfi = (f: Fam) => (f === "ipv4" ? "vpnv4" : "vpnv6") as "vpnv4" | "vpnv6";
export const behOf = (fam: Fam, kind: "DT" | "DX"): Beh => (`End.${kind}${fam === "ipv4" ? 4 : 6}` as Beh);
/** Statics the PE can actually install: next hop on a CE-facing interface of the same VRF. */
export function staticCe(c: SvCfg, pe: Pe, s: Static): Ce | undefined {
  const ce = SV_CES.find((x) => SV_CE[x].pe === pe && inPfx(s.nh, s.fam === "ipv4" ? `${SV_CE[x].link4}0/24` : SV_CE[x].link6 ? `${SV_CE[x].link6}/64` : "::/128"));
  return ce && c[pe].ifs[SV_CE[ce].ifn]?.vrf === s.vrf && s.nh === ceIfIp(ce, s.fam) ? ce : undefined;
}
/** Connected subnets of a VRF on a PE. */
export function connectedOf(c: SvCfg, pe: Pe, vrf: Vrf, fam: Fam): { pfx: string; ce: Ce }[] {
  return SV_CES.filter((x) => SV_CE[x].pe === pe && c[pe].ifs[SV_CE[x].ifn]?.vrf === vrf && (fam === "ipv4" || SV_CE[x].link6)).map((x) => ({ pfx: fam === "ipv4" ? `${SV_CE[x].link4}0/24` : `${SV_CE[x].link6}/64`, ce: x }));
}
function bgpSids(c: SvCfg, pe: Pe): SvSid[] {
  const out: SvSid[] = [];
  let f = 0x40 + coreIfs(pe).length;
  const b = c[pe].bgp;
  if (!b) return out;
  for (const vrf of SV_VRFS) {
    const bv = b.vrf[vrf];
    if (!bv?.rd || !c[pe].vrfs[vrf]) continue;
    for (const fam of ["ipv4", "ipv6"] as Fam[]) {
      const a = bv.af[fam];
      if (!a || !a.srv6On || a.srv6 !== "MAIN" || !c[pe].vrfs[vrf]![fam]) continue;
      if (a.mode === "per-vrf" || a.rc) out.push({ sid: sidText(pe, f++), behavior: behOf(fam, "DT"), owner: "bgp", vrf });
      if (a.mode === "per-ce" && a.rs) {
        const ces = [...new Set(c[pe].statics.filter((s) => s.vrf === vrf && s.fam === fam).map((s) => staticCe(c, pe, s)).filter((x): x is Ce => !!x))];
        for (const ce of ces) out.push({ sid: sidText(pe, f++), behavior: behOf(fam, "DX"), owner: "bgp", vrf, ce });
      }
    }
  }
  return out;
}
export function svView(c: SvCfg): SvView {
  const adj: Record<string, boolean> = {};
  for (const l of SV_LINKS) adj[l.id] = adjUp(c, l);
  // IS-IS (metric 10 everywhere): BFS from each router.
  const rib = {} as SvView["rib"];
  for (const r of SV_ROUTERS) {
    const seen = new Map<SvR, { cost: number; nh?: { r: SvR; ifn: IfName } }>([[r, { cost: 0 }]]);
    const q: SvR[] = [r];
    while (q.length) {
      const u = q.shift()!;
      for (const i of coreIfs(u)) {
        if (!adj[i.link.id] || seen.has(i.peer)) continue;
        seen.set(i.peer, { cost: seen.get(u)!.cost + 10, nh: u === r ? { r: i.peer, ifn: i.ifn } : seen.get(u)!.nh });
        q.push(i.peer);
      }
    }
    const routes: V6Route[] = [];
    for (const i of coreIfs(r)) routes.push({ pfx: `${i.link.net}/64`, kind: "connected", nh: undefined, cost: 0, what: `link to ${i.peer}` });
    routes.push({ pfx: `${SV_LO[r]}/128`, kind: "local", cost: 0, what: "Loopback0" });
    if (locOf(r)) routes.push({ pfx: `${locOf(r)}/64`, kind: "local", cost: 0, what: "SRv6 locator MAIN" });
    for (const [d, x] of seen) {
      if (d === r) continue;
      routes.push({ pfx: `${SV_LO[d]}/128`, kind: "isis", nh: x.nh, cost: x.cost + 10, what: `${d} Loopback0` });
      if (locOf(d) && c[d].isisLoc) routes.push({ pfx: `${locOf(d)}/64`, kind: "isis", nh: x.nh, cost: x.cost + 10, what: `${d} SRv6 locator` });
    }
    rib[r] = routes;
  }
  const sids = {} as SvView["sids"];
  for (const r of SV_ROUTERS) {
    sids[r] = [];
    if (!locOf(r)) continue;
    if (c[r].isisLoc) {
      sids[r].push({ sid: sidText(r, 1), behavior: "End", owner: "isis" });
      coreIfs(r).forEach((i, k) => {
        if (adj[i.link.id]) sids[r].push({ sid: sidText(r, 0x40 + k), behavior: "End.X", owner: "isis", ifn: i.ifn, peer: i.peer });
      });
    }
    if (r === "PE1" || r === "PE2") sids[r].push(...bgpSids(c, r));
  }
  const reach = (r: SvR, ip: string) => rib[r].some((x) => x.kind !== "connected" && inPfx(ip, x.pfx));
  // VPN routes each PE originates.
  const vpn: VpnRoute[] = [];
  for (const pe of SV_PES) {
    const b = c[pe].bgp;
    if (!b) continue;
    for (const vrf of SV_VRFS) {
      const bv = b.vrf[vrf];
      if (!bv?.rd || !c[pe].vrfs[vrf]) continue;
      for (const fam of ["ipv4", "ipv6"] as Fam[]) {
        const a = bv.af[fam];
        const va = c[pe].vrfs[vrf]![fam];
        if (!a || !va) continue;
        const dt = sids[pe].find((x) => x.vrf === vrf && x.behavior === behOf(fam, "DT"));
        const mk = (pfx: string, kind: VpnRoute["kind"], localNh: string, ce?: Ce): VpnRoute => {
          const dx = ce && a.mode === "per-ce" ? sids[pe].find((x) => x.vrf === vrf && x.ce === ce && x.behavior === behOf(fam, "DX")) : undefined;
          const s = kind === "static" && a.mode === "per-ce" ? dx : dt;
          return { pe, vrf, fam, rd: bv.rd!, pfx, rts: [...va.exp], nh: SV_LO[pe], sid: s?.sid, behavior: s?.behavior, kind, localNh };
        };
        if (a.rc) for (const x of connectedOf(c, pe, vrf, fam)) vpn.push(mk(x.pfx, "connected", fam === "ipv4" ? "0.0.0.0" : "::"));
        if (a.rs) for (const s of c[pe].statics.filter((y) => y.vrf === vrf && y.fam === fam)) {
          const ce = staticCe(c, pe, s);
          if (ce && !vpn.some((y) => y.pe === pe && y.vrf === vrf && y.pfx === s.pfx)) vpn.push(mk(s.pfx, "static", s.nh, ce));
        }
      }
    }
  }
  // Sessions to RR1 (loopback to loopback over IS-IS).
  const sessions = {} as SvView["sessions"];
  for (const pe of SV_PES) {
    const up = reach(pe, SV_LO.RR1) && reach("RR1", SV_LO[pe]);
    const n = c[pe].bgp?.nbr ?? { vpnv4: false, vpnv6: false };
    const rr = c.RR1.rr![pe];
    sessions[pe] = { pe, up, vpnv4: up && n.vpnv4 && rr.vpnv4, vpnv6: up && n.vpnv6 && rr.vpnv6, why: up ? undefined : `no route between ${SV_LO[pe]} and ${SV_LO.RR1}` };
  }
  const rrTable = vpn.filter((x) => sessions[x.pe][famAfi(x.fam)]);
  const received = {} as SvView["received"];
  const imported = {} as SvView["imported"];
  const vrfRib = {} as SvView["vrfRib"];
  for (const pe of SV_PES) {
    received[pe] = rrTable.filter((x) => x.pe !== pe && sessions[pe][famAfi(x.fam)]);
    imported[pe] = [];
    vrfRib[pe] = {} as Record<Vrf, Record<Fam, VrfRoute[]>>;
    for (const vrf of SV_VRFS) {
      vrfRib[pe][vrf] = { ipv4: [], ipv6: [] };
      for (const fam of ["ipv4", "ipv6"] as Fam[]) {
        const va = c[pe].vrfs[vrf]?.[fam];
        if (!va) continue;
        const t = vrfRib[pe][vrf][fam];
        for (const x of connectedOf(c, pe, vrf, fam)) t.push({ pfx: x.pfx, kind: "connected", ce: x.ce });
        for (const s of c[pe].statics.filter((y) => y.vrf === vrf && y.fam === fam)) {
          const ce = staticCe(c, pe, s);
          if (ce && !t.some((y) => y.pfx === s.pfx)) t.push({ pfx: s.pfx, kind: "static", ce, nh: s.nh });
        }
        const bgpAf = c[pe].bgp?.vrf[vrf]?.af[fam];
        if (!bgpAf || !c[pe].bgp?.vrf[vrf]?.rd) continue;
        for (const rt of received[pe].filter((y) => y.fam === fam && y.rts.some((z) => va.imp.includes(z)))) {
          const nhOk = reach(pe, rt.nh);
          const owner = rt.sid ? (SV_PES.find((p) => rt.sid!.startsWith(`2001:db8:100:${SV_LOC[p]}:`)) as Pe | undefined) : undefined;
          const sidOk = !!rt.sid && !!owner && reach(pe, rt.sid);
          const why = !rt.sid ? "the route carries no SRv6 service SID" : !nhOk ? `BGP next hop ${rt.nh} is unreachable` : !sidOk ? `service SID ${rt.sid} is unreachable: no route to locator ${locOf(rt.pe)}/64` : undefined;
          const imp: Imported = { route: rt, vrf, nhOk, sidOk, installed: !why, why };
          imported[pe].push(imp);
          if (imp.installed && !t.some((y) => y.pfx === rt.pfx)) t.push({ pfx: rt.pfx, kind: "bgp", nh: rt.nh, imp });
        }
      }
    }
  }
  return { adj, rib, sids, vpn, sessions, rrTable, received, imported, vrfRib };
}
export function vrfLookup(v: SvView, pe: Pe, vrf: Vrf, dst: string): VrfRoute | undefined {
  return v.vrfRib[pe][vrf][famOf(dst)].filter((x) => inPfx(dst, x.pfx)).sort((a, b) => pfxLen(b.pfx) - pfxLen(a.pfx))[0];
}
export function ribLookup(v: SvView, r: SvR, dst: string): V6Route | undefined {
  return v.rib[r].filter((x) => inPfx(dst, x.pfx)).sort((a, b) => pfxLen(b.pfx) - pfxLen(a.pfx))[0];
}
export const localSid = (v: SvView, r: SvR, sid: string) => v.sids[r].find((x) => x.sid === v6norm(sid));

// ---------------------------------------------------------------------------------------------------------------
// The data plane
// ---------------------------------------------------------------------------------------------------------------
export interface SvHop {
  from: string;
  to: string;
  outer?: { src: string; da: string };
  inner: { src: string; dst: string };
  note: string;
  tone?: "ok" | "bad" | "info";
}
export interface SvLeg {
  ok: boolean;
  path: string[];
  hops: SvHop[];
  sid?: string;
  behavior?: Beh;
  why?: string;
  at?: string; // where it stopped / was delivered
  vrf?: Vrf; // the VRF that delivered it
}
export type Src = { ce: Ce } | { pe: Pe; vrf: Vrf };
/** Forward one packet from a PE (already in `vrf`) toward `dst`. */
function fromPe(c: SvCfg, v: SvView, pe: Pe, vrf: Vrf, src: string, dst: string, leg: SvLeg): void {
  const inner = { src, dst };
  const rt = vrfLookup(v, pe, vrf, dst);
  if (!rt) {
    leg.why = `${pe}: VRF ${vrf} has no route to ${dst}`;
    leg.at = pe;
    return;
  }
  if (rt.kind !== "bgp") return toCe(c, v, pe, vrf, rt, src, dst, leg, `${pe}: VRF ${vrf} → ${rt.pfx} ${rt.kind}`);
  const sid = rt.imp!.route.sid!;
  const beh = rt.imp!.route.behavior!;
  leg.sid = sid;
  leg.behavior = beh;
  leg.hops.push({ from: pe, to: pe, inner, outer: { src: SV_LO[pe], da: sid }, note: `${pe}: VRF ${vrf} → ${rt.pfx} via ${rt.nh}, SID ${sid} (${beh}) → H.Encaps.Red: outer DA ${sid}, no SRH`, tone: "info" });
  let r: SvR = pe;
  for (let ttl = 0; ttl < 12; ttl++) {
    const ls = localSid(v, r, sid);
    if (ls) return egress(c, v, r as Pe, ls, src, dst, leg);
    const fib = ribLookup(v, r, sid);
    if (!fib || !fib.nh) {
      leg.why = `${r}: no route to ${sid}${locOf(sidOwnerPe(sid)!) ? ` (locator ${locOf(sidOwnerPe(sid)!)}/64 is not in the IPv6 table)` : ""} — dropped`;
      leg.at = r;
      return;
    }
    leg.hops.push({ from: r, to: fib.nh.r, inner, outer: { src: SV_LO[pe], da: sid }, note: `${r}: DA ${sid} → ${fib.pfx} (${fib.what}) → ${fib.nh.r}` });
    r = fib.nh.r;
    leg.path.push(r);
  }
  leg.why = "hop limit exceeded";
}
export const sidOwnerPe = (sid: string) => SV_PES.find((p) => sid.startsWith(`2001:db8:100:${SV_LOC[p]}:`));
function egress(c: SvCfg, v: SvView, pe: Pe, ls: SvSid, src: string, dst: string, leg: SvLeg): void {
  const inner = { src, dst };
  const fam = famOf(dst);
  if ((ls.behavior.endsWith("4") && fam !== "ipv4") || (ls.behavior.endsWith("6") && fam !== "ipv6") || ls.behavior === "End" || ls.behavior === "End.X") {
    leg.why = `${pe}: ${ls.sid} is ${ls.behavior} — it cannot carry an inner ${fam === "ipv4" ? "IPv4" : "IPv6"} packet — dropped`;
    leg.at = pe;
    return;
  }
  if (ls.behavior.startsWith("End.DX")) {
    leg.hops.push({ from: pe, to: pe, inner, note: `${pe}: ${ls.sid} is ${ls.behavior} → decapsulate, send straight to ${ls.ce} (no lookup)`, tone: "info" });
    const ce = ls.ce!;
    leg.hops.push({ from: pe, to: ce, inner, note: `${pe} → ${ce}` });
    leg.path.push(ce);
    return atCe(ce, dst, leg);
  }
  leg.hops.push({ from: pe, to: pe, inner, note: `${pe}: ${ls.sid} is ${ls.behavior} for VRF ${ls.vrf} → decapsulate, look ${dst} up in ${ls.vrf}`, tone: "info" });
  const rt = vrfLookup(v, pe, ls.vrf!, dst);
  if (!rt || rt.kind === "bgp") {
    leg.why = `${pe}: VRF ${ls.vrf} has no local route to ${dst} — dropped`;
    leg.at = pe;
    return;
  }
  toCe(c, v, pe, ls.vrf!, rt, src, dst, leg, `${pe}: VRF ${ls.vrf} → ${rt.pfx} ${rt.kind}`);
}
function toCe(_c: SvCfg, _v: SvView, pe: Pe, vrf: Vrf, rt: VrfRoute, src: string, dst: string, leg: SvLeg, note: string): void {
  const inner = { src, dst };
  const ce = rt.ce!;
  leg.vrf = vrf;
  if (rt.kind === "connected" && dst === peIfIp(ce, famOf(dst))) {
    leg.hops.push({ from: pe, to: pe, inner, note: `${note}: ${dst} is ${pe}'s own address`, tone: "ok" });
    leg.ok = true;
    leg.at = pe;
    return;
  }
  leg.hops.push({ from: pe, to: ce, inner, note: `${note} → ${ce} (${vrf})` });
  leg.path.push(ce);
  atCe(ce, dst, leg);
}
function atCe(ce: Ce, dst: string, leg: SvLeg): void {
  const d = SV_CE[ce];
  const fam = famOf(dst);
  const mine = dst === ceIfIp(ce, fam) || dst === ceHost(ce, fam);
  if (!mine) {
    leg.why = `${ce} has no host ${dst} — dropped (wrong site)`;
    leg.at = ce;
    return;
  }
  leg.ok = true;
  leg.at = dst === d.host4 || dst === d.host6 ? `${ce} host` : ce;
  leg.hops.push({ from: ce, to: ce, inner: leg.hops.at(-1)?.inner ?? { src: "", dst }, note: `${ce}: delivered to ${dst}`, tone: "ok" });
}
function leg(c: SvCfg, v: SvView, src: Src, from: string, dst: string): SvLeg {
  const l: SvLeg = { ok: false, path: [], hops: [] };
  if ("ce" in src) {
    const d = SV_CE[src.ce];
    l.path.push(src.ce, d.pe);
    l.hops.push({ from: src.ce, to: d.pe, inner: { src: from, dst }, note: `${src.ce}: ${dst} → default route → ${d.pe}` });
    const vrf = c[d.pe].ifs[d.ifn]?.vrf;
    if (!vrf) {
      l.why = `${d.pe}: ${d.ifn.replace("ge-0/0/", "Gi0/0/0/")} is not in a VRF — the global table has no route to ${dst}`;
      l.at = d.pe;
      return l;
    }
    fromPe(c, v, d.pe, vrf, from, dst, l);
  } else {
    l.path.push(src.pe);
    fromPe(c, v, src.pe, src.vrf, from, dst, l);
  }
  return l;
}
export interface SvTest {
  id: number;
  src: string; // "CE1" or "PE1 (CUST-A)"
  from: string;
  to: string;
  fam: Fam;
  ok: boolean;
  fwd: SvLeg;
  rev?: SvLeg;
  why?: string;
  deliveredTo?: string;
  cfgSeq: number;
  t: number;
}
export function srcAddr(src: Src, fam: Fam): string | undefined {
  if ("ce" in src) return ceHost(src.ce, fam);
  const ce = SV_CES.find((x) => SV_CE[x].pe === src.pe && SV_CE[x].vrf === src.vrf && (fam === "ipv4" || SV_CE[x].link6));
  return ce ? peIfIp(ce, fam) : undefined;
}
export function svPing(c: SvCfg, v: SvView, src: Src, to: string): Omit<SvTest, "id" | "cfgSeq" | "t"> {
  const fam = famOf(to);
  const label = "ce" in src ? src.ce : `${src.pe} (${src.vrf})`;
  const from = srcAddr(src, fam);
  if (!from) {
    const l: SvLeg = { ok: false, path: [], hops: [], why: `${label} has no ${fam === "ipv4" ? "IPv4" : "IPv6"} address` };
    return { src: label, from: "—", to, fam, ok: false, fwd: l, why: l.why };
  }
  const f = leg(c, v, src, from, to);
  if (!f.ok) return { src: label, from, to, fam, ok: false, fwd: f, why: `request: ${f.why}` };
  // The reply: from whoever answered, back to `from`.
  const at = f.at!;
  const replier: Src = at.startsWith("CE") ? { ce: at.split(" ")[0] as Ce } : { pe: at as Pe, vrf: f.vrf! };
  let r: SvLeg;
  if ("ce" in replier) r = leg(c, v, replier, to, from);
  else {
    r = { ok: false, path: [replier.pe], hops: [] };
    fromPe(c, v, replier.pe, f.vrf!, to, from, r);
  }
  const deliveredTo = at.split(" ")[0];
  return { src: label, from, to, fam, ok: r.ok, fwd: f, rev: r, why: r.ok ? undefined : `reply: ${r.why}`, deliveredTo };
}

// ---------------------------------------------------------------------------------------------------------------
// State and actions
// ---------------------------------------------------------------------------------------------------------------
export interface SvSnap {
  view: SvView;
}
export interface SvSys {
  t: number;
  dev: SvR;
  kind: "commit" | "adj-up" | "adj-down" | "bgp-up" | "bgp-down";
  peer?: string;
}
export interface SvState extends SpBase<SvSnap> {
  cfg: SvCfg;
  hist: Record<SvR, SvRtr[]>;
  view: SvView;
  sys: SvSys[];
  tests: SvTest[];
}
export type SvTicketId = "locator" | "rt" | "nosrv6" | "redist" | "vpnv6";
export type SvAction =
  | { type: "cfg"; dev: SvR; cfg: SvRtr; text: string }
  | { type: "set"; changes: { dev: SvR; f: (c: SvRtr) => void }[]; text: string }
  | { type: "ping"; src: Src; to: string }
  | { type: "wipe-pe2" }
  | { type: "ticket"; id: SvTicketId };

const cl = (o: SvState): SvState => ({ ...spClone(o), runs: o.runs, last: o.last });
export function createSvNet(seq = 0): SvState {
  const cfg = svHealthy();
  const view = svView(cfg);
  const s: SvState = { seq, cfgSeq: 0, clock: 3600, runs: [], log: [{ seq, t: 3600, text: "VRF CUST-A (dual-stack) and CUST-B are up on PE1 and PE2; VPNv4 and VPNv6 routes are reflected by RR1, each with its SRv6 service SID.", tone: "info" }], cfg, hist: Object.fromEntries(SV_ROUTERS.map((r) => [r, []])) as unknown as Record<SvR, SvRtr[]>, view, sys: [], tests: [] };
  for (const l of SV_LINKS) s.sys.push({ t: 15, dev: l.a, kind: "adj-up", peer: l.b }, { t: 15, dev: l.b, kind: "adj-up", peer: l.a });
  for (const pe of SV_PES) s.sys.push({ t: 30, dev: pe, kind: "bgp-up", peer: SV_LO.RR1 }, { t: 30, dev: "RR1", kind: "bgp-up", peer: SV_LO[pe] });
  return s;
}
const short = (x: string) => x.replace("2001:db8:100:", "…:");
export function svSend(s0: SvState, src: Src, to: string): SvState {
  const s = cl(s0);
  s.clock += 2;
  const p = svPing(s.cfg, s.view, src, to);
  const t: SvTest = { ...p, id: s.tests.length + 1, cfgSeq: s.cfgSeq, t: s.clock };
  s.tests = [...s.tests, t].slice(-40);
  const snap = { view: s.view };
  const cmd = `${t.src} → ${to}`;
  const moments: SpMoment<SvSnap>[] = [];
  const tok = (h: SvHop, back: boolean) =>
    h.from !== h.to ? [{ from: h.from, to: h.to, label: h.outer ? `DA ${short(h.outer.da)}` : back ? `reply → ${h.inner.dst}` : h.inner.dst, color: h.outer ? "violet" : back ? "amber" : "green" }] : [];
  for (const h of t.fwd.hops) moments.push({ tokens: tok(h, false), lines: [{ text: h.note, tone: h.tone === "ok" ? "ok" : "learn" }], snap });
  if (t.fwd.why) moments.push({ tokens: [], lines: [{ text: t.fwd.why, tone: "warn" }], snap });
  for (const h of t.rev?.hops ?? []) moments.push({ tokens: tok(h, true), lines: [{ text: `reply · ${h.note}`, tone: h.tone === "ok" ? "ok" : "learn" }], snap });
  if (t.rev?.why) moments.push({ tokens: [], lines: [{ text: `reply · ${t.rev.why}`, tone: "warn" }], snap });
  moments.push({ tokens: [], lines: [{ text: t.ok ? `${cmd}: !!!!! — request delivered to ${t.deliveredTo}, reply back to ${t.from}.` : `${cmd}: ..... — ${t.why}`, tone: t.ok ? "ok" : "bad" }], snap });
  const run: SpRun<SvSnap> = { id: s.runs.length + 1 + s.seq * 1000, cmd, kind: "test", moments, ok: t.ok };
  s.runs = [...s.runs, run];
  s.last = run;
  s.log = [...s.log, { seq: s.seq, t: s.clock, text: `${cmd}: ${t.ok ? `success (delivered to ${t.deliveredTo})` : t.why}`, tone: t.ok ? "ok" : "warn" }];
  return s;
}
function converge(prev: SvState, s: SvState, why: string, show = true): SvState {
  const view = svView(s.cfg);
  s.view = view;
  const lines: { text: string; tone: "ok" | "bad" | "learn" }[] = [];
  for (const l of SV_LINKS)
    if (prev.view.adj[l.id] !== view.adj[l.id]) {
      lines.push({ text: `IS-IS ${l.a}–${l.b} ${view.adj[l.id] ? "Up" : "down"}.`, tone: view.adj[l.id] ? "ok" : "bad" });
      s.sys.push({ t: s.clock, dev: l.a, kind: view.adj[l.id] ? "adj-up" : "adj-down", peer: l.b }, { t: s.clock, dev: l.b, kind: view.adj[l.id] ? "adj-up" : "adj-down", peer: l.a });
    }
  for (const pe of SV_PES) {
    if (prev.view.sessions[pe].up !== view.sessions[pe].up) {
      lines.push({ text: `BGP ${pe} ↔ RR1 ${view.sessions[pe].up ? "Established" : "down"}.`, tone: view.sessions[pe].up ? "ok" : "bad" });
      s.sys.push({ t: s.clock, dev: pe, kind: view.sessions[pe].up ? "bgp-up" : "bgp-down", peer: SV_LO.RR1 });
    }
    const n = (v: SvView) => v.imported[pe].filter((x) => x.installed).length;
    if (n(prev.view) !== n(view)) lines.push({ text: `${pe}: ${n(view)} VPN routes installed in its VRFs (was ${n(prev.view)}).`, tone: n(view) > n(prev.view) ? "ok" : "bad" });
  }
  if (show && lines.length) {
    const run: SpRun<SvSnap> = { id: s.runs.length + 1 + s.seq * 1000, cmd: why, kind: "converge", moments: [{ tokens: [], lines: lines.slice(0, 10), snap: { view } }] };
    s.runs = [...s.runs, run];
    s.last = run;
  }
  return s;
}

// ---------------------------------------------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------------------------------------------
export interface SvTicketDef {
  id: SvTicketId;
  title: string;
  report: string;
  reproLabel: string;
  repro: SvAction[];
  fault: (c: SvCfg) => void;
}
const ce1 = (to: string): SvAction => ({ type: "ping", src: { ce: "CE1" }, to });
export const SV_TICKETS: SvTicketDef[] = [
  {
    id: "locator",
    title: "Site 2 unreachable, BGP looks fine",
    report: "“Since the IS-IS change on PE2 last night, CUST-A's HQ (CE1) can't reach site 2 at all — IPv4 or IPv6. The NOC says BGP to RR1 is Established, the VPN routes are there, and PE2's loopback pings fine.”",
    reproLabel: "ping 10.20.1.10 and 2001:db8:ca:20::a from CE1",
    repro: [ce1("10.20.1.10"), ce1("2001:db8:ca:20::a")],
    fault: (c) => {
      c.PE2.isisLoc = false;
    },
  },
  {
    id: "rt",
    title: "New template, site 2 gone",
    report: "“PE2's VRF CUST-A was re-provisioned from a template. Since then CE1 can't reach anything at site 2, on IPv4 or IPv6. PE2 still has its routes to CE2 and CE3.”",
    reproLabel: "ping 10.20.1.10 and 2001:db8:ca:20::a from CE1",
    repro: [ce1("10.20.1.10"), ce1("2001:db8:ca:20::a")],
    fault: (c) => {
      for (const f of ["ipv4", "ipv6"] as Fam[]) c.PE2.vrfs["CUST-A"]![f]!.exp = ["65000:999"];
    },
  },
  {
    id: "nosrv6",
    title: "IPv6 works, IPv4 doesn't",
    report: "“After an IOS XR upgrade on PE2, CUST-A's IPv6 between HQ and site 2 is fine, but IPv4 is completely dead. The IPv4 VPN routes do reach PE1.”",
    reproLabel: "ping 10.20.1.10 and 2001:db8:ca:20::a from CE1",
    repro: [ce1("10.20.1.10"), ce1("2001:db8:ca:20::a")],
    fault: (c) => {
      const a = c.PE2.bgp!.vrf["CUST-A"]!.af.ipv4!;
      a.srv6On = false;
      a.srv6 = undefined;
    },
  },
  {
    id: "redist",
    title: "Packets arrive, nothing comes back",
    report: "“Site 2's server team sees CE1's IPv4 pings arriving at 10.20.1.10 — and replying. CE1 gets nothing back. IPv6 is fine. PE1's VRF config was cleaned up yesterday.”",
    reproLabel: "ping 10.20.1.10 from CE1",
    repro: [ce1("10.20.1.10")],
    fault: (c) => {
      c.PE1.bgp!.vrf["CUST-A"]!.af.ipv4!.rs = false;
    },
  },
  {
    id: "vpnv6",
    title: "Only IPv6 is broken",
    report: "“CUST-A's IPv4 works between all sites. IPv6 from HQ to site 2 fails. The PE2–RR1 BGP session was re-created during a maintenance window.”",
    reproLabel: "ping 2001:db8:ca:20::a and 10.20.1.10 from CE1",
    repro: [ce1("2001:db8:ca:20::a"), ce1("10.20.1.10")],
    fault: (c) => {
      c.PE2.bgp!.nbr.vpnv6 = false;
    },
  },
];
export const svTicket = (id: string) => SV_TICKETS.find((t) => t.id === id)!;
export function svTicketState(id: SvTicketId, seq = 0): SvState {
  const s = createSvNet(seq);
  const nx = cl(s);
  svTicket(id).fault(nx.cfg);
  const out = converge(s, nx, "", false);
  out.ticket = id;
  out.runs = [];
  out.last = undefined;
  out.log = [...out.log, { seq, t: out.clock, text: `Ticket opened: ${svTicket(id).title}.`, tone: "warn" }];
  return out;
}
export function svApply(s0: SvState, a: SvAction): SvState {
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
    case "wipe-pe2": {
      const s = cl(s0);
      delete s.cfg.PE2.bgp!.vrf["CUST-A"];
      s.cfgSeq += 1;
      s.clock += 1;
      s.log = [...s.log, { seq: s.seq, t: s.clock, text: "PE2: router bgp 65000 vrf CUST-A was removed.", tone: "warn" }];
      return converge(s0, s, "PE2: no router bgp vrf CUST-A");
    }
    case "ping":
      return svSend(s0, a.src, a.to);
    case "ticket":
      return svTicketState(a.id, s0.seq + 1);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Diagnosis, proofs, ladder
// ---------------------------------------------------------------------------------------------------------------
export const SV_CAUSES: { id: string; label: string }[] = [
  { id: "locator", label: "PE2's SRv6 locator is no longer advertised in IS-IS" },
  { id: "rt", label: "PE2 exports CUST-A with a route target PE1 doesn't import" },
  { id: "nosrv6", label: "PE2's CUST-A IPv4 routes are advertised without an SRv6 service SID" },
  { id: "redist", label: "PE1 no longer advertises CE1's IPv4 LAN into BGP" },
  { id: "vpnv6", label: "The PE2–RR1 session no longer carries VPNv6" },
  { id: "session", label: "The BGP session to RR1 is down" },
  { id: "core", label: "A core link is down" },
];
const lastTest = (s: SvState) => s.tests.at(-1);
export function svCauseFeedback(s: SvState, cause: string): { right: boolean; text: string } {
  const t = s.ticket as SvTicketId | undefined;
  if (cause === t) {
    const txt: Record<SvTicketId, string> = {
      locator: "Yes. PE2's IS-IS no longer has “segment-routing srv6 locator MAIN”, so 2001:db8:100:2::/64 left the IGP. PE2's loopback 2001:db8:ffff::2 is still advertised — BGP is Established and the VPN routes still arrive with next hop 2001:db8:ffff::2 — but every service SID lives under the locator. PE1 has no route to 2001:db8:100:2:41:: and won't install the routes. Two kinds of reachability: next hop and locator.",
      rt: "Yes. The template exports CUST-A with RT 65000:999. PE1's CUST-A imports 65000:100, so PE1 (RT filtering) discards PE2's routes on arrival — they are on RR1 and PE2 but never in PE1's table. The SIDs and the core are fine.",
      nosrv6: "Yes. PE2's “vrf CUST-A address-family ipv4 unicast” lost “segment-routing srv6”, so BGP allocates no End.DT4 and advertises the IPv4 routes without a Prefix-SID. PE1 receives and imports them but has no SID to encapsulate to — nothing is installed. IPv6 has its own af and its own End.DT6, untouched.",
      redist: "Yes. PE1's CUST-A IPv4 af lost “redistribute static”, so 10.10.1.0/24 (CE1's LAN, a static toward CE1) is no longer a VPN route. CE1's request reaches CE2 — PE1 still knows site 2 — but PE2 has no route back to 10.10.1.10. An asymmetric failure: always test both directions.",
      vpnv6: "Yes. PE2's neighbor 2001:db8:ffff::99 lost “address-family vpnv6 unicast”. The session is Established, but only VPNv4 is negotiated, so PE2's IPv6 VPN routes never reach RR1 — or PE1 — and PE1's never reach PE2. IPv4 is untouched.",
    };
    return { right: true, text: txt[t] };
  }
  const v = s.view;
  switch (cause) {
    case "session":
      return { right: false, text: v.sessions.PE1.up && v.sessions.PE2.up ? "Both PEs are Established with RR1 (show bgp vpnv4 unicast summary)." : "A session is down — but look at why." };
    case "core":
      return { right: false, text: SV_LINKS.every((l) => v.adj[l.id]) ? "All IS-IS adjacencies are up, and every loopback is reachable." : "A link is down." };
    case "locator":
      return { right: false, text: s.cfg.PE2.isisLoc ? "PE2's locator 2001:db8:100:2::/64 is in PE1's IPv6 table." : "The locator is missing — but is it the only problem?" };
    case "rt":
      return { right: false, text: "PE2 exports CUST-A with 65000:100, which PE1 imports." };
    case "nosrv6":
      return { right: false, text: "PE2's CUST-A routes carry their service SIDs (show bgp vpnv4 unicast … on PE1 or RR1)." };
    case "redist":
      return { right: false, text: "PE1 advertises CE1's LANs: 10.10.1.0/24 and 2001:db8:ca:10::/64 are on RR1 and PE2." };
    case "vpnv6":
      return { right: false, text: "Both PE sessions negotiate VPNv4 and VPNv6." };
  }
  return { right: false, text: lastTest(s) ? "That doesn't match the evidence." : "Reproduce the problem first." };
}
export function svProofs(s: SvState): { label: string; ok: boolean; detail: string }[] {
  const t = s.ticket as SvTicketId | undefined;
  if (!t) return [];
  const fresh = (to: string) => s.tests.some((x) => x.cfgSeq === s.cfgSeq && x.src === "CE1" && x.to === to && x.ok);
  const p4 = { label: "A fresh ping CE1 → 10.20.1.10 succeeds (request and reply)", ok: fresh("10.20.1.10"), detail: "ping from CE1 after the fix" };
  const p6 = { label: "A fresh ping CE1 → 2001:db8:ca:20::a succeeds", ok: fresh("2001:db8:ca:20::a"), detail: "ping from CE1 after the fix" };
  const inst = (pfx: string) => s.view.imported.PE1.some((x) => x.route.pfx === pfx && x.installed);
  switch (t) {
    case "locator":
      return [{ label: "PE1 has a route to PE2's locator 2001:db8:100:2::/64", ok: s.view.rib.PE1.some((x) => x.pfx === "2001:db8:100:2::/64"), detail: "show route ipv6 2001:db8:100:2:: on PE1" }, p4, p6];
    case "rt":
      return [{ label: "PE1 installs 10.20.1.0/24 in CUST-A", ok: inst("10.20.1.0/24"), detail: "show route vrf CUST-A on PE1" }, p4, p6];
    case "nosrv6":
      return [{ label: "PE2's 10.20.1.0/24 carries an End.DT4 service SID", ok: s.view.vpn.some((x) => x.pe === "PE2" && x.pfx === "10.20.1.0/24" && !!x.sid), detail: "show bgp vpnv4 unicast rd 65000:2 10.20.1.0/24" }, p4, p6];
    case "redist":
      return [{ label: "PE2 installs 10.10.1.0/24 in CUST-A", ok: s.view.imported.PE2.some((x) => x.route.pfx === "10.10.1.0/24" && x.vrf === "CUST-A" && x.installed), detail: "show route vrf CUST-A on PE2" }, p4];
    case "vpnv6":
      return [{ label: "The PE2–RR1 session negotiates VPNv6", ok: s.view.sessions.PE2.vpnv6, detail: "show bgp vpnv6 unicast summary on PE2" }, p6, p4];
  }
}
/** Where the CE owning `ip` lives, for the ladder. */
export function ownerOf(ip: string, vrf: Vrf): Ce | undefined {
  return SV_CES.find((x) => SV_CE[x].vrf === vrf && (inPfx(ip, pfx4(SV_CE[x].lan4)) || (SV_CE[x].lan6 && inPfx(ip, pfx6(SV_CE[x].lan6!)))));
}
export function svLadder(s: SvState): { k: string; title: string; text: string }[] {
  const v = s.view;
  // Climb for the last failed ping (that is what needs explaining); otherwise the last ping.
  const t = [...s.tests].reverse().find((x) => !x.ok && x.cfgSeq === s.cfgSeq) ?? lastTest(s);
  const to = t?.to ?? "10.20.1.10";
  const fam = famOf(to);
  const srcCe: Ce = t && SV_CES.includes(t.src as Ce) ? (t.src as Ce) : "CE1";
  const vrf = SV_CE[srcCe].vrf;
  const ing = SV_CE[srcCe].pe;
  const dstCe = ownerOf(to, vrf);
  const eg = dstCe ? SV_CE[dstCe].pe : undefined;
  const pfx = dstCe ? (fam === "ipv4" ? pfx4(SV_CE[dstCe].lan4) : SV_CE[dstCe].lan6 ? pfx6(SV_CE[dstCe].lan6!) : "—") : "—";
  const adv = eg ? v.vpn.find((x) => x.pe === eg && x.vrf === vrf && x.pfx === pfx) : undefined;
  const imp = v.imported[ing].find((x) => x.route.pfx === pfx && x.vrf === vrf);
  const back = vrfLookup(v, eg ?? "PE2", vrf, ceHost(srcCe, fam) ?? "0.0.0.0");
  return [
    { k: "symptom", title: "What does the customer see?", text: t ? (t.ok ? `${t.src} → ${t.to}: success, delivered to ${t.deliveredTo}.` : `${t.src} → ${t.to}: ${t.why}.`) : "Ping first." },
    { k: "ce", title: `Does the egress PE have the customer route (${pfx})?`, text: eg ? (v.vrfRib[eg][vrf][fam].some((x) => x.pfx === pfx && x.kind !== "bgp") ? `${eg} has ${pfx} in ${vrf} (static toward ${dstCe}).` : `${eg} has no local route to ${pfx} in ${vrf}.`) : "—" },
    { k: "adv", title: "Is it advertised as a VPN route, with a service SID?", text: adv ? `${eg} advertises ${adv.rd}:${adv.pfx}, RT ${adv.rts.join(" ") || "none"}, next hop ${adv.nh}, SID ${adv.sid ?? "none"}${adv.behavior ? ` (${adv.behavior})` : ""}.` : `${eg ?? "the egress PE"} does not advertise ${pfx}.` },
    { k: "session", title: `Do the sessions carry ${fam === "ipv4" ? "VPNv4" : "VPNv6"}?`, text: SV_PES.map((p) => `${p}–RR1 ${v.sessions[p].up ? "Established" : "down"}, ${famAfi(fam)} ${v.sessions[p][famAfi(fam)] ? "negotiated" : "NOT negotiated"}`).join(" · ") },
    { k: "import", title: `Does ${ing} receive and import it into ${vrf}?`, text: imp ? `received with RT ${imp.route.rts.join(" ")}, imported into ${vrf}.` : v.rrTable.some((x) => x.pfx === pfx && x.vrf === vrf && x.pe === eg) ? `RR1 has it (RT ${v.rrTable.find((x) => x.pfx === pfx && x.pe === eg)!.rts.join(" ")}) but ${ing} keeps no copy: no VRF imports that RT, or the family isn't negotiated.` : "not received." },
    { k: "sid", title: "Is the service SID usable (locator reachable)?", text: imp ? (imp.installed ? `${imp.route.sid} resolves via ${locOf(imp.route.pe)}/64; next hop ${imp.route.nh} reachable — installed.` : `not installed: ${imp.why}; next hop ${imp.route.nh} ${imp.nhOk ? "reachable" : "unreachable"}.`) : "—" },
    { k: "back", title: "Is there a way back?", text: eg ? (back ? `${eg} reaches ${ceHost(srcCe, fam)} via ${back.pfx} (${back.kind}).` : `${eg} has no route back to ${ceHost(srcCe, fam)} in ${vrf}.`) : "—" },
  ];
}
