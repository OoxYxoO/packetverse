import { Callout, ChecklistCard, DArrow, DIAGRAM as D, DiagramFrame, DiagramSvg, DLink, DNode, DPill, Glossary, GuideSection, Mono } from "@/components/lesson/GuideBlocks";
import { DFieldRow, DTable } from "@/components/lesson/FundamentalsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { LadderDiagram, WorkflowDiagram } from "@/components/lesson/TroubleshootingGuideSvg";
import { FAULT_RX, HEALTHY_OPTICS, HISTORIC_CRC, MEDIA, PV_THRESH, REPAIRED_RX, UPLINK, WINDOW_CRC_FAULT, WINDOW_PKTS, WINDOW_S, dbm } from "@/lib/sim-engine/scenarios/troubleshootingLayer1";

export const L1_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "l1l-mission", label: "The mission" },
  { id: "l1l-method", label: "The method" },
  { id: "l1l-topology", label: "Topology" },
  { id: "l1l-state", label: "Admin vs oper" },
  { id: "l1l-direction", label: "Tx / Rx direction" },
  { id: "l1l-thresholds", label: "Light levels" },
  { id: "l1l-deltas", label: "Counters as deltas" },
  { id: "l1l-fcs", label: "The FCS check" },
  { id: "l1l-incident", label: "The incident" },
  { id: "l1l-loss", label: "Intermittent loss" },
  { id: "l1l-ladder", label: "Evidence ladder" },
  { id: "l1l-suspects", label: "Ruling out suspects" },
  { id: "l1l-verify", label: "Repair & verify" },
  { id: "l1l-glossary", label: "Glossary" },
];

const fmt = (n: number) => n.toLocaleString("en-US");

function TopologyDiagram() {
  return (
    <DiagramSvg h={170} label="CLIENT, ACCESS-SW, DIST-SW and SERVER; the switches joined by a fiber uplink ge-0/0/47 to ge-0/0/47 with one fiber per direction">
      <DNode x={60} y={80} label="CLIENT" sub="10.30.30.10" accent={D.cyan} w={100} />
      <DNode x={230} y={80} label="ACCESS-SW" sub={UPLINK} accent={D.eth} w={120} />
      <DNode x={420} y={80} label="DIST-SW" sub={UPLINK} accent={D.eth} w={110} />
      <DNode x={585} y={80} label="SERVER" sub="10.30.30.20" accent={D.success} w={100} />
      <DLink x1={110} y1={80} x2={170} y2={80} />
      <DLink x1={475} y1={80} x2={535} y2={80} />
      <DArrow x1={292} y1={68} x2={363} y2={68} color={D.cyan} width={1.6} />
      <DArrow x1={363} y1={92} x2={292} y2={92} color={D.warning} width={1.6} />
      <text x={327} y={60} textAnchor="middle" fill={D.cyan} fontSize={8.5} fontFamily="monospace">
        fiber A → DIST
      </text>
      <text x={327} y={108} textAnchor="middle" fill={D.warning} fontSize={8.5} fontFamily="monospace">
        fiber B → ACCESS
      </text>
      <text x={320} y={150} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        {MEDIA} · one fiber per direction · one subnet, no router
      </text>
    </DiagramSvg>
  );
}

function StateDiagram() {
  return (
    <DiagramSvg h={170} label="Admin and operational state combinations and what each means">
      <DTable
        x={30}
        y={8}
        title="Two states, four meanings"
        cols={[
          { label: "ADMIN", w: 80 },
          { label: "OPER", w: 80 },
          { label: "MEANS", w: 420 },
        ]}
        rows={[
          ["down", "down", "someone disabled it (configuration)"],
          ["up", "down", "enabled, but no usable link: no light/signal, bad cable or optic, peer down"],
          ["up", "up", "link trained — says nothing yet about bit errors"],
          ["up", "up + CRC Δ > 0", "UP but unhealthy: marginal signal, corrupted frames"],
        ]}
        highlight={{ row: 3, color: D.warning }}
      />
    </DiagramSvg>
  );
}

