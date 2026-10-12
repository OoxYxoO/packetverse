import type { CliArgSpec, CliCommandSet, CliVendor } from "@/lib/cli/types";
import { buildXrSet, choiceArg, numArg, type SpCfgStmt, type SpCmd, type SpDevCli, type SpXrSpec } from "@/components/sp-lab/spCli";
import { pad, spAge, spStamp } from "@/components/sp-lab/spKit";
import { parseIf, xrIf } from "@/components/sp-lab/spNames";
import {
  P_IDX,
  P_LO,
  P_ROUTERS,
  P_RX,
  pIfTo,
  pIfs,
  pSid,
  pSteer,
  sidOwner,
  v6norm,
  type IfName,
  type PAction,
  type PPolEval,
  type PR,
  type PRtr,
  type PState,
  type Rx,
} from "@/lib/sim-engine/scenarios/s6pNet";

/**
 * Command lines of the SRv6 Policy Lab — IOS XR on R1–R6. Every output is printed from the lab model: R1's SR policies
 * (instantiated by the controller), their candidates and binding SIDs, the SID tables, BGP colors, CEF and delays.
 *
 *   show segment-routing traffic-eng policy [color <c>] · show segment-routing srv6 sid · show bgp ipv6 unicast
 *   [<pfx>] · show cef ipv6 <pfx> · show route ipv6 <ip> · show isis adjacency · show performance-measurement
 *   interfaces · show logging
 *   configure → router isis CORE → address-family ipv6 unicast → segment-routing srv6 → locator MAIN · interface <if>
 *   → address-family ipv6 unicast → metric · performance-measurement → interface → delay-measurement → advertise-delay ·
 *   (R6) router bgp 65000 → neighbor 2001:db8::1 → address-family ipv6 unicast → route-policy SET-COLOR-100 out
 */

export interface P6CliApi {
  s: PState;
  act: (a: PAction) => PState;
  dev: SpDevCli<PRtr>;
}
const age = (s: PState) => spAge(s.clock, 15);
const ifc = (c: PRtr, ifn: string) => c.ifs[ifn as IfName]!;
const defMetric = (r: PR, ifn: string) => pIfs(r).find((i) => i.ifn === ifn)!.link.metric;
const ll = (r: PR) => `fe80::${P_IDX[r]}`;
const behOf = (s: PState, sid: string) => {
  const o = sidOwner(s.view.sids, sid);
  const x = o ? pSid(s.view, o, sid) : undefined;
  return x ? `${x.behavior}${x.peer ? ` ${o}→${x.peer}` : x.behavior === "End" ? ` ${o}` : ""}` : "not found";
};

// ---------------------------------------------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------------------------------------------
const phys = (r: PR) => pIfs(r).map((i) => i.ifn);
const ifArg = (r: PR, withLo = false): CliArgSpec => ({
  choices: [...(withLo ? ["Loopback0"] : []), ...phys(r).map((i) => xrIf(i))],
  describe: (c) => {
    const n = parseIf(c);
    const i = pIfs(r).find((x) => x.ifn === n);
    return i ? `to ${i.peer}` : n === "lo0" ? "Loopback0" : undefined;
  },
  resolve: (raw) => {
    const n = parseIf(raw);
    return n && (n === "lo0" ? withLo : phys(r).includes(n as IfName)) ? n : undefined;
  },
});
const pfxArg: CliArgSpec = {
  choices: ["2001:db8:66::/64", "2001:db8:67::/64"],
  describe: (c) => (c.startsWith("2001:db8:66") ? "RX66 — color 100" : "RX67 — no color"),
  resolve: (raw) => {
    const m = /^([0-9a-fA-F:]+)(\/(\d{1,3}))?$/.exec(raw);
    return m && v6norm(m[1]) ? v6norm(m[1]) : undefined;
  },
};
const rxOf = (ip: string): Rx | undefined => (ip.startsWith("2001:db8:66:") ? "RX66" : ip.startsWith("2001:db8:67:") ? "RX67" : undefined);

