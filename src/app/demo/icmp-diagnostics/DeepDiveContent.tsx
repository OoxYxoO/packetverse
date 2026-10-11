import type { ReactNode } from "react";
import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DiagramFrame, DiagramSvg, DNode, DPill, FailureSignatures, FieldTable, FlowSteps, GuideSection, Misconceptions, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { DFieldRow, DTable } from "@/components/lesson/FundamentalsGuideSvg";
import { ExplainIt, KnowledgeQuiz, PracticeBridge, type KnowledgeQuestion } from "@/components/lesson/GuideInteractive";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import { CliPanel, FailureWalk, pickLines, runGuideCli, type GuideCliRun } from "@/components/lesson/GuideCli";
import type { CliVendor } from "@/lib/cli/types";
import { BIG_DATA, FAULT_MTU, FIXED_DATA, IC_ADDR, INITIAL_TTL } from "@/lib/sim-engine/scenarios/icmpDiagnostics";
import { createIcNet, icApply, icRun, type IcAction, type IcDev, type IcState, type IcTicketId } from "@/lib/sim-engine/scenarios/icmpNet";
import { icHostSet, icRouterSets, type IcCliApi } from "./icmp-lab/icCli";

/**
 * ICMP DEEP DIVE — the complete ICMP course, taught on the lesson's network (HOST-A → R1 → R2 → HOST-B). Every CLI
 * sample is printed by the ICMP Lab's own terminals (Linux hosts, Cisco IOS / Junos routers) run against the lab's model.
 * Progression: Foundation → Messages → Echo → TTL and traceroute → Unreachable → Size → Operations → Troubleshooting →
 * Beyond this lesson → Master it.
 */
const G = { foundation: "Foundation", msgs: "The messages", echo: "Echo and ping", ttl: "TTL and traceroute", unr: "Unreachable", size: "Size, MTU and DF", ops: "Operations", trouble: "Troubleshooting", beyond: "Beyond this lesson", master: "Master it" };

export const IC_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "icd-why", label: "Why ICMP exists", group: G.foundation },
  { id: "icd-position", label: "Where ICMP sits", group: G.foundation },
  { id: "icd-types", label: "Message types", group: G.msgs },
  { id: "icd-query", label: "Queries vs errors", group: G.msgs },
  { id: "icd-errors", label: "Error message layout", group: G.msgs },
  { id: "icd-rules", label: "Error-message rules", group: G.msgs },
  { id: "icd-who", label: "Who generates what", group: G.msgs },
  { id: "icd-echo", label: "Echo fields and matching", group: G.echo },
  { id: "icd-proves", label: "What a ping proves", group: G.echo },
  { id: "icd-ttlread", label: "Reading the reply's TTL", group: G.echo },
  { id: "icd-ttl", label: "Time Exceeded", group: G.ttl },
  { id: "icd-algo", label: "The traceroute algorithm", group: G.ttl },
  { id: "icd-trace", label: "Traceroute variants", group: G.ttl },
  { id: "icd-traceread", label: "Reading a traceroute", group: G.ttl },
  { id: "icd-unreach", label: "Unreachable codes", group: G.unr },
  { id: "icd-mtu", label: "IP MTU vs frame", group: G.size },
  { id: "icd-df", label: "DF and fragmentation", group: G.size },
  { id: "icd-pmtud", label: "The PMTUD loop", group: G.size },
  { id: "icd-blackhole", label: "Black holes and MSS", group: G.size },
  { id: "icd-tools", label: "Ping and traceroute on each OS", group: G.ops },
  { id: "icd-routers", label: "ICMP on the routers", group: G.ops },
  { id: "icd-signatures", label: "Failure signatures", group: G.trouble },
  { id: "icd-workflow", label: "Troubleshooting workflow", group: G.trouble },
  { id: "icd-faults", label: "The six tickets, step by step", group: G.trouble },
  { id: "icd-prove", label: "Proving a repair", group: G.trouble },
  { id: "icd-beyond", label: "Redirects, ICMPv6, security", group: G.beyond },
  { id: "icd-myths", label: "Common misconceptions", group: G.master },
  { id: "icd-quiz", label: "Knowledge check", group: G.master },
  { id: "icd-explain", label: "Can you explain it?", group: G.master },
  { id: "icd-practice", label: "Practice in the ICMP Lab", group: G.master },
];

// ------------------------------------------------------------------ the ICMP Lab's model and terminals

const A = IC_ADDR["HOST-A"];
const B = IC_ADDR["HOST-B"];
function cli(s: IcState, dev: IcDev, vendor: CliVendor, command: string): GuideCliRun {
  const r = dev === "R1" || dev === "R2" ? dev : "R1";
  const api: IcCliApi = { view: s, act: (a) => icApply(s, a), cisco: { kind: "exec" }, setCisco: () => undefined, junosEdit: false, setJunosEdit: () => undefined, cand: s.cfg[r], setCand: () => undefined, hist: [{ cfg: s.cfg[r], at: 0, by: "root" }], commit: () => undefined };
  return runGuideCli(dev === "R1" || dev === "R2" ? icRouterSets(api, dev)[vendor] : icHostSet(api, dev), command);
}
const only = (r: GuideCliRun, match: RegExp): GuideCliRun => ({ ...r, output: pickLines(r.output, match) });
const PING = /PING|bytes from|From|transmitted/;
const HEALTHY = createIcNet();
const ticket = (id: IcTicketId, ...after: IcAction[]) => icRun(icApply(createIcNet(), { type: "ticket", id }), ...after);
const T_BLACK = ticket("blackhole", { type: "curl", file: "big" });
const T_DOWN = ticket("host-down");
const T_RETURN = ticket("return");
const T_FW = ticket("firewall");
const T_LOOP = ticket("loop");
const T_HIDDEN = ticket("hidden-hop", { type: "trace", dev: "HOST-A", dst: B });

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
const ICMP = "#f472b6";

