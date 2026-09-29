import { Callout, CompareCards, DArrow, DIAGRAM as D, DiagramFrame, DiagramSvg, DLink, DNode, DPill, FieldTable, Glossary, GuideSection } from "@/components/lesson/GuideBlocks";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";

export const SD_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "sdd-layers", label: "Underlay, overlay, planes" },
  { id: "sdd-metrics", label: "RTT, jitter, loss" },
  { id: "sdd-windows", label: "Measurement windows" },
  { id: "sdd-brownout", label: "Brownout vs blackout" },
  { id: "sdd-control", label: "Controllers & local decisions" },
  { id: "sdd-steering", label: "Policy, steering, load sharing" },
  { id: "sdd-hysteresis", label: "Failover & hysteresis" },
  { id: "sdd-designs", label: "Hub-and-spoke, branch-to-branch, local breakout" },
  { id: "sdd-monitor", label: "Monitor design" },
  { id: "sdd-vendors", label: "Vendor differences" },
  { id: "sdd-verify", label: "Verification & troubleshooting" },
  { id: "sdd-model", label: "Mental model" },
  { id: "sdd-glossary", label: "Glossary" },
];

function LayersDiagram() {
  const band = (y: number, h: number, color: string, title: string, sub: string) => (
    <g>
      <rect x={30} y={y} width={580} height={h} rx={10} fill={color} fillOpacity={0.08} stroke={color} strokeOpacity={0.6} />
      <text x={46} y={y + 20} fill={color} fontSize={11} fontWeight={700}>
        {title}
      </text>
      <text x={46} y={y + 36} fill={D.muted} fontSize={9.5}>
        {sub}
      </text>
    </g>
  );
  return (
    <DiagramSvg h={230} label="Layers: application flows on top, overlay paths in the middle, underlay circuits at the bottom; control plane distributes policy, data plane forwards, measurement feeds path selection">
      {band(10, 50, D.success, "Application flows", "Voice, Bulk… classified on the edge — data plane")}
      {band(70, 50, D.cyan, "Overlay paths (TUN-A, TUN-B)", "Logical edge-to-edge paths; encapsulation varies by product (often IPsec)")}
      {band(130, 50, D.warning, "Underlay transport (ISP-A, ISP-B, MPLS, LTE…)", "Circuits and IP routing the overlay runs across")}
      <text x={320} y={206} textAnchor="middle" fill={D.text} fontSize={10}>
        Control plane: policy, keys and topology distribution · Measurement: telemetry feeding path choice
      </text>
      <text x={320} y={222} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        A fault can sit in any layer — and look like a fault in another.
      </text>
    </DiagramSvg>
  );
}

function MetricsDiagram() {
  const rtts = [24, 27, 23, 26, null, 25];
  return (
    <DiagramSvg h={200} label="RTT is the reply time per probe, jitter is the change between consecutive RTTs, loss is the share of probes with no reply">
      {rtts.map((r, i) => (
        <g key={i}>
          <rect x={60 + i * 90} y={r === null ? 40 : 110 - (r - 18) * 8} width={40} height={r === null ? 70 : (r - 18) * 8} rx={4} fill={r === null ? "none" : D.cyan} fillOpacity={0.3} stroke={r === null ? D.danger : D.cyan} strokeDasharray={r === null ? "4 3" : undefined} />
          <text x={80 + i * 90} y={126} textAnchor="middle" fill={r === null ? D.danger : D.text} fontSize={10} fontFamily="monospace">
            {r === null ? "lost" : `${r} ms`}
          </text>
        </g>
      ))}
      <text x={320} y={156} textAnchor="middle" fill={D.text} fontSize={10}>
        RTT = mean of answered probes · jitter = mean |RTTₙ − RTTₙ₋₁| over consecutive answers · loss = lost / sent
      </text>
      <text x={320} y={176} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        Real products define jitter and loss windows differently (e.g. RFC 3550-style smoothing). This lesson uses the simple means above.
      </text>
    </DiagramSvg>
  );
}