// ---------------------------------------------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------------------------------------------
function candLines(s: PState, p: PPolEval): string[] {
  const out: string[] = [];
  for (const k of [...p.cands].sort((a, b) => b.cand.pref - a.cand.pref)) {
    const act = p.active === k;
    out.push(`    Preference: ${k.cand.pref} (PCEP)${act ? " (active)" : ""}`, `      Name: ${p.pol.name}`, "      Requested BSID: dynamic", "      PCC info:", `        Symbolic name: ${p.pol.name}_${k.cand.pref}`, `        PLSP-ID: ${k.cand.pref === 200 ? 1 : 2}`);
    if (k.cand.kind === "explicit") out.push(`      Explicit: segment-list (pce 2001:db8::100) (${k.valid ? (act ? "valid" : "inactive") : "invalid"})${k.valid ? "" : `\n        Reason: ${k.why}`}`);
    else out.push(`      Dynamic (pce 2001:db8::100) (${k.valid ? (act ? "valid" : "inactive") : "invalid"})${k.valid ? "" : `\n        Reason: ${k.why}`}`, `        Metric Type: ${(k.cand.metric ?? "delay").toUpperCase()},   Path Accumulated Metric: ${k.cost ?? 0}`);
    out.push("        SRv6 Information:", "          SID Behavior: End.B6.Encaps.Red", ...k.sids.map((x, i) => `          SID[${i}]: ${x} [${behOf(s, x)}]`));
  }
  return out;
}
function xrPolicy(s: PState, r: PR, color?: number): string {
  if (r !== "R1") return "";
  const ps = s.view.pols.filter((p) => color === undefined || p.pol.color === color);
  if (!ps.length) return color === undefined ? "" : `No policy with color ${color}.`;
  return ["", "SR-TE policy database", "---------------------", "", ...ps.flatMap((p) => [`Color: ${p.pol.color}, End-point: ${p.pol.endpoint}`, `  Name: srte_c_${p.pol.color}_ep_${p.pol.endpoint}`, "  Status:", `    Admin: up  Operational: ${p.up ? `up for ${age(s)} (since ${spStamp(40).xr.replace(" UTC", "")})` : "down"}`, "  Candidate-paths:", ...candLines(s, p), "  Attributes:", `    Binding SID: ${p.up && p.bsid ? p.bsid : "(none)"}`, "      SRv6 Behavior: End.B6.Encaps.Red", "    Forward Class: Not Configured", "    Steering BGP disabled: no", ""])].join("\n");
}
function xrSids(s: PState, r: PR): string {
  const fnOf = (sid: string) => parseInt(sid.split(":")[4] || "0", 16);
  const rows = [...s.view.sids[r]].sort((x, y) => fnOf(x.sid) - fnOf(y.sid));
  if (!rows.length) return "";
  return ["", "*** Locator: 'MAIN' *** ", "", "SID                         Behavior          Context                           Owner               State  RW", "--------------------------  ----------------  --------------------------------  ------------------  -----  --", ...rows.map((x) => `${pad(x.sid, 28)}${pad(x.behavior === "End" || x.behavior === "End.X" ? `${x.behavior} (PSP/USD)` : x.behavior, 18)}${pad(x.behavior === "End" ? "'default':1" : x.behavior === "End.X" ? `[${xrIf(x.ifn!, true)}, Link-Local]` : x.behavior === "End.DT6" ? "'default'" : `'${x.policy}'`, 34)}${pad(x.behavior === "End.DT6" ? "bgp-65000" : x.behavior === "End.B6.Encaps" ? "xtc_srv6" : "isis-CORE", 20)}${pad("InUse", 7)}Y`)].join("\n");
}
function xrBgp(s: PState, r: PR, ip?: string): string {
  if (r !== "R1" && r !== "R6") return "% BGP instance 'default' not active";
  const rx = (Object.keys(P_RX) as Rx[]);
  if (ip) {
    const x = rxOf(ip);
    if (!x) return "% Network not in table";
    const host = P_RX[x];
    if (r === "R6") return [`BGP routing table entry for ${host.net}/64`, "Paths: (1 available, best #1)", "  Advertised to peers (in unique update groups):", `    ${P_LO("R1")}`, "  Path #1: Received by speaker 0", "  Local", `    :: from :: (${P_LO("R6")})`, "      Origin IGP, metric 0, localpref 100, weight 32768, valid, local, best, group-best", `      SRv6 SID: ${s.view.service} (End.DT6)`, ...(host.color && s.cfg.R6.colorOut ? [`      (exported to ${P_LO("R1")} with Extended community: Color:${host.color})`] : [])].join("\n");
    const st = pSteer(s.cfg, s.view, x);
    const colored = !!host.color && s.cfg.R6.colorOut;
    return [`BGP routing table entry for ${host.net}/64`, "Paths: (1 available, best #1)", "  Not advertised to any peer", "  Path #1: Received by speaker 0", "  Local", `    ${P_LO("R6")}${colored ? ` C:${host.color}` : ""}${st.pol?.up && colored ? ` (bsid:${st.pol.bsid})` : ""} (metric ${s.view.spf.R1.find((y) => y.dst === "R6")?.cost ?? 0}) from ${P_LO("R6")} (${P_LO("R6")})`, "      Origin IGP, metric 0, localpref 100, valid, internal, best, group-best", `      PSID-Type:L3, SubTLV Count:1`, `       SubTLV: T:1(Sid information), Sid:${s.view.service}, Behavior:End.DT6`, ...(colored ? [`      Extended community: Color:${host.color}`, st.pol ? `      SR policy color ${host.color}, ${st.pol.up ? "up" : "down"}, registered${st.pol.up ? `, bsid ${st.pol.bsid}` : ""}` : `      SR policy color ${host.color}, end-point ${P_LO("R6")}: not found`] : [])].join("\n");
  }
  return [`BGP router identifier ${r === "R1" ? "1.1.1.1" : "6.6.6.6"}, local AS number 65000`, "BGP generic scan interval 60 secs", "BGP table state: Active", "", "Status codes: s suppressed, d damped, h history, * valid, > best", "Origin codes: i - IGP, e - EGP, ? - incomplete", "   Network            Next Hop            Metric LocPrf Weight Path", ...rx.map((x) => r === "R6" ? `*> ${pad(`${P_RX[x].net}/64`, 19)}${pad("::", 20)}0         32768 i` : `*>i${pad(`${P_RX[x].net}/64`, 19)}${pad(`${P_LO("R6")}${P_RX[x].color && s.cfg.R6.colorOut ? ` C:${P_RX[x].color}` : ""}`, 20)}0    100      0 i`), "", "Processed 2 prefixes, 2 paths"].join("\n");
}
function xrCef(s: PState, r: PR, ip: string): string {
  const x = rxOf(ip);
  if (!x || r !== "R1") return `${ip}/128, version 0, drop adjacency`;
  const st = pSteer(s.cfg, s.view, x);
  const first = st.sids[0];
  const owner = first ? sidOwner(s.view.sids, first) : undefined;
  const nh = owner ? (owner === "R1" ? undefined : s.view.spf.R1.find((y) => y.dst === owner)?.nh) : undefined;
  return [`${P_RX[x].net}/64, version 61, SRv6 Headend, internal 0x5000001 0x30 (ptr 0x7fa1b2c3d0) [1], 0x0 (0x0), 0x0 (0x0)`, ` Updated ${spStamp(40).xr.replace(" UTC", "")}`, " Prefix Len 64, traffic index 0, precedence n/a, priority 4", st.pol?.up ? `   via ${st.pol.bsid}/128, 3 dependencies, recursive [flags 0x6000] (${st.pol.pol.name})` : `   via ${P_LO("R6")}/128, 3 dependencies, recursive [flags 0x6000]`, `    path-idx 0 NHID 0x0 [0x7fa1e6f7a8 0x0]`, ...(nh ? [`    next hop ${ll(nh.nh)}/128 ${xrIf(nh.ifn, true)}`] : []), `     SRv6 H.Encaps.Red SID-list {${st.sids.join(" ")}}`].join("\n");
}
function xrRouteIp(s: PState, r: PR, ip: string): string {
  const n = v6norm(ip);
  const owner = n && P_ROUTERS.find((x) => s.cfg[x].isisLoc && n.startsWith(`2001:db8:100:${P_IDX[x]}:`));
  if (!owner) return "% Network not in table";
  if (owner === r) return [`Routing entry for 2001:db8:100:${P_IDX[r]}::/64`, `  Known via "local", distance 0, metric 0 (SRv6 locator)`, "  Routing Descriptor Blocks", "    directly connected, via Null0"].join("\n");
  const rt = s.view.spf[r].find((x) => x.dst === owner);
  if (!rt?.nh) return "% Network not in table";
  return [`Routing entry for 2001:db8:100:${P_IDX[owner]}::/64`, `  Known via "isis CORE", distance 115, metric ${rt.cost + 1}, type level-2, SRv6 locator`, `  Installed ${spStamp(15).xr.replace(" UTC", "")} for ${age(s)}`, "  Routing Descriptor Blocks", `    ${ll(rt.nh.nh)}, from ${P_LO(owner)}, via ${xrIf(rt.nh.ifn)}`, `      Route metric is ${rt.cost + 1}`].join("\n");
}
function xrAdj(s: PState, r: PR): string {
  const ups = pIfs(r).filter((i) => s.view.adj[i.link.id]);
  return ["IS-IS CORE Level-2 adjacencies:", "System Id      Interface                SNPA           State Hold Changed  NSF IPv4 IPv6", "                                                                               BFD  BFD", ...ups.map((i) => `${pad(i.peer, 15)}${pad(xrIf(i.ifn, true), 25)}${pad("*PtoP*", 15)}${pad("Up", 6)}${pad(27, 5)}${pad(age(s), 9)}Yes None None`), "", `Total adjacency count: ${ups.length}`].join("\n");
}
function xrPm(s: PState, r: PR): string {
  return ["", "-------------------------------------------------------------------------------", "0/RP0/CPU0", "-------------------------------------------------------------------------------", "", ...pIfs(r).flatMap((i, k) => [`Interface Name: ${xrIf(i.ifn)} (ifh: 0x${(0x1000 + 0x40 * P_IDX[r] + k).toString(16)})`, "  Delay-Measurement                 : Enabled", `  Advertised delay (static)         : ${s.cfg[r].ifs[i.ifn]!.delay} uSec`, ""])].join("\n");
}
function xrLogging(s: PState, r: PR): string {
  const lines = s.sys.filter((x) => x.dev === r).slice(-30).map((x) => {
    const st = `RP/0/RP0/CPU0:${spStamp(x.t).xr}`;
    const i = x.peer && x.kind.startsWith("adj") ? pIfTo(r, x.peer as PR) : undefined;
    if (x.kind === "adj-up" || x.kind === "adj-down") return `${st}: isis[1012]: %ROUTING-ISIS-5-ADJCHANGE : Adjacency to ${x.peer} (${i ? xrIf(i.ifn) : "?"}) (L2) ${x.kind === "adj-up" ? "Up, New adjacency" : "Down, Neighbor forgot us"}`;
    if (x.kind === "policy") {
      const p = s.view.pols.find((y) => y.pol.name === x.peer);
      return `${st}: xtc_agent[1166]: %ROUTING-XTC-5-SR_POLICY_UPDOWN : SR policy '${x.peer}' (color ${p?.pol.color}, end-point ${p?.pol.endpoint}) state changed to ${p?.up ? "UP" : "DOWN"}`;
    }
    return `${st}: config[65857]: %MGBL-CONFIG-6-DB_COMMIT : Configuration committed by user 'admin'. Use 'show commit changes ${1000000000 + x.t}' to view the changes.`;
  });
  return ["Syslog logging: enabled (0 messages dropped, 0 flushes, 0 overruns)", `    Buffer logging: level debugging, ${lines.length} messages logged`, "", "Log Buffer (2097152 bytes):", "", ...lines].join("\n");
}

