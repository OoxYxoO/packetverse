import type { CliArgSpec, CliCommand, CliCommandSet, CliVendor } from "@/lib/cli/types";
import { ciscoMac, columns, interfaceArg } from "@/lib/cli/format";
import { withSelfPing } from "@/lib/cli/selfPing";
import { withShellHistory } from "@/lib/cli/shellHistory";
import {
  ARP_HOSTS,
  DEV_NAME,
  HOSTS,
  R1_IFS,
  SW_PORTS,
  SW_PORT_PEER,
  entryAge,
  hostLinkUp,
  isIp,
  maskOf,
  netOf,
  portUp,
  type ArpAction,
  type ArpHost,
  type ArpNetState,
  type CacheOwner,
  type NeighborEntry,
  type PingResult,
  type RIf,
  type SwPort,
} from "@/lib/sim-engine/scenarios/arpNet";

/**
 * Terminals of the ARP Lab. Every output is printed from the lab state of the moment shown (`view`); every command
 * that changes something goes through a lab action (`act`), which returns the resulting network so the output can
 * report what really happened. Only commands that make sense for ARP and Ethernet on this network exist.
 *
 *   Laptop, PC-C   Windows:  ipconfig, arp -a / -d / -s, netsh … show neighbors, route print, ping
 *   PC-B, Server   Linux:    ip addr, ip route, ip neigh (show/flush/del), ping
 *   R1             IOS / Junos: ARP table, interfaces, routes, clear, ping (configuration is fixed in this lab)
 *   SW1            IOS / Junos: MAC table, interface status, shutdown/enable a port, and its (empty) ARP table
 */

export type SwCiscoMode = { kind: "exec" } | { kind: "config" } | { kind: "if"; port: SwPort };
export interface ArpCliApi {
  view: ArpNetState;
  act: (a: ArpAction | ArpAction[]) => ArpNetState;
  history?: string[];
  sw: { cisco: SwCiscoMode; setCisco: (m: SwCiscoMode) => void; junosEdit: boolean; setJunosEdit: (b: boolean) => void; cand: SwPort[]; setCand: (c: SwPort[]) => void };
}

export const R1_CISCO: Record<RIf, string> = { gi0: "GigabitEthernet0/0", gi1: "GigabitEthernet0/1" };
export const R1_JUNOS: Record<RIf, string> = { gi0: "ge-0/0/0", gi1: "ge-0/0/1" };
export const SW_CISCO: Record<SwPort, string> = { fa1: "FastEthernet0/1", fa2: "FastEthernet0/2", fa3: "FastEthernet0/3", fa4: "FastEthernet0/4" };
export const SW_JUNOS: Record<SwPort, string> = { fa1: "ge-0/0/1", fa2: "ge-0/0/2", fa3: "ge-0/0/3", fa4: "ge-0/0/4" };
/** A port/interface name in the OS view the learner picked. */
export const arpIfName = (vendor: CliVendor, dev: "sw1" | "r1", id: string) =>
  dev === "sw1" ? (vendor === "cisco" ? SW_CISCO[id as SwPort].replace("FastEthernet", "Fa") : SW_JUNOS[id as SwPort]) : vendor === "cisco" ? R1_CISCO[id as RIf].replace("GigabitEthernet", "Gi") : R1_JUNOS[id as RIf];
/** Model text (written with Cisco names) in the OS view the learner picked. */
export const arpVendorText = (vendor: CliVendor, text: string) =>
  vendor === "cisco" ? text : text.replace(/\bFa0\/([1-4])\b/g, "ge-0/0/$1").replace(/\bGi0\/([01])\b/g, "ge-0/0/$1");

const refuse = (output: string, explanation?: string) => ({ output, refused: true, explanation });
const winMac = (m: string) => m.toLowerCase().replace(/:/g, "-");
const linMac = (m: string) => m.toLowerCase();
const ipArg = (choices: string[]): CliArgSpec => ({ choices, resolve: (raw) => (isIp(raw) ? raw : undefined) });
const countArg: CliArgSpec = { choices: ["1", "4"], describe: () => "number of echo requests (1–10)", resolve: (raw) => (/^\d+$/.test(raw) && Number(raw) >= 1 && Number(raw) <= 10 ? raw : undefined) };
const winMacArg: CliArgSpec = { choices: [], describe: () => "MAC as aa-bb-cc-dd-ee-ff", resolve: (raw) => (/^([0-9a-f]{2}-){5}[0-9a-f]{2}$/i.test(raw) ? raw.replace(/-/g, ":").toUpperCase() : undefined) };
const knownIps = (s: ArpNetState) => [...new Set([...ARP_HOSTS.map((h) => s.cfg[h].ip), R1_IFS.gi0.ip, R1_IFS.gi1.ip])];

const EXPLAIN = {
  cache: "An ARP cache maps IP → MAC, on THIS device only. It fills when this device resolves a next hop (or is the target of someone else's request). Switches don't hold one for the hosts.",
  incomplete: "Incomplete: a request went out and no reply came back. Nothing on that link answered for that IP.",
  mac: "A MAC address table maps MAC → port. SW1 fills it from the SOURCE MAC of every frame, ARP or not. It holds no IP addresses.",
  swArp: "SW1 has no IP address on this LAN, so it has no ARP entries: it never resolves anything. It forwards frames by MAC only, ARP frames included.",
};

