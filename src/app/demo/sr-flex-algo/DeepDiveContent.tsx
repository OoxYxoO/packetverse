import { CompareCards, DArrow, DIAGRAM as D, DLink, DNode, DPill, DiagramFrame, DiagramSvg, FailureSignatures, FieldTable, Glossary, GuideSection, Misconceptions, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { ExplainIt, KnowledgeQuiz, PracticeBridge, type KnowledgeQuestion } from "@/components/lesson/GuideInteractive";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import { PresentationBridge } from "@/components/presentation/LessonPresentation";
import { CliPanel, FailureWalk } from "@/components/lesson/GuideCli";
import { createFaNet, faApply, faTicket, faTicketState, type FaAction, type FaR, type FaRtr, type FaState, type FaTicketId } from "@/lib/sim-engine/scenarios/faNet";
import { FaResult, faBlock, faOnly } from "./LessonGuideContent";

const G = { foundation: "Foundation", def: "The definition", topo: "Topologies", data: "Labels and steering", ops: "Operations", trouble: "Troubleshooting", master: "Master it" };
export const FLEX_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "fd-why", label: "Why Flexible Algorithm", group: G.foundation },
  { id: "fd-ids", label: "Algorithm numbers", group: G.foundation },
  { id: "fd-fad", label: "The FAD on the wire", group: G.def },
  { id: "fd-metrics", label: "Metric types and delay", group: G.def },
  { id: "fd-affinity", label: "Affinity rules and ASLA", group: G.def },
  { id: "fd-election", label: "FAD election", group: G.def },
  { id: "fd-participation", label: "Participation", group: G.topo },
  { id: "fd-topologies", label: "Separate logical topologies", group: G.topo },
  { id: "fd-change", label: "When the network changes", group: G.topo },
  { id: "fd-sids", label: "Algorithm-specific SIDs", group: G.data },
  { id: "fd-steering", label: "Steering traffic onto an algorithm", group: G.data },
  { id: "fd-relations", label: "Flex-Algo, SR Policy and TI-LFA", group: G.data },
  { id: "fd-config", label: "Configuring it on IOS XR", group: G.ops },
  { id: "fd-verify", label: "How to verify", group: G.ops },
  { id: "fd-signatures", label: "Failure signatures", group: G.trouble },
  { id: "fd-ladder", label: "The troubleshooting ladder", group: G.trouble },
  { id: "fd-tickets", label: "Five faults, evidence to proof", group: G.trouble },
  { id: "fd-myths", label: "Common misconceptions", group: G.master },
  { id: "fd-quiz", label: "Knowledge check", group: G.master },
  { id: "fd-explain", label: "Can you explain it?", group: G.master },
  { id: "fd-glossary", label: "Glossary", group: G.master },
  { id: "fd-mental", label: "Mental model", group: G.master },
  { id: "fd-practice", label: "Practice in the SR Flex-Algo Lab", group: G.master },
];

// Real IOS XR output and test results: the SR Flex-Algo Lab's command set and model.
const F0: FaState = createFaNet(0);
const run = (s: FaState, ...a: FaAction[]) => a.reduce((acc, x) => faApply(acc, x), s);
const set = (text: string, changes: { dev: FaR; f: (c: FaRtr) => void }[]): FaAction => ({ type: "set", text, changes });
const ticket = (id: FaTicketId) => faTicket(id).repro.reduce((acc, a) => faApply(acc, a), faTicketState(id, 1));
const T = { participation: ticket("participation"), nofad: ticket("nofad"), fadconflict: ticket("fadconflict"), sid: ticket("sid"), affinity: ticket("affinity") };
const NODELAY = run(F0, set("R5 no delay toward R6", [{ dev: "R5", f: (c) => void (c.ifs["ge-0/0/1"]!.delay = undefined) }]), { type: "ping", to: "H66" });

function LabBridge() {
  const openLab = usePracticeLabOpener();
  return (
    <PracticeBridge label="Open the SR Flex-Algo Lab" onPractice={openLab}>
      Flex-Algo 128 on IOS XR, the low-latency app, delays and affinities you can change, a second algorithm to build — your own copy. Nothing you do there changes your lesson progress.
    </PracticeBridge>
  );
}