function DirectionDiagram() {
  return (
    <DiagramSvg h={150} label="Each receiver measures the peer's transmitter through one fiber: DIST Tx −5.1 dBm to ACCESS Rx −6.3 dBm, ACCESS Tx −5.0 dBm to DIST Rx −6.2 dBm">
      <DNode x={120} y={75} label="ACCESS-SW" sub={UPLINK} accent={D.eth} w={130} h={60} />
      <DNode x={520} y={75} label="DIST-SW" sub={UPLINK} accent={D.eth} w={130} h={60} />
      <DArrow x1={188} y1={58} x2={452} y2={58} color={D.cyan} />
      <DArrow x1={452} y1={94} x2={188} y2={94} color={D.warning} />
      <text x={320} y={48} textAnchor="middle" fill={D.cyan} fontSize={9.5} fontFamily="monospace">
        ACCESS Tx {dbm(HEALTHY_OPTICS["ACCESS-SW"].tx)} → DIST Rx {dbm(HEALTHY_OPTICS["DIST-SW"].rx)}
      </text>
      <text x={320} y={112} textAnchor="middle" fill={D.warning} fontSize={9.5} fontFamily="monospace">
        ACCESS Rx {dbm(HEALTHY_OPTICS["ACCESS-SW"].rx)} ← DIST Tx {dbm(HEALTHY_OPTICS["DIST-SW"].tx)}
      </text>
      <text x={320} y={140} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        Path loss = far-end Tx − near-end Rx (≈1.2 dB each way at the baseline).
      </text>
    </DiagramSvg>
  );
}

function ThresholdDiagram() {
  const x = (v: number) => 60 + ((-3 - v) / 23) * 520;
  return (
    <DiagramSvg h={150} label="PacketVerse lesson thresholds: normal down to −14 dBm, marginal to −22 dBm, loss of signal below; baseline −6.3, incident −19.8, repaired −6.4">
      <rect x={x(-3)} y={50} width={x(-14) - x(-3)} height={20} fill={D.success} fillOpacity={0.2} stroke={D.success} strokeOpacity={0.5} />
      <rect x={x(-14)} y={50} width={x(-22) - x(-14)} height={20} fill={D.warning} fillOpacity={0.2} stroke={D.warning} strokeOpacity={0.5} />
      <rect x={x(-22)} y={50} width={x(-26) - x(-22)} height={20} fill={D.danger} fillOpacity={0.2} stroke={D.danger} strokeOpacity={0.5} />
      <text x={(x(-3) + x(-14)) / 2} y={64} textAnchor="middle" fill={D.success} fontSize={9} fontWeight={700}>
        normal
      </text>
      <text x={(x(-14) + x(-22)) / 2} y={64} textAnchor="middle" fill={D.warning} fontSize={9} fontWeight={700}>
        marginal: UP but errors
      </text>
      <text x={(x(-22) + x(-26)) / 2} y={64} textAnchor="middle" fill={D.danger} fontSize={8.5} fontWeight={700}>
        LOS
      </text>
      {[
        { v: HEALTHY_OPTICS["ACCESS-SW"].rx, t: "baseline", c: D.success, up: true },
        { v: FAULT_RX, t: "incident", c: D.warning, up: true },
        { v: REPAIRED_RX, t: "repaired", c: D.cyan, up: false },
      ].map((m) => (
        <g key={m.t}>
          <line x1={x(m.v)} y1={m.up ? 38 : 70} x2={x(m.v)} y2={m.up ? 50 : 84} stroke={m.c} strokeWidth={2} />
          <text x={x(m.v)} y={m.up ? 32 : 96} textAnchor="middle" fill={m.c} fontSize={8.5} fontFamily="monospace">
            {m.t} {dbm(m.v)}
          </text>
        </g>
      ))}
      {[PV_THRESH.normalMin, PV_THRESH.marginalMin].map((v) => (
        <text key={v} x={x(v)} y={118} textAnchor="middle" fill={D.muted} fontSize={8.5} fontFamily="monospace">
          {v.toFixed(1)}
        </text>
      ))}
      <text x={320} y={140} textAnchor="middle" fill={D.muted} fontSize={9}>
        PacketVerse lesson thresholds — real limits come from each optic&apos;s own DOM thresholds and datasheet.
      </text>
    </DiagramSvg>
  );
}

