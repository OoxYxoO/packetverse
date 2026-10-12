import type { CliArgSpec, CliCommandSet, CliVendor } from "@/lib/cli/types";
import { buildXrSet, choiceArg, numArg, type SpCfgStmt, type SpCmd, type SpDevCli, type SpXrSpec } from "@/components/sp-lab/spCli";
import { pad, spAge, spStamp } from "@/components/sp-lab/spKit";
import { xrIf } from "@/components/sp-lab/spNames";
import { v6norm } from "@/lib/sim-engine/scenarios/sxNet";
import {
  BLOCK_TEXT,
  CAP,
  CE,
  LIST,
  MTU6,
  U_LO,
  U_N,
  U_ROUTERS,
  encode,
  hx,
  linkIp,
  locOf,
  ownerByLocator,
  sidOwner,
  uIfs,
  uPing,
  type UAction,
  type URtr,
  type UR,
  type UState,
  type USid,
} from "@/lib/sim-engine/scenarios/ucNet";

/**
 * Command lines of the SRv6 uSID Lab — IOS XR on R1–R8. Every output is printed from the lab model.
 *
 *   show segment-routing srv6 locator · show segment-routing srv6 sid [<sid> detail] · show isis segment-routing srv6
 *   locators · show segment-routing traffic-eng policy [color <c>] · show cef vrf CUST <ip> · show route ipv6 [<ip>]
 *   · show ipv6 interface brief · show logging · ping vrf CUST <ip> [size <n>] · ping <ipv6>
 *   configure → segment-routing → srv6 → locators → locator MAIN → micro-segment behavior unode psp-usd
 *             → segment-routing → traffic-eng → segment-lists → srv6 → sid-format usid-f3216 (R1)
 *                                                            → segment-list PATH-A → srv6 → index <n> sid <sid> (R1)
 *             → router isis CORE → address-family ipv6 unicast → segment-routing srv6 → locator MAIN
 */

export interface UcCliApi {
  s: UState;
  act: (a: UAction) => UState;
  dev: SpDevCli<URtr>;
}
const age = (s: UState) => spAge(s.clock, 15);
const ll = (r: UR) => `fe80::${U_N[r]}`;
const isPe = (r: UR) => r === "R1" || r === "R8";
const R1ONLY = "% Policy GREEN and its segment list live on R1 (the headend) in this lab.";

// ---------------------------------------------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------------------------------------------
const v6Arg = (choices: string[], what: string): CliArgSpec => ({ choices, describe: () => what, resolve: (raw) => v6norm(raw) });
const v4ok = (x: string) => /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(x) && x.split(".").every((o) => +o <= 255);
const allSids = (s: UState) => U_ROUTERS.flatMap((r) => s.view.sids[r].map((x) => x.sid));
const sidArg = (s: UState): CliArgSpec => ({ choices: allSids(s).slice(0, 12), describe: (c) => { const o = sidOwner(s.view.sids, c); const x = o ? s.view.sids[o].find((y) => y.sid === v6norm(c)) : undefined; return x ? `${o} ${x.behavior}${x.peer ? ` → ${x.peer}` : ""}` : "SRv6 SID"; }, resolve: (raw) => v6norm(raw) });