// ---------------------------------------------------------------------------------------------------------------
// Ping output, per OS
// ---------------------------------------------------------------------------------------------------------------
function winPing(r: PingResult): string {
  const lines = [`Pinging ${r.dst} with 32 bytes of data:`];
  for (const x of r.replies)
    lines.push(x.kind === "reply" ? `Reply from ${r.dst}: bytes=32 time<1ms TTL=${x.ttl}` : x.kind === "host-unreachable" ? `Reply from ${x.from}: Destination host unreachable.` : x.kind === "net-unreachable" ? `Reply from ${x.from}: Destination net unreachable.` : x.kind === "no-route" ? "PING: transmit failed. General failure." : "Request timed out.");
  const rec = r.replies.filter((x) => x.kind !== "timeout" && x.kind !== "no-route").length;
  lines.push("", `Ping statistics for ${r.dst}:`, `    Packets: Sent = ${r.count}, Received = ${rec}, Lost = ${r.count - rec} (${Math.round(((r.count - rec) / r.count) * 100)}% loss),`);
  return lines.join("\n");
}
function linPing(r: PingResult, src: string, user: boolean): string {
  if (r.replies[0]?.kind === "no-route") return "ping: connect: Network is unreachable";
  const lines = [`PING ${r.dst} (${r.dst}) 56(84) bytes of data.`];
  r.replies.forEach((x, i) => {
    if (x.kind === "reply") lines.push(`64 bytes from ${r.dst}: icmp_seq=${i + 1} ttl=${x.ttl} time=0.4 ms`);
    else if (x.kind === "host-unreachable") lines.push(`From ${src} icmp_seq=${i + 1} Destination Host Unreachable`);
    else if (x.kind === "net-unreachable") lines.push(`From ${x.from} icmp_seq=${i + 1} Destination Net Unreachable`);
  });
  if (user) lines.push("^C");
  const ok = r.replies.filter((x) => x.kind === "reply").length;
  const err = r.replies.filter((x) => x.kind === "host-unreachable" || x.kind === "net-unreachable").length;
  lines.push("", `--- ${r.dst} ping statistics ---`, `${r.count} packets transmitted, ${ok} received,${err ? ` +${err} errors,` : ""} ${Math.round(((r.count - ok) / r.count) * 100)}% packet loss`);
  return lines.join("\n");
}
const pingNote = (r: PingResult) => {
  const d = r.decisions[0];
  if (!d) return undefined;
  if (d.cache === "no-route") return `${d.dst} is outside ${d.myNet} and there is no default gateway: nothing to ARP for, nothing was sent.`;
  const target = d.nextHop;
  const how = d.cache === "hit" ? `cache hit for ${target}: no ARP needed` : d.cache === "static" ? `static entry for ${target}: no ARP` : r.arped ? `cache miss for ${target}: ARP request broadcast first` : "";
  return `${d.local ? "Local" : "Remote"} destination → next hop ${target} · ${how}. Watch the topology: the frames play out there.`;
};

