import type { CliArgSpec, CliCommandSet, CliVendor } from "@/lib/cli/types";
import { buildJunosSet, buildXrSet, choiceArg, junosPipeConfig, numArg, type SpCfgStmt, type SpCmd, type SpDevCli, type SpJunosSpec, type SpXrSpec } from "@/components/sp-lab/spCli";
import { lpad, pad, spAge, spStamp, type JStmt } from "@/components/sp-lab/spKit";
import { jnIf, parseIf, xrIf } from "@/components/sp-lab/spNames";
import { IMPLICIT_NULL, VS_LO, acKey, ceIfs, coreIfs, ldpLabel, pathBetween, type IfName, type VsR } from "@/lib/sim-engine/scenarios/vsNet";
import { BV_LO, BV_PES, BV_ROUTERS, RR_CLUSTER, peOfLo } from "@/lib/sim-engine/scenarios/bvNet";
import { EVI, EM_RT, emLive, emMacTable, floodList, imLabel, uniLabel, type EmAction, type EmCfg, type EmR, type EmRoute, type EmState } from "@/lib/sim-engine/scenarios/emNet";

/**
 * Command lines of the EVPN-MPLS stage of the L2VPN Evolution Lab — IOS XR or Junos on PE1–PE3, P1–P3 and RR1. Every
 * output is printed from the lab model: the EVI's MACs and flood list, the EVPN routes, labels, sessions.
 *
 *   IOS XR  show evpn evi vpn-id 100 mac | inclusive-multicast | detail · show bgp l2vpn evpn [summary] ·
 *           show l2vpn bridge-domain · show mpls forwarding · show mpls ldp neighbor brief · show route · show logging ·
 *           clear l2vpn bridge-domain bd-name EVPN-A
 *           configure → interface <if>.<vlan> l2transport → encapsulation dot1q · evpn → evi 100 → bgp → rd · route-target ·
 *           advertise-mac · l2vpn → bridge group → bridge-domain → interface · evi 100 · router bgp 65000 →
 *           address-family l2vpn evpn · neighbor → address-family l2vpn evpn [→ route-reflector-client] · mpls ldp
 *   Junos   show evpn database instance EVPN-A · show evpn mac-table · show evpn instance EVPN-A extensive ·
 *           show route table bgp.evpn.0 · show bgp summary · show ldp session · show route table inet.3 | mpls.0 ·
 *           show log messages · clear evpn mac-table instance EVPN-A
 *           configure → set interfaces <p> unit <u> encapsulation vlan-bridge | vlan-id · routing-instances EVPN-A
 *           instance-type evpn | vlan-id | interface | route-distinguisher | vrf-target | protocols evpn ·
 *           protocols bgp group <g> neighbor | family evpn signaling | cluster · protocols ldp interface
 */

export interface EmCliApi {
  s: EmState;
  act: (a: EmAction) => EmState;
  dev: SpDevCli<EmCfg>;
}

const ipRe = /^(\d{1,3}\.){3}\d{1,3}$/;
const rtRe = /^\d{1,10}:\d{1,10}$/;
const wordRe = /^[A-Za-z][\w-]{0,31}$/;
const isPe = (r: EmR) => (BV_PES as string[]).includes(r);
const isRr = (r: EmR) => r === "RR1";
export const xrSub = (k: string, short = false) => {
  const [ifn, u] = k.split(".");
  return `${xrIf(ifn, short)}.${u}`;
};
function parseSub(raw: string): string | undefined {
  const m = /^(?:gigabitethernet|gi|gig)0\/0\/0\/([0-2])\.(\d{1,5})$/i.exec(raw) ?? /^ge-0\/0\/([0-2])\.(\d{1,5})$/i.exec(raw);
  if (!m || +m[2] < 1 || +m[2] > 4094) return undefined;
  return `ge-0/0/${m[1]}.${+m[2]}`;
}
const ceOf = (r: EmR) => (isPe(r) ? ceIfs(r as VsR) : []);
const subArg = (s: EmState, r: EmR, junos: boolean): CliArgSpec => ({
  choices: [...new Set([...Object.keys(s.cfg[r].acs), ...ceOf(r).map((x) => acKey(x.ifn, x.vlan))])].map((k) => (junos ? k : xrSub(k))),
  describe: (c) => {
    const k = parseSub(c);
    const ce = k ? ceOf(r).find((x) => k.startsWith(`${x.ifn}.`)) : undefined;
    return ce ? `sub-interface toward ${ce.ce}` : "Sub-interface (port.VLAN)";
  },
  resolve: (raw) => {
    const k = parseSub(raw);
    return k && ceOf(r).some((x) => k.startsWith(`${x.ifn}.`)) ? k : undefined;
  },
});
const portArg = (r: EmR): CliArgSpec => ({ choices: ceOf(r).map((x) => x.ifn), describe: (c) => `to ${ceOf(r).find((x) => x.ifn === c)?.ce ?? "?"}`, resolve: (raw) => (ceOf(r).some((x) => x.ifn === raw) ? raw : undefined) });
const pifArg = (r: EmR, junos: boolean): CliArgSpec => ({
  choices: r === "RR1" ? [] : coreIfs(r).map((x) => (junos ? jnIf(x.ifn) : xrIf(x.ifn))),
  describe: (c) => `to ${r === "RR1" ? "?" : coreIfs(r).find((x) => x.ifn === parseIf(c))?.peer ?? "?"}`,
  resolve: (raw) => {
    const i = parseIf(raw);
    return i && r !== "RR1" && coreIfs(r).some((x) => x.ifn === i) ? i : undefined;
  },
});
const nbrArg = (r: EmR): CliArgSpec => ({ choices: isRr(r) ? BV_PES.map((p) => BV_LO[p]) : [BV_LO.RR1], describe: () => (isRr(r) ? "A PE's loopback" : "The route reflector's loopback"), resolve: (raw) => (ipRe.test(raw) ? raw : undefined) });
const rdArg: CliArgSpec = { choices: ["65000:1", "65000:2", "65000:3"], describe: () => "Route distinguisher (ASN:nn)", resolve: (raw) => (rtRe.test(raw) ? raw : undefined) };
const rtArg: CliArgSpec = { choices: [EM_RT], describe: () => "Route target (ASN:nn)", resolve: (raw) => (rtRe.test(raw) ? raw : undefined) };
const jrtArg: CliArgSpec = { choices: [`target:${EM_RT}`], describe: () => "Route target (target:ASN:nn)", resolve: (raw) => (/^target:\d{1,10}:\d{1,10}$/.test(raw) ? raw.slice(7) : undefined) };
const eviArg = numArg(1, 65534, [String(EVI)], "EVPN instance ID");
const vlanArg = numArg(1, 4094, ["100"], "VLAN ID");
const nameArg = (names: string[], what: string): CliArgSpec => ({ choices: names, describe: () => what, resolve: (raw) => (wordRe.test(raw) ? raw : undefined) });
const asArg = choiceArg(["65000"], () => "This network's AS");
const xrMac = (m: string) => m.replace(/:/g, "").replace(/(....)(....)(....)/, "$1.$2.$3");
const lab = (n: number | undefined) => (n === undefined ? "Unlabelled" : n === IMPLICIT_NULL ? "Pop" : String(n));
const tableOf = (s: EmState, r: EmR): EmRoute[] => (isRr(r) ? s.view.rrTable : isPe(r) ? [...s.view.adv.filter((x) => x.pe === r), ...s.view.kept[r]] : []);