function DeltaDiagram() {
  return (
    <DiagramSvg h={150} label="Two counter snapshots 30 seconds apart: baseline delta 0 despite a lifetime value of 3,912; incident delta +127">
      <DTable
        x={40}
        y={8}
        title={`ACCESS-SW ${UPLINK} CRC errors — read two snapshots ${WINDOW_S} s apart`}
        cols={[
          { label: "WINDOW", w: 140 },
          { label: "SNAPSHOT 1", w: 120 },
          { label: "SNAPSHOT 2", w: 120 },
          { label: "Δ", w: 180 },
        ]}
        rows={[
          ["Baseline", fmt(HISTORIC_CRC), fmt(HISTORIC_CRC), "0 → clean now"],
          ["Incident", "N", `N + ${WINDOW_CRC_FAULT}`, `+${WINDOW_CRC_FAULT} of ~${fmt(WINDOW_PKTS)} frames`],
        ]}
        highlight={{ row: 1, color: D.warning }}
      />
      <text x={320} y={118} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        {fmt(HISTORIC_CRC)} is history from an old event; only the delta over a known interval is &quot;now&quot;.
      </text>
    </DiagramSvg>
  );
}

function FcsDiagram() {
  const f = (label: string, sub: string, w: number, color: string, strong?: boolean) => ({ label, sub, w, color, strong });
  return (
    <DiagramSvg h={170} label="Ethernet frame with FCS trailer; the receiver recomputes CRC-32 over the received bits and discards the frame if it differs">
      <DFieldRow x={40} y={14} fields={[f("Dst MAC", "6 B", 80, D.eth), f("Src MAC", "6 B", 80, D.eth), f("Type", "2 B", 60, D.eth), f("IPv4 + ICMP payload", "46–1500 B", 220, D.ip), f("FCS", "CRC-32 · 4 B", 120, D.warning, true)]} />
      <DArrow x1={500} y1={70} x2={500} y2={100} color={D.warning} width={1.6} />
      <DPill x={500} y={114} text="receiver recomputes CRC-32" color={D.warning} w={190} />
      <text x={320} y={150} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        Match → accept. Mismatch → discard, CRC +1, input errors +1. Ethernet never repairs a frame; higher layers just see loss.
      </text>
    </DiagramSvg>
  );
}

function IncidentDiagram() {
  return (
    <DiagramSvg h={170} label="Incident evidence: ACCESS-SW Rx dropped to −19.8 dBm while DIST-SW Tx stayed −5.1 dBm; CRC rises only at ACCESS-SW">
      <DTable
        x={20}
        y={8}
        title="Incident evidence, side by side"
        cols={[
          { label: "MEASUREMENT", w: 230 },
          { label: "ACCESS-SW", w: 185 },
          { label: "DIST-SW", w: 185 },
        ]}
        rows={[
          ["Admin / oper", "up / up", "up / up"],
          ["Carrier transitions since baseline", "0", "0"],
          ["Tx", dbm(HEALTHY_OPTICS["ACCESS-SW"].tx), dbm(HEALTHY_OPTICS["DIST-SW"].tx)],
          ["Rx", `${dbm(FAULT_RX)} (was ${dbm(HEALTHY_OPTICS["ACCESS-SW"].rx)})`, dbm(HEALTHY_OPTICS["DIST-SW"].rx)],
          [`Δ CRC / ${WINDOW_S} s`, `+${WINDOW_CRC_FAULT}`, "+0"],
        ]}
        highlight={{ row: 3, color: D.warning }}
      />
    </DiagramSvg>
  );
}