// ---------------------------------------------------------------------------------------------------------------
// Hosts
// ---------------------------------------------------------------------------------------------------------------
function winSet(api: ArpCliApi, h: ArpHost): CliCommandSet {
  const s = api.view;
  const c = s.cfg[h];
  const mac = HOSTS[h].mac;
  const ipc = (all: boolean) =>
    [
      "Windows IP Configuration",
      ...(all ? ["", `   Host Name . . . . . . . . . . . . : ${HOSTS[h].name}`] : []),
      "",
      "Ethernet adapter Ethernet:",
      "",
      ...(hostLinkUp(s, h) ? [] : ["   Media State . . . . . . . . . . . : Media disconnected"]),
      ...(all ? [`   Physical Address. . . . . . . . . : ${winMac(mac).toUpperCase()}`, "   DHCP Enabled. . . . . . . . . . . : No"] : []),
      `   IPv4 Address. . . . . . . . . . . : ${c.ip}`,
      `   Subnet Mask . . . . . . . . . . . : ${maskOf(c.prefix)}`,
      `   Default Gateway . . . . . . . . . : ${c.gw ?? ""}`,
    ].join("\n");
  const arpA = (only?: string) => {
    const rows = s.caches[h].filter((e) => e.state === "reachable" && (!only || e.ip === only));
    if (!rows.length) return "No ARP Entries Found.";
    return [`Interface: ${c.ip} --- 0x4`, columns([["  Internet Address", "Physical Address", "Type"], ...rows.map((e) => [`  ${e.ip}`, winMac(e.mac!), e.static ? "static" : "dynamic"])], [24, 22, 10])].join("\n");
  };
  const neigh = () => {
    const rows = s.caches[h];
    return [`Interface 4: Ethernet`, "", columns([["Internet Address", "Physical Address", "Type"], ["--------------------------------------------", "-----------------", "-----------"], ...rows.map((e) => [e.ip, e.mac ? winMac(e.mac) : "00-00-00-00-00-00", e.static ? "Permanent" : e.state === "incomplete" ? "Incomplete" : e.state === "failed" ? "Unreachable" : entryAge(s, e) < 30 ? "Reachable" : "Stale"])], [46, 21, 11])].join("\n");
  };
  const ping = (dst: string, n: number) => {
    const next = api.act({ type: "ping", src: h, dst, count: n });
    const r = next.last?.type === "ping" ? next.last.result : undefined;
    return r ? { output: winPing(r), explanation: pingNote(r) } : { output: "" };
  };
  const cmds: CliCommand[] = [
    { id: "ipconfig", syntax: "ipconfig", summary: "This PC's address, mask and gateway", run: () => ({ output: ipc(false), explanation: "The mask decides what is local: an address inside this network is ARPed directly; anything else goes to the default gateway." }) },
    { id: "ipconfig", syntax: "ipconfig /all", summary: "Everything, including this PC's MAC", run: () => ({ output: ipc(true) }) },
    { id: "arp", syntax: "arp -a", summary: "This PC's ARP cache", run: () => ({ output: arpA(), explanation: EXPLAIN.cache }) },
    { id: "arp", syntax: "arp -a <ip>", summary: "The ARP entry for one address", args: { ip: ipArg(knownIps(s)) }, run: ({ ip }) => ({ output: arpA(ip) }) },
    { id: "arp-d", syntax: "arp -d <ip>", summary: "Delete one ARP entry", args: { ip: ipArg(s.caches[h].map((e) => e.ip)) }, run: ({ ip }) => (s.caches[h].some((e) => e.ip === ip) ? (api.act({ type: "clear-cache", owner: h, ip }), { output: "", explanation: `The next packet to ${ip} (or through it) needs a new ARP request.` }) : refuse("The ARP entry deletion failed: Element not found.")) },
    { id: "arp-d", syntax: "arp -d *", summary: "Empty the ARP cache", run: () => (api.act({ type: "clear-cache", owner: h }), { output: "", explanation: "Dynamic entries are gone. Static ones stay: delete them by address." }) },
    { id: "arp-s", syntax: "arp -s <ip> <mac>", summary: "Add a static ARP entry", args: { ip: ipArg(knownIps(s)), mac: winMacArg }, run: ({ ip, mac }) => (api.act({ type: "static", owner: h, ip, mac }), { output: "", explanation: "A static entry never ages and is never changed by ARP traffic. If it is wrong, it stays wrong." }) },
    { id: "netsh", syntax: "netsh interface ipv4 show neighbors", summary: "The neighbor cache, incomplete entries included", run: () => ({ output: neigh(), explanation: `${EXPLAIN.cache} Incomplete/Unreachable rows are resolutions that got no reply.` }) },
    {
      id: "route",
      syntax: "route print",
      summary: "IPv4 routes: what is on-link, what goes to the gateway",
      run: () => ({
        output: [
          "IPv4 Route Table",
          "===========================================================================",
          "Active Routes:",
          columns([["Network Destination", "Netmask", "Gateway", "Interface", "Metric"], ...(c.gw ? [["0.0.0.0", "0.0.0.0", c.gw, c.ip, "25"]] : []), [netOf(c.ip, c.prefix), maskOf(c.prefix), "On-link", c.ip, "281"], [c.ip, "255.255.255.255", "On-link", c.ip, "281"]], [24, 18, 18, 18, 6]),
          "===========================================================================",
        ].join("\n"),
        explanation: "On-link: delivered directly (ARP for the destination itself). 0.0.0.0: everything else, sent to the gateway (ARP for the gateway).",
      }),
    },
    { id: "ping", syntax: "ping <ip>", summary: "Send 4 echo requests", args: { ip: ipArg(knownIps(s)) }, run: ({ ip }) => ping(ip, 4) },
    { id: "ping", syntax: "ping -n <count> <ip>", summary: "Send <count> echo requests", args: { count: countArg, ip: ipArg(knownIps(s)) }, run: ({ count, ip }) => ping(ip, Number(count)) },
  ];
  return { vendor: "cisco", deviceId: h, deviceName: HOSTS[h].name, prompt: "C:\\Users\\student>", commands: cmds };
}

