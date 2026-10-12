import { Callout, CompareCards, DArrow, DIAGRAM as D, DiagramFrame, DiagramSvg, DNode, DPill, FailureSignatures, FieldTable, FlowSteps, Glossary, GuideSection, Misconceptions, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { DTable } from "@/components/lesson/FundamentalsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { LadderDiagram } from "@/components/lesson/TroubleshootingGuideSvg";
import { ExplainIt, KnowledgeQuiz, PracticeBridge, type KnowledgeQuestion } from "@/components/lesson/GuideInteractive";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import { PresentationBridge } from "@/components/presentation/LessonPresentation";
import { CliPanel, FailureWalk } from "@/components/lesson/GuideCli";
import { UPLINK, WINDOW_CRC_FAULT, WINDOW_PKTS, WINDOW_S } from "@/lib/sim-engine/scenarios/troubleshootingLayer1";
import { l1Apply, type L1Action, type L1State } from "@/lib/sim-engine/scenarios/l1Net";
import { L1Delta, L1G, L1Result, L1_FIX, L1_INC, l1Cli, l1Only, l1TicketRun } from "./LessonGuideContent";

const G2 = { foundation: "Foundation", light: "Light", frames: "Frames and counters", copper: "Copper and negotiation", trouble: "Troubleshooting", master: "Master it" };
export const L1_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "ld-why", label: "Why the physical layer first", group: G2.foundation },
  { id: "ld-media", label: "Copper and fiber", group: G2.foundation },
  { id: "ld-states", label: "Admin and operational state", group: G2.foundation },
  { id: "ld-budget", label: "The light budget", group: G2.light },
  { id: "ld-dom", label: "Reading optics (DOM)", group: G2.light },
  { id: "ld-dirt", label: "Dirt, breaks and loss of signal", group: G2.light },
  { id: "ld-crc", label: "How CRC catches damage", group: G2.frames },
  { id: "ld-errors", label: "Every error counter", group: G2.frames },
  { id: "ld-rates", label: "From snapshots to rates", group: G2.frames },
  { id: "ld-intermittent", label: "Intermittent faults", group: G2.frames },
  { id: "ld-autoneg", label: "Auto-negotiation", group: G2.copper },
  { id: "ld-mismatch", label: "Duplex mismatch", group: G2.copper },
  { id: "ld-downshift", label: "Downshift and TDR", group: G2.copper },
  { id: "ld-flaps", label: "Flaps and logs", group: G2.copper },
  { id: "ld-signatures", label: "Failure signatures", group: G2.trouble },
  { id: "ld-ladder", label: "The troubleshooting ladder", group: G2.trouble },
  { id: "ld-tickets", label: "Five faults, evidence to proof", group: G2.trouble },
  { id: "ld-myths", label: "Common misconceptions", group: G2.master },
  { id: "ld-quiz", label: "Knowledge check", group: G2.master },
  { id: "ld-explain", label: "Can you explain it?", group: G2.master },
  { id: "ld-glossary", label: "Glossary", group: G2.master },
  { id: "ld-mental", label: "Mental model", group: G2.master },
  { id: "ld-practice", label: "Practice in the lab", group: G2.master },
];

function StateMachine() {
  return (
    <DiagramSvg h={180} label="Admin down forces oper down; admin up leads to oper down without a valid signal, oper up with one, and oper up with errors when the signal is marginal">
      <DNode x={90} y={50} label="admin down" sub="disabled in config" accent={D.faint} w={130} />
      <DNode x={320} y={50} label="admin up" sub="enabled" accent={D.cyan} w={110} />
      <DNode x={120} y={140} label="oper down" sub="no signal / no peer" accent={D.danger} w={140} />
      <DNode x={320} y={140} label="oper up" sub="clean signal" accent={D.success} w={120} />
      <DNode x={530} y={140} label="oper up + errors" sub="marginal signal" accent={D.warning} w={150} />
      <DArrow x1={90} y1={72} x2={105} y2={118} color={D.faint} />
      <DArrow x1={300} y1={72} x2={160} y2={118} color={D.danger} />
      <DArrow x1={320} y1={72} x2={320} y2={118} color={D.success} />
      <DArrow x1={345} y1={72} x2={490} y2={118} color={D.warning} />
    </DiagramSvg>
  );
}

