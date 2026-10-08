import type { CliArgSpec, CliCommand, CliCommandSet, CliResult, CliVendor } from "@/lib/cli/types";
import { columns, interfaceArg } from "@/lib/cli/format";
import { withSelfPing } from "@/lib/cli/selfPing";
import { maskOf } from "@/lib/sim-engine/scenarios/subnettingDesign";
import { ssCiscoIf, ssDevice, ssDevices, ssDevName, ssJunosIf, ssNetOf, ssParent, ssR1Accept, ssR1Routes, type SsAction, type SsIf, type SsPing, type SsState } from "@/lib/sim-engine/scenarios/subnetStudio";
import type { CliQuestion } from "@/app/demo/dhcp-dns/dhcp-lab/dhcpBuildCli";

/**
 * Terminals of the Subnet Studio (Build & test, Troubleshoot). Every output is printed from the studio state of the
 * moment (`view`); every change goes through a studio action (`act`), which returns the resulting state so the output
 * reports what really happened. The subject is addressing, so the commands are the ones that show it:
 *
 *   R1      Cisco IOS: show ip interface brief · show ip route · show running-config · interface / ip address (applied
 *           on Enter, refused when it overlaps another interface) · ping.
 *           Junos: show interfaces terse · show route · show configuration · configure → set/delete … family inet
 *           address (candidate) → commit / commit check (refused on overlap) · rollback · ping.
 *   Hosts   Linux: ip addr · ip route · ip route get · ping.   Windows: ipconfig · route print · ping.
 */

export type SsCiscoMode = { kind: "exec" } | { kind: "config" } | { kind: "if"; id: string };
export interface SsCommit {
  r1: Record<string, SsIf>;
  at: number;
  by: string;
}
export interface SsCliApi {
  view: SsState;
  act: (a: SsAction) => SsState;
  history?: string[];
  cisco: SsCiscoMode;
  setCisco: (m: SsCiscoMode) => void;
  junosEdit: boolean;
  setJunosEdit: (b: boolean) => void;
  cand: Record<string, SsIf>;
  setCand: (c: Record<string, SsIf>) => void;
  hist: SsCommit[];
  commit: (r1: Record<string, SsIf>) => void;
  ask?: (q: CliQuestion | undefined) => void;
}

const refuse = (output: string, explanation?: string) => ({ output, refused: true, explanation });
const isIp = (s: string) => /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(s) && s.split(".").every((o) => Number(o) <= 255);
const prefixOfMask = (m: string) => {
  if (!isIp(m)) return undefined;
  for (let p = 0; p <= 32; p++) if (maskOf(p) === m) return p;
  return undefined;
};
const knownIps = (s: SsState) => [...new Set([...ssDevices(s.needs).map((d) => s.net.hosts[d.id]?.ip), ...s.needs.map((n) => s.net.r1[n.id]?.ip)].filter((x): x is string => !!x))];
const ipArg = (s: SsState): CliArgSpec => ({ choices: knownIps(s), describe: (c) => owner(s, c), resolve: (raw) => (isIp(raw) ? raw : undefined) });
const countArg: CliArgSpec = { choices: ["1", "4"], describe: () => "number of echo requests (1–10)", resolve: (raw) => (/^\d+$/.test(raw) && +raw >= 1 && +raw <= 10 ? raw : undefined) };
function owner(s: SsState, ip: string) {
  for (const d of ssDevices(s.needs)) if (s.net.hosts[d.id]?.ip === ip) return `${d.name} (${d.wire})`;
  for (const n of s.needs) if (s.net.r1[n.id]?.ip === ip) return `R1 ${ssCiscoIf(n.iface)} (${n.id})`;
  return undefined;
}
const cidrArg: CliArgSpec = { choices: [], describe: () => "address/prefix, e.g. 172.20.8.10/25", resolve: (raw) => (/^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/.test(raw) && isIp(raw.split("/")[0]) && +raw.split("/")[1] >= 8 && +raw.split("/")[1] <= 30 ? raw : undefined) };
const plainIp: CliArgSpec = { choices: [], describe: () => "an IPv4 address", resolve: (raw) => (isIp(raw) ? raw : undefined) };
const maskArg: CliArgSpec = { choices: ["255.255.255.0", "255.255.255.128", "255.255.255.192", "255.255.255.224", "255.255.255.248"], describe: () => "subnet mask", resolve: (raw) => { const p = prefixOfMask(raw); return p !== undefined && p >= 8 && p <= 30 ? raw : undefined; } };
const nameArg: CliArgSpec = { choices: ['name="Ethernet0"'], describe: () => "the adapter", resolve: (raw) => {
  // Any adapter name parses (the command then says whether this PC has it); quotes and name= are optional.
  const m = /^(?:name=)?"?([\w.-]+)"?$/i.exec(raw);
  return !m ? undefined : /^ethernet0$/i.test(m[1]) ? "Ethernet0" : m[1];
} };
const failText = (p: SsPing) => [...p.there.hops, ...(p.back?.hops ?? [])].find((h) => h.tone === "bad")?.text;
const EXPLAIN = {
  addr: "Address + prefix = the network this device believes it is on. brd is that network's broadcast, computed from the device's OWN prefix — if the prefix is wrong, so is everything it believes.",
  route: "The connected line is the host's own subnet (on-link: delivered directly, ARP for the destination). Everything else goes to the default gateway, which must be inside that subnet.",
  get: "This is the host's local/remote decision for one destination: 'dev eth0' alone = on-link (local); 'via <gateway>' = remote, handed to the router.",
};