function linSet(api: ArpCliApi, h: ArpHost): CliCommandSet {
  const s = api.view;
  const c = s.cfg[h];
  const mac = HOSTS[h].mac;
  const up = hostLinkUp(s, h);
  const neighLine = (e: NeighborEntry) => `${e.ip} dev eth0 ${e.mac && e.state === "reachable" ? `lladdr ${linMac(e.mac)} ` : " "}${e.static ? "PERMANENT" : e.state === "incomplete" ? "INCOMPLETE" : e.state === "failed" ? "FAILED" : entryAge(s, e) < 30 ? "REACHABLE" : "STALE"}`;
  const ping = (dst: string, n: number, user: boolean) => {
    const next = api.act({ type: "ping", src: h, dst, count: n });
    const r = next.last?.type === "ping" ? next.last.result : undefined;
    return r ? { output: linPing(r, c.ip, user), explanation: pingNote(r) } : { output: "" };
  };
  const addr = () =>
    [
      "1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN",
      "    inet 127.0.0.1/8 scope host lo",
      `2: eth0: <BROADCAST,MULTICAST${up ? ",UP,LOWER_UP" : ""}> mtu 1500 qdisc fq_codel state ${up ? "UP" : "DOWN"}`,
      `    link/ether ${linMac(mac)} brd ff:ff:ff:ff:ff:ff`,
      `    inet ${c.ip}/${c.prefix} brd ${netOf(c.ip, c.prefix).split(".").slice(0, 3).join(".")}.255 scope global eth0`,
    ].join("\n");
  const cmds: CliCommand[] = [
    { id: "ip-a", syntax: "ip addr", summary: "Addresses and this host's MAC", run: () => ({ output: addr() }) },
    { id: "ip-a", syntax: "ip a", summary: "Short for ip addr", hidden: true, run: () => ({ output: addr() }) },
    { id: "ip-r", syntax: "ip route", summary: "Routes: what is on-link, what goes via the gateway", run: () => ({ output: [...(c.gw ? [`default via ${c.gw} dev eth0`] : []), `${netOf(c.ip, c.prefix)}/${c.prefix} dev eth0 proto kernel scope link src ${c.ip}`].join("\n"), explanation: "scope link: delivered directly (ARP for the destination). default via: everything else goes to the gateway (ARP for the gateway)." }) },
    { id: "ip-r", syntax: "ip r", summary: "Short for ip route", hidden: true, run: () => ({ output: [...(c.gw ? [`default via ${c.gw} dev eth0`] : []), `${netOf(c.ip, c.prefix)}/${c.prefix} dev eth0 proto kernel scope link src ${c.ip}`].join("\n") }) },
    { id: "ip-n", syntax: "ip neigh", summary: "The neighbor (ARP) cache", run: () => ({ output: s.caches[h].map(neighLine).join("\n"), explanation: `${EXPLAIN.cache} REACHABLE: confirmed recently. STALE: still used, but older than 30 s. INCOMPLETE/FAILED: no reply.` }) },
    { id: "ip-n", syntax: "ip n", summary: "Short for ip neigh", hidden: true, run: () => ({ output: s.caches[h].map(neighLine).join("\n") }) },
    { id: "ip-n", syntax: "ip neigh show <ip>", summary: "The entry for one address", args: { ip: ipArg(knownIps(s)) }, run: ({ ip }) => { const o = s.caches[h].filter((e) => e.ip === ip).map(neighLine).join("\n"); return { output: o, explanation: o ? undefined : `No entry for ${ip}: this host has not resolved it (Linux prints nothing).` }; } },
    { id: "ip-nf", syntax: "ip neigh flush all", summary: "Empty the neighbor cache", run: () => (api.act({ type: "clear-cache", owner: h }), { output: "", explanation: "Learned entries are gone; the next packet to each neighbor starts with an ARP request." }) },
    { id: "ip-nd", syntax: "ip neigh del <ip> dev eth0", summary: "Delete one entry", args: { ip: ipArg(s.caches[h].map((e) => e.ip)) }, run: ({ ip }) => (s.caches[h].some((e) => e.ip === ip) ? (api.act({ type: "clear-cache", owner: h, ip }), { output: "" }) : refuse("RTNETLINK answers: No such file or directory")) },
    { id: "ping", syntax: "ping <ip>", summary: "Ping until Ctrl+C (here: 4 echoes)", args: { ip: ipArg(knownIps(s)) }, run: ({ ip }) => ping(ip, 4, true) },
    { id: "ping", syntax: "ping -c <count> <ip>", summary: "Send <count> echo requests", args: { count: countArg, ip: ipArg(knownIps(s)) }, run: ({ count, ip }) => ping(ip, Number(count), false) },
  ];
  return { vendor: "cisco", deviceId: h, deviceName: HOSTS[h].name, prompt: `student@${HOSTS[h].name.toLowerCase()}:~$ `, commands: cmds };
}

export function arpHostSet(api: ArpCliApi, h: ArpHost): CliCommandSet {
  return HOSTS[h].os === "windows" ? withShellHistory(withSelfPing(winSet(api, h), "windows", [api.view.cfg[h].ip]), "windows", api.history) : withShellHistory(withSelfPing(linSet(api, h), "linux", [api.view.cfg[h].ip]), "linux", api.history);
}

