import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DiagramFrame, DiagramSvg, DLink, DNode, DPill, FailureSignatures, FieldTable, FlowSteps, GuideSection, Misconceptions, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { ExplainIt, KnowledgeQuiz, PracticeBridge, type KnowledgeQuestion } from "@/components/lesson/GuideInteractive";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import { PresentationBridge } from "@/components/presentation/LessonPresentation";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { CliPair, CliPanel, FailureWalk, pickLines, runGuideCli } from "@/components/lesson/GuideCli";
import type { CliVendor } from "@/lib/cli/types";
import { createSdNet, sdApply, sdClone, sdTicket, sdTicketState, type SdClass, type SdNet, type SdTicketId } from "@/lib/sim-engine/scenarios/sdNet";
import { sdCtrlSets, sdEdgeSets, type SdCliApi } from "./sdwan-lab/sdCli";
import { DegradeDiagram, FailoverDiagram, HealthyDiagram, IncidentDiagram, MonitorDiagram, PolicyDiagram, ProbeDiagram, RecoveryDiagram, RepairDiagram, SteeringDiagram, TopologyDiagram } from "./LessonGuideContent";

/**
 * SD-WAN PATH SELECTION DEEP DIVE — the complete study course, taught on the lesson's own branch with two tunnels to the
 * hub. Every CLI sample is produced by running the SD-WAN Lab's model and its real Cisco/Junos command sets.
 * Progression: Foundation → Measurement → The decision → Change → Operations → Troubleshooting → Beyond → Master it.
 */

function cliApi(s: SdNet): SdCliApi {
  return { view: s, act: () => s, edge: { kind: "exec" }, setEdge: () => undefined, junosEdit: false, setJunosEdit: () => undefined, ctrlEdit: false, setCtrlEdit: () => undefined, cand: sdClone(s.cfg), setCand: () => undefined };
}
const edge = (s: SdNet, vendor: CliVendor, command: string) => runGuideCli(sdEdgeSets(cliApi(s))[vendor]!, command);
const ctrl = (s: SdNet, command: string) => runGuideCli(sdCtrlSets(cliApi(s)).cisco!, command);
/** A ticket's network after its test ran: the state the student investigates. */
const ticketState = (id: SdTicketId) => sdTicket(id).repro.reduce((acc, a) => sdApply(acc, a), sdTicketState(id, 1));
/** The healthy network after one measurement interval, a call and a backup. */
const WARM = [{ type: "measure" } as const, { type: "traffic" as const, kinds: ["VOICE", "BULK"] as SdClass[] }].reduce((acc, a) => sdApply(acc, a), createSdNet());
const pick = (run: ReturnType<typeof edge>, re: RegExp) => ({ ...run, output: pickLines(run.output, re) });

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