function TypesDiagram() {
  return (
    <DiagramSvg h={200} label="Common ICMPv4 types: 0 Echo Reply, 3 Destination Unreachable with codes 0 net, 1 host, 3 port, 4 fragmentation needed, 8 Echo Request, 11 Time Exceeded with code 0 TTL in transit and 1 reassembly">
      <DTable
        x={20}
        y={10}
        title="Common ICMPv4 Type / Code"
        cols={[
          { label: "TYPE", w: 60 },
          { label: "CODE", w: 60 },
          { label: "MEANING", w: 300 },
          { label: "KIND", w: 90 },
        ]}
        rows={[
          ["0", "0", "Echo Reply", "query"],
          ["8", "0", "Echo Request", "query"],
          ["3", "0/1/3", "Net / Host / Port Unreachable", "error"],
          ["3", "4", "Fragmentation Needed and DF set", "error"],
          ["11", "0", "TTL exceeded in transit", "error"],
          ["11", "1", "Fragment reassembly time exceeded", "error"],
        ]}
        highlight={{ row: 3, color: D.warning }}
      />
    </DiagramSvg>
  );
}

function ErrorLayoutDiagram() {
  return (
    <DiagramSvg h={170} label="An ICMP error message: new IPv4 header, ICMP Type, Code, Checksum, 4 bytes unused or next-hop MTU, then the original datagram's IPv4 header and the first 8 bytes of its payload">
      <DFieldRow
        x={20}
        y={30}
        h={44}
        fields={[
          { label: "IPv4", sub: "router → source", w: 110, color: D.ip },
          { label: "Type·Code", sub: "11/0 or 3/4", w: 90, color: ICMP, strong: true },
          { label: "Checksum", w: 70, color: ICMP },
          { label: "unused / MTU", sub: "4 B", w: 90, color: ICMP },
          { label: "Original IPv4 hdr", sub: "20 B", w: 120, color: D.warning, strong: true },
          { label: "First 8 B", sub: "Echo id/seq", w: 100, color: D.warning },
        ]}
      />
      <text x={20} y={104} fill={D.text} fontSize={10.5}>
        The quoted original header + 8 bytes let the sender match the error to the packet that caused it.
      </text>
      <text x={20} y={124} fill={D.muted} fontSize={10}>
        For an Echo, the 8 bytes contain Type, Code, Checksum, Identifier and Sequence. For UDP or TCP, they include the ports.
      </text>
    </DiagramSvg>
  );
}

function WhoDiagram() {
  return (
    <DiagramSvg h={190} label="Hosts answer Echo Requests addressed to them; routers generate Time Exceeded, Fragmentation Needed and network or host unreachable while forwarding; a destination host generates port unreachable">
      <DNode x={140} y={50} label="Router (forwarding)" accent={D.ip} w={200} />
      <DNode x={480} y={50} label="Destination host" accent={D.cyan} w={200} />
      {["11/0 Time Exceeded", "3/4 Frag. Needed", "3/0, 3/1 Net/Host Unr."].map((t, i) => (
        <DPill key={t} x={140} y={100 + i * 30} text={t} color={D.warning} w={190} />
      ))}
      {["0/0 Echo Reply", "3/3 Port Unreachable"].map((t, i) => (
        <DPill key={t} x={480} y={100 + i * 30} text={t} color={D.success} w={190} />
      ))}
    </DiagramSvg>
  );
}

function TraceVariantsDiagram() {
  return (
    <DiagramSvg h={170} label="Traceroute variants: ICMP Echo probes end with an Echo Reply; UDP probes to high ports end with Port Unreachable; TCP SYN probes end with SYN-ACK or RST; all use rising TTL and Time Exceeded for intermediate hops">
      <DTable
        x={20}
        y={10}
        title="Same trick, different probes"
        cols={[
          { label: "PROBE", w: 140 },
          { label: "INTERMEDIATE HOP", w: 170 },
          { label: "DESTINATION REACHED", w: 250 },
        ]}
        rows={[
          ["ICMP Echo (this lesson)", "11/0 Time Exceeded", "0/0 Echo Reply"],
          ["UDP to high ports", "11/0 Time Exceeded", "3/3 Port Unreachable"],
          ["TCP SYN", "11/0 Time Exceeded", "SYN-ACK or RST"],
        ]}
        highlight={{ row: 0, color: ICMP }}
      />
    </DiagramSvg>
  );
}

function PmtudLoopDiagram() {
  return (
    <DiagramSvg h={200} label="Path MTU Discovery: the sender sends with DF, receives 3/4 with a next-hop MTU, lowers its path MTU estimate, and retries until packets pass">
      <DNode x={110} y={40} label="Send with DF" accent={D.cyan} w={150} />
      <DNode x={320} y={40} label="Router: too big?" accent={D.ip} w={150} />
      <DNode x={530} y={40} label="Delivered" accent={D.success} w={130} />
      <DNode x={320} y={150} label="3/4 + next-hop MTU" accent={D.warning} w={180} />
      <DNode x={110} y={150} label="Lower path MTU" accent={D.violet} w={150} />
      <DArrow x1={186} y1={40} x2={244} y2={40} color={D.muted} />
      <DArrow x1={396} y1={40} x2={464} y2={40} color={D.success} label="fits" />
      <DArrow x1={320} y1={62} x2={320} y2={128} color={D.warning} />
      <text x={330} y={100} fill={D.warning} fontSize={10} fontWeight={700}>
        too big
      </text>
      <DArrow x1={229} y1={150} x2={186} y2={150} color={D.warning} />
      <DArrow x1={110} y1={128} x2={110} y2={62} color={D.violet} />
      <text x={20} y={194} fill={D.muted} fontSize={10}>
        If ICMP is filtered, this loop breaks: a &quot;PMTU black hole&quot;.
      </text>
    </DiagramSvg>
  );
}

function MtuVsFrameDiagram() {
  return (
    <DiagramSvg h={150} label="An Ethernet frame carrying a 1400-byte IPv4 packet: 14-byte Ethernet header, 1400-byte IPv4 packet counted by the IP MTU, 4-byte FCS outside it">
      <DFieldRow x={20} y={40} h={40} fields={[{ label: "Eth 14 B", w: 80 }, { label: "IPv4 packet 1400 B (the IP MTU counts this)", w: 440, color: D.ip, strong: true }, { label: "FCS 4", w: 60 }]} />
      <text x={20} y={110} fill={D.muted} fontSize={10}>
        IP MTU 1400 means 1400 bytes of IPv4 (header + ICMP + data). The Ethernet header and FCS are extra.
      </text>
    </DiagramSvg>
  );
}