function MediaDiagram() {
  return (
    <DiagramSvg h={150} label="Copper uses pairs in both directions with echo cancellation; duplex fiber uses one fiber per direction, so each direction can fail on its own">
      <text x={160} y={20} textAnchor="middle" fill={D.text} fontSize={10.5} fontWeight={700}>
        1000BASE-T copper
      </text>
      {[40, 60, 80, 100].map((y) => (
        <line key={y} x1={40} y1={y} x2={280} y2={y} stroke={D.eth} strokeWidth={2} />
      ))}
      <text x={160} y={128} textAnchor="middle" fill={D.muted} fontSize={9}>
        4 pairs · both directions on every pair · ≤ 100 m
      </text>
      <text x={480} y={20} textAnchor="middle" fill={D.text} fontSize={10.5} fontWeight={700}>
        Duplex fiber (1000BASE-LX)
      </text>
      <DArrow x1={360} y1={55} x2={600} y2={55} color={D.cyan} />
      <DArrow x1={600} y1={85} x2={360} y2={85} color={D.warning} />
      <text x={480} y={48} textAnchor="middle" fill={D.cyan} fontSize={8.5} fontFamily="monospace">
        Tx → Rx
      </text>
      <text x={480} y={104} textAnchor="middle" fill={D.warning} fontSize={8.5} fontFamily="monospace">
        Rx ← Tx
      </text>
      <text x={480} y={128} textAnchor="middle" fill={D.muted} fontSize={9}>
        one fiber per direction · each direction fails alone
      </text>
    </DiagramSvg>
  );
}

function BudgetDiagram() {
  const steps = [
    { label: "Tx", v: -5.1, c: D.cyan },
    { label: "connector", v: -5.6, c: D.muted },
    { label: "10 km SMF", v: -9.1, c: D.muted },
    { label: "patch panel", v: -9.8, c: D.muted },
    { label: "connector", v: -10.3, c: D.muted },
    { label: "Rx", v: -10.3, c: D.success },
  ];
  const y = (v: number) => 30 + (-v - 3) * 8;
  return (
    <DiagramSvg h={170} label="Optical power budget: transmit power minus connector, fiber and patch losses equals receive power">
      {steps.map((s, i) => {
        const x = 70 + i * 100;
        return (
          <g key={`${s.label}-${i}`}>
            <rect x={x - 24} y={y(s.v)} width={48} height={150 - y(s.v)} fill={s.c} fillOpacity={0.18} stroke={s.c} strokeOpacity={0.5} />
            <text x={x} y={y(s.v) - 6} textAnchor="middle" fill={s.c} fontSize={8.5} fontFamily="monospace">
              {s.v.toFixed(1)}
            </text>
            <text x={x} y={164} textAnchor="middle" fill={D.muted} fontSize={8.5}>
              {s.label}
            </text>
          </g>
        );
      })}
    </DiagramSvg>
  );
}

function CrcDiagram() {
  return (
    <DiagramSvg h={150} label="The sender computes CRC-32 over the frame and appends it as the FCS; the receiver recomputes it; a single flipped bit makes them differ">
      <DNode x={90} y={60} label="Sender MAC" sub="CRC-32 → FCS" accent={D.cyan} w={130} />
      <DNode x={320} y={60} label="Wire / fiber" sub="bits can flip" accent={D.warning} w={130} />
      <DNode x={550} y={60} label="Receiver MAC" sub="recompute, compare" accent={D.success} w={140} />
      <DArrow x1={156} y1={60} x2={254} y2={60} />
      <DArrow x1={386} y1={60} x2={479} y2={60} />
      <DPill x={550} y={112} text="differ → discard, CRC +1" color={D.danger} w={180} />
      <text x={200} y={118} textAnchor="middle" fill={D.muted} fontSize={9}>
        CRC-32 detects all 1- and 2-bit errors and all bursts ≤ 32 bits.
      </text>
    </DiagramSvg>
  );
}

function ErrorsTable() {
  return (
    <DiagramSvg h={210} label="Interface counters and what they mean: input errors, CRC, runts, giants, output errors, drops">
      <DTable
        x={20}
        y={8}
        title="Errors are corruption or protocol violations; drops are healthy frames thrown away"
        cols={[
          { label: "COUNTER", w: 150 },
          { label: "USUALLY MEANS", w: 300 },
          { label: "LAYER", w: 150 },
        ]}
        rows={[
          ["CRC / FCS errors", "bits changed in transit", "physical (or peer Tx)"],
          ["Input errors", "umbrella: CRC, runts, giants, alignment…", "physical / MAC"],
          ["Runts / giants", "too short / too long (MTU mismatch)", "MAC / config"],
          ["Output errors", "the port could not transmit a frame", "physical / hardware"],
          ["Output drops", "queue full — congestion, not corruption", "capacity / QoS"],
          ["Late collisions", "duplex mismatch on copper", "negotiation"],
        ]}
      />
    </DiagramSvg>
  );
}

function DuplexDiagram() {
  return (
    <DiagramSvg h={170} label="Autonegotiation: copper negotiates speed and duplex; 1000BASE-X fiber negotiates only duplex and pause; a mismatch gives late collisions on the half side and CRC errors on the full side">
      <DTable
        x={20}
        y={8}
        title="Speed, duplex and autonegotiation"
        cols={[
          { label: "MEDIA", w: 170 },
          { label: "AUTONEGOTIATES", w: 200 },
          { label: "TYPICAL MISMATCH SIGNATURE", w: 230 },
        ]}
        rows={[
          ["10/100/1000BASE-T", "speed, duplex, pause", "half: late collisions · full: CRC"],
          ["1000BASE-X (fiber)", "duplex and pause only", "autoneg on/off mismatch → no link"],
          ["10G and faster optics", "no speed autonegotiation", "wrong optic type → no link"],
        ]}
      />
      <text x={320} y={140} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        A duplex mismatch shows errors in both directions and needs half duplex somewhere — not the one-way pattern of a weak receiver.
      </text>
    </DiagramSvg>
  );
}

