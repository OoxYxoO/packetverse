import type { CliCommand, CliCommandSet, CliVendor } from "@/lib/cli/types";
import { ciscoMac, columns, interfaceArg, ipInSubnet, junosMac, networkOf, prefixToMask, readOnlyBoundaryCommands } from "@/lib/cli/format";
import { DEVICE_HOSTNAME, ROUTER_INTERFACES, SWITCH_PORTS, type FirstConnectionState, type RouterInterfaceId, type SwitchPortId } from "@/lib/sim-engine/scenarios/firstConnection";

/**
 * CLI adapter for the connection network (a shared primitive: the ARP and TCP/UDP lessons' guided walkthroughs both
 * use it, each with its own state) — the middle layer of
 * "scenario truth → command adapter → terminal rendering".
 *
 * Every output below is computed from the FirstConnectionState snapshot
 * it is given (live OR historical), so the same network truth renders
 * as Cisco IOS or Junos syntax. Vendor naming is pure presentation: the
 * scenario stores one canonical id per interface/port and this file is
 * the only place that translates it.
 */

export type FirstConnectionCliDevice = "switch" | "router";

/**
 * The only slice of network truth the CLI reads: the guided lesson
 * passes its FirstConnectionState (live or historical snapshot). The
 * ARP Lab has its own network model and terminals (arp-lab/arpNetCli.ts),
 * so neither surface can read the other's state.
 */
export type CliNetworkView = Pick<FirstConnectionState, "arpTable" | "macTable" | "routingTable">;

export const CLI_HOSTNAME: Record<FirstConnectionCliDevice, string> = DEVICE_HOSTNAME;

const CISCO_ROUTER_IF: Record<RouterInterfaceId, string> = { lan: "GigabitEthernet0/0", server: "GigabitEthernet0/1", wan: "GigabitEthernet0/2" };
const JUNOS_ROUTER_IF: Record<RouterInterfaceId, string> = { lan: "ge-0/0/0", server: "ge-0/0/1", wan: "ge-0/0/2" };
const CISCO_SWITCH_IF: Record<SwitchPortId, string> = { port1: "FastEthernet0/1", port2: "FastEthernet0/2" };
const CISCO_SWITCH_IF_SHORT: Record<SwitchPortId, string> = { port1: "Fa0/1", port2: "Fa0/2" };
const JUNOS_SWITCH_IF: Record<SwitchPortId, string> = { port1: "ge-0/0/1", port2: "ge-0/0/2" };

/** `?` descriptions for interface arguments — taken from the device's real role in this topology. */
const ROUTER_IF_DESC: Record<RouterInterfaceId, string> = {
  lan: `LAN-facing interface (${ROUTER_INTERFACES.find((i) => i.id === "lan")?.ip}/24)`,
  server: `Server-segment interface (${ROUTER_INTERFACES.find((i) => i.id === "server")?.ip}/24)`,
  wan: "WAN uplink (default route)",
};
const SWITCH_PORT_DESC: Record<SwitchPortId, string> = Object.fromEntries(SWITCH_PORTS.map((p) => [p.id, `${p.neighborLabel}-facing interface`])) as Record<SwitchPortId, string>;

/**
 * `?` descriptions per keyword path — short, syntax-and-purpose only
 * (concept explanations belong after a command runs). The grammar itself
 * comes from the command definitions below.
 */
const CLI_HELP: Record<FirstConnectionCliDevice, Record<CliVendor, Record<string, string>>> = {
  router: {
    cisco: {
      show: "Show running system information",
      "show arp": "ARP table",
      "show interfaces": "Interface status and configuration",
      "show ip": "IP information",
      "show ip arp": "IP ARP table",
      "show ip interface": "IP interface status and configuration",
      "show ip interface brief": "Brief summary of IP status and configuration",
      "show ip route": "IP routing table",
      "show running-config": "Current operating configuration",
      "show running-config interface": "Show interface configuration",
    },
    juniper: {
      show: "Show system information",
      "show arp": "Show Address Resolution Protocol table",
      "show configuration": "Show current configuration",
      "show configuration interfaces": "Interface configuration",
      "show interfaces": "Show interface information",
      "show interfaces terse": "Display terse output",
      "show route": "Show routing table information",
    },
  },
  switch: {
    cisco: {
      show: "Show running system information",
      "show interfaces": "Interface status and configuration",
      "show interfaces status": "Show interface line status",
      "show mac": "MAC configuration",
      "show mac address-table": "MAC forwarding table",
    },
    juniper: {
      show: "Show system information",
      "show ethernet-switching": "Show Ethernet switching information",
      "show ethernet-switching table": "Show Ethernet switching table",
      "show interfaces": "Show interface information",
      "show interfaces terse": "Display terse output",
    },
  },
};

