import type { CliArgSpec, CliCommandSet, CliVendor } from "@/lib/cli/types";
import { buildXrSet, choiceArg, numArg, type SpCfgStmt, type SpCmd, type SpDevCli, type SpXrSpec } from "@/components/sp-lab/spCli";
import { pad, spAge, spStamp } from "@/components/sp-lab/spKit";
import { parseIf, xrIf } from "@/components/sp-lab/spNames";
import {
  AFF_BIT,
  COLOR,
  SP_HOSTS,
  SP_IDX,
  SP_LINKS,
  SP_LO,
  SP_ROUTERS,
  SRGB,
  adjLabel,
  isActive,
  segText,
  spEntry,
  spIfs,
  spLinkIp,
  spRouterOfLo,
  spWalk,
  steering,
  type Aff,
  type IfName,
  type SpAction,
  type SpCand,
  type SpEntry,
  type SpHost,
  type SpPolEval,
  type SpPolicy,
  type SpR,
  type SpRtr,
  type SpSeg,
  type SpState,
} from "@/lib/sim-engine/scenarios/srpNet";

/**
 * Command line of the SR Policy Lab — IOS XR on R1–R6 (R1 is the SR-TE headend). Every output is printed from the lab
 * model: SR labels, the policy and its candidate paths, the BGP route and its color, the forwarding entries.
 *
 *   show segment-routing traffic-eng policy [color <c>] · show bgp ipv4 unicast [<prefix>] · show cef <prefix> ·
 *   show mpls forwarding [labels <n>] · show isis segment-routing label table · show isis adjacency detail ·
 *   show route <ip> · show logging · ping sr-mpls nil-fec labels <list> output interface <if> nexthop <ip>
 *   configure → segment-routing → traffic-eng → affinity-map · interface → affinity → name · segment-list → index N
 *   address ipv4 | mpls label · policy → binding-sid mpls · color … end-point ipv4 … · candidate-paths → preference →
 *   explicit segment-list | dynamic → metric → type | constraints → affinity → include-any → name ·
 *   router isis CORE (segment-routing mpls, interface metric, prefix-sid) · router bgp 65000 on R6 (route-policy out)
 */

export interface SrpCliApi {
  s: SrpStateLike;
  act: (a: SpAction) => SpState;
  dev: SpDevCli<SpRtr>;
}
type SrpStateLike = SpState;
const age = (s: SpState) => spAge(s.clock, 15);
const ipNum = (ip: string) => ip.split(".").reduce((a, o) => a * 256 + Number(o), 0);
const inPfx = (ip: string, p: string, len: number) => Math.floor(ipNum(ip) / 2 ** (32 - len)) === Math.floor(ipNum(p) / 2 ** (32 - len));
const ifc = (c: SpRtr, ifn: string) => c.ifs[ifn as IfName]!;
const defMetric = (r: SpR, ifn: string) => spIfs(r).find((i) => i.ifn === ifn)!.link.metric;
const polName = (p: SpPolicy) => `srte_c_${p.color ?? 0}_ep_${p.endpoint ?? "0.0.0.0"}`;
const outTxt = (e: SpEntry) => (e.out === "Pop" ? "Pop" : e.out === "Unlabelled" ? "Unlabelled" : String(e.out));

// ---------------------------------------------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------------------------------------------
const phys = (r: SpR) => spIfs(r).map((i) => i.ifn);
const xrIfArg = (r: SpR, withLo = false): CliArgSpec => ({
  choices: [...(withLo ? ["Loopback0"] : []), ...phys(r).map((i) => xrIf(i))],
  describe: (c) => {
    const n = parseIf(c);
    const i = spIfs(r).find((x) => x.ifn === n);
    return i ? `to ${i.peer}` : n === "lo0" ? "Loopback interface" : undefined;
  },
  resolve: (raw) => {
    const n = parseIf(raw);
    return n && (n === "lo0" ? withLo : phys(r).includes(n as IfName)) ? n : undefined;
  },
});
const ipRe = /^(\d{1,3}\.){3}\d{1,3}$/;
const ipArg = (choices: string[], what: string): CliArgSpec => ({ choices, describe: (c) => spRouterOfLo(c) ?? what, resolve: (raw) => (ipRe.test(raw) && raw.split(".").every((o) => +o <= 255) ? raw : undefined) });
const pfxArg: CliArgSpec = { choices: ["192.168.6.0/24", "192.168.60.0/24", "192.168.1.0/24"], describe: () => "A prefix (a.b.c.d/len)", resolve: (raw) => { const m = /^((\d{1,3}\.){3}\d{1,3})(\/(\d{1,2}))?$/.exec(raw); return m && m[1].split(".").every((o) => +o <= 255) ? raw : undefined; } };
const nameArg = (choices: string[], what: string): CliArgSpec => ({ choices, describe: () => what, resolve: (raw) => (/^[A-Za-z][\w-]{0,31}$/.test(raw) ? raw : undefined) });
const affArg = choiceArg(["BLUE", "GOLD"], (c) => `affinity ${c} (bit ${AFF_BIT[c as Aff]})`);
const prefArg = numArg(1, 65535, ["100", "200"], "Candidate-path preference (higher wins among valid paths)");
const idxArg = numArg(1, 65535, ["10", "20", "30"], "Segment index (order in the list)");
const labelArg = numArg(16, 1048575, ["16003", "24035", "16006"], "MPLS label");
const colorArg = numArg(1, 4294967295, ["100"], "Color (intent)");
const bsidArg = numArg(16, 1048575, ["30001"], "Binding SID label");
const metricArg = numArg(1, 16777214, ["10", "15", "30", "100"], "Default metric (wide: 1–16777214)");
const sidArg = numArg(0, 1048575, ["6"], "Prefix-SID index");

