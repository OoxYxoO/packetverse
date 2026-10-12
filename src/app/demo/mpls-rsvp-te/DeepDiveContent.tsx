import { Callout, CompareCards, DArrow, DIAGRAM as D, DLink, DNode, DPill, DiagramFrame, DiagramSvg, FailureSignatures, FieldTable, GuideSection, Misconceptions, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { ExplainIt, KnowledgeQuiz, PracticeBridge, type KnowledgeQuestion } from "@/components/lesson/GuideInteractive";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import { PresentationBridge } from "@/components/presentation/LessonPresentation";
import { CliPair, CliPanel, FailureWalk } from "@/components/lesson/GuideCli";
import { createTeNet, teApply, teTicket, teTicketState, type TeTicketId } from "@/lib/sim-engine/scenarios/teNet";
import { TE_HEALTHY, TE_HEALTHY_JN, teCli, teOnly, teTopo } from "./LessonGuideContent";

const G = { foundation: "Foundation", ted: "The TED and CSPF", rsvp: "RSVP signaling", prio: "Priorities", steer: "Using the tunnel", ops: "Operations", trouble: "Troubleshooting", beyond: "Beyond this lesson", master: "Master it" };
export const RSVP_TE_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "td-why", label: "Why traffic engineering", group: G.foundation },
  { id: "td-terms", label: "Headend, midpoint, tail, LSP", group: G.foundation },
  { id: "td-network", label: "The network you will study", group: G.foundation },
  { id: "td-ted", label: "What IS-IS floods for TE", group: G.ted },
  { id: "td-cspf", label: "CSPF in detail", group: G.ted },
  { id: "td-metric", label: "TE metric vs IGP metric", group: G.ted },
  { id: "td-affinity", label: "Affinities (colors)", group: G.ted },
  { id: "td-ero", label: "Explicit paths: strict and loose", group: G.ted },
  { id: "td-objects", label: "PATH and RESV objects", group: G.rsvp },
  { id: "td-hops", label: "How the messages travel", group: G.rsvp },
  { id: "td-bw", label: "Admission and bandwidth accounting", group: G.rsvp },
  { id: "td-labels", label: "Labels and PHP", group: G.rsvp },
  { id: "td-soft", label: "Soft state, refresh, errors", group: G.rsvp },
  { id: "td-prio", label: "Setup, hold and preemption", group: G.prio },
  { id: "td-mbb", label: "Make-before-break", group: G.prio },
  { id: "td-steer", label: "Getting traffic into the tunnel", group: G.steer },
  { id: "td-oneway", label: "One direction only", group: G.steer },
  { id: "td-config", label: "Configuring it: IOS XR and Junos", group: G.ops },
  { id: "td-verify", label: "How to verify", group: G.ops },
  { id: "td-signatures", label: "Failure signatures", group: G.trouble },
  { id: "td-workflow", label: "Investigation workflow", group: G.trouble },
  { id: "td-tickets", label: "Five faults, evidence to proof", group: G.trouble },
  { id: "td-beyond", label: "Where TE goes next", group: G.beyond },
  { id: "td-myths", label: "Common misconceptions", group: G.master },
  { id: "td-quiz", label: "Knowledge check", group: G.master },
  { id: "td-explain", label: "Can you explain it?", group: G.master },
  { id: "td-practice", label: "Practice in the RSVP-TE Lab", group: G.master },
];

// Real CLI output: the RSVP-TE Lab's own command sets run against the lab's model.
const ticket = (id: TeTicketId) => teTicket(id).repro.reduce((acc, a) => teApply(acc, a), teTicketState(id, 1));
const T = { bw: ticket("bw"), telink: ticket("telink"), explicit: ticket("explicit"), affinity: ticket("affinity"), autoroute: ticket("autoroute") };
const NO_TUNNEL = teApply(teApply(createTeNet(0), { type: "set", text: "no tunnel", changes: [{ dev: "R1", f: (c) => void (c.tunnels = []) }] }), { type: "test", from: "CE1", mbps: 500 });

function LabBridge() {
  const openLab = usePracticeLabOpener();
  return (
    <PracticeBridge label="Open the RSVP-TE Lab" onPractice={openLab}>
      The network from this page, IOS XR or Junos, your own copy. Nothing you do there changes your lesson progress.
    </PracticeBridge>
  );
}

