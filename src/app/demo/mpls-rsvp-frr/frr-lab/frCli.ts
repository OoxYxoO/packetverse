import type { CliArgSpec, CliCommandSet, CliVendor } from "@/lib/cli/types";
import { buildJunosSet, buildXrSet, choiceArg, junosPipeConfig, numArg, type SpCfgStmt, type SpCmd, type SpDevCli, type SpJunosSpec, type SpXrSpec } from "@/components/sp-lab/spCli";
import { lpad, pad, spAge, spClone, spStamp, type JStmt } from "@/components/sp-lab/spKit";
import { jnIf, parseIf, xrIf } from "@/components/sp-lab/spNames";
import {
  CE_NET,
  FR_LINKS,
  FR_LO,
  FR_ROUTERS,
  IMPLICIT_NULL,
  autoId,
  byName,
  frRoute,
  igpPath,
  ifsOf,
  ifToward,
  ipOn,
  linkAlive,
  nhopOf,
  pathCost,
  routerByIp,
  teUsable,
  type FrAction,
  type FrBypass,
  type FrCfg,
  type FrHop,
  type FrLsp,
  type FrR,
  type FrState,
  type FrTunnel,
  type IfName,
} from "@/lib/sim-engine/scenarios/frrNet";

/**
 * Command lines of the Fast Reroute Lab — IOS XR or Junos on R1–R7. Every output is printed from the lab model: the
 * primary LSPs, the bypasses each PLR built, what each LSP is bound to, BFD, and the result of failure drills.
 *
 *   IOS XR  show mpls traffic-eng tunnels [brief | backup | <n>] · show mpls traffic-eng fast-reroute database ·
 *           show bfd session · show rsvp session · show route [<ip>] · show logging · ping / traceroute mpls
 *           traffic-eng tunnel-te <n> · mpls traffic-eng reoptimize
 *           configure → interface tunnel-te<n> (destination, signalled-bandwidth, path-option, autoroute announce,
 *           fast-reroute [protect node], shutdown) · explicit-path name <p> (index <i> next-address strict|loose /
 *           exclude-address) · mpls traffic-eng → interface <if> (auto-tunnel backup [nhop-only], backup-path
 *           tunnel-te<n>) · rsvp → interface <if> (bandwidth, bfd fast-detect) · interface <if> → shutdown · commit
 *   Junos   show mpls lsp [ingress | egress | transit | bypass] [extensive] · show rsvp session [detail] ·
 *           show bfd session · show route <ip> · show log messages · ping / traceroute mpls rsvp <lsp> ·
 *           clear mpls lsp optimize
 *           configure → set protocols mpls label-switched-path <lsp> to | bandwidth | primary | link-protection |
 *           node-link-protection | disable · protocols mpls path <p> <ip> strict|loose · protocols rsvp interface <if>
 *           bandwidth | link-protection [no-node-protection | bypass <name> to <ip> | bypass <name> path <ip> strict] |
 *           bfd-liveness-detection minimum-interval <ms> · interfaces <if> disable · commit
 */

export interface FrCliApi {
  s: FrState;
  act: (a: FrAction) => FrState;
  dev: SpDevCli<FrCfg>;
}

// ---------------------------------------------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------------------------------------------
const ipRe = /^(\d{1,3}\.){3}\d{1,3}$/;
const anyIp = (choices: string[], what: string): CliArgSpec => ({ choices, describe: (c) => routerByIp(c) ?? what, resolve: (raw) => (ipRe.test(raw) && raw.split(".").every((o) => +o <= 255) ? raw : undefined) });
const loArg = anyIp(Object.values(FR_LO), "TE router ID");
const destArg: CliArgSpec = { choices: [...Object.values(FR_LO), CE_NET.CE6.host, CE_NET.CE1.host], describe: (c) => routerByIp(c) ?? "Destination", resolve: (raw) => (ipRe.test(raw) ? raw : undefined) };
const pifArg = (r: FrR, junos: boolean): CliArgSpec => ({
  choices: ifsOf(r).map((x) => (junos ? jnIf(x.ifn) : xrIf(x.ifn))),
  describe: (c) => {
    const i = ifsOf(r).find((x) => x.ifn === parseIf(c));
    return i ? `to ${i.peer}` : "Interface";
  },
  resolve: (raw) => {
    const i = parseIf(raw);
    return i && ifsOf(r).some((x) => x.ifn === i) ? i : undefined;
  },
});
const tifArg: CliArgSpec = { choices: ["tunnel-te1"], describe: () => "MPLS-TE tunnel interface", resolve: (raw) => {
  const m = /^tunnel-te(\d{1,5})$/i.exec(raw);
  return m && +m[1] >= 1 && +m[1] <= 999 ? String(+m[1]) : undefined;
} };
const tidArg = (s: FrState, r: FrR): CliArgSpec => ({ choices: s.cfg[r].tunnels.map((t) => String(t.id)), describe: () => "Tunnel number", resolve: (raw) => (/^\d{1,5}$/.test(raw) ? String(+raw) : undefined) });
const nameArg = (choices: string[], what: string): CliArgSpec => ({ choices, describe: () => what, resolve: (raw) => (/^[A-Za-z][\w-]{0,31}$/.test(raw) ? raw : undefined) });
const kbpsArg: CliArgSpec = { choices: ["500000", "1000000"], describe: () => "Bandwidth in kbps", resolve: (raw) => (/^\d{1,8}$/.test(raw) && +raw <= 10000000 ? String(+raw) : undefined) };
const jbwArg: CliArgSpec = { choices: ["500m", "1g"], describe: () => "Bandwidth (bps, with k / m / g)", resolve: (raw) => {
  const m = /^(\d+)([kmg]?)$/i.exec(raw);
  if (!m) return undefined;
  const bps = +m[1] * ({ "": 1, k: 1e3, m: 1e6, g: 1e9 } as Record<string, number>)[m[2].toLowerCase()];
  return bps >= 1000 && bps <= 1e10 ? String(Math.round(bps / 1000)) : undefined;
} };
const fmtJbw = (kbps: number) => (kbps % 1000000 === 0 ? `${kbps / 1000000}g` : kbps % 1000 === 0 ? `${kbps / 1000}m` : `${kbps}k`);
const lab = (n: number | undefined) => (n === undefined ? "-" : n === IMPLICIT_NULL ? "implicit-null" : String(n));
const ifOn = (r: FrR, peer: FrR) => ifToward(r, peer)!;
const sigName = (l: FrLsp) => `${l.head}_t${l.id}`;
const lspsAt = (s: FrState, r: FrR) => s.view.lsps.filter((l) => l.state === "up" && l.path?.includes(r));
const destRouter = (raw: string): { r: FrR; prefix: string } | undefined => {
  const lo = routerByIp(raw);
  if (lo && FR_LO[lo] === raw) return { r: lo, prefix: `${raw}/32` };
  for (const ce of Object.values(CE_NET)) if (raw.startsWith(ce.net.split(".").slice(0, 3).join("."))) return { r: ce.r, prefix: ce.net };
  return undefined;
};
const bypassOf = (s: FrState, l: FrLsp, r: FrR) => (l.prot[r] ? s.view.bypasses.find((b) => b.key === l.prot[r]) : undefined);
const mpLabel = (l: FrLsp, b: FrBypass) => l.labels[b.tail];

