import type { CliArgSpec, CliCommand, CliCommandSet, CliVendor } from "@/lib/cli/types";
import { buildJunosSet, junosPipeConfig, numArg, type SpCfgStmt, type SpCmd, type SpDevCli, type SpJunosSpec } from "@/components/sp-lab/spCli";
import { pad, spStamp, type JStmt } from "@/components/sp-lab/spKit";
import { L3, inNet, networkOf } from "@/lib/sim-engine/scenarios/troubleshootingLayer3";
import { DEV_LABEL, MACS, RTR_IFS, hostRoutes, ownerOf, l3Apply, lastTest, lpm, rtrRoutes, srcIpOf, type HostCfg, type L3Action, type L3D, type L3H, type L3R, type L3State, type RCfg, type Route } from "@/lib/sim-engine/scenarios/l3tsNet";

/**
 * Command lines of the Layer 3 Lab. Every output is printed from the lab model (l3tsNet.ts).
 *
 * R1 / R2 (Junos): show interfaces terse | show route [<ip>] | show arp no-resolve | show system statistics arp
 *   | show log messages | ping <ip> count <n> | traceroute <ip> no-resolve | clear arp
 *   configure: interfaces <if> unit 0 family inet address <a/len> · interfaces <if> disable
 *   · routing-options static route <p/len> next-hop <ip>
 * CLIENT / SERVER / REMOTE-SERVER (Linux): ip addr · ip route · ip route get <ip> · ip neigh · ping -c <n> <ip>
 *   · traceroute -n <ip> · sudo ip addr add|del <a/len> dev eth0 · sudo ip route add|replace default via <ip>
 *   · sudo ip route del default · sudo ip neigh flush dev eth0
 */

export interface L3CliApi {
  s: L3State;
  act: (a: L3Action) => L3State;
  dev: SpDevCli<RCfg>;
}
const PEER: Record<string, string> = { "R1:ge-0/0/0": "CLIENT LAN (SW1)", "R1:ge-0/0/1": "R2 (transit /31)", "R2:ge-0/0/0": "R1 (transit /31)", "R2:ge-0/0/1": "SERVER LAN", "R2:ge-0/0/2": "REMOTE-SERVER LAN" };
const ifArg = (r: L3R): CliArgSpec => ({ choices: RTR_IFS[r], describe: (c) => `to ${PEER[`${r}:${c}`]}`, resolve: (raw) => RTR_IFS[r].find((i) => i === raw.replace(/\.0$/, "")) });
const ipRe = /^(\d{1,3}\.){3}\d{1,3}$/;
const cidrRe = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;
const ALL_IPS = [L3.server, L3.remote, L3.client, L3.gw, L3.r1T, L3.r2T, L3.r2Srv, L3.r2Rem];
const ipArg = (choices = ALL_IPS): CliArgSpec => ({ choices, describe: (c) => ({ [L3.server]: "SERVER", [L3.remote]: "REMOTE-SERVER", [L3.client]: "CLIENT", [L3.gw]: "R1 ge-0/0/0", [L3.r1T]: "R1 ge-0/0/1", [L3.r2T]: "R2 ge-0/0/0", [L3.r2Srv]: "R2 ge-0/0/1", [L3.r2Rem]: "R2 ge-0/0/2" })[c] ?? "IPv4 address", resolve: (raw) => (ipRe.test(raw) ? raw : undefined) });
const cidrArg = (choices: string[], what: string): CliArgSpec => ({ choices, describe: () => what, resolve: (raw) => (cidrRe.test(raw) && +raw.split("/")[1] <= 32 ? raw : undefined) });
const age = "41w0d 01:00:00";
/** TTL of a reply as the pinging device sees it: 64 minus the routers the reply crossed. */
const ATTACH: Record<L3D, L3R | undefined> = { CLIENT: "R1", SW1: "R1", R1: undefined, R2: undefined, SERVER: "R2", REMOTE: "R2" };
function replyTtl(s: L3State, from: L3D, ip: string): number {
  const owner = ownerOf(s, ip);
  if (!owner) return 64;
  const a = from === "R1" || from === "R2" ? from : ATTACH[from]!;
  const b = owner === "R1" || owner === "R2" ? owner : ATTACH[owner]!;
  const path: L3R[] = a === b ? [a] : [a, b];
  // Routers the reply passes through (the replying router itself, and the pinging router, don't decrement).
  const crossed = path.filter((r) => r !== owner && r !== from).length;
  return 64 - crossed;
}

