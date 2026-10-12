import type { CliArgSpec, CliCommandSet, CliVendor } from "@/lib/cli/types";
import { buildJunosSet, choiceArg, junosPipeConfig, numArg, type SpCfgStmt, type SpCmd, type SpDevCli, type SpJunosSpec } from "@/components/sp-lab/spCli";
import { lpad, pad, spAge, spClone, spStamp, type JStmt } from "@/components/sp-lab/spKit";
import { EV_LEAVES, EV_LINKS, EV_LO, EV_ROUTERS, HOSTS, OTHER, coreIfs, hostIfs, isLeaf, localVnis, macTable, remoteVteps, routeKey, type EvAction, type EvCfg, type EvIf, type EvLeaf, type EvR, type EvRoute, type EvState } from "@/lib/sim-engine/scenarios/evNet";

/**
 * Command line of the EVPN-VXLAN Lab — Junos (QFX-style) on LEAF1, SPINE1 and LEAF2. Every output is printed from the lab
 * model: the EVPN database, the Ethernet switching table, the EVPN routes in BGP, the remote VTEPs, OSPF and BGP.
 *
 *   show evpn database · show ethernet-switching table · show ethernet-switching interface <if> ·
 *   show ethernet-switching vxlan-tunnel-end-point remote · show route table bgp.evpn.0 · show bgp summary ·
 *   show ospf neighbor · show route <lo> · show route table inet.0 · show log messages · clear ethernet-switching table
 *   configure → set interfaces <if> unit 0 family ethernet-switching interface-mode access | vlan members <v> ·
 *   vlans <v> vlan-id <n> | vxlan vni <n> · switch-options vtep-source-interface lo0.0 | route-distinguisher <rd> |
 *   vrf-target <rt> · protocols evpn encapsulation vxlan | extended-vni-list <n> | vni-options vni <n> vrf-target <rt> ·
 *   protocols bgp group OVERLAY neighbor <ip> | family evpn signaling · protocols ospf area 0.0.0.0 interface <if> |
 *   interface lo0.0 passive · commit
 */

export interface EvCliApi {
  s: EvState;
  act: (a: EvAction) => EvState;
  dev: SpDevCli<EvCfg>;
}

const ipRe = /^(\d{1,3}\.){3}\d{1,3}$/;
const wordRe = /^[A-Za-z][\w-]{0,31}$/;
const rtRe = /^target:(\d{1,10}:\d{1,10})$/;
const accessArg = (r: EvR): CliArgSpec => ({ choices: hostIfs(r).map((x) => x.port), describe: (c) => `to ${hostIfs(r).find((x) => x.port === c)?.host ?? "?"}`, resolve: (raw) => (hostIfs(r).some((x) => x.port === raw) ? raw : undefined) });
const fabricArg = (r: EvR): CliArgSpec => ({ choices: [...coreIfs(r).map((x) => `${x.ifn}.0`), "lo0.0"], describe: (c) => (c === "lo0.0" ? "the loopback (the VTEP address)" : `to ${coreIfs(r).find((x) => `${x.ifn}.0` === c)?.peer ?? "?"}`), resolve: (raw) => (raw === "lo0.0" || coreIfs(r).some((x) => `${x.ifn}.0` === raw) ? raw : undefined) });
const vlanArg = (s: EvState, r: EvR): CliArgSpec => ({ choices: [...new Set([...Object.keys(s.cfg[r].vlans), "V10", "V20"])], describe: (c) => (s.cfg[r].vlans[c] ? `VLAN ${s.cfg[r].vlans[c].id}${s.cfg[r].vlans[c].vni ? `, VNI ${s.cfg[r].vlans[c].vni}` : ""}` : "VLAN name"), resolve: (raw) => (wordRe.test(raw) ? raw : undefined) });
const vniArg = numArg(1, 16777214, ["10010", "10020"], "VXLAN network identifier");
const rtArg: CliArgSpec = { choices: ["target:65000:10010", "target:65000:10020"], describe: () => "Route target (target:ASN:nn)", resolve: (raw) => (rtRe.test(raw) ? raw.slice(7) : undefined) };