// ---------------------------------------------------------------------------------------------------------------
// Hosts
// ---------------------------------------------------------------------------------------------------------------
function hostPing(api: SsCliApi, id: string, dst: string) {
  const r = api.act({ type: "ping", src: id, dst });
  return r.lastPing!;
}
const ttlOf = (s: SsState, p: SsPing) => {
  const arrived = p.there.arrived;
  // A reply R1 originates itself starts at R1: only a reply routed THROUGH R1 loses one.
  const via = arrived !== "r1" && (p.back?.hops.some((h) => h.at === "R1") ?? false);
  const os = arrived && arrived !== "r1" ? ssDevice(s.needs, arrived)?.os : undefined;
  const base = arrived === "r1" || os === "router" ? 255 : os === "windows" ? 128 : 64;
  return base - (via ? 1 : 0);
};
function linuxPing(s: SsState, p: SsPing, self: string, dst: string, n: number) {
  const fail = p.there.fail ?? p.back?.fail;
  const head = `PING ${dst} (${dst}) 56(84) bytes of data.`;
  if (fail === "no-gw" || fail === "gw-off-subnet" || fail === "no-ip") return "ping: connect: Network is unreachable";
  const lines = [head];
  const r1ip = s.net.hosts[p.src]?.gw;
  for (let i = 1; i <= n; i++) {
    if (p.ok) lines.push(`64 bytes from ${dst}: icmp_seq=${i} ttl=${ttlOf(s, p)} time=${(0.4 + i * 0.07).toFixed(2)} ms`);
    else if (!p.there.ok && (fail === "arp-local" || fail === "arp-gw")) lines.push(`From ${self} icmp_seq=${i} Destination Host Unreachable`);
    else if (!p.there.ok && fail === "no-route") lines.push(`From ${r1ip ?? "R1"} icmp_seq=${i} Destination Net Unreachable`);
  }
  const ok = p.ok ? n : 0;
  lines.push("", `--- ${dst} ping statistics ---`, `${n} packets transmitted, ${ok} received, ${p.ok ? "" : lines.length > 1 && !p.ok && lines.some((l) => l.startsWith("From")) ? `+${n} errors, ` : ""}${p.ok ? 0 : 100}% packet loss, time ${n * 1000 - 1}ms`);
  return lines.join("\n");
}
function winPing(s: SsState, p: SsPing, self: string, dst: string, n: number) {
  const fail = p.there.fail ?? p.back?.fail;
  if (fail === "no-gw" || fail === "gw-off-subnet" || fail === "no-ip") return [`Pinging ${dst} with 32 bytes of data:`, ...Array.from({ length: n }, () => "PING: transmit failed. General failure."), "", `Ping statistics for ${dst}:`, `    Packets: Sent = ${n}, Received = 0, Lost = ${n} (100% loss),`].join("\n");
  const one = p.ok ? `Reply from ${dst}: bytes=32 time<1ms TTL=${ttlOf(s, p)}` : !p.there.ok && (fail === "arp-local" || fail === "arp-gw") ? `Reply from ${self}: Destination host unreachable.` : !p.there.ok && fail === "no-route" ? `Reply from ${s.net.hosts[p.src]?.gw ?? "R1"}: Destination net unreachable.` : "Request timed out.";
  const rec = p.ok || one.startsWith("Reply from") ? n : 0;
  return [`Pinging ${dst} with 32 bytes of data:`, ...Array.from({ length: n }, () => one), "", `Ping statistics for ${dst}:`, `    Packets: Sent = ${n}, Received = ${rec}, Lost = ${n - rec} (${Math.round(((n - rec) / n) * 100)}% loss),`].join("\n");
}
const pingExplain = (p: SsPing) => (p.ok ? "Request and reply both made it. Each side made its own local/remote decision with its own mask." : failText(p));

