import type { CliArgSpec, CliCommand, CliCommandSet, CliVendor } from "@/lib/cli/types";
import { buildJunosSet, choiceArg, junosPipeConfig, numArg, type SpCfgStmt, type SpCmd, type SpDevCli, type SpJunosSpec } from "@/components/sp-lab/spCli";
import { pad, spStamp, type JStmt } from "@/components/sp-lab/spKit";
import { L2_IP, L2_MAC, MAC_AGE_S, MGMT, MGMT_VLAN, USER_VLAN } from "@/lib/sim-engine/scenarios/troubleshootingLayer2";
import { L2_SWS, SW_PORTS, STP_COST, VLAN_ID, VLAN_NAME, bidOf, l2Apply, l2Stp, lastTest, linkUp, liveFdb, peerOf, portCtr, type L2Action, type L2Cfg, type L2D, type L2H, type L2State, type L2Sw, type PortCfg } from "@/lib/sim-engine/scenarios/l2Net";

/**
 * Command lines of the Layer 2 Lab. Every output is printed from the lab model (l2Net.ts).
 *
 * SW1 / SW2 / SW3 (Junos EX, ELS): show interfaces terse | show interfaces <if> extensive | show vlans
 *   | show ethernet-switching table [vlan-name <v>] | show ethernet-switching interface <if> | show spanning-tree bridge
 *   | show spanning-tree interface | show arp no-resolve | show log messages | ping <ip> count <n>
 *   | clear ethernet-switching table | clear interfaces statistics all
 *   configure: interfaces <if> unit 0 family ethernet-switching interface-mode access|trunk · … vlan members <vlan>
 *   · interfaces <if> native-vlan-id <id> · interfaces <if> disable · protocols rstp [interface all] · protocols rstp
 *   bridge-priority <p> · vlans <name> vlan-id <id>
 * HOST-A / HOST-B (Linux): ping -c <n> <ip> · ip neigh · ip addr · ip -s link show eth0
 */

export interface L2CliApi {
  s: L2State;
  act: (a: L2Action) => L2State;
  dev: SpDevCli<L2Cfg>;
}
const PEER_TXT = (sw: L2Sw, port: string) => {
  const p = peerOf(sw, port)!;
  return p.dev.startsWith("SW") ? `${p.dev} ${p.port}` : p.dev;
};
const ifArg = (r: L2Sw): CliArgSpec => ({ choices: SW_PORTS[r], describe: (c) => `to ${PEER_TXT(r, c)}`, resolve: (raw) => SW_PORTS[r].find((p) => p === raw.replace(/\.0$/, "")) });
const vlanArg = (what = "VLAN (name or ID)"): CliArgSpec => ({ choices: ["USERS", "MGMT", "default", "10", "20", "1"], describe: (c) => ({ USERS: "VLAN 10", MGMT: "VLAN 20", default: "VLAN 1", "10": "USERS", "20": "MGMT", "1": "default" })[c] ?? what, resolve: (raw) => (VLAN_ID[raw] !== undefined ? raw : /^\d{1,4}$/.test(raw) && +raw >= 1 && +raw <= 4094 ? raw : undefined) });
const vid = (raw: string) => VLAN_ID[raw] ?? +raw;
const vlansOfPort = (p?: PortCfg) => (!p ? [] : p.mode === "access" ? [p.access, ...(p.members ?? [])].filter((x): x is number => x !== undefined) : (p.members ?? []));
const fmtBid = (bid: string) => {
  const [pr, mac] = bid.split(".");
  return `${pr}.${mac.replace(/:/g, "")}`;
};

