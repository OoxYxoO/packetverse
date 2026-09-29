import { Callout, CompareCards, DArrow, DIAGRAM as D, DiagramFrame, DiagramSvg, DLink, DNode, DPill, FieldTable, FlowSteps, Glossary, GuideSection } from "@/components/lesson/GuideBlocks";
import { DTable } from "@/components/lesson/FundamentalsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { LadderDiagram, SeqLanes, WorkflowDiagram } from "@/components/lesson/TroubleshootingGuideSvg";

export const PA_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "pad-capture", label: "Capture points" },
  { id: "pad-tuple", label: "Five-tuple & correlation" },
  { id: "pad-flags", label: "TCP flags" },
  { id: "pad-retx", label: "Retransmission & backoff" },
  { id: "pad-dupack", label: "Duplicate ACKs" },
  { id: "pad-rst", label: "RST vs silence vs ICMP" },
  { id: "pad-ttl", label: "TTL" },
  { id: "pad-timing", label: "Timing" },
  { id: "pad-limits", label: "Capture limitations" },
  { id: "pad-workflow", label: "Workflow" },
  { id: "pad-glossary", label: "Glossary" },
];

function CaptureMethodsDiagram() {
  return (
    <DiagramSvg h={200} label="Three ways to capture: a SPAN mirror port on a switch, an inline TAP on a link, and a capture on the host itself">
      <text x={110} y={18} textAnchor="middle" fill={D.text} fontSize={10.5} fontWeight={700}>
        SPAN / mirror
      </text>
      <DNode x={110} y={70} label="Switch" accent={D.eth} w={90} h={36} />
      <DNode x={110} y={150} label="Analyzer" accent={D.warning} w={90} h={36} />
      <DArrow x1={110} y1={90} x2={110} y2={130} color={D.warning} dashed />
      <text x={110} y={194} textAnchor="middle" fill={D.muted} fontSize={8.5}>
        copies; may drop copies under load
      </text>
      <text x={320} y={18} textAnchor="middle" fill={D.text} fontSize={10.5} fontWeight={700}>
        TAP
      </text>
      <DNode x={250} y={70} label="A" accent={D.cyan} w={50} h={32} />
      <DNode x={390} y={70} label="B" accent={D.cyan} w={50} h={32} />
      <DPill x={320} y={70} text="TAP" color={D.warning} w={50} />
      <DLink x1={275} y1={70} x2={295} y2={70} />
      <DLink x1={345} y1={70} x2={365} y2={70} />
      <DNode x={320} y={150} label="Analyzer" accent={D.warning} w={90} h={36} />
      <DArrow x1={320} y1={84} x2={320} y2={130} color={D.warning} dashed />
      <text x={320} y={194} textAnchor="middle" fill={D.muted} fontSize={8.5}>
        passive copy of both directions
      </text>
      <text x={530} y={18} textAnchor="middle" fill={D.text} fontSize={10.5} fontWeight={700}>
        Host capture
      </text>
      <DNode x={530} y={70} label="Server NIC" accent={D.success} w={110} h={36} />
      <DNode x={530} y={150} label="tcpdump" accent={D.warning} w={90} h={36} />
      <DArrow x1={530} y1={90} x2={530} y2={130} color={D.warning} dashed />
      <text x={530} y={194} textAnchor="middle" fill={D.muted} fontSize={8.5}>
        sees the host&apos;s view (offloads apply)
      </text>
    </DiagramSvg>
  );
}

function CorrelationDiagram() {
  return (
    <DiagramSvg h={190} label="Fields that identify the same packet across capture points versus fields that change at routing hops">
      <DTable
        x={30}
        y={8}
        title="Correlating one packet across captures"
        cols={[
          { label: "FIELD", w: 200 },
          { label: "ACROSS A ROUTER", w: 180 },
          { label: "USE FOR MATCHING?", w: 200 },
        ]}
        rows={[
          ["Five-tuple", "unchanged", "yes — selects the flow"],
          ["TCP seq / ack / flags", "unchanged", "yes — selects the segment"],
          ["IP Identification", "unchanged (no NAT)", "yes — tells retransmissions apart"],
          ["TTL · IP header checksum", "TTL − 1, checksum recomputed", "no"],
          ["Ethernet addresses", "rewritten", "no"],
          ["Timestamp", "later downstream", "only with synced clocks"],
        ]}
      />
    </DiagramSvg>
  );
}