function WindowsDiagram() {
  return (
    <DiagramSvg h={160} label="Measurement windows: results are computed per interval; a longer window is steadier but reacts more slowly">
      {[0, 1, 2, 3, 4].map((i) => (
        <g key={i}>
          <rect x={40 + i * 116} y={30} width={108} height={34} rx={6} fill={D.violet} fillOpacity={0.12} stroke={D.violet} />
          <text x={94 + i * 116} y={52} textAnchor="middle" fill={D.text} fontSize={10}>
            {`interval ${i + 1}`}
          </text>
        </g>
      ))}
      <text x={320} y={92} textAnchor="middle" fill={D.text} fontSize={10}>
        Each interval: probes sent → samples → one RTT / jitter / loss result → SLA check
      </text>
      <text x={320} y={114} textAnchor="middle" fill={D.muted} fontSize={10}>
        Short windows detect trouble fast but are noisy (one bad second can fail a path).
      </text>
      <text x={320} y={132} textAnchor="middle" fill={D.muted} fontSize={10}>
        Long windows are stable but slow to notice a brownout. Loss needs enough probes to be meaningful.
      </text>
    </DiagramSvg>
  );
}

function BrownoutDiagram() {
  return (
    <DiagramSvg h={170} label="Blackout: the link or tunnel is down and liveness detection notices; brownout: it stays up but quality is too poor, and only measurement notices">
      <DNode x={160} y={40} label="Blackout" sub="circuit / tunnel DOWN" accent={D.danger} w={200} />
      <DNode x={480} y={40} label="Brownout" sub="UP, but slow / lossy" accent={D.warning} w={200} />
      <text x={160} y={96} textAnchor="middle" fill={D.text} fontSize={10}>
        Link state / tunnel liveness sees it
      </text>
      <text x={160} y={114} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        Every class must fail over
      </text>
      <text x={480} y={96} textAnchor="middle" fill={D.text} fontSize={10}>
        Only SLA measurement sees it
      </text>
      <text x={480} y={114} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        Sensitive classes move; tolerant ones may stay
      </text>
      <text x={320} y={156} textAnchor="middle" fill={D.faint} fontSize={9.5}>
        TUN-A at 160 / 40 / 2.0% was a brownout: reachable but SLA-ineligible.
      </text>
    </DiagramSvg>
  );
}

function ControlDiagram() {
  return (
    <DiagramSvg h={200} label="A controller or orchestrator distributes policy and topology to edges; each edge makes forwarding decisions locally">
      <DNode x={320} y={34} label="Controller / orchestrator" sub="policy · config · topology" accent={D.violet} w={220} />
      <DNode x={140} y={140} label="BRANCH-EDGE" sub="decides per packet" accent={D.cyan} w={150} />
      <DNode x={500} y={140} label="HUB-EDGE" sub="decides per packet" accent={D.cyan} w={150} />
      <DArrow x1={260} y1={56} x2={170} y2={116} color={D.violet} dashed />
      <DArrow x1={380} y1={56} x2={470} y2={116} color={D.violet} dashed />
      <text x={200} y={80} textAnchor="end" fill={D.violet} fontSize={10} fontWeight={700}>
        policy push
      </text>
      <text x={440} y={80} textAnchor="start" fill={D.violet} fontSize={10} fontWeight={700}>
        policy push
      </text>
      <DArrow x1={216} y1={140} x2={424} y2={140} color={D.success} both label="data: never via the controller" labelDy={-8} />
      <text x={320} y={190} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        If the controller is briefly unreachable, edges keep forwarding with the policy they already hold.
      </text>
    </DiagramSvg>
  );
}

function HysteresisDiagram() {
  const row = (y: number, label: string, marks: string[]) => (
    <g>
      <text x={20} y={y + 4} fill={D.text} fontSize={10} fontWeight={700}>
        {label}
      </text>
      {marks.map((m, i) => (
        <g key={i}>
          <rect x={170 + i * 56} y={y - 12} width={50} height={24} rx={5} fill={m === "A" ? D.cyan : D.violet} fillOpacity={0.2} stroke={m === "A" ? D.cyan : D.violet} />
          <text x={195 + i * 56} y={y + 4} textAnchor="middle" fill={D.text} fontSize={10} fontFamily="monospace">
            {m}
          </text>
        </g>
      ))}
    </g>
  );
  return (
    <DiagramSvg h={170} label="Without hysteresis Voice flaps between paths on every interval; with hysteresis it stays until the recovered path proves itself">
      <text x={170} y={24} fill={D.muted} fontSize={9}>
        Voice path per interval (path A quality: bad, good, bad, good, good, good, good)
      </text>
      {row(56, "No hysteresis", ["B", "A", "B", "A", "A", "A", "A"])}
      {row(100, "3-interval rule", ["B", "B", "B", "B", "B", "A", "A"])}
      <text x={320} y={148} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        Each switch can disturb a call. Dampening trades a slower return for stability (the lesson&apos;s 3 intervals is a model value).
      </text>
    </DiagramSvg>
  );
}

