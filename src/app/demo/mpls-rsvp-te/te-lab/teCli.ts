import type { CliArgSpec, CliCommandSet, CliVendor } from "@/lib/cli/types";
import { buildJunosSet, buildXrSet, choiceArg, junosPipeConfig, numArg, type SpCfgStmt, type SpCmd, type SpDevCli, type SpJunosSpec, type SpXrSpec } from "@/components/sp-lab/spCli";
import { lpad, pad, spAge, spClone, spStamp, type JStmt } from "@/components/sp-lab/spKit";
import { jnIf, parseIf, xrIf } from "@/components/sp-lab/spNames";
import {
  AFFINITY,
  AFF_NAMES,
  CE_NET,
  CUSTB_NET,
  IMPLICIT_NULL,
  TE_LINKS,
  TE_LO,
  TE_ROUTERS,
  autorouted,
  dirKey,
  igpPaths,
  ifsOf,
  ipOn,
  linkUp,
  lspKey,
  lspOf,
  routeTo,
  routerByIp,
  tedDirs,
  unreserved,
  type IfName,
  type TeAction,
  type TeCfg,
  type TeHop,
  type TeLsp,
  type TeR,
  type TeState,
  type TeTunnel,
} from "@/lib/sim-engine/scenarios/teNet";

/**
 * Command lines of the RSVP-TE Lab — IOS XR or Junos on R1–R6. Every output is printed from the lab model: the TED,
 * CSPF results, LSPs with their EROs and labels, RSVP reservations, IS-IS routes and what autoroute / shortcuts do.
 *
 *   IOS XR  show mpls traffic-eng tunnels [brief | <n>] · show mpls traffic-eng topology [brief] · show rsvp session ·
 *           show rsvp interface · show explicit-paths · show mpls forwarding · show route [<ip>] · show logging ·
 *           ping / traceroute mpls traffic-eng tunnel-te <n> · show running-config [section]
 *           configure → interface tunnel-te<n> (destination, signalled-bandwidth, priority, path-option, affinity,
 *           autoroute announce, shutdown) · explicit-path name <name> → index <i> next-address strict|loose ipv4
 *           unicast <ip> · mpls traffic-eng → interface <if> (attribute-names, admin-weight) · rsvp → interface <if>
 *           (bandwidth) · interface <if> → shutdown · commit
 *   Junos   show mpls lsp [detail | extensive | name <lsp>] · show rsvp session · show rsvp interface ·
 *           show ted database [extensive] · show route <ip> · show log messages · ping / traceroute mpls rsvp <lsp>
 *           configure → set protocols mpls label-switched-path <lsp> to | bandwidth | priority | primary | secondary |
 *           admin-group include-all | exclude | disable · protocols mpls path <p> <ip> strict|loose · protocols mpls
 *           interface <if> [admin-group <g>] · protocols rsvp interface <if> bandwidth <bw> · protocols isis interface
 *           <if> level 2 te-metric <n> · protocols isis traffic-engineering shortcuts · interfaces <if> disable · commit
 */

export interface TeCliApi {
  s: TeState;
  act: (a: TeAction) => TeState;
  dev: SpDevCli<TeCfg>;
}

// ---------------------------------------------------------------------------------------------------------------
// Arguments and formatting
// ---------------------------------------------------------------------------------------------------------------
const ipRe = /^(\d{1,3}\.){3}\d{1,3}$/;
const anyIp = (choices: string[], what: string): CliArgSpec => ({ choices, describe: (c) => routerByIp(c) ?? what, resolve: (raw) => (ipRe.test(raw) && raw.split(".").every((o) => +o <= 255) ? raw : undefined) });
const loArg = anyIp(Object.values(TE_LO), "TE router ID");
const destArg: CliArgSpec = { choices: [...Object.values(TE_LO), CE_NET.CE6.host, CE_NET.CE1.host], describe: (c) => routerByIp(c) ?? "Destination", resolve: (raw) => (ipRe.test(raw) ? raw : /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/.test(raw) ? raw.split("/")[0] : undefined) };
const physIfs = (r: TeR) => ifsOf(r).map((x) => x.ifn);
const pifArg = (r: TeR, junos: boolean): CliArgSpec => ({ choices: physIfs(r).map((i) => (junos ? jnIf(i) : xrIf(i))), describe: (c) => {
  const i = ifsOf(r).find((x) => x.ifn === parseIf(c));
  return i ? `to ${i.peer}` : "Interface";
}, resolve: (raw) => {
  const i = parseIf(raw);
  return i && physIfs(r).includes(i as IfName) ? i : undefined;
} });
const tifArg: CliArgSpec = { choices: ["tunnel-te1"], describe: () => "MPLS-TE tunnel interface", resolve: (raw) => {
  const m = /^tunnel-te(\d{1,5})$/i.exec(raw);
  return m && +m[1] >= 1 && +m[1] <= 65535 ? String(+m[1]) : undefined;
} };
const tidArg = (s: TeState, r: TeR): CliArgSpec => ({ choices: s.cfg[r].tunnels.map((t) => String(t.id)), describe: () => "Tunnel number", resolve: (raw) => (/^\d{1,5}$/.test(raw) ? String(+raw) : undefined) });
const nameArg = (choices: string[], what: string): CliArgSpec => ({ choices, describe: () => what, resolve: (raw) => (/^[A-Za-z][\w-]{0,31}$/.test(raw) ? raw : undefined) });
const affArg: CliArgSpec = { choices: AFF_NAMES, describe: (c) => `bit ${AFFINITY[c]}`, resolve: (raw) => AFF_NAMES.find((x) => x === raw.toUpperCase()) };
const kbpsArg: CliArgSpec = { choices: ["500000", "200000", "1000000"], describe: () => "Bandwidth in kbps", resolve: (raw) => (/^\d{1,8}$/.test(raw) && +raw <= 10000000 ? String(+raw) : undefined) };
const jbwArg: CliArgSpec = { choices: ["500m", "200m", "1g"], describe: () => "Bandwidth (bps, with k / m / g)", resolve: (raw) => {
  const m = /^(\d+)([kmg]?)$/i.exec(raw);
  if (!m) return undefined;
  const bps = +m[1] * ({ "": 1, k: 1e3, m: 1e6, g: 1e9 } as Record<string, number>)[m[2].toLowerCase()];
  return bps >= 1000 && bps <= 1e10 ? String(Math.round(bps / 1000)) : undefined;
} };
const prioArg = numArg(0, 7, ["7", "3", "0"], "Priority (0 = best, 7 = worst)");
const fmtJbw = (kbps: number) => (kbps % 1000000 === 0 ? `${kbps / 1000000}g` : kbps % 1000 === 0 ? `${kbps / 1000}m` : `${kbps}k`);
const fmtBps = (kbps: number) => (kbps >= 1000000 && kbps % 1000000 === 0 ? `${kbps / 1000000}Gbps` : kbps >= 1000 ? `${Math.round(kbps / 1000)}Mbps` : kbps > 0 ? `${kbps}kbps` : "0bps");
const fmtXrBps = (kbps: number) => (kbps >= 1000000 && kbps % 1000000 === 0 ? `${kbps / 1000000}G` : kbps >= 1000 ? `${Math.round(kbps / 1000)}M` : kbps > 0 ? `${kbps}K` : "0");
const sigName = (l: TeLsp) => `${l.head}_t${l.id}`;
const affMask = (names: string[]) => names.reduce((a, n) => a | (1 << AFFINITY[n]), 0);
const hex = (n: number) => `0x${n.toString(16)}`;
const ifNameOn = (r: TeR, peer: TeR) => ifsOf(r).find((x) => x.peer === peer)!.ifn;
const isisMetric = (r: TeR, to: TeR, c: TeState["cfg"]) => (igpPaths(c, r)[to]?.cost ?? 0) + 10;
const destRouter = (raw: string): { r: TeR; prefix: string } | undefined => {
  const lo = routerByIp(raw);
  if (lo && TE_LO[lo] === raw) return { r: lo, prefix: `${raw}/32` };
  for (const ce of Object.values(CE_NET)) if (raw.startsWith(ce.net.split(".").slice(0, 3).join("."))) return { r: ce.r, prefix: ce.net };
  if (raw.startsWith("10.5.5.")) return { r: "R5", prefix: CUSTB_NET };
  return undefined;
};
/** LSPs that cross router r (head, mid or tail). */
const lspsAt = (s: TeState, r: TeR) => s.view.lsps.filter((l) => l.state === "up" && l.path?.includes(r));

