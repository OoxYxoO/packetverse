import type { CliArgSpec, CliCommandSet, CliVendor } from "@/lib/cli/types";
import { buildXrSet, choiceArg, numArg, type SpCfgStmt, type SpCmd, type SpDevCli, type SpXrSpec } from "@/components/sp-lab/spCli";
import { pad, spAge, spStamp } from "@/components/sp-lab/spKit";
import { parseIf, xrIf } from "@/components/sp-lab/spNames";
import { v6norm } from "@/lib/sim-engine/scenarios/sxNet";
import {
  CE,
  D_N,
  D_ROUTERS,
  LO4,
  LO6,
  VPN_LABEL,
  adjLbl,
  dApply,
  dIfTo,
  dIfs,
  dLinkIp4,
  dLinkIp6,
  dLl,
  dt4Of,
  END_FN,
  RD,
  endXOf,
  locOf,
  locOwner,
  nodeLbl,
  sidOf,
  type DAction,
  type DR,
  type DRtr,
  type DState,
  type IfName,
} from "@/lib/sim-engine/scenarios/dpNet";

/**
 * Command lines of the SR-MPLS vs SRv6 Lab — IOS XR on PE1, P1–P4, PE2. Every output is printed from the lab model.
 *
 *   show isis segment-routing label table · show mpls forwarding [labels <n>] · show isis fast-reroute <prefix> detail
 *   · show segment-routing srv6 locator · show segment-routing srv6 sid · show isis segment-routing srv6 locators
 *   · show bgp vpnv4 unicast vrf CUST-A <prefix> · show cef vrf CUST-A <ip> · show route ipv4 · show route ipv6
 *   · show ipv6 interface brief · show logging · ping vrf CUST-A <ip> [size <n>] · ping <address>
 *   configure → interface <if> → mtu <n>
 *             → router isis CORE → address-family ipv4 unicast → segment-routing mpls
 *                                → address-family ipv6 unicast → segment-routing srv6 → locator MAIN
 *                                → interface Loopback0 → address-family ipv4 unicast → prefix-sid index <n>
 *             → router bgp 65000 → vrf CUST-A → address-family ipv4 unicast → segment-routing srv6 → alloc mode per-vrf (PE2)
 * TI-LFA (node protecting, both data planes) is configured on P1's link to P2 — the lab's protected link; P1 computes
 * the backup for PE2, the protected destination.
 */

export interface DpCliApi {
  s: DState;
  act: (a: DAction) => DState;
  dev: SpDevCli<DRtr>;
}
const age = (s: DState) => spAge(s.clock, 15);
const isPe = (r: DR) => r === "PE1" || r === "PE2";
const v4ok = (x: string) => /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(x) && x.split(".").every((o) => +o <= 255);
const v4Arg = (choices: string[], what: string): CliArgSpec => ({ choices, describe: () => what, resolve: (raw) => (v4ok(raw) ? raw : undefined) });
const anyArg = (choices: string[], what: string): CliArgSpec => ({ choices, describe: () => what, resolve: (raw) => (v4ok(raw) ? raw : v6norm(raw)) });
const rt = (s: DState, r: DR, dst: DR) => s.view.rib[r].find((x) => x.dst === dst)!;
/** Routers whose prefix-SID is advertised (SR-MPLS on, index on Loopback0). */
const hasLabel = (s: DState, r: DR) => s.cfg[r].mpls && s.cfg[r].sid;

