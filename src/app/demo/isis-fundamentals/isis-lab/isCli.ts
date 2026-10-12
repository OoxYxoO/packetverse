import type { CliArgSpec, CliCommandSet, CliVendor } from "@/lib/cli/types";
import { buildJunosSet, buildXrSet, choiceArg, junosPipeConfig, numArg, type SpCfgStmt, type SpCmd, type SpDevCli, type SpJunosSpec, type SpXrSpec } from "@/components/sp-lab/spCli";
import { lpad, pad, spAge, spClone, spStamp, type JStmt } from "@/components/sp-lab/spKit";
import {
  DEFAULT_MTU,
  HOLD,
  IS_LINKS,
  IS_LO,
  IS_ROUTERS,
  IS_SYS,
  LSP_LIFE,
  NET_RE,
  adjKey,
  areaOf,
  forward,
  hex8,
  ifLevels,
  inPfx,
  isIf,
  isIfs,
  isLspId,
  isMac,
  isRib,
  isRunning,
  levelsOfType,
  linkUp,
  lookup,
  ownerOf,
  spfTree,
  sysOf,
  type IfName,
  type IsAction,
  type IsLsp,
  type IsR,
  type IsRoute,
  type IsRtr,
  type IsState,
  type IsType,
  type Lvl,
} from "@/lib/sim-engine/scenarios/isisNet";
import { jnIf, parseIf, xrIf } from "./isNames";

/**
 * Command lines of the IS-IS Lab — Cisco IOS XR or Junos on all six routers. Every output is printed from the lab
 * model (the same adjacencies, LSDBs, SPF and RIB the topology and the tools show); every change is a candidate edit
 * that only reaches the network on commit.
 *
 *   IOS XR  show isis neighbors | adjacency · show isis database [detail] [<lsp-id>] · show isis interface [brief |
 *           <if>] · show isis topology · show isis route · show isis spf-log · show isis hostname · show route [isis |
 *           <ip>] · show ipv4 interface brief · show interfaces brief | <if> · show logging · ping / traceroute <ip>
 *           [source <ip|if>] · configure → router isis CORE (net, is-type, set-overload-bit, interface …
 *           (point-to-point, passive, circuit-type, hello-password hmac-md5 clear, address-family ipv4 unicast → metric))
 *           · interface <if> (mtu, shutdown) · commit
 *   Junos   show isis adjacency [detail] · show isis database [detail] [<lsp-id>] · show isis interface · show isis
 *           route · show isis spf log · show isis hostname · show isis statistics · show route [protocol isis | <ip>]
 *           · show interfaces terse | <if> [extensive] · show log messages · ping <ip> [count n] [source <ip>] ·
 *           traceroute <ip> [source <ip>] · configure → set/delete protocols isis … · interfaces <if> (mtu, disable,
 *           unit 0 family iso [address]) → commit
 */

export interface IsCliApi {
  s: IsState;
  act: (a: IsAction) => IsState;
  dev: SpDevCli<IsRtr>;
}
const DAY = "Sun Oct 11 2026";
const holdLeft = (s: IsState, r: IsR, ifn: string) => HOLD - ((s.clock + IS_ROUTERS.indexOf(r) * 3 + Number(ifn.slice(-1)) * 4) % 10);
const lifeLeft = (s: IsState, l: IsLsp) => Math.max(1, LSP_LIFE - (s.clock - l.gen));
const csum = (n: number) => `0x${n.toString(16).padStart(4, "0")}`;
const lvlTag = (l: Lvl[]) => (l.includes(1) && l.includes(2) ? "L1L2" : l.includes(1) ? "L1" : "L2");
/** The key as each OS prints it back (both store it encrypted; the same key always prints the same text). */
export function keyCipher(key: string, v: CliVendor): string {
  let h = 0x1f;
  const out: string[] = [];
  for (const ch of key) {
    h = (h * 31 + ch.charCodeAt(0)) & 0xff;
    out.push(h.toString(16).padStart(2, "0").toUpperCase());
  }
  return v === "cisco" ? `0${out.join("")}` : `"$9$${out.join("").toLowerCase().replace(/[0-9]/g, (d) => "ABCDEFGHIJ"[+d])}"`;
}

// ---------------------------------------------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------------------------------------------
const phys = (r: IsR) => isIfs(r).map((i) => i.ifn);
const xrIfArg = (r: IsR, withLo = true): CliArgSpec => ({
  choices: [...(withLo ? ["Loopback0"] : []), ...phys(r).map((i) => xrIf(i))],
  describe: (c) => {
    const n = parseIf(c);
    const i = n && n !== "lo0" ? isIf(r, n) : undefined;
    return i ? `to ${i.peer}` : n === "lo0" ? "Loopback interface" : undefined;
  },
  resolve: (raw) => {
    const n = parseIf(raw);
    return n && (n === "lo0" ? withLo : phys(r).includes(n as IfName)) ? n : undefined;
  },
});
const jnUnitArg = (r: IsR): CliArgSpec => ({
  choices: [...phys(r).map((i) => `${i}.0`), "lo0.0"],
  describe: (c) => {
    const i = isIf(r, c.replace(".0", ""));
    return i ? `to ${i.peer}` : "Loopback";
  },
  resolve: (raw) => (/^(ge-0\/0\/[0-2]|lo0)\.0$/.test(raw) && (raw === "lo0.0" || phys(r).includes(raw.slice(0, -2) as IfName)) ? raw.slice(0, -2) : undefined),
});
const jnPhysArg = (r: IsR): CliArgSpec => ({
  choices: [...phys(r), "lo0"],
  describe: (c) => (isIf(r, c) ? `to ${isIf(r, c)!.peer}` : "Loopback"),
  resolve: (raw) => (raw === "lo0" || phys(r).includes(raw as IfName) ? raw : undefined),
});
const ipArg: CliArgSpec = {
  choices: IS_ROUTERS.map((r) => IS_LO[r]),
  describe: (c) => ownerOf(c),
  resolve: (raw) => (/^(\d{1,3}\.){3}\d{1,3}$/.test(raw) && raw.split(".").every((o) => +o <= 255) ? raw : undefined),
};
const lspArg = (s: IsState, r: IsR): CliArgSpec => ({
  choices: IS_ROUTERS.filter((o) => s.db[r][2][o] || s.db[r][1][o]).map((o) => isLspId(o)),
  describe: () => "LSP ID",
  resolve: (raw) => {
    const m = /^([A-Za-z0-9]+)(\.00(-00)?)?$/.exec(raw);
    if (!m) return undefined;
    const o = IS_ROUTERS.find((x) => x.toLowerCase() === m[1].toLowerCase());
    return o ? isLspId(o) : undefined;
  },
});
const levelArg = choiceArg(["level-1", "level-1-2", "level-2-only"], (c) => (c === "level-1" ? "Level-1 only" : c === "level-2-only" ? "Level-2 only" : "Level-1 and Level-2"));
const metricArg = numArg(1, 16777214, ["10", "20", "100"], "Default metric (wide: 1–16777214)");
const mtuArg = numArg(1514, 9216, ["1514", "9014"], "MTU in bytes (including the 14-byte Ethernet header)");
const netArg: CliArgSpec = { choices: [], describe: () => "NET: area.system-id.00, e.g. 49.0001.0000.0000.0001.00", resolve: (raw) => (NET_RE.test(raw) ? raw.toLowerCase() : undefined) };
const keyArg: CliArgSpec = { choices: [], describe: () => "The password (case-sensitive)", resolve: (raw) => (/^[\x21-\x7e]{1,40}$/.test(raw) ? raw : undefined) };

// ---------------------------------------------------------------------------------------------------------------
// Shared views of the model
// ---------------------------------------------------------------------------------------------------------------
const rib = (s: IsState, r: IsR) => isRib(s.cfg, s.phys, s.adj, s.db, r);
const nbrName = (r: IsR) => r;
const sinceOf = (s: IsState, r: IsR, rt: IsRoute) => spAge(s.clock, Math.max(0, ...rt.nh.map((h) => s.adj[adjKey(r, h.ifn)]?.since ?? 0), ...Object.values(s.db[r][2]).map((l) => (l ? l.gen : 0))));
function egressIp(s: IsState, r: IsR, dst: string): string | undefined {
  const rt = lookup(rib(s, r), dst);
  if (!rt) return undefined;
  if (rt.kind === "L") return dst;
  const ifn = rt.kind === "C" ? rt.ifn : rt.nh[0]?.ifn;
  return ifn ? isIf(r, ifn)?.ip : undefined;
}
function ipOwnedBy(r: IsR, ip: string) {
  return IS_LO[r] === ip || isIfs(r).some((i) => i.ip === ip);
}
interface PingOut {
  ok: boolean;
  kind: "ok" | "unreach" | "noreply" | "noroute";
  ttl: number;
  at?: IsR;
}
function pingResult(s: IsState, r: IsR, dst: string, src: string): PingOut {
  if (!lookup(rib(s, r), dst)) return { ok: false, kind: "noroute", ttl: 0 };
  const fwd = forward(s.cfg, s.phys, s.adj, s.db, r, src, dst);
  if (fwd.result !== "ok") return { ok: false, kind: "unreach", ttl: 0, at: fwd.at };
  const back = forward(s.cfg, s.phys, s.adj, s.db, fwd.at, dst, src);
  if (back.result !== "ok") return { ok: false, kind: "noreply", ttl: 0, at: back.at };
  return { ok: true, kind: "ok", ttl: 64 - Math.max(0, back.hops.length - 2) };
}

