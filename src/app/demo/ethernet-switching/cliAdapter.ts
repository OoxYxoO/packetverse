import type { CliArgSpec, CliCommand, CliCommandSet, CliVendor } from "@/lib/cli/types";
import { ciscoMac, columns, interfaceArg, junosMac, readOnlyBoundaryCommands } from "@/lib/cli/format";
import { ETH_MAC, FDB_AGING_SEC, SW1_PORTS, macName, sw1PortNeighbor, type EthHost, type EthState, type FdbEntry } from "@/lib/sim-engine/scenarios/ethernetSwitching";

/**
 * Ethernet & Switching CLI adapter — SW1 only (the one managed switch). DESK-SW is unmanaged (no management
 * plane, so no CLI) and hosts never get a switch CLI.
 *
 *   lab truth (EthState: SW1 FDB, port links, lab clock) → this adapter → generic parser → CLITerminal
 *
 * Every output is derived from the state passed in. Port naming: the lesson's canonical port ids are the Junos-style
 * ge-0/0/1–4; Cisco shows the SAME ports as GigabitEthernet1/0/1–4 (Gi1/0/N). Only commands whose syntax is
 * confidently real are offered (no Junos per-MAC lookup or aging display — see the lesson plan).
 * Explanations teach what a command answers; they never diagnose the incident for the learner.
 */

export const SW1_HOSTNAME = "SW1";
export type EthPort = (typeof SW1_PORTS)[number];

const CISCO_IF: Record<EthPort, string> = { "ge-0/0/1": "GigabitEthernet1/0/1", "ge-0/0/2": "GigabitEthernet1/0/2", "ge-0/0/3": "GigabitEthernet1/0/3", "ge-0/0/4": "GigabitEthernet1/0/4" };
const CISCO_SHORT: Record<EthPort, string> = { "ge-0/0/1": "Gi1/0/1", "ge-0/0/2": "Gi1/0/2", "ge-0/0/3": "Gi1/0/3", "ge-0/0/4": "Gi1/0/4" };
const JUNOS_IF: Record<EthPort, string> = { "ge-0/0/1": "ge-0/0/1", "ge-0/0/2": "ge-0/0/2", "ge-0/0/3": "ge-0/0/3", "ge-0/0/4": "ge-0/0/4" };
/** Port descriptions (configured intent: who is SUPPOSED to be there) — not the learned table. */
const PORT_DESC: Record<EthPort, string> = { "ge-0/0/1": "HOST-A", "ge-0/0/2": "HOST-B", "ge-0/0/3": "HOST-C", "ge-0/0/4": "DESK-SW" };

/** Vendor display name for a canonical lesson port (used by the lab UI too, so naming has one source). */
export function ethInterfaceAlias(vendor: CliVendor, port: string): string {
  return vendor === "cisco" ? (CISCO_SHORT[port as EthPort] ?? port) : (JUNOS_IF[port as EthPort] ?? port);
}

const EXPLAIN = {
  mac: "This table answers: which SW1 port leads to this MAC? (MAC → port.) SW1 fills it only from the SOURCE MAC of frames entering its ports; it never learns from a destination or from a link event.",
  macFilter: "A filtered view of the same table. 'No entry' means SW1 has not seen a frame SOURCED by that MAC — or the entry was flushed or aged out.",
  ifFilter: "Every MAC SW1 has learned behind one port. Several MACs behind one port is normal when another switch (DESK-SW) sits there.",
  aging: `Dynamic entries are removed after ${FDB_AGING_SEC} s without a frame sourced by that MAC. Only a frame the host SENDS resets its timer.`,
  status: "Link state per port. A MAC can only be learned on a port that is up; a port going down flushes what was learned on it. A link coming up teaches nothing.",
  ifDetail: "Interface detail shows the port's link state and configured description (intent: who is SUPPOSED to be there). Which MACs are actually behind the port is in the MAC table.",
  vlan: "This lesson has no VLANs: every port is in the default VLAN (Cisco shows VLAN 1, Junos shows 'default').",
};

const sorted = (fdb: FdbEntry[]) => [...fdb].sort((a, b) => a.port.localeCompare(b.port) || a.mac.localeCompare(b.mac));
const portUp = (s: EthState, port: EthPort) => !!sw1PortNeighbor(s, port);
const countNote = (n: number) => (n === 0 ? " SW1 has learned nothing for this query." : ` ${n} learned ${n === 1 ? "entry" : "entries"} match right now.`);

