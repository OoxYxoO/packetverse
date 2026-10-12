import type { CliArgSpec, CliCommandSet, CliVendor } from "@/lib/cli/types";
import { buildJunosSet, buildXrSet, choiceArg, junosPipeConfig, type SpCfgStmt, type SpCmd, type SpDevCli, type SpJunosSpec, type SpXrSpec } from "@/components/sp-lab/spCli";
import { lpad, pad, spAge, spClone, spStamp, type JStmt } from "@/components/sp-lab/spKit";
import {
  ALL_PFX,
  AS,
  CE_ADDR,
  CE_AS,
  CE_OF,
  RR_DEVS,
  RR_LO,
  RR_PES,
  advertise,
  bestPath,
  candidates,
  clusterOf,
  devByIp,
  established,
  igpCost,
  isRr,
  sessKey,
  type RrAction,
  type RrCfg,
  type RrDev,
  type RrNbr,
  type RrPath,
  type RrState,
} from "@/lib/sim-engine/scenarios/rrNet";

/**
 * Command lines of the Route Reflector Lab — IOS XR or Junos on RR1, RR2 and PE1–PE4. Every output is printed from the
 * lab model: sessions, Adj-RIBs-In, best paths, ORIGINATOR_ID and CLUSTER_LIST, what each router advertises.
 *
 *   IOS XR  show bgp summary · show bgp [<prefix>] · show bgp neighbors <ip> [advertised-routes | routes] · show
 *           route [bgp | <ip>] · show running-config [router bgp | prefix-set | route-policy] · show logging ·
 *           configure → router bgp 65000 (bgp cluster-id, neighbor <ip> → remote-as, update-source, address-family
 *           ipv4 unicast → route-reflector-client, next-hop-self, route-policy <name> out) · prefix-set <name> … end-set
 *   Junos   show bgp summary · show bgp neighbor <ip> · show route protocol bgp · show route <ip> [detail | hidden] ·
 *           show route receive-protocol bgp <ip> · show route advertising-protocol bgp <ip> · show log messages ·
 *           configure → set protocols bgp group <g> neighbor <ip> · group <g> cluster <id> · group <g> export <policy> ·
 *           policy-options policy-statement <name> term ALLOW from route-filter <prefix> exact → commit
 */

export interface RrCliApi {
  s: RrState;
  act: (a: RrAction) => RrState;
  dev: SpDevCli<RrCfg>;
}
const ipN = (ip: string) => ip.split(".").reduce((a, o) => a * 256 + Number(o), 0);
const uptime = (s: RrState, a: RrDev, ip: string) => spAge(s.clock, s.since[sessKey(a, ip)] ?? s.clock);
const groupOf = (c: RrCfg, r: RrDev, nb: RrNbr) => nb.group ?? (RR_PES.includes(r) ? "RR" : nb.client ? "CLIENTS" : "CORE");
const isCeAddr = (ip: string) => Object.values(CE_ADDR).some((x) => x.ce === ip || x.pe === ip);

// ---------------------------------------------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------------------------------------------
const ipRe = /^(\d{1,3}\.){3}\d{1,3}$/;
const anyIp = (choices: string[], what: string): CliArgSpec => ({ choices, describe: (c) => devByIp(c) ?? what, resolve: (raw) => (ipRe.test(raw) && raw.split(".").every((o) => +o <= 255) ? raw : undefined) });
const nbrArg = (s: RrState, r: RrDev): CliArgSpec => anyIp(s.cfg[r].nbrs.map((x) => x.ip), "Neighbor address");
const peerArg = (r: RrDev): CliArgSpec => anyIp(RR_DEVS.filter((d) => d !== r).map((d) => RR_LO[d]), "Neighbor address");
const pfxArg: CliArgSpec = { choices: ALL_PFX, describe: () => "Prefix", resolve: (raw) => (/^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/.test(raw) ? raw : undefined) };
const pfxEntryArg: CliArgSpec = { choices: ALL_PFX.map((p) => `${p},`), describe: () => "Prefix (end each but the last with a comma)", resolve: (raw) => (/^(\d{1,3}\.){3}\d{1,3}\/\d{1,2},?$/.test(raw) ? raw.replace(/,$/, "") : undefined) };
const hostArg: CliArgSpec = { choices: ALL_PFX.map((p) => p.replace("/24", "")), describe: () => "Destination", resolve: (raw) => (ipRe.test(raw) ? raw : /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/.test(raw) ? raw : undefined) };
const setNameArg = (s: RrState, r: RrDev): CliArgSpec => ({ choices: Object.keys(s.cfg[r].sets).length ? Object.keys(s.cfg[r].sets) : ["RR1-TO-RR2"], describe: () => "Set / policy name", resolve: (raw) => (/^[A-Za-z][\w-]{0,31}$/.test(raw) ? raw : undefined) });
const clusterArg: CliArgSpec = { choices: ["100.100.100.100", "200.200.200.200"], describe: () => "Cluster ID (dotted quad)", resolve: (raw) => (ipRe.test(raw) ? raw : undefined) };

// ---------------------------------------------------------------------------------------------------------------
// Shared views
// ---------------------------------------------------------------------------------------------------------------
const pfxMatch = (p: string, ip: string) => {
  const [net, len] = p.split("/");
  const L = +len;
  return Math.floor(ipN(ip) / 2 ** (32 - L)) === Math.floor(ipN(net) / 2 ** (32 - L));
};
const resolvePfx = (raw: string) => (raw.includes("/") ? raw : ALL_PFX.find((p) => pfxMatch(p, raw)));
const valid = (s: RrState, r: RrDev, p: RrPath) => p.from === "ebgp" || (!!devByIp(p.nh) && s.cfg[devByIp(p.nh)!].lo);
const metricTo = (r: RrDev, p: RrPath) => (p.from === "ebgp" ? 0 : devByIp(p.nh) ? igpCost(r, devByIp(p.nh)!) : 0);
function advertisedTo(s: RrState, r: RrDev, ip: string): RrPath[] {
  const to = devByIp(ip);
  if (!to || !s.cfg[r].on || !established(s.view.sessions, r, to)) return [];
  return advertise(s.cfg, s.view, r, to);
}

