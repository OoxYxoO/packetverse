import type { CliArgSpec, CliCommandSet, CliVendor } from "@/lib/cli/types";
import { buildJunosSet, buildXrSet, choiceArg, junosPipeConfig, type SpCfgStmt, type SpCmd, type SpDevCli, type SpJunosSpec, type SpXrSpec } from "@/components/sp-lab/spCli";
import { lpad, pad, spAge, spClone, spStamp, type JStmt } from "@/components/sp-lab/spKit";
import { jnIf, parseIf, xrIf } from "@/components/sp-lab/spNames";
import {
  AS,
  CES,
  IMPLICIT_NULL,
  L3_CES,
  L3_LINKS,
  L3_LO,
  L3_PES,
  L3_ROUTERS,
  ceIfs,
  connectedOf,
  coreIfs,
  inPrefix,
  ipNum,
  ldpLabel,
  type IfName,
  type L3Action,
  type L3Cfg,
  type L3R,
  type L3Route,
  type L3State,
  vrfImports,
} from "@/lib/sim-engine/scenarios/l3Net";

/**
 * Command lines of the MPLS L3VPN Lab — IOS XR or Junos on PE1, P1, P2, PE2. Every output is printed from the lab model:
 * VRFs and their tables, VPNv4 routes with RD, route targets and VPN labels, the label stacks the PEs impose, LDP.
 *
 *   IOS XR  show vrf all · show route vrf <vrf> [<ip>] · show bgp vpnv4 unicast [summary | rd <rd> <prefix> |
 *           vrf <vrf>] · show bgp summary · show cef vrf <vrf> <ip> · show arp vrf <vrf> · show mpls forwarding ·
 *           show mpls ldp neighbor brief · show route · show logging
 *           configure → vrf <vrf> → address-family ipv4 unicast → import / export route-target → <rt> ·
 *           interface <if> → vrf <vrf> · router static → vrf <vrf> → address-family ipv4 unicast → <prefix> <nh> ·
 *           router bgp 65000 → vrf <vrf> → rd <rd> · address-family ipv4 unicast → redistribute static · label mode
 *           per-vrf · neighbor <ip> → address-family vpnv4 unicast · mpls ldp → interface <if> · commit
 *   Junos   show route table <vrf>.inet.0 · show route table bgp.l3vpn.0 [detail] · show route table inet.3 ·
 *           show bgp summary · show bgp neighbor <ip> · show ldp session · show arp · show log messages
 *           configure → set routing-instances <vrf> instance-type vrf | interface <if> | route-distinguisher <rd> |
 *           vrf-target import|export target:<rt> | vrf-table-label | routing-options static route <p> next-hop <nh> ·
 *           protocols bgp group IBGP neighbor <ip> family inet-vpn unicast · protocols ldp interface <if> · commit
 */

export interface L3CliApi {
  s: L3State;
  act: (a: L3Action) => L3State;
  dev: SpDevCli<L3Cfg>;
}

// ---------------------------------------------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------------------------------------------
const ipRe = /^(\d{1,3}\.){3}\d{1,3}$/;
const pfxRe = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;
const rtRe = /^\d{1,10}:\d{1,10}$/;
const vrfNames = (s: L3State, r: L3R) => [...new Set([...Object.keys(s.cfg[r].vrfs), "CUST-A", "CUST-B", "SHARED"])];
const vrfArg = (s: L3State, r: L3R): CliArgSpec => ({ choices: vrfNames(s, r), describe: () => "VRF name", resolve: (raw) => (/^[A-Za-z][\w-]{0,31}$/.test(raw) ? raw : undefined) });
const rtArg: CliArgSpec = { choices: ["65001:100", "65001:200", "65001:900"], describe: () => "Route target (ASN:nn)", resolve: (raw) => (rtRe.test(raw) ? raw : undefined) };
const jrtArg: CliArgSpec = { choices: ["target:65001:100", "target:65001:200", "target:65001:900"], describe: () => "Route target (target:ASN:nn)", resolve: (raw) => (/^target:\d{1,10}:\d{1,10}$/.test(raw) ? raw.slice(7) : undefined) };
const wordRe = /^[A-Za-z][\w-]{0,31}$/;
const nameArg = (names: string[], what: string): CliArgSpec => ({ choices: names, describe: () => what, resolve: (raw) => (wordRe.test(raw) ? raw : undefined) });
const commNames = (s: L3State, r: L3R) => [...new Set([...Object.keys(s.cfg[r].jpol?.comms ?? {}), "CUST-A", "SHARED"])];
const polNames = (s: L3State, r: L3R) => [...new Set([...Object.keys(s.cfg[r].jpol?.pols ?? {}), "CUST-A-IMP", "SHARED-IMP"])];
const termNames = (s: L3State, r: L3R) => [...new Set([...Object.values(s.cfg[r].jpol?.pols ?? {}).flatMap((p) => Object.keys(p)), "1", "2"])];
const termArg = (s: L3State, r: L3R): CliArgSpec => ({ choices: termNames(s, r), describe: () => "Term name", resolve: (raw) => (/^[\w-]{1,32}$/.test(raw) ? raw : undefined) });
const rdArg: CliArgSpec = { choices: ["65001:101", "65001:201"], describe: () => "Route distinguisher (ASN:nn)", resolve: (raw) => (rtRe.test(raw) ? raw : undefined) };
const pfxArg: CliArgSpec = { choices: ["10.1.1.0/24", "10.2.2.0/24", "10.1.2.0/24", "10.9.9.0/24"], describe: () => "Prefix", resolve: (raw) => (pfxRe.test(raw) ? raw : undefined) };
const nhArg: CliArgSpec = { choices: ["172.16.1.2", "172.16.2.2", "172.16.9.2"], describe: () => "Next-hop address (the CE)", resolve: (raw) => (ipRe.test(raw) ? raw : undefined) };
const hostArg: CliArgSpec = { choices: ["10.1.1.10", "10.2.2.20", "10.9.9.10"], describe: () => "Destination", resolve: (raw) => (ipRe.test(raw) ? raw : pfxRe.test(raw) ? raw.split("/")[0] : undefined) };
const nbrArg = (r: L3R): CliArgSpec => ({ choices: L3_PES.filter((p) => p !== r).map((p) => L3_LO[p]), describe: () => "Neighbor (the other PE's loopback)", resolve: (raw) => (ipRe.test(raw) ? raw : undefined) });
const allIfs = (r: L3R) => [...coreIfs(r).map((x) => x.ifn), ...ceIfs(r).map((x) => x.ifn)];
const pifArg = (r: L3R, junos: boolean): CliArgSpec => ({
  choices: allIfs(r).map((i) => (junos ? jnIf(i) : xrIf(i))),
  describe: (c) => {
    const i = parseIf(c);
    const core = coreIfs(r).find((x) => x.ifn === i);
    const ce = ceIfs(r).find((x) => x.ifn === i);
    return core ? `to ${core.peer}` : ce ? `to ${ce.ce}` : "Interface";
  },
  resolve: (raw) => {
    const i = parseIf(raw.replace(/^(ge-0\/0\/[0-3])$/, "$1")) ?? (/^(ge-0\/0\/[0-3])(\.0)?$/.test(raw) ? raw.replace(".0", "") : undefined);
    return i && allIfs(r).includes(i as IfName) ? i : undefined;
  },
});

// ---------------------------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------------------------
const lab = (n: number | undefined) => (n === undefined ? "Unlabelled" : n === IMPLICIT_NULL ? "Pop" : String(n));
const routesOf = (s: L3State, r: L3R, vrf: string) => s.view.vrfRoutes[r].filter((x) => x.vrf === vrf);
const otherPe = (r: L3R): L3R => (r === "PE1" ? "PE2" : "PE1");
const coreNh = (r: L3R) => {
  const l = L3_LINKS.find((x) => x.a === r || x.b === r)!;
  return l.a === r ? { ip: l.bip, ifn: l.ai } : { ip: l.aip, ifn: l.bi };
};
const sortPfx = (a: string, b: string) => ipNum(a.split("/")[0]) - ipNum(b.split("/")[0]);
const isPe = (r: L3R) => L3_PES.includes(r);
/** A PE keeps a received VPNv4 route only if one of its VRFs imports a route target of it (default RT filtering). */
const kept = (s: L3State, r: L3R) => (s.view.vpnv4Up ? s.view.vpnv4.filter((x) => x.pe === otherPe(r) && Object.values(s.cfg[r].vrfs).some((c) => x.rts.some((rt) => vrfImports(s.cfg[r], c).includes(rt)))) : []);

