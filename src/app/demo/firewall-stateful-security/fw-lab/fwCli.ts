import type { CliArgSpec, CliCommand, CliCommandSet, CliResult, CliVendor } from "@/lib/cli/types";
import { columns } from "@/lib/cli/format";
import type { CliQuestion } from "@/app/demo/dhcp-dns/dhcp-lab/dhcpBuildCli";
import { withSelfPing } from "@/lib/cli/selfPing";
import { withShellHistory } from "@/lib/cli/shellHistory";
import { APPS, APP_PORT, BAD_NAT, FW_IF, FW_ZONES, HOST_IP, ISP_IP, OBJECTS, OBJECT_NAMES, PUBLIC, fwClone, fwPolicy, hitKey, isIp, type FwAction, type FwApp, type FwCfg, type FwHost, type FwNet, type FwResult, type FwRule, type FwSession, type FwZone, type SnatMode } from "@/lib/sim-engine/scenarios/fwNet";
import { IOS_ZONE, JUNOS_APP, appOfJunos, ifName, policyMap, zonePair } from "./fwNames";

/**
 * Command lines of the Firewall Lab. FW1 runs as a Cisco IOS zone-based firewall or a Junos SRX — both fully
 * configurable, both printing the same lab state (rules, hit counts, sessions, translations, logs). The ISP is a
 * read-only looking glass; the hosts have a Linux shell (ping, curl, nc, ssh; the DMZ server can fix its gateway; OUT
 * can send a stray segment with hping3).
 *
 *   IOS    show zone security · show zone-pair security · show policy-map type inspect zone-pair [sessions] ·
 *          show ip nat translations · show running-config · show ip route · show ip interface brief · show logging ·
 *          clear zone-pair inspect sessions · configure terminal → ip access-list extended ACL-<rule> (permit …) ·
 *          policy-map type inspect PM-<from>-<to> → [no] class type inspect CM-<rule> → inspect | drop ·
 *          [no] ip nat inside source list NAT-INSIDE|NAT-DMZ interface GigabitEthernet0/1 | pool BAD-POOL overload ·
 *          [no] ip nat inside source static tcp 172.16.0.10 443 interface GigabitEthernet0/1 443
 *   Junos  show security zones · show security policies [hit-count] · show security flow session ·
 *          show security nat source|destination rule all · show security match-policies … · show route ·
 *          show interfaces terse · show log messages · show configuration security … · clear security flow session all ·
 *          configure → set / delete / insert security policies … · set / delete security nat … → commit
 */
