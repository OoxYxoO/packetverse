import type { CliArgSpec, CliCommandSet, CliVendor } from "@/lib/cli/types";
import { buildJunosSet, buildXrSet, choiceArg, junosPipeConfig, numArg, type SpCfgStmt, type SpCmd, type SpDevCli, type SpJunosSpec, type SpXrSpec } from "@/components/sp-lab/spCli";
import { lpad, pad, spAge, spStamp, type JStmt } from "@/components/sp-lab/spKit";
import { jnIf, parseIf, xrIf } from "@/components/sp-lab/spNames";
import {
  SRGB_START,
  TL_HOSTS,
  TL_IDX,
  TL_LINKS,
  TL_LO,
  TL_ROUTERS,
  lanIf,
  tlAdj,
  tlBackupStack,
  tlIfTo,
  tlIfs,
  tlPfx,
  tlProt,
  tlRouterOfLo,
  type IfName,
  type TlAction,
  type TlPrefix,
  type TlR,
  type TlRtr,
  type TlState,
} from "@/lib/sim-engine/scenarios/tlNet";

/**
 * Command lines of the SR TI-LFA Lab — IOS XR or Junos on R1–R6. Every output is printed from the lab model: the
 * primary paths, the TI-LFA / LFA backups and their repair labels, BFD sessions and the logs of the last drill.
 *
 *   IOS XR  show isis fast-reroute [summary | <fec> detail] · show isis interface <if> · show isis adjacency ·
 *           show bfd session · show mpls forwarding [labels <n> [detail]] · show route [<ip>] · show cef <ip> ·
 *           show isis segment-routing label table · show logging
 *           configure → router isis CORE → address-family ipv4 unicast → segment-routing mpls ·
 *           interface <if> → point-to-point · bfd fast-detect ipv4 · bfd minimum-interval · bfd multiplier ·
 *           address-family ipv4 unicast → metric · fast-reroute per-prefix [ti-lfa | tiebreaker node-protecting index]
 *           · interface Loopback0 → address-family ipv4 unicast → prefix-sid index
 *   Junos   show isis adjacency · show isis backup coverage · show isis backup spf results · show bfd session ·
 *           show route table inet.3 | mpls.0 · show route <ip> · show log messages
 *           configure → set protocols isis interface <if> level 2 post-convergence-lfa [node-protection] ·
 *           link-protection · bfd-liveness-detection minimum-interval | multiplier · level 2 metric ·
 *           backup-spf-options use-post-convergence-lfa | use-source-packet-routing · source-packet-routing
 */

export interface TlCliApi {
  s: TlState;
  act: (a: TlAction) => TlState;
  dev: SpDevCli<TlRtr>;
}
const age = (s: TlState) => spAge(s.clock, 15);
const ipNum = (ip: string) => ip.split(".").reduce((a, o) => a * 256 + Number(o), 0);
const ifc = (c: TlRtr, ifn: string) => c.ifs[ifn as IfName]!;
const defMetric = (r: TlR, ifn: string) => tlIfs(r).find((i) => i.ifn === ifn)!.link.metric;
const myHost = (r: TlR) => (r === "R1" ? TL_HOSTS.H1 : r === "R6" ? TL_HOSTS.H6 : undefined);
const farHost = (r: TlR) => (r === "R1" ? TL_HOSTS.H6 : r === "R6" ? TL_HOSTS.H1 : undefined);
const nodeOfLabel = (l: number) => TL_ROUTERS.find((r) => SRGB_START + TL_IDX[r] === l);
const adjOfLabel = (s: TlState, l: number) => {
  for (const r of TL_ROUTERS) for (const i of tlIfs(r)) if (tlAdj(s.os, r, i.peer) === l) return { r, peer: i.peer };
  return undefined;
};
const outTxt = (p: TlPrefix) => (p.out === "Pop" ? "Pop" : p.out === "Unlabelled" ? "Unlabelled" : String(p.out));
const imposed = (p: TlPrefix) => (p.out === "Pop" ? "ImplNull" : p.out === "Unlabelled" ? "None" : String(p.out));
const bkImposed = (s: TlState, p: TlPrefix) => {
  const st = tlBackupStack(s.cfg, p);
  return st.length ? st.join(" ") : "ImplNull";
};
/** The repair nodes the backup's labels lead to (IOS XR prints their loopbacks). */
const repairNodes = (s: TlState, p: TlPrefix) => (p.backup?.repair ?? []).map((l) => nodeOfLabel(l) ?? adjOfLabel(s, l)?.peer).filter((x): x is TlR => !!x);

// ---------------------------------------------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------------------------------------------
const phys = (r: TlR) => tlIfs(r).map((i) => i.ifn);
const xrIfArg = (r: TlR, withLo = false): CliArgSpec => ({
  choices: [...(withLo ? ["Loopback0"] : []), ...phys(r).map((i) => xrIf(i))],
  describe: (c) => {
    const n = parseIf(c);
    const i = tlIfs(r).find((x) => x.ifn === n);
    return i ? `to ${i.peer}` : n === "lo0" ? "Loopback interface" : undefined;
  },
  resolve: (raw) => {
    const n = parseIf(raw);
    return n && (n === "lo0" ? withLo : phys(r).includes(n as IfName)) ? n : undefined;
  },
});
const jnUnitArg = (r: TlR): CliArgSpec => ({
  choices: phys(r).map((i) => `${i}.0`),
  describe: (c) => {
    const i = tlIfs(r).find((x) => `${x.ifn}.0` === c);
    return i ? `to ${i.peer}` : undefined;
  },
  resolve: (raw) => (/^ge-0\/0\/[0-2]\.0$/.test(raw) && phys(r).includes(raw.slice(0, -2) as IfName) ? raw.slice(0, -2) : undefined),
});
const fecArg: CliArgSpec = {
  choices: TL_ROUTERS.map((r) => `${TL_LO[r]}/32`),
  describe: (c) => tlRouterOfLo(c.replace("/32", "")),
  resolve: (raw) => {
    const m = /^(10\.0\.0\.[1-6])\/32$/.exec(raw);
    return m ? m[1] : undefined;
  },
};
const ipArg: CliArgSpec = {
  choices: [...TL_ROUTERS.map((r) => TL_LO[r]), TL_HOSTS.H6.ip, TL_HOSTS.H1.ip],
  describe: (c) => tlRouterOfLo(c) ?? (c === TL_HOSTS.H6.ip ? "H6" : c === TL_HOSTS.H1.ip ? "H1" : undefined),
  resolve: (raw) => (/^(\d{1,3}\.){3}\d{1,3}$/.test(raw) && raw.split(".").every((o) => +o <= 255) ? raw : undefined),
};
const pfxArg: CliArgSpec = {
  ...ipArg,
  choices: [...ipArg.choices!, "192.168.6.0/24", "192.168.1.0/24"],
  resolve: (raw) => {
    const m = /^((\d{1,3}\.){3}\d{1,3})(\/(\d{1,2}))?$/.exec(raw);
    return m && m[1].split(".").every((o) => +o <= 255) && (!m[4] || +m[4] <= 32) ? m[1] : undefined;
  },
};
const labelArg = numArg(16, 1048575, ["16006", "16005"], "An MPLS label");
const metricArg = numArg(1, 16777214, ["10", "15", "25"], "Default metric (wide: 1–16777214)");
const sidArg = numArg(0, 1048575, ["6"], "Prefix-SID index (label = SRGB start + index)");
const lvlArg = choiceArg(["2"], () => "Level 2");
const bfdMinArg = numArg(3, 30000, ["50"], "Minimum interval in milliseconds");
const bfdMulArg = numArg(2, 50, ["3"], "Detect multiplier");
const BFD_FIXED = "% This lab keeps BFD at 50 ms × 3 (150 ms detection).";

