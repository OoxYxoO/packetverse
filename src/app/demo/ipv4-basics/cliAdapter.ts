import type { CliCommand, CliCommandSet, CliVendor } from "@/lib/cli/types";
import { ciscoMac, columns, interfaceArg, junosMac, readOnlyBoundaryCommands } from "@/lib/cli/format";
import { R1_ROUTES, V4_IP, V4_MAC, V4_PREFIX, maskOf, networkOf, sameSubnet } from "@/lib/sim-engine/scenarios/ipv4Basics";
import type { V4LabState } from "@/lib/sim-engine/scenarios/ipv4Lab";

/**
 * IPv4 Basics CLI adapter — R1 only (the one managed router). Hosts and SW-A/SW-B get no Cisco/Junos CLI.
 *
 *   lab truth (R1's connected routes, interfaces, its own ARP cache) → this adapter → generic parser → CLITerminal
 *
 * Canonical interfaces are the lesson's ge-0/0/0 and ge-0/0/1; Cisco shows the same ports as GigabitEthernet0/0 and
 * GigabitEthernet0/1 (Gi0/0, Gi0/1). Only read-only commands whose syntax is real are offered; no ping (ICMP is its
 * own lesson). Explanations say what a command answers; they never diagnose the incident.
 */

type R1If = "ge-0/0/0" | "ge-0/0/1";
const IFS: { id: R1If; ip: string; mac: string; desc: string }[] = [
  { id: "ge-0/0/0", ip: V4_IP.R1L, mac: V4_MAC.R1L, desc: "LAN A - HOST-A and HOST-C" },
  { id: "ge-0/0/1", ip: V4_IP.R1R, mac: V4_MAC.R1R, desc: "LAN B - HOST-B" },
];
const CISCO_IF: Record<R1If, string> = { "ge-0/0/0": "GigabitEthernet0/0", "ge-0/0/1": "GigabitEthernet0/1" };
const JUNOS_IF: Record<R1If, string> = { "ge-0/0/0": "ge-0/0/0", "ge-0/0/1": "ge-0/0/1" };
const IF_DESC: Record<R1If, string> = { "ge-0/0/0": `LAN A interface (${V4_IP.R1L}/${V4_PREFIX})`, "ge-0/0/1": `LAN B interface (${V4_IP.R1R}/${V4_PREFIX})` };
/** Fixed, display-only route age — real time would make identical state render differently between runs. */
const JUNOS_ROUTE_AGE = "00:42:17";

/** Short vendor alias for a canonical R1 port (used by the lab UI so naming has one source). */
export function r1InterfaceAlias(vendor: CliVendor, port: string): string {
  return vendor === "cisco" ? (CISCO_IF[port as R1If]?.replace("GigabitEthernet", "Gi") ?? port) : port;
}

const EXPLAIN = {
  brief: "Interface state and the IPv4 address on each interface. Each address and its prefix define one connected network.",
  route: "R1's routing table: where it forwards a packet by its DESTINATION IPv4 address. Here R1 knows only the two networks it is directly connected to — no routing protocol, no static routes.",
  arp: "R1's own ARP cache: IPv4 neighbour → MAC on each connected LAN. R1 fills it with ARP, only for neighbours it needs (or that ARPed for R1's own address).",
  ifDetail: "One interface: its MAC (the source MAC of frames R1 sends on that link) and its IPv4 address and prefix.",
};
const ifFor = (ip: string) => IFS.find((i) => sameSubnet(ip, i.ip, V4_PREFIX))?.id;
const arpRows = (s: V4LabState) => Object.entries(s.arp.R1).filter(([, mac]) => mac !== "INCOMPLETE");
const countNote = (n: number) => (n === 0 ? " Nothing has been learned yet." : ` ${n} learned ${n === 1 ? "entry" : "entries"} right now.`);

