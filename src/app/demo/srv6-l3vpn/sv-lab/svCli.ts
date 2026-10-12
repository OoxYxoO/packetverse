import type { CliArgSpec, CliCommandSet, CliVendor } from "@/lib/cli/types";
import { buildXrSet, choiceArg, type SpCfgStmt, type SpCmd, type SpDevCli, type SpXrSpec } from "@/components/sp-lab/spCli";
import { pad, spAge, spStamp } from "@/components/sp-lab/spKit";
import { parseIf, xrIf } from "@/components/sp-lab/spNames";
import { v6norm } from "@/lib/sim-engine/scenarios/sxNet";
import {
  AS,
  SV_CE,
  SV_CES,
  SV_LO,
  SV_PES,
  SV_ROUTERS,
  SV_VRFS,
  ceOnIf,
  coreIfs,
  famOf,
  locOf,
  localSid,
  peIfIp,
  ribLookup,
  svPing,
  vrfLookup,
  type BgpVrfAf,
  type Fam,
  type IfName,
  type Pe,
  type SvAction,
  type SvRtr,
  type SvR,
  type SvState,
  type Vrf,
  type VpnRoute,
} from "@/lib/sim-engine/scenarios/svNet";

/**
 * Command lines of the SRv6 L3VPN Lab — IOS XR on PE1, P1, P2, PE2 and RR1. Every output is printed from the lab model.
 *
 *   show vrf all · show vrf <vrf> detail · show route vrf <vrf> [ipv6] · show cef vrf <vrf> [ipv6] <ip>
 *   show bgp <afi> unicast [summary | vrf <vrf> | rd <rd> <prefix>] · show segment-routing srv6 sid | locator
 *   show isis adjacency · show isis segment-routing srv6 locators · show route ipv6 [<ip>] · show logging
 *   ping vrf <vrf> <ip> · ping <ipv6>
 *   configure → vrf <vrf> → address-family ipv4|ipv6 unicast → import|export route-target → <rt>
 *            → interface <ce-if> → vrf <vrf> · router static → vrf → address-family → <prefix> <next-hop>
 *            → router isis CORE → address-family ipv6 unicast → segment-routing srv6 → locator MAIN · interface → address-family
 *            → router bgp 65000 → neighbor <ip> → address-family vpnv4|vpnv6 unicast [route-reflector-client]
 *                               → vrf <vrf> → rd <rd> · address-family ipv4|ipv6 unicast → segment-routing srv6 →
 *                                 locator MAIN · alloc mode per-vrf|per-ce · redistribute static|connected
 */

export interface SvCliApi {
  s: SvState;
  act: (a: SvAction) => SvState;
  dev: SpDevCli<SvRtr>;
}
const age = (s: SvState) => spAge(s.clock, 15);
const isPe = (r: SvR): r is Pe => r === "PE1" || r === "PE2";
const IDX: Record<SvR, number> = { PE1: 1, P1: 11, P2: 12, PE2: 2, RR1: 99 };
const ll = (r: SvR) => `fe80::${IDX[r]}`;
const rid = (r: SvR) => `${IDX[r] % 256}.${IDX[r] % 256}.${IDX[r] % 256}.${IDX[r] % 256}`;
const short = (ifn: string) => xrIf(ifn, true);
const afiOf = (f: Fam) => (f === "ipv4" ? "vpnv4" : "vpnv6");
const famOfAfi = (a: string): Fam => (a === "vpnv4" ? "ipv4" : "ipv6");

// ---------------------------------------------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------------------------------------------
const vrfArg = choiceArg(SV_VRFS, (v) => (v === "CUST-A" ? "Customer A — dual-stack, CE1/CE6 at PE1, CE2/CE3 at PE2" : "Customer B — IPv4, CE4 at PE1, CE5 at PE2"));
const afiArg = choiceArg(["vpnv4", "vpnv6"], (a) => (a === "vpnv4" ? "VPNv4 — customers' IPv4 routes" : "VPNv6 — customers' IPv6 routes"));
const famArg = choiceArg(["ipv4", "ipv6"], (f) => `${f === "ipv4" ? "IPv4" : "IPv6"} unicast`);
const safiArg = choiceArg(["unicast"], () => "Unicast");
const rtArg: CliArgSpec = { choices: ["65000:100", "65000:200"], describe: (c) => (c === "65000:100" ? "CUST-A's route target" : c === "65000:200" ? "CUST-B's route target" : "ASN:nn route target"), resolve: (raw) => (/^\d{1,5}:\d{1,10}$/.test(raw) ? raw : undefined) };
const rdArg: CliArgSpec = { choices: ["65000:1", "65000:2", "65000:11", "65000:12"], describe: () => "ASN:nn route distinguisher", resolve: (raw) => (/^\d{1,5}:\d{1,10}$/.test(raw) ? raw : undefined) };
const v4ok = (x: string) => /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(x) && x.split(".").every((o) => +o <= 255);
const ipArg = (choices: string[], what: string): CliArgSpec => ({ choices, describe: () => what, resolve: (raw) => (v4ok(raw) ? raw : v6norm(raw)) });
const v4Arg = (choices: string[], what: string): CliArgSpec => ({ choices, describe: () => what, resolve: (raw) => (v4ok(raw) ? raw : undefined) });
const v6Arg = (choices: string[], what: string): CliArgSpec => ({ choices, describe: () => what, resolve: (raw) => v6norm(raw) });
const pfxArg: CliArgSpec = {
  choices: ["10.20.1.0/24", "10.10.1.0/24", "2001:db8:ca:20::/64"],
  describe: (c) => (c.includes(":") ? "IPv6 prefix" : "IPv4 prefix"),
  resolve: (raw) => {
    const m = /^(.+)\/(\d{1,3})$/.exec(raw);
    if (!m) return undefined;
    if (v4ok(m[1]) && +m[2] <= 32) return `${m[1]}/${m[2]}`;
    const n = v6norm(m[1]);
    return n && +m[2] <= 128 ? `${n}/${m[2]}` : undefined;
  },
};
const hostsOf = (fam: Fam) => SV_CES.map((c) => (fam === "ipv4" ? SV_CE[c].host4 : SV_CE[c].host6)).filter((x): x is string => !!x);
const ceIfArg = (r: SvR): CliArgSpec => ({
  choices: SV_CES.filter((c) => SV_CE[c].pe === r).map((c) => xrIf(SV_CE[c].ifn)),
  describe: (raw) => {
    const ce = ceOnIf(r, parseIf(raw) ?? "");
    return ce ? `to ${ce}` : undefined;
  },
  resolve: (raw) => {
    const n = parseIf(raw);
    return n && ceOnIf(r, n) ? n : undefined;
  },
});
const coreIfArg = (r: SvR, withLo: boolean): CliArgSpec => ({
  choices: [...(withLo ? ["Loopback0"] : []), ...coreIfs(r).map((i) => xrIf(i.ifn))],
  describe: (raw) => {
    const n = parseIf(raw);
    const i = coreIfs(r).find((x) => x.ifn === n);
    return i ? `to ${i.peer}` : n === "lo0" ? "Loopback0" : undefined;
  },
  resolve: (raw) => {
    const n = parseIf(raw);
    return n && ((n === "lo0" && withLo) || coreIfs(r).some((x) => x.ifn === n)) ? n : undefined;
  },
});

