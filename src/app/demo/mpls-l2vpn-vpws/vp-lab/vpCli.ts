import type { CliArgSpec, CliCommandSet, CliVendor } from "@/lib/cli/types";
import { buildJunosSet, buildXrSet, choiceArg, junosPipeConfig, numArg, type SpCfgStmt, type SpCmd, type SpDevCli, type SpJunosSpec, type SpXrSpec } from "@/components/sp-lab/spCli";
import { lpad, pad, spAge, spClone, spStamp, type JStmt } from "@/components/sp-lab/spKit";
import { jnIf, parseIf, xrIf } from "@/components/sp-lab/spNames";
import { CES, IMPLICIT_NULL, VP_LINKS, VP_LO, VP_PES, VP_ROUTERS, acKey, ceIfs, coreIfs, ldpLabel, otherPe, peOfLo, type IfName, type VpAction, type VpCfg, type VpPw, type VpR, type VpState } from "@/lib/sim-engine/scenarios/vpNet";

/**
 * Command lines of the MPLS L2VPN (VPWS) Lab — IOS XR or Junos on PE1, P1, P2, PE2. Every output is printed from the
 * lab model: attachment circuits, cross-connects and pseudowires with their labels, MTU and control word, targeted LDP,
 * the label forwarding tables.
 *
 *   IOS XR  show l2vpn xconnect [detail | group <g>] · show mpls ldp discovery · show mpls ldp neighbor brief ·
 *           show mpls forwarding · show route · show logging
 *           configure → interface <if>.<vlan> l2transport → encapsulation dot1q <vlan> · mtu <n> ·
 *           l2vpn → pw-class <name> → encapsulation mpls → control-word · xconnect group <g> → p2p <name> →
 *           interface <if>.<vlan> · neighbor ipv4 <ip> pw-id <id> → pw-class <name> · mpls ldp → interface <if> · commit
 *   Junos   show l2circuit connections · show ldp session · show ldp neighbor · show route table inet.3 | mpls.0 ·
 *           show log messages
 *           configure → set interfaces <if> unit <u> encapsulation vlan-ccc | vlan-id <vlan> ·
 *           protocols l2circuit neighbor <ip> interface <if>.<u> virtual-circuit-id <id> | no-control-word | mtu <n> ·
 *           protocols ldp interface <if> · commit
 */

export interface VpCliApi {
  s: VpState;
  act: (a: VpAction) => VpState;
  dev: SpDevCli<VpCfg>;
}