// ---------------------------------------------------------------------------------------------------------------
// SR-MPLS outputs
// ---------------------------------------------------------------------------------------------------------------
function xrLabelTable(s: DState, r: DR): string {
  if (!s.cfg[r].mpls) return "";
  const rows = D_ROUTERS.filter((x) => hasLabel(s, x)).sort((a, b) => D_N[a] - D_N[b]).map((x) => `${pad(String(nodeLbl(x)), 14)}${pad(`${LO4(x)}/32`, 25)}${x === r ? "Loopback0" : ""}`);
  return ["", "IS-IS CORE IS Label Table", `${pad("Label", 14)}${pad("Prefix", 25)}Interface`, `${pad("----------", 14)}${pad("----------------", 25)}---------`, ...rows].join("\n");
}
interface LfibRow {
  local: number;
  out: string;
  fec: string;
  ifn?: IfName;
  nh: string;
  backup?: boolean;
}
function lfib(s: DState, r: DR): LfibRow[] {
  if (!s.cfg[r].mpls) return [];
  const rows: LfibRow[] = [];
  for (const dst of D_ROUTERS) {
    if (dst === r || !hasLabel(s, dst)) continue;
    const x = rt(s, r, dst);
    const nh = x.nh!.r;
    const out = nh === dst ? "Pop" : s.cfg[nh].mpls ? String(nodeLbl(dst)) : "Unlabelled";
    const fec = `SR Pfx (idx ${D_N[dst]})`;
    rows.push({ local: nodeLbl(dst), out, fec, ifn: x.nh!.ifn, nh: dLinkIp4(dIfTo(r, nh)!.link, nh) });
    if (r === "P1" && dst === "PE2" && nh === "P2" && s.view.repair.labels) rows.push({ local: nodeLbl(dst), out: s.view.repair.labels.join(" "), fec, ifn: dIfTo("P1", "P3")!.ifn, nh: dLinkIp4(dIfTo("P1", "P3")!.link, "P3"), backup: true });
  }
  for (const i of dIfs(r)) rows.push({ local: adjLbl(r, i.peer), out: "Pop", fec: `SR Adj (idx 1)`, ifn: i.ifn, nh: dLinkIp4(i.link, i.peer) });
  if (r === "PE2" && !s.cfg.PE2.vrfSrv6) rows.push({ local: VPN_LABEL, out: "Aggregate", fec: "CUST-A: Per-VRF Aggr[V]", nh: "CUST-A" });
  return rows.sort((a, b) => a.local - b.local || Number(!!a.backup) - Number(!!b.backup));
}
function xrMplsFwd(s: DState, r: DR, label?: number): string {
  if (!s.cfg[r].mpls) return "";
  const rows = lfib(s, r).filter((x) => label === undefined || x.local === label);
  if (!rows.length) return "";
  return [`${pad("Local", 7)}${pad("Outgoing", 12)}${pad("Prefix", 19)}${pad("Outgoing", 13)}${pad("Next Hop", 16)}Bytes`, `${pad("Label", 7)}${pad("Label", 12)}${pad("or ID", 19)}${pad("Interface", 13)}${pad("", 16)}Switched`, `${pad("------", 7)}${pad("-----------", 12)}${pad("------------------", 19)}${pad("------------", 13)}${pad("---------------", 16)}------------`, ...rows.map((x, i) => `${pad(i > 0 && rows[i - 1].local === x.local ? "" : String(x.local), 7)}${pad(x.out, 12)}${pad(x.fec, 19)}${pad(x.ifn ? xrIf(x.ifn, true) : "", 13)}${pad(x.ifn ? x.nh : "", 16)}${x.backup ? "0            (!)" : "0"}`)].join("\n");
}
function xrFrr(s: DState, r: DR, pfx: string): string {
  const v6 = pfx.includes(":");
  const dst = D_ROUTERS.find((x) => (v6 ? `${locOf(x)}/64` === pfx || `${LO6(x)}/128` === pfx : `${LO4(x)}/32` === pfx));
  if (!dst || dst === r) return "";
  if (v6 && pfx === `${locOf(dst)}/64` && !s.cfg[dst].isisLoc) return "";
  const x = rt(s, r, dst);
  const nh = x.nh!.r;
  const head = v6 ? `L2 ${pfx} [${x.cost}/115] low priority` : `L2 ${pfx} [${x.cost}/115]${hasLabel(s, dst) ? ` Label: ${nodeLbl(dst)}` : ""}, medium priority`;
  const via = v6 ? `     via ${dLl(nh)}, ${xrIf(x.nh!.ifn)}, ${nh}, Weight: 0` : `     via ${dLinkIp4(dIfTo(r, nh)!.link, nh)}, ${xrIf(x.nh!.ifn)}, ${hasLabel(s, dst) ? `Label: ${nh === dst ? "ImpNull" : nodeLbl(dst)}, ` : ""}${nh}, SRGB Base: 16000, Weight: 0`;
  const out = [head, via];
  if (r === "P1" && dst === "PE2" && nh === "P2") {
    const rp = s.view.repair;
    const bn = rp.path[1];
    const bi = dIfTo("P1", bn)!;
    const metric = rp.path.slice(1).reduce((m, x, i) => m + dIfTo(rp.path[i], x)!.link.metric, 0);
    if (v6 && rp.sids) out.push(`       Backup path: TI-LFA (link), via ${dLl(bn)}, ${xrIf(bi.ifn)} ${bn}, Weight: 0, Metric: ${metric}`, `         P node: ${rp.pNode}.00 [${LO6(rp.pNode)}], SRv6 SID: ${rp.sids[0]} End.X (USD) → ${rp.qNode}`, "         Backup-src: PE2.00");
    else if (!v6 && rp.labels) out.push(`       Backup path: TI-LFA (link), via ${dLinkIp4(bi.link, bn)}, ${xrIf(bi.ifn)} ${bn}, SRGB Base: 16000, Weight: 0, Metric: ${metric}`, `         P node: ${rp.pNode}.00 [${LO4(rp.pNode)}], Label: ${rp.labels[0]}`, `         Q node: ${rp.qNode}.00 [${LO4(rp.qNode)}], Label: ${rp.labels[1]}`, `         Prefix label: ${nodeLbl("PE2")}`, "         Backup-src: PE2.00");
    else out.push("       No FRR backup");
  }
  return out.join("\n");
}