// ---------------------------------------------------------------------------------------------------------------
// IOS XR outputs
// ---------------------------------------------------------------------------------------------------------------
function xrNeighbors(s: IsState, r: IsR): string {
  const rows = isIfs(r).filter((i) => s.adj[adjKey(r, i.ifn)]).map((i) => {
    const a = s.adj[adjKey(r, i.ifn)];
    return `${pad(nbrName(a.nbr), 15)}${pad(xrIf(i.ifn, true), 17)}${pad("*PtoP*", 15)}${pad(a.state === "UP" ? "Up" : "Init", 6)}${pad(holdLeft(s, r, i.ifn), 9)}${pad(lvlTag(a.lvls.length ? a.lvls : ifLevels(s.cfg, r, i.ifn)), 5)}Capable`;
  });
  return [`IS-IS CORE neighbors:`, "System Id      Interface        SNPA           State Holdtime Type IETF-NSF", ...rows, "", `Total neighbor count: ${rows.length}`].join("\n");
}
function xrAdjacency(s: IsState, r: IsR): string {
  const out: string[] = [];
  let total = 0;
  for (const lvl of [1, 2] as Lvl[]) {
    if (!levelsOfType(s.cfg[r].isType).includes(lvl) || !isRunning(s.cfg, r)) continue;
    const rows = isIfs(r)
      .filter((i) => {
        const a = s.adj[adjKey(r, i.ifn)];
        return a && (a.lvls.includes(lvl) || (a.state === "INIT" && ifLevels(s.cfg, r, i.ifn).includes(lvl)));
      })
      .map((i) => {
        const a = s.adj[adjKey(r, i.ifn)];
        return `${pad(a.nbr, 15)}${pad(xrIf(i.ifn, true), 25)}${pad("*PtoP*", 15)}${pad(a.state === "UP" ? "Up" : "Init", 6)}${pad(holdLeft(s, r, i.ifn), 5)}${pad(spAge(s.clock, a.since), 9)}Yes None None`;
      });
    total += rows.length;
    out.push(`IS-IS CORE Level-${lvl} adjacencies:`, "System Id      Interface                SNPA           State Hold Changed  NSF IPv4 IPv6", "                                                                               BFD  BFD", ...rows, "");
  }
  return [...out, `Total adjacency count: ${total}`].join("\n");
}
function attPolText(l: IsLsp) {
  return `0/0/${l.ol ? 1 : 0}`;
}
function xrDatabase(s: IsState, r: IsR, detail: boolean, only?: string): string {
  if (!isRunning(s.cfg, r)) return "% IS-IS instance CORE is not running";
  const out: string[] = [];
  for (const lvl of [1, 2] as Lvl[]) {
    if (!levelsOfType(s.cfg[r].isType).includes(lvl)) continue;
    const lsps = IS_ROUTERS.map((o) => s.db[r][lvl][o]).filter((l): l is IsLsp => !!l && (!only || isLspId(l.orig) === only));
    if (only && !lsps.length) continue;
    out.push(`IS-IS CORE (Level-${lvl}) Link State Database`, "LSPID                 LSP Seq Num  LSP Checksum  LSP Holdtime/Rcvd  ATT/P/OL");
    for (const l of lsps) {
      const local = l.orig === r;
      out.push(`${pad(isLspId(l.orig), 20)}${local ? "* " : "  "}${pad(hex8(l.seq), 13)}${pad(csum(l.csum), 14)}${pad(`${lifeLeft(s, l)} /${local ? "*" : "1200"}`, 19)}${attPolText(l)}`);
      if (detail) {
        out.push(`  Area Address:   ${l.area}`, "  NLPID:          0xcc", `  Hostname:       ${l.orig}`, `  IP Address:     ${IS_LO[l.orig]}`);
        for (const n of l.nbrs) out.push(`  Metric: ${pad(n.metric, 10)} IS-Extended ${n.to}.00`);
        for (const p of l.pfx) out.push(`  Metric: ${pad(p.metric, 10)} IP-Extended ${p.p}/${p.len}`);
      }
    }
    if (!only) out.push("", ` Total Level-${lvl} LSP count: ${lsps.length}     Local Level-${lvl} LSP count: ${lsps.some((l) => l.orig === r) ? 1 : 0}`);
    out.push("");
  }
  return out.length ? out.join("\n").trimEnd() : `% No LSP ${only} found`;
}
function xrIfBrief(s: IsState, r: IsR): string {
  if (!isRunning(s.cfg, r) && !s.cfg[r].on) return "% IS-IS instance CORE is not running";
  const rows: string[] = [];
  const c = s.cfg[r];
  if (c.lo) rows.push(`${pad("Lo0", 19)}${pad("Yes", 7)}-    -      0/0        1/1     No       -    -    -`);
  for (const i of isIfs(r)) {
    const f = c.ifs[i.ifn]!;
    if (!f.isis) continue;
    const lv = ifLevels(s.cfg, r, i.ifn);
    const a = s.adj[adjKey(r, i.ifn)];
    const up = a?.state === "UP" ? 1 : 0;
    const ok = lv.length && linkUp(s, i.link) ? "Yes" : "No";
    const clns = f.shut || !linkUp(s, i.link) ? "Down" : f.iso ? "Up" : "Down";
    rows.push(`${pad(xrIf(i.ifn, true), 19)}${pad(ok, 5)}${pad(lv.includes(1) ? up : "-", 5)}${pad(lv.includes(2) ? up : "-", 7)}${pad(lv.length ? "1/1" : "0/1", 11)}${pad(f.passive ? "1/1" : lv.length ? "1/1" : "0/1", 10)}${pad(clns, 6)}${pad(f.mtu - 17, 6)}-    -`);
  }
  return ["IS-IS CORE Interfaces", "    Interface      All     Adjs    Adj Topos  Adv Topos  CLNS   MTU    Prio", "                   OK    L1   L2    Run/Cfg    Run/Cfg                L1   L2", "-----------------  ---  ---------  ---------  ---------  ----  ----  --------", ...rows].join("\n");
}
function xrIfDetail(s: IsState, r: IsR, ifn: string): string {
  const c = s.cfg[r];
  if (ifn === "lo0") {
    if (!c.lo) return "% Interface Loopback0 is not configured in IS-IS instance CORE";
    return ["Loopback0                   Enabled", "  Adjacency Formation:      Disabled (Passive)", "  Prefix Advertisement:     Running", "", `  Circuit Type:             ${c.isType}`, "  Media Type:               Loop", "", "  IPv4 Unicast Topology:    Enabled", "    Adjacency Formation:    Disabled (Passive)", "    Prefix Advertisement:   Running", "    Metric (L1/L2):         10/10"].join("\n");
  }
  const i = isIf(r, ifn)!;
  const f = c.ifs[i.ifn]!;
  if (!f.isis) return `% Interface ${xrIf(ifn)} is not configured in IS-IS instance CORE`;
  const lv = ifLevels(s.cfg, r, i.ifn);
  const eff = lv.length === 2 ? "level-1-2" : lv[0] === 1 ? "level-1" : lv[0] === 2 ? "level-2-only" : "none";
  const a = s.adj[adjKey(r, i.ifn)];
  const run = f.passive ? "Disabled (Passive)" : lv.length && linkUp(s, i.link) ? "Running" : "Disabled (No topologies)";
  const lvBlock = (l: Lvl) => [`  Level-${l}`, `    Adjacency Count:        ${a?.state === "UP" && a.lvls.includes(l) ? 1 : 0}`, "    LSP Pacing Interval:    33 ms", "    PSNP Entry Queue Size:  0", `    Hello Interval:         ${10} s`, "    Hello Multiplier:       3", ""];
  return [
    `${xrIf(ifn)}      Enabled`,
    `  Adjacency Formation:      ${run}`,
    `  Prefix Advertisement:     ${lv.length ? "Running" : "Disabled"}`,
    "  IPv4 BFD:                 Disabled",
    "  IPv6 BFD:                 Disabled",
    "  Bandwidth:                1000000",
    "",
    `  Circuit Type:             ${eff} (Interface circuit type is ${f.circuit})`,
    "  Media Type:               P2P",
    `  Circuit Number:           0`,
    `  Extended Circuit Number:  ${Number(ifn.slice(-1)) + 3}`,
    `  Next P2P IIH in:          ${(s.clock % 10) + 1} s`,
    "  LSP Rexmit Queue Size:    0",
    "",
    ...lv.flatMap(lvBlock),
    "  CLNS I/O",
    `    Protocol State:         ${f.shut || !linkUp(s, i.link) || !f.iso ? "Down" : "Up"}`,
    `    MTU:                    ${f.mtu - 17}`,
    `    SNPA:                   ${isMac(r, i.ifn).toLowerCase().replace(/:/g, "").replace(/(.{4})(?=.)/g, "$1.")}`,
    "    Layer-2 MCast Groups Membership:",
    "      All ISs:              Yes",
    "",
    "  IPv4 Unicast Topology:    Enabled",
    `    Adjacency Formation:    ${run}`,
    `    Prefix Advertisement:   ${lv.length ? "Running" : "Disabled"}`,
    `    Metric (L1/L2):         ${f.metric}/${f.metric}`,
    "    Weight (L1/L2):         0/0",
    "    MPLS LDP Sync (L1/L2):  Disabled/Disabled",
    `  IPv4 Address Family:      Enabled`,
    "    Protocol State:         Up",
    `    Forwarding Address(es): ${i.ip}`,
    "    Global Prefix(es):      " + `${i.link.net}/31`,
  ].join("\n");
}
function xrTopology(s: IsState, r: IsR): string {
  if (!isRunning(s.cfg, r)) return "% IS-IS instance CORE is not running";
  const out: string[] = [];
  for (const lvl of [1, 2] as Lvl[]) {
    if (!levelsOfType(s.cfg[r].isType).includes(lvl)) continue;
    const tree = spfTree(s.db, r, lvl);
    out.push(`IS-IS CORE paths to IPv4 Unicast (Level-${lvl}) routers`, "System Id          Metric    Next-Hop           Interface       SNPA");
    for (const o of IS_ROUTERS) {
      if (!s.db[r][lvl][o]) continue;
      const n = tree.find((x) => x.r === o);
      if (o === r) {
        out.push(`${pad(o, 19)}--`);
        continue;
      }
      if (!n) {
        out.push(`${pad(o, 19)}**`);
        continue;
      }
      n.first.forEach((f, k) => {
        const i = isIfs(r).find((x) => s.adj[adjKey(r, x.ifn)]?.nbr === f && s.adj[adjKey(r, x.ifn)]?.state === "UP")!;
        out.push(`${pad(k === 0 ? o : "", 19)}${pad(k === 0 ? n.dist : "", 10)}${pad(f, 19)}${pad(xrIf(i.ifn, true), 16)}*PtoP*`);
      });
    }
    out.push("");
  }
  return out.join("\n").trimEnd();
}
const XR_CODES = [
  "Codes: C - connected, S - static, R - RIP, B - BGP, (>) - Diversion path",
  "       D - EIGRP, EX - EIGRP external, O - OSPF, IA - OSPF inter area",
  "       N1 - OSPF NSSA external type 1, N2 - OSPF NSSA external type 2",
  "       E1 - OSPF external type 1, E2 - OSPF external type 2, E - EGP",
  "       i - ISIS, L1 - IS-IS level-1, L2 - IS-IS level-2",
  "       ia - IS-IS inter area, su - IS-IS summary null, * - candidate default",
  "       U - per-user static route, o - ODR, L - local, G  - DAGR, l - LISP",
  "       A - access/subscriber, a - Application route",
  "       M - mobile route, r - RPL, t - Traffic Engineering, (!) - FRR Backup path",
  "",
  "Gateway of last resort is not set",
  "",
];
function xrRouteLines(s: IsState, r: IsR, rt: IsRoute): string[] {
  const p = `${rt.p}/${rt.len}`;
  if (rt.kind === "C" || rt.kind === "L") return [`${pad(rt.kind, 5)}${p} is directly connected, ${spAge(s.clock, 0)}, ${xrIf(rt.ifn!)}`];
  const head = `${pad(rt.kind, 5)}${p}`;
  return rt.nh.map((h, k) => `${k === 0 ? pad(head, 22) : pad("", 22)}[115/${rt.metric}] via ${h.ip}, ${sinceOf(s, r, rt)}, ${xrIf(h.ifn)}`);
}
function xrRoute(s: IsState, r: IsR, filter?: "isis"): string {
  const rs = rib(s, r).filter((x) => !filter || x.kind.startsWith("i"));
  return [...(filter ? [] : XR_CODES), ...rs.flatMap((x) => xrRouteLines(s, r, x))].join("\n");
}
function xrRouteIp(s: IsState, r: IsR, ip: string): string {
  const rt = lookup(rib(s, r), ip);
  if (!rt) return "% Network not in table";
  const p = `${rt.p}/${rt.len}`;
  if (rt.kind === "C" || rt.kind === "L") return [`Routing entry for ${p}`, `  Known via "${rt.kind === "C" ? "connected" : "local"}", distance 0, metric 0 (connected)`, `  Installed ${spStamp(0).xr.replace(" UTC", "")} for ${spAge(s.clock, 0)}`, "  Routing Descriptor Blocks", `    directly connected, via ${xrIf(rt.ifn!)}`, "      Route metric is 0", "  No advertising protos."].join("\n");
  const owner = ownerOf(rt.p) ?? IS_ROUTERS.find((o) => s.db[r][2][o]?.pfx.some((x) => x.p === rt.p));
  return [`Routing entry for ${p}`, `  Known via "isis CORE", distance 115, metric ${rt.metric}, type level-${rt.kind.slice(-1)}`, `  Installed ${spStamp(s.clock).xr.replace(" UTC", "")} for ${sinceOf(s, r, rt)}`, "  Routing Descriptor Blocks", ...rt.nh.flatMap((h) => [`    ${h.ip}, from ${owner ? IS_LO[owner] : h.ip}, via ${xrIf(h.ifn)}`, `      Route metric is ${rt.metric}`]), "  No advertising protos."].join("\n");
}
function xrIsisRoute(s: IsState, r: IsR): string {
  const rs = rib(s, r).filter((x) => x.kind.startsWith("i"));
  return [
    "IS-IS CORE IPv4 Unicast routes",
    "",
    "Codes: L1 - level 1, L2 - level 2, ia - interarea (leaked into level 1)",
    "       df - level 1 default (closest attached router), su - summary null",
    "       C - connected, S - static, R - RIP, B - BGP, O - OSPF",
    "       E - EIGRP, A - access/subscriber, M - mobile, a - application",
    "       i - IS-IS (redistributed from another instance)",
    "",
    "Maximum parallel path count: 8",
    "",
    ...rs.flatMap((x) => [`${x.kind.slice(2)} ${x.p}/${x.len} [${x.metric}/115]`, ...x.nh.map((h) => `     via ${h.ip}, ${xrIf(h.ifn)}, ${h.nbr}, Weight: 0`)]),
  ].join("\n");
}
function xrSpfLog(s: IsState, r: IsR): string {
  const rows = s.spf[r].slice(-12);
  return ["   IS-IS CORE Level 2 IPv4 Unicast Route Calculation Log", "                    Time Total Trig.", "Timestamp    Type   (ms) Nodes Count First Trigger LSP    Triggers", "------------ ----- ----- ----- ----- -------------------- -----------------------", `--- ${DAY} ---`, ...rows.map((x) => `${spStamp(x.t).hms}.000  ${pad(x.trig === "NEWLSP" ? "PRC" : "FSPF", 5)}${lpad(1, 4)}${lpad(x.nodes, 6)}${lpad(1, 6)}${lpad(x.first, 21)}  ${x.trig}`)].join("\n");
}
function xrHostname(s: IsState, r: IsR): string {
  return ["IS-IS CORE hostnames", "Level  System ID      Dynamic Hostname", ...IS_ROUTERS.filter((o) => s.db[r][2][o] || o === r).map((o) => ` 2   ${o === r ? "*" : " "} ${IS_SYS[o]} ${o}`)].join("\n");
}
function xrIpBrief(s: IsState, r: IsR): string {
  const rows = [`${pad("Loopback0", 31)}${pad(IS_LO[r], 16)}${pad("Up", 16)}${pad("Up", 9)}default`];
  for (const i of isIfs(r)) {
    const f = s.cfg[r].ifs[i.ifn]!;
    const st = f.shut ? "Shutdown" : "Up";
    const pr = f.shut || !linkUp(s, i.link) ? "Down" : "Up";
    rows.push(`${pad(xrIf(i.ifn), 31)}${pad(i.ip, 16)}${pad(st, 16)}${pad(pr, 9)}default`);
  }
  return ["", "Interface                      IP-Address      Status          Protocol Vrf-Name", ...rows].join("\n");
}
function xrIntBrief(s: IsState, r: IsR): string {
  return ["", "               Intf       Intf        LineP              Encap  MTU        BW", "               Name       State       State               Type (byte)    (Kbps)", "--------------------------------------------------------------------------------", `${lpad("Lo0", 19)}${lpad("up", 12)}${lpad("up", 12)}${lpad("Loopback", 19)}${lpad(1500, 6)}${lpad(0, 11)}`, ...isIfs(r).map((i) => {
    const f = s.cfg[r].ifs[i.ifn]!;
    return `${lpad(xrIf(i.ifn, true), 19)}${lpad(f.shut ? "admin-down" : "up", 12)}${lpad(f.shut ? "admin-down" : linkUp(s, i.link) ? "up" : "down", 12)}${lpad("ARPA", 19)}${lpad(f.mtu, 6)}${lpad(1000000, 11)}`;
  })].join("\n");
}
function xrInterface(s: IsState, r: IsR, ifn: string): string {
  if (ifn === "lo0") return ["Loopback0 is up, line protocol is up", "  Interface state transitions: 1", "  Hardware is Loopback interface(s)", `  Internet address is ${IS_LO[r]}/32`, "  MTU 1500 bytes, BW 0 Kbit", "     reliability Unknown, txload Unknown, rxload Unknown", "  Encapsulation Loopback,  loopback not set,"].join("\n");
  const i = isIf(r, ifn)!;
  const f = s.cfg[r].ifs[i.ifn]!;
  const c = s.ctr[`${r} ${ifn}`];
  const up = !f.shut && linkUp(s, i.link);
  const mac = isMac(r, i.ifn).toLowerCase().replace(/:/g, "").replace(/(.{4})(?=.)/g, "$1.");
  return [
    `${xrIf(ifn)} is ${f.shut ? "administratively down" : up ? "up" : "down"}, line protocol is ${up ? "up" : f.shut ? "administratively down" : "down"} `,
    "  Interface state transitions: 1",
    `  Hardware is GigabitEthernet, address is ${mac} (bia ${mac})`,
    `  Description: to ${i.peer}`,
    `  Internet address is ${i.ip}/31`,
    `  MTU ${f.mtu} bytes, BW 1000000 Kbit (Max: 1000000 Kbit)`,
    "     reliability 255/255, txload 0/255, rxload 0/255",
    "  Encapsulation ARPA,",
    "  Full-duplex, 1000Mb/s, link type is force-up",
    "  Last input 00:00:01, output 00:00:01",
    "  Last clearing of \"show interface\" counters never",
    `     ${c.pktIn + c.iihIn + c.lspIn + c.giants} packets input, ${(c.pktIn + c.iihIn) * 120 + c.giants * (s.cfg[i.peer].ifs[i.peerIf]!.mtu)} bytes, 0 total input drops`,
    "     0 drops for unrecognized upper-level protocol",
    `     Received 0 broadcast packets, ${c.iihIn + c.lspIn + c.giants} multicast packets`,
    `              0 runts, ${c.giants} giants, 0 throttles, 0 parity`,
    `     ${c.giants} input errors, 0 CRC, 0 frame, 0 overrun, 0 ignored, 0 abort`,
    `     ${c.pktOut + c.iihOut + c.lspOut} packets output, ${(c.pktOut + c.iihOut) * 120} bytes, 0 total output drops`,
    `     Output 0 broadcast packets, ${c.iihOut + c.lspOut} multicast packets`,
    "     0 output errors, 0 underruns, 0 applique, 0 resets",
  ].join("\n");
}
function xrLogging(s: IsState, r: IsR): string {
  const lines = s.sys.filter((x) => x.dev === r).slice(-30).map((x) => {
    const st = `RP/0/RP0/CPU0:${spStamp(x.t).xr}`;
    const ifn = x.ifn ? xrIf(x.ifn) : "";
    switch (x.kind) {
      case "adj-up":
        return `${st}: isis[1012]: %ROUTING-ISIS-5-ADJCHANGE : Adjacency to ${x.nbr} (${ifn}) (L${x.lvl}) Up, New adjacency`;
      case "adj-down":
        return `${st}: isis[1012]: %ROUTING-ISIS-5-ADJCHANGE : Adjacency to ${x.nbr} (${ifn}) (L${x.lvl}) Down, ${x.why === "hold time expired" ? "Hold time expired" : x.why === "interface down" ? "Interface state down" : x.why === "level change" ? "Level change" : "Neighbor forgot us"}`;
      case "auth":
        return `${st}: isis[1012]: %ROUTING-ISIS-4-AUTH_FAILURE_DROP : Dropped L2 IIH from ${ifn} SNPA ${isMac(x.nbr!, isIfs(x.nbr!).find((i) => i.peer === r)!.ifn).toLowerCase().replace(/:/g, "").replace(/(.{4})(?=.)/g, "$1.")} due to ${x.why === "authentication TLV not found" ? "authentication TLV not found" : "authentication failure"}`;
      case "commit":
        return `${st}: config[65857]: %MGBL-CONFIG-6-DB_COMMIT : Configuration committed by user 'admin'. Use 'show commit changes ${1000000000 + x.t}' to view the changes.`;
      default:
        return "";
    }
  }).filter(Boolean);
  return ["Syslog logging: enabled (0 messages dropped, 0 flushes, 0 overruns)", "    Console logging: level warnings, 0 messages logged", "    Buffer logging: level debugging, " + lines.length + " messages logged", "", "Log Buffer (2097152 bytes):", "", ...lines].join("\n");
}
function xrPing(s: IsState, r: IsR, dst: string, src: string, count = 5): string {
  const p = pingResult(s, r, dst, src);
  const ch = p.ok ? "!" : p.kind === "noreply" ? "." : "U";
  const head = ["Type escape sequence to abort.", `Sending ${count}, 100-byte ICMP Echos to ${dst} timeout is 2 seconds:`];
  if (p.kind === "noroute") return [...head, ".".repeat(count), `Success rate is 0 percent (0/${count})`].join("\n");
  return [...head, ch.repeat(count), p.ok ? `Success rate is 100 percent (${count}/${count}), round-trip min/avg/max = 1/2/4 ms` : `Success rate is 0 percent (0/${count})`].join("\n");
}
function xrTrace(s: IsState, r: IsR, dst: string, src: string): string {
  const fwd = forward(s.cfg, s.phys, s.adj, s.db, r, src, dst);
  const out = ["", "Type escape sequence to abort.", `Tracing the route to ${dst}`, ""];
  fwd.hops.slice(1).forEach((h, k) => {
    const last = k === fwd.hops.length - 2;
    const addr = last && fwd.result === "ok" ? dst : isIf(h.r, h.inIf!)!.ip;
    out.push(` ${k + 1}  ${addr} ${last && fwd.result === "unreach" ? "!N  !N  !N" : `${2 + k} msec  ${1 + k} msec  ${2 + k} msec`}`);
  });
  if (fwd.result === "unreach" && fwd.hops.length === 1) out.push(" 1  *  *  *");
  if (fwd.result === "ok") {
    const back = forward(s.cfg, s.phys, s.adj, s.db, fwd.at, dst, src);
    if (back.result !== "ok") return [...out.slice(0, 4), ...fwd.hops.slice(1).map((_, k) => ` ${k + 1}  *  *  *`)].join("\n");
  }
  return out.join("\n");
}