function RateDiagram() {
  return (
    <DiagramSvg h={150} label="From two snapshots to a rate: delta errors divided by interval, and delta errors divided by delta frames">
      <DPill x={120} y={40} text="snapshot 1 · t₁ · CRC₁" color={D.cyan} w={180} />
      <DPill x={520} y={40} text="snapshot 2 · t₂ · CRC₂" color={D.cyan} w={180} />
      <DArrow x1={212} y1={40} x2={428} y2={40} color={D.muted} />
      <text x={320} y={84} textAnchor="middle" fill={D.text} fontSize={10.5} fontFamily="monospace" fontWeight={700}>
        rate = (CRC₂ − CRC₁) ÷ (t₂ − t₁)
      </text>
      <text x={320} y={106} textAnchor="middle" fill={D.text} fontSize={10.5} fontFamily="monospace" fontWeight={700}>
        error ratio = ΔCRC ÷ Δ(input frames)
      </text>
      <text x={320} y={134} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        +127 in 30 s over ~48,210 frames ≈ 4.2 errors/s ≈ 0.26 % of frames.
      </text>
    </DiagramSvg>
  );
}

function IntermittentDiagram() {
  const vals = [0, 0, 0, 0, 3, 0, 18, 64, 121, 127, 130, 126, 0, 0];
  return (
    <DiagramSvg h={170} label="CRC errors per 30-second interval over time: zero at the baseline, rising as the connector degrades, zero after the repair">
      <line x1={40} y1={130} x2={610} y2={130} stroke={D.line} />
      {vals.map((v, i) => {
        const x = 50 + i * 40;
        const h = v * 0.8;
        const c = i >= 12 ? D.success : v > 0 ? D.warning : D.eth;
        return <rect key={i} x={x} y={130 - h} width={28} height={Math.max(h, 1.5)} fill={c} fillOpacity={0.4} stroke={c} strokeOpacity={0.7} />;
      })}
      <text x={130} y={148} textAnchor="middle" fill={D.muted} fontSize={8.5}>
        baseline
      </text>
      <text x={380} y={148} textAnchor="middle" fill={D.warning} fontSize={8.5}>
        degrading → incident
      </text>
      <text x={590} y={148} textAnchor="middle" fill={D.success} fontSize={8.5}>
        repaired
      </text>
      <text x={320} y={20} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        Δ CRC per 30 s interval (illustrative) — a baseline makes &quot;abnormal&quot; measurable.
      </text>
    </DiagramSvg>
  );
}


const run = (s: L1State, ...a: L1Action[]) => a.reduce((acc, x) => l1Apply(acc, x), s);
const T = { duplex: l1TicketRun("duplex"), admin: l1TicketRun("admin"), los: l1TicketRun("los"), copper: run(l1TicketRun("copper"), { type: "tdr", dev: "ACCESS-SW" }) };
const F = {
  duplex: run(T.duplex, { type: "cfg", dev: "ACCESS-SW", cfg: { ifs: { "ge-0/0/1": {}, [UPLINK]: {} } }, text: "restore auto-negotiation" }, { type: "iperf" }),
  admin: run(T.admin, { type: "cfg", dev: "DIST-SW", cfg: { ifs: { "ge-0/0/2": {}, [UPLINK]: {} } }, text: "enable ge-0/0/2" }, { type: "ping", count: 4 }),
  los: run(T.los, { type: "phys", id: "cord" }, { type: "ping", count: 4 }),
  copper: run(T.copper, { type: "phys", id: "cable-c" }, { type: "iperf", reverse: true }),
};

function LabBridge() {
  const openLab = usePracticeLabOpener();
  return (
    <PracticeBridge label="Open the Layer 1 Lab" onPractice={openLab}>
      Every link&apos;s state and negotiation, both ends&apos; optics, counters with snapshots, ping and iperf3, a field kit, Junos EX and Linux consoles — your own copy. Nothing you do there changes your lesson progress.
    </PracticeBridge>
  );
}

