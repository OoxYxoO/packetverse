import type { ReactNode } from "react";
import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DiagramFrame, DiagramSvg, DNode, DPill, FailureSignatures, FieldTable, FlowSteps, GuideSection, Misconceptions, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { DFieldRow } from "@/components/lesson/FundamentalsGuideSvg";
import { ExplainIt, KnowledgeQuiz, PracticeBridge, type KnowledgeQuestion } from "@/components/lesson/GuideInteractive";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import { CliPanel, FailureWalk, pickLines, runGuideCli, type GuideCliRun } from "@/components/lesson/GuideCli";
import type { CliVendor } from "@/lib/cli/types";
import { DH_ADDR, DNS_NAME, DNS_RECORD_TTL, LEASE_SECONDS } from "@/lib/sim-engine/scenarios/dhcpDns";
import { createDlState, DL_LAB_MODEL, DL_T1, DL_T2, DL_WEB_NEW, DL_WRONG, type DlAction, type DlNode, type DlPacket, type DlState, type DlTicketId } from "@/lib/sim-engine/scenarios/dhcpDnsLab";
import { dlCliSets } from "./dhcp-lab/dhcpCli";
import { clientPromptSet } from "./dhcp-lab/dhcpBuildCli";

/**
 * DHCP & DNS DEEP DIVE — the complete course, taught on the lesson's network (CLIENT, R1 relay, DHCP-SRV, DNS-SRV). Every
 * CLI sample is printed by the DHCP & DNS Lab's own terminals (the laptop's prompt, R1 in Cisco IOS or Junos, the Linux
 * servers) run against the lab's model.
 * Progression: Foundation → DHCP → Relay and scopes → DNS → Operations → Troubleshooting → Beyond → Master it.
 */
const G = { foundation: "Foundation", dhcp: "DHCP", relay: "Relay, scopes and leases", dns: "DNS", names: "Names and reachability", ops: "Operations", trouble: "Troubleshooting", beyond: "Beyond this lesson", master: "Master it" };

export const DH_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "dhd-why", label: "Why automatic configuration", group: G.foundation },
  { id: "dhd-chain", label: "Two protocols, three trips", group: G.foundation },
  { id: "dhd-dhcpmsg", label: "The DHCP message", group: G.dhcp },
  { id: "dhd-journey", label: "One exchange, packet by packet", group: G.dhcp },
  { id: "dhd-fields", label: "Watch the fields change", group: G.dhcp },
  { id: "dhd-dora", label: "The four messages in detail", group: G.dhcp },
  { id: "dhd-states", label: "Client states", group: G.dhcp },
  { id: "dhd-offers", label: "Multiple offers and NAK", group: G.dhcp },
  { id: "dhd-relay", label: "Relays and giaddr", group: G.relay },
  { id: "dhd-scopeselect", label: "Which scope applies", group: G.relay },
  { id: "dhd-scope", label: "Scopes and options", group: G.relay },
  { id: "dhd-timers", label: "T1, T2, renew, rebind", group: G.relay },
  { id: "dhd-renewal", label: "Renewal and rebinding on the wire", group: G.relay },
  { id: "dhd-exhaust", label: "Exhaustion and conflicts", group: G.relay },
  { id: "dhd-apipa", label: "Release, failure and 169.254", group: G.relay },
  { id: "dhd-dnswhy", label: "Why DNS exists", group: G.dns },
  { id: "dhd-zone", label: "Zones and records", group: G.dns },
  { id: "dhd-recursion", label: "Recursive vs authoritative", group: G.dns },
  { id: "dhd-dnsjourney", label: "A lookup on the wire", group: G.dns },
  { id: "dhd-message", label: "The DNS message", group: G.dns },
  { id: "dhd-negative", label: "NXDOMAIN, refused, timeout", group: G.dns },
  { id: "dhd-tcp", label: "UDP, TCP and caching", group: G.dns },
  { id: "dhd-client", label: "The client's resolver", group: G.dns },
  { id: "dhd-layers", label: "Resolution is not reachability", group: G.names },
  { id: "dhd-verify", label: "Verifying each stage", group: G.ops },
  { id: "dhd-signatures", label: "Failure signatures", group: G.trouble },
  { id: "dhd-workflow", label: "Troubleshooting workflow", group: G.trouble },
  { id: "dhd-separate", label: "DHCP, routing, DNS or transport?", group: G.trouble },
  { id: "dhd-faults", label: "The six tickets, step by step", group: G.trouble },
  { id: "dhd-prove", label: "Proving a repair", group: G.trouble },
  { id: "dhd-beyond", label: "DHCPv6, snooping, DNSSEC…", group: G.beyond },
  { id: "dhd-myths", label: "Common misconceptions", group: G.master },
  { id: "dhd-quiz", label: "Knowledge check", group: G.master },
  { id: "dhd-explain", label: "Can you explain it?", group: G.master },
  { id: "dhd-practice", label: "Practice in the DHCP & DNS Lab", group: G.master },
];
const DHCP = "#f59e0b";
const DNS = "#a78bfa";

// ------------------------------------------------------------------ the lab's model and terminals

function cli(s: DlState, dev: DlNode | "PC", vendor: CliVendor, command: string): GuideCliRun {
  return runGuideCli(dev === "PC" ? clientPromptSet(s, () => undefined) : dlCliSets(s, dev)[vendor], command);
}
const only = (r: GuideCliRun, match: RegExp): GuideCliRun => ({ ...r, output: pickLines(r.output, match) });
const run = (s: DlState, ...as: DlAction[]) => as.reduce((x, a) => DL_LAB_MODEL.start(x, a), s);
const HEALTHY = run(createDlState(), { type: "dhcp-all" }, { type: "resolve", name: DNS_NAME });
const ticket = (id: DlTicketId, ...after: DlAction[]) => run(createDlState(), { type: "ticket", id }, ...after);
const T_RELAY = ticket("no-relay", { type: "dhcp-all" });
const T_OPT6 = ticket("dns-option");
const T_POOL = ticket("pool", { type: "dhcp-all" });
const T_STALE = ticket("stale-cache");
const T_GW = ticket("gateway");
const T_DNS = ticket("dns-service");
const DNS_IP = DH_ADDR["DNS-SRV"];
// Packet-level evidence: the lab's own capture for each scenario.
const DORA = run(createDlState(), { type: "dhcp-all" });
const RENEW = run(DORA, { type: "time", to: DL_T1 + 60 });
const RENEW_DOWN = run(DORA, { type: "config", patch: { serverUp: false } }, { type: "time", to: DL_T1 + 60 });
const REBIND_DOWN = run(RENEW_DOWN, { type: "time", to: DL_T2 + 60 });
const EXPIRED = run(REBIND_DOWN, { type: "time", to: LEASE_SECONDS + 60 });
const DNS_OK = run(DORA, { type: "resolve", name: DNS_NAME });
const DNS_CACHED = run(DNS_OK, { type: "resolve", name: DNS_NAME });
const NX = run(DORA, { type: "resolve", name: "nosuch.packetverse.test" });
const WEB_OK = run(DORA, { type: "ping-name", name: DNS_NAME });
const T_OPT6_R = run(T_OPT6, { type: "resolve", name: DNS_NAME });
const T_DNS_R = run(T_DNS, { type: "resolve", name: DNS_NAME });
const T_STALE_R = run(T_STALE, { type: "ping-name", name: DNS_NAME });
const packetsOf = (st: DlState): DlPacket[] => st.lastPackets.map((no) => st.capture.find((p) => p.no === no)).filter((p): p is DlPacket => !!p);
const JOURNEY_COLS = ["#", "Message", "Path", "At the last device"];
/** One row per captured packet: what it was, where it went, and what the last device did with it. */
const journeyRows = (st: DlState) =>
  packetsOf(st).map((p) => [
    String(p.no),
    <span key="m" className="whitespace-nowrap">
      <Mono>{p.msg}</Mono>
      <br />
      <span className="text-[11px]">
        {p.src} → {p.dst}
      </span>
    </span>,
    <span key="p" className="whitespace-nowrap">{p.path.join(" → ")}</span>,
    p.lost ? <span key="l" className="text-pv-danger">✕ {p.lost}</span> : p.hops[p.hops.length - 1]?.text ?? "",
  ]);
