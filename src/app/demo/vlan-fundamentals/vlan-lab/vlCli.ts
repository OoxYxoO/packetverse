import type { CliArgSpec, CliCommand, CliCommandSet, CliResult, CliVendor } from "@/lib/cli/types";
import { ciscoMac, columns, interfaceArg, prefixToMask } from "@/lib/cli/format";
import type { CliQuestion } from "@/app/demo/dhcp-dns/dhcp-lab/dhcpBuildCli";
import { withSelfPing } from "@/lib/cli/selfPing";
import { withShellHistory } from "@/lib/cli/shellHistory";
import { RTR_PORT, TRUNK, VL_HOSTS, VL_MAC, VL_PORTS, isIp, netOf, vlClone, vlHostAt, vlInactive, vlIpOwner, vlMacName, vlPeer, vlPortStatus, vlPortUp, vlPortVlans, vlTable, vlanName, type VlAction, type VlCfg, type VlHost, type VlPort, type VlPortCfg, type VlState, type VlSub, type VlSw, type VlSwCfg } from "@/lib/sim-engine/scenarios/vlanNet";
import { CISCO_IF, CISCO_SHORT } from "./vlNames";

/**
 * Command lines of the VLAN Lab — Cisco IOS or Junos on SW1, SW2 and R1, a Linux shell on the hosts. Every output is
 * printed from the lab state the topology, the tables, the counters and the captures use; every change goes through a
 * lab action (IOS on Enter; Junos on commit).
 *
 *   Switches · IOS    show vlan brief | id <n> · show interfaces trunk · show interfaces <if> switchport · show
 *                     interfaces status | <if> · show mac address-table [vlan <n> | address <mac> | interface <if>] ·
 *                     show cdp neighbors · show logging · show running-config [interface <if>] · clear … ·
 *                     configure terminal → vlan <n> (name …) · no vlan <n> · interface <if> → switchport mode access |
 *                     trunk · switchport access vlan <n> · switchport trunk allowed vlan [add | remove] <list> ·
 *                     switchport trunk native vlan <n> · shutdown
 *   Switches · Junos  show vlans · show ethernet-switching table [vlan-name <v>] · show ethernet-switching interface ·
 *                     show interfaces terse | <if> · show lldp neighbors · show log messages · show configuration … ·
 *                     configure → set/delete vlans <name> vlan-id <n> · set interfaces <if> unit 0 family
 *                     ethernet-switching interface-mode access | trunk · … vlan members <v> · native-vlan-id <n> ·
 *                     disable → commit (check, and-quit) · rollback
 *   R1 · IOS          show ip interface brief · show interfaces <if> · show vlans · show ip route · show ip arp ·
 *                     show running-config · ping · configure terminal → interface Gi0/0.<n> → encapsulation dot1Q <vid>
 *                     · ip address · shutdown
 *   R1 · Junos        show interfaces terse | <if> · show route · show arp · show configuration · ping · configure →
 *                     set interfaces ge-0/0/0 unit <n> vlan-id <vid> · … family inet address <cidr> → commit
 *   Hosts · Linux     ip addr · ip route · ip neigh · ping · sudo ip addr flush/add · sudo ip route add/del default ·
 *                     sudo ip neigh flush all
 */

export type VlIosMode = { kind: "exec" } | { kind: "config" } | { kind: "if"; port: VlPort } | { kind: "vlan"; vlan: number };
export type VlR1Mode = { kind: "exec" } | { kind: "config" } | { kind: "if"; unit?: number };
export interface VlCand {
  sw: Record<VlSw, VlSwCfg>;
  r1: VlCfg["r1"];
}
export interface VlCliApi {
  view: VlState;
  act: (a: VlAction) => VlState;
  ios: Record<VlSw | "R1", VlIosMode | VlR1Mode>;
  setIos: (d: VlSw | "R1", m: VlIosMode | VlR1Mode) => void;
  junosEdit: Record<VlSw | "R1", boolean>;
  setJunosEdit: (d: VlSw | "R1", b: boolean) => void;
  cand: VlCand;
  setCand: (c: VlCand) => void;
  ask?: (q: CliQuestion | undefined) => void;
  history?: string[];
}

const refuse = (output: string, explanation?: string): CliResult => ({ output, refused: true, explanation });
const prefixed = (cmds: CliCommand[], word: "do" | "run"): CliCommand[] => cmds.map((c) => ({ ...c, id: `${word}:${c.id}`, syntax: `${word} ${c.syntax}` }));
const anyArg: CliArgSpec = { choices: [], resolve: (raw) => raw };
const otherSw = (sw: VlSw): VlSw => (sw === "SW1" ? "SW2" : "SW1");
const stamp = (clock: number) => {
  const t = 3600 + clock;
  const hh = String(Math.floor(t / 3600) % 24).padStart(2, "0");
  const mm = String(Math.floor(t / 60) % 60).padStart(2, "0");
  const ss = String(Math.floor(t) % 60).padStart(2, "0");
  return { ios: `*Mar  1 ${hh}:${mm}:${ss}.000`, junos: `Mar  1 ${hh}:${mm}:${ss}` };
};
export const PORT_DESC: Record<VlSw, Record<VlPort, string>> = {
  SW1: { "ge-0/0/1": "HOST-A", "ge-0/0/2": "HOST-C", "ge-0/0/3": "spare", "ge-0/0/23": "spare", "ge-0/0/24": "trunk-SW2" },
  SW2: { "ge-0/0/1": "HOST-B", "ge-0/0/2": "HOST-D", "ge-0/0/3": "spare", "ge-0/0/23": "trunk-R1", "ge-0/0/24": "trunk-SW1" },
};
const CHASSIS: Record<string, string> = { SW1: "2c:6b:f5:00:01:00", SW2: "2c:6b:f5:00:02:00", R1: "00:00:5e:00:53:01" };
/** "10,20" · "1-5,10" → [1,…] (Cisco VLAN list). */
export function parseVlanList(raw: string): number[] | undefined {
  if (!/^\d+(-\d+)?(,\d+(-\d+)?)*$/.test(raw)) return undefined;
  const out = new Set<number>();
  for (const part of raw.split(",")) {
    const [a, b] = part.split("-").map(Number);
    const hi = b ?? a;
    if (a < 1 || hi > 4094 || hi < a || hi - a > 4094) return undefined;
    for (let v = a; v <= hi; v++) out.add(v);
  }
  return [...out].sort((x, y) => x - y);
}
/** [1,2,3,10] → "1-3,10". */
export function vlanRange(v: number[]): string {
  if (!v.length) return "none";
  const s = [...v].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < s.length; i++) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
    out.push(j > i + 1 ? `${s[i]}-${s[j]}` : j === i + 1 ? `${s[i]},${s[j]}` : `${s[i]}`);
    i = j;
  }
  return out.join(",");
}
const vlanIdArg = (describe = "VLAN ID (1–4094)"): CliArgSpec => ({ choices: ["10", "20", "30"], describe: () => describe, resolve: (raw) => (/^\d+$/.test(raw) && +raw >= 1 && +raw <= 4094 ? String(+raw) : undefined) });
const vlanListArg: CliArgSpec = { choices: ["1,10,20", "10,20", "10", "20"], describe: () => "VLAN list, e.g. 10,20 or 1-5,10", resolve: (raw) => (parseVlanList(raw) ? raw : undefined) };
const ciscoMacArg: CliArgSpec = {
  choices: VL_HOSTS.map((h) => ciscoMac(VL_MAC[h])),
  describe: (c) => VL_HOSTS.find((h) => ciscoMac(VL_MAC[h]) === c),
  resolve: (raw) => {
    const m = /^([0-9a-f]{4})\.([0-9a-f]{4})\.([0-9a-f]{4})$/i.exec(raw);
    return m ? (m[1] + m[2] + m[3]).toUpperCase().match(/.{2}/g)!.join(":") : undefined;
  },
};
const ipArg = (s: VlState): CliArgSpec => ({ choices: [...VL_HOSTS.map((h) => s.cfg.hosts[h].ip).filter(Boolean), ...s.cfg.r1.subs.map((x) => x.ip)], describe: (c) => vlIpOwner(s.cfg, c), resolve: (raw) => (isIp(raw) ? raw : undefined) });

function setCfg(api: VlCliApi, cfg: VlCfg, text: string, junosCommit?: VlSw | "R1") {
  api.act({ type: "cfg", cfg, text, junosCommit });
}
function setSw(api: VlCliApi, sw: VlSw, c: VlSwCfg, text: string, junosCommit = false) {
  const cfg = vlClone(api.view.cfg);
  cfg.sw[sw] = vlClone(c);
  setCfg(api, cfg, `${sw}: ${text}`, junosCommit ? sw : undefined);
}
const sameSw = (a: VlSwCfg, b: VlSwCfg) => JSON.stringify(a) === JSON.stringify(b);
const sameR1 = (a: VlCfg["r1"], b: VlCfg["r1"]) => JSON.stringify(a) === JSON.stringify(b);

const EXPLAIN = {
  vlan: (sw: VlSw) => `The VLANs ${sw} knows and which ACCESS ports belong to each. Trunks are not listed here (they belong to many VLANs — show interfaces trunk). A VLAN must exist here for any port to carry it.`,
  trunk: `For each trunk: the native VLAN (sent untagged), the VLANs it is ALLOWED to carry, and those also defined on this switch ("active"). A VLAN missing from either list is not carried — even with the link up.`,
  mac: (sw: VlSw) => `${sw}'s own table: one list of (VLAN, MAC) → port. A lookup in VLAN 10 only ever matches VLAN 10 entries; the same MAC can appear in two VLANs as two separate entries.`,
};