/** Fixed, display-only uptime — real time would make identical state render differently between runs. */
const JUNOS_ROUTE_AGE = "00:42:17";

const EXPLAIN = {
  arp: "This table answers: which MAC address belongs to a local IPv4 neighbor? (IPv4 address → MAC address.) Hosts and routers keep one; it is filled by ARP.",
  mac: "This table answers: which local switch port leads to this MAC address? (MAC address → port.) The switch fills it by reading the SOURCE MAC of every frame that enters a port.",
  route: "Routing chooses the Layer-3 next hop and egress interface. ARP then resolves the local Layer-2 address needed to reach that next hop.",
  ifBrief: "Check interface state first: an ARP or MAC entry can only be learned on an interface that is up.",
  ifDetail: "Interface detail shows the port's own MAC and addressing — the identity this device uses on that link.",
  config: "Configuration is intent; the ARP and MAC tables are what the device has learned. This lesson's CLI is read-only.",
  switchArp:
    "SW1 is a pure Layer-2 switch here: no IP interface, so no ARP entries. It never needs ARP to forward Ethernet frames — it uses its MAC table (show mac address-table / show ethernet-switching table).",
};

function arpCountNote(count: number, device: string) {
  return count === 0 ? ` ${device} has learned nothing yet.` : ` ${device} has ${count} learned ${count === 1 ? "entry" : "entries"} right now.`;
}

function routerIfFor(ip: string): RouterInterfaceId | undefined {
  return ROUTER_INTERFACES.find((i) => i.ip && i.prefixLength !== undefined && ipInSubnet(ip, i.ip, i.prefixLength))?.id;
}

function macEntries(state: CliNetworkView): [string, SwitchPortId][] {
  return Object.entries(state.macTable.switch ?? {});
}

function routerArp(state: CliNetworkView): [string, string][] {
  return Object.entries(state.arpTable.router ?? {});
}

/** Numeric prefix order ("0.0.0.0/0" < "10.20.20.0/24" < "192.168.10.0/24"), as both vendors print routing tables. */
function byAddress(a: string, b: string) {
  const [x, y] = [a, b].map((n) => n.split("/")[0].split(".").map(Number));
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2] || x[3] - y[3] || Number(a.split("/")[1]) - Number(b.split("/")[1]);
}

function matchedNote(state: CliNetworkView) {
  const hit = state.routingTable.router.find((r) => r.matched);
  return hit ? ` The last lookup in this lesson (10.20.20.20) matched ${hit.network}.` : "";
}

// ---------------------------------------------------------------- Cisco R1