// ---------------------------------------------------------------------------------------------------------------
// Configuration as IOS XR prints it
// ---------------------------------------------------------------------------------------------------------------
export function p6XrLines(r: PR, c: PRtr): string[] {
  const out: string[] = [`hostname ${r}`, "!", "interface Loopback0", ` ipv6 address ${P_LO(r)}/128`, "!"];
  for (const i of pIfs(r)) out.push(`interface ${xrIf(i.ifn)}`, ` description to ${i.peer}`, " mtu 9216", ` ipv6 address ${i.ip}/64`, "!");
  if (r === "R6") for (const x of Object.keys(P_RX) as Rx[]) out.push(`interface ${xrIf(P_RX[x].ifn)}`, ` description to ${x}`, ` ipv6 address ${P_RX[x].gw}/64`, "!");
  out.push("router isis CORE", " is-type level-2-only", ` net 49.0001.0000.0000.000${P_IDX[r]}.00`, " address-family ipv6 unicast", "  metric-style wide", ...(c.isisLoc ? ["  segment-routing srv6", "   locator MAIN", "   !", "  !"] : []), " !", " interface Loopback0", "  passive", "  address-family ipv6 unicast", "  !", " !");
  for (const i of pIfs(r)) {
    const f = c.ifs[i.ifn]!;
    if (!f.isis) continue;
    out.push(` interface ${xrIf(i.ifn)}`, "  point-to-point", "  address-family ipv6 unicast", ...(f.metric !== 10 ? [`   metric ${f.metric}`] : []), "  !", " !");
  }
  out.push("!", "performance-measurement");
  for (const i of pIfs(r)) out.push(` interface ${xrIf(i.ifn)}`, "  delay-measurement", `   advertise-delay ${c.ifs[i.ifn]!.delay}`, "  !", " !");
  out.push("!");
  if (r === "R1") out.push("segment-routing", " traffic-eng", "  pcc", "   source-address ipv6 2001:db8::1", "   pce address ipv6 2001:db8::100", "    precedence 10", "   !", "  !", " !", "!");
  if (r === "R6") out.push("extcommunity-set opaque COLOR-100", "  100", "end-set", "!", "route-policy SET-COLOR-100", "  if destination in (2001:db8:66::/64) then", "    set extcommunity color COLOR-100", "  endif", "  pass", "end-policy", "!");
  if (r === "R1" || r === "R6") out.push("router bgp 65000", ` bgp router-id ${r === "R1" ? "1.1.1.1" : "6.6.6.6"}`, " address-family ipv6 unicast", ...(r === "R6" ? ["  network 2001:db8:66::/64", "  network 2001:db8:67::/64", "  segment-routing srv6", "   locator MAIN", "   alloc mode per-vrf", "  !"] : []), " !", ` neighbor ${P_LO(r === "R1" ? "R6" : "R1")}`, "  remote-as 65000", "  update-source Loopback0", "  address-family ipv6 unicast", ...(r === "R6" && c.colorOut ? ["   route-policy SET-COLOR-100 out"] : []), "  !", " !", "!");
  out.push("segment-routing", " srv6", "  locators", "   locator MAIN", `    prefix 2001:db8:100:${P_IDX[r]}::/64`, "   !", "  !", " !", "!");
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Configuration statements
// ---------------------------------------------------------------------------------------------------------------
function stmts(r: PR): SpCfgStmt<PRtr>[] {
  const PCE = "% R1's SR policies are instantiated by the controller (PCE) in this lab — use the Controller window.";
  return [
    { id: "sr", summary: "Segment Routing", xr: { mode: "config", syntax: "segment-routing", enter: "sr", apply: (c) => c } },
    { id: "te", summary: "SR Traffic Engineering", xr: { mode: "sr", syntax: "traffic-eng", apply: () => PCE } },
    { id: "router-isis", summary: "IS-IS routing protocol", args: { tag: choiceArg(["CORE"], () => "Instance tag") }, xr: { mode: "config", syntax: "router isis <tag>", enter: "isis", apply: (c) => c } },
    { id: "isis-af6", summary: "Enter the IPv6 unicast address family", xr: { mode: "isis", syntax: "address-family ipv6 unicast", enter: "isis-af6", apply: (c) => c } },
    { id: "isis-srv6", summary: "SRv6 in IS-IS", xr: { mode: "isis-af6", syntax: "segment-routing srv6", enter: "isis-srv6", apply: (c) => c, no: (c) => ((c.isisLoc = false), c) } },
    { id: "isis-loc", summary: "Advertise this locator and allocate End / End.X", args: { lname: choiceArg(["MAIN"], () => "Locator name") }, xr: { mode: "isis-srv6", syntax: "locator <lname>", apply: (c) => ((c.isisLoc = true), c), no: (c) => ((c.isisLoc = false), c) } },
    { id: "isis-if", summary: "Enter the IS-IS interface configuration submode", args: { if: ifArg(r, true) }, xr: { mode: "isis", syntax: "interface <if>", enter: "isis-if", apply: (c, a) => (a.if === "lo0" ? c : ((ifc(c, a.if).isis = true), c)), no: (c, a) => (a.if === "lo0" ? "% This lab keeps Loopback0 in IS-IS." : ((ifc(c, a.if).isis = false), c)) } },
    { id: "isis-if-af6", summary: "Enter the interface IPv6 unicast address family", xr: { mode: "isis-if", syntax: "address-family ipv6 unicast", enter: "isis-if-af6", apply: (c) => c } },
    { id: "isis-metric", summary: "Set the default metric for this interface", args: { n: numArg(1, 16777214, ["10", "15", "50"], "Default metric") }, xr: { mode: "isis-if-af6", syntax: "metric <n>", noSyntax: "metric", apply: (c, a, x) => (x.if === "lo0" ? "% This lab keeps Loopback0 at metric 0." : ((ifc(c, x.if).metric = +a.n), c)), no: (c, _a, x) => (x.if === "lo0" ? c : ((ifc(c, x.if).metric = defMetric(r, x.if)), c)) } },
    { id: "pm", summary: "Performance measurement", xr: { mode: "config", syntax: "performance-measurement", enter: "pm", apply: (c) => c } },
    { id: "pm-if", summary: "Performance measurement on an interface", args: { pif: ifArg(r) }, xr: { mode: "pm", syntax: "interface <pif>", enter: "pm-if", apply: (c) => c } },
    { id: "pm-dm", summary: "Delay measurement", xr: { mode: "pm-if", syntax: "delay-measurement", enter: "pm-dm", apply: (c) => c } },
    { id: "pm-adv", summary: "Advertise a static delay (microseconds)", args: { us: numArg(1, 16777215, ["5000", "20000"], "Delay in microseconds") }, xr: { mode: "pm-dm", syntax: "advertise-delay <us>", apply: (c, a, x) => ((ifc(c, x.pif).delay = +a.us), c), no: () => "% This lab keeps a delay on every core link." } },
    { id: "bgp", summary: "BGP", args: { asn: choiceArg(["65000"], () => "AS number") }, xr: { mode: "config", syntax: "router bgp <asn>", enter: "bgp", apply: (c) => (r === "R6" || r === "R1" ? c : "% BGP runs on R1 and R6 in this lab.") } },
    { id: "bgp-nbr", summary: "The iBGP neighbor", args: { nbr: { choices: [P_LO(r === "R1" ? "R6" : "R1")], describe: () => "iBGP neighbor", resolve: (raw) => v6norm(raw) } }, xr: { mode: "bgp", syntax: "neighbor <nbr>", enter: "bgp-nbr", apply: (c, a) => (a.nbr === P_LO(r === "R1" ? "R6" : "R1") ? c : "% Not a neighbor in this lab.") } },
    { id: "bgp-nbr-af", summary: "IPv6 unicast for this neighbor", xr: { mode: "bgp-nbr", syntax: "address-family ipv6 unicast", enter: "bgp-nbr-af", apply: (c) => c } },
    { id: "bgp-rp", summary: "Apply a route policy to updates sent", args: { rp: choiceArg(["SET-COLOR-100"], () => "Sets color 100 on 2001:db8:66::/64"), dir: choiceArg(["out"], () => "Outbound") }, xr: { mode: "bgp-nbr-af", syntax: "route-policy <rp> <dir>", apply: (c) => (r === "R6" ? ((c.colorOut = true), c) : "% R1 applies no export policy in this lab."), no: (c) => ((c.colorOut = false), c) } },
  ];
}

// ---------------------------------------------------------------------------------------------------------------
// Command set
// ---------------------------------------------------------------------------------------------------------------
export function p6XrSpec(api: P6CliApi, r: PR): SpXrSpec<PRtr> {
  const s = api.s;
  const sh = (id: string, syntax: string, summary: string, run: SpCmd["run"], args?: SpCmd["args"]): SpCmd => ({ id, syntax, summary, run, args });
  const nothing = (o: string, why: string) => o || { output: "", explanation: why };
  const anyV6: CliArgSpec = { choices: ["2001:db8:100:3:41::", "2001:db8:100:6:1::"], describe: () => "IPv6 address or SID", resolve: (raw) => v6norm(raw) };
  return {
    stmts: stmts(r),
    prompts: { config: "config", sr: "config-sr", isis: "config-isis", "isis-af6": "config-isis-af", "isis-srv6": "config-isis-srv6", "isis-if": "config-isis-if", "isis-if-af6": "config-isis-if-af", pm: "config-perf-meas", "pm-if": "config-pm-intf", "pm-dm": "config-pm-intf-dm", bgp: "config-bgp", "bgp-nbr": "config-bgp-nbr", "bgp-nbr-af": "config-bgp-nbr-af" },
    lines: (c) => p6XrLines(r, c),
    help: { "show segment-routing": "Segment routing information", "show segment-routing traffic-eng": "SR-TE information", "show segment-routing srv6": "SRv6 information", "show bgp": "BGP information", "show cef": "Cisco Express Forwarding", "show route": "IP routing table", "show isis": "IS-IS information", "show performance-measurement": "Performance measurement information" },
    shows: [
      sh("pol", "show segment-routing traffic-eng policy", "SR policies on this headend: candidates, SIDs, BSID", () => nothing(xrPolicy(s, r), "No SR policy on this router — R1 is the headend.")),
      sh("polc", "show segment-routing traffic-eng policy color <c>", "One color's policy", (a) => nothing(xrPolicy(s, r, +a.c), "No SR policy on this router — R1 is the headend."), { c: numArg(1, 4294967295, ["100"], "Color") }),
      sh("sid", "show segment-routing srv6 sid", "The local SID table", () => nothing(xrSids(s, r), "No local SID is allocated.")),
      sh("bgp", "show bgp ipv6 unicast", "The BGP table", () => xrBgp(s, r)),
      sh("bgpp", "show bgp ipv6 unicast <pfx>", "One BGP route: color, service SID, policy", (a) => xrBgp(s, r, a.pfx), { pfx: pfxArg }),
      sh("cef", "show cef ipv6 <pfx>", "How R1 forwards a receiver's prefix (SID list)", (a) => xrCef(s, r, a.pfx), { pfx: pfxArg }),
      sh("rt", "show route ipv6 <ip>", "The route toward a SID's locator", (a) => xrRouteIp(s, r, a.ip), { ip: anyV6 }),
      sh("adj", "show isis adjacency", "IS-IS adjacencies", () => xrAdj(s, r)),
      sh("pm", "show performance-measurement interfaces", "Delay advertised per interface", () => xrPm(s, r)),
      sh("log", "show logging", "The syslog buffer", () => xrLogging(s, r)),
    ],
    exec: [],
  };
}
export function p6Sets(api: P6CliApi, r: PR): Partial<Record<CliVendor, CliCommandSet>> {
  return { cisco: buildXrSet(api.dev, p6XrSpec(api, r)) };
}
export function p6StaticApi(s: PState, r: PR): P6CliApi {
  return { s, act: () => s, dev: { host: r, running: s.cfg[r], hist: s.hist[r], setCand: () => undefined, xr: [], setXr: () => undefined, edit: false, setEdit: () => undefined, commit: () => undefined } };
}