function FlagsDiagram() {
  return (
    <DiagramSvg h={210} label="TCP flag bits and the common combinations: SYN 0x02, SYN-ACK 0x12, ACK 0x10, PSH-ACK 0x18, FIN-ACK 0x11, RST 0x04, RST-ACK 0x14">
      <DTable
        x={60}
        y={8}
        title="TCP flag byte (low 6 bits shown)"
        cols={[
          { label: "SEGMENT", w: 130 },
          { label: "HEX", w: 70 },
          { label: "MEANING", w: 320 },
        ]}
        rows={[
          ["SYN", "0x02", "open: carries the initial sequence number"],
          ["SYN, ACK", "0x12", "accept: acknowledges ISN + 1, offers own ISN"],
          ["ACK", "0x10", "acknowledge; most segments carry it"],
          ["PSH, ACK", "0x18", "data the receiver should deliver promptly"],
          ["FIN, ACK", "0x11", "no more data from this side (uses one seq number)"],
          ["RST / RST, ACK", "0x04 / 0x14", "refuse or abort — immediate, explicit"],
        ]}
      />
    </DiagramSvg>
  );
}

function BackoffDiagram() {
  const xs = [80, 180, 380, 580];
  return (
    <DiagramSvg h={130} label="SYN retransmission backoff: attempts at 0, 1, 3 and 7 seconds as the timeout doubles">
      <line x1={60} y1={60} x2={610} y2={60} stroke={D.line} />
      {xs.map((x, i) => (
        <g key={x}>
          <DPill x={x} y={60} text={i === 0 ? "SYN" : `SYN #${i + 1}`} color={i === 0 ? D.cyan : D.warning} w={62} />
          <text x={x} y={92} textAnchor="middle" fill={D.muted} fontSize={9} fontFamily="monospace">
            t = {[0, 1, 3, 7][i]} s
          </text>
        </g>
      ))}
      <text x={130} y={36} textAnchor="middle" fill={D.muted} fontSize={8.5}>
        RTO 1 s
      </text>
      <text x={280} y={36} textAnchor="middle" fill={D.muted} fontSize={8.5}>
        2 s (doubled)
      </text>
      <text x={480} y={36} textAnchor="middle" fill={D.muted} fontSize={8.5}>
        4 s
      </text>
      <text x={320} y={120} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        Initial RTO 1 s (RFC 6298), doubling on each timeout. Gaps of 1, 2, 4 s are the fingerprint of handshake loss.
      </text>
    </DiagramSvg>
  );
}

function DupAckDiagram() {
  return (
    <DiagramSvg h={230} label="Duplicate ACKs: segment 2 is lost, segments 3 to 5 each trigger an ACK for the missing byte, three duplicates trigger a fast retransmit">
      <SeqLanes
        rowH={28}
        lanes={[
          { x: 150, label: "Sender", color: D.cyan },
          { x: 490, label: "Receiver", color: D.success },
        ]}
        msgs={[
          { from: 0, to: 1, label: "seq 1001 · len 1000" },
          { from: 0, to: 1, label: "seq 2001 · len 1000", drop: true },
          { from: 0, to: 1, label: "seq 3001 → ack 2001 (dup 1)", color: D.warning },
          { from: 0, to: 1, label: "seq 4001 → ack 2001 (dup 2)", color: D.warning },
          { from: 0, to: 1, label: "seq 5001 → ack 2001 (dup 3)", color: D.warning },
          { from: 0, to: 1, label: "fast retransmit seq 2001", color: D.success },
        ]}
      />
    </DiagramSvg>
  );
}

function RstSilenceDiagram() {
  return (
    <DiagramSvg h={170} label="Three signatures for a failed connection: silence and retransmission (loss or silent filter), RST-ACK (closed port), ICMP destination unreachable (no route or administratively prohibited)">
      <DTable
        x={20}
        y={8}
        title="What came back after the SYN?"
        cols={[
          { label: "EVIDENCE", w: 190 },
          { label: "TIMING", w: 120 },
          { label: "USUALLY MEANS", w: 290 },
        ]}
        rows={[
          ["Nothing · SYN retransmitted", "1 s, 2 s, 4 s …", "loss, or a filter that drops silently"],
          ["RST, ACK from the server", "immediate", "reached the host; nothing listening"],
          ["ICMP Dest. Unreachable", "immediate", "no route, or administratively prohibited"],
          ["SYN, ACK", "one RTT", "port open — look further along"],
        ]}
      />
    </DiagramSvg>
  );
}