// ---------------------------------------------------------------------------------------------------------------
// IOS XR outputs
// ---------------------------------------------------------------------------------------------------------------
const XR_HEAD = (r: RrDev) => [`BGP router identifier ${RR_LO[r]}, local AS number ${AS}`, "BGP generic scan interval 60 secs", "Non-stop routing is enabled", "BGP table state: Active", "Table ID: 0xe0000000   RD version: 21", "BGP main routing table version 21", "BGP NSR Initial initsync version 2 (Reached)", "BGP NSR/ISSU Sync-Group versions 0/0", "BGP scan interval 60 secs", ""];
function xrSummary(s: RrState, r: RrDev): string {
  if (!s.cfg[r].on) return "% BGP instance 'default' not active";
  const rows = s.cfg[r].nbrs.map((nb) => {
    const x = s.view.sessions.find((y) => y.a === r && y.ip === nb.ip);
    const up = x?.state === "Established";
    const rcv = up ? Object.values(s.view.adjIn[r][nb.ip] ?? []).length : 0;
    return `${pad(nb.ip, 16)}${lpad(0, 3)}${lpad(nb.remoteAs || "0", 6)}${lpad(up ? 72 : 0, 8)}${lpad(up ? 75 : 1, 8)}${lpad(up ? 21 : 0, 9)}${lpad(0, 5)}${lpad(0, 5)} ${pad(up ? uptime(s, r, nb.ip) : "00:00:00", 9)}${up ? lpad(rcv, 10) : (x?.state ?? "Idle")}`;
  });
  return [...XR_HEAD(r), "BGP is operating in STANDALONE mode.", "", "", "Process       RcvTblVer   bRIB/RIB   LabelVer  ImportVer  SendTblVer  StandbyVer", "Speaker              21         21         21         21          21           0", "", "Neighbor        Spk    AS MsgRcvd MsgSent   TblVer  InQ OutQ  Up/Down  St/PfxRcd", ...rows].join("\n");
}
function xrTableRows(s: RrState, r: RrDev, paths: RrPath[]): string[] {
  const out: string[] = [];
  for (const prefix of ALL_PFX) {
    const ps = paths.filter((p) => p.prefix === prefix);
    if (!ps.length) continue;
    const bp = bestPath(s.cfg, s.view, r, prefix).best;
    ps.sort((a, b) => (a === bp ? -1 : b === bp ? 1 : 0)).forEach((p, k) => {
      const st = `${valid(s, r, p) ? "*" : " "}${p === bp ? ">" : " "}${p.from === "ebgp" ? " " : "i"}`;
      out.push(`${st}${pad(k === 0 ? prefix : "", 18)}${pad(p.nh, 20)}${lpad(0, 6)}${lpad(p.from === "ebgp" ? "" : 100, 7)}${lpad(0, 7)} ${p.asPath} i`);
    });
  }
  return out;
}
function xrTable(s: RrState, r: RrDev): string {
  if (!s.cfg[r].on) return "% BGP instance 'default' not active";
  const all = Object.values(s.view.adjIn[r]).flatMap((x) => x ?? []);
  return [...XR_HEAD(r), "Status codes: s suppressed, d damped, h history, * valid, > best", "              i - internal, r RIB-failure, S stale, N Nexthop-discard", "Origin codes: i - IGP, e - EGP, ? - incomplete", "   Network            Next Hop            Metric LocPrf Weight Path", ...xrTableRows(s, r, all), "", `Processed ${new Set(all.map((p) => p.prefix)).size} prefixes, ${all.length} paths`].join("\n");
}
function xrPrefix(s: RrState, r: RrDev, raw: string): string {
  const prefix = resolvePfx(raw);
  const ps = prefix ? candidates(s.cfg, s.view, r, prefix) : [];
  if (!prefix || !ps.length) return `% Network not in table`;
  const bp = bestPath(s.cfg, s.view, r, prefix).best;
  const out = [`BGP routing table entry for ${prefix}`, "Versions:", "  Process           bRIB/RIB  SendTblVer", "  Speaker                  21          21", `Last Modified: ${spStamp(30).xr} for ${spAge(s.clock, 30)}`, `Paths: (${ps.length} available, ${bp ? `best #${ps.indexOf(bp) + 1}` : "no best path"})`];
  const advTo = s.cfg[r].nbrs.filter((nb) => advertisedTo(s, r, nb.ip).some((p) => p.prefix === prefix)).map((nb) => nb.ip);
  if (advTo.length) out.push(`  Advertised to peers (in unique update groups):`, `    ${advTo.join("  ")}`);
  else out.push("  Not advertised to any peer");
  ps.forEach((p, i) => {
    const ok = valid(s, r, p);
    out.push(`  Path #${i + 1}: Received by speaker 0`, `  ${p.asPath}`, `    ${p.nh}${p.from === "ebgp" ? "" : ok ? ` (metric ${metricTo(r, p)})` : " (inaccessible)"} from ${p.fromIp} (${p.from === "ebgp" ? p.fromIp : p.originator ?? p.fromIp})`, `      Origin IGP, metric 0, localpref 100, ${ok ? "valid, " : ""}${p.from === "ebgp" ? "external" : "internal"}${p === bp ? ", best, group-best" : ""}`, `      Received Path ID 0, Local Path ID ${p === bp ? 1 : 0}, version 21`);
    if (p.originator) out.push(`      Originator: ${p.originator}, Cluster list: ${p.clusterList.join(", ")}`);
  });
  return out.join("\n");
}
function xrNeighbor(s: RrState, r: RrDev, ip: string): string {
  const nb = s.cfg[r].nbrs.find((x) => x.ip === ip);
  if (!nb) return `% No such neighbor`;
  const x = s.view.sessions.find((y) => y.a === r && y.ip === ip);
  const up = x?.state === "Established";
  const adv = advertisedTo(s, r, ip);
  return [
    `BGP neighbor is ${ip}`,
    ` Remote AS ${nb.remoteAs || "(not configured)"}, local AS ${AS}, internal link`,
    ` Remote router ID ${up ? ip : "0.0.0.0"}`,
    `  BGP state = ${x?.state ?? "Idle"}${up ? `, up for ${uptime(s, r, ip)}` : ""}`,
    ...(!up && x?.why ? [`  Last reset 00:00:30, due to ${x.why}`] : []),
    "  Update source: Loopback0",
    `  Hold time is 180, keepalive interval is 60 seconds`,
    " For Address Family: IPv4 Unicast",
    "  BGP neighbor version 21",
    `  Update group: 0.${nb.client ? 2 : 3} Filter-group: 0.1  No Refresh request being processed`,
    ...(nb.client ? ["  Route-Reflector Client"] : []),
    ...(nb.nhs ? ["  NEXT_HOP is always this router"] : []),
    ...(nb.policy ? [`  Policy for outgoing advertisements is ${nb.policy}`] : []),
    `  ${up ? Object.values(s.view.adjIn[r][ip] ?? []).length : 0} accepted prefixes, ${up ? Object.values(s.view.adjIn[r][ip] ?? []).length : 0} are bestpaths`,
    `  Prefix advertised ${adv.length}, suppressed 0, withdrawn 0`,
  ].join("\n");
}
function xrAdvertised(s: RrState, r: RrDev, ip: string): string {
  const adv = advertisedTo(s, r, ip);
  if (!adv.length) return "";
  return ["Network            Next Hop        From            AS Path", ...adv.map((p) => {
    const bp = bestPath(s.cfg, s.view, r, p.prefix).best;
    return `${pad(p.prefix, 19)}${pad(p.nh, 16)}${pad(bp?.fromIp ?? "Local", 16)}${p.asPath}i`;
  }), "", `Processed ${adv.length} prefixes, ${adv.length} paths`].join("\n");
}
function xrRoutes(s: RrState, r: RrDev, ip: string): string {
  const ps = s.view.adjIn[r][ip] ?? [];
  return ["Status codes: s suppressed, d damped, h history, * valid, > best", "              i - internal, r RIB-failure, S stale, N Nexthop-discard", "Origin codes: i - IGP, e - EGP, ? - incomplete", "   Network            Next Hop            Metric LocPrf Weight Path", ...xrTableRows(s, r, ps), "", `Processed ${ps.length} prefixes, ${ps.length} paths`].join("\n");
}
function xrRoute(s: RrState, r: RrDev, raw?: string): string {
  const pfxs = raw ? [resolvePfx(raw)].filter(Boolean) as string[] : ALL_PFX;
  const lines: string[] = [];
  for (const p of pfxs) {
    const bp = bestPath(s.cfg, s.view, r, p).best;
    if (!bp) continue;
    if (raw)
      return [`Routing entry for ${p}`, `  Known via "bgp ${AS}", distance ${bp.from === "ebgp" ? 20 : 200}, metric 0${bp.from === "ebgp" ? "" : ", type internal"}`, `  Installed ${spStamp(30).xr.replace(" UTC", "")} for ${spAge(s.clock, 30)}`, "  Routing Descriptor Blocks", `    ${bp.nh}, from ${bp.fromIp}${bp.from === "ebgp" ? `, via ${"GigabitEthernet0/0/0/2"}` : ""}`, "      Route metric is 0", "  No advertising protos."].join("\n");
    lines.push(`B    ${pad(p, 18)}[${bp.from === "ebgp" ? 20 : 200}/0] via ${bp.nh}, ${spAge(s.clock, 30)}`);
  }
  return raw ? "% Network not in table" : lines.join("\n");
}
function xrLogging(s: RrState, r: RrDev): string {
  const lines = s.sys.filter((x) => x.dev === r).slice(-30).map((x) => {
    const st = `RP/0/RP0/CPU0:${spStamp(x.t).xr}`;
    if (x.kind === "up") return `${st}: bgp[1052]: %ROUTING-BGP-5-ADJCHANGE : neighbor ${x.peer} Up (VRF: default) (AS: ${AS})`;
    if (x.kind === "down") return `${st}: bgp[1052]: %ROUTING-BGP-5-ADJCHANGE : neighbor ${x.peer} Down - ${x.why?.includes("removed") ? "Neighbor deleted" : "Peer closing down the session"} (VRF: default) (AS: ${AS})`;
    return `${st}: config[65857]: %MGBL-CONFIG-6-DB_COMMIT : Configuration committed by user 'admin'. Use 'show commit changes ${1000000000 + x.t}' to view the changes.`;
  });
  return ["Syslog logging: enabled (0 messages dropped, 0 flushes, 0 overruns)", `    Buffer logging: level debugging, ${lines.length} messages logged`, "", "Log Buffer (2097152 bytes):", "", ...lines].join("\n");
}

// ---------------------------------------------------------------------------------------------------------------
// Junos outputs
// ---------------------------------------------------------------------------------------------------------------
function jnSummary(s: RrState, r: RrDev): string {
  if (!s.cfg[r].on) return "BGP is not running";
  const all = Object.values(s.view.adjIn[r]).flatMap((x) => x ?? []);
  const act = ALL_PFX.filter((p) => bestPath(s.cfg, s.view, r, p).best).length;
  const groups = new Set(s.cfg[r].nbrs.map((nb) => groupOf(s.cfg[r], r, nb)));
  const down = s.view.sessions.filter((x) => x.a === r && x.state !== "Established").length;
  const rows = s.cfg[r].nbrs.flatMap((nb) => {
    const x = s.view.sessions.find((y) => y.a === r && y.ip === nb.ip);
    const up = x?.state === "Established";
    const rcv = up ? (s.view.adjIn[r][nb.ip] ?? []).length : 0;
    const actv = up ? ALL_PFX.filter((p) => bestPath(s.cfg, s.view, r, p).best?.fromIp === nb.ip).length : 0;
    return [`${pad(nb.ip, 21)}${lpad(nb.remoteAs || AS, 6)}${lpad(up ? 72 : 0, 11)}${lpad(up ? 75 : 0, 11)}${lpad(0, 8)}${lpad(0, 8)} ${lpad(up ? uptime(s, r, nb.ip).replace(/^00:/, "") : "1:00", 11)} ${up ? "Establ" : x?.state === "Idle" ? "Idle" : "Active"}`, ...(up ? [`  inet.0: ${actv}/${rcv}/${rcv}/0`] : [])];
  });
  return ["Threading mode: BGP I/O", `Groups: ${groups.size} Peers: ${s.cfg[r].nbrs.length} Down peers: ${down}`, "Table          Tot Paths  Act Paths Suppressed    History Damp State    Pending", "inet.0", `${lpad(all.length, 23)}${lpad(act, 11)}${lpad(0, 11)}${lpad(0, 11)}${lpad(0, 11)}${lpad(0, 11)}`, "Peer                     AS      InPkt     OutPkt    OutQ   Flaps Last Up/Dwn State|#Active/Received/Accepted/Damped...", ...rows].join("\n");
}
function jnNeighbor(s: RrState, r: RrDev, ip: string): string {
  const nb = s.cfg[r].nbrs.find((x) => x.ip === ip);
  if (!nb) return "";
  const x = s.view.sessions.find((y) => y.a === r && y.ip === ip);
  const up = x?.state === "Established";
  const exp = [...(nb.nhs ? ["NHS"] : []), ...(nb.policy ? [nb.policy] : [])];
  return [`Peer: ${ip}+179 AS ${nb.remoteAs || AS} Local: ${RR_LO[r]}+${50000 + RR_DEVS.indexOf(r)} AS ${AS}`, `  Group: ${groupOf(s.cfg[r], r, nb)}                Routing-Instance: master`, `  Type: Internal    State: ${up ? "Established" : x?.state === "Idle" ? "Idle" : "Active"}    Flags: <${up ? "Sync" : "ImportEval"}>`, ...(exp.length ? [`  Export: [ ${exp.join(" ")} ]`] : []), `  Options: <Preference LocalAddress${nb.client ? " Cluster" : ""} Refresh>`, `  Local Address: ${RR_LO[r]} Holdtime: 90 Preference: 170`, ...(nb.client ? [`  Cluster ID: ${clusterOf(s.cfg, r)}`] : []), ...(up ? [`  Peer ID: ${ip}    Local ID: ${RR_LO[r]}    Active Holdtime: 90`, `  Table inet.0 Bit: 20001`, `    Active prefixes:              ${ALL_PFX.filter((p) => bestPath(s.cfg, s.view, r, p).best?.fromIp === ip).length}`, `    Received prefixes:            ${(s.view.adjIn[r][ip] ?? []).length}`, `    Advertised prefixes:          ${advertisedTo(s, r, ip).length}`] : [`  Last State: ${x?.state === "Idle" ? "Idle" : "Connect"}     Last Event: ConnectRetry`, `  Last Error: ${x?.why ?? "None"}`])].join("\n");
}
function jnRouteLines(s: RrState, r: RrDev, prefix: string, detail: boolean): string[] {
  const ps = candidates(s.cfg, s.view, r, prefix).filter((p) => valid(s, r, p));
  const bp = bestPath(s.cfg, s.view, r, prefix).best;
  if (!ps.length || !bp) return [];
  const sorted = [bp, ...ps.filter((p) => p !== bp)];
  if (!detail) return sorted.flatMap((p, k) => [`${pad(k === 0 ? prefix : "", 19)}${p === bp ? "*" : " "}[BGP/170] ${spAge(s.clock, 30)}, localpref 100${p.from === "ebgp" ? "" : `, from ${p.fromIp}`}`, `                      AS path: ${p.asPath} I${p.originator ? ` (Originator)` : ""}, validation-state: unverified`, `                    >  to ${p.from === "ebgp" ? p.nh : "core"} via ${p.from === "ebgp" ? "ge-0/0/2.0" : "LSP to " + p.nh}`]);
  return [`${prefix} (${sorted.length} entr${sorted.length > 1 ? "ies" : "y"}, 1 announced)`, ...sorted.flatMap((p) => [`        ${p === bp ? "*" : " "}BGP    Preference: 170/-101`, `                Source: ${p.fromIp}`, ...(p.from === "ebgp" ? [`                Next hop: ${p.nh} via ge-0/0/2.0, selected`] : [`                Protocol next hop: ${p.nh}`]), `                State: <${p === bp ? "Active " : ""}${p.from === "ebgp" ? "Ext" : "Int Ext"}>`, `                Local AS: ${AS} Peer AS: ${p.from === "ebgp" ? p.asPath : AS}`, `                Age: ${spAge(s.clock, 30)}${p.from === "ebgp" ? "" : `   Metric2: ${metricTo(r, p)}`}`, `                AS path: ${p.asPath} I${p.originator ? " (Originator)" : ""}`, ...(p.clusterList.length ? [`                Cluster list:  ${p.clusterList.join(" ")}`] : []), ...(p.originator ? [`                Originator ID: ${p.originator}`] : []), "                Accepted", "                Localpref: 100", `                Router ID: ${p.from === "ebgp" ? p.fromIp : p.fromIp}`])];
}
function jnRoute(s: RrState, r: RrDev, raw: string | undefined, mode: "brief" | "detail" | "hidden" | "protocol"): string {
  const pfxs = raw ? [resolvePfx(raw)].filter(Boolean) as string[] : ALL_PFX;
  const act = ALL_PFX.filter((p) => bestPath(s.cfg, s.view, r, p).best).length;
  const hiddenN = ALL_PFX.filter((p) => candidates(s.cfg, s.view, r, p).some((x) => !valid(s, r, x))).length;
  const head = [`inet.0: ${act + 4} destinations, ${act + 4 + hiddenN} routes (${act + 4} active, 0 holddown, ${hiddenN} hidden)`, "+ = Active Route, - = Last Active, * = Both", ""];
  if (mode === "hidden") {
    const lines = pfxs.flatMap((p) => candidates(s.cfg, s.view, r, p).filter((x) => !valid(s, r, x)).flatMap((x) => [`${pad(p, 19)} [BGP/170] ${spAge(s.clock, 30)}, localpref 100, from ${x.fromIp}`, `                      AS path: ${x.asPath} I, validation-state: unverified`, "                       Unusable"]));
    return lines.length ? [...head, ...lines].join("\n") : "";
  }
  const lines = pfxs.flatMap((p) => jnRouteLines(s, r, p, mode === "detail"));
  return lines.length ? [...head, ...lines].join("\n") : "";
}
function jnReceive(s: RrState, r: RrDev, ip: string, adv: boolean): string {
  const ps = adv ? advertisedTo(s, r, ip) : (s.view.adjIn[r][ip] ?? []);
  if (!ps.length) return "";
  return [`inet.0: ${ALL_PFX.length + 4} destinations, ${ALL_PFX.length + 4} routes (${ALL_PFX.length + 4} active, 0 holddown, 0 hidden)`, "  Prefix                  Nexthop              MED     Lclpref    AS path", ...ps.map((p) => `${!adv && bestPath(s.cfg, s.view, r, p.prefix).best === p ? "*" : " "} ${pad(p.prefix, 24)}${pad(adv && p.nh === RR_LO[r] ? "Self" : p.nh, 29)}${pad(100, 11)}${p.asPath} I`)].join("\n");
}
function jnLog(s: RrState, r: RrDev): string {
  return s.sys.filter((x) => x.dev === r).slice(-30).map((x) => {
    const st = `${spStamp(x.t).junos}  ${r}`;
    if (x.kind === "up") return `${st} rpd[1532]: bgp_peer_mgmt_clear:: BGP_PEER_STATE_CHANGE: BGP peer ${x.peer} (Internal AS ${AS}) changed state from OpenConfirm to Established (event RecvKeepAlive)`;
    if (x.kind === "down") return `${st} rpd[1532]: BGP_PEER_STATE_CHANGE: BGP peer ${x.peer} (Internal AS ${AS}) changed state from Established to Idle (event ${x.why?.includes("removed") ? "Stop" : "RecvNotify"})`;
    return `${st} mgd[4417]: UI_COMMIT: User 'admin' requested 'commit' operation (comment: none)`;
  }).join("\n");
}

// ---------------------------------------------------------------------------------------------------------------
// Configuration as each OS prints it
// ---------------------------------------------------------------------------------------------------------------
export function rrXrLines(r: RrDev, c: RrCfg): string[] {
  const out: string[] = [`hostname ${r}`, "!", "interface Loopback0", ` ipv4 address ${RR_LO[r]} 255.255.255.255`, "!"];
  for (const [name, list] of Object.entries(c.sets)) out.push(`prefix-set ${name}`, ...list.map((p, i) => `  ${p}${i < list.length - 1 ? "," : ""}`), "end-set", "!");
  const ce = CE_OF[r];
  if (ce) out.push("route-policy PASS", "  pass", "end-policy", "!");
  for (const name of Object.keys(c.sets)) out.push(`route-policy ${name}`, `  if destination in ${name} then`, "    pass", "  endif", "end-policy", "!");
  if (!c.on) return out;
  out.push(`router bgp ${AS}`, ` bgp router-id ${RR_LO[r]}`, ...(c.cluster ? [` bgp cluster-id ${c.cluster}`] : []), " address-family ipv4 unicast", " !");
  for (const nb of [...c.nbrs].sort((a, b) => ipN(a.ip) - ipN(b.ip))) {
    out.push(` neighbor ${nb.ip}`, ...(nb.remoteAs ? [`  remote-as ${nb.remoteAs}`] : []), "  update-source Loopback0", "  address-family ipv4 unicast", ...(nb.client ? ["   route-reflector-client"] : []), ...(nb.policy ? [`   route-policy ${nb.policy} out`] : []), ...(nb.nhs ? ["   next-hop-self"] : []), "  !", " !");
  }
  if (ce) out.push(` neighbor ${CE_ADDR[ce].ce}`, `  remote-as ${CE_AS[ce]}`, "  address-family ipv4 unicast", "   route-policy PASS in", "   route-policy PASS out", "  !", " !");
  out.push("!");
  return out;
}
export function rrJnStmts(r: RrDev, c: RrCfg): JStmt[] {
  const out: JStmt[] = [{ path: ["routing-options"], leaf: `router-id ${RR_LO[r]}` }, { path: ["routing-options"], leaf: `autonomous-system ${AS}` }];
  const ce = CE_OF[r];
  if (c.on) {
    const groups = new Map<string, RrNbr[]>();
    for (const nb of c.nbrs) {
      const g = groupOf(c, r, nb);
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g)!.push(nb);
    }
    for (const [g, nbs] of groups) {
      const p = ["protocols", "bgp", `group ${g}`];
      out.push({ path: p, leaf: "type internal" }, { path: p, leaf: `local-address ${RR_LO[r]}` });
      if (nbs.some((x) => x.client) && c.cluster) out.push({ path: p, leaf: `cluster ${c.cluster}` });
      const allNhs = nbs.every((x) => x.nhs);
      if (allNhs) out.push({ path: p, leaf: "export NHS" });
      for (const nb of nbs) {
        const exp = [...(!allNhs && nb.nhs ? ["NHS"] : []), ...(nb.policy ? [nb.policy] : [])];
        if (exp.length) out.push({ path: [...p, `neighbor ${nb.ip}`], leaf: `export ${exp.length > 1 ? `[ ${exp.join(" ")} ]` : exp[0]}` });
        else out.push({ path: p, leaf: `neighbor ${nb.ip}` });
      }
    }
    if (ce) out.push({ path: ["protocols", "bgp", "group CE"], leaf: "type external" }, { path: ["protocols", "bgp", "group CE"], leaf: `peer-as ${CE_AS[ce]}` }, { path: ["protocols", "bgp", "group CE"], leaf: `neighbor ${CE_ADDR[ce].ce}` });
  }
  if (RR_PES.includes(r)) out.push({ path: ["policy-options", "policy-statement NHS", "then"], leaf: "next-hop self" });
  for (const [name, list] of Object.entries(c.sets)) {
    for (const p of list) out.push({ path: ["policy-options", `policy-statement ${name}`, "term ALLOW", "from"], leaf: `route-filter ${p} exact` });
    out.push({ path: ["policy-options", `policy-statement ${name}`, "term ALLOW"], leaf: "then accept" }, { path: ["policy-options", `policy-statement ${name}`], leaf: "then reject" });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Configuration statements
// ---------------------------------------------------------------------------------------------------------------
const nbr = (c: RrCfg, ip: string) => c.nbrs.find((x) => x.ip === ip);
const ceRefuse = "% The eBGP sessions to the CEs are outside this lab's scope; configure iBGP neighbors (loopbacks).";
function stmts(r: RrDev, s: RrState): SpCfgStmt<RrCfg>[] {
  const isPe = RR_PES.includes(r);
  const groups = isPe ? ["RR"] : ["CLIENTS", "CORE"];
  const grpArg = choiceArg(groups, (g) => (g === "CLIENTS" ? "Route-reflector clients (group with cluster)" : g === "CORE" ? "Non-client iBGP peers" : "The reflectors"));
  return [
    // IOS XR
    { id: "rbgp", summary: "BGP routing protocol", args: { as: choiceArg([String(AS)], () => "This network's AS") }, xr: { mode: "config", syntax: "router bgp <as>", enter: "bgp", apply: (c) => ((c.on = true), c), no: (c) => ({ ...c, on: false, nbrs: [], cluster: undefined }) } },
    { id: "rid", summary: "Configure the router ID", args: { ip: choiceArg([RR_LO[r]], () => "This router's loopback") }, xr: { mode: "bgp", syntax: "bgp router-id <ip>", apply: (c) => c } },
    { id: "cluster", summary: "Configure the route-reflector cluster ID", args: { id: clusterArg }, xr: { mode: "bgp", syntax: "bgp cluster-id <id>", noSyntax: "bgp cluster-id", apply: (c, a) => ((c.cluster = a.id), c), no: (c) => ((c.cluster = undefined), c) } },
    { id: "af", summary: "Enter the IPv4 unicast address family", xr: { mode: "bgp", syntax: "address-family ipv4 unicast", enter: "bgp-af", apply: (c) => c } },
    {
      id: "nbr",
      summary: "Specify a neighbor router",
      args: { ip: peerArg(r) },
      xr: {
        mode: "bgp",
        syntax: "neighbor <ip>",
        enter: "bgp-nbr",
        apply: (c, a) => (isCeAddr(a.ip) ? ceRefuse : (nbr(c, a.ip) || c.nbrs.push({ ip: a.ip, remoteAs: 0, client: false, nhs: false }), c)),
        no: (c, a) => ((c.nbrs = c.nbrs.filter((x) => x.ip !== a.ip)), c),
      },
    },
    { id: "ras", summary: "Set the neighbor's AS number", args: { as: { choices: [String(AS)], describe: () => "AS number", resolve: (raw) => (/^\d+$/.test(raw) && +raw >= 1 && +raw <= 4294967295 ? raw : undefined) } }, xr: { mode: "bgp-nbr", syntax: "remote-as <as>", noSyntax: "remote-as", apply: (c, a, x) => ((nbr(c, x.ip)!.remoteAs = +a.as), c), no: (c, _a, x) => ((nbr(c, x.ip)!.remoteAs = 0), c) } },
    { id: "upd", summary: "Source of routing updates", args: { if: choiceArg(["Loopback0"], () => "Loopback interface") }, xr: { mode: "bgp-nbr", syntax: "update-source <if>", apply: (c) => c, no: () => "% This lab sources every iBGP session from Loopback0." } },
    { id: "naf", summary: "Enter the neighbor's IPv4 unicast address family", xr: { mode: "bgp-nbr", syntax: "address-family ipv4 unicast", enter: "bgp-nbr-af", apply: (c) => c } },
    { id: "rrc", summary: "Configure this neighbor as a route-reflector client", xr: { mode: "bgp-nbr-af", syntax: "route-reflector-client", apply: (c, _a, x) => ((nbr(c, x.ip)!.client = true), (nbr(c, x.ip)!.group = undefined), c), no: (c, _a, x) => ((nbr(c, x.ip)!.client = false), (nbr(c, x.ip)!.group = undefined), c) } },
    { id: "nhs", summary: "Disable the next hop calculation and use the local address", xr: { mode: "bgp-nbr-af", syntax: "next-hop-self", apply: (c, _a, x) => ((nbr(c, x.ip)!.nhs = true), c), no: (c, _a, x) => ((nbr(c, x.ip)!.nhs = false), c) } },
    { id: "rpo", summary: "Apply an outbound route policy", args: { name: setNameArg(s, r) }, xr: { mode: "bgp-nbr-af", syntax: "route-policy <name> out", apply: (c, a, x) => ((nbr(c, x.ip)!.policy = a.name), c), no: (c, _a, x) => ((nbr(c, x.ip)!.policy = undefined), c) } },
    { id: "pset", summary: "Define a prefix set (enter the entries, then end-set)", args: { name: setNameArg(s, r) }, xr: { mode: "config", syntax: "prefix-set <name>", enter: "pfx", apply: (c, a) => ((c.sets[a.name] = []), c), no: (c, a) => (c.nbrs.some((x) => x.policy === a.name) ? `% Prefix set ${a.name} is used by route-policy ${a.name}` : (delete c.sets[a.name], c)) } },
    { id: "endset", summary: "End of set definition", xr: { mode: "pfx", syntax: "end-set", exits: true, apply: (c) => c } },
    { id: "pentry", summary: "A prefix in the set", args: { p: pfxEntryArg }, xr: { mode: "pfx", syntax: "<p>", apply: (c, a, x) => (c.sets[x.name] = [...(c.sets[x.name] ?? []), a.p], c) } },

    // Junos
    { id: "j-bgp", summary: "BGP options", junos: { syntax: "protocols bgp", set: (c) => ((c.on = true), c), del: (c) => ({ ...c, on: false, nbrs: [], cluster: undefined }) } },
    {
      id: "j-nbr",
      summary: "Configure a neighbor in a group",
      args: { g: grpArg, ip: peerArg(r) },
      junos: {
        syntax: "protocols bgp group <g> neighbor <ip>",
        set: (c, a) => {
          if (isCeAddr(a.ip)) return `error: ${ceRefuse.slice(2)}`;
          c.on = true;
          const ex = nbr(c, a.ip);
          const client = a.g === "CLIENTS" && !!c.cluster;
          if (ex) Object.assign(ex, { group: a.g, client });
          else c.nbrs.push({ ip: a.ip, remoteAs: AS, client, nhs: a.g === "RR" && c.nbrs.some((x) => x.nhs), group: a.g });
          return c;
        },
        del: (c, a) => ((c.nbrs = c.nbrs.filter((x) => !(x.ip === a.ip && groupOf(c, r, x) === a.g))), c),
      },
    },
    {
      id: "j-cluster",
      summary: "Cluster identifier (makes the group's neighbors route-reflector clients)",
      args: { g: grpArg, id: clusterArg },
      junos: {
        syntax: "protocols bgp group <g> cluster <id>",
        set: (c, a) => {
          c.cluster = a.id;
          for (const nb of c.nbrs) if (groupOf(c, r, nb) === a.g) Object.assign(nb, { client: true, group: a.g });
          return c;
        },
        del: (c, a) => {
          c.cluster = undefined;
          for (const nb of c.nbrs) if (groupOf(c, r, nb) === a.g) Object.assign(nb, { client: false, group: a.g });
          return c;
        },
      },
    },
    {
      id: "j-export-g",
      summary: "Export policy for every neighbor in the group",
      args: { g: grpArg, pol: { choices: ["NHS", ...Object.keys(s.cfg[r].sets)], describe: (x) => (x === "NHS" ? "next-hop self" : "prefix filter"), resolve: (raw) => (/^[A-Za-z][\w-]{0,31}$/.test(raw) ? raw : undefined) } },
      junos: {
        syntax: "protocols bgp group <g> export <pol>",
        set: (c, a) => {
          for (const nb of c.nbrs) {
            if (groupOf(c, r, nb) !== a.g) continue;
            if (a.pol === "NHS") nb.nhs = true;
            else nb.policy = a.pol;
          }
          return c;
        },
        del: (c, a) => {
          for (const nb of c.nbrs) {
            if (groupOf(c, r, nb) !== a.g) continue;
            if (a.pol === "NHS") nb.nhs = false;
            else if (nb.policy === a.pol) nb.policy = undefined;
          }
          return c;
        },
      },
    },
    {
      id: "j-export-n",
      summary: "Export policy for one neighbor",
      args: { g: grpArg, ip: peerArg(r), pol: { choices: ["NHS", ...Object.keys(s.cfg[r].sets)], describe: (x) => (x === "NHS" ? "next-hop self" : "prefix filter"), resolve: (raw) => (/^[A-Za-z][\w-]{0,31}$/.test(raw) ? raw : undefined) } },
      junos: {
        syntax: "protocols bgp group <g> neighbor <ip> export <pol>",
        set: (c, a) => {
          const nb = nbr(c, a.ip);
          if (!nb) return `error: neighbor ${a.ip} is not configured in group ${a.g}`;
          if (a.pol === "NHS") nb.nhs = true;
          else nb.policy = a.pol;
          return c;
        },
        del: (c, a) => {
          const nb = nbr(c, a.ip);
          if (nb && a.pol === "NHS") nb.nhs = false;
          else if (nb) nb.policy = undefined;
          return c;
        },
      },
    },
    {
      id: "j-rf",
      summary: "A prefix the policy accepts",
      args: { name: setNameArg(s, r), t: { choices: ["ALLOW"], describe: () => "Term name", resolve: (raw) => (raw === "ALLOW" ? raw : undefined) }, p: pfxArg, m: choiceArg(["exact"], () => "Exactly this prefix") },
      junos: {
        syntax: "policy-options policy-statement <name> term <t> from route-filter <p> <m>",
        set: (c, a) => ((c.sets[a.name] = [...new Set([...(c.sets[a.name] ?? []), a.p])]), c),
        del: (c, a) => ((c.sets[a.name] = (c.sets[a.name] ?? []).filter((x) => x !== a.p)), c),
      },
    },
    { id: "j-pol", summary: "A routing policy", args: { name: setNameArg(s, r) }, junos: { syntax: "policy-options policy-statement <name>", del: (c, a) => (a.name === "NHS" ? "error: this lab keeps the NHS policy" : (delete c.sets[a.name], c)) } },
  ];
}

// ---------------------------------------------------------------------------------------------------------------
// Command sets
// ---------------------------------------------------------------------------------------------------------------
export function rrValidate(c: RrCfg, junos: boolean): string | undefined {
  const missing = c.nbrs.find((x) => x.policy && !c.sets[x.policy]);
  if (missing) return junos ? `Policy error: Policy ${missing.policy} referenced but not defined` : `!!% Policy [${missing.policy}] uses undefined route-policy`;
  return undefined;
}
function ping(api: RrCliApi, r: RrDev, raw: string) {
  const ce = CE_OF[r];
  const prefix = resolvePfx(raw);
  if (ce && prefix) api.act({ type: "test", from: ce, dst: prefix.replace(/\.0\/24$/, ".10") });
}
export function rrXrSpec(api: RrCliApi, r: RrDev): SpXrSpec<RrCfg> {
  const s = api.s;
  const sh = (id: string, syntax: string, summary: string, run: SpCmd["run"], args?: SpCmd["args"]): SpCmd => ({ id, syntax, summary, run, args });
  return {
    stmts: stmts(r, s).filter((x) => x.xr),
    prompts: { config: "config", bgp: "config-bgp", "bgp-af": "config-bgp-af", "bgp-nbr": "config-bgp-nbr", "bgp-nbr-af": "config-bgp-nbr-af", pfx: "config-pfx" },
    lines: (c) => rrXrLines(r, c),
    help: { "show bgp": "BGP information", "show route": "IP routing table", "show bgp neighbors": "Detailed information on TCP and BGP neighbor connections" },
    shows: [
      sh("sum", "show bgp summary", "Sessions and prefixes received", () => xrSummary(s, r)),
      sh("tbl", "show bgp", "The BGP table", () => xrTable(s, r)),
      sh("pfx", "show bgp <prefix>", "Every path for one prefix, with ORIGINATOR_ID and CLUSTER_LIST", (a) => xrPrefix(s, r, a.prefix), { prefix: pfxArg }),
      sh("nbr", "show bgp neighbors <ip>", "One session in detail", (a) => xrNeighbor(s, r, a.ip), { ip: nbrArg(s, r) }),
      sh("adv", "show bgp neighbors <ip> advertised-routes", "What this router sends to the neighbor", (a) => xrAdvertised(s, r, a.ip) || { output: "", explanation: "Nothing advertised to this neighbor." }, { ip: nbrArg(s, r) }),
      sh("rcv", "show bgp neighbors <ip> routes", "What the neighbor sent (accepted)", (a) => xrRoutes(s, r, a.ip), { ip: nbrArg(s, r) }),
      sh("route", "show route bgp", "BGP routes in the routing table", () => xrRoute(s, r) || { output: "", explanation: "No BGP routes are installed." }),
      sh("route-ip", "show route <ip>", "The route a destination uses", (a) => xrRoute(s, r, a.ip), { ip: hostArg }),
      sh("log", "show logging", "The syslog buffer", () => xrLogging(s, r)),
    ],
    exec: RR_PES.includes(r)
      ? [
          sh("ping", "ping <ip> source <src>", "Ping from this PE's customer site (CE)", (a) => {
            ping(api, r, a.ip);
            const prefix = resolvePfx(a.ip);
            const ok = !!prefix && !!bestPath(s.cfg, s.view, r, prefix).best;
            return ["Type escape sequence to abort.", `Sending 5, 100-byte ICMP Echos to ${a.ip}, timeout is 2 seconds:`, ok ? "!!!!!" : "UUUUU", ok ? "Success rate is 100 percent (5/5), round-trip min/avg/max = 2/3/4 ms" : "Success rate is 0 percent (0/5)"].join("\n");
          }, { ip: hostArg, src: choiceArg([CE_ADDR[CE_OF[r]].pe], () => "The customer-facing address") }),
        ]
      : [],
  };
}
export function rrJunosSpec(api: RrCliApi, r: RrDev): SpJunosSpec<RrCfg> {
  const s = api.s;
  const sh = (id: string, syntax: string, summary: string, run: SpCmd["run"], args?: SpCmd["args"]): SpCmd => ({ id, syntax, summary, run, args });
  const nothing = (o: string, why: string) => o || { output: "", explanation: why };
  return {
    stmts: stmts(r, s).filter((x) => x.junos),
    jstmts: (c) => rrJnStmts(r, c),
    help: { "show bgp": "Show Border Gateway Protocol information", "show route": "Show routing table information", "show route protocol": "Name of protocol from which route was learned", "show route advertising-protocol": "Show routing table entries advertised to a peer", "show route receive-protocol": "Show routing table entries received from a peer" },
    shows: [
      sh("sum", "show bgp summary", "Sessions and prefixes", () => jnSummary(s, r)),
      sh("nbr", "show bgp neighbor <ip>", "One session in detail", (a) => nothing(jnNeighbor(s, r, a.ip), "No such neighbor."), { ip: nbrArg(s, r) }),
      sh("rp", "show route protocol bgp", "BGP routes", () => nothing(jnRoute(s, r, undefined, "brief"), "No usable BGP routes.")),
      sh("ri", "show route <ip>", "The route a destination uses", (a) => nothing(jnRoute(s, r, a.ip, "brief"), "No usable route."), { ip: hostArg }),
      sh("rd", "show route <ip> detail", "Every path in detail (Cluster list, Originator ID)", (a) => nothing(jnRoute(s, r, a.ip, "detail"), "No usable route."), { ip: hostArg }),
      sh("rh", "show route <ip> hidden", "Paths Junos cannot use", (a) => nothing(jnRoute(s, r, a.ip, "hidden"), "Nothing hidden."), { ip: hostArg }),
      sh("rcv", "show route receive-protocol bgp <ip>", "What the neighbor sent", (a) => nothing(jnReceive(s, r, a.ip, false), "Nothing received from this neighbor."), { ip: nbrArg(s, r) }),
      sh("adv", "show route advertising-protocol bgp <ip>", "What this router sends to the neighbor", (a) => nothing(jnReceive(s, r, a.ip, true), "Nothing advertised to this neighbor."), { ip: nbrArg(s, r) }),
      sh("log", "show log messages", "The system log", () => jnLog(s, r)),
    ],
    op: [],
  };
}
export function rrSets(api: RrCliApi, r: RrDev): Partial<Record<CliVendor, CliCommandSet>> {
  return {
    cisco: buildXrSet({ ...api.dev, validate: (c) => rrValidate(c, false) }, rrXrSpec(api, r)),
    juniper: buildJunosSet({ ...api.dev, validate: (c) => rrValidate(c, true) }, rrJunosSpec(api, r)),
  };
}
export const rrPipe = (api: RrCliApi, r: RrDev) => ({ config: junosPipeConfig(api.dev, { jstmts: (c: RrCfg) => rrJnStmts(r, c) }), rollbacks: api.dev.hist.length });
export function rrStaticApi(s: RrState, r: RrDev): RrCliApi {
  return { s, act: () => s, dev: { host: r, running: s.cfg[r], hist: s.hist[r], setCand: () => undefined, xr: [], setXr: () => undefined, edit: false, setEdit: () => undefined, commit: () => undefined } };
}
export const rrClone = spClone;
export { isRr };