function ciscoRouter(state: CliNetworkView): CliCommand[] {
  const ifArg = { interface: interfaceArg("cisco", CISCO_ROUTER_IF, ROUTER_IF_DESC) };

  const showArp = () => {
    const rows = routerArp(state).map(([ip, mac]) => {
      const iface = routerIfFor(ip);
      return ["Internet", ip, "0", ciscoMac(mac), "ARPA", iface ? CISCO_ROUTER_IF[iface] : "-"];
    });
    const header = ["Protocol", "Address", "Age (min)", "Hardware Addr", "Type", "Interface"];
    // Age is right-aligned under its header on real IOS.
    const out = [header, ...rows].map((r, k) => (k === 0 ? r : [r[0], r[1], r[2].padStart(9) + " ", r[3], r[4], r[5]]));
    return { output: columns(out, [10, 17, 11, 16, 7]), explanation: EXPLAIN.arp + arpCountNote(rows.length, "R1") };
  };

  const ipBrief = () => {
    const rows = ROUTER_INTERFACES.map((i) => [CISCO_ROUTER_IF[i.id], i.ip ?? "unassigned", "YES", i.ip ? "manual" : "unset", "up", "up"]);
    return { output: columns([["Interface", "IP-Address", "OK?", "Method", "Status", "Protocol"], ...rows], [23, 16, 4, 7, 22]), explanation: EXPLAIN.ifBrief };
  };

  const ipRoute = () => {
    const lines = ["Codes: L - local, C - connected, S - static, * - candidate default", ""];
    const def = state.routingTable.router.find((r) => r.network === "0.0.0.0/0");
    lines.push(def ? "Gateway of last resort is 0.0.0.0 to network 0.0.0.0" : "Gateway of last resort is not set", "");
    if (def) lines.push(`S*    0.0.0.0/0 is directly connected, ${CISCO_ROUTER_IF[def.ifaceId]}`);
    for (const r of state.routingTable.router.filter((x) => x.origin === "connected").sort((a, b) => byAddress(a.network, b.network))) {
      const iface = ROUTER_INTERFACES.find((i) => i.id === r.ifaceId);
      const firstOctet = Number(r.network.split(".")[0]);
      const classfulLen = firstOctet < 128 ? 8 : firstOctet < 192 ? 16 : 24;
      lines.push(`      ${networkOf(r.network.split("/")[0], classfulLen)}/${classfulLen} is variably subnetted, 2 subnets, 2 masks`);
      lines.push(`C        ${r.network} is directly connected, ${CISCO_ROUTER_IF[r.ifaceId]}`);
      if (iface?.ip) lines.push(`L        ${iface.ip}/32 is directly connected, ${CISCO_ROUTER_IF[r.ifaceId]}`);
    }
    return { output: lines.join("\n"), explanation: EXPLAIN.route + matchedNote(state) };
  };

  const showIf = ({ interface: id }: Record<string, string>) => {
    const i = ROUTER_INTERFACES.find((x) => x.id === id)!;
    const lines = [
      `${CISCO_ROUTER_IF[i.id]} is up, line protocol is up`,
      `  Hardware is iGbE, address is ${ciscoMac(i.mac)} (bia ${ciscoMac(i.mac)})`,
      `  Description: ${i.description}`,
      ...(i.ip ? [`  Internet address is ${i.ip}/${i.prefixLength}`] : []),
      "  MTU 1500 bytes, BW 1000000 Kbit/sec, DLY 10 usec",
      "  Encapsulation ARPA, loopback not set",
      "  ARP type: ARPA, ARP Timeout 04:00:00",
    ];
    return { output: lines.join("\n"), explanation: EXPLAIN.ifDetail };
  };

  const runIf = ({ interface: id }: Record<string, string>) => {
    const i = ROUTER_INTERFACES.find((x) => x.id === id)!;
    const body = [
      "!",
      `interface ${CISCO_ROUTER_IF[i.id]}`,
      ` description ${i.description}`,
      i.ip && i.prefixLength !== undefined ? ` ip address ${i.ip} ${prefixToMask(i.prefixLength)}` : " no ip address",
      " no shutdown",
      "end",
    ].join("\n");
    return { output: `Building configuration...\n\nCurrent configuration : ${body.length} bytes\n${body}`, explanation: EXPLAIN.config };
  };

  return [
    { id: "arp-table", syntax: "show ip arp", summary: "ARP table: IPv4 neighbor → MAC", run: showArp },
    { id: "arp-table", syntax: "show arp", summary: "ARP table (same as show ip arp)", run: showArp },
    { id: "interfaces-brief", syntax: "show ip interface brief", summary: "Interface status and IPv4 addresses", run: ipBrief },
    { id: "route-table", syntax: "show ip route", summary: "IPv4 routing table", run: ipRoute },
    { id: "interface-detail", syntax: "show interfaces <interface>", summary: "One interface in detail (Gi0/0, Gi0/1, Gi0/2)", args: ifArg, run: showIf },
    { id: "interface-config", syntax: "show running-config interface <interface>", summary: "Configured settings of one interface", args: ifArg, run: runIf },
  ];
}

// ---------------------------------------------------------------- Junos R1

