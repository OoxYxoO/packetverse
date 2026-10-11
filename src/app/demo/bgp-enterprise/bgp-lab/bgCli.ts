import type { CliArgSpec, CliCommand, CliCommandSet, CliResult, CliVendor } from "@/lib/cli/types";
import { columns } from "@/lib/cli/format";
import type { CliQuestion } from "@/app/demo/dhcp-dns/dhcp-lab/dhcpBuildCli";
import { withSelfPing } from "@/lib/cli/selfPing";
import { withShellHistory } from "@/lib/cli/shellHistory";
import { ASN, BG_HOSTS, HOST_IP, LAN, LINK_ENDS, RID, ROUTER_OF, SESSIONS, advKey, bgClone, bgLookup, isIp, sessAddr, sessionBetween, sessionsOf, type BgAction, type BgHost, type BgLink, type BgNbrCfg, type BgNet, type BgPath, type BgRouter, type BgRouterCfg, type BgSession } from "@/lib/sim-engine/scenarios/bgpNet";
import { ifOf, ifOfAddr } from "./bgNames";

/**
 * Command lines of the BGP Lab. R1 and R2 are ours: Cisco IOS or Junos, full configuration. R3–R5 belong to the ISPs
 * and AS65030: a read-only looking glass. Hosts: a Linux shell. Every output is printed from the lab state (sessions,
 * paths with their best-path reasons, advertisements, routing tables, the log); every change goes through a lab
 * action (IOS on Enter; Junos on commit). Route-maps / policies and the prefix-list are fixed objects of the lab:
 * you attach or detach them, you don't edit them.
 *
 *   IOS    show ip bgp summary · show ip bgp [<prefix>] · show ip bgp neighbors <ip> [advertised-routes | routes] ·
 *          show ip route [bgp] · show route-map · show ip prefix-list · show running-config · show logging · ping ·
 *          traceroute · configure terminal → router bgp 65001 → neighbor <ip> remote-as | next-hop-self | route-map
 *          LP200 in | route-map PREPEND out | prefix-list OWN out | shutdown
 *   Junos  show bgp summary · show bgp neighbor <ip> · show route [protocol bgp] [<prefix> detail] · show route
 *          advertising-protocol | receive-protocol bgp <ip> · show configuration protocols bgp | policy-options ·
 *          configure → set protocols bgp group <g> neighbor <ip> peer-as <n> · set/delete protocols bgp group <g>
 *          import LP200 | export OWN-ONLY | PREPEND | NHS → commit
 */