// ---------------------------------------------------------------------------------------------------------------
// IOS XR outputs
// ---------------------------------------------------------------------------------------------------------------
function xrBrief(s: FrState, r: FrR): string {
  const heads = s.view.lsps.filter((l) => l.head === r);
  const byp = s.view.bypasses.filter((b) => b.plr === r);
  const mids = lspsAt(s, r).filter((l) => l.head !== r && l.tail !== r);
  const tails = lspsAt(s, r).filter((l) => l.tail === r);
  const row = (name: string, dst: string, st: string, state: string) => `${lpad(name, 32)}${lpad(dst, 20)}${lpad(st, 12)}  ${state}`;
  return [
    `${lpad("TUNNEL NAME", 32)}${lpad("DESTINATION", 20)}${lpad("STATUS", 12)}  STATE`,
    ...heads.map((l) => row(`tunnel-te${l.id}`, s.cfg[r].tunnels.find((t) => t.id === l.id)!.dst || "0.0.0.0", l.state === "admin-down" ? "admin-down" : "up", l.state === "up" ? "up" : "down")),
    ...byp.map((b) => row(`${b.manual ? b.name : `tunnel-te${autoId(s.view, b)}`}`, FR_LO[b.tail], "up", b.up ? "up" : "down")),
    ...mids.map((l) => row(sigName(l), FR_LO[l.tail!], "", "up")),
    ...tails.map((l) => row(sigName(l), FR_LO[r], "", "up")),
    `Displayed ${heads.length + byp.length} (of ${heads.length + byp.length}) heads, ${mids.length} (of ${mids.length}) midpoints, ${tails.length} (of ${tails.length}) tails`,
    `Displayed ${heads.filter((l) => l.state === "up").length + byp.filter((b) => b.up).length} up, ${heads.filter((l) => l.state !== "up").length + byp.filter((b) => !b.up).length} down, 0 recovering, 0 recovered heads`,
  ].join("\n");
}
function xrTunnel(s: FrState, r: FrR, id: string): string {
  const l = s.view.lsps.find((x) => x.head === r && String(x.id) === id);
  const t = s.cfg[r].tunnels.find((x) => String(x.id) === id);
  if (!l || !t) {
    const b = s.view.bypasses.find((x) => x.plr === r && (String(x.manual ?? autoId(s.view, x)) === id));
    return b ? xrBackupOne(s, b) : `Tunnel tunnel-te${id} not found`;
  }
  const up = l.state === "up";
  const since = s.since[l.key] ?? s.clock;
  const out = [
    `Name: tunnel-te${t.id}  Destination: ${t.dst || "0.0.0.0"}  Ifhandle:0x${(0x8000 + t.id * 0x20).toString(16)}`,
    `  Signalled-Name: ${sigName(l)}`,
    "  Status:",
    `    Admin: ${t.shut ? " down" : "   up"} Oper: ${up ? "  up" : "down"}   Path: ${up ? " valid" : "not valid"}   Signalling: ${up ? "connected" : "Down"}`,
    "",
    `    path option 10,  type ${t.path ? `explicit ${t.path}` : "dynamic"}${up ? ` (Basis for Setup, path weight ${pathCost(l.path!)})` : ""}`,
    ...(!up && !t.shut ? [`      Last PCALC Error: ${spStamp(s.clock).xr.replace(" UTC", "")}`, `        Info: ${/strict|not in the TED|not defined/.test(l.why ?? "") ? `Explicit path cannot be satisfied: ${l.why}` : `No path to destination, ${t.dst}`}`] : []),
    "    G-PID: 0x0800 (derived from egress interface properties)",
    `    Bandwidth Requested: ${t.bw} kbps  CT0`,
    "  Config Parameters:",
    `    Bandwidth:   ${t.bw} kbps (CT0) Priority:  7  7 Affinity: 0x0/0xffff`,
    `    AutoRoute: ${t.autoroute ? " enabled" : "disabled"}  LockDown: disabled   Policy class: not set`,
    `    Fast Reroute: ${t.frr === "off" ? "Disabled" : "Enabled"}, Protection Desired: ${t.frr === "off" ? "None" : t.frr === "node" ? "Node" : "Link"}`,
    `    Path Protection: Not Enabled`,
  ];
  if (up) {
    const p = l.path!;
    out.push(
      "  History:",
      `    Tunnel has been up for: ${spAge(s.clock, since)} (since ${spStamp(since).xr.replace(" UTC", "")})`,
      "  Current LSP Info:",
      "    Instance: 2, Signaling Area: IS-IS CORE level-2",
      `    Outgoing Interface: ${xrIf(ifOn(r, p[1]))}, Outgoing Label: ${lab(l.labels[p[1]])}`,
      `    Router-IDs: local      ${FR_LO[r]}`,
      `                downstream ${FR_LO[p[1]]}`,
      "    Path Info:",
      "      Outgoing:",
      "        Explicit Route:",
      ...p.slice(1).map((x, i) => `          Strict, ${ipOn(x, p[i])}`),
      `          Strict, ${FR_LO[p[p.length - 1]]}`,
      `      Session Attributes: Local Prot: ${t.frr === "off" ? "Not Set" : "Set"}, Node Prot: ${t.frr === "node" ? "Set" : "Not Set"}, BW Prot: Not Set`,
      "    Resv Info:",
      "      Record Route:",
      ...p.slice(1).map((x) => {
        const b = bypassOf(s, l, x);
        const flags = b ? (b.type === "nnhop" ? "0x29 (Local Prot Avail/Node-ID/Node Prot)" : "0x21 (Local Prot Avail/Node-ID)") : "0x20 (Node-ID)";
        return `        IPv4 ${FR_LO[x]}, flags ${flags}\n        Label ${lab(l.labels[x])}, flags 0x1 (Global)`;
      }),
    );
  }
  return [...out, "", `Displayed 1 (of 1) heads, 0 (of 0) midpoints, 0 (of 0) tails`].join("\n");
}
function xrBackupOne(s: FrState, b: FrBypass): string {
  const prot = s.view.lsps.filter((l) => l.prot[b.plr] === b.key);
  return [
    `tunnel-te${b.manual ?? autoId(s.view, b)}${b.manual ? "" : " (auto-tunnel backup)"}`,
    `  Admin:    up, Oper: ${b.up ? "  up" : "down"}`,
    `  Src: ${FR_LO[b.plr]}, Dest: ${FR_LO[b.tail]}, Instance: 1`,
    `  ${b.type === "nhop" ? "Link protection (NHOP)" : "Node protection (NNHOP)"}, excludes ${b.type === "nhop" ? `link ${ipOn(b.plr, b.tail)}` : `node ${FR_LO[b.avoids as FrR]}`}`,
    ...(b.up ? [`  Path: ${b.path!.join(" -> ")}`] : [`  Last PCALC Error: ${b.why}`]),
    "  Fast Reroute Backup Provided:",
    `    Protected I/fs: ${xrIf(b.ifn)}`,
    `    Protected LSPs: ${prot.length} (${prot.length} ready, 0 active)`,
    "    Backup BW: any-class unlimited, Inuse: 0 kbps",
  ].join("\n");
}
function xrBackup(s: FrState, r: FrR): string {
  const bs = s.view.bypasses.filter((b) => b.plr === r);
  return bs.length ? bs.map((b) => xrBackupOne(s, b)).join("\n\n") : "";
}
function xrFrrDb(s: FrState, r: FrR): string {
  const rows = lspsAt(s, r).filter((l) => l.tail !== r && l.prot[r]).map((l) => {
    const i = l.path!.indexOf(r);
    const n = l.path![i + 1];
    const b = bypassOf(s, l, r)!;
    const id = b.manual ?? autoId(s.view, b);
    const out = `${xrIf(ifOn(r, n), true)}:${l.head === r ? lab(l.labels[n]) : lab(l.labels[n])}`;
    return { head: l.head === r, line: `${pad(l.head === r ? `tunnel-te${l.id}` : `${FR_LO[l.head]} ${l.id} [2]`, 27)}${pad(out, 17)}${pad(`tt${id}:${lab(mpLabel(l, b))}`, 22)}Ready` };
  });
  const unprot = lspsAt(s, r).filter((l) => l.tail !== r && !l.prot[r]);
  return [
    "Tunnel head FRR information:",
    "Tunnel                     Out intf/label   FRR intf/label        Status",
    "-------------------------- ---------------- --------------------- ------",
    ...rows.filter((x) => x.head).map((x) => x.line),
    "",
    "LSP midpoint FRR information:",
    "LSP Identifier             Out intf/label   FRR intf/label        Status",
    "-------------------------- ---------------- --------------------- ------",
    ...rows.filter((x) => !x.head).map((x) => x.line),
    ...(unprot.length ? ["", `(${unprot.length} LSP${unprot.length > 1 ? "s" : ""} through ${r} without protection here: ${unprot.map((l) => sigName(l)).join(", ")})`] : []),
  ].join("\n");
}
function xrBfd(s: FrState, r: FrR): string {
  const rows = ifsOf(r).filter((x) => s.cfg[r].ifs[x.ifn].bfd).map((x) => {
    const both = s.cfg[x.peer].ifs[ifOn(x.peer, r)].bfd && linkAlive(s.cfg, s.fail, x.link);
    return [`${pad(xrIf(x.ifn, true), 20)}${pad(ipOn(x.peer, r), 16)}${pad("0s(0s*0)", 17)}${pad("45ms(15ms*3)", 17)}${both ? "UP" : "DOWN"}`, `${" ".repeat(53)}No    n/a`];
  });
  return ["Interface           Dest Addr           Local det time(int*mult)      State", "                                    Echo             Async   H/W   NPU", "------------------- --------------- ---------------- ---------------- ----------", ...rows.flat()].join("\n");
}
function xrRsvp(s: FrState, r: FrR): string {
  const ls = lspsAt(s, r);
  const bs = s.view.bypasses.filter((b) => b.up && b.path!.includes(r));
  return ["Type Destination Add DPort  Proto/ExtTunID  PSBs  RSBs  Reqs", "---- --------------- ----- --------------- ----- ----- -----", ...ls.map((l) => `LSP4 ${lpad(FR_LO[l.tail!], 15)} ${lpad(l.id, 5)} ${lpad(FR_LO[l.head], 15)} ${lpad(1, 5)} ${lpad(1, 5)} ${lpad(l.head === r ? 0 : 1, 5)}`), ...bs.map((b) => `LSP4 ${lpad(FR_LO[b.tail], 15)} ${lpad(b.manual ?? autoId(s.view, b), 5)} ${lpad(FR_LO[b.plr], 15)} ${lpad(1, 5)} ${lpad(1, 5)} ${lpad(b.plr === r ? 0 : 1, 5)}`)].join("\n");
}
function xrRoute(s: FrState, r: FrR, raw: string): string {
  const d = destRouter(raw);
  if (!d) return "% Network not in table";
  if (d.r === r) return [`Routing entry for ${d.prefix}`, `  Known via "connected", distance 0, metric 0 (connected)`, "  Routing Descriptor Blocks", "    directly connected", "  No advertising protos."].join("\n");
  const rt = frRoute(s.cfg, s.fail, s.view, r, d.r);
  if (!rt) return "% Network not in table";
  const igp = igpPath(s.cfg, s.fail, r, d.r);
  const metric = (igp ? pathCost(igp) : 0) + 10;
  const via = rt.via === "tunnel" ? `${FR_LO[d.r]}, from ${FR_LO[d.r]}, via tunnel-te${rt.lsp!.id}` : `${ipOn(rt.path[1], r)}, from ${FR_LO[d.r]}, via ${xrIf(ifOn(r, rt.path[1]))}`;
  return [`Routing entry for ${d.prefix}`, `  Known via "isis CORE", distance 115, metric ${metric}, type level-2`, `  Installed ${spStamp(40).xr.replace(" UTC", "")} for ${spAge(s.clock, 40)}`, "  Routing Descriptor Blocks", `    ${via}`, `      Route metric is ${metric}`, "  No advertising protos."].join("\n");
}
function xrPing(s: FrState, r: FrR, id: string, trace: boolean): string {
  const l = s.view.lsps.find((x) => x.head === r && String(x.id) === id);
  if (!l) return `% tunnel-te${id} does not exist`;
  if (l.state !== "up") return trace ? `Tracing MPLS TE Label Switched Path on tunnel-te${id}, timeout is 2 seconds\n\n% tunnel-te${id} is down` : `Sending 5, 100-byte MPLS Echos to tunnel-te${id},\n      timeout is 2 seconds, send interval is 0 msec:\n\nQQQQQ\nSuccess rate is 0 percent (0/5)`;
  const p = l.path!;
  if (!trace) return `Sending 5, 100-byte MPLS Echos to tunnel-te${id},\n      timeout is 2 seconds, send interval is 0 msec:\n\nCodes: '!' - success, 'Q' - request not sent, '.' - timeout,\n  'L' - labeled output interface, 'B' - unlabeled output interface,\n\nType escape sequence to abort.\n\n!!!!!\nSuccess rate is 100 percent (5/5), round-trip min/avg/max = 2/3/5 ms`;
  return [`Tracing MPLS TE Label Switched Path on tunnel-te${id}, timeout is 2 seconds`, "", "Type escape sequence to abort.", "", `  0 ${ipOn(r, p[1])} MRU 1500 [Labels: ${lab(l.labels[p[1]])} Exp: 0]`, ...p.slice(1).map((x, i) => {
    const last = i === p.length - 2;
    return `${last ? "!" : "L"} ${i + 1} ${ipOn(x, p[i])}${last ? ` ${i + 2} ms` : ` MRU 1500 [Labels: ${lab(l.labels[p[i + 2]])} Exp: 0] ${i + 2} ms`}`;
  })].join("\n");
}
function xrLogging(s: FrState, r: FrR): string {
  const lines = s.sys.filter((x) => x.dev === r).slice(-30).map((x) => {
    const st = `RP/0/RP0/CPU0:${spStamp(x.t).xr}`;
    const t = s.cfg[r].tunnels.find((y) => y.name === x.what);
    const ifn = t ? `tunnel-te${t.id}` : x.what;
    if (x.kind === "up") return `${st}: ifmgr[215]: %PKT_INFRA-LINEPROTO-5-UPDOWN : Line protocol on Interface ${ifn}, changed state to Up`;
    if (x.kind === "down") return `${st}: ifmgr[215]: %PKT_INFRA-LINEPROTO-5-UPDOWN : Line protocol on Interface ${ifn}, changed state to Down`;
    if (x.kind === "frr") return `${st}: te_control[1197]: %ROUTING-MPLS_TE-5-FRR : LSP ${x.what} switched to backup ${x.why}`;
    return `${st}: config[65857]: %MGBL-CONFIG-6-DB_COMMIT : Configuration committed by user 'admin'. Use 'show commit changes ${1000000000 + x.t}' to view the changes.`;
  });
  return ["Syslog logging: enabled (0 messages dropped, 0 flushes, 0 overruns)", `    Buffer logging: level debugging, ${lines.length} messages logged`, "", "Log Buffer (2097152 bytes):", "", ...lines].join("\n");
}