/** A field from one layer of a captured packet (layer name prefix, field key prefix). */
const fieldOf = (p: DlPacket | undefined, layer: string, key: string) => p?.layers.find((l) => l.name.startsWith(layer))?.fields.find((f) => f.k.startsWith(key))?.v;
function fieldRows() {
  const at = (no: number) => DORA.capture.find((p) => p.no === no);
  const renewal = packetsOf(RENEW).find((p) => p.msg === "REQUEST");
  const cols = [at(1), at(2), at(3), at(5), at(7), renewal];
  const row = (label: string, key: string) => [label, ...cols.map((p) => fieldOf(p, "DHCP", key) ?? "—")];
  return [
    ["IPv4 src → dst", ...cols.map((p) => (p ? `${p.src} → ${p.dst}` : "—"))],
    row("ciaddr", "ciaddr"),
    row("yiaddr", "yiaddr"),
    row("giaddr", "giaddr"),
    row("hops", "hops"),
    row("flags", "flags"),
    row("opt 50 (requested IP)", "opt 50"),
    row("opt 54 (server)", "opt 54"),
    row("opt 3 (router)", "opt 3"),
    row("opt 6 (DNS)", "opt 6"),
  ];
}
function dnsFieldRows() {
  const [q, r] = [packetsOf(DNS_OK).find((p) => p.msg === "DNS query"), packetsOf(DNS_OK).find((p) => p.msg === "DNS response")];
  const both = (label: string, layer: string, key: string) => [label, fieldOf(q, layer, key) ?? "—", fieldOf(r, layer, key) ?? "—"];
  return [
    ["IPv4 src → dst", q ? `${q.src} → ${q.dst}` : "—", r ? `${r.src} → ${r.dst}` : "—"],
    both("UDP ports", "UDP", "Source port").map((v, i) => (i === 0 ? v : `${v} → ${fieldOf(i === 1 ? q : r, "UDP", "Destination port") ?? "—"}`)),
    both("Transaction ID", "DNS", "Transaction ID"),
    both("Flags", "DNS", "Flags"),
    both("Question", "DNS", "Question"),
    both("Answer", "DNS", "Answer"),
    both("TTL", "DNS", "TTL"),
  ];
}

const Strong = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;
function LabBridge({ label, children }: { label: string; children: ReactNode }) {
  const openLab = usePracticeLabOpener();
  return (
    <PracticeBridge label={label} onPractice={openLab}>
      {children}
    </PracticeBridge>
  );
}

// ------------------------------------------------------------------ diagrams
function StatesDiagram() {
  const box = (x: number, y: number, t: string, c: string) => <DNode x={x} y={y} label={t} accent={c} w={120} h={34} />;
  return (
    <DiagramSvg h={210} label="DHCP client states: INIT sends DISCOVER to SELECTING; REQUEST to REQUESTING; ACK to BOUND; at T1 to RENEWING; at T2 to REBINDING; ACK returns to BOUND; lease expiry or NAK returns to INIT">
      {box(70, 40, "INIT", D.faint)}
      {box(230, 40, "SELECTING", DHCP)}
      {box(390, 40, "REQUESTING", DHCP)}
      {box(550, 40, "BOUND", D.success)}
      {box(550, 150, "RENEWING", D.cyan)}
      {box(330, 150, "REBINDING", D.violet)}
      <DArrow x1={130} y1={40} x2={168} y2={40} color={D.muted} label="DISCOVER" />
      <DArrow x1={290} y1={40} x2={328} y2={40} color={D.muted} label="REQUEST" />
      <DArrow x1={450} y1={40} x2={488} y2={40} color={D.muted} label="ACK" />
      <DArrow x1={560} y1={57} x2={560} y2={133} color={D.cyan} label="T1" labelDy={0} />
      <DArrow x1={490} y1={150} x2={392} y2={150} color={D.violet} label="T2" />
      <DArrow x1={538} y1={133} x2={538} y2={57} color={D.success} />
      <text x={470} y={100} fill={D.success} fontSize={9.5}>
        ACK
      </text>
      <DArrow x1={270} y1={150} x2={90} y2={58} color={D.danger} width={1.4} />
      <text x={110} y={120} fill={D.danger} fontSize={9.5}>
        lease expired / NAK
      </text>
    </DiagramSvg>
  );
}

function TimersDiagram() {
  const x0 = 40;
  const w = 560;
  const px = (f: number) => x0 + f * w;
  return (
    <DiagramSvg h={150} label={`Lease timeline for ${LEASE_SECONDS} seconds: T1 at 50 percent the client unicasts a renewal to its server; T2 at 87.5 percent it broadcasts a rebind to any server; at 100 percent the lease expires`}>
      <line x1={px(0)} y1={70} x2={px(1)} y2={70} stroke={D.line} strokeWidth={3} />
      {[
        { f: 0, t: "ACK", c: D.success },
        { f: 0.5, t: `T1 ${LEASE_SECONDS / 2} s`, c: D.cyan },
        { f: 0.875, t: `T2 ${(LEASE_SECONDS * 7) / 8} s`, c: D.violet },
        { f: 1, t: "expiry", c: D.danger },
      ].map((m) => (
        <g key={m.t}>
          <line x1={px(m.f)} y1={60} x2={px(m.f)} y2={80} stroke={m.c} strokeWidth={2} />
          <text x={px(m.f)} y={50} textAnchor={m.f === 1 ? "end" : m.f === 0 ? "start" : "middle"} fill={m.c} fontSize={10} fontWeight={700}>
            {m.t}
          </text>
        </g>
      ))}
      <text x={px(0.5)} y={100} fill={D.cyan} fontSize={9.5}>
        renew: unicast to its server
      </text>
      <text x={px(0.875)} y={120} textAnchor="middle" fill={D.violet} fontSize={9.5}>
        rebind: broadcast to any server
      </text>
    </DiagramSvg>
  );
}

function OffersDiagram() {
  return (
    <DiagramSvg h={210} label="Two servers send offers; the client's broadcast REQUEST names server A in Option 54, so server B releases its offer; if server A cannot honour the request it sends DHCPNAK and the client restarts">
      <DNode x={90} y={95} label="CLIENT" w={110} />
      <DNode x={520} y={35} label="Server A" sub="chosen (opt 54)" accent={D.success} w={140} />
      <DNode x={520} y={160} label="Server B" sub="offer withdrawn" accent={D.faint} w={140} />
      <DArrow x1={448} y1={40} x2={148} y2={84} color={D.success} label="OFFER" />
      <DArrow x1={448} y1={156} x2={148} y2={106} color={D.faint} label="OFFER" labelDy={18} />
      <DPill x={290} y={95} text="REQUEST (bcast) · opt 54 = A" color={DHCP} w={200} />
      <text x={20} y={202} fill={D.muted} fontSize={10}>
        A DHCPNAK (e.g. the address is no longer valid) sends the client back to INIT.
      </text>
    </DiagramSvg>
  );
}

function RelayScaleDiagram() {
  return (
    <DiagramSvg h={190} label="One central DHCP server serves many client subnets; each router interface acts as a relay stamping its own giaddr, and the server maps each giaddr to the matching scope">
      {["10.10.10.1", "10.30.30.1", "10.40.40.1"].map((g, i) => (
        <g key={g}>
          <DNode x={100} y={40 + i * 55} label={`relay giaddr ${g}`} accent={D.ip} w={180} h={36} />
          <DArrow x1={192} y1={40 + i * 55} x2={420} y2={95} color={DHCP} width={1.4} />
        </g>
      ))}
      <DNode x={510} y={95} label="DHCP-SRV" sub="scope per giaddr" accent={D.violet} w={160} />
    </DiagramSvg>
  );
}

function RecursionDiagram() {
  return (
    <DiagramSvg h={220} label="A stub resolver asks a recursive resolver with RD set; the recursive resolver iterates through a root server, the .test TLD servers and the authoritative server, then returns the answer and caches it">
      <DNode x={80} y={105} label="Stub (CLIENT)" accent={D.cyan} w={130} />
      <DNode x={260} y={105} label="Recursive" sub="resolver" accent={DNS} w={120} />
      <DNode x={500} y={30} label="Root" accent={D.faint} w={120} />
      <DNode x={500} y={105} label="TLD (.test)" accent={D.faint} w={120} />
      <DNode x={500} y={170} label="Authoritative" accent={D.success} w={120} />
      <DArrow x1={145} y1={98} x2={198} y2={98} color={DNS} label="RD=1" />
      <DArrow x1={198} y1={114} x2={145} y2={114} color={D.success} labelDy={18} label="answer" />
      <DArrow x1={320} y1={95} x2={438} y2={38} color={D.muted} width={1.4} />
      <DArrow x1={320} y1={105} x2={438} y2={105} color={D.muted} width={1.4} />
      <DArrow x1={320} y1={115} x2={438} y2={165} color={D.muted} width={1.4} />
      <text x={20} y={212} fill={D.muted} fontSize={10}>
        In the lesson, DNS-SRV plays the recursive resolver. The upstream iteration isn&apos;t simulated.
      </text>
    </DiagramSvg>
  );
}

