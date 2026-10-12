import type { CliArgSpec, CliCommandSet, CliVendor } from "@/lib/cli/types";
import { buildXrSet, choiceArg, numArg, type SpCfgStmt, type SpCmd, type SpDevCli, type SpXrSpec } from "@/components/sp-lab/spCli";
import { pad, spAge, spStamp } from "@/components/sp-lab/spKit";
import { parseIf, xrIf } from "@/components/sp-lab/spNames";
import {
  CORE_MTU,
  DEFAULT_MTU,
  SX_HOSTS,
  SX_IDX,
  SX_LO,
  SX_ROUTERS,
  advertisesLoc,
  endSid,
  locPrefix,
  sxIfTo,
  sxIfs,
  sxLocalSid,
  sxLookup,
  sxPingWalk,
  v6norm,
  v6parse,
  type IfName,
  type SxAction,
  type SxHost,
  type SxR,
  type SxRtr,
  type SxState,
} from "@/lib/sim-engine/scenarios/sxNet";

/**
 * Command lines of the SRv6 Foundations Lab — IOS XR on R1–R6. Every output is printed from the lab model: locators,
 * the local SID table, IS-IS SRv6 advertisements, the IPv6 routes that carry SIDs, interface MTUs and pings.
 *
 *   show segment-routing srv6 locator · show segment-routing srv6 sid [<sid>] · show segment-routing srv6 manager ·
 *   show isis segment-routing srv6 locators · show isis database verbose [<lsp>] · show isis adjacency ·
 *   show route ipv6 [<ip>] · show cef ipv6 <ip> · show ipv6 interface brief · show ipv6 interface <if> ·
 *   show logging · ping <ipv6>
 *   configure → segment-routing → srv6 → encapsulation → source-address · locators → locator MAIN → prefix ·
 *   router isis CORE → address-family ipv6 unicast → segment-routing srv6 → locator MAIN · interface <if> →
 *   address-family ipv6 unicast → metric · interface <if> → mtu
 */

export interface SxCliApi {
  s: SxState;
  act: (a: SxAction) => SxState;
  dev: SpDevCli<SxRtr>;
}
const age = (s: SxState) => spAge(s.clock, 15);
const ifc = (c: SxRtr, ifn: string) => c.ifs[ifn as IfName]!;
const defMetric = (r: SxR, ifn: string) => sxIfs(r).find((i) => i.ifn === ifn)!.link.metric;
const ll = (r: SxR) => `fe80::${SX_IDX[r]}`;
const BEH = { End: "End (PSP/USD)", "End.X": "End.X (PSP/USD)" } as const;

// ---------------------------------------------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------------------------------------------
const phys = (r: SxR) => sxIfs(r).map((i) => i.ifn);
const ifArg = (r: SxR, extra: ("lo0" | "lo1")[] = []): CliArgSpec => ({
  choices: [...extra.map((x) => (x === "lo0" ? "Loopback0" : "Loopback1")), ...phys(r).map((i) => xrIf(i))],
  describe: (c) => {
    const n = parseIf(c) ?? (/^(loopback1|lo1)$/i.test(c) ? "lo1" : undefined);
    const i = sxIfs(r).find((x) => x.ifn === n);
    return i ? `to ${i.peer}` : n === "lo0" ? "Loopback0" : n === "lo1" ? "Loopback1" : undefined;
  },
  resolve: (raw) => {
    if (/^(loopback1|lo1)$/i.test(raw)) return extra.includes("lo1") ? "lo1" : undefined;
    const n = parseIf(raw);
    return n && (n === "lo0" ? extra.includes("lo0") : phys(r).includes(n as IfName)) ? n : undefined;
  },
});
const v6Arg = (choices: string[], what: string): CliArgSpec => ({ choices, describe: () => what, resolve: (raw) => v6norm(raw) });
const locArg = choiceArg(["MAIN"], () => "Locator name");
const pfxArg: CliArgSpec = {
  choices: SX_ROUTERS.map((r) => `${locPrefix(SX_IDX[r])}/64`),
  describe: () => "Locator prefix (a /64 from 2001:db8:100::/48)",
  resolve: (raw) => {
    const m = /^(.+)\/(\d{1,3})$/.exec(raw);
    const h = m ? v6parse(m[1]) : undefined;
    return h && m && +m[2] <= 128 ? `${v6norm(m[1])}/${m[2]}` : undefined;
  },
};
const allSids = (s: SxState) => SX_ROUTERS.flatMap((r) => s.view.sids[r].map((x) => x.sid));
const metricArg = numArg(1, 16777214, ["5", "10", "50"], "Default metric (wide: 1–16777214)");
const lspArg: CliArgSpec = { choices: SX_ROUTERS.map((r) => `${r}.00-00`), describe: (c) => `${c.slice(0, 2)}'s LSP`, resolve: (raw) => (SX_ROUTERS.some((r) => raw.toUpperCase() === `${r}.00-00` || raw.toUpperCase() === r) ? raw.slice(0, 2).toUpperCase() : undefined) };