// ---------------------------------------------------------------------------------------------------------------
// Junos outputs
// ---------------------------------------------------------------------------------------------------------------
function terse(s: L2State, r: L2Sw): string {
  const rows = SW_PORTS[r].map((port) => {
    const p = peerOf(r, port)!;
    const a = s.cfg[r].ports[port]?.disable ? "down" : "up";
    const o = linkUp(s.cfg, p.link) ? "up" : "down";
    return `${pad(port, 24)}${pad(a, 6)}${o}\n${pad(`${port}.0`, 24)}${pad(a, 6)}${pad(o, 5)}eth-switch`;
  });
  return [`${pad("Interface", 24)}${pad("Admin", 6)}${pad("Link", 5)}${pad("Proto", 9)}Local                 Remote`, ...rows, `${pad("irb", 24)}${pad("up", 6)}up`, `${pad("irb.20", 24)}${pad("up", 6)}${pad("up", 5)}${pad("inet", 9)}${MGMT[r].ip}/24`, `${pad("lo0", 24)}${pad("up", 6)}up`].join("\n");
}
function extensive(s: L2State, r: L2Sw, port: string): string {
  const c = portCtr(s, `${r}:${port}`);
  const p = peerOf(r, port)!;
  const up = linkUp(s.cfg, p.link);
  const admin = !s.cfg[r].ports[port]?.disable;
  const idx = 514 + SW_PORTS[r].indexOf(port);
  return [
    `Physical interface: ${port}, ${admin ? "Enabled" : "Administratively down"}, Physical link is ${up ? "Up" : "Down"}`,
    `  Interface index: ${idx - 382}, SNMP ifIndex: ${idx}`,
    `  Description: ${PEER_TXT(r, port)}`,
    "  Link-level type: Ethernet, MTU: 1514, LAN-PHY mode, Link-mode: Full-duplex, Speed: 1000mbps, BPDU Error: None, Loop Detect PDU Error: None, MAC-REWRITE Error: None, Loopback: Disabled, Source filtering: Disabled, Flow control: Enabled, Auto-negotiation: Enabled",
    `  Device flags   : Present Running${up ? "" : " Down"}`,
    "  Statistics last cleared: " + (s.clearedOnce && s.cleared[`${r}:${port}`].inPkts ? "2026-10-11 (cleared)" : "Never"),
    "  Traffic statistics:",
    `   Input  packets:      ${pad(c.inPkts, 22)}0 pps`,
    `   Output packets:      ${pad(c.outPkts, 22)}0 pps`,
    "  Input errors:",
    `    Errors: 0, Drops: ${c.drops}, Framing errors: 0, Runts: 0, Policed discards: 0, L3 incompletes: 0, L2 channel errors: 0, L2 mismatch timeouts: 0, FIFO errors: 0, Resource errors: 0`,
    "  Output errors:",
    "    Carrier transitions: 2, Errors: 0, Drops: 0, Collisions: 0, Aged packets: 0, FIFO errors: 0, HS link CRC errors: 0, MTU errors: 0, Resource errors: 0",
    "  MAC statistics:                      Receive         Transmit",
    `    Total packets                  ${pad(c.inPkts, 18)}${c.outPkts}`,
    `    Unicast packets                ${pad(c.inPkts - c.bcastIn, 18)}${Math.max(0, c.outPkts - c.bcastIn)}`,
    `    Broadcast packets              ${pad(c.bcastIn, 18)}${c.bcastIn}`,
    "    Multicast packets              0                 0",
    "    CRC/Align errors               0                 0",
  ].join("\n");
}
function vlans(s: L2State, r: L2Sw): string {
  const st = l2Stp(s);
  const out = [`${pad("Routing instance", 24)}${pad("VLAN name", 22)}${pad("Tag", 13)}Interfaces`];
  for (const v of [...s.cfg[r].vlans].sort((a, b) => (VLAN_NAME[a] ?? "").localeCompare(VLAN_NAME[b] ?? ""))) {
    out.push(`${pad("default-switch", 24)}${pad(VLAN_NAME[v] ?? `vlan-${v}`, 22)}${v}`);
    const members = SW_PORTS[r].filter((port) => {
      const p = s.cfg[r].ports[port];
      return p && !p.disable && (vlansOfPort(p).includes(v) || p.native === v);
    });
    if (v === MGMT_VLAN) out.push(`${pad("", 59)}irb.20*`);
    for (const port of members) out.push(`${pad("", 59)}${port}.0${linkUp(s.cfg, peerOf(r, port)!.link) && st.ports[`${r}:${port}`].state === "Forwarding" ? "*" : ""}`);
  }
  return out.join("\n");
}
function swTable(s: L2State, r: L2Sw, vlanName?: string): string {
  const rows = liveFdb(s, r)
    .filter((e) => !vlanName || VLAN_NAME[e.vlan] === vlanName || String(e.vlan) === vlanName)
    .sort((a, b) => a.vlan - b.vlan || a.mac.localeCompare(b.mac))
    .map((e) => `   ${pad(VLAN_NAME[e.vlan] ?? e.vlan, 20)}${pad(e.mac.toLowerCase(), 20)}${pad("D", 12)}${pad("-", 6)}${pad(`${e.port}.0`, 23)}0         0`);
  return ["", "MAC flags (S - static MAC, D - dynamic MAC, L - locally learned, P - Persistent static", "           SE - statistics enabled, NM - non configured MAC, R - remote PE MAC, O - ovsdb MAC)", "", "", `Ethernet switching table : ${rows.length} entries, ${rows.length} learned`, "Routing instance : default-switch", `   ${pad("Vlan", 20)}${pad("MAC", 20)}${pad("MAC", 12)}${pad("Age", 6)}${pad("Logical", 23)}NH        RTR`, `   ${pad("name", 20)}${pad("address", 20)}${pad("flags", 12)}${pad("", 6)}${pad("interface", 23)}Index     ID`, ...rows].join("\n");
}
function swIf(s: L2State, r: L2Sw, port: string): string {
  const p = s.cfg[r].ports[port];
  const st = l2Stp(s).ports[`${r}:${port}`];
  const up = linkUp(s.cfg, peerOf(r, port)!.link);
  const rows: string[] = [];
  const vs = new Set(vlansOfPort(p));
  if (p?.native !== undefined && p.mode === "trunk") vs.add(p.native);
  for (const v of [...vs].sort((a, b) => (VLAN_NAME[a] ?? "").localeCompare(VLAN_NAME[b] ?? ""))) {
    const tagging = p?.mode === "access" || p?.native === v ? "untagged" : "tagged";
    rows.push(`${pad("", 12)}${pad(VLAN_NAME[v] ?? `vlan-${v}`, 14)}${pad(v, 8)}${pad(65535, 8)}${pad(0, 8)}${pad(up ? (st.state === "Forwarding" ? "Forwarding" : "Blocking") : "", 12)}${pad(up ? "" : "DN", 18)}${tagging}`);
  }
  return [
    "Routing Instance Name : default-switch",
    "Logical Interface flags (DL - disable learning, AD - packet action drop,",
    "                         LH - MAC limit hit, DN - interface down,",
    "                         MMAS - Mac-move action shutdown, AS - Autostate-exclude enabled,",
    "                         SCTL - shutdown by Storm-control, MI - MAC+IP limit hit)",
    "",
    `${pad("Logical", 12)}${pad("Vlan", 14)}${pad("TAG", 8)}${pad("MAC", 8)}${pad("MAC+IP", 8)}${pad("STP", 12)}${pad("Logical", 18)}Tagging`,
    `${pad("interface", 12)}${pad("members", 14)}${pad("", 8)}${pad("limit", 8)}${pad("limit", 8)}${pad("state", 12)}${pad("interface flags", 18)}`,
    `${pad(`${port}.0`, 12)}${pad("", 14)}${pad("", 8)}${pad(65535, 8)}${pad(0, 8)}${pad("", 12)}${pad(up ? "" : "DN", 18)}${p?.mode === "access" ? "untagged" : "tagged"}`,
    ...rows,
  ].join("\n");
}
function stpBridge(s: L2State, r: L2Sw): string | { output: string; explanation: string } {
  const st = l2Stp(s);
  const b = st.bridge[r];
  if (!b.rstp) return { output: "error: the spanning-tree subsystem is not running", explanation: `${r} has no protocols rstp in its configuration: it neither sends nor processes BPDUs, and forwards on every port.` };
  const root = b.rootSw === r;
  return [
    "STP bridge parameters",
    "Routing instance name               : GLOBAL",
    "Context ID                          : 0",
    "Enabled protocol                    : RSTP",
    `  Root ID                           : ${b.rootId}`,
    ...(root ? [] : [`  Root cost                         : ${b.cost}`, `  Root port                         : ${b.rootPort}`]),
    "  Hello time                        : 2 seconds",
    "  Maximum age                       : 20 seconds",
    "  Forward delay                     : 15 seconds",
    ...(root ? [] : ["  Message age                       : 1"]),
    `  Number of topology changes        : ${s.tcCount}`,
    `  Time since last topology change   : ${s.tcAt === undefined ? 3812 + Math.floor(s.clock) : Math.floor(s.clock - s.tcAt)} seconds`,
    "  Local parameters",
    `    Bridge ID                       : ${bidOf(s.cfg, r)}`,
    "    Extended system ID              : 0",
  ].join("\n");
}
function stpIf(s: L2State, r: L2Sw): string | { output: string; explanation: string } {
  const st = l2Stp(s);
  if (!st.bridge[r].rstp) return { output: "error: the spanning-tree subsystem is not running", explanation: `${r} runs no spanning tree.` };
  const rows = SW_PORTS[r].map((port, i) => {
    const ps = st.ports[`${r}:${port}`];
    const p = peerOf(r, port)!;
    const myId = `128:${490 + i}`;
    const nb = p.dev.startsWith("SW") ? (p.dev as L2Sw) : undefined;
    const desig = ps.role === "Root" || ps.role === "Alternate" ? nb! : r;
    const dPort = ps.role === "Root" || ps.role === "Alternate" ? `128:${490 + SW_PORTS[nb!].indexOf(p.port)}` : myId;
    const state = ps.role === "None" ? "DIS" : ps.state === "Forwarding" ? "FWD" : "BLK";
    const role = ps.role === "Root" ? "ROOT" : ps.role === "Alternate" ? "ALT" : ps.role === "None" ? "DIS" : "DESG";
    return `${pad(port, 27)}${pad(myId, 11)}${pad(dPort, 11)}${pad(fmtBid(bidOf(s.cfg, desig)), 21)}${pad(STP_COST, 8)}${pad(state, 7)}${role}${ps.role === "Edge" ? " (edge)" : ""}`;
  });
  return ["", "Spanning tree interface parameters for instance 0", "", `${pad("Interface", 27)}${pad("Port ID", 11)}${pad("Designated", 11)}${pad("Designated", 21)}${pad("Port", 8)}${pad("State", 7)}Role`, `${pad("", 27)}${pad("", 11)}${pad("port ID", 11)}${pad("bridge ID", 21)}Cost`, ...rows].join("\n");
}
function arpTable(s: L2State, r: L2Sw): string {
  const rows = Object.entries(s.arp[r]).filter(([, e]) => e.state === "REACHABLE").map(([ip, e]) => `${pad(e.mac.toLowerCase(), 18)}${pad(ip, 16)}${pad(ip, 16)}${pad("irb.20", 23)}none`);
  return [`${pad("MAC Address", 18)}${pad("Address", 16)}${pad("Name", 16)}${pad("Interface", 23)}Flags`, ...rows, `Total entries: ${rows.length}`].join("\n");
}
function logs(s: L2State, r: L2Sw): string {
  return [`Oct 11 08:59:58  ${r} mgd[2211]: UI_LOGIN_EVENT: User 'admin' login, class 'j-super-user' [41092]`, ...s.sys.filter((x) => x.dev === r).map((x) => `Oct 11 ${spStamp(x.t).hms}  ${r} ${x.text}`)].join("\n");
}

