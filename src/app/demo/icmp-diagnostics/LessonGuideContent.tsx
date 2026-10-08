import { Callout, ChecklistCard, CompareCards, FailureSignatures, Misconceptions, DArrow, DIAGRAM as D, DiagramFrame, DiagramSvg, DLink, DNode, DPill, FlowSteps, Glossary, GuideSection, Mono, PathDivider, ProtocolStory, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { PresentationBridge } from "@/components/presentation/LessonPresentation";
import { PracticeBridge } from "@/components/lesson/GuideInteractive";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import { DFieldRow } from "@/components/lesson/FundamentalsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { BIG_DATA, ECHO_IDENTIFIER, FAULT_MTU, FIXED_DATA, IC_ADDR, INITIAL_TTL, PING_DATA } from "@/lib/sim-engine/scenarios/icmpDiagnostics";

export const IC_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "ic-mission", label: "The mission" },
  { id: "ic-story", label: "The whole story" },
  { id: "ic-proves", label: "What ping proves" },
  { id: "ic-unreach", label: "Unreachables" },
  { id: "ic-breaks", label: "When it breaks" },
  { id: "ic-silence", label: "Silence & the way back" },
  { id: "ic-method", label: "Fix → verify → prove" },
  { id: "ic-position", label: "ICMP inside IPv4" },
  { id: "ic-ping", label: "Ping and TTL" },
  { id: "ic-echo", label: "Identifier & sequence" },
  { id: "ic-trace", label: "Traceroute" },
  { id: "ic-pmtu", label: "MTU, DF and 3/4" },
  { id: "ic-fix", label: "The repair math" },
  { id: "ic-verify", label: "Verification" },
  { id: "ic-model", label: "Mental model" },
  { id: "ic-glossary", label: "Glossary" },
  { id: "ic-recap", label: "Recap" },
];

const ICMP = "#f472b6";

function PositionDiagram() {
  return (
    <DiagramSvg h={170} label="Frame layout: Ethernet header, IPv4 header with Protocol 1, ICMP header with Type, Code, Checksum, Identifier and Sequence, then data, then FCS. There is no TCP or UDP header.">
      <DFieldRow
        x={20}
        y={30}
        h={44}
        fields={[
          { label: "Ethernet", sub: "14 B", w: 90 },
          { label: "IPv4", sub: "Protocol = 1", w: 120, color: D.ip, strong: true },
          { label: "Type·Code", sub: "8/0", w: 90, color: ICMP, strong: true },
          { label: "Checksum", w: 80, color: ICMP },
          { label: "Id · Seq", sub: `${ECHO_IDENTIFIER} · 1`, w: 90, color: ICMP },
          { label: "Data", sub: `${PING_DATA} B`, w: 70, color: D.faint },
          { label: "FCS", w: 50 },
        ]}
      />
      <text x={20} y={104} fill={D.danger} fontSize={11} fontWeight={700}>
        ✕ no TCP header · ✕ no UDP header · ✕ no ports
      </text>
      <text x={20} y={126} fill={D.muted} fontSize={10}>
        The IPv4 Protocol field (1) is what tells the receiver an ICMP message follows.
      </text>
      <text x={20} y={146} fill={D.muted} fontSize={10}>
        IPv4 total length = 20 + 8 + {PING_DATA} = {20 + 8 + PING_DATA} bytes.
      </text>
    </DiagramSvg>
  );
}

function PingDiagram() {
  const xs = [70, 240, 410, 580];
  const names = ["HOST-A", "R1", "R2", "HOST-B"];
  return (
    <DiagramSvg h={220} label={`Echo Request TTL ${INITIAL_TTL} from HOST-A, 63 after R1, 62 after R2, arriving at HOST-B with 62; Echo Reply starts again at ${INITIAL_TTL} and arrives at HOST-A with 62`}>
      {names.map((n, i) => (
        <DNode key={n} x={xs[i]} y={110} label={n} accent={i === 0 || i === 3 ? D.cyan : D.ip} w={100} />
      ))}
      {[0, 1, 2].map((i) => (
        <DArrow key={`rq-${i}`} x1={xs[i] + 52} y1={96} x2={xs[i + 1] - 52} y2={96} color={ICMP} label={`TTL ${INITIAL_TTL - i}`} />
      ))}
      {[2, 1, 0].map((i) => (
        <DArrow key={`rp-${i}`} x1={xs[i + 1] - 52} y1={124} x2={xs[i] + 52} y2={124} color={D.success} label={`TTL ${INITIAL_TTL - (2 - i)}`} labelDy={18} />
      ))}
      <text x={20} y={30} fill={ICMP} fontSize={11} fontWeight={700}>
        Echo Request 8/0 →
      </text>
      <text x={20} y={190} fill={D.success} fontSize={11} fontWeight={700}>
        ← Echo Reply 0/0 (a new packet, TTL {INITIAL_TTL} again)
      </text>
      <text x={330} y={30} fill={D.muted} fontSize={10}>
        Routers decrement. Destinations don&apos;t.
      </text>
    </DiagramSvg>
  );
}