// ---------------------------------------------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------------------------------------------
const NOBGP = "% BGP instance 'default' not active";
function xrVrfAll(s: SvState, r: SvR): string {
  const c = s.cfg[r];
  const vrfs = SV_VRFS.filter((v) => c.vrfs[v]);
  if (!vrfs.length) return "";
  const out = [`${pad("VRF", 21)}${pad("RD", 20)}${pad("RT", 27)}${pad("AFI", 6)}SAFI`];
  for (const v of vrfs) {
    out.push(`${pad(v, 21)}${c.bgp?.vrf[v]?.rd ?? "not set"}`);
    for (const f of ["ipv4", "ipv6"] as Fam[]) {
      const a = c.vrfs[v]![f];
      if (!a) continue;
      for (const rt of a.imp) out.push(`${pad("", 41)}${pad(`import  ${rt}`, 27)}${pad(f.toUpperCase(), 6)}Unicast`);
      for (const rt of a.exp) out.push(`${pad("", 41)}${pad(`export  ${rt}`, 27)}${pad(f.toUpperCase(), 6)}Unicast`);
    }
  }
  return out.join("\n");
}
function xrVrfDetail(s: SvState, r: SvR, v: Vrf): string {
  const c = s.cfg[r];
  if (!c.vrfs[v]) return "";
  const ifs = SV_CES.filter((x) => SV_CE[x].pe === r && c.ifs[SV_CE[x].ifn]?.vrf === v).map((x) => `  ${xrIf(SV_CE[x].ifn)}`);
  const out = [`VRF ${v}; RD ${c.bgp?.vrf[v]?.rd ?? "not set"}; VPN ID not set`, "VRF mode: Regular", "Description not set", "Interfaces:", ...(ifs.length ? ifs : ["  (none)"])];
  for (const f of ["ipv4", "ipv6"] as Fam[]) {
    const a = c.vrfs[v]![f];
    if (!a) continue;
    out.push(`Address family ${f.toUpperCase()} Unicast`, "  Import VPN route-target communities:", ...a.imp.map((x) => `    RT:${x}`), "  Export VPN route-target communities:", ...a.exp.map((x) => `    RT:${x}`), "  No import route policy", "  No export route policy", "  No import VPN route-policy", "  No export VPN route-policy");
  }
  return out.join("\n");
}
/** Sort key: IPv4 octets / IPv6 hextets zero-padded, so prefixes print in address order. */
function pfxKey(pfx: string): string {
  const [ip, len] = pfx.split("/");
  if (!ip.includes(":")) return `4${ip.split(".").map((o) => o.padStart(3, "0")).join(".")}/${len.padStart(3, "0")}`;
  const h = v6norm(ip) ?? ip;
  const parts = h.split("::");
  const head = parts[0] ? parts[0].split(":") : [];
  const tail = parts.length > 1 && parts[1] ? parts[1].split(":") : [];
  const full = [...head, ...Array(Math.max(0, 8 - head.length - tail.length)).fill("0"), ...tail];
  return `6${full.map((x) => x.padStart(4, "0")).join(":")}/${len.padStart(3, "0")}`;
}
const RT_CODES = ["Codes: C - connected, S - static, R - RIP, B - BGP, (>) - Diversion path", "       O - OSPF, IA - OSPF inter area, i - ISIS, L1 - IS-IS level-1, L2 - IS-IS level-2", "       L - local, a - Application route", "", "Gateway of last resort is not set", ""];
function xrRouteVrf(s: SvState, r: SvR, v: Vrf, fam: Fam): string {
  if (!isPe(r) || !s.cfg[r].vrfs[v]) return `% VRF ${v} not found`;
  if (!s.cfg[r].vrfs[v]![fam]) return `% ${fam === "ipv4" ? "IPv4" : "IPv6"} unicast address family is not configured for VRF ${v}`;
  const t = [...s.view.vrfRib[r][v][fam]].sort((a, b) => pfxKey(a.pfx).localeCompare(pfxKey(b.pfx)));
  const rows: string[] = [];
  for (const x of t) {
    if (x.kind === "connected") {
      rows.push(`${pad("C", 5)}${x.pfx} is directly connected, ${age(s)}, ${xrIf(SV_CE[x.ce!].ifn)}`);
      rows.push(`${pad("L", 5)}${peIfIp(x.ce!, fam)}/${fam === "ipv4" ? 32 : 128} is directly connected, ${age(s)}, ${xrIf(SV_CE[x.ce!].ifn)}`);
    } else if (x.kind === "static") rows.push(`${pad("S", 5)}${x.pfx} [1/0] via ${x.nh}, ${age(s)}`);
    else rows.push(`${pad("B", 5)}${x.pfx} [200/0] via ${x.nh} (nexthop in vrf default), ${spAge(s.clock, 60)}`);
  }
  return [...RT_CODES, ...(rows.length ? rows : ["% No matching routes found"])].join("\n");
}
function bgpHead(r: SvR) {
  return [`BGP router identifier ${rid(r)}, local AS number ${AS}`, "BGP generic scan interval 60 secs", "Non-stop routing is enabled", "BGP table state: Active", "Table ID: 0x0   RD version: 0", "BGP main routing table version 41", "BGP NSR Initial initsync version 4 (Reached)", "BGP scan interval 60 secs", ""];
}
const STATUS = ["Status codes: s suppressed, d damped, h history, * valid, > best", "              i - internal, r RIB-failure, S stale, N Nexthop-discard", "Origin codes: i - IGP, e - EGP, ? - incomplete", "   Network            Next Hop            Metric LocPrf Weight Path"];
const row = (st: string, pfx: string, nh: string, local: boolean) => {
  const p = pfx.length > 18 ? `${pfx}\n${pad("", 22)}` : pad(pfx, 19);
  return `${st}${p}${pad(nh, 20)}${String(0).padStart(6)}${(local ? "" : "100").padStart(7)}${String(local ? 32768 : 0).padStart(7)} ?`;
};
const byPfx = <T extends { pfx: string }>(xs: T[]) => [...xs].sort((a, b) => pfxKey(a.pfx).localeCompare(pfxKey(b.pfx)));
/** Routes a PE keeps in BGP from other PEs: an RT one of its VRFs imports (RT-constrained retention). */
function keptOn(s: SvState, pe: Pe, fam: Fam): VpnRoute[] {
  return s.view.received[pe].filter((x) => x.fam === fam && SV_VRFS.some((v) => x.rts.some((rt) => s.cfg[pe].vrfs[v]?.[fam]?.imp.includes(rt))));
}
function xrBgpTable(s: SvState, r: SvR, fam: Fam, onlyVrf?: Vrf): string {
  if (r !== "RR1" && !isPe(r)) return NOBGP;
  const out = [...bgpHead(r), ...STATUS];
  if (r === "RR1") {
    if (onlyVrf) return `% VRF ${onlyVrf} not found`;
    const rds = [...new Set(s.view.rrTable.filter((x) => x.fam === fam).map((x) => x.rd))];
    for (const rd of rds) {
      out.push(`Route Distinguisher: ${rd}`);
      for (const x of byPfx(s.view.rrTable.filter((y) => y.fam === fam && y.rd === rd))) out.push(row("*>i", x.pfx, x.nh, false));
    }
  } else {
    for (const v of SV_VRFS) {
      if (onlyVrf && v !== onlyVrf) continue;
      const rd = s.cfg[r].bgp?.vrf[v]?.rd;
      if (!rd || !s.cfg[r].bgp?.vrf[v]?.af[fam]) continue;
      const ents = [...s.view.vpn.filter((y) => y.pe === r && y.vrf === v && y.fam === fam).map((x) => ({ pfx: x.pfx, l: row("*> ", x.pfx, x.localNh, true) })), ...s.view.imported[r].filter((y) => y.vrf === v && y.route.fam === fam).map((x) => ({ pfx: x.route.pfx, l: row("*>i", x.route.pfx, x.route.nh, false) }))];
      out.push(`Route Distinguisher: ${rd} (default for vrf ${v})`, ...byPfx(ents).map((x) => x.l));
    }
    if (!onlyVrf) {
      const rds = [...new Set(keptOn(s, r, fam).map((x) => x.rd))];
      for (const rd of rds) out.push(`Route Distinguisher: ${rd}`, ...byPfx(keptOn(s, r, fam).filter((x) => x.rd === rd)).map((x) => row("*>i", x.pfx, x.nh, false)));
    }
  }
  const n = out.filter((l) => /^\*/.test(l)).length;
  out.push("", `Processed ${n} prefixes, ${n} paths`);
  return out.join("\n");
}
function xrBgpRd(s: SvState, r: SvR, fam: Fam, rd: string, pfx: string): string {
  if (r !== "RR1" && !isPe(r)) return NOBGP;
  const head = [`BGP routing table entry for ${pfx}, Route Distinguisher: ${rd}`, "Versions:", "  Process           bRIB/RIB  SendTblVer", "  Speaker                  41          41", `Last Modified: ${spStamp(60).xr} for ${spAge(s.clock, 60)}`, "Paths: (1 available, best #1)"];
  const sidLines = (x: VpnRoute) => (x.sid ? ["      PSID-Type:L3, SubTLV Count:1", `       SubTLV: T:1(Sid information), Sid:${x.sid}, Behavior:${x.behavior}, SS-TLV Count:1`, "        SubSubTLV: T:1(Sid structure):"] : []);
  const rtLine = (x: VpnRoute) => `      Extended community: ${x.rts.map((y) => `RT:${y}`).join(" ") || "(none)"}`;
  // A PE's own route (by its own RD).
  if (isPe(r)) {
    const own = s.view.vpn.find((x) => x.pe === r && x.rd === rd && x.pfx === pfx && x.fam === fam);
    if (own) return [...head, s.view.sessions[r][afiOf(fam)] ? `  Advertised to peers (in unique update groups):\n    ${SV_LO.RR1}` : "  Not advertised to any peer", "  Path #1: Received by speaker 0", "  Local", `    ${own.localNh} from ${fam === "ipv4" ? "0.0.0.0" : "::"} (${rid(r)})`, `      Origin incomplete, metric 0, localpref 100, weight 32768, valid, redistributed, best, group-best, import-candidate`, `      Received Path ID 0, Local Path ID 1, version 41`, rtLine(own), ...sidLines(own)].join("\n");
    const imp = s.view.imported[r].find((x) => x.route.pfx === pfx && x.route.fam === fam && (x.route.rd === rd || s.cfg[r].bgp?.vrf[x.vrf]?.rd === rd));
    const kept = keptOn(s, r, fam).find((x) => x.rd === rd && x.pfx === pfx);
    const x = imp?.route ?? kept;
    if (!x) return "% Network not in table";
    const importedHere = imp && s.cfg[r].bgp?.vrf[imp.vrf]?.rd === rd;
    return [...head, "  Not advertised to any peer", "  Path #1: Received by speaker 0", "  Local", `    ${x.nh} (metric ${ribLookup(s.view, r, x.nh)?.cost ?? 0}) from ${SV_LO.RR1} (${rid(x.pe)})`, `      Origin incomplete, metric 0, localpref 100, valid, internal, best, group-best, import-candidate${importedHere ? `, imported` : ""}`, `      Received Path ID 0, Local Path ID 1, version 41`, rtLine(x), `      Originator: ${rid(x.pe)}, Cluster list: 99.99.99.99`, ...sidLines(x), ...(importedHere ? [`      Source AFI: ${afiOf(fam).toUpperCase()} Unicast, Source VRF: default, Source Route Distinguisher: ${x.rd}`] : [])].join("\n");
  }
  const x = s.view.rrTable.find((y) => y.rd === rd && y.pfx === pfx && y.fam === fam);
  if (!x) return "% Network not in table";
  const to = SV_PES.filter((p) => p !== x.pe && s.view.sessions[p][afiOf(fam)]);
  return [...head, to.length ? `  Advertised to peers (in unique update groups):\n    ${to.map((p) => SV_LO[p]).join(" ")}` : "  Not advertised to any peer", "  Path #1: Received by speaker 0", "  Local, (Received from a RR-client)", `    ${x.nh} (metric ${ribLookup(s.view, "RR1", x.nh)?.cost ?? 0}) from ${x.nh} (${rid(x.pe)})`, "      Origin incomplete, metric 0, localpref 100, valid, internal, best, group-best", rtLine(x), ...sidLines(x)].join("\n");
}
function xrBgpSum(s: SvState, r: SvR, fam: Fam): string {
  if (r !== "RR1" && !isPe(r)) return NOBGP;
  const afi = afiOf(fam);
  const peers: { ip: string; up: boolean; neg: boolean; rcv: number }[] = isPe(r)
    ? [{ ip: SV_LO.RR1, up: s.view.sessions[r].up, neg: s.view.sessions[r][afi], rcv: s.view.received[r].filter((x) => x.fam === fam).length }]
    : SV_PES.map((p) => ({ ip: SV_LO[p], up: s.view.sessions[p].up, neg: s.view.sessions[p][afi], rcv: s.view.rrTable.filter((x) => x.pe === p && x.fam === fam).length }));
  const rows = peers.filter((p) => !p.up || p.neg || (isPe(r) ? s.cfg[r].bgp!.nbr[afi] : s.cfg.RR1.rr![SV_PES.find((x) => SV_LO[x] === p.ip)!][afi])).map((p) => `${pad(p.ip, 18)}${String(0).padStart(1)}${String(AS).padStart(7)}${String(p.up ? 182 : 0).padStart(8)}${String(p.up ? 176 : 0).padStart(8)}${String(p.up ? 41 : 0).padStart(9)}${"0".padStart(5)}${"0".padStart(5)} ${pad(p.up ? spAge(s.clock, 30) : "00:00:00", 9)}${p.up ? (p.neg ? String(p.rcv).padStart(10) : "     NoNeg") : "Active"}`);
  return [...bgpHead(r), "BGP is operating in STANDALONE mode.", "", "", "Process       RcvTblVer   bRIB/RIB   LabelVer  ImportVer  SendTblVer  StandbyVer", "Speaker              41         41         41         41          41           0", "", "Neighbor          Spk    AS MsgRcvd MsgSent   TblVer  InQ OutQ  Up/Down  St/PfxRcd", ...rows].join("\n");
}
function xrCef(s: SvState, r: SvR, v: Vrf, ip: string): string {
  if (!isPe(r) || !s.cfg[r].vrfs[v]) return `% VRF ${v} not found`;
  const fam = famOf(ip);
  const rt = vrfLookup(s.view, r, v, ip);
  const def = fam === "ipv4" ? "0.0.0.0/0" : "::/0";
  if (!rt) return [`${def}, version 0, proxy default, default route handler, drop adjacency, internal 0x1001011 0x0 (ptr 0x8d7b1f20) [1], 0x0 (0x0), 0x0 (0x0)`, ` Updated ${spStamp(15).xr.replace(" UTC", "")}`, ` Prefix Len 0, traffic index 0, precedence n/a, priority 15`, "   via 0.0.0.0/32, 0 dependency, weight 0, class 0 [flags 0x0]", "    next hop 0.0.0.0/32", "     drop adjacency"].join("\n");
  const len = rt.pfx.split("/")[1];
  if (rt.kind === "bgp") {
    const sid = rt.imp!.route.sid!;
    const lo = ribLookup(s.view, r, sid);
    return [`${rt.pfx}, version 52, SRv6 Headend, internal 0x5000001 0x30 (ptr 0x8e3a2b10) [1], 0x0 (0x0), 0x0 (0x0)`, ` Updated ${spStamp(60).xr.replace(" UTC", "")}`, ` Prefix Len ${len}, traffic index 0, precedence n/a, priority 3`, `   via ${rt.nh}/128, 3 dependencies, recursive [flags 0x6000]`, "    path-idx 0 NHID 0x0 [0x8e1f0a40 0x0]", "    next hop VRF - 'default', table - 0xe0800000", `    next hop ${rt.nh}/128 via ${lo ? lo.pfx : `${rt.nh}/128`}`, `     SRv6 H.Encaps.Red SID-list {${sid}}`].join("\n");
  }
  const ce = rt.ce!;
  const nh = rt.kind === "static" ? rt.nh! : ip;
  return [`${rt.pfx}, version 21, internal 0x1000001 0x30 (ptr 0x8e3a1c80) [1], 0x0 (0x0), 0x0 (0x0)`, ` Updated ${spStamp(15).xr.replace(" UTC", "")}`, ` Prefix Len ${len}, traffic index 0, precedence n/a, priority 3`, `   via ${nh}/${fam === "ipv4" ? 32 : 128}, ${xrIf(SV_CE[ce].ifn)}, 4 dependencies, weight 0, class 0 [flags 0x0]`, `    path-idx 0 NHID 0x0 [0x8e1c2d70 0x0]`, `    next hop ${nh}/${fam === "ipv4" ? 32 : 128}`, `    local adjacency`].join("\n");
}
function xrSids(s: SvState, r: SvR): string {
  const fnOf = (sid: string) => parseInt(sid.split(":")[4] || "0", 16);
  const rows = [...s.view.sids[r]].sort((a, b) => fnOf(a.sid) - fnOf(b.sid));
  if (!rows.length) return "";
  const ctx = (x: (typeof rows)[number]) => (x.behavior === "End" ? "'default':1" : x.behavior === "End.X" ? `[${short(x.ifn!)}, Link-Local]` : x.ce ? `'${x.vrf}':${x.behavior === "End.DX4" ? `${SV_CE[x.ce].link4}2` : `${SV_CE[x.ce].link6}2`}` : `'${x.vrf}'`);
  return ["", "*** Locator: 'MAIN' *** ", "", "SID                         Behavior          Context                           Owner               State  RW", "--------------------------  ----------------  --------------------------------  ------------------  -----  --", ...rows.map((x) => `${pad(x.sid, 28)}${pad(x.behavior === "End" || x.behavior === "End.X" ? `${x.behavior} (PSP/USD)` : x.behavior, 18)}${pad(ctx(x), 34)}${pad(x.owner === "isis" ? "isis-CORE" : `bgp-${AS}`, 20)}${pad("InUse", 7)}Y`)].join("\n");
}
function xrLocator(s: SvState, r: SvR): string {
  const p = locOf(r);
  if (!p) return "";
  return [`${pad("Name", 22)}${pad("ID", 9)}${pad("Algo", 6)}${pad("Prefix", 26)}${pad("Status", 9)}Flags`, `${pad("--------------------", 22)}${pad("-------", 9)}${pad("----", 6)}${pad("------------------------", 26)}${pad("-------", 9)}--------`, `${pad("MAIN", 22)}${pad("1", 9)}${pad("0", 6)}${pad(`${p}/64`, 26)}${pad("Up", 9)}U`].join("\n");
}
function xrIsisLocators(s: SvState, r: SvR): string {
  const p = locOf(r);
  return ["", "IS-IS CORE SRv6 Locators", `${pad("Name", 22)}${pad("ID", 9)}${pad("Algo", 6)}${pad("Prefix", 26)}Status`, `${pad("------", 22)}${pad("----", 9)}${pad("----", 6)}${pad("------", 26)}------`, ...(p && s.cfg[r].isisLoc ? [`${pad("MAIN", 22)}${pad("1", 9)}${pad("0", 6)}${pad(`${p}/64`, 26)}Active`] : [])].join("\n");
}
function xrAdj(s: SvState, r: SvR): string {
  const ups = coreIfs(r).filter((i) => s.view.adj[i.link.id]);
  return ["IS-IS CORE Level-2 adjacencies:", "System Id      Interface                SNPA           State Hold Changed  NSF IPv4 IPv6", "                                                                               BFD  BFD", ...ups.map((i) => `${pad(i.peer, 15)}${pad(short(i.ifn), 25)}${pad("*PtoP*", 15)}${pad("Up", 6)}${pad(26, 5)}${pad(age(s), 9)}Yes None None`), "", `Total adjacency count: ${ups.length}`].join("\n");
}
function xrRoute6(s: SvState, r: SvR): string {
  const rows: string[] = [];
  for (const x of [...s.view.rib[r]].sort((a, b) => pfxKey(a.pfx).localeCompare(pfxKey(b.pfx)))) {
    if (x.kind === "connected") rows.push(`${pad("C", 5)}${x.pfx} is directly connected,`, `      ${age(s)}, ${xrIf(coreIfs(r).find((i) => `${i.link.net}/64` === x.pfx)!.ifn)}`);
    else if (x.kind === "local") rows.push(`${pad("L", 5)}${x.pfx} is directly connected,`, `      ${age(s)}, ${x.what === "Loopback0" ? "Loopback0" : "Null0 (SRv6 locator)"}`);
    else rows.push(`${pad("i L2", 5)}${x.pfx}`, `      [115/${x.cost}] via ${ll(x.nh!.r)}, ${age(s)}, ${xrIf(x.nh!.ifn)}`);
  }
  return [...RT_CODES, ...rows].join("\n");
}
function xrRoute6Ip(s: SvState, r: SvR, ip: string): string {
  const x = ribLookup(s.view, r, ip);
  if (!x) return "% Network not in table";
  if (x.kind !== "isis") return [`Routing entry for ${x.pfx}`, `  Known via "${x.kind === "connected" ? "connected" : "local"}", distance 0, metric 0${x.what === "SRv6 locator MAIN" ? " (SRv6 locator)" : ""}`, "  Routing Descriptor Blocks", `    directly connected, via ${x.what === "Loopback0" ? "Loopback0" : x.kind === "connected" ? xrIf(coreIfs(r).find((i) => `${i.link.net}/64` === x.pfx)!.ifn) : "Null0"}`].join("\n");
  return [`Routing entry for ${x.pfx}`, `  Known via "isis CORE", distance 115, metric ${x.cost}, type level-2${x.what.includes("locator") ? ", SRv6 locator" : ""}`, `  Installed ${spStamp(15).xr.replace(" UTC", "")} for ${age(s)}`, "  Routing Descriptor Blocks", `    ${ll(x.nh!.r)}, from ${SV_LO[(SV_ROUTERS.find((o) => x.what.startsWith(o)) ?? r) as SvR]}, via ${xrIf(x.nh!.ifn)}`, `      Route metric is ${x.cost}`, "  No advertising protos."].join("\n");
}
function xrPing6(s: SvState, r: SvR, ip: string): string {
  const n = v6norm(ip)!;
  const owner = SV_ROUTERS.find((o) => SV_LO[o] === n || coreIfs(o).some((i) => i.ip === n) || !!localSid(s.view, o, n));
  let ok = false;
  let unreach = false;
  if (owner) {
    const sid = localSid(s.view, owner, n);
    const there = owner === r || !!ribLookup(s.view, r, n);
    const back = owner === r || s.view.rib[owner].some((x) => x.kind === "isis" && x.pfx === `${SV_LO[r]}/128`) || coreIfs(owner).some((i) => coreIfs(r).some((j) => j.link.id === i.link.id));
    ok = there && back && (!sid || sid.behavior === "End" || sid.behavior === "End.X");
    unreach = there && !!sid && !ok;
  }
  return ["Type escape sequence to abort.", `Sending 5, 100-byte ICMP Echos to ${n}, timeout is 2 seconds:`, (ok ? "!" : unreach ? "U" : ".").repeat(5), ok ? "Success rate is 100 percent (5/5), round-trip min/avg/max = 1/2/4 ms" : "Success rate is 0 percent (0/5)"].join("\n");
}
function xrPingVrf(api: SvCliApi, r: SvR, v: Vrf, ip: string): string {
  if (!isPe(r) || !api.s.cfg[r].vrfs[v]) return `% VRF ${v} not found`;
  const p = svPing(api.s.cfg, api.s.view, { pe: r, vrf: v }, ip);
  api.act({ type: "ping", src: { pe: r, vrf: v }, to: ip });
  return ["Type escape sequence to abort.", `Sending 5, 100-byte ICMP Echos to ${ip}, timeout is 2 seconds:`, (p.ok ? "!" : ".").repeat(5), p.ok ? `Success rate is 100 percent (5/5), round-trip min/avg/max = 2/3/6 ms` : "Success rate is 0 percent (0/5)"].join("\n");
}
function xrLogging(s: SvState, r: SvR): string {
  const lines = s.sys.filter((x) => x.dev === r).slice(-30).map((x) => {
    const st = `RP/0/RP0/CPU0:${spStamp(x.t).xr}`;
    const i = x.peer && x.kind.startsWith("adj") ? coreIfs(r).find((y) => y.peer === x.peer) : undefined;
    if (x.kind === "adj-up" || x.kind === "adj-down") return `${st}: isis[1012]: %ROUTING-ISIS-5-ADJCHANGE : Adjacency to ${x.peer} (${i ? xrIf(i.ifn) : "?"}) (L2) ${x.kind === "adj-up" ? "Up, New adjacency" : "Down, Neighbor forgot us"}`;
    if (x.kind === "bgp-up" || x.kind === "bgp-down") return `${st}: bgp[1052]: %ROUTING-BGP-5-ADJCHANGE : neighbor ${x.peer} ${x.kind === "bgp-up" ? "Up" : "Down - BGP Notification sent, hold time expired"} (VRF: default) (AS: ${AS})`;
    return `${st}: config[65857]: %MGBL-CONFIG-6-DB_COMMIT : Configuration committed by user 'admin'. Use 'show commit changes ${1000000000 + x.t}' to view the changes.`;
  });
  return ["Syslog logging: enabled (0 messages dropped, 0 flushes, 0 overruns)", `    Buffer logging: level debugging, ${lines.length} messages logged`, "", "Log Buffer (2097152 bytes):", "", ...lines].join("\n");
}