const QUIZ: KnowledgeQuestion[] = [
  { id: "q-updown", prompt: "An interface shows Admin up, Link down. First place to look?", options: [{ id: "a", label: "The physical path: cable, optic, light levels, the far end" }, { id: "b", label: "The configuration — it was disabled" }, { id: "c", label: "The routing table" }], correctId: "a", explanation: "Admin up means the configuration wants it; link down means no usable signal." },
  { id: "q-rx", prompt: "ACCESS Rx is low; DIST Tx is normal; DIST Rx is normal. Where is the light lost?", options: [{ id: "a", label: "On the DIST → ACCESS path (strand, connector or ACCESS receiver)" }, { id: "b", label: "In DIST-SW's laser" }, { id: "c", label: "In both directions" }], correctId: "a", explanation: "My Rx is the peer's Tx minus the strand: normal Tx and low Rx put the loss in between." },
  { id: "q-delta", prompt: "CRC/Align errors reads 3,912. What do you do?", options: [{ id: "a", label: "Take two snapshots with traffic in between and compare" }, { id: "b", label: "Replace the optic" }, { id: "c", label: "Nothing — fiber never has CRC errors" }], correctId: "a", explanation: "A lifetime total says nothing about now; a delta over a known interval does." },
  { id: "q-up", prompt: "Can a link stay up while it corrupts frames?", options: [{ id: "a", label: "Yes — marginal light holds the link while some bits are misread" }, { id: "b", label: "No — any physical fault brings it down" }, { id: "c", label: "Only on copper" }], correctId: "a", explanation: "Link detection needs much less signal than error-free decoding." },
  { id: "q-dup", prompt: "The switch port is forced to 100/full, the host negotiates. Result?", options: [{ id: "a", label: "Host 100/half: late collisions on the host, CRC errors and runts on the switch" }, { id: "b", label: "Both run 100/full" }, { id: "c", label: "The link stays down" }], correctId: "a", explanation: "Without negotiation the host can detect the speed but must assume half duplex." },
  { id: "q-dsh", prompt: "A gigabit link comes up at 100 Mb/s full duplex with no errors. Most likely?", options: [{ id: "a", label: "A damaged pair: the PHYs downshifted — run a TDR test" }, { id: "b", label: "A duplex mismatch" }, { id: "c", label: "A dirty fiber" }], correctId: "a", explanation: "1000BASE-T needs all four pairs; 100BASE-TX only two." },
];

