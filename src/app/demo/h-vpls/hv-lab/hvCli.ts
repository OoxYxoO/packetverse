import type { CliArgSpec, CliCommandSet, CliVendor } from "@/lib/cli/types";
import { buildJunosSet, buildXrSet, choiceArg, junosPipeConfig, numArg, type SpCfgStmt, type SpCmd, type SpDevCli, type SpJunosSpec, type SpXrSpec } from "@/components/sp-lab/spCli";
import { lpad, pad, spAge, spClone, spStamp, type JStmt } from "@/components/sp-lab/spKit";
import { jnIf, parseIf, xrIf } from "@/components/sp-lab/spNames";
import { HUB, ACCESS, HV_LINKS, HV_LO, HV_ROUTERS, HV_VPLS, IMPLICIT_NULL, acKey, ceIfs, coreIfs, devOfLo, isMtu, isPe, isVpls, ldpLabel, nbrsOf, pairKey, pathBetween, pwidOf, type HvAction, type HvBd, type HvCfg, type HvPw, type HvR, type HvState, type IfName } from "@/lib/sim-engine/scenarios/hvNet";

/**
 * Command lines of the H-VPLS Lab — IOS XR or Junos on PE1–PE3 (PE-rs), MTU1–MTU3 (MTU-s) and P1. Every output is
 * printed from the lab model: the bridge with its attachment circuits, spoke and mesh pseudowires, the MAC tables,
 * targeted LDP, labels.
 *
 *   IOS XR  show l2vpn bridge-domain [detail] · show l2vpn forwarding bridge-domain mac-address location 0/0/CPU0 ·
 *           show mpls ldp discovery · show mpls ldp neighbor brief · show mpls forwarding · show route · show logging ·
 *           clear l2vpn bridge-domain bd-name <name>
 *           configure → interface <if>.<vlan> l2transport → encapsulation dot1q <vlan> · l2vpn → bridge group <g> →
 *           bridge-domain <name> → mtu <n> · interface <if>.<vlan> · neighbor <ip> pw-id <id> (an access pseudowire:
 *           a spoke) · vfi <name> → neighbor <ip> pw-id <id> (the core mesh) · mpls ldp → interface <if> · commit
 *   Junos   show vpls connections · show vpls mac-table · show ldp session · show ldp neighbor ·
 *           show route table inet.3 | mpls.0 · show log messages · clear vpls mac-table instance <name>
 *           configure → set interfaces <if> unit <u> encapsulation vlan-vpls | vlan-id <vlan> ·
 *           routing-instances <name> instance-type vpls | interface <if>.<u> | protocols vpls vpls-id <id> |
 *           neighbor <ip> (the default mesh group: the core) | mesh-group <g> vpls-id <id> | mesh-group <g> neighbor
 *           <ip> | mesh-group <g> local-switching | mtu <n> | no-tunnel-services · protocols ldp interface <if> · commit
 */

export interface HvCliApi {
  s: HvState;
  act: (a: HvAction) => HvState;
  dev: SpDevCli<HvCfg>;
}

// ---------------------------------------------------------------------------------------------------------------
// Names and arguments
// ---------------------------------------------------------------------------------------------------------------
const ipRe = /^(\d{1,3}\.){3}\d{1,3}$/;
const wordRe = /^[A-Za-z_][\w-]{0,31}$/;
export const xrSub = (k: string, short = false) => {
  const [ifn, u] = k.split(".");
  return `${xrIf(ifn, short)}.${u}`;
};
export function parseSub(raw: string): string | undefined {
  const m = /^(?:gigabitethernet|gi|gig)0\/0\/0\/([0-2])\.(\d{1,5})$/i.exec(raw) ?? /^ge-0\/0\/([0-2])\.(\d{1,5})$/i.exec(raw);
  if (!m || +m[2] < 1 || +m[2] > 4094) return undefined;
  return `ge-0/0/${m[1]}.${+m[2]}`;
}
const subArg = (s: HvState, r: HvR, junos: boolean): CliArgSpec => ({
  choices: [...new Set([...Object.keys(s.cfg[r].acs), ...ceIfs(r).map((x) => acKey(x.ifn, x.vlan))])].map((k) => (junos ? k : xrSub(k))),
  describe: (c) => {
    const k = parseSub(c);
    const ce = k ? ceIfs(r).find((x) => k.startsWith(`${x.ifn}.`)) : undefined;
    return ce ? `sub-interface toward ${ce.ce}` : "Sub-interface (port.VLAN)";
  },
  resolve: (raw) => {
    const k = parseSub(raw);
    return k && ceIfs(r).some((x) => k.startsWith(`${x.ifn}.`)) ? k : undefined;
  },
});
const portArg = (r: HvR): CliArgSpec => ({ choices: ceIfs(r).map((x) => x.ifn), describe: (c) => `to ${ceIfs(r).find((x) => x.ifn === c)?.ce ?? "?"}`, resolve: (raw) => (ceIfs(r).some((x) => x.ifn === raw) ? raw : undefined) });
const pifArg = (r: HvR, junos: boolean): CliArgSpec => ({
  choices: [...coreIfs(r).map((x) => (junos ? jnIf(x.ifn) : xrIf(x.ifn))), ...(junos && isVpls(r) ? ["lo0.0"] : [])],
  describe: (c) => {
    const i = parseIf(c);
    return i === "lo0" ? "the loopback (targeted sessions)" : `to ${coreIfs(r).find((x) => x.ifn === i)?.peer ?? "?"}`;
  },
  resolve: (raw) => {
    const i = parseIf(raw);
    return i && (coreIfs(r).some((x) => x.ifn === i) || (junos && i === "lo0")) ? i : undefined;
  },
});
const meshNbrs = (r: HvR) => (isPe(r) ? HV_VPLS.filter((x) => isPe(x) && x !== r).map((x) => HV_LO[x]) : []);
const spokeNbrs = (r: HvR) => (isPe(r) ? [HV_LO[ACCESS[r]]] : isMtu(r) ? [HV_LO[HUB[r]]] : []);
const nbrArg = (choices: string[], what: string): CliArgSpec => ({ choices, describe: (c) => { const d = devOfLo(c); return d ? `${d}'s loopback` : what; }, resolve: (raw) => (ipRe.test(raw) ? raw : undefined) });
const pwidArg = numArg(1, 4294967295, ["100"], "Pseudowire ID (the same at both ends)");
const vlanArg = numArg(1, 4094, ["100"], "VLAN ID");
const nameArg = (names: string[], what: string): CliArgSpec => ({ choices: names, describe: () => what, resolve: (raw) => (wordRe.test(raw) ? raw : undefined) });

