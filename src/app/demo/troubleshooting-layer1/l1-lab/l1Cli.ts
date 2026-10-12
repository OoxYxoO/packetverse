import type { CliArgSpec, CliCommand, CliCommandSet, CliVendor } from "@/lib/cli/types";
import { buildJunosSet, choiceArg, junosPipeConfig, numArg, type SpCfgStmt, type SpCmd, type SpDevCli, type SpJunosSpec } from "@/components/sp-lab/spCli";
import { pad, spStamp, type JStmt } from "@/components/sp-lab/spKit";
import { L1_IP, L1_MAC, UPLINK } from "@/lib/sim-engine/scenarios/troubleshootingLayer1";
import { IFINDEX, IF_HOST, LOS_DBM, SW_IFS, SW_MAC, iperfRate, l1Apply, l1View, lastTest, swCtr, type CopperLink, type EthOpts, type HostEth, type L1Action, type L1D, type L1Host, type L1JCfg, type L1State, type L1Sw } from "@/lib/sim-engine/scenarios/l1Net";

/**
 * Command lines of the Layer 1 Lab. Every output is printed from the lab model (l1Net.ts).
 *
 * ACCESS-SW / DIST-SW (Junos EX, ELS): show interfaces terse | show interfaces <if> [extensive]
 *   | show interfaces diagnostics optics <if> | show chassis pic fpc-slot 0 pic-slot 0 | show ethernet-switching table
 *   | show log messages | show diagnostics tdr interface <if> | request diagnostics tdr start interface <if>
 *   | clear interfaces statistics <if>|all
 *   configure: interfaces <if> disable · interfaces <if> speed 10m|100m|1g · interfaces <if> link-mode full-duplex|half-duplex
 *   · interfaces <if> ether-options no-auto-negotiation
 * CLIENT / SERVER (Linux): ethtool eth0 · ethtool -S eth0 · ip -s link show eth0 · ip addr · dmesg / sudo dmesg
 *   · sudo ethtool -s eth0 autoneg on · sudo ethtool -s eth0 speed <10|100> duplex <half|full> autoneg off
 *   CLIENT also: ping -c <n> 10.30.30.20 (n ≤ 10) · ping -c <n> -q 10.30.30.20 · iperf3 -c 10.30.30.20 -t 10 [-R]
 */

export interface L1CliApi {
  s: L1State;
  act: (a: L1Action) => L1State;
  dev: SpDevCli<L1JCfg>;
}
const PEER: Record<string, string> = { "ACCESS-SW:ge-0/0/1": "CLIENT", [`ACCESS-SW:${UPLINK}`]: "DIST-SW (uplink, fiber)", "DIST-SW:ge-0/0/2": "SERVER", [`DIST-SW:${UPLINK}`]: "ACCESS-SW (uplink, fiber)" };
const ifArg = (r: L1Sw, copperOnly = false): CliArgSpec => {
  const list = SW_IFS[r].filter((i) => !copperOnly || i !== UPLINK);
  return { choices: list, describe: (c) => `to ${PEER[`${r}:${c}`] ?? "?"}`, resolve: (raw) => list.find((i) => i === raw.replace(/\.0$/, "")) };
};
const ifOrAll = (r: L1Sw): CliArgSpec => ({ choices: [...SW_IFS[r], "all"], describe: (c) => (c === "all" ? "Every interface" : `to ${PEER[`${r}:${c}`]}`), resolve: (raw) => (raw === "all" ? "all" : SW_IFS[r].find((i) => i === raw.replace(/\.0$/, ""))) });
const fmt = (n: number) => n.toLocaleString("en-US").replace(/,/g, "");
const mw = (dbm: number) => (dbm <= LOS_DBM ? "0.0000 mW / - Inf dBm" : `${Math.pow(10, dbm / 10).toFixed(4)} mW / ${dbm.toFixed(2)} dBm`);
const ago = (s: L1State, t?: number) => {
  if (t === undefined) return "2026-08-31 08:58:14 UTC (5w6d 00:01 ago)";
  const d = Math.max(0, Math.floor(s.clock - t));
  return `2026-10-11 ${spStamp(t).hms} UTC (${String(Math.floor(d / 3600)).padStart(2, "0")}:${String(Math.floor(d / 60) % 60).padStart(2, "0")}:${String(d % 60).padStart(2, "0")} ago)`;
};
const linkOf = (s: L1State, r: L1Sw, ifn: string) => {
  const v = l1View(s);
  if (ifn === UPLINK) return { up: v.uplink.up, admin: r === "ACCESS-SW" ? v.uplink.adminA : v.uplink.adminD, copper: undefined as CopperLink | undefined, v };
  const c = r === "ACCESS-SW" ? v.client : v.server;
  return { up: c.up, admin: !c.adminDown, copper: c, v };
};
const flapOf = (s: L1State, r: L1Sw, ifn: string) => (ifn === UPLINK ? s.flap.uplink : r === "ACCESS-SW" ? s.flap.client : s.flap.server);