/** The lab's network: two paths, the R4–R5 link, loads and reservable bandwidth. */
function LabNet() {
  const n: Record<string, [number, number, string]> = { R1: [80, 110, "1.1.1.1"], R2: [240, 40, "2.2.2.2"], R4: [400, 40, "4.4.4.4"], R3: [240, 180, "3.3.3.3"], R5: [400, 180, "5.5.5.5"], R6: [560, 110, "6.6.6.6"] };
  const l: [string, string, string, string][] = [
    ["R1", "R2", "10 · BLUE", D.cyan],
    ["R2", "R4", "10 · 200 res. · 800 used", D.danger],
    ["R4", "R6", "10 · BLUE", D.cyan],
    ["R1", "R3", "15 · GOLD", D.warning],
    ["R3", "R5", "15 · GOLD", D.warning],
    ["R5", "R6", "15 · GOLD", D.warning],
    ["R4", "R5", "25 · RED", D.faint],
  ];
  return (
    <DiagramSvg h={230} label="R1 to R6 over a top path (R2, R4) and a bottom path (R3, R5), with an R4–R5 link; R2–R4 is busy and offers 200 Mbps reservable">
      {l.map(([a, b, t, c]) => (
        <DLink key={a + b} x1={n[a][0]} y1={n[a][1]} x2={n[b][0]} y2={n[b][1]} color={c} label={t} labelDy={a === "R4" && b === "R5" ? 0 : n[a][1] < 100 && n[b][1] < 100 ? -8 : 16} />
      ))}
      {Object.entries(n).map(([id, [x, y, lo]]) => (
        <DNode key={id} x={x} y={y} label={id} sub={lo} accent={D.mpls} w={78} />
      ))}
      <text x={320} y={222} textAnchor="middle" fill={D.muted} fontSize={10}>
        IGP metric · color · R1 heads tunnel-te1 (500 Mbps), R3 heads CUST-B (400 Mbps to R5)
      </text>
    </DiagramSvg>
  );
}

function ObjectsDiagram() {
  const col = (x: number, title: string, c: string, objs: string[]) => (
    <g>
      <text x={x} y={22} textAnchor="middle" fill={c} fontSize={11.5} fontWeight={700}>
        {title}
      </text>
      {objs.map((o, i) => (
        <DPill key={o} x={x} y={46 + i * 28} text={o} color={c} w={250} />
      ))}
    </g>
  );
  return (
    <DiagramSvg h={290} label="PATH carries session, previous hop, label request, explicit route, sender template and traffic spec; RESV carries session, next hop, style, flowspec, filter spec and label">
      {col(170, "PATH ↓ (headend → tailend)", D.cyan, ["SESSION (tunnel endpoint + ID)", "RSVP_HOP (previous hop)", "TIME_VALUES (refresh)", "EXPLICIT_ROUTE (ERO)", "LABEL_REQUEST", "SESSION_ATTRIBUTE (priorities, name)", "SENDER_TEMPLATE + SENDER_TSPEC", "RECORD_ROUTE (optional)", "FAST_REROUTE (optional)"])}
      {col(470, "RESV ↑ (tailend → headend)", D.violet, ["SESSION", "RSVP_HOP (next hop)", "TIME_VALUES", "STYLE (FF / SE)", "FLOWSPEC (reserved bandwidth)", "FILTER_SPEC", "LABEL", "RECORD_ROUTE (optional)"])}
    </DiagramSvg>
  );
}

function HopsDiagram() {
  return (
    <DiagramSvg h={170} label="PATH is addressed to the tailend but processed at every hop via Router Alert; RESV is sent hop by hop to each previous hop">
      {[
        ["R1", 80],
        ["R3", 240],
        ["R5", 400],
        ["R6", 560],
      ].map(([id, x]) => (
        <DNode key={id as string} x={x as number} y={85} label={id as string} accent={D.mpls} w={84} />
      ))}
      <DArrow x1={126} y1={45} x2={514} y2={45} color={D.cyan} label="PATH: dst = tailend, Router Alert → each hop intercepts, updates PHOP, forwards" />
      <DArrow x1={354} y1={128} x2={286} y2={128} color={D.violet} />
      <DArrow x1={514} y1={128} x2={446} y2={128} color={D.violet} />
      <DArrow x1={194} y1={128} x2={126} y2={128} color={D.violet} />
      <text x={320} y={158} textAnchor="middle" fill={D.violet} fontSize={10} fontWeight={700}>
        RESV: unicast to the previous hop (PHOP) recorded from PATH, one hop at a time
      </text>
    </DiagramSvg>
  );
}

function BandwidthDiagram() {
  const x0 = 60;
  const scale = 0.5;
  return (
    <DiagramSvg h={150} label="A 1000 Mbps link with 1000 reservable: 400 reserved by another LSP, 600 available">
      <rect x={x0} y={40} width={1000 * scale} height={30} rx={6} fill="none" stroke={D.line} />
      <rect x={x0} y={40} width={400 * scale} height={30} rx={6} fill={D.warning} fillOpacity={0.35} stroke={D.warning} />
      <text x={x0 + 100} y={60} textAnchor="middle" fill={D.text} fontSize={10.5} fontWeight={700}>
        reserved 400
      </text>
      <text x={x0 + 350} y={60} textAnchor="middle" fill={D.success} fontSize={10.5} fontWeight={700}>
        available 600
      </text>
      <text x={x0} y={30} fill={D.muted} fontSize={9.5}>
        0
      </text>
      <text x={x0 + 500} y={30} textAnchor="end" fill={D.muted} fontSize={9.5}>
        max reservable 1000
      </text>
      <text x={320} y={100} textAnchor="middle" fill={D.text} fontSize={10.5}>
        admission: request ≤ available (at the LSP&apos;s priority) → accept, else reject
      </text>
      <text x={320} y={122} textAnchor="middle" fill={D.muted} fontSize={10}>
        reservations are bookkeeping; they don&apos;t police or measure real traffic
      </text>
    </DiagramSvg>
  );
}

