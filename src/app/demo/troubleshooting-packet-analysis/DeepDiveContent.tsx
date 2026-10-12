import { Callout, CompareCards, DArrow, DIAGRAM as D, DiagramFrame, DiagramSvg, DLink, DNode, DPill, FailureSignatures, FieldTable, FlowSteps, Glossary, GuideSection, Misconceptions, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { DTable } from "@/components/lesson/FundamentalsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { LadderDiagram, SeqLanes, WorkflowDiagram } from "@/components/lesson/TroubleshootingGuideSvg";
import { ExplainIt, KnowledgeQuiz, PracticeBridge, type KnowledgeQuestion } from "@/components/lesson/GuideInteractive";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import { PresentationBridge } from "@/components/presentation/LessonPresentation";
import { CliPanel, FailureWalk } from "@/components/lesson/GuideCli";
import { BAD_GW, DROP_EVERY, GOOD_GW, NC_TIMEOUT_S, paApply, type PaAction, type PaState } from "@/lib/sim-engine/scenarios/paNet";
import { PA_FIXED, PA_HEALTHY, PA_INC, PaBracket, paCli, paOnly, PaResult, paSet, paTicketRun } from "./LessonGuideContent";

const G2 = { foundation: "Foundation", reading: "Reading captures", tcp: "TCP on the wire", method: "Method", trouble: "Troubleshooting", master: "Master it" };
export const PA_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "pd-why", label: "Why look at packets", group: G2.foundation },
  { id: "pd-methods", label: "Capture methods", group: G2.foundation },
  { id: "pd-files", label: "Files, snap length and clocks", group: G2.foundation },
  { id: "pd-lines", label: "Anatomy of a tcpdump line", group: G2.reading },
  { id: "pd-filters", label: "Filters", group: G2.reading },
  { id: "pd-tuple", label: "Five-tuple and correlation", group: G2.reading },
  { id: "pd-ttl", label: "TTL and MAC rewrites", group: G2.reading },
  { id: "pd-flags", label: "TCP flags", group: G2.tcp },
  { id: "pd-states", label: "Socket states", group: G2.tcp },
  { id: "pd-retx", label: "Retransmission and backoff", group: G2.tcp },
  { id: "pd-dupack", label: "Duplicate ACKs", group: G2.tcp },
  { id: "pd-rst", label: "RST vs silence vs ICMP", group: G2.tcp },
  { id: "pd-bracket", label: "Bracketing", group: G2.method },
  { id: "pd-counters", label: "Counters as evidence", group: G2.method },
  { id: "pd-pitfalls", label: "Capture pitfalls", group: G2.method },
  { id: "pd-timing", label: "Reading time", group: G2.method },
  { id: "pd-signatures", label: "Failure signatures", group: G2.trouble },
  { id: "pd-ladder", label: "The troubleshooting ladder", group: G2.trouble },
  { id: "pd-tickets", label: "Five faults, evidence to proof", group: G2.trouble },
  { id: "pd-workflow", label: "A packet-analysis workflow", group: G2.trouble },
  { id: "pd-myths", label: "Common misconceptions", group: G2.master },
  { id: "pd-quiz", label: "Knowledge check", group: G2.master },
  { id: "pd-explain", label: "Can you explain it?", group: G2.master },
  { id: "pd-glossary", label: "Glossary", group: G2.master },
  { id: "pd-mental", label: "Mental model", group: G2.master },
  { id: "pd-practice", label: "Practice in the lab", group: G2.master },
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


const run = (s: PaState, ...a: PaAction[]) => a.reduce((acc, x) => paApply(acc, x), s);
const T = { closed: paTicketRun("closed"), hostfw: paTicketRun("hostfw"), gateway: paTicketRun("gateway"), spanrx: paTicketRun("spanrx") };
const F = {
  closed: run(T.closed, paSet("SERVER: systemctl start nginx", undefined, (h) => void (h.nginx = true)), { type: "nc" }),
  hostfw: run(T.hostfw, paSet("SERVER: iptables -D INPUT -p tcp --dport 443 -j DROP", undefined, (h) => void (h.drop443 = false)), { type: "nc" }),
  gateway: run(T.gateway, paSet(`SERVER: ip route replace default via ${GOOD_GW}`, undefined, (h) => void (h.gw = GOOD_GW)), { type: "nc" }, { type: "ping", count: 4 }),
  spanrx: run(T.spanrx, { type: "set", text: "SW1: analyzer CAP input egress interface ge-0/0/1", changes: [{ dev: "SW1", f: (c) => void (c.analyzer = { ingress: true, egress: true }) }] }, { type: "clear-caps" }, { type: "nc" }),
};

