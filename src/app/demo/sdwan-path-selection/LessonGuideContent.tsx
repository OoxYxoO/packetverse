import { Callout, ChecklistCard, CompareCards, DIAGRAM as D, DiagramFrame, DiagramSvg, DPill, DArrow, FlowSteps, Glossary, GuideSection } from "@/components/lesson/GuideBlocks";
import { DTable } from "@/components/lesson/FundamentalsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { HYSTERESIS_INTERVALS, PROBES_PER_INTERVAL, SD, VOICE_SLA, probeSamples, slaChecks, summarize } from "@/lib/sim-engine/scenarios/sdwanPathSelection";
import { SdTopo } from "./guideSvg";

export const SD_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "sdl-mission", label: "The mission" },
  { id: "sdl-topology", label: "Underlay & overlay" },
  { id: "sdl-probes", label: "The probe model" },
  { id: "sdl-healthy", label: "Healthy metrics" },
  { id: "sdl-policy", label: "Voice vs Bulk policy" },
  { id: "sdl-steering", label: "Two paths at once" },
  { id: "sdl-degrade", label: "TUN-A degrades" },
  { id: "sdl-failover", label: "Voice failover" },
  { id: "sdl-recover", label: "Recovery 1/3 → 3/3" },
  { id: "sdl-monitor", label: "Bad monitor target" },
  { id: "sdl-incident", label: "Zero eligible paths" },
  { id: "sdl-repair", label: "Repair & verify" },
  { id: "sdl-model", label: "Mental model" },
  { id: "sdl-glossary", label: "Glossary" },
];

// Every metric shown below is computed from the scenario's own sample model.
const healthyA = summarize(1, SD.hubLo, probeSamples("TUN-A", "healthy", SD.hubLo));
const healthyB = summarize(1, SD.hubLo, probeSamples("TUN-B", "healthy", SD.hubLo));
const badA = summarize(2, SD.hubLo, probeSamples("TUN-A", "degraded", SD.hubLo));
const rowsFor = (m: typeof healthyA) => slaChecks(m).map((c) => [c.metric, c.value, c.threshold, c.pass ? "PASS" : "FAIL"]);

function TopologyDiagram() {
  return (
    <DiagramSvg h={260} label="Underlay circuits through ISP-A and ISP-B, and the two overlay paths TUN-A and TUN-B between BRANCH-EDGE and HUB-EDGE">
      <SdTopo a={{ label: "TUN-A overlay (over ISP-A)", color: D.cyan }} b={{ label: "TUN-B overlay (over ISP-B)", color: D.violet }} subs={{ C: SD.client, APP: SD.app, HUB: "lo .0.1" }} />
      <text x={320} y={252} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        Solid lines = underlay circuits · dashed curves = overlay paths (encapsulation vendor-specific, not drawn)
      </text>
    </DiagramSvg>
  );
}

function ProbeDiagram() {
  return (
    <DiagramSvg h={260} label="ICMP Echo probes from 10.255.1.1 to 10.255.0.1 on each path; 500 per interval become RTT, jitter and loss">
      <SdTopo a={{ mode: "probe", label: "Echo → 10.255.0.1 on TUN-A" }} b={{ mode: "probe", label: "Echo → 10.255.0.1 on TUN-B" }} subs={{ BR: "lo .1.1", HUB: "lo .0.1" }} />
      <text x={320} y={250} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        {`PacketVerse SLA measurement model: ${PROBES_PER_INTERVAL} ordinary ICMP probes per path per interval (not mandatory in real products)`}
      </text>
    </DiagramSvg>
  );
}

function HealthyDiagram() {
  return (
    <DiagramSvg h={200} label="Healthy metrics: TUN-A 25 ms, 3 ms, 0.2%; TUN-B 55 ms, 8 ms, 0.4%; both pass the Voice SLA">
      <DTable x={10} y={8} title="TUN-A — healthy" cols={[{ label: "METRIC", w: 64 }, { label: "MEASURED", w: 76 }, { label: "SLA", w: 70 }, { label: "", w: 94 }]} rows={rowsFor(healthyA)} color={D.cyan} />
      <DTable x={326} y={8} title="TUN-B — healthy" cols={[{ label: "METRIC", w: 64 }, { label: "MEASURED", w: 76 }, { label: "SLA", w: 70 }, { label: "", w: 94 }]} rows={rowsFor(healthyB)} color={D.violet} />
      <DPill x={160} y={140} text="SLA PASS · eligible" color={D.success} w={170} />
      <DPill x={480} y={140} text="SLA PASS · eligible" color={D.success} w={170} />
      <text x={320} y={184} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        RTT = mean reply time · jitter = mean change between consecutive RTTs · loss = unanswered / sent
      </text>
    </DiagramSvg>
  );
}