function TtlDiagram() {
  return (
    <DiagramSvg h={150} label="TTL decreases by one at each router and not at switches; initial values 64, 128 and 255 hint at the sender's operating system">
      <DNode x={70} y={60} label="Host" sub="TTL 64" accent={D.cyan} w={90} />
      <DNode x={220} y={60} label="Switch" sub="TTL 64" accent={D.eth} w={90} />
      <DNode x={370} y={60} label="Router" sub="TTL 63" accent={D.violet} w={90} />
      <DNode x={520} y={60} label="Router" sub="TTL 62" accent={D.violet} w={90} />
      <DArrow x1={115} y1={60} x2={175} y2={60} />
      <DArrow x1={265} y1={60} x2={325} y2={60} />
      <DArrow x1={415} y1={60} x2={475} y2={60} />
      <text x={320} y={118} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        Hops from the sender ≈ (nearest of 64 / 128 / 255) − observed TTL. TTL 0 in transit → ICMP Time Exceeded.
      </text>
      <text x={320} y={136} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        A TTL that differs between two captures of one packet counts the routers between them.
      </text>
    </DiagramSvg>
  );
}

function TimingDiagram() {
  return (
    <DiagramSvg h={170} label="Round-trip time from the handshake: at the client, SYN to SYN-ACK is the full round trip; at the server, SYN-ACK to ACK is the client-side round trip">
      <SeqLanes
        rowH={34}
        timeX={110}
        lanes={[
          { x: 180, label: "CLIENT", color: D.cyan },
          { x: 520, label: "SERVER", color: D.success },
        ]}
        msgs={[
          { from: 0, to: 1, label: "SYN", time: "t0" },
          { from: 1, to: 0, label: "SYN, ACK", time: "t0 + RTT", color: D.success },
          { from: 0, to: 1, label: "ACK", time: "+ client think" },
        ]}
      />
      <text x={320} y={160} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        Network delay shows in the handshake; server delay shows between a request and its response.
      </text>
    </DiagramSvg>
  );
}

function LimitsDiagram() {
  return (
    <DiagramSvg h={190} label="Capture limitations: mirror oversubscription, capture drops, offload artifacts, clock skew, encryption, truncated snap length">
      <DTable
        x={20}
        y={8}
        title="Why a capture can mislead you"
        cols={[
          { label: "LIMITATION", w: 190 },
          { label: "EFFECT", w: 410 },
        ]}
        rows={[
          ["Mirror oversubscription", "SPAN drops copies — 'missing' packets that were really forwarded"],
          ["Capture-host drops", "the analyzer itself falls behind (check its drop count)"],
          ["NIC offloads (host capture)", "bad-looking checksums, giant 'segments' before segmentation"],
          ["Unsynchronized clocks", "cross-capture timings are meaningless without sync"],
          ["Encryption", "payload unreadable — headers and timing still tell a story"],
          ["Snap length", "packets truncated; lengths still reported in headers"],
        ]}
      />
    </DiagramSvg>
  );
}