// ---------------------------------------------------------------------------------------------------------------
// IOS XR outputs
// ---------------------------------------------------------------------------------------------------------------
const XR_FRR_CODES = ["Codes: L1 - level 1, L2 - level 2, ia - interarea (leaked into level 1)", "       df - level 1 default (closest attached router), su - summary null", "       C - connected, S - static, R - RIP, B - BGP, O - OSPF", "       E - EIGRP, A - access/subscriber, M - mobile, a - application", "       i - IS-IS (redistributed from another instance)", "", "Maximum parallel path count: 8", ""];
function xrFrrEntry(s: TlState, r: TlR, p: TlPrefix, detail: boolean): string[] {
  const rt = s.view.rib[r].find((x) => x.dst === p.dst)!;
  const out = [`L2 ${TL_LO[p.dst]}/32 [${rt.cost}/115]`, `     via ${p.nh!.ip}, ${xrIf(p.nh!.ifn)}, ${p.nh!.nh}, SRGB Base: ${SRGB_START}, Weight: 0`];
  const b = p.backup;
  if (!b) {
    out.push("       No FRR backup");
    return out;
  }
  const head = b.kind === "lfa" ? "LFA" : `TI-LFA (${b.protect})`;
  out.push(`       Backup path: ${head}, via ${b.nh.ip}, ${xrIf(b.nh.ifn)} ${b.nh.nh}, SRGB Base: ${SRGB_START}, Weight: 0, Metric: ${b.cost}`);
  for (const l of b.repair) {
    const n = nodeOfLabel(l);
    const a = adjOfLabel(s, l);
    if (n) out.push(`         P node: ${n}.00 [${TL_LO[n]}], Label: ${l === SRGB_START + TL_IDX[b.nh.nh] ? "ImpNull" : l}`);
    else if (a) out.push(`         Q node: ${a.peer}.00 [${TL_LO[a.peer]}], Label: ${l}`);
  }
  out.push(`         Prefix label: ${b.nh.nh === p.dst ? "ImpNull" : p.label}`, `         Backup-src: ${p.dst}.00`);
  if (detail) out.push(`       P: ${b.protect === "node" ? "Yes" : "No"}, TM: ${b.cost}, LC: No, NP: ${b.protect === "node" ? "Yes" : "No"}, D: No, SRLG: No`, `     src ${p.dst}.00-00, ${TL_LO[p.dst]}, prefix-SID index ${TL_IDX[p.dst]}, R:0 N:1 P:0 E:0 V:0 L:0, Alg:0`);
  return out;
}
function xrFrr(s: TlState, r: TlR, only?: TlR): string {
  if (!s.cfg[r].sr) return "";
  const rows = s.view.pfx[r].filter((p) => !p.own && (!only || p.dst === only)).sort((a, b) => TL_IDX[a.dst] - TL_IDX[b.dst]);
  if (only && !rows.length) return "";
  return ["", "IS-IS CORE IPv4 Unicast FRR backups", "", ...XR_FRR_CODES, ...rows.flatMap((p) => [...xrFrrEntry(s, r, p, !!only), ""])].join("\n");
}
function xrFrrSummary(s: TlState, r: TlR): string {
  const rows = s.view.pfx[r].filter((p) => !p.own);
  const prot = rows.filter((p) => p.backup).length;
  const un = rows.length - prot;
  const pc = (n: number, d: number) => `${d ? ((100 * n) / d).toFixed(2) : "0.00"}%`;
  const line = (k: string, m: string, t: string) => `${pad(k, 26)}${pad("0", 11)}${pad("0", 11)}${pad(m, 11)}${pad("0", 11)}${t}`;
  const line2 = (k: string, m: string, t: string) => `${pad(k, 26)}${pad("0.00%", 11)}${pad("0.00%", 11)}${pad(m, 11)}${pad("0.00%", 11)}${t}`;
  return ["", "IS-IS CORE IPv4 Unicast FRR summary", "", "                          Critical   High       Medium     Low        Total", "                          Priority   Priority   Priority   Priority", "Prefixes reachable in L2", line("  All paths protected", String(prot), String(prot)), line("  Some paths protected", "0", "0"), line("  Unprotected", String(un), String(un)), "Protection coverage", line2("  All paths protected", pc(prot, rows.length), pc(prot, rows.length)), line2("  Some paths protected", "0.00%", "0.00%"), line2("  Unprotected", pc(un, rows.length), pc(un, rows.length)), "Number of TI-LFA backups", line(`  ${pad("L2", 24)}`.slice(2), String(rows.filter((p) => p.backup?.kind === "ti-lfa").length), String(rows.filter((p) => p.backup?.kind === "ti-lfa").length))].join("\n");
}
function xrIsisIf(s: TlState, r: TlR, ifn: string): string {
  const i = tlIfs(r).find((x) => x.ifn === ifn);
  if (!i) return "";
  const f = s.cfg[r].ifs[i.ifn]!;
  if (!f.isis) return `${pad(xrIf(i.ifn), 28)}Disabled (No topologies cfg on the intf)`;
  const pr = tlProt(s.cfg, s.os, r, i.ifn);
  const st = (b: boolean) => (b ? "Enabled" : "Not Enabled");
  return [
    `${pad(xrIf(i.ifn), 28)}Enabled`,
    "  Adjacency Formation:      Enabled",
    "  Prefix Advertisement:     Enabled",
    `  IPv4 BFD:                 ${f.bfd ? "Enabled" : "Disabled"}`,
    "  IPv6 BFD:                 Disabled",
    `  BFD Min Interval:         ${f.bfd ? 50 : 150}`,
    "  BFD Multiplier:           3",
    "  Bandwidth:                1000000",
    "",
    "  Circuit Type:             level-2-only",
    "  Media Type:               P2P",
    `  Circuit Number:           0`,
    "",
    "  IPv4 Unicast Topology:    Enabled",
    `    Adjacency Formation:    ${s.view.adj[i.link.id] ? "Running" : "Not Running"}`,
    "    Prefix Advertisement:   Running",
    `    Metric (L1/L2):         ${f.metric}/${f.metric}`,
    "    Weight (L1/L2):         0/0",
    "    MPLS Max Label Stack:   3/3/12/0 (PRI/BKP/SRTE/SRAT)",
    "    MPLS LDP Sync (L1/L2):  Disabled/Disabled",
    `    FRR (L1/L2):            L1 Not Enabled     L2 ${st(pr.on)}`,
    `      FRR Type:             None               ${pr.on ? "per-prefix" : "None"}`,
    `      Direct LFA:           Not Enabled        ${st(pr.on)}`,
    "      Remote LFA:           Not Enabled        Not Enabled",
    `      TI LFA:               Not Enabled        ${st(pr.on && f.tilfa)}`,
    `      Tie Breaker           Default            ${pr.on && f.node ? "Node-protecting" : "Default"}`,
    "      Line-card disjoint    30                 30",
    "      Lowest backup metric  20                 20",
    `      Node protecting       Not Set            ${pr.on && f.node ? "100" : "Not Set"}`,
    "      Primary path          10                 10",
    "      Interface disjoint    Not Set            Not Set",
  ].join("\n");
}
function xrAdj(s: TlState, r: TlR): string {
  const ups = tlIfs(r).filter((i) => s.view.adj[i.link.id]);
  const rows = ups.map((i) => {
    const bfdUp = s.cfg[r].ifs[i.ifn]!.bfd && s.cfg[i.peer].ifs[i.peerIf]!.bfd;
    const bfd = s.cfg[r].ifs[i.ifn]!.bfd ? (bfdUp ? "Up" : "Init") : "None";
    return `${pad(i.peer, 15)}${pad(xrIf(i.ifn, true), 25)}${pad("*PtoP*", 15)}${pad("Up", 6)}${pad(27, 5)}${pad(age(s), 9)}Yes ${pad(bfd, 5)}None`;
  });
  return ["IS-IS CORE Level-2 adjacencies:", "System Id      Interface                SNPA           State Hold Changed  NSF IPv4 IPv6", "                                                                               BFD  BFD", ...rows, "", `Total adjacency count: ${ups.length}`].join("\n");
}
function xrBfd(s: TlState, r: TlR): string {
  const rows = tlIfs(r).filter((i) => s.cfg[r].ifs[i.ifn]!.bfd && s.cfg[r].ifs[i.ifn]!.isis).flatMap((i) => {
    const up = s.view.adj[i.link.id] && s.cfg[i.peer].ifs[i.peerIf]!.bfd;
    return [`${pad(xrIf(i.ifn, true), 20)}${pad(i.peerIp, 16)}${pad("0s(0s*0)", 17)}${pad("150ms(50ms*3)", 17)}${up ? "UP" : "DOWN"}`, `${pad("", 61)}No    n/a`];
  });
  if (!rows.length) return "";
  return ["Interface           Dest Addr           Local det time(int*mult)      State", "                                    Echo             Async   H/W   NPU", "------------------- --------------- ---------------- ---------------- ----------", ...rows].join("\n");
}
const FWD_HEAD = ["Local  Outgoing    Prefix             Outgoing     Next Hop        Bytes", "Label  Label       or ID              Interface                    Switched", "------ ----------- ------------------ ------------ --------------- ------------"];
function xrFwdRows(s: TlState, r: TlR, only?: number, detail = false): string[] {
  const out: string[] = [];
  const det = (stack: string, bk: boolean) => (detail ? [`     Updated: ${spStamp(15).xr.replace(" UTC", "")}`, `     Path Flags: 0x${bk ? "100" : "400"} [ ${bk ? "BKUP" : "IDX:0 BKUP-IDX:1"} ]`, `     Version: ${40 + TL_IDX[r]}, Priority: 3`, `     Label Stack (Top -> Bottom): { ${stack} }`, "     NHID: 0x0, Encap-ID: N/A, Path idx: " + (bk ? "1" : "0") + ", Backup path idx: " + (bk ? "0" : "1") + ", Weight: 0", "     MAC/Encaps: 4/8, MTU: 1500", `     Packets Switched: 0`] : []);
  for (const p of [...s.view.pfx[r]].sort((a, b) => a.label - b.label)) {
    if (p.own || !p.nh || (only !== undefined && p.label !== only)) continue;
    out.push(`${pad(p.label, 7)}${pad(outTxt(p), 12)}${pad(`SR Pfx (idx ${TL_IDX[p.dst]})`, 19)}${pad(xrIf(p.nh.ifn, true), 13)}${pad(p.nh.ip, 16)}0`, ...det(p.out === "Pop" ? "" : p.out === "Unlabelled" ? "Unlabelled" : String(p.out), false));
    if (p.backup) {
      const st = tlBackupStack(s.cfg, p);
      out.push(`${pad("", 7)}${pad(st.length ? st[st.length - 1] : "Pop", 12)}${pad(`SR Pfx (idx ${TL_IDX[p.dst]})`, 19)}${pad(xrIf(p.backup.nh.ifn, true), 13)}${pad(p.backup.nh.ip, 16)}${pad("0", 13)}(!)`, ...det(st.join(" "), true));
    }
  }
  if (only === undefined || only >= 24000)
    for (const i of tlIfs(r).filter((x) => s.view.adj[x.link.id] && s.cfg[r].sr).sort((a, b) => tlAdj("xr", r, a.peer) - tlAdj("xr", r, b.peer))) {
      const l = tlAdj("xr", r, i.peer);
      if (only !== undefined && l !== only) continue;
      out.push(`${pad(l, 7)}${pad("Pop", 12)}${pad(`SR Adj (idx 1)`, 19)}${pad(xrIf(i.ifn, true), 13)}${pad(i.peerIp, 16)}0`);
    }
  return out;
}
function xrForwarding(s: TlState, r: TlR, only?: number, detail = false): string {
  if (!s.cfg[r].sr) return "";
  const rows = xrFwdRows(s, r, only, detail);
  if (only !== undefined && !rows.length) return "";
  return [...FWD_HEAD, ...rows].join("\n");
}
function xrLabelTable(s: TlState, r: TlR): string {
  if (!s.cfg[r].sr) return "";
  const rows = TL_ROUTERS.filter((o) => s.cfg[o].sr && s.cfg[o].sid !== undefined).sort((a, b) => s.cfg[a].sid! - s.cfg[b].sid!).map((o) => `${pad(SRGB_START + s.cfg[o].sid!, 14)}${o === r ? "Loopback0" : `${TL_LO[o]}/32`}`);
  return ["", "IS-IS CORE IS Label Table", "Label         Prefix/Interface", "----------    ----------------", ...rows].join("\n");
}
const XR_CODES = ["Codes: C - connected, S - static, R - RIP, B - BGP, (>) - Diversion path", "       O - OSPF, IA - OSPF inter area, i - ISIS, L1 - IS-IS level-1, L2 - IS-IS level-2", "       L - local, a - Application route", "", "Gateway of last resort is not set", ""];
interface XrRt {
  p: string;
  len: number;
  kind: string;
  metric: number;
  nh?: { ip: string; ifn: string };
  ifn?: string;
}
function xrRib(s: TlState, r: TlR): XrRt[] {
  const out: XrRt[] = [{ p: TL_LO[r], len: 32, kind: "L", metric: 0, ifn: "lo0" }];
  for (const i of tlIfs(r)) out.push({ p: i.ip.replace(/\.\d+$/, ".0"), len: 24, kind: "C", metric: 0, ifn: i.ifn }, { p: i.ip, len: 32, kind: "L", metric: 0, ifn: i.ifn });
  const h = myHost(r);
  const lan = lanIf(r);
  if (h && lan) out.push({ p: h.net, len: 24, kind: "C", metric: 0, ifn: lan }, { p: h.gw, len: 32, kind: "L", metric: 0, ifn: lan });
  for (const rt of s.view.rib[r]) if (rt.nh) out.push({ p: TL_LO[rt.dst], len: 32, kind: "i L2", metric: rt.cost, nh: { ip: rt.nh.ip, ifn: rt.nh.ifn } });
  for (const l of TL_LINKS) {
    if (l.a === r || l.b === r || !s.view.adj[l.id]) continue;
    const near = [l.a, l.b].map((x) => s.view.rib[r].find((y) => y.dst === x)).filter((x): x is NonNullable<typeof x> => !!x?.nh).sort((a, b) => a.cost - b.cost)[0];
    if (near) out.push({ p: `10.1.${TL_IDX[l.a]}${TL_IDX[l.b]}.0`, len: 24, kind: "i L2", metric: near.cost + l.metric, nh: { ip: near.nh!.ip, ifn: near.nh!.ifn } });
  }
  const f = farHost(r);
  if (f) out.push({ p: f.net, len: 24, kind: "B", metric: 0, nh: { ip: TL_LO[f.r], ifn: "" } });
  return out.sort((a, b) => ipNum(a.p) - ipNum(b.p) || a.len - b.len);
}
function xrRouteLine(s: TlState, x: XrRt) {
  const p = `${x.p}/${x.len}`;
  if (x.kind === "C" || x.kind === "L") return `${pad(x.kind, 5)}${p} is directly connected, ${age(s)}, ${xrIf(x.ifn!)}`;
  if (x.kind === "B") return `${pad("B", 5)}${p} [200/0] via ${x.nh!.ip}, ${age(s)}`;
  return `${pad(`${pad(x.kind, 5)}${p}`, 23)}[115/${x.metric}] via ${x.nh!.ip}, ${age(s)}, ${xrIf(x.nh!.ifn)}`;
}
const inPfx = (ip: string, p: string, len: number) => Math.floor(ipNum(ip) / 2 ** (32 - len)) === Math.floor(ipNum(p) / 2 ** (32 - len));
const hexL = (l: number) => `0x${l.toString(16)}`;
function xrRouteIp(s: TlState, r: TlR, ip: string): string {
  const x = xrRib(s, r).filter((y) => inPfx(ip, y.p, y.len)).sort((a, b) => b.len - a.len)[0];
  if (!x) return "% Network not in table";
  const p = `${x.p}/${x.len}`;
  if (x.kind === "C" || x.kind === "L") return [`Routing entry for ${p}`, `  Known via "${x.kind === "C" ? "connected" : "local"}", distance 0, metric 0 (connected)`, "  Routing Descriptor Blocks", `    directly connected, via ${xrIf(x.ifn!)}`, "      Route metric is 0", "  No advertising protos."].join("\n");
  if (x.kind === "B") return [`Routing entry for ${p}`, `  Known via "bgp 65000", distance 200, metric 0, type internal`, `  Installed ${spStamp(30).xr.replace(" UTC", "")} for ${age(s)}`, "  Routing Descriptor Blocks", `    ${x.nh!.ip}, from ${x.nh!.ip}`, "      Route metric is 0", "  No advertising protos."].join("\n");
  const lo = tlRouterOfLo(x.p);
  const e = lo ? tlPfx(s.view, r, lo) : undefined;
  const lab = e && e.out !== "Unlabelled";
  const out = [`Routing entry for ${p}`, `  Known via "isis CORE", distance 115, metric ${x.metric}${lab ? ", labeled SR" : ""}, type level-2`, `  Installed ${spStamp(15).xr.replace(" UTC", "")} for ${age(s)}`, "  Routing Descriptor Blocks", `    ${x.nh!.ip}, from ${x.p}, via ${xrIf(x.nh!.ifn)}${e?.backup ? ", Protected" : ""}`, `      Route metric is ${x.metric}`];
  if (e) out.push(`      Label: ${e.out === "Pop" ? "0x3 (3)" : e.out === "Unlabelled" ? "None" : `${hexL(e.out as number)} (${e.out})`}`);
  out.push("      Tunnel ID: None", "      Binding Label: None", "      Extended communities count: 0", "      Path id:1       Path ref count:0", "      NHID:0x1(Ref:1)");
  if (e?.backup) {
    const b = e.backup;
    const st = tlBackupStack(s.cfg, e);
    out.push("      Backup path id:65", `    ${b.nh.ip}, from ${x.p}, via ${xrIf(b.nh.ifn)}, Backup (${b.kind === "lfa" ? "Local-LFA" : "TI-LFA"})`, ...(repairNodes(s, e).length ? [`      Repair Node(s): ${repairNodes(s, e).map((n) => TL_LO[n]).join(", ")}`] : []), `      Route metric is ${b.cost}`, `      Labels: ${st.length ? `${st.map(hexL).join(" ")} (${st.join(" ")})` : "0x3 (3)"}`, "      Tunnel ID: None", "      Binding Label: None", "      Extended communities count: 0", "      Path id:65              Path ref count:1", "      NHID:0x2(Ref:1)");
  }
  out.push("  No advertising protos.");
  return out.join("\n");
}
function xrCefVia(s: TlState, r: TlR, e: TlPrefix): string[] {
  const out = [`   via ${e.nh!.ip}/32, ${xrIf(e.nh!.ifn)}, 9 dependencies, weight 0, class 0${e.backup ? ", protected" : ""} [flags 0x${e.backup ? "400" : "0"}]`, `    path-idx 0${e.backup ? " bkup-idx 1" : ""} NHID 0x0 [0x7fa1c0${TL_IDX[r]}0 0x0]`, `    next hop ${e.nh!.ip}/32`, `     local label ${e.label}      labels imposed {${imposed(e)}}`];
  if (e.backup) {
    const rn = repairNodes(s, e);
    out.push(`   via ${e.backup.nh.ip}/32, ${xrIf(e.backup.nh.ifn)}, 9 dependencies, weight 0, class 0, backup (${e.backup.kind === "lfa" ? "Local-LFA" : "TI-LFA"}) [flags 0xb00]`, `    path-idx 1 NHID 0x0 [0x7fa1c0${TL_IDX[r]}8 0x0]`, `    next hop ${e.backup.nh.ip}/32${rn.length ? `, Repair Node(s): ${rn.map((n) => TL_LO[n]).join(", ")}` : ""}`, `     local label ${e.label}      labels imposed {${bkImposed(s, e)}}`);
  }
  return out;
}
function xrCef(s: TlState, r: TlR, ip: string): string {
  const f = farHost(r);
  const head = (p: string, lab: boolean) => `${p}, version ${40 + TL_IDX[r]}${lab ? ", labeled SR" : ""}, internal 0x1000001 0x8310 (ptr 0x7fa1b2c3d0) [1], 0x0 (0x0), 0xa28 (0x7fa1d4e5f0)`;
  if (f && inPfx(ip, f.net, 24)) {
    const e = tlPfx(s.view, r, f.r);
    return [head(`${f.net}/24`, false), ` Updated ${spStamp(30).xr.replace(" UTC", "")}`, " Prefix Len 24, traffic index 0, precedence n/a, priority 4", `   via ${TL_LO[f.r]}/32, 3 dependencies, recursive [flags 0x6000]`, "    path-idx 0 NHID 0x0 [0x7fa1e6f7a8 0x0]", ...(e?.nh ? xrCefVia(s, r, e).map((l) => `  ${l}`) : ["    unresolved"])].join("\n");
  }
  const lo = tlRouterOfLo(ip);
  if (lo && lo !== r) {
    const rt = s.view.rib[r].find((x) => x.dst === lo);
    if (!rt?.nh) return `${ip}/32, version 0, drop adjacency`;
    const e = tlPfx(s.view, r, lo);
    if (!e) return [head(`${ip}/32`, false), ` Updated ${spStamp(15).xr.replace(" UTC", "")}`, `   via ${rt.nh.ip}/32, ${xrIf(rt.nh.ifn)}, 5 dependencies, weight 0, class 0 [flags 0x0]`, `    next hop ${rt.nh.ip}/32`, "     labels imposed {None}"].join("\n");
    return [head(`${ip}/32`, e.out !== "Unlabelled"), ` Updated ${spStamp(15).xr.replace(" UTC", "")}`, ` local label ${e.label}`, ...xrCefVia(s, r, e)].join("\n");
  }
  return xrRouteIp(s, r, ip).startsWith("%") ? `${ip}/32, version 0, drop adjacency` : [head(`${ip}/32`, false), "   receive"].join("\n");
}
function xrLogging(s: TlState, r: TlR): string {
  const lines = s.sys.filter((x) => x.dev === r && x.kind !== "frr").slice(-30).map((x) => {
    const st = `RP/0/RP0/CPU0:${spStamp(x.t).xr}`;
    const i = x.peer ? tlIfTo(r, x.peer as TlR) : undefined;
    if (x.kind === "bfd-down") return `${st}: bfd[1100]: %L2-BFD-6-SESSION_STATE_DOWN : BFD session to neighbor ${i?.peerIp} on interface ${xrIf(i?.ifn ?? "ge-0/0/0")} has gone down. Reason: Control timer expired`;
    if (x.kind === "adj-up" || x.kind === "adj-down") {
      const why = x.kind === "adj-up" ? "Up, New adjacency" : (() => {
        const sil = i?.link.silent;
        const bfd = i && s.cfg[r].ifs[i.ifn]?.bfd && s.cfg[i.peer].ifs[i.peerIf]?.bfd;
        return sil ? (bfd ? "Down, BFD session DOWN" : "Down, Hold time expired") : "Down, Interface state down";
      })();
      return `${st}: isis[1012]: %ROUTING-ISIS-4-ADJCHANGE : Adjacency to ${x.peer} (${i ? xrIf(i.ifn) : "?"}) (L2) ${why}`;
    }
    return `${st}: config[65857]: %MGBL-CONFIG-6-DB_COMMIT : Configuration committed by user 'admin'. Use 'show commit changes ${1000000000 + x.t}' to view the changes.`;
  });
  return ["Syslog logging: enabled (0 messages dropped, 0 flushes, 0 overruns)", `    Buffer logging: level debugging, ${lines.length} messages logged`, "", "Log Buffer (2097152 bytes):", "", ...lines].join("\n");
}

