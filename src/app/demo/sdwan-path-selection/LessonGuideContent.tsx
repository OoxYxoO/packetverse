import { ChecklistCard, CompareCards, DIAGRAM as D, DiagramFrame, DiagramSvg, DPill, DArrow, FieldTable, FlowSteps, Glossary, GuideSection, Mono } from "@/components/lesson/GuideBlocks";
import { PresentationBridge } from "@/components/presentation/LessonPresentation";
import { PracticeBridge } from "@/components/lesson/GuideInteractive";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import { DTable } from "@/components/lesson/FundamentalsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { HYSTERESIS_INTERVALS, PROBES_PER_INTERVAL, SD, VOICE_SLA, probeSamples, slaChecks, summarize } from "@/lib/sim-engine/scenarios/sdwanPathSelection";
import { SdTopo } from "./guideSvg";
import { CliPanel, pickLines, runGuideCli } from "@/components/lesson/GuideCli";
import type { CliVendor } from "@/lib/cli/types";
import { createSdNet, sdApply, sdClone, type SdClass, type SdNet } from "@/lib/sim-engine/scenarios/sdNet";
import { sdEdgeSets, type SdCliApi } from "./sdwan-lab/sdCli";

export const SD_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "sdl-mission", label: "What this lesson teaches" },
  { id: "sdl-network", label: "The network of this lesson" },
  { id: "sdl-ideas", label: "Three ideas you need" },
  { id: "sdl-walk", label: "What you will watch" },
  { id: "sdl-problem", label: "Up is not good enough" },
  { id: "sdl-probes", label: "Measuring both tunnels" },
  { id: "sdl-sla", label: "Good enough for voice?" },
  { id: "sdl-policy", label: "Two applications, two paths" },
  { id: "sdl-brownout", label: "ISP-A browns out" },
  { id: "sdl-recover", label: "Coming back carefully" },
  { id: "sdl-verify", label: "What a healthy branch looks like" },
  { id: "sdl-incident", label: "The incident" },
  { id: "sdl-investigate", label: "Check each layer on its own" },
  { id: "sdl-repair", label: "Repair and prove it" },
  { id: "sdl-other", label: "Other ways path selection breaks" },
  { id: "sdl-model", label: "Mental model" },
  { id: "sdl-glossary", label: "Glossary" },
  { id: "sdl-recap", label: "Recap" },
  { id: "sdl-practice", label: "Practice it" },
];


const healthyA = summarize(1, SD.hubLo, probeSamples("TUN-A", "healthy", SD.hubLo));
const healthyB = summarize(1, SD.hubLo, probeSamples("TUN-B", "healthy", SD.hubLo));
const badA = summarize(2, SD.hubLo, probeSamples("TUN-A", "degraded", SD.hubLo));
const rowsFor = (m: typeof healthyA) => slaChecks(m).map((c) => [c.metric, c.value, c.threshold, c.pass ? "PASS" : "FAIL"]);

export function TopologyDiagram() {
  return (
    <DiagramSvg h={260} label="Underlay circuits through ISP-A and ISP-B, and the two overlay paths TUN-A and TUN-B between BRANCH-EDGE and HUB-EDGE">
      <SdTopo a={{ label: "TUN-A overlay (over ISP-A)", color: D.cyan }} b={{ label: "TUN-B overlay (over ISP-B)", color: D.violet }} subs={{ C: SD.client, APP: SD.app, HUB: "lo .0.1" }} />
      <text x={320} y={252} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        Solid lines = underlay circuits · dashed curves = overlay paths (encapsulation vendor-specific, not drawn)
      </text>
    </DiagramSvg>
  );
}

export function ProbeDiagram() {
  return (
    <DiagramSvg h={260} label="ICMP Echo probes from 10.255.1.1 to 10.255.0.1 on each path; 500 per interval become RTT, jitter and loss">
      <SdTopo a={{ mode: "probe", label: "Echo → 10.255.0.1 on TUN-A" }} b={{ mode: "probe", label: "Echo → 10.255.0.1 on TUN-B" }} subs={{ BR: "lo .1.1", HUB: "lo .0.1" }} />
      <text x={320} y={250} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        {`PacketVerse SLA measurement model: ${PROBES_PER_INTERVAL} ordinary ICMP probes per path per interval (not mandatory in real products)`}
      </text>
    </DiagramSvg>
  );
}