function MessageDiagram() {
  return (
    <DiagramSvg h={160} label="DNS message: 12-byte header with ID, flags QR Opcode AA TC RD RA RCODE and four counts; then Question, Answer, Authority and Additional sections">
      <DFieldRow x={20} y={30} h={40} fields={[{ label: "ID", w: 70, color: DNS, strong: true }, { label: "Flags", sub: "QR·Op·AA·TC·RD·RA·RCODE", w: 190, color: DNS }, { label: "QD·AN·NS·AR", sub: "counts", w: 120, color: DNS }]} />
      <DFieldRow x={20} y={90} h={34} fields={[{ label: "Question", w: 140, color: D.cyan }, { label: "Answer", w: 140, color: D.success }, { label: "Authority", w: 140, color: D.faint }, { label: "Additional", w: 140, color: D.faint }]} />
      <text x={410} y={56} fill={D.muted} fontSize={10}>
        12-byte header
      </text>
    </DiagramSvg>
  );
}

/** DHCP → DNS → the real traffic: three destinations, three paths through R1. */
function ThreeTripsDiagram() {
  return (
    <DiagramSvg h={240} label={`Trip 1: DHCP from CLIENT broadcast to R1, relayed as unicast to DHCP-SRV ${DH_ADDR["DHCP-SRV"]}. Trip 2: a DNS query routed by R1 to DNS-SRV ${DH_ADDR["DNS-SRV"]} on UDP 53. Trip 3: the real traffic routed by R1 to WEB ${DH_ADDR.WEB}`}>
      <DNode x={70} y={120} label="CLIENT" sub="10.10.10.50" accent={D.cyan} w={110} />
      <DNode x={270} y={120} label="R1" sub="relay + router" accent={D.ip} w={110} />
      <DNode x={530} y={40} label="DHCP-SRV" sub={DH_ADDR["DHCP-SRV"]} accent={DHCP} w={130} />
      <DNode x={530} y={120} label="DNS-SRV" sub={DH_ADDR["DNS-SRV"]} accent={DNS} w={130} />
      <DNode x={530} y={200} label="WEB" sub={DH_ADDR.WEB} accent={D.success} w={130} />
      <DArrow x1={128} y1={108} x2={212} y2={108} color={DHCP} label="1 · broadcast" />
      <DArrow x1={328} y1={108} x2={462} y2={48} color={DHCP} label="1 · relayed unicast, giaddr" />
      <DArrow x1={128} y1={124} x2={212} y2={124} color={DNS} />
      <DArrow x1={328} y1={120} x2={462} y2={120} color={DNS} label="2 · DNS query, UDP 53" />
      <DArrow x1={128} y1={138} x2={212} y2={138} color={D.success} />
      <DArrow x1={328} y1={134} x2={462} y2={196} color={D.success} label="3 · the real traffic" labelDy={18} />
      <text x={20} y={232} fill={D.muted} fontSize={10}>
        Option 6 from trip 1 chose the destination of trip 2; the answer of trip 2 chose the destination of trip 3.
      </text>
    </DiagramSvg>
  );
}

// ------------------------------------------------------------------ knowledge check

const QUIZ: KnowledgeQuestion[] = [
  { id: "q1", prompt: "A new laptop shows 169.254.83.17 and the DHCP server's log is empty. Where is the fault most likely?", options: [{ id: "a", label: "Between the laptop's subnet and the server: the relay" }, { id: "b", label: "The DNS server" }, { id: "c", label: "The address pool" }], correctId: "a", explanation: "An empty log means the server never heard the DISCOVER. The broadcast can't cross R1 on its own: the relay (helper address) is missing or wrong. An exhausted pool would leave log entries." },
  { id: "q2", prompt: "Why does R1 write 10.10.10.1 into giaddr?", options: [{ id: "a", label: "So the server picks the 10.10.10.0/24 scope and knows where to send the reply" }, { id: "b", label: "So the laptop uses it as its DNS server" }, { id: "c", label: "To encrypt the request" }], correctId: "a", explanation: "The server may serve many subnets. giaddr names the subnet the request came from, and is where the server sends its answer." },
  { id: "q3", prompt: `Websites open by IP but not by name; ipconfig /all shows DNS Servers ${DL_WRONG.dns}. Best fix?`, options: [{ id: "a", label: "Correct option 6 on the DHCP server, then renew" }, { id: "b", label: "Type the right DNS server on this laptop" }, { id: "c", label: "Restart the DNS server" }], correctId: "a", explanation: "The wrong value came from the scope, so every client has it. Fixing one laptop by hand hides the fault; fixing option 6 fixes everyone at their next renewal." },
  { id: "q4", prompt: `A record moved to ${DL_WEB_NEW} a minute ago. nslookup shows the new address, but ping still goes to the old one. Why?`, options: [{ id: "a", label: "ping uses the laptop's cache, which still holds the old answer until its TTL expires" }, { id: "b", label: "The DNS server is wrong" }, { id: "c", label: "DHCP gave a wrong gateway" }], correctId: "a", explanation: "nslookup always asks the server; applications use the cache first. Flushing the cache (ipconfig /flushdns) or waiting out the TTL ends it." },
  { id: "q5", prompt: "At T1 (half the lease), what does the client send, and to whom?", options: [{ id: "a", label: "A DHCPREQUEST, unicast to the server that granted the lease" }, { id: "b", label: "A DHCPDISCOVER, broadcast" }, { id: "c", label: "Nothing until the lease expires" }], correctId: "a", explanation: "Renewal goes straight to the known server. Only at T2 (rebinding) does the client broadcast to any server." },
  { id: "q6", prompt: `nslookup says "Server failed (connection refused)" against ${DNS_IP}, and ping to ${DNS_IP} works. What is wrong?`, options: [{ id: "a", label: "The DNS service on that server isn't running" }, { id: "b", label: "The network path to the server" }, { id: "c", label: "The laptop's DHCP lease" }], correctId: "a", explanation: "Refused means the server's host answered (an ICMP port unreachable for UDP 53): reachable, but nothing listens on port 53. Check named." },
  { id: "q7", prompt: "A new floor's router sends relayed requests with giaddr 10.30.30.1, but dhcpd.conf has no subnet declaration for 10.30.30.0/24. What happens?", options: [{ id: "a", label: "The server ignores the request: no matching subnet, no scope, no offer" }, { id: "b", label: "It offers an address from 10.10.10.0/24" }, { id: "c", label: "It offers from its own subnet" }], correctId: "a", explanation: "The server picks the scope from giaddr. With no declaration containing 10.30.30.1 there is nothing to offer from; the floor needs its own subnet block with a range." },
  { id: "q8", prompt: "A lookup returns NXDOMAIN. What does that prove about the path to the DNS server?", options: [{ id: "a", label: "The path and the DNS service both work: the server answered" }, { id: "b", label: "The DNS server is unreachable" }, { id: "c", label: "The DNS service is stopped" }], correctId: "a", explanation: "NXDOMAIN is a real response (RCODE 3). Something had to carry the query there and the answer back. Look at the name and the zone, not the network." },
  { id: "q9", prompt: "The DHCP service stops at 08:00. A laptop got its 24 h lease at 07:00. When does that laptop lose its address?", options: [{ id: "a", label: "07:00 the next day, when the lease expires" }, { id: "b", label: "08:00, immediately" }, { id: "c", label: "19:00, at T1" }], correctId: "a", explanation: "At T1 (19:00) the unicast renewal fails and at T2 (04:00) the broadcast rebinding fails, but the address stays valid until the lease runs out at 07:00." },
];

// ------------------------------------------------------------------ content