// ---------------------------------------------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------------------------------------------
function xrLocator(s: SxState, r: SxR): string {
  const c = s.cfg[r];
  if (!c.sr6 || c.loc === undefined) return "";
  return ["Name                  ID       Algo  Prefix                    Status   Flags", "--------------------  -------  ----  ------------------------  -------  --------", `${pad("MAIN", 22)}${pad(1, 9)}${pad(0, 6)}${pad(`${locPrefix(c.loc)}/64`, 26)}${pad("Up", 9)}`].join("\n");
}
function xrSids(s: SxState, r: SxR, only?: string): string {
  const rows = s.view.sids[r].filter((x) => !only || x.sid === only);
  if (!rows.length) return "";
  return ["", "*** Locator: 'MAIN' *** ", "", "SID                         Behavior          Context                           Owner               State  RW", "--------------------------  ----------------  --------------------------------  ------------------  -----  --", ...rows.map((x) => `${pad(x.sid, 28)}${pad(BEH[x.behavior], 18)}${pad(x.ifn ? `[${xrIf(x.ifn, true)}, Link-Local]` : x.ctx, 34)}${pad("isis-CORE", 20)}${pad("InUse", 7)}Y`)].join("\n");
}
function xrManager(s: SxState, r: SxR): string {
  const c = s.cfg[r];
  return ["Parameters:", `  SRv6 Enabled: ${c.sr6 ? "Yes" : "No"}`, "  SRv6 Operational Mode: ", "    Base:", "      SID Base Block: 2001:db8:100::/48", "  Encapsulation:", "    Source Address:", `      Configured: ${c.encap ?? "::"}`, `      Default: ${c.encap ?? "::"}`, "    Hop-Limit: Default", "    Traffic-class: Default", "Summary:", `  Number of Locators: ${c.sr6 && c.loc !== undefined ? 1 : 0} (${c.sr6 && c.loc !== undefined ? 1 : 0} operational)`, `  Number of SIDs: ${s.view.sids[r].length} (0 stale)`].join("\n");
}
function xrIsisLocators(s: SxState, r: SxR): string {
  const c = s.cfg[r];
  return ["", "IS-IS CORE SRv6 Locators", "Name                  ID       Algo  Prefix                    Status", "------                ----     ----  ------                    ------", ...(c.isisLoc && c.sr6 && c.loc !== undefined ? [`${pad("MAIN", 22)}${pad(1, 9)}${pad(0, 6)}${pad(`${locPrefix(c.loc)}/64`, 26)}Active`] : c.isisLoc ? [`${pad("MAIN", 22)}${pad("-", 9)}${pad(0, 6)}${pad("-", 26)}Not Found`] : [])].join("\n");
}
function lspLines(s: SxState, o: SxR): string[] {
  const c = s.cfg[o];
  const adv = advertisesLoc(s.cfg, o);
  const nbrs = sxIfs(o).filter((i) => s.view.adj[i.link.id]);
  return [
    `${pad(`${o}.00-00`, 22)}${pad(`0x0000000${(5 + s.cfgSeq) % 10}`, 13)}${pad(`0x${(0x8a10 + SX_IDX[o] * 37).toString(16)}`, 14)}${pad(`${1100 + SX_IDX[o] * 7} /1200`, 19)}0/0/0`,
    "  Area Address:   49.0001",
    "  NLPID:          0x8e",
    "  MT:             IPv6 Unicast                                 0/0/0",
    `  Hostname:       ${o}`,
    `  IPv6 Address:   ${SX_LO(o)}`,
    `  Router Cap:     0.0.0.0 D:0 S:0`,
    ...(adv ? ["    SRv6: O:0", "    Node Maximum SID Depth:", "      SRH Max SL: 3", "      SRH Max End Pop: 3", "      SRH Max H.encaps: 3", "      SRH Max End D: 4"] : []),
    ...nbrs.flatMap((i, k) => [`  Metric: ${pad(c.ifs[i.ifn]!.metric, 11)}MT (IPv6 Unicast) IS-Extended ${i.peer}.00`, `    Interface IPv6 Address: ${i.ip}`, ...(adv ? [`    SRv6 End.X SID: ${s.view.sids[o].find((x) => x.peer === i.peer)?.sid ?? `${locPrefix(c.loc!).replace(/::$/, "")}:${(0x40 + k).toString(16)}::`} B:0 S:0 P:0 Algorithm: 0`, "      Behavior: End.X (PSP/USD)"] : [])]),
    `  Metric: ${pad(0, 11)}MT (IPv6 Unicast) IPv6 ${SX_LO(o)}/128`,
    ...(o === "R1" ? [`  Metric: ${pad(10, 11)}MT (IPv6 Unicast) IPv6 ${SX_HOSTS.H1.net}/64`] : o === "R6" ? [`  Metric: ${pad(10, 11)}MT (IPv6 Unicast) IPv6 ${SX_HOSTS.H6.net}/64`] : []),
    ...(c.lo1 ? [`  Metric: ${pad(10, 11)}MT (IPv6 Unicast) IPv6 ${locPrefix(SX_IDX[o])}/64`] : []),
    ...(adv ? [`  SRv6 Locator:   MT (IPv6 Unicast) ${locPrefix(c.loc!)}/64 D:0 Metric: 1 Algorithm: 0`, `    END SID: ${endSid(c.loc!)} End (PSP/USD)`] : []),
  ];
}
function xrDatabase(s: SxState, only?: SxR): string {
  return ["", "IS-IS CORE (Level-2) Link State Database", "LSPID                 LSP Seq Num  LSP Checksum  LSP Holdtime/Rcvd  ATT/P/OL", ...SX_ROUTERS.filter((o) => !only || o === only).flatMap((o) => lspLines(s, o)), "", " Total Level-2 LSP count: 6     Local Level-2 LSP count: 1"].join("\n");
}
function xrAdj(s: SxState, r: SxR): string {
  const ups = sxIfs(r).filter((i) => s.view.adj[i.link.id]);
  return ["IS-IS CORE Level-2 adjacencies:", "System Id      Interface                SNPA           State Hold Changed  NSF IPv4 IPv6", "                                                                               BFD  BFD", ...ups.map((i) => `${pad(i.peer, 15)}${pad(xrIf(i.ifn, true), 25)}${pad("*PtoP*", 15)}${pad("Up", 6)}${pad(27, 5)}${pad(age(s), 9)}Yes None None`), "", `Total adjacency count: ${ups.length}`].join("\n");
}
const XR6_CODES = ["Codes: C - connected, S - static, R - RIP, B - BGP, (>) - Diversion path", "       O - OSPF, IA - OSPF inter area, i - ISIS, L1 - IS-IS level-1, L2 - IS-IS level-2", "       L - local, a - Application route", "", "Gateway of last resort is not set", ""];
const ifOf = (x: { ifn?: IfName }, r: SxR) => (x.ifn ? xrIf(x.ifn) : (SX_HOSTS.H1.r === r || SX_HOSTS.H6.r === r) && !x.ifn ? "Loopback0" : "Loopback0");
function xrRoutes(s: SxState, r: SxR): string {
  const key = (p: string) => v6parse(p)!.map((h) => h.toString(16).padStart(4, "0")).join("");
  const rows = [...s.view.rib[r]].sort((a, b) => (key(a.pfx) < key(b.pfx) ? -1 : key(a.pfx) > key(b.pfx) ? 1 : a.len - b.len)).map((x) => {
    const p = `${x.pfx}/${x.len}`;
    if (x.kind === "C" || x.kind === "L") return `${pad(x.kind, 5)}${p} is directly connected,\n      ${age(s)}, ${x.ifn ? xrIf(x.ifn) : x.len === 128 ? "Loopback0" : x.pfx.startsWith("2001:db8:100:") && !x.locator ? "Loopback1" : x.locator ? "Null0 (SRv6 locator)" : ifOf(x, r)}`;
    return `${pad(x.kind, 5)}${p}\n      [115/${x.cost}] via ${ll(x.nh!.nh)}, ${age(s)}, ${xrIf(x.nh!.ifn)}`;
  });
  return [...XR6_CODES, ...rows].join("\n");
}
function xrRouteIp(s: SxState, r: SxR, ip: string): string {
  const x = sxLookup(s.view, r, ip);
  if (!x) return "% Network not in table";
  const p = `${x.pfx}/${x.len}`;
  if (x.kind !== "i L2") return [`Routing entry for ${p}`, `  Known via "${x.kind === "C" ? "connected" : "local"}", distance 0, metric 0${x.locator ? " (SRv6 locator)" : " (connected)"}`, "  Routing Descriptor Blocks", `    directly connected, via ${x.ifn ? xrIf(x.ifn) : x.len === 128 ? "Loopback0" : x.locator ? "Null0" : "Loopback1"}`, "      Route metric is 0", "  No advertising protos."].join("\n");
  return [`Routing entry for ${p}`, `  Known via "isis CORE", distance 115, metric ${x.cost}, type level-2${x.locator ? ", SRv6 locator" : ""}`, `  Installed ${spStamp(15).xr.replace(" UTC", "")} for ${age(s)}`, "  Routing Descriptor Blocks", `    ${ll(x.nh!.nh)}, from ${SX_LO(x.owner ?? x.nh!.nh)}, via ${xrIf(x.nh!.ifn)}`, `      Route metric is ${x.cost}`, "  No advertising protos."].join("\n");
}
function xrCef6(s: SxState, r: SxR, ip: string): string {
  const ls = sxLocalSid(s.view, r, ip);
  if (ls) return [`${ls.sid}/128, version ${30 + SX_IDX[r]}, SRv6 Endpoint uN (PSP/USD)`.replace("uN", ls.behavior), " Updated " + spStamp(15).xr.replace(" UTC", ""), `  ${ls.behavior === "End" ? "Local SID: End" : `Local SID: End.X, via ${xrIf(ls.ifn!)}`}`].join("\n");
  const x = sxLookup(s.view, r, ip);
  if (!x) return `${v6norm(ip)}/128, version 0, drop adjacency`;
  if (!x.nh) return [`${x.pfx}/${x.len}, version ${20 + SX_IDX[r]}, ${x.locator ? "SRv6 locator, drop" : "attached"}`, ` Updated ${spStamp(15).xr.replace(" UTC", "")}`, `   ${x.locator ? "via Null0 (no local SID matched)" : x.ifn ? `attached to ${xrIf(x.ifn)}` : x.len === 128 ? "receive" : "via Loopback1 (no local SID matched)"}`].join("\n");
  return [`${x.pfx}/${x.len}, version ${40 + SX_IDX[r]}, internal 0x1000001 0x0 (ptr 0x7fa1b2c3d0) [1], 0x0 (0x0), 0x0 (0x0)`, ` Updated ${spStamp(15).xr.replace(" UTC", "")}`, ` Prefix Len ${x.len}, traffic index 0, precedence n/a, priority 3`, `   via ${ll(x.nh.nh)}/128, ${xrIf(x.nh.ifn)}, 6 dependencies, weight 0, class 0 [flags 0x0]`, `    next hop ${ll(x.nh.nh)}/128`].join("\n");
}
function xrV6Brief(s: SxState, r: SxR): string {
  const rows = [`${pad("Loopback0", 33)}[Up/Up]`, `    fe80::${SX_IDX[r]}:1`, `    ${SX_LO(r)}`, ...(s.cfg[r].lo1 ? [`${pad("Loopback1", 33)}[Up/Up]`, `    fe80::${SX_IDX[r]}:2`, `    ${locPrefix(SX_IDX[r])}1`] : []), ...sxIfs(r).flatMap((i) => [`${pad(xrIf(i.ifn), 33)}[Up/Up]`, `    ${ll(r)}`, `    ${i.ip}`])];
  const h = (Object.keys(SX_HOSTS) as SxHost[]).find((x) => SX_HOSTS[x].r === r);
  if (h) rows.push(`${pad(xrIf(SX_HOSTS[h].ifn), 33)}[Up/Up]`, `    ${ll(r)}`, `    ${SX_HOSTS[h].gw}`);
  return rows.join("\n");
}
function xrV6If(s: SxState, r: SxR, ifn: string): string {
  const i = sxIfs(r).find((x) => x.ifn === ifn);
  if (!i) return "";
  const mtu = s.cfg[r].ifs[i.ifn]!.mtu;
  return [`${xrIf(i.ifn)} is Up, ipv6 protocol is Up, Vrfid is default (0x60000000)`, `  IPv6 is enabled, link-local address is ${ll(r)} `, "  Global unicast address(es):", `    ${i.ip}, subnet is 2001:db8:${SX_IDX[i.link.a]}${SX_IDX[i.link.b]}::/64 `, `  Joined group address(es): ff02::1:ff00:${SX_IDX[r]} ff02::2 ff02::1`, `  MTU is ${mtu} (${mtu - 14} is available to IPv6)`, "  ICMP redirects are disabled", "  ICMP unreachables are enabled", "  ND DAD is enabled, number of DAD attempts 1", "  ND reachable time is 0 milliseconds"].join("\n");
}
function xrLogging(s: SxState, r: SxR): string {
  const lines = s.sys.filter((x) => x.dev === r).slice(-30).map((x) => {
    const st = `RP/0/RP0/CPU0:${spStamp(x.t).xr}`;
    const i = x.peer && x.kind.startsWith("adj") ? sxIfTo(r, x.peer as SxR) : undefined;
    if (x.kind === "adj-up" || x.kind === "adj-down") return `${st}: isis[1012]: %ROUTING-ISIS-5-ADJCHANGE : Adjacency to ${x.peer} (${i ? xrIf(i.ifn) : "?"}) (L2) ${x.kind === "adj-up" ? "Up, New adjacency" : "Down, Neighbor forgot us"}`;
    if (x.kind === "sid") return `${st}: isis[1012]: %ROUTING-ISIS-6-INFO : SRv6 locator MAIN ${x.peer ? `active, End SID ${x.peer} allocated` : "withdrawn"}`;
    return `${st}: config[65857]: %MGBL-CONFIG-6-DB_COMMIT : Configuration committed by user 'admin'. Use 'show commit changes ${1000000000 + x.t}' to view the changes.`;
  });
  return ["Syslog logging: enabled (0 messages dropped, 0 flushes, 0 overruns)", `    Buffer logging: level debugging, ${lines.length} messages logged`, "", "Log Buffer (2097152 bytes):", "", ...lines].join("\n");
}
function xrPing(s: SxState, r: SxR, ip: string): string {
  const w = sxPingWalk(s.cfg, s.view, r, ip);
  const code = w.ok ? "!" : w.icmp === "unreach" || w.icmp === "noroute" ? "U" : ".";
  return ["Type escape sequence to abort.", `Sending 5, 100-byte ICMP Echos to ${v6norm(ip)}, timeout is 2 seconds:`, code.repeat(5), w.ok ? `Success rate is 100 percent (5/5), round-trip min/avg/max = 1/${1 + w.path.length}/${3 + w.path.length} ms` : "Success rate is 0 percent (0/5)"].join("\n");
}