// ---------------------------------------------------------------------------------------------------------------
// IOS XR outputs
// ---------------------------------------------------------------------------------------------------------------
function xrVrfAll(s: L3State, r: L3R): string {
  const vs = Object.entries(s.cfg[r].vrfs);
  if (!vs.length) return "";
  return ["VRF                  RD                  RT                         AFI   SAFI", ...vs.flatMap(([n, v]) => [`${pad(n, 21)}${v.rd ?? "not set"}`, ...v.imp.map((rt) => `${" ".repeat(41)}import  ${pad(rt, 19)}IPV4  Unicast`), ...v.exp.map((rt) => `${" ".repeat(41)}export  ${pad(rt, 19)}IPV4  Unicast`)])].join("\n");
}
function xrRouteVrf(s: L3State, r: L3R, vrf: string, ip?: string): string {
  if (!s.cfg[r].vrfs[vrf]) return `% VRF ${vrf} not found`;
  const rs = routesOf(s, r, vrf);
  if (ip) {
    const best = rs.filter((x) => inPrefix(ip, x.prefix)).sort((a, b) => Number(b.prefix.split("/")[1]) - Number(a.prefix.split("/")[1]))[0];
    if (!best) return "% Network not in table";
    const head = `Routing entry for ${best.prefix}`;
    if (best.via === "connected") return [head, `  Known via "connected", distance 0, metric 0 (connected)`, "  Routing Descriptor Blocks", `    directly connected, via ${xrIf(best.ifn!)}`].join("\n");
    if (best.via === "static") return [head, `  Known via "static", distance 1, metric 0`, `  Installed ${spStamp(30).xr.replace(" UTC", "")} for ${spAge(s.clock, 30)}`, "  Routing Descriptor Blocks", `    ${best.nh}, via ${xrIf(best.ifn!)}`, "      Route metric is 0"].join("\n");
    return [head, `  Known via "bgp ${AS}", distance 200, metric 0, type internal`, `  Installed ${spStamp(40).xr.replace(" UTC", "")} for ${spAge(s.clock, 40)}`, "  Routing Descriptor Blocks", `    ${best.nh}, from ${best.nh}, BGP external`, `      Nexthop in Vrf: "default", Table: "default", IPv4 Unicast, Table Id: 0xe0000000`, "      Route metric is 0", `  Label: ${best.label}`, `  Tunnel ID: None`, `  Source RD attributes: 0x0000:${best.rd}`].join("\n");
  }
  const rows = [...rs].sort((a, b) => sortPfx(a.prefix, b.prefix)).flatMap((x) => {
    if (x.via === "connected") return [`C    ${x.prefix} is directly connected, ${spAge(s.clock, 30)}, ${xrIf(x.ifn!)}`, `L    ${CES[ceIfs(r).find((c) => c.ifn === x.ifn)!.ce].peIp}/32 is directly connected, ${spAge(s.clock, 30)}, ${xrIf(x.ifn!)}`];
    if (x.via === "static") return [`S    ${x.prefix} [1/0] via ${x.nh}, ${spAge(s.clock, 30)}`];
    return [`B    ${x.prefix} [200/0] via ${x.nh} (nexthop in vrf default), ${spAge(s.clock, 40)}`];
  });
  return ["Codes: C - connected, S - static, R - RIP, B - BGP, (>) - Diversion path", "       O - OSPF, IA - OSPF inter area, i - ISIS, L - local", "", "Gateway of last resort is not set", "", ...rows].join("\n");
}
function xrBgpHead(r: L3R) {
  return [`BGP router identifier ${L3_LO[r]}, local AS number ${AS}`, "BGP generic scan interval 60 secs", "Non-stop routing is enabled", "BGP table state: Active", "Table ID: 0x0   RD version: 0", "BGP main routing table version 25", "BGP NSR Initial initsync version 2 (Reached)", "BGP scan interval 60 secs", ""];
}
function xrVpnv4Table(s: L3State, r: L3R, onlyVrf?: string): string {
  if (!isPe(r)) return "% BGP instance 'default' not active";
  const v = s.view;
  const out = [...xrBgpHead(r), "Status codes: s suppressed, d damped, h history, * valid, > best", "              i - internal, r RIB-failure, S stale, N Nexthop-discard", "Origin codes: i - IGP, e - EGP, ? - incomplete", "   Network            Next Hop            Metric LocPrf Weight Path"];
  // Local VRFs: their own RD, local and imported routes.
  for (const [vrf, cfg] of Object.entries(s.cfg[r].vrfs)) {
    if (onlyVrf && vrf !== onlyVrf) continue;
    if (!cfg.rd) continue;
    const lines: string[] = [];
    for (const x of v.vpnv4.filter((y) => y.pe === r && y.vrf === vrf)) lines.push(`*> ${pad(x.prefix, 19)}${pad(routesOf(s, r, vrf).find((y) => y.prefix === x.prefix && y.via === "static")?.nh ?? "0.0.0.0", 20)}${lpad(0, 6)}${lpad("", 7)}${lpad(32768, 7)} ?`);
    for (const x of routesOf(s, r, vrf).filter((y) => y.via === "bgp" && !y.hidden)) lines.push(`*>i${pad(x.prefix, 19)}${pad(x.nh!, 20)}${lpad(0, 6)}${lpad(100, 7)}${lpad(0, 7)} ?`);
    if (lines.length) out.push(`Route Distinguisher: ${cfg.rd} (default for vrf ${vrf})`, ...lines);
  }
  if (!onlyVrf) for (const x of kept(s, r)) out.push(`Route Distinguisher: ${x.rd}`, `*>i${pad(x.prefix, 19)}${pad(x.nh, 20)}${lpad(0, 6)}${lpad(100, 7)}${lpad(0, 7)} ?`);
  out.push("", `Processed ${out.filter((l) => /^\*/.test(l)).length} prefixes, ${out.filter((l) => /^\*/.test(l)).length} paths`);
  return out.join("\n");
}
function xrVpnv4Rd(s: L3State, r: L3R, rd: string, prefix: string): string {
  if (!isPe(r)) return "% BGP instance 'default' not active";
  const v = s.view;
  const local = Object.entries(s.cfg[r].vrfs).find(([, c]) => c.rd === rd);
  const remote = kept(s, r).find((x) => x.rd === rd && x.prefix === prefix);
  const own = v.vpnv4.find((x) => x.pe === r && x.rd === rd && x.prefix === prefix);
  const imported = local ? routesOf(s, r, local[0]).find((x) => x.prefix === prefix && x.via === "bgp") : undefined;
  const head = [`BGP routing table entry for ${prefix}, Route Distinguisher: ${rd}`, "Versions:", "  Process           bRIB/RIB  SendTblVer", "  Speaker                  25          25", `Last Modified: ${spStamp(40).xr} for ${spAge(s.clock, 40)}`, "Paths: (1 available, best #1)"];
  if (own) return [...head, v.vpnv4Up ? `  Advertised to peers (in unique update groups):\n    ${L3_LO[otherPe(r)]}` : "  Not advertised to any peer", "  Path #1: Received by speaker 0", "  Local", `    ${routesOf(s, r, own.vrf).find((x) => x.prefix === prefix && x.via === "static")?.nh} from 0.0.0.0 (${L3_LO[r]})`, "      Origin incomplete, metric 0, localpref 100, weight 32768, valid, redistributed, best, group-best, import-candidate", `      Received Path ID 0, Local Path ID 1, version 25`, `      Extended community: RT:${own.rts.join(" RT:")}`, `      Local label: ${own.label}`].join("\n");
  const src = remote ?? (imported ? v.vpnv4.find((x) => x.pe === imported.from && x.prefix === prefix && x.rd === imported.rd) : undefined);
  if (!src) return "% Network not in table";
  return [...head, "  Not advertised to any peer", "  Path #1: Received by speaker 0", "  Local", `    ${src.nh} (metric 30) from ${src.nh} (${src.nh})`, `      Received Label ${src.label}`, `      Origin incomplete, metric 0, localpref 100, valid, internal, best, group-best, import-candidate${remote && Object.values(s.cfg[r].vrfs).some((c) => src.rts.some((rt) => c.imp.includes(rt))) ? ", imported" : ", not imported"}`, "      Received Path ID 0, Local Path ID 1, version 25", `      Extended community: RT:${src.rts.join(" RT:")}`, ...(imported && local ? [`      Source AFI: VPNv4 Unicast, Source VRF: default, Source Route Distinguisher: ${src.rd}`] : [])].join("\n");
}
function xrBgpSum(s: L3State, r: L3R, vpn: boolean): string {
  if (!isPe(r)) return "% BGP instance 'default' not active";
  const v = s.view;
  const n = s.cfg[r].nbr;
  if (!n) return [...xrBgpHead(r), "BGP is operating in STANDALONE mode."].join("\n");
  const show = vpn ? v.vpnv4Up && n.vpnv4 : v.bgpUp;
  const rcv = vpn ? kept(s, r).length : 0;
  const rows = vpn && !n.vpnv4 ? [] : [`${pad(n.ip, 16)}${lpad(0, 3)}${lpad(AS, 6)}${lpad(show ? 72 : 0, 8)}${lpad(show ? 75 : 0, 8)}${lpad(show ? 25 : 0, 9)}${lpad(0, 5)}${lpad(0, 5)} ${pad(show ? spAge(s.clock, 30) : "00:00:00", 9)}${show ? lpad(rcv, 10) : v.bgpUp ? "     NoNeg" : "Active"}`];
  return [...xrBgpHead(r), "BGP is operating in STANDALONE mode.", "", "", "Process       RcvTblVer   bRIB/RIB   LabelVer  ImportVer  SendTblVer  StandbyVer", "Speaker              25         25         25         25          25           0", "", "Neighbor        Spk    AS MsgRcvd MsgSent   TblVer  InQ OutQ  Up/Down  St/PfxRcd", ...rows].join("\n");
}
function xrBgpNbr(s: L3State, r: L3R, ip: string): string {
  const n = s.cfg[r].nbr;
  if (!isPe(r) || !n || n.ip !== ip) return "% No such neighbor";
  const v = s.view;
  return [`BGP neighbor is ${ip}`, ` Remote AS ${AS}, local AS ${AS}, internal link`, ` Remote router ID ${v.bgpUp ? ip : "0.0.0.0"}`, `  BGP state = ${v.bgpUp ? `Established, up for ${spAge(s.clock, 30)}` : "Active"}`, "  Update source: Loopback0", ...(v.bgpUp ? ["  Neighbor capabilities:", "    Route refresh: advertised and received", "    4-byte AS: advertised and received", `    Address family IPv4 Unicast: advertised and received`, `    Address family VPNv4 Unicast: ${n.vpnv4 && s.cfg[otherPe(r)].nbr?.vpnv4 ? "advertised and received" : n.vpnv4 ? "advertised" : s.cfg[otherPe(r)].nbr?.vpnv4 ? "received" : "not advertised"}`] : []), ...(n.vpnv4 ? [" For Address Family: VPNv4 Unicast", `  ${kept(s, r).length} accepted prefixes`, `  Prefix advertised ${v.vpnv4Up ? v.vpnv4.filter((x) => x.pe === r).length : 0}, suppressed 0, withdrawn 0`] : [])].join("\n");
}
function xrCef(s: L3State, r: L3R, vrf: string, ip: string): string {
  if (!s.cfg[r].vrfs[vrf]) return `% VRF ${vrf} not found`;
  const best = routesOf(s, r, vrf).filter((x) => inPrefix(ip, x.prefix) && !x.hidden).sort((a, b) => Number(b.prefix.split("/")[1]) - Number(a.prefix.split("/")[1]))[0];
  if (!best) return `0.0.0.0/0, version 0, proxy default, drop, discard`;
  const head = `${best.prefix}, version 25, internal 0x5000001 0x0 (ptr 0x8a3d1c28) [1], 0x0 (0x0), 0x208 (0x8b0a4f30)\n Updated ${spStamp(40).xr.replace(" UTC", "")}\n Prefix Len ${best.prefix.split("/")[1]}, traffic index 0, precedence n/a, priority 3`;
  if (best.via !== "bgp" || best.from === r) return `${head}\n   via ${best.nh ?? "connected"}/32, ${xrIf(best.ifn ?? "ge-0/0/1", true)}, 3 dependencies, weight 0, class 0 [flags 0x0]\n    path-idx 0 NHID 0x0 [0x8a1c5e10 0x0]\n    next hop ${best.nh ?? "attached"}/32`;
  const t = s.view.lsp[r][best.nh!];
  const nh = coreNh(r);
  return `${head}\n   via ${best.nh}/32, 3 dependencies, recursive [flags 0x6000]\n    path-idx 0 NHID 0x0 [0x8a1c6e20 0x0]\n    recursion-via-/32\n    next hop VRF - 'default', table - 0xe0000000\n    next hop ${nh.ip}/32 ${xrIf(nh.ifn, true)} labels imposed {${t?.out === undefined ? "None" : t.out === IMPLICIT_NULL ? "ImplNull" : t.out} ${best.label}}`;
}
function xrArp(s: L3State, r: L3R, vrf: string): string {
  const rows = ceIfs(r).filter((x) => s.cfg[r].ifs[x.ifn]?.vrf === vrf && !s.cfg[r].ifs[x.ifn]?.shut).flatMap((x) => {
    const st = routesOf(s, r, vrf).filter((y) => y.via === "static" && y.ifn === x.ifn && y.nh !== x.ceIp).map((y) => `${pad(y.nh!, 16)}${pad("-", 10)}${pad("0000.0000.0000", 16)}${pad("Incomplete", 11)}${pad("ARPA", 7)}${xrIf(x.ifn)}`);
    return [`${pad(x.peIp, 16)}${pad("-", 10)}${pad("0210.4c00.0" + (L3_ROUTERS.indexOf(r) + 1) + "0" + x.ifn.slice(-1), 16)}${pad("Interface", 11)}${pad("ARPA", 7)}${xrIf(x.ifn)}`, `${pad(x.ceIp, 16)}${pad("00:01:12", 10)}${pad("5254.00" + x.ce.toLowerCase().replace("ce", "") .padStart(2, "0").slice(-2) + ".1a2b", 16)}${pad("Dynamic", 11)}${pad("ARPA", 7)}${xrIf(x.ifn)}`, ...st];
  });
  return ["-------------------------------------------------------------------------------", "0/0/CPU0", "-------------------------------------------------------------------------------", "Address         Age        Hardware Addr   State      Type  Interface", ...rows].join("\n");
}
function xrForwarding(s: L3State, r: L3R): string {
  const rows: string[] = [];
  for (const fec of [L3_LO.PE1, L3_LO.PE2]) {
    if (L3_LO[r] === fec) continue;
    const t = s.view.lsp[r][fec];
    if (!t?.nh) continue;
    const l = L3_LINKS.find((x) => (x.a === r && x.b === t.nh) || (x.b === r && x.a === t.nh))!;
    const nhIp = l.a === r ? l.bip : l.aip;
    const ifn = l.a === r ? l.ai : l.bi;
    rows.push(`${pad(ldpLabel(s.os, r, fec), 7)}${pad(lab(t.out), 12)}${pad(`${fec}/32`, 19)}${pad(xrIf(ifn, true), 13)}${pad(nhIp, 16)}0`);
  }
  for (const x of s.view.vpnv4.filter((y) => y.pe === r)) {
    const ce = ceIfs(r).find((c) => c.vrf === x.vrf);
    const st = routesOf(s, r, x.vrf).find((y) => y.prefix === x.prefix && y.via === "static");
    if (s.cfg[r].vrfs[x.vrf]?.perVrfLabel) {
      if (!rows.some((y) => y.startsWith(String(x.label)))) rows.push(`${pad(x.label, 7)}${pad("Aggregate", 12)}${pad(`${x.vrf}: Per-VRF Aggr[V]`, 19)}${pad(x.vrf, 13)}${pad("", 16)}0`);
    } else rows.push(`${pad(x.label, 7)}${pad("Unlabelled", 12)}${pad(`${x.prefix}[V]`, 19)}${pad(ce ? xrIf(ce.ifn, true) : "-", 13)}${pad(st?.nh ?? "-", 16)}0`);
  }
  return ["Local  Outgoing    Prefix             Outgoing     Next Hop        Bytes", "Label  Label       or ID              Interface                    Switched", "------ ----------- ------------------ ------------ --------------- ------------", ...rows].join("\n");
}
function xrLdpBrief(s: L3State, r: L3R): string {
  const rows = coreIfs(r).filter((x) => s.view.ldp[x.link.id]).map((x) => `${pad(`${L3_LO[x.peer]}:0`, 18)}${pad("Y", 4)}${pad(spAge(s.clock, 20), 10)}${lpad(1, 6)}${lpad(4, 9)}${lpad(1, 7)}${lpad(4, 6)}`);
  return ["Peer              GR  Up Time         Discovery   Addresses     Labels", "                                      ipv4  ipv6  ipv4  ipv6  ipv4   ipv6", "----------------- --  --------------- ----- ----  ----- ----  ------ ----", ...rows.map((x) => x)].join("\n");
}
function xrRouteGlobal(s: L3State, r: L3R): string {
  const me = L3_ROUTERS.indexOf(r);
  const rows = L3_ROUTERS.map((n, k) => {
    if (n === r) return `L    ${pad(`${L3_LO[n]}/32`, 18)} is directly connected, ${spAge(s.clock, 30)}, Loopback0`;
    const nb = L3_ROUTERS[k > me ? me + 1 : me - 1];
    const x = coreIfs(r).find((y) => y.peer === nb)!;
    const l = x.link;
    return `i L2 ${pad(`${L3_LO[n]}/32`, 18)} [115/${10 * Math.abs(k - me) + 10}] via ${l.a === r ? l.bip : l.aip}, ${spAge(s.clock, 30)}, ${xrIf(x.ifn)}`;
  });
  return ["Codes: C - connected, S - static, B - BGP, i - ISIS, L1 - IS-IS level-1, L2 - IS-IS level-2", "       L - local", "", "Gateway of last resort is not set", "", ...rows].join("\n");
}
function xrLogging(s: L3State, r: L3R): string {
  const lines = s.sys.filter((x) => x.dev === r).slice(-30).map((x) => {
    const st = `RP/0/RP0/CPU0:${spStamp(x.t).xr}`;
    if (x.kind === "bgp-up") return `${st}: bgp[1052]: %ROUTING-BGP-5-ADJCHANGE : neighbor ${x.peer} Up (VRF: default) (AS: ${AS})`;
    if (x.kind === "bgp-down") return `${st}: bgp[1052]: %ROUTING-BGP-5-ADJCHANGE : neighbor ${x.peer} Down - Peer closing down the session (VRF: default) (AS: ${AS})`;
    if (x.kind === "ldp-up") return `${st}: mpls_ldp[1159]: %ROUTING-LDP-5-NBR_CHANGE : VRF 'default' (0x60000000), Neighbor ${x.peer}:0 is UP`;
    if (x.kind === "ldp-down") return `${st}: mpls_ldp[1159]: %ROUTING-LDP-5-NBR_CHANGE : VRF 'default' (0x60000000), Neighbor ${x.peer}:0 is DOWN (Interface state down)`;
    return `${st}: config[65857]: %MGBL-CONFIG-6-DB_COMMIT : Configuration committed by user 'admin'. Use 'show commit changes ${1000000000 + x.t}' to view the changes.`;
  });
  return ["Syslog logging: enabled (0 messages dropped, 0 flushes, 0 overruns)", `    Buffer logging: level debugging, ${lines.length} messages logged`, "", "Log Buffer (2097152 bytes):", "", ...lines].join("\n");
}

