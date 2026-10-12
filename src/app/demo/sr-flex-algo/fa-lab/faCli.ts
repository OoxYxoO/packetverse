import type { CliArgSpec, CliCommandSet, CliVendor } from "@/lib/cli/types";
import { buildXrSet, choiceArg, numArg, type SpCfgStmt, type SpCmd, type SpDevCli, type SpXrSpec } from "@/components/sp-lab/spCli";
import { lpad, pad, spAge, spStamp } from "@/components/sp-lab/spKit";
import { parseIf, xrIf } from "@/components/sp-lab/spNames";
import {
  AFF_BIT,
  FA_HOSTS,
  FA_IDX,
  FA_LINKS,
  FA_LO,
  FA_ROUTERS,
  LL_COLOR,
  SRGB_START,
  algoLabel,
  faIfTo,
  faIfs,
  faRouterOfLo,
  steer,
  sysId,
  type Aff,
  type FaAction,
  type FaEntry,
  type FaHost,
  type FaR,
  type FaRtr,
  type FaState,
  type IfName,
} from "@/lib/sim-engine/scenarios/faNet";

/**
 * Command lines of the SR Flex-Algo Lab — IOS XR on R1–R6. Every output is printed from the lab model: the Flex-Algo
 * definitions and their election, participation, the algorithm topologies and labels, delays and policy LOW-LATENCY.
 *
 *   show isis flex-algo [<n>] · show isis database verbose [<lsp>] · show isis segment-routing label table ·
 *   show isis adjacency · show mpls forwarding [labels <n>] · show performance-measurement interfaces ·
 *   show segment-routing traffic-eng policy · show bgp ipv4 unicast [<prefix>] · show cef <ip> · show route [<ip>] ·
 *   show logging
 *   configure → router isis CORE → affinity-map · flex-algo <n> → priority · metric-type delay · advertise-definition ·
 *   affinity exclude-any | include-any · interface <if> → affinity flex-algo · address-family ipv4 unicast → metric ·
 *   interface Loopback0 → address-family ipv4 unicast → prefix-sid [algorithm <n>] index · address-family ipv4 unicast →
 *   segment-routing mpls · performance-measurement → interface <if> → delay-measurement → advertise-delay
 */

export interface FaCliApi {
  s: FaState;
  act: (a: FaAction) => FaState;
  dev: SpDevCli<FaRtr>;
}
const age = (s: FaState) => spAge(s.clock, 15);
const ipNum = (ip: string) => ip.split(".").reduce((a, o) => a * 256 + Number(o), 0);
const inPfx = (ip: string, p: string, len: number) => Math.floor(ipNum(ip) / 2 ** (32 - len)) === Math.floor(ipNum(p) / 2 ** (32 - len));
const ifc = (c: FaRtr, ifn: string) => c.ifs[ifn as IfName]!;
const defMetric = (r: FaR, ifn: string) => faIfs(r).find((i) => i.ifn === ifn)!.link.metric;
const AFFS: Aff[] = ["BLUE", "GOLD"];
const affMask = (a: Aff[]) => `0x${a.reduce((m, x) => m | (1 << AFF_BIT[x]), 0).toString(16).padStart(8, "0")}`;
const indexOf = (l: number) => l - SRGB_START;
const algoOfLabel = (s: FaState, l: number): { r: FaR; algo: number } | undefined => {
  for (const r of FA_ROUTERS) {
    if (algoLabel(s.cfg, r, 0) === l) return { r, algo: 0 };
    for (const a of Object.keys(s.cfg[r].algoSid).map(Number)) if (algoLabel(s.cfg, r, a) === l) return { r, algo: a };
  }
  return undefined;
};

// ---------------------------------------------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------------------------------------------
const phys = (r: FaR) => faIfs(r).map((i) => i.ifn);
const xrIfArg = (r: FaR, withLo = false): CliArgSpec => ({
  choices: [...(withLo ? ["Loopback0"] : []), ...phys(r).map((i) => xrIf(i))],
  describe: (c) => {
    const n = parseIf(c);
    const i = faIfs(r).find((x) => x.ifn === n);
    return i ? `to ${i.peer}` : n === "lo0" ? "Loopback interface" : undefined;
  },
  resolve: (raw) => {
    const n = parseIf(raw);
    return n && (n === "lo0" ? withLo : phys(r).includes(n as IfName)) ? n : undefined;
  },
});
const faArg = numArg(128, 255, ["128", "129"], "Flex-Algo number (128–255)");
const affArg = choiceArg(AFFS, (a) => `Affinity ${a} (bit ${AFF_BIT[a as Aff]})`);
const metricArg = numArg(1, 16777214, ["10", "20"], "Default metric (wide: 1–16777214)");
const ipArg: CliArgSpec = {
  choices: [...FA_ROUTERS.map((r) => FA_LO[r]), FA_HOSTS.H6.ip, FA_HOSTS.H66.ip],
  describe: (c) => faRouterOfLo(c) ?? (c === FA_HOSTS.H6.ip ? "H6" : c === FA_HOSTS.H66.ip ? "H66" : undefined),
  resolve: (raw) => (/^(\d{1,3}\.){3}\d{1,3}$/.test(raw) && raw.split(".").every((o) => +o <= 255) ? raw : undefined),
};
const pfxArg: CliArgSpec = {
  choices: ["192.168.6.0/24", "192.168.66.0/24", "192.168.1.0/24"],
  describe: (c) => (c.startsWith("192.168.66") ? "H66 — color 128" : c.startsWith("192.168.6.") ? "H6" : "H1"),
  resolve: (raw) => {
    const m = /^((\d{1,3}\.){3}\d{1,3})(\/(\d{1,2}))?$/.exec(raw);
    return m && m[1].split(".").every((o) => +o <= 255) && (!m[4] || +m[4] <= 32) ? m[1] : undefined;
  },
};
const lspArg: CliArgSpec = { choices: FA_ROUTERS.map((r) => `${r}.00-00`), describe: (c) => `${c.slice(0, 2)}'s LSP`, resolve: (raw) => (FA_ROUTERS.some((r) => raw.toUpperCase() === `${r}.00-00` || raw.toUpperCase() === r) ? raw.slice(0, 2).toUpperCase() : undefined) };
const labelArg = numArg(16, 1048575, ["16106", "16006"], "An MPLS label");