// ---------------------------------------------------------------------------------------------------------------
// R1
// ---------------------------------------------------------------------------------------------------------------
function r1Rows(s: ArpNetState) {
  return s.caches.r1;
}
function r1Cisco(api: ArpCliApi): CliCommandSet {
  const s = api.view;
  const ifArg = interfaceArg("cisco", R1_CISCO, { gi0: "LAN (192.168.10.1/24)", gi1: "Server segment (10.20.20.1/24)" });
  const table = (filter: (e: NeighborEntry | { own: RIf }) => boolean) => {
    const own = (Object.keys(R1_IFS) as RIf[]).map((i) => ({ own: i })).filter(filter);
    const rows = r1Rows(s).filter(filter);
    return columns(
      [
        ["Protocol", "Address", "Age (min)", "Hardware Addr", "Type", "Interface"],
        ...own.map((o) => ["Internet", R1_IFS[(o as { own: RIf }).own].ip, "-", ciscoMac(R1_IFS[(o as { own: RIf }).own].mac), "ARPA", R1_CISCO[(o as { own: RIf }).own]]),
        ...rows.map((e) => ["Internet", e.ip, e.state === "reachable" ? String(Math.floor(entryAge(s, e) / 60)) : "0", e.state === "reachable" ? ciscoMac(e.mac!) : "Incomplete", "ARPA", e.state === "reachable" ? R1_CISCO[e.iface as RIf] : ""]),
      ],
      [10, 17, 11, 16, 7, 20],
    );
  };
  const ping = (dst: string, n: number) => {
    const next = api.act({ type: "ping", src: "r1", dst, count: n });
    const r = next.last?.type === "ping" ? next.last.result : undefined;
    if (!r) return { output: "" };
    const marks = r.replies.map((x) => (x.kind === "reply" ? "!" : x.kind === "net-unreachable" ? "U" : ".")).join("");
    const ok = r.replies.filter((x) => x.kind === "reply").length;
    return { output: ["Type escape sequence to abort.", `Sending ${n}, 100-byte ICMP Echos to ${dst}, timeout is 2 seconds:`, marks, `Success rate is ${Math.round((ok / n) * 100)} percent (${ok}/${n})`].join("\n"), explanation: pingNote(r) };
  };
  const cmds: CliCommand[] = [
    { id: "arp", syntax: "show ip arp", summary: "R1's ARP table (both interfaces)", run: () => ({ output: table(() => true), explanation: `${EXPLAIN.cache} R1's own addresses show Age "-". "Incomplete" = asked, never answered.` }) },
    { id: "arp", syntax: "show arp", summary: "Same table", hidden: true, run: () => ({ output: table(() => true) }) },
    { id: "arp", syntax: "show ip arp <ip>", summary: "One address", args: { ip: ipArg(knownIps(s)) }, run: ({ ip }) => ({ output: table((e) => ("own" in e ? R1_IFS[e.own].ip === ip : e.ip === ip)) }) },
    { id: "arp", syntax: "show ip arp <interface>", summary: "Entries learned on one interface", args: { interface: ifArg }, run: ({ interface: i }) => ({ output: table((e) => ("own" in e ? e.own === i : e.iface === i)) }) },
    { id: "clear", syntax: "clear arp-cache", summary: "Flush R1's dynamic ARP entries", run: () => (api.act({ type: "clear-cache", owner: "r1" }), { output: "", explanation: "R1 must ARP again for every next hop before forwarding to it." }) },
    { id: "clear", syntax: "clear ip arp <ip>", summary: "Remove one entry", args: { ip: ipArg(r1Rows(s).map((e) => e.ip)) }, run: ({ ip }) => (api.act({ type: "clear-cache", owner: "r1", ip }), { output: "" }) },
    {
      id: "brief",
      syntax: "show ip interface brief",
      summary: "Interfaces, addresses and status",
      run: () => ({ output: columns([["Interface", "IP-Address", "OK?", "Method", "Status", "Protocol"], ["GigabitEthernet0/0", R1_IFS.gi0.ip, "YES", "manual", "up", "up"], ["GigabitEthernet0/1", R1_IFS.gi1.ip, "YES", "manual", s.power.server ? "up" : "down", s.power.server ? "up" : "down"]], [23, 16, 4, 7, 22, 8]) }),
    },
    { id: "route", syntax: "show ip route", summary: "Routing table", run: () => ({ output: ["Codes: L - local, C - connected", "", "Gateway of last resort is not set", "", "      10.0.0.0/8 is variably subnetted, 2 subnets, 2 masks", "C        10.20.20.0/24 is directly connected, GigabitEthernet0/1", "L        10.20.20.1/32 is directly connected, GigabitEthernet0/1", "      192.168.10.0/24 is variably subnetted, 2 subnets, 2 masks", "C        192.168.10.0/24 is directly connected, GigabitEthernet0/0", "L        192.168.10.1/32 is directly connected, GigabitEthernet0/0"].join("\n"), explanation: "Connected networks: R1 delivers to these itself, so it ARPs for the destination on that interface. No other routes: anything else is unreachable." }) },
    { id: "intf", syntax: "show interfaces <interface>", summary: "One interface, with its MAC", args: { interface: ifArg }, run: ({ interface: i }) => ({ output: [`${R1_CISCO[i as RIf]} is up, line protocol is up`, `  Hardware is iGbE, address is ${ciscoMac(R1_IFS[i as RIf].mac)} (bia ${ciscoMac(R1_IFS[i as RIf].mac)})`, `  Internet address is ${R1_IFS[i as RIf].ip}/24`, "  ARP type: ARPA, ARP Timeout 00:20:00"].join("\n") }) },
    { id: "run", syntax: "show running-config", summary: "R1's configuration", run: () => ({ output: ["hostname R1", "!", ...(Object.keys(R1_IFS) as RIf[]).flatMap((i) => [`interface ${R1_CISCO[i]}`, ` ip address ${R1_IFS[i].ip} 255.255.255.0`, " arp timeout 1200", "!"]), "end"].join("\n") }) },
    { id: "ping", syntax: "ping <ip>", summary: "Send 5 echo requests", args: { ip: ipArg(knownIps(s)) }, run: ({ ip }) => ping(ip, 5) },
    { id: "ping", syntax: "ping <ip> repeat <count>", summary: "Send <count> echo requests", args: { ip: ipArg(knownIps(s)), count: countArg }, run: ({ ip, count }) => ping(ip, Number(count)) },
    { id: "conf", syntax: "configure terminal", summary: "Configuration mode", hidden: true, run: () => refuse("% R1's configuration is fixed in this lab.", "Nothing about ARP needs configuring on R1 here: inspect it, clear it, and ping from it.") },
    { id: "hist", syntax: "show history", summary: "Commands typed in this session", run: () => ({ output: [...(api.history ?? []), "show history"].map((x) => `  ${x}`).join("\n") }) },
  ];
  return { vendor: "cisco", deviceId: "r1", deviceName: "R1", prompt: "R1#", commands: cmds };
}
function r1Junos(api: ArpCliApi): CliCommandSet {
  const s = api.view;
  const ifArg = interfaceArg("juniper", R1_JUNOS, { gi0: "LAN (192.168.10.1/24)", gi1: "Server segment (10.20.20.1/24)" });
  const table = (rows: NeighborEntry[], resolve = true) => {
    const ok = rows.filter((e) => e.state === "reachable");
    return [columns([["MAC Address", "Address", "Name", "Interface", "Flags"], ...ok.map((e) => [e.mac!.toLowerCase(), e.ip, resolve ? e.ip : "", `${R1_JUNOS[e.iface as RIf]}.0`, "none"])], [18, 16, resolve ? 26 : 1, 24, 6]), `Total entries: ${ok.length}`].join("\n");
  };
  const ping = (dst: string, n: number, user: boolean) => {
    const next = api.act({ type: "ping", src: "r1", dst, count: n });
    const r = next.last?.type === "ping" ? next.last.result : undefined;
    if (!r) return { output: "" };
    const src = dst.startsWith("10.20.20.") ? R1_IFS.gi1.ip : R1_IFS.gi0.ip;
    return { output: linPing(r, src, user).replace(/\n\n---/, "\n\n---"), explanation: pingNote(r) };
  };
  const cmds: CliCommand[] = [
    { id: "arp", syntax: "show arp", summary: "R1's ARP table", run: () => ({ output: table(r1Rows(s)), explanation: `${EXPLAIN.cache} Junos lists only resolved entries.` }) },
    { id: "arp", syntax: "show arp no-resolve", summary: "Without name lookups", run: () => ({ output: table(r1Rows(s), false) }) },
    { id: "arp", syntax: "show arp interface <iface>", summary: "Entries on one interface", args: { iface: ifArg }, run: ({ iface }) => ({ output: table(r1Rows(s).filter((e) => e.iface === iface)) }) },
    { id: "arp", syntax: "show arp hostname <ip>", summary: "One address", args: { ip: ipArg(knownIps(s)) }, run: ({ ip }) => ({ output: table(r1Rows(s).filter((e) => e.ip === ip)) }) },
    { id: "clear", syntax: "clear arp", summary: "Flush R1's dynamic ARP entries", run: () => (api.act({ type: "clear-cache", owner: "r1" }), { output: "", explanation: "R1 must ARP again for every next hop before forwarding to it." }) },
    { id: "clear", syntax: "clear arp hostname <ip>", summary: "Remove one entry", args: { ip: ipArg(r1Rows(s).map((e) => e.ip)) }, run: ({ ip }) => (api.act({ type: "clear-cache", owner: "r1", ip }), { output: "" }) },
    { id: "terse", syntax: "show interfaces terse", summary: "Interfaces and addresses", run: () => ({ output: columns([["Interface", "Admin", "Link", "Proto", "Local"], ["ge-0/0/0", "up", "up", "", ""], ["ge-0/0/0.0", "up", "up", "inet", "192.168.10.1/24"], ["ge-0/0/1", "up", s.power.server ? "up" : "down", "", ""], ["ge-0/0/1.0", "up", s.power.server ? "up" : "down", "inet", "10.20.20.1/24"]], [16, 6, 5, 6, 18]) }) },
    { id: "route", syntax: "show route", summary: "Routing table", run: () => ({ output: ["inet.0: 4 destinations, 4 routes (4 active, 0 holddown, 0 hidden)", "+ = Active Route, - = Last Active, * = Both", "", "10.20.20.0/24      *[Direct/0] 1w0d", "                    >  via ge-0/0/1.0", "10.20.20.1/32      *[Local/0] 1w0d", "                       Local via ge-0/0/1.0", "192.168.10.0/24    *[Direct/0] 1w0d", "                    >  via ge-0/0/0.0", "192.168.10.1/32    *[Local/0] 1w0d", "                       Local via ge-0/0/0.0"].join("\n"), explanation: "Direct routes: R1 delivers to these itself, so it ARPs for the destination on that interface." }) },
    { id: "intf", syntax: "show interfaces <iface>", summary: "One interface, with its MAC", args: { iface: ifArg }, run: ({ iface }) => ({ output: [`Physical interface: ${R1_JUNOS[iface as RIf]}, Enabled, Physical link is Up`, `  Current address: ${R1_IFS[iface as RIf].mac.toLowerCase()}, Hardware address: ${R1_IFS[iface as RIf].mac.toLowerCase()}`, `  Logical interface ${R1_JUNOS[iface as RIf]}.0`, `    Protocol inet, Local: ${R1_IFS[iface as RIf].ip}/24`].join("\n") }) },
    { id: "ping", syntax: "ping <ip>", summary: "Ping until Ctrl+C (here: 5 echoes)", args: { ip: ipArg(knownIps(s)) }, run: ({ ip }) => ping(ip, 5, true) },
    { id: "ping", syntax: "ping <ip> count <count>", summary: "Send <count> echo requests", args: { ip: ipArg(knownIps(s)), count: countArg }, run: ({ ip, count }) => ping(ip, Number(count), false) },
    { id: "conf", syntax: "configure", summary: "Configuration mode", hidden: true, run: () => refuse("error: R1's configuration is fixed in this lab", "Nothing about ARP needs configuring on R1 here: inspect it, clear it, and ping from it.") },
    { id: "hist", syntax: "show cli history", summary: "Commands typed in this session", run: () => ({ output: [...(api.history ?? []), "show cli history"].map((x) => `  ${x}`).join("\n") }) },
  ];
  return { vendor: "juniper", deviceId: "r1", deviceName: "R1", prompt: "admin@R1> ", commands: cmds };
}