// ---------------------------------------------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------------------------------------------
const behText = (x: USid) => (x.behavior === "uDT4" || x.behavior === "End.DT4" ? x.behavior : x.behavior === "uB6" ? "uB6 (Insert.Red)" : x.behavior === "End.B6" ? "End.B6.Insert.Red" : `${x.behavior} (PSP/USD)`);
const bsid = (s: UState) => s.view.sids.R1.find((x) => x.behavior === "uB6" || x.behavior === "End.B6")!;
function xrLocator(s: UState, r: UR): string {
  const m = s.cfg[r].micro;
  return [`${pad("Name", 22)}${pad("ID", 9)}${pad("Algo", 6)}${pad("Prefix", 26)}${pad("Status", 9)}Flags`, `${pad("--------------------", 22)}${pad("-------", 9)}${pad("----", 6)}${pad("------------------------", 26)}${pad("-------", 9)}--------`, `${pad("MAIN", 22)}${pad("1", 9)}${pad("0", 6)}${pad(`${locOf(r)}/48`, 26)}${pad("Up", 9)}${m ? "U" : ""}`, "", "Flags: U - Micro-segment (behavior: unode psp-usd)"].join("\n");
}
function xrSids(s: UState, r: UR): string {
  const rows = s.view.sids[r];
  const ctx = (x: USid) => (x.behavior === "uN" || x.behavior === "End" ? "'default':1" : x.ifn ? `[${xrIf(x.ifn, true)}, Link-Local]` : x.behavior.includes("B6") ? "'GREEN'" : "'CUST'");
  return ["", "*** Locator: 'MAIN' *** ", "", "SID                         Behavior          Context                           Owner               State  RW", "--------------------------  ----------------  --------------------------------  ------------------  -----  --", ...rows.map((x) => `${pad(x.sid, 28)}${pad(behText(x), 18)}${pad(ctx(x), 34)}${pad(x.behavior.endsWith("DT4") ? "bgp-65000" : x.behavior.includes("B6") ? "xtc_srv6" : "isis-CORE", 20)}${pad("InUse", 7)}Y`)].join("\n");
}
function xrSidDetail(s: UState, r: UR, sid: string): string {
  const x = s.view.sids[r].find((y) => y.sid === v6norm(sid));
  if (!x) return "";
  return [xrSids(s, r).split("\n").slice(0, 5).join("\n"), `${pad(x.sid, 28)}${pad(behText(x), 18)}`, `  SID Function: 0x${x.micro ? hx(x.usids![1] ?? 0) : hx(parseInt(x.sid.split(":")[3] || "0", 16))}`, `  SID context: { ${x.peer ? `intf=${xrIf(x.ifn!)} nh=${ll(x.peer)}` : x.behavior.endsWith("DT4") ? "table-id=0xe0000001 ('CUST':IPv4/Unicast)" : "'default':1"} }`, `  Locator: 'MAIN'`, `  Allocation type: Dynamic`, x.micro ? `  SID structure: format usid-f3216, LBL 32, LNL 16, FL ${x.behavior === "uN" ? 0 : 16}, AL ${x.behavior === "uN" ? 80 : 64}` : "  SID structure: format base, LBL 48, LNL 0, FL 16, AL 64", x.micro ? `  uSID(s) carried: ${x.usids!.map((u) => hx(u)).join(" ")} (${x.usids!.length} of ${CAP} per carrier)` : "  uSID(s) carried: none — a classic SID always fills a whole 128-bit entry", `  Created: ${spStamp(30).xr} (${age(s)} ago)`].join("\n");
}
function xrIsisLocators(s: UState, r: UR): string {
  return ["", "IS-IS CORE SRv6 Locators", `${pad("Name", 22)}${pad("ID", 9)}${pad("Algo", 6)}${pad("Prefix", 26)}Status`, `${pad("------", 22)}${pad("----", 9)}${pad("----", 6)}${pad("------", 26)}------`, ...(s.cfg[r].isisLoc ? [`${pad("MAIN", 22)}${pad("1", 9)}${pad("0", 6)}${pad(`${locOf(r)}/48`, 26)}Active`] : [])].join("\n");
}
function xrPolicy(s: UState, r: UR, color?: number): string {
  if (r !== "R1") return "";
  if (color !== undefined && color !== 10) return `No policy with color ${color}.`;
  const v = s.view;
  const sids = v.policy.sids;
  const pack = encode(s.cfg, v.sids, sids);
  const lines = sids.map((x, i) => {
    const o = sidOwner(v.sids, x);
    const y = o ? v.sids[o].find((z) => z.sid === x) : undefined;
    return `          SID[${i}]: ${x} [${y ? `${behText(y)}${y.peer ? `, ${o}→${y.peer}` : `, ${o}`}` : "unknown"}]`;
  });
  return ["", "SR-TE policy database", "---------------------", "", `Color: 10, End-point: ${U_LO("R8")}`, `  Name: srte_c_10_ep_${U_LO("R8")}`, "  Status:", `    Admin: up  Operational: ${v.policy.up ? `up for ${age(s)}` : "down"}`, "  Candidate-paths:", "    Preference: 100 (configuration) (active)", "      Name: GREEN", "      Requested BSID: dynamic", `      Explicit: segment-list ${LIST} (${v.policy.up ? "valid" : "invalid"})${v.policy.up ? "" : `\n        Reason: ${v.policy.why}`}`, `        SRv6 Information:`, `          SID format: ${s.cfg.R1.fmt ? "usid-f3216" : "(none — classic 128-bit SIDs)"}`, ...lines, `          Packed SID list: ${pack.entries.length ? `{${pack.entries.map((e) => e.text).join(", ")}}` : "{}"} (${pack.entries.length} carrier${pack.entries.length === 1 ? "" : "s"} for ${sids.length} SIDs)`, "  Attributes:", `    Binding SID: ${bsid(s).sid}`, `      SRv6 Behavior: ${behText(bsid(s))}`, "    Forward Class: Not Configured", "    Steering BGP disabled: no", ""].join("\n");
}
function xrCefVrf(s: UState, r: UR, ip: string): string {
  if (!isPe(r)) return "% VRF CUST not found";
  if (r === "R8" || !ip.startsWith("10.8.1.")) return `${ip}/32, version 0, drop adjacency`;
  const g = s.view.green;
  return [`${CE.CE8.lan}, version 61, SRv6 Headend, internal 0x5000001 0x30 (ptr 0x8e3a2b10) [1], 0x0 (0x0), 0x0 (0x0)`, ` Updated ${spStamp(40).xr.replace(" UTC", "")}`, " Prefix Len 24, traffic index 0, precedence n/a, priority 3", s.view.policy.up ? `   via ${bsid(s).sid}/128, 3 dependencies, recursive [flags 0x6000] (GREEN)` : `   via ${U_LO("R8")}/128, 3 dependencies, recursive [flags 0x6000]`, "    path-idx 0 NHID 0x0 [0x8e1f0a40 0x0]", `    next hop ${ll("R2")}/128 ${xrIf("ge-0/0/0", true)}`, `     SRv6 H.Encaps.Red SID-list {${g.entries.map((e) => e.text).join(" ")}}`, `     Encapsulation overhead: ${g.overhead} bytes (IPv6 40 + SRH ${g.srhBytes})`].join("\n");
}
function xrRoute6(s: UState, r: UR): string {
  const rows: string[] = [`${pad("L", 5)}${U_LO(r)}/128 is directly connected,`, `      ${age(s)}, Loopback0`];
  if (s.cfg[r].isisLoc) rows.push(`${pad("L", 5)}${locOf(r)}/48 is directly connected,`, `      ${age(s)}, Null0 (SRv6 locator)`);
  for (const rt of [...s.view.rib[r]].sort((a, b) => U_N[a.dst] - U_N[b.dst])) {
    rows.push(`${pad("i L2", 5)}${U_LO(rt.dst)}/128`, `      [115/${rt.cost + 10}] via ${ll(rt.nh!.r)}, ${age(s)}, ${xrIf(rt.nh!.ifn)}`);
    if (s.cfg[rt.dst].isisLoc) rows.push(`${pad("i L2", 5)}${locOf(rt.dst)}/48`, `      [115/${rt.cost + 1}] via ${ll(rt.nh!.r)}, ${age(s)}, ${xrIf(rt.nh!.ifn)}`);
  }
  return ["Codes: C - connected, S - static, R - RIP, B - BGP, (>) - Diversion path", "       O - OSPF, IA - OSPF inter area, i - ISIS, L1 - IS-IS level-1, L2 - IS-IS level-2", "       L - local, a - Application route", "", "Gateway of last resort is not set", "", ...rows].join("\n");
}
function xrRoute6Ip(s: UState, r: UR, ip: string): string {
  const o = ownerByLocator(ip) ?? U_ROUTERS.find((x) => U_LO(x) === v6norm(ip));
  const isLo = o && U_LO(o) === v6norm(ip);
  if (!o || (!isLo && !s.cfg[o].isisLoc)) return "% Network not in table";
  const pfx = isLo ? `${U_LO(o)}/128` : `${locOf(o)}/48`;
  if (o === r) return [`Routing entry for ${pfx}`, `  Known via "local", distance 0, metric 0${isLo ? "" : " (SRv6 locator)"}`, "  Routing Descriptor Blocks", `    directly connected, via ${isLo ? "Loopback0" : "Null0"}`].join("\n");
  const rt = s.view.rib[r].find((x) => x.dst === o)!;
  return [`Routing entry for ${pfx}`, `  Known via "isis CORE", distance 115, metric ${rt.cost + (isLo ? 10 : 1)}, type level-2${isLo ? "" : ", SRv6 locator"}`, `  Installed ${spStamp(15).xr.replace(" UTC", "")} for ${age(s)}`, "  Routing Descriptor Blocks", `    ${ll(rt.nh!.r)}, from ${U_LO(o)}, via ${xrIf(rt.nh!.ifn)}`, `      Route metric is ${rt.cost + (isLo ? 10 : 1)}`, "  No advertising protos."].join("\n");
}
function xrIpv6Brief(s: UState, r: UR): string {
  const rows = uIfs(r).map((i) => `${pad(xrIf(i.ifn), 36)}[Up/Up]\n    ${linkIp(i.link, r)}  (MTU 1514, IPv6 MTU ${MTU6})`);
  return [`${pad("Loopback0", 36)}[Up/Up]\n    ${U_LO(r)}`, ...rows].join("\n");
}
function xrPingVrf(api: UcCliApi, r: UR, ip: string, size: number): string {
  if (r !== "R1") return r === "R8" ? "% This lab sends CUST probes from site 1 (R1)." : "% VRF CUST not found";
  if (!v4ok(ip) || ip !== CE.CE8.host) return ["Type escape sequence to abort.", `Sending 5, ${size}-byte ICMP Echos to ${ip}, timeout is 2 seconds:`, ".....", "Success rate is 0 percent (0/5)"].join("\n");
  const ns = uPing(api.s, size);
  api.act({ type: "ping", size });
  const w = ns.tests.at(-1)!.walk;
  return ["Type escape sequence to abort.", `Sending 5, ${size}-byte ICMP Echos to ${ip} vrf CUST, timeout is 2 seconds:`, w.ok ? "!!!!!" : w.why?.includes("MTU") ? "MMMMM" : ".....", w.ok ? `Success rate is 100 percent (5/5), round-trip min/avg/max = ${2 * w.ms}/${2 * w.ms + 1}/${2 * w.ms + 3} ms` : "Success rate is 0 percent (0/5)"].join("\n");
}
function xrPing6(s: UState, r: UR, ip: string): string {
  const n = v6norm(ip)!;
  const lo = U_ROUTERS.find((x) => U_LO(x) === n);
  const o = lo ?? ownerByLocator(n);
  const sid = o ? s.view.sids[o].find((x) => x.sid === n) : undefined;
  const reach = !!o && (o === r || lo !== undefined || s.cfg[o].isisLoc);
  const ok = reach && (lo !== undefined || (!!sid && (sid.behavior === "uN" || sid.behavior === "End")));
  return ["Type escape sequence to abort.", `Sending 5, 100-byte ICMP Echos to ${n}, timeout is 2 seconds:`, (ok ? "!" : reach ? "U" : ".").repeat(5), ok ? "Success rate is 100 percent (5/5), round-trip min/avg/max = 1/2/4 ms" : "Success rate is 0 percent (0/5)"].join("\n");
}
function xrLogging(s: UState, r: UR): string {
  const lines = s.sys.filter((x) => x.dev === r).slice(-30).map((x) => {
    const st = `RP/0/RP0/CPU0:${spStamp(x.t).xr}`;
    if (x.kind === "adj-up") return `${st}: isis[1012]: %ROUTING-ISIS-5-ADJCHANGE : Adjacency to ${x.peer} (${xrIf(uIfs(r).find((i) => i.peer === x.peer)!.ifn)}) (L2) Up, New adjacency`;
    if (x.kind === "policy") return `${st}: xtc_agent[1166]: %ROUTING-XTC-5-SR_POLICY_UPDOWN : SR policy 'GREEN' (color 10, end-point ${U_LO("R8")}) state changed to ${s.view.policy.up ? "UP" : "DOWN"}`;
    return `${st}: config[65857]: %MGBL-CONFIG-6-DB_COMMIT : Configuration committed by user 'admin'. Use 'show commit changes ${1000000000 + x.t}' to view the changes.`;
  });
  return ["Syslog logging: enabled (0 messages dropped, 0 flushes, 0 overruns)", `    Buffer logging: level debugging, ${lines.length} messages logged`, "", "Log Buffer (2097152 bytes):", "", ...lines].join("\n");
}