// ------------------------------------------------------------------ knowledge check

const QUIZ: KnowledgeQuestion[] = [
  { id: "q1", prompt: `HOST-A's ping to ${B} gets replies with ttl=62. What can you conclude?`, options: [{ id: "a", label: "Both directions work for small ICMP packets, across two routers" }, { id: "b", label: "Every application on HOST-B works" }, { id: "c", label: "The path MTU is 1500" }], correctId: "a", explanation: "A reply needs the request to arrive and the answer to come back. 64 − 62 = 2 routers. It proves nothing about ports, applications or large packets." },
  { id: "q2", prompt: `Ping prints "From 203.0.113.2 Destination Host Unreachable". Where do you look?`, options: [{ id: "a", label: "HOST-B and its LAN: R2 got the packet but nobody answered its ARP" }, { id: "b", label: "R1's routing table" }, { id: "c", label: "HOST-A's gateway" }], correctId: "a", explanation: "The source is R2, the last router. Host Unreachable means R2 had a route, tried to deliver on its LAN, and nobody answered ARP for that address: the host is off, unplugged or misaddressed." },
  { id: "q3", prompt: "Traceroute shows R1, then * * * at hop 2, then HOST-B at hop 3. The app works. Most likely?", options: [{ id: "a", label: "Hop 2 doesn't send (or something filters) Time Exceeded; traffic is fine" }, { id: "b", label: "R2 is down" }, { id: "c", label: "A routing loop" }], correctId: "a", explanation: "Hop 3 answered, so packets crossed hop 2. A silent hop only means its Time Exceeded didn't come back: filtered or rate-limited." },
  { id: "q4", prompt: "Ping prints Time to live exceeded, and traceroute alternates 203.0.113.2, 203.0.113.1, 203.0.113.2 … What is happening?", options: [{ id: "a", label: "R1 and R2 send the packet back and forth until its TTL runs out" }, { id: "b", label: "The TTL on HOST-A is set too low" }, { id: "c", label: "HOST-B is overloaded" }], correctId: "a", explanation: "A loop: each router's best route points at the other. The TTL is exactly what stops the packet from circling for ever." },
  { id: "q5", prompt: `ping -s ${BIG_DATA} -M do fails with "Frag needed and DF set (mtu = ${FAULT_MTU})", ping -s ${FIXED_DATA} -M do works. What is the path MTU?`, options: [{ id: "a", label: String(FAULT_MTU) }, { id: "b", label: String(FIXED_DATA) }, { id: "c", label: "1500" }], correctId: "a", explanation: `The MTU counts the whole IPv4 packet: 20 + 8 + ${FIXED_DATA} = ${FAULT_MTU}. The router even said it in the message.` },
  { id: "q6", prompt: "Small web pages load, big downloads hang at 0 bytes, ping works. Which one change fixes it at the root?", options: [{ id: "a", label: "Let ICMP 3/4 reach the server sending the big packets" }, { id: "b", label: "Block all ICMP to be safe" }, { id: "c", label: "Lower HOST-A's TTL" }], correctId: "a", explanation: "The server's packets are too big for one link, and it never hears the 3/4 that would make it shrink them. Allowing that message restores Path MTU Discovery." },
];

// ------------------------------------------------------------------ content

