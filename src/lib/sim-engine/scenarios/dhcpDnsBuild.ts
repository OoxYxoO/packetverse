import { DNS_NAME } from "./dhcpDns";
import { DL_ADDR, DL_MAIL, DL_WEB_OLD, configured, dhcpProblem, in24, isIp, relayOn, type DlConfig, type DlNode, type DlPacket, type DlState } from "./dhcpDnsLab";

/**
 * DHCP & DNS Lab, level 7 (Build it): the network plan the learner builds towards, what each device must be
 * configured with, and the verification of a build FROM THE NETWORK'S BEHAVIOUR. Every check reads packets that were
 * really exchanged after the test started, plus device state; nothing here looks at the configuration to decide
 * whether a test passed. The configuration is only consulted afterwards, to name which setting explains the evidence.
 */

/** The plan: what the network team decided. The learner configures the devices to deliver it. */
export const PLAN = {
  clientNet: "10.10.10.0",
  range: { start: "10.10.10.50", end: "10.10.10.150" },
  router: DL_ADDR.RC,
  dhcpServer: DL_ADDR.SRV,
  dnsServer: DL_ADDR.DNS,
  names: { [DNS_NAME]: DL_WEB_OLD, "mail.packetverse.test": DL_MAIL } as Record<string, string>,
};
export const ZONE = "packetverse.test";

export interface Check {
  id: string;
  label: string;
  ok: boolean;
  /** What a pass proves (and, by omission, what it doesn't). */
  proves: string;
  /** What was actually observed. */
  seen: string;
}
export type Area = "DHCP server" | "R1 relay" | "DNS zone" | "DNS service" | "DHCP option" | "Client";
export interface Diagnosis {
  /** The last device the failing traffic provably reached. */
  where: DlNode;
  /** What the evidence shows, in plain words (no cause). */
  evidence: string;
  /** The settings on that device (and related) that could explain it: where to look in your own configuration. */
  involved: string[];
  /** Which configuration this belongs to, e.g. "a DHCP setting showing up as a DNS failure". */
  area: Area;
  /** The exact cause, revealed on request. */
  cause: string;
  /** Which build step / device to go back to. */
  fix: "dhcp" | "relay" | "dns";
}
export interface TestResult {
  checks: Check[];
  pass: boolean;
  diagnosis?: Diagnosis;
}

const after = (s: DlState, since: number) => s.capture.filter((p) => p.no > since);
const reachedAt = (ps: DlPacket[], msg: string, node: DlNode) => ps.some((p) => p.msg === msg && p.hops.some((h) => h.node === node && ["deliver", "unanswered", "reject"].includes(h.act)));
const endOf = (p: DlPacket) => p.hops[p.hops.length - 1];

// ---------------------------------------------------------------------------------------------------------------
// DHCP: a new laptop asks; does it get the plan's settings, and does its router answer?
// ---------------------------------------------------------------------------------------------------------------
const ipNum = (ip: string) => ip.split(".").reduce((n, o) => n * 256 + Number(o), 0);
/** Inside the planned range (not merely the right /24: the brief reserves .50 – .150 for laptops). */
const inRange = (ip: string) => in24(ip, PLAN.clientNet) && ipNum(ip) >= ipNum(PLAN.range.start) && ipNum(ip) <= ipNum(PLAN.range.end);

export function evalDhcp(s: DlState, since: number): TestResult {
  const ps = after(s, since);
  const c = s.client;
  const cfg = s.config;
  const discovers = ps.filter((p) => p.msg === "DISCOVER");
  const atServer = reachedAt(ps, "DISCOVER", "DHCP-SRV");
  const offered = ps.some((p) => p.msg === "OFFER");
  const bound = configured(c);
  const gwPing = ps.filter((p) => p.msg === "Echo request" && p.dst === c.gw);
  const gwOk = bound && ps.some((p) => p.msg === "Echo reply" && p.src === c.gw);
  const checks: Check[] = [
    { id: "reach", label: "The laptop's request reaches the DHCP server", ok: atServer, proves: "the relay works and carries the request across the router", seen: atServer ? "a DISCOVER arrived at DHCP-SRV" : discovers.length ? `${discovers.filter((p) => p.src === "0.0.0.0").length} DISCOVER(s) sent; none arrived at DHCP-SRV` : "no DISCOVER was sent" },
    { id: "offer", label: "The server answers with an offer", ok: offered, proves: "the DHCP service runs and has a scope for the laptop's network", seen: offered ? `OFFER of ${ps.find((p) => p.msg === "OFFER")?.layers.flatMap((l) => l.fields).find((f) => f.k === "yiaddr")?.v}` : "no OFFER" },
    { id: "bound", label: "The laptop is configured (ACK received)", ok: bound, proves: "the whole exchange completed", seen: bound ? `BOUND: ${c.ip}` : c.phase === "APIPA" ? `self-assigned ${c.ip}` : c.phase },
    { id: "addr", label: `Its address is in the planned range (${PLAN.range.start} – ${PLAN.range.end})`, ok: bound && inRange(c.ip!), proves: "the scope hands out addresses from the planned range", seen: c.ip ?? "no address" },
    { id: "gw", label: `Its router (option 3) answers: ${PLAN.router}`, ok: gwOk, proves: "the laptop can actually reach the way out of its network", seen: !bound ? "no router to test" : gwOk ? `ping ${c.gw}: reply` : `ping ${c.gw}: ${gwPing.length ? "no reply" : "the laptop couldn't even reach it (no ARP answer)"}` },
    { id: "dns", label: `Its DNS server (option 6) is the planned one: ${PLAN.dnsServer}`, ok: bound && c.dns === PLAN.dnsServer, proves: "names will be asked to the right server (the DNS test proves the server answers)", seen: c.dns ?? "none" },
  ];
  const pass = checks.every((k) => k.ok);
  if (pass) return { checks, pass };
  return { checks, pass, diagnosis: diagnoseDhcp(s, ps, cfg, checks) };
}