// ---------------------------------------------------------------------------------------------------------------
// Junos outputs
// ---------------------------------------------------------------------------------------------------------------
function jnPush(s: L3State, r: L3R, x: L3Route) {
  const t = s.view.lsp[r][x.nh!];
  const nh = coreNh(r);
  return `>  to ${nh.ip} via ${jnIf(nh.ifn)}, Push ${x.label}${t?.out !== undefined && t.out !== IMPLICIT_NULL ? `, Push ${t.out}(top)` : ""}`;
}
function jnVrfTable(s: L3State, r: L3R, vrf: string, ip?: string, hiddenOnly = false): string {
  if (!s.cfg[r].vrfs[vrf]) return "";
  let rs = routesOf(s, r, vrf);
  if (ip) rs = rs.filter((x) => inPrefix(ip, x.prefix)).sort((a, b) => Number(b.prefix.split("/")[1]) - Number(a.prefix.split("/")[1])).slice(0, 1);
  const hidden = rs.filter((x) => x.hidden).length;
  const act = rs.filter((x) => !x.hidden);
  const lines = [...(hiddenOnly ? rs.filter((x) => x.hidden) : act)].sort((a, b) => sortPfx(a.prefix, b.prefix)).flatMap((x) => {
    if (x.via === "connected") {
      const ce = ceIfs(r).find((c) => c.ifn === x.ifn)!;
      return [`${pad(x.prefix, 19)}*[Direct/0] ${spAge(s.clock, 30)}`, `                    >  via ${jnIf(x.ifn!)}`, `${pad(`${ce.peIp}/32`, 19)}*[Local/0] ${spAge(s.clock, 30)}`, `                       Local via ${jnIf(x.ifn!)}`];
    }
    if (x.via === "static") return [`${pad(x.prefix, 19)}*[Static/5] ${spAge(s.clock, 30)}`, `                    >  to ${x.nh} via ${jnIf(x.ifn!)}`];
    if (x.from === r) return [`${pad(x.prefix, 19)}*[Static/5] ${spAge(s.clock, 30)}`, `                    >  to ${CES[ceIfs(r).find((c) => c.vrf === x.srcVrf)!.ce].ceIp} via ${jnIf(ceIfs(r).find((c) => c.vrf === x.srcVrf)!.ifn)}`];
    return [`${pad(x.prefix, 19)}${x.hidden ? " " : "*"}[BGP/170] ${spAge(s.clock, 40)}, localpref 100, from ${x.nh}`, `                      AS path: I, validation-state: unverified`, x.hidden ? "                       Unusable" : `                    ${jnPush(s, r, x)}`];
  });
  return [`${vrf}.inet.0: ${act.length + 1 + hidden} destinations, ${act.length + 1 + hidden} routes (${act.length + 1} active, 0 holddown, ${hidden} hidden)`, "+ = Active Route, - = Last Active, * = Both", "", ...lines].join("\n");
}
function jnL3vpnTable(s: L3State, r: L3R, detail: boolean, hiddenOnly = false): string {
  if (!isPe(r)) return "";
  const rx = kept(s, r);
  const isHidden = (x: (typeof rx)[number]) => s.view.lsp[r][x.nh]?.out === undefined;
  const nHidden = rx.filter(isHidden).length;
  const lines = rx.filter((x) => isHidden(x) === hiddenOnly).flatMap((x) => {
    const used = Object.values(s.cfg[r].vrfs).some((c) => x.rts.some((rt) => vrfImports(s.cfg[r], c).includes(rt)));
    const hiddenLsp = s.view.lsp[r][x.nh]?.out === undefined;
    const route: L3Route = { vrf: "", prefix: x.prefix, via: "bgp", nh: x.nh, label: x.label };
    if (!detail) return [`${x.rd}:${x.prefix}`, `                   ${hiddenLsp ? " " : "*"}[BGP/170] ${spAge(s.clock, 40)}, localpref 100, from ${x.nh}`, "                      AS path: I, validation-state: unverified", hiddenLsp ? "                       Unusable" : `                    ${jnPush(s, r, route)}`];
    return [`${x.rd}:${x.prefix} (1 entry, 0 announced)`, `        ${hiddenLsp ? " " : "*"}BGP    Preference: 170/-101`, `                Route Distinguisher: ${x.rd}`, `                Next hop type: Indirect`, `                Source: ${x.nh}`, `                Protocol next hop: ${x.nh}`, `                Label operation: Push ${x.label}`, `                State: <${hiddenLsp ? "Hidden " : "Active "}Int Ext>`, `                Local AS: ${AS} Peer AS: ${AS}`, `                Age: ${spAge(s.clock, 40)}`, `                Communities: ${x.rts.map((rt) => `target:${rt}`).join(" ")}`, `                Import Accepted`, `                VPN Label: ${x.label}`, `                Localpref: 100`, `                Router ID: ${x.nh}`, `                Secondary Tables: ${used ? Object.entries(s.cfg[r].vrfs).filter(([, c]) => x.rts.some((rt) => vrfImports(s.cfg[r], c).includes(rt))).map(([n]) => `${n}.inet.0`).join(" ") : "(none — no VRF imports its route target)"}`];
  });
  return [`bgp.l3vpn.0: ${rx.length} destinations, ${rx.length} routes (${rx.length - nHidden} active, 0 holddown, ${nHidden} hidden)`, "+ = Active Route, - = Last Active, * = Both", "", ...lines].join("\n");
}
function jnInet3(s: L3State, r: L3R): string {
  const rows = [L3_LO.PE1, L3_LO.PE2].filter((fec) => fec !== L3_LO[r]).flatMap((fec) => {
    const t = s.view.lsp[r][fec];
    if (t?.out === undefined || !t.nh) return [];
    const nh = coreIfs(r).find((x) => x.peer === t.nh)!;
    const peerIp = nh.link.a === r ? nh.link.bip : nh.link.aip;
    return [[`${pad(`${fec}/32`, 19)}*[LDP/9] ${spAge(s.clock, 20)}, metric 1`, `                    >  to ${peerIp} via ${jnIf(nh.ifn)}${t.out === IMPLICIT_NULL ? "" : `, Push ${t.out}`}`]];
  });
  const n = rows.length;
  return [`inet.3: ${n} destinations, ${n} routes (${n} active, 0 holddown, 0 hidden)`, ...(n ? ["+ = Active Route, - = Last Active, * = Both", "", ...rows.flat()] : [])].join("\n");
}
function jnBgpSum(s: L3State, r: L3R): string {
  if (!isPe(r)) return "BGP is not running";
  const v = s.view;
  const n = s.cfg[r].nbr;
  const rx = kept(s, r).length;
  return ["Threading mode: BGP I/O", `Groups: 1 Peers: ${n ? 1 : 0} Down peers: ${v.bgpUp ? 0 : 1}`, "Table          Tot Paths  Act Paths Suppressed    History Damp State    Pending", "bgp.l3vpn.0", `${lpad(rx, 23)}${lpad(rx, 11)}${lpad(0, 11)}${lpad(0, 11)}${lpad(0, 11)}${lpad(0, 11)}`, "Peer                     AS      InPkt     OutPkt    OutQ   Flaps Last Up/Dwn State|#Active/Received/Accepted/Damped...", ...(n ? [`${pad(n.ip, 21)}${lpad(AS, 6)}${lpad(v.bgpUp ? 72 : 0, 11)}${lpad(v.bgpUp ? 75 : 0, 11)}${lpad(0, 8)}${lpad(0, 8)} ${lpad(v.bgpUp ? spAge(s.clock, 30).replace(/^00:/, "") : "1:00", 11)} ${v.bgpUp ? "Establ" : "Active"}`, ...(v.bgpUp ? (n.vpnv4 && s.cfg[otherPe(r)].nbr?.vpnv4 ? [`  bgp.l3vpn.0: ${rx}/${rx}/${rx}/0`, ...Object.keys(s.cfg[r].vrfs).map((vrf) => `  ${vrf}.inet.0: ${routesOf(s, r, vrf).filter((x) => x.via === "bgp" && x.from !== r).length}/${routesOf(s, r, vrf).filter((x) => x.via === "bgp" && x.from !== r).length}/${routesOf(s, r, vrf).filter((x) => x.via === "bgp" && x.from !== r).length}/0`)] : ["  inet.0: 0/0/0/0"]) : [])] : [])].join("\n");
}
function jnBgpNbr(s: L3State, r: L3R, ip: string): string {
  const n = s.cfg[r].nbr;
  if (!isPe(r) || !n || n.ip !== ip) return "";
  const v = s.view;
  const mine = n.vpnv4 ? "inet-vpn-unicast" : "inet-unicast";
  const peer = s.cfg[otherPe(r)].nbr?.vpnv4 ? "inet-vpn-unicast" : "inet-unicast";
  return [`Peer: ${ip}+179 AS ${AS} Local: ${L3_LO[r]}+${50000 + L3_ROUTERS.indexOf(r)} AS ${AS}`, "  Group: IBGP                 Routing-Instance: master", `  Type: Internal    State: ${v.bgpUp ? "Established" : "Active"}    Flags: <${v.bgpUp ? "Sync" : "ImportEval"}>`, `  Local Address: ${L3_LO[r]} Holdtime: 90 Preference: 170`, `  NLRI for restart configured on peer: ${mine}`, `  NLRI advertised by peer: ${peer}`, `  NLRI for this session: ${mine === peer ? mine : "inet-unicast"}`, `  Peer ID: ${ip}    Local ID: ${L3_LO[r]}    Active Holdtime: 90`].join("\n");
}
function jnLdp(s: L3State, r: L3R): string {
  const rows = coreIfs(r).filter((x) => s.view.ldp[x.link.id]).map((x) => `${pad(L3_LO[x.peer], 21)}${pad("Operational", 14)}${pad("Open", 13)}${lpad(28, 5)}         DU`);
  return ["  Address              State        Connection  Hold time  Adv. Mode", ...rows].join("\n");
}
function jnArp(s: L3State, r: L3R): string {
  const rows = ceIfs(r).filter((x) => !s.cfg[r].ifs[x.ifn]?.shut).map((x) => `${pad("52:54:00:" + String(L3_CES.indexOf(x.ce) + 10).padStart(2, "0") + ":1a:2b", 18)}${pad(x.ceIp, 16)}${pad(x.ceIp, 16)}${pad(jnIf(x.ifn), 15)}none`);
  return ["MAC Address       Address         Name                      Interface               Flags", ...rows, `Total entries: ${rows.length}`].join("\n");
}
function jnLog(s: L3State, r: L3R): string {
  return s.sys.filter((x) => x.dev === r).slice(-30).map((x) => {
    const st = `${spStamp(x.t).junos}  ${r}`;
    if (x.kind === "bgp-up") return `${st} rpd[1532]: BGP_PEER_STATE_CHANGE: BGP peer ${x.peer} (Internal AS ${AS}) changed state from OpenConfirm to Established (event RecvKeepAlive)`;
    if (x.kind === "bgp-down") return `${st} rpd[1532]: BGP_PEER_STATE_CHANGE: BGP peer ${x.peer} (Internal AS ${AS}) changed state from Established to Idle (event RecvNotify)`;
    if (x.kind === "ldp-up") return `${st} rpd[1532]: RPD_LDP_NBRUP: LDP neighbor ${x.peer} (${x.peer}) is up`;
    if (x.kind === "ldp-down") return `${st} rpd[1532]: RPD_LDP_NBRDOWN: LDP neighbor ${x.peer} (${x.peer}) is down`;
    return `${st} mgd[4417]: UI_COMMIT: User 'admin' requested 'commit' operation (comment: none)`;
  }).join("\n");
}