function junosRouter(state: CliNetworkView): CliCommand[] {
  const ifArg = { interface: interfaceArg("juniper", JUNOS_ROUTER_IF, ROUTER_IF_DESC) };

  const showArp = () => {
    const rows = routerArp(state).map(([ip, mac]) => {
      const iface = routerIfFor(ip);
      return [junosMac(mac), ip, ip, iface ? `${JUNOS_ROUTER_IF[iface]}.0` : "-", "none"];
    });
    const table = columns([["MAC Address", "Address", "Name", "Interface", "Flags"], ...rows], [18, 16, 26, 24]);
    return { output: `${table}\nTotal entries: ${rows.length}`, explanation: EXPLAIN.arp + arpCountNote(rows.length, "R1") };
  };

  const terse = () => {
    const rows: string[][] = [];
    for (const i of ROUTER_INTERFACES) {
      rows.push([JUNOS_ROUTER_IF[i.id], "up", "up", "", ""]);
      rows.push([`${JUNOS_ROUTER_IF[i.id]}.0`, "up", "up", "inet", i.ip ? `${i.ip}/${i.prefixLength}` : ""]);
    }
    return { output: columns([["Interface", "Admin", "Link", "Proto", "Local"], ...rows], [24, 6, 5, 9]), explanation: EXPLAIN.ifBrief };
  };

  const route = () => {
    const entries: { dest: string; proto: string; via: string; local?: boolean }[] = [];
    for (const r of state.routingTable.router) {
      entries.push({ dest: r.network, proto: r.origin === "static" ? "Static/5" : "Direct/0", via: `${JUNOS_ROUTER_IF[r.ifaceId]}.0` });
      const iface = ROUTER_INTERFACES.find((i) => i.id === r.ifaceId);
      if (r.origin === "connected" && iface?.ip) entries.push({ dest: `${iface.ip}/32`, proto: "Local/0", via: `${JUNOS_ROUTER_IF[r.ifaceId]}.0`, local: true });
    }
    entries.sort((a, b) => byAddress(a.dest, b.dest));
    const n = entries.length;
    const lines = [`inet.0: ${n} destinations, ${n} routes (${n} active, 0 holddown, 0 hidden)`, "+ = Active Route, - = Last Active, * = Both", ""];
    for (const e of entries) {
      lines.push(`${e.dest.padEnd(19)}*[${e.proto}] ${JUNOS_ROUTE_AGE}`);
      lines.push(e.local ? `                       Local via ${e.via}` : `                    >  via ${e.via}`);
    }
    return { output: lines.join("\n"), explanation: EXPLAIN.route + matchedNote(state) };
  };

  const showIf = ({ interface: id }: Record<string, string>) => {
    const i = ROUTER_INTERFACES.find((x) => x.id === id)!;
    const name = JUNOS_ROUTER_IF[i.id];
    const lines = [
      `Physical interface: ${name}, Enabled, Physical link is Up`,
      `  Description: ${i.description}`,
      "  Link-level type: Ethernet, MTU: 1514, Speed: 1000mbps",
      `  Current address: ${junosMac(i.mac)}, Hardware address: ${junosMac(i.mac)}`,
      "",
      `  Logical interface ${name}.0`,
      "    Protocol inet, MTU: 1500",
      ...(i.ip && i.prefixLength !== undefined
        ? ["      Addresses, Flags: Is-Preferred Is-Primary", `        Destination: ${networkOf(i.ip, i.prefixLength)}/${i.prefixLength}, Local: ${i.ip}`]
        : []),
    ];
    return { output: lines.join("\n"), explanation: EXPLAIN.ifDetail };
  };

  const config = ({ interface: id }: Record<string, string>) => {
    const i = ROUTER_INTERFACES.find((x) => x.id === id)!;
    const lines = [`description "${i.description}";`, "unit 0 {", "    family inet {", ...(i.ip ? [`        address ${i.ip}/${i.prefixLength};`] : []), "    }", "}"];
    return { output: lines.join("\n"), explanation: EXPLAIN.config };
  };

  return [
    { id: "arp-table", syntax: "show arp", summary: "ARP table: IPv4 neighbor → MAC", run: showArp },
    { id: "interfaces-brief", syntax: "show interfaces terse", summary: "Interface status and addresses", run: terse },
    { id: "route-table", syntax: "show route", summary: "Routing table (inet.0)", run: route },
    { id: "interface-detail", syntax: "show interfaces <interface>", summary: "One interface in detail (ge-0/0/0, ge-0/0/1, ge-0/0/2)", args: ifArg, run: showIf },
    { id: "interface-config", syntax: "show configuration interfaces <interface>", summary: "Configured settings of one interface", args: ifArg, run: config },
  ];
}