function diagnoseDhcp(s: DlState, ps: DlPacket[], cfg: DlConfig, checks: Check[]): Diagnosis {
  const failed = checks.find((k) => !k.ok)!.id;
  const relayInvolved = ["R1: helper address (ip helper-address)", "R1: the interface the helper is configured on"];
  const scopeInvolved = ["DHCP-SRV: service status", "DHCP-SRV: scope subnet", "DHCP-SRV: range"];
  if (failed === "reach") {
    const first = ps.filter((p) => p.msg === "DISCOVER" && p.src === "0.0.0.0").pop();
    const relayed = ps.filter((p) => p.msg === "DISCOVER" && p.src !== "0.0.0.0").pop();
    if (relayed) {
      const e = endOf(relayed);
      return { where: e.node, evidence: `R1 relayed the DISCOVER, but to ${relayed.dst}: it ended at ${e.node === "WEB" ? "the internet" : e.node} (${e.act === "reject" ? "refused: no DHCP service there" : "no answer"}).`, involved: relayInvolved, area: "R1 relay", cause: `The helper address is ${cfg.helper}, but the DHCP server is ${DL_ADDR.SRV}.${cfg.helper === DL_ADDR.DNS ? " That's the DNS server." : ""}`, fix: "relay" };
    }
    if (first && endOf(first).node === "R1") {
      const noArp = s.net.arp.R1[cfg.helper] === "incomplete";
      return {
        where: "R1",
        evidence: noArp ? `The DISCOVER reached R1 on ge-0/0/0. R1 asked “who has ${cfg.helper}?” on the servers' network and nobody answered, so nothing left ge-0/0/1.` : "The DISCOVER reached R1 on ge-0/0/0, and nothing left R1's other side (ge-0/0/1).",
        involved: relayInvolved,
        area: "R1 relay",
        cause: noArp ? `The helper address ${cfg.helper} doesn't belong to any device. The DHCP server is ${DL_ADDR.SRV}.` : !cfg.relay ? "R1 has no relay: no ip helper-address is configured, so it treats the DISCOVER like any broadcast and keeps it in the laptop's network." : `The helper is configured on ${cfg.helperIf}, the servers' side. Clients' broadcasts arrive on ge-0/0/0, so that is where the relay must listen.`,
        fix: "relay",
      };
    }
    return { where: "CLIENT", evidence: "No DISCOVER left the laptop.", involved: ["CLIENT"], area: "Client", cause: "The laptop didn't ask (run the test again).", fix: "dhcp" };
  }
  if (failed === "offer") {
    const relayed = ps.filter((p) => p.msg === "DISCOVER" && p.src !== "0.0.0.0").pop()!;
    const e = endOf(relayed);
    const log = s.net.logs["DHCP-SRV"].slice(-1)[0]?.text ?? "";
    const problem = dhcpProblem({ ...cfg, serverUp: true });
    if (e.act === "reject") return { where: "DHCP-SRV", evidence: "The DISCOVER arrived at DHCP-SRV, and the server's computer answered “port unreachable”: no DHCP program is listening.", involved: scopeInvolved, area: "DHCP server", cause: problem ? `dhcpd didn't start: ${problem}. Its log says so (and systemctl status shows “failed”).` : "The DHCP service isn't running: apply (and so start) the server's configuration.", fix: "dhcp" };
    if (/unknown network segment/.test(log)) return { where: "DHCP-SRV", evidence: `The DISCOVER arrived (via giaddr ${DL_ADDR.RC}); the server answered nothing. Its log: “${log}”.`, involved: scopeInvolved, area: "DHCP server", cause: cfg.scope ? `The scope is declared for ${cfg.scope.net}/24, but the laptops are on ${PLAN.clientNet}/24 (giaddr ${DL_ADDR.RC}).` : "No scope is declared for the laptops' network 10.10.10.0/24.", fix: "dhcp" };
    return { where: "DHCP-SRV", evidence: `The DISCOVER arrived; the server answered nothing. Its log: “${log}”.`, involved: scopeInvolved, area: "DHCP server", cause: "The range has no free address left.", fix: "dhcp" };
  }
  if (failed === "bound") return { where: "DHCP-SRV", evidence: "The offer came, but the exchange didn't complete.", involved: scopeInvolved, area: "DHCP server", cause: "Run the test again; if it repeats, check the server's log.", fix: "dhcp" };
  if (failed === "addr") return { where: "DHCP-SRV", evidence: `The laptop got ${s.client.ip}, outside the planned range.`, involved: ["DHCP-SRV: range"], area: "DHCP server", cause: `The range is ${cfg.scope?.start} – ${cfg.scope?.end}; the plan is ${PLAN.range.start} – ${PLAN.range.end}.`, fix: "dhcp" };
  if (failed === "gw") return { where: "CLIENT", evidence: `The laptop received ${s.client.gw} as its router, asked “who has ${s.client.gw}?” and nobody answered. Nothing beyond its own network will work, by name or by IP.`, involved: ["DHCP-SRV: option routers (option 3)"], area: "DHCP option", cause: `Option 3 is ${s.client.gw}; the router is ${PLAN.router}.`, fix: "dhcp" };
  return { where: "CLIENT", evidence: `The laptop was told to use ${s.client.dns ?? "no DNS server"} for names. DHCP itself worked; the DNS test will show what this breaks.`, involved: ["DHCP-SRV: option domain-name-servers (option 6)"], area: "DHCP option", cause: `Option 6 is ${s.client.dns || "empty"}; the DNS server is ${PLAN.dnsServer}.`, fix: "dhcp" };
}

