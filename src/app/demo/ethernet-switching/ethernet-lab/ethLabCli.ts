import type { CliArgSpec, CliCommand, CliCommandSet, CliVendor } from "@/lib/cli/types";
import { ciscoMac, columns, interfaceArg } from "@/lib/cli/format";
import { ETH_MAC, FDB_AGING_SEC, SW1_PORTS, macName, type EthHost } from "@/lib/sim-engine/scenarios/ethernetSwitching";
import { ETH_DEFAULT_CFG, portCable, portNeighbor, swTable, type EthLabAction, type EthLabCfg, type EthLabState } from "@/lib/sim-engine/scenarios/ethernetLab";
import { junosCompare } from "@/app/demo/dhcp-dns/dhcp-lab/cliPipes";
import type { CliQuestion } from "@/app/demo/dhcp-dns/dhcp-lab/dhcpBuildCli";

/**
 * SW1's command line in the Ethernet Lab: the one managed switch, as Cisco IOS or Junos. Every output is generated
 * from the lab state the topology, the tables, the captures and the tickets use (swTable, counters, links, moves,
 * configuration), and every change goes through a lab action, so the network follows it at once (IOS: on Enter;
 * Junos: on commit). DESK-SW is unmanaged (no CLI) and hosts have no switch CLI.
 *
 * Ethernet only: MAC table and its filters, interfaces and counters, logging (MAC moves), clearing learned entries,
 * static entries, the aging time and shutting a port. No VLAN design (that is the Switching lessons), no IP.
 */

export type EthPort = (typeof SW1_PORTS)[number];
export type EthCiscoMode = { kind: "exec" } | { kind: "config" } | { kind: "if"; port: EthPort };
export type EthJunosMode = "op" | "edit";
export interface EthCommit {
  cfg: EthLabCfg;
  at: number;
  by: string;
  comment?: string;
}
export interface EthCliApi {
  lab: EthLabState;
  act: (a: EthLabAction) => void;
  cisco: EthCiscoMode;
  setCisco: (m: EthCiscoMode) => void;
  junosMode: EthJunosMode;
  setJunosMode: (m: EthJunosMode) => void;
  /** The Junos candidate configuration and the commit history ([0] = active = rollback 0). */
  cand: EthLabCfg;
  setCand: (c: EthLabCfg) => void;
  hist: EthCommit[];
  commit: (c: EthLabCfg, comment?: string) => void;
  history?: string[];
  ask?: (q: CliQuestion | undefined) => void;
}

export const CISCO_IF: Record<EthPort, string> = { "ge-0/0/1": "GigabitEthernet1/0/1", "ge-0/0/2": "GigabitEthernet1/0/2", "ge-0/0/3": "GigabitEthernet1/0/3", "ge-0/0/4": "GigabitEthernet1/0/4" };
export const CISCO_SHORT: Record<EthPort, string> = { "ge-0/0/1": "Gi1/0/1", "ge-0/0/2": "Gi1/0/2", "ge-0/0/3": "Gi1/0/3", "ge-0/0/4": "Gi1/0/4" };
/** Port descriptions: configured intent (who is SUPPOSED to be there), not the learned table. */
export const PORT_DESC: Record<EthPort, string> = { "ge-0/0/1": "HOST-A", "ge-0/0/2": "HOST-B", "ge-0/0/3": "HOST-C", "ge-0/0/4": "DESK-SW" };
/** The name of a SW1 port in each OS (Cisco short form, as its MAC table prints it; Junos interface name). */
export const ethPortName = (vendor: CliVendor, port: string) => (vendor === "cisco" ? (CISCO_SHORT[port as EthPort] ?? port) : port);
/** Lab text (the event log, written with the model's port names) in the OS view the student picked. */
export const ethVendorText = (vendor: CliVendor, text: string) => (vendor === "cisco" ? text.replace(/\bge-0\/0\/([1-4])\b/g, "Gi1/0/$1") : text);