// ---------------------------------------------------------------------------------------------------------------
// SRv6 outputs
// ---------------------------------------------------------------------------------------------------------------
interface SidRow {
  sid: string;
  beh: string;
  ctx: string;
  owner: string;
}
function sids(s: DState, r: DR): SidRow[] {
  const rows: SidRow[] = [];
  if (s.cfg[r].isisLoc) {
    rows.push({ sid: sidOf(r, END_FN), beh: "End (PSP/USD)", ctx: "'default':1", owner: "isis-CORE" });
    for (const i of dIfs(r)) rows.push({ sid: endXOf(r, i.peer), beh: "End.X (PSP/USD)", ctx: `[${xrIf(i.ifn, true)}, Link-Local]`, owner: "isis-CORE" });
  }
  if (r === "PE2" && s.cfg.PE2.vrfSrv6) rows.push({ sid: dt4Of("PE2"), beh: "End.DT4", ctx: "'CUST-A'", owner: "bgp-65000" });
  return rows;
}
function xrSids(s: DState, r: DR): string {
  const rows = sids(s, r);
  if (!rows.length) return "";
  return ["", "*** Locator: 'MAIN' *** ", "", "SID                         Behavior          Context                           Owner               State  RW", "--------------------------  ----------------  --------------------------------  ------------------  -----  --", ...rows.map((x) => `${pad(x.sid, 28)}${pad(x.beh, 18)}${pad(x.ctx, 34)}${pad(x.owner, 20)}${pad("InUse", 7)}Y`)].join("\n");
}
function xrLocator(r: DR): string {
  return [`${pad("Name", 22)}${pad("ID", 9)}${pad("Algo", 6)}${pad("Prefix", 26)}${pad("Status", 9)}Flags`, `${pad("--------------------", 22)}${pad("-------", 9)}${pad("----", 6)}${pad("------------------------", 26)}${pad("-------", 9)}--------`, `${pad("MAIN", 22)}${pad("1", 9)}${pad("0", 6)}${pad(`${locOf(r)}/64`, 26)}${pad("Up", 9)}`].join("\n");
}
function xrIsisLocators(s: DState, r: DR): string {
  return ["", "IS-IS CORE SRv6 Locators", `${pad("Name", 22)}${pad("ID", 9)}${pad("Algo", 6)}${pad("Prefix", 26)}Status`, `${pad("------", 22)}${pad("----", 9)}${pad("----", 6)}${pad("------", 26)}------`, ...(s.cfg[r].isisLoc ? [`${pad("MAIN", 22)}${pad("1", 9)}${pad("0", 6)}${pad(`${locOf(r)}/64`, 26)}Active`] : [])].join("\n");
}