// ---------------------------------------------------------------------------------------------------------------
// IOS XR outputs
// ---------------------------------------------------------------------------------------------------------------
function xrTunnelsBrief(s: TeState, r: TeR): string {
  const heads = s.view.lsps.filter((l) => l.head === r);
  const mids = lspsAt(s, r).filter((l) => l.head !== r && l.tail !== r);
  const tails = lspsAt(s, r).filter((l) => l.tail === r);
  const row = (name: string, dst: string, st: string, state: string) => `${lpad(name, 32)}${lpad(dst, 20)}${lpad(st, 12)}  ${state}`;
  return [
    `${lpad("TUNNEL NAME", 32)}${lpad("DESTINATION", 20)}${lpad("STATUS", 12)}  STATE`,
    ...heads.map((l) => row(`tunnel-te${l.id}`, s.cfg[r].tunnels.find((t) => t.id === l.id)!.dst || "0.0.0.0", l.state === "admin-down" ? "admin-down" : "up", l.state === "up" ? "up" : "down")),
    ...mids.map((l) => row(sigName(l), TE_LO[l.tail!], "", "up")),
    ...tails.map((l) => row(sigName(l), TE_LO[r], "", "up")),
    `Displayed ${heads.length} (of ${heads.length}) heads, ${mids.length} (of ${mids.length}) midpoints, ${tails.length} (of ${tails.length}) tails`,
    `Displayed ${heads.filter((l) => l.state === "up").length} up, ${heads.filter((l) => l.state !== "up").length} down, 0 recovering, 0 recovered heads`,
  ].join("\n");
}
function xrTunnelDetail(s: TeState, r: TeR, l: TeLsp): string[] {
  const t = s.cfg[r].tunnels.find((x) => x.id === l.id)!;
  const up = l.state === "up";
  const since = s.since[l.key] ?? s.clock;
  const out = [
    `Name: tunnel-te${t.id}  Destination: ${t.dst || "0.0.0.0"}  Ifhandle:0x${(0x8000 + t.id * 0x20).toString(16)}`,
    `  Signalled-Name: ${sigName(l)}`,
    "  Status:",
    `    Admin: ${t.shut ? " down" : "   up"} Oper: ${up ? "  up" : "down"}   Path: ${up ? " valid" : "not valid"}   Signalling: ${up ? "connected" : "Down"}`,
    "",
  ];
  for (const o of [...t.opts].sort((a, b) => a.idx - b.idx)) {
    const used = up && l.opt === o.idx;
    out.push(`    path option ${o.idx},  type ${o.kind === "dynamic" ? "dynamic" : `explicit ${o.path}`}${used ? ` (Basis for Setup, path weight ${pathWeight(s, l.path!)})` : ""}`);
    const tr = l.tried.find((x) => x.idx === o.idx && !x.ok);
    if (tr || (!up && !t.shut)) out.push(`      Last PCALC Error: ${spStamp(s.clock).xr.replace(" UTC", "")}`, `        Info: ${pcalcInfo(tr?.detail ?? l.why ?? "", t)}`);
  }
  if (l.resizeFailed) out.push(`    Reoptimization: requested bandwidth ${t.bw} kbps could not be signaled (${l.resizeFailed}); current LSP keeps ${l.bw} kbps`);
  out.push(`    G-PID: 0x0800 (derived from egress interface properties)`, `    Bandwidth Requested: ${l.bw} kbps  CT0`, `    Creation Time: ${spStamp(40).xr.replace(" UTC", "")}`);
  out.push(
    "  Config Parameters:",
    `    Bandwidth:   ${t.bw} kbps (CT0) Priority:  ${t.setup}  ${t.hold} Affinity: ${hex(affMask(t.include))}/${hex(affMask([...t.include, ...t.exclude]) || 0xffff)}`,
    ...(t.include.length || t.exclude.length ? [`    Affinity: ${[...t.include.map((x) => `include ${x}`), ...t.exclude.map((x) => `exclude ${x}`)].join(", ")}`] : []),
    "    Metric Type: TE (global)",
    `    AutoRoute: ${autorouted(s.cfg[r], t) ? " enabled" : "disabled"}  LockDown: disabled   Policy class: not set`,
    "    Fast Reroute: Disabled, Protection Desired: None",
  );
  if (up) {
    const p = l.path!;
    out.push(
      "  History:",
      `    Tunnel has been up for: ${spAge(s.clock, since)} (since ${spStamp(since).xr.replace(" UTC", "")})`,
      "  Current LSP Info:",
      "    Instance: 2, Signaling Area: IS-IS CORE level-2",
      `    Uptime: ${spAge(s.clock, since)} (since ${spStamp(since).xr.replace(" UTC", "")})`,
      `    Outgoing Interface: ${xrIf(ifNameOn(r, p[1]))}, Outgoing Label: ${l.labels[p[1]] === IMPLICIT_NULL ? "implicit-null" : l.labels[p[1]]}`,
      `    Router-IDs: local      ${TE_LO[r]}`,
      `                downstream ${TE_LO[p[1]]}`,
      "    Path Info:",
      "      Outgoing:",
      "        Explicit Route:",
      ...p.slice(1).map((x, i) => `          Strict, ${ipOn(x, p[i])}`),
      `          Strict, ${TE_LO[p[p.length - 1]]}`,
      `      Tspec: avg rate=${l.bw} kbits, burst=1000 bytes, peak rate=${l.bw} kbits`,
      "    Resv Info:",
      "      Record Route:",
      ...p.slice(1).map((x) => `        IPv4 ${TE_LO[x]}, flags 0x20 (Node-ID)`),
      `      Fspec: avg rate=${l.bw} kbits, burst=1000 bytes, peak rate=${l.bw} kbits`,
    );
  }
  return out;
}
function pcalcInfo(detail: string, t: TeTunnel) {
  if (/strict hop|not defined|not an address/.test(detail)) return `Explicit path cannot be satisfied: ${detail}`;
  return `No path to destination, ${t.dst} (${t.include.length || t.exclude.length ? "bw or affinity" : "bw"})`;
}
const pathWeight = (s: TeState, p: TeR[]) => p.slice(1).reduce((a, x, i) => a + (tedDirs(s.cfg).find((d) => d.from === p[i] && d.to === x)?.teMetric ?? 0), 0);
function xrTunnels(s: TeState, r: TeR, id?: string): string {
  const heads = s.view.lsps.filter((l) => l.head === r && (!id || String(l.id) === id));
  if (id && !heads.length) return `Tunnel tunnel-te${id} not found`;
  const mids = id ? [] : lspsAt(s, r).filter((l) => l.head !== r);
  return [
    ...heads.flatMap((l) => [...xrTunnelDetail(s, r, l), ""]),
    ...mids.flatMap((l) => {
      const t = s.cfg[l.head].tunnels.find((x) => x.id === l.id)!;
      const i = l.path!.indexOf(r);
      const tail = l.tail === r;
      return [`LSP Tunnel ${TE_LO[l.head]} ${l.id} [2] is signalled, Signaling State: up`, `  Tunnel Name: ${sigName(l)}  Tunnel Role: ${tail ? "Tail" : "Mid"}`, `  InLabel: ${xrIf(ifNameOn(r, l.path![i - 1]))}, ${l.labels[r] === IMPLICIT_NULL ? "implicit-null" : l.labels[r]}`, ...(tail ? [] : [`  OutLabel: ${xrIf(ifNameOn(r, l.path![i + 1]))}, ${l.labels[l.path![i + 1]] === IMPLICIT_NULL ? "implicit-null" : l.labels[l.path![i + 1]]}`]), `  Signalling Info:`, `    Src ${TE_LO[l.head]} Dst ${TE_LO[l.tail!]}, Tun ID ${l.id}, Tun Inst 2, Ext ID ${TE_LO[l.head]}`, `    Router-IDs: upstream   ${TE_LO[l.path![i - 1]]}`, ...(tail ? [] : [`                downstream ${TE_LO[l.path![i + 1]]}`]), `    Bandwidth: ${l.bw} kbps (CT0) Priority: ${t.setup} ${t.hold} DSTE-class: match`, ""];
    }),
    `Displayed ${heads.length} (of ${heads.length}) heads, ${mids.filter((l) => l.tail !== r).length} (of ${mids.filter((l) => l.tail !== r).length}) midpoints, ${mids.filter((l) => l.tail === r).length} (of ${mids.filter((l) => l.tail === r).length}) tails`,
    `Displayed ${heads.filter((l) => l.state === "up").length} up, ${heads.filter((l) => l.state !== "up").length} down, 0 recovering, 0 recovered heads`,
  ].join("\n");
}
function xrTopology(s: TeState, r: TeR, brief: boolean): string {
  const dirs = tedDirs(s.cfg).filter((d) => d.inTed);
  const out = [`My_System_id: ${TE_LO[r]} (IS-IS CORE level-2)`, "My_BC_Model_Type: RDM", "", "Signalling error holddown: 10 sec Global Link Generation 45", ""];
  for (const n of TE_ROUTERS) {
    if (!s.cfg[n].isisTe) continue;
    const mine = dirs.filter((d) => d.from === n);
    out.push(`IGP Id: 0000.0000.000${TE_ROUTERS.indexOf(n) + 1}.00, MPLS TE Id: ${TE_LO[n]} Router Node  (IS-IS CORE level-2)`, "");
    mine.forEach((d, k) => {
      out.push(
        `  Link[${k}]:Point-to-Point, Nbr IGP Id:0000.0000.000${TE_ROUTERS.indexOf(d.to) + 1}.00, Nbr Node Id:${TE_ROUTERS.indexOf(d.to) + 1}, gen:45`,
        `      Frag Id:0, Intf Address:${d.ip}, Intf Id:0`,
        `      Nbr Intf Address:${ipOn(d.to, d.from)}, Nbr Intf Id:0`,
        `      TE Metric:${d.teMetric}, IGP Metric:${d.link.metric}, Attribute Flags:${hex(affMask(d.attr))}`,
        `      Attribute Names: ${d.attr.join(" ")}`,
      );
      if (!brief)
        out.push(
          "      BC Model ID:RDM",
          `      Physical BW:1000000 (kbps), Max Reservable BW Global:${d.maxRes} (kbps)`,
          "      Max Reservable BW Sub:0 (kbps)",
          "                             Global Pool       Sub Pool",
          "               Total Allocated   Reservable        Reservable",
          "               BW (kbps)         BW (kbps)         BW (kbps)",
          "               ---------------   -----------       ----------",
          ...[0, 1, 2, 3, 4, 5, 6, 7].map((p) => `        bw[${p}]:${lpad(d.maxRes - unreserved(d, s.view.resv, p), 13)}${lpad(unreserved(d, s.view.resv, p), 17)}${lpad(0, 17)}`),
        );
      else out.push(`      Max Reservable BW Global:${d.maxRes} (kbps), Unreserved BW at priority 7:${unreserved(d, s.view.resv, 7)} (kbps)`);
      out.push("");
    });
  }
  return out.join("\n");
}
function xrRsvpSession(s: TeState, r: TeR): string {
  const ls = lspsAt(s, r);
  return ["Type Destination Add DPort  Proto/ExtTunID  PSBs  RSBs  Reqs", "---- --------------- ----- --------------- ----- ----- -----", ...ls.map((l) => `LSP4 ${lpad(TE_LO[l.tail!], 15)} ${lpad(l.id, 5)} ${lpad(TE_LO[l.head], 15)} ${lpad(1, 5)} ${lpad(1, 5)} ${lpad(l.head === r ? 0 : 1, 5)}`)].join("\n");
}
function allocatedOn(s: TeState, r: TeR, ifn: IfName) {
  const peer = ifsOf(r).find((x) => x.ifn === ifn)!.peer;
  return s.view.resv.filter((x) => x.key === dirKey(r, peer)).reduce((a, x) => a + x.bw, 0);
}
function xrRsvpIf(s: TeState, r: TeR): string {
  const rows = ifsOf(r).filter((x) => s.cfg[r].ifs[x.ifn].rsvp !== undefined).map((x) => {
    const max = s.cfg[r].ifs[x.ifn].rsvp!;
    const al = allocatedOn(s, r, x.ifn);
    return `${pad(xrIf(x.ifn), 25)} ${lpad(fmtXrBps(max), 12)} ${lpad(fmtXrBps(max), 13)} ${lpad(`${fmtXrBps(al)} (${lpad(max ? Math.round((al / max) * 100) : 0, 3)}%)`, 20)} ${lpad(0, 13)}`;
  });
  return ["*: RDM: Default I/F B/W % : 75% [default] (max resv/bc0), 0% [default] (bc1)", "", "Interface                 MaxBW (bps)  MaxFlow (bps) Allocated (bps)      MaxSub (bps)", "------------------------- ------------ ------------- -------------------- -------------", ...rows].join("\n");
}
function xrExplicit(s: TeState, r: TeR): string {
  const ps = Object.entries(s.cfg[r].paths);
  if (!ps.length) return "";
  return ps.flatMap(([n, hops]) => [`Path ${n} status: Enabled`, ...[...hops].sort((a, b) => a.idx - b.idx).map((h) => `${lpad(h.idx, 4)}: next-address ${h.ip} type ${h.strict ? "strict" : "loose"}`), ""]).join("\n");
}
function xrForwarding(s: TeState, r: TeR): string {
  const rows = lspsAt(s, r).filter((l) => l.head !== r).flatMap((l) => {
    const i = l.path!.indexOf(r);
    const inLab = l.labels[r]!;
    if (inLab === IMPLICIT_NULL) return [];
    const nx = l.path![i + 1];
    const out = l.labels[nx] === IMPLICIT_NULL ? "Pop" : String(l.labels[nx]);
    return [`${pad(inLab, 7)}${pad(out, 12)}${pad(`${TE_LO[l.head]} ${l.id} [2]`, 19)}${pad(xrIf(ifNameOn(r, nx), true), 13)}${pad(ipOn(nx, r), 16)}${0}`];
  });
  return ["Local  Outgoing    Prefix             Outgoing     Next Hop        Bytes", "Label  Label       or ID              Interface                    Switched", "------ ----------- ------------------ ------------ --------------- ------------", ...rows].join("\n");
}
function xrRouteEntry(s: TeState, r: TeR, raw: string): string {
  const d = destRouter(raw);
  if (!d) return "% Network not in table";
  if (d.r === r) {
    const ce = Object.values(CE_NET).find((x) => x.r === r && x.net === d.prefix);
    return [`Routing entry for ${d.prefix}`, `  Known via "${ce ? "connected" : "local"}", distance 0, metric 0 (connected)`, `  Installed ${spStamp(30).xr.replace(" UTC", "")} for ${spAge(s.clock, 30)}`, "  Routing Descriptor Blocks", `    directly connected, via ${ce ? xrIf(ce.ifn) : "Loopback0"}`, "      Route metric is 0", "  No advertising protos."].join("\n");
  }
  const rt = routeTo(s.cfg, s.view, r, d.r);
  if (!rt) return "% Network not in table";
  const metric = isisMetric(r, d.r, s.cfg);
  const via = rt.via === "tunnel" ? `${TE_LO[d.r]}, from ${TE_LO[d.r]}, via tunnel-te${rt.tunnel!.id}` : `${ipOn(rt.path[1], r)}, from ${TE_LO[d.r]}, via ${xrIf(ifNameOn(r, rt.path[1]))}`;
  return [`Routing entry for ${d.prefix}`, `  Known via "isis CORE", distance 115, metric ${metric}, type level-2`, `  Installed ${spStamp(40).xr.replace(" UTC", "")} for ${spAge(s.clock, 40)}`, "  Routing Descriptor Blocks", `    ${via}`, `      Route metric is ${metric}`, "  No advertising protos."].join("\n");
}
const ipNum = (p: string) => p.split("/")[0].split(".").reduce((a, o) => a * 256 + +o, 0);
function xrRouteAll(s: TeState, r: TeR): string {
  const head = ["Codes: C - connected, S - static, R - RIP, B - BGP, (>) - Diversion path", "       O - OSPF, IA - OSPF inter area, i - ISIS, L1 - IS-IS level-1, L2 - IS-IS level-2", "       L - local, t - Traffic Engineering, ia - IS-IS inter area", "", "Gateway of last resort is not set", ""];
  const rows: string[] = [];
  for (const n of TE_ROUTERS) {
    const prefixes = [`${TE_LO[n]}/32`, ...Object.values(CE_NET).filter((x) => x.r === n).map((x) => x.net), ...(n === "R5" ? [CUSTB_NET] : [])];
    for (const p of prefixes) {
      if (n === r) {
        rows.push(p.endsWith("/32") ? `L    ${pad(p, 18)} is directly connected, ${spAge(s.clock, 30)}, Loopback0` : `C    ${pad(p, 18)} is directly connected, ${spAge(s.clock, 30)}, ${xrIf(Object.values(CE_NET).find((x) => x.net === p)?.ifn ?? "ge-0/0/2")}`);
        continue;
      }
      const rt = routeTo(s.cfg, s.view, r, n);
      if (!rt) continue;
      rows.push(`i L2 ${pad(p, 18)} [115/${isisMetric(r, n, s.cfg)}] via ${rt.via === "tunnel" ? TE_LO[n] : ipOn(rt.path[1], r)}, ${spAge(s.clock, 40)}, ${rt.via === "tunnel" ? `tunnel-te${rt.tunnel!.id}` : xrIf(ifNameOn(r, rt.path[1]))}`);
    }
  }
  return [...head, ...rows.sort((x, y) => ipNum(x.slice(5).trim()) - ipNum(y.slice(5).trim()))].join("\n");
}
function xrPingTe(s: TeState, r: TeR, id: string, trace: boolean): string {
  const l = s.view.lsps.find((x) => x.head === r && String(x.id) === id);
  const t = s.cfg[r].tunnels.find((x) => String(x.id) === id);
  if (!t || !l) return `% tunnel-te${id} does not exist`;
  if (l.state !== "up") return trace ? `Tracing MPLS TE Label Switched Path on tunnel-te${id}, timeout is 2 seconds\n\n% tunnel-te${id} is down` : ["Sending 5, 100-byte MPLS Echos to tunnel-te" + id + ",", "      timeout is 2 seconds, send interval is 0 msec:", "", "Codes: '!' - success, 'Q' - request not sent, '.' - timeout,", "  'L' - labeled output interface, 'B' - unlabeled output interface,", "  'D' - DS Map mismatch, 'F' - no FEC mapping, 'f' - FEC mismatch,", "  'M' - malformed request, 'm' - unsupported tlvs, 'N' - no rx label,", "  'P' - no rx intf label prot, 'p' - premature termination of LSP,", "  'R' - transit router, 'I' - unknown upstream index,", "  'X' - unknown return code, 'x' - return code 0", "", "Type escape sequence to abort.", "", "QQQQQ", "Success rate is 0 percent (0/5)"].join("\n");
  const p = l.path!;
  if (!trace) return [`Sending 5, 100-byte MPLS Echos to tunnel-te${id},`, "      timeout is 2 seconds, send interval is 0 msec:", "", "Codes: '!' - success, 'Q' - request not sent, '.' - timeout,", "  'L' - labeled output interface, 'B' - unlabeled output interface,", "  'R' - transit router, 'I' - unknown upstream index,", "", "Type escape sequence to abort.", "", "!!!!!", "Success rate is 100 percent (5/5), round-trip min/avg/max = 2/3/5 ms"].join("\n");
  return [`Tracing MPLS TE Label Switched Path on tunnel-te${id}, timeout is 2 seconds`, "", "Codes: '!' - success, 'Q' - request not sent, '.' - timeout,", "  'L' - labeled output interface, 'B' - unlabeled output interface,", "  'R' - transit router, 'I' - unknown upstream index,", "", "Type escape sequence to abort.", "", `  0 ${ipOn(r, p[1])} MRU 1500 [Labels: ${l.labels[p[1]] === IMPLICIT_NULL ? "implicit-null" : l.labels[p[1]]} Exp: 0]`, ...p.slice(1).map((x, i) => {
    const last = i === p.length - 2;
    const nx = p[i + 2];
    return `${last ? "!" : "L"} ${i + 1} ${ipOn(x, p[i])}${last ? ` ${i + 2} ms` : ` MRU 1500 [Labels: ${l.labels[nx] === IMPLICIT_NULL ? "implicit-null" : l.labels[nx]} Exp: 0] ${i + 2} ms`}`;
  })].join("\n");
}
function xrLogging(s: TeState, r: TeR): string {
  const lines = s.sys.filter((x) => x.dev === r).slice(-30).map((x) => {
    const st = `RP/0/RP0/CPU0:${spStamp(x.t).xr}`;
    const t = s.cfg[r].tunnels.find((y) => y.name === x.what);
    const ifn = t ? `tunnel-te${t.id}` : x.what;
    if (x.kind === "up") return `${st}: ifmgr[215]: %PKT_INFRA-LINEPROTO-5-UPDOWN : Line protocol on Interface ${ifn}, changed state to Up`;
    if (x.kind === "down") return `${st}: ifmgr[215]: %PKT_INFRA-LINEPROTO-5-UPDOWN : Line protocol on Interface ${ifn}, changed state to Down`;
    if (x.kind === "preempt") return `${st}: te_control[1197]: %ROUTING-MPLS_TE-5-LSP_PREEMPT : ${ifn} LSP preempted by ${x.why}`;
    return `${st}: config[65857]: %MGBL-CONFIG-6-DB_COMMIT : Configuration committed by user 'admin'. Use 'show commit changes ${1000000000 + x.t}' to view the changes.`;
  });
  return ["Syslog logging: enabled (0 messages dropped, 0 flushes, 0 overruns)", `    Buffer logging: level debugging, ${lines.length} messages logged`, "", "Log Buffer (2097152 bytes):", "", ...lines].join("\n");
}