function linuxSet(api: SsCliApi, id: string): CliCommandSet {
  const s = api.view;
  const n = ssDevice(s.needs, id)!;
  const c = s.net.hosts[id] ?? {};
  const name = n.name.toLowerCase();
  const addr = () => {
    const lines = ["1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN group default qlen 1000", "    inet 127.0.0.1/8 scope host lo", "2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc fq_codel state UP group default qlen 1000"];
    if (c.ip && c.prefix !== undefined) {
      const b = ssNetOf(c.ip, c.prefix);
      const last = b.split(".").map(Number);
      const size = 2 ** (32 - c.prefix);
      const num = last.reduce((a, o) => a * 256 + o, 0) + size - 1;
      const brd = [24, 16, 8, 0].map((x) => Math.floor(num / 2 ** x) % 256).join(".");
      lines.push(`    inet ${c.ip}/${c.prefix} brd ${brd} scope global eth0`);
    }
    return lines.join("\n");
  };
  const route = () => {
    if (!c.ip || c.prefix === undefined) return "";
    const net = ssNetOf(c.ip, c.prefix);
    const gwOk = c.gw && ssNetOf(c.gw, c.prefix) === net;
    return [...(gwOk ? [`default via ${c.gw} dev eth0 proto static`] : []), `${net}/${c.prefix} dev eth0 proto kernel scope link src ${c.ip}`].join("\n");
  };
  const gwNote = c.gw && c.ip && c.prefix !== undefined && ssNetOf(c.gw, c.prefix) !== ssNetOf(c.ip, c.prefix) ? `There is no default route: the configured gateway ${c.gw} is not inside ${ssNetOf(c.ip, c.prefix)}/${c.prefix}, so Linux refused it when the settings were applied (RTNETLINK answers: Nexthop has invalid gateway).` : undefined;
  const get = (dst: string) => {
    if (!c.ip || c.prefix === undefined) return refuse("RTNETLINK answers: Network is unreachable");
    const local = ssNetOf(dst, c.prefix) === ssNetOf(c.ip, c.prefix);
    if (local) return { output: `${dst} dev eth0 src ${c.ip} uid 1000\n    cache`, explanation: `${dst} AND /${c.prefix} = ${ssNetOf(dst, c.prefix)}, the same as ${name}'s own network: LOCAL. ${EXPLAIN.get}` };
    if (!c.gw || ssNetOf(c.gw, c.prefix) !== ssNetOf(c.ip, c.prefix)) return refuse("RTNETLINK answers: Network is unreachable", gwNote ?? "Remote destination and no usable default route.");
    return { output: `${dst} via ${c.gw} dev eth0 src ${c.ip} uid 1000\n    cache`, explanation: `${dst} AND /${c.prefix} = ${ssNetOf(dst, c.prefix)}, not ${ssNetOf(c.ip, c.prefix)}: REMOTE. ${EXPLAIN.get}` };
  };
  const ping = (dst: string, cnt: number) => {
    if (!c.ip) return refuse("ping: connect: Network is unreachable");
    const p = hostPing(api, id, dst);
    return { output: linuxPing(api.view, p, c.ip, dst, cnt), explanation: pingExplain(p) };
  };
  return {
    vendor: "cisco",
    deviceId: id,
    deviceName: n.name,
    prompt: `admin@${name}:~$ `,
    commands: [
      { id: "addr", syntax: "ip addr", summary: "Addresses and prefixes", run: () => ({ output: addr(), explanation: EXPLAIN.addr }) },
      { id: "addr", syntax: "ip a", summary: "Short for ip addr", hidden: true, run: () => ({ output: addr(), explanation: EXPLAIN.addr }) },
      { id: "addr", syntax: "ip -br addr", summary: "One line per interface", hidden: true, run: () => ({ output: [`lo               UNKNOWN        127.0.0.1/8`, `eth0             UP             ${c.ip ? `${c.ip}/${c.prefix}` : ""}`].join("\n").trimEnd(), explanation: "Address/prefix = the network this device believes it is on (ip addr also shows the broadcast)." }) },
      { id: "route", syntax: "ip route", summary: "Routing table", run: () => ({ output: route(), explanation: gwNote ?? EXPLAIN.route }) },
      { id: "route", syntax: "ip r", summary: "Short for ip route", hidden: true, run: () => ({ output: route(), explanation: gwNote ?? EXPLAIN.route }) },
      { id: "get", syntax: "ip route get <ip>", summary: "Which way would a packet to <ip> go?", args: { ip: ipArg(s) }, run: ({ ip }) => get(ip) },
      { id: "ping", syntax: "ping -c <count> <ip>", summary: "Send <count> echo requests", args: { count: countArg, ip: ipArg(s) }, run: ({ count, ip }) => ping(ip, +count) },
      { id: "ping", syntax: "ping <ip>", summary: "Send 4 echo requests", args: { ip: ipArg(s) }, run: ({ ip }) => ping(ip, 4) },
      { id: "hist", syntax: "history", summary: "Commands typed in this session", run: () => ({ output: [...(api.history ?? []), "history"].map((x, i) => `  ${i + 1}  ${x}`).join("\n") }) },
      {
        id: "addr-add",
        syntax: "sudo ip addr add <cidr> dev eth0",
        summary: "Give eth0 an address/prefix",
        args: { cidr: cidrArg },
        run: ({ cidr }) => {
          const [ip, p] = cidr.split("/");
          if (c.ip) return refuse("RTNETLINK answers: File exists", `${name} already has ${c.ip}/${c.prefix}. This lab models one address per interface: remove it first with sudo ip addr del ${c.ip}/${c.prefix} dev eth0 (or sudo ip addr flush dev eth0).`);
          const net = ssNetOf(ip, +p);
          api.act({ type: "host-cfg", id, cfg: { ip, prefix: +p } });
          return { output: "", explanation: `eth0 is now ${cidr}: ${name} believes ${net}/${p} is its own wire (connected route added). It has no default route yet: add one with sudo ip route add default via <gateway>.${ip === net ? " Careful: that is the network address of the subnet." : ""}` };
        },
      },
      {
        id: "addr-del",
        syntax: "sudo ip addr del <cidr> dev eth0",
        summary: "Remove that address from eth0",
        args: { cidr: cidrArg },
        run: ({ cidr }) => {
          const [ip, p] = cidr.split("/");
          if (!c.ip || c.ip !== ip || c.prefix !== +p) return refuse("RTNETLINK answers: Cannot assign requested address", c.ip ? `eth0 has ${c.ip}/${c.prefix}, not ${cidr}: delete takes the exact address/prefix.` : "eth0 has no address.");
          api.act({ type: "host-cfg", id, cfg: {} });
          return { output: "", explanation: "No address: the connected route and the default route through it are gone." };
        },
      },
      { id: "addr-flush", syntax: "sudo ip addr flush dev eth0", summary: "Remove eth0's address (and the routes through it)", run: () => (api.act({ type: "host-cfg", id, cfg: {} }), { output: "", explanation: "No address: the connected route and the default route through it are gone." }) },
      {
        id: "route-add",
        syntax: "sudo ip route add default via <ip>",
        summary: "Set the default gateway",
        args: { ip: ipArg(s) },
        run: ({ ip }) => {
          if (!c.ip || c.prefix === undefined) return refuse("Error: Nexthop has invalid gateway.", "eth0 has no address yet, so no gateway can be on its network.");
          if (c.gw && ssNetOf(c.gw, c.prefix) === ssNetOf(c.ip, c.prefix)) return refuse("RTNETLINK answers: File exists", `There is already a default route via ${c.gw}. Remove it first: sudo ip route del default.`);
          if (ssNetOf(ip, c.prefix) !== ssNetOf(c.ip, c.prefix)) return refuse("Error: Nexthop has invalid gateway.", `${ip} AND /${c.prefix} = ${ssNetOf(ip, c.prefix)}, not ${name}'s network ${ssNetOf(c.ip, c.prefix)}: a gateway must be on the host's own subnet, so Linux refuses it.`);
          api.act({ type: "host-cfg", id, cfg: { ...c, gw: ip } });
          return { output: "", explanation: `Default route via ${ip}: every destination outside ${ssNetOf(c.ip, c.prefix)}/${c.prefix} now goes there.` };
        },
      },
      { id: "route-del", syntax: "sudo ip route del default", summary: "Remove the default gateway", run: () => (c.gw ? (api.act({ type: "host-cfg", id, cfg: { ip: c.ip, prefix: c.prefix } }), { output: "" }) : refuse("RTNETLINK answers: No such process")) },
    ],
  };
}