// ---------------------------------------------------------------------------------------------------------------
// DNS: do the planned names resolve to the planned addresses, and is the answer reachable?
// ---------------------------------------------------------------------------------------------------------------
function lookupOutcome(s: DlState, ps: DlPacket[], name: string): { ok: boolean; seen: string; diag?: Diagnosis } {
  const want = PLAN.names[name];
  const c = s.client;
  const q = ps.filter((p) => p.msg === "DNS query" && p.layers.flatMap((l) => l.fields).some((f) => f.k === "Question" && f.v === `${name} A IN`)).pop();
  if (!configured(c)) return { ok: false, seen: "the laptop has no settings", diag: { where: "CLIENT", evidence: "The laptop has no address, so it can't ask anyone.", involved: ["the DHCP test"], area: "Client", cause: "Make the DHCP test pass first: DNS depends on the settings DHCP gives.", fix: "dhcp" } };
  if (!q) {
    const arp = ps.filter((p) => p.proto === "ARP" && p.src === c.ip && p.lost).pop();
    const who = arp?.layers.flatMap((l) => l.fields).find((f) => f.k === "target IP")?.v;
    return { ok: false, seen: "no query was sent", diag: { where: "CLIENT", evidence: who ? `The question never left the laptop: it asked “who has ${who}?” and nobody answered.` : "The question never left the laptop.", involved: ["DHCP-SRV: option routers (option 3)", "DHCP-SRV: option domain-name-servers (option 6)"], area: "DHCP option", cause: who === c.gw ? `The laptop's router (option 3) is ${c.gw}, which nobody owns. This is a DHCP setting, not a DNS one.` : `The laptop's DNS server (option 6) is ${c.dns}, an address on its own network that nobody owns. This is a DHCP setting.`, fix: "dhcp" } };
  }
  const journey = ps.filter((p) => p.journey.startsWith(q.journey));
  const resp = journey.find((p) => p.msg === "DNS response");
  const icmp = journey.find((p) => p.msg === "Port unreachable");
  const e = endOf(q);
  if (resp) {
    const ans = resp.layers.flatMap((l) => l.fields).find((f) => f.k === "Answer")?.v.split(" A ")[1];
    if (!ans) return { ok: false, seen: "NXDOMAIN (no such name)", diag: { where: "DNS-SRV", evidence: `The question reached DNS-SRV, which answered: “no such name”. The DNS service works; it just has no record called ${name}.`, involved: [`DNS-SRV: the zone's records (${ZONE})`], area: "DNS zone", cause: `The zone has no record for “${name.replace(`.${ZONE}`, "")}”. Records: ${Object.keys(s.records).map((n) => n.replace(`.${ZONE}`, "")).join(", ") || "(none)"}.`, fix: "dns" } };
    if (ans !== want) return { ok: false, seen: `answered ${ans}`, diag: { where: "DNS-SRV", evidence: `DNS-SRV answered ${name} → ${ans}. The plan says ${want}.`, involved: [`DNS-SRV: the record for ${name.replace(`.${ZONE}`, "")}`], area: "DNS zone", cause: `The record points at ${ans}; it should be ${want}.`, fix: "dns" } };
    return { ok: true, seen: `→ ${ans}` };
  }
  if (icmp) {
    const fromDns = icmp.src === DL_ADDR.DNS;
    return { ok: false, seen: `refused by ${icmp.src}`, diag: { where: fromDns ? "DNS-SRV" : icmp.src === DL_ADDR.RC ? "R1" : "DHCP-SRV", evidence: `The question reached ${icmp.src}, which answered “nobody is listening here” (port unreachable).`, involved: fromDns ? ["DNS-SRV: service status"] : ["DHCP-SRV: option domain-name-servers (option 6)"], area: fromDns ? "DNS service" : "DHCP option", cause: fromDns ? "The DNS service on DNS-SRV isn't running." : `The laptop was told (option 6) to use ${c.dns}, which is not a DNS server. This is a DHCP setting showing up as a DNS failure.`, fix: fromDns ? "dns" : "dhcp" } };
  }
  return { ok: false, seen: "no answer", diag: { where: e.node === "WEB" ? "R1" : e.node, evidence: e.node === "R1" ? `The question reached R1, which couldn't find any device at ${c.dns} (its ARP question went unanswered).` : `The question went to ${c.dns} and nothing answered.`, involved: ["DHCP-SRV: option domain-name-servers (option 6)"], area: "DHCP option", cause: `The laptop was told (option 6) to use ${c.dns}, where no DNS server exists. This is a DHCP setting showing up as a DNS failure.`, fix: "dhcp" } };
}

