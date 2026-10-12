import type { CliArgSpec, CliCommandSet, CliVendor } from "@/lib/cli/types";
import { buildXrSet, choiceArg, numArg, type SpCfgStmt, type SpCmd, type SpDevCli, type SpXrSpec } from "@/components/sp-lab/spCli";
import { pad, spAge, spStamp } from "@/components/sp-lab/spKit";
import { parseIf, xrIf } from "@/components/sp-lab/spNames";
import {
  CE_IDS,
  EB_CES,
  EB_IDX,
  EB_LO,
  EB_ROUTERS,
  H1,
  ebAdvertises,
  ebEnd,
  ebIfTo,
  ebIfs,
  ebRoute,
  ebSid,
  ebSidOwner,
  locPrefix,
  v6norm,
  type EbAction,
  type EbR,
  type EbRtr,
  type EbSid,
  type EbState,
  type IfName,
  type Vrf,
} from "@/lib/sim-engine/scenarios/ebNet";

/**
 * Command lines of the SRv6 Endpoint Behaviors Lab — IOS XR on R1–R6. Every output is printed from the lab model: the
 * local SID tables with their behaviors (End, End.X from IS-IS; End.DT4/DT6/DX4/DX6 from BGP), the VRFs behind them,
 * locators, routes and pings.
 *
 *   show segment-routing srv6 sid [<sid> [detail]] · show segment-routing srv6 locator · show isis segment-routing
 *   srv6 locators · show isis database verbose [<lsp>] · show isis adjacency · show route ipv6 [<ip>] · show vrf all ·
 *   show route vrf CUST4 · show route vrf CUST6 ipv6 · show bgp vrf <vrf> … unicast · show logging · ping <ipv6>
 *   configure → router isis CORE → interface <if> → address-family ipv6 unicast → metric · segment-routing srv6
 *   locators locator MAIN prefix · interface <ce-if> → vrf <vrf> · router bgp 65000 → vrf <vrf> → address-family
 *   ipv4|ipv6 unicast → segment-routing srv6 → locator <name> · alloc mode per-vrf | per-ce
 */

export interface EbCliApi {
  s: EbState;
  act: (a: EbAction) => EbState;
  dev: SpDevCli<EbRtr>;
}
const age = (s: EbState) => spAge(s.clock, 15);
const ifc = (c: EbRtr, ifn: string) => c.ifs[ifn as IfName]!;
const defMetric = (r: EbR, ifn: string) => ebIfs(r).find((i) => i.ifn === ifn)!.link.metric;
const ll = (r: EbR) => `fe80::${EB_IDX[r]}`;
const VRFS: Vrf[] = ["CUST4", "CUST6"];
const VRF_FAM: Record<Vrf, "ipv4" | "ipv6"> = { CUST4: "ipv4", CUST6: "ipv6" };
const RD: Record<Vrf, string> = { CUST4: "65000:4", CUST6: "65000:6" };
const behText = (x: EbSid) => (x.behavior === "End" || x.behavior === "End.X" ? `${x.behavior} (PSP/USD)` : x.behavior);
const ctxText = (x: EbSid) => (x.behavior === "End" ? "'default':1" : x.behavior === "End.X" ? `[${xrIf(x.ifn!, true)}, Link-Local]` : x.ce ? `'${x.vrf}':${EB_CES[x.ce].ip}` : `'${x.vrf}'`);

// ---------------------------------------------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------------------------------------------
const coreIfs = (r: EbR) => ebIfs(r).map((i) => i.ifn);
const ceIfs = (r: EbR): IfName[] => (r === "R6" ? CE_IDS.map((c) => EB_CES[c].ifn) : []);
const ifArg = (r: EbR, kind: "core" | "ce" | "isis"): CliArgSpec => {
  const list = kind === "ce" ? ceIfs(r) : coreIfs(r);
  return {
    choices: [...(kind === "isis" ? ["Loopback0"] : []), ...list.map((i) => xrIf(i))],
    describe: (c) => {
      const n = parseIf(c);
      const i = ebIfs(r).find((x) => x.ifn === n);
      const ce = CE_IDS.find((x) => EB_CES[x].ifn === n);
      return i ? `to ${i.peer}` : r === "R6" && ce ? `to ${ce}` : n === "lo0" ? "Loopback0" : undefined;
    },
    resolve: (raw) => {
      const n = parseIf(raw);
      return n && (n === "lo0" ? kind === "isis" : list.includes(n as IfName)) ? n : undefined;
    },
  };
};
const v6Arg = (choices: string[], what: string): CliArgSpec => ({ choices, describe: () => what, resolve: (raw) => v6norm(raw) });
const vrfArg = choiceArg(VRFS, (v) => (v === "CUST4" ? "IPv4 customers CE4-A, CE4-B" : "IPv6 customer CE6"));
const pfxArg: CliArgSpec = {
  choices: EB_ROUTERS.map((r) => `${locPrefix(EB_IDX[r])}/64`),
  describe: () => "Locator prefix (a /64 from 2001:db8:100::/48)",
  resolve: (raw) => {
    const m = /^(.+)\/(\d{1,3})$/.exec(raw);
    return m && v6norm(m[1]) && +m[2] <= 128 ? `${v6norm(m[1])}/${m[2]}` : undefined;
  },
};
const lspArg: CliArgSpec = { choices: EB_ROUTERS.map((r) => `${r}.00-00`), describe: (c) => `${c.slice(0, 2)}'s LSP`, resolve: (raw) => (EB_ROUTERS.some((r) => raw.toUpperCase() === `${r}.00-00` || raw.toUpperCase() === r) ? raw.slice(0, 2).toUpperCase() : undefined) };
const allSids = (s: EbState) => EB_ROUTERS.flatMap((r) => s.view.sids[r].map((x) => x.sid));