// ---------------------------------------------------------------------------------------------------------------
// Switches — configuration as each OS prints it
// ---------------------------------------------------------------------------------------------------------------
function iosIfLines(c: VlSwCfg, sw: VlSw, p: VlPort): string[] {
  const pc = c.ports[p];
  return [
    `interface ${CISCO_IF[p]}`,
    ` description ${PORT_DESC[sw][p]}`,
    ...(pc.mode === "access" ? [" switchport mode access", ...(pc.access !== 1 ? [` switchport access vlan ${pc.access}`] : [])] : [...(pc.native !== 1 ? [` switchport trunk native vlan ${pc.native}`] : []), ` switchport trunk allowed vlan ${vlanRange(pc.allowed)}`, " switchport mode trunk"]),
    ...(pc.shut ? [" shutdown"] : []),
    "!",
  ];
}
function iosRunning(c: VlSwCfg, sw: VlSw, port?: VlPort): string {
  if (port) return ["Building configuration...", "", "Current configuration : 160 bytes", "!", ...iosIfLines(c, sw, port).slice(0, -1), "end"].join("\n");
  const body = [`hostname ${sw}`, "!", ...c.vlans.filter((v) => v !== 1).flatMap((v) => [`vlan ${v}`, ` name ${c.names[v] ?? vlanName(v)}`, "!"]), ...VL_PORTS.flatMap((p) => iosIfLines(c, sw, p)), "end"];
  return `Building configuration...\n\nCurrent configuration : ${body.join("\n").length} bytes\n!\n${body.join("\n")}`;
}
interface JNode {
  name: string;
  kids?: JNode[];
}
const jName = (c: VlSwCfg, v: number) => c.names[v] ?? vlanName(v);
function junosSwTree(sw: VlSw, c: VlSwCfg): JNode[] {
  return [
    { name: "system", kids: [{ name: `host-name ${sw}` }] },
    {
      name: "interfaces",
      kids: VL_PORTS.map((p) => {
        const pc = c.ports[p];
        const members = pc.mode === "access" ? (pc.access ? [jName(c, pc.access)] : []) : pc.allowed.map((v) => jName(c, v));
        return {
          name: p,
          kids: [
            ...(pc.shut ? [{ name: "disable" }] : []),
            { name: `description ${PORT_DESC[sw][p]}` },
            ...(pc.mode === "trunk" ? [{ name: `native-vlan-id ${pc.native}` }] : []),
            { name: "unit 0", kids: [{ name: "family ethernet-switching", kids: [{ name: `interface-mode ${pc.mode}` }, ...(members.length ? [{ name: "vlan", kids: [{ name: `members ${members.length > 1 ? `[ ${members.join(" ")} ]` : members[0]}` }] }] : [])] }] },
          ],
        };
      }),
    },
    { name: "vlans", kids: c.vlans.map((v) => ({ name: jName(c, v), kids: [{ name: `vlan-id ${v}` }] })) },
  ];
}
const render = (nodes: JNode[], d = 0): string[] => nodes.flatMap((n) => (n.kids ? [`${"    ".repeat(d)}${n.name} {`, ...render(n.kids, d + 1), `${"    ".repeat(d)}}`] : [`${"    ".repeat(d)}${n.name};`]));
function walk(nodes: JNode[], path: string[]): string {
  const want = [...path];
  while (want.length) {
    const two = want.length > 1 ? `${want[0]} ${want[1]}` : undefined;
    const hit = nodes.find((n) => n.name === two) ?? nodes.find((n) => n.name.toLowerCase() === want[0].toLowerCase());
    if (!hit?.kids) return "";
    want.splice(0, hit.name.split(" ").length);
    nodes = hit.kids;
  }
  return render(nodes).join("\n");
}
export const vlJunosSwText = (sw: VlSw, c: VlSwCfg, path: string[] = []) => walk(junosSwTree(sw, c), path);