// ---------------------------------------------------------------------------------------------------------------
// Junos configuration
// ---------------------------------------------------------------------------------------------------------------
export function l2JnStmts(r: L2Sw, c: L2Cfg): JStmt[] {
  const out: JStmt[] = [];
  for (const port of SW_PORTS[r]) {
    const p = c.ports[port];
    out.push({ path: ["interfaces", port], leaf: `description "${PEER_TXT(r, port)}"` });
    if (!p) continue;
    if (p.disable) out.push({ path: ["interfaces", port], leaf: "disable" });
    if (p.native !== undefined) out.push({ path: ["interfaces", port], leaf: `native-vlan-id ${p.native}` });
    out.push({ path: ["interfaces", port, "unit 0", "family ethernet-switching"], leaf: `interface-mode ${p.mode}` });
    for (const v of vlansOfPort(p)) out.push({ path: ["interfaces", port, "unit 0", "family ethernet-switching", "vlan"], leaf: `members ${VLAN_NAME[v] ?? v}` });
  }
  out.push({ path: ["interfaces", "irb", "unit 20", "family inet"], leaf: `address ${MGMT[r].ip}/24` });
  if (c.rstp) {
    out.push({ path: ["protocols", "rstp"], leaf: `bridge-priority ${c.prio}` }, { path: ["protocols", "rstp"], leaf: "interface all" });
  }
  for (const v of c.vlans) if (v !== 1) out.push({ path: ["vlans", VLAN_NAME[v] ?? `vlan-${v}`], leaf: `vlan-id ${v}` }, ...(v === MGMT_VLAN ? [{ path: ["vlans", "MGMT"], leaf: "l3-interface irb.20" }] : []));
  return out;
}
export function l2Validate(c: L2Cfg): string | undefined {
  for (const [port, p] of Object.entries(c.ports)) {
    if (p.mode === "access" && vlansOfPort(p).length > 1) return `error: interface ${port}.0: an access interface can be a member of only one VLAN`;
    for (const v of vlansOfPort(p)) if (!c.vlans.includes(v)) return `error: interface ${port}.0: vlan ${VLAN_NAME[v] ?? v} is not configured`;
  }
  return undefined;
}
const port = (c: L2Cfg, ifn: string): PortCfg => (c.ports[ifn] ??= { mode: "access" });
function stmts(r: L2Sw): SpCfgStmt<L2Cfg>[] {
  const ifm = ifArg(r);
  return [
    {
      id: "j-mode",
      summary: "Access (one untagged VLAN) or trunk (tagged VLANs)",
      args: { ifm, md: choiceArg(["access", "trunk"]) },
      junos: {
        syntax: "interfaces <ifm> unit 0 family ethernet-switching interface-mode <md>",
        set: (c, a) => {
          const p = port(c, a.ifm);
          const all = vlansOfPort(p);
          if (a.md === "trunk") c.ports[a.ifm] = { mode: "trunk", members: all, native: p.native, disable: p.disable };
          else c.ports[a.ifm] = { mode: "access", access: all[0], members: all.slice(1), native: p.native, disable: p.disable };
          return c;
        },
        del: (c, a) => ((port(c, a.ifm).mode = "access"), c),
      },
    },
    {
      id: "j-mem",
      summary: "VLAN membership (an access port takes one VLAN; a trunk carries the listed VLANs tagged)",
      args: { ifv: ifArg(r), vm: vlanArg() },
      junos: {
        syntax: "interfaces <ifv> unit 0 family ethernet-switching vlan members <vm>",
        set: (c, a) => {
          const p = port(c, a.ifv);
          const v = vid(a.vm);
          if (p.mode === "access") {
            if (p.access === undefined) p.access = v;
            else if (p.access !== v && !(p.members ?? []).includes(v)) p.members = [...(p.members ?? []), v];
          } else if (!(p.members ?? []).includes(v)) p.members = [...(p.members ?? []), v].sort((x, y) => x - y);
          return c;
        },
        del: (c, a) => {
          const p = port(c, a.ifv);
          const v = vid(a.vm);
          if (p.mode === "access" && p.access === v) {
            p.access = p.members?.[0];
            p.members = p.members?.slice(1);
          } else p.members = (p.members ?? []).filter((x) => x !== v);
          return c;
        },
      },
    },
    { id: "j-nat", summary: "The VLAN sent and received untagged on a trunk", args: { ifn: ifArg(r), nv: numArg(1, 4094, ["1", "10", "20"], "VLAN ID") }, junos: { syntax: "interfaces <ifn> native-vlan-id <nv>", set: (c, a) => ((port(c, a.ifn).native = +a.nv), c), del: (c, a) => (delete port(c, a.ifn).native, c) } },
    { id: "j-nat-del", summary: "The native VLAN (delete it without a value)", args: { ifn2: ifArg(r) }, junos: { syntax: "interfaces <ifn2> native-vlan-id", set: () => "error: missing mandatory argument: native-vlan-id needs a VLAN ID", del: (c, a) => (delete port(c, a.ifn2).native, c) } },
    { id: "j-dis", summary: "Disable the interface", args: { ifd: ifArg(r) }, junos: { syntax: "interfaces <ifd> disable", set: (c, a) => ((port(c, a.ifd).disable = true), c), del: (c, a) => (delete port(c, a.ifd).disable, c) } },
    { id: "j-rstp", summary: "Rapid spanning tree on this switch", junos: { syntax: "protocols rstp", set: (c) => ((c.rstp = true), c), del: (c) => ((c.rstp = false), c) } },
    { id: "j-rstp-all", summary: "Run RSTP on every interface", args: { all: choiceArg(["all"]) }, junos: { syntax: "protocols rstp interface <all>", set: (c) => ((c.rstp = true), c), del: (c) => ((c.rstp = false), c) } },
    { id: "j-prio", summary: "Bridge priority (lower wins the root election; multiples of 4096)", args: { pr: { choices: ["0", "4096", "8192", "16384", "32768"], describe: () => "0–61440 in steps of 4096", resolve: (raw) => (/^\d+$/.test(raw) && +raw <= 61440 && +raw % 4096 === 0 ? raw : undefined) } }, junos: { syntax: "protocols rstp bridge-priority <pr>", set: (c, a) => ((c.prio = +a.pr), (c.rstp = true), c), del: (c) => ((c.prio = 32768), c) } },
    { id: "j-vlan", summary: "Define a VLAN", args: { vn: { choices: ["USERS", "MGMT"], describe: () => "VLAN name", resolve: (raw) => (raw === "USERS" || raw === "MGMT" ? raw : undefined) }, id: numArg(1, 4094, ["10", "20"], "VLAN ID") }, junos: { syntax: "vlans <vn> vlan-id <id>", set: (c, a) => (+a.id !== VLAN_ID[a.vn] ? `error: this lab keeps ${a.vn} as VLAN ${VLAN_ID[a.vn]}` : ((c.vlans = [...new Set([...c.vlans, +a.id])].sort((x, y) => x - y)), c)), del: (c, a) => ((c.vlans = c.vlans.filter((v) => v !== VLAN_ID[a.vn])), c) } },
    { id: "j-vlan-del", summary: "A whole VLAN definition", args: { vd: { choices: ["USERS", "MGMT"], describe: () => "VLAN name", resolve: (raw) => (raw === "USERS" || raw === "MGMT" ? raw : undefined) } }, junos: { syntax: "vlans <vd>", set: (c, a) => ((c.vlans = [...new Set([...c.vlans, VLAN_ID[a.vd]])].sort((x, y) => x - y)), c), del: (c, a) => ((c.vlans = c.vlans.filter((v) => v !== VLAN_ID[a.vd])), c) } },
  ];
}
export function l2JunosSpec(api: L2CliApi, r: L2Sw): SpJunosSpec<L2Cfg> {
  const s = api.s;
  const sh = (id: string, syntax: string, summary: string, run: SpCmd["run"], args?: SpCmd["args"]): SpCmd => ({ id, syntax, summary, run, args });
  const shows: SpCmd[] = [
    sh("terse", "show interfaces terse", "Interfaces: admin and link state, irb.20 address", () => terse(s, r)),
    sh("ext", "show interfaces <ifx> extensive", "Counters: packets, broadcasts, input drops", (a) => extensive(s, r, a.ifx), { ifx: ifArg(r) }),
    sh("vl", "show vlans", "VLANs and their member interfaces (* = up and forwarding)", () => vlans(s, r)),
    sh("est", "show ethernet-switching table", "Learned MAC addresses: VLAN, MAC, interface", () => swTable(s, r)),
    sh("estv", "show ethernet-switching table vlan-name <vn>", "Learned MAC addresses in one VLAN", (a) => swTable(s, r, a.vn), { vn: vlanArg("VLAN name") }),
    sh("esi", "show ethernet-switching interface <ife>", "VLAN membership of an interface: tagged or untagged, STP state", (a) => swIf(s, r, a.ife), { ife: ifArg(r) }),
    sh("stpb", "show spanning-tree bridge", "This bridge's RSTP view: root ID, root cost, root port", () => stpBridge(s, r)),
    sh("stpi", "show spanning-tree interface", "RSTP role and state of every interface", () => stpIf(s, r)),
    sh("arp", "show arp no-resolve", "The management ARP table (irb.20)", () => arpTable(s, r)),
    sh("log", "show log messages", "System log: link and STP changes, MAC moves, commits", () => logs(s, r)),
  ];
  const targets: string[] = L2_SWS.filter((x) => x !== r).map((x) => MGMT[x].ip);
  const op: SpCmd[] = [
    sh("ping", "ping <ip> count <n>", "Ping another switch's management address (from irb.20, VLAN 20)", (a) => {
      const t0 = l2Apply(s, { type: "ping", from: r, to: a.ip, count: +a.n });
      api.act({ type: "ping", from: r, to: a.ip, count: +a.n });
      const t = lastTest(t0);
      const lines = [`PING ${a.ip} (${a.ip}): 56 data bytes`];
      for (let q = 0; q < t.recv; q++) lines.push(`64 bytes from ${a.ip}: icmp_seq=${q} ttl=64 time=${t.storm ? (1200 + q * 317).toFixed(3) : (1.201 + q * 0.21).toFixed(3)} ms`);
      lines.push("", `--- ${a.ip} ping statistics ---`, `${t.sent} packets transmitted, ${t.recv} packets received, ${Math.round((100 * (t.sent - t.recv)) / t.sent)}% packet loss`);
      if (t.recv) lines.push(t.storm ? "round-trip min/avg/max/stddev = 1200.000/1675.500/2151.000/356.112 ms" : "round-trip min/avg/max/stddev = 1.201/1.516/1.831/0.236 ms");
      return { output: lines.join("\n") };
    }, { ip: { choices: targets, describe: (c) => L2_SWS.find((x) => MGMT[x].ip === c) ?? "IPv4 address", resolve: (raw) => (targets.includes(raw) ? raw : undefined) }, n: numArg(1, 20, ["4"], "Count") }),
    sh("clrmac", "clear ethernet-switching table", "Flush the learned MAC addresses", () => {
      api.act({ type: "clear-mac", dev: r });
      return "";
    }),
    sh("clr", "clear interfaces statistics all", "Reset the counters shown by show interfaces", () => {
      api.act({ type: "clear-stats", dev: r });
      return "";
    }),
  ];
  return { stmts: stmts(r), shows, op, jstmts: (c) => l2JnStmts(r, c), help: { "show interfaces": "Interface information", "show ethernet-switching": "Ethernet switching information", "show spanning-tree": "Spanning tree information", "show vlans": "VLAN information", "show arp": "ARP table", "show log": "Log files", "clear ethernet-switching": "Clear Ethernet switching information", "clear interfaces": "Clear interface information" } };
}