function AffinityRulesDiagram() {
  const rows = [
    { rule: "exclude-any BLUE", ok: ["GOLD", "none"], no: ["BLUE", "BLUE+GOLD"] },
    { rule: "include-any GOLD, RED", ok: ["GOLD", "RED"], no: ["BLUE", "none"] },
    { rule: "include-all GOLD, RED", ok: ["GOLD+RED"], no: ["GOLD", "RED"] },
  ];
  return (
    <DiagramSvg h={170} label="Exclude-any removes links with any listed color; include-any keeps links with at least one; include-all keeps only links with all of them">
      {rows.map((r, i) => (
        <g key={r.rule}>
          <text x={20} y={34 + i * 48} fill={D.text} fontSize={11} fontWeight={700} fontFamily="monospace">
            {r.rule}
          </text>
          {r.ok.map((o, j) => (
            <DPill key={o} x={300 + j * 84} y={30 + i * 48} text={o} color={D.success} w={76} />
          ))}
          {r.no.map((o, j) => (
            <DPill key={o} x={480 + j * 84} y={30 + i * 48} text={o} color={D.danger} w={76} />
          ))}
        </g>
      ))}
      <text x={342} y={164} textAnchor="middle" fill={D.success} fontSize={10}>
        kept
      </text>
      <text x={522} y={164} textAnchor="middle" fill={D.danger} fontSize={10}>
        removed
      </text>
    </DiagramSvg>
  );
}

function ConsistencyDiagram() {
  return (
    <DiagramSvg h={170} label="Several routers may advertise a definition for the same algorithm; all participants must use the same winning definition, chosen by priority">
      <DNode x={110} y={40} label="Router A" sub="FAD 128 · prio 100" w={150} />
      <DNode x={110} y={120} label="Router B" sub="FAD 128 · prio 200" accent={D.success} w={150} />
      <DArrow x1={187} y1={50} x2={330} y2={78} color={D.faint} width={1.4} />
      <DArrow x1={187} y1={112} x2={330} y2={90} color={D.success} />
      <DNode x={440} y={84} label="Winning FAD 128" sub="everyone uses this one" accent={D.success} w={200} />
      <text x={320} y={160} textAnchor="middle" fill={D.muted} fontSize={10}>
        the lesson advertises one identical FAD 128 everywhere, so no conflict is exercised
      </text>
    </DiagramSvg>
  );
}

function ParticipationDiagram() {
  return (
    <DiagramSvg h={150} label="A router that does not participate in an algorithm is removed from that algorithm's topology together with all its links">
      <DNode x={80} y={60} label="A" sub="participates" w={100} />
      <DNode x={320} y={60} label="B" sub="not in 128" accent={D.danger} w={110} />
      <DNode x={560} y={60} label="C" sub="participates" w={100} />
      <DLink x1={130} y1={60} x2={265} y2={60} color={D.danger} dashed />
      <DLink x1={375} y1={60} x2={510} y2={60} color={D.danger} dashed />
      <text x={320} y={120} textAnchor="middle" fill={D.muted} fontSize={10}>
        B still forwards Algorithm 0, but offers no path for Algorithm 128
      </text>
    </DiagramSvg>
  );
}

function SidMappingDiagram() {
  return (
    <DiagramSvg h={160} label="One prefix can carry one Prefix-SID per algorithm; each maps to its own label and its own forwarding entry">
      <DNode x={110} y={80} label="prefix P" sub="one IGP prefix" accent={D.mpls} w={140} />
      <DArrow x1={182} y1={70} x2={318} y2={36} color={D.success} />
      <DArrow x1={182} y1={90} x2={318} y2={124} color={D.violet} />
      <DNode x={420} y={36} label="SID for Algo 0" sub="default SPF entry" accent={D.success} w={170} />
      <DNode x={420} y={124} label="SID for Algo 128" sub="FAD-128 SPF entry" accent={D.violet} w={170} />
    </DiagramSvg>
  );
}