function PreemptDiagram() {
  return (
    <DiagramSvg h={170} label="A new LSP with setup priority 2 can preempt an existing LSP with hold priority 5 on a full link">
      <DNode x={120} y={50} label="LSP-GOLD" sub="setup 2 / hold 2" accent={D.success} w={150} />
      <DNode x={120} y={130} label="LSP-BRONZE" sub="setup 5 / hold 5" accent={D.warning} w={150} />
      <DArrow x1={200} y1={50} x2={380} y2={88} color={D.success} label="2 beats 5" labelDy={-10} />
      <DArrow x1={380} y1={100} x2={200} y2={130} color={D.danger} dashed label="preempted" labelDy={22} />
      <DNode x={470} y={94} label="full link" sub="no bandwidth left" accent={D.danger} w={150} />
    </DiagramSvg>
  );
}

function StrictLooseDiagram() {
  return (
    <DiagramSvg h={160} label="Strict hops must be directly connected next hops; a loose hop lets the router before it fill in the path">
      {[
        ["R1", 60],
        ["R3", 190],
        ["X", 320],
        ["R5", 450],
        ["R6", 580],
      ].map(([id, x]) => (
        <DNode key={id as string} x={x as number} y={70} label={id as string} accent={id === "X" ? D.faint : D.mpls} w={72} />
      ))}
      <DLink x1={96} y1={70} x2={154} y2={70} color={D.cyan} label="strict" labelDy={-10} />
      <DLink x1={226} y1={70} x2={284} y2={70} color={D.warning} dashed />
      <DLink x1={356} y1={70} x2={414} y2={70} color={D.warning} dashed />
      <text x={320} y={40} textAnchor="middle" fill={D.warning} fontSize={10} fontWeight={700}>
        loose hop R5: R3 expands the path itself
      </text>
      <DLink x1={486} y1={70} x2={544} y2={70} color={D.cyan} label="strict" labelDy={-10} />
      <text x={320} y={130} textAnchor="middle" fill={D.muted} fontSize={10}>
        ERO {"{"}R3 strict, R5 loose, R6 strict{"}"} · this lesson&apos;s ERO is fully strict
      </text>
    </DiagramSvg>
  );
}

function MbbDiagram() {
  return (
    <DiagramSvg h={190} label="Make-before-break: the new LSP is signaled with Shared Explicit style and shares bandwidth with the old LSP, then traffic switches and the old LSP is torn down">
      <DNode x={70} y={95} label="R1" accent={D.mpls} w={70} />
      <DNode x={570} y={95} label="R6" accent={D.mpls} w={70} />
      <DArrow x1={106} y1={80} x2={534} y2={45} color={D.faint} label="old LSP (still forwarding)" />
      <DArrow x1={106} y1={110} x2={534} y2={145} color={D.success} label="new LSP (same session, SE style)" labelDy={22} />
      <FlowStepsSvg />
    </DiagramSvg>
  );
}

function FlowStepsSvg() {
  const st = ["1 signal new", "2 new UP", "3 switch traffic", "4 tear down old"];
  return (
    <>
      {st.map((s, i) => (
        <DPill key={s} x={170 + i * 100} y={95} text={s} color={i === 2 ? D.success : D.violet} w={94} />
      ))}
    </>
  );
}


