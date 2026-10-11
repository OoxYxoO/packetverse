import type { CliArgSpec, CliCommand, CliCommandSet, CliResult, CliVendor } from "@/lib/cli/types";
import { ciscoMac, columns, interfaceArg } from "@/lib/cli/format";
import type { CliQuestion } from "@/app/demo/dhcp-dns/dhcp-lab/dhcpBuildCli";
import { withSelfPing } from "@/lib/cli/selfPing";
import { withShellHistory } from "@/lib/cli/shellHistory";
import { BRIDGE_MAC, DEFAULT_COST, FWD_DELAY, HOST_IP, HOST_MAC, MAX_AGE, ST_HOSTS, ST_PORTS, ST_SWITCHES, bidName, bidOf, pk, portIdText, stClone, stPeer, stPortState, stPortStatus, stTable, type StAction, type StHost, type StPort, type StPortCfg, type StProto, type StState, type StSw, type StSwCfg } from "@/lib/sim-engine/scenarios/stpNet";
import { CISCO_IF, CISCO_SHORT } from "./stNames";

/**
 * Command lines of the STP Lab — Cisco IOS (Rapid PVST+, VLAN 1) or Junos (EX, RSTP) on SW1–SW3, a Linux shell on the
 * hosts. Every output is printed from the lab state (the computed tree, the port timers, the tables, the counters, the
 * log); every change goes through a lab action (IOS on Enter; Junos on commit).
 *
 *   IOS    show spanning-tree [detail | root | summary | blockedports | interface <if> [detail]] · show interfaces
 *          status | <if> · show mac address-table · show cdp neighbors · show logging · show running-config ·
 *          configure terminal → spanning-tree mode rapid-pvst | pvst · spanning-tree vlan 1 priority <n> | root primary
 *          · no spanning-tree vlan 1 · interface <if> → spanning-tree cost <n> · spanning-tree portfast ·
 *          spanning-tree bpduguard enable · spanning-tree guard root · spanning-tree bpdufilter enable · shutdown
 *   Junos  show spanning-tree bridge | interface · show ethernet-switching table · show interfaces terse | <if> ·
 *          show lldp neighbors · show log messages · show configuration protocols … · clear error bpdu interface ·
 *          configure → set protocols rstp bridge-priority <n> · set protocols rstp interface <if> cost | edge |
 *          no-root-port | disable · set protocols layer2-control bpdu-block interface <if> · set/delete protocols stp ·
 *          set interfaces <if> disable → commit (check, and-quit) · rollback
 */

export type StIosMode = { kind: "exec" } | { kind: "config" } | { kind: "if"; port: StPort };
/** Junos candidate: the switch's configuration, plus which spanning-tree stanzas are present. */
export interface StCandSw extends StSwCfg {
  stz: { rstp: boolean; stp: boolean };
}
export type StCand = Record<StSw, StCandSw>;
export const candOfSw = (c: StSwCfg): StCandSw => ({ ...stClone(c), stz: { rstp: c.proto === "rstp", stp: c.proto === "stp" } });
export const protoOf = (c: StCandSw): StProto => (c.stz.rstp ? "rstp" : c.stz.stp ? "stp" : "none");
export interface StCliApi {
  view: StState;
  act: (a: StAction) => StState;
  ios: Record<StSw, StIosMode>;
  setIos: (d: StSw, m: StIosMode) => void;
  junosEdit: Record<StSw, boolean>;
  setJunosEdit: (d: StSw, b: boolean) => void;
  cand: StCand;
  setCand: (c: StCand) => void;
  ask?: (q: CliQuestion | undefined) => void;
  history?: string[];
}