const refuse = (output: string, explanation?: string) => ({ output, refused: true, explanation });
const anyArg: CliArgSpec = { choices: [], resolve: (raw) => raw };
const HOSTS = Object.keys(ETH_MAC) as EthHost[];
const ciscoMacArg: CliArgSpec = {
  choices: HOSTS.map((h) => ciscoMac(ETH_MAC[h])),
  describe: (c) => {
    const h = HOSTS.find((x) => ciscoMac(ETH_MAC[x]) === c);
    return h ? `${h}'s burned-in MAC` : undefined;
  },
  resolve: (raw) => {
    const m = /^([0-9a-f]{4})\.([0-9a-f]{4})\.([0-9a-f]{4})$/i.exec(raw);
    return m ? (m[1] + m[2] + m[3]).toUpperCase().match(/.{2}/g)!.join(":") : undefined;
  },
};
const junosMacArg: CliArgSpec = {
  choices: HOSTS.map((h) => ETH_MAC[h].toLowerCase()),
  describe: (c) => {
    const h = HOSTS.find((x) => ETH_MAC[x].toLowerCase() === c);
    return h ? `${h}'s burned-in MAC` : undefined;
  },
  resolve: (raw) => (/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(raw) ? raw.toUpperCase() : undefined),
};
const secondsArg: CliArgSpec = { choices: ["300"], describe: () => "seconds (10–1000000; default 300)", resolve: (raw) => (/^\d+$/.test(raw) && Number(raw) >= 10 && Number(raw) <= 1000000 ? raw : undefined) };
const prefixed = (cmds: CliCommand[], word: "do" | "run"): CliCommand[] => cmds.map((c) => ({ ...c, id: `${word}:${c.id}`, syntax: `${word} ${c.syntax}` }));
const BOOT = Date.now() - 3_600_000;
const when = (at: number) => new Date(at || BOOT).toISOString().replace("T", " ").slice(0, 19) + " UTC";
const sameCfg = (a: EthLabCfg, b: EthLabCfg) => JSON.stringify([a.aging, [...a.statics].map((x) => `${x.mac}@${x.port}`).sort(), [...a.shut].sort()]) === JSON.stringify([b.aging, [...b.statics].map((x) => `${x.mac}@${x.port}`).sort(), [...b.shut].sort()]);