// ---------------------------------------------------------------------------------------------------------------
// Junos outputs
// ---------------------------------------------------------------------------------------------------------------
function jnLsp(s: TeState, r: TeR, mode: "brief" | "detail" | "extensive", name?: string): string {
  const heads = s.view.lsps.filter((l) => l.head === r && (!name || l.name === name));
  if (name && !heads.length) return "";
  const egress = name ? [] : lspsAt(s, r).filter((l) => l.tail === r);
  const transit = name ? [] : lspsAt(s, r).filter((l) => l.head !== r && l.tail !== r);
  const st = (l: TeLsp) => (l.state === "up" ? "Up" : "Dn");
  const head = (title: string, n: number) => `${title} LSP: ${n} sessions`;
  const tail = (ls: TeLsp[], up: (l: TeLsp) => boolean) => `Total ${ls.length} displayed, Up ${ls.filter(up).length}, Down ${ls.filter((l) => !up(l)).length}`;
  if (mode === "brief") {
    return [
      head("Ingress", heads.length),
      ...(heads.length ? ["To              From            State Rt P     ActivePath       LSPname"] : []),
      ...heads.map((l) => `${pad(s.cfg[r].tunnels.find((t) => t.id === l.id)!.dst, 16)}${pad(TE_LO[r], 16)}${pad(st(l), 6)}${lpad(0, 2)} ${l.state === "up" ? "*" : " "}     ${pad(l.state === "up" ? activePath(s, r, l) : "", 17)}${l.name}`),
      tail(heads, (l) => l.state === "up"),
      "",
      head("Egress", egress.length),
      ...(egress.length ? ["To              From            State   Rt Style Labelin Labelout LSPname", ...egress.map((l) => `${pad(TE_LO[r], 16)}${pad(TE_LO[l.head], 16)}Up      ${lpad(0, 2)}  1 FF ${lpad(3, 7)} ${lpad("-", 8)} ${l.name}`)] : []),
      tail(egress, () => true),
      "",
      head("Transit", transit.length),
      ...(transit.length ? ["To              From            State   Rt Style Labelin Labelout LSPname", ...transit.map((l) => {
        const i = l.path!.indexOf(r);
        const out = l.labels[l.path![i + 1]]!;
        return `${pad(TE_LO[l.tail!], 16)}${pad(TE_LO[l.head], 16)}Up      ${lpad(0, 2)}  1 FF ${lpad(l.labels[r]!, 7)} ${lpad(out, 8)} ${l.name}`;
      })] : []),
      tail(transit, () => true),
    ].join("\n");
  }
  const out = [head("Ingress", heads.length), ""];
  for (const l of heads) {
    const t = s.cfg[r].tunnels.find((x) => x.id === l.id)!;
    const up = l.state === "up";
    const primary = t.opts.slice().sort((a, b) => a.idx - b.idx);
    out.push(t.dst, `  From: ${TE_LO[r]}, State: ${up ? "Up" : "Dn"}, ActiveRoute: 0, LSPname: ${l.name}`, `  ActivePath: ${up ? activePath(s, r, l) : "(none)"}`, "  LSPtype: Static Configured, Penultimate hop popping", "  LoadBalance: Random", "  Encoding type: Packet, Switching type: Packet, GPID: IPv4");
    primary.forEach((o, k) => {
      const isActive = up && l.opt === o.idx;
      const label = k === 0 ? "Primary" : "Secondary";
      out.push(` ${isActive ? "*" : " "}${pad(`${label}   ${o.kind === "explicit" ? o.path : primary.length > 1 ? "DYNAMIC" : ""}`, 26)} State: ${isActive ? "Up" : up ? "Dn" : "Dn"}`);
      out.push(`    Priorities: ${t.setup} ${t.hold}`, `    Bandwidth: ${fmtBps(l.bw)}`);
      if (t.include.length) out.push(`    Include All: ${t.include.join(" ")}`);
      if (t.exclude.length) out.push(`    Exclude: ${t.exclude.join(" ")}`);
      if (isActive) {
        const p = l.path!;
        out.push(`    Computed ERO (S [L] denotes strict [loose] hops): (CSPF metric: ${pathWeight(s, p)})`, ` ${p.slice(1).map((x, i) => `${ipOn(x, p[i])} S`).join(" ")}`, "    Received RRO (ProtectionFlag 1=Available 2=InUse 4=B/W 8=Node 10=SoftPreempt 20=Node-ID):", `          ${p.slice(1).map((x, i) => ipOn(x, p[i])).join(" ")}`);
        if (l.resizeFailed) out.push(`    Bandwidth change to ${fmtBps(t.bw)} pending: CSPF failed: no route toward ${t.dst}`);
      } else if (!t.shut) {
        out.push(`    Will be enqueued for recomputation in 28 second(s).`);
        if (mode === "extensive") out.push(`   1 ${spStamp(s.clock).junos} CSPF: could not determine self`, `   2 ${spStamp(s.clock).junos} CSPF failed: no route toward ${t.dst}${/strict hop/.test(l.tried.find((x) => x.idx === o.idx)?.detail ?? "") ? " (explicit path)" : ""}`);
        else out.push(`    CSPF failed: no route toward ${t.dst}`);
      }
    });
    out.push("");
  }
  out.push(tail(heads, (l) => l.state === "up"));
  return out.join("\n");
}
function activePath(s: TeState, r: TeR, l: TeLsp) {
  const t = s.cfg[r].tunnels.find((x) => x.id === l.id)!;
  const sorted = t.opts.slice().sort((a, b) => a.idx - b.idx);
  const k = sorted.findIndex((o) => o.idx === l.opt);
  const o = sorted[k];
  return `${o?.kind === "explicit" ? o.path : sorted.length > 1 ? "DYNAMIC" : ""} (${k <= 0 ? "primary" : "secondary"})`;
}
function jnRsvpSession(s: TeState, r: TeR): string {
  const ls = lspsAt(s, r);
  const ing = ls.filter((l) => l.head === r);
  const eg = ls.filter((l) => l.tail === r);
  const tr = ls.filter((l) => l.head !== r && l.tail !== r);
  const row = (l: TeLsp, inL: string, outL: string) => `${pad(TE_LO[l.tail!], 16)}${pad(TE_LO[l.head], 16)}Up      ${lpad(0, 2)}  1 FF ${lpad(inL, 7)} ${lpad(outL, 8)} ${l.name}`;
  const hdr = "To              From            State   Rt Style Labelin Labelout LSPname";
  const sect = (title: string, xs: TeLsp[], f: (l: TeLsp) => string) => [`${title} RSVP: ${xs.length} sessions`, ...(xs.length ? [hdr, ...xs.map(f)] : []), `Total ${xs.length} displayed, Up ${xs.length}, Down 0`, ""];
  return [
    ...sect("Ingress", ing, (l) => row(l, "-", String(l.labels[l.path![1]] ?? "-"))),
    ...sect("Egress", eg, (l) => row(l, "3", "-")),
    ...sect("Transit", tr, (l) => {
      const i = l.path!.indexOf(r);
      return row(l, String(l.labels[r]), String(l.labels[l.path![i + 1]]));
    }),
  ].join("\n").trimEnd();
}
function jnRsvpIf(s: TeState, r: TeR): string {
  const rows = ifsOf(r).filter((x) => s.cfg[r].ifs[x.ifn].rsvp !== undefined).map((x) => {
    const max = s.cfg[r].ifs[x.ifn].rsvp!;
    const al = allocatedOn(s, r, x.ifn);
    const n = lspsAt(s, r).filter((l) => l.path![l.path!.indexOf(r) + 1] === x.peer).length;
    return `${pad(jnIf(x.ifn), 19)}${pad(linkUp(s.cfg, x.link) ? "Up" : "Dn", 7)}${lpad(n, 4)}   100%   ${pad(fmtBps(max), 12)}${pad(fmtBps(max - al), 12)}${pad(fmtBps(al), 12)}${fmtBps(al)}`;
  });
  return [`RSVP interface: ${rows.length} active`, "                          Active  Subscr- Static      Available   Reserved    Highwater", "Interface          State  resv    iption  BW          BW          BW          mark", ...rows].join("\n");
}
function jnTed(s: TeState, r: TeR, ext: boolean): string {
  const dirs = tedDirs(s.cfg).filter((d) => d.inTed);
  const out = [`TED database: ${TE_ROUTERS.filter((n) => s.cfg[n].isisTe).length} ISIS nodes ${TE_ROUTERS.filter((n) => s.cfg[n].isisTe).length} INET nodes`, "ID                            Type Age(s) LnkIn LnkOut Protocol"];
  for (const n of TE_ROUTERS) {
    if (!s.cfg[n].isisTe) continue;
    const mine = dirs.filter((d) => d.from === n);
    const ins = dirs.filter((d) => d.to === n);
    out.push(`${pad(`${n}.00(${TE_LO[n]})`, 30)}Rtr  ${lpad(300 + TE_ROUTERS.indexOf(n) * 37, 5)} ${lpad(ins.length, 5)} ${lpad(mine.length, 6)} IS-IS(2)`);
    for (const d of mine) {
      out.push(`    To: ${d.to}.00(${TE_LO[d.to]}), Local: ${d.ip}, Remote: ${ipOn(d.to, d.from)}`);
      if (ext) {
        const un = [0, 1, 2, 3, 4, 5, 6, 7].map((p) => `[${p}] ${pad(fmtBps(unreserved(d, s.view.resv, p)), 12)}`);
        out.push("      Local interface index: 0, Remote interface index: 0", `      Color: ${hex(affMask(d.attr))} ${d.attr.join(" ")}`, `      Metric: ${d.teMetric}`, "      Static BW: 1000Mbps", `      Reservable BW: ${fmtBps(d.maxRes)}`, "      Available BW [priority] bps:", `          ${un.slice(0, 4).join(" ")}`, `          ${un.slice(4).join(" ")}`);
      }
    }
  }
  return out.join("\n");
}
function jnRoute(s: TeState, r: TeR, raw: string): string {
  const d = destRouter(raw);
  if (!d) return "";
  const head = ["", "inet.0: 16 destinations, 16 routes (16 active, 0 holddown, 0 hidden)", "+ = Active Route, - = Last Active, * = Both", ""];
  if (d.r === r) {
    const ce = Object.values(CE_NET).find((x) => x.r === r && x.net === d.prefix);
    return [...head, `${pad(d.prefix, 19)}*[${ce ? "Direct/0" : "Direct/0"}] ${spAge(s.clock, 30)}`, `                    >  via ${ce ? jnIf(ce.ifn) : "lo0.0"}`].join("\n");
  }
  const rt = routeTo(s.cfg, s.view, r, d.r);
  if (!rt) return "";
  const nh = rt.path[1];
  return [...head, `${pad(d.prefix, 19)}*[IS-IS/18] ${spAge(s.clock, 40)}, metric ${isisMetric(r, d.r, s.cfg)}`, `                    >  to ${ipOn(nh, r)} via ${jnIf(ifNameOn(r, nh))}${rt.via === "tunnel" ? `, label-switched-path ${rt.tunnel!.name}` : ""}`].join("\n");
}
function jnPing(s: TeState, r: TeR, name: string, trace: boolean): string {
  const l = s.view.lsps.find((x) => x.head === r && x.name === name);
  if (!l) return `error: no LSP named ${name}`;
  if (l.state !== "up") return trace ? `error: LSP ${name} is down` : "..... \n--- lsping statistics ---\n5 packets transmitted, 0 packets received, 100% packet loss";
  const p = l.path!;
  if (!trace) return "!!!!!\n--- lsping statistics ---\n5 packets transmitted, 5 packets received, 0% packet loss";
  return ["  Probe options: ttl 64, retries 3, exp 7", "", "  ttl    Label  Protocol    Address(next-hop)       Interface(next-hop)   Status", ...p.slice(1).map((x, i) => {
    const last = i === p.length - 2;
    const lab = l.labels[x]!;
    return `  ${pad(i + 1, 4)} ${lpad(lab, 7)}  ${pad("RSVP-TE", 11)} ${pad(ipOn(x, p[i]), 23)} ${pad(jnIf(ifNameOn(p[i], x)), 22)}${last ? "Egress" : "Success"}`;
  }), "", "  Path 1 via " + jnIf(ifNameOn(r, p[1])) + " destination 127.0.0.64"].join("\n");
}
function jnLog(s: TeState, r: TeR): string {
  return s.sys.filter((x) => x.dev === r).slice(-30).map((x) => {
    const st = `${spStamp(x.t).junos}  ${r}`;
    const l = s.view.lsps.find((y) => y.head === r && y.name === x.what);
    if (x.kind === "up") return `${st} rpd[1532]: RPD_MPLS_LSP_UP: LSP ${x.what} up on primary() ${l?.path ? `Route  ${l.path.slice(1).map((y, i) => ipOn(y, l.path![i])).join(" ")}` : ""}`.trimEnd();
    if (x.kind === "down") return `${st} rpd[1532]: RPD_MPLS_LSP_DOWN: LSP ${x.what} down on primary()`;
    if (x.kind === "preempt") return `${st} rpd[1532]: RPD_MPLS_PATH_DOWN: MPLS path down on LSP ${x.what} (preempted)`;
    return `${st} mgd[4417]: UI_COMMIT: User 'admin' requested 'commit' operation (comment: none)`;
  }).join("\n");
}

