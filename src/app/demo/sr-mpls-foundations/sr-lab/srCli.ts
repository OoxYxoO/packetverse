import type { CliArgSpec, CliCommandSet, CliVendor } from "@/lib/cli/types";
import { buildJunosSet, buildXrSet, choiceArg, junosPipeConfig, numArg, type SpCfgStmt, type SpCmd, type SpDevCli, type SpJunosSpec, type SpXrSpec } from "@/components/sp-lab/spCli";
import { lpad, pad, spAge, spStamp, type JStmt } from "@/components/sp-lab/spKit";
import { jnIf, parseIf, xrIf } from "@/components/sp-lab/spNames";
import {
  HOSTS,
  LAN_IF,
  SRGB0,
  SR_IDX,
  SR_LINKS,
  SR_LO,
  SR_ROUTERS,
  adjSidLabel,
  entry,
  resolveNh,
  routerOfLo,
  sidOf,
  srCapable,
  srIfs,
  srWalk,
  srgbOf,
  type IfName,
  type SrAction,
  type SrEntry,
  type SrR,
  type SrRtr,
  type SrState,
} from "@/lib/sim-engine/scenarios/srNet";

/**
 * Command lines of the SR-MPLS Lab — IOS XR or Junos on R1–R6. Every output is printed from the lab model: the SRGBs,
 * Prefix-SIDs, Adjacency SIDs, label tables, routes and LSP pings.
 *
 *   IOS XR  show isis segment-routing label table · show isis adjacency [detail] · show isis neighbors ·
 *           show isis database verbose · show mpls forwarding [labels <n>] · show route [<ip>] · show cef <ip> ·
 *           show bgp ipv4 unicast · show logging · ping / traceroute sr-mpls <fec> ·
 *           ping sr-mpls nil-fec labels <list> output interface <if> nexthop <ip>
 *           configure → segment-routing → global-block · router isis CORE → address-family ipv4 unicast →
 *           segment-routing mpls · interface Loopback0 → address-family ipv4 unicast → prefix-sid index ·
 *           interface <if> → address-family ipv4 unicast → metric
 *   Junos   show isis adjacency · show isis database extensive · show route table inet.3 | mpls.0 ·
 *           show route <ip> [hidden] · show log messages
 *           configure → set protocols isis source-packet-routing srgb start-label | index-range · node-segment
 *           ipv4-index · protocols isis interface <if> level 2 metric · interfaces <if> unit 0 family mpls ·
 *           protocols mpls interface <if>
 */

export interface SrCliApi {
  s: SrState;
  act: (a: SrAction) => SrState;
  dev: SpDevCli<SrRtr>;
}
const age = (s: SrState) => spAge(s.clock, 15);
const ipNum = (ip: string) => ip.split(".").reduce((a, o) => a * 256 + Number(o), 0);
const ifc = (c: SrRtr, ifn: string) => c.ifs[ifn as IfName]!;
const defMetric = (r: SrR, ifn: string) => srIfs(r).find((i) => i.ifn === ifn)!.link.metric;
const hasBgp = (r: SrR) => r === "R1" || r === "R6";
const myHost = (r: SrR) => (r === "R1" ? HOSTS.H1 : r === "R6" ? HOSTS.H6 : undefined);
const farHost = (r: SrR) => (r === "R1" ? HOSTS.H6 : r === "R6" ? HOSTS.H1 : undefined);
const outTxt = (e: SrEntry) => (e.out === "Pop" ? "Pop" : e.out === "Unlabelled" ? "Unlabelled" : String(e.out));

// ---------------------------------------------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------------------------------------------
const phys = (r: SrR) => srIfs(r).map((i) => i.ifn);
const xrIfArg = (r: SrR, withLo = false): CliArgSpec => ({
  choices: [...(withLo ? ["Loopback0"] : []), ...phys(r).map((i) => xrIf(i))],
  describe: (c) => {
    const n = parseIf(c);
    const i = srIfs(r).find((x) => x.ifn === n);
    return i ? `to ${i.peer}` : n === "lo0" ? "Loopback interface" : undefined;
  },
  resolve: (raw) => {
    const n = parseIf(raw);
    return n && (n === "lo0" ? withLo : phys(r).includes(n as IfName)) ? n : undefined;
  },
});
const jnUnitArg = (r: SrR, withLo = false): CliArgSpec => ({
  choices: [...phys(r).map((i) => `${i}.0`), ...(withLo ? ["lo0.0"] : [])],
  describe: (c) => {
    const i = srIfs(r).find((x) => `${x.ifn}.0` === c);
    return i ? `to ${i.peer}` : "Loopback";
  },
  resolve: (raw) => (/^(ge-0\/0\/[0-2]|lo0)\.0$/.test(raw) && ((withLo && raw === "lo0.0") || phys(r).includes(raw.slice(0, -2) as IfName)) ? raw.slice(0, -2) : undefined),
});
const jnPhysArg = (r: SrR): CliArgSpec => ({ choices: phys(r), describe: (c) => (srIfs(r).find((x) => x.ifn === c) ? `to ${srIfs(r).find((x) => x.ifn === c)!.peer}` : undefined), resolve: (raw) => (phys(r).includes(raw as IfName) ? raw : undefined) });
const fecArg: CliArgSpec = {
  choices: SR_ROUTERS.map((r) => `${SR_LO[r]}/32`),
  describe: (c) => routerOfLo(c.replace("/32", "")),
  resolve: (raw) => {
    const m = /^(10\.0\.0\.[1-6])\/32$/.exec(raw);
    return m ? m[1] : undefined;
  },
};
const ipArg: CliArgSpec = {
  choices: [...SR_ROUTERS.map((r) => SR_LO[r]), HOSTS.H6.ip, HOSTS.H1.ip],
  describe: (c) => routerOfLo(c) ?? (c === HOSTS.H6.ip ? "H6" : c === HOSTS.H1.ip ? "H1" : undefined),
  resolve: (raw) => (/^(\d{1,3}\.){3}\d{1,3}$/.test(raw) && raw.split(".").every((o) => +o <= 255) ? raw : undefined),
};
const pfxArg: CliArgSpec = { ...ipArg, choices: [...ipArg.choices!, "192.168.6.0/24"], resolve: (raw) => { const m = /^((\d{1,3}\.){3}\d{1,3})(\/(\d{1,2}))?$/.exec(raw); return m && m[1].split(".").every((o) => +o <= 255) && (!m[4] || +m[4] <= 32) ? m[1] : undefined; } };
const listArg: CliArgSpec = { choices: ["16003,24035,16006"], describe: () => "Labels, outermost first, separated by commas", resolve: (raw) => (/^\d{1,7}(,\d{1,7}){0,5}$/.test(raw) && raw.split(",").every((x) => +x >= 16 && +x <= 1048575) ? raw : undefined) };
const labelArg = numArg(16, 1048575, ["16006", "24012"], "An MPLS label");
const metricArg = numArg(1, 16777214, ["10", "15", "100"], "Default metric (wide: 1–16777214)");
const sidArg = numArg(0, 1048575, ["6", "60"], "Prefix-SID index (label = SRGB start + index)");
const srgbLoArg = numArg(16000, 1048575, ["16000", "17000"], "SRGB lower bound (16000 or above)");
const srgbHiArg = numArg(16000, 1048575, ["23999", "24999"], "SRGB upper bound");
const rangeArg = numArg(1, 1048575, ["8000"], "Number of labels in the SRGB");
const lvlArg = choiceArg(["2"], () => "Level 2");