// ---------------------------------------------------------------------------------------------------------------
// Names and arguments
// ---------------------------------------------------------------------------------------------------------------
const ipRe = /^(\d{1,3}\.){3}\d{1,3}$/;
const wordRe = /^[A-Za-z][\w-]{0,31}$/;
const isPe = (r: VpR) => VP_PES.includes(r);
/** "ge-0/0/1.100" → "GigabitEthernet0/0/0/1.100" (short: Gi0/0/0/1.100). */
export const xrSub = (k: string, short = false) => {
  const [ifn, u] = k.split(".");
  return `${xrIf(ifn, short)}.${u}`;
};
/** XR / Junos sub-interface argument → "ge-0/0/N.U" (CE-facing ports only). */
export function parseSub(raw: string): string | undefined {
  const m = /^(?:gigabitethernet|gi|gig)0\/0\/0\/([0-2])\.(\d{1,5})$/i.exec(raw) ?? /^ge-0\/0\/([0-2])\.(\d{1,5})$/i.exec(raw);
  if (!m || +m[2] < 1 || +m[2] > 4094) return undefined;
  return `ge-0/0/${m[1]}.${+m[2]}`;
}
const subArg = (s: VpState, r: VpR, junos: boolean): CliArgSpec => ({
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
const portArg = (r: VpR): CliArgSpec => ({ choices: ceIfs(r).map((x) => x.ifn), describe: (c) => `to ${ceIfs(r).find((x) => x.ifn === c)?.ce ?? "?"}`, resolve: (raw) => (ceIfs(r).some((x) => x.ifn === raw) ? raw : undefined) });
const pifArg = (r: VpR, junos: boolean): CliArgSpec => ({
  choices: [...coreIfs(r).map((x) => (junos ? jnIf(x.ifn) : xrIf(x.ifn))), ...(junos ? ["lo0.0"] : [])],
  describe: (c) => {
    const i = parseIf(c);
    return i === "lo0" ? "the loopback (targeted sessions)" : `to ${coreIfs(r).find((x) => x.ifn === i)?.peer ?? "?"}`;
  },
  resolve: (raw) => {
    const i = parseIf(raw);
    return i && (coreIfs(r).some((x) => x.ifn === i) || (junos && i === "lo0")) ? i : undefined;
  },
});
const nbrArg = (r: VpR): CliArgSpec => ({ choices: VP_PES.filter((p) => p !== r).map((p) => VP_LO[p]), describe: () => "The remote PE's loopback", resolve: (raw) => (ipRe.test(raw) ? raw : undefined) });
const pwidArg = numArg(1, 4294967295, ["5000", "5100"], "Pseudowire ID (both ends must agree)");
const vlanArg = numArg(1, 4094, ["100", "200"], "VLAN ID");
const nameArg = (names: string[], what: string): CliArgSpec => ({ choices: names, describe: () => what, resolve: (raw) => (wordRe.test(raw) ? raw : undefined) });

// ---------------------------------------------------------------------------------------------------------------
// IOS XR outputs
// ---------------------------------------------------------------------------------------------------------------
const pwsOf = (s: VpState, r: VpR) => s.view.pws.filter((p) => p.pe === r);
const acUp = (s: VpState, r: VpR, k?: string) => !!k && !!s.cfg[r].acs[k];
function xrXconnect(s: VpState, r: VpR, group?: string): string {
  if (!isPe(r)) return "";
  const rows = pwsOf(s, r).filter((p) => !group || p.xc.group === group).map((p) => {
    const ac = p.xc.ac ? xrSub(p.xc.ac, true) : "-";
    const s1 = acUp(s, r, p.xc.ac) ? "UP" : "UR";
    const s2 = !p.xc.nbr ? "UR" : p.up ? "UP" : "DN";
    return `${pad(p.xc.group, 11)}${pad(p.xc.name, 11)}${pad(p.up ? "UP" : "DN", 5)}${pad(ac, 23)}${pad(s1, 9)}${pad(p.xc.nbr ?? "-", 16)}${pad(p.xc.pwid ?? "", 7)}${s2}`;
  });
  if (!rows.length) return "";
  return [
    "Legend: ST = State, UP = Up, DN = Down, AD = Admin Down, UR = Unresolved,",
    "        SB = Standby, SR = Standby Ready, (PP) = Partially Programmed,",
    "        LU = Local Up, RU = Remote Up, CO = Connected, (SI) = Seamless Inactive",
    "",
    "XConnect                   Segment 1                       Segment 2                ",
    "Group      Name       ST   Description            ST       Description            ST    ",
    "------------------------   -----------------------------   -----------------------------",
    ...rows,
    "----------------------------------------------------------------------------------------",
  ].join("\n");
}
function xrXconnectDetail(s: VpState, r: VpR, group?: string): string {
  if (!isPe(r)) return "";
  const blocks = pwsOf(s, r).filter((p) => !group || p.xc.group === group).map((p) => {
    const ac = p.xc.ac ? s.cfg[r].acs[p.xc.ac] : undefined;
    const peer = p.xc.nbr ? peOfLo(p.xc.nbr) : undefined;
    const rem = p.remote;
    const col = (a: string | number, b: string | number) => `${pad(a, 44)}${b}`;
    const lines = [
      `Group ${p.xc.group}, XC ${p.xc.name}, state is ${p.up ? "up" : "down"}; Interworking none`,
      `  AC: ${p.xc.ac ? xrSub(p.xc.ac) : "(none)"}, state is ${ac ? "up" : "unresolved"}`,
      ...(ac ? [`    Type VLAN; Num Ranges: 1`, `    VLAN ranges: ${ac.vlan ? `[${ac.vlan}, ${ac.vlan}]` : "none"}`, `    MTU ${ac.mtu}; XC ID 0x10800${String(p.idx + 1).padStart(2, "0")}; interworking none`] : []),
    ];
    if (p.xc.nbr) {
      lines.push(
        `  PW: neighbor ${p.xc.nbr}, PW ID ${p.xc.pwid}, state is ${p.up ? "up ( established )" : "down ( local ready )"}`,
        `    PW class ${p.xc.pwClass ?? "not set"}, XC ID 0xa00000${String(p.idx + 1).padStart(2, "0")}`,
        "    Encapsulation MPLS, protocol LDP",
        `    Source address ${VP_LO[r]}`,
        `    PW type Ethernet, control word ${p.cw ? "enabled" : "disabled"}, interworking none`,
        "    PW backup disable delay 0 sec",
        "    Sequencing not set",
        "",
        `      ${col("MPLS         Local", "Remote")}`,
        "      ------------ ------------------------------ -----------------------------",
        `      ${col(`Label        ${p.local}`, rem ? rem.label : "unknown")}`,
        `      ${col("Group ID     0x1000180", rem ? "0x1000180" : "unknown")}`,
        `      ${col(`Interface    ${p.xc.ac ? xrSub(p.xc.ac) : "-"}`, rem?.ac ? xrSub(rem.ac) : "unknown")}`,
        `      ${col(`MTU          ${p.mtu}`, rem ? rem.mtu : "unknown")}`,
        `      ${col(`Control word ${p.cw ? "enabled" : "disabled"}`, rem ? (rem.cw ? "enabled" : "disabled") : "unknown")}`,
        `      ${col("PW type      Ethernet", rem ? "Ethernet" : "unknown")}`,
        `      ${col("VCCV CV type 0x2", rem ? "0x2" : "0x0")}`,
        `      ${col("             (LSP ping verification)", rem ? "(LSP ping verification)" : "(none)")}`,
        "      ------------ ------------------------------ -----------------------------",
      );
      if (!p.up && p.why === "nosess") lines.push(`    LDP session to ${p.xc.nbr} is down`);
      if (!p.up && p.why === "nonbr") lines.push(`    LDP session to ${p.xc.nbr} is down`);
      if (!p.up && peer && p.why === "noremote") lines.push("    Remote label not received");
    }
    return lines.join("\n");
  });
  return blocks.join("\n\n");
}
function xrDiscovery(s: VpState, r: VpR): string {
  const ifs = coreIfs(r).filter((x) => s.cfg[r].ldp[x.ifn]).flatMap((x) => {
    const up = s.view.ldp[x.link.id];
    return [`    ${xrIf(x.ifn)} : xmit${up ? "/recv" : ""}`, "      VRF: 'default' (0x60000000)", ...(up ? [`      LDP Id: ${VP_LO[x.peer]}:0, Transport address: ${VP_LO[x.peer]}`, "          Hold time: 15 sec (local:15 sec, peer:15 sec)"] : [])];
  });
  const tgt = (s.view.tldp.tries[r] ?? []).flatMap((ip) => {
    const ok = s.view.tldp.up && ip === VP_LO[otherPe(r)];
    return [`    ${VP_LO[r]} -> ${ip} (active${ok ? "/passive" : ""}), xmit${ok ? "/recv" : ""}`, ...(ok ? [`      LDP Id: ${ip}:0`, "          Hold time: 90 sec (local:90 sec, peer:90 sec)"] : [])];
  });
  return [`Local LDP Identifier: ${VP_LO[r]}:0`, "Discovery Sources:", "  Interfaces:", ...ifs, ...(tgt.length ? ["", "  Targeted Hellos:", ...tgt] : [])].join("\n");
}
function xrLdpBrief(s: VpState, r: VpR): string {
  const rows = coreIfs(r).filter((x) => s.view.ldp[x.link.id]).map((x) => `${pad(`${VP_LO[x.peer]}:0`, 18)}${pad("Y", 4)}${pad(spAge(s.clock, 20), 10)}${lpad(1, 6)}${lpad(4, 9)}${lpad(1, 7)}${lpad(5, 6)}`);
  if (isPe(r) && s.view.tldp.up) rows.push(`${pad(`${VP_LO[otherPe(r)]}:0`, 18)}${pad("Y", 4)}${pad(spAge(s.clock, 30), 10)}${lpad(1, 6)}${lpad(4, 9)}${lpad(1, 7)}${lpad(5, 6)}`);
  return ["Peer              GR  Up Time         Discovery   Addresses     Labels", "                                      ipv4  ipv6  ipv4  ipv6  ipv4   ipv6", "----------------- --  --------------- ----- ----  ----- ----  ------ ----", ...rows].join("\n");
}
const lab = (n: number | undefined) => (n === undefined ? "Unlabelled" : n === IMPLICIT_NULL ? "Pop" : String(n));
function transportRows(s: VpState, r: VpR) {
  return [VP_LO.PE1, VP_LO.PE2].filter((fec) => fec !== VP_LO[r]).flatMap((fec) => {
    const t = s.view.lsp[r][fec];
    if (!t?.nh) return [];
    const x = coreIfs(r).find((y) => y.peer === t.nh)!;
    return [{ fec, local: ldpLabel(s.os, r, fec), out: t.out, ifn: x.ifn, nh: x.peerIp }];
  });
}
function xrForwarding(s: VpState, r: VpR): string {
  const rows = transportRows(s, r).map((t) => `${pad(t.local, 7)}${pad(lab(t.out), 12)}${pad(`${t.fec}/32`, 19)}${pad(xrIf(t.ifn, true), 13)}${pad(t.nh, 16)}0`);
  for (const p of pwsOf(s, r).filter((x) => x.up)) rows.push(`${pad(p.local, 7)}${pad("Pop", 12)}${pad(`PW(${p.xc.nbr}:${p.xc.pwid})`, 19)}${pad(xrSub(p.xc.ac!, true), 14)}${pad("point2point", 16)}0`);
  return ["Local  Outgoing    Prefix             Outgoing     Next Hop        Bytes", "Label  Label       or ID              Interface                    Switched", "------ ----------- ------------------ ------------ --------------- ------------", ...rows].join("\n");
}
function xrRouteGlobal(s: VpState, r: VpR): string {
  const me = VP_ROUTERS.indexOf(r);
  const rows = VP_ROUTERS.map((n, k) => {
    if (n === r) return `L    ${pad(`${VP_LO[n]}/32`, 18)} is directly connected, ${spAge(s.clock, 30)}, Loopback0`;
    const nb = VP_ROUTERS[k > me ? me + 1 : me - 1];
    const x = coreIfs(r).find((y) => y.peer === nb)!;
    return `i L2 ${pad(`${VP_LO[n]}/32`, 18)} [115/${10 * Math.abs(k - me) + 10}] via ${x.peerIp}, ${spAge(s.clock, 30)}, ${xrIf(x.ifn)}`;
  });
  return ["Codes: C - connected, S - static, B - BGP, i - ISIS, L1 - IS-IS level-1, L2 - IS-IS level-2", "       L - local", "", "Gateway of last resort is not set", "", ...rows].join("\n");
}
function xrLogging(s: VpState, r: VpR): string {
  const lines = s.sys.filter((x) => x.dev === r).slice(-30).map((x) => {
    const st = `RP/0/RP0/CPU0:${spStamp(x.t).xr}`;
    if (x.kind === "ldp-up") return `${st}: mpls_ldp[1159]: %ROUTING-LDP-5-NBR_CHANGE : VRF 'default' (0x60000000), Neighbor ${x.peer}:0 is UP`;
    if (x.kind === "ldp-down") return `${st}: mpls_ldp[1159]: %ROUTING-LDP-5-NBR_CHANGE : VRF 'default' (0x60000000), Neighbor ${x.peer}:0 is DOWN (Interface state down)`;
    if (x.kind === "pw-up") return `${st}: l2vpn_mgr[1234]: %L2-L2VPN_PW-3-UPDOWN : Pseudowire with address ${x.peer}, id ${x.pwid}, state is Up`;
    if (x.kind === "pw-down") return `${st}: l2vpn_mgr[1234]: %L2-L2VPN_PW-3-UPDOWN : Pseudowire with address ${x.peer}, id ${x.pwid}, state is Down`;
    return `${st}: config[65857]: %MGBL-CONFIG-6-DB_COMMIT : Configuration committed by user 'admin'. Use 'show commit changes ${1000000000 + x.t}' to view the changes.`;
  });
  return ["Syslog logging: enabled (0 messages dropped, 0 flushes, 0 overruns)", `    Buffer logging: level debugging, ${lines.length} messages logged`, "", "Log Buffer (2097152 bytes):", "", ...lines].join("\n");
}

// ---------------------------------------------------------------------------------------------------------------
// Junos outputs
// ---------------------------------------------------------------------------------------------------------------
const JN_LEGEND = [
  "Layer-2 Circuit Connections:",
  "",
  "Legend for connection status (St)",
  "EI -- encapsulation invalid      NP -- interface h/w not present",
  "MM -- mtu mismatch               Dn -- down",
  "EM -- encapsulation mismatch     VC-Dn -- Virtual circuit Down",
  "CM -- control-word mismatch      Up -- operational",
  "VM -- vlan id mismatch           CF -- Call admission control failure",
  "OL -- no outgoing label          IB -- TDM incompatible bitrate",
  "NC -- intf encaps not CCC/TCC    TM -- TDM misconfiguration",
  "BK -- Backup Connection          ST -- Standby Connection",
  "CB -- rcvd cell-bundle size bad  SP -- Static Pseudowire",
  "LD -- local site signaled down   RS -- remote site standby",
  "RD -- remote site signaled down  HS -- Hot-standby Connection",
  "XX -- unknown",
  "",
  "Legend for interface status",
  "Up -- operational",
  "Dn -- down",
];
function jnSt(s: VpState, r: VpR, p: VpPw): string {
  if (p.up) return "Up";
  const ac = p.xc.ac ? s.cfg[r].acs[p.xc.ac] : undefined;
  if (!ac) return "NP";
  if (!ac.ccc) return "NC";
  return p.why === "mtu" ? "MM" : p.why === "cw" ? "CM" : p.why === "nolsp" ? "VC-Dn" : "OL";
}
function jnL2circuit(s: VpState, r: VpR): string {
  if (!isPe(r)) return "";
  const byNbr = new Map<string, VpPw[]>();
  for (const p of pwsOf(s, r).filter((x) => x.xc.nbr)) byNbr.set(p.xc.nbr!, [...(byNbr.get(p.xc.nbr!) ?? []), p]);
  if (!byNbr.size) return "";
  const out = [...JN_LEGEND];
  for (const [nbr, ps] of byNbr) {
    out.push(`Neighbor: ${nbr}`, "    Interface                 Type  St     Time last up          # Up trans");
    for (const p of ps) {
      const st = jnSt(s, r, p);
      const ups = s.sys.filter((x) => x.dev === r && x.kind === "pw-up" && x.pwid === p.xc.pwid);
      out.push(`    ${pad(`${p.xc.ac}(vc ${p.xc.pwid})`, 26)}${pad("rmt", 6)}${pad(st, 7)}${pad(p.up ? `${spStamp(ups.at(-1)?.t ?? 32).junos} 2026` : "-----", 22)}${lpad(ups.length, 10)}`);
      if (p.up || p.remote) out.push(`      Remote PE: ${nbr}, Negotiated control-word: ${p.up && p.cw ? "Yes (Null)" : "No"}`);
      out.push(`      Incoming label: ${p.local}, Outgoing label: ${p.remote?.label ?? ""}`.trimEnd());
      if (p.up) out.push("      Negotiated PW status TLV: No");
      out.push(`      Local interface: ${p.xc.ac}, Status: ${s.cfg[r].acs[p.xc.ac ?? ""] ? "Up" : "Dn"}, Encapsulation: VLAN`);
    }
  }
  return out.join("\n");
}
function jnLdpSession(s: VpState, r: VpR): string {
  const rows = coreIfs(r).filter((x) => s.view.ldp[x.link.id]).map((x) => `${pad(VP_LO[x.peer], 21)}${pad("Operational", 14)}${pad("Open", 13)}${lpad(28, 5)}         DU`);
  if (isPe(r) && s.view.tldp.up) rows.push(`${pad(VP_LO[otherPe(r)], 21)}${pad("Operational", 14)}${pad("Open", 13)}${lpad(25, 5)}         DU`);
  return ["  Address              State        Connection  Hold time  Adv. Mode", ...rows].join("\n");
}
function jnLdpNeighbor(s: VpState, r: VpR): string {
  const rows = coreIfs(r).filter((x) => s.view.ldp[x.link.id]).map((x) => `${pad(x.peerIp, 36)}${pad(jnIf(x.ifn), 16)}${pad(`${VP_LO[x.peer]}:0`, 21)}13`);
  if (isPe(r) && s.view.tldp.up) rows.push(`${pad(VP_LO[otherPe(r)], 36)}${pad("lo0.0", 16)}${pad(`${VP_LO[otherPe(r)]}:0`, 21)}43`);
  return ["Address                             Interface       Label space ID     Hold time", ...rows].join("\n");
}
function jnInet3(s: VpState, r: VpR): string {
  const rows = transportRows(s, r).filter((t) => t.out !== undefined).map((t) => [`${pad(`${t.fec}/32`, 19)}*[LDP/9] ${spAge(s.clock, 20)}, metric 1`, `                    >  to ${t.nh} via ${jnIf(t.ifn)}${t.out === IMPLICIT_NULL ? "" : `, Push ${t.out}`}`]);
  const n = rows.length;
  return [`inet.3: ${n} destinations, ${n} routes (${n} active, 0 holddown, 0 hidden)`, ...(n ? ["+ = Active Route, - = Last Active, * = Both", "", ...rows.flat()] : [])].join("\n");
}
function jnMpls0(s: VpState, r: VpR): string {
  const rows: string[][] = [["0                  *[MPLS/0] 01:00:00, metric 1", "                       to table inet.0"]];
  for (const t of transportRows(s, r).filter((x) => x.out !== undefined)) rows.push([`${pad(t.local, 19)}*[LDP/9] ${spAge(s.clock, 20)}, metric 1`, `                    >  to ${t.nh} via ${jnIf(t.ifn)}, ${t.out === IMPLICIT_NULL ? "Pop" : `Swap ${t.out}`}`]);
  for (const p of pwsOf(s, r).filter((x) => x.up)) {
    const t = s.view.lsp[r][p.xc.nbr!];
    const x = coreIfs(r).find((y) => y.peer === t?.nh)!;
    rows.push([`${pad(p.local, 19)}*[L2CKT/7] ${spAge(s.clock, 32)}`, `                    >  via ${p.xc.ac}, Pop       Offset: 4`]);
    rows.push([`${pad(p.xc.ac!, 19)}*[L2CKT/7] ${spAge(s.clock, 32)}, metric2 1`, `                    >  to ${x.peerIp} via ${jnIf(x.ifn)}, Push ${p.remote!.label} Offset: 252${t?.out !== undefined && t.out !== IMPLICIT_NULL ? `, Push ${t.out}(top)` : ""}`]);
  }
  return [`mpls.0: ${rows.length} destinations, ${rows.length} routes (${rows.length} active, 0 holddown, 0 hidden)`, "+ = Active Route, - = Last Active, * = Both", "", ...rows.flat()].join("\n");
}
function jnLog(s: VpState, r: VpR): string {
  return s.sys.filter((x) => x.dev === r).slice(-30).map((x) => {
    const st = `${spStamp(x.t).junos}  ${r}`;
    if (x.kind === "ldp-up") return `${st} rpd[1532]: RPD_LDP_NBRUP: LDP neighbor ${x.peer} (${x.peer}) is up`;
    if (x.kind === "ldp-down") return `${st} rpd[1532]: RPD_LDP_NBRDOWN: LDP neighbor ${x.peer} (${x.peer}) is down`;
    if (x.kind === "pw-up") return `${st} rpd[1532]: RPD_LAYER2_VC_UP: Layer 2 circuit with neighbor ${x.peer} vc-id ${x.pwid} is up`;
    if (x.kind === "pw-down") return `${st} rpd[1532]: RPD_LAYER2_VC_DOWN: Layer 2 circuit with neighbor ${x.peer} vc-id ${x.pwid} is down`;
    return `${st} mgd[4417]: UI_COMMIT: User 'admin' requested 'commit' operation (comment: none)`;
  }).join("\n");
}

// ---------------------------------------------------------------------------------------------------------------
// Configuration as each OS prints it
// ---------------------------------------------------------------------------------------------------------------
export function vpXrLines(r: VpR, c: VpCfg): string[] {
  const out: string[] = [`hostname ${r}`, "!", "interface Loopback0", ` ipv4 address ${VP_LO[r]} 255.255.255.255`, "!"];
  for (const x of coreIfs(r)) out.push(`interface ${xrIf(x.ifn)}`, ` description to ${x.peer}`, ` ipv4 address ${x.ip} 255.255.255.254`, "!");
  for (const x of ceIfs(r)) out.push(`interface ${xrIf(x.ifn)}`, ` description to ${x.ce}`, "!");
  for (const [k, ac] of Object.entries(c.acs).sort(([a], [b]) => a.localeCompare(b))) out.push(`interface ${xrSub(k)} l2transport`, ...(ac.vlan ? [` encapsulation dot1q ${ac.vlan}`] : []), ...(ac.mtu !== 1500 ? [` mtu ${ac.mtu + 18}`] : []), "!");
  out.push("router isis CORE", ` net 49.0001.0000.0000.000${VP_ROUTERS.indexOf(r) + 1}.00`, " address-family ipv4 unicast", "  metric-style wide", " !", "!");
  if (Object.keys(c.pwClasses).length || c.xcs.length) {
    out.push("l2vpn");
    for (const [n, pc] of Object.entries(c.pwClasses)) out.push(` pw-class ${n}`, "  encapsulation mpls", ...(pc.cw ? ["   control-word"] : []), "  !", " !");
    const groups = [...new Set(c.xcs.map((x) => x.group))];
    for (const g of groups) {
      out.push(` xconnect group ${g}`);
      for (const x of c.xcs.filter((y) => y.group === g)) {
        out.push(`  p2p ${x.name}`, ...(x.ac ? [`   interface ${xrSub(x.ac)}`] : []));
        if (x.nbr) out.push(`   neighbor ipv4 ${x.nbr} pw-id ${x.pwid}`, ...(x.pwClass ? [`    pw-class ${x.pwClass}`] : []), "   !");
        out.push("  !");
      }
      out.push(" !");
    }
    out.push("!");
  }
  out.push("mpls ldp", ` router-id ${VP_LO[r]}`, ...coreIfs(r).filter((x) => c.ldp[x.ifn]).flatMap((x) => [` interface ${xrIf(x.ifn)}`, " !"]), "!");
  return out;
}
export function vpJnStmts(r: VpR, c: VpCfg): JStmt[] {
  const out: JStmt[] = [];
  for (const x of coreIfs(r)) out.push({ path: ["interfaces", x.ifn, "unit 0", "family inet"], leaf: `address ${x.ip}/31` }, { path: ["interfaces", x.ifn, "unit 0", "family mpls"], leaf: "" });
  for (const x of ceIfs(r)) {
    const units = Object.entries(c.acs).filter(([k]) => k.startsWith(`${x.ifn}.`));
    if (!units.length) continue;
    out.push({ path: ["interfaces", x.ifn], leaf: "flexible-vlan-tagging" }, { path: ["interfaces", x.ifn], leaf: "encapsulation flexible-ethernet-services" });
    for (const [k, ac] of units) {
      const u = ["interfaces", x.ifn, `unit ${k.split(".")[1]}`];
      if (ac.ccc) out.push({ path: u, leaf: "encapsulation vlan-ccc" });
      if (ac.vlan) out.push({ path: u, leaf: `vlan-id ${ac.vlan}` });
      if (!ac.ccc && !ac.vlan) out.push({ path: u, leaf: "" });
    }
  }
  out.push({ path: ["interfaces", "lo0", "unit 0", "family inet"], leaf: `address ${VP_LO[r]}/32` }, { path: ["routing-options"], leaf: `router-id ${VP_LO[r]}` });
  for (const x of coreIfs(r)) out.push({ path: ["protocols", "mpls", `interface ${jnIf(x.ifn)}`], leaf: "" });
  for (const x of coreIfs(r).filter((y) => c.ldp[y.ifn])) out.push({ path: ["protocols", "ldp", `interface ${jnIf(x.ifn)}`], leaf: "" });
  if (c.ldpLo && isPe(r)) out.push({ path: ["protocols", "ldp", "interface lo0.0"], leaf: "" });
  for (const x of c.xcs.filter((y) => y.nbr && y.ac)) {
    const p = ["protocols", "l2circuit", `neighbor ${x.nbr}`, `interface ${x.ac}`];
    if (x.pwid !== undefined) out.push({ path: p, leaf: `virtual-circuit-id ${x.pwid}` });
    if (x.noCw) out.push({ path: p, leaf: "no-control-word" });
    const m = c.acs[x.ac!]?.mtu;
    if (m !== undefined && m !== 1500) out.push({ path: p, leaf: `mtu ${m}` });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Configuration statements
// ---------------------------------------------------------------------------------------------------------------
const peOnly = "% Attachment circuits and pseudowires live on the PEs; this P router only switches transport labels.";
function stmts(r: VpR, s: VpState): SpCfgStmt<VpCfg>[] {
  const pe = isPe(r);
  const subX = subArg(s, r, false);
  const subJ = subArg(s, r, true);
  const pifX = pifArg(r, false);
  const pifJ = pifArg(r, true);
  const groups = [...new Set([...s.cfg[r].xcs.map((x) => x.group).filter(Boolean), "CUST-A", "CUST-B"])];
  const names = [...new Set([...s.cfg[r].xcs.map((x) => x.name).filter((n) => wordRe.test(n)), "VPWS-A", "VPWS-B"])];
  const pcs = [...new Set([...Object.keys(s.cfg[r].pwClasses), "CW"])];
  const ac = (c: VpCfg, k: string) => (c.acs[k] ??= { ccc: false, mtu: 1500 });
  const xc = (c: VpCfg, g: string, n: string) => c.xcs.find((x) => x.group === g && x.name === n)!;
  const jxc = (c: VpCfg, k: string) => {
    let x = c.xcs.find((y) => y.ac === k);
    if (!x) c.xcs.push((x = { group: "", name: k, ac: k }));
    return x;
  };
  const mtuX = numArg(1514, 9216, ["1518", "9018"], "Interface MTU, including the 18-byte Ethernet + VLAN header");
  const mtuJ = numArg(1488, 9192, ["1500", "9000"], "Pseudowire MTU (payload)");
  return [
    // ---------------------------------------------------------------- IOS XR
    { id: "sub", summary: "Configure an attachment-circuit sub-interface", args: { sif: subX, l2: choiceArg(["l2transport"], () => "Layer 2 transport (an attachment circuit)") }, xr: { mode: "config", syntax: "interface <sif> <l2>", enter: "subif", apply: (c, a) => (pe ? ((ac(c, a.sif).ccc = true), c) : peOnly), no: (c, a) => (delete c.acs[a.sif], c) } },
    { id: "sub-enc", summary: "The VLAN this attachment circuit accepts", args: { vlan: vlanArg }, xr: { mode: "subif", syntax: "encapsulation dot1q <vlan>", noSyntax: "encapsulation", apply: (c, a, x) => ((ac(c, x.sif).vlan = +a.vlan), c), no: (c, _a, x) => ((ac(c, x.sif).vlan = undefined), c) } },
    { id: "sub-mtu", summary: "Interface MTU (the AC MTU is 18 bytes less)", args: { m: mtuX }, xr: { mode: "subif", syntax: "mtu <m>", noSyntax: "mtu", apply: (c, a, x) => ((ac(c, x.sif).mtu = +a.m - 18), c), no: (c, _a, x) => ((ac(c, x.sif).mtu = 1500), c) } },
    { id: "l2vpn", summary: "Layer 2 VPN services", xr: { mode: "config", syntax: "l2vpn", enter: "l2vpn", apply: (c) => (pe ? c : peOnly) } },
    { id: "pwc", summary: "A pseudowire class (shared pseudowire settings)", args: { pc: nameArg(pcs, "Pseudowire class name") }, xr: { mode: "l2vpn", syntax: "pw-class <pc>", enter: "pwc", apply: (c, a) => ((c.pwClasses[a.pc] ??= { cw: false }), c), no: (c, a) => (delete c.pwClasses[a.pc], c) } },
    { id: "pwc-mpls", summary: "MPLS encapsulation settings", xr: { mode: "pwc", syntax: "encapsulation mpls", enter: "pwc-mpls", apply: (c) => c } },
    { id: "pwc-cw", summary: "Use the control word", xr: { mode: "pwc-mpls", syntax: "control-word", apply: (c, _a, x) => ((c.pwClasses[x.pc].cw = true), c), no: (c, _a, x) => ((c.pwClasses[x.pc].cw = false), c) } },
    { id: "xcg", summary: "A group of cross-connects", args: { g: nameArg(groups, "Group name") }, xr: { mode: "l2vpn", syntax: "xconnect group <g>", enter: "xcg", apply: (c) => c, no: (c, a) => ((c.xcs = c.xcs.filter((x) => x.group !== a.g)), c) } },
    { id: "p2p", summary: "A point-to-point cross-connect", args: { n: nameArg(names, "Cross-connect name") }, xr: { mode: "xcg", syntax: "p2p <n>", enter: "p2p", apply: (c, a, x) => (xc(c, x.g, a.n) || c.xcs.push({ group: x.g, name: a.n }), c), no: (c, a, x) => ((c.xcs = c.xcs.filter((y) => !(y.group === x.g && y.name === a.n))), c) } },
    { id: "p2p-if", summary: "The attachment circuit", args: { sif: subX }, xr: { mode: "p2p", syntax: "interface <sif>", apply: (c, a, x) => ((xc(c, x.g, x.n).ac = a.sif), c), no: (c, _a, x) => ((xc(c, x.g, x.n).ac = undefined), c) } },
    { id: "p2p-nbr", summary: "The pseudowire: remote PE and PW ID", args: { ip: nbrArg(r), id: pwidArg }, xr: { mode: "p2p", syntax: "neighbor ipv4 <ip> pw-id <id>", enter: "pw", apply: (c, a, x) => (Object.assign(xc(c, x.g, x.n), { nbr: a.ip, pwid: +a.id }), c), no: (c, _a, x) => (Object.assign(xc(c, x.g, x.n), { nbr: undefined, pwid: undefined, pwClass: undefined }), c) } },
    { id: "pw-pwc", summary: "Use a pseudowire class", args: { pc: nameArg(pcs, "Pseudowire class name") }, xr: { mode: "pw", syntax: "pw-class <pc>", noSyntax: "pw-class", apply: (c, a, x) => ((xc(c, x.g, x.n).pwClass = a.pc), c), no: (c, _a, x) => ((xc(c, x.g, x.n).pwClass = undefined), c) } },
    { id: "ldp", summary: "MPLS LDP", xr: { mode: "config", syntax: "mpls ldp", enter: "ldp", apply: (c) => c } },
    { id: "ldp-if", summary: "Run LDP on the interface", args: { pif: pifX }, xr: { mode: "ldp", syntax: "interface <pif>", enter: "ldp-if", apply: (c, a) => ((c.ldp[a.pif as IfName] = true), c), no: (c, a) => ((c.ldp[a.pif as IfName] = false), c) } },

    // ---------------------------------------------------------------- Junos
    { id: "j-ccc", summary: "The unit carries a Layer 2 circuit (VLAN CCC)", args: { p: portArg(r), u: vlanArg, e: choiceArg(["vlan-ccc"], () => "VLAN cross-connect encapsulation") }, junos: { syntax: "interfaces <p> unit <u> encapsulation <e>", set: (c, a) => (pe ? ((ac(c, acKey(a.p, +a.u)).ccc = true), c) : `error: ${peOnly.slice(2)}`), del: (c, a) => (c.acs[acKey(a.p, +a.u)] && (c.acs[acKey(a.p, +a.u)].ccc = false), c) } },
    { id: "j-vlan", summary: "The VLAN this unit accepts", args: { p: portArg(r), u: vlanArg, vlan: vlanArg }, junos: { syntax: "interfaces <p> unit <u> vlan-id <vlan>", set: (c, a) => (pe ? ((ac(c, acKey(a.p, +a.u)).vlan = +a.vlan), c) : `error: ${peOnly.slice(2)}`), del: (c, a) => (c.acs[acKey(a.p, +a.u)] && (c.acs[acKey(a.p, +a.u)].vlan = undefined), c) } },
    { id: "j-unit", summary: "A logical unit (delete removes it)", args: { p: portArg(r), u: vlanArg }, junos: { syntax: "interfaces <p> unit <u>", del: (c, a) => (delete c.acs[acKey(a.p, +a.u)], c) } },
    { id: "j-vc", summary: "The pseudowire to this neighbor for the interface", args: { ip: nbrArg(r), sif: subJ, id: pwidArg }, junos: { syntax: "protocols l2circuit neighbor <ip> interface <sif> virtual-circuit-id <id>", set: (c, a) => (pe ? (Object.assign(jxc(c, a.sif), { nbr: a.ip, pwid: +a.id }), c) : `error: ${peOnly.slice(2)}`), del: (c, a) => (Object.assign(jxc(c, a.sif), { pwid: undefined }), c) } },
    { id: "j-nocw", summary: "Don't use the control word", args: { ip: nbrArg(r), sif: subJ }, junos: { syntax: "protocols l2circuit neighbor <ip> interface <sif> no-control-word", set: (c, a) => ((jxc(c, a.sif).noCw = true), c), del: (c, a) => ((jxc(c, a.sif).noCw = false), c) } },
    { id: "j-mtu", summary: "The MTU signaled for the pseudowire", args: { ip: nbrArg(r), sif: subJ, m: mtuJ }, junos: { syntax: "protocols l2circuit neighbor <ip> interface <sif> mtu <m>", set: (c, a) => ((ac(c, a.sif).mtu = +a.m), c), del: (c, a) => ((ac(c, a.sif).mtu = 1500), c) } },
    { id: "j-mtu-all", summary: "The signaled MTU (delete returns to the interface's)", args: { ip: nbrArg(r), sif: subJ }, junos: { syntax: "protocols l2circuit neighbor <ip> interface <sif> mtu", del: (c, a) => ((ac(c, a.sif).mtu = 1500), c) } },
    { id: "j-l2if", summary: "A Layer 2 circuit (delete removes it)", args: { ip: nbrArg(r), sif: subJ }, junos: { syntax: "protocols l2circuit neighbor <ip> interface <sif>", del: (c, a) => ((c.xcs = c.xcs.filter((x) => !(x.ac === a.sif && x.nbr === a.ip))), c) } },
    { id: "j-l2nbr", summary: "Every Layer 2 circuit to the neighbor (delete removes them)", args: { ip: nbrArg(r) }, junos: { syntax: "protocols l2circuit neighbor <ip>", del: (c, a) => ((c.xcs = c.xcs.filter((x) => x.nbr !== a.ip)), c) } },
    { id: "j-ldp", summary: "Run LDP on the interface (lo0.0 for targeted sessions)", args: { pif: pifJ }, junos: { syntax: "protocols ldp interface <pif>", set: (c, a) => (a.pif === "lo0" ? (c.ldpLo = true) : (c.ldp[a.pif as IfName] = true), c), del: (c, a) => (a.pif === "lo0" ? (c.ldpLo = false) : (c.ldp[a.pif as IfName] = false), c) } },
  ];
}

// ---------------------------------------------------------------------------------------------------------------
// Command sets
// ---------------------------------------------------------------------------------------------------------------
export function vpValidate(c: VpCfg, junos: boolean): string | undefined {
  const used = c.xcs.filter((x) => x.ac);
  const dup = used.find((x, i) => used.findIndex((y) => y.ac === x.ac) !== i);
  if (dup) return junos ? `error: interface ${dup.ac} is already used by another Layer 2 circuit\nerror: configuration check-out failed` : `!!% Invalid argument: AC ${xrSub(dup.ac!)} is already part of another cross-connect`;
  if (!junos) {
    const noPc = c.xcs.find((x) => x.pwClass && !c.pwClasses[x.pwClass]);
    if (noPc) return `!!% Invalid argument: pw-class ${noPc.pwClass} is not configured`;
  }
  return undefined;
}
export function vpXrSpec(api: VpCliApi, r: VpR): SpXrSpec<VpCfg> {
  const s = api.s;
  const sh = (id: string, syntax: string, summary: string, run: SpCmd["run"], args?: SpCmd["args"]): SpCmd => ({ id, syntax, summary, run, args });
  const nothing = (o: string, why: string) => o || { output: "", explanation: why };
  const gArg = nameArg([...new Set(s.cfg[r].xcs.map((x) => x.group))], "Cross-connect group");
  return {
    stmts: stmts(r, s).filter((x) => x.xr),
    prompts: { config: "config", subif: "config-subif", l2vpn: "config-l2vpn", pwc: "config-l2vpn-pwc", "pwc-mpls": "config-l2vpn-pwc-mpls", xcg: "config-l2vpn-xc", p2p: "config-l2vpn-xc-p2p", pw: "config-l2vpn-xc-p2p-pw", ldp: "config-ldp", "ldp-if": "config-ldp-if" },
    lines: (c) => vpXrLines(r, c),
    help: { "show l2vpn": "Layer 2 VPN information", "show l2vpn xconnect": "Cross-connects", "show mpls": "MPLS information", "show mpls ldp": "LDP information", "show route": "IP routing table" },
    shows: [
      sh("xc", "show l2vpn xconnect", "Every cross-connect: attachment circuit and pseudowire state", () => nothing(xrXconnect(s, r), isPe(r) ? "No cross-connects configured." : "No cross-connects here: P routers carry no customer services.")),
      sh("xc-d", "show l2vpn xconnect detail", "Cross-connects in detail: VLAN, MTU, local and remote labels, control word", () => nothing(xrXconnectDetail(s, r), "No cross-connects here.")),
      sh("xc-gd", "show l2vpn xconnect group <g> detail", "One group's cross-connects in detail", (a) => nothing(xrXconnectDetail(s, r, a.g), "No such group."), { g: gArg }),
      sh("xc-g", "show l2vpn xconnect group <g>", "The cross-connects of one group", (a) => nothing(xrXconnect(s, r, a.g), "No such group."), { g: gArg }),
      sh("disc", "show mpls ldp discovery", "Where LDP hellos go: interfaces and targeted neighbors", () => xrDiscovery(s, r)),
      sh("ldp", "show mpls ldp neighbor brief", "LDP sessions (link and targeted)", () => xrLdpBrief(s, r)),
      sh("fwd", "show mpls forwarding", "The label forwarding table (transport and pseudowire labels)", () => xrForwarding(s, r)),
      sh("route", "show route", "The global routing table (loopbacks via IS-IS)", () => xrRouteGlobal(s, r)),
      sh("log", "show logging", "The syslog buffer", () => xrLogging(s, r)),
    ],
    exec: [],
  };
}
export function vpJunosSpec(api: VpCliApi, r: VpR): SpJunosSpec<VpCfg> {
  const s = api.s;
  const sh = (id: string, syntax: string, summary: string, run: SpCmd["run"], args?: SpCmd["args"]): SpCmd => ({ id, syntax, summary, run, args });
  const nothing = (o: string, why: string) => o || { output: "", explanation: why };
  const tblArg = choiceArg(["inet.3", "mpls.0"], (c) => (c === "inet.3" ? "LSPs to the loopbacks" : "Label forwarding (transport and Layer 2 circuit labels)"));
  return {
    stmts: stmts(r, s).filter((x) => x.junos),
    jstmts: (c) => vpJnStmts(r, c),
    help: { "show l2circuit": "Show Layer 2 circuit information", "show route": "Show routing table information", "show route table": "Name of the routing table", "show ldp": "Show LDP information" },
    shows: [
      sh("l2c", "show l2circuit connections", "Every Layer 2 circuit: status, labels, control word", () => nothing(jnL2circuit(s, r), isPe(r) ? "No Layer 2 circuits configured." : "No Layer 2 circuits here: P routers carry no customer services.")),
      sh("ldps", "show ldp session", "LDP sessions (link and targeted)", () => jnLdpSession(s, r)),
      sh("ldpn", "show ldp neighbor", "LDP neighbors and where their hellos arrive", () => jnLdpNeighbor(s, r)),
      sh("tbl", "show route table <t>", "inet.3 (LSPs) or mpls.0 (labels)", (a) => (a.t === "inet.3" ? jnInet3(s, r) : jnMpls0(s, r)), { t: tblArg }),
      sh("log", "show log messages", "The system log", () => nothing(jnLog(s, r), "No messages since the lab started.")),
    ],
    op: [],
  };
}
export function vpSets(api: VpCliApi, r: VpR): Partial<Record<CliVendor, CliCommandSet>> {
  return {
    cisco: buildXrSet({ ...api.dev, validate: (c) => vpValidate(c, false) }, vpXrSpec(api, r)),
    juniper: buildJunosSet({ ...api.dev, validate: (c) => vpValidate(c, true) }, vpJunosSpec(api, r)),
  };
}
export const vpPipe = (api: VpCliApi, r: VpR) => ({ config: junosPipeConfig(api.dev, { jstmts: (c: VpCfg) => vpJnStmts(r, c) }), rollbacks: api.dev.hist.length });
export function vpStaticApi(s: VpState, r: VpR): VpCliApi {
  return { s, act: () => s, dev: { host: r, running: s.cfg[r], hist: s.hist[r], setCand: () => undefined, xr: [], setXr: () => undefined, edit: false, setEdit: () => undefined, commit: () => undefined } };
}
export const vpClone = spClone;
export { CES, VP_LINKS };