// ---------------------------------------------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------------------------------------------
const ts = (s: EvState, t: number) => `${spStamp(t).junos}`;
function evpnDatabase(s: EvState, l: EvLeaf): string {
  const v = s.view;
  const rows: string[] = [];
  for (const vni of localVnis(s.cfg[l])) {
    const vl = Object.entries(s.cfg[l].vlans).find(([, x]) => x.vni === vni)?.[0];
    for (const m of s.fdb[l].filter((x) => x.vlan === vl)) rows.push(`     ${pad(vni, 11)}${pad(m.mac, 19)}${pad(`${m.port}.0`, 31)}${pad(ts(s, m.t), 17)}${m.ip ?? ""}`);
    for (const r of v.usable[l].filter((x) => x.type === 2 && !x.ip && x.vni === vni)) rows.push(`     ${pad(vni, 11)}${pad(r.mac!, 19)}${pad(r.nh, 31)}${pad(ts(s, s.clock - 1), 17)}${v.usable[l].find((y) => y.type === 2 && y.mac === r.mac && y.ip)?.ip ?? ""}`);
  }
  return ["Instance: default-switch", "VLAN  DomainId  MAC address        Active source                  Timestamp        IP address", ...rows].join("\n");
}
function switchingTable(s: EvState, l: EvLeaf): string {
  const t = macTable(s.cfg, s.view, s.fdb, l);
  const rows = t.map((m) => `   ${pad(m.vlan, 20)}${pad(m.mac, 20)}${pad(m.remote ? "DR" : "D", 12)}${pad("-", 7)}${pad(m.where, 23)}${pad(m.remote ? 1714 : 0, 10)}0`);
  return ["", "MAC flags (S - static MAC, D - dynamic MAC, L - locally learned, P - Persistent static", "           SE - statistics enabled, NM - non configured MAC, R - remote PE MAC, O - ovsdb MAC)", "", "", `Ethernet switching table : ${t.length} entries, ${t.length} learned`, "Routing instance : default-switch", "   Vlan                MAC                 MAC         Age    Logical                NH        RTR", "   name                address             flags              interface              Index     ID", ...rows].join("\n");
}
function switchingInterface(s: EvState, l: EvLeaf, ifn: EvIf): string {
  const p = s.cfg[l].ports[ifn];
  if (!p) return "";
  const vl = p.vlan ? s.cfg[l].vlans[p.vlan] : undefined;
  return [
    "Routing Instance Name : default-switch",
    "Logical Interface flags (DL - disable learning, AD - packet action drop,",
    "                         LH - MAC limit hit, DN - interface down,",
    "                         MMAS - Mac-move action shutdown, AS - Autostate-exclude enabled,",
    "                         SCTL - shutdown by Storm-control, MI - MAC+IP limit hit)",
    "",
    "Logical         Vlan          TAG     MAC         MAC+IP       STP         Logical           Tagging",
    "interface       members               limit       limit        state       interface flags",
    `${pad(`${ifn}.0`, 38)}${pad(65535, 12)}${pad(0, 39)}untagged`,
    ...(p.vlan ? [`${pad("", 16)}${pad(p.vlan, 14)}${pad(vl?.id ?? "?", 8)}${pad(65535, 12)}${pad(0, 13)}${pad("Forwarding", 30)}untagged`] : []),
  ].join("\n");
}
function remoteVtepTable(s: EvState, l: EvLeaf): string {
  const v = s.view;
  const vteps = [...new Set(localVnis(s.cfg[l]).flatMap((n) => remoteVteps(v, l, n)))];
  const out = ["Logical System Name       Id  SVTEP-IP         IFL   L3-Idx    SVTEP-Mode    ELP-SVTEP-IP", `${pad("<default>", 26)}${pad(0, 4)}${pad(s.cfg[l].vtep ? EV_LO[l] : "0.0.0.0", 17)}${pad("lo0.0", 6)}0`];
  for (const vt of vteps) {
    out.push(" RVTEP-IP         IFL-Idx   Interface    NH-Id   RVTEP-Mode  ELP-IP        Flags", ` ${pad(vt, 17)}${pad(586, 10)}${pad("vtep.32769", 13)}${pad(1714, 8)}RNVE`, "    VNID          MC-Group-IP", ...localVnis(s.cfg[l]).filter((n) => remoteVteps(v, l, n).includes(vt)).map((n) => `    ${pad(n, 14)}0.0.0.0`));
  }
  return out.join("\n");
}
const evpnName = (r: EvRoute) => (r.type === 3 ? `3:${r.rd}::${r.vni}::${r.nh}/248 IM` : `2:${r.rd}::${r.vni}::${r.mac}${r.ip ? `::${r.ip}` : ""}/304 MAC/IP`);
function bgpEvpn(s: EvState, l: EvLeaf): string {
  const v = s.view;
  const own = v.adv.filter((r) => r.leaf === l);
  const kept = v.kept[l];
  const all = [...kept, ...own].sort((a, b) => routeKey(a).localeCompare(routeKey(b)));
  const nh = coreIfs(l)[0];
  const lines = all.flatMap((r) => (r.leaf === l ? [evpnName(r), `                   *[EVPN/170] ${spAge(s.clock, 30)}`, "                       Indirect"] : [evpnName(r), `                   *[BGP/170] ${spAge(s.clock, 25)}, localpref 100, from ${r.nh}`, "                      AS path: I, validation-state: unverified", `                    >  to ${nh.peerIp} via ${nh.ifn}.0`]));
  return [`bgp.evpn.0: ${all.length} destinations, ${all.length} routes (${all.length} active, 0 holddown, 0 hidden)`, ...(all.length ? ["+ = Active Route, - = Last Active, * = Both", "", ...lines] : [])].join("\n");
}
function bgpSummary(s: EvState, l: EvLeaf): string {
  const v = s.view;
  const b = s.cfg[l].bgp;
  if (!b?.nbr) return "BGP is not running";
  const rx = v.received[l].length;
  const kept = v.kept[l].length;
  const tot = v.adv.filter((r) => r.leaf === l).length + kept;
  return [
    "Threading mode: BGP I/O",
    `Groups: 1 Peers: 1 Down peers: ${v.bgp.up ? 0 : 1}`,
    "Table          Tot Paths  Act Paths Suppressed    History Damp State    Pending",
    ...(b.evpn ? ["bgp.evpn.0", `${lpad(tot, 23)}${lpad(tot, 11)}${lpad(0, 11)}${lpad(0, 11)}${lpad(0, 11)}${lpad(0, 11)}`] : ["inet.0", `${lpad(0, 23)}${lpad(0, 11)}${lpad(0, 11)}${lpad(0, 11)}${lpad(0, 11)}${lpad(0, 11)}`]),
    "Peer                     AS      InPkt     OutPkt    OutQ   Flaps Last Up/Dwn State|#Active/Received/Accepted/Damped...",
    `${pad(b.nbr, 21)}${lpad(65000, 6)}${lpad(v.bgp.up ? 120 : 0, 11)}${lpad(v.bgp.up ? 122 : 0, 11)}${lpad(0, 8)}${lpad(0, 8)} ${lpad(v.bgp.up ? spAge(s.clock, 25).replace(/^00:/, "") : "1:00", 11)} ${v.bgp.up ? "Establ" : "Active"}`,
    ...(v.bgp.up ? (v.bgp.evpn ? [`  bgp.evpn.0: ${kept}/${rx}/${kept}/0`, `  default-switch.evpn.0: ${v.usable[l].length}/${v.usable[l].length}/${v.usable[l].length}/0`] : ["  inet.0: 0/0/0/0"]) : []),
  ].join("\n");
}
function ospfNeighbor(s: EvState, r: EvR): string {
  const rows = coreIfs(r).filter((x) => s.view.ospf[x.link.id]).map((x) => `${pad(x.peerIp, 17)}${pad(`${x.ifn}.0`, 20)}${pad("Full", 9)}${pad(EV_LO[x.peer], 17)}${lpad(128, 3)}${lpad(36, 6)}`);
  return ["Address          Interface              State           ID               Pri  Dead", ...rows].join("\n");
}
function routeTo(s: EvState, r: EvR, ip: string): string {
  const target = EV_ROUTERS.find((x) => EV_LO[x] === ip);
  if (!target) return "";
  if (target === r) return [`inet.0: 7 destinations, 7 routes (7 active, 0 holddown, 0 hidden)`, "+ = Active Route, - = Last Active, * = Both", "", `${pad(`${ip}/32`, 19)}*[Direct/0] 01:00:00`, "                    >  via lo0.0"].join("\n");
  if (!s.view.reach[r][ip]) return "";
  const nh = r === "SPINE1" ? coreIfs(r).find((x) => x.peer === target)! : coreIfs(r)[0];
  const metric = r === "SPINE1" || target === "SPINE1" ? 1 : 2;
  return [`inet.0: 7 destinations, 7 routes (7 active, 0 holddown, 0 hidden)`, "+ = Active Route, - = Last Active, * = Both", "", `${pad(`${ip}/32`, 19)}*[OSPF/10] ${spAge(s.clock, 15)}, metric ${metric}`, `                    >  to ${nh.peerIp} via ${nh.ifn}.0`].join("\n");
}
function inet0(s: EvState, r: EvR): string {
  const rows: [string, string[]][] = [];
  for (const x of coreIfs(r)) {
    const net = x.ip.replace(/\.(\d+)$/, (_, o) => `.${+o - (+o % 2)}`);
    rows.push([`${net}/31`, [`${pad(`${net}/31`, 19)}*[Direct/0] 01:00:00`, `                    >  via ${x.ifn}.0`]], [`${x.ip}/32`, [`${pad(`${x.ip}/32`, 19)}*[Local/0] 01:00:00`, `                       Local via ${x.ifn}.0`]]);
  }
  for (const t of EV_ROUTERS) {
    const ip = EV_LO[t];
    if (t === r) rows.push([`${ip}/32`, [`${pad(`${ip}/32`, 19)}*[Direct/0] 01:00:00`, "                    >  via lo0.0"]]);
    else if (s.view.reach[r][ip]) {
      const nh = r === "SPINE1" ? coreIfs(r).find((x) => x.peer === t)! : coreIfs(r)[0];
      rows.push([`${ip}/32`, [`${pad(`${ip}/32`, 19)}*[OSPF/10] ${spAge(s.clock, 15)}, metric ${r === "SPINE1" || t === "SPINE1" ? 1 : 2}`, `                    >  to ${nh.peerIp} via ${nh.ifn}.0`]]);
    }
  }
  const num = (p: string) => p.split("/")[0].split(".").reduce((n, o) => n * 256 + +o, 0);
  rows.sort((a, b) => num(a[0]) - num(b[0]));
  const n = rows.length;
  return [`inet.0: ${n} destinations, ${n} routes (${n} active, 0 holddown, 0 hidden)`, "+ = Active Route, - = Last Active, * = Both", "", ...rows.flatMap((x) => x[1])].join("\n");
}
function log(s: EvState, r: EvR): string {
  return s.sys.filter((x) => x.dev === r).slice(-30).map((x) => {
    const st = `${spStamp(x.t).junos}  ${r}`;
    if (x.kind === "ospf-up") return `${st} rpd[1532]: RPD_OSPF_NBRUP: OSPF neighbor ${x.peer} (realm ospf-v2 area 0.0.0.0) state changed from Loading to Full due to LoadDone`;
    if (x.kind === "ospf-down") return `${st} rpd[1532]: RPD_OSPF_NBRDOWN: OSPF neighbor ${x.peer} (realm ospf-v2 area 0.0.0.0) state changed from Full to Down due to KillNbr`;
    if (x.kind === "bgp-up") return `${st} rpd[1532]: BGP_PEER_STATE_CHANGE: BGP peer ${x.peer} (Internal AS 65000) changed state from OpenConfirm to Established (event RecvKeepAlive)`;
    if (x.kind === "bgp-down") return `${st} rpd[1532]: BGP_PEER_STATE_CHANGE: BGP peer ${x.peer} (Internal AS 65000) changed state from Established to Active (event ConnectRetry)`;
    if (x.kind === "clear") return `${st} mgd[4417]: UI_CMDLINE_READ_LINE: User 'admin', command 'clear ethernet-switching table'`;
    return `${st} mgd[4417]: UI_COMMIT: User 'admin' requested 'commit' operation (comment: none)`;
  }).join("\n");
}