function TopologiesDiagram() {
  return (
    <DiagramSvg h={150} label="The physical network produces one topology per algorithm; each algorithm's SPF runs only on its own eligible links and participants">
      <DNode x={100} y={75} label="Physical" sub="all links" w={130} />
      <DArrow x1={167} y1={66} x2={310} y2={36} color={D.success} />
      <DArrow x1={167} y1={84} x2={310} y2={114} color={D.violet} />
      <DNode x={400} y={36} label="Algo 0 topology" sub="IGP metric" accent={D.success} w={170} />
      <DNode x={400} y={114} label="Algo 128 topology" sub="delay, BLUE removed" accent={D.violet} w={170} />
      <text x={600} y={40} textAnchor="end" fill={D.muted} fontSize={9.5}>
        SPF
      </text>
      <text x={600} y={118} textAnchor="end" fill={D.muted} fontSize={9.5}>
        SPF
      </text>
    </DiagramSvg>
  );
}


const QUIZ: KnowledgeQuestion[] = [
  {
    id: "q-algo0",
    prompt: "What is algorithm 0?",
    options: [
      { id: "a", label: "The default SPF on the IGP metric that every router runs" },
      { id: "b", label: "Flex-Algo number 0" },
      { id: "c", label: "Strict SPF" },
    ],
    correctId: "a",
    explanation: "Algorithm 0 is plain SPF; 1 is strict SPF; 128–255 are flexible algorithms.",
  },
  {
    id: "q-affinity",
    prompt: "A FAD excludes BLUE. What happens to a BLUE link in that algorithm?",
    options: [
      { id: "a", label: "It is removed from the algorithm's topology" },
      { id: "b", label: "It gets a higher cost" },
      { id: "c", label: "It is used only as a backup" },
    ],
    correctId: "a",
    explanation: "Affinity decides eligibility; the metric type decides cost among eligible links.",
  },
  {
    id: "q-election",
    prompt: "R1 advertises FAD 128 with priority 100, R6 with priority 200. Which one is used?",
    options: [
      { id: "a", label: "R6's, by every participant" },
      { id: "b", label: "Each router uses its own" },
      { id: "c", label: "R1's, because it was first" },
    ],
    correctId: "a",
    explanation: "Highest priority, then highest system-id; all participants must agree.",
  },
  {
    id: "q-part",
    prompt: "R3 stops participating in 128. What happens to algorithm-128 paths through R3?",
    options: [
      { id: "a", label: "R3 and its links leave algorithm 128's topology" },
      { id: "b", label: "R3 forwards algorithm-128 traffic on algorithm 0" },
      { id: "c", label: "Nothing — participation only affects the definition" },
    ],
    correctId: "a",
    explanation: "Non-participants are pruned; paths must find another way or fail.",
  },
  {
    id: "q-delay",
    prompt: "A delay-based algorithm and a link with no advertised delay:",
    options: [
      { id: "a", label: "The link is not used by that algorithm" },
      { id: "b", label: "The link counts as delay 0" },
      { id: "c", label: "The IGP metric is used instead" },
    ],
    correctId: "a",
    explanation: "Without the metric the algorithm needs, the link is excluded.",
  },
  {
    id: "q-sid",
    prompt: "How does a packet tell R3 to use algorithm 128 toward R6?",
    options: [
      { id: "a", label: "By carrying R6's algorithm-128 prefix SID (16106)" },
      { id: "b", label: "By a TLV in the IP header" },
      { id: "c", label: "R3 decides by DSCP" },
    ],
    correctId: "a",
    explanation: "The label itself selects the algorithm.",
  },
];

export function FlexAlgoDeepDiveContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="fd-why" eyebrow="Foundation" title="Why Flexible Algorithm" tone="mpls">
        <p>An IGP computes one best path per destination, on one metric. Operators have long wanted more: a low-latency plane for some services, a plane that avoids certain links or regions, disjoint planes for dual-homed services. Before Flex-Algo the tools were RSVP-TE tunnels or SR policies with explicit or headend-computed paths — state on headends, per destination. <b className="text-pv-text">Flexible Algorithm</b> (RFC 9350) lets the IGP compute additional topologies with their own constraints, and gives every prefix a label per topology. The network itself provides the planes; any headend can use them with one label.</p>
        <DiagramFrame caption="One physical network, one logical topology per algorithm.">
          <TopologiesDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="fd-ids" eyebrow="Foundation" title="Algorithm numbers" tone="cyan">
        <FieldTable
          title="IGP algorithm values (IANA)"
          accent="cyan"
          columns={["Value", "Meaning"]}
          rows={[
            ["0", "SPF on the IGP metric — the default every router runs"],
            ["1", "Strict SPF — like 0, but the path must not be altered by local policy"],
            ["128–255", "Flexible algorithms, defined by a FAD"],
          ]}
        />
        <p>A Flex-Algo number has no meaning by itself: 128 means whatever the winning definition says. It is unrelated to SR policy colors, even when operators choose to use the same number for both, as this lab does (color 128 steers onto algorithm 128 by policy, not by numbering).</p>
      </GuideSection>

      <GuideSection id="fd-fad" eyebrow="The definition" title="The FAD on the wire" tone="violet">
        <p>In IS-IS the definition travels in the Router Capability TLV as the <b className="text-pv-text">FAD sub-TLV</b> (type 26): algorithm, metric type, calculation type (0 = SPF) and priority, with nested sub-TLVs for exclude-any, include-any and include-all admin groups, and flags. Each participant also lists the algorithm in its SR-Algorithm sub-TLV.</p>
        <CliPanel run={faBlock(F0, "R2", "show isis database verbose R1.00-00", /Router Cap/, /^  Metric:/)} caption="IOS XR · R2 reading R1's LSP — algorithm 128 listed, its definition (metric type 1 = delay, priority 100, exclude 0x1)" />
      </GuideSection>

      <GuideSection id="fd-metrics" eyebrow="The definition" title="Metric types and delay" tone="mpls">
        <FieldTable
          title="FAD metric types"
          accent="mpls"
          columns={["Value", "Metric", "Where it comes from"]}
          rows={[
            ["0", "IGP metric", "the interface metric"],
            ["1", "Min unidirectional link delay (µs)", "RFC 8570 delay, measured (TWAMP) or static"],
            ["2", "TE default metric", "the link's TE metric"],
          ]}
        />
        <p>On IOS XR, link delay is produced by <Mono>performance-measurement</Mono>: dynamic measurement with probes, or a static <Mono>advertise-delay</Mono> per interface (used in this lab). It is advertised in Application-Specific Link Attributes. A delay algorithm ignores links that advertise no delay:</p>
        <FaResult s={NODELAY} title="The lab: R5 stops advertising delay toward R6" />
      </GuideSection>

      <GuideSection id="fd-affinity" eyebrow="The definition" title="Affinity rules and ASLA" tone="warning">
        <DiagramFrame caption="Exclude-any, include-any, include-all.">
          <AffinityRulesDiagram />
        </DiagramFrame>
        <p>Links carry administrative groups (affinities) — here BLUE (bit 0) and GOLD (bit 1). For Flex-Algo, IS-IS advertises them per application in the <b className="text-pv-text">Application-Specific Link Attributes</b> (RFC 8919) with the Flex-Algo application bit, so they can differ from what RSVP-TE uses. On IOS XR: <Mono>affinity-map BLUE bit-position 0</Mono> once, then <Mono>affinity flex-algo BLUE</Mono> under each IS-IS interface. Each router advertises only its own side of a link; the rules are checked on the direction being used.</p>
      </GuideSection>

      <GuideSection id="fd-election" eyebrow="The definition" title="FAD election" tone="danger">
        <DiagramFrame caption="Several advertisers, one winner, used by all.">
          <ConsistencyDiagram />
        </DiagramFrame>
        <p>Only routers with <Mono>advertise-definition</Mono> send a FAD. Among them the highest priority wins; a tie goes to the highest system-id. Every participant computes with the winner — its own local definition doesn&apos;t matter unless it wins. If nobody advertises a definition, the algorithm is disabled everywhere.</p>
        <CliPanel run={faOnly(T.fadconflict, "R1", "show isis flex-algo 128", /Definition|Disabled|Local Priority/)} caption="IOS XR · R1 — R6's definition won: priority 200, IGP, not equal to local" />
      </GuideSection>

      <GuideSection id="fd-participation" eyebrow="Topologies" title="Participation" tone="warning">
        <DiagramFrame caption="A non-participant leaves the topology with its links.">
          <ParticipationDiagram />
        </DiagramFrame>
        <p>A router participates in algorithm N when it is configured for N; it advertises N in its SR-Algorithm sub-TLV. When computing N, a router includes only participants — both ends of a link must participate. Participation must also cover forwarding: a router on the path that doesn&apos;t participate would receive an algorithm-N label it has no entry for.</p>
      </GuideSection>

      <GuideSection id="fd-topologies" eyebrow="Topologies" title="Separate logical topologies" tone="mpls">
        <p>Each algorithm is its own SPF over its own eligible graph. In this network: algorithm 0 uses all seven links on the IGP metric; algorithm 128 uses four (no BLUE) on delay. R2 is a participant without a single eligible link — reachable in algorithm 0, isolated in 128.</p>
        <CliPanel run={faOnly(F0, "R1", "show isis segment-routing label table", /Label|----|algo 128|^1600[2-6]/)} caption="IOS XR · R1 — algorithm-0 labels for everyone, algorithm-128 labels for R3–R6 only (R2 is cut off)" />
      </GuideSection>

      <GuideSection id="fd-change" eyebrow="Topologies" title="When the network changes" tone="cyan">
        <p>Every participant reruns the algorithm whenever the LSDB changes: a link failure, a delay update, an affinity change, a new definition. The algorithm ID and the SIDs stay; the paths are recomputed. That is the point — and also why a changed definition or a wrong attribute silently moves traffic.</p>
      </GuideSection>

      <GuideSection id="fd-sids" eyebrow="Labels and steering" title="Algorithm-specific SIDs" tone="violet">
        <DiagramFrame caption="One prefix, one SID per algorithm.">
          <SidMappingDiagram />
        </DiagramFrame>
        <p>A prefix may carry one Prefix-SID per algorithm (the Prefix-SID sub-TLV has an algorithm field). Each must have its own index, unique across the domain — this lab uses 100 × k + router number (R6: 6, 106, 206). Each router installs each algorithm&apos;s SIDs along that algorithm&apos;s tree, with the same swap-and-pop rules as algorithm 0.</p>
        <CliPanel run={faOnly(F0, "R3", "show mpls forwarding", /Local|Label  |----|^1610[3-6]/)} caption="IOS XR · R3 — its algorithm-128 entries: 16106 toward R5" />
      </GuideSection>

      <GuideSection id="fd-steering" eyebrow="Labels and steering" title="Steering traffic onto an algorithm" tone="cyan">
        <FieldTable
          title="Ways to put traffic on algorithm 128"
          accent="cyan"
          columns={["Method", "How"]}
          rows={[
            ["SR policy with sid-algorithm", "dynamic candidate with constraint segments sid-algorithm 128 — resolves to algorithm-128 SIDs (this lab)"],
            ["ODN", "on-demand policies created from a template when a colored route appears"],
            ["Explicit labels", "push the algorithm prefix SID directly (the lab's label probe)"],
            ["Per-algorithm services", "some platforms map a VRF or a BGP next hop to an algorithm"],
          ]}
        />
        <CliPanel run={faOnly(F0, "R1", "show cef 192.168.66.0/24", /^192|via|labels imposed/)} caption="IOS XR · R1 — H66's prefix via the policy, 16106 imposed toward R3" />
      </GuideSection>

      <GuideSection id="fd-relations" eyebrow="Labels and steering" title="Flex-Algo, SR Policy and TI-LFA" tone="violet">
        <CompareCards
          items={[
            { title: "SR Policy alone", tone: "warning", tag: "headend", points: ["path computed by the headend", "label stack per path"] },
            { title: "Flex-Algo alone", tone: "mpls", tag: "distributed", points: ["path computed by every participant", "one label per destination"] },
            { title: "Together", tone: "violet", tag: "best of both", points: ["policy picks the intent and the algorithm", "Flex-Algo provides the path"] },
          ]}
        />
        <p>TI-LFA also works per algorithm: a backup for an algorithm-128 prefix must stay inside algorithm 128&apos;s topology and use algorithm-128 SIDs, otherwise a repair would drag low-latency traffic onto BLUE links. Implementations compute TI-LFA per algorithm.</p>
      </GuideSection>

      <GuideSection id="fd-config" eyebrow="Operations" title="Configuring it on IOS XR" tone="mpls">
        <CliPanel run={faOnly(F0, "R1", "show running-config", /router isis|affinity-map|flex-algo|priority|metric-type|advertise-definition|affinity |prefix-sid|performance-measurement|delay-measurement|advertise-delay|sid-algorithm/)} caption="IOS XR · R1 — definition, affinities, algorithm SID, delay, policy constraint" />
        <FieldTable
          title="The statements"
          accent="mpls"
          columns={["Statement", "Where", "Effect"]}
          rows={[
            [<Mono key="1">flex-algo 128</Mono>, "router isis", "participate in algorithm 128"],
            [<Mono key="2">metric-type delay · priority 100 · affinity exclude-any BLUE</Mono>, "flex-algo 128", "the local definition"],
            [<Mono key="3">advertise-definition</Mono>, "flex-algo 128", "offer the local definition for election"],
            [<Mono key="4">affinity-map BLUE bit-position 0</Mono>, "router isis", "name an affinity bit"],
            [<Mono key="5">affinity flex-algo BLUE</Mono>, "router isis → interface", "tag the link for Flex-Algo (ASLA)"],
            [<Mono key="6">prefix-sid algorithm 128 index 106</Mono>, "interface Loopback0 → address-family", "the algorithm-128 prefix SID"],
            [<Mono key="7">advertise-delay 30000</Mono>, "performance-measurement → interface → delay-measurement", "static link delay in µs"],
          ]}
        />
      </GuideSection>

      <GuideSection id="fd-verify" eyebrow="Operations" title="How to verify" tone="success">
        <FieldTable
          title="Verification on IOS XR"
          accent="success"
          columns={["Question", "Command"]}
          rows={[
            ["Winning definition, local state", <Mono key="1">show isis flex-algo 128</Mono>],
            ["Participation, SIDs, delays, affinities", <Mono key="2">show isis database verbose</Mono>],
            ["Programmed labels per algorithm", <Mono key="3">show isis segment-routing label table · show mpls forwarding</Mono>],
            ["Delay advertised", <Mono key="4">show performance-measurement interfaces</Mono>],
            ["Steering", <Mono key="5">show segment-routing traffic-eng policy · show cef &lt;prefix&gt;</Mono>],
          ]}
        />
        <CliPanel run={faOnly(F0, "R1", "show performance-measurement interfaces", /Interface Name|Advertised delay/)} caption="IOS XR · R1 — 30 ms toward R2, 5 ms toward R3" />
      </GuideSection>

      <GuideSection id="fd-signatures" eyebrow="Troubleshooting" title="Failure signatures" tone="danger">
        <FailureSignatures
          items={[
            { tag: "PART", title: "Router out of the algorithm", tone: "danger", points: ["policy down: no path", "app on algorithm 0"] },
            { tag: "FAD", title: "No definition", tone: "danger", points: ["Definition: none received", "algorithm disabled"] },
            { tag: "PRIO", title: "Wrong definition won", tone: "warning", points: ["policy up, 16106", "wrong path"] },
            { tag: "SID", title: "No algorithm SID", tone: "violet", points: ["no 16106", "policy down"] },
            { tag: "AFF", title: "Wrong affinity", tone: "warning", points: ["link excluded", "path broken or moved"] },
            { tag: "DLY", title: "No delay advertised", tone: "warning", points: ["link excluded from delay algorithms"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="fd-ladder" eyebrow="Troubleshooting" title="The troubleshooting ladder" tone="danger">
        <TroubleshootingFlow
          steps={[
            { question: "Which label does the traffic get, and what latency?", look: "A ping and the headend's CEF entry." },
            { question: "Is the policy up?", look: "If not, its reason names the gap." },
            { question: "Which definition won?", look: "show isis flex-algo — source, priority, metric, rules." },
            { question: "Who participates?", look: "SR-Algorithm lists in the LSPs." },
            { question: "Does the egress advertise its algorithm SID?", look: "Prefix-SID with Algorithm:128." },
            { question: "Do the links on the path qualify?", look: "Affinities and delay in ASLA." },
          ]}
        />
      </GuideSection>

      <GuideSection id="fd-tickets" eyebrow="Troubleshooting" title="Five faults, evidence to proof" tone="danger">
        <FailureWalk
          title="1 · A router left the algorithm"
          normal="All six routers participate in Flex-Algo 128."
          change="R3 lost flex-algo 128 in a software upgrade."
          evidence={<CliPanel run={faOnly(T.participation, "R1", "show segment-routing traffic-eng policy", /Operational|Reason/)} caption="IOS XR · R1 — LOW-LATENCY down: no path to R6 in algorithm 128" />}
          next="Every non-BLUE way to R6 crosses R3; without it, R1 has no algorithm-128 path."
          fix={<Mono>R3: router isis CORE → flex-algo 128 → commit</Mono>}
          proof="Policy up, [16106]; a fresh ping to H66: 15 ms."
        />
        <FailureWalk
          title="2 · Nobody defines it"
          normal="R1 advertises the definition."
          change="R1's template lost advertise-definition."
          evidence={<CliPanel run={faOnly(T.nofad, "R2", "show isis flex-algo 128", /Definition|Disabled/)} caption="IOS XR · R2 — Definition: none received, disabled" />}
          next="Participation without a definition computes nothing."
          fix={<Mono>R1: router isis CORE → flex-algo 128 → advertise-definition → commit</Mono>}
          proof="A definition from R1.00; a fresh ping to H66: 15 ms."
        />
        <FailureWalk
          title="3 · The wrong definition won"
          normal="Only R1 advertises a definition."
          change="R6 still advertises a test definition: priority 200, IGP, no exclusion."
          evidence={<FaResult s={T.fadconflict} title="The lab: H1 → H66" />}
          next="Policy up, 16106 pushed — but algorithm 128 now means IGP over every link."
          fix={<Mono>R6: flex-algo 128 → no advertise-definition (and match R1&apos;s rules) → commit</Mono>}
          proof="show isis flex-algo 128: source R1.00, delay; H66 at 15 ms."
        />
        <FailureWalk
          title="4 · No label for R6 in 128"
          normal="R6 advertises index 106 for algorithm 128."
          change="R6 was replaced; prefix-sid algorithm 128 is missing."
          evidence={<CliPanel run={faOnly(T.sid, "R1", "show isis database verbose R6.00-00", /Prefix-SID/)} caption="IOS XR · R1 — R6's LSP carries only the algorithm-0 SID" />}
          next="The topology is fine, but no label means “R6 via 128”."
          fix={<Mono>R6: interface Loopback0 → address-family ipv4 unicast → prefix-sid algorithm 128 index 106 → commit</Mono>}
          proof="16106 on R1; policy up; H66 at 15 ms."
        />
        <FailureWalk
          title="5 · A template tagged the wrong link"
          normal="R1's link to R3 is GOLD."
          change="A template set affinity flex-algo BLUE on it."
          evidence={<CliPanel run={faOnly(T.affinity, "R1", "show running-config router isis", /interface GigabitEthernet0\/0\/0\/1|affinity flex-algo/)} caption="IOS XR · R1 — the bottom link is BLUE now" />}
          next="Excluded: R1 has no algorithm-128 exit at all."
          fix={<Mono>R1: router isis CORE → interface Gi0/0/0/1 → no affinity flex-algo → affinity flex-algo GOLD → commit</Mono>}
          proof="Policy up; H66 at 15 ms."
        />
      </GuideSection>

      <GuideSection id="fd-myths" eyebrow="Master it" title="Common misconceptions" tone="warning">
        <Misconceptions
          items={[
            { myth: "Flex-Algo 128 is a fixed path.", correction: "It is a definition; the path is recomputed from the topology." },
            { myth: "Affinity is just another cost.", correction: "It decides which links exist for the algorithm." },
            { myth: "Each router uses its own definition.", correction: "Everyone uses the elected one." },
            { myth: "Configuring flex-algo on the headend is enough.", correction: "Every router on the path must participate." },
            { myth: "Algorithm numbers are SR policy colors.", correction: "Separate spaces; a policy maps a color to an algorithm." },
            { myth: "When Flex-Algo breaks, traffic stops.", correction: "Usually it falls back to algorithm 0 — slower, not dead." },
          ]}
        />
      </GuideSection>

      <GuideSection id="fd-quiz" eyebrow="Master it" title="Knowledge check" tone="cyan">
        <KnowledgeQuiz questions={QUIZ} />
      </GuideSection>

      <GuideSection id="fd-explain" eyebrow="Master it" title="Can you explain it?" tone="violet">
        <ExplainIt
          items={[
            { q: "Why does H66 take the bottom and H6 the top?", a: "H66 is steered onto 16106 (algorithm 128: delay, no BLUE); H6 uses 16006 (algorithm 0: IGP metric)." },
            { q: "Why has R1 no label 16102?", a: "R2 participates but all its links are BLUE: it is isolated in algorithm 128." },
            { q: "How can the policy be up and the app still slow?", a: "A different definition won the election; 16106 follows it faithfully." },
            { q: "What does R3 leaving 128 break, and why only for H66?", a: "Algorithm 128 loses its only non-BLUE transit; algorithm 0 is untouched." },
            { q: "Why do link delays need to be advertised?", a: "A delay algorithm can only cost links that carry a delay; others are left out." },
          ]}
        />
      </GuideSection>

      <GuideSection id="fd-glossary" eyebrow="Master it" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "Flex-Algo", def: "IGP algorithm 128–255 defined by a FAD (RFC 9350)." },
            { term: "FAD", def: "Flex-Algo Definition: metric type, calculation type, priority, affinity rules." },
            { term: "ASLA", def: "Application-Specific Link Attributes (RFC 8919): per-application link affinities, delay, etc." },
            { term: "Admin group / affinity", def: "A bit (named color) on a link." },
            { term: "SR-Algorithm sub-TLV", def: "The algorithms a router participates in." },
            { term: "Algorithm prefix SID", def: "A prefix SID bound to one algorithm." },
            { term: "Performance measurement", def: "IOS XR's link delay measurement (dynamic or static) feeding the IGP." },
          ]}
        />
      </GuideSection>

      <GuideSection id="fd-mental" eyebrow="Master it" title="Mental model" tone="violet">
        <p>The IGP publishes several route planners on one map. A notice says how each planner works; the most authoritative notice wins; companies that sign up run it themselves; parcels carry a sticker naming planner and destination. Planners are rules, not routes — change the map and the routes follow.</p>
      </GuideSection>

      <GuideSection id="fd-practice" eyebrow="Master it" title="Practice in the SR Flex-Algo Lab" tone="violet">
        <p>Six Learn levels, then the workspace: every router&apos;s Flex-Algo state and links, an IOS XR console, pings with latency, label probes, five challenges and the five tickets above.</p>
        <LabBridge />
        <PresentationBridge>Rewatch the SR Flex-Algo presentation.</PresentationBridge>
      </GuideSection>
    </div>
  );
}