// ---------------------------------------------------------------------------------------------------------------
// Configuration as IOS XR prints it
// ---------------------------------------------------------------------------------------------------------------
export function sxXrLines(r: SxR, c: SxRtr): string[] {
  const out: string[] = [`hostname ${r}`, "!", "interface Loopback0", ` ipv6 address ${SX_LO(r)}/128`, "!"];
  if (c.lo1) out.push("interface Loopback1", " description legacy SRv6 range", ` ipv6 address ${locPrefix(SX_IDX[r])}1/64`, "!");
  for (const i of sxIfs(r)) out.push(`interface ${xrIf(i.ifn)}`, ` description to ${i.peer}`, ...(c.ifs[i.ifn]!.mtu !== DEFAULT_MTU ? [` mtu ${c.ifs[i.ifn]!.mtu}`] : []), ` ipv6 address ${i.ip}/64`, "!");
  const h = (Object.keys(SX_HOSTS) as SxHost[]).find((x) => SX_HOSTS[x].r === r);
  if (h) out.push(`interface ${xrIf(SX_HOSTS[h].ifn)}`, ` description to ${h}`, ` ipv6 address ${SX_HOSTS[h].gw}/64`, "!");
  out.push("router isis CORE", " is-type level-2-only", ` net 49.0001.0000.0000.000${SX_IDX[r]}.00`, " address-family ipv6 unicast", "  metric-style wide", ...(c.isisLoc ? ["  segment-routing srv6", "   locator MAIN", "   !", "  !"] : []), " !", " interface Loopback0", "  passive", "  address-family ipv6 unicast", "  !", " !");
  if (c.lo1) out.push(" interface Loopback1", "  passive", "  address-family ipv6 unicast", "  !", " !");
  for (const i of sxIfs(r)) {
    const f = c.ifs[i.ifn]!;
    if (!f.isis) continue;
    out.push(` interface ${xrIf(i.ifn)}`, "  point-to-point", "  address-family ipv6 unicast", ...(f.metric !== 10 ? [`   metric ${f.metric}`] : []), "  !", " !");
  }
  if (h) out.push(` interface ${xrIf(SX_HOSTS[h].ifn)}`, "  passive", "  address-family ipv6 unicast", "  !", " !");
  out.push("!");
  if (c.sr6) out.push("segment-routing", " srv6", ...(c.encap ? ["  encapsulation", `   source-address ${c.encap}`, "  !"] : []), ...(c.loc !== undefined ? ["  locators", "   locator MAIN", `    prefix ${locPrefix(c.loc)}/64`, "   !", "  !"] : []), " !", "!");
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Configuration statements
// ---------------------------------------------------------------------------------------------------------------
function stmts(r: SxR): SpCfgStmt<SxRtr>[] {
  const P2P = "% This lab keeps every core link point-to-point.";
  return [
    { id: "sr", summary: "Segment Routing", xr: { mode: "config", syntax: "segment-routing", enter: "sr", apply: (c) => c } },
    { id: "srv6", summary: "Segment Routing over IPv6", xr: { mode: "sr", syntax: "srv6", enter: "srv6", apply: (c) => ((c.sr6 = true), c), no: (c) => ((c.sr6 = false), (c.loc = undefined), (c.encap = undefined), c) } },
    { id: "encap", summary: "Encapsulation parameters", xr: { mode: "srv6", syntax: "encapsulation", enter: "srv6-encap", apply: (c) => c, no: (c) => ((c.encap = undefined), c) } },
    { id: "encap-src", summary: "Source address of the outer IPv6 header", args: { src: v6Arg([SX_LO(r)], "IPv6 address (usually Loopback0)") }, xr: { mode: "srv6-encap", syntax: "source-address <src>", noSyntax: "source-address", apply: (c, a) => (a.src === v6norm(SX_LO(r)) || sxIfs(r).some((i) => v6norm(i.ip) === a.src) ? ((c.encap = a.src), c) : `% ${a.src} is not an address of ${r}.`), no: (c) => ((c.encap = undefined), c) } },
    { id: "locs", summary: "SRv6 locators", xr: { mode: "srv6", syntax: "locators", enter: "srv6-locs", apply: (c) => c, no: (c) => ((c.loc = undefined), c) } },
    { id: "loc", summary: "An SRv6 locator", args: { name: locArg }, xr: { mode: "srv6-locs", syntax: "locator <name>", enter: "srv6-loc", apply: (c) => c, no: (c) => ((c.loc = undefined), c) } },
    { id: "loc-pfx", summary: "The locator prefix", args: { pfx: pfxArg }, xr: { mode: "srv6-loc", syntax: "prefix <pfx>", apply: (c, a) => { const [ip, len] = a.pfx.split("/"); const h = v6parse(ip)!; if (+len !== 64 || h[0] !== 0x2001 || h[1] !== 0xdb8 || h[2] !== 0x100 || h.slice(4).some((x) => x)) return "% This lab allocates locators as /64s from 2001:db8:100::/48."; c.loc = h[3]; return c; }, no: (c) => ((c.loc = undefined), c) } },
    { id: "router-isis", summary: "IS-IS routing protocol", args: { tag: choiceArg(["CORE"], () => "Instance tag") }, xr: { mode: "config", syntax: "router isis <tag>", enter: "isis", apply: (c) => c } },
    { id: "isis-af6", summary: "Enter the IPv6 unicast address family", xr: { mode: "isis", syntax: "address-family ipv6 unicast", enter: "isis-af6", apply: (c) => c } },
    { id: "isis-ms", summary: "Use wide metrics", args: { w: choiceArg(["wide"], () => "Wide metrics") }, xr: { mode: "isis-af6", syntax: "metric-style <w>", apply: (c) => c, no: () => "% SRv6 needs wide metrics." } },
    { id: "isis-srv6", summary: "SRv6 in IS-IS", xr: { mode: "isis-af6", syntax: "segment-routing srv6", enter: "isis-srv6", apply: (c) => c, no: (c) => ((c.isisLoc = false), c) } },
    { id: "isis-loc", summary: "Advertise this locator and allocate its SIDs", args: { lname: locArg }, xr: { mode: "isis-srv6", syntax: "locator <lname>", apply: (c) => ((c.isisLoc = true), c), no: (c) => ((c.isisLoc = false), c) } },
    { id: "isis-if", summary: "Enter the IS-IS interface configuration submode", args: { if: ifArg(r, ["lo0", "lo1"]) }, xr: { mode: "isis", syntax: "interface <if>", enter: "isis-if", apply: (c, a) => (a.if === "lo0" ? c : a.if === "lo1" ? (c.lo1 ? c : "% Loopback1 is not configured on this router.") : ((ifc(c, a.if).isis = true), c)), no: (c, a) => (a.if === "lo0" ? "% This lab keeps Loopback0 in IS-IS." : a.if === "lo1" ? ((c.lo1 = false), c) : ((ifc(c, a.if).isis = false), c)) } },
    { id: "isis-p2p", summary: "Treat the interface as point-to-point", xr: { mode: "isis-if", syntax: "point-to-point", apply: (c) => c, no: () => P2P } },
    { id: "isis-passive", summary: "Advertise the prefix but send no hellos", xr: { mode: "isis-if", syntax: "passive", apply: (c, _a, x) => (x.if === "lo0" || x.if === "lo1" ? c : "% This lab only uses passive on loopbacks.") } },
    { id: "isis-if-af6", summary: "Enter the interface IPv6 unicast address family", xr: { mode: "isis-if", syntax: "address-family ipv6 unicast", enter: "isis-if-af6", apply: (c) => c } },
    { id: "isis-metric", summary: "Set the default metric for this interface", args: { n: metricArg }, xr: { mode: "isis-if-af6", syntax: "metric <n>", noSyntax: "metric", apply: (c, a, x) => (x.if === "lo0" || x.if === "lo1" ? "% This lab keeps loopbacks at their default metric." : ((ifc(c, x.if).metric = +a.n), c)), no: (c, _a, x) => (x.if === "lo0" || x.if === "lo1" ? c : ((ifc(c, x.if).metric = defMetric(r, x.if)), c)) } },
    { id: "gif", summary: "Interface configuration", args: { gif: ifArg(r, ["lo1"]) }, xr: { mode: "config", syntax: "interface <gif>", enter: "if", apply: (c, a) => (a.gif === "lo1" && !c.lo1 ? "% This lab doesn't create new loopbacks." : c), no: (c, a) => (a.gif === "lo1" ? ((c.lo1 = false), c) : "% This lab keeps its interfaces.") } },
    { id: "mtu", summary: "Interface MTU (layer 2, bytes)", args: { n: numArg(1514, 9216, ["9216", "1514"], "MTU 1514–9216") }, xr: { mode: "if", syntax: "mtu <n>", noSyntax: "mtu", apply: (c, a, x) => (x.gif === "lo1" ? "% Loopbacks keep their MTU." : ((ifc(c, x.gif).mtu = +a.n), c)), no: (c, _a, x) => (x.gif === "lo1" ? c : ((ifc(c, x.gif).mtu = DEFAULT_MTU), c)) } },
  ];
}

// ---------------------------------------------------------------------------------------------------------------
// Command set
// ---------------------------------------------------------------------------------------------------------------
export function sxXrSpec(api: SxCliApi, r: SxR): SpXrSpec<SxRtr> {
  const s = api.s;
  const sh = (id: string, syntax: string, summary: string, run: SpCmd["run"], args?: SpCmd["args"]): SpCmd => ({ id, syntax, summary, run, args });
  const nothing = (o: string, why: string) => o || { output: "", explanation: why };
  const sidArg = v6Arg(allSids(s).length ? allSids(s) : [endSid(SX_IDX[r])], "An SRv6 SID");
  const anyV6 = v6Arg([endSid(3), endSid(6), SX_LO("R6"), SX_HOSTS.H6.ip], "IPv6 address");
  return {
    stmts: stmts(r),
    prompts: { config: "config", sr: "config-sr", srv6: "config-srv6", "srv6-encap": "config-srv6-encap", "srv6-locs": "config-srv6-locators", "srv6-loc": "config-srv6-locator", isis: "config-isis", "isis-af6": "config-isis-af", "isis-srv6": "config-isis-srv6", "isis-if": "config-isis-if", "isis-if-af6": "config-isis-if-af", if: "config-if" },
    lines: (c) => sxXrLines(r, c),
    help: { "show segment-routing": "Segment routing information", "show segment-routing srv6": "SRv6 information", "show isis": "IS-IS information", "show isis segment-routing": "Segment routing information", "show route": "IP routing table", "show cef": "Cisco Express Forwarding", "show ipv6": "IPv6 information" },
    shows: [
      sh("loc", "show segment-routing srv6 locator", "This router's SRv6 locators", () => nothing(xrLocator(s, r), "No SRv6 locator is configured.")),
      sh("sid", "show segment-routing srv6 sid", "The local SID table: what this router does with its SIDs", () => nothing(xrSids(s, r), "No local SID is allocated.")),
      sh("sidx", "show segment-routing srv6 sid <sid>", "One local SID", (a) => nothing(xrSids(s, r, a.sid), "No such local SID on this router."), { sid: sidArg }),
      sh("mgr", "show segment-routing srv6 manager", "SRv6 parameters: encapsulation source", () => xrManager(s, r)),
      sh("isloc", "show isis segment-routing srv6 locators", "Locators IS-IS advertises", () => xrIsisLocators(s, r)),
      sh("db", "show isis database verbose", "Every LSP: SRv6 locators, End and End.X SIDs", () => xrDatabase(s)),
      sh("dbl", "show isis database verbose <lsp>", "One router's LSP", (a) => xrDatabase(s, a.lsp as SxR), { lsp: lspArg }),
      sh("adj", "show isis adjacency", "IS-IS adjacencies", () => xrAdj(s, r)),
      sh("rt6", "show route ipv6", "The IPv6 routing table", () => xrRoutes(s, r)),
      sh("rt6ip", "show route ipv6 <ip>", "The route an IPv6 destination (or SID) uses", (a) => xrRouteIp(s, r, a.ip), { ip: anyV6 }),
      sh("cef6", "show cef ipv6 <ip>", "The forwarding entry for an IPv6 destination", (a) => xrCef6(s, r, a.ip), { ip: anyV6 }),
      sh("v6b", "show ipv6 interface brief", "IPv6 addresses per interface", () => xrV6Brief(s, r)),
      sh("v6i", "show ipv6 interface <if>", "One interface's IPv6 state, with its MTU", (a) => nothing(xrV6If(s, r, a.if), "Not a core interface."), { if: ifArg(r) }),
      sh("log", "show logging", "The syslog buffer", () => xrLogging(s, r)),
    ],
    exec: [
      sh("ping", "ping <dst>", "Send ICMPv6 echoes (an instantiated SID answers)", (a) => {
        api.act({ type: "ping", from: r, dst: a.dst });
        return xrPing(s, r, a.dst);
      }, { dst: anyV6 }),
    ],
  };
}
export function sxSets(api: SxCliApi, r: SxR): Partial<Record<CliVendor, CliCommandSet>> {
  return { cisco: buildXrSet(api.dev, sxXrSpec(api, r)) };
}
export function sxStaticApi(s: SxState, r: SxR): SxCliApi {
  return { s, act: () => s, dev: { host: r, running: s.cfg[r], hist: s.hist[r], setCand: () => undefined, xr: [], setXr: () => undefined, edit: false, setEdit: () => undefined, commit: () => undefined } };
}
export { CORE_MTU };
