import type { CliArgSpec, CliCommand, CliCommandSet, CliVendor } from "@/lib/cli/types";
import { buildJunosSet, choiceArg, junosPipeConfig, numArg, type SpCfgStmt, type SpCmd, type SpDevCli, type SpJunosSpec } from "@/components/sp-lab/spCli";
import { pad, type JStmt } from "@/components/sp-lab/spKit";
import { PA, PA_MAC, SERVICE_PORT } from "@/lib/sim-engine/scenarios/troubleshootingPacketAnalysis";
import {
  BAD_GW,
  GOOD_GW,
  NC_TIMEOUT_S,
  SPAN_OUT,
  ctr,
  lastTest,
  paApply,
  pcapFilter,
  rowLine,
  type CapPt,
  type CapRow,
  type PaAction,
  type PaD,
  type PaJCfg,
  type PaState,
  paAge,
  paStamp,
  PA_BOOT,
} from "@/lib/sim-engine/scenarios/paNet";

/**
 * Command lines of the Packet Analysis Lab. Every output is printed from the lab model (paNet.ts).
 *
 * SW1 (Junos EX, ELS): show interfaces terse | show interfaces <if> extensive | show ethernet-switching table | show vlans
 *   | show forwarding-options analyzer | clear interfaces statistics <if>|all
 *   configure: forwarding-options analyzer CAP input ingress|egress interface ge-0/0/1 · output interface ge-0/0/23
 * R1 (Junos): show interfaces terse | show interfaces <if> extensive | show interfaces queue ge-0/0/0
 *   | show class-of-service interface ge-0/0/0 | show route | show arp no-resolve | monitor traffic interface <if> no-resolve
 *   | clear interfaces statistics <if>|all ; configure: class-of-service interfaces ge-0/0/0 shaping-rate <rate>
 * CLIENT / SERVER / CAPTURE (Linux): nc -vz -w 5 · curl -skv --connect-timeout 5 · ping -c · tcpdump [-nn[S][e][v]] -r <pcap>
 *   [filter] · ss -tan / -tln · ip addr · ip route · ip neigh [flush dev eth0] · ip -s link show <if>
 *   · systemctl status nginx · sudo systemctl start|stop nginx · sudo iptables -L INPUT -n -v · sudo iptables -A|-D INPUT
 *   -p tcp --dport 443 -j DROP · sudo ip route replace default via <ip>
 */

export interface PaCliApi {
  s: PaState;
  act: (a: PaAction) => PaState;
  dev: SpDevCli<PaJCfg>;
}
type J = "SW1" | "R1";
const nginxSince = (s: PaState) => [...s.sys].reverse().find((x) => x.dev === "SERVER" && /nginx/.test(x.text))?.t ?? PA_BOOT.nginx;
const age = (s: PaState) => paAge(s.clock, nginxSince(s));
const IFS: Record<J, { ifn: string; peer: string; mac?: string; addr?: string }[]> = {
  SW1: [
    { ifn: "ge-0/0/1", peer: "CLIENT" },
    { ifn: "ge-0/0/23", peer: "CAPTURE (analyzer output)" },
    { ifn: "ge-0/0/24", peer: "R1" },
  ],
  R1: [
    { ifn: "ge-0/0/0", peer: "SW1 (CLIENT LAN)", mac: PA_MAC.R1_LAN, addr: `${PA.gw}/24` },
    { ifn: "ge-0/0/1", peer: "SERVER", mac: PA_MAC.R1_SRV, addr: `${PA.r1Srv}/24` },
  ],
};
const ifArg = (r: J): CliArgSpec => ({ choices: IFS[r].map((i) => i.ifn), describe: (c) => `to ${IFS[r].find((i) => i.ifn === c)?.peer ?? "?"}`, resolve: (raw) => IFS[r].find((i) => i.ifn === raw.replace(/\.0$/, ""))?.ifn });
const ifOrAll = (r: J): CliArgSpec => ({ choices: [...IFS[r].map((i) => i.ifn), "all"], describe: (c) => (c === "all" ? "Every interface" : `to ${IFS[r].find((i) => i.ifn === c)?.peer}`), resolve: (raw) => (raw === "all" ? "all" : IFS[r].find((i) => i.ifn === raw.replace(/\.0$/, ""))?.ifn) });