export type FwIosMode = { kind: "exec" } | { kind: "config" } | { kind: "acl"; rule: string } | { kind: "pm"; from: FwZone; to: FwZone } | { kind: "pmclass"; from: FwZone; to: FwZone; rule: string };
/** IOS keeps class-maps / ACLs of rules that are in no policy-map; Junos candidate policies still missing statements. */
export type FwCand = FwCfg & { spare?: FwRule[]; drafts?: Partial<FwRule>[] };
export interface FwCliApi {
  view: FwNet;
  act: (a: FwAction) => FwNet;
  ios: FwIosMode;
  setIos: (m: FwIosMode) => void;
  junosEdit: boolean;
  setJunosEdit: (b: boolean) => void;
  cand: FwCand;
  setCand: (c: FwCand) => void;
  spare: FwRule[];
  setSpare: (r: FwRule[]) => void;
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
const cidrToMask = (len: number) => [0, 8, 16, 24].map((o) => Math.max(0, Math.min(8, len - o))).map((b) => 256 - 2 ** (8 - b)).join(".");
const zoneArg = (vendor: CliVendor): CliArgSpec => ({ choices: vendor === "cisco" ? FW_ZONES.map((z) => IOS_ZONE[z]) : [...FW_ZONES], resolve: (raw) => (vendor === "cisco" ? FW_ZONES.find((z) => IOS_ZONE[z] === raw.toUpperCase()) : FW_ZONES.find((z) => z === raw.toLowerCase())) });
const objArg = (withAny = false): CliArgSpec => ({ choices: [...OBJECT_NAMES, ...(withAny ? ["any"] : [])], describe: (c) => OBJECTS[c] ?? "any address", resolve: (raw) => (raw.toLowerCase() === "any" && withAny ? "any" : OBJECT_NAMES.find((o) => o === raw.toUpperCase())) });
const ipArg = (choices: string[]): CliArgSpec => ({ choices, resolve: (raw) => (isIp(raw) ? raw : undefined) });
const nameArg = (choices: string[]): CliArgSpec => ({ choices, resolve: (raw) => choices.find((c) => c.toUpperCase() === raw.toUpperCase()) });
const portArg: CliArgSpec = { choices: ["443", "80", "22"], resolve: (raw) => (raw === "https" ? "443" : raw === "www" ? "80" : /^\d+$/.test(raw) && +raw > 0 && +raw < 65536 ? raw : undefined) };
const appOfPort = (port: number): FwApp | undefined => APPS.find((a) => APP_PORT[a] === port);
const sessState = (x: FwSession, cisco: boolean) => (cisco ? (x.state === "ESTABLISHED" || x.state === "ICMP" ? "SIS_OPEN" : x.state === "CLOSED" ? "SIS_CLOSED" : "SIS_OPENING") : x.state);
const live = (s: FwNet) => s.sessions.filter((x) => x.state !== "CLOSED");
const PAIRS: [FwZone, FwZone][] = [
  ["trust", "untrust"],
  ["trust", "dmz"],
  ["dmz", "untrust"],
  ["untrust", "dmz"],
];
const pairsOf = (c: FwCfg) => {
  const extra = c.rules.map((r) => [r.from, r.to] as [FwZone, FwZone]).filter(([f, t]) => !PAIRS.some(([a, b]) => a === f && b === t));
  return [...PAIRS, ...extra.filter((p, i) => extra.findIndex((q) => q[0] === p[0] && q[1] === p[1]) === i)];
};
const OUT_IF: CliArgSpec = { choices: ["GigabitEthernet0/1"], describe: () => `${PUBLIC} (OUTSIDE)`, resolve: (raw) => (/^(gigabitethernet|gi)0\/1$/i.test(raw) ? "GigabitEthernet0/1" : undefined) };
const p443 = (what: string): CliArgSpec => ({ choices: ["443"], describe: () => what, resolve: (raw) => (raw === "443" ? raw : undefined) });
const STATIC_ARGS: Record<string, CliArgSpec> = { local: { choices: [HOST_IP.DMZ], describe: () => "the DMZ server (inside local)", resolve: (raw) => (raw === HOST_IP.DMZ ? raw : undefined) }, lport: p443("its port"), ifc: OUT_IF, gport: p443("the public port") };
const fixedName = (n: string): CliArgSpec => ({ choices: [n], resolve: (raw) => (raw.toUpperCase() === n ? n : undefined) });
const pmArg: CliArgSpec = { choices: PAIRS.map(([f, t]) => policyMap(f, t)), resolve: (raw) => { const all: [FwZone, FwZone][] = FW_ZONES.flatMap((f) => FW_ZONES.filter((t) => t !== f).map((t) => [f, t] as [FwZone, FwZone])); const hit = all.find(([f, t]) => policyMap(f, t) === raw.toUpperCase()); return hit ? `${hit[0]}>${hit[1]}` : undefined; } };

// ---------------------------------------------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------------------------------------------
const snatRuleName = (z: "trust" | "dmz") => (z === "trust" ? "SNAT-TRUST" : "SNAT-DMZ");
const aceLines = (r: FwRule) => {
  const proto = r.app === "icmp" ? "icmp" : r.app === "any" ? "ip" : "tcp";
  const ref = (o: string) => (o === "any" ? "any" : `object-group ${o}`);
  return r.src.flatMap((s) => r.dst.map((d) => ` permit ${proto} ${ref(s)} ${ref(d)}${proto === "tcp" ? ` eq ${APP_PORT[r.app]}` : ""}`));
};
function iosRunning(c: FwCfg, spare: FwRule[]): string {
  const all = [...c.rules, ...spare];
  const lines = [
    "hostname FW1",
    "!",
    ...OBJECT_NAMES.flatMap((o) => [`object-group network ${o}`, OBJECTS[o].endsWith("/32") ? ` host ${OBJECTS[o].split("/")[0]}` : ` ${OBJECTS[o].split("/")[0]} ${cidrToMask(+OBJECTS[o].split("/")[1])}`, "!"]),
    ...FW_ZONES.map((z) => `zone security ${IOS_ZONE[z]}`),
    "!",
    ...all.flatMap((r) => [`ip access-list extended ACL-${r.name}`, ...aceLines(r), "!"]),
    ...all.flatMap((r) => [`class-map type inspect match-all CM-${r.name}`, ` match access-group name ACL-${r.name}`, ...(r.app === "any" ? [] : [` match protocol ${r.app === "icmp" ? "icmp" : r.app}`]), "!"]),
    ...pairsOf(c).flatMap(([f, t]) => [`policy-map type inspect ${policyMap(f, t)}`, ...c.rules.filter((r) => r.from === f && r.to === t).flatMap((r) => [` class type inspect CM-${r.name}`, r.action === "permit" ? "  inspect" : "  drop log"]), " class class-default", "  drop log", "!"]),
    ...pairsOf(c).flatMap(([f, t]) => [`zone-pair security ${zonePair(f, t)} source ${IOS_ZONE[f]} destination ${IOS_ZONE[t]}`, ` service-policy type inspect ${policyMap(f, t)}`, "!"]),
    ...FW_ZONES.flatMap((z) => [`interface ${ifName("cisco", FW_IF[z].ifn, true)}`, ` ip address ${FW_IF[z].ip} ${cidrToMask(FW_IF[z].len)}`, ` ip nat ${z === "untrust" ? "outside" : "inside"}`, ` zone-member security ${IOS_ZONE[z]}`, "!"]),
    "ip access-list standard NAT-INSIDE",
    " permit 10.10.10.0 0.0.0.255",
    "ip access-list standard NAT-DMZ",
    " permit 172.16.0.0 0.0.0.255",
    ...(c.snat.trust === "bad" || c.snat.dmz === "bad" ? [`ip nat pool BAD-POOL ${BAD_NAT} ${BAD_NAT} prefix-length 30`] : []),
    ...(["trust", "dmz"] as const).filter((z) => c.snat[z] !== "off").map((z) => `ip nat inside source list ${z === "trust" ? "NAT-INSIDE" : "NAT-DMZ"} ${c.snat[z] === "interface" ? "interface GigabitEthernet0/1" : "pool BAD-POOL"} overload`),
    ...(c.dnat ? ["ip nat inside source static tcp 172.16.0.10 443 interface GigabitEthernet0/1 443"] : []),
    `ip route 0.0.0.0 0.0.0.0 ${ISP_IP.fw}`,
    "!",
    "end",
  ];
  return `Building configuration...\n\nCurrent configuration : ${lines.join("\n").length} bytes\n!\n${lines.join("\n")}`;
}
interface JNode {
  name: string;
  kids?: JNode[];
}
const render = (nodes: JNode[], d = 0): string[] => nodes.flatMap((n) => (n.kids ? [`${"    ".repeat(d)}${n.name} {`, ...render(n.kids, d + 1), `${"    ".repeat(d)}}`] : [`${"    ".repeat(d)}${n.name};`]));
function walk(nodes: JNode[], path: string[]): string {
  const want = [...path];
  while (want.length) {
    let hit: JNode | undefined;
    for (let k = Math.min(want.length, 6); k >= 1 && !hit; k--) {
      const key = want.slice(0, k).join(" ");
      hit = nodes.find((n) => n.name === key);
      if (hit) want.splice(0, k);
    }
    if (!hit?.kids) return "";
    nodes = hit.kids;
  }
  return render(nodes).join("\n");
}
const list = (xs: string[]) => (xs.length > 1 ? `[ ${xs.join(" ")} ]` : xs[0]);
function junosTree(c: FwCand): JNode[] {
  const pol = (f: FwZone, t: FwZone) => [
    ...c.rules.filter((r) => r.from === f && r.to === t).map((r) => ({ name: `policy ${r.name}`, kids: [{ name: "match", kids: [{ name: `source-address ${list(r.src)}` }, { name: `destination-address ${list(r.dst)}` }, { name: `application ${JUNOS_APP[r.app]}` }] }, { name: "then", kids: [{ name: r.action }] }] })),
    ...(c.drafts ?? []).filter((r) => r.from === f && r.to === t).map((r) => ({ name: `policy ${r.name}`, kids: [{ name: "match", kids: [...(r.src?.length ? [{ name: `source-address ${list(r.src)}` }] : []), ...(r.dst?.length ? [{ name: `destination-address ${list(r.dst)}` }] : []), ...(r.app ? [{ name: `application ${JUNOS_APP[r.app]}` }] : [])] }, ...(r.action ? [{ name: "then", kids: [{ name: r.action }] }] : [])] })),
  ];
  const pairs = FW_ZONES.flatMap((f) => FW_ZONES.filter((t) => t !== f).map((t) => [f, t] as [FwZone, FwZone])).filter(([f, t]) => pol(f, t).length);
  const snatRule = (z: "trust" | "dmz"): JNode[] => (c.snat[z] === "off" ? [] : [{ name: `rule-set ${z}-to-untrust`, kids: [{ name: `from zone ${z}` }, { name: "to zone untrust" }, { name: `rule ${snatRuleName(z)}`, kids: [{ name: "match", kids: [{ name: `source-address ${z === "trust" ? "10.10.10.0/24" : "172.16.0.0/24"}` }] }, { name: "then", kids: [{ name: "source-nat", kids: [c.snat[z] === "interface" ? { name: "interface" } : { name: "pool BAD-POOL" }] }] }] }] }]);
  return [
    {
      name: "security",
      kids: [
        { name: "address-book", kids: [{ name: "global", kids: OBJECT_NAMES.map((o) => ({ name: `address ${o} ${OBJECTS[o]}` })) }] },
        {
          name: "nat",
          kids: [
            { name: "source", kids: [...(c.snat.trust === "bad" || c.snat.dmz === "bad" ? [{ name: "pool BAD-POOL", kids: [{ name: `address ${BAD_NAT}/32` }] }] : []), ...snatRule("trust"), ...snatRule("dmz")] },
            { name: "destination", kids: [{ name: "pool DMZ-WEB-443", kids: [{ name: `address ${HOST_IP.DMZ}/32 port 443` }] }, ...(c.dnat ? [{ name: "rule-set from-untrust", kids: [{ name: "from zone untrust" }, { name: "rule PUBLISH-WEB", kids: [{ name: "match", kids: [{ name: `destination-address ${PUBLIC}/32` }, { name: "destination-port 443" }] }, { name: "then", kids: [{ name: "destination-nat pool DMZ-WEB-443" }] }] }] }] : [])] },
          ],
        },
        { name: "policies", kids: pairs.map(([f, t]) => ({ name: `from-zone ${f} to-zone ${t}`, kids: pol(f, t) })) },
        { name: "zones", kids: FW_ZONES.map((z) => ({ name: `security-zone ${z}`, kids: [...(z === "trust" ? [{ name: "host-inbound-traffic", kids: [{ name: "system-services", kids: [{ name: "ping" }] }] }] : []), { name: "interfaces", kids: [{ name: `${FW_IF[z].ifn}.0` }] }] })) },
      ],
    },
    { name: "routing-options", kids: [{ name: "static", kids: [{ name: `route 0.0.0.0/0 next-hop ${ISP_IP.fw}` }] }] },
  ];
}
export const fwJunosText = (c: FwCand, path: string[] = []) => walk(junosTree(c), path);

// ---------------------------------------------------------------------------------------------------------------
// IOS zone-based firewall
// ---------------------------------------------------------------------------------------------------------------
function iosExec(api: FwCliApi): CliCommand[] {
  const s = api.view;
  const c = s.cfg;
  const sessRows = (f?: FwZone, t?: FwZone) => live(s).filter((x) => !f || (x.from === f && x.to === t));
  return [
    { id: "zone", syntax: "show zone security", summary: "Zones and their member interfaces", run: () => ({ output: ["zone self", "  Description: System Defined Zone", ...FW_ZONES.flatMap((z) => [`zone ${IOS_ZONE[z]}`, "  Member Interfaces:", `    ${ifName("cisco", FW_IF[z].ifn, true)}`])].join("\n"), explanation: "Traffic between two zones is dropped unless a zone-pair with an inspect policy allows it. The router itself is the self zone." }) },
    { id: "zp", syntax: "show zone-pair security", summary: "Zone pairs (one per direction) and their policies", run: () => ({ output: pairsOf(c).map(([f, t]) => [`Zone-pair name ${zonePair(f, t)}`, `    Source-Zone ${IOS_ZONE[f]}  Destination-Zone ${IOS_ZONE[t]}`, `    service-policy ${policyMap(f, t)}`].join("\n")).join("\n"), explanation: "Each direction is its own zone-pair. Replies need no zone-pair of their own: the inspect session admits them." }) },
    {
      id: "pmzp",
      syntax: "show policy-map type inspect zone-pair",
      summary: "Every zone-pair's classes, in order, with packet counts",
      run: () => ({
        output: pairsOf(c)
          .map(([f, t]) => {
            const rs = c.rules.filter((r) => r.from === f && r.to === t);
            return [`policy exists on zp ${zonePair(f, t)}`, `  Zone-pair: ${zonePair(f, t)}`, "", `  Service-policy inspect : ${policyMap(f, t)}`, ...rs.flatMap((r) => ["", `    Class-map: CM-${r.name} (match-all)`, `      Match: access-group name ACL-${r.name}`, ...(r.app === "any" ? [] : [`      Match: protocol ${r.app}`]), r.action === "permit" ? "      Inspect" : "      Drop", `        ${s.hits[hitKey(f, t, r.name)] ?? 0} packets, ${(s.hits[hitKey(f, t, r.name)] ?? 0) * 60} bytes`]), "", "    Class-map: class-default (match-any)", "      Match: any", "      Drop", `        ${s.hits[hitKey(f, t)] ?? 0} packets, ${(s.hits[hitKey(f, t)] ?? 0) * 60} bytes`].join("\n");
          })
          .join("\n\n"),
        explanation: "Classes are checked top-down; the first match decides (Inspect = allow and track, Drop). class-default catches everything else: the implicit deny. A class that counts packets it shouldn't is usually a rule placed too high or written too broadly.",
      }),
    },
    { id: "sess", syntax: "show policy-map type inspect zone-pair sessions", summary: "The inspect session table", run: () => ({ output: pairsOf(c).filter(([f, t]) => sessRows(f, t).length).map(([f, t]) => [`  Zone-pair: ${zonePair(f, t)}`, "", ...sessRows(f, t).flatMap((x) => [`    Class-map: CM-${x.rule} (match-all)`, `      Inspect`, `        ${x.state === "ESTABLISHED" || x.state === "ICMP" ? "Established" : "Half-open"} Sessions`, `         Session ID 0x${x.id.toString(16).toUpperCase().padStart(8, "0")} (${x.src}:${x.sport})=>(${x.realDst}:${x.realDport}) ${x.proto === "icmp" ? "icmp" : x.realDport === 443 ? "https" : x.realDport === 80 ? "http" : "tcp"} ${sessState(x, true)}`, `          Created ${String(Math.floor((s.clock - x.created) / 60)).padStart(2, "0")}:${String((s.clock - x.created) % 60).padStart(2, "0")} ago, Bytes sent (initiator:responder) [${Math.ceil(x.pkts / 2) * 60}:${Math.floor(x.pkts / 2) * 60}]`])].join("\n")).join("\n\n") || "  (no sessions)", explanation: "SIS_OPEN = the handshake completed. SIS_OPENING that never opens = the reply never came back: look past the firewall (NAT, return route, the server)." }) },
    { id: "nat", syntax: "show ip nat translations", summary: "Translations: inside local ↔ inside global", run: () => ({ output: columns([["Pro", "Inside global", "Inside local", "Outside local", "Outside global"], ...(c.dnat ? [["tcp", `${PUBLIC}:443`, `${HOST_IP.DMZ}:443`, "---", "---"]] : []), ...live(s).filter((x) => x.xsrc !== x.src || x.realDst !== x.dst).map((x) => (x.realDst !== x.dst ? [x.proto, `${x.dst}:${x.dport}`, `${x.realDst}:${x.realDport}`, `${x.src}:${x.sport}`, `${x.src}:${x.sport}`] : [x.proto, `${x.xsrc}:${x.xsport}`, `${x.src}:${x.sport}`, `${x.realDst}:${x.realDport}`, `${x.realDst}:${x.realDport}`]))], [5, 22, 22, 22]), explanation: "Inside local = the private address; inside global = what the internet sees. If the inside global isn't an address the ISP routes to you, replies can never come back." }) },
    { id: "run", syntax: "show running-config", summary: "FW1's configuration", run: () => ({ output: iosRunning(c, api.spare) }) },
    { id: "route", syntax: "show ip route", summary: "The routing table", run: () => ({ output: ["Codes: L - local, C - connected, S - static", "", `Gateway of last resort is ${ISP_IP.fw} to network 0.0.0.0`, "", `S*    0.0.0.0/0 [1/0] via ${ISP_IP.fw}`, ...FW_ZONES.flatMap((z) => [`C        ${FW_IF[z].net} is directly connected, ${ifName("cisco", FW_IF[z].ifn, true)}`, `L        ${FW_IF[z].ip}/32 is directly connected, ${ifName("cisco", FW_IF[z].ifn, true)}`])].join("\n") }) },
    { id: "brief", syntax: "show ip interface brief", summary: "Interfaces and addresses", run: () => ({ output: columns([["Interface", "IP-Address", "OK?", "Method", "Status", "Protocol"], ...FW_ZONES.map((z) => [ifName("cisco", FW_IF[z].ifn, true), FW_IF[z].ip, "YES", "NVRAM", "up", "up"])], [27, 16, 4, 7, 22]) }) },
    {
      id: "log",
      syntax: "show logging",
      summary: "The log: sessions started, packets dropped",
      run: () => {
        const l = s.fwlog.slice(-40).map((x) => {
          const t = stamp(x.clock).ios;
          const p = x.pkt;
          if (x.kind === "create") return `${t}: %FW-6-SESS_AUDIT_TRAIL_START: (target:class)-(${zonePair(x.from!, x.to!)}:CM-${x.rule}):Start ${p.proto === "icmp" ? "icmp" : p.dport === 443 ? "https" : p.dport === 80 ? "http" : "tcp"} session: initiator (${p.src}:${p.sport}) -- responder (${p.dst}:${p.dport})`;
          if (x.kind === "nosession") return `${t}: %FW-6-DROP_PKT: Dropping ${p.proto} pkt ${p.src}:${p.sport} => ${p.dst}:${p.dport} due to ${p.proto === "tcp" ? "Stray Segment" : "Invalid Packet"} with ip ident 0`;
          if (x.kind === "close") return `${t}: %FW-6-SESS_AUDIT_TRAIL: (target:class)-(${zonePair(x.from!, x.to!)}):Stop session: reset`;
          return x.to ? `${t}: %FW-6-DROP_PKT: Dropping ${p.proto} session ${p.src}:${p.sport} ${p.dst}:${p.dport} on zone-pair ${zonePair(x.from!, x.to)} class ${x.rule === "default-deny" ? "class-default" : `CM-${x.rule}`} with ip ident 0` : `${t}: %FW-6-DROP_PKT: Dropping ${p.proto} session ${p.src}:${p.sport} ${p.dst}:${p.dport} on zone-pair ZP-${x.from === "untrust" ? "OUT" : x.from === "trust" ? "IN" : "DMZ"}-SELF class class-default with ip ident 0`;
        });
        return { output: ["Syslog logging: enabled", "", "Log Buffer (8192 bytes):", ...(l.length ? l : ["(no messages)"])].join("\n"), explanation: "DROP_PKT names the zone-pair and the class that dropped it — class-default means no rule allowed it. A session that started but never shows traffic back points past the firewall." };
      },
    },
    { id: "clr", syntax: "clear zone-pair inspect sessions", summary: "Clear the session table", run: () => (api.act({ type: "clear" }), { output: "" }) },
    { id: "clrnat", syntax: "clear ip nat translation *", summary: "Clear dynamic translations (and their sessions)", run: () => (api.act({ type: "clear" }), { output: "" }) },
    { id: "hist", syntax: "show history", summary: "The commands you typed in this session", run: () => ({ output: [...(api.history ?? []), "show history"].map((x) => `  ${x}`).join("\n") }) },
  ];
}
function iosSet(api: FwCliApi): CliCommandSet {
  const s = api.view;
  const c = s.cfg;
  const base = { vendor: "cisco" as const, deviceId: "FW1", deviceName: "FW1" };
  const exec = iosExec(api);
  const mode = api.ios;
  const apply = (cfg: FwCfg, text: string) => api.act({ type: "cfg", cfg, text: `FW1: ${text}` });
  const end: CliCommand = { id: "end", syntax: "end", summary: "Leave configuration mode", run: () => (api.setIos({ kind: "exec" }), { output: "%SYS-5-CONFIG_I: Configured from console by console" }) };
  if (mode.kind === "exec") return { ...base, prompt: "FW1#", commands: [...exec, { id: "conf", syntax: "configure terminal", summary: "Enter configuration mode", run: () => (api.setIos({ kind: "config" }), { output: "Enter configuration commands, one per line.  End with CNTL/Z." }) }] };
  const doCmds = prefixed(exec, "do");
  const all = [...c.rules, ...api.spare];
  const aclArg = nameArg(all.map((r) => `ACL-${r.name}`));
  if (mode.kind === "config") {
    const natCmd = (z: "trust" | "dmz", m: SnatMode, neg: boolean): CliCommand => ({
      id: `nat-${z}-${m}-${neg}`,
      syntax: `${neg ? "no " : ""}ip nat inside source list <list> ${m === "interface" ? "interface <ifc>" : "pool <pool>"} overload`,
      args: { list: { choices: [z === "trust" ? "NAT-INSIDE" : "NAT-DMZ"], describe: () => (z === "trust" ? "10.10.10.0/24 (trust)" : "172.16.0.0/24 (dmz)"), resolve: (raw) => (raw.toUpperCase() === (z === "trust" ? "NAT-INSIDE" : "NAT-DMZ") ? raw.toUpperCase() : undefined) }, ...(m === "interface" ? { ifc: OUT_IF } : { pool: { choices: ["BAD-POOL"], describe: () => BAD_NAT, resolve: (raw) => (raw.toUpperCase() === "BAD-POOL" ? "BAD-POOL" : undefined) } }) },
      summary: neg ? `Remove source NAT for ${z === "trust" ? "the office" : "the DMZ"}` : `Source NAT (PAT) ${z === "trust" ? "the office" : "the DMZ"} to ${m === "interface" ? "Gi0/1's address" : `BAD-POOL ${BAD_NAT}`}`,
      run: () => {
        const cfg = fwClone(c);
        if (neg) {
          if (cfg.snat[z] !== m) return refuse("%Translation not found");
          cfg.snat[z] = "off";
        } else cfg.snat[z] = m;
        apply(cfg, `${neg ? "no " : ""}ip nat inside source list ${z === "trust" ? "NAT-INSIDE" : "NAT-DMZ"} ${m === "interface" ? "interface GigabitEthernet0/1" : "pool BAD-POOL"} overload`);
        return { output: "", explanation: neg ? "Traffic from that zone to OUTSIDE now leaves with its private source — the internet can't answer it." : m === "interface" ? `Translated to ${PUBLIC}: the address the ISP routes to us.` : `Translated to ${BAD_NAT}: outside the /30 the ISP routes to us — replies won't come back.` };
      },
    });
    return {
      ...base,
      prompt: "FW1(config)#",
      commands: [
        { id: "acl", syntax: "ip access-list extended <acl>", summary: "Edit a rule's match ACL", args: { acl: aclArg }, run: ({ acl }) => (api.setIos({ kind: "acl", rule: acl.slice(4) }), { output: "", explanation: `ACL-${acl.slice(4)} is what class-map CM-${acl.slice(4)} matches: change it with permit … / no permit ….` }) },
        { id: "pm", syntax: "policy-map type inspect <pm>", summary: "Edit a zone-pair's policy (rule order and actions)", args: { pm: pmArg }, run: ({ pm }) => { const [f, t] = pm.split(">") as [FwZone, FwZone]; api.setIos({ kind: "pm", from: f, to: t }); return { output: "" }; } },
        ...(["trust", "dmz"] as const).flatMap((z) => (["interface", "bad"] as SnatMode[]).flatMap((m) => [natCmd(z, m, false), natCmd(z, m, true)])),
        { id: "dnat", syntax: "ip nat inside source static tcp <local> <lport> interface <ifc> <gport>", summary: "Publish the DMZ server's HTTPS on Gi0/1's address", args: STATIC_ARGS, run: () => { const cfg = fwClone(c); cfg.dnat = true; apply(cfg, "static NAT 198.51.100.2:443 → 172.16.0.10:443"); return { output: "", explanation: "Connections to 198.51.100.2:443 from OUTSIDE are now translated to 172.16.0.10:443 — before the zone-pair policy sees them, so the policy must allow the REAL address." }; } },
        { id: "dnat", syntax: "no ip nat inside source static tcp <local> <lport> interface <ifc> <gport>", summary: "Stop publishing it", args: STATIC_ARGS, run: () => { const cfg = fwClone(c); cfg.dnat = false; apply(cfg, "no static NAT for the DMZ server"); return { output: "" }; } },
        { id: "objg", syntax: "object-group network <obj>", summary: "", hidden: true, args: { obj: objArg() }, run: () => refuse("% Not available in this lab: the object-groups are fixed.", "Pick the right object in a rule instead of changing what the object means.") },
        { id: "exit", syntax: "exit", summary: "Back to privileged mode", run: () => (api.setIos({ kind: "exec" }), { output: "" }) },
        end,
        ...doCmds,
      ],
    };
  }
  if (mode.kind === "acl") {
    const r = all.find((x) => x.name === mode.rule)!;
    const setRule = (nr: FwRule, text: string) => {
      const cfg = fwClone(c);
      const i = cfg.rules.findIndex((x) => x.name === nr.name);
      if (i >= 0) {
        cfg.rules[i] = nr;
        apply(cfg, `ACL-${nr.name}: ${text}`);
      } else api.setSpare(api.spare.map((x) => (x.name === nr.name ? nr : x)));
    };
    const cmds: CliCommand[] = [];
    const forms: { src: boolean; dst: boolean }[] = [
      { src: true, dst: true },
      { src: true, dst: false },
      { src: false, dst: true },
      { src: false, dst: false },
    ];
    for (const neg of [false, true])
      for (const proto of ["tcp", "icmp", "ip"] as const)
        for (const f of forms) {
          const syn = `${neg ? "no " : ""}permit ${proto} ${f.src ? "object-group <s>" : "any"} ${f.dst ? "object-group <d>" : "any"}${proto === "tcp" ? " eq <port>" : ""}`;
          cmds.push({
            id: `ace-${neg}-${proto}`,
            syntax: syn,
            summary: neg ? "Remove this entry" : "Match this traffic",
            args: { ...(f.src ? { s: objArg() } : {}), ...(f.dst ? { d: objArg() } : {}), ...(proto === "tcp" ? { port: portArg } : {}) },
            run: (a) => {
              const src = f.src ? a.s : "any";
              const dst = f.dst ? a.d : "any";
              const app: FwApp | undefined = proto === "icmp" ? "icmp" : proto === "ip" ? "any" : appOfPort(+a.port);
              if (!app) return refuse("", `This lab's applications are 443, 80 and 22 (and icmp / ip).`);
              const empty = !r.src.length || !r.dst.length;
              if (neg) {
                if (empty || r.app !== app || !r.src.includes(src) || !r.dst.includes(dst)) return refuse("% Entry not found");
                const nr = { ...r, src: r.dst.length === 1 ? r.src.filter((x) => x !== src) : r.src, dst: r.dst.length === 1 ? r.dst : r.dst.filter((x) => x !== dst) };
                if (r.src.length > 1 && r.dst.length > 1) return refuse("", "In this lab a rule's ACL removes one source or one destination at a time.");
                if (r.dst.length === 1 && r.src.length === 1) nr.dst = [];
                setRule(nr, syn.replace("<s>", src).replace("<d>", dst).replace("<port>", a.port ?? ""));
                return { output: "", explanation: nr.src.length && nr.dst.length ? undefined : `ACL-${r.name} is empty now: CM-${r.name} matches nothing.` };
              }
              if (empty) {
                setRule({ ...r, src: [src], dst: [dst], app }, syn.replace("<s>", src).replace("<d>", dst).replace("<port>", a.port ?? ""));
                return { output: "" };
              }
              if (r.app !== app) return refuse("", `CM-${r.name} matches ${r.app}: in this lab one rule = one application. Remove the entry first (no permit …) to change it.`);
              if (r.dst.length === 1 && r.dst[0] === dst && !r.src.includes(src)) setRule({ ...r, src: [...r.src, src] }, `+ source ${src}`);
              else if (r.src.length === 1 && r.src[0] === src && !r.dst.includes(dst)) setRule({ ...r, dst: [...r.dst, dst] }, `+ destination ${dst}`);
              else if (r.src.includes(src) && r.dst.includes(dst)) return { output: "", explanation: "That entry is already there." };
              else return refuse("", "In this lab a rule's ACL adds one source or one destination at a time.");
              return { output: "" };
            },
          });
        }
    return { ...base, prompt: "FW1(config-ext-nacl)#", commands: [...cmds, { id: "exit", syntax: "exit", summary: "Back to global configuration", run: () => (api.setIos({ kind: "config" }), { output: "" }) }, end, ...doCmds] };
  }
  if (mode.kind === "pm") {
    const { from, to } = mode;
    const cmArg = nameArg(all.map((r) => `CM-${r.name}`));
    return {
      ...base,
      prompt: "FW1(config-pmap)#",
      commands: [
        {
          id: "cls",
          syntax: "class type inspect <cm>",
          summary: "Add a class (at the end, before class-default) or edit it",
          args: { cm: cmArg },
          run: ({ cm }) => {
            const name = cm.slice(3);
            const cur = c.rules.find((r) => r.name === name);
            if (cur && cur.from === from && cur.to === to) return (api.setIos({ kind: "pmclass", from, to, rule: name }), { output: "" });
            const sp = api.spare.find((r) => r.name === name) ?? cur!;
            const cfg = fwClone(c);
            cfg.rules = cfg.rules.filter((r) => r.name !== name);
            cfg.rules.push({ ...sp, from, to });
            api.setSpare(api.spare.filter((r) => r.name !== name));
            apply(cfg, `${policyMap(from, to)}: class CM-${name} added at the end`);
            api.setIos({ kind: "pmclass", from, to, rule: name });
            return { output: "", explanation: `CM-${name} is now the LAST rule of ${zonePair(from, to)} (just before class-default). Set its action: inspect or drop.` };
          },
        },
        {
          id: "ncls",
          syntax: "no class type inspect <cm>",
          summary: "Remove a class from this policy",
          args: { cm: cmArg },
          run: ({ cm }) => {
            const name = cm.slice(3);
            const r = c.rules.find((x) => x.name === name && x.from === from && x.to === to);
            if (!r) return refuse(`% Class-map ${cm} not configured in this policy-map`);
            const cfg = fwClone(c);
            cfg.rules = cfg.rules.filter((x) => x !== r && x.name !== name);
            api.setSpare([...api.spare.filter((x) => x.name !== name), r]);
            apply(cfg, `${policyMap(from, to)}: no class CM-${name}`);
            return { output: "", explanation: `The rule is gone from ${zonePair(from, to)} (its class-map and ACL stay defined). Re-adding it puts it at the end.` };
          },
        },
        { id: "exit", syntax: "exit", summary: "Back to global configuration", run: () => (api.setIos({ kind: "config" }), { output: "" }) },
        end,
        ...doCmds,
      ],
    };
  }
  const { from, to, rule } = mode;
  const act = (a: "permit" | "deny"): CliResult => {
    const cfg = fwClone(c);
    const r = cfg.rules.find((x) => x.name === rule && x.from === from && x.to === to);
    if (!r) return refuse("% Class not in this policy-map");
    r.action = a;
    apply(cfg, `${policyMap(from, to)} CM-${rule}: ${a === "permit" ? "inspect" : "drop"}`);
    return { output: "" };
  };
  return {
    ...base,
    prompt: "FW1(config-pmap-c)#",
    commands: [
      { id: "insp", syntax: "inspect", summary: "Allow and track (stateful)", run: () => act("permit") },
      { id: "drop", syntax: "drop", summary: "Drop", run: () => act("deny") },
      { id: "drop", syntax: "drop log", summary: "Drop and log", run: () => act("deny") },
      { id: "pass", syntax: "pass", summary: "", hidden: true, run: () => refuse("", "pass forwards one direction without a session — replies would be dropped. Use inspect.") },
      { id: "exit", syntax: "exit", summary: "Back to the policy-map", run: () => (api.setIos({ kind: "pm", from, to }), { output: "" }) },
      end,
      ...doCmds,
    ],
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Junos SRX
// ---------------------------------------------------------------------------------------------------------------
function junosOp(api: FwCliApi): CliCommand[] {
  const s = api.view;
  const c = s.cfg;
  const zA = zoneArg("juniper");
  const sessText = (xs: FwSession[]) => (xs.length ? [...xs.map((x) => { const gi = c.rules.findIndex((r) => r.name === x.rule) + 4; return [`Session ID: ${x.id}, Policy name: ${x.rule}/${gi}, Timeout: ${x.state === "ESTABLISHED" ? 1800 : x.proto === "icmp" ? 60 : 20}, Valid`, `  In: ${x.src}/${x.sport} --> ${x.dst}/${x.dport};${x.proto}, Conn Tag: 0x0, If: ${FW_IF[x.from].ifn}.0, Pkts: ${Math.ceil(x.pkts / 2)}, Bytes: ${Math.ceil(x.pkts / 2) * 60},`, `  Out: ${x.realDst}/${x.realDport} --> ${x.xsrc}/${x.xsport};${x.proto}, Conn Tag: 0x0, If: ${FW_IF[x.to].ifn}.0, Pkts: ${Math.floor(x.pkts / 2)}, Bytes: ${Math.floor(x.pkts / 2) * 60},`].join("\n"); }), `Total sessions: ${xs.length}`].join("\n") : "Total sessions: 0");
  return [
    { id: "zones", syntax: "show security zones", summary: "Zones and interfaces", run: () => ({ output: FW_ZONES.map((z) => [`Security zone: ${z}`, "  Send reset for non-SYN session TCP packets: Off", "  Policy configurable: Yes", "  Interfaces bound: 1", "  Interfaces:", `    ${FW_IF[z].ifn}.0`].join("\n")).join("\n\n") }) },
    { id: "pol", syntax: "show security policies", summary: "Every policy, per zone pair, in order", run: () => ({ output: [...FW_ZONES.flatMap((f) => FW_ZONES.filter((t) => t !== f).map((t) => [f, t] as [FwZone, FwZone])).filter(([f, t]) => c.rules.some((r) => r.from === f && r.to === t)).map(([f, t]) => [`From zone: ${f}, To zone: ${t}`, ...c.rules.filter((r) => r.from === f && r.to === t).map((r, i) => [`  Policy: ${r.name}, State: enabled, Index: ${c.rules.indexOf(r) + 4}, Scope Policy: 0, Sequence number: ${i + 1}`, `    Source addresses: ${r.src.join(", ")}`, `    Destination addresses: ${r.dst.join(", ")}`, `    Applications: ${JUNOS_APP[r.app]}`, `    Action: ${r.action}`].join("\n"))].join("\n")), "Default policy: deny-all"].join("\n"), explanation: "Within a zone pair the first policy that matches decides. Anything no policy matches hits the default policy: deny-all." }) },
    { id: "polz", syntax: "show security policies from-zone <from> to-zone <to>", summary: "One zone pair's policies", args: { from: zA, to: zA }, run: ({ from, to }) => { const rs = c.rules.filter((r) => r.from === from && r.to === to); return { output: rs.length ? [`From zone: ${from}, To zone: ${to}`, ...rs.map((r, i) => `  Policy: ${r.name}, State: enabled, Index: ${c.rules.indexOf(r) + 4}, Sequence number: ${i + 1}\n    Source addresses: ${r.src.join(", ")}\n    Destination addresses: ${r.dst.join(", ")}\n    Applications: ${JUNOS_APP[r.app]}\n    Action: ${r.action}`)].join("\n") : "", explanation: rs.length ? undefined : `No policies from ${from} to ${to}: everything is denied by default.` }; } },
    { id: "hits", syntax: "show security policies hit-count", summary: "How many sessions each policy matched", run: () => ({ output: ["Logical system: root-logical-system", columns([["Index", "From zone", "To zone", "Name", "Policy count", "Action"], ...c.rules.map((r, i) => [String(i + 1), r.from, r.to, r.name, String(s.hits[hitKey(r.from, r.to, r.name)] ?? 0), r.action === "permit" ? "Permit" : "Deny"])], [7, 11, 11, 15, 14]), "", `Number of policy: ${c.rules.length}`].join("\n"), explanation: "A deny policy counting traffic it was never meant for — or an allow policy stuck at 0 — is the classic sign of a rule placed above another." }) },
    { id: "flow", syntax: "show security flow session", summary: "The session table (both directions)", run: () => ({ output: sessText(live(s)), explanation: "In = as the initiator sent it; Out = what the reply must look like (after NAT). A session whose Out side never counts packets: the reply never came back." }) },
    { id: "flow", syntax: "show security flow session summary", summary: "Session counts", run: () => ({ output: [`Unicast-sessions on FPC0 PIC0:`, `Valid sessions: ${live(s).length}`, `Pending sessions: 0`, `Invalidated sessions: ${s.sessions.length - live(s).length}`, `Sessions in other states: 0`, `Total sessions: ${s.sessions.length}`].join("\n") }) },
    { id: "snat", syntax: "show security nat source rule all", summary: "Source NAT rules and their hits", run: () => { const rs = (["trust", "dmz"] as const).filter((z) => c.snat[z] !== "off"); return { output: [`Total rules: ${rs.length}`, ...rs.map((z, i) => [`source NAT rule: ${snatRuleName(z)}           Rule-set: ${z}-to-untrust`, `  Rule-Id                    : ${i + 1}`, `  From zone                  : ${z}`, "  To zone                    : untrust", "  Match", `    Source addresses         : ${z === "trust" ? "10.10.10.0      - 10.10.10.255" : "172.16.0.0      - 172.16.0.255"}`, `  Action                        : ${c.snat[z] === "interface" ? "interface" : "BAD-POOL"}`, ...(c.snat[z] === "bad" ? [`    Pool address             : ${BAD_NAT}`] : []), `  Translation hits           : ${s.sessions.filter((x) => x.from === z && x.to === "untrust" && x.xsrc !== x.src).length}`].join("\n"))].join("\n"), explanation: rs.length < 2 ? "A zone with no source NAT rule sends its private addresses to the internet." : undefined }; } },
    { id: "dnat", syntax: "show security nat destination rule all", summary: "Destination NAT rules", run: () => ({ output: c.dnat ? ["Total destination-nat rules: 1", "destination NAT rule: PUBLISH-WEB          Rule-set: from-untrust", "  Rule-Id                    : 1", "  From zone                  : untrust", "  Match", `    Destination addresses    : ${PUBLIC}    - ${PUBLIC}`, "    Destination port         : 443", "  Action                     : DMZ-WEB-443", `  Translation hits           : ${s.sessions.filter((x) => x.realDst !== x.dst).length}`].join("\n") : "Total destination-nat rules: 0", explanation: "Destination NAT runs BEFORE the policy lookup: the policy sees the server's real address (172.16.0.10)." }) },
    {
      id: "match",
      syntax: "show security match-policies from-zone <from> to-zone <to> source-ip <src> destination-ip <dst> source-port <sport> destination-port <dport> protocol tcp",
      summary: "Which policy would match this TCP flow?",
      args: { from: zA, to: zA, src: ipArg([HOST_IP.CLIENT, HOST_IP.LAB, HOST_IP.OUT]), dst: ipArg([HOST_IP.WEB, HOST_IP.DMZ]), sport: { choices: ["51000"], resolve: (raw) => (/^\d+$/.test(raw) ? raw : undefined) }, dport: portArg },
      run: (a) => { const h = fwPolicy(c, a.from as FwZone, a.to as FwZone, a.src, a.dst, "tcp", +a.dport); return { output: h.rule ? [`Policy: ${h.rule.name}, action-type: ${h.rule.action}, State: enabled, Index: ${c.rules.indexOf(h.rule) + 4}`, `  Policy Type: Configured`, `  Sequence number: ${h.index}`, `  From zone: ${a.from}, To zone: ${a.to}`, `  Source addresses: ${h.rule.src.join(", ")}`, `  Destination addresses: ${h.rule.dst.join(", ")}`, `  Application: ${JUNOS_APP[h.rule.app]}`].join("\n") : "Policy: default-deny, action-type: deny, State: enabled", explanation: h.why + (a.from === "untrust" && a.dst === PUBLIC ? ". Remember: the policy is evaluated on the address AFTER destination NAT — test with destination-ip 172.16.0.10." : "") }; },
    },
    { id: "route", syntax: "show route", summary: "The routing table", run: () => ({ output: ["inet.0: 7 destinations, 7 routes (7 active, 0 holddown, 0 hidden)", "+ = Active Route, - = Last Active, * = Both", "", `0.0.0.0/0          *[Static/5] 2d 01:00:00`, `                    >  to ${ISP_IP.fw} via ge-0/0/1.0`, ...FW_ZONES.flatMap((z) => [`${FW_IF[z].net.padEnd(19)}*[Direct/0] 2d 01:00:00`, `                    >  via ${FW_IF[z].ifn}.0`, `${`${FW_IF[z].ip}/32`.padEnd(19)}*[Local/0] 2d 01:00:00`, `                       Local via ${FW_IF[z].ifn}.0`])].join("\n") }) },
    { id: "terse", syntax: "show interfaces terse", summary: "Interfaces and addresses", run: () => ({ output: columns([["Interface", "Admin", "Link", "Proto", "Local"], ...FW_ZONES.flatMap((z) => [[FW_IF[z].ifn, "up", "up", "", ""], [`${FW_IF[z].ifn}.0`, "up", "up", "inet", `${FW_IF[z].ip}/${FW_IF[z].len}`]])], [24, 6, 5, 6]) }) },
    {
      id: "log",
      syntax: "show log messages",
      summary: "Flow logs: sessions created, denied",
      run: () => {
        const l = s.fwlog.slice(-40).map((x) => {
          const t = stamp(x.clock).junos;
          const p = x.pkt;
          const xs = s.sessions.find((y) => y.id === x.session);
          if (x.kind === "create") return `${t}  FW1 RT_FLOW: RT_FLOW_SESSION_CREATE: session created ${p.src}/${p.sport}->${p.dst}/${p.dport} ${p.proto === "icmp" ? "icmp" : JUNOS_APP[APPS.find((a) => APP_PORT[a] === p.dport) ?? "any"]} ${xs?.xsrc ?? p.src}/${xs?.xsport ?? p.sport}->${xs?.realDst ?? p.dst}/${xs?.realDport ?? p.dport} ${xs && xs.xsrc !== xs.src ? "r1" : "None"} ${xs && xs.realDst !== xs.dst ? "PUBLISH-WEB" : "None"} ${p.proto === "tcp" ? 6 : 1} ${x.rule} ${x.from} ${x.to} ${x.session}`;
          if (x.kind === "close") return `${t}  FW1 RT_FLOW: RT_FLOW_SESSION_CLOSE: session closed TCP RST: ${p.src}/${p.sport}->${p.dst}/${p.dport} ${x.session}`;
          if (x.kind === "nosession") return `${t}  FW1 RT_FLOW: FLOW_TCP_NONSYN_DROP? `.replace("FLOW_TCP_NONSYN_DROP? ", `RT_FLOW_SESSION_DENY: session denied ${p.src}/${p.sport}->${p.dst}/${p.dport} None ${p.proto === "tcp" ? 6 : 1}(0) N/A ${x.from} N/A UNKNOWN UNKNOWN N/A(N/A) ${FW_IF[x.from!].ifn}.0 No first-packet-not-SYN`);
          return `${t}  FW1 RT_FLOW: RT_FLOW_SESSION_DENY: session denied ${p.src}/${p.sport}->${p.dst}/${p.dport} ${p.proto === "icmp" ? "icmp" : JUNOS_APP[APPS.find((a) => APP_PORT[a] === p.dport) ?? "any"]} ${p.proto === "tcp" ? 6 : 1}(0) ${x.rule === "self" ? "N/A" : x.rule} ${x.from} ${x.to ?? "junos-host"} UNKNOWN UNKNOWN N/A(N/A) ${FW_IF[x.from!].ifn}.0 No ${x.rule === "default-deny" ? "policy deny" : x.rule === "self" ? "host-inbound-traffic not allowed" : "policy deny"}`;
        });
        return { output: l.length ? l.join("\n") : "(no messages)", explanation: "SESSION_DENY names the policy that denied it (default-deny = nothing allowed it). A SESSION_CREATE with no traffic coming back points past the firewall." };
      },
    },
    { id: "cfg", syntax: "show configuration security policies", summary: "Committed policies", run: () => ({ output: fwJunosText(c, ["security", "policies"]) }) },
    { id: "cfg", syntax: "show configuration security nat", summary: "Committed NAT", run: () => ({ output: fwJunosText(c, ["security", "nat"]) }) },
    { id: "cfg", syntax: "show configuration security zones", summary: "Committed zones", run: () => ({ output: fwJunosText(c, ["security", "zones"]) }) },
    { id: "cfg", syntax: "show configuration security", summary: "Committed security configuration", run: () => ({ output: fwJunosText(c, ["security"]) }) },
    { id: "cfg", syntax: "show configuration", summary: "The committed configuration", run: () => ({ output: fwJunosText(c) }) },
    { id: "clr", syntax: "clear security flow session all", summary: "Clear every session", run: () => (api.act({ type: "clear" }), { output: `${live(s).length} active sessions cleared` }) },
    { id: "hist", syntax: "show cli history", summary: "The commands you typed in this session", run: () => ({ output: [...(api.history ?? []), "show cli history"].map((x, n) => `${String(n + 1).padStart(4)}  ${x}`).join("\n") }) },
  ];
}
function junosSet(api: FwCliApi): CliCommandSet {
  const s = api.view;
  const base = { vendor: "juniper" as const, deviceId: "FW1", deviceName: "FW1" };
  const op = junosOp(api);
  const active = s.cfg;
  const rbHist = s.rb ?? [];
  const cand = api.cand;
  const strip = (x: FwCand): FwCfg => ({ rules: x.rules, snat: x.snat, dnat: x.dnat, dmzGw: x.dmzGw });
  const dirty = JSON.stringify(strip(cand)) !== JSON.stringify(active) || !!cand.drafts?.length;
  const configure: CliCommand = { id: "conf", syntax: "configure", summary: "Enter configuration mode", run: () => (!dirty && api.setCand(fwClone(active)), api.setJunosEdit(true), { output: dirty ? "Entering configuration mode\nThe configuration has been changed but not committed\n" : "Entering configuration mode\n" }) };
  if (!api.junosEdit) return { ...base, prompt: "admin@FW1> ", commands: [...op, configure] };
  const zA = zoneArg("juniper");
  const names = [...new Set([...cand.rules.map((r) => r.name), ...(cand.drafts ?? []).map((r) => r.name!)])];
  const polArg: CliArgSpec = { choices: names, resolve: (raw) => (/^[A-Za-z][\w-]{0,30}$/.test(raw) ? raw.toUpperCase() : undefined) };
  const existArg: CliArgSpec = { choices: names, resolve: (raw) => names.find((n) => n === raw.toUpperCase()) };
  const appA: CliArgSpec = { choices: APPS.map((a) => JUNOS_APP[a]), resolve: (raw) => (appOfJunos(raw) ? raw : undefined) };
  /** Update a policy (complete or draft); promotes a draft once every mandatory statement is present. */
  const edit = (from: FwZone, to: FwZone, name: string, f: (r: Partial<FwRule>) => Partial<FwRule> | undefined): CliResult => {
    const c = fwClone(cand);
    const i = c.rules.findIndex((r) => r.name === name);
    if (i >= 0) {
      if (c.rules[i].from !== from || c.rules[i].to !== to) return refuse(`error: policy ${name} belongs to from-zone ${c.rules[i].from} to-zone ${c.rules[i].to}`);
      const nr = f(c.rules[i]);
      if (!nr) return refuse("warning: statement not found");
      c.rules[i] = nr as FwRule;
    } else {
      const drafts = c.drafts ?? [];
      const j = drafts.findIndex((r) => r.name === name);
      const cur: Partial<FwRule> = j >= 0 ? drafts[j] : { name, from, to, src: [], dst: [] };
      if (cur.from !== from || cur.to !== to) return refuse(`error: policy ${name} belongs to from-zone ${cur.from} to-zone ${cur.to}`);
      const nr = f(cur);
      if (!nr) return refuse("warning: statement not found");
      const done = !!(nr.src?.length && nr.dst?.length && nr.app && nr.action);
      const rest = drafts.filter((_, k) => k !== j);
      if (done) {
        c.rules.push(nr as FwRule);
        c.drafts = rest;
      } else c.drafts = j >= 0 ? drafts.map((r, k) => (k === j ? nr : r)) : [...drafts, nr];
    }
    api.setCand(c);
    return { output: "" };
  };
  const pre = "security policies from-zone <from> to-zone <to> policy <p>";
  const doCommit = (quit: boolean, check = false): CliResult => {
    if (cand.drafts?.length) {
      const d = cand.drafts[0];
      const miss = [!d.src?.length && "source-address", !d.dst?.length && "destination-address", !d.app && "application", !d.action && "then"].filter(Boolean);
      return refuse(`[edit security policies from-zone ${d.from} to-zone ${d.to} policy ${d.name}]\n  'policy ${d.name}'\n    Missing mandatory statement: '${miss[0]}'\nerror: configuration check-out failed`);
    }
    if (check) return { output: "configuration check succeeds" };
    if (dirty) api.act({ type: "cfg", cfg: strip(cand), text: "FW1: Junos commit", junosCommit: true });
    if (quit) api.setJunosEdit(false);
    return { output: quit ? "commit complete\nExiting configuration mode" : "commit complete", explanation: dirty ? "Active now. Check show security policies hit-count / show security flow session, then prove it with traffic." : undefined };
  };
  const snatCmds = (["trust", "dmz"] as const).flatMap((z): CliCommand[] => [
    { id: `snat-${z}`, syntax: `set security nat source rule-set ${z}-to-untrust rule <rule> then source-nat interface`, summary: `Source NAT ${z} → untrust to ge-0/0/1's address`, args: { rule: fixedName(snatRuleName(z)) }, run: () => (api.setCand({ ...fwClone(cand), snat: { ...cand.snat, [z]: "interface" } }), { output: "" }) },
    { id: `snat-${z}`, syntax: `set security nat source rule-set ${z}-to-untrust rule <rule> then source-nat pool <pool>`, summary: `Source NAT ${z} → untrust to BAD-POOL ${BAD_NAT}`, args: { rule: fixedName(snatRuleName(z)), pool: fixedName("BAD-POOL") }, run: () => (api.setCand({ ...fwClone(cand), snat: { ...cand.snat, [z]: "bad" } }), { output: "" }) },
    { id: `snat-${z}`, syntax: `delete security nat source rule-set ${z}-to-untrust`, summary: `Remove source NAT for ${z}`, run: () => (cand.snat[z] === "off" ? refuse("warning: statement not found") : (api.setCand({ ...fwClone(cand), snat: { ...cand.snat, [z]: "off" } }), { output: "" })) },
  ]);
  return {
    ...base,
    prompt: "admin@FW1# ",
    commands: [
      { id: "src", syntax: `set ${pre} match source-address <a>`, summary: "Add a source address-book entry (or any)", args: { from: zA, to: zA, p: polArg, a: objArg(true) }, run: (a) => edit(a.from as FwZone, a.to as FwZone, a.p, (r) => ({ ...r, src: [...(r.src ?? []).filter((x) => x !== a.a), a.a] })) },
      { id: "dst", syntax: `set ${pre} match destination-address <a>`, summary: "Add a destination address-book entry (or any)", args: { from: zA, to: zA, p: polArg, a: objArg(true) }, run: (a) => edit(a.from as FwZone, a.to as FwZone, a.p, (r) => ({ ...r, dst: [...(r.dst ?? []).filter((x) => x !== a.a), a.a] })) },
      { id: "app", syntax: `set ${pre} match application <app>`, summary: "The application (one per policy in this lab)", args: { from: zA, to: zA, p: polArg, app: appA }, run: (a) => edit(a.from as FwZone, a.to as FwZone, a.p, (r) => ({ ...r, app: appOfJunos(a.app) })) },
      { id: "then", syntax: `set ${pre} then permit`, summary: "Allow (and create a session)", args: { from: zA, to: zA, p: polArg }, run: (a) => edit(a.from as FwZone, a.to as FwZone, a.p, (r) => ({ ...r, action: "permit" })) },
      { id: "then", syntax: `set ${pre} then deny`, summary: "Deny", args: { from: zA, to: zA, p: polArg }, run: (a) => edit(a.from as FwZone, a.to as FwZone, a.p, (r) => ({ ...r, action: "deny" })) },
      { id: "dsrc", syntax: `delete ${pre} match source-address <a>`, summary: "Remove a source entry", args: { from: zA, to: zA, p: existArg, a: objArg(true) }, run: (a) => edit(a.from as FwZone, a.to as FwZone, a.p, (r) => (r.src?.includes(a.a) ? { ...r, src: r.src.filter((x) => x !== a.a) } : undefined)) },
      { id: "ddst", syntax: `delete ${pre} match destination-address <a>`, summary: "Remove a destination entry", args: { from: zA, to: zA, p: existArg, a: objArg(true) }, run: (a) => edit(a.from as FwZone, a.to as FwZone, a.p, (r) => (r.dst?.includes(a.a) ? { ...r, dst: r.dst.filter((x) => x !== a.a) } : undefined)) },
      {
        id: "del",
        syntax: `delete ${pre}`,
        summary: "Delete a policy",
        args: { from: zA, to: zA, p: existArg },
        run: (a) => {
          const c = fwClone(cand);
          const r = c.rules.find((x) => x.name === a.p && x.from === a.from && x.to === a.to);
          const d = (c.drafts ?? []).find((x) => x.name === a.p && x.from === a.from && x.to === a.to);
          if (!r && !d) return refuse("warning: statement not found");
          c.rules = c.rules.filter((x) => x !== r);
          c.drafts = (c.drafts ?? []).filter((x) => x !== d);
          api.setCand(c);
          return { output: "" };
        },
      },
      ...(["before", "after"] as const).map(
        (where): CliCommand => ({
          id: "ins",
          syntax: `insert ${pre} ${where} policy <q>`,
          summary: `Move a policy ${where} another (same zone pair)`,
          args: { from: zA, to: zA, p: existArg, q: existArg },
          run: (a) => {
            const c = fwClone(cand);
            const r = c.rules.find((x) => x.name === a.p && x.from === a.from && x.to === a.to);
            const q = c.rules.find((x) => x.name === a.q && x.from === a.from && x.to === a.to);
            if (!r || !q || r === q) return refuse("error: policy not found in this zone pair");
            c.rules = c.rules.filter((x) => x !== r);
            const qi = c.rules.indexOf(q);
            c.rules.splice(where === "before" ? qi : qi + 1, 0, r);
            api.setCand(c);
            return { output: "" };
          },
        }),
      ),
      ...snatCmds,
      { id: "dnat", syntax: "set security nat destination rule-set from-untrust rule <rule> then destination-nat pool <pool>", summary: "Publish 198.51.100.2:443 → 172.16.0.10:443", args: { rule: fixedName("PUBLISH-WEB"), pool: fixedName("DMZ-WEB-443") }, run: () => (api.setCand({ ...fwClone(cand), dnat: true }), { output: "" }) },
      { id: "dnat", syntax: "delete security nat destination rule-set from-untrust", summary: "Stop publishing", run: () => (!cand.dnat ? refuse("warning: statement not found") : (api.setCand({ ...fwClone(cand), dnat: false }), { output: "" })) },
      { id: "show", syntax: "show", summary: "The candidate configuration (try show | compare)", run: () => ({ output: fwJunosText(cand) }) },
      { id: "show", syntax: "show security policies", summary: "Candidate policies", run: () => ({ output: fwJunosText(cand, ["security", "policies"]) }) },
      { id: "show", syntax: "show security nat", summary: "Candidate NAT", run: () => ({ output: fwJunosText(cand, ["security", "nat"]) }) },
      { id: "commit", syntax: "commit", summary: "Activate the candidate configuration", run: () => doCommit(false) },
      { id: "commit", syntax: "commit check", summary: "Check the candidate", run: () => doCommit(false, true) },
      { id: "commit", syntax: "commit and-quit", summary: "Commit, then leave configuration mode", run: () => doCommit(true) },
      { id: "rollback", syntax: "rollback", summary: "Discard your uncommitted changes (= rollback 0)", run: () => (api.setCand(fwClone(active)), { output: "load complete" }) },
      {
        id: "rollback",
        syntax: "rollback <n>",
        summary: "Load an earlier committed configuration into the candidate (then commit)",
        args: { n: { choices: ["0", ...rbHist.map((_, i) => String(i + 1))], describe: (x) => (x === "0" ? "the active configuration" : x === "1" ? "before the last commit" : `before the last ${x} commits`), resolve: (raw) => (/^\d{1,2}$/.test(raw) ? String(+raw) : undefined) } },
        run: ({ n }) => {
          if (n === "0") return (api.setCand(fwClone(active)), { output: "load complete" });
          const json = rbHist[Number(n) - 1];
          if (!json) return refuse(`error: rollback ${n} does not exist${rbHist.length ? ` (1–${rbHist.length} available)` : " (no commits yet)"}`);
          api.setCand(JSON.parse(json) as FwCfg);
          return { output: "load complete", explanation: `The candidate now holds the configuration from before the last ${n === "1" ? "commit" : `${n} commits`}. show | compare, then commit to activate it.` };
        },
      },
      { id: "addr", syntax: "set security address-book global address <a> <cidr>", summary: "", hidden: true, args: { a: { choices: ["X"], resolve: (raw) => raw }, cidr: { choices: ["10.0.0.0/8"], resolve: (raw) => raw } }, run: () => refuse("error: the address book is fixed in this lab", "Pick the right address-book entry in the policy instead of redefining one.") },
      ...prefixed(op, "run"),
      {
        id: "exit",
        syntax: "exit",
        summary: "Leave configuration mode",
        run: () => {
          if (!dirty || !api.ask) return (api.setJunosEdit(false), { output: "Exiting configuration mode" });
          api.ask({ node: "FW1", prompt: "The configuration has been changed but not committed\nExit with uncommitted changes? [yes,no] (yes) ", answer: (line) => { api.ask?.(undefined); if (/^n(o)?$/i.test(line.trim())) return { output: "" }; api.setJunosEdit(false); return { output: "Exiting configuration mode" }; }, cancel: () => (api.ask?.(undefined), "") });
          return { output: "" };
        },
      },
    ],
  };
}

// ---------------------------------------------------------------------------------------------------------------
// ISP looking glass and hosts
// ---------------------------------------------------------------------------------------------------------------
function ispSet(vendor: CliVendor): CliCommandSet {
  const ro = refuse("% This is the ISP's router: read-only.", "You don't manage the provider. It routes only what it assigned to you (198.51.100.0/30).");
  return {
    vendor,
    deviceId: "ISP",
    deviceName: "ISP",
    prompt: "lg-isp> ",
    commands: [
      { id: "route", syntax: "show ip route", summary: "The ISP's routing table", run: () => ({ output: ["Codes: C - connected, L - local", "", "Gateway of last resort is not set", "", "C        198.51.100.0/30 is directly connected, GigabitEthernet0/0", "L        198.51.100.1/32 is directly connected, GigabitEthernet0/0", "C        203.0.113.0/24 is directly connected, GigabitEthernet0/1", "L        203.0.113.1/32 is directly connected, GigabitEthernet0/1"].join("\n"), explanation: "Only the /30 points to your firewall. A reply to any other address of yours (or to a private one) has no route here." }) },
      { id: "conf", syntax: "configure terminal", summary: "", hidden: true, run: () => ro },
      { id: "conf2", syntax: "configure", summary: "", hidden: true, run: () => ro },
    ],
  };
}
function hostSet(api: FwCliApi, h: FwHost): CliCommandSet {
  const name = h.toLowerCase();
  const zone = h === "CLIENT" || h === "LAB" ? "trust" : h === "DMZ" ? "dmz" : undefined;
  const gw = h === "DMZ" ? api.view.cfg.dmzGw : zone ? FW_IF[zone].ip : ISP_IP.lan;
  const targets = [HOST_IP.WEB, PUBLIC, HOST_IP.DMZ, HOST_IP.CLIENT, HOST_IP.OUT].filter((x) => x !== HOST_IP[h]);
  const tA = ipArg(targets);
  const go = (to: string, port: number): FwResult => api.act({ type: "traffic", sends: [{ from: h, to, kind: "connect", port }] }).last!.results[0];
  const expl = (r: FwResult) => (r.ok ? `Handshake complete: ${r.path.join(" → ")}${r.session ? ` · FW1 session ${r.session}` : ""}.` : r.fail);
  const curl = (scheme: "http" | "https", ip: string): CliResult => {
    const port = scheme === "https" ? 443 : 80;
    const r = go(ip, port);
    if (r.outcome === "established") return { output: [`HTTP/1.1 200 OK`, `server: ${ip === PUBLIC || ip === HOST_IP.DMZ ? "dmz-web" : "web"}`, "content-type: text/html", "", "<html><body>It works.</body></html>"].join("\n"), explanation: expl(r) };
    if (r.outcome === "refused") return { output: `curl: (7) Failed to connect to ${ip} port ${port} after 2 ms: Connection refused`, explanation: expl(r) };
    return { output: `curl: (28) Failed to connect to ${ip} port ${port} after 3002 ms: Timeout was reached`, explanation: expl(r) };
  };
  const urlArg: CliArgSpec = { choices: targets.flatMap((t) => [`https://${t}`, `http://${t}`]), resolve: (raw) => { const m = /^(https?):\/\/(\d+\.\d+\.\d+\.\d+)\/?$/.exec(raw); return m && isIp(m[2]) ? `${m[1]}|${m[2]}` : undefined; } };
  const ping = (ip: string, n: number): CliResult => {
    const r = api.act({ type: "traffic", sends: [{ from: h, to: ip, kind: "ping" }] }).last!.results[0];
    return r.ok ? { output: [`PING ${ip} (${ip}) 56(84) bytes of data.`, ...Array.from({ length: n }, (_, i) => `64 bytes from ${ip}: icmp_seq=${i + 1} ttl=${64 - r.path.filter((d) => d === "FW1" || d === "ISP").length} time=${(1.8 + i * 0.2).toFixed(1)} ms`), "", `--- ${ip} ping statistics ---`, `${n} packets transmitted, ${n} received, 0% packet loss`].join("\n"), explanation: `Path: ${r.path.join(" → ")}.` } : { output: [`PING ${ip} (${ip}) 56(84) bytes of data.`, "", `--- ${ip} ping statistics ---`, `${n} packets transmitted, 0 received, 100% packet loss`].join("\n"), explanation: r.fail };
  };
  const cmds: CliCommand[] = [
    { id: "addr", syntax: "ip addr", summary: "This host's address", run: () => ({ output: `2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 state UP\n    inet ${HOST_IP[h]}/${zone ? FW_IF[zone].len : 24} scope global eth0` }) },
    { id: "route", syntax: "ip route", summary: "This host's routes", run: () => ({ output: `default via ${gw} dev eth0\n${zone ? FW_IF[zone].net : "203.0.113.0/24"} dev eth0 proto kernel scope link src ${HOST_IP[h]}` }) },
    { id: "ping", syntax: "ping <ip>", summary: "Ping (4 echo requests)", args: { ip: tA }, run: ({ ip }) => ping(ip, 4) },
    { id: "ping", syntax: "ping -c <count> <ip>", summary: "Ping <count> times", args: { count: { choices: ["1", "3"], resolve: (raw) => (/^\d+$/.test(raw) && +raw >= 1 && +raw <= 10 ? raw : undefined) }, ip: tA }, run: ({ count, ip }) => ping(ip, +count) },
    { id: "curl", syntax: "curl <url>", summary: "Open a web page (http:// or https://)", args: { url: urlArg }, run: ({ url }) => curl(url.split("|")[0] as "http" | "https", url.split("|")[1]) },
    { id: "curl", syntax: "curl -k <url>", summary: "Open a web page, ignoring the certificate", args: { url: urlArg }, run: ({ url }) => curl(url.split("|")[0] as "http" | "https", url.split("|")[1]) },
    { id: "nc", syntax: "nc -zv <ip> <port>", summary: "Test a TCP port", args: { ip: tA, port: portArg }, run: ({ ip, port }) => { const r = go(ip, +port); return { output: r.outcome === "established" ? `Connection to ${ip} ${port} port [tcp/*] succeeded!` : r.outcome === "refused" ? `nc: connect to ${ip} port ${port} (tcp) failed: Connection refused` : `nc: connect to ${ip} port ${port} (tcp) timed out: Operation now in progress`, explanation: expl(r) }; } },
    { id: "ssh", syntax: "ssh <ip>", summary: "Open SSH (TCP/22)", args: { ip: tA }, run: ({ ip }) => { const r = go(ip, 22); return { output: r.outcome === "established" ? `admin@${ip}'s password: ` : r.outcome === "refused" ? `ssh: connect to host ${ip} port 22: Connection refused` : `ssh: connect to host ${ip} port 22: Connection timed out`, explanation: expl(r) }; } },
    ...(h === "DMZ"
      ? [{ id: "gw", syntax: "sudo ip route replace default via <ip>", summary: "Set this server's default gateway", args: { ip: ipArg([FW_IF.dmz.ip]) }, run: ({ ip }: Record<string, string>) => { if (!ip.startsWith("172.16.0.")) return refuse("Error: Nexthop has invalid gateway.", "The gateway must be on this server's own subnet (172.16.0.0/24)."); api.act({ type: "cfg", cfg: { ...fwClone(api.view.cfg), dmzGw: ip }, text: `DMZ: default via ${ip}` }); return { output: "", explanation: ip === FW_IF.dmz.ip ? "Replies now go to FW1's dmz interface — the way back through the firewall's session." : `${ip} must answer ARP, or every reply is lost.` }; } }]
      : []),
    ...(h === "OUT"
      ? [{ id: "hping", syntax: "sudo hping3 <flag> -c 1 -p <port> <ip>", summary: "Send one stray TCP ACK (no handshake)", args: { flag: { choices: ["-A"], describe: () => "ACK flag only", resolve: (raw: string) => (raw === "-A" ? raw : undefined) }, port: { choices: ["40001"], resolve: (raw: string) => (/^\d+$/.test(raw) ? raw : undefined) }, ip: tA }, run: ({ port, ip }: Record<string, string>) => { const r = api.act({ type: "traffic", sends: [{ from: "OUT", to: ip, kind: "stray", port: +port }] }).last!.results[0]; return { output: [`HPING ${ip} (eth0 ${ip}): A set, 40 headers + 0 data bytes`, "", `--- ${ip} hping statistic ---`, "1 packets transmitted, 0 packets received, 100% packet loss"].join("\n"), explanation: r.fail }; } }]
      : []),
  ];
  return withShellHistory(withSelfPing({ vendor: "cisco", deviceId: h, deviceName: name, prompt: `admin@${name}:~$ `, commands: cmds }, "linux", [HOST_IP[h]]), "linux", api.history);
}
export function fwFirewallSets(api: FwCliApi): Partial<Record<CliVendor, CliCommandSet>> {
  return { cisco: iosSet(api), juniper: junosSet(api) };
}
export const fwIspSets = (): Partial<Record<CliVendor, CliCommandSet>> => ({ cisco: ispSet("cisco"), juniper: ispSet("juniper") });
export const fwHostSet = hostSet;
export const fwJunosConfig = (api: Pick<FwCliApi, "view">) => (which: "committed" | number, path: string[]) => (which === "committed" || which === 0 ? fwJunosText(api.view.cfg, path) : undefined);