function cisco(s: V4LabState): CliCommand[] {
  const ifArg = { interface: interfaceArg("cisco", CISCO_IF, IF_DESC) };
  const showArp = () => {
    // IOS lists the router's own interface addresses too (age "-").
    const own = IFS.map((i) => ["Internet", i.ip, "-", ciscoMac(i.mac), "ARPA", CISCO_IF[i.id]]);
    const learned = arpRows(s).map(([ip, mac]) => ["Internet", ip, "0", ciscoMac(mac), "ARPA", CISCO_IF[ifFor(ip) ?? "ge-0/0/0"]]);
    const rows = [...own, ...learned].sort((a, b) => a[1].localeCompare(b[1], undefined, { numeric: true }));
    const out = [["Protocol", "Address", "Age (min)", "Hardware Addr", "Type", "Interface"], ...rows].map((r, k) => (k === 0 ? r : [r[0], r[1], r[2].padStart(9) + " ", r[3], r[4], r[5]]));
    return { output: columns(out, [10, 17, 11, 16, 7]), explanation: EXPLAIN.arp + countNote(learned.length) };
  };
  const brief = () => ({ output: columns([["Interface", "IP-Address", "OK?", "Method", "Status", "Protocol"], ...IFS.map((i) => [CISCO_IF[i.id], i.ip, "YES", "manual", "up", "up"])], [23, 16, 4, 7, 22]), explanation: EXPLAIN.brief });
  const route = () => {
    const lines = ["Codes: L - local, C - connected, S - static, * - candidate default", "", "Gateway of last resort is not set", "", `      192.168.10.0/24 is variably subnetted, ${IFS.length * 2} subnets, 2 masks`];
    for (const r of R1_ROUTES) {
      const i = IFS.find((x) => x.id === r.iface)!;
      lines.push(`C        ${r.prefix} is directly connected, ${CISCO_IF[i.id]}`, `L        ${i.ip}/32 is directly connected, ${CISCO_IF[i.id]}`);
    }
    return { output: lines.join("\n"), explanation: EXPLAIN.route };
  };
  const showIf = ({ interface: id }: Record<string, string>) => {
    const i = IFS.find((x) => x.id === id)!;
    return {
      output: [`${CISCO_IF[i.id]} is up, line protocol is up`, `  Hardware is iGbE, address is ${ciscoMac(i.mac)} (bia ${ciscoMac(i.mac)})`, `  Description: ${i.desc}`, `  Internet address is ${i.ip}/${V4_PREFIX}`, "  MTU 1500 bytes, BW 1000000 Kbit/sec, DLY 10 usec", "  Encapsulation ARPA, loopback not set", "  ARP type: ARPA, ARP Timeout 04:00:00"].join("\n"),
      explanation: `${EXPLAIN.ifDetail} ${i.ip}/${V4_PREFIX} = mask ${maskOf(V4_PREFIX)}, connected network ${networkOf(i.ip, V4_PREFIX)}/${V4_PREFIX}.`,
    };
  };
  return [
    { id: "interfaces-brief", syntax: "show ip interface brief", summary: "Interface status and IPv4 addresses", run: brief },
    { id: "route-table", syntax: "show ip route", summary: "IPv4 routing table", run: route },
    { id: "arp-table", syntax: "show ip arp", summary: "ARP cache: IPv4 neighbour → MAC", run: showArp },
    { id: "arp-table", syntax: "show arp", summary: "ARP cache (same as show ip arp)", run: showArp },
    { id: "interface-detail", syntax: "show interfaces <interface>", summary: "One interface in detail (Gi0/0, Gi0/1)", args: ifArg, run: showIf },
  ];
}