// ---------------------------------------------------------------------------------------------------------------
// Configuration as Junos prints it
// ---------------------------------------------------------------------------------------------------------------
export function evJnStmts(r: EvR, c: EvCfg): JStmt[] {
  const out: JStmt[] = [];
  for (const x of coreIfs(r)) out.push({ path: ["interfaces", x.ifn, "unit 0", "family inet"], leaf: `address ${x.ip}/31` });
  for (const x of hostIfs(r)) {
    const p = c.ports[x.port];
    if (!p) continue;
    const f = ["interfaces", x.port, "unit 0", "family ethernet-switching"];
    out.push({ path: f, leaf: "interface-mode access" });
    if (p.vlan) out.push({ path: [...f, "vlan"], leaf: `members ${p.vlan}` });
  }
  out.push({ path: ["interfaces", "lo0", "unit 0", "family inet"], leaf: `address ${EV_LO[r]}/32` }, { path: ["routing-options"], leaf: `router-id ${EV_LO[r]}` }, { path: ["routing-options"], leaf: "autonomous-system 65000" });
  const o = ["protocols", "ospf", "area 0.0.0.0"];
  for (const x of coreIfs(r).filter((y) => c.ospf[y.ifn])) out.push({ path: [...o, `interface ${x.ifn}.0`], leaf: "" });
  if (c.ospfLo) out.push({ path: [...o, "interface lo0.0"], leaf: "passive" });
  if (c.bgp) {
    const g = ["protocols", "bgp", "group OVERLAY"];
    out.push({ path: g, leaf: "type internal" }, { path: g, leaf: `local-address ${EV_LO[r]}` });
    if (c.bgp.evpn) out.push({ path: [...g, "family evpn"], leaf: "signaling" });
    if (c.bgp.nbr) out.push({ path: g, leaf: `neighbor ${c.bgp.nbr}` });
  }
  if (c.evpn) {
    const e = ["protocols", "evpn"];
    if (c.evpn.vxlan) out.push({ path: e, leaf: "encapsulation vxlan" });
    if (c.evpn.extended.length) out.push({ path: e, leaf: `extended-vni-list ${c.evpn.extended.length > 1 ? `[ ${c.evpn.extended.join(" ")} ]` : c.evpn.extended[0]}` });
    for (const [vni, rt] of Object.entries(c.evpn.targets)) out.push({ path: [...e, "vni-options", `vni ${vni}`], leaf: `vrf-target target:${rt}` });
  }
  if (c.vtep || c.rd) {
    const so = ["switch-options"];
    if (c.vtep) out.push({ path: so, leaf: "vtep-source-interface lo0.0" });
    if (c.rd) out.push({ path: so, leaf: `route-distinguisher ${c.rd}` });
    if (c.vtep) out.push({ path: so, leaf: "vrf-target target:65000:1" });
  }
  for (const [name, v] of Object.entries(c.vlans).sort(([a], [b]) => a.localeCompare(b))) {
    out.push({ path: ["vlans", name], leaf: `vlan-id ${v.id}` });
    if (v.vni !== undefined) out.push({ path: ["vlans", name, "vxlan"], leaf: `vni ${v.vni}` });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Configuration statements
// ---------------------------------------------------------------------------------------------------------------
const spineOnly = "error: SPINE1 is the IP underlay only: no VLANs, no EVPN, no VTEP";
function stmts(r: EvR, s: EvState): SpCfgStmt<EvCfg>[] {
  const leaf = isLeaf(r);
  const acc = accessArg(r);
  const fab = fabricArg(r);
  const vl = vlanArg(s, r);
  const ev = (c: EvCfg) => (c.evpn ??= { vxlan: false, extended: [], targets: {} });
  const bg = (c: EvCfg) => (c.bgp ??= { evpn: false });
  const all: SpCfgStmt<EvCfg>[] = [
    { id: "mode", summary: "Make the port an access port", args: { p: acc, m: choiceArg(["access"], () => "Access port: untagged, one VLAN") }, junos: { syntax: "interfaces <p> unit 0 family ethernet-switching interface-mode <m>", set: (c, a) => ((c.ports[a.p as EvIf] ??= {}), c), del: (c, a) => (delete c.ports[a.p as EvIf], c) } },
    { id: "members", summary: "The VLAN of the access port", args: { p: acc, v: vl }, junos: { syntax: "interfaces <p> unit 0 family ethernet-switching vlan members <v>", set: (c, a) => ((c.ports[a.p as EvIf] ??= {}), (c.ports[a.p as EvIf]!.vlan = a.v), c), del: (c, a) => (c.ports[a.p as EvIf] && (c.ports[a.p as EvIf]!.vlan = undefined), c) } },
    { id: "esw", summary: "Ethernet switching on the port (delete removes it)", args: { p: acc }, junos: { syntax: "interfaces <p> unit 0 family ethernet-switching", del: (c, a) => (delete c.ports[a.p as EvIf], c) } },
    { id: "vlan-id", summary: "A VLAN and its ID (locally significant)", args: { v: vl, n: numArg(1, 4094, ["10", "20"], "VLAN ID") }, junos: { syntax: "vlans <v> vlan-id <n>", set: (c, a) => (leaf ? ((c.vlans[a.v] ??= { id: +a.n }), (c.vlans[a.v].id = +a.n), c) : spineOnly), del: (c, a) => (delete c.vlans[a.v], c) } },
    { id: "vlan", summary: "A VLAN (delete removes it)", args: { v: vl }, junos: { syntax: "vlans <v>", del: (c, a) => (delete c.vlans[a.v], c) } },
    { id: "vni", summary: "Map the VLAN to a VXLAN network identifier (fabric-wide)", args: { v: vl, n: vniArg }, junos: { syntax: "vlans <v> vxlan vni <n>", set: (c, a) => (c.vlans[a.v] ? ((c.vlans[a.v].vni = +a.n), c) : `error: vlans ${a.v}: vlan-id must be configured first`), del: (c, a) => (c.vlans[a.v] && (c.vlans[a.v].vni = undefined), c) } },
    { id: "vxlan", summary: "The VLAN's VXLAN mapping (delete removes it)", args: { v: vl }, junos: { syntax: "vlans <v> vxlan", del: (c, a) => (c.vlans[a.v] && (c.vlans[a.v].vni = undefined), c) } },
    { id: "vtep", summary: "The VTEP source address: the loopback", args: { i: choiceArg(["lo0.0"], () => "the loopback") }, junos: { syntax: "switch-options vtep-source-interface <i>", set: (c) => (leaf ? ((c.vtep = true), c) : spineOnly), del: (c) => ((c.vtep = false), c) } },
    { id: "rd", summary: "Route distinguisher of this leaf's EVPN routes", args: { rd: { choices: [`${EV_LO[r]}:10010`], describe: () => "RD (IP:nn)", resolve: (raw) => (/^(\d{1,3}\.){3}\d{1,3}:\d{1,5}$/.test(raw) ? raw : undefined) } }, junos: { syntax: "switch-options route-distinguisher <rd>", set: (c, a) => (leaf ? ((c.rd = a.rd), c) : spineOnly), del: (c) => ((c.rd = undefined), c) } },
    { id: "swrt", summary: "The instance-wide route target", args: { rt: rtArg }, junos: { syntax: "switch-options vrf-target <rt>", set: (c) => (leaf ? c : spineOnly), del: (c) => c } },
    { id: "encap", summary: "EVPN over VXLAN", args: { e: choiceArg(["vxlan"], () => "VXLAN data plane") }, junos: { syntax: "protocols evpn encapsulation <e>", set: (c) => (leaf ? ((ev(c).vxlan = true), c) : spineOnly), del: (c) => (c.evpn && (c.evpn.vxlan = false), c) } },
    { id: "ext", summary: "A VNI this leaf extends across the fabric with EVPN", args: { n: vniArg }, junos: { syntax: "protocols evpn extended-vni-list <n>", set: (c, a) => (leaf ? (ev(c).extended.includes(+a.n) || ev(c).extended.push(+a.n), c) : spineOnly), del: (c, a) => (c.evpn && (c.evpn.extended = c.evpn.extended.filter((x) => x !== +a.n)), c) } },
    { id: "vnirt", summary: "The VNI's route target (import and export)", args: { n: vniArg, rt: rtArg }, junos: { syntax: "protocols evpn vni-options vni <n> vrf-target <rt>", set: (c, a) => (leaf ? ((ev(c).targets[+a.n] = a.rt), c) : spineOnly), del: (c, a) => (c.evpn && delete c.evpn.targets[+a.n], c) } },
    { id: "vnio", summary: "The VNI's options (delete removes them)", args: { n: vniArg }, junos: { syntax: "protocols evpn vni-options vni <n>", del: (c, a) => (c.evpn && delete c.evpn.targets[+a.n], c) } },
    { id: "evpn", summary: "EVPN (delete removes it)", junos: { syntax: "protocols evpn", del: (c) => ((c.evpn = undefined), c) } },
    { id: "vtep-all", summary: "The VTEP source (delete removes it)", junos: { syntax: "switch-options vtep-source-interface", del: (c) => ((c.vtep = false), c) } },
    { id: "rd-all", summary: "The route distinguisher (delete removes it)", junos: { syntax: "switch-options route-distinguisher", del: (c) => ((c.rd = undefined), c) } },
    { id: "nbr", summary: "The other leaf's loopback (iBGP EVPN session)", args: { g: choiceArg(["OVERLAY"], () => "BGP group"), ip: { choices: leaf ? [EV_LO[OTHER[r as EvLeaf]]] : [], describe: () => "The other VTEP's loopback", resolve: (raw) => (ipRe.test(raw) ? raw : undefined) } }, junos: { syntax: "protocols bgp group <g> neighbor <ip>", set: (c, a) => (leaf ? ((bg(c).nbr = a.ip), c) : "error: SPINE1 takes no part in the overlay"), del: (c) => (c.bgp && (c.bgp.nbr = undefined), c) } },
    { id: "fam", summary: "Carry EVPN routes on the session", args: { g: choiceArg(["OVERLAY"], () => "BGP group"), sg: choiceArg(["signaling"], () => "EVPN signaling") }, junos: { syntax: "protocols bgp group <g> family evpn <sg>", set: (c) => (leaf ? ((bg(c).evpn = true), c) : "error: SPINE1 takes no part in the overlay"), del: (c) => (c.bgp && (c.bgp.evpn = false), c) } },
    { id: "ospf", summary: "Run OSPF on a fabric interface", args: { i: fab }, junos: { syntax: "protocols ospf area 0.0.0.0 interface <i>", set: (c, a) => (a.i === "lo0.0" ? (c.ospfLo = true) : (c.ospf[a.i.replace(/\.0$/, "") as EvIf] = true), c), del: (c, a) => (a.i === "lo0.0" ? (c.ospfLo = false) : (c.ospf[a.i.replace(/\.0$/, "") as EvIf] = false), c) } },
    { id: "ospf-lo", summary: "Advertise the loopback without forming adjacencies on it", args: { i: choiceArg(["lo0.0"], () => "the loopback") }, junos: { syntax: "protocols ospf area 0.0.0.0 interface <i> passive", set: (c) => ((c.ospfLo = true), c), del: (c) => c } },
  ];
  const leafIds = ["mode", "members", "esw", "vlan-id", "vlan", "vni", "vxlan", "vtep", "rd", "swrt", "encap", "ext", "vnirt", "vnio", "evpn", "vtep-all", "rd-all", "nbr", "fam"];
  return all.filter((x) => leaf || !leafIds.includes(x.id) || x.id === "vlan-id" || x.id === "vtep" || x.id === "nbr");
}

export function evValidate(c: EvCfg): string | undefined {
  for (const [p, x] of Object.entries(c.ports)) if (x?.vlan && !c.vlans[x.vlan]) return `error: interfaces ${p} unit 0 family ethernet-switching vlan members ${x.vlan}: VLAN not defined\nerror: configuration check-out failed`;
  if (c.evpn?.vxlan && !c.vtep) return "error: [edit protocols evpn] 'encapsulation vxlan' requires 'switch-options vtep-source-interface'\nerror: configuration check-out failed";
  if (c.evpn?.vxlan && c.vtep && !c.rd) return "error: [edit switch-options] route-distinguisher must be configured\nerror: configuration check-out failed";
  return undefined;
}
export function evJunosSpec(api: EvCliApi, r: EvR): SpJunosSpec<EvCfg> {
  const s = api.s;
  const sh = (id: string, syntax: string, summary: string, run: SpCmd["run"], args?: SpCmd["args"]): SpCmd => ({ id, syntax, summary, run, args });
  const nothing = (o: string, why: string) => o || { output: "", explanation: why };
  const leaf = isLeaf(r);
  const spine = "SPINE1 is the IP underlay: it holds no VLANs, no MACs and no EVPN routes — that is the point.";
  const loArg: CliArgSpec = { choices: EV_ROUTERS.map((x) => EV_LO[x]), describe: (c) => `${EV_ROUTERS.find((x) => EV_LO[x] === c) ?? "?"}'s loopback`, resolve: (raw) => (ipRe.test(raw) ? raw : undefined) };
  return {
    stmts: stmts(r, s).filter((x) => x.junos),
    jstmts: (c) => evJnStmts(r, c),
    help: { "show evpn": "Show EVPN information", "show ethernet-switching": "Show Ethernet switching information", "show route": "Show routing table information", "show route table": "Name of the routing table", "show bgp": "Show Border Gateway Protocol information", "show ospf": "Show OSPF information", clear: "Clear information in the system", "clear ethernet-switching": "Clear Ethernet switching information" },
    shows: [
      sh("db", "show evpn database", "MACs per VNI: learned on a local port, or from a remote VTEP's Type 2 route", () => (leaf ? evpnDatabase(s, r as EvLeaf) : { output: "", explanation: spine })),
      sh("tbl", "show ethernet-switching table", "The forwarding table: local MACs, and remote ones behind the VTEP interface", () => (leaf ? switchingTable(s, r as EvLeaf) : { output: "", explanation: spine })),
      sh("if", "show ethernet-switching interface <p>", "An access port's VLAN", (a) => (leaf ? nothing(switchingInterface(s, r as EvLeaf, a.p as EvIf), "That port isn't an Ethernet switching port.") : { output: "", explanation: spine }), { p: accessArg(r) }),
      sh("vtep", "show ethernet-switching vxlan-tunnel-end-point remote", "The remote VTEPs and their VNIs (from Type 3 routes)", () => (leaf ? remoteVtepTable(s, r as EvLeaf) : { output: "", explanation: spine })),
      sh("evpn", "show route table bgp.evpn.0", "The EVPN routes: Type 2 (MAC/IP) and Type 3 (inclusive multicast)", () => (leaf ? bgpEvpn(s, r as EvLeaf) : { output: "", explanation: spine })),
      sh("sum", "show bgp summary", "The EVPN session: received and accepted routes", () => (leaf ? bgpSummary(s, r as EvLeaf) : "BGP is not running")),
      sh("ospf", "show ospf neighbor", "The underlay adjacencies", () => ospfNeighbor(s, r)),
      sh("rt", "show route <ip>", "The underlay route to a loopback (a VTEP address)", (a) => nothing(routeTo(s, r, a.ip), "No route: that loopback isn't reachable over OSPF."), { ip: loArg }),
      sh("inet", "show route table inet.0", "The underlay routing table", () => inet0(s, r)),
      sh("log", "show log messages", "The system log", () => nothing(log(s, r), "No messages since the lab started.")),
    ].filter((x) => leaf || x.id !== "if"),
    op: [
      sh("clr", "clear ethernet-switching table", "Clear the locally learned MACs (their Type 2 routes are withdrawn)", () => (leaf ? (api.act({ type: "clear", dev: r as EvLeaf }), "") : { output: "", explanation: spine })),
    ],
  };
}
export function evSets(api: EvCliApi, r: EvR): Partial<Record<CliVendor, CliCommandSet>> {
  return { juniper: buildJunosSet({ ...api.dev, validate: (c) => evValidate(c) }, evJunosSpec(api, r)) };
}
export const evPipe = (api: EvCliApi, r: EvR) => ({ config: junosPipeConfig(api.dev, { jstmts: (c: EvCfg) => evJnStmts(r, c) }), rollbacks: api.dev.hist.length });
export function evStaticApi(s: EvState, r: EvR): EvCliApi {
  return { s, act: () => s, dev: { host: r, running: s.cfg[r], hist: s.hist[r], setCand: () => undefined, xr: [], setXr: () => undefined, edit: false, setEdit: () => undefined, commit: () => undefined } };
}
export const evClone = spClone;
export { EV_LINKS, EV_LEAVES, HOSTS };