export function DhcpDnsDeepDiveContent() {
  return (
    <div className="space-y-12">
      {/* ------------------------------------------------------------ Foundation */}
      <GuideSection id="dhd-why" eyebrow="Foundation" title="Why automatic configuration" tone="warning">
        <p>
          Every IPv4 host needs four settings before it can talk beyond its own cable: an address, a mask, a gateway and a DNS server. Typed by hand, they drift: duplicates, typos, laptops that move between buildings. DHCP (RFC 2131) hands them out centrally, for a limited time, so a change made once on the server reaches every client at its next renewal.
        </p>
        <CompareCards
          items={[
            { title: "Static settings", tone: "warning", tag: "by hand", points: ["Right for routers and servers that never move", "Every change visits every device", "Mistakes stay until someone notices"] },
            { title: "DHCP leases", tone: "success", tag: "central", points: ["Right for laptops, phones, desktops", "One scope change reaches everyone at renewal", "Addresses return to the pool when leases end"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="dhd-chain" eyebrow="Foundation" title="Two protocols, three trips" tone="cyan">
        <p>DHCP and DNS are taught together because users meet them together, but they are separate protocols, run by separate servers, on separate ports. What joins them is a single field: DHCP option 6 tells the client which DNS server to ask. After that, the traffic the user actually wanted is ordinary IP, routed like any other.</p>
        <DiagramFrame caption="Three different destinations, three different paths: the lease, the name, then the real traffic.">
          <ThreeTripsDiagram />
        </DiagramFrame>
        <CompareCards
          items={[
            { title: "DHCP", tone: "warning", tag: "configuration", points: ["UDP 67 (server) / 68 (client)", "Starts with a broadcast from 0.0.0.0; crosses R1 only through the relay", "Answers: who am I on this network? (address, mask, gateway, DNS server, lease)"] },
            { title: "DNS", tone: "violet", tag: "names", points: ["UDP 53 (TCP 53 for large answers)", "An ordinary routed unicast to the server option 6 named", "Answers: which address has this name?"] },
          ]}
        />
        <FlowSteps
          steps={[
            { title: "1 · DHCP gives the client its settings", body: "Address, mask, gateway (option 3), DNS server (option 6), lease time.", tone: "warning" },
            { title: "2 · DNS turns the name into an address", body: `The client asks ${DNS_IP}, the server from option 6, and caches the answer.`, tone: "violet" },
            { title: "3 · The real traffic follows the normal stack", body: `To ${DH_ADDR.WEB}: ARP for the gateway, R1 routes it. Neither DHCP nor DNS is involved any more.`, tone: "ip" },
          ]}
        />
      </GuideSection>

      {/* ------------------------------------------------------------ DHCP */}
      <GuideSection id="dhd-dhcpmsg" eyebrow="RFC 2131" title="The DHCP message" tone="warning">
        <p>Every DHCP message has the same layout, carried in UDP from port 68 (client) to 67 (server). The fields that matter most:</p>
        <FieldTable
          title="Key fields"
          columns={["Field", "Means", "In this lesson"]}
          rows={[
            ["op", "1 request (client), 2 reply (server)", "DISCOVER and REQUEST are op 1"],
            ["xid", "Transaction ID: pairs replies with requests", "Same on all four messages"],
            ["ciaddr", "The client's current address (renewals only)", "0.0.0.0 at first boot"],
            ["yiaddr", "\"Your\" address: what the server offers", "10.10.10.50"],
            ["giaddr", "The relay's address", "10.10.10.1"],
            ["chaddr", "The client's MAC", "00:00:5e:00:53:30"],
            ["options", "Message type (53), requested IP (50), server ID (54), lease (51), mask (1), router (3), DNS (6)", "All of them"],
          ]}
        />
      </GuideSection>

      <GuideSection id="dhd-journey" eyebrow="DHCP" title="One exchange, packet by packet" tone="warning">
        <p>From the lab&apos;s capture: the four DHCP messages become eight packets, because every message crosses R1 twice, once on each side of the relay. Read the &quot;From → to&quot; column: the client side is always broadcast, the server side always unicast.</p>
        <FieldTable title="The lease, as the lab captured it" columns={JOURNEY_COLS} rows={journeyRows(DORA)} />
        <p className="text-sm text-pv-text-muted">The server never sees the client&apos;s broadcast and the client never sees the server&apos;s address as a destination: R1&apos;s relay agent is the only device that touches both halves.</p>
      </GuideSection>

      <GuideSection id="dhd-fields" eyebrow="DHCP" title="Watch the fields change" tone="warning">
        <p>The same few fields carry the whole conversation. Here they are in each message, read from the lab&apos;s packets: what is empty tells you as much as what is filled.</p>
        <FieldTable title="Key fields, message by message" columns={["Field", "DISCOVER (client)", "DISCOVER (relayed)", "OFFER", "REQUEST", "ACK", "Renewal REQUEST"]} rows={fieldRows()} />
        <ChecklistCard
          tone="warning"
          title="What to notice"
          mark="→"
          items={[
            "ciaddr stays 0.0.0.0 until the client owns the address; only a renewal fills it",
            "giaddr is written by the relay, and it is how the server picks the scope; a renewal goes direct, so it has none",
            "yiaddr appears first in the OFFER: an offer, not yet an assignment",
            "Options 50 and 54 in the REQUEST say which address, from which server; they are how the other servers learn they lost",
            "The options in the ACK, not the OFFER, are the ones the client configures",
          ]}
        />
      </GuideSection>

      <GuideSection id="dhd-dora" eyebrow="DHCP" title="The four messages in detail" tone="warning">
        <p>The server&apos;s log shows the exchange as the server saw it: every message arrived &quot;via 10.10.10.1&quot;, the relay:</p>
        <CliPanel run={cli(HEALTHY, "DHCP-SRV", "cisco", "journalctl -u isc-dhcp-server")} />
        <FieldTable
          title="Why each one exists"
          columns={["Message", "Why it can't be skipped"]}
          rows={[
            ["DISCOVER", "The client knows no server: it must ask everyone"],
            ["OFFER", "A server proposes an address and reserves it briefly"],
            ["REQUEST", "Broadcast, so every server learns which offer won (option 54) and the others release theirs"],
            ["ACK", "Only now may the client use the address; it often checks with ARP that nobody else has it"],
          ]}
        />
      </GuideSection>

      <GuideSection id="dhd-states" eyebrow="RFC 2131" title="The DHCP client state machine" tone="warning">
        <DiagramFrame caption="The lesson covered INIT → SELECTING → REQUESTING → BOUND and RENEWING.">
          <StatesDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="dhd-offers" eyebrow="Selection" title="Multiple offers and DHCPNAK" tone="violet">
        <DiagramFrame caption="Option 54 in the broadcast REQUEST tells every server which offer won.">
          <OffersDiagram />
        </DiagramFrame>
        <p>A DHCPNAK is a server saying &quot;no&quot; to a REQUEST, typically because the client asks to keep an address from another subnet after moving. The client starts again at INIT.</p>
      </GuideSection>

      {/* ------------------------------------------------------------ Relay, scopes and leases */}
      <GuideSection id="dhd-relay" eyebrow="RFC 1542" title="Relays make one server enough" tone="ip">
        <DiagramFrame caption="giaddr turns one server into a server for every subnet.">
          <RelayScaleDiagram />
        </DiagramFrame>
        <p>The relay lives on the router interface that faces the clients. Cisco calls it a helper address; Junos configures a dhcp-relay group with a server group:</p>
        <div className="grid gap-3 lg:grid-cols-2">
          <CliPanel run={cli(HEALTHY, "R1", "cisco", "show running-config interface GigabitEthernet0/0")} />
          <CliPanel run={cli(HEALTHY, "R1", "juniper", "show configuration forwarding-options dhcp-relay")} />
        </div>
        <Callout tone="warning" title="On the client-facing interface" icon="!">
          The helper goes where the broadcasts arrive (Gi0/0, the clients&apos; side), never on the interface toward the server. A helper on the wrong interface is the same as no helper.
        </Callout>
      </GuideSection>

      <GuideSection id="dhd-scopeselect" eyebrow="Scopes" title="How the server decides which scope applies" tone="ip">
        <p>A DHCP server can hold scopes for many subnets, so every request raises the question: which pool? It decides from where the request entered the network, never from the client (which has no address to report):</p>
        <FlowSteps
          steps={[
            { title: "giaddr set?", body: "A relayed request: find the declared subnet that contains giaddr. 10.10.10.1 lies in 10.10.10.0/24, so that scope applies.", tone: "ip" },
            { title: "giaddr empty?", body: "The client is on the server's own LAN: use the subnet of the interface the broadcast arrived on.", tone: "cyan" },
            { title: "No matching subnet?", body: "The request is ignored: no scope, no offer. That is why dhcpd.conf declares even the server's own subnet.", tone: "danger" },
          ]}
        />
        <FieldTable
          title="Where a request comes from, and what the server does"
          columns={["Request arrives with", "Matching declaration", "Result"]}
          rows={[
            ["giaddr 10.10.10.1 (this lab)", "subnet 10.10.10.0/24 with a range", "Offer from 10.10.10.50–150, routers 10.10.10.1"],
            ["giaddr 0.0.0.0, on the server's own LAN", "subnet 10.20.20.0/24 { } (no range)", "Known subnet, nothing to lease: no offer"],
            ["giaddr of a LAN with no declaration", "none", "Ignored. Add a subnet block with a range for it"],
          ]}
        />
        <Callout tone="cyan" title="One server, many floors" icon="→">
          Adding a floor means a new subnet block on the server and a helper address on that floor&apos;s router interface. The relay&apos;s giaddr does the rest: each floor&apos;s requests land in its own scope with its own gateway in option 3.
        </Callout>
      </GuideSection>

      <GuideSection id="dhd-scope" eyebrow="Scopes" title="Scopes and options" tone="ip">
        <p>A scope is a subnet, a range to lease from it, and the options every client in it receives. ISC dhcpd also needs its own subnet declared, with no range, so it knows where it lives:</p>
        <CliPanel run={cli(HEALTHY, "DHCP-SRV", "cisco", "cat /etc/dhcp/dhcpd.conf")} />
        <FieldTable
          title="Options you will meet"
          columns={["Option", "Name", "Sets"]}
          rows={[
            ["1", "Subnet mask", "The client's mask"],
            ["3", "Router", "The default gateway"],
            ["6", "Domain name servers", "Where the client sends DNS queries"],
            ["15", "Domain name", "The suffix added to short names"],
            ["51", "Lease time", `How long the address is the client's (${LEASE_SECONDS} s here)`],
            ["53 / 54", "Message type / server ID", "Which DHCP message this is; which server sent it"],
          ]}
        />
        <p className="text-sm text-pv-text-muted">The pool must exclude addresses used statically on the subnet (R1&apos;s 10.10.10.1 here), or two devices will end up with the same address.</p>
      </GuideSection>

      <GuideSection id="dhd-timers" eyebrow="Lease timers" title="T1, T2, renew and rebind" tone="cyan">
        <DiagramFrame caption="Defaults: T1 = 0.5 × lease, T2 = 0.875 × lease.">
          <TimersDiagram />
        </DiagramFrame>
        <Callout tone="warning" title="Renew vs rebind">
          Renewing (T1) unicasts to the server that granted the lease. Rebinding (T2) broadcasts to any server, in case the original is gone. That is why a scope change reaches clients at their next renewal, not instantly.
        </Callout>
      </GuideSection>

      <GuideSection id="dhd-renewal" eyebrow="Lease timers" title="Renewal and rebinding on the wire" tone="cyan">
        <p>At T1 (12 h of the 24 h lease) the lab&apos;s client renews. It now has an address and a gateway, so after an ARP for that gateway the renewal is an ordinary routed unicast, straight to the server named in option 54: no relay, giaddr empty, ciaddr filled.</p>
        <FieldTable title="T1 renewal, healthy" columns={JOURNEY_COLS} rows={journeyRows(RENEW)} />
        <CliPanel run={only(cli(RENEW, "PC", "cisco", "ipconfig /all"), /IPv4|Lease|DHCP Server/)} />
        <p>Now the same moment with dhcpd stopped: the unicast renewal reaches DHCP-SRV and is answered with an ICMP port unreachable for UDP 67, and the client simply keeps its lease. At T2 (21 h) it gives up on its own server and broadcasts, hoping any server will extend the lease. The broadcast goes through the relay again:</p>
        <FieldTable title="T2 rebinding, DHCP service down" columns={JOURNEY_COLS} rows={journeyRows(REBIND_DOWN)} />
        <CliPanel run={only(cli(REBIND_DOWN, "PC", "cisco", "ipconfig /all"), /IPv4|Lease/)} />
        <p>At 24 h the lease expires and the client must stop using the address entirely:</p>
        <CliPanel run={cli(EXPIRED, "PC", "cisco", "ipconfig /all")} />
        <Callout tone="warning" title="Why a server outage hides for hours" icon="!">
          A DHCP server can be down all morning before anyone notices: clients with valid leases keep working until expiry. New laptops fail first; everyone else fails later, at their own lease&apos;s end.
        </Callout>
      </GuideSection>

      <GuideSection id="dhd-exhaust" eyebrow="Pool limits" title="Exhaustion, conflicts and unusable addresses" tone="danger">
        <p>A scope has a fixed number of addresses: 10.10.10.50–150 is 101. When every one is leased, the server still hears each DISCOVER through the relay and simply makes no offer, so the client retries and falls back to 169.254 (fault 3 shows the server&apos;s own log line: &quot;no free leases&quot;).</p>
        <CompareCards
          items={[
            { title: "Addresses that must never be leased", tone: "warning", tag: "plan the range", points: ["The router's own address (10.10.10.1 here: outside the range)", "Servers, printers and switches configured statically", "If one sits inside the range, two devices end up with the same address"] },
            { title: "When a conflict happens anyway", tone: "danger", tag: "detect it", points: ["A server can be set to ping an address before offering it (ISC dhcpd ping-check, Windows conflict detection)", "Clients often ARP for their new address before using it; a reply means someone already has it, and the client declines the lease (DHCPDECLINE)", "Evidence: two MACs for one IP in ARP tables"] },
          ]}
        />
        <p className="text-sm text-pv-text-muted">Exhaustion has three usual causes: the range is simply too small, leases are too long for a population that comes and goes (a guest Wi-Fi), or something is leasing addresses it doesn&apos;t need. The cure is a wider range, a shorter lease, or reclaiming stale leases.</p>
      </GuideSection>

      <GuideSection id="dhd-apipa" eyebrow="When DHCP fails" title="Release, failure and 169.254" tone="danger">
        <p>
          A client that gets no answer at all does not stay without an address: Windows (and most systems) give themselves a link-local address from 169.254.0.0/16 (APIPA). It works only between hosts on the same cable and has no gateway, so it is never a working configuration, only a sign that DHCP failed:
        </p>
        <CliPanel run={cli(T_RELAY, "PC", "cisco", "ipconfig /renew")} />
        <p className="text-sm text-pv-text-muted"><Mono>ipconfig /release</Mono> gives the address back to the server early; <Mono>ipconfig /renew</Mono> asks again. Both are how you force a client to pick up a changed scope.</p>
      </GuideSection>

      {/* ------------------------------------------------------------ DNS */}
      <GuideSection id="dhd-dnswhy" eyebrow="DNS" title="Why DNS exists" tone="violet">
        <p>
          People and configuration files use names because addresses change. In the lab&apos;s stale-cache ticket, {DNS_NAME} moves from {DH_ADDR.WEB} to {DL_WEB_NEW}: one record changes on DNS-SRV and every client follows, at its own pace, as its cached answer expires. Without DNS, every client and every bookmark would have to be edited.
        </p>
        <p>DNS is a distributed database: each zone (packetverse.test here) is answered by its own authoritative servers, and resolvers find their way to them. In this lesson the client&apos;s DNS server is itself authoritative for the only zone the client asks about, so one query and one answer tell the whole story.</p>
      </GuideSection>

      <GuideSection id="dhd-zone" eyebrow="RFC 1035" title="Zones and records" tone="violet">
        <p>DNS-SRV holds the zone <Mono>packetverse.test</Mono>: a file of records, each with a name, a type and a value, all cached for the zone&apos;s TTL ({DNS_RECORD_TTL} s):</p>
        <CliPanel run={cli(HEALTHY, "DNS-SRV", "cisco", "cat /etc/bind/db.packetverse.test")} />
        <FieldTable
          title="Record types"
          columns={["Type", "Maps", "Example"]}
          rows={[
            ["A", "name → IPv4 address", `www → ${DH_ADDR.WEB}`],
            ["AAAA", "name → IPv6 address", "—"],
            ["NS", "zone → its name servers", "packetverse.test → ns"],
            ["SOA", "the zone's serial and timers", "serial 1, negative-cache 300 s"],
            ["MX", "domain → mail server", "—"],
            ["CNAME", "alias → canonical name", "—"],
            ["PTR", "address → name (reverse zones)", "—"],
          ]}
        />
      </GuideSection>

      <GuideSection id="dhd-recursion" eyebrow="RFC 1035" title="Recursive vs authoritative" tone="violet">
        <DiagramFrame caption="Stubs ask recursive resolvers; recursive resolvers iterate toward authoritative servers.">
          <RecursionDiagram />
        </DiagramFrame>
        <p>In this lesson the laptop&apos;s DNS server is also authoritative for the name it asks about, so the answer comes straight from the zone. For any other name, the same server would recurse: root, TLD, authoritative, then answer and cache.</p>
      </GuideSection>

      <GuideSection id="dhd-dnsjourney" eyebrow="DNS" title="A lookup on the wire" tone="violet">
        <p>The first lookup after boot, from the lab&apos;s capture. Before the query can leave, the client ARPs for its gateway: DNS-SRV is on another subnet.</p>
        <FieldTable title="The first lookup" columns={JOURNEY_COLS} rows={journeyRows(DNS_OK)} />
        <FieldTable title="Query and response, field by field" columns={["Field", "Query", "Response"]} rows={dnsFieldRows()} />
        <p className="text-sm text-pv-text-muted">The same Transaction ID pairs the answer with the question; AA (authoritative answer) shows DNS-SRV answered from its own zone; RA shows it would also recurse for other names. A second lookup within 300 s sends nothing at all: {DNS_CACHED.lastResult?.text}.</p>
      </GuideSection>

      <GuideSection id="dhd-message" eyebrow="Wire format" title="The DNS message" tone="cyan">
        <DiagramFrame caption="The same format serves both queries and responses. QR tells them apart.">
          <MessageDiagram />
        </DiagramFrame>
        <p>The RCODE in the header is what tools print: NOERROR (answered), NXDOMAIN (the name doesn&apos;t exist), SERVFAIL (the server couldn&apos;t answer). A timeout is not an RCODE at all: no message came back.</p>
      </GuideSection>

      <GuideSection id="dhd-negative" eyebrow="DNS" title="Answers that say no, and silence" tone="danger">
        <p>A failed lookup is not one thing. A negative answer is still an answer, and it proves more than silence does. The lab reproduces all three cases; the NXDOMAIN exchange looks like this:</p>
        <FieldTable title="NXDOMAIN: the server answered, the name doesn't exist" columns={JOURNEY_COLS} rows={journeyRows(NX)} />
        <FieldTable
          title="Reading a failed lookup"
          columns={["What came back", "The lab's resolver says", "It proves", "Look at"]}
          rows={[
            ["A response, RCODE 3 (NXDOMAIN)", <Mono key="1">{NX.lastResult?.text}</Mono>, "The whole path and the DNS service work", "The name, or the zone's records"],
            ["ICMP port unreachable (refused)", <Mono key="2">{T_DNS_R.lastResult?.text}</Mono>, "The path and the host work; nothing listens on UDP 53", "The DNS service on that server (fault 6)"],
            ["Nothing (timeout)", <Mono key="3">{T_OPT6_R.lastResult?.text}</Mono>, "Nothing answered at that address: here R1 got no ARP reply for it", "Which server was asked (option 6), then the path to it (fault 2)"],
          ]}
        />
      </GuideSection>

      <GuideSection id="dhd-tcp" eyebrow="Transport" title="UDP, TCP and caching" tone="success">
        <FieldTable
          title="DNS over port 53"
          columns={["Transport", "Used for"]}
          rows={[
            ["UDP 53", "Ordinary queries and responses (this lesson)"],
            ["TCP 53", "Responses too large for UDP (TC bit set), and zone transfers"],
          ]}
        />
        <p>Resolvers cache each answer for its record TTL, and cache &quot;no such name&quot; answers too (negative caching, from the SOA). Changing a record doesn&apos;t reach clients whose cached copy hasn&apos;t expired: the same shape of problem as a lease that hasn&apos;t renewed.</p>
      </GuideSection>

      <GuideSection id="dhd-client" eyebrow="The client" title="The client's resolver and its cache" tone="violet">
        <p>The laptop runs a small <Strong>stub resolver</Strong>: it asks the server in option 6 and keeps the answers. Two tools behave differently on purpose:</p>
        <CompareCards
          items={[
            { title: "nslookup", tone: "violet", tag: "asks the server", points: ["Always sends a query, ignoring the cache", "Shows which server answered", "Tests DNS itself"] },
            { title: "ping, browsers, apps", tone: "cyan", tag: "cache first", points: ["Use a cached answer while its TTL lasts", "Ask the server only when it has expired", "What the user actually experiences"] },
          ]}
        />
        <CliPanel run={cli(HEALTHY, "PC", "cisco", "ipconfig /displaydns")} />
      </GuideSection>

      <GuideSection id="dhd-layers" eyebrow="Names and reachability" title="Resolution is not reachability" tone="ip">
        <p>A successful lookup proves only that the name has an address. The traffic that follows goes somewhere else entirely, and can fail for reasons DNS knows nothing about. The lab&apos;s <Mono>ping {DNS_NAME}</Mono> shows both stages:</p>
        <FieldTable title="ping by name, healthy: resolve, then reach" columns={JOURNEY_COLS} rows={journeyRows(WEB_OK)} />
        <p>Now the stale-cache ticket: the laptop already holds an answer, so no DNS packet is sent at all, and the ping goes to the old, switched-off server:</p>
        <FieldTable title="ping by name, stale cache: resolved from memory, unreachable" columns={JOURNEY_COLS} rows={journeyRows(T_STALE_R)} />
        <CompareCards
          items={[
            { title: "DNS is responsible for", tone: "violet", tag: "the name", points: ["Turning www.packetverse.test into an address", "How long that answer may be reused (TTL)"] },
            { title: "DNS is not responsible for", tone: "warning", tag: "everything after", points: ["Whether that address answers", "The route to it, the gateway, the firewall, the application"] },
          ]}
        />
      </GuideSection>

      {/* ------------------------------------------------------------ Operations */}
      <GuideSection id="dhd-verify" eyebrow="Operations" title="Verifying each stage, on every device" tone="success">
        <p>Each stage depends on the one before it, so verify from the bottom up and stop at the first one that fails:</p>
        <FieldTable
          title="The verification ladder (healthy values from the lab)"
          columns={["Stage", "Evidence", "Healthy here"]}
          rows={[
            ["1 · Lease", <Mono key="1">ipconfig /all · DHCP-SRV: journalctl -u isc-dhcp-server · dhcp-lease-list</Mono>, `10.10.10.50, gateway 10.10.10.1, DNS ${DNS_IP}, from DHCP server 10.20.20.10; four messages logged via 10.10.10.1`],
            ["(no lease?) · Relay", <Mono key="0">R1: show running-config interface Gi0/0 · show configuration forwarding-options dhcp-relay</Mono>, `ip helper-address ${DH_ADDR["DHCP-SRV"]} on the clients' interface`],
            ["2 · Gateway", <Mono key="2">arp -a · ping 10.10.10.1</Mono>, "10.10.10.1 resolved to R1's MAC; replies"],
            ["3 · Path to the DNS server", <Mono key="3">R1: show ip route · show ip arp</Mono>, `10.20.20.0/24 connected on Gi0/1; ${DNS_IP} in R1's ARP table`],
            ["4 · DNS service", <Mono key="4">nslookup · DNS-SRV: ss -ulnp</Mono>, `Answer ${DH_ADDR.WEB}; named listening on :53`],
            ["5 · The real traffic", <Mono key="5">ping by name · the application</Mono>, `Replies from ${DH_ADDR.WEB}`],
          ]}
        />
        <div className="grid gap-3 lg:grid-cols-2">
          <CliPanel run={only(cli(HEALTHY, "R1", "cisco", "show ip route"), /last resort|^S|^C/)} />
          <CliPanel run={cli(HEALTHY, "R1", "cisco", "show ip arp")} />
        </div>
        <p>The servers have their own evidence: R1 (Junos) counts what its relay carried, and DHCP-SRV lists what it leased.</p>
        <div className="grid gap-3 lg:grid-cols-2">
          <CliPanel run={cli(HEALTHY, "R1", "juniper", "show dhcp relay statistics")} />
          <CliPanel run={cli(HEALTHY, "DHCP-SRV", "cisco", "dhcp-lease-list")} />
        </div>
      </GuideSection>

      {/* ------------------------------------------------------------ Troubleshooting */}
      <GuideSection id="dhd-signatures" eyebrow="Troubleshooting" title="Failure signatures" tone="danger">
        <FailureSignatures
          items={[
            { tag: "169.254", title: "Self-assigned address, server log empty", tone: "danger", points: ["The DISCOVER never reached the server", "→ the relay on R1"] },
            { tag: "pool", title: "New clients fail, old ones work", tone: "warning", points: ["The server logs no free leases", "→ the pool is full"] },
            { tag: "opt 3", title: "An address, but nothing off the subnet", tone: "danger", points: ["Errors come from the client's own address", "→ the gateway the lease named"] },
            { tag: "opt 6", title: "IPs work, names time out", tone: "violet", points: ["nslookup asks a server that doesn't answer", "→ the DNS server the lease named"] },
            { tag: "refused", title: "Names fail at once, server pings", tone: "warning", points: ["Connection refused on UDP 53", "→ the DNS service is down"] },
            { tag: "stale", title: "One client lands on an old address", tone: "cyan", points: ["nslookup shows the new answer, ping uses the old", "→ a cached answer within its TTL"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="dhd-workflow" eyebrow="Workflow" title="Diagnosing boot-to-name problems" tone="danger">
        <TroubleshootingFlow
          steps={[
            { question: "Does the client have a real lease?", look: "ipconfig /all: an address in the scope, a DHCP server, a lease time. 169.254 means DHCP failed: go to the relay and the server." },
            { question: "Did the server hear it, and answer?", look: "journalctl on DHCP-SRV: an empty log points at the relay; 'no free leases' at the pool." },
            { question: "Are the options right?", look: "Gateway (option 3) and DNS server (option 6) in ipconfig /all against the scope in dhcpd.conf." },
            { question: "Does the path work by IP?", look: "ping the gateway, then a remote address. Failing here is a gateway or routing problem, not DNS." },
            { question: "Does DNS answer, from the right server?", look: "nslookup: timeout (nobody there), refused (no service), NXDOMAIN (no such record), or an answer." },
            { question: "Is the client using an old answer?", look: "ipconfig /displaydns against nslookup: a stale cache shows the old address with time left." },
            { question: "Fix at the source, then make the client pick it up", look: "Correct the scope or the zone; renew the lease or flush the cache; repeat the user's test." },
          ]}
        />
      </GuideSection>

      <GuideSection id="dhd-separate" eyebrow="Troubleshooting" title="DHCP, routing, DNS or transport?" tone="danger">
        <p>Users report all of these as &quot;the internet doesn&apos;t work&quot;. One look at the client usually tells you which layer to blame:</p>
        <FieldTable
          title="What the client shows, and where that points"
          columns={["Client shows", "Points at", "Because"]}
          rows={[
            ["169.254.x.x, or no address", "DHCP (relay, server, pool)", "No lease ever arrived"],
            ["A lease, but the gateway doesn't answer ARP", "DHCP option 3 (or the gateway itself)", "The address in the lease is wrong, or the router is down"],
            ["Gateway fine, remote IPs fail", "Routing", "R1 or a router beyond has no route, or the reply has none"],
            ["Remote IPs fine, names fail", "DNS (option 6, the service, the record)", "The path works; the lookup doesn't"],
            ["Name resolves, the application fails", "Transport or the application", "TCP port closed, filtered, or the service down"],
          ]}
        />
        <p>The wrong-gateway ticket is the classic trap: the laptop has a lease, so DHCP looks innocent, yet the fault is a DHCP option. The client never got an ARP answer for 10.10.10.254, and R1 never heard from the client at all:</p>
        <div className="grid gap-3 lg:grid-cols-2">
          <CliPanel run={cli(T_GW, "PC", "cisco", "arp -a")} />
          <CliPanel run={cli(T_GW, "R1", "cisco", "show ip arp")} />
        </div>
      </GuideSection>

      <GuideSection id="dhd-faults" eyebrow="Troubleshooting" title="The six tickets, step by step" tone="danger">
        <p>Each fault below is one of the DHCP & DNS Lab&apos;s tickets, reproduced by the lab&apos;s own model; every output is what that device prints at that moment. The second is the lesson&apos;s incident, seen from the servers.</p>
        <FailureWalk
          title="1 · No address at all: the relay is missing"
          normal={<>R1&apos;s Gi0/0 carries <Mono>ip helper-address {DH_ADDR["DHCP-SRV"]}</Mono>, and the server hears every DISCOVER.</>}
          change={<>The helper address is gone from R1.</>}
          evidence={
            <>
              <p>The laptop self-assigns 169.254.83.17. R1 has no relay, and the server&apos;s log is empty: it never heard the request.</p>
              <CliPanel run={cli(T_RELAY, "R1", "cisco", "show running-config interface GigabitEthernet0/0")} />
              <CliPanel run={cli(T_RELAY, "R1", "juniper", "show dhcp relay statistics")} />
              <CliPanel run={cli(T_RELAY, "DHCP-SRV", "cisco", "journalctl -u isc-dhcp-server")} />
            </>
          }
          next={<>An empty server log with a 169.254 client always points between them. The broadcast can&apos;t cross R1 by itself.</>}
          fix={<>Cisco <Mono>interface GigabitEthernet0/0</Mono>, <Mono>ip helper-address {DH_ADDR["DHCP-SRV"]}</Mono> · Junos: the dhcp-relay group with the server group, on ge-0/0/0.0, <Mono>commit</Mono>.</>}
          proof={<><Mono>ipconfig /renew</Mono> returns 10.10.10.50, and the server logs four messages via 10.10.10.1.</>}
        />
        <FailureWalk
          title="2 · Names fail, IPs work: the wrong option 6"
          normal={<>The scope sends <Mono>option domain-name-servers {DNS_IP}</Mono>.</>}
          change={<>The scope sends {DL_WRONG.dns}, an address nobody has.</>}
          evidence={
            <>
              <p>Every lease names the wrong server; DNS-SRV itself is up and answers locally:</p>
              <CliPanel run={only(cli(T_OPT6, "DHCP-SRV", "cisco", "cat /etc/dhcp/dhcpd.conf"), /option domain-name-servers/)} />
              <CliPanel run={cli(T_OPT6, "PC", "cisco", `nslookup ${DNS_NAME}`)} />
              <CliPanel run={cli(T_OPT6, "DNS-SRV", "cisco", `dig @127.0.0.1 ${DNS_NAME}`)} />
            </>
          }
          next={<>When the DNS server works locally and the client times out, compare the server the client asks (ipconfig /all) with the one that works.</>}
          fix={<>Correct option 6 in dhcpd.conf, restart isc-dhcp-server, renew the clients.</>}
          proof={<>ipconfig /all shows {DNS_IP}; nslookup answers {DH_ADDR.WEB}.</>}
        />
        <FailureWalk
          tone="warning"
          title="3 · New laptops get nothing: the pool is full"
          normal={<>The scope 10.10.10.50–150 has free addresses.</>}
          change={<>Every address in the range is leased.</>}
          evidence={
            <>
              <p>Old clients keep their leases and work; new ones get 169.254. This time the server <em>did</em> hear them, and says why it stayed silent:</p>
              <CliPanel run={cli(T_POOL, "DHCP-SRV", "cisco", "dhcp-lease-list")} />
              <CliPanel run={only(cli(T_POOL, "DHCP-SRV", "cisco", "journalctl -u isc-dhcp-server"), /no free leases/)} />
            </>
          }
          next={<>169.254 with server log entries is a server-side refusal, not a relay problem. Count the leases.</>}
          fix={<>Widen the range (if the subnet has room), shorten the lease time so unused addresses return sooner, or reclaim stale leases.</>}
          proof={<>dhcp-lease-list shows free addresses, and a new laptop is bound.</>}
        />
        <FailureWalk
          tone="warning"
          title="4 · Some users still reach the old web server: a stale cache"
          normal={<>{DNS_NAME} points to {DH_ADDR.WEB}, and clients cache it for {DNS_RECORD_TTL} s.</>}
          change={<>The site moves to {DL_WEB_NEW}; the zone is updated. The laptop asked a minute before the change.</>}
          evidence={
            <>
              <p>nslookup, which always asks the server, shows the new address. The laptop&apos;s cache still holds the old one, with time left, and ping uses it:</p>
              <CliPanel run={cli(T_STALE, "PC", "cisco", `nslookup ${DNS_NAME}`)} />
              <CliPanel run={only(cli(T_STALE, "PC", "cisco", "ipconfig /displaydns"), /Record Name|Time To Live|A \(Host\)/)} />
              <CliPanel run={only(cli(T_STALE, "PC", "cisco", `ping ${DNS_NAME}`), /Pinging|timed out/)} />
            </>
          }
          next={<>Nothing is broken; the cache is doing its job. Lower the TTL before a planned move next time.</>}
          fix={<><Mono>ipconfig /flushdns</Mono> on the client (or wait out the TTL).</>}
          proof={<>ping {DNS_NAME} now resolves to {DL_WEB_NEW} and answers.</>}
        />
        <FailureWalk
          title="5 · An address, but nothing works: the wrong option 3"
          normal={<>The scope sends <Mono>option routers 10.10.10.1</Mono>.</>}
          change={<>The scope sends {DL_WRONG.gw}, an address nobody has.</>}
          evidence={
            <>
              <p>The laptop reaches R1 directly, but nothing off the subnet, by name or IP. The error comes from the laptop&apos;s own address: it never found its gateway.</p>
              <CliPanel run={only(cli(T_GW, "PC", "cisco", "ipconfig /all"), /IPv4|Gateway|DNS/)} />
              <CliPanel run={only(cli(T_GW, "PC", "cisco", `ping ${DH_ADDR.WEB}`), /Pinging|Reply/)} />
            </>
          }
          next={<>Names failing too doesn&apos;t make it DNS: the DNS server is off-subnet as well. Test by IP first.</>}
          fix={<>Correct option 3 in the scope, restart dhcpd, renew.</>}
          proof={<>ipconfig /all shows 10.10.10.1, and the web server answers by IP and by name.</>}
        />
        <FailureWalk
          tone="warning"
          title="6 · Nobody can open anything by name: DNS service stopped"
          normal={<>named runs on DNS-SRV and listens on UDP 53.</>}
          change={<>named is stopped. The server itself stays up.</>}
          evidence={
            <>
              <p>The lookup fails at once with refused: the server&apos;s host answered (ICMP port unreachable), but no DNS service did. Ping to the server works, which misleads users:</p>
              <CliPanel run={cli(T_DNS, "PC", "cisco", `nslookup ${DNS_NAME}`)} />
              <CliPanel run={cli(T_DNS, "DNS-SRV", "cisco", "systemctl status named")} />
              <CliPanel run={cli(T_DNS, "DNS-SRV", "cisco", "ss -ulnp")} />
            </>
          }
          next={<>Refused is fast and means &quot;host up, service down&quot;; a timeout means nothing answered at that address.</>}
          fix={<>Start named (and find out why it stopped: <Mono>journalctl -u named</Mono>).</>}
          proof={<><Mono>ss -ulnp</Mono> shows :53, and nslookup answers.</>}
        />
        <LabBridge label="Troubleshoot them in the DHCP & DNS Lab">The six tickets, reported as users report them. Follow the traffic, gather the evidence on every device, fix the source and prove it.</LabBridge>
      </GuideSection>

      <GuideSection id="dhd-prove" eyebrow="Troubleshooting" title="Proving a repair" tone="success">
        <ChecklistCard
          tone="success"
          title="The proof"
          mark="✓"
          items={[
            "The fix is at the source (scope, relay, zone, service), not typed on one client",
            "The client picked it up: a fresh lease (ipconfig /renew) or an empty cache (ipconfig /flushdns)",
            "ipconfig /all shows the expected address, gateway, DNS server and DHCP server",
            "The user's own test works: the page opens by name",
          ]}
        />
      </GuideSection>

      {/* ------------------------------------------------------------ Beyond */}
      <GuideSection id="dhd-beyond" eyebrow="Beyond this lesson" title="DHCPv6, snooping, DNSSEC and more" tone="violet">
        <FieldTable
          title="Where these protocols go next"
          columns={["Topic", "In short"]}
          rows={[
            ["DHCPv6 and SLAAC", "IPv6 hosts can build their own address from router advertisements (SLAAC), with or without DHCPv6 for options."],
            ["Reservations", "A scope can tie an address to a MAC, so a printer always gets the same lease."],
            ["DHCP snooping", "Switches only trust DHCP replies from the server's port, stopping rogue DHCP servers."],
            ["Failover", "Two DHCP servers share a pool so one can fail without clients noticing."],
            ["DNSSEC", "Signed records, so a resolver can tell a forged answer from a real one."],
            ["DoH / DoT", "DNS over HTTPS or TLS: encrypted queries, which also bypass the DNS server DHCP named."],
            ["Split-horizon DNS", "Different answers for inside and outside clients for the same name."],
          ]}
        />
      </GuideSection>

      {/* ------------------------------------------------------------ Master it */}
      <GuideSection id="dhd-myths" eyebrow="Master it" title="Common misconceptions" tone="warning">
        <Misconceptions
          items={[
            { myth: "If ping by IP works, DNS can't be the problem.", correction: "It's the opposite: IP working while names fail points straight at DNS." },
            { myth: "If ping to the DNS server works, DNS works.", correction: "Ping proves the host is up. The DNS service on UDP 53 can still be stopped." },
            { myth: "A DHCP change reaches clients immediately.", correction: "Clients pick it up at their next renewal (T1), or when forced with ipconfig /renew." },
            { myth: "A relay forwards the client's broadcast across the router.", correction: "It never forwards the broadcast. It receives it and sends a new unicast to the server, adding giaddr; the reply comes back to the relay, which delivers it on the client's LAN." },
            { myth: "DHCP and DNS are the same service.", correction: "Separate protocols, ports and servers. DHCP only tells the client which DNS server to use (option 6)." },
            { myth: "Getting an address means DHCP worked.", correction: "Every option can still be wrong: a lease with a bad option 3 or option 6 breaks everything after it." },
            { myth: "A successful lookup proves the application works.", correction: "It proves the name has an address. The traffic to that address can still fail: a stale answer, a dead server, a closed port." },
            { myth: "A stopped DHCP server is noticed at once.", correction: "Clients keep their leases until expiry. New clients fail first; the rest fail hours later." },
            { myth: "169.254.x.x is a working address.", correction: "It's a self-assigned fallback that only reaches the same cable. It means DHCP failed." },
            { myth: "nslookup shows what the browser will use.", correction: "nslookup always asks the server; the browser uses the cache first." },
            { myth: "The DNS TTL is the same as the IPv4 TTL.", correction: "DNS TTL is seconds of caching; IPv4 TTL is a hop count." },
            { myth: "Fixing the setting on one laptop fixes the problem.", correction: "If the value came from DHCP, every client has it. Fix the scope." },
          ]}
        />
      </GuideSection>

      <GuideSection id="dhd-quiz" eyebrow="Master it" title="Knowledge check" tone="success">
        <KnowledgeQuiz questions={QUIZ} />
      </GuideSection>

      <GuideSection id="dhd-explain" eyebrow="Master it" title="Can you explain it?" tone="success">
        <ExplainIt
          items={[
            { q: "Why does a new laptop need a relay to reach a DHCP server in another subnet?", a: "It has no address yet, so it can only broadcast, and routers don't forward broadcasts. The relay on the router's client-facing interface catches the broadcast and resends it as unicast to the server, stamping giaddr." },
            { q: "How does the DHCP server know which pool to use?", a: "From giaddr: the relay's address on the client subnet. The server picks the scope that contains it and replies to the relay." },
            { q: "Why can websites open by IP while names fail?", a: "The path works, but the name-to-address step doesn't. Usually the client asks a DNS server that isn't there (a wrong option 6) or isn't serving (named stopped)." },
            { q: "Why is a renewal unicast when the first request was a broadcast?", a: "At first the client has no address and knows no server, so it can only broadcast, and only the relay can carry that across R1. When it renews it has both an address and the server's identity (option 54), so it sends an ordinary routed unicast straight to that server." },
            { q: "Why can a wrong DHCP option look like a routing failure?", a: "With a bad option 3 the client has a lease, so DHCP looks fine, but it can't reach its gateway, so nothing off the subnet works. The evidence is on the client: no ARP answer for the gateway it was given." },
            { q: "Why does a record change not reach some users right away?", a: "Clients and resolvers cache answers for the record's TTL. Until it expires they don't ask again." },
            { q: "What's the difference between a refused and a timed-out DNS lookup?", a: "Refused: the host answered with an ICMP port unreachable, so it's up but no DNS service listens. Timed out: nothing came back at all: wrong address, host down or a filter." },
          ]}
        />
      </GuideSection>

      <GuideSection id="dhd-practice" eyebrow="Master it" title="Practice in the DHCP & DNS Lab" tone="cyan">
        <ChecklistCard
          tone="cyan"
          title="In the lab you will"
          mark="→"
          items={["Watch a laptop's broadcast, the relay and the four DHCP messages, capture by capture", "Read the lease on the laptop and the log on the server", "Resolve a name, then watch the cache take over", "Build the scope, the relay and the zone yourself", "Solve the six tickets from evidence on every device, and prove each fix"]}
        />
        <LabBridge label="Open the DHCP & DNS Lab">Same network, your own copy. Nothing you do there changes your lesson progress.</LabBridge>
      </GuideSection>
    </div>
  );
}