// ---------------------------------------------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------------------------------------------
function candLines(s: SpState, p: SpPolEval): string[] {
  const out: string[] = [];
  for (const k of p.cands) {
    const act = isActive(p, k);
    out.push(`    Preference: ${k.cand.pref} (configuration)${act ? " (active)" : ""}`, `      Name: ${p.pol.name}`, ...(p.pol.bsid !== undefined ? [`      Requested BSID: ${p.pol.bsid}`] : []));
    if (k.cand.kind === "explicit") {
      out.push(`      Explicit: segment-list ${k.cand.list ?? "(none)"} (${k.valid ? "valid" : "invalid"})${k.valid ? "" : `\n        Reason: ${k.why}`}`);
      if (k.labels.length) out.push("        Weight: 1, Metric Type: TE", ...k.labels.map((l) => `          ${l}${segDesc(l)}`));
    } else {
      out.push(`      Dynamic (${k.valid ? (act ? "valid" : "inactive") : "invalid"})${k.valid ? "" : `\n        Reason: ${k.why}`}`);
      out.push(`        Metric Type: ${(k.cand.metric ?? "te").toUpperCase()},   Path Accumulated Metric: ${k.cost ?? 0}`);
      if (k.cand.include?.length) out.push(`        Affinity: include-any ${k.cand.include.join(", ")}`);
      out.push(...k.labels.map((l) => `          ${l}${segDesc(l)}`));
    }
  }
  return out;
  function segDesc(l: number) {
    if (l >= SRGB.start && l < SRGB.start + SRGB.range) {
      const o = SP_ROUTERS.find((x) => s.cfg[x].sid === l - SRGB.start);
      return o ? ` [Prefix-SID, ${SP_LO[o]}]` : "";
    }
    for (const a of SP_ROUTERS) for (const i of spIfs(a)) if (adjLabel(a, i.peer) === l) return ` [Adjacency-SID, ${i.ip} - ${i.peerIp}]`;
    return "";
  }
}
function xrPolicies(s: SpState, r: SpR, color?: number): string {
  if (r !== "R1") return "";
  const ps = s.view.pols.filter((p) => color === undefined || p.pol.color === color);
  if (!ps.length) return "";
  const blocks = ps.map((p) => [
    `Color: ${p.pol.color ?? "-"}, End-point: ${p.pol.endpoint ?? "-"}`,
    `  Name: ${polName(p.pol)}`,
    "  Status:",
    `    Admin: up  Operational: ${p.up ? `up for ${age(s)} (since ${spStamp(40).xr.replace(" UTC", "")})` : "down"}`,
    "  Candidate-paths:",
    ...candLines(s, p),
    "  Attributes:",
    `    Binding SID: ${p.up && p.pol.bsid !== undefined ? p.pol.bsid : "(none)"}`,
    "    Forward Class: Not Configured",
    "    Steering labeled-services disabled: no",
    "    Steering BGP disabled: no",
    "    IPv6 caps enable: yes",
  ].join("\n"));
  return ["", "SR-TE policy database", "---------------------", "", ...blocks.flatMap((b) => [b, ""])].join("\n");
}
const FWD_HEAD = ["Local  Outgoing    Prefix             Outgoing     Next Hop        Bytes", "Label  Label       or ID              Interface                    Switched", "------ ----------- ------------------ ------------ --------------- ------------"];
function xrForwarding(s: SpState, r: SpR, only?: number): string {
  const rows = s.view.table[r].filter((e) => !e.own && (only === undefined || e.label === only)).map((e) =>
    e.kind === "bsid" ? `${pad(e.label, 7)}${pad("Pop", 12)}${pad("No ID", 19)}${pad("srte_c_100_e", 13)}${pad("point2point", 16)}0` : `${pad(e.label, 7)}${pad(outTxt(e), 12)}${pad(e.kind === "adj" ? "SR Adj (idx 1)" : `SR Pfx (idx ${e.index})`, 19)}${pad(xrIf(e.nh!.ifn, true), 13)}${pad(e.nh!.ip, 16)}0`,
  );
  if (only !== undefined && !rows.length) return "";
  return [...FWD_HEAD, ...rows].join("\n");
}
function xrLabelTable(s: SpState, r: SpR): string {
  if (!s.cfg[r].sr) return "";
  const rows = s.view.sids.sort((a, b) => a.index - b.index).map((x) => `${pad(SRGB.start + x.index, 14)}${x.owner === r ? "Loopback0" : `${SP_LO[x.owner]}/32`}`);
  return ["", "IS-IS CORE IS Label Table", "Label         Prefix/Interface", "----------    ----------------", ...rows].join("\n");
}
function xrAdj(s: SpState, r: SpR): string {
  const ups = spIfs(r).filter((i) => s.view.adj[i.link.id]);
  return ["IS-IS CORE Level-2 adjacencies:", "System Id      Interface                SNPA           State Hold Changed  NSF IPv4 IPv6", "                                                                               BFD  BFD", ...ups.flatMap((i) => {
    const a = s.view.table[r].find((e) => e.kind === "adj" && e.to === i.peer);
    return [`${pad(i.peer, 15)}${pad(xrIf(i.ifn, true), 25)}${pad("*PtoP*", 15)}${pad("Up", 6)}${pad(27, 5)}${pad(age(s), 9)}Yes None None`, "  Area Address:           49.0001", `  Neighbor IPv4 Address:  ${i.peerIp}*`, ...(a ? [`  Adjacency SID:          ${a.label}`] : []), "  Topology:               IPv4 Unicast"];
  }), "", `Total adjacency count: ${ups.length}`].join("\n");
}
function xrBgp(s: SpState, r: SpR): string {
  if (r !== "R1" && r !== "R6") return "% BGP instance 'default' not active";
  const rows = r === "R1" ? [
    { n: "192.168.1.0/24", nh: "0.0.0.0", local: true },
    { n: "192.168.6.0/24", nh: SP_LO.R6, local: false, h: "H6" as SpHost },
    { n: "192.168.60.0/24", nh: SP_LO.R6, local: false, h: "H60" as SpHost },
  ] : [
    { n: "192.168.1.0/24", nh: SP_LO.R1, local: false },
    { n: "192.168.6.0/24", nh: "0.0.0.0", local: true },
    { n: "192.168.60.0/24", nh: "0.0.0.0", local: true },
  ];
  return [`BGP router identifier ${SP_LO[r]}, local AS number 65000`, "BGP generic scan interval 60 secs", "BGP table state: Active", "Table ID: 0xe0000000   RD version: 7", "BGP main routing table version 7", "", "Status codes: s suppressed, d damped, h history, * valid, > best", "              i - internal, r RIB-failure, S stale, N Nexthop-discard", "Origin codes: i - IGP, e - EGP, ? - incomplete", "   Network            Next Hop            Metric LocPrf Weight Path", ...rows.map((x) => {
    const st = x.h ? steering(s.cfg, s.view, x.h) : undefined;
    const nh = st?.pol?.up ? `${x.nh} C:${COLOR}` : x.nh;
    return `${x.local ? "*> " : "*>i"}${pad(x.n, 19)}${pad(nh, 20)}${x.local ? "0         32768 i" : "0    100      0 i"}`;
  }), "", "Processed 3 prefixes, 3 paths"].join("\n");
}
function xrBgpPfx(s: SpState, r: SpR, raw: string): string {
  if (r !== "R1" && r !== "R6") return "% BGP instance 'default' not active";
  const ip = raw.split("/")[0];
  const h = (Object.keys(SP_HOSTS) as SpHost[]).find((x) => inPfx(ip, SP_HOSTS[x].net, 24));
  if (!h) return "% Network not in table";
  const host = SP_HOSTS[h];
  const local = host.r === r;
  const head = [`BGP routing table entry for ${host.net}/24`, "Versions:", "  Process           bRIB/RIB  SendTblVer", "  Speaker                   7            7", `Last Modified: ${spStamp(40).xr.replace(" UTC", "")} for ${age(s)}`, "Paths: (1 available, best #1)"];
  if (local) return [...head, "  Advertised to peers (in unique update groups):", `    ${r === "R6" ? SP_LO.R1 : SP_LO.R6}`, "  Path #1: Received by speaker 0", "  Local", "    0.0.0.0 from 0.0.0.0 (" + SP_LO[r] + ")", "      Origin IGP, metric 0, localpref 100, weight 32768, valid, redistributed, best, group-best", ...(r === "R6" && h === "H6" && s.cfg.R6.colorOut ? ["      (exported to 10.0.0.1 with Extended community: Color:100)"] : [])].join("\n");
  const st = steering(s.cfg, s.view, h);
  const nh = SP_LO[host.r];
  const metric = s.view.rib[r].find((x) => x.dst === host.r)?.cost ?? 0;
  return [...head, "  Not advertised to any peer", "  Path #1: Received by speaker 0", "  Not advertised to any peer", "  Local", `    ${nh}${st.colored ? ` C:${COLOR}` : ""}${st.pol?.up ? ` (bsid:${st.pol.pol.bsid})` : ""} (metric ${metric}) from ${nh} (${nh})`, "      Origin IGP, metric 0, localpref 100, valid, internal, best, group-best", "      Received Path ID 0, Local Path ID 1, version 7", ...(st.colored ? [`      Extended community: Color:${COLOR}`] : []), ...(st.colored ? [st.pol ? `      SR policy color ${COLOR}, ${st.pol.up ? "up" : "down"}, registered${st.pol.up ? `, bsid ${st.pol.pol.bsid}` : ""}` : `      SR policy color ${COLOR}, end-point ${nh}: not found`] : [])].join("\n");
}
function xrCef(s: SpState, r: SpR, raw: string): string {
  const ip = raw.split("/")[0];
  const h = (Object.keys(SP_HOSTS) as SpHost[]).find((x) => inPfx(ip, SP_HOSTS[x].net, 24));
  if (!h || r !== "R1" || SP_HOSTS[h].r === "R1") return `${ip}/32, version 0, drop adjacency`;
  const host = SP_HOSTS[h];
  const head = `${host.net}/24, version ${50 + ipNum(ip) % 7}, internal 0x5000001 0x30 (ptr 0x7fa1b2c3d0) [1], 0x0 (0x0), 0x0 (0x0)`;
  const st = steering(s.cfg, s.view, h);
  if (st.pol?.up) {
    const [first, ...rest] = st.pol.active!.labels;
    const e1 = spEntry(s.view, "R1", first);
    const wire = e1?.out === "Pop" || e1?.kind === "adj" ? rest : [e1?.out ?? first, ...rest];
    return [head, " Prefix Len 24, traffic index 0, precedence n/a, priority 4", `   via local-label ${st.pol.pol.bsid}, 3 dependencies, recursive [flags 0x0]`, "    recursion-via-label", `     next hop ${polName(st.pol.pol)}`, `      next hop ${e1?.nh?.ip ?? "?"}/32 ${e1?.nh ? xrIf(e1.nh.ifn, true) : ""}    labels imposed {${wire.join(" ")}}`].join("\n");
  }
  const e = spEntry(s.view, "R1", SRGB.start + SP_IDX[host.r]);
  return [head, " Prefix Len 24, traffic index 0, precedence n/a, priority 4", `   via ${SP_LO[host.r]}/32, 3 dependencies, recursive [flags 0x6000]`, ...(e?.nh ? [`    next hop ${e.nh.ip}/32 ${xrIf(e.nh.ifn, true)}    labels imposed {${e.out === "Pop" ? "ImplNull" : e.out === "Unlabelled" ? "None" : e.out}}`] : ["    unresolved"])].join("\n");
}
function xrRouteIp(s: SpState, r: SpR, ip: string): string {
  const lo = spRouterOfLo(ip);
  if (lo === r) return [`Routing entry for ${ip}/32`, `  Known via "local", distance 0, metric 0 (connected)`, "  Routing Descriptor Blocks", "    directly connected, via Loopback0", "  No advertising protos."].join("\n");
  if (!lo) return "% Network not in table";
  const rt = s.view.rib[r].find((x) => x.dst === lo);
  if (!rt?.nh) return "% Network not in table";
  const e = spEntry(s.view, r, SRGB.start + SP_IDX[lo]);
  return [`Routing entry for ${ip}/32`, `  Known via "isis CORE", distance 115, metric ${rt.cost}, ${e ? "labeled SR, " : ""}type level-2`, `  Installed ${spStamp(15).xr.replace(" UTC", "")} for ${age(s)}`, "  Routing Descriptor Blocks", `    ${rt.nh.ip}, from ${ip}, via ${xrIf(rt.nh.ifn)}`, `      Route metric is ${rt.cost}`, ...(e ? [`      Label: ${e.out === "Pop" ? "0x3 (3)" : e.out === "Unlabelled" ? "None" : `0x${(e.out as number).toString(16)} (${e.out})`}`] : []), "  No advertising protos."].join("\n");
}
function xrLogging(s: SpState, r: SpR): string {
  const lines = s.sys.filter((x) => x.dev === r).slice(-30).map((x) => {
    const st = `RP/0/RP0/CPU0:${spStamp(x.t).xr}`;
    const i = x.peer ? spIfs(r).find((y) => y.peer === x.peer) : undefined;
    if (x.kind === "adj-up" || x.kind === "adj-down") return `${st}: isis[1012]: %ROUTING-ISIS-5-ADJCHANGE : Adjacency to ${x.peer} (${i ? xrIf(i.ifn) : "?"}) (L2) ${x.kind === "adj-up" ? "Up, New adjacency" : "Down, Neighbor forgot us"}`;
    if (x.kind === "policy-up" || x.kind === "policy-down") return `${st}: xtc_agent[1186]: %ROUTING-XTC-5-SR_POLICY_UPDOWN : SR policy '${x.peer}' (color ${COLOR}, end-point ${SP_LO.R6}) state changed to ${x.kind === "policy-up" ? "UP" : "DOWN"}`;
    if (x.kind === "cand-change") return `${st}: xtc_agent[1186]: %ROUTING-XTC-5-SR_POLICY_CP_CHANGE : SR policy '${x.peer}': active candidate path changed`;
    return `${st}: config[65857]: %MGBL-CONFIG-6-DB_COMMIT : Configuration committed by user 'admin'. Use 'show commit changes ${1000000000 + x.t}' to view the changes.`;
  });
  return ["Syslog logging: enabled (0 messages dropped, 0 flushes, 0 overruns)", `    Buffer logging: level debugging, ${lines.length} messages logged`, "", "Log Buffer (2097152 bytes):", "", ...lines].join("\n");
}
const LSP_CODES = ["Codes: '!' - success, 'Q' - request not sent, '.' - timeout,", "  'L' - labeled output interface, 'B' - unlabeled output interface,", "  'D' - DS Map mismatch, 'F' - no FEC mapping, 'f' - FEC mismatch,", "  'M' - malformed request, 'm' - unsupported tlvs, 'N' - no rx label,", "  'P' - no rx intf label prot, 'p' - premature termination of LSP,", "  'R' - transit router, 'I' - unknown upstream index,", "  'X' - unknown return code, 'x' - return code 0"];
function nilFecWalk(s: SpState, r: SpR, labels: number[], ifn: string) {
  const i = spIfs(r).find((x) => x.ifn === ifn)!;
  // The whole stack leaves on the interface: the neighbor executes the first label.
  const w = spWalk(s.cfg, s.view, i.peer, labels, "127.0.0.1");
  const ok = !w.why || /127\.0\.0\.1/.test(w.why ?? "");
  return { ok: ok && !w.hops.some((h) => /dropped/.test(h.note)) && (w.why === undefined || /no route to 127/.test(w.why)), w };
}

