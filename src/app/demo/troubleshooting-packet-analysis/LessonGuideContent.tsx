import { Callout, ChecklistCard, DIAGRAM as D, DiagramFrame, DiagramSvg, DLink, DNode, DPill, FlowSteps, Glossary, GuideSection, Mono } from "@/components/lesson/GuideBlocks";
import { DFieldRow, DTable } from "@/components/lesson/FundamentalsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { LadderDiagram, SeqLanes, WorkflowDiagram } from "@/components/lesson/TroubleshootingGuideSvg";
import { FLOW, INITIAL_TTL, PA, PA_MAC, PA_TIMES as T, REQ_LEN, RESP_LEN, RTO_US, SERVICE_PORT, secs } from "@/lib/sim-engine/scenarios/troubleshootingPacketAnalysis";

export const PA_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "pal-mission", label: "The mission" },
  { id: "pal-method", label: "The method" },
  { id: "pal-topology", label: "Topology & capture points" },
  { id: "pal-changes", label: "What changes between captures" },
  { id: "pal-handshake", label: "The handshake" },
  { id: "pal-seqack", label: "Sequence & acknowledgment" },
  { id: "pal-close", label: "Orderly close" },
  { id: "pal-flow", label: "One flow = one five-tuple" },
  { id: "pal-incident", label: "The slow open" },
  { id: "pal-correlate", label: "Correlating captures" },
  { id: "pal-signatures", label: "Loss vs refusal" },
  { id: "pal-counters", label: "Testing with counters" },
  { id: "pal-ladder", label: "Evidence ladder" },
  { id: "pal-verify", label: "Verification" },
  { id: "pal-glossary", label: "Glossary" },
];

const H = FLOW.healthy;
const I = FLOW.incident;

function TopologyDiagram() {
  return (
    <DiagramSvg h={170} label="CLIENT, SW1, R1 and SERVER in a line with three capture points: SW1 mirror of CLIENT's port, R1 ge-0/0/1, SERVER eth0">
      <DNode x={70} y={70} label="CLIENT" sub={`${PA.client}/24`} accent={D.cyan} w={112} />
      <DNode x={235} y={70} label="SW1" sub="access switch" accent={D.eth} w={100} />
      <DNode x={405} y={70} label="R1" sub={`${PA.gw} | ${PA.r1Srv}`} accent={D.violet} w={130} />
      <DNode x={575} y={70} label="SERVER" sub={`${PA.server}:${SERVICE_PORT}`} accent={D.success} w={118} />
      <DLink x1={126} y1={70} x2={185} y2={70} />
      <DLink x1={285} y1={70} x2={340} y2={70} />
      <DLink x1={470} y1={70} x2={516} y2={70} />
      <DPill x={235} y={126} text="① CLIENT side (SPAN of ge-0/0/1)" color={D.warning} w={200} />
      <DPill x={425} y={20} text="② R1 ge-0/0/1" color={D.warning} w={110} />
      <DPill x={575} y={126} text="③ SERVER eth0" color={D.warning} w={110} />
      <text x={320} y={160} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        Clocks synchronized in this lab. Each capture shows only what passed its own point.
      </text>
    </DiagramSvg>
  );
}

function ChangesDiagram() {
  return (
    <DiagramSvg h={170} label="The same SYN at capture 1 and capture 3: TTL and MAC addresses differ, IPs, ports and sequence do not">
      <DTable
        x={30}
        y={8}
        title={`One SYN (:${H.sport}) seen at two capture points`}
        cols={[
          { label: "FIELD", w: 150 },
          { label: "① CLIENT SIDE", w: 215 },
          { label: "③ SERVER", w: 215 },
        ]}
        rows={[
          ["Ethernet src → dst", `${PA_MAC.CLIENT.slice(-5)} → ${PA_MAC.R1_LAN.slice(-5)} (R1)`, `${PA_MAC.R1_SRV.slice(-5)} (R1) → ${PA_MAC.SERVER.slice(-5)}`],
          ["IPv4 TTL", String(INITIAL_TTL), `${INITIAL_TTL - 1} (R1 routed it)`],
          ["IPv4 src → dst", `${PA.client} → ${PA.server}`, "same"],
          ["TCP ports", `${H.sport} → ${SERVICE_PORT}`, "same"],
          ["TCP seq / flags", `${H.isnC} / SYN`, "same"],
        ]}
        highlight={{ row: 1, color: D.warning }}
      />
    </DiagramSvg>
  );
}