// ---------------------------------------------------------------------------------------------------------------
// Junos outputs
// ---------------------------------------------------------------------------------------------------------------
function terse(s: L3State, r: L3R): string {
  const c = s.rtrs[r];
  const rows = RTR_IFS[r].map((ifn) => {
    const i = c.ifs[ifn] ?? {};
    const st = i.disable ? "down" : "up";
    return `${pad(ifn, 24)}${pad(st, 6)}${st}\n${pad(`${ifn}.0`, 24)}${pad(st, 6)}${pad(st, 5)}${pad("inet", 9)}${i.addr ? `${i.addr}/${i.len}` : ""}`;
  });
  return [`${pad("Interface", 24)}${pad("Admin", 6)}${pad("Link", 5)}${pad("Proto", 9)}Local                 Remote`, ...rows, `${pad("lo0", 24)}${pad("up", 6)}up`].join("\n");
}
function routeRows(rs: Route[]): string[] {
  const out: string[] = [];
  for (const rt of rs) {
    const head = `${pad(`${rt.prefix}/${rt.len}`, 19)}*[${rt.kind === "Static" ? "Static/5" : rt.kind === "Local" ? "Local/0" : "Direct/0"}] ${age}`;
    out.push(head, rt.kind === "Local" ? `                       Local via ${rt.ifn}.0` : rt.kind === "Static" ? `                    >  to ${rt.nh} via ${rt.ifn}.0` : `                    >  via ${rt.ifn}.0`);
  }
  return out;
}
function showRoute(s: L3State, r: L3R, ip?: string): string | { output: string; explanation: string } {
  const all = rtrRoutes(s.rtrs[r]);
  const sel = ip ? [all.filter((x) => (x.len === 0 || inNet(ip, x.prefix, x.len))).sort((a, b) => b.len - a.len)[0]].filter(Boolean) : all;
  if (ip && !sel.length) return { output: [`inet.0: ${all.length} destinations, ${all.length} routes (${all.length} active, 0 holddown, 0 hidden)`, "+ = Active Route, - = Last Active, * = Both"].join("\n"), explanation: `No route in inet.0 matches ${ip} — not even a default route. This router would drop such a packet and answer with ICMP destination net unreachable.` };
  return [`inet.0: ${all.length} destinations, ${all.length} routes (${all.length} active, 0 holddown, 0 hidden)`, "+ = Active Route, - = Last Active, * = Both", "", ...routeRows(sel as Route[])].join("\n");
}
function arpTable(s: L3State, r: L3R): string {
  const rows = Object.entries(s.arp[r]).filter(([, e]) => e.state === "REACHABLE").map(([ip, e]) => `${pad(e.mac!.toLowerCase(), 18)}${pad(ip, 16)}${pad(ip, 16)}${pad(`${e.ifn}.0`, 23)}none`);
  return [`${pad("MAC Address", 18)}${pad("Address", 16)}${pad("Name", 16)}${pad("Interface", 23)}Flags`, ...rows, `Total entries: ${rows.length}`].join("\n");
}
function arpStats(s: L3State, r: L3R): string {
  return ["arp:", `        ${pad(18_204 + s.arpRx[r] * 3, 8)}datagrams received`, `        ${pad(12_011 + s.arpRx[r], 8)}ARP requests received`, `        ${pad(6_190, 8)}ARP replies received`, "        0       resolution request received", "        0       resolution request dropped", "        0       unrestricted proxy requests", "        0       restricted proxy requests", "        0       received proxy requests", "        0       proxy requests not proxied", "        0       restricted-proxy requests not proxied", "        0       datagrams with bogus interface", "        0       datagrams with incorrect length", "        0       datagrams for non-IP protocol", "        0       datagrams with unsupported op code", "        0       datagrams with bad protocol address length", "        0       datagrams with bad hardware address length", "        0       datagrams with multicast source address", "        0       datagrams with multicast target address", "        0       datagrams with my own hardware address", "        0       datagrams for an address not on the interface", "        0       datagrams with a broadcast source address", "        0       datagrams with source address duplicate to mine", `        ${pad(4_112 + s.arpNotForMe[r], 8)}datagrams which were not for me`, "        0       packets discarded waiting for resolution", `        ${pad(1_880, 8)}packets sent after waiting for resolution`, `        ${pad(6_201, 8)}ARP requests sent`, `        ${pad(12_011 + s.arpRx[r] - s.arpNotForMe[r], 8)}ARP replies sent`].join("\n");
}
function logs(s: L3State, r: L3R): string {
  return [`Oct 11 08:59:58  ${r} mgd[2211]: UI_LOGIN_EVENT: User 'admin' login, class 'j-super-user' [41092]`, ...s.sys.filter((x) => x.dev === r).map((x) => `Oct 11 ${spStamp(x.t).hms}  ${r} ${x.text}`)].join("\n");
}
const ms = (base: number, k: number) => (base + k * 0.031).toFixed(3);
function traceOut(ns: L3State, dst: string, linux: boolean): string {
  const t = lastTest(ns);
  const lines = [linux ? `traceroute to ${dst} (${dst}), 30 hops max, 60 byte packets` : `traceroute to ${dst} (${dst}), 30 hops max, 52 byte packets`];
  if (t.error && !t.hops?.length) return linux ? `connect: ${t.error}` : `traceroute: sendto: ${t.error}`;
  (t.hops ?? []).forEach((h, i) => {
    const n = String(i + 1).padStart(2);
    const bang = t.error?.startsWith("!N") && i === t.hops!.length - 1 ? " !N" : "";
    lines.push(h ? `${n}  ${h}  ${ms(0.4 + i * 0.45, 0)} ms${bang}  ${ms(0.4 + i * 0.45, 1)} ms${bang}  ${ms(0.4 + i * 0.45, 2)} ms${bang}` : `${n}  * * *`);
  });
  return lines.join("\n");
}
export function l3JnStmts(r: L3R, c: RCfg): JStmt[] {
  const out: JStmt[] = [];
  for (const ifn of RTR_IFS[r]) {
    const i = c.ifs[ifn] ?? {};
    out.push({ path: ["interfaces", ifn], leaf: `description "${PEER[`${r}:${ifn}`]}"` });
    if (i.disable) out.push({ path: ["interfaces", ifn], leaf: "disable" });
    if (i.addr) out.push({ path: ["interfaces", ifn, "unit 0", "family inet"], leaf: `address ${i.addr}/${i.len}` });
  }
  for (const st of c.statics) out.push({ path: ["routing-options", "static", `route ${st.prefix}/${st.len}`], leaf: `next-hop ${st.nh}` });
  return out;
}
function stmts(r: L3R): SpCfgStmt<RCfg>[] {
  const ifa = ifArg(r);
  const routeChoices = ["10.10.10.0/24", "10.20.20.0/24", "10.10.20.0/24", "0.0.0.0/0"];
  return [
    {
      id: "j-addr",
      summary: "The interface's IPv4 address and prefix length",
      args: { ifa, cidr: cidrArg(r === "R1" ? ["10.10.10.1/24", "192.0.2.0/31"] : ["192.0.2.1/31", "10.20.20.1/24", "10.10.20.1/24"], "address/prefix-length") },
      junos: { syntax: "interfaces <ifa> unit 0 family inet address <cidr>", set: (c, a) => ((c.ifs[a.ifa] = { ...(c.ifs[a.ifa] ?? {}), addr: a.cidr.split("/")[0], len: +a.cidr.split("/")[1] }), c), del: (c, a) => (c.ifs[a.ifa] && delete c.ifs[a.ifa].addr && delete c.ifs[a.ifa].len, c) },
    },
    { id: "j-dis", summary: "Disable the interface", args: { ifd: ifArg(r) }, junos: { syntax: "interfaces <ifd> disable", set: (c, a) => ((c.ifs[a.ifd] = { ...(c.ifs[a.ifd] ?? {}), disable: true }), c), del: (c, a) => (c.ifs[a.ifd] && delete c.ifs[a.ifd].disable, c) } },
    {
      id: "j-st",
      summary: "A static route and its next hop",
      args: { pfx: cidrArg(routeChoices, "destination prefix/length"), nh: ipArg([L3.r1T, L3.r2T]) },
      junos: {
        syntax: "routing-options static route <pfx> next-hop <nh>",
        set: (c, a) => {
          const [p, l] = a.pfx.split("/");
          if (networkOf(p, +l) !== p) return `error: ${a.pfx}: host bits set — did you mean ${networkOf(p, +l)}/${l}?`;
          c.statics = [...c.statics.filter((x) => !(x.prefix === p && x.len === +l)), { prefix: p, len: +l, nh: a.nh }];
          return c;
        },
        del: (c, a) => ((c.statics = c.statics.filter((x) => !(x.prefix === a.pfx.split("/")[0] && x.len === +a.pfx.split("/")[1] && x.nh === a.nh))), c),
      },
    },
    { id: "j-st-del", summary: "A whole static route", args: { pfx2: cidrArg(routeChoices, "destination prefix/length") }, junos: { syntax: "routing-options static route <pfx2>", set: () => "error: missing mandatory statement: a static route needs next-hop <ip>", del: (c, a) => ((c.statics = c.statics.filter((x) => !(x.prefix === a.pfx2.split("/")[0] && x.len === +a.pfx2.split("/")[1]))), c) } },
  ];
}
export function l3JunosSpec(api: L3CliApi, r: L3R): SpJunosSpec<RCfg> {
  const s = api.s;
  const sh = (id: string, syntax: string, summary: string, run: SpCmd["run"], args?: SpCmd["args"]): SpCmd => ({ id, syntax, summary, run, args });
  const shows: SpCmd[] = [
    sh("terse", "show interfaces terse", "Interfaces, state and IPv4 addresses", () => terse(s, r)),
    sh("rt", "show route", "The routing table (inet.0)", () => showRoute(s, r)),
    sh("rtip", "show route <ip>", "The best route for one destination (longest-prefix match)", (a) => showRoute(s, r, a.ip), { ip: ipArg() }),
    sh("arp", "show arp no-resolve", "The ARP table", () => arpTable(s, r)),
    sh("arps", "show system statistics arp", "ARP counters — including requests that were not for this router", () => arpStats(s, r)),
    sh("log", "show log messages", "System log: link changes, commits", () => logs(s, r)),
  ];
  const op: SpCmd[] = [
    sh("ping", "ping <ip> count <n>", "Ping from this router", (a) => {
      const ns = l3Apply(s, { type: "ping", from: r, dst: a.ip, count: +a.n });
      api.act({ type: "ping", from: r, dst: a.ip, count: +a.n });
      const t = lastTest(ns);
      const lines = [`PING ${a.ip} (${a.ip}): 56 data bytes`];
      for (let q = 0; q < t.recv; q++) lines.push(`64 bytes from ${a.ip}: icmp_seq=${q} ttl=${replyTtl(s, r, a.ip)} time=${ms(0.9, q)} ms`);
      if (t.error) for (let q = 0; q < t.sent; q++) lines.push(t.error === "Time to live exceeded" ? `36 bytes from ${t.errorFrom}: Time to live exceeded` : t.error === "Destination Net Unreachable" ? `36 bytes from ${t.errorFrom}: Destination Net Unreachable` : `ping: sendto: Host is down`);
      lines.push("", `--- ${a.ip} ping statistics ---`, `${t.sent} packets transmitted, ${t.recv} packets received, ${Math.round((100 * (t.sent - t.recv)) / t.sent)}% packet loss`);
      if (t.recv) lines.push("round-trip min/avg/max/stddev = 0.902/0.948/0.995/0.035 ms");
      return { output: lines.join("\n") };
    }, { ip: ipArg(), n: numArg(1, 20, ["4"], "Count") }),
    sh("tr", "traceroute <ip> no-resolve", "Hop-by-hop path (TTL 1, 2, 3 …)", (a) => {
      const ns = l3Apply(s, { type: "trace", from: r, dst: a.ip });
      api.act({ type: "trace", from: r, dst: a.ip });
      return { output: traceOut(ns, a.ip, false) };
    }, { ip: ipArg() }),
    sh("clr", "clear arp", "Flush the ARP table", () => {
      api.act({ type: "clear-arp", dev: r });
      return "";
    }),
  ];
  return { stmts: stmts(r), shows, op, jstmts: (c) => l3JnStmts(r, c), help: { "show interfaces": "Interface information", "show route": "Routing table information", "show arp": "ARP table", "show system": "System information", "show log": "Log files" } };
}