// ---------------------------------------------------------------------------------------------------------------
// The VPN
// ---------------------------------------------------------------------------------------------------------------
function xrBgp(s: DState, r: DR, pfx: string): string {
  if (!isPe(r)) return "% BGP instance 'default' not active";
  const remote = r === "PE1" ? "PE2" : "PE1";
  const lan = r === "PE1" ? CE.CE2.lan : CE.CE1.lan;
  const own = r === "PE1" ? CE.CE1.lan : CE.CE2.lan;
  if (pfx !== lan && pfx !== own) return "% Network not in table";
  const local = pfx === own;
  const owner: DR = local ? r : remote;
  const srv6 = !!s.cfg[owner].vrfSrv6;
  const label = srv6 ? [`      PSID-Type:L3, SubTLV Count:1`, `       SubTLV: T:1(Sid information), Sid:${owner === "PE2" ? dt4Of("PE2") : sidOf("PE1", 0x13)}, Behavior:63, SS-TLV Count:1`, "        SubSubTLV: T:1(Sid structure):"] : [`      ${local ? "Local Label" : "Received Label"} ${VPN_LABEL}`];
  const head = [`BGP routing table entry for ${pfx}, Route Distinguisher: ${RD[r as "PE1" | "PE2"]}`, "Versions:", "  Process           bRIB/RIB  SendTblVer", "  Speaker                  41           41", `${local ? "  Local Label" : "  Local Label"}: ${local && !srv6 ? VPN_LABEL : "nolabel"}`, `Last Modified: ${spStamp(60).xr} for ${spAge(s.clock, 60)}`, "Paths: (1 available, best #1)"];
  if (local) return [...head, `  Advertised to peers (in unique update groups):\n    ${LO4(remote)}`, "  Path #1: Received by speaker 0", "  Advertised to peers (in unique update groups):", `    ${LO4(remote)}`, "  65020", `    ${r === "PE1" ? "10.10.1.10" : "10.20.1.10"} from 0.0.0.0 (${LO4(r)})`, "      Origin IGP, metric 0, localpref 100, weight 32768, valid, redistributed, best, group-best, import-candidate", "      Received Path ID 0, Local Path ID 1, version 41", "      Extended community: RT:65000:100", ...label].join("\n");
  const cost = rt(s, r, owner).cost;
  return [...head, "  Not advertised to any peer", "  Path #1: Received by speaker 0", "  Not advertised to any peer", "  65020", `    ${LO4(owner)} (metric ${cost + 10}) from ${LO4(owner)} (${LO4(owner)})`, ...label, "      Origin IGP, metric 0, localpref 100, valid, internal, best, group-best, import-candidate, imported", "      Received Path ID 0, Local Path ID 1, version 41", "      Extended community: RT:65000:100", `      Source AFI: VPNv4 Unicast, Source VRF: CUST-A, Source Route Distinguisher: ${RD[owner as "PE1" | "PE2"]}`].join("\n");
}
function xrCef(s: DState, r: DR, ip: string): string {
  if (!isPe(r)) return "% VRF CUST-A not found";
  const drop = [`0.0.0.0/0, version 0, proxy default, default route handler, drop adjacency, internal 0x1001011 0x0 (ptr 0x8d7b1f20) [1], 0x0 (0x0), 0x0 (0x0)`, ` Updated ${spStamp(15).xr.replace(" UTC", "")}`, " Prefix Len 0, traffic index 0, precedence n/a, priority 15", "   via 0.0.0.0/32, 0 dependency, weight 0, class 0 [flags 0x0]", "    next hop 0.0.0.0/32", "     drop adjacency"].join("\n");
  if (r !== "PE1" || !ip.startsWith("10.20.1.")) return r === "PE2" && ip.startsWith("10.20.1.") ? [`${CE.CE2.lan}, version 21, internal 0x1000001 0x30 (ptr 0x8e3a1c80) [1], 0x0 (0x0), 0x0 (0x0)`, ` Updated ${spStamp(15).xr.replace(" UTC", "")}`, " Prefix Len 24, traffic index 0, precedence n/a, priority 3", `   via ${CE.CE2.host.replace(/\d+$/, "1")}/32, ${xrIf("ge-0/0/3")}, 4 dependencies, weight 0, class 0 [flags 0x0]`, "    next hop 10.20.1.1/32", "    local adjacency"].join("\n") : drop;
  const v = s.view;
  const nh = rt(s, "PE1", "PE2").nh!;
  if (v.svc.enc === "srv6") {
    if (!v.svc.usable) return drop;
    return [`${CE.CE2.lan}, version 52, SRv6 Headend, internal 0x5000001 0x30 (ptr 0x8e3a2b10) [1], 0x0 (0x0), 0x0 (0x0)`, ` Updated ${spStamp(60).xr.replace(" UTC", "")}`, " Prefix Len 24, traffic index 0, precedence n/a, priority 3", `   via ${locOf("PE2")}/128, 3 dependencies, recursive [flags 0x6000]`, "    path-idx 0 NHID 0x0 [0x8e1f0a40 0x0]", "    next hop VRF - 'default', table - 0xe0800000", `    next hop ${locOf("PE2")}/128 via ${locOf("PE2")}/64`, `     SRv6 H.Encaps.Red SID-list {${v.svc.sid}}`].join("\n");
  }
  const tl = v.svc.transport && s.cfg[nh.r].mpls ? (nh.r === "PE2" ? "ImplNull" : String(nodeLbl("PE2"))) : "None";
  return [`${CE.CE2.lan}, version 52, internal 0x5000001 0x30 (ptr 0x8e3a2b10) [1], 0x0 (0x0), 0x0 (0x0)`, ` Updated ${spStamp(60).xr.replace(" UTC", "")}`, " Prefix Len 24, traffic index 0, precedence n/a, priority 3", `   via ${LO4("PE2")}/32, 3 dependencies, recursive [flags 0x6000]`, "    path-idx 0 NHID 0x0 [0x8e1f0a40 0x0]", `    recursion-via-/32`, `    next hop ${dLinkIp4(dIfTo("PE1", nh.r)!.link, nh.r)}/32 ${xrIf(nh.ifn, true)} labels imposed {${tl} ${VPN_LABEL}}`].join("\n");
}

