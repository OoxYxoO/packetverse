import { Callout, CompareCards, DArrow, DIAGRAM as D, DiagramFrame, DiagramSvg, DNode, DPill, FlowSteps, Glossary, GuideSection } from "@/components/lesson/GuideBlocks";
import { DTable } from "@/components/lesson/FundamentalsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { LadderDiagram } from "@/components/lesson/TroubleshootingGuideSvg";

export const L1_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "l1d-state", label: "Admin vs operational" },
  { id: "l1d-media", label: "Copper and fiber" },
  { id: "l1d-budget", label: "Optics & power budget" },
  { id: "l1d-crc", label: "CRC / FCS" },
  { id: "l1d-errors", label: "Errors vs drops" },
  { id: "l1d-duplex", label: "Speed, duplex, autonegotiation" },
  { id: "l1d-deltas", label: "Counter deltas" },
  { id: "l1d-intermittent", label: "Intermittent faults & baselines" },
  { id: "l1d-ladder", label: "Layer 1 ladder" },
  { id: "l1d-glossary", label: "Glossary" },
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

export function L1DeepDiveContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="l1d-state" eyebrow="Interface state" title="Admin vs operational" tone="ethernet">
        <DiagramFrame caption="Configuration intent vs hardware reality.">
          <StateMachine />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="l1d-media" eyebrow="Media" title="Copper and fiber" tone="cyan">
        <DiagramFrame caption="Fiber's directions are physically separate.">
          <MediaDiagram />
        </DiagramFrame>
        <CompareCards
          items={[
            { title: "Copper", tone: "cyan", tag: "1000BASE-T", points: ["Cable tests: length, pairs, crosstalk", "Errors often from bad terminations or EMI", "Duplex mismatch possible"] },
            { title: "Fiber", tone: "warning", tag: "1000BASE-LX/SX", points: ["DOM reports Tx/Rx power", "Dirty connectors are the #1 cause", "Clean before you replace"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="l1d-budget" eyebrow="Optics" title="Power budget" tone="warning">
        <DiagramFrame caption="Every connector, splice and kilometer costs light (illustrative values).">
          <BudgetDiagram />
        </DiagramFrame>
        <Callout tone="warning" title="Read thresholds from the optic">
          The receiver sensitivity and alarm/warning thresholds come from the transceiver&apos;s DOM data and datasheet. Compare a reading with the SAME optic&apos;s baseline, not with a number from another vendor.
        </Callout>
      </GuideSection>

      <GuideSection id="l1d-crc" eyebrow="Integrity" title="CRC / FCS" tone="ethernet">
        <DiagramFrame caption="Detected at the receiver; never corrected by Ethernet.">
          <CrcDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="l1d-errors" eyebrow="Counters" title="Input/output errors vs drops" tone="danger">
        <DiagramFrame caption="Corruption and congestion leave different fingerprints.">
          <ErrorsTable />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="l1d-duplex" eyebrow="Negotiation" title="Speed, duplex and autonegotiation" tone="violet">
        <DiagramFrame caption="Know what your media actually negotiates.">
          <DuplexDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="l1d-deltas" eyebrow="Method" title="Counter deltas" tone="ip">
        <DiagramFrame caption="A rate is evidence; a total is history.">
          <RateDiagram />
        </DiagramFrame>
        <p>Clearing counters is a measurement convenience, not a repair — and it destroys history you may need later. Many teams prefer taking two snapshots over clearing.</p>
      </GuideSection>

      <GuideSection id="l1d-intermittent" eyebrow="Intermittent faults" title="Baselines turn 'flaky' into numbers" tone="warning">
        <DiagramFrame caption="Intermittent faults need measurements over time.">
          <IntermittentDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="l1d-ladder" eyebrow="Ladder" title="A Layer 1 checklist" tone="cyan">
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
        <FlowSteps
          steps={[
            { title: "Measure", body: "State, two counter snapshots, both optics.", tone: "cyan" },
            { title: "Localize", body: "Which end, which direction?", tone: "violet" },
            { title: "Fix cheapest first", body: "Clean, reseat, then replace.", tone: "warning" },
            { title: "Re-measure", body: "Same measurements, fresh window.", tone: "success" },
          ]}
        />
      </GuideSection>

      <GuideSection id="l1d-glossary" eyebrow="Glossary" title="Terms" tone="cyan">
        <Glossary
          items={[
            { term: "Receiver sensitivity", def: "The lowest input power at which the receiver still meets its specified error rate." },
            { term: "Power budget", def: "Transmit power minus receiver sensitivity: the loss a link can tolerate." },
            { term: "Runt / giant", def: "A frame shorter than 64 bytes / longer than the configured maximum." },
            { term: "Late collision", def: "A collision after the first 64 bytes — the classic duplex-mismatch symptom." },
            { term: "Error ratio", def: "Errored frames divided by frames received in the same interval." },
          ]}
        />
      </GuideSection>
    </div>
  );
}