// ---------------------------------------------------------------------------------------------------------------
// Configuration as each OS prints it
// ---------------------------------------------------------------------------------------------------------------
const sortHops = (h: TeHop[]) => [...h].sort((a, b) => a.idx - b.idx);
export function teXrLines(r: TeR, c: TeCfg): string[] {
  const out: string[] = [`hostname ${r}`, "!", "interface Loopback0", ` ipv4 address ${TE_LO[r]} 255.255.255.255`, "!"];
  for (const t of [...c.tunnels].sort((a, b) => a.id - b.id)) {
    out.push(`interface tunnel-te${t.id}`, " ipv4 unnumbered Loopback0", ...(autorouted(c, t) ? [" autoroute announce", " !"] : []), ...(t.dst ? [` destination ${t.dst}`] : []), ...t.include.map((a) => ` affinity include ${a}`), ...t.exclude.map((a) => ` affinity exclude ${a}`), ...(t.bw ? [` signalled-bandwidth ${t.bw}`] : []), ...(t.setup !== 7 || t.hold !== 7 ? [` priority ${t.setup} ${t.hold}`] : []), ...[...t.opts].sort((a, b) => a.idx - b.idx).map((o) => ` path-option ${o.idx} ${o.kind === "dynamic" ? "dynamic" : `explicit name ${o.path}`}`), ...(t.shut ? [" shutdown"] : []), "!");
  }
  for (const x of ifsOf(r)) out.push(`interface ${xrIf(x.ifn)}`, ` description to ${x.peer}`, ` ipv4 address ${x.ip} 255.255.255.254`, ...(c.ifs[x.ifn].shut ? [" shutdown"] : []), "!");
  const ce = Object.values(CE_NET).find((x) => x.r === r);
  if (ce) out.push(`interface ${xrIf(ce.ifn)}`, " description customer", ` ipv4 address ${ce.net.replace(".0/24", ".1")} 255.255.255.0`, "!");
  for (const [n, hops] of Object.entries(c.paths)) out.push(`explicit-path name ${n}`, ...sortHops(hops).map((h) => ` index ${h.idx} next-address ${h.strict ? "strict" : "loose"} ipv4 unicast ${h.ip}`), "!");
  out.push("router isis CORE", " is-type level-2-only", ` net 49.0001.0000.0000.000${TE_ROUTERS.indexOf(r) + 1}.00`, " address-family ipv4 unicast", "  metric-style wide", ...(c.isisTe ? ["  mpls traffic-eng level-2-only", "  mpls traffic-eng router-id Loopback0"] : []), " !", " interface Loopback0", "  passive", "  address-family ipv4 unicast", "  !", " !");
  for (const x of ifsOf(r)) out.push(` interface ${xrIf(x.ifn)}`, "  point-to-point", "  address-family ipv4 unicast", `   metric ${x.link.metric}`, "  !", " !");
  out.push("!");
  const rs = ifsOf(r).filter((x) => c.ifs[x.ifn].rsvp !== undefined);
  if (rs.length) out.push("rsvp", ...rs.flatMap((x) => [` interface ${xrIf(x.ifn)}`, ...(c.ifs[x.ifn].rsvp ? [`  bandwidth ${c.ifs[x.ifn].rsvp}`] : []), " !"]), "!");
  out.push("mpls traffic-eng");
  for (const x of ifsOf(r).filter((y) => c.ifs[y.ifn].te)) out.push(` interface ${xrIf(x.ifn)}`, ...(c.ifs[x.ifn].attr.length ? [`  attribute-names ${c.ifs[x.ifn].attr.join(" ")}`] : []), ...(c.ifs[x.ifn].teMetric !== undefined ? [`  admin-weight ${c.ifs[x.ifn].teMetric}`] : []), " !");
  out.push(...AFF_NAMES.map((a) => ` affinity-map ${a} bit-position ${AFFINITY[a]}`), "!");
  return out;
}
export function teJnStmts(r: TeR, c: TeCfg): JStmt[] {
  const out: JStmt[] = [];
  for (const x of ifsOf(r)) {
    const ip = ["interfaces", x.ifn, "unit 0"];
    if (c.ifs[x.ifn].shut) out.push({ path: ["interfaces", x.ifn], leaf: "disable" });
    out.push({ path: [...ip, "family inet"], leaf: `address ${x.ip}/31` }, { path: [...ip, "family iso"], leaf: "" }, { path: [...ip, "family mpls"], leaf: "" });
  }
  const ce = Object.values(CE_NET).find((x) => x.r === r);
  if (ce) out.push({ path: ["interfaces", ce.ifn, "unit 0", "family inet"], leaf: `address ${ce.net.replace(".0/24", ".1")}/24` });
  out.push({ path: ["interfaces", "lo0", "unit 0", "family inet"], leaf: `address ${TE_LO[r]}/32` });
  out.push({ path: ["routing-options"], leaf: `router-id ${TE_LO[r]}` });
  for (const x of ifsOf(r).filter((y) => c.ifs[y.ifn].rsvp !== undefined)) out.push(c.ifs[x.ifn].rsvp ? { path: ["protocols", "rsvp", `interface ${jnIf(x.ifn)}`], leaf: `bandwidth ${fmtJbw(c.ifs[x.ifn].rsvp!)}` } : { path: ["protocols", "rsvp", `interface ${jnIf(x.ifn)}`], leaf: "" });
  for (const a of AFF_NAMES) out.push({ path: ["protocols", "mpls", "admin-groups"], leaf: `${a} ${AFFINITY[a]}` });
  const usesDyn = c.tunnels.some((t) => t.opts.length > 1 && t.opts.some((o) => o.kind === "dynamic"));
  for (const t of [...c.tunnels].sort((a, b) => a.id - b.id)) {
    const p = ["protocols", "mpls", `label-switched-path ${t.name}`];
    if (t.dst) out.push({ path: p, leaf: `to ${t.dst}` });
    if (t.bw) out.push({ path: p, leaf: `bandwidth ${fmtJbw(t.bw)}` });
    if (t.setup !== 7 || t.hold !== 0) out.push({ path: p, leaf: `priority ${t.setup} ${t.hold}` });
    for (const a of t.include) out.push({ path: [...p, "admin-group"], leaf: `include-all ${a}` });
    for (const a of t.exclude) out.push({ path: [...p, "admin-group"], leaf: `exclude ${a}` });
    const opts = [...t.opts].sort((a, b) => a.idx - b.idx);
    opts.forEach((o, k) => {
      const nm = o.kind === "explicit" ? o.path! : "DYNAMIC";
      if (o.kind === "dynamic" && opts.length === 1) return;
      out.push({ path: p, leaf: `${k === 0 ? "primary" : "secondary"} ${nm}` });
    });
    if (t.shut) out.push({ path: p, leaf: "disable" });
  }
  for (const [n, hops] of Object.entries(c.paths)) {
    if (!hops.length) out.push({ path: ["protocols", "mpls", `path ${n}`], leaf: "" });
    for (const h of sortHops(hops)) out.push({ path: ["protocols", "mpls", `path ${n}`], leaf: `${h.ip} ${h.strict ? "strict" : "loose"}` });
  }
  if (usesDyn && !c.paths.DYNAMIC) out.push({ path: ["protocols", "mpls", "path DYNAMIC"], leaf: "" });
  for (const x of ifsOf(r).filter((y) => c.ifs[y.ifn].te)) {
    if (c.ifs[x.ifn].attr.length) for (const a of c.ifs[x.ifn].attr) out.push({ path: ["protocols", "mpls", `interface ${jnIf(x.ifn)}`], leaf: `admin-group ${a}` });
    else out.push({ path: ["protocols", "mpls", `interface ${jnIf(x.ifn)}`], leaf: "" });
  }
  if (c.shortcuts || c.tunnels.some((t) => t.autoroute)) out.push({ path: ["protocols", "isis", "traffic-engineering"], leaf: "shortcuts" });
  if (!c.isisTe) out.push({ path: ["protocols", "isis", "traffic-engineering"], leaf: "disable" });
  out.push({ path: ["protocols", "isis", "level 1"], leaf: "disable" }, { path: ["protocols", "isis", "level 2"], leaf: "wide-metrics-only" });
  for (const x of ifsOf(r)) {
    const ip = ["protocols", "isis", `interface ${jnIf(x.ifn)}`];
    out.push({ path: ip, leaf: "point-to-point" });
    if (c.ifs[x.ifn].teMetric !== undefined) out.push({ path: [...ip, "level 2"], leaf: `metric ${x.link.metric}` }, { path: [...ip, "level 2"], leaf: `te-metric ${c.ifs[x.ifn].teMetric}` });
    else out.push({ path: ip, leaf: `level 2 metric ${x.link.metric}` });
  }
  out.push({ path: ["protocols", "isis", "interface lo0.0"], leaf: "passive" });
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Configuration statements
// ---------------------------------------------------------------------------------------------------------------
const tun = (c: TeCfg, id: string) => c.tunnels.find((t) => String(t.id) === id);
const newTunnel = (id: number, name: string, junos: boolean): TeTunnel => ({ id, name, dst: "", bw: 0, setup: 7, hold: junos ? 0 : 7, opts: junos ? [{ idx: 10, kind: "dynamic" }] : [], include: [], exclude: [], autoroute: false, shut: false });
const byName = (c: TeCfg, n: string) => c.tunnels.find((t) => t.name === n);
const ensureLsp = (c: TeCfg, n: string) => {
  let t = byName(c, n);
  if (!t) {
    const id = Math.max(0, ...c.tunnels.map((x) => x.id)) + 1;
    t = newTunnel(id, n, true);
    c.tunnels.push(t);
  }
  return t;
};
const setOpt = (t: TeTunnel, idx: number, c: TeCfg, pathName: string) => {
  const hops = c.paths[pathName];
  const o = hops && hops.length ? { idx, kind: "explicit" as const, path: pathName } : pathName === "DYNAMIC" && !hops ? { idx, kind: "dynamic" as const } : { idx, kind: "explicit" as const, path: pathName };
  t.opts = [...t.opts.filter((x) => x.idx !== idx), o].sort((a, b) => a.idx - b.idx);
};
function stmts(r: TeR, s: TeState): SpCfgStmt<TeCfg>[] {
  const lspArg = nameArg(s.cfg[r].tunnels.map((t) => t.name).concat(s.cfg[r].tunnels.length ? [] : ["TO-R6"]), "LSP name");
  const pathArg = nameArg(Object.keys(s.cfg[r].paths).length ? Object.keys(s.cfg[r].paths) : ["VIA-R3"], "Path name");
  const pifX = pifArg(r, false);
  const pifJ = pifArg(r, true);
  const optArg = numArg(1, 1000, ["10", "20"], "Path-option preference (lower is tried first)");
  return [
    // ---------------------------------------------------------------- IOS XR
    {
      id: "tif",
      summary: "Configure an MPLS-TE tunnel interface",
      args: { tid: tifArg },
      xr: {
        mode: "config",
        syntax: "interface <tid>",
        enter: "tun",
        apply: (c, a) => (tun(c, a.tid) || c.tunnels.push(newTunnel(+a.tid, `tunnel-te${a.tid}`, false)), c),
        no: (c, a) => ((c.tunnels = c.tunnels.filter((t) => String(t.id) !== a.tid)), c),
      },
    },
    { id: "pif", summary: "Configure a physical interface", args: { pif: pifX }, xr: { mode: "config", syntax: "interface <pif>", enter: "if", apply: (c) => c } },
    { id: "unnum", summary: "Use the loopback's address on the tunnel", args: { lo: choiceArg(["Loopback0"], () => "Loopback interface") }, xr: { mode: "tun", syntax: "ipv4 unnumbered <lo>", apply: (c) => c } },
    { id: "dst", summary: "Tunnel destination (the tail's TE router ID)", args: { ip: loArg }, xr: { mode: "tun", syntax: "destination <ip>", noSyntax: "destination", apply: (c, a, x) => ((tun(c, x.tid)!.dst = a.ip), c), no: (c, _a, x) => ((tun(c, x.tid)!.dst = ""), c) } },
    { id: "sbw", summary: "Bandwidth the tunnel signals (kbps)", args: { kbps: kbpsArg }, xr: { mode: "tun", syntax: "signalled-bandwidth <kbps>", noSyntax: "signalled-bandwidth", apply: (c, a, x) => ((tun(c, x.tid)!.bw = +a.kbps), c), no: (c, _a, x) => ((tun(c, x.tid)!.bw = 0), c) } },
    {
      id: "prio",
      summary: "Setup and hold priority (0 best, 7 worst)",
      args: { s: prioArg, h: prioArg },
      xr: {
        mode: "tun",
        syntax: "priority <s> <h>",
        noSyntax: "priority",
        apply: (c, a, x) => (+a.h > +a.s ? `!!% Invalid argument: the hold priority (${a.h}) must not be worse (higher) than the setup priority (${a.s})` : (Object.assign(tun(c, x.tid)!, { setup: +a.s, hold: +a.h }), c)),
        no: (c, _a, x) => (Object.assign(tun(c, x.tid)!, { setup: 7, hold: 7 }), c),
      },
    },
    { id: "ar", summary: "Announce the tunnel to IS-IS (traffic to the tail uses it)", xr: { mode: "tun", syntax: "autoroute announce", apply: (c, _a, x) => ((tun(c, x.tid)!.autoroute = true), c), no: (c, _a, x) => ((tun(c, x.tid)!.autoroute = false), (c.shortcuts = false), c) } },
    { id: "rr", summary: "Record the route the LSP takes", xr: { mode: "tun", syntax: "record-route", apply: (c) => c } },
    {
      id: "po-dyn",
      summary: "A path option computed by CSPF",
      args: { n: optArg },
      xr: { mode: "tun", syntax: "path-option <n> dynamic", noSyntax: "path-option <n>", apply: (c, a, x) => {
        const t = tun(c, x.tid)!;
        t.opts = [...t.opts.filter((o) => o.idx !== +a.n), { idx: +a.n, kind: "dynamic" as const }].sort((p, q) => p.idx - q.idx);
        return c;
      }, no: (c, a, x) => {
        const t = tun(c, x.tid)!;
        t.opts = t.opts.filter((o) => o.idx !== +a.n);
        return c;
      } },
    },
    {
      id: "po-exp",
      summary: "A path option that follows a named explicit path",
      args: { n: optArg, p: pathArg },
      xr: { mode: "tun", syntax: "path-option <n> explicit name <p>", apply: (c, a, x) => {
        const t = tun(c, x.tid)!;
        t.opts = [...t.opts.filter((o) => o.idx !== +a.n), { idx: +a.n, kind: "explicit" as const, path: a.p }].sort((p, q) => p.idx - q.idx);
        return c;
      } },
    },
    { id: "aff-inc", summary: "Use only links that carry this color", args: { a: affArg }, xr: { mode: "tun", syntax: "affinity include <a>", apply: (c, a, x) => ((tun(c, x.tid)!.include = [...new Set([...tun(c, x.tid)!.include, a.a])]), c), no: (c, a, x) => ((tun(c, x.tid)!.include = tun(c, x.tid)!.include.filter((y) => y !== a.a)), c) } },
    { id: "aff-exc", summary: "Avoid links that carry this color", args: { a: affArg }, xr: { mode: "tun", syntax: "affinity exclude <a>", apply: (c, a, x) => ((tun(c, x.tid)!.exclude = [...new Set([...tun(c, x.tid)!.exclude, a.a])]), c), no: (c, a, x) => ((tun(c, x.tid)!.exclude = tun(c, x.tid)!.exclude.filter((y) => y !== a.a)), c) } },
    { id: "tshut", summary: "Shut the tunnel down", xr: { mode: "tun", syntax: "shutdown", apply: (c, _a, x) => ((tun(c, x.tid)!.shut = true), c), no: (c, _a, x) => ((tun(c, x.tid)!.shut = false), c) } },
    { id: "pshut", summary: "Shut the interface down (the link fails)", xr: { mode: "if", syntax: "shutdown", apply: (c, _a, x) => ((c.ifs[x.pif as IfName].shut = true), c), no: (c, _a, x) => ((c.ifs[x.pif as IfName].shut = false), c) } },
    { id: "ep", summary: "Define an explicit path", args: { p: pathArg }, xr: { mode: "config", syntax: "explicit-path name <p>", enter: "ep", apply: (c, a) => ((c.paths[a.p] ??= []), c), no: (c, a) => (delete c.paths[a.p], c) } },
    {
      id: "ep-strict",
      summary: "A hop that must be the next router",
      args: { i: numArg(1, 65535, ["1", "2", "3"], "Index (order of the hops)"), ip: anyIp(Object.values(TE_LO), "Hop address") },
      xr: { mode: "ep", syntax: "index <i> next-address strict ipv4 unicast <ip>", noSyntax: "index <i>", apply: (c, a, x) => ((c.paths[x.p] = [...c.paths[x.p].filter((h) => h.idx !== +a.i), { idx: +a.i, ip: a.ip, strict: true }]), c), no: (c, a, x) => ((c.paths[x.p] = c.paths[x.p].filter((h) => h.idx !== +a.i)), c) },
    },
    { id: "ep-loose", summary: "A hop CSPF reaches any way it can", args: { i: numArg(1, 65535, ["1", "2", "3"], "Index (order of the hops)"), ip: anyIp(Object.values(TE_LO), "Hop address") }, xr: { mode: "ep", syntax: "index <i> next-address loose ipv4 unicast <ip>", apply: (c, a, x) => ((c.paths[x.p] = [...c.paths[x.p].filter((h) => h.idx !== +a.i), { idx: +a.i, ip: a.ip, strict: false }]), c) } },
    { id: "te", summary: "MPLS traffic engineering", xr: { mode: "config", syntax: "mpls traffic-eng", enter: "te", apply: (c) => c, no: () => "% This lab keeps MPLS-TE enabled; remove single interfaces instead." } },
    { id: "te-if", summary: "Make the interface a TE link (flooded in the TED)", args: { pif: pifX }, xr: { mode: "te", syntax: "interface <pif>", enter: "te-if", apply: (c, a) => ((c.ifs[a.pif as IfName].te = true), c), no: (c, a) => ((c.ifs[a.pif as IfName].te = false), c) } },
    { id: "attr", summary: "The link's affinity color", args: { a: affArg }, xr: { mode: "te-if", syntax: "attribute-names <a>", noSyntax: "attribute-names", apply: (c, a, x) => ((c.ifs[x.pif as IfName].attr = [a.a]), c), no: (c, _a, x) => ((c.ifs[x.pif as IfName].attr = []), c) } },
    { id: "attr2", summary: "The link's affinity colors", args: { a: affArg, b: affArg }, xr: { mode: "te-if", syntax: "attribute-names <a> <b>", apply: (c, a, x) => ((c.ifs[x.pif as IfName].attr = [...new Set([a.a, a.b])]), c) } },
    { id: "aw", summary: "TE metric of the link (default: the IGP metric)", args: { n: numArg(1, 16777215, ["100"], "TE metric") }, xr: { mode: "te-if", syntax: "admin-weight <n>", noSyntax: "admin-weight", apply: (c, a, x) => ((c.ifs[x.pif as IfName].teMetric = +a.n), c), no: (c, _a, x) => ((c.ifs[x.pif as IfName].teMetric = undefined), c) } },
    { id: "rsvp", summary: "RSVP", xr: { mode: "config", syntax: "rsvp", enter: "rsvp", apply: (c) => c } },
    { id: "rsvp-if", summary: "Run RSVP on the interface", args: { pif: pifX }, xr: { mode: "rsvp", syntax: "interface <pif>", enter: "rsvp-if", apply: (c, a) => ((c.ifs[a.pif as IfName].rsvp ??= 0), c), no: (c, a) => ((c.ifs[a.pif as IfName].rsvp = undefined), c) } },
    { id: "rsvp-bw", summary: "Reservable bandwidth (kbps)", args: { kbps: kbpsArg }, xr: { mode: "rsvp-if", syntax: "bandwidth <kbps>", noSyntax: "bandwidth", apply: (c, a, x) => ((c.ifs[x.pif as IfName].rsvp = +a.kbps), c), no: (c, _a, x) => ((c.ifs[x.pif as IfName].rsvp = 0), c) } },
    { id: "rsvp-bw75", summary: "Reservable bandwidth: 75% of the link", xr: { mode: "rsvp-if", syntax: "bandwidth", apply: (c, _a, x) => ((c.ifs[x.pif as IfName].rsvp = 750000), c) } },

    // ---------------------------------------------------------------- Junos
    { id: "j-lsp", summary: "An LSP (delete removes it)", args: { lsp: lspArg }, junos: { syntax: "protocols mpls label-switched-path <lsp>", set: (c, a) => (ensureLsp(c, a.lsp), c), del: (c, a) => ((c.tunnels = c.tunnels.filter((t) => t.name !== a.lsp)), c) } },
    { id: "j-to", summary: "The LSP's egress (tail TE router ID)", args: { lsp: lspArg, ip: loArg }, junos: { syntax: "protocols mpls label-switched-path <lsp> to <ip>", set: (c, a) => ((ensureLsp(c, a.lsp).dst = a.ip), c), del: (c, a) => (byName(c, a.lsp) && (byName(c, a.lsp)!.dst = ""), c) } },
    { id: "j-bw", summary: "Bandwidth to reserve", args: { lsp: lspArg, bw: jbwArg }, junos: { syntax: "protocols mpls label-switched-path <lsp> bandwidth <bw>", set: (c, a) => ((ensureLsp(c, a.lsp).bw = +a.bw), c), del: (c, a) => (byName(c, a.lsp) && (byName(c, a.lsp)!.bw = 0), c) } },
    {
      id: "j-prio",
      summary: "Setup and hold priority",
      args: { lsp: lspArg, s: prioArg, h: prioArg },
      junos: {
        syntax: "protocols mpls label-switched-path <lsp> priority <s> <h>",
        set: (c, a) => (+a.h > +a.s ? `error: hold priority ${a.h} must not be lower (numerically higher) than setup priority ${a.s}` : (Object.assign(ensureLsp(c, a.lsp), { setup: +a.s, hold: +a.h }), c)),
        del: (c, a) => (byName(c, a.lsp) && Object.assign(byName(c, a.lsp)!, { setup: 7, hold: 0 }), c),
      },
    },
    { id: "j-pri", summary: "Primary path (a named path)", args: { lsp: lspArg, p: pathArg }, junos: { syntax: "protocols mpls label-switched-path <lsp> primary <p>", set: (c, a) => (setOpt(ensureLsp(c, a.lsp), 10, c, a.p), c), del: (c, a) => (byName(c, a.lsp) && setOpt(byName(c, a.lsp)!, 10, c, "DYNAMIC"), c) } },
    { id: "j-sec", summary: "Secondary path (tried when the primary can't be used)", args: { lsp: lspArg, p: pathArg }, junos: { syntax: "protocols mpls label-switched-path <lsp> secondary <p>", set: (c, a) => (setOpt(ensureLsp(c, a.lsp), 20, c, a.p), c), del: (c, a) => (byName(c, a.lsp) && (byName(c, a.lsp)!.opts = byName(c, a.lsp)!.opts.filter((o) => o.idx !== 20)), c) } },
    { id: "j-inc", summary: "Use only links with all these colors", args: { lsp: lspArg, a: affArg }, junos: { syntax: "protocols mpls label-switched-path <lsp> admin-group include-all <a>", set: (c, a) => ((ensureLsp(c, a.lsp).include = [...new Set([...ensureLsp(c, a.lsp).include, a.a])]), c), del: (c, a) => (byName(c, a.lsp) && (byName(c, a.lsp)!.include = byName(c, a.lsp)!.include.filter((y) => y !== a.a)), c) } },
    { id: "j-exc", summary: "Avoid links with this color", args: { lsp: lspArg, a: affArg }, junos: { syntax: "protocols mpls label-switched-path <lsp> admin-group exclude <a>", set: (c, a) => ((ensureLsp(c, a.lsp).exclude = [...new Set([...ensureLsp(c, a.lsp).exclude, a.a])]), c), del: (c, a) => (byName(c, a.lsp) && (byName(c, a.lsp)!.exclude = byName(c, a.lsp)!.exclude.filter((y) => y !== a.a)), c) } },
    { id: "j-dis", summary: "Disable the LSP", args: { lsp: lspArg }, junos: { syntax: "protocols mpls label-switched-path <lsp> disable", set: (c, a) => ((ensureLsp(c, a.lsp).shut = true), c), del: (c, a) => (byName(c, a.lsp) && (byName(c, a.lsp)!.shut = false), c) } },
    { id: "j-path", summary: "A named path (empty = CSPF picks every hop)", args: { p: pathArg }, junos: { syntax: "protocols mpls path <p>", set: (c, a) => ((c.paths[a.p] ??= []), c), del: (c, a) => (delete c.paths[a.p], c) } },
    {
      id: "j-hop",
      summary: "A hop of the named path",
      args: { p: pathArg, ip: anyIp(Object.values(TE_LO), "Hop address"), m: choiceArg(["strict", "loose"], (m) => (m === "strict" ? "Must be the next router" : "Reached any way")) },
      junos: {
        syntax: "protocols mpls path <p> <ip> <m>",
        set: (c, a) => {
          const hops = (c.paths[a.p] ??= []);
          const ex = hops.find((h) => h.ip === a.ip);
          if (ex) ex.strict = a.m === "strict";
          else hops.push({ idx: Math.max(0, ...hops.map((h) => h.idx)) + 1, ip: a.ip, strict: a.m === "strict" });
          return c;
        },
        del: (c, a) => (c.paths[a.p] && (c.paths[a.p] = c.paths[a.p].filter((h) => h.ip !== a.ip)), c),
      },
    },
    {
      id: "j-hop1",
      summary: "A hop of the named path (strict unless loose is given)",
      args: { p: pathArg, ip: anyIp(Object.values(TE_LO), "Hop address") },
      junos: {
        syntax: "protocols mpls path <p> <ip>",
        set: (c, a) => {
          const hops = (c.paths[a.p] ??= []);
          if (!hops.some((h) => h.ip === a.ip)) hops.push({ idx: Math.max(0, ...hops.map((h) => h.idx)) + 1, ip: a.ip, strict: true });
          return c;
        },
        del: (c, a) => (c.paths[a.p] && (c.paths[a.p] = c.paths[a.p].filter((h) => h.ip !== a.ip)), c),
      },
    },
    { id: "j-mif", summary: "Make the interface an MPLS / TE interface", args: { pif: pifJ }, junos: { syntax: "protocols mpls interface <pif>", set: (c, a) => ((c.ifs[a.pif as IfName].te = true), c), del: (c, a) => ((c.ifs[a.pif as IfName].te = false), c) } },
    { id: "j-ag", summary: "The link's color (admin group)", args: { pif: pifJ, a: affArg }, junos: { syntax: "protocols mpls interface <pif> admin-group <a>", set: (c, a) => ((c.ifs[a.pif as IfName].te = true), (c.ifs[a.pif as IfName].attr = [...new Set([...c.ifs[a.pif as IfName].attr, a.a])]), c), del: (c, a) => ((c.ifs[a.pif as IfName].attr = c.ifs[a.pif as IfName].attr.filter((y) => y !== a.a)), c) } },
    { id: "j-rif", summary: "Run RSVP on the interface", args: { pif: pifJ }, junos: { syntax: "protocols rsvp interface <pif>", set: (c, a) => ((c.ifs[a.pif as IfName].rsvp ??= 1000000), c), del: (c, a) => ((c.ifs[a.pif as IfName].rsvp = undefined), c) } },
    { id: "j-rbw", summary: "Reservable bandwidth on the interface", args: { pif: pifJ, bw: jbwArg }, junos: { syntax: "protocols rsvp interface <pif> bandwidth <bw>", set: (c, a) => ((c.ifs[a.pif as IfName].rsvp = +a.bw), c), del: (c, a) => ((c.ifs[a.pif as IfName].rsvp = 1000000), c) } },
    { id: "j-tem", summary: "TE metric of the link", args: { pif: pifJ, n: numArg(1, 16777215, ["100"], "TE metric") }, junos: { syntax: "protocols isis interface <pif> level 2 te-metric <n>", set: (c, a) => ((c.ifs[a.pif as IfName].teMetric = +a.n), c), del: (c, a) => ((c.ifs[a.pif as IfName].teMetric = undefined), c) } },
    { id: "j-sc", summary: "IS-IS uses the LSPs from this router (IGP shortcuts)", junos: { syntax: "protocols isis traffic-engineering shortcuts", set: (c) => ((c.shortcuts = true), c), del: (c) => ((c.shortcuts = false), c.tunnels.forEach((t) => (t.autoroute = false)), c) } },
    { id: "j-ifdis", summary: "Disable the interface (the link fails)", args: { pif: pifJ }, junos: { syntax: "interfaces <pif> disable", set: (c, a) => ((c.ifs[a.pif as IfName].shut = true), c), del: (c, a) => ((c.ifs[a.pif as IfName].shut = false), c) } },
  ];
}

// ---------------------------------------------------------------------------------------------------------------
// Command sets
// ---------------------------------------------------------------------------------------------------------------
export function teValidate(c: TeCfg, junos: boolean): string | undefined {
  if (!junos) return undefined;
  for (const t of c.tunnels) {
    if (!t.dst) return `error: label-switched-path ${t.name}: 'to' must be configured\nerror: configuration check-out failed`;
    for (const o of t.opts) if (o.kind === "explicit" && !c.paths[o.path!]) return `error: label-switched-path ${t.name}: path ${o.path} is not defined\nerror: configuration check-out failed`;
  }
  return undefined;
}
export function teXrSpec(api: TeCliApi, r: TeR): SpXrSpec<TeCfg> {
  const s = api.s;
  const sh = (id: string, syntax: string, summary: string, run: SpCmd["run"], args?: SpCmd["args"]): SpCmd => ({ id, syntax, summary, run, args });
  const nothing = (o: string, why: string) => o || { output: "", explanation: why };
  return {
    stmts: stmts(r, s).filter((x) => x.xr),
    prompts: { config: "config", tun: "config-if", if: "config-if", ep: "config-expl-path", te: "config-mpls-te", "te-if": "config-mpls-te-if", rsvp: "config-rsvp", "rsvp-if": "config-rsvp-if" },
    lines: (c) => teXrLines(r, c),
    help: { "show mpls": "MPLS information", "show mpls traffic-eng": "MPLS traffic engineering information", "show rsvp": "RSVP information", "show route": "IP routing table", ping: "Send echo messages", traceroute: "Trace route to destination", "ping mpls": "MPLS echo (LSP ping)", "traceroute mpls": "MPLS traceroute" },
    shows: [
      sh("tun-b", "show mpls traffic-eng tunnels brief", "One line per tunnel (heads, midpoints, tails)", () => xrTunnelsBrief(s, r)),
      sh("tun", "show mpls traffic-eng tunnels", "Every tunnel in detail: status, path options, ERO, labels", () => xrTunnels(s, r)),
      sh("tun-n", "show mpls traffic-eng tunnels <n>", "One tunnel in detail", (a) => xrTunnels(s, r, a.n), { n: tidArg(s, r) }),
      sh("topo", "show mpls traffic-eng topology", "The TED: every TE link with its metric, colors and bandwidth per priority", () => xrTopology(s, r, false)),
      sh("topo-b", "show mpls traffic-eng topology brief", "The TED, without the per-priority bandwidth tables", () => xrTopology(s, r, true)),
      sh("rsvp-s", "show rsvp session", "RSVP sessions through this router", () => xrRsvpSession(s, r)),
      sh("rsvp-i", "show rsvp interface", "Reservable and allocated bandwidth per interface", () => xrRsvpIf(s, r)),
      sh("ep", "show explicit-paths", "The explicit paths configured here", () => nothing(xrExplicit(s, r), "No explicit paths are configured.")),
      sh("fwd", "show mpls forwarding", "The label forwarding table", () => xrForwarding(s, r)),
      sh("route", "show route", "The IP routing table", () => xrRouteAll(s, r)),
      sh("route-ip", "show route <ip>", "The route a destination uses", (a) => xrRouteEntry(s, r, a.ip), { ip: destArg }),
      sh("log", "show logging", "The syslog buffer", () => xrLogging(s, r)),
    ],
    exec: [
      sh("ping-te", "ping mpls traffic-eng tunnel-te <n>", "LSP ping through a tunnel", (a) => xrPingTe(s, r, a.n, false), { n: tidArg(s, r) }),
      sh("trace-te", "traceroute mpls traffic-eng tunnel-te <n>", "LSP traceroute through a tunnel", (a) => xrPingTe(s, r, a.n, true), { n: tidArg(s, r) }),
    ],
  };
}
export function teJunosSpec(api: TeCliApi, r: TeR): SpJunosSpec<TeCfg> {
  const s = api.s;
  const sh = (id: string, syntax: string, summary: string, run: SpCmd["run"], args?: SpCmd["args"]): SpCmd => ({ id, syntax, summary, run, args });
  const nothing = (o: string, why: string) => o || { output: "", explanation: why };
  const lspArg = nameArg(s.cfg[r].tunnels.map((t) => t.name), "LSP name");
  return {
    stmts: stmts(r, s).filter((x) => x.junos),
    jstmts: (c) => teJnStmts(r, c),
    help: { "show mpls": "Show MPLS information", "show rsvp": "Show RSVP information", "show ted": "Show Traffic Engineering Database information", "show route": "Show routing table information", "show mpls lsp": "Show label-switched-path status", ping: "Ping remote target", traceroute: "Trace route to remote host", "ping mpls": "Ping label-switched path", "traceroute mpls": "Trace label-switched path" },
    shows: [
      sh("lsp", "show mpls lsp", "Ingress, egress and transit LSPs", () => jnLsp(s, r, "brief")),
      ...(["ingress", "egress", "transit"] as const).map((k) => sh(`lsp-${k}`, `show mpls lsp ${k}`, `Only the ${k} LSPs`, () => jnLsp(s, r, "brief").split("\n\n").find((x) => x.toLowerCase().startsWith(k)) ?? "")),
      sh("lsp-d", "show mpls lsp detail", "LSPs with path, ERO and RRO", () => jnLsp(s, r, "detail")),
      sh("lsp-e", "show mpls lsp extensive", "LSPs with their history (CSPF results)", () => jnLsp(s, r, "extensive")),
      sh("lsp-n", "show mpls lsp name <lsp> extensive", "One LSP with its history", (a) => nothing(jnLsp(s, r, "extensive", a.lsp), "No such LSP."), { lsp: lspArg }),
      sh("rsvp-s", "show rsvp session", "RSVP sessions through this router", () => jnRsvpSession(s, r)),
      sh("rsvp-i", "show rsvp interface", "Reservable and reserved bandwidth per interface", () => jnRsvpIf(s, r)),
      sh("ted", "show ted database", "The TED: nodes and links", () => jnTed(s, r, false)),
      sh("ted-e", "show ted database extensive", "The TED with colors, metrics and bandwidth per priority", () => jnTed(s, r, true)),
      sh("route", "show route <ip>", "The route a destination uses", (a) => nothing(jnRoute(s, r, a.ip), "No route."), { ip: destArg }),
      sh("log", "show log messages", "The system log", () => nothing(jnLog(s, r), "No messages since the lab started.")),
    ],
    op: [
      sh("ping-te", "ping mpls rsvp <lsp>", "LSP ping through an RSVP LSP", (a) => jnPing(s, r, a.lsp, false), { lsp: lspArg }),
      sh("trace-te", "traceroute mpls rsvp <lsp>", "LSP traceroute through an RSVP LSP", (a) => jnPing(s, r, a.lsp, true), { lsp: lspArg }),
    ],
  };
}
export function teSets(api: TeCliApi, r: TeR): Partial<Record<CliVendor, CliCommandSet>> {
  return {
    cisco: buildXrSet({ ...api.dev, validate: (c) => teValidate(c, false) }, teXrSpec(api, r)),
    juniper: buildJunosSet({ ...api.dev, validate: (c) => teValidate(c, true) }, teJunosSpec(api, r)),
  };
}
export const tePipe = (api: TeCliApi, r: TeR) => ({ config: junosPipeConfig(api.dev, { jstmts: (c: TeCfg) => teJnStmts(r, c) }), rollbacks: api.dev.hist.length });
export function teStaticApi(s: TeState, r: TeR): TeCliApi {
  return { s, act: () => s, dev: { host: r, running: s.cfg[r], hist: s.hist[r], setCand: () => undefined, xr: [], setXr: () => undefined, edit: false, setEdit: () => undefined, commit: () => undefined } };
}
export const teClone = spClone;
export { lspKey, lspOf, TE_LINKS };