// ---------------------------------------------------------------------------------------------------------------
// Junos outputs
// ---------------------------------------------------------------------------------------------------------------
function jnAdjacency(s: IsState, r: IsR, detail: boolean): string {
  const rows = isIfs(r).filter((i) => s.adj[adjKey(r, i.ifn)]);
  if (!rows.length) return isRunning(s.cfg, r) ? "" : "IS-IS instance is not running";
  if (detail)
    return rows
      .map((i) => {
        const a = s.adj[adjKey(r, i.ifn)];
        const lv = a.lvls.length ? a.lvls : ifLevels(s.cfg, r, i.ifn);
        return [a.nbr, `  Interface: ${jnIf(i.ifn)}, Level: ${lv.length === 2 ? 3 : lv[0]}, State: ${a.state === "UP" ? "Up" : "Initializing"}, Expires in ${holdLeft(s, r, i.ifn)} secs`, `  Priority: 0, Up/Down transitions: 1, Last transition: ${spAge(s.clock, a.since)} ago`, `  Circuit type: ${lv.length === 2 ? 3 : lv[0]}, Speaks: IP, IPv6`, "  Topologies: Unicast", "  Restart capable: Yes, Adjacency advertisement: Advertise", `  IP addresses: ${i.peerIp}`].join("\n");
      })
      .join("\n\n");
  return ["Interface             System         L State         Hold (secs) SNPA", ...rows.map((i) => {
    const a = s.adj[adjKey(r, i.ifn)];
    const lv = a.lvls.length ? a.lvls : ifLevels(s.cfg, r, i.ifn);
    return `${pad(jnIf(i.ifn), 22)}${pad(a.nbr, 15)}${pad(lv.length === 2 ? 3 : lv[0], 2)}${pad(a.state === "UP" ? "Up" : "Initializing", 14)}${lpad(holdLeft(s, r, i.ifn), 11)}`;
  })].join("\n");
}
function jnDatabase(s: IsState, r: IsR, detail: boolean, only?: string): string {
  if (!isRunning(s.cfg, r)) return "IS-IS instance is not running";
  const out: string[] = [];
  for (const lvl of [1, 2] as Lvl[]) {
    const lsps = levelsOfType(s.cfg[r].isType).includes(lvl) ? IS_ROUTERS.map((o) => s.db[r][lvl][o]).filter((l): l is IsLsp => !!l && (!only || isLspId(l.orig) === only)) : [];
    if (only && !lsps.length) continue;
    out.push(`IS-IS level ${lvl} link-state database:`);
    if (!detail) {
      if (lsps.length) out.push("LSP ID                      Sequence Checksum Lifetime Attributes");
      for (const l of lsps) out.push(`${pad(isLspId(l.orig), 28)}${lpad(`0x${l.seq.toString(16)}`, 8)}${lpad(csum(l.csum), 9)}${lpad(lifeLeft(s, l), 9)} L1 L2${l.ol ? " Overload" : ""}`);
      out.push(`  ${lsps.length} LSPs`, "");
    } else {
      out.push("");
      for (const l of lsps) {
        out.push(`${isLspId(l.orig)} Sequence: 0x${l.seq.toString(16)}, Checksum: ${csum(l.csum)}, Lifetime: ${lifeLeft(s, l)} secs${l.ol ? "\n   Overload bit set" : ""}`);
        for (const n of l.nbrs) out.push(`   IS neighbor: ${pad(`${n.to}.00`, 30)}Metric: ${lpad(n.metric, 8)}`);
        for (const p of l.pfx) out.push(`   IP prefix: ${pad(`${p.p}/${p.len}`, 32)}Metric: ${lpad(p.metric, 8)} Internal Up`);
        out.push("");
      }
    }
  }
  return out.join("\n").trimEnd();
}
function jnInterface(s: IsState, r: IsR): string {
  if (!isRunning(s.cfg, r)) return "IS-IS instance is not running";
  const rows: string[] = [];
  const lv1 = levelsOfType(s.cfg[r].isType).includes(1);
  for (const i of isIfs(r)) {
    const f = s.cfg[r].ifs[i.ifn]!;
    if (!f.isis) continue;
    const lv = ifLevels(s.cfg, r, i.ifn);
    const L = lv.length === 2 ? 3 : (lv[0] ?? 0);
    const d1 = !lv.includes(1) ? "Disabled" : f.passive ? "Passive" : "Point to Point";
    const d2 = !lv.includes(2) ? "Disabled" : f.passive ? "Passive" : "Point to Point";
    rows.push(`${pad(jnIf(i.ifn), 22)}${pad(L, 4)}${pad("0x1", 6)}${pad(d1, 18)}${pad(d2, 21)}${f.metric}/${f.metric}`);
  }
  if (s.cfg[r].lo) rows.push(`${pad("lo0.0", 22)}${pad(0, 4)}${pad("0x1", 6)}${pad(lv1 ? "Passive" : "Disabled", 18)}${pad("Passive", 21)}10/10`);
  return ["IS-IS interface database:", "Interface             L CirID Level 1 DR        Level 2 DR        L1/L2 Metric", ...rows].join("\n");
}
function jnIsisRoute(s: IsState, r: IsR): string {
  const rs = rib(s, r).filter((x) => x.kind.startsWith("i"));
  const ver = s.spf[r].length;
  return [` IS-IS routing table             Current version: L1: 0 L2: ${ver}`, "IPv4/IPv6 Routes", "----------------", "Prefix             L Version   Metric Type Interface       NH   Via", ...rs.flatMap((x) => x.nh.map((h, k) => (k === 0 ? `${pad(`${x.p}/${x.len}`, 19)}${pad(x.kind.slice(-1), 2)}${lpad(ver, 7)}${lpad(x.metric, 9)} ${pad("int", 5)}${pad(jnIf(h.ifn), 16)}${pad("IPV4", 5)}${h.nbr}` : `${pad("", 43)}${pad(jnIf(h.ifn), 16)}${pad("IPV4", 5)}${h.nbr}`)))].join("\n");
}
function jnRouteEntry(s: IsState, r: IsR, x: IsRoute): string[] {
  const p = `${x.p}/${x.len}`;
  if (x.kind === "C") return [`${pad(p, 19)}*[Direct/0] ${spAge(s.clock, 0)}`, `                    >  via ${jnIf(x.ifn!)}`];
  if (x.kind === "L") return [`${pad(p, 19)}*[Local/0] ${spAge(s.clock, 0)}`, `                       Local via ${jnIf(x.ifn!)}`];
  return [`${pad(p, 19)}*[IS-IS/${x.kind === "i L1" ? 15 : 18}] ${sinceOf(s, r, x)}, metric ${x.metric}`, ...x.nh.map((h) => `                    >  to ${h.ip} via ${jnIf(h.ifn)}`)];
}
function jnRoute(s: IsState, r: IsR, which: "all" | "isis" | string): string {
  const all = rib(s, r);
  let rs = all;
  if (which === "isis") rs = all.filter((x) => x.kind.startsWith("i"));
  else if (which !== "all") {
    const best = lookup(all, which);
    rs = best ? [best] : [];
  }
  const head = `inet.0: ${all.length} destinations, ${all.length} routes (${all.length} active, 0 holddown, 0 hidden)`;
  if (!rs.length) return "";
  return [head, "+ = Active Route, - = Last Active, * = Both", "", ...rs.flatMap((x) => jnRouteEntry(s, r, x))].join("\n");
}
function jnSpfLog(s: IsState, r: IsR): string {
  const rows = s.spf[r].slice(-12);
  return ["IS-IS level 2 SPF log:", "Start time          Elapsed (secs) Count Reason", ...rows.map((x) => `${pad(`Sun Oct 11 ${spStamp(x.t).hms}`, 20)}${lpad("0.000071", 14)}${lpad(1, 6)} ${x.trig === "NEWADJ" ? "New adjacency" : x.trig === "DELADJ" ? "Lost adjacency" : `Updated LSP ${x.first}`}`)].join("\n");
}
function jnHostname(s: IsState, r: IsR): string {
  return ["IS-IS hostname database:", "System ID      Hostname                       Type", ...IS_ROUTERS.filter((o) => s.db[r][2][o] || o === r).map((o) => `${IS_SYS[o]} ${pad(o, 31)}${o === r ? "Local" : "Dynamic"}`)].join("\n");
}
function jnStatistics(s: IsState, r: IsR): string {
  const sum = (k: keyof IsState["ctr"][string]) => isIfs(r).reduce((a, i) => a + (s.ctr[`${r} ${i.ifn}`]?.[k] ?? 0), 0);
  const iihIn = sum("iihIn");
  const drop = sum("iihDrop");
  const lspIn = sum("lspIn");
  const row = (n: string, rx: number, pr: number, dr: number, tx: number) => `${pad(n, 15)}${lpad(rx, 8)}${lpad(pr, 13)}${lpad(dr, 13)}${lpad(tx, 13)}${lpad(0, 13)}`;
  return [`IS-IS statistics for ${r}:`, "PDU type       Received    Processed        Drops         Sent       Rexmit", row("LSP", lspIn, lspIn, 0, sum("lspOut")), row("IIH", iihIn, iihIn - drop, drop, sum("iihOut")), row("CSNP", 0, 0, 0, 0), row("PSNP", lspIn, lspIn, 0, sum("lspIn")), row("Unknown", 0, 0, 0, 0), row("Totals", iihIn + 2 * lspIn, iihIn - drop + 2 * lspIn, drop, sum("iihOut") + sum("lspOut") + lspIn), "", `Total packets received: ${iihIn + 2 * lspIn} Sent: ${sum("iihOut") + sum("lspOut") + lspIn}`, "", "SNP queue length:                0 Drops:                0", "LSP queue length:                0 Drops:                0", `SPF runs:                     ${lpad(s.spf[r].length, 3)}`, `LSP regenerations:            ${lpad(Object.values(s.own[r]).reduce((a, l) => a + (l?.seq ?? 0), 0), 3)}`, `Authentication failures:      ${lpad(sum("authFail"), 3)}`].join("\n");
}
function jnTerse(s: IsState, r: IsR): string {
  const rows: string[] = [];
  for (const i of isIfs(r)) {
    const f = s.cfg[r].ifs[i.ifn]!;
    const admin = f.shut ? "down" : "up";
    const link = !f.shut && linkUp(s, i.link) ? "up" : "down";
    rows.push(`${pad(i.ifn, 24)}${pad(admin, 6)}${link}`, `${pad(`${i.ifn}.0`, 24)}${pad(admin, 6)}${pad(link, 5)}${pad("inet", 9)}${i.ip}/31`);
    if (f.iso) rows.push(`${pad("", 35)}iso`);
  }
  rows.push(`${pad("lo0", 24)}${pad("up", 6)}up`, `${pad("lo0.0", 24)}${pad("up", 6)}${pad("up", 5)}${pad("inet", 9)}${pad(IS_LO[r], 22)}--> 0/0`);
  if (s.cfg[r].net) rows.push(`${pad("", 35)}${pad("iso", 9)}${s.cfg[r].net}`);
  return ["Interface               Admin Link Proto    Local                 Remote", ...rows].join("\n");
}
function jnInterfaceShow(s: IsState, r: IsR, ifn: string, extensive: boolean): string {
  if (ifn === "lo0") return ["Physical interface: lo0, Enabled, Physical link is Up", "  Interface index: 6, SNMP ifIndex: 6", "  Type: Loopback, MTU: Unlimited", "", "  Logical interface lo0.0 (Index 321) (SNMP ifIndex 16)", "    Flags: SNMP-Traps Encapsulation: Unspecified", `    Protocol inet, MTU: Unlimited`, `      Addresses, Flags: Is-Default Is-Primary`, `        Local: ${IS_LO[r]}`].join("\n");
  const i = isIf(r, ifn)!;
  const f = s.cfg[r].ifs[i.ifn]!;
  const c = s.ctr[`${r} ${ifn}`];
  const up = !f.shut && linkUp(s, i.link);
  return [
    `Physical interface: ${ifn}, ${f.shut ? "Administratively down" : "Enabled"}, Physical link is ${up ? "Up" : "Down"}`,
    `  Interface index: ${148 + Number(ifn.slice(-1))}, SNMP ifIndex: ${526 + Number(ifn.slice(-1))}`,
    `  Description: to ${i.peer}`,
    `  Link-level type: Ethernet, MTU: ${f.mtu}, Link-mode: Full-duplex, Speed: 1000mbps,`,
    `  Current address: ${isMac(r, i.ifn).toLowerCase()}, Hardware address: ${isMac(r, i.ifn).toLowerCase()}`,
    `  Input packets : ${c.pktIn + c.iihIn + c.lspIn}`,
    `  Output packets: ${c.pktOut + c.iihOut + c.lspOut}`,
    ...(extensive
      ? ["  Input errors:", `    Errors: ${c.giants}, Drops: 0, Framing errors: 0, Runts: 0, Policed discards: 0, L3 incompletes: 0, L2 channel errors: 0, L2 mismatch timeouts: 0, FIFO errors: 0, Resource errors: 0`, "  MAC statistics:                      Receive         Transmit", `    Total octets                     ${lpad((c.pktIn + c.iihIn) * 120, 9)}        ${lpad((c.pktOut + c.iihOut) * 120, 9)}`, `    Total packets                    ${lpad(c.pktIn + c.iihIn + c.lspIn + c.giants, 9)}        ${lpad(c.pktOut + c.iihOut + c.lspOut, 9)}`, `    Oversized frames                 ${lpad(c.giants, 9)}`, "    Jabber frames                            0", "    Code violations                          0"]
      : []),
    "",
    `  Logical interface ${ifn}.0 (Index ${330 + Number(ifn.slice(-1))}) (SNMP ifIndex ${540 + Number(ifn.slice(-1))})`,
    "    Flags: Up SNMP-Traps 0x4004000 Encapsulation: ENET2",
    `    Protocol inet, MTU: ${f.mtu - 14}`,
    "      Addresses, Flags: Is-Preferred Is-Primary",
    `        Destination: ${i.link.net}/31, Local: ${i.ip}`,
    ...(f.iso ? [`    Protocol iso, MTU: ${f.mtu - 17}`] : []),
  ].join("\n");
}
function jnLog(s: IsState, r: IsR): string {
  return s.sys
    .filter((x) => x.dev === r)
    .slice(-30)
    .map((x) => {
      const st = `${spStamp(x.t).junos}  ${r}`;
      switch (x.kind) {
        case "adj-up":
          return `${st} rpd[1532]: RPD_ISIS_ADJUP: IS-IS new L${x.lvl} adjacency to ${x.nbr} on ${jnIf(x.ifn!)}`;
        case "adj-down":
          return `${st} rpd[1532]: RPD_ISIS_ADJDOWN: IS-IS lost L${x.lvl} adjacency to ${x.nbr} on ${jnIf(x.ifn!)}, reason: ${x.why === "hold time expired" ? "Aged Out" : x.why === "interface down" ? "Interface Down" : x.why === "level change" ? "Level Changed" : "3-Way Handshake Failed"}`;
        case "commit":
          return `${st} mgd[4417]: UI_COMMIT: User 'admin' requested 'commit' operation (comment: none)`;
        default:
          return "";
      }
    })
    .filter(Boolean)
    .join("\n");
}
function jnPing(s: IsState, r: IsR, dst: string, src: string, count: number, stopped: boolean): string {
  const p = pingResult(s, r, dst, src);
  const lines = [`PING ${dst} (${dst}): 56 data bytes`];
  if (p.ok) for (let k = 0; k < count; k++) lines.push(`64 bytes from ${dst}: icmp_seq=${k} ttl=${p.ttl} time=${(1.6 + ((k * 0.37) % 0.9)).toFixed(3)} ms`);
  else if (p.kind === "unreach" && p.at && p.at !== r) for (let k = 0; k < count; k++) lines.push(`36 bytes from ${isIfs(p.at)[0].ip}: Destination Net Unreachable`);
  else if (p.kind === "noroute") lines.push("ping: sendto: No route to host");
  if (stopped) lines.push("^C");
  lines.push(`--- ${dst} ping statistics ---`, `${count} packets transmitted, ${p.ok ? count : 0} packets received, ${p.ok ? 0 : 100}% packet loss`);
  if (p.ok) lines.push("round-trip min/avg/max/stddev = 1.601/1.902/2.413/0.301 ms");
  return lines.join("\n");
}
function jnTrace(s: IsState, r: IsR, dst: string, src: string): string {
  const fwd = forward(s.cfg, s.phys, s.adj, s.db, r, src, dst);
  const out = [`traceroute to ${dst} (${dst}), 30 hops max, 52 byte packets`];
  let backOk = true;
  if (fwd.result === "ok") backOk = forward(s.cfg, s.phys, s.adj, s.db, fwd.at, dst, src).result === "ok";
  fwd.hops.slice(1).forEach((h, k) => {
    const last = k === fwd.hops.length - 2;
    const addr = last && fwd.result === "ok" ? dst : isIf(h.r, h.inIf!)!.ip;
    if (!backOk) out.push(` ${k + 1}  * * *`);
    else out.push(` ${k + 1}  ${addr} (${addr})  ${(1.5 + k * 0.4).toFixed(3)} ms${last && fwd.result === "unreach" ? " !N" : ""}  ${(1.3 + k * 0.4).toFixed(3)} ms${last && fwd.result === "unreach" ? " !N" : ""}  ${(1.4 + k * 0.4).toFixed(3)} ms${last && fwd.result === "unreach" ? " !N" : ""}`);
  });
  if (fwd.result === "unreach" && fwd.hops.length === 1) out.push("traceroute: sendto: No route to host");
  return out.join("\n");
}

