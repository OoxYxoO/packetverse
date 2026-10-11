import type { CliArgSpec, CliCommand, CliCommandSet, CliResult, CliVendor } from "@/lib/cli/types";
import { columns, prefixToMask } from "@/lib/cli/format";
import type { CliQuestion } from "@/app/demo/dhcp-dns/dhcp-lab/dhcpBuildCli";
import { withSelfPing } from "@/lib/cli/selfPing";
import { withShellHistory } from "@/lib/cli/shellHistory";
import { HOST_IP, IF_ADDR, OS_IFS, OS_ROUTERS, RID, ROUTER_OF, isIp, ipNum, linkOf, osClone, osFib, osIfUp, osLookup, peerOf, routeText, type OsAction, type OsHost, type OsIf, type OsIfCfg, type OsRoute, type OsRouter, type OsRouterCfg, type OsState } from "@/lib/sim-engine/scenarios/ospfNet";
import { CISCO_IF, CISCO_SHORT } from "./osNames";

/**
 * Command lines of the OSPF Lab — Cisco IOS or Junos on R1–R4, a Linux shell on the hosts. Every output is printed
 * from the lab state (the computed adjacencies, LSDBs, SPF results and routing tables, the log); every change goes
 * through a lab action (IOS on Enter; Junos on commit).
 *
 *   IOS    show ip ospf neighbor · show ip ospf interface [brief | <if>] · show ip ospf database [router <rid>] ·
 *          show ip route [ospf | <ip>] · show ip protocols · show ip interface brief · show logging ·
 *          show running-config · ping · traceroute · configure terminal → interface <if> → ip ospf 1 area <n> ·
 *          ip ospf cost <n> · ip ospf hello-interval / dead-interval <n> · ip mtu <n> · shutdown · router ospf 1 →
 *          passive-interface <if> · ip route <net> <mask> <nh>
 *   Junos  show ospf neighbor · show ospf interface [detail] · show ospf database [router advertising-router <rid>] ·
 *          show route [protocol ospf | <ip>] · show interfaces terse · show log messages · show configuration
 *          protocols ospf | routing-options · ping · traceroute · configure → set protocols ospf area <a> interface
 *          <if> [metric | passive | hello-interval | dead-interval] · set interfaces <if> unit 0 family inet mtu ·
 *          set routing-options static route <p> next-hop <ip> → commit
 */