// ---------------------------------------------------------------------------------------------------------------
// Junos outputs
// ---------------------------------------------------------------------------------------------------------------
function jnAdj(s: TlState, r: TlR): string {
  const rows = tlIfs(r).filter((i) => s.view.adj[i.link.id]).map((i) => `${pad(jnIf(i.ifn), 22)}${pad(i.peer, 15)}${pad("2", 2)}${pad("Up", 14)}${lpad(20 + ((s.clock + TL_IDX[i.peer]) % 7), 12)}`);
  return ["Interface             System         L State         Hold (secs) SNPA", ...rows].join("\n");
}
function jnCoverage(s: TlState, r: TlR): string {
  const rows = s.view.pfx[r].filter((p) => !p.own);
  const nodes = TL_ROUTERS.filter((d) => d !== r && s.view.rib[r].some((x) => x.dst === d));
  const nodeCov = nodes.filter((d) => tlPfx(s.view, r, d)?.backup).length;
  const pc = (n: number, d: number) => `${d ? ((100 * n) / d).toFixed(2) : "0.00"}%`;
  return ["Backup Coverage:", "Topology        Level   Node     IPv4     IPv6     CLNS", `IPV4 Unicast        2  ${pad(pc(nodeCov, nodes.length), 9)}${pad(pc(rows.filter((p) => p.backup).length, rows.length), 9)}${pad("0.00%", 9)}0.00%`].join("\n");
}
function jnBackupSpf(s: TlState, r: TlR): string {
  if (!s.cfg[r].sr) return "";
  const out = ["IS-IS level 1 SPF results:", "  0 nodes", "", "IS-IS level 2 SPF results:"];
  const ps = s.view.pfx[r].filter((p) => !p.own).sort((a, b) => TL_IDX[a.dst] - TL_IDX[b.dst]);
  for (const p of ps) {
    const rt = s.view.rib[r].find((x) => x.dst === p.dst)!;
    out.push(`${p.dst}.00`, `    Primary next-hop: ${jnIf(p.nh!.ifn)}, IPV4, ${p.nh!.nh}, SNPA: 0:50:56:${TL_IDX[r]}${TL_IDX[p.nh!.nh]}:0:1`);
    const b = p.backup;
    if (!b) {
      const why = p.noBackup ?? "no protection configured on the primary interface";
      out.push(`      Not eligible, IPV4, Reason: ${/avoids/.test(why) ? "No path avoiding the protected resource" : /SR-capable/.test(why) ? "Repair node not SR capable" : /loop-free/.test(why) ? "Path loops" : "Interface is not protected"}`);
      continue;
    }
    out.push(`    Root: ${b.nh.nh}, Root Metric: ${s.cfg[r].ifs[b.nh.ifn]!.metric}, Metric: ${b.cost}, Root Preference: 0x0`);
    if (b.kind === "lfa") out.push(`      Eligible, Backup next-hop: ${jnIf(b.nh.ifn)}, IPV4, ${b.nh.nh}, Link protection`);
    else out.push(`      Eligible, Backup next-hop: ${jnIf(b.nh.ifn)}, LSP, ${b.nh.nh}, ${b.repair.length ? `Label: ${b.repair.join(", ")}, ` : ""}Post-convergence-lfa, ${b.protect === "node" ? "Node protection" : "Link protection"}`, `      Post-convergence path: ${b.path.join(" -> ")}${rt.cost ? "" : ""}`);
  }
  out.push(`  ${ps.length} nodes`);
  return out.join("\n");
}
function jnBfd(s: TlState, r: TlR): string {
  const ifs = tlIfs(r).filter((i) => s.cfg[r].ifs[i.ifn]!.bfd && s.cfg[r].ifs[i.ifn]!.isis);
  if (!ifs.length) return "";
  const rows = ifs.map((i) => `${pad(i.peerIp, 25)}${pad(s.view.adj[i.link.id] && s.cfg[i.peer].ifs[i.peerIf]!.bfd ? "Up" : "Down", 10)}${pad(jnIf(i.ifn), 15)}${pad("0.150", 9)}${pad("0.050", 10)}3`);
  const up = rows.filter((x) => / Up /.test(x)).length;
  return ["                                                  Detect   Transmit", "Address                  State     Interface      Time     Interval  Multiplier", ...rows, "", `${ifs.length} sessions, ${ifs.length} clients`, `Cumulative transmit rate ${(20 * ifs.length).toFixed(1)} pps, cumulative receive rate ${(20 * up).toFixed(1)} pps`].join("\n");
}
const jnBk = (s: TlState, p: TlPrefix, swap: boolean) => {
  if (!p.backup) return [];
  const st = tlBackupStack(s.cfg, p);
  const inner = st.length && st[st.length - 1] === p.label && p.backup.nh.nh !== p.dst ? st.slice(0, -1) : st;
  const first = st.length && st[st.length - 1] === p.label && p.backup.nh.nh !== p.dst ? `${swap ? "Swap" : "Push"} ${p.label}` : swap ? "Pop" : "";
  const parts = [first, ...inner.reverse().map((l, k, a) => `Push ${l}${k === a.length - 1 ? "(top)" : ""}`)].filter(Boolean);
  return [`                       to ${p.backup.nh.ip} via ${jnIf(p.backup.nh.ifn)}${parts.length ? `, ${parts.join(", ")}` : ""}`];
};
function jnInet3(s: TlState, r: TlR): string {
  if (!s.cfg[r].sr) return "";
  const rows = TL_ROUTERS.filter((o) => o !== r).flatMap((o) => {
    const e = tlPfx(s.view, r, o);
    const rt = s.view.rib[r].find((x) => x.dst === o);
    if (!e?.nh || !rt || e.out === "Unlabelled") return [];
    return [[`${pad(`${TL_LO[o]}/32`, 19)}*[L-ISIS/14] ${age(s)}, metric ${rt.cost}`, `                    >  to ${e.nh.ip} via ${jnIf(e.nh.ifn)}${e.out === "Pop" ? "" : `, Push ${e.out}`}`, ...jnBk(s, e, false)]];
  });
  const n = rows.length;
  return [`inet.3: ${n} destinations, ${n} routes (${n} active, 0 holddown, 0 hidden)`, ...(n ? ["+ = Active Route, - = Last Active, * = Both", "", ...rows.flat()] : [])].join("\n");
}
function jnMpls0(s: TlState, r: TlR): string {
  const rows: { k: number; l: string[] }[] = [{ k: 0, l: ["0                  *[MPLS/0] 01:00:00, metric 1", "                       to table inet.0"] }];
  if (s.cfg[r].sr) {
    for (const e of s.view.pfx[r].filter((x) => !x.own && x.nh && x.out !== "Unlabelled")) {
      const rt = s.view.rib[r].find((x) => x.dst === e.dst);
      rows.push({ k: e.label, l: [`${pad(e.label, 19)}*[L-ISIS/14] ${age(s)}, metric ${rt?.cost ?? 0}`, `                    >  to ${e.nh!.ip} via ${jnIf(e.nh!.ifn)}, ${e.out === "Pop" ? "Pop" : `Swap ${e.out}`}`, ...jnBk(s, e, true)] });
    }
    for (const i of tlIfs(r).filter((x) => s.view.adj[x.link.id])) {
      const l = tlAdj("junos", r, i.peer);
      rows.push({ k: l, l: [`${pad(l, 19)}*[L-ISIS/14] ${age(s)}, metric 0`, `                    >  to ${i.peerIp} via ${jnIf(i.ifn)}, Pop`] });
    }
  }
  rows.sort((a, b) => a.k - b.k);
  return [`mpls.0: ${rows.length} destinations, ${rows.length} routes (${rows.length} active, 0 holddown, 0 hidden)`, "+ = Active Route, - = Last Active, * = Both", "", ...rows.flatMap((x) => x.l)].join("\n");
}
function jnRouteIp(s: TlState, r: TlR, ip: string): string {
  const f = farHost(r);
  const me = myHost(r);
  const lo = tlRouterOfLo(ip);
  const total = 12 + tlIfs(r).length;
  const head = `inet.0: ${total} destinations, ${total} routes (${total} active, 0 holddown, 0 hidden)`;
  if (f && inPfx(ip, f.net, 24)) {
    const e = tlPfx(s.view, r, f.r);
    if (!e?.nh || e.out === "Unlabelled") return [head.replace(`(${total} active, 0 holddown, 0 hidden)`, `(${total - 1} active, 0 holddown, 1 hidden)`)].join("\n");
    return [head, "+ = Active Route, - = Last Active, * = Both", "", `${pad(`${f.net}/24`, 19)}*[BGP/170] ${age(s)}, localpref 100, from ${TL_LO[f.r]}`, "                      AS path: I, validation-state: unverified", `                    >  to ${e.nh.ip} via ${jnIf(e.nh.ifn)}${e.out === "Pop" ? "" : `, Push ${e.out}`}`, ...jnBk(s, e, false)].join("\n");
  }
  if (me && inPfx(ip, me.net, 24)) return [head, "+ = Active Route, - = Last Active, * = Both", "", `${pad(`${me.net}/24`, 19)}*[Direct/0] ${age(s)}`, `                    >  via ${jnIf(lanIf(r)!)}`].join("\n");
  if (lo && lo !== r) {
    const rt = s.view.rib[r].find((x) => x.dst === lo);
    if (!rt?.nh) return "";
    const e = tlPfx(s.view, r, lo);
    return [head, "+ = Active Route, - = Last Active, * = Both", "", `${pad(`${ip}/32`, 19)}*[IS-IS/18] ${age(s)}, metric ${rt.cost}`, `                    >  to ${rt.nh.ip} via ${jnIf(rt.nh.ifn)}`, ...(e?.backup && e.backup.kind === "lfa" ? [`                       to ${e.backup.nh.ip} via ${jnIf(e.backup.nh.ifn)}`] : []), "", jnInet3(s, r).split("\n").filter((l, k, a) => k === 0 || l.startsWith(`${ip}/32`) || ((a[k - 1] ?? "").startsWith(`${ip}/32`) && l.startsWith(" ")) || ((a[k - 2] ?? "").startsWith(`${ip}/32`) && l.startsWith("                       to"))).join("\n")].join("\n");
  }
  return "";
}
function jnLog(s: TlState, r: TlR): string {
  return s.sys.filter((x) => x.dev === r && x.kind !== "frr").slice(-30).map((x) => {
    const st = `${spStamp(x.t).junos}  ${r}`;
    const i = x.peer ? tlIfTo(r, x.peer as TlR) : undefined;
    if (x.kind === "bfd-down") return `${st} bfdd[1400]: BFDD_STATE_UP_TO_DOWN: BFD Session ${i?.peerIp} (IFL 33${TL_IDX[r]}) state Up -> Down LD/RD(16/17) Up time:01:00:00 Local diag: CtlExpire Remote diag: None Reason: Detect Timer Expiry.`;
    if (x.kind === "adj-up") return `${st} rpd[1532]: RPD_ISIS_ADJUP: IS-IS new L2 adjacency to ${x.peer} on ${jnIf(i?.ifn ?? "ge-0/0/0")}`;
    if (x.kind === "adj-down") {
      const bfd = i && s.cfg[r].ifs[i.ifn]?.bfd && s.cfg[i.peer].ifs[i.peerIf]?.bfd;
      return `${st} rpd[1532]: RPD_ISIS_ADJDOWN: IS-IS lost L2 adjacency to ${x.peer} on ${jnIf(i?.ifn ?? "ge-0/0/0")}, reason: ${i?.link.silent ? (bfd ? "BFD Session Down" : "Aged Out") : "Interface Down"}`;
    }
    return `${st} mgd[4417]: UI_COMMIT: User 'admin' requested 'commit' operation (comment: none)`;
  }).join("\n");
}

