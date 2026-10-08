import type { CliArgSpec, CliCommand, CliCommandSet, CliVendor } from "@/lib/cli/types";
import { ciscoMac, columns, interfaceArg, junosMac, readOnlyBoundaryCommands } from "@/lib/cli/format";
import { PRIMARY_PORT, SECONDARY_PORT, SWF_MAC, SWF_PORTS, macName, portForwarding, type SwfFdbEntry, type SwfHost, type SwfState, type SwfSwitch } from "@/lib/sim-engine/scenarios/switchingFundamentals";

/**
 * Switching Fundamentals CLI adapter — SW1 and SW2 (both managed). Hosts never get a switch CLI.
 *
 *   lab truth (SwfState: each switch's OWN FDB, link states) → this adapter → generic parser → CLITerminal
 *
 * Every output is derived from the state passed in; SW1's and SW2's tables are separate, exactly like the lab.
 * Port naming: the lesson's canonical ports are ge-0/0/1, ge-0/0/2, ge-0/0/23 (primary SW1↔SW2) and ge-0/0/24
 * (secondary). Junos shows them as-is; Cisco shows the same ports as GigabitEthernet1/0/N (Gi1/0/N).
 * Only commands whose syntax is confidently real are offered (no Junos per-MAC lookup; no MAC-flap log — the
 * flapping is visible by running the table twice). Explanations teach what a command answers; they never diagnose.
 */

type Port = "ge-0/0/1" | "ge-0/0/2" | "ge-0/0/23" | "ge-0/0/24";
const PORTS: Port[] = ["ge-0/0/1", "ge-0/0/2", "ge-0/0/23", "ge-0/0/24"];
const n = (p: Port) => p.slice(p.lastIndexOf("/") + 1);
const CISCO_IF = Object.fromEntries(PORTS.map((p) => [p, `GigabitEthernet1/0/${n(p)}`])) as Record<Port, string>;
const CISCO_SHORT = Object.fromEntries(PORTS.map((p) => [p, `Gi1/0/${n(p)}`])) as Record<Port, string>;
const JUNOS_IF = Object.fromEntries(PORTS.map((p) => [p, p])) as Record<Port, string>;

/** Port descriptions (configured intent) per switch — taken from the lesson's port map. */
const desc = (sw: SwfSwitch): Record<Port, string> =>
  Object.fromEntries(SWF_PORTS[sw].map((p) => [p.port, p.kind === "access" ? p.peer : `${p.peer} (${p.kind})`])) as Record<Port, string>;

/** Vendor display name for a canonical lesson port (used by the lab UI too, so naming has one source). */
export function swfInterfaceAlias(vendor: CliVendor, port: string): string {
  return vendor === "cisco" ? (CISCO_SHORT[port as Port] ?? port) : (JUNOS_IF[port as Port] ?? port);
}

const EXPLAIN = {
  mac: (sw: SwfSwitch) => `This is ${sw}'s OWN table: which ${sw} port leads to each MAC. ${sw} fills it only from the SOURCE MAC of frames entering ITS ports — the other switch's table is separate and is never copied here.`,
  macFilter: "A filtered view of the same table. 'No entry' means this switch has never received a frame SOURCED by that MAC on a forwarding port (or the entry was flushed/cleared).",
  ifFilter: "Every MAC this switch has learned behind one port. Behind the SW1↔SW2 link that means 'somewhere beyond the other switch' — this switch does not know which host port.",
  status: `Link state per port. ${PRIMARY_PORT} and ${SECONDARY_PORT} both lead to the other switch; a flood leaves on every forwarding port except the one it arrived on.`,
  ifDetail: "Interface detail shows the port's state and configured description (intent). Which MACs are actually behind it is in the MAC table.",
  vlan: "This lesson has no VLANs: every port is in the default VLAN (Cisco shows VLAN 1, Junos shows 'default').",
};

const sorted = (fdb: SwfFdbEntry[]) => [...fdb].sort((a, b) => a.port.localeCompare(b.port) || a.mac.localeCompare(b.mac));
const countNote = (count: number) => (count === 0 ? " Nothing matches right now." : ` ${count} learned ${count === 1 ? "entry matches" : "entries match"} right now.`);
/** In this lesson every port is physically connected; only ge-0/0/24 is administratively disabled until the fault. */
const enabled = (s: SwfState, sw: SwfSwitch, p: Port) => portForwarding(s, sw, p);