// ---------------------------------------------------------------------------------------------------------------
// Junos outputs
// ---------------------------------------------------------------------------------------------------------------
function jnLsp(s: FrState, r: FrR, which: "all" | "ingress" | "egress" | "transit" | "bypass", ext: boolean): string {
  const heads = s.view.lsps.filter((l) => l.head === r);
  const byp = s.view.bypasses.filter((b) => b.plr === r);
  const eg = lspsAt(s, r).filter((l) => l.tail === r);
  const tr = lspsAt(s, r).filter((l) => l.head !== r && l.tail !== r);
  const out: string[] = [];
  const hdrI = "To              From            State Rt P     ActivePath       LSPname";
  const hdrS = "To              From            State   Rt Style Labelin Labelout LSPname";
  if (which === "bypass") {
    out.push(`Ingress LSP: ${byp.length} sessions`, ...(byp.length ? [hdrS] : []), ...byp.map((b) => `${pad(FR_LO[b.tail], 16)}${pad(FR_LO[r], 16)}${pad(b.up ? "Up" : "Dn", 8)}${lpad(0, 2)}  1 SE ${lpad("-", 7)} ${lpad(b.up ? lab(b.labels[b.path![1]]).replace("implicit-null", "3") : "-", 8)} ${byName("junos", b, s.view)}`), `Total ${byp.length} displayed, Up ${byp.filter((b) => b.up).length}, Down ${byp.filter((b) => !b.up).length}`);
    return out.join("\n");
  }
  if (which === "all" || which === "ingress") {
    out.push(`Ingress LSP: ${heads.length} sessions`);
    if (!ext) out.push(...(heads.length ? [hdrI] : []), ...heads.map((l) => `${pad(s.cfg[r].tunnels.find((t) => t.id === l.id)!.dst, 16)}${pad(FR_LO[r], 16)}${pad(l.state === "up" ? "Up" : "Dn", 6)}${lpad(0, 2)} ${l.state === "up" ? "*" : " "}     ${pad(l.state === "up" ? "(primary)" : "", 17)}${l.name}`));
    else
      for (const l of heads) {
        const t = s.cfg[r].tunnels.find((x) => x.id === l.id)!;
        out.push("", t.dst, `  From: ${FR_LO[r]}, State: ${l.state === "up" ? "Up" : "Dn"}, ActiveRoute: 0, LSPname: ${l.name}`, `  ActivePath: ${l.state === "up" ? "(primary)" : "(none)"}`, `  ${t.frr === "node" ? "Node/Link protection desired" : t.frr === "link" ? "Link protection desired" : "No protection requested"}`, "  LSPtype: Static Configured, Penultimate hop popping", ` ${l.state === "up" ? "*" : " "}Primary   ${pad(t.path ?? "", 16)} State: ${l.state === "up" ? "Up" : "Dn"}`, `    Bandwidth: ${t.bw / 1000}Mbps`);
        if (l.state === "up") {
          const p = l.path!;
          out.push(`    Computed ERO (S [L] denotes strict [loose] hops): (CSPF metric: ${pathCost(p)})`, ` ${p.slice(1).map((x, i) => `${ipOn(x, p[i])} S`).join(" ")}`, "    Received RRO (ProtectionFlag 1=Available 2=InUse 4=B/W 8=Node 10=SoftPreempt 20=Node-ID):", `          ${p.slice(1).map((x, i) => {
            const b = bypassOf(s, l, x);
            return `${ipOn(x, p[i])}${b ? `(flag=${b.type === "nnhop" ? "0x09" : "0x01"})` : ""}`;
          }).join(" ")}`);
        } else out.push(`    CSPF failed: no route toward ${t.dst}`);
      }
    out.push(`Total ${heads.length} displayed, Up ${heads.filter((l) => l.state === "up").length}, Down ${heads.filter((l) => l.state !== "up").length}`, "");
  }
  if (which === "all" || which === "egress") out.push(`Egress LSP: ${eg.length} sessions`, ...(eg.length ? [hdrS] : []), ...eg.map((l) => `${pad(FR_LO[r], 16)}${pad(FR_LO[l.head], 16)}Up      ${lpad(0, 2)}  1 SE ${lpad(3, 7)} ${lpad("-", 8)} ${l.name}`), `Total ${eg.length} displayed, Up ${eg.length}, Down 0`, "");
  if (which === "all" || which === "transit")
    out.push(`Transit LSP: ${tr.length} sessions`, ...(tr.length ? [hdrS] : []), ...tr.map((l) => {
      const i = l.path!.indexOf(r);
      return `${pad(FR_LO[l.tail!], 16)}${pad(FR_LO[l.head], 16)}Up      ${lpad(0, 2)}  1 SE ${lpad(l.labels[r]!, 7)} ${lpad(l.labels[l.path![i + 1]]!, 8)} ${l.name}`;
    }), `Total ${tr.length} displayed, Up ${tr.length}, Down 0`);
  return out.join("\n").trimEnd();
}
function jnRsvpDetail(s: FrState, r: FrR): string {
  const ls = lspsAt(s, r).filter((l) => l.tail !== r);
  if (!ls.length) return "";
  return ls.flatMap((l) => {
    const i = l.path!.indexOf(r);
    const n = l.path![i + 1];
    const b = bypassOf(s, l, r);
    const t = s.cfg[l.head].tunnels.find((x) => x.id === l.id)!;
    return [
      `${FR_LO[l.tail!]}`,
      `  From: ${FR_LO[l.head]}, LSPstate: Up, ActiveRoute: 0`,
      `  LSPname: ${l.name}, LSPpath: Primary`,
      `  Resv style: 1 SE, Label in: ${l.head === r ? "-" : l.labels[r]}, Label out: ${l.labels[n]}`,
      `  Explct route: ${l.path!.slice(i + 1).map((x, k) => ipOn(x, l.path![i + k])).join(" ")}`,
      `  ${t.frr === "node" ? "Node/Link protection desired" : t.frr === "link" ? "Link protection desired" : "Protection not requested"}`,
      ...(t.frr === "off" ? [] : b ? [`  Type: ${b.type === "nnhop" ? "Node/Link" : "Link"} protected LSP`, `  Bypass: ${byName("junos", b, s.view)}, Label out: ${lab(b.labels[b.path![1]]).replace("implicit-null", "3")}, Merge point label: ${lab(mpLabel(l, b)).replace("implicit-null", "3")}`] : ["  Type: Unprotected LSP (no bypass available)"]),
      "",
    ];
  }).join("\n").trimEnd();
}
function jnRsvp(s: FrState, r: FrR): string {
  const ls = lspsAt(s, r);
  const ing = ls.filter((l) => l.head === r);
  const eg = ls.filter((l) => l.tail === r);
  const tr = ls.filter((l) => l.head !== r && l.tail !== r);
  const hdr = "To              From            State   Rt Style Labelin Labelout LSPname";
  const row = (l: FrLsp, i: string, o: string) => `${pad(FR_LO[l.tail!], 16)}${pad(FR_LO[l.head], 16)}Up      ${lpad(0, 2)}  1 SE ${lpad(i, 7)} ${lpad(o, 8)} ${l.name}`;
  const sect = (title: string, xs: FrLsp[], f: (l: FrLsp) => string) => [`${title} RSVP: ${xs.length} sessions`, ...(xs.length ? [hdr, ...xs.map(f)] : []), `Total ${xs.length} displayed, Up ${xs.length}, Down 0`, ""];
  return [...sect("Ingress", ing, (l) => row(l, "-", String(l.labels[l.path![1]]))), ...sect("Egress", eg, (l) => row(l, "3", "-")), ...sect("Transit", tr, (l) => row(l, String(l.labels[r]), String(l.labels[l.path![l.path!.indexOf(r) + 1]])))].join("\n").trimEnd();
}
function jnBfd(s: FrState, r: FrR): string {
  const rows = ifsOf(r).filter((x) => s.cfg[r].ifs[x.ifn].bfd).map((x) => {
    const both = s.cfg[x.peer].ifs[ifOn(x.peer, r)].bfd && linkAlive(s.cfg, s.fail, x.link);
    return `${pad(ipOn(x.peer, r), 25)}${pad(both ? "Up" : "Down", 8)}${pad(jnIf(x.ifn), 20)}${pad("0.045", 9)}${pad("0.015", 12)}3`;
  });
  return ["                                                  Detect   Transmit", "Address                  State     Interface      Time     Interval  Multiplier", ...rows, "", `${rows.length} sessions, ${rows.length} clients`].join("\n");
}
function jnRoute(s: FrState, r: FrR, raw: string): string {
  const d = destRouter(raw);
  if (!d) return "";
  const head = ["", "inet.0: 15 destinations, 15 routes (15 active, 0 holddown, 0 hidden)", "+ = Active Route, - = Last Active, * = Both", ""];
  if (d.r === r) return [...head, `${pad(d.prefix, 19)}*[Direct/0] ${spAge(s.clock, 30)}`, "                    >  via ge-0/0/2.0"].join("\n");
  const rt = frRoute(s.cfg, s.fail, s.view, r, d.r);
  if (!rt) return "";
  const igp = igpPath(s.cfg, s.fail, r, d.r);
  return [...head, `${pad(d.prefix, 19)}*[IS-IS/18] ${spAge(s.clock, 40)}, metric ${(igp ? pathCost(igp) : 0) + 10}`, `                    >  to ${ipOn(rt.path[1], r)} via ${jnIf(ifOn(r, rt.path[1]))}${rt.via === "tunnel" ? `, label-switched-path ${rt.lsp!.name}` : ""}`].join("\n");
}
function jnPing(s: FrState, r: FrR, name: string, trace: boolean): string {
  const l = s.view.lsps.find((x) => x.head === r && x.name === name);
  if (!l) return `error: no LSP named ${name}`;
  if (l.state !== "up") return trace ? `error: LSP ${name} is down` : ".....\n--- lsping statistics ---\n5 packets transmitted, 0 packets received, 100% packet loss";
  const p = l.path!;
  if (!trace) return "!!!!!\n--- lsping statistics ---\n5 packets transmitted, 5 packets received, 0% packet loss";
  return ["  Probe options: ttl 64, retries 3, exp 7", "", "  ttl    Label  Protocol    Address(next-hop)       Interface(next-hop)   Status", ...p.slice(1).map((x, i) => `  ${pad(i + 1, 4)} ${lpad(l.labels[x]!, 7)}  ${pad("RSVP-TE", 11)} ${pad(ipOn(x, p[i]), 23)} ${pad(jnIf(ifOn(p[i], x)), 22)}${i === p.length - 2 ? "Egress" : "Success"}`)].join("\n");
}
function jnLog(s: FrState, r: FrR): string {
  return s.sys.filter((x) => x.dev === r).slice(-30).map((x) => {
    const st = `${spStamp(x.t).junos}  ${r}`;
    if (x.kind === "up") return `${st} rpd[1532]: RPD_MPLS_LSP_UP: LSP ${x.what} up on primary()`;
    if (x.kind === "down") return `${st} rpd[1532]: RPD_MPLS_LSP_DOWN: LSP ${x.what} down on primary()`;
    if (x.kind === "frr") return `${st} rpd[1532]: RPD_RSVP_BYPASS_UP: Bypass ${x.why} in use for LSP ${x.what}`;
    return `${st} mgd[4417]: UI_COMMIT: User 'admin' requested 'commit' operation (comment: none)`;
  }).join("\n");
}