function HandshakeDiagram() {
  return (
    <DiagramSvg h={150} label="Three-way handshake: SYN seq 1000, SYN-ACK seq 5000 ack 1001, ACK seq 1001 ack 5001">
      <SeqLanes
        lanes={[
          { x: 150, label: "CLIENT", color: D.cyan },
          { x: 490, label: "SERVER", color: D.success },
        ]}
        msgs={[
          { from: 0, to: 1, label: `SYN · seq ${H.isnC} · flags 0x02`, sub: "CLOSED → SYN_SENT · MSS 1460" },
          { from: 1, to: 0, label: `SYN, ACK · seq ${H.isnS} · ack ${H.isnC + 1} · 0x12`, sub: "LISTEN → SYN_RECEIVED — the port is open", color: D.success },
          { from: 0, to: 1, label: `ACK · seq ${H.isnC + 1} · ack ${H.isnS + 1} · 0x10`, sub: "both ESTABLISHED" },
        ]}
      />
    </DiagramSvg>
  );
}

function SeqAckDiagram() {
  return (
    <DiagramSvg h={150} label="Data exchange: request seq 1001 length 120, response ack 1121 length 380, client ack 5381">
      <SeqLanes
        lanes={[
          { x: 150, label: "CLIENT", color: D.cyan },
          { x: 490, label: "SERVER", color: D.success },
        ]}
        msgs={[
          { from: 0, to: 1, label: `PSH, ACK · seq ${H.isnC + 1} · len ${REQ_LEN}`, sub: `bytes ${H.isnC + 1}–${H.isnC + REQ_LEN}` },
          { from: 1, to: 0, label: `PSH, ACK · seq ${H.isnS + 1} · ack ${H.isnC + 1 + REQ_LEN} · len ${RESP_LEN}`, sub: `ack = next byte expected: ${H.isnC + 1} + ${REQ_LEN}`, color: D.success },
          { from: 0, to: 1, label: `ACK · ack ${H.isnS + 1 + RESP_LEN}`, sub: "cumulative: every response byte received" },
        ]}
      />
    </DiagramSvg>
  );
}

function CloseDiagram() {
  return (
    <DiagramSvg h={150} label="Orderly close: client FIN-ACK, server FIN-ACK acknowledging the FIN, client final ACK">
      <SeqLanes
        lanes={[
          { x: 150, label: "CLIENT", color: D.cyan },
          { x: 490, label: "SERVER", color: D.success },
        ]}
        msgs={[
          { from: 0, to: 1, label: `FIN, ACK · seq ${H.isnC + 1 + REQ_LEN} · 0x11`, sub: "a FIN uses one sequence number" },
          { from: 1, to: 0, label: `FIN, ACK · seq ${H.isnS + 1 + RESP_LEN} · ack ${H.isnC + 2 + REQ_LEN}`, color: D.success },
          { from: 0, to: 1, label: `ACK · ack ${H.isnS + 2 + RESP_LEN}`, sub: "no RST, no retransmission: a clean baseline" },
        ]}
      />
    </DiagramSvg>
  );
}

function TupleDiagram() {
  const f = (label: string, sub: string, w: number, color: string, strong?: boolean) => ({ label, sub, w, color, strong });
  return (
    <DiagramSvg h={130} label="Five-tuple: protocol TCP, source 10.10.10.10 port 51000, destination 10.20.20.20 port 443">
      <DFieldRow x={30} y={16} fields={[f("Protocol", "6 (TCP)", 90, D.tcp, true), f("Source IP", PA.client, 130, D.ip), f("Src port", String(H.sport), 90, D.tcp), f("Destination IP", PA.server, 140, D.ip), f("Dst port", String(SERVICE_PORT), 90, D.tcp)]} />
      <text x={320} y={92} textAnchor="middle" fill={D.muted} fontSize={10}>
        Replies swap source and destination but belong to the same flow. A new connection gets a new source port.
      </text>
      <text x={320} y={110} textAnchor="middle" fill={D.muted} fontSize={10}>
        MACs and TTL are NOT part of the identity — they change hop by hop.
      </text>
    </DiagramSvg>
  );
}