// ---------------------------------------------------------------------------------------------------------------
// Configuration as IOS XR prints it
// ---------------------------------------------------------------------------------------------------------------
export function ucXrLines(r: UR, c: URtr): string[] {
  const out: string[] = [`hostname ${r}`, "!", "interface Loopback0", ` ipv6 address ${U_LO(r)}/128`, "!"];
  for (const i of uIfs(r)) out.push(`interface ${xrIf(i.ifn)}`, ` description to ${i.peer}${i.link.metric > 10 ? (i.link.id === "R6-R8" ? " (express)" : " (alternate)") : ""}`, " mtu 1514", ` ipv6 address ${linkIp(i.link, r)}/64`, "!");
  out.push("router isis CORE", " is-type level-2-only", ` net 49.0001.0000.0000.000${U_N[r]}.00`, " address-family ipv6 unicast", "  metric-style wide", ...(c.isisLoc ? ["  segment-routing srv6", "   locator MAIN", "   !", "  !"] : []), " !", " interface Loopback0", "  passive", "  address-family ipv6 unicast", "  !", " !");
  for (const i of uIfs(r)) out.push(` interface ${xrIf(i.ifn)}`, "  point-to-point", "  address-family ipv6 unicast", ...(i.link.metric !== 10 ? [`   metric ${i.link.metric}`] : []), "  !", " !");
  out.push("!", "segment-routing", " srv6", "  encapsulation", `   source-address ${U_LO(r)}`, "  !", "  locators", "   locator MAIN", ...(c.micro ? ["    micro-segment behavior unode psp-usd"] : []), `    prefix ${locOf(r)}/48`, "   !", "  !", " !");
  if (r === "R1") {
    out.push(" traffic-eng", "  segment-lists", ...(c.fmt ? ["   srv6", "    sid-format usid-f3216", "   !"] : []), `   segment-list ${LIST}`, "    srv6", ...[...(c.lists?.[LIST] ?? [])].sort((a, b) => a.idx - b.idx).map((e) => `     index ${e.idx} sid ${e.sid}`), "    !", "   !", "  !", "  policy GREEN", "   srv6", "    locator MAIN binding-sid dynamic behavior ub6-insert-reduced", "   !", "   color 10 end-point ipv6 2001:db8::8", "   candidate-paths", "    preference 100", `     explicit segment-list ${LIST}`, "     !", "    !", "   !", "  !", " !");
  }
  out.push("!");
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Configuration statements
// ---------------------------------------------------------------------------------------------------------------
function stmts(r: UR): SpCfgStmt<URtr>[] {
  const lst = (c: URtr) => ((c.lists ??= {})[LIST] ??= []);
  return [
    { id: "sr", summary: "Segment Routing", xr: { mode: "config", syntax: "segment-routing", enter: "sr", apply: (c) => c } },
    { id: "srv6", summary: "Segment Routing over IPv6", xr: { mode: "sr", syntax: "srv6", enter: "srv6", apply: (c) => c } },
    { id: "locs", summary: "SRv6 locators", xr: { mode: "srv6", syntax: "locators", enter: "locs", apply: (c) => c } },
    { id: "loc", summary: "An SRv6 locator", args: { lname: choiceArg(["MAIN"], () => "Locator name") }, xr: { mode: "locs", syntax: "locator <lname>", enter: "loc", apply: (c) => c, no: () => "% This lab keeps locator MAIN; change its behavior instead." } },
    { id: "loc-micro", summary: "Make the locator a uSID (micro-segment) locator: uN, uA, uDT SIDs", args: { b: choiceArg(["unode"], () => "Node behavior (uN)"), fl: choiceArg(["psp-usd"], () => "PSP and USD flavors") }, xr: { mode: "loc", syntax: "micro-segment behavior <b> <fl>", noSyntax: "micro-segment behavior", apply: (c) => ((c.micro = true), c), no: (c) => ((c.micro = false), c) } },
    { id: "loc-pfx", summary: "The locator prefix", args: { pfx: { choices: [`${locOf(r)}/48`], describe: () => "Locator prefix (block + this node's uSID)", resolve: (raw) => raw } }, xr: { mode: "loc", syntax: "prefix <pfx>", apply: (c, a) => (a.pfx.replace(/\/48$/, "") && v6norm(a.pfx.split("/")[0]) === locOf(r) && a.pfx.endsWith("/48") ? c : `% This lab allocates ${r}'s locator as ${locOf(r)}/48 from block ${BLOCK_TEXT}.`) } },
    { id: "te", summary: "SR Traffic Engineering", xr: { mode: "sr", syntax: "traffic-eng", enter: "te", apply: (c) => (r === "R1" ? c : R1ONLY) } },
    { id: "sls", summary: "Segment lists", xr: { mode: "te", syntax: "segment-lists", enter: "sls", apply: (c) => c } },
    { id: "sls-srv6", summary: "SRv6 settings for segment lists", xr: { mode: "sls", syntax: "srv6", enter: "sls-srv6", apply: (c) => c } },
    { id: "sls-fmt", summary: "Treat SRv6 SIDs as uSIDs and pack them into carriers", args: { f: choiceArg(["usid-f3216"], () => "32-bit block, 16-bit uSIDs") }, xr: { mode: "sls-srv6", syntax: "sid-format <f>", noSyntax: "sid-format", apply: (c) => ((c.fmt = true), c), no: (c) => ((c.fmt = false), c) } },
    { id: "sl", summary: "A segment list", args: { slname: choiceArg([LIST], () => "Segment list used by policy GREEN") }, xr: { mode: "sls", syntax: "segment-list <slname>", enter: "sl", apply: (c, a) => (a.slname === LIST ? c : `% Policy GREEN uses segment list ${LIST} in this lab.`), no: (c) => ((lst(c).length = 0), c) } },
    { id: "sl-srv6", summary: "SRv6 segments of the list", xr: { mode: "sl", syntax: "srv6", enter: "sl-srv6", apply: (c) => c } },
    {
      id: "sl-idx",
      summary: "A segment: its position and SID",
      args: { idx: numArg(1, 65535, ["10", "20", "30"], "Index (order in the list)"), sid: { choices: ["fcbb:bb00:2::", "fcbb:bb00:6:e002::"], describe: () => "SRv6 SID (uN, uA or classic)", resolve: (raw) => v6norm(raw) } },
      xr: {
        mode: "sl-srv6",
        syntax: "index <idx> sid <sid>",
        noSyntax: "index <idx>",
        apply: (c, a) => {
          const l = lst(c);
          const e = l.find((x) => x.idx === +a.idx);
          if (e) e.sid = a.sid;
          else l.push({ idx: +a.idx, sid: a.sid });
          return c;
        },
        no: (c, a) => ((c.lists![LIST] = lst(c).filter((x) => x.idx !== +a.idx)), c),
      },
    },
    { id: "router-isis", summary: "IS-IS routing protocol", args: { tag: choiceArg(["CORE"], () => "Instance tag") }, xr: { mode: "config", syntax: "router isis <tag>", enter: "isis", apply: (c) => c } },
    { id: "isis-af6", summary: "Enter the IPv6 unicast address family", xr: { mode: "isis", syntax: "address-family ipv6 unicast", enter: "isis-af6", apply: (c) => c } },
    { id: "isis-ms", summary: "Use wide metrics", args: { w: choiceArg(["wide"], () => "Wide metrics") }, xr: { mode: "isis-af6", syntax: "metric-style <w>", apply: (c) => c, no: () => "% SRv6 needs wide metrics." } },
    { id: "isis-srv6", summary: "SRv6 in IS-IS", xr: { mode: "isis-af6", syntax: "segment-routing srv6", enter: "isis-srv6", apply: (c) => c, no: (c) => ((c.isisLoc = false), c) } },
    { id: "isis-loc", summary: "Advertise this locator", args: { lname: choiceArg(["MAIN"], () => "Locator name") }, xr: { mode: "isis-srv6", syntax: "locator <lname>", apply: (c) => ((c.isisLoc = true), c), no: (c) => ((c.isisLoc = false), c) } },
  ];
}

// ---------------------------------------------------------------------------------------------------------------
// Command set
// ---------------------------------------------------------------------------------------------------------------
export function ucXrSpec(api: UcCliApi, r: UR): SpXrSpec<URtr> {
  const s = api.s;
  const sh = (id: string, syntax: string, summary: string, run: SpCmd["run"], args?: SpCmd["args"]): SpCmd => ({ id, syntax, summary, run, args });
  const nothing = (o: string, why: string) => o || { output: "", explanation: why };
  const any6 = v6Arg([U_LO("R8"), "fcbb:bb00:8::", "fcbb:bb00:6:e002::"], "IPv6 address (loopback, locator or SID)");
  return {
    stmts: stmts(r),
    prompts: { config: "config", sr: "config-sr", srv6: "config-srv6", locs: "config-srv6-locators", loc: "config-srv6-locator", te: "config-sr-te", sls: "config-sr-te-segment-lists", "sls-srv6": "config-sr-te-sl-srv6", sl: "config-sr-te-sl", "sl-srv6": "config-sr-te-sl-srv6", isis: "config-isis", "isis-af6": "config-isis-af", "isis-srv6": "config-isis-srv6" },
    lines: (c) => ucXrLines(r, c),
    help: { "show segment-routing": "Segment routing information", "show segment-routing srv6": "SRv6 information", "show segment-routing traffic-eng": "SR-TE information", "show isis": "IS-IS information", "show route": "IP routing table", "show cef": "Cisco Express Forwarding", "show ipv6": "IPv6 information" },
    shows: [
      sh("loc", "show segment-routing srv6 locator", "This router's locator: prefix and the U (micro-segment) flag", () => xrLocator(s, r)),
      sh("sid", "show segment-routing srv6 sid", "The local SID table: uN, uA (local uSIDs) and uDT4", () => xrSids(s, r)),
      sh("sidd", "show segment-routing srv6 sid <sid> detail", "One SID: function, structure, the uSIDs it carries", (a) => nothing(xrSidDetail(s, r, a.sid), "No such local SID on this router."), { sid: sidArg(s) }),
      sh("isloc", "show isis segment-routing srv6 locators", "The locators IS-IS advertises", () => xrIsisLocators(s, r)),
      sh("pol", "show segment-routing traffic-eng policy", "Policy GREEN: its SIDs and the packed carriers", () => nothing(xrPolicy(s, r), "No SR policy on this router — R1 is the headend.")),
      sh("polc", "show segment-routing traffic-eng policy color <c>", "One color's policy", (a) => nothing(xrPolicy(s, r, +a.c), "No SR policy on this router — R1 is the headend."), { c: numArg(1, 4294967295, ["10"], "Color") }),
      sh("cefv", "show cef vrf <v> <ip>", "What R1 pushes for a CUST destination: carriers and overhead", (a) => xrCefVrf(s, r, a.ip), { v: choiceArg(["CUST"], () => "Customer VRF"), ip: { choices: [CE.CE8.host], describe: () => "IPv4 destination", resolve: (raw) => (v4ok(raw) ? raw : undefined) } }),
      sh("rt6", "show route ipv6", "The IPv6 table: loopbacks and /48 locators", () => xrRoute6(s, r)),
      sh("rt6ip", "show route ipv6 <ip>", "The route an address (or the active uSID) uses", (a) => xrRoute6Ip(s, r, a.ip), { ip: any6 }),
      sh("v6b", "show ipv6 interface brief", "Interfaces, addresses and IPv6 MTU", () => xrIpv6Brief(s, r)),
      sh("log", "show logging", "The syslog buffer", () => xrLogging(s, r)),
    ],
    exec: [
      sh("pingv", "ping vrf <v> <ip>", "Send CUST traffic from site 1 to site 8 (100 bytes)", (a) => xrPingVrf(api, r, a.ip, 100), { v: choiceArg(["CUST"], () => "Customer VRF"), ip: { choices: [CE.CE8.host], describe: () => "Site 8 host", resolve: (raw) => (v4ok(raw) ? raw : undefined) } }),
      sh("pingvs", "ping vrf <v> <ip> size <n>", "The same with a given packet size", (a) => xrPingVrf(api, r, a.ip, +a.n), { v: choiceArg(["CUST"], () => "Customer VRF"), ip: { choices: [CE.CE8.host], describe: () => "Site 8 host", resolve: (raw) => (v4ok(raw) ? raw : undefined) }, n: numArg(36, 9000, ["100", "1430"], "Datagram size") }),
      sh("ping", "ping <dst>", "Ping a loopback or a uN SID in the core", (a) => xrPing6(s, r, a.dst), { dst: any6 }),
    ],
  };
}
export function ucSets(api: UcCliApi, r: UR): Partial<Record<CliVendor, CliCommandSet>> {
  return { cisco: buildXrSet(api.dev, ucXrSpec(api, r)) };
}
export function ucStaticApi(s: UState, r: UR): UcCliApi {
  return { s, act: () => s, dev: { host: r, running: s.cfg[r], hist: s.hist[r], setCand: () => undefined, xr: [], setXr: () => undefined, edit: false, setEdit: () => undefined, commit: () => undefined } };
}
