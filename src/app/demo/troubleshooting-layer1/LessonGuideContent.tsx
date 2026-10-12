import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DiagramFrame, DiagramSvg, DLink, DNode, DPill, FailureSignatures, FieldTable, Glossary, GuideSection, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { DFieldRow, DTable } from "@/components/lesson/FundamentalsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { FAULT_RX, HEALTHY_OPTICS, HISTORIC_CRC, MEDIA, PV_THRESH, REPAIRED_RX, UPLINK, WINDOW_CRC_FAULT, WINDOW_PKTS, WINDOW_S, dbm } from "@/lib/sim-engine/scenarios/troubleshootingLayer1";
import { PracticeBridge } from "@/components/lesson/GuideInteractive";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import { PresentationBridge } from "@/components/presentation/LessonPresentation";
import { CliPanel, pickLines, runGuideCli } from "@/components/lesson/GuideCli";
import { createL1Net, l1Apply, l1Ticket, l1TicketState, snapDelta, testText, type L1Action, type L1D, type L1State, type L1TicketId } from "@/lib/sim-engine/scenarios/l1Net";
import { l1Sets, l1StaticApi } from "./l1-lab/l1Cli";

export const L1_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "ll-mission", label: "What this lesson teaches" },
  { id: "ll-network", label: "The network of this lesson" },
  { id: "ll-ideas", label: "Three ideas you need" },
  { id: "ll-watch", label: "What you will watch" },
  { id: "ll-states", label: "Admin state and link state" },
  { id: "ll-light", label: "Light in both directions" },
  { id: "ll-bands", label: "Normal, marginal, no signal" },
  { id: "ll-counters", label: "Counters are history" },
  { id: "ll-fcs", label: "How a bad frame is caught" },
  { id: "ll-working", label: "What working looks like" },
  { id: "ll-incident", label: "The slow-download incident" },
  { id: "ll-locate", label: "Follow the light" },
  { id: "ll-delta", label: "Errors as a rate, on one side" },
  { id: "ll-suspects", label: "What it isn't" },
  { id: "ll-repair", label: "Repair and proof" },
  { id: "ll-other", label: "Other ways it breaks" },
  { id: "ll-model", label: "Mental model" },
  { id: "ll-glossary", label: "Glossary" },
  { id: "ll-recap", label: "Recap" },
  { id: "ll-practice", label: "Practice it" },
];

/** Real Junos and Linux output on this page comes from the Layer 1 Lab. */
const run = (s: L1State, ...a: L1Action[]) => a.reduce((acc, x) => l1Apply(acc, x), s);
export const l1TicketRun = (id: L1TicketId) => l1Ticket(id).repro.reduce((acc, a) => l1Apply(acc, a), l1TicketState(id, 1));
const pair: L1Action[] = [{ type: "snapshot" }, { type: "wait", secs: WINDOW_S }, { type: "snapshot" }];
export const L1G = { healthy: run(createL1Net(0), { type: "ping", count: 4 }, { type: "iperf", reverse: true }, ...pair) };
export const L1_INC = run(l1TicketRun("dirty"), { type: "iperf" }, ...pair);
export const L1_FIX = run(L1_INC, { type: "phys", id: "clean-a" }, ...pair, { type: "ping", count: 100 });
export function l1Cli(s: L1State, d: L1D, command: string) {
  return runGuideCli(l1Sets(l1StaticApi(s, d), d).juniper, command);
}
export function l1Only(s: L1State, d: L1D, command: string, match: RegExp, keep = 0) {
  const x = l1Cli(s, d, command);
  return { ...x, output: pickLines(x.output, match, keep) };
}
/** Tests as the lab reports them (from test `from` on; production-traffic waits skipped). */
export function L1Result({ s, title, from = 0 }: { s: L1State; title: string; from?: number }) {
  const ts = s.tests.slice(from).filter((t) => t.kind !== "wait");
  const ok = ts.every((t) => (t.kind === "ping" ? !t.unreachable && t.recv === t.sent : (t.mbps ?? 0) >= 900));
  return (
    <Callout tone={ok ? "success" : "danger"} title={title} icon={ok ? "✓" : "!"}>
      {ts.map(testText).join(" · ")}
    </Callout>
  );
}
/** The last snapshot pair, both ends of the uplink and the copper ports. */
export function L1Delta({ s, title }: { s: L1State; title: string }) {
  const d = snapDelta(s);
  if (!d) return null;
  const rows = (["ACCESS-SW:ge-0/0/1", `ACCESS-SW:${UPLINK}`, `DIST-SW:${UPLINK}`, "DIST-SW:ge-0/0/2"] as const).map((k) => [k.replace(":", " "), `+${d.d[k].inPkts.toLocaleString("en-US")}`, `+${d.d[k].crc}`, `+${d.d[k].runts}`, `+${d.d[k].carrier}`]);
  return <FieldTable title={`${title} (${d.secs} s, from the lab)`} accent="violet" columns={["interface", "packets in", "CRC/align", "runts", "carrier"]} rows={rows} />;
}