function IncidentDiagram() {
  return (
    <DiagramSvg h={210} label="Slow open: SYN at 10.000050, the first SYN-ACK leaves SERVER and passes R1 but never reaches CLIENT, SYN retransmitted at 11.000050, second SYN-ACK arrives">
      <SeqLanes
        timeX={70}
        lanes={[
          { x: 130, label: "CLIENT", color: D.cyan },
          { x: 360, label: "R1", color: D.violet },
          { x: 560, label: "SERVER", color: D.success },
        ]}
        msgs={[
          { from: 0, to: 2, label: `SYN · seq ${I.isnC}`, time: secs(I.t0 + 50) },
          { from: 2, to: 1, label: `SYN, ACK · ack ${I.isnC + 1}`, time: secs(T.iSynAck), color: D.success },
          { from: 1, to: 0, label: "(not seen at ①)", time: "", drop: true },
          { from: 0, to: 2, label: `SYN · seq ${I.isnC} · retransmission`, time: secs(I.t0 + RTO_US + 50), color: D.warning },
          { from: 2, to: 0, label: `SYN, ACK · same seq/ack`, time: secs(T.iSynAck2), color: D.success },
        ]}
      />
    </DiagramSvg>
  );
}

function CorrelateDiagram() {
  return (
    <DiagramSvg h={150} label="Flow 51001 at three captures: SERVER and R1 see both SYN-ACKs, the CLIENT side sees only the second">
      <DTable
        x={20}
        y={8}
        title={`Flow :${I.sport} — what each capture recorded (handshake only)`}
        cols={[
          { label: "CAPTURE", w: 160 },
          { label: "SEGMENTS, IN ORDER", w: 440 },
        ]}
        rows={[
          ["③ SERVER eth0", "SYN · SYN, ACK · SYN [Retransmission] · SYN, ACK [Retransmission]"],
          ["② R1 ge-0/0/1", "SYN · SYN, ACK · SYN [Retransmission] · SYN, ACK [Retransmission]"],
          ["① CLIENT side", "SYN · SYN [Retransmission] · SYN, ACK   ← first SYN-ACK absent"],
        ]}
        highlight={{ row: 2, color: D.warning }}
      />
    </DiagramSvg>
  );
}

function SignatureDiagram() {
  return (
    <DiagramSvg h={200} label="Signatures: loss is silence and a timer; a closed port answers at once with RST, ACK">
      <text x={160} y={18} textAnchor="middle" fill={D.warning} fontSize={10.5} fontWeight={700}>
        Loss (this incident)
      </text>
      <text x={480} y={18} textAnchor="middle" fill={D.danger} fontSize={10.5} fontWeight={700}>
        Closed port (not this incident)
      </text>
      <line x1={320} y1={10} x2={320} y2={190} stroke={D.line} strokeDasharray="3 4" />
      <SeqLanes
        top={44}
        rowH={30}
        lanes={[
          { x: 50, label: "C", color: D.cyan },
          { x: 270, label: "S", color: D.success },
        ]}
        msgs={[
          { from: 0, to: 1, label: "SYN" },
          { from: 1, to: 0, label: "SYN, ACK", drop: true },
          { from: 0, to: 1, label: "SYN (+1 s)", color: D.warning },
          { from: 1, to: 0, label: "SYN, ACK", color: D.success },
        ]}
      />
      <SeqLanes
        top={44}
        rowH={30}
        lanes={[
          { x: 370, label: "C", color: D.cyan },
          { x: 590, label: "S", color: D.success },
        ]}
        msgs={[
          { from: 0, to: 1, label: "SYN" },
          { from: 1, to: 0, label: "RST, ACK · immediately", color: D.danger },
        ]}
      />
    </DiagramSvg>
  );
}