function DesignsDiagram() {
  return (
    <DiagramSvg h={220} label="Hub-and-spoke through a hub, branch-to-branch directly between edges, and local Internet breakout at the branch">
      <text x={110} y={20} textAnchor="middle" fill={D.cyan} fontSize={10.5} fontWeight={700}>
        Hub-and-spoke
      </text>
      <DNode x={110} y={60} label="HUB" accent={D.violet} w={60} h={30} />
      <DNode x={60} y={150} label="BR-1" accent={D.cyan} w={56} h={30} />
      <DNode x={160} y={150} label="BR-2" accent={D.cyan} w={56} h={30} />
      <DLink x1={70} y1={134} x2={100} y2={76} color={D.cyan} />
      <DLink x1={150} y1={134} x2={120} y2={76} color={D.cyan} />
      <line x1={220} y1={10} x2={220} y2={200} stroke={D.line} strokeDasharray="3 4" />
      <text x={320} y={20} textAnchor="middle" fill={D.success} fontSize={10.5} fontWeight={700}>
        Branch-to-branch
      </text>
      <DNode x={270} y={110} label="BR-1" accent={D.cyan} w={56} h={30} />
      <DNode x={370} y={110} label="BR-2" accent={D.cyan} w={56} h={30} />
      <DArrow x1={300} y1={110} x2={340} y2={110} color={D.success} both />
      <text x={320} y={160} textAnchor="middle" fill={D.muted} fontSize={9}>
        direct overlay, lower latency
      </text>
      <line x1={420} y1={10} x2={420} y2={200} stroke={D.line} strokeDasharray="3 4" />
      <text x={530} y={20} textAnchor="middle" fill={D.warning} fontSize={10.5} fontWeight={700}>
        Local breakout
      </text>
      <DNode x={480} y={110} label="BRANCH" accent={D.cyan} w={70} h={30} />
      <DNode x={590} y={60} label="SaaS / Internet" accent={D.warning} w={96} h={30} />
      <DNode x={590} y={160} label="HUB" accent={D.violet} w={60} h={30} />
      <DArrow x1={516} y1={100} x2={540} y2={70} color={D.warning} />
      <DArrow x1={516} y1={120} x2={558} y2={150} color={D.line} />
      <text x={320} y={206} textAnchor="middle" fill={D.faint} fontSize={9.5}>
        This lesson is hub-and-spoke: both overlay paths end at HUB-EDGE.
      </text>
    </DiagramSvg>
  );
}

function MonitorDiagram() {
  return (
    <DiagramSvg h={190} label="A good monitor target is a stable address on the far edge that answers on the same path; a wrong target produces no result, not a bad result">
      <DPill x={170} y={36} text="Good: far-edge loopback (10.255.0.1)" color={D.success} w={260} />
      <DPill x={170} y={72} text="answers on the path probed" color={D.success} w={260} />
      <DPill x={170} y={108} text="stable, monitored, documented" color={D.success} w={260} />
      <DPill x={480} y={36} text="Bad: a typo (10.255.0.99)" color={D.danger} w={260} />
      <DPill x={480} y={72} text="Bad: a host that may reboot" color={D.danger} w={260} />
      <DPill x={480} y={108} text="Bad: target reachable by another path" color={D.danger} w={260} />
      <text x={320} y={150} textAnchor="middle" fill={D.text} fontSize={10}>
        &quot;No valid result&quot; is not &quot;bad quality&quot; — but an SLA-required policy must treat both as ineligible.
      </text>
      <text x={320} y={170} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        Alert on monitors that get 0 replies while the tunnel itself is up.
      </text>
    </DiagramSvg>
  );
}