// ---------------------------------------------------------------------------------------------------------------
// Configuration as each OS prints it
// ---------------------------------------------------------------------------------------------------------------
export function tlXrLines(r: TlR, c: TlRtr): string[] {
  const out: string[] = [`hostname ${r}`, "!", "interface Loopback0", ` ipv4 address ${TL_LO[r]} 255.255.255.255`, "!"];
  for (const i of tlIfs(r)) out.push(`interface ${xrIf(i.ifn)}`, ` description to ${i.peer}`, ` ipv4 address ${i.ip} 255.255.255.0`, "!");
  const h = myHost(r);
  const lan = lanIf(r);
  if (h && lan) out.push(`interface ${xrIf(lan)}`, ` description to ${r === "R1" ? "H1" : "H6"}`, ` ipv4 address ${h.gw} 255.255.255.0`, "!");
  out.push("router isis CORE", " is-type level-2-only", ` net 49.0001.0000.0000.000${TL_IDX[r]}.00`, " address-family ipv4 unicast", "  metric-style wide", ...(c.sr ? ["  segment-routing mpls"] : []), " !");
  out.push(" interface Loopback0", "  passive", "  address-family ipv4 unicast", ...(c.sid !== undefined ? [`   prefix-sid index ${c.sid}`] : []), "  !", " !");
  for (const i of tlIfs(r)) {
    const f = c.ifs[i.ifn]!;
    if (!f.isis) continue;
    out.push(` interface ${xrIf(i.ifn)}`, ...(f.bfd ? ["  bfd minimum-interval 50", "  bfd multiplier 3", "  bfd fast-detect ipv4"] : []), "  point-to-point", "  address-family ipv4 unicast", ...(f.frr ? ["   fast-reroute per-prefix"] : []), ...(f.tilfa ? ["   fast-reroute per-prefix ti-lfa"] : []), ...(f.node ? ["   fast-reroute per-prefix tiebreaker node-protecting index 100"] : []), ...(f.metric !== 10 ? [`   metric ${f.metric}`] : []), "  !", " !");
  }
  out.push("!");
  if (h) {
    const other = r === "R1" ? "R6" : "R1";
    out.push("router bgp 65000", ` bgp router-id ${TL_LO[r]}`, " address-family ipv4 unicast", `  network ${h.net}/24`, " !", ` neighbor ${TL_LO[other]}`, "  remote-as 65000", "  update-source Loopback0", "  address-family ipv4 unicast", "  !", " !", "!");
  }
  return out;
}
export function tlJnStmts(r: TlR, c: TlRtr): JStmt[] {
  const out: JStmt[] = [];
  for (const i of tlIfs(r)) {
    const f = c.ifs[i.ifn]!;
    out.push({ path: ["interfaces", i.ifn], leaf: `description "to ${i.peer}"` }, { path: ["interfaces", i.ifn, "unit 0", "family inet"], leaf: `address ${i.ip}/24` });
    if (f.isis) out.push({ path: ["interfaces", i.ifn, "unit 0", "family iso"], leaf: "" });
    out.push({ path: ["interfaces", i.ifn, "unit 0", "family mpls"], leaf: "" });
  }
  const h = myHost(r);
  const lan = lanIf(r);
  if (h && lan) out.push({ path: ["interfaces", lan, "unit 0", "family inet"], leaf: `address ${h.gw}/24` });
  out.push({ path: ["interfaces", "lo0", "unit 0", "family inet"], leaf: `address ${TL_LO[r]}/32` }, { path: ["interfaces", "lo0", "unit 0", "family iso"], leaf: `address 49.0001.0000.0000.000${TL_IDX[r]}.00` });
  out.push({ path: ["routing-options"], leaf: `router-id ${TL_LO[r]}` }, { path: ["routing-options"], leaf: "autonomous-system 65000" });
  if (h) {
    const other = r === "R1" ? "R6" : "R1";
    out.push({ path: ["protocols", "bgp", "group IBGP"], leaf: "type internal" }, { path: ["protocols", "bgp", "group IBGP"], leaf: `local-address ${TL_LO[r]}` }, { path: ["protocols", "bgp", "group IBGP"], leaf: "export CUSTOMER" }, { path: ["protocols", "bgp", "group IBGP"], leaf: `neighbor ${TL_LO[other]}` });
  }
  if (c.sr) {
    const sp = ["protocols", "isis", "source-packet-routing"];
    out.push({ path: sp, leaf: `srgb start-label ${SRGB_START} index-range 8000` });
    if (c.sid !== undefined) out.push({ path: sp, leaf: `node-segment ipv4-index ${c.sid}` });
  }
  out.push({ path: ["protocols", "isis"], leaf: "level 1 disable" });
  if (c.pcl) out.push({ path: ["protocols", "isis", "backup-spf-options"], leaf: "use-post-convergence-lfa" });
  if (c.spr) out.push({ path: ["protocols", "isis", "backup-spf-options"], leaf: "use-source-packet-routing" });
  for (const i of tlIfs(r)) {
    const f = c.ifs[i.ifn]!;
    if (!f.isis) continue;
    const ip = ["protocols", "isis", `interface ${i.ifn}.0`];
    if (f.lp) out.push({ path: ip, leaf: "link-protection" });
    out.push({ path: ip, leaf: "point-to-point" });
    if (f.metric !== 10) out.push({ path: [...ip, "level 2"], leaf: `metric ${f.metric}` });
    if (f.tilfa) out.push({ path: [...ip, "level 2"], leaf: f.node ? "post-convergence-lfa node-protection" : "post-convergence-lfa" });
    if (f.bfd) out.push({ path: [...ip, "bfd-liveness-detection"], leaf: "minimum-interval 50" }, { path: [...ip, "bfd-liveness-detection"], leaf: "multiplier 3" });
  }
  out.push({ path: ["protocols", "isis", "interface lo0.0"], leaf: "passive" });
  for (const i of tlIfs(r)) out.push({ path: ["protocols", "mpls"], leaf: `interface ${i.ifn}.0` });
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Configuration statements
// ---------------------------------------------------------------------------------------------------------------
function stmts(r: TlR): SpCfgStmt<TlRtr>[] {
  const P2P = "% This lab keeps every core link point-to-point.";
  const LO = "% Loopback0 has no fast reroute: it is not a protected link.";
  const phy = (x: Record<string, string>) => x.if !== "lo0";
  return [
    // IOS XR
    { id: "router-isis", summary: "IS-IS routing protocol", args: { tag: choiceArg(["CORE"], () => "Instance tag") }, xr: { mode: "config", syntax: "router isis <tag>", enter: "isis", apply: (c) => c } },
    { id: "isis-af", summary: "Enter the IPv4 unicast address family", xr: { mode: "isis", syntax: "address-family ipv4 unicast", enter: "isis-af", apply: (c) => c } },
    { id: "isis-ms", summary: "Use wide metrics (TLVs 22 and 135)", args: { w: choiceArg(["wide"], () => "Wide metrics") }, xr: { mode: "isis-af", syntax: "metric-style <w>", apply: (c) => c, no: () => "% Segment routing needs wide metrics." } },
    { id: "isis-sr", summary: "Enable segment routing (MPLS data plane) for this address family", args: { m: choiceArg(["mpls"], () => "MPLS data plane") }, xr: { mode: "isis-af", syntax: "segment-routing <m>", apply: (c) => ((c.sr = true), c), no: (c) => ((c.sr = false), c) } },
    { id: "isis-if", summary: "Enter the IS-IS interface configuration submode", args: { if: xrIfArg(r, true) }, xr: { mode: "isis", syntax: "interface <if>", enter: "isis-if", apply: (c, a) => (a.if === "lo0" ? c : ((ifc(c, a.if).isis = true), c)), no: (c, a) => (a.if === "lo0" ? "% This lab keeps Loopback0 in IS-IS." : ((ifc(c, a.if).isis = false), c)) } },
    { id: "isis-p2p", summary: "Treat the interface as point-to-point", xr: { mode: "isis-if", syntax: "point-to-point", apply: (c) => c, no: () => P2P } },
    { id: "isis-passive", summary: "Advertise the prefix but send no hellos", xr: { mode: "isis-if", syntax: "passive", apply: (c, _a, x) => (x.if === "lo0" ? c : "% This lab only uses passive on Loopback0.") } },
    { id: "bfd-fd", summary: "Bring up BFD with the neighbor; IS-IS drops the adjacency when BFD goes down", args: { af: choiceArg(["ipv4"], () => "IPv4 BFD") }, xr: { mode: "isis-if", syntax: "bfd fast-detect <af>", apply: (c, _a, x) => (phy(x) ? ((ifc(c, x.if).bfd = true), c) : "% BFD runs on the core links in this lab."), no: (c, _a, x) => (phy(x) ? ((ifc(c, x.if).bfd = false), c) : c) } },
    { id: "bfd-min", summary: "BFD transmit and receive interval (ms)", args: { n: bfdMinArg }, xr: { mode: "isis-if", syntax: "bfd minimum-interval <n>", noSyntax: "bfd minimum-interval", apply: (c, a) => (+a.n === 50 ? c : BFD_FIXED), no: () => BFD_FIXED } },
    { id: "bfd-mul", summary: "BFD detect multiplier", args: { n: bfdMulArg }, xr: { mode: "isis-if", syntax: "bfd multiplier <n>", noSyntax: "bfd multiplier", apply: (c, a) => (+a.n === 3 ? c : BFD_FIXED), no: () => BFD_FIXED } },
    { id: "isis-if-af", summary: "Enter the interface IPv4 unicast address family", xr: { mode: "isis-if", syntax: "address-family ipv4 unicast", enter: "isis-if-af", apply: (c) => c } },
    { id: "isis-metric", summary: "Set the default metric for this interface", args: { n: metricArg }, xr: { mode: "isis-if-af", syntax: "metric <n>", noSyntax: "metric", apply: (c, a, x) => (x.if === "lo0" ? "% This lab keeps Loopback0 at metric 0." : ((ifc(c, x.if).metric = +a.n), c)), no: (c, _a, x) => (x.if === "lo0" ? c : ((ifc(c, x.if).metric = defMetric(r, x.if)), c)) } },
    { id: "frr", summary: "Compute a backup for every prefix that uses this interface (per-prefix LFA)", xr: { mode: "isis-if-af", syntax: "fast-reroute per-prefix", apply: (c, _a, x) => (phy(x) ? ((ifc(c, x.if).frr = true), c) : LO), no: (c, _a, x) => (phy(x) ? (Object.assign(ifc(c, x.if), { frr: false, tilfa: false, node: false }), c) : c) } },
    { id: "frr-ti", summary: "Use TI-LFA: repair along the post-convergence path with segment routing", xr: { mode: "isis-if-af", syntax: "fast-reroute per-prefix ti-lfa", apply: (c, _a, x) => (phy(x) ? ((ifc(c, x.if).tilfa = true), c) : LO), no: (c, _a, x) => (phy(x) ? ((ifc(c, x.if).tilfa = false), c) : c) } },
    { id: "frr-np", summary: "Prefer backups that avoid the next-hop router (node protection)", args: { i: numArg(1, 255, ["100"], "Tiebreaker priority") }, xr: { mode: "isis-if-af", syntax: "fast-reroute per-prefix tiebreaker node-protecting index <i>", noSyntax: "fast-reroute per-prefix tiebreaker node-protecting index", apply: (c, _a, x) => (phy(x) ? ((ifc(c, x.if).node = true), c) : LO), no: (c, _a, x) => (phy(x) ? ((ifc(c, x.if).node = false), c) : c) } },
    { id: "isis-sid", summary: "Prefix-SID for this prefix", args: { i: choiceArg(["index"], () => "SID index (label = SRGB start + index)"), n: sidArg }, xr: { mode: "isis-if-af", syntax: "prefix-sid <i> <n>", noSyntax: "prefix-sid", apply: (c, a, x) => (x.if !== "lo0" ? "% Prefix-SIDs are configured on the loopback in this lab." : +a.n !== TL_IDX[r] ? `% This lab keeps ${r} at index ${TL_IDX[r]}.` : ((c.sid = +a.n), c)), no: (c) => ((c.sid = undefined), c) } },
    // Junos
    { id: "j-spring", summary: "Segment routing for IS-IS (delete removes it all)", junos: { syntax: "protocols isis source-packet-routing", set: (c) => ((c.sr = true), c), del: (c) => ((c.sr = false), (c.sid = undefined), c) } },
    { id: "j-srgb", summary: "Segment Routing Global Block", args: { s: choiceArg(["16000"], () => "Start label"), n: choiceArg(["8000"], () => "Number of labels") }, junos: { syntax: "protocols isis source-packet-routing srgb start-label <s> index-range <n>", set: (c) => ((c.sr = true), c), del: () => "error: this lab keeps the SRGB at 16000–23999" } },
    { id: "j-nodeseg", summary: "Prefix-SID index of the loopback (node segment)", args: { n: sidArg }, junos: { syntax: "protocols isis source-packet-routing node-segment ipv4-index <n>", set: (c, a) => (+a.n !== TL_IDX[r] ? `error: this lab keeps ${r} at index ${TL_IDX[r]}` : ((c.sr = true), (c.sid = +a.n), c)), del: (c) => ((c.sid = undefined), c) } },
    { id: "j-bso-pcl", summary: "Compute post-convergence (TI-LFA) backup paths", junos: { syntax: "protocols isis backup-spf-options use-post-convergence-lfa", set: (c) => ((c.pcl = true), c), del: (c) => ((c.pcl = false), c) } },
    { id: "j-bso-spr", summary: "Use segment routing labels for backup paths", junos: { syntax: "protocols isis backup-spf-options use-source-packet-routing", set: (c) => ((c.spr = true), c), del: (c) => ((c.spr = false), c) } },
    { id: "j-bso", summary: "Backup SPF options (delete removes them all)", junos: { syntax: "protocols isis backup-spf-options", del: (c) => ((c.pcl = false), (c.spr = false), c) } },
    { id: "j-isis-if", summary: "Include an interface in IS-IS", args: { if: jnUnitArg(r) }, junos: { syntax: "protocols isis interface <if>", set: (c, a) => ((ifc(c, a.if).isis = true), c), del: (c, a) => ((ifc(c, a.if).isis = false), c) } },
    { id: "j-isis-p2p", summary: "Treat the interface as point-to-point", args: { if: jnUnitArg(r) }, junos: { syntax: "protocols isis interface <if> point-to-point", set: (c, a) => ((ifc(c, a.if).isis = true), c), del: () => P2P.slice(2) } },
    { id: "j-isis-metric", summary: "Metric for this interface at this level", args: { if: jnUnitArg(r), l: lvlArg, n: metricArg }, junos: { syntax: "protocols isis interface <if> level <l> metric <n>", set: (c, a) => ((ifc(c, a.if).metric = +a.n), c) } },
    { id: "j-isis-metric-del", summary: "Remove the metric for this interface at this level", args: { if: jnUnitArg(r), l: lvlArg }, junos: { syntax: "protocols isis interface <if> level <l> metric", del: (c, a) => ((ifc(c, a.if).metric = defMetric(r, a.if)), c) } },
    { id: "j-pcl", summary: "Protect this interface with TI-LFA (post-convergence path)", args: { if: jnUnitArg(r), l: lvlArg }, junos: { syntax: "protocols isis interface <if> level <l> post-convergence-lfa", set: (c, a) => ((ifc(c, a.if).tilfa = true), c), del: (c, a) => (Object.assign(ifc(c, a.if), { tilfa: false, node: false }), c) } },
    { id: "j-pcl-np", summary: "TI-LFA that avoids the next-hop router (node protection)", args: { if: jnUnitArg(r), l: lvlArg }, junos: { syntax: "protocols isis interface <if> level <l> post-convergence-lfa node-protection", set: (c, a) => (Object.assign(ifc(c, a.if), { tilfa: true, node: true }), c), del: (c, a) => ((ifc(c, a.if).node = false), c) } },
    { id: "j-lp", summary: "Protect this interface with a loop-free alternate (classic LFA)", args: { if: jnUnitArg(r) }, junos: { syntax: "protocols isis interface <if> link-protection", set: (c, a) => ((ifc(c, a.if).lp = true), c), del: (c, a) => ((ifc(c, a.if).lp = false), c) } },
    { id: "j-bfd-min", summary: "BFD interval (ms) — starts BFD with the neighbor", args: { if: jnUnitArg(r), n: bfdMinArg }, junos: { syntax: "protocols isis interface <if> bfd-liveness-detection minimum-interval <n>", set: (c, a) => (+a.n === 50 ? ((ifc(c, a.if).bfd = true), c) : `error: ${BFD_FIXED.slice(2)}`) } },
    { id: "j-bfd-mul", summary: "BFD detect multiplier", args: { if: jnUnitArg(r), n: bfdMulArg }, junos: { syntax: "protocols isis interface <if> bfd-liveness-detection multiplier <n>", set: (c, a) => (+a.n !== 3 ? `error: ${BFD_FIXED.slice(2)}` : ifc(c, a.if).bfd ? c : "error: set minimum-interval 50 first in this lab") } },
    { id: "j-bfd", summary: "BFD for this interface (delete removes it)", args: { if: jnUnitArg(r) }, junos: { syntax: "protocols isis interface <if> bfd-liveness-detection", del: (c, a) => ((ifc(c, a.if).bfd = false), c) } },
  ];
}

// ---------------------------------------------------------------------------------------------------------------
// Command sets
// ---------------------------------------------------------------------------------------------------------------
export function tlXrSpec(api: TlCliApi, r: TlR): SpXrSpec<TlRtr> {
  const s = api.s;
  const sh = (id: string, syntax: string, summary: string, run: SpCmd["run"], args?: SpCmd["args"]): SpCmd => ({ id, syntax, summary, run, args });
  const nothing = (o: string, why: string) => o || { output: "", explanation: why };
  const NO_SR = "Segment routing is not enabled in IS-IS here.";
  return {
    stmts: stmts(r).filter((x) => x.xr),
    prompts: { config: "config", isis: "config-isis", "isis-af": "config-isis-af", "isis-if": "config-isis-if", "isis-if-af": "config-isis-if-af" },
    lines: (c) => tlXrLines(r, c),
    help: { "show isis": "IS-IS information", "show isis fast-reroute": "IS-IS fast reroute information", "show isis segment-routing": "Segment routing information", "show bfd": "BFD information", "show mpls": "MPLS information", "show route": "IP routing table" },
    shows: [
      sh("frr", "show isis fast-reroute", "Every prefix's primary path and its backup", () => nothing(xrFrr(s, r), NO_SR)),
      sh("frrs", "show isis fast-reroute summary", "How many prefixes are protected", () => xrFrrSummary(s, r)),
      sh("frrd", "show isis fast-reroute <fec> detail", "One prefix's backup in detail", (a) => nothing(xrFrr(s, r, tlRouterOfLo(a.fec)), "No such prefix in the FRR table."), { fec: fecArg }),
      sh("isif", "show isis interface <if>", "IS-IS, BFD and fast-reroute settings of an interface", (a) => nothing(xrIsisIf(s, r, a.if), "Not an IS-IS interface."), { if: xrIfArg(r) }),
      sh("adj", "show isis adjacency", "IS-IS adjacencies (with BFD state)", () => xrAdj(s, r)),
      sh("bfd", "show bfd session", "BFD sessions", () => nothing(xrBfd(s, r), "No BFD session on this router.")),
      sh("lbl", "show isis segment-routing label table", "The Prefix-SID labels this router programs", () => nothing(xrLabelTable(s, r), NO_SR)),
      sh("fwd", "show mpls forwarding", "The label forwarding table — (!) marks backup paths", () => nothing(xrForwarding(s, r), NO_SR)),
      sh("fwdl", "show mpls forwarding labels <n>", "One label's entries (primary and backup)", (a) => nothing(xrForwarding(s, r, +a.n), "No such local label."), { n: labelArg }),
      sh("fwdld", "show mpls forwarding labels <n> detail", "One label's entries with their full label stacks", (a) => nothing(xrForwarding(s, r, +a.n, true), "No such local label."), { n: labelArg }),
      sh("route", "show route", "The IPv4 routing table", () => [...XR_CODES, ...xrRib(s, r).map((x) => xrRouteLine(s, x))].join("\n")),
      sh("routeip", "show route <ip>", "The route a destination uses, with its backup", (a) => xrRouteIp(s, r, a.ip), { ip: ipArg }),
      sh("cef", "show cef <ip>", "The forwarding entry: primary and backup, labels imposed", (a) => xrCef(s, r, a.ip), { ip: pfxArg }),
      sh("log", "show logging", "The syslog buffer", () => xrLogging(s, r)),
    ],
    exec: [],
  };
}
export function tlJunosSpec(api: TlCliApi, r: TlR): SpJunosSpec<TlRtr> {
  const s = api.s;
  const sh = (id: string, syntax: string, summary: string, run: SpCmd["run"], args?: SpCmd["args"]): SpCmd => ({ id, syntax, summary, run, args });
  const nothing = (o: string, why: string) => o || { output: "", explanation: why };
  const tbl = choiceArg(["inet.3", "mpls.0"], (c) => (c === "inet.3" ? "SR routes to the loopbacks, with backup next hops" : "Label forwarding, with backup next hops"));
  return {
    stmts: stmts(r).filter((x) => x.junos),
    jstmts: (c) => tlJnStmts(r, c),
    help: { "show isis": "Show Intermediate System-to-Intermediate System information", "show isis backup": "Show IS-IS backup information", "show bfd": "Show Bidirectional Forwarding Detection information", "show route": "Show routing table information", "show route table": "Name of the routing table" },
    shows: [
      sh("adj", "show isis adjacency", "IS-IS adjacencies", () => jnAdj(s, r)),
      sh("cov", "show isis backup coverage", "How much of the topology has a backup", () => jnCoverage(s, r)),
      sh("spf", "show isis backup spf results", "Each destination's primary and backup next hop", () => nothing(jnBackupSpf(s, r), "Segment routing is not enabled in IS-IS here.")),
      sh("bfd", "show bfd session", "BFD sessions", () => nothing(jnBfd(s, r), "No BFD session on this router.")),
      sh("tbl", "show route table <t>", "inet.3 or mpls.0", (a) => nothing(a.t === "inet.3" ? jnInet3(s, r) : jnMpls0(s, r), "Segment routing is not enabled in IS-IS here."), { t: tbl }),
      sh("rt", "show route <ip>", "The route a destination uses", (a) => nothing(jnRouteIp(s, r, a.ip), "No route."), { ip: ipArg }),
      sh("log", "show log messages", "The system log", () => nothing(jnLog(s, r), "No messages since the lab started.")),
    ],
  };
}
export function tlSets(api: TlCliApi, r: TlR): Partial<Record<CliVendor, CliCommandSet>> {
  return { cisco: buildXrSet(api.dev, tlXrSpec(api, r)), juniper: buildJunosSet(api.dev, tlJunosSpec(api, r)) };
}
export const tlPipe = (api: TlCliApi, r: TlR) => ({ config: junosPipeConfig(api.dev, { jstmts: (c: TlRtr) => tlJnStmts(r, c) }), rollbacks: api.dev.hist.length });
export function tlStaticApi(s: TlState, r: TlR): TlCliApi {
  return { s, act: () => s, dev: { host: r, running: s.cfg[r], hist: s.hist[r], setCand: () => undefined, xr: [], setXr: () => undefined, edit: false, setEdit: () => undefined, commit: () => undefined } };
}