// ---------------------------------------------------------------------------------------------------------------
// Configuration as each OS prints it
// ---------------------------------------------------------------------------------------------------------------
export function iosRunning(cfg: EthLabCfg, port?: EthPort): string {
  const iface = (p: EthPort) => [`interface ${CISCO_IF[p]}`, ` description ${PORT_DESC[p]}`, " switchport mode access", ...(cfg.shut.includes(p) ? [" shutdown"] : []), "!"];
  if (port) return ["Building configuration...", "", "Current configuration : 120 bytes", "!", ...iface(port).slice(0, -1), "end"].join("\n");
  const body = ["hostname SW1", "!", ...(cfg.aging !== FDB_AGING_SEC ? [`mac address-table aging-time ${cfg.aging}`] : []), ...cfg.statics.map((x) => `mac address-table static ${ciscoMac(x.mac)} vlan 1 interface ${CISCO_IF[x.port as EthPort]}`), ...(cfg.aging !== FDB_AGING_SEC || cfg.statics.length ? ["!"] : []), ...SW1_PORTS.flatMap(iface), "end"];
  return `Building configuration...\n\nCurrent configuration : ${body.join("\n").length} bytes\n!\n${body.join("\n")}`;
}
interface JNode {
  name: string;
  kids?: JNode[];
}
function junosTree(cfg: EthLabCfg): JNode[] {
  const statics = cfg.statics.map((x) => ({ name: `interface ${x.port}.0`, kids: [{ name: `static-mac ${x.mac.toLowerCase()}` }] }));
  return [
    { name: "system", kids: [{ name: "host-name SW1" }] },
    { name: "interfaces", kids: SW1_PORTS.map((p) => ({ name: p, kids: [...(cfg.shut.includes(p) ? [{ name: "disable" }] : []), { name: `description ${PORT_DESC[p]}` }, { name: "unit 0", kids: [{ name: "family ethernet-switching" }] }] })) },
    ...(cfg.aging !== FDB_AGING_SEC ? [{ name: "protocols", kids: [{ name: "l2-learning", kids: [{ name: `global-mac-table-aging-time ${cfg.aging}` }] }] }] : []),
    { name: "vlans", kids: [{ name: "default", kids: [{ name: "vlan-id 1" }, ...(statics.length ? [{ name: "switch-options", kids: statics }] : [])] }] },
  ];
}
const render = (nodes: JNode[], d = 0): string[] => nodes.flatMap((n) => (n.kids ? [`${"    ".repeat(d)}${n.name} {`, ...render(n.kids, d + 1), `${"    ".repeat(d)}}`] : [`${"    ".repeat(d)}${n.name};`]));
export function junosText(cfg: EthLabCfg, path: string[] = []): string {
  let nodes = junosTree(cfg);
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
export const JUNOS_PATHS = [
  { path: "interfaces", summary: "Ports: descriptions and which are disabled" },
  { path: "vlans", summary: "The default VLAN and its static MAC entries" },
  { path: "protocols", summary: "Layer-2 learning settings (the aging time, when changed)" },
  { path: "system", summary: "Host name" },
];

// ---------------------------------------------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------------------------------------------
const EXPLAIN = {
  table: "This table answers: which port leads to this MAC? SW1 fills it only from the SOURCE MAC of frames entering its ports. Static entries are configured; dynamic ones are learned and age out.",
  status: "Link state per port. A MAC can only be learned on a port that is up; a port going down flushes what was learned on it. A link coming up teaches nothing.",
  counters: "Frames this port received (input) and sent (output) since the lab started, and how many were broadcasts. They prove traffic crossed the port, and in which direction.",
  logging: "Moves of a MAC between ports. One move is a host that moved; a MAC moving back and forth (flapping) means two devices use the same MAC, or a loop.",
};
const up = (s: EthLabState, p: EthPort) => !!portNeighbor(s, "SW1", p);
const ctr = (s: EthLabState, p: EthPort) => s.counters[`SW1 ${p}`];

// ---------------------------------------------------------------------------------------------------------------
// Cisco IOS
// ---------------------------------------------------------------------------------------------------------------
function ciscoExec(api: EthCliApi): CliCommand[] {
  const s = api.lab;
  const ifArg = { interface: interfaceArg("cisco", CISCO_IF, PORT_DESC) };
  const table = (rows: ReturnType<typeof swTable>, note: string) => {
    const lines = ["          Mac Address Table", "-------------------------------------------", "", columns([["Vlan", "Mac Address", "Type", "Ports"], ["----", "-----------", "--------", "-----"], ...rows.map((e) => ["   1", ciscoMac(e.mac), e.type === "static" ? "STATIC" : "DYNAMIC", CISCO_SHORT[e.port as EthPort] ?? e.port])], [8, 18, 12]), `Total Mac Addresses for this criterion: ${rows.length}`];
    return { output: lines.join("\n"), explanation: note };
  };
  const all = swTable(s, "SW1");
  const showIf = ({ interface: id }: Record<string, string>) => {
    const p = id as EthPort;
    const c = ctr(s, p);
    const admin = s.cfg.shut.includes(p);
    const lines = [
      `${CISCO_IF[p]} is ${admin ? "administratively down" : up(s, p) ? "up" : "down"}, line protocol is ${up(s, p) ? "up (connected)" : admin ? "down (disabled)" : "down (notconnect)"}`,
      "  Hardware is Gigabit Ethernet",
      `  Description: ${PORT_DESC[p]}`,
      up(s, p) ? "  Full-duplex, 1000Mb/s, media type is 10/100/1000BaseTX" : "  Auto-duplex, Auto-speed, media type is 10/100/1000BaseTX",
      `     ${c.inFrames} packets input`,
      `     Received ${c.inBcast} broadcasts (0 multicasts)`,
      `     ${c.outFrames} packets output`,
      `     ${c.outBcast} broadcasts sent`,
    ];
    return { output: lines.join("\n"), explanation: `${EXPLAIN.counters} The description is intent (who should be there); the MAC table says who actually is.` };
  };
  const flaps = s.moves.filter((m) => m.sw === "SW1");
  return [
    { id: "mac-table", syntax: "show mac address-table", summary: "MAC table: MAC → port (static and learned)", run: () => table(all, EXPLAIN.table) },
    { id: "mac-table", syntax: "show mac address-table dynamic", summary: "Learned entries only", run: () => table(all.filter((e) => e.type === "dynamic"), "Only what SW1 learned from source MACs. Each entry disappears after the aging time unless that MAC sends again.") },
    { id: "mac-table", syntax: "show mac address-table static", summary: "Configured (static) entries only", run: () => table(all.filter((e) => e.type === "static"), "Static entries never age and are never relearned: if the device moves, a static entry keeps pointing at the old port.") },
    { id: "mac-table", syntax: "show mac address-table address <mac>", summary: "Where SW1 knows one MAC", args: { mac: ciscoMacArg }, run: ({ mac }) => table(all.filter((e) => e.mac === mac), `No entry means SW1 has not seen ${macName(mac)} as a SOURCE (or it aged out / was flushed): frames to it will be flooded.`) },
    { id: "mac-table", syntax: "show mac address-table interface <interface>", summary: "MACs SW1 knows behind one port", args: ifArg, run: ({ interface: p }) => table(all.filter((e) => e.port === p), "Several MACs behind one port is normal when another switch (DESK-SW) sits there.") },
    { id: "mac-count", syntax: "show mac address-table count", summary: "How many entries", run: () => ({ output: [`Mac Entries for Vlan 1:`, "---------------------------", `Dynamic Address Count  : ${all.filter((e) => e.type === "dynamic").length}`, `Static  Address Count  : ${all.filter((e) => e.type === "static").length}`, `Total Mac Addresses    : ${all.length}`].join("\n") }) },
    { id: "mac-aging", syntax: "show mac address-table aging-time", summary: "Dynamic-entry aging time", run: () => ({ output: `Global Aging Time: ${s.cfg.aging}\nVlan    Aging Time\n----    ----------\n   1    ${s.cfg.aging}`, explanation: `A learned entry is removed after ${s.cfg.aging} s without a frame SOURCED by that MAC. Receiving frames doesn't keep it alive.` }) },
    { id: "if-status", syntax: "show interfaces status", summary: "Link state of every port", run: () => ({ output: columns([["Port", "Name", "Status", "Vlan", "Duplex", "Speed", "Type"], ...SW1_PORTS.map((p) => [CISCO_SHORT[p], PORT_DESC[p], s.cfg.shut.includes(p) ? "disabled" : up(s, p) ? "connected" : "notconnect", "1", up(s, p) ? "a-full" : "auto", up(s, p) ? "a-1000" : "auto", "10/100/1000BaseTX"])], [10, 10, 13, 6, 8, 8]), explanation: EXPLAIN.status }) },
    { id: "if-detail", syntax: "show interfaces <interface>", summary: "One port: link, description and counters", args: ifArg, run: showIf },
    { id: "run", syntax: "show running-config", summary: "SW1's configuration", run: () => ({ output: iosRunning(s.cfg), explanation: "Configuration only: descriptions, shut ports, static MAC entries and the aging time if changed. What SW1 has LEARNED is not configuration — it is in show mac address-table." }) },
    { id: "run", syntax: "show running-config interface <interface>", summary: "One port's configuration", args: ifArg, run: ({ interface: p }) => ({ output: iosRunning(s.cfg, p as EthPort) }) },
    {
      id: "logging",
      syntax: "show logging",
      summary: "The log: MAC moves between ports",
      run: () => ({
        output: ["Syslog logging: enabled", "", "Log Buffer:", ...(flaps.length ? flaps.map((m) => (m.flap ? `%SW_MATM-4-MACFLAP_NOTIF: Host ${ciscoMac(m.mac)} in vlan 1 is flapping between port ${CISCO_SHORT[m.from as EthPort] ?? m.from} and port ${CISCO_SHORT[m.to as EthPort] ?? m.to}` : `%SW_MATM-6-MACMOVE: Host ${ciscoMac(m.mac)} moved from port ${CISCO_SHORT[m.from as EthPort] ?? m.from} to port ${CISCO_SHORT[m.to as EthPort] ?? m.to}`)) : ["(no messages)"])].join("\n"),
        explanation: EXPLAIN.logging,
      }),
    },
    { id: "clear", syntax: "clear mac address-table dynamic", summary: "Forget every learned entry", run: () => (api.act({ type: "clear" }), { output: "", explanation: "Learned entries are gone; statics stay. Frames to unknown MACs are flooded until the hosts send again." }) },
    { id: "clear", syntax: "clear mac address-table dynamic address <mac>", summary: "Forget one learned entry", args: { mac: ciscoMacArg }, run: ({ mac }) => (api.act({ type: "clear", mac }), { output: "", explanation: `${macName(mac)} is unknown to SW1 until it sends a frame again; frames to it are flooded meanwhile.` }) },
    { id: "clear", syntax: "clear mac address-table dynamic interface <interface>", summary: "Forget what was learned on one port", args: ifArg, run: ({ interface: p }) => (api.act({ type: "clear", port: p }), { output: "" }) },
    { id: "hist", syntax: "show history", summary: "The commands you typed in this session", run: () => ({ output: [...(api.history ?? []), "show history"].map((x) => `  ${x}`).join("\n") }) },
  ];
}

function r1Cisco(api: EthCliApi): CliCommandSet {
  const s = api.lab;
  const exec = ciscoExec(api);
  const ifArg = { interface: interfaceArg("cisco", CISCO_IF, PORT_DESC) };
  const base = { vendor: "cisco" as const, deviceId: "SW1", deviceName: "SW1" };
  const setCfg = (cfg: EthLabCfg, line: string) => api.act({ type: "config", cfg, line });
  const end: CliCommand = { id: "end", syntax: "end", summary: "Leave configuration mode", run: () => (api.setCisco({ kind: "exec" }), { output: "%SYS-5-CONFIG_I: Configured from console by console" }) };
  if (api.cisco.kind === "exec")
    return {
      ...base,
      prompt: "SW1#",
      commands: [
        ...exec,
        { id: "conf", syntax: "configure terminal", summary: "Enter configuration mode", run: () => (api.setCisco({ kind: "config" }), { output: "Enter configuration commands, one per line.  End with CNTL/Z." }) },
        { id: "conf", syntax: "conf t", summary: "", hidden: true, run: () => (api.setCisco({ kind: "config" }), { output: "Enter configuration commands, one per line.  End with CNTL/Z." }) },
      ],
    };
  const doCmds = prefixed(exec, "do");
  if (api.cisco.kind === "config")
    return {
      ...base,
      prompt: "SW1(config)#",
      commands: [
        { id: "if", syntax: "interface <interface>", summary: "Configure one port", args: ifArg, run: ({ interface: p }) => (api.setCisco({ kind: "if", port: p as EthPort }), { output: "" }) },
        {
          id: "static",
          syntax: "mac address-table static <mac> vlan <vlan> interface <interface>",
          summary: "Pin a MAC to a port (never ages, never relearned)",
          args: { mac: ciscoMacArg, vlan: { choices: ["1"], describe: () => "the only VLAN here", resolve: (r) => (r === "1" ? r : undefined) }, ...ifArg },
          run: ({ mac, interface: p }) => (setCfg({ ...s.cfg, statics: [...s.cfg.statics.filter((x) => x.mac !== mac), { mac, port: p }] }, `mac address-table static ${ciscoMac(mac)} vlan 1 interface ${CISCO_IF[p as EthPort]}`), { output: "", explanation: "Active at once: SW1 now sends frames for this MAC out that port, whatever the MAC's sender does." }),
        },
        {
          id: "nostatic",
          syntax: "no mac address-table static <mac> vlan <vlan>",
          summary: "Remove a static entry",
          args: { mac: { ...ciscoMacArg, choices: s.cfg.statics.map((x) => ciscoMac(x.mac)) }, vlan: { choices: ["1"], resolve: (r) => (r === "1" ? r : undefined) } },
          run: ({ mac }) => (s.cfg.statics.some((x) => x.mac === mac) ? (setCfg({ ...s.cfg, statics: s.cfg.statics.filter((x) => x.mac !== mac) }, `no mac address-table static ${ciscoMac(mac)} vlan 1`), { output: "" }) : refuse("% Static entry not found")),
        },
        { id: "aging", syntax: "mac address-table aging-time <seconds>", summary: "How long a learned entry lives without its MAC sending", args: { seconds: secondsArg }, run: ({ seconds }) => (setCfg({ ...s.cfg, aging: Number(seconds) }, `mac address-table aging-time ${seconds}`), { output: "" }) },
        { id: "noaging", syntax: "no mac address-table aging-time", summary: "Back to the default aging time (300 s)", run: () => (setCfg({ ...s.cfg, aging: FDB_AGING_SEC }, "no mac address-table aging-time"), { output: "" }) },
        { id: "exit", syntax: "exit", summary: "Back to privileged mode", run: () => (api.setCisco({ kind: "exec" }), { output: "" }) },
        end,
        ...doCmds,
      ],
    };
  const p = api.cisco.port;
  return {
    ...base,
    prompt: "SW1(config-if)#",
    commands: [
      { id: "shut", syntax: "shutdown", summary: "Disable this port (link goes down)", run: () => (setCfg({ ...s.cfg, shut: [...new Set([...s.cfg.shut, p])] }, `interface ${CISCO_IF[p]} · shutdown`), { output: `%LINK-5-CHANGED: Interface ${CISCO_IF[p]}, changed state to administratively down` }) },
      { id: "noshut", syntax: "no shutdown", summary: "Enable this port", run: () => (setCfg({ ...s.cfg, shut: s.cfg.shut.filter((x) => x !== p) }, `interface ${CISCO_IF[p]} · no shutdown`), { output: portCable(s, "SW1", p) ? `%LINK-3-UPDOWN: Interface ${CISCO_IF[p]}, changed state to up` : "" }) },
      { id: "if", syntax: "interface <interface>", summary: "Move to another port", args: ifArg, run: ({ interface: q }) => (api.setCisco({ kind: "if", port: q as EthPort }), { output: "" }) },
      { id: "exit", syntax: "exit", summary: "Back to global configuration", run: () => (api.setCisco({ kind: "config" }), { output: "" }) },
      end,
      ...doCmds,
      { id: "desc", syntax: "description <text>", summary: "", hidden: true, args: { text: anyArg }, run: () => refuse("% Not available in this lab: the descriptions record which host belongs on each port.") },
    ],
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Junos (EX, ELS syntax)
// ---------------------------------------------------------------------------------------------------------------
function junosOp(api: EthCliApi): CliCommand[] {
  const s = api.lab;
  const ifArg: CliArgSpec = { choices: [...SW1_PORTS], describe: (c) => `towards ${PORT_DESC[c as EthPort]}`, resolve: (raw) => (SW1_PORTS as readonly string[]).includes(raw.replace(/\.0$/, "")) ? raw.replace(/\.0$/, "") : undefined };
  const all = swTable(s, "SW1");
  const table = (rows: typeof all) => ({
    output: [
      "MAC flags (S - static MAC, D - dynamic MAC, L - locally learned, P - Persistent static",
      "           SE - statistics enabled, NM - non configured MAC, R - remote PE MAC, O - ovsdb MAC)",
      "",
      `Ethernet switching table : ${rows.length} entries, ${rows.filter((e) => e.type === "dynamic").length} learned`,
      "Routing instance : default-switch",
      columns([["   Vlan", "MAC", "MAC", "Age", "Logical"], ["   name", "address", "flags", "", "interface"], ...rows.map((e) => ["   default", e.mac.toLowerCase(), e.type === "static" ? "S" : "D", "-", `${e.port}.0`])], [13, 20, 8, 6]),
    ].join("\n"),
    explanation: EXPLAIN.table,
  });
  const showIf = ({ iface }: Record<string, string>) => {
    const p = iface as EthPort;
    const c = ctr(s, p);
    const admin = s.cfg.shut.includes(p);
    return {
      output: [`Physical interface: ${p}, ${admin ? "Administratively down" : "Enabled"}, Physical link is ${up(s, p) ? "Up" : "Down"}`, `  Description: ${PORT_DESC[p]}`, "  Link-level type: Ethernet, MTU: 1514, Speed: 1000mbps", "  Traffic statistics:", `   Input  packets:            ${c.inFrames}`, `   Output packets:            ${c.outFrames}`, `   Input broadcasts:          ${c.inBcast}`, `   Output broadcasts:         ${c.outBcast}`].join("\n"),
      explanation: EXPLAIN.counters,
    };
  };
  const active = api.hist[0].cfg;
  const rbArg: CliArgSpec = { choices: api.hist.map((_, n) => String(n)), resolve: (r) => (/^\d+$/.test(r) ? r : undefined), describe: (n) => `${when(api.hist[Number(n)].at)}${api.hist[Number(n)].comment ? ` (${api.hist[Number(n)].comment})` : ""}` };
  return [
    { id: "mac-table", syntax: "show ethernet-switching table", summary: "Switching table: MAC → port (static and learned)", run: () => table(all) },
    { id: "mac-table", syntax: "show ethernet-switching table interface <iface>", summary: "MACs SW1 knows behind one port", args: { iface: ifArg }, run: ({ iface }) => table(all.filter((e) => e.port === iface)) },
    {
      id: "mac-log",
      syntax: "show ethernet-switching mac-learning-log",
      summary: "MAC moves between ports (the learning log)",
      run: () => {
        const mv = s.moves.filter((m) => m.sw === "SW1");
        return {
          output: mv.length ? mv.map((m) => `${when(BOOT + (m.clock + 1) * 1000)}  vlan_name default mac ${m.mac.toLowerCase()} was moved from ${m.from}.0 to ${m.to}.0${m.flap ? " (moving back and forth)" : ""}`).join("\n") : "No MAC moves recorded.",
          explanation: "A MAC learned on a new port replaces its old entry. One move: the host moved. Back and forth: two network cards share the MAC, or there is a loop.",
        };
      },
    },
    { id: "mac-global", syntax: "show ethernet-switching global-information", summary: "Learning settings, including the aging time", run: () => ({ output: ["Global Configuration:", "", `MAC aging interval    : ${s.cfg.aging}`, "MAC learning          : Enabled", "MAC statistics        : Disabled", "MAC limit Count       : 294912"].join("\n"), explanation: `A learned entry is removed after ${s.cfg.aging} s without a frame SOURCED by that MAC.` }) },
    { id: "if-status", syntax: "show interfaces terse", summary: "Link state of every port", run: () => ({ output: columns([["Interface", "Admin", "Link", "Proto"], ...SW1_PORTS.flatMap((p) => [[p, s.cfg.shut.includes(p) ? "down" : "up", up(s, p) ? "up" : "down", ""], [`${p}.0`, s.cfg.shut.includes(p) ? "down" : "up", up(s, p) ? "up" : "down", "eth-switch"]])], [16, 6, 6]), explanation: EXPLAIN.status }) },
    { id: "if-detail", syntax: "show interfaces <iface>", summary: "One port: link, description and counters", args: { iface: ifArg }, run: showIf },
    { id: "run", syntax: "show configuration", summary: "SW1's committed configuration", run: () => ({ output: junosText(active), explanation: "Configuration only. What SW1 learned is in show ethernet-switching table. Try | display set." }) },
    ...JUNOS_PATHS.map((x): CliCommand => ({ id: "run", syntax: `show configuration ${x.path}`, summary: x.summary, run: () => { const t = junosText(active, x.path.split(" ")); return { output: t, explanation: t ? undefined : `Nothing is configured under ${x.path} — Junos prints an empty hierarchy as nothing. (${x.path === "protocols" ? "The aging time is the default, so there is no l2-learning statement." : "Defaults apply."})` }; } })),
    { id: "commits", syntax: "show system commit", summary: "The commit history (rollback numbers)", run: () => ({ output: api.hist.map((c, n) => `${String(n).padEnd(4)}${when(c.at)} by ${c.by} via ${n === api.hist.length - 1 ? "other" : "cli"}${c.comment ? `\n    ${c.comment}` : ""}`).join("\n") }) },
    { id: "rb", syntax: "show system rollback <n>", summary: "A configuration from the history", args: { n: rbArg }, run: ({ n }) => (api.hist[Number(n)] ? { output: junosText(api.hist[Number(n)].cfg) } : refuse(`error: rollback ${n} does not exist`)) },
    { id: "clear", syntax: "clear ethernet-switching table", summary: "Forget every learned entry", run: () => (api.act({ type: "clear" }), { output: "", explanation: "Learned entries are gone; static ones stay. Frames to unknown MACs are flooded until hosts send again." }) },
    { id: "clear", syntax: "clear ethernet-switching table interface <iface>", summary: "Forget what was learned on one port", args: { iface: ifArg }, run: ({ iface }) => (api.act({ type: "clear", port: iface }), { output: "" }) },
    { id: "hist", syntax: "show cli history", summary: "The commands you typed in this session", run: () => ({ output: [...(api.history ?? []), "show cli history"].map((x, n) => `${String(n + 1).padStart(4)}  ${x}`).join("\n") }) },
  ];
}

function swJunos(api: EthCliApi): CliCommandSet {
  const base = { vendor: "juniper" as const, deviceId: "SW1", deviceName: "SW1" };
  const op = junosOp(api);
  const active = api.hist[0].cfg;
  const cand = api.cand;
  const dirty = !sameCfg(cand, active);
  if (api.junosMode === "op")
    return {
      ...base,
      prompt: "admin@SW1> ",
      commands: [
        ...op,
        { id: "conf", syntax: "configure", summary: "Enter configuration mode (the candidate configuration)", run: () => (!dirty && api.setCand(active), api.setJunosMode("edit"), { output: dirty ? "Entering configuration mode\nThe configuration has been changed but not committed\n" : "Entering configuration mode\n", explanation: "Changes go into the candidate: SW1 keeps running the committed configuration until you commit." }) },
      ],
    };
  const ifArg: CliArgSpec = { choices: [...SW1_PORTS], describe: (c) => `towards ${PORT_DESC[c as EthPort]}`, resolve: (raw) => ((SW1_PORTS as readonly string[]).includes(raw) ? raw : undefined) };
  const unitArg: CliArgSpec = { choices: SW1_PORTS.map((p) => `${p}.0`), resolve: (raw) => (/^ge-0\/0\/[1-4]\.0$/.test(raw) ? raw.replace(/\.0$/, "") : undefined) };
  const set = (c: typeof cand) => api.setCand(c);
  const rbArg: CliArgSpec = { choices: api.hist.map((_, n) => String(n)), resolve: (r) => (/^\d+$/.test(r) ? r : undefined), describe: (n) => `${when(api.hist[Number(n)].at)}${api.hist[Number(n)].comment ? ` (${api.hist[Number(n)].comment})` : ""}` };
  const commit = (comment?: string, quit?: boolean) => {
    api.commit(cand, comment);
    if (quit) api.setJunosMode("op");
    return { output: quit ? "commit complete\nExiting configuration mode" : "commit complete", explanation: "Active now. It is rollback 0 in show system commit." };
  };
  return {
    ...base,
    prompt: "admin@SW1# ",
    commands: [
      { id: "set-disable", syntax: "set interfaces <iface> disable", summary: "Disable a port (link goes down after commit)", args: { iface: ifArg }, run: ({ iface }) => (set({ ...cand, shut: [...new Set([...cand.shut, iface])] }), { output: "" }) },
      { id: "del-disable", syntax: "delete interfaces <iface> disable", summary: "Enable a port again", args: { iface: ifArg }, run: ({ iface }) => (cand.shut.includes(iface) ? (set({ ...cand, shut: cand.shut.filter((x) => x !== iface) }), { output: "" }) : refuse("warning: statement not found")) },
      {
        id: "set-static",
        syntax: "set vlans default switch-options interface <unit> static-mac <mac>",
        summary: "Pin a MAC to a port (never ages, never relearned)",
        args: { unit: unitArg, mac: junosMacArg },
        run: ({ unit, mac }) => (set({ ...cand, statics: [...cand.statics.filter((x) => x.mac !== mac), { mac, port: unit }] }), { output: "" }),
      },
      { id: "del-static", syntax: "delete vlans default switch-options interface <unit> static-mac <mac>", summary: "Remove a static entry", args: { unit: unitArg, mac: { ...junosMacArg, choices: cand.statics.map((x) => x.mac.toLowerCase()) } }, run: ({ mac }) => (cand.statics.some((x) => x.mac === mac) ? (set({ ...cand, statics: cand.statics.filter((x) => x.mac !== mac) }), { output: "" }) : refuse("warning: statement not found")) },
      { id: "del-static", syntax: "delete vlans default switch-options", summary: "Remove every static entry", run: () => (set({ ...cand, statics: [] }), { output: "" }) },
      { id: "set-aging", syntax: "set protocols l2-learning global-mac-table-aging-time <seconds>", summary: "How long a learned entry lives without its MAC sending", args: { seconds: secondsArg }, run: ({ seconds }) => (set({ ...cand, aging: Number(seconds) }), { output: "" }) },
      { id: "del-aging", syntax: "delete protocols l2-learning", summary: "Back to the default aging time", run: () => (set({ ...cand, aging: FDB_AGING_SEC }), { output: "" }) },
      { id: "show", syntax: "show", summary: "The candidate configuration (try show | compare)", run: () => ({ output: junosText(cand) }) },
      ...JUNOS_PATHS.map((x): CliCommand => ({ id: "show", syntax: `show ${x.path}`, summary: `${x.summary} (candidate)`, run: () => { const t = junosText(cand, x.path.split(" ")); return { output: t, explanation: t ? undefined : `Nothing under ${x.path} in the candidate — an empty hierarchy prints nothing.` }; } })),
      { id: "commit", syntax: "commit", summary: "Activate the candidate configuration", run: () => commit() },
      { id: "commit", syntax: "commit check", summary: "Check the candidate without activating it", run: () => ({ output: "configuration check succeeds" }) },
      { id: "commit", syntax: "commit and-quit", summary: "Commit, then leave configuration mode", run: () => commit(undefined, true) },
      { id: "commit", syntax: "commit comment <text>", summary: "Commit with a note (one word, or quoted)", args: { text: anyArg }, run: ({ text }) => commit(text.replace(/^"|"$/g, "")) },
      { id: "rollback", syntax: "rollback", summary: "Discard your uncommitted changes (= rollback 0)", run: () => (set(active), { output: "load complete" }) },
      { id: "rollback", syntax: "rollback <n>", summary: "Load an earlier committed configuration into the candidate", args: { n: rbArg }, run: ({ n }) => (api.hist[Number(n)] ? (set(api.hist[Number(n)].cfg), { output: "load complete", explanation: "Only the candidate changed: show | compare, then commit." }) : refuse(`error: rollback ${n} does not exist`)) },
      ...prefixed(op, "run"),
      {
        id: "exit",
        syntax: "exit",
        summary: "Leave configuration mode",
        run: () => {
          if (!dirty || !api.ask) return (api.setJunosMode("op"), { output: "Exiting configuration mode" });
          api.ask({
            node: "SW1",
            prompt: "The configuration has been changed but not committed\nExit with uncommitted changes? [yes,no] (yes) ",
            answer: (line) => {
              api.ask?.(undefined);
              if (/^n(o)?$/i.test(line.trim())) return { output: "" };
              api.setJunosMode("op");
              return { output: "Exiting configuration mode" };
            },
            cancel: () => (api.ask?.(undefined), ""),
          });
          return { output: "" };
        },
      },
    ],
  };
}

export function ethSw1CliSets(api: EthCliApi): Partial<Record<CliVendor, CliCommandSet>> {
  return { cisco: r1Cisco(api), juniper: swJunos(api) };
}
/** For Junos `show | compare` and `compare rollback n`: SW1's configuration text under a path. */
export const ethJunosConfig = (api: Pick<EthCliApi, "hist">) => (which: "committed" | number, path: string[]) => {
  const e = which === "committed" ? api.hist[0] : api.hist[which];
  return e ? junosText(e.cfg, path) : undefined;
};
export { junosCompare, ETH_DEFAULT_CFG };