// ---------------------------------------------------------------------------------------------------------------
// Configuration as each OS prints it
// ---------------------------------------------------------------------------------------------------------------
const sortHops = (h: FrHop[]) => [...h].sort((a, b) => a.idx - b.idx);
export function frXrLines(r: FrR, c: FrCfg): string[] {
  const out: string[] = [`hostname ${r}`, "!", "interface Loopback0", ` ipv4 address ${FR_LO[r]} 255.255.255.255`, "!"];
  for (const t of [...c.tunnels].sort((a, b) => a.id - b.id)) {
    out.push(`interface tunnel-te${t.id}`, " ipv4 unnumbered Loopback0", ...(t.autoroute ? [" autoroute announce", " !"] : []), ...(t.dst ? [` destination ${t.dst}`] : []), ...(t.frr !== "off" ? [" fast-reroute", ...(t.frr === "node" ? [" fast-reroute protect node"] : [])] : []), ...(t.bw ? [` signalled-bandwidth ${t.bw}`] : []), ` path-option 10 ${t.path ? `explicit name ${t.path}` : "dynamic"}`, ...(t.shut ? [" shutdown"] : []), "!");
  }
  for (const x of ifsOf(r)) out.push(`interface ${xrIf(x.ifn)}`, ` description to ${x.peer}`, ` ipv4 address ${x.ip} 255.255.255.254`, ...(c.ifs[x.ifn].shut ? [" shutdown"] : []), "!");
  for (const [n, hops] of Object.entries(c.paths)) out.push(`explicit-path name ${n}`, ...sortHops(hops).map((h) => (h.kind === "exclude" ? ` index ${h.idx} exclude-address ipv4 unicast ${h.ip}` : ` index ${h.idx} next-address ${h.kind} ipv4 unicast ${h.ip}`)), "!");
  out.push("router isis CORE", " is-type level-2-only", ` net 49.0001.0000.0000.000${FR_ROUTERS.indexOf(r) + 1}.00`, " address-family ipv4 unicast", "  metric-style wide", "  mpls traffic-eng level-2-only", "  mpls traffic-eng router-id Loopback0", " !", "!");
  const rs = ifsOf(r).filter((x) => c.ifs[x.ifn].rsvp !== undefined);
  if (rs.length) out.push("rsvp", ...rs.flatMap((x) => [` interface ${xrIf(x.ifn)}`, ...(c.ifs[x.ifn].bfd ? ["  bfd fast-detect", "  bfd minimum-interval 15", "  bfd multiplier 3"] : []), ...(c.ifs[x.ifn].rsvp ? [`  bandwidth ${c.ifs[x.ifn].rsvp}`] : []), " !"]), "!");
  out.push("mpls traffic-eng");
  for (const x of ifsOf(r).filter((y) => c.ifs[y.ifn].te)) {
    const ic = c.ifs[x.ifn];
    const manual = c.tunnels.filter((t) => t.bypassFor === x.ifn);
    out.push(` interface ${xrIf(x.ifn)}`, ...(ic.auto ? ["  auto-tunnel backup", ...(ic.nhopOnly ? ["   nhop-only"] : []), "  !"] : []), ...manual.map((t) => `  backup-path tunnel-te ${t.id}`), " !");
  }
  out.push(" auto-tunnel backup", "  tunnel-id min 1000 max 1999", " !", "!");
  return out;
}
export function frJnStmts(r: FrR, c: FrCfg): JStmt[] {
  const out: JStmt[] = [];
  for (const x of ifsOf(r)) {
    if (c.ifs[x.ifn].shut) out.push({ path: ["interfaces", x.ifn], leaf: "disable" });
    out.push({ path: ["interfaces", x.ifn, "unit 0", "family inet"], leaf: `address ${x.ip}/31` }, { path: ["interfaces", x.ifn, "unit 0", "family mpls"], leaf: "" });
  }
  out.push({ path: ["routing-options"], leaf: `router-id ${FR_LO[r]}` });
  for (const x of ifsOf(r).filter((y) => c.ifs[y.ifn].rsvp !== undefined)) {
    const ic = c.ifs[x.ifn];
    const p = ["protocols", "rsvp", `interface ${jnIf(x.ifn)}`];
    if (ic.rsvp) out.push({ path: p, leaf: `bandwidth ${fmtJbw(ic.rsvp)}` });
    if (ic.bfd) out.push({ path: [...p, "bfd-liveness-detection"], leaf: "minimum-interval 15" });
    const manual = c.tunnels.filter((t) => t.bypassFor === x.ifn);
    if (ic.auto && !manual.length) out.push(ic.nhopOnly ? { path: [...p, "link-protection"], leaf: "no-node-protection" } : { path: p, leaf: "link-protection" });
    for (const t of manual) {
      const bp = [...p, "link-protection", `bypass ${t.name}`];
      out.push({ path: bp, leaf: `to ${t.dst}` });
      for (const h of sortHops(c.paths[t.path ?? ""] ?? []).filter((y) => y.kind !== "exclude")) out.push({ path: bp, leaf: `path ${h.ip} ${h.kind}` });
    }
    if (ic.auto && ic.nhopOnly && manual.length) out.push({ path: [...p, "link-protection"], leaf: "no-node-protection" });
  }
  for (const t of [...c.tunnels].filter((y) => !y.bypassFor).sort((a, b) => a.id - b.id)) {
    const p = ["protocols", "mpls", `label-switched-path ${t.name}`];
    if (t.dst) out.push({ path: p, leaf: `to ${t.dst}` });
    if (t.bw) out.push({ path: p, leaf: `bandwidth ${fmtJbw(t.bw)}` });
    if (t.path) out.push({ path: p, leaf: `primary ${t.path}` });
    if (t.frr !== "off") out.push({ path: p, leaf: t.frr === "node" ? "node-link-protection" : "link-protection" });
    if (t.shut) out.push({ path: p, leaf: "disable" });
  }
  for (const [n, hops] of Object.entries(c.paths)) {
    if (c.tunnels.some((t) => t.bypassFor && t.path === n)) continue;
    if (!hops.length) out.push({ path: ["protocols", "mpls", `path ${n}`], leaf: "" });
    for (const h of sortHops(hops).filter((y) => y.kind !== "exclude")) out.push({ path: ["protocols", "mpls", `path ${n}`], leaf: `${h.ip} ${h.kind}` });
  }
  for (const x of ifsOf(r).filter((y) => c.ifs[y.ifn].te)) out.push({ path: ["protocols", "mpls", `interface ${jnIf(x.ifn)}`], leaf: "" });
  if (c.tunnels.some((t) => t.autoroute && !t.bypassFor)) out.push({ path: ["protocols", "isis", "traffic-engineering"], leaf: "shortcuts" });
  out.push({ path: ["protocols", "isis", "level 2"], leaf: "wide-metrics-only" });
  for (const x of ifsOf(r)) out.push({ path: ["protocols", "isis", `interface ${jnIf(x.ifn)}`], leaf: `level 2 metric ${x.link.metric}` });
  out.push({ path: ["protocols", "isis", "interface lo0.0"], leaf: "passive" });
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Configuration statements
// ---------------------------------------------------------------------------------------------------------------
const tun = (c: FrCfg, id: string) => c.tunnels.find((t) => String(t.id) === id);
const newTunnel = (id: number, name: string): FrTunnel => ({ id, name, dst: "", bw: 0, frr: "off", autoroute: false, shut: false });
const byNameT = (c: FrCfg, n: string) => c.tunnels.find((t) => t.name === n);
const ensureLsp = (c: FrCfg, n: string) => {
  let t = byNameT(c, n);
  if (!t) {
    t = newTunnel(Math.max(0, ...c.tunnels.map((x) => x.id)) + 1, n);
    c.tunnels.push(t);
  }
  return t;
};
const ensureBypass = (c: FrCfg, ifn: IfName, n: string) => {
  let t = byNameT(c, n);
  if (!t) {
    t = { ...newTunnel(Math.max(99, ...c.tunnels.map((x) => x.id)) + 1, n), bypassFor: ifn, path: n };
    c.tunnels.push(t);
    c.paths[n] ??= [];
  }
  return t;
};
function stmts(r: FrR, s: FrState): SpCfgStmt<FrCfg>[] {
  const pathArg = nameArg(Object.keys(s.cfg[r].paths).length ? Object.keys(s.cfg[r].paths) : ["AVOID-R5"], "Path name");
  const lspArg = nameArg(s.cfg[r].tunnels.filter((t) => !t.bypassFor).map((t) => t.name).concat(s.cfg[r].tunnels.length ? [] : ["TO-R6"]), "LSP name");
  const bypArg = nameArg(s.cfg[r].tunnels.filter((t) => t.bypassFor).map((t) => t.name).concat(["BYPASS-R7"]), "Bypass name");
  const pifX = pifArg(r, false);
  const pifJ = pifArg(r, true);
  const idxArg = numArg(1, 65535, ["1", "2"], "Index (order of the hops)");
  const hopIp = anyIp(Object.values(FR_LO), "Hop address");
  const setHop = (c: FrCfg, p: string, h: FrHop) => ((c.paths[p] = [...(c.paths[p] ?? []).filter((x) => x.idx !== h.idx), h]), c);
  return [
    // ---------------------------------------------------------------- IOS XR
    { id: "tif", summary: "Configure an MPLS-TE tunnel interface", args: { tid: tifArg }, xr: { mode: "config", syntax: "interface <tid>", enter: "tun", apply: (c, a) => (tun(c, a.tid) || c.tunnels.push(newTunnel(+a.tid, `tunnel-te${a.tid}`)), c), no: (c, a) => ((c.tunnels = c.tunnels.filter((t) => String(t.id) !== a.tid)), c) } },
    { id: "pif", summary: "Configure a physical interface", args: { pif: pifX }, xr: { mode: "config", syntax: "interface <pif>", enter: "if", apply: (c) => c } },
    { id: "unnum", summary: "Use the loopback's address on the tunnel", args: { lo: choiceArg(["Loopback0"], () => "Loopback interface") }, xr: { mode: "tun", syntax: "ipv4 unnumbered <lo>", apply: (c) => c } },
    { id: "dst", summary: "Tunnel destination (TE router ID)", args: { ip: loArg }, xr: { mode: "tun", syntax: "destination <ip>", noSyntax: "destination", apply: (c, a, x) => ((tun(c, x.tid)!.dst = a.ip), c), no: (c, _a, x) => ((tun(c, x.tid)!.dst = ""), c) } },
    { id: "sbw", summary: "Bandwidth the tunnel signals (kbps)", args: { kbps: kbpsArg }, xr: { mode: "tun", syntax: "signalled-bandwidth <kbps>", noSyntax: "signalled-bandwidth", apply: (c, a, x) => ((tun(c, x.tid)!.bw = +a.kbps), c), no: (c, _a, x) => ((tun(c, x.tid)!.bw = 0), c) } },
    { id: "ar", summary: "Announce the tunnel to IS-IS", xr: { mode: "tun", syntax: "autoroute announce", apply: (c, _a, x) => ((tun(c, x.tid)!.autoroute = true), c), no: (c, _a, x) => ((tun(c, x.tid)!.autoroute = false), c) } },
    { id: "po-dyn", summary: "Path option computed by CSPF", args: { n: numArg(1, 1000, ["10"], "Path-option preference") }, xr: { mode: "tun", syntax: "path-option <n> dynamic", apply: (c, _a, x) => ((tun(c, x.tid)!.path = undefined), c) } },
    { id: "po-exp", summary: "Path option following an explicit path", args: { n: numArg(1, 1000, ["10"], "Path-option preference"), p: pathArg }, xr: { mode: "tun", syntax: "path-option <n> explicit name <p>", apply: (c, a, x) => ((tun(c, x.tid)!.path = a.p), c) } },
    { id: "frr", summary: "Request fast reroute (link protection)", xr: { mode: "tun", syntax: "fast-reroute", apply: (c, _a, x) => (tun(c, x.tid)!.frr === "off" && (tun(c, x.tid)!.frr = "link"), c), no: (c, _a, x) => ((tun(c, x.tid)!.frr = "off"), c) } },
    { id: "frr-node", summary: "Request node protection", xr: { mode: "tun", syntax: "fast-reroute protect node", apply: (c, _a, x) => ((tun(c, x.tid)!.frr = "node"), c), no: (c, _a, x) => (tun(c, x.tid)!.frr === "node" && (tun(c, x.tid)!.frr = "link"), c) } },
    { id: "tshut", summary: "Shut the tunnel down", xr: { mode: "tun", syntax: "shutdown", apply: (c, _a, x) => ((tun(c, x.tid)!.shut = true), c), no: (c, _a, x) => ((tun(c, x.tid)!.shut = false), c) } },
    { id: "pshut", summary: "Shut the interface down", xr: { mode: "if", syntax: "shutdown", apply: (c, _a, x) => ((c.ifs[x.pif as IfName].shut = true), c), no: (c, _a, x) => ((c.ifs[x.pif as IfName].shut = false), c) } },
    { id: "ep", summary: "Define an explicit path", args: { p: pathArg }, xr: { mode: "config", syntax: "explicit-path name <p>", enter: "ep", apply: (c, a) => ((c.paths[a.p] ??= []), c), no: (c, a) => (delete c.paths[a.p], c) } },
    { id: "ep-strict", summary: "A hop that must be the next router", args: { i: idxArg, ip: hopIp }, xr: { mode: "ep", syntax: "index <i> next-address strict ipv4 unicast <ip>", noSyntax: "index <i>", apply: (c, a, x) => setHop(c, x.p, { idx: +a.i, ip: a.ip, kind: "strict" }), no: (c, a, x) => ((c.paths[x.p] = c.paths[x.p].filter((h) => h.idx !== +a.i)), c) } },
    { id: "ep-loose", summary: "A hop CSPF reaches any way it can", args: { i: idxArg, ip: hopIp }, xr: { mode: "ep", syntax: "index <i> next-address loose ipv4 unicast <ip>", apply: (c, a, x) => setHop(c, x.p, { idx: +a.i, ip: a.ip, kind: "loose" }) } },
    { id: "ep-excl", summary: "An address the path must avoid", args: { i: idxArg, ip: hopIp }, xr: { mode: "ep", syntax: "index <i> exclude-address ipv4 unicast <ip>", apply: (c, a, x) => setHop(c, x.p, { idx: +a.i, ip: a.ip, kind: "exclude" }) } },
    { id: "te", summary: "MPLS traffic engineering", xr: { mode: "config", syntax: "mpls traffic-eng", enter: "te", apply: (c) => c, no: () => "% This lab keeps MPLS-TE enabled; remove single interfaces instead." } },
    { id: "te-if", summary: "A TE interface", args: { pif: pifX }, xr: { mode: "te", syntax: "interface <pif>", enter: "te-if", apply: (c, a) => ((c.ifs[a.pif as IfName].te = true), c), no: (c, a) => ((c.ifs[a.pif as IfName].te = false), c) } },
    { id: "atb", summary: "Build bypasses automatically for LSPs leaving here", xr: { mode: "te-if", syntax: "auto-tunnel backup", apply: (c, _a, x) => ((c.ifs[x.pif as IfName].auto = true), c), no: (c, _a, x) => (Object.assign(c.ifs[x.pif as IfName], { auto: false, nhopOnly: false }), c) } },
    { id: "atb-nhop", summary: "Automatic bypasses: link protection (NHOP) only", xr: { mode: "te-if", syntax: "auto-tunnel backup nhop-only", apply: (c, _a, x) => (Object.assign(c.ifs[x.pif as IfName], { auto: true, nhopOnly: true }), c), no: (c, _a, x) => ((c.ifs[x.pif as IfName].nhopOnly = false), c) } },
    {
      id: "bkp",
      summary: "Use a configured tunnel as this interface's bypass",
      args: { n: numArg(1, 999, ["100"], "Bypass tunnel number") },
      xr: {
        mode: "te-if",
        syntax: "backup-path tunnel-te <n>",
        apply: (c, a, x) => {
          const t = tun(c, a.n);
          if (!t) return `!!% tunnel-te${a.n} is not configured`;
          t.bypassFor = x.pif as IfName;
          return c;
        },
        no: (c, a) => (tun(c, a.n) && (tun(c, a.n)!.bypassFor = undefined), c),
      },
    },
    { id: "rsvp", summary: "RSVP", xr: { mode: "config", syntax: "rsvp", enter: "rsvp", apply: (c) => c } },
    { id: "rsvp-if", summary: "Run RSVP on the interface", args: { pif: pifX }, xr: { mode: "rsvp", syntax: "interface <pif>", enter: "rsvp-if", apply: (c, a) => ((c.ifs[a.pif as IfName].rsvp ??= 0), c), no: (c, a) => ((c.ifs[a.pif as IfName].rsvp = undefined), c) } },
    { id: "rsvp-bw", summary: "Reservable bandwidth (kbps)", args: { kbps: kbpsArg }, xr: { mode: "rsvp-if", syntax: "bandwidth <kbps>", noSyntax: "bandwidth", apply: (c, a, x) => ((c.ifs[x.pif as IfName].rsvp = +a.kbps), c), no: (c, _a, x) => ((c.ifs[x.pif as IfName].rsvp = 0), c) } },
    { id: "bfd", summary: "BFD fast failure detection for RSVP on the interface", xr: { mode: "rsvp-if", syntax: "bfd fast-detect", apply: (c, _a, x) => ((c.ifs[x.pif as IfName].bfd = true), c), no: (c, _a, x) => ((c.ifs[x.pif as IfName].bfd = false), c) } },
    { id: "bfd-int", summary: "BFD interval (ms)", args: { ms: numArg(3, 30000, ["15"], "Interval in ms") }, xr: { mode: "rsvp-if", syntax: "bfd minimum-interval <ms>", apply: (c) => c } },
    { id: "bfd-mul", summary: "BFD multiplier", args: { m: numArg(2, 50, ["3"], "Multiplier") }, xr: { mode: "rsvp-if", syntax: "bfd multiplier <m>", apply: (c) => c } },

    // ---------------------------------------------------------------- Junos
    { id: "j-lsp", summary: "An LSP (delete removes it)", args: { lsp: lspArg }, junos: { syntax: "protocols mpls label-switched-path <lsp>", set: (c, a) => (ensureLsp(c, a.lsp), c), del: (c, a) => ((c.tunnels = c.tunnels.filter((t) => t.name !== a.lsp)), c) } },
    { id: "j-to", summary: "The LSP's egress", args: { lsp: lspArg, ip: loArg }, junos: { syntax: "protocols mpls label-switched-path <lsp> to <ip>", set: (c, a) => ((ensureLsp(c, a.lsp).dst = a.ip), c), del: (c, a) => (byNameT(c, a.lsp) && (byNameT(c, a.lsp)!.dst = ""), c) } },
    { id: "j-bw", summary: "Bandwidth to reserve", args: { lsp: lspArg, bw: jbwArg }, junos: { syntax: "protocols mpls label-switched-path <lsp> bandwidth <bw>", set: (c, a) => ((ensureLsp(c, a.lsp).bw = +a.bw), c), del: (c, a) => (byNameT(c, a.lsp) && (byNameT(c, a.lsp)!.bw = 0), c) } },
    { id: "j-pri", summary: "Primary path", args: { lsp: lspArg, p: pathArg }, junos: { syntax: "protocols mpls label-switched-path <lsp> primary <p>", set: (c, a) => ((ensureLsp(c, a.lsp).path = a.p), c), del: (c, a) => (byNameT(c, a.lsp) && (byNameT(c, a.lsp)!.path = undefined), c) } },
    { id: "j-lp", summary: "Request link protection", args: { lsp: lspArg }, junos: { syntax: "protocols mpls label-switched-path <lsp> link-protection", set: (c, a) => ((ensureLsp(c, a.lsp).frr = "link"), c), del: (c, a) => (byNameT(c, a.lsp)?.frr === "link" && (byNameT(c, a.lsp)!.frr = "off"), c) } },
    { id: "j-nlp", summary: "Request node and link protection", args: { lsp: lspArg }, junos: { syntax: "protocols mpls label-switched-path <lsp> node-link-protection", set: (c, a) => ((ensureLsp(c, a.lsp).frr = "node"), c), del: (c, a) => (byNameT(c, a.lsp)?.frr === "node" && (byNameT(c, a.lsp)!.frr = "off"), c) } },
    { id: "j-dis", summary: "Disable the LSP", args: { lsp: lspArg }, junos: { syntax: "protocols mpls label-switched-path <lsp> disable", set: (c, a) => ((ensureLsp(c, a.lsp).shut = true), c), del: (c, a) => (byNameT(c, a.lsp) && (byNameT(c, a.lsp)!.shut = false), c) } },
    { id: "j-path", summary: "A named path", args: { p: pathArg }, junos: { syntax: "protocols mpls path <p>", set: (c, a) => ((c.paths[a.p] ??= []), c), del: (c, a) => (delete c.paths[a.p], c) } },
    {
      id: "j-hop",
      summary: "A hop of the named path",
      args: { p: pathArg, ip: hopIp, m: choiceArg(["strict", "loose"], (m) => (m === "strict" ? "Must be the next router" : "Reached any way")) },
      junos: {
        syntax: "protocols mpls path <p> <ip> <m>",
        set: (c, a) => {
          const hops = (c.paths[a.p] ??= []);
          const ex = hops.find((h) => h.ip === a.ip);
          if (ex) ex.kind = a.m as FrHop["kind"];
          else hops.push({ idx: Math.max(0, ...hops.map((h) => h.idx)) + 1, ip: a.ip, kind: a.m as FrHop["kind"] });
          return c;
        },
        del: (c, a) => (c.paths[a.p] && (c.paths[a.p] = c.paths[a.p].filter((h) => h.ip !== a.ip)), c),
      },
    },
    { id: "j-mif", summary: "An MPLS / TE interface", args: { pif: pifJ }, junos: { syntax: "protocols mpls interface <pif>", set: (c, a) => ((c.ifs[a.pif as IfName].te = true), c), del: (c, a) => ((c.ifs[a.pif as IfName].te = false), c) } },
    { id: "j-rif", summary: "Run RSVP on the interface", args: { pif: pifJ }, junos: { syntax: "protocols rsvp interface <pif>", set: (c, a) => ((c.ifs[a.pif as IfName].rsvp ??= 1000000), c), del: (c, a) => ((c.ifs[a.pif as IfName].rsvp = undefined), c) } },
    { id: "j-rbw", summary: "Reservable bandwidth", args: { pif: pifJ, bw: jbwArg }, junos: { syntax: "protocols rsvp interface <pif> bandwidth <bw>", set: (c, a) => ((c.ifs[a.pif as IfName].rsvp = +a.bw), c), del: (c, a) => ((c.ifs[a.pif as IfName].rsvp = 1000000), c) } },
    { id: "j-lpif", summary: "Build bypasses for LSPs leaving through this interface", args: { pif: pifJ }, junos: { syntax: "protocols rsvp interface <pif> link-protection", set: (c, a) => ((c.ifs[a.pif as IfName].auto = true), c), del: (c, a) => (Object.assign(c.ifs[a.pif as IfName], { auto: false, nhopOnly: false }), (c.tunnels = c.tunnels.filter((t) => t.bypassFor !== a.pif)), c) } },
    { id: "j-nnp", summary: "Link protection only (no next-next-hop bypasses)", args: { pif: pifJ }, junos: { syntax: "protocols rsvp interface <pif> link-protection no-node-protection", set: (c, a) => (Object.assign(c.ifs[a.pif as IfName], { auto: true, nhopOnly: true }), c), del: (c, a) => ((c.ifs[a.pif as IfName].nhopOnly = false), c) } },
    { id: "j-byp-to", summary: "A manually configured bypass and its egress", args: { pif: pifJ, b: bypArg, ip: loArg }, junos: { syntax: "protocols rsvp interface <pif> link-protection bypass <b> to <ip>", set: (c, a) => ((ensureBypass(c, a.pif as IfName, a.b).dst = a.ip), c), del: (c, a) => ((c.tunnels = c.tunnels.filter((t) => t.name !== a.b)), c) } },
    {
      id: "j-byp-path",
      summary: "A hop of the manual bypass",
      args: { pif: pifJ, b: bypArg, ip: hopIp, m: choiceArg(["strict", "loose"], (m) => (m === "strict" ? "Must be the next router" : "Reached any way")) },
      junos: {
        syntax: "protocols rsvp interface <pif> link-protection bypass <b> path <ip> <m>",
        set: (c, a) => {
          const t = ensureBypass(c, a.pif as IfName, a.b);
          const hops = (c.paths[t.path!] ??= []);
          hops.push({ idx: Math.max(0, ...hops.map((h) => h.idx)) + 1, ip: a.ip, kind: a.m as FrHop["kind"] });
          return c;
        },
        del: (c, a) => {
          const t = byNameT(c, a.b);
          if (t?.path) c.paths[t.path] = (c.paths[t.path] ?? []).filter((h) => h.ip !== a.ip);
          return c;
        },
      },
    },
    { id: "j-bfd", summary: "BFD for RSVP on the interface", args: { pif: pifJ, ms: numArg(10, 30000, ["15"], "Interval in ms") }, junos: { syntax: "protocols rsvp interface <pif> bfd-liveness-detection minimum-interval <ms>", set: (c, a) => ((c.ifs[a.pif as IfName].bfd = true), c), del: (c, a) => ((c.ifs[a.pif as IfName].bfd = false), c) } },
    { id: "j-bfd-all", summary: "BFD for RSVP on the interface (delete removes it)", args: { pif: pifJ }, junos: { syntax: "protocols rsvp interface <pif> bfd-liveness-detection", del: (c, a) => ((c.ifs[a.pif as IfName].bfd = false), c) } },
    { id: "j-sc", summary: "IS-IS uses the LSPs from this router", junos: { syntax: "protocols isis traffic-engineering shortcuts", set: (c) => (c.tunnels.filter((t) => !t.bypassFor).forEach((t) => (t.autoroute = true)), c), del: (c) => (c.tunnels.forEach((t) => (t.autoroute = false)), c) } },
    { id: "j-ifdis", summary: "Disable the interface", args: { pif: pifJ }, junos: { syntax: "interfaces <pif> disable", set: (c, a) => ((c.ifs[a.pif as IfName].shut = true), c), del: (c, a) => ((c.ifs[a.pif as IfName].shut = false), c) } },
  ];
}

// ---------------------------------------------------------------------------------------------------------------
// Command sets
// ---------------------------------------------------------------------------------------------------------------
export function frValidate(c: FrCfg, junos: boolean): string | undefined {
  if (!junos) return undefined;
  for (const t of c.tunnels) {
    if (!t.dst) return `error: ${t.bypassFor ? "bypass" : "label-switched-path"} ${t.name}: 'to' must be configured\nerror: configuration check-out failed`;
    if (t.path && !t.bypassFor && !c.paths[t.path]) return `error: label-switched-path ${t.name}: path ${t.path} is not defined\nerror: configuration check-out failed`;
  }
  return undefined;
}
export function frXrSpec(api: FrCliApi, r: FrR): SpXrSpec<FrCfg> {
  const s = api.s;
  const sh = (id: string, syntax: string, summary: string, run: SpCmd["run"], args?: SpCmd["args"]): SpCmd => ({ id, syntax, summary, run, args });
  const nothing = (o: string, why: string) => o || { output: "", explanation: why };
  return {
    stmts: stmts(r, s).filter((x) => x.xr),
    prompts: { config: "config", tun: "config-if", if: "config-if", ep: "config-expl-path", te: "config-mpls-te", "te-if": "config-mpls-te-if", rsvp: "config-rsvp", "rsvp-if": "config-rsvp-if" },
    lines: (c) => frXrLines(r, c),
    help: { "show mpls": "MPLS information", "show mpls traffic-eng": "MPLS traffic engineering information", "show mpls traffic-eng fast-reroute": "Fast reroute information", "show rsvp": "RSVP information", "show bfd": "BFD information", "show route": "IP routing table", ping: "Send echo messages", traceroute: "Trace route to destination", "ping mpls": "MPLS echo (LSP ping)", "traceroute mpls": "MPLS traceroute", mpls: "MPLS exec commands", "mpls traffic-eng": "MPLS-TE exec commands" },
    shows: [
      sh("tun-b", "show mpls traffic-eng tunnels brief", "One line per tunnel: heads (and bypasses), midpoints, tails", () => xrBrief(s, r)),
      sh("tun-n", "show mpls traffic-eng tunnels <n>", "One tunnel in detail: protection desired, ERO, RRO protection flags", (a) => xrTunnel(s, r, a.n), { n: { ...tidArg(s, r), choices: [...s.cfg[r].tunnels.map((t) => String(t.id)), ...s.view.bypasses.filter((b) => b.plr === r && !b.manual).map((b) => String(autoId(s.view, b)))] } }),
      sh("tun-bk", "show mpls traffic-eng tunnels backup", "The bypass tunnels this router built and what they protect", () => nothing(xrBackup(s, r), "This router has no bypass tunnels.")),
      sh("frr-db", "show mpls traffic-eng fast-reroute database", "Which LSP is bound to which bypass on this router (the PLR's view)", () => xrFrrDb(s, r)),
      sh("bfd", "show bfd session", "BFD sessions", () => xrBfd(s, r)),
      sh("rsvp-s", "show rsvp session", "RSVP sessions through this router (LSPs and bypasses)", () => xrRsvp(s, r)),
      sh("route-ip", "show route <ip>", "The route a destination uses", (a) => xrRoute(s, r, a.ip), { ip: destArg }),
      sh("log", "show logging", "The syslog buffer", () => xrLogging(s, r)),
    ],
    exec: [
      sh("ping-te", "ping mpls traffic-eng tunnel-te <n>", "LSP ping through a tunnel", (a) => xrPing(s, r, a.n, false), { n: tidArg(s, r) }),
      sh("trace-te", "traceroute mpls traffic-eng tunnel-te <n>", "LSP traceroute through a tunnel", (a) => xrPing(s, r, a.n, true), { n: tidArg(s, r) }),
      sh("reopt", "mpls traffic-eng reoptimize", "Move every LSP headed here to its best path now", () => {
        api.act({ type: "reopt", dev: r });
        return { output: "", explanation: "Re-optimization requested: LSPs move to their best paths (make-before-break)." };
      }),
    ],
  };
}
export function frJunosSpec(api: FrCliApi, r: FrR): SpJunosSpec<FrCfg> {
  const s = api.s;
  const sh = (id: string, syntax: string, summary: string, run: SpCmd["run"], args?: SpCmd["args"]): SpCmd => ({ id, syntax, summary, run, args });
  const nothing = (o: string, why: string) => o || { output: "", explanation: why };
  const lspArg = nameArg(s.cfg[r].tunnels.filter((t) => !t.bypassFor).map((t) => t.name), "LSP name");
  return {
    stmts: stmts(r, s).filter((x) => x.junos),
    jstmts: (c) => frJnStmts(r, c),
    help: { "show mpls": "Show MPLS information", "show mpls lsp": "Show label-switched-path status", "show rsvp": "Show RSVP information", "show bfd": "Show BFD information", "show route": "Show routing table information", ping: "Ping remote target", traceroute: "Trace route to remote host", "ping mpls": "Ping label-switched path", "traceroute mpls": "Trace label-switched path", clear: "Clear information in the system", "clear mpls": "Clear MPLS information", "clear mpls lsp": "Clear LSP information" },
    shows: [
      sh("lsp", "show mpls lsp", "Ingress, egress and transit LSPs", () => jnLsp(s, r, "all", false)),
      sh("lsp-e", "show mpls lsp extensive", "LSPs with protection desired, ERO and RRO protection flags", () => jnLsp(s, r, "all", true)),
      ...(["ingress", "egress", "transit"] as const).map((k) => sh(`lsp-${k}`, `show mpls lsp ${k}`, `Only the ${k} LSPs`, () => jnLsp(s, r, k, false))),
      sh("lsp-ie", "show mpls lsp ingress extensive", "The LSPs headed here, in detail", () => jnLsp(s, r, "ingress", true)),
      sh("lsp-b", "show mpls lsp bypass", "The bypass LSPs this router built", () => jnLsp(s, r, "bypass", false)),
      sh("rsvp-s", "show rsvp session", "RSVP sessions through this router", () => jnRsvp(s, r)),
      sh("rsvp-d", "show rsvp session detail", "Per session: protection desired, the bypass and merge-point label", () => nothing(jnRsvpDetail(s, r), "No protected sessions leave this router.")),
      sh("bfd", "show bfd session", "BFD sessions", () => jnBfd(s, r)),
      sh("route", "show route <ip>", "The route a destination uses", (a) => nothing(jnRoute(s, r, a.ip), "No route."), { ip: destArg }),
      sh("log", "show log messages", "The system log", () => nothing(jnLog(s, r), "No messages since the lab started.")),
    ],
    op: [
      sh("ping-te", "ping mpls rsvp <lsp>", "LSP ping", (a) => jnPing(s, r, a.lsp, false), { lsp: lspArg }),
      sh("trace-te", "traceroute mpls rsvp <lsp>", "LSP traceroute", (a) => jnPing(s, r, a.lsp, true), { lsp: lspArg }),
      sh("reopt", "clear mpls lsp optimize", "Re-optimize the LSPs headed here now", () => {
        api.act({ type: "reopt", dev: r });
        return { output: "", explanation: "Re-optimization requested: LSPs move to their best paths (make-before-break)." };
      }),
    ],
  };
}
export function frSets(api: FrCliApi, r: FrR): Partial<Record<CliVendor, CliCommandSet>> {
  return {
    cisco: buildXrSet({ ...api.dev, validate: (c) => frValidate(c, false) }, frXrSpec(api, r)),
    juniper: buildJunosSet({ ...api.dev, validate: (c) => frValidate(c, true) }, frJunosSpec(api, r)),
  };
}
export const frPipe = (api: FrCliApi, r: FrR) => ({ config: junosPipeConfig(api.dev, { jstmts: (c: FrCfg) => frJnStmts(r, c) }), rollbacks: api.dev.hist.length });
export function frStaticApi(s: FrState, r: FrR): FrCliApi {
  return { s, act: () => s, dev: { host: r, running: s.cfg[r], hist: s.hist[r], setCand: () => undefined, xr: [], setXr: () => undefined, edit: false, setEdit: () => undefined, commit: () => undefined } };
}
export const frClone = spClone;
export { FR_LINKS, nhopOf, teUsable };