function LabBridge() {
  const openLab = usePracticeLabOpener();
  return (
    <PracticeBridge label="Open the Packet Analysis Lab" onPractice={openLab}>
      Five capture points, Junos on SW1 and R1, Linux on CLIENT, SERVER and the CAPTURE laptop — your own copy. Nothing you do there changes your lesson progress.
    </PracticeBridge>
  );
}

const QUIZ: KnowledgeQuestion[] = [
  { id: "q-absent", prompt: "A SYN-ACK is in SERVER's capture but not in the SPAN capture. What can you conclude?", options: [{ id: "a", label: "Nothing yet — check the mirror's directions and the captures in between" }, { id: "b", label: "R1 dropped it" }, { id: "c", label: "SW1 dropped it" }], correctId: "a", explanation: "Absence at one point is not proof of loss; the SPAN session may mirror only one direction." },
  { id: "q-rst", prompt: "The client gets RST,ACK 0.2 ms after its SYN. What does that prove?", options: [{ id: "a", label: "The path works and the host answered: nothing listens on that port" }, { id: "b", label: "A firewall in the path is dropping packets" }, { id: "c", label: "The server is overloaded" }], correctId: "a", explanation: "Refusal is an answer — fast and explicit. Loss is silence and a timer." },
  { id: "q-retx", prompt: "SYNs leave the client at 0, 1 and 3 s. Why those gaps?", options: [{ id: "a", label: "The retransmission timeout starts at 1 s and doubles" }, { id: "b", label: "The server asked for them" }, { id: "c", label: "The capture tool samples every second" }], correctId: "a", explanation: "Exponential backoff: 1 s, then 2 s, then 4 s…" },
  { id: "q-ttl", prompt: "The client sent TTL 64; SERVER's capture shows TTL 63. Where did the packet lose one?", options: [{ id: "a", label: "At R1 — routers decrement TTL, switches don't" }, { id: "b", label: "At SW1" }, { id: "c", label: "At SERVER's NIC" }], correctId: "a", explanation: "One router hop, one decrement." },
  { id: "q-counter", prompt: "Two frames are missing between R1 ge-0/0/1 and R1 ge-0/0/0. What should R1's ge-0/0/0 output drops show?", options: [{ id: "a", label: "Two more than before the test" }, { id: "b", label: "Zero" }, { id: "c", label: "The total since boot, whatever it is" }], correctId: "a", explanation: "Compare deltas, not lifetime totals — and the delta should match the captures." },
  { id: "q-fw", prompt: "SYNs reach SERVER's capture, no answer leaves, `ss -tan` shows no SYN-RECV. Most likely?", options: [{ id: "a", label: "A host firewall drops the SYN before TCP sees it" }, { id: "b", label: "The server's gateway is wrong" }, { id: "c", label: "The port is closed" }], correctId: "a", explanation: "A wrong gateway leaves SYN-RECV and ARP requests; a closed port answers RST." },
];