// ---------------------------------------------------------------- Cisco SW1

function ciscoSwitch(state: CliNetworkView): CliCommand[] {
  const ifArg = { interface: interfaceArg("cisco", CISCO_SWITCH_IF, SWITCH_PORT_DESC) };

  const macTable = () => {
    const rows = macEntries(state).map(([mac, port]) => ["   1", ciscoMac(mac), "DYNAMIC", CISCO_SWITCH_IF_SHORT[port]]);
    const lines = [
      "          Mac Address Table",
      "-------------------------------------------",
      "",
      columns([["Vlan", "Mac Address", "Type", "Ports"], ["----", "-----------", "--------", "-----"], ...rows], [8, 18, 12]),
      `Total Mac Addresses for this criterion: ${rows.length}`,
    ];
    return { output: lines.join("\n"), explanation: EXPLAIN.mac + arpCountNote(rows.length, "SW1") };
  };

  const status = () => {
    const rows = SWITCH_PORTS.map((p) => [CISCO_SWITCH_IF_SHORT[p.id], p.neighborLabel, "connected", "1", "a-full", "a-100", "10/100BaseTX"]);
    return { output: columns([["Port", "Name", "Status", "Vlan", "Duplex", "Speed", "Type"], ...rows], [10, 12, 13, 6, 8, 7]), explanation: EXPLAIN.ifBrief };
  };

  const showIf = ({ interface: id }: Record<string, string>) => {
    const p = SWITCH_PORTS.find((x) => x.id === id)!;
    const learned = macEntries(state).filter(([, port]) => port === p.id).length;
    const lines = [
      `${CISCO_SWITCH_IF[p.id]} is up, line protocol is up (connected)`,
      `  Hardware is Fast Ethernet, address is ${ciscoMac(p.mac)} (bia ${ciscoMac(p.mac)})`,
      `  Description: ${p.neighborLabel}`,
      "  MTU 1500 bytes, BW 100000 Kbit/sec, DLY 100 usec",
      "  Full-duplex, 100Mb/s, media type is 10/100BaseTX",
      "  Switchport mode access, access VLAN 1",
    ];
    return {
      output: lines.join("\n"),
      explanation: `${EXPLAIN.ifDetail} The port's own MAC is not what the MAC table stores — the table stores MACs learned behind the port (${learned} on ${CISCO_SWITCH_IF_SHORT[p.id]} right now).`,
    };
  };

  const noArp = () => ({ output: columns([["Protocol", "Address", "Age (min)", "Hardware Addr", "Type", "Interface"]], [10, 17, 11, 16, 7]), explanation: EXPLAIN.switchArp });

  return [
    { id: "mac-table", syntax: "show mac address-table", summary: "MAC table: MAC → switch port", run: macTable },
    { id: "mac-table", syntax: "show mac-address-table", summary: "Older alias of show mac address-table", hidden: true, run: macTable },
    { id: "interfaces-brief", syntax: "show interfaces status", summary: "Port status at a glance", run: status },
    { id: "interface-detail", syntax: "show interfaces <interface>", summary: "One port in detail (Fa0/1, Fa0/2)", args: ifArg, run: showIf },
    { id: "switch-arp", syntax: "show ip arp", summary: "", hidden: true, run: noArp },
    { id: "switch-arp", syntax: "show arp", summary: "", hidden: true, run: noArp },
  ];
}

// ---------------------------------------------------------------- Junos SW1