export function IcmpDeepDiveContent() {
  return (
    <div className="space-y-12">
      {/* ------------------------------------------------------------ Foundation */}
      <GuideSection id="icd-why" eyebrow="Foundation" title="Why ICMP exists" tone="violet">
        <p>
          IP delivers packets on a best-effort basis: a router that can&apos;t forward a packet simply drops it. Without feedback, the sender would only ever see silence. ICMP (Internet Control Message Protocol, RFC 792) is the feedback channel: when a router or host drops a packet for a reason it can name, it tells the sender. The same protocol also carries tests, so a person can ask the network a question on purpose.
        </p>
        <CompareCards
          items={[
            { title: "Without ICMP", tone: "warning", tag: "silence", points: ["A dropped packet just never arrives", "The sender can only wait and retry", "Nobody knows where, or why"] },
            { title: "With ICMP", tone: "success", tag: "a postcard back", points: ["The dropping device reports, from its own address", "A type and code say why", "Ping and traceroute ask on purpose"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="icd-position" eyebrow="Foundation" title="Where ICMP sits" tone="violet">
        <p>
          ICMP is part of IP itself. Its messages travel inside ordinary IPv4 packets with Protocol 1, but ICMP is not a transport protocol: there are no ports and no connections. That is why a firewall rule that allows &quot;TCP 443&quot; says nothing about ICMP, and why ping can work while a web server is down (or the other way round).
        </p>
        <FieldTable
          title="What the IPv4 Protocol field says comes next"
          columns={["Protocol", "Carries", "Has ports?"]}
          rows={[
            ["1", "ICMP: errors and tests", "no"],
            ["6", "TCP", "yes"],
            ["17", "UDP", "yes"],
          ]}
        />
      </GuideSection>

      {/* ------------------------------------------------------------ The messages */}
      <GuideSection id="icd-types" eyebrow="RFC 792" title="ICMP message types" tone="violet">
        <DiagramFrame caption="Queries (Echo) and errors (Unreachable, Time Exceeded). The type says the family, the code the detail.">
          <TypesDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="icd-query" eyebrow="Two families" title="Queries and errors" tone="cyan">
        <CompareCards
          items={[
            { title: "Queries", tone: "cyan", tag: "asked for", points: ["Echo Request (8) and Echo Reply (0)", "Sent on purpose by a tool, answered by the target", "Carry an Identifier and Sequence to match pairs"] },
            { title: "Errors", tone: "warning", tag: "unasked", points: ["Time Exceeded (11), Destination Unreachable (3)", "Sent by a device that dropped someone else's packet", "Quote the start of the dropped packet"] },
          ]}
        />
        <p>The distinction matters for troubleshooting: a missing Echo Reply is a test that failed; an error message is the network volunteering evidence about a real packet.</p>
      </GuideSection>

      <GuideSection id="icd-errors" eyebrow="Anatomy" title="What an ICMP error carries" tone="warning">
        <DiagramFrame caption="Errors quote the original packet so the sender can tell which packet failed.">
          <ErrorLayoutDiagram />
        </DiagramFrame>
        <p>The quote is how ping prints &quot;icmp_seq=1&quot; next to an error, and how a TCP stack knows which connection a Fragmentation Needed belongs to: the first 8 bytes of a TCP or UDP header are its ports.</p>
      </GuideSection>

      <GuideSection id="icd-rules" eyebrow="RFC 1122 / 1812" title="Error-message rules" tone="danger">
        <ChecklistCard
          tone="warning"
          title="An ICMP error is never sent about…"
          mark="✕"
          items={["Another ICMP error message (prevents error storms)", "A packet sent to a broadcast or multicast address", "A packet with a source address that isn't a single host", "Any fragment but the first"]}
        />
        <Callout tone="cyan" title="Rate limiting">
          Routers commonly rate-limit ICMP generation, and many protect their CPU by generating errors slowly. A missing Time Exceeded (&quot;* * *&quot; in traceroute) does not prove the hop is down.
        </Callout>
      </GuideSection>

      <GuideSection id="icd-who" eyebrow="Origins" title="Router-generated vs host-generated ICMP" tone="ip">
        <DiagramFrame caption="Who sends a message tells you where the problem was seen.">
          <WhoDiagram />
        </DiagramFrame>
      </GuideSection>

      {/* ------------------------------------------------------------ Echo and ping */}
      <GuideSection id="icd-echo" eyebrow="Echo" title="Echo fields and how ping matches replies" tone="violet">
        <p>
          An Echo Request carries an <Strong>Identifier</Strong> (usually tied to the ping process) and a <Strong>Sequence number</Strong> (1, 2, 3 … per probe), plus data. The target copies all three into its Echo Reply. Ping matches each reply to its request by those numbers and measures the time between them; a reply that matches nothing is ignored.
        </p>
        <CliPanel run={only(cli(HEALTHY, "HOST-A", "cisco", `ping -c 2 ${B}`), PING)} />
        <p className="text-sm text-pv-text-muted">56 data bytes + 8 (ICMP) + 20 (IPv4) = 84: the &quot;56(84)&quot; in the first line. The reply shows 64 bytes: ICMP header plus data.</p>
      </GuideSection>

      <GuideSection id="icd-proves" eyebrow="Echo" title="What a ping proves, and what it doesn't" tone="success">
        <CompareCards
          items={[
            { title: "A reply proves", tone: "success", tag: "yes", points: ["The target is up and its IP stack answers", "Routing works in both directions", "Small packets cross every link"] },
            { title: "A reply doesn't prove", tone: "warning", tag: "no", points: ["That a TCP or UDP service is listening", "That large packets fit the path", "That the path is the same both ways"] },
            { title: "No reply doesn't prove", tone: "danger", tag: "careful", points: ["That the target is down: Echo may be filtered", "Which direction failed", "That other traffic fails too"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="icd-ttlread" eyebrow="Echo" title="Reading the reply's TTL" tone="cyan">
        <p>A reply starts with its sender&apos;s default TTL and loses one per router. Knowing the usual defaults turns the received TTL into a hop count:</p>
        <FieldTable
          title="Common starting TTLs"
          columns={["Sender", "Starts at", "Here"]}
          rows={[
            ["Linux, macOS", "64", `HOST-B → HOST-A: ${INITIAL_TTL} − 2 routers = ${INITIAL_TTL - 2}`],
            ["Windows", "128", "128 − hops"],
            ["Cisco IOS (packets it originates)", "255", "—"],
          ]}
        />
        <p className="text-sm text-pv-text-muted">It is a hint, not proof: the forward and return paths can differ, and any sender can change its default.</p>
      </GuideSection>

      {/* ------------------------------------------------------------ TTL and traceroute */}
      <GuideSection id="icd-ttl" eyebrow="Time Exceeded" title="Time Exceeded: the TTL's safety net" tone="warning">
        <p>
          Every router decrements the TTL, and a packet whose TTL would reach zero is dropped. The router sends Time Exceeded (11/0) to the source, from the address of the interface the packet came in on. This exists to kill packets caught in routing loops; traceroute borrows it.
        </p>
        <CliPanel run={only(cli(HEALTHY, "HOST-A", "cisco", `ping -c 1 -t 1 ${B}`), PING)} />
        <p className="text-sm text-pv-text-muted">Code 1 (fragment reassembly time exceeded) is the other Time Exceeded: a host gave up waiting for the missing fragments of a packet.</p>
      </GuideSection>

      <GuideSection id="icd-algo" eyebrow="Traceroute" title="The traceroute algorithm" tone="cyan">
        <FlowSteps
          steps={[
            { title: "TTL 1", body: "Three probes leave with TTL 1. The first router drops them and answers Time Exceeded: hop 1 is that router's address.", tone: "violet" },
            { title: "TTL 2, 3 …", body: "Each round goes one router further. Every hop answers from its own address, with the round-trip time of each probe.", tone: "cyan" },
            { title: "The destination", body: "A probe finally reaches the target, which answers as a destination (Echo Reply, or Port Unreachable for UDP probes). Traceroute stops.", tone: "success" },
          ]}
        />
        <CliPanel run={cli(HEALTHY, "HOST-A", "cisco", `traceroute ${B}`)} />
        <p className="text-sm text-pv-text-muted">Hop 2 is R2&apos;s transit address (203.0.113.2), the interface the probe entered R2 on, not R2&apos;s LAN address. A traceroute shows the inbound side of each router.</p>
      </GuideSection>

      <GuideSection id="icd-trace" eyebrow="Tools" title="Traceroute variants" tone="violet">
        <DiagramFrame caption="Windows tracert uses ICMP Echo; classic Unix traceroute uses UDP; tcptraceroute uses TCP.">
          <TraceVariantsDiagram />
        </DiagramFrame>
        <p>The probe type matters when something filters: a firewall that drops Echo Requests hides the destination from <Mono>traceroute -I</Mono> but not from UDP probes. On this network the UDP traceroute reaches HOST-B even when HOST-B drops pings (fault 4 below).</p>
      </GuideSection>

      <GuideSection id="icd-traceread" eyebrow="Tools" title="Reading a traceroute" tone="warning">
        <FieldTable
          title="Markers and patterns"
          columns={["You see", "It means", "It doesn't mean"]}
          rows={[
            ["* * * on one hop, later hops answer", "That hop didn't send Time Exceeded (filtered, rate-limited)", "That the hop is down"],
            ["* * * from a hop to the end", "Probes, or the answers, stop there: often the way back", "That the next router is down"],
            ["!H, !N, !P after a time", "Host, network or protocol unreachable from that hop", "—"],
            ["Two addresses alternating", "A routing loop between those routers", "Load balancing (that alternates per probe, not per hop)"],
            ["A big time jump at one hop", "A slow link, or a router answering slowly on its CPU", "Congestion, if later hops are fast again"],
          ]}
        />
      </GuideSection>

      {/* ------------------------------------------------------------ Unreachable */}
      <GuideSection id="icd-unreach" eyebrow="Type 3" title="Destination Unreachable, code by code" tone="danger">
        <FieldTable
          title="The codes you will meet"
          columns={["Code", "Name", "Sent by", "When"]}
          rows={[
            ["0", "Net Unreachable", "a router", "No route matches the destination"],
            ["1", "Host Unreachable", "the last router", "The network is connected, but ARP for the address gets no answer"],
            ["3", "Port Unreachable", "the destination", "A UDP packet arrived for a port nobody listens on"],
            ["4", "Fragmentation Needed", "a router", "DF set and the packet is bigger than the next link's MTU"],
            ["13", "Administratively Prohibited", "a router or firewall", "A filter dropped it and chose to say so"],
          ]}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <CliPanel run={only(cli(HEALTHY, "HOST-A", "cisco", "ping -c 1 10.20.30.40"), PING)} />
          <CliPanel run={only(cli(HEALTHY, "HOST-A", "cisco", "ping -c 1 198.51.100.99"), PING)} />
        </div>
        <p className="text-sm text-pv-text-muted">Same symptom for the user (&quot;unreachable&quot;), two different devices and reasons: R1 had no route for 10.20.30.40; R2 had a route for 198.51.100.99 but found nobody there. A TCP connection to a closed port gets a TCP reset instead: that is the TCP & UDP lesson.</p>
      </GuideSection>

      {/* ------------------------------------------------------------ Size */}
      <GuideSection id="icd-mtu" eyebrow="Sizes" title="IP MTU vs Ethernet frame" tone="cyan">
        <DiagramFrame caption="Keep the layers apart when doing MTU math.">
          <MtuVsFrameDiagram />
        </DiagramFrame>
        <p>Cisco calls it <Mono>ip mtu</Mono>, Junos <Mono>family inet mtu</Mono>: both count the IPv4 packet. Junos also shows the physical MTU (1514 on Ethernet), which includes the 14-byte Ethernet header.</p>
      </GuideSection>

      <GuideSection id="icd-df" eyebrow="RFC 791" title="DF and fragmentation" tone="warning">
        <p>
          A router facing a packet bigger than the next link&apos;s MTU has two options. If the packet&apos;s DF (Don&apos;t Fragment) flag is clear, it may split it into fragments that the destination reassembles. If DF is set, it must drop it and send Fragmentation Needed (3/4) with the next-hop MTU. On the 1400-byte link of the incident, the same 1500-byte ping behaves both ways:
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <CliPanel run={only(cli(T_BLACK, "HOST-A", "cisco", `ping -c 1 -s ${BIG_DATA} -M do ${B}`), PING)} />
          <CliPanel run={only(cli(T_BLACK, "HOST-A", "cisco", `ping -c 1 -s ${BIG_DATA} -M dont ${B}`), PING)} />
        </div>
        <p className="text-sm text-pv-text-muted">Fragmentation works, but it costs: more packets, reassembly at the destination, and a lost fragment loses the whole packet. That is why TCP stacks set DF and let Path MTU Discovery pick the size instead.</p>
      </GuideSection>

      <GuideSection id="icd-pmtud" eyebrow="RFC 1191" title="The Path MTU Discovery loop" tone="success">
        <DiagramFrame caption="DF + Fragmentation Needed = self-tuning packet size.">
          <PmtudLoopDiagram />
        </DiagramFrame>
        <p>The sender caches the learned MTU per destination (Linux shows it in <Mono>ip route get</Mono> as <Mono>mtu {FAULT_MTU}</Mono>) and forgets it after a few minutes, so it notices when the path improves.</p>
      </GuideSection>

      <GuideSection id="icd-blackhole" eyebrow="Failure mode" title="Black holes, and the MSS workaround" tone="danger">
        <p>
          If the 3/4 message never reaches the sender, the loop never closes: the sender keeps sending packets that are too big, and they vanish without an error. Small exchanges (handshakes, pings, small pages) still work, which makes it look like an application problem. That is a <Strong>PMTU black hole</Strong>.
        </p>
        <CompareCards
          items={[
            { title: "The real fix", tone: "success", tag: "let 3/4 through", points: ["Never filter ICMP type 3 (code 4 especially) and type 11", "Filtering Echo is a policy choice; filtering 3/4 breaks TCP"] },
            { title: "The common workaround", tone: "warning", tag: "MSS clamping", points: ["A router rewrites the TCP MSS in SYN packets", "Both ends then send segments that fit, so no 3/4 is needed", "Works for TCP only; UDP still needs PMTUD or small packets"] },
          ]}
        />
      </GuideSection>

      {/* ------------------------------------------------------------ Operations */}
      <GuideSection id="icd-tools" eyebrow="Operations" title="Ping and traceroute on each system" tone="cyan">
        <FieldTable
          title="The same questions, four syntaxes"
          columns={["Question", "Linux", "Windows", "Cisco IOS", "Junos"]}
          rows={[
            ["N probes", <Mono key="1">ping -c N</Mono>, <Mono key="2">ping -n N</Mono>, <Mono key="3">ping X repeat N</Mono>, <Mono key="4">ping X count N</Mono>],
            ["Size", <Mono key="5">-s DATA</Mono>, <Mono key="6">-l DATA</Mono>, <Mono key="7">size TOTAL</Mono>, <Mono key="8">size DATA</Mono>],
            ["Set DF", <Mono key="9">-M do</Mono>, <Mono key="10">-f</Mono>, <Mono key="11">df-bit</Mono>, <Mono key="12">do-not-fragment</Mono>],
            ["Set TTL", <Mono key="13">-t N</Mono>, <Mono key="14">-i N</Mono>, "—", <Mono key="15">ttl N</Mono>],
            ["Trace", <Mono key="16">traceroute [-I]</Mono>, <Mono key="17">tracert</Mono>, <Mono key="18">traceroute X</Mono>, <Mono key="19">traceroute X</Mono>],
          ]}
        />
        <Callout tone="warning" title="Size means different things" icon="!">
          Linux, Windows and Junos count the ICMP <em>data</em> (1472 for a 1500-byte packet); Cisco IOS counts the whole IPv4 datagram (1500). Mixing them up is the classic off-by-28 mistake.
        </Callout>
      </GuideSection>

      <GuideSection id="icd-routers" eyebrow="Operations" title="ICMP on the routers" tone="cyan">
        <p>Routers count every ICMP message they send and receive, and show the MTU and filters of each interface. After the black-hole download attempt, R2 has sent exactly one unreachable (the 3/4 to HOST-B):</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <CliPanel run={only(cli(T_BLACK, "R2", "cisco", "show ip traffic"), /ICMP|Sent:|unreachable,/)} />
          <CliPanel run={cli(T_BLACK, "R2", "juniper", "show system statistics icmp")} />
        </div>
        <CliPanel run={cli(T_BLACK, "R1", "cisco", "show ip interface GigabitEthernet0/1")} />
        <p className="text-sm text-pv-text-muted">&quot;ICMP unreachables are always sent&quot;: IOS can be told not to send them (<Mono>no ip unreachables</Mono>), but Fragmentation Needed is still sent, because turning it off would break PMTUD for everyone.</p>
      </GuideSection>

      {/* ------------------------------------------------------------ Troubleshooting */}
      <GuideSection id="icd-signatures" eyebrow="Troubleshooting" title="Failure signatures" tone="danger">
        <FailureSignatures
          items={[
            { tag: "!H", title: "Host Unreachable from the last router", tone: "danger", points: ["Routing to the LAN works", "Nobody answers ARP for the address", "→ the host is off, unplugged or misaddressed"] },
            { tag: "!N", title: "Net Unreachable from a router", tone: "warning", points: ["That router has no route", "→ its routing table, or an interface down"] },
            { tag: "TTL", title: "Time to live exceeded for a reachable host", tone: "danger", points: ["traceroute alternates between two routers", "→ a routing loop"] },
            { tag: "silent", title: "Only the first hops answer, then nothing", tone: "warning", points: ["No error at all", "→ the way back (a missing return route), or a filter"] },
            { tag: "size", title: "Small works, large hangs", tone: "violet", points: ["Ping and handshakes fine, transfers stall", "→ path MTU with blocked 3/4: a black hole"] },
            { tag: "ping-only", title: "Ping fails, everything else works", tone: "cyan", points: ["UDP traceroute and the app reach the host", "→ Echo filtered on the host"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="icd-workflow" eyebrow="Workflow" title="Diagnosing with ICMP" tone="danger">
        <TroubleshootingFlow
          steps={[
            { question: "Reachability: is there an Echo Reply?", look: "A reply settles both directions for small packets. No reply: read what came back instead." },
            { question: "Did any ICMP error come back?", look: "Its source names the device, its type/code the reason. Start the investigation on that device." },
            { question: "Where does the path stop?", look: "traceroute: where Time Exceeded stops, and whether later hops answer (a quiet hop is not a dead hop)." },
            { question: "Is it the way back?", look: "Silence after the first hop often means the return route is missing: check the far routers' tables, or trace from the other end." },
            { question: "Is it size?", look: "Ping with DF and growing sizes. Does 3/4 appear, from whom, with which MTU? Does the big sender ever hear it?" },
            { question: "Is ICMP itself filtered?", look: "Compare ping, UDP traceroute and the application. Different answers point at a filter, not at routing." },
            { question: "Fix at the right place, then prove it", look: "Fix the route, the host, the filter or the size; then repeat the exact probe that failed." },
          ]}
        />
        <FieldTable
          title="Sizes used in this lesson"
          columns={["ICMP data", "IPv4 total", "vs MTU 1400"]}
          rows={[
            ["56", "84", "fits"],
            ["1372", "1400", "fits exactly"],
            ["1400", "1428", "too big"],
            ["1472", "1500", "too big"],
          ]}
        />
      </GuideSection>

      <GuideSection id="icd-faults" eyebrow="Troubleshooting" title="The six tickets, step by step" tone="danger">
        <p>Each fault below is one of the ICMP Lab&apos;s tickets, reproduced by the lab&apos;s own model; every output is what that device prints at that moment. The first is the lesson&apos;s incident, seen from the routers.</p>
        <FailureWalk
          title="1 · Big downloads hang: a PMTU black hole"
          normal={<>Every link carries 1500 bytes, and HOST-B&apos;s download leaves in full-size packets.</>}
          change={<>The R1–R2 circuit now carries {FAULT_MTU} bytes, and HOST-B drops ICMP type 3 code 4.</>}
          evidence={
            <>
              <p>R2 drops HOST-B&apos;s first 1500-byte packet and reports it; the report dies in HOST-B&apos;s firewall. R1&apos;s side shows the smaller MTU:</p>
              <CliPanel run={only(cli(T_BLACK, "R2", "cisco", "show ip traffic"), /Sent:/)} />
              <CliPanel run={cli(T_BLACK, "R1", "juniper", "show configuration interfaces ge-0/0/1")} />
              <CliPanel run={cli(T_BLACK, "HOST-B", "cisco", "sudo iptables -L INPUT -n --line-numbers")} />
            </>
          }
          next={<>Small works and large hangs: measure the path with DF pings, then ask who sends the big packets (here HOST-B) and whether that host can hear 3/4.</>}
          fix={<>On HOST-B: <Mono>sudo iptables -D INPUT 1</Mono> (or allow type 3 code 4). The 1400-byte circuit stays as it is.</>}
          proof={
            <>
              <p>The download completes, and HOST-B&apos;s route cache to HOST-A records the learned MTU:</p>
              <CliPanel run={cli(icRun(T_BLACK, { type: "cfg", cfg: { ...T_BLACK.cfg, "HOST-B": { ...T_BLACK.cfg["HOST-B"], input: [] } }, text: "fix" }, { type: "curl", file: "big" }), "HOST-B", "cisco", `ip route get ${A}`)} />
            </>
          }
        />
        <FailureWalk
          title="2 · HOST-B stopped responding"
          normal={<>HOST-B answers pings, and R2 resolves it by ARP on its LAN.</>}
          change={<>HOST-B is switched off.</>}
          evidence={
            <>
              <p>R2 has a route to the LAN and tries to deliver, but nobody answers its ARP. It says so, and traceroute ends on R2 with !H:</p>
              <CliPanel run={only(cli(T_DOWN, "HOST-A", "cisco", `ping -c 2 ${B}`), PING)} />
              <CliPanel run={cli(T_DOWN, "HOST-A", "cisco", `traceroute ${B}`)} />
            </>
          }
          next={<>Host Unreachable from the last router: the path is fine up to the LAN. Look at the host and its link.</>}
          fix={<>Power HOST-B back on (or reconnect it).</>}
          proof={<>Ping answers with ttl=62, and traceroute ends at HOST-B again.</>}
        />
        <FailureWalk
          tone="warning"
          title="3 · Only R1 answers: no route back"
          normal={<>R2 has a static route to 192.0.2.0/24 via R1, so answers can come back.</>}
          change={<>R2&apos;s route to HOST-A&apos;s network is removed. R2 still reaches HOST-B and the transit link.</>}
          evidence={
            <>
              <p>Ping is silent: no reply, no error. Traceroute shows R1, then nothing: R2 and HOST-B do answer, but toward a network R2 can&apos;t reach. R2&apos;s table says why:</p>
              <CliPanel run={only(cli(T_RETURN, "HOST-A", "cisco", `traceroute -m 4 ${B}`), /./)} />
              <CliPanel run={only(cli(T_RETURN, "R2", "cisco", "show ip route"), /^[CLS]/)} />
            </>
          }
          next={<>Silence after a working hop is very often the way back. Check the far routers&apos; routes to the <em>source</em>, not only to the destination.</>}
          fix={<>Cisco <Mono>ip route 192.0.2.0 255.255.255.0 203.0.113.1</Mono> · Junos <Mono>set routing-options static route 192.0.2.0/24 next-hop 203.0.113.1</Mono>, <Mono>commit</Mono>.</>}
          proof={<>Traceroute shows all three hops, and ping answers with ttl=62.</>}
        />
        <FailureWalk
          tone="warning"
          title="4 · Monitoring says HOST-B is down"
          normal={<>HOST-B answers Echo Requests and serves its web app.</>}
          change={<>HOST-B&apos;s firewall drops Echo Requests (type 8).</>}
          evidence={
            <>
              <p>Ping is silent, yet the UDP traceroute reaches HOST-B (it answers Port Unreachable, which isn&apos;t filtered), and the web page loads:</p>
              <CliPanel run={only(cli(T_FW, "HOST-A", "cisco", `ping -c 1 ${B}`), PING)} />
              <CliPanel run={cli(T_FW, "HOST-A", "cisco", `traceroute ${B}`)} />
              <CliPanel run={cli(T_FW, "HOST-B", "cisco", "sudo iptables -L INPUT -n --line-numbers")} />
            </>
          }
          next={<>When ping disagrees with everything else, test with a different probe before calling a host down.</>}
          fix={<>Allow Echo from the monitoring station (or delete the rule: <Mono>sudo iptables -D INPUT 1</Mono>), or monitor the service itself.</>}
          proof={<>Ping answers, and monitoring turns green; the app was never affected.</>}
        />
        <FailureWalk
          title="5 · Pings die of old age: a routing loop"
          normal={<>R2 delivers HOST-B&apos;s network from its connected LAN interface.</>}
          change={<>After maintenance R2&apos;s LAN interface is left shut, and a default route toward R1 was added. With the connected route gone, the default route now matches HOST-B&apos;s network, and R1&apos;s static route sends it straight back.</>}
          evidence={
            <>
              <p>Ping prints Time to live exceeded, and traceroute alternates between the two transit addresses:</p>
              <CliPanel run={only(cli(T_LOOP, "HOST-A", "cisco", `traceroute -m 6 ${B}`), /./)} />
              <CliPanel run={only(cli(T_LOOP, "R2", "cisco", "show ip interface brief"), /Interface|0\/0/)} />
              <CliPanel run={only(cli(T_LOOP, "R2", "cisco", "show ip route"), /^[CLS]|last resort/)} />
            </>
          }
          next={<>Two addresses alternating means two routers that each think the other is the way. Find the route that changed: here, a connected route that disappeared with its interface.</>}
          fix={<>Bring the interface back: Cisco <Mono>interface GigabitEthernet0/0</Mono>, <Mono>no shutdown</Mono> · Junos <Mono>delete interfaces ge-0/0/0 disable</Mono>, <Mono>commit</Mono>.</>}
          proof={<>R2 lists 198.51.100.0/24 as connected again, and traceroute ends at HOST-B in three hops.</>}
        />
        <FailureWalk
          tone="warning"
          title="6 · Traceroute shows a dead router"
          normal={<>Every hop answers Time Exceeded, so traceroute names R1 and R2.</>}
          change={<>R1&apos;s inbound filter on the transit link drops ICMP Time Exceeded. Everything else is permitted.</>}
          evidence={
            <>
              <p>Hop 2 is * * *, yet hop 3 (HOST-B) answers and the app works. R2&apos;s Time Exceeded messages die at R1&apos;s filter, and its counters show it:</p>
              <CliPanel run={cli(T_HIDDEN, "HOST-A", "cisco", `traceroute ${B}`)} />
              <CliPanel run={cli(T_HIDDEN, "R1", "cisco", "show access-lists")} />
            </>
          }
          next={<>A quiet hop with answering hops after it is never a dead router. Look for filters on the way back to the source.</>}
          fix={<>Cisco: in <Mono>ip access-list extended WAN-IN</Mono>, <Mono>no 10</Mono> · Junos <Mono>delete firewall family inet filter WAN-IN term block-ttl</Mono>, <Mono>commit</Mono>.</>}
          proof={<>Traceroute shows R2 at hop 2 again; the filter&apos;s deny counter stops growing.</>}
        />
        <LabBridge label="Troubleshoot them in the ICMP Lab">The six tickets, reported as users report them. Probe, follow the packets, read the routers, fix the real configuration and prove it.</LabBridge>
      </GuideSection>

      <GuideSection id="icd-prove" eyebrow="Troubleshooting" title="Proving an ICMP-diagnosed repair" tone="success">
        <ChecklistCard
          tone="success"
          title="The proof"
          mark="✓"
          items={[
            "Repeat the exact probe that failed (same tool, size, DF, source), after the change",
            "The message that pointed at the fault is gone, and the expected answer is back (Echo Reply, a full traceroute)",
            "The user's real traffic works too: a ping proves small ICMP, not the application",
            "Nothing you didn't mean to change moved: other hosts, other paths, the filters you kept",
          ]}
        />
      </GuideSection>

      {/* ------------------------------------------------------------ Beyond */}
      <GuideSection id="icd-beyond" eyebrow="Beyond this lesson" title="Redirects, ICMPv6 and ICMP security" tone="violet">
        <FieldTable
          title="Where ICMP goes next"
          columns={["Topic", "In short"]}
          rows={[
            ["Redirect (type 5)", "A router telling a host to use a better gateway on the same LAN. Usually disabled today: it lets a router rewrite a host's routing."],
            ["ICMPv6", "IPv6's ICMP does far more: Neighbor Discovery (instead of ARP), router advertisements, and Packet Too Big, which IPv6 routers must send because they never fragment."],
            ["Rate limits and CPU protection", "Routers generate ICMP in software; they limit it so a flood of expired packets can't overload them."],
            ["What to filter", "Echo is a policy choice. Never filter type 3 (especially code 4) or type 11 blindly: they keep TCP and diagnostics working."],
            ["Old attacks", "Smurf (broadcast Echo floods) and oversized pings are why broadcasts aren't answered and why stacks validate sizes."],
          ]}
        />
      </GuideSection>

      {/* ------------------------------------------------------------ Master it */}
      <GuideSection id="icd-myths" eyebrow="Master it" title="Common misconceptions" tone="warning">
        <Misconceptions
          items={[
            { myth: "If ping fails, the host is down.", correction: "Echo is often filtered. Try another probe (UDP traceroute, the application) before deciding." },
            { myth: "If ping works, the application works.", correction: "Ping proves IP reachability for small ICMP packets, nothing about TCP or UDP services." },
            { myth: "* * * in traceroute means that router is dead.", correction: "It means its Time Exceeded didn't come back. If later hops answer, packets crossed it." },
            { myth: "ICMP uses ports.", correction: "ICMP has types and codes, no ports. It rides directly in IPv4 with Protocol 1." },
            { myth: "Blocking all ICMP makes a network safer.", correction: "It breaks Path MTU Discovery and diagnostics. Filter Echo if you must, never 3/4 and 11." },
            { myth: "Traceroute shows the path the replies take.", correction: "It shows the forward path. Replies can come back another way." },
            { myth: "The TTL is a time in seconds.", correction: "It is a hop limit: every router subtracts one." },
            { myth: "The MTU includes the Ethernet header.", correction: "The IP MTU counts the IPv4 packet only. 1500 bytes of IPv4 ride in a 1518-byte frame." },
            { myth: "A Host Unreachable means the router can't reach the network.", correction: "That is Net Unreachable. Host Unreachable means the network is there and the host didn't answer ARP." },
          ]}
        />
      </GuideSection>

      <GuideSection id="icd-quiz" eyebrow="Master it" title="Knowledge check" tone="success">
        <KnowledgeQuiz questions={QUIZ} />
      </GuideSection>

      <GuideSection id="icd-explain" eyebrow="Master it" title="Can you explain it?" tone="success">
        <ExplainIt
          items={[
            { q: "How does traceroute learn the address of each router?", a: "It sends probes with TTL 1, 2, 3 … Each router that has to drop a probe because its TTL ran out sends Time Exceeded from its own address. The destination answers as a destination, which ends the trace." },
            { q: "Why can a ping fail while the web app on the same host works?", a: "Ping uses ICMP Echo, the app uses TCP. A host firewall can drop Echo Requests and still accept TCP. Different protocols, different rules." },
            { q: "Why does a blocked ICMP 3/4 break big transfers but not small ones?", a: "Small packets fit every link, so no router needs to report anything. Big packets with DF are dropped at the narrow link, and the only signal to shrink them is the 3/4 message. Blocked, the sender keeps sending packets that vanish." },
            { q: "What does the source address of an ICMP error tell you?", a: "Which device gave up on the packet: R1 for no route, the last router for an absent host, the destination for a closed UDP port. That is where to start looking." },
            { q: "Why is silence after the first hop often a return-path problem?", a: "Later hops may receive the probes and answer, but if they have no route back to the source, their answers never arrive. The trace looks like the path stops, when it's the way back that does." },
          ]}
        />
      </GuideSection>

      <GuideSection id="icd-practice" eyebrow="Master it" title="Practice in the ICMP Lab" tone="cyan">
        <ChecklistCard
          tone="cyan"
          title="In the lab you will"
          mark="→"
          items={["Send pings and follow the request and the reply at every interface", "Kill a probe at R1, then R2, with the TTL", "Trace with ICMP and with UDP probes, and see where they differ", "Trigger Net and Host Unreachable, and read who sent them", "Find a path MTU with DF pings and watch PMTUD work", "Solve the six tickets on Cisco or Junos routers, and prove each fix"]}
        />
        <LabBridge label="Open the ICMP Lab">Same network, your own copy. Nothing you do there changes your lesson progress.</LabBridge>
      </GuideSection>
    </div>
  );
}
