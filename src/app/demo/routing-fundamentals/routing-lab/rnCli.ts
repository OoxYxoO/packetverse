import type { CliArgSpec, CliCommand, CliCommandSet, CliVendor } from "@/lib/cli/types";
import { columns as fixedColumns } from "@/lib/cli/format";
import { withSelfPing } from "@/lib/cli/selfPing";
import type { CliQuestion } from "@/app/demo/dhcp-dns/dhcp-lab/dhcpBuildCli";
import { RN_IFS, ipNum, isRouter, lenOfMask, maskOf, netOf, rnClone, rnIfStatus, rnLookup, rnName, rnOwner, rnRib, routeKeyOf, staticKey, validIp, MAC, type RnAction, type RnCfg, type RnHost, type RnIf, type RnRoute, type RnRouter, type RnRouterCfg, type RnState, type RnStatic } from "@/lib/sim-engine/scenarios/routeNet";

/**
 * Terminals of the Routing Lab: R1–R3 as Cisco IOS or Junos, the hosts as Linux. Two OS views of ONE network: every
 * output is printed from the lab state the topology, the tables, the captures and the tests use, and every change
 * goes through a lab action (IOS: on Enter; Junos: on commit). A wrong route stays wrong — nothing is corrected.
 *
 *   IOS    show ip route [static | connected | <ip>] · show ip interface brief · show interfaces <if> · show ip arp ·
 *          show running-config · ping <ip> [source <ip>] · traceroute <ip> · clear ip arp ·
 *          configure terminal → ip route <net> <mask> <next-hop | Null0> · no ip route … · interface <if> → (no) shutdown
 *   Junos  show route [<ip> | <prefix> exact | protocol static | protocol direct | hidden] · show interfaces terse ·
 *          show interfaces <if> · show arp no-resolve · show configuration … · ping <ip> count <n> · traceroute <ip> ·
 *          configure → set|delete routing-options static route <prefix> next-hop <ip> | discard ·
 *          set|delete interfaces <if> disable → show | compare · commit check · commit · rollback · run …
 *   Linux  ping -c N <ip> · traceroute <ip> · ip route · ip addr · ip neigh
 */