// ---------------------------------------------------------------------------------------------------------------
// Routing, interfaces, logging
// ---------------------------------------------------------------------------------------------------------------
function xrRoute4(s: DState, r: DR): string {
  const rows = [`${pad("L", 5)}${LO4(r)}/32 is directly connected, ${age(s)}, Loopback0`];
  for (const x of [...s.view.rib[r]].sort((a, b) => D_N[a.dst] - D_N[b.dst])) rows.push(`${pad("i L2", 5)}${LO4(x.dst)}/32 [115/${x.cost + 10}] via ${dLinkIp4(dIfTo(r, x.nh!.r)!.link, x.nh!.r)}, ${age(s)}, ${xrIf(x.nh!.ifn)}`);
  return ["Codes: C - connected, S - static, R - RIP, B - BGP, (>) - Diversion path", "       O - OSPF, IA - OSPF inter area, i - ISIS, L1 - IS-IS level-1, L2 - IS-IS level-2", "       L - local, a - Application route", "", "Gateway of last resort is not set", "", ...rows].join("\n");
}
function xrRoute6(s: DState, r: DR): string {
  const rows = [`${pad("L", 5)}${LO6(r)}/128 is directly connected,`, `      ${age(s)}, Loopback0`];
  if (s.cfg[r].isisLoc) rows.push(`${pad("L", 5)}${locOf(r)}/64 is directly connected,`, `      ${age(s)}, Null0 (SRv6 locator)`);
  for (const x of [...s.view.rib[r]].sort((a, b) => D_N[a.dst] - D_N[b.dst])) {
    rows.push(`${pad("i L2", 5)}${LO6(x.dst)}/128`, `      [115/${x.cost + 10}] via ${dLl(x.nh!.r)}, ${age(s)}, ${xrIf(x.nh!.ifn)}`);
    if (s.cfg[x.dst].isisLoc) rows.push(`${pad("i L2", 5)}${locOf(x.dst)}/64`, `      [115/${x.cost + 1}] via ${dLl(x.nh!.r)}, ${age(s)}, ${xrIf(x.nh!.ifn)}`);
  }
  return ["Codes: C - connected, S - static, R - RIP, B - BGP, (>) - Diversion path", "       O - OSPF, IA - OSPF inter area, i - ISIS, L1 - IS-IS level-1, L2 - IS-IS level-2", "       L - local, a - Application route", "", "Gateway of last resort is not set", "", ...rows].join("\n");
}
function xrV6Brief(s: DState, r: DR): string {
  const rows = dIfs(r).map((i) => {
    const mtu = s.cfg[r].mtu[i.ifn] ?? 9216;
    return `${pad(xrIf(i.ifn), 36)}[Up/Up]\n    ${dLl(r)}\n    ${dLinkIp6(i.link, r)}  (MTU ${mtu}, IPv6 MTU ${mtu - 14})`;
  });
  return [`${pad("Loopback0", 36)}[Up/Up]\n    ${LO6(r)}`, ...rows].join("\n");
}
function xrLogging(s: DState, r: DR): string {
  const lines = s.sys.filter((x) => x.dev === r).slice(-30).map((x) => {
    const st = `RP/0/RP0/CPU0:${spStamp(x.t).xr}`;
    if (x.kind === "adj-up") return `${st}: isis[1012]: %ROUTING-ISIS-5-ADJCHANGE : Adjacency to ${x.peer} (${xrIf(dIfTo(r, x.peer as DR)!.ifn)}) (L2) Up, New adjacency`;
    return `${st}: config[65857]: %MGBL-CONFIG-6-DB_COMMIT : Configuration committed by user 'admin'. Use 'show commit changes ${1000000000 + x.t}' to view the changes.`;
  });
  return ["Syslog logging: enabled (0 messages dropped, 0 flushes, 0 overruns)", `    Buffer logging: level debugging, ${lines.length} messages logged`, "", "Log Buffer (2097152 bytes):", "", ...lines].join("\n");
}

// ---------------------------------------------------------------------------------------------------------------
// Pings
// ---------------------------------------------------------------------------------------------------------------
function xrPingVrf(api: DpCliApi, r: DR, ip: string, size: number): string {
  if (r !== "PE1") return r === "PE2" ? "% This lab sends CUST-A probes from site 1 (PE1)." : "% VRF CUST-A not found";
  if (ip !== CE.CE2.host) return ["Type escape sequence to abort.", `Sending 5, ${size}-byte ICMP Echos to ${ip} vrf CUST-A, timeout is 2 seconds:`, ".....", "Success rate is 0 percent (0/5)"].join("\n");
  const ns = dApply(api.s, { type: "ping", size });
  api.act({ type: "ping", size });
  const w = ns.tests.at(-1)!.walk;
  return ["Type escape sequence to abort.", `Sending 5, ${size}-byte ICMP Echos to ${ip} vrf CUST-A, timeout is 2 seconds:`, w.ok ? "!!!!!" : w.why?.includes("MTU") ? "MMMMM" : ".....", w.ok ? `Success rate is 100 percent (5/5), round-trip min/avg/max = 2/3/5 ms` : "Success rate is 0 percent (0/5)"].join("\n");
}
function xrPing(s: DState, r: DR, dst: string): string {
  let ok = false;
  let unreach = false;
  const lo4 = D_ROUTERS.find((x) => LO4(x) === dst);
  const lo6 = D_ROUTERS.find((x) => LO6(x) === dst);
  if (lo4 || lo6) ok = true;
  else {
    const o = locOwner(dst);
    if (o) {
      const there = o === r || s.cfg[o].isisLoc;
      ok = there && dst === sidOf(o, END_FN) && s.cfg[o].isisLoc;
      unreach = there && !ok;
    }
  }
  return ["Type escape sequence to abort.", `Sending 5, 100-byte ICMP Echos to ${dst}, timeout is 2 seconds:`, (ok ? "!" : unreach ? "U" : ".").repeat(5), ok ? "Success rate is 100 percent (5/5), round-trip min/avg/max = 1/2/4 ms" : "Success rate is 0 percent (0/5)"].join("\n");
}