export function HealthyDiagram() {
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

export function PolicyDiagram() {
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

export function SteeringDiagram() {
  return (
    <DiagramSvg h={260} label="Voice on TUN-A and Bulk on TUN-B at the same time">
      <SdTopo a={{ mode: "flow", label: "VOICE (UDP, EF) on TUN-A", color: D.warning }} b={{ mode: "flow", label: "BULK (TCP 873) on TUN-B", color: D.success }} lan={{ left: "x", right: "x", color: D.cyan }} />
      <text x={320} y={250} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        Application-policy steering — not ECMP. Each class follows its own preference.
      </text>
    </DiagramSvg>
  );
}

export function DegradeDiagram() {
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

export function FailoverDiagram() {
  return (
    <DiagramSvg h={260} label="Voice moves to TUN-B; Bulk stays on TUN-B; TUN-A stays reachable but ineligible">
      <SdTopo a={{ mode: "fail", label: "TUN-A · reachable, SLA-ineligible" }} b={{ mode: "flow", label: "VOICE + BULK on TUN-B", color: D.success }} lan={{ left: "x", right: "x", color: D.cyan }} />
      <text x={320} y={250} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        Decided locally by BRANCH-EDGE: VOICE needs an eligible path; TUN-B is the only one.
      </text>
    </DiagramSvg>
  );
}

export function RecoveryDiagram() {
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

export function MonitorDiagram() {
  return (
    <DiagramSvg h={260} label="TUN-B probes go to 10.255.0.99, which nothing at the hub owns; no replies, so TUN-B has no valid SLA result even though ISP-B and TUN-B work">
      <SdTopo a={{ label: "TUN-A · probes to 10.255.0.1 answered" }} b={{ mode: "probe", label: "Echo → 10.255.0.99 · no reply", color: D.danger, mark: "hub" }} subs={{ HUB: "lo .0.1 only" }} />
      <text x={320} y={250} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        ISP-B UP · TUN-B reachable (Bulk still uses it) · monitor: 0 valid replies → no SLA result
      </text>
    </DiagramSvg>
  );
}

export function IncidentDiagram() {
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

export function RepairDiagram() {
  return (
    <DiagramSvg h={260} label="After fixing the TUN-B probe target, valid replies return, TUN-B becomes eligible after three passing intervals and Voice flows on TUN-B while TUN-A is still degraded">
      <SdTopo a={{ mode: "fail", label: "TUN-A · still SLA-ineligible" }} b={{ mode: "flow", label: "VOICE + BULK · TUN-B eligible", color: D.success }} lan={{ left: "x", right: "x", color: D.cyan }} subs={{ HUB: "answers .0.1" }} />
      <text x={320} y={250} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        Target 10.255.0.1 → valid samples → 1/3, 2/3, 3/3 → eligible → Voice on TUN-B
      </text>
    </DiagramSvg>
  );
}

function LessonLabBridge() {
  const openLab = usePracticeLabOpener();
  return (
    <PracticeBridge label="Open the SD-WAN Lab" onPractice={openLab}>
      Same branch and tunnels, your own copy. Nothing you do there changes your lesson progress.
    </PracticeBridge>
  );
}

/** The lab's own command sets, run against a lab state: what this page shows is what the SD-WAN Lab prints. */
function lessonCli(s: SdNet, vendor: CliVendor, command: string) {
  const api: SdCliApi = { view: s, act: () => s, edge: { kind: "exec" }, setEdge: () => undefined, junosEdit: false, setJunosEdit: () => undefined, ctrlEdit: false, setCtrlEdit: () => undefined, cand: sdClone(s.cfg), setCand: () => undefined };
  return runGuideCli(sdEdgeSets(api)[vendor]!, command);
}
const HEALTHY = [{ type: "measure" } as const, { type: "traffic" as const, kinds: ["VOICE", "BULK"] as SdClass[] }].reduce((acc, a) => sdApply(acc, a), createSdNet());

// Every metric shown below is computed from the scenario's own sample model.
export function SdLessonGuideContent() {
  const rpm = lessonCli(HEALTHY, "juniper", "show services rpm probe-results");
  const apbr = lessonCli(HEALTHY, "juniper", "show security advance-policy-based-routing");
  return (
    <div className="space-y-12">
      <GuideSection id="sdl-mission" eyebrow="This lesson" title="What this lesson teaches" tone="cyan">
        <p>
          A branch edge has two ways to reach the hub: a tunnel over ISP-A and a tunnel over ISP-B. Voice calls need a path that is not only up but good enough; the backup only needs a path. This lesson shows how <strong>SD-WAN path selection</strong> measures both paths, qualifies them per application, and moves voice when a path degrades.
        </p>
        <p>You will watch probes turn into RTT, jitter and loss, voice and the backup take different tunnels, a brownout move voice to the other tunnel, and a careful return. Then calls fail although both circuits are up, and you find out why, fix it, and prove it.</p>
        <ChecklistCard
          tone="cyan"
          title="By the end of this lesson you can"
          mark="→"
          items={[
            "read TUN-A's and TUN-B's measurements against the voice SLA",
            "explain why voice and the backup use different tunnels",
            "predict where voice goes when ISP-A browns out, and when it comes back",
            "tell reachable from eligible",
            "find why voice has no eligible path in the incident, repair it without touching the SLA, and prove it",
          ]}
        />
      </GuideSection>

      <GuideSection id="sdl-network" eyebrow="This lesson" title="The network of this lesson" tone="cyan">
        <DiagramFrame caption="Transport below, logical paths above, applications on top.">
          <TopologyDiagram />
        </DiagramFrame>
        <FieldTable
          title="Two paths, two applications"
          columns={["", "TUN-A", "TUN-B"]}
          rows={[
            ["Underlay", "ISP-A (business line)", "ISP-B (public, cheaper)"],
            ["Healthy measurements", `${healthyA.rtt} ms · ${healthyA.jitter} ms · ${healthyA.loss}%`, `${healthyB.rtt} ms · ${healthyB.jitter} ms · ${healthyB.loss}%`],
            ["Voice (SLA required)", "first choice", "second choice"],
            ["Bulk backup (no SLA)", "second choice", "first choice"],
          ]}
        />
        <p className="text-sm text-pv-text-muted">Probes go to the hub&apos;s loopback, {SD.hubLo}. The voice SLA is {VOICE_SLA.rtt} ms latency, {VOICE_SLA.jitter} ms jitter and {VOICE_SLA.loss} % loss. The SD-WAN Lab uses the same tunnels and numbers, calls the routers BRANCH and HUB, and runs BRANCH as a Cisco Catalyst SD-WAN edge with its controller or as a Junos SRX.</p>
      </GuideSection>

      <GuideSection id="sdl-ideas" eyebrow="This lesson" title="Three ideas you need" tone="cyan">
        <FlowSteps
          steps={[
            { title: "Measure every path", body: "Every interval the edge probes both tunnels and computes RTT, jitter and loss.", tone: "violet" },
            { title: "Reachable is not eligible", body: "A path is eligible for voice only if it passes every voice threshold. A brownout is reachable but not eligible.", tone: "warning" },
            { title: "Fail over fast, come back carefully", body: "Voice leaves a failing path at the next interval, and returns only after several good intervals.", tone: "success" },
          ]}
        />
      </GuideSection>

      <GuideSection id="sdl-walk" eyebrow="This lesson" title="What you will watch, step by step" tone="warning">
        <FlowSteps
          steps={[
            { title: "Probes", body: "Both tunnels are probed; both pass the voice SLA.", tone: "violet" },
            { title: "Two paths at once", body: "Voice on TUN-A, the backup on TUN-B, at the same moment.", tone: "success" },
            { title: "TUN-A browns out", body: `${badA.rtt} ms, ${badA.jitter} ms jitter, ${badA.loss}% loss: all three voice thresholds fail.`, tone: "danger" },
            { title: "Voice fails over", body: "The same call now leaves on TUN-B; the backup doesn't care.", tone: "warning" },
            { title: "Recovery", body: `TUN-A must pass ${HYSTERESIS_INTERVALS} intervals in a row before voice returns.`, tone: "ip" },
            { title: "The incident", body: "Calls fail while both circuits are up. You find the cause and fix it.", tone: "cyan" },
          ]}
        />
        <p className="text-sm text-pv-text-muted">The sections below walk through each step on this branch, in the same order.</p>
      </GuideSection>

      <GuideSection id="sdl-problem" eyebrow="The problem" title="Up is not good enough" tone="danger">
        <p>A router chooses a path by reachability and cost: as long as ISP-A is up, it keeps using it. But a circuit can be up and still be bad. In an evening brownout ISP-A delivers {badA.rtt} ms and {badA.loss}% loss; routing sees nothing wrong, and every call on it is choppy. SD-WAN path selection measures how good each path is, decides per application which paths qualify, and moves traffic when that changes.</p>
      </GuideSection>

      <GuideSection id="sdl-probes" eyebrow="Measurement" title="Measuring both tunnels" tone="violet">
        <p>Every interval the edge sends {PROBES_PER_INTERVAL} probes over each tunnel to the hub&apos;s loopback, {SD.hubLo}, and averages them into RTT, jitter and loss. The probe target must answer on the path being measured: keep that in mind, it is the key to the incident.</p>
        <DiagramFrame caption="Ordinary ICMP Echo — no SD-WAN header, no SLA fields in the packet.">
          <ProbeDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="sdl-sla" eyebrow="SLA" title="Good enough for voice?" tone="warning">
        <p>The voice SLA class says what voice tolerates: {VOICE_SLA.rtt} ms latency, {VOICE_SLA.jitter} ms jitter, {VOICE_SLA.loss} % loss. A path whose latest measurements pass every threshold is <strong>SLA-eligible</strong> for voice. Healthy, both tunnels pass.</p>
        <DiagramFrame caption="Measured value, threshold and result for every metric.">
          <HealthyDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="sdl-policy" eyebrow="Policy" title="Two applications, two paths" tone="success">
        <p>The policy says, per application, whether an SLA is required and which paths it prefers. Voice requires the SLA and prefers TUN-A; the backup needs no SLA and prefers TUN-B. So at the same moment a call leaves on TUN-A and the backup on TUN-B. The decision is made locally on the branch edge, for every packet.</p>
        <DiagramFrame caption="Two classes, two preferences.">
          <PolicyDiagram />
        </DiagramFrame>
        <DiagramFrame caption="Different classes, different selected paths.">
          <SteeringDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="sdl-brownout" eyebrow="Failover" title="ISP-A browns out" tone="danger">
        <p>When the interval closes, TUN-A measures {badA.rtt} ms, {badA.jitter} ms jitter and {badA.loss}% loss: all three voice thresholds fail. TUN-A is still reachable, so the backup could use it, but it is no longer eligible for voice. The next call is the same packet on a different path: TUN-B.</p>
        <DiagramFrame caption="All three Voice thresholds fail.">
          <DegradeDiagram />
        </DiagramFrame>
        <DiagramFrame caption="The same UDP packet, a different path.">
          <FailoverDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="sdl-recover" eyebrow="Recovery" title="Coming back carefully" tone="success">
        <p>When ISP-A is healthy again, TUN-A must pass {HYSTERESIS_INTERVALS} intervals in a row before voice returns. Coming back at the first good sample would make calls flap between paths every time a circuit hiccups.</p>
        <DiagramFrame caption="Hysteresis prevents flapping.">
          <RecoveryDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="sdl-verify" eyebrow="Verification" title="What a healthy branch looks like on the edge" tone="success">
        <p>Check in the order the edge decides: measurements, then eligibility, then the path used.</p>
        <FieldTable
          title="Read the lesson on the edge"
          columns={["Question", "Cisco Catalyst SD-WAN", "Junos SRX", "What the answer proves"]}
          rows={[
            ["What did the edge measure?", <Mono key="1">show sdwan app-route stats</Mono>, <Mono key="2">show services rpm probe-results</Mono>, "Probes answered on both tunnels, with real numbers"],
            ["Which paths are eligible for voice?", <Mono key="3">show sdwan app-route sla-class</Mono>, <Mono key="4">show security advance-policy-based-routing</Mono>, "compliant / sla-class-index 1"],
            ["Which path did each application use?", <Mono key="5">show sdwan policy app-route-policy-filter</Mono>, <Mono key="6">show security advance-policy-based-routing</Mono>, "Voice on TUN-A, the backup on TUN-B"],
          ]}
        />
        <p>On a healthy Junos edge both tunnels answer every probe interval to {SD.hubLo}, both are compliant, and voice and the backup use different tunnels:</p>
        <CliPanel run={{ ...rpm, output: pickLines(rpm.output, /Owner|Target address|Probes sent|Average/) }} caption="BRANCH · Junos · healthy" />
        <CliPanel run={apbr} caption="BRANCH · Junos · healthy" />
      </GuideSection>

      <GuideSection id="sdl-incident" eyebrow="Incident" title="The incident: zero eligible paths for voice" tone="danger">
        <p>During a monitoring clean-up someone edited TUN-B&apos;s probe target. Later, while ISP-A is browned out, voice calls fail, although both circuits are up and both tunnels carry traffic. The backup still works.</p>
        <DiagramFrame caption="Both circuits UP, both overlays reachable — and calls fail.">
          <IncidentDiagram />
        </DiagramFrame>
        <CompareCards
          items={[
            { title: "Why it fails", tone: "danger", tag: "cause", points: [`TUN-B's probes go to ${SD.badTarget}, an address nobody owns at the hub`, "TUN-B gets zero replies, so it never has a valid SLA result and is never eligible", "TUN-A is browned out, so voice has zero eligible paths and is dropped by the configured policy"] },
            { title: "What it can't be", tone: "warning", tag: "red herrings", points: ["ISP-B or TUN-B being down: the backup still uses TUN-B", "A too-strict SLA: TUN-B was never measured at all", "DNS or the application: nothing reaches the SLA decision"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="sdl-investigate" eyebrow="Investigation" title="Check each layer on its own" tone="danger">
        <p>Separate the roads, the routes, the reporters and the rules:</p>
        <FieldTable
          title="Layer by layer, during the incident"
          columns={["Layer", "Question", "What you find"]}
          rows={[
            ["Underlay", "Are the circuits up?", "ISP-A up · ISP-B up"],
            ["Overlay", "Are the tunnels reachable?", "TUN-A and TUN-B carry traffic (the backup works)"],
            ["Monitor", "Are probes answered, by the right target?", `TUN-B: 0 replies · target ${SD.badTarget}, not ${SD.hubLo}`],
            ["SLA", "Measured vs threshold?", `TUN-A ${badA.rtt} ms / ${badA.jitter} ms / ${badA.loss}% FAIL · TUN-B no result`],
            ["Policy", "Which paths are eligible; what happens with none?", "Voice: none → dropped, as configured"],
          ]}
        />
        <DiagramFrame caption="The path works; the measurement doesn't.">
          <MonitorDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="sdl-repair" eyebrow="Repair" title="Repair the measurement, then let TUN-B earn its place" tone="success">
        <p>Point TUN-B&apos;s probes back at the hub&apos;s loopback, {SD.hubLo}. On a Junos SRX that is the RPM test&apos;s target address (<Mono>set services rpm probe probe-b test tun-b target address {SD.hubLo}</Mono>); the guided lesson repairs it in its own model, and the lab does not simulate this fault. Leave the voice SLA alone: raising the thresholds would hide TUN-A&apos;s poor quality and still leave TUN-B unmeasured.</p>
        <DiagramFrame caption="Valid samples first, then the modeled 3-interval rule.">
          <RepairDiagram />
        </DiagramFrame>
        <ChecklistCard
          tone="success"
          title="The proof"
          mark="✓"
          items={[
            `TUN-B's probes are answered by ${SD.hubLo}`,
            `After ${HYSTERESIS_INTERVALS} passing intervals TUN-B is eligible for voice`,
            "A fresh call leaves on TUN-B while TUN-A is still browned out",
            "The voice SLA thresholds are unchanged",
          ]}
        />
      </GuideSection>

      <GuideSection id="sdl-other" eyebrow="Troubleshooting" title="Other ways path selection breaks" tone="warning">
        <p>A probe target that doesn&apos;t answer breaks the measurement. The lab&apos;s five tickets break the policy instead, each with its own evidence. The Deep Dive walks through all six with real Cisco and Junos output.</p>
        <CompareCards
          items={[
            { title: "Voice prefers the wrong line", tone: "warning", tag: "wrong path", points: ["Both paths eligible, voice on ISP-B", "The preference order is reversed"] },
            { title: "No SLA, or a loose SLA", tone: "danger", tag: "choppy calls", points: ["Voice stays on a browned-out TUN-A", "The class is missing or lets 160 ms pass"] },
            { title: "Strict on a bad day", tone: "violet", tag: "silence", points: ["Both paths fail, voice is dropped", "Fallback-to-best-path would connect poor calls"] },
            { title: "The backup allowed only one path", tone: "ip", tag: "backup fails", points: ["ISP-B down, ISP-A up, the backup dropped", "Its preference list has only TUN-B"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="sdl-model" eyebrow="Mental model" title="A dispatcher with two roads" tone="violet">
        <p>The branch is a dispatcher with two roads to the same depot. Scouts drive each road constantly and report the travel time. Urgent parcels (voice) only go on a road the scouts rate &quot;fast enough&quot;; ordinary parcels (the backup) just need an open road. When a road gets slow, urgent parcels switch; when it clears, the dispatcher waits for three good reports before trusting it again. Send a scout to an address that doesn&apos;t exist and he never reports back — so that road is never rated, even though it&apos;s perfectly drivable.</p>
      </GuideSection>

      <GuideSection id="sdl-glossary" eyebrow="Glossary" title="Terms used in this lesson" tone="cyan">
        <Glossary
          items={[
            { term: "Underlay / overlay", def: "The ISP circuits / the tunnels (TUN-A, TUN-B) across them." },
            { term: "SLA", def: "Per-application thresholds for latency, jitter and loss." },
            { term: "SLA-eligible", def: "A path whose latest measurements pass the SLA (and has earned back trust)." },
            { term: "Hysteresis", def: "Requiring several good intervals before returning to a path." },
            { term: "Monitor target", def: "The address probes are sent to; it must answer on the path being measured." },
          ]}
        />
      </GuideSection>

      <GuideSection id="sdl-recap" eyebrow="Recap" title="What you can now explain" tone="success">
        <ChecklistCard tone="cyan" title="SD-WAN path selection in this lesson" mark="→" items={["Both tunnels are measured every interval", "Voice uses TUN-A, the backup TUN-B, at the same time", "A brownout is reachable but not eligible for voice", "Voice fails over at the next interval and returns after three good ones", "A path nobody measures is never eligible: check the probe target before the SLA"]} />
      </GuideSection>

      <GuideSection id="sdl-practice" eyebrow="Practice" title="Practice it" tone="cyan">
        <p>You now know what the edge should measure and choose, and how to prove it. The SD-WAN Lab gives you the branch, its two circuits and the hub, as Cisco Catalyst SD-WAN or a Junos SRX:</p>
        <FlowSteps
          steps={[
            { title: "Learn (6 levels)", body: "The same steps as this page, one decision at a time, plus what happens when no path is good.", tone: "violet" },
            { title: "Challenges", body: "Send a call and the backup on different tunnels, catch a brownout, fail voice over and back, survive a bad day.", tone: "warning" },
            { title: "Troubleshoot (5 tickets)", body: "The policy faults above (no SLA and a loose SLA are two separate tickets), reported as users report them.", tone: "danger" },
          ]}
        />
        <PresentationBridge>See probes, SLA classes, per-application steering, failover and hysteresis in the SD-WAN presentation.</PresentationBridge>
        <LessonLabBridge />
        <p className="text-sm text-pv-text-muted">For the full course (measurement windows, SLA classes, central policy and local decisions, real device output for every fault, a knowledge check), open the Deep Dive tab.</p>
      </GuideSection>
    </div>
  );
}