function junosSwitch(state: CliNetworkView): CliCommand[] {
  const ifArg = { interface: interfaceArg("juniper", JUNOS_SWITCH_IF, SWITCH_PORT_DESC) };

  const table = () => {
    const rows = macEntries(state).map(([mac, port]) => ["   default", junosMac(mac), "D", "-", `${JUNOS_SWITCH_IF[port]}.0`]);
    const lines = [
      "MAC flags (S - static MAC, D - dynamic MAC, L - locally learned)",
      "",
      `Ethernet switching table : ${rows.length} entries, ${rows.length} learned`,
      "Routing instance : default-switch",
      ...(rows.length > 0 ? [columns([["   Vlan", "MAC", "MAC", "Age", "Logical"], ["   name", "address", "flags", "", "interface"], ...rows], [13, 20, 8, 6])] : []),
    ];
    return { output: lines.join("\n"), explanation: EXPLAIN.mac + arpCountNote(rows.length, "SW1") };
  };

  const terse = () => {
    const rows: string[][] = [];
    for (const p of SWITCH_PORTS) {
      rows.push([JUNOS_SWITCH_IF[p.id], "up", "up", ""]);
      rows.push([`${JUNOS_SWITCH_IF[p.id]}.0`, "up", "up", "eth-switch"]);
    }
    return { output: columns([["Interface", "Admin", "Link", "Proto"], ...rows], [24, 6, 5]), explanation: EXPLAIN.ifBrief };
  };

  const showIf = ({ interface: id }: Record<string, string>) => {
    const p = SWITCH_PORTS.find((x) => x.id === id)!;
    const name = JUNOS_SWITCH_IF[p.id];
    const learned = macEntries(state).filter(([, port]) => port === p.id).length;
    const lines = [
      `Physical interface: ${name}, Enabled, Physical link is Up`,
      `  Description: ${p.neighborLabel}`,
      "  Link-level type: Ethernet, MTU: 1514, Speed: 1000mbps",
      `  Current address: ${junosMac(p.mac)}, Hardware address: ${junosMac(p.mac)}`,
      "",
      `  Logical interface ${name}.0`,
      "    Protocol eth-switch, MTU: 1514",
      "      Interface-mode: access, VLAN: default",
    ];
    return {
      output: lines.join("\n"),
      explanation: `${EXPLAIN.ifDetail} The port's own MAC is not what the switching table stores — the table stores MACs learned behind the port (${learned} on ${name} right now).`,
    };
  };

  const noArp = () => ({ output: `${columns([["MAC Address", "Address", "Name", "Interface", "Flags"]], [18, 16, 26, 24])}\nTotal entries: 0`, explanation: EXPLAIN.switchArp });

  return [
    { id: "mac-table", syntax: "show ethernet-switching table", summary: "Switching table: MAC → port", run: table },
    { id: "interfaces-brief", syntax: "show interfaces terse", summary: "Port status at a glance", run: terse },
    { id: "interface-detail", syntax: "show interfaces <interface>", summary: "One port in detail (ge-0/0/1, ge-0/0/2)", args: ifArg, run: showIf },
    { id: "switch-arp", syntax: "show arp", summary: "", hidden: true, run: noArp },
  ];
}

/** One device × vendor view of a scenario snapshot. Cheap — rebuild it whenever the snapshot changes. */
export function firstConnectionCli(device: FirstConnectionCliDevice, vendor: CliVendor, state: CliNetworkView): CliCommandSet {
  const hostname = CLI_HOSTNAME[device];
  const commands = device === "router" ? (vendor === "cisco" ? ciscoRouter(state) : junosRouter(state)) : vendor === "cisco" ? ciscoSwitch(state) : junosSwitch(state);
  return {
    vendor,
    deviceId: device,
    deviceName: hostname,
    prompt: vendor === "cisco" ? `${hostname}#` : `user@${hostname}> `,
    commands: [...commands, ...readOnlyBoundaryCommands(vendor)],
    help: CLI_HELP[device][vendor],
  };
}

export function firstConnectionCliSets(device: FirstConnectionCliDevice, state: CliNetworkView): Record<CliVendor, CliCommandSet> {
  return { cisco: firstConnectionCli(device, "cisco", state), juniper: firstConnectionCli(device, "juniper", state) };
}

/** Short vendor alias for a canonical port — the ARP Lab topology labels links with these, so naming has one source (this adapter). */
export function interfaceAlias(vendor: CliVendor, port: { kind: "switch"; id: SwitchPortId } | { kind: "router"; id: RouterInterfaceId }): string {
  if (port.kind === "switch") return vendor === "cisco" ? CISCO_SWITCH_IF_SHORT[port.id] : JUNOS_SWITCH_IF[port.id];
  return vendor === "cisco" ? CISCO_ROUTER_IF[port.id].replace("GigabitEthernet", "Gi") : JUNOS_ROUTER_IF[port.id];
}