// ---------------------------------------------------------------------------------------------------------------
// Junos outputs
// ---------------------------------------------------------------------------------------------------------------
function terse(s: PaState, r: J): string {
  const rows = IFS[r].map((i) => `${pad(i.ifn, 24)}${pad("up", 6)}up\n${pad(`${i.ifn}.0`, 24)}${pad("up", 6)}${pad("up", 5)}${r === "SW1" ? (i.ifn === SPAN_OUT ? "" : "eth-switch") : `inet     ${i.addr}`}`);
  return [`${pad("Interface", 24)}${pad("Admin", 6)}${pad("Link", 5)}${pad("Proto", 9)}Local`, ...rows, `${pad("lo0", 24)}${pad("up", 6)}up`].join("\n");
}
function extensive(s: PaState, r: J, ifn: string): string {
  const i = IFS[r].find((x) => x.ifn === ifn)!;
  const c = ctr(s, `${r}:${ifn}`);
  const idx = 148 + IFS[r].indexOf(i);
  const mac = i.mac ?? `2c:6b:f5:00:0${r === "SW1" ? 1 : 2}:${(10 + idx).toString(16)}`;
  const queued = c.out + c.drops;
  return [
    `Physical interface: ${ifn}, Enabled, Physical link is Up`,
    `  Interface index: ${idx}, SNMP ifIndex: ${idx + 378}`,
    `  Description: to ${i.peer}`,
    "  Link-level type: Ethernet, MTU: 1514, Speed: 1000mbps, BPDU Error: None, Duplex: Full-Duplex",
    `  Current address: ${mac.toLowerCase()}, Hardware address: ${mac.toLowerCase()}`,
    `  Last flapped   : ${paStamp(PA_BOOT.link).junos} (${paAge(s.clock, PA_BOOT.link)} ago)`,
    `  Statistics last cleared: ${s.cleared[`${r}:${ifn}`].in || s.cleared[`${r}:${ifn}`].out || s.cleared[`${r}:${ifn}`].drops ? paStamp(s.clock - 5).junos : "Never"}`,
    "  Traffic statistics:",
    `   Input  packets:             ${String(c.in).padStart(10)}`,
    `   Output packets:             ${String(c.out).padStart(10)}`,
    "  Input errors:",
    "    Errors: 0, Drops: 0, Framing errors: 0, Runts: 0, Policed discards: 0, L3 incompletes: 0, L2 channel errors: 0, L2 mismatch timeouts: 0, FIFO errors: 0, Resource errors: 0",
    "  Output errors:",
    `    Carrier transitions: 1, Errors: 0, Drops: ${c.drops}, Collisions: 0, Aged packets: 0, FIFO errors: 0, HS link CRC errors: 0, MTU errors: 0, Resource errors: 0`,
    "  Egress queues: 8 supported, 4 in use",
    "  Queue counters:       Queued packets  Transmitted packets      Dropped packets",
    `    0                     ${String(queued).padStart(12)}         ${String(c.out).padStart(12)}         ${String(c.drops).padStart(12)}`,
    `    1                                0                    0                    0`,
    `    2                                0                    0                    0`,
    `    3                                0                    0                    0`,
  ].join("\n");
}
function queue(s: PaState, ifn: string): string {
  const c = ctr(s, `R1:${ifn}`);
  return [
    `Physical interface: ${ifn}, Enabled, Physical link is Up`,
    `  Interface index: ${ifn === "ge-0/0/0" ? 148 : 149}, SNMP ifIndex: ${ifn === "ge-0/0/0" ? 526 : 527}`,
    "Forwarding classes: 16 supported, 4 in use",
    "Egress queues: 8 supported, 4 in use",
    "Queue: 0, Forwarding classes: best-effort",
    "  Queued:",
    `    Packets              : ${String(c.out + c.drops).padStart(21)}                     0 pps`,
    "  Transmitted:",
    `    Packets              : ${String(c.out).padStart(21)}                     0 pps`,
    `    Tail-dropped packets : ${String(c.drops).padStart(21)}                     0 pps`,
    `    RED-dropped packets  : ${String(0).padStart(21)}                     0 pps`,
  ].join("\n");
}
function cos(s: PaState, ifn: string): string {
  const shaped = ifn === "ge-0/0/0" && s.cfg.R1.shape;
  return [`Physical interface: ${ifn}, Index: ${ifn === "ge-0/0/0" ? 148 : 149}`, "Maximum usable queues: 8, Queues in use: 4", ...(shaped ? ["  Shaping rate: 64000 bps"] : []), "  Scheduler map: <default>, Index: 2", "  Congestion-notification: Disabled", "", `  Logical interface: ${ifn}.0, Index: ${ifn === "ge-0/0/0" ? 332 : 333}`, "    Object                  Name                   Type                    Index", "    Classifier              ipprec-compatibility   ip                         13"].join("\n");
}
function route(): string {
  return [
    "inet.0: 4 destinations, 4 routes (4 active, 0 holddown, 0 hidden)",
    "+ = Active Route, - = Last Active, * = Both",
    "",
    "10.10.10.0/24      *[Direct/0] 1w0d 02:11:40",
    "                    >  via ge-0/0/0.0",
    `${PA.gw}/32      *[Local/0] 1w0d 02:11:40`,
    "                       Local via ge-0/0/0.0",
    "10.20.20.0/24      *[Direct/0] 1w0d 02:11:40",
    "                    >  via ge-0/0/1.0",
    `${PA.r1Srv}/32      *[Local/0] 1w0d 02:11:40`,
    "                       Local via ge-0/0/1.0",
  ].join("\n");
}
function arp(s: PaState): string {
  const rows = [
    `${pad(PA_MAC.CLIENT.toLowerCase(), 18)}${pad(PA.client, 16)}${pad("ge-0/0/0.0", 16)}none`,
    `${pad(PA_MAC.SERVER.toLowerCase(), 18)}${pad(PA.server, 16)}${pad("ge-0/0/1.0", 16)}none`,
  ];
  void s;
  return [`${pad("MAC Address", 18)}${pad("Address", 16)}${pad("Interface", 16)}Flags`, ...rows, "Total entries: 2"].join("\n");
}
function monitor(s: PaState, ifn: string): string {
  const pt: CapPt = ifn === "ge-0/0/0" ? "r1-0" : "r1-1";
  const rows = s.caps[pt];
  return ["verbose output suppressed, use <detail> or <extensive> for full protocol decode", "Address resolution is OFF.", `Listening on ${ifn}, capture size 96 bytes`, "", ...rows.map((r) => rowLine(r, { dir: true, rel: true })), "^C", `${rows.length} packets received by filter`, "0 packets dropped by kernel"].join("\n");
}
function swTable(s: PaState): string {
  const rows = s.tests.length
    ? [`   USERS               ${PA_MAC.R1_LAN.toLowerCase()}   D             -   ge-0/0/24.0            0         0`, `   USERS               ${PA_MAC.CLIENT.toLowerCase()}   D             -   ge-0/0/1.0             0         0`]
    : [];
  return ["MAC flags (S - static MAC, D - dynamic MAC, L - locally learned, P - Persistent static", "           SE - statistics enabled, NM - non configured MAC, R - remote PE MAC, O - ovsdb MAC)", "", `Ethernet switching table : ${rows.length} entries, ${rows.length} learned`, "Routing instance : default-switch", "   Vlan                MAC                 MAC         Age    Logical                NH        RTR", "   name                address             flags              interface              Index     ID", ...rows].join("\n");
}
function analyzer(s: PaState): string {
  const a = s.cfg.SW1.analyzer;
  if (!a) return "";
  return ["  Analyzer name                    : CAP", "  Mirror rate                      : 1", "  Maximum packet length            : 0", "  State                            : up", `  Ingress monitored interfaces     : ${a.ingress ? "ge-0/0/1.0" : "None"}`, `  Egress monitored interfaces      : ${a.egress ? "ge-0/0/1.0" : "None"}`, `  Output interface                 : ${SPAN_OUT}.0`].join("\n");
}
function vlans(): string {
  return ["Routing instance        VLAN name             Tag          Interfaces", "default-switch          USERS                 10", "                                                           ge-0/0/1.0*", "                                                           ge-0/0/24.0*"].join("\n");
}