function CounterDiagram() {
  return (
    <DiagramSvg h={140} label="R1 ge-0/0/0 output drops 0 before the incident, 1 after the first SYN-ACK, still 1 after verification">
      <DTable
        x={60}
        y={8}
        title="R1 ge-0/0/0 (client-facing) — output drops"
        cols={[
          { label: "WHEN", w: 280 },
          { label: "VALUE", w: 110 },
          { label: "DELTA", w: 130 },
        ]}
        rows={[
          ["Before flow :51001", "0", "—"],
          ["After flow :51001's first SYN-ACK", "1", "+1"],
          ["After the verification connection", "1", "0 (no new drops)"],
        ]}
        highlight={{ row: 1, color: D.danger }}
      />
    </DiagramSvg>
  );
}

function LadderView() {
  return (
    <DiagramSvg h={150} label="Evidence ladder for this incident: the interface-level egress drop at R1 is the lowest failing dependency">
      <LadderDiagram
        rows={[
          { rung: "Physical / interface", evidence: "R1 ge-0/0/0 output drops +1 in the window", status: "fail" },
          { rung: "Ethernet / ARP", evidence: `${PA.gw} resolved · SW1 forwards unchanged`, status: "ok" },
          { rung: "IP / routing", evidence: "every SYN reaches SERVER", status: "ok" },
          { rung: "Transport", evidence: "1 SYN retransmission (a symptom)", status: "suspect" },
          { rung: "Application", evidence: "SYN-ACK sent · no RST", status: "ok" },
        ]}
      />
    </DiagramSvg>
  );
}

function VerifyDiagram() {
  const bar = (y: number, label: string, ms: number, color: string, text: string) => (
    <g>
      <text x={30} y={y + 13} fill={D.text} fontSize={10} fontWeight={700}>
        {label}
      </text>
      <rect x={170} y={y} width={Math.max(4, Math.min(420, ms * 0.4))} height={18} rx={4} fill={color} fillOpacity={0.35} stroke={color} />
      <text x={Math.max(180, Math.min(600, 178 + ms * 0.4)) + 6} y={y + 13} fill={color} fontSize={9.5} fontFamily="monospace" textAnchor={ms * 0.4 > 330 ? "end" : "start"}>
        {text}
      </text>
    </g>
  );
  return (
    <DiagramSvg h={130} label="SYN to established: healthy 0.85 ms, incident 1000.85 ms with one retransmission, repaired 0.85 ms">
      {bar(14, `:${H.sport} baseline`, 0.85, D.success, "0.85 ms · 0 retransmissions")}
      {bar(46, `:${I.sport} incident`, 1000.85, D.danger, "1000.85 ms · 1 retransmission")}
      {bar(78, `:${FLOW.verify.sport} after repair`, 0.85, D.success, "0.85 ms · 0 retransmissions")}
      <text x={320} y={122} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        SYN → ACK at the CLIENT-side capture (bar length to scale).
      </text>
    </DiagramSvg>
  );
}