function EchoMatchDiagram() {
  return (
    <DiagramSvg h={160} label={`The Echo Reply copies the Identifier ${ECHO_IDENTIFIER}, the Sequence Number and the data from the Echo Request; only Type, checksum, addresses and TTL differ`}>
      <text x={20} y={22} fill={ICMP} fontSize={10.5} fontWeight={700}>
        Echo Request (HOST-A → HOST-B)
      </text>
      <DFieldRow x={20} y={30} h={34} fields={[{ label: "Type 8", w: 80, color: ICMP, strong: true }, { label: "Code 0", w: 80 }, { label: `Id ${ECHO_IDENTIFIER}`, w: 110, color: D.warning, strong: true }, { label: "Seq 1", w: 90, color: D.warning, strong: true }, { label: `Data ${PING_DATA} B`, w: 110 }]} />
      <text x={20} y={94} fill={D.success} fontSize={10.5} fontWeight={700}>
        Echo Reply (HOST-B → HOST-A)
      </text>
      <DFieldRow x={20} y={102} h={34} fields={[{ label: "Type 0", w: 80, color: D.success, strong: true }, { label: "Code 0", w: 80 }, { label: `Id ${ECHO_IDENTIFIER}`, w: 110, color: D.warning, strong: true }, { label: "Seq 1", w: 90, color: D.warning, strong: true }, { label: "same data", w: 110 }]} />
      <text x={510} y={90} fill={D.warning} fontSize={10}>
        copied →
      </text>
      <text x={510} y={106} fill={D.warning} fontSize={10}>
        how ping
      </text>
      <text x={510} y={122} fill={D.warning} fontSize={10}>
        matches replies
      </text>
    </DiagramSvg>
  );
}

function TraceDiagram() {
  const xs = [70, 240, 410, 580];
  const rows = [
    { ttl: 1, stop: 1, reply: `Time Exceeded 11/0 from ${IC_ADDR["R1:LAN"]}`, color: D.warning },
    { ttl: 2, stop: 2, reply: `Time Exceeded 11/0 from ${IC_ADDR["R2:TRANSIT"]}`, color: D.warning },
    { ttl: 3, stop: 3, reply: `Echo Reply 0/0 from ${IC_ADDR["HOST-B"]}`, color: D.success },
  ];
  return (
    <DiagramSvg h={250} label={`ICMP Echo-based traceroute: TTL 1 expires at R1 which sends Time Exceeded from ${IC_ADDR["R1:LAN"]}; TTL 2 expires at R2 from ${IC_ADDR["R2:TRANSIT"]}; TTL 3 reaches HOST-B which sends an Echo Reply`}>
      {["HOST-A", "R1", "R2", "HOST-B"].map((n, i) => (
        <text key={n} x={xs[i]} y={24} textAnchor="middle" fill={D.text} fontSize={11} fontWeight={700}>
          {n}
        </text>
      ))}
      {xs.map((x) => (
        <line key={x} x1={x} y1={32} x2={x} y2={214} stroke={D.line} strokeDasharray="3 4" />
      ))}
      {rows.map((r, i) => {
        const y = 58 + i * 58;
        return (
          <g key={r.ttl}>
            <DArrow x1={xs[0]} y1={y} x2={xs[r.stop] - 6} y2={y} color={ICMP} label={`probe TTL ${r.ttl}`} />
            <DArrow x1={xs[r.stop] - 6} y1={y + 16} x2={xs[0] + 6} y2={y + 16} color={r.color} width={1.6} />
            <text x={xs[0] + 14} y={y + 30} fill={r.color} fontSize={9.5}>
              {r.reply}
            </text>
          </g>
        );
      })}
      <text x={20} y={238} fill={D.muted} fontSize={10}>
        This lesson models ICMP-Echo-based traceroute. Other tools use UDP or TCP probes (Deep Dive).
      </text>
    </DiagramSvg>
  );
}