function windowsSet(api: SsCliApi, id: string): CliCommandSet {
  const s = api.view;
  const n = ssDevice(s.needs, id)!;
  const c = s.net.hosts[id] ?? {};
  const cfg = () => ["", "Windows IP Configuration", "", "", "Ethernet adapter Ethernet0:", "", "   Connection-specific DNS Suffix  . :", `   IPv4 Address. . . . . . . . . . . : ${c.ip ?? ""}`, `   Subnet Mask . . . . . . . . . . . : ${c.prefix !== undefined ? maskOf(c.prefix) : ""}`, `   Default Gateway . . . . . . . . . : ${c.gw ?? ""}`].join("\n");
  const routes = () => {
    if (!c.ip || c.prefix === undefined) return "IPv4 Route Table\n===========================================================================\nActive Routes:\n  None";
    const net = ssNetOf(c.ip, c.prefix);
    const rows: string[][] = [["Network Destination", "Netmask", "Gateway", "Interface", "Metric"]];
    if (c.gw) rows.push(["0.0.0.0", "0.0.0.0", c.gw, c.ip, "25"]);
    rows.push([net, maskOf(c.prefix), "On-link", c.ip, "281"], [c.ip, "255.255.255.255", "On-link", c.ip, "281"]);
    return ["IPv4 Route Table", "===========================================================================", "Active Routes:", columns(rows, [21, 17, 17, 16, 6])].join("\n");
  };
  const ping = (dst: string, cnt: number) => {
    if (!c.ip) return refuse("PING: transmit failed. General failure.");
    const p = hostPing(api, id, dst);
    return { output: winPing(api.view, p, c.ip, dst, cnt), explanation: pingExplain(p) };
  };
  return {
    vendor: "cisco",
    deviceId: id,
    deviceName: n.name,
    prompt: "C:\\Users\\admin>",
    commands: [
      { id: "ipconfig", syntax: "ipconfig", summary: "Address, mask and gateway", run: () => ({ output: cfg(), explanation: "The subnet mask is this host's own idea of how big its network is. Windows ANDs its address with it to find its network." }) },
      { id: "ipconfig", syntax: "ipconfig /all", summary: "Everything about the adapter", run: () => ({ output: cfg() }) },
      { id: "route", syntax: "route print", summary: "Routing table", run: () => ({ output: routes(), explanation: "On-link = this host's own subnet (delivered directly). 0.0.0.0 = everything else, via the default gateway." }) },
      { id: "ping", syntax: "ping -n <count> <ip>", summary: "Send <count> echo requests", args: { count: countArg, ip: ipArg(s) }, run: ({ count, ip }) => ping(ip, +count) },
      { id: "ping", syntax: "ping <ip>", summary: "Send 4 echo requests", args: { ip: ipArg(s) }, run: ({ ip }) => ping(ip, 4) },
      { id: "hist", syntax: "doskey /history", summary: "Commands typed in this session", run: () => ({ output: [...(api.history ?? []), "doskey /history"].join("\n") }) },
      {
        id: "netsh",
        syntax: "netsh interface ip set address <name> static <ip> <mask> <gateway>",
        summary: "Set a static address, mask and gateway",
        args: { name: nameArg, ip: plainIp, mask: maskArg, gateway: plainIp },
        run: ({ name: adapter, ip, mask, gateway }) => {
          if (adapter !== "Ethernet0") return refuse("Element not found.", `This PC has no adapter called "${adapter}": ipconfig shows its name, Ethernet0.`);
          const prefix = prefixOfMask(mask)!;
          const net = ssNetOf(ip, prefix);
          if (ip === net) return refuse("The address is not valid for the subnet mask.", `${ip} is the network address of ${net}/${prefix}.`);
          api.act({ type: "host-cfg", id, cfg: { ip, prefix, gw: gateway } });
          return { output: "", explanation: `${n.name} is now ${ip}/${prefix} with gateway ${gateway}. Windows accepts a gateway it can't reach directly${ssNetOf(gateway, prefix) !== net ? ` — and ${gateway} is NOT on ${net}/${prefix}` : ""}; check with ipconfig and route print, then ping.` };
        },
      },
    ],
  };
}
export const ssHostSet = (api: SsCliApi, id: string) => (ssDevice(api.view.needs, id)?.os === "windows" ? withSelfPing(windowsSet(api, id), "windows", [api.view.net.hosts[id]?.ip]) : withSelfPing(linuxSet(api, id), "linux", [api.view.net.hosts[id]?.ip]));

