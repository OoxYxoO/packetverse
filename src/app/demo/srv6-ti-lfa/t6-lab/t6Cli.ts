import type { CliArgSpec, CliCommandSet, CliVendor } from "@/lib/cli/types";
import { buildXrSet, choiceArg, numArg, type SpCfgStmt, type SpCmd, type SpDevCli, type SpXrSpec } from "@/components/sp-lab/spCli";
import { pad, spAge, spStamp } from "@/components/sp-lab/spKit";
import { parseIf, xrIf } from "@/components/sp-lab/spNames";
import { v6norm } from "@/lib/sim-engine/scenarios/sxNet";
import {
  T6_LO,
  T6_N,
  T6_ROUTERS,
  ll,
  linkIp,
  locOf,
  ownerOf,
  t6Frr,
  t6IfTo,
  t6Ifs,
  t6Prot,
  type IfName,
  type T6Action,
  type T6Prot,
  type T6R,
  type T6Rtr,
  type T6State,
} from "@/lib/sim-engine/scenarios/s6tNet";

/**
 * Command lines of the SRv6 TI-LFA Lab — IOS XR on PE1, P1, P2, P3, P4 and PE2. Every output is printed from the model.
 *
 *   show isis fast-reroute [summary | <prefix> detail] · show isis interface <if> · show isis adjacency · show bfd
 *   session · show segment-routing srv6 sid · show isis segment-routing srv6 locators · show route ipv6 [<ip>] ·
 *   show cef ipv6 <ip> · show logging · ping <ipv6>
 *   configure → router isis CORE → address-family ipv6 unicast → segment-routing srv6 → locator MAIN
 *             → interface <if> → bfd fast-detect ipv6 · bfd minimum-interval · bfd multiplier
 *                              → address-family ipv6 unicast → metric · fast-reroute per-prefix [ti-lfa |
 *                                tiebreaker node-protecting index <n>]
 */

export interface T6CliApi {
  s: T6State;
  act: (a: T6Action) => T6State;
  dev: SpDevCli<T6Rtr>;
}
const age = (s: T6State) => spAge(s.clock, 15);
const ifc = (c: T6Rtr, ifn: string) => c.ifs[ifn as IfName]!;
const phy = (x: Record<string, string>) => x.if !== "lo0";
const LO = "% Loopback0 needs no fast reroute or BFD.";
const BFD_FIXED = "% This lab runs BFD at 50 ms x 3 on the silent link.";

// ---------------------------------------------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------------------------------------------
const ifArg = (r: T6R, withLo = false): CliArgSpec => ({
  choices: [...(withLo ? ["Loopback0"] : []), ...t6Ifs(r).map((i) => xrIf(i.ifn))],
  describe: (c) => {
    const n = parseIf(c);
    const i = t6Ifs(r).find((x) => x.ifn === n);
    return i ? `to ${i.peer}` : n === "lo0" ? "Loopback0" : undefined;
  },
  resolve: (raw) => {
    const n = parseIf(raw);
    return n && ((n === "lo0" && withLo) || t6Ifs(r).some((x) => x.ifn === n)) ? n : undefined;
  },
});
const pfxArg: CliArgSpec = {
  choices: T6_ROUTERS.map((r) => `${locOf(r)}/64`),
  describe: (c) => {
    const o = ownerOf(c.split("/")[0]);
    return o ? `${o}'s ${c.includes("ffff") ? "loopback" : "locator"}` : "IPv6 prefix";
  },
  resolve: (raw) => {
    const m = /^(.+)\/(\d{1,3})$/.exec(raw);
    return m && v6norm(m[1]) && +m[2] <= 128 ? `${v6norm(m[1])}/${m[2]}` : undefined;
  },
};
const v6Arg = (choices: string[], what: string): CliArgSpec => ({ choices, describe: () => what, resolve: (raw) => v6norm(raw) });
const metricArg = numArg(1, 16777214, ["10", "15", "50", "70"], "Default metric");