// ---------------------------------------------------------------------------------------------------------------
// Configuration as IOS XR prints it
// ---------------------------------------------------------------------------------------------------------------
export function dpXrLines(r: DR, c: DRtr): string[] {
  const out: string[] = [`hostname ${r}`, "!", "interface Loopback0", ` ipv4 address ${LO4(r)} 255.255.255.255`, ` ipv6 address ${LO6(r)}/128`, "!"];
  for (const i of dIfs(r)) out.push(`interface ${xrIf(i.ifn)}`, ` description to ${i.peer}`, ` mtu ${c.mtu[i.ifn] ?? 9216}`, ` ipv4 address ${dLinkIp4(i.link, r)} 255.255.255.0`, ` ipv6 address ${dLinkIp6(i.link, r)}/64`, "!");
  if (isPe(r)) out.push(`interface ${xrIf("ge-0/0/3")}`, " description to CE", " vrf CUST-A", ` ipv4 address ${r === "PE1" ? "10.10.1.1" : "10.20.1.1"} 255.255.255.0`, "!", "vrf CUST-A", " address-family ipv4 unicast", "  import route-target", "   65000:100", "  !", "  export route-target", "   65000:100", "  !", " !", "!");
  out.push("router isis CORE", " is-type level-2-only", ` net 49.0001.0000.0000.00${String(D_N[r]).padStart(2, "0")}.00`, " address-family ipv4 unicast", "  metric-style wide", ...(c.mpls ? ["  segment-routing mpls"] : []), " !", " address-family ipv6 unicast", "  metric-style wide", ...(c.isisLoc ? ["  segment-routing srv6", "   locator MAIN", "   !", "  !"] : []), " !", " interface Loopback0", "  passive", "  address-family ipv4 unicast", ...(c.sid ? [`   prefix-sid index ${D_N[r]}`] : []), "  !", "  address-family ipv6 unicast", "  !", " !");
  for (const i of dIfs(r)) {
    const frr = r === "P1" && i.peer === "P2";
    const af = (fam: string) => [`  address-family ${fam} unicast`, ...(i.link.metric !== 10 ? [`   metric ${i.link.metric}`] : []), ...(frr ? ["   fast-reroute per-prefix", "   fast-reroute per-prefix ti-lfa"] : []), "  !"];
    out.push(` interface ${xrIf(i.ifn)}`, "  point-to-point", ...(frr ? ["  bfd minimum-interval 50", "  bfd multiplier 3", "  bfd fast-detect ipv4"] : []), ...af("ipv4"), ...af("ipv6"), " !");
  }
  out.push("!", "segment-routing", " global-block 16000 23999", " srv6", "  encapsulation", `   source-address ${LO6(r)}`, "  !", "  locators", "   locator MAIN", `    prefix ${locOf(r)}/64`, "   !", "  !", " !", "!");
  if (isPe(r)) out.push("router bgp 65000", ` bgp router-id ${LO4(r)}`, " address-family vpnv4 unicast", " !", ` neighbor ${LO4(r === "PE1" ? "PE2" : "PE1")}`, "  remote-as 65000", "  update-source Loopback0", "  address-family vpnv4 unicast", "  !", " !", " vrf CUST-A", `  rd ${RD[r as "PE1" | "PE2"]}`, "  address-family ipv4 unicast", ...(c.vrfSrv6 ? ["   segment-routing srv6", "    locator MAIN", "    alloc mode per-vrf", "   !"] : ["   label mode per-vrf"]), "   redistribute connected", "  !", " !", "!");
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Configuration statements
// ---------------------------------------------------------------------------------------------------------------
function stmts(r: DR): SpCfgStmt<DRtr>[] {
  const ifs = dIfs(r).map((i) => xrIf(i.ifn));
  const NOBGP = "% P routers run no BGP in this lab: only PE1 and PE2 carry CUST-A.";
  const EGRESS = "% The service is allocated by the egress PE: in this lab CUST-A flows site 1 → site 2, so PE2 decides SR-MPLS or SRv6.";
  return [
    { id: "if", summary: "Select an interface to configure", args: { ifname: { choices: ifs, describe: (x) => `to ${dIfs(r).find((i) => xrIf(i.ifn) === x || i.ifn === parseIf(x))?.peer ?? "?"}`, resolve: (raw) => { const m = parseIf(raw); return m && dIfs(r).some((i) => i.ifn === m) ? m : undefined; } } }, xr: { mode: "config", syntax: "interface <ifname>", enter: "if", apply: (c) => c } },
    { id: "if-mtu", summary: "Set the interface MTU (L2, includes the 14-byte Ethernet header)", args: { mtu: numArg(1514, 9216, ["9216", "1514"], "MTU in bytes") }, xr: { mode: "if", syntax: "mtu <mtu>", noSyntax: "mtu", apply: (c, a, ctx) => ((c.mtu[ctx.ifname as IfName] = +a.mtu), c), no: (c, _a, ctx) => ((c.mtu[ctx.ifname as IfName] = 1514), c) } },
    { id: "isis", summary: "IS-IS routing protocol", args: { tag: choiceArg(["CORE"], () => "Instance tag") }, xr: { mode: "config", syntax: "router isis <tag>", enter: "isis", apply: (c) => c } },
    { id: "isis-af4", summary: "Enter the IPv4 unicast address family", xr: { mode: "isis", syntax: "address-family ipv4 unicast", enter: "isis-af4", apply: (c) => c } },
    { id: "isis-mpls", summary: "SR-MPLS: advertise prefix-SIDs and Adj-SIDs, program labels", xr: { mode: "isis-af4", syntax: "segment-routing mpls", apply: (c) => ((c.mpls = true), c), no: (c) => ((c.mpls = false), c) } },
    { id: "isis-ms4", summary: "Use wide metrics", args: { w4: choiceArg(["wide"], () => "Wide metrics") }, xr: { mode: "isis-af4", syntax: "metric-style <w4>", apply: (c) => c, no: () => "% Segment Routing needs wide metrics." } },
    { id: "isis-af6", summary: "Enter the IPv6 unicast address family", xr: { mode: "isis", syntax: "address-family ipv6 unicast", enter: "isis-af6", apply: (c) => c } },
    { id: "isis-ms6", summary: "Use wide metrics", args: { w6: choiceArg(["wide"], () => "Wide metrics") }, xr: { mode: "isis-af6", syntax: "metric-style <w6>", apply: (c) => c, no: () => "% SRv6 needs wide metrics." } },
    { id: "isis-srv6", summary: "SRv6 in IS-IS", xr: { mode: "isis-af6", syntax: "segment-routing srv6", enter: "isis-srv6", apply: (c) => c, no: (c) => ((c.isisLoc = false), c) } },
    { id: "isis-loc", summary: "Advertise this locator (and allocate End/End.X SIDs from it)", args: { lname: choiceArg(["MAIN"], () => "Locator name") }, xr: { mode: "isis-srv6", syntax: "locator <lname>", apply: (c) => ((c.isisLoc = true), c), no: (c) => ((c.isisLoc = false), c) } },
    { id: "isis-if", summary: "An IS-IS interface", args: { iif: { choices: ["Loopback0", ...ifs], describe: () => "Interface", resolve: (raw) => parseIf(raw) } }, xr: { mode: "isis", syntax: "interface <iif>", enter: "isis-if", apply: (c) => c } },
    { id: "isis-if-af4", summary: "IPv4 settings of this IS-IS interface", xr: { mode: "isis-if", syntax: "address-family ipv4 unicast", enter: "isis-if-af4", apply: (c) => c } },
    { id: "isis-psid", summary: "This loopback's prefix-SID (label = SRGB base 16000 + index)", args: { idx: numArg(0, 7999, [String(D_N[r])], "SID index") }, xr: { mode: "isis-if-af4", syntax: "prefix-sid index <idx>", noSyntax: "prefix-sid", apply: (c, a, ctx) => (ctx.iif !== "lo0" ? "% A prefix-SID belongs on Loopback0 in this lab." : +a.idx !== D_N[r] ? `% This lab numbers ${r} as index ${D_N[r]} (label ${nodeLbl(r)}) — another value would collide with the plan.` : ((c.sid = true), c)), no: (c, _a, ctx) => (ctx.iif !== "lo0" ? c : ((c.sid = false), c)) } },
    { id: "bgp", summary: "BGP routing protocol", args: { asn: choiceArg(["65000"], () => "Autonomous system") }, xr: { mode: "config", syntax: "router bgp <asn>", enter: "bgp", apply: (c) => (isPe(r) ? c : NOBGP) } },
    { id: "bgp-vrf", summary: "A VRF in BGP", args: { vrf: choiceArg(["CUST-A"], () => "Customer VRF") }, xr: { mode: "bgp", syntax: "vrf <vrf>", enter: "bgp-vrf", apply: (c) => c } },
    { id: "bgp-vrf-af", summary: "IPv4 unicast in this VRF", xr: { mode: "bgp-vrf", syntax: "address-family ipv4 unicast", enter: "bgp-vrf-af", apply: (c) => c } },
    { id: "bgp-srv6", summary: "Carry this VRF over SRv6 (instead of an MPLS VPN label)", xr: { mode: "bgp-vrf-af", syntax: "segment-routing srv6", enter: "bgp-srv6", apply: (c) => (r === "PE2" ? c : EGRESS), no: (c) => (r === "PE2" ? ((c.vrfSrv6 = false), c) : EGRESS) } },
    { id: "bgp-srv6-loc", summary: "The locator the service SID comes from", args: { vloc: choiceArg(["MAIN"], () => "Locator name") }, xr: { mode: "bgp-srv6", syntax: "locator <vloc>", apply: (c) => c } },
    { id: "bgp-alloc", summary: "Allocate one End.DT4 SID for the whole VRF", args: { am: choiceArg(["per-vrf"], () => "One SID per VRF") }, xr: { mode: "bgp-srv6", syntax: "alloc mode <am>", apply: (c) => ((c.vrfSrv6 = true), c), no: (c) => ((c.vrfSrv6 = false), c) } },
  ];
}

// ---------------------------------------------------------------------------------------------------------------
// Command set
// ---------------------------------------------------------------------------------------------------------------
export function dpXrSpec(api: DpCliApi, r: DR): SpXrSpec<DRtr> {
  const s = api.s;
  const sh = (id: string, syntax: string, summary: string, run: SpCmd["run"], args?: SpCmd["args"]): SpCmd => ({ id, syntax, summary, run, args });
  const nothing = (o: string, why: string) => o || { output: "", explanation: why };
  const pfxArg: CliArgSpec = { choices: [`${LO4("PE2")}/32`, `${locOf("PE2")}/64`], describe: () => "Prefix (IPv4 loopback or SRv6 locator)", resolve: (raw) => { const [a, l] = raw.split("/"); if (!l) return undefined; return v4ok(a) ? raw : v6norm(a) ? `${v6norm(a)}/${l}` : undefined; } };
  return {
    stmts: stmts(r),
    prompts: { config: "config", if: "config-if", isis: "config-isis", "isis-af4": "config-isis-af", "isis-af6": "config-isis-af", "isis-srv6": "config-isis-srv6", "isis-if": "config-isis-if", "isis-if-af4": "config-isis-if-af", bgp: "config-bgp", "bgp-vrf": "config-bgp-vrf", "bgp-vrf-af": "config-bgp-vrf-af", "bgp-srv6": "config-bgp-vrf-af-srv6" },
    lines: (c) => dpXrLines(r, c),
    help: { "show isis": "IS-IS information", "show mpls": "MPLS information", "show segment-routing": "Segment routing information", "show segment-routing srv6": "SRv6 information", "show bgp": "BGP information", "show cef": "Cisco Express Forwarding", "show route": "IP routing table", "show ipv6": "IPv6 information" },
    shows: [
      sh("lbl", "show isis segment-routing label table", "Prefix-SID labels IS-IS learned (SRGB 16000 + index)", () => nothing(xrLabelTable(s, r), "IS-IS has no label table: segment-routing mpls is not enabled on this router.")),
      sh("mfwd", "show mpls forwarding", "The label forwarding table: Node SIDs, Adj-SIDs, VPN label, TI-LFA backups (!)", () => nothing(xrMplsFwd(s, r), "No MPLS forwarding entries: this router does not run SR-MPLS.")),
      sh("mfwdl", "show mpls forwarding labels <n>", "One label's entry", (a) => nothing(xrMplsFwd(s, r, +a.n), "No entry for that label on this router."), { n: numArg(0, 1048575, [String(nodeLbl("PE2")), String(VPN_LABEL)], "Local label") }),
      sh("frr", "show isis fast-reroute <pfx> detail", "Primary and TI-LFA backup path for a prefix", (a) => nothing(xrFrr(s, r, a.pfx), "IS-IS has no route for that prefix."), { pfx: pfxArg }),
      sh("loc", "show segment-routing srv6 locator", "This router's SRv6 locator", () => xrLocator(r)),
      sh("sid", "show segment-routing srv6 sid", "The local SRv6 SID table: End, End.X, End.DT4", () => nothing(xrSids(s, r), "No SRv6 SIDs allocated: no protocol uses locator MAIN on this router.")),
      sh("isloc", "show isis segment-routing srv6 locators", "The locators IS-IS advertises", () => xrIsisLocators(s, r)),
      sh("bgp", "show bgp vpnv4 unicast vrf <v> <pfx>", "CUST-A's VPN route: label or SRv6 SID", (a) => xrBgp(s, r, a.pfx), { v: choiceArg(["CUST-A"], () => "Customer VRF"), pfx: { choices: [CE.CE2.lan, CE.CE1.lan], describe: () => "VPN prefix", resolve: (raw) => raw } }),
      sh("cef", "show cef vrf <v> <ip>", "What PE1 actually pushes for a CUST-A destination", (a) => xrCef(s, r, a.ip), { v: choiceArg(["CUST-A"], () => "Customer VRF"), ip: v4Arg([CE.CE2.host], "IPv4 destination") }),
      sh("rt4", "show route ipv4", "The IPv4 table: loopbacks", () => xrRoute4(s, r)),
      sh("rt6", "show route ipv6", "The IPv6 table: loopbacks and SRv6 locators", () => xrRoute6(s, r)),
      sh("v6b", "show ipv6 interface brief", "Interfaces, addresses and MTU", () => xrV6Brief(s, r)),
      sh("log", "show logging", "The syslog buffer", () => xrLogging(s, r)),
    ],
    exec: [
      sh("pingv", "ping vrf <v> <ip>", "Send CUST-A traffic from site 1 to site 2 (100 bytes)", (a) => xrPingVrf(api, r, a.ip, 100), { v: choiceArg(["CUST-A"], () => "Customer VRF"), ip: v4Arg([CE.CE2.host], "Site 2 host") }),
      sh("pingvs", "ping vrf <v> <ip> size <n>", "The same with a given packet size", (a) => xrPingVrf(api, r, a.ip, +a.n), { v: choiceArg(["CUST-A"], () => "Customer VRF"), ip: v4Arg([CE.CE2.host], "Site 2 host"), n: numArg(36, 9000, ["100", "1460"], "Datagram size") }),
      sh("ping", "ping <dst>", "Ping a loopback (IPv4/IPv6) or an End SID", (a) => xrPing(s, r, a.dst), { dst: anyArg([LO4("PE2"), LO6("PE2"), sidOf("PE2", END_FN)], "Loopback or SRv6 End SID") }),
    ],
  };
}
export function dpSets(api: DpCliApi, r: DR): Partial<Record<CliVendor, CliCommandSet>> {
  return { cisco: buildXrSet(api.dev, dpXrSpec(api, r)) };
}
export function dpStaticApi(s: DState, r: DR): DpCliApi {
  return { s, act: () => s, dev: { host: r, running: s.cfg[r], hist: s.hist[r], setCand: () => undefined, xr: [], setXr: () => undefined, edit: false, setEdit: () => undefined, commit: () => undefined } };
}