// ---------------------------------------------------------------------------------------------------------------
// Configuration as each OS prints it
// ---------------------------------------------------------------------------------------------------------------
export function xrLines(r: IsR, c: IsRtr): string[] {
  const out: string[] = [`hostname ${r}`, "!", "interface Loopback0", ` ipv4 address ${IS_LO[r]} 255.255.255.255`, "!"];
  for (const i of isIfs(r)) {
    const f = c.ifs[i.ifn]!;
    out.push(`interface ${xrIf(i.ifn)}`, ` description to ${i.peer}`, ...(f.mtu !== DEFAULT_MTU ? [` mtu ${f.mtu}`] : []), ` ipv4 address ${i.ip} 255.255.255.254`, ...(f.shut ? [" shutdown"] : []), "!");
  }
  if (c.on) {
    out.push("router isis CORE");
    if (c.isType !== "level-1-2") out.push(` is-type ${c.isType}`);
    if (c.net) out.push(` net ${c.net}`);
    out.push(" log adjacency changes");
    if (c.overload) out.push(" set-overload-bit");
    out.push(" address-family ipv4 unicast", "  metric-style wide", " !");
    if (c.lo) out.push(" interface Loopback0", "  passive", "  address-family ipv4 unicast", "  !", " !");
    for (const i of isIfs(r)) {
      const f = c.ifs[i.ifn]!;
      if (!f.isis) continue;
      out.push(` interface ${xrIf(i.ifn)}`);
      if (f.circuit !== "level-1-2") out.push(`  circuit-type ${f.circuit}`);
      if (f.passive) out.push("  passive");
      out.push("  point-to-point");
      if (f.key) out.push(`  hello-password hmac-md5 encrypted ${keyCipher(f.key, "cisco")}`);
      out.push("  address-family ipv4 unicast", ...(f.metric !== 10 ? [`   metric ${f.metric}`] : []), "  !", " !");
    }
    out.push("!");
  }
  return out;
}
export function jnStmts(r: IsR, c: IsRtr): JStmt[] {
  const out: JStmt[] = [];
  for (const i of isIfs(r)) {
    const f = c.ifs[i.ifn]!;
    out.push({ path: ["interfaces", i.ifn], leaf: `description "to ${i.peer}"` });
    if (f.mtu !== DEFAULT_MTU) out.push({ path: ["interfaces", i.ifn], leaf: `mtu ${f.mtu}` });
    if (f.shut) out.push({ path: ["interfaces", i.ifn], leaf: "disable" });
    out.push({ path: ["interfaces", i.ifn, "unit 0", "family inet"], leaf: `address ${i.ip}/31` });
    if (f.iso) out.push({ path: ["interfaces", i.ifn, "unit 0", "family iso"], leaf: "" });
  }
  out.push({ path: ["interfaces", "lo0", "unit 0", "family inet"], leaf: `address ${IS_LO[r]}/32` });
  if (c.net) out.push({ path: ["interfaces", "lo0", "unit 0", "family iso"], leaf: `address ${c.net}` });
  out.push({ path: ["routing-options", "forwarding-table"], leaf: "export ECMP" });
  out.push({ path: ["policy-options", "policy-statement ECMP", "then"], leaf: "load-balance per-packet" });
  if (c.on) {
    const isis: JStmt[] = [];
    // Junos prints a level that holds a single statement on one line ("level 1 disable;", "level 2 metric 100;").
    const level = (p: string[], lvl: string, leaves: string[]) => (leaves.length === 1 ? [{ path: p, leaf: `${lvl} ${leaves[0]}` }] : leaves.map((leaf) => ({ path: [...p, lvl], leaf })));
    if (c.isType === "level-2-only") isis.push(...level(["protocols", "isis"], "level 1", ["disable"]));
    if (c.isType === "level-1") isis.push(...level(["protocols", "isis"], "level 2", ["disable"]));
    if (c.overload) isis.push({ path: ["protocols", "isis"], leaf: "overload" });
    for (const i of isIfs(r)) {
      const f = c.ifs[i.ifn]!;
      if (!f.isis) continue;
      const p = ["protocols", "isis", `interface ${i.ifn}.0`];
      isis.push({ path: p, leaf: "point-to-point" });
      if (f.passive) isis.push({ path: p, leaf: "passive" });
      if (f.circuit === "level-2-only") isis.push(...level(p, "level 1", ["disable"]));
      const l2 = [...(f.circuit === "level-1" ? ["disable"] : []), ...(f.metric !== 10 ? [`metric ${f.metric}`] : []), ...(f.key ? [`hello-authentication-key ${keyCipher(f.key, "juniper")}`, "hello-authentication-type md5"] : [])];
      if (l2.length) isis.push(...level(p, "level 2", l2));
    }
    if (c.lo) isis.push({ path: ["protocols", "isis", "interface lo0.0"], leaf: "passive" }, { path: ["protocols", "isis", "interface lo0.0"], leaf: "level 2 metric 10" });
    out.push(...(isis.length ? isis : [{ path: ["protocols", "isis"], leaf: "" }]));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Configuration statements (both OSes change the same configuration object)
// ---------------------------------------------------------------------------------------------------------------
const ifc = (c: IsRtr, ifn: string) => c.ifs[ifn as IfName];
const resetIf = (c: IsRtr, ifn: string) => {
  const f = ifc(c, ifn)!;
  Object.assign(f, { isis: false, passive: false, circuit: "level-1-2", metric: 10, key: "" });
};
const wipe = (c: IsRtr): IsRtr => {
  c.on = false;
  c.isType = "level-1-2";
  c.overload = false;
  c.lo = false;
  for (const k of Object.keys(c.ifs)) resetIf(c, k);
  return c;
};
function stmts(r: IsR): SpCfgStmt<IsRtr>[] {
  const P2P_NOTE = "This lab keeps every core link point-to-point (RFC 5309): broadcast circuits, DIS election and pseudonodes are explained in the Deep Dive.";
  const physOnly = (ifn: string) => (ifn === "lo0" ? "% Loopback0 is always passive in this lab: it has no neighbors to form adjacencies with." : undefined);
  return [
    { id: "router-isis", summary: "IS-IS routing protocol", args: { tag: choiceArg(["CORE"], () => "Instance tag (this lab's instance is CORE)") }, xr: { mode: "config", syntax: "router isis <tag>", enter: "isis", apply: (c) => ((c.on = true), c), no: (c) => wipe(c) } },
    { id: "interface", summary: "Select an interface to configure", args: { if: xrIfArg(r, false) }, xr: { mode: "config", syntax: "interface <if>", enter: "if" } },
    { id: "mtu", summary: "Set the interface MTU", args: { n: mtuArg }, xr: { mode: "if", syntax: "mtu <n>", noSyntax: "mtu", apply: (c, a, x) => ((ifc(c, x.if)!.mtu = +a.n), c), no: (c, _a, x) => ((ifc(c, x.if)!.mtu = DEFAULT_MTU), c) } },
    { id: "shutdown", summary: "Shutdown the selected interface", xr: { mode: "if", syntax: "shutdown", apply: (c, _a, x) => ((ifc(c, x.if)!.shut = true), c), no: (c, _a, x) => ((ifc(c, x.if)!.shut = false), c) } },
    { id: "net", summary: "A Network Entity Title (NET) for this process", args: { net: netArg }, xr: { mode: "isis", syntax: "net <net>", apply: (c, a) => ((c.net = a.net), c), no: (c) => ((c.net = ""), c) } },
    { id: "is-type", summary: "Specify the IS type for this instance", args: { level: levelArg }, xr: { mode: "isis", syntax: "is-type <level>", noSyntax: "is-type", apply: (c, a) => ((c.isType = a.level as IsType), c), no: (c) => ((c.isType = "level-1-2"), c) } },
    { id: "overload", summary: "Set the overload bit in the system LSP", xr: { mode: "isis", syntax: "set-overload-bit", apply: (c) => ((c.overload = true), c), no: (c) => ((c.overload = false), c) } },
    { id: "log-adj", summary: "Enable logging of adjacency state changes", xr: { mode: "isis", syntax: "log adjacency changes", apply: (c) => c, no: () => "% This lab keeps adjacency logging on, so show logging always has the evidence." } },
    { id: "isis-af", summary: "Enter the IPv4 unicast address family", xr: { mode: "isis", syntax: "address-family ipv4 unicast", enter: "isis-af", apply: (c) => c } },
    { id: "metric-style", summary: "Use wide (24-bit) metrics", xr: { mode: "isis-af", syntax: "metric-style wide", apply: (c) => c, no: () => "% This lab uses wide metrics only (TLV 22 / 135); narrow metrics are explained in the Deep Dive." } },
    {
      id: "isis-if",
      summary: "Enter the IS-IS interface configuration submode",
      args: { if: xrIfArg(r) },
      xr: {
        mode: "isis",
        syntax: "interface <if>",
        enter: "isis-if",
        apply: (c, a) => {
          if (a.if === "lo0") c.lo = true;
          else ifc(c, a.if)!.isis = true;
          return c;
        },
        no: (c, a) => {
          if (a.if === "lo0") c.lo = false;
          else resetIf(c, a.if);
          return c;
        },
      },
    },
    { id: "p2p", summary: "Treat the interface as point-to-point", xr: { mode: "isis-if", syntax: "point-to-point", apply: (c) => c, no: () => `% ${P2P_NOTE}` } },
    { id: "passive", summary: "Advertise the prefix but send no hellos", xr: { mode: "isis-if", syntax: "passive", apply: (c, _a, x) => (x.if === "lo0" ? c : ((ifc(c, x.if)!.passive = true), c)), no: (c, _a, x) => physOnly(x.if) ?? ((ifc(c, x.if)!.passive = false), c) } },
    { id: "circuit", summary: "Configure the circuit type for the interface", args: { level: levelArg }, xr: { mode: "isis-if", syntax: "circuit-type <level>", noSyntax: "circuit-type", apply: (c, a, x) => physOnly(x.if) ?? ((ifc(c, x.if)!.circuit = a.level as IsType), c), no: (c, _a, x) => physOnly(x.if) ?? ((ifc(c, x.if)!.circuit = "level-1-2"), c) } },
    { id: "hello-pw", summary: "Set the hello authentication password (HMAC-MD5)", args: { pw: keyArg }, xr: { mode: "isis-if", syntax: "hello-password hmac-md5 clear <pw>", apply: (c, a, x) => physOnly(x.if) ?? ((ifc(c, x.if)!.key = a.pw), c) } },
    { id: "hello-pw-no", summary: "Remove the hello authentication password", xr: { mode: "isis-if", syntax: "no hello-password", apply: (c, _a, x) => physOnly(x.if) ?? ((ifc(c, x.if)!.key = ""), c) } },
    { id: "if-af", summary: "Enter the interface IPv4 unicast address family", xr: { mode: "isis-if", syntax: "address-family ipv4 unicast", enter: "isis-if-af", apply: (c) => c } },
    { id: "metric", summary: "Set the default metric for this interface", args: { n: metricArg }, xr: { mode: "isis-if-af", syntax: "metric <n>", noSyntax: "metric", apply: (c, a, x) => (x.if === "lo0" ? "% This lab keeps Loopback0 at metric 10." : ((ifc(c, x.if)!.metric = +a.n), c)), no: (c, _a, x) => (x.if === "lo0" ? c : ((ifc(c, x.if)!.metric = 10), c)) } },

    // Junos
    { id: "j-isis", summary: "IS-IS options", junos: { syntax: "protocols isis", set: (c) => ((c.on = true), c), del: (c) => wipe(c) } },
    { id: "j-overload", summary: "Set the overload bit (no transit traffic)", junos: { syntax: "protocols isis overload", set: (c) => ((c.on = true), (c.overload = true), c), del: (c) => ((c.overload = false), c) } },
    { id: "j-level-dis", summary: "Disable IS-IS at one level", args: { l: choiceArg(["1", "2"], (x) => `Level ${x}`) }, junos: { syntax: "protocols isis level <l> disable", set: (c, a) => ((c.on = true), (c.isType = a.l === "1" ? (c.isType === "level-1" ? "level-1" : "level-2-only") : c.isType === "level-2-only" ? "level-2-only" : "level-1"), c), del: (c, a) => ((c.isType = (a.l === "1" && c.isType === "level-2-only") || (a.l === "2" && c.isType === "level-1") ? "level-1-2" : c.isType), c) } },
    {
      id: "j-if",
      summary: "Include an interface in IS-IS",
      args: { if: jnUnitArg(r) },
      junos: {
        syntax: "protocols isis interface <if>",
        set: (c, a) => {
          c.on = true;
          if (a.if === "lo0") c.lo = true;
          else ifc(c, a.if)!.isis = true;
          return c;
        },
        del: (c, a) => {
          if (a.if === "lo0") c.lo = false;
          else resetIf(c, a.if);
          return c;
        },
      },
    },
    { id: "j-p2p", summary: "Treat the interface as point-to-point", args: { if: jnUnitArg(r) }, junos: { syntax: "protocols isis interface <if> point-to-point", set: (c, a) => (a.if === "lo0" ? "error: point-to-point is not valid on a loopback interface" : ((c.on = true), (ifc(c, a.if)!.isis = true), c)), del: () => `error: ${P2P_NOTE}` } },
    { id: "j-passive", summary: "Advertise the prefix but send no hellos", args: { if: jnUnitArg(r) }, junos: { syntax: "protocols isis interface <if> passive", set: (c, a) => ((c.on = true), a.if === "lo0" ? ((c.lo = true), c) : ((ifc(c, a.if)!.isis = true), (ifc(c, a.if)!.passive = true), c)), del: (c, a) => (a.if === "lo0" ? "error: lo0.0 stays passive in this lab (a loopback has no neighbors)." : ((ifc(c, a.if)!.passive = false), c)) } },
    { id: "j-if-lvl-dis", summary: "Disable one level on this interface", args: { if: jnUnitArg(r), l: choiceArg(["1", "2"], (x) => `Level ${x}`) }, junos: { syntax: "protocols isis interface <if> level <l> disable", set: (c, a) => (a.if === "lo0" ? "error: this lab keeps lo0.0 at its defaults" : ((c.on = true), (ifc(c, a.if)!.isis = true), (ifc(c, a.if)!.circuit = a.l === "1" ? "level-2-only" : "level-1"), c)), del: (c, a) => (a.if === "lo0" ? c : ((ifc(c, a.if)!.circuit = "level-1-2"), c)) } },
    { id: "j-metric", summary: "Metric for this interface at this level", args: { if: jnUnitArg(r), l: choiceArg(["1", "2"], (x) => `Level ${x}`), n: metricArg }, junos: { syntax: "protocols isis interface <if> level <l> metric <n>", set: (c, a) => (a.if === "lo0" ? "error: this lab keeps lo0.0 at metric 10" : ((c.on = true), (ifc(c, a.if)!.isis = true), (ifc(c, a.if)!.metric = +a.n), c)), del: (c, a) => (a.if === "lo0" ? c : ((ifc(c, a.if)!.metric = 10), c)) } },
    { id: "j-metric-del", summary: "Remove the metric for this interface at this level", args: { if: jnUnitArg(r), l: choiceArg(["1", "2"], (x) => `Level ${x}`) }, junos: { syntax: "protocols isis interface <if> level <l> metric", del: (c, a) => (a.if === "lo0" ? c : ((ifc(c, a.if)!.metric = 10), c)) } },
    { id: "j-auth", summary: "Hello authentication key", args: { if: jnUnitArg(r), l: choiceArg(["1", "2"], (x) => `Level ${x}`), pw: keyArg }, junos: { syntax: "protocols isis interface <if> level <l> hello-authentication-key <pw>", set: (c, a) => (a.if === "lo0" ? "error: a loopback sends no hellos" : ((c.on = true), (ifc(c, a.if)!.isis = true), (ifc(c, a.if)!.key = a.pw), c)) } },
    { id: "j-auth-del", summary: "Remove the hello authentication key", args: { if: jnUnitArg(r), l: choiceArg(["1", "2"], (x) => `Level ${x}`) }, junos: { syntax: "protocols isis interface <if> level <l> hello-authentication-key", del: (c, a) => (a.if === "lo0" ? c : ((ifc(c, a.if)!.key = ""), c)) } },
    { id: "j-auth-type", summary: "Hello authentication type", args: { if: jnUnitArg(r), l: choiceArg(["1", "2"], (x) => `Level ${x}`), t: choiceArg(["md5"], () => "HMAC-MD5") }, junos: { syntax: "protocols isis interface <if> level <l> hello-authentication-type <t>", set: (c) => c, del: (c) => c } },
    { id: "j-mtu", summary: "Maximum transmission unit packet size", args: { if: jnPhysArg(r), n: mtuArg }, junos: { syntax: "interfaces <if> mtu <n>", set: (c, a) => (a.if === "lo0" ? "error: this lab leaves lo0's MTU alone" : ((ifc(c, a.if)!.mtu = +a.n), c)), del: (c, a) => (a.if === "lo0" ? c : ((ifc(c, a.if)!.mtu = DEFAULT_MTU), c)) } },
    { id: "j-mtu-del", summary: "Restore the default MTU", args: { if: jnPhysArg(r) }, junos: { syntax: "interfaces <if> mtu", del: (c, a) => (a.if === "lo0" ? c : ((ifc(c, a.if)!.mtu = DEFAULT_MTU), c)) } },
    { id: "j-disable", summary: "Disable this interface", args: { if: jnPhysArg(r) }, junos: { syntax: "interfaces <if> disable", set: (c, a) => (a.if === "lo0" ? "error: disabling lo0 is not part of this lab" : ((ifc(c, a.if)!.shut = true), c)), del: (c, a) => (a.if === "lo0" ? c : ((ifc(c, a.if)!.shut = false), c)) } },
    { id: "j-iso", summary: "OSI family (needed for IS-IS)", args: { if: jnPhysArg(r) }, junos: { syntax: "interfaces <if> unit 0 family iso", set: (c, a) => (a.if === "lo0" ? c : ((ifc(c, a.if)!.iso = true), c)), del: (c, a) => (a.if === "lo0" ? ((c.net = ""), c) : ((ifc(c, a.if)!.iso = false), c)) } },
    { id: "j-net", summary: "ISO network entity title (NET)", args: { net: netArg }, junos: { syntax: "interfaces lo0 unit 0 family iso address <net>", set: (c, a) => ((c.net = a.net), c), del: (c) => ((c.net = ""), c) } },
  ];
}

// ---------------------------------------------------------------------------------------------------------------
// Command sets
// ---------------------------------------------------------------------------------------------------------------
const srcArg = (r: IsR): CliArgSpec => ({ choices: ["Loopback0", IS_LO[r]], describe: () => "Source address or interface", resolve: (raw) => (/^(loopback0|lo0)$/i.test(raw) ? IS_LO[r] : /^(\d{1,3}\.){3}\d{1,3}$/.test(raw) && ipOwnedBy(r, raw) ? raw : undefined) });
const countArg = numArg(1, 100, ["5", "10"], "Number of pings");
function testAct(api: IsCliApi, kind: "ping" | "trace", r: IsR, dst: string, src: string) {
  api.act({ type: kind, from: r, dst, src });
}

export function isXrSpec(api: IsCliApi, r: IsR): SpXrSpec<IsRtr> {
  const s = api.s;
  const sh = (id: string, syntax: string, summary: string, run: SpCmd["run"], args?: SpCmd["args"]): SpCmd => ({ id, syntax, summary, run, args });
  return {
    stmts: stmts(r).filter((x) => x.xr),
    prompts: { config: "config", isis: "config-isis", "isis-af": "config-isis-af", "isis-if": "config-isis-if", "isis-if-af": "config-isis-if-af", if: "config-if" },
    lines: (c) => xrLines(r, c),
    help: { "show isis": "IS-IS routing protocol state", "show route": "IPv4 routing table", "show interfaces": "Interface status and configuration", ping: "Send echo messages", traceroute: "Trace route to destination" },
    shows: [
      sh("neighbors", "show isis neighbors", "IS-IS neighbors", () => xrNeighbors(s, r)),
      sh("adjacency", "show isis adjacency", "IS-IS adjacencies", () => xrAdjacency(s, r)),
      sh("db", "show isis database", "IS-IS link state database", () => xrDatabase(s, r, false)),
      sh("db-detail", "show isis database detail", "IS-IS link state database, every TLV", () => xrDatabase(s, r, true)),
      sh("db-lsp", "show isis database <lsp>", "One LSP", (a) => xrDatabase(s, r, false, a.lsp), { lsp: lspArg(s, r) }),
      sh("db-detail-lsp", "show isis database detail <lsp>", "One LSP, every TLV", (a) => xrDatabase(s, r, true, a.lsp), { lsp: lspArg(s, r) }),
      sh("if-brief", "show isis interface brief", "IS-IS interfaces, one line each", () => xrIfBrief(s, r)),
      sh("if", "show isis interface <if>", "One IS-IS interface in detail", (a) => xrIfDetail(s, r, a.if), { if: xrIfArg(r) }),
      sh("topo", "show isis topology", "The SPF result: distance and next hop to every router", () => xrTopology(s, r)),
      sh("isis-route", "show isis route", "IS-IS routes (the IS-IS RIB)", () => xrIsisRoute(s, r)),
      sh("spf-log", "show isis spf-log", "When and why SPF ran", () => xrSpfLog(s, r)),
      sh("hostname", "show isis hostname", "System ID to hostname (TLV 137)", () => xrHostname(s, r)),
      sh("route", "show route", "The IPv4 routing table", () => xrRoute(s, r)),
      sh("route-isis", "show route isis", "IS-IS routes in the routing table", () => xrRoute(s, r, "isis")),
      sh("route-ip", "show route <ip>", "The route a destination uses", (a) => xrRouteIp(s, r, a.ip), { ip: ipArg }),
      sh("ipv4-brief", "show ipv4 interface brief", "IPv4 interfaces and state", () => xrIpBrief(s, r)),
      sh("int-brief", "show interfaces brief", "Interfaces, state and MTU", () => xrIntBrief(s, r)),
      sh("int", "show interfaces <if>", "One interface: state, MTU, counters", (a) => xrInterface(s, r, a.if), { if: xrIfArg(r) }),
      sh("logging", "show logging", "The syslog buffer", () => xrLogging(s, r)),
    ],
    exec: [
      sh("ping", "ping <ip>", "Send 5 ICMP echoes (source: the outgoing interface)", (a) => {
        const src = egressIp(s, r, a.ip) ?? IS_LO[r];
        testAct(api, "ping", r, a.ip, src);
        return xrPing(s, r, a.ip, src);
      }, { ip: ipArg }),
      sh("ping-src", "ping <ip> source <src>", "Send 5 ICMP echoes from a chosen source", (a) => (testAct(api, "ping", r, a.ip, a.src), xrPing(s, r, a.ip, a.src)), { ip: ipArg, src: srcArg(r) }),
      sh("ping-count", "ping <ip> count <n>", "Send <n> ICMP echoes", (a) => {
        const src = egressIp(s, r, a.ip) ?? IS_LO[r];
        testAct(api, "ping", r, a.ip, src);
        return xrPing(s, r, a.ip, src, +a.n);
      }, { ip: ipArg, n: countArg }),
      sh("trace", "traceroute <ip>", "Trace the path hop by hop", (a) => {
        const src = egressIp(s, r, a.ip) ?? IS_LO[r];
        testAct(api, "trace", r, a.ip, src);
        return xrTrace(s, r, a.ip, src);
      }, { ip: ipArg }),
      sh("trace-src", "traceroute <ip> source <src>", "Trace from a chosen source", (a) => (testAct(api, "trace", r, a.ip, a.src), xrTrace(s, r, a.ip, a.src)), { ip: ipArg, src: srcArg(r) }),
      sh("clear-counters", "clear counters", "Clear the interface counters", () => (api.act({ type: "clear-counters" }), "Clear \"show interface\" counters on all interfaces [confirm]\nRP/0/RP0/CPU0:" + spStamp(s.clock).xr + ": ifmgr[247]: %PKT_INFRA-IFMGR-6-COUNTERS_CLEARED : Counters cleared")),
    ],
  };
}
export function isJunosSpec(api: IsCliApi, r: IsR): SpJunosSpec<IsRtr> {
  const s = api.s;
  const sh = (id: string, syntax: string, summary: string, run: SpCmd["run"], args?: SpCmd["args"]): SpCmd => ({ id, syntax, summary, run, args });
  return {
    stmts: stmts(r).filter((x) => x.junos),
    jstmts: (c) => jnStmts(r, c),
    help: { "show isis": "Show Intermediate System-to-Intermediate System information", "show route": "Show routing table information", "show interfaces": "Show interface information", ping: "Ping remote target", traceroute: "Trace route to remote host" },
    shows: [
      sh("adj", "show isis adjacency", "IS-IS adjacencies", () => jnAdjacency(s, r, false)),
      sh("adj-d", "show isis adjacency detail", "IS-IS adjacencies in detail", () => jnAdjacency(s, r, true)),
      sh("db", "show isis database", "IS-IS link-state database", () => jnDatabase(s, r, false)),
      sh("db-d", "show isis database detail", "IS-IS link-state database, every TLV", () => jnDatabase(s, r, true)),
      sh("db-lsp", "show isis database <lsp>", "One LSP", (a) => jnDatabase(s, r, false, a.lsp), { lsp: lspArg(s, r) }),
      sh("db-lsp-d", "show isis database <lsp> detail", "One LSP, every TLV", (a) => jnDatabase(s, r, true, a.lsp), { lsp: lspArg(s, r) }),
      sh("if", "show isis interface", "IS-IS interfaces", () => jnInterface(s, r)),
      sh("isis-route", "show isis route", "IS-IS routes", () => jnIsisRoute(s, r)),
      sh("spf", "show isis spf log", "When and why SPF ran", () => jnSpfLog(s, r)),
      sh("host", "show isis hostname", "System ID to hostname", () => jnHostname(s, r)),
      sh("stats", "show isis statistics", "PDUs received, processed, dropped", () => jnStatistics(s, r)),
      sh("route", "show route", "The routing table (inet.0)", () => jnRoute(s, r, "all")),
      sh("route-isis", "show route protocol isis", "IS-IS routes in inet.0", () => jnRoute(s, r, "isis")),
      sh("route-ip", "show route <ip>", "The route a destination uses", (a) => jnRoute(s, r, a.ip), { ip: ipArg }),
      sh("terse", "show interfaces terse", "Interfaces, state and families", () => jnTerse(s, r)),
      sh("int", "show interfaces <if>", "One interface", (a) => jnInterfaceShow(s, r, a.if, false), { if: jnPhysArg(r) }),
      sh("int-ext", "show interfaces <if> extensive", "One interface with every counter", (a) => jnInterfaceShow(s, r, a.if, true), { if: jnPhysArg(r) }),
      sh("log", "show log messages", "The system log", () => jnLog(s, r)),
    ],
    op: [
      sh("ping", "ping <ip>", "Ping (runs until Ctrl+C; the lab stops after 5)", (a) => {
        const src = egressIp(s, r, a.ip) ?? IS_LO[r];
        testAct(api, "ping", r, a.ip, src);
        return jnPing(s, r, a.ip, src, 5, true);
      }, { ip: ipArg }),
      sh("ping-c", "ping <ip> count <n>", "Ping <n> times", (a) => {
        const src = egressIp(s, r, a.ip) ?? IS_LO[r];
        testAct(api, "ping", r, a.ip, src);
        return jnPing(s, r, a.ip, src, +a.n, false);
      }, { ip: ipArg, n: countArg }),
      sh("ping-src", "ping <ip> source <src> count <n>", "Ping from a chosen source", (a) => (testAct(api, "ping", r, a.ip, a.src), jnPing(s, r, a.ip, a.src, +a.n, false)), { ip: ipArg, src: srcArg(r), n: countArg }),
      sh("trace", "traceroute <ip>", "Trace the path hop by hop", (a) => {
        const src = egressIp(s, r, a.ip) ?? IS_LO[r];
        testAct(api, "trace", r, a.ip, src);
        return jnTrace(s, r, a.ip, src);
      }, { ip: ipArg }),
      sh("trace-src", "traceroute <ip> source <src>", "Trace from a chosen source", (a) => (testAct(api, "trace", r, a.ip, a.src), jnTrace(s, r, a.ip, a.src)), { ip: ipArg, src: srcArg(r) }),
      sh("clear-stats", "clear interfaces statistics all", "Clear the interface counters", () => (api.act({ type: "clear-counters" }), "")),
    ],
  };
}
/** Junos refuses an IS-IS interface without `family iso` silently (no adjacency) — no commit error; XR has no such rule. */
export function isSets(api: IsCliApi, r: IsR): Partial<Record<CliVendor, CliCommandSet>> {
  return { cisco: buildXrSet(api.dev, isXrSpec(api, r)), juniper: buildJunosSet(api.dev, isJunosSpec(api, r)) };
}
export const isPipe = (api: IsCliApi, r: IsR) => ({ config: junosPipeConfig(api.dev, { jstmts: (c: IsRtr) => jnStmts(r, c) }), rollbacks: api.dev.hist.length });

/** A read-only device session (for the Lesson Guide: run show commands against a lab state). */
export function isStaticApi(s: IsState, r: IsR): IsCliApi {
  return { s, act: () => s, dev: { host: r, running: s.cfg[r], hist: s.hist[r], setCand: () => undefined, xr: [], setXr: () => undefined, edit: false, setEdit: () => undefined, commit: () => undefined } };
}
export const isClone = spClone;
export const areaText = (s: IsState, r: IsR) => (s.cfg[r].net ? areaOf(s.cfg[r].net) : "—");
export const sysText = (s: IsState, r: IsR) => (s.cfg[r].net ? sysOf(s.cfg[r].net) : "—");
export { IS_LINKS, inPfx };