export type RnIosMode = { kind: "exec" } | { kind: "config" } | { kind: "if"; i: RnIf };
export interface RnCliApi {
  view: RnState;
  act: (a: RnAction) => RnState;
  ios: Record<RnRouter, RnIosMode>;
  setIos: (r: RnRouter, m: RnIosMode) => void;
  junosEdit: Record<RnRouter, boolean>;
  setJunosEdit: (r: RnRouter, b: boolean) => void;
  cand: Record<RnRouter, RnRouterCfg>;
  setCand: (r: RnRouter, c: RnRouterCfg) => void;
  ask?: (q: CliQuestion | undefined) => void;
  history?: string[];
}
export const ifName = (vendor: CliVendor, i: RnIf | string, long = false) => (vendor === "cisco" ? `${long ? "GigabitEthernet" : "Gi"}0/${i.slice(-1)}` : i);
/** Lab text written with model interface names, in the OS view the student picked. */
export const rnVendorText = (vendor: CliVendor, t: string) => (vendor === "cisco" ? t.replace(/\bge-0\/0\/(\d)\b/g, "Gi0/$1") : t);
const columns = (rows: string[][]) => fixedColumns(rows, rows[0].map((_, i) => Math.max(...rows.map((r) => (r[i] ?? "").length)) + 2));
const refuse = (output: string, explanation?: string) => ({ output, refused: true, explanation });
const ciscoMac = (m: string) => {
  const h = m.replace(/:/g, "");
  return `${h.slice(0, 4)}.${h.slice(4, 8)}.${h.slice(8)}`;
};
const ipArg = (choices: string[], what = "IPv4 address"): CliArgSpec => ({ choices, describe: () => what, resolve: (raw) => (validIp(raw) ? raw : undefined) });
const maskArg: CliArgSpec = { choices: ["255.255.255.0", "255.255.0.0", "255.255.255.128", "255.255.255.252", "0.0.0.0"], describe: (c) => `/${lenOfMask(c)}`, resolve: (raw) => (validIp(raw) && lenOfMask(raw) >= 0 ? raw : undefined) };
const prefixArg = (choices: string[]): CliArgSpec => ({ choices, describe: () => "destination prefix (a.b.c.d/len)", resolve: (raw) => { const m = /^(\d+\.\d+\.\d+\.\d+)\/(\d+)$/.exec(raw); return m && validIp(m[1]) && +m[2] <= 32 ? raw : undefined; } });
const IFS_CISCO = Object.fromEntries(RN_IFS.map((i) => [i, `GigabitEthernet0/${i.slice(-1)}`])) as Record<RnIf, string>;
const ifArgCisco: CliArgSpec = { choices: Object.values(IFS_CISCO), describe: (c) => `ge-0/0/${c.slice(-1)}`, resolve: (raw) => { const m = /^(g|gi|gig|giga|gigabit|gigabitethernet)\s*0\/([0-2])$/i.exec(raw); return m ? `ge-0/0/${m[2]}` : undefined; } };
const ifArgJunos: CliArgSpec = { choices: [...RN_IFS], resolve: (raw) => ((RN_IFS as string[]).includes(raw.replace(/\.0$/, "")) ? raw.replace(/\.0$/, "") : undefined) };
const TARGETS = ["172.16.50.50", "172.16.50.200", "172.16.60.10", "10.10.10.10", "10.0.12.2", "203.0.113.80"];
const upTime = (clock: number) => {
  const t = 3600 * 5 + clock;
  return `${String(Math.floor(t / 3600)).padStart(2, "0")}:${String(Math.floor(t / 60) % 60).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
};
function setRouter(api: RnCliApi, r: RnRouter, c: RnRouterCfg, text: string): RnState {
  const cfg = rnClone(api.view.cfg);
  cfg.r[r] = rnClone(c);
  return api.act({ type: "cfg", cfg, text: `${r}: ${text}` });
}
const runOut = (api: RnCliApi, a: RnAction) => api.act(a).last!;

// ---------------------------------------------------------------------------------------------------------------
// Cisco IOS
// ---------------------------------------------------------------------------------------------------------------
const classful = (prefix: string) => {
  const o = Number(prefix.split(".")[0]);
  return o < 128 ? 8 : o < 192 ? 16 : 24;
};
function iosRoute(s: RnState, r: RnRouter, filter?: "static" | "connected"): string {
  const rib = rnRib(s.cfg, r).filter((x) => x.active && (!filter || (filter === "connected" ? x.proto !== "static" : x.proto === "static")));
  const line = (x: RnRoute, indent: boolean) => {
    const code = x.proto === "local" ? "L" : x.proto === "connected" ? "C" : x.len === 0 ? "S*" : "S";
    const what = x.proto !== "static" ? `is directly connected, ${IFS_CISCO[x.iface!]}` : x.discard ? "is directly connected, Null0" : `[1/0] via ${x.nh}`;
    return `${code.padEnd(indent ? 9 : 6)}${routeKeyOf(x)} ${what}`;
  };
  const def = rib.find((x) => x.proto === "static" && x.len === 0);
  const groups = new Map<string, RnRoute[]>();
  for (const x of rib.filter((y) => y.len > 0)) {
    const k = `${netOf(x.prefix, classful(x.prefix))}/${classful(x.prefix)}`;
    groups.set(k, [...(groups.get(k) ?? []), x]);
  }
  const body: string[] = [];
  if (def) body.push(line(def, false));
  for (const [k, xs] of groups) {
    const masks = new Set(xs.map((x) => x.len));
    body.push(masks.size > 1 ? `      ${k} is variably subnetted, ${xs.length} subnets, ${masks.size} masks` : `      ${k.split("/")[0]}/${xs[0].len} is subnetted, ${xs.length} subnets`);
    body.push(...xs.map((x) => line(x, true)));
  }
  return ["Codes: L - local, C - connected, S - static, R - RIP, M - mobile, B - BGP", "       O - OSPF, IA - OSPF inter area, i - IS-IS, * - candidate default", "", filter ? "" : def ? `Gateway of last resort is ${def.discard ? "0.0.0.0" : def.nh} to network 0.0.0.0` : "Gateway of last resort is not set", "", ...body].filter((l, i) => !(filter && i === 3)).join("\n");
}
function iosRouteFor(s: RnState, r: RnRouter, ip: string): string {
  const w = rnLookup(s.cfg, r, ip).winner;
  if (!w) return "% Network not in table";
  if (w.proto !== "static") return [`Routing entry for ${routeKeyOf(w)}`, `  Known via "${w.proto}", distance 0, metric 0 (connected)`, "  Routing Descriptor Blocks:", `  * directly connected, via ${IFS_CISCO[w.iface!]}`, "      Route metric is 0, traffic share count is 1"].join("\n");
  return [`Routing entry for ${routeKeyOf(w)}${w.len === 0 ? ", supernet" : ""}`, '  Known via "static", distance 1, metric 0' + (w.len === 0 ? ", candidate default path" : ""), "  Routing Descriptor Blocks:", w.discard ? "  * directly connected, via Null0" : `  * ${w.nh}`, "      Route metric is 0, traffic share count is 1"].join("\n");
}
const iosStatic = (x: RnStatic) => `ip route ${netOf(x.prefix, x.len)} ${maskOf(x.len)} ${x.discard ? "Null0" : x.nh}`;
function iosRunning(cfg: RnCfg, r: RnRouter): string {
  const c = cfg.r[r];
  const body = [`hostname ${r}`, "!", ...RN_IFS.flatMap((i) => [`interface ${IFS_CISCO[i]}`, ` ip address ${c.ifs[i].addr} ${maskOf(c.ifs[i].len)}`, ...(c.ifs[i].shut ? [" shutdown"] : [" no shutdown"]), "!"]), ...(c.statics.some((x) => x.discard) ? ["interface Null0", " no ip unreachables", "!"] : []), ...c.statics.map(iosStatic), "!", "end"];
  return `Building configuration...\n\nCurrent configuration : ${body.join("\n").length} bytes\n!\n${body.join("\n")}`;
}
function ciscoPing(api: RnCliApi, r: RnRouter, ip: string, source?: string) {
  const run = runOut(api, { type: "ping", from: r, dst: ip, count: 5, source });
  const ch = run.probes.map((p) => (p.kind === "reply" ? "!" : p.kind === "net-unreach" || p.kind === "host-unreach" ? "U" : p.kind === "time-exceeded" ? "&" : "."));
  const rx = run.probes.filter((p) => p.kind === "reply").length;
  return { output: ["Type escape sequence to abort.", `Sending 5, 100-byte ICMP Echos to ${ip}, timeout is 2 seconds:`, ...(source ? [`Packet sent with a source address of ${source}`] : []), ch.join(""), `Success rate is ${rx * 20} percent (${rx}/5)${rx ? ", round-trip min/avg/max = 1/1/2 ms" : ""}`].join("\n"), explanation: rx === 5 ? undefined : "! reply · . no answer (dropped somewhere silently, or the reply was lost) · U unreachable came back · & TTL exceeded. Watch the topology to see where it stopped." };
}
function ciscoTrace(api: RnCliApi, r: RnRouter, ip: string) {
  const run = runOut(api, { type: "traceroute", from: r, dst: ip });
  const lines = run.probes.map((p) => `  ${p.ttl} ${p.from ? `${p.from} ${p.kind === "net-unreach" ? "!N" : p.kind === "host-unreach" ? "!H" : "1 msec 1 msec 1 msec"}` : "*  *  *"}`);
  return { output: ["Type escape sequence to abort.", `Tracing the route to ${ip}`, "VRF info: (vrf in name/id, vrf out name/id)", ...lines].join("\n") };
}
function iosShows(api: RnCliApi, r: RnRouter): CliCommand[] {
  const s = api.view;
  const c = s.cfg.r[r];
  return [
    { id: "sh-route", syntax: "show ip route", summary: `${r}'s routing table (installed routes)`, run: () => ({ output: iosRoute(s, r), explanation: "Only INSTALLED routes appear. A configured static route whose next hop can't be reached is in the running-config but not here. The order is by address — the lookup rule is not “top first” but “longest matching prefix”." }) },
    { id: "sh-route", syntax: "show ip route static", summary: "Installed static routes only", run: () => ({ output: iosRoute(s, r, "static") }) },
    { id: "sh-route", syntax: "show ip route connected", summary: "Connected and local routes only", run: () => ({ output: iosRoute(s, r, "connected"), explanation: "One connected route per interface that is configured and UP, plus a /32 local route for the router's own address." }) },
    { id: "sh-route-ip", syntax: "show ip route <ip>", summary: "Which route wins for one destination (longest match)", args: { ip: ipArg(TARGETS, "destination") }, run: ({ ip }) => ({ output: iosRouteFor(s, r, ip), explanation: "This is the router's real decision for that destination: of all installed routes containing it, the longest prefix." }) },
    { id: "sh-ipint", syntax: "show ip interface brief", summary: "Interfaces, addresses, state", run: () => ({ output: columns([["Interface", "IP-Address", "OK?", "Method", "Status", "Protocol"], ...RN_IFS.map((i) => { const st = rnIfStatus(s.cfg, r, i); return [IFS_CISCO[i], c.ifs[i].addr, "YES", "manual", st === "admin-down" ? "administratively down" : st, st === "up" ? "up" : "down"]; })]) }) },
    { id: "sh-int", syntax: "show interfaces <if>", summary: "One interface: state and packet counters", args: { if: ifArgCisco }, run: ({ if: i }) => { const st = rnIfStatus(s.cfg, r, i as RnIf); const k = s.counters[`${r} ${i}`]; return { output: [`${IFS_CISCO[i as RnIf]} is ${st === "admin-down" ? "administratively down" : st}, line protocol is ${st === "up" ? "up" : "down"}`, `  Hardware is iGbE, address is ${ciscoMac(MAC[`${r}:${i}`])}`, `  Internet address is ${c.ifs[i as RnIf].addr}/${c.ifs[i as RnIf].len}`, `     ${k.in} packets input`, `     ${k.out} packets output`].join("\n"), explanation: "Counters prove a link carried the traffic — or that nothing ever left this way." }; } },
    { id: "sh-arp", syntax: "show ip arp", summary: "ARP cache: next-hop IP → MAC", run: () => ({ output: columns([["Protocol", "Address", "Age (min)", "Hardware Addr", "Type", "Interface"], ...RN_IFS.filter((i) => rnIfStatus(s.cfg, r, i) === "up").map((i) => ["Internet", c.ifs[i].addr, "-", ciscoMac(MAC[`${r}:${i}`]), "ARPA", IFS_CISCO[i]]), ...Object.entries(s.arp[r]).map(([ip, mac]) => { const i = RN_IFS.find((x) => netOf(ip, c.ifs[x].len) === netOf(c.ifs[x].addr, c.ifs[x].len)); return ["Internet", ip, "0", mac === "incomplete" ? "Incomplete" : ciscoMac(mac), "ARPA", mac === "incomplete" ? "" : i ? IFS_CISCO[i] : ""]; })]), explanation: "Choosing a route gives a next-hop IP; the frame needs that next hop's MAC. “Incomplete” = R asked, nobody answered." }) },
    { id: "sh-run", syntax: "show running-config", summary: `${r}'s configuration`, run: () => ({ output: iosRunning(s.cfg, r), explanation: "Configuration: what was typed. show ip route: what is installed and used. A difference between the two is evidence." }) },
    { id: "ping", syntax: "ping <ip>", summary: "Ping from this router (sourced from the egress interface)", args: { ip: ipArg(TARGETS, "destination") }, run: ({ ip }) => ciscoPing(api, r, ip) },
    { id: "ping", syntax: "ping <ip> source <src>", summary: "Ping with a chosen source address (tests the return path to that address)", args: { ip: ipArg(TARGETS, "destination"), src: ipArg(RN_IFS.map((i) => c.ifs[i].addr), "one of this router's addresses") }, run: ({ ip, src }) => (RN_IFS.some((i) => c.ifs[i].addr === src) ? ciscoPing(api, r, ip, src) : refuse("% Invalid source address- IP address not on any of our up interfaces")) },
    { id: "trace", syntax: "traceroute <ip>", summary: "Every router on the way (TTL 1, 2, 3 …)", args: { ip: ipArg(TARGETS, "destination") }, run: ({ ip }) => ciscoTrace(api, r, ip) },
    { id: "clear-arp", syntax: "clear ip arp", summary: "Forget learned ARP entries", run: () => (api.act({ type: "clear-arp", dev: r }), { output: "" }) },
  ];
}
function iosSet(api: RnCliApi, r: RnRouter): CliCommandSet {
  const s = api.view;
  const c = s.cfg.r[r];
  const mode = api.ios[r];
  const base = { vendor: "cisco" as const, deviceId: r, deviceName: r };
  const shows = iosShows(api, r);
  const exit: CliCommand[] = [
    { id: "end", syntax: "end", summary: "Back to privileged EXEC", run: () => (api.setIos(r, { kind: "exec" }), { output: "" }) },
    { id: "exit", syntax: "exit", summary: "Up one level", run: () => (api.setIos(r, mode.kind === "config" ? { kind: "exec" } : { kind: "config" }), { output: "" }) },
  ];
  if (mode.kind === "exec") return { ...base, prompt: `${r}#`, commands: [...shows, histCmd(api, "show history", false), { id: "conf", syntax: "configure terminal", summary: "Enter configuration mode", run: () => (api.setIos(r, { kind: "config" }), { output: "Enter configuration commands, one per line.  End with CNTL/Z." }) }, { id: "conf", syntax: "conf t", summary: "", hidden: true, run: () => (api.setIos(r, { kind: "config" }), { output: "Enter configuration commands, one per line.  End with CNTL/Z." }) }] };
  const doShows = shows.map((x) => ({ ...x, id: `do:${x.id}`, syntax: `do ${x.syntax}`, hidden: true }));
  if (mode.kind === "config") {
    const add = (net: string, mask: string, target: string) => {
      const len = lenOfMask(mask);
      if (netOf(net, len) !== net) return refuse("%Inconsistent address and mask", `${net} has bits set beyond /${len}. The network address of that prefix is ${netOf(net, len)}.`);
      const discard = /^null0$/i.test(target);
      if (!discard && !validIp(target)) return refuse("% Invalid input detected at '^' marker.");
      const key = `${net}/${len}`;
      const same = c.statics.find((x) => staticKey(x) === key);
      if (same && (same.discard ? discard : same.nh === target)) return { output: "" };
      if (same) return refuse("% This lab does not model two next hops for one prefix.", `${key} already points ${same.discard ? "at Null0" : `via ${same.nh}`}. Remove it first: no ${iosStatic(same)}`);
      const after = setRouter(api, r, { ...c, statics: [...c.statics, discard ? { prefix: net, len, discard: true } : { prefix: net, len, nh: target }] }, iosStatic({ prefix: net, len, nh: target, discard }));
      const route = rnRib(after.cfg, r).find((x) => x.proto === "static" && routeKeyOf(x) === key);
      return { output: "", explanation: discard ? "Installed: matching packets are now dropped here (Null0)." : route && !route.active ? `Configured — but NOT installed: ${route.why}. Check show ip route.` : `Installed: ${key} via ${target} (out ${route?.iface ? IFS_CISCO[route.iface] : "?"}). Prove it with traffic.` };
    };
    return {
      ...base,
      prompt: `${r}(config)#`,
      commands: [
        { id: "route", syntax: "ip route <net> <mask> <nh>", summary: "Static route: destination network, mask, next hop (or Null0 to discard)", args: { net: ipArg(["172.16.50.0", "172.16.60.0", "10.10.10.0", "0.0.0.0"], "destination network"), mask: maskArg, nh: { choices: ["10.0.12.1", "10.0.12.2", "10.0.13.1", "10.0.13.2", "10.0.23.1", "10.0.23.2", "Null0"], describe: (x) => (x === "Null0" ? "discard: drop matching packets here" : `next hop (${rnName(s.cfg, x)})`), resolve: (raw) => (validIp(raw) ? raw : /^null0$/i.test(raw) ? "Null0" : undefined) } }, run: ({ net, mask, nh }) => add(net, mask, nh) },
        { id: "noroute", syntax: "no ip route <net> <mask>", summary: "Remove a static route", args: { net: ipArg(c.statics.map((x) => netOf(x.prefix, x.len)), "destination network"), mask: maskArg }, run: ({ net, mask }) => { const key = `${net}/${lenOfMask(mask)}`; const x = c.statics.find((y) => staticKey(y) === key); if (!x) return refuse("%No matching route to delete"); setRouter(api, r, { ...c, statics: c.statics.filter((y) => y !== x) }, `no ${iosStatic(x)}`); return { output: "" }; } },
        { id: "noroute", syntax: "no ip route <net> <mask> <nh>", summary: "", hidden: true, args: { net: ipArg([]), mask: maskArg, nh: { choices: [], resolve: (raw) => raw } }, run: ({ net, mask }) => { const key = `${net}/${lenOfMask(mask)}`; const x = c.statics.find((y) => staticKey(y) === key); if (!x) return refuse("%No matching route to delete"); setRouter(api, r, { ...c, statics: c.statics.filter((y) => y !== x) }, `no ${iosStatic(x)}`); return { output: "" }; } },
        { id: "if", syntax: "interface <if>", summary: "Configure an interface", args: { if: ifArgCisco }, run: ({ if: i }) => (api.setIos(r, { kind: "if", i: i as RnIf }), { output: "" }) },
        ...exit,
        ...doShows,
        ...["router <proto>", "router <proto> <id>"].map((syntax): CliCommand => ({ id: "router", syntax, summary: "", hidden: true, args: { proto: { choices: [], resolve: (raw) => raw }, id: { choices: [], resolve: (raw) => raw } }, run: () => refuse("% Not in this lab: routing protocols (OSPF, IS-IS, BGP) come in later lessons. Here every remote route is static.") })),
      ],
    };
  }
  const i = mode.i;
  return {
    ...base,
    prompt: `${r}(config-if)#`,
    commands: [
      { id: "shut", syntax: "shutdown", summary: "Disable the interface", run: () => (setRouter(api, r, { ...c, ifs: { ...c.ifs, [i]: { ...c.ifs[i], shut: true } } }, `interface ${IFS_CISCO[i]} shutdown`), { output: `%LINK-5-CHANGED: Interface ${IFS_CISCO[i]}, changed state to administratively down`, explanation: "Its connected route is withdrawn — and every static route whose next hop was reached through it stops being installed." }) },
      { id: "noshut", syntax: "no shutdown", summary: "Enable the interface", run: () => { const after = setRouter(api, r, { ...c, ifs: { ...c.ifs, [i]: { ...c.ifs[i], shut: false } } }, `interface ${IFS_CISCO[i]} no shutdown`); const up = rnIfStatus(after.cfg, r, i) === "up"; return { output: up ? `%LINK-3-UPDOWN: Interface ${IFS_CISCO[i]}, changed state to up` : "", explanation: up ? "Up: its connected route is back — and so is every static route whose next hop it reaches." : "Enabled here, but the far end of this link is disabled: the link stays down." }; } },
      { id: "if", syntax: "interface <if>", summary: "Another interface", args: { if: ifArgCisco }, run: ({ if: x }) => (api.setIos(r, { kind: "if", i: x as RnIf }), { output: "" }) },
      ...exit,
      ...doShows,
      { id: "ipaddr", syntax: "ip address <ip> <mask>", summary: "", hidden: true, args: { ip: ipArg([]), mask: maskArg }, run: () => refuse("% Not in this lab: the addressing plan is fixed — this lesson is about routes.") },
    ],
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Junos
// ---------------------------------------------------------------------------------------------------------------
function junosRoute(s: RnState, r: RnRouter, pick: (x: RnRoute) => boolean, hidden = false): string {
  const all = rnRib(s.cfg, r);
  const rib = all.filter((x) => (hidden ? !x.active && x.proto === "static" : x.active) && pick(x));
  const act = all.filter((x) => x.active).length;
  const hid = all.filter((x) => !x.active && x.proto === "static").length;
  const t = upTime(s.clock);
  const body = rib.flatMap((x) => {
    const head = `${routeKeyOf(x).padEnd(19)}${hidden ? " " : "*"}[${x.proto === "static" ? "Static/5" : x.proto === "local" ? "Local/0" : "Direct/0"}] ${t}`;
    const nh = x.discard ? "                      Discard" : x.proto === "local" ? `                      Local via ${x.iface}.0` : x.proto === "connected" ? `                    >  via ${x.iface}.0` : hidden ? `                       to ${x.nh} — Unusable` : `                    >  to ${x.nh} via ${x.iface}.0`;
    return [head, nh];
  });
  return [`inet.0: ${act + hid} destinations, ${act + hid} routes (${act} active, 0 holddown, ${hid} hidden)`, "+ = Active Route, - = Last Active, * = Both", "", ...body].join("\n");
}
const junosStaticLine = (x: RnStatic) => `route ${staticKey(x)} ${x.discard ? "discard" : `next-hop ${x.nh}`};`;
/** history / show history / show cli history list the command being run too, as real shells do. */
const histCmd = (api: RnCliApi, syntax: string, numbered: boolean): CliCommand => ({ id: "hist", syntax, summary: "The commands you typed in this session", run: () => ({ output: [...(api.history ?? []), syntax].map((x, n) => (numbered ? `${String(n + 1).padStart(5)}  ${x}` : `  ${x}`)).join("\n") }) });

export function rnJunosText(r: RnRouter, c: RnRouterCfg, path: string[] = []): string {
  const ifs = ["interfaces {", ...RN_IFS.flatMap((i) => [`    ${i} {`, ...(c.ifs[i].shut ? ["        disable;"] : []), "        unit 0 {", "            family inet {", `                address ${c.ifs[i].addr}/${c.ifs[i].len};`, "            }", "        }", "    }"]), "}"];
  const ro = c.statics.length ? ["routing-options {", "    static {", ...c.statics.map((x) => `        ${junosStaticLine(x)}`), "    }", "}"] : [];
  const sys = ["system {", `    host-name ${r};`, "}"];
  const strip = (lines: string[]) => lines.slice(1, -1).map((l) => l.replace(/^ {4}/, ""));
  if (path[0] === "interfaces" && path[1]) {
    // One interface: its statements only (no wrapper), as Junos prints the hierarchy level.
    const body = strip(ifs);
    const start = body.indexOf(`${path[1]} {`);
    if (start < 0) return "";
    const end = body.findIndex((l, k) => k > start && l === "}");
    return body.slice(start + 1, end).map((l) => l.replace(/^ {4}/, "")).join("\n");
  }
  if (path[0] === "interfaces") return strip(ifs).join("\n");
  if (path[0] === "routing-options") return ro.length ? strip(ro).join("\n") : "";
  if (path[0] === "system") return strip(sys).join("\n");
  return [...sys, ...ifs, ...ro].join("\n");
}
function junosPing(api: RnCliApi, r: RnRouter, ip: string, count: number, source?: string) {
  const run = runOut(api, { type: "ping", from: r, dst: ip, count, source });
  // The reply TTL the model computed for each echo (64 minus the routers that forwarded the reply).
  const ttlOf = new Map([...run.output.matchAll(/icmp_seq=(\d+) ttl=(\d+)/g)].map((m) => [Number(m[1]), m[2]]));
  const lines = run.probes.map((p, k) => (p.kind === "reply" ? `64 bytes from ${ip}: icmp_seq=${k} ttl=${ttlOf.get(k + 1) ?? 64} time=1.${k + 1}00 ms` : p.kind ? `${p.kind === "time-exceeded" ? "36 bytes from" : "92 bytes from"} ${p.from}: ${p.kind === "time-exceeded" ? "Time to live exceeded" : p.kind === "net-unreach" ? "Destination Net Unreachable" : "Destination Host Unreachable"}` : `Request timeout for icmp_seq ${k}`));
  const rx = run.probes.filter((p) => p.kind === "reply").length;
  return { output: [`PING ${ip} (${ip}): 56 data bytes`, ...lines, "", `--- ${ip} ping statistics ---`, `${count} packets transmitted, ${rx} packets received, ${Math.round(((count - rx) / count) * 100)}% packet loss`].join("\n") };
}
function junosOps(api: RnCliApi, r: RnRouter): CliCommand[] {
  const s = api.view;
  const c = s.cfg.r[r];
  const ping = (ip: string, n: number, src?: string) => junosPing(api, r, ip, n, src);
  return [
    { id: "route", syntax: "show route", summary: `${r}'s routing table (active routes)`, run: () => ({ output: junosRoute(s, r, () => true), explanation: "* = the active route for that destination. A static route whose next hop is unusable is hidden: show route hidden. The lookup rule is the longest matching prefix, not the listing order." }) },
    { id: "route", syntax: "show route table inet.0", summary: "", hidden: true, run: () => ({ output: junosRoute(s, r, () => true) }) },
    { id: "route", syntax: "show route protocol static", summary: "Active static routes", run: () => ({ output: junosRoute(s, r, (x) => x.proto === "static") }) },
    { id: "route", syntax: "show route protocol direct", summary: "Connected (direct) routes", run: () => ({ output: junosRoute(s, r, (x) => x.proto === "connected") }) },
    { id: "route", syntax: "show route hidden", summary: "Configured routes that are NOT usable (and why)", run: () => ({ output: junosRoute(s, r, () => true, true), explanation: "Hidden = configured, but its next hop isn't reachable through any active direct route. It is never used for forwarding." }) },
    { id: "route-ip", syntax: "show route <ip>", summary: "The active route that wins for one destination", args: { ip: ipArg(TARGETS, "destination") }, run: ({ ip }) => { const w = rnLookup(s.cfg, r, ip).winner; return { output: w ? junosRoute(s, r, (x) => x.prefix === w.prefix && x.len === w.len && x.proto === w.proto && x.nh === w.nh) : "", explanation: w ? "The longest matching prefix for that address — the route this router really uses." : "No active route contains that address: packets to it are dropped (and an ICMP net unreachable is returned)." }; } },
    { id: "route-p", syntax: "show route <prefix> exact", summary: "One prefix exactly", args: { prefix: prefixArg(["172.16.50.0/24", "172.16.0.0/16", "0.0.0.0/0"]) }, run: ({ prefix }) => ({ output: junosRoute(s, r, (x) => routeKeyOf(x) === `${netOf(prefix.split("/")[0], +prefix.split("/")[1])}/${prefix.split("/")[1]}`) }) },
    { id: "terse", syntax: "show interfaces terse", summary: "Interfaces, addresses, state", run: () => ({ output: columns([["Interface", "Admin", "Link", "Proto", "Local"], ...RN_IFS.flatMap((i) => { const st = rnIfStatus(s.cfg, r, i); const ad = st === "admin-down" ? "down" : "up"; const ln = st === "up" ? "up" : "down"; return [[i, ad, ln, "", ""], [`${i}.0`, ad, ln, "inet", `${c.ifs[i].addr}/${c.ifs[i].len}`]]; })]) }) },
    { id: "int", syntax: "show interfaces <if>", summary: "One interface: state and counters", args: { if: ifArgJunos }, run: ({ if: i }) => { const st = rnIfStatus(s.cfg, r, i as RnIf); const k = s.counters[`${r} ${i}`]; return { output: [`Physical interface: ${i}, ${st === "admin-down" ? "Administratively down" : "Enabled"}, Physical link is ${st === "up" ? "Up" : "Down"}`, `  Current address: ${MAC[`${r}:${i}`]}`, "  Logical interface " + i + ".0", `    Input packets : ${k.in}`, `    Output packets: ${k.out}`, `    Protocol inet, Local: ${c.ifs[i as RnIf].addr}/${c.ifs[i as RnIf].len}`].join("\n") }; } },
    { id: "arp", syntax: "show arp no-resolve", summary: "ARP cache: next-hop IP → MAC", run: () => ({ output: columns([["MAC Address", "Address", "Interface", "Flags"], ...Object.entries(s.arp[r]).filter(([, m]) => m !== "incomplete").map(([ip, mac]) => { const i = RN_IFS.find((x) => netOf(ip, c.ifs[x].len) === netOf(c.ifs[x].addr, c.ifs[x].len)); return [mac, ip, i ? `${i}.0` : "", "none"]; })]) + `\nTotal entries: ${Object.values(s.arp[r]).filter((m) => m !== "incomplete").length}`, explanation: "Only resolved neighbors appear. An address this router keeps asking for without an answer never shows up here." }) },
    { id: "arp", syntax: "show arp", summary: "", hidden: true, run: () => ({ output: Object.entries(s.arp[r]).filter(([, m]) => m !== "incomplete").map(([ip, mac]) => `${mac} ${ip} ${ip}`).join("\n") }) },
    { id: "ping", syntax: "ping <ip> count <n>", summary: "Ping from this router", args: { ip: ipArg(TARGETS, "destination"), n: { choices: ["3", "5"], describe: () => "how many", resolve: (raw) => (/^\d+$/.test(raw) && +raw >= 1 && +raw <= 10 ? raw : undefined) } }, run: ({ ip, n }) => ping(ip, +n) },
    { id: "ping", syntax: "ping <ip> count <n> source <src>", summary: "Ping with a chosen source address", args: { ip: ipArg(TARGETS, "destination"), n: { choices: ["3", "5"], resolve: (raw) => (/^\d+$/.test(raw) && +raw >= 1 && +raw <= 10 ? raw : undefined) }, src: ipArg(RN_IFS.map((i) => c.ifs[i].addr), "one of this router's addresses") }, run: ({ ip, n, src }) => (RN_IFS.some((i) => c.ifs[i].addr === src) ? ping(ip, +n, src) : refuse("ping: can't assign requested address")) },
    { id: "ping", syntax: "ping <ip>", summary: "Ping (Junos pings until Ctrl+C; the lab stops after 5)", args: { ip: ipArg(TARGETS, "destination") }, run: ({ ip }) => ({ ...ping(ip, 5), explanation: "A real Junos ping runs until you press Ctrl+C. Use count <n> to choose." }) },
    { id: "trace", syntax: "traceroute <ip>", summary: "Every router on the way", args: { ip: ipArg(TARGETS, "destination") }, run: ({ ip }) => { const run = runOut(api, { type: "traceroute", from: r, dst: ip }); return { output: [`traceroute to ${ip} (${ip}), 30 hops max, 40 byte packets`, ...run.probes.map((p) => ` ${p.ttl}  ${p.from ? `${p.from} (${p.from})  1.${p.ttl}23 ms${p.kind === "net-unreach" ? " !N" : p.kind === "host-unreach" ? " !H" : ""}` : "* * *"}`)].join("\n") }; } },
    { id: "cfg", syntax: "show configuration", summary: `${r}'s committed configuration`, run: () => ({ output: rnJunosText(r, c), explanation: "Try | display set, or show configuration routing-options." }) },
    { id: "cfg", syntax: "show configuration routing-options", summary: "Static routes (configured)", run: () => (c.statics.length ? { output: rnJunosText(r, c, ["routing-options"]) } : { output: "", explanation: `No static route is configured on ${r}: only its connected (Direct) networks are in the table.` }) },
    { id: "cfg", syntax: "show configuration interfaces", summary: "Interfaces (configured)", run: () => ({ output: rnJunosText(r, c, ["interfaces"]) }) },
    { id: "cfg", syntax: "show configuration interfaces <if>", summary: "One interface (configured)", args: { if: ifArgJunos }, run: ({ if: i }) => ({ output: rnJunosText(r, c, ["interfaces", i]) }) },
    { id: "clear-arp", syntax: "clear arp", summary: "Forget learned ARP entries", run: () => (api.act({ type: "clear-arp", dev: r }), { output: "" }) },
  ];
}
function junosSet(api: RnCliApi, r: RnRouter): CliCommandSet {
  const s = api.view;
  const active = s.cfg.r[r];
  const cand = api.cand[r];
  const base = { vendor: "juniper" as const, deviceId: r, deviceName: r };
  const ops = junosOps(api, r);
  const dirty = JSON.stringify(cand) !== JSON.stringify(active);
  if (!api.junosEdit[r]) return { ...base, prompt: `admin@${r}> `, commands: [...ops, histCmd(api, "show cli history", false), { id: "conf", syntax: "configure", summary: "Enter configuration mode (the candidate configuration)", run: () => (!dirty && api.setCand(r, rnClone(active)), api.setJunosEdit(r, true), { output: dirty ? "Entering configuration mode\nThe configuration has been changed but not committed\n" : "Entering configuration mode\n", explanation: "Changes go into the candidate: the router keeps forwarding with the committed configuration until you commit." }) }] };
  const set = (c: RnRouterCfg) => api.setCand(r, c);
  const normalize = (p: string) => {
    const [ip, l] = p.split("/");
    return { prefix: netOf(ip, +l), len: +l };
  };
  const putRoute = (p: string, x: Omit<RnStatic, "prefix" | "len">) => {
    const n = normalize(p);
    const key = `${n.prefix}/${n.len}`;
    const same = cand.statics.find((y) => staticKey(y) === key);
    if (same && !x.discard && same.nh && same.nh !== x.nh) return refuse("error: this lab does not model two next hops for one prefix", `delete routing-options static route ${key} first.`);
    set({ ...cand, statics: [...cand.statics.filter((y) => staticKey(y) !== key), { ...n, ...x }] });
    return { output: "" };
  };
  const commit = (quit?: boolean) => {
    const after = setRouter(api, r, cand, "Junos commit");
    if (quit) api.setJunosEdit(r, false);
    const hidden = rnRib(after.cfg, r).filter((x) => x.proto === "static" && !x.active);
    return { output: quit ? "commit complete\nExiting configuration mode" : "commit complete", explanation: hidden.length ? `Committed — ${hidden.map(routeKeyOf).join(", ")} ${hidden.length > 1 ? "are" : "is"} hidden (unusable next hop): show route hidden.` : "Active now. Prove it with traffic." };
  };
  const cmds: CliCommand[] = [
    { id: "set-route", syntax: "set routing-options static route <prefix> next-hop <nh>", summary: "Static route: prefix and next hop (candidate)", args: { prefix: prefixArg(["172.16.50.0/24", "172.16.60.0/24", "10.10.10.0/24", "0.0.0.0/0"]), nh: ipArg(["10.0.12.1", "10.0.12.2", "10.0.13.1", "10.0.13.2", "10.0.23.1", "10.0.23.2"], "next hop") }, run: ({ prefix, nh }) => putRoute(prefix, { nh }) },
    { id: "set-route", syntax: "set routing-options static route <prefix> discard", summary: "Discard route: drop matching packets silently (candidate)", args: { prefix: prefixArg(["172.16.50.0/25"]) }, run: ({ prefix }) => putRoute(prefix, { discard: true }) },
    { id: "del-route", syntax: "delete routing-options static route <prefix>", summary: "Remove a static route (candidate)", args: { prefix: prefixArg(cand.statics.map(staticKey)) }, run: ({ prefix }) => { const n = normalize(prefix); const key = `${n.prefix}/${n.len}`; if (!cand.statics.some((y) => staticKey(y) === key)) return refuse("warning: statement not found"); set({ ...cand, statics: cand.statics.filter((y) => staticKey(y) !== key) }); return { output: "" }; } },
    { id: "del-route", syntax: "delete routing-options static", summary: "Remove every static route (candidate)", run: () => (set({ ...cand, statics: [] }), { output: "" }) },
    { id: "set-dis", syntax: "set interfaces <if> disable", summary: "Disable an interface (candidate)", args: { if: ifArgJunos }, run: ({ if: i }) => (set({ ...cand, ifs: { ...cand.ifs, [i]: { ...cand.ifs[i as RnIf], shut: true } } }), { output: "" }) },
    { id: "del-dis", syntax: "delete interfaces <if> disable", summary: "Enable an interface again (candidate)", args: { if: ifArgJunos }, run: ({ if: i }) => (cand.ifs[i as RnIf].shut ? (set({ ...cand, ifs: { ...cand.ifs, [i]: { ...cand.ifs[i as RnIf], shut: false } } }), { output: "" }) : refuse("warning: statement not found")) },
    { id: "show", syntax: "show", summary: "The candidate configuration (try show | compare)", run: () => ({ output: rnJunosText(r, cand) }) },
    { id: "show", syntax: "show interfaces <if>", summary: "One interface in the candidate", args: { if: ifArgJunos }, run: ({ if: i }) => ({ output: rnJunosText(r, cand, ["interfaces", i]) }) },
    { id: "show", syntax: "show routing-options", summary: "Candidate static routes", run: () => (cand.statics.length ? { output: rnJunosText(r, cand, ["routing-options"]) } : { output: "", explanation: "No static route in the candidate: after commit, only connected (Direct) networks would remain." }) },
    { id: "show", syntax: "show interfaces", summary: "Candidate interfaces", run: () => ({ output: rnJunosText(r, cand, ["interfaces"]) }) },
    { id: "commit", syntax: "commit", summary: "Activate the candidate", run: () => commit() },
    { id: "commit", syntax: "commit check", summary: "Validate without activating", run: () => ({ output: "configuration check succeeds", explanation: "Valid syntax. Whether a route is USABLE (reachable next hop) is only known once it is active: commit, then show route / show route hidden." }) },
    { id: "commit", syntax: "commit and-quit", summary: "Commit, then leave configuration mode", run: () => commit(true) },
    { id: "rollback", syntax: "rollback", summary: "Discard uncommitted changes (rollback 0)", run: () => (set(rnClone(active)), { output: "load complete" }) },
    { id: "rollback", syntax: "rollback 0", summary: "", hidden: true, run: () => (set(rnClone(active)), { output: "load complete" }) },
    ...ops.map((x) => ({ ...x, id: `run:${x.id}`, syntax: `run ${x.syntax}`, hidden: true })),
    { id: "proto", syntax: "set protocols <rest>", summary: "", hidden: true, args: { rest: { choices: [], resolve: (raw) => raw } }, run: () => refuse("error: not in this lab — routing protocols come in later lessons; every remote route here is static") },
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
  ];
  return { ...base, prompt: `admin@${r}# `, commands: cmds };
}

// ---------------------------------------------------------------------------------------------------------------
// Linux hosts
// ---------------------------------------------------------------------------------------------------------------
function hostSet(api: RnCliApi, h: RnHost): CliCommandSet {
  const s = api.view;
  const c = s.cfg.h[h];
  const targets = [...TARGETS.filter((x) => x !== c.ip), "10.10.10.1", "172.16.50.1", "172.16.60.1"];
  const cmds: CliCommand[] = [
    { id: "ping", syntax: "ping -c <n> <ip>", summary: "Ping: is there a path there AND back?", args: { n: { choices: ["3", "1"], resolve: (raw) => (/^\d+$/.test(raw) && +raw >= 1 && +raw <= 10 ? raw : undefined) }, ip: ipArg(targets, "destination") }, run: ({ n, ip }) => { const run = runOut(api, { type: "ping", from: h, dst: ip, count: +n }); return { output: run.output, explanation: run.ok ? undefined : run.probes[0]?.arrived ? "The Echo Request ARRIVED — the reply never made it back. Find the router on the return path that has no usable route." : run.probes[0]?.kind ? "A router answered with an ICMP error: it names who dropped the packet and why." : "No answer at all: dropped silently (a discard route?) — or the reply was lost. Watch where it stopped." }; } },
    { id: "ping", syntax: "ping <ip>", summary: "", hidden: true, args: { ip: ipArg(targets) }, run: ({ ip }) => ({ output: runOut(api, { type: "ping", from: h, dst: ip, count: 3 }).output, explanation: "(The lab sends 3, as if you pressed Ctrl+C.)" }) },
    { id: "trace", syntax: "traceroute <ip>", summary: "Every router on the way (TTL 1, 2, 3 …)", args: { ip: ipArg(targets, "destination") }, run: ({ ip }) => ({ output: runOut(api, { type: "traceroute", from: h, dst: ip }).output, explanation: "Each line is a router that sent Time Exceeded for a probe whose TTL ran out there. It shows the path the REQUESTS take — not the replies." }) },
    { id: "iproute", syntax: "ip route", summary: "This host's routes", run: () => ({ output: `default via ${c.gw} dev eth0\n${netOf(c.ip, c.len)}/${c.len} dev eth0 proto kernel scope link src ${c.ip}`, explanation: "A host routes too, simply: its own network directly, everything else to its default gateway. The gateway's routers do the real routing." }) },
    { id: "ipaddr", syntax: "ip addr", summary: "This host's address", run: () => ({ output: `2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 state ${c.up ? "UP" : "DOWN"}\n    link/ether ${MAC[h]}\n    inet ${c.ip}/${c.len} scope global eth0` }) },
    { id: "neigh", syntax: "ip neigh", summary: "ARP cache", run: () => ({ output: Object.entries(s.arp[h]).map(([ip, mac]) => (mac === "incomplete" ? `${ip} dev eth0 FAILED` : `${ip} dev eth0 lladdr ${mac} REACHABLE`)).join("\n") || "(empty)" }) },
  ];
  return { vendor: "cisco", deviceId: h, deviceName: h.toLowerCase(), prompt: `admin@${h.toLowerCase()}:~$ `, commands: [...cmds, histCmd(api, "history", true)] };
}

export function rnRouterSets(api: RnCliApi, r: RnRouter): Partial<Record<CliVendor, CliCommandSet>> {
  // A router answers its own addresses — only on interfaces that are up.
  const own = Object.values(api.view.cfg.r[r].ifs).filter((x) => !x.shut).map((x) => x.addr);
  return { cisco: withSelfPing(iosSet(api, r), "ios", own), juniper: withSelfPing(junosSet(api, r), "junos", own) };
}
export const rnHostSet = (api: RnCliApi, h: RnHost) => withSelfPing(hostSet(api, h), "linux", [api.view.cfg.h[h].ip]);
export const rnJunosConfig = (api: Pick<RnCliApi, "view">, r: RnRouter) => (which: "committed" | number, path: string[]) => (which === "committed" || which === 0 ? rnJunosText(r, api.view.cfg.r[r], path) : undefined);
export { ipNum, isRouter, rnOwner };
