import type { CliArgSpec, CliCommandSet, CliVendor } from "@/lib/cli/types";
import { buildJunosSet, buildXrSet, choiceArg, junosPipeConfig, numArg, type SpCfgStmt, type SpCmd, type SpDevCli, type SpJunosSpec, type SpXrSpec } from "@/components/sp-lab/spCli";
import { lpad, pad, spAge, spClone, spStamp, type JStmt } from "@/components/sp-lab/spKit";
import { jnIf, parseIf, xrIf } from "@/components/sp-lab/spNames";
import { IMPLICIT_NULL, VS_LINKS, VS_LO, acKey, ceIfs, coreIfs, ldpLabel, pathBetween, type IfName, type VsR } from "@/lib/sim-engine/scenarios/vsNet";
import { AS, BV_LO, BV_PES, BV_ROUTERS, CUST_RT, RR_CLUSTER, bvWhyText, defaultBlock, peOfLo, type BvAction, type BvBd, type BvCfg, type BvNlri, type BvPw, type BvR, type BvState } from "@/lib/sim-engine/scenarios/bvNet";

/**
 * Command lines of the BGP VPLS Lab — IOS XR or Junos on PE1–PE3, P1–P3 and RR1. Every output is printed from the lab
 * model: the VPLS routes (RD, VE ID, label blocks, RT) in BGP and on the route reflector, the pseudowires they produce,
 * the MAC tables, labels.
 *
 *   IOS XR  show l2vpn bridge-domain [detail] · show bgp l2vpn vpls [summary | rd <rd> <ve:vbo>/32] ·
 *           show l2vpn forwarding bridge-domain mac-address location 0/0/CPU0 · show mpls ldp neighbor brief ·
 *           show mpls forwarding · show route · show logging · clear l2vpn bridge-domain bd-name <name>
 *           configure → l2vpn → bridge group <g> → bridge-domain <name> → interface <if>.<vlan> · mtu <n> ·
 *           vfi <name> → vpn-id <n> · autodiscovery bgp → rd <rd> · route-target <rt> · signaling-protocol bgp →
 *           ve-id <n> · ve-range <n> · router bgp 65000 → address-family l2vpn vpls-vpws · neighbor <ip> →
 *           remote-as · update-source · address-family l2vpn vpls-vpws → route-reflector-client · commit
 *   Junos   show vpls connections · show route table bgp.l2vpn.0 [detail] · show bgp summary · show vpls mac-table ·
 *           show ldp session · show route table inet.3 | mpls.0 · show log messages · clear vpls mac-table instance <v>
 *           configure → set routing-instances <v> instance-type vpls | interface | route-distinguisher | vrf-target |
 *           protocols vpls site <name> site-identifier <n> | label-block-size <n> | mtu <n> · protocols bgp group <g>
 *           neighbor <ip> | family l2vpn signaling | cluster <id> · commit
 */

export interface BvCliApi {
  s: BvState;
  act: (a: BvAction) => BvState;
  dev: SpDevCli<BvCfg>;
}

