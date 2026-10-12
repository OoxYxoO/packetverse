import type { CliArgSpec, CliCommandSet, CliVendor } from "@/lib/cli/types";
import { buildJunosSet, buildXrSet, choiceArg, junosPipeConfig, numArg, type SpCfgStmt, type SpCmd, type SpDevCli, type SpJunosSpec, type SpXrSpec } from "@/components/sp-lab/spCli";
import { lpad, pad, spAge, spClone, spStamp, type JStmt } from "@/components/sp-lab/spKit";
import { jnIf, parseIf, xrIf } from "@/components/sp-lab/spNames";
import {
  CE_IF,
  CE_IP,
  CE_NET,
  CORE_MTU,
  EXPLICIT_NULL,
  IMPLICIT_NULL,
  MP_LINKS,
  MP_LO,
  MP_ROUTERS,
  bgpRoute,
  ceOf,
  ftn,
  igpAdj,
  inPfx,
  ldpActive,
  lfib,
  lib,
  linkUp,
  mpIf,
  mpIfs,
  ownerOf,
  sessKey,
  sessionUp,
  walk,
  type IfName,
  type MpAction,
  type MpCe,
  type MpIgpRoute,
  type MpPath,
  type MpR,
  type MpRtr,
  type MpState,
  type OutLabel,
} from "@/lib/sim-engine/scenarios/mplsNet";

/**
 * Command lines of the MPLS + LDP Lab — IOS XR or Junos on the six provider routers, a Linux shell on CE1 and CE2.
 * Every output is printed from the lab model (the same LDP sessions, bindings, LFIBs and packet walks the topology
 * shows). Junos and IOS XR differ where the platforms differ: label control (independent vs ordered), label ranges,
 * where the labels live (mpls.0 / inet.3 vs the LFIB) and the commands that show them.
 *
 *   IOS XR  show mpls ldp neighbor [brief] · show mpls ldp discovery · show mpls ldp bindings [<fec>] · show mpls
 *           ldp interface brief · show mpls ldp igp sync · show mpls forwarding [prefix <fec>] · show cef <ip> ·
 *           show route [<ip> | isis | bgp] · show isis neighbors · show interfaces brief | <if> · show logging ·
 *           ping / traceroute <ip> [source …] · ping mpls ipv4 <fec>/32 · traceroute mpls ipv4 <fec>/32 ·
 *           configure → mpls ldp (interface, address-family ipv4 → label local advertise explicit-null) ·
 *           router isis CORE → interface … (address-family ipv4 unicast → metric, mpls ldp sync) · interface <if> mtu
 *   Junos   show ldp neighbor | session | interface | database · show route table mpls.0 | inet.3 · show route <ip>
 *           [hidden] · show isis adjacency · show interfaces terse | <if> · show log messages · ping / traceroute ·
 *           ping mpls ldp <fec> · traceroute mpls ldp <fec> · configure → set protocols ldp interface … · protocols
 *           mpls interface … · interfaces <if> unit 0 family mpls · protocols ldp explicit-null · protocols isis
 *           interface … ldp-synchronization · level 2 metric · interfaces <if> mtu
 */

export interface MpCliApi {
  s: MpState;
  act: (a: MpAction) => MpState;
  dev: SpDevCli<MpRtr>;
}
const age = (s: MpState) => spAge(s.clock, 8);
const fmtOut = (o: OutLabel, junos = false) => (o === "Pop" ? (junos ? "Pop" : "Pop") : o === "Unlabelled" ? "Unlabelled" : String(o));
const ldpId = (r: MpR) => `${MP_LO[r]}:0`;
const peersOf = (s: MpState, r: MpR) => MP_ROUTERS.filter((p) => p !== r && s.view.sessions.some((x) => sessKey(x.a, x.b) === sessKey(r, p)));
const addrsOf = (r: MpR) => [MP_LO[r], ...mpIfs(r).map((i) => i.ip), ...(ceOf(r) ? [CE_NET[ceOf(r)!].peIp] : [])];
const fecs = (s: MpState, r: MpR) => [MP_LO[r], ...s.view.igp[r].filter((x) => x.len === 32).map((x) => x.p)].filter((f, i, a) => a.indexOf(f) === i).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

// ---------------------------------------------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------------------------------------------
const phys = (r: MpR) => mpIfs(r).map((i) => i.ifn);
const xrIfArg = (r: MpR, withLo = false): CliArgSpec => ({
  choices: [...(withLo ? ["Loopback0"] : []), ...phys(r).map((i) => xrIf(i))],
  describe: (c) => {
    const n = parseIf(c);
    const i = n && n !== "lo0" ? mpIf(r, n) : undefined;
    return i ? `to ${i.peer}` : n === "lo0" ? "Loopback interface" : undefined;
  },
  resolve: (raw) => {
    const n = parseIf(raw);
    return n && (n === "lo0" ? withLo : phys(r).includes(n as IfName)) ? n : undefined;
  },
});
const jnUnitArg = (r: MpR, withLo = false): CliArgSpec => ({
  choices: [...phys(r).map((i) => `${i}.0`), ...(withLo ? ["lo0.0"] : [])],
  describe: (c) => (mpIf(r, c.replace(".0", "")) ? `to ${mpIf(r, c.replace(".0", ""))!.peer}` : "Loopback"),
  resolve: (raw) => (/^(ge-0\/0\/[0-2]|lo0)\.0$/.test(raw) && ((withLo && raw === "lo0.0") || phys(r).includes(raw.slice(0, -2) as IfName)) ? raw.slice(0, -2) : undefined),
});
const jnPhysArg = (r: MpR): CliArgSpec => ({ choices: phys(r), describe: (c) => (mpIf(r, c) ? `to ${mpIf(r, c)!.peer}` : undefined), resolve: (raw) => (phys(r).includes(raw as IfName) ? raw : undefined) });
const ipArg: CliArgSpec = {
  choices: [...MP_ROUTERS.map((r) => MP_LO[r]), CE_IP.CE2, CE_IP.CE1],
  describe: (c) => ownerOf(c),
  resolve: (raw) => (/^(\d{1,3}\.){3}\d{1,3}$/.test(raw) && raw.split(".").every((o) => +o <= 255) ? raw : undefined),
};
const fecArg = (slash: boolean): CliArgSpec => ({
  choices: MP_ROUTERS.map((r) => (slash ? `${MP_LO[r]}/32` : MP_LO[r])),
  describe: (c) => MP_ROUTERS.find((r) => c.startsWith(MP_LO[r])),
  resolve: (raw) => {
    const m = slash ? /^((\d{1,3}\.){3}\d{1,3})\/32$/.exec(raw) : /^((\d{1,3}\.){3}\d{1,3})(\/32)?$/.exec(raw);
    return m ? m[1] : undefined;
  },
});
const metricArg = numArg(1, 16777214, ["10", "20", "100"], "Default metric (wide: 1–16777214)");
const mtuArg = numArg(1514, 9216, ["1514", "9216"], "MTU in bytes (including the 14-byte Ethernet header)");