// ---------------------------------------------------------------------------------------------------------------
// IOS XR outputs
// ---------------------------------------------------------------------------------------------------------------
const pwsOf = (s: HvState, r: HvR) => s.view.pws.filter((p) => p.dev === r);
function xrPwDetail(p: HvPw, r: HvR, shg: boolean): string[] {
  const col = (a: string | number, b: string | number) => `${pad(a, 44)}${b}`;
  return [
    `      PW: neighbor ${p.ip}, PW ID ${p.pwid ?? "-"}, state is ${p.up ? "up ( established )" : "down ( local ready )"}`,
    "        Encapsulation MPLS, protocol LDP",
    `        Source address ${HV_LO[r]}`,
    "        PW type Ethernet, control word disabled, interworking none",
    "        Sequencing not set",
    "",
    `        ${col("MPLS         Local", "Remote")}`,
    "        ------------ ------------------------------ -----------------------------",
    `        ${col(`Label        ${p.local ?? "unassigned"}`, p.remote ? p.remote.label : "unknown")}`,
    `        ${col(`MTU          ${p.mtu}`, p.remote ? p.remote.mtu : "unknown")}`,
    `        ${col("Control word disabled", p.remote ? "disabled" : "unknown")}`,
    `        ${col("PW type      Ethernet", p.remote ? "Ethernet" : "unknown")}`,
    "        ------------ ------------------------------ -----------------------------",
    `        Split Horizon Group: ${shg ? "enabled (VFI)" : "none"}`,
  ];
}
function xrBridgeDomain(s: HvState, r: HvR, detail: boolean): string {
  const bd = s.cfg[r].bd;
  if (!isVpls(r) || !bd) return "";
  const acs = bd.acs.map((k) => ({ k, up: !!s.cfg[r].acs[k] }));
  const all = pwsOf(s, r);
  const access = all.filter((p) => p.role === "spoke");
  const vfi = all.filter((p) => p.role === "mesh");
  const up = all.filter((p) => p.up).length;
  const out = [
    "Legend: pp = Partially Programmed.",
    `Bridge group: ${bd.group}, bridge-domain: ${bd.name}, id: 0, state: up, ShgId: 0, MSTi: 0`,
    "  Aging: 300 s, MAC limit: 64000, Action: none, Notification: syslog",
    "  Filter MAC addresses: 0",
    `  ACs: ${acs.length} (${acs.filter((a) => a.up).length} up), VFIs: ${bd.vfi ? 1 : 0}, PWs: ${all.length} (${up} up), PBBs: 0 (0 up), VNIs: 0 (0 up)`,
  ];
  if (!detail) {
    out.push("  List of ACs:", ...acs.map((a) => `    ${xrSub(a.k, true)}, state: ${a.up ? "up" : "unresolved"}, Static MAC addresses: 0`), "  List of Access PWs:", ...access.map((p) => `    Neighbor ${p.ip} pw-id ${p.pwid ?? "-"}, state: ${p.up ? "up" : "down"}, Static MAC addresses: 0`), "  List of VFIs:");
    if (bd.vfi) out.push(`    VFI ${bd.name} (${vfi.some((p) => p.up) ? "up" : "down"})`, ...vfi.map((p) => `      Neighbor ${p.ip} pw-id ${p.pwid ?? "-"}, state: ${p.up ? "up" : "down"}, Static MAC addresses: 0`));
    out.push("  List of Access VFIs:");
    return out.join("\n");
  }
  out.push(`  MTU: ${bd.mtu}`, "  List of ACs:");
  for (const a of acs) {
    const ac = s.cfg[r].acs[a.k];
    out.push(`    AC: ${xrSub(a.k)}, state is ${a.up ? "up" : "unresolved"}`, ...(ac ? ["      Type VLAN; Num Ranges: 1", `      VLAN ranges: ${ac.vlan ? `[${ac.vlan}, ${ac.vlan}]` : "none"}`, `      MTU ${bd.mtu}; XC ID 0x10800${String(bd.acs.indexOf(a.k) + 1).padStart(2, "0")}; interworking none`] : []), "      Split Horizon Group: none");
  }
  out.push("  List of Access PWs:");
  for (const p of access) out.push(...xrPwDetail(p, r, false).map((l) => l.replace(/^ {2}/, "")));
  out.push("  List of VFIs:");
  if (bd.vfi) {
    out.push(`    VFI ${bd.name} (${vfi.some((p) => p.up) ? "up" : "down"})`);
    for (const p of vfi) out.push(...xrPwDetail(p, r, true));
  }
  return out.join("\n");
}
const xrMac = (m: string) => m.replace(/:/g, "").replace(/(....)(....)(....)/, "$1.$2.$3");
function xrMacTable(s: HvState, r: HvR): string {
  if (!isVpls(r)) return "";
  const rows = s.fdb[r].map((m) => {
    const p = m.port.startsWith("pw:") ? pwsOf(s, r).find((x) => x.ip === m.port.slice(3)) : undefined;
    const port = m.port.startsWith("pw:") ? `(${m.port.slice(3)}, ${p?.pwid ?? "-"})` : xrSub(m.port, true);
    return `${pad(xrMac(m.mac), 15)}${pad("dynamic", 8)}${pad(port, 28)}${pad("N/A", 11)}${pad(`11 Oct ${spStamp(m.t).hms}`, 23)}N/A`;
  });
  return ["To Resynchronize MAC table from the Network Processors, use the command...", "    l2vpn resynchronize forwarding mac-address-table location <r/s/i>", "", "Mac Address    Type    Learned from/Filtered on    LC learned Resync Age/Last Change Mapped to", "-------------- ------- --------------------------- ---------- ---------------------- --------------", ...rows].join("\n");
}
const tSessions = (s: HvState, r: HvR) => (isVpls(r) ? HV_VPLS.filter((p) => p !== r && s.view.tldp[pairKey(r, p)]) : []);
function xrDiscovery(s: HvState, r: HvR): string {
  const ifs = coreIfs(r).filter((x) => s.cfg[r].ldp[x.ifn]).flatMap((x) => {
    const up = s.view.ldp[x.link.id];
    return [`    ${xrIf(x.ifn)} : xmit${up ? "/recv" : ""}`, "      VRF: 'default' (0x60000000)", ...(up ? [`      LDP Id: ${HV_LO[x.peer]}:0, Transport address: ${HV_LO[x.peer]}`, "          Hold time: 15 sec (local:15 sec, peer:15 sec)"] : [])];
  });
  const tgt = nbrsOf(s.os, s.cfg[r].bd).map((x) => x.n.ip).flatMap((ip) => {
    const peer = devOfLo(ip);
    const ok = !!peer && !!s.view.tldp[pairKey(r, peer)];
    return [`    ${HV_LO[r]} -> ${ip} (active${ok ? "/passive" : ""}), xmit${ok ? "/recv" : ""}`, ...(ok ? [`      LDP Id: ${ip}:0`, "          Hold time: 90 sec (local:90 sec, peer:90 sec)"] : [])];
  });
  return [`Local LDP Identifier: ${HV_LO[r]}:0`, "Discovery Sources:", "  Interfaces:", ...ifs, ...(tgt.length ? ["", "  Targeted Hellos:", ...tgt] : [])].join("\n");
}
function xrLdpBrief(s: HvState, r: HvR): string {
  const row = (lo: string) => `${pad(`${lo}:0`, 18)}${pad("Y", 4)}${pad(spAge(s.clock, 20), 10)}${lpad(1, 6)}${lpad(4, 9)}${lpad(1, 7)}${lpad(8, 6)}`;
  const rows = [...coreIfs(r).filter((x) => s.view.ldp[x.link.id]).map((x) => row(HV_LO[x.peer])), ...tSessions(s, r).filter((p) => !coreIfs(r).some((x) => x.peer === p && s.view.ldp[x.link.id])).map((p) => row(HV_LO[p]))];
  return ["Peer              GR  Up Time         Discovery   Addresses     Labels", "                                      ipv4  ipv6  ipv4  ipv6  ipv4   ipv6", "----------------- --  --------------- ----- ----  ----- ----  ------ ----", ...rows].join("\n");
}
const lab = (n: number | undefined) => (n === undefined ? "Unlabelled" : n === IMPLICIT_NULL ? "Pop" : String(n));
function transportRows(s: HvState, r: HvR) {
  return HV_VPLS.filter((p) => p !== r).flatMap((p) => {
    const fec = HV_LO[p];
    const t = s.view.lsp[r][fec];
    if (!t?.nh) return [];
    const x = coreIfs(r).find((y) => y.peer === t.nh)!;
    return [{ fec, local: ldpLabel(s.os, r, fec), out: t.out, ifn: x.ifn, nh: x.peerIp }];
  });
}
function xrForwarding(s: HvState, r: HvR): string {
  const rows = transportRows(s, r).map((t) => ({ k: t.local, l: `${pad(t.local, 7)}${pad(lab(t.out), 12)}${pad(`${t.fec}/32`, 19)}${pad(xrIf(t.ifn, true), 13)}${pad(t.nh, 16)}0` }));
  for (const p of pwsOf(s, r).filter((x) => x.up)) rows.push({ k: p.local!, l: `${pad(p.local!, 7)}${pad("Pop", 12)}${pad(`PW(${p.ip}:${p.pwid})`, 19)}${pad("BD=0", 13)}${pad("point2point", 16)}0` });
  rows.sort((a, b) => a.k - b.k);
  return ["Local  Outgoing    Prefix             Outgoing     Next Hop        Bytes", "Label  Label       or ID              Interface                    Switched", "------ ----------- ------------------ ------------ --------------- ------------", ...rows.map((x) => x.l)].join("\n");
}
function xrRouteGlobal(s: HvState, r: HvR): string {
  const num = (ip: string) => ip.split(".").reduce((n, o) => n * 256 + +o, 0);
  const rows = [...HV_ROUTERS].sort((a, b) => num(HV_LO[a]) - num(HV_LO[b])).map((n) => {
    if (n === r) return `L    ${pad(`${HV_LO[n]}/32`, 18)} is directly connected, ${spAge(s.clock, 30)}, Loopback0`;
    const path = pathBetween(r, n);
    const x = coreIfs(r).find((y) => y.peer === path[1])!;
    return `i L2 ${pad(`${HV_LO[n]}/32`, 18)} [115/${10 * (path.length - 1) + 10}] via ${x.peerIp}, ${spAge(s.clock, 30)}, ${xrIf(x.ifn)}`;
  });
  return ["Codes: C - connected, S - static, B - BGP, i - ISIS, L1 - IS-IS level-1, L2 - IS-IS level-2", "       L - local", "", "Gateway of last resort is not set", "", ...rows].join("\n");
}
function xrLogging(s: HvState, r: HvR): string {
  const bdName = s.cfg[r].bd?.name ?? "HVPLS-A";
  const lines = s.sys.filter((x) => x.dev === r).slice(-30).map((x) => {
    const st = `RP/0/RP0/CPU0:${spStamp(x.t).xr}`;
    if (x.kind === "ldp-up") return `${st}: mpls_ldp[1159]: %ROUTING-LDP-5-NBR_CHANGE : VRF 'default' (0x60000000), Neighbor ${x.peer}:0 is UP`;
    if (x.kind === "ldp-down") return `${st}: mpls_ldp[1159]: %ROUTING-LDP-5-NBR_CHANGE : VRF 'default' (0x60000000), Neighbor ${x.peer}:0 is DOWN (Interface state down)`;
    if (x.kind === "pw-up") return `${st}: l2vpn_mgr[1234]: %L2-L2VPN_PW-3-UPDOWN : Pseudowire with address ${x.peer}, id ${x.pwid}, state is Up`;
    if (x.kind === "pw-down") return `${st}: l2vpn_mgr[1234]: %L2-L2VPN_PW-3-UPDOWN : Pseudowire with address ${x.peer}, id ${x.pwid}, state is Down`;
    if (x.kind === "clear") return `${st}: l2vpn_mgr[1234]: bridge-domain ${bdName}: MAC addresses cleared by user 'admin'`;
    return `${st}: config[65857]: %MGBL-CONFIG-6-DB_COMMIT : Configuration committed by user 'admin'. Use 'show commit changes ${1000000000 + x.t}' to view the changes.`;
  });
  return ["Syslog logging: enabled (0 messages dropped, 0 flushes, 0 overruns)", `    Buffer logging: level debugging, ${lines.length} messages logged`, "", "Log Buffer (2097152 bytes):", "", ...lines].join("\n");
}