export function PaLessonGuideContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="pal-mission" eyebrow="Mission" title="Read the evidence before you change anything" tone="cyan">
        <p>A packet capture is testimony from one place in the network. This lesson teaches you to read that testimony — which fields change and which do not, what the TCP flags say, how sequence numbers prove delivery — and then to combine several captures into a location for a fault.</p>
        <Callout tone="warning" title="Symptom ≠ diagnosis">
          &quot;It is slow to connect&quot; is what the user experiences. The captures will tell you what actually happened, and where.
        </Callout>
      </GuideSection>

      <GuideSection id="pal-method" eyebrow="Method" title="Define → Scope → Evidence → Hypothesis → Test → Repair → Verify" tone="violet">
        <DiagramFrame caption="Never guess, change something and hope.">
          <DiagramSvg h={82} label="Troubleshooting workflow">
            <WorkflowDiagram notes={["which service?", "where to look", "captures", "one cause", "2nd source", "one change", "same test"]} />
          </DiagramSvg>
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="pal-topology" eyebrow="Topology" title="Four devices, three capture points" tone="cyan">
        <DiagramFrame caption="Choose capture points that bracket the part of the path you suspect.">
          <TopologyDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="pal-changes" eyebrow="Capture point matters" title="What changes between captures" tone="ethernet">
        <DiagramFrame caption="Match copies of one packet by what does NOT change.">
          <ChangesDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="pal-handshake" eyebrow="Baseline" title="The three-way handshake" tone="tcp">
        <DiagramFrame caption="A SYN consumes one sequence number, so the SYN-ACK acknowledges ISN + 1.">
          <HandshakeDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="pal-seqack" eyebrow="Baseline" title="Sequence and acknowledgment numbers" tone="tcp">
        <DiagramFrame caption="Sequence numbers count bytes; an ACK names the next byte expected.">
          <SeqAckDiagram />
        </DiagramFrame>
        <p>
          The Window field (<Mono>64240</Mono>) is how many more bytes the receiver will accept before it must acknowledge. The application bytes here are a teaching abstraction — on a real 443 service they would be TLS records.
        </p>
      </GuideSection>

      <GuideSection id="pal-close" eyebrow="Baseline" title="An orderly close" tone="tcp">
        <DiagramFrame caption="Keep a clean capture as your baseline.">
          <CloseDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="pal-flow" eyebrow="Flow identity" title="One flow = one five-tuple" tone="ip">
        <DiagramFrame caption="Filter a capture to one flow before reading it.">
          <TupleDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="pal-incident" eyebrow="Incident" title="A connection that opens one second late" tone="danger">
        <DiagramFrame caption="Timestamps from the synchronized captures.">
          <IncidentDiagram />
        </DiagramFrame>
        <p>The client cannot tell whether its SYN or the answer was lost — it only knows nothing came back before its 1-second timer expired. The retransmitted SYN is identical (same port, same sequence number); only the IP Identification changes.</p>
      </GuideSection>

      <GuideSection id="pal-correlate" eyebrow="Correlation" title="Line up the captures" tone="violet">
        <DiagramFrame caption="Absence is evidence only for the place you looked.">
          <CorrelateDiagram />
        </DiagramFrame>
        <p>The SERVER and R1 captures call the second SYN-ACK a retransmission; the CLIENT-side capture does not, because it never saw the first one. The same packet gets a different label depending on where you stand.</p>
      </GuideSection>

      <GuideSection id="pal-signatures" eyebrow="Signatures" title="Silence is not refusal" tone="warning">
        <DiagramFrame caption="Port 443 was open all along.">
          <SignatureDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="pal-counters" eyebrow="Test" title="Confirm with an independent source" tone="ip">
        <DiagramFrame caption="Counters are read by delta, never by their lifetime value.">
          <CounterDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="pal-ladder" eyebrow="Ladder" title="The lowest broken dependency" tone="cyan">
        <DiagramFrame caption="Transport showed the symptom; the interface held the cause.">
          <LadderView />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="pal-verify" eyebrow="Verify" title="Same test, symptom gone" tone="success">
        <DiagramFrame caption="The proof is the comparison, not the configuration change.">
          <VerifyDiagram />
        </DiagramFrame>
        <ChecklistCard tone="success" title="Verified" mark="✓" items={[`New connection :${FLOW.verify.sport}: SYN → SYN-ACK → ACK on the first try`, "No retransmission at any capture point", "R1 ge-0/0/0 output drops: delta 0 (the total still reads 1 — history is not erased)"]} />
      </GuideSection>

      <GuideSection id="pal-glossary" eyebrow="Glossary" title="Terms" tone="cyan">
        <FlowSteps
          steps={[
            { title: "Symptom", body: "What a user reports.", tone: "warning" },
            { title: "Observation", body: "A fact you measured.", tone: "cyan" },
            { title: "Inference", body: "What that fact implies.", tone: "violet" },
            { title: "Root cause", body: "A hypothesis that survived a test.", tone: "danger" },
          ]}
        />
        <Glossary
          items={[
            { term: "Capture point", def: "The place a capture observes traffic: a mirror port, a TAP, a router interface or a host NIC." },
            { term: "Five-tuple", def: "Protocol + source/destination IP + source/destination port: the identity of one flow." },
            { term: "ISN", def: "Initial sequence number, carried in the SYN." },
            { term: "Retransmission", def: "A segment sent again with the same sequence number because no acknowledgment arrived in time." },
            { term: "RTO", def: "Retransmission timeout; 1 s initially (RFC 6298)." },
            { term: "RST", def: "Reset: an explicit refusal or abort — the opposite of silence." },
          ]}
        />
      </GuideSection>
    </div>
  );
}