function LossDiagram() {
  const seqs = Array.from({ length: 12 }, (_, i) => 31 + i);
  return (
    <DiagramSvg h={120} label="Ping sequence 31 to 42: every reply arrives except sequence 37, discarded with a bad FCS at ACCESS-SW">
      {seqs.map((q, i) => {
        const lost = q === 37;
        const x = 50 + i * 46;
        return (
          <g key={q}>
            <rect x={x} y={30} width={38} height={26} rx={5} fill={lost ? D.danger : D.success} fillOpacity={0.15} stroke={lost ? D.danger : D.success} strokeOpacity={0.6} />
            <text x={x + 19} y={47} textAnchor="middle" fill={lost ? D.danger : D.success} fontSize={9.5} fontFamily="monospace" fontWeight={700}>
              {q}
            </text>
          </g>
        );
      })}
      <text x={320} y={84} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        99 of 100 replies arrive. 1% loss is enough to make TCP transfers crawl — and to let &quot;ping works&quot; mislead you.
      </text>
    </DiagramSvg>
  );
}

function SuspectsDiagram() {
  return (
    <DiagramSvg h={170} label="Suspects ruled out by evidence: DNS, VLAN mismatch, routing metric and firewall policy">
      <DTable
        x={20}
        y={8}
        title="Every suspect tested against evidence you already have"
        cols={[
          { label: "SUSPECT", w: 150 },
          { label: "EVIDENCE AGAINST IT", w: 450 },
        ]}
        rows={[
          ["DNS", "pings by IP fail too; frames die at an FCS check"],
          ["VLAN mismatch", "99% of frames cross; a VLAN fault would drop all, with good FCS"],
          ["Routing metric", "one subnet — no router on the path"],
          ["Firewall policy", "no filter between the switches; discards are CRC failures"],
        ]}
      />
    </DiagramSvg>
  );
}

function VerifyDiagram() {
  return (
    <DiagramSvg h={170} label="Before and after the repair: Rx −19.8 to −6.4 dBm, CRC delta +127 to 0, ping loss 1% to 0%, carrier transitions +2 from the reseat, CRC total not reset">
      <DTable
        x={20}
        y={8}
        title="Same measurements, before and after"
        cols={[
          { label: "MEASUREMENT", w: 200 },
          { label: "INCIDENT", w: 180 },
          { label: "AFTER REPAIR", w: 220 },
        ]}
        rows={[
          ["ACCESS-SW Rx", dbm(FAULT_RX), dbm(REPAIRED_RX)],
          [`Δ CRC / ${WINDOW_S} s`, `+${WINDOW_CRC_FAULT}`, "0"],
          ["CRC total", "N", "N (not reset — history kept)"],
          ["Ping ×100", "1% loss", "0% loss"],
          ["Carrier transitions", "2", "4 (+2: down/up during reseat)"],
        ]}
        highlight={{ row: 1, color: D.success }}
      />
    </DiagramSvg>
  );
}