// ---------------------------------------------------------------------------------------------------------------
// Junos outputs
// ---------------------------------------------------------------------------------------------------------------
const JN_LEGEND = [
  "Layer-2 VPN connections:",
  "",
  "Legend for connection status (St)",
  "EI -- encapsulation invalid      NC -- interface encapsulation not CCC/TCC/VPLS",
  "EM -- encapsulation mismatch     WE -- interface and instance encaps not same",
  "VC-Dn -- Virtual circuit down    NP -- interface hardware not present",
  "CM -- control-word mismatch      -> -- only outbound connection is up",
  "CN -- circuit not provisioned    <- -- only inbound connection is up",
  "OR -- out of range               Up -- operational",
  "OL -- no outgoing label          Dn -- down",
  "LD -- local site signaled down   CF -- call admission control failure",
  "RD -- remote site signaled down  SC -- local and remote site ID collision",
  "XX -- unknown connection status  IL -- no incoming label",
  "MM -- MTU mismatch               MI -- Mesh-Group ID not available",
  "BK -- Backup connection          ST -- Standby connection",
  "",
  "Legend for interface status",
  "Up -- operational",
  "Dn -- down",
];
const lsi = (p: HvPw) => `lsi.10488${String(30 + (p.peer ? HV_VPLS.indexOf(p.peer) : 9)).padStart(2, "0")}`;
const jnSt = (p: HvPw) => (p.up ? "Up" : p.why === "mtu" ? "MM" : p.why === "nolsp" ? "VC-Dn" : p.why === "remotedown" ? "RD" : "OL");
function jnConnections(s: HvState, r: HvR): string {
  const bd = s.cfg[r].bd;
  if (!isVpls(r) || !bd) return "";
  const out = [...JN_LEGEND, `Instance: ${bd.name}`, `  VPLS-id: ${bd.vplsId ?? "none"}`];
  const groups: [string, HvPw[]][] = [];
  const spokes = pwsOf(s, r).filter((p) => p.role === "spoke");
  if (bd.spokeGroup) groups.push([bd.spokeGroup.name, spokes]);
  groups.push(["__ves__", pwsOf(s, r).filter((p) => p.role === "mesh")]);
  for (const [g, pws] of groups) {
    if (!pws.length && g !== "__ves__") continue;
    out.push(`    Mesh-group connections: ${g}`, "    Neighbor                  Type  St     Time last up          # Up trans");
    for (const p of pws) {
      const ups = s.sys.filter((x) => x.dev === r && x.kind === "pw-up" && x.peer === p.ip);
      out.push(`    ${pad(`${p.ip}(vpls-id ${p.pwid ?? "-"})`, 26)}${pad("rmt", 6)}${pad(jnSt(p), 7)}${pad(p.up ? `${spStamp(ups.at(-1)?.t ?? 32).junos} 2026` : "-----", 22)}${lpad(ups.length, 10)}`);
      if (p.up || p.remote) out.push(`      Remote PE: ${p.ip}, Negotiated control-word: No`);
      out.push(`      Incoming label: ${p.local ?? ""}, Outgoing label: ${p.remote?.label ?? ""}`.trimEnd());
      if (p.up) out.push("      Negotiated PW status TLV: No", `      Local interface: ${lsi(p)}, Status: Up, Encapsulation: ETHERNET`, `        Description: Intf - vpls ${bd.name} neighbor ${p.ip} vpls-id ${p.pwid}`);
    }
  }
  return out.join("\n");
}
function jnMacTable(s: HvState, r: HvR): string {
  const bd = s.cfg[r].bd;
  if (!isVpls(r) || !bd) return "";
  const rows = s.fdb[r].map((m) => {
    const p = m.port.startsWith("pw:") ? pwsOf(s, r).find((x) => x.ip === m.port.slice(3)) : undefined;
    return `   ${pad(m.mac, 20)}${pad("D", 9)}${m.port.startsWith("pw:") ? (p ? lsi(p) : "lsi.?") : m.port}`;
  });
  return ["", "MAC flags       (S -static MAC, D -dynamic MAC, L -locally learned, C -Control MAC", "    O -OVSDB MAC, SE -Statistics enabled, NM -Non configured MAC, R -Remote PE MAC, P -Pinned MAC)", "", `Routing instance : ${bd.name}`, ` Bridging domain : __${bd.name}__, VLAN : NA`, "   MAC                 MAC      Logical          NH     MAC         active", "   address             flags    interface        Index  property    source", ...rows].join("\n");
}
function jnLdpSession(s: HvState, r: HvR): string {
  const row = (lo: string, hold: number) => `${pad(lo, 21)}${pad("Operational", 14)}${pad("Open", 13)}${lpad(hold, 5)}         DU`;
  const link = coreIfs(r).filter((x) => s.view.ldp[x.link.id]);
  return ["  Address              State        Connection  Hold time  Adv. Mode", ...link.map((x) => row(HV_LO[x.peer], 28)), ...tSessions(s, r).filter((p) => !link.some((x) => x.peer === p)).map((p) => row(HV_LO[p], 25))].join("\n");
}
function jnLdpNeighbor(s: HvState, r: HvR): string {
  const rows = [...coreIfs(r).filter((x) => s.view.ldp[x.link.id]).map((x) => `${pad(x.peerIp, 36)}${pad(jnIf(x.ifn), 16)}${pad(`${HV_LO[x.peer]}:0`, 21)}13`), ...tSessions(s, r).map((p) => `${pad(HV_LO[p], 36)}${pad("lo0.0", 16)}${pad(`${HV_LO[p]}:0`, 21)}43`)];
  return ["Address                             Interface       Label space ID     Hold time", ...rows].join("\n");
}
function jnInet3(s: HvState, r: HvR): string {
  const rows = transportRows(s, r).filter((t) => t.out !== undefined).map((t) => [`${pad(`${t.fec}/32`, 19)}*[LDP/9] ${spAge(s.clock, 20)}, metric 1`, `                    >  to ${t.nh} via ${jnIf(t.ifn)}${t.out === IMPLICIT_NULL ? "" : `, Push ${t.out}`}`]);
  const n = rows.length;
  return [`inet.3: ${n} destinations, ${n} routes (${n} active, 0 holddown, 0 hidden)`, ...(n ? ["+ = Active Route, - = Last Active, * = Both", "", ...rows.flat()] : [])].join("\n");
}
function jnMpls0(s: HvState, r: HvR): string {
  const rows: { k: number; l: string[] }[] = [{ k: 0, l: ["0                  *[MPLS/0] 01:00:00, metric 1", "                       to table inet.0"] }];
  for (const t of transportRows(s, r).filter((x) => x.out !== undefined)) rows.push({ k: t.local, l: [`${pad(t.local, 19)}*[LDP/9] ${spAge(s.clock, 20)}, metric 1`, `                    >  to ${t.nh} via ${jnIf(t.ifn)}, ${t.out === IMPLICIT_NULL ? "Pop" : `Swap ${t.out}`}`] });
  for (const p of pwsOf(s, r).filter((x) => x.up)) rows.push({ k: p.local!, l: [`${pad(p.local!, 19)}*[VPLS/7] ${spAge(s.clock, 32)}`, `                    >  via ${lsi(p)}, Pop`] });
  rows.sort((a, b) => a.k - b.k);
  return [`mpls.0: ${rows.length} destinations, ${rows.length} routes (${rows.length} active, 0 holddown, 0 hidden)`, "+ = Active Route, - = Last Active, * = Both", "", ...rows.flatMap((x) => x.l)].join("\n");
}
function jnLog(s: HvState, r: HvR): string {
  const bdName = s.cfg[r].bd?.name ?? "HVPLS-A";
  return s.sys.filter((x) => x.dev === r).slice(-30).map((x) => {
    const st = `${spStamp(x.t).junos}  ${r}`;
    if (x.kind === "ldp-up") return `${st} rpd[1532]: RPD_LDP_NBRUP: LDP neighbor ${x.peer} (${x.peer}) is up`;
    if (x.kind === "ldp-down") return `${st} rpd[1532]: RPD_LDP_NBRDOWN: LDP neighbor ${x.peer} (${x.peer}) is down`;
    if (x.kind === "pw-up") return `${st} rpd[1532]: RPD_VPLS_INTF_UP: ${bdName}: VPLS interface to neighbor ${x.peer} is up`;
    if (x.kind === "pw-down") return `${st} rpd[1532]: RPD_VPLS_INTF_DOWN: ${bdName}: VPLS interface to neighbor ${x.peer} is down`;
    if (x.kind === "clear") return `${st} mgd[4417]: UI_CMDLINE_READ_LINE: User 'admin', command 'clear vpls mac-table instance ${bdName}'`;
    return `${st} mgd[4417]: UI_COMMIT: User 'admin' requested 'commit' operation (comment: none)`;
  }).join("\n");
}

