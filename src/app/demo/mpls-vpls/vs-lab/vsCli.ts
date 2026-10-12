import type { CliArgSpec, CliCommandSet, CliVendor } from "@/lib/cli/types";
import { buildJunosSet, buildXrSet, choiceArg, junosPipeConfig, numArg, type SpCfgStmt, type SpCmd, type SpDevCli, type SpJunosSpec, type SpXrSpec } from "@/components/sp-lab/spCli";
import { lpad, pad, spAge, spClone, spStamp, type JStmt } from "@/components/sp-lab/spKit";
import { jnIf, parseIf, xrIf } from "@/components/sp-lab/spNames";
import { IMPLICIT_NULL, VS_LINKS, VS_LO, VS_PES, VS_ROUTERS, acKey, ceIfs, coreIfs, ldpLabel, pathBetween, peOfLo, pwidOf, type IfName, type VsAction, type VsBd, type VsCfg, type VsPw, type VsR, type VsState } from "@/lib/sim-engine/scenarios/vsNet";

/**
 * Command lines of the MPLS VPLS Lab — IOS XR or Junos on PE1–PE3 and P1–P3. Every output is printed from the lab model:
 * the bridge domain / VPLS instance with its attachment circuits and pseudowires, the MAC tables, targeted LDP, labels.
 *
 *   IOS XR  show l2vpn bridge-domain [detail] · show l2vpn forwarding bridge-domain mac-address location 0/0/CPU0 ·
 *           show mpls ldp discovery · show mpls ldp neighbor brief · show mpls forwarding · show route · show logging ·
 *           clear l2vpn bridge-domain bd-name <name>
 *           configure → interface <if>.<vlan> l2transport → encapsulation dot1q <vlan> · l2vpn → bridge group <g> →
 *           bridge-domain <name> → mtu <n> · interface <if>.<vlan> · vfi <name> → neighbor <ip> pw-id <id> ·
 *           mpls ldp → interface <if> · commit
 *   Junos   show vpls connections · show vpls mac-table · show ldp session · show ldp neighbor ·
 *           show route table inet.3 | mpls.0 · show log messages · clear vpls mac-table instance <name>
 *           configure → set interfaces <if> unit <u> encapsulation vlan-vpls | vlan-id <vlan> ·
 *           routing-instances <name> instance-type vpls | interface <if>.<u> | protocols vpls vpls-id <id> |
 *           neighbor <ip> | mtu <n> | no-tunnel-services · protocols ldp interface <if> · commit
 */

export interface VsCliApi {
  s: VsState;
  act: (a: VsAction) => VsState;
  dev: SpDevCli<VsCfg>;
}