function PolicyDiagram() {
  return (
    <DiagramSvg h={150} label="Application policy: VOICE SLA required, prefer TUN-A then TUN-B; BULK no SLA, prefer TUN-B then TUN-A">
      <DTable
        x={14}
        y={8}
        title="Installed application policy (BRANCH-EDGE)"
        cols={[
          { label: "CLASS", w: 70 },
          { label: "MATCH", w: 200 },
          { label: "SLA", w: 120 },
          { label: "PREFERENCE", w: 122 },
          { label: "NO PATH", w: 100 },
        ]}
        rows={[
          ["VOICE", "UDP 16384–32767 + DSCP EF", `required (${VOICE_SLA.rtt}/${VOICE_SLA.jitter}/${VOICE_SLA.loss})`, "TUN-A → TUN-B", "drop (config)"],
          ["BULK", "TCP dst 873", "none", "TUN-B → TUN-A", "drop"],
        ]}
      />
      <text x={320} y={132} textAnchor="middle" fill={D.muted} fontSize={10}>
        SLA decides which paths are allowed; preference decides among the allowed ones.
      </text>
    </DiagramSvg>
  );
}

function SteeringDiagram() {
  return (
    <DiagramSvg h={260} label="Voice on TUN-A and Bulk on TUN-B at the same time">
      <SdTopo a={{ mode: "flow", label: "VOICE (UDP, EF) on TUN-A", color: D.warning }} b={{ mode: "flow", label: "BULK (TCP 873) on TUN-B", color: D.success }} lan={{ left: "x", right: "x", color: D.cyan }} />
      <text x={320} y={250} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        Application-policy steering — not ECMP. Each class follows its own preference.
      </text>
    </DiagramSvg>
  );
}

function DegradeDiagram() {
  return (
    <DiagramSvg h={180} label="TUN-A degraded: 160 ms RTT, 40 ms jitter, 2.0% loss — all three fail the Voice SLA">
      <DTable x={120} y={8} title="TUN-A — degraded interval" cols={[{ label: "METRIC", w: 80 }, { label: "MEASURED", w: 100 }, { label: "SLA", w: 100 }, { label: "", w: 120 }]} rows={rowsFor(badA)} color={D.warning} />
      <text x={320} y={144} textAnchor="middle" fill={D.warning} fontSize={10.5} fontWeight={700}>
        ISP-A circuit UP · TUN-A reachable · Voice SLA FAIL → reachable but SLA-ineligible
      </text>
      <text x={320} y={164} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        A brownout, not a blackout. Each failure is recorded on its own.
      </text>
    </DiagramSvg>
  );
}

function FailoverDiagram() {
  return (
    <DiagramSvg h={260} label="Voice moves to TUN-B; Bulk stays on TUN-B; TUN-A stays reachable but ineligible">
      <SdTopo a={{ mode: "fail", label: "TUN-A · reachable, SLA-ineligible" }} b={{ mode: "flow", label: "VOICE + BULK on TUN-B", color: D.success }} lan={{ left: "x", right: "x", color: D.cyan }} />
      <text x={320} y={250} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        Decided locally by BRANCH-EDGE: VOICE needs an eligible path; TUN-B is the only one.
      </text>
    </DiagramSvg>
  );
}

function RecoveryDiagram() {
  const cells = [
    { t: "FAIL", c: D.danger, n: "ineligible" },
    { t: "PASS", c: D.success, n: `1/${HYSTERESIS_INTERVALS}` },
    { t: "PASS", c: D.success, n: `2/${HYSTERESIS_INTERVALS}` },
    { t: "PASS", c: D.success, n: `3/${HYSTERESIS_INTERVALS} → eligible` },
  ];
  return (
    <DiagramSvg h={180} label="Recovery hysteresis: after a failing interval, three consecutive passing intervals are needed before TUN-A is eligible and Voice returns">
      {cells.map((x, i) => (
        <g key={i}>
          <rect x={30 + i * 150} y={30} width={130} height={40} rx={8} fill={x.c} fillOpacity={0.14} stroke={x.c} />
          <text x={95 + i * 150} y={48} textAnchor="middle" fill={D.text} fontSize={10.5} fontWeight={700}>
            {`TUN-A ${x.t}`}
          </text>
          <text x={95 + i * 150} y={63} textAnchor="middle" fill={x.c} fontSize={9.5} fontFamily="monospace">
            {x.n}
          </text>
          {i > 0 && <DArrow x1={30 + i * 150 - 18} y1={50} x2={30 + i * 150 - 4} y2={50} color={D.line} width={1.5} />}
        </g>
      ))}
      <DPill x={170} y={104} text="VOICE stays on TUN-B" color={D.violet} w={170} />
      <DPill x={530} y={104} text="VOICE back on TUN-A" color={D.success} w={170} />
      <text x={320} y={146} textAnchor="middle" fill={D.text} fontSize={10}>
        {`Modeled rule: ${HYSTERESIS_INTERVALS} consecutive passing intervals before a recovered path is trusted.`}
      </text>
      <text x={320} y={164} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        This is the PacketVerse lesson&apos;s hysteresis, not a universal SD-WAN standard.
      </text>
    </DiagramSvg>
  );
}