// ---------------------------------------------------------------------------------------------------------------
// R1
// ---------------------------------------------------------------------------------------------------------------
const order = (s: SsState) => [...s.needs].sort((a, b) => a.iface - b.iface);
function routesSummary(s: SsState) {
  const p = ssParent(s);
  const rs = ssR1Routes(s.needs, s.net);
  const masks = new Set(rs.map((r) => r.prefix)).size;
  return { p, rs, masks };
}
export function ssJunosText(s: SsState, r1: Record<string, SsIf>, path: string[] = []) {
  const blocks = order(s).map((n) => [`    ${ssJunosIf(n.iface)} {`, `        description "${n.id}";`, "        unit 0 {", "            family inet {", ...(r1[n.id]?.ip ? [`                address ${r1[n.id].ip}/${r1[n.id].prefix};`] : []), "            }", "        }", "    }"].join("\n"));
  if (!path.length) return ["interfaces {", ...blocks, "}"].join("\n");
  if (path[0] === "interfaces" && path.length === 1) return blocks.map((b) => b.replace(/^ {4}/gm, "")).join("\n");
  // One interface: its statements only (no wrapper), as Junos prints the hierarchy level.
  const i = order(s).findIndex((n) => ssJunosIf(n.iface) === path[1]);
  return i >= 0 ? blocks[i].split("\n").slice(1, -1).map((l) => l.slice(8)).join("\n") : "";
}