export function PaDeepDiveContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="pd-why" eyebrow="Foundation" title="Why look at packets" tone="cyan">
        <p>
          Logs say what a program thought happened; counters say how often something happened; a packet capture says <b className="text-pv-text">what actually crossed one point, when, in which order</b>. It is the only evidence that settles disputes between teams — “the server never answers” versus “the network loses the answers” — because both sides can read the same frames.
        </p>
        <CompareCards
          items={[
            { title: "Capture", tone: "cyan", tag: "what crossed here", points: ["exact frames and timing", "only at one point", "only what was seen"] },
            { title: "Counters", tone: "violet", tag: "how often", points: ["drops the capture can't see", "no detail, totals only", "compare deltas"] },
            { title: "Endpoint state", tone: "success", tag: "what the host did", points: ["sockets, services, firewall", "explains silence", "ss, systemctl, iptables"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="pd-methods" eyebrow="Foundation" title="Capture methods" tone="cyan">
        <DiagramFrame caption="Each method has its own blind spots.">
          <CaptureMethodsDiagram />
        </DiagramFrame>
        <FieldTable
          title="Methods in this lesson"
          accent="cyan"
          columns={["Method", "Where", "Strength", "Blind spot"]}
          rows={[
            ["Host capture", "CLIENT, SERVER (tcpdump)", "exactly what the host's stack sent and received", "nothing about the path; offload can distort"],
            ["SPAN / analyzer", "SW1 ge-0/0/1 → ge-0/0/23", "no change to the hosts", "only configured directions; can oversubscribe"],
            ["Router monitor", "R1 (monitor traffic)", "both sides of the suspect device", "on hardware platforms only Routing-Engine traffic; short-lived"],
            ["TAP", "inline on a link", "complete, passive", "needs hardware and a maintenance window"],
          ]}
        />
        <Callout tone="warning" title="monitor traffic on real routers" icon="!">
          On Junos platforms that forward in hardware (MX, PTX, EX, SRX), <Mono>monitor traffic interface</Mono> captures only packets the Routing Engine sends or receives — routing protocols, pings to the router, management. Transit traffic never reaches it. To capture transit on a router you mirror the interface (port mirroring / analyzer) or use a filter-based packet capture. The lab lets R1&apos;s monitor see transit frames so the bracketing can be practised on both sides of one device.
        </Callout>
        <CliPanel run={paCli(PA_HEALTHY, "SW1", "show forwarding-options analyzer")} caption="Junos · SW1 — the analyzer: both directions of ge-0/0/1, out of ge-0/0/23" />
        <CliPanel run={{ prompt: "admin@SW1# ", command: "show forwarding-options analyzer", output: "CAP {\n    input {\n        ingress {\n            interface ge-0/0/1.0;\n        }\n        egress {\n            interface ge-0/0/1.0;\n        }\n    }\n    output {\n        interface ge-0/0/23.0;\n    }\n}" }} caption="Junos · SW1 configuration — ingress = frames received from CLIENT, egress = frames sent to CLIENT" />
      </GuideSection>

      <GuideSection id="pd-files" eyebrow="Foundation" title="Files, snap length and clocks" tone="violet">
        <p>
          Production captures run into a <b className="text-pv-text">ring buffer</b> (<Mono>tcpdump -w file -C size -W count</Mono>) and are read later with <Mono>-r</Mono>, as the lab does. The <b className="text-pv-text">snap length</b> limits how many bytes of each packet are kept: the lab&apos;s files store whole packets (262144), Junos <Mono>monitor traffic</Mono> keeps 96 bytes — enough for headers. Every capture has its own <b className="text-pv-text">clock</b>: when you compare timestamps across devices, compare intervals within one capture, and use NTP-synchronised clocks before comparing absolute times.
        </p>
        <CliPanel run={paOnly(PA_HEALTHY, "CLIENT", "tcpdump -nn -r /var/tmp/eth0.pcap arp", /./, 1)} caption="Linux · CLIENT — the file header names the link type and snap length" />
      </GuideSection>

      <GuideSection id="pd-lines" eyebrow="Reading captures" title="Anatomy of a tcpdump line" tone="ip">
        <CliPanel run={paOnly(PA_HEALTHY, "CLIENT", "tcpdump -nn -r /var/tmp/eth0.pcap tcp", /length 120/)} caption="Linux · CLIENT — the 120-byte request" />
        <FieldTable
          title="Field by field"
          accent="ip"
          columns={["Field", "Here", "Meaning"]}
          rows={[
            ["Timestamp", <Mono key="1">10:00:10.000470</Mono>, "when this capture saw it (µs)"],
            ["Source.port", <Mono key="2">10.10.10.10.51000</Mono>, "CLIENT's ephemeral port"],
            ["Destination.port", <Mono key="3">10.20.20.20.443</Mono>, "the service"],
            ["Flags", <Mono key="4">[P.]</Mono>, "PSH + ACK: data, deliver it now"],
            ["seq", <Mono key="5">1:121</Mono>, "relative bytes 1–120 of CLIENT's stream"],
            ["ack", <Mono key="6">1</Mono>, "next byte expected from SERVER"],
            ["win", <Mono key="7">502</Mono>, "receive window (scaled by wscale 7)"],
            ["length", <Mono key="8">120</Mono>, "TCP payload bytes"],
          ]}
        />
        <p className="text-sm text-pv-text-muted">Flags are printed as letters: S SYN, F FIN, R RST, P PSH, a dot for ACK. <Mono>-e</Mono> adds the Ethernet header, <Mono>-v</Mono> the IP header (TTL, ID, total length), <Mono>-S</Mono> absolute sequence numbers, <Mono>-nn</Mono> keeps addresses and ports numeric.</p>
      </GuideSection>

      <GuideSection id="pd-filters" eyebrow="Reading captures" title="Filters" tone="ip">
        <p>A filter turns a file into one question. Primitives combine with <Mono>and</Mono> and <Mono>not</Mono>: <Mono>host</Mono>, <Mono>src host</Mono>, <Mono>dst host</Mono>, <Mono>port</Mono>, <Mono>tcp</Mono>, <Mono>arp</Mono>, <Mono>icmp</Mono>.</p>
        <CliPanel run={paCli(T.gateway, "SERVER", "tcpdump -nn -r /var/tmp/eth0.pcap icmp")} caption="Linux · SERVER — only ICMP: echo requests arrive, no reply leaves" />
        <CliPanel run={paOnly(T.gateway, "SERVER", "tcpdump -nn -r /var/tmp/eth0.pcap arp", /./, 1)} caption="Linux · SERVER — only ARP: who-has for the configured gateway" />
        <FieldTable
          title="Useful filters"
          accent="cyan"
          columns={["Goal", "tcpdump", "Wireshark display filter"]}
          rows={[
            ["One connection", <Mono key="1">port 51000</Mono>, <Mono key="1w">tcp.port == 51000</Mono>],
            ["Only the server's answers", <Mono key="2">src host 10.20.20.20</Mono>, <Mono key="2w">ip.src == 10.20.20.20</Mono>],
            ["Resets", <Mono key="3">&apos;tcp[tcpflags] &amp; tcp-rst != 0&apos;</Mono>, <Mono key="3w">tcp.flags.reset == 1</Mono>],
            ["Retransmissions", "(analyse afterwards)", <Mono key="4w">tcp.analysis.retransmission</Mono>],
          ]}
        />
      </GuideSection>

      <GuideSection id="pd-tuple" eyebrow="Reading captures" title="Five-tuple and correlation" tone="ip">
        <DiagramFrame caption="Match on what does not change.">
          <CorrelationDiagram />
        </DiagramFrame>
        <p>
          To say “this is the same packet” across captures, match the five-tuple plus something unique within the connection: the <b className="text-pv-text">sequence and acknowledgment numbers</b> (absolute, with <Mono>-S</Mono>), and the <b className="text-pv-text">IP ID</b> (<Mono>-v</Mono>). A retransmission repeats the sequence number but usually not the timing — two identical SYNs one second apart are the same request sent twice, not two requests.
        </p>
      </GuideSection>

      <GuideSection id="pd-ttl" eyebrow="Reading captures" title="TTL and MAC rewrites" tone="ip">
        <DiagramFrame caption="Switches never touch TTL; every router decrements it.">
          <TtlDiagram />
        </DiagramFrame>
        <CliPanel run={paOnly(PA_HEALTHY, "SERVER", "tcpdump -nnv -r /var/tmp/eth0.pcap tcp", /^$/, 3)} caption="Linux · SERVER — TTL 63: one router hop from CLIENT" />
        <p className="text-sm text-pv-text-muted">An unexpected TTL is evidence too: a lower value than expected means an extra hop (a detour); a different initial value (128, 255) means a different sender than you thought — a middlebox answering on the server&apos;s behalf, for example.</p>
      </GuideSection>

      <GuideSection id="pd-flags" eyebrow="TCP on the wire" title="TCP flags" tone="success">
        <DiagramFrame caption="Read the flag byte before the payload.">
          <FlagsDiagram />
        </DiagramFrame>
        <FieldTable
          title="What each flag pattern means"
          accent="success"
          columns={["tcpdump", "Name", "Meaning"]}
          rows={[
            [<Mono key="s">[S]</Mono>, "SYN", "open, with my ISN"],
            [<Mono key="sa">[S.]</Mono>, "SYN-ACK", "accept, with my ISN"],
            [<Mono key="a">[.]</Mono>, "ACK", "acknowledge (no data)"],
            [<Mono key="p">[P.]</Mono>, "PSH-ACK", "data, push to the application"],
            [<Mono key="f">[F.]</Mono>, "FIN-ACK", "I have finished sending"],
            [<Mono key="r">[R.]</Mono>, "RST-ACK", "abort / nothing here"],
          ]}
        />
      </GuideSection>

      <GuideSection id="pd-states" eyebrow="TCP on the wire" title="Socket states" tone="success">
        <p>Captures show the conversation; <Mono>ss -tan</Mono> shows what each host believes about it. The two must tell the same story.</p>
        <FieldTable
          title="States you meet while troubleshooting"
          accent="success"
          columns={["State", "Where", "Means"]}
          rows={[
            ["LISTEN", "server", "a service accepts connections on the port"],
            ["SYN-SENT", "client", "SYN sent, no SYN-ACK yet"],
            ["SYN-RECV", "server", "SYN-ACK sent (or wanted to send), no final ACK yet"],
            ["ESTABLISHED", "both", "handshake complete"],
            ["TIME-WAIT", "the side that closed first", "waiting out stray duplicates"],
          ]}
        />
        <CliPanel run={paCli(PA_HEALTHY, "CLIENT", "ss -tan")} caption="Linux · CLIENT — after the healthy fetch: TIME-WAIT" />
        <CliPanel run={paCli(T.gateway, "SERVER", "ss -tan")} caption="Linux · SERVER — wrong gateway: SYN-RECV, the answer never left" />
      </GuideSection>

      <GuideSection id="pd-retx" eyebrow="TCP on the wire" title="Retransmission and backoff" tone="warning">
        <DiagramFrame caption="The gaps between retries are evidence too.">
          <BackoffDiagram />
        </DiagramFrame>
        <p>
          Without an acknowledgment, TCP sends again: a SYN after 1 s, then 2 s later, then 4 s… (Linux&apos;s initial RTO is 1 s for the handshake). <Mono>nc -w {NC_TIMEOUT_S}</Mono> gives up after {NC_TIMEOUT_S} s — three SYNs, at 0, 1 and 3 s. Once data flows, the timer is computed from the measured round-trip time (200 ms minimum on Linux).
        </p>
        <CliPanel run={paOnly(T.hostfw, "CLIENT", "tcpdump -nn -r /var/tmp/eth0.pcap tcp", /./, 1)} caption="Linux · CLIENT — host-firewall ticket: SYNs at 10, 11 and 13 s, then nc gives up" />
        <CliPanel run={paOnly(PA_INC, "CLIENT", "tcpdump -nn -r /var/tmp/eth0.pcap port 51002", /F\./)} caption="Linux · CLIENT — the incident's third connection: SERVER's FIN arrives 200 ms late (retransmitted)" />
      </GuideSection>

      <GuideSection id="pd-dupack" eyebrow="TCP on the wire" title="Duplicate ACKs" tone="warning">
        <DiagramFrame caption="Loss in the middle of a data stream announces itself through repeated acknowledgments.">
          <DupAckDiagram />
        </DiagramFrame>
        <p>Each segment that arrives after a gap makes the receiver repeat its acknowledgment of the missing byte. Three duplicates let the sender retransmit without waiting for the timer (fast retransmit, RFC 5681). A handshake has no data stream to generate duplicates — which is why handshake loss always costs a full timeout. The lab&apos;s conversations are one request and one response, so you will meet timeouts there, not duplicate ACKs.</p>
      </GuideSection>

      <GuideSection id="pd-rst" eyebrow="TCP on the wire" title="RST vs silence vs ICMP" tone="danger">
        <DiagramFrame caption="Refusal is fast and explicit; loss is slow and silent.">
          <RstSilenceDiagram />
        </DiagramFrame>
        <CompareCards
          items={[
            { title: "RST,ACK", tone: "danger", tag: "refused", points: ["immediate", "host reached, port closed", "nc: Connection refused"] },
            { title: "Silence", tone: "warning", tag: "timed out", points: ["retransmissions, then give up", "lost or silently filtered", "nc: Connection timed out"] },
            { title: "ICMP unreachable", tone: "violet", tag: "rejected", points: ["immediate, from a router or host", "no route / admin prohibited", "nc: No route to host"] },
          ]}
        />
        <CliPanel run={paOnly(T.closed, "CLIENT", "tcpdump -nn -r /var/tmp/eth0.pcap tcp", /./, 1)} caption="Linux · CLIENT — closed port: answered in 0.2 ms" />
      </GuideSection>

      <GuideSection id="pd-bracket" eyebrow="Method" title="Bracketing" tone="ip">
        <p>
          Order the capture points along the path. For the missing frame, find the <b className="text-pv-text">last point that has it</b> and the <b className="text-pv-text">first point that doesn&apos;t</b>. Whatever lies between them — a cable, a switch, one device&apos;s forwarding — is where it was lost. Then capture either side of that device to narrow further. Five points let the lab bracket R1 from both sides.
        </p>
        <PaBracket s={PA_INC} i={0} title="Incident, connection 51000 (from the lab)" />
        <Callout tone="cyan" title="Direction matters" icon="i">
          Bracket each direction separately: a request path can be perfect while the reply path loses frames. In the incident every SYN is in all five captures; only SYN-ACKs disappear, and only between R1 ge-0/0/1 and ge-0/0/0.
        </Callout>
      </GuideSection>

      <GuideSection id="pd-counters" eyebrow="Method" title="Counters as evidence" tone="violet">
        <p>
          A capture can&apos;t show a frame that was never transmitted. The device that discarded it can count it — output drops, queue tail drops, policer discards, firewall rule hits. Counters are lifetime totals: <b className="text-pv-text">clear or snapshot them, run the test, read the delta</b>, and check that the delta equals the number of frames missing from the captures.
        </p>
        <CliPanel run={paOnly(PA_INC, "R1", "show interfaces queue ge-0/0/0", /Queue:|Queued|Transmitted:|Packets|Tail-dropped/)} caption="Junos · R1 — queue 0: 8 queued, 6 transmitted, 2 tail-dropped" />
        <CliPanel run={paCli(T.hostfw, "SERVER", "sudo iptables -L INPUT -n -v")} caption="Linux · SERVER — the DROP rule counted all three SYNs" />
      </GuideSection>

      <GuideSection id="pd-pitfalls" eyebrow="Method" title="Capture pitfalls" tone="warning">
        <DiagramFrame caption="Know your instrument before trusting it.">
          <LimitsDiagram />
        </DiagramFrame>
        <FieldTable
          title="Before you trust a capture"
          accent="warning"
          columns={["Pitfall", "Symptom", "Check"]}
          rows={[
            ["One-direction mirror", "requests but no replies", "show forwarding-options analyzer"],
            ["Mirror oversubscription", "random gaps under load", "SPAN port output drops"],
            ["Kernel capture drops", "“packets dropped by kernel” > 0", "tcpdump's exit summary"],
            ["Offload (TSO/GRO)", "segments bigger than the MTU", "capture on the wire, or disable offload"],
            ["Short snap length", "truncated payload", "-s / snapshot length"],
            ["Unsynchronised clocks", "replies “before” requests", "compare intervals, use NTP"],
          ]}
        />
        <CliPanel run={paCli(T.spanrx, "CAPTURE", "tcpdump -nn -r /var/tmp/span.pcap")} caption="Linux · CAPTURE — an ingress-only mirror: a working connection that looks unanswered" />
      </GuideSection>

      <GuideSection id="pd-timing" eyebrow="Method" title="Reading time" tone="violet">
        <DiagramFrame caption="Where the delay sits tells you who is slow.">
          <TimingDiagram />
        </DiagramFrame>
        <p>
          At the client, SYN → SYN-ACK is one full round trip (0.21 ms in the healthy fetch). At the server, SYN-ACK → ACK is the round trip on the client&apos;s side (0.18 ms). The server&apos;s own think time is request → response (0.4 ms here). A delay of exactly 1 s, 3 s or 200 ms is almost never “slowness” — it is a <b className="text-pv-text">retransmission timer</b>, and therefore a loss.
        </p>
        <PaResult s={PA_INC} title="The lab: the incident's three tests" />
      </GuideSection>

      <GuideSection id="pd-signatures" eyebrow="Troubleshooting" title="Failure signatures" tone="danger">
        <FailureSignatures
          items={[
            { tag: "LOSS", title: "Frames lost in a device", tone: "danger", points: ["timer-length delays (1 s, 200 ms)", "seen on ingress, missing on egress", "drop counter delta matches"] },
            { tag: "RST", title: "Closed port", tone: "danger", points: ["RST,ACK in under a millisecond", "no LISTEN on the port"] },
            { tag: "FW", title: "Silent host filter", tone: "warning", points: ["request in the host's capture", "no reply, no SYN-RECV", "rule hit counter rises"] },
            { tag: "GW", title: "Reply can't leave the host", tone: "warning", points: ["SYN-RECV, ARP for the gateway", "everything to other subnets fails"] },
            { tag: "SPAN", title: "Incomplete evidence", tone: "violet", points: ["one direction missing in one capture", "complete at the endpoints"] },
            { tag: "ICMP", title: "Rejected in the path", tone: "violet", points: ["ICMP unreachable from a router", "immediate failure"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="pd-ladder" eyebrow="Troubleshooting" title="The troubleshooting ladder" tone="danger">
        <TroubleshootingFlow
          steps={[
            { question: "What does the user see — refused, silent, slow?", look: "nc / curl outcome and timing" },
            { question: "Did the request reach the server?", look: "the server's own capture" },
            { question: "Did the server answer?", look: "the server's capture; ss -tan; iptables counters" },
            { question: "Where does the answer disappear?", look: "bracket with the captures in between" },
            { question: "What do the counters there say?", look: "show interfaces … extensive / queue — deltas" },
            { question: "Is every capture complete?", look: "analyzer directions, kernel drops, snap length" },
          ]}
        />
      </GuideSection>

      <GuideSection id="pd-tickets" eyebrow="Troubleshooting" title="Five faults, evidence to proof" tone="danger">
        <FailureWalk title="1 · Sometimes it takes a second to connect" normal="Every connection opens in about 0.2 ms." change={`A test shaper (64 kbit/s) was left on R1 ge-0/0/0; it tail-drops one in ${DROP_EVERY} frames.`} evidence={<CliPanel run={paOnly(PA_INC, "R1", "monitor traffic interface ge-0/0/0 no-resolve", /51000.*Flags \[S/)} caption="Junos · R1 ge-0/0/0 — the first SYN-ACK was never transmitted" />} next="R1 ge-0/0/1 has it (In) → loss inside R1; output drops 2 = the two missing frames." fix={<Mono>R1: delete class-of-service interfaces ge-0/0/0 shaping-rate → commit</Mono>} proof={<PaResult s={PA_FIXED} from={3} title="Three fresh connections" />} />
        <FailureWalk title="2 · The portal is down" normal="SERVER listens on 0.0.0.0:443." change="Patching left nginx stopped." evidence={<CliPanel run={paCli(T.closed, "SERVER", "ss -tln")} caption="Linux · SERVER — no :443 listener" />} next="RST,ACK in 0.2 ms: reachable, refused. systemctl status nginx: inactive." fix={<Mono>SERVER: sudo systemctl start nginx</Mono>} proof={<PaResult s={F.closed} from={2} title="A fresh connection" />} />
        <FailureWalk title="3 · The portal just spins" normal="INPUT policy ACCEPT, no rules." change="A rule dropping TCP/443 was added to SERVER's host firewall." evidence={<CliPanel run={paCli(T.hostfw, "SERVER", "sudo iptables -L INPUT -n -v")} caption="Linux · SERVER — DROP tcp dpt:443, 3 packets" />} next="SYNs in SERVER's capture, no SYN-RECV, ping works: dropped before TCP." fix={<Mono>SERVER: sudo iptables -D INPUT -p tcp --dport 443 -j DROP</Mono>} proof={<PaResult s={F.hostfw} from={2} title="A fresh connection" />} />
        <FailureWalk title="4 · Nothing reaches the server any more" normal={`SERVER's default route is via ${GOOD_GW} (R1).`} change={`The “cleaned-up” config points it at ${BAD_GW}, which nobody owns.`} evidence={<CliPanel run={paCli(T.gateway, "SERVER", "ip route")} caption="Linux · SERVER — default via the wrong address" />} next="SERVER receives the SYN, keeps SYN-RECV, ARPs for .254 — no reply can leave." fix={<Mono>SERVER: sudo ip route replace default via {GOOD_GW}</Mono>} proof={<PaResult s={F.gateway} from={2} title="Fresh connection and ping" />} />
        <FailureWalk title="5 · The capture says the server never answers" tone="warning" normal="SW1's analyzer mirrors ge-0/0/1 in both directions." change="The session was rebuilt with ingress only." evidence={<CliPanel run={paOnly(T.spanrx, "SW1", "show forwarding-options analyzer", /monitored|Output/)} caption="Junos · SW1 — egress monitored: None" />} next="nc succeeds and CLIENT's own capture has the SYN-ACK: the evidence is incomplete, not the network." fix={<Mono>SW1: set forwarding-options analyzer CAP input egress interface ge-0/0/1 → commit</Mono>} proof={<CliPanel run={paOnly(F.spanrx, "CAPTURE", "tcpdump -nn -r /var/tmp/span.pcap", /Flags \[S/)} caption="Linux · CAPTURE — a fresh capture now shows the SYN-ACK" />} />
      </GuideSection>

      <GuideSection id="pd-workflow" eyebrow="Troubleshooting" title="A packet-analysis workflow" tone="cyan">
        <DiagramFrame caption="The same method in every Troubleshooting lesson.">
          <DiagramSvg h={82} label="Troubleshooting workflow">
            <WorkflowDiagram notes={["one service", "bracket path", "2+ captures", "one cause", "counters", "one change", "re-capture"]} />
          </DiagramSvg>
        </DiagramFrame>
        <DiagramFrame caption="The evidence ladder — start from facts, find the lowest broken dependency.">
          <DiagramSvg h={210} label="Evidence ladder with eight rungs from physical to policy">
            <LadderDiagram
              rows={[
                { rung: "Physical / interface", evidence: "up/up? errors, drops (by delta)", status: "suspect" },
                { rung: "Ethernet / VLAN", evidence: "MAC learned? right VLAN?", status: "ok" },
                { rung: "ARP / neighbor", evidence: "next-hop MAC resolved?", status: "ok" },
                { rung: "IP addressing", evidence: "address, prefix, gateway", status: "ok" },
                { rung: "Routing / forwarding", evidence: "route both ways? TTL?", status: "ok" },
                { rung: "Transport", evidence: "handshake, retransmissions, RST", status: "ok" },
                { rung: "Application", evidence: "listening? responding?", status: "skip" },
                { rung: "Policy / service", evidence: "filters, shapers, rate limits", status: "skip" },
              ]}
            />
          </DiagramSvg>
        </DiagramFrame>
        <FlowSteps
          steps={[
            { title: "Filter to one conversation", body: "Five-tuple first; everything else is noise.", tone: "cyan" },
            { title: "Compare with a baseline", body: "Which frame or gap is new?", tone: "violet" },
            { title: "Bracket the loss", body: "Captures either side of the suspect device.", tone: "warning" },
            { title: "Corroborate, change one thing, re-test", body: "Counters and endpoint state; then fresh traffic.", tone: "success" },
          ]}
        />
        <CompareCards
          items={[
            { title: "Evidence", tone: "success", tag: "observation", points: ["SYN-ACK In on R1 ge-0/0/1 at 10:00:10.000150", "absent Out on ge-0/0/0", "output drops +2 for 2 missing frames"] },
            { title: "Not evidence", tone: "danger", tag: "assumption", points: ["'443 must be blocked'", "'the server is slow'", "a counter's lifetime total"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="pd-myths" eyebrow="Master it" title="Common misconceptions" tone="warning">
        <Misconceptions
          items={[
            { myth: "If the capture doesn't show it, it was never sent.", correction: "It wasn't observed at that point. Check the mirror, the next capture and the counters." },
            { myth: "Slow means overloaded.", correction: "A delay of exactly 1 s or 200 ms is a retransmission timer — a loss." },
            { myth: "Ping works, so the network is fine.", correction: "ICMP proves the path for ICMP. TCP/443 can be dropped, refused or shaped separately." },
            { myth: "A RST means a firewall blocked it.", correction: "A RST is an answer: the host was reached and nothing listens (or something chose to reject)." },
            { myth: "One capture point is enough.", correction: "One point shows symptoms; two points around a device locate the fault." },
          ]}
        />
      </GuideSection>

      <GuideSection id="pd-quiz" eyebrow="Master it" title="Knowledge check" tone="cyan">
        <KnowledgeQuiz questions={QUIZ} />
      </GuideSection>

      <GuideSection id="pd-explain" eyebrow="Master it" title="Can you explain it?" tone="violet">
        <ExplainIt
          items={[
            { q: "Why did the slow connection take exactly one second?", a: "The SYN-ACK was lost; the client's SYN retransmission timer (1 s) fired; the second SYN-ACK got through." },
            { q: "How do you know R1 lost it, not SERVER?", a: "SERVER's capture shows the SYN-ACK leaving, R1 ge-0/0/1 shows it arriving, R1 ge-0/0/0 never transmits it — and R1's output drops rose by the number of missing frames." },
            { q: "How do you tell a closed port from a firewall drop in one capture?", a: "Closed: RST,ACK at once. Dropped: silence and SYN retransmissions at 1 s, 3 s…" },
            { q: "Why can a working connection look unanswered on a SPAN capture?", a: "The analyzer mirrors only the configured directions; with ingress only, nothing sent toward CLIENT is copied." },
            { q: "What proves the shaper fix?", a: "No shaping-rate on ge-0/0/0, three fresh connections without retransmission, and no new drops." },
          ]}
        />
      </GuideSection>

      <GuideSection id="pd-glossary" eyebrow="Master it" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "SPAN / analyzer", def: "Switch session copying a port's frames to a monitor port (Junos: forwarding-options analyzer)." },
            { term: "TAP", def: "Passive inline device copying a link's traffic." },
            { term: "Snap length", def: "How many bytes of each packet a capture stores." },
            { term: "RTO", def: "Retransmission timeout: how long TCP waits for an acknowledgment before resending." },
            { term: "Duplicate ACK", def: "A repeated acknowledgment of the same byte, sent when data arrives after a gap." },
            { term: "Fast retransmit", def: "Resending after three duplicate ACKs instead of waiting for the RTO." },
            { term: "SYN-RECV", def: "Server socket state between SYN received and the final ACK." },
            { term: "Shaper", def: "Egress rate limit that queues excess traffic and tail-drops what doesn't fit." },
          ]}
        />
      </GuideSection>

      <GuideSection id="pd-mental" eyebrow="Master it" title="Mental model" tone="violet">
        <p>A parcel with scan points: the label never changes, each depot stamps it. Find the last scan and the first missing one; read that depot&apos;s ledger; distrust a scanner that only reads one direction; and after the fix, send fresh parcels.</p>
      </GuideSection>

      <GuideSection id="pd-practice" eyebrow="Master it" title="Practice in the lab" tone="violet">
        <p>Six Learn levels, then the workspace: five capture points with a frame-by-frame bracket, R1&apos;s counters and queues, the SW1 analyzer, Junos and Linux consoles, five challenges and the five tickets above.</p>
        <LabBridge />
        <PresentationBridge>Rewatch the Packet Analysis presentation.</PresentationBridge>
      </GuideSection>
    </div>
  );
}