function MonitorDesignDiagram() {
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

/** What a healthy branch looks like, read from the edge (and the controller) — the state every later section refers to. */
function NormalState() {
  return (
    <div className="space-y-5">
      <p>
        Before anything breaks, learn what a healthy branch looks like. This is the lab&apos;s network after one measurement interval, with a call and a backup sent at the same moment. Below are the verification questions, asked on the real BRANCH edge, with the state described above in the answers. Every output is what the SD-WAN Lab prints (shortened to the lines that matter), and in the faults below you will compare broken output with it.
      </p>
      <div className="space-y-2">
        <h4 className="text-sm font-bold text-pv-text">1 · Are both tunnels up?</h4>
        <CliPanel run={edge(WARM, "cisco", "show sdwan bfd sessions")} caption="BRANCH · Cisco Catalyst SD-WAN" />
        <p className="text-sm text-pv-text-muted">
          One session to the hub (system IP 10.255.0.1) per color: <Mono>biz-internet</Mono> is TUN-A over ISP-A, <Mono>public-internet</Mono> is TUN-B over ISP-B. Both are <Mono>up</Mono>. Up only means reachable; it says nothing about quality yet. On Junos the same fact shows as probe replies on both tunnels (question 2).
        </p>
      </div>
      <div className="space-y-2">
        <h4 className="text-sm font-bold text-pv-text">2 · What did the edge measure on each path?</h4>
        <CliPair cisco={pick(edge(WARM, "cisco", "show sdwan app-route stats"), /app-route statistics|local-color|mean-|sla-class-index|eligible/)} junos={pick(edge(WARM, "juniper", "show services rpm probe-results"), /Owner|Destination interface|Probes sent|Average/)} ciscoCaption="BRANCH · Cisco" junosCaption="BRANCH · Junos" />
        <p className="text-sm text-pv-text-muted">
          500 probes per interval to the hub: TUN-A 25 ms, 3 ms jitter, 0.2 % loss; TUN-B 55 ms, 8 ms, 0.4 %. Junos shows time in microseconds (25000 usec = 25 ms). Cisco&apos;s <Mono>sla-class-index 0,1</Mono> means the tunnel meets class 0 (ANY-PATH) and class 1 (VOICE).
        </p>
      </div>
      <div className="space-y-2">
        <h4 className="text-sm font-bold text-pv-text">3 · Which paths are eligible for voice, and against what?</h4>
        <CliPair cisco={edge(WARM, "cisco", "show sdwan app-route sla-class")} junos={edge(WARM, "juniper", "show security advance-policy-based-routing")} ciscoCaption="BRANCH · Cisco" junosCaption="BRANCH · Junos" />
        <p className="text-sm text-pv-text-muted">
          The VOICE class tolerates 100 ms latency, 30 ms jitter and 1 % loss. Both tunnels are inside it, so both are eligible (Junos: <Mono>compliant</Mono>). Voice takes the first eligible path in its preference, TUN-A (<Mono>st0.1</Mono>); the backup needs no SLA and prefers TUN-B (<Mono>st0.2</Mono>).
        </p>
      </div>
      <div className="space-y-2">
        <h4 className="text-sm font-bold text-pv-text">4 · Which path did each application really use?</h4>
        <CliPair cisco={edge(WARM, "cisco", "show sdwan policy app-route-policy-filter")} junos={edge(WARM, "juniper", "show route table RI-VOICE.inet.0")} ciscoCaption="BRANCH · Cisco" junosCaption="BRANCH · Junos" />
        <p className="text-sm text-pv-text-muted">
          Cisco counts packets per policy sequence and color: sequence 10 (voice) on biz-internet, sequence 20 (backup) on public-internet, nothing dropped. Junos steers voice through the routing instance RI-VOICE, where TUN-A has the better preference (5) and TUN-B is the second choice (10).
        </p>
      </div>
      <Callout tone="success" title="And the traffic proves it" icon="✓">
        The call leaves on TUN-A and the backup on TUN-B at the same moment: two applications, two paths, each the one its policy prefers.
      </Callout>
    </div>
  );
}

/** The five faults the lab can break, each walked from normal state through evidence and repair to proof — plus the guided lesson's incident. */
function FaultWalks() {
  const pref = ticketState("pref");
  const slaoff = ticketState("slaoff");
  const loose = ticketState("loose");
  const bulk = ticketState("bulkpref");
  const fb = ticketState("fallback");
  const stats = /app-route statistics|local-color|mean-|sla-class-index|eligible/;
  return (
    <div className="space-y-4">
      <p>The first five are the faults of the lab&apos;s tickets. Each one starts from the healthy evidence above and changes one thing. Read the evidence first and compare it with the healthy output, because the difference is the clue. Walk the chain every time: measurements → SLA class → policy → path. Then see how the investigation questions lead to the cause, how to repair it on both vendors, and what proves the repair. The sixth is the incident of the guided lesson.</p>
      <p className="text-sm text-pv-text-muted">On Cisco Catalyst SD-WAN the policy is centralized: you change it on the controller (vSmart) and it is pushed to the edge. On Junos you change it on BRANCH itself.</p>
      <FailureWalk
        title="1 · Voice prefers the wrong line"
        normal={<>Voice prefers TUN-A (ISP-A, the business line) and only uses TUN-B if TUN-A is not eligible.</>}
        change={<>The voice preference is reversed: TUN-B first, TUN-A second.</>}
        evidence={
          <>
            <p>Both ISPs are healthy, and every call runs over ISP-B, the metered line. Both paths are compliant, yet voice&apos;s active path is TUN-B:</p>
            <CliPanel run={edge(pref, "juniper", "show security advance-policy-based-routing")} />
            <CliPanel run={edge(pref, "cisco", "show sdwan policy app-route-policy-filter")} note={<>Sequence 10 (voice) counted on public-internet, not biz-internet.</>} />
          </>
        }
        next={<>Both paths eligible, voice on the second-choice line: nothing in the network is wrong, the order is. Read the preference: controller <Mono>show running-config policy</Mono> (VOICE-PREF) · Junos <Mono>show route table RI-VOICE.inet.0</Mono>.</>}
        fix={<>Cisco, on the controller: <Mono>config</Mono>, <Mono>policy preferred-color-group VOICE-PREF primary-preference color-preference biz-internet</Mono>, <Mono>commit</Mono> · Junos: <Mono>set routing-instances RI-VOICE routing-options static route 10.40.40.0/24 qualified-next-hop st0.1 preference 5</Mono>, the same for <Mono>st0.2</Mono> with <Mono>preference 10</Mono>, then <Mono>commit</Mono>.</>}
        proof={<>Measure an interval, place a call: it leaves on TUN-A, and the counter for sequence 10 on biz-internet goes up. Backups still prefer TUN-B.</>}
      />
      <FailureWalk
        title="2 · Voice doesn't require an SLA"
        normal={<>Voice only uses SLA-eligible paths, so a browned-out TUN-A is removed from its paths.</>}
        change={<>The voice rule loses its SLA requirement: like the backup, voice now takes the first <em>reachable</em> path.</>}
        evidence={
          <>
            <p>ISP-A browns out and calls stay on it, choppy, although ISP-B is fine. The edge measured the brownout correctly and TUN-A fails the class, but the voice rule doesn&apos;t look at it:</p>
            <CliPanel run={pick(edge(slaoff, "cisco", "show sdwan app-route stats"), stats)} />
            <CliPanel run={edge(slaoff, "juniper", "show security advance-policy-based-routing")} note={<>&quot;(no SLA rule)&quot; on the VOICE rule: st0.1 is violated and still active for voice.</>} />
          </>
        }
        next={<>The measurements are right (TUN-A fails) and voice still uses TUN-A: the policy isn&apos;t applying the class. Check the voice rule: <Mono>sla-class ANY-PATH</Mono> on the controller · no <Mono>sla-rule</Mono> on the Junos VOICE rule.</>}
        fix={<>Cisco, on the controller: <Mono>config</Mono>, <Mono>policy app-route-policy APP-RT vpn-list CORP sequence 10 action sla-class VOICE fallback-to-best-path</Mono>, <Mono>commit</Mono> · Junos: <Mono>set security advance-policy-based-routing profile SDWAN rule VOICE then sla-rule VOICE-SLA</Mono>, then <Mono>commit</Mono>.</>}
        proof={<>With ISP-A still browned out, measure an interval and place a call: it leaves on TUN-B, a clean path.</>}
      />
      <FailureWalk
        title="3 · The SLA class is too loose to catch a brownout"
        normal={<>The VOICE class allows 100 ms, 30 ms jitter and 1 % loss: what voice really tolerates.</>}
        change={<>Someone &quot;tuned&quot; the class to stop the alarms: 250 ms, 60 ms and 3 %.</>}
        evidence={
          <>
            <p>The SLA policy is on, and calls are still choppy during ISP-A&apos;s brownout. TUN-A measures 160 ms, 40 ms jitter and 2 % loss, and is still eligible for voice:</p>
            <CliPanel run={pick(edge(loose, "cisco", "show sdwan app-route stats"), stats)} />
            <CliPanel run={edge(loose, "cisco", "show sdwan app-route sla-class")} />
          </>
        }
        next={<>A brownout that passes the class means the class is wrong, not the measurement. Compare the thresholds with what voice tolerates (≈100 ms / 30 ms / 1 %): <Mono>show sdwan app-route sla-class</Mono> · <Mono>show configuration security advance-policy-based-routing</Mono> (metrics-profile, in microseconds).</>}
        fix={<>Cisco, on the controller: <Mono>config</Mono>, <Mono>policy sla-class VOICE latency 100</Mono>, <Mono>policy sla-class VOICE jitter 30</Mono>, <Mono>policy sla-class VOICE loss 1</Mono>, <Mono>commit</Mono> · Junos: <Mono>set security advance-policy-based-routing metrics-profile VOICE-SLA sla-threshold delay-round-trip 100000</Mono>, the same with <Mono>jitter 30000</Mono> and <Mono>packet-loss 1</Mono>, then <Mono>commit</Mono>.</>}
        proof={<>TUN-A fails the class at once (sla-class-index 0 only), and a fresh call during the brownout leaves on TUN-B.</>}
      />
      <FailureWalk
        title="4 · The backup may only use one path"
        normal={<>The backup needs no SLA and may use both tunnels: TUN-B first, then TUN-A.</>}
        change={<>TUN-A is removed from the backup&apos;s paths: TUN-B is the only one allowed.</>}
        evidence={
          <>
            <p>ISP-B is down for maintenance, ISP-A is up the whole time, and the nightly backup fails. The backup has nowhere to go:</p>
            <CliPanel run={edge(bulk, "cisco", "show sdwan bfd sessions")} />
            <CliPanel run={edge(bulk, "cisco", "show sdwan policy app-route-policy-filter")} note={<>seq20-dropped: the backup was dropped at the branch.</>} />
            <CliPanel run={edge(bulk, "juniper", "show route table RI-BULK.inet.0")} note={<>RI-BULK has no route at all: its only next hop, st0.2, is down.</>} />
          </>
        }
        next={<>One circuit down, the other up, and an application dropped: look at which paths that application may use. Controller <Mono>show running-config policy</Mono> (BULK-PREF has no secondary preference) · Junos <Mono>show configuration routing-instances</Mono>.</>}
        fix={<>Cisco, on the controller: <Mono>config</Mono>, <Mono>policy preferred-color-group BULK-PREF secondary-preference color-preference biz-internet</Mono>, <Mono>commit</Mono> · Junos: <Mono>set routing-instances RI-BULK routing-options static route 10.40.40.0/24 qualified-next-hop st0.1 preference 10</Mono>, then <Mono>commit</Mono>.</>}
        proof={<>With ISP-B still down, measure and run the backup: it leaves on TUN-A. When ISP-B returns, it goes back to TUN-B.</>}
      />
      <FailureWalk
        title="5 · Strict voice on a bad day"
        normal={<>When no path meets the voice SLA, voice falls back to the best reachable path: poor calls, but calls.</>}
        change={<>The voice rule is made strict: with no compliant path, voice is dropped.</>}
        evidence={
          <>
            <p>Both ISPs brown out and not a single call connects. Both paths are violated and voice has no active path:</p>
            <CliPanel run={edge(fb, "juniper", "show security advance-policy-based-routing")} />
            <CliPanel run={pick(ctrl(fb, "show running-config policy"), /sequence 10|sla-class VOICE/)} note={<>On the controller: <Mono>sla-class VOICE strict</Mono>, where the design says fallback-to-best-path.</>} />
          </>
        }
        next={<>No path is good, and that part is real: both circuits are browned out. The question is what voice does then. Check the plan B: <Mono>strict</Mono> or <Mono>fallback-to-best-path</Mono> (Cisco) · <Mono>violation-action drop</Mono> or <Mono>best-path</Mono> (Junos).</>}
        fix={<>Cisco, on the controller: <Mono>config</Mono>, <Mono>policy app-route-policy APP-RT vpn-list CORP sequence 10 action sla-class VOICE fallback-to-best-path</Mono>, <Mono>commit</Mono> · Junos: <Mono>set security advance-policy-based-routing sla-rule VOICE-SLA violation-action best-path</Mono>, then <Mono>commit</Mono>.</>}
        proof={<>Measure, place a call: it connects through fallback on TUN-A, the least bad path (2 % loss against 2.4 %). The quality is poor, as expected; when a circuit recovers, voice returns to an eligible path.</>}
      />
      <FailureWalk
        title="6 · The guided lesson: a monitor pointed at nothing"
        normal={<>Each tunnel&apos;s probes go to the hub&apos;s loopback, 10.255.0.1, which answers on both paths.</>}
        change={<>TUN-B&apos;s probe target is set to 10.255.0.99, an address nobody owns at the hub.</>}
        evidence={
          <>
            <p>Both circuits are up and both overlays work, but TUN-B gets zero probe replies, so it never has a valid SLA result. While TUN-A is browned out, voice has zero eligible paths and is dropped by the configured policy. The backup, which needs no SLA, still uses TUN-B.</p>
            <DiagramFrame caption="The path works; the measurement doesn't.">
              <MonitorDiagram />
            </DiagramFrame>
            <DiagramFrame caption="Both circuits UP, both overlays reachable — and calls fail.">
              <IncidentDiagram />
            </DiagramFrame>
          </>
        }
        next={<>A path that carries traffic but never answers probes: check what is being probed, not the path. The target must answer on the path being measured.</>}
        fix={<>Point TUN-B&apos;s probes back at 10.255.0.1 (on a Junos SRX this is the RPM test&apos;s target address). Leave the voice SLA unchanged: raising the RTT threshold would hide TUN-A&apos;s poor quality and still leave TUN-B unmeasured.</>}
        proof={
          <>
            <p>TUN-B&apos;s probes are answered by 10.255.0.1; after three passing intervals TUN-B is eligible, and voice flows on TUN-B while TUN-A is still degraded.</p>
            <DiagramFrame caption="Valid samples first, then the modeled 3-interval rule.">
              <RepairDiagram />
            </DiagramFrame>
          </>
        }
      />
    </div>
  );
}

function LabBridge() {
  const openLab = usePracticeLabOpener();
  return (
    <PracticeBridge label="Open the SD-WAN Lab" onPractice={openLab}>
      Same branch and tunnels, your own copy. Nothing you do there changes your lesson progress.
    </PracticeBridge>
  );
}

const G = { foundation: "Foundation", measure: "Measurement", decide: "The decision", change: "Change", ops: "Operations", trouble: "Troubleshooting", beyond: "Beyond this lesson", master: "Master it" };

export const SD_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "sdd-why", label: "Why SD-WAN path selection exists", group: G.foundation },
  { id: "sdd-layers", label: "Underlay, overlay and the planes", group: G.foundation },
  { id: "sdd-idea", label: "Measure, qualify, steer, stabilize", group: G.foundation },
  { id: "sdd-probes", label: "Probes", group: G.measure },
  { id: "sdd-metrics", label: "RTT, jitter and loss", group: G.measure },
  { id: "sdd-windows", label: "Measurement windows", group: G.measure },
  { id: "sdd-brownout", label: "Brownout vs blackout", group: G.measure },
  { id: "sdd-sla", label: "SLA classes and eligibility", group: G.decide },
  { id: "sdd-policy", label: "Application policy", group: G.decide },
  { id: "sdd-control", label: "Central policy, local decision", group: G.decide },
  { id: "sdd-traffic", label: "Steering and failover", group: G.change },
  { id: "sdd-hysteresis", label: "Recovery and hysteresis", group: G.change },
  { id: "sdd-state", label: "The state the edge keeps", group: G.ops },
  { id: "sdd-verify", label: "How to verify", group: G.ops },
  { id: "sdd-normal", label: "What healthy looks like", group: G.ops },
  { id: "sdd-signatures", label: "Failure signatures", group: G.trouble },
  { id: "sdd-check", label: "Check each layer on its own", group: G.trouble },
  { id: "sdd-workflow", label: "Investigation workflow", group: G.trouble },
  { id: "sdd-faults", label: "Six faults, evidence to proof", group: G.trouble },
  { id: "sdd-prove", label: "Prove the repair", group: G.trouble },
  { id: "sdd-monitor", label: "Choosing monitor targets", group: G.beyond },
  { id: "sdd-designs", label: "Topologies and breakout", group: G.beyond },
  { id: "sdd-vendors", label: "Vendor differences", group: G.beyond },
  { id: "sdd-myths", label: "Common misconceptions", group: G.master },
  { id: "sdd-quiz", label: "Knowledge check", group: G.master },
  { id: "sdd-explain", label: "Can you explain it?", group: G.master },
  { id: "sdd-practice", label: "Practice in the SD-WAN Lab", group: G.master },
];