const refuse = (output: string, explanation?: string): CliResult => ({ output, refused: true, explanation });
const prefixed = (cmds: CliCommand[], word: "do" | "run"): CliCommand[] => cmds.map((c) => ({ ...c, id: `${word}:${c.id}`, syntax: `${word} ${c.syntax}` }));
const stamp = (clock: number) => {
  const hh = String(Math.floor(clock / 3600) % 24).padStart(2, "0");
  const mm = String(Math.floor(clock / 60) % 60).padStart(2, "0");
  const ss = String(Math.floor(clock) % 60).padStart(2, "0");
  return { ios: `*Mar  1 ${hh}:${mm}:${ss}.000`, junos: `Mar  1 ${hh}:${mm}:${ss}` };
};
const ago = (secs: number) => {
  const s = Math.max(0, Math.floor(secs));
  return `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};
export const PORT_DESC: Record<StSw, Record<StPort, string>> = {
  SW1: { "ge-0/0/1": "to-SW2", "ge-0/0/2": "to-SW3", "ge-0/0/10": "HOST-A", "ge-0/0/11": "spare" },
  SW2: { "ge-0/0/1": "to-SW1", "ge-0/0/2": "to-SW3", "ge-0/0/10": "HOST-B", "ge-0/0/11": "spare" },
  SW3: { "ge-0/0/1": "to-SW1", "ge-0/0/2": "to-SW2", "ge-0/0/10": "HOST-C", "ge-0/0/11": "spare" },
};
const PRIOS = Array.from({ length: 16 }, (_, i) => i * 4096);
const prioArg: CliArgSpec = { choices: ["4096", "24576", "32768"], describe: () => "bridge priority (0–61440, multiple of 4096)", resolve: (raw) => (/^\d+$/.test(raw) && +raw <= 65535 ? raw : undefined) };
const costArg: CliArgSpec = { choices: ["20000", "200000"], describe: () => "port path cost (1–200000000)", resolve: (raw) => (/^\d+$/.test(raw) && +raw >= 1 && +raw <= 200000000 ? raw : undefined) };
const junosPrioArg: CliArgSpec = { choices: ["4k", "24k", "32k"], describe: () => "bridge priority: 0, 4k, 8k … 60k", resolve: (raw) => (/^(\d+)k?$/.test(raw) ? raw : undefined) };
const junosPrio = (raw: string): number | undefined => {
  const v = raw.endsWith("k") ? +raw.slice(0, -1) * 1024 : +raw;
  return PRIOS.includes(v) ? v : undefined;
};
const jPrio = (p: number) => (p === 0 ? "0" : `${p / 1024}k`);
const fmtBid = (p: number, mac: string) => `${p}.${mac.replace(/:/g, "").toLowerCase()}`;
const dotted = (mac: string) => ciscoMac(mac);

function setSw(api: StCliApi, sw: StSw, c: StSwCfg, text: string, junosCommit = false) {
  const cfg = stClone(api.view.cfg);
  cfg.sw[sw] = stClone(c);
  api.act({ type: "cfg", cfg, text: `${sw}: ${text}`, junosCommit: junosCommit ? sw : undefined });
}
const iosState = (s: StState, sw: StSw, p: string) => {
  const st = stPortState(s, sw, p);
  return st.state;
};

// ---------------------------------------------------------------------------------------------------------------
// Cisco IOS
// ---------------------------------------------------------------------------------------------------------------
function iosStpBlock(s: StState, sw: StSw, only?: StPort): string {
  const c = s.cfg.sw[sw];
  if (c.proto === "none") return "No spanning tree instance exists.";
  const b = s.tree.bridges[sw]!;
  const me = bidOf(s.cfg, sw);
  const root = bidOf(s.cfg, b.root);
  const isRoot = b.root === sw;
  const hdr = [
    "VLAN0001",
    `  Spanning tree enabled protocol ${c.proto === "rstp" ? "rstp" : "ieee"}`,
    `  Root ID    Priority    ${root.priority + (b.root === "ROGUE" ? 0 : 1)}`,
    `             Address     ${dotted(root.mac)}`,
    ...(isRoot ? ["             This bridge is the root"] : [`             Cost        ${b.cost}`, `             Port        ${b.rootPort!.split("/").pop()} (${CISCO_IF[b.rootPort as StPort]})`]),
    `             Hello Time   2 sec  Max Age ${MAX_AGE} sec  Forward Delay ${FWD_DELAY} sec`,
    "",
    `  Bridge ID  Priority    ${me.priority + 1}  (priority ${me.priority} sys-id-ext 1)`,
    `             Address     ${dotted(me.mac)}`,
    `             Hello Time   2 sec  Max Age ${MAX_AGE} sec  Forward Delay ${FWD_DELAY} sec`,
    "             Aging Time  300 sec",
    "",
  ];
  const rows = ST_PORTS.filter((p) => (!only || p === only) && s.tree.ports[pk(sw, p)]?.role !== "Disabled").map((p) => {
    const info = s.tree.ports[pk(sw, p)];
    const st = iosState(s, sw, p);
    const role = info.role === "Root" ? "Root" : info.role === "Alternate" ? "Altn" : "Desg";
    const sts = info.role === "Root-inc" ? "BKN" : st;
    const type = info.role === "Root-inc" ? "P2p *ROOT_Inc" : info.legacy && !info.edge ? "P2p" : info.edge ? "P2p Edge" : "P2p";
    return [CISCO_SHORT[p], role, sts, String(c.ports[p].cost), portIdText(p), type];
  });
  return [...hdr, columns([["Interface", "Role", "Sts", "Cost", "Prio.Nbr", "Type"], ["-------------------", "----", "---", "---------", "--------", "--------------------------------"], ...rows], [20, 5, 4, 10, 9])].join("\n");
}
function iosRunning(s: StState, sw: StSw): string {
  const c = s.cfg.sw[sw];
  const lines = [
    `hostname ${sw}`,
    "!",
    ...(c.proto === "none" ? ["no spanning-tree vlan 1"] : []),
    `spanning-tree mode ${c.proto === "stp" ? "pvst" : "rapid-pvst"}`,
    "spanning-tree pathcost method long",
    ...(c.priority !== 32768 ? [`spanning-tree vlan 1 priority ${c.priority}`] : []),
    "!",
    ...ST_PORTS.flatMap((p) => {
      const pc = c.ports[p];
      return [`interface ${CISCO_IF[p]}`, ` description ${PORT_DESC[sw][p]}`, " switchport mode access", ...(pc.cost !== DEFAULT_COST ? [` spanning-tree cost ${pc.cost}`] : []), ...(pc.edge ? [" spanning-tree portfast"] : []), ...(pc.bpduGuard ? [" spanning-tree bpduguard enable"] : []), ...(pc.rootGuard ? [" spanning-tree guard root"] : []), ...(pc.stpOff ? [" spanning-tree bpdufilter enable"] : []), ...(pc.shut ? [" shutdown"] : []), "!"];
    }),
    "end",
  ];
  return `Building configuration...\n\nCurrent configuration : ${lines.join("\n").length} bytes\n!\n${lines.join("\n")}`;
}
function iosLog(s: StState, sw: StSw): string[] {
  return s.syslog
    .filter((l) => l.sw === sw)
    .slice(-40)
    .flatMap((l) => {
      const t = stamp(l.clock).ios;
      const P = (p?: string) => CISCO_IF[(p ?? "ge-0/0/1") as StPort];
      const S = (p?: string) => CISCO_SHORT[(p ?? "ge-0/0/1") as StPort];
      switch (l.ev) {
        case "up":
          return [`${t}: %LINK-3-UPDOWN: Interface ${P(l.port)}, changed state to up`, `${t}: %LINEPROTO-5-UPDOWN: Line protocol on Interface ${P(l.port)}, changed state to up`];
        case "down":
          return [`${t}: %LINEPROTO-5-UPDOWN: Line protocol on Interface ${P(l.port)}, changed state to down`, `${t}: %LINK-3-UPDOWN: Interface ${P(l.port)}, changed state to down`];
        case "admin-down":
          return [`${t}: %LINK-5-CHANGED: Interface ${P(l.port)}, changed state to administratively down`];
        case "errdis":
          return [`${t}: %SPANTREE-2-BLOCK_BPDUGUARD: Received BPDU on port ${S(l.port)} with BPDU Guard enabled. Disabling port.`, `${t}: %PM-4-ERR_DISABLE: bpduguard error detected on ${S(l.port)}, putting ${S(l.port)} in err-disable state`];
        case "rootinc":
          return [`${t}: %SPANTREE-2-ROOTGUARD_BLOCK: Root guard blocking port ${P(l.port)} on VLAN0001.`];
        case "rootinc-clear":
          return [`${t}: %SPANTREE-2-ROOTGUARD_UNBLOCK: Root guard unblocking port ${P(l.port)} on VLAN0001.`];
        case "flap":
          return [`${t}: %SW_MATM-4-MACFLAP_NOTIF: Host ${dotted(l.mac!)} in vlan 1 is flapping between port ${S(l.ports![0])} and port ${S(l.ports![1])}`];
        default:
          return [];
      }
    });
}
function iosExec(api: StCliApi, sw: StSw): CliCommand[] {
  const s = api.view;
  const c = s.cfg.sw[sw];
  const ifArg = { interface: interfaceArg("cisco", CISCO_IF, PORT_DESC[sw]) };
  const b = s.tree.bridges[sw];
  const ctr = (p: StPort) => s.counters[pk(sw, p)];
  const mac = (rows: ReturnType<typeof stTable>) => ["          Mac Address Table", "-------------------------------------------", "", columns([["Vlan", "Mac Address", "Type", "Ports"], ["----", "-----------", "--------", "-----"], ...rows.map((e) => ["   1", dotted(e.mac), "DYNAMIC", CISCO_SHORT[e.port as StPort]])], [8, 18, 12]), `Total Mac Addresses for this criterion: ${rows.length}`].join("\n");
  return [
    { id: "stp", syntax: "show spanning-tree", summary: "The tree from this switch: root, this bridge, every port's role and state", run: () => ({ output: iosStpBlock(s, sw), explanation: c.proto === "none" ? "Spanning tree is disabled for VLAN 1 on this switch: every port forwards, whatever the topology." : "Root ID = the bridge every switch agreed is root (priority shown + sys-id-ext 1 = the VLAN). Role Root = best path to the root, Desg = forwards onto that segment, Altn = a backup path, BLK (Discarding)." }) },
    { id: "stp", syntax: "show spanning-tree vlan 1", summary: "", hidden: true, run: () => ({ output: iosStpBlock(s, sw) }) },
    {
      id: "stp-root",
      syntax: "show spanning-tree root",
      summary: "Which bridge is root, and this switch's cost and Root Port",
      run: () => {
        if (c.proto === "none") return { output: "No spanning tree instance exists." };
        const r = bidOf(s.cfg, b!.root);
        return { output: [columns([["", "", "Root", "Hello", "Max", "Fwd", ""], ["Vlan", "Root ID", "Cost", "Time", "Age", "Dly", "Root Port"], ["----------------", "--------------------", "---------", "-----", "---", "---", "------------"], ["VLAN0001", `${r.priority + (b!.root === "ROGUE" ? 0 : 1)} ${dotted(r.mac)}`, String(b!.cost), "2", String(MAX_AGE), String(FWD_DELAY), b!.rootPort ? CISCO_SHORT[b!.rootPort as StPort] : ""]], [17, 21, 10, 6, 4, 4])].join("\n"), explanation: b!.root === sw ? "This switch is the root: cost 0, no Root Port." : `The root is ${b!.root === "ROGUE" ? "a bridge that isn't one of ours (the small switch)" : b!.root}.` };
      },
    },
    {
      id: "stp-detail",
      syntax: "show spanning-tree detail",
      summary: "Bridge parameters and topology-change history",
      run: () => {
        if (c.proto === "none") return { output: "No spanning tree instance exists." };
        const me = bidOf(s.cfg, sw);
        return { output: [` VLAN0001 is executing the ${c.proto === "rstp" ? "rstp" : "ieee"} compatible Spanning Tree protocol`, `  Bridge Identifier has priority ${me.priority}, sysid 1, address ${dotted(me.mac)}`, `  Configured hello time 2, max age ${MAX_AGE}, forward delay ${FWD_DELAY}, transmit hold-count 6`, b!.root === sw ? "  We are the root of the spanning tree" : `  Current root has priority ${bidOf(s.cfg, b!.root).priority + (b!.root === "ROGUE" ? 0 : 1)}, address ${dotted(BRIDGE_MAC[b!.root])}`, ...(b!.root === sw ? [] : [`  Root port is ${b!.rootPort!.split("/").pop()} (${CISCO_IF[b!.rootPort as StPort]}), cost of root path is ${b!.cost}`]), `  Number of topology changes ${s.tcCount[sw]} last change occurred ${ago(s.clock - s.lastTc[sw])} ago`, `  Times:  hold 1, topology change 35, notification 2`, `          hello 2, max age ${MAX_AGE}, forward delay ${FWD_DELAY}`].join("\n"), explanation: "A climbing number of topology changes means ports keep going up and down (or a host port isn't portfast): each one flushes MAC tables." };
      },
    },
    { id: "stp-sum", syntax: "show spanning-tree summary", summary: "Mode, guards, and how many ports are in each state", run: () => { if (c.proto === "none") return { output: "No spanning tree instance exists." }; const st = ST_PORTS.map((p) => s.tree.ports[pk(sw, p)]).filter((x) => x.role !== "Disabled"); const n = (f: (x: (typeof st)[number]) => boolean) => st.filter(f).length; return { output: [`Switch is in ${c.proto === "rstp" ? "rapid-pvst" : "pvst"} mode`, `Root bridge for: ${b!.root === sw ? "VLAN0001" : "none"}`, "EtherChannel misconfig guard           is enabled", "Extended system ID                      is enabled", `Portfast Default                        is disabled`, `PortFast BPDU Guard Default             is disabled`, "Pathcost method used                    is long", "", columns([["Name", "Blocking", "Listening", "Learning", "Forwarding", "STP Active"], ["----------------------", "--------", "---------", "--------", "----------", "----------"], ["VLAN0001", String(n((x) => x.role === "Alternate" || x.role === "Root-inc")), "0", "0", String(n((x) => x.role !== "Alternate" && x.role !== "Root-inc")), String(st.length)]], [23, 9, 10, 9, 11])].join("\n") }; } },
    { id: "stp-blk", syntax: "show spanning-tree blockedports", summary: "Ports spanning tree is holding in Blocking", run: () => { const bl = ST_PORTS.filter((p) => ["Alternate", "Root-inc"].includes(s.tree.ports[pk(sw, p)]?.role)); return { output: ["", columns([["Name", "Blocked Interfaces List"], ["--------------------", "------------------------------------"], ...(bl.length ? [["VLAN0001", bl.map((p) => CISCO_SHORT[p]).join(", ")]] : [])], [21]), "", `Number of blocked ports (segments) in the system : ${bl.length}`].join("\n"), explanation: bl.length ? "These ports keep the triangle loop-free. They still receive BPDUs: that is how they know when to take over." : "Nothing blocked on THIS switch — the blocked port of the triangle may be on another switch (or, if none is blocked anywhere, there is a loop)." }; } },
    { id: "stp-if", syntax: "show spanning-tree interface <interface>", summary: "One port's role, state and cost", args: ifArg, run: ({ interface: p }) => (s.tree.ports[pk(sw, p)]?.role === "Disabled" || c.proto === "none" ? refuse("no spanning tree info available for " + CISCO_IF[p as StPort]) : { output: iosStpBlock(s, sw, p as StPort).split("\n").slice(-3).join("\n") }) },
    {
      id: "stp-if-d",
      syntax: "show spanning-tree interface <interface> detail",
      summary: "One port in detail: designated bridge, BPDUs sent / received, guards",
      args: ifArg,
      run: ({ interface: p }) => {
        const info = s.tree.ports[pk(sw, p)];
        if (!info || info.role === "Disabled" || c.proto === "none") return refuse("no spanning tree info available for " + CISCO_IF[p as StPort]);
        const pc = c.ports[p as StPort];
        const st = iosState(s, sw, p);
        const k = ctr(p as StPort);
        const des = info.desBridge ? bidOf(s.cfg, info.desBridge) : bidOf(s.cfg, sw);
        return { output: [` Port ${p.split("/").pop()} (${CISCO_IF[p as StPort]}) of VLAN0001 is ${info.role === "Root" ? "root" : info.role === "Alternate" ? "alternate" : info.role === "Root-inc" ? "broken (Root Inconsistent)" : "designated"} ${st === "FWD" ? "forwarding" : st === "LRN" ? "learning" : st === "LIS" ? "listening" : info.role === "Root-inc" ? "blocking" : "blocking"}`, `   Port path cost ${pc.cost}, Port priority 128, Port Identifier ${portIdText(p)}.`, `   Designated root has priority ${bidOf(s.cfg, s.tree.bridges[sw]!.root).priority}, address ${dotted(BRIDGE_MAC[s.tree.bridges[sw]!.root])}`, `   Designated bridge has priority ${des.priority}, address ${dotted(des.mac)}`, `   Designated port id is ${portIdText(info.desPort ?? p)}, designated path cost ${info.desCost ?? 0}`, ...(info.edge ? ["   The port is in the portfast edge mode"] : []), ...(pc.bpduGuard ? ["   Bpdu guard is enabled"] : []), ...(pc.rootGuard ? ["   Root guard is enabled on the port"] : []), ...(pc.stpOff ? ["   Bpdu filter is enabled"] : []), `   Link type is point-to-point by default`, `   BPDU: sent ${k.bpduOut}, received ${k.bpduIn}`].join("\n"), explanation: pc.stpOff ? "Bpdu filter: this port sends and processes NO BPDUs. Spanning tree can't block it — on a link to another switch that means a loop." : `BPDU counters show whether spanning tree is really talking on this link: Designated ports send, Root and Alternate ports receive.${k.bpduIn + k.bpduOut === 0 ? " (Simplified: the lab counts only the BPDUs it has simulated. Press “Send a Hello (BPDUs)” and look again. A real switch would already show thousands, one every 2 s.)" : ""}` };
      },
    },
    { id: "status", syntax: "show interfaces status", summary: "Link state of every port (err-disabled shows here)", run: () => ({ output: columns([["Port", "Name", "Status", "Vlan", "Duplex", "Speed", "Type"], ...ST_PORTS.map((p) => { const st = stPortStatus(s.cfg, s.errdis, sw, p); return [CISCO_SHORT[p], PORT_DESC[sw][p], st, "1", st === "connected" ? "a-full" : "auto", st === "connected" ? "a-1000" : "auto", "10/100/1000BaseTX"]; })], [10, 10, 13, 6, 8, 8]), explanation: "err-disabled = shut down by a protection feature (here: BPDU guard). It stays down until someone shuts and re-enables the port." }) },
    { id: "if", syntax: "show interfaces <interface>", summary: "One port: link and counters", args: ifArg, run: ({ interface: p }) => { const k = ctr(p as StPort); const st = stPortStatus(s.cfg, s.errdis, sw, p); return { output: [`${CISCO_IF[p as StPort]} is ${st === "disabled" ? "administratively down" : st === "connected" ? "up" : "down"}, line protocol is ${st === "connected" ? "up (connected)" : st === "err-disabled" ? "down (err-disabled)" : "down (notconnect)"}`, `  Description: ${PORT_DESC[sw][p as StPort]}`, `     ${k.inF.toLocaleString("en-US")} packets input, ${k.inB.toLocaleString("en-US")} broadcasts`, `     ${k.drops.toLocaleString("en-US")} input frames discarded (port not forwarding)`, `     ${k.outF.toLocaleString("en-US")} packets output, ${k.outB.toLocaleString("en-US")} broadcasts`].join("\n"), explanation: "Counters climbing with nobody sending = frames circulating in a loop." }; } },
    { id: "mac", syntax: "show mac address-table", summary: `${sw}'s MAC table`, run: () => ({ output: mac(stTable(s.fdb, sw)) }) },
    { id: "mac", syntax: "show mac address-table interface <interface>", summary: "MACs learned behind one port", args: ifArg, run: ({ interface: p }) => ({ output: mac(stTable(s.fdb, sw).filter((e) => e.port === p)) }) },
    { id: "cdp", syntax: "show cdp neighbors", summary: "Cisco neighbors on each link", run: () => { const nb = ST_PORTS.map((p) => ({ p, peer: stPeer(s.cfg, sw, p) })).filter((x) => x.peer && (ST_SWITCHES as string[]).includes(x.peer.dev) && stPortStatus(s.cfg, s.errdis, sw, x.p) === "connected"); return { output: ["Capability Codes: R - Router, T - Trans Bridge, B - Source Route Bridge", "                  S - Switch, H - Host, I - IGMP, r - Repeater", "", columns([["Device ID", "Local Intrfce", "Holdtme", "Capability", "Platform", "Port ID"], ...nb.map((x) => [x.peer!.dev, CISCO_SHORT[x.p], "152", "S I", "C9300", CISCO_SHORT[x.peer!.port as StPort]])], [12, 15, 9, 12, 10]), "", `Total cdp entries displayed : ${nb.length}`].join("\n"), explanation: "CDP only lists Cisco devices: the small switch on the spare port (if any) is not one." }; } },
    { id: "log", syntax: "show logging", summary: "The log: links, BPDU guard, root guard, MAC flaps", run: () => { const l = iosLog(s, sw); return { output: ["Syslog logging: enabled", "", "Log Buffer (8192 bytes):", ...(l.length ? l : ["(no messages)"])].join("\n") }; } },
    { id: "run", syntax: "show running-config", summary: `${sw}'s configuration`, run: () => ({ output: iosRunning(s, sw), explanation: "spanning-tree pathcost method long gives the 802.1D-2004 costs (1 Gb/s = 20000) — the same values Junos uses." }) },
    { id: "clear", syntax: "clear mac address-table dynamic", summary: "Forget every learned entry", run: () => (api.act({ type: "clear", sw }), { output: "" }) },
    { id: "clear-ctr", syntax: "clear counters", summary: "Reset the interface counters", run: () => (api.act({ type: "clear-counters", sw }), { output: "" }) },
    { id: "hist", syntax: "show history", summary: "The commands you typed in this session", run: () => ({ output: [...(api.history ?? []), "show history"].map((x) => `  ${x}`).join("\n") }) },
  ];
}
const PRIO_ERR = "% Bridge Priority must be in increments of 4096.\n% Allowed values are:\n  0     4096  8192  12288 16384 20480 24576 28672\n  32768 36864 40960 45056 49152 53248 57344 61440";
function iosSet(api: StCliApi, sw: StSw): CliCommandSet {
  const s = api.view;
  const c = s.cfg.sw[sw];
  const exec = iosExec(api, sw);
  const base = { vendor: "cisco" as const, deviceId: sw, deviceName: sw };
  const mode = api.ios[sw];
  const ifArg = { interface: interfaceArg("cisco", CISCO_IF, PORT_DESC[sw]) };
  const end: CliCommand = { id: "end", syntax: "end", summary: "Leave configuration mode", run: () => (api.setIos(sw, { kind: "exec" }), { output: "%SYS-5-CONFIG_I: Configured from console by console" }) };
  if (mode.kind === "exec") return { ...base, prompt: `${sw}#`, commands: [...exec, { id: "conf", syntax: "configure terminal", summary: "Enter configuration mode", run: () => (api.setIos(sw, { kind: "config" }), { output: "Enter configuration commands, one per line.  End with CNTL/Z." }) }] };
  const doCmds = prefixed(exec, "do");
  const glob = (patch: Partial<StSwCfg>, text: string) => setSw(api, sw, { ...c, ...patch }, text);
  if (mode.kind === "config")
    return {
      ...base,
      prompt: `${sw}(config)#`,
      commands: [
        { id: "mode", syntax: "spanning-tree mode rapid-pvst", summary: "Run Rapid PVST+ (RSTP per VLAN)", run: () => (glob({ proto: c.proto === "none" ? "none" : "rstp" }, "spanning-tree mode rapid-pvst"), { output: "", explanation: c.proto === "none" ? "Saved — but spanning tree is still disabled for VLAN 1 (no spanning-tree vlan 1)." : "RSTP: an Alternate port takes over at once, and Designated ports forward as soon as the RSTP neighbor agrees." }) },
        { id: "mode", syntax: "spanning-tree mode pvst", summary: "Run legacy PVST+ (802.1D per VLAN)", run: () => (glob({ proto: c.proto === "none" ? "none" : "stp" }, "spanning-tree mode pvst"), { output: "", explanation: `Legacy 802.1D: ports that start forwarding wait Listening ${FWD_DELAY} s + Learning ${FWD_DELAY} s.` }) },
        { id: "prio", syntax: "spanning-tree vlan 1 priority <priority>", summary: "This bridge's priority (lower wins root)", args: { priority: prioArg }, run: ({ priority }) => (PRIOS.includes(+priority) ? (glob({ priority: +priority }, `spanning-tree vlan 1 priority ${priority}`), { output: "", explanation: `Bridge ID is now ${+priority}+1 (sys-id-ext) / ${dotted(BRIDGE_MAC[sw])}. The lowest Bridge ID in the network becomes root.` }) : refuse(PRIO_ERR)) },
        {
          id: "prio",
          syntax: "spanning-tree vlan 1 root primary",
          summary: "Set a priority low enough to become root",
          run: () => {
            const r = s.tree.bridges[sw]?.root;
            const rp = r ? bidOf(s.cfg, r).priority : 32768;
            const want = r === sw ? c.priority : rp > 24576 ? 24576 : Math.max(0, rp - 4096);
            glob({ priority: want }, "spanning-tree vlan 1 root primary");
            return { output: "", explanation: `A macro, not a protocol feature: it set "spanning-tree vlan 1 priority ${want}" (look in show running-config), based on the current root's priority.` };
          },
        },
        { id: "prio", syntax: "no spanning-tree vlan 1 priority", summary: "Back to the default priority 32768", run: () => (glob({ priority: 32768 }, "no spanning-tree vlan 1 priority"), { output: "" }) },
        { id: "off", syntax: "no spanning-tree vlan 1", summary: "Disable spanning tree for VLAN 1 (dangerous)", run: () => (glob({ proto: "none" }, "no spanning-tree vlan 1"), { output: "", explanation: "Spanning tree no longer runs on this switch: it sends no BPDUs and blocks nothing. With redundant links that is a loop." }) },
        { id: "off", syntax: "spanning-tree vlan 1", summary: "Enable spanning tree for VLAN 1", run: () => (glob({ proto: c.proto === "none" ? "rstp" : c.proto }, "spanning-tree vlan 1"), { output: "" }) },
        { id: "if", syntax: "interface <interface>", summary: "Configure one port", args: ifArg, run: ({ interface: p }) => (api.setIos(sw, { kind: "if", port: p as StPort }), { output: "" }) },
        { id: "exit", syntax: "exit", summary: "Back to privileged mode", run: () => (api.setIos(sw, { kind: "exec" }), { output: "" }) },
        end,
        ...doCmds,
      ],
    };
  const p = mode.port;
  const pc = c.ports[p];
  const setPort = (patch: Partial<StPortCfg>, line: string) => setSw(api, sw, { ...c, ports: { ...c.ports, [p]: { ...pc, ...patch } } }, `interface ${CISCO_IF[p]} · ${line}`);
  const toSwitch = stPeer(s.cfg, sw, p) && (ST_SWITCHES as string[]).includes(stPeer(s.cfg, sw, p)!.dev);
  return {
    ...base,
    prompt: `${sw}(config-if)#`,
    commands: [
      { id: "cost", syntax: "spanning-tree cost <cost>", summary: "This port's path cost (counts when BPDUs ARRIVE on it)", args: { cost: costArg }, run: ({ cost }) => (setPort({ cost: +cost }, `spanning-tree cost ${cost}`), { output: "", explanation: "The cost is added to the root path cost of BPDUs received on this port. It changes which port THIS switch picks as Root Port — not what its neighbors pick." }) },
      { id: "cost", syntax: "no spanning-tree cost", summary: "Back to the default cost", run: () => (setPort({ cost: DEFAULT_COST }, "no spanning-tree cost"), { output: "" }) },
      { id: "edge", syntax: "spanning-tree portfast", summary: "Edge port: forward at once (host ports only)", run: () => (setPort({ edge: true }, "spanning-tree portfast"), { output: `%Warning: portfast should only be enabled on ports connected to a single\n host. Connecting hubs, concentrators, switches, bridges, etc... to this\n interface  when portfast is enabled, can cause temporary bridging loops.\n Use with CAUTION`, explanation: toSwitch ? "This port leads to a switch: as soon as it hears a BPDU it stops being an edge port anyway." : "The port now forwards as soon as its link comes up, and a link flap here no longer triggers a topology change." }) },
      { id: "edge", syntax: "no spanning-tree portfast", summary: "Not an edge port", run: () => (setPort({ edge: false }, "no spanning-tree portfast"), { output: "" }) },
      { id: "guard", syntax: "spanning-tree bpduguard enable", summary: "Err-disable this port if a BPDU arrives", run: () => (setPort({ bpduGuard: true }, "spanning-tree bpduguard enable"), { output: "", explanation: "Any BPDU on this port now shuts it down (err-disabled). Use it on host-facing ports: no switch may join the tree here." }) },
      { id: "guard", syntax: "no spanning-tree bpduguard", summary: "Remove BPDU guard", run: () => (setPort({ bpduGuard: false }, "no spanning-tree bpduguard"), { output: "" }) },
      { id: "rguard", syntax: "spanning-tree guard root", summary: "Never let this port become Root Port", run: () => (setPort({ rootGuard: true }, "spanning-tree guard root"), { output: "", explanation: "If a better root is offered on this port, the port is blocked (root-inconsistent) instead of moving the root. It recovers by itself when those BPDUs stop." }) },
      { id: "rguard", syntax: "no spanning-tree guard root", summary: "Remove root guard", run: () => (setPort({ rootGuard: false }, "no spanning-tree guard root"), { output: "" }) },
      { id: "filter", syntax: "spanning-tree bpdufilter enable", summary: "Stop sending and processing BPDUs (takes the port out of spanning tree)", run: () => (setPort({ stpOff: true }, "spanning-tree bpdufilter enable"), { output: "", explanation: toSwitch ? "DANGER: this port leads to another switch. Without BPDUs spanning tree can't block it — expect a loop." : "This port neither sends nor hears BPDUs any more." }) },
      { id: "filter", syntax: "no spanning-tree bpdufilter", summary: "Back under spanning-tree control", run: () => (setPort({ stpOff: false }, "no spanning-tree bpdufilter"), { output: "" }) },
      { id: "filter", syntax: "no spanning-tree bpdufilter enable", summary: "", hidden: true, run: () => (setPort({ stpOff: false }, "no spanning-tree bpdufilter"), { output: "" }) },
      { id: "filter", syntax: "spanning-tree bpdufilter disable", summary: "", hidden: true, run: () => (setPort({ stpOff: false }, "spanning-tree bpdufilter disable"), { output: "" }) },
      { id: "shut", syntax: "shutdown", summary: "Disable this port", run: () => (setPort({ shut: true }, "shutdown"), { output: `${stamp(s.clock).ios}: %LINK-5-CHANGED: Interface ${CISCO_IF[p]}, changed state to administratively down` }) },
      { id: "noshut", syntax: "no shutdown", summary: "Enable this port (also recovers err-disabled)", run: () => (pc.shut ? (setPort({ shut: false }, "no shutdown"), { output: "", explanation: s.errdis.includes(pk(sw, p)) ? undefined : "Enabled. If it was err-disabled and the cause is still there, it will be err-disabled again at once." }) : s.errdis.includes(pk(sw, p)) ? refuse("", "The port is err-disabled: shut it first, then no shutdown (that's how IOS recovers err-disabled ports by hand).") : { output: "" }) },
      { id: "if", syntax: "interface <interface>", summary: "Move to another port", args: ifArg, run: ({ interface: q }) => (api.setIos(sw, { kind: "if", port: q as StPort }), { output: "" }) },
      { id: "exit", syntax: "exit", summary: "Back to global configuration", run: () => (api.setIos(sw, { kind: "config" }), { output: "" }) },
      end,
      ...doCmds,
    ],
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Junos
// ---------------------------------------------------------------------------------------------------------------
interface JNode {
  name: string;
  kids?: JNode[];
}
function junosTree(sw: StSw, c: StCandSw): JNode[] {
  const stpIfs = ST_PORTS.filter((p) => c.ports[p].cost !== DEFAULT_COST || c.ports[p].edge || c.ports[p].rootGuard || c.ports[p].stpOff);
  const proto = (name: string): JNode => ({ name, kids: [{ name: `bridge-priority ${jPrio(c.priority)}` }, { name: "interface all" }, ...stpIfs.map((p) => ({ name: `interface ${p}`, kids: [...(c.ports[p].stpOff ? [{ name: "disable" }] : []), ...(c.ports[p].cost !== DEFAULT_COST ? [{ name: `cost ${c.ports[p].cost}` }] : []), ...(c.ports[p].edge ? [{ name: "edge" }] : []), ...(c.ports[p].rootGuard ? [{ name: "no-root-port" }] : [])] }))] });
  const guards = ST_PORTS.filter((p) => c.ports[p].bpduGuard);
  return [
    { name: "system", kids: [{ name: `host-name ${sw}` }] },
    { name: "interfaces", kids: ST_PORTS.map((p) => ({ name: p, kids: [...(c.ports[p].shut ? [{ name: "disable" }] : []), { name: `description ${PORT_DESC[sw][p]}` }, { name: "unit 0", kids: [{ name: "family ethernet-switching" }] }] })) },
    { name: "protocols", kids: [...(guards.length ? [{ name: "layer2-control", kids: [{ name: "bpdu-block", kids: guards.map((p) => ({ name: `interface ${p}` })) }] }] : []), ...(c.stz.rstp ? [proto("rstp")] : []), ...(c.stz.stp ? [proto("stp")] : [])] },
  ];
}
const render = (nodes: JNode[], d = 0): string[] => nodes.flatMap((n) => (n.kids ? [`${"    ".repeat(d)}${n.name} {`, ...render(n.kids, d + 1), `${"    ".repeat(d)}}`] : [`${"    ".repeat(d)}${n.name};`]));
function walk(nodes: JNode[], path: string[]): string {
  const want = [...path];
  while (want.length) {
    const two = want.length > 1 ? `${want[0]} ${want[1]}` : undefined;
    const hit = nodes.find((n) => n.name === two) ?? nodes.find((n) => n.name === want[0]);
    if (!hit?.kids) return "";
    want.splice(0, hit.name.split(" ").length);
    nodes = hit.kids;
  }
  return render(nodes).join("\n");
}
export const stJunosText = (sw: StSw, c: StCandSw, path: string[] = []) => walk(junosTree(sw, c), path);
export function junosCheck(c: StCandSw): string | undefined {
  if (c.stz.rstp && c.stz.stp) return "[edit protocols]\n  'stp'\n    Only one spanning-tree protocol (stp, rstp, mstp, vstp) may be configured";
  return undefined;
}
function junosOp(api: StCliApi, sw: StSw): CliCommand[] {
  const s = api.view;
  const c = s.cfg.sw[sw];
  const b = s.tree.bridges[sw];
  const ifArg: CliArgSpec = { choices: [...ST_PORTS], describe: (x) => PORT_DESC[sw][x as StPort], resolve: (raw) => ((ST_PORTS as readonly string[]).includes(raw.replace(/\.0$/, "")) ? raw.replace(/\.0$/, "") : undefined) };
  const stIf = (only?: string) => {
    const rows = ST_PORTS.filter((p) => (!only || p === only) && s.tree.ports[pk(sw, p)]?.role !== "Disabled" && !s.tree.ports[pk(sw, p)]?.role.startsWith("No")).map((p) => {
      const info = s.tree.ports[pk(sw, p)];
      const st = stPortState(s, sw, p);
      const des = info.desBridge ? bidOf(s.cfg, info.desBridge) : bidOf(s.cfg, sw);
      return [p, `128:${p.split("/").pop()}`, `128:${(info.desPort ?? p).split("/").pop()}`, fmtBid(des.priority, des.mac), String(c.ports[p].cost), info.role === "Non-STP" ? "FWD" : st.state === "FWD" ? "FWD" : st.state === "LRN" ? "LRN" : "BLK", info.role === "Root" ? "ROOT" : info.role === "Alternate" ? "ALT" : info.role === "Non-STP" ? "DIS" : info.role === "Root-inc" ? "DESG (Root-Incon)" : "DESG"];
    });
    return ["Spanning tree interface parameters for instance 0", "", columns([["Interface", "Port ID", "Designated", "Designated", "Port", "State", "Role"], ["", "", "port ID", "bridge ID", "Cost", "", ""], ...rows], [12, 9, 11, 20, 8, 6])].join("\n");
  };
  const table = () => { const rows = stTable(s.fdb, sw); return ["MAC flags (S - static MAC, D - dynamic MAC, L - locally learned)", "", `Ethernet switching table : ${rows.length} entries, ${rows.length} learned`, "Routing instance : default-switch", columns([["   Vlan", "MAC", "MAC", "Age", "Logical"], ["   name", "address", "flags", "", "interface"], ...rows.map((e) => ["   default", e.mac.toLowerCase(), "D", "-", `${e.port}.0`])], [13, 20, 8, 6])].join("\n"); };
  return [
    {
      id: "bridge",
      syntax: "show spanning-tree bridge",
      summary: "Root ID, root cost, Root Port, this bridge's ID",
      run: () => {
        if (c.proto === "none") return refuse("error: spanning tree is not configured", "No protocols rstp / stp stanza: spanning tree is not running on this switch.");
        const r = bidOf(s.cfg, b!.root);
        const me = bidOf(s.cfg, sw);
        return { output: ["STP bridge parameters", "Routing instance name               : GLOBAL", "Context ID                          : 0", `Enabled protocol                    : ${c.proto === "rstp" ? "RSTP" : "STP"}`, `  Root ID                           : ${r.priority}.${r.mac.toLowerCase()}`, ...(b!.root === sw ? [] : [`  Root cost                         : ${b!.cost}`, `  Root port                         : ${b!.rootPort}`]), "  Hello time                        : 2 seconds", `  Maximum age                       : ${MAX_AGE} seconds`, `  Forward delay                     : ${FWD_DELAY} seconds`, `  Message age                       : ${b!.root === sw ? 0 : 1}`, `  Number of topology changes        : ${s.tcCount[sw]}`, `  Time since last topology change   : ${Math.max(0, s.clock - s.lastTc[sw])} seconds`, "  Local parameters", `    Bridge ID                       : ${me.priority}.${me.mac.toLowerCase()}`, "    Extended system ID              : 0"].join("\n"), explanation: b!.root === sw ? "Root ID = this bridge's own ID: it is the root (no Root port line)." : `Root ID is ${bidName(r)}'s: lowest priority (then MAC) in the network.` };
      },
    },
    { id: "stif", syntax: "show spanning-tree interface", summary: "Every port: role (ROOT/DESG/ALT), state (FWD/BLK/LRN), cost", run: () => (c.proto === "none" ? refuse("error: spanning tree is not configured") : { output: stIf(), explanation: "Designated bridge ID = who wins each segment. ALT + BLK = the backup path; it still hears BPDUs." }) },
    { id: "stif", syntax: "show spanning-tree interface <iface>", summary: "One port", args: { iface: ifArg }, run: ({ iface }) => (c.proto === "none" ? refuse("error: spanning tree is not configured") : { output: stIf(iface) }) },
    { id: "table", syntax: "show ethernet-switching table", summary: `${sw}'s MAC table`, run: () => ({ output: table() }) },
    { id: "terse", syntax: "show interfaces terse", summary: "Link state of every port", run: () => ({ output: columns([["Interface", "Admin", "Link", "Proto"], ...ST_PORTS.flatMap((p) => { const st = stPortStatus(s.cfg, s.errdis, sw, p); return [[p, st === "disabled" ? "down" : "up", st === "connected" ? "up" : "down", ""], [`${p}.0`, st === "disabled" ? "down" : "up", st === "connected" ? "up" : "down", "eth-switch"]]; })], [16, 6, 6]), explanation: s.errdis.some((k) => k.startsWith(sw)) ? "A port shut by bpdu-block shows Link down: clear it with clear error bpdu interface <if>." : undefined }) },
    { id: "if", syntax: "show interfaces <iface>", summary: "One port: link and counters", args: { iface: ifArg }, run: ({ iface }) => { const k = s.counters[pk(sw, iface)]; const st = stPortStatus(s.cfg, s.errdis, sw, iface); return { output: [`Physical interface: ${iface}, ${st === "disabled" ? "Administratively down" : "Enabled"}, Physical link is ${st === "connected" ? "Up" : "Down"}`, `  Description: ${PORT_DESC[sw][iface as StPort]}`, ...(st === "err-disabled" ? ["  Current address: …, Hardware address: …", "  Interface flags: Hardware-Down  BPDU-Error"] : []), "  Traffic statistics:", `   Input  packets:            ${k.inF}`, `   Output packets:            ${k.outF}`, `  Input errors:`, `    Drops: ${k.drops}`, `  BPDUs: received ${k.bpduIn}, sent ${k.bpduOut}`].join("\n") }; } },
    { id: "lldp", syntax: "show lldp neighbors", summary: "What is at the other end of each link", run: () => ({ output: columns([["Local Interface", "Parent Interface", "Chassis Id", "Port info", "System Name"], ...ST_PORTS.map((p) => ({ p, peer: stPeer(s.cfg, sw, p) })).filter((x) => x.peer && (ST_SWITCHES as string[]).includes(x.peer.dev) && stPortStatus(s.cfg, s.errdis, sw, x.p) === "connected").map((x) => [x.p, "-", BRIDGE_MAC[x.peer!.dev as StSw].toLowerCase(), x.peer!.port, x.peer!.dev])], [19, 20, 20, 15]) }) },
    { id: "log", syntax: "show log messages", summary: "System log: links, BPDU block, MAC moves", run: () => { const l = s.syslog.filter((x) => x.sw === sw).slice(-40).flatMap((x) => { const t = stamp(x.clock).junos; switch (x.ev) { case "up": return [`${t}  ${sw} mib2d[1734]: SNMP_TRAP_LINK_UP: ifIndex 5${PORT_NUM2(x.port)}, ifAdminStatus up(1), ifOperStatus up(1), ifName ${x.port}`]; case "down": case "admin-down": return [`${t}  ${sw} mib2d[1734]: SNMP_TRAP_LINK_DOWN: ifIndex 5${PORT_NUM2(x.port)}, ifAdminStatus ${x.ev === "admin-down" ? "down(2)" : "up(1)"}, ifOperStatus down(2), ifName ${x.port}`]; case "errdis": return [`${t}  ${sw} l2cpd[1801]: Interface ${x.port}.0 disabled: BPDU received on a bpdu-block interface`]; case "flap": return [`${t}  ${sw} l2ald[1650]: L2ALD_MAC_MOVE_NOTIFICATION: MAC ${x.mac!.toLowerCase()} moved from ${x.ports![0]}.0 to ${x.ports![1]}.0 (vlan default)`]; default: return []; } }); return { output: l.length ? l.join("\n") : "(no messages)", explanation: "Junos logs link changes, bpdu-block shutdowns and MAC moves. It does not log spanning-tree role changes by default: read show spanning-tree interface." }; } },
    { id: "cfg", syntax: "show configuration protocols", summary: "Spanning-tree and BPDU-protection configuration", run: () => ({ output: stJunosText(sw, candOfSw(c), ["protocols"]) }) },
    { id: "cfg", syntax: "show configuration protocols rstp", summary: "The RSTP stanza", run: () => ({ output: stJunosText(sw, candOfSw(c), ["protocols", "rstp"]) || "" , explanation: c.proto === "rstp" ? undefined : `No rstp stanza: this switch runs ${c.proto === "stp" ? "legacy STP (protocols stp)" : "no spanning tree at all"}.` }) },
    { id: "cfg", syntax: "show configuration", summary: `${sw}'s committed configuration`, run: () => ({ output: stJunosText(sw, candOfSw(c)) }) },
    { id: "clr", syntax: "clear error bpdu interface <iface>", summary: "Re-enable a port shut by bpdu-block", args: { iface: ifArg }, run: ({ iface }) => (s.errdis.includes(pk(sw, iface)) ? (api.act({ type: "clear-errdis", sw, port: iface }), { output: "", explanation: "Cleared. If BPDUs still arrive on it, bpdu-block shuts it again at once." }) : refuse(`error: interface ${iface} is not in BPDU error state`)) },
    { id: "clear", syntax: "clear ethernet-switching table", summary: "Forget every learned entry", run: () => (api.act({ type: "clear", sw }), { output: "" }) },
    { id: "hist", syntax: "show cli history", summary: "The commands you typed in this session", run: () => ({ output: [...(api.history ?? []), "show cli history"].map((x, n) => `${String(n + 1).padStart(4)}  ${x}`).join("\n") }) },
  ];
}
const PORT_NUM2 = (p?: string) => String(20 + +(p ?? "ge-0/0/1").split("/").pop()!);
function junosSet(api: StCliApi, sw: StSw): CliCommandSet {
  const s = api.view;
  const base = { vendor: "juniper" as const, deviceId: sw, deviceName: sw };
  const op = junosOp(api, sw);
  const active = candOfSw(s.cfg.sw[sw]);
  const rbHist = s.rb?.[sw] ?? [];
  const cand = api.cand[sw];
  const dirty = JSON.stringify(cand) !== JSON.stringify(active);
  const configure: CliCommand = { id: "conf", syntax: "configure", summary: "Enter configuration mode (the candidate configuration)", run: () => (!dirty && api.setCand({ ...api.cand, [sw]: active }), api.setJunosEdit(sw, true), { output: dirty ? "Entering configuration mode\nThe configuration has been changed but not committed\n" : "Entering configuration mode\n" }) };
  if (!api.junosEdit[sw]) return { ...base, prompt: `admin@${sw}> `, commands: [...op, configure] };
  const set = (c: StCandSw) => api.setCand({ ...api.cand, [sw]: c });
  const ifArg: CliArgSpec = { choices: [...ST_PORTS], describe: (x) => PORT_DESC[sw][x as StPort], resolve: (raw) => ((ST_PORTS as readonly string[]).includes(raw) ? raw : undefined) };
  const protoArg: CliArgSpec = { choices: ["rstp", "stp"], resolve: (raw) => (raw === "rstp" || raw === "stp" ? raw : undefined) };
  const port = (p: string, patch: Partial<StPortCfg>) => set({ ...cand, ports: { ...cand.ports, [p]: { ...cand.ports[p as StPort], ...patch } } });
  const needProto = (pr: string) => (cand.stz[pr as "rstp" | "stp"] ? undefined : { ...cand, stz: { ...cand.stz, [pr]: true } });
  const sp = (pr: string, patch: (c: StCandSw) => StCandSw) => set(patch(needProto(pr) ?? cand));
  const doCommit = (quit: boolean): CliResult => {
    const err = junosCheck(cand);
    if (err) return refuse(`${err}\nerror: configuration check-out failed`, "Junos checks the whole candidate before activating it. Nothing changed.");
    if (dirty) setSw(api, sw, { proto: protoOf(cand), priority: cand.priority, ports: cand.ports }, "Junos commit", true);
    if (quit) api.setJunosEdit(sw, false);
    return { output: quit ? "commit complete\nExiting configuration mode" : "commit complete", explanation: dirty ? "Active now: spanning tree recomputed. Check show spanning-tree interface, then prove it with traffic." : undefined };
  };
  return {
    ...base,
    prompt: `admin@${sw}# `,
    commands: [
      { id: "prio", syntax: "set protocols <proto> bridge-priority <priority>", summary: "This bridge's priority (0, 4k … 60k; lower wins root)", args: { proto: protoArg, priority: junosPrioArg }, run: ({ proto, priority }) => { const v = junosPrio(priority); return v === undefined ? refuse(`error: bridge-priority must be 0 or a multiple of 4k up to 60k (got ${priority})`) : (sp(proto, (c) => ({ ...c, priority: v })), { output: "" }); } },
      { id: "prio", syntax: "delete protocols <proto> bridge-priority", summary: "Back to the default 32k", args: { proto: protoArg }, run: ({ proto }) => (sp(proto, (c) => ({ ...c, priority: 32768 })), { output: "" }) },
      { id: "cost", syntax: "set protocols <proto> interface <iface> cost <cost>", summary: "A port's path cost (counts when BPDUs arrive on it)", args: { proto: protoArg, iface: ifArg, cost: costArg }, run: ({ proto, iface, cost }) => (sp(proto, (c) => ({ ...c, ports: { ...c.ports, [iface]: { ...c.ports[iface as StPort], cost: +cost } } })), { output: "" }) },
      { id: "cost", syntax: "delete protocols <proto> interface <iface> cost", summary: "Back to the default cost", args: { proto: protoArg, iface: ifArg }, run: ({ iface }) => (port(iface, { cost: DEFAULT_COST }), { output: "" }) },
      { id: "edge", syntax: "set protocols <proto> interface <iface> edge", summary: "Edge port: forwards at once (host ports)", args: { proto: protoArg, iface: ifArg }, run: ({ proto, iface }) => (sp(proto, (c) => ({ ...c, ports: { ...c.ports, [iface]: { ...c.ports[iface as StPort], edge: true } } })), { output: "" }) },
      { id: "edge", syntax: "delete protocols <proto> interface <iface> edge", summary: "Not an edge port", args: { proto: protoArg, iface: ifArg }, run: ({ iface }) => (cand.ports[iface as StPort].edge ? (port(iface, { edge: false }), { output: "" }) : refuse("warning: statement not found")) },
      { id: "nrp", syntax: "set protocols <proto> interface <iface> no-root-port", summary: "Root protection: this port may never become Root Port", args: { proto: protoArg, iface: ifArg }, run: ({ proto, iface }) => (sp(proto, (c) => ({ ...c, ports: { ...c.ports, [iface]: { ...c.ports[iface as StPort], rootGuard: true } } })), { output: "" }) },
      { id: "nrp", syntax: "delete protocols <proto> interface <iface> no-root-port", summary: "Remove root protection", args: { proto: protoArg, iface: ifArg }, run: ({ iface }) => (port(iface, { rootGuard: false }), { output: "" }) },
      { id: "dis", syntax: "set protocols <proto> interface <iface> disable", summary: "Take a port out of spanning tree (dangerous on switch links)", args: { proto: protoArg, iface: ifArg }, run: ({ proto, iface }) => (sp(proto, (c) => ({ ...c, ports: { ...c.ports, [iface]: { ...c.ports[iface as StPort], stpOff: true } } })), { output: "" }) },
      { id: "dis", syntax: "delete protocols <proto> interface <iface> disable", summary: "Put the port back under spanning tree", args: { proto: protoArg, iface: ifArg }, run: ({ iface }) => (cand.ports[iface as StPort].stpOff ? (port(iface, { stpOff: false }), { output: "" }) : refuse("warning: statement not found")) },
      { id: "bpdu", syntax: "set protocols layer2-control bpdu-block interface <iface>", summary: "BPDU protection: disable the port if a BPDU arrives", args: { iface: ifArg }, run: ({ iface }) => (port(iface, { bpduGuard: true }), { output: "" }) },
      { id: "bpdu", syntax: "delete protocols layer2-control bpdu-block interface <iface>", summary: "Remove BPDU protection", args: { iface: ifArg }, run: ({ iface }) => (cand.ports[iface as StPort].bpduGuard ? (port(iface, { bpduGuard: false }), { output: "" }) : refuse("warning: statement not found")) },
      { id: "proto", syntax: "set protocols <proto>", summary: "Add a spanning-tree protocol stanza (rstp or stp)", args: { proto: protoArg }, run: ({ proto }) => (set({ ...cand, stz: { ...cand.stz, [proto]: true } }), { output: "", explanation: cand.stz.rstp && proto === "stp" ? "Both rstp and stp are now in the candidate: commit check will refuse it — delete one." : undefined }) },
      { id: "proto", syntax: "delete protocols <proto>", summary: "Remove a spanning-tree protocol stanza", args: { proto: protoArg }, run: ({ proto }) => (cand.stz[proto as "rstp" | "stp"] ? (set({ ...cand, stz: { ...cand.stz, [proto]: false } }), { output: "", explanation: !cand.stz[proto === "rstp" ? "stp" : "rstp"] ? "With no stanza left, spanning tree stops running when you commit: every port forwards." : undefined }) : refuse("warning: statement not found")) },
      { id: "ifdis", syntax: "set interfaces <iface> disable", summary: "Disable a port", args: { iface: ifArg }, run: ({ iface }) => (port(iface, { shut: true }), { output: "" }) },
      { id: "ifdis", syntax: "delete interfaces <iface> disable", summary: "Enable a port", args: { iface: ifArg }, run: ({ iface }) => (cand.ports[iface as StPort].shut ? (port(iface, { shut: false }), { output: "" }) : refuse("warning: statement not found")) },
      { id: "show", syntax: "show", summary: "The candidate configuration (try show | compare)", run: () => ({ output: stJunosText(sw, cand) }) },
      { id: "show", syntax: "show protocols", summary: "Candidate protocols", run: () => ({ output: stJunosText(sw, cand, ["protocols"]) }) },
      { id: "commit", syntax: "commit", summary: "Activate the candidate configuration", run: () => doCommit(false) },
      { id: "commit", syntax: "commit check", summary: "Check the candidate without activating it", run: () => { const err = junosCheck(cand); return err ? refuse(`${err}\nerror: configuration check-out failed`) : { output: "configuration check succeeds" }; } },
      { id: "commit", syntax: "commit and-quit", summary: "Commit, then leave configuration mode", run: () => doCommit(true) },
      { id: "rollback", syntax: "rollback", summary: "Discard your uncommitted changes (= rollback 0)", run: () => (set(active), { output: "load complete" }) },
      {
        id: "rollback",
        syntax: "rollback <n>",
        summary: "Load an earlier committed configuration into the candidate (then commit)",
        args: { n: { choices: ["0", ...rbHist.map((_, i) => String(i + 1))], describe: (x) => (x === "0" ? "the active configuration" : x === "1" ? "before the last commit" : `before the last ${x} commits`), resolve: (raw) => (/^\d{1,2}$/.test(raw) ? String(+raw) : undefined) } },
        run: ({ n }) => {
          if (n === "0") return (set(active), { output: "load complete" });
          const json = rbHist[Number(n) - 1];
          if (!json) return refuse(`error: rollback ${n} does not exist${rbHist.length ? ` (1–${rbHist.length} available)` : " (no commits yet)"}`);
          set(candOfSw(JSON.parse(json) as StSwCfg));
          return { output: "load complete", explanation: `The candidate now holds the configuration from before the last ${n === "1" ? "commit" : `${n} commits`}. show | compare, then commit to activate it.` };
        },
      },
      ...prefixed(op, "run"),
      {
        id: "exit",
        syntax: "exit",
        summary: "Leave configuration mode",
        run: () => {
          if (!dirty || !api.ask) return (api.setJunosEdit(sw, false), { output: "Exiting configuration mode" });
          api.ask({ node: sw, prompt: "The configuration has been changed but not committed\nExit with uncommitted changes? [yes,no] (yes) ", answer: (line) => { api.ask?.(undefined); if (/^n(o)?$/i.test(line.trim())) return { output: "" }; api.setJunosEdit(sw, false); return { output: "Exiting configuration mode" }; }, cancel: () => (api.ask?.(undefined), "") });
          return { output: "" };
        },
      },
    ],
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Hosts
// ---------------------------------------------------------------------------------------------------------------
function hostSet(api: StCliApi, h: StHost): CliCommandSet {
  const s = api.view;
  const name = h.toLowerCase();
  const others = ST_HOSTS.filter((x) => x !== h);
  const ipArg: CliArgSpec = { choices: others.map((x) => HOST_IP[x]), describe: (c) => ST_HOSTS.find((x) => HOST_IP[x] === c), resolve: (raw) => (/^(\d{1,3}\.){3}\d{1,3}$/.test(raw) ? raw : undefined) };
  const ping = (ip: string, n: number): CliResult => {
    const to = ST_HOSTS.find((x) => HOST_IP[x] === ip);
    if (!to) return { output: [`PING ${ip} (${ip}) 56(84) bytes of data.`, ...Array.from({ length: Math.min(n, 3) }, (_, i) => `From ${HOST_IP[h]} icmp_seq=${i + 1} Destination Host Unreachable`), "", `--- ${ip} ping statistics ---`, `${n} packets transmitted, 0 received, +${Math.min(n, 3)} errors, 100% packet loss`].join("\n"), explanation: "No host has that address in this lab." };
    const ns = api.act({ type: "traffic", sends: [{ from: h, to, kind: "ping" }] });
    const r = ns.last!.results[0];
    const dup = ns.last!.waves.flatMap((w) => w.rx).filter((x) => x.dev === h && x.frame.kind === "echo-rep").reduce((a, x) => a + x.n, 0);
    if (r.replied) return { output: [`PING ${ip} (${ip}) 56(84) bytes of data.`, ...Array.from({ length: n }, (_, i) => `64 bytes from ${ip}: icmp_seq=${i + 1} ttl=64 time=0.${4 + i} ms`), ...(dup > 1 ? [`64 bytes from ${ip}: icmp_seq=1 ttl=64 time=0.9 ms (DUP!)`] : []), "", `--- ${ip} ping statistics ---`, `${n} packets transmitted, ${n} received${dup > 1 ? `, +${dup - 1} duplicates` : ""}, 0% packet loss`].join("\n"), explanation: dup > 1 ? "DUP! = the same reply arrived more than once: a Layer-2 loop is copying frames." : `Path: ${r.path.join(" → ")} → ${to}.` };
    return { output: [`PING ${ip} (${ip}) 56(84) bytes of data.`, "", `--- ${ip} ping statistics ---`, `${n} packets transmitted, 0 received, 100% packet loss`].join("\n"), explanation: r.fail };
  };
  const cmds: CliCommand[] = [
    { id: "addr", syntax: "ip addr", summary: "This host's address", run: () => ({ output: ["1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536", "    inet 127.0.0.1/8 scope host lo", `2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 state ${s.cfg.hosts[h] ? "UP" : "DOWN"}`, `    link/ether ${HOST_MAC[h].toLowerCase()} brd ff:ff:ff:ff:ff:ff`, `    inet ${HOST_IP[h]}/24 scope global eth0`].join("\n"), explanation: "The host knows nothing about spanning tree. Its link is UP even while its switch port is still Discarding/Learning." }) },
    { id: "neigh", syntax: "ip neigh", summary: "ARP cache", run: () => ({ output: Object.entries(s.arp[h]).map(([ip, mac]) => `${ip} dev eth0 lladdr ${mac.toLowerCase()} REACHABLE`).join("\n"), explanation: Object.keys(s.arp[h]).length ? undefined : "Empty: this host hasn't resolved anyone yet." }) },
    { id: "ping", syntax: "ping <ip>", summary: "Ping (4 echo requests)", args: { ip: ipArg }, run: ({ ip }) => ping(ip, 4) },
    { id: "ping", syntax: "ping -c <count> <ip>", summary: "Ping <count> times", args: { count: { choices: ["1", "3"], resolve: (raw) => (/^\d+$/.test(raw) && +raw >= 1 && +raw <= 10 ? raw : undefined) }, ip: ipArg }, run: ({ count, ip }) => ping(ip, +count) },
    { id: "flush", syntax: "sudo ip neigh flush all", summary: "Empty the ARP cache", run: () => (api.act({ type: "clear-arp", dev: h }), { output: "" }) },
  ];
  return withShellHistory(withSelfPing({ vendor: "cisco", deviceId: h, deviceName: name, prompt: `admin@${name}:~$ `, commands: cmds }, "linux", [HOST_IP[h]]), "linux", api.history);
}

export function stSwitchSets(api: StCliApi, sw: StSw): Partial<Record<CliVendor, CliCommandSet>> {
  return { cisco: iosSet(api, sw), juniper: junosSet(api, sw) };
}
export const stHostSet = hostSet;
export const stJunosConfig = (api: Pick<StCliApi, "view">, sw: StSw) => (which: "committed" | number, path: string[]) => (which === "committed" || which === 0 ? stJunosText(sw, candOfSw(api.view.cfg.sw[sw]), path) : undefined);