// ---------------------------------------------------------------------------------------------------------------
// IOS XR outputs
// ---------------------------------------------------------------------------------------------------------------
function xrEviMac(s: EmState, r: EmR): string {
  if (!isPe(r) || !emLive(s.os, s.cfg[r])) return "";
  const rows = emMacTable(s.view, s.fdb, r as VsR).map((m) => `${pad(EVI, 11)}${pad("MPLS", 11)}${pad(xrMac(m.mac), 15)}${pad(m.ip ?? "::", 41)}${pad(m.remote ?? xrSub(m.where), 40)}${m.remote ? m.label : uniLabel(s.os, r as VsR)}`);
  return ["VPN-ID     Encap      MAC address    IP address                               Nexthop                                 Label    SID", "---------- ---------- -------------- ---------------------------------------- --------------------------------------- -------- --------------------------------------", ...rows].join("\n");
}
function xrEviIm(s: EmState, r: EmR): string {
  if (!isPe(r) || !emLive(s.os, s.cfg[r])) return "";
  const rows = [BV_LO[r], ...floodList(s.view, r as VsR).map((x) => x.nh)].map((ip) => `${pad(EVI, 11)}${pad("MPLS", 11)}${pad(0, 11)}${ip}`);
  return ["VPN-ID     Encap      EtherTag   Originating IP", "---------- ---------- ---------- ----------------------------------------", ...rows].join("\n");
}
function xrEviDetail(s: EmState, r: EmR): string {
  const c = s.cfg[r];
  if (!isPe(r) || !c.evi) return "";
  return [
    "VPN-ID     Encap      Bridge Domain                Type",
    "---------- ---------- ---------------------------- -------------------",
    `${pad(EVI, 11)}${pad("MPLS", 11)}${pad(c.bd?.evi === c.evi.id ? c.bd.name : "(none)", 29)}EVPN`,
    "   Stitching: Regular",
    `   Unicast Label  : ${uniLabel(s.os, r as VsR)}`,
    `   Multicast Label: ${imLabel(s.os, r as VsR)}`,
    "   Reroute Label: 0",
    "   Flow Label Supported: No",
    `   Control-Word: Enabled`,
    `   Advertise MACs: ${c.evi.advMac ? "Yes" : "No"}`,
    `   RD Config: ${c.evi.rd ?? "none"}`,
    `   RD Auto  : (auto) ${BV_LO[r]}:${EVI}`,
    `   RT Auto  : 65000:${EVI}`,
    "   Route Targets in Use           Type",
    "   ------------------------------ ---------------------",
    ...(c.evi.rt ? [`   ${pad(c.evi.rt, 31)}Import`, `   ${pad(c.evi.rt, 31)}Export`] : []),
  ].join("\n");
}
const xrNet = (x: EmRoute) => (x.type === 3 ? `[3][0][32][${x.nh}]/80` : x.ip ? `[2][0][48][${xrMac(x.mac!)}][32][${x.ip}]/136` : `[2][0][48][${xrMac(x.mac!)}][0]/104`);
function xrBgpEvpn(s: EmState, r: EmR): string {
  if (!isPe(r) && !isRr(r)) return "% BGP instance 'default' not active";
  const rows = tableOf(s, r);
  const byRd = new Map<string, EmRoute[]>();
  for (const x of rows) byRd.set(x.rd, [...(byRd.get(x.rd) ?? []), x]);
  const own = isPe(r) ? s.cfg[r].evi?.rd : undefined;
  const lines: string[] = [];
  for (const [rd, xs] of [...byRd.entries()].sort(([a], [b]) => (a === own ? -1 : b === own ? 1 : a.localeCompare(b)))) {
    lines.push(`Route Distinguisher: ${rd}${rd === own ? ` (default for vrf VPLS:${EVI})` : ""}`);
    for (const x of xs) {
      const local = x.pe === r;
      lines.push(`${local ? "*> " : "*>i"}${xrNet(x)}`, `${pad("", 22)}${pad(local ? "0.0.0.0" : x.nh, 39)}${local ? "0 i" : "100      0 i"}`);
    }
  }
  return [`BGP router identifier ${BV_LO[r]}, local AS number 65000`, "BGP generic scan interval 60 secs", "Non-stop routing is enabled", "BGP table state: Active", "Table ID: 0x0   RD version: 0", "BGP main routing table version 21", "BGP NSR Initial initsync version 2 (Reached)", "BGP scan interval 60 secs", "", "Status codes: s suppressed, d damped, h history, * valid, > best", "              i - internal, r RIB-failure, S stale, N Nexthop-discard", "Origin codes: i - IGP, e - EGP, ? - incomplete", "   Network            Next Hop            Metric LocPrf Weight Path", ...lines, "", `Processed ${rows.length} prefixes, ${rows.length} paths`].join("\n");
}
function xrBgpSummary(s: EmState, r: EmR): string {
  if (!isPe(r) && !isRr(r)) return "% BGP instance 'default' not active";
  const peers = isRr(r) ? s.cfg.RR1.rr!.clients.map((c) => ({ ip: c.ip, pe: peOfLo(c.ip) as VsR })) : s.cfg[r].nbr ? [{ ip: s.cfg[r].nbr!.ip, pe: r as VsR }] : [];
  const rows = peers.map(({ ip, pe }) => {
    const b = s.view.bgp[pe];
    const rx = !b?.evpn ? 0 : isRr(r) ? s.view.rrTable.filter((x) => x.pe === pe).length : s.view.received[r].length;
    return `${pad(ip, 16)}${pad(0, 4)}${lpad(65000, 5)}${lpad(b?.up ? 92 : 0, 8)}${lpad(b?.up ? 95 : 0, 8)}${lpad(21, 9)}${lpad(0, 5)}${lpad(0, 5)} ${pad(b?.up ? spAge(s.clock, 25) : "00:00:00", 9)}${b?.up ? lpad(rx, 9) : " Idle"}`;
  });
  return [`BGP router identifier ${BV_LO[r]}, local AS number 65000`, "BGP generic scan interval 60 secs", "BGP table state: Active", "", "Neighbor        Spk    AS MsgRcvd MsgSent   TblVer  InQ OutQ  Up/Down  St/PfxRcd", ...rows].join("\n");
}
function xrBridgeDomain(s: EmState, r: EmR): string {
  const bd = s.cfg[r].bd;
  if (!isPe(r) || !bd) return "";
  const live = emLive(s.os, s.cfg[r]);
  return [
    "Legend: pp = Partially Programmed.",
    `Bridge group: ${bd.group}, bridge-domain: ${bd.name}, id: 0, state: up, ShgId: 0, MSTi: 0`,
    "  Aging: 300 s, MAC limit: 64000, Action: none, Notification: syslog",
    "  Filter MAC addresses: 0",
    `  ACs: ${bd.acs.length} (${bd.acs.filter((k) => s.cfg[r].acs[k]).length} up), VFIs: 0, PWs: 0 (0 up), PBBs: 0 (0 up), VNIs: 0 (0 up)`,
    "  List of EVPNs:",
    ...(bd.evi !== undefined ? [`    EVPN, state: ${live ? "up" : "down"}`] : []),
    "  List of ACs:",
    ...bd.acs.map((k) => `    ${xrSub(k, true)}, state: ${s.cfg[r].acs[k] ? "up" : "unresolved"}, Static MAC addresses: 0`),
    "  List of Access PWs:",
    "  List of VFIs:",
    "  List of Access VFIs:",
  ].join("\n");
}
function transportRows(s: EmState, r: VsR) {
  return BV_PES.filter((p) => p !== r).flatMap((p) => {
    const fec = VS_LO[p];
    const t = s.view.lsp[r][fec];
    if (!t?.nh) return [];
    const x = coreIfs(r).find((y) => y.peer === t.nh)!;
    return [{ fec, local: ldpLabel(s.os, r, fec), out: t.out, ifn: x.ifn, nh: x.peerIp }];
  });
}
function xrForwarding(s: EmState, r: EmR): string {
  const head = ["Local  Outgoing    Prefix             Outgoing     Next Hop        Bytes", "Label  Label       or ID              Interface                    Switched", "------ ----------- ------------------ ------------ --------------- ------------"];
  if (r === "RR1") return head.join("\n");
  const rows = transportRows(s, r).map((t) => ({ k: t.local, l: `${pad(t.local, 7)}${pad(lab(t.out), 12)}${pad(`${t.fec}/32`, 19)}${pad(xrIf(t.ifn, true), 13)}${pad(t.nh, 16)}0` }));
  if (isPe(r) && emLive(s.os, s.cfg[r])) rows.push({ k: uniLabel(s.os, r), l: `${pad(uniLabel(s.os, r), 7)}${pad("Pop", 12)}${pad(`EVPN:${EVI} U`, 19)}${pad("BD=0", 13)}${pad("point2point", 16)}0` }, { k: imLabel(s.os, r), l: `${pad(imLabel(s.os, r), 7)}${pad("Pop", 12)}${pad(`EVPN:${EVI} M`, 19)}${pad("BD=0", 13)}${pad("point2point", 16)}0` });
  rows.sort((a, b) => a.k - b.k);
  return [...head, ...rows.map((x) => x.l)].join("\n");
}
function xrLdpBrief(s: EmState, r: EmR): string {
  const row = (lo: string) => `${pad(`${lo}:0`, 18)}${pad("Y", 4)}${pad(spAge(s.clock, 20), 10)}${lpad(1, 6)}${lpad(4, 9)}${lpad(1, 7)}${lpad(6, 6)}`;
  const rows = r === "RR1" ? [] : coreIfs(r).filter((x) => s.view.ldp[x.link.id]).map((x) => row(VS_LO[x.peer]));
  return ["Peer              GR  Up Time         Discovery   Addresses     Labels", "                                      ipv4  ipv6  ipv4  ipv6  ipv4   ipv6", "----------------- --  --------------- ----- ----  ----- ----  ------ ----", ...rows].join("\n");
}
function xrRoute(s: EmState, r: EmR): string {
  const num = (ip: string) => ip.split(".").reduce((n, o) => n * 256 + +o, 0);
  const rows = [...BV_ROUTERS].sort((a, b) => num(BV_LO[a]) - num(BV_LO[b])).map((n) => {
    if (n === r) return `L    ${pad(`${BV_LO[n]}/32`, 18)} is directly connected, ${spAge(s.clock, 30)}, Loopback0`;
    if (r === "RR1" || n === "RR1") {
      const via = r === "RR1" ? "192.0.2.10" : r === "P1" ? "192.0.2.11" : coreIfs(r).find((y) => y.peer === pathBetween(r, "P1")[1])?.peerIp;
      const ifn = r === "RR1" ? "GigabitEthernet0/0/0/0" : r === "P1" ? "GigabitEthernet0/0/0/3" : xrIf(coreIfs(r).find((y) => y.peer === pathBetween(r, "P1")[1])!.ifn);
      const hops = r === "RR1" ? pathBetween("P1", n as VsR).length : pathBetween(r as VsR, "P1").length;
      return `i L2 ${pad(`${BV_LO[n]}/32`, 18)} [115/${10 * hops + 10}] via ${via}, ${spAge(s.clock, 30)}, ${ifn}`;
    }
    const path = pathBetween(r as VsR, n as VsR);
    const x = coreIfs(r as VsR).find((y) => y.peer === path[1])!;
    return `i L2 ${pad(`${BV_LO[n]}/32`, 18)} [115/${10 * (path.length - 1) + 10}] via ${x.peerIp}, ${spAge(s.clock, 30)}, ${xrIf(x.ifn)}`;
  });
  return ["Codes: C - connected, S - static, B - BGP, i - ISIS, L1 - IS-IS level-1, L2 - IS-IS level-2", "       L - local", "", "Gateway of last resort is not set", "", ...rows].join("\n");
}
function xrLogging(s: EmState, r: EmR): string {
  const lines = s.sys.filter((x) => x.dev === r).slice(-30).map((x) => {
    const st = `RP/0/RP0/CPU0:${spStamp(x.t).xr}`;
    if (x.kind === "ldp-up") return `${st}: mpls_ldp[1159]: %ROUTING-LDP-5-NBR_CHANGE : VRF 'default' (0x60000000), Neighbor ${x.peer}:0 is UP`;
    if (x.kind === "ldp-down") return `${st}: mpls_ldp[1159]: %ROUTING-LDP-5-NBR_CHANGE : VRF 'default' (0x60000000), Neighbor ${x.peer}:0 is DOWN (Interface state down)`;
    if (x.kind === "bgp-up") return `${st}: bgp[1052]: %ROUTING-BGP-5-ADJCHANGE : neighbor ${x.peer} Up (VRF: default) (AS: 65000)`;
    if (x.kind === "bgp-down") return `${st}: bgp[1052]: %ROUTING-BGP-5-ADJCHANGE : neighbor ${x.peer} Down - Peer closing down the session (VRF: default) (AS: 65000)`;
    if (x.kind === "clear") return `${st}: l2vpn_mgr[1234]: bridge-domain EVPN-A: MAC addresses cleared by user 'admin'`;
    return `${st}: config[65857]: %MGBL-CONFIG-6-DB_COMMIT : Configuration committed by user 'admin'. Use 'show commit changes ${1000000000 + x.t}' to view the changes.`;
  });
  return ["Syslog logging: enabled (0 messages dropped, 0 flushes, 0 overruns)", `    Buffer logging: level debugging, ${lines.length} messages logged`, "", "Log Buffer (2097152 bytes):", "", ...lines].join("\n");
}