function LessonLabBridge() {
  const openLab = usePracticeLabOpener();
  return (
    <PracticeBridge label="Open the Layer 1 Lab" onPractice={openLab}>
      The network of this lesson live: link states and negotiation, both ends&apos; optics, error counters with snapshots, ping and iperf3, a field kit, Junos EX and Linux consoles — your own copy. Nothing you do there changes your lesson progress.
    </PracticeBridge>
  );
}

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


const T = { admin: l1TicketRun("admin"), duplex: l1TicketRun("duplex"), los: l1TicketRun("los"), copper: run(l1TicketRun("copper"), { type: "tdr", dev: "ACCESS-SW" }) };

export function L1LessonGuideContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="ll-mission" eyebrow="This lesson" title="What this lesson teaches" tone="cyan">
        <p>
          When something is slow or flaky, the physical layer is the first suspect and the last one people actually measure. An interface that says <b className="text-pv-text">UP</b> only tells you the two ends can hear each other — not that every bit arrives intact. This lesson answers: <b className="text-pv-text">how do you read the physical layer as evidence, and prove a physical fault before you change anything?</b>
        </p>
        <p>You will read admin and link state, the light an optic sends and receives, error counters as rates rather than totals, and how a frame with damaged bits is caught and silently discarded. Then you will chase the guided lesson&apos;s incident — an uplink that stays UP while it corrupts frames in one direction — and prove the repair with fresh measurements.</p>
        <ChecklistCard tone="cyan" title="By the end of this lesson you can" mark="→" items={["tell admin down from link down, and know where each sends you", "read Tx and Rx at both ends of a fiber and find the direction that loses light", "turn counters into a rate with two snapshots", "explain why a link can stay up while CRC errors rise on one side", "recognise duplex mismatch, downshift and loss of signal", "repair the right thing and prove it with fresh evidence"]} />
      </GuideSection>

      <GuideSection id="ll-network" eyebrow="This lesson" title="The network of this lesson" tone="cyan">
        <DiagramFrame caption="The guided lesson's topology.">
          <TopologyDiagram />
        </DiagramFrame>
        <p>
          CLIENT (<Mono>10.30.30.10</Mono>) and SERVER (<Mono>10.30.30.20</Mono>) share one subnet — no router in between. CLIENT plugs into ACCESS-SW on copper; the two switches are joined by a <b className="text-pv-text">{MEDIA}</b> uplink on <Mono>{UPLINK}</Mono>; SERVER plugs into DIST-SW on copper. Every frame between the hosts crosses three physical links.
        </p>
        <Callout tone="cyan" title="The lesson and the lab" icon="i">
          The guided lesson walks the incident step by step on these four devices. The lab runs the same network live: the switches are Junos EX (ELS) with real <Mono>show interfaces</Mono>, optics and TDR commands, the hosts run Linux with <Mono>ethtool</Mono>, <Mono>ping</Mono> and <Mono>iperf3</Mono>, and a field kit lets you clean connectors and replace cables. The light-level bands (normal ≥ {PV_THRESH.normalMin.toFixed(1)} dBm, marginal down to {PV_THRESH.marginalMin.toFixed(1)} dBm) are the lesson&apos;s teaching values, programmed into the lab&apos;s optics as their warning and alarm thresholds. Outputs below come from the lab.
        </Callout>
      </GuideSection>

      <GuideSection id="ll-ideas" eyebrow="This lesson" title="Three ideas you need" tone="violet">
        <CompareCards
          items={[
            { title: "Admin vs link", tone: "cyan", tag: "two states", points: ["admin = configured intent", "link = what the hardware achieved"] },
            { title: "Rx is the peer's Tx", tone: "violet", tag: "direction", points: ["minus the strand's loss", "read both ends"] },
            { title: "Deltas, not totals", tone: "success", tag: "now", points: ["two snapshots, known interval", "with traffic flowing"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="ll-watch" eyebrow="This lesson" title="What you will watch" tone="cyan">
        <TroubleshootingFlow
          steps={[
            { question: "A healthy baseline", look: `${testText(L1G.healthy.tests[0])}; CRC +0 over ${WINDOW_S} s despite ${HISTORIC_CRC.toLocaleString("en-US")} old errors` },
            { question: "The incident", look: `${testText(L1_INC.tests[0])} · ${testText(L1_INC.tests[1])}` },
            { question: "The light", look: `ACCESS-SW receives ${dbm(FAULT_RX)} instead of ${dbm(HEALTHY_OPTICS["ACCESS-SW"].rx)}; DIST-SW's laser is fine` },
            { question: "The counters", look: `CRC +${WINDOW_CRC_FAULT} per ${WINDOW_S} s on ACCESS-SW only` },
            { question: "Repair and proof", look: `clean the ACCESS end → Rx ${dbm(REPAIRED_RX)}, CRC +0, 100/100 pings` },
          ]}
        />
      </GuideSection>

      <GuideSection id="ll-states" eyebrow="Healthy" title="Admin state and link state" tone="cyan">
        <DiagramFrame caption="The guided lesson's admin/operational combinations.">
          <StateDiagram />
        </DiagramFrame>
        <p>
          <b className="text-pv-text">Admin</b> is what the configuration asks for: <Mono>disable</Mono> makes it down. <b className="text-pv-text">Link</b> (operational) is what the hardware achieved: signal detected, negotiation complete. <Mono>up / up</Mono> is healthy. <Mono>up / down</Mono> means the port wants to work but has no usable signal — look at the cable, the optic, the far end. <Mono>down / down</Mono> is a configuration fact.
        </p>
        <CliPanel run={l1Cli(L1G.healthy, "ACCESS-SW", "show interfaces terse")} caption="Junos · ACCESS-SW — every interface admin up, link up" />
        <CliPanel run={l1Cli(T.admin, "DIST-SW", "show interfaces terse")} caption="Junos · DIST-SW — a disabled port: ge-0/0/2 down / down" />
        <CliPanel run={l1Only(T.admin, "SERVER", "ethtool eth0", /Speed|Duplex|Link detected/, 0)} caption="Linux · SERVER — the far end of a disabled port sees no link at all" />
      </GuideSection>

      <GuideSection id="ll-light" eyebrow="Healthy" title="Light in both directions" tone="violet">
        <DiagramFrame caption="The guided lesson's two directions.">
          <DirectionDiagram />
        </DiagramFrame>
        <p>
          A fiber link is two strands, one per direction. Each optic reports its own transmit power and the power it receives. Receive power is the <i>peer&apos;s</i> transmit power minus everything in between — connectors, patch panels, the fiber itself. Here the path costs about 1.2 dB: DIST-SW sends {dbm(HEALTHY_OPTICS["DIST-SW"].tx)}, ACCESS-SW receives {dbm(HEALTHY_OPTICS["ACCESS-SW"].rx)}.
        </p>
        <CliPanel run={l1Only(L1G.healthy, "ACCESS-SW", `show interfaces diagnostics optics ${UPLINK}`, /Laser output power  |Receiver signal|rx power low (warning|alarm)  /, 1)} caption="Junos · ACCESS-SW — Tx −5.00, Rx −6.30 dBm, no alarms" />
        <CliPanel run={l1Only(L1G.healthy, "DIST-SW", `show interfaces diagnostics optics ${UPLINK}`, /Laser output power  |Receiver signal/, 1)} caption="Junos · DIST-SW — Tx −5.10, Rx −6.20 dBm" />
      </GuideSection>

      <GuideSection id="ll-bands" eyebrow="Healthy" title="Normal, marginal, no signal" tone="warning">
        <DiagramFrame caption="The guided lesson's teaching thresholds.">
          <ThresholdDiagram />
        </DiagramFrame>
        <p>
          dBm is logarithmic: every 3 dB less is half the light. Above the normal band the receiver decodes every bit. In the <b className="text-pv-text">marginal</b> band the link stays up — the receiver still sees a signal — but some bits are misread. Below it there is no usable signal: loss of signal, link down. The optic&apos;s own thresholds raise a warning at {PV_THRESH.normalMin.toFixed(2)} dBm and an alarm at {PV_THRESH.marginalMin.toFixed(2)} dBm.
        </p>
      </GuideSection>

      <GuideSection id="ll-counters" eyebrow="Healthy" title="Counters are history" tone="violet">
        <DiagramFrame caption="The guided lesson's two snapshots.">
          <DeltaDiagram />
        </DiagramFrame>
        <p>
          ACCESS-SW&apos;s uplink shows {HISTORIC_CRC.toLocaleString("en-US")} CRC errors. That number accumulates from boot or the last <Mono>clear interfaces statistics</Mono> — it could be weeks old. To know what is happening <i>now</i>, read the counter twice with traffic in between and divide by the interval.
        </p>
        <CliPanel run={l1Only(L1G.healthy, "ACCESS-SW", `show interfaces ${UPLINK} extensive`, /Statistics last cleared|Input  packets|Framing errors|Carrier transitions|CRC\/Align/)} caption="Junos · ACCESS-SW — 3,912 CRC errors, never cleared" />
        <L1Delta s={L1G.healthy} title="Two snapshots on the healthy network" />
        <Callout tone="success" title="Zero, with traffic flowing" icon="✓">
          {snapDelta(L1G.healthy)!.d[`ACCESS-SW:${UPLINK}`].inPkts.toLocaleString("en-US")} frames received in {WINDOW_S} s, CRC +0. The 3,912 are history.
        </Callout>
      </GuideSection>

      <GuideSection id="ll-fcs" eyebrow="Healthy" title="How a bad frame is caught" tone="cyan">
        <DiagramFrame caption="The guided lesson's FCS check.">
          <FcsDiagram />
        </DiagramFrame>
        <p>
          The sender computes a CRC-32 over the frame and appends it as the <b className="text-pv-text">Frame Check Sequence</b>. The receiver recomputes it over the bits it actually received. If one bit flipped on the way, the values differ: the frame is discarded, the interface counts a CRC error, and nothing is sent back to tell anyone. Higher layers only notice the absence — a missing ping reply, a TCP retransmission.
        </p>
      </GuideSection>

      <GuideSection id="ll-working" eyebrow="Evidence" title="What working looks like" tone="success">
        <FieldTable
          title="Healthy, in five questions"
          accent="success"
          columns={["Question", "Where", "Healthy answer"]}
          rows={[
            ["Every link admin up, link up?", <Mono key="1">show interfaces terse</Mono>, "up / up on every port"],
            ["Light normal at both ends?", <Mono key="2">show interfaces diagnostics optics ge-0/0/47</Mono>, "Rx ≈ −6.3 / −6.2 dBm, no warnings"],
            ["Errors rising now?", "two snapshots, 30 s of traffic", "CRC +0, runts +0, carrier +0"],
            ["Speed and duplex agree?", <Mono key="4">ethtool eth0 · show interfaces ge-0/0/1</Mono>, "1000 Mb/s full at both ends, auto-negotiated"],
            ["Does traffic flow?", <Mono key="5">ping · iperf3 -R</Mono>, "0% loss · ≈ 941 Mbit/s"],
          ]}
        />
        <L1Result s={L1G.healthy} title="The lab: the healthy baseline" />
      </GuideSection>

      <GuideSection id="ll-incident" eyebrow="Incident" title="The slow-download incident" tone="danger">
        <Callout tone="danger" title="The report" icon="!">
          {l1Ticket("dirty").report}
        </Callout>
        <DiagramFrame caption="The guided lesson's incident evidence.">
          <IncidentDiagram />
        </DiagramFrame>
        <L1Result s={L1_INC} title="The lab: reproducing it" />
        <p>
          Ping “mostly works” — one reply in a hundred is missing. Downloads crawl at {L1_INC.tests[1].mbps} Mbit/s while uploads still run at {L1_INC.tests[2].mbps}. A symptom that depends on direction is a strong hint: something on one path only. And the uplink still says UP:
        </p>
        <CliPanel run={l1Only(L1_INC, "ACCESS-SW", "show interfaces terse", /Interface|ge-0\/0\/47 /)} caption="Junos · ACCESS-SW — the uplink is up / up" />
        <CliPanel run={l1Only(L1_INC, "CLIENT", "iperf3 -c 10.30.30.20 -t 10 -R", /Reverse|sender|receiver/)} caption="Linux · CLIENT — the download: 186 Mbit/s, 1,874 retransmissions by SERVER" />
      </GuideSection>

      <GuideSection id="ll-locate" eyebrow="Investigation" title="Follow the light" tone="ip">
        <DiagramFrame caption="The guided lesson's lost reply.">
          <LossDiagram />
        </DiagramFrame>
        <CliPanel run={l1Only(L1_INC, "ACCESS-SW", `show interfaces diagnostics optics ${UPLINK}`, /Laser output power  |Receiver signal|rx power low (warning|alarm)  /, 1)} caption="Junos · ACCESS-SW — Rx −19.80 dBm: low-warning on, link still up" />
        <CliPanel run={l1Only(L1_INC, "DIST-SW", `show interfaces diagnostics optics ${UPLINK}`, /Laser output power  |Receiver signal/, 1)} caption="Junos · DIST-SW — its laser still sends −5.10 dBm; its own Rx is normal" />
        <ChecklistCard tone="ip" title="What the light says" mark="→" items={["DIST-SW's transmitter is healthy (−5.10 dBm)", "ACCESS-SW receives 13.5 dB less than its baseline", "the other direction (ACCESS → DIST) is normal", "so the light is lost on the DIST → ACCESS path: the strand, a connector, or the ACCESS receiver"]} />
      </GuideSection>

      <GuideSection id="ll-delta" eyebrow="Investigation" title="Errors as a rate, on one side" tone="violet">
        <p>Low light should mean misread bits on the receiving side — and only there. A fresh snapshot pair confirms it:</p>
        <L1Delta s={L1_INC} title="Two snapshots during the incident" />
        <CliPanel run={l1Only(L1_INC, "DIST-SW", `show interfaces ${UPLINK} extensive`, /Framing errors|CRC\/Align/)} caption="Junos · DIST-SW — no CRC errors on the healthy direction" />
        <Callout tone="cyan" title="Two independent witnesses" icon="i">
          The optic says the light is low on the way into ACCESS-SW; the counters say frames fail their FCS on the way into ACCESS-SW — at {WINDOW_CRC_FAULT} per {WINDOW_S} s out of about {WINDOW_PKTS.toLocaleString("en-US")}. Both point at the same strand before anyone touches anything.
        </Callout>
      </GuideSection>

      <GuideSection id="ll-suspects" eyebrow="Investigation" title="What it isn't" tone="warning">
        <DiagramFrame caption="The guided lesson's suspects, ruled out by evidence.">
          <SuspectsDiagram />
        </DiagramFrame>
        <p className="text-sm text-pv-text-muted">DNS isn&apos;t involved in pings to an IP address; a VLAN problem would drop every frame cleanly, not one in four hundred with a bad FCS; there is no router or firewall between two hosts on one subnet. The evidence is physical, so the fix is physical.</p>
      </GuideSection>

      <GuideSection id="ll-repair" eyebrow="Repair" title="Repair and proof" tone="success">
        <p>Clean and reseat the uplink fiber at the ACCESS end — the end with the low Rx. Replacing DIST-SW&apos;s optic wouldn&apos;t help (its laser is fine), and clearing counters only resets numbers.</p>
        <CliPanel run={l1Only(L1_FIX, "ACCESS-SW", "show log messages", /ge-0\/0\/47/)} caption="Junos · ACCESS-SW — the reseat flaps the link: down, then up" />
        <CliPanel run={l1Only(L1_FIX, "ACCESS-SW", `show interfaces diagnostics optics ${UPLINK}`, /Receiver signal|rx power low warning  /)} caption="Junos · ACCESS-SW — Rx −6.40 dBm, warning off" />
        <L1Delta s={L1_FIX} title="A fresh snapshot pair after the repair" />
        <L1Result s={L1_FIX} from={L1_INC.tests.length} title="The lab: the same 100-ping test, again" />
        <DiagramFrame caption="The guided lesson's before and after.">
          <VerifyDiagram />
        </DiagramFrame>
        <ChecklistCard tone="success" title="Proved, not assumed" mark="✓" items={["receive level back in the normal band", "CRC +0 over a fresh interval with traffic flowing", "100/100 pings", "carrier transitions +2 — the reseat, as expected; the lifetime CRC total was never cleared"]} />
      </GuideSection>

      <GuideSection id="ll-other" eyebrow="Beyond this incident" title="Other ways it breaks" tone="warning">
        <FailureSignatures
          items={[
            { tag: "ADM", title: "Port disabled", tone: "warning", points: ["down / down on the switch", "far end: no link"] },
            { tag: "DUP", title: "Duplex mismatch", tone: "danger", points: ["one end forced, other negotiates", "late collisions vs CRC + runts"] },
            { tag: "LOS", title: "No light", tone: "danger", points: ["Rx loss-of-signal alarm", "remote fault: both ends down"] },
            { tag: "DSH", title: "Downshift", tone: "violet", points: ["100 Mb/s, no errors", "TDR: an open pair"] },
          ]}
        />
        <CliPanel run={l1Only(T.duplex, "CLIENT", "ethtool eth0", /Link partner advertised auto|Speed|Duplex/)} caption="Linux · CLIENT — duplex mismatch: the switch stopped negotiating, CLIENT assumed half duplex" />
        <CliPanel run={l1Only(T.los, "ACCESS-SW", `show interfaces diagnostics optics ${UPLINK}`, /Receiver signal|rx power low alarm  /)} caption="Junos · ACCESS-SW — loss of signal: no light at all" />
        <CliPanel run={l1Only(T.copper, "ACCESS-SW", "show diagnostics tdr interface ge-0/0/1", /MDI pair\s+: 4-5|Open|Distance fault\s+: 12|Downshift/)} caption="Junos · ACCESS-SW — TDR: pair 4-5 open at 12 m, link downshifted" />
        <p className="text-sm text-pv-text-muted">Each is a ticket in the Layer 1 Lab, together with this incident.</p>
      </GuideSection>

      <GuideSection id="ll-model" eyebrow="Mental model" title="Mental model" tone="cyan">
        <p>
          Think of a phone call on a bad line. “Connected” on the screen is the link state — the call is up. Whether you hear every word is a different question: a crackling line keeps the call up while words get lost, and only the listener at the crackling end notices. You don&apos;t judge the line by last week&apos;s complaints (the lifetime counter) but by how many words get lost in the next minute (the delta). And you check which direction crackles before you replace anyone&apos;s phone.
        </p>
        <Callout tone="cyan" title="When it breaks, ask in this order" icon="→">
          Is every link admin up and link up? Is the light normal at both ends of every fiber? Are errors rising now — on which side? Do speed and duplex agree at both ends? Then fix one thing and measure again.
        </Callout>
      </GuideSection>

      <GuideSection id="ll-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "Admin state", def: "What the configuration asks for (disable = down)." },
            { term: "Link (operational) state", def: "Whether the hardware achieved a usable link." },
            { term: "Tx / Rx power", def: "Optical power an optic transmits / receives, in dBm (DOM readings)." },
            { term: "dBm", def: "Power relative to 1 mW on a log scale; −3 dB is half the light." },
            { term: "FCS / CRC", def: "The CRC-32 trailer of every Ethernet frame; a mismatch means damaged bits." },
            { term: "Delta", def: "The change of a counter over a known interval." },
            { term: "Carrier transition", def: "A link up/down change (a flap)." },
            { term: "Loss of signal (LOS)", def: "No usable light at a receiver; the link goes down." },
          ]}
        />
      </GuideSection>

      <GuideSection id="ll-recap" eyebrow="Reference" title="Recap" tone="success">
        <ChecklistCard tone="success" title="You can now" mark="✓" items={["tell admin down from link down", "read Tx/Rx at both ends and find the bad direction", "turn counters into rates", "explain UP-but-corrupting links", "recognise duplex mismatch, downshift and LOS", "prove a physical repair with fresh evidence"]} />
      </GuideSection>

      <GuideSection id="ll-practice" eyebrow="Next" title="Practice it" tone="violet">
        <p>The Deep Dive tab covers the physical layer in full: media and optics, light budgets, how CRC works, every error counter, rates from snapshots, auto-negotiation, duplex and downshift, loss of signal, TDR, and every failure signature with real evidence. The lab lets you measure, break and repair it yourself.</p>
        <LessonLabBridge />
        <PresentationBridge>Rewatch the Layer 1 presentation.</PresentationBridge>
      </GuideSection>
    </div>
  );
}