// ---------------------------------------------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------------------------------------------
function xrSids(s: EbState, r: EbR, only?: string, detail = false): string {
  const rows = s.view.sids[r].filter((x) => !only || x.sid === only);
  if (!rows.length) return "";
  return ["", "*** Locator: 'MAIN' *** ", "", "SID                         Behavior          Context                           Owner               State  RW", "--------------------------  ----------------  --------------------------------  ------------------  -----  --", ...rows.flatMap((x) => [`${pad(x.sid, 28)}${pad(behText(x), 18)}${pad(ctxText(x), 34)}${pad(x.owner, 20)}${pad("InUse", 7)}Y`, ...(detail ? [`  SID Function: 0x${x.sid.split(":")[4]}`, "  SID context: { " + (x.behavior === "End.X" ? `interface=${xrIf(x.ifn!, true)} nh=${ll(x.peer!)}` : x.vrf ? `table-id=0xe00000${x.vrf === "CUST4" ? "01" : "02"} ('${x.vrf}':${x.vrf === "CUST4" ? "IPv4" : "IPv6"}/Unicast)${x.ce ? ` nh=${EB_CES[x.ce].ip} interface=${xrIf(EB_CES[x.ce].ifn, true)}` : ""}` : "table-id=0xe0800000 ('default':IPv6/Unicast)") + " }", `  Locator: 'MAIN'`, `  Allocation type: ${x.owner === "bgp-65000" ? "Dynamic" : "Dynamic"}`, `  Created: ${spStamp(20).xr.replace(" UTC", "")} (${age(s)} ago)`] : [])])].join("\n");
}
function xrLocator(s: EbState, r: EbR): string {
  const c = s.cfg[r];
  if (!c.sr6 || c.loc === undefined) return "";
  return ["Name                  ID       Algo  Prefix                    Status   Flags", "--------------------  -------  ----  ------------------------  -------  --------", `${pad("MAIN", 22)}${pad(1, 9)}${pad(0, 6)}${pad(`${locPrefix(c.loc)}/64`, 26)}${pad("Up", 9)}`].join("\n");
}
function xrIsisLocators(s: EbState, r: EbR): string {
  const c = s.cfg[r];
  return ["", "IS-IS CORE SRv6 Locators", "Name                  ID       Algo  Prefix                    Status", "------                ----     ----  ------                    ------", ...(ebAdvertises(s.cfg, r) ? [`${pad("MAIN", 22)}${pad(1, 9)}${pad(0, 6)}${pad(`${locPrefix(c.loc!)}/64`, 26)}Active`] : [])].join("\n");
}
function lspLines(s: EbState, o: EbR): string[] {
  const c = s.cfg[o];
  const adv = ebAdvertises(s.cfg, o);
  return [
    `${pad(`${o}.00-00`, 22)}${pad(`0x0000000${(5 + s.cfgSeq) % 10}`, 13)}${pad(`0x${(0x8a10 + EB_IDX[o] * 37).toString(16)}`, 14)}${pad(`${1100 + EB_IDX[o] * 7} /1200`, 19)}0/0/0`,
    "  Area Address:   49.0001",
    "  NLPID:          0x8e",
    "  MT:             IPv6 Unicast                                 0/0/0",
    `  Hostname:       ${o}`,
    `  IPv6 Address:   ${EB_LO(o)}`,
    ...(adv ? ["  Router Cap:     0.0.0.0 D:0 S:0", "    SRv6: O:0"] : []),
    ...ebIfs(o).filter((i) => s.view.adj[i.link.id]).flatMap((i) => [`  Metric: ${pad(c.ifs[i.ifn]!.metric, 11)}MT (IPv6 Unicast) IS-Extended ${i.peer}.00`, `    Interface IPv6 Address: ${i.ip}`, ...(adv ? [`    SRv6 End.X SID: ${s.view.sids[o].find((x) => x.peer === i.peer)?.sid} B:0 S:0 P:0 Algorithm: 0`] : [])]),
    `  Metric: ${pad(0, 11)}MT (IPv6 Unicast) IPv6 ${EB_LO(o)}/128`,
    ...(adv ? [`  SRv6 Locator:   MT (IPv6 Unicast) ${locPrefix(c.loc!)}/64 D:0 Metric: 1 Algorithm: 0`, `    END SID: ${ebEnd(o).replace(`:${EB_IDX[o]}:1::`, `:${c.loc!.toString(16)}:1::`)} End (PSP/USD)`] : []),
  ];
}
function xrDatabase(s: EbState, only?: EbR): string {
  return ["", "IS-IS CORE (Level-2) Link State Database", "LSPID                 LSP Seq Num  LSP Checksum  LSP Holdtime/Rcvd  ATT/P/OL", ...EB_ROUTERS.filter((o) => !only || o === only).flatMap((o) => lspLines(s, o)), "", " Total Level-2 LSP count: 6     Local Level-2 LSP count: 1"].join("\n");
}
function xrAdj(s: EbState, r: EbR): string {
  const ups = ebIfs(r).filter((i) => s.view.adj[i.link.id]);
  return ["IS-IS CORE Level-2 adjacencies:", "System Id      Interface                SNPA           State Hold Changed  NSF IPv4 IPv6", "                                                                               BFD  BFD", ...ups.map((i) => `${pad(i.peer, 15)}${pad(xrIf(i.ifn, true), 25)}${pad("*PtoP*", 15)}${pad("Up", 6)}${pad(27, 5)}${pad(age(s), 9)}Yes None None`), "", `Total adjacency count: ${ups.length}`].join("\n");
}
function xrRouteIp(s: EbState, r: EbR, ip: string): string {
  const rt = ebRoute(s.cfg, s.view, r, ip);
  if (!rt.owner) return "% Network not in table";
  const p = `${locPrefix(s.cfg[rt.owner].loc!)}/64`;
  if (rt.own) return [`Routing entry for ${p}`, `  Known via "local", distance 0, metric 0 (SRv6 locator)`, "  Routing Descriptor Blocks", "    directly connected, via Null0", "  No advertising protos."].join("\n");
  const cost = s.view.spf[r].find((x) => x.dst === rt.owner)!.cost + 1;
  return [`Routing entry for ${p}`, `  Known via "isis CORE", distance 115, metric ${cost}, type level-2, SRv6 locator`, `  Installed ${spStamp(15).xr.replace(" UTC", "")} for ${age(s)}`, "  Routing Descriptor Blocks", `    ${ll(rt.nh!.nh)}, from ${EB_LO(rt.owner)}, via ${xrIf(rt.nh!.ifn)}`, `      Route metric is ${cost}`, "  No advertising protos."].join("\n");
}
function xrRoutes(s: EbState, r: EbR): string {
  const rows: string[] = [];
  for (const o of EB_ROUTERS) {
    if (!ebAdvertises(s.cfg, o)) continue;
    const p = `${locPrefix(s.cfg[o].loc!)}/64`;
    if (o === r) rows.push(`${pad("L", 5)}${p} is directly connected,`, `      ${age(s)}, Null0 (SRv6 locator)`);
    else {
      const rt = s.view.spf[r].find((x) => x.dst === o);
      if (rt?.nh) rows.push(`${pad("i L2", 5)}${p}`, `      [115/${rt.cost + 1}] via ${ll(rt.nh.nh)}, ${age(s)}, ${xrIf(rt.nh.ifn)}`);
    }
  }
  for (const o of EB_ROUTERS) {
    if (o === r) rows.push(`${pad("L", 5)}${EB_LO(o)}/128 is directly connected,`, `      ${age(s)}, Loopback0`);
    else {
      const rt = s.view.spf[r].find((x) => x.dst === o);
      if (rt?.nh) rows.push(`${pad("i L2", 5)}${EB_LO(o)}/128`, `      [115/${rt.cost}] via ${ll(rt.nh.nh)}, ${age(s)}, ${xrIf(rt.nh.ifn)}`);
    }
  }
  return ["Codes: C - connected, S - static, R - RIP, B - BGP, (>) - Diversion path", "       O - OSPF, IA - OSPF inter area, i - ISIS, L1 - IS-IS level-1, L2 - IS-IS level-2", "       L - local, a - Application route", "", "Gateway of last resort is not set", "", ...rows].join("\n");
}
function xrVrfAll(s: EbState, r: EbR): string {
  if (r !== "R6") return "";
  return ["VRF                  RD                  RT                         AFI   SAFI", ...VRFS.flatMap((v) => [`${pad(v, 21)}${pad(RD[v], 20)}${pad(`import  ${RD[v]}`, 27)}${pad(v === "CUST4" ? "IPV4" : "IPV6", 6)}Unicast`, `${pad("", 41)}${pad(`export  ${RD[v]}`, 27)}${pad(v === "CUST4" ? "IPV4" : "IPV6", 6)}Unicast`]), "", "Interfaces:", ...CE_IDS.map((ce) => `  ${pad(xrIf(EB_CES[ce].ifn), 26)}${s.cfg.R6.ceVrf[EB_CES[ce].ifn] ?? "default"}`)].join("\n");
}
function xrRouteVrf(s: EbState, r: EbR, v: Vrf): string {
  if (r !== "R6") return `% VRF ${v} not found`;
  const ces = s.view.vrfTable[v];
  const rows = ces.flatMap((ce) => {
    const x = EB_CES[ce];
    return [`${pad("C", 5)}${x.net}/${x.len} is directly connected, ${age(s)}, ${xrIf(x.ifn)}`, `${pad("L", 5)}${x.gw}/${x.fam === 4 ? 32 : 128} is directly connected, ${age(s)}, ${xrIf(x.ifn)}`];
  });
  return ["Codes: C - connected, S - static, R - RIP, B - BGP, (>) - Diversion path", "       L - local, a - Application route", "", "Gateway of last resort is not set", "", ...(rows.length ? rows : ["% No matching routes found"])].join("\n");
}
function xrBgpVrf(s: EbState, r: EbR, v: Vrf): string {
  if (r !== "R6") return `% VRF ${v} not found`;
  const af = s.cfg.R6.vrfs[v];
  const sids = s.view.sids.R6.filter((x) => x.vrf === v);
  const rows = s.view.vrfTable[v].map((ce) => {
    const x = EB_CES[ce];
    const sid = sids.find((y) => !y.ce || y.ce === ce);
    return `*> ${pad(`${x.net}/${x.len}`, 19)}${pad("0.0.0.0", 20)}0         32768 ?${sid ? `  SID ${sid.sid}` : ""}`;
  });
  return [`BGP VRF ${v}, state: Active`, `BGP Route Distinguisher: ${RD[v]}`, `VRF ID: 0x6000000${v === "CUST4" ? 1 : 2}`, `BGP router identifier 6.6.6.6, local AS number 65000`, `SRv6 locator: ${af?.loc ?? "(none)"}${af?.loc ? `, alloc mode ${af.mode}` : ""}${s.view.vrfWhy[v] ? ` — ${s.view.vrfWhy[v]}` : ""}`, "", "Status codes: s suppressed, d damped, h history, * valid, > best", "Origin codes: i - IGP, e - EGP, ? - incomplete", "   Network            Next Hop            Metric LocPrf Weight Path", `Route Distinguisher: ${RD[v]} (default for vrf ${v})`, ...rows, "", `Processed ${rows.length} prefixes, ${rows.length} paths`].join("\n");
}
function xrLogging(s: EbState, r: EbR): string {
  const lines = s.sys.filter((x) => x.dev === r).slice(-30).map((x) => {
    const st = `RP/0/RP0/CPU0:${spStamp(x.t).xr}`;
    const i = x.peer && x.kind.startsWith("adj") ? ebIfTo(r, x.peer as EbR) : undefined;
    if (x.kind === "adj-up" || x.kind === "adj-down") return `${st}: isis[1012]: %ROUTING-ISIS-5-ADJCHANGE : Adjacency to ${x.peer} (${i ? xrIf(i.ifn) : "?"}) (L2) ${x.kind === "adj-up" ? "Up, New adjacency" : "Down, Neighbor forgot us"}`;
    if (x.kind === "sid") return `${st}: sidmgr[1180]: %ROUTING-SRV6-6-SID_UPDATE : SRv6 SID table changed on locator MAIN`;
    return `${st}: config[65857]: %MGBL-CONFIG-6-DB_COMMIT : Configuration committed by user 'admin'. Use 'show commit changes ${1000000000 + x.t}' to view the changes.`;
  });
  return ["Syslog logging: enabled (0 messages dropped, 0 flushes, 0 overruns)", `    Buffer logging: level debugging, ${lines.length} messages logged`, "", "Log Buffer (2097152 bytes):", "", ...lines].join("\n");
}
function xrPing(s: EbState, r: EbR, ip: string): string {
  const n = v6norm(ip)!;
  let at: EbR = r;
  let ok = false;
  for (let k = 0; k < 10; k++) {
    const sid = ebSid(s.view, at, n);
    if (sid || EB_LO(at) === n) {
      ok = !sid || sid.behavior === "End" || sid.behavior === "End.X";
      break;
    }
    const rt = ebRoute(s.cfg, s.view, at, n);
    const lo = EB_ROUTERS.find((x) => EB_LO(x) === n);
    if (lo) {
      ok = !!s.view.spf[r].find((x) => x.dst === lo);
      break;
    }
    if (!rt.nh) break;
    at = rt.nh.nh;
  }
  return ["Type escape sequence to abort.", `Sending 5, 100-byte ICMP Echos to ${n}, timeout is 2 seconds:`, (ok ? "!" : "U").repeat(5), ok ? "Success rate is 100 percent (5/5), round-trip min/avg/max = 1/3/5 ms" : "Success rate is 0 percent (0/5)"].join("\n");
}