// ---------------------------------------------------------------------------------------------------------------
// IOS XR outputs
// ---------------------------------------------------------------------------------------------------------------
function xrLabelTable(s: SrState, r: SrR): string {
  if (!srCapable(s.cfg[r], s.os)) return "";
  const g = srgbOf(s.cfg[r], s.os)!;
  const rows = s.view.sids.filter((x) => !x.lost && x.index < g.range).sort((a, b) => a.index - b.index).map((x) => `${pad(g.start + x.index, 14)}${x.owner === r ? "Loopback0" : `${x.prefix}/32`}`);
  return ["", "IS-IS CORE IS Label Table", "Label         Prefix/Interface", "----------    ----------------", ...rows].join("\n");
}
const FWD_HEAD = ["Local  Outgoing    Prefix             Outgoing     Next Hop        Bytes", "Label  Label       or ID              Interface                    Switched", "------ ----------- ------------------ ------------ --------------- ------------"];
function xrFwdRows(s: SrState, r: SrR, only?: number): string[] {
  return s.view.table[r].filter((e) => !e.own && (only === undefined || e.label === only)).map((e) => `${pad(e.label, 7)}${pad(outTxt(e), 12)}${pad(e.kind === "adj" ? "SR Adj (idx 1)" : `SR Pfx (idx ${e.index})`, 19)}${pad(xrIf(e.nh!.ifn, true), 13)}${pad(e.nh!.ip, 16)}0`);
}
function xrForwarding(s: SrState, r: SrR, only?: number): string {
  const rows = xrFwdRows(s, r, only);
  if (only !== undefined && !rows.length) return "";
  return [...FWD_HEAD, ...rows].join("\n");
}
function xrAdj(s: SrState, r: SrR, detail: boolean): string {
  const ups = srIfs(r).filter((i) => s.view.adj[i.link.id]);
  const rows = ups.flatMap((i) => {
    const line = `${pad(i.peer, 15)}${pad(xrIf(i.ifn, true), 25)}${pad("*PtoP*", 15)}${pad("Up", 6)}${pad(27, 5)}${pad(age(s), 9)}Yes None None`;
    if (!detail) return [line];
    const adj = s.view.table[r].find((e) => e.kind === "adj" && e.to === i.peer);
    return [line, "  Area Address:           49.0001", `  Neighbor IPv4 Address:  ${i.peerIp}*`, ...(adj ? [`  Adjacency SID:          ${adj.label}`] : []), "  Topology:               IPv4 Unicast"];
  });
  return ["IS-IS CORE Level-2 adjacencies:", "System Id      Interface                SNPA           State Hold Changed  NSF IPv4 IPv6", "                                                                               BFD  BFD", ...rows, "", `Total adjacency count: ${ups.length}`].join("\n");
}
function xrIsisNbr(s: SrState, r: SrR): string {
  const rows = srIfs(r).filter((i) => s.view.adj[i.link.id]).map((i) => `${pad(i.peer, 15)}${pad(xrIf(i.ifn, true), 17)}${pad("*PtoP*", 15)}${pad("Up", 6)}${pad(25, 9)}${pad("L2", 5)}Capable`);
  return ["IS-IS CORE neighbors:", "System Id      Interface        SNPA           State Holdtime Type IETF-NSF", ...rows, "", `Total neighbor count: ${rows.length}`].join("\n");
}
function lspLines(s: SrState, o: SrR, junos: boolean): string[] {
  const c = s.cfg[o];
  const g = srgbOf(c, s.os);
  const sid = s.view.sids.find((x) => x.owner === o);
  const nbrs = srIfs(o).filter((i) => s.view.adj[i.link.id]);
  if (junos) {
    return [
      "",
      `${o}.00-00 Sequence: 0x${(5 + s.cfgSeq).toString(16)}, Checksum: 0x${(0x8a10 + SR_IDX[o] * 37).toString(16)}, Lifetime: ${1100 + SR_IDX[o] * 7} secs`,
      ...nbrs.flatMap((i) => {
        const adj = s.view.table[o].find((e) => e.kind === "adj" && e.to === i.peer);
        return [`  IS neighbor: ${pad(`${i.peer}.00`, 30)}Metric: ${lpad(c.ifs[i.ifn]!.metric, 8)}`, `    Two-way fragment: ${i.peer}.00-00, Two-way first fragment: ${i.peer}.00-00`, ...(adj ? [`    P2P IPv4 Adj-SID - Flags:0x30(F:0,B:0,V:1,L:1,S:0,P:0), Weight:0, Label: ${adj.label}`] : [])];
      }),
      ...(c.lo ? [`  IP prefix: ${pad(`${SR_LO[o]}/32`, 32)}Metric: ${lpad(0, 8)} Internal Up`, ...(sid ? [`    Prefix SID, Flags: 0x40(R:0,N:1,P:0,E:0,V:0,L:0), Algo: SPF(0), Value: ${sid.index}`] : [])] : []),
      `  Router Capability:  Router ID ${SR_LO[o]}, Flags: 0x00`,
      ...(srCapable(c, s.os) && g ? [`    SPRING Capability - Flags: 0xc0(I:1,V:1), Range: ${g.range}, SID-Label: ${g.start}`, "    SPRING Algorithms - Algo: 0"] : []),
    ];
  }
  return [
    `${pad(`${o}.00-00`, 22)}${pad(`0x0000000${(5 + s.cfgSeq) % 10}`, 13)}${pad(`0x${(0x8a10 + SR_IDX[o] * 37).toString(16)}`, 14)}${pad(`${1100 + SR_IDX[o] * 7} /1200`, 19)}0/0/0`,
    "  Area Address:   49.0001",
    "  NLPID:          0xcc",
    `  IP Address:     ${SR_LO[o]}`,
    `  Hostname:       ${o}`,
    `  Router Cap:     ${SR_LO[o]} D:0 S:0`,
    ...(srCapable(c, s.os) && g ? [`    Segment Routing: I:1 V:0, SRGB Base: ${g.start} Range: ${g.range}`, "    SR Algorithm:", "      Algorithm: 0"] : []),
    ...nbrs.flatMap((i) => {
      const adj = s.view.table[o].find((e) => e.kind === "adj" && e.to === i.peer);
      return [`  Metric: ${pad(c.ifs[i.ifn]!.metric, 11)}IS-Extended ${i.peer}.00`, `    Interface IP Address: ${i.ip}`, `    Neighbor IP Address: ${i.peerIp}`, ...(adj ? [`    ADJ-SID: F:0 B:0 V:1 L:1 S:0 P:0 weight:0 Adjacency-sid:${adj.label}`] : [])];
    }),
    ...(c.lo ? [`  Metric: ${pad(0, 11)}IP-Extended ${SR_LO[o]}/32`, ...(sid ? [`    Prefix-SID Index: ${sid.index}, Algorithm:0, R:0 N:1 P:0 E:0 V:0 L:0`] : [])] : []),
  ];
}
function xrDatabase(s: SrState, r: SrR): string {
  return ["", "IS-IS CORE (Level-2) Link State Database", "LSPID                 LSP Seq Num  LSP Checksum  LSP Holdtime/Rcvd  ATT/P/OL", ...SR_ROUTERS.filter((o) => o === r || s.view.rib[r].some((x) => x.dst === o) || srIfs(o).some((i) => s.view.adj[i.link.id] && s.view.rib[r].some((x) => x.dst === i.peer))).flatMap((o) => lspLines(s, o, false)), "", ` Total Level-2 LSP count: ${SR_ROUTERS.length}     Local Level-2 LSP count: 1`].join("\n");
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
function xrRib(s: SrState, r: SrR): XrRt[] {
  const out: XrRt[] = [{ p: SR_LO[r], len: 32, kind: "L", metric: 0, ifn: "lo0" }];
  for (const i of srIfs(r)) out.push({ p: i.ip.replace(/\.\d+$/, ".0"), len: 24, kind: "C", metric: 0, ifn: i.ifn }, { p: i.ip, len: 32, kind: "L", metric: 0, ifn: i.ifn });
  const h = myHost(r);
  if (h) out.push({ p: h.net, len: 24, kind: "C", metric: 0, ifn: LAN_IF }, { p: h.gw, len: 32, kind: "L", metric: 0, ifn: LAN_IF });
  for (const rt of s.view.rib[r]) if (rt.nh) out.push({ p: SR_LO[rt.dst], len: 32, kind: "i L2", metric: rt.cost, nh: { ip: rt.nh.ip, ifn: rt.nh.ifn } });
  for (const l of SR_LINKS) {
    if (l.a === r || l.b === r) continue;
    const p = `10.1.${SR_IDX[l.a]}${SR_IDX[l.b]}.0`;
    const near = [l.a, l.b].map((x) => s.view.rib[r].find((y) => y.dst === x)).filter((x): x is NonNullable<typeof x> => !!x?.nh).sort((a, b) => a.cost - b.cost)[0];
    if (near && s.view.adj[l.id]) out.push({ p, len: 24, kind: "i L2", metric: near.cost + l.metric, nh: { ip: near.nh!.ip, ifn: near.nh!.ifn } });
  }
  const f = farHost(r);
  if (f) out.push({ p: f.net, len: 24, kind: "B", metric: 0, nh: { ip: SR_LO[f.r], ifn: "" } });
  return out.sort((a, b) => ipNum(a.p) - ipNum(b.p) || a.len - b.len);
}
function xrRouteLine(s: SrState, x: XrRt) {
  const p = `${x.p}/${x.len}`;
  if (x.kind === "C" || x.kind === "L") return `${pad(x.kind, 5)}${p} is directly connected, ${age(s)}, ${xrIf(x.ifn!)}`;
  if (x.kind === "B") return `${pad("B", 5)}${p} [200/0] via ${x.nh!.ip}, ${age(s)}`;
  return `${pad(`${pad(x.kind, 5)}${p}`, 23)}[115/${x.metric}] via ${x.nh!.ip}, ${age(s)}, ${xrIf(x.nh!.ifn)}`;
}
const inPfx = (ip: string, p: string, len: number) => Math.floor(ipNum(ip) / 2 ** (32 - len)) === Math.floor(ipNum(p) / 2 ** (32 - len));
function xrRouteIp(s: SrState, r: SrR, ip: string): string {
  const x = xrRib(s, r).filter((y) => inPfx(ip, y.p, y.len)).sort((a, b) => b.len - a.len)[0];
  if (!x) return "% Network not in table";
  const p = `${x.p}/${x.len}`;
  if (x.kind === "C" || x.kind === "L") return [`Routing entry for ${p}`, `  Known via "${x.kind === "C" ? "connected" : "local"}", distance 0, metric 0 (connected)`, "  Routing Descriptor Blocks", `    directly connected, via ${xrIf(x.ifn!)}`, "      Route metric is 0", "  No advertising protos."].join("\n");
  if (x.kind === "B") return [`Routing entry for ${p}`, `  Known via "bgp 65000", distance 200, metric 0, type internal`, `  Installed ${spStamp(30).xr.replace(" UTC", "")} for ${age(s)}`, "  Routing Descriptor Blocks", `    ${x.nh!.ip}, from ${x.nh!.ip}`, "      Route metric is 0", "  No advertising protos."].join("\n");
  const lo = routerOfLo(x.p);
  const sid = lo ? sidOf(s.view, lo) : undefined;
  const g = srgbOf(s.cfg[r], s.os);
  const e = sid && g ? entry(s.view, r, g.start + sid.index) : undefined;
  return [`Routing entry for ${p}`, `  Known via "isis CORE", distance 115, metric ${x.metric}, labeled SR, type level-2`.replace(", labeled SR", e ? ", labeled SR" : ""), `  Installed ${spStamp(15).xr.replace(" UTC", "")} for ${age(s)}`, "  Routing Descriptor Blocks", `    ${x.nh!.ip}, from ${x.p}, via ${xrIf(x.nh!.ifn)}`, `      Route metric is ${x.metric}`, ...(e ? [`      Label: ${e.out === "Pop" ? "0x3 (3)" : e.out === "Unlabelled" ? "None" : `0x${(e.out as number).toString(16)} (${e.out})`}`] : []), "  No advertising protos."].join("\n");
}
function xrCef(s: SrState, r: SrR, ip: string): string {
  const f = farHost(r);
  const head = (p: string) => `${p}, version ${40 + SR_IDX[r]}, internal 0x1000001 0x0 (ptr 0x7fa1b2c3d0) [1], 0x0 (0x0), 0x0 (0x0)`;
  if (f && inPfx(ip, f.net, 24)) {
    const res = resolveNh(s.view, s.cfg, s.os, r, f.r);
    const nh = res.nh;
    return [head(`${f.net}/24`), ` Updated ${spStamp(30).xr.replace(" UTC", "")}`, " Prefix Len 24, traffic index 0, precedence n/a, priority 4", `   via ${SR_LO[f.r]}/32, 3 dependencies, recursive [flags 0x6000]`, ...(nh ? [`    next hop ${nh.ip}/32 ${xrIf(nh.ifn, true)}    labels imposed {${res.push ? (res.push.length ? res.push[0] : "ImplNull") : "None"}}`] : ["    unresolved"])].join("\n");
  }
  const lo = routerOfLo(ip);
  if (lo && lo !== r) {
    const rt = s.view.rib[r].find((x) => x.dst === lo);
    if (!rt?.nh) return `${ip}/32, version 0, drop adjacency`;
    const sid = sidOf(s.view, lo);
    const g = srgbOf(s.cfg[r], s.os);
    const e = sid && g ? entry(s.view, r, g.start + sid.index) : undefined;
    return [head(`${ip}/32`), ` Updated ${spStamp(15).xr.replace(" UTC", "")}`, " local label " + (e ? e.label : "none"), `   via ${rt.nh.ip}/32, ${xrIf(rt.nh.ifn, true)}, labels imposed {${e ? (e.out === "Pop" ? "ImplNull" : e.out === "Unlabelled" ? "None" : e.out) : "None"}}`].join("\n");
  }
  return xrRouteIp(s, r, ip).startsWith("%") ? `${ip}/32, version 0, drop adjacency` : [head(`${ip}/32`), "   receive"].join("\n");
}
function xrBgp(s: SrState, r: SrR): string {
  if (!hasBgp(r)) return "% BGP instance 'default' not active";
  const me = myHost(r)!;
  const far = farHost(r)!;
  return [`BGP router identifier ${SR_LO[r]}, local AS number 65000`, "BGP generic scan interval 60 secs", "BGP table state: Active", "Table ID: 0xe0000000   RD version: 4", "BGP main routing table version 4", "", "Status codes: s suppressed, d damped, h history, * valid, > best", "              i - internal, r RIB-failure, S stale, N Nexthop-discard", "Origin codes: i - IGP, e - EGP, ? - incomplete", "   Network            Next Hop            Metric LocPrf Weight Path", ...[{ n: me.net, nh: "0.0.0.0", i: false }, { n: far.net, nh: SR_LO[far.r], i: true }].sort((a, b) => ipNum(a.n) - ipNum(b.n)).map((x) => `${x.i ? "*>i" : "*> "}${pad(`${x.n}/24`, 19)}${pad(x.nh, 20)}${x.i ? "0    100      0 i" : "0         32768 i"}`), "", "Processed 2 prefixes, 2 paths"].join("\n");
}
function xrLogging(s: SrState, r: SrR): string {
  const lines = s.sys.filter((x) => x.dev === r).slice(-30).map((x) => {
    const st = `RP/0/RP0/CPU0:${spStamp(x.t).xr}`;
    const i = x.peer ? srIfTo(r, x.peer as SrR) : undefined;
    if (x.kind === "adj-up" || x.kind === "adj-down") return `${st}: isis[1012]: %ROUTING-ISIS-5-ADJCHANGE : Adjacency to ${x.peer} (${i ? xrIf(i.ifn) : "?"}) (L2) ${x.kind === "adj-up" ? "Up, New adjacency" : "Down, Neighbor forgot us"}`;
    if (x.kind === "sid-conflict") return `${st}: isis[1012]: %ROUTING-ISIS-4-SRMS_CONFLICT : SID conflict detected: index ${x.peer} is used by more than one prefix`;
    if (x.kind === "srgb-range") return `${st}: isis[1012]: %ROUTING-ISIS-4-SID_OUT_OF_RANGE : Prefix-SID index ${x.peer} is out of the SRGB range`;
    return `${st}: config[65857]: %MGBL-CONFIG-6-DB_COMMIT : Configuration committed by user 'admin'. Use 'show commit changes ${1000000000 + x.t}' to view the changes.`;
  });
  return ["Syslog logging: enabled (0 messages dropped, 0 flushes, 0 overruns)", `    Buffer logging: level debugging, ${lines.length} messages logged`, "", "Log Buffer (2097152 bytes):", "", ...lines].join("\n");
}
const srIfTo = (r: SrR, peer: SrR) => srIfs(r).find((i) => i.peer === peer);
const LSP_CODES = ["Codes: '!' - success, 'Q' - request not sent, '.' - timeout,", "  'L' - labeled output interface, 'B' - unlabeled output interface,", "  'D' - DS Map mismatch, 'F' - no FEC mapping, 'f' - FEC mismatch,", "  'M' - malformed request, 'm' - unsupported tlvs, 'N' - no rx label,", "  'P' - no rx intf label prot, 'p' - premature termination of LSP,", "  'R' - transit router, 'I' - unknown upstream index,", "  'X' - unknown return code, 'x' - return code 0"];
/** The LSP-ping walk for a Node SID from router r. */
function fecWalk(s: SrState, r: SrR, fec: string) {
  const o = routerOfLo(fec)!;
  const sid = sidOf(s.view, o);
  const g = srgbOf(s.cfg[r], s.os);
  if (!sid || !g || !srCapable(s.cfg[r], s.os) || !entry(s.view, r, g.start + sid.index) || o === r) return { sent: false as const };
  const w = srWalk(s.cfg, s.view, s.os, r, [g.start + sid.index], fec);
  const unl = w.hops.some((h) => /Unlabelled/.test(h.note));
  return { sent: true as const, w, code: w.ok && !unl ? "!" : unl ? "B" : "." };
}
function xrPingSr(s: SrState, r: SrR, fec: string): string {
  const f = fecWalk(s, r, fec);
  const code = f.sent ? f.code : "Q";
  return [`Sending 5, 100-byte MPLS Echos to ${fec}/32,`, "      timeout is 2 seconds, send interval is 0 msec:", "", ...LSP_CODES, "", "Type escape sequence to abort.", "", code.repeat(5), code === "!" ? "Success rate is 100 percent (5/5), round-trip min/avg/max = 2/3/5 ms" : "Success rate is 0 percent (0/5)"].join("\n");
}
function xrTraceSr(s: SrState, r: SrR, fec: string): string {
  const f = fecWalk(s, r, fec);
  const head = [`Tracing MPLS Label Switched Path to ${fec}/32, timeout is 2 seconds`, "", ...LSP_CODES, "", "Type escape sequence to abort.", ""];
  if (!f.sent) return [...head, "  0 Q"].join("\n");
  const hops = f.w.hops.filter((h) => h.from !== h.to);
  const lines: string[] = [];
  hops.forEach((h, k) => {
    const from = h.from as SrR;
    const i = srIfTo(from, h.to as SrR);
    const prevTo = k === 0 ? undefined : srIfTo(from, hops[k - 1].from as SrR);
    const ip = k === 0 ? i!.ip : prevTo!.ip;
    const lab = h.labels.length ? `[Labels: ${h.labels[0]} Exp: 0]` : "[Labels: implicit-null Exp: 0]";
    const code = k === 0 ? " " : /Unlabelled/.test(h.note) ? "B" : "L";
    lines.push(`${code} ${k} ${ip} MRU 1500 ${lab}${k === 0 ? "" : ` ${2 + k} ms`}`);
  });
  const last = hops.at(-1);
  if (last && f.w.ok) lines.push(`! ${hops.length} ${srIfTo(last.to as SrR, last.from as SrR)!.ip} ${2 + hops.length} ms`);
  else lines.push(`. ${hops.length} *`);
  return [...head, ...lines].join("\n");
}
function xrNilFec(s: SrState, r: SrR, list: string, ifn: string, nh: string): string {
  const i = srIfs(r).find((x) => x.ifn === ifn)!;
  const head = [`Sending 5, 100-byte MPLS Echos with Nil FEC labels ${list},`, "      timeout is 2 seconds, send interval is 0 msec:", "", ...LSP_CODES, "", "Type escape sequence to abort.", ""];
  if (nh !== i.peerIp) return [...head, "QQQQQ", "Success rate is 0 percent (0/5)"].join("\n");
  const w = srWalk(s.cfg, s.view, s.os, r, list.split(",").map(Number), "127.0.0.1", { nh: i.peer, ifn: i.ifn, ip: i.peerIp }, true);
  return [...head, (w.ok ? "!" : ".").repeat(5), w.ok ? "Success rate is 100 percent (5/5), round-trip min/avg/max = 2/3/5 ms" : "Success rate is 0 percent (0/5)"].join("\n");
}

// ---------------------------------------------------------------------------------------------------------------
// Junos outputs
// ---------------------------------------------------------------------------------------------------------------
function jnAdj(s: SrState, r: SrR): string {
  const rows = srIfs(r).filter((i) => s.view.adj[i.link.id]).map((i) => `${pad(jnIf(i.ifn), 22)}${pad(i.peer, 15)}${pad("2", 2)}${pad("Up", 14)}${lpad(20 + ((s.clock + SR_IDX[i.peer]) % 7), 12)}`);
  return ["Interface             System         L State         Hold (secs) SNPA", ...rows].join("\n");
}
function jnDatabase(s: SrState): string {
  return ["IS-IS level 1 link-state database:", "", "IS-IS level 2 link-state database:", ...SR_ROUTERS.flatMap((o) => lspLines(s, o, true))].join("\n");
}
function jnInet3(s: SrState, r: SrR): string {
  if (!srCapable(s.cfg[r], s.os)) return "";
  const g = srgbOf(s.cfg[r], s.os)!;
  const rows = SR_ROUTERS.filter((o) => o !== r).flatMap((o) => {
    const sid = sidOf(s.view, o);
    const e = sid ? entry(s.view, r, g.start + sid.index) : undefined;
    const rt = s.view.rib[r].find((x) => x.dst === o);
    if (!e || !rt) return [];
    return [`${pad(`${SR_LO[o]}/32`, 19)}*[L-ISIS/14] ${age(s)}, metric ${rt.cost}`, `                    >  to ${e.nh!.ip} via ${jnIf(e.nh!.ifn)}${e.out === "Pop" ? "" : `, Push ${e.out}`}`];
  });
  const n = rows.length / 2;
  return [`inet.3: ${n} destinations, ${n} routes (${n} active, 0 holddown, 0 hidden)`, ...(n ? ["+ = Active Route, - = Last Active, * = Both", "", ...rows] : [])].join("\n");
}
function jnMpls0(s: SrState, r: SrR): string {
  const rows: { k: number; l: string[] }[] = [{ k: 0, l: ["0                  *[MPLS/0] 01:00:00, metric 1", "                       to table inet.0"] }];
  for (const e of s.view.table[r].filter((x) => !x.own)) {
    const rt = e.kind === "pfx" ? s.view.rib[r].find((x) => x.dst === e.to) : undefined;
    rows.push({ k: e.label, l: [`${pad(e.label, 19)}*[L-ISIS/14] ${age(s)}, metric ${rt?.cost ?? 0}`, `                    >  to ${e.nh!.ip} via ${jnIf(e.nh!.ifn)}, ${e.out === "Pop" ? "Pop" : `Swap ${e.out}`}`] });
  }
  rows.sort((a, b) => a.k - b.k);
  return [`mpls.0: ${rows.length} destinations, ${rows.length} routes (${rows.length} active, 0 holddown, 0 hidden)`, "+ = Active Route, - = Last Active, * = Both", "", ...rows.flatMap((x) => x.l)].join("\n");
}
function jnRouteIp(s: SrState, r: SrR, ip: string, hidden: boolean): string {
  const f = farHost(r);
  const me = myHost(r);
  const lo = routerOfLo(ip);
  const total = 12 + srIfs(r).length;
  if (f && inPfx(ip, f.net, 24)) {
    const res = resolveNh(s.view, s.cfg, s.os, r, f.r);
    const usable = !!res.push;
    const head = `inet.0: ${total} destinations, ${total} routes (${usable ? total : total - 1} active, 0 holddown, ${usable ? 0 : 1} hidden)`;
    if (usable && !hidden) return [head, "+ = Active Route, - = Last Active, * = Both", "", `${pad(`${f.net}/24`, 19)}*[BGP/170] ${age(s)}, localpref 100, from ${SR_LO[f.r]}`, "                      AS path: I, validation-state: unverified", `                    >  to ${res.nh!.ip} via ${jnIf(res.nh!.ifn)}${res.push!.length ? `, Push ${res.push![0]}` : ""}`].join("\n");
    if (!usable && hidden) return [head, "+ = Active Route, - = Last Active, * = Both", "", `${pad(`${f.net}/24`, 19)} [BGP ] ${age(s)}, localpref 100, from ${SR_LO[f.r]}`, "                      AS path: I, validation-state: unverified", "                      Unusable"].join("\n");
    return head;
  }
  if (me && inPfx(ip, me.net, 24)) return [`inet.0: ${total} destinations, ${total} routes (${total} active, 0 holddown, 0 hidden)`, "+ = Active Route, - = Last Active, * = Both", "", `${pad(`${me.net}/24`, 19)}*[Direct/0] ${age(s)}`, `                    >  via ${jnIf(LAN_IF)}`].join("\n");
  if (lo && lo !== r) {
    const rt = s.view.rib[r].find((x) => x.dst === lo);
    if (!rt?.nh) return "";
    return [`inet.0: ${total} destinations, ${total} routes (${total} active, 0 holddown, 0 hidden)`, "+ = Active Route, - = Last Active, * = Both", "", `${pad(`${ip}/32`, 19)}*[IS-IS/18] ${age(s)}, metric ${rt.cost}`, `                    >  to ${rt.nh.ip} via ${jnIf(rt.nh.ifn)}`, "", jnInet3(s, r).split("\n").filter((l, k, a) => k === 0 || l.startsWith(`${ip}/32`) || (a[k - 1] ?? "").startsWith(`${ip}/32`)).join("\n")].join("\n");
  }
  return "";
}
function jnLog(s: SrState, r: SrR): string {
  return s.sys.filter((x) => x.dev === r).slice(-30).map((x) => {
    const st = `${spStamp(x.t).junos}  ${r}`;
    if (x.kind === "adj-up" || x.kind === "adj-down") return `${st} rpd[1532]: RPD_ISIS_ADJ${x.kind === "adj-up" ? "UP" : "DOWN"}: IS-IS new L2 adjacency to ${x.peer} on ${jnIf(srIfTo(r, x.peer as SrR)?.ifn ?? "ge-0/0/0")}`;
    if (x.kind === "sid-conflict") return `${st} rpd[1532]: RPD_ISIS_SPRING_SID_CONFLICT: Prefix SID index ${x.peer} is advertised by more than one router`;
    if (x.kind === "srgb-range") return `${st} rpd[1532]: RPD_ISIS_SPRING_SID_OUT_OF_RANGE: Prefix SID index ${x.peer} is outside the SRGB`;
    return `${st} mgd[4417]: UI_COMMIT: User 'admin' requested 'commit' operation (comment: none)`;
  }).join("\n");
}

// ---------------------------------------------------------------------------------------------------------------
// Configuration as each OS prints it
// ---------------------------------------------------------------------------------------------------------------
export function srXrLines(r: SrR, c: SrRtr): string[] {
  const out: string[] = [`hostname ${r}`, "!", "interface Loopback0", ` ipv4 address ${SR_LO[r]} 255.255.255.255`, "!"];
  for (const i of srIfs(r)) out.push(`interface ${xrIf(i.ifn)}`, ` description to ${i.peer}`, ` ipv4 address ${i.ip} 255.255.255.0`, "!");
  const h = myHost(r);
  if (h) out.push(`interface ${xrIf(LAN_IF)}`, ` description to ${r === "R1" ? "H1" : "H6"}`, ` ipv4 address ${h.gw} 255.255.255.0`, "!");
  out.push("router isis CORE", " is-type level-2-only", ` net 49.0001.0000.0000.000${SR_IDX[r]}.00`, " address-family ipv4 unicast", "  metric-style wide", ...(c.sr ? ["  segment-routing mpls"] : []), " !");
  if (c.lo) out.push(" interface Loopback0", "  passive", "  address-family ipv4 unicast", ...(c.sid !== undefined ? [`   prefix-sid index ${c.sid}`] : []), "  !", " !");
  for (const i of srIfs(r)) {
    const f = c.ifs[i.ifn]!;
    if (!f.isis) continue;
    out.push(` interface ${xrIf(i.ifn)}`, "  point-to-point", "  address-family ipv4 unicast", ...(f.metric !== 10 ? [`   metric ${f.metric}`] : []), "  !", " !");
  }
  out.push("!");
  if (hasBgp(r)) {
    const other = r === "R1" ? "R6" : "R1";
    out.push("router bgp 65000", ` bgp router-id ${SR_LO[r]}`, " address-family ipv4 unicast", `  network ${h!.net}/24`, " !", ` neighbor ${SR_LO[other]}`, "  remote-as 65000", "  update-source Loopback0", "  address-family ipv4 unicast", "  !", " !", "!");
  }
  if (c.srgb) out.push("segment-routing", ` global-block ${c.srgb.start} ${c.srgb.start + c.srgb.range - 1}`, "!");
  return out;
}
export function srJnStmts(r: SrR, c: SrRtr): JStmt[] {
  const out: JStmt[] = [];
  for (const i of srIfs(r)) {
    const f = c.ifs[i.ifn]!;
    out.push({ path: ["interfaces", i.ifn], leaf: `description "to ${i.peer}"` }, { path: ["interfaces", i.ifn, "unit 0", "family inet"], leaf: `address ${i.ip}/24` });
    if (f.isis) out.push({ path: ["interfaces", i.ifn, "unit 0", "family iso"], leaf: "" });
    if (f.fam) out.push({ path: ["interfaces", i.ifn, "unit 0", "family mpls"], leaf: "" });
  }
  const h = myHost(r);
  if (h) out.push({ path: ["interfaces", LAN_IF, "unit 0", "family inet"], leaf: `address ${h.gw}/24` });
  out.push({ path: ["interfaces", "lo0", "unit 0", "family inet"], leaf: `address ${SR_LO[r]}/32` }, { path: ["interfaces", "lo0", "unit 0", "family iso"], leaf: `address 49.0001.0000.0000.000${SR_IDX[r]}.00` });
  out.push({ path: ["routing-options"], leaf: `router-id ${SR_LO[r]}` }, { path: ["routing-options"], leaf: "autonomous-system 65000" });
  if (hasBgp(r)) {
    const other = r === "R1" ? "R6" : "R1";
    out.push({ path: ["protocols", "bgp", "group IBGP"], leaf: "type internal" }, { path: ["protocols", "bgp", "group IBGP"], leaf: `local-address ${SR_LO[r]}` }, { path: ["protocols", "bgp", "group IBGP"], leaf: "export CUSTOMER" }, { path: ["protocols", "bgp", "group IBGP"], leaf: `neighbor ${SR_LO[other]}` });
  }
  if (c.sr) {
    const sp = ["protocols", "isis", "source-packet-routing"];
    if (c.srgb) out.push({ path: sp, leaf: `srgb start-label ${c.srgb.start} index-range ${c.srgb.range}` });
    if (c.sid !== undefined) out.push({ path: sp, leaf: `node-segment ipv4-index ${c.sid}` });
    if (!c.srgb && c.sid === undefined) out.push({ path: sp, leaf: "" });
  }
  out.push({ path: ["protocols", "isis"], leaf: "level 1 disable" });
  for (const i of srIfs(r)) {
    const f = c.ifs[i.ifn]!;
    if (!f.isis) continue;
    out.push({ path: ["protocols", "isis", `interface ${i.ifn}.0`], leaf: "point-to-point" });
    if (f.metric !== 10) out.push({ path: ["protocols", "isis", `interface ${i.ifn}.0`], leaf: `level 2 metric ${f.metric}` });
  }
  if (c.lo) out.push({ path: ["protocols", "isis", "interface lo0.0"], leaf: "passive" });
  for (const i of srIfs(r).filter((x) => c.ifs[x.ifn]!.mplsIf)) out.push({ path: ["protocols", "mpls"], leaf: `interface ${i.ifn}.0` });
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Configuration statements
// ---------------------------------------------------------------------------------------------------------------
function stmts(r: SrR): SpCfgStmt<SrRtr>[] {
  const P2P = "% This lab keeps every core link point-to-point.";
  const srgbOk = (lo: number, hi: number) => (hi < lo ? "% The upper bound must be above the lower bound." : hi - lo + 1 > 65536 ? "% This lab keeps the SRGB at 65536 labels or fewer." : undefined);
  return [
    // IOS XR
    { id: "sr", summary: "Segment Routing", xr: { mode: "config", syntax: "segment-routing", enter: "sr", apply: (c) => c, no: (c) => ((c.srgb = undefined), c) } },
    { id: "sr-gb", summary: "Global block of labels for prefix SIDs", args: { lo: srgbLoArg, hi: srgbHiArg }, xr: { mode: "sr", syntax: "global-block <lo> <hi>", noSyntax: "global-block", apply: (c, a) => srgbOk(+a.lo, +a.hi) ?? ((c.srgb = { start: +a.lo, range: +a.hi - +a.lo + 1 }), c), no: (c) => ((c.srgb = undefined), c) } },
    { id: "router-isis", summary: "IS-IS routing protocol", args: { tag: choiceArg(["CORE"], () => "Instance tag") }, xr: { mode: "config", syntax: "router isis <tag>", enter: "isis", apply: (c) => c } },
    { id: "isis-af", summary: "Enter the IPv4 unicast address family", xr: { mode: "isis", syntax: "address-family ipv4 unicast", enter: "isis-af", apply: (c) => c } },
    { id: "isis-ms", summary: "Use wide metrics (TLVs 22 and 135)", args: { w: choiceArg(["wide"], () => "Wide metrics") }, xr: { mode: "isis-af", syntax: "metric-style <w>", apply: (c) => c, no: () => "% Segment routing needs wide metrics." } },
    { id: "isis-sr", summary: "Enable segment routing (MPLS data plane) for this address family", args: { m: choiceArg(["mpls"], () => "MPLS data plane") }, xr: { mode: "isis-af", syntax: "segment-routing <m>", apply: (c) => ((c.sr = true), c), no: (c) => ((c.sr = false), c) } },
    { id: "isis-if", summary: "Enter the IS-IS interface configuration submode", args: { if: xrIfArg(r, true) }, xr: { mode: "isis", syntax: "interface <if>", enter: "isis-if", apply: (c, a) => { if (a.if === "lo0") c.lo = true; else ifc(c, a.if).isis = true; return c; }, no: (c, a) => { if (a.if === "lo0") { c.lo = false; c.sid = undefined; } else ifc(c, a.if).isis = false; return c; } } },
    { id: "isis-p2p", summary: "Treat the interface as point-to-point", xr: { mode: "isis-if", syntax: "point-to-point", apply: (c) => c, no: () => P2P } },
    { id: "isis-passive", summary: "Advertise the prefix but send no hellos", xr: { mode: "isis-if", syntax: "passive", apply: (c, _a, x) => (x.if === "lo0" ? c : "% This lab only uses passive on Loopback0.") } },
    { id: "isis-if-af", summary: "Enter the interface IPv4 unicast address family", xr: { mode: "isis-if", syntax: "address-family ipv4 unicast", enter: "isis-if-af", apply: (c) => c } },
    { id: "isis-metric", summary: "Set the default metric for this interface", args: { n: metricArg }, xr: { mode: "isis-if-af", syntax: "metric <n>", noSyntax: "metric", apply: (c, a, x) => (x.if === "lo0" ? "% This lab keeps Loopback0 at metric 0." : ((ifc(c, x.if).metric = +a.n), c)), no: (c, _a, x) => (x.if === "lo0" ? c : ((ifc(c, x.if).metric = defMetric(r, x.if)), c)) } },
    { id: "isis-sid", summary: "Prefix-SID for this prefix", args: { i: choiceArg(["index"], () => "SID index (label = SRGB start + index)"), n: sidArg }, xr: { mode: "isis-if-af", syntax: "prefix-sid <i> <n>", noSyntax: "prefix-sid", apply: (c, a, x) => (x.if !== "lo0" ? "% Prefix-SIDs are configured on the loopback in this lab." : ((c.sid = +a.n), c)), no: (c) => ((c.sid = undefined), c) } },
    // Junos
    { id: "j-srgb", summary: "Segment Routing Global Block", args: { s: srgbLoArg, n: rangeArg }, junos: { syntax: "protocols isis source-packet-routing srgb start-label <s> index-range <n>", set: (c, a) => ((c.sr = true), (c.srgb = { start: +a.s, range: +a.n }), c), del: (c) => ((c.srgb = undefined), c) } },
    { id: "j-srgb-del", summary: "Remove the SRGB", junos: { syntax: "protocols isis source-packet-routing srgb", del: (c) => ((c.srgb = undefined), c) } },
    { id: "j-nodeseg", summary: "Prefix-SID index of the loopback (node segment)", args: { n: sidArg }, junos: { syntax: "protocols isis source-packet-routing node-segment ipv4-index <n>", set: (c, a) => ((c.sr = true), (c.sid = +a.n), c), del: (c) => ((c.sid = undefined), c) } },
    { id: "j-nodeseg-del", summary: "Remove the node segment", junos: { syntax: "protocols isis source-packet-routing node-segment", del: (c) => ((c.sid = undefined), c) } },
    { id: "j-spring", summary: "Segment routing for IS-IS (delete removes it all)", junos: { syntax: "protocols isis source-packet-routing", set: (c) => ((c.sr = true), c), del: (c) => ((c.sr = false), (c.srgb = undefined), (c.sid = undefined), c) } },
    { id: "j-isis-if", summary: "Include an interface in IS-IS", args: { if: jnUnitArg(r, true) }, junos: { syntax: "protocols isis interface <if>", set: (c, a) => (a.if === "lo0" ? ((c.lo = true), c) : ((ifc(c, a.if).isis = true), c)), del: (c, a) => (a.if === "lo0" ? ((c.lo = false), c) : ((ifc(c, a.if).isis = false), c)) } },
    { id: "j-isis-p2p", summary: "Treat the interface as point-to-point", args: { if: jnUnitArg(r) }, junos: { syntax: "protocols isis interface <if> point-to-point", set: (c, a) => ((ifc(c, a.if).isis = true), c), del: () => P2P.slice(2) } },
    { id: "j-isis-passive", summary: "Advertise the prefix but send no hellos", args: { if: jnUnitArg(r, true) }, junos: { syntax: "protocols isis interface <if> passive", set: (c, a) => (a.if === "lo0" ? ((c.lo = true), c) : "error: this lab only uses passive on lo0.0"), del: (c, a) => (a.if === "lo0" ? ((c.lo = false), c) : c) } },
    { id: "j-isis-metric", summary: "Metric for this interface at this level", args: { if: jnUnitArg(r), l: lvlArg, n: metricArg }, junos: { syntax: "protocols isis interface <if> level <l> metric <n>", set: (c, a) => ((ifc(c, a.if).metric = +a.n), c) } },
    { id: "j-isis-metric-del", summary: "Remove the metric for this interface at this level", args: { if: jnUnitArg(r), l: lvlArg }, junos: { syntax: "protocols isis interface <if> level <l> metric", del: (c, a) => ((ifc(c, a.if).metric = defMetric(r, a.if)), c) } },
    { id: "j-fam", summary: "MPLS family on the logical unit", args: { if: jnPhysArg(r) }, junos: { syntax: "interfaces <if> unit 0 family mpls", set: (c, a) => ((ifc(c, a.if).fam = true), c), del: (c, a) => ((ifc(c, a.if).fam = false), c) } },
    { id: "j-mpls-if", summary: "Enable MPLS on an interface", args: { if: jnUnitArg(r) }, junos: { syntax: "protocols mpls interface <if>", set: (c, a) => ((ifc(c, a.if).mplsIf = true), c), del: (c, a) => ((ifc(c, a.if).mplsIf = false), c) } },
  ];
}

// ---------------------------------------------------------------------------------------------------------------
// Command sets
// ---------------------------------------------------------------------------------------------------------------
export function srXrSpec(api: SrCliApi, r: SrR): SpXrSpec<SrRtr> {
  const s = api.s;
  const sh = (id: string, syntax: string, summary: string, run: SpCmd["run"], args?: SpCmd["args"]): SpCmd => ({ id, syntax, summary, run, args });
  const nothing = (o: string, why: string) => o || { output: "", explanation: why };
  return {
    stmts: stmts(r).filter((x) => x.xr),
    prompts: { config: "config", sr: "config-sr", isis: "config-isis", "isis-af": "config-isis-af", "isis-if": "config-isis-if", "isis-if-af": "config-isis-if-af" },
    lines: (c) => srXrLines(r, c),
    help: { "show isis": "IS-IS information", "show isis segment-routing": "Segment routing information", "show mpls": "MPLS information", "show route": "IP routing table", "show bgp": "BGP information", ping: "Send echo messages", "ping sr-mpls": "Segment routing MPLS echo (LSP ping)", "ping sr-mpls nil-fec": "Nil FEC: impose a label stack", traceroute: "Trace route to destination", "traceroute sr-mpls": "Segment routing MPLS traceroute" },
    shows: [
      sh("lbl", "show isis segment-routing label table", "The Prefix-SID labels this router programs", () => nothing(xrLabelTable(s, r), "Segment routing is not enabled in IS-IS here.")),
      sh("adj", "show isis adjacency", "IS-IS adjacencies", () => xrAdj(s, r, false)),
      sh("adjd", "show isis adjacency detail", "IS-IS adjacencies with their Adjacency SIDs", () => xrAdj(s, r, true)),
      sh("nbr", "show isis neighbors", "IS-IS neighbors", () => xrIsisNbr(s, r)),
      sh("db", "show isis database verbose", "Every LSP: SRGB, Prefix-SIDs, Adjacency SIDs", () => xrDatabase(s, r)),
      sh("fwd", "show mpls forwarding", "The label forwarding table", () => xrForwarding(s, r)),
      sh("fwdl", "show mpls forwarding labels <n>", "One label's forwarding entry", (a) => nothing(xrForwarding(s, r, +a.n), "No such local label."), { n: labelArg }),
      sh("route", "show route", "The IPv4 routing table", () => [...XR_CODES, ...xrRib(s, r).map((x) => xrRouteLine(s, x))].join("\n")),
      sh("routeip", "show route <ip>", "The route a destination uses", (a) => xrRouteIp(s, r, a.ip), { ip: ipArg }),
      sh("cef", "show cef <ip>", "The forwarding entry for a destination (labels imposed)", (a) => xrCef(s, r, a.ip), { ip: pfxArg }),
      sh("bgp", "show bgp ipv4 unicast", "The BGP table", () => xrBgp(s, r)),
      sh("log", "show logging", "The syslog buffer", () => xrLogging(s, r)),
    ],
    exec: [
      sh("ping-sr", "ping sr-mpls <fec>", "LSP ping along a Node SID", (a) => {
        const g = srgbOf(s.cfg[r], s.os);
        const sid = sidOf(s.view, routerOfLo(a.fec)!);
        if (g && sid && routerOfLo(a.fec) !== r) api.act({ type: "probe", stack: [g.start + sid.index], dst: a.fec, from: r });
        return xrPingSr(s, r, a.fec);
      }, { fec: fecArg }),
      sh("trace-sr", "traceroute sr-mpls <fec>", "LSP traceroute: every hop's label", (a) => {
        const g = srgbOf(s.cfg[r], s.os);
        const sid = sidOf(s.view, routerOfLo(a.fec)!);
        if (g && sid && routerOfLo(a.fec) !== r) api.act({ type: "probe", stack: [g.start + sid.index], dst: a.fec, from: r });
        return xrTraceSr(s, r, a.fec);
      }, { fec: fecArg }),
      sh("nilfec", "ping sr-mpls nil-fec labels <list> output interface <if> nexthop <ip>", "Send an MPLS echo with your own label stack", (a) => {
        const i = srIfs(r).find((x) => x.ifn === a.if)!;
        if (a.ip === i.peerIp) api.act({ type: "nilfec", stack: a.list.split(",").map(Number), ifn: a.if as IfName, from: r });
        return xrNilFec(s, r, a.list, a.if, a.ip);
      }, { list: listArg, if: xrIfArg(r), ip: { ...ipArg, choices: srIfs(r).map((i) => i.peerIp) } }),
    ],
  };
}
export function srJunosSpec(api: SrCliApi, r: SrR): SpJunosSpec<SrRtr> {
  const s = api.s;
  const sh = (id: string, syntax: string, summary: string, run: SpCmd["run"], args?: SpCmd["args"]): SpCmd => ({ id, syntax, summary, run, args });
  const nothing = (o: string, why: string) => o || { output: "", explanation: why };
  const tbl = choiceArg(["inet.3", "mpls.0"], (c) => (c === "inet.3" ? "SR routes to the loopbacks (what BGP next hops resolve over)" : "Label forwarding"));
  return {
    stmts: stmts(r).filter((x) => x.junos),
    jstmts: (c) => srJnStmts(r, c),
    help: { "show isis": "Show Intermediate System-to-Intermediate System information", "show route": "Show routing table information", "show route table": "Name of the routing table" },
    shows: [
      sh("adj", "show isis adjacency", "IS-IS adjacencies", () => jnAdj(s, r)),
      sh("db", "show isis database extensive", "Every LSP: SPRING capability, Prefix SIDs, Adj-SIDs", () => jnDatabase(s)),
      sh("tbl", "show route table <t>", "inet.3 or mpls.0", (a) => nothing(a.t === "inet.3" ? jnInet3(s, r) : jnMpls0(s, r), "Segment routing is not enabled in IS-IS here."), { t: tbl }),
      sh("rt", "show route <ip>", "The route a destination uses", (a) => nothing(jnRouteIp(s, r, a.ip, false), "No route."), { ip: ipArg }),
      sh("rth", "show route <ip> hidden", "Routes that exist but can't be used", (a) => nothing(jnRouteIp(s, r, a.ip, true), "No hidden route."), { ip: ipArg }),
      sh("log", "show log messages", "The system log", () => nothing(jnLog(s, r), "No messages since the lab started.")),
    ],
  };
}
export function srSets(api: SrCliApi, r: SrR): Partial<Record<CliVendor, CliCommandSet>> {
  return { cisco: buildXrSet(api.dev, srXrSpec(api, r)), juniper: buildJunosSet(api.dev, srJunosSpec(api, r)) };
}
export const srPipe = (api: SrCliApi, r: SrR) => ({ config: junosPipeConfig(api.dev, { jstmts: (c: SrRtr) => srJnStmts(r, c) }), rollbacks: api.dev.hist.length });
export function srStaticApi(s: SrState, r: SrR): SrCliApi {
  return { s, act: () => s, dev: { host: r, running: s.cfg[r], hist: s.hist[r], setCand: () => undefined, xr: [], setXr: () => undefined, edit: false, setEdit: () => undefined, commit: () => undefined } };
}
export { SRGB0, adjSidLabel };