// ---------------------------------------------------------------------------------------------------------------
// SW1
// ---------------------------------------------------------------------------------------------------------------
const peerName = (p: SwPort) => DEV_NAME[SW_PORT_PEER[p]];
function swCisco(api: ArpCliApi): CliCommandSet {
  const s = api.view;
  const ifArg = interfaceArg("cisco", SW_CISCO, Object.fromEntries(SW_PORTS.map((p) => [p, `${peerName(p)}-facing port`])));
  const macTable = (f: (mac: string, port: SwPort) => boolean) => {
    const rows = Object.entries(s.swMac).filter(([m, e]) => f(m, e.port));
    return ["          Mac Address Table", "-------------------------------------------", "", columns([["Vlan", "Mac Address", "Type", "Ports"], ["----", "-----------", "--------", "-----"], ...rows.map(([m, e]) => ["   1", ciscoMac(m), "DYNAMIC", SW_CISCO[e.port].replace("FastEthernet", "Fa")])], [8, 18, 12, 6]), `Total Mac Addresses for this criterion: ${rows.length}`].join("\n");
  };
  const mode = api.sw.cisco;
  const prompt = mode.kind === "exec" ? "SW1#" : mode.kind === "config" ? "SW1(config)#" : "SW1(config-if)#";
  const show: CliCommand[] = [
    { id: "mac", syntax: "show mac address-table", summary: "MAC → port, learned from source MACs", run: () => ({ output: macTable(() => true), explanation: EXPLAIN.mac }) },
    { id: "mac", syntax: "show mac address-table dynamic", summary: "Learned entries", run: () => ({ output: macTable(() => true) }) },
    { id: "mac", syntax: "show mac address-table interface <interface>", summary: "Entries on one port", args: { interface: ifArg }, run: ({ interface: p }) => ({ output: macTable((_, port) => port === p) }) },
    { id: "status", syntax: "show interfaces status", summary: "Ports and link state", run: () => ({ output: columns([["Port", "Name", "Status", "Vlan", "Duplex", "Speed", "Type"], ...SW_PORTS.map((p) => [SW_CISCO[p].replace("FastEthernet", "Fa"), peerName(p), s.swShut.includes(p) ? "disabled" : portUp(s, p) ? "connected" : "notconnect", "1", !s.swShut.includes(p) && portUp(s, p) ? "a-full" : "auto", !s.swShut.includes(p) && portUp(s, p) ? "a-100" : "auto", "10/100BaseTX"])], [10, 10, 13, 6, 8, 8, 12]), explanation: "disabled = shut down on SW1; notconnect = no link from the device (cable or power)." }) },
    { id: "swarp", syntax: "show ip arp", summary: "SW1's ARP table", run: () => ({ output: "", explanation: EXPLAIN.swArp }) },
  ];
  const cmds: CliCommand[] =
    mode.kind === "exec"
      ? [
          ...show,
          { id: "clear", syntax: "clear mac address-table dynamic", summary: "Forget learned MACs", run: () => (api.act({ type: "sw-clear" }), { output: "", explanation: "Only SW1's MAC table is cleared. Every host's ARP cache is untouched: different table, different device." }) },
          { id: "conf", syntax: "configure terminal", summary: "Configuration mode", run: () => (api.sw.setCisco({ kind: "config" }), { output: "Enter configuration commands, one per line.  End with CNTL/Z." }) },
          { id: "hist", syntax: "show history", summary: "Commands typed in this session", run: () => ({ output: [...(api.history ?? []), "show history"].map((x) => `  ${x}`).join("\n") }) },
        ]
      : [
          ...show.map((c) => ({ ...c, id: `do:${c.id}`, syntax: `do ${c.syntax}` })),
          { id: "if", syntax: "interface <interface>", summary: "Configure a port", args: { interface: ifArg }, run: ({ interface: p }) => (api.sw.setCisco({ kind: "if", port: p as SwPort }), { output: "" }) },
          ...(mode.kind === "if"
            ? [
                { id: "shut", syntax: "shutdown", summary: "Disable this port", run: () => (api.act({ type: "sw-shut", port: (mode as { port: SwPort }).port, shut: true }), { output: `%LINK-5-CHANGED: Interface ${SW_CISCO[(mode as { port: SwPort }).port]}, changed state to administratively down` }) },
                { id: "noshut", syntax: "no shutdown", summary: "Enable this port", run: () => (api.act({ type: "sw-shut", port: (mode as { port: SwPort }).port, shut: false }), { output: `%LINK-3-UPDOWN: Interface ${SW_CISCO[(mode as { port: SwPort }).port]}, changed state to up` }) },
              ]
            : []),
          { id: "exit", syntax: "exit", summary: "Up one level", run: () => (api.sw.setCisco(mode.kind === "if" ? { kind: "config" } : { kind: "exec" }), { output: "" }) },
          { id: "end", syntax: "end", summary: "Back to privileged mode", run: () => (api.sw.setCisco({ kind: "exec" }), { output: "" }) },
        ];
  return { vendor: "cisco", deviceId: "sw1", deviceName: "SW1", prompt, commands: cmds };
}
function swJunos(api: ArpCliApi): CliCommandSet {
  const s = api.view;
  const ifArg = interfaceArg("juniper", SW_JUNOS, Object.fromEntries(SW_PORTS.map((p) => [p, `${peerName(p)}-facing port`])));
  const table = () => {
    const rows = Object.entries(s.swMac);
    return ["MAC flags (S - static MAC, D - dynamic MAC)", "", `Ethernet switching table : ${rows.length} entries, ${rows.length} learned`, "Routing instance : default-switch", columns([["   Vlan", "MAC", "MAC", "Logical"], ["   name", "address", "flags", "interface"], ...rows.map(([m, e]) => ["   default", m.toLowerCase(), "D", `${SW_JUNOS[e.port]}.0`])], [13, 20, 8, 12])].join("\n");
  };
  const edit = api.sw.junosEdit;
  const cand = api.sw.cand;
  const dirty = SW_PORTS.some((p) => cand.includes(p) !== s.swShut.includes(p));
  const commitSw = (quit: boolean) => {
    const changes: ArpAction[] = SW_PORTS.filter((p) => cand.includes(p) !== s.swShut.includes(p)).map((p) => ({ type: "sw-shut", port: p, shut: cand.includes(p) }));
    if (changes.length) api.act(changes);
    if (quit) api.sw.setJunosEdit(false);
    return { output: quit ? "commit complete\nExiting configuration mode" : "commit complete" };
  };
  const show: CliCommand[] = [
    { id: "mac", syntax: "show ethernet-switching table", summary: "MAC → port, learned from source MACs", run: () => ({ output: table(), explanation: EXPLAIN.mac }) },
    { id: "terse", syntax: "show interfaces terse", summary: "Ports and link state", run: () => ({ output: columns([["Interface", "Admin", "Link", "Proto"], ...SW_PORTS.flatMap((p) => [[SW_JUNOS[p], s.swShut.includes(p) ? "down" : "up", portUp(s, p) ? "up" : "down", ""], [`${SW_JUNOS[p]}.0`, s.swShut.includes(p) ? "down" : "up", portUp(s, p) ? "up" : "down", "eth-switch"]])], [16, 6, 5, 10]), explanation: "Admin down = disabled on SW1; Link down = no signal from the device." }) },
    { id: "swarp", syntax: "show arp", summary: "SW1's ARP table", run: () => ({ output: "", explanation: EXPLAIN.swArp }) },
  ];
  const cmds: CliCommand[] = !edit
    ? [
        ...show,
        { id: "clear", syntax: "clear ethernet-switching table", summary: "Forget learned MACs", run: () => (api.act({ type: "sw-clear" }), { output: "", explanation: "Only SW1's MAC table is cleared. Every host's ARP cache is untouched: different table, different device." }) },
        { id: "conf", syntax: "configure", summary: "Configuration mode", run: () => (dirty || api.sw.setCand(s.swShut), api.sw.setJunosEdit(true), { output: dirty ? "Entering configuration mode\nThe configuration has been changed but not committed\n" : "Entering configuration mode\n" }) },
        { id: "hist", syntax: "show cli history", summary: "Commands typed in this session", run: () => ({ output: [...(api.history ?? []), "show cli history"].map((x) => `  ${x}`).join("\n") }) },
      ]
    : [
        ...show.map((c) => ({ ...c, id: `run:${c.id}`, syntax: `run ${c.syntax}` })),
        { id: "set-dis", syntax: "set interfaces <iface> disable", summary: "Disable a port (on commit)", args: { iface: ifArg }, run: ({ iface }) => (api.sw.setCand([...new Set([...cand, iface as SwPort])]), { output: "" }) },
        { id: "del-dis", syntax: "delete interfaces <iface> disable", summary: "Enable a port again (on commit)", args: { iface: ifArg }, run: ({ iface }) => (cand.includes(iface as SwPort) ? (api.sw.setCand(cand.filter((p) => p !== iface)), { output: "" }) : refuse("warning: statement not found")) },
        { id: "show", syntax: "show interfaces", summary: "Candidate port configuration", run: () => ({ output: cand.length ? cand.map((p) => `${SW_JUNOS[p]} {\n    disable;\n}`).join("\n") : "", explanation: cand.length ? undefined : "No port is disabled in the candidate: nothing to show under interfaces." }) },
        { id: "commit", syntax: "commit", summary: "Apply the candidate", run: () => commitSw(false) },
        { id: "commit-quit", syntax: "commit and-quit", summary: "Apply the candidate and leave configuration mode", run: () => commitSw(true) },
        { id: "commit-check", syntax: "commit check", summary: "Validate the candidate without applying it", run: () => ({ output: "configuration check succeeds", explanation: dirty ? "Valid, but nothing is applied until you commit." : undefined }) },
        { id: "rollback", syntax: "rollback", summary: "Discard uncommitted changes", run: () => (api.sw.setCand(s.swShut), { output: "load complete" }) },
        { id: "exit", syntax: "exit", summary: "Leave configuration mode", run: () => (api.sw.setJunosEdit(false), dirty ? { output: "The configuration has been changed but not committed\nExiting configuration mode", explanation: "The candidate keeps your changes: configure again and commit, or rollback to discard them." } : { output: "Exiting configuration mode" }) },
      ];
  return { vendor: "juniper", deviceId: "sw1", deviceName: "SW1", prompt: edit ? "admin@SW1# " : "admin@SW1> ", commands: cmds };
}

export function arpR1Sets(api: ArpCliApi): Record<CliVendor, CliCommandSet> {
  const own = [R1_IFS.gi0.ip, R1_IFS.gi1.ip];
  return { cisco: withSelfPing(r1Cisco(api), "ios", own), juniper: withSelfPing(r1Junos(api), "junos", own) };
}
export function arpSwSets(api: ArpCliApi): Record<CliVendor, CliCommandSet> {
  return { cisco: swCisco(api), juniper: swJunos(api) };
}
export const ownerLabel = (o: CacheOwner) => DEV_NAME[o];