// ---------------------------------------------------------------------------------------------------------------
// Junos outputs
// ---------------------------------------------------------------------------------------------------------------
function terse(s: L1State, r: L1Sw): string {
  const rows = SW_IFS[r].map((ifn) => {
    const l = linkOf(s, r, ifn);
    const a = l.admin ? "up" : "down";
    const o = l.up ? "up" : "down";
    return `${pad(ifn, 24)}${pad(a, 6)}${o}\n${pad(`${ifn}.0`, 24)}${pad(a, 6)}${pad(o, 5)}eth-switch`;
  });
  return [`${pad("Interface", 24)}${pad("Admin", 6)}${pad("Link", 5)}${pad("Proto", 9)}Local                 Remote`, ...rows, `${pad("irb", 24)}${pad("up", 6)}up`, `${pad("me0", 24)}${pad("up", 6)}up`].join("\n");
}
function physHeader(s: L1State, r: L1Sw, ifn: string): string[] {
  const l = linkOf(s, r, ifn);
  const c = l.copper;
  const speed = ifn === UPLINK ? "1000mbps" : c && l.up ? `${c.speed}mbps` : "Auto";
  const mode = ifn === UPLINK ? "Full-duplex" : c && l.up ? (c.swDuplex === "full" ? "Full-duplex" : "Half-duplex") : "Auto";
  const auto = ifn === UPLINK ? "Enabled" : c?.swAuto ? "Enabled" : "Disabled";
  const rf = ifn === UPLINK ? `, Remote fault: ${l.v.uplink.remoteFault ? "Offline" : "Online"}` : "";
  const media = ifn === UPLINK ? "Fiber" : "Copper";
  return [
    `Physical interface: ${ifn}, ${l.admin ? "Enabled" : "Administratively down"}, Physical link is ${l.up ? "Up" : "Down"}`,
    `  Interface index: ${IFINDEX[ifn] - 382}, SNMP ifIndex: ${IFINDEX[ifn]}`,
    `  Description: ${PEER[`${r}:${ifn}`]}`,
    `  Link-level type: Ethernet, MTU: 1514, LAN-PHY mode, Link-mode: ${mode}, Speed: ${speed}, BPDU Error: None, Loop Detect PDU Error: None, MAC-REWRITE Error: None, Loopback: Disabled, Source filtering: Disabled, Flow control: Enabled, Auto-negotiation: ${auto}${rf}, Media type: ${media}`,
    `  Device flags   : Present Running${l.up ? "" : " Down"}`,
    `  Interface flags: ${l.admin ? (l.up ? "SNMP-Traps Internal: 0x4000" : "Hardware-Down SNMP-Traps Internal: 0x4000") : "Down SNMP-Traps Internal: 0x4000"}`,
    `  Current address: ${SW_MAC[r].slice(0, -2)}${(IFINDEX[ifn] % 256).toString(16).padStart(2, "0")}, Hardware address: ${SW_MAC[r].slice(0, -2)}${(IFINDEX[ifn] % 256).toString(16).padStart(2, "0")}`,
    `  Last flapped   : ${ago(s, flapOf(s, r, ifn))}`,
  ];
}
function iface(s: L1State, r: L1Sw, ifn: string): string {
  const c = swCtr(s, `${r}:${ifn}`);
  return [...physHeader(s, r, ifn), "  Input rate     : 0 bps (0 pps)", "  Output rate    : 0 bps (0 pps)", `  Active alarms  : ${linkOf(s, r, ifn).up || !linkOf(s, r, ifn).admin ? "None" : "LINK"}`, `  Active defects : ${linkOf(s, r, ifn).up || !linkOf(s, r, ifn).admin ? "None" : "LINK"}`, `  Input errors: ${fmt(c.crc + c.runts)}, Output errors: 0`, "", `  Logical interface ${ifn}.0 (Index 555) (SNMP ifIndex ${IFINDEX[ifn] + 40})`, "    Flags: Up SNMP-Traps 0x4004000 Encapsulation: Ethernet-Bridge", "    Protocol eth-switch, MTU: 1514"].join("\n");
}
function extensive(s: L1State, r: L1Sw, ifn: string): string {
  const key = `${r}:${ifn}`;
  const c = swCtr(s, key);
  const l = linkOf(s, r, ifn);
  const cleared = s.cleared[key].at;
  const cu = l.copper;
  const auto: string[] = [];
  if (ifn === UPLINK) {
    auto.push("  Autonegotiation information:", `    Negotiation status: ${l.up ? "Complete" : "Incomplete"}`, "    Link partner:", `        Link mode: ${l.up ? "Full-duplex" : "Unknown"}, Flow control: Symmetric/Asymmetric, Remote fault: ${l.v.uplink.remoteFault ? "Link failure" : "OK"}`, "    Local resolution:", `        Flow control: Symmetric, Remote fault: ${l.up ? "Link OK" : "Link failure"}`);
  } else if (cu?.swAuto) {
    const partnerAuto = r === "ACCESS-SW" ? s.host.CLIENT.autoneg : s.host.SERVER.autoneg;
    auto.push("  Autonegotiation information:", `    Negotiation status: ${!l.up ? "Incomplete" : partnerAuto ? "Complete" : "No-autonegotiation (parallel detection)"}`);
    if (l.up && partnerAuto) auto.push("    Link partner:", `        Link mode: ${cu.hostDuplex === "full" ? "Full-duplex" : "Half-duplex"}, Flow control: Symmetric/Asymmetric, Remote fault: OK, Link partner Speed: ${cu.downshift ? "1000 Mbps (downshifted)" : `${cu.speed} Mbps`}`, "    Local resolution:", `        Flow control: Symmetric, Remote fault: Link OK${cu.downshift ? ", Downshift: 1000 -> 100 Mbps" : ""}`);
  }
  return [
    ...physHeader(s, r, ifn),
    `  Statistics last cleared: ${cleared === undefined ? "Never" : `2026-10-11 ${spStamp(cleared).hms} UTC (${ago(s, cleared).replace(/^.*\(/, "").replace(")", "")})`}`,
    "  Traffic statistics:",
    `   Input  bytes  :      ${pad(fmt(c.inPkts * 742), 22)}0 bps`,
    `   Output bytes  :      ${pad(fmt(c.outPkts * 742), 22)}0 bps`,
    `   Input  packets:      ${pad(fmt(c.inPkts), 22)}0 pps`,
    `   Output packets:      ${pad(fmt(c.outPkts), 22)}0 pps`,
    "  Input errors:",
    `    Errors: ${c.crc + c.runts}, Drops: 0, Framing errors: ${c.crc}, Runts: ${c.runts}, Policed discards: 0, L3 incompletes: 0, L2 channel errors: 0, L2 mismatch timeouts: 0, FIFO errors: 0, Resource errors: 0`,
    "  Output errors:",
    `    Carrier transitions: ${c.carrier}, Errors: 0, Drops: 0, Collisions: 0, Aged packets: 0, FIFO errors: 0, HS link CRC errors: 0, MTU errors: 0, Resource errors: 0`,
    "  MAC statistics:                      Receive         Transmit",
    `    Total octets                   ${pad(fmt(c.inPkts * 742 + c.crc * 742), 18)}${fmt(c.outPkts * 742)}`,
    `    Total packets                  ${pad(fmt(c.inPkts + c.crc + c.runts), 18)}${fmt(c.outPkts)}`,
    `    CRC/Align errors               ${pad(c.crc, 18)}0`,
    "    FIFO errors                    0                 0",
    "    MAC control frames             0                 0",
    "    MAC pause frames               0                 0",
    "    Oversized frames               0",
    "    Jabber frames                  0",
    `    Fragment frames                ${c.runts}`,
    "    Code violations                0",
    ...auto,
  ].join("\n");
}
function optics(s: L1State, r: L1Sw, ifn: string): string | { output: string; explanation: string } {
  if (ifn !== UPLINK) return { output: "", explanation: `${ifn} is a copper (1000BASE-T) port: it has no optical transceiver, so there are no diagnostics optics. Use show interfaces ${ifn} extensive and the TDR test instead.` };
  const v = l1View(s);
  const tx = r === "ACCESS-SW" ? v.uplink.txA : v.uplink.txD;
  const rx = r === "ACCESS-SW" ? v.uplink.rxA : v.uplink.rxD;
  const onoff = (b: boolean) => (b ? "On" : "Off");
  return [
    `Physical interface: ${ifn}`,
    `    Laser bias current                        :  ${tx <= LOS_DBM ? "0.000" : r === "ACCESS-SW" ? "17.320" : "17.104"} mA`,
    `    Laser output power                        :  ${mw(tx)}`,
    `    Module temperature                        :  ${r === "ACCESS-SW" ? 36 : 38} degrees C / ${r === "ACCESS-SW" ? 97 : 100} degrees F`,
    "    Module voltage                            :  3.2950 V",
    `    Receiver signal average optical power     :  ${mw(rx)}`,
    "    Laser bias current high alarm             :  Off",
    `    Laser bias current low alarm              :  ${onoff(tx <= LOS_DBM)}`,
    "    Laser bias current high warning           :  Off",
    `    Laser bias current low warning            :  ${onoff(tx <= LOS_DBM)}`,
    "    Laser output power high alarm             :  Off",
    `    Laser output power low alarm              :  ${onoff(tx <= LOS_DBM)}`,
    "    Laser output power high warning           :  Off",
    `    Laser output power low warning            :  ${onoff(tx <= LOS_DBM)}`,
    "    Module temperature high alarm             :  Off",
    "    Module temperature low alarm              :  Off",
    "    Module voltage high alarm                 :  Off",
    "    Module voltage low alarm                  :  Off",
    "    Laser rx power high alarm                 :  Off",
    `    Laser rx power low alarm                  :  ${onoff(rx < -22)}`,
    "    Laser rx power high warning               :  Off",
    `    Laser rx power low warning                :  ${onoff(rx < -14)}`,
    "    Laser output power high alarm threshold   :  0.7943 mW / -1.00 dBm",
    "    Laser output power low alarm threshold    :  0.0794 mW / -11.00 dBm",
    "    Laser rx power high alarm threshold       :  1.2589 mW / 1.00 dBm",
    "    Laser rx power low alarm threshold        :  0.0063 mW / -22.00 dBm",
    "    Laser rx power high warning threshold     :  0.7943 mW / -1.00 dBm",
    "    Laser rx power low warning threshold      :  0.0398 mW / -14.00 dBm",
  ].join("\n");
}
function pic(r: L1Sw): string {
  return [`FPC slot 0, PIC slot 0 information:`, `  Type                             48x 10/100/1000 Base-T + 4x 1G SFP`, "  State                            Online", "  PIC version                 1.6", "  Uptime                      41 days, 1 hour", "", "PIC port information:", "                         Fiber                    Xcvr vendor       Wave-    Xcvr", "  Port  Cable type       type  Xcvr vendor        part number       length   Firmware", `  47    GIGE 1000LX10    SM    JUNIPER-OPTICS     SFP-LX10-${r === "ACCESS-SW" ? "A1" : "B2"}       1310 nm  0.0`].join("\n");
}
function swTable(s: L1State, r: L1Sw): string {
  const v = l1View(s);
  const rows: string[] = [];
  const row = (mac: string, ifn: string) => `   ${pad("USERS", 20)}${pad(mac.toLowerCase(), 20)}${pad("D", 12)}${pad("-", 6)}${pad(`${ifn}.0`, 23)}0         0`;
  const clientHere = r === "ACCESS-SW" ? v.client.up : v.reach;
  const serverHere = r === "DIST-SW" ? v.server.up : v.reach;
  if (clientHere) rows.push(row(L1_MAC.CLIENT, r === "ACCESS-SW" ? "ge-0/0/1" : UPLINK));
  if (serverHere) rows.push(row(L1_MAC.SERVER, r === "DIST-SW" ? "ge-0/0/2" : UPLINK));
  return ["", "MAC flags (S - static MAC, D - dynamic MAC, L - locally learned, P - Persistent static", "           SE - statistics enabled, NM - non configured MAC, R - remote PE MAC, O - ovsdb MAC)", "", "", `Ethernet switching table : ${rows.length} entries, ${rows.length} learned`, "Routing instance : default-switch", `   ${pad("Vlan", 20)}${pad("MAC", 20)}${pad("MAC", 12)}${pad("Age", 6)}${pad("Logical", 23)}NH        RTR`, `   ${pad("name", 20)}${pad("address", 20)}${pad("flags", 12)}${pad("", 6)}${pad("interface", 23)}Index     ID`, ...rows].join("\n");
}
function logs(s: L1State, r: L1Sw): string {
  const base = [`Oct 11 08:59:58  ${r} mgd[2211]: UI_LOGIN_EVENT: User 'admin' login, class 'j-super-user' [41092]`];
  return [...base, ...s.sys.filter((x) => x.dev === r).map((x) => `Oct 11 ${spStamp(x.t).hms}  ${r} ${x.text}`)].join("\n");
}
function tdr(s: L1State, r: L1Sw, ifn: string): string | { output: string; explanation: string } {
  if (ifn === UPLINK) return { output: "", explanation: "TDR tests copper pairs; ge-0/0/47 is fiber. Use show interfaces diagnostics optics instead." };
  const t = s.tdr[r];
  if (!t) return { output: "", explanation: `No TDR result yet for ${ifn}. Start one with: request diagnostics tdr start interface ${ifn} (the link drops for a few seconds while it runs).` };
  const v = l1View(s);
  const c = r === "ACCESS-SW" ? v.client : v.server;
  const broken = r === "ACCESS-SW" && s.phys.clientPair;
  const pair = (p: string, open: boolean) => [`MDI pair                        : ${p}`, `  Cable status                  : ${open ? "Open" : "Normal"}`, `  Distance fault                : ${open ? 12 : 0} Meters`, "  Polarity swap                 : N/A", "  Skew time                     : N/A"];
  return ["Interface TDR detail:", `Interface name                  : ${ifn}`, "Test status                     : Passed", `Link status                     : ${c.up ? "UP" : "DOWN"}`, ...pair("1-2", false), ...pair("3-6", false), ...pair("4-5", broken), ...pair("7-8", false), `Channel pair                    : 1`, "  Pair swap                     : N/A", `Downshift                       : ${c.downshift ? "Yes" : "No"}`].join("\n");
}

// ---------------------------------------------------------------------------------------------------------------
// Junos configuration
// ---------------------------------------------------------------------------------------------------------------
export function l1JnStmts(r: L1Sw, c: L1JCfg): JStmt[] {
  const out: JStmt[] = [];
  for (const ifn of SW_IFS[r]) {
    const ic = c.ifs[ifn] ?? {};
    out.push({ path: ["interfaces", ifn], leaf: `description "${PEER[`${r}:${ifn}`]}"` });
    if (ic.disable) out.push({ path: ["interfaces", ifn], leaf: "disable" });
    if (ic.eth?.speed) out.push({ path: ["interfaces", ifn], leaf: `speed ${ic.eth.speed}` });
    if (ic.eth?.linkMode) out.push({ path: ["interfaces", ifn], leaf: `link-mode ${ic.eth.linkMode}` });
    if (ic.eth?.noAuto) out.push({ path: ["interfaces", ifn, "ether-options"], leaf: "no-auto-negotiation" });
    out.push({ path: ["interfaces", ifn, "unit 0", "family ethernet-switching"], leaf: `interface-mode ${ifn === UPLINK ? "trunk" : "access"}` }, { path: ["interfaces", ifn, "unit 0", "family ethernet-switching", "vlan"], leaf: "members USERS" });
  }
  out.push({ path: ["vlans", "USERS"], leaf: "vlan-id 30" });
  return out;
}
const ensureIf = (c: L1JCfg, ifn: string): { disable?: boolean; eth?: EthOpts } => (c.ifs[ifn] ??= {});
const ensureEth = (c: L1JCfg, ifn: string): EthOpts => (ensureIf(c, ifn).eth ??= {});
const tidy = (c: L1JCfg, ifn: string) => {
  const e = c.ifs[ifn]?.eth;
  if (e && !e.noAuto && !e.speed && !e.linkMode) delete c.ifs[ifn].eth;
  return c;
};
export function l1Validate(c: L1JCfg): string | undefined {
  for (const [ifn, ic] of Object.entries(c.ifs)) if (ic.eth?.noAuto && ic.eth.speed === "1g") return `error: interface ${ifn}: 1000BASE-T requires auto-negotiation — speed 1g can't be combined with no-auto-negotiation`;
  return undefined;
}
function stmts(r: L1Sw): SpCfgStmt<L1JCfg>[] {
  const ifd = ifArg(r);
  const ife = ifArg(r);
  const fiberNote = (ifn: string) => (ifn === UPLINK ? `error: ${UPLINK} is a 1000BASE-LX fiber port: speed and duplex are fixed by the optic (this lab keeps them)` : undefined);
  return [
    { id: "j-dis", summary: "Disable the interface (administratively down; a fiber port turns its laser off)", args: { ifd }, junos: { syntax: "interfaces <ifd> disable", set: (c, a) => ((ensureIf(c, a.ifd).disable = true), c), del: (c, a) => (c.ifs[a.ifd] && delete c.ifs[a.ifd].disable, c) } },
    { id: "j-spd", summary: "Speed (with auto-negotiation on: the only speed advertised; with it off: the forced speed)", args: { ife, spd: choiceArg(["10m", "100m", "1g"], (x) => ({ "10m": "10 Mb/s", "100m": "100 Mb/s", "1g": "1 Gb/s" })[x]) }, junos: { syntax: "interfaces <ife> speed <spd>", set: (c, a) => fiberNote(a.ife) ?? ((ensureEth(c, a.ife).speed = a.spd as EthOpts["speed"]), c), del: (c, a) => (c.ifs[a.ife]?.eth && delete c.ifs[a.ife].eth!.speed, tidy(c, a.ife)) } },
    { id: "j-spd-del", summary: "The speed setting (delete it without a value)", args: { ife }, junos: { syntax: "interfaces <ife> speed", set: () => "error: missing mandatory argument: speed needs a value (10m, 100m or 1g)", del: (c, a) => (c.ifs[a.ife]?.eth && delete c.ifs[a.ife].eth!.speed, tidy(c, a.ife)) } },
    { id: "j-lm", summary: "Duplex: full-duplex or half-duplex", args: { ife, lm: choiceArg(["full-duplex", "half-duplex"]) }, junos: { syntax: "interfaces <ife> link-mode <lm>", set: (c, a) => fiberNote(a.ife) ?? ((ensureEth(c, a.ife).linkMode = a.lm as EthOpts["linkMode"]), c), del: (c, a) => (c.ifs[a.ife]?.eth && delete c.ifs[a.ife].eth!.linkMode, tidy(c, a.ife)) } },
    { id: "j-lm-del", summary: "The duplex setting (delete it without a value)", args: { ife }, junos: { syntax: "interfaces <ife> link-mode", set: () => "error: missing mandatory argument: link-mode needs full-duplex or half-duplex", del: (c, a) => (c.ifs[a.ife]?.eth && delete c.ifs[a.ife].eth!.linkMode, tidy(c, a.ife)) } },
    { id: "j-noan", summary: "Turn auto-negotiation off (speed and duplex are then forced)", args: { ife }, junos: { syntax: "interfaces <ife> ether-options no-auto-negotiation", set: (c, a) => fiberNote(a.ife) ?? ((ensureEth(c, a.ife).noAuto = true), c), del: (c, a) => (c.ifs[a.ife]?.eth && delete c.ifs[a.ife].eth!.noAuto, tidy(c, a.ife)) } },
    { id: "j-eo", summary: "All Ethernet options of the interface", args: { ife }, junos: { syntax: "interfaces <ife> ether-options", set: (c) => c, del: (c, a) => (c.ifs[a.ife]?.eth && delete c.ifs[a.ife].eth!.noAuto, tidy(c, a.ife)) } },
  ];
}
export function l1JunosSpec(api: L1CliApi, r: L1Sw): SpJunosSpec<L1JCfg> {
  const s = api.s;
  const sh = (id: string, syntax: string, summary: string, run: SpCmd["run"], args?: SpCmd["args"]): SpCmd => ({ id, syntax, summary, run, args });
  const shows: SpCmd[] = [
    sh("terse", "show interfaces terse", "Interfaces: admin and link state", () => terse(s, r)),
    sh("if", "show interfaces <ifb>", "One interface: state, speed, duplex, auto-negotiation, last flap", (a) => iface(s, r, a.ifb), { ifb: ifArg(r) }),
    sh("ext", "show interfaces <ifx> extensive", "Every counter: CRC/align, runts, carrier transitions, auto-negotiation", (a) => extensive(s, r, a.ifx), { ifx: ifArg(r) }),
    sh("opt", "show interfaces diagnostics optics <ifo>", "Optical levels (DOM): Tx/Rx power, alarms and thresholds", (a) => optics(s, r, a.ifo), { ifo: ifArg(r) }),
    sh("pic", "show chassis pic fpc-slot 0 pic-slot 0", "The ports and their transceivers", () => pic(r)),
    sh("est", "show ethernet-switching table", "Learned MAC addresses", () => swTable(s, r)),
    sh("log", "show log messages", "System log: link up/down, commits", () => logs(s, r)),
    sh("tdr", "show diagnostics tdr interface <ift>", "Result of the last TDR cable test", (a) => tdr(s, r, a.ift), { ift: ifArg(r) }),
  ];
  const op: SpCmd[] = [
    sh("clr", "clear interfaces statistics <ifs>", "Reset the counters shown by show interfaces", (a) => {
      api.act({ type: "clear-stats", dev: r, ifn: a.ifs === "all" ? undefined : a.ifs });
      return "";
    }, { ifs: ifOrAll(r) }),
    sh("tdrs", "request diagnostics tdr start interface <ifr>", "Run a TDR cable test on a copper port (the link drops briefly)", (a) => {
      if (a.ifr === UPLINK) return { output: "", explanation: "TDR tests copper pairs; ge-0/0/47 is fiber." };
      api.act({ type: "tdr", dev: r });
      return { output: "Test successfully executed.", explanation: `Read it with: show diagnostics tdr interface ${a.ifr}` };
    }, { ifr: ifArg(r, true) }),
  ];
  return { stmts: stmts(r), shows, op, jstmts: (c) => l1JnStmts(r, c), help: { "show interfaces": "Interface information", "show interfaces diagnostics": "Transceiver diagnostics", "show chassis": "Chassis information", "show ethernet-switching": "Ethernet switching information", "show log": "Log files", "show diagnostics": "Diagnostic test results", "request diagnostics": "Run diagnostic tests", "clear interfaces": "Clear interface information" } };
}

// ---------------------------------------------------------------------------------------------------------------
// Linux hosts
// ---------------------------------------------------------------------------------------------------------------
const exact = (v: string, what: string): CliArgSpec => ({ choices: [v], describe: () => what, resolve: (raw) => (raw === v ? raw : undefined) });
const ipArg = (choices: string[]): CliArgSpec => ({ choices, describe: (c) => (c === L1_IP.SERVER ? "SERVER" : c === L1_IP.CLIENT ? "CLIENT" : undefined), resolve: (raw) => (/^(\d{1,3}\.){3}\d{1,3}$/.test(raw) ? raw : undefined) });
const linkFor = (s: L1State, h: L1Host) => (h === "CLIENT" ? l1View(s).client : l1View(s).server);
function ethtool(s: L1State, h: L1Host): string {
  const l = linkFor(s, h);
  const he = s.host[h];
  const sw = s.sw[h === "CLIENT" ? "ACCESS-SW" : "DIST-SW"].ifs[h === "CLIENT" ? "ge-0/0/1" : "ge-0/0/2"] ?? {};
  const partner = !l.up ? "Not reported" : l.swAuto ? (sw.eth?.speed === "100m" ? "100baseT/Full" : sw.eth?.speed === "10m" ? "10baseT/Full" : "10baseT/Half 10baseT/Full\n\t                                     100baseT/Half 100baseT/Full\n\t                                     1000baseT/Full") : "Not reported";
  const adv = he.autoneg ? "10baseT/Half 10baseT/Full\n\t                        100baseT/Half 100baseT/Full\n\t                        1000baseT/Full" : "Not reported";
  return [
    "Settings for eth0:",
    "\tSupported ports: [ TP ]",
    "\tSupported link modes:   10baseT/Half 10baseT/Full",
    "\t                        100baseT/Half 100baseT/Full",
    "\t                        1000baseT/Full",
    "\tSupported pause frame use: No",
    "\tSupports auto-negotiation: Yes",
    `\tAdvertised link modes:  ${adv}`,
    `\tAdvertised auto-negotiation: ${he.autoneg ? "Yes" : "No"}`,
    `\tLink partner advertised link modes:  ${partner}`,
    `\tLink partner advertised auto-negotiation: ${l.up && l.swAuto ? "Yes" : "No"}`,
    `\tSpeed: ${l.up ? `${l.speed}Mb/s` : "Unknown!"}`,
    `\tDuplex: ${l.up ? (l.hostDuplex === "full" ? "Full" : "Half") : "Unknown! (255)"}`,
    `\tAuto-negotiation: ${he.autoneg ? "on" : "off"}`,
    "\tPort: Twisted Pair",
    "\tPHYAD: 1",
    "\tTransceiver: internal",
    "\tMDI-X: on (auto)",
    "\tSupports Wake-on: pumbg",
    "\tWake-on: g",
    "\tCurrent message level: 0x00000007 (7)",
    "\t\t\t       drv probe link",
    `\tLink detected: ${l.up ? "yes" : "no"}`,
  ].join("\n");
}
function ethS(s: L1State, h: L1Host): string {
  const c = s.hc[h];
  return ["NIC statistics:", `     rx_packets: ${c.rxPkts}`, `     tx_packets: ${c.txPkts}`, `     rx_errors: ${c.rxCrc}`, `     tx_errors: ${c.lateColl}`, "     rx_dropped: 0", "     tx_dropped: 0", `     collisions: ${c.collisions}`, "     rx_length_errors: 0", "     rx_over_errors: 0", `     rx_crc_errors: ${c.rxCrc}`, "     rx_frame_errors: 0", `     tx_abort_late_coll: ${c.lateColl}`, "     tx_deferred_ok: 0", `     tx_single_coll_ok: ${Math.round(c.collisions * 0.6)}`, `     tx_multi_coll_ok: ${Math.round(c.collisions * 0.3)}`, "     rx_missed_errors: 0", "     rx_align_errors: 0", "     tx_tcp_seg_good: 0"].join("\n");
}
function ipLink(s: L1State, h: L1Host): string {
  const c = s.hc[h];
  const l = linkFor(s, h);
  const mac = (h === "CLIENT" ? L1_MAC.CLIENT : L1_MAC.SERVER).toLowerCase();
  return [`2: eth0: <BROADCAST,MULTICAST,UP${l.up ? ",LOWER_UP" : ""}> mtu 1500 qdisc ${l.up ? "fq_codel" : "fq_codel"} state ${l.up ? "UP" : "DOWN"} mode DEFAULT group default qlen 1000`, `    link/ether ${mac} brd ff:ff:ff:ff:ff:ff`, "    RX:  bytes packets errors dropped  missed   mcast", `    ${pad(c.rxPkts * 742, 12)}${pad(c.rxPkts, 10)}${pad(c.rxCrc, 7)}${pad(0, 8)}${pad(0, 8)}0`, "    TX:  bytes packets errors dropped carrier collsns", `    ${pad(c.txPkts * 742, 12)}${pad(c.txPkts, 10)}${pad(c.lateColl, 7)}${pad(0, 8)}${pad(c.carrier, 8)}${c.collisions}`].join("\n");
}
function hostSet(api: L1CliApi, h: L1Host): CliCommandSet {
  const s = api.s;
  const me = h === "CLIENT" ? L1_IP.CLIENT : L1_IP.SERVER;
  const prompt = `admin@${h.toLowerCase()}:~$ `;
  const cmds: CliCommand[] = [];
  const add = (id: string, syntax: string, summary: string, run: CliCommand["run"], args?: CliCommand["args"], hidden?: boolean) => cmds.push({ id: `${h}-${id}`, syntax, summary, run, args, hidden });
  const eth0 = exact("eth0", "The wired interface");
  add("ethtool", "ethtool <if>", "Link settings: speed, duplex, auto-negotiation, link detected", () => ({ output: ethtool(s, h) }), { if: eth0 });
  add("ethS", "ethtool <sf> <if>", "NIC statistics (-S): CRC errors, collisions, late collisions", () => ({ output: ethS(s, h) }), { sf: exact("-S", "Statistics"), if: eth0 });
  add("link", "ip -s link show <if>", "Interface state and counters", () => ({ output: ipLink(s, h) }), { if: eth0 });
  add("addr", "ip addr", "Addresses", () => ({ output: `1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536\n    inet 127.0.0.1/8 scope host lo\n2: eth0: <BROADCAST,MULTICAST,UP${linkFor(s, h).up ? ",LOWER_UP" : ""}> mtu 1500 state ${linkFor(s, h).up ? "UP" : "DOWN"}\n    link/ether ${(h === "CLIENT" ? L1_MAC.CLIENT : L1_MAC.SERVER).toLowerCase()} brd ff:ff:ff:ff:ff:ff\n    inet ${me}/24 brd 10.30.30.255 scope global eth0` }));
  add("dmesg-nos", "dmesg", "Kernel messages (needs root on Ubuntu)", () => ({ output: "dmesg: read kernel buffer failed: Operation not permitted", refused: true }));
  add("dmesg", "sudo dmesg", "Kernel messages: NIC link up/down, negotiated speed and duplex", () => ({ output: ["[    2.104331] e1000e: Intel(R) PRO/1000 Network Driver", "[    2.211870] e1000e 0000:00:1f.6 eth0: (PCI Express:2.5GT/s:Width x1) " + (h === "CLIENT" ? L1_MAC.CLIENT : L1_MAC.SERVER).toLowerCase(), "[    6.882014] e1000e 0000:00:1f.6 eth0: NIC Link is Up 1000 Mbps Full Duplex, Flow Control: Rx/Tx", ...s.sys.filter((x) => x.dev === h).map((x) => `[${String((3_542_400 + x.t).toFixed(6)).padStart(13)}] ${x.text}`)].join("\n") }));
  add("autoneg", "sudo ethtool -s <if> autoneg on", "Re-enable auto-negotiation", () => {
    api.act({ type: "host", dev: h, eth: { autoneg: true }, text: "ethtool -s eth0 autoneg on" });
    return { output: "" };
  }, { if: eth0 });
  add("force", "sudo ethtool -s <if> speed <spd> duplex <dup> autoneg off", "Force speed and duplex (auto-negotiation off)", (a) => {
    if (a.spd === "1000") return { output: "netlink error: Invalid argument", refused: true, explanation: "1000BASE-T can't be forced: it needs auto-negotiation to train the link." };
    api.act({ type: "host", dev: h, eth: { autoneg: false, speed: +a.spd as HostEth["speed"], duplex: a.dup as HostEth["duplex"] }, text: `ethtool -s eth0 speed ${a.spd} duplex ${a.dup} autoneg off` });
    return { output: "" };
  }, { if: eth0, spd: choiceArg(["10", "100", "1000"]), dup: choiceArg(["half", "full"]) });
  if (h === "CLIENT") {
    const target = ipArg([L1_IP.SERVER]);
    const pingOut = (ns: L1State, n: number, quiet: boolean) => {
      const t = lastTest(ns, "ping")!;
      const lines = [`PING ${L1_IP.SERVER} (${L1_IP.SERVER}) 56(84) bytes of data.`];
      if (!quiet) for (let q = 1; q <= n; q++) if (t.unreachable || !t.lost!.includes(q)) lines.push(t.unreachable ? `From ${L1_IP.CLIENT} icmp_seq=${q} Destination Host Unreachable` : `64 bytes from ${L1_IP.SERVER}: icmp_seq=${q} ttl=64 time=0.${300 + ((q * 37) % 90)} ms`);
      const got = t.recv!;
      lines.push("", `--- ${L1_IP.SERVER} ping statistics ---`, `${n} packets transmitted, ${got} received, ${t.unreachable ? `+${n} errors, ` : ""}${Math.round((100 * (n - got)) / n)}% packet loss, time ${n * 1000 - 999 + (t.unreachable ? 21 : 0)}ms`);
      if (got) lines.push("rtt min/avg/max/mdev = 0.301/0.344/0.389/0.024 ms");
      return lines.join("\n");
    };
    add("ping", "ping -c <n> <ip>", "Send <n> echo requests (up to 10 shown line by line)", (a) => {
      if (a.ip !== L1_IP.SERVER) return { output: `PING ${a.ip} (${a.ip}) 56(84) bytes of data.\n\n--- ${a.ip} ping statistics ---\n${a.n} packets transmitted, 0 received, 100% packet loss`, explanation: "This lab's target is SERVER, 10.30.30.20." };
      const n = +a.n;
      const ns = l1Apply(s, { type: "ping", count: n });
      api.act({ type: "ping", count: n });
      return { output: pingOut(ns, n, false) };
    }, { n: numArg(1, 10, ["4"], "Count (1–10; use -q for longer series)"), ip: target });
    add("pingq", "ping -c <n> -q <ip>", "A long ping series, summary only (e.g. -c 100)", (a) => {
      if (a.ip !== L1_IP.SERVER) return { output: "", explanation: "This lab's target is SERVER, 10.30.30.20." };
      const n = +a.n;
      const ns = l1Apply(s, { type: "ping", count: n });
      api.act({ type: "ping", count: n });
      return { output: pingOut(ns, n, true) };
    }, { n: numArg(1, 200, ["100"], "Count"), ip: target });
    const iperf = (rev: boolean) => () => {
      const v = l1View(s);
      const r = iperfRate(v, rev);
      api.act({ type: "iperf", reverse: rev });
      if (!r) return { output: `iperf3: error - unable to connect to server - server may have stopped running or use a different port, firewall issue, etc.: No route to host`, refused: true };
      const lines = [`Connecting to host ${L1_IP.SERVER}, port 5201`];
      if (rev) lines.push(`Reverse mode, remote host ${L1_IP.SERVER} is sending`);
      lines.push(`[  5] local ${L1_IP.CLIENT} port 4${rev ? "3122" : "3120"} connected to ${L1_IP.SERVER} port 5201`, rev ? "[ ID] Interval           Transfer     Bitrate" : "[ ID] Interval           Transfer     Bitrate         Retr  Cwnd");
      const mb = (x: number) => (x >= 100 ? `${Math.round(x)} MBytes` : `${x.toFixed(2)} MBytes`);
      for (let k = 0; k < 10; k++) {
        const wob = r.mbps * (1 + (((k * 7) % 5) - 2) / 400);
        const retr = Math.round((r.retr / 10) * (k % 3 === 0 ? 1.3 : 0.85));
        lines.push(`[  5]   ${pad(`${k.toFixed(2)}-${(k + 1).toFixed(2)}`, 12)}sec  ${pad(mb(wob / 8), 11)}  ${pad(`${wob >= 100 ? Math.round(wob) : wob.toFixed(2)} Mbits/sec`, 16)}${rev ? "" : `${pad(retr, 5)} ${r.mbps >= 900 ? "411" : r.mbps >= 90 ? "93.4" : "8.48"} KBytes`}`);
      }
      const tot = (r.mbps * 10) / 8;
      const totTxt = tot >= 1000 ? `${(tot / 1024).toFixed(2)} GBytes` : `${tot >= 100 ? Math.round(tot) : tot.toFixed(1)} MBytes`;
      lines.push("- - - - - - - - - - - - - - - - - - - - - - - - -", "[ ID] Interval           Transfer     Bitrate         Retr", `[  5]   0.00-10.00  sec  ${pad(totTxt, 11)}  ${pad(`${r.mbps} Mbits/sec`, 16)}${pad(r.retr, 5)}             sender`, `[  5]   0.00-10.04  sec  ${pad(totTxt, 11)}  ${pad(`${r.mbps >= 100 ? Math.round(r.mbps * 0.998) : (r.mbps * 0.998).toFixed(2)} Mbits/sec`, 16)}                  receiver`, "", "iperf Done.");
      return { output: lines.join("\n") };
    };
    add("iperf", "iperf3 -c <ip> -t 10", "Throughput test, CLIENT sends (upload)", iperf(false), { ip: target });
    add("iperfR", "iperf3 -c <ip> -t 10 <rf>", "Throughput test, SERVER sends (-R, download)", iperf(true), { ip: target, rf: exact("-R", "Reverse: the server sends") });
  }
  return { vendor: "cisco", deviceId: h, deviceName: h, prompt, commands: cmds };
}

export function l1Sets(api: L1CliApi, d: L1D): Partial<Record<CliVendor, CliCommandSet>> {
  if (d === "ACCESS-SW" || d === "DIST-SW") return { juniper: buildJunosSet(api.dev, l1JunosSpec(api, d)) };
  const h = hostSet(api, d);
  return { cisco: h, juniper: h };
}
export const l1Pipe = (api: L1CliApi, r: L1Sw) => ({ config: junosPipeConfig(api.dev, { jstmts: (c: L1JCfg) => l1JnStmts(r, c) }), rollbacks: api.dev.hist.length });
export function l1StaticApi(s: L1State, d: L1D): L1CliApi {
  const sw = d === "ACCESS-SW" || d === "DIST-SW";
  return { s, act: () => s, dev: { host: d, running: sw ? s.sw[d] : { ifs: {} }, hist: sw ? s.hist[d] : [], setCand: () => undefined, xr: [], setXr: () => undefined, edit: false, setEdit: () => undefined, commit: () => undefined, validate: l1Validate } };
}
export { IF_HOST };