// ---------------------------------------------------------------------------------------------------------------
// Configuration as IOS XR prints it
// ---------------------------------------------------------------------------------------------------------------
export function ebXrLines(r: EbR, c: EbRtr): string[] {
  const out: string[] = [`hostname ${r}`, "!"];
  if (r === "R6") for (const v of VRFS) out.push(`vrf ${v}`, ` address-family ${VRF_FAM[v]} unicast`, `  import route-target`, `   ${RD[v]}`, "  !", `  export route-target`, `   ${RD[v]}`, "  !", " !", "!");
  out.push("interface Loopback0", ` ipv6 address ${EB_LO(r)}/128`, "!");
  for (const i of ebIfs(r)) out.push(`interface ${xrIf(i.ifn)}`, ` description to ${i.peer}`, " mtu 9216", ` ipv6 address ${i.ip}/64`, "!");
  if (r === "R1") out.push(`interface ${xrIf(H1.ifn)}`, " description to H1", ` ipv6 address ${H1.gw}/64`, "!");
  if (r === "R6") for (const ce of CE_IDS) { const x = EB_CES[ce]; const v = c.ceVrf[x.ifn]; out.push(`interface ${xrIf(x.ifn)}`, ` description to ${ce}`, ...(v ? [` vrf ${v}`] : []), x.fam === 4 ? ` ipv4 address ${x.gw} 255.255.255.0` : ` ipv6 address ${x.gw}/64`, "!"); }
  out.push("router isis CORE", " is-type level-2-only", ` net 49.0001.0000.0000.000${EB_IDX[r]}.00`, " address-family ipv6 unicast", "  metric-style wide", ...(c.isisLoc ? ["  segment-routing srv6", "   locator MAIN", "   !", "  !"] : []), " !", " interface Loopback0", "  passive", "  address-family ipv6 unicast", "  !", " !");
  for (const i of ebIfs(r)) {
    const f = c.ifs[i.ifn]!;
    if (!f.isis) continue;
    out.push(` interface ${xrIf(i.ifn)}`, "  point-to-point", "  address-family ipv6 unicast", ...(f.metric !== 10 ? [`   metric ${f.metric}`] : []), "  !", " !");
  }
  out.push("!");
  if (r === "R6") {
    out.push("router bgp 65000", " bgp router-id 6.6.6.6");
    for (const v of VRFS) {
      const af = c.vrfs[v];
      out.push(` vrf ${v}`, `  rd ${RD[v]}`, `  address-family ${VRF_FAM[v]} unicast`, ...(af?.loc ? ["   segment-routing srv6", `    locator ${af.loc}`, `    alloc mode ${af.mode}`, "   !"] : []), "   redistribute connected", "  !", " !");
    }
    out.push("!");
  }
  if (c.sr6) out.push("segment-routing", " srv6", ...(r === "R1" ? ["  encapsulation", `   source-address ${EB_LO("R1")}`, "  !"] : []), ...(c.loc !== undefined ? ["  locators", "   locator MAIN", `    prefix ${locPrefix(c.loc)}/64`, "   !", "  !"] : []), " !", "!");
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Configuration statements
// ---------------------------------------------------------------------------------------------------------------
function stmts(r: EbR): SpCfgStmt<EbRtr>[] {
  const P2P = "% This lab keeps every core link point-to-point.";
  const R6ONLY = "% The VPN services of this lab are configured on R6.";
  const vaf = (c: EbRtr, x: Record<string, string>) => (c.vrfs[x.vrf as Vrf] ??= { mode: "per-vrf" });
  return [
    { id: "sr", summary: "Segment Routing", xr: { mode: "config", syntax: "segment-routing", enter: "sr", apply: (c) => c } },
    { id: "srv6", summary: "Segment Routing over IPv6", xr: { mode: "sr", syntax: "srv6", enter: "srv6", apply: (c) => ((c.sr6 = true), c), no: (c) => ((c.sr6 = false), (c.loc = undefined), c) } },
    { id: "locs", summary: "SRv6 locators", xr: { mode: "srv6", syntax: "locators", enter: "srv6-locs", apply: (c) => c, no: (c) => ((c.loc = undefined), c) } },
    { id: "loc", summary: "An SRv6 locator", args: { name: choiceArg(["MAIN"], () => "Locator name") }, xr: { mode: "srv6-locs", syntax: "locator <name>", enter: "srv6-loc", apply: (c) => c, no: (c) => ((c.loc = undefined), c) } },
    { id: "loc-pfx", summary: "The locator prefix", args: { pfx: pfxArg }, xr: { mode: "srv6-loc", syntax: "prefix <pfx>", apply: (c, a) => { const [ip, len] = a.pfx.split("/"); const h = ip.split(":"); if (+len !== 64 || !ip.startsWith("2001:db8:100:") || h.length < 4 || !/^[0-9a-f]{1,4}$/.test(h[3]) || !ip.endsWith("::")) return "% This lab allocates locators as /64s from 2001:db8:100::/48."; c.loc = parseInt(h[3], 16); return c; }, no: (c) => ((c.loc = undefined), c) } },
    { id: "router-isis", summary: "IS-IS routing protocol", args: { tag: choiceArg(["CORE"], () => "Instance tag") }, xr: { mode: "config", syntax: "router isis <tag>", enter: "isis", apply: (c) => c } },
    { id: "isis-af6", summary: "Enter the IPv6 unicast address family", xr: { mode: "isis", syntax: "address-family ipv6 unicast", enter: "isis-af6", apply: (c) => c } },
    { id: "isis-ms", summary: "Use wide metrics", args: { w: choiceArg(["wide"], () => "Wide metrics") }, xr: { mode: "isis-af6", syntax: "metric-style <w>", apply: (c) => c, no: () => "% SRv6 needs wide metrics." } },
    { id: "isis-srv6", summary: "SRv6 in IS-IS", xr: { mode: "isis-af6", syntax: "segment-routing srv6", enter: "isis-srv6", apply: (c) => c, no: (c) => ((c.isisLoc = false), c) } },
    { id: "isis-loc", summary: "Advertise this locator and allocate End / End.X", args: { lname: choiceArg(["MAIN"], () => "Locator name") }, xr: { mode: "isis-srv6", syntax: "locator <lname>", apply: (c) => ((c.isisLoc = true), c), no: (c) => ((c.isisLoc = false), c) } },
    { id: "isis-if", summary: "Enter the IS-IS interface configuration submode", args: { if: ifArg(r, "isis") }, xr: { mode: "isis", syntax: "interface <if>", enter: "isis-if", apply: (c, a) => (a.if === "lo0" ? c : ((ifc(c, a.if).isis = true), c)), no: (c, a) => (a.if === "lo0" ? "% This lab keeps Loopback0 in IS-IS." : ((ifc(c, a.if).isis = false), c)) } },
    { id: "isis-p2p", summary: "Treat the interface as point-to-point", xr: { mode: "isis-if", syntax: "point-to-point", apply: (c) => c, no: () => P2P } },
    { id: "isis-passive", summary: "Advertise the prefix but send no hellos", xr: { mode: "isis-if", syntax: "passive", apply: (c, _a, x) => (x.if === "lo0" ? c : "% This lab only uses passive on Loopback0.") } },
    { id: "isis-if-af6", summary: "Enter the interface IPv6 unicast address family", xr: { mode: "isis-if", syntax: "address-family ipv6 unicast", enter: "isis-if-af6", apply: (c) => c } },
    { id: "isis-metric", summary: "Set the default metric for this interface", args: { n: numArg(1, 16777214, ["5", "10", "20"], "Default metric") }, xr: { mode: "isis-if-af6", syntax: "metric <n>", noSyntax: "metric", apply: (c, a, x) => (x.if === "lo0" ? "% This lab keeps Loopback0 at metric 0." : ((ifc(c, x.if).metric = +a.n), c)), no: (c, _a, x) => (x.if === "lo0" ? c : ((ifc(c, x.if).metric = defMetric(r, x.if)), c)) } },
    { id: "ceif", summary: "Customer interface configuration", args: { gif: ifArg(r, "ce") }, xr: { mode: "config", syntax: "interface <gif>", enter: "ceif", apply: (c) => (r === "R6" ? c : R6ONLY), no: () => "% This lab keeps its interfaces." } },
    { id: "ceif-vrf", summary: "Put the interface in a VRF", args: { ivrf: vrfArg }, xr: { mode: "ceif", syntax: "vrf <ivrf>", noSyntax: "vrf", apply: (c, a, x) => { const ce = CE_IDS.find((y) => EB_CES[y].ifn === x.gif)!; return EB_CES[ce].vrf !== a.ivrf ? `% ${ce} belongs to VRF ${EB_CES[ce].vrf} in this lab.` : ((c.ceVrf[x.gif as IfName] = a.ivrf as Vrf), c); }, no: (c, _a, x) => ((c.ceVrf[x.gif as IfName] = undefined), c) } },
    { id: "bgp", summary: "BGP", args: { asn: choiceArg(["65000"], () => "AS number") }, xr: { mode: "config", syntax: "router bgp <asn>", enter: "bgp", apply: (c) => (r === "R6" ? c : R6ONLY) } },
    { id: "bgp-vrf", summary: "A VRF in BGP", args: { vrf: vrfArg }, xr: { mode: "bgp", syntax: "vrf <vrf>", enter: "bgp-vrf", apply: (c) => c, no: (c, a) => (delete c.vrfs[a.vrf as Vrf], c) } },
    { id: "bgp-vrf-af", summary: "The VRF's address family", args: { fam: choiceArg(["ipv4", "ipv6"], (f) => `${f.toUpperCase()} unicast`), safi: choiceArg(["unicast"], () => "Unicast") }, xr: { mode: "bgp-vrf", syntax: "address-family <fam> <safi>", enter: "bgp-vrf-af", apply: (c, a, x) => (VRF_FAM[x.vrf as Vrf] !== a.fam ? `% VRF ${x.vrf} is ${VRF_FAM[x.vrf as Vrf]} in this lab.` : (vaf(c, x), c)), no: (c, _a, x) => (delete c.vrfs[x.vrf as Vrf], c) } },
    { id: "bgp-srv6", summary: "SRv6 SIDs for this VRF", xr: { mode: "bgp-vrf-af", syntax: "segment-routing srv6", enter: "bgp-srv6", apply: (c, _a, x) => (vaf(c, x), c), no: (c, _a, x) => ((vaf(c, x).loc = undefined), c) } },
    { id: "bgp-srv6-loc", summary: "Allocate the VRF's SIDs from this locator", args: { bloc: { choices: ["MAIN"], describe: () => "Locator name", resolve: (raw) => (/^[A-Za-z][\w-]{0,31}$/.test(raw) ? raw : undefined) } }, xr: { mode: "bgp-srv6", syntax: "locator <bloc>", noSyntax: "locator", apply: (c, a, x) => ((vaf(c, x).loc = a.bloc), c), no: (c, _a, x) => ((vaf(c, x).loc = undefined), c) } },
    { id: "bgp-srv6-mode", summary: "One SID per VRF (End.DT) or one per CE (End.DX)", args: { mode: choiceArg(["per-vrf", "per-ce"], (m) => (m === "per-vrf" ? "End.DT4/DT6: decapsulate and look up in the VRF" : "End.DX4/DX6: decapsulate and send to one CE")) }, xr: { mode: "bgp-srv6", syntax: "alloc mode <mode>", noSyntax: "alloc mode", apply: (c, a, x) => ((vaf(c, x).mode = a.mode as "per-vrf" | "per-ce"), c), no: (c, _a, x) => ((vaf(c, x).mode = "per-vrf"), c) } },
  ];
}

// ---------------------------------------------------------------------------------------------------------------
// Command set
// ---------------------------------------------------------------------------------------------------------------
export function ebXrSpec(api: EbCliApi, r: EbR): SpXrSpec<EbRtr> {
  const s = api.s;
  const sh = (id: string, syntax: string, summary: string, run: SpCmd["run"], args?: SpCmd["args"]): SpCmd => ({ id, syntax, summary, run, args });
  const nothing = (o: string, why: string) => o || { output: "", explanation: why };
  const sidArg = v6Arg(allSids(s).length ? allSids(s) : [ebEnd(r)], "An SRv6 SID");
  const anyV6 = v6Arg([ebEnd("R3"), ebEnd("R6"), EB_LO("R6")], "IPv6 address");
  return {
    stmts: stmts(r),
    prompts: { config: "config", sr: "config-sr", srv6: "config-srv6", "srv6-locs": "config-srv6-locators", "srv6-loc": "config-srv6-locator", isis: "config-isis", "isis-af6": "config-isis-af", "isis-srv6": "config-isis-srv6", "isis-if": "config-isis-if", "isis-if-af6": "config-isis-if-af", ceif: "config-if", bgp: "config-bgp", "bgp-vrf": "config-bgp-vrf", "bgp-vrf-af": "config-bgp-vrf-af", "bgp-srv6": "config-bgp-vrf-af-srv6" },
    lines: (c) => ebXrLines(r, c),
    help: { "show segment-routing": "Segment routing information", "show segment-routing srv6": "SRv6 information", "show isis": "IS-IS information", "show route": "IP routing table", "show bgp": "BGP information", "show vrf": "VRF information" },
    shows: [
      sh("sid", "show segment-routing srv6 sid", "The local SID table: every SID and its behavior", () => nothing(xrSids(s, r), "No local SID is allocated.")),
      sh("sidx", "show segment-routing srv6 sid <sid>", "One local SID", (a) => nothing(xrSids(s, r, a.sid), "No such local SID on this router."), { sid: sidArg }),
      sh("sidd", "show segment-routing srv6 sid <sid> detail", "One local SID with its context (VRF table, CE, interface)", (a) => nothing(xrSids(s, r, a.sid, true), "No such local SID on this router."), { sid: sidArg }),
      sh("loc", "show segment-routing srv6 locator", "This router's SRv6 locators", () => nothing(xrLocator(s, r), "No SRv6 locator is configured.")),
      sh("isloc", "show isis segment-routing srv6 locators", "Locators IS-IS advertises", () => xrIsisLocators(s, r)),
      sh("db", "show isis database verbose", "Every LSP: locators, End and End.X SIDs", () => xrDatabase(s)),
      sh("dbl", "show isis database verbose <lsp>", "One router's LSP", (a) => xrDatabase(s, a.lsp as EbR), { lsp: lspArg }),
      sh("adj", "show isis adjacency", "IS-IS adjacencies", () => xrAdj(s, r)),
      sh("rt6", "show route ipv6", "The IPv6 routing table (locators and loopbacks)", () => xrRoutes(s, r)),
      sh("rt6ip", "show route ipv6 <ip>", "The route a SID uses", (a) => xrRouteIp(s, r, a.ip), { ip: anyV6 }),
      sh("vrf", "show vrf all", "VRFs and their interfaces", () => nothing(xrVrfAll(s, r), "No VRF is configured on this router.")),
      sh("rv4", "show route vrf <v4>", "VRF CUST4's IPv4 table", () => xrRouteVrf(s, r, "CUST4"), { v4: choiceArg(["CUST4"], () => "IPv4 VRF") }),
      sh("rv6", "show route vrf <v6> ipv6", "VRF CUST6's IPv6 table", () => xrRouteVrf(s, r, "CUST6"), { v6: choiceArg(["CUST6"], () => "IPv6 VRF") }),
      sh("bv", "show bgp vrf <bvrf> <bfam> unicast", "A VRF in BGP, with its SRv6 SIDs", (a) => (VRF_FAM[a.bvrf as Vrf] !== a.bfam ? `% VRF ${a.bvrf} has no ${a.bfam} address family` : xrBgpVrf(s, r, a.bvrf as Vrf)), { bvrf: vrfArg, bfam: choiceArg(["ipv4", "ipv6"], (f) => f.toUpperCase()) }),
      sh("log", "show logging", "The syslog buffer", () => xrLogging(s, r)),
    ],
    exec: [sh("ping", "ping <dst>", "Send ICMPv6 echoes (an instantiated SID answers)", (a) => xrPing(s, r, a.dst), { dst: anyV6 })],
  };
}
export function ebSets(api: EbCliApi, r: EbR): Partial<Record<CliVendor, CliCommandSet>> {
  return { cisco: buildXrSet(api.dev, ebXrSpec(api, r)) };
}
export function ebStaticApi(s: EbState, r: EbR): EbCliApi {
  return { s, act: () => s, dev: { host: r, running: s.cfg[r], hist: s.hist[r], setCand: () => undefined, xr: [], setXr: () => undefined, edit: false, setEdit: () => undefined, commit: () => undefined } };
}
export { ebSidOwner };