// ---------------------------------------------------------------------------------------------------------------
// The configuration as IOS XR prints it
// ---------------------------------------------------------------------------------------------------------------
export function srpXrLines(r: SpR, c: SpRtr): string[] {
  const out: string[] = [`hostname ${r}`, "!", "interface Loopback0", ` ipv4 address ${SP_LO[r]} 255.255.255.255`, "!"];
  for (const i of spIfs(r)) out.push(`interface ${xrIf(i.ifn)}`, ` description to ${i.peer}`, ` ipv4 address ${i.ip} 255.255.255.0`, "!");
  for (const h of Object.values(SP_HOSTS).filter((x) => x.r === r)) out.push(`interface ${xrIf(h.ifn)}`, ` ipv4 address ${h.gw} 255.255.255.0`, "!");
  if (r === "R6") out.push("extcommunity-set opaque COLOR-GOLD", "  100", "end-set", "!", "route-policy SET-COLOR", "  if destination in (192.168.6.0/24) then", "    set extcommunity color COLOR-GOLD", "  endif", "  pass", "end-policy", "!");
  out.push("router isis CORE", " is-type level-2-only", ` net 49.0001.0000.0000.000${SP_IDX[r]}.00`, " address-family ipv4 unicast", "  metric-style wide", "  mpls traffic-eng level-2-only", "  mpls traffic-eng router-id Loopback0", ...(c.sr ? ["  segment-routing mpls"] : []), " !", " interface Loopback0", "  passive", "  address-family ipv4 unicast", ...(c.sid !== undefined ? [`   prefix-sid index ${c.sid}`] : []), "  !", " !");
  for (const i of spIfs(r)) {
    const f = c.ifs[i.ifn]!;
    if (!f.isis) continue;
    out.push(` interface ${xrIf(i.ifn)}`, "  point-to-point", "  address-family ipv4 unicast", ...(f.metric !== 10 ? [`   metric ${f.metric}`] : []), "  !", " !");
  }
  out.push("!");
  if (r === "R1" || r === "R6") {
    const other = r === "R1" ? "R6" : "R1";
    out.push("router bgp 65000", ` bgp router-id ${SP_LO[r]}`, " address-family ipv4 unicast", ...Object.values(SP_HOSTS).filter((x) => x.r === r).map((x) => `  network ${x.net}/24`), " !", ` neighbor ${SP_LO[other]}`, "  remote-as 65000", "  update-source Loopback0", "  address-family ipv4 unicast", ...(r === "R6" && c.colorOut ? ["   route-policy SET-COLOR out"] : []), "  !", " !", "!");
  }
  out.push("segment-routing", " global-block 16000 23999", " traffic-eng");
  for (const i of spIfs(r)) {
    const f = c.ifs[i.ifn]!;
    if (!f.aff.length) continue;
    out.push(`  interface ${xrIf(i.ifn)}`, "   affinity", ...f.aff.map((a) => `    name ${a}`), "   !", "  !");
  }
  for (const [n, segs] of Object.entries(c.lists)) out.push(`  segment-list ${n}`, ...[...segs].sort((a, b) => a.idx - b.idx).map((x) => `   index ${x.idx} ${segText(x)}`), "  !");
  for (const p of c.policies) {
    out.push(`  policy ${p.name}`, ...(p.bsid !== undefined ? [`   binding-sid mpls ${p.bsid}`] : []), ...(p.color !== undefined && p.endpoint ? [`   color ${p.color} end-point ipv4 ${p.endpoint}`] : []));
    if (p.cands.length) {
      out.push("   candidate-paths");
      for (const k of [...p.cands].sort((a, b) => a.pref - b.pref)) {
        out.push(`    preference ${k.pref}`);
        if (k.kind === "explicit") out.push(`     explicit segment-list ${k.list}`, "     !");
        else {
          out.push("     dynamic", "      metric", `       type ${k.metric ?? "te"}`, "      !", "     !");
          if (k.include?.length) out.push("     constraints", "      affinity", "       include-any", ...k.include.map((a) => `        name ${a}`), "       !", "      !", "     !");
        }
        out.push("    !");
      }
      out.push("   !");
    }
    out.push("  !");
  }
  out.push("  affinity-map", "   name BLUE bit-position 0", "   name GOLD bit-position 1", "  !", " !", "!");
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Configuration statements
// ---------------------------------------------------------------------------------------------------------------
function stmts(r: SpR, s: SpState): SpCfgStmt<SpRtr>[] {
  const headend = r === "R1";
  const NOT_HEAD = "% In this lab, R1 is the SR-TE headend: policies and segment lists live there.";
  const pol = (c: SpRtr, n: string) => {
    let p = c.policies.find((x) => x.name === n);
    if (!p) c.policies.push((p = { name: n, cands: [] }));
    return p;
  };
  const cand = (c: SpRtr, n: string, pref: number) => {
    const p = pol(c, n);
    let k = p.cands.find((x) => x.pref === pref);
    if (!k) p.cands.push((k = { pref, kind: "explicit" }));
    return k;
  };
  const dyn = (k: SpCand) => {
    if (k.kind !== "dynamic") Object.assign(k, { kind: "dynamic", list: undefined, metric: k.metric ?? "te" });
    return k;
  };
  const lists = Object.keys(s.cfg.R1.lists);
  const polNames = s.cfg.R1.policies.map((p) => p.name);
  return [
    { id: "sr", summary: "Segment Routing", xr: { mode: "config", syntax: "segment-routing", enter: "sr", apply: (c) => c } },
    { id: "sr-gb", summary: "Global block of labels for prefix SIDs", args: { lo: choiceArg(["16000"], () => "Lower bound"), hi: choiceArg(["23999"], () => "Upper bound") }, xr: { mode: "sr", syntax: "global-block <lo> <hi>", apply: (c) => c, no: () => "% This lab keeps the SRGB at 16000–23999." } },
    { id: "te", summary: "Segment Routing Traffic Engineering", xr: { mode: "sr", syntax: "traffic-eng", enter: "te", apply: (c) => c } },
    { id: "amap", summary: "Affinity names and their bit positions", xr: { mode: "te", syntax: "affinity-map", enter: "amap", apply: (c) => c } },
    { id: "amap-n", summary: "Name an affinity bit", args: { af: affArg, b: numArg(0, 255, ["0", "1"], "Bit position") }, xr: { mode: "amap", syntax: "name <af> bit-position <b>", apply: (c, a) => (+a.b === AFF_BIT[a.af as Aff] ? c : `% This lab maps ${a.af} to bit ${AFF_BIT[a.af as Aff]}.`) } },
    { id: "te-if", summary: "SR-TE attributes of an interface", args: { if: xrIfArg(r) }, xr: { mode: "te", syntax: "interface <if>", enter: "te-if", apply: (c) => c, no: (c, a) => ((ifc(c, a.if).aff = []), c) } },
    { id: "te-if-aff", summary: "Affinities of the link", xr: { mode: "te-if", syntax: "affinity", enter: "te-if-aff", apply: (c) => c, no: (c, _a, x) => ((ifc(c, x.if).aff = []), c) } },
    { id: "te-if-aff-n", summary: "Add an affinity", args: { af: affArg }, xr: { mode: "te-if-aff", syntax: "name <af>", apply: (c, a, x) => { const f = ifc(c, x.if); if (!f.aff.includes(a.af as Aff)) f.aff.push(a.af as Aff); return c; }, no: (c, a, x) => { const f = ifc(c, x.if); f.aff = f.aff.filter((y) => y !== a.af); return c; } } },
    { id: "sl", summary: "An explicit segment list", args: { sl: nameArg(lists.length ? lists : ["GOLD-EXPLICIT"], "Segment-list name") }, xr: { mode: "te", syntax: "segment-list <sl>", enter: "sl", apply: (c, a) => (headend ? ((c.lists[a.sl] ??= []), c) : NOT_HEAD), no: (c, a) => (delete c.lists[a.sl], c) } },
    { id: "sl-addr", summary: "A hop given by its address (validated against the topology)", args: { i: idxArg, ip: ipArg([SP_LO.R3, "10.1.35.5", SP_LO.R6, "10.1.34.4"], "A loopback (Prefix-SID) or a link address (Adjacency SID)") }, xr: { mode: "sl", syntax: "index <i> address ipv4 <ip>", apply: (c, a, x) => { const l = c.lists[x.sl]; c.lists[x.sl] = [...l.filter((y) => y.idx !== +a.i), { idx: +a.i, addr: a.ip }]; return c; } } },
    { id: "sl-lbl", summary: "A hop given as an MPLS label (only the first one is checked)", args: { i: idxArg, l: labelArg }, xr: { mode: "sl", syntax: "index <i> mpls label <l>", apply: (c, a, x) => { const l = c.lists[x.sl]; c.lists[x.sl] = [...l.filter((y) => y.idx !== +a.i), { idx: +a.i, label: +a.l } as SpSeg]; return c; } } },
    { id: "sl-no", summary: "Remove a hop", args: { i: idxArg }, xr: { mode: "sl", syntax: "index <i>", no: (c, a, x) => ((c.lists[x.sl] = c.lists[x.sl].filter((y) => y.idx !== +a.i)), c) } },
    { id: "pol", summary: "An SR policy", args: { pol: nameArg(polNames.length ? polNames : ["GOLD"], "Policy name") }, xr: { mode: "te", syntax: "policy <pol>", enter: "pol", apply: (c, a) => (headend ? (pol(c, a.pol), c) : NOT_HEAD), no: (c, a) => ((c.policies = c.policies.filter((p) => p.name !== a.pol)), c) } },
    { id: "pol-ce", summary: "The policy's color and end-point", args: { c: colorArg, ep: ipArg([SP_LO.R6], "End-point address") }, xr: { mode: "pol", syntax: "color <c> end-point ipv4 <ep>", apply: (c, a, x) => (Object.assign(pol(c, x.pol), { color: +a.c, endpoint: a.ep }), c) } },
    { id: "pol-bsid", summary: "The binding SID", args: { b: bsidArg }, xr: { mode: "pol", syntax: "binding-sid mpls <b>", noSyntax: "binding-sid", apply: (c, a, x) => ((pol(c, x.pol).bsid = +a.b), c), no: (c, _a, x) => ((pol(c, x.pol).bsid = undefined), c) } },
    { id: "cps", summary: "Candidate paths", xr: { mode: "pol", syntax: "candidate-paths", enter: "cps", apply: (c) => c } },
    { id: "pref", summary: "A candidate path, by preference", args: { p: prefArg }, xr: { mode: "cps", syntax: "preference <p>", enter: "pref", apply: (c, a, x) => (cand(c, x.pol, +a.p), c), no: (c, a, x) => { const p = pol(c, x.pol); p.cands = p.cands.filter((k) => k.pref !== +a.p); return c; } } },
    { id: "pref-exp", summary: "An explicit path: a segment list", args: { sl: nameArg(lists.length ? lists : ["GOLD-EXPLICIT"], "Segment-list name") }, xr: { mode: "pref", syntax: "explicit segment-list <sl>", apply: (c, a, x) => (Object.assign(cand(c, x.pol, +x.p), { kind: "explicit", list: a.sl, metric: undefined, include: undefined }), c) } },
    { id: "pref-dyn", summary: "A dynamic path computed by the headend", xr: { mode: "pref", syntax: "dynamic", enter: "dyn", apply: (c, _a, x) => (dyn(cand(c, x.pol, +x.p)), c) } },
    { id: "dyn-metric", summary: "The metric to optimize", xr: { mode: "dyn", syntax: "metric", enter: "dynm", apply: (c) => c } },
    { id: "dyn-type", summary: "Metric type", args: { t: choiceArg(["te", "igp"], (t) => (t === "te" ? "TE metric" : "IGP metric")) }, xr: { mode: "dynm", syntax: "type <t>", apply: (c, a, x) => ((dyn(cand(c, x.pol, +x.p)).metric = a.t as "te" | "igp"), c) } },
    { id: "pref-cons", summary: "Constraints of the path", xr: { mode: "pref", syntax: "constraints", enter: "cons", apply: (c) => c, no: (c, _a, x) => ((cand(c, x.pol, +x.p).include = undefined), c) } },
    { id: "cons-aff", summary: "Affinity constraints", xr: { mode: "cons", syntax: "affinity", enter: "consaff", apply: (c) => c } },
    { id: "cons-inc", summary: "Use only links with at least one of these affinities", xr: { mode: "consaff", syntax: "include-any", enter: "inc", apply: (c) => c, no: (c, _a, x) => ((cand(c, x.pol, +x.p).include = undefined), c) } },
    { id: "inc-n", summary: "An affinity", args: { af: affArg }, xr: { mode: "inc", syntax: "name <af>", apply: (c, a, x) => { const k = cand(c, x.pol, +x.p); k.include = [...new Set([...(k.include ?? []), a.af as Aff])]; return c; }, no: (c, a, x) => { const k = cand(c, x.pol, +x.p); k.include = (k.include ?? []).filter((y) => y !== a.af); return c; } } },
    { id: "router-isis", summary: "IS-IS routing protocol", args: { tag: choiceArg(["CORE"], () => "Instance tag") }, xr: { mode: "config", syntax: "router isis <tag>", enter: "isis", apply: (c) => c } },
    { id: "isis-af", summary: "Enter the IPv4 unicast address family", xr: { mode: "isis", syntax: "address-family ipv4 unicast", enter: "isis-af", apply: (c) => c } },
    { id: "isis-sr", summary: "Enable segment routing (MPLS data plane)", args: { m: choiceArg(["mpls"], () => "MPLS data plane") }, xr: { mode: "isis-af", syntax: "segment-routing <m>", apply: (c) => ((c.sr = true), c), no: (c) => ((c.sr = false), c) } },
    { id: "isis-if", summary: "Enter the IS-IS interface configuration submode", args: { if: xrIfArg(r, true) }, xr: { mode: "isis", syntax: "interface <if>", enter: "isis-if", apply: (c, a) => (a.if === "lo0" ? c : ((ifc(c, a.if).isis = true), c)), no: (c, a) => (a.if === "lo0" ? "% This lab keeps Loopback0 in IS-IS." : ((ifc(c, a.if).isis = false), c)) } },
    { id: "isis-if-af", summary: "Enter the interface IPv4 unicast address family", xr: { mode: "isis-if", syntax: "address-family ipv4 unicast", enter: "isis-if-af", apply: (c) => c } },
    { id: "isis-metric", summary: "Set the default metric for this interface", args: { n: metricArg }, xr: { mode: "isis-if-af", syntax: "metric <n>", noSyntax: "metric", apply: (c, a, x) => (x.if === "lo0" ? "% This lab keeps Loopback0 at metric 0." : ((ifc(c, x.if).metric = +a.n), c)), no: (c, _a, x) => (x.if === "lo0" ? c : ((ifc(c, x.if).metric = defMetric(r, x.if)), c)) } },
    { id: "isis-sid", summary: "Prefix-SID for this prefix", args: { i: choiceArg(["index"], () => "SID index"), n: sidArg }, xr: { mode: "isis-if-af", syntax: "prefix-sid <i> <n>", noSyntax: "prefix-sid", apply: (c, a, x) => (x.if !== "lo0" ? "% Prefix-SIDs are configured on the loopback in this lab." : ((c.sid = +a.n), c)), no: (c) => ((c.sid = undefined), c) } },
    ...(r === "R6"
      ? ([
          { id: "bgp", summary: "BGP", args: { as: choiceArg(["65000"], () => "AS") }, xr: { mode: "config", syntax: "router bgp <as>", enter: "bgp", apply: (c) => c } },
          { id: "bgp-nbr", summary: "The iBGP neighbor R1", args: { ip: ipArg([SP_LO.R1], "R1's loopback") }, xr: { mode: "bgp", syntax: "neighbor <ip>", enter: "bgp-nbr", apply: (c, a) => (a.ip === SP_LO.R1 ? c : "% R6's only neighbor in this lab is 10.0.0.1.") } },
          { id: "bgp-nbr-af", summary: "IPv4 unicast for this neighbor", xr: { mode: "bgp-nbr", syntax: "address-family ipv4 unicast", enter: "bgp-nbr-af", apply: (c) => c } },
          { id: "bgp-rp", summary: "Apply a route policy to updates sent", args: { rp: choiceArg(["SET-COLOR"], () => "Sets color 100 on 192.168.6.0/24"), d: choiceArg(["out"], () => "Outbound") }, xr: { mode: "bgp-nbr-af", syntax: "route-policy <rp> <d>", apply: (c) => ((c.colorOut = true), c), no: (c) => ((c.colorOut = false), c) } },
        ] as SpCfgStmt<SpRtr>[])
      : []),
  ];
}

// ---------------------------------------------------------------------------------------------------------------
// The command set
// ---------------------------------------------------------------------------------------------------------------
export function srpXrSpec(api: SrpCliApi, r: SpR): SpXrSpec<SpRtr> {
  const s = api.s;
  const sh = (id: string, syntax: string, summary: string, run: SpCmd["run"], args?: SpCmd["args"]): SpCmd => ({ id, syntax, summary, run, args });
  const nothing = (o: string, why: string) => o || { output: "", explanation: why };
  return {
    stmts: stmts(r, s),
    prompts: { config: "config", sr: "config-sr", te: "config-sr-te", amap: "config-sr-te-affinity-map", "te-if": "config-sr-if", "te-if-aff": "config-sr-if-affinity", sl: "config-sr-te-sl", pol: "config-sr-te-policy", cps: "config-sr-te-policy-path", pref: "config-sr-te-policy-path-pref", dyn: "config-sr-te-pp-info", dynm: "config-sr-te-path-metric", cons: "config-sr-te-path-pref-const", consaff: "config-sr-te-path-pref-const-aff", inc: "config-sr-te-path-pref-const-aff-inc", isis: "config-isis", "isis-af": "config-isis-af", "isis-if": "config-isis-if", "isis-if-af": "config-isis-if-af", bgp: "config-bgp", "bgp-nbr": "config-bgp-nbr", "bgp-nbr-af": "config-bgp-nbr-af" },
    lines: (c) => srpXrLines(r, c),
    help: { "show segment-routing": "Segment routing information", "show segment-routing traffic-eng": "SR-TE information", "show bgp": "BGP information", "show isis": "IS-IS information", "show mpls": "MPLS information", ping: "Send echo messages", "ping sr-mpls": "Segment routing MPLS echo", "ping sr-mpls nil-fec": "Nil FEC: impose a label stack" },
    shows: [
      sh("pol", "show segment-routing traffic-eng policy", "SR policies, candidate paths, segment lists, BSID", () => nothing(xrPolicies(s, r), "No SR policy on this router: R1 is the headend.")),
      sh("polc", "show segment-routing traffic-eng policy color <c>", "One color's policies", (a) => nothing(xrPolicies(s, r, +a.c), "No policy with that color here."), { c: colorArg }),
      sh("bgp", "show bgp ipv4 unicast", "The BGP table (C:100 marks a colored route steered into a policy)", () => xrBgp(s, r)),
      sh("bgpp", "show bgp ipv4 unicast <pfx>", "One BGP route: color, SR policy, BSID", (a) => xrBgpPfx(s, r, a.pfx), { pfx: pfxArg }),
      sh("cef", "show cef <pfx>", "How the router forwards a destination", (a) => xrCef(s, r, a.pfx), { pfx: pfxArg }),
      sh("fwd", "show mpls forwarding", "The label forwarding table (BSID included)", () => xrForwarding(s, r)),
      sh("fwdl", "show mpls forwarding labels <n>", "One label's entry", (a) => nothing(xrForwarding(s, r, +a.n), "No such local label."), { n: labelArg }),
      sh("lbl", "show isis segment-routing label table", "The Prefix-SID labels", () => nothing(xrLabelTable(s, r), "Segment routing is not enabled in IS-IS here.")),
      sh("adj", "show isis adjacency detail", "IS-IS adjacencies and their Adjacency SIDs", () => xrAdj(s, r)),
      sh("route", "show route <ip>", "The route to a loopback", (a) => xrRouteIp(s, r, a.ip), { ip: ipArg(SP_ROUTERS.map((x) => SP_LO[x]), "An address") }),
      sh("log", "show logging", "The syslog buffer", () => xrLogging(s, r)),
    ],
    exec: [
      sh("nilfec", "ping sr-mpls nil-fec labels <list> output interface <if> nexthop <ip>", "Send an MPLS echo with your own label stack", (a) => {
        const i = spIfs(r).find((x) => x.ifn === a.if)!;
        const head = [`Sending 5, 100-byte MPLS Echos with Nil FEC labels ${a.list},`, "      timeout is 2 seconds, send interval is 0 msec:", "", ...LSP_CODES, "", "Type escape sequence to abort.", ""];
        if (a.ip !== i.peerIp) return [...head, "QQQQQ", "Success rate is 0 percent (0/5)"].join("\n");
        const w = nilFecWalk(s, r, a.list.split(",").map(Number), a.if);
        return [...head, (w.ok ? "!" : ".").repeat(5), w.ok ? "Success rate is 100 percent (5/5), round-trip min/avg/max = 2/3/5 ms" : "Success rate is 0 percent (0/5)"].join("\n");
      }, { list: { choices: ["16003,24035,16006"], describe: () => "Labels, outermost first", resolve: (raw) => (/^\d{2,7}(,\d{2,7}){0,5}$/.test(raw) ? raw : undefined) }, if: xrIfArg(r), ip: ipArg(spIfs(r).map((i) => i.peerIp), "The neighbor on that interface") }),
    ],
  };
}
export function srpSets(api: SrpCliApi, r: SpR): Partial<Record<CliVendor, CliCommandSet>> {
  return { cisco: buildXrSet(api.dev, srpXrSpec(api, r)) };
}
export function srpStaticApi(s: SpState, r: SpR): SrpCliApi {
  return { s, act: () => s, dev: { host: r, running: s.cfg[r], hist: s.hist[r], setCand: () => undefined, xr: [], setXr: () => undefined, edit: false, setEdit: () => undefined, commit: () => undefined } };
}
export { SP_LINKS, spLinkIp };