export function PaDeepDiveContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="pad-capture" eyebrow="Capture points" title="Where you capture decides what you can prove" tone="cyan">
        <DiagramFrame caption="Each method has its own blind spots.">
          <CaptureMethodsDiagram />
        </DiagramFrame>
        <Callout tone="warning" title="Not seen here ≠ never existed">
          A packet absent from one capture was not observed at that point. Corroborate with a second capture, a counter or the endpoint&apos;s own behavior before concluding it was lost.
        </Callout>
      </GuideSection>

      <GuideSection id="pad-tuple" eyebrow="Correlation" title="The five-tuple and the fields that survive routing" tone="ip">
        <DiagramFrame caption="Match on what does not change.">
          <CorrelationDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="pad-flags" eyebrow="TCP" title="Flags" tone="tcp">
        <DiagramFrame caption="Read the flag byte before the payload.">
          <FlagsDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="pad-retx" eyebrow="TCP" title="Retransmission and exponential backoff" tone="warning">
        <DiagramFrame caption="The gaps between retries are evidence too.">
          <BackoffDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="pad-dupack" eyebrow="TCP" title="Duplicate ACKs and fast retransmit" tone="warning">
        <DiagramFrame caption="Loss in the middle of a data stream announces itself through repeated acknowledgments.">
          <DupAckDiagram />
        </DiagramFrame>
        <p>Each segment that arrives after a gap makes the receiver repeat its acknowledgment of the missing byte. Three duplicates let the sender retransmit without waiting for the timer (RFC 5681). During a handshake there is no data to generate duplicates — which is why handshake loss shows up as a full timeout instead.</p>
      </GuideSection>

      <GuideSection id="pad-rst" eyebrow="Signatures" title="RST vs silence vs ICMP" tone="danger">
        <DiagramFrame caption="Refusal is fast and explicit; loss is slow and silent.">
          <RstSilenceDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="pad-ttl" eyebrow="IPv4" title="TTL" tone="ip">
        <DiagramFrame caption="Switches never touch TTL; every router decrements it.">
          <TtlDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="pad-timing" eyebrow="Timing" title="Relative timing" tone="violet">
        <DiagramFrame caption="Where the delay sits tells you who is slow.">
          <TimingDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="pad-limits" eyebrow="Limits" title="Capture limitations" tone="warning">
        <DiagramFrame caption="Know your instrument before trusting it.">
          <LimitsDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="pad-workflow" eyebrow="Workflow" title="A packet-analysis workflow" tone="cyan">
        <DiagramFrame caption="The same method in every Troubleshooting lesson.">
          <DiagramSvg h={82} label="Troubleshooting workflow">
            <WorkflowDiagram notes={["one service", "bracket path", "2+ captures", "one cause", "counters", "one change", "re-capture"]} />
          </DiagramSvg>
        </DiagramFrame>
        <DiagramFrame caption="The evidence ladder — start from facts, find the lowest broken dependency.">
          <DiagramSvg h={210} label="Evidence ladder with eight rungs from physical to policy">
            <LadderDiagram
              rows={[
                { rung: "Physical / interface", evidence: "up/up? errors, drops (by delta)", status: "ok" },
                { rung: "Ethernet / VLAN", evidence: "MAC learned? right VLAN?", status: "ok" },
                { rung: "ARP / neighbor", evidence: "next-hop MAC resolved?", status: "ok" },
                { rung: "IP addressing", evidence: "address, prefix, gateway", status: "ok" },
                { rung: "Routing / forwarding", evidence: "route both ways? TTL?", status: "ok" },
                { rung: "Transport", evidence: "handshake, retransmissions, RST", status: "suspect" },
                { rung: "Application", evidence: "listening? responding?", status: "skip" },
                { rung: "Policy / service", evidence: "filters, NAT, rate limits", status: "skip" },
              ]}
            />
          </DiagramSvg>
        </DiagramFrame>
        <FlowSteps
          steps={[
            { title: "Filter to one flow", body: "Five-tuple first; everything else is noise.", tone: "cyan" },
            { title: "Compare to a baseline", body: "Which packet or gap is new?", tone: "violet" },
            { title: "Bracket the loss", body: "Captures either side of the suspect device.", tone: "warning" },
            { title: "Corroborate", body: "Counters, logs, endpoint behavior.", tone: "success" },
          ]}
        />
        <CompareCards
          items={[
            { title: "Good evidence", tone: "success", tag: "observation", points: ["SYN-ACK at SERVER 10.000450", "absent at CLIENT side", "R1 output drops +1"] },
            { title: "Not evidence", tone: "danger", tag: "assumption", points: ["'443 must be blocked'", "'the server is slow'", "a counter's lifetime total"] },
          ]}
        />
        <FieldTable
          title="Useful capture filters"
          columns={["Goal", "Wireshark display filter", "tcpdump capture filter"]}
          rows={[
            ["One flow", "tcp.port == 51001", "tcp port 51001"],
            ["Retransmissions", "tcp.analysis.retransmission", "(post-process in Wireshark)"],
            ["Resets", "tcp.flags.reset == 1", "'tcp[tcpflags] & tcp-rst != 0'"],
            ["ICMP errors", "icmp.type == 3 || icmp.type == 11", "icmp"],
          ]}
        />
      </GuideSection>

      <GuideSection id="pad-glossary" eyebrow="Glossary" title="Terms" tone="cyan">
        <Glossary
          items={[
            { term: "SPAN", def: "Switched Port Analyzer: a switch copies a port's frames to a monitor port." },
            { term: "TAP", def: "Test Access Point: a passive device that copies a link's traffic." },
            { term: "Duplicate ACK", def: "A repeated acknowledgment of the same byte, sent when data arrives after a gap." },
            { term: "Fast retransmit", def: "Retransmitting after three duplicate ACKs instead of waiting for the timeout." },
            { term: "Snap length", def: "The number of bytes of each packet a capture stores." },
            { term: "RTT", def: "Round-trip time; visible as SYN → SYN-ACK at the client." },
          ]}
        />
      </GuideSection>
    </div>
  );
}