// ---------------------------------------------------------------------------------------------------------------
// Names and arguments
// ---------------------------------------------------------------------------------------------------------------
const ipRe = /^(\d{1,3}\.){3}\d{1,3}$/;
const rtRe = /^\d{1,10}:\d{1,10}$/;
const wordRe = /^[A-Za-z][\w-]{0,31}$/;
const isPe = (r: BvR) => (BV_PES as string[]).includes(r);
const isRr = (r: BvR) => r === "RR1";
export const xrSub = (k: string, short = false) => {
  const [ifn, u] = k.split(".");
  return `${xrIf(ifn, short)}.${u}`;
};
export function parseSub(raw: string): string | undefined {
  const m = /^(?:gigabitethernet|gi|gig)0\/0\/0\/([0-2])\.(\d{1,5})$/i.exec(raw) ?? /^ge-0\/0\/([0-2])\.(\d{1,5})$/i.exec(raw);
  if (!m || +m[2] < 1 || +m[2] > 4094) return undefined;
  return `ge-0/0/${m[1]}.${+m[2]}`;
}
const ceOf = (r: BvR) => (isPe(r) ? ceIfs(r as VsR) : []);
const subArg = (s: BvState, r: BvR, junos: boolean): CliArgSpec => ({
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
const portArg = (r: BvR): CliArgSpec => ({ choices: ceOf(r).map((x) => x.ifn), describe: (c) => `to ${ceOf(r).find((x) => x.ifn === c)?.ce ?? "?"}`, resolve: (raw) => (ceOf(r).some((x) => x.ifn === raw) ? raw : undefined) });
const pifArg = (r: BvR, junos: boolean): CliArgSpec => ({
  choices: r === "RR1" ? [] : coreIfs(r).map((x) => (junos ? jnIf(x.ifn) : xrIf(x.ifn))),
  describe: (c) => `to ${r === "RR1" ? "?" : coreIfs(r).find((x) => x.ifn === parseIf(c))?.peer ?? "?"}`,
  resolve: (raw) => {
    const i = parseIf(raw);
    return i && r !== "RR1" && coreIfs(r).some((x) => x.ifn === i) ? i : undefined;
  },
});
const nbrArg = (r: BvR): CliArgSpec => ({ choices: isRr(r) ? BV_PES.map((p) => BV_LO[p]) : [BV_LO.RR1], describe: () => (isRr(r) ? "A PE's loopback" : "The route reflector's loopback"), resolve: (raw) => (ipRe.test(raw) ? raw : undefined) });
const rtArg: CliArgSpec = { choices: [CUST_RT], describe: () => "Route target (ASN:nn)", resolve: (raw) => (rtRe.test(raw) ? raw : undefined) };
const jrtArg: CliArgSpec = { choices: [`target:${CUST_RT}`], describe: () => "Route target (target:ASN:nn)", resolve: (raw) => (/^target:\d{1,10}:\d{1,10}$/.test(raw) ? raw.slice(7) : undefined) };
const rdArg: CliArgSpec = { choices: ["65000:1", "65000:2", "65000:3"], describe: () => "Route distinguisher (ASN:nn)", resolve: (raw) => (rtRe.test(raw) ? raw : undefined) };
const veArg = numArg(1, 16384, ["1", "2", "3"], "VE ID (unique per PE in the VPLS)");
const vlanArg = numArg(1, 4094, ["100"], "VLAN ID");
const nameArg = (names: string[], what: string): CliArgSpec => ({ choices: names, describe: () => what, resolve: (raw) => (wordRe.test(raw) ? raw : undefined) });
const asArg = choiceArg([String(AS)], () => "This network's AS");

// ---------------------------------------------------------------------------------------------------------------
// Shared formatting
// ---------------------------------------------------------------------------------------------------------------
const pwsOf = (s: BvState, r: BvR) => s.view.pws.filter((p) => p.pe === r);
const lab = (n: number | undefined) => (n === undefined ? "Unlabelled" : n === IMPLICIT_NULL ? "Pop" : String(n));
function transportRows(s: BvState, r: VsR) {
  return BV_PES.filter((p) => p !== r).flatMap((p) => {
    const fec = VS_LO[p];
    const t = s.view.lsp[r][fec];
    if (!t?.nh) return [];
    const x = coreIfs(r).find((y) => y.peer === t.nh)!;
    return [{ fec, local: ldpLabel(s.os, r, fec), out: t.out, ifn: x.ifn, nh: x.peerIp }];
  });
}
/** The BGP table of a router: a PE's own and imported routes, RR1's everything. */
const tableOf = (s: BvState, r: BvR): BvNlri[] => (isRr(r) ? s.view.rrTable : isPe(r) ? [...s.view.nlris.filter((n) => n.pe === r), ...s.view.imported[r]] : []);

// ---------------------------------------------------------------------------------------------------------------
// IOS XR outputs
// ---------------------------------------------------------------------------------------------------------------
function xrBridgeDomain(s: BvState, r: BvR, detail: boolean): string {
  const bd = s.cfg[r].bd;
  if (!isPe(r) || !bd) return "";
  const acs = bd.acs.map((k) => ({ k, up: !!s.cfg[r].acs[k] }));
  const pws = pwsOf(s, r);
  const up = pws.filter((p) => p.up).length;
  const out = [
    "Legend: pp = Partially Programmed.",
    `Bridge group: ${bd.group}, bridge-domain: ${bd.name}, id: 0, state: up, ShgId: 0, MSTi: 0`,
    "  Aging: 300 s, MAC limit: 64000, Action: none, Notification: syslog",
    "  Filter MAC addresses: 0",
    `  ACs: ${acs.length} (${acs.filter((a) => a.up).length} up), VFIs: ${bd.vfi ? 1 : 0}, PWs: ${pws.length} (${up} up), PBBs: 0 (0 up), VNIs: 0 (0 up)`,
  ];
  const vfiHead = [`    VFI ${bd.name} (${up ? "up" : "down"})`, `      VPN-ID: ${bd.vpnId ?? "not set"}, Auto Discovery: ${bd.ad ? "BGP" : "disabled"}, Signaling Protocol: ${bd.sig ? "BGP" : "not set"}`, `      RD: ${bd.rd ?? "not set"}, RT: ${bd.rt ?? "not set"}, VE-ID: ${bd.veId ?? "not set"}, VE-Range: ${bd.blockSize}`];
  if (!detail) {
    out.push("  List of ACs:", ...acs.map((a) => `    ${xrSub(a.k, true)}, state: ${a.up ? "up" : "unresolved"}, Static MAC addresses: 0`), "  List of Access PWs:", "  List of VFIs:");
    if (bd.vfi) out.push(...vfiHead, ...pws.map((p) => `      Neighbor ${p.ip} ve-id ${p.vePeer}, state: ${p.up ? "up" : "down"}, Static MAC addresses: 0`));
    out.push("  List of Access VFIs:");
    return out.join("\n");
  }
  out.push(`  MTU: ${bd.mtu}`, "  List of ACs:");
  for (const a of acs) {
    const ac = s.cfg[r].acs[a.k];
    out.push(`    AC: ${xrSub(a.k)}, state is ${a.up ? "up" : "unresolved"}`, ...(ac ? ["      Type VLAN; Num Ranges: 1", `      VLAN ranges: ${ac.vlan ? `[${ac.vlan}, ${ac.vlan}]` : "none"}`, `      MTU ${bd.mtu}; XC ID 0x10800${String(bd.acs.indexOf(a.k) + 1).padStart(2, "0")}; interworking none`] : []), "      Split Horizon Group: none");
  }
  out.push("  List of VFIs:");
  if (bd.vfi) {
    out.push(...vfiHead);
    for (const p of pws) {
      const col = (a: string | number, b: string | number) => `${pad(a, 44)}${b}`;
      out.push(
        `      PW: neighbor ${p.ip}, PW ID ${bd.vpnId ?? "-"}, state is ${p.up ? "up ( established )" : "down ( local ready )"}`,
        `        VE-ID local ${p.veLocal}, remote ${p.vePeer}`,
        "        Encapsulation MPLS, protocol BGP",
        `        Source address ${VS_LO[r as VsR]}`,
        "        PW type VPLS, control word disabled, interworking none",
        "",
        `        ${col("MPLS         Local", "Remote")}`,
        "        ------------ ------------------------------ -----------------------------",
        `        ${col(`Label        ${p.local ?? "unassigned"}`, p.remote ? p.remote.label : "unknown")}`,
        `        ${col(`MTU          ${p.mtu}`, p.remote ? p.remote.mtu : "unknown")}`,
        `        ${col("Control word disabled", p.remote ? "disabled" : "unknown")}`,
        "        ------------ ------------------------------ -----------------------------",
        ...(p.up ? [] : [`        Down reason: ${bvWhyText(p, s.os)}`]),
      );
    }
  }
  return out.join("\n");
}
const xrNet = (n: BvNlri) => `${n.veId}:${n.block.vbo}/32`;
function xrBgpHead(r: BvR) {
  return [`BGP router identifier ${BV_LO[r]}, local AS number ${AS}`, "BGP generic scan interval 60 secs", "Non-stop routing is enabled", "BGP table state: Active", "Table ID: 0x0   RD version: 0", "BGP main routing table version 18", "BGP NSR Initial initsync version 2 (Reached)", "BGP scan interval 60 secs", ""];
}
function xrVplsTable(s: BvState, r: BvR): string {
  if (!isPe(r) && !isRr(r)) return "% BGP instance 'default' not active";
  const rows = tableOf(s, r);
  const byRd = new Map<string, BvNlri[]>();
  for (const n of rows) byRd.set(n.rd, [...(byRd.get(n.rd) ?? []), n]);
  const own = isPe(r) ? s.cfg[r].bd?.rd : undefined;
  const lines: string[] = [];
  for (const [rd, ns] of [...byRd.entries()].sort(([a], [b]) => (a === own ? -1 : b === own ? 1 : a.localeCompare(b)))) {
    lines.push(`Route Distinguisher: ${rd}${rd === own ? ` (default for vrf ${s.cfg[r].bd!.group}:${s.cfg[r].bd!.name})` : ""}`);
    for (const n of ns) {
      const local = n.pe === r;
      lines.push(`${local ? "*> " : "*>i"}${pad(xrNet(n), 19)}${pad(local ? "0.0.0.0" : n.nh, 20)}${pad(local ? "nolabel" : n.block.base, 16)}${local ? n.block.base : "nolabel"}`);
    }
  }
  return [...xrBgpHead(r), "Status codes: s suppressed, d damped, h history, * valid, > best", "              i - internal, r RIB-failure, S stale, N Nexthop-discard", "Origin codes: i - IGP, e - EGP, ? - incomplete", "   Network            Next Hop            Rcvd Label      Local Label", ...lines, "", `Processed ${byRd.size} prefixes, ${rows.length} paths`].join("\n");
}
function xrVplsSummary(s: BvState, r: BvR): string {
  if (!isPe(r) && !isRr(r)) return "% BGP instance 'default' not active";
  const peers = isRr(r) ? s.cfg.RR1.rr!.clients.map((c) => ({ ip: c.ip, pe: peOfLo(c.ip) as VsR | undefined })) : s.cfg[r].nbr ? [{ ip: s.cfg[r].nbr!.ip, pe: r as VsR }] : [];
  const rows = peers.map(({ ip, pe }) => {
    const b = pe ? s.view.bgp[pe] : undefined;
    const rx = !b?.l2vpn ? 0 : isRr(r) ? s.view.rrTable.filter((n) => n.pe === pe).length : s.view.received[r].length;
    return `${pad(ip, 16)}${pad(0, 4)}${lpad(AS, 5)}${lpad(b?.up ? 92 : 0, 8)}${lpad(b?.up ? 95 : 0, 8)}${lpad(18, 9)}${lpad(0, 5)}${lpad(0, 5)} ${pad(b?.up ? spAge(s.clock, 25) : "00:00:00", 9)}${b?.up ? lpad(rx, 9) : " Idle"}`;
  });
  return [...xrBgpHead(r), "BGP is operating in STANDALONE mode.", "", "", "Process       RcvTblVer   bRIB/RIB   LabelVer  ImportVer  SendTblVer  StandbyVer", "Speaker              18         18         18         18          18           0", "", "Neighbor        Spk    AS MsgRcvd MsgSent   TblVer  InQ OutQ  Up/Down  St/PfxRcd", ...rows].join("\n");
}
function xrVplsRoute(s: BvState, r: BvR, rd: string, net: string): string {
  const n = tableOf(s, r).find((x) => x.rd === rd && xrNet(x) === net);
  if (!n) return "% Network not in table";
  const local = n.pe === r;
  return [
    `BGP routing table entry for ${net}, Route Distinguisher: ${rd}`,
    "Versions:",
    "  Process           bRIB/RIB  SendTblVer",
    "  Speaker                  18          18",
    `Last Modified: ${spStamp(30).xr} for ${spAge(s.clock, 30)}`,
    "Paths: (1 available, best #1)",
    ...(local ? ["  Advertised to update-groups (with more than one peer):", "    0.2"] : isRr(r) ? ["  Advertised to update-groups (with more than one peer):", "    0.2"] : ["  Not advertised to any peer"]),
    "  Path #1: Received by speaker 0",
    "  Local",
    local ? "    0.0.0.0 from 0.0.0.0 (" + BV_LO[r] + ")" : `    ${n.nh} (metric 30) from ${isRr(r) ? n.nh : BV_LO.RR1} (${n.nh})`,
    `      Origin IGP, localpref 100, valid, ${local ? "redistributed, best, group-best, import-candidate" : `internal, best, group-best, import-candidate${isRr(r) ? "" : ", imported"}`}`,
    "      Received Path ID 0, Local Path ID 1, version 18",
    `      Extended community: RT:${n.rt} L2VPN-MTU:${n.mtu}`,
    ...(!local && !isRr(r) ? [`      Originator: ${n.nh}, Cluster list: ${RR_CLUSTER}`] : []),
    `      Block Size:${n.block.vbs} Label Base:${n.block.base} VE Block Offset:${n.block.vbo}`,
  ].join("\n");
}
const xrMac = (m: string) => m.replace(/:/g, "").replace(/(....)(....)(....)/, "$1.$2.$3");
function xrMacTable(s: BvState, r: BvR): string {
  if (!isPe(r)) return "";
  const rows = s.fdb[r as VsR].map((m) => {
    const p = m.port.startsWith("pw:") ? pwsOf(s, r).find((x) => x.ip === m.port.slice(3)) : undefined;
    const port = m.port.startsWith("pw:") ? `(${m.port.slice(3)}, ${p ? (s.cfg[r].bd?.vpnId ?? 0) : "-"})` : xrSub(m.port, true);
    return `${pad(xrMac(m.mac), 15)}${pad("dynamic", 8)}${pad(port, 28)}${pad("N/A", 11)}${pad(`11 Oct ${spStamp(m.t).hms}`, 23)}N/A`;
  });
  return ["To Resynchronize MAC table from the Network Processors, use the command...", "    l2vpn resynchronize forwarding mac-address-table location <r/s/i>", "", "Mac Address    Type    Learned from/Filtered on    LC learned Resync Age/Last Change Mapped to", "-------------- ------- --------------------------- ---------- ---------------------- --------------", ...rows].join("\n");
}
function xrLdpBrief(s: BvState, r: BvR): string {
  const row = (lo: string) => `${pad(`${lo}:0`, 18)}${pad("Y", 4)}${pad(spAge(s.clock, 20), 10)}${lpad(1, 6)}${lpad(4, 9)}${lpad(1, 7)}${lpad(6, 6)}`;
  const rows = r === "RR1" ? [] : coreIfs(r).filter((x) => s.view.ldp[x.link.id]).map((x) => row(VS_LO[x.peer]));
  return ["Peer              GR  Up Time         Discovery   Addresses     Labels", "                                      ipv4  ipv6  ipv4  ipv6  ipv4   ipv6", "----------------- --  --------------- ----- ----  ----- ----  ------ ----", ...rows].join("\n");
}
function xrForwarding(s: BvState, r: BvR): string {
  if (r === "RR1") return ["Local  Outgoing    Prefix             Outgoing     Next Hop        Bytes", "Label  Label       or ID              Interface                    Switched", "------ ----------- ------------------ ------------ --------------- ------------"].join("\n");
  const rows = transportRows(s, r).map((t) => `${pad(t.local, 7)}${pad(lab(t.out), 12)}${pad(`${t.fec}/32`, 19)}${pad(xrIf(t.ifn, true), 13)}${pad(t.nh, 16)}0`);
  for (const p of pwsOf(s, r).filter((x) => x.up)) rows.push(`${pad(p.local!, 7)}${pad("Pop", 12)}${pad(`PW(${p.ip}:${s.cfg[r].bd?.vpnId ?? 0})`, 19)}${pad("BD=0", 13)}${pad("point2point", 16)}0`);
  rows.sort((a, b) => parseInt(a) - parseInt(b));
  return ["Local  Outgoing    Prefix             Outgoing     Next Hop        Bytes", "Label  Label       or ID              Interface                    Switched", "------ ----------- ------------------ ------------ --------------- ------------", ...rows].join("\n");
}
function xrRouteGlobal(s: BvState, r: BvR): string {
  const num = (ip: string) => ip.split(".").reduce((n, o) => n * 256 + +o, 0);
  const order: BvR[] = [...BV_ROUTERS].sort((a, b) => num(BV_LO[a]) - num(BV_LO[b]));
  const rows = order.map((n) => {
    if (n === r) return `L    ${pad(`${BV_LO[n]}/32`, 18)} is directly connected, ${spAge(s.clock, 30)}, Loopback0`;
    if (r === "RR1" || n === "RR1") {
      // RR1 hangs off P1 (control plane only).
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
function xrLogging(s: BvState, r: BvR): string {
  const lines = s.sys.filter((x) => x.dev === r).slice(-30).map((x) => {
    const st = `RP/0/RP0/CPU0:${spStamp(x.t).xr}`;
    if (x.kind === "ldp-up") return `${st}: mpls_ldp[1159]: %ROUTING-LDP-5-NBR_CHANGE : VRF 'default' (0x60000000), Neighbor ${x.peer}:0 is UP`;
    if (x.kind === "ldp-down") return `${st}: mpls_ldp[1159]: %ROUTING-LDP-5-NBR_CHANGE : VRF 'default' (0x60000000), Neighbor ${x.peer}:0 is DOWN (Interface state down)`;
    if (x.kind === "bgp-up") return `${st}: bgp[1052]: %ROUTING-BGP-5-ADJCHANGE : neighbor ${x.peer} Up (VRF: default) (AS: ${AS})`;
    if (x.kind === "bgp-down") return `${st}: bgp[1052]: %ROUTING-BGP-5-ADJCHANGE : neighbor ${x.peer} Down - Peer closing down the session (VRF: default) (AS: ${AS})`;
    if (x.kind === "pw-up") return `${st}: l2vpn_mgr[1234]: %L2-L2VPN_PW-3-UPDOWN : Pseudowire with address ${x.peer}, id ${s.cfg[r].bd?.vpnId ?? 0}, state is Up`;
    if (x.kind === "pw-down") return `${st}: l2vpn_mgr[1234]: %L2-L2VPN_PW-3-UPDOWN : Pseudowire with address ${x.peer}, id ${s.cfg[r].bd?.vpnId ?? 0}, state is Down`;
    if (x.kind === "clear") return `${st}: l2vpn_mgr[1234]: bridge-domain VPLS-A: MAC addresses cleared by user 'admin'`;
    return `${st}: config[65857]: %MGBL-CONFIG-6-DB_COMMIT : Configuration committed by user 'admin'. Use 'show commit changes ${1000000000 + x.t}' to view the changes.`;
  });
  return ["Syslog logging: enabled (0 messages dropped, 0 flushes, 0 overruns)", `    Buffer logging: level debugging, ${lines.length} messages logged`, "", "Log Buffer (2097152 bytes):", "", ...lines].join("\n");
}

// ---------------------------------------------------------------------------------------------------------------
// Junos outputs
// ---------------------------------------------------------------------------------------------------------------
const JN_LEGEND = [
  "Layer-2 VPN connections:",
  "",
  "Legend for connection status (St)",
  "EI -- encapsulation invalid      NC -- interface encapsulation not CCC/TCC/VPLS",
  "EM -- encapsulation mismatch     WE -- interface and instance encaps not same",
  "VC-Dn -- Virtual circuit down    NP -- interface hardware not present",
  "CM -- control-word mismatch      -> -- only outbound connection is up",
  "CN -- circuit not provisioned    <- -- only inbound connection is up",
  "OR -- out of range               Up -- operational",
  "OL -- no outgoing label          Dn -- down",
  "LD -- local site signaled down   CF -- call admission control failure",
  "RD -- remote site signaled down  SC -- local and remote site ID collision",
  "LN -- local site not designated  LM -- local site ID not minimum designated",
  "RN -- remote site not designated RM -- remote site ID not minimum designated",
  "XX -- unknown connection status  IL -- no incoming label",
  "MM -- MTU mismatch               MI -- Mesh-Group ID not available",
  "",
  "Legend for interface status",
  "Up -- operational",
  "Dn -- down",
];
const lsi = (p: BvPw) => `lsi.10488${String(30 + BV_PES.indexOf(p.peer)).padStart(2, "0")}`;
const jnSt = (p: BvPw) => (p.up ? "Up" : p.why === "collision" ? "SC" : p.why === "notdesignated" ? "RN" : p.why === "mtu" ? "MM" : p.why === "nolsp" ? "VC-Dn" : p.why === "remotedown" ? "RD" : "OL");
function jnConnections(s: BvState, r: BvR): string {
  const bd = s.cfg[r].bd;
  if (!isPe(r) || !bd) return "";
  const out = [...JN_LEGEND, `Instance: ${bd.name}`, "  Edge protection: Not-Primary", `  Local site: ${bd.site ?? "?"} (${bd.veId ?? "?"})`, "    connection-site           Type  St     Time last up          # Up trans"];
  for (const p of pwsOf(s, r)) {
    const ups = s.sys.filter((x) => x.dev === r && x.kind === "pw-up" && x.peer === p.ip);
    out.push(`    ${pad(String(p.vePeer), 26)}${pad("rmt", 6)}${pad(jnSt(p), 7)}${pad(p.up ? `${spStamp(ups.at(-1)?.t ?? 32).junos} 2026` : "-----", 22)}${lpad(ups.length, 10)}`);
    out.push(`      Remote PE: ${p.ip}, Negotiated control-word: No`);
    out.push(`      Incoming label: ${p.local ?? ""}, Outgoing label: ${p.remote?.label ?? ""}`.trimEnd());
    if (p.up) out.push(`      Local interface: ${lsi(p)}, Status: Up, Encapsulation: VPLS`, `        Description: Intf - vpls ${bd.name} local site ${p.veLocal} remote site ${p.vePeer}`);
  }
  return out.join("\n");
}
const jnNet = (n: BvNlri) => `${n.rd}:${n.veId}:${n.block.vbo}/96`;
function jnL2vpnTable(s: BvState, r: BvR, detail: boolean): string {
  if (!isPe(r) && !isRr(r)) return "";
  const rows = isRr(r) ? s.view.rrTable : s.view.imported[r];
  const lines = rows.flatMap((n) => {
    const t = isPe(r) ? s.view.lsp[r as VsR][n.nh] : undefined;
    const push = t?.out !== undefined && t.out !== IMPLICIT_NULL ? `, Push ${t.out}` : "";
    const nh = isPe(r) ? coreIfs(r as VsR)[0] : undefined;
    if (!detail) return [jnNet(n), `                   *[BGP/170] ${spAge(s.clock, 25)}, localpref 100, from ${isRr(r) ? n.nh : BV_LO.RR1}`, "                      AS path: I, validation-state: unverified", isRr(r) ? "                       Indirect" : `                    >  to ${nh!.peerIp} via ${jnIf(nh!.ifn)}${push}`];
    return [`${jnNet(n)} (1 entry, 0 announced)`, "        *BGP    Preference: 170/-101", `                Route Distinguisher: ${n.rd}`, "                Next hop type: Indirect", `                Source: ${isRr(r) ? n.nh : BV_LO.RR1}`, `                Protocol next hop: ${n.nh}`, "                State: <Active Int Ext>", `                Local AS: ${AS} Peer AS: ${AS}`, `                Age: ${spAge(s.clock, 25)}`, `                Communities: target:${n.rt} Layer2-info: encaps: VPLS, control flags:, mtu: ${n.mtu}, site preference: 100`, `                Label-base: ${n.block.base}, range: ${n.block.vbs}, status-vector: 0x0`, ...(isRr(r) ? [] : [`                Cluster list:  ${RR_CLUSTER}`, `                Originator ID: ${n.nh}`]), "                Import Accepted", `                Localpref: 100`, `                Router ID: ${isRr(r) ? n.nh : BV_LO.RR1}`];
  });
  return [`bgp.l2vpn.0: ${rows.length} destinations, ${rows.length} routes (${rows.length} active, 0 holddown, 0 hidden)`, ...(rows.length ? ["+ = Active Route, - = Last Active, * = Both", "", ...lines] : [])].join("\n");
}
function jnBgpSum(s: BvState, r: BvR): string {
  if (!isPe(r) && !isRr(r)) return "BGP is not running";
  const peers = isRr(r) ? s.cfg.RR1.rr!.clients.map((c) => ({ ip: c.ip, pe: peOfLo(c.ip) as VsR })) : s.cfg[r].nbr ? [{ ip: s.cfg[r].nbr!.ip, pe: r as VsR }] : [];
  const tot = isRr(r) ? s.view.rrTable.length : s.view.received[r].length;
  const rows = peers.flatMap(({ ip, pe }) => {
    const b = s.view.bgp[pe];
    const rx = !b?.l2vpn ? 0 : isRr(r) ? s.view.rrTable.filter((n) => n.pe === pe).length : s.view.received[r].length;
    const acc = isRr(r) ? rx : s.view.imported[r].length;
    return [`${pad(ip, 21)}${lpad(AS, 6)}${lpad(b?.up ? 92 : 0, 11)}${lpad(b?.up ? 95 : 0, 11)}${lpad(0, 8)}${lpad(0, 8)} ${lpad(b?.up ? spAge(s.clock, 25).replace(/^00:/, "") : "1:00", 11)} ${b?.up ? "Establ" : "Active"}`, ...(b?.up ? (b.l2vpn ? [`  bgp.l2vpn.0: ${acc}/${rx}/${rx}/0`] : ["  inet.0: 0/0/0/0"]) : [])];
  });
  return ["Threading mode: BGP I/O", `Groups: 1 Peers: ${peers.length} Down peers: ${peers.filter((p) => !s.view.bgp[p.pe]?.up).length}`, "Table          Tot Paths  Act Paths Suppressed    History Damp State    Pending", "bgp.l2vpn.0", `${lpad(tot, 23)}${lpad(tot, 11)}${lpad(0, 11)}${lpad(0, 11)}${lpad(0, 11)}${lpad(0, 11)}`, "Peer                     AS      InPkt     OutPkt    OutQ   Flaps Last Up/Dwn State|#Active/Received/Accepted/Damped...", ...rows].join("\n");
}
function jnMacTable(s: BvState, r: BvR): string {
  const bd = s.cfg[r].bd;
  if (!isPe(r) || !bd) return "";
  const rows = s.fdb[r as VsR].map((m) => {
    const p = m.port.startsWith("pw:") ? pwsOf(s, r).find((x) => x.ip === m.port.slice(3)) : undefined;
    return `   ${pad(m.mac, 20)}${pad("D", 9)}${m.port.startsWith("pw:") ? (p ? lsi(p) : "lsi.?") : m.port}`;
  });
  return ["", "MAC flags       (S -static MAC, D -dynamic MAC, L -locally learned, C -Control MAC", "    O -OVSDB MAC, SE -Statistics enabled, NM -Non configured MAC, R -Remote PE MAC, P -Pinned MAC)", "", `Routing instance : ${bd.name}`, ` Bridging domain : __${bd.name}__, VLAN : NA`, "   MAC                 MAC      Logical          NH     MAC         active", "   address             flags    interface        Index  property    source", ...rows].join("\n");
}
function jnLdpSession(s: BvState, r: BvR): string {
  const rows = r === "RR1" ? [] : coreIfs(r).filter((x) => s.view.ldp[x.link.id]).map((x) => `${pad(VS_LO[x.peer], 21)}${pad("Operational", 14)}${pad("Open", 13)}${lpad(28, 5)}         DU`);
  return ["  Address              State        Connection  Hold time  Adv. Mode", ...rows].join("\n");
}
function jnInet3(s: BvState, r: BvR): string {
  const rows = r === "RR1" ? [] : transportRows(s, r).filter((t) => t.out !== undefined).map((t) => [`${pad(`${t.fec}/32`, 19)}*[LDP/9] ${spAge(s.clock, 20)}, metric 1`, `                    >  to ${t.nh} via ${jnIf(t.ifn)}${t.out === IMPLICIT_NULL ? "" : `, Push ${t.out}`}`]);
  const n = rows.length;
  return [`inet.3: ${n} destinations, ${n} routes (${n} active, 0 holddown, 0 hidden)`, ...(n ? ["+ = Active Route, - = Last Active, * = Both", "", ...rows.flat()] : [])].join("\n");
}
function jnMpls0(s: BvState, r: BvR): string {
  const rows: string[][] = [["0                  *[MPLS/0] 01:00:00, metric 1", "                       to table inet.0"]];
  if (r !== "RR1") for (const t of transportRows(s, r).filter((x) => x.out !== undefined)) rows.push([`${pad(t.local, 19)}*[LDP/9] ${spAge(s.clock, 20)}, metric 1`, `                    >  to ${t.nh} via ${jnIf(t.ifn)}, ${t.out === IMPLICIT_NULL ? "Pop" : `Swap ${t.out}`}`]);
  for (const p of pwsOf(s, r).filter((x) => x.up)) rows.push([`${pad(p.local!, 19)}*[VPLS/7] ${spAge(s.clock, 32)}`, `                    >  via ${lsi(p)}, Pop`]);
  rows.sort((a, b) => parseInt(a[0]) - parseInt(b[0]));
  return [`mpls.0: ${rows.length} destinations, ${rows.length} routes (${rows.length} active, 0 holddown, 0 hidden)`, "+ = Active Route, - = Last Active, * = Both", "", ...rows.flat()].join("\n");
}
function jnLog(s: BvState, r: BvR): string {
  return s.sys.filter((x) => x.dev === r).slice(-30).map((x) => {
    const st = `${spStamp(x.t).junos}  ${r}`;
    if (x.kind === "ldp-up") return `${st} rpd[1532]: RPD_LDP_NBRUP: LDP neighbor ${x.peer} (${x.peer}) is up`;
    if (x.kind === "ldp-down") return `${st} rpd[1532]: RPD_LDP_NBRDOWN: LDP neighbor ${x.peer} (${x.peer}) is down`;
    if (x.kind === "bgp-up") return `${st} rpd[1532]: BGP_PEER_STATE_CHANGE: BGP peer ${x.peer} (Internal AS ${AS}) changed state from OpenConfirm to Established (event RecvKeepAlive)`;
    if (x.kind === "bgp-down") return `${st} rpd[1532]: BGP_PEER_STATE_CHANGE: BGP peer ${x.peer} (Internal AS ${AS}) changed state from Established to Idle (event RecvNotify)`;
    if (x.kind === "pw-up") return `${st} rpd[1532]: RPD_VPLS_INTF_UP: VPLS-A: VPLS interface to remote site ${x.ve} (${x.peer}) is up`;
    if (x.kind === "pw-down") return `${st} rpd[1532]: RPD_VPLS_INTF_DOWN: VPLS-A: VPLS interface to remote site ${x.ve} (${x.peer}) is down`;
    if (x.kind === "clear") return `${st} mgd[4417]: UI_CMDLINE_READ_LINE: User 'admin', command 'clear vpls mac-table instance VPLS-A'`;
    return `${st} mgd[4417]: UI_COMMIT: User 'admin' requested 'commit' operation (comment: none)`;
  }).join("\n");
}

// ---------------------------------------------------------------------------------------------------------------
// Configuration as each OS prints it
// ---------------------------------------------------------------------------------------------------------------
export function bvXrLines(r: BvR, c: BvCfg): string[] {
  const out: string[] = [`hostname ${r}`, "!", "interface Loopback0", ` ipv4 address ${BV_LO[r]} 255.255.255.255`, "!"];
  if (r === "RR1") out.push("interface GigabitEthernet0/0/0/0", " description to P1", " ipv4 address 192.0.2.11 255.255.255.254", "!");
  else for (const x of coreIfs(r)) out.push(`interface ${xrIf(x.ifn)}`, ` description to ${x.peer}`, ` ipv4 address ${x.ip} 255.255.255.254`, "!");
  if (r === "P1") out.push("interface GigabitEthernet0/0/0/3", " description to RR1", " ipv4 address 192.0.2.10 255.255.255.254", "!");
  for (const x of ceOf(r)) out.push(`interface ${xrIf(x.ifn)}`, ` description to ${x.ce}`, "!");
  for (const [k, ac] of Object.entries(c.acs).sort(([a], [b]) => a.localeCompare(b))) out.push(`interface ${xrSub(k)} l2transport`, ...(ac.vlan ? [` encapsulation dot1q ${ac.vlan}`] : []), "!");
  out.push("router isis CORE", ` net 49.0001.0000.0000.000${BV_ROUTERS.indexOf(r) + 1}.00`, " address-family ipv4 unicast", "  metric-style wide", " !", "!");
  if (isPe(r) || isRr(r)) {
    out.push(`router bgp ${AS}`, ` bgp router-id ${BV_LO[r]}`, " address-family l2vpn vpls-vpws", " !");
    const nbrs = isRr(r) ? (c.rr?.clients ?? []).map((x) => ({ ip: x.ip, l2vpn: x.l2vpn, client: x.client })) : c.nbr ? [{ ip: c.nbr.ip, l2vpn: c.nbr.l2vpn, client: false }] : [];
    for (const n of nbrs) out.push(` neighbor ${n.ip}`, `  remote-as ${AS}`, "  update-source Loopback0", ...(n.l2vpn ? ["  address-family l2vpn vpls-vpws", ...(n.client ? ["   route-reflector-client"] : []), "  !"] : []), " !");
    out.push("!");
  }
  const bd = c.bd;
  if (bd) {
    out.push("l2vpn", ` bridge group ${bd.group}`, `  bridge-domain ${bd.name}`, ...(bd.mtu !== 1500 ? [`   mtu ${bd.mtu}`] : []));
    for (const k of bd.acs) out.push(`   interface ${xrSub(k)}`, "   !");
    if (bd.vfi) {
      out.push(`   vfi ${bd.name}`, ...(bd.vpnId !== undefined ? [`    vpn-id ${bd.vpnId}`] : []));
      if (bd.ad) {
        out.push("    autodiscovery bgp", ...(bd.rd ? [`     rd ${bd.rd}`] : []), ...(bd.rt ? [`     route-target ${bd.rt}`] : []));
        if (bd.sig) out.push("     signaling-protocol bgp", ...(bd.veId !== undefined ? [`      ve-id ${bd.veId}`] : []), ...(bd.blockSize !== 10 ? [`      ve-range ${bd.blockSize}`] : []), "     !");
        out.push("    !");
      }
      out.push("   !");
    }
    out.push("  !", " !", "!");
  }
  if (r !== "RR1") out.push("mpls ldp", ` router-id ${BV_LO[r]}`, ...coreIfs(r).filter((x) => c.ldp[x.ifn]).flatMap((x) => [` interface ${xrIf(x.ifn)}`, " !"]), "!");
  return out;
}
export function bvJnStmts(r: BvR, c: BvCfg): JStmt[] {
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
      if (ac.vpls) out.push({ path: u, leaf: "encapsulation vlan-vpls" });
      if (ac.vlan) out.push({ path: u, leaf: `vlan-id ${ac.vlan}` });
      if (!ac.vpls && !ac.vlan) out.push({ path: u, leaf: "" });
    }
  }
  out.push({ path: ["interfaces", "lo0", "unit 0", "family inet"], leaf: `address ${BV_LO[r]}/32` }, { path: ["routing-options"], leaf: `router-id ${BV_LO[r]}` }, { path: ["routing-options"], leaf: `autonomous-system ${AS}` });
  if (isPe(r) && c.nbr) {
    const g = ["protocols", "bgp", "group RR"];
    out.push({ path: g, leaf: "type internal" }, { path: g, leaf: `local-address ${BV_LO[r]}` });
    if (c.nbr.l2vpn) out.push({ path: [...g, "family l2vpn"], leaf: "signaling" });
    out.push({ path: g, leaf: `neighbor ${c.nbr.ip}` });
  }
  if (isRr(r) && c.rr) {
    const g = ["protocols", "bgp", "group CLIENTS"];
    out.push({ path: g, leaf: "type internal" }, { path: g, leaf: `local-address ${BV_LO.RR1}` });
    if (c.rr.clients.some((x) => x.client)) out.push({ path: g, leaf: `cluster ${RR_CLUSTER}` });
    if (c.rr.clients.some((x) => x.l2vpn)) out.push({ path: [...g, "family l2vpn"], leaf: "signaling" });
    for (const x of c.rr.clients) out.push({ path: g, leaf: `neighbor ${x.ip}` });
  }
  if (r !== "RR1") {
    for (const x of coreIfs(r)) out.push({ path: ["protocols", "mpls", `interface ${jnIf(x.ifn)}`], leaf: "" });
    for (const x of coreIfs(r).filter((y) => c.ldp[y.ifn])) out.push({ path: ["protocols", "ldp", `interface ${jnIf(x.ifn)}`], leaf: "" });
  }
  const bd = c.bd;
  if (bd) {
    const p = ["routing-instances", bd.name];
    out.push({ path: p, leaf: "instance-type vpls" });
    for (const k of bd.acs) out.push({ path: p, leaf: `interface ${k}` });
    if (bd.rd) out.push({ path: p, leaf: `route-distinguisher ${bd.rd}` });
    if (bd.rt) out.push({ path: p, leaf: `vrf-target target:${bd.rt}` });
    const v = [...p, "protocols", "vpls"];
    out.push({ path: v, leaf: "no-tunnel-services" });
    if (bd.blockSize !== 8) out.push({ path: v, leaf: `label-block-size ${bd.blockSize}` });
    if (bd.mtu !== 1500) out.push({ path: v, leaf: `mtu ${bd.mtu}` });
    if (bd.site) out.push({ path: [...v, `site ${bd.site}`], leaf: bd.veId !== undefined ? `site-identifier ${bd.veId}` : "" });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Configuration statements
// ---------------------------------------------------------------------------------------------------------------
const peOnly = "% Bridge domains live on the PEs.";
function stmts(r: BvR, s: BvState): SpCfgStmt<BvCfg>[] {
  const pe = isPe(r);
  const rr = isRr(r);
  const os = s.os;
  const subX = subArg(s, r, false);
  const subJ = subArg(s, r, true);
  const pifX = pifArg(r, false);
  const pifJ = pifArg(r, true);
  const bdName = nameArg([s.cfg[r].bd?.name ?? "VPLS-A"], "Bridge-domain / instance name");
  const grp = nameArg([s.cfg[r].bd?.group || "CUST-A"], "Bridge group name");
  const siteArg = nameArg([s.cfg[r].bd?.site ?? (pe ? ceIfs(r as VsR)[0].ce : "SITE")], "Site name");
  const ac = (c: BvCfg, k: string) => (c.acs[k] ??= { vpls: false });
  const newBd = (group: string, name: string): BvBd => ({ group, name, acs: [], vfi: false, ad: false, sig: false, blockSize: defaultBlock(os), mtu: 1500 });
  const bdOf = (c: BvCfg) => c.bd;
  const jbd = (c: BvCfg, v: string) => {
    if (!c.bd || c.bd.name !== v) c.bd = { ...newBd("", v), vfi: true, ad: true, sig: true };
    return c.bd;
  };
  const rrClient = (c: BvCfg, ip: string) => {
    c.rr ??= { clients: [] };
    let x = c.rr.clients.find((y) => y.ip === ip);
    if (!x) c.rr.clients.push((x = { ip, l2vpn: false, client: false }));
    return x;
  };
  // Statements whose arguments only exist on a PE (attachment circuits) or on a core router (LDP interfaces).
  const peOnlyIds = ["sub", "bd-if", "j-enc", "j-vlan", "j-unit", "j-if"];
  const coreIds = ["ldp-if", "j-ldp"];
  const all: SpCfgStmt<BvCfg>[] = [
    // ---------------------------------------------------------------- IOS XR
    { id: "sub", summary: "Configure an attachment-circuit sub-interface", args: { sif: subX, l2: choiceArg(["l2transport"], () => "Layer 2 transport (an attachment circuit)") }, xr: { mode: "config", syntax: "interface <sif> <l2>", enter: "subif", apply: (c, a) => (pe ? ((ac(c, a.sif).vpls = true), c) : peOnly), no: (c, a) => (delete c.acs[a.sif], c) } },
    { id: "sub-enc", summary: "The VLAN this attachment circuit accepts", args: { vlan: vlanArg }, xr: { mode: "subif", syntax: "encapsulation dot1q <vlan>", noSyntax: "encapsulation", apply: (c, a, x) => ((ac(c, x.sif).vlan = +a.vlan), c), no: (c, _a, x) => ((ac(c, x.sif).vlan = undefined), c) } },
    { id: "l2vpn", summary: "Layer 2 VPN services", xr: { mode: "config", syntax: "l2vpn", enter: "l2vpn", apply: (c) => (pe ? c : peOnly) } },
    { id: "bg", summary: "A bridge group", args: { g: grp }, xr: { mode: "l2vpn", syntax: "bridge group <g>", enter: "bg", apply: (c) => c, no: (c, a) => (c.bd?.group === a.g && (c.bd = undefined), c) } },
    { id: "bd", summary: "A bridge domain (the VPLS bridge on this PE)", args: { n: bdName }, xr: { mode: "bg", syntax: "bridge-domain <n>", enter: "bd", apply: (c, a, x) => (c.bd && c.bd.name !== a.n ? "!!% This lab's PEs carry one bridge domain; remove the existing one first." : ((c.bd ??= newBd(x.g, a.n)), c)), no: (c, a) => (c.bd?.name === a.n && (c.bd = undefined), c) } },
    { id: "bd-mtu", summary: "MTU carried in the VPLS routes (layer-2 info)", args: { m: numArg(64, 65535, ["1500", "9000"], "MTU") }, xr: { mode: "bd", syntax: "mtu <m>", noSyntax: "mtu", apply: (c, a) => (bdOf(c) && (bdOf(c)!.mtu = +a.m), c), no: (c) => (bdOf(c) && (bdOf(c)!.mtu = 1500), c) } },
    { id: "bd-if", summary: "An attachment circuit of the bridge domain", args: { sif: subX }, xr: { mode: "bd", syntax: "interface <sif>", enter: "bd-ac", apply: (c, a) => { const b = bdOf(c); if (b && !b.acs.includes(a.sif)) b.acs.push(a.sif); return c; }, no: (c, a) => { const b = bdOf(c); if (b) b.acs = b.acs.filter((k) => k !== a.sif); return c; } } },
    { id: "vfi", summary: "The VFI: the bridge domain's pseudowires", args: { vn: bdName }, xr: { mode: "bd", syntax: "vfi <vn>", enter: "vfi", apply: (c) => (bdOf(c) && (bdOf(c)!.vfi = true), c), no: (c) => (bdOf(c) && Object.assign(bdOf(c)!, { vfi: false, ad: false, sig: false }), c) } },
    { id: "vfi-vpn", summary: "The VPN ID of the VPLS", args: { id: numArg(1, 4294967295, ["100"], "VPN ID") }, xr: { mode: "vfi", syntax: "vpn-id <id>", noSyntax: "vpn-id", apply: (c, a) => (bdOf(c) && (bdOf(c)!.vpnId = +a.id), c), no: (c) => (bdOf(c) && (bdOf(c)!.vpnId = undefined), c) } },
    { id: "vfi-ad", summary: "Discover the other PEs with BGP", xr: { mode: "vfi", syntax: "autodiscovery bgp", enter: "ad", apply: (c) => (bdOf(c) && (bdOf(c)!.ad = true), c), no: (c) => (bdOf(c) && Object.assign(bdOf(c)!, { ad: false, sig: false }), c) } },
    { id: "ad-rd", summary: "Route distinguisher of this PE's VPLS routes", args: { rd: rdArg }, xr: { mode: "ad", syntax: "rd <rd>", noSyntax: "rd", apply: (c, a) => (bdOf(c) && (bdOf(c)!.rd = a.rd), c), no: (c) => (bdOf(c) && (bdOf(c)!.rd = undefined), c) } },
    { id: "ad-rt", summary: "Route target (import and export)", args: { rt: rtArg }, xr: { mode: "ad", syntax: "route-target <rt>", noSyntax: "route-target", apply: (c, a) => (bdOf(c) && (bdOf(c)!.rt = a.rt), c), no: (c) => (bdOf(c) && (bdOf(c)!.rt = undefined), c) } },
    { id: "ad-sig", summary: "Signal the pseudowires with BGP (label blocks)", xr: { mode: "ad", syntax: "signaling-protocol bgp", enter: "sig", apply: (c) => (bdOf(c) && (bdOf(c)!.sig = true), c), no: (c) => (bdOf(c) && (bdOf(c)!.sig = false), c) } },
    { id: "sig-ve", summary: "This PE's VE ID (unique in the VPLS)", args: { ve: veArg }, xr: { mode: "sig", syntax: "ve-id <ve>", noSyntax: "ve-id", apply: (c, a) => (bdOf(c) && (bdOf(c)!.veId = +a.ve), c), no: (c) => (bdOf(c) && (bdOf(c)!.veId = undefined), c) } },
    { id: "sig-range", summary: "Label block size (VE range)", args: { n: numArg(11, 100, ["11", "20"], "VE range") }, xr: { mode: "sig", syntax: "ve-range <n>", noSyntax: "ve-range", apply: (c, a) => (bdOf(c) && (bdOf(c)!.blockSize = +a.n), c), no: (c) => (bdOf(c) && (bdOf(c)!.blockSize = 10), c) } },
    { id: "bgp", summary: "BGP", args: { as: asArg }, xr: { mode: "config", syntax: "router bgp <as>", enter: "bgp", apply: (c) => (pe || rr ? c : "% BGP runs on the PEs and RR1 only; the P routers are BGP-free.") } },
    { id: "bgp-af", summary: "Enable the L2VPN VPLS family on this router", xr: { mode: "bgp", syntax: "address-family l2vpn vpls-vpws", enter: "bgp-af", apply: (c) => c } },
    { id: "nbr", summary: rr ? "A route-reflector client" : "The iBGP neighbor (the route reflector)", args: { ip: nbrArg(r) }, xr: { mode: "bgp", syntax: "neighbor <ip>", enter: "nbr", apply: (c, a) => (rr ? (rrClient(c, a.ip), c) : ((c.nbr ??= { ip: a.ip, l2vpn: false }), (c.nbr.ip = a.ip), c)), no: (c, a) => (rr ? (c.rr && (c.rr.clients = c.rr.clients.filter((y) => y.ip !== a.ip)), c) : ((c.nbr = undefined), c)) } },
    { id: "nbr-ras", summary: "Neighbor AS", args: { as: asArg }, xr: { mode: "nbr", syntax: "remote-as <as>", apply: (c) => c } },
    { id: "nbr-upd", summary: "Source of the session", args: { lo: choiceArg(["Loopback0"], () => "Loopback interface") }, xr: { mode: "nbr", syntax: "update-source <lo>", apply: (c) => c } },
    { id: "nbr-af", summary: "Exchange L2VPN VPLS routes with this neighbor", xr: { mode: "nbr", syntax: "address-family l2vpn vpls-vpws", enter: "nbr-af", apply: (c, _a, x) => (rr ? (rrClient(c, x.ip).l2vpn = true) : c.nbr && (c.nbr.l2vpn = true), c), no: (c, _a, x) => (rr ? Object.assign(rrClient(c, x.ip), { l2vpn: false, client: false }) : c.nbr && (c.nbr.l2vpn = false), c) } },
    { id: "nbr-rrc", summary: "Reflect routes to and from this neighbor", xr: { mode: "nbr-af", syntax: "route-reflector-client", apply: (c, _a, x) => (rr ? ((rrClient(c, x.ip).client = true), c) : "!!% Only the route reflector has route-reflector clients in this lab."), no: (c, _a, x) => (rr && (rrClient(c, x.ip).client = false), c) } },
    { id: "ldp", summary: "MPLS LDP", xr: { mode: "config", syntax: "mpls ldp", enter: "ldp", apply: (c) => (rr ? "% RR1 is in the control plane only: no LDP." : c) } },
    { id: "ldp-if", summary: "Run LDP on the interface", args: { pif: pifX }, xr: { mode: "ldp", syntax: "interface <pif>", enter: "ldp-if", apply: (c, a) => ((c.ldp[a.pif as IfName] = true), c), no: (c, a) => ((c.ldp[a.pif as IfName] = false), c) } },

    // ---------------------------------------------------------------- Junos
    { id: "j-enc", summary: "The unit carries VPLS (VLAN VPLS encapsulation)", args: { p: portArg(r), u: vlanArg, e: choiceArg(["vlan-vpls"], () => "VLAN VPLS encapsulation") }, junos: { syntax: "interfaces <p> unit <u> encapsulation <e>", set: (c, a) => (pe ? ((ac(c, acKey(a.p, +a.u)).vpls = true), c) : `error: ${peOnly.slice(2)}`), del: (c, a) => (c.acs[acKey(a.p, +a.u)] && (c.acs[acKey(a.p, +a.u)].vpls = false), c) } },
    { id: "j-vlan", summary: "The VLAN this unit accepts", args: { p: portArg(r), u: vlanArg, vlan: vlanArg }, junos: { syntax: "interfaces <p> unit <u> vlan-id <vlan>", set: (c, a) => (pe ? ((ac(c, acKey(a.p, +a.u)).vlan = +a.vlan), c) : `error: ${peOnly.slice(2)}`), del: (c, a) => (c.acs[acKey(a.p, +a.u)] && (c.acs[acKey(a.p, +a.u)].vlan = undefined), c) } },
    { id: "j-unit", summary: "A logical unit (delete removes it)", args: { p: portArg(r), u: vlanArg }, junos: { syntax: "interfaces <p> unit <u>", del: (c, a) => (delete c.acs[acKey(a.p, +a.u)], c) } },
    { id: "j-type", summary: "The instance type", args: { v: bdName, t: choiceArg(["vpls"], () => "Virtual private LAN service instance") }, junos: { syntax: "routing-instances <v> instance-type <t>", set: (c, a) => (pe ? (jbd(c, a.v), c) : `error: ${peOnly.slice(2)}`), del: (c) => c } },
    { id: "j-ri", summary: "The VPLS instance (delete removes it)", args: { v: bdName }, junos: { syntax: "routing-instances <v>", del: (c, a) => (c.bd?.name === a.v && (c.bd = undefined), c) } },
    { id: "j-if", summary: "An attachment circuit of the instance", args: { v: bdName, sif: subJ }, junos: { syntax: "routing-instances <v> interface <sif>", set: (c, a) => { const b = jbd(c, a.v); if (!b.acs.includes(a.sif)) b.acs.push(a.sif); return c; }, del: (c, a) => { if (c.bd) c.bd.acs = c.bd.acs.filter((k) => k !== a.sif); return c; } } },
    { id: "j-rd", summary: "Route distinguisher", args: { v: bdName, rd: rdArg }, junos: { syntax: "routing-instances <v> route-distinguisher <rd>", set: (c, a) => ((jbd(c, a.v).rd = a.rd), c), del: (c) => (c.bd && (c.bd.rd = undefined), c) } },
    { id: "j-vt", summary: "Route target (import and export)", args: { v: bdName, rt: jrtArg }, junos: { syntax: "routing-instances <v> vrf-target <rt>", set: (c, a) => ((jbd(c, a.v).rt = a.rt), c), del: (c) => (c.bd && (c.bd.rt = undefined), c) } },
    { id: "j-site", summary: "This PE's site and its site identifier (the VE ID)", args: { v: bdName, site: siteArg, ve: veArg }, junos: { syntax: "routing-instances <v> protocols vpls site <site> site-identifier <ve>", set: (c, a) => (Object.assign(jbd(c, a.v), { site: a.site, veId: +a.ve }), c), del: (c) => (c.bd && (c.bd.veId = undefined), c) } },
    { id: "j-site-all", summary: "The site (delete removes it)", args: { v: bdName, site: siteArg }, junos: { syntax: "routing-instances <v> protocols vpls site <site>", del: (c) => (c.bd && Object.assign(c.bd, { site: undefined, veId: undefined }), c) } },
    { id: "j-lbs", summary: "Label block size", args: { v: bdName, n: choiceArg(["2", "4", "8", "16"], () => "Labels per block") }, junos: { syntax: "routing-instances <v> protocols vpls label-block-size <n>", set: (c, a) => ((jbd(c, a.v).blockSize = +a.n), c), del: (c) => (c.bd && (c.bd.blockSize = 8), c) } },
    { id: "j-mtu", summary: "MTU carried in the VPLS routes", args: { v: bdName, m: numArg(64, 65535, ["1500", "9000"], "MTU") }, junos: { syntax: "routing-instances <v> protocols vpls mtu <m>", set: (c, a) => ((jbd(c, a.v).mtu = +a.m), c), del: (c) => (c.bd && (c.bd.mtu = 1500), c) } },
    { id: "j-mtu-all", summary: "The MTU (delete returns to the default)", args: { v: bdName }, junos: { syntax: "routing-instances <v> protocols vpls mtu", del: (c) => (c.bd && (c.bd.mtu = 1500), c) } },
    { id: "j-nts", summary: "Use label-switched interfaces instead of a tunnel PIC", args: { v: bdName }, junos: { syntax: "routing-instances <v> protocols vpls no-tunnel-services", set: (c, a) => (jbd(c, a.v), c), del: (c) => c } },
    { id: "j-nbr", summary: rr ? "A client of the route reflector" : "The iBGP neighbor (the route reflector)", args: { g: nameArg([rr ? "CLIENTS" : "RR"], "BGP group"), ip: nbrArg(r) }, junos: { syntax: "protocols bgp group <g> neighbor <ip>", set: (c, a) => (rr ? (Object.assign(rrClient(c, a.ip), { l2vpn: !!c.rr?.clients.some((y) => y.l2vpn) || false, client: !!c.rr?.clients.some((y) => y.client) }), c) : pe ? ((c.nbr ??= { ip: a.ip, l2vpn: false }), (c.nbr.ip = a.ip), c) : "error: BGP runs on the PEs and RR1 only"), del: (c, a) => (rr ? (c.rr && (c.rr.clients = c.rr.clients.filter((y) => y.ip !== a.ip)), c) : ((c.nbr = undefined), c)) } },
    { id: "j-fam", summary: "Exchange L2VPN VPLS routes", args: { g: nameArg([rr ? "CLIENTS" : "RR"], "BGP group"), s: choiceArg(["signaling"], () => "BGP-signaled VPLS / L2VPN") }, junos: { syntax: "protocols bgp group <g> family l2vpn <s>", set: (c) => (rr ? (c.rr?.clients.forEach((y) => (y.l2vpn = true)), c) : (c.nbr && (c.nbr.l2vpn = true), c)), del: (c) => (rr ? (c.rr?.clients.forEach((y) => (y.l2vpn = false)), c) : (c.nbr && (c.nbr.l2vpn = false), c)) } },
    { id: "j-cluster", summary: "Make this group's neighbors route-reflector clients", args: { g: nameArg(["CLIENTS"], "BGP group"), id: choiceArg([RR_CLUSTER], () => "Cluster ID") }, junos: { syntax: "protocols bgp group <g> cluster <id>", set: (c) => (rr ? (c.rr?.clients.forEach((y) => (y.client = true)), c) : "error: only the route reflector has clients in this lab"), del: (c) => (c.rr?.clients.forEach((y) => (y.client = false)), c) } },
    { id: "j-ldp", summary: "Run LDP on the interface", args: { pif: pifJ }, junos: { syntax: "protocols ldp interface <pif>", set: (c, a) => ((c.ldp[a.pif as IfName] = true), c), del: (c, a) => ((c.ldp[a.pif as IfName] = false), c) } },
  ];
  return all.filter((x) => (pe || !peOnlyIds.includes(x.id)) && (!rr || !coreIds.includes(x.id)));
}

// ---------------------------------------------------------------------------------------------------------------
// Command sets
// ---------------------------------------------------------------------------------------------------------------
export function bvValidate(c: BvCfg, junos: boolean): string | undefined {
  if (junos && c.bd) {
    const bad = c.bd.acs.find((k) => c.acs[k] && !c.acs[k].vpls);
    if (bad) return `error: routing-instances ${c.bd.name}: interface ${bad} must use encapsulation vlan-vpls\nerror: configuration check-out failed`;
    if (c.bd.site !== undefined && c.bd.veId === undefined) return `error: routing-instances ${c.bd.name} protocols vpls site ${c.bd.site}: site-identifier is required\nerror: configuration check-out failed`;
  }
  return undefined;
}
export function bvXrSpec(api: BvCliApi, r: BvR): SpXrSpec<BvCfg> {
  const s = api.s;
  const sh = (id: string, syntax: string, summary: string, run: SpCmd["run"], args?: SpCmd["args"]): SpCmd => ({ id, syntax, summary, run, args });
  const nothing = (o: string, why: string) => o || { output: "", explanation: why };
  const none = isPe(r) ? "No bridge domain configured." : "No bridge domains here: only the PEs carry the customer's VPLS.";
  const rdA: CliArgSpec = { ...rdArg, choices: [...new Set(tableOf(s, r).map((n) => n.rd))] };
  const netA: CliArgSpec = { choices: [...new Set(tableOf(s, r).map(xrNet))], describe: () => "VE-ID:block-offset/32", resolve: (raw) => (/^\d+:\d+\/32$/.test(raw) ? raw : undefined) };
  return {
    stmts: stmts(r, s).filter((x) => x.xr),
    prompts: { config: "config", subif: "config-subif", l2vpn: "config-l2vpn", bg: "config-l2vpn-bg", bd: "config-l2vpn-bg-bd", "bd-ac": "config-l2vpn-bg-bd-ac", vfi: "config-l2vpn-bg-bd-vfi", ad: "config-l2vpn-bg-bd-vfi-ad", sig: "config-l2vpn-bg-bd-vfi-ad-sig", bgp: "config-bgp", "bgp-af": "config-bgp-af", nbr: "config-bgp-nbr", "nbr-af": "config-bgp-nbr-af", ldp: "config-ldp", "ldp-if": "config-ldp-if" },
    lines: (c) => bvXrLines(r, c),
    help: { "show l2vpn": "Layer 2 VPN information", "show l2vpn bridge-domain": "Bridge-domain information", "show l2vpn forwarding": "Forwarding information", "show bgp": "BGP information", "show bgp l2vpn": "L2VPN address family", "show bgp l2vpn vpls": "VPLS routes", "show mpls": "MPLS information", "show mpls ldp": "LDP information", "show route": "IP routing table", clear: "Clear functions", "clear l2vpn": "Clear Layer 2 VPN information" },
    shows: [
      sh("bd", "show l2vpn bridge-domain", "The bridge domain: attachment circuits and discovered pseudowires", () => nothing(xrBridgeDomain(s, r, false), none)),
      sh("bd-d", "show l2vpn bridge-domain detail", "In detail: VE IDs, labels, MTU, why a pseudowire is down", () => nothing(xrBridgeDomain(s, r, true), none)),
      sh("vpls", "show bgp l2vpn vpls", "The VPLS routes: per RD, VE ID:block offset, labels", () => xrVplsTable(s, r)),
      sh("vpls-sum", "show bgp l2vpn vpls summary", "The BGP sessions and the routes received", () => xrVplsSummary(s, r)),
      sh("vpls-rd", "show bgp l2vpn vpls rd <rd> <net>", "One VPLS route: RT, MTU, label block", (a) => xrVplsRoute(s, r, a.rd, a.net), { rd: rdA, net: netA }),
      sh("mac", "show l2vpn forwarding bridge-domain mac-address location <loc>", "The MAC table: where each MAC was learned", () => nothing(xrMacTable(s, r), none), { loc: choiceArg(["0/0/CPU0"], () => "Line card") }),
      sh("ldp", "show mpls ldp neighbor brief", "LDP sessions (core links only — no targeted sessions in BGP VPLS)", () => xrLdpBrief(s, r)),
      sh("fwd", "show mpls forwarding", "The label forwarding table (transport and VPLS labels)", () => xrForwarding(s, r)),
      sh("route", "show route", "The global routing table (loopbacks via IS-IS)", () => xrRouteGlobal(s, r)),
      sh("log", "show logging", "The syslog buffer", () => xrLogging(s, r)),
    ],
    exec: [
      sh("clr", "clear l2vpn bridge-domain bd-name <n>", "Clear the bridge domain's MAC addresses", (a) => (isPe(r) && s.cfg[r].bd?.name === a.n ? (api.act({ type: "clear", dev: r as VsR }), "") : `% Bridge domain ${a.n} not found`), { n: nameArg([s.cfg[r].bd?.name ?? "VPLS-A"], "Bridge-domain name") }),
    ],
  };
}
export function bvJunosSpec(api: BvCliApi, r: BvR): SpJunosSpec<BvCfg> {
  const s = api.s;
  const sh = (id: string, syntax: string, summary: string, run: SpCmd["run"], args?: SpCmd["args"]): SpCmd => ({ id, syntax, summary, run, args });
  const nothing = (o: string, why: string) => o || { output: "", explanation: why };
  const none = isPe(r) ? "No VPLS instance configured." : "No VPLS here: only the PEs carry the customer's VPLS.";
  const tblArg = choiceArg(["bgp.l2vpn.0", "inet.3", "mpls.0"], (c) => (c === "bgp.l2vpn.0" ? "VPLS routes received and kept" : c === "inet.3" ? "LSPs to the loopbacks" : "Label forwarding"));
  return {
    stmts: stmts(r, s).filter((x) => x.junos),
    jstmts: (c) => bvJnStmts(r, c),
    help: { "show vpls": "Show VPLS information", "show route": "Show routing table information", "show route table": "Name of the routing table", "show bgp": "Show Border Gateway Protocol information", "show ldp": "Show LDP information", clear: "Clear information in the system", "clear vpls": "Clear VPLS information" },
    shows: [
      sh("con", "show vpls connections", "The pseudowires to each discovered remote site", () => nothing(jnConnections(s, r), none)),
      sh("tbl", "show route table <t>", "bgp.l2vpn.0 (VPLS routes), inet.3 (LSPs) or mpls.0 (labels)", (a) => nothing(a.t === "bgp.l2vpn.0" ? jnL2vpnTable(s, r, false) : a.t === "inet.3" ? jnInet3(s, r) : jnMpls0(s, r), "That table is empty here.")),
      sh("tbl-d", "show route table <t> detail", "VPLS routes in detail: RD, site, label base, range, RT, MTU", (a) => nothing(a.t === "bgp.l2vpn.0" ? jnL2vpnTable(s, r, true) : a.t === "inet.3" ? jnInet3(s, r) : jnMpls0(s, r), "That table is empty here."), { t: tblArg }),
      sh("sum", "show bgp summary", "BGP sessions and the VPLS routes they carry", () => jnBgpSum(s, r)),
      sh("mac", "show vpls mac-table", "The MAC table: where each MAC was learned", () => nothing(jnMacTable(s, r), none)),
      sh("ldps", "show ldp session", "LDP sessions (core links)", () => jnLdpSession(s, r)),
      sh("log", "show log messages", "The system log", () => nothing(jnLog(s, r), "No messages since the lab started.")),
    ].map((c) => (c.id === "tbl" ? { ...c, args: { t: tblArg } } : c)),
    op: [
      sh("clr", "clear vpls mac-table instance <n>", "Clear the instance's MAC table", (a) => (isPe(r) && s.cfg[r].bd?.name === a.n ? (api.act({ type: "clear", dev: r as VsR }), "") : `error: instance ${a.n} not found`), { n: nameArg([s.cfg[r].bd?.name ?? "VPLS-A"], "VPLS instance") }),
    ],
  };
}
export function bvSets(api: BvCliApi, r: BvR): Partial<Record<CliVendor, CliCommandSet>> {
  return {
    cisco: buildXrSet({ ...api.dev, validate: (c) => bvValidate(c, false) }, bvXrSpec(api, r)),
    juniper: buildJunosSet({ ...api.dev, validate: (c) => bvValidate(c, true) }, bvJunosSpec(api, r)),
  };
}
export const bvPipe = (api: BvCliApi, r: BvR) => ({ config: junosPipeConfig(api.dev, { jstmts: (c: BvCfg) => bvJnStmts(r, c) }), rollbacks: api.dev.hist.length });
export function bvStaticApi(s: BvState, r: BvR): BvCliApi {
  return { s, act: () => s, dev: { host: r, running: s.cfg[r], hist: s.hist[r], setCand: () => undefined, xr: [], setXr: () => undefined, edit: false, setEdit: () => undefined, commit: () => undefined } };
}
export const bvClone = spClone;
export { VS_LINKS };