// ---------------------------------------------------------------------------------------------------------------
// Names and arguments
// ---------------------------------------------------------------------------------------------------------------
const ipRe = /^(\d{1,3}\.){3}\d{1,3}$/;
const wordRe = /^[A-Za-z][\w-]{0,31}$/;
const isPe = (r: VsR) => VS_PES.includes(r);
export const xrSub = (k: string, short = false) => {
  const [ifn, u] = k.split(".");
  return `${xrIf(ifn, short)}.${u}`;
};
export function parseSub(raw: string): string | undefined {
  const m = /^(?:gigabitethernet|gi|gig)0\/0\/0\/([0-2])\.(\d{1,5})$/i.exec(raw) ?? /^ge-0\/0\/([0-2])\.(\d{1,5})$/i.exec(raw);
  if (!m || +m[2] < 1 || +m[2] > 4094) return undefined;
  return `ge-0/0/${m[1]}.${+m[2]}`;
}
const subArg = (s: VsState, r: VsR, junos: boolean): CliArgSpec => ({
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
const portArg = (r: VsR): CliArgSpec => ({ choices: ceIfs(r).map((x) => x.ifn), describe: (c) => `to ${ceIfs(r).find((x) => x.ifn === c)?.ce ?? "?"}`, resolve: (raw) => (ceIfs(r).some((x) => x.ifn === raw) ? raw : undefined) });
const pifArg = (r: VsR, junos: boolean): CliArgSpec => ({
  choices: [...coreIfs(r).map((x) => (junos ? jnIf(x.ifn) : xrIf(x.ifn))), ...(junos && isPe(r) ? ["lo0.0"] : [])],
  describe: (c) => {
    const i = parseIf(c);
    return i === "lo0" ? "the loopback (targeted sessions)" : `to ${coreIfs(r).find((x) => x.ifn === i)?.peer ?? "?"}`;
  },
  resolve: (raw) => {
    const i = parseIf(raw);
    return i && (coreIfs(r).some((x) => x.ifn === i) || (junos && i === "lo0")) ? i : undefined;
  },
});
const nbrArg = (r: VsR): CliArgSpec => ({ choices: VS_PES.filter((p) => p !== r).map((p) => VS_LO[p]), describe: () => "Another PE's loopback", resolve: (raw) => (ipRe.test(raw) ? raw : undefined) });
const pwidArg = numArg(1, 4294967295, ["500"], "Pseudowire ID (the same on every PE of the VPLS)");
const vlanArg = numArg(1, 4094, ["100"], "VLAN ID");
const nameArg = (names: string[], what: string): CliArgSpec => ({ choices: names, describe: () => what, resolve: (raw) => (wordRe.test(raw) ? raw : undefined) });

// ---------------------------------------------------------------------------------------------------------------
// IOS XR outputs
// ---------------------------------------------------------------------------------------------------------------
const pwsOf = (s: VsState, r: VsR) => s.view.pws.filter((p) => p.pe === r);
function xrBridgeDomain(s: VsState, r: VsR, detail: boolean): string {
  const bd = s.cfg[r].bd;
  if (!isPe(r) || !bd) return "";
  const acs = bd.acs.map((k) => ({ k, up: !!s.cfg[r].acs[k] }));
  const pws = bd.vfi ? pwsOf(s, r) : [];
  const up = pws.filter((p) => p.up).length;
  const out = [
    "Legend: pp = Partially Programmed.",
    `Bridge group: ${bd.group}, bridge-domain: ${bd.name}, id: 0, state: up, ShgId: 0, MSTi: 0`,
    "  Aging: 300 s, MAC limit: 64000, Action: none, Notification: syslog",
    "  Filter MAC addresses: 0",
    `  ACs: ${acs.length} (${acs.filter((a) => a.up).length} up), VFIs: ${bd.vfi ? 1 : 0}, PWs: ${pws.length} (${up} up), PBBs: 0 (0 up), VNIs: 0 (0 up)`,
  ];
  if (!detail) {
    out.push("  List of ACs:", ...acs.map((a) => `    ${xrSub(a.k, true)}, state: ${a.up ? "up" : "unresolved"}, Static MAC addresses: 0`), "  List of Access PWs:", "  List of VFIs:");
    if (bd.vfi) out.push(`    VFI ${bd.name} (${up ? "up" : "down"})`, ...pws.map((p) => `      Neighbor ${p.ip} pw-id ${p.pwid ?? "-"}, state: ${p.up ? "up" : "down"}, Static MAC addresses: 0`));
    out.push("  List of Access VFIs:");
    return out.join("\n");
  }
  out.push(`  MTU: ${bd.mtu}`, "  List of ACs:");
  for (const a of acs) {
    const ac = s.cfg[r].acs[a.k];
    out.push(`    AC: ${xrSub(a.k)}, state is ${a.up ? "up" : "unresolved"}`, ...(ac ? ["      Type VLAN; Num Ranges: 1", `      VLAN ranges: ${ac.vlan ? `[${ac.vlan}, ${ac.vlan}]` : "none"}`, `      MTU ${bd.mtu}; XC ID 0x10800${String(bd.acs.indexOf(a.k) + 1).padStart(2, "0")}; interworking none`] : []), "      Split Horizon Group: none");
  }
  out.push("  List of VFIs:");
  if (bd.vfi) {
    out.push(`    VFI ${bd.name} (${up ? "up" : "down"})`);
    for (const p of pws) {
      const col = (a: string | number, b: string | number) => `${pad(a, 44)}${b}`;
      out.push(
        `      PW: neighbor ${p.ip}, PW ID ${p.pwid ?? "-"}, state is ${p.up ? "up ( established )" : "down ( local ready )"}`,
        "        Encapsulation MPLS, protocol LDP",
        `        Source address ${VS_LO[r]}`,
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
      );
    }
  }
  return out.join("\n");
}
const xrMac = (m: string) => m.replace(/:/g, "").replace(/(....)(....)(....)/, "$1.$2.$3");
function xrMacTable(s: VsState, r: VsR): string {
  if (!isPe(r)) return "";
  const bd = s.cfg[r].bd;
  const rows = s.fdb[r].map((m) => {
    const port = m.port.startsWith("pw:") ? `(${m.port.slice(3)}, ${bd ? (pwidOf(s.os, bd, bd.nbrs.find((n) => n.ip === m.port.slice(3)) ?? {}) ?? "-") : "-"})` : xrSub(m.port, true);
    return `${pad(xrMac(m.mac), 15)}${pad("dynamic", 8)}${pad(port, 28)}${pad("N/A", 11)}${pad(`11 Oct ${spStamp(m.t).hms}`, 23)}N/A`;
  });
  return ["To Resynchronize MAC table from the Network Processors, use the command...", "    l2vpn resynchronize forwarding mac-address-table location <r/s/i>", "", "Mac Address    Type    Learned from/Filtered on    LC learned Resync Age/Last Change Mapped to", "-------------- ------- --------------------------- ---------- ---------------------- --------------", ...rows].join("\n");
}
function xrDiscovery(s: VsState, r: VsR): string {
  const ifs = coreIfs(r).filter((x) => s.cfg[r].ldp[x.ifn]).flatMap((x) => {
    const up = s.view.ldp[x.link.id];
    return [`    ${xrIf(x.ifn)} : xmit${up ? "/recv" : ""}`, "      VRF: 'default' (0x60000000)", ...(up ? [`      LDP Id: ${VS_LO[x.peer]}:0, Transport address: ${VS_LO[x.peer]}`, "          Hold time: 15 sec (local:15 sec, peer:15 sec)"] : [])];
  });
  const tgt = (s.cfg[r].bd?.vfi ? s.cfg[r].bd!.nbrs.map((n) => n.ip) : []).flatMap((ip) => {
    const peer = peOfLo(ip);
    const ok = !!peer && !!s.view.tldp[[r, peer].sort().join("-")];
    return [`    ${VS_LO[r]} -> ${ip} (active${ok ? "/passive" : ""}), xmit${ok ? "/recv" : ""}`, ...(ok ? [`      LDP Id: ${ip}:0`, "          Hold time: 90 sec (local:90 sec, peer:90 sec)"] : [])];
  });
  return [`Local LDP Identifier: ${VS_LO[r]}:0`, "Discovery Sources:", "  Interfaces:", ...ifs, ...(tgt.length ? ["", "  Targeted Hellos:", ...tgt] : [])].join("\n");
}
const tSessions = (s: VsState, r: VsR) => (isPe(r) ? VS_PES.filter((p) => p !== r && s.view.tldp[[r, p].sort().join("-")]) : []);
function xrLdpBrief(s: VsState, r: VsR): string {
  const row = (lo: string) => `${pad(`${lo}:0`, 18)}${pad("Y", 4)}${pad(spAge(s.clock, 20), 10)}${lpad(1, 6)}${lpad(4, 9)}${lpad(1, 7)}${lpad(6, 6)}`;
  const rows = [...coreIfs(r).filter((x) => s.view.ldp[x.link.id]).map((x) => row(VS_LO[x.peer])), ...tSessions(s, r).map((p) => row(VS_LO[p]))];
  return ["Peer              GR  Up Time         Discovery   Addresses     Labels", "                                      ipv4  ipv6  ipv4  ipv6  ipv4   ipv6", "----------------- --  --------------- ----- ----  ----- ----  ------ ----", ...rows].join("\n");
}
const lab = (n: number | undefined) => (n === undefined ? "Unlabelled" : n === IMPLICIT_NULL ? "Pop" : String(n));
function transportRows(s: VsState, r: VsR) {
  return VS_PES.filter((p) => p !== r).flatMap((p) => {
    const fec = VS_LO[p];
    const t = s.view.lsp[r][fec];
    if (!t?.nh) return [];
    const x = coreIfs(r).find((y) => y.peer === t.nh)!;
    return [{ fec, local: ldpLabel(s.os, r, fec), out: t.out, ifn: x.ifn, nh: x.peerIp }];
  });
}
function xrForwarding(s: VsState, r: VsR): string {
  const rows = transportRows(s, r).map((t) => `${pad(t.local, 7)}${pad(lab(t.out), 12)}${pad(`${t.fec}/32`, 19)}${pad(xrIf(t.ifn, true), 13)}${pad(t.nh, 16)}0`);
  for (const p of pwsOf(s, r).filter((x) => x.up)) rows.push(`${pad(p.local!, 7)}${pad("Pop", 12)}${pad(`PW(${p.ip}:${p.pwid})`, 19)}${pad(`BD=0`, 13)}${pad("point2point", 16)}0`);
  return ["Local  Outgoing    Prefix             Outgoing     Next Hop        Bytes", "Label  Label       or ID              Interface                    Switched", "------ ----------- ------------------ ------------ --------------- ------------", ...rows].join("\n");
}
function xrRouteGlobal(s: VsState, r: VsR): string {
  const rows = VS_ROUTERS.map((n) => {
    if (n === r) return `L    ${pad(`${VS_LO[n]}/32`, 18)} is directly connected, ${spAge(s.clock, 30)}, Loopback0`;
    const path = pathBetween(r, n);
    const x = coreIfs(r).find((y) => y.peer === path[1])!;
    return `i L2 ${pad(`${VS_LO[n]}/32`, 18)} [115/${10 * (path.length - 1) + 10}] via ${x.peerIp}, ${spAge(s.clock, 30)}, ${xrIf(x.ifn)}`;
  });
  return ["Codes: C - connected, S - static, B - BGP, i - ISIS, L1 - IS-IS level-1, L2 - IS-IS level-2", "       L - local", "", "Gateway of last resort is not set", "", ...rows].join("\n");
}
function xrLogging(s: VsState, r: VsR): string {
  const lines = s.sys.filter((x) => x.dev === r).slice(-30).map((x) => {
    const st = `RP/0/RP0/CPU0:${spStamp(x.t).xr}`;
    if (x.kind === "ldp-up") return `${st}: mpls_ldp[1159]: %ROUTING-LDP-5-NBR_CHANGE : VRF 'default' (0x60000000), Neighbor ${x.peer}:0 is UP`;
    if (x.kind === "ldp-down") return `${st}: mpls_ldp[1159]: %ROUTING-LDP-5-NBR_CHANGE : VRF 'default' (0x60000000), Neighbor ${x.peer}:0 is DOWN (Interface state down)`;
    if (x.kind === "pw-up") return `${st}: l2vpn_mgr[1234]: %L2-L2VPN_PW-3-UPDOWN : Pseudowire with address ${x.peer}, id ${x.pwid}, state is Up`;
    if (x.kind === "pw-down") return `${st}: l2vpn_mgr[1234]: %L2-L2VPN_PW-3-UPDOWN : Pseudowire with address ${x.peer}, id ${x.pwid}, state is Down`;
    if (x.kind === "clear") return `${st}: l2vpn_mgr[1234]: bridge-domain VPLS-A: MAC addresses cleared by user 'admin'`;
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
const lsi = (p: VsPw) => `lsi.10488${String(30 + (p.peer ? VS_PES.indexOf(p.peer) : 9)).padStart(2, "0")}`;
function jnSt(p: VsPw): string {
  if (p.up) return "Up";
  return p.why === "mtu" ? "MM" : p.why === "nolsp" ? "VC-Dn" : "OL";
}
function jnConnections(s: VsState, r: VsR): string {
  const bd = s.cfg[r].bd;
  if (!isPe(r) || !bd) return "";
  const out = [...JN_LEGEND, `Instance: ${bd.name}`, `  VPLS-id: ${bd.vplsId ?? "none"}`, "    Neighbor                  Type  St     Time last up          # Up trans"];
  for (const p of pwsOf(s, r)) {
    const ups = s.sys.filter((x) => x.dev === r && x.kind === "pw-up" && x.peer === p.ip);
    out.push(`    ${pad(`${p.ip}(vpls-id ${p.pwid ?? "-"})`, 26)}${pad("rmt", 6)}${pad(jnSt(p), 7)}${pad(p.up ? `${spStamp(ups.at(-1)?.t ?? 32).junos} 2026` : "-----", 22)}${lpad(ups.length, 10)}`);
    if (p.up || p.remote) out.push(`      Remote PE: ${p.ip}, Negotiated control-word: No`);
    out.push(`      Incoming label: ${p.local ?? ""}, Outgoing label: ${p.remote?.label ?? ""}`.trimEnd());
    if (p.up) out.push("      Negotiated PW status TLV: No", `      Local interface: ${lsi(p)}, Status: Up, Encapsulation: ETHERNET`, `        Description: Intf - vpls ${bd.name} neighbor ${p.ip} vpls-id ${p.pwid}`);
  }
  return out.join("\n");
}
function jnMacTable(s: VsState, r: VsR): string {
  const bd = s.cfg[r].bd;
  if (!isPe(r) || !bd) return "";
  const rows = s.fdb[r].map((m) => {
    const p = m.port.startsWith("pw:") ? pwsOf(s, r).find((x) => x.ip === m.port.slice(3)) : undefined;
    return `   ${pad(m.mac, 20)}${pad("D", 9)}${m.port.startsWith("pw:") ? (p ? lsi(p) : "lsi.?") : m.port}`;
  });
  return ["", "MAC flags       (S -static MAC, D -dynamic MAC, L -locally learned, C -Control MAC", "    O -OVSDB MAC, SE -Statistics enabled, NM -Non configured MAC, R -Remote PE MAC, P -Pinned MAC)", "", `Routing instance : ${bd.name}`, ` Bridging domain : __${bd.name}__, VLAN : NA`, "   MAC                 MAC      Logical          NH     MAC         active", "   address             flags    interface        Index  property    source", ...rows].join("\n");
}
function jnLdpSession(s: VsState, r: VsR): string {
  const row = (lo: string, hold: number) => `${pad(lo, 21)}${pad("Operational", 14)}${pad("Open", 13)}${lpad(hold, 5)}         DU`;
  return ["  Address              State        Connection  Hold time  Adv. Mode", ...coreIfs(r).filter((x) => s.view.ldp[x.link.id]).map((x) => row(VS_LO[x.peer], 28)), ...tSessions(s, r).map((p) => row(VS_LO[p], 25))].join("\n");
}
function jnLdpNeighbor(s: VsState, r: VsR): string {
  const rows = [...coreIfs(r).filter((x) => s.view.ldp[x.link.id]).map((x) => `${pad(x.peerIp, 36)}${pad(jnIf(x.ifn), 16)}${pad(`${VS_LO[x.peer]}:0`, 21)}13`), ...tSessions(s, r).map((p) => `${pad(VS_LO[p], 36)}${pad("lo0.0", 16)}${pad(`${VS_LO[p]}:0`, 21)}43`)];
  return ["Address                             Interface       Label space ID     Hold time", ...rows].join("\n");
}
function jnInet3(s: VsState, r: VsR): string {
  const rows = transportRows(s, r).filter((t) => t.out !== undefined).map((t) => [`${pad(`${t.fec}/32`, 19)}*[LDP/9] ${spAge(s.clock, 20)}, metric 1`, `                    >  to ${t.nh} via ${jnIf(t.ifn)}${t.out === IMPLICIT_NULL ? "" : `, Push ${t.out}`}`]);
  const n = rows.length;
  return [`inet.3: ${n} destinations, ${n} routes (${n} active, 0 holddown, 0 hidden)`, ...(n ? ["+ = Active Route, - = Last Active, * = Both", "", ...rows.flat()] : [])].join("\n");
}
function jnMpls0(s: VsState, r: VsR): string {
  const rows: string[][] = [["0                  *[MPLS/0] 01:00:00, metric 1", "                       to table inet.0"]];
  for (const t of transportRows(s, r).filter((x) => x.out !== undefined)) rows.push([`${pad(t.local, 19)}*[LDP/9] ${spAge(s.clock, 20)}, metric 1`, `                    >  to ${t.nh} via ${jnIf(t.ifn)}, ${t.out === IMPLICIT_NULL ? "Pop" : `Swap ${t.out}`}`]);
  for (const p of pwsOf(s, r).filter((x) => x.up)) rows.push([`${pad(p.local!, 19)}*[VPLS/7] ${spAge(s.clock, 32)}`, `                    >  via ${lsi(p)}, Pop`]);
  return [`mpls.0: ${rows.length} destinations, ${rows.length} routes (${rows.length} active, 0 holddown, 0 hidden)`, "+ = Active Route, - = Last Active, * = Both", "", ...rows.flat()].join("\n");
}
function jnLog(s: VsState, r: VsR): string {
  return s.sys.filter((x) => x.dev === r).slice(-30).map((x) => {
    const st = `${spStamp(x.t).junos}  ${r}`;
    if (x.kind === "ldp-up") return `${st} rpd[1532]: RPD_LDP_NBRUP: LDP neighbor ${x.peer} (${x.peer}) is up`;
    if (x.kind === "ldp-down") return `${st} rpd[1532]: RPD_LDP_NBRDOWN: LDP neighbor ${x.peer} (${x.peer}) is down`;
    if (x.kind === "pw-up") return `${st} rpd[1532]: RPD_VPLS_INTF_UP: VPLS-A: VPLS interface to neighbor ${x.peer} is up`;
    if (x.kind === "pw-down") return `${st} rpd[1532]: RPD_VPLS_INTF_DOWN: VPLS-A: VPLS interface to neighbor ${x.peer} is down`;
    if (x.kind === "clear") return `${st} mgd[4417]: UI_CMDLINE_READ_LINE: User 'admin', command 'clear vpls mac-table instance VPLS-A'`;
    return `${st} mgd[4417]: UI_COMMIT: User 'admin' requested 'commit' operation (comment: none)`;
  }).join("\n");
}

// ---------------------------------------------------------------------------------------------------------------
// Configuration as each OS prints it
// ---------------------------------------------------------------------------------------------------------------
export function vsXrLines(r: VsR, c: VsCfg): string[] {
  const out: string[] = [`hostname ${r}`, "!", "interface Loopback0", ` ipv4 address ${VS_LO[r]} 255.255.255.255`, "!"];
  for (const x of coreIfs(r)) out.push(`interface ${xrIf(x.ifn)}`, ` description to ${x.peer}`, ` ipv4 address ${x.ip} 255.255.255.254`, "!");
  for (const x of ceIfs(r)) out.push(`interface ${xrIf(x.ifn)}`, ` description to ${x.ce}`, "!");
  for (const [k, ac] of Object.entries(c.acs).sort(([a], [b]) => a.localeCompare(b))) out.push(`interface ${xrSub(k)} l2transport`, ...(ac.vlan ? [` encapsulation dot1q ${ac.vlan}`] : []), "!");
  out.push("router isis CORE", ` net 49.0001.0000.0000.000${VS_ROUTERS.indexOf(r) + 1}.00`, " address-family ipv4 unicast", "  metric-style wide", " !", "!");
  const bd = c.bd;
  if (bd) {
    out.push("l2vpn", ` bridge group ${bd.group}`, `  bridge-domain ${bd.name}`, ...(bd.mtu !== 1500 ? [`   mtu ${bd.mtu}`] : []));
    for (const k of bd.acs) out.push(`   interface ${xrSub(k)}`, "   !");
    if (bd.vfi) {
      out.push(`   vfi ${bd.name}`);
      for (const n of bd.nbrs) out.push(`    neighbor ${n.ip} pw-id ${n.pwid ?? "-"}`, "    !");
      out.push("   !");
    }
    out.push("  !", " !", "!");
  }
  out.push("mpls ldp", ` router-id ${VS_LO[r]}`, ...coreIfs(r).filter((x) => c.ldp[x.ifn]).flatMap((x) => [` interface ${xrIf(x.ifn)}`, " !"]), "!");
  return out;
}
export function vsJnStmts(r: VsR, c: VsCfg): JStmt[] {
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
  out.push({ path: ["interfaces", "lo0", "unit 0", "family inet"], leaf: `address ${VS_LO[r]}/32` }, { path: ["routing-options"], leaf: `router-id ${VS_LO[r]}` });
  for (const x of coreIfs(r)) out.push({ path: ["protocols", "mpls", `interface ${jnIf(x.ifn)}`], leaf: "" });
  for (const x of coreIfs(r).filter((y) => c.ldp[y.ifn])) out.push({ path: ["protocols", "ldp", `interface ${jnIf(x.ifn)}`], leaf: "" });
  if (c.ldpLo && isPe(r)) out.push({ path: ["protocols", "ldp", "interface lo0.0"], leaf: "" });
  const bd = c.bd;
  if (bd) {
    const p = ["routing-instances", bd.name];
    out.push({ path: p, leaf: "instance-type vpls" });
    for (const k of bd.acs) out.push({ path: p, leaf: `interface ${k}` });
    const v = [...p, "protocols", "vpls"];
    out.push({ path: v, leaf: "no-tunnel-services" });
    if (bd.vplsId !== undefined) out.push({ path: v, leaf: `vpls-id ${bd.vplsId}` });
    if (bd.mtu !== 1500) out.push({ path: v, leaf: `mtu ${bd.mtu}` });
    for (const n of bd.nbrs) out.push({ path: v, leaf: `neighbor ${n.ip}` });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Configuration statements
// ---------------------------------------------------------------------------------------------------------------
const peOnly = "% Bridge domains and pseudowires live on the PEs; this P router only switches transport labels.";
function stmts(r: VsR, s: VsState): SpCfgStmt<VsCfg>[] {
  const pe = isPe(r);
  const subX = subArg(s, r, false);
  const subJ = subArg(s, r, true);
  const pifX = pifArg(r, false);
  const pifJ = pifArg(r, true);
  const bdName = nameArg([s.cfg[r].bd?.name ?? "VPLS-A"], "Bridge-domain / instance name");
  const grp = nameArg([s.cfg[r].bd?.group || "CUST-A"], "Bridge group name");
  const ac = (c: VsCfg, k: string) => (c.acs[k] ??= { vpls: false });
  const newBd = (group: string, name: string): VsBd => ({ group, name, mtu: 1500, acs: [], nbrs: [], vfi: false });
  const bdOf = (c: VsCfg, x: Record<string, string>) => (c.bd && c.bd.name === x.n ? c.bd : undefined);
  const jbd = (c: VsCfg, v: string) => {
    if (!c.bd || c.bd.name !== v) c.bd = { ...newBd("", v), vfi: true };
    return c.bd;
  };
  const mtuArg = numArg(64, 65535, ["1500", "9000"], "MTU signaled for every pseudowire");
  return [
    // ---------------------------------------------------------------- IOS XR
    { id: "sub", summary: "Configure an attachment-circuit sub-interface", args: { sif: subX, l2: choiceArg(["l2transport"], () => "Layer 2 transport (an attachment circuit)") }, xr: { mode: "config", syntax: "interface <sif> <l2>", enter: "subif", apply: (c, a) => (pe ? (ac(c, a.sif), (c.acs[a.sif].vpls = true), c) : peOnly), no: (c, a) => (delete c.acs[a.sif], c) } },
    { id: "sub-enc", summary: "The VLAN this attachment circuit accepts", args: { vlan: vlanArg }, xr: { mode: "subif", syntax: "encapsulation dot1q <vlan>", noSyntax: "encapsulation", apply: (c, a, x) => ((ac(c, x.sif).vlan = +a.vlan), c), no: (c, _a, x) => ((ac(c, x.sif).vlan = undefined), c) } },
    { id: "l2vpn", summary: "Layer 2 VPN services", xr: { mode: "config", syntax: "l2vpn", enter: "l2vpn", apply: (c) => (pe ? c : peOnly) } },
    { id: "bg", summary: "A bridge group", args: { g: grp }, xr: { mode: "l2vpn", syntax: "bridge group <g>", enter: "bg", apply: (c) => c, no: (c, a) => (c.bd?.group === a.g && (c.bd = undefined), c) } },
    { id: "bd", summary: "A bridge domain (the VPLS bridge on this PE)", args: { n: bdName }, xr: { mode: "bg", syntax: "bridge-domain <n>", enter: "bd", apply: (c, a, x) => (c.bd && c.bd.name !== a.n ? "!!% This lab's PEs carry one bridge domain; remove the existing one first." : ((c.bd ??= newBd(x.g, a.n)), c)), no: (c, a) => (c.bd?.name === a.n && (c.bd = undefined), c) } },
    { id: "bd-mtu", summary: "MTU signaled for the pseudowires", args: { m: mtuArg }, xr: { mode: "bd", syntax: "mtu <m>", noSyntax: "mtu", apply: (c, a, x) => (bdOf(c, x) && (bdOf(c, x)!.mtu = +a.m), c), no: (c, _a, x) => (bdOf(c, x) && (bdOf(c, x)!.mtu = 1500), c) } },
    { id: "bd-if", summary: "An attachment circuit of the bridge domain", args: { sif: subX }, xr: { mode: "bd", syntax: "interface <sif>", enter: "bd-ac", apply: (c, a, x) => { const b = bdOf(c, x); if (b && !b.acs.includes(a.sif)) b.acs.push(a.sif); return c; }, no: (c, a, x) => { const b = bdOf(c, x); if (b) b.acs = b.acs.filter((k) => k !== a.sif); return c; } } },
    { id: "vfi", summary: "The VFI: the bridge domain's full-mesh pseudowires", args: { vn: bdName }, xr: { mode: "bd", syntax: "vfi <vn>", enter: "vfi", apply: (c, _a, x) => (bdOf(c, x) && (bdOf(c, x)!.vfi = true), c), no: (c, _a, x) => (bdOf(c, x) && Object.assign(bdOf(c, x)!, { vfi: false, nbrs: [] }), c) } },
    { id: "vfi-nbr", summary: "A pseudowire to another PE of the VPLS", args: { ip: nbrArg(r), id: pwidArg }, xr: { mode: "vfi", syntax: "neighbor <ip> pw-id <id>", enter: "vfi-pw", apply: (c, a, x) => { const b = bdOf(c, x); if (b) b.nbrs = [...b.nbrs.filter((n) => n.ip !== a.ip), { ip: a.ip, pwid: +a.id }]; return c; }, no: (c, a, x) => { const b = bdOf(c, x); if (b) b.nbrs = b.nbrs.filter((n) => n.ip !== a.ip); return c; } } },
    { id: "ldp", summary: "MPLS LDP", xr: { mode: "config", syntax: "mpls ldp", enter: "ldp", apply: (c) => c } },
    { id: "ldp-if", summary: "Run LDP on the interface", args: { pif: pifX }, xr: { mode: "ldp", syntax: "interface <pif>", enter: "ldp-if", apply: (c, a) => ((c.ldp[a.pif as IfName] = true), c), no: (c, a) => ((c.ldp[a.pif as IfName] = false), c) } },

    // ---------------------------------------------------------------- Junos
    { id: "j-enc", summary: "The unit carries VPLS (VLAN VPLS encapsulation)", args: { p: portArg(r), u: vlanArg, e: choiceArg(["vlan-vpls"], () => "VLAN VPLS encapsulation") }, junos: { syntax: "interfaces <p> unit <u> encapsulation <e>", set: (c, a) => (pe ? ((ac(c, acKey(a.p, +a.u)).vpls = true), c) : `error: ${peOnly.slice(2)}`), del: (c, a) => (c.acs[acKey(a.p, +a.u)] && (c.acs[acKey(a.p, +a.u)].vpls = false), c) } },
    { id: "j-vlan", summary: "The VLAN this unit accepts", args: { p: portArg(r), u: vlanArg, vlan: vlanArg }, junos: { syntax: "interfaces <p> unit <u> vlan-id <vlan>", set: (c, a) => (pe ? ((ac(c, acKey(a.p, +a.u)).vlan = +a.vlan), c) : `error: ${peOnly.slice(2)}`), del: (c, a) => (c.acs[acKey(a.p, +a.u)] && (c.acs[acKey(a.p, +a.u)].vlan = undefined), c) } },
    { id: "j-unit", summary: "A logical unit (delete removes it)", args: { p: portArg(r), u: vlanArg }, junos: { syntax: "interfaces <p> unit <u>", del: (c, a) => (delete c.acs[acKey(a.p, +a.u)], c) } },
    { id: "j-type", summary: "The instance type", args: { v: bdName, t: choiceArg(["vpls"], () => "Virtual private LAN service instance") }, junos: { syntax: "routing-instances <v> instance-type <t>", set: (c, a) => (pe ? (jbd(c, a.v), c) : `error: ${peOnly.slice(2)}`), del: (c) => c } },
    { id: "j-ri", summary: "The VPLS instance (delete removes it)", args: { v: bdName }, junos: { syntax: "routing-instances <v>", del: (c, a) => (c.bd?.name === a.v && (c.bd = undefined), c) } },
    { id: "j-if", summary: "An attachment circuit of the instance", args: { v: bdName, sif: subJ }, junos: { syntax: "routing-instances <v> interface <sif>", set: (c, a) => { const b = jbd(c, a.v); if (!b.acs.includes(a.sif)) b.acs.push(a.sif); return c; }, del: (c, a) => { if (c.bd) c.bd.acs = c.bd.acs.filter((k) => k !== a.sif); return c; } } },
    { id: "j-vid", summary: "The VPLS ID (the PW ID of every pseudowire)", args: { v: bdName, id: pwidArg }, junos: { syntax: "routing-instances <v> protocols vpls vpls-id <id>", set: (c, a) => ((jbd(c, a.v).vplsId = +a.id), c), del: (c) => (c.bd && (c.bd.vplsId = undefined), c) } },
    { id: "j-nbr", summary: "A pseudowire to another PE of the VPLS", args: { v: bdName, ip: nbrArg(r) }, junos: { syntax: "routing-instances <v> protocols vpls neighbor <ip>", set: (c, a) => { const b = jbd(c, a.v); if (!b.nbrs.some((n) => n.ip === a.ip)) b.nbrs.push({ ip: a.ip }); return c; }, del: (c, a) => { if (c.bd) c.bd.nbrs = c.bd.nbrs.filter((n) => n.ip !== a.ip); return c; } } },
    { id: "j-mtu", summary: "MTU signaled for the pseudowires", args: { v: bdName, m: mtuArg }, junos: { syntax: "routing-instances <v> protocols vpls mtu <m>", set: (c, a) => ((jbd(c, a.v).mtu = +a.m), c), del: (c) => (c.bd && (c.bd.mtu = 1500), c) } },
    { id: "j-mtu-all", summary: "The signaled MTU (delete returns to 1500)", args: { v: bdName }, junos: { syntax: "routing-instances <v> protocols vpls mtu", del: (c) => (c.bd && (c.bd.mtu = 1500), c) } },
    { id: "j-nts", summary: "Use label-switched interfaces instead of a tunnel PIC", args: { v: bdName }, junos: { syntax: "routing-instances <v> protocols vpls no-tunnel-services", set: (c, a) => (jbd(c, a.v), c), del: (c) => c } },
    { id: "j-ldp", summary: "Run LDP on the interface (lo0.0 for targeted sessions)", args: { pif: pifJ }, junos: { syntax: "protocols ldp interface <pif>", set: (c, a) => (a.pif === "lo0" ? (c.ldpLo = true) : (c.ldp[a.pif as IfName] = true), c), del: (c, a) => (a.pif === "lo0" ? (c.ldpLo = false) : (c.ldp[a.pif as IfName] = false), c) } },
  ];
}

// ---------------------------------------------------------------------------------------------------------------
// Command sets
// ---------------------------------------------------------------------------------------------------------------
export function vsValidate(c: VsCfg, junos: boolean): string | undefined {
  if (junos && c.bd) {
    const bad = c.bd.acs.find((k) => c.acs[k] && !c.acs[k].vpls);
    if (bad) return `error: routing-instances ${c.bd.name}: interface ${bad} must use encapsulation vlan-vpls\nerror: configuration check-out failed`;
  }
  return undefined;
}
export function vsXrSpec(api: VsCliApi, r: VsR): SpXrSpec<VsCfg> {
  const s = api.s;
  const sh = (id: string, syntax: string, summary: string, run: SpCmd["run"], args?: SpCmd["args"]): SpCmd => ({ id, syntax, summary, run, args });
  const nothing = (o: string, why: string) => o || { output: "", explanation: why };
  const none = isPe(r) ? "No bridge domain configured." : "No bridge domains here: P routers carry no customer services.";
  return {
    stmts: stmts(r, s).filter((x) => x.xr),
    prompts: { config: "config", subif: "config-subif", l2vpn: "config-l2vpn", bg: "config-l2vpn-bg", bd: "config-l2vpn-bg-bd", "bd-ac": "config-l2vpn-bg-bd-ac", vfi: "config-l2vpn-bg-bd-vfi", "vfi-pw": "config-l2vpn-bg-bd-vfi-pw", ldp: "config-ldp", "ldp-if": "config-ldp-if" },
    lines: (c) => vsXrLines(r, c),
    help: { "show l2vpn": "Layer 2 VPN information", "show l2vpn bridge-domain": "Bridge-domain information", "show l2vpn forwarding": "Forwarding information", "show mpls": "MPLS information", "show mpls ldp": "LDP information", "show route": "IP routing table", clear: "Clear functions", "clear l2vpn": "Clear Layer 2 VPN information" },
    shows: [
      sh("bd", "show l2vpn bridge-domain", "The bridge domain: attachment circuits and pseudowires", () => nothing(xrBridgeDomain(s, r, false), none)),
      sh("bd-d", "show l2vpn bridge-domain detail", "In detail: VLANs, MTU, labels, split horizon", () => nothing(xrBridgeDomain(s, r, true), none)),
      sh("mac", "show l2vpn forwarding bridge-domain mac-address location <loc>", "The MAC table: where each MAC was learned", () => nothing(xrMacTable(s, r), none), { loc: choiceArg(["0/0/CPU0"], () => "Line card") }),
      sh("disc", "show mpls ldp discovery", "Where LDP hellos go: interfaces and targeted neighbors", () => xrDiscovery(s, r)),
      sh("ldp", "show mpls ldp neighbor brief", "LDP sessions (link and targeted)", () => xrLdpBrief(s, r)),
      sh("fwd", "show mpls forwarding", "The label forwarding table (transport and pseudowire labels)", () => xrForwarding(s, r)),
      sh("route", "show route", "The global routing table (loopbacks via IS-IS)", () => xrRouteGlobal(s, r)),
      sh("log", "show logging", "The syslog buffer", () => xrLogging(s, r)),
    ],
    exec: [
      sh("clr", "clear l2vpn bridge-domain bd-name <n>", "Clear the bridge domain's MAC addresses", (a) => (isPe(r) && s.cfg[r].bd?.name === a.n ? (api.act({ type: "clear", dev: r }), "") : `% Bridge domain ${a.n} not found`), { n: nameArg([s.cfg[r].bd?.name ?? "VPLS-A"], "Bridge-domain name") }),
    ],
  };
}
export function vsJunosSpec(api: VsCliApi, r: VsR): SpJunosSpec<VsCfg> {
  const s = api.s;
  const sh = (id: string, syntax: string, summary: string, run: SpCmd["run"], args?: SpCmd["args"]): SpCmd => ({ id, syntax, summary, run, args });
  const nothing = (o: string, why: string) => o || { output: "", explanation: why };
  const none = isPe(r) ? "No VPLS instance configured." : "No VPLS here: P routers carry no customer services.";
  const tblArg = choiceArg(["inet.3", "mpls.0"], (c) => (c === "inet.3" ? "LSPs to the loopbacks" : "Label forwarding (transport and VPLS labels)"));
  return {
    stmts: stmts(r, s).filter((x) => x.junos),
    jstmts: (c) => vsJnStmts(r, c),
    help: { "show vpls": "Show VPLS information", "show route": "Show routing table information", "show route table": "Name of the routing table", "show ldp": "Show LDP information", clear: "Clear information in the system", "clear vpls": "Clear VPLS information" },
    shows: [
      sh("con", "show vpls connections", "Every VPLS pseudowire: status, labels", () => nothing(jnConnections(s, r), none)),
      sh("mac", "show vpls mac-table", "The MAC table: where each MAC was learned", () => nothing(jnMacTable(s, r), none)),
      sh("ldps", "show ldp session", "LDP sessions (link and targeted)", () => jnLdpSession(s, r)),
      sh("ldpn", "show ldp neighbor", "LDP neighbors and where their hellos arrive", () => jnLdpNeighbor(s, r)),
      sh("tbl", "show route table <t>", "inet.3 (LSPs) or mpls.0 (labels)", (a) => (a.t === "inet.3" ? jnInet3(s, r) : jnMpls0(s, r)), { t: tblArg }),
      sh("log", "show log messages", "The system log", () => nothing(jnLog(s, r), "No messages since the lab started.")),
    ],
    op: [
      sh("clr", "clear vpls mac-table instance <n>", "Clear the instance's MAC table", (a) => (isPe(r) && s.cfg[r].bd?.name === a.n ? (api.act({ type: "clear", dev: r }), "") : `error: instance ${a.n} not found`), { n: nameArg([s.cfg[r].bd?.name ?? "VPLS-A"], "VPLS instance") }),
    ],
  };
}
export function vsSets(api: VsCliApi, r: VsR): Partial<Record<CliVendor, CliCommandSet>> {
  return {
    cisco: buildXrSet({ ...api.dev, validate: (c) => vsValidate(c, false) }, vsXrSpec(api, r)),
    juniper: buildJunosSet({ ...api.dev, validate: (c) => vsValidate(c, true) }, vsJunosSpec(api, r)),
  };
}
export const vsPipe = (api: VsCliApi, r: VsR) => ({ config: junosPipeConfig(api.dev, { jstmts: (c: VsCfg) => vsJnStmts(r, c) }), rollbacks: api.dev.hist.length });
export function vsStaticApi(s: VsState, r: VsR): VsCliApi {
  return { s, act: () => s, dev: { host: r, running: s.cfg[r], hist: s.hist[r], setCand: () => undefined, xr: [], setXr: () => undefined, edit: false, setEdit: () => undefined, commit: () => undefined } };
}
export const vsClone = spClone;
export { VS_LINKS };