// ---------------------------------------------------------------------------------------------------------------
// Configuration as each OS prints it
// ---------------------------------------------------------------------------------------------------------------
export function hvXrLines(r: HvR, c: HvCfg): string[] {
  const out: string[] = [`hostname ${r}`, "!", "interface Loopback0", ` ipv4 address ${HV_LO[r]} 255.255.255.255`, "!"];
  for (const x of coreIfs(r)) out.push(`interface ${xrIf(x.ifn)}`, ` description to ${x.peer}`, ` ipv4 address ${x.ip} 255.255.255.254`, "!");
  for (const x of ceIfs(r)) out.push(`interface ${xrIf(x.ifn)}`, ` description to ${x.ce}`, "!");
  for (const [k, ac] of Object.entries(c.acs).sort(([a], [b]) => a.localeCompare(b))) out.push(`interface ${xrSub(k)} l2transport`, ...(ac.vlan ? [` encapsulation dot1q ${ac.vlan}`] : []), "!");
  out.push("router isis CORE", ` net 49.0001.0000.0000.000${HV_ROUTERS.indexOf(r) + 1}.00`, " address-family ipv4 unicast", "  metric-style wide", " !", "!");
  const bd = c.bd;
  if (bd) {
    out.push("l2vpn", ` bridge group ${bd.group}`, `  bridge-domain ${bd.name}`, ...(bd.mtu !== 1500 ? [`   mtu ${bd.mtu}`] : []));
    for (const k of bd.acs) out.push(`   interface ${xrSub(k)}`, "   !");
    for (const n of bd.spokes) out.push(`   neighbor ${n.ip} pw-id ${n.pwid ?? "-"}`, "   !");
    if (bd.vfi) {
      out.push(`   vfi ${bd.name}`);
      for (const n of bd.mesh) out.push(`    neighbor ${n.ip} pw-id ${n.pwid ?? "-"}`, "    !");
      out.push("   !");
    }
    out.push("  !", " !", "!");
  }
  out.push("mpls ldp", ` router-id ${HV_LO[r]}`, ...coreIfs(r).filter((x) => c.ldp[x.ifn]).flatMap((x) => [` interface ${xrIf(x.ifn)}`, " !"]), "!");
  return out;
}
export function hvJnStmts(r: HvR, c: HvCfg): JStmt[] {
  const out: JStmt[] = [];
  for (const x of coreIfs(r)) out.push({ path: ["interfaces", x.ifn, "unit 0", "family inet"], leaf: `address ${x.ip}/31` }, { path: ["interfaces", x.ifn, "unit 0", "family mpls"], leaf: "" });
  for (const x of ceIfs(r)) {
    const units = Object.entries(c.acs).filter(([k]) => k.startsWith(`${x.ifn}.`));
    if (!units.length) continue;
    out.push({ path: ["interfaces", x.ifn], leaf: "flexible-vlan-tagging" }, { path: ["interfaces", x.ifn], leaf: "encapsulation flexible-ethernet-services" });
    for (const [k, ac] of units) {
      const u = ["interfaces", x.ifn, `unit ${k.split(".")[1]}`];
      if (ac.vpls) out.push({ path: u, leaf: "encapsulation vlan-vpls" });
      if (ac.vlan) out.push({ path: u, leaf: `vlan-id ${ac.vlan}` });
      if (!ac.vpls && !ac.vlan) out.push({ path: u, leaf: "" });
    }
  }
  out.push({ path: ["interfaces", "lo0", "unit 0", "family inet"], leaf: `address ${HV_LO[r]}/32` }, { path: ["routing-options"], leaf: `router-id ${HV_LO[r]}` });
  for (const x of coreIfs(r)) out.push({ path: ["protocols", "mpls", `interface ${jnIf(x.ifn)}`], leaf: "" });
  for (const x of coreIfs(r).filter((y) => c.ldp[y.ifn])) out.push({ path: ["protocols", "ldp", `interface ${jnIf(x.ifn)}`], leaf: "" });
  if (c.ldpLo && isVpls(r)) out.push({ path: ["protocols", "ldp", "interface lo0.0"], leaf: "" });
  const bd = c.bd;
  if (bd) {
    const p = ["routing-instances", bd.name];
    out.push({ path: p, leaf: "instance-type vpls" });
    for (const k of bd.acs) out.push({ path: p, leaf: `interface ${k}` });
    const v = [...p, "protocols", "vpls"];
    out.push({ path: v, leaf: "no-tunnel-services" });
    if (bd.vplsId !== undefined) out.push({ path: v, leaf: `vpls-id ${bd.vplsId}` });
    if (bd.mtu !== 1500) out.push({ path: v, leaf: `mtu ${bd.mtu}` });
    for (const n of bd.mesh) out.push({ path: v, leaf: `neighbor ${n.ip}` });
    if (bd.spokeGroup) {
      const g = [...v, `mesh-group ${bd.spokeGroup.name}`];
      if (bd.spokeGroup.vplsId !== undefined) out.push({ path: g, leaf: `vpls-id ${bd.spokeGroup.vplsId}` });
      if (bd.spokeGroup.local) out.push({ path: g, leaf: "local-switching" });
      for (const n of bd.spokes) out.push({ path: g, leaf: `neighbor ${n.ip}` });
      if (bd.spokeGroup.vplsId === undefined && !bd.spokeGroup.local && !bd.spokes.length) out.push({ path: g, leaf: "" });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Configuration statements
// ---------------------------------------------------------------------------------------------------------------
const pOnly = "% Bridges and pseudowires live on the PE-rs and MTU-s; P1 only switches transport labels.";
function stmts(r: HvR, s: HvState): SpCfgStmt<HvCfg>[] {
  const vp = isVpls(r);
  const subX = subArg(s, r, false);
  const subJ = subArg(s, r, true);
  const pifX = pifArg(r, false);
  const pifJ = pifArg(r, true);
  const bdName = nameArg([s.cfg[r].bd?.name ?? "HVPLS-A"], "Bridge-domain / instance name");
  const grp = nameArg([s.cfg[r].bd?.group || "CUST-A"], "Bridge group name");
  const mgName = nameArg([s.cfg[r].bd?.spokeGroup?.name ?? "SPOKES"], "Mesh-group name");
  const ac = (c: HvCfg, k: string) => (c.acs[k] ??= { vpls: false });
  const newBd = (group: string, name: string): HvBd => ({ group, name, mtu: 1500, acs: [], vfi: false, mesh: [], spokes: [] });
  const bdOf = (c: HvCfg, x: Record<string, string>) => (c.bd && c.bd.name === x.n ? c.bd : undefined);
  const jbd = (c: HvCfg, v: string) => {
    if (!c.bd || c.bd.name !== v) c.bd = newBd("", v);
    return c.bd;
  };
  const jmg = (c: HvCfg, v: string, g: string) => {
    const b = jbd(c, v);
    if (!b.spokeGroup || b.spokeGroup.name !== g) b.spokeGroup = { name: g, local: false };
    return b.spokeGroup;
  };
  const mtuArg = numArg(64, 65535, ["1500", "9000"], "MTU signaled for every pseudowire");
  const put = (list: { ip: string; pwid?: number }[], ip: string, pwid?: number) => [...list.filter((n) => n.ip !== ip), { ip, pwid }];
  const hasCe = ceIfs(r).length > 0;
  const all: SpCfgStmt<HvCfg>[] = [
    // ---------------------------------------------------------------- IOS XR
    { id: "sub", summary: "Configure an attachment-circuit sub-interface", args: { sif: subX, l2: choiceArg(["l2transport"], () => "Layer 2 transport (an attachment circuit)") }, xr: { mode: "config", syntax: "interface <sif> <l2>", enter: "subif", apply: (c, a) => ((ac(c, a.sif).vpls = true), c), no: (c, a) => (delete c.acs[a.sif], c) } },
    { id: "sub-enc", summary: "The VLAN this attachment circuit accepts", args: { vlan: vlanArg }, xr: { mode: "subif", syntax: "encapsulation dot1q <vlan>", noSyntax: "encapsulation", apply: (c, a, x) => ((ac(c, x.sif).vlan = +a.vlan), c), no: (c, _a, x) => ((ac(c, x.sif).vlan = undefined), c) } },
    { id: "l2vpn", summary: "Layer 2 VPN services", xr: { mode: "config", syntax: "l2vpn", enter: "l2vpn", apply: (c) => (vp ? c : pOnly) } },
    { id: "bg", summary: "A bridge group", args: { g: grp }, xr: { mode: "l2vpn", syntax: "bridge group <g>", enter: "bg", apply: (c) => c, no: (c, a) => (c.bd?.group === a.g && (c.bd = undefined), c) } },
    { id: "bd", summary: "A bridge domain (this device's bridge for the service)", args: { n: bdName }, xr: { mode: "bg", syntax: "bridge-domain <n>", enter: "bd", apply: (c, a, x) => (c.bd && c.bd.name !== a.n ? "!!% This lab's devices carry one bridge domain; remove the existing one first." : ((c.bd ??= newBd(x.g, a.n)), c)), no: (c, a) => (c.bd?.name === a.n && (c.bd = undefined), c) } },
    { id: "bd-mtu", summary: "MTU signaled for the pseudowires", args: { m: mtuArg }, xr: { mode: "bd", syntax: "mtu <m>", noSyntax: "mtu", apply: (c, a, x) => (bdOf(c, x) && (bdOf(c, x)!.mtu = +a.m), c), no: (c, _a, x) => (bdOf(c, x) && (bdOf(c, x)!.mtu = 1500), c) } },
    { id: "bd-if", summary: "An attachment circuit of the bridge domain", args: { sif: subX }, xr: { mode: "bd", syntax: "interface <sif>", enter: "bd-ac", apply: (c, a, x) => { const b = bdOf(c, x); if (b && !b.acs.includes(a.sif)) b.acs.push(a.sif); return c; }, no: (c, a, x) => { const b = bdOf(c, x); if (b) b.acs = b.acs.filter((k) => k !== a.sif); return c; } } },
    { id: "bd-pw", summary: "An access pseudowire (a spoke: outside the VFI's split-horizon group)", args: { ip: nbrArg(spokeNbrs(r), "The other end's loopback"), id: pwidArg }, xr: { mode: "bd", syntax: "neighbor <ip> pw-id <id>", enter: "bd-pw", apply: (c, a, x) => { const b = bdOf(c, x); if (b) b.spokes = put(b.spokes, a.ip, +a.id); return c; }, no: (c, a, x) => { const b = bdOf(c, x); if (b) b.spokes = b.spokes.filter((n) => n.ip !== a.ip); return c; } } },
    { id: "vfi", summary: "The VFI: the core full mesh (one split-horizon group)", args: { vn: bdName }, xr: { mode: "bd", syntax: "vfi <vn>", enter: "vfi", apply: (c, _a, x) => (bdOf(c, x) && (bdOf(c, x)!.vfi = true), c), no: (c, _a, x) => (bdOf(c, x) && Object.assign(bdOf(c, x)!, { vfi: false, mesh: [] }), c) } },
    { id: "vfi-nbr", summary: "A core mesh pseudowire to another PE-rs", args: { ip: nbrArg(meshNbrs(r), "Another PE-rs loopback"), id: pwidArg }, xr: { mode: "vfi", syntax: "neighbor <ip> pw-id <id>", enter: "vfi-pw", apply: (c, a, x) => { const b = bdOf(c, x); if (b) b.mesh = put(b.mesh, a.ip, +a.id); return c; }, no: (c, a, x) => { const b = bdOf(c, x); if (b) b.mesh = b.mesh.filter((n) => n.ip !== a.ip); return c; } } },
    { id: "ldp", summary: "MPLS LDP", xr: { mode: "config", syntax: "mpls ldp", enter: "ldp", apply: (c) => c } },
    { id: "ldp-if", summary: "Run LDP on the interface", args: { pif: pifX }, xr: { mode: "ldp", syntax: "interface <pif>", enter: "ldp-if", apply: (c, a) => ((c.ldp[a.pif as IfName] = true), c), no: (c, a) => ((c.ldp[a.pif as IfName] = false), c) } },

    // ---------------------------------------------------------------- Junos
    { id: "j-enc", summary: "The unit carries VPLS (VLAN VPLS encapsulation)", args: { p: portArg(r), u: vlanArg, e: choiceArg(["vlan-vpls"], () => "VLAN VPLS encapsulation") }, junos: { syntax: "interfaces <p> unit <u> encapsulation <e>", set: (c, a) => ((ac(c, acKey(a.p, +a.u)).vpls = true), c), del: (c, a) => (c.acs[acKey(a.p, +a.u)] && (c.acs[acKey(a.p, +a.u)].vpls = false), c) } },
    { id: "j-vlan", summary: "The VLAN this unit accepts", args: { p: portArg(r), u: vlanArg, vlan: vlanArg }, junos: { syntax: "interfaces <p> unit <u> vlan-id <vlan>", set: (c, a) => ((ac(c, acKey(a.p, +a.u)).vlan = +a.vlan), c), del: (c, a) => (c.acs[acKey(a.p, +a.u)] && (c.acs[acKey(a.p, +a.u)].vlan = undefined), c) } },
    { id: "j-unit", summary: "A logical unit (delete removes it)", args: { p: portArg(r), u: vlanArg }, junos: { syntax: "interfaces <p> unit <u>", del: (c, a) => (delete c.acs[acKey(a.p, +a.u)], c) } },
    { id: "j-type", summary: "The instance type", args: { v: bdName, t: choiceArg(["vpls"], () => "Virtual private LAN service instance") }, junos: { syntax: "routing-instances <v> instance-type <t>", set: (c, a) => (vp ? (jbd(c, a.v), c) : `error: ${pOnly.slice(2)}`), del: (c) => c } },
    { id: "j-ri", summary: "The VPLS instance (delete removes it)", args: { v: bdName }, junos: { syntax: "routing-instances <v>", del: (c, a) => (c.bd?.name === a.v && (c.bd = undefined), c) } },
    { id: "j-if", summary: "An attachment circuit of the instance", args: { v: bdName, sif: subJ }, junos: { syntax: "routing-instances <v> interface <sif>", set: (c, a) => { const b = jbd(c, a.v); if (!b.acs.includes(a.sif)) b.acs.push(a.sif); return c; }, del: (c, a) => { if (c.bd) c.bd.acs = c.bd.acs.filter((k) => k !== a.sif); return c; } } },
    { id: "j-vid", summary: "The VPLS ID of the default mesh group", args: { v: bdName, id: pwidArg }, junos: { syntax: "routing-instances <v> protocols vpls vpls-id <id>", set: (c, a) => (vp ? ((jbd(c, a.v).vplsId = +a.id), c) : `error: ${pOnly.slice(2)}`), del: (c) => (c.bd && (c.bd.vplsId = undefined), c) } },
    { id: "j-nbr", summary: isPe(r) ? "A core mesh neighbor (the default mesh group)" : "The hub this MTU-s connects to", args: { v: bdName, ip: nbrArg([...meshNbrs(r), ...(isMtu(r) ? spokeNbrs(r) : [])], "A neighbor's loopback") }, junos: { syntax: "routing-instances <v> protocols vpls neighbor <ip>", set: (c, a) => { const b = jbd(c, a.v); b.mesh = put(b.mesh, a.ip); return c; }, del: (c, a) => { if (c.bd) c.bd.mesh = c.bd.mesh.filter((n) => n.ip !== a.ip); return c; } } },
    { id: "j-mg", summary: "A mesh group (delete removes it)", args: { v: bdName, g: mgName }, junos: { syntax: "routing-instances <v> protocols vpls mesh-group <g>", set: (c, a) => (jmg(c, a.v, a.g), c), del: (c, a) => (c.bd?.spokeGroup?.name === a.g && Object.assign(c.bd, { spokeGroup: undefined, spokes: [] }), c) } },
    { id: "j-mg-vid", summary: "The mesh group's VPLS ID", args: { v: bdName, g: mgName, id: pwidArg }, junos: { syntax: "routing-instances <v> protocols vpls mesh-group <g> vpls-id <id>", set: (c, a) => ((jmg(c, a.v, a.g).vplsId = +a.id), c), del: (c) => (c.bd?.spokeGroup && (c.bd.spokeGroup.vplsId = undefined), c) } },
    { id: "j-mg-nbr", summary: "A neighbor in the mesh group (a spoke)", args: { v: bdName, g: mgName, ip: nbrArg(spokeNbrs(r), "A spoke's loopback") }, junos: { syntax: "routing-instances <v> protocols vpls mesh-group <g> neighbor <ip>", set: (c, a) => { jmg(c, a.v, a.g); c.bd!.spokes = put(c.bd!.spokes, a.ip); return c; }, del: (c, a) => { if (c.bd) c.bd.spokes = c.bd.spokes.filter((n) => n.ip !== a.ip); return c; } } },
    { id: "j-mg-ls", summary: "Let the mesh group's members forward to each other", args: { v: bdName, g: mgName }, junos: { syntax: "routing-instances <v> protocols vpls mesh-group <g> local-switching", set: (c, a) => ((jmg(c, a.v, a.g).local = true), c), del: (c) => (c.bd?.spokeGroup && (c.bd.spokeGroup.local = false), c) } },
    { id: "j-mtu", summary: "MTU signaled for the pseudowires", args: { v: bdName, m: mtuArg }, junos: { syntax: "routing-instances <v> protocols vpls mtu <m>", set: (c, a) => ((jbd(c, a.v).mtu = +a.m), c), del: (c) => (c.bd && (c.bd.mtu = 1500), c) } },
    { id: "j-mtu-all", summary: "The signaled MTU (delete returns to 1500)", args: { v: bdName }, junos: { syntax: "routing-instances <v> protocols vpls mtu", del: (c) => (c.bd && (c.bd.mtu = 1500), c) } },
    { id: "j-nts", summary: "Use label-switched interfaces instead of a tunnel PIC", args: { v: bdName }, junos: { syntax: "routing-instances <v> protocols vpls no-tunnel-services", set: (c, a) => (jbd(c, a.v), c), del: (c) => c } },
    { id: "j-ldp", summary: "Run LDP on the interface (lo0.0 for targeted sessions)", args: { pif: pifJ }, junos: { syntax: "protocols ldp interface <pif>", set: (c, a) => (a.pif === "lo0" ? (c.ldpLo = true) : (c.ldp[a.pif as IfName] = true), c), del: (c, a) => (a.pif === "lo0" ? (c.ldpLo = false) : (c.ldp[a.pif as IfName] = false), c) } },
  ];
  // Attachment-circuit statements only where CEs are cabled (the MTU-s); bridge statements only on VPLS devices.
  const acIds = ["sub", "sub-enc", "bd-if", "j-enc", "j-vlan", "j-unit", "j-if"];
  const vplsIds = ["bg", "bd", "bd-mtu", "bd-pw", "vfi", "vfi-nbr", "j-ri", "j-nbr", "j-mg", "j-mg-vid", "j-mg-nbr", "j-mg-ls", "j-mtu", "j-mtu-all", "j-nts"];
  const meshIds = ["vfi", "vfi-nbr", "j-mg", "j-mg-vid", "j-mg-nbr", "j-mg-ls"];
  return all.filter((x) => (hasCe || !acIds.includes(x.id)) && (vp || !vplsIds.includes(x.id)) && (isPe(r) || !meshIds.includes(x.id)));
}

// ---------------------------------------------------------------------------------------------------------------
// Command sets
// ---------------------------------------------------------------------------------------------------------------
export function hvValidate(c: HvCfg, junos: boolean): string | undefined {
  if (junos && c.bd) {
    const bad = c.bd.acs.find((k) => c.acs[k] && !c.acs[k].vpls);
    if (bad) return `error: routing-instances ${c.bd.name}: interface ${bad} must use encapsulation vlan-vpls\nerror: configuration check-out failed`;
    const dup = c.bd.mesh.find((n) => c.bd!.spokes.some((x) => x.ip === n.ip));
    if (dup) return `error: routing-instances ${c.bd.name} protocols vpls: neighbor ${dup.ip} is configured in more than one mesh group\nerror: configuration check-out failed`;
  }
  return undefined;
}
export function hvXrSpec(api: HvCliApi, r: HvR): SpXrSpec<HvCfg> {
  const s = api.s;
  const sh = (id: string, syntax: string, summary: string, run: SpCmd["run"], args?: SpCmd["args"]): SpCmd => ({ id, syntax, summary, run, args });
  const nothing = (o: string, why: string) => o || { output: "", explanation: why };
  const none = isVpls(r) ? "No bridge domain configured." : "No bridge domains here: P1 carries no customer services.";
  return {
    stmts: stmts(r, s).filter((x) => x.xr),
    prompts: { config: "config", subif: "config-subif", l2vpn: "config-l2vpn", bg: "config-l2vpn-bg", bd: "config-l2vpn-bg-bd", "bd-ac": "config-l2vpn-bg-bd-ac", "bd-pw": "config-l2vpn-bg-bd-pw", vfi: "config-l2vpn-bg-bd-vfi", "vfi-pw": "config-l2vpn-bg-bd-vfi-pw", ldp: "config-ldp", "ldp-if": "config-ldp-if" },
    lines: (c) => hvXrLines(r, c),
    help: { "show l2vpn": "Layer 2 VPN information", "show l2vpn bridge-domain": "Bridge-domain information", "show l2vpn forwarding": "Forwarding information", "show mpls": "MPLS information", "show mpls ldp": "LDP information", "show route": "IP routing table", clear: "Clear functions", "clear l2vpn": "Clear Layer 2 VPN information" },
    shows: [
      sh("bd", "show l2vpn bridge-domain", "The bridge: attachment circuits, access PWs (spokes), the VFI (mesh)", () => nothing(xrBridgeDomain(s, r, false), none)),
      sh("bd-d", "show l2vpn bridge-domain detail", "In detail: VLANs, MTU, labels, split-horizon groups", () => nothing(xrBridgeDomain(s, r, true), none)),
      sh("mac", "show l2vpn forwarding bridge-domain mac-address location <loc>", "The MAC table: where each MAC was learned", () => nothing(xrMacTable(s, r), none), { loc: choiceArg(["0/0/CPU0"], () => "Line card") }),
      sh("disc", "show mpls ldp discovery", "Where LDP hellos go: interfaces and targeted neighbors", () => xrDiscovery(s, r)),
      sh("ldp", "show mpls ldp neighbor brief", "LDP sessions (link and targeted)", () => xrLdpBrief(s, r)),
      sh("fwd", "show mpls forwarding", "The label forwarding table (transport and pseudowire labels)", () => xrForwarding(s, r)),
      sh("route", "show route", "The global routing table (loopbacks via IS-IS)", () => xrRouteGlobal(s, r)),
      sh("log", "show logging", "The syslog buffer", () => xrLogging(s, r)),
    ],
    exec: [
      sh("clr", "clear l2vpn bridge-domain bd-name <n>", "Clear the bridge domain's MAC addresses", (a) => (isVpls(r) && s.cfg[r].bd?.name === a.n ? (api.act({ type: "clear", dev: r }), "") : `% Bridge domain ${a.n} not found`), { n: nameArg([s.cfg[r].bd?.name ?? "HVPLS-A"], "Bridge-domain name") }),
    ],
  };
}
export function hvJunosSpec(api: HvCliApi, r: HvR): SpJunosSpec<HvCfg> {
  const s = api.s;
  const sh = (id: string, syntax: string, summary: string, run: SpCmd["run"], args?: SpCmd["args"]): SpCmd => ({ id, syntax, summary, run, args });
  const nothing = (o: string, why: string) => o || { output: "", explanation: why };
  const none = isVpls(r) ? "No VPLS instance configured." : "No VPLS here: P1 carries no customer services.";
  const tblArg = choiceArg(["inet.3", "mpls.0"], (c) => (c === "inet.3" ? "LSPs to the loopbacks" : "Label forwarding (transport and VPLS labels)"));
  return {
    stmts: stmts(r, s).filter((x) => x.junos),
    jstmts: (c) => hvJnStmts(r, c),
    help: { "show vpls": "Show VPLS information", "show route": "Show routing table information", "show route table": "Name of the routing table", "show ldp": "Show LDP information", clear: "Clear information in the system", "clear vpls": "Clear VPLS information" },
    shows: [
      sh("con", "show vpls connections", "Every VPLS pseudowire by mesh group: status, labels", () => nothing(jnConnections(s, r), none)),
      sh("mac", "show vpls mac-table", "The MAC table: where each MAC was learned", () => nothing(jnMacTable(s, r), none)),
      sh("ldps", "show ldp session", "LDP sessions (link and targeted)", () => jnLdpSession(s, r)),
      sh("ldpn", "show ldp neighbor", "LDP neighbors and where their hellos arrive", () => jnLdpNeighbor(s, r)),
      sh("tbl", "show route table <t>", "inet.3 (LSPs) or mpls.0 (labels)", (a) => (a.t === "inet.3" ? jnInet3(s, r) : jnMpls0(s, r)), { t: tblArg }),
      sh("log", "show log messages", "The system log", () => nothing(jnLog(s, r), "No messages since the lab started.")),
    ],
    op: [
      sh("clr", "clear vpls mac-table instance <n>", "Clear the instance's MAC table", (a) => (isVpls(r) && s.cfg[r].bd?.name === a.n ? (api.act({ type: "clear", dev: r }), "") : `error: instance ${a.n} not found`), { n: nameArg([s.cfg[r].bd?.name ?? "HVPLS-A"], "VPLS instance") }),
    ],
  };
}
export function hvSets(api: HvCliApi, r: HvR): Partial<Record<CliVendor, CliCommandSet>> {
  return {
    cisco: buildXrSet({ ...api.dev, validate: (c) => hvValidate(c, false) }, hvXrSpec(api, r)),
    juniper: buildJunosSet({ ...api.dev, validate: (c) => hvValidate(c, true) }, hvJunosSpec(api, r)),
  };
}
export const hvPipe = (api: HvCliApi, r: HvR) => ({ config: junosPipeConfig(api.dev, { jstmts: (c: HvCfg) => hvJnStmts(r, c) }), rollbacks: api.dev.hist.length });
export function hvStaticApi(s: HvState, r: HvR): HvCliApi {
  return { s, act: () => s, dev: { host: r, running: s.cfg[r], hist: s.hist[r], setCand: () => undefined, xr: [], setXr: () => undefined, edit: false, setEdit: () => undefined, commit: () => undefined } };
}
export const hvClone = spClone;
export { HV_LINKS, pwidOf };