export type BgIosMode = { kind: "exec" } | { kind: "config" } | { kind: "bgp" };
export type BgCand = Record<"R1" | "R2", BgRouterCfg>;
export interface BgCliApi {
  view: BgNet;
  act: (a: BgAction) => BgNet;
  ios: Record<"R1" | "R2", BgIosMode>;
  setIos: (d: "R1" | "R2", m: BgIosMode) => void;
  junosEdit: Record<"R1" | "R2", boolean>;
  setJunosEdit: (d: "R1" | "R2", b: boolean) => void;
  cand: BgCand;
  setCand: (c: BgCand) => void;
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
const lenToMask = (len: number) => [0, 8, 16, 24].map((o) => Math.max(0, Math.min(8, len - o))).map((b) => 256 - 2 ** (8 - b)).join(".");
const classful = (prefix: string) => {
  const [net, len] = prefix.split("/");
  const a = +net.split(".")[0];
  const def = a < 128 ? 8 : a < 192 ? 16 : 24;
  return +len === def ? net : prefix;
};
const peerName = (ip: string) => {
  for (const s of Object.keys(SESSIONS) as BgSession[]) for (const r of [SESSIONS[s].a, SESSIONS[s].b]) if (sessAddr(s, r).mine === ip) return `${r} (AS${ASN[r]})`;
  return ip;
};
const nbrArg = (r: BgRouter): CliArgSpec => ({ choices: sessionsOf(r).map((s) => sessAddr(s, r).peer), describe: (ip) => peerName(ip), resolve: (raw) => (isIp(raw) ? raw : undefined) });
const prefixArg = (s: BgNet, r: BgRouter): CliArgSpec => ({ choices: [...new Set(s.view.paths[r].map((p) => p.prefix))], resolve: (raw) => { if (/^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/.test(raw) && isIp(raw.split("/")[0])) { const hit = s.view.paths[r].find((p) => p.prefix === raw || p.prefix.split("/")[0] === raw); return hit ? hit.prefix : raw; } return undefined; } });
const ipArg = (): CliArgSpec => ({ choices: [HOST_IP.SRV, HOST_IP.H1, HOST_IP.H2], describe: (c) => BG_HOSTS.find((h) => HOST_IP[h] === c), resolve: (raw) => (isIp(raw) ? raw : undefined) });
const GROUP: Record<BgSession, Partial<Record<BgRouter, string>>> = { "R1-R3": { R1: "ISP-A" }, "R2-R4": { R2: "ISP-B" }, "R1-R2": { R1: "INTERNAL", R2: "INTERNAL" }, "R3-R5": {}, "R4-R5": {} };
const OWN_PREFIXES = [LAN.R1.prefix, LAN.R2.prefix];
/** A fixed policy name as an argument (parser keywords are lowercase; the names stay as configured). */
const nameArg = (name: string, what: string): CliArgSpec => ({ choices: [name], describe: () => what, resolve: (raw) => (raw.toUpperCase() === name ? name : undefined) });
const LP = { map: nameArg("LP200", "route-map: set local-preference 200") };
const PP = { map: nameArg("PREPEND", "route-map: prepend 65001 65001") };
const PL = { list: nameArg("OWN", "prefix-list: our own /26s") };

// ---------------------------------------------------------------------------------------------------------------
// Shared show outputs (Cisco style, also used by the ISP looking glasses)
// ---------------------------------------------------------------------------------------------------------------
function iosBgpTable(s: BgNet, r: BgRouter): string {
  const rows = [...s.view.paths[r]].sort((a, b) => a.prefix.localeCompare(b.prefix) || (a.best ? -1 : 1));
  let last = "";
  const lines = rows.map((p) => {
    const code = `${p.valid ? "*" : " "}${p.best ? ">" : " "}${p.type === "iBGP" ? "i" : " "}`;
    const net = p.prefix === last ? "" : classful(p.prefix);
    last = p.prefix;
    const lp = p.type === "iBGP" || p.localPref !== 100 ? String(p.localPref) : "";
    return [` ${code}`, net, p.nextHop, "0", lp, p.type === "local" ? "32768" : "0", `${p.asPath.join(" ")}${p.asPath.length ? " " : ""}i`];
  });
  return [`BGP table version is ${8 + s.cfgSeq}, local router ID is ${RID[r]}`, "Status codes: s suppressed, d damped, h history, * valid, > best, i - internal,", "              r RIB-failure, S Stale, m multipath, b backup-path, f RT-Filter,", "              x best-external, a additional-path, c RIB-compressed,", "Origin codes: i - IGP, e - EGP, ? - incomplete", "RPKI validation codes: V valid, I invalid, N Not found", "", columns([["     ", "Network", "Next Hop", "Metric", "LocPrf", "Weight", "Path"], ...lines], [5, 17, 20, 7, 7, 7])].join("\n");
}
function iosBgpPrefix(s: BgNet, r: BgRouter, prefix: string): CliResult {
  const ps = s.view.paths[r].filter((p) => p.prefix === prefix);
  if (!ps.length) return refuse("% Network not in table", `${r} has no path for ${prefix}.`);
  const bestIdx = ps.findIndex((p) => p.best);
  const body = ps.flatMap((p) => [
    "  Refresh Epoch 1",
    `  ${p.asPath.length ? p.asPath.join(" ") : "Local"}`,
    `    ${p.nextHop}${p.valid ? "" : " (inaccessible)"} from ${p.from === "local" ? "0.0.0.0" : sessAddr(p.sess!, p.from as BgRouter).mine} (${p.from === "local" ? RID[r] : RID[p.from as BgRouter]})`,
    `      Origin IGP, metric 0, localpref ${p.localPref},${p.type === "local" ? " weight 32768," : ""}${p.valid ? " valid," : ""} ${p.type === "local" ? "sourced, local" : p.type === "iBGP" ? "internal" : "external"}${p.best ? ", best" : ""}`,
  ]);
  const best = ps.find((p) => p.best);
  return { output: [`BGP routing table entry for ${prefix}, version ${7 + s.cfgSeq}`, `Paths: (${ps.length} available${bestIdx >= 0 ? `, best #${bestIdx + 1}` : ", no best path"}, table default)`, ...body].join("\n"), explanation: best ? `Best: ${best.from === "local" ? "originated here" : `via ${best.from}`} — ${best.reason}.${ps.some((p) => !p.valid) ? ` (inaccessible) = the next hop isn't reachable: that path is ignored.` : ""}` : "No usable path: every path's next hop is inaccessible." };
}
/** A router's interfaces: its LAN (if it has one) and its links, with their state. */
function ifList(s: BgNet, r: BgRouter): { name: (v: CliVendor) => string; addr: string; up: boolean }[] {
  const links = (Object.keys(LINK_ENDS) as BgLink[]).filter((l) => LINK_ENDS[l][0] === r || LINK_ENDS[l][2] === r);
  return [
    ...(r in LAN ? [{ name: (v: CliVendor) => ifOf(r, "lan", v, v === "cisco"), addr: LAN[r as "R1"].gw, up: true }] : []),
    ...links.map((l) => ({ name: (v: CliVendor) => ifOf(r, l, v, v === "cisco"), addr: LINK_ENDS[l][0] === r ? LINK_ENDS[l][1] : LINK_ENDS[l][3], up: s.cfg.links[l] })),
  ].sort((a, b) => a.name("juniper").localeCompare(b.name("juniper")));
}
function iosRoute(s: BgNet, r: BgRouter, onlyBgp = false): string {
  const rows = s.view.rib[r].filter((x) => !onlyBgp || x.proto === "B").sort((a, b) => a.prefix.localeCompare(b.prefix));
  return ["Codes: L - local, C - connected, S - static, B - BGP", "", "Gateway of last resort is not set", "", ...rows.map((x) => (x.proto === "B" ? `B        ${x.prefix} [${x.ad}/0] via ${x.nh}, 00:15:40` : `${x.proto.padEnd(9)}${x.prefix} is directly connected, ${ifOfAddr(r, x.via, "cisco", true)}`))].join("\n");
}
const srcHint = (r: BgNet["runs"][number]["results"][number]) => (r.replied || !/no route to/.test(r.fail ?? "") || /^(H|S)/.test(r.send.from) ? r.fail : `${r.fail} — this router used its own link address as the source, and nobody announces that /30. From a host (H1 or H2 → SRV) the test uses an address the internet knows.`);
function pingOut(ns: BgNet, ip: string, cisco: boolean): CliResult {
  const r = ns.last!.results[0];
  if (cisco) return { output: ["Type escape sequence to abort.", `Sending 5, 100-byte ICMP Echos to ${ip}, timeout is 2 seconds:`, r.replied ? "!!!!!" : ".....", `Success rate is ${r.replied ? 100 : 0} percent (${r.replied ? 5 : 0}/5)${r.replied ? ", round-trip min/avg/max = 2/3/6 ms" : ""}`].join("\n"), explanation: r.replied ? `There: ${r.path.join(" → ")} · back: ${r.backPath?.join(" → ")}.` : srcHint(r) };
  return { output: [`PING ${ip} (${ip}): 56 data bytes`, ...(r.replied ? [0, 1, 2].map((i) => `64 bytes from ${ip}: icmp_seq=${i} ttl=61 time=2.${i}71 ms`) : []), "", `--- ${ip} ping statistics ---`, `3 packets transmitted, ${r.replied ? 3 : 0} packets received, ${r.replied ? 0 : 100}% packet loss`].join("\n"), explanation: r.replied ? `There: ${r.path.join(" → ")} · back: ${r.backPath?.join(" → ")}.` : srcHint(r) };
}
function traceOut(ns: BgNet, ip: string, cisco: boolean): CliResult {
  const rows = ns.last!.results[0].trace ?? [];
  if (cisco) return { output: ["Type escape sequence to abort.", `Tracing the route to ${ip}`, "VRF info: (vrf in name/id, vrf out name/id)", ...rows.map((t) => `  ${t.hop} ${t.ip === "*" ? "*  *  *" : `${t.ip} ${t.hop + 1} msec ${t.hop + 2} msec ${t.hop + 1} msec`}`)].join("\n"), explanation: `Path: ${ns.last!.results[0].path.join(" → ")}.` };
  return { output: [`traceroute to ${ip} (${ip}), 30 hops max, 52 byte packets`, ...rows.map((t) => ` ${t.hop}  ${t.ip === "*" ? "* * *" : `${t.ip}  ${t.hop}.${t.hop}12 ms  ${t.hop}.${t.hop}48 ms  ${t.hop}.${t.hop}01 ms`}`)].join("\n"), explanation: `Path: ${ns.last!.results[0].path.join(" → ")}.` };
}

// ---------------------------------------------------------------------------------------------------------------
// Cisco IOS (R1, R2)
// ---------------------------------------------------------------------------------------------------------------
function iosExec(api: BgCliApi, r: "R1" | "R2"): CliCommand[] {
  const s = api.view;
  const c = s.cfg.r[r];
  const sess = sessionsOf(r);
  return [
    {
      id: "sum",
      syntax: "show ip bgp summary",
      summary: "BGP neighbors: AS, state, prefixes received",
      run: () => ({
        output: [`BGP router identifier ${RID[r]}, local AS number ${ASN[r]}`, `BGP table version is ${8 + s.cfgSeq}, main routing table version ${8 + s.cfgSeq}`, `${new Set(s.view.paths[r].map((p) => p.prefix)).size} network entries using ${new Set(s.view.paths[r].map((p) => p.prefix)).size * 248} bytes of memory`, "", columns([["Neighbor", "V", "AS", "MsgRcvd", "MsgSent", "TblVer", "InQ", "OutQ", "Up/Down", "State/PfxRcd"], ...sess.map((x) => { const st = s.view.sess[x]; const { peer, peerRouter } = sessAddr(x, r); const rcvd = s.view.paths[r].filter((p) => p.sess === x).length; return [peer, "4", String(c.nbrs[x]!.remoteAs), "23", "25", String(8 + s.cfgSeq), "0", "0", st.state === "Established" ? "00:15:40" : "never", st.state === "Established" ? String(rcvd) : st.state === "Idle (Admin)" ? "Idle (Admin)" : st.state]; void peerRouter; })], [16, 2, 8, 8, 8, 7, 4, 5, 9])].join("\n"),
        explanation: "A number in State/PfxRcd = Established, with that many prefixes received. “Active” = this router keeps trying but the session never comes up (check the remote AS and the OPEN errors in show logging).",
      }),
    },
    { id: "tbl", syntax: "show ip bgp", summary: "The BGP table: every path, the best marked >", run: () => ({ output: iosBgpTable(s, r), explanation: "*> = valid and best (installed). i = learned over iBGP. No * = not valid (inaccessible next hop). LocPrf and Path decide most choices." }) },
    { id: "pfx", syntax: "show ip bgp <prefix>", summary: "Every path for one prefix, and which is best", args: { prefix: prefixArg(s, r) }, run: ({ prefix }) => iosBgpPrefix(s, r, prefix) },
    {
      id: "nbr",
      syntax: "show ip bgp neighbors <ip>",
      summary: "One neighbor: AS, state, last error",
      args: { ip: nbrArg(r) },
      run: ({ ip }) => {
        const x = sessionBetween(r, ip);
        if (!x) return refuse(`% No such neighbor or address family`);
        const st = s.view.sess[x];
        const { peerRouter } = sessAddr(x, r);
        return { output: [`BGP neighbor is ${ip},  remote AS ${c.nbrs[x]!.remoteAs}, ${SESSIONS[x].type === "iBGP" ? "internal" : "external"} link`, `  BGP version 4, remote router ID ${st.state === "Established" ? RID[peerRouter] : "0.0.0.0"}`, `  BGP state = ${st.state}${st.state === "Established" ? ", up for 00:15:40" : ""}`, ...(st.state !== "Established" ? [`  Last reset never${/bad peer AS/.test(st.why ?? "") ? ", due to BGP Notification sent, peer in wrong AS" : st.why ? `, ${st.why}` : ""}`] : []), `  Neighbor capabilities: Route refresh: advertised and received(new)`].join("\n"), explanation: st.why };
      },
    },
    { id: "adv", syntax: "show ip bgp neighbors <ip> advertised-routes", summary: "What this router sends to a neighbor", args: { ip: nbrArg(r) }, run: ({ ip }) => { const x = sessionBetween(r, ip); if (!x) return refuse("% No such neighbor"); const list = s.view.adv[advKey(r, sessAddr(x, r).peerRouter)] ?? []; return { output: list.length ? [columns([["     Network", "Next Hop", "Metric", "LocPrf", "Weight", "Path"], ...list.map((p) => [` *>  ${classful(p.prefix)}`, p.nextHop, "0", SESSIONS[x].type === "iBGP" ? String(p.localPref) : "", "0", `${p.asPath.join(" ")}${p.asPath.length ? " " : ""}i`])], [22, 18, 7, 7, 7]), "", `Total number of prefixes ${list.length}`].join("\n") : "", explanation: list.length ? (SESSIONS[x].type === "eBGP" ? "What the ISP receives from us — prepending is visible in Path (our own AS repeated). Only our own prefixes should be here." : "What the other enterprise router receives over iBGP (next hop: us, if next-hop-self).") : "Nothing is advertised to this neighbor (session down, or nothing passes the outbound policy)." }; } },
    { id: "rcv", syntax: "show ip bgp neighbors <ip> routes", summary: "What this router accepted from a neighbor", args: { ip: nbrArg(r) }, run: ({ ip }) => { const x = sessionBetween(r, ip); if (!x) return refuse("% No such neighbor"); const list = s.view.paths[r].filter((p) => p.sess === x); return { output: list.length ? columns([["     Network", "Next Hop", "Metric", "LocPrf", "Weight", "Path"], ...list.map((p) => [` ${p.valid ? "*" : " "}${p.best ? ">" : " "}${p.type === "iBGP" ? "i" : " "} ${classful(p.prefix)}`, p.nextHop, "0", String(p.localPref), "0", `${p.asPath.join(" ")} i`])], [22, 18, 7, 7, 7]) : "", explanation: list.length ? "LocPrf shows the inbound policy at work (LP200 on routes from ISP-A)." : "Nothing accepted from this neighbor." }; } },
    { id: "route", syntax: "show ip route", summary: "The routing table", run: () => ({ output: iosRoute(s, r), explanation: "B [20/0] = eBGP (distance 20), B [200/0] = iBGP (distance 200). Only BEST, valid BGP paths are installed." }) },
    { id: "route", syntax: "show ip route bgp", summary: "Only BGP routes", run: () => ({ output: iosRoute(s, r, true) }) },
    { id: "brief", syntax: "show ip interface brief", summary: "Interfaces, addresses, link state", run: () => ({ output: columns([["Interface", "IP-Address", "OK?", "Method", "Status", "Protocol"], ...ifList(s, r).map((i) => [i.name("cisco"), i.addr, "YES", "NVRAM", i.up ? "up" : "down", i.up ? "up" : "down"])], [21, 16, 4, 7, 22]) }) },
    {
      id: "route",
      syntax: "show ip route <ip>",
      summary: "The route this router uses for one address",
      args: { ip: { choices: [HOST_IP.SRV, HOST_IP.H1], describe: () => "an IPv4 address", resolve: (raw: string) => (isIp(raw) ? raw : undefined) } },
      run: ({ ip }) => {
        const x = bgLookup(s.view, r, ip);
        if (!x) return { output: "% Network not in table", explanation: "No route covers this address: packets to it are dropped here." };
        if (x.proto !== "B" || !x.path) return { output: [`Routing entry for ${x.prefix}`, `  Known via "connected", distance 0, metric 0 (connected, via interface)`, "  Routing Descriptor Blocks:", `  * directly connected, via ${ifOfAddr(r, x.via, "cisco")}`, "      Route metric is 0, traffic share count is 1"].join("\n") };
        const ext = x.path.type === "eBGP";
        return {
          output: [`Routing entry for ${x.prefix}`, `  Known via "bgp 65001", distance ${x.ad}, metric 0${ext ? `\n  Tag ${x.path.asPath[0]}, type external` : ", type internal"}`, `  Last update from ${x.nh} 00:15:40 ago`, "  Routing Descriptor Blocks:", `  * ${x.nh}, from ${x.nh}, 00:15:40 ago`, `      Route metric is 0, traffic share count is 1`, `      AS Hops ${x.path.asPath.length}`, ...(ext ? [`      Route tag ${x.path.asPath[0]}`] : [])].join("\n"),
          explanation: `The routing table, not BGP, forwards packets: this is the one BGP path that won (${ext ? "eBGP, distance 20" : "iBGP, distance 200"}).`,
        };
      },
    },
    { id: "rm", syntax: "show route-map", summary: "The lab's route-maps (fixed)", run: () => ({ output: ["route-map LP200, permit, sequence 10", "  Match clauses:", "  Set clauses:", "    local-preference 200", "  Policy routing matches: 0 packets, 0 bytes", "route-map PREPEND, permit, sequence 10", "  Match clauses:", "  Set clauses:", "    as-path prepend 65001 65001", "  Policy routing matches: 0 packets, 0 bytes"].join("\n"), explanation: "LP200 (inbound): prefer what we learn from that neighbor. PREPEND (outbound): make our routes look longer to that ISP, so the internet prefers the other one." }) },
    { id: "pl", syntax: "show ip prefix-list", summary: "The lab's prefix-list (fixed)", run: () => ({ output: [`ip prefix-list OWN: ${OWN_PREFIXES.length} entries`, ...OWN_PREFIXES.map((p, i) => `   seq ${5 * (i + 1)} permit ${p}`)].join("\n"), explanation: "Applied outbound to an ISP, it lets only our own prefixes out — anything else (such as routes from the other ISP) is denied: no transit." }) },
    {
      id: "run",
      syntax: "show running-config",
      summary: `${r}'s configuration`,
      run: () => {
        const lines = [`hostname ${r}`, "!", "router bgp 65001", ` bgp router-id ${RID[r]}`, " bgp log-neighbor-changes", ...sess.map((x) => ` neighbor ${sessAddr(x, r).peer} remote-as ${c.nbrs[x]!.remoteAs}`), ...sess.filter((x) => c.nbrs[x]!.shut).map((x) => ` neighbor ${sessAddr(x, r).peer} shutdown`), ...c.networks.map((p) => ` network ${p.split("/")[0]} mask ${lenToMask(+p.split("/")[1])}`), ...sess.flatMap((x) => { const n = c.nbrs[x]!; const ip = sessAddr(x, r).peer; return [...(n.nhs ? [` neighbor ${ip} next-hop-self`] : []), ...(n.lpIn ? [` neighbor ${ip} route-map LP200 in`] : []), ...(n.prepend ? [` neighbor ${ip} route-map PREPEND out`] : []), ...(n.ownOnly ? [` neighbor ${ip} prefix-list OWN out`] : [])]; }), "!", ...OWN_PREFIXES.map((p, i) => `ip prefix-list OWN seq ${5 * (i + 1)} permit ${p}`), "!", "route-map LP200 permit 10", " set local-preference 200", "!", "route-map PREPEND permit 10", " set as-path prepend 65001 65001", "!", "end"];
        return { output: `Building configuration...\n\nCurrent configuration : ${lines.join("\n").length} bytes\n!\n${lines.join("\n")}` };
      },
    },
    {
      id: "log",
      syntax: "show logging",
      summary: "The log: neighbors up and down, notifications",
      run: () => {
        const l = s.syslog.filter((x) => x.r === r).slice(-40).map((x) => {
          const t = stamp(x.clock).ios;
          if (x.ev === "up") return `${t}: %BGP-5-ADJCHANGE: neighbor ${x.peer} Up`;
          if (x.ev === "down") return `${t}: %BGP-5-ADJCHANGE: neighbor ${x.peer} Down ${/link/.test(x.text ?? "") ? "Interface flap" : /shut/.test(x.text ?? "") ? "Admin. shutdown" : "BGP Notification sent"}`;
          const sx = sessionBetween(r, x.peer)!;
          return `${t}: %BGP-3-NOTIFICATION: sent to neighbor ${x.peer} active 2/2 (peer in wrong AS) 2 bytes ${ASN[sessAddr(sx, r).peerRouter].toString(16).toUpperCase()}`;
        });
        // IOS logs a NOTIFICATION on every connection attempt for as long as the remote AS is wrong: show the latest one.
        const wrong = sess.filter((x) => s.view.sess[x].state !== "Established" && c.nbrs[x] && c.nbrs[x]!.remoteAs !== ASN[sessAddr(x, r).peerRouter] && !c.nbrs[x]!.shut);
        for (const x of wrong) {
          const line = `${stamp(s.clock).ios}: %BGP-3-NOTIFICATION: sent to neighbor ${sessAddr(x, r).peer} active 2/2 (peer in wrong AS) 2 bytes ${ASN[sessAddr(x, r).peerRouter].toString(16).toUpperCase()}`;
          if (l.at(-1) !== line) l.push(line);
        }
        const w = wrong[0];
        const peerAs = w ? ASN[sessAddr(w, r).peerRouter] : undefined;
        return { output: ["Syslog logging: enabled", "", "Log Buffer (8192 bytes):", ...(l.length ? l : ["(no messages)"])].join("\n"), explanation: peerAs ? `“peer in wrong AS … bytes ${peerAs.toString(16).toUpperCase()}”: the neighbor's OPEN announced AS 0x${peerAs.toString(16).toUpperCase()} = ${peerAs}, not the AS this router was configured to expect.` : "ADJCHANGE: a session went up or down. NOTIFICATION: a session was refused or closed, with the reason." };
      },
    },
    { id: "ping", syntax: "ping <ip>", summary: "Ping from this router", args: { ip: ipArg() }, run: ({ ip }) => pingOut(api.act({ type: "traffic", sends: [{ from: r, to: ip, kind: "ping" }] }), ip, true) },
    { id: "trace", syntax: "traceroute <ip>", summary: "Every router on the way", args: { ip: ipArg() }, run: ({ ip }) => traceOut(api.act({ type: "traffic", sends: [{ from: r, to: ip, kind: "trace" }] }), ip, true) },
    { id: "clr", syntax: "clear ip bgp * soft", summary: "Re-apply policies (soft refresh)", run: () => ({ output: "", explanation: "Policies are re-applied without dropping the sessions. (In this lab every change is already applied at once.)" }) },
    { id: "hist", syntax: "show history", summary: "The commands you typed in this session", run: () => ({ output: [...(api.history ?? []), "show history"].map((x) => `  ${x}`).join("\n") }) },
  ];
}
function iosSet(api: BgCliApi, r: "R1" | "R2"): CliCommandSet {
  const s = api.view;
  const c = s.cfg.r[r];
  const exec = iosExec(api, r);
  const base = { vendor: "cisco" as const, deviceId: r, deviceName: r };
  const mode = api.ios[r];
  const end: CliCommand = { id: "end", syntax: "end", summary: "Leave configuration mode", run: () => (api.setIos(r, { kind: "exec" }), { output: "%SYS-5-CONFIG_I: Configured from console by console" }) };
  if (mode.kind === "exec") return { ...base, prompt: `${r}#`, commands: [...exec, { id: "conf", syntax: "configure terminal", summary: "Enter configuration mode", run: () => (api.setIos(r, { kind: "config" }), { output: "Enter configuration commands, one per line.  End with CNTL/Z." }) }] };
  const doCmds = prefixed(exec, "do");
  const fixed: CliCommand[] = [
    { id: "rmcfg", syntax: "route-map <name> permit <seq>", summary: "", hidden: true, args: { name: { choices: ["LP200", "PREPEND"], resolve: (raw) => raw }, seq: { choices: ["10"], resolve: (raw) => (/^\d+$/.test(raw) ? raw : undefined) } }, run: () => refuse("% Not available in this lab: the route-maps are fixed. Attach or detach them on the neighbor (router bgp 65001 → neighbor … route-map …).") },
    { id: "plcfg", syntax: "ip prefix-list <name> seq <seq> permit <prefix>", summary: "", hidden: true, args: { name: { choices: ["OWN"], resolve: (raw) => raw }, seq: { choices: ["5"], resolve: (raw) => raw }, prefix: { choices: ["192.0.2.128/26"], resolve: (raw) => raw } }, run: () => refuse("% Not available in this lab: the prefix-list OWN is fixed.") },
  ];
  if (mode.kind === "config") return { ...base, prompt: `${r}(config)#`, commands: [{ id: "bgp", syntax: "router bgp 65001", summary: "Configure BGP", run: () => (api.setIos(r, { kind: "bgp" }), { output: "" }) }, ...fixed, { id: "exit", syntax: "exit", summary: "Back to privileged mode", run: () => (api.setIos(r, { kind: "exec" }), { output: "" }) }, end, ...doCmds] };
  const nArg = { ip: nbrArg(r) };
  const setN = (ip: string, patch: Partial<BgNbrCfg>, line: string): CliResult => {
    const x = sessionBetween(r, ip);
    if (!x) return refuse(`% Specify remote-as or peer-group commands first`, `${ip} isn't a neighbor of ${r} in this lab.`);
    const cfg = bgClone(s.cfg);
    cfg.r[r].nbrs[x] = { ...cfg.r[r].nbrs[x]!, ...patch };
    api.act({ type: "cfg", cfg, text: `${r}: ${line}` });
    return { output: "" };
  };
  const isEbgp = (ip: string) => { const x = sessionBetween(r, ip); return x ? SESSIONS[x].type === "eBGP" : false; };
  return {
    ...base,
    prompt: `${r}(config-router)#`,
    commands: [
      { id: "ras", syntax: "neighbor <ip> remote-as <as>", summary: "The AS this neighbor must be in", args: { ...nArg, as: { choices: ["65010", "65020", "65001"], describe: () => "AS number", resolve: (raw) => (/^\d+$/.test(raw) && +raw >= 1 && +raw <= 4294967295 ? raw : undefined) } }, run: ({ ip, as }) => { const res = setN(ip, { remoteAs: +as }, `neighbor ${ip} remote-as ${as}`); const x = sessionBetween(r, ip); return x && !res.refused ? { ...res, explanation: +as === ASN[sessAddr(x, r).peerRouter] ? "Matches the neighbor's real AS: the session can come up." : `The neighbor is really AS ${ASN[sessAddr(x, r).peerRouter]}: its OPEN will be refused (bad peer AS).` } : res; } },
      { id: "nhs", syntax: "neighbor <ip> next-hop-self", summary: "iBGP: announce routes with this router as next hop", args: nArg, run: ({ ip }) => (isEbgp(ip) ? refuse("", "On an eBGP session the next hop is always this router already.") : { ...setN(ip, { nhs: true }, `neighbor ${ip} next-hop-self`), explanation: "The other enterprise router now reaches ISP routes through us — a next hop it can resolve." }) },
      { id: "nhs", syntax: "no neighbor <ip> next-hop-self", summary: "Pass the ISP's next hop unchanged", args: nArg, run: ({ ip }) => setN(ip, { nhs: false }, `no neighbor ${ip} next-hop-self`) },
      { id: "lp", syntax: "neighbor <ip> route-map <map> in", summary: "Set LOCAL_PREF 200 on routes from this neighbor (LP200)", args: { ...nArg, ...LP }, run: ({ ip }) => (isEbgp(ip) ? { ...setN(ip, { lpIn: 200 }, `neighbor ${ip} route-map LP200 in`), explanation: "Routes from this ISP now carry LOCAL_PREF 200 — and iBGP passes it on, so the whole AS prefers this exit." } : refuse("", "In this lab LP200 is meant for an ISP neighbor.")) },
      { id: "lp", syntax: "no neighbor <ip> route-map <map> in", summary: "Remove the inbound LOCAL_PREF", args: { ...nArg, ...LP }, run: ({ ip }) => setN(ip, { lpIn: undefined }, `no neighbor ${ip} route-map LP200 in`) },
      { id: "pp", syntax: "neighbor <ip> route-map <map> out", summary: "Prepend 65001 twice toward this neighbor (PREPEND)", args: { ...nArg, ...PP }, run: ({ ip }) => (isEbgp(ip) ? { ...setN(ip, { prepend: 2 }, `neighbor ${ip} route-map PREPEND out`), explanation: "Our routes now reach this ISP as 65001 65001 65001: the internet will prefer to come back through the OTHER ISP." } : refuse("", "Prepending only has a meaning toward another AS.")) },
      { id: "pp", syntax: "no neighbor <ip> route-map <map> out", summary: "Stop prepending", args: { ...nArg, ...PP }, run: ({ ip }) => setN(ip, { prepend: 0 }, `no neighbor ${ip} route-map PREPEND out`) },
      { id: "own", syntax: "neighbor <ip> prefix-list <list> out", summary: "Announce only our own prefixes to this neighbor (OWN)", args: { ...nArg, ...PL }, run: ({ ip }) => (isEbgp(ip) ? setN(ip, { ownOnly: true }, `neighbor ${ip} prefix-list OWN out`) : refuse("", "Inside the AS both routers need every route.")) },
      { id: "own", syntax: "no neighbor <ip> prefix-list <list> out", summary: "Remove the outbound filter (careful: transit!)", args: { ...nArg, ...PL }, run: ({ ip }) => ({ ...setN(ip, { ownOnly: false }, `no neighbor ${ip} prefix-list OWN out`), explanation: "Without the filter, routes learned from the other ISP are announced to this one: we become a transit AS." }) },
      { id: "shut", syntax: "neighbor <ip> shutdown", summary: "Administratively shut a session", args: nArg, run: ({ ip }) => setN(ip, { shut: true }, `neighbor ${ip} shutdown`) },
      { id: "shut", syntax: "no neighbor <ip> shutdown", summary: "Bring a session back", args: nArg, run: ({ ip }) => setN(ip, { shut: false }, `no neighbor ${ip} shutdown`) },
      { id: "net", syntax: "network <net> mask <mask>", summary: "", hidden: true, args: { net: { choices: [c.networks[0]?.split("/")[0] ?? ""], resolve: (raw) => (isIp(raw) ? raw : undefined) }, mask: { choices: ["255.255.255.192"], resolve: (raw) => (isIp(raw) ? raw : undefined) } }, run: () => ({ output: "", explanation: "Already announced: this router's LAN is the only network it can originate in this lab." }) },
      ...fixed,
      { id: "exit", syntax: "exit", summary: "Back to global configuration", run: () => (api.setIos(r, { kind: "config" }), { output: "" }) },
      end,
      ...doCmds,
    ],
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Junos (R1, R2)
// ---------------------------------------------------------------------------------------------------------------
const exportsOf = (n: BgNbrCfg, ebgp: boolean) => [...(ebgp && n.ownOnly ? ["OWN-ONLY"] : []), ...(n.prepend ? ["PREPEND"] : []), ...(n.nhs ? ["NHS"] : [])];
function junosText(r: "R1" | "R2", c: BgRouterCfg, path: string[] = []): string {
  const groups = sessionsOf(r).map((x) => {
    const n = c.nbrs[x]!;
    const ex = exportsOf(n, SESSIONS[x].type === "eBGP");
    return { name: `group ${GROUP[x][r]}`, kids: [{ name: `type ${SESSIONS[x].type === "iBGP" ? "internal" : "external"}` }, ...(n.lpIn ? [{ name: "import LP200" }] : []), ...(ex.length ? [{ name: `export ${ex.length > 1 ? `[ ${ex.join(" ")} ]` : ex[0]}` }] : []), ...(SESSIONS[x].type === "iBGP" ? [{ name: `local-address ${sessAddr(x, r).mine}` }] : []), { name: `neighbor ${sessAddr(x, r).peer}`, kids: [{ name: `peer-as ${n.remoteAs}` }, ...(n.shut ? [{ name: "shutdown" }] : [])] }] };
  });
  const tree = [
    { name: "routing-options", kids: [{ name: `router-id ${RID[r]}` }, { name: "autonomous-system 65001" }] },
    { name: "protocols", kids: [{ name: "bgp", kids: groups }] },
    { name: "policy-options", kids: [{ name: "prefix-list OWN", kids: OWN_PREFIXES.map((p) => ({ name: p })) }, { name: "policy-statement LP200", kids: [{ name: "then", kids: [{ name: "local-preference 200" }] }] }, { name: "policy-statement PREPEND", kids: [{ name: "then", kids: [{ name: '"as-path-prepend "65001 65001""' }] }] }, { name: "policy-statement NHS", kids: [{ name: "then", kids: [{ name: "next-hop self" }] }] }, { name: "policy-statement OWN-ONLY", kids: [{ name: "term own", kids: [{ name: "from", kids: [{ name: "prefix-list OWN" }] }, { name: "then accept" }] }, { name: "then reject" }] }] },
  ] as JNode[];
  return walk(tree, path);
}
interface JNode {
  name: string;
  kids?: JNode[];
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
export const bgJunosText = junosText;
const INACTIVE: [RegExp, string][] = [
  [/LOCAL_PREF/, "Local Preference"],
  [/AS_PATH/, "AS path"],
  [/MED/, "Route Metric or MED comparison"],
  [/eBGP over iBGP/, "Interior > Exterior > Exterior via Interior"],
  [/router ID/, "Router ID"],
  [/locally originated/, "Route Preference"],
];
function junosRouteDetail(s: BgNet, r: BgRouter, prefix: string): CliResult {
  const ps = s.view.paths[r].filter((p) => p.prefix === prefix);
  if (!ps.length) return refuse("", `${r} has no BGP path for ${prefix}.`);
  const best = ps.find((p) => p.best);
  const out = [`inet.0: ${s.view.rib[r].length} destinations, ${s.view.rib[r].length + ps.length - 1} routes`, `${prefix} (${ps.length} entries, ${best ? 1 : 0} announced)`];
  for (const p of ps) {
    if (p.type === "local") {
      out.push("        *Direct Preference: 0", "                (and announced by BGP: network originated here)");
      continue;
    }
    const why = p.best ? undefined : !p.valid ? undefined : INACTIVE.find(([re]) => re.test(p.reason ?? ""))?.[1] ?? "Not Best in its group";
    out.push(`        ${p.best ? "*" : " "}BGP    Preference: 170/-${p.localPref + 1}`, `                Next hop type: ${p.valid ? "Router" : "Unusable"}`, `                Next hop: ${p.nextHop}${p.valid ? ` via ${ifOfAddr(r, s.view.rib[r].find((x) => x.proto === "C" && x.via && sessionBetween(r, p.nextHop) && sessAddr(sessionBetween(r, p.nextHop)!, r).mine === x.via)?.via ?? (p.sess ? sessAddr(p.sess, r).mine : undefined), "juniper")}.0${p.best ? ", selected" : ""}` : ""}`, `                State: <${p.best ? "Active " : ""}${p.valid ? "" : "Hidden "}${p.type === "iBGP" ? "Int" : "Ext"}>`, ...(why ? [`                Inactive reason: ${why}`] : []), `                Peer AS: ${p.from === "local" ? ASN[r] : ASN[p.from as BgRouter]}`, `                AS path: ${p.asPath.join(" ")} I`, `                Localpref: ${p.localPref}`, `                Router ID: ${RID[p.from as BgRouter]}`);
  }
  return { output: out.join("\n"), explanation: "Inactive reason = the best-path step this route lost on. Next hop type Unusable = the next hop can't be resolved: the route is hidden." };
}
function junosOp(api: BgCliApi, r: "R1" | "R2"): CliCommand[] {
  const s = api.view;
  const c = s.cfg.r[r];
  const sess = sessionsOf(r);
  const routeList = (onlyBgp: boolean, filter?: (prefix: string) => boolean) => {
    const rows = s.view.rib[r].filter((x) => (!onlyBgp || x.proto === "B") && (!filter || filter(x.prefix)));
    // As Junos: a destination's valid BGP paths that lost are listed (and counted) under the active one, without a '*'.
    const losers = (prefix: string) => s.view.paths[r].filter((p) => p.prefix === prefix && p.valid && !p.best && p.sess);
    const inactive = s.view.rib[r].filter((x) => x.proto === "B").reduce((n, x) => n + losers(x.prefix).length, 0);
    return [`inet.0: ${s.view.rib[r].length} destinations, ${s.view.rib[r].length + inactive} routes (${s.view.rib[r].length} active, 0 holddown, ${s.view.paths[r].filter((p) => !p.valid).length} hidden)`, "+ = Active Route, - = Last Active, * = Both", "", ...rows.flatMap((x) => (x.proto === "B" ? [`${x.prefix.padEnd(19)}*[BGP/170] 00:15:40, localpref ${x.path!.localPref}`, `                      AS path: ${x.path!.asPath.join(" ")} I, validation-state: unverified`, `                    >  to ${x.nh} via ${ifOfAddr(r, x.via, "juniper")}.0`, ...losers(x.prefix).flatMap((p) => [`${"".padEnd(19)} [BGP/170] 00:15:40, localpref ${p.localPref}`, `                      AS path: ${p.asPath.join(" ")} I, validation-state: unverified`, `                       to ${p.nextHop} via ${ifOfAddr(r, sessAddr(p.sess!, r).mine, "juniper")}.0`])] : [`${x.prefix.padEnd(19)}*[${x.proto === "C" ? "Direct" : "Local"}/0] 1d 02:11:05`, `                    ${x.proto === "C" ? ">" : "Local"} via ${ifOfAddr(r, x.via, "juniper")}.0`]))].join("\n");
  };
  const advTable = (list: BgPath[], adv: boolean) => columns([["  Prefix", "Nexthop", "MED", "Lclpref", "AS path"], ...list.map((p) => [`* ${p.prefix}`, adv ? "Self" : p.nextHop, "", String(p.localPref), `${p.asPath.join(" ")} I`])], [24, 20, 8, 10]);
  return [
    { id: "sum", syntax: "show bgp summary", summary: "BGP peers and their state", run: () => ({ output: ["Threading mode: BGP I/O", `Groups: ${sess.length} Peers: ${sess.length} Down peers: ${sess.filter((x) => s.view.sess[x].state !== "Established").length}`, "Table          Tot Paths  Act Paths Suppressed    History Damp State    Pending", "inet.0", `${"".padEnd(22)}${String(s.view.paths[r].length).padEnd(11)}${String(s.view.paths[r].filter((p) => p.best).length).padEnd(11)}0          0          0          0`, columns([["Peer", "AS", "InPkt", "OutPkt", "OutQ", "Flaps", "Last Up/Dwn", "State|#Active/Received/Accepted/Damped..."], ...sess.flatMap((x) => { const st = s.view.sess[x]; const rcv = s.view.paths[r].filter((p) => p.sess === x); return [[sessAddr(x, r).peer, String(c.nbrs[x]!.remoteAs), "25", "23", "0", "0", st.state === "Established" ? "15:40" : "16:02", st.state === "Established" ? "Establ" : st.state.startsWith("Idle") ? "Idle" : "Active"], ...(st.state === "Established" ? [[`  inet.0: ${rcv.filter((p) => p.best).length}/${rcv.length}/${rcv.length}/0`, "", "", "", "", "", "", ""]] : [])]; })], [22, 8, 8, 8, 6, 6, 12])].join("\n"), explanation: "Establ = up; the line below gives active/received routes. Active = the session never comes up (see show bgp neighbor <ip>: Last Error)." }) },
    { id: "nbr", syntax: "show bgp neighbor <ip>", summary: "One peer: type, state, last error", args: { ip: nbrArg(r) }, run: ({ ip }) => { const x = sessionBetween(r, ip); if (!x) return refuse(`error: neighbor ${ip} not found`); const st = s.view.sess[x]; return { output: [`Peer: ${ip}+179 AS ${c.nbrs[x]!.remoteAs} Local: ${sessAddr(x, r).mine}+51234 AS 65001`, `  Group: ${GROUP[x][r]}  Routing-Instance: master`, `  Type: ${SESSIONS[x].type === "iBGP" ? "Internal" : "External"}    State: ${st.state === "Established" ? "Established" : st.state.startsWith("Idle") ? "Idle" : "Active"}    Flags: <${st.state === "Established" ? "Sync" : "ImportEval"}>`, `  Last State: ${st.state === "Established" ? "OpenConfirm" : "OpenSent"}   Last Event: ${st.state === "Established" ? "RecvKeepAlive" : "RecvOpen"}`, `  Last Error: ${/bad peer AS/.test(st.why ?? "") ? "Open Message Error" : "None"}`, ...(/bad peer AS/.test(st.why ?? "") ? ["  Error: 'Open Message Error' Sent: 3 Recv: 0", "    Bad Peer AS"] : []), `  Export: [ ${exportsOf(c.nbrs[x]!, SESSIONS[x].type === "eBGP").join(" ")} ] ${c.nbrs[x]!.lpIn ? "Import: [ LP200 ]" : ""}`].join("\n"), explanation: st.why }; } },
    { id: "rt", syntax: "show route protocol bgp", summary: "BGP routes in the routing table", run: () => ({ output: routeList(true), explanation: "Junos gives BGP preference 170 (eBGP and iBGP alike); localpref is shown for each route." }) },
    { id: "rt", syntax: "show route", summary: "The whole routing table", run: () => ({ output: routeList(false) }) },
    { id: "terse", syntax: "show interfaces terse", summary: "Interfaces and link state", run: () => ({ output: columns([["Interface", "Admin", "Link", "Proto", "Local"], ...ifList(s, r).flatMap((i) => [[i.name("juniper"), "up", i.up ? "up" : "down", "", ""], [`${i.name("juniper")}.0`, "up", i.up ? "up" : "down", "inet", `${i.addr}/${i.addr === LAN[r as "R1"]?.gw ? 26 : 30}`]])], [16, 6, 6, 6]) }) },
    {
      id: "rt",
      syntax: "show route <ip>",
      summary: "The route this router uses for one address",
      args: { ip: { choices: [HOST_IP.SRV, HOST_IP.H1], describe: () => "an IPv4 address", resolve: (raw: string) => (isIp(raw) ? raw : undefined) } },
      run: ({ ip }) => {
        const x = bgLookup(s.view, r, ip);
        return x ? { output: routeList(false, (p) => p === x.prefix) } : { output: "", explanation: "No route covers this address (Junos prints nothing)." };
      },
    },
    { id: "rtd", syntax: "show route <prefix> detail", summary: "Every BGP path for a prefix, with why it lost", args: { prefix: prefixArg(s, r) }, run: ({ prefix }) => junosRouteDetail(s, r, prefix) },
    { id: "adv", syntax: "show route advertising-protocol bgp <ip>", summary: "What this router sends to a peer", args: { ip: nbrArg(r) }, run: ({ ip }) => { const x = sessionBetween(r, ip); if (!x) return refuse("error: neighbor not found"); const list = s.view.adv[advKey(r, sessAddr(x, r).peerRouter)] ?? []; return { output: list.length ? `inet.0: ${s.view.rib[r].length} destinations\n${advTable(list, true)}` : "", explanation: list.length ? undefined : "Nothing is advertised to this peer." }; } },
    { id: "rcv", syntax: "show route receive-protocol bgp <ip>", summary: "What this router accepted from a peer", args: { ip: nbrArg(r) }, run: ({ ip }) => { const x = sessionBetween(r, ip); if (!x) return refuse("error: neighbor not found"); const list = s.view.paths[r].filter((p) => p.sess === x); return { output: list.length ? `inet.0: ${s.view.rib[r].length} destinations\n${advTable(list, false)}` : "" }; } },
    { id: "cfg", syntax: "show configuration protocols bgp", summary: "BGP groups, neighbors, policies attached", run: () => ({ output: junosText(r, c, ["protocols", "bgp"]) }) },
    { id: "cfg", syntax: "show configuration policy-options", summary: "The lab's policies (fixed)", run: () => ({ output: junosText(r, c, ["policy-options"]) }) },
    { id: "cfg", syntax: "show configuration", summary: `${r}'s committed configuration`, run: () => ({ output: junosText(r, c) }) },
    { id: "log", syntax: "show log messages", summary: "System log", run: () => { const l = s.syslog.filter((x) => x.r === r).slice(-40).map((x) => { const t = stamp(x.clock).junos; return x.ev === "up" ? `${t}  ${r} rpd[1588]: bgp_recv_open: peer ${x.peer} (External AS ${ASN[sessAddr(sessionBetween(r, x.peer)!, r).peerRouter]}): session Established` : x.ev === "down" ? `${t}  ${r} rpd[1588]: BGP_PREFIX_THRESH? `.replace("BGP_PREFIX_THRESH? ", `RPD_BGP_NEIGHBOR_STATE_CHANGED: BGP peer ${x.peer} changed state from Established to Idle (event ${/link/.test(x.text ?? "") ? "Stop" : "Stop"})`) : `${t}  ${r} rpd[1588]: bgp_pp_recv: rejecting connection from ${x.peer} (AS ${ASN[sessAddr(sessionBetween(r, x.peer)!, r).peerRouter]}): Bad peer AS`; }); return { output: l.length ? l.join("\n") : "(no messages)" }; } },
    { id: "ping", syntax: "ping <ip>", summary: "Ping from this router", args: { ip: ipArg() }, run: ({ ip }) => pingOut(api.act({ type: "traffic", sends: [{ from: r, to: ip, kind: "ping" }] }), ip, false) },
    { id: "trace", syntax: "traceroute <ip>", summary: "Every router on the way", args: { ip: ipArg() }, run: ({ ip }) => traceOut(api.act({ type: "traffic", sends: [{ from: r, to: ip, kind: "trace" }] }), ip, false) },
    { id: "hist", syntax: "show cli history", summary: "The commands you typed in this session", run: () => ({ output: [...(api.history ?? []), "show cli history"].map((x, n) => `${String(n + 1).padStart(4)}  ${x}`).join("\n") }) },
  ];
}
function junosSet(api: BgCliApi, r: "R1" | "R2"): CliCommandSet {
  const s = api.view;
  const base = { vendor: "juniper" as const, deviceId: r, deviceName: r };
  const op = junosOp(api, r);
  const active = s.cfg.r[r];
  const rbHist = s.rb?.[r as "R1" | "R2"] ?? [];
  const cand = api.cand[r];
  const dirty = JSON.stringify(cand) !== JSON.stringify(active);
  const configure: CliCommand = { id: "conf", syntax: "configure", summary: "Enter configuration mode", run: () => (!dirty && api.setCand({ ...api.cand, [r]: bgClone(active) }), api.setJunosEdit(r, true), { output: dirty ? "Entering configuration mode\nThe configuration has been changed but not committed\n" : "Entering configuration mode\n" }) };
  if (!api.junosEdit[r]) return { ...base, prompt: `admin@${r}> `, commands: [...op, configure] };
  const sess = sessionsOf(r);
  const gArg: CliArgSpec = { choices: sess.map((x) => GROUP[x][r]!), describe: (g) => `${sess.find((x) => GROUP[x][r] === g) ? SESSIONS[sess.find((x) => GROUP[x][r] === g)!].type : ""}`, resolve: (raw) => (sess.some((x) => GROUP[x][r] === raw) ? raw : undefined) };
  const xOf = (g: string) => sess.find((x) => GROUP[x][r] === g)!;
  const set = (g: string, patch: Partial<BgNbrCfg>) => {
    const x = xOf(g);
    api.setCand({ ...api.cand, [r]: { ...cand, nbrs: { ...cand.nbrs, [x]: { ...cand.nbrs[x]!, ...patch } } } });
  };
  const polArg: CliArgSpec = { choices: ["OWN-ONLY", "PREPEND", "NHS"], resolve: (raw) => (["OWN-ONLY", "PREPEND", "NHS"].includes(raw) ? raw : undefined) };
  const patchFor = (pol: string, on: boolean): Partial<BgNbrCfg> => (pol === "OWN-ONLY" ? { ownOnly: on } : pol === "PREPEND" ? { prepend: on ? 2 : 0 } : { nhs: on });
  const doCommit = (quit: boolean): CliResult => {
    if (dirty) {
      const cfg = bgClone(s.cfg);
      cfg.r[r] = bgClone(cand);
      api.act({ type: "cfg", cfg, text: `${r}: Junos commit`, junosCommit: r as "R1" | "R2" });
    }
    if (quit) api.setJunosEdit(r, false);
    return { output: quit ? "commit complete\nExiting configuration mode" : "commit complete", explanation: dirty ? "Active now. Check show bgp summary / show route … detail, then prove it with traffic." : undefined };
  };
  return {
    ...base,
    prompt: `admin@${r}# `,
    commands: [
      { id: "pas", syntax: "set protocols bgp group <group> neighbor <ip> peer-as <as>", summary: "The AS this peer must be in", args: { group: gArg, ip: nbrArg(r), as: { choices: ["65010", "65020", "65001"], resolve: (raw) => (/^\d+$/.test(raw) ? raw : undefined) } }, run: ({ group, ip, as }) => (sessAddr(xOf(group), r).peer === ip ? (set(group, { remoteAs: +as }), { output: "" }) : refuse(`error: ${ip} is not the peer of group ${group} in this lab`)) },
      { id: "imp", syntax: "set protocols bgp group <group> import <policy>", summary: "Set LOCAL_PREF 200 on routes from this group (LP200)", args: { group: gArg, policy: nameArg("LP200", "policy: then local-preference 200") }, run: ({ group }) => (set(group, { lpIn: 200 }), { output: "" }) },
      { id: "imp", syntax: "delete protocols bgp group <group> import", summary: "Remove the import policy", args: { group: gArg }, run: ({ group }) => (cand.nbrs[xOf(group)]!.lpIn ? (set(group, { lpIn: undefined }), { output: "" }) : refuse("warning: statement not found")) },
      { id: "exp", syntax: "set protocols bgp group <group> export <policy>", summary: "Add an export policy (OWN-ONLY, PREPEND, NHS)", args: { group: gArg, policy: polArg }, run: ({ group, policy }) => { const ebgp = SESSIONS[xOf(group)].type === "eBGP"; if (policy === "NHS" && ebgp) return refuse("", "next-hop self only matters on the internal group: toward an ISP the next hop is always us."); if (policy !== "NHS" && !ebgp) return refuse("", `${policy} is meant for an ISP group in this lab.`); set(group, patchFor(policy, true)); return { output: "" }; } },
      { id: "exp", syntax: "delete protocols bgp group <group> export <policy>", summary: "Remove an export policy", args: { group: gArg, policy: polArg }, run: ({ group, policy }) => (set(group, patchFor(policy, false)), { output: "" }) },
      { id: "show", syntax: "show", summary: "The candidate configuration (try show | compare)", run: () => ({ output: junosText(r, cand) }) },
      { id: "show", syntax: "show protocols bgp", summary: "Candidate BGP configuration", run: () => ({ output: junosText(r, cand, ["protocols", "bgp"]) }) },
      { id: "commit", syntax: "commit", summary: "Activate the candidate configuration", run: () => doCommit(false) },
      { id: "commit", syntax: "commit check", summary: "Check the candidate", run: () => ({ output: "configuration check succeeds" }) },
      { id: "commit", syntax: "commit and-quit", summary: "Commit, then leave configuration mode", run: () => doCommit(true) },
      { id: "rollback", syntax: "rollback", summary: "Discard your uncommitted changes (= rollback 0)", run: () => (api.setCand({ ...api.cand, [r]: bgClone(active) }), { output: "load complete" }) },
      {
        id: "rollback",
        syntax: "rollback <n>",
        summary: "Load an earlier committed configuration into the candidate (then commit)",
        args: { n: { choices: ["0", ...rbHist.map((_, i) => String(i + 1))], describe: (x) => (x === "0" ? "the active configuration" : x === "1" ? "before the last commit" : `before the last ${x} commits`), resolve: (raw) => (/^\d{1,2}$/.test(raw) ? String(+raw) : undefined) } },
        run: ({ n }) => {
          if (n === "0") return (api.setCand({ ...api.cand, [r]: bgClone(active) }), { output: "load complete" });
          const json = rbHist[Number(n) - 1];
          if (!json) return refuse(`error: rollback ${n} does not exist${rbHist.length ? ` (1–${rbHist.length} available)` : " (no commits yet)"}`);
          ((c: BgRouterCfg) => api.setCand({ ...api.cand, [r]: c }))(JSON.parse(json) as BgRouterCfg);
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
// ISP looking glasses (R3–R5) and hosts
// ---------------------------------------------------------------------------------------------------------------
function lookingGlass(api: BgCliApi, r: BgRouter, vendor: CliVendor): CliCommandSet {
  const s = api.view;
  const ro: CliResult = refuse(`% This is ${r === "R5" ? "AS65030's" : r === "R3" ? "ISP-A's" : "ISP-B's"} looking glass: read-only.`, "You don't manage this router. Change what YOU announce or accept, on R1 / R2.");
  const cmds: CliCommand[] = [
    { id: "tbl", syntax: "show ip bgp", summary: "This router's BGP table (as the ISP sees us)", run: () => ({ output: iosBgpTable(s, r), explanation: "Look at the paths toward 192.0.2.128/26 and 192.0.2.192/26: their AS_PATH shows our prepending; a 203.0.113.0/24 path via AS65001 would be a leak." }) },
    { id: "pfx", syntax: "show ip bgp <prefix>", summary: "Every path for one prefix", args: { prefix: prefixArg(s, r) }, run: ({ prefix }) => iosBgpPrefix(s, r, prefix) },
    { id: "route", syntax: "show ip route", summary: "The routing table", run: () => ({ output: iosRoute(s, r) }) },
    { id: "ping", syntax: "ping <ip>", summary: "Ping from this router", args: { ip: ipArg() }, run: ({ ip }) => pingOut(api.act({ type: "traffic", sends: [{ from: r, to: ip, kind: "ping" }] }), ip, true) },
    { id: "trace", syntax: "traceroute <ip>", summary: "Every router on the way", args: { ip: ipArg() }, run: ({ ip }) => traceOut(api.act({ type: "traffic", sends: [{ from: r, to: ip, kind: "trace" }] }), ip, true) },
    { id: "conf", syntax: "configure terminal", summary: "", hidden: true, run: () => ro },
    { id: "conf2", syntax: "configure", summary: "", hidden: true, run: () => ro },
  ];
  return { vendor, deviceId: r, deviceName: `${r} looking glass`, prompt: `lg-${r.toLowerCase()}> `, commands: cmds };
}
function hostSet(api: BgCliApi, h: BgHost): CliCommandSet {
  const name = h.toLowerCase();
  const gw = LAN[ROUTER_OF[h]].gw;
  const ipA = ipArg();
  const ping = (ip: string, n: number): CliResult => {
    const ns = api.act({ type: "traffic", sends: [{ from: h, to: ip, kind: "ping" }] });
    const r = ns.last!.results[0];
    if (r.replied) return { output: [`PING ${ip} (${ip}) 56(84) bytes of data.`, ...Array.from({ length: n }, (_, i) => `64 bytes from ${ip}: icmp_seq=${i + 1} ttl=${64 - (r.backPath?.filter((x) => /^R/.test(x)).length ?? 0)} time=${(3.2 + i * 0.2).toFixed(1)} ms`), "", `--- ${ip} ping statistics ---`, `${n} packets transmitted, ${n} received, 0% packet loss`].join("\n"), explanation: `There: ${r.path.join(" → ")} · back: ${r.backPath?.join(" → ")}.` };
    return { output: [`PING ${ip} (${ip}) 56(84) bytes of data.`, "", `--- ${ip} ping statistics ---`, `${n} packets transmitted, 0 received, 100% packet loss`].join("\n"), explanation: r.fail };
  };
  const cmds: CliCommand[] = [
    { id: "addr", syntax: "ip addr", summary: "This host's address", run: () => ({ output: `2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 state UP\n    inet ${HOST_IP[h]}/${LAN[ROUTER_OF[h]].prefix.split("/")[1]} scope global eth0` }) },
    { id: "route", syntax: "ip route", summary: "This host's routes", run: () => ({ output: `default via ${gw} dev eth0\n${LAN[ROUTER_OF[h]].prefix} dev eth0 proto kernel scope link src ${HOST_IP[h]}` }) },
    { id: "ping", syntax: "ping <ip>", summary: "Ping (4 echo requests)", args: { ip: ipA }, run: ({ ip }) => ping(ip, 4) },
    { id: "ping", syntax: "ping -c <count> <ip>", summary: "Ping <count> times", args: { count: { choices: ["1", "3"], resolve: (raw) => (/^\d+$/.test(raw) && +raw >= 1 && +raw <= 10 ? raw : undefined) }, ip: ipA }, run: ({ count, ip }) => ping(ip, +count) },
    { id: "trace", syntax: "traceroute <ip>", summary: "Every router on the way", args: { ip: ipA }, run: ({ ip }) => { const ns = api.act({ type: "traffic", sends: [{ from: h, to: ip, kind: "trace" }] }); const rows = ns.last!.results[0].trace ?? []; return { output: [`traceroute to ${ip} (${ip}), 30 hops max, 60 byte packets`, ...rows.map((t) => ` ${t.hop}  ${t.ip === "*" ? "* * *" : `${t.ip} (${t.ip})  ${t.hop}.${t.hop}21 ms  ${t.hop}.${t.hop}55 ms  ${t.hop}.${t.hop}03 ms`}`)].join("\n"), explanation: `Routers: ${ns.last!.results[0].path.filter((x) => /^R/.test(x)).join(" → ")}.` }; } },
  ];
  return withShellHistory(withSelfPing({ vendor: "cisco", deviceId: h, deviceName: name, prompt: `admin@${name}:~$ `, commands: cmds }, "linux", [HOST_IP[h]]), "linux", api.history);
}
export function bgRouterSets(api: BgCliApi, r: BgRouter): Partial<Record<CliVendor, CliCommandSet>> {
  if (r === "R1" || r === "R2") return { cisco: withSelfPing(iosSet(api, r), "ios", [LAN[r].gw, ...sessionsOf(r).map((x) => sessAddr(x, r).mine)]), juniper: withSelfPing(junosSet(api, r), "junos", [LAN[r].gw, ...sessionsOf(r).map((x) => sessAddr(x, r).mine)]) };
  return { cisco: lookingGlass(api, r, "cisco"), juniper: lookingGlass(api, r, "juniper") };
}
export const bgHostSet = hostSet;
export const bgJunosConfig = (api: Pick<BgCliApi, "view">, r: "R1" | "R2") => (which: "committed" | number, path: string[]) => (which === "committed" || which === 0 ? junosText(r, api.view.cfg.r[r], path) : undefined);
export const _bgLookup = bgLookup;
