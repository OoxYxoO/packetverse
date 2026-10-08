import type { CliArgSpec, CliCommand, CliCommandSet, CliVendor } from "@/lib/cli/types";
import { ciscoMac, columns, interfaceArg } from "@/lib/cli/format";
import type { CliQuestion } from "@/app/demo/dhcp-dns/dhcp-lab/dhcpBuildCli";
import { SN_AGING, SN_HOSTS, SN_PORTS, isUplink, snCloneCfg, snHostAt, snMacName, snPeer, snPortStatus, snPortUp, snShut, snTable, type SnAction, type SnPort, type SnState, type SnSw, type SnSwCfg } from "@/lib/sim-engine/scenarios/switchNet";

/**
 * SW1 and SW2 command lines in the Switching Lab, Cisco IOS (Catalyst) or Junos (EX, ELS). Two OS views of ONE truth:
 * every output is printed from the lab state the topology, the tables, the counters and the captures use, and every
 * change goes through a lab action (IOS: on Enter; Junos: on commit). Hosts have no switch CLI.
 *
 *   IOS    show mac address-table [dynamic | static | address <mac> | interface <if> | count | aging-time] ·
 *          show interfaces status | <if> | counters · show lldp neighbors · show spanning-tree · show logging ·
 *          show running-config [interface <if>] · clear mac address-table dynamic [address | interface] ·
 *          clear counters · configure terminal → interface <if> (shutdown / no shutdown) ·
 *          mac address-table static … / aging-time …
 *   Junos  show ethernet-switching table [interface <if>] · show ethernet-switching mac-learning-log ·
 *          show ethernet-switching global-information · show interfaces terse | <if> · show lldp neighbors ·
 *          show log messages · show configuration … · clear ethernet-switching table [interface] ·
 *          clear interfaces statistics all · configure → set/delete interfaces <if> disable · static-mac · aging → commit
 * Output modifiers (| include, | match, | count …) come from the shared console.
 */

export type SnIosMode = { kind: "exec" } | { kind: "config" } | { kind: "if"; port: SnPort };
export interface SnCliApi {
  view: SnState;
  act: (a: SnAction) => SnState;
  ios: Record<SnSw, SnIosMode>;
  setIos: (sw: SnSw, m: SnIosMode) => void;
  junosEdit: Record<SnSw, boolean>;
  setJunosEdit: (sw: SnSw, b: boolean) => void;
  cand: Record<SnSw, SnSwCfg>;
  setCand: (sw: SnSw, c: SnSwCfg) => void;
  ask?: (q: CliQuestion | undefined) => void;
  history?: string[];
}

const N: Record<SnPort, string> = { "ge-0/0/1": "1", "ge-0/0/2": "2", "ge-0/0/3": "3", "ge-0/0/22": "22", "ge-0/0/23": "23", "ge-0/0/24": "24" };
export const CISCO_IF = Object.fromEntries(SN_PORTS.map((p) => [p, `GigabitEthernet1/0/${N[p]}`])) as Record<SnPort, string>;
export const CISCO_SHORT = Object.fromEntries(SN_PORTS.map((p) => [p, `Gi1/0/${N[p]}`])) as Record<SnPort, string>;
/** The name of a port in each OS (Cisco short form as its tables print it; Junos interface name). */
export const snPortName = (vendor: CliVendor, port: string) => (vendor === "cisco" ? (CISCO_SHORT[port as SnPort] ?? port) : port);
/** Lab text written with the model's port names, in the OS view the student picked. */
export const snVendorText = (vendor: CliVendor, text: string) => (vendor === "cisco" ? text.replace(/\bge-0\/0\/(\d+)\b/g, "Gi1/0/$1") : text);
/** Configured intent: what each port is FOR (the table says what is really there). */
export const PORT_DESC: Record<SnSw, Record<SnPort, string>> = {
  SW1: { "ge-0/0/1": "HOST-A", "ge-0/0/2": "HOST-D", "ge-0/0/3": "spare", "ge-0/0/22": "spare", "ge-0/0/23": "uplink-SW2", "ge-0/0/24": "uplink-SW2-2" },
  SW2: { "ge-0/0/1": "HOST-B", "ge-0/0/2": "HOST-C", "ge-0/0/3": "spare", "ge-0/0/22": "spare", "ge-0/0/23": "uplink-SW1", "ge-0/0/24": "uplink-SW1-2" },
};
const CHASSIS: Record<SnSw, string> = { SW1: "2c:6b:f5:00:01:00", SW2: "2c:6b:f5:00:02:00" };
const refuse = (output: string, explanation?: string) => ({ output, refused: true, explanation });
const anyArg: CliArgSpec = { choices: [], resolve: (raw) => raw };
const macHosts = (s: SnState) => SN_HOSTS.filter((h) => s.cfg.hosts[h].at || h !== "HOST-E");
const ciscoMacArg = (s: SnState): CliArgSpec => ({
  choices: [...new Set(macHosts(s).map((h) => ciscoMac(s.cfg.hosts[h].mac)))],
  describe: (c) => {
    const h = macHosts(s).find((x) => ciscoMac(s.cfg.hosts[x].mac) === c);
    return h ? `${h}'s MAC` : undefined;
  },
  resolve: (raw) => {
    const m = /^([0-9a-f]{4})\.([0-9a-f]{4})\.([0-9a-f]{4})$/i.exec(raw);
    return m ? (m[1] + m[2] + m[3]).toUpperCase().match(/.{2}/g)!.join(":") : undefined;
  },
});
const junosMacArg = (s: SnState): CliArgSpec => ({
  choices: [...new Set(macHosts(s).map((h) => s.cfg.hosts[h].mac.toLowerCase()))],
  describe: (c) => {
    const h = macHosts(s).find((x) => s.cfg.hosts[x].mac.toLowerCase() === c);
    return h ? `${h}'s MAC` : undefined;
  },
  resolve: (raw) => (/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(raw) ? raw.toUpperCase() : undefined),
});
const secondsArg: CliArgSpec = { choices: ["300"], describe: () => "seconds (10–1000000; default 300)", resolve: (raw) => (/^\d+$/.test(raw) && Number(raw) >= 10 && Number(raw) <= 1000000 ? raw : undefined) };
const prefixed = (cmds: CliCommand[], word: "do" | "run"): CliCommand[] => cmds.map((c) => ({ ...c, id: `${word}:${c.id}`, syntax: `${word} ${c.syntax}` }));
const stamp = (clock: number) => {
  const t = 3600 + clock;
  const hh = String(Math.floor(t / 3600) % 24).padStart(2, "0");
  const mm = String(Math.floor(t / 60) % 60).padStart(2, "0");
  const ss = String(Math.floor(t) % 60).padStart(2, "0");
  return { ios: `*Mar  1 ${hh}:${mm}:${ss}.000`, junos: `Mar  1 ${hh}:${mm}:${ss}` };
};
const sameSw = (a: SnSwCfg, b: SnSwCfg) => JSON.stringify([a.aging, [...a.statics].map((x) => `${x.mac}@${x.port}`).sort(), [...a.shut].sort()]) === JSON.stringify([b.aging, [...b.statics].map((x) => `${x.mac}@${x.port}`).sort(), [...b.shut].sort()]);
const EXPLAIN = {
  table: (sw: SnSw) => `This is ${sw}'s OWN table — the other switch has its own and is never asked. Each entry is "which of MY ports leads to this MAC", learned from the SOURCE MAC of a frame that came in on that port. Hosts on the other switch all sit behind the uplink.`,
  status: "Link state per port. A MAC can only be learned on a port that is up; a port going down flushes what was learned on it. A link coming up teaches nothing until frames arrive.",
  counters: "Frames this port received (input) and sent (output) since the counters were cleared, and how many were broadcasts. They prove which link carried traffic — and a storm shows as counters that keep climbing with nobody sending.",
};