/** Junos commit check for a switch candidate: what the real one would refuse. */
export function junosSwCheck(c: VlSwCfg): string | undefined {
  for (const p of VL_PORTS) {
    const pc = c.ports[p];
    // access 0 = the candidate's VLAN member was deleted and not yet replaced (simplified: real Junos would fall back to the default VLAN)
    if (pc.mode === "access" && !pc.access) return `[edit interfaces ${p} unit 0 family ethernet-switching]\n  'vlan'\n    access interface ${p} has no VLAN member (set ... vlan members <name>)`;
    const used = pc.mode === "access" ? [pc.access] : pc.allowed;
    const undef = used.find((v) => !c.vlans.includes(v));
    if (undef !== undefined) return `[edit interfaces ${p} unit 0 family ethernet-switching]\n  'vlan'\n    VLAN ${undef} referenced by ${p} is not defined (set vlans <name> vlan-id ${undef})`;
    if (pc.mode === "trunk" && !pc.allowed.includes(pc.native)) return `[edit interfaces ${p}]\n  'native-vlan-id ${pc.native}'\n    the native VLAN must also be a member of the trunk (vlan members)`;
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------------------------------
// Switches — Cisco IOS
// ---------------------------------------------------------------------------------------------------------------
function iosSwExec(api: VlCliApi, sw: VlSw): CliCommand[] {
  const s = api.view;
  const c = s.cfg.sw[sw];
  const ifArg = { interface: interfaceArg("cisco", CISCO_IF, PORT_DESC[sw]) };
  const ctr = (p: VlPort) => s.counters[`${sw} ${p}`];
  const macTable = (rows: ReturnType<typeof vlTable>, note: string) => ({ output: ["          Mac Address Table", "-------------------------------------------", "", columns([["Vlan", "Mac Address", "Type", "Ports"], ["----", "-----------", "--------", "-----"], ...rows.map((e) => [String(e.vlan).padStart(4), ciscoMac(e.mac), "DYNAMIC", CISCO_SHORT[e.port]])], [8, 18, 12]), `Total Mac Addresses for this criterion: ${rows.length}`].join("\n"), explanation: note });
  const vlanBrief = (only?: number) => {
    const rows = c.vlans.filter((v) => only === undefined || v === only).map((v) => {
      const ports = VL_PORTS.filter((p) => c.ports[p].mode === "access" && c.ports[p].access === v).map((p) => CISCO_SHORT[p]);
      return [String(v), jName(c, v), "active", ports.join(", ")];
    });
    return columns([["VLAN", "Name", "Status", "Ports"], ["----", "--------------------------------", "---------", "-------------------------------"], ...rows], [5, 33, 10]);
  };
  const trunks = VL_PORTS.filter((p) => c.ports[p].mode === "trunk" && vlPortUp(s.cfg, sw, p));
  const swport = (p: VlPort) => {
    const pc = c.ports[p];
    return [
      `Name: ${CISCO_SHORT[p]}`,
      "Switchport: Enabled",
      `Administrative Mode: ${pc.mode === "access" ? "static access" : "trunk"}`,
      `Operational Mode: ${vlPortUp(s.cfg, sw, p) ? (pc.mode === "access" ? "static access" : "trunk") : "down"}`,
      `Administrative Trunking Encapsulation: dot1q`,
      `Access Mode VLAN: ${pc.access} (${c.vlans.includes(pc.access) ? jName(c, pc.access) : "Inactive"})`,
      `Trunking Native Mode VLAN: ${pc.native} (${c.vlans.includes(pc.native) ? jName(c, pc.native) : "Inactive"})`,
      `Trunking VLANs Enabled: ${pc.mode === "trunk" ? vlanRange(pc.allowed) : "ALL"}`,
    ].join("\n");
  };
  const logs = s.syslog.filter((l) => l.sw === sw && l.ev !== "move");
  return [
    { id: "vlan-brief", syntax: "show vlan brief", summary: "VLANs on this switch and their access ports", run: () => ({ output: vlanBrief(), explanation: EXPLAIN.vlan(sw) }) },
    { id: "vlan-brief", syntax: "show vlan", summary: "", hidden: true, run: () => ({ output: vlanBrief(), explanation: EXPLAIN.vlan(sw) }) },
    { id: "vlan-id", syntax: "show vlan id <vlan>", summary: "One VLAN", args: { vlan: vlanIdArg() }, run: ({ vlan }) => (c.vlans.includes(+vlan) ? { output: vlanBrief(+vlan) } : refuse(`VLAN id ${vlan} not found in current VLAN database`, `VLAN ${vlan} doesn't exist on ${sw}: no port carries it.`)) },
    {
      id: "trunk",
      syntax: "show interfaces trunk",
      summary: "Trunks: native VLAN, allowed VLANs, active VLANs",
      run: () => ({
        output: trunks.length
          ? [
              columns([["Port", "Mode", "Encapsulation", "Status", "Native vlan"], ...trunks.map((p) => [CISCO_SHORT[p], "on", "802.1q", "trunking", String(c.ports[p].native)])], [10, 13, 15, 13]),
              "",
              columns([["Port", "Vlans allowed on trunk"], ...trunks.map((p) => [CISCO_SHORT[p], vlanRange(c.ports[p].allowed)])], [10]),
              "",
              columns([["Port", "Vlans allowed and active in management domain"], ...trunks.map((p) => [CISCO_SHORT[p], vlanRange(vlPortVlans(s.cfg, sw, p))])], [10]),
              "",
              columns([["Port", "Vlans in spanning tree forwarding state and not pruned"], ...trunks.map((p) => [CISCO_SHORT[p], vlanRange(vlPortVlans(s.cfg, sw, p))])], [10]),
            ].join("\n")
          : "",
        explanation: trunks.length ? EXPLAIN.trunk : `No trunk is up on ${sw}.`,
      }),
    },
    { id: "swport", syntax: "show interfaces <interface> switchport", summary: "One port's VLAN settings (mode, access VLAN, native, allowed)", args: ifArg, run: ({ interface: p }) => ({ output: swport(p as VlPort), explanation: vlInactive(s.cfg, sw, p) ? `This access port is in VLAN ${c.ports[p as VlPort].access}, which doesn't exist on ${sw}: the port carries nothing (Inactive).` : "Mode decides how frames are classified: access = one VLAN, untagged; trunk = many VLANs, tagged (native untagged)." }) },
    { id: "status", syntax: "show interfaces status", summary: "Link state and VLAN of every port", run: () => ({ output: columns([["Port", "Name", "Status", "Vlan", "Duplex", "Speed", "Type"], ...VL_PORTS.map((p) => { const st = vlPortStatus(s.cfg, sw, p); const pc = c.ports[p]; return [CISCO_SHORT[p], PORT_DESC[sw][p], vlInactive(s.cfg, sw, p) && st === "connected" ? "inactive" : st, pc.mode === "trunk" ? "trunk" : String(pc.access), st === "connected" ? "a-full" : "auto", st === "connected" ? "a-1000" : "auto", "10/100/1000BaseTX"]; })], [10, 12, 13, 7, 8, 8]), explanation: "The Vlan column is the access VLAN (or “trunk”). “inactive” = an access port in a VLAN that doesn't exist on this switch." }) },
    {
      id: "if",
      syntax: "show interfaces <interface>",
      summary: "One port: link and counters (including tagged frames and drops)",
      args: ifArg,
      run: ({ interface: p }) => {
        const k = ctr(p as VlPort);
        const st = vlPortStatus(s.cfg, sw, p);
        return { output: [`${CISCO_IF[p as VlPort]} is ${st === "disabled" ? "administratively down" : st === "connected" ? "up" : "down"}, line protocol is ${st === "connected" ? "up (connected)" : "down"}`, `  Description: ${PORT_DESC[sw][p as VlPort]}`, `     ${k.inF} packets input, ${k.inB} broadcasts, ${k.tagIn} 802.1Q-tagged`, `     ${k.drops} input drops (frames of a VLAN this port doesn't carry)`, `     ${k.outF} packets output, ${k.outB} broadcasts, ${k.tagOut} 802.1Q-tagged`].join("\n"), explanation: "Tagged counts prove which frames crossed as trunk traffic; input drops count frames this port refused (VLAN not allowed or not defined)." };
      },
    },
    { id: "mac", syntax: "show mac address-table", summary: `${sw}'s MAC table: (VLAN, MAC) → port`, run: () => macTable(vlTable(s.fdb, sw), EXPLAIN.mac(sw)) },
    { id: "mac", syntax: "show mac address-table vlan <vlan>", summary: "One VLAN's entries", args: { vlan: vlanIdArg() }, run: ({ vlan }) => macTable(vlTable(s.fdb, sw, +vlan), `Only VLAN ${vlan}'s entries: a VLAN ${vlan} frame can only be forwarded using these.`) },
    { id: "mac", syntax: "show mac address-table address <mac>", summary: "Which VLAN and port a MAC was learned in", args: { mac: ciscoMacArg }, run: ({ mac }) => macTable(vlTable(s.fdb, sw).filter((e) => e.mac === mac), `The VLAN column says which broadcast domain ${vlMacName(s.cfg, mac)} was heard in — on a misconfigured port that can be the wrong one.`) },
    { id: "mac", syntax: "show mac address-table interface <interface>", summary: "MACs learned behind one port", args: ifArg, run: ({ interface: p }) => macTable(vlTable(s.fdb, sw).filter((e) => e.port === p), c.ports[p as VlPort].mode === "trunk" ? "A trunk has entries in several VLANs: every host behind it, in its own VLAN." : "One host, one VLAN.") },
    {
      id: "cdp",
      syntax: "show cdp neighbors",
      summary: "Cisco neighbors on each link",
      run: () => {
        const nb = VL_PORTS.filter((p) => vlPortUp(s.cfg, sw, p) && (p === TRUNK || p === RTR_PORT)).map((p) => ({ p, peer: vlPeer(s.cfg, sw, p)! }));
        return { output: ["Capability Codes: R - Router, T - Trans Bridge, B - Source Route Bridge", "                  S - Switch, H - Host, I - IGMP, r - Repeater", "", columns([["Device ID", "Local Intrfce", "Holdtme", "Capability", "Platform", "Port ID"], ...nb.map((n) => [n.peer.dev, CISCO_SHORT[n.p], "158", n.peer.dev === "R1" ? "R" : "S I", n.peer.dev === "R1" ? "ISR4331" : "C9300", n.peer.dev === "R1" ? "Gig 0/0" : CISCO_SHORT[n.p]])], [12, 15, 9, 12, 10]), "", `Total cdp entries displayed : ${nb.length}`].join("\n"), explanation: "CDP is Cisco's neighbor protocol. Among other things it compares the native VLAN at both ends of a trunk and logs a mismatch (show logging)." };
      },
    },
    {
      id: "logging",
      syntax: "show logging",
      summary: "The log: links, native-VLAN mismatches",
      run: () => ({
        output: ["Syslog logging: enabled", "", "Log Buffer (8192 bytes):", ...(logs.length ? logs.slice(-40).map((l) => {
          const t = stamp(l.clock).ios;
          if (l.ev === "native") return `${t}: %CDP-4-NATIVE_VLAN_MISMATCH: Native VLAN mismatch discovered on ${CISCO_IF[TRUNK]} (${l.native}), with ${otherSw(sw)} ${CISCO_IF[TRUNK]} (${l.peerNative}).`;
          if (l.ev === "admin-down") return `${t}: %LINK-5-CHANGED: Interface ${CISCO_IF[l.port as VlPort]}, changed state to administratively down`;
          return `${t}: %LINK-3-UPDOWN: Interface ${CISCO_IF[l.port as VlPort]}, changed state to ${l.ev}`;
        }) : ["(no messages)"])].join("\n"),
        explanation: "NATIVE_VLAN_MISMATCH comes from CDP: the two ends of the trunk send untagged frames into different VLANs.",
      }),
    },
    { id: "run", syntax: "show running-config", summary: `${sw}'s configuration`, run: () => ({ output: iosRunning(c, sw), explanation: "VLANs (vlan … / name …) and each port's switchport settings. What the switch LEARNED is not configuration (show mac address-table)." }) },
    { id: "run", syntax: "show running-config interface <interface>", summary: "One port's configuration", args: ifArg, run: ({ interface: p }) => ({ output: iosRunning(c, sw, p as VlPort) }) },
    { id: "clear", syntax: "clear mac address-table dynamic", summary: "Forget every learned entry (this switch)", run: () => (api.act({ type: "clear", sw }), { output: "", explanation: `${sw}'s learned entries are gone in every VLAN.` }) },
    { id: "clear", syntax: "clear mac address-table dynamic vlan <vlan>", summary: "Forget one VLAN's learned entries", args: { vlan: vlanIdArg() }, run: ({ vlan }) => (api.act({ type: "clear", sw, vlan: +vlan }), { output: "" }) },
    { id: "clear-ctr", syntax: "clear counters", summary: "Reset the interface counters", run: () => (api.act({ type: "clear-counters", sw }), { output: "" }) },
    { id: "hist", syntax: "show history", summary: "The commands you typed in this session", run: () => ({ output: [...(api.history ?? []), "show history"].map((x) => `  ${x}`).join("\n") }) },
  ];
}

function iosSwSet(api: VlCliApi, sw: VlSw): CliCommandSet {
  const s = api.view;
  const c = s.cfg.sw[sw];
  const exec = iosSwExec(api, sw);
  const ifArg = { interface: interfaceArg("cisco", CISCO_IF, PORT_DESC[sw]) };
  const base = { vendor: "cisco" as const, deviceId: sw, deviceName: sw };
  const mode = api.ios[sw] as VlIosMode;
  const end: CliCommand = { id: "end", syntax: "end", summary: "Leave configuration mode", run: () => (api.setIos(sw, { kind: "exec" }), { output: "%SYS-5-CONFIG_I: Configured from console by console" }) };
  const conf = (syntax: string, hidden = false): CliCommand => ({ id: "conf", syntax, summary: hidden ? "" : "Enter configuration mode", hidden, run: () => (api.setIos(sw, { kind: "config" }), { output: "Enter configuration commands, one per line.  End with CNTL/Z." }) });
  if (mode.kind === "exec") return { ...base, prompt: `${sw}#`, commands: [...exec, conf("configure terminal"), conf("conf t", true)] };
  const doCmds = prefixed(exec, "do");
  const vlanCmd: CliCommand = {
    id: "vlan",
    syntax: "vlan <vlan>",
    summary: "Create a VLAN (or enter it to name it)",
    args: { vlan: vlanIdArg() },
    run: ({ vlan }) => {
      const v = +vlan;
      if (!c.vlans.includes(v)) setSw(api, sw, { ...c, vlans: [...c.vlans, v].sort((a, b) => a - b), names: { ...c.names, [v]: vlanName(v) } }, `vlan ${v}`);
      api.setIos(sw, { kind: "vlan", vlan: v });
      return { output: "", explanation: c.vlans.includes(v) ? undefined : `VLAN ${v} now exists on ${sw}. No port carries it yet: put access ports in it, and allow it on the trunks that should carry it.` };
    },
  };
  const noVlan: CliCommand = {
    id: "novlan",
    syntax: "no vlan <vlan>",
    summary: "Delete a VLAN",
    args: { vlan: { ...vlanIdArg(), choices: c.vlans.filter((v) => v !== 1).map(String) } },
    run: ({ vlan }) => {
      const v = +vlan;
      if (v === 1) return refuse("%Default VLAN 1 may not be deleted.");
      if (!c.vlans.includes(v)) return refuse(`% VLAN ${v} does not exist`);
      setSw(api, sw, { ...c, vlans: c.vlans.filter((x) => x !== v) }, `no vlan ${v}`);
      const orphan = VL_PORTS.filter((p) => c.ports[p].mode === "access" && c.ports[p].access === v);
      return { output: "", explanation: orphan.length ? `Deleted. ${orphan.map((p) => CISCO_SHORT[p]).join(", ")} still say “access vlan ${v}” and are now INACTIVE: they carry nothing until VLAN ${v} exists again.` : "Deleted. Trunks stop carrying it." };
    },
  };
  if (mode.kind === "config" || mode.kind === "vlan")
    return {
      ...base,
      prompt: mode.kind === "vlan" ? `${sw}(config-vlan)#` : `${sw}(config)#`,
      commands: [
        ...(mode.kind === "vlan"
          ? [
              {
                id: "name",
                syntax: "name <text>",
                summary: "Name this VLAN",
                args: { text: { ...anyArg, choices: ["SALES", "ENG", "GUEST"] } },
                run: ({ text }: Record<string, string>) => (setSw(api, sw, { ...c, names: { ...c.names, [mode.vlan]: text.toUpperCase() } }, `vlan ${mode.vlan} name ${text.toUpperCase()}`), { output: "", explanation: "The name is for people: switches identify the VLAN by its number (the VID in the tag)." }),
              } as CliCommand,
            ]
          : []),
        { id: "if", syntax: "interface <interface>", summary: "Configure one port", args: ifArg, run: ({ interface: p }) => (api.setIos(sw, { kind: "if", port: p as VlPort }), { output: "" }) },
        vlanCmd,
        noVlan,
        { id: "exit", syntax: "exit", summary: mode.kind === "vlan" ? "Back to global configuration" : "Back to privileged mode", run: () => (api.setIos(sw, mode.kind === "vlan" ? { kind: "config" } : { kind: "exec" }), { output: "" }) },
        end,
        ...doCmds,
      ],
    };
  const p = mode.port;
  const pc = c.ports[p];
  const setPort = (patch: Partial<VlPortCfg>, line: string, extra?: (n: VlSwCfg) => VlSwCfg) => {
    let n: VlSwCfg = { ...c, ports: { ...c.ports, [p]: { ...pc, ...patch } } };
    if (extra) n = extra(n);
    setSw(api, sw, n, `interface ${CISCO_IF[p]} · ${line}`);
  };
  const trunkOnly = (r: () => CliResult): CliResult => (pc.mode !== "trunk" ? { ...r(), explanation: `Saved — but ${CISCO_SHORT[p]} is an ACCESS port, so trunk settings don't apply until "switchport mode trunk".` } : r());
  return {
    ...base,
    prompt: `${sw}(config-if)#`,
    commands: [
      { id: "mode", syntax: "switchport mode access", summary: "One VLAN, untagged (a host port)", run: () => (setPort({ mode: "access" }, "switchport mode access"), { output: "", explanation: `${CISCO_SHORT[p]} now carries only VLAN ${pc.access}, untagged.${p === TRUNK || p === RTR_PORT ? " This was a trunk: tagged frames arriving on it are now dropped, and other VLANs stop crossing." : ""}` }) },
      { id: "mode", syntax: "switchport mode trunk", summary: "Many VLANs, 802.1Q-tagged (a switch/router link)", run: () => (setPort({ mode: "trunk", allowed: pc.allowed.length ? pc.allowed : [...c.vlans] }, "switchport mode trunk"), { output: "", explanation: `${CISCO_SHORT[p]} now tags every allowed VLAN except native ${pc.native}.${vlHostAt(s.cfg, sw, p) ? ` But a host is plugged in here: hosts don't understand tags and will discard tagged frames.` : ""}` }) },
      {
        id: "access",
        syntax: "switchport access vlan <vlan>",
        summary: "This access port's VLAN",
        args: { vlan: vlanIdArg() },
        run: ({ vlan }) => {
          const v = +vlan;
          const create = !c.vlans.includes(v);
          setPort({ access: v }, `switchport access vlan ${v}`, create ? (n) => ({ ...n, vlans: [...n.vlans, v].sort((a, b) => a - b), names: { ...n.names, [v]: vlanName(v) } }) : undefined);
          return { output: create ? `% Access VLAN does not exist. Creating vlan ${v}` : "", explanation: pc.mode === "trunk" ? `Saved, but ${CISCO_SHORT[p]} is a trunk: the access VLAN applies only in access mode.` : `Frames arriving untagged on ${CISCO_SHORT[p]} now belong to VLAN ${v}. The host isn't told — its IP settings must match VLAN ${v}'s subnet.` };
        },
      },
      { id: "allowed", syntax: "switchport trunk allowed vlan <list>", summary: "Exactly which VLANs this trunk carries", args: { list: vlanListArg }, run: ({ list }) => trunkOnly(() => (setPort({ allowed: parseVlanList(list)! }, `switchport trunk allowed vlan ${list}`), { output: "", explanation: `Replaces the list: ${CISCO_SHORT[p]} now carries only ${vlanRange(parseVlanList(list)!)}. (Use “add” to add one without removing the others.)` })) },
      { id: "allowed", syntax: "switchport trunk allowed vlan add <list>", summary: "Add VLANs to the list", args: { list: vlanListArg }, run: ({ list }) => trunkOnly(() => (setPort({ allowed: [...new Set([...pc.allowed, ...parseVlanList(list)!])].sort((a, b) => a - b) }, `switchport trunk allowed vlan add ${list}`), { output: "" })) },
      { id: "allowed", syntax: "switchport trunk allowed vlan remove <list>", summary: "Remove VLANs from the list", args: { list: vlanListArg }, run: ({ list }) => trunkOnly(() => (setPort({ allowed: pc.allowed.filter((v) => !parseVlanList(list)!.includes(v)) }, `switchport trunk allowed vlan remove ${list}`), { output: "" })) },
      { id: "allowed", syntax: "switchport trunk allowed vlan all", summary: "Carry every VLAN that exists", run: () => trunkOnly(() => (setPort({ allowed: Array.from({ length: 4094 }, (_, i) => i + 1) }, "switchport trunk allowed vlan all"), { output: "" })) },
      { id: "native", syntax: "switchport trunk native vlan <vlan>", summary: "The VLAN sent untagged on this trunk", args: { vlan: vlanIdArg() }, run: ({ vlan }) => trunkOnly(() => (setPort({ native: +vlan }, `switchport trunk native vlan ${vlan}`), { output: "", explanation: `VLAN ${vlan} now crosses ${CISCO_SHORT[p]} UNTAGGED, and untagged frames arriving here go into VLAN ${vlan}. The other end must use the same native VLAN.` })) },
      { id: "native", syntax: "no switchport trunk native vlan", summary: "Back to native VLAN 1", run: () => trunkOnly(() => (setPort({ native: 1 }, "no switchport trunk native vlan"), { output: "" })) },
      { id: "encap", syntax: "switchport trunk encapsulation dot1q", summary: "", hidden: true, run: () => ({ output: "", explanation: "This switch only speaks 802.1Q: nothing to choose." }) },
      { id: "shut", syntax: "shutdown", summary: "Disable this port", run: () => (setPort({ shut: true }, "shutdown"), { output: `${stamp(s.clock).ios}: %LINK-5-CHANGED: Interface ${CISCO_IF[p]}, changed state to administratively down` }) },
      { id: "noshut", syntax: "no shutdown", summary: "Enable this port", run: () => (pc.shut ? (setPort({ shut: false }, "no shutdown"), { output: vlPeer(s.cfg, sw, p) ? `${stamp(s.clock).ios}: %LINK-3-UPDOWN: Interface ${CISCO_IF[p]}, changed state to up` : "", explanation: vlPeer(s.cfg, sw, p) ? undefined : "Enabled, but nothing is plugged in (notconnect)." }) : { output: "" }) },
      { id: "if", syntax: "interface <interface>", summary: "Move to another port", args: ifArg, run: ({ interface: q }) => (api.setIos(sw, { kind: "if", port: q as VlPort }), { output: "" }) },
      vlanCmd,
      { id: "exit", syntax: "exit", summary: "Back to global configuration", run: () => (api.setIos(sw, { kind: "config" }), { output: "" }) },
      end,
      ...doCmds,
      { id: "desc", syntax: "description <text>", summary: "", hidden: true, args: { text: anyArg }, run: () => refuse("% Not available in this lab: the descriptions record what each port is for.") },
    ],
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Switches — Junos (EX, ELS)
// ---------------------------------------------------------------------------------------------------------------
function junosSwOp(api: VlCliApi, sw: VlSw): CliCommand[] {
  const s = api.view;
  const c = s.cfg.sw[sw];
  const ifArg: CliArgSpec = { choices: [...VL_PORTS], describe: (x) => PORT_DESC[sw][x as VlPort], resolve: (raw) => ((VL_PORTS as readonly string[]).includes(raw.replace(/\.0$/, "")) ? raw.replace(/\.0$/, "") : undefined) };
  const vnameArg: CliArgSpec = { choices: c.vlans.map((v) => jName(c, v)), describe: (x) => `VLAN ${c.vlans.find((v) => jName(c, v) === x)}`, resolve: (raw) => c.vlans.map((v) => jName(c, v)).find((n) => n.toLowerCase() === raw.toLowerCase()) };
  const table = (rows: ReturnType<typeof vlTable>) => ({
    output: ["MAC flags (S - static MAC, D - dynamic MAC, L - locally learned)", "", `Ethernet switching table : ${rows.length} entries, ${rows.length} learned`, "Routing instance : default-switch", columns([["   Vlan", "MAC", "MAC", "Age", "Logical"], ["   name", "address", "flags", "", "interface"], ...rows.map((e) => [`   ${jName(c, e.vlan)}`, e.mac.toLowerCase(), "D", "-", `${e.port}.0`])], [13, 20, 8, 6])].join("\n"),
    explanation: EXPLAIN.mac(sw),
  });
  const ctr = (p: VlPort) => s.counters[`${sw} ${p}`];
  const showIf = (p: VlPort) => {
    const k = ctr(p);
    const st = vlPortStatus(s.cfg, sw, p);
    return { output: [`Physical interface: ${p}, ${st === "disabled" ? "Administratively down" : "Enabled"}, Physical link is ${st === "connected" ? "Up" : "Down"}`, `  Description: ${PORT_DESC[sw][p]}`, "  Traffic statistics:", `   Input  packets:            ${k.inF}`, `   Output packets:            ${k.outF}`, "  Input errors:", `    Drops: ${k.drops}`, `  Logical interface ${p}.0`, `    Protocol eth-switch, ${c.ports[p].mode === "trunk" ? `Trunk, native VLAN ${c.ports[p].native}` : "Access"}`].join("\n"), explanation: "Drops count frames this port refused (a VLAN it doesn't carry, or that doesn't exist)." };
  };
  const ethIf = (ports: VlPort[]): CliResult => ({
    output: ["Routing Instance Name : default-switch", "Logical Interface flags (DL - disable learning, AD - packet action drop)", "", columns([["Logical", "Vlan", "TAG", "MAC", "Interface"], ["interface", "members", "", "limit", "flags"], ...ports.flatMap((p) => {
      const pc = c.ports[p];
      const vs = pc.mode === "access" ? [pc.access] : pc.allowed;
      return vs.map((v, i) => [i === 0 ? `${p}.0` : "", jName(c, v), String(v), "294912", pc.mode === "trunk" ? (v === pc.native ? "untagged (native)" : "tagged") : "untagged"]);
    })], [14, 12, 6, 8])].join("\n"),
    explanation: "The TAG column is the VID a frame carries on that interface — and “untagged” for the access VLAN or the trunk's native VLAN.",
  });
  return [
    {
      id: "vlans",
      syntax: "show vlans",
      summary: "VLANs and their member interfaces (* = active)",
      run: () => ({
        output: ["Routing instance        VLAN name             Tag          Interfaces", ...c.vlans.flatMap((v) => {
          const mem = VL_PORTS.filter((p) => (c.ports[p].mode === "access" ? c.ports[p].access === v : c.ports[p].allowed.includes(v)));
          const lines = mem.map((p) => `${p}.0${vlPortUp(s.cfg, sw, p) ? "*" : ""}`);
          return [`default-switch          ${jName(c, v).padEnd(22)}${String(v).padEnd(13)}${lines[0] ?? ""}`, ...lines.slice(1).map((l) => `${"".padEnd(59)}${l}`)];
        })].join("\n"),
        explanation: "Unlike Cisco's show vlan, Junos lists trunk members too. * marks interfaces that are up.",
      }),
    },
    { id: "eth-table", syntax: "show ethernet-switching table", summary: `${sw}'s MAC table: (VLAN, MAC) → interface`, run: () => table(vlTable(s.fdb, sw)) },
    { id: "eth-table", syntax: "show ethernet-switching table vlan-name <vname>", summary: "One VLAN's entries", args: { vname: vnameArg }, run: ({ vname }) => table(vlTable(s.fdb, sw, c.vlans.find((v) => jName(c, v) === vname))) },
    { id: "eth-if", syntax: "show ethernet-switching interface", summary: "Each interface's mode, VLANs and tagging", run: () => ethIf([...VL_PORTS]) },
    { id: "eth-if", syntax: "show ethernet-switching interface <iface>", summary: "One interface's VLANs and tagging", args: { iface: ifArg }, run: ({ iface }) => ethIf([iface as VlPort]) },
    { id: "terse", syntax: "show interfaces terse", summary: "Link state of every port", run: () => ({ output: columns([["Interface", "Admin", "Link", "Proto"], ...VL_PORTS.flatMap((p) => { const st = vlPortStatus(s.cfg, sw, p); return [[p, st === "disabled" ? "down" : "up", st === "connected" ? "up" : "down", ""], [`${p}.0`, st === "disabled" ? "down" : "up", st === "connected" ? "up" : "down", "eth-switch"]]; })], [16, 6, 6]) }) },
    { id: "if", syntax: "show interfaces <iface>", summary: "One port: link, mode, counters and drops", args: { iface: ifArg }, run: ({ iface }) => showIf(iface as VlPort) },
    { id: "lldp", syntax: "show lldp neighbors", summary: "What is at the other end of each link", run: () => ({ output: columns([["Local Interface", "Parent Interface", "Chassis Id", "Port info", "System Name"], ...VL_PORTS.filter((p) => vlPortUp(s.cfg, sw, p) && (p === TRUNK || p === RTR_PORT)).map((p) => { const peer = vlPeer(s.cfg, sw, p)!; return [p, "-", CHASSIS[peer.dev], peer.port, peer.dev]; })], [19, 20, 20, 15]), explanation: "LLDP names the neighbor. It does NOT compare native VLANs — on Junos a native-VLAN mismatch produces no warning: compare both ends' configuration." }) },
    { id: "log", syntax: "show log messages", summary: "System log: links up and down", run: () => { const l = s.syslog.filter((x) => x.sw === sw && (x.ev === "up" || x.ev === "down" || x.ev === "admin-down")); return { output: l.length ? l.slice(-40).map((x) => `${stamp(x.clock).junos}  ${sw} mib2d[1734]: SNMP_TRAP_LINK_${x.ev === "up" ? "UP" : "DOWN"}: ifName ${x.port}`).join("\n") : "(no link events)", explanation: "Junos logs link changes; it has no CDP, so a native-VLAN mismatch is not logged." }; } },
    { id: "cfg", syntax: "show configuration", summary: `${sw}'s committed configuration`, run: () => ({ output: vlJunosSwText(sw, c), explanation: "Try | display set." }) },
    { id: "cfg", syntax: "show configuration interfaces", summary: "Interfaces: mode, VLAN members, native VLAN", run: () => ({ output: vlJunosSwText(sw, c, ["interfaces"]) }) },
    { id: "cfg", syntax: "show configuration interfaces <iface>", summary: "One interface", args: { iface: ifArg }, run: ({ iface }) => ({ output: vlJunosSwText(sw, c, ["interfaces", iface]) }) },
    { id: "cfg", syntax: "show configuration vlans", summary: "VLAN names and IDs", run: () => ({ output: vlJunosSwText(sw, c, ["vlans"]) }) },
    { id: "clear", syntax: "clear ethernet-switching table", summary: "Forget every learned entry", run: () => (api.act({ type: "clear", sw }), { output: "" }) },
    { id: "clear-ctr", syntax: "clear interfaces statistics all", summary: "Reset the interface counters", run: () => (api.act({ type: "clear-counters", sw }), { output: "" }) },
    { id: "hist", syntax: "show cli history", summary: "The commands you typed in this session", run: () => ({ output: [...(api.history ?? []), "show cli history"].map((x, n) => `${String(n + 1).padStart(4)}  ${x}`).join("\n") }) },
  ];
}

function junosEditCommon(api: VlCliApi, dev: VlSw | "R1", dirty: boolean, check: () => string | undefined, commit: () => void, discard: () => void, op: CliCommand[], load: (json: string) => void): CliCommand[] {
  const hist = api.view.rb?.[dev] ?? [];
  const doCommit = (quit: boolean): CliResult => {
    const err = check();
    if (err) return refuse(`${err}\nerror: configuration check-out failed`, "Junos checks the whole candidate before activating it. Nothing changed.");
    if (dirty) commit();
    if (quit) api.setJunosEdit(dev, false);
    return { output: quit ? "commit complete\nExiting configuration mode" : "commit complete", explanation: dirty ? "Active now. Prove it with traffic." : undefined };
  };
  return [
    { id: "commit", syntax: "commit", summary: "Activate the candidate configuration", run: () => doCommit(false) },
    { id: "commit", syntax: "commit check", summary: "Check the candidate without activating it", run: () => { const err = check(); return err ? refuse(`${err}\nerror: configuration check-out failed`) : { output: "configuration check succeeds" }; } },
    { id: "commit", syntax: "commit and-quit", summary: "Commit, then leave configuration mode", run: () => doCommit(true) },
    { id: "rollback", syntax: "rollback", summary: "Discard your uncommitted changes (= rollback 0)", run: () => (discard(), { output: "load complete" }) },
    {
      id: "rollback",
      syntax: "rollback <n>",
      summary: "Load an earlier committed configuration into the candidate (then commit)",
      args: { n: { choices: ["0", ...hist.map((_, i) => String(i + 1))], describe: (x) => (x === "0" ? "the active configuration" : x === "1" ? "before the last commit" : `before the last ${x} commits`), resolve: (raw) => (/^\d{1,2}$/.test(raw) ? String(+raw) : undefined) } },
      run: ({ n }) => {
        if (n === "0") return (discard(), { output: "load complete" });
        const json = hist[Number(n) - 1];
        if (!json) return refuse(`error: rollback ${n} does not exist${hist.length ? ` (1–${hist.length} available)` : " (no commits yet)"}`);
        load(json);
        return { output: "load complete", explanation: `The candidate now holds the configuration from before the last ${n === "1" ? "commit" : `${n} commits`}. show | compare, then commit to activate it.` };
      },
    },
    ...prefixed(op, "run"),
    {
      id: "exit",
      syntax: "exit",
      summary: "Leave configuration mode",
      run: () => {
        if (!dirty || !api.ask) return (api.setJunosEdit(dev, false), { output: "Exiting configuration mode" });
        api.ask({ node: dev, prompt: "The configuration has been changed but not committed\nExit with uncommitted changes? [yes,no] (yes) ", answer: (line) => { api.ask?.(undefined); if (/^n(o)?$/i.test(line.trim())) return { output: "" }; api.setJunosEdit(dev, false); return { output: "Exiting configuration mode" }; }, cancel: () => (api.ask?.(undefined), "") });
        return { output: "" };
      },
    },
  ];
}

function junosSwSet(api: VlCliApi, sw: VlSw): CliCommandSet {
  const s = api.view;
  const base = { vendor: "juniper" as const, deviceId: sw, deviceName: sw };
  const op = junosSwOp(api, sw);
  const active = s.cfg.sw[sw];
  const cand = api.cand.sw[sw];
  const dirty = !sameSw(cand, active);
  const configure: CliCommand = { id: "conf", syntax: "configure", summary: "Enter configuration mode (the candidate configuration)", run: () => (!dirty && api.setCand({ ...api.cand, sw: { ...api.cand.sw, [sw]: vlClone(active) } }), api.setJunosEdit(sw, true), { output: dirty ? "Entering configuration mode\nThe configuration has been changed but not committed\n" : "Entering configuration mode\n", explanation: "Changes go into the candidate: the switch keeps running the committed configuration until you commit." }) };
  if (!api.junosEdit[sw]) return { ...base, prompt: `admin@${sw}> `, commands: [...op, configure] };
  const set = (c: VlSwCfg) => api.setCand({ ...api.cand, sw: { ...api.cand.sw, [sw]: c } });
  const ifArg: CliArgSpec = { choices: [...VL_PORTS], describe: (x) => PORT_DESC[sw][x as VlPort], resolve: (raw) => ((VL_PORTS as readonly string[]).includes(raw) ? raw : undefined) };
  const byName = (raw: string) => cand.vlans.find((v) => jName(cand, v).toLowerCase() === raw.toLowerCase()) ?? (/^\d+$/.test(raw) && cand.vlans.includes(+raw) ? +raw : undefined);
  const memberArg: CliArgSpec = { choices: cand.vlans.map((v) => jName(cand, v)), describe: (x) => `VLAN ${byName(x) ?? "?"}`, resolve: (raw) => (/^[a-z][\w-]{0,31}$/i.test(raw) || /^\d+$/.test(raw) ? raw : undefined) };
  const port = (p: string) => cand.ports[p as VlPort];
  const setPort = (p: string, patch: Partial<VlPortCfg>) => set({ ...cand, ports: { ...cand.ports, [p]: { ...port(p), ...patch } } });
  const resolveMember = (raw: string): number | undefined => byName(raw) ?? (/^\d+$/.test(raw) ? +raw : undefined);
  return {
    ...base,
    prompt: `admin@${sw}# `,
    commands: [
      { id: "set-vlan", syntax: "set vlans <name> vlan-id <vlan>", summary: "Define a VLAN (name + ID)", args: { name: { ...anyArg, choices: ["GUEST", "SALES", "ENG"] }, vlan: vlanIdArg() }, run: ({ name, vlan }) => { const v = +vlan; const nm = name.toUpperCase(); return (set({ ...cand, vlans: [...new Set([...cand.vlans, v])].sort((a, b) => a - b), names: { ...cand.names, [v]: nm } }), { output: "" }); } },
      { id: "del-vlan", syntax: "delete vlans <name>", summary: "Remove a VLAN definition", args: { name: { ...anyArg, choices: cand.vlans.filter((v) => v !== 1).map((v) => jName(cand, v)) } }, run: ({ name }) => { const v = byName(name); if (v === undefined) return refuse("warning: statement not found"); if (v === 1) return refuse("error: the default VLAN cannot be deleted here"); return (set({ ...cand, vlans: cand.vlans.filter((x) => x !== v) }), { output: "" }); } },
      { id: "mode", syntax: "set interfaces <iface> unit 0 family ethernet-switching interface-mode access", summary: "One VLAN, untagged", args: { iface: ifArg }, run: ({ iface }) => (setPort(iface, { mode: "access", access: port(iface).mode === "access" ? port(iface).access : (port(iface).allowed.find((v) => v !== 1) ?? 1) }), { output: "" }) },
      { id: "mode", syntax: "set interfaces <iface> unit 0 family ethernet-switching interface-mode trunk", summary: "Many VLANs, tagged (native untagged)", args: { iface: ifArg }, run: ({ iface }) => (setPort(iface, { mode: "trunk", allowed: port(iface).mode === "trunk" ? port(iface).allowed : [port(iface).access] }), { output: "" }) },
      {
        id: "members",
        syntax: "set interfaces <iface> unit 0 family ethernet-switching vlan members <member>",
        summary: "Add a VLAN to the interface (access: its VLAN)",
        args: { iface: ifArg, member: memberArg },
        run: ({ iface, member }) => {
          const v = resolveMember(member);
          if (v === undefined) return refuse(`error: VLAN ${member} is not defined — set vlans ${member.toUpperCase()} vlan-id <id> first (commit would fail)`);
          const pc = port(iface);
          return pc.mode === "access" ? (setPort(iface, { access: v }), { output: "", explanation: `${iface} will be in VLAN ${v} after commit.` }) : (setPort(iface, { allowed: [...new Set([...pc.allowed, v])].sort((a, b) => a - b) }), { output: "", explanation: `${iface} will also carry VLAN ${v} after commit.` });
        },
      },
      { id: "del-members", syntax: "delete interfaces <iface> unit 0 family ethernet-switching vlan members <member>", summary: "Remove a VLAN from the interface (access: then set the new one)", args: { iface: ifArg, member: memberArg }, run: ({ iface, member }) => { const v = resolveMember(member); const pc = port(iface); if (v === undefined || (pc.mode === "trunk" ? !pc.allowed.includes(v) : pc.access !== v)) return refuse("warning: statement not found"); return pc.mode === "trunk" ? (setPort(iface, { allowed: pc.allowed.filter((x) => x !== v) }), { output: "" }) : (setPort(iface, { access: 0 }), { output: "", explanation: `${iface} has no VLAN in the candidate now. Set the new one before you commit.` }); } },
      { id: "native", syntax: "set interfaces <iface> native-vlan-id <vlan>", summary: "The VLAN sent untagged on this trunk", args: { iface: ifArg, vlan: vlanIdArg() }, run: ({ iface, vlan }) => (setPort(iface, { native: +vlan }), { output: "", explanation: `After commit, VLAN ${vlan} crosses ${iface} untagged. The other end must agree.` }) },
      { id: "native", syntax: "delete interfaces <iface> native-vlan-id", summary: "Back to native VLAN 1 (default)", args: { iface: ifArg }, run: ({ iface }) => (setPort(iface, { native: 1 }), { output: "" }) },
      { id: "dis", syntax: "set interfaces <iface> disable", summary: "Disable a port", args: { iface: ifArg }, run: ({ iface }) => (setPort(iface, { shut: true }), { output: "" }) },
      { id: "dis", syntax: "delete interfaces <iface> disable", summary: "Enable a port", args: { iface: ifArg }, run: ({ iface }) => (port(iface).shut ? (setPort(iface, { shut: false }), { output: "" }) : refuse("warning: statement not found")) },
      { id: "show", syntax: "show", summary: "The candidate configuration (try show | compare)", run: () => ({ output: vlJunosSwText(sw, cand) }) },
      { id: "show", syntax: "show interfaces", summary: "Candidate interfaces", run: () => ({ output: vlJunosSwText(sw, cand, ["interfaces"]) }) },
      { id: "show", syntax: "show interfaces <iface>", summary: "One interface in the candidate", args: { iface: ifArg }, run: ({ iface }) => ({ output: vlJunosSwText(sw, cand, ["interfaces", iface]) }) },
      { id: "show", syntax: "show vlans", summary: "Candidate VLAN definitions", run: () => ({ output: vlJunosSwText(sw, cand, ["vlans"]) }) },
      ...junosEditCommon(api, sw, dirty, () => junosSwCheck(cand), () => setSw(api, sw, cand, "Junos commit", true), () => set(vlClone(active)), op, (json) => set(JSON.parse(json) as VlSwCfg)),
    ],
  };
}

// ---------------------------------------------------------------------------------------------------------------
// R1 — router on a stick
// ---------------------------------------------------------------------------------------------------------------
function r1Shows(s: VlState): { brief: string; route: string; arp: string } {
  const r = s.cfg.r1;
  const linkUp = vlPortUp(s.cfg, "SW2", RTR_PORT);
  const st = (sub?: VlSub) => (r.shut ? "administratively down" : sub?.shut ? "administratively down" : linkUp ? "up" : "down");
  const brief = columns([["Interface", "IP-Address", "OK?", "Method", "Status", "Protocol"], ["GigabitEthernet0/0", "unassigned", "YES", "unset", st(), linkUp && !r.shut ? "up" : "down"], ...r.subs.map((x) => [`GigabitEthernet0/0.${x.unit}`, x.ip, "YES", "manual", st(x), linkUp && !r.shut && !x.shut ? "up" : "down"])], [23, 16, 4, 7, 22]);
  const up = r.subs.filter((x) => !x.shut && !r.shut && linkUp);
  const route = ["Codes: L - local, C - connected", "", "Gateway of last resort is not set", "", ...up.flatMap((x) => [`C        ${netOf(x.ip, x.prefix)}/${x.prefix} is directly connected, GigabitEthernet0/0.${x.unit}`, `L        ${x.ip}/32 is directly connected, GigabitEthernet0/0.${x.unit}`])].join("\n");
  const arpRows = Object.entries(s.arp.R1);
  const arp = columns([["Protocol", "Address", "Age (min)", "Hardware Addr", "Type", "Interface"], ...r.subs.map((x) => ["Internet", x.ip, "-", ciscoMac(VL_MAC.R1), "ARPA", `GigabitEthernet0/0.${x.unit}`]), ...arpRows.map(([ip, mac]) => { const sub = r.subs.find((x) => netOf(x.ip, x.prefix) === netOf(ip, x.prefix)); return ["Internet", ip, "1", ciscoMac(mac), "ARPA", sub ? `GigabitEthernet0/0.${sub.unit}` : "?"]; })], [10, 17, 11, 16, 6]);
  return { brief, route, arp };
}
function r1PingText(s: VlState, ip: string, cisco: boolean): CliResult {
  const r = s.last?.results[0];
  const ok = !!r?.replied;
  const owner = vlIpOwner(s.cfg, ip);
  if (cisco) return { output: ["Type escape sequence to abort.", `Sending 5, 100-byte ICMP Echos to ${ip}, timeout is 2 seconds:`, ok ? "!!!!!" : ".....", `Success rate is ${ok ? 100 : 0} percent (${ok ? 5 : 0}/5)${ok ? ", round-trip min/avg/max = 1/1/2 ms" : ""}`].join("\n"), explanation: ok ? `Replies from ${owner ?? ip}.` : r?.fail };
  return { output: [`PING ${ip} (${ip}): 56 data bytes`, ...(ok ? [0, 1, 2].map((i) => `64 bytes from ${ip}: icmp_seq=${i} ttl=64 time=1.${i}04 ms`) : []), "", `--- ${ip} ping statistics ---`, `3 packets transmitted, ${ok ? 3 : 0} packets received, ${ok ? 0 : 100}% packet loss`].join("\n"), explanation: ok ? undefined : r?.fail };
}
/** Gi0/0 or Gi0/0.<n> in any IOS abbreviation → "phys" or the unit number. `create` also accepts a new unit. */
function r1IfArg(units: number[], create: boolean): CliArgSpec {
  return {
    choices: ["GigabitEthernet0/0", ...units.map((u) => `GigabitEthernet0/0.${u}`), ...(create && !units.includes(30) ? ["GigabitEthernet0/0.30"] : [])],
    describe: (c) => (c.includes(".") ? `subinterface ${c.split(".")[1]}` : "the physical port"),
    resolve: (raw) => {
      const m = /^([a-z]+)0\/0(?:\.(\d{1,4}))?$/i.exec(raw);
      if (!m || !"gigabitethernet".startsWith(m[1].toLowerCase()) || m[1].length < 1) return undefined;
      if (!m[2]) return "phys";
      return create || units.includes(+m[2]) ? String(+m[2]) : undefined;
    },
  };
}
function iosR1Exec(api: VlCliApi): CliCommand[] {
  const s = api.view;
  const r = s.cfg.r1;
  const sh = r1Shows(s);
  const ifArg = { interface: r1IfArg(r.subs.map((x) => x.unit), false) };
  const ctr = s.counters.R1;
  return [
    { id: "brief", syntax: "show ip interface brief", summary: "Interfaces and subinterfaces: address and state", run: () => ({ output: sh.brief, explanation: "One physical port, one subinterface per VLAN. Each subinterface is that VLAN's gateway." }) },
    {
      id: "if",
      syntax: "show interfaces <interface>",
      summary: "One (sub)interface: encapsulation and counters",
      args: ifArg,
      run: ({ interface: id }) => {
        if (id === "phys") return { output: [`GigabitEthernet0/0 is ${r.shut ? "administratively down" : vlPortUp(s.cfg, "SW2", RTR_PORT) ? "up" : "down"}, line protocol is ${vlPortUp(s.cfg, "SW2", RTR_PORT) && !r.shut ? "up" : "down"}`, `  Hardware is ISR4331-3x1GE, address is ${ciscoMac(VL_MAC.R1)}`, `     ${ctr.inF} packets input, ${ctr.tagIn} 802.1Q-tagged`, `     ${ctr.drops} unknown-VLAN drops (no subinterface for that VID)`, `     ${ctr.outF} packets output, ${ctr.tagOut} 802.1Q-tagged`].join("\n"), explanation: "Frames tagged with a VID that no subinterface uses are dropped here and counted. (Simplified: real IOS has no line with this name; such frames show up in its input drop counters.)" };
        const x = r.subs.find((u) => String(u.unit) === id)!;
        return { output: [`GigabitEthernet0/0.${x.unit} is ${x.shut || r.shut ? "administratively down" : "up"}, line protocol is ${x.shut || r.shut || !vlPortUp(s.cfg, "SW2", RTR_PORT) ? "down" : "up"}`, `  Internet address is ${x.ip}/${x.prefix}`, `  Encapsulation 802.1Q Virtual LAN, Vlan ID  ${x.vid}.`].join("\n"), explanation: `This subinterface sends and receives only frames tagged VID ${x.vid}. It must match the VLAN whose gateway it is.` };
      },
    },
    { id: "vlans", syntax: "show vlans", summary: "Which VID each subinterface uses", run: () => ({ output: r.subs.map((x) => [`Virtual LAN ID:  ${x.vid} (IEEE 802.1Q Encapsulation)`, "", `   vLAN Trunk Interface:   GigabitEthernet0/0.${x.unit}`, "", "   Protocols Configured:   Address:", `          IP              ${x.ip}`].join("\n")).join("\n\n"), explanation: "On a router, “VLAN” means: which tag a subinterface accepts and adds." }) },
    { id: "route", syntax: "show ip route", summary: "Routing table (one connected subnet per subinterface)", run: () => ({ output: sh.route, explanation: "Each up subinterface contributes its subnet. R1 routes between VLANs by moving packets from one subinterface to another." }) },
    { id: "arp", syntax: "show ip arp", summary: "ARP table (per subinterface)", run: () => ({ output: sh.arp, explanation: "R1 learns each host's MAC on the subinterface (VLAN) it heard it in." }) },
    { id: "run", syntax: "show running-config", summary: "R1's configuration", run: () => ({ output: ["hostname R1", "!", "interface GigabitEthernet0/0", " no ip address", ...(r.shut ? [" shutdown"] : [" no shutdown"]), "!", ...r.subs.flatMap((x) => [`interface GigabitEthernet0/0.${x.unit}`, ` encapsulation dot1Q ${x.vid}`, ` ip address ${x.ip} ${prefixToMask(x.prefix)}`, ...(x.shut ? [" shutdown"] : []), "!"]), "end"].join("\n") }) },
    { id: "ping", syntax: "ping <ip>", summary: "Ping from R1 (out the subinterface of that subnet)", args: { ip: ipArg(s) }, run: ({ ip }) => r1PingText(api.act({ type: "traffic", sends: [{ from: "R1", to: ip, kind: "ping" }] }), ip, true) },
    { id: "clear-arp", syntax: "clear ip arp", summary: "Forget R1's learned ARP entries", run: () => (api.act({ type: "clear-arp", dev: "R1" }), { output: "" }) },
    { id: "hist", syntax: "show history", summary: "The commands you typed in this session", run: () => ({ output: [...(api.history ?? []), "show history"].map((x) => `  ${x}`).join("\n") }) },
  ];
}
function iosR1Set(api: VlCliApi): CliCommandSet {
  const s = api.view;
  const r = s.cfg.r1;
  const base = { vendor: "cisco" as const, deviceId: "R1", deviceName: "R1" };
  const mode = api.ios.R1 as VlR1Mode;
  const exec = iosR1Exec(api);
  const end: CliCommand = { id: "end", syntax: "end", summary: "Leave configuration mode", run: () => (api.setIos("R1", { kind: "exec" }), { output: "%SYS-5-CONFIG_I: Configured from console by console" }) };
  if (mode.kind === "exec") return { ...base, prompt: "R1#", commands: [...exec, { id: "conf", syntax: "configure terminal", summary: "Enter configuration mode", run: () => (api.setIos("R1", { kind: "config" }), { output: "Enter configuration commands, one per line.  End with CNTL/Z." }) }] };
  const unitArg = r1IfArg(r.subs.map((x) => x.unit), true);
  const setR1 = (n: VlCfg["r1"], text: string) => { const cfg = vlClone(s.cfg); cfg.r1 = n; setCfg(api, cfg, `R1: ${text}`); };
  if (mode.kind === "config")
    return { ...base, prompt: "R1(config)#", commands: [{ id: "if", syntax: "interface <interface>", summary: "Configure the port or a subinterface (Gi0/0.<n> creates one)", args: { interface: unitArg }, run: ({ interface: u }) => { if (u === "phys") return (api.setIos("R1", { kind: "if" }), { output: "" }); const unit = +u; if (!r.subs.some((x) => x.unit === unit)) setR1({ ...r, subs: [...r.subs, { unit, vid: 0, ip: "", prefix: 24, shut: false }] }, `interface GigabitEthernet0/0.${unit}`); return (api.setIos("R1", { kind: "if", unit }), { output: "", explanation: r.subs.some((x) => x.unit === unit) ? undefined : "A new subinterface: give it an 802.1Q VLAN ID (encapsulation dot1Q <vid>) and an address." }); } }, { id: "noif", syntax: "no interface <interface>", summary: "Delete a subinterface", args: { interface: unitArg }, run: ({ interface: u }) => (u === "phys" ? refuse("% Physical interfaces cannot be removed") : (setR1({ ...r, subs: r.subs.filter((x) => x.unit !== +u) }, `no interface GigabitEthernet0/0.${u}`), { output: "" })) }, { id: "exit", syntax: "exit", summary: "Back to privileged mode", run: () => (api.setIos("R1", { kind: "exec" }), { output: "" }) }, end, ...prefixed(exec, "do")] };
  const u = mode.unit;
  const x = r.subs.find((y) => y.unit === u);
  const patch = (p: Partial<VlSub>, line: string) => setR1({ ...r, subs: r.subs.map((y) => (y.unit === u ? { ...y, ...p } : y)) }, `interface GigabitEthernet0/0.${u} · ${line}`);
  const subCmds: CliCommand[] = u === undefined ? [] : [
    { id: "encap", syntax: "encapsulation dot1q <vid>", summary: "Which VLAN this subinterface is (the tag it accepts and adds)", args: { vid: vlanIdArg("802.1Q VLAN ID") }, run: ({ vid }) => { const clash = r.subs.find((y) => y.vid === +vid && y.unit !== u); return clash ? refuse(`% Configuration of multiple subinterfaces of the same main interface with the same VID (${vid}) is not permitted. This VID is already configured on GigabitEthernet0/0.${clash.unit}.`) : (patch({ vid: +vid }, `encapsulation dot1Q ${vid}`), { output: "", explanation: `Gi0/0.${u} now takes frames tagged VID ${vid} — and tags what it sends with ${vid}. The subinterface NUMBER (.${u}) is just a name; the VID is what matters.` }); } },
    { id: "ip", syntax: "ip address <ip> <mask>", summary: "This VLAN's gateway address", args: { ip: { choices: [x?.ip || "192.168.30.1"], resolve: (raw) => (isIp(raw) ? raw : undefined) }, mask: { choices: ["255.255.255.0"], resolve: (raw) => (/^255\.255\.255\.(0|128|192|224|240|248|252)$/.test(raw) ? raw : undefined) } }, run: ({ ip, mask }) => (x?.vid ? (patch({ ip, prefix: [24, 25, 26, 27, 28, 29, 30][["0", "128", "192", "224", "240", "248", "252"].indexOf(mask.split(".")[3])] }, `ip address ${ip} ${mask}`), { output: "", explanation: `Hosts in VLAN ${x.vid} use ${ip} as their default gateway.` }) : refuse("% Configure encapsulation on the subinterface first")) },
    { id: "shut", syntax: "shutdown", summary: "Disable this subinterface", run: () => (patch({ shut: true }, "shutdown"), { output: "" }) },
    { id: "noshut", syntax: "no shutdown", summary: "Enable this subinterface", run: () => (patch({ shut: false }, "no shutdown"), { output: "" }) },
  ];
  const physCmds: CliCommand[] = u !== undefined ? [] : [
    { id: "shut", syntax: "shutdown", summary: "Disable the physical port (every subinterface goes down)", run: () => (setR1({ ...r, shut: true }, "interface GigabitEthernet0/0 · shutdown"), { output: "" }) },
    { id: "noshut", syntax: "no shutdown", summary: "Enable the physical port", run: () => (setR1({ ...r, shut: false }, "interface GigabitEthernet0/0 · no shutdown"), { output: "" }) },
  ];
  return { ...base, prompt: u === undefined ? "R1(config-if)#" : "R1(config-subif)#", commands: [...subCmds, ...physCmds, { id: "exit", syntax: "exit", summary: "Back to global configuration", run: () => (api.setIos("R1", { kind: "config" }), { output: "" }) }, end, ...prefixed(exec, "do")] };
}
function junosR1Tree(r: VlCfg["r1"]): JNode[] {
  return [
    { name: "system", kids: [{ name: "host-name R1" }] },
    { name: "interfaces", kids: [{ name: "ge-0/0/0", kids: [...(r.shut ? [{ name: "disable" }] : []), { name: "vlan-tagging" }, ...r.subs.map((x) => ({ name: `unit ${x.unit}`, kids: [...(x.shut ? [{ name: "disable" }] : []), { name: `vlan-id ${x.vid}` }, ...(x.ip ? [{ name: "family inet", kids: [{ name: `address ${x.ip}/${x.prefix}` }] }] : [])] }))] }] },
  ];
}
export const vlJunosR1Text = (r: VlCfg["r1"], path: string[] = []) => walk(junosR1Tree(r), path);
function junosR1Op(api: VlCliApi): CliCommand[] {
  const s = api.view;
  const r = s.cfg.r1;
  const up = vlPortUp(s.cfg, "SW2", RTR_PORT) && !r.shut;
  const unitArg: CliArgSpec = { choices: ["ge-0/0/0", ...r.subs.map((x) => `ge-0/0/0.${x.unit}`)], resolve: (raw) => (raw === "ge-0/0/0" ? "phys" : /^ge-0\/0\/0\.(\d+)$/.test(raw) && r.subs.some((x) => `ge-0/0/0.${x.unit}` === raw) ? raw.split(".")[1] : undefined) };
  return [
    { id: "terse", syntax: "show interfaces terse", summary: "Units and addresses", run: () => ({ output: columns([["Interface", "Admin", "Link", "Proto", "Local"], ["ge-0/0/0", r.shut ? "down" : "up", up ? "up" : "down", "", ""], ...r.subs.map((x) => [`ge-0/0/0.${x.unit}`, x.shut ? "down" : "up", up && !x.shut ? "up" : "down", x.ip ? "inet" : "", x.ip ? `${x.ip}/${x.prefix}` : ""])], [16, 6, 6, 6]), explanation: "One unit per VLAN; each unit's address is that VLAN's gateway." }) },
    { id: "if", syntax: "show interfaces <unit>", summary: "One unit: its VLAN tag and address", args: { unit: unitArg }, run: ({ unit }) => { if (unit === "phys") return { output: [`Physical interface: ge-0/0/0, ${r.shut ? "Administratively down" : "Enabled"}, Physical link is ${up ? "Up" : "Down"}`, "  Link-level type: Ethernet, VLAN-tagging", `  Input packets: ${s.counters.R1.inF} (tagged ${s.counters.R1.tagIn}) · Drops (unknown VLAN): ${s.counters.R1.drops}`].join("\n") }; const x = r.subs.find((u) => String(u.unit) === unit)!; return { output: [`  Logical interface ge-0/0/0.${x.unit} (Index ${330 + x.unit}) (SNMP ifIndex ${520 + x.unit})`, `    Flags: ${x.shut ? "Down" : "Up"} SNMP-Traps 0x4000 VLAN-Tag [ 0x8100.${x.vid} ]  Encapsulation: ENET2`, `    Protocol inet, MTU: 1500`, `      Addresses, Flags: Is-Preferred Is-Primary`, `        Destination: ${netOf(x.ip, x.prefix)}/${x.prefix}, Local: ${x.ip}`].join("\n"), explanation: `VLAN-Tag [0x8100.${x.vid}]: this unit accepts and adds VID ${x.vid}.` }; } },
    { id: "route", syntax: "show route", summary: "Routing table", run: () => ({ output: [`inet.0: ${r.subs.filter((x) => !x.shut && up).length * 2} destinations`, "+ = Active Route", "", ...r.subs.filter((x) => !x.shut && up).flatMap((x) => [`${`${netOf(x.ip, x.prefix)}/${x.prefix}`.padEnd(19)}*[Direct/0] 1w0d`, `                    >  via ge-0/0/0.${x.unit}`, `${`${x.ip}/32`.padEnd(19)}*[Local/0] 1w0d`, `                       Local via ge-0/0/0.${x.unit}`])].join("\n") }) },
    { id: "arp", syntax: "show arp", summary: "ARP table", run: () => ({ output: columns([["MAC Address", "Address", "Name", "Interface", "Flags"], ...Object.entries(s.arp.R1).map(([ip, mac]) => { const sub = r.subs.find((x) => netOf(x.ip, x.prefix) === netOf(ip, x.prefix)); return [mac.toLowerCase(), ip, ip, sub ? `ge-0/0/0.${sub.unit}` : "?", "none"]; })], [19, 16, 16, 14]) }) },
    { id: "cfg", syntax: "show configuration", summary: "R1's committed configuration", run: () => ({ output: vlJunosR1Text(r) }) },
    { id: "cfg", syntax: "show configuration interfaces", summary: "Interfaces and units", run: () => ({ output: vlJunosR1Text(r, ["interfaces"]) }) },
    { id: "ping", syntax: "ping <ip>", summary: "Ping from R1", args: { ip: ipArg(s) }, run: ({ ip }) => r1PingText(api.act({ type: "traffic", sends: [{ from: "R1", to: ip, kind: "ping" }] }), ip, false) },
    { id: "clear-arp", syntax: "clear arp", summary: "Forget R1's ARP entries", run: () => (api.act({ type: "clear-arp", dev: "R1" }), { output: "" }) },
    { id: "hist", syntax: "show cli history", summary: "The commands you typed in this session", run: () => ({ output: [...(api.history ?? []), "show cli history"].map((x, n) => `${String(n + 1).padStart(4)}  ${x}`).join("\n") }) },
  ];
}
export function junosR1Check(r: VlCfg["r1"]): string | undefined {
  const vids = r.subs.map((x) => x.vid);
  const dup = vids.find((v, i) => vids.indexOf(v) !== i);
  if (dup !== undefined) return `[edit interfaces ge-0/0/0]\n  duplicate VLAN-ID ${dup} on two units`;
  const novid = r.subs.find((x) => !x.vid);
  if (novid) return `[edit interfaces ge-0/0/0 unit ${novid.unit}]\n  'vlan-id' is required with vlan-tagging`;
  return undefined;
}
function junosR1Set(api: VlCliApi): CliCommandSet {
  const s = api.view;
  const base = { vendor: "juniper" as const, deviceId: "R1", deviceName: "R1" };
  const op = junosR1Op(api);
  const active = s.cfg.r1;
  const cand = api.cand.r1;
  const dirty = !sameR1(cand, active);
  const configure: CliCommand = { id: "conf", syntax: "configure", summary: "Enter configuration mode", run: () => (!dirty && api.setCand({ ...api.cand, r1: vlClone(active) }), api.setJunosEdit("R1", true), { output: dirty ? "Entering configuration mode\nThe configuration has been changed but not committed\n" : "Entering configuration mode\n" }) };
  if (!api.junosEdit.R1) return { ...base, prompt: "admin@R1> ", commands: [...op, configure] };
  const set = (r: VlCfg["r1"]) => api.setCand({ ...api.cand, r1: r });
  const unitNum: CliArgSpec = { choices: [...cand.subs.map((x) => String(x.unit)), "30"], describe: () => "unit number", resolve: (raw) => (/^\d{1,4}$/.test(raw) ? String(+raw) : undefined) };
  const sub = (u: number) => cand.subs.find((x) => x.unit === u);
  const upsert = (u: number, p: Partial<VlSub>) => set({ ...cand, subs: sub(u) ? cand.subs.map((x) => (x.unit === u ? { ...x, ...p } : x)) : [...cand.subs, { unit: u, vid: 0, ip: "", prefix: 24, shut: false, ...p }] });
  return {
    ...base,
    prompt: "admin@R1# ",
    commands: [
      { id: "vid", syntax: "set interfaces ge-0/0/0 unit <unit> vlan-id <vid>", summary: "Which VLAN this unit is (its 802.1Q tag)", args: { unit: unitNum, vid: vlanIdArg("802.1Q VLAN ID") }, run: ({ unit, vid }) => (upsert(+unit, { vid: +vid }), { output: "" }) },
      { id: "addr", syntax: "set interfaces ge-0/0/0 unit <unit> family inet address <cidr>", summary: "This VLAN's gateway address", args: { unit: unitNum, cidr: { choices: ["192.168.30.1/24"], resolve: (raw) => (/^(\d{1,3}\.){3}\d{1,3}\/(2[4-9]|30)$/.test(raw) && isIp(raw.split("/")[0]) ? raw : undefined) } }, run: ({ unit, cidr }) => (upsert(+unit, { ip: cidr.split("/")[0], prefix: +cidr.split("/")[1] }), { output: "" }) },
      { id: "delunit", syntax: "delete interfaces ge-0/0/0 unit <unit>", summary: "Remove a unit", args: { unit: unitNum }, run: ({ unit }) => (sub(+unit) ? (set({ ...cand, subs: cand.subs.filter((x) => x.unit !== +unit) }), { output: "" }) : refuse("warning: statement not found")) },
      { id: "vtag", syntax: "set interfaces ge-0/0/0 vlan-tagging", summary: "Accept 802.1Q-tagged frames on the port (needed for VLAN units)", run: () => ({ output: "", explanation: "Already configured: ge-0/0/0 has vlan-tagging, so each unit can take its own vlan-id." }) },
      { id: "dis", syntax: "set interfaces ge-0/0/0 disable", summary: "Disable the physical port", run: () => (set({ ...cand, shut: true }), { output: "" }) },
      { id: "dis", syntax: "delete interfaces ge-0/0/0 disable", summary: "Enable the physical port", run: () => (cand.shut ? (set({ ...cand, shut: false }), { output: "" }) : refuse("warning: statement not found")) },
      { id: "show", syntax: "show", summary: "The candidate configuration (try show | compare)", run: () => ({ output: vlJunosR1Text(cand) }) },
      { id: "show", syntax: "show interfaces", summary: "Candidate interfaces", run: () => ({ output: vlJunosR1Text(cand, ["interfaces"]) }) },
      ...junosEditCommon(api, "R1", dirty, () => junosR1Check(cand), () => { const cfg = vlClone(s.cfg); cfg.r1 = vlClone(cand); setCfg(api, cfg, "R1: Junos commit", "R1"); }, () => set(vlClone(active)), op, (json) => set(JSON.parse(json) as VlCfg["r1"])),
    ],
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Hosts — a Linux shell
// ---------------------------------------------------------------------------------------------------------------
function hostSet(api: VlCliApi, h: VlHost): CliCommandSet {
  const s = api.view;
  const c = s.cfg.hosts[h];
  const name = h.toLowerCase();
  const setHost = (patch: Partial<typeof c>, text: string) => { const cfg = vlClone(s.cfg); cfg.hosts[h] = { ...cfg.hosts[h], ...patch }; setCfg(api, cfg, `${h}: ${text}`); };
  const ping = (ip: string, n: number): CliResult => {
    const ns = api.act({ type: "traffic", sends: [{ from: h, to: ip, kind: "ping" }] });
    const r = ns.last!.results[0];
    const rx = ns.last!.waves.flatMap((w) => w.rx).find((x) => x.dev === h && x.frame.kind === "echo-rep");
    const ttl = rx?.frame.ttl ?? 64;
    if (r.replied) return { output: [`PING ${ip} (${ip}) 56(84) bytes of data.`, ...Array.from({ length: n }, (_, i) => `64 bytes from ${ip}: icmp_seq=${i + 1} ttl=${ttl} time=0.${4 + i} ms`), "", `--- ${ip} ping statistics ---`, `${n} packets transmitted, ${n} received, 0% packet loss`].join("\n"), explanation: ttl < 64 ? `TTL ${ttl}: the reply crossed ${64 - ttl} router hop${64 - ttl > 1 ? "s" : ""} — R1 routed it between VLANs.` : "TTL 64: same subnet, same VLAN — no router involved." };
    const arpFail = /never got an answer to its ARP/.test(r.fail ?? "") && r.fail?.startsWith(h);
    return { output: [`PING ${ip} (${ip}) 56(84) bytes of data.`, ...(arpFail ? Array.from({ length: Math.min(n, 3) }, (_, i) => `From ${c.ip} icmp_seq=${i + 1} Destination Host Unreachable`) : []), "", `--- ${ip} ping statistics ---`, `${n} packets transmitted, 0 received${arpFail ? `, +${Math.min(n, 3)} errors` : ""}, 100% packet loss`].join("\n"), explanation: r.fail };
  };
  const cidrArg: CliArgSpec = { choices: [`${c.ip || "192.168.10.20"}/24`], describe: () => "address/prefix", resolve: (raw) => (/^(\d{1,3}\.){3}\d{1,3}\/(1[6-9]|2\d|30)$/.test(raw) && isIp(raw.split("/")[0]) ? raw : undefined) };
  const ipA = ipArg(s);
  const cmds: CliCommand[] = [
    { id: "addr", syntax: "ip addr", summary: "This host's address", run: () => ({ output: ["1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536", "    inet 127.0.0.1/8 scope host lo", `2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 state ${vlHostLinkUpSafe(s, h) ? "UP" : "DOWN"}`, `    link/ether ${c.mac.toLowerCase()} brd ff:ff:ff:ff:ff:ff`, ...(c.ip ? [`    inet ${c.ip}/${c.prefix} scope global eth0`] : [])].join("\n"), explanation: "No VLAN anywhere: the host sends ordinary untagged frames. Its VLAN is decided by the switch port it is plugged into." }) },
    { id: "addr", syntax: "ip a", summary: "", hidden: true, run: () => ({ output: c.ip ? `2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP>\n    inet ${c.ip}/${c.prefix} scope global eth0` : "2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP>" }) },
    { id: "route", syntax: "ip route", summary: "This host's routes", run: () => ({ output: c.ip ? [...(c.gw ? [`default via ${c.gw} dev eth0`] : []), `${netOf(c.ip, c.prefix)}/${c.prefix} dev eth0 proto kernel scope link src ${c.ip}`].join("\n") : "", explanation: c.ip ? "On-subnet destinations go straight out; everything else to the default gateway — R1's address in this VLAN." : "No address, no routes." }) },
    { id: "neigh", syntax: "ip neigh", summary: "ARP cache", run: () => ({ output: Object.entries(s.arp[h]).map(([ip, mac]) => `${ip} dev eth0 lladdr ${mac.toLowerCase()} REACHABLE`).join("\n"), explanation: Object.keys(s.arp[h]).length ? "Every entry was learned from a frame in this host's own VLAN — ARP is a broadcast, and broadcasts stay in their VLAN." : "Empty: this host hasn't resolved anyone yet." }) },
    { id: "ping", syntax: "ping <ip>", summary: "Ping (4 echo requests)", args: { ip: ipA }, run: ({ ip }) => ping(ip, 4) },
    { id: "ping", syntax: "ping -c <count> <ip>", summary: "Ping <count> times", args: { count: { choices: ["1", "3"], resolve: (raw) => (/^\d+$/.test(raw) && +raw >= 1 && +raw <= 10 ? raw : undefined) }, ip: ipA }, run: ({ count, ip }) => ping(ip, +count) },
    { id: "flush", syntax: "sudo ip addr flush dev eth0", summary: "Remove eth0's address", run: () => (setHost({ ip: "", gw: "" }, "ip addr flush dev eth0"), { output: "", explanation: "No address and no default route now." }) },
    { id: "add", syntax: "sudo ip addr add <cidr> dev eth0", summary: "Give eth0 an address", args: { cidr: cidrArg }, run: ({ cidr }) => (c.ip ? refuse("RTNETLINK answers: File exists", `${name} already has ${c.ip}/${c.prefix}: flush it first (sudo ip addr flush dev eth0).`) : (setHost({ ip: cidr.split("/")[0], prefix: +cidr.split("/")[1] }, `ip addr add ${cidr} dev eth0`), { output: "", explanation: `Its subnet is now ${netOf(cidr.split("/")[0], +cidr.split("/")[1])}/${cidr.split("/")[1]} — it must match the VLAN its switch port is in.` })) },
    { id: "gw", syntax: "sudo ip route add default via <ip>", summary: "Set the default gateway", args: { ip: ipA }, run: ({ ip }) => (!c.ip ? refuse("Error: Nexthop has invalid gateway.") : c.gw ? refuse("RTNETLINK answers: File exists", "There is already a default route: sudo ip route del default first.") : (setHost({ gw: ip }, `ip route add default via ${ip}`), { output: "" })) },
    { id: "delgw", syntax: "sudo ip route del default", summary: "Remove the default route", run: () => (c.gw ? (setHost({ gw: "" }, "ip route del default"), { output: "" }) : refuse("RTNETLINK answers: No such process")) },
    { id: "neighflush", syntax: "sudo ip neigh flush all", summary: "Empty the ARP cache", run: () => (api.act({ type: "clear-arp", dev: h }), { output: "" }) },
  ];
  return withShellHistory(withSelfPing({ vendor: "cisco", deviceId: h, deviceName: name, prompt: `admin@${name}:~$ `, commands: cmds }, "linux", [c.ip]), "linux", api.history);
}
const vlHostLinkUpSafe = (s: VlState, h: VlHost) => { const at = s.cfg.hosts[h].at; return !!at && vlPortUp(s.cfg, at.sw, at.port); };

// ---------------------------------------------------------------------------------------------------------------
export function vlSwitchSets(api: VlCliApi, sw: VlSw): Partial<Record<CliVendor, CliCommandSet>> {
  return { cisco: iosSwSet(api, sw), juniper: junosSwSet(api, sw) };
}
export function vlR1Sets(api: VlCliApi): Partial<Record<CliVendor, CliCommandSet>> {
  const own = api.view.cfg.r1.subs.filter((x) => !x.shut).map((x) => x.ip);
  return { cisco: withSelfPing(iosR1Set(api), "ios", own), juniper: withSelfPing(junosR1Set(api), "junos", own) };
}
export const vlHostSet = hostSet;
/** For Junos `show | compare`. */
export const vlJunosConfig = (api: Pick<VlCliApi, "view">, dev: VlSw | "R1") => (which: "committed" | number, path: string[]) => (which === "committed" || which === 0 ? (dev === "R1" ? vlJunosR1Text(api.view.cfg.r1, path) : vlJunosSwText(dev, api.view.cfg.sw[dev], path)) : undefined);
export type { VlSub };