// ---------------------------------------------------------------------------------------------------------------
// IOS XR outputs
// ---------------------------------------------------------------------------------------------------------------
function xrLdpNeighbor(s: MpState, r: MpR, brief: boolean): string {
  if (!s.cfg[r].ldpOn) return "% LDP is not configured";
  const up = MP_ROUTERS.filter((p) => p !== r && sessionUp(s.view, r, p));
  if (brief)
    return ["", "Peer               GR  NSR  Up Time     Discovery   Addresses     Labels", "                                        ipv4  ipv6  ipv4  ipv6  ipv4   ipv6", "-----------------  --  ---  ----------  ----------  ----------  ------------", ...up.map((p) => `${pad(ldpId(p), 19)}N   N    ${pad(spAge(s.clock, s.view.sessions.find((x) => sessKey(x.a, x.b) === sessKey(r, p))!.since), 12)}${pad(1, 6)}${pad(0, 6)}${pad(addrsOf(p).length, 6)}${pad(0, 6)}${pad(Object.keys(s.view.local[p]).length, 7)}0`)].join("\n");
  return up
    .map((p) => {
      const x = s.view.sessions.find((y) => sessKey(y.a, y.b) === sessKey(r, p))!;
      const act = MP_LO[r] > MP_LO[p];
      const ifs = mpIfs(r).filter((i) => i.peer === p && s.view.hello[`${r}|${i.ifn}`] === p);
      return [
        `Peer LDP Identifier: ${ldpId(p)}`,
        `  TCP connection: ${act ? `${MP_LO[r]}:646 - ${MP_LO[p]}:${40000 + MP_ROUTERS.indexOf(p) * 1111}` : `${MP_LO[p]}:646 - ${MP_LO[r]}:${40000 + MP_ROUTERS.indexOf(r) * 1111}`}`,
        "  Graceful Restart: No",
        "  Session Holdtime: 180 sec",
        `  State: Oper; Msgs sent/rcvd: ${30 + Math.floor((s.clock - x.since) / 60)}/${29 + Math.floor((s.clock - x.since) / 60)}; Downstream-Unsolicited`,
        `  Up time: ${spAge(s.clock, x.since)}`,
        "  LDP Discovery Sources:",
        `    IPv4: (${ifs.length})`,
        ...ifs.map((i) => `      ${xrIf(i.ifn)}`),
        "  Addresses bound to this peer:",
        `    IPv4: (${addrsOf(p).length})`,
        `      ${addrsOf(p).map((a) => pad(a, 15)).join("")}`.trimEnd(),
        "",
      ].join("\n");
    })
    .join("\n");
}
function xrDiscovery(s: MpState, r: MpR): string {
  if (!s.cfg[r].ldpOn) return "% LDP is not configured";
  const rows: string[] = [];
  for (const i of mpIfs(r)) {
    if (!ldpActive(s.cfg, r, i.ifn)) continue;
    if (!linkUp(s, i.link)) continue;
    const heard = s.view.hello[`${r}|${i.ifn}`];
    rows.push(`    ${xrIf(i.ifn)} : xmit${heard ? "/recv" : ""}`, "      VRF: 'default' (0x60000000)");
    if (heard) {
      const x = s.view.sessions.find((y) => sessKey(y.a, y.b) === sessKey(r, heard));
      rows.push(`      LDP Id: ${ldpId(heard)}, Transport address: ${MP_LO[heard]}`, "          Hold time: 15 sec (local:15 sec, peer:15 sec)", `          Established: ${spStamp(x?.since ?? 8).xr.replace(" UTC", "")} (${spAge(s.clock, x?.since ?? 8)} ago)`);
    }
  }
  return [`Local LDP Identifier: ${ldpId(r)}`, "Discovery Sources:", "  Interfaces:", ...rows].join("\n");
}
function xrBindings(s: MpState, r: MpR, only?: string): string {
  if (!s.cfg[r].ldpOn) return "% LDP is not configured";
  const out: string[] = [];
  for (const fec of fecs(s, r)) {
    if (only && fec !== only) continue;
    const b = lib(s.view, r, fec);
    if (b.local === undefined && !b.remote.length) continue;
    out.push(`${fec}/32, rev ${10 + fecs(s, r).indexOf(fec)}`, `        Local binding: label: ${b.local === IMPLICIT_NULL ? "ImpNull" : b.local === EXPLICIT_NULL ? "ExpNullv4" : b.local}`);
    if (b.remote.length) out.push(`        Remote bindings: (${b.remote.length} peers)`, "            Peer                Label    ", "            -----------------   ---------", ...b.remote.map((x) => `            ${pad(ldpId(x.peer), 20)}${x.label === IMPLICIT_NULL ? "ImpNull" : x.label === EXPLICIT_NULL ? "ExpNullv4" : x.label}`));
    else out.push("        No remote bindings");
  }
  return out.join("\n") || (only ? `% No binding for ${only}/32` : "");
}
function xrForwarding(s: MpState, r: MpR, only?: string): string {
  const rows: string[] = [];
  for (const e of lfib(s.view, r)) {
    if (only && e.fec !== only) continue;
    e.outs.forEach((o, k) => rows.push(`${pad(k === 0 ? e.inLabel : "", 7)}${pad(fmtOut(o.out), 12)}${pad(k === 0 ? `${e.fec}/32` : "", 19)}${pad(xrIf(o.nh.ifn, true), 13)}${pad(o.nh.ip, 16)}${s.tests.filter((t) => [t.fwd, t.back].some((p) => p?.hops.some((h) => h.dev === r && h.labels.length >= 0))).length * 120}`));
  }
  return ["Local  Outgoing    Prefix             Outgoing     Next Hop        Bytes       ", "Label  Label       or ID              Interface                    Switched    ", "------ ----------- ------------------ ------------ --------------- ------------", ...rows].join("\n");
}
function xrLdpIf(s: MpState, r: MpR): string {
  return ["Interface             VRF Name                        Config Enabled IGP-Auto-Cfg TE-Mesh-Grps", "--------------------- ------------------------------- ------ ------- ------------ ------------", ...mpIfs(r).filter((i) => s.cfg[r].ifs[i.ifn]!.ldp).map((i) => `${pad(xrIf(i.ifn, true), 22)}${pad("default", 32)}${pad("Y", 7)}${pad(ldpActive(s.cfg, r, i.ifn) ? "Y" : "N", 8)}${pad(0, 13)}Y/N`)].join("\n");
}
function xrSync(s: MpState, r: MpR): string {
  const out: string[] = [];
  for (const i of mpIfs(r)) {
    const f = s.cfg[r].ifs[i.ifn]!;
    if (!f.ldp && !f.sync) continue;
    const ready = sessionUp(s.view, r, i.peer) && !!s.view.hello[`${r}|${i.ifn}`];
    out.push(`${xrIf(i.ifn)}:`, "  VRF: 'default' (0x60000000)", `  Sync delay: Disabled`, `  Sync status: ${ready ? "Ready" : "Not ready"}`, ...(ready ? ["    Peers:", `      ${ldpId(i.peer)}`] : []), `  IGP sync configured: ${f.sync ? "Yes" : "No"}`, "");
  }
  return out.join("\n").trimEnd() || "% No LDP interfaces";
}
const XR_CODES = ["Codes: C - connected, S - static, R - RIP, B - BGP, (>) - Diversion path", "       D - EIGRP, EX - EIGRP external, O - OSPF, IA - OSPF inter area", "       i - ISIS, L1 - IS-IS level-1, L2 - IS-IS level-2", "       ia - IS-IS inter area, su - IS-IS summary null, * - candidate default", "       L - local, a - Application route, M - mobile route, t - Traffic Engineering", "", "Gateway of last resort is not set", ""];
type XrRt = { p: string; len: number; kind: "C" | "L" | "i L2" | "B"; metric: number; nh: { ip: string; ifn?: string }[]; ifn?: string };
function xrRib(s: MpState, r: MpR): XrRt[] {
  const out: XrRt[] = [{ p: MP_LO[r], len: 32, kind: "L", metric: 0, nh: [], ifn: "lo0" }];
  for (const i of mpIfs(r)) {
    if (!linkUp(s, i.link)) continue;
    out.push({ p: i.link.net, len: 31, kind: "C", metric: 0, nh: [], ifn: i.ifn }, { p: i.ip, len: 32, kind: "L", metric: 0, nh: [], ifn: i.ifn });
  }
  const ce = ceOf(r);
  if (ce) out.push({ p: CE_NET[ce].net, len: 24, kind: "C", metric: 0, nh: [], ifn: CE_IF }, { p: CE_NET[ce].peIp, len: 32, kind: "L", metric: 0, nh: [], ifn: CE_IF });
  for (const rt of s.view.igp[r] as MpIgpRoute[]) if (!out.some((x) => x.p === rt.p && x.len === rt.len)) out.push({ p: rt.p, len: rt.len, kind: "i L2", metric: rt.metric, nh: rt.nh.map((h) => ({ ip: h.ip, ifn: h.ifn })) });
  const far: MpCe | undefined = r === "PE1" ? "CE2" : r === "PE2" ? "CE1" : undefined;
  if (far) {
    const b = bgpRoute(s, r, CE_IP[far]);
    if (b) out.push({ p: CE_NET[far].net, len: 24, kind: "B", metric: 0, nh: [{ ip: b.nh }] });
  }
  const n = (ip: string) => ip.split(".").reduce((a, o) => a * 256 + Number(o), 0);
  return out.sort((a, b) => n(a.p) - n(b.p) || a.len - b.len);
}
function xrRouteLines(s: MpState, rt: XrRt): string[] {
  const p = `${rt.p}/${rt.len}`;
  if (rt.kind === "C" || rt.kind === "L") return [`${pad(rt.kind, 5)}${p} is directly connected, ${age(s)}, ${xrIf(rt.ifn!)}`];
  if (rt.kind === "B") return [`${pad("B", 5)}${p} [200/0] via ${rt.nh[0].ip}, ${age(s)}`];
  return rt.nh.map((h, k) => `${k === 0 ? pad(`${pad(rt.kind, 5)}${p}`, 22) : pad("", 22)}[115/${rt.metric}] via ${h.ip}, ${age(s)}, ${xrIf(h.ifn!)}`);
}
function xrRoute(s: MpState, r: MpR, filter?: "isis" | "bgp"): string {
  const rs = xrRib(s, r).filter((x) => !filter || (filter === "isis" ? x.kind === "i L2" : x.kind === "B"));
  return [...(filter ? [] : XR_CODES), ...rs.flatMap((x) => xrRouteLines(s, x))].join("\n");
}
function xrRouteIp(s: MpState, r: MpR, ip: string): string {
  const rt = xrRib(s, r).filter((x) => inPfx(ip, x.p, x.len)).sort((a, b) => b.len - a.len)[0];
  if (!rt) return "% Network not in table";
  const p = `${rt.p}/${rt.len}`;
  if (rt.kind === "C" || rt.kind === "L") return [`Routing entry for ${p}`, `  Known via "${rt.kind === "C" ? "connected" : "local"}", distance 0, metric 0 (connected)`, "  Routing Descriptor Blocks", `    directly connected, via ${xrIf(rt.ifn!)}`, "      Route metric is 0", "  No advertising protos."].join("\n");
  if (rt.kind === "B") return [`Routing entry for ${p}`, `  Known via "bgp 65000", distance 200, metric 0, type internal`, `  Installed ${spStamp(8).xr.replace(" UTC", "")} for ${age(s)}`, "  Routing Descriptor Blocks", `    ${rt.nh[0].ip}, from ${rt.nh[0].ip}`, "      Route metric is 0", "  No advertising protos."].join("\n");
  return [`Routing entry for ${p}`, `  Known via "isis CORE", distance 115, metric ${rt.metric}, type level-2`, `  Installed ${spStamp(8).xr.replace(" UTC", "")} for ${age(s)}`, "  Routing Descriptor Blocks", ...rt.nh.flatMap((h) => [`    ${h.ip}, from ${rt.p}, via ${xrIf(h.ifn!)}`, `      Route metric is ${rt.metric}`]), "  No advertising protos."].join("\n");
}
function xrCef(s: MpState, r: MpR, ip: string): string {
  const b = bgpRoute(s, r, ip);
  const rt = xrRib(s, r).filter((x) => inPfx(ip, x.p, x.len)).sort((a, c) => c.len - a.len)[0];
  if (!rt) return `${ip}/32, version 0, drop adjacency`;
  const head = `${rt.p}/${rt.len}, version ${40 + rt.len}, internal 0x1000001 0x0 (ptr 0x7fa1b2c3d0) [1], 0x0 (0x0), 0x0 (0x0)`;
  if (b) {
    const f = ftn(s.view, r, b.nh);
    return [head, ` Updated ${spStamp(8).xr.replace(" UTC", "")}`, " Prefix Len 24, traffic index 0, precedence n/a, priority 4", `   via ${b.nh}/32, 3 dependencies, recursive [flags 0x6000]`, ...f.map((x) => `    next hop ${x.nh.ip}/32 ${xrIf(x.nh.ifn, true)}    labels imposed {${x.out === "Unlabelled" ? "None" : x.out === "Pop" ? "ImplNull" : x.out}}`)].join("\n");
  }
  if (rt.kind === "C" || rt.kind === "L") return [head, ` Updated ${spStamp(8).xr.replace(" UTC", "")}`, `   attached to ${xrIf(rt.ifn!, true)}`].join("\n");
  const fec = rt.len === 32 ? ftn(s.view, r, rt.p) : [];
  return [head, ` Updated ${spStamp(8).xr.replace(" UTC", "")}`, ...rt.nh.map((h) => {
    const f = fec.find((x) => x.nh.ifn === h.ifn);
    return `   via ${h.ip}/32, ${xrIf(h.ifn!, true)}, ${f ? `labels imposed {${f.out === "Unlabelled" ? "None" : f.out === "Pop" ? "ImplNull" : f.out}}` : "no label"}`;
  })].join("\n");
}
function xrIsisNbr(s: MpState, r: MpR): string {
  const rows = mpIfs(r).filter((i) => igpAdj(s, i.link)).map((i) => `${pad(i.peer, 15)}${pad(xrIf(i.ifn, true), 17)}${pad("*PtoP*", 15)}${pad("Up", 6)}${pad(25, 9)}${pad("L2", 5)}Capable`);
  return ["IS-IS CORE neighbors:", "System Id      Interface        SNPA           State Holdtime Type IETF-NSF", ...rows, "", `Total neighbor count: ${rows.length}`].join("\n");
}
function xrIntBrief(s: MpState, r: MpR): string {
  const row = (n: string, st: string, lp: string, enc: string, mtu: number, bw: number) => `${lpad(n, 19)}${lpad(st, 12)}${lpad(lp, 12)}${lpad(enc, 19)}${lpad(mtu, 6)}${lpad(bw, 11)}`;
  return ["", "               Intf       Intf        LineP              Encap  MTU        BW", "               Name       State       State               Type (byte)    (Kbps)", "--------------------------------------------------------------------------------", row("Lo0", "up", "up", "Loopback", 1500, 0), ...mpIfs(r).map((i) => {
    const f = s.cfg[r].ifs[i.ifn]!;
    return row(xrIf(i.ifn, true), f.shut ? "admin-down" : "up", f.shut ? "admin-down" : linkUp(s, i.link) ? "up" : "down", "ARPA", f.mtu, 10000000);
  }), ...(ceOf(r) ? [row(xrIf(CE_IF, true), "up", "up", "ARPA", 1514, 1000000)] : [])].join("\n");
}
function xrInterface(s: MpState, r: MpR, ifn: string): string {
  const i = mpIf(r, ifn)!;
  const f = s.cfg[r].ifs[i.ifn]!;
  const c = s.ctr[`${r} ${ifn}`];
  const up = !f.shut && linkUp(s, i.link);
  return [`${xrIf(ifn)} is ${f.shut ? "administratively down" : up ? "up" : "down"}, line protocol is ${up ? "up" : "down"} `, "  Interface state transitions: 1", `  Description: to ${i.peer}`, `  Internet address is ${i.ip}/31`, `  MTU ${f.mtu} bytes, BW 10000000 Kbit (Max: 10000000 Kbit)`, "     reliability 255/255, txload 0/255, rxload 0/255", "  Encapsulation ARPA,", "  Full-duplex, 10000Mb/s, link type is force-up", `     ${c.pktIn} packets input, ${c.pktIn * 150} bytes, ${c.mtuDrops} total input drops`, `     ${c.pktOut} packets output, ${c.pktOut * 150} bytes, ${c.mtuDrops} total output drops`, `     Output ${c.mtuDrops} drops: MTU exceeded (labeled packet larger than ${f.mtu - 14} bytes)`].join("\n");
}
function xrLogging(s: MpState, r: MpR): string {
  const lines = s.sys.filter((x) => x.dev === r).slice(-30).map((x) => {
    const st = `RP/0/RP0/CPU0:${spStamp(x.t).xr}`;
    if (x.kind === "ldp-up") return `${st}: mpls_ldp[1186]: %ROUTING-LDP-5-NBR_CHANGE : VRF 'default' (0x60000000), Neighbor ${ldpId(x.nbr!)} is UP`;
    if (x.kind === "ldp-down") return `${st}: mpls_ldp[1186]: %ROUTING-LDP-5-NBR_CHANGE : VRF 'default' (0x60000000), Neighbor ${ldpId(x.nbr!)} is DOWN (${x.why?.includes("link") ? "Interface down" : x.why?.includes("transport") ? "No route to transport address" : "Discovery hold time expired"})`;
    if (x.kind === "isis-up" || x.kind === "isis-down") return `${st}: isis[1012]: %ROUTING-ISIS-5-ADJCHANGE : Adjacency to ${x.nbr} (${xrIf(x.ifn!)}) (L2) ${x.kind === "isis-up" ? "Up, New adjacency" : "Down, Interface state down"}`;
    if (x.kind === "commit") return `${st}: config[65857]: %MGBL-CONFIG-6-DB_COMMIT : Configuration committed by user 'admin'. Use 'show commit changes ${1000000000 + x.t}' to view the changes.`;
    return "";
  }).filter(Boolean);
  return ["Syslog logging: enabled (0 messages dropped, 0 flushes, 0 overruns)", `    Buffer logging: level debugging, ${lines.length} messages logged`, "", "Log Buffer (2097152 bytes):", "", ...lines].join("\n");
}
const resultChar = (p: MpPath, back?: MpPath) => (p.result === "ok" && back?.result === "ok" ? "!" : p.result === "ok" ? "." : p.result === "mtu" ? "M" : "U");
function xrPing(s: MpState, r: MpR, dst: string, src: string, count: number, size: number, df: boolean): string {
  const fwd = walk(s, r, src, dst, size);
  const back = fwd.result === "ok" ? walk(s, fwd.at, dst, src, size) : undefined;
  const ch = resultChar(fwd, back);
  const ok = ch === "!";
  return ["Type escape sequence to abort.", `Sending ${count}, ${size}-byte ICMP Echos to ${dst}${df ? " with DF bit set" : ""}, timeout is 2 seconds:`, (ch === "M" ? "." : ch).repeat(count), ok ? `Success rate is 100 percent (${count}/${count}), round-trip min/avg/max = 2/3/5 ms` : `Success rate is 0 percent (0/${count})`].join("\n");
}
function traceLines(p: MpPath, dst: string, junos: boolean): string[] {
  const out: string[] = [];
  p.hops.slice(1).forEach((h, k) => {
    const prev = p.hops[k];
    const last = k === p.hops.length - 2;
    const inIp = h.dev === "CE1" || h.dev === "CE2" ? CE_IP[h.dev] : h.inIf === CE_IF ? CE_NET[ceOf(h.dev as MpR)!].peIp : mpIf(h.dev as MpR, h.inIf!)?.ip ?? dst;
    const addr = last && p.result === "ok" ? dst : inIp;
    const lab = prev.labels[0];
    const fail = last && p.result !== "ok";
    const mark = fail ? (junos ? " !N" : " !N ") : "";
    if (junos) out.push(` ${k + 1}  ${addr} (${addr})  ${(1.8 + k * 0.4).toFixed(3)} ms${mark}  ${(1.6 + k * 0.4).toFixed(3)} ms${mark}  ${(1.7 + k * 0.4).toFixed(3)} ms${mark}${lab !== undefined && !fail ? `\n     MPLS Label=${lab} CoS=0 TTL=1 S=1` : ""}`);
    else out.push(` ${k + 1}  ${addr}${lab !== undefined && !fail ? ` [MPLS: Label ${lab} Exp 0]` : ""}${fail ? " !N  !N  !N" : ` ${2 + k} msec  ${2 + k} msec  ${3 + k} msec`}`);
  });
  return out;
}
function xrTrace(s: MpState, r: MpR, dst: string, src: string): string {
  const fwd = walk(s, r, src, dst, 60);
  return ["", "Type escape sequence to abort.", `Tracing the route to ${dst}`, "", ...traceLines(fwd, dst, false)].join("\n");
}
const LSP_CODES = ["Codes: '!' - success, 'Q' - request not sent, '.' - timeout,", "  'L' - labeled output interface, 'B' - unlabeled output interface,", "  'D' - DS Map mismatch, 'F' - no FEC mapping, 'f' - FEC mismatch,", "  'M' - malformed request, 'm' - unsupported tlvs, 'N' - no rx label,", "  'P' - no rx intf label prot, 'p' - premature termination of LSP,", "  'R' - transit router, 'I' - unknown upstream index,", "  'X' - unknown return code, 'x' - return code 0"];
function lspWalk(s: MpState, r: MpR, fec: string) {
  const fwd = walk(s, r, MP_LO[r], "127.0.0.1", 100, { lspFec: fec });
  const back = fwd.result === "ok" ? walk(s, fwd.at, fec, MP_LO[r], 100) : undefined;
  return { fwd, back, code: fwd.result === "ok" && back?.result === "ok" ? "!" : fwd.result === "label" ? "B" : fwd.result === "noroute" ? "Q" : "." };
}
function xrPingMpls(s: MpState, r: MpR, fec: string): string {
  const w = lspWalk(s, r, fec);
  return [`Sending 5, 100-byte MPLS Echos to ${fec}/32,`, "      timeout is 2 seconds, send interval is 0 msec:", "", ...LSP_CODES, "", "Type escape sequence to abort.", "", w.code.repeat(5), w.code === "!" ? "Success rate is 100 percent (5/5), round-trip min/avg/max = 2/3/5 ms" : "Success rate is 0 percent (0/5)"].join("\n");
}
function xrTraceMpls(s: MpState, r: MpR, fec: string): string {
  const w = lspWalk(s, r, fec);
  const mru = (dev: MpR, ifn?: string) => (ifn ? s.cfg[dev].ifs[ifn as IfName]!.mtu - 14 : 1500);
  const lines: string[] = [];
  w.fwd.hops.forEach((h, k) => {
    const dev = h.dev as MpR;
    const ip = k === 0 ? (h.outIf ? mpIf(dev, h.outIf)!.ip : MP_LO[dev]) : mpIf(dev, h.inIf!)!.ip;
    const lab = h.labels[0] !== undefined ? `[Labels: ${h.labels[0]} Exp: 0]` : h.op === "pop" ? "[Labels: implicit-null Exp: 0]" : h.op === "unlabelled" ? "[No Label]" : "";
    const last = k === w.fwd.hops.length - 1;
    const code = k === 0 ? " " : last && w.code === "!" ? "!" : h.op === "unlabelled" ? "B" : "L";
    lines.push(`${code} ${k} ${ip}${last && w.code === "!" ? "" : ` MRU ${mru(dev, h.outIf)} ${lab}`}${k === 0 ? "" : ` ${2 + k} ms`}`);
  });
  if (w.code !== "!" && w.fwd.result === "label") lines.push(`. ${w.fwd.hops.length} *`);
  return [`Tracing MPLS Label Switched Path to ${fec}/32, timeout is 2 seconds`, "", ...LSP_CODES, "", "Type escape sequence to abort.", "", ...lines].join("\n");
}

