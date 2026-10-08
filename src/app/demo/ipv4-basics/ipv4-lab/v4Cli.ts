import type { CliArgSpec, CliCommand, CliCommandSet, CliVendor } from "@/lib/cli/types";
import { ciscoMac, columns, interfaceArg } from "@/lib/cli/format";
import { withSelfPing } from "@/lib/cli/selfPing";
import { withShellHistory } from "@/lib/cli/shellHistory";
import { maskOf, networkOf } from "@/lib/sim-engine/scenarios/ipv4Basics";
import { V4_HOSTS, V4_HOST_IDS, V4_R1, hex4, v4IfName, v4Routes, type V4Action, type V4H, type V4IfCfg, type V4NetState, type V4PingResult, type V4R1If } from "@/lib/sim-engine/scenarios/ipv4Net";
import type { CliQuestion } from "@/app/demo/dhcp-dns/dhcp-lab/dhcpBuildCli";

/**
 * Terminals of the IPv4 Lab. Every output is printed from the network state of the moment shown (`view`); every change
 * goes through a lab action (`act`), which returns the resulting network so the output reports what really happened.
 *
 *   HOST-A, HOST-B   Linux:   ip addr, ip route, ip neigh, ping (-c count, -t ttl)
 *   HOST-C           Windows: ipconfig, route print, arp -a, ping (-n count, -i ttl)
 *   R1               Cisco IOS (changes apply on Enter) or Junos (candidate → commit, rollback, show | compare):
 *                    interfaces and their addresses, connected routes, ARP, counters, ping
 */

export type V4CiscoMode = { kind: "exec" } | { kind: "config" } | { kind: "if"; iface: V4R1If };
export interface V4Commit {
  r1: Record<V4R1If, V4IfCfg>;
  at: number;
  by: string;
}
export interface V4CliApi {
  view: V4NetState;
  act: (a: V4Action) => V4NetState;
  history?: string[];
  cisco: V4CiscoMode;
  setCisco: (m: V4CiscoMode) => void;
  junosEdit: boolean;
  setJunosEdit: (b: boolean) => void;
  cand: Record<V4R1If, V4IfCfg>;
  setCand: (c: Record<V4R1If, V4IfCfg>) => void;
  hist: V4Commit[];
  commit: (r1: Record<V4R1If, V4IfCfg>) => void;
  ask?: (q: CliQuestion | undefined) => void;
}

export const V4_CISCO_IF: Record<V4R1If, string> = { ge0: "GigabitEthernet0/0", ge1: "GigabitEthernet0/1" };
/** R1's interface in the OS view the learner picked (Cisco short form, or Junos). */
export const v4IfLabel = (vendor: CliVendor, i: V4R1If) => (vendor === "cisco" ? V4_CISCO_IF[i].replace("GigabitEthernet", "Gi") : v4IfName(i));
/** Model text (written with Junos names) in the OS view the learner picked. */
export const v4VendorText = (vendor: CliVendor, t: string) => (vendor === "cisco" ? t.replace(/\bge-0\/0\/([01])\b/g, "Gi0/$1") : t);

const refuse = (output: string, explanation?: string) => ({ output, refused: true, explanation });
const isIp = (s: string) => /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(s) && s.split(".").every((o) => Number(o) <= 255);
const prefixOfMask = (m: string) => {
  if (!isIp(m)) return undefined;
  for (let p = 0; p <= 32; p++) if (maskOf(p) === m) return p;
  return undefined;
};
const knownIps = (s: V4NetState) => [...new Set([...V4_HOST_IDS.map((h) => s.cfg[h].ip), s.r1.ge0.ip, s.r1.ge1.ip])];
const ipArg = (s: V4NetState): CliArgSpec => ({ choices: knownIps(s), resolve: (raw) => (isIp(raw) ? raw : undefined) });
const countArg: CliArgSpec = { choices: ["1", "4"], describe: () => "number of echo requests (1–10)", resolve: (raw) => (/^\d+$/.test(raw) && +raw >= 1 && +raw <= 10 ? raw : undefined) };
const ttlArg: CliArgSpec = { choices: ["1", "2", "64"], describe: () => "IPv4 TTL for the echo requests (1–255)", resolve: (raw) => (/^\d+$/.test(raw) && +raw >= 1 && +raw <= 255 ? raw : undefined) };
const EXPLAIN = {
  route: "A host's routing table is its whole local/remote decision: its own network is on-link (delivered directly, ARP for the destination); everything else goes via the default gateway (ARP for the gateway).",
  addr: "Address + prefix = which addresses this host believes are on its own wire. The prefix is the host's own setting: a wrong one changes every local/remote decision.",
  arp: "The ARP cache only ever holds NEXT HOPS: the gateway for remote destinations, the destination itself for local ones.",
};