function PmtuDiagram() {
  return (
    <DiagramSvg h={200} label={`A 1500-byte DF Echo Request reaches R1, whose link to R2 has an IP MTU of ${FAULT_MTU}; R1 drops it and returns ICMP Destination Unreachable Type 3 Code 4 with Next-Hop MTU ${FAULT_MTU}`}>
      <DNode x={80} y={80} label="HOST-A" accent={D.cyan} w={100} />
      <DNode x={320} y={80} label="R1" accent={D.ip} w={90} />
      <DNode x={560} y={80} label="R2" accent={D.ip} w={90} />
      <DArrow x1={132} y1={70} x2={273} y2={70} color={ICMP} label="1500 B · DF" />
      <DLink x1={367} y1={80} x2={513} y2={80} color={D.danger} dashed label={`IP MTU ${FAULT_MTU}`} />
      <DArrow x1={273} y1={94} x2={132} y2={94} color={D.warning} label="ICMP 3/4 · MTU 1400" labelDy={18} />
      <DPill x={320} y={150} text="1500 > 1400 and DF set → can't fragment → drop" color={D.danger} w={330} />
      <text x={20} y={188} fill={D.muted} fontSize={10}>
        Small pings (84 B) still pass: routing is fine. Only packets bigger than the path MTU with DF fail.
      </text>
    </DiagramSvg>
  );
}

function RepairMathDiagram() {
  const scale = 0.3;
  const x0 = 170;
  const bar = (y: number, data: number, label: string, ok: boolean) => (
    <g>
      <text x={20} y={y + 10} fill={D.text} fontSize={10.5} fontWeight={700}>
        {label}
      </text>
      <text x={20} y={y + 24} fill={ok ? D.success : D.danger} fontSize={10} fontFamily="monospace">
        20+8+{data} = {28 + data}
      </text>
      <rect x={x0} y={y} width={20 * scale} height={24} fill={D.ip} fillOpacity={0.6} />
      <rect x={x0 + 20 * scale} y={y} width={8 * scale} height={24} fill={ICMP} fillOpacity={0.7} />
      <rect x={x0 + 28 * scale} y={y} width={data * scale} height={24} fill={ok ? D.success : D.danger} fillOpacity={0.35} stroke={ok ? D.success : D.danger} />
    </g>
  );
  return (
    <DiagramSvg h={170} label={`20 + 8 + ${BIG_DATA} = 1500 bytes exceeds the ${FAULT_MTU}-byte MTU; 20 + 8 + ${FIXED_DATA} = 1400 bytes fits exactly; 20 + 8 + 1400 = 1428 does not`}>
      {bar(20, BIG_DATA, "original", false)}
      {bar(60, 1400, "data 1400", false)}
      {bar(100, FIXED_DATA, "data 1372", true)}
      <line x1={x0 + FAULT_MTU * scale} y1={10} x2={x0 + FAULT_MTU * scale} y2={134} stroke={D.warning} strokeWidth={2} strokeDasharray="5 4" />
      <text x={x0 + FAULT_MTU * scale} y={152} textAnchor="middle" fill={D.warning} fontSize={10} fontWeight={700}>
        IP MTU {FAULT_MTU}
      </text>
    </DiagramSvg>
  );
}


function StoryLabBridge() {
  const open = usePracticeLabOpener();
  return (
    <PracticeBridge label="Open the ICMP Lab" onPractice={open}>
      Learn the signals in six short levels, then work like an engineer: probe from HOST-A, follow every packet on the topology, open the routers (Cisco or Junos) and hosts, read captures at every interface, and solve six tickets — fixing the real configuration and proving the repair.
    </PracticeBridge>
  );
}