// ---------------------------------------------------------------------------------------------------------------
// IOS XR outputs
// ---------------------------------------------------------------------------------------------------------------
function xrFlexAlgo(s: FaState, r: FaR, only?: number): string {
  const algos = [...new Set([...Object.keys(s.view.fad).map(Number), ...Object.keys(s.cfg[r].fa).map(Number)])].filter((a) => a !== 0 && (only === undefined || a === only)).sort((a, b) => a - b);
  if (!algos.length) return "";
  const blocks = algos.map((a) => {
    const f = s.view.fad[a];
    const mine = s.cfg[r].fa[a];
    const eq = !!f && !!mine && f.def.mt === mine.mt && f.def.excl.join() === mine.excl.join() && f.def.incl.join() === mine.incl.join() && f.def.prio === mine.prio;
    const disabled = !mine || !f;
    return [
      `Flex-Algo ${a}:`,
      "",
      "Level-2:",
      "",
      ...(f
        ? [
            `  Definition Priority: ${f.def.prio}`,
            `  Definition Source: ${f.src}.00`,
            `  Definition Equal to Local: ${mine ? (eq ? "Yes" : "No") : "No (not configured locally)"}`,
            `  Definition Metric Type: ${f.def.mt === "delay" ? "Delay" : "IGP"}`,
            "  Definition Flex-Algo Prefix Metric: No",
            "",
            ...(f.def.excl.length ? [`  Exclude Any Affinity Bit Positions: ${f.def.excl.map((x) => AFF_BIT[x]).join(",")}`] : []),
            ...(f.def.incl.length ? [`  Include Any Affinity Bit Positions: ${f.def.incl.map((x) => AFF_BIT[x]).join(",")}`] : []),
            ...(f.def.excl.length || f.def.incl.length ? [""] : []),
          ]
        : ["  Definition: none received", ""]),
      `  Disabled: ${disabled ? "Yes" : "No"}`,
      "",
      `Local Priority: ${mine ? mine.prio : "-"}`,
      "FRR Disabled: No",
      "Microloop Avoidance Disabled: No",
      `Data Plane Segment Routing: ${mine && s.cfg[r].sr ? "Yes" : "No"}`,
    ].join("\n");
  });
  return ["", "IS-IS CORE Flex-Algo Database", "", ...blocks.flatMap((b) => [b, ""])].join("\n");
}
function lspLines(s: FaState, o: FaR): string[] {
  const c = s.cfg[o];
  const algos = Object.keys(c.fa).map(Number).sort((a, b) => a - b);
  const nbrs = faIfs(o).filter((i) => s.view.adj[i.link.id]);
  return [
    `${pad(`${o}.00-00`, 22)}${pad(`0x0000000${(5 + s.cfgSeq) % 10}`, 13)}${pad(`0x${(0x8a10 + FA_IDX[o] * 37).toString(16)}`, 14)}${pad(`${1100 + FA_IDX[o] * 7} /1200`, 19)}0/0/0`,
    "  Area Address:   49.0001",
    "  NLPID:          0xcc",
    `  IP Address:     ${FA_LO[o]}`,
    `  Hostname:       ${o}`,
    `  Router Cap:     ${FA_LO[o]} D:0 S:0`,
    ...(c.sr ? ["    Segment Routing: I:1 V:0, SRGB Base: 16000 Range: 8000", "    SR Algorithm:", "      Algorithm: 0", "      Algorithm: 1", ...algos.map((a) => `      Algorithm: ${a}`)] : []),
    ...algos.filter((a) => c.fa[a].adv).flatMap((a) => {
      const d = c.fa[a];
      return ["    Flex-Algo Definition:", `      Algorithm: ${a} Metric-Type: ${d.mt === "delay" ? 1 : 0} Alg-type: 0 Priority: ${d.prio}`, ...(d.excl.length ? ["      Flex-Algo Exclude-Any Ext Admin Group:", `        ${affMask(d.excl)}`] : []), ...(d.incl.length ? ["      Flex-Algo Include-Any Ext Admin Group:", `        ${affMask(d.incl)}`] : [])];
    }),
    ...nbrs.flatMap((i) => {
      const f = c.ifs[i.ifn]!;
      return [`  Metric: ${pad(f.metric, 11)}IS-Extended ${i.peer}.00`, `    Interface IP Address: ${i.ip}`, `    Neighbor IP Address: ${i.peerIp}`, ...(f.aff.length || f.delay !== undefined ? ["    Application Specific Link Attributes:", "      L flag: 0, SA-Length: 1, UDA-Length: 0", "        Standard Applications: FLEX-ALGO", ...(f.aff.length ? ["      Ext Admin Group:", `        ${affMask(f.aff)}`] : []), ...(f.delay !== undefined ? [`      Link Average Delay: ${f.delay} us`, `      Link Min/Max Delay: ${f.delay}/${f.delay} us`, "      Link Delay Variation: 0 us"] : [])] : [])];
    }),
    `  Metric: ${pad(0, 11)}IP-Extended ${FA_LO[o]}/32`,
    ...(c.sid !== undefined ? [`    Prefix-SID Index: ${c.sid}, Algorithm:0, R:0 N:1 P:0 E:0 V:0 L:0`] : []),
    ...Object.entries(c.algoSid).map(([a, i]) => `    Prefix-SID Index: ${i}, Algorithm:${a}, R:0 N:1 P:0 E:0 V:0 L:0`),
  ];
}
function xrDatabase(s: FaState, only?: FaR): string {
  return ["", "IS-IS CORE (Level-2) Link State Database", "LSPID                 LSP Seq Num  LSP Checksum  LSP Holdtime/Rcvd  ATT/P/OL", ...FA_ROUTERS.filter((o) => !only || o === only).flatMap((o) => lspLines(s, o)), "", " Total Level-2 LSP count: 6     Local Level-2 LSP count: 1"].join("\n");
}
function xrLabelTable(s: FaState, r: FaR): string {
  if (!s.cfg[r].sr) return "";
  const rows = [...s.view.table[r]].sort((a, b) => a.label - b.label).map((e) => `${pad(e.label, 14)}${e.own ? "Loopback0" : `${FA_LO[e.dst]}/32`}${e.algo ? `  (algo ${e.algo})` : ""}`);
  return ["", "IS-IS CORE IS Label Table", "Label         Prefix/Interface", "----------    ----------------", ...rows].join("\n");
}
const FWD_HEAD = ["Local  Outgoing    Prefix             Outgoing     Next Hop        Bytes", "Label  Label       or ID              Interface                    Switched", "------ ----------- ------------------ ------------ --------------- ------------"];
const outTxt = (e: FaEntry) => (e.out === "Pop" ? "Pop" : String(e.out));
function xrForwarding(s: FaState, r: FaR, only?: number): string {
  if (!s.cfg[r].sr) return "";
  const rows = [...s.view.table[r]].filter((e) => !e.own && (only === undefined || e.label === only)).sort((a, b) => a.label - b.label).map((e) => `${pad(e.label, 7)}${pad(outTxt(e), 12)}${pad(`SR Pfx (idx ${indexOf(e.label)})`, 19)}${pad(xrIf(e.nh!.ifn, true), 13)}${pad(e.nh!.ip, 16)}0`);
  if (only !== undefined && !rows.length) return "";
  return [...FWD_HEAD, ...rows].join("\n");
}
function xrAdj(s: FaState, r: FaR): string {
  const ups = faIfs(r).filter((i) => s.view.adj[i.link.id]);
  return ["IS-IS CORE Level-2 adjacencies:", "System Id      Interface                SNPA           State Hold Changed  NSF IPv4 IPv6", "                                                                               BFD  BFD", ...ups.map((i) => `${pad(i.peer, 15)}${pad(xrIf(i.ifn, true), 25)}${pad("*PtoP*", 15)}${pad("Up", 6)}${pad(27, 5)}${pad(age(s), 9)}Yes None None`), "", `Total adjacency count: ${ups.length}`].join("\n");
}
function xrPm(s: FaState, r: FaR): string {
  const ifs = faIfs(r).filter((i) => s.cfg[r].ifs[i.ifn]!.delay !== undefined);
  if (!ifs.length) return "";
  return ["", "-------------------------------------------------------------------------------", "0/RP0/CPU0", "-------------------------------------------------------------------------------", "", ...ifs.flatMap((i, k) => [`Interface Name: ${xrIf(i.ifn)} (ifh: 0x${(0x1000 + 0x40 * FA_IDX[r] + k).toString(16)})`, "  Delay-Measurement                 : Enabled", "  Loss-Measurement                  : Disabled", `  Configured IPv4 Address           : ${i.ip}`, `  Advertised delay (static)         : ${s.cfg[r].ifs[i.ifn]!.delay} uSec`, "  Next-hop MAC                      : Unknown", ""])].join("\n");
}
function xrPolicy(s: FaState, r: FaR): string {
  if (r !== "R1") return "";
  const p = s.view.pol;
  return [
    "",
    "SR-TE policy database",
    "---------------------",
    "",
    `Color: ${LL_COLOR}, End-point: ${FA_LO.R6}`,
    "  Name: srte_c_128_ep_10.0.0.6",
    "  Status:",
    `    Admin: up  Operational: ${p.up ? `up for ${age(s)} (since ${spStamp(40).xr.replace(" UTC", "")})` : "down"}`,
    "  Candidate-paths:",
    `    Preference: 100 (configuration)${p.up ? " (active)" : ""}`,
    "      Name: LOW-LATENCY",
    `      Dynamic (${p.up ? "valid" : "invalid"})${p.up ? "" : `\n        Reason: ${p.why}`}`,
    "        Metric Type: DELAY,   Path Accumulated Metric: " + (p.up ? String(s.view.rib[128].R1.find((x) => x.dst === "R6")?.cost ?? 0) : "0"),
    "        SID Algorithm: 128",
    ...p.labels.map((l) => `          ${l} [Prefix-SID: ${FA_LO.R6}, Algorithm: 128]`),
    "  Attributes:",
    "    Forward Class: Not Configured",
    "    Steering labeled-services disabled: no",
    "    Steering BGP disabled: no",
    "    IPv6 caps enable: yes",
    "",
  ].join("\n");
}
function xrBgp(s: FaState, r: FaR, raw?: string): string {
  if (r !== "R1" && r !== "R6") return "% BGP instance 'default' not active";
  const nets: { h: FaHost; nh: string; local: boolean }[] = r === "R1" ? [{ h: "H1", nh: "0.0.0.0", local: true }, { h: "H6", nh: FA_LO.R6, local: false }, { h: "H66", nh: FA_LO.R6, local: false }] : [{ h: "H1", nh: FA_LO.R1, local: false }, { h: "H6", nh: "0.0.0.0", local: true }, { h: "H66", nh: "0.0.0.0", local: true }];
  if (raw) {
    const ip = raw.split("/")[0];
    const x = nets.find((n) => inPfx(ip, FA_HOSTS[n.h].net, 24));
    if (!x) return "% Network not in table";
    const host = FA_HOSTS[x.h];
    const head = [`BGP routing table entry for ${host.net}/24`, "Versions:", "  Process           bRIB/RIB  SendTblVer", "  Speaker                   7            7", `Last Modified: ${spStamp(40).xr.replace(" UTC", "")} for ${age(s)}`, "Paths: (1 available, best #1)"];
    if (x.local) return [...head, "  Advertised to peers (in unique update groups):", `    ${r === "R6" ? FA_LO.R1 : FA_LO.R6}`, "  Path #1: Received by speaker 0", "  Local", `    0.0.0.0 from 0.0.0.0 (${FA_LO[r]})`, "      Origin IGP, metric 0, localpref 100, weight 32768, valid, redistributed, best, group-best", ...(host.color ? [`      (exported to 10.0.0.1 with Extended community: Color:${host.color})`] : [])].join("\n");
    const metric = s.view.rib[0][r].find((y) => y.dst === host.r)?.cost ?? 0;
    return [...head, "  Not advertised to any peer", "  Path #1: Received by speaker 0", "  Local", `    ${x.nh}${host.color ? ` C:${host.color}` : ""} (metric ${metric}) from ${x.nh} (${x.nh})`, "      Origin IGP, metric 0, localpref 100, valid, internal, best, group-best", "      Received Path ID 0, Local Path ID 1, version 7", ...(host.color ? [`      Extended community: Color:${host.color}`, `      SR policy color ${host.color}, ${s.view.pol.up ? "up" : "down"}, registered`] : [])].join("\n");
  }
  return [`BGP router identifier ${FA_LO[r]}, local AS number 65000`, "BGP generic scan interval 60 secs", "BGP table state: Active", "Table ID: 0xe0000000   RD version: 7", "BGP main routing table version 7", "", "Status codes: s suppressed, d damped, h history, * valid, > best", "              i - internal, r RIB-failure, S stale, N Nexthop-discard", "Origin codes: i - IGP, e - EGP, ? - incomplete", "   Network            Next Hop            Metric LocPrf Weight Path", ...nets.map((x) => `${x.local ? "*> " : "*>i"}${pad(`${FA_HOSTS[x.h].net}/24`, 19)}${pad(r === "R1" && FA_HOSTS[x.h].color ? `${x.nh} C:${LL_COLOR}` : x.nh, 20)}${x.local ? "0         32768 i" : "0    100      0 i"}`), "", "Processed 3 prefixes, 3 paths"].join("\n");
}
function xrCef(s: FaState, r: FaR, raw: string): string {
  const ip = raw.split("/")[0];
  const h = (Object.keys(FA_HOSTS) as FaHost[]).find((x) => inPfx(ip, FA_HOSTS[x].net, 24));
  if (h && r === "R1" && FA_HOSTS[h].r === "R6") {
    const host = FA_HOSTS[h];
    const st = steer(s.cfg, s.view, h);
    const e = st.labels.length ? s.view.table.R1.find((x) => x.label === st.labels[0]) : undefined;
    const head = `${host.net}/24, version ${50 + (ipNum(ip) % 7)}, internal 0x5000001 0x30 (ptr 0x7fa1b2c3d0) [1], 0x0 (0x0), 0x0 (0x0)`;
    if (host.color && s.view.pol.up) return [head, ` Updated ${spStamp(40).xr.replace(" UTC", "")}`, " Prefix Len 24, traffic index 0, precedence n/a, priority 4", `   via local-label 24001 (srte_c_${LL_COLOR}_ep_10.0.0.6), 3 dependencies, recursive [flags 0x6000]`, `    next hop ${e!.nh!.ip}/32 ${xrIf(e!.nh!.ifn, true)}    labels imposed {${e!.out === "Pop" ? "ImplNull" : e!.out}}`].join("\n");
    return [head, ` Updated ${spStamp(30).xr.replace(" UTC", "")}`, " Prefix Len 24, traffic index 0, precedence n/a, priority 4", `   via ${FA_LO.R6}/32, 3 dependencies, recursive [flags 0x6000]`, ...(e ? [`    next hop ${e.nh!.ip}/32 ${xrIf(e.nh!.ifn, true)}    labels imposed {${e.out === "Pop" ? "ImplNull" : e.out}}`] : ["    unresolved"])].join("\n");
  }
  const lo = faRouterOfLo(ip);
  if (lo && lo !== r) {
    const e = s.view.table[r].find((x) => x.algo === 0 && x.dst === lo);
    if (!e) return `${ip}/32, version 0, drop adjacency`;
    return [`${ip}/32, version ${40 + FA_IDX[r]}, labeled SR, internal 0x1000001 0x8310 (ptr 0x7fa1b2c3d0) [1], 0x0 (0x0), 0x0 (0x0)`, ` Updated ${spStamp(15).xr.replace(" UTC", "")}`, ` local label ${e.label}`, `   via ${e.nh!.ip}/32, ${xrIf(e.nh!.ifn)}, 9 dependencies, weight 0, class 0 [flags 0x0]`, `    next hop ${e.nh!.ip}/32`, `     local label ${e.label}      labels imposed {${e.out === "Pop" ? "ImplNull" : e.out}}`].join("\n");
  }
  return `${ip}/32, version 0, drop adjacency`;
}
const XR_CODES = ["Codes: C - connected, S - static, R - RIP, B - BGP, (>) - Diversion path", "       O - OSPF, IA - OSPF inter area, i - ISIS, L1 - IS-IS level-1, L2 - IS-IS level-2", "       L - local, a - Application route", "", "Gateway of last resort is not set", ""];
interface XrRt {
  p: string;
  len: number;
  kind: string;
  metric: number;
  nh?: { ip: string; ifn: string };
  ifn?: string;
}
function xrRib(s: FaState, r: FaR): XrRt[] {
  const out: XrRt[] = [{ p: FA_LO[r], len: 32, kind: "L", metric: 0, ifn: "lo0" }];
  for (const i of faIfs(r)) out.push({ p: i.ip.replace(/\.\d+$/, ".0"), len: 24, kind: "C", metric: 0, ifn: i.ifn }, { p: i.ip, len: 32, kind: "L", metric: 0, ifn: i.ifn });
  for (const h of (Object.keys(FA_HOSTS) as FaHost[]).filter((x) => FA_HOSTS[x].r === r)) out.push({ p: FA_HOSTS[h].net, len: 24, kind: "C", metric: 0, ifn: FA_HOSTS[h].ifn }, { p: FA_HOSTS[h].gw, len: 32, kind: "L", metric: 0, ifn: FA_HOSTS[h].ifn });
  for (const rt of s.view.rib[0][r]) if (rt.nh) out.push({ p: FA_LO[rt.dst], len: 32, kind: "i L2", metric: rt.cost, nh: { ip: rt.nh.ip, ifn: rt.nh.ifn } });
  for (const l of FA_LINKS) {
    if (l.a === r || l.b === r || !s.view.adj[l.id]) continue;
    const near = [l.a, l.b].map((x) => s.view.rib[0][r].find((y) => y.dst === x)).filter((x): x is NonNullable<typeof x> => !!x?.nh).sort((a, b) => a.cost - b.cost)[0];
    if (near) out.push({ p: `10.1.${FA_IDX[l.a]}${FA_IDX[l.b]}.0`, len: 24, kind: "i L2", metric: near.cost + l.metric, nh: { ip: near.nh!.ip, ifn: near.nh!.ifn } });
  }
  if (r === "R1") for (const h of ["H6", "H66"] as FaHost[]) out.push({ p: FA_HOSTS[h].net, len: 24, kind: "B", metric: 0, nh: { ip: FA_LO.R6, ifn: "" } });
  if (r === "R6") out.push({ p: FA_HOSTS.H1.net, len: 24, kind: "B", metric: 0, nh: { ip: FA_LO.R1, ifn: "" } });
  return out.sort((a, b) => ipNum(a.p) - ipNum(b.p) || a.len - b.len);
}
function xrRouteLine(s: FaState, x: XrRt) {
  const p = `${x.p}/${x.len}`;
  if (x.kind === "C" || x.kind === "L") return `${pad(x.kind, 5)}${p} is directly connected, ${age(s)}, ${xrIf(x.ifn!)}`;
  if (x.kind === "B") return `${pad("B", 5)}${p} [200/0] via ${x.nh!.ip}, ${age(s)}`;
  return `${pad(`${pad(x.kind, 5)}${p}`, 23)}[115/${x.metric}] via ${x.nh!.ip}, ${age(s)}, ${xrIf(x.nh!.ifn)}`;
}
function xrRouteIp(s: FaState, r: FaR, ip: string): string {
  const x = xrRib(s, r).filter((y) => inPfx(ip, y.p, y.len)).sort((a, b) => b.len - a.len)[0];
  if (!x) return "% Network not in table";
  const p = `${x.p}/${x.len}`;
  if (x.kind === "C" || x.kind === "L") return [`Routing entry for ${p}`, `  Known via "${x.kind === "C" ? "connected" : "local"}", distance 0, metric 0 (connected)`, "  Routing Descriptor Blocks", `    directly connected, via ${xrIf(x.ifn!)}`, "      Route metric is 0", "  No advertising protos."].join("\n");
  if (x.kind === "B") return [`Routing entry for ${p}`, `  Known via "bgp 65000", distance 200, metric 0, type internal`, `  Installed ${spStamp(30).xr.replace(" UTC", "")} for ${age(s)}`, "  Routing Descriptor Blocks", `    ${x.nh!.ip}, from ${x.nh!.ip}`, "      Route metric is 0", "  No advertising protos."].join("\n");
  const lo = faRouterOfLo(x.p);
  const e = lo ? s.view.table[r].find((y) => y.algo === 0 && y.dst === lo) : undefined;
  return [`Routing entry for ${p}`, `  Known via "isis CORE", distance 115, metric ${x.metric}${e ? ", labeled SR" : ""}, type level-2`, `  Installed ${spStamp(15).xr.replace(" UTC", "")} for ${age(s)}`, "  Routing Descriptor Blocks", `    ${x.nh!.ip}, from ${x.p}, via ${xrIf(x.nh!.ifn)}`, `      Route metric is ${x.metric}`, ...(e ? [`      Label: ${e.out === "Pop" ? "0x3 (3)" : `0x${(e.out as number).toString(16)} (${e.out})`}`] : []), "  No advertising protos."].join("\n");
}
function xrLogging(s: FaState, r: FaR): string {
  const lines = s.sys.filter((x) => x.dev === r).slice(-30).map((x) => {
    const st = `RP/0/RP0/CPU0:${spStamp(x.t).xr}`;
    const i = x.peer && x.kind !== "fad" ? faIfTo(r, x.peer as FaR) : undefined;
    if (x.kind === "adj-up" || x.kind === "adj-down") return `${st}: isis[1012]: %ROUTING-ISIS-5-ADJCHANGE : Adjacency to ${x.peer} (${i ? xrIf(i.ifn) : "?"}) (L2) ${x.kind === "adj-up" ? "Up, New adjacency" : "Down, Neighbor forgot us"}`;
    if (x.kind === "fad") {
      const f = s.view.fad[Number(x.peer)];
      return `${st}: isis[1012]: %ROUTING-ISIS-6-INFO : Flex-Algo ${x.peer} definition ${f ? `changed: source ${f.src}.00, priority ${f.def.prio}` : "no longer advertised"}`;
    }
    return `${st}: config[65857]: %MGBL-CONFIG-6-DB_COMMIT : Configuration committed by user 'admin'. Use 'show commit changes ${1000000000 + x.t}' to view the changes.`;
  });
  return ["Syslog logging: enabled (0 messages dropped, 0 flushes, 0 overruns)", `    Buffer logging: level debugging, ${lines.length} messages logged`, "", "Log Buffer (2097152 bytes):", "", ...lines].join("\n");
}