/** IOS H.H.H MAC argument (e.g. 0011.2233.440b). Any well-formed MAC is accepted; the hosts' MACs are offered in `?`/Tab. */
const ciscoMacArg: CliArgSpec = {
  choices: (Object.keys(ETH_MAC) as EthHost[]).map((h) => ciscoMac(ETH_MAC[h])),
  describe: (choice) => {
    const host = (Object.keys(ETH_MAC) as EthHost[]).find((h) => ciscoMac(ETH_MAC[h]) === choice);
    return host ? `${host}'s MAC` : undefined;
  },
  resolve: (raw) => {
    const m = /^([0-9a-f]{4})\.([0-9a-f]{4})\.([0-9a-f]{4})$/i.exec(raw);
    if (!m) return undefined;
    const hex = (m[1] + m[2] + m[3]).toUpperCase();
    return hex.match(/.{2}/g)!.join(":");
  },
};

// ---------------------------------------------------------------- Cisco IOS (Catalyst-style access switch)

function ciscoCommands(s: EthState): CliCommand[] {
  const ifArg = { interface: interfaceArg("cisco", CISCO_IF, PORT_DESC) };
  const table = (entries: FdbEntry[], explanation: string) => {
    const rows = sorted(entries).map((e) => ["   1", ciscoMac(e.mac), "DYNAMIC", CISCO_SHORT[e.port as EthPort] ?? e.port]);
    const lines = ["          Mac Address Table", "-------------------------------------------", "", columns([["Vlan", "Mac Address", "Type", "Ports"], ["----", "-----------", "--------", "-----"], ...rows], [8, 18, 12]), `Total Mac Addresses for this criterion: ${rows.length}`];
    return { output: lines.join("\n"), explanation: `${explanation}${countNote(rows.length)} ${EXPLAIN.vlan}` };
  };
  const status = () => {
    const rows = SW1_PORTS.map((p) => [CISCO_SHORT[p], PORT_DESC[p], portUp(s, p) ? "connected" : "notconnect", "1", portUp(s, p) ? "a-full" : "auto", portUp(s, p) ? "a-1000" : "auto", "10/100/1000BaseTX"]);
    return { output: columns([["Port", "Name", "Status", "Vlan", "Duplex", "Speed", "Type"], ...rows], [10, 10, 13, 6, 8, 8]), explanation: EXPLAIN.status };
  };
  const showIf = ({ interface: id }: Record<string, string>) => {
    const p = id as EthPort;
    const up = portUp(s, p);
    const learned = s.fdb.SW1.filter((e) => e.port === p).length;
    const lines = [
      `${CISCO_IF[p]} is ${up ? "up" : "down"}, line protocol is ${up ? "up (connected)" : "down (notconnect)"}`,
      "  Hardware is Gigabit Ethernet",
      `  Description: ${PORT_DESC[p]}`,
      "  MTU 1500 bytes, BW 1000000 Kbit/sec, DLY 10 usec",
      up ? "  Full-duplex, 1000Mb/s, media type is 10/100/1000BaseTX" : "  Auto-duplex, Auto-speed, media type is 10/100/1000BaseTX",
      "  Switchport mode access, access VLAN 1",
    ];
    return { output: lines.join("\n"), explanation: `${EXPLAIN.ifDetail} (${learned} MAC${learned === 1 ? "" : "s"} learned behind ${CISCO_SHORT[p]} right now.)` };
  };
  const all = () => table(s.fdb.SW1, EXPLAIN.mac);
  return [
    { id: "mac-table", syntax: "show mac address-table", summary: "MAC table: MAC → port", run: all },
    { id: "mac-table", syntax: "show mac-address-table", summary: "Older alias of show mac address-table", hidden: true, run: all },
    { id: "mac-table-dynamic", syntax: "show mac address-table dynamic", summary: "Dynamic (learned) entries only", run: () => table(s.fdb.SW1, EXPLAIN.mac) },
    { id: "mac-table-address", syntax: "show mac address-table address <mac>", summary: "Where SW1 learned one MAC", args: { mac: ciscoMacArg }, run: ({ mac }) => table(s.fdb.SW1.filter((e) => e.mac === mac), `${EXPLAIN.macFilter}${macName(mac) !== mac ? ` (${macName(mac)}'s MAC.)` : ""}`) },
    { id: "mac-table-interface", syntax: "show mac address-table interface <interface>", summary: "MACs learned behind one port", args: ifArg, run: ({ interface: id }) => table(s.fdb.SW1.filter((e) => e.port === id), EXPLAIN.ifFilter) },
    { id: "mac-aging", syntax: "show mac address-table aging-time", summary: "Dynamic-entry aging time", run: () => ({ output: `Global Aging Time:  ${FDB_AGING_SEC}`, explanation: EXPLAIN.aging }) },
    { id: "interfaces-status", syntax: "show interfaces status", summary: "Port link state at a glance", run: status },
    { id: "interface-detail", syntax: "show interfaces <interface>", summary: "One port in detail (Gi1/0/1–Gi1/0/4)", args: ifArg, run: showIf },
  ];
}

// ---------------------------------------------------------------- Junos (ELS EX-style access switch)

function junosCommands(s: EthState): CliCommand[] {
  const ifArg = { interface: interfaceArg("juniper", JUNOS_IF, PORT_DESC) };
  const table = (entries: FdbEntry[], explanation: string) => {
    const rows = sorted(entries).map((e) => ["   default", junosMac(e.mac), "D", "-", `${JUNOS_IF[e.port as EthPort] ?? e.port}.0`]);
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
    for (const p of SW1_PORTS) {
      const link = portUp(s, p) ? "up" : "down";
      rows.push([JUNOS_IF[p], "up", link, ""]);
      rows.push([`${JUNOS_IF[p]}.0`, "up", link, "eth-switch"]);
    }
    return { output: columns([["Interface", "Admin", "Link", "Proto"], ...rows], [24, 6, 5]), explanation: EXPLAIN.status };
  };
  const showIf = ({ interface: id }: Record<string, string>) => {
    const p = id as EthPort;
    const up = portUp(s, p);
    const learned = s.fdb.SW1.filter((e) => e.port === p).length;
    const lines = [
      `Physical interface: ${JUNOS_IF[p]}, Enabled, Physical link is ${up ? "Up" : "Down"}`,
      `  Description: ${PORT_DESC[p]}`,
      `  Link-level type: Ethernet, MTU: 1514, Speed: ${up ? "1000mbps" : "Auto"}`,
      "",
      `  Logical interface ${JUNOS_IF[p]}.0`,
      "    Protocol eth-switch, MTU: 1514",
      "      Interface-mode: access, VLAN: default",
    ];
    return { output: lines.join("\n"), explanation: `${EXPLAIN.ifDetail} (${learned} MAC${learned === 1 ? "" : "s"} learned behind ${JUNOS_IF[p]} right now.)` };
  };
  return [
    { id: "mac-table", syntax: "show ethernet-switching table", summary: "Switching table: MAC → port", run: () => table(s.fdb.SW1, EXPLAIN.mac) },
    { id: "mac-table-interface", syntax: "show ethernet-switching table interface <interface>", summary: "MACs learned behind one port", args: ifArg, run: ({ interface: id }) => table(s.fdb.SW1.filter((e) => e.port === id), EXPLAIN.ifFilter) },
    { id: "interfaces-status", syntax: "show interfaces terse", summary: "Port link state at a glance", run: terse },
    { id: "interface-detail", syntax: "show interfaces <interface>", summary: "One port in detail (ge-0/0/1–ge-0/0/4)", args: ifArg, run: showIf },
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
    "show mac address-table aging-time": "Aging time",
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

/** SW1's command set for one vendor, built from the lab state passed in. Cheap — rebuild whenever the state changes. */
export function ethernetSw1Cli(vendor: CliVendor, s: EthState): CliCommandSet {
  return {
    vendor,
    deviceId: "SW1",
    deviceName: SW1_HOSTNAME,
    prompt: vendor === "cisco" ? `${SW1_HOSTNAME}#` : `user@${SW1_HOSTNAME}> `,
    commands: [...(vendor === "cisco" ? ciscoCommands(s) : junosCommands(s)), ...readOnlyBoundaryCommands(vendor)],
    help: HELP[vendor],
  };
}

export function ethernetSw1CliSets(s: EthState): Record<CliVendor, CliCommandSet> {
  return { cisco: ethernetSw1Cli("cisco", s), juniper: ethernetSw1Cli("juniper", s) };
}