const QUIZ: KnowledgeQuestion[] = [
  {
    id: "q-cspf",
    prompt: "R2–R4 is a 1 Gbps link, but CSPF prunes it for a 500 Mbps LSP. Why?",
    options: [
      { id: "a", label: "Its unreserved bandwidth in the TED (200 Mbps) is below the request" },
      { id: "b", label: "Its IGP metric is too high" },
      { id: "c", label: "IS-IS doesn't run on it" },
    ],
    correctId: "a",
    explanation: "CSPF compares the request with the unreserved bandwidth flooded in the TED at the LSP's setup priority — never with the physical speed.",
  },
  {
    id: "q-label",
    prompt: "Who decides the label R1 pushes on tunnel-te1?",
    options: [
      { id: "a", label: "R3 — it chose its incoming label and sent it upstream in the RESV" },
      { id: "b", label: "R1, the headend" },
      { id: "c", label: "R6, the tail" },
    ],
    correctId: "a",
    explanation: "Labels are allocated by the downstream router: R3 picks the label it wants to receive and advertises it to R1 in the RESV.",
  },
  {
    id: "q-auto",
    prompt: "tunnel-te1 is up with 500 Mbps reserved, but the video still crosses R2–R4. Most likely?",
    options: [
      { id: "a", label: "Nothing routes traffic into the tunnel (no autoroute announce / IS-IS shortcuts)" },
      { id: "b", label: "RESV didn't reach R1" },
      { id: "c", label: "R2–R4 is in the ERO" },
    ],
    correctId: "a",
    explanation: "An LSP that is up only carries traffic routing points into it. Check R1's route to 10.6.6.0/24.",
  },
  {
    id: "q-strict",
    prompt: "An explicit path lists 3.3.3.3 strict, then 4.4.4.4 strict. What happens?",
    options: [
      { id: "a", label: "CSPF fails: R3 and R4 are not directly connected" },
      { id: "b", label: "R3 forwards PATH to R4 over any path" },
      { id: "c", label: "The second hop is ignored" },
    ],
    correctId: "a",
    explanation: "A strict hop must be the very next router. Only a loose hop lets CSPF fill in the path to it.",
  },
  {
    id: "q-preempt",
    prompt: "tunnel-te1 (setup 3) preempts CUST-B (hold 7) on R3–R5. What happens to CUST-B's 400 Mbps of traffic?",
    options: [
      { id: "a", label: "It keeps flowing — over IS-IS now — and still loads R3–R5" },
      { id: "b", label: "It is dropped by RSVP" },
      { id: "c", label: "It moves into tunnel-te1" },
    ],
    correctId: "a",
    explanation: "Preemption takes away a reservation, not the traffic. A reservation never adds capacity to a link.",
  },
  {
    id: "q-mbb",
    prompt: "You raise tunnel-te1 from 500 to 700 Mbps, but no path has 700 Mbps unreserved. What does make-before-break do?",
    options: [
      { id: "a", label: "Keeps the existing LSP up at 500 Mbps; the new one simply isn't signaled" },
      { id: "b", label: "Tears the tunnel down" },
      { id: "c", label: "Signals 700 Mbps anyway" },
    ],
    correctId: "a",
    explanation: "The new LSP is signaled first; traffic moves only when it is up. If it can't be signaled, the old one stays.",
  },
  {
    id: "q-ted",
    prompt: "R3's interface toward R5 is not a TE interface, but IS-IS runs on it. What does R1's TED show?",
    options: [
      { id: "a", label: "R5→R3 only: R3–R5 fails the two-way check and CSPF can't use it" },
      { id: "b", label: "Both directions, with 0 bandwidth" },
      { id: "c", label: "Nothing changes" },
    ],
    correctId: "a",
    explanation: "Each router floods its own TE links. Without R3's half, CSPF won't use the link in either direction.",
  },
  {
    id: "q-oneway",
    prompt: "How do you engineer CE6's 300 Mbps back to CE1?",
    options: [
      { id: "a", label: "Build a separate LSP from R6 to 1.1.1.1, and route traffic into it on R6" },
      { id: "b", label: "Add 300 Mbps to tunnel-te1" },
      { id: "c", label: "RSVP does it automatically" },
    ],
    correctId: "a",
    explanation: "LSPs are unidirectional. Each direction needs its own headend.",
  },
];

export function RsvpTeDeepDiveContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="td-why" eyebrow="Foundation" title="Why traffic engineering" tone="mpls">
        <p>
          A link-state IGP sends every packet down the lowest-metric path. That is efficient until the cheapest path is full while a longer one sits idle. Metrics are one knob for all traffic at once; traffic engineering gives individual flows their own paths, chosen against constraints — first of all, bandwidth.
        </p>
        <Callout tone="warning" title="The lab without a tunnel: 500 Mbps from CE1 on the IS-IS path" icon="!">
          {NO_TUNNEL.tests.at(-1)!.why}.
        </Callout>
      </GuideSection>

      <GuideSection id="td-terms" eyebrow="Foundation" title="Headend, midpoint, tail, LSP" tone="cyan">
        <FieldTable
          title="Who does what"
          accent="mpls"
          columns={["Role", "In the lab", "Does"]}
          rows={[
            ["Headend", "R1 (tunnel-te1), R3 (CUST-B)", "holds the tunnel config, runs CSPF, sends PATH, pushes the label"],
            ["Midpoint", "R3, R5 for tunnel-te1", "admits and reserves, allocates a label, swaps"],
            ["Tail", "R6 (tunnel-te1), R5 (CUST-B)", "answers PATH with RESV, asks for implicit-null"],
            ["TE tunnel / LSP", "tunnel-te1 (Junos LSP TO-R6)", "the interface on the headend / the signaled path"],
          ]}
        />
      </GuideSection>

      <GuideSection id="td-network" eyebrow="Foundation" title="The network you will study" tone="cyan">
        <DiagramFrame caption="The RSVP-TE Lab. Every output on this page comes from it.">
          <LabNet />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="td-ted" eyebrow="The TED and CSPF" title="What IS-IS floods for TE" tone="violet">
        <FieldTable
          title="Per link direction (RFC 5305 sub-TLVs)"
          accent="violet"
          columns={["Attribute", "Comes from", "In the lab"]}
          rows={[
            ["TE metric", "admin-weight / te-metric (default: IGP metric)", "10 top, 15 bottom, 25 R4–R5"],
            ["Maximum reservable bandwidth", "the RSVP interface bandwidth", "200 Mbps on R2–R4, 1 Gbps elsewhere"],
            ["Unreserved bandwidth [0..7]", "reservable minus what LSPs hold, per priority", "R3→R5: 100 Mbps at priority 7"],
            ["Administrative group", "attribute-names / admin-group", "BLUE top, GOLD bottom, RED R4–R5"],
          ]}
        />
        <p>A router floods a link only if it is a TE interface there; CSPF requires both directions (two-way check). Reservation changes are flooded too, so every headend works from the same numbers.</p>
        <CliPanel run={teOnly(TE_HEALTHY_JN, "R1", "juniper", "show ted database extensive", /^R3|To: R5|Color|Metric|Reservable|\[[0-7]\]/)} caption="Junos · R1 — R3's links in the TED" />
      </GuideSection>

      <GuideSection id="td-cspf" eyebrow="The TED and CSPF" title="CSPF in detail" tone="violet">
        <CompareCards
          items={[
            { title: "1 · Prune", tone: "danger", tag: "constraints", points: ["not in the TED both ways", "unreserved < requested at the setup priority", "colors fail include / exclude", "explicit hops not followable"] },
            { title: "2 · Shortest path", tone: "success", tag: "metric", points: ["Dijkstra on what is left", "by TE metric (IGP metric if configured)", "ties broken by vendor rules"] },
          ]}
        />
        <p>CSPF runs only at the headend and only produces a path. When it fails, the headend says so in general terms — IOS XR &quot;No path to destination (bw)&quot;, Junos &quot;CSPF failed: no route toward 6.6.6.6&quot; — so finding <i>which</i> constraint broke is your job.</p>
      </GuideSection>

      <GuideSection id="td-metric" eyebrow="The TED and CSPF" title="TE metric vs IGP metric" tone="cyan">
        <p>The TE metric is a second metric only CSPF uses. Raise it on a link and tunnels avoid that link while IS-IS — and all non-tunnel traffic — keeps using it. The lab&apos;s third challenge does exactly that with R2–R4.</p>
        <CliPair cisco={{ prompt: "RP/0/RP0/CPU0:R2(config)#", command: "mpls traffic-eng", output: "RP/0/RP0/CPU0:R2(config-mpls-te)#interface GigabitEthernet0/0/0/1\nRP/0/RP0/CPU0:R2(config-mpls-te-if)#admin-weight 100\nRP/0/RP0/CPU0:R2(config-mpls-te-if)#commit" }} junos={{ prompt: "admin@R2# ", command: "set protocols isis interface ge-0/0/1.0 level 2 te-metric 100", output: "\n[edit]\nadmin@R2# commit\ncommit complete" }} ciscoCaption="IOS XR · R2" junosCaption="Junos · R2" />
      </GuideSection>

      <GuideSection id="td-affinity" eyebrow="The TED and CSPF" title="Affinities (colors)" tone="warning">
        <p>Each link carries a 32-bit set of administrative groups. A tunnel can require all of some colors (<Mono>affinity include GOLD</Mono> / <Mono>admin-group include-all GOLD</Mono>) or refuse others (<Mono>affinity exclude RED</Mono>). Names map to bits: IOS XR <Mono>affinity-map</Mono>, Junos <Mono>admin-groups</Mono>.</p>
        <CliPanel run={teTopo(TE_HEALTHY, "R1", ["192.0.2.12"])} caption="IOS XR · R1's TED — R4→R5 is RED (bit 2, flags 0x4)" />
      </GuideSection>

      <GuideSection id="td-ero" eyebrow="The TED and CSPF" title="Explicit paths: strict and loose" tone="mpls">
        <DiagramFrame caption="Strict: the next router. Loose: any path to it.">
          <StrictLooseDiagram />
        </DiagramFrame>
        <p>An explicit path is a list of hops; CSPF still checks bandwidth and colors along it. A path option can be explicit or dynamic, and the headend tries path options in order — an explicit primary with a dynamic fallback survives failures the explicit path can&apos;t.</p>
      </GuideSection>

      <GuideSection id="td-objects" eyebrow="RSVP signaling" title="PATH and RESV objects" tone="mpls">
        <DiagramFrame caption="What each message carries (RFC 2205 / RFC 3209).">
          <ObjectsDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="td-hops" eyebrow="RSVP signaling" title="How the messages travel" tone="mpls">
        <DiagramFrame caption="PATH is processed at every hop; RESV goes hop by hop back toward the headend.">
          <HopsDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="td-bw" eyebrow="RSVP signaling" title="Admission and bandwidth accounting" tone="success">
        <DiagramFrame caption="Reservable is a policy ceiling; unreserved is what is left of it.">
          <BandwidthDiagram />
        </DiagramFrame>
        <p>Each hop admits a reservation on its outgoing interface if the unreserved bandwidth at the LSP&apos;s priority allows it. The bandwidth is control-plane bookkeeping: it doesn&apos;t police or shape the traffic, and it doesn&apos;t know about traffic outside LSPs — that is why R2–R4&apos;s reservable bandwidth is set to the headroom actually left.</p>
        <CliPair cisco={teCli(TE_HEALTHY, "R3", "cisco", "show rsvp interface")} junos={teCli(TE_HEALTHY_JN, "R3", "juniper", "show rsvp interface")} ciscoCaption="IOS XR · R3 — 900M allocated toward R5" junosCaption="Junos · R3" />
      </GuideSection>

      <GuideSection id="td-labels" eyebrow="RSVP signaling" title="Labels and PHP" tone="violet">
        <p>The Label Request in PATH asks for labels; each hop answers with a Label object in RESV — downstream-on-demand allocation. The tail asks for implicit-null, so the penultimate hop pops. The headend uses the label the first hop asked for.</p>
        <CliPair cisco={teCli(TE_HEALTHY, "R3", "cisco", "show rsvp session")} junos={teCli(TE_HEALTHY_JN, "R3", "juniper", "show rsvp session")} ciscoCaption="IOS XR · R3" junosCaption="Junos · R3 — ingress (CUST-B) and transit (TO-R6), with labels" />
      </GuideSection>

      <GuideSection id="td-soft" eyebrow="RSVP signaling" title="Soft state, refresh, errors" tone="warning">
        <FieldTable
          title="Keeping and losing state"
          accent="warning"
          columns={["Message", "When", "Effect"]}
          rows={[
            ["PATH / RESV refresh", "every ~30 s (soft state)", "state times out if refreshes stop"],
            ["PathTear", "headend removes the LSP", "state and reservations removed downstream"],
            ["ResvTear", "tail or a hop withdraws", "reservations released upstream"],
            ["PathErr", "a hop can't continue (e.g. preemption, admission)", "sent back to the headend"],
            ["ResvErr", "a reservation fails", "sent toward the tail"],
          ]}
        />
      </GuideSection>

      <GuideSection id="td-prio" eyebrow="Priorities" title="Setup, hold and preemption" tone="danger">
        <DiagramFrame caption="A better setup priority takes bandwidth from a worse hold priority.">
          <PreemptDiagram />
        </DiagramFrame>
        <p>Priorities run 0 (best) to 7 (worst). The setup priority is used when an LSP asks for bandwidth, the hold priority when others try to take it; hold must not be worse than setup. IOS XR defaults to 7/7, Junos to setup 7, hold 0. In the lab, giving tunnel-te1 priority 3 preempts CUST-B — whose traffic then still crosses R3–R5 outside any LSP.</p>
      </GuideSection>

      <GuideSection id="td-mbb" eyebrow="Priorities" title="Make-before-break" tone="success">
        <DiagramFrame caption="The new LSP comes up beside the old one; then the old one goes.">
          <MbbDiagram />
        </DiagramFrame>
        <p>Reoptimization, resizing and path changes signal a new LSP instance in the same session with the Shared Explicit style, so both instances can share the links they have in common. If the new instance can&apos;t be signaled, the old one stays. IOS XR does this by default; on Junos, sharing during make-before-break needs <Mono>adaptive</Mono> on the LSP. The lab models the IOS XR behavior on both views.</p>
      </GuideSection>

      <GuideSection id="td-steer" eyebrow="Using the tunnel" title="Getting traffic into the tunnel" tone="warning">
        <FieldTable
          title="Ways to steer traffic"
          accent="warning"
          columns={["Method", "Effect"]}
          rows={[
            ["autoroute announce (IOS XR) / IS-IS shortcuts (Junos)", "the IGP uses the tunnel for the tail and everything behind it — headend only"],
            ["forwarding adjacency", "the tunnel is advertised as a link, so other routers can use it too"],
            ["static route / policy", "a chosen prefix points at the tunnel"],
            ["BGP next hop resolution (Junos inet.3)", "BGP routes whose next hop is the tail resolve over the LSP"],
          ]}
        />
      </GuideSection>

      <GuideSection id="td-oneway" eyebrow="Using the tunnel" title="One direction only" tone="cyan">
        <p>RSVP-TE LSPs are unidirectional. tunnel-te1 carries R1 → R6; CE6&apos;s answer follows IS-IS over R4–R2 unless R6 has its own tunnel to 1.1.1.1 (the lab&apos;s fourth challenge).</p>
        <Callout tone="warning" title="The lab: 300 Mbps from CE6 back to CE1, no tunnel from R6" icon="!">
          {teApply(TE_HEALTHY, { type: "test", from: "CE6", mbps: 300 }).tests.at(-1)!.why}.
        </Callout>
      </GuideSection>

      <GuideSection id="td-config" eyebrow="Operations" title="Configuring it: IOS XR and Junos" tone="cyan">
        <CliPair cisco={teOnly(TE_HEALTHY, "R1", "cisco", "show running-config", /tunnel-te|unnumbered|autoroute|destination|signalled|path-option|^rsvp| bandwidth|^mpls|attribute-names|affinity-map|^ interface Gi|mpls traffic-eng/)} junos={teCli(TE_HEALTHY_JN, "R1", "juniper", "show configuration protocols mpls")} ciscoCaption="IOS XR · R1 — tunnel, RSVP, TE interfaces, IS-IS TE" junosCaption="Junos · R1 — the LSP, admin groups, TE interfaces" />
        <p className="text-sm text-pv-text-muted">IS-IS also needs TE enabled: IOS XR <Mono>mpls traffic-eng level-2-only</Mono> and <Mono>mpls traffic-eng router-id Loopback0</Mono> under the address family; Junos floods TE by default.</p>
      </GuideSection>

      <GuideSection id="td-verify" eyebrow="Operations" title="How to verify" tone="cyan">
        <FieldTable
          title="Questions and commands"
          accent="cyan"
          columns={["Question", "IOS XR", "Junos"]}
          rows={[
            ["Is the LSP up, on which path?", <Mono key="1">show mpls traffic-eng tunnels [brief | n]</Mono>, <Mono key="2">show mpls lsp [extensive]</Mono>],
            ["What is in the TED?", <Mono key="3">show mpls traffic-eng topology</Mono>, <Mono key="4">show ted database extensive</Mono>],
            ["Who holds bandwidth?", <Mono key="5">show rsvp interface · show rsvp session</Mono>, <Mono key="6">show rsvp interface · show rsvp session</Mono>],
            ["Labels?", <Mono key="7">show mpls forwarding</Mono>, <Mono key="8">show rsvp session (Labelin / Labelout)</Mono>],
            ["Routed into it?", <Mono key="9">show route 10.6.6.20</Mono>, <Mono key="10">show route 10.6.6.20</Mono>],
            ["Does it forward?", <Mono key="11">ping / traceroute mpls traffic-eng tunnel-te 1</Mono>, <Mono key="12">ping / traceroute mpls rsvp TO-R6</Mono>],
          ]}
        />
      </GuideSection>

      <GuideSection id="td-signatures" eyebrow="Troubleshooting" title="Failure signatures" tone="danger">
        <FailureSignatures
          items={[
            { tag: "BW", title: "No path with enough bandwidth", tone: "danger", points: ["LSP down, CSPF: no path (bw)", "find who holds the bandwidth"] },
            { tag: "TED", title: "Link missing from the TED", tone: "danger", points: ["link up, LSP down", "one direction only in the topology"] },
            { tag: "ERO", title: "Explicit path impossible", tone: "warning", points: ["strict hop not adjacent", "no dynamic fallback"] },
            { tag: "AFF", title: "Colors no longer match", tone: "violet", points: ["include / exclude prunes every path", "check attribute flags"] },
            { tag: "AR", title: "Up but unused", tone: "warning", points: ["route to the tail still via IS-IS", "autoroute / shortcuts missing"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="td-workflow" eyebrow="Troubleshooting" title="Investigation workflow" tone="danger">
        <TroubleshootingFlow
          steps={[
            { question: "What does the traffic do?", look: "Which path, which link drops — a fresh flow test." },
            { question: "Is the LSP up?", look: "The headend's tunnel status and its CSPF error." },
            { question: "Is every link in the TED, both ways?", look: "The topology / TED on the headend." },
            { question: "Who holds the bandwidth?", look: "show rsvp interface / session on the links that matter." },
            { question: "Do the constraints leave a path?", look: "Colors, explicit hops, priorities." },
            { question: "Is traffic routed into the tunnel?", look: "The headend's route to the tail's prefixes." },
          ]}
        />
      </GuideSection>

      <GuideSection id="td-tickets" eyebrow="Troubleshooting" title="Five faults, evidence to proof" tone="danger">
        <p>The RSVP-TE Lab&apos;s five tickets, each output from the lab with the fault in place after the user&apos;s test (IOS XR view).</p>
        <FailureWalk
          title="1 · The video upgrade that never came up"
          normal="tunnel-te1 500 Mbps over R3, R5; CUST-B 400 Mbps on R3–R5."
          change="tunnel-te1 resized to 700 Mbps, R1 reloaded; CUST-B decommissioned but its tunnel left on R3."
          evidence={<CliPanel run={teOnly(T.bw, "R1", "cisco", "show mpls traffic-eng tunnels 1", /Admin:|path option|Info:|Bandwidth:/)} caption="IOS XR · R1" />}
          next="R3's show rsvp interface: 400M held toward R5 by tunnel-te10. Top offers 200, bottom 600: no path has 700."
          fix={<Mono>R3: interface tunnel-te10 → shutdown → commit</Mono>}
          proof="tunnel-te1 up with 700 Mbps; a fresh 700 Mbps flow from CE1 is delivered."
        />
        <FailureWalk
          title="2 · The tunnel that lost its path"
          normal="Every core interface is a TE interface."
          change="R3's replaced line card toward R5 was left out of mpls traffic-eng."
          evidence={<CliPanel run={teTopo(T.telink, "R1", ["192.0.2.8", "192.0.2.9"])} caption="IOS XR · R1's TED — R5→R3 only" />}
          next="Both tunnel-te1 and CUST-B are down; CSPF says bandwidth because every other path crosses R2–R4."
          fix={<Mono>R3: mpls traffic-eng → interface GigabitEthernet0/0/0/1 → commit</Mono>}
          proof="R3→R5 back in the TED; both LSPs up; a fresh 500 Mbps flow is delivered."
        />
        <FailureWalk
          title="3 · Pinned, and never came up"
          normal="tunnel-te1 uses a dynamic path option."
          change="An explicit primary VIA-R3 was added — with 4.4.4.4 as the second strict hop."
          evidence={<CliPanel run={teCli(T.explicit, "R1", "cisco", "show explicit-paths")} caption="IOS XR · R1" />}
          next="R3 has no link to R4: the strict hop can't be followed, and there is no dynamic fallback."
          fix={<Mono>explicit-path name VIA-R3 → index 2 next-address strict ipv4 unicast 5.5.5.5 → commit</Mono>}
          proof="tunnel-te1 up on R1–R3–R5–R6 via path-option 10; a fresh flow is delivered."
        />
        <FailureWalk
          title="4 · Down after the color audit"
          normal="tunnel-te1 includes GOLD; the bottom links are GOLD."
          change="R5's interface toward R6 was recolored BLUE."
          evidence={<CliPanel run={teTopo(T.affinity, "R1", ["192.0.2.10"])} caption="IOS XR · R1's TED — R5→R6 BLUE (0x1)" />}
          next="Top links are BLUE too, R4–R5 is RED: no GOLD-only path is left."
          fix={<Mono>R5: mpls traffic-eng → interface GigabitEthernet0/0/0/1 → attribute-names GOLD → commit</Mono>}
          proof="R5→R6 GOLD again; tunnel-te1 up; a fresh flow is delivered."
        />
        <FailureWalk
          title="5 · Up, reserved — and unused"
          normal="tunnel-te1 has autoroute announce."
          change="A template re-applied to R1 dropped autoroute announce."
          evidence={<CliPanel run={teCli(T.autoroute, "R1", "cisco", "show route 10.6.6.20")} caption="IOS XR · R1 — via R2, not tunnel-te1" />}
          next="The tunnel is up (show mpls traffic-eng tunnels brief) with 500 Mbps reserved, AutoRoute: disabled."
          fix={<Mono>interface tunnel-te1 → autoroute announce → commit</Mono>}
          proof="R1 routes 10.6.6.0/24 via tunnel-te1; a fresh flow is delivered."
        />
      </GuideSection>

      <GuideSection id="td-beyond" eyebrow="Beyond this lesson" title="Where TE goes next" tone="violet">
        <FieldTable
          title="The same LSPs, more jobs"
          accent="violet"
          columns={["Lesson", "What changes"]}
          rows={[
            ["RSVP-TE Fast Reroute", "pre-signaled backup tunnels protect a link or node in about 50 ms"],
            ["L3VPN / L2VPN", "VPN labels ride inside TE LSPs between PEs"],
            ["SR Policy", "engineered paths without RSVP state in the core: the headend encodes the path as a label stack"],
            ["Flex-Algo", "constraint-based paths computed by the IGP itself"],
          ]}
        />
      </GuideSection>

      <GuideSection id="td-myths" eyebrow="Master it" title="Common misconceptions" tone="warning">
        <Misconceptions
          items={[
            { myth: "RSVP reserves bandwidth, so the traffic is protected.", correction: "The reservation is bookkeeping; nothing polices or guarantees the link. Traffic outside LSPs still counts." },
            { myth: "CSPF runs on every router.", correction: "Only the headend computes the path; the others follow the ERO." },
            { myth: "An LSP that is up is in use.", correction: "Only if routing points into it: autoroute / shortcuts / static." },
            { myth: "A tunnel works both ways.", correction: "LSPs are one-way; the return needs its own headend." },
            { myth: "Physical speed is what CSPF checks.", correction: "CSPF checks unreserved bandwidth from the TED." },
            { myth: "Preemption moves the other traffic away.", correction: "It takes the reservation; the traffic still flows somewhere." },
          ]}
        />
      </GuideSection>

      <GuideSection id="td-quiz" eyebrow="Master it" title="Knowledge check" tone="cyan">
        <KnowledgeQuiz questions={QUIZ} />
      </GuideSection>

      <GuideSection id="td-explain" eyebrow="Master it" title="Can you explain it?" tone="violet">
        <ExplainIt
          items={[
            { q: "Why doesn't IS-IS avoid the busy R2–R4 link?", a: "It compares metrics only. Load and flow size are not part of SPF." },
            { q: "What exactly makes CSPF prune R2–R4 for 500 Mbps?", a: "Its unreserved bandwidth in the TED — 200 Mbps at priority 7 — is below the request." },
            { q: "Why do labels travel in the RESV and not in the PATH?", a: "Each router chooses the label it will receive. It can only tell its upstream neighbor, which is where RESV goes." },
            { q: "Why could the 700 Mbps tunnel not come up although every link worked?", a: "A stale reservation (CUST-B, 400 Mbps) left only 600 Mbps unreserved on R3–R5, and the top offers 200: no path met the bandwidth constraint." },
            { q: "What is the difference between a reservation and capacity?", a: "A reservation is a promise recorded in RSVP and the TED; capacity is what the link can carry. Traffic outside LSPs uses capacity without any reservation." },
          ]}
        />
      </GuideSection>

      <GuideSection id="td-practice" eyebrow="Master it" title="Practice in the RSVP-TE Lab" tone="success">
        <p>Six Learn levels take you from &quot;why TE&quot; to the evidence ladder; the engineering workspace gives you all six routers (IOS XR or Junos), traffic in both directions, link cuts, five challenges and the five tickets above.</p>
        <LabBridge />
        <PresentationBridge>Rewatch the RSVP-TE presentation.</PresentationBridge>
      </GuideSection>
    </div>
  );
}