// ---------------------------------------------------------------------------------------------------------------
// Junos outputs
// ---------------------------------------------------------------------------------------------------------------
const instName = (s: EmState, r: EmR) => s.cfg[r].bd?.name ?? "EVPN-A";
function jnDatabase(s: EmState, r: EmR): string {
  if (!isPe(r) || !emLive(s.os, s.cfg[r])) return "";
  const rows = emMacTable(s.view, s.fdb, r as VsR).map((m) => `${pad(100, 6)}${pad(m.mac, 19)}${pad(m.remote ?? m.where, 31)}${pad(spStamp(s.clock - 1).junos, 17)}${m.ip ?? ""}`);
  return [`Instance: ${instName(s, r)}`, "VLAN  MAC address        Active source                  Timestamp        IP address", ...rows].join("\n");
}
function jnMacTable(s: EmState, r: EmR): string {
  if (!isPe(r) || !emLive(s.os, s.cfg[r])) return "";
  const rows = emMacTable(s.view, s.fdb, r as VsR).map((m) => `   ${pad(m.mac, 20)}${pad(m.remote ? "DC" : "D", 9)}${pad(m.remote ? `lsi.10488${30 + BV_PES.indexOf(peOfLo(m.remote) as VsR)}` : m.where, 17)}${m.remote ? m.remote : ""}`);
  return ["", "MAC flags       (S -static MAC, D -dynamic MAC, L -locally learned, C -Control MAC", "    O -OVSDB MAC, SE -Statistics enabled, NM -Non configured MAC, R -Remote PE MAC, P -Pinned MAC)", "", `Routing instance : ${instName(s, r)}`, ` Bridging domain : __${instName(s, r)}__, VLAN : 100`, "   MAC                 MAC      Logical          Active", "   address             flags    interface        source", ...rows].join("\n");
}
function jnInstance(s: EmState, r: EmR): string {
  const c = s.cfg[r];
  if (!isPe(r) || !c.bd) return "";
  const t = emMacTable(s.view, s.fdb, r as VsR);
  const fl = floodList(s.view, r as VsR);
  return [
    `Instance: ${c.bd.name}`,
    `  Route Distinguisher: ${c.evi?.rd ?? "none"}`,
    "  Encapsulation type: MPLS",
    `  Per-instance MAC route label: ${uniLabel(s.os, r as VsR)}`,
    `  Per-instance multicast route label: ${imLabel(s.os, r as VsR)}`,
    "  MAC database status                     Local  Remote",
    `    MAC advertisements:                  ${lpad(t.filter((m) => !m.remote).length, 6)}${lpad(t.filter((m) => m.remote).length, 8)}`,
    `    MAC+IP advertisements:               ${lpad(t.filter((m) => !m.remote && m.ip).length, 6)}${lpad(t.filter((m) => m.remote && m.ip).length, 8)}`,
    `  Number of neighbors: ${fl.length}`,
    "    Address               MAC    MAC+IP        AD        IM        ES Leaf-label",
    ...fl.map((x) => `    ${pad(x.nh, 22)}${lpad(t.filter((m) => m.remote === x.nh).length, 3)}${lpad(t.filter((m) => m.remote === x.nh && m.ip).length, 10)}${lpad(0, 10)}${lpad(1, 10)}${lpad(0, 10)}`),
    "  Inclusive multicast routes",
    ...fl.map((x) => `    ${pad(x.nh, 22)}label ${x.label}`),
  ].join("\n");
}
const jnNet = (x: EmRoute) => (x.type === 3 ? `3:${x.rd}::0::${x.nh}/248 IM` : `2:${x.rd}::0::${x.mac}${x.ip ? `::${x.ip}` : ""}/304 MAC/IP`);
function jnBgpEvpn(s: EmState, r: EmR): string {
  if (!isPe(r) && !isRr(r)) return "";
  const rows = isRr(r) ? s.view.rrTable : s.view.kept[r];
  const lines = rows.flatMap((x) => {
    const t = isPe(r) ? s.view.lsp[r as VsR][x.nh] : undefined;
    const nh = isPe(r) ? coreIfs(r as VsR)[0] : undefined;
    return [jnNet(x), `                   *[BGP/170] ${spAge(s.clock, 25)}, localpref 100, from ${isRr(r) ? x.nh : BV_LO.RR1}`, "                      AS path: I, validation-state: unverified", isRr(r) ? "                       Indirect" : t?.out === undefined ? "                       Unusable" : `                    >  to ${nh!.peerIp} via ${jnIf(nh!.ifn)}${t.out === IMPLICIT_NULL ? "" : `, Push ${t.out}`}`];
  });
  return [`bgp.evpn.0: ${rows.length} destinations, ${rows.length} routes (${rows.length} active, 0 holddown, 0 hidden)`, ...(rows.length ? ["+ = Active Route, - = Last Active, * = Both", "", ...lines] : [])].join("\n");
}
function jnBgpSum(s: EmState, r: EmR): string {
  if (!isPe(r) && !isRr(r)) return "BGP is not running";
  const peers = isRr(r) ? s.cfg.RR1.rr!.clients.map((c) => ({ ip: c.ip, pe: peOfLo(c.ip) as VsR })) : s.cfg[r].nbr ? [{ ip: s.cfg[r].nbr!.ip, pe: r as VsR }] : [];
  const tot = isRr(r) ? s.view.rrTable.length : s.view.kept[r].length;
  const rows = peers.flatMap(({ ip, pe }) => {
    const b = s.view.bgp[pe];
    const rx = !b?.evpn ? 0 : isRr(r) ? s.view.rrTable.filter((x) => x.pe === pe).length : s.view.received[r].length;
    const acc = isRr(r) ? rx : s.view.kept[r].length;
    return [`${pad(ip, 21)}${lpad(65000, 6)}${lpad(b?.up ? 92 : 0, 11)}${lpad(b?.up ? 95 : 0, 11)}${lpad(0, 8)}${lpad(0, 8)} ${lpad(b?.up ? spAge(s.clock, 25).replace(/^00:/, "") : "1:00", 11)} ${b?.up ? "Establ" : "Active"}`, ...(b?.up ? (b.evpn ? [`  bgp.evpn.0: ${acc}/${rx}/${acc}/0`] : ["  inet.0: 0/0/0/0"]) : [])];
  });
  return ["Threading mode: BGP I/O", `Groups: 1 Peers: ${peers.length} Down peers: ${peers.filter((p) => !s.view.bgp[p.pe]?.up).length}`, "Table          Tot Paths  Act Paths Suppressed    History Damp State    Pending", "bgp.evpn.0", `${lpad(tot, 23)}${lpad(tot, 11)}${lpad(0, 11)}${lpad(0, 11)}${lpad(0, 11)}${lpad(0, 11)}`, "Peer                     AS      InPkt     OutPkt    OutQ   Flaps Last Up/Dwn State|#Active/Received/Accepted/Damped...", ...rows].join("\n");
}
function jnLdpSession(s: EmState, r: EmR): string {
  const rows = r === "RR1" ? [] : coreIfs(r).filter((x) => s.view.ldp[x.link.id]).map((x) => `${pad(VS_LO[x.peer], 21)}${pad("Operational", 14)}${pad("Open", 13)}${lpad(28, 5)}         DU`);
  return ["  Address              State        Connection  Hold time  Adv. Mode", ...rows].join("\n");
}
function jnInet3(s: EmState, r: EmR): string {
  const rows = r === "RR1" ? [] : transportRows(s, r).filter((t) => t.out !== undefined).map((t) => [`${pad(`${t.fec}/32`, 19)}*[LDP/9] ${spAge(s.clock, 20)}, metric 1`, `                    >  to ${t.nh} via ${jnIf(t.ifn)}${t.out === IMPLICIT_NULL ? "" : `, Push ${t.out}`}`]);
  return [`inet.3: ${rows.length} destinations, ${rows.length} routes (${rows.length} active, 0 holddown, 0 hidden)`, ...(rows.length ? ["+ = Active Route, - = Last Active, * = Both", "", ...rows.flat()] : [])].join("\n");
}
function jnMpls0(s: EmState, r: EmR): string {
  const rows: { k: number; l: string[] }[] = [{ k: 0, l: ["0                  *[MPLS/0] 01:00:00, metric 1", "                       to table inet.0"] }];
  if (r !== "RR1") for (const t of transportRows(s, r).filter((x) => x.out !== undefined)) rows.push({ k: t.local, l: [`${pad(t.local, 19)}*[LDP/9] ${spAge(s.clock, 20)}, metric 1`, `                    >  to ${t.nh} via ${jnIf(t.ifn)}, ${t.out === IMPLICIT_NULL ? "Pop" : `Swap ${t.out}`}`] });
  if (isPe(r) && emLive(s.os, s.cfg[r])) rows.push({ k: uniLabel(s.os, r as VsR), l: [`${pad(uniLabel(s.os, r as VsR), 19)}*[EVPN/7] ${spAge(s.clock, 32)}`, `                       to table ${instName(s, r)}.evpn-mac.0`] }, { k: imLabel(s.os, r as VsR), l: [`${pad(imLabel(s.os, r as VsR), 19)}*[EVPN/7] ${spAge(s.clock, 32)}, routing-instance ${instName(s, r)}, route-type Ingress-IM`, "                       to table mpls.0"] });
  rows.sort((a, b) => a.k - b.k);
  return [`mpls.0: ${rows.length} destinations, ${rows.length} routes (${rows.length} active, 0 holddown, 0 hidden)`, "+ = Active Route, - = Last Active, * = Both", "", ...rows.flatMap((x) => x.l)].join("\n");
}
function jnLog(s: EmState, r: EmR): string {
  return s.sys.filter((x) => x.dev === r).slice(-30).map((x) => {
    const st = `${spStamp(x.t).junos}  ${r}`;
    if (x.kind === "ldp-up") return `${st} rpd[1532]: RPD_LDP_NBRUP: LDP neighbor ${x.peer} (${x.peer}) is up`;
    if (x.kind === "ldp-down") return `${st} rpd[1532]: RPD_LDP_NBRDOWN: LDP neighbor ${x.peer} (${x.peer}) is down`;
    if (x.kind === "bgp-up") return `${st} rpd[1532]: BGP_PEER_STATE_CHANGE: BGP peer ${x.peer} (Internal AS 65000) changed state from OpenConfirm to Established (event RecvKeepAlive)`;
    if (x.kind === "bgp-down") return `${st} rpd[1532]: BGP_PEER_STATE_CHANGE: BGP peer ${x.peer} (Internal AS 65000) changed state from Established to Idle (event RecvNotify)`;
    if (x.kind === "clear") return `${st} mgd[4417]: UI_CMDLINE_READ_LINE: User 'admin', command 'clear evpn mac-table instance EVPN-A'`;
    return `${st} mgd[4417]: UI_COMMIT: User 'admin' requested 'commit' operation (comment: none)`;
  }).join("\n");
}