function MonitorDiagram() {
  return (
    <DiagramSvg h={260} label="TUN-B probes go to 10.255.0.99, which nothing at the hub owns; no replies, so TUN-B has no valid SLA result even though ISP-B and TUN-B work">
      <SdTopo a={{ label: "TUN-A · probes to 10.255.0.1 answered" }} b={{ mode: "probe", label: "Echo → 10.255.0.99 · no reply", color: D.danger, mark: "hub" }} subs={{ HUB: "lo .0.1 only" }} />
      <text x={320} y={250} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        ISP-B UP · TUN-B reachable (Bulk still uses it) · monitor: 0 valid replies → no SLA result
      </text>
    </DiagramSvg>
  );
}

function IncidentDiagram() {
  return (
    <DiagramSvg h={260} label="TUN-A degraded and TUN-B without a valid SLA result: Voice has zero eligible paths and is dropped at BRANCH-EDGE by configured policy; Bulk still uses TUN-B">
      <SdTopo a={{ mode: "fail", label: "TUN-A · SLA FAIL (160/40/2.0)" }} b={{ mode: "flow", label: "BULK only · TUN-B no SLA result", color: D.success }} lan={{ left: "x" }}>
        <text x={150} y={96} textAnchor="middle" fill={D.danger} fontSize={10} fontWeight={700}>
          VOICE ✕
        </text>
      </SdTopo>
      <text x={320} y={250} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        Configured PacketVerse outcome: SLA-required Voice with no eligible path is not forwarded.
      </text>
    </DiagramSvg>
  );
}

function RepairDiagram() {
  return (
    <DiagramSvg h={260} label="After fixing the TUN-B probe target, valid replies return, TUN-B becomes eligible after three passing intervals and Voice flows on TUN-B while TUN-A is still degraded">
      <SdTopo a={{ mode: "fail", label: "TUN-A · still SLA-ineligible" }} b={{ mode: "flow", label: "VOICE + BULK · TUN-B eligible", color: D.success }} lan={{ left: "x", right: "x", color: D.cyan }} subs={{ HUB: "answers .0.1" }} />
      <text x={320} y={250} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        Target 10.255.0.1 → valid samples → 1/3, 2/3, 3/3 → eligible → Voice on TUN-B
      </text>
    </DiagramSvg>
  );
}