// ---------------------------------------------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------------------------------------------
const behOf = (s: T6State, sid: string) => {
  const o = ownerOf(sid);
  const x = o ? s.view.sids[o].find((y) => y.sid === sid) : undefined;
  return { o, x };
};
const FRR_CODES = ["Codes: L1 - level 1, L2 - level 2, ia - interarea (leaked into level 1)", "       df - level 1 default (closest attached router), su - summary null", "       C - connected, S - static, R - RIP, B - BGP, O - OSPF", "       E - EIGRP, A - access/subscriber, M - mobile, a - application", "       i - IS-IS (redistributed from another instance)", "", "Maximum parallel path count: 8", ""];
/** The prefixes a destination router advertises: its locator (if in IS-IS) and its loopback. */
const pfxOf = (s: T6State, d: T6R) => [...(s.cfg[d].isisLoc ? [`${locOf(d)}/64`] : []), `${T6_LO(d)}/128`];
function frrEntry(s: T6State, r: T6R, p: T6Prot, pfx: string, detail: boolean): string[] {
  const out = [`L2 ${pfx} [${p.cost}/115] medium priority`, `     via ${ll(p.nh.nh)}, ${xrIf(p.nh.ifn)}, ${p.nh.nh}, Weight: 0`];
  const b = p.backup;
  if (!b) {
    out.push("       No FRR backup");
    if (detail && p.noBackup) out.push(`       (${p.noBackup})`);
    return out;
  }
  out.push(`       Backup path: ${b.kind === "lfa" ? "LFA" : `TI-LFA (${b.protect})`}, via ${ll(b.nh.nh)}, ${xrIf(b.nh.ifn)} ${b.nh.nh}, Weight: 0, Metric: ${b.cost}`);
  for (const sid of b.repair) {
    const { o, x } = behOf(s, sid);
    out.push(`         P node: ${o}.00 [${T6_LO(o!)}], SRv6 SID: ${sid} ${x?.behavior === "End.X" ? `End.X (PSP/USD) → ${x.peer}` : "End (PSP/USD)"}`);
  }
  if (!b.repair.length) out.push("         (no repair segment needed: the backup neighbor's own path is safe)");
  out.push(`         Backup-src: ${p.dst}.00`);
  if (detail) out.push(`       P: ${b.protect === "node" ? "Yes" : "No"}, TM: ${b.cost}, LC: No, NP: ${b.protect === "node" ? "Yes" : "No"}, D: No, SRLG: No`, `     src ${p.dst}.00-00, ${T6_LO(p.dst)}`);
  return out;
}
function xrFrr(s: T6State, r: T6R, only?: string): string {
  const rows = s.view.prot[r].sort((a, b) => T6_N[a.dst] - T6_N[b.dst]).flatMap((p) => pfxOf(s, p.dst).map((x) => ({ p, x })));
  const sel = only ? rows.filter((y) => y.x === only) : rows;
  if (only && !sel.length) return "";
  return ["", "IS-IS CORE IPv6 Unicast FRR backups", "", ...FRR_CODES, ...sel.flatMap((y) => [...frrEntry(s, r, y.p, y.x, !!only), ""])].join("\n");
}
function xrFrrSummary(s: T6State, r: T6R): string {
  const rows = s.view.prot[r].flatMap((p) => pfxOf(s, p.dst).map(() => p));
  const prot = rows.filter((p) => p.backup).length;
  const un = rows.length - prot;
  const pc = (n: number, d: number) => `${d ? ((100 * n) / d).toFixed(2) : "0.00"}%`;
  const line = (k: string, m: string, t: string) => `${pad(k, 26)}${pad("0", 11)}${pad("0", 11)}${pad(m, 11)}${pad("0", 11)}${t}`;
  return ["", "IS-IS CORE IPv6 Unicast FRR summary", "", "                          Critical   High       Medium     Low        Total", "                          Priority   Priority   Priority   Priority", "Prefixes reachable in L2", line("  All paths protected", String(prot), String(prot)), line("  Some paths protected", "0", "0"), line("  Unprotected", String(un), String(un)), "----------------------------------------------------------------------------", line("  Total", String(rows.length), String(rows.length)), "", `% of protectable prefixes protected: ${pc(prot, rows.length)}`].join("\n");
}
function xrIsisIf(s: T6State, r: T6R, ifn: string): string {
  const i = t6Ifs(r).find((x) => x.ifn === ifn);
  if (!i) return "";
  const f = s.cfg[r].ifs[i.ifn]!;
  if (!f.isis) return `${pad(xrIf(i.ifn), 28)}Disabled (No topologies cfg on the intf)`;
  const pr = t6Frr(s.cfg, r, i.ifn);
  const st = (b: boolean) => (b ? "Enabled" : "Not Enabled");
  return [`${pad(xrIf(i.ifn), 28)}Enabled`, "  Adjacency Formation:      Enabled", "  Prefix Advertisement:     Enabled", "  IPv4 BFD:                 Disabled", `  IPv6 BFD:                 ${f.bfd ? "Enabled" : "Disabled"}`, `  BFD Min Interval:         ${f.bfd ? 50 : 150}`, "  BFD Multiplier:           3", "", "  Circuit Type:             level-2-only", "  Media Type:               P2P", "", "  IPv6 Unicast Topology:    Enabled", `    Adjacency Formation:    ${s.view.adj[i.link.id] ? "Running" : "Not Running"}`, "    Prefix Advertisement:   Running", `    Metric (L1/L2):         ${f.metric}/${f.metric}`, `    FRR (L1/L2):            ${pr.on ? "L2 Enabled" : "L1 Not Enabled  L2 Not Enabled"}`, `      FRR Type:             ${pr.on ? "per-prefix" : "None"}`, `      Direct LFA:           ${st(pr.on)}`, `      Remote LFA:           Not Enabled`, `      TI LFA:               ${st(pr.ti)}`, `      Tie Breaker:          ${pr.node ? "Node-protecting (index 100)" : "Default"}`, "", `  IPv6 Address Family:      Enabled`, `    Global Prefix(es):      ${linkIp(i.link, r)}/64`].join("\n");
}
function xrAdj(s: T6State, r: T6R): string {
  const ups = t6Ifs(r).filter((i) => s.view.adj[i.link.id]);
  return ["IS-IS CORE Level-2 adjacencies:", "System Id      Interface                SNPA           State Hold Changed  NSF IPv4 IPv6", "                                                                               BFD  BFD", ...ups.map((i) => `${pad(i.peer, 15)}${pad(xrIf(i.ifn, true), 25)}${pad("*PtoP*", 15)}${pad("Up", 6)}${pad(26, 5)}${pad(age(s), 9)}Yes None ${s.cfg[r].ifs[i.ifn]!.bfd && s.cfg[i.peer].ifs[t6IfTo(i.peer, r)!.ifn]!.bfd ? "Up" : s.cfg[r].ifs[i.ifn]!.bfd ? "Init" : "None"}`), "", `Total adjacency count: ${ups.length}`].join("\n");
}
function xrBfd(s: T6State, r: T6R): string {
  const rows = t6Ifs(r).filter((i) => s.cfg[r].ifs[i.ifn]!.bfd);
  if (!rows.length) return "";
  return ["Src Addr           Dest Addr          VRF Name      Local det time(int*mult)      State", "                                                  Echo             Async", "------------------ ------------------ ------------- ---------------- ---------------- ----------", ...rows.map((i) => { const up = s.view.adj[i.link.id] && s.cfg[i.peer].ifs[t6IfTo(i.peer, r)!.ifn]!.bfd; return `${pad(linkIp(i.link, r), 19)}${pad(linkIp(i.link, i.peer), 19)}${pad("default", 14)}${pad("n/a", 17)}${pad(up ? "150ms(50ms*3)" : "6s(2s*3)", 17)}${up ? "UP" : "DOWN"}`; })].join("\n");
}
function xrSids(s: T6State, r: T6R): string {
  const rows = s.view.sids[r];
  if (!rows.length) return "";
  return ["", "*** Locator: 'MAIN' *** ", "", "SID                         Behavior          Context                           Owner               State  RW", "--------------------------  ----------------  --------------------------------  ------------------  -----  --", ...rows.map((x) => `${pad(x.sid, 28)}${pad(x.behavior === "End.DT4" ? "End.DT4" : `${x.behavior} (PSP/USD)`, 18)}${pad(x.behavior === "End" ? "'default':1" : x.behavior === "End.X" ? `[${xrIf(x.ifn!, true)}, Link-Local]` : "'CUST-A'", 34)}${pad(x.behavior === "End.DT4" ? "bgp-65000" : "isis-CORE", 20)}${pad("InUse", 7)}Y`)].join("\n");
}
function xrIsisLocators(s: T6State, r: T6R): string {
  return ["", "IS-IS CORE SRv6 Locators", `${pad("Name", 22)}${pad("ID", 9)}${pad("Algo", 6)}${pad("Prefix", 26)}Status`, `${pad("------", 22)}${pad("----", 9)}${pad("----", 6)}${pad("------", 26)}------`, ...(s.cfg[r].isisLoc ? [`${pad("MAIN", 22)}${pad("1", 9)}${pad("0", 6)}${pad(`${locOf(r)}/64`, 26)}Active`] : [])].join("\n");
}
const RT_CODES = ["Codes: C - connected, S - static, R - RIP, B - BGP, (>) - Diversion path", "       O - OSPF, IA - OSPF inter area, i - ISIS, L1 - IS-IS level-1, L2 - IS-IS level-2", "       L - local, a - Application route", "", "Gateway of last resort is not set", ""];
function xrRoute6(s: T6State, r: T6R): string {
  const rows: string[] = [`${pad("L", 5)}${T6_LO(r)}/128 is directly connected,`, `      ${age(s)}, Loopback0`];
  if (s.cfg[r].isisLoc) rows.push(`${pad("L", 5)}${locOf(r)}/64 is directly connected,`, `      ${age(s)}, Null0 (SRv6 locator)`);
  for (const p of [...s.view.prot[r]].sort((a, b) => T6_N[a.dst] - T6_N[b.dst]))
    for (const x of pfxOf(s, p.dst)) rows.push(`${pad("i L2", 5)}${x}`, `      [115/${p.cost}] via ${ll(p.nh.nh)}, ${age(s)}, ${xrIf(p.nh.ifn)}`, ...(p.backup ? [`      [115/${p.backup.cost}] via ${ll(p.backup.nh.nh)}, ${age(s)}, ${xrIf(p.backup.nh.ifn)} (!)`] : []));
  return [...RT_CODES, ...rows].join("\n");
}
function xrRoute6Ip(s: T6State, r: T6R, ip: string): string {
  const o = ownerOf(ip);
  if (!o || (!s.cfg[o].isisLoc && !ip.startsWith("2001:db8:ffff:"))) return "% Network not in table";
  const pfx = v6norm(ip) === T6_LO(o) ? `${T6_LO(o)}/128` : `${locOf(o)}/64`;
  if (o === r) return [`Routing entry for ${pfx}`, `  Known via "local", distance 0, metric 0`, "  Routing Descriptor Blocks", `    directly connected, via ${pfx.endsWith("/128") ? "Loopback0" : "Null0"}`].join("\n");
  const p = t6Prot(s.view, r, o);
  if (!p) return "% Network not in table";
  const out = [`Routing entry for ${pfx}`, `  Known via "isis CORE", distance 115, metric ${p.cost}, type level-2`, `  Installed ${spStamp(15).xr.replace(" UTC", "")} for ${age(s)}`, "  Routing Descriptor Blocks", `    ${ll(p.nh.nh)}, from ${T6_LO(o)}, via ${xrIf(p.nh.ifn)}, Protected`, `      Route metric is ${p.cost}`];
  if (p.backup) out.push(`    ${ll(p.backup.nh.nh)}, from ${T6_LO(o)}, via ${xrIf(p.backup.nh.ifn)}, Backup (${p.backup.kind === "lfa" ? "Local-LFA" : "TI-LFA"})`, ...(p.backup.repair.length ? [`      SRv6 Headend: H.Encaps.Red [base], SID-list {${p.backup.repair.join(" ")}}`] : []), `      Route metric is ${p.backup.cost}`);
  out.push("  No advertising protos.");
  return out.join("\n");
}
function xrCef(s: T6State, r: T6R, ip: string): string {
  const o = ownerOf(ip);
  const p = o && o !== r ? t6Prot(s.view, r, o) : undefined;
  if (!o || !p || (!s.cfg[o].isisLoc && !ip.startsWith("2001:db8:ffff:"))) return `${v6norm(ip) ?? ip}/128, version 0, drop adjacency`;
  const pfx = v6norm(ip) === T6_LO(o) ? `${T6_LO(o)}/128` : `${locOf(o)}/64`;
  const out = [`${pfx}, version 87, internal 0x1000001 0x30 (ptr 0x8e2a4c10) [1], 0x0 (0x0), 0x0 (0x0)`, ` Updated ${spStamp(15).xr.replace(" UTC", "")}`, ` local adjacency to ${xrIf(p.nh.ifn)}`, "", ` Prefix Len ${pfx.split("/")[1]}, traffic index 0, precedence n/a, priority 2`, `   via ${ll(p.nh.nh)}/128, ${xrIf(p.nh.ifn)}, 9 dependencies, weight 0, class 0, protected [flags 0x400]`, "    path-idx 0 bkup-idx 1 NHID 0x1 [0x8e1c3a80 0x0]", `    next hop ${ll(p.nh.nh)}/128`];
  if (p.backup) out.push(`   via ${ll(p.backup.nh.nh)}/128, ${xrIf(p.backup.nh.ifn)}, 9 dependencies, weight 0, class 0, backup (${p.backup.kind === "lfa" ? "Local-LFA" : "TI-LFA"}) [flags 0x300]`, "    path-idx 1 NHID 0x2 [0x8e1c3b20 0x0]", `    next hop ${ll(p.backup.nh.nh)}/128, Repair Node(s): ${p.backup.repair.map((x) => ownerOf(x)).join(", ") || "none"}`, ...(p.backup.repair.length ? [`     SRv6 H.Encaps.Red SID-list {${p.backup.repair.join(" ")}}`] : []));
  return out.join("\n");
}
function xrPing(s: T6State, r: T6R, ip: string): string {
  const n = v6norm(ip)!;
  const o = ownerOf(n);
  const sid = o ? s.view.sids[o].find((x) => x.sid === n) : undefined;
  const isLo = o && T6_LO(o) === n;
  const reach = !!o && (o === r || (!!t6Prot(s.view, r, o) && (isLo || s.cfg[o].isisLoc)));
  const ok = reach && (isLo || (!!sid && sid.behavior !== "End.DT4"));
  const unreach = reach && !ok;
  return ["Type escape sequence to abort.", `Sending 5, 100-byte ICMP Echos to ${n}, timeout is 2 seconds:`, (ok ? "!" : unreach ? "U" : ".").repeat(5), ok ? "Success rate is 100 percent (5/5), round-trip min/avg/max = 1/2/4 ms" : "Success rate is 0 percent (0/5)"].join("\n");
}
function xrLogging(s: T6State, r: T6R): string {
  const lines = s.sys.filter((x) => x.dev === r).slice(-30).map((x) => {
    const st = `RP/0/RP0/CPU0:${spStamp(x.t).xr}`;
    const i = x.peer ? t6IfTo(r, x.peer as T6R) : undefined;
    if (x.kind === "adj-up" || x.kind === "adj-down") return `${st}: isis[1012]: %ROUTING-ISIS-5-ADJCHANGE : Adjacency to ${x.peer} (${i ? xrIf(i.ifn) : "?"}) (L2) ${x.kind === "adj-up" ? "Up, New adjacency" : "Down, Neighbor forgot us"}`;
    if (x.kind === "frr") return `${st}: isis[1012]: %ROUTING-ISIS-6-INFO : FRR backup paths recomputed (IPv6 Unicast)`;
    return `${st}: config[65857]: %MGBL-CONFIG-6-DB_COMMIT : Configuration committed by user 'admin'. Use 'show commit changes ${1000000000 + x.t}' to view the changes.`;
  });
  return ["Syslog logging: enabled (0 messages dropped, 0 flushes, 0 overruns)", `    Buffer logging: level debugging, ${lines.length} messages logged`, "", "Log Buffer (2097152 bytes):", "", ...lines].join("\n");
}