// ---------------------------------------------------------------------------------------------------------------
// Junos outputs
// ---------------------------------------------------------------------------------------------------------------
function jnLdpNeighbor(s: MpState, r: MpR): string {
  if (!s.cfg[r].ldpOn) return "";
  const rows = mpIfs(r).filter((i) => s.view.hello[`${r}|${i.ifn}`]).map((i) => `${pad(i.peerIp, 19)}${pad(jnIf(i.ifn), 19)}${pad(ldpId(i.peer), 23)}${lpad(11 + ((s.clock + MP_ROUTERS.indexOf(i.peer)) % 4), 4)}`);
  return ["Address            Interface          Label space ID         Hold time", ...rows].join("\n");
}
function jnLdpSession(s: MpState, r: MpR): string {
  if (!s.cfg[r].ldpOn) return "";
  const rows = peersOf(s, r).map((p) => {
    const x = s.view.sessions.find((y) => sessKey(y.a, y.b) === sessKey(r, p))!;
    return `${pad(MP_LO[p], 20)}${pad(x.up ? "Operational" : "Nonexistent", 12)}${pad(x.up ? "Open" : "Closed", 12)}${pad(x.up ? 24 + (s.clock % 6) : 0, 11)}DU`;
  });
  return ["  Address           State       Connection  Hold time  Adv. Mode", ...rows].join("\n");
}
function jnLdpIf(s: MpState, r: MpR): string {
  if (!s.cfg[r].ldpOn) return "";
  return ["Interface          Label space ID        Nbr count   Next hello", ...mpIfs(r).filter((i) => ldpActive(s.cfg, r, i.ifn)).map((i) => `${pad(jnIf(i.ifn), 19)}${pad(ldpId(r), 22)}${pad(s.view.hello[`${r}|${i.ifn}`] ? 1 : 0, 12)}${(s.clock % 5) + 1}`)].join("\n");
}
function jnLdpDb(s: MpState, r: MpR): string {
  if (!s.cfg[r].ldpOn) return "";
  const out: string[] = [];
  for (const p of MP_ROUTERS.filter((x) => x !== r && sessionUp(s.view, r, x))) {
    const inLabels = Object.entries(s.view.local[p]).sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));
    const outLabels = Object.entries(s.view.local[r]).sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));
    out.push(`Input label database, ${ldpId(r)}--${ldpId(p)}`, `  Labels received: ${inLabels.length}`, "  Label     Prefix", ...inLabels.map(([f, l]) => `${lpad(l, 7)}      ${f}/32`), "", `Output label database, ${ldpId(r)}--${ldpId(p)}`, `  Labels advertised: ${outLabels.length}`, "  Label     Prefix", ...outLabels.map(([f, l]) => `${lpad(l, 7)}      ${f}/32`), "");
  }
  return out.join("\n").trimEnd();
}
function jnMpls0(s: MpState, r: MpR): string {
  const es = lfib(s.view, r);
  const lines: string[] = ["0                  *[MPLS/0] " + age(s) + ", metric 1", "                       to table inet.0", "1                  *[MPLS/0] " + age(s) + ", metric 1", "                       Receive", "2                  *[MPLS/0] " + age(s) + ", metric 1", "                       Receive"];
  let count = 3;
  for (const e of es) {
    const act = (o: OutLabel) => (o === "Pop" ? "Pop      " : `Swap ${o}`);
    const entry = (lab: string) => [`${pad(lab, 19)}*[LDP/9] ${age(s)}, metric 1`, ...e.outs.map((o) => `                    >  to ${o.nh.ip} via ${jnIf(o.nh.ifn)}, ${act(o.out)}`.trimEnd())];
    lines.push(...entry(String(e.inLabel)));
    count++;
    if (e.outs.some((o) => o.out === "Pop")) {
      lines.push(...entry(`${e.inLabel}(S=0)`).map((l) => l.replace("Pop", "Pop")));
      count++;
    }
  }
  return [`mpls.0: ${count} destinations, ${count} routes (${count} active, 0 holddown, 0 hidden)`, "+ = Active Route, - = Last Active, * = Both", "", ...lines].join("\n");
}
function jnInet3(s: MpState, r: MpR): string {
  const rows: string[] = [];
  let n = 0;
  for (const rt of s.view.igp[r].filter((x) => x.len === 32)) {
    const f = ftn(s.view, r, rt.p);
    if (!f.length) continue;
    n++;
    rows.push(`${pad(`${rt.p}/32`, 19)}*[LDP/9] ${age(s)}, metric ${rt.metric}`, ...f.map((x) => `                    >  to ${x.nh.ip} via ${jnIf(x.nh.ifn)}${x.out === "Pop" ? "" : `, Push ${x.out}`}`));
  }
  return [`inet.3: ${n} destinations, ${n} routes (${n} active, 0 holddown, 0 hidden)`, "+ = Active Route, - = Last Active, * = Both", "", ...rows].join("\n");
}
function jnRouteIp(s: MpState, r: MpR, ip: string, hidden: boolean): string {
  const rib = xrRib(s, r);
  const all = rib.length;
  const head = [`inet.0: ${all} destinations, ${all} routes (${all} active, 0 holddown, ${hidden ? 1 : 0} hidden)`, "+ = Active Route, - = Last Active, * = Both", ""];
  const far: MpCe | undefined = r === "PE1" ? "CE2" : r === "PE2" ? "CE1" : undefined;
  const isBgp = far && inPfx(ip, CE_NET[far].net, 24);
  if (isBgp) {
    const b = bgpRoute(s, r, ip);
    const f = b ? ftn(s.view, r, b.nh) : [];
    const p = `${CE_NET[far!].net}/24`;
    const nhLo = MP_LO[CE_NET[far!].pe];
    if (hidden) return f.length && b ? "" : [...head, `${pad(p, 19)} [BGP/170] ${age(s)}, localpref 100, from ${nhLo}`, "                      AS path: I, validation-state: unverified", "                       Unusable"].join("\n");
    if (!b || !f.length) return "";
    return [...head, `${pad(p, 19)}*[BGP/170] ${age(s)}, localpref 100, from ${nhLo}`, "                      AS path: I, validation-state: unverified", ...f.map((x) => `                    >  to ${x.nh.ip} via ${jnIf(x.nh.ifn)}${x.out === "Pop" ? "" : `, Push ${x.out}`}`)].join("\n");
  }
  if (hidden) return "";
  const rt = rib.filter((x) => inPfx(ip, x.p, x.len)).sort((a, b) => b.len - a.len)[0];
  if (!rt) return "";
  const p = `${rt.p}/${rt.len}`;
  const lines = rt.kind === "C" ? [`${pad(p, 19)}*[Direct/0] ${age(s)}`, `                    >  via ${jnIf(rt.ifn!)}`] : rt.kind === "L" ? [`${pad(p, 19)}*[Local/0] ${age(s)}`, `                       Local via ${jnIf(rt.ifn!)}`] : [`${pad(p, 19)}*[IS-IS/18] ${age(s)}, metric ${rt.metric}`, ...rt.nh.map((h) => `                    >  to ${h.ip} via ${jnIf(h.ifn!)}`)];
  return [...head, ...lines].join("\n");
}
function jnIsisAdj(s: MpState, r: MpR): string {
  return ["Interface             System         L State         Hold (secs) SNPA", ...mpIfs(r).filter((i) => igpAdj(s, i.link)).map((i) => `${pad(jnIf(i.ifn), 22)}${pad(i.peer, 15)}${pad(2, 2)}${pad("Up", 14)}${lpad(25, 11)}`)].join("\n");
}
function jnTerse(s: MpState, r: MpR): string {
  const rows: string[] = [];
  for (const i of mpIfs(r)) {
    const f = s.cfg[r].ifs[i.ifn]!;
    const link = !f.shut && linkUp(s, i.link) ? "up" : "down";
    rows.push(`${pad(i.ifn, 24)}${pad(f.shut ? "down" : "up", 6)}${link}`, `${pad(`${i.ifn}.0`, 24)}${pad(f.shut ? "down" : "up", 6)}${pad(link, 5)}${pad("inet", 9)}${i.ip}/31`);
    if (f.isis) rows.push(`${pad("", 35)}iso`);
    if (f.fam) rows.push(`${pad("", 35)}mpls`);
  }
  if (ceOf(r)) rows.push(`${pad(CE_IF, 24)}${pad("up", 6)}up`, `${pad(`${CE_IF}.0`, 24)}${pad("up", 6)}${pad("up", 5)}${pad("inet", 9)}${CE_NET[ceOf(r)!].peIp}/24`);
  rows.push(`${pad("lo0.0", 24)}${pad("up", 6)}${pad("up", 5)}${pad("inet", 9)}${pad(MP_LO[r], 22)}--> 0/0`);
  return ["Interface               Admin Link Proto    Local                 Remote", ...rows].join("\n");
}
function jnInterface(s: MpState, r: MpR, ifn: string): string {
  const i = mpIf(r, ifn)!;
  const f = s.cfg[r].ifs[i.ifn]!;
  const c = s.ctr[`${r} ${ifn}`];
  return [`Physical interface: ${ifn}, ${f.shut ? "Administratively down" : "Enabled"}, Physical link is ${!f.shut && linkUp(s, i.link) ? "Up" : "Down"}`, `  Description: to ${i.peer}`, `  Link-level type: Ethernet, MTU: ${f.mtu}, Link-mode: Full-duplex, Speed: 10Gbps,`, `  Input packets : ${c.pktIn}`, `  Output packets: ${c.pktOut}`, "", `  Logical interface ${ifn}.0`, `    Protocol inet, MTU: ${f.mtu - 14}`, `      Addresses, Flags: Is-Preferred Is-Primary`, `        Destination: ${i.link.net}/31, Local: ${i.ip}`, ...(f.fam ? [`    Protocol mpls, MTU: ${f.mtu - 14}, Maximum labels: 3`] : [])].join("\n");
}
function jnLog(s: MpState, r: MpR): string {
  return s.sys.filter((x) => x.dev === r).slice(-30).map((x) => {
    const st = `${spStamp(x.t).junos}  ${r}`;
    if (x.kind === "ldp-up") return `${st} rpd[1532]: RPD_LDP_NBRUP: LDP neighbor ${MP_LO[x.nbr!]} (${jnIf(mpIfs(r).find((i) => i.peer === x.nbr)?.ifn ?? "lo0")}) is up`;
    if (x.kind === "ldp-down") return `${st} rpd[1532]: RPD_LDP_NBRDOWN: LDP neighbor ${MP_LO[x.nbr!]} (${jnIf(mpIfs(r).find((i) => i.peer === x.nbr)?.ifn ?? "lo0")}) is down, reason: ${x.why?.includes("link") ? "Interface down" : x.why?.includes("transport") ? "Session closed (no route to transport address)" : "Hello hold time expired"}`;
    if (x.kind === "isis-up") return `${st} rpd[1532]: RPD_ISIS_ADJUP: IS-IS new L2 adjacency to ${x.nbr} on ${jnIf(x.ifn!)}`;
    if (x.kind === "isis-down") return `${st} rpd[1532]: RPD_ISIS_ADJDOWN: IS-IS lost L2 adjacency to ${x.nbr} on ${jnIf(x.ifn!)}, reason: Interface Down`;
    if (x.kind === "commit") return `${st} mgd[4417]: UI_COMMIT: User 'admin' requested 'commit' operation (comment: none)`;
    return "";
  }).filter(Boolean).join("\n");
}
function jnPing(s: MpState, r: MpR, dst: string, src: string, count: number, size: number): string {
  const fwd = walk(s, r, src, dst, size);
  const back = fwd.result === "ok" ? walk(s, fwd.at, dst, src, size) : undefined;
  const ok = fwd.result === "ok" && back?.result === "ok";
  const ttl = back ? 64 - Math.max(0, back.hops.length - 2) : 0;
  const lines = [`PING ${dst} (${dst}): ${size - 28} data bytes`];
  if (ok) for (let k = 0; k < count; k++) lines.push(`${size - 20} bytes from ${dst}: icmp_seq=${k} ttl=${ttl} time=${(2.1 + ((k * 0.31) % 0.8)).toFixed(3)} ms`);
  lines.push(`--- ${dst} ping statistics ---`, `${count} packets transmitted, ${ok ? count : 0} packets received, ${ok ? 0 : 100}% packet loss`);
  if (ok) lines.push("round-trip min/avg/max/stddev = 2.101/2.402/2.913/0.301 ms");
  return lines.join("\n");
}
function jnTrace(s: MpState, r: MpR, dst: string, src: string): string {
  return [`traceroute to ${dst} (${dst}), 30 hops max, 52 byte packets`, ...traceLines(walk(s, r, src, dst, 60), dst, true)].join("\n");
}
function jnPingMpls(s: MpState, r: MpR, fec: string): string {
  const w = lspWalk(s, r, fec);
  if (w.fwd.result === "noroute" || (w.fwd.hops.length === 1 && w.code !== "!")) return `error: no LDP LSP to ${fec}/32 (no route in inet.3)`;
  return [w.code === "!" ? "!!!!!" : ".....", "--- lsping statistics ---", `5 packets transmitted, ${w.code === "!" ? 5 : 0} packets received, ${w.code === "!" ? 0 : 100}% packet loss`].join("\n");
}
function jnTraceMpls(s: MpState, r: MpR, fec: string): string {
  const w = lspWalk(s, r, fec);
  if (w.fwd.result === "noroute" || w.fwd.hops.length === 1) return `error: no LDP LSP to ${fec}/32 (no route in inet.3)`;
  const lines = ["  Probe options: ttl 64, retries 3, wait 10, paths 16, exp 7, fanout 16", "  ttl    Label  Protocol    Address(next hop)      Probe status"];
  w.fwd.hops.slice(1).forEach((h, k) => {
    const prev = w.fwd.hops[k];
    const last = k === w.fwd.hops.length - 2;
    const lab = prev.labels[0] ?? IMPLICIT_NULL;
    lines.push(`${lpad(k + 1, 5)}${lpad(lab, 9)}  ${pad("LDP", 12)}${pad(mpIf(h.dev as MpR, h.inIf!)?.ip ?? "", 23)}${last && w.code === "!" ? "Egress" : "Success"}`);
  });
  lines.push(`  Path 1 via ${jnIf(w.fwd.hops[0].outIf ?? "lo0")} destination 127.0.0.64`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------------------------------------------
export function mpXrLines(r: MpR, c: MpRtr): string[] {
  const out: string[] = [`hostname ${r}`, "!", "interface Loopback0", ` ipv4 address ${MP_LO[r]} 255.255.255.255`, "!"];
  for (const i of mpIfs(r)) {
    const f = c.ifs[i.ifn]!;
    out.push(`interface ${xrIf(i.ifn)}`, ` description to ${i.peer}`, ` mtu ${f.mtu}`, ` ipv4 address ${i.ip} 255.255.255.254`, ...(f.shut ? [" shutdown"] : []), "!");
  }
  if (ceOf(r)) out.push(`interface ${xrIf(CE_IF)}`, ` description to ${ceOf(r)}`, ` ipv4 address ${CE_NET[ceOf(r)!].peIp} 255.255.255.0`, "!");
  out.push("router isis CORE", " is-type level-2-only", ` net 49.0001.0000.0000.000${MP_ROUTERS.indexOf(r) + 1}.00`, " address-family ipv4 unicast", "  metric-style wide", " !");
  if (c.lo) out.push(" interface Loopback0", "  passive", "  address-family ipv4 unicast", "  !", " !");
  for (const i of mpIfs(r)) {
    const f = c.ifs[i.ifn]!;
    if (!f.isis) continue;
    out.push(` interface ${xrIf(i.ifn)}`, "  point-to-point", "  address-family ipv4 unicast", ...(f.metric !== 10 ? [`   metric ${f.metric}`] : []), ...(f.sync ? ["   mpls ldp sync"] : []), "  !", " !");
  }
  out.push("!");
  if (ceOf(r)) {
    const other = r === "PE1" ? "PE2" : "PE1";
    out.push("router bgp 65000", " bgp router-id " + MP_LO[r], " address-family ipv4 unicast", `  network ${CE_NET[ceOf(r)!].net}/24`, " !", ` neighbor ${MP_LO[other]}`, "  remote-as 65000", "  update-source Loopback0", "  address-family ipv4 unicast", "  !", " !", "!");
  }
  if (c.ldpOn) {
    out.push("mpls ldp", ` router-id ${MP_LO[r]}`, " address-family ipv4", "  label", "   local", "    allocate for host-routes", ...(c.explicitNull ? ["    advertise", "     explicit-null", "    !"] : []), "   !", "  !", " !");
    for (const i of mpIfs(r)) if (c.ifs[i.ifn]!.ldp) out.push(` interface ${xrIf(i.ifn)}`, " !");
    out.push("!");
  }
  return out;
}
export function mpJnStmts(r: MpR, c: MpRtr): JStmt[] {
  const out: JStmt[] = [];
  for (const i of mpIfs(r)) {
    const f = c.ifs[i.ifn]!;
    out.push({ path: ["interfaces", i.ifn], leaf: `description "to ${i.peer}"` }, { path: ["interfaces", i.ifn], leaf: `mtu ${f.mtu}` });
    if (f.shut) out.push({ path: ["interfaces", i.ifn], leaf: "disable" });
    out.push({ path: ["interfaces", i.ifn, "unit 0", "family inet"], leaf: `address ${i.ip}/31` });
    if (f.isis) out.push({ path: ["interfaces", i.ifn, "unit 0", "family iso"], leaf: "" });
    if (f.fam) out.push({ path: ["interfaces", i.ifn, "unit 0", "family mpls"], leaf: "" });
  }
  if (ceOf(r)) out.push({ path: ["interfaces", CE_IF, "unit 0", "family inet"], leaf: `address ${CE_NET[ceOf(r)!].peIp}/24` });
  out.push({ path: ["interfaces", "lo0", "unit 0", "family inet"], leaf: `address ${MP_LO[r]}/32` }, { path: ["interfaces", "lo0", "unit 0", "family iso"], leaf: `address 49.0001.0000.0000.000${MP_ROUTERS.indexOf(r) + 1}.00` });
  out.push({ path: ["routing-options"], leaf: `router-id ${MP_LO[r]}` }, { path: ["routing-options"], leaf: "autonomous-system 65000" });
  if (ceOf(r)) {
    const other = r === "PE1" ? "PE2" : "PE1";
    out.push({ path: ["protocols", "bgp", "group IBGP"], leaf: "type internal" }, { path: ["protocols", "bgp", "group IBGP"], leaf: `local-address ${MP_LO[r]}` }, { path: ["protocols", "bgp", "group IBGP"], leaf: "export CUSTOMER" }, { path: ["protocols", "bgp", "group IBGP"], leaf: `neighbor ${MP_LO[other]}` });
  }
  out.push({ path: ["protocols", "isis"], leaf: "level 1 disable" });
  for (const i of mpIfs(r)) {
    const f = c.ifs[i.ifn]!;
    if (!f.isis) continue;
    out.push({ path: ["protocols", "isis", `interface ${i.ifn}.0`], leaf: "point-to-point" });
    if (f.sync) out.push({ path: ["protocols", "isis", `interface ${i.ifn}.0`], leaf: "ldp-synchronization" });
    if (f.metric !== 10) out.push({ path: ["protocols", "isis", `interface ${i.ifn}.0`], leaf: `level 2 metric ${f.metric}` });
  }
  if (c.lo) out.push({ path: ["protocols", "isis", "interface lo0.0"], leaf: "passive" });
  const mplsIfs = mpIfs(r).filter((i) => c.ifs[i.ifn]!.mplsIf);
  for (const i of mplsIfs) out.push({ path: ["protocols", "mpls"], leaf: `interface ${i.ifn}.0` });
  if (c.ldpOn) {
    if (c.explicitNull) out.push({ path: ["protocols", "ldp"], leaf: "explicit-null" });
    const ldpIfs = mpIfs(r).filter((i) => c.ifs[i.ifn]!.ldp);
    for (const i of ldpIfs) out.push({ path: ["protocols", "ldp"], leaf: `interface ${i.ifn}.0` });
    if (!ldpIfs.length && !c.explicitNull) out.push({ path: ["protocols", "ldp"], leaf: "" });
  }
  return out;
}
const ifc = (c: MpRtr, ifn: string) => c.ifs[ifn as IfName]!;
function stmts(r: MpR): SpCfgStmt<MpRtr>[] {
  const P2P = "% This lab keeps every core link point-to-point.";
  return [
    // IOS XR
    { id: "mpls-ldp", summary: "Label Distribution Protocol", xr: { mode: "config", syntax: "mpls ldp", enter: "ldp", apply: (c) => ((c.ldpOn = true), c), no: (c) => { c.ldpOn = false; c.explicitNull = false; for (const k of Object.keys(c.ifs)) ifc(c, k).ldp = false; return c; } } },
    { id: "ldp-rid", summary: "Configure the LDP router ID", args: { ip: { choices: [MP_LO[r]], describe: () => "This router's loopback", resolve: (x) => (x === MP_LO[r] ? x : undefined) } }, xr: { mode: "ldp", syntax: "router-id <ip>", apply: (c) => c } },
    { id: "ldp-if", summary: "Enable LDP on an interface", args: { if: xrIfArg(r) }, xr: { mode: "ldp", syntax: "interface <if>", enter: "ldp-if", apply: (c, a) => { Object.assign(ifc(c, a.if), { ldp: true, mplsIf: true, fam: true }); return c; }, no: (c, a) => ((ifc(c, a.if).ldp = false), c) } },
    { id: "ldp-af", summary: "Configure the IPv4 address family", xr: { mode: "ldp", syntax: "address-family ipv4", enter: "ldp-af", apply: (c) => c } },
    { id: "ldp-expnull", summary: "Advertise explicit-null for the router's own prefixes", xr: { mode: "ldp-af", syntax: "label local advertise explicit-null", apply: (c) => ((c.explicitNull = true), c), no: (c) => ((c.explicitNull = false), c) } },
    { id: "ldp-hostroutes", summary: "Allocate local labels for host routes only", xr: { mode: "ldp-af", syntax: "label local allocate for host-routes", apply: (c) => c, no: () => "% This lab labels loopback (/32) FECs only." } },
    { id: "router-isis", summary: "IS-IS routing protocol", args: { tag: choiceArg(["CORE"], () => "Instance tag") }, xr: { mode: "config", syntax: "router isis <tag>", enter: "isis", apply: (c) => c } },
    { id: "isis-if", summary: "Enter the IS-IS interface configuration submode", args: { if: xrIfArg(r, true) }, xr: { mode: "isis", syntax: "interface <if>", enter: "isis-if", apply: (c, a) => { if (a.if === "lo0") c.lo = true; else ifc(c, a.if).isis = true; return c; }, no: (c, a) => { if (a.if === "lo0") c.lo = false; else Object.assign(ifc(c, a.if), { isis: false, sync: false }); return c; } } },
    { id: "isis-p2p", summary: "Treat the interface as point-to-point", xr: { mode: "isis-if", syntax: "point-to-point", apply: (c) => c, no: () => P2P } },
    { id: "isis-passive", summary: "Advertise the prefix but send no hellos", xr: { mode: "isis-if", syntax: "passive", apply: (c, _a, x) => (x.if === "lo0" ? c : "% This lab only uses passive on Loopback0.") } },
    { id: "isis-if-af", summary: "Enter the interface IPv4 unicast address family", xr: { mode: "isis-if", syntax: "address-family ipv4 unicast", enter: "isis-if-af", apply: (c) => c } },
    { id: "isis-metric", summary: "Set the default metric for this interface", args: { n: metricArg }, xr: { mode: "isis-if-af", syntax: "metric <n>", noSyntax: "metric", apply: (c, a, x) => (x.if === "lo0" ? "% This lab keeps Loopback0 at metric 10." : ((ifc(c, x.if).metric = +a.n), c)), no: (c, _a, x) => (x.if === "lo0" ? c : ((ifc(c, x.if).metric = MP_LINKS.find((l) => (l.a === r && l.ai === x.if) || (l.b === r && l.bi === x.if))!.metric), c)) } },
    { id: "isis-sync", summary: "Enable MPLS LDP synchronization", xr: { mode: "isis-if-af", syntax: "mpls ldp sync", apply: (c, _a, x) => (x.if === "lo0" ? "% Not on a loopback." : ((ifc(c, x.if).sync = true), c)), no: (c, _a, x) => (x.if === "lo0" ? c : ((ifc(c, x.if).sync = false), c)) } },
    { id: "interface", summary: "Select an interface to configure", args: { if: xrIfArg(r) }, xr: { mode: "config", syntax: "interface <if>", enter: "if" } },
    { id: "mtu", summary: "Set the interface MTU", args: { n: mtuArg }, xr: { mode: "if", syntax: "mtu <n>", noSyntax: "mtu", apply: (c, a, x) => ((ifc(c, x.if).mtu = +a.n), c), no: (c, _a, x) => ((ifc(c, x.if).mtu = 1514), c) } },
    { id: "shutdown", summary: "Shutdown the selected interface", xr: { mode: "if", syntax: "shutdown", apply: (c, _a, x) => ((ifc(c, x.if).shut = true), c), no: (c, _a, x) => ((ifc(c, x.if).shut = false), c) } },

    // Junos
    { id: "j-ldp", summary: "LDP options", junos: { syntax: "protocols ldp", set: (c) => ((c.ldpOn = true), c), del: (c) => { c.ldpOn = false; c.explicitNull = false; for (const k of Object.keys(c.ifs)) ifc(c, k).ldp = false; return c; } } },
    { id: "j-ldp-if", summary: "Enable LDP on an interface", args: { if: jnUnitArg(r) }, junos: { syntax: "protocols ldp interface <if>", set: (c, a) => ((c.ldpOn = true), (ifc(c, a.if).ldp = true), c), del: (c, a) => ((ifc(c, a.if).ldp = false), c) } },
    { id: "j-ldp-en", summary: "Advertise explicit-null for the router's own prefixes", junos: { syntax: "protocols ldp explicit-null", set: (c) => ((c.ldpOn = true), (c.explicitNull = true), c), del: (c) => ((c.explicitNull = false), c) } },
    { id: "j-mpls-if", summary: "Enable MPLS on an interface", args: { if: jnUnitArg(r) }, junos: { syntax: "protocols mpls interface <if>", set: (c, a) => ((ifc(c, a.if).mplsIf = true), c), del: (c, a) => ((ifc(c, a.if).mplsIf = false), c) } },
    { id: "j-fam", summary: "MPLS family on the logical unit", args: { if: jnPhysArg(r) }, junos: { syntax: "interfaces <if> unit 0 family mpls", set: (c, a) => ((ifc(c, a.if).fam = true), c), del: (c, a) => ((ifc(c, a.if).fam = false), c) } },
    { id: "j-isis-if", summary: "Include an interface in IS-IS", args: { if: jnUnitArg(r, true) }, junos: { syntax: "protocols isis interface <if>", set: (c, a) => (a.if === "lo0" ? ((c.lo = true), c) : ((ifc(c, a.if).isis = true), c)), del: (c, a) => (a.if === "lo0" ? ((c.lo = false), c) : (Object.assign(ifc(c, a.if), { isis: false, sync: false }), c)) } },
    { id: "j-isis-p2p", summary: "Treat the interface as point-to-point", args: { if: jnUnitArg(r) }, junos: { syntax: "protocols isis interface <if> point-to-point", set: (c, a) => ((ifc(c, a.if).isis = true), c), del: () => P2P.slice(2) } },
    { id: "j-isis-passive", summary: "Advertise the prefix but send no hellos", args: { if: jnUnitArg(r, true) }, junos: { syntax: "protocols isis interface <if> passive", set: (c, a) => (a.if === "lo0" ? ((c.lo = true), c) : "error: this lab only uses passive on lo0.0"), del: (c, a) => (a.if === "lo0" ? ((c.lo = false), c) : c) } },
    { id: "j-isis-sync", summary: "Advertise maximum metric until LDP is operational", args: { if: jnUnitArg(r) }, junos: { syntax: "protocols isis interface <if> ldp-synchronization", set: (c, a) => ((ifc(c, a.if).sync = true), c), del: (c, a) => ((ifc(c, a.if).sync = false), c) } },
    { id: "j-isis-metric", summary: "Metric for this interface at this level", args: { if: jnUnitArg(r), l: choiceArg(["2"], () => "Level 2"), n: metricArg }, junos: { syntax: "protocols isis interface <if> level <l> metric <n>", set: (c, a) => ((ifc(c, a.if).metric = +a.n), c) } },
    { id: "j-isis-metric-del", summary: "Remove the metric for this interface at this level", args: { if: jnUnitArg(r), l: choiceArg(["2"], () => "Level 2") }, junos: { syntax: "protocols isis interface <if> level <l> metric", del: (c, a) => ((ifc(c, a.if).metric = MP_LINKS.find((l) => (l.a === r && l.ai === a.if) || (l.b === r && l.bi === a.if))!.metric), c) } },
    { id: "j-mtu", summary: "Maximum transmission unit packet size", args: { if: jnPhysArg(r), n: mtuArg }, junos: { syntax: "interfaces <if> mtu <n>", set: (c, a) => ((ifc(c, a.if).mtu = +a.n), c) } },
    { id: "j-mtu-del", summary: "Restore the default MTU", args: { if: jnPhysArg(r) }, junos: { syntax: "interfaces <if> mtu", del: (c, a) => ((ifc(c, a.if).mtu = 1514), c) } },
    { id: "j-disable", summary: "Disable this interface", args: { if: jnPhysArg(r) }, junos: { syntax: "interfaces <if> disable", set: (c, a) => ((ifc(c, a.if).shut = true), c), del: (c, a) => ((ifc(c, a.if).shut = false), c) } },
  ];
}

// ---------------------------------------------------------------------------------------------------------------
// Command sets
// ---------------------------------------------------------------------------------------------------------------
const srcArg = (r: MpR): CliArgSpec => ({ choices: ["Loopback0", MP_LO[r]], describe: () => "Source address or interface", resolve: (raw) => (/^(loopback0|lo0)$/i.test(raw) ? MP_LO[r] : addrsOf(r).includes(raw) ? raw : undefined) });
const countArg = numArg(1, 100, ["5", "10"], "Number of pings");
const sizeArg = numArg(36, 9000, ["100", "1500"], "Packet size in bytes");
function egressSrc(s: MpState, r: MpR, dst: string): string {
  const b = bgpRoute(s, r, dst);
  const rt = s.view.igp[r].filter((x) => inPfx(b ? b.nh : dst, x.p, x.len)).sort((a, c) => c.len - a.len)[0];
  const conn = mpIfs(r).find((i) => inPfx(dst, i.link.net, 31));
  return conn ? conn.ip : rt ? mpIf(r, rt.nh[0].ifn)!.ip : MP_LO[r];
}
function act(api: MpCliApi, kind: "ping" | "trace" | "lsp" | "lsptrace", r: MpR, dst: string, src?: string, size = 100) {
  api.act({ type: "test", kind, from: r, dst, src, size });
}
export function mpXrSpec(api: MpCliApi, r: MpR): SpXrSpec<MpRtr> {
  const s = api.s;
  const sh = (id: string, syntax: string, summary: string, run: SpCmd["run"], args?: SpCmd["args"]): SpCmd => ({ id, syntax, summary, run, args });
  return {
    stmts: stmts(r).filter((x) => x.xr),
    prompts: { config: "config", ldp: "config-ldp", "ldp-if": "config-ldp-if", "ldp-af": "config-ldp-af", isis: "config-isis", "isis-if": "config-isis-if", "isis-if-af": "config-isis-if-af", if: "config-if" },
    lines: (c) => mpXrLines(r, c),
    help: { "show mpls": "MPLS information", "show mpls ldp": "LDP information", "show route": "IP routing table", ping: "Send echo messages", traceroute: "Trace route to destination" },
    shows: [
      sh("ldp-nbr", "show mpls ldp neighbor", "LDP sessions in detail", () => xrLdpNeighbor(s, r, false)),
      sh("ldp-nbr-b", "show mpls ldp neighbor brief", "LDP sessions, one line each", () => xrLdpNeighbor(s, r, true)),
      sh("ldp-disc", "show mpls ldp discovery", "LDP Hellos sent and received", () => xrDiscovery(s, r)),
      sh("ldp-bind", "show mpls ldp bindings", "The LIB: local and remote label bindings", () => xrBindings(s, r)),
      sh("ldp-bind-p", "show mpls ldp bindings <fec>", "Bindings for one FEC", (a) => xrBindings(s, r, a.fec), { fec: fecArg(true) }),
      sh("ldp-if", "show mpls ldp interface brief", "Interfaces with LDP configured", () => xrLdpIf(s, r)),
      sh("ldp-sync", "show mpls ldp igp sync", "LDP-IGP synchronization status", () => xrSync(s, r)),
      sh("fwd", "show mpls forwarding", "The LFIB", () => xrForwarding(s, r)),
      sh("fwd-p", "show mpls forwarding prefix <fec>", "The LFIB entry for one FEC", (a) => xrForwarding(s, r, a.fec), { fec: fecArg(true) }),
      sh("cef", "show cef <ip>", "The forwarding entry for a destination (labels imposed)", (a) => xrCef(s, r, a.ip), { ip: ipArg }),
      sh("route", "show route", "The IPv4 routing table", () => xrRoute(s, r)),
      sh("route-isis", "show route isis", "IS-IS routes", () => xrRoute(s, r, "isis")),
      sh("route-bgp", "show route bgp", "BGP routes", () => xrRoute(s, r, "bgp")),
      sh("route-ip", "show route <ip>", "The route a destination uses", (a) => xrRouteIp(s, r, a.ip), { ip: ipArg }),
      sh("isis-nbr", "show isis neighbors", "IS-IS neighbors", () => xrIsisNbr(s, r)),
      sh("int-brief", "show interfaces brief", "Interfaces, state and MTU", () => xrIntBrief(s, r)),
      sh("int", "show interfaces <if>", "One interface: state, MTU, drops", (a) => xrInterface(s, r, a.if), { if: xrIfArg(r) }),
      sh("logging", "show logging", "The syslog buffer", () => xrLogging(s, r)),
    ],
    exec: [
      sh("ping", "ping <ip>", "Send 5 ICMP echoes", (a) => {
        const src = egressSrc(s, r, a.ip);
        act(api, "ping", r, a.ip, src);
        return xrPing(s, r, a.ip, src, 5, 100, false);
      }, { ip: ipArg }),
      sh("ping-src", "ping <ip> source <src>", "Send 5 ICMP echoes from a chosen source", (a) => (act(api, "ping", r, a.ip, a.src), xrPing(s, r, a.ip, a.src, 5, 100, false)), { ip: ipArg, src: srcArg(r) }),
      sh("ping-size", "ping <ip> size <n> donnotfrag", "Send 5 echoes of <n> bytes with DF set", (a) => {
        const src = egressSrc(s, r, a.ip);
        act(api, "ping", r, a.ip, src, +a.n);
        return xrPing(s, r, a.ip, src, 5, +a.n, true);
      }, { ip: ipArg, n: sizeArg }),
      sh("trace", "traceroute <ip>", "Trace the path hop by hop (shows labels)", (a) => {
        const src = egressSrc(s, r, a.ip);
        act(api, "trace", r, a.ip, src);
        return xrTrace(s, r, a.ip, src);
      }, { ip: ipArg }),
      sh("ping-mpls", "ping mpls ipv4 <fec>", "LSP ping: test the label switched path to a FEC", (a) => (act(api, "lsp", r, a.fec), xrPingMpls(s, r, a.fec)), { fec: fecArg(true) }),
      sh("trace-mpls", "traceroute mpls ipv4 <fec>", "LSP traceroute: every hop's label", (a) => (act(api, "lsptrace", r, a.fec), xrTraceMpls(s, r, a.fec)), { fec: fecArg(true) }),
      sh("clear-counters", "clear counters", "Clear the interface counters", () => (api.act({ type: "clear-counters" }), "Clear \"show interface\" counters on all interfaces [confirm]")),
    ],
  };
}
export function mpJunosSpec(api: MpCliApi, r: MpR): SpJunosSpec<MpRtr> {
  const s = api.s;
  const sh = (id: string, syntax: string, summary: string, run: SpCmd["run"], args?: SpCmd["args"]): SpCmd => ({ id, syntax, summary, run, args });
  return {
    stmts: stmts(r).filter((x) => x.junos),
    jstmts: (c) => mpJnStmts(r, c),
    help: { "show ldp": "Show Label Distribution Protocol information", "show route": "Show routing table information", ping: "Ping remote target", traceroute: "Trace route to remote host" },
    shows: [
      sh("ldp-nbr", "show ldp neighbor", "LDP Hello adjacencies", () => jnLdpNeighbor(s, r)),
      sh("ldp-sess", "show ldp session", "LDP sessions", () => jnLdpSession(s, r)),
      sh("ldp-if", "show ldp interface", "Interfaces running LDP", () => jnLdpIf(s, r)),
      sh("ldp-db", "show ldp database", "Labels received and advertised, per session", () => jnLdpDb(s, r)),
      sh("mpls0", "show route table mpls.0", "The label forwarding table", () => jnMpls0(s, r)),
      sh("inet3", "show route table inet.3", "LDP routes used to resolve BGP next hops", () => jnInet3(s, r)),
      sh("route-ip", "show route <ip>", "The route a destination uses (inet.0)", (a) => jnRouteIp(s, r, a.ip, false), { ip: ipArg }),
      sh("route-hidden", "show route <ip> hidden", "Routes Junos cannot use", (a) => {
        const out = jnRouteIp(s, r, a.ip, true);
        return out ? out : { output: "", explanation: "Nothing hidden: every route to this destination is usable." };
      }, { ip: ipArg }),
      sh("isis-adj", "show isis adjacency", "IS-IS adjacencies", () => jnIsisAdj(s, r)),
      sh("terse", "show interfaces terse", "Interfaces, state and families", () => jnTerse(s, r)),
      sh("int", "show interfaces <if>", "One interface", (a) => jnInterface(s, r, a.if), { if: jnPhysArg(r) }),
      sh("log", "show log messages", "The system log", () => jnLog(s, r)),
    ],
    op: [
      sh("ping", "ping <ip> count <n>", "Ping <n> times", (a) => {
        const src = egressSrc(s, r, a.ip);
        act(api, "ping", r, a.ip, src);
        return jnPing(s, r, a.ip, src, +a.n, 84);
      }, { ip: ipArg, n: countArg }),
      sh("ping-size", "ping <ip> size <n> do-not-fragment count <c>", "Ping with a payload of <n> bytes, DF set", (a) => {
        const src = egressSrc(s, r, a.ip);
        act(api, "ping", r, a.ip, src, +a.n + 28);
        return jnPing(s, r, a.ip, src, +a.c, +a.n + 28);
      }, { ip: ipArg, n: numArg(8, 9000, ["72", "1472"], "Payload size in bytes"), c: countArg }),
      sh("trace", "traceroute <ip>", "Trace the path hop by hop (shows labels)", (a) => {
        const src = egressSrc(s, r, a.ip);
        act(api, "trace", r, a.ip, src);
        return jnTrace(s, r, a.ip, src);
      }, { ip: ipArg }),
      sh("ping-mpls", "ping mpls ldp <fec>", "LSP ping toward an LDP FEC", (a) => (act(api, "lsp", r, a.fec), jnPingMpls(s, r, a.fec)), { fec: fecArg(false) }),
      sh("trace-mpls", "traceroute mpls ldp <fec>", "LSP traceroute toward an LDP FEC", (a) => (act(api, "lsptrace", r, a.fec), jnTraceMpls(s, r, a.fec)), { fec: fecArg(false) }),
      sh("clear-stats", "clear interfaces statistics all", "Clear the interface counters", () => (api.act({ type: "clear-counters" }), "")),
    ],
  };
}
export function mpSets(api: MpCliApi, r: MpR): Partial<Record<CliVendor, CliCommandSet>> {
  return { cisco: buildXrSet(api.dev, mpXrSpec(api, r)), juniper: buildJunosSet(api.dev, mpJunosSpec(api, r)) };
}
export const mpPipe = (api: MpCliApi, r: MpR) => ({ config: junosPipeConfig(api.dev, { jstmts: (c: MpRtr) => mpJnStmts(r, c) }), rollbacks: api.dev.hist.length });

/** CE1 / CE2: Linux hosts behind the PEs. */
export function ceSet(api: { s: MpState; act: (a: MpAction) => MpState }, ce: MpCe): CliCommandSet {
  const s = api.s;
  const me = CE_IP[ce];
  const ping = (dst: string, size: number, count: number) => {
    api.act({ type: "test", kind: "ce", from: ce, dst, size: size + 28 });
    const fwd = walk(s, ce, me, dst, size + 28);
    const back = fwd.result === "ok" ? walk(s, fwd.at, dst, me, size + 28) : undefined;
    const ok = fwd.result === "ok" && back?.result === "ok";
    const lines = [`PING ${dst} (${dst}) ${size}(${size + 28}) bytes of data.`];
    if (ok) for (let k = 1; k <= count; k++) lines.push(`${size + 8} bytes from ${dst}: icmp_seq=${k} ttl=${64 - Math.max(0, (back?.hops.length ?? 2) - 2)} time=${(3.2 + k * 0.21).toFixed(2)} ms`);
    lines.push("", `--- ${dst} ping statistics ---`, `${count} packets transmitted, ${ok ? count : 0} received, ${ok ? 0 : 100}% packet loss, time ${count * 1000 - 999}ms`);
    if (ok) lines.push("rtt min/avg/max/mdev = 3.402/3.611/3.989/0.201 ms");
    return lines.join("\n");
  };
  const dst: CliArgSpec = { choices: [ce === "CE1" ? CE_IP.CE2 : CE_IP.CE1], describe: (c) => ownerOf(c), resolve: (raw) => (/^(\d{1,3}\.){3}\d{1,3}$/.test(raw) ? raw : undefined) };
  return {
    vendor: "cisco",
    deviceId: ce,
    deviceName: ce,
    prompt: `admin@${ce.toLowerCase()}:~$ `,
    commands: [
      { id: "ce-ping", syntax: "ping -c <n> <ip>", summary: "Send <n> echo requests", args: { n: countArg, ip: dst }, run: (a) => ({ output: ping(a.ip, 56, +a.n) }) },
      { id: "ce-ping-big", syntax: "ping -c <n> <-M> do -s <size> <ip>", summary: "Echo requests of <size> bytes, don't fragment", args: { n: countArg, "-M": { choices: ["-M"], describe: () => "Path MTU discovery mode", resolve: (raw) => (raw === "-M" ? raw : undefined) }, size: numArg(8, 9000, ["1472", "56"], "Payload bytes (1472 + 28 = a 1500-byte packet)"), ip: dst }, run: (a) => ({ output: ping(a.ip, +a.size, +a.n) }) },
      { id: "ce-trace", syntax: "traceroute <ip>", summary: "Show the path (core hops report their MPLS label, RFC 4950)", args: { ip: dst }, run: (a) => ({ output: [`traceroute to ${a.ip} (${a.ip}), 30 hops max, 60 byte packets`, ...traceLines(walk(s, ce, me, a.ip, 60), a.ip, true).map((l) => l.replace(/\n {5}MPLS Label=(\d+) CoS=0 TTL=1 S=1/, " <MPLS:L=$1,E=0,S=1,T=1>"))].join("\n") }) },
      { id: "ce-route", syntax: "ip route", summary: "The host's routing table", run: () => ({ output: `default via ${CE_NET[ce].peIp} dev eth0 proto static\n${CE_NET[ce].net}/24 dev eth0 proto kernel scope link src ${me}` }) },
      { id: "ce-addr", syntax: "ip addr", summary: "The host's addresses", run: () => ({ output: `1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536\n    inet 127.0.0.1/8 scope host lo\n2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500\n    inet ${me}/24 brd ${CE_NET[ce].net.replace(/\.0$/, ".255")} scope global eth0` }) },
    ],
  };
}

export function mpStaticApi(s: MpState, r: MpR): MpCliApi {
  return { s, act: () => s, dev: { host: r, running: s.cfg[r], hist: s.hist[r], setCand: () => undefined, xr: [], setXr: () => undefined, edit: false, setEdit: () => undefined, commit: () => undefined } };
}
export const mpClone = spClone;
export { CORE_MTU };