// ---------------------------------------------------------------------------------------------------------------
// Junos configuration
// ---------------------------------------------------------------------------------------------------------------
export function paJnStmts(r: J, c: PaJCfg): JStmt[] {
  const out: JStmt[] = [];
  if (r === "SW1") {
    out.push({ path: ["interfaces", "ge-0/0/1"], leaf: 'description "CLIENT"' }, { path: ["interfaces", "ge-0/0/1", "unit 0", "family ethernet-switching"], leaf: "interface-mode access" }, { path: ["interfaces", "ge-0/0/1", "unit 0", "family ethernet-switching", "vlan"], leaf: "members USERS" });
    out.push({ path: ["interfaces", "ge-0/0/23"], leaf: 'description "CAPTURE"' });
    out.push({ path: ["interfaces", "ge-0/0/24"], leaf: 'description "R1"' }, { path: ["interfaces", "ge-0/0/24", "unit 0", "family ethernet-switching"], leaf: "interface-mode access" }, { path: ["interfaces", "ge-0/0/24", "unit 0", "family ethernet-switching", "vlan"], leaf: "members USERS" });
    if (c.analyzer) {
      if (c.analyzer.ingress) out.push({ path: ["forwarding-options", "analyzer CAP", "input", "ingress"], leaf: "interface ge-0/0/1.0" });
      if (c.analyzer.egress) out.push({ path: ["forwarding-options", "analyzer CAP", "input", "egress"], leaf: "interface ge-0/0/1.0" });
      out.push({ path: ["forwarding-options", "analyzer CAP", "output"], leaf: `interface ${SPAN_OUT}.0` });
    }
    out.push({ path: ["vlans", "USERS"], leaf: "vlan-id 10" });
  } else {
    out.push({ path: ["interfaces", "ge-0/0/0"], leaf: 'description "CLIENT LAN"' }, { path: ["interfaces", "ge-0/0/0", "unit 0", "family inet"], leaf: `address ${PA.gw}/24` }, { path: ["interfaces", "ge-0/0/1"], leaf: 'description "SERVER"' }, { path: ["interfaces", "ge-0/0/1", "unit 0", "family inet"], leaf: `address ${PA.r1Srv}/24` });
    if (c.shape) out.push({ path: ["class-of-service", "interfaces", "ge-0/0/0"], leaf: "shaping-rate 64k" });
  }
  return out;
}
function stmts(r: J): SpCfgStmt<PaJCfg>[] {
  if (r === "R1")
    return [
      {
        id: "j-shape",
        summary: "Shape the interface's egress to a rate (excess frames are queued, then tail-dropped)",
        args: { ifc: { choices: ["ge-0/0/0", "ge-0/0/1"], describe: () => "Interface", resolve: (raw) => (["ge-0/0/0", "ge-0/0/1"].includes(raw) ? raw : undefined) }, rate: { choices: ["64k", "100m", "1g"], describe: () => "Shaping rate (bps; k/m/g suffixes)", resolve: (raw) => (/^\d+[kmg]?$/.test(raw) ? raw : undefined) } },
        junos: { syntax: "class-of-service interfaces <ifc> shaping-rate <rate>", set: (c, a) => (a.ifc !== "ge-0/0/0" ? "error: this lab models shaping on R1's client-facing interface ge-0/0/0" : a.rate !== "64k" ? "error: this lab models the 64k shaper only (a line-rate shaper has no effect here)" : ((c.shape = true), c)), del: (c) => ((c.shape = false), c) },
      },
      { id: "j-shape-del", summary: "The shaping rate (delete it without a value)", args: { ifs2: { choices: ["ge-0/0/0"], describe: () => "Interface", resolve: (raw) => (["ge-0/0/0", "ge-0/0/1"].includes(raw) ? raw : undefined) } }, junos: { syntax: "class-of-service interfaces <ifs2> shaping-rate", set: () => "error: missing mandatory argument: shaping-rate needs a rate, e.g. 64k", del: (c, a) => (a.ifs2 === "ge-0/0/0" ? ((c.shape = false), c) : c) } },
      { id: "j-cos-if", summary: "Class-of-service settings of an interface", args: { ifd: { choices: ["ge-0/0/0", "ge-0/0/1"], describe: () => "Interface", resolve: (raw) => (["ge-0/0/0", "ge-0/0/1"].includes(raw) ? raw : undefined) } }, junos: { syntax: "class-of-service interfaces <ifd>", set: (c) => c, del: (c, a) => (a.ifd === "ge-0/0/0" ? ((c.shape = false), c) : c) } },
    ];
  const port: CliArgSpec = { choices: ["ge-0/0/1", "ge-0/0/1.0"], describe: () => "CLIENT's access port", resolve: (raw) => (raw === "ge-0/0/1" || raw === "ge-0/0/1.0" ? "ge-0/0/1" : undefined) };
  const outp: CliArgSpec = { choices: [`${SPAN_OUT}`, `${SPAN_OUT}.0`], describe: () => "Port to the CAPTURE laptop", resolve: (raw) => (raw === SPAN_OUT || raw === `${SPAN_OUT}.0` ? SPAN_OUT : undefined) };
  const ensure = (c: PaJCfg) => (c.analyzer ??= { ingress: false, egress: false });
  const an: CliArgSpec = { choices: ["CAP"], describe: () => "Analyzer session name", resolve: (raw) => (raw === "CAP" ? raw : undefined) };
  return [
    { id: "j-an", summary: "Port-mirroring session CAP", args: { an }, junos: { syntax: "forwarding-options analyzer <an>", set: (c) => (ensure(c), c), del: (c) => ((c.analyzer = null), c) } },
    { id: "j-an-in", summary: "Mirror frames RECEIVED on the port (from CLIENT)", args: { an, pin: port }, junos: { syntax: "forwarding-options analyzer <an> input ingress interface <pin>", set: (c) => ((ensure(c).ingress = true), c), del: (c) => (c.analyzer ? ((c.analyzer.ingress = false), c) : c) } },
    { id: "j-an-eg", summary: "Mirror frames TRANSMITTED on the port (to CLIENT)", args: { an, peg: port }, junos: { syntax: "forwarding-options analyzer <an> input egress interface <peg>", set: (c) => ((ensure(c).egress = true), c), del: (c) => (c.analyzer ? ((c.analyzer.egress = false), c) : c) } },
    { id: "j-an-out", summary: "Where the mirrored copies are sent", args: { an, pout: outp }, junos: { syntax: "forwarding-options analyzer <an> output interface <pout>", set: (c) => (ensure(c), c), del: (c) => ((c.analyzer = null), c) } },
  ];
}
export function paJunosSpec(api: PaCliApi, r: J): SpJunosSpec<PaJCfg> {
  const s = api.s;
  const sh = (id: string, syntax: string, summary: string, run: SpCmd["run"], args?: SpCmd["args"]): SpCmd => ({ id, syntax, summary, run, args });
  const shows: SpCmd[] = [
    sh("terse", "show interfaces terse", "Interfaces, admin/link state and addresses", () => terse(s, r)),
    sh("ext", "show interfaces <ifx> extensive", "Interface counters: packets, errors, drops, queue drops", (a) => extensive(s, r, a.ifx), { ifx: ifArg(r) }),
  ];
  const op: SpCmd[] = [
    sh("clr", "clear interfaces statistics <ifs>", "Reset the interface counters shown by show interfaces", (a) => {
      api.act({ type: "clear-stats", ifn: a.ifs === "all" ? undefined : `${r}:${a.ifs}` });
      return "";
    }, { ifs: ifOrAll(r) }),
  ];
  if (r === "R1") {
    shows.push(
      sh("q", "show interfaces queue <ifq>", "Egress queue statistics: queued, transmitted, tail-dropped", (a) => queue(s, a.ifq), { ifq: ifArg("R1") }),
      sh("cos", "show class-of-service interface <ifk>", "CoS on an interface: shaping rate, scheduler map", (a) => cos(s, a.ifk), { ifk: ifArg("R1") }),
      sh("rt", "show route", "The routing table", () => route()),
      sh("arp", "show arp no-resolve", "The ARP table", () => arp(s)),
    );
    op.push(sh("mon", "monitor traffic interface <ifm> no-resolve", "Packets received and sent on an interface (Ctrl+C to stop)", (a) => ({ output: monitor(s, a.ifm), explanation: "Shown: everything this interface received (In) or transmitted (Out) since the lab started. A frame dropped in the egress queue is never transmitted, so it never appears as Out. (Lab simplification: on hardware-forwarding Junos platforms monitor traffic sees only Routing-Engine traffic; transit captures use port mirroring.)" }), { ifm: ifArg("R1") }));
  } else {
    shows.push(
      sh("est", "show ethernet-switching table", "Learned MAC addresses", () => swTable(s)),
      sh("vl", "show vlans", "VLANs and member ports", () => vlans()),
      sh("an", "show forwarding-options analyzer", "Port-mirroring sessions: monitored ports and directions", () => analyzer(s) || { output: "", explanation: "No analyzer session is configured on SW1." }),
    );
  }
  return { stmts: stmts(r), shows, op, jstmts: (c) => paJnStmts(r, c), help: { "show interfaces": "Interface information", "show class-of-service": "Class-of-service information", "show forwarding-options": "Forwarding options", "show ethernet-switching": "Ethernet switching information", "monitor traffic": "Show originating and incoming packets", "clear interfaces": "Clear interface information" } };
}