// ---------------------------------------------------------------------------------------------------------------
// Linux hosts
// ---------------------------------------------------------------------------------------------------------------
const exact = (v: string, what: string): CliArgSpec => ({ choices: [v], describe: () => what, resolve: (raw) => (raw === v ? raw : undefined) });
function ipRoute(h: HostCfg): string {
  const rs = hostRoutes(h);
  return rs.map((r) => (r.kind === "default" ? `default via ${r.nh} dev eth0 proto static` : `${r.prefix}/${r.len} dev eth0 proto kernel scope link src ${h.addrs.find((a) => networkOf(a.ip, a.len) === r.prefix && a.len === r.len)?.ip}`)).join("\n") || "";
}
function hostSet(api: L3CliApi, h: L3H): CliCommandSet {
  const s = api.s;
  const cfg = s.hosts[h];
  const name = DEV_LABEL[h].toLowerCase();
  const prompt = `admin@${name}:~$ `;
  const cmds: CliCommand[] = [];
  const add = (id: string, syntax: string, summary: string, run: CliCommand["run"], args?: CliCommand["args"], hidden?: boolean) => cmds.push({ id: `${h}-${id}`, syntax, summary, run, args, hidden });
  const set = (next: HostCfg, text: string) => api.act({ type: "host", dev: h, cfg: next, text });
  const eth0 = exact("eth0", "The wired interface");
  const me = cfg.addrs[0]?.ip ?? "0.0.0.0";
  add("addr", "ip addr", "Addresses and prefix lengths", () => ({ output: [`1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN group default qlen 1000`, "    inet 127.0.0.1/8 scope host lo", `2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc fq_codel state UP group default qlen 1000`, `    link/ether ${MACS[`${h}:eth0`].toLowerCase()} brd ff:ff:ff:ff:ff:ff`, ...cfg.addrs.map((a) => `    inet ${a.ip}/${a.len} brd ${networkOf(a.ip, a.len).split(".").map((o, i) => { const m = a.len - i * 8; return m >= 8 ? o : String((+o) | (255 >> Math.max(0, m))); }).join(".")} scope global eth0`)].join("\n") }));
  add("route", "ip route", "The host's routing table", () => {
    const out = ipRoute(cfg);
    return out ? { output: out } : { output: "", explanation: "The routing table is empty: no address on eth0, so no connected route — and no default route." };
  });
  add("get", "ip route get <ip>", "Which route the kernel would use for one destination", (a) => {
    const r = lpm(hostRoutes(cfg), a.ip);
    if (!r) return { output: "RTNETLINK answers: Network is unreachable", refused: true };
    const src = srcIpOf(s, h, a.ip);
    return { output: `${a.ip} ${r.kind === "default" ? `via ${r.nh} ` : ""}dev eth0 src ${src} uid 1000 \n    cache ` };
  }, { ip: ipArg() });
  add("neigh", "ip neigh", "The ARP (neighbour) cache", () => {
    const rows = Object.entries(s.arp[h]).map(([ip, e]) => (e.state === "FAILED" ? `${ip} dev eth0 FAILED` : `${ip} dev eth0 lladdr ${e.mac!.toLowerCase()} REACHABLE`));
    return rows.length ? { output: rows.join("\n") } : { output: "", explanation: "The ARP cache is empty — nothing resolved yet." };
  });
  add("ping", "ping -c <n> <ip>", "Send <n> echo requests", (a) => {
    const n = +a.n;
    const ns = l3Apply(s, { type: "ping", from: h, dst: a.ip, count: n });
    api.act({ type: "ping", from: h, dst: a.ip, count: n });
    const t = lastTest(ns);
    if (t.error === "Network is unreachable") return { output: "ping: connect: Network is unreachable", refused: true };
    const lines = [`PING ${a.ip} (${a.ip}) 56(84) bytes of data.`];
    if (t.error) for (let q = 1; q <= n; q++) lines.push(`From ${t.errorFrom} icmp_seq=${q} ${t.error}`);
    for (let q = 1; q <= t.recv; q++) lines.push(`64 bytes from ${a.ip}: icmp_seq=${q} ttl=${replyTtl(s, h, a.ip)} time=${ms(1.1, q)} ms`);
    lines.push("", `--- ${a.ip} ping statistics ---`, `${n} packets transmitted, ${t.recv} received, ${t.error ? `+${n} errors, ` : ""}${Math.round((100 * (n - t.recv)) / n)}% packet loss, time ${n * 1000 - 999}ms`);
    if (t.recv) lines.push("rtt min/avg/max/mdev = 1.131/1.177/1.224/0.034 ms");
    return { output: lines.join("\n") };
  }, { n: numArg(1, 10, ["4"], "Count"), ip: ipArg() });
  add("tr", "traceroute <nf> <ip>", "Hop-by-hop path (-n: numeric)", (a) => {
    const ns = l3Apply(s, { type: "trace", from: h, dst: a.ip });
    api.act({ type: "trace", from: h, dst: a.ip });
    return { output: traceOut(ns, a.ip, true) };
  }, { nf: exact("-n", "No name resolution"), ip: ipArg() });
  add("aadd", "sudo ip addr add <cidr> dev <if>", "Add an address with its prefix length", (a) => {
    const [ip, l] = a.cidr.split("/");
    if (cfg.addrs.some((x) => x.ip === ip && x.len === +l)) return { output: "RTNETLINK answers: File exists", refused: true };
    set({ ...cfg, addrs: [...cfg.addrs, { ip, len: +l }] }, `ip addr add ${a.cidr} dev eth0`);
    return { output: "" };
  }, { cidr: cidrArg([`${me}/24`], "address/prefix-length"), if: eth0 });
  add("adel", "sudo ip addr del <cidr> dev <if>", "Remove an address (routes that depend on it go too)", (a) => {
    const [ip, l] = a.cidr.split("/");
    if (!cfg.addrs.some((x) => x.ip === ip && x.len === +l)) return { output: "RTNETLINK answers: Cannot assign requested address", refused: true };
    const addrs = cfg.addrs.filter((x) => !(x.ip === ip && x.len === +l));
    // The kernel removes routes whose gateway is no longer reachable on a connected network.
    const gw = cfg.gw && addrs.some((x) => inNet(cfg.gw!, x.ip, x.len)) ? cfg.gw : undefined;
    set({ addrs, gw }, `ip addr del ${a.cidr} dev eth0${cfg.gw && !gw ? " (default route removed with it)" : ""}`);
    return { output: "" };
  }, { cidr: cidrArg(cfg.addrs.map((x) => `${x.ip}/${x.len}`), "address/prefix-length"), if: eth0 });
  for (const verb of ["add", "replace"] as const)
    add(`gw-${verb}`, `sudo ip route ${verb} default via <gw>`, verb === "add" ? "Add the default route" : "Set (or change) the default route", (a) => {
      if (!cfg.addrs.some((x) => inNet(a.gw, x.ip, x.len))) return { output: "Error: Nexthop has invalid gateway.", refused: true };
      if (verb === "add" && cfg.gw && hostRoutes(cfg).some((r) => r.kind === "default")) return { output: "RTNETLINK answers: File exists", refused: true };
      set({ ...cfg, gw: a.gw }, `ip route ${verb} default via ${a.gw}`);
      return { output: "" };
    }, { gw: ipArg(h === "CLIENT" ? [L3.gw] : h === "SERVER" ? [L3.r2Srv] : [L3.r2Rem]) });
  add("gw-del", "sudo ip route del default", "Remove the default route", () => {
    if (!hostRoutes(cfg).some((r) => r.kind === "default")) return { output: "RTNETLINK answers: No such process", refused: true };
    set({ ...cfg, gw: undefined }, "ip route del default");
    return { output: "" };
  });
  add("flush", "sudo ip neigh flush dev <if>", "Empty the ARP cache", () => {
    api.act({ type: "clear-arp", dev: h });
    return { output: "" };
  }, { if: eth0 });
  return { vendor: "cisco", deviceId: h, deviceName: DEV_LABEL[h], prompt, commands: cmds };
}

export function l3Sets(api: L3CliApi, d: L3D): Partial<Record<CliVendor, CliCommandSet>> {
  if (d === "R1" || d === "R2") return { juniper: buildJunosSet(api.dev, l3JunosSpec(api, d)) };
  if (d === "SW1") return {};
  const h = hostSet(api, d);
  return { cisco: h, juniper: h };
}
export const l3Pipe = (api: L3CliApi, r: L3R) => ({ config: junosPipeConfig(api.dev, { jstmts: (c: RCfg) => l3JnStmts(r, c) }), rollbacks: api.dev.hist.length });
export function l3StaticApi(s: L3State, d: L3D): L3CliApi {
  const rt = d === "R1" || d === "R2";
  return { s, act: () => s, dev: { host: d, running: rt ? s.rtrs[d] : { ifs: {}, statics: [] }, hist: rt ? s.hist[d] : [], setCand: () => undefined, xr: [], setXr: () => undefined, edit: false, setEdit: () => undefined, commit: () => undefined } };
}