// ---------------------------------------------------------------------------------------------------------------
// Configuration as IOS XR prints it
// ---------------------------------------------------------------------------------------------------------------
export function faXrLines(r: FaR, c: FaRtr): string[] {
  const out: string[] = [`hostname ${r}`, "!", "interface Loopback0", ` ipv4 address ${FA_LO[r]} 255.255.255.255`, "!"];
  for (const i of faIfs(r)) out.push(`interface ${xrIf(i.ifn)}`, ` description to ${i.peer}`, ` ipv4 address ${i.ip} 255.255.255.0`, "!");
  for (const h of (Object.keys(FA_HOSTS) as FaHost[]).filter((x) => FA_HOSTS[x].r === r)) out.push(`interface ${xrIf(FA_HOSTS[h].ifn)}`, ` description to ${h}`, ` ipv4 address ${FA_HOSTS[h].gw} 255.255.255.0`, "!");
  out.push("router isis CORE", " is-type level-2-only", ` net 49.0001.${sysId(r)}.00`, " affinity-map BLUE bit-position 0", " affinity-map GOLD bit-position 1");
  for (const a of Object.keys(c.fa).map(Number).sort((x, y) => x - y)) {
    const d = c.fa[a];
    out.push(` flex-algo ${a}`, ...(d.prio !== 128 ? [`  priority ${d.prio}`] : []), ...(d.mt === "delay" ? ["  metric-type delay"] : []), ...(d.adv ? ["  advertise-definition"] : []), ...(d.excl.length ? [`  affinity exclude-any ${d.excl.join(" ")}`] : []), ...(d.incl.length ? [`  affinity include-any ${d.incl.join(" ")}`] : []), " !");
  }
  out.push(" address-family ipv4 unicast", "  metric-style wide", ...(c.sr ? ["  segment-routing mpls"] : []), " !");
  out.push(" interface Loopback0", "  passive", "  address-family ipv4 unicast", ...(c.sid !== undefined ? [`   prefix-sid index ${c.sid}`] : []), ...Object.entries(c.algoSid).map(([a, i]) => `   prefix-sid algorithm ${a} index ${i}`), "  !", " !");
  for (const i of faIfs(r)) {
    const f = c.ifs[i.ifn]!;
    if (!f.isis) continue;
    out.push(` interface ${xrIf(i.ifn)}`, ...(f.aff.length ? [`  affinity flex-algo ${f.aff.join(" ")}`] : []), "  point-to-point", "  address-family ipv4 unicast", ...(f.metric !== 10 ? [`   metric ${f.metric}`] : []), "  !", " !");
  }
  out.push("!");
  const pm = faIfs(r).filter((i) => c.ifs[i.ifn]!.delay !== undefined);
  if (pm.length) {
    out.push("performance-measurement");
    for (const i of pm) out.push(` interface ${xrIf(i.ifn)}`, "  delay-measurement", `   advertise-delay ${c.ifs[i.ifn]!.delay}`, "  !", " !");
    out.push("!");
  }
  if (r === "R1") out.push("segment-routing", " traffic-eng", "  policy LOW-LATENCY", `   color ${LL_COLOR} end-point ipv4 ${FA_LO.R6}`, "   candidate-paths", "    preference 100", "     dynamic", "      metric", "       type delay", "      !", "     !", "     constraints", "      segments", "       sid-algorithm 128", "      !", "     !", "    !", "   !", "  !", " !", "!");
  if (r === "R1" || r === "R6") {
    const other = r === "R1" ? "R6" : "R1";
    if (r === "R6") out.push("extcommunity-set opaque COLOR-128", ` ${LL_COLOR}`, "end-set", "!", "route-policy SET-COLOR-128", "  if destination in (192.168.66.0/24) then", "    set extcommunity color COLOR-128", "  endif", "  pass", "end-policy", "!");
    out.push("router bgp 65000", ` bgp router-id ${FA_LO[r]}`, " address-family ipv4 unicast", ...(r === "R1" ? ["  network 192.168.1.0/24"] : ["  network 192.168.6.0/24", "  network 192.168.66.0/24"]), " !", ` neighbor ${FA_LO[other]}`, "  remote-as 65000", "  update-source Loopback0", "  address-family ipv4 unicast", ...(r === "R6" ? ["   route-policy SET-COLOR-128 out"] : []), "  !", " !", "!");
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Configuration statements
// ---------------------------------------------------------------------------------------------------------------
function stmts(r: FaR): SpCfgStmt<FaRtr>[] {
  const P2P = "% This lab keeps every core link point-to-point.";
  const fa = (c: FaRtr, x: Record<string, string>) => c.fa[+x.fa];
  const notLo = (x: Record<string, string>) => x.if !== "lo0";
  return [
    { id: "router-isis", summary: "IS-IS routing protocol", args: { tag: choiceArg(["CORE"], () => "Instance tag") }, xr: { mode: "config", syntax: "router isis <tag>", enter: "isis", apply: (c) => c } },
    { id: "amap", summary: "Name an affinity bit", args: { af: affArg, b: numArg(0, 255, ["0", "1"], "Bit position") }, xr: { mode: "isis", syntax: "affinity-map <af> bit-position <b>", apply: (c, a) => (+a.b === AFF_BIT[a.af as Aff] ? c : `% This lab maps ${a.af} to bit ${AFF_BIT[a.af as Aff]}.`), no: () => "% The affinity map is in use by the flex-algo configuration." } },
    { id: "fa", summary: "Flexible Algorithm: participate in it (and define it)", args: { fa: faArg }, xr: { mode: "isis", syntax: "flex-algo <fa>", enter: "isis-fa", apply: (c, a) => ((c.fa[+a.fa] ??= { prio: 128, mt: "igp", excl: [], incl: [], adv: false }), c), no: (c, a) => (delete c.fa[+a.fa], c) } },
    { id: "fa-prio", summary: "Priority of this definition (highest advertised wins)", args: { p: numArg(0, 255, ["100", "200"], "Priority 0–255") }, xr: { mode: "isis-fa", syntax: "priority <p>", noSyntax: "priority", apply: (c, a, x) => ((fa(c, x).prio = +a.p), c), no: (c, _a, x) => ((fa(c, x).prio = 128), c) } },
    { id: "fa-mt", summary: "Metric used by this algorithm's SPF", args: { m: choiceArg(["delay"], () => "Minimum unidirectional link delay") }, xr: { mode: "isis-fa", syntax: "metric-type <m>", noSyntax: "metric-type", apply: (c, _a, x) => ((fa(c, x).mt = "delay"), c), no: (c, _a, x) => ((fa(c, x).mt = "igp"), c) } },
    { id: "fa-adv", summary: "Advertise this definition in IS-IS", xr: { mode: "isis-fa", syntax: "advertise-definition", apply: (c, _a, x) => ((fa(c, x).adv = true), c), no: (c, _a, x) => ((fa(c, x).adv = false), c) } },
    { id: "fa-excl", summary: "Exclude links with any of these affinities", args: { af: affArg }, xr: { mode: "isis-fa", syntax: "affinity exclude-any <af>", noSyntax: "affinity exclude-any", apply: (c, a, x) => { const d = fa(c, x); if (!d.excl.includes(a.af as Aff)) d.excl = [...d.excl, a.af as Aff].sort(); return c; }, no: (c, _a, x) => ((fa(c, x).excl = []), c) } },
    { id: "fa-incl", summary: "Use only links with at least one of these affinities", args: { af: affArg }, xr: { mode: "isis-fa", syntax: "affinity include-any <af>", noSyntax: "affinity include-any", apply: (c, a, x) => { const d = fa(c, x); if (!d.incl.includes(a.af as Aff)) d.incl = [...d.incl, a.af as Aff].sort(); return c; }, no: (c, _a, x) => ((fa(c, x).incl = []), c) } },
    { id: "isis-af", summary: "Enter the IPv4 unicast address family", xr: { mode: "isis", syntax: "address-family ipv4 unicast", enter: "isis-af", apply: (c) => c } },
    { id: "isis-ms", summary: "Use wide metrics", args: { w: choiceArg(["wide"], () => "Wide metrics") }, xr: { mode: "isis-af", syntax: "metric-style <w>", apply: (c) => c, no: () => "% Segment routing needs wide metrics." } },
    { id: "isis-sr", summary: "Enable segment routing (MPLS data plane)", args: { m: choiceArg(["mpls"], () => "MPLS data plane") }, xr: { mode: "isis-af", syntax: "segment-routing <m>", apply: (c) => ((c.sr = true), c), no: (c) => ((c.sr = false), c) } },
    { id: "isis-if", summary: "Enter the IS-IS interface configuration submode", args: { if: xrIfArg(r, true) }, xr: { mode: "isis", syntax: "interface <if>", enter: "isis-if", apply: (c, a) => (a.if === "lo0" ? c : ((ifc(c, a.if).isis = true), c)), no: (c, a) => (a.if === "lo0" ? "% This lab keeps Loopback0 in IS-IS." : ((ifc(c, a.if).isis = false), c)) } },
    { id: "isis-p2p", summary: "Treat the interface as point-to-point", xr: { mode: "isis-if", syntax: "point-to-point", apply: (c) => c, no: () => P2P } },
    { id: "isis-passive", summary: "Advertise the prefix but send no hellos", xr: { mode: "isis-if", syntax: "passive", apply: (c, _a, x) => (x.if === "lo0" ? c : "% This lab only uses passive on Loopback0.") } },
    { id: "if-aff", summary: "Affinities this link advertises for Flex-Algo", args: { af: affArg }, xr: { mode: "isis-if", syntax: "affinity flex-algo <af>", noSyntax: "affinity flex-algo", apply: (c, a, x) => { if (!notLo(x)) return "% Affinities are set on the core links."; const f = ifc(c, x.if); if (!f.aff.includes(a.af as Aff)) f.aff = [...f.aff, a.af as Aff].sort(); return c; }, no: (c, _a, x) => (notLo(x) ? ((ifc(c, x.if).aff = []), c) : c) } },
    { id: "isis-if-af", summary: "Enter the interface IPv4 unicast address family", xr: { mode: "isis-if", syntax: "address-family ipv4 unicast", enter: "isis-if-af", apply: (c) => c } },
    { id: "isis-metric", summary: "Set the default (IGP) metric for this interface", args: { n: metricArg }, xr: { mode: "isis-if-af", syntax: "metric <n>", noSyntax: "metric", apply: (c, a, x) => (x.if === "lo0" ? "% This lab keeps Loopback0 at metric 0." : ((ifc(c, x.if).metric = +a.n), c)), no: (c, _a, x) => (x.if === "lo0" ? c : ((ifc(c, x.if).metric = defMetric(r, x.if)), c)) } },
    { id: "isis-sid", summary: "Algorithm-0 Prefix-SID for this prefix", args: { i: choiceArg(["index"], () => "SID index (label = 16000 + index)"), n: numArg(0, 7999, [String(FA_IDX[r])], "Prefix-SID index") }, xr: { mode: "isis-if-af", syntax: "prefix-sid <i> <n>", noSyntax: "prefix-sid", apply: (c, a, x) => (x.if !== "lo0" ? "% Prefix-SIDs are configured on the loopback in this lab." : +a.n !== FA_IDX[r] ? `% This lab keeps ${r}'s algorithm-0 index at ${FA_IDX[r]}.` : ((c.sid = +a.n), c)), no: (c) => ((c.sid = undefined), c) } },
    { id: "isis-asid", summary: "Prefix-SID for a Flex-Algo", args: { a: faArg, i: choiceArg(["index"], () => "SID index"), n: numArg(0, 7999, [String(100 + FA_IDX[r]), String(200 + FA_IDX[r])], "Prefix-SID index (label = 16000 + index)") }, xr: { mode: "isis-if-af", syntax: "prefix-sid algorithm <a> <i> <n>", noSyntax: "prefix-sid algorithm <a>", apply: (c, a, x) => (x.if !== "lo0" ? "% Prefix-SIDs are configured on the loopback in this lab." : +a.n < 100 || +a.n % 100 !== FA_IDX[r] ? `% This lab numbers algorithm SIDs as 100 × k + the router number (${r}: ${100 + FA_IDX[r]}, ${200 + FA_IDX[r]}).` : Object.entries(c.algoSid).some(([x, i]) => i === +a.n && +x !== +a.a) ? "% Index already in use by another algorithm." : ((c.algoSid[+a.a] = +a.n), c)), no: (c, a) => (delete c.algoSid[+a.a], c) } },
    { id: "pm", summary: "Performance measurement", xr: { mode: "config", syntax: "performance-measurement", enter: "pm", apply: (c) => c } },
    { id: "pm-if", summary: "Performance measurement on an interface", args: { pif: xrIfArg(r) }, xr: { mode: "pm", syntax: "interface <pif>", enter: "pm-if", apply: (c) => c, no: (c, a) => ((ifc(c, a.pif).delay = undefined), c) } },
    { id: "pm-dm", summary: "Delay measurement on this interface", xr: { mode: "pm-if", syntax: "delay-measurement", enter: "pm-dm", apply: (c) => c, no: (c, _a, x) => ((ifc(c, x.pif).delay = undefined), c) } },
    { id: "pm-adv", summary: "Advertise a static delay (microseconds)", args: { us: numArg(1, 16777215, ["5000", "30000", "80000"], "Delay in microseconds") }, xr: { mode: "pm-dm", syntax: "advertise-delay <us>", noSyntax: "advertise-delay", apply: (c, a, x) => ((ifc(c, x.pif).delay = +a.us), c), no: (c, _a, x) => ((ifc(c, x.pif).delay = undefined), c) } },
  ];
}

// ---------------------------------------------------------------------------------------------------------------
// Command set
// ---------------------------------------------------------------------------------------------------------------
export function faXrSpec(api: FaCliApi, r: FaR): SpXrSpec<FaRtr> {
  const s = api.s;
  const sh = (id: string, syntax: string, summary: string, run: SpCmd["run"], args?: SpCmd["args"]): SpCmd => ({ id, syntax, summary, run, args });
  const nothing = (o: string, why: string) => o || { output: "", explanation: why };
  const NO_SR = "Segment routing is not enabled in IS-IS here.";
  return {
    stmts: stmts(r),
    prompts: { config: "config", isis: "config-isis", "isis-fa": "config-isis-flex-algo", "isis-af": "config-isis-af", "isis-if": "config-isis-if", "isis-if-af": "config-isis-if-af", pm: "config-perf-meas", "pm-if": "config-pm-intf", "pm-dm": "config-pm-intf-dm" },
    lines: (c) => faXrLines(r, c),
    help: { "show isis": "IS-IS information", "show isis segment-routing": "Segment routing information", "show mpls": "MPLS information", "show performance-measurement": "Performance measurement information", "show segment-routing": "Segment routing information", "show segment-routing traffic-eng": "SR-TE information", "show bgp": "BGP information", "show route": "IP routing table" },
    shows: [
      sh("fa", "show isis flex-algo", "Every Flex-Algo: the winning definition and local state", () => nothing(xrFlexAlgo(s, r), "No Flex-Algo is configured or advertised.")),
      sh("fan", "show isis flex-algo <fa>", "One Flex-Algo", (a) => nothing(xrFlexAlgo(s, r, +a.fa), "That Flex-Algo is neither configured here nor advertised."), { fa: faArg }),
      sh("db", "show isis database verbose", "Every LSP: SR algorithms, definitions, link attributes, prefix SIDs", () => xrDatabase(s)),
      sh("dbl", "show isis database verbose <lsp>", "One router's LSP", (a) => xrDatabase(s, a.lsp as FaR), { lsp: lspArg }),
      sh("lbl", "show isis segment-routing label table", "The prefix SID labels this router programs, per algorithm", () => nothing(xrLabelTable(s, r), NO_SR)),
      sh("adj", "show isis adjacency", "IS-IS adjacencies", () => xrAdj(s, r)),
      sh("fwd", "show mpls forwarding", "The label forwarding table", () => nothing(xrForwarding(s, r), NO_SR)),
      sh("fwdl", "show mpls forwarding labels <n>", "One label's forwarding entry", (a) => nothing(xrForwarding(s, r, +a.n), "No such local label."), { n: labelArg }),
      sh("pm", "show performance-measurement interfaces", "Delay advertised per interface", () => nothing(xrPm(s, r), "No interface has delay measurement configured.")),
      sh("pol", "show segment-routing traffic-eng policy", "SR-TE policies on this headend", () => nothing(xrPolicy(s, r), "No SR-TE policy on this router — R1 is the headend.")),
      sh("bgp", "show bgp ipv4 unicast", "The BGP table", () => xrBgp(s, r)),
      sh("bgpp", "show bgp ipv4 unicast <pfx>", "One BGP route, with its color", (a) => xrBgp(s, r, a.pfx), { pfx: pfxArg }),
      sh("cef", "show cef <ip>", "The forwarding entry for a destination (labels imposed)", (a) => xrCef(s, r, a.ip), { ip: { ...pfxArg, choices: [...pfxArg.choices!, ...FA_ROUTERS.map((x) => FA_LO[x])] } }),
      sh("route", "show route", "The IPv4 routing table (algorithm 0)", () => [...XR_CODES, ...xrRib(s, r).map((x) => xrRouteLine(s, x))].join("\n")),
      sh("routeip", "show route <ip>", "The route a destination uses", (a) => xrRouteIp(s, r, a.ip), { ip: ipArg }),
      sh("log", "show logging", "The syslog buffer", () => xrLogging(s, r)),
    ],
    exec: [],
  };
}
export function faSets(api: FaCliApi, r: FaR): Partial<Record<CliVendor, CliCommandSet>> {
  return { cisco: buildXrSet(api.dev, faXrSpec(api, r)) };
}
export function faStaticApi(s: FaState, r: FaR): FaCliApi {
  return { s, act: () => s, dev: { host: r, running: s.cfg[r], hist: s.hist[r], setCand: () => undefined, xr: [], setXr: () => undefined, edit: false, setEdit: () => undefined, commit: () => undefined } };
}
export { lpad, algoOfLabel };