export function evalDns(s: DlState, since: number): TestResult {
  const ps = after(s, since);
  const names = Object.keys(PLAN.names);
  const out = names.map((n) => ({ n, r: lookupOutcome(s, ps, n) }));
  const checks: Check[] = out.map(({ n, r }) => ({ id: `name:${n}`, label: `${n} resolves to ${PLAN.names[n]}`, ok: r.ok, proves: "the laptop asks the right server, the service answers, and the record is right", seen: r.seen }));
  const web = PLAN.names[DNS_NAME];
  const pingOk = ps.some((p) => p.msg === "Echo reply" && p.src === web);
  const pinged = ps.filter((p) => p.msg === "Echo request").pop();
  checks.push({ id: "reach", label: `ping ${DNS_NAME} gets a reply`, ok: pingOk, proves: "the answer is not just a number: that address really is the web server, and the laptop can reach it", seen: pingOk ? `reply from ${web}` : pinged ? `no reply from ${pinged.dst}` : "nothing to ping (the name didn't resolve)" });
  const pass = checks.every((k) => k.ok);
  const firstBad = out.find((x) => !x.r.ok)?.r.diag;
  return { checks, pass, diagnosis: pass ? undefined : (firstBad ?? { where: "CLIENT", evidence: `The name resolved, but ${pinged?.dst} didn't answer the ping.`, involved: [`DNS-SRV: the record for www`], area: "DNS zone", cause: "The record points at an address where the web server isn't.", fix: "dns" }) };
}