/** IOS H.H.H MAC argument. Any well-formed MAC is accepted; the hosts' MACs are offered in `?`/Tab. */
const ciscoMacArg: CliArgSpec = {
  choices: (Object.keys(SWF_MAC) as SwfHost[]).map((h) => ciscoMac(SWF_MAC[h])),
  describe: (choice) => {
    const host = (Object.keys(SWF_MAC) as SwfHost[]).find((h) => ciscoMac(SWF_MAC[h]) === choice);
    return host ? `${host}'s MAC` : undefined;
  },
  resolve: (raw) => {
    const m = /^([0-9a-f]{4})\.([0-9a-f]{4})\.([0-9a-f]{4})$/i.exec(raw);
    if (!m) return undefined;
    return (m[1] + m[2] + m[3]).toUpperCase().match(/.{2}/g)!.join(":");
  },
};

function ciscoCommands(sw: SwfSwitch, s: SwfState): CliCommand[] {
  const d = desc(sw);
  const ifArg = { interface: interfaceArg("cisco", CISCO_IF, d) };
  const table = (entries: SwfFdbEntry[], explanation: string) => {
    const rows = sorted(entries).map((e) => ["   1", ciscoMac(e.mac), "DYNAMIC", CISCO_SHORT[e.port as Port] ?? e.port]);
    const lines = ["          Mac Address Table", "-------------------------------------------", "", columns([["Vlan", "Mac Address", "Type", "Ports"], ["----", "-----------", "--------", "-----"], ...rows], [8, 18, 12]), `Total Mac Addresses for this criterion: ${rows.length}`];
    return { output: lines.join("\n"), explanation: `${explanation}${countNote(rows.length)} ${EXPLAIN.vlan}` };
  };
  const status = () => {
    const rows = PORTS.map((p) => [CISCO_SHORT[p], d[p].replace(" (primary)", "").replace(" (secondary)", ""), enabled(s, sw, p) ? "connected" : "disabled", "1", enabled(s, sw, p) ? "a-full" : "auto", enabled(s, sw, p) ? "a-1000" : "auto", "10/100/1000BaseTX"]);
    return { output: columns([["Port", "Name", "Status", "Vlan", "Duplex", "Speed", "Type"], ...rows], [10, 10, 13, 6, 8, 8]), explanation: EXPLAIN.status };
  };
  const showIf = ({ interface: id }: Record<string, string>) => {
    const p = id as Port;
    const up = enabled(s, sw, p);
    const learned = s.fdb[sw].filter((e) => e.port === p).length;
    const lines = [
      `${CISCO_IF[p]} is ${up ? "up" : "administratively down"}, line protocol is ${up ? "up (connected)" : "down (disabled)"}`,
      "  Hardware is Gigabit Ethernet",
      `  Description: ${d[p]}`,
      "  MTU 1500 bytes, BW 1000000 Kbit/sec, DLY 10 usec",
      up ? "  Full-duplex, 1000Mb/s, media type is 10/100/1000BaseTX" : "  Auto-duplex, Auto-speed, media type is 10/100/1000BaseTX",
      "  Switchport mode access, access VLAN 1",
    ];
    return { output: lines.join("\n"), explanation: `${EXPLAIN.ifDetail} (${learned} MAC${learned === 1 ? "" : "s"} learned behind ${CISCO_SHORT[p]} on ${sw} right now.)` };
  };
  const all = () => table(s.fdb[sw], EXPLAIN.mac(sw));
  return [
    { id: "mac-table", syntax: "show mac address-table", summary: "MAC table: MAC → port", run: all },
    { id: "mac-table", syntax: "show mac-address-table", summary: "Older alias of show mac address-table", hidden: true, run: all },
    { id: "mac-table-dynamic", syntax: "show mac address-table dynamic", summary: "Dynamic (learned) entries only", run: all },
    { id: "mac-table-address", syntax: "show mac address-table address <mac>", summary: "Where this switch learned one MAC", args: { mac: ciscoMacArg }, run: ({ mac }) => table(s.fdb[sw].filter((e) => e.mac === mac), `${EXPLAIN.macFilter}${macName(mac) !== mac ? ` (${macName(mac)}'s MAC.)` : ""}`) },
    { id: "mac-table-interface", syntax: "show mac address-table interface <interface>", summary: "MACs learned behind one port", args: ifArg, run: ({ interface: id }) => table(s.fdb[sw].filter((e) => e.port === id), EXPLAIN.ifFilter) },
    { id: "interfaces-status", syntax: "show interfaces status", summary: "Port link state at a glance", run: status },
    { id: "interface-detail", syntax: "show interfaces <interface>", summary: "One port in detail", args: ifArg, run: showIf },
  ];
}

function junosCommands(sw: SwfSwitch, s: SwfState): CliCommand[] {
  const d = desc(sw);
  const ifArg = { interface: interfaceArg("juniper", JUNOS_IF, d) };
  const table = (entries: SwfFdbEntry[], explanation: string) => {
    const rows = sorted(entries).map((e) => ["   default", junosMac(e.mac), "D", "-", `${JUNOS_IF[e.port as Port] ?? e.port}.0`]);
    const lines = [
      "MAC flags (S - static MAC, D - dynamic MAC, L - locally learned)",
      "",
      `Ethernet switching table : ${rows.length} entries, ${rows.length} learned`,
      "Routing instance : default-switch",
      ...(rows.length > 0 ? [columns([["   Vlan", "MAC", "MAC", "Age", "Logical"], ["   name", "address", "flags", "", "interface"], ...rows], [13, 20, 8, 6])] : []),
    ];
    return { output: lines.join("\n"), explanation: `${explanation}${countNote(rows.length)} ${EXPLAIN.vlan}` };
  };
  const terse = () => {
    const rows: string[][] = [];
    for (const p of PORTS) {
      const up = enabled(s, sw, p) ? "up" : "down";
      rows.push([JUNOS_IF[p], up, up, ""]);
      rows.push([`${JUNOS_IF[p]}.0`, up, up, "eth-switch"]);
    }
    return { output: columns([["Interface", "Admin", "Link", "Proto"], ...rows], [24, 6, 5]), explanation: EXPLAIN.status };
  };
  const showIf = ({ interface: id }: Record<string, string>) => {
    const p = id as Port;
    const up = enabled(s, sw, p);
    const learned = s.fdb[sw].filter((e) => e.port === p).length;
    const lines = [
      `Physical interface: ${JUNOS_IF[p]}, ${up ? "Enabled" : "Administratively down"}, Physical link is ${up ? "Up" : "Down"}`,
      `  Description: ${d[p]}`,
      `  Link-level type: Ethernet, MTU: 1514, Speed: ${up ? "1000mbps" : "Auto"}`,
      "",
      `  Logical interface ${JUNOS_IF[p]}.0`,
      "    Protocol eth-switch, MTU: 1514",
      "      Interface-mode: access, VLAN: default",
    ];
    return { output: lines.join("\n"), explanation: `${EXPLAIN.ifDetail} (${learned} MAC${learned === 1 ? "" : "s"} learned behind ${JUNOS_IF[p]} on ${sw} right now.)` };
  };
  return [
    { id: "mac-table", syntax: "show ethernet-switching table", summary: "Switching table: MAC → port", run: () => table(s.fdb[sw], EXPLAIN.mac(sw)) },
    { id: "mac-table-interface", syntax: "show ethernet-switching table interface <interface>", summary: "MACs learned behind one port", args: ifArg, run: ({ interface: id }) => table(s.fdb[sw].filter((e) => e.port === id), EXPLAIN.ifFilter) },
    { id: "interfaces-status", syntax: "show interfaces terse", summary: "Port link state at a glance", run: terse },
    { id: "interface-detail", syntax: "show interfaces <interface>", summary: "One port in detail", args: ifArg, run: showIf },
  ];
}

const HELP: Record<CliVendor, Record<string, string>> = {
  cisco: {
    show: "Show running system information",
    "show mac": "MAC configuration and table",
    "show mac address-table": "MAC forwarding table",
    "show mac address-table dynamic": "Dynamic entries",
    "show mac address-table address": "Filter by MAC address (H.H.H)",
    "show mac address-table interface": "Filter by interface",
    "show interfaces": "Interface status and configuration",
    "show interfaces status": "Port status summary",
  },
  juniper: {
    show: "Show system information",
    "show ethernet-switching": "Ethernet switching information",
    "show ethernet-switching table": "Ethernet switching table",
    "show ethernet-switching table interface": "Filter by interface",
    "show interfaces": "Interface information",
    "show interfaces terse": "Brief interface summary",
  },
};

/** One switch's command set for one vendor, built from the lab state. Cheap — rebuild whenever the state changes. */
export function switchingCli(sw: SwfSwitch, vendor: CliVendor, s: SwfState): CliCommandSet {
  return {
    vendor,
    deviceId: sw,
    deviceName: sw,
    prompt: vendor === "cisco" ? `${sw}#` : `user@${sw}> `,
    commands: [...(vendor === "cisco" ? ciscoCommands(sw, s) : junosCommands(sw, s)), ...readOnlyBoundaryCommands(vendor)],
    help: HELP[vendor],
  };
}

export function switchingCliSets(sw: SwfSwitch, s: SwfState): Record<CliVendor, CliCommandSet> {
  return { cisco: switchingCli(sw, "cisco", s), juniper: switchingCli(sw, "juniper", s) };
}