// ---------------------------------------------------------------------------------------------------------------
// Configuration as IOS XR prints it
// ---------------------------------------------------------------------------------------------------------------
export function svXrLines(r: SvR, c: SvRtr): string[] {
  const out: string[] = [`hostname ${r}`, "!"];
  if (isPe(r))
    for (const v of SV_VRFS) {
      const x = c.vrfs[v];
      if (!x) continue;
      out.push(`vrf ${v}`);
      for (const f of ["ipv4", "ipv6"] as Fam[]) {
        const a = x[f];
        if (!a) continue;
        out.push(` address-family ${f} unicast`, "  import route-target", ...a.imp.map((y) => `   ${y}`), "  !", "  export route-target", ...a.exp.map((y) => `   ${y}`), "  !", " !");
      }
      out.push("!");
    }
  out.push("interface Loopback0", ` ipv6 address ${SV_LO[r]}/128`, "!");
  for (const i of coreIfs(r)) out.push(`interface ${xrIf(i.ifn)}`, ` description to ${i.peer}`, " mtu 9216", ` ipv6 address ${i.ip}/64`, "!");
  if (isPe(r))
    for (const ce of SV_CES.filter((x) => SV_CE[x].pe === r)) {
      const d = SV_CE[ce];
      const v = c.ifs[d.ifn]?.vrf;
      out.push(`interface ${xrIf(d.ifn)}`, ` description to ${ce}`, ...(v ? [` vrf ${v}`] : []), ` ipv4 address ${d.link4}1 255.255.255.0`, ...(d.link6 ? [` ipv6 address ${d.link6}1/64`] : []), "!");
    }
  if (isPe(r) && c.statics.length) {
    out.push("router static");
    for (const v of SV_VRFS) {
      const st = c.statics.filter((x) => x.vrf === v);
      if (!st.length) continue;
      out.push(` vrf ${v}`);
      for (const f of ["ipv4", "ipv6"] as Fam[]) {
        const sf = st.filter((x) => x.fam === f);
        if (sf.length) out.push(`  address-family ${f} unicast`, ...sf.map((x) => `   ${x.pfx} ${x.nh}`), "  !");
      }
      out.push(" !");
    }
    out.push("!");
  }
  out.push("router isis CORE", " is-type level-2-only", ` net 49.0001.0000.0000.${String(IDX[r]).padStart(4, "0")}.00`, " address-family ipv6 unicast", "  metric-style wide", ...(locOf(r) && c.isisLoc ? ["  segment-routing srv6", "   locator MAIN", "   !", "  !"] : []), " !", " interface Loopback0", "  passive", "  address-family ipv6 unicast", "  !", " !");
  for (const i of coreIfs(r)) if (c.ifs[i.ifn]?.isis) out.push(` interface ${xrIf(i.ifn)}`, "  point-to-point", "  address-family ipv6 unicast", "  !", " !");
  out.push("!");
  if (isPe(r) && c.bgp) {
    const b = c.bgp;
    out.push(`router bgp ${AS}`, ` bgp router-id ${rid(r)}`, " address-family vpnv4 unicast", " !", " address-family vpnv6 unicast", " !", ` neighbor ${SV_LO.RR1}`, `  remote-as ${AS}`, "  update-source Loopback0", ...(b.nbr.vpnv4 ? ["  address-family vpnv4 unicast", "  !"] : []), ...(b.nbr.vpnv6 ? ["  address-family vpnv6 unicast", "  !"] : []), " !");
    for (const v of SV_VRFS) {
      const bv = b.vrf[v];
      if (!bv) continue;
      out.push(` vrf ${v}`, ...(bv.rd ? [`  rd ${bv.rd}`] : []));
      for (const f of ["ipv4", "ipv6"] as Fam[]) {
        const a = bv.af[f];
        if (!a) continue;
        out.push(`  address-family ${f} unicast`, ...(a.srv6On ? ["   segment-routing srv6", ...(a.srv6 ? [`    locator ${a.srv6}`] : []), `    alloc mode ${a.mode}`, "   !"] : []), ...(a.rc ? ["   redistribute connected"] : []), ...(a.rs ? ["   redistribute static"] : []), "  !");
      }
      out.push(" !");
    }
    out.push("!");
  }
  if (r === "RR1" && c.rr) {
    out.push(`router bgp ${AS}`, ` bgp router-id ${rid(r)}`, " bgp cluster-id 99.99.99.99", " address-family vpnv4 unicast", " !", " address-family vpnv6 unicast", " !");
    for (const p of SV_PES) out.push(` neighbor ${SV_LO[p]}`, `  remote-as ${AS}`, "  update-source Loopback0", ...(c.rr[p].vpnv4 ? ["  address-family vpnv4 unicast", "   route-reflector-client", "  !"] : []), ...(c.rr[p].vpnv6 ? ["  address-family vpnv6 unicast", "   route-reflector-client", "  !"] : []), " !");
    out.push("!");
  }
  if (locOf(r)) out.push("segment-routing", " srv6", "  encapsulation", `   source-address ${SV_LO[r]}`, "  !", "  locators", "   locator MAIN", `    prefix ${locOf(r)}/64`, "   !", "  !", " !", "!");
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Configuration statements
// ---------------------------------------------------------------------------------------------------------------
function stmts(r: SvR): SpCfgStmt<SvRtr>[] {
  const PEONLY = "% VRFs and VPN services are configured on PE1 and PE2 in this lab.";
  const peOnly = (c: SvRtr) => (isPe(r) ? c : PEONLY);
  const vf = (c: SvRtr, x: Record<string, string>) => ((c.vrfs[x.v as Vrf] ??= {})[x.vfam as Fam] ??= { imp: [], exp: [] });
  const bv = (c: SvRtr, x: Record<string, string>) => (c.bgp!.vrf[x.bvrf as Vrf] ??= { af: {} });
  const baf = (c: SvRtr, x: Record<string, string>): BgpVrfAf => (bv(c, x).af[x.bfam as Fam] ??= { srv6On: false, mode: "per-vrf", rs: false, rc: false });
  const ifc = (c: SvRtr, ifn: string) => (c.ifs[ifn as IfName] ??= {});
  const famIs = (want: string, x: string) => (want === "ipv4" ? v4ok(x.split("/")[0]) : x.includes(":"));
  return [
    { id: "vrf", summary: "Configure a VRF", args: { v: vrfArg }, xr: { mode: "config", syntax: "vrf <v>", enter: "vrf", apply: (c, a) => (isPe(r) ? ((c.vrfs[a.v as Vrf] ??= {}), c) : PEONLY), no: (c, a) => (delete c.vrfs[a.v as Vrf], Object.values(c.ifs).forEach((i) => i && i.vrf === a.v && (i.vrf = undefined)), c) } },
    { id: "vrf-af", summary: "An address family of the VRF", args: { vfam: famArg, vsafi: safiArg }, xr: { mode: "vrf", syntax: "address-family <vfam> <vsafi>", enter: "vrf-af", apply: (c, a, x) => (a.vfam === "ipv6" && x.v === "CUST-B" ? "% CUST-B is an IPv4-only customer in this lab." : (vf(c, { ...x, vfam: a.vfam }), c)), no: (c, a, x) => (delete c.vrfs[x.v as Vrf]?.[a.vfam as Fam], c) } },
    { id: "imp", summary: "Route targets to import", xr: { mode: "vrf-af", syntax: "import route-target", enter: "rt-imp", apply: (c) => c, no: (c, _a, x) => ((vf(c, x).imp = []), c) } },
    { id: "exp", summary: "Route targets to export", xr: { mode: "vrf-af", syntax: "export route-target", enter: "rt-exp", apply: (c) => c, no: (c, _a, x) => ((vf(c, x).exp = []), c) } },
    { id: "imp-rt", summary: "A route target to import", args: { irt: rtArg }, xr: { mode: "rt-imp", syntax: "<irt>", apply: (c, a, x) => ((vf(c, x).imp = [...new Set([...vf(c, x).imp, a.irt])]), c), no: (c, a, x) => ((vf(c, x).imp = vf(c, x).imp.filter((y) => y !== a.irt)), c) } },
    { id: "exp-rt", summary: "A route target to export", args: { ert: rtArg }, xr: { mode: "rt-exp", syntax: "<ert>", apply: (c, a, x) => ((vf(c, x).exp = [...new Set([...vf(c, x).exp, a.ert])]), c), no: (c, a, x) => ((vf(c, x).exp = vf(c, x).exp.filter((y) => y !== a.ert)), c) } },
    { id: "ceif", summary: "Customer interface configuration", args: { gif: ceIfArg(r) }, xr: { mode: "config", syntax: "interface <gif>", enter: "ceif", apply: (c) => peOnly(c), no: () => "% This lab keeps its interfaces." } },
    { id: "ceif-vrf", summary: "Put the interface in a VRF", args: { iv: vrfArg }, xr: { mode: "ceif", syntax: "vrf <iv>", noSyntax: "vrf", apply: (c, a, x) => ((ifc(c, x.gif).vrf = a.iv as Vrf), c), no: (c, _a, x) => ((ifc(c, x.gif).vrf = undefined), c) } },
    { id: "rs", summary: "Static routes", xr: { mode: "config", syntax: "router static", enter: "rs", apply: (c) => peOnly(c) } },
    { id: "rs-vrf", summary: "Static routes of a VRF", args: { sv: vrfArg }, xr: { mode: "rs", syntax: "vrf <sv>", enter: "rs-vrf", apply: (c) => c, no: (c, a) => ((c.statics = c.statics.filter((y) => y.vrf !== a.sv)), c) } },
    { id: "rs-af", summary: "An address family", args: { sfam: famArg, ssafi: safiArg }, xr: { mode: "rs-vrf", syntax: "address-family <sfam> <ssafi>", enter: "rs-af", apply: (c) => c } },
    { id: "rs-route", summary: "A static route toward a CE", args: { spfx: pfxArg, snh: ipArg(["192.168.11.2", "192.168.16.2", "2001:db8:c1::2"], "Next hop (the CE)") }, xr: { mode: "rs-af", syntax: "<spfx> <snh>", apply: (c, a, x) => (!famIs(x.sfam, a.spfx) || !famIs(x.sfam, a.snh) ? `% ${a.spfx} ${a.snh} is not ${x.sfam === "ipv4" ? "IPv4" : "IPv6"}.` : ((c.statics = [...c.statics.filter((y) => !(y.vrf === x.sv && y.pfx === a.spfx)), { vrf: x.sv as Vrf, fam: x.sfam as Fam, pfx: a.spfx, nh: a.snh }]), c)), no: (c, a, x) => ((c.statics = c.statics.filter((y) => !(y.vrf === x.sv && y.pfx === a.spfx))), c) } },
    { id: "router-isis", summary: "IS-IS routing protocol", args: { tag: choiceArg(["CORE"], () => "Instance tag") }, xr: { mode: "config", syntax: "router isis <tag>", enter: "isis", apply: (c) => c } },
    { id: "isis-af6", summary: "Enter the IPv6 unicast address family", xr: { mode: "isis", syntax: "address-family ipv6 unicast", enter: "isis-af6", apply: (c) => c } },
    { id: "isis-ms", summary: "Use wide metrics", args: { w: choiceArg(["wide"], () => "Wide metrics") }, xr: { mode: "isis-af6", syntax: "metric-style <w>", apply: (c) => c, no: () => "% SRv6 needs wide metrics." } },
    { id: "isis-srv6", summary: "SRv6 in IS-IS", xr: { mode: "isis-af6", syntax: "segment-routing srv6", enter: "isis-srv6", apply: (c) => (locOf(r) ? c : "% RR1 has no SRv6 locator in this lab."), no: (c) => ((c.isisLoc = false), c) } },
    { id: "isis-loc", summary: "Advertise this locator and allocate End / End.X", args: { lname: choiceArg(["MAIN"], () => "Locator name") }, xr: { mode: "isis-srv6", syntax: "locator <lname>", apply: (c) => ((c.isisLoc = true), c), no: (c) => ((c.isisLoc = false), c) } },
    { id: "isis-if", summary: "Enter the IS-IS interface configuration submode", args: { cif: coreIfArg(r, true) }, xr: { mode: "isis", syntax: "interface <cif>", enter: "isis-if", apply: (c, a) => (a.cif === "lo0" ? c : ((ifc(c, a.cif).isis = true), c)), no: (c, a) => (a.cif === "lo0" ? "% This lab keeps Loopback0 in IS-IS." : ((ifc(c, a.cif).isis = false), c)) } },
    { id: "isis-p2p", summary: "Treat the interface as point-to-point", xr: { mode: "isis-if", syntax: "point-to-point", apply: (c) => c, no: () => "% This lab keeps every core link point-to-point." } },
    { id: "isis-passive", summary: "Advertise the prefix but send no hellos", xr: { mode: "isis-if", syntax: "passive", apply: (c, _a, x) => (x.cif === "lo0" ? c : "% This lab only uses passive on Loopback0.") } },
    { id: "isis-if-af6", summary: "Enter the interface IPv6 unicast address family", xr: { mode: "isis-if", syntax: "address-family ipv6 unicast", enter: "isis-if-af6", apply: (c) => c } },
    { id: "bgp", summary: "BGP", args: { asn: choiceArg([String(AS)], () => "AS number") }, xr: { mode: "config", syntax: "router bgp <asn>", enter: "bgp", apply: (c) => (isPe(r) || r === "RR1" ? c : "% P routers are BGP-free in this lab.") } },
    { id: "bgp-af", summary: "Enable a VPN address family on this router", args: { gafi: afiArg, gsafi: safiArg }, xr: { mode: "bgp", syntax: "address-family <gafi> <gsafi>", enter: "bgp-af", apply: (c) => c, no: () => "% This lab keeps both VPN families enabled; change them per neighbor." } },
    { id: "nbr", summary: "An iBGP neighbor", args: { nbr: ipArg(isPe(r) ? [SV_LO.RR1] : [SV_LO.PE1, SV_LO.PE2], isPe(r) ? "RR1, the route reflector" : "A PE (route-reflector client)") }, xr: { mode: "bgp", syntax: "neighbor <nbr>", enter: "bgp-nbr", apply: (c, a) => ((isPe(r) ? a.nbr === SV_LO.RR1 : a.nbr === SV_LO.PE1 || a.nbr === SV_LO.PE2) ? c : `% ${a.nbr} is not a BGP neighbor in this lab.`), no: () => "% This lab keeps its BGP sessions; remove an address family instead." } },
    { id: "nbr-ras", summary: "Neighbor AS", args: { ras: choiceArg([String(AS)], () => "AS number") }, xr: { mode: "bgp-nbr", syntax: "remote-as <ras>", apply: (c) => c } },
    { id: "nbr-upd", summary: "Source of the session", args: { lo: choiceArg(["Loopback0"], () => "Loopback interface") }, xr: { mode: "bgp-nbr", syntax: "update-source <lo>", apply: (c) => c } },
    {
      id: "nbr-af",
      summary: "Exchange this VPN family with the neighbor",
      args: { nafi: afiArg, nsafi: safiArg },
      xr: {
        mode: "bgp-nbr",
        syntax: "address-family <nafi> <nsafi>",
        enter: "bgp-nbr-af",
        apply: (c, a, x) => {
          const k = a.nafi as "vpnv4" | "vpnv6";
          if (isPe(r)) c.bgp!.nbr[k] = true;
          else c.rr![x.nbr === SV_LO.PE1 ? "PE1" : "PE2"][k] = true;
          return c;
        },
        no: (c, a, x) => {
          const k = a.nafi as "vpnv4" | "vpnv6";
          if (isPe(r)) c.bgp!.nbr[k] = false;
          else c.rr![x.nbr === SV_LO.PE1 ? "PE1" : "PE2"][k] = false;
          return c;
        },
      },
    },
    { id: "nbr-rrc", summary: "This neighbor is a route-reflector client", xr: { mode: "bgp-nbr-af", syntax: "route-reflector-client", apply: (c) => (r === "RR1" ? c : "% Only RR1 reflects routes in this lab."), no: () => "% Both PEs stay route-reflector clients in this lab." } },
    { id: "bgp-vrf", summary: "A VRF in BGP", args: { bvrf: vrfArg }, xr: { mode: "bgp", syntax: "vrf <bvrf>", enter: "bgp-vrf", apply: (c, a) => (isPe(r) ? (bv(c, { bvrf: a.bvrf }), c) : PEONLY), no: (c, a) => (delete c.bgp!.vrf[a.bvrf as Vrf], c) } },
    { id: "bgp-rd", summary: "Route distinguisher", args: { rd: rdArg }, xr: { mode: "bgp-vrf", syntax: "rd <rd>", noSyntax: "rd", apply: (c, a, x) => ((bv(c, x).rd = a.rd), c), no: (c, _a, x) => ((bv(c, x).rd = undefined), c) } },
    { id: "bgp-vrf-af", summary: "The VRF's address family", args: { bfam: famArg, bsafi: safiArg }, xr: { mode: "bgp-vrf", syntax: "address-family <bfam> <bsafi>", enter: "bgp-vrf-af", apply: (c, a, x) => (a.bfam === "ipv6" && x.bvrf === "CUST-B" ? "% CUST-B is an IPv4-only customer in this lab." : (baf(c, { ...x, bfam: a.bfam }), c)), no: (c, a, x) => (delete bv(c, x).af[a.bfam as Fam], c) } },
    { id: "bgp-srv6", summary: "SRv6 service SIDs for this VRF", xr: { mode: "bgp-vrf-af", syntax: "segment-routing srv6", enter: "bgp-srv6", apply: (c, _a, x) => ((baf(c, x).srv6On = true), c), no: (c, _a, x) => ((baf(c, x).srv6On = false), (baf(c, x).srv6 = undefined), (baf(c, x).mode = "per-vrf"), c) } },
    { id: "bgp-srv6-loc", summary: "Allocate the VRF's SIDs from this locator", args: { bloc: { choices: ["MAIN"], describe: () => "Locator name", resolve: (raw) => (/^[A-Za-z][\w-]{0,31}$/.test(raw) ? raw : undefined) } }, xr: { mode: "bgp-srv6", syntax: "locator <bloc>", noSyntax: "locator", apply: (c, a, x) => ((baf(c, x).srv6 = a.bloc), c), no: (c, _a, x) => ((baf(c, x).srv6 = undefined), c) } },
    { id: "bgp-srv6-mode", summary: "One SID per VRF (End.DT) or one per CE (End.DX)", args: { mode: choiceArg(["per-vrf", "per-ce"], (m) => (m === "per-vrf" ? "End.DT4/DT6: decapsulate and look up in the VRF" : "End.DX4/DX6: decapsulate and send to one CE")) }, xr: { mode: "bgp-srv6", syntax: "alloc mode <mode>", noSyntax: "alloc mode", apply: (c, a, x) => ((baf(c, x).mode = a.mode as "per-vrf" | "per-ce"), c), no: (c, _a, x) => ((baf(c, x).mode = "per-vrf"), c) } },
    { id: "bgp-rs", summary: "Advertise the VRF's static routes", xr: { mode: "bgp-vrf-af", syntax: "redistribute static", apply: (c, _a, x) => ((baf(c, x).rs = true), c), no: (c, _a, x) => ((baf(c, x).rs = false), c) } },
    { id: "bgp-rc", summary: "Advertise the VRF's connected subnets", xr: { mode: "bgp-vrf-af", syntax: "redistribute connected", apply: (c, _a, x) => ((baf(c, x).rc = true), c), no: (c, _a, x) => ((baf(c, x).rc = false), c) } },
  ];
}

// ---------------------------------------------------------------------------------------------------------------
// Command set
// ---------------------------------------------------------------------------------------------------------------
export function svXrSpec(api: SvCliApi, r: SvR): SpXrSpec<SvRtr> {
  const s = api.s;
  const sh = (id: string, syntax: string, summary: string, run: SpCmd["run"], args?: SpCmd["args"]): SpCmd => ({ id, syntax, summary, run, args });
  const nothing = (o: string, why: string) => o || { output: "", explanation: why };
  const any6 = v6Arg([SV_LO.PE2, "2001:db8:100:2:1::", "2001:db8:100:2::"], "IPv6 address (a loopback, a SID or a locator)");
  return {
    stmts: stmts(r),
    prompts: { config: "config", vrf: "config-vrf", "vrf-af": "config-vrf-af", "rt-imp": "config-vrf-import-rt", "rt-exp": "config-vrf-export-rt", ceif: "config-if", rs: "config-static", "rs-vrf": "config-static-vrf", "rs-af": "config-static-vrf-afi", isis: "config-isis", "isis-af6": "config-isis-af", "isis-srv6": "config-isis-srv6", "isis-if": "config-isis-if", "isis-if-af6": "config-isis-if-af", bgp: "config-bgp", "bgp-af": "config-bgp-af", "bgp-nbr": "config-bgp-nbr", "bgp-nbr-af": "config-bgp-nbr-af", "bgp-vrf": "config-bgp-vrf", "bgp-vrf-af": "config-bgp-vrf-af", "bgp-srv6": "config-bgp-vrf-af-srv6" },
    lines: (c) => svXrLines(r, c),
    help: { "show vrf": "VRF information", "show route": "IP routing table", "show cef": "Cisco Express Forwarding", "show bgp": "BGP information", "show segment-routing": "Segment routing information", "show segment-routing srv6": "SRv6 information", "show isis": "IS-IS information" },
    shows: [
      sh("vrf", "show vrf all", "VRFs, their RDs and route targets", () => nothing(xrVrfAll(s, r), "No VRF is configured on this router — the provider core carries no customer tables.")),
      sh("vrfd", "show vrf <v> detail", "One VRF: interfaces and route targets per address family", (a) => nothing(xrVrfDetail(s, r, a.v as Vrf), `VRF ${a.v} is not configured on this router.`), { v: vrfArg }),
      sh("rv4", "show route vrf <v>", "A VRF's IPv4 table", (a) => xrRouteVrf(s, r, a.v as Vrf, "ipv4"), { v: vrfArg }),
      sh("rv6", "show route vrf <v> ipv6", "A VRF's IPv6 table", (a) => xrRouteVrf(s, r, a.v as Vrf, "ipv6"), { v: vrfArg }),
      sh("cef4", "show cef vrf <v> <ip4>", "How the PE forwards an IPv4 customer destination (the SID list)", (a) => xrCef(s, r, a.v as Vrf, a.ip4), { v: vrfArg, ip4: v4Arg(hostsOf("ipv4"), "IPv4 destination") }),
      sh("cef6", "show cef vrf <v> ipv6 <ip6>", "How the PE forwards an IPv6 customer destination", (a) => xrCef(s, r, a.v as Vrf, a.ip6), { v: vrfArg, ip6: v6Arg(hostsOf("ipv6"), "IPv6 destination") }),
      sh("bgp", "show bgp <afi> unicast", "The VPN table: every RD, prefix and next hop", (a) => xrBgpTable(s, r, famOfAfi(a.afi)), { afi: afiArg }),
      sh("bgps", "show bgp <afi> unicast summary", "The BGP sessions and what each one carries", (a) => xrBgpSum(s, r, famOfAfi(a.afi)), { afi: afiArg }),
      sh("bgpv", "show bgp <afi> unicast vrf <v>", "One VRF's VPN routes", (a) => xrBgpTable(s, r, famOfAfi(a.afi), a.v as Vrf), { afi: afiArg, v: vrfArg }),
      sh("bgprd", "show bgp <afi> unicast rd <rd> <pfx>", "One VPN route: RT, next hop and SRv6 service SID", (a) => (famOf(a.pfx.split("/")[0]) !== famOfAfi(a.afi) ? `% ${a.pfx} is not a ${a.afi === "vpnv4" ? "VPNv4" : "VPNv6"} prefix` : xrBgpRd(s, r, famOfAfi(a.afi), a.rd, a.pfx)), { afi: afiArg, rd: rdArg, pfx: pfxArg }),
      sh("sid", "show segment-routing srv6 sid", "The local SID table: End, End.X and the BGP service SIDs", () => nothing(xrSids(s, r), "No local SID is allocated on this router.")),
      sh("loc", "show segment-routing srv6 locator", "This router's SRv6 locator", () => nothing(xrLocator(s, r), "No SRv6 locator is configured on this router.")),
      sh("isloc", "show isis segment-routing srv6 locators", "The locators IS-IS advertises", () => xrIsisLocators(s, r)),
      sh("adj", "show isis adjacency", "IS-IS adjacencies", () => xrAdj(s, r)),
      sh("rt6", "show route ipv6", "The global IPv6 table: loopbacks and locators", () => xrRoute6(s, r)),
      sh("rt6ip", "show route ipv6 <ip>", "The route toward a loopback, locator or SID", (a) => xrRoute6Ip(s, r, a.ip), { ip: any6 }),
      sh("log", "show logging", "The syslog buffer", () => xrLogging(s, r)),
    ],
    exec: [
      sh("pingv", "ping vrf <v> <dst>", "Ping a customer address from this PE's VRF (round trip through the VPN)", (a) => xrPingVrf(api, r, a.v as Vrf, a.dst), { v: vrfArg, dst: ipArg([...hostsOf("ipv4"), ...hostsOf("ipv6")], "Customer destination") }),
      sh("ping", "ping <dst6>", "Ping an IPv6 address in the provider core (a loopback or an End SID)", (a) => xrPing6(s, r, a.dst6), { dst6: any6 }),
    ],
  };
}
export function svSets(api: SvCliApi, r: SvR): Partial<Record<CliVendor, CliCommandSet>> {
  return { cisco: buildXrSet(api.dev, svXrSpec(api, r)) };
}
export function svStaticApi(s: SvState, r: SvR): SvCliApi {
  return { s, act: () => s, dev: { host: r, running: s.cfg[r], hist: s.hist[r], setCand: () => undefined, xr: [], setXr: () => undefined, edit: false, setEdit: () => undefined, commit: () => undefined } };
}