function junos(s: V4LabState): CliCommand[] {
  const ifArg = { interface: interfaceArg("juniper", JUNOS_IF, IF_DESC) };
  const showArp = () => {
    const rows = arpRows(s).map(([ip, mac]) => [junosMac(mac), ip, ip, `${JUNOS_IF[ifFor(ip) ?? "ge-0/0/0"]}.0`, "none"]);
    return { output: `${columns([["MAC Address", "Address", "Name", "Interface", "Flags"], ...rows], [18, 16, 16, 14])}\nTotal entries: ${rows.length}`, explanation: EXPLAIN.arp + countNote(rows.length) };
  };
  const terse = () => {
    const rows: string[][] = [];
    for (const i of IFS) rows.push([i.id, "up", "up", "", ""], [`${i.id}.0`, "up", "up", "inet", `${i.ip}/${V4_PREFIX}`]);
    return { output: columns([["Interface", "Admin", "Link", "Proto", "Local"], ...rows], [24, 6, 5, 9]), explanation: EXPLAIN.brief };
  };
  const route = () => {
    const entries = R1_ROUTES.flatMap((r) => {
      const i = IFS.find((x) => x.id === r.iface)!;
      return [
        { dest: r.prefix, proto: "Direct/0", line: `                    >  via ${i.id}.0` },
        { dest: `${i.ip}/32`, proto: "Local/0", line: `                       Local via ${i.id}.0` },
      ];
    });
    const n = entries.length;
    const lines = [`inet.0: ${n} destinations, ${n} routes (${n} active, 0 holddown, 0 hidden)`, "+ = Active Route, - = Last Active, * = Both", ""];
    for (const e of entries) lines.push(`${e.dest.padEnd(19)}*[${e.proto}] ${JUNOS_ROUTE_AGE}`, e.line);
    return { output: lines.join("\n"), explanation: EXPLAIN.route };
  };
  const showIf = ({ interface: id }: Record<string, string>) => {
    const i = IFS.find((x) => x.id === id)!;
    return {
      output: [`Physical interface: ${i.id}, Enabled, Physical link is Up`, `  Description: ${i.desc}`, "  Link-level type: Ethernet, MTU: 1514, Speed: 1000mbps", `  Current address: ${junosMac(i.mac)}, Hardware address: ${junosMac(i.mac)}`, "", `  Logical interface ${i.id}.0`, "    Protocol inet, MTU: 1500", "      Addresses, Flags: Is-Preferred Is-Primary", `        Destination: ${networkOf(i.ip, V4_PREFIX)}/${V4_PREFIX}, Local: ${i.ip}`].join("\n"),
      explanation: EXPLAIN.ifDetail,
    };
  };
  return [
    { id: "interfaces-brief", syntax: "show interfaces terse", summary: "Interface status and addresses", run: terse },
    { id: "route-table", syntax: "show route", summary: "Routing table (inet.0)", run: route },
    { id: "arp-table", syntax: "show arp", summary: "ARP cache: IPv4 neighbour → MAC", run: showArp },
    { id: "interface-detail", syntax: "show interfaces <interface>", summary: "One interface in detail (ge-0/0/0, ge-0/0/1)", args: ifArg, run: showIf },
  ];
}

const HELP: Record<CliVendor, Record<string, string>> = {
  cisco: { show: "Show running system information", "show arp": "ARP table", "show interfaces": "Interface status and configuration", "show ip": "IP information", "show ip arp": "IP ARP table", "show ip interface": "IP interface status and configuration", "show ip interface brief": "Brief summary of IP status and configuration", "show ip route": "IP routing table" },
  juniper: { show: "Show system information", "show arp": "Show Address Resolution Protocol table", "show interfaces": "Show interface information", "show interfaces terse": "Display terse output", "show route": "Show routing table information" },
};

export function r1Cli(vendor: CliVendor, s: V4LabState): CliCommandSet {
  return { vendor, deviceId: "R1", deviceName: "R1", prompt: vendor === "cisco" ? "R1#" : "user@R1> ", commands: [...(vendor === "cisco" ? cisco(s) : junos(s)), ...readOnlyBoundaryCommands(vendor)], help: HELP[vendor] };
}
export function r1CliSets(s: V4LabState): Record<CliVendor, CliCommandSet> {
  return { cisco: r1Cli("cisco", s), juniper: r1Cli("juniper", s) };
}