// ---------------------------------------------------------------------------------------------------------------
// Configuration as each OS prints it
// ---------------------------------------------------------------------------------------------------------------
export function emXrLines(r: EmR, c: EmCfg): string[] {
  const out: string[] = [`hostname ${r}`, "!", "interface Loopback0", ` ipv4 address ${BV_LO[r]} 255.255.255.255`, "!"];
  if (r === "RR1") out.push("interface GigabitEthernet0/0/0/0", " description to P1", " ipv4 address 192.0.2.11 255.255.255.254", "!");
  else for (const x of coreIfs(r)) out.push(`interface ${xrIf(x.ifn)}`, ` description to ${x.peer}`, ` ipv4 address ${x.ip} 255.255.255.254`, "!");
  if (r === "P1") out.push("interface GigabitEthernet0/0/0/3", " description to RR1", " ipv4 address 192.0.2.10 255.255.255.254", "!");
  for (const x of ceOf(r)) out.push(`interface ${xrIf(x.ifn)}`, ` description to ${x.ce}`, "!");
  for (const [k, ac] of Object.entries(c.acs).sort(([a], [b]) => a.localeCompare(b))) out.push(`interface ${xrSub(k)} l2transport`, ...(ac.vlan ? [` encapsulation dot1q ${ac.vlan}`] : []), "!");
  out.push("router isis CORE", ` net 49.0001.0000.0000.000${BV_ROUTERS.indexOf(r) + 1}.00`, " address-family ipv4 unicast", "  metric-style wide", " !", "!");
  if (isPe(r) || isRr(r)) {
    out.push("router bgp 65000", ` bgp router-id ${BV_LO[r]}`, " address-family l2vpn evpn", " !");
    const nbrs = isRr(r) ? (c.rr?.clients ?? []) : c.nbr ? [{ ip: c.nbr.ip, evpn: c.nbr.evpn, client: false }] : [];
    for (const n of nbrs) out.push(` neighbor ${n.ip}`, "  remote-as 65000", "  update-source Loopback0", ...(n.evpn ? ["  address-family l2vpn evpn", ...(n.client ? ["   route-reflector-client"] : []), "  !"] : []), " !");
    out.push("!");
  }
  if (c.evi) out.push("evpn", ` evi ${c.evi.id}`, "  bgp", ...(c.evi.rd ? [`   rd ${c.evi.rd}`] : []), ...(c.evi.rt ? [`   route-target import ${c.evi.rt}`, `   route-target export ${c.evi.rt}`] : []), "  !", ...(c.evi.advMac ? ["  advertise-mac", "  !"] : []), " !", "!");
  if (c.bd) {
    out.push("l2vpn", ` bridge group ${c.bd.group}`, `  bridge-domain ${c.bd.name}`);
    for (const k of c.bd.acs) out.push(`   interface ${xrSub(k)}`, "   !");
    if (c.bd.evi !== undefined) out.push(`   evi ${c.bd.evi}`, "   !");
    out.push("  !", " !", "!");
  }
  if (r !== "RR1") out.push("mpls ldp", ` router-id ${BV_LO[r]}`, ...coreIfs(r).filter((x) => c.ldp[x.ifn]).flatMap((x) => [` interface ${xrIf(x.ifn)}`, " !"]), "!");
  return out;
}
export function emJnStmts(r: EmR, c: EmCfg): JStmt[] {
  const out: JStmt[] = [];
  if (r === "RR1") out.push({ path: ["interfaces", "ge-0/0/0", "unit 0", "family inet"], leaf: "address 192.0.2.11/31" });
  else for (const x of coreIfs(r)) out.push({ path: ["interfaces", x.ifn, "unit 0", "family inet"], leaf: `address ${x.ip}/31` }, { path: ["interfaces", x.ifn, "unit 0", "family mpls"], leaf: "" });
  if (r === "P1") out.push({ path: ["interfaces", "ge-0/0/3", "unit 0", "family inet"], leaf: "address 192.0.2.10/31" });
  for (const x of ceOf(r)) {
    const units = Object.entries(c.acs).filter(([k]) => k.startsWith(`${x.ifn}.`));
    if (!units.length) continue;
    out.push({ path: ["interfaces", x.ifn], leaf: "flexible-vlan-tagging" }, { path: ["interfaces", x.ifn], leaf: "encapsulation flexible-ethernet-services" });
    for (const [k, ac] of units) {
      const u = ["interfaces", x.ifn, `unit ${k.split(".")[1]}`];
      if (ac.l2) out.push({ path: u, leaf: "encapsulation vlan-bridge" });
      if (ac.vlan) out.push({ path: u, leaf: `vlan-id ${ac.vlan}` });
      if (!ac.l2 && !ac.vlan) out.push({ path: u, leaf: "" });
    }
  }
  out.push({ path: ["interfaces", "lo0", "unit 0", "family inet"], leaf: `address ${BV_LO[r]}/32` }, { path: ["routing-options"], leaf: `router-id ${BV_LO[r]}` }, { path: ["routing-options"], leaf: "autonomous-system 65000" });
  if (isPe(r) && c.nbr) {
    const g = ["protocols", "bgp", "group RR"];
    out.push({ path: g, leaf: "type internal" }, { path: g, leaf: `local-address ${BV_LO[r]}` });
    if (c.nbr.evpn) out.push({ path: [...g, "family evpn"], leaf: "signaling" });
    out.push({ path: g, leaf: `neighbor ${c.nbr.ip}` });
  }
  if (isRr(r) && c.rr) {
    const g = ["protocols", "bgp", "group CLIENTS"];
    out.push({ path: g, leaf: "type internal" }, { path: g, leaf: `local-address ${BV_LO.RR1}` });
    if (c.rr.clients.some((x) => x.evpn)) out.push({ path: [...g, "family evpn"], leaf: "signaling" });
    if (c.rr.clients.some((x) => x.client)) out.push({ path: g, leaf: `cluster ${RR_CLUSTER}` });
    for (const x of c.rr.clients) out.push({ path: g, leaf: `neighbor ${x.ip}` });
  }
  if (r !== "RR1") {
    for (const x of coreIfs(r)) out.push({ path: ["protocols", "mpls", `interface ${jnIf(x.ifn)}`], leaf: "" });
    for (const x of coreIfs(r).filter((y) => c.ldp[y.ifn])) out.push({ path: ["protocols", "ldp", `interface ${jnIf(x.ifn)}`], leaf: "" });
  }
  if (c.bd) {
    const p = ["routing-instances", c.bd.name];
    out.push({ path: p, leaf: "instance-type evpn" });
    if (c.bd.vlanId !== undefined) out.push({ path: p, leaf: `vlan-id ${c.bd.vlanId}` });
    for (const k of c.bd.acs) out.push({ path: p, leaf: `interface ${k}` });
    if (c.evi?.rd) out.push({ path: p, leaf: `route-distinguisher ${c.evi.rd}` });
    if (c.evi?.rt) out.push({ path: p, leaf: `vrf-target target:${c.evi.rt}` });
    out.push({ path: [...p, "protocols", "evpn"], leaf: "" });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Configuration statements
// ---------------------------------------------------------------------------------------------------------------
const peOnly = "% EVPN instances live on the PEs.";
function stmts(r: EmR, s: EmState): SpCfgStmt<EmCfg>[] {
  const pe = isPe(r);
  const rr = isRr(r);
  const subX = subArg(s, r, false);
  const subJ = subArg(s, r, true);
  const bdName = nameArg([s.cfg[r].bd?.name ?? "EVPN-A"], "Bridge-domain / instance name");
  const grp = nameArg([s.cfg[r].bd?.group || "CUST-A"], "Bridge group name");
  const ac = (c: EmCfg, k: string) => (c.acs[k] ??= { l2: false });
  const ev = (c: EmCfg, id: number) => (c.evi && c.evi.id === id ? c.evi : (c.evi = { id, advMac: false }));
  const jbd = (c: EmCfg, v: string) => {
    if (!c.bd || c.bd.name !== v) c.bd = { group: "", name: v, acs: [] };
    c.evi ??= { id: EVI, advMac: true };
    return c.bd;
  };
  const rrClient = (c: EmCfg, ip: string) => {
    c.rr ??= { clients: [] };
    let x = c.rr.clients.find((y) => y.ip === ip);
    if (!x) c.rr.clients.push((x = { ip, evpn: false, client: false }));
    return x;
  };
  const all: SpCfgStmt<EmCfg>[] = [
    // IOS XR
    { id: "sub", summary: "Configure an attachment-circuit sub-interface", args: { sif: subX, l2: choiceArg(["l2transport"], () => "Layer 2 transport") }, xr: { mode: "config", syntax: "interface <sif> <l2>", enter: "subif", apply: (c, a) => ((ac(c, a.sif).l2 = true), c), no: (c, a) => (delete c.acs[a.sif], c) } },
    { id: "sub-enc", summary: "The VLAN this attachment circuit accepts", args: { vlan: vlanArg }, xr: { mode: "subif", syntax: "encapsulation dot1q <vlan>", noSyntax: "encapsulation", apply: (c, a, x) => ((ac(c, x.sif).vlan = +a.vlan), c), no: (c, _a, x) => ((ac(c, x.sif).vlan = undefined), c) } },
    { id: "evpn", summary: "EVPN", xr: { mode: "config", syntax: "evpn", enter: "evpn", apply: (c) => (pe ? c : peOnly) } },
    { id: "evi", summary: "An EVPN instance", args: { n: eviArg }, xr: { mode: "evpn", syntax: "evi <n>", enter: "evi", apply: (c, a) => (ev(c, +a.n), c), no: (c, a) => (c.evi?.id === +a.n && (c.evi = undefined), c) } },
    { id: "evi-bgp", summary: "BGP parameters of the EVI", xr: { mode: "evi", syntax: "bgp", enter: "evi-bgp", apply: (c) => c } },
    { id: "evi-rd", summary: "Route distinguisher", args: { rd: rdArg }, xr: { mode: "evi-bgp", syntax: "rd <rd>", noSyntax: "rd", apply: (c, _a, x) => ((ev(c, +x.n).rd = _a.rd), c), no: (c, _a, x) => ((ev(c, +x.n).rd = undefined), c) } },
    { id: "evi-rt", summary: "Route target imported and exported", args: { dir: choiceArg(["import", "export"], (d) => (d === "import" ? "Import this route target" : "Export this route target")), rt: rtArg }, xr: { mode: "evi-bgp", syntax: "route-target <dir> <rt>", apply: (c, a, x) => ((ev(c, +x.n).rt = a.rt), c), no: (c, _a, x) => ((ev(c, +x.n).rt = undefined), c) } },
    { id: "evi-adv", summary: "Advertise the EVI's MAC addresses (Type 2 routes)", xr: { mode: "evi", syntax: "advertise-mac", apply: (c, _a, x) => ((ev(c, +x.n).advMac = true), c), no: (c, _a, x) => ((ev(c, +x.n).advMac = false), c) } },
    { id: "l2vpn", summary: "Layer 2 VPN services", xr: { mode: "config", syntax: "l2vpn", enter: "l2vpn", apply: (c) => (pe ? c : peOnly) } },
    { id: "bg", summary: "A bridge group", args: { g: grp }, xr: { mode: "l2vpn", syntax: "bridge group <g>", enter: "bg", apply: (c) => c, no: (c, a) => (c.bd?.group === a.g && (c.bd = undefined), c) } },
    { id: "bd", summary: "A bridge domain", args: { b: bdName }, xr: { mode: "bg", syntax: "bridge-domain <b>", enter: "bd", apply: (c, a, x) => (c.bd && c.bd.name !== a.b ? "!!% This lab's PEs carry one bridge domain; remove the existing one first." : ((c.bd ??= { group: x.g, name: a.b, acs: [] }), c)), no: (c, a) => (c.bd?.name === a.b && (c.bd = undefined), c) } },
    { id: "bd-if", summary: "An attachment circuit", args: { sif: subX }, xr: { mode: "bd", syntax: "interface <sif>", enter: "bd-ac", apply: (c, a) => { if (c.bd && !c.bd.acs.includes(a.sif)) c.bd.acs.push(a.sif); return c; }, no: (c, a) => { if (c.bd) c.bd.acs = c.bd.acs.filter((k) => k !== a.sif); return c; } } },
    { id: "bd-evi", summary: "Bind the bridge domain to an EVI", args: { n: eviArg }, xr: { mode: "bd", syntax: "evi <n>", enter: "bd-evi", apply: (c, a) => (c.bd && (c.bd.evi = +a.n), c), no: (c) => (c.bd && (c.bd.evi = undefined), c) } },
    { id: "bgp", summary: "BGP", args: { as: asArg }, xr: { mode: "config", syntax: "router bgp <as>", enter: "bgp", apply: (c) => (pe || rr ? c : "% BGP runs on the PEs and RR1 only; the P routers are BGP-free.") } },
    { id: "bgp-af", summary: "Enable the EVPN family", xr: { mode: "bgp", syntax: "address-family l2vpn evpn", enter: "bgp-af", apply: (c) => c } },
    { id: "nbr", summary: rr ? "A route-reflector client" : "The iBGP neighbor (RR1)", args: { ip: nbrArg(r) }, xr: { mode: "bgp", syntax: "neighbor <ip>", enter: "nbr", apply: (c, a) => (rr ? (rrClient(c, a.ip), c) : ((c.nbr ??= { ip: a.ip, evpn: false }), (c.nbr.ip = a.ip), c)), no: (c, a) => (rr ? (c.rr && (c.rr.clients = c.rr.clients.filter((y) => y.ip !== a.ip)), c) : ((c.nbr = undefined), c)) } },
    { id: "nbr-ras", summary: "Neighbor AS", args: { as: asArg }, xr: { mode: "nbr", syntax: "remote-as <as>", apply: (c) => c } },
    { id: "nbr-upd", summary: "Source of the session", args: { lo: choiceArg(["Loopback0"], () => "Loopback interface") }, xr: { mode: "nbr", syntax: "update-source <lo>", apply: (c) => c } },
    { id: "nbr-af", summary: "Exchange EVPN routes with this neighbor", xr: { mode: "nbr", syntax: "address-family l2vpn evpn", enter: "nbr-af", apply: (c, _a, x) => (rr ? (rrClient(c, x.ip).evpn = true) : c.nbr && (c.nbr.evpn = true), c), no: (c, _a, x) => (rr ? Object.assign(rrClient(c, x.ip), { evpn: false, client: false }) : c.nbr && (c.nbr.evpn = false), c) } },
    { id: "nbr-rrc", summary: "Reflect routes to and from this neighbor", xr: { mode: "nbr-af", syntax: "route-reflector-client", apply: (c, _a, x) => (rr ? ((rrClient(c, x.ip).client = true), c) : "!!% Only the route reflector has route-reflector clients in this lab."), no: (c, _a, x) => (rr && (rrClient(c, x.ip).client = false), c) } },
    { id: "ldp", summary: "MPLS LDP", xr: { mode: "config", syntax: "mpls ldp", enter: "ldp", apply: (c) => (rr ? "% RR1 is in the control plane only: no LDP." : c) } },
    { id: "ldp-if", summary: "Run LDP on the interface", args: { pif: pifArg(r, false) }, xr: { mode: "ldp", syntax: "interface <pif>", enter: "ldp-if", apply: (c, a) => ((c.ldp[a.pif as IfName] = true), c), no: (c, a) => ((c.ldp[a.pif as IfName] = false), c) } },
    // Junos
    { id: "j-enc", summary: "The unit is bridged (VLAN bridge encapsulation)", args: { p: portArg(r), u: vlanArg, e: choiceArg(["vlan-bridge"], () => "VLAN bridge encapsulation") }, junos: { syntax: "interfaces <p> unit <u> encapsulation <e>", set: (c, a) => ((ac(c, acKey(a.p, +a.u)).l2 = true), c), del: (c, a) => (c.acs[acKey(a.p, +a.u)] && (c.acs[acKey(a.p, +a.u)].l2 = false), c) } },
    { id: "j-vlan", summary: "The VLAN this unit accepts", args: { p: portArg(r), u: vlanArg, vlan: vlanArg }, junos: { syntax: "interfaces <p> unit <u> vlan-id <vlan>", set: (c, a) => ((ac(c, acKey(a.p, +a.u)).vlan = +a.vlan), c), del: (c, a) => (c.acs[acKey(a.p, +a.u)] && (c.acs[acKey(a.p, +a.u)].vlan = undefined), c) } },
    { id: "j-unit", summary: "A logical unit (delete removes it)", args: { p: portArg(r), u: vlanArg }, junos: { syntax: "interfaces <p> unit <u>", del: (c, a) => (delete c.acs[acKey(a.p, +a.u)], c) } },
    { id: "j-type", summary: "The instance type", args: { v: bdName, t: choiceArg(["evpn"], () => "EVPN instance") }, junos: { syntax: "routing-instances <v> instance-type <t>", set: (c, a) => (pe ? (jbd(c, a.v), c) : `error: ${peOnly.slice(2)}`), del: (c) => c } },
    { id: "j-ri", summary: "The instance (delete removes it)", args: { v: bdName }, junos: { syntax: "routing-instances <v>", del: (c, a) => (c.bd?.name === a.v && ((c.bd = undefined), (c.evi = undefined)), c) } },
    { id: "j-vid", summary: "The instance's VLAN", args: { v: bdName, vlan: vlanArg }, junos: { syntax: "routing-instances <v> vlan-id <vlan>", set: (c, a) => ((jbd(c, a.v).vlanId = +a.vlan), c), del: (c) => (c.bd && (c.bd.vlanId = undefined), c) } },
    { id: "j-if", summary: "An attachment circuit of the instance", args: { v: bdName, sif: subJ }, junos: { syntax: "routing-instances <v> interface <sif>", set: (c, a) => { const b = jbd(c, a.v); if (!b.acs.includes(a.sif)) b.acs.push(a.sif); return c; }, del: (c, a) => { if (c.bd) c.bd.acs = c.bd.acs.filter((k) => k !== a.sif); return c; } } },
    { id: "j-rd", summary: "Route distinguisher", args: { v: bdName, rd: rdArg }, junos: { syntax: "routing-instances <v> route-distinguisher <rd>", set: (c, a) => (jbd(c, a.v), (c.evi!.rd = a.rd), c), del: (c) => (c.evi && (c.evi.rd = undefined), c) } },
    { id: "j-vt", summary: "Route target (import and export)", args: { v: bdName, rt: jrtArg }, junos: { syntax: "routing-instances <v> vrf-target <rt>", set: (c, a) => (jbd(c, a.v), (c.evi!.rt = a.rt), c), del: (c) => (c.evi && (c.evi.rt = undefined), c) } },
    { id: "j-evpn", summary: "Run EVPN in the instance", args: { v: bdName }, junos: { syntax: "routing-instances <v> protocols evpn", set: (c, a) => (jbd(c, a.v), c), del: (c) => c } },
    { id: "j-nbr", summary: rr ? "A client of the route reflector" : "The iBGP neighbor (RR1)", args: { g: nameArg([rr ? "CLIENTS" : "RR"], "BGP group"), ip: nbrArg(r) }, junos: { syntax: "protocols bgp group <g> neighbor <ip>", set: (c, a) => (rr ? (Object.assign(rrClient(c, a.ip), { evpn: !!c.rr?.clients.some((y) => y.evpn), client: !!c.rr?.clients.some((y) => y.client) }), c) : pe ? ((c.nbr ??= { ip: a.ip, evpn: false }), (c.nbr.ip = a.ip), c) : "error: BGP runs on the PEs and RR1 only"), del: (c, a) => (rr ? (c.rr && (c.rr.clients = c.rr.clients.filter((y) => y.ip !== a.ip)), c) : ((c.nbr = undefined), c)) } },
    { id: "j-fam", summary: "Exchange EVPN routes", args: { g: nameArg([rr ? "CLIENTS" : "RR"], "BGP group"), sg: choiceArg(["signaling"], () => "EVPN signaling") }, junos: { syntax: "protocols bgp group <g> family evpn <sg>", set: (c) => (rr ? (c.rr?.clients.forEach((y) => (y.evpn = true)), c) : (c.nbr && (c.nbr.evpn = true), c)), del: (c) => (rr ? (c.rr?.clients.forEach((y) => (y.evpn = false)), c) : (c.nbr && (c.nbr.evpn = false), c)) } },
    { id: "j-cluster", summary: "Make this group's neighbors route-reflector clients", args: { g: nameArg(["CLIENTS"], "BGP group"), id: choiceArg([RR_CLUSTER], () => "Cluster ID") }, junos: { syntax: "protocols bgp group <g> cluster <id>", set: (c) => (rr ? (c.rr?.clients.forEach((y) => (y.client = true)), c) : "error: only the route reflector has clients in this lab"), del: (c) => (c.rr?.clients.forEach((y) => (y.client = false)), c) } },
    { id: "j-ldp", summary: "Run LDP on the interface", args: { pif: pifArg(r, true) }, junos: { syntax: "protocols ldp interface <pif>", set: (c, a) => ((c.ldp[a.pif as IfName] = true), c), del: (c, a) => ((c.ldp[a.pif as IfName] = false), c) } },
  ];
  const peOnlyIds = ["sub", "bd-if", "j-enc", "j-vlan", "j-unit", "j-if"];
  const coreIds = ["ldp-if", "j-ldp"];
  return all.filter((x) => (pe || !peOnlyIds.includes(x.id)) && (!rr || !coreIds.includes(x.id)));
}

export function emValidate(c: EmCfg, junos: boolean): string | undefined {
  if (junos && c.bd) {
    const bad = c.bd.acs.find((k) => c.acs[k] && !c.acs[k].l2);
    if (bad) return `error: routing-instances ${c.bd.name}: interface ${bad} must use encapsulation vlan-bridge\nerror: configuration check-out failed`;
  }
  return undefined;
}
export function emXrSpec(api: EmCliApi, r: EmR): SpXrSpec<EmCfg> {
  const s = api.s;
  const sh = (id: string, syntax: string, summary: string, run: SpCmd["run"], args?: SpCmd["args"]): SpCmd => ({ id, syntax, summary, run, args });
  const nothing = (o: string, why: string) => o || { output: "", explanation: why };
  const none = isPe(r) ? `EVI ${EVI} isn't running here.` : "No EVPN instance here: only the PEs carry the customer's service.";
  const vpn = choiceArg([String(EVI)], () => "EVPN instance ID");
  return {
    stmts: stmts(r, s).filter((x) => x.xr),
    prompts: { config: "config", subif: "config-subif", evpn: "config-evpn", evi: "config-evpn-instance", "evi-bgp": "config-evpn-instance-bgp", l2vpn: "config-l2vpn", bg: "config-l2vpn-bg", bd: "config-l2vpn-bg-bd", "bd-ac": "config-l2vpn-bg-bd-ac", "bd-evi": "config-l2vpn-bg-bd-evi", bgp: "config-bgp", "bgp-af": "config-bgp-af", nbr: "config-bgp-nbr", "nbr-af": "config-bgp-nbr-af", ldp: "config-ldp", "ldp-if": "config-ldp-if" },
    lines: (c) => emXrLines(r, c),
    help: { "show evpn": "EVPN information", "show evpn evi": "EVPN instance information", "show evpn evi vpn-id": "Specify the EVPN instance by its VPN ID", "show bgp": "BGP information", "show bgp l2vpn": "L2VPN address family", "show bgp l2vpn evpn": "EVPN routes", "show l2vpn": "Layer 2 VPN information", "show mpls": "MPLS information", "show mpls ldp": "LDP information", "show route": "IP routing table", clear: "Clear functions", "clear l2vpn": "Clear Layer 2 VPN information" },
    shows: [
      sh("mac", "show evpn evi vpn-id <v> mac", "The EVI's MACs: local, and remote from Type 2 routes, with labels", () => nothing(xrEviMac(s, r), none), { v: vpn }),
      sh("im", "show evpn evi vpn-id <v> inclusive-multicast", "The flood list: every PE with a Type 3 route", () => nothing(xrEviIm(s, r), none), { v: vpn }),
      sh("det", "show evpn evi vpn-id <v> detail", "The EVI: labels, RD, route targets", () => nothing(xrEviDetail(s, r), none), { v: vpn }),
      sh("bgp", "show bgp l2vpn evpn", "The EVPN routes (Type 2 and Type 3)", () => xrBgpEvpn(s, r)),
      sh("sum", "show bgp l2vpn evpn summary", "The BGP sessions and the routes received", () => xrBgpSummary(s, r)),
      sh("bd", "show l2vpn bridge-domain", "The bridge domain and its EVI", () => nothing(xrBridgeDomain(s, r), none)),
      sh("fwd", "show mpls forwarding", "Transport labels and the EVI's unicast / multicast labels", () => xrForwarding(s, r)),
      sh("ldp", "show mpls ldp neighbor brief", "LDP sessions", () => xrLdpBrief(s, r)),
      sh("route", "show route", "The global routing table", () => xrRoute(s, r)),
      sh("log", "show logging", "The syslog buffer", () => xrLogging(s, r)),
    ],
    exec: [sh("clr", "clear l2vpn bridge-domain bd-name <n>", "Clear the bridge domain's MAC addresses", (a) => (isPe(r) && s.cfg[r].bd?.name === a.n ? (api.act({ type: "clear", dev: r as VsR }), "") : `% Bridge domain ${a.n} not found`), { n: nameArg([s.cfg[r].bd?.name ?? "EVPN-A"], "Bridge-domain name") })],
  };
}
export function emJunosSpec(api: EmCliApi, r: EmR): SpJunosSpec<EmCfg> {
  const s = api.s;
  const sh = (id: string, syntax: string, summary: string, run: SpCmd["run"], args?: SpCmd["args"]): SpCmd => ({ id, syntax, summary, run, args });
  const nothing = (o: string, why: string) => o || { output: "", explanation: why };
  const none = isPe(r) ? "No EVPN instance running." : "No EVPN here: only the PEs carry the customer's service.";
  const inst = nameArg([s.cfg[r].bd?.name ?? "EVPN-A"], "EVPN instance");
  const tblArg = choiceArg(["bgp.evpn.0", "inet.3", "mpls.0"], (c) => (c === "bgp.evpn.0" ? "EVPN routes kept" : c === "inet.3" ? "LSPs to the loopbacks" : "Label forwarding"));
  return {
    stmts: stmts(r, s).filter((x) => x.junos),
    jstmts: (c) => emJnStmts(r, c),
    help: { "show evpn": "Show EVPN information", "show route": "Show routing table information", "show route table": "Name of the routing table", "show bgp": "Show Border Gateway Protocol information", "show ldp": "Show LDP information", clear: "Clear information in the system", "clear evpn": "Clear EVPN information" },
    shows: [
      sh("db", "show evpn database instance <i>", "MACs: learned locally, or from remote PEs' Type 2 routes", () => nothing(jnDatabase(s, r), none), { i: inst }),
      sh("mac", "show evpn mac-table", "The forwarding table: local MACs and remote ones", () => nothing(jnMacTable(s, r), none)),
      sh("inst", "show evpn instance <i> extensive", "The instance: labels, MAC counts, neighbors and their IM routes", () => nothing(jnInstance(s, r), none), { i: inst }),
      sh("tbl", "show route table <t>", "bgp.evpn.0, inet.3 or mpls.0", (a) => nothing(a.t === "bgp.evpn.0" ? jnBgpEvpn(s, r) : a.t === "inet.3" ? jnInet3(s, r) : jnMpls0(s, r), "That table is empty here."), { t: tblArg }),
      sh("sum", "show bgp summary", "BGP sessions and the EVPN routes they carry", () => jnBgpSum(s, r)),
      sh("ldps", "show ldp session", "LDP sessions", () => jnLdpSession(s, r)),
      sh("log", "show log messages", "The system log", () => nothing(jnLog(s, r), "No messages since the lab started.")),
    ],
    op: [sh("clr", "clear evpn mac-table instance <i>", "Clear the instance's locally learned MACs", (a) => (isPe(r) && s.cfg[r].bd?.name === a.i ? (api.act({ type: "clear", dev: r as VsR }), "") : `error: instance ${a.i} not found`), { i: inst })],
  };
}
export function emSets(api: EmCliApi, r: EmR): Partial<Record<CliVendor, CliCommandSet>> {
  return {
    cisco: buildXrSet({ ...api.dev, validate: (c) => emValidate(c, false) }, emXrSpec(api, r)),
    juniper: buildJunosSet({ ...api.dev, validate: (c) => emValidate(c, true) }, emJunosSpec(api, r)),
  };
}
export const emPipe = (api: EmCliApi, r: EmR) => ({ config: junosPipeConfig(api.dev, { jstmts: (c: EmCfg) => emJnStmts(r, c) }), rollbacks: api.dev.hist.length });
export function emStaticApi(s: EmState, r: EmR): EmCliApi {
  return { s, act: () => s, dev: { host: r, running: s.cfg[r], hist: s.hist[r], setCand: () => undefined, xr: [], setXr: () => undefined, edit: false, setEdit: () => undefined, commit: () => undefined } };
}