const QUIZ: KnowledgeQuestion[] = [
  {
    id: "q-eligible",
    prompt: "ISP-A browns out: TUN-A measures 160 ms, 40 ms jitter, 2 % loss. Against the voice SLA (100 ms / 30 ms / 1 %), what is TUN-A?",
    options: [
      { id: "a", label: "Down" },
      { id: "b", label: "Reachable, but not eligible for voice" },
      { id: "c", label: "Eligible: it is still up" },
      { id: "d", label: "Eligible only for half the calls" },
    ],
    correctId: "b",
    explanation: "Probes still come back, so TUN-A is reachable. It fails all three voice thresholds, so it leaves the voice paths. The backup, which needs no SLA, can still use it.",
  },
  {
    id: "q-when",
    prompt: "When does the edge notice the brownout?",
    options: [
      { id: "a", label: "Immediately, packet by packet" },
      { id: "b", label: "When the measurement interval closes" },
      { id: "c", label: "When the link goes down" },
      { id: "d", label: "When the controller tells it" },
    ],
    correctId: "b",
    explanation: "The edge decides on per-interval averages of its probes. A change on the WAN is noticed when the interval closes, which is why the proof always starts with a fresh measurement.",
  },
  {
    id: "q-recover",
    prompt: "ISP-A is healthy again. With a recovery of 3 intervals, when does voice return to TUN-A?",
    options: [
      { id: "a", label: "At the first passing interval" },
      { id: "b", label: "After three passing intervals in a row" },
      { id: "c", label: "Only when TUN-B fails" },
      { id: "d", label: "Never, without a manual change" },
    ],
    correctId: "b",
    explanation: "Hysteresis: a recovered path must earn back trust. Returning at the first good sample would make calls flap between paths.",
  },
  {
    id: "q-strict",
    prompt: "Both paths fail the voice SLA. The voice rule is strict. What happens to a call?",
    options: [
      { id: "a", label: "It uses the best reachable path" },
      { id: "b", label: "It is dropped at the branch" },
      { id: "c", label: "It is load-shared across both paths" },
      { id: "d", label: "It waits for the next interval" },
    ],
    correctId: "b",
    explanation: "Strict means no compliant path, no voice. Fallback-to-best-path (Junos violation-action best-path) would connect it over the least bad path.",
  },
  {
    id: "q-local",
    prompt: "On Cisco Catalyst SD-WAN the policy is configured on the controller. Who decides the path for each packet?",
    options: [
      { id: "a", label: "The controller, per packet" },
      { id: "b", label: "The branch edge, locally, from installed policy and its own measurements" },
      { id: "c", label: "The hub" },
      { id: "d", label: "The ISP" },
    ],
    correctId: "b",
    explanation: "The controller distributes policy; the edge applies it with its own live measurements. There is no round-trip to the controller per packet.",
  },
  {
    id: "q-monitor",
    prompt: "TUN-B carries traffic fine, but gets zero probe replies. What should you check first?",
    options: [
      { id: "a", label: "The ISP-B circuit" },
      { id: "b", label: "The probe target: it must answer on the path being measured" },
      { id: "c", label: "The voice SLA thresholds" },
      { id: "d", label: "DNS" },
    ],
    correctId: "b",
    explanation: "A path that works but never answers probes points at the measurement, not the path. In the guided lesson TUN-B's target was 10.255.0.99, an address nobody owns.",
  },
];