function ciscoR1(api: SsCliApi): CliCommandSet {
  const s = api.view;
  const names = Object.fromEntries(order(s).map((n) => [n.id, ssCiscoIf(n.iface)]));
  const ifArg = interfaceArg("cisco", names, Object.fromEntries(order(s).map((n) => [n.id, `${n.id} (${n.what})`])));
  const mode = api.cisco;
  const brief = () => columns([["Interface", "IP-Address", "OK?", "Method", "Status", "Protocol"], ...order(s).map((n) => [ssCiscoIf(n.iface), s.net.r1[n.id]?.ip ?? "unassigned", "YES", s.net.r1[n.id]?.ip ? "manual" : "unset", "up", "up"])], [23, 16, 4, 7, 22, 8]);
  const routes = () => {
    const { p, rs, masks } = routesSummary(s);
    const lines = ["Codes: L - local, C - connected", "", "Gateway of last resort is not set", ""];
    if (rs.length) lines.push(`      ${p.network}/${p.prefix} is variably subnetted, ${rs.length * 2} subnets, ${masks + 1} masks`);
    for (const r of rs) lines.push(`C        ${r.network}/${r.prefix} is directly connected, ${ssCiscoIf(r.iface)}`, `L        ${r.ip}/32 is directly connected, ${ssCiscoIf(r.iface)}`);
    return lines.join("\n");
  };
  const block = (id: string) => {
    const n = s.needs.find((x) => x.id === id)!;
    const c = s.net.r1[id];
    return [`interface ${ssCiscoIf(n.iface)}`, ` description ${n.id}`, c?.ip ? ` ip address ${c.ip} ${maskOf(c.prefix!)}` : " no ip address", "!"];
  };
  const running = (only?: string) => (only ? block(only).join("\n") : ["hostname R1", "!", ...order(s).flatMap((n) => block(n.id)), "end"].join("\n"));
  const show: CliCommand[] = [
    { id: "brief", syntax: "show ip interface brief", summary: "Interfaces, addresses and status", run: () => ({ output: brief(), explanation: "Each interface with an address gives R1 one connected subnet: the address AND its mask." }) },
    { id: "route", syntax: "show ip route", summary: "Routing table", run: () => ({ output: routes(), explanation: "C = the subnet of each configured interface. R1 can only deliver to addresses inside these. Compare them with your plan: they must be exactly the blocks you designed." }) },
    { id: "route", syntax: "show ip route connected", summary: "Connected routes only", run: () => ({ output: routes() }) },
    { id: "run", syntax: "show running-config", summary: "Current configuration", run: () => ({ output: running() }) },
    { id: "run", syntax: "show running-config interface <interface>", summary: "One interface's configuration", args: { interface: ifArg }, run: ({ interface: i }) => ({ output: running(i) }) },
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
              const p = api.act({ type: "ping", src: "r1", dst: ip }).lastPing!;
              const ch = p.ok ? "!" : p.there.fail === "no-route" ? "U" : ".";
              return { output: ["Type escape sequence to abort.", `Sending 5, 100-byte ICMP Echos to ${ip}, timeout is 2 seconds:`, ch.repeat(5), `Success rate is ${p.ok ? 100 : 0} percent (${p.ok ? 5 : 0}/5)`].join("\n"), explanation: pingExplain(p) };
            },
          },
          { id: "conf", syntax: "configure terminal", summary: "Configuration mode", run: () => (api.setCisco({ kind: "config" }), { output: "Enter configuration commands, one per line.  End with CNTL/Z." }) },
          { id: "hist", syntax: "show history", summary: "Commands typed in this session", run: () => ({ output: [...(api.history ?? []), "show history"].map((x) => `  ${x}`).join("\n") }) },
        ]
      : [
          ...show.map((c) => ({ ...c, id: `do:${c.id}`, syntax: `do ${c.syntax}` })),
          { id: "if", syntax: "interface <interface>", summary: "Configure an interface", args: { interface: ifArg }, run: ({ interface: i }) => (api.setCisco({ kind: "if", id: i }), { output: "" }) },
          ...(mode.kind === "if"
            ? ((id: string): CliCommand[] => {
                const n = s.needs.find((x) => x.id === id)!;
                return [
                  {
                    id: "ipaddr",
                    syntax: "ip address <ip> <mask>",
                    summary: "Set this interface's IPv4 address and mask",
                    args: { ip: { choices: s.net.r1[id]?.ip ? [s.net.r1[id].ip!] : [], resolve: (raw) => (isIp(raw) ? raw : undefined) }, mask: { choices: ["255.255.255.128", "255.255.255.192", "255.255.255.224", "255.255.255.252"], resolve: (raw) => (prefixOfMask(raw) !== undefined ? raw : undefined) } },
                    run: ({ ip, mask }) => {
                      const prefix = prefixOfMask(mask)!;
                      const ok = ssR1Accept(s.needs, s.net.r1, id, ip, prefix);
                      if (!ok.ok) return refuse(ok.ios, ok.code === "overlap" ? `R1 refuses: ${ssNetOf(ip, prefix)}/${prefix} would share addresses with the subnet already on ${ssCiscoIf(s.needs.find((x) => x.id === ok.with)!.iface)}. A router cannot have one address in two connected networks.` : ok.code === "network" || ok.code === "broadcast" ? `${ip} is the ${ok.code} address of ${ssNetOf(ip, prefix)}/${prefix}: no interface can use it.` : undefined);
                      api.act({ type: "r1-if", id, ip, prefix, by: "IOS" });
                      return { output: "", explanation: `${ssCiscoIf(n.iface)} is now ${ip}/${prefix}: connected subnet ${ssNetOf(ip, prefix)}/${prefix}. Hosts on ${id} must use ${ip} as their gateway.` };
                    },
                  },
                  { id: "noip", syntax: "no ip address", summary: "Remove this interface's address", run: () => (api.act({ type: "r1-if", id, by: "IOS" }), { output: "" }) },
                ];
              })(mode.id)
            : []),
          { id: "exit", syntax: "exit", summary: "Up one level", run: () => (api.setCisco(mode.kind === "if" ? { kind: "config" } : { kind: "exec" }), { output: "" }) },
          { id: "end", syntax: "end", summary: "Back to privileged mode", run: () => (api.setCisco({ kind: "exec" }), { output: "" }) },
        ];
  return { vendor: "cisco", deviceId: "r1", deviceName: "R1", prompt: mode.kind === "exec" ? "R1#" : mode.kind === "config" ? "R1(config)#" : "R1(config-if)#", commands: cmds };
}