// ---------------------------------------------------------------------------------------------------------------
// Configuration as each OS prints it
// ---------------------------------------------------------------------------------------------------------------
export function l3XrLines(r: L3R, c: L3Cfg): string[] {
  const out: string[] = [`hostname ${r}`, "!"];
  for (const [n, v] of Object.entries(c.vrfs)) out.push(`vrf ${n}`, " address-family ipv4 unicast", ...(v.imp.length ? ["  import route-target", ...v.imp.map((rt) => `   ${rt}`), "  !"] : []), ...(v.exp.length ? ["  export route-target", ...v.exp.map((rt) => `   ${rt}`), "  !"] : []), " !", "!");
  out.push("interface Loopback0", ` ipv4 address ${L3_LO[r]} 255.255.255.255`, "!");
  for (const x of coreIfs(r)) out.push(`interface ${xrIf(x.ifn)}`, ` description to ${x.peer}`, ` ipv4 address ${x.ip} 255.255.255.254`, ...(c.ifs[x.ifn]?.shut ? [" shutdown"] : []), "!");
  for (const x of ceIfs(r)) out.push(`interface ${xrIf(x.ifn)}`, ` description to ${x.ce}`, ...(c.ifs[x.ifn]?.vrf ? [` vrf ${c.ifs[x.ifn]!.vrf}`] : []), ` ipv4 address ${x.peIp} 255.255.255.248`, ...(c.ifs[x.ifn]?.shut ? [" shutdown"] : []), "!");
  const statics = Object.entries(c.vrfs).filter(([, v]) => v.statics.length);
  if (statics.length) out.push("router static", ...statics.flatMap(([n, v]) => [` vrf ${n}`, "  address-family ipv4 unicast", ...v.statics.map((st) => `   ${st.prefix} ${st.nh}`), "  !", " !"]), "!");
  out.push("router isis CORE", ` net 49.0001.0000.0000.000${L3_ROUTERS.indexOf(r) + 1}.00`, " address-family ipv4 unicast", "  metric-style wide", " !", "!");
  if (isPe(r)) {
    out.push(`router bgp ${AS}`, ` bgp router-id ${L3_LO[r]}`, " address-family vpnv4 unicast", " !");
    if (c.nbr) out.push(` neighbor ${c.nbr.ip}`, `  remote-as ${AS}`, "  update-source Loopback0", ...(c.nbr.vpnv4 ? ["  address-family vpnv4 unicast", "  !"] : []), " !");
    for (const [n, v] of Object.entries(c.vrfs)) out.push(` vrf ${n}`, ...(v.rd ? [`  rd ${v.rd}`] : []), "  address-family ipv4 unicast", ...(v.perVrfLabel ? ["   label mode per-vrf"] : []), ...(v.redist ? ["   redistribute static"] : []), "  !", " !");
    out.push("!");
  }
  out.push("mpls ldp", ...coreIfs(r).filter((x) => c.ifs[x.ifn]?.ldp).flatMap((x) => [` interface ${xrIf(x.ifn)}`, " !"]), "!");
  return out;
}
export function l3JnStmts(r: L3R, c: L3Cfg): JStmt[] {
  const out: JStmt[] = [];
  for (const x of coreIfs(r)) {
    if (c.ifs[x.ifn]?.shut) out.push({ path: ["interfaces", x.ifn], leaf: "disable" });
    out.push({ path: ["interfaces", x.ifn, "unit 0", "family inet"], leaf: `address ${x.ip}/31` }, { path: ["interfaces", x.ifn, "unit 0", "family mpls"], leaf: "" });
  }
  for (const x of ceIfs(r)) {
    if (c.ifs[x.ifn]?.shut) out.push({ path: ["interfaces", x.ifn], leaf: "disable" });
    out.push({ path: ["interfaces", x.ifn, "unit 0", "family inet"], leaf: `address ${x.peIp}/29` });
  }
  out.push({ path: ["interfaces", "lo0", "unit 0", "family inet"], leaf: `address ${L3_LO[r]}/32` }, { path: ["routing-options"], leaf: `router-id ${L3_LO[r]}` }, { path: ["routing-options"], leaf: `autonomous-system ${AS}` });
  if (isPe(r) && c.nbr) {
    const g = ["protocols", "bgp", "group IBGP"];
    out.push({ path: g, leaf: "type internal" }, { path: g, leaf: `local-address ${L3_LO[r]}` });
    if (c.nbr.vpnv4) out.push({ path: [...g, "neighbor " + c.nbr.ip, "family inet-vpn"], leaf: "unicast" });
    else out.push({ path: g, leaf: `neighbor ${c.nbr.ip}` });
  }
  for (const x of coreIfs(r).filter((y) => c.ifs[y.ifn]?.ldp)) out.push({ path: ["protocols", "ldp", `interface ${jnIf(x.ifn)}`], leaf: "" });
  for (const x of coreIfs(r)) out.push({ path: ["protocols", "mpls", `interface ${jnIf(x.ifn)}`], leaf: "" });
  for (const [pn, terms] of Object.entries(c.jpol?.pols ?? {})) {
    for (const [tn, t] of Object.entries(terms)) {
      const tp = ["policy-options", `policy-statement ${pn}`, `term ${tn}`];
      if (t.from.length) out.push({ path: tp, leaf: t.from.length === 1 ? `from community ${t.from[0]}` : `from community [ ${t.from.join(" ")} ]` });
      if (t.accept) out.push({ path: tp, leaf: "then accept" });
      if (!t.from.length && !t.accept) out.push({ path: tp, leaf: "" });
    }
  }
  for (const [cn, rt] of Object.entries(c.jpol?.comms ?? {})) out.push({ path: ["policy-options"], leaf: `community ${cn} members target:${rt}` });
  for (const [n, v] of Object.entries(c.vrfs)) {
    const p = ["routing-instances", n];
    out.push({ path: p, leaf: "instance-type vrf" });
    for (const x of ceIfs(r).filter((y) => c.ifs[y.ifn]?.vrf === n)) out.push({ path: p, leaf: `interface ${jnIf(x.ifn)}` });
    if (v.rd) out.push({ path: p, leaf: `route-distinguisher ${v.rd}` });
    if (v.vrfImport) out.push({ path: p, leaf: `vrf-import ${v.vrfImport}` });
    const same = v.imp.length === 1 && v.exp.length === 1 && v.imp[0] === v.exp[0];
    if (same) out.push({ path: p, leaf: `vrf-target target:${v.imp[0]}` });
    else {
      for (const rt of v.imp) out.push({ path: [...p, "vrf-target"], leaf: `import target:${rt}` });
      for (const rt of v.exp) out.push({ path: [...p, "vrf-target"], leaf: `export target:${rt}` });
    }
    if (v.perVrfLabel) out.push({ path: p, leaf: "vrf-table-label" });
    if (v.autoExport) out.push({ path: [...p, "routing-options"], leaf: "auto-export" });
    for (const st of v.statics) out.push({ path: [...p, "routing-options", "static"], leaf: `route ${st.prefix} next-hop ${st.nh}` });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Configuration statements
// ---------------------------------------------------------------------------------------------------------------
const newVrf = () => ({ imp: [] as string[], exp: [] as string[], statics: [] as { prefix: string; nh: string }[], redist: false, perVrfLabel: false });
function stmts(r: L3R, s: L3State): SpCfgStmt<L3Cfg>[] {
  const vX = vrfArg(s, r);
  const pifX = pifArg(r, false);
  const pifJ = pifArg(r, true);
  const pe = isPe(r);
  const peOnly = (c: L3Cfg) => (pe ? c : "% VRFs and BGP live on the PEs; this P router only switches labels (a BGP-free core).");
  const vr = (c: L3Cfg, n: string) => (c.vrfs[n] ??= newVrf());
  const ceOf = (ifn: string) => ceIfs(r).find((x) => x.ifn === ifn);
  const grpArg: CliArgSpec = { choices: ["IBGP"], describe: () => "The iBGP group", resolve: (raw) => (raw === "IBGP" ? raw : undefined) };
  return [
    // ---------------------------------------------------------------- IOS XR
    { id: "vrf", summary: "Configure a VRF", args: { v: vX }, xr: { mode: "config", syntax: "vrf <v>", enter: "vrf", apply: (c, a) => (pe ? (vr(c, a.v), c) : peOnly(c)), no: (c, a) => (delete c.vrfs[a.v], Object.values(c.ifs).forEach((i) => i && i.vrf === a.v && (i.vrf = undefined)), c) } },
    { id: "vrf-af", summary: "IPv4 unicast for the VRF", xr: { mode: "vrf", syntax: "address-family ipv4 unicast", enter: "vrf-af", apply: (c) => c } },
    { id: "imp", summary: "Route targets to import", xr: { mode: "vrf-af", syntax: "import route-target", enter: "rt-imp", apply: (c) => c, no: (c, _a, x) => ((vr(c, x.v).imp = []), c) } },
    { id: "exp", summary: "Route targets to export", xr: { mode: "vrf-af", syntax: "export route-target", enter: "rt-exp", apply: (c) => c, no: (c, _a, x) => ((vr(c, x.v).exp = []), c) } },
    { id: "imp-rt", summary: "A route target to import", args: { rt: rtArg }, xr: { mode: "rt-imp", syntax: "<rt>", apply: (c, a, x) => ((vr(c, x.v).imp = [...new Set([...vr(c, x.v).imp, a.rt])]), c), no: (c, a, x) => ((vr(c, x.v).imp = vr(c, x.v).imp.filter((y) => y !== a.rt)), c) } },
    { id: "exp-rt", summary: "A route target to export", args: { rt: rtArg }, xr: { mode: "rt-exp", syntax: "<rt>", apply: (c, a, x) => ((vr(c, x.v).exp = [...new Set([...vr(c, x.v).exp, a.rt])]), c), no: (c, a, x) => ((vr(c, x.v).exp = vr(c, x.v).exp.filter((y) => y !== a.rt)), c) } },
    { id: "if", summary: "Configure an interface", args: { pif: pifX }, xr: { mode: "config", syntax: "interface <pif>", enter: "if", apply: (c) => c } },
    { id: "if-vrf", summary: "Put the interface in a VRF", args: { v: vX }, xr: { mode: "if", syntax: "vrf <v>", noSyntax: "vrf", apply: (c, a, x) => (ceOf(x.pif) ? ((c.ifs[x.pif as IfName]!.vrf = a.v), c) : "!!% This interface faces the core: it stays in the global table."), no: (c, _a, x) => ((c.ifs[x.pif as IfName]!.vrf = undefined), c) } },
    { id: "if-ip", summary: "The interface address", args: { ip: choiceArg([...ceIfs(r).map((x) => x.peIp), ...coreIfs(r).map((x) => x.ip)], () => "Address"), mask: choiceArg(["255.255.255.248", "255.255.255.254"], () => "Mask") }, xr: { mode: "if", syntax: "ipv4 address <ip> <mask>", apply: (c) => c } },
    { id: "if-shut", summary: "Shut the interface down", xr: { mode: "if", syntax: "shutdown", apply: (c, _a, x) => ((c.ifs[x.pif as IfName]!.shut = true), c), no: (c, _a, x) => ((c.ifs[x.pif as IfName]!.shut = false), c) } },
    { id: "rs", summary: "Static routes", xr: { mode: "config", syntax: "router static", enter: "rs", apply: (c) => peOnly(c) } },
    { id: "rs-vrf", summary: "Static routes in a VRF", args: { v: vX }, xr: { mode: "rs", syntax: "vrf <v>", enter: "rs-vrf", apply: (c, a) => (vr(c, a.v), c) } },
    { id: "rs-af", summary: "IPv4 unicast", xr: { mode: "rs-vrf", syntax: "address-family ipv4 unicast", enter: "rs-af", apply: (c) => c } },
    { id: "rs-route", summary: "A static route", args: { p: pfxArg, nh: nhArg }, xr: { mode: "rs-af", syntax: "<p> <nh>", apply: (c, a, x) => ((vr(c, x.v).statics = [...vr(c, x.v).statics.filter((y) => y.prefix !== a.p), { prefix: a.p, nh: a.nh }]), c), no: (c, a, x) => ((vr(c, x.v).statics = vr(c, x.v).statics.filter((y) => y.prefix !== a.p)), c) } },
    { id: "bgp", summary: "BGP", args: { as: choiceArg([String(AS)], () => "This network's AS") }, xr: { mode: "config", syntax: "router bgp <as>", enter: "bgp", apply: (c) => peOnly(c) } },
    { id: "bgp-af", summary: "Enable the VPNv4 family on this router", xr: { mode: "bgp", syntax: "address-family vpnv4 unicast", enter: "bgp-af", apply: (c) => c } },
    { id: "nbr", summary: "The iBGP neighbor (the other PE)", args: { ip: nbrArg(r) }, xr: { mode: "bgp", syntax: "neighbor <ip>", enter: "bgp-nbr", apply: (c, a) => ((c.nbr ??= { ip: a.ip, vpnv4: false }), (c.nbr.ip = a.ip), c), no: (c) => ((c.nbr = undefined), c) } },
    { id: "nbr-ras", summary: "Neighbor AS", args: { as: choiceArg([String(AS)], () => "AS number") }, xr: { mode: "bgp-nbr", syntax: "remote-as <as>", apply: (c) => c } },
    { id: "nbr-upd", summary: "Source of the session", args: { lo: choiceArg(["Loopback0"], () => "Loopback interface") }, xr: { mode: "bgp-nbr", syntax: "update-source <lo>", apply: (c) => c } },
    { id: "nbr-vpn", summary: "Exchange VPNv4 routes with this neighbor", xr: { mode: "bgp-nbr", syntax: "address-family vpnv4 unicast", enter: "bgp-nbr-af", apply: (c) => ((c.nbr!.vpnv4 = true), c), no: (c) => ((c.nbr!.vpnv4 = false), c) } },
    { id: "bv", summary: "BGP for a VRF", args: { v: vX }, xr: { mode: "bgp", syntax: "vrf <v>", enter: "bgp-vrf", apply: (c, a) => (vr(c, a.v), c) } },
    { id: "bv-rd", summary: "Route distinguisher", args: { rd: rdArg }, xr: { mode: "bgp-vrf", syntax: "rd <rd>", noSyntax: "rd", apply: (c, a, x) => ((vr(c, x.v).rd = a.rd), c), no: (c, _a, x) => ((vr(c, x.v).rd = undefined), c) } },
    { id: "bv-af", summary: "IPv4 unicast in the VRF", xr: { mode: "bgp-vrf", syntax: "address-family ipv4 unicast", enter: "bgp-vrf-af", apply: (c) => c } },
    { id: "bv-red", summary: "Advertise the VRF's static routes", xr: { mode: "bgp-vrf-af", syntax: "redistribute static", apply: (c, _a, x) => ((vr(c, x.v).redist = true), c), no: (c, _a, x) => ((vr(c, x.v).redist = false), c) } },
    { id: "bv-lbl", summary: "One VPN label for the whole VRF", xr: { mode: "bgp-vrf-af", syntax: "label mode per-vrf", apply: (c, _a, x) => ((vr(c, x.v).perVrfLabel = true), c), no: (c, _a, x) => ((vr(c, x.v).perVrfLabel = false), c) } },
    { id: "ldp", summary: "MPLS LDP", xr: { mode: "config", syntax: "mpls ldp", enter: "ldp", apply: (c) => c } },
    { id: "ldp-if", summary: "Run LDP on the interface", args: { pif: pifX }, xr: { mode: "ldp", syntax: "interface <pif>", enter: "ldp-if", apply: (c, a) => (coreIfs(r).some((x) => x.ifn === a.pif) ? ((c.ifs[a.pif as IfName]!.ldp = true), c) : "!!% LDP runs on the core interfaces only."), no: (c, a) => ((c.ifs[a.pif as IfName]!.ldp = false), c) } },

    // ---------------------------------------------------------------- Junos
    { id: "j-vrf", summary: "A VRF routing instance (delete removes it)", args: { v: vX }, junos: { syntax: "routing-instances <v>", del: (c, a) => (delete c.vrfs[a.v], Object.values(c.ifs).forEach((i) => i && i.vrf === a.v && (i.vrf = undefined)), c) } },
    { id: "j-type", summary: "The instance type", args: { v: vX, t: choiceArg(["vrf"], () => "Layer 3 VPN routing instance") }, junos: { syntax: "routing-instances <v> instance-type <t>", set: (c, a) => (pe ? (vr(c, a.v), c) : `error: ${String(peOnly(c)).slice(2)}`), del: (c) => c } },
    { id: "j-if", summary: "An interface of the VRF", args: { v: vX, pif: pifJ }, junos: { syntax: "routing-instances <v> interface <pif>", set: (c, a) => (ceOf(a.pif) ? (vr(c, a.v), (c.ifs[a.pif as IfName]!.vrf = a.v), c) : "error: this interface faces the core and stays in the master instance"), del: (c, a) => (c.ifs[a.pif as IfName]?.vrf === a.v && (c.ifs[a.pif as IfName]!.vrf = undefined), c) } },
    { id: "j-rd", summary: "Route distinguisher", args: { v: vX, rd: rdArg }, junos: { syntax: "routing-instances <v> route-distinguisher <rd>", set: (c, a) => ((vr(c, a.v).rd = a.rd), c), del: (c, a) => ((vr(c, a.v).rd = undefined), c) } },
    { id: "j-vt", summary: "Route target to import and export", args: { v: vX, rt: jrtArg }, junos: { syntax: "routing-instances <v> vrf-target <rt>", set: (c, a) => (Object.assign(vr(c, a.v), { imp: [a.rt], exp: [a.rt] }), c), del: (c, a) => (Object.assign(vr(c, a.v), { imp: [], exp: [] }), c) } },
    { id: "j-vti", summary: "Route target to import", args: { v: vX, rt: jrtArg }, junos: { syntax: "routing-instances <v> vrf-target import <rt>", set: (c, a) => ((vr(c, a.v).imp = [a.rt]), c), del: (c, a) => ((vr(c, a.v).imp = vr(c, a.v).imp.filter((x) => x !== a.rt)), c) } },
    { id: "j-vte", summary: "Route target to export", args: { v: vX, rt: jrtArg }, junos: { syntax: "routing-instances <v> vrf-target export <rt>", set: (c, a) => ((vr(c, a.v).exp = [a.rt]), c), del: (c, a) => ((vr(c, a.v).exp = vr(c, a.v).exp.filter((x) => x !== a.rt)), c) } },
    { id: "j-vimp", summary: "Import policy for the VRF (overrides vrf-target import)", args: { v: vX, p: nameArg(polNames(s, r), "Policy name") }, junos: { syntax: "routing-instances <v> vrf-import <p>", set: (c, a) => ((vr(c, a.v).vrfImport = a.p), c), del: (c, a) => ((vr(c, a.v).vrfImport = undefined), c) } },
    { id: "j-comm", summary: "A named community and its route target", args: { n: nameArg(commNames(s, r), "Community name"), rt: jrtArg }, junos: { syntax: "policy-options community <n> members <rt>", set: (c, a) => (((c.jpol ??= { comms: {}, pols: {} }).comms[a.n] = a.rt), c), del: (c, a) => (c.jpol && delete c.jpol.comms[a.n], c) } },
    { id: "j-comm-all", summary: "A named community (delete removes it)", args: { n: nameArg(commNames(s, r), "Community name") }, junos: { syntax: "policy-options community <n>", del: (c, a) => (c.jpol && delete c.jpol.comms[a.n], c) } },
    { id: "j-from", summary: "Match routes carrying the community", args: { p: nameArg(polNames(s, r), "Policy name"), t: termArg(s, r), n: nameArg(commNames(s, r), "Community name") }, junos: { syntax: "policy-options policy-statement <p> term <t> from community <n>", set: (c, a) => { const t = (((c.jpol ??= { comms: {}, pols: {} }).pols[a.p] ??= {})[a.t] ??= { from: [], accept: false }); t.from = [...new Set([...t.from, a.n])]; return c; }, del: (c, a) => { const t = c.jpol?.pols[a.p]?.[a.t]; if (t) t.from = t.from.filter((x) => x !== a.n); return c; } } },
    { id: "j-accept", summary: "Accept the matching routes", args: { p: nameArg(polNames(s, r), "Policy name"), t: termArg(s, r) }, junos: { syntax: "policy-options policy-statement <p> term <t> then accept", set: (c, a) => { ((((c.jpol ??= { comms: {}, pols: {} }).pols[a.p] ??= {})[a.t] ??= { from: [], accept: false })).accept = true; return c; }, del: (c, a) => { const t = c.jpol?.pols[a.p]?.[a.t]; if (t) t.accept = false; return c; } } },
    { id: "j-term", summary: "A policy term (delete removes it)", args: { p: nameArg(polNames(s, r), "Policy name"), t: termArg(s, r) }, junos: { syntax: "policy-options policy-statement <p> term <t>", del: (c, a) => (c.jpol?.pols[a.p] && delete c.jpol.pols[a.p][a.t], c) } },
    { id: "j-pol", summary: "A routing policy (delete removes it)", args: { p: nameArg(polNames(s, r), "Policy name") }, junos: { syntax: "policy-options policy-statement <p>", del: (c, a) => (c.jpol && delete c.jpol.pols[a.p], c) } },
    { id: "j-ae", summary: "Leak routes with the other VRFs of this router (auto-export)", args: { v: vX }, junos: { syntax: "routing-instances <v> routing-options auto-export", set: (c, a) => ((vr(c, a.v).autoExport = true), c), del: (c, a) => ((vr(c, a.v).autoExport = false), c) } },
    { id: "j-vtl", summary: "One VPN label for the whole VRF", args: { v: vX }, junos: { syntax: "routing-instances <v> vrf-table-label", set: (c, a) => ((vr(c, a.v).perVrfLabel = true), c), del: (c, a) => ((vr(c, a.v).perVrfLabel = false), c) } },
    { id: "j-st", summary: "A static route in the VRF", args: { v: vX, p: pfxArg, nh: nhArg }, junos: { syntax: "routing-instances <v> routing-options static route <p> next-hop <nh>", set: (c, a) => ((vr(c, a.v).statics = [...vr(c, a.v).statics.filter((y) => y.prefix !== a.p), { prefix: a.p, nh: a.nh }]), (vr(c, a.v).redist = true), c), del: (c, a) => ((vr(c, a.v).statics = vr(c, a.v).statics.filter((y) => y.prefix !== a.p)), c) } },
    { id: "j-st-all", summary: "A static route in the VRF (delete removes it)", args: { v: vX, p: pfxArg }, junos: { syntax: "routing-instances <v> routing-options static route <p>", del: (c, a) => ((vr(c, a.v).statics = vr(c, a.v).statics.filter((y) => y.prefix !== a.p)), c) } },
    { id: "j-nbr", summary: "The iBGP neighbor", args: { g: grpArg, ip: nbrArg(r) }, junos: { syntax: "protocols bgp group <g> neighbor <ip>", set: (c, a) => (pe ? ((c.nbr ??= { ip: a.ip, vpnv4: false }), (c.nbr.ip = a.ip), c) : `error: ${String(peOnly(c)).slice(2)}`), del: (c) => ((c.nbr = undefined), c) } },
    { id: "j-nbr-vpn", summary: "Exchange VPNv4 (inet-vpn) routes with the neighbor", args: { g: grpArg, ip: nbrArg(r) }, junos: { syntax: "protocols bgp group <g> neighbor <ip> family inet-vpn unicast", set: (c, a) => ((c.nbr ??= { ip: a.ip, vpnv4: false }), (c.nbr.vpnv4 = true), c), del: (c) => (c.nbr && (c.nbr.vpnv4 = false), c) } },
    { id: "j-ldp", summary: "Run LDP on the interface", args: { pif: pifJ }, junos: { syntax: "protocols ldp interface <pif>", set: (c, a) => (coreIfs(r).some((x) => x.ifn === a.pif) ? ((c.ifs[a.pif as IfName]!.ldp = true), c) : "error: LDP runs on the core interfaces only"), del: (c, a) => ((c.ifs[a.pif as IfName]!.ldp = false), c) } },
    { id: "j-dis", summary: "Disable the interface", args: { pif: pifJ }, junos: { syntax: "interfaces <pif> disable", set: (c, a) => ((c.ifs[a.pif as IfName]!.shut = true), c), del: (c, a) => ((c.ifs[a.pif as IfName]!.shut = false), c) } },
  ];
}

// ---------------------------------------------------------------------------------------------------------------
// Command sets
// ---------------------------------------------------------------------------------------------------------------
export function l3Validate(c: L3Cfg, junos: boolean): string | undefined {
  const rds = Object.entries(c.vrfs).filter(([, v]) => v.rd).map(([n, v]) => [n, v.rd!]);
  const dup = rds.find(([n, rd]) => rds.some(([m, rd2]) => m !== n && rd2 === rd));
  if (dup) return junos ? `error: route-distinguisher ${dup[1]} is used by more than one routing instance\nerror: configuration check-out failed` : `!!% Duplicate RD ${dup[1]} configured for VRF ${dup[0]}`;
  if (junos) {
    const noPol = Object.values(c.vrfs).find((v) => v.vrfImport && !c.jpol?.pols[v.vrfImport]);
    if (noPol) return `error: Policy error: Policy ${noPol.vrfImport} referenced but not defined\nerror: configuration check-out failed`;
    const noComm = Object.entries(c.jpol?.pols ?? {}).flatMap(([p, ts]) => Object.values(ts).flatMap((t) => t.from.filter((n) => !c.jpol!.comms[n]).map((n) => [p, n])))[0];
    if (noComm) return `error: Policy error: Community ${noComm[1]} referenced in policy ${noComm[0]} is not defined\nerror: configuration check-out failed`;
    const noRd = Object.entries(c.vrfs).find(([, v]) => !v.rd);
    if (noRd) return `error: routing-instances ${noRd[0]}: route-distinguisher must be configured for instance-type vrf\nerror: configuration check-out failed`;
  }
  return undefined;
}
export function l3XrSpec(api: L3CliApi, r: L3R): SpXrSpec<L3Cfg> {
  const s = api.s;
  const sh = (id: string, syntax: string, summary: string, run: SpCmd["run"], args?: SpCmd["args"]): SpCmd => ({ id, syntax, summary, run, args });
  const nothing = (o: string, why: string) => o || { output: "", explanation: why };
  const vA = vrfArg(s, r);
  return {
    stmts: stmts(r, s).filter((x) => x.xr),
    prompts: { config: "config", vrf: "config-vrf", "vrf-af": "config-vrf-af", "rt-imp": "config-vrf-import-rt", "rt-exp": "config-vrf-export-rt", if: "config-if", rs: "config-static", "rs-vrf": "config-static-vrf", "rs-af": "config-static-vrf-afi", bgp: "config-bgp", "bgp-af": "config-bgp-af", "bgp-nbr": "config-bgp-nbr", "bgp-nbr-af": "config-bgp-nbr-af", "bgp-vrf": "config-bgp-vrf", "bgp-vrf-af": "config-bgp-vrf-af", ldp: "config-ldp", "ldp-if": "config-ldp-if" },
    lines: (c) => l3XrLines(r, c),
    help: { "show bgp": "BGP information", "show bgp vpnv4": "VPNv4 address family", "show bgp vpnv4 unicast": "VPNv4 unicast", "show route": "IP routing table", "show route vrf": "A VRF's routing table", "show cef": "Cisco Express Forwarding", "show cef vrf": "A VRF's forwarding table", "show arp": "ARP table", "show mpls": "MPLS information", "show mpls ldp": "LDP information", "show vrf": "VRF information" },
    shows: [
      sh("vrf", "show vrf all", "Every VRF with its RD and route targets", () => nothing(xrVrfAll(s, r), "No VRFs on this router (P routers carry no customer state).")),
      sh("rvrf", "show route vrf <v>", "A VRF's routing table", (a) => (isPe(r) ? xrRouteVrf(s, r, a.v) : `% VRF ${a.v} not found`), { v: vA }),
      sh("rvrf-ip", "show route vrf <v> <ip>", "The route a destination uses in a VRF", (a) => (isPe(r) ? xrRouteVrf(s, r, a.v, a.ip) : `% VRF ${a.v} not found`), { v: vA, ip: hostArg }),
      sh("vpn", "show bgp vpnv4 unicast", "Every VPNv4 route: per RD, local and received", () => xrVpnv4Table(s, r)),
      sh("vpn-sum", "show bgp vpnv4 unicast summary", "The VPNv4 session", () => xrBgpSum(s, r, true)),
      sh("vpn-rd", "show bgp vpnv4 unicast rd <rd> <p>", "One VPNv4 route: RT, VPN label, imported or not", (a) => xrVpnv4Rd(s, r, a.rd, a.p), { rd: { ...rdArg, choices: [...new Set([...s.view.vpnv4.map((x) => x.rd)])] }, p: pfxArg }),
      sh("vpn-vrf", "show bgp vpnv4 unicast vrf <v>", "The VPNv4 routes of one VRF", (a) => xrVpnv4Table(s, r, a.v), { v: vA }),
      sh("sum", "show bgp summary", "The IPv4 unicast session", () => xrBgpSum(s, r, false)),
      sh("nbr", "show bgp neighbors <ip>", "The session and the families negotiated", (a) => xrBgpNbr(s, r, a.ip), { ip: nbrArg(r) }),
      sh("cef", "show cef vrf <v> <ip>", "What the PE does with a destination: the labels it imposes", (a) => (isPe(r) ? xrCef(s, r, a.v, a.ip) : `% VRF ${a.v} not found`), { v: vA, ip: hostArg }),
      sh("arp", "show arp vrf <v>", "ARP entries in a VRF", (a) => (isPe(r) ? xrArp(s, r, a.v) : `% VRF ${a.v} not found`), { v: vA }),
      sh("fwd", "show mpls forwarding", "The label forwarding table (transport and VPN labels)", () => xrForwarding(s, r)),
      sh("ldp", "show mpls ldp neighbor brief", "LDP sessions", () => xrLdpBrief(s, r)),
      sh("route", "show route", "The global routing table (loopbacks via IS-IS)", () => xrRouteGlobal(s, r)),
      sh("log", "show logging", "The syslog buffer", () => xrLogging(s, r)),
    ],
    exec: [],
  };
}
export function l3JunosSpec(api: L3CliApi, r: L3R): SpJunosSpec<L3Cfg> {
  const s = api.s;
  const sh = (id: string, syntax: string, summary: string, run: SpCmd["run"], args?: SpCmd["args"]): SpCmd => ({ id, syntax, summary, run, args });
  const nothing = (o: string, why: string) => o || { output: "", explanation: why };
  const tblArg: CliArgSpec = { choices: [...Object.keys(s.cfg[r].vrfs).map((v) => `${v}.inet.0`), "bgp.l3vpn.0", "inet.3"], describe: () => "Routing table", resolve: (raw) => (/^([A-Za-z][\w-]*\.inet\.0|bgp\.l3vpn\.0|inet\.3)$/.test(raw) ? raw : undefined) };
  const table = (t: string, detail = false, ip?: string, hidden = false) => (t === "bgp.l3vpn.0" ? jnL3vpnTable(s, r, detail, hidden) : t === "inet.3" ? (hidden ? jnInet3(s, r).split("\n")[0] : jnInet3(s, r)) : jnVrfTable(s, r, t.replace(/\.inet\.0$/, ""), ip, hidden));
  return {
    stmts: stmts(r, s).filter((x) => x.junos),
    jstmts: (c) => l3JnStmts(r, c),
    help: { "show route": "Show routing table information", "show route table": "Name of the routing table", "show bgp": "Show Border Gateway Protocol information", "show ldp": "Show LDP information", "show arp": "Show system ARP table entries" },
    shows: [
      sh("tbl", "show route table <t>", "A routing table: a VRF (<vrf>.inet.0), bgp.l3vpn.0 or inet.3", (a) => nothing(table(a.t), "That table is empty or doesn't exist."), { t: tblArg }),
      sh("tbl-d", "show route table <t> detail", "A routing table in detail (RD, VPN label, communities)", (a) => nothing(table(a.t, true), "That table is empty or doesn't exist."), { t: tblArg }),
      sh("tbl-h", "show route table <t> hidden", "Routes the router keeps but can't use (e.g. no LSP to the next hop)", (a) => nothing(table(a.t, false, undefined, true), "That table doesn't exist."), { t: tblArg }),
      sh("tbl-ip", "show route table <t> <ip>", "One destination in a table", (a) => nothing(table(a.t, false, a.ip), "No route."), { t: tblArg, ip: hostArg }),
      sh("sum", "show bgp summary", "BGP sessions and the tables they fill", () => jnBgpSum(s, r)),
      sh("nbr", "show bgp neighbor <ip>", "The session and the NLRI (families) negotiated", (a) => nothing(jnBgpNbr(s, r, a.ip), "No such neighbor."), { ip: nbrArg(r) }),
      sh("ldp", "show ldp session", "LDP sessions", () => jnLdp(s, r)),
      sh("arp", "show arp", "ARP entries", () => jnArp(s, r)),
      sh("log", "show log messages", "The system log", () => nothing(jnLog(s, r), "No messages since the lab started.")),
    ],
    op: [],
  };
}
export function l3Sets(api: L3CliApi, r: L3R): Partial<Record<CliVendor, CliCommandSet>> {
  return {
    cisco: buildXrSet({ ...api.dev, validate: (c) => l3Validate(c, false) }, l3XrSpec(api, r)),
    juniper: buildJunosSet({ ...api.dev, validate: (c) => l3Validate(c, true) }, l3JunosSpec(api, r)),
  };
}
export const l3Pipe = (api: L3CliApi, r: L3R) => ({ config: junosPipeConfig(api.dev, { jstmts: (c: L3Cfg) => l3JnStmts(r, c) }), rollbacks: api.dev.hist.length });
export function l3StaticApi(s: L3State, r: L3R): L3CliApi {
  return { s, act: () => s, dev: { host: r, running: s.cfg[r], hist: s.hist[r], setCand: () => undefined, xr: [], setXr: () => undefined, edit: false, setEdit: () => undefined, commit: () => undefined } };
}
export const l3Clone = spClone;
export { connectedOf };