export function IcmpLessonGuideContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="ic-mission" eyebrow="This lesson" title="Let the network tell you what's wrong" tone="ip">
        <p>ICMP is how IPv4 reports reachability, path and delivery problems. Every tool in this lesson (ping, traceroute and path-MTU testing) works by sending a packet and reading which ICMP Type and Code come back.</p>
        <Callout tone="ip" title="The core idea">
          The message type <em>is</em> the diagnosis. 0/0 means the destination answered. 11/0 means TTL ran out at this hop. 3/4 means the packet is too big and DF is set.
        </Callout>
      </GuideSection>
      <GuideSection id="ic-story" eyebrow="How it works" title="What happens, message by message" tone="cyan">
        <ProtocolStory
          problem={<>IP delivers packets or silently drops them. It has no way of its own to tell the sender why a packet didn&apos;t arrive, or whether the path works at all. ICMP is the network&apos;s feedback channel: small messages carried inside IP (Protocol 1, no ports).</>}
          steps={[
            { actor: "HOST-A", action: <>runs <Mono>ping {IC_ADDR["HOST-B"]}</Mono>: sends an <strong>Echo Request 8/0</strong> with Identifier {ECHO_IDENTIFIER} and Sequence 1, TTL {INITIAL_TTL}.</>, verify: `The capture shows ICMP type 8 code 0 leaving HOST-A, with the Identifier and Sequence 1.`, fails: { symptom: `ping fails immediately, or nothing leaves HOST-A.`, evidence: `Check HOST-A first: its address, mask, gateway and the ARP entry for the gateway. No request means no test at all.` }, tone: "ip" },
            { actor: "R1, R2", action: <>forward it like any packet, each decrementing TTL ({INITIAL_TTL} → {INITIAL_TTL - 1} → {INITIAL_TTL - 2}).</>, why: "TTL limits how long a looping packet can live", verify: `The request arrives at HOST-B with TTL two lower than it left: one per router.`, fails: { symptom: `Time Exceeded comes back from a router, or the request just disappears.`, evidence: `Time Exceeded on a normal ping means a loop (traceroute repeats the same routers). A silent drop points at a missing route or a filter on that router.` }, tone: "cyan" },
            { actor: "HOST-B", action: <>answers with an <strong>Echo Reply 0/0</strong> that copies the Identifier, Sequence and data.</>, changes: "HOST-A matches the reply to its request and measures round-trip time", why: "a reply proves both directions of the path work", verify: `An Echo Reply 0/0 with the same Identifier and Sequence arrives, and ping prints a round-trip time.`, fails: { symptom: `Request timed out, although a capture at HOST-B shows the requests arriving.`, evidence: `The forward path works and the reply path does not. Check each router has a route back to HOST-A, and look for filters on the way back.` }, tone: "success" },
            { actor: "Traceroute", action: <>sends probes with TTL 1, 2, 3… Each router where TTL runs out drops the probe and returns <strong>Time Exceeded 11/0</strong>, revealing itself; the destination finally sends an Echo Reply.</>, verify: `Each traceroute line is a router that sent Time Exceeded. The last line is the destination itself.`, fails: { symptom: `A line of * * *, or the same two addresses repeating.`, evidence: `* means no ICMP came back from that hop (filtered or rate-limited). If later hops answer, the path works. Repeating addresses mean a routing loop.` }, tone: "violet" },
            { actor: "HOST-A", action: <>sends a {20 + 8 + BIG_DATA}-byte ping with <strong>DF</strong> set. The R1–R2 link&apos;s IP MTU is only {FAULT_MTU}.</>, verify: `The capture shows the total length and DF=1 in the IP header.`, fails: { symptom: `Small pings work, big ones get no reply.`, evidence: `A size-dependent failure is an MTU problem. The size where replies stop is close to the path MTU.` }, tone: "warning" },
            { actor: "R1", action: <>can&apos;t forward it without fragmenting, which DF forbids, so it drops it and returns <strong>Destination Unreachable 3/4</strong> with Next-Hop MTU {FAULT_MTU}.</>, changes: "the sender learns the exact size limit and who imposes it", verify: `HOST-A receives Destination Unreachable 3/4 from R1, carrying Next-Hop MTU ${FAULT_MTU}.`, fails: { symptom: `Big packets vanish with no message at all: a black hole.`, evidence: `Something on the way is dropping ICMP 3/4. The fix is to allow it, never to block more ICMP.` }, tone: "danger" },
            { actor: "HOST-A", action: <>resends a packet that fits: 20 + 8 + {FIXED_DATA} = {FAULT_MTU} bytes, DF still set. The Echo Reply comes back.</>, verify: `An Echo Reply comes back for the ${FAULT_MTU}-byte packet, DF still set.`, fails: { symptom: `Still no reply at the new size.`, evidence: `Redo the arithmetic: total = 20 (IP) + 8 (ICMP) + data. A smaller link may sit further along the path: send again and read the next 3/4.` }, tone: "success" },
          ]}
          outcome={<>Echo tells you whether the path works; Time Exceeded maps the path; Destination Unreachable explains a drop and often exactly why. The pattern “small pings work, big ones vanish” points at MTU; the 3/4 message (if it isn&apos;t filtered) names the limit. Never blanket-block ICMP: filtering 3/4 creates path-MTU black holes.</>}
        />
        <PresentationBridge>Watch ping, traceroute and the MTU incident animated hop by hop in the ICMP presentation.</PresentationBridge>
        <StoryLabBridge />
      </GuideSection>

      <GuideSection id="ic-proves" eyebrow="Reading a result" title="What a ping proves — and what it doesn't" tone="cyan">
        <CompareCards
          items={[
            { title: "An Echo Reply proves", tone: "success", tag: "for this packet", points: ["The request reached the destination", "The reply found its way back", "Both directions work for this size and type of packet"] },
            { title: "It does not prove", tone: "warning", tag: "test those separately", points: ["That an application (a TCP port) works", "That bigger packets fit the path", "That there is never any loss", "That DNS works"] },
          ]}
        />
        <Callout tone="warning" title="A failed ping isn't a diagnosis" icon="!">
          A timeout only says the request, the reply, or the answer to it was dropped — or never sent (a host firewall chooses not to answer). It is a symptom. Captures, counters, traceroute and an application test tell you which.
        </Callout>
      </GuideSection>

      <GuideSection id="ic-unreach" eyebrow="Errors" title="Destination Unreachable names the device and the reason" tone="danger">
        <FailureSignatures
          items={[
            { tag: "3/0", title: "Net Unreachable", tone: "danger", points: ["Sent by a router with no route", "Source = that router's interface", "Look at its routing table"] },
            { tag: "3/1", title: "Host Unreachable", tone: "warning", points: ["Sent by the last router", "It has a route, but ARP got no answer", "The host is off, or the address is wrong"] },
            { tag: "3/3", title: "Port Unreachable", tone: "cyan", points: ["Sent by the destination itself", "Nothing listens on that UDP port", "How UDP traceroute knows it arrived"] },
            { tag: "3/4", title: "Fragmentation Needed", tone: "danger", points: ["Sent by the router before the small link", "Carries the next-hop MTU", "If it's filtered: a silent black hole"] },
          ]}
        />
        <p>How to verify: the source address of the error is the device that reported it — check its routes (3/0), its ARP and the host (3/1), the service (3/3), the MTU of its outgoing link (3/4). A router&apos;s ICMP statistics prove it sent the message, even when the sender never received it.</p>
      </GuideSection>

      <GuideSection id="ic-breaks" eyebrow="When it breaks" title={`When ping or traceroute fails: let the messages point the way`} tone="danger">
        <p className="text-sm text-pv-text-muted">{`Every failure stops the story at one step. Either an ICMP message tells you which device stopped the packet and why, or silence tells you that something dropped it without reporting.`}</p>
        <TroubleshootingFlow
          steps={[
            { question: `Did an Echo Reply come back?`, look: `Yes: both directions work at this size. Reachability is not the problem.` },
            { question: `Did an ICMP error come back instead?`, look: `Read the type/code and the source address. 11/0: TTL ran out at that router (a loop if traceroute repeats). 3/0 or 3/1: that router has no route, or can not reach the host. 3/4: too big with DF set. The source IP is the device that reported it.` },
            { question: `Did nothing come back at all?`, look: `Silence is a drop with no report: a filter, a missing return route or a dead host. Traceroute shows the last hop that answers. Check the next hop: its routes and filters, in both directions.` },
            { question: `Does the result depend on packet size?`, look: `If small packets work and large ones fail, it is MTU. Send DF pings of decreasing size. The 3/4 message names the limit, unless it is filtered.` },
            { question: `How do you prove the fix?`, look: `Repeat the exact test that failed (same destination, size and DF) and get the reply. Then run traceroute to check the path is the one you expect.` },
          ]}
        />
        <Callout tone="cyan" title="The habit to build" icon="✓">
          Walk the story in order and confirm each step with real evidence (a table, a capture, a command). The first step you cannot confirm is where the problem is. The boxes under each story step above say what to look at.
        </Callout>
      </GuideSection>

      <GuideSection id="ic-silence" eyebrow="Silence" title="Silence is evidence — and the reply has its own way back" tone="warning">
        <TroubleshootingFlow
          steps={[
            { question: "R1 answers, then nothing", look: "The problem is beyond R1 — or on the way back through R2. A router's ICMP needs a route back too." },
            { question: "R2 answers, then nothing", look: "Beyond R2: the destination itself, or its firewall. Try a UDP traceroute or the application." },
            { question: "Nothing answers at all", look: "HOST-A's own side: its link, gateway, or a filter near it." },
            { question: "The request reaches HOST-B, the reply never returns", look: "A capture on HOST-B shows the request in and the reply out. The return path is broken: check every router's route back to HOST-A." },
            { question: "Small works, big hangs, no error anywhere", look: "A path-MTU black hole: a link with a smaller MTU, and the 3/4 messages that would fix it are being filtered (often by the server's own firewall)." },
          ]}
        />
        <Callout tone="cyan" title="* * * is not “down”">
          A traceroute hop that prints * * * only means no Time Exceeded came back from it. If the next hop answers, the router is forwarding fine — something filters its ICMP, or it doesn&apos;t send any.
        </Callout>
        <Misconceptions
          items={[
            { myth: "Ping failed, so HOST-B is down.", correction: "Its firewall may drop ping while the application works, or the reply may die on the way back." },
            { myth: "Traceroute stops at R1, so R1 is broken.", correction: "R1 answered. The trouble is beyond it, or on the return path from the next hop." },
            { myth: "Blocking all ICMP is safer.", correction: "It breaks Path MTU Discovery (3/4) and blinds troubleshooting. Filter specific types, carefully." },
          ]}
        />
      </GuideSection>

      <GuideSection id="ic-method" eyebrow="Repair" title="Change → verify on the device → probe → prove" tone="success">
        <FlowSteps
          steps={[
            { title: "Change one thing", body: "On the device that owns the problem: an interface MTU, a route, a filter line, a host firewall rule.", tone: "cyan" },
            { title: "Verify it on the device", body: "show ip interface / show route / show access-lists / iptables -L. Accepted is not the same as correct.", tone: "violet" },
            { title: "Generate a fresh probe", body: "The exact test that failed: same destination, size and DF — and watch where it goes.", tone: "warning" },
            { title: "Prove the user's symptom is gone", body: "The download completes, the ping returns, traceroute shows every hop. Then check nothing else broke.", tone: "success" },
          ]}
        />
      </GuideSection>

      <PathDivider title="Reference">Every part of the story in detail. Read the parts you need.</PathDivider>


      <GuideSection id="ic-position" eyebrow="Encapsulation" title="ICMP rides directly in IPv4" tone="violet">
        <DiagramFrame caption="Protocol 1. No transport layer.">
          <PositionDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="ic-ping" eyebrow="Ping" title="Echo Request, Echo Reply and TTL" tone="cyan">
        <DiagramFrame caption="Each forwarding router subtracts one. The reply is a separate packet, routed on its own.">
          <PingDiagram />
        </DiagramFrame>
        <p>
          TTL is a hop limit, not a timer: <Mono>{INITIAL_TTL}</Mono> → 63 at R1 → 62 at R2. HOST-B receives it with 62 and doesn&apos;t decrement it further.
        </p>
      </GuideSection>

      <GuideSection id="ic-echo" eyebrow="Matching" title="Identifier and Sequence" tone="warning">
        <DiagramFrame caption="The reply copies the Identifier, Sequence and data.">
          <EchoMatchDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="ic-trace" eyebrow="Path discovery" title="ICMP-Echo-based traceroute" tone="violet">
        <DiagramFrame caption="Raising the TTL one step at a time makes each hop reveal itself.">
          <TraceDiagram />
        </DiagramFrame>
        <p>The router that discards the probe sends Time Exceeded from its own address. That source address is what traceroute prints for the hop.</p>
      </GuideSection>

      <GuideSection id="ic-pmtu" eyebrow="The incident" title="MTU, DF and Fragmentation Needed" tone="danger">
        <DiagramFrame caption="The router can't fragment a DF packet, so it tells the sender the MTU instead.">
          <PmtuDiagram />
        </DiagramFrame>
        <CompareCards
          items={[
            { title: "Evidence", tone: "danger", tag: "facts", points: ["Small pings work", "1500-byte DF pings fail", "R1 returns ICMP 3/4 with MTU 1400"] },
            { title: "Not the cause", tone: "success", tag: "ruled out", points: ["TTL (it's 64, and no 11/0 came back)", "Routing (small pings pass)", "DNS (no names involved)"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="ic-fix" eyebrow="Repair" title="Fit the DF packet to the path" tone="success">
        <DiagramFrame caption="IP MTU counts the whole IPv4 packet: IPv4 header + ICMP header + data.">
          <RepairMathDiagram />
        </DiagramFrame>
        <p>
          Keep DF and send <Mono>{FIXED_DATA}</Mono> bytes of data: 20 + 8 + {FIXED_DATA} = {FAULT_MTU}. The IP MTU doesn&apos;t include the Ethernet header or FCS; those are outside the 1400.
        </p>
      </GuideSection>

      <GuideSection id="ic-verify" eyebrow="Verification" title="Prove it both ways" tone="success">
        <FlowSteps
          steps={[
            { title: "Send the fitted probe", body: `DF set, ${FIXED_DATA} bytes of data → 1400-byte IPv4 packet.`, tone: "cyan" },
            { title: "Watch it cross", body: "R1 forwards it onto the 1400-byte link unfragmented.", tone: "ip" },
            { title: "Confirm the reply", body: "HOST-B's 1400-byte Echo Reply comes back with the same id and seq.", tone: "success" },
          ]}
        />
      </GuideSection>

      <GuideSection id="ic-model" eyebrow="Mental model" title="Postcards from the path" tone="cyan">
        <p>Every ICMP message is a postcard sent back to the source. &quot;Arrived&quot; (Echo Reply), &quot;I had to throw it away here, it ran out of hops&quot; (Time Exceeded) and &quot;too big for my next road, and you told me not to cut it&quot; (3/4). Diagnostics is reading the postcards.</p>
      </GuideSection>

      <GuideSection id="ic-glossary" eyebrow="Glossary" title="Terms used in this lesson" tone="violet">
        <Glossary
          items={[
            { term: "Echo Request / Reply", def: "ICMP 8/0 and 0/0, used by ping." },
            { term: "Identifier / Sequence", def: "Echo fields that pair replies with requests." },
            { term: "TTL", def: "IPv4 hop limit. Each forwarding router decrements it." },
            { term: "Time Exceeded (11/0)", def: "Sent by a router that discards a packet whose TTL ran out." },
            { term: "Dest. Unreachable 3/4", def: "Fragmentation Needed and DF set. Carries the next-hop MTU." },
            { term: "IP MTU", def: "Largest IPv4 packet a link carries (header + payload)." },
            { term: "DF", def: "Don't Fragment flag in the IPv4 header." },
          ]}
        />
      </GuideSection>

      <GuideSection id="ic-recap" eyebrow="Recap" title="What you can now read" tone="success">
        <ChecklistCard tone="cyan" title="ICMP & Network Diagnostics" mark="→" items={["ICMP = IPv4 Protocol 1, no ports", "Echo 8/0 → 0/0: the round trip works — not the application, not big packets", "TTL −1 per router; 11/0 when it expires, from the interface it arrived on", "Traceroute: TTL 1, 2, 3… (UDP ends with 3/3, -I with an Echo Reply); * * * isn't down", "3/0 no route · 3/1 no ARP answer · 3/3 no listener · 3/4 too big with DF", "data + 8 + 20 = the IP packet; compare it with the smallest MTU on the path", "Silence is evidence: find where the probe — or its reply — was last seen", "Fix on the device, verify there, then prove it with a fresh probe"]} />
      </GuideSection>
    </div>
  );
}