const pingNote = (r: V4PingResult) => {
  const d = r.decisions[0];
  if (!d) return undefined;
  if (d.cache === "no-route") return `${d.dst} AND ${maskOf(d.prefix)} = ${d.dstNet} ≠ ${d.srcNet}: remote, and no default gateway — nothing was sent.`;
  return `${d.dst} AND ${maskOf(d.prefix)} = ${d.dstNet} ${d.local ? "=" : "≠"} ${d.srcNet} → ${d.local ? "LOCAL: frame straight to the destination" : `REMOTE: frame to the gateway ${d.nextHop}`}. Watch it on the topology.`;
};
function linPing(r: V4PingResult, src: string, user: boolean) {
  if (r.replies[0]?.kind === "no-route") return "ping: connect: Network is unreachable";
  const lines = [`PING ${r.dst} (${r.dst}) 56(84) bytes of data.`];
  r.replies.forEach((x, i) => {
    if (x.kind === "reply") lines.push(`64 bytes from ${r.dst}: icmp_seq=${i + 1} ttl=${x.ttl} time=0.5 ms`);
    else if (x.kind === "host-unreachable") lines.push(`From ${src} icmp_seq=${i + 1} Destination Host Unreachable`);
    else if (x.kind === "net-unreachable") lines.push(`From ${x.from} icmp_seq=${i + 1} Destination Net Unreachable`);
    else if (x.kind === "ttl-expired") lines.push(`From ${x.from} icmp_seq=${i + 1} Time to live exceeded`);
  });
  if (user) lines.push("^C");
  const ok = r.replies.filter((x) => x.kind === "reply").length;
  const err = r.replies.filter((x) => x.kind !== "reply" && x.kind !== "timeout").length;
  lines.push("", `--- ${r.dst} ping statistics ---`, `${r.count} packets transmitted, ${ok} received,${err ? ` +${err} errors,` : ""} ${Math.round(((r.count - ok) / r.count) * 100)}% packet loss`);
  return lines.join("\n");
}
function winPing(r: V4PingResult) {
  const lines = [`Pinging ${r.dst} with 32 bytes of data:`];
  for (const x of r.replies)
    lines.push(
      x.kind === "reply"
        ? `Reply from ${r.dst}: bytes=32 time<1ms TTL=${x.ttl}`
        : x.kind === "host-unreachable"
          ? `Reply from ${x.from}: Destination host unreachable.`
          : x.kind === "net-unreachable"
            ? `Reply from ${x.from}: Destination net unreachable.`
            : x.kind === "ttl-expired"
              ? `Reply from ${x.from}: TTL expired in transit.`
              : x.kind === "no-route"
                ? "PING: transmit failed. General failure."
                : "Request timed out.",
    );
  const rec = r.replies.filter((x) => x.kind !== "timeout" && x.kind !== "no-route").length;
  lines.push("", `Ping statistics for ${r.dst}:`, `    Packets: Sent = ${r.count}, Received = ${rec}, Lost = ${r.count - rec} (${Math.round(((r.count - rec) / r.count) * 100)}% loss),`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------------------------------------------
// Hosts
// ---------------------------------------------------------------------------------------------------------------
function linuxSet(api: V4CliApi, h: V4H): CliCommandSet {
  const s = api.view;
  const c = s.cfg[h];
  const mac = V4_HOSTS[h].mac.toLowerCase();
  const bcast = (() => {
    const net = networkOf(c.ip, c.prefix).split(".").map(Number);
    const n = ((net[0] << 24) | (net[1] << 16) | (net[2] << 8) | net[3]) >>> 0;
    const b = (n + 2 ** (32 - c.prefix) - 1) >>> 0;
    return [24, 16, 8, 0].map((x) => (b >>> x) & 255).join(".");
  })();
  const addr = () => ["1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN", "    inet 127.0.0.1/8 scope host lo", "2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc fq_codel state UP", `    link/ether ${mac} brd ff:ff:ff:ff:ff:ff`, `    inet ${c.ip}/${c.prefix} brd ${bcast} scope global eth0`].join("\n");
  const route = () => [...(c.gw ? [`default via ${c.gw} dev eth0`] : []), `${networkOf(c.ip, c.prefix)}/${c.prefix} dev eth0 proto kernel scope link src ${c.ip}`].join("\n");
  const neigh = () => s.caches[h].map((e) => (e.state === "reachable" ? `${e.ip} dev eth0 lladdr ${e.mac!.toLowerCase()} REACHABLE` : `${e.ip} dev eth0  FAILED`)).join("\n");
  const ping = (dst: string, n: number, ttl: number | undefined, user: boolean) => {
    const r = api.act({ type: "ping", src: h, dst, count: n, ttl }).last;
    return r?.type === "ping" ? { output: linPing(r.result, c.ip, user), explanation: pingNote(r.result) } : { output: "" };
  };
  const cmds: CliCommand[] = [
    { id: "addr", syntax: "ip addr", summary: "Address, prefix and MAC", run: () => ({ output: addr(), explanation: EXPLAIN.addr }) },
    { id: "addr", syntax: "ip a", summary: "Short for ip addr", hidden: true, run: () => ({ output: addr() }) },
    { id: "route", syntax: "ip route", summary: "Routing table: on-link network and default gateway", run: () => ({ output: route(), explanation: EXPLAIN.route }) },
    { id: "route", syntax: "ip r", summary: "Short for ip route", hidden: true, run: () => ({ output: route() }) },
    { id: "route-get", syntax: "ip route get <ip>", summary: "Which route (and next hop) this host would use for an address", args: { ip: ipArg(s) }, run: ({ ip }) => {
      const local = networkOf(ip, c.prefix) === networkOf(c.ip, c.prefix);
      if (!local && !c.gw) return refuse("RTNETLINK answers: Network is unreachable", "Remote destination and no default route.");
      return { output: `${ip} ${local ? "" : `via ${c.gw} `}dev eth0 src ${c.ip} uid 1000\n    cache`, explanation: local ? `${ip} is on-link: the frame goes straight to it.` : `${ip} is not on-link: the frame goes to the gateway ${c.gw}.` };
    } },
    { id: "neigh", syntax: "ip neigh", summary: "ARP cache (next hops this host has resolved)", run: () => ({ output: neigh(), explanation: EXPLAIN.arp }) },
    { id: "neigh", syntax: "ip n", summary: "Short for ip neigh", hidden: true, run: () => ({ output: neigh() }) },
    { id: "flush", syntax: "ip neigh flush all", summary: "Empty the ARP cache", run: () => (api.act({ type: "clear-cache", owner: h }), { output: "", explanation: "ARP cache emptied (Linux prints nothing). The next packet to any neighbor starts with an ARP request." }) },
    { id: "ping", syntax: "ping <ip>", summary: "Ping until Ctrl+C (here: 4 echoes)", args: { ip: ipArg(s) }, run: ({ ip }) => ping(ip, 4, undefined, true) },
    { id: "ping", syntax: "ping -c <count> <ip>", summary: "Send <count> echo requests", args: { count: countArg, ip: ipArg(s) }, run: ({ count, ip }) => ping(ip, +count, undefined, false) },
    { id: "ping", syntax: "ping -t <ttl> <ip>", summary: "Ping with a chosen TTL (4 echoes)", args: { ttl: ttlArg, ip: ipArg(s) }, run: ({ ttl, ip }) => ping(ip, 4, +ttl, true) },
    { id: "ping", syntax: "ping -c <count> -t <ttl> <ip>", summary: "Both", args: { count: countArg, ttl: ttlArg, ip: ipArg(s) }, run: ({ count, ttl, ip }) => ping(ip, +count, +ttl, false) },
  ];
  return { vendor: "cisco", deviceId: h, deviceName: V4_HOSTS[h].name, prompt: `student@${V4_HOSTS[h].name.toLowerCase()}:~$ `, commands: cmds };
}
function windowsSet(api: V4CliApi, h: V4H): CliCommandSet {
  const s = api.view;
  const c = s.cfg[h];
  const ipc = (all: boolean) =>
    ["Windows IP Configuration", ...(all ? ["", `   Host Name . . . . . . . . . . . . : ${V4_HOSTS[h].name}`] : []), "", "Ethernet adapter Ethernet:", "", ...(all ? [`   Physical Address. . . . . . . . . : ${V4_HOSTS[h].mac.replace(/:/g, "-")}`, "   DHCP Enabled. . . . . . . . . . . : No"] : []), `   IPv4 Address. . . . . . . . . . . : ${c.ip}`, `   Subnet Mask . . . . . . . . . . . : ${maskOf(c.prefix)}`, `   Default Gateway . . . . . . . . . : ${c.gw ?? ""}`].join("\n");
  const ping = (dst: string, n: number, ttl?: number) => {
    const r = api.act({ type: "ping", src: h, dst, count: n, ttl }).last;
    return r?.type === "ping" ? { output: winPing(r.result), explanation: pingNote(r.result) } : { output: "" };
  };
  const arpA = () => {
    const rows = s.caches[h].filter((e) => e.state === "reachable");
    return rows.length ? [`Interface: ${c.ip} --- 0x4`, columns([["  Internet Address", "Physical Address", "Type"], ...rows.map((e) => [`  ${e.ip}`, e.mac!.toLowerCase().replace(/:/g, "-"), "dynamic"])], [24, 22, 10])].join("\n") : "No ARP Entries Found.";
  };
  const cmds: CliCommand[] = [
    { id: "ipconfig", syntax: "ipconfig", summary: "Address, mask and gateway", run: () => ({ output: ipc(false), explanation: EXPLAIN.addr }) },
    { id: "ipconfig", syntax: "ipconfig /all", summary: "Everything, including the MAC", run: () => ({ output: ipc(true) }) },
    {
      id: "route",
      syntax: "route print",
      summary: "IPv4 routes: on-link network and default gateway",
      run: () => ({ output: ["IPv4 Route Table", "===========================================================================", "Active Routes:", columns([["Network Destination", "Netmask", "Gateway", "Interface", "Metric"], ...(c.gw ? [["0.0.0.0", "0.0.0.0", c.gw, c.ip, "25"]] : []), [networkOf(c.ip, c.prefix), maskOf(c.prefix), "On-link", c.ip, "281"], [c.ip, "255.255.255.255", "On-link", c.ip, "281"]], [24, 18, 18, 18, 6]), "==========================================================================="].join("\n"), explanation: EXPLAIN.route }),
    },
    { id: "arp", syntax: "arp -a", summary: "ARP cache", run: () => ({ output: arpA(), explanation: EXPLAIN.arp }) },
    { id: "arp-d", syntax: "arp -d *", summary: "Empty the ARP cache", run: () => (api.act({ type: "clear-cache", owner: h }), { output: "", explanation: "ARP cache emptied (Windows prints nothing). The next packet to any neighbor starts with an ARP request." }) },
    { id: "ping", syntax: "ping <ip>", summary: "Send 4 echo requests", args: { ip: ipArg(s) }, run: ({ ip }) => ping(ip, 4) },
    { id: "ping", syntax: "ping -n <count> <ip>", summary: "Send <count> echo requests", args: { count: countArg, ip: ipArg(s) }, run: ({ count, ip }) => ping(ip, +count) },
    { id: "ping", syntax: "ping -i <ttl> <ip>", summary: "Ping with a chosen TTL", args: { ttl: ttlArg, ip: ipArg(s) }, run: ({ ttl, ip }) => ping(ip, 4, +ttl) },
    { id: "ping", syntax: "ping -n <count> -i <ttl> <ip>", summary: "Both", args: { count: countArg, ttl: ttlArg, ip: ipArg(s) }, run: ({ count, ttl, ip }) => ping(ip, +count, +ttl) },
  ];
  return { vendor: "cisco", deviceId: h, deviceName: V4_HOSTS[h].name, prompt: "C:\\Users\\student>", commands: cmds };
}
export const v4HostSet = (api: V4CliApi, h: V4H) => (V4_HOSTS[h].os === "windows" ? withShellHistory(withSelfPing(windowsSet(api, h), "windows", [api.view.cfg[h].ip]), "windows", api.history) : withShellHistory(withSelfPing(linuxSet(api, h), "linux", [api.view.cfg[h].ip]), "linux", api.history));

// ---------------------------------------------------------------------------------------------------------------
// R1 — shared views
// ---------------------------------------------------------------------------------------------------------------
const ifDesc = (i: V4R1If) => V4_R1[i].desc;
function r1Ping(api: V4CliApi, dst: string, n: number) {
  const r = api.act({ type: "ping", src: "r1", dst, count: n }).last;
  return r?.type === "ping" ? r.result : undefined;
}
export function v4JunosText(r1: Record<V4R1If, V4IfCfg>, path: string[] = []) {
  const body = (["ge0", "ge1"] as V4R1If[]).map((i) => [`    ${v4IfName(i)} {`, `        description "${ifDesc(i)}";`, ...(r1[i].up ? [] : ["        disable;"]), "        unit 0 {", "            family inet {", `                address ${r1[i].ip}/${r1[i].prefix};`, "            }", "        }", "    }"].join("\n"));
  const all = ["interfaces {", ...body, "}"].join("\n");
  if (!path.length) return all;
  if (path[0] === "interfaces" && path.length === 1) return body.map((b) => b.replace(/^ {4}/gm, "")).join("\n");
  const i = (["ge0", "ge1"] as V4R1If[]).find((x) => v4IfName(x) === path[1]);
  // One interface: its statements only (no wrapper), as Junos prints the hierarchy level.
  return i ? body[["ge0", "ge1"].indexOf(i)].split("\n").slice(1, -1).map((l) => l.slice(8)).join("\n") : "";
}
function sameR1(a: Record<V4R1If, V4IfCfg>, b: Record<V4R1If, V4IfCfg>) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function ciscoR1(api: V4CliApi): CliCommandSet {
  const s = api.view;
  const ifArg = interfaceArg("cisco", V4_CISCO_IF, { ge0: `LAN A interface (${s.r1.ge0.ip}/${s.r1.ge0.prefix})`, ge1: `LAN B interface (${s.r1.ge1.ip}/${s.r1.ge1.prefix})` });
  const mode = api.cisco;
  const apply = (iface: V4R1If, patch: Partial<V4IfCfg>, line: string) => api.act({ type: "r1-cfg", r1: { ...s.r1, [iface]: { ...s.r1[iface], ...patch } }, line });
  const brief = () => columns([["Interface", "IP-Address", "OK?", "Method", "Status", "Protocol"], ...(["ge0", "ge1"] as V4R1If[]).map((i) => [V4_CISCO_IF[i], s.r1[i].ip, "YES", "manual", s.r1[i].up ? "up" : "administratively down", s.r1[i].up ? "up" : "down"])], [23, 16, 4, 7, 22, 8]);
  const routes = () => {
    const rs = v4Routes(s);
    const lines = ["Codes: L - local, C - connected", "", "Gateway of last resort is not set", ""];
    if (rs.length) lines.push(`      192.168.10.0/24 is variably subnetted, ${rs.length * 2} subnets, 2 masks`);
    for (const r of rs) lines.push(`C        ${r.net}/${r.prefix} is directly connected, ${V4_CISCO_IF[r.iface]}`, `L        ${s.r1[r.iface].ip}/32 is directly connected, ${V4_CISCO_IF[r.iface]}`);
    return lines.join("\n");
  };
  const arp = () =>
    columns(
      [
        ["Protocol", "Address", "Age (min)", "Hardware Addr", "Type", "Interface"],
        ...(["ge0", "ge1"] as V4R1If[]).filter((i) => s.r1[i].up).map((i) => ["Internet", s.r1[i].ip, "-", ciscoMac(V4_R1[i].mac), "ARPA", V4_CISCO_IF[i]]),
        ...s.caches.r1.map((e) => ["Internet", e.ip, "0", e.state === "reachable" ? ciscoMac(e.mac!) : "Incomplete", "ARPA", e.state === "reachable" ? V4_CISCO_IF[e.iface as V4R1If] : ""]),
      ],
      [10, 17, 11, 16, 7, 20],
    );
  const intf = (i: V4R1If) => {
    const c = s.r1[i];
    return [
      `${V4_CISCO_IF[i]} is ${c.up ? "up" : "administratively down"}, line protocol is ${c.up ? "up" : "down"}`,
      `  Hardware is iGbE, address is ${ciscoMac(V4_R1[i].mac)} (bia ${ciscoMac(V4_R1[i].mac)})`,
      `  Description: ${ifDesc(i)}`,
      `  Internet address is ${c.ip}/${c.prefix}`,
      `     ${s.counters[i].in} packets input, 0 input errors`,
      `     ${s.counters[i].out} packets output, 0 output errors`,
    ].join("\n");
  };
  const running = (only?: V4R1If) => {
    const block = (i: V4R1If) => [`interface ${V4_CISCO_IF[i]}`, ` description ${ifDesc(i)}`, ` ip address ${s.r1[i].ip} ${maskOf(s.r1[i].prefix)}`, ...(s.r1[i].up ? [] : [" shutdown"]), "!"];
    return only ? block(only).join("\n") : ["hostname R1", "!", ...block("ge0"), ...block("ge1"), "end"].join("\n");
  };
  const show: CliCommand[] = [
    { id: "brief", syntax: "show ip interface brief", summary: "Interfaces, addresses and status", run: () => ({ output: brief(), explanation: "Each interface that is up gives R1 one connected network: the address with its mask." }) },
    { id: "route", syntax: "show ip route", summary: "Routing table", run: () => ({ output: routes(), explanation: "C = connected: R1 delivers to these networks itself (ARP for the destination on that interface). Anything else has no route here." }) },
    { id: "arp", syntax: "show ip arp", summary: "ARP table", run: () => ({ output: arp(), explanation: "R1 resolves the final hosts on its connected networks — never across itself." }) },
    { id: "intf", syntax: "show interfaces <interface>", summary: "One interface: MAC, address, counters", args: { interface: ifArg }, run: ({ interface: i }) => ({ output: intf(i as V4R1If), explanation: "Packets input/output count frames this interface received and sent." }) },
    { id: "run", syntax: "show running-config", summary: "Current configuration", run: () => ({ output: running() }) },
    { id: "run", syntax: "show running-config interface <interface>", summary: "One interface's configuration", args: { interface: ifArg }, run: ({ interface: i }) => ({ output: running(i as V4R1If) }) },
  ];
  const cmds: CliCommand[] =
    mode.kind === "exec"
      ? [
          ...show,
          {
            id: "ping",
            syntax: "ping <ip>",
            summary: "Send 5 echo requests",
            args: { ip: ipArg(s) },
            run: ({ ip }) => {
              const r = r1Ping(api, ip, 5);
              if (!r) return { output: "" };
              const ok = r.replies.filter((x) => x.kind === "reply").length;
              return { output: ["Type escape sequence to abort.", `Sending 5, 100-byte ICMP Echos to ${ip}, timeout is 2 seconds:`, r.replies.map((x) => (x.kind === "reply" ? "!" : x.kind === "net-unreachable" || x.kind === "no-route" ? "U" : ".")).join(""), `Success rate is ${ok * 20} percent (${ok}/5)`].join("\n") };
            },
          },
          { id: "clear", syntax: "clear arp-cache", summary: "Flush R1's ARP table", run: () => (api.act({ type: "clear-cache", owner: "r1" }), { output: "" }) },
          { id: "conf", syntax: "configure terminal", summary: "Configuration mode", run: () => (api.setCisco({ kind: "config" }), { output: "Enter configuration commands, one per line.  End with CNTL/Z." }) },
          { id: "hist", syntax: "show history", summary: "Commands typed in this session", run: () => ({ output: [...(api.history ?? []), "show history"].map((x) => `  ${x}`).join("\n") }) },
        ]
      : [
          ...show.map((c) => ({ ...c, id: `do:${c.id}`, syntax: `do ${c.syntax}` })),
          { id: "if", syntax: "interface <interface>", summary: "Configure an interface", args: { interface: ifArg }, run: ({ interface: i }) => (api.setCisco({ kind: "if", iface: i as V4R1If }), { output: "" }) },
          ...(mode.kind === "if"
            ? ((iface: V4R1If): CliCommand[] => [
                {
                  id: "ipaddr",
                  syntax: "ip address <ip> <mask>",
                  summary: "Set this interface's IPv4 address and mask",
                  args: { ip: { choices: [s.r1[iface].ip], resolve: (raw) => (isIp(raw) ? raw : undefined) }, mask: { choices: ["255.255.255.192", "255.255.255.0"], resolve: (raw) => (prefixOfMask(raw) !== undefined ? raw : undefined) } },
                  run: ({ ip, mask }) => {
                    const prefix = prefixOfMask(mask)!;
                    if (prefix < 8 || prefix > 30) return refuse("% Bad mask for this lesson (use /8–/30)");
                    const other = iface === "ge0" ? "ge1" : "ge0";
                    const shorter = Math.min(prefix, s.r1[other].prefix);
                    if (networkOf(ip, shorter) === networkOf(s.r1[other].ip, shorter)) return refuse(`% ${networkOf(ip, prefix)} overlaps with ${V4_CISCO_IF[other]}`);
                    if (networkOf(ip, prefix) === ip) return refuse("% Bad mask /" + prefix + " for address " + ip);
                    apply(iface, { ip, prefix }, `interface ${v4IfName(iface)} ip address ${ip}/${prefix}`);
                    return { output: "", explanation: `${V4_CISCO_IF[iface]} is now ${ip}/${prefix}: its connected network is ${networkOf(ip, prefix)}/${prefix}. Hosts whose gateway is the old address lose it as soon as their ARP entry for it expires or is cleared.` };
                  },
                },
                { id: "shut", syntax: "shutdown", summary: "Disable this interface", run: () => (apply(iface, { up: false }, `interface ${v4IfName(iface)} shutdown`), { output: `%LINK-5-CHANGED: Interface ${V4_CISCO_IF[iface]}, changed state to administratively down`, explanation: "Its connected network disappears from the routing table: R1 can no longer deliver there." }) },
                { id: "noshut", syntax: "no shutdown", summary: "Enable this interface", run: () => (apply(iface, { up: true }, `interface ${v4IfName(iface)} no shutdown`), { output: `%LINK-3-UPDOWN: Interface ${V4_CISCO_IF[iface]}, changed state to up` }) },
              ])(mode.iface)
            : []),
          { id: "exit", syntax: "exit", summary: "Up one level", run: () => (api.setCisco(mode.kind === "if" ? { kind: "config" } : { kind: "exec" }), { output: "" }) },
          { id: "end", syntax: "end", summary: "Back to privileged mode", run: () => (api.setCisco({ kind: "exec" }), { output: "" }) },
        ];
  return { vendor: "cisco", deviceId: "r1", deviceName: "R1", prompt: mode.kind === "exec" ? "R1#" : mode.kind === "config" ? "R1(config)#" : "R1(config-if)#", commands: cmds };
}

function junosR1(api: V4CliApi): CliCommandSet {
  const s = api.view;
  const ifArg = interfaceArg("juniper", { ge0: "ge-0/0/0", ge1: "ge-0/0/1" }, { ge0: "LAN A interface", ge1: "LAN B interface" });
  const active = api.hist[0].r1;
  const cand = api.cand;
  const dirty = !sameR1(cand, active);
  /** Junos refuses a candidate whose two interfaces overlap; commit check reports the same. */
  const overlap = () => {
    const o = cand.ge0;
    const t = cand.ge1;
    return networkOf(o.ip, Math.min(o.prefix, t.prefix)) === networkOf(t.ip, Math.min(o.prefix, t.prefix)) ? "error: configuration check-out failed: overlapping subnets on ge-0/0/0.0 and ge-0/0/1.0" : undefined;
  };
  const doCommit = (quit: boolean) => {
    if (dirty) {
      const err = overlap();
      if (err) return refuse(err);
      api.commit(cand);
    }
    if (quit) api.setJunosEdit(false);
    return { output: quit ? "commit complete\nExiting configuration mode" : "commit complete", explanation: dirty ? "Now active: interfaces and connected routes follow the new configuration." : undefined };
  };
  const terse = () => columns([["Interface", "Admin", "Link", "Proto", "Local"], ...(["ge0", "ge1"] as V4R1If[]).flatMap((i) => [[v4IfName(i), s.r1[i].up ? "up" : "down", s.r1[i].up ? "up" : "down", "", ""], [`${v4IfName(i)}.0`, s.r1[i].up ? "up" : "down", s.r1[i].up ? "up" : "down", "inet", `${s.r1[i].ip}/${s.r1[i].prefix}`]])], [16, 6, 5, 6, 18]);
  const route = () => {
    const rs = v4Routes(s);
    return [`inet.0: ${rs.length * 2} destinations, ${rs.length * 2} routes (${rs.length * 2} active, 0 holddown, 0 hidden)`, "+ = Active Route, - = Last Active, * = Both", "", ...rs.flatMap((r) => [`${`${r.net}/${r.prefix}`.padEnd(19)}*[Direct/0] 1w0d`, `                    >  via ${v4IfName(r.iface)}.0`, `${`${s.r1[r.iface].ip}/32`.padEnd(19)}*[Local/0] 1w0d`, `                       Local via ${v4IfName(r.iface)}.0`])].join("\n");
  };
  const arp = (resolve = true) => {
    const ok = s.caches.r1.filter((e) => e.state === "reachable");
    return [columns([["MAC Address", "Address", "Name", "Interface", "Flags"], ...ok.map((e) => [e.mac!.toLowerCase(), e.ip, resolve ? e.ip : "", `${v4IfName(e.iface as V4R1If)}.0`, "none"])], [18, 16, resolve ? 26 : 1, 24, 6]), `Total entries: ${ok.length}`].join("\n");
  };
  const intf = (i: V4R1If) => [`Physical interface: ${v4IfName(i)}, ${s.r1[i].up ? "Enabled" : "Administratively down"}, Physical link is ${s.r1[i].up ? "Up" : "Down"}`, `  Description: ${ifDesc(i)}`, `  Current address: ${V4_R1[i].mac.toLowerCase()}, Hardware address: ${V4_R1[i].mac.toLowerCase()}`, `  Input packets : ${s.counters[i].in}`, `  Output packets: ${s.counters[i].out}`, `  Logical interface ${v4IfName(i)}.0`, `    Protocol inet, Local: ${s.r1[i].ip}/${s.r1[i].prefix}`].join("\n");
  const op: CliCommand[] = [
    { id: "terse", syntax: "show interfaces terse", summary: "Interfaces, status and addresses", run: () => ({ output: terse(), explanation: "Each interface that is up gives R1 one connected (Direct) network." }) },
    { id: "intf", syntax: "show interfaces <iface>", summary: "One interface: MAC, address, counters", args: { iface: ifArg }, run: ({ iface }) => ({ output: intf(iface as V4R1If) }) },
    { id: "route", syntax: "show route", summary: "Routing table", run: () => ({ output: route(), explanation: "Direct = connected networks: R1 delivers to these itself. Anything else has no route here." }) },
    { id: "arp", syntax: "show arp", summary: "ARP table", run: () => ({ output: arp(), explanation: "R1 resolves the final hosts on its connected networks — never across itself." }) },
    { id: "arp", syntax: "show arp no-resolve", summary: "Without name lookups", run: () => ({ output: arp(false) }) },
    { id: "cfg", syntax: "show configuration", summary: "Active configuration", run: () => ({ output: v4JunosText(active) }) },
    { id: "cfg", syntax: "show configuration interfaces", summary: "Interface configuration", run: () => ({ output: v4JunosText(active, ["interfaces"]) }) },
    { id: "cfg", syntax: "show configuration interfaces <iface>", summary: "One interface's active configuration", args: { iface: ifArg }, run: ({ iface }) => ({ output: v4JunosText(active, ["interfaces", v4IfName(iface as V4R1If)]) }) },
    { id: "commits", syntax: "show system commit", summary: "Commit history", run: () => ({ output: api.hist.map((c, i) => `${i}   ${new Date(c.at || Date.now() - 3600000).toISOString().replace("T", " ").slice(0, 19)} UTC by ${c.by} via cli`).join("\n") }) },
    {
      id: "ping",
      syntax: "ping <ip> count <count>",
      summary: "Send <count> echo requests",
      args: { ip: ipArg(s), count: countArg },
      run: ({ ip, count }) => {
        const r = r1Ping(api, ip, +count);
        return r ? { output: linPing(r, r.decisions[0]?.src ?? s.r1.ge0.ip, false) } : { output: "" };
      },
    },
    { id: "clear", syntax: "clear arp", summary: "Flush R1's ARP table", run: () => (api.act({ type: "clear-cache", owner: "r1" }), { output: "" }) },
    { id: "hist", syntax: "show cli history", summary: "Commands typed in this session", run: () => ({ output: [...(api.history ?? []), "show cli history"].map((x) => `  ${x}`).join("\n") }) },
  ];
  const setAddr: CliArgSpec = { choices: [`${cand.ge0.ip}/${cand.ge0.prefix}`, `${cand.ge1.ip}/${cand.ge1.prefix}`], describe: () => "address/prefix", resolve: (raw) => (/^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/.test(raw) && isIp(raw.split("/")[0]) && +raw.split("/")[1] >= 8 && +raw.split("/")[1] <= 30 ? raw : undefined) };
  const ifOf = (x: string) => (x === "ge0" || x === "ge-0/0/0" ? "ge0" : "ge1") as V4R1If;
  const edit: CliCommand[] = [
    ...op.map((c) => ({ ...c, id: `run:${c.id}`, syntax: `run ${c.syntax}` })),
    {
      id: "set-addr",
      syntax: "set interfaces <iface> unit 0 family inet address <address>",
      summary: "Set an interface's address/prefix (candidate)",
      args: { iface: ifArg, address: setAddr },
      run: ({ iface, address }) => {
        const [ip, p] = address.split("/");
        if (networkOf(ip, +p) === ip) return refuse(`error: ${address}: address is the network address`);
        api.setCand({ ...cand, [ifOf(iface)]: { ...cand[ifOf(iface)], ip, prefix: +p } });
        return { output: "", explanation: "In the candidate only: R1 keeps forwarding with the committed configuration until you commit." };
      },
    },
    { id: "set-dis", syntax: "set interfaces <iface> disable", summary: "Disable an interface (candidate)", args: { iface: ifArg }, run: ({ iface }) => (api.setCand({ ...cand, [ifOf(iface)]: { ...cand[ifOf(iface)], up: false } }), { output: "" }) },
    { id: "del-dis", syntax: "delete interfaces <iface> disable", summary: "Enable an interface again (candidate)", args: { iface: ifArg }, run: ({ iface }) => (cand[ifOf(iface)].up ? refuse("warning: statement not found") : (api.setCand({ ...cand, [ifOf(iface)]: { ...cand[ifOf(iface)], up: true } }), { output: "" })) },
    { id: "show", syntax: "show", summary: "The candidate configuration (try show | compare)", run: () => ({ output: v4JunosText(cand) }) },
    { id: "show", syntax: "show interfaces", summary: "Candidate interface configuration", run: () => ({ output: v4JunosText(cand, ["interfaces"]) }) },
    { id: "show", syntax: "show interfaces <iface>", summary: "One interface in the candidate", args: { iface: ifArg }, run: ({ iface }) => ({ output: v4JunosText(cand, ["interfaces", v4IfName(iface as V4R1If)]) }) },
    {
      id: "commit",
      syntax: "commit",
      summary: "Activate the candidate configuration",
      run: () => doCommit(false),
    },
    { id: "commit", syntax: "commit and-quit", summary: "Commit, then leave configuration mode", run: () => doCommit(true) },
    { id: "commit", syntax: "commit check", summary: "Validate without activating", run: () => (overlap() ? refuse(overlap()!) : { output: "configuration check succeeds" }) },
    { id: "rollback", syntax: "rollback", summary: "Discard uncommitted changes", run: () => (api.setCand(active), { output: "load complete" }) },
    { id: "rollback", syntax: "rollback <n>", summary: "Load an earlier committed configuration into the candidate", args: { n: { choices: api.hist.map((_, i) => String(i)), resolve: (raw) => (/^\d+$/.test(raw) && +raw < api.hist.length ? raw : undefined) } }, run: ({ n }) => (api.setCand(api.hist[+n].r1), { output: "load complete" }) },
    {
      id: "exit",
      syntax: "exit",
      summary: "Leave configuration mode",
      run: () => {
        if (!dirty || !api.ask) return (api.setJunosEdit(false), { output: "Exiting configuration mode" });
        api.ask({
          node: "R1",
          prompt: "The configuration has been changed but not committed\nExit with uncommitted changes? [yes,no] (yes) ",
          answer: (line) => {
            api.ask?.(undefined);
            if (/^n(o)?$/i.test(line.trim())) return { output: "" };
            api.setJunosEdit(false);
            return { output: "Exiting configuration mode" };
          },
          cancel: () => (api.ask?.(undefined), ""),
        });
        return { output: "" };
      },
    },
  ];
  const cmds: CliCommand[] = api.junosEdit ? edit : [...op, { id: "conf", syntax: "configure", summary: "Configuration mode (candidate)", run: () => (!dirty && api.setCand(active), api.setJunosEdit(true), { output: dirty ? "Entering configuration mode\nThe configuration has been changed but not committed\n" : "Entering configuration mode\n" }) }];
  return { vendor: "juniper", deviceId: "r1", deviceName: "R1", prompt: api.junosEdit ? "admin@R1# " : "admin@R1> ", commands: cmds };
}
/** R1 answers its own addresses — only on interfaces that are up (a shut interface's address isn't active). */
const r1Own = (api: V4CliApi) => (["ge0", "ge1"] as V4R1If[]).filter((i) => api.view.r1[i].up).map((i) => api.view.r1[i].ip);
export const v4R1Sets = (api: V4CliApi): Record<CliVendor, CliCommandSet> => ({ cisco: withSelfPing(ciscoR1(api), "ios", r1Own(api)), juniper: withSelfPing(junosR1(api), "junos", r1Own(api)) });
export const v4JunosConfig = (api: Pick<V4CliApi, "hist">) => (which: "committed" | number, path: string[]) => {
  const e = which === "committed" ? api.hist[0] : api.hist[which];
  return e ? v4JunosText(e.r1, path) : undefined;
};
export { hex4 };