// ---------------------------------------------------------------------------------------------------------------
// Configuration as each OS prints it
// ---------------------------------------------------------------------------------------------------------------
function iosRunning(s: SnState, sw: SnSw, port?: SnPort): string {
  const c = s.cfg.sw[sw];
  const iface = (p: SnPort) => [`interface ${CISCO_IF[p]}`, ` description ${PORT_DESC[sw][p]}`, " switchport mode access", ...(c.shut.includes(p) ? [" shutdown"] : []), "!"];
  if (port) return ["Building configuration...", "", "Current configuration : 130 bytes", "!", ...iface(port).slice(0, -1), "end"].join("\n");
  const body = [`hostname ${sw}`, "!", "no spanning-tree vlan 1", ...(c.aging !== SN_AGING ? [`mac address-table aging-time ${c.aging}`] : []), ...c.statics.map((x) => `mac address-table static ${ciscoMac(x.mac)} vlan 1 interface ${CISCO_IF[x.port]}`), "!", ...SN_PORTS.flatMap(iface), "end"];
  return `Building configuration...\n\nCurrent configuration : ${body.join("\n").length} bytes\n!\n${body.join("\n")}`;
}
interface JNode {
  name: string;
  kids?: JNode[];
}
function junosTree(sw: SnSw, c: SnSwCfg): JNode[] {
  const statics = c.statics.map((x) => ({ name: `interface ${x.port}.0`, kids: [{ name: `static-mac ${x.mac.toLowerCase()}` }] }));
  return [
    { name: "system", kids: [{ name: `host-name ${sw}` }] },
    { name: "interfaces", kids: SN_PORTS.map((p) => ({ name: p, kids: [...(c.shut.includes(p) ? [{ name: "disable" }] : []), { name: `description ${PORT_DESC[sw][p]}` }, { name: "unit 0", kids: [{ name: "family ethernet-switching" }] }] })) },
    { name: "protocols", kids: [{ name: "rstp", kids: [{ name: "disable" }] }, ...(c.aging !== SN_AGING ? [{ name: "l2-learning", kids: [{ name: `global-mac-table-aging-time ${c.aging}` }] }] : [])] },
    { name: "vlans", kids: [{ name: "default", kids: [{ name: "vlan-id 1" }, ...(statics.length ? [{ name: "switch-options", kids: statics }] : [])] }] },
  ];
}
const render = (nodes: JNode[], d = 0): string[] => nodes.flatMap((n) => (n.kids ? [`${"    ".repeat(d)}${n.name} {`, ...render(n.kids, d + 1), `${"    ".repeat(d)}}`] : [`${"    ".repeat(d)}${n.name};`]));
export function snJunosText(sw: SnSw, c: SnSwCfg, path: string[] = []): string {
  let nodes = junosTree(sw, c);
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
const JUNOS_PATHS = [
  { path: "interfaces", summary: "Ports: descriptions and which are disabled" },
  { path: "vlans", summary: "The default VLAN and its static MAC entries" },
  { path: "protocols", summary: "Layer-2 protocols (RSTP is disabled in this lab) and the aging time" },
  { path: "system", summary: "Host name" },
];

// ---------------------------------------------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------------------------------------------
function neighbors(s: SnState, sw: SnSw) {
  return SN_PORTS.filter((p) => isUplink(p) && snPortUp(s.cfg, sw, p)).map((p) => ({ port: p, peer: snPeer(s.cfg, sw, p)! }));
}
const otherSw = (sw: SnSw): SnSw => (sw === "SW1" ? "SW2" : "SW1");
function setSw(api: SnCliApi, sw: SnSw, c: SnSwCfg, text: string) {
  const cfg = snCloneCfg(api.view.cfg);
  cfg.sw[sw] = JSON.parse(JSON.stringify(c)) as SnSwCfg;
  api.act({ type: "cfg", cfg, text: `${sw}: ${text}` });
}

// ---------------------------------------------------------------------------------------------------------------
// Cisco IOS
// ---------------------------------------------------------------------------------------------------------------
function iosExec(api: SnCliApi, sw: SnSw): CliCommand[] {
  const s = api.view;
  const ifArg = { interface: interfaceArg("cisco", CISCO_IF, PORT_DESC[sw]) };
  const all = snTable(s.cfg, s.fdb, sw);
  const table = (rows: typeof all, note: string) => ({ output: ["          Mac Address Table", "-------------------------------------------", "", columns([["Vlan", "Mac Address", "Type", "Ports"], ["----", "-----------", "--------", "-----"], ...rows.map((e) => ["   1", ciscoMac(e.mac), e.type === "static" ? "STATIC" : "DYNAMIC", CISCO_SHORT[e.port]])], [8, 18, 12]), `Total Mac Addresses for this criterion: ${rows.length}`].join("\n"), explanation: note });
  const ctr = (p: SnPort) => s.counters[`${sw} ${p}`];
  const showIf = ({ interface: id }: Record<string, string>) => {
    const p = id as SnPort;
    const c = ctr(p);
    const st = snPortStatus(s.cfg, sw, p);
    const lines = [
      `${CISCO_IF[p]} is ${st === "disabled" ? "administratively down" : st === "connected" ? "up" : "down"}, line protocol is ${st === "connected" ? "up (connected)" : st === "disabled" ? "down (disabled)" : "down (notconnect)"}`,
      "  Hardware is Gigabit Ethernet",
      `  Description: ${PORT_DESC[sw][p]}`,
      st === "connected" ? "  Full-duplex, 1000Mb/s, media type is 10/100/1000BaseTX" : "  Auto-duplex, Auto-speed, media type is 10/100/1000BaseTX",
      `     ${c.inF} packets input, ${c.inBytes} bytes`,
      `     Received ${c.inB} broadcasts (0 multicasts)`,
      `     ${c.outF} packets output, ${c.outBytes} bytes`,
      `     ${c.outB} broadcasts sent`,
    ];
    return { output: lines.join("\n"), explanation: `${EXPLAIN.counters} The description is intent (what should be there); the MAC table says who actually is.` };
  };
  const logs = s.syslog.filter((l) => l.sw === sw && l.ev !== "move");
  return [
    { id: "mac-table", syntax: "show mac address-table", summary: `${sw}'s MAC table: MAC → port (static and learned)`, run: () => table(all, EXPLAIN.table(sw)) },
    { id: "mac-table", syntax: "show mac address-table dynamic", summary: "Learned entries only", run: () => table(all.filter((e) => e.type === "dynamic"), "Only what this switch learned from source MACs. Each entry disappears after the aging time unless that MAC sends again.") },
    { id: "mac-table", syntax: "show mac address-table static", summary: "Configured (static) entries only", run: () => table(all.filter((e) => e.type === "static"), "Static entries never age and are never relearned: frames for that MAC go out that port, wherever the host really is.") },
    { id: "mac-table", syntax: "show mac address-table address <mac>", summary: `Where ${sw} thinks one MAC is`, args: { mac: ciscoMacArg(s) }, run: ({ mac }) => table(all.filter((e) => e.mac === mac), `No entry means ${sw} has not seen ${snMacName(s.cfg, mac)} as a SOURCE on any of its ports (or it aged out / was flushed): frames to it are flooded.`) },
    { id: "mac-table", syntax: "show mac address-table interface <interface>", summary: `MACs ${sw} knows behind one port`, args: ifArg, run: ({ interface: p }) => table(all.filter((e) => e.port === p), isUplink(p) ? `Several MACs behind one port is normal on an uplink: every host on ${otherSw(sw)} is reached through it.` : "One host per access port is normal here.") },
    { id: "mac-count", syntax: "show mac address-table count", summary: "How many entries", run: () => ({ output: ["Mac Entries for Vlan 1:", "---------------------------", `Dynamic Address Count  : ${all.filter((e) => e.type === "dynamic").length}`, `Static  Address Count  : ${all.filter((e) => e.type === "static").length}`, `Total Mac Addresses    : ${all.length}`, "", "Total Mac Address Space Available: 32656"].join("\n") }) },
    { id: "mac-aging", syntax: "show mac address-table aging-time", summary: "Dynamic-entry aging time", run: () => ({ output: `Global Aging Time:  ${s.cfg.sw[sw].aging}\nVlan    Aging Time\n----    ----------\n   1    ${s.cfg.sw[sw].aging}`, explanation: `A learned entry is removed after ${s.cfg.sw[sw].aging} s without a frame SOURCED by that MAC. Receiving frames doesn't keep it alive.` }) },
    { id: "if-status", syntax: "show interfaces status", summary: "Link state of every port", run: () => ({ output: columns([["Port", "Name", "Status", "Vlan", "Duplex", "Speed", "Type"], ...SN_PORTS.map((p) => { const st = snPortStatus(s.cfg, sw, p); return [CISCO_SHORT[p], PORT_DESC[sw][p], st, "1", st === "connected" ? "a-full" : "auto", st === "connected" ? "a-1000" : "auto", "10/100/1000BaseTX"]; })], [10, 14, 13, 6, 8, 8]), explanation: EXPLAIN.status }) },
    { id: "if-detail", syntax: "show interfaces <interface>", summary: "One port: link, description and counters", args: ifArg, run: showIf },
    {
      id: "if-counters",
      syntax: "show interfaces counters",
      summary: "Frames in and out of every port",
      run: () => ({
        output: [columns([["Port", "InOctets", "InUcastPkts", "InMcastPkts", "InBcastPkts"], ...SN_PORTS.map((p) => [CISCO_SHORT[p], String(ctr(p).inBytes), String(ctr(p).inF - ctr(p).inB), "0", String(ctr(p).inB)])], [10, 13, 14, 14]), "", columns([["Port", "OutOctets", "OutUcastPkts", "OutMcastPkts", "OutBcastPkts"], ...SN_PORTS.map((p) => [CISCO_SHORT[p], String(ctr(p).outBytes), String(ctr(p).outF - ctr(p).outB), "0", String(ctr(p).outB)])], [10, 13, 14, 14])].join("\n"),
        explanation: EXPLAIN.counters,
      }),
    },
    { id: "lldp", syntax: "show lldp neighbors", summary: "Which switch is at the other end of each link", run: () => { const nb = neighbors(s, sw); return { output: ["Capability codes:", "    (R) Router, (B) Bridge, (T) Telephone, (C) DOCSIS Cable Device", "    (W) WLAN Access Point, (P) Repeater, (S) Station, (O) Other", "", columns([["Device ID", "Local Intf", "Hold-time", "Capability", "Port ID"], ...nb.map((n) => [n.peer.dev, CISCO_SHORT[n.port], "120", "B", CISCO_SHORT[n.port]])], [20, 15, 11, 16]), "", `Total entries displayed: ${nb.length}`].join("\n"), explanation: nb.length > 1 ? `${nb.length} links lead to the same neighbor: two paths between the same two switches.` : "LLDP answers \"what's at the other end of this cable?\" — handy for finding the uplink. Hosts here don't run LLDP." }; } },
    { id: "stp", syntax: "show spanning-tree", summary: "Loop prevention state", run: () => ({ output: "No spanning tree instance exists.", explanation: "Spanning tree is turned off in this lab (no spanning-tree vlan 1), so nothing will block a redundant path. That's the next lesson — here you see why it exists." }) },
    {
      id: "logging",
      syntax: "show logging",
      summary: "The log: links up/down and MAC flapping",
      run: () => ({
        output: ["Syslog logging: enabled (0 messages dropped, 0 flushes, 0 overruns)", "", `Log Buffer (8192 bytes):`, ...(logs.length ? logs.slice(-40).map((l) => {
          const t = stamp(l.clock).ios;
          if (l.ev === "flap") return `${t}: %SW_MATM-4-MACFLAP_NOTIF: Host ${ciscoMac(l.mac!)} in vlan 1 is flapping between port ${CISCO_SHORT[l.from as SnPort]} and port ${CISCO_SHORT[l.to as SnPort]}`;
          if (l.ev === "admin-down") return `${t}: %LINK-5-CHANGED: Interface ${CISCO_IF[l.port as SnPort]}, changed state to administratively down`;
          return `${t}: %LINK-3-UPDOWN: Interface ${CISCO_IF[l.port as SnPort]}, changed state to ${l.ev}\n${t}: %LINEPROTO-5-UPDOWN: Line protocol on Interface ${CISCO_IF[l.port as SnPort]}, changed state to ${l.ev}`;
        }) : ["(no messages)"])].join("\n"),
        explanation: "MACFLAP: the same source MAC keeps arriving on two different ports. A host that moved once is not a flap; back and forth means a loop — or two devices sharing one MAC.",
      }),
    },
    { id: "run", syntax: "show running-config", summary: `${sw}'s configuration`, run: () => ({ output: iosRunning(s, sw), explanation: "Configuration only: descriptions, shut ports, static entries, aging. What the switch LEARNED is not configuration — it is in show mac address-table." }) },
    { id: "run", syntax: "show running-config interface <interface>", summary: "One port's configuration", args: ifArg, run: ({ interface: p }) => ({ output: iosRunning(s, sw, p as SnPort) }) },
    { id: "clear", syntax: "clear mac address-table dynamic", summary: "Forget every learned entry (this switch only)", run: () => (api.act({ type: "clear", sw }), { output: "", explanation: `${sw}'s learned entries are gone; statics stay. ${otherSw(sw)} keeps its own table. Frames to unknown MACs are flooded until the hosts send again.` }) },
    { id: "clear", syntax: "clear mac address-table dynamic address <mac>", summary: "Forget one learned entry", args: { mac: ciscoMacArg(s) }, run: ({ mac }) => (api.act({ type: "clear", sw, mac }), { output: "", explanation: `${snMacName(s.cfg, mac)} is unknown to ${sw} until a frame FROM it arrives; frames to it are flooded meanwhile.` }) },
    { id: "clear", syntax: "clear mac address-table dynamic interface <interface>", summary: "Forget what was learned on one port", args: ifArg, run: ({ interface: p }) => (api.act({ type: "clear", sw, port: p }), { output: "" }) },
    {
      id: "clear-ctr",
      syntax: "clear counters",
      summary: "Reset the interface counters on this switch",
      run: () => {
        if (!api.ask) return (api.act({ type: "clear-counters", sw }), { output: "" });
        api.ask({ node: sw, prompt: 'Clear "show interface" counters on all interfaces [confirm]', answer: (line) => (api.ask?.(undefined), /^(y(es)?)?$/i.test(line.trim()) ? (api.act({ type: "clear-counters", sw }), { output: "" }) : { output: "" }), cancel: () => (api.ask?.(undefined), "") });
        return { output: "" };
      },
    },
    { id: "hist", syntax: "show history", summary: "The commands you typed in this session", run: () => ({ output: [...(api.history ?? []), "show history"].map((x) => `  ${x}`).join("\n") }) },
  ];
}

function iosSet(api: SnCliApi, sw: SnSw): CliCommandSet {
  const s = api.view;
  const c = s.cfg.sw[sw];
  const exec = iosExec(api, sw);
  const ifArg = { interface: interfaceArg("cisco", CISCO_IF, PORT_DESC[sw]) };
  const base = { vendor: "cisco" as const, deviceId: sw, deviceName: sw };
  const mode = api.ios[sw];
  const end: CliCommand = { id: "end", syntax: "end", summary: "Leave configuration mode", run: () => (api.setIos(sw, { kind: "exec" }), { output: `%SYS-5-CONFIG_I: Configured from console by console` }) };
  const stp: CliCommand = { id: "stp", syntax: "spanning-tree vlan <vlan>", summary: "", hidden: true, args: { vlan: { choices: ["1"], resolve: (r) => r } }, run: () => refuse("% Not in this lab: spanning tree is the next lesson.", "Here the only way to stop a loop is to remove the extra path. Spanning Tree does that automatically — by blocking a port.") };
  if (mode.kind === "exec") return { ...base, prompt: `${sw}#`, commands: [...exec, { id: "conf", syntax: "configure terminal", summary: "Enter configuration mode", run: () => (api.setIos(sw, { kind: "config" }), { output: "Enter configuration commands, one per line.  End with CNTL/Z." }) }, { id: "conf", syntax: "conf t", summary: "", hidden: true, run: () => (api.setIos(sw, { kind: "config" }), { output: "Enter configuration commands, one per line.  End with CNTL/Z." }) }] };
  const doCmds = prefixed(exec, "do");
  if (mode.kind === "config")
    return {
      ...base,
      prompt: `${sw}(config)#`,
      commands: [
        { id: "if", syntax: "interface <interface>", summary: "Configure one port", args: ifArg, run: ({ interface: p }) => (api.setIos(sw, { kind: "if", port: p as SnPort }), { output: "" }) },
        {
          id: "static",
          syntax: "mac address-table static <mac> vlan <vlan> interface <interface>",
          summary: "Pin a MAC to a port (never ages, never relearned)",
          args: { mac: ciscoMacArg(s), vlan: { choices: ["1"], describe: () => "the only VLAN here", resolve: (r) => (r === "1" ? r : undefined) }, ...ifArg },
          run: ({ mac, interface: p }) => (setSw(api, sw, { ...c, statics: [...c.statics.filter((x) => x.mac !== mac), { mac, port: p as SnPort }] }, `mac address-table static ${ciscoMac(mac)} vlan 1 interface ${CISCO_IF[p as SnPort]}`), { output: "", explanation: "Active at once: frames for this MAC now leave that port, wherever the host really is." }),
        },
        {
          id: "nostatic",
          syntax: "no mac address-table static <mac> vlan <vlan>",
          summary: "Remove a static entry",
          args: { mac: { ...ciscoMacArg(s), choices: c.statics.map((x) => ciscoMac(x.mac)) }, vlan: { choices: ["1"], resolve: (r) => (r === "1" ? r : undefined) } },
          run: ({ mac }) => (c.statics.some((x) => x.mac === mac) ? (setSw(api, sw, { ...c, statics: c.statics.filter((x) => x.mac !== mac) }, `no mac address-table static ${ciscoMac(mac)} vlan 1`), { output: "", explanation: "Gone. The MAC will be learned again from the next frame it sends." }) : refuse("% Static entry not found")),
        },
        { id: "nostatic", syntax: "no mac address-table static <mac> vlan <vlan> interface <interface>", summary: "", hidden: true, args: { mac: { ...ciscoMacArg(s), choices: c.statics.map((x) => ciscoMac(x.mac)) }, vlan: { choices: ["1"], resolve: (r) => (r === "1" ? r : undefined) }, ...ifArg }, run: ({ mac }) => (c.statics.some((x) => x.mac === mac) ? (setSw(api, sw, { ...c, statics: c.statics.filter((x) => x.mac !== mac) }, `no mac address-table static ${ciscoMac(mac)} vlan 1`), { output: "" }) : refuse("% Static entry not found")) },
        { id: "aging", syntax: "mac address-table aging-time <seconds>", summary: "How long a learned entry lives without its MAC sending", args: { seconds: secondsArg }, run: ({ seconds }) => (setSw(api, sw, { ...c, aging: Number(seconds) }, `mac address-table aging-time ${seconds}`), { output: "" }) },
        { id: "noaging", syntax: "no mac address-table aging-time", summary: "Back to the default aging time (300 s)", run: () => (setSw(api, sw, { ...c, aging: SN_AGING }, "no mac address-table aging-time"), { output: "" }) },
        stp,
        { id: "exit", syntax: "exit", summary: "Back to privileged mode", run: () => (api.setIos(sw, { kind: "exec" }), { output: "" }) },
        end,
        ...doCmds,
      ],
    };
  const p = mode.port;
  const peer = snPeer(s.cfg, sw, p);
  return {
    ...base,
    prompt: `${sw}(config-if)#`,
    commands: [
      { id: "shut", syntax: "shutdown", summary: "Disable this port (the link goes down at both ends)", run: () => (setSw(api, sw, { ...c, shut: [...new Set([...c.shut, p])] }, `interface ${CISCO_IF[p]} · shutdown`), { output: `${stamp(s.clock).ios}: %LINK-5-CHANGED: Interface ${CISCO_IF[p]}, changed state to administratively down` }) },
      { id: "noshut", syntax: "no shutdown", summary: "Enable this port", run: () => {
        if (!c.shut.includes(p)) return { output: "" };
        setSw(api, sw, { ...c, shut: c.shut.filter((x) => x !== p) }, `interface ${CISCO_IF[p]} · no shutdown`);
        const farShut = peer && isUplink(p) && snShut(s.cfg, otherSw(sw), p);
        return { output: peer && !farShut ? `${stamp(s.clock).ios}: %LINK-3-UPDOWN: Interface ${CISCO_IF[p]}, changed state to up` : "", explanation: farShut ? `Enabled here — but ${otherSw(sw)} has its end of this cable shut, so the link stays down (notconnect).` : !peer ? "Enabled, but nothing is plugged in (notconnect)." : isUplink(p) ? "The link is up. Nothing is learned on it until frames arrive." : undefined };
      } },
      { id: "if", syntax: "interface <interface>", summary: "Move to another port", args: ifArg, run: ({ interface: q }) => (api.setIos(sw, { kind: "if", port: q as SnPort }), { output: "" }) },
      { id: "exit", syntax: "exit", summary: "Back to global configuration", run: () => (api.setIos(sw, { kind: "config" }), { output: "" }) },
      end,
      ...doCmds,
      { id: "desc", syntax: "description <text>", summary: "", hidden: true, args: { text: anyArg }, run: () => refuse("% Not available in this lab: the descriptions record what each port is for.") },
      { id: "stp", syntax: "spanning-tree <rest>", summary: "", hidden: true, args: { rest: anyArg }, run: () => refuse("% Not in this lab: spanning tree is the next lesson.") },
    ],
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Junos (EX, ELS)
// ---------------------------------------------------------------------------------------------------------------
function junosOp(api: SnCliApi, sw: SnSw): CliCommand[] {
  const s = api.view;
  const ifArg: CliArgSpec = { choices: [...SN_PORTS], describe: (c) => PORT_DESC[sw][c as SnPort], resolve: (raw) => ((SN_PORTS as readonly string[]).includes(raw.replace(/\.0$/, "")) ? raw.replace(/\.0$/, "") : undefined) };
  const all = snTable(s.cfg, s.fdb, sw);
  const table = (rows: typeof all) => ({
    output: ["MAC flags (S - static MAC, D - dynamic MAC, L - locally learned, P - Persistent static", "           SE - statistics enabled, NM - non configured MAC, R - remote PE MAC, O - ovsdb MAC)", "", `Ethernet switching table : ${rows.length} entries, ${rows.filter((e) => e.type === "dynamic").length} learned`, "Routing instance : default-switch", columns([["   Vlan", "MAC", "MAC", "Age", "Logical"], ["   name", "address", "flags", "", "interface"], ...rows.map((e) => ["   default", e.mac.toLowerCase(), e.type === "static" ? "S" : "D", "-", `${e.port}.0`])], [13, 20, 8, 6])].join("\n"),
    explanation: EXPLAIN.table(sw),
  });
  const ctr = (p: SnPort) => s.counters[`${sw} ${p}`];
  const showIf = (p: SnPort) => {
    const c = ctr(p);
    const st = snPortStatus(s.cfg, sw, p);
    return { output: [`Physical interface: ${p}, ${st === "disabled" ? "Administratively down" : "Enabled"}, Physical link is ${st === "connected" ? "Up" : "Down"}`, `  Description: ${PORT_DESC[sw][p]}`, "  Link-level type: Ethernet, MTU: 1514, Speed: 1000mbps", "  Traffic statistics:", `   Input  bytes  :            ${c.inBytes}`, `   Output bytes  :            ${c.outBytes}`, `   Input  packets:            ${c.inF}`, `   Output packets:            ${c.outF}`, "  Ingress traffic statistics:", `   Broadcast packets:         ${c.inB}`, "  Egress traffic statistics:", `   Broadcast packets:         ${c.outB}`].join("\n"), explanation: EXPLAIN.counters };
  };
  const active = s.cfg.sw[sw];
  return [
    { id: "mac-table", syntax: "show ethernet-switching table", summary: `${sw}'s switching table: MAC → port`, run: () => table(all) },
    { id: "mac-table", syntax: "show ethernet-switching table interface <iface>", summary: `MACs ${sw} knows behind one port`, args: { iface: ifArg }, run: ({ iface }) => table(all.filter((e) => e.port === iface)) },
    {
      id: "mac-log",
      syntax: "show ethernet-switching mac-learning-log",
      summary: "MAC moves between ports (the learning log)",
      run: () => {
        const mv = s.moves.filter((m) => m.sw === sw);
        return { output: mv.length ? mv.slice(-40).map((m) => `${stamp(m.clock).junos}  vlan_name default mac ${m.mac.toLowerCase()} was moved from ${m.from}.0 to ${m.to}.0${m.flap ? " (moving back and forth)" : ""}`).join("\n") : "No MAC moves recorded.", explanation: "A MAC learned on a new port replaces its old entry. Once: a host moved. Back and forth: a loop, or two NICs sharing one MAC." };
      },
    },
    { id: "mac-global", syntax: "show ethernet-switching global-information", summary: "Learning settings, including the aging time", run: () => ({ output: ["Global Configuration:", "", `MAC aging interval    : ${active.aging}`, "MAC learning          : Enabled", "MAC statistics        : Disabled", "MAC limit Count       : 294912"].join("\n"), explanation: `A learned entry is removed after ${active.aging} s without a frame SOURCED by that MAC.` }) },
    { id: "if-status", syntax: "show interfaces terse", summary: "Link state of every port", run: () => ({ output: columns([["Interface", "Admin", "Link", "Proto"], ...SN_PORTS.flatMap((p) => { const st = snPortStatus(s.cfg, sw, p); return [[p, st === "disabled" ? "down" : "up", st === "connected" ? "up" : "down", ""], [`${p}.0`, st === "disabled" ? "down" : "up", st === "connected" ? "up" : "down", "eth-switch"]]; })], [16, 6, 6]), explanation: EXPLAIN.status }) },
    { id: "if-detail", syntax: "show interfaces <iface>", summary: "One port: link, description and counters", args: { iface: ifArg }, run: ({ iface }) => showIf(iface as SnPort) },
    { id: "if-detail", syntax: "show interfaces <iface> extensive", summary: "", hidden: true, args: { iface: ifArg }, run: ({ iface }) => showIf(iface as SnPort) },
    { id: "lldp", syntax: "show lldp neighbors", summary: "Which switch is at the other end of each link", run: () => ({ output: columns([["Local Interface", "Parent Interface", "Chassis Id", "Port info", "System Name"], ...neighbors(s, sw).map((n) => [n.port, "-", CHASSIS[n.peer.dev as SnSw], n.port, n.peer.dev])], [19, 20, 20, 15]), explanation: "LLDP answers “what's at the other end of this cable?”. Two lines naming the same switch = two paths to it." }) },
    {
      id: "log",
      syntax: "show log messages",
      summary: "System log: links up and down",
      run: () => {
        const l = s.syslog.filter((x) => x.sw === sw && (x.ev === "up" || x.ev === "down" || x.ev === "admin-down"));
        return { output: l.length ? l.slice(-40).map((x) => `${stamp(x.clock).junos}  ${sw} mib2d[1734]: SNMP_TRAP_LINK_${x.ev === "up" ? "UP" : "DOWN"}: ifIndex ${520 + Number(N[x.port as SnPort])}, ifAdminStatus ${x.ev === "admin-down" ? "down(2)" : "up(1)"}, ifOperStatus ${x.ev === "up" ? "up(1)" : "down(2)"}, ifName ${x.port}`).join("\n") : "(no link events)", explanation: "MAC moves are in show ethernet-switching mac-learning-log." };
      },
    },
    { id: "run", syntax: "show configuration", summary: `${sw}'s committed configuration`, run: () => ({ output: snJunosText(sw, active), explanation: "Configuration only. What the switch learned is in show ethernet-switching table. Try | display set." }) },
    ...JUNOS_PATHS.map((x): CliCommand => ({ id: "run", syntax: `show configuration ${x.path}`, summary: x.summary, run: () => ({ output: snJunosText(sw, active, x.path.split(" ")) }) })),
    { id: "run", syntax: "show configuration interfaces <iface>", summary: "One port's committed configuration", args: { iface: ifArg }, run: ({ iface }) => ({ output: snJunosText(sw, active, ["interfaces", iface]) }) },
    { id: "clear", syntax: "clear ethernet-switching table", summary: "Forget every learned entry (this switch only)", run: () => (api.act({ type: "clear", sw }), { output: "", explanation: `${sw}'s learned entries are gone; static ones stay. ${otherSw(sw)} keeps its own table.` }) },
    { id: "clear", syntax: "clear ethernet-switching table interface <iface>", summary: "Forget what was learned on one port", args: { iface: ifArg }, run: ({ iface }) => (api.act({ type: "clear", sw, port: iface }), { output: "" }) },
    { id: "clear-ctr", syntax: "clear interfaces statistics all", summary: "Reset the interface counters", run: () => (api.act({ type: "clear-counters", sw }), { output: "" }) },
    { id: "hist", syntax: "show cli history", summary: "The commands you typed in this session", run: () => ({ output: [...(api.history ?? []), "show cli history"].map((x, n) => `${String(n + 1).padStart(4)}  ${x}`).join("\n") }) },
  ];
}

function junosSet(api: SnCliApi, sw: SnSw): CliCommandSet {
  const s = api.view;
  const base = { vendor: "juniper" as const, deviceId: sw, deviceName: sw };
  const op = junosOp(api, sw);
  const active = s.cfg.sw[sw];
  const cand = api.cand[sw];
  const dirty = !sameSw(cand, active);
  if (!api.junosEdit[sw]) return { ...base, prompt: `admin@${sw}> `, commands: [...op, { id: "conf", syntax: "configure", summary: "Enter configuration mode (the candidate configuration)", run: () => (!dirty && api.setCand(sw, JSON.parse(JSON.stringify(active))), api.setJunosEdit(sw, true), { output: dirty ? "Entering configuration mode\nThe configuration has been changed but not committed\n" : "Entering configuration mode\n", explanation: "Changes go into the candidate: the switch keeps running the committed configuration until you commit." }) }] };
  const ifArg: CliArgSpec = { choices: [...SN_PORTS], describe: (c) => PORT_DESC[sw][c as SnPort], resolve: (raw) => ((SN_PORTS as readonly string[]).includes(raw) ? raw : undefined) };
  const unitArg: CliArgSpec = { choices: SN_PORTS.map((p) => `${p}.0`), resolve: (raw) => (/^ge-0\/0\/\d+\.0$/.test(raw) && (SN_PORTS as readonly string[]).includes(raw.replace(/\.0$/, "")) ? raw.replace(/\.0$/, "") : undefined) };
  const set = (c: SnSwCfg) => api.setCand(sw, c);
  const commit = (quit?: boolean) => {
    setSw(api, sw, cand, "Junos commit");
    if (quit) api.setJunosEdit(sw, false);
    const willLoop = SN_PORTS.filter((p) => isUplink(p) && !cand.shut.includes(p) && s.cfg.cables[p as "ge-0/0/23"] && !snShut(s.cfg, otherSw(sw), p)).length > 1;
    return { output: quit ? "commit complete\nExiting configuration mode" : "commit complete", explanation: willLoop ? "Active now — and two uplinks to the same switch are forwarding with RSTP disabled." : "Active now." };
  };
  return {
    ...base,
    prompt: `admin@${sw}# `,
    commands: [
      { id: "set-disable", syntax: "set interfaces <iface> disable", summary: "Disable a port (after commit)", args: { iface: ifArg }, run: ({ iface }) => (set({ ...cand, shut: [...new Set([...cand.shut, iface as SnPort])] }), { output: "" }) },
      { id: "del-disable", syntax: "delete interfaces <iface> disable", summary: "Enable a port again (after commit)", args: { iface: ifArg }, run: ({ iface }) => (cand.shut.includes(iface as SnPort) ? (set({ ...cand, shut: cand.shut.filter((x) => x !== iface) }), { output: "" }) : refuse("warning: statement not found")) },
      { id: "set-static", syntax: "set vlans default switch-options interface <unit> static-mac <mac>", summary: "Pin a MAC to a port (never ages, never relearned)", args: { unit: unitArg, mac: junosMacArg(s) }, run: ({ unit, mac }) => (set({ ...cand, statics: [...cand.statics.filter((x) => x.mac !== mac), { mac, port: unit as SnPort }] }), { output: "" }) },
      { id: "del-static", syntax: "delete vlans default switch-options interface <unit> static-mac <mac>", summary: "Remove a static entry", args: { unit: unitArg, mac: { ...junosMacArg(s), choices: cand.statics.map((x) => x.mac.toLowerCase()) } }, run: ({ mac }) => (cand.statics.some((x) => x.mac === mac) ? (set({ ...cand, statics: cand.statics.filter((x) => x.mac !== mac) }), { output: "" }) : refuse("warning: statement not found")) },
      { id: "del-static", syntax: "delete vlans default switch-options", summary: "Remove every static entry", run: () => (set({ ...cand, statics: [] }), { output: "" }) },
      { id: "set-aging", syntax: "set protocols l2-learning global-mac-table-aging-time <seconds>", summary: "How long a learned entry lives without its MAC sending", args: { seconds: secondsArg }, run: ({ seconds }) => (set({ ...cand, aging: Number(seconds) }), { output: "" }) },
      { id: "del-aging", syntax: "delete protocols l2-learning", summary: "Back to the default aging time", run: () => (set({ ...cand, aging: SN_AGING }), { output: "" }) },
      { id: "rstp", syntax: "delete protocols rstp disable", summary: "", hidden: true, run: () => refuse("error: not in this lab — spanning tree is the next lesson", "Here the only way to stop a loop is to remove the extra path. RSTP does that automatically, by blocking a port.") },
      { id: "show", syntax: "show", summary: "The candidate configuration (try show | compare)", run: () => ({ output: snJunosText(sw, cand) }) },
      ...JUNOS_PATHS.map((x): CliCommand => ({ id: "show", syntax: `show ${x.path}`, summary: `${x.summary} (candidate)`, run: () => ({ output: snJunosText(sw, cand, x.path.split(" ")) }) })),
      { id: "show", syntax: "show interfaces <iface>", summary: "One port in the candidate", args: { iface: ifArg }, run: ({ iface }) => ({ output: snJunosText(sw, cand, ["interfaces", iface]) }) },
      { id: "commit", syntax: "commit", summary: "Activate the candidate configuration", run: () => commit() },
      { id: "commit", syntax: "commit check", summary: "Check the candidate without activating it", run: () => ({ output: "configuration check succeeds" }) },
      { id: "commit", syntax: "commit and-quit", summary: "Commit, then leave configuration mode", run: () => commit(true) },
      { id: "rollback", syntax: "rollback", summary: "Discard your uncommitted changes (= rollback 0)", run: () => (set(JSON.parse(JSON.stringify(active))), { output: "load complete" }) },
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

export function snSwitchSets(api: SnCliApi, sw: SnSw): Partial<Record<CliVendor, CliCommandSet>> {
  return { cisco: iosSet(api, sw), juniper: junosSet(api, sw) };
}
/** For Junos `show | compare`: the switch's configuration text under a path. */
export const snJunosConfig = (api: Pick<SnCliApi, "view" | "cand">, sw: SnSw) => (which: "committed" | number, path: string[]) => (which === "committed" || which === 0 ? snJunosText(sw, api.view.cfg.sw[sw], path) : undefined);
export { snHostAt };