export function L1DeepDiveContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="ld-why" eyebrow="Foundation" title="Why the physical layer first" tone="cyan">
        <p>
          Every higher layer assumes bits arrive as they were sent. When they don&apos;t, the symptoms appear far above — retransmissions, slow transfers, flaky applications — and send people hunting in DNS, firewalls and servers. The physical layer is cheap to measure and its evidence is unambiguous: states, light levels, error counters, negotiated speed and duplex.
        </p>
        <CompareCards
          items={[
            { title: "State", tone: "cyan", tag: "is it up?", points: ["admin and link", "carrier transitions", "last flapped"] },
            { title: "Signal", tone: "violet", tag: "is it clean?", points: ["Tx/Rx at both ends", "CRC and runts, as deltas"] },
            { title: "Negotiation", tone: "success", tag: "do they agree?", points: ["speed and duplex", "auto-negotiation at both ends"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="ld-media" eyebrow="Foundation" title="Copper and fiber" tone="cyan">
        <DiagramFrame caption="Copper shares pairs in both directions; duplex fiber has one strand per direction.">
          <MediaDiagram />
        </DiagramFrame>
        <p>
          1000BASE-T copper sends in both directions on all four pairs at once (echo cancellation keeps them apart), so a damaged pair affects the whole link. Duplex fiber uses one strand per direction — each direction can fail on its own, which is why you always read both ends. The optic identifies itself:
        </p>
        <CliPanel run={l1Only(L1G.healthy, "ACCESS-SW", "show chassis pic fpc-slot 0 pic-slot 0", /Type|Port|47 /)} caption="Junos · ACCESS-SW — port 47 holds an SFP-LX10: 1000BASE-LX, single-mode, 1310 nm" />
      </GuideSection>

      <GuideSection id="ld-states" eyebrow="Foundation" title="Admin and operational state" tone="violet">
        <DiagramFrame caption="Admin down forces link down; admin up leaves it to the signal.">
          <StateMachine />
        </DiagramFrame>
        <CliPanel run={l1Only(T.admin, "DIST-SW", "show interfaces ge-0/0/2", /Physical interface|Interface flags|Active alarms/)} caption="Junos · DIST-SW — Administratively down: a configuration fact, no alarm" />
        <CliPanel run={l1Only(T.los, "DIST-SW", `show interfaces ${UPLINK}`, /Physical interface|Interface flags|Active alarms/)} caption="Junos · DIST-SW — Enabled, link Down, LINK alarm: a physical fact" />
      </GuideSection>

      <GuideSection id="ld-budget" eyebrow="Light" title="The light budget" tone="ip">
        <DiagramFrame caption="Transmit power minus every loss on the way equals receive power.">
          <BudgetDiagram />
        </DiagramFrame>
        <FieldTable
          title="The uplink's budget (from the lab)"
          accent="ip"
          columns={["direction", "Tx", "Rx", "loss"]}
          rows={[
            ["ACCESS → DIST, healthy", "−5.00 dBm", "−6.20 dBm", "1.2 dB"],
            ["DIST → ACCESS, healthy", "−5.10 dBm", "−6.30 dBm", "1.2 dB"],
            ["DIST → ACCESS, dirty connector", "−5.10 dBm", "−19.80 dBm", "14.7 dB"],
            ["DIST → ACCESS, after cleaning", "−5.10 dBm", "−6.40 dBm", "1.3 dB"],
          ]}
        />
        <p className="text-sm text-pv-text-muted">dB adds along the path: each mated connector costs a fraction of a dB, a kilometre of single-mode fiber about 0.35 dB at 1310 nm, a dirty end-face can cost 10 dB or more on its own.</p>
      </GuideSection>

      <GuideSection id="ld-dom" eyebrow="Light" title="Reading optics (DOM)" tone="ip">
        <p>Digital optical monitoring reports bias current, transmit and receive power, temperature and voltage, plus alarm and warning flags against thresholds programmed into the module.</p>
        <CliPanel run={l1Cli(L1_INC, "ACCESS-SW", `show interfaces diagnostics optics ${UPLINK}`)} caption="Junos · ACCESS-SW during the incident — Rx below the low-warning threshold, above the low-alarm threshold" />
        <Callout tone="cyan" title="Warning and alarm" icon="i">
          The warning threshold (−14 dBm here) says the margin is gone; the alarm threshold (−22 dBm) says the signal is unusable. Between them the link usually stays up while bits get misread — the most deceptive place for a link to be.
        </Callout>
      </GuideSection>

      <GuideSection id="ld-dirt" eyebrow="Light" title="Dirt, breaks and loss of signal" tone="warning">
        <CompareCards
          items={[
            { title: "Dirty end-face", tone: "warning", tag: "marginal", points: ["Rx down 10+ dB", "link up, CRC errors", "clean, then reseat"] },
            { title: "Broken strand", tone: "danger", tag: "no light", points: ["Rx loss-of-signal alarm", "remote fault: both ends down", "replace the cord"] },
            { title: "Failing laser", tone: "violet", tag: "low Tx", points: ["its own Tx is low", "far Rx low too", "replace that optic"] },
          ]}
        />
        <CliPanel run={l1Only(T.los, "DIST-SW", `show interfaces ${UPLINK} extensive`, /Physical interface|Remote fault|Carrier transitions/)} caption="Junos · DIST-SW — its own light arrives fine, but ACCESS-SW signals remote fault: the link goes down here too" />
        <p className="text-sm text-pv-text-muted">Inspect and clean before replacing: most fiber problems are dirty connectors, and a new optic plugged into a dirty cord stays dirty.</p>
      </GuideSection>

      <GuideSection id="ld-crc" eyebrow="Frames and counters" title="How CRC catches damage" tone="cyan">
        <DiagramFrame caption="The sender appends CRC-32; the receiver recomputes it over what arrived.">
          <CrcDiagram />
        </DiagramFrame>
        <p>CRC-32 detects every single-bit and double-bit error and every burst up to 32 bits. A failed check is final: Ethernet has no retransmission, so the frame simply vanishes and the receiving interface counts it. The sender never learns — only TCP&apos;s timers or a missing ping reply reveal the loss.</p>
      </GuideSection>

      <GuideSection id="ld-errors" eyebrow="Frames and counters" title="Every error counter" tone="cyan">
        <DiagramFrame caption="What each counter means.">
          <ErrorsTable />
        </DiagramFrame>
        <FieldTable
          title="Where to read them"
          accent="cyan"
          columns={["Meaning", "Junos (show interfaces … extensive)", "Linux"]}
          rows={[
            ["Frames with a bad FCS", <Mono key="1">CRC/Align errors · Framing errors</Mono>, <Mono key="1l">rx_crc_errors (ethtool -S)</Mono>],
            ["Fragments shorter than 64 bytes", <Mono key="2">Runts · Fragment frames</Mono>, <Mono key="2l">rx_length_errors</Mono>],
            ["Collisions after the first 64 bytes", "— (full-duplex side)", <Mono key="3l">tx_abort_late_coll · collisions</Mono>],
            ["Link up/down events", <Mono key="4">Carrier transitions</Mono>, <Mono key="4l">ip -s link: carrier · dmesg</Mono>],
            ["Frames dropped for lack of buffer", <Mono key="5">Drops · FIFO errors</Mono>, <Mono key="5l">rx_missed_errors</Mono>],
          ]}
        />
      </GuideSection>

      <GuideSection id="ld-rates" eyebrow="Frames and counters" title="From snapshots to rates" tone="violet">
        <DiagramFrame caption="Two snapshots make a rate.">
          <RateDiagram />
        </DiagramFrame>
        <L1Delta s={L1_INC} title="The incident's snapshot pair" />
        <p>
          CRC +{WINDOW_CRC_FAULT} in {WINDOW_S} s is about {(WINDOW_CRC_FAULT / WINDOW_S).toFixed(1)} errors per second; against about {WINDOW_PKTS.toLocaleString("en-US")} frames that is {((100 * WINDOW_CRC_FAULT) / WINDOW_PKTS).toFixed(2)}% — small enough that ping “mostly works”, large enough to wreck TCP throughput in that direction. <Mono>clear interfaces statistics</Mono> gives the same baseline on the device itself; a snapshot pair doesn&apos;t destroy the history.
        </p>
      </GuideSection>

      <GuideSection id="ld-intermittent" eyebrow="Frames and counters" title="Intermittent faults" tone="warning">
        <DiagramFrame caption="CRC errors per interval over time.">
          <IntermittentDiagram />
        </DiagramFrame>
        <p className="text-sm text-pv-text-muted">An intermittent fault needs repeated intervals: one clean window proves little if the problem comes and goes. Watch the rate over several windows, correlate it with temperature, load or someone touching a patch panel.</p>
      </GuideSection>

      <GuideSection id="ld-autoneg" eyebrow="Copper and negotiation" title="Auto-negotiation" tone="success">
        <DiagramFrame caption="What negotiation decides, and what a mismatch looks like.">
          <DuplexDiagram />
        </DiagramFrame>
        <p>
          With auto-negotiation on, both copper ends advertise their abilities and pick the best common speed and duplex. If one end doesn&apos;t negotiate, the other can still detect the speed from the signal (parallel detection) — but not the duplex, so it must assume <b className="text-pv-text">half</b>. 1000BASE-T can&apos;t work without negotiation at all; 1000BASE-X fiber negotiates only duplex, pause and remote fault.
        </p>
        <CliPanel run={l1Only(L1G.healthy, "CLIENT", "ethtool eth0", /Advertised auto|Link partner advertised auto|Speed|Duplex|Auto-negotiation/)} caption="Linux · CLIENT — healthy: both ends negotiate, 1000 Mb/s full" />
      </GuideSection>

      <GuideSection id="ld-mismatch" eyebrow="Copper and negotiation" title="Duplex mismatch" tone="danger">
        <p>The full-duplex end transmits whenever it likes; the half-duplex end treats that as a collision, aborts its own frame mid-way (a late collision) and retries. The aborted fragments arrive at the full-duplex end as runts with a bad FCS.</p>
        <CliPanel run={l1Only(T.duplex, "ACCESS-SW", "show interfaces ge-0/0/1 extensive", /Link-mode|Framing errors|CRC\/Align|Fragment frames/)} caption="Junos · ACCESS-SW ge-0/0/1 — forced full duplex: CRC errors and fragments arrive" />
        <CliPanel run={l1Only(T.duplex, "CLIENT", "ethtool -S eth0", /collisions|late_coll/)} caption="Linux · CLIENT — the half-duplex side counts late collisions" />
        <L1Result s={T.duplex} title="The lab: a duplex mismatch under load" />
      </GuideSection>

      <GuideSection id="ld-downshift" eyebrow="Copper and negotiation" title="Downshift and TDR" tone="violet">
        <p>Gigabit Ethernet over copper needs all four pairs; 100BASE-TX uses two. When a pair is open or shorted, the PHYs try gigabit, fail, and settle for 100 Mb/s — <b className="text-pv-text">downshift</b>. There are no errors, just a ceiling. A time-domain reflectometer (TDR) sends a pulse down each pair and times the reflection to find opens and shorts.</p>
        <CliPanel run={l1Cli(T.copper, "ACCESS-SW", "show diagnostics tdr interface ge-0/0/1")} caption="Junos · ACCESS-SW — TDR: pair 4-5 open at 12 m" />
        <CliPanel run={l1Only(T.copper, "CLIENT", "sudo dmesg", /SmartSpeed|100 Mbps/)} caption="Linux · CLIENT — the driver reports the downgraded speed" />
      </GuideSection>

      <GuideSection id="ld-flaps" eyebrow="Copper and negotiation" title="Flaps and logs" tone="cyan">
        <p>Every link change increments the carrier-transitions counter and writes a log line on both ends. A count that keeps rising points at a loose connector, a failing optic or a cable under stress; an expected flap (a reseat, a TDR test) shows up too — so correlate with what you did.</p>
        <CliPanel run={l1Only(L1_FIX, "ACCESS-SW", "show log messages", /ge-0\/0\/47/)} caption="Junos · ACCESS-SW — the reseat: link down, link up" />
        <CliPanel run={l1Only(L1_FIX, "ACCESS-SW", `show interfaces ${UPLINK} extensive`, /Last flapped|Carrier transitions/)} caption="Junos · ACCESS-SW — carrier transitions 2 → 4" />
      </GuideSection>

      <GuideSection id="ld-signatures" eyebrow="Troubleshooting" title="Failure signatures" tone="danger">
        <FailureSignatures
          items={[
            { tag: "DIRT", title: "Marginal light", tone: "danger", points: ["link up, Rx low on one end", "CRC delta on that end only", "direction-dependent slowness"] },
            { tag: "LOS", title: "No light", tone: "danger", points: ["Rx loss-of-signal alarm", "both ends down (remote fault)"] },
            { tag: "ADM", title: "Disabled", tone: "warning", points: ["admin down on the switch", "no alarm; far end no link"] },
            { tag: "DUP", title: "Duplex mismatch", tone: "danger", points: ["full vs half", "CRC + runts vs late collisions"] },
            { tag: "DSH", title: "Downshift", tone: "violet", points: ["100 Mb/s, no errors", "TDR names the pair"] },
            { tag: "FLAP", title: "Unstable link", tone: "warning", points: ["carrier transitions rising", "log: down/up pairs"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="ld-ladder" eyebrow="Troubleshooting" title="The troubleshooting ladder" tone="danger">
        <DiagramFrame caption="Bottom rung first when the symptom is loss on one link.">
          <DiagramSvg h={170} label="Layer 1 ladder: state, flaps, counters as deltas, optics per direction, media and negotiation, cleaning before replacing">
            <LadderDiagram
              rows={[
                { rung: "Admin / oper state", evidence: "disabled? no link? stable?", status: "ok" },
                { rung: "Carrier transitions", evidence: "flapping? last change?", status: "ok" },
                { rung: "Error counters", evidence: "CRC / input errors — by delta", status: "suspect" },
                { rung: "Optics per direction", evidence: "Tx far end − Rx near end", status: "suspect" },
                { rung: "Media & negotiation", evidence: "speed/duplex, optic type", status: "ok" },
                { rung: "Physical inspection", evidence: "clean → reseat → replace", status: "skip" },
              ]}
            />
          </DiagramSvg>
        </DiagramFrame>
        <TroubleshootingFlow
          steps={[
            { question: "What does the user see — loss, slowness, nothing?", look: "ping -c 100 -q · iperf3 both directions" },
            { question: "Is every link admin up and link up?", look: "show interfaces terse · ethtool eth0" },
            { question: "Is the light normal at both ends?", look: "show interfaces diagnostics optics" },
            { question: "Are errors rising now — where?", look: "two snapshots with traffic; CRC, runts, carrier" },
            { question: "Do speed and duplex agree?", look: "ethtool · show interfaces <if>" },
            { question: "Repair one thing, then measure again", look: "the same tests, a fresh interval" },
          ]}
        />
        <FlowSteps
          steps={[
            { title: "Measure", body: "State, two counter snapshots, both optics.", tone: "cyan" },
            { title: "Localize", body: "Which end, which direction?", tone: "violet" },
            { title: "Fix cheapest first", body: "Clean, reseat, then replace.", tone: "warning" },
            { title: "Re-measure", body: "Same measurements, fresh window.", tone: "success" },
          ]}
        />
      </GuideSection>

      <GuideSection id="ld-tickets" eyebrow="Troubleshooting" title="Five faults, evidence to proof" tone="danger">
        <FailureWalk title="1 · Downloads from SERVER crawl" normal="ACCESS Rx −6.30 dBm, CRC +0 per 30 s." change="A dirty connector at the ACCESS end of the DIST → ACCESS strand." evidence={<L1Delta s={L1_INC} title="Snapshot pair" />} next="ACCESS Rx −19.80 dBm while DIST Tx is normal: the DIST → ACCESS path." fix={<Mono>Field work: clean and reseat the uplink fiber at ACCESS-SW ge-0/0/47</Mono>} proof={<L1Result s={L1_FIX} from={L1_INC.tests.length} title="100 fresh pings" />} />
        <FailureWalk title="2 · CLIENT's port was “tuned”" normal="1000/full, auto-negotiated at both ends." change="ACCESS-SW ge-0/0/1: speed 100m, link-mode full-duplex, no-auto-negotiation." evidence={<CliPanel run={l1Only(T.duplex, "CLIENT", "ethtool eth0", /Speed|Duplex/)} caption="Linux · CLIENT — 100 Mb/s half" />} next="Switch full, host half: CRC + runts on ACCESS-SW, late collisions on CLIENT." fix={<Mono>ACCESS-SW: delete interfaces ge-0/0/1 speed · link-mode · ether-options no-auto-negotiation → commit</Mono>} proof={<L1Result s={F.duplex} from={T.duplex.tests.length} title="A fresh upload test" />} />
        <FailureWalk title="3 · SERVER vanished after the maintenance window" normal="DIST-SW ge-0/0/2 up / up." change="set interfaces ge-0/0/2 disable was committed." evidence={<CliPanel run={l1Only(T.admin, "DIST-SW", "show interfaces terse", /Interface|ge-0\/0\/2 /)} caption="Junos · DIST-SW — down / down" />} next="Administratively down: a configuration fact, not the cable." fix={<Mono>DIST-SW: delete interfaces ge-0/0/2 disable → commit</Mono>} proof={<L1Result s={F.admin} from={T.admin.tests.length} title="A fresh ping" />} />
        <FailureWalk title="4 · Everything behind DIST-SW is gone" normal="Light −6.3 / −6.2 dBm, uplink up." change="The cabling crew broke the DIST → ACCESS strand." evidence={<CliPanel run={l1Only(T.los, "ACCESS-SW", `show interfaces diagnostics optics ${UPLINK}`, /Receiver signal|rx power low alarm  /)} caption="Junos · ACCESS-SW — no light, LOS alarm" />} next="DIST Tx is normal; both ends down because ACCESS signals remote fault. Cleaning won't restore a broken strand." fix={<Mono>Field work: replace the uplink fiber patch cord</Mono>} proof={<L1Result s={F.los} from={T.los.tests.length} title="A fresh ping" />} />
        <FailureWalk title="5 · Capped at 94 Mbit/s after the desk move" tone="warning" normal="1000/full, ≈ 941 Mbit/s." change="CLIENT's cable crushed: pair 4-5 open." evidence={<CliPanel run={l1Only(T.copper, "ACCESS-SW", "show diagnostics tdr interface ge-0/0/1", /4-5|Open|12 Meters|Downshift/)} caption="Junos · ACCESS-SW — TDR" />} next="No errors, exactly 100 Mb/s: downshift. Forcing speed 1g only takes the link down." fix={<Mono>Field work: replace CLIENT&apos;s patch cable</Mono>} proof={<L1Result s={F.copper} from={T.copper.tests.length} title="A fresh download test" />} />
      </GuideSection>

      <GuideSection id="ld-myths" eyebrow="Master it" title="Common misconceptions" tone="warning">
        <Misconceptions
          items={[
            { myth: "The link is up, so Layer 1 is fine.", correction: "Up means signal detected. Marginal light keeps it up while bits are misread." },
            { myth: "A high CRC count means an active fault.", correction: "Counters are lifetime totals; only a delta with traffic shows now." },
            { myth: "Clearing the counters fixes errors.", correction: "It resets numbers, not light. They climb again." },
            { myth: "Forcing speed and duplex is safer.", correction: "Forcing one end makes the other assume half duplex. Force both or neither." },
            { myth: "Low Rx means the local optic is bad.", correction: "Rx is the peer's light after the strand — check the far Tx and the path first." },
          ]}
        />
      </GuideSection>

      <GuideSection id="ld-quiz" eyebrow="Master it" title="Knowledge check" tone="cyan">
        <KnowledgeQuiz questions={QUIZ} />
      </GuideSection>

      <GuideSection id="ld-explain" eyebrow="Master it" title="Can you explain it?" tone="violet">
        <ExplainIt
          items={[
            { q: "Why did only downloads crawl?", a: "Only the DIST → ACCESS strand lost light. Download data crossed it and was corrupted and retransmitted; uploads only sent small ACKs over it." },
            { q: "Why were CRC errors only on ACCESS-SW?", a: "A receiver counts the frames it fails to read. ACCESS-SW was the receiver with the low light." },
            { q: "Why isn't 3,912 CRC errors evidence of the incident?", a: "It is a lifetime total. Two snapshots 30 s apart with traffic showed +0 on the healthy network and +127 during the incident." },
            { q: "What does a duplex mismatch look like from each end?", a: "The half-duplex end counts late collisions; the full-duplex end counts CRC errors and runts." },
            { q: "Why do both switches go down when one strand breaks?", a: "The receiver without light signals remote fault through 1000BASE-X negotiation; the other end takes the link down too." },
          ]}
        />
      </GuideSection>

      <GuideSection id="ld-glossary" eyebrow="Master it" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "DOM / DDM", def: "Digital optical monitoring: an optic's Tx/Rx power, bias, temperature, voltage and alarms." },
            { term: "Light budget", def: "Tx power minus all losses on the path; what is left must exceed the receiver's sensitivity." },
            { term: "Runt", def: "A frame shorter than 64 bytes — usually a collision fragment." },
            { term: "Late collision", def: "A collision after the first 64 bytes: on modern networks, the sign of a duplex mismatch." },
            { term: "Parallel detection", def: "Detecting a non-negotiating peer's speed from its signal; duplex defaults to half." },
            { term: "Downshift", def: "Falling back to a lower speed when a cable can't carry the negotiated one." },
            { term: "TDR", def: "Time-domain reflectometry: locating opens and shorts on copper pairs by timing reflections." },
            { term: "Remote fault", def: "A 1000BASE-X signal telling the peer that the local receiver has no usable signal." },
          ]}
        />
      </GuideSection>

      <GuideSection id="ld-mental" eyebrow="Master it" title="Mental model" tone="violet">
        <p>A phone call on a bad line: “connected” is the link state; whether you hear every word is signal quality. Count the words lost in the next minute, not last week; find out which direction crackles before replacing anyone&apos;s phone.</p>
      </GuideSection>

      <GuideSection id="ld-practice" eyebrow="Master it" title="Practice in the lab" tone="violet">
        <p>Six Learn levels, then the workspace: link states and negotiation, both ends&apos; optics, counters with snapshots, ping and iperf3, a field kit, Junos EX and Linux consoles, five challenges and the five tickets above.</p>
        <LabBridge />
        <PresentationBridge>Rewatch the Layer 1 presentation.</PresentationBridge>
      </GuideSection>
    </div>
  );
}