export function SdLessonGuideContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="sdl-mission" eyebrow="Mission" title="Good enough, not just up" tone="cyan">
        <p>BRANCH-EDGE has two ways to reach the hub. For each application it must pick a path that is not only working but good enough. That needs measurement, per-application policy, and care when things change. This lesson is the PacketVerse generic SD-WAN model — real products differ, and no SD-WAN wire format is invented.</p>
        <FlowSteps
          steps={[
            { title: "Measure", body: "Probe each path; turn samples into RTT, jitter, loss.", tone: "violet" },
            { title: "Qualify", body: "Compare with each application's SLA → eligible or not.", tone: "warning" },
            { title: "Steer", body: "Pick the preferred eligible path, per packet, locally.", tone: "success" },
            { title: "Stabilize", body: "Fail over fast, come back carefully.", tone: "ip" },
          ]}
        />
      </GuideSection>

      <GuideSection id="sdl-topology" eyebrow="Topology" title="Two underlays, two overlays" tone="cyan">
        <DiagramFrame caption="Transport below, logical paths above, applications on top.">
          <TopologyDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="sdl-probes" eyebrow="Measurement" title="The probe model" tone="violet">
        <DiagramFrame caption="Ordinary ICMP Echo — no SD-WAN header, no SLA fields in the packet.">
          <ProbeDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="sdl-healthy" eyebrow="Metrics" title="Healthy TUN-A and TUN-B" tone="success">
        <DiagramFrame caption="Measured value, threshold and result for every metric.">
          <HealthyDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="sdl-policy" eyebrow="Policy" title="Voice vs Bulk" tone="warning">
        <DiagramFrame caption="Two classes, two preferences.">
          <PolicyDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="sdl-steering" eyebrow="Steering" title="Two paths at once" tone="success">
        <DiagramFrame caption="Different classes, different selected paths.">
          <SteeringDiagram />
        </DiagramFrame>
        <Callout tone="cyan" title="Local decisions">
          A controller or orchestrator may distribute policy, configuration and topology. The per-packet decision is made on BRANCH-EDGE from installed policy and its own live measurements — no round-trip per packet.
        </Callout>
      </GuideSection>

      <GuideSection id="sdl-degrade" eyebrow="Degrade" title="TUN-A browns out" tone="danger">
        <DiagramFrame caption="All three Voice thresholds fail.">
          <DegradeDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="sdl-failover" eyebrow="Fail over" title="Voice moves to TUN-B" tone="warning">
        <DiagramFrame caption="The same UDP packet, a different path.">
          <FailoverDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="sdl-recover" eyebrow="Recover" title="Healthy 1/3, 2/3, 3/3" tone="success">
        <DiagramFrame caption="Hysteresis prevents flapping.">
          <RecoveryDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="sdl-monitor" eyebrow="Incident" title="A monitor pointed at nothing" tone="danger">
        <DiagramFrame caption="The path works; the measurement doesn't.">
          <MonitorDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="sdl-incident" eyebrow="Incident" title="Zero eligible paths for Voice" tone="danger">
        <DiagramFrame caption="Both circuits UP, both overlays reachable — and calls fail.">
          <IncidentDiagram />
        </DiagramFrame>
        <CompareCards
          items={[
            { title: "What looks broken", tone: "danger", tag: "symptom", points: ["Voice calls fail", "TUN-B: 0 probe replies", "TUN-A: SLA FAIL"] },
            { title: "What is actually wrong", tone: "success", tag: "cause", points: ["TUN-B probe target 10.255.0.99", "Hub loopback is 10.255.0.1", "Circuits, tunnels, DNS, APP all fine"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="sdl-repair" eyebrow="Repair" title="Fix the target, earn eligibility" tone="success">
        <DiagramFrame caption="Valid samples first, then the modeled 3-interval rule.">
          <RepairDiagram />
        </DiagramFrame>
        <ChecklistCard tone="success" title="Verified" mark="✓" items={["TUN-B probes answered by 10.255.0.1", "Three passing intervals → TUN-B eligible", "VOICE → TUN-B while TUN-A is still degraded", "Voice SLA thresholds unchanged"]} />
        <p>Raising the RTT threshold would hide TUN-A&apos;s poor quality and still leave TUN-B unmeasured; shutting ISP-A, changing DNS or clearing ARP do not touch the monitor.</p>
      </GuideSection>

      <GuideSection id="sdl-model" eyebrow="Mental model" title="A dispatcher with two roads" tone="violet">
        <p>The branch is a dispatcher with two roads to the same depot. Scouts drive each road constantly and report the travel time. Urgent parcels (Voice) only go on a road the scouts rate &quot;fast enough&quot;; ordinary parcels (Bulk) just need an open road. When a road gets slow, urgent parcels switch; when it clears, the dispatcher waits for three good reports before trusting it again. Send a scout to an address that doesn&apos;t exist and he never reports back — so that road is never rated, even though it&apos;s perfectly drivable.</p>
      </GuideSection>

      <GuideSection id="sdl-glossary" eyebrow="Glossary" title="Terms" tone="cyan">
        <Glossary
          items={[
            { term: "Underlay", def: "The transport circuits (ISP-A, ISP-B) the overlay runs across." },
            { term: "Overlay path", def: "A logical path (TUN-A, TUN-B) between SD-WAN edges." },
            { term: "SLA", def: "Per-application thresholds for RTT, jitter and loss." },
            { term: "SLA-eligible", def: "A path whose latest measurements pass the SLA (and has earned back trust)." },
            { term: "Hysteresis", def: "Requiring sustained good results before returning to a path." },
            { term: "Monitor target", def: "The address probes are sent to; it must answer on the path being measured." },
          ]}
        />
      </GuideSection>
    </div>
  );
}