// ---------------------------------------------------------------------------------------------------------------
// Linux hosts
// ---------------------------------------------------------------------------------------------------------------
const ipArg = (choices: string[]): CliArgSpec => ({ choices, describe: (c) => (c === PA.server ? "SERVER" : c === PA.client ? "CLIENT" : c === PA.gw ? "R1 (CLIENT's gateway)" : undefined), resolve: (raw) => (/^(\d{1,3}\.){3}\d{1,3}$/.test(raw) ? raw : undefined) });
const word = (what: string, choices: string[] = []): CliArgSpec => ({ choices, describe: () => what, resolve: (raw) => (raw.length ? raw : undefined) });
const exact = (v: string, what: string): CliArgSpec => ({ choices: [v], describe: () => what, resolve: (raw) => (raw === v ? raw : undefined) });
const LIST = exact("-L", "List the rules");
const CHAIN = exact("INPUT", "Packets addressed to this host");
const flagsArg: CliArgSpec = { choices: ["-nn", "-nnS", "-nne", "-nnv", "-nnSe", "-nnSv"], describe: (c) => ({ "-nn": "No name/port resolution, relative TCP numbers", "-nnS": "…with absolute sequence numbers", "-nne": "…with Ethernet addresses", "-nnv": "…with IP header details (TTL, ID)", "-nnSe": "absolute numbers + Ethernet addresses", "-nnSv": "absolute numbers + IP header details" })[c], resolve: (raw) => (/^-n{1,2}[Sev]{0,3}$/.test(raw) ? raw : undefined) };
function tcpdump(rows: CapRow[], flags: string, filter: string[]): string {
  const f = pcapFilter(filter.join(" "));
  if (typeof f === "string") return f;
  const sel = rows.filter(f);
  const o = { e: flags.includes("e"), v: flags.includes("v"), rel: !flags.includes("S") };
  return sel.map((r) => rowLine(r, o)).join("\n");
}
function tcpdumpCmds(file: string, rows: () => CapRow[], ifn: string): CliCommand[] {
  const fileArg: CliArgSpec = { choices: [file], describe: () => `Always-on capture of ${ifn} (tcpdump -w, ring buffer)`, resolve: (raw) => (raw === file ? raw : undefined) };
  const out: CliCommand[] = [];
  const header = `reading from file ${file}, link-type EN10MB (Ethernet), snapshot length 262144`;
  for (let n = 0; n <= 6; n++) {
    const fargs: Record<string, CliArgSpec> = {};
    const words: string[] = [];
    for (let k = 1; k <= n; k++) {
      fargs[`f${k}`] = word("Filter: host <ip> · src|dst host <ip> · port <n> · tcp · arp · icmp · and · not", k === 1 ? ["host", "port", "tcp", "arp", "icmp", "not"] : ["and", PA.server, PA.client, "443"]);
      words.push(`<f${k}>`);
    }
    out.push({
      id: `tcpdump-${file}-${n}`,
      syntax: ["tcpdump", "<flags>", "-r", "<file>", ...words].join(" "),
      summary: n === 0 ? "Read the capture file (flags: -nn, add S absolute seq, e Ethernet, v IP details)" : "Read the capture file through a filter",
      hidden: n > 1,
      args: { flags: flagsArg, file: fileArg, ...fargs },
      run: (a) => {
        const filter = words.map((w) => a[w.slice(1, -1)]);
        const body = tcpdump(rows(), a.flags, filter);
        return { output: body.startsWith("tcpdump:") ? body : [header, body].filter(Boolean).join("\n") };
      },
    });
  }
  return out;
}
function ipLink(s: PaState, d: PaD, ifn: string): string {
  const c = s.counters[`${d}:${ifn}`];
  const mac = d === "CLIENT" ? PA_MAC.CLIENT : d === "SERVER" ? PA_MAC.SERVER : "02:00:00:00:00:99";
  return [`2: ${ifn}: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc fq_codel state UP mode DEFAULT group default qlen 1000`, `    link/ether ${mac.toLowerCase()} brd ff:ff:ff:ff:ff:ff`, "    RX:  bytes packets errors dropped  missed   mcast", `    ${String(c.in * 74).padStart(10)} ${String(c.in).padStart(7)}      0       0       0       0`, "    TX:  bytes packets errors dropped carrier collsns", `    ${String(c.out * 74).padStart(10)} ${String(c.out).padStart(7)}      0       0       0       0`].join("\n");
}
function ssTan(s: PaState, d: PaD): string {
  const head = "State      Recv-Q Send-Q      Local Address:Port        Peer Address:Port Process";
  const rows: string[] = [];
  if (d === "SERVER") {
    if (s.hosts.nginx) rows.push(`${pad("LISTEN", 11)}0      511               0.0.0.0:443              0.0.0.0:*`);
    rows.push(`${pad("LISTEN", 11)}0      128               0.0.0.0:22               0.0.0.0:*`);
    for (const p of s.synRecv) rows.push(`${pad("SYN-RECV", 11)}0      0           ${PA.server}:443        ${PA.client}:${p}`);
  } else if (d === "CLIENT" && s.clientSock && s.clientSock.state !== "CLOSED") {
    rows.push(`${pad(s.clientSock.state, 11)}0      0           ${PA.client}:${s.clientSock.sport}      ${PA.server}:443`);
  }
  return [head, ...rows].join("\n");
}
function ssTln(s: PaState): string {
  return ["State      Recv-Q Send-Q      Local Address:Port        Peer Address:Port Process", ...(s.hosts.nginx ? [`${pad("LISTEN", 11)}0      511               0.0.0.0:443              0.0.0.0:*`] : []), `${pad("LISTEN", 11)}0      128               0.0.0.0:22               0.0.0.0:*`].join("\n");
}
function hostSet(api: PaCliApi, d: "CLIENT" | "SERVER" | "CAPTURE"): CliCommandSet {
  const s = api.s;
  const me = d === "CLIENT" ? PA.client : d === "SERVER" ? PA.server : "192.0.2.99";
  const prompt = `admin@${d.toLowerCase()}:~$ `;
  const cmds: CliCommand[] = [];
  const add = (id: string, syntax: string, summary: string, run: CliCommand["run"], args?: CliCommand["args"], hidden?: boolean) => cmds.push({ id: `${d}-${id}`, syntax, summary, run, args, hidden });
  if (d === "CAPTURE") {
    cmds.push(...tcpdumpCmds("/var/tmp/span.pcap", () => s.caps.span, "eth1 (SW1's mirror of ge-0/0/1)"));
    add("link", "ip -s link show eth1", "Interface counters of the capture port", () => ({ output: ipLink(s, "CAPTURE", "eth1") }));
    add("addr", "ip addr", "Addresses (eth1 is a receive-only capture port)", () => ({ output: "1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536\n    inet 127.0.0.1/8 scope host lo\n2: eth1: <BROADCAST,MULTICAST,PROMISC,UP,LOWER_UP> mtu 1500\n    link/ether 02:00:00:00:00:99 brd ff:ff:ff:ff:ff:ff" }));
    return { vendor: "cisco", deviceId: d, deviceName: d, prompt, commands: cmds };
  }
  cmds.push(...tcpdumpCmds("/var/tmp/eth0.pcap", () => s.caps[d === "CLIENT" ? "client" : "server"], `${d} eth0`));
  const target = d === "CLIENT" ? [PA.server, PA.gw] : [PA.client, PA.r1Srv];
  add("ping", "ping -c <n> <ip>", "Send <n> ICMP echo requests", (a) => {
    if (d !== "CLIENT" || a.ip !== PA.server) return { output: `PING ${a.ip} (${a.ip}) 56(84) bytes of data.\n\n--- ${a.ip} ping statistics ---\n${a.n} packets transmitted, ${a.n} received, 0% packet loss, time ${+a.n * 1000 - 999}ms`, explanation: "In this lab the traffic that is captured and analysed is CLIENT → SERVER; this probe is shown without frames." };
    const n = Math.min(+a.n, 10);
    const ns = paApply(s, { type: "ping", count: n });
    api.act({ type: "ping", count: n });
    const t = lastTest(ns);
    const got = new Set(ns.frames.filter((f) => t.frames.includes(f.n) && f.kind === "icmp" && f.text.includes("reply") && !f.lostAt).map((f) => +(f.text.match(/seq (\d+)/)?.[1] ?? 0)));
    const lines = [`PING ${a.ip} (${a.ip}) 56(84) bytes of data.`];
    for (let q = 1; q <= n; q++) if (got.has(q)) lines.push(`64 bytes from ${a.ip}: icmp_seq=${q} ttl=63 time=0.${210 + q} ms`);
    lines.push("", `--- ${a.ip} ping statistics ---`, `${n} packets transmitted, ${got.size} received, ${Math.round((100 * (n - got.size)) / n)}% packet loss, time ${n * 1000 - 999}ms`);
    if (got.size) lines.push("rtt min/avg/max/mdev = 0.211/0.213/0.215/0.002 ms");
    return { output: lines.join("\n") };
  }, { n: numArg(1, 10, ["4"], "Count"), ip: ipArg(target) });
  add("addr", "ip addr", "Addresses", () => ({ output: `1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536\n    inet 127.0.0.1/8 scope host lo\n2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500\n    link/ether ${(d === "CLIENT" ? PA_MAC.CLIENT : PA_MAC.SERVER).toLowerCase()} brd ff:ff:ff:ff:ff:ff\n    inet ${me}/24 brd ${me.replace(/\.\d+$/, ".255")} scope global eth0` }));
  add("route", "ip route", "The host's routing table", () => ({ output: d === "CLIENT" ? `default via ${PA.gw} dev eth0 proto static\n10.10.10.0/24 dev eth0 proto kernel scope link src ${me}` : `default via ${s.hosts.gw} dev eth0 proto static\n10.20.20.0/24 dev eth0 proto kernel scope link src ${me}` }));
  add("neigh", "ip neigh", "The ARP (neighbour) cache", () => (d === "CLIENT" && !s.hosts.clientArp ? { output: "", explanation: "The ARP cache is empty: the next packet to the gateway will ARP first." } : { output: d === "CLIENT" ? `${PA.gw} dev eth0 lladdr ${PA_MAC.R1_LAN.toLowerCase()} REACHABLE` : [`${PA.r1Srv} dev eth0 lladdr ${PA_MAC.R1_SRV.toLowerCase()} ${s.hosts.gw === GOOD_GW ? "REACHABLE" : "STALE"}`, ...(s.serverArpFailed && s.hosts.gw !== GOOD_GW ? [`${s.hosts.gw} dev eth0 FAILED`] : [])].join("\n") }));
  add("link", "ip -s link show eth0", "Interface packet counters", () => ({ output: ipLink(s, d, "eth0") }));
  add("ss", "ss -tan", "TCP sockets in every state", () => ({ output: ssTan(s, d) }));
  if (d === "CLIENT") {
    add("flush", "ip neigh flush dev eth0", "Empty the ARP cache (the next packet ARPs again)", () => {
      api.act({ type: "flush-arp" });
      return { output: "", explanation: "CLIENT's ARP cache is now empty." };
    });
    add("nc", "nc -vz -w <sec> <ip> <port>", "Open a TCP connection, then close it (connect test)", (a) => {
      if (a.ip !== PA.server || +a.port !== SERVICE_PORT) return { output: `nc: connect to ${a.ip} port ${a.port} (tcp) failed: No route to host`, explanation: "This lab's service is 10.20.20.20 port 443." };
      if (+a.sec !== NC_TIMEOUT_S) return { output: "", explanation: `Use -w ${NC_TIMEOUT_S}: the lab models a ${NC_TIMEOUT_S}-second connect timeout.` };
      const ns = paApply(s, { type: "nc" });
      api.act({ type: "nc" });
      const t = lastTest(ns);
      return { output: t.outcome === "ok" ? `Connection to ${PA.server} ${SERVICE_PORT} port [tcp/https] succeeded!` : t.outcome === "refused" ? `nc: connect to ${PA.server} port ${SERVICE_PORT} (tcp) failed: Connection refused` : `nc: connect to ${PA.server} port ${SERVICE_PORT} (tcp) timed out: Operation now in progress` };
    }, { sec: numArg(1, 60, [String(NC_TIMEOUT_S)], "Timeout in seconds"), ip: ipArg([PA.server]), port: numArg(1, 65535, [String(SERVICE_PORT)], "TCP port") });
    add("curl", "curl -skv --connect-timeout <sec> <url>", "Fetch the page: connect, request, response, close (verbose)", (a) => {
      if (a.url !== `https://${PA.server}/`) return { output: `curl: (6) Could not resolve host: ${a.url.replace(/^https?:\/\//, "").replace(/\/.*$/, "")}`, explanation: `This lab's service is https://${PA.server}/.` };
      const ns = paApply(s, { type: "curl" });
      api.act({ type: "curl" });
      const t = lastTest(ns);
      const ms = (x?: number) => Math.round((x ?? 0) * 1000);
      if (t.outcome === "refused") return { output: `*   Trying ${PA.server}:443...\n* connect to ${PA.server} port 443 failed: Connection refused\n* Failed to connect to ${PA.server} port 443 after ${ms(t.connect)} ms: Couldn't connect to server\n* Closing connection 0` };
      if (t.outcome !== "ok") return { output: `*   Trying ${PA.server}:443...\n* Connection timed out after ${NC_TIMEOUT_S * 1000 + 1} milliseconds\n* Closing connection 0` };
      return { output: [`*   Trying ${PA.server}:443...`, `* Connected to ${PA.server} (${PA.server}) port 443 (#0)`, "* (application data: 120-byte request, 380-byte response — TLS records not decoded in this lab)", "< HTTP/1.1 200 OK", `* Connection #0 to host ${PA.server} left intact`, `  time_connect: ${(t.connect ?? 0).toFixed(6)}  time_total: ${(t.total ?? 0).toFixed(6)}`].join("\n") };
    }, { sec: numArg(1, 60, [String(NC_TIMEOUT_S)], "Connect timeout in seconds"), url: word("URL", [`https://${PA.server}/`]) });
  } else {
    add("ssl", "ss -tln", "Listening TCP sockets", () => ({ output: ssTln(s) }));
    add("sys", "systemctl status nginx", "Is the web service running?", () => ({ output: s.hosts.nginx ? `● nginx.service - A high performance web server and a reverse proxy server\n     Loaded: loaded (/lib/systemd/system/nginx.service; enabled; vendor preset: enabled)\n     Active: active (running) since ${paStamp(nginxSince(s)).junos}; ${age(s)} ago\n   Main PID: 812 (nginx)` : `○ nginx.service - A high performance web server and a reverse proxy server\n     Loaded: loaded (/lib/systemd/system/nginx.service; enabled; vendor preset: enabled)\n     Active: inactive (dead) since ${paStamp(nginxSince(s)).junos}; ${age(s)} ago` }));
    for (const verb of ["start", "stop"] as const)
      add(`sys-${verb}`, `sudo systemctl ${verb} nginx`, verb === "start" ? "Start the web service" : "Stop the web service", () => {
        api.act({ type: "host", dev: "SERVER", f: (h) => void (h.nginx = verb === "start"), text: `systemctl ${verb} nginx` });
        return { output: "" };
      });
    add("ipt", "sudo iptables <list> <chain> -n -v", "Host firewall INPUT rules with packet counters", () => ({ output: [`Chain INPUT (policy ACCEPT ${1200 + s.counters["SERVER:eth0"].in} packets, ${(1200 + s.counters["SERVER:eth0"].in) * 74} bytes)`, " pkts bytes target     prot opt in     out     source               destination", ...(s.hosts.drop443 ? [`${String(s.iptDropPkts).padStart(5)} ${String(s.iptDropPkts * 60).padStart(5)} DROP       tcp  --  *      *       0.0.0.0/0            0.0.0.0/0            tcp dpt:443`] : [])].join("\n") }), { list: LIST, chain: CHAIN });
    add("ipt-nos", "iptables <list> <chain> -n -v", "Host firewall rules (needs root)", () => ({ output: "iptables v1.8.7 (nf_tables): Permission denied (you must be root)", refused: true }), { list: LIST, chain: CHAIN }, true);
    for (const op of ["-A", "-D"] as const)
      add(`ipt${op}`, `sudo iptables <${op === "-A" ? "app" : "del"}> <chain> -p tcp --dport <port> -j <target>`, op === "-A" ? "Append a rule dropping TCP to a port" : "Delete that rule", (a) => {
        if (+a.port !== SERVICE_PORT) return { output: "", explanation: "This lab models the TCP/443 rule." };
        if (op === "-D" && !s.hosts.drop443) return { output: "iptables: Bad rule (does a matching rule exist in that chain?).", refused: true };
        api.act({ type: "host", dev: "SERVER", f: (h) => void (h.drop443 = op === "-A"), text: `iptables ${op} INPUT -p tcp --dport 443 -j DROP` });
        return { output: "" };
      }, { [op === "-A" ? "app" : "del"]: exact(op, op === "-A" ? "Append a rule" : "Delete a rule"), chain: CHAIN, port: numArg(1, 65535, [String(SERVICE_PORT)], "TCP port"), target: exact("DROP", "Discard silently") });
    add("gw", "sudo ip route replace default via <gw>", "Set the default gateway", (a) => {
      if (!a.gw.startsWith("10.20.20.")) return { output: "Error: Nexthop has invalid gateway.", refused: true };
      api.act({ type: "host", dev: "SERVER", f: (h) => void (h.gw = a.gw), text: `ip route replace default via ${a.gw}` });
      return { output: "" };
    }, { gw: ipArg([GOOD_GW, BAD_GW]) });
  }
  return { vendor: "cisco", deviceId: d, deviceName: d, prompt, commands: cmds };
}

export function paSets(api: PaCliApi, d: PaD): Partial<Record<CliVendor, CliCommandSet>> {
  if (d === "SW1" || d === "R1") return { juniper: buildJunosSet(api.dev, paJunosSpec(api, d)) };
  const h = hostSet(api, d);
  return { cisco: h, juniper: h };
}
export const paPipe = (api: PaCliApi, r: J) => ({ config: junosPipeConfig(api.dev, { jstmts: (c: PaJCfg) => paJnStmts(r, c) }), rollbacks: api.dev.hist.length });
export function paStaticApi(s: PaState, d: PaD): PaCliApi {
  const cfg = d === "SW1" || d === "R1" ? s.cfg[d] : {};
  const hist = d === "SW1" || d === "R1" ? s.hist[d] : [];
  return { s, act: () => s, dev: { host: d, running: cfg, hist, setCand: () => undefined, xr: [], setXr: () => undefined, edit: false, setEdit: () => undefined, commit: () => undefined } };
}
export { choiceArg };