/** Is each device's part configured at all (for the build map)? Read from configuration: this is a checklist, not a test. */
export function buildStatus(cfg: DlConfig, records: Record<string, string>): { dhcp: "none" | "error" | "configured"; relay: "none" | "configured"; dns: "none" | "configured" } {
  return {
    dhcp: !cfg.serverUp ? "none" : dhcpProblem(cfg) ? "error" : "configured",
    relay: relayOn(cfg) || (cfg.relay && isIp(cfg.helper)) ? "configured" : "none",
    dns: Object.keys(records).length ? "configured" : "none",
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Configuration as it really looks on each device (used by the build forms AND the CLI: one source)
// ---------------------------------------------------------------------------------------------------------------
export function dhcpdConf(cfg: DlConfig): string {
  const sc = cfg.scope;
  return [
    "# the server's own network: it must be declared, but no addresses are handed out here",
    "subnet 10.20.20.0 netmask 255.255.255.0 { }",
    "",
    ...(sc
      ? [`subnet ${sc.net} netmask 255.255.255.0 {`, `  range ${sc.start} ${sc.end};`, ...(cfg.option3 ? [`  option routers ${cfg.option3};`] : []), ...(cfg.option6 ? [`  option domain-name-servers ${cfg.option6};`] : []), "  default-lease-time 86400;", "}"]
      : ["# no subnet declared for the clients' network yet"]),
  ].join("\n");
}
export function r1RelayConfig(cfg: DlConfig, vendor: "cisco" | "juniper"): string {
  if (!cfg.relay || !cfg.helper) return vendor === "cisco" ? "! no ip helper-address configured on any interface" : "# forwarding-options dhcp-relay: (not configured)";
  const ifc = cfg.helperIf === "ge-0/0/0" ? "GigabitEthernet0/0" : "GigabitEthernet0/1";
  return vendor === "cisco"
    ? [`interface ${ifc}`, ` ip helper-address ${cfg.helper}`].join("\n")
    : ["forwarding-options {", "    dhcp-relay {", "        server-group {", `            DHCP-SERVERS { ${cfg.helper}; }`, "        }", "        group CLIENTS {", "            active-server-group DHCP-SERVERS;", `            interface ${cfg.helperIf}.0;`, "        }", "    }", "}"].join("\n");
}
export function zoneFile(records: Record<string, string>): string {
  const rows = Object.entries(records).map(([n, ip]) => `${n.replace(`.${ZONE}`, "").padEnd(8)}IN  A   ${ip}`);
  return [`$ORIGIN ${ZONE}.`, "$TTL 300", "@       IN  SOA ns.packetverse.test. admin.packetverse.test. ( 1 3600 600 86400 300 )", "@       IN  NS  ns", "ns      IN  A   10.20.20.53", ...(rows.length ? rows : ["; (no host records yet)"])].join("\n");
}

// ---------------------------------------------------------------------------------------------------------------
// The build as real configuration text (Build it yourself): files on the servers, helper addresses on R1
// ---------------------------------------------------------------------------------------------------------------
export const DHCPD_START = [
  "# /etc/dhcp/dhcpd.conf",
  "#",
  "# The server's own network must be declared, even though no",
  "# addresses are handed out on it.",
  "subnet 10.20.20.0 netmask 255.255.255.0 {",
  "}",
  "",
].join("\n");
export const ZONE_START = [
  `$ORIGIN ${ZONE}.`,
  "$TTL 300",
  "@       IN  SOA ns.packetverse.test. admin.packetverse.test. ( 1 3600 600 86400 300 )",
  "@       IN  NS  ns",
  "ns      IN  A   10.20.20.53",
  "",
].join("\n");

export interface DhcpdParse {
  /** The config patch the restarted service runs with (dhcpError set when it refuses to start). */
  config: Partial<DlConfig>;
  error?: string;
  /** All subnets declared, for messages. */
  subnets: string[];
}
const strip = (t: string) => t.replace(/#[^\n]*/g, "");
/**
 * A small dhcpd.conf reader: subnet blocks with range / option routers / option domain-name-servers, global options
 * inherited by subnets, other common statements ignored. Syntax errors make dhcpd refuse to start, as the real one does.
 */
export function parseDhcpd(text: string): DhcpdParse {
  const src = strip(text);
  const fail = (error: string, subnets: string[] = []): DhcpdParse => ({ config: { serverUp: true, dhcpError: error }, error, subnets });
  if ((src.match(/\{/g) ?? []).length !== (src.match(/\}/g) ?? []).length) return fail("unbalanced braces { }");
  let globalsSrc = src;
  const blocks: { net: string; mask: string; body: string }[] = [];
  const re = /subnet\s+(\S+)\s+netmask\s+(\S+)\s*\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    blocks.push({ net: m[1], mask: m[2], body: m[3] });
    globalsSrc = globalsSrc.replace(m[0], "");
  }
  if (/subnet\s/.test(globalsSrc)) return fail("a subnet declaration is malformed (expected: subnet A.B.C.D netmask A.B.C.D { ... })");
  const statements = (body: string) => body.split(";").map((x) => x.trim()).filter(Boolean);
  type Opts = { routers?: string; dns?: string; range?: [string, string]; error?: string };
  const opts = (body: string): Opts => {
    const o: Opts = {};
    // Like dhcpd: every statement ends with a semicolon, the last one before "}" included.
    const tail = body.split(";").pop()!.trim();
    if (tail) return { error: `semicolon expected after “${tail.split("\n").pop()!.trim()}”` };
    for (const st of statements(body)) {
      let k: RegExpMatchArray | null;
      const run = st.match(/\n\s*(option|range|default-lease-time|max-lease-time|authoritative)\b/);
      if (run) return { error: `semicolon expected before “${run[1]}” (after “${st.split("\n")[0].trim()}”)` };
      if ((k = st.match(/^option\s+routers\s+(\S+)$/))) o.routers = k[1];
      else if ((k = st.match(/^option\s+domain-name-servers\s+([^,\s]+)(\s*,\s*\S+)*$/))) o.dns = k[1];
      else if ((k = st.match(/^range\s+(\S+)\s+(\S+)$/))) o.range = [k[1], k[2]];
      else if (/^(option\s+\S+|default-lease-time|max-lease-time|authoritative|ddns-update-style|log-facility|ping-check)\b/.test(st)) continue;
      else return { error: `unknown statement “${st}”` };
    }
    return o;
  };
  const g = opts(globalsSrc);
  if (g.error) return fail(g.error);
  const subnets = blocks.map((b) => `${b.net}/${b.mask}`);
  for (const b of blocks) {
    if (!isIp(b.net) || b.mask !== "255.255.255.0") return fail(b.mask !== "255.255.255.0" && isIp(b.mask) ? `subnet ${b.net} netmask ${b.mask}: this lab's networks are all /24 (255.255.255.0)` : `subnet ${b.net} netmask ${b.mask}: not a valid network and mask`, subnets);
    if (b.net.split(".")[3] !== "0") return fail(`subnet ${b.net}: with netmask 255.255.255.0 a network address ends in .0`, subnets);
  }
  if (!blocks.some((b) => b.net === "10.20.20.0")) return fail("No subnet declaration for eth0 (10.20.20.10). Not configured to listen on any interfaces!", subnets);
  // The scope that matters is the one for the clients' network (the relay's giaddr).
  const clientBlocks = blocks.filter((b) => b.net !== "10.20.20.0");
  const chosen = clientBlocks.find((b) => b.net === PLAN.clientNet) ?? clientBlocks[0];
  if (!chosen) return { config: { serverUp: true, dhcpError: undefined, scope: null, option3: g.routers ?? "", option6: g.dns ?? "" }, subnets };
  // Every block is read (as dhcpd does), not only the one that will be used.
  for (const blk of blocks) {
    const e = opts(blk.body).error;
    if (e) return fail(`in subnet ${blk.net}: ${e}`, subnets);
  }
  const o = opts(chosen.body);
  if (o.error) return fail(`in subnet ${chosen.net}: ${o.error}`, subnets);
  if (!o.range) return { config: { serverUp: true, dhcpError: undefined, scope: null, option3: o.routers ?? g.routers ?? "", option6: o.dns ?? g.dns ?? "" }, subnets };
  const config: Partial<DlConfig> = { serverUp: true, dhcpError: undefined, scope: { net: chosen.net, start: o.range[0], end: o.range[1] }, option3: o.routers ?? g.routers ?? "", option6: o.dns ?? g.dns ?? "" };
  const problem = dhcpProblem({ ...(config as DlConfig), relay: false, helper: "", helperIf: "ge-0/0/0", dnsUp: true, poolFree: 0 });
  return problem ? fail(problem, subnets) : { config, subnets };
}

export interface ZoneParse {
  records: Record<string, string>;
  error?: string;
}
/** A small zone-file reader: $ORIGIN/$TTL, SOA (one or more lines), NS, A and CNAME records (CNAMEs are flattened). */
export function parseZone(text: string): ZoneParse {
  const lines = text
    .replace(/;[^\n]*/g, "")
    .replace(/\([^)]*\)/g, (x) => x.replace(/\n/g, " "))
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const a: Record<string, string> = {};
  const cname: Record<string, string> = {};
  let soa = false;
  const fq = (n: string) => (n === "@" ? ZONE : n.endsWith(".") ? n.slice(0, -1).toLowerCase() : `${n.toLowerCase()}.${ZONE}`);
  for (const l of lines) {
    if (/^\$(ORIGIN|TTL)\b/.test(l)) continue;
    const t = l.split(/\s+/);
    const name = t[0];
    let i = 1;
    if (/^\d+$/.test(t[i] ?? "")) i++;
    if ((t[i] ?? "").toUpperCase() === "IN") i++;
    const type = (t[i] ?? "").toUpperCase();
    const data = t[i + 1];
    if (type === "SOA") soa = true;
    else if (type === "NS") continue;
    else if (type === "A") {
      if (!data || !isIp(data)) return { records: {}, error: `${name}: bad IPv4 address “${data ?? ""}”` };
      if (!/^(@|[a-z0-9-]+(\.[a-z0-9-]+)*\.?)$/i.test(name)) return { records: {}, error: `${name}: bad owner name` };
      a[fq(name)] = data;
    } else if (type === "CNAME") {
      if (!data) return { records: {}, error: `${name}: CNAME without a target` };
      cname[fq(name)] = fq(data);
    } else return { records: {}, error: `“${l}”: unknown record type (this lab understands SOA, NS, A and CNAME)` };
  }
  if (!soa) return { records: {}, error: "zone has no SOA record: not loaded" };
  for (const [alias, target] of Object.entries(cname)) {
    if (a[alias]) return { records: {}, error: `${alias}: CNAME and other data` };
    if (a[target]) a[alias] = a[target];
  }
  return { records: Object.fromEntries(Object.entries(a).filter(([n]) => n !== `ns.${ZONE}` && n !== ZONE)) };
}

/** R1's helper addresses per interface → what the model's relay does. A helper on the clients' side is what counts. */
export type R1Helpers = Partial<Record<"ge-0/0/0" | "ge-0/0/1" | "ge-0/0/2", string[]>>;
export function relayFromHelpers(h: R1Helpers): Pick<DlConfig, "relay" | "helper" | "helperIf"> {
  const pick = (l: string[]) => (l.includes(DL_ADDR.SRV) ? DL_ADDR.SRV : l[0]);
  if (h["ge-0/0/0"]?.length) return { relay: true, helper: pick(h["ge-0/0/0"]), helperIf: "ge-0/0/0" };
  if (h["ge-0/0/1"]?.length) return { relay: true, helper: pick(h["ge-0/0/1"]), helperIf: "ge-0/0/1" };
  return { relay: false, helper: "", helperIf: "ge-0/0/0" };
}
/** The names the student gave the Junos relay groups when they committed them (per interface). */
export type R1JunosNames = Partial<Record<"ge-0/0/0" | "ge-0/0/1" | "ge-0/0/2", { group: string; sg: string }>>;
export function r1RunningConfig(h: R1Helpers, vendor: "cisco" | "juniper", names: R1JunosNames = {}): string {
  const ifs = [
    ["ge-0/0/0", "GigabitEthernet0/0", "10.10.10.1 255.255.255.0", "10.10.10.1/24"],
    ["ge-0/0/1", "GigabitEthernet0/1", "10.20.20.1 255.255.255.0", "10.20.20.1/24"],
    ["ge-0/0/2", "GigabitEthernet0/2", "198.51.100.2 255.255.255.252", "198.51.100.2/30"],
  ] as const;
  const get = (id: string) => (h as Record<string, string[] | undefined>)[id] ?? [];
  if (vendor === "cisco") return ["hostname R1", "!", ...ifs.flatMap(([id, n, a]) => [`interface ${n}`, ` ip address ${a}`, ...get(id).map((x) => ` ip helper-address ${x}`), " no shutdown", "!"]), "ip route 0.0.0.0 0.0.0.0 198.51.100.1", "end"].join("\n");
  const groups = ifs.filter(([id]) => get(id).length);
  return [
    "interfaces {",
    ...ifs.map(([id, , , pfx]) => `    ${id} { unit 0 { family inet address ${pfx}; } }`),
    "}",
    ...(groups.length ? ["forwarding-options {", "    dhcp-relay {", ...groups.flatMap(([id], i) => {
          const n = names[id] ?? { group: `G${i + 1}`, sg: `SERVERS${i + 1}` };
          return [`        server-group ${n.sg} { ${get(id).join("; ")}; }`, `        group ${n.group} { active-server-group ${n.sg}; interface ${id}.0; }`];
        }), "    }", "}"] : []),
  ].join("\n");
}

// ---------------------------------------------------------------------------------------------------------------
// Hints: what the build most needs next, read from the build's own state (never from a fixed sequence)
// ---------------------------------------------------------------------------------------------------------------
export interface Hint {
  id: string;
  /** Level 1: which device to look at. */
  device: DlNode;
  where: string;
  /** Level 2: what kind of configuration is missing or wrong. */
  what: string;
  /** Level 3: close to the exact solution. */
  how: string;
}
export function nextHint(cfg: DlConfig, records: Record<string, string>, h: R1Helpers): Hint | undefined {
  const scopeLines = `subnet ${PLAN.clientNet} netmask 255.255.255.0 {\n  range ${PLAN.range.start} ${PLAN.range.end};\n  option routers ${PLAN.router};\n  option domain-name-servers ${PLAN.dnsServer};\n}`;
  if (!cfg.serverUp) return { id: "dhcp-off", device: "DHCP-SRV", where: "Something has to hand out addresses. Which device's job is that, and is its service even running?", what: "DHCP-SRV's service has never been started, and its configuration file only declares the server's own network. It needs a scope for the laptops' network, then a restart.", how: `On DHCP-SRV's terminal, edit the file (sudo nano /etc/dhcp/dhcpd.conf), add this, save (^O), exit (^X), check it (sudo dhcpd -t), then restart the service (sudo systemctl restart isc-dhcp-server):\n\n${scopeLines}` };
  if (dhcpProblem(cfg)) return { id: "dhcp-err", device: "DHCP-SRV", where: "A service you started isn't actually running. Check its status.", what: `dhcpd refused to start: ${dhcpProblem(cfg)}. Fix the file and restart; the status and the log (journalctl) say why it failed.`, how: `A working scope for the laptops looks like this:\n\n${scopeLines}` };
  if (!cfg.scope || cfg.scope.net !== PLAN.clientNet) return { id: "dhcp-scope", device: "DHCP-SRV", where: "The DHCP server runs. Does it know about the laptops' network?", what: `The server has no scope for ${PLAN.clientNet}/24. When the relay forwards a request with giaddr ${PLAN.router}, the server looks for a subnet containing that address, finds none, and ignores it.`, how: `In /etc/dhcp/dhcpd.conf:\n\n${scopeLines}` };
  if (cfg.scope.start !== PLAN.range.start || cfg.scope.end !== PLAN.range.end)
    return { id: "dhcp-range", device: "DHCP-SRV", where: "The server has a scope for the laptops' network. Compare it with the brief.", what: `The scope hands out ${cfg.scope.start} – ${cfg.scope.end}; the brief reserves ${PLAN.range.start} – ${PLAN.range.end} for laptops.`, how: `In the subnet ${PLAN.clientNet} block: range ${PLAN.range.start} ${PLAN.range.end};  then restart the service.` };
  const relay = relayFromHelpers(h);
  if (!relay.relay || relay.helperIf !== "ge-0/0/0") return { id: "relay", device: "R1", where: "The server is ready, but a laptop's request is a broadcast. Which device stands between them, and does it pass broadcasts on?", what: relay.relay ? "R1 has a helper address, but on ge-0/0/1 (the servers' side). The relay acts on broadcasts arriving where it is configured: the laptops' side." : "R1 has no DHCP relay. Routers don't forward broadcasts, so the laptop's DISCOVER never leaves its network.", how: `On R1 (Cisco):\n  configure terminal\n  interface GigabitEthernet0/0\n  ip helper-address ${PLAN.dhcpServer}\n  end\n\nor (Junos):\n  configure\n  set forwarding-options dhcp-relay server-group DHCP ${PLAN.dhcpServer}\n  set forwarding-options dhcp-relay group LAN active-server-group DHCP\n  set forwarding-options dhcp-relay group LAN interface ge-0/0/0.0\n  commit` };
  if (relay.helper !== DL_ADDR.SRV) return { id: "helper", device: "R1", where: "Requests now cross R1. Where does R1 send them?", what: `R1's helper address is ${relay.helper}. It must be the DHCP server's own address.`, how: `On R1: interface GigabitEthernet0/0, then no ip helper-address ${relay.helper}, then ip helper-address ${PLAN.dhcpServer}` };
  if (cfg.option3 !== PLAN.router) return { id: "opt3", device: "DHCP-SRV", where: "Laptops get an address. Do they get a way out of their network?", what: cfg.option3 ? `The scope gives out ${cfg.option3} as the router (option 3); the laptops' router is R1 at ${PLAN.router}.` : "The scope gives out no router (option 3): laptops can't reach anything beyond their own network.", how: `Inside the subnet ${PLAN.clientNet} block: option routers ${PLAN.router};  then restart the service.` };
  if (cfg.option6 !== PLAN.dnsServer) return { id: "opt6", device: "DHCP-SRV", where: "Laptops get an address and a router. How do they learn who answers names?", what: cfg.option6 ? `The scope tells laptops to use ${cfg.option6} for DNS (option 6); the DNS server is ${PLAN.dnsServer}.` : "The scope gives out no DNS server (option 6): laptops don't know whom to ask for names.", how: `Inside the subnet block: option domain-name-servers ${PLAN.dnsServer};  then restart the service.` };
  for (const [n, ip] of Object.entries(PLAN.names)) {
    const host = n.replace(`.${ZONE}`, "");
    if (records[n] !== ip) return { id: `rec-${host}`, device: "DNS-SRV", where: "Laptops know their DNS server. Does that server know the names?", what: records[n] ? `The zone answers ${n} with ${records[n]}; the plan says ${ip}.` : `The zone has no record for ${n}: the server will answer “no such name”.`, how: `On DNS-SRV's terminal (sudo nano /etc/bind/db.${ZONE}), add:\n  ${host.padEnd(8)}IN  A   ${ip}\nthen reload the zone (sudo rndc reload).` };
  }
  return undefined;
}