export type OsIosMode = { kind: "exec" } | { kind: "config" } | { kind: "if"; i: OsIf } | { kind: "ospf" };
export type OsCand = Record<OsRouter, OsRouterCfg>;
export interface OsCliApi {
  view: OsState;
  act: (a: OsAction) => OsState;
  ios: Record<OsRouter, OsIosMode>;
  setIos: (d: OsRouter, m: OsIosMode) => void;
  junosEdit: Record<OsRouter, boolean>;
  setJunosEdit: (d: OsRouter, b: boolean) => void;
  cand: OsCand;
  setCand: (c: OsCand) => void;
  ask?: (q: CliQuestion | undefined) => void;
  history?: string[];
}
const refuse = (output: string, explanation?: string): CliResult => ({ output, refused: true, explanation });
const prefixed = (cmds: CliCommand[], word: "do" | "run"): CliCommand[] => cmds.map((c) => ({ ...c, id: `${word}:${c.id}`, syntax: `${word} ${c.syntax}` }));
const stamp = (clock: number) => {
  const hh = String(Math.floor(clock / 3600) % 24).padStart(2, "0");
  const mm = String(Math.floor(clock / 60) % 60).padStart(2, "0");
  const ss = String(Math.floor(clock) % 60).padStart(2, "0");
  return { ios: `*Mar  1 ${hh}:${mm}:${ss}.000`, junos: `Mar  1 ${hh}:${mm}:${ss}` };
};
const ago = (secs: number) => {
  const s = Math.max(0, Math.floor(secs));
  return `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};
const DESC: Record<OsRouter, Record<OsIf, string>> = Object.fromEntries(OS_ROUTERS.map((r) => [r, Object.fromEntries(OS_IFS.map((i) => [i, i === "ge-0/0/0" ? "LAN" : i === "lo0" ? "router-id" : `to-${peerOf(r, i)?.r}`]))])) as Record<OsRouter, Record<OsIf, string>>;
const ciscoIfArg = (r: OsRouter): CliArgSpec => ({
  choices: OS_IFS.map((i) => CISCO_IF[i]),
  describe: (c) => DESC[r][OS_IFS.find((i) => CISCO_IF[i] === c)!],
  resolve: (raw) => {
    const m = /^([a-z]+)(\d+(?:\/\d+)?)$/i.exec(raw);
    if (!m) return undefined;
    const w = m[1].toLowerCase();
    if ("loopback".startsWith(w) && m[2] === "0" && w.length >= 2) return "lo0";
    if ("gigabitethernet".startsWith(w) && w.length >= 1 && /^0\/[012]$/.test(m[2])) return `ge-0/0/${m[2].split("/")[1]}`;
    return undefined;
  },
});
const junosIfArg = (r: OsRouter): CliArgSpec => ({ choices: [...OS_IFS], describe: (c) => DESC[r][c as OsIf], resolve: (raw) => { const x = raw.replace(/\.0$/, ""); return (OS_IFS as readonly string[]).includes(x) ? x : undefined; } });
const ipArg = (): CliArgSpec => ({ choices: [...Object.values(HOST_IP), ...OS_ROUTERS.map((r) => RID[r])], describe: (c) => Object.entries(HOST_IP).find(([, v]) => v === c)?.[0] ?? OS_ROUTERS.find((r) => RID[r] === c), resolve: (raw) => (isIp(raw) ? raw : undefined) });
const numArg = (min: number, max: number, choices: string[], what: string): CliArgSpec => ({ choices, describe: () => `${what} (${min}–${max})`, resolve: (raw) => (/^\d+$/.test(raw) && +raw >= min && +raw <= max ? raw : undefined) });
function setRouter(api: OsCliApi, r: OsRouter, c: OsRouterCfg, text: string, junosCommit = false) {
  const cfg = osClone(api.view.cfg);
  cfg.r[r] = osClone(c);
  api.act({ type: "cfg", cfg, text: `${r}: ${text}`, junosCommit: junosCommit ? r : undefined });
}
const nbrState = (s: OsState, r: OsRouter, i: OsIf) => {
  const l = linkOf(r, i);
  return l ? s.view.adj[l] : undefined;
};
const majorNet = (net: string) => (net.startsWith("10.") ? "10.0.0.0/8" : net.startsWith("192.168.") ? `${net.split(".").slice(0, 3).join(".")}.0/24` : `${net.split(".")[0]}.0.0.0/8`);

/** ping / traceroute output, from a run started on a router. */
function pingOut(s: OsState, r: OsRouter, ip: string, cisco: boolean): CliResult {
  const ns = s;
  const res = ns.last!.results[0];
  const ok = res.replied;
  if (cisco) return { output: ["Type escape sequence to abort.", `Sending 5, 100-byte ICMP Echos to ${ip}, timeout is 2 seconds:`, ok ? "!!!!!" : res.fail?.includes("no route") ? "UUUUU" : ".....", `Success rate is ${ok ? 100 : 0} percent (${ok ? 5 : 0}/5)${ok ? ", round-trip min/avg/max = 1/2/4 ms" : ""}`].join("\n"), explanation: ok ? `Path: ${res.path.join(" → ")}.` : res.fail };
  return { output: [`PING ${ip} (${ip}): 56 data bytes`, ...(ok ? [0, 1, 2].map((i) => `64 bytes from ${ip}: icmp_seq=${i} ttl=${res.ttl} time=1.${i}31 ms`) : []), "", `--- ${ip} ping statistics ---`, `3 packets transmitted, ${ok ? 3 : 0} packets received, ${ok ? 0 : 100}% packet loss`].join("\n"), explanation: ok ? `Path: ${res.path.join(" → ")}.` : res.fail };
}
function traceOut(s: OsState, ip: string, cisco: boolean, first: OsRouter | OsHost): CliResult {
  const res = s.last!.results[0];
  const rows = res.trace ?? [];
  if (cisco) return { output: ["Type escape sequence to abort.", `Tracing the route to ${ip}`, "VRF info: (vrf in name/id, vrf out name/id)", ...rows.map((t) => `  ${t.hop} ${t.ip === "*" ? "*  *  *" : `${t.ip} ${t.hop} msec ${t.hop + 1} msec ${t.hop} msec`}`)].join("\n"), explanation: `Each line is the router whose TTL check expired — the path ${first} → ${res.path.slice(1).join(" → ")}.` };
  return { output: [`traceroute to ${ip} (${ip}), 30 hops max, 52 byte packets`, ...rows.map((t) => ` ${t.hop}  ${t.ip === "*" ? "* * *" : `${t.ip}  ${t.hop}.${t.hop}12 ms  ${t.hop}.${t.hop}48 ms  ${t.hop}.${t.hop}01 ms`}`)].join("\n"), explanation: `The path: ${res.path.join(" → ")}.` };
}

// ---------------------------------------------------------------------------------------------------------------
// Cisco IOS
// ---------------------------------------------------------------------------------------------------------------
function iosRoute(s: OsState, r: OsRouter, only?: (x: OsRoute) => boolean): string {
  const all = osFib(s.view, r).used;
  const used = all.filter((x) => !only || only(x));
  const groups: Record<string, OsRoute[]> = {};
  for (const x of used) (groups[majorNet(x.net)] ??= []).push(x);
  const age = ago(Math.min(s.clock - 10800 + 300, 86399));
  const line = (x: OsRoute) => {
    const c = x.proto;
    const pfx = `${x.net}/${x.len}`;
    if (c === "C" || c === "L") return `${c.padEnd(9)}${pfx} is directly connected, ${CISCO_IF[x.hops[0].via as OsIf]}`;
    if (c === "S") return `S        ${pfx} [1/0] via ${x.hops[0].nh}`;
    return [`O        ${pfx} [110/${x.metric}] via ${x.hops[0].nh}, ${age}, ${CISCO_IF[x.hops[0].via as OsIf]}`, ...x.hops.slice(1).map((h) => `${"".padEnd(9)}${"".padEnd(pfx.length)} [110/${x.metric}] via ${h.nh}, ${age}, ${CISCO_IF[h.via as OsIf]}`)].join("\n");
  };
  const body = Object.entries(groups)
    .sort((a, b) => ipNum(a[0].split("/")[0]) - ipNum(b[0].split("/")[0]))
    .flatMap(([maj, xs]) => {
      // As IOS: the header describes the whole major network in the table (not just the routes shown), and a network
      // that isn't subnetted (one route with its classful mask) gets no header.
      const inTable = all.filter((x) => majorNet(x.net) === maj);
      const masks = new Set(inTable.map((x) => x.len)).size;
      const classful = +maj.split("/")[1];
      if (inTable.length === 1 && inTable[0].len === classful) return xs.map(line);
      return [masks > 1 ? `      ${maj} is variably subnetted, ${inTable.length} subnets, ${masks} masks` : `      ${maj.split("/")[0]}/${inTable[0].len} is subnetted, ${inTable.length} subnets`, ...xs.map(line)];
    });
  return ["Codes: L - local, C - connected, S - static, R - RIP, M - mobile, B - BGP", "       D - EIGRP, EX - EIGRP external, O - OSPF, IA - OSPF inter area", "", "Gateway of last resort is not set", "", ...body].join("\n");
}
function iosExec(api: OsCliApi, r: OsRouter): CliCommand[] {
  const s = api.view;
  const c = s.cfg.r[r];
  const ifArg = { interface: ciscoIfArg(r) };
  const ospfIfs = OS_IFS.filter((i) => c.ifs[i].ospf && osIfUp(s.cfg, r, i));
  const nbrs = OS_IFS.flatMap((i) => {
    const a = nbrState(s, r, i);
    if (!a || a.state === "DOWN") return [];
    const p = peerOf(r, i)!;
    return [{ i, a, p }];
  });
  const lsas = s.view.lsdb[r];
  const lsaDetail = (rid: string) => {
    const l = lsas.find((x) => RID[x.origin] === rid);
    if (!l) return "";
    return [`            OSPF Router with ID (${RID[r]}) (Process ID 1)`, "", "                Router Link States (Area 0)", "", `  LS age: ${(s.clock % 1800) + 10}`, "  Options: (No TOS-capability, DC)", "  LS Type: Router Links", `  Link State ID: ${RID[l.origin]}`, `  Advertising Router: ${RID[l.origin]}`, `  LS Seq Number: ${(0x80000000 + l.seq).toString(16).toUpperCase()}`, `  Number of Links: ${l.links.length + l.stubs.length}`, "", ...l.links.flatMap((x) => ["    Link connected to: another Router (point-to-point)", `     (Link ID) Neighboring Router ID: ${RID[x.nbr]}`, `     (Link Data) Router Interface address: ${IF_ADDR[l.origin][x.via].ip}`, "      Number of MTID metrics: 0", `       TOS 0 Metrics: ${x.cost}`, ""]), ...l.stubs.flatMap((x) => ["    Link connected to: a Stub Network", `     (Link ID) Network/subnet number: ${x.net}`, `     (Link Data) Network Mask: ${prefixToMask(x.len)}`, "      Number of MTID metrics: 0", `       TOS 0 Metrics: ${x.cost}`, ""])].join("\n");
  };
  return [
    { id: "nbr", syntax: "show ip ospf neighbor", summary: "OSPF neighbors: who, state, dead timer", run: () => ({ output: nbrs.length ? columns([["Neighbor ID", "Pri", "State", "Dead Time", "Address", "Interface"], ...nbrs.map((n) => [RID[n.p.r], "0", n.a.state === "FULL" ? "FULL/  -" : "EXSTART/  -", `00:00:${String(c.ifs[n.i].dead - 5 - (s.clock % 9)).padStart(2, "0")}`, IF_ADDR[n.p.r][n.p.i].ip, CISCO_IF[n.i]])], [16, 6, 16, 12, 16]) : "", explanation: nbrs.length ? "FULL = the databases are synchronized: SPF can use this link. EXSTART that never moves = the database exchange fails (classic: MTU mismatch). A neighbor that should be here but isn't: Hellos rejected (area, timers, passive) or link down." : "No neighbor at all on this router." }) },
    { id: "if", syntax: "show ip ospf interface brief", summary: "Interfaces in OSPF: area, cost, state, neighbors", run: () => ({ output: columns([["Interface", "PID", "Area", "IP Address/Mask", "Cost", "State", "Nbrs F/C"], ...ospfIfs.map((i) => { const a = nbrState(s, r, i); return [CISCO_SHORT[i], "1", String(c.ifs[i].area), `${IF_ADDR[r][i].ip}/${IF_ADDR[r][i].prefix}`, String(i === "lo0" ? 1 : c.ifs[i].cost), i === "lo0" ? "LOOP" : i === "ge-0/0/0" ? "DR" : "P2P", a ? `${a.state === "FULL" ? 1 : 0}/${a.state === "DOWN" ? 0 : 1}` : "0/0"]; })], [10, 5, 6, 19, 6, 6]), explanation: "Cost per interface is what SPF adds when the path LEAVES through it. An interface missing here is not in OSPF at all — its subnet isn't advertised." }) },
    {
      id: "ipif",
      syntax: "show ip interface <interface>",
      summary: "One interface's IP settings, including its MTU",
      args: ifArg,
      run: ({ interface: i }) => {
        const up = osIfUp(s.cfg, r, i as OsIf);
        const a = IF_ADDR[r][i as OsIf];
        return { output: [`${CISCO_IF[i as OsIf]} is ${c.ifs[i as OsIf].shut ? "administratively down" : up ? "up" : "down"}, line protocol is ${up ? "up" : "down"}`, `  Internet address is ${a.ip}/${a.prefix}`, `  Broadcast address is 255.255.255.255`, `  MTU is ${c.ifs[i as OsIf].mtu} bytes`, `  Helper address is not set`, `  Directed broadcast forwarding is disabled`, `  Multicast reserved groups joined: ${c.ifs[i as OsIf].ospf && !c.ifs[i as OsIf].passive && i !== "lo0" ? "224.0.0.5" : "none"}`].join("\n"), explanation: "The IP MTU. OSPF neighbors compare it in their database description packets: different MTUs leave them stuck in EXSTART." };
      },
    },
    {
      id: "ifd",
      syntax: "show ip ospf interface <interface>",
      summary: "One interface: area, network type, cost, timers, passive",
      args: ifArg,
      run: ({ interface: i }) => {
        const ic = c.ifs[i as OsIf];
        if (!ic.ospf) return { output: `${CISCO_IF[i as OsIf]} is up, line protocol is up\n  OSPF not enabled on this interface`, explanation: "No ip ospf 1 area … on this interface: it takes no part in OSPF and its subnet is not advertised." };
        const a = nbrState(s, r, i as OsIf);
        return { output: [`${CISCO_IF[i as OsIf]} is ${osIfUp(s.cfg, r, i as OsIf) ? "up" : "down"}, line protocol is ${osIfUp(s.cfg, r, i as OsIf) ? "up" : "down"}`, `  Internet Address ${IF_ADDR[r][i as OsIf].ip}/${IF_ADDR[r][i as OsIf].prefix}, Interface ID ${3 + OS_IFS.indexOf(i as OsIf)}, Area ${ic.area}`, "  Attached via Interface Enable", `  Process ID 1, Router ID ${RID[r]}, Network Type ${i === "lo0" ? "LOOPBACK" : i === "ge-0/0/0" ? "BROADCAST" : "POINT_TO_POINT"}, Cost: ${i === "lo0" ? 1 : ic.cost}`, `  Transmit Delay is 1 sec, State ${i === "lo0" ? "LOOPBACK" : i === "ge-0/0/0" ? "DR" : "POINT_TO_POINT"}`, `  Timer intervals configured, Hello ${ic.hello}, Dead ${ic.dead}, Wait ${ic.dead}, Retransmit 5`, ...(ic.passive ? ["    No Hellos (Passive interface)"] : [`    Hello due in 00:00:0${s.clock % 9}`]), `  Neighbor Count is ${a && a.state !== "DOWN" ? 1 : 0}, Adjacent neighbor count is ${a?.state === "FULL" ? 1 : 0}`, ...(a?.state === "FULL" ? [`    Adjacent with neighbor ${RID[peerOf(r, i as OsIf)!.r]}`] : [])].join("\n"), explanation: ic.passive ? "Passive: the subnet is advertised, but no Hellos are sent or accepted — right for a LAN, wrong toward another router." : `Both ends must agree on area (${ic.area}) and Hello/Dead (${ic.hello}/${ic.dead}) for a neighborship; MTU (${ic.mtu}) must match for FULL.` };
      },
    },
    { id: "db", syntax: "show ip ospf database", summary: "The link-state database (Router LSAs)", run: () => ({ output: [`            OSPF Router with ID (${RID[r]}) (Process ID 1)`, "", "                Router Link States (Area 0)", "", columns([["Link ID", "ADV Router", "Age", "Seq#", "Checksum", "Link count"], ...lsas.map((l) => [RID[l.origin], RID[l.origin], String((s.clock + l.seq * 37) % 1800), `0x${(0x80000000 + l.seq).toString(16).toUpperCase()}`, `0x00${(0xa000 + l.seq * 257 + ipNum(RID[l.origin]) % 4096).toString(16).toUpperCase()}`, String(l.links.length + l.stubs.length)])], [16, 16, 12, 11, 10])].join("\n"), explanation: lsas.length === 4 ? "One Router-LSA per router; every router in the area has exactly this list. The sequence number grows each time a router's links change." : `Only ${lsas.length} LSA(s): this router is cut off from part of the area (no FULL path to it).` }) },
    { id: "dbr", syntax: "show ip ospf database router <rid>", summary: "One router's LSA: its links and stub networks", args: { rid: { choices: OS_ROUTERS.map((x) => RID[x]), describe: (c) => OS_ROUTERS.find((x) => RID[x] === c), resolve: (raw) => (OS_ROUTERS.some((x) => RID[x] === raw) ? raw : undefined) } }, run: ({ rid }) => { const out = lsaDetail(rid); return out ? { output: out, explanation: "“another Router (point-to-point)” = a FULL neighbor (SPF uses it). “a Stub Network” = a subnet this router advertises (its LAN, its links, its loopback)." } : refuse("", `${rid}'s LSA is not in this router's database.`); } },
    { id: "route", syntax: "show ip route", summary: "The routing table", run: () => ({ output: iosRoute(s, r), explanation: "[110/21] = administrative distance / metric. OSPF's distance is 110; a static route (1) for the same prefix would win." }) },
    { id: "route", syntax: "show ip route ospf", summary: "Only routes learned from OSPF", run: () => ({ output: iosRoute(s, r, (x) => x.proto === "O") }) },
    {
      id: "routeip",
      syntax: "show ip route <ip>",
      summary: "Which route this router uses for an address",
      args: { ip: ipArg() },
      run: ({ ip }) => {
        const rt = osLookup(s.view, r, ip);
        if (!rt) return refuse("% Network not in table", `${r} has no route for ${ip}: packets to it are dropped here.`);
        const hidden = osFib(s.view, r).hidden.filter((x) => x.net === rt.net && x.len === rt.len);
        const known = rt.proto === "O" ? `"ospf 1", distance 110, metric ${rt.metric}, type intra area` : rt.proto === "S" ? `"static", distance 1, metric 0` : `"connected", distance 0, metric 0 (connected, via interface)`;
        return { output: [`Routing entry for ${rt.net}/${rt.len}`, `  Known via ${known}`, ...(rt.proto === "O" ? [`  Last update from ${rt.hops[0].nh} on ${CISCO_IF[rt.hops[0].via as OsIf]}, 00:05:12 ago`] : []), "  Routing Descriptor Blocks:", ...rt.hops.map((h, i) => `  ${i === 0 ? "*" : " "} ${h.nh ?? "directly connected"}${h.nh && rt.proto === "O" ? `, from ${RID[peerOf(r, h.via as OsIf)!.r]}, 00:05:12 ago` : ""}, via ${CISCO_IF[h.via as OsIf]}\n      Route metric is ${rt.metric}, traffic share count is 1`)].join("\n"), explanation: hidden.length ? `${r} also knows ${hidden.map((x) => `${x.proto === "O" ? "an OSPF" : "a"} route [${x.ad}/${x.metric}]`).join(", ")} for this prefix — but uses the one with the LOWER administrative distance.` : rt.hops.length > 1 ? "Two equal-cost paths: traffic is shared (ECMP)." : undefined };
      },
    },
    { id: "proto", syntax: "show ip protocols", summary: "OSPF process: router ID, interfaces, passive interfaces, distance", run: () => ({ output: [`*** IP Routing is NSF aware ***`, "", 'Routing Protocol is "ospf 1"', "  Outgoing update filter list for all interfaces is not set", "  Incoming update filter list for all interfaces is not set", `  Router ID ${RID[r]}`, "  Number of areas in this router is 1. 1 normal 0 stub 0 nssa", "  Routing on Interfaces Configured Explicitly (Area 0):", ...OS_IFS.filter((i) => c.ifs[i].ospf && c.ifs[i].area === 0).map((i) => `    ${CISCO_IF[i]}`), ...(OS_IFS.some((i) => c.ifs[i].ospf && c.ifs[i].area !== 0) ? ["  Routing on Interfaces Configured Explicitly (Area 1):", ...OS_IFS.filter((i) => c.ifs[i].ospf && c.ifs[i].area !== 0).map((i) => `    ${CISCO_IF[i]}`)] : []), "  Passive Interface(s):", ...OS_IFS.filter((i) => c.ifs[i].passive).map((i) => `    ${CISCO_IF[i]}`), "  Routing Information Sources:", columns([["    Gateway", "Distance", "Last Update"], ...OS_ROUTERS.filter((x) => x !== r && s.view.spf[r][x]).map((x) => [`    ${RID[x]}`, "110", "00:05:12"])], [20, 10]), "  Distance: (default is 110)"].join("\n") }) },
    { id: "brief", syntax: "show ip interface brief", summary: "Interfaces, addresses, state", run: () => ({ output: columns([["Interface", "IP-Address", "OK?", "Method", "Status", "Protocol"], ...OS_IFS.map((i) => [CISCO_IF[i], IF_ADDR[r][i].ip, "YES", "NVRAM", c.ifs[i].shut ? "administratively down" : osIfUp(s.cfg, r, i) ? "up" : "down", osIfUp(s.cfg, r, i) ? "up" : "down"])], [21, 16, 4, 7, 22]) }) },
    {
      id: "log",
      syntax: "show logging",
      summary: "The log: adjacency changes, mismatches",
      run: () => {
        // IOS words an area mismatch by side: the interface outside the backbone that hears an Area 0 Hello says so.
        const errrcv = (t: string, i: OsIf, why?: string) => {
          const p = peerOf(r, i)!;
          const from = `${IF_ADDR[p.r][p.i].ip}, ${CISCO_IF[i]}`;
          if (!/area/.test(why ?? "")) return `${t}: %OSPF-4-ERRRCV: Received invalid packet: mismatched hello parameters from ${from}`;
          const mine = s.cfg.r[r].ifs[i].area;
          const theirs = s.cfg.r[p.r].ifs[p.i].area;
          return mine !== 0 && theirs === 0 ? `${t}: %OSPF-4-ERRRCV: Received invalid packet: mismatched area ID, from backbone area must be virtual-link but not found from ${from}` : `${t}: %OSPF-4-ERRRCV: Received invalid packet: mismatched area ID from ${from}`;
        };
        const lines = s.syslog.filter((x) => x.r === r).slice(-40).flatMap((x) => {
          const t = stamp(x.clock).ios;
          if (x.ev === "adj") return [`${t}: %OSPF-5-ADJCHG: Process 1, Nbr ${RID[x.nbr!]} on ${CISCO_IF[x.ifn as OsIf]} from ${x.from === "FULL" ? "FULL" : x.from} to ${x.to}, ${x.to === "FULL" ? "Loading Done" : x.to === "DOWN" ? `Neighbor Down: ${/dead/.test(x.text ?? "") ? "Dead timer expired" : /link/.test(x.text ?? "") ? "Interface down or detached" : "Interface down or detached"}` : "2-Way Received"}`];
          if (x.ev === "mismatch") return [errrcv(t, x.ifn as OsIf, x.text)];
          if (x.ev === "up" || x.ev === "down") return [`${t}: %LINK-3-UPDOWN: Interface ${CISCO_IF[x.ifn as OsIf]}, changed state to ${x.ev}`];
          return [];
        });
        // A router logs ERRRCV for every Hello it rejects, for as long as the mismatch lasts: show the latest one.
        const now = stamp(s.clock).ios;
        for (const i of ["ge-0/0/1", "ge-0/0/2"] as OsIf[]) {
          const a = nbrState(s, r, i);
          const p = peerOf(r, i);
          if (!a || !p || a.state !== "DOWN" || !/mismatch/.test(a.why ?? "")) continue;
          const line = errrcv(now, i, a.why);
          if (lines.at(-1) !== line) lines.push(line);
        }
        return { output: ["Syslog logging: enabled", "", "Log Buffer (8192 bytes):", ...(lines.length ? lines : ["(no messages)"])].join("\n") };
      },
    },
    {
      id: "run",
      syntax: "show running-config",
      summary: `${r}'s configuration`,
      run: () => {
        const lines = [`hostname ${r}`, "!", ...OS_IFS.flatMap((i) => { const ic = c.ifs[i]; const a = IF_ADDR[r][i]; return [`interface ${CISCO_IF[i]}`, ` description ${DESC[r][i]}`, ` ip address ${a.ip} ${prefixToMask(a.prefix)}`, ...(ic.mtu !== 1500 ? [` ip mtu ${ic.mtu}`] : []), ...(ic.ospf ? [` ip ospf 1 area ${ic.area}`] : []), ...(i !== "lo0" && i !== "ge-0/0/0" ? [" ip ospf network point-to-point"] : []), ...(ic.cost !== 1 && i !== "lo0" ? [` ip ospf cost ${ic.cost}`] : []), ...(ic.hello !== 10 ? [` ip ospf hello-interval ${ic.hello}`] : []), ...(ic.dead !== 40 ? [` ip ospf dead-interval ${ic.dead}`] : []), ...(ic.shut ? [" shutdown"] : []), "!"]; }), "router ospf 1", ` router-id ${RID[r]}`, ...OS_IFS.filter((i) => c.ifs[i].passive).map((i) => ` passive-interface ${CISCO_IF[i]}`), "!", ...c.statics.map((x) => `ip route ${x.prefix} ${prefixToMask(x.len)} ${x.nh}`), "end"];
        return { output: `Building configuration...\n\nCurrent configuration : ${lines.join("\n").length} bytes\n!\n${lines.join("\n")}` };
      },
    },
    { id: "ping", syntax: "ping <ip>", summary: "Ping from this router", args: { ip: ipArg() }, run: ({ ip }) => pingOut(api.act({ type: "traffic", sends: [{ from: r, to: ip, kind: "ping" }] }), r, ip, true) },
    { id: "trace", syntax: "traceroute <ip>", summary: "Every router on the way", args: { ip: ipArg() }, run: ({ ip }) => traceOut(api.act({ type: "traffic", sends: [{ from: r, to: ip, kind: "trace" }] }), ip, true, r) },
    { id: "hist", syntax: "show history", summary: "The commands you typed in this session", run: () => ({ output: [...(api.history ?? []), "show history"].map((x) => `  ${x}`).join("\n") }) },
  ];
}
function iosSet(api: OsCliApi, r: OsRouter): CliCommandSet {
  const s = api.view;
  const c = s.cfg.r[r];
  const exec = iosExec(api, r);
  const base = { vendor: "cisco" as const, deviceId: r, deviceName: r };
  const mode = api.ios[r];
  const ifArg = { interface: ciscoIfArg(r) };
  const end: CliCommand = { id: "end", syntax: "end", summary: "Leave configuration mode", run: () => (api.setIos(r, { kind: "exec" }), { output: "%SYS-5-CONFIG_I: Configured from console by console" }) };
  if (mode.kind === "exec") return { ...base, prompt: `${r}#`, commands: [...exec, { id: "conf", syntax: "configure terminal", summary: "Enter configuration mode", run: () => (api.setIos(r, { kind: "config" }), { output: "Enter configuration commands, one per line.  End with CNTL/Z." }) }] };
  const doCmds = prefixed(exec, "do");
  const maskArg: CliArgSpec = { choices: ["255.255.255.0"], resolve: (raw) => (/^255\.255\.255\.(0|128|192|224|240|248|252|255)$/.test(raw) ? raw : undefined) };
  const netArg: CliArgSpec = { choices: ["192.168.4.0"], resolve: (raw) => (isIp(raw) ? raw : undefined) };
  const nhArg: CliArgSpec = { choices: OS_IFS.filter((i) => i !== "lo0" && i !== "ge-0/0/0").map((i) => IF_ADDR[peerOf(r, i)!.r][peerOf(r, i)!.i].ip), describe: (x) => `next hop (${OS_ROUTERS.find((rr) => OS_IFS.some((i) => IF_ADDR[rr][i].ip === x))})`, resolve: (raw) => (isIp(raw) ? raw : undefined) };
  const lenOf = (mask: string) => mask.split(".").reduce((a, o) => a + (+o).toString(2).replace(/0/g, "").length, 0);
  const statics: CliCommand[] = [
    { id: "iproute", syntax: "ip route <net> <mask> <nh>", summary: "Add a static route (distance 1: beats OSPF's 110)", args: { net: netArg, mask: maskArg, nh: nhArg }, run: ({ net, mask, nh }) => (setRouter(api, r, { ...c, statics: [...c.statics.filter((x) => !(x.prefix === net && x.len === lenOf(mask))), { prefix: net, len: lenOf(mask), nh }] }, `ip route ${net} ${mask} ${nh}`), { output: "", explanation: "A static route has administrative distance 1. For the same prefix it wins over OSPF (110) — whatever OSPF computes." }) },
    { id: "noroute", syntax: "no ip route <net> <mask> <nh>", summary: "Remove a static route", args: { net: { ...netArg, choices: c.statics.map((x) => x.prefix) }, mask: maskArg, nh: { ...nhArg, choices: c.statics.map((x) => x.nh) } }, run: ({ net, mask }) => (c.statics.some((x) => x.prefix === net && x.len === lenOf(mask)) ? (setRouter(api, r, { ...c, statics: c.statics.filter((x) => !(x.prefix === net && x.len === lenOf(mask))) }, `no ip route ${net} ${mask}`), { output: "", explanation: "Gone: the OSPF route for this prefix (if any) is used now." }) : refuse("%No matching route to delete")) },
  ];
  if (mode.kind === "config") return { ...base, prompt: `${r}(config)#`, commands: [{ id: "if", syntax: "interface <interface>", summary: "Configure one interface", args: ifArg, run: ({ interface: i }) => (api.setIos(r, { kind: "if", i: i as OsIf }), { output: "" }) }, { id: "ospf", syntax: "router ospf 1", summary: "The OSPF process (router ID, passive interfaces)", run: () => (api.setIos(r, { kind: "ospf" }), { output: "" }) }, ...statics, { id: "exit", syntax: "exit", summary: "Back to privileged mode", run: () => (api.setIos(r, { kind: "exec" }), { output: "" }) }, end, ...doCmds] };
  if (mode.kind === "ospf") {
    const setIf = (i: OsIf, patch: Partial<OsIfCfg>, line: string) => setRouter(api, r, { ...c, ifs: { ...c.ifs, [i]: { ...c.ifs[i], ...patch } } }, `router ospf 1 · ${line}`);
    return {
      ...base,
      prompt: `${r}(config-router)#`,
      commands: [
        { id: "pas", syntax: "passive-interface <interface>", summary: "Advertise the subnet but send no Hellos", args: ifArg, run: ({ interface: i }) => (setIf(i as OsIf, { passive: true }, `passive-interface ${CISCO_IF[i as OsIf]}`), { output: "", explanation: i === "ge-0/0/1" || i === "ge-0/0/2" ? "This interface leads to another router: with no Hellos, that neighborship goes down." : "Right for a LAN: no neighbor expected there, the subnet is still advertised." }) },
        { id: "nopas", syntax: "no passive-interface <interface>", summary: "Send Hellos again", args: ifArg, run: ({ interface: i }) => (setIf(i as OsIf, { passive: false }, `no passive-interface ${CISCO_IF[i as OsIf]}`), { output: "" }) },
        { id: "rid", syntax: "router-id <rid>", summary: "", hidden: true, args: { rid: { choices: [RID[r]], resolve: (raw) => (isIp(raw) ? raw : undefined) } }, run: () => refuse("% Not available in this lab: the router IDs are fixed (1.1.1.1–4.4.4.4).") },
        { id: "exit", syntax: "exit", summary: "Back to global configuration", run: () => (api.setIos(r, { kind: "config" }), { output: "" }) },
        end,
        ...doCmds,
      ],
    };
  }
  const i = mode.i;
  const ic = c.ifs[i];
  const set = (patch: Partial<OsIfCfg>, line: string) => setRouter(api, r, { ...c, ifs: { ...c.ifs, [i]: { ...ic, ...patch } } }, `interface ${CISCO_IF[i]} · ${line}`);
  return {
    ...base,
    prompt: `${r}(config-if)#`,
    commands: [
      { id: "area", syntax: "ip ospf 1 area <area>", summary: "Run OSPF on this interface, in this area", args: { area: numArg(0, 1, ["0", "1"], "area") }, run: ({ area }) => (set({ ospf: true, area: +area }, `ip ospf 1 area ${area}`), { output: "", explanation: `Both ends of a link must be in the same area. This lab has one area (0); area ${area === "0" ? "0 is the backbone" : "1 exists only to show what a mismatch does"}.` }) },
      { id: "noarea", syntax: "no ip ospf 1 area <area>", summary: "Take this interface out of OSPF", args: { area: numArg(0, 1, ["0", "1"], "area") }, run: () => (set({ ospf: false }, "no ip ospf 1 area"), { output: "", explanation: "No Hellos here any more, and this interface's subnet is no longer advertised." }) },
      { id: "cost", syntax: "ip ospf cost <cost>", summary: "This interface's OSPF cost (added when traffic LEAVES through it)", args: { cost: numArg(1, 65535, ["10", "100"], "cost") }, run: ({ cost }) => (set({ cost: +cost }, `ip ospf cost ${cost}`), { output: "", explanation: "SPF re-runs at once. Costs are per direction: this changes paths that leave through this interface only." }) },
      { id: "nocost", syntax: "no ip ospf cost", summary: "Back to the default cost (reference bandwidth / interface bandwidth)", run: () => (set({ cost: 1 }, "no ip ospf cost"), { output: "", explanation: "Default cost on a 1 Gb/s interface with the default reference bandwidth (100 Mb/s): 1." }) },
      { id: "hello", syntax: "ip ospf hello-interval <seconds>", summary: "Hello interval (must match the neighbor)", args: { seconds: numArg(1, 65535, ["10", "5"], "seconds") }, run: ({ seconds }) => (set({ hello: +seconds }, `ip ospf hello-interval ${seconds}`), { output: "", explanation: "Hellos carry the hello and dead intervals; a neighbor with different values is not accepted." }) },
      { id: "dead", syntax: "ip ospf dead-interval <seconds>", summary: "Dead interval (must match the neighbor)", args: { seconds: numArg(1, 65535, ["40", "20"], "seconds") }, run: ({ seconds }) => (set({ dead: +seconds }, `ip ospf dead-interval ${seconds}`), { output: "", explanation: "How long this router waits without a Hello before declaring the neighbor down. Must match the neighbor." }) },
      { id: "mtu", syntax: "ip mtu <bytes>", summary: "The IP MTU (both ends must match for FULL)", args: { bytes: numArg(68, 9216, ["1500", "1400"], "bytes") }, run: ({ bytes }) => (set({ mtu: +bytes }, `ip mtu ${bytes}`), { output: "", explanation: "Database description packets carry the interface MTU: a neighbor with a different MTU never gets past EXSTART." }) },
      { id: "nomtu", syntax: "no ip mtu", summary: "Back to 1500", run: () => (set({ mtu: 1500 }, "no ip mtu"), { output: "" }) },
      { id: "shut", syntax: "shutdown", summary: "Disable this interface", run: () => (set({ shut: true }, "shutdown"), { output: `${stamp(s.clock).ios}: %LINK-5-CHANGED: Interface ${CISCO_IF[i]}, changed state to administratively down` }) },
      { id: "noshut", syntax: "no shutdown", summary: "Enable this interface", run: () => (set({ shut: false }, "no shutdown"), { output: "" }) },
      { id: "if", syntax: "interface <interface>", summary: "Move to another interface", args: ifArg, run: ({ interface: j }) => (api.setIos(r, { kind: "if", i: j as OsIf }), { output: "" }) },
      { id: "exit", syntax: "exit", summary: "Back to global configuration", run: () => (api.setIos(r, { kind: "config" }), { output: "" }) },
      end,
      ...doCmds,
    ],
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Junos
// ---------------------------------------------------------------------------------------------------------------
interface JNode {
  name: string;
  kids?: JNode[];
}
const areaId = (a: number) => `0.0.0.${a}`;
function junosTree(r: OsRouter, c: OsRouterCfg): JNode[] {
  const areas = [...new Set(OS_IFS.filter((i) => c.ifs[i].ospf).map((i) => c.ifs[i].area))].sort();
  return [
    { name: "system", kids: [{ name: `host-name ${r}` }] },
    { name: "interfaces", kids: OS_IFS.map((i) => ({ name: i, kids: [...(c.ifs[i].shut ? [{ name: "disable" }] : []), { name: "unit 0", kids: [{ name: "family inet", kids: [...(c.ifs[i].mtu !== 1500 ? [{ name: `mtu ${c.ifs[i].mtu}` }] : []), { name: `address ${IF_ADDR[r][i].ip}/${IF_ADDR[r][i].prefix}` }] }] }] })) },
    { name: "routing-options", kids: [{ name: `router-id ${RID[r]}` }, ...(c.statics.length ? [{ name: "static", kids: c.statics.map((x) => ({ name: `route ${x.prefix}/${x.len} next-hop ${x.nh}` })) }] : [])] },
    { name: "protocols", kids: [{ name: "ospf", kids: areas.map((a) => ({ name: `area ${areaId(a)}`, kids: OS_IFS.filter((i) => c.ifs[i].ospf && c.ifs[i].area === a).map((i) => { const ic = c.ifs[i]; const kids = [...(i !== "lo0" && i !== "ge-0/0/0" ? [{ name: "interface-type p2p" }] : []), ...(ic.passive && i !== "lo0" ? [{ name: "passive" }] : []), ...(ic.cost !== 1 && i !== "lo0" ? [{ name: `metric ${ic.cost}` }] : []), ...(ic.hello !== 10 ? [{ name: `hello-interval ${ic.hello}` }] : []), ...(ic.dead !== 40 ? [{ name: `dead-interval ${ic.dead}` }] : [])]; return kids.length ? { name: `interface ${i}.0`, kids } : { name: `interface ${i}.0` }; }) })) }] },
  ];
}
const render = (nodes: JNode[], d = 0): string[] => nodes.flatMap((n) => (n.kids ? [`${"    ".repeat(d)}${n.name} {`, ...render(n.kids, d + 1), `${"    ".repeat(d)}}`] : [`${"    ".repeat(d)}${n.name};`]));
function walk(nodes: JNode[], path: string[]): string {
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
export const osJunosText = (r: OsRouter, c: OsRouterCfg, path: string[] = []) => walk(junosTree(r, c), path);
function junosRoute(s: OsState, r: OsRouter, only?: (x: OsRoute) => boolean): string {
  const table = [...osFib(s.view, r).used.map((x) => ({ x, act: true })), ...osFib(s.view, r).hidden.map((x) => ({ x, act: false }))];
  const all = table.filter((y) => !only || only(y.x)).sort((a, b) => ipNum(a.x.net) - ipNum(b.x.net) || a.x.len - b.x.len || (a.act ? -1 : 1));
  const pref = (x: OsRoute) => (x.proto === "O" ? "OSPF/10" : x.proto === "S" ? "Static/5" : x.proto === "C" ? "Direct/0" : "Local/0");
  // As Junos: the header counts the whole table even when the output is filtered; a destination's extra routes are
  // listed under it without repeating the prefix.
  const dests = new Set(table.map((y) => routeText(y.x))).size;
  return [`inet.0: ${dests} destinations, ${table.length} routes (${table.filter((y) => y.act).length} active, 0 holddown, 0 hidden)`, "+ = Active Route, - = Last Active, * = Both", "", ...all.flatMap(({ x, act }, k) => [`${(k > 0 && routeText(all[k - 1].x) === routeText(x) ? "" : routeText(x)).padEnd(19)}${act ? "*" : " "}[${pref(x)}] 00:05:12${x.proto === "O" ? `, metric ${x.metric}` : ""}`, ...x.hops.map((h, i) => (x.proto === "C" || x.proto === "L" ? `                    ${x.proto === "L" ? "Local" : ">"} via ${h.via}.0` : `                    ${i === 0 && act ? ">" : " "}  to ${h.nh} via ${h.via}.0`))])].join("\n");
}
function junosOp(api: OsCliApi, r: OsRouter): CliCommand[] {
  const s = api.view;
  const c = s.cfg.r[r];
  const ifArg = { iface: junosIfArg(r) };
  const ospfIfs = OS_IFS.filter((i) => c.ifs[i].ospf);
  const lsas = s.view.lsdb[r];
  const ifDetail = (iface: string): string | undefined => { const ic = c.ifs[iface as OsIf]; if (!ic.ospf) return undefined; return [columns([["Interface", "State", "Area", "DR ID", "BDR ID", "Nbrs"], [`${iface}.0`, iface === "lo0" || iface === "ge-0/0/0" ? "DR" : "PtToPt", areaId(ic.area), "0.0.0.0", "0.0.0.0", String(nbrState(s, r, iface as OsIf)?.state === "FULL" ? 1 : 0)]], [20, 8, 16, 16, 16]), `  Type: ${iface === "lo0" ? "LAN" : iface === "ge-0/0/0" ? "LAN" : "P2P"}, Address: ${IF_ADDR[r][iface as OsIf].ip}, Mask: ${prefixToMask(IF_ADDR[r][iface as OsIf].prefix)}, MTU: ${ic.mtu}, Cost: ${iface === "lo0" ? 0 : ic.cost}`, `  Adj count: ${nbrState(s, r, iface as OsIf)?.state === "FULL" ? 1 : 0}${ic.passive ? ", Passive" : ""}`, `  Hello: ${ic.hello}, Dead: ${ic.dead}, ReXmit: 5, Not Stub`].join("\n"); };
  return [
    { id: "nbr", syntax: "show ospf neighbor", summary: "OSPF neighbors", run: () => { const rows = OS_IFS.flatMap((i) => { const a = nbrState(s, r, i); if (!a || a.state === "DOWN") return []; const p = peerOf(r, i)!; return [[IF_ADDR[p.r][p.i].ip, `${i}.0`, a.state === "FULL" ? "Full" : "ExStart", RID[p.r], "128", String(c.ifs[i].dead - 5 - (s.clock % 9))]]; }); return { output: rows.length ? columns([["Address", "Interface", "State", "ID", "Pri", "Dead"], ...rows], [17, 23, 16, 17, 5]) : "", explanation: rows.length ? "Full = synchronized. ExStart that never moves = the database exchange fails (MTU)." : "No neighbor on this router." }; } },
    { id: "if", syntax: "show ospf interface", summary: "Interfaces in OSPF", run: () => ({ output: columns([["Interface", "State", "Area", "DR ID", "BDR ID", "Nbrs"], ...ospfIfs.map((i) => [`${i}.0`, i === "lo0" || i === "ge-0/0/0" ? "DR" : "PtToPt", areaId(c.ifs[i].area), i === "lo0" || i === "ge-0/0/0" ? RID[r] : "0.0.0.0", "0.0.0.0", String(nbrState(s, r, i)?.state === "FULL" ? 1 : 0)])], [20, 8, 16, 16, 16]) }) },
    { id: "ifd", syntax: "show ospf interface <iface> detail", summary: "One OSPF interface in detail", args: ifArg, run: ({ iface }) => { const out = ifDetail(iface); return out === undefined ? refuse("", `${iface}.0 is not in OSPF.`) : { output: out }; } },
    { id: "ifd", syntax: "show ospf interface detail", summary: "Every OSPF interface in detail", run: () => ({ output: OS_IFS.map((x) => ifDetail(x)).filter((x): x is string => x !== undefined).join("\n\n") }) },
    { id: "db", syntax: "show ospf database", summary: "The link-state database", run: () => ({ output: ["", "    OSPF database, Area 0.0.0.0", columns([[" Type", "ID", "Adv Rtr", "Seq", "Age", "Opt", "Cksum", "Len"], ...lsas.map((l) => [`Router`, `${l.origin === r ? "*" : " "}${RID[l.origin]}`, RID[l.origin], `0x${(0x80000000 + l.seq).toString(16)}`, String((s.clock + l.seq * 37) % 1800), "0x22", `0x${(0x1a00 + l.seq * 7).toString(16)}`, String(24 + 12 * (l.links.length + l.stubs.length))])], [8, 17, 17, 12, 6, 6, 8])].join("\n"), explanation: "* = this router's own LSA." }) },
    { id: "dbr", syntax: "show ospf database router advertising-router <rid> extensive", summary: "One router's LSA in detail", args: { rid: { choices: OS_ROUTERS.map((x) => RID[x]), resolve: (raw) => (OS_ROUTERS.some((x) => RID[x] === raw) ? raw : undefined) } }, run: ({ rid }) => { const l = lsas.find((x) => RID[x.origin] === rid); if (!l) return refuse("", "Not in this router's database."); return { output: ["", "    OSPF database, Area 0.0.0.0", ` Type       ID               Adv Rtr           Seq      Age  Opt  Cksum  Len`, `Router   ${rid.padEnd(17)}${rid.padEnd(17)}0x${(0x80000000 + l.seq).toString(16)}`, `  bits 0x0, link count ${l.links.length + l.stubs.length}`, ...l.links.map((x) => `  id ${RID[x.nbr]}, data ${IF_ADDR[l.origin][x.via].ip}, Type PointToPoint (1)\n    Topology count: 0, Default metric: ${x.cost}`), ...l.stubs.map((x) => `  id ${x.net}, data ${prefixToMask(x.len)}, Type Stub (3)\n    Topology count: 0, Default metric: ${x.cost}`)].join("\n") }; } },
    { id: "route", syntax: "show route", summary: "The routing table (active and inactive routes)", run: () => ({ output: junosRoute(s, r), explanation: "Junos preferences: Direct 0, Static 5, OSPF internal 10 (Cisco: static 1, OSPF 110). Either way a static route beats OSPF. * = the active route." }) },
    { id: "route", syntax: "show route protocol ospf", summary: "Only OSPF routes", run: () => ({ output: junosRoute(s, r, (x) => x.proto === "O") }) },
    { id: "routeip", syntax: "show route <ip>", summary: "Routes for one address", args: { ip: ipArg() }, run: ({ ip }) => { const rt = osLookup(s.view, r, ip); return rt ? { output: junosRoute(s, r, (x) => x.net === rt.net && x.len === rt.len) } : refuse("", `${r} has no route for ${ip}.`); } },
    { id: "terse", syntax: "show interfaces terse", summary: "Interfaces and addresses", run: () => ({ output: columns([["Interface", "Admin", "Link", "Proto", "Local"], ...OS_IFS.flatMap((i) => [[i, c.ifs[i].shut ? "down" : "up", osIfUp(s.cfg, r, i) ? "up" : "down", "", ""], [`${i}.0`, "up", osIfUp(s.cfg, r, i) ? "up" : "down", "inet", `${IF_ADDR[r][i].ip}/${IF_ADDR[r][i].prefix}`]])], [16, 6, 6, 6]) }) },
    { id: "log", syntax: "show log messages", summary: "System log", run: () => { const l = s.syslog.filter((x) => x.r === r).slice(-40).flatMap((x) => { const t = stamp(x.clock).junos; if (x.ev === "adj") { const p = peerOf(r, x.ifn as OsIf)!; const nip = IF_ADDR[p.r][p.i].ip; return [x.to === "FULL" ? `${t}  ${r} rpd[1588]: RPD_OSPF_NBRUP: OSPF neighbor ${nip} (realm ospf-v2 ${x.ifn}.0 area 0.0.0.0) state changed from Loading to Full (event reason: OSPF loadingdone)` : `${t}  ${r} rpd[1588]: RPD_OSPF_NBRDOWN: OSPF neighbor ${nip} (realm ospf-v2 ${x.ifn}.0 area 0.0.0.0) state changed from ${x.from === "FULL" ? "Full" : "ExStart"} to ${x.to === "EXSTART" ? "ExStart" : "Down"} (event reason: ${/dead/.test(x.text ?? "") ? "neighbor was inactive" : "interface went down"})`]; } if (x.ev === "up" || x.ev === "down") return [`${t}  ${r} mib2d[1734]: SNMP_TRAP_LINK_${x.ev === "up" ? "UP" : "DOWN"}: ifName ${x.ifn}`]; return []; }); return { output: l.length ? l.join("\n") : "(no messages)", explanation: "Junos logs neighbors coming up and going down. Hellos discarded for an area or timer mismatch show up in OSPF traceoptions, not in the messages log." }; } },
    { id: "cfg", syntax: "show configuration protocols ospf", summary: "The OSPF configuration", run: () => ({ output: osJunosText(r, c, ["protocols", "ospf"]) }) },
    { id: "cfg", syntax: "show configuration routing-options", summary: "Router ID and static routes", run: () => ({ output: osJunosText(r, c, ["routing-options"]) }) },
    { id: "cfg", syntax: "show configuration", summary: `${r}'s committed configuration`, run: () => ({ output: osJunosText(r, c) }) },
    { id: "ping", syntax: "ping <ip>", summary: "Ping from this router", args: { ip: ipArg() }, run: ({ ip }) => pingOut(api.act({ type: "traffic", sends: [{ from: r, to: ip, kind: "ping" }] }), r, ip, false) },
    { id: "trace", syntax: "traceroute <ip>", summary: "Every router on the way", args: { ip: ipArg() }, run: ({ ip }) => traceOut(api.act({ type: "traffic", sends: [{ from: r, to: ip, kind: "trace" }] }), ip, false, r) },
    { id: "hist", syntax: "show cli history", summary: "The commands you typed in this session", run: () => ({ output: [...(api.history ?? []), "show cli history"].map((x, n) => `${String(n + 1).padStart(4)}  ${x}`).join("\n") }) },
  ];
}
function junosSet(api: OsCliApi, r: OsRouter): CliCommandSet {
  const s = api.view;
  const base = { vendor: "juniper" as const, deviceId: r, deviceName: r };
  const op = junosOp(api, r);
  const active = s.cfg.r[r];
  const rbHist = s.rb?.[r] ?? [];
  const cand = api.cand[r];
  const dirty = JSON.stringify(cand) !== JSON.stringify(active);
  const configure: CliCommand = { id: "conf", syntax: "configure", summary: "Enter configuration mode (the candidate configuration)", run: () => (!dirty && api.setCand({ ...api.cand, [r]: osClone(active) }), api.setJunosEdit(r, true), { output: dirty ? "Entering configuration mode\nThe configuration has been changed but not committed\n" : "Entering configuration mode\n" }) };
  if (!api.junosEdit[r]) return { ...base, prompt: `admin@${r}> `, commands: [...op, configure] };
  const set = (c: OsRouterCfg) => api.setCand({ ...api.cand, [r]: c });
  const ifUnitArg: CliArgSpec = { choices: OS_IFS.map((i) => `${i}.0`), describe: (x) => DESC[r][x.replace(/\.0$/, "") as OsIf], resolve: (raw) => { const x = raw.replace(/\.0$/, ""); return (OS_IFS as readonly string[]).includes(x) ? x : undefined; } };
  const areaArg: CliArgSpec = { choices: ["0.0.0.0", "0.0.0.1"], describe: () => "area ID", resolve: (raw) => (/^0\.0\.0\.[01]$/.test(raw) ? raw : /^[01]$/.test(raw) ? `0.0.0.${raw}` : undefined) };
  const pIf = (i: string, patch: Partial<OsIfCfg>) => set({ ...cand, ifs: { ...cand.ifs, [i]: { ...cand.ifs[i as OsIf], ...patch } } });
  const area = (a: string) => +a.split(".")[3];
  const prefArg: CliArgSpec = { choices: ["192.168.4.0/24"], resolve: (raw) => (/^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/.test(raw) && isIp(raw.split("/")[0]) ? raw : undefined) };
  const nhArg: CliArgSpec = { choices: OS_IFS.filter((i) => i !== "lo0" && i !== "ge-0/0/0").map((i) => IF_ADDR[peerOf(r, i)!.r][peerOf(r, i)!.i].ip), resolve: (raw) => (isIp(raw) ? raw : undefined) };
  const doCommit = (quit: boolean): CliResult => {
    if (dirty) setRouter(api, r, cand, "Junos commit", true);
    if (quit) api.setJunosEdit(r, false);
    return { output: quit ? "commit complete\nExiting configuration mode" : "commit complete", explanation: dirty ? "Active now: OSPF re-ran SPF. Check show ospf neighbor / show route, then prove it with traffic." : undefined };
  };
  return {
    ...base,
    prompt: `admin@${r}# `,
    commands: [
      { id: "oi", syntax: "set protocols ospf area <area> interface <ifu>", summary: "Run OSPF on an interface, in an area", args: { area: areaArg, ifu: ifUnitArg }, run: ({ area: a, ifu }) => (pIf(ifu, { ospf: true, area: area(a) }), { output: "" }) },
      { id: "oi", syntax: "delete protocols ospf area <area> interface <ifu>", summary: "Take an interface out of OSPF", args: { area: areaArg, ifu: ifUnitArg }, run: ({ ifu }) => (cand.ifs[ifu as OsIf].ospf ? (pIf(ifu, { ospf: false }), { output: "" }) : refuse("warning: statement not found")) },
      { id: "met", syntax: "set protocols ospf area <area> interface <ifu> metric <cost>", summary: "The interface's OSPF cost", args: { area: areaArg, ifu: ifUnitArg, cost: numArg(1, 65535, ["10", "100"], "metric") }, run: ({ area: a, ifu, cost }) => (pIf(ifu, { ospf: true, area: area(a), cost: +cost }), { output: "" }) },
      { id: "met", syntax: "delete protocols ospf area <area> interface <ifu> metric", summary: "Back to the default metric", args: { area: areaArg, ifu: ifUnitArg }, run: ({ ifu }) => (pIf(ifu, { cost: 1 }), { output: "" }) },
      { id: "pas", syntax: "set protocols ospf area <area> interface <ifu> passive", summary: "Advertise but send no Hellos", args: { area: areaArg, ifu: ifUnitArg }, run: ({ area: a, ifu }) => (pIf(ifu, { ospf: true, area: area(a), passive: true }), { output: "" }) },
      { id: "pas", syntax: "delete protocols ospf area <area> interface <ifu> passive", summary: "Send Hellos again", args: { area: areaArg, ifu: ifUnitArg }, run: ({ ifu }) => (cand.ifs[ifu as OsIf].passive ? (pIf(ifu, { passive: false }), { output: "" }) : refuse("warning: statement not found")) },
      { id: "hel", syntax: "set protocols ospf area <area> interface <ifu> hello-interval <seconds>", summary: "Hello interval", args: { area: areaArg, ifu: ifUnitArg, seconds: numArg(1, 255, ["10", "5"], "seconds") }, run: ({ ifu, seconds }) => (pIf(ifu, { hello: +seconds }), { output: "" }) },
      { id: "dea", syntax: "set protocols ospf area <area> interface <ifu> dead-interval <seconds>", summary: "Dead interval", args: { area: areaArg, ifu: ifUnitArg, seconds: numArg(1, 65535, ["40", "20"], "seconds") }, run: ({ ifu, seconds }) => (pIf(ifu, { dead: +seconds }), { output: "" }) },
      { id: "mtu", syntax: "set interfaces <iface> unit 0 family inet mtu <bytes>", summary: "The IP MTU of an interface", args: { iface: junosIfArg(r), bytes: numArg(256, 9192, ["1500", "1400"], "bytes") }, run: ({ iface, bytes }) => (pIf(iface, { mtu: +bytes }), { output: "" }) },
      { id: "mtu", syntax: "delete interfaces <iface> unit 0 family inet mtu", summary: "Back to the default MTU", args: { iface: junosIfArg(r) }, run: ({ iface }) => (pIf(iface, { mtu: 1500 }), { output: "" }) },
      { id: "dis", syntax: "set interfaces <iface> disable", summary: "Disable an interface", args: { iface: junosIfArg(r) }, run: ({ iface }) => (pIf(iface, { shut: true }), { output: "" }) },
      { id: "dis", syntax: "delete interfaces <iface> disable", summary: "Enable an interface", args: { iface: junosIfArg(r) }, run: ({ iface }) => (cand.ifs[iface as OsIf].shut ? (pIf(iface, { shut: false }), { output: "" }) : refuse("warning: statement not found")) },
      { id: "st", syntax: "set routing-options static route <prefix> next-hop <nh>", summary: "A static route (preference 5: beats OSPF's 10)", args: { prefix: prefArg, nh: nhArg }, run: ({ prefix, nh }) => (set({ ...cand, statics: [...cand.statics.filter((x) => `${x.prefix}/${x.len}` !== prefix), { prefix: prefix.split("/")[0], len: +prefix.split("/")[1], nh }] }), { output: "" }) },
      { id: "st", syntax: "delete routing-options static route <prefix>", summary: "Remove a static route", args: { prefix: { ...prefArg, choices: cand.statics.map((x) => `${x.prefix}/${x.len}`) } }, run: ({ prefix }) => (cand.statics.some((x) => `${x.prefix}/${x.len}` === prefix) ? (set({ ...cand, statics: cand.statics.filter((x) => `${x.prefix}/${x.len}` !== prefix) }), { output: "" }) : refuse("warning: statement not found")) },
      { id: "show", syntax: "show", summary: "The candidate configuration (try show | compare)", run: () => ({ output: osJunosText(r, cand) }) },
      { id: "show", syntax: "show protocols ospf", summary: "Candidate OSPF configuration", run: () => ({ output: osJunosText(r, cand, ["protocols", "ospf"]) }) },
      { id: "commit", syntax: "commit", summary: "Activate the candidate configuration", run: () => doCommit(false) },
      { id: "commit", syntax: "commit check", summary: "Check the candidate", run: () => ({ output: "configuration check succeeds" }) },
      { id: "commit", syntax: "commit and-quit", summary: "Commit, then leave configuration mode", run: () => doCommit(true) },
      { id: "rollback", syntax: "rollback", summary: "Discard your uncommitted changes (= rollback 0)", run: () => (set(osClone(active)), { output: "load complete" }) },
      {
        id: "rollback",
        syntax: "rollback <n>",
        summary: "Load an earlier committed configuration into the candidate (then commit)",
        args: { n: { choices: ["0", ...rbHist.map((_, i) => String(i + 1))], describe: (x) => (x === "0" ? "the active configuration" : x === "1" ? "before the last commit" : `before the last ${x} commits`), resolve: (raw) => (/^\d{1,2}$/.test(raw) ? String(+raw) : undefined) } },
        run: ({ n }) => {
          if (n === "0") return (set(osClone(active)), { output: "load complete" });
          const json = rbHist[Number(n) - 1];
          if (!json) return refuse(`error: rollback ${n} does not exist${rbHist.length ? ` (1–${rbHist.length} available)` : " (no commits yet)"}`);
          set(JSON.parse(json) as OsRouterCfg);
          return { output: "load complete", explanation: `The candidate now holds the configuration from before the last ${n === "1" ? "commit" : `${n} commits`}. show | compare, then commit to activate it.` };
        },
      },
      ...prefixed(op, "run"),
      {
        id: "exit",
        syntax: "exit",
        summary: "Leave configuration mode",
        run: () => {
          if (!dirty || !api.ask) return (api.setJunosEdit(r, false), { output: "Exiting configuration mode" });
          api.ask({ node: r, prompt: "The configuration has been changed but not committed\nExit with uncommitted changes? [yes,no] (yes) ", answer: (line) => { api.ask?.(undefined); if (/^n(o)?$/i.test(line.trim())) return { output: "" }; api.setJunosEdit(r, false); return { output: "Exiting configuration mode" }; }, cancel: () => (api.ask?.(undefined), "") });
          return { output: "" };
        },
      },
    ],
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Hosts
// ---------------------------------------------------------------------------------------------------------------
function hostSet(api: OsCliApi, h: OsHost): CliCommandSet {
  const name = h.toLowerCase();
  const gw = IF_ADDR[ROUTER_OF[h]]["ge-0/0/0"].ip;
  const ipA = ipArg();
  const ping = (ip: string, n: number): CliResult => {
    const ns = api.act({ type: "traffic", sends: [{ from: h, to: ip, kind: "ping" }] });
    const r = ns.last!.results[0];
    if (r.replied) return { output: [`PING ${ip} (${ip}) 56(84) bytes of data.`, ...Array.from({ length: n }, (_, i) => `64 bytes from ${ip}: icmp_seq=${i + 1} ttl=${r.ttl} time=${(1.2 + i * 0.1).toFixed(1)} ms`), "", `--- ${ip} ping statistics ---`, `${n} packets transmitted, ${n} received, 0% packet loss`].join("\n"), explanation: `TTL ${r.ttl}: ${64 - (r.ttl ?? 64)} router hop(s) on the way back. Path: ${r.path.join(" → ")}.` };
    const unreach = /no route/.test(r.fail ?? "");
    return { output: [`PING ${ip} (${ip}) 56(84) bytes of data.`, ...(unreach ? [`From ${gw} icmp_seq=1 Destination Net Unreachable`] : []), "", `--- ${ip} ping statistics ---`, `${n} packets transmitted, 0 received${unreach ? ", +1 errors" : ""}, 100% packet loss`].join("\n"), explanation: r.fail };
  };
  const cmds: CliCommand[] = [
    { id: "addr", syntax: "ip addr", summary: "This host's address", run: () => ({ output: `2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 state UP\n    inet ${HOST_IP[h]}/24 scope global eth0` }) },
    { id: "route", syntax: "ip route", summary: "This host's routes", run: () => ({ output: `default via ${gw} dev eth0\n${HOST_IP[h].split(".").slice(0, 3).join(".")}.0/24 dev eth0 proto kernel scope link src ${HOST_IP[h]}`, explanation: `Everything off the LAN goes to ${ROUTER_OF[h]} (${gw}). From there OSPF decides.` }) },
    { id: "ping", syntax: "ping <ip>", summary: "Ping (4 echo requests)", args: { ip: ipA }, run: ({ ip }) => ping(ip, 4) },
    { id: "ping", syntax: "ping -c <count> <ip>", summary: "Ping <count> times", args: { count: numArg(1, 10, ["1", "3"], "count"), ip: ipA }, run: ({ count, ip }) => ping(ip, +count) },
    { id: "trace", syntax: "traceroute <ip>", summary: "Every router on the way", args: { ip: ipA }, run: ({ ip }) => { const ns = api.act({ type: "traffic", sends: [{ from: h, to: ip, kind: "trace" }] }); const rows = ns.last!.results[0].trace ?? []; return { output: [`traceroute to ${ip} (${ip}), 30 hops max, 60 byte packets`, ...rows.map((t) => ` ${t.hop}  ${t.ip === "*" ? "* * *" : `${t.ip} (${t.ip})  ${t.hop}.${t.hop}21 ms  ${t.hop}.${t.hop}55 ms  ${t.hop}.${t.hop}03 ms`}`)].join("\n"), explanation: `Routers on the path: ${ns.last!.results[0].path.filter((x) => /^R/.test(x)).join(" → ") || "none"}.` }; } },
  ];
  return withShellHistory(withSelfPing({ vendor: "cisco", deviceId: h, deviceName: name, prompt: `admin@${name}:~$ `, commands: cmds }, "linux", [HOST_IP[h]]), "linux", api.history);
}

export function osRouterSets(api: OsCliApi, r: OsRouter): Partial<Record<CliVendor, CliCommandSet>> {
  const own = OS_IFS.map((i) => IF_ADDR[r][i].ip);
  return { cisco: withSelfPing(iosSet(api, r), "ios", own), juniper: withSelfPing(junosSet(api, r), "junos", own) };
}
export const osHostSet = hostSet;
export const osJunosConfig = (api: Pick<OsCliApi, "view">, r: OsRouter) => (which: "committed" | number, path: string[]) => (which === "committed" || which === 0 ? osJunosText(r, api.view.cfg.r[r], path) : undefined);