export function SdDeepDiveContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="sdd-layers" eyebrow="Architecture" title="Underlay, overlay and the planes" tone="cyan">
        <DiagramFrame caption="Three layers, three planes.">
          <LayersDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="sdd-metrics" eyebrow="SLA" title="RTT, jitter and loss" tone="violet">
        <DiagramFrame caption="Three numbers from one sample series.">
          <MetricsDiagram />
        </DiagramFrame>
        <p>An SLA is a set of thresholds per application class. Voice cares about all three: delay makes conversation awkward, jitter overflows playout buffers, loss creates gaps. Bulk transfers mostly care about loss and throughput.</p>
      </GuideSection>

      <GuideSection id="sdd-windows" eyebrow="Measurement" title="Probe windows and thresholds" tone="violet">
        <DiagramFrame caption="How much history each decision uses.">
          <WindowsDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="sdd-brownout" eyebrow="Failure types" title="Brownout vs blackout" tone="warning">
        <DiagramFrame caption="Only one of them changes link state.">
          <BrownoutDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="sdd-control" eyebrow="Control" title="Controllers and local decisions" tone="violet">
        <DiagramFrame caption="Policy distribution vs packet forwarding.">
          <ControlDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="sdd-steering" eyebrow="Policy" title="Application steering and load sharing" tone="success">
        <CompareCards
          items={[
            { title: "Policy steering (this lesson)", tone: "success", tag: "per class", points: ["Class → preference list", "SLA filters which paths may be used", "Different classes can use different paths"] },
            { title: "Per-flow load sharing", tone: "cyan", tag: "per flow", points: ["Flows hashed across eligible paths", "Keeps packets of a flow in order", "Adds capacity, not SLA awareness by itself"] },
            { title: "Per-packet spraying", tone: "warning", tag: "per packet", points: ["Packets alternate paths", "Reordering risk when paths differ", "Rare for real-time traffic"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="sdd-hysteresis" eyebrow="Stability" title="Failover and hysteresis" tone="warning">
        <DiagramFrame caption="Fail over quickly, fail back carefully.">
          <HysteresisDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="sdd-designs" eyebrow="Topologies" title="Hub-and-spoke, branch-to-branch, local breakout" tone="cyan">
        <DiagramFrame caption="Where the overlay paths go.">
          <DesignsDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="sdd-monitor" eyebrow="Design" title="Choosing monitor targets" tone="danger">
        <DiagramFrame caption="The measurement is only as good as what it measures.">
          <MonitorDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="sdd-vendors" eyebrow="Reality" title="Vendor differences" tone="violet">
        <Callout tone="warning" title="Generic model, not a product">
          SD-WAN products differ in overlay encapsulation (often IPsec, sometimes proprietary), measurement (built-in probes, BFD-style echoes, passive measurement of real traffic), SLA scoring (thresholds, scores, weighted metrics), what happens when no path qualifies (drop, best-effort fallback, alternate class), and default dampening. None of these are standardized across vendors. Check your platform&apos;s documentation.
        </Callout>
      </GuideSection>

      <GuideSection id="sdd-verify" eyebrow="Operations" title="Verification and troubleshooting" tone="success">
        <FieldTable
          title="Check each layer on its own"
          columns={["Layer", "Question", "In this lesson's incident"]}
          rows={[
            ["Underlay", "Are the circuits up?", "ISP-A UP · ISP-B UP"],
            ["Overlay", "Are the tunnels reachable?", "TUN-A and TUN-B reachable"],
            ["Monitor", "Are probes answered? Right target?", "TUN-B: 0 replies · target 10.255.0.99"],
            ["SLA", "Measured vs threshold per metric?", "TUN-A 160/40/2.0 FAIL · TUN-B no result"],
            ["Policy", "Which paths are eligible; what happens with none?", "Voice: none → drop (configured)"],
          ]}
        />
      </GuideSection>

      <GuideSection id="sdd-model" eyebrow="Mental model" title="Road reports" tone="violet">
        <p>Underlay is the road network, overlay the routes you drive, probes the traffic reports, SLAs the rules for which parcels may use which route, and hysteresis the patience to wait for several good reports before trusting a road again. When parcels stop moving, check the roads, the routes, the reporters and the rules — separately.</p>
      </GuideSection>

      <GuideSection id="sdd-glossary" eyebrow="Glossary" title="Terms" tone="cyan">
        <Glossary
          items={[
            { term: "Brownout", def: "Degraded but up — only measurement detects it." },
            { term: "Blackout", def: "Down — link state or liveness detects it." },
            { term: "Measurement window", def: "The set of samples one SLA decision is based on." },
            { term: "Local breakout", def: "Sending Internet/SaaS traffic directly from the branch instead of via the hub." },
            { term: "Dampening", def: "Delaying reuse of a recently failed path to avoid flapping." },
            { term: "Orchestrator / controller", def: "Central roles distributing policy, configuration and topology (vendor-specific)." },
          ]}
        />
      </GuideSection>
    </div>
  );
}