export function L1LessonGuideContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="l1l-mission" eyebrow="Mission" title="Layer 1 is evidence too" tone="cyan">
        <p>The physical layer turns light or voltage into bits. When it degrades it rarely fails cleanly — a link can stay UP for days while it quietly corrupts frames. This lesson teaches you to read interface state, optical levels and error counters as evidence, and to prove a repair with numbers.</p>
      </GuideSection>

      <GuideSection id="l1l-method" eyebrow="Method" title="The same workflow, at Layer 1" tone="violet">
        <DiagramFrame caption="Facts first — the lowest broken dependency wins.">
          <DiagramSvg h={82} label="Troubleshooting workflow">
            <WorkflowDiagram notes={["which path?", "which link?", "state · Δ · light", "one cause", "direction", "one change", "fresh Δ"]} />
          </DiagramSvg>
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="l1l-topology" eyebrow="Topology" title="One uplink carries everything" tone="cyan">
        <DiagramFrame caption="Two fibers, two directions — they can fail independently.">
          <TopologyDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="l1l-state" eyebrow="Interface state" title="Admin vs operational" tone="ethernet">
        <DiagramFrame caption="UP is necessary, not sufficient.">
          <StateDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="l1l-direction" eyebrow="Optics" title="Whose light is my Rx?" tone="warning">
        <DiagramFrame caption="Read each reading as one direction of one fiber.">
          <DirectionDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="l1l-thresholds" eyebrow="Optics" title="Light levels and thresholds" tone="warning">
        <DiagramFrame caption="dBm is logarithmic: −3 dB is half the light.">
          <ThresholdDiagram />
        </DiagramFrame>
        <Callout tone="warning" title="Lesson thresholds, not vendor limits">
          The bands here are PacketVerse teaching values. Real alarm and warning levels come from each transceiver&apos;s DOM thresholds and its datasheet.
        </Callout>
      </GuideSection>

      <GuideSection id="l1l-deltas" eyebrow="Counters" title="Read counters as deltas" tone="ip">
        <DiagramFrame caption="Two readings a known time apart turn history into a rate.">
          <DeltaDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="l1l-fcs" eyebrow="Ethernet trailer" title="The FCS check" tone="ethernet">
        <DiagramFrame caption="Corruption is detected at the receiver, and only there.">
          <FcsDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="l1l-incident" eyebrow="Incident" title="UP, stable — and erroring" tone="danger">
        <DiagramFrame caption="The evidence is one-directional.">
          <IncidentDiagram />
        </DiagramFrame>
        <p>
          DIST-SW&apos;s transmitter is unchanged; ACCESS-SW&apos;s receiver gets about 13.5 dB less light than at the baseline. The loss lies on the DIST → ACCESS path — a dirty or damaged connector, a bad patch, a bent fiber, or the receiver itself. VLANs, MAC tables and addressing are untouched.
        </p>
      </GuideSection>

      <GuideSection id="l1l-loss" eyebrow="Symptom" title="Intermittent loss" tone="danger">
        <DiagramFrame caption="Most frames survive, so most tests pass.">
          <LossDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="l1l-ladder" eyebrow="Ladder" title="The lowest failing rung" tone="cyan">
        <DiagramFrame caption="The application felt it; the physical layer caused it.">
          <DiagramSvg h={110} label="Evidence ladder: physical failing, everything above healthy or only symptomatic">
            <LadderDiagram
              rows={[
                { rung: "Physical / interface", evidence: `UP · Rx ${dbm(FAULT_RX)} · Δ CRC +${WINDOW_CRC_FAULT}`, status: "fail" },
                { rung: "Ethernet / VLAN", evidence: "good-FCS frames forwarded normally", status: "ok" },
                { rung: "IP addressing", evidence: "one subnet · no router", status: "ok" },
                { rung: "Transport / app", evidence: "1% loss · slow transfers (symptom)", status: "suspect" },
              ]}
            />
          </DiagramSvg>
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="l1l-suspects" eyebrow="Hypotheses" title="Ruling out the usual suspects" tone="violet">
        <DiagramFrame caption="Each suspect makes a prediction the evidence contradicts.">
          <SuspectsDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="l1l-verify" eyebrow="Verify" title="Repair the path, prove it with fresh numbers" tone="success">
        <DiagramFrame caption="Repairs do not erase counters — deltas prove the fix.">
          <VerifyDiagram />
        </DiagramFrame>
        <ChecklistCard tone="success" title="Verified" mark="✓" items={[`ACCESS-SW Rx ${dbm(REPAIRED_RX)} — back in the normal band`, `Δ CRC 0 over a fresh ${WINDOW_S} s window with traffic`, "The original ping test: 100/100", "Interface UP; carrier transitions +2 explained by the reseat"]} />
        <p>
          On real equipment: Juniper-style <Mono>show interfaces diagnostics optics ge-0/0/47</Mono>, Cisco-style <Mono>show interfaces transceiver detail</Mono>.
        </p>
      </GuideSection>

      <GuideSection id="l1l-glossary" eyebrow="Glossary" title="Terms" tone="cyan">
        <Glossary
          items={[
            { term: "Admin state", def: "What the configuration asks for: enabled or disabled." },
            { term: "Operational state", def: "What the hardware achieved: link up or down." },
            { term: "DOM", def: "Digital optical monitoring: an optic's own Tx/Rx power, temperature and threshold flags." },
            { term: "dBm", def: "Optical power relative to 1 milliwatt, logarithmic (−3 dB ≈ half)." },
            { term: "FCS / CRC", def: "Frame Check Sequence: a CRC-32 over the frame, recomputed and compared by the receiver." },
            { term: "Carrier transition", def: "One link state change (up→down or down→up)." },
          ]}
        />
      </GuideSection>
    </div>
  );
}