export function SdDeepDiveContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="sdd-why" eyebrow="Foundation" title="Why SD-WAN path selection exists" tone="cyan">
        <p>
          A branch has two internet circuits, ISP-A (a business line) and ISP-B (a cheaper public line), and a tunnel to the hub over each. A router chooses a path by reachability and cost: as long as ISP-A is up, it keeps using it. But a circuit can be up and still be bad. In an evening brownout ISP-A delivers 160 ms, 40 ms jitter and 2 % loss; routing sees nothing wrong, and every call on it is choppy.
        </p>
        <FlowSteps
          steps={[
            { title: "Up is not good", body: "A browned-out circuit is reachable, so routing keeps using it, and the calls on it are unusable.", tone: "danger" },
            { title: "One path for everything", body: "Voice and backups would share the same path, although they need different things.", tone: "warning" },
            { title: "No plan for a bad day", body: "Nothing decides what happens when no path is good, or how carefully to come back.", tone: "violet" },
          ]}
        />
        <DiagramFrame caption="Transport below, logical paths above, applications on top.">
          <TopologyDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="sdd-layers" eyebrow="Foundation" title="Underlay, overlay and the planes" tone="cyan">
        <p>The <strong>underlay</strong> is the transport circuits (ISP-A, ISP-B). The <strong>overlay</strong> is the encrypted tunnels across them (TUN-A, TUN-B), like the VPN lesson twice. Applications ride on the overlay, and a policy decides which tunnel each one uses.</p>
        <DiagramFrame caption="Three layers, three planes.">
          <LayersDiagram />
        </DiagramFrame>
        <p className="text-sm text-pv-text-muted">This is the PacketVerse generic SD-WAN model: real products differ, and no SD-WAN wire format is invented. The guided lesson calls the routers BRANCH-EDGE and HUB-EDGE; the lab and this course call them BRANCH and HUB. The addresses and numbers are the same everywhere.</p>
      </GuideSection>

      <GuideSection id="sdd-idea" eyebrow="Foundation" title="Measure, qualify, steer, stabilize" tone="cyan">
        <FlowSteps
          steps={[
            { title: "Measure", body: "Probe each path; turn samples into RTT, jitter and loss.", tone: "violet" },
            { title: "Qualify", body: "Compare with each application's SLA class: eligible or not.", tone: "warning" },
            { title: "Steer", body: "Pick the preferred eligible path, per packet, locally.", tone: "success" },
            { title: "Stabilize", body: "Fail over fast, come back carefully.", tone: "ip" },
          ]}
        />
      </GuideSection>

      <GuideSection id="sdd-probes" eyebrow="Measurement" title="Probes" tone="violet">
        <p>Every interval (10 seconds here) the edge sends 500 probes over each tunnel to the hub&apos;s loopback, 10.255.0.1, and averages them (Cisco: BFD on every tunnel · Junos: RPM probes). The probe target must answer <em>on the path being measured</em>, or the path is never measured at all.</p>
        <DiagramFrame caption="Ordinary ICMP Echo — no SD-WAN header, no SLA fields in the packet.">
          <ProbeDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="sdd-metrics" eyebrow="Measurement" title="RTT, jitter and loss" tone="violet">
        <DiagramFrame caption="Three numbers from one sample series.">
          <MetricsDiagram />
        </DiagramFrame>
        <p>Voice cares about all three: delay makes conversation awkward, jitter overflows playout buffers, loss creates gaps. Bulk transfers mostly care about loss and throughput, and hardly at all about delay.</p>
      </GuideSection>

      <GuideSection id="sdd-windows" eyebrow="Measurement" title="Measurement windows" tone="violet">
        <DiagramFrame caption="How much history each decision uses.">
          <WindowsDiagram />
        </DiagramFrame>
        <p>A longer window smooths out spikes but reacts later; a shorter one reacts faster but flaps more. In the lab one interval is one decision, and a WAN change is only noticed when the interval closes.</p>
      </GuideSection>

      <GuideSection id="sdd-brownout" eyebrow="Measurement" title="Brownout vs blackout" tone="warning">
        <DiagramFrame caption="Only one of them changes link state.">
          <BrownoutDiagram />
        </DiagramFrame>
        <p><strong>Reachable, eligible, down</strong> are three different things. A browned-out TUN-A is reachable but not eligible for voice; a TUN-B with ISP-B down is down for every application.</p>
      </GuideSection>

      <GuideSection id="sdd-sla" eyebrow="The decision" title="SLA classes and eligibility" tone="warning">
        <p>An <strong>SLA class</strong> states what an application tolerates. Voice: at most 100 ms latency, 30 ms jitter and 1 % loss. A path whose latest measurements pass every threshold is <strong>SLA-eligible</strong> for that application.</p>
        <DiagramFrame caption="Measured value, threshold and result for every metric.">
          <HealthyDiagram />
        </DiagramFrame>
        <p>The class must reflect what the application really tolerates. Loosen it until a brownout passes and the alarms stop, while the calls stay choppy.</p>
      </GuideSection>

      <GuideSection id="sdd-policy" eyebrow="The decision" title="Application policy" tone="success">
        <p>The policy says, per application: is an SLA required, which paths may it use in which order, and what to do if no path qualifies (fall back to the best path, or drop). Voice (UDP 16384–32767, DSCP EF) requires the SLA and prefers TUN-A; the backup (rsync, TCP 873) needs no SLA and prefers TUN-B.</p>
        <DiagramFrame caption="Two classes, two preferences.">
          <PolicyDiagram />
        </DiagramFrame>
        <CompareCards
          items={[
            { title: "Policy steering (this lesson)", tone: "success", tag: "per class", points: ["Class → preference list", "SLA filters which paths may be used", "Different classes can use different paths"] },
            { title: "Per-flow load sharing", tone: "cyan", tag: "per flow", points: ["Flows hashed across eligible paths", "Keeps packets of a flow in order", "Adds capacity, not SLA awareness by itself"] },
            { title: "Per-packet spraying", tone: "warning", tag: "per packet", points: ["Packets alternate paths", "Reordering risk when paths differ", "Rare for real-time traffic"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="sdd-control" eyebrow="The decision" title="Central policy, local decision" tone="violet">
        <DiagramFrame caption="Policy distribution vs packet forwarding.">
          <ControlDiagram />
        </DiagramFrame>
        <FlowSteps
          steps={[
            { title: "Cisco Catalyst SD-WAN: centralized", body: <>The policy (SLA class, preferred colors, the app-route policy) is written on the controller, <Mono>vsmart</Mono>, and pushed to the edge. Tunnels are named by color: <Mono>biz-internet</Mono> = TUN-A, <Mono>public-internet</Mono> = TUN-B.</>, tone: "cyan" },
            { title: "Junos SRX: on the edge", body: <>Advanced policy-based routing (APBR) on BRANCH: an SLA rule with a metrics profile, a rule per application, and a routing instance per application whose qualified next hops (<Mono>st0.1</Mono> = TUN-A, <Mono>st0.2</Mono> = TUN-B) carry the preference.</>, tone: "violet" },
          ]}
        />
        <p>Either way the per-packet decision is made on the branch edge, from installed policy and its own live measurements: no round-trip per packet.</p>
      </GuideSection>

      <GuideSection id="sdd-traffic" eyebrow="Change" title="Steering and failover" tone="warning">
        <p><strong>Two applications at once.</strong> A call leaves on TUN-A (the first eligible path in its preference) while the backup leaves on TUN-B (the first reachable path in its preference).</p>
        <DiagramFrame caption="Different classes, different selected paths.">
          <SteeringDiagram />
        </DiagramFrame>
        <p><strong>A brownout.</strong> When the interval closes, TUN-A fails all three voice thresholds and leaves the voice paths.</p>
        <DiagramFrame caption="All three Voice thresholds fail.">
          <DegradeDiagram />
        </DiagramFrame>
        <p><strong>Failover.</strong> The next call is the same UDP packet on a different path: TUN-B. The backup doesn&apos;t care; it was on TUN-B anyway, and TUN-A is still reachable.</p>
        <DiagramFrame caption="The same UDP packet, a different path.">
          <FailoverDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="sdd-hysteresis" eyebrow="Change" title="Recovery and hysteresis" tone="success">
        <p>When ISP-A is healthy again, TUN-A must pass several intervals in a row before voice returns (3 here: Cisco <Mono>bfd app-route multiplier</Mono> · Junos <Mono>switch-idle-time</Mono>, 10 s per interval). Coming back at the first good sample would make calls flap.</p>
        <DiagramFrame caption="Hysteresis prevents flapping.">
          <RecoveryDiagram />
        </DiagramFrame>
        <DiagramFrame caption="Fail over quickly, fail back carefully.">
          <HysteresisDiagram />
        </DiagramFrame>
        <p><strong>A bad day.</strong> If both paths fail the SLA, the policy&apos;s plan B decides: <em>fallback</em> sends calls on the best reachable path (poor, but connected); <em>strict</em> drops them.</p>
      </GuideSection>

      <GuideSection id="sdd-state" eyebrow="Operations" title="The state the edge keeps" tone="cyan">
        <FlowSteps
          steps={[
            { title: "Per path: measurements and status", body: "The last interval's RTT, jitter and loss, and the result: PASS, FAIL or DOWN (no probe replies).", tone: "violet" },
            { title: "Per path and application: eligibility", body: "Eligible = passes the SLA and has earned back trust. A recovering path counts passing intervals (1/3, 2/3, 3/3).", tone: "success" },
            { title: "The policy", body: "The SLA class, the preference per application, SLA required or not, fallback or strict, and how many intervals a recovery needs.", tone: "warning" },
            { title: "Counters and the log", body: "Packets per application and path, drops, and every path state change.", tone: "ip" },
          ]}
        />
      </GuideSection>

      <GuideSection id="sdd-verify" eyebrow="Operations" title="How to verify: measurements, class, policy, path" tone="success">
        <FlowSteps
          steps={[
            { title: "Are the tunnels up?", body: <>Cisco <Mono>show sdwan bfd sessions</Mono> (state per color) · Junos <Mono>show services rpm probe-results</Mono> (probes received per tunnel).</>, tone: "ip" },
            { title: "What did the edge measure?", body: <>Cisco <Mono>show sdwan app-route stats</Mono> (mean loss, latency, jitter) · Junos <Mono>show services rpm probe-results</Mono>.</>, tone: "violet" },
            { title: "Which paths qualify, against which class?", body: <>Cisco <Mono>show sdwan app-route sla-class</Mono> and <Mono>sla-class-index</Mono> · Junos <Mono>show security advance-policy-based-routing</Mono> (compliant / violated).</>, tone: "warning" },
            { title: "What does the policy say, and which path was used?", body: <>Cisco <Mono>show sdwan policy from-vsmart</Mono>, <Mono>show sdwan policy app-route-policy-filter</Mono> (counters) · Junos <Mono>show security advance-policy-based-routing</Mono> (active path), <Mono>show route table RI-VOICE.inet.0</Mono>.</>, tone: "success" },
          ]}
        />
        <p>Then prove it with traffic: measure an interval, send the application, and check the path it took.</p>
      </GuideSection>

      <GuideSection id="sdd-normal" eyebrow="Operations" title="What a healthy branch looks like on the edge" tone="success">
        <NormalState />
      </GuideSection>

      <GuideSection id="sdd-signatures" eyebrow="Troubleshooting" title="Failure signatures: dropped, poor, or on the wrong path" tone="danger">
        <p>A path-selection fault shows up in one of three ways. <strong>Dropped</strong>: the application had no path its policy allows. <strong>Poor</strong>: it was sent on a path that isn&apos;t good enough. <strong>Wrong path</strong>: it works, but not where the design says.</p>
        <FailureSignatures
          items={[
            { tag: "preference", title: "Wrong preference order", tone: "warning", points: ["Both paths SLA-eligible", "Voice on the second-choice line", "The order in the policy, not the network"] },
            { tag: "no SLA", title: "SLA not required / too loose", tone: "danger", points: ["Choppy calls during brownouts, no failover", "Either no SLA class on the voice rule…", "…or a class the brownout passes (eligible at 160 ms)"] },
            { tag: "strict", title: "Strict with no compliant path", tone: "violet", points: ["Both paths fail the SLA", "Voice dropped at the branch", "Fallback-to-best-path would connect poor calls"] },
            { tag: "allowed paths", title: "Too few paths allowed", tone: "ip", points: ["One circuit down, the other up", "That application is dropped", "Its preference list has only the failed path"] },
            { tag: "monitor", title: "A probe target that doesn't answer", tone: "success", points: ["A working path with zero probe replies", "Never eligible, never measured", "Check the target address, not the path"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="sdd-check" eyebrow="Troubleshooting" title="Check each layer on its own" tone="danger">
        <FieldTable
          title="One question per layer"
          columns={["Layer", "Question", "Where to look"]}
          rows={[
            ["Underlay", "Are the circuits up?", "show sdwan bfd sessions · probes received"],
            ["Overlay", "Are the tunnels reachable?", "BFD state per color · st0.x"],
            ["Monitor", "Are probes answered, by the right target?", "app-route stats · rpm probe-results (target address)"],
            ["SLA", "Measured vs threshold, per metric?", "app-route sla-class · metrics-profile"],
            ["Policy", "Which paths are eligible; what happens with none?", "from-vsmart / running-config policy · APBR rules"],
          ]}
        />
      </GuideSection>

      <GuideSection id="sdd-workflow" eyebrow="Troubleshooting" title="Investigation workflow: measurements → SLA class → policy → path" tone="danger">
        <TroubleshootingFlow
          steps={[
            { question: "Dropped, poor, or simply on the wrong path?", look: "The application's result and the path it used (policy counters / the edge's active path)." },
            { question: "Is it classified as the right application?", look: "Voice must match its class (DSCP EF / its ports); otherwise it follows another policy." },
            { question: "What did the edge measure on each path?", look: "show sdwan app-route stats / show services rpm probe-results — after the last interval." },
            { question: "Which paths meet the SLA, and is the class sensible?", look: "A healthy path failing = thresholds too strict; a brownout passing = too loose." },
            { question: "What does the policy say for this application?", look: "SLA required? Preference order? Allowed paths? Fallback or strict?" },
          ]}
        />
      </GuideSection>

      <GuideSection id="sdd-faults" eyebrow="Troubleshooting" title="Six faults, from evidence to proof" tone="danger">
        <FaultWalks />
      </GuideSection>

      <GuideSection id="sdd-prove" eyebrow="Troubleshooting" title="Prove the repair with a fresh interval and fresh traffic" tone="success">
        <ChecklistCard
          tone="success"
          title="The proof, every time"
          mark="✓"
          items={[
            "Keep the WAN condition of the failure (the brownout, the circuit down)",
            "Measure an interval, so the decision uses fresh measurements",
            "Send the application again and see it on the designed path, or connected through fallback",
            "The counters and the active path agree",
            "The voice SLA still reflects what voice tolerates, and the other application is unaffected",
          ]}
        />
        <p>The lab&apos;s tickets check exactly this: a ticket only closes when the policy is right <em>and</em> a fresh measurement and test, under the failing conditions, work as designed.</p>
      </GuideSection>

      <GuideSection id="sdd-monitor" eyebrow="Beyond this lesson" title="Choosing monitor targets" tone="danger">
        <DiagramFrame caption="The measurement is only as good as what it measures.">
          <MonitorDesignDiagram />
        </DiagramFrame>
        <p>Probe something that is always there and only reachable through the path being measured: the far edge&apos;s loopback over that tunnel. A public server reached through any path, or an address nobody owns, measures the wrong thing or nothing at all.</p>
      </GuideSection>

      <GuideSection id="sdd-designs" eyebrow="Beyond this lesson" title="Hub-and-spoke, branch-to-branch, local breakout" tone="cyan">
        <DiagramFrame caption="Where the overlay paths go.">
          <DesignsDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="sdd-vendors" eyebrow="Beyond this lesson" title="Vendor differences" tone="violet">
        <Callout tone="warning" title="Generic model, not a product">
          SD-WAN products differ in overlay encapsulation (often IPsec, sometimes proprietary), measurement (built-in probes, BFD-style echoes, passive measurement of real traffic), SLA scoring (thresholds, scores, weighted metrics), what happens when no path qualifies (drop, best-effort fallback, alternate class), and default dampening. None of these are standardized across vendors. Check your platform&apos;s documentation.
        </Callout>
      </GuideSection>

      <GuideSection id="sdd-myths" eyebrow="Master it" title="Common misconceptions" tone="warning">
        <Misconceptions
          items={[
            { myth: "If the circuit is up, the path is fine.", correction: "Up only means reachable. A brownout is up and unusable for voice; only measurement shows it." },
            { myth: "The controller decides each packet's path.", correction: "The controller distributes policy. The branch edge decides locally, from its own measurements." },
            { myth: "A loose SLA class is safer.", correction: "It hides brownouts: the bad path stays eligible and the calls stay on it." },
            { myth: "A recovered path should be used at once.", correction: "Coming back at the first good sample makes calls flap. Hysteresis waits for several good intervals." },
            { myth: "Strict is always the best plan B.", correction: "Strict drops calls when no path qualifies. Most businesses prefer a poor call over none (fallback)." },
            { myth: "Zero probe replies means the path is down.", correction: "It can mean the probe target is wrong. Check that the target answers on the path being measured." },
          ]}
        />
      </GuideSection>

      <GuideSection id="sdd-quiz" eyebrow="Master it" title="Knowledge check" tone="success">
        <KnowledgeQuiz questions={QUIZ} />
      </GuideSection>

      <GuideSection id="sdd-explain" eyebrow="Master it" title="Can you explain it?" tone="success">
        <ExplainIt
          items={[
            { q: "Why does the backup stay on TUN-B while voice moves during ISP-A's brownout?", a: "The backup was already on TUN-B, its preferred path, and it needs no SLA. Voice moves because TUN-A fails the voice class." },
            { q: "Why does voice not return to TUN-A at the first good interval?", a: "A recovering path must pass several intervals in a row (3 here) before it is eligible again, so a flapping circuit doesn't drag calls back and forth." },
            { q: "Why are calls choppy during a brownout when the SLA class was 'tuned' to 250 ms?", a: "TUN-A's 160 ms, 40 ms, 2 % passes a 250 ms / 60 ms / 3 % class, so TUN-A stays eligible and first in preference." },
            { q: "Why can a backup fail while ISP-A is up the whole time?", a: "If the backup's preference list only contains TUN-B, it has no allowed path when ISP-B is down, and is dropped even though TUN-A works." },
          ]}
        />
      </GuideSection>

      <GuideSection id="sdd-practice" eyebrow="Practice" title="Practice in the SD-WAN Lab" tone="cyan">
        <ChecklistCard
          tone="cyan"
          title="In the lab you will"
          mark="→"
          items={[
            "Send a call and the backup at the same moment on different tunnels",
            "Catch a brownout, and fail voice over and back",
            "Recover faster, and keep backups off the business line",
            "Survive a bad day with both ISPs browned out",
            "Solve five tickets from evidence, on Cisco Catalyst SD-WAN or a Junos SRX, and prove each repair",
          ]}
        />
        <PresentationBridge>See probes, SLA classes, per-application steering, failover and hysteresis in the SD-WAN presentation.</PresentationBridge>
        <LabBridge />
      </GuideSection>
    </div>
  );
}