// ---------------------------------------------------------------------------------------------------------------
// Linux hosts
// ---------------------------------------------------------------------------------------------------------------
function hostSet(api: L2CliApi, h: L2H): CliCommandSet {
  const s = api.s;
  const me = L2_IP[h];
  const other: L2H = h === "HOST-A" ? "HOST-B" : "HOST-A";
  const prompt = `admin@${h.toLowerCase()}:~$ `;
  const cmds: CliCommand[] = [];
  const add = (id: string, syntax: string, summary: string, run: CliCommand["run"], args?: CliCommand["args"]) => cmds.push({ id: `${h}-${id}`, syntax, summary, run, args });
  const ipArg: CliArgSpec = { choices: [L2_IP[other]], describe: () => other, resolve: (raw) => (/^(\d{1,3}\.){3}\d{1,3}$/.test(raw) ? raw : undefined) };
  add("ping", "ping -c <n> <ip>", "Send <n> echo requests", (a) => {
    if (a.ip !== L2_IP[other]) return { output: `PING ${a.ip} (${a.ip}) 56(84) bytes of data.\n\n--- ${a.ip} ping statistics ---\n${a.n} packets transmitted, 0 received, 100% packet loss`, explanation: `In this lab ${h} talks to ${other} (${L2_IP[other]}); the switches' 10.20.20.x addresses are in VLAN 20, another subnet with no router.` };
    const n = +a.n;
    const ns = l2Apply(s, { type: "ping", from: h, to: a.ip, count: n });
    api.act({ type: "ping", from: h, to: a.ip, count: n });
    const t = lastTest(ns);
    const lines = [`PING ${a.ip} (${a.ip}) 56(84) bytes of data.`];
    if (t.unreachable) for (let q = 1; q <= n; q++) lines.push(`From ${me} icmp_seq=${q} Destination Host Unreachable`);
    else for (let q = 1; q <= t.recv; q++) lines.push(`64 bytes from ${a.ip}: icmp_seq=${q} ttl=64 time=${t.storm ? `${1400 + q * 233}` : `0.${400 + q * 17}`} ms`);
    lines.push("", `--- ${a.ip} ping statistics ---`, `${n} packets transmitted, ${t.recv} received, ${t.unreachable ? `+${n} errors, ` : ""}${Math.round((100 * (n - t.recv)) / n)}% packet loss, time ${n * 1000 - 999}ms`);
    if (t.recv) lines.push(t.storm ? "rtt min/avg/max/mdev = 1633.0/1866.4/2099.0/233.1 ms, pipe 2" : "rtt min/avg/max/mdev = 0.417/0.442/0.468/0.019 ms");
    return { output: lines.join("\n") };
  }, { n: numArg(1, 10, ["4"], "Count"), ip: ipArg });
  add("neigh", "ip neigh", "The ARP (neighbour) cache", () => {
    const e = s.arp[h][L2_IP[other]];
    if (!e) return { output: "", explanation: "The ARP cache is empty — nothing has been resolved yet. Ping first." };
    return { output: e.state === "FAILED" ? `${L2_IP[other]} dev eth0 FAILED` : `${L2_IP[other]} dev eth0 lladdr ${e.mac.toLowerCase()} REACHABLE` };
  });
  add("addr", "ip addr", "Addresses", () => ({ output: `1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536\n    inet 127.0.0.1/8 scope host lo\n2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 state UP\n    link/ether ${L2_MAC[h].toLowerCase()} brd ff:ff:ff:ff:ff:ff\n    inet ${me}/24 brd 10.10.10.255 scope global eth0` }));
  add("link", "ip -s link show eth0", "Interface state and counters", () => {
    const k = h === "HOST-A" ? "SW1:ge-0/0/1" : "SW3:ge-0/0/1";
    const c = portCtr(s, k);
    return { output: [`2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc fq_codel state UP mode DEFAULT group default qlen 1000`, `    link/ether ${L2_MAC[h].toLowerCase()} brd ff:ff:ff:ff:ff:ff`, "    RX:  bytes packets errors dropped  missed   mcast", `    ${pad(c.outPkts * 612, 12)}${pad(c.outPkts, 10)}${pad(0, 7)}${pad(0, 8)}${pad(0, 8)}${c.bcastIn}`, "    TX:  bytes packets errors dropped carrier collsns", `    ${pad(c.inPkts * 598, 12)}${pad(c.inPkts, 10)}${pad(0, 7)}${pad(0, 8)}${pad(0, 8)}0`].join("\n") };
  });
  return { vendor: "cisco", deviceId: h, deviceName: h, prompt, commands: cmds };
}

export function l2Sets(api: L2CliApi, d: L2D): Partial<Record<CliVendor, CliCommandSet>> {
  if (d === "SW1" || d === "SW2" || d === "SW3") return { juniper: buildJunosSet(api.dev, l2JunosSpec(api, d)) };
  const h = hostSet(api, d);
  return { cisco: h, juniper: h };
}
export const l2Pipe = (api: L2CliApi, r: L2Sw) => ({ config: junosPipeConfig(api.dev, { jstmts: (c: L2Cfg) => l2JnStmts(r, c) }), rollbacks: api.dev.hist.length });
export function l2StaticApi(s: L2State, d: L2D): L2CliApi {
  const sw = d === "SW1" || d === "SW2" || d === "SW3";
  return { s, act: () => s, dev: { host: d, running: sw ? s.cfg[d] : ({ ports: {}, rstp: false, prio: 0, vlans: [] } as L2Cfg), hist: sw ? s.hist[d] : [], setCand: () => undefined, xr: [], setXr: () => undefined, edit: false, setEdit: () => undefined, commit: () => undefined, validate: l2Validate } };
}
export { MAC_AGE_S, USER_VLAN };