/** Junos commit check: the whole candidate, interface by interface, with the same rule as IOS. */
export function ssJunosCheck(s: SsState, cand: Record<string, SsIf>): string | undefined {
  let acc: Record<string, SsIf> = {};
  for (const n of order(s)) {
    const c = cand[n.id];
    if (!c?.ip || c.prefix === undefined) continue;
    const ok = ssR1Accept(s.needs, acc, n.id, c.ip, c.prefix);
    if (!ok.ok) return ok.junos;
    acc = { ...acc, [n.id]: c };
  }
  return undefined;
}

function junosR1(api: SsCliApi): CliCommandSet {
  const s = api.view;
  const names = Object.fromEntries(order(s).map((n) => [n.id, ssJunosIf(n.iface)]));
  const ifArg = interfaceArg("juniper", names, Object.fromEntries(order(s).map((n) => [n.id, `${n.id} (${n.what})`])));
  const active = s.net.r1;
  const cand = api.cand;
  const same = (a: Record<string, SsIf>, b: Record<string, SsIf>) => order(s).every((n) => (a[n.id]?.ip ?? "") === (b[n.id]?.ip ?? "") && (a[n.id]?.prefix ?? -1) === (b[n.id]?.prefix ?? -1));
  const dirty = !same(cand, active);
  const doCommit = (quit: boolean): CliResult => {
    const err = dirty ? ssJunosCheck(s, cand) : undefined;
    if (err) return refuse(`[edit interfaces]\n  ${err}\nerror: configuration check-out failed`, "Junos checks the whole candidate before activating it: two interfaces whose subnets share addresses can't both be active in one routing table. Nothing changed; fix the candidate or rollback.");
    if (dirty) api.commit(cand);
    if (quit) api.setJunosEdit(false);
    const output = quit ? "commit complete\nExiting configuration mode" : "commit complete";
    return dirty ? { output, explanation: "Now active: R1's connected routes follow the new addresses." } : { output };
  };
  const terse = () => columns([["Interface", "Admin", "Link", "Proto", "Local"], ...order(s).flatMap((n) => [[ssJunosIf(n.iface), "up", "up", "", ""], [`${ssJunosIf(n.iface)}.0`, "up", "up", active[n.id]?.ip ? "inet" : "", active[n.id]?.ip ? `${active[n.id].ip}/${active[n.id].prefix}` : ""]])], [16, 6, 5, 6, 20]);
  const route = () => {
    const rs = ssR1Routes(s.needs, s.net);
    return [`inet.0: ${rs.length * 2} destinations, ${rs.length * 2} routes (${rs.length * 2} active, 0 holddown, 0 hidden)`, "+ = Active Route, - = Last Active, * = Both", "", ...rs.flatMap((r) => [`${`${r.network}/${r.prefix}`.padEnd(19)}*[Direct/0] 1w0d`, `                    >  via ${ssJunosIf(r.iface)}.0`, `${`${r.ip}/32`.padEnd(19)}*[Local/0] 1w0d`, `                       Local via ${ssJunosIf(r.iface)}.0`])].join("\n");
  };
  const op: CliCommand[] = [
    { id: "terse", syntax: "show interfaces terse", summary: "Interfaces, status and addresses", run: () => ({ output: terse(), explanation: "Each address gives R1 one Direct (connected) subnet: the address AND its prefix." }) },
    { id: "route", syntax: "show route", summary: "Routing table", run: () => ({ output: route(), explanation: "Direct = the subnet of each configured interface. Compare them with your plan: they must be exactly the blocks you designed." }) },
    { id: "cfg", syntax: "show configuration", summary: "Active configuration", run: () => ({ output: ssJunosText(s, active) }) },
    { id: "cfg", syntax: "show configuration interfaces", summary: "Interface configuration", run: () => ({ output: ssJunosText(s, active, ["interfaces"]) }) },
    { id: "cfg", syntax: "show configuration interfaces <iface>", summary: "One interface's active configuration", args: { iface: ifArg }, run: ({ iface }) => ({ output: ssJunosText(s, active, ["interfaces", names[iface]]) }) },
    { id: "commits", syntax: "show system commit", summary: "Commit history", run: () => ({ output: api.hist.map((c, i) => `${i}   ${new Date(c.at || Date.now() - 3600000).toISOString().replace("T", " ").slice(0, 19)} UTC by ${c.by} via cli`).join("\n") }) },
    {
      id: "ping",
      syntax: "ping <ip> count <count>",
      summary: "Send <count> echo requests",
      args: { ip: ipArg(s), count: countArg },
      run: ({ ip, count }) => {
        const p = api.act({ type: "ping", src: "r1", dst: ip }).lastPing!;
        const n = +count;
        const from = p.there.fromIp ?? "R1";
        return { output: [`PING ${ip} (${ip}): 56 data bytes`, ...(p.ok ? Array.from({ length: n }, (_, i) => `64 bytes from ${ip}: icmp_seq=${i} ttl=${ttlOf(api.view, p)} time=0.${4 + i} ms`) : []), "", `--- ${ip} ping statistics ---`, `${n} packets transmitted, ${p.ok ? n : 0} packets received, ${p.ok ? 0 : 100}% packet loss`].join("\n"), explanation: p.ok ? `Sent from ${from}.` : pingExplain(p) };
      },
    },
    { id: "hist", syntax: "show cli history", summary: "Commands typed in this session", run: () => ({ output: [...(api.history ?? []), "show cli history"].map((x) => `  ${x}`).join("\n") }) },
  ];
  const addrArg: CliArgSpec = { choices: order(s).map((n) => cand[n.id]?.ip).filter((x): x is string => !!x).map((ip) => `${ip}/${order(s).map((n) => cand[n.id]).find((c) => c?.ip === ip)!.prefix}`), describe: () => "address/prefix", resolve: (raw) => (/^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/.test(raw) && isIp(raw.split("/")[0]) && +raw.split("/")[1] >= 8 && +raw.split("/")[1] <= 30 ? raw : undefined) };
  const edit: CliCommand[] = [
    ...op.map((c) => ({ ...c, id: `run:${c.id}`, syntax: `run ${c.syntax}` })),
    {
      id: "set-addr",
      syntax: "set interfaces <iface> unit 0 family inet address <address>",
      summary: "Set an interface's address/prefix (candidate)",
      args: { iface: ifArg, address: addrArg },
      run: ({ iface, address }) => {
        const [ip, p] = address.split("/");
        const net = ssNetOf(ip, +p);
        if (net === ip) return refuse(`error: ${address}: address is the subnet's network address`);
        // Junos keeps every address set on the unit; this lab models one address per interface, so a new one replaces it.
        api.setCand({ ...cand, [iface]: { ip, prefix: +p } });
        return { output: "", explanation: `Candidate only: ${ssJunosIf(s.needs.find((n) => n.id === iface)!.iface)} would be ${address} (subnet ${net}/${p}). R1 keeps using the active configuration until you commit.` };
      },
    },
    { id: "del-addr", syntax: "delete interfaces <iface> unit 0 family inet address", summary: "Remove an interface's address (candidate)", args: { iface: ifArg }, run: ({ iface }) => (cand[iface]?.ip ? (api.setCand({ ...cand, [iface]: {} }), { output: "" }) : refuse("warning: statement not found")) },
    { id: "show", syntax: "show", summary: "The candidate configuration (try show | compare)", run: () => ({ output: ssJunosText(s, cand) }) },
    { id: "show", syntax: "show interfaces", summary: "Candidate interface configuration", run: () => ({ output: ssJunosText(s, cand, ["interfaces"]) }) },
    { id: "show", syntax: "show interfaces <iface>", summary: "One interface in the candidate", args: { iface: ifArg }, run: ({ iface }) => ({ output: ssJunosText(s, cand, ["interfaces", names[iface]]) }) },
    { id: "commit", syntax: "commit", summary: "Activate the candidate configuration", run: () => doCommit(false) },
    { id: "commit", syntax: "commit and-quit", summary: "Activate the candidate and leave configuration mode", run: () => doCommit(true) },
    { id: "commit", syntax: "commit check", summary: "Validate without activating", run: () => { const err = ssJunosCheck(s, cand); return err ? refuse(`[edit interfaces]\n  ${err}\nerror: configuration check-out failed`) : { output: "configuration check succeeds" }; } },
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
export const ssR1Sets = (api: SsCliApi): Record<CliVendor, CliCommandSet> => {
  const own = Object.values(api.view.net.r1).map((x) => x.ip);
  return { cisco: withSelfPing(ciscoR1(api), "ios", own), juniper: withSelfPing(junosR1(api), "junos", own) };
};
export const ssJunosConfig = (s: SsState, hist: SsCommit[]) => (which: "committed" | number, path: string[]) => {
  const e = which === "committed" ? hist[0] : hist[which];
  return e ? ssJunosText(s, e.r1, path) : undefined;
};
export { ssDevName };