// ---------------------------------------------------------------------------------------------------------------
// Configuration as IOS XR prints it
// ---------------------------------------------------------------------------------------------------------------
export function t6XrLines(r: T6R, c: T6Rtr): string[] {
  const out: string[] = [`hostname ${r}`, "!", "interface Loopback0", ` ipv6 address ${T6_LO(r)}/128`, "!"];
  for (const i of t6Ifs(r)) out.push(`interface ${xrIf(i.ifn)}`, ` description to ${i.peer}${i.link.silent ? " (DWDM)" : ""}`, " mtu 9216", ` ipv6 address ${linkIp(i.link, r)}/64`, "!");
  out.push("router isis CORE", " is-type level-2-only", ` net 49.0001.0000.0000.${String(T6_N[r]).padStart(4, "0")}.00`, " address-family ipv6 unicast", "  metric-style wide", ...(c.isisLoc ? ["  segment-routing srv6", "   locator MAIN", "   !", "  !"] : []), " !", " interface Loopback0", "  passive", "  address-family ipv6 unicast", "  !", " !");
  for (const i of t6Ifs(r)) {
    const f = c.ifs[i.ifn]!;
    if (!f.isis) continue;
    out.push(` interface ${xrIf(i.ifn)}`, ...(f.bfd ? ["  bfd minimum-interval 50", "  bfd multiplier 3", "  bfd fast-detect ipv6"] : []), "  point-to-point", "  address-family ipv6 unicast", ...(f.frr ? ["   fast-reroute per-prefix"] : []), ...(f.tilfa ? ["   fast-reroute per-prefix ti-lfa"] : []), ...(f.node ? ["   fast-reroute per-prefix tiebreaker node-protecting index 100"] : []), ...(f.metric !== 10 ? [`   metric ${f.metric}`] : []), "  !", " !");
  }
  out.push("!", "segment-routing", " srv6", "  encapsulation", `   source-address ${T6_LO(r)}`, "  !", "  locators", "   locator MAIN", `    prefix ${locOf(r)}/64`, "   !", "  !", " !", "!");
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Configuration statements
// ---------------------------------------------------------------------------------------------------------------
function stmts(r: T6R): SpCfgStmt<T6Rtr>[] {
  return [
    { id: "router-isis", summary: "IS-IS routing protocol", args: { tag: choiceArg(["CORE"], () => "Instance tag") }, xr: { mode: "config", syntax: "router isis <tag>", enter: "isis", apply: (c) => c } },
    { id: "isis-af6", summary: "Enter the IPv6 unicast address family", xr: { mode: "isis", syntax: "address-family ipv6 unicast", enter: "isis-af6", apply: (c) => c } },
    { id: "isis-ms", summary: "Use wide metrics", args: { w: choiceArg(["wide"], () => "Wide metrics") }, xr: { mode: "isis-af6", syntax: "metric-style <w>", apply: (c) => c, no: () => "% SRv6 needs wide metrics." } },
    { id: "isis-srv6", summary: "SRv6 in IS-IS", xr: { mode: "isis-af6", syntax: "segment-routing srv6", enter: "isis-srv6", apply: (c) => c, no: (c) => ((c.isisLoc = false), c) } },
    { id: "isis-loc", summary: "Advertise this locator and allocate End / End.X", args: { lname: choiceArg(["MAIN"], () => "Locator name") }, xr: { mode: "isis-srv6", syntax: "locator <lname>", apply: (c) => ((c.isisLoc = true), c), no: (c) => ((c.isisLoc = false), c) } },
    { id: "isis-if", summary: "Enter the IS-IS interface configuration submode", args: { if: ifArg(r, true) }, xr: { mode: "isis", syntax: "interface <if>", enter: "isis-if", apply: (c, a) => (a.if === "lo0" ? c : ((ifc(c, a.if).isis = true), c)), no: (c, a) => (a.if === "lo0" ? "% This lab keeps Loopback0 in IS-IS." : ((ifc(c, a.if).isis = false), c)) } },
    { id: "isis-p2p", summary: "Treat the interface as point-to-point", xr: { mode: "isis-if", syntax: "point-to-point", apply: (c) => c, no: () => "% This lab keeps every core link point-to-point." } },
    { id: "isis-passive", summary: "Advertise the prefix but send no hellos", xr: { mode: "isis-if", syntax: "passive", apply: (c, _a, x) => (x.if === "lo0" ? c : "% This lab only uses passive on Loopback0.") } },
    { id: "bfd-fd", summary: "Bring up BFD with the neighbor; IS-IS drops the adjacency when BFD goes down", args: { af: choiceArg(["ipv6"], () => "IPv6 BFD") }, xr: { mode: "isis-if", syntax: "bfd fast-detect <af>", apply: (c, _a, x) => (phy(x) ? ((ifc(c, x.if).bfd = true), c) : LO), no: (c, _a, x) => (phy(x) ? ((ifc(c, x.if).bfd = false), c) : LO) } },
    { id: "bfd-min", summary: "BFD transmit and receive interval (ms)", args: { n: numArg(3, 30000, ["50"], "Interval in ms") }, xr: { mode: "isis-if", syntax: "bfd minimum-interval <n>", noSyntax: "bfd minimum-interval", apply: (c, a) => (+a.n === 50 ? c : BFD_FIXED), no: () => BFD_FIXED } },
    { id: "bfd-mul", summary: "BFD detect multiplier", args: { n: numArg(2, 50, ["3"], "Multiplier") }, xr: { mode: "isis-if", syntax: "bfd multiplier <n>", noSyntax: "bfd multiplier", apply: (c, a) => (+a.n === 3 ? c : BFD_FIXED), no: () => BFD_FIXED } },
    { id: "isis-if-af", summary: "Enter the interface IPv6 unicast address family", xr: { mode: "isis-if", syntax: "address-family ipv6 unicast", enter: "isis-if-af", apply: (c) => c } },
    { id: "isis-metric", summary: "Set the default metric for this interface", args: { n: metricArg }, xr: { mode: "isis-if-af", syntax: "metric <n>", noSyntax: "metric", apply: (c, a, x) => (phy(x) ? ((ifc(c, x.if).metric = +a.n), c) : "% This lab keeps Loopback0 at metric 0."), no: (c, _a, x) => (phy(x) ? ((ifc(c, x.if).metric = t6Ifs(r).find((i) => i.ifn === x.if)!.link.metric), c) : c) } },
    { id: "frr", summary: "Compute a backup for every prefix that uses this interface (per-prefix LFA)", xr: { mode: "isis-if-af", syntax: "fast-reroute per-prefix", apply: (c, _a, x) => (phy(x) ? ((ifc(c, x.if).frr = true), c) : LO), no: (c, _a, x) => (phy(x) ? (Object.assign(ifc(c, x.if), { frr: false, tilfa: false, node: false }), c) : LO) } },
    { id: "frr-ti", summary: "Use TI-LFA: repair along the post-convergence path with SRv6 SIDs", xr: { mode: "isis-if-af", syntax: "fast-reroute per-prefix ti-lfa", apply: (c, _a, x) => (phy(x) ? ((ifc(c, x.if).tilfa = true), c) : LO), no: (c, _a, x) => (phy(x) ? ((ifc(c, x.if).tilfa = false), c) : LO) } },
    { id: "frr-np", summary: "Prefer backups that avoid the next-hop router (node protection)", args: { i: numArg(1, 255, ["100"], "Tiebreaker priority") }, xr: { mode: "isis-if-af", syntax: "fast-reroute per-prefix tiebreaker node-protecting index <i>", noSyntax: "fast-reroute per-prefix tiebreaker node-protecting", apply: (c, _a, x) => (phy(x) ? ((ifc(c, x.if).node = true), c) : LO), no: (c, _a, x) => (phy(x) ? ((ifc(c, x.if).node = false), c) : LO) } },
  ];
}

// ---------------------------------------------------------------------------------------------------------------
// Command set
// ---------------------------------------------------------------------------------------------------------------
export function t6XrSpec(api: T6CliApi, r: T6R): SpXrSpec<T6Rtr> {
  const s = api.s;
  const sh = (id: string, syntax: string, summary: string, run: SpCmd["run"], args?: SpCmd["args"]): SpCmd => ({ id, syntax, summary, run, args });
  const nothing = (o: string, why: string) => o || { output: "", explanation: why };
  const any6 = v6Arg([`${locOf("PE2")}`, T6_LO("PE2"), "2001:db8:110:14:41::"], "IPv6 address (a loopback, locator or SID)");
  return {
    stmts: stmts(r),
    prompts: { config: "config", isis: "config-isis", "isis-af6": "config-isis-af", "isis-srv6": "config-isis-srv6", "isis-if": "config-isis-if", "isis-if-af": "config-isis-if-af" },
    lines: (c) => t6XrLines(r, c),
    help: { "show isis": "IS-IS information", "show isis fast-reroute": "IS-IS FRR backup paths", "show route": "IP routing table", "show cef": "Cisco Express Forwarding", "show bfd": "BFD information", "show segment-routing": "Segment routing information", "show segment-routing srv6": "SRv6 information" },
    shows: [
      sh("frr", "show isis fast-reroute", "Every prefix's primary and backup path (TI-LFA repair SIDs)", () => xrFrr(s, r)),
      sh("frrs", "show isis fast-reroute summary", "How many prefixes are protected", () => xrFrrSummary(s, r)),
      sh("frrd", "show isis fast-reroute <pfx> detail", "One prefix's backup in detail", (a) => nothing(xrFrr(s, r, a.pfx), `No IS-IS route to ${a.pfx}.`), { pfx: pfxArg }),
      sh("isif", "show isis interface <if>", "An interface's IS-IS, BFD and FRR settings", (a) => nothing(xrIsisIf(s, r, a.if), "Loopback0 is passive: no adjacency, no FRR."), { if: ifArg(r, true) }),
      sh("adj", "show isis adjacency", "IS-IS adjacencies (with BFD state)", () => xrAdj(s, r)),
      sh("bfd", "show bfd session", "BFD sessions", () => nothing(xrBfd(s, r), "No BFD sessions on this router.")),
      sh("sid", "show segment-routing srv6 sid", "The local SID table: End, End.X (USD) and End.DT4", () => nothing(xrSids(s, r), "No local SID is allocated on this router.")),
      sh("isloc", "show isis segment-routing srv6 locators", "The locators IS-IS advertises", () => xrIsisLocators(s, r)),
      sh("rt6", "show route ipv6", "The IPv6 table, with backup paths marked (!)", () => xrRoute6(s, r)),
      sh("rt6ip", "show route ipv6 <ip>", "One route: primary and TI-LFA backup", (a) => xrRoute6Ip(s, r, a.ip), { ip: any6 }),
      sh("cef", "show cef ipv6 <ip>", "The forwarding entry: primary, backup and the repair SID list", (a) => xrCef(s, r, a.ip), { ip: any6 }),
      sh("log", "show logging", "The syslog buffer", () => xrLogging(s, r)),
    ],
    exec: [sh("ping", "ping <dst>", "Ping an IPv6 address in the core (loopback or SID)", (a) => xrPing(s, r, a.dst), { dst: any6 })],
  };
}
export function t6Sets(api: T6CliApi, r: T6R): Partial<Record<CliVendor, CliCommandSet>> {
  return { cisco: buildXrSet(api.dev, t6XrSpec(api, r)) };
}
export function t6StaticApi(s: T6State, r: T6R): T6CliApi {
  return { s, act: () => s, dev: { host: r, running: s.cfg[r], hist: s.hist[r], setCand: () => undefined, xr: [], setXr: () => undefined, edit: false, setEdit: () => undefined, commit: () => undefined } };
}
