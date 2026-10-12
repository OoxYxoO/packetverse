import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DLink, DNode, DPill, DiagramFrame, DiagramSvg, FailureSignatures, FieldTable, Glossary, GuideSection, Misconceptions, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { DStack } from "@/components/lesson/MplsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { ExplainIt, KnowledgeQuiz, PracticeBridge, type KnowledgeQuestion } from "@/components/lesson/GuideInteractive";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import { PresentationBridge } from "@/components/presentation/LessonPresentation";
import { CliPair, CliPanel, FailureWalk } from "@/components/lesson/GuideCli";
import { srApply, srTicket, srTicketState, type SrOs, type SrTicketId } from "@/lib/sim-engine/scenarios/srNet";
import { SR0, SR0_JN, SrResult, srCli, srOnly, srSection } from "./LessonGuideContent";

const G = { foundation: "Foundation", labels: "Labels", control: "Control plane", data: "Data plane", ops: "Operations", trouble: "Troubleshooting", master: "Master it" };
export const SRF_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "sd-why", label: "Source routing, revisited", group: G.foundation },
  { id: "sd-arch", label: "The SR architecture", group: G.foundation },
  { id: "sd-sids", label: "SID types", group: G.foundation },
  { id: "sd-srgb", label: "SRGB, SRLB and labels", group: G.labels },
  { id: "sd-conflict", label: "SID conflicts", group: G.labels },
  { id: "sd-php", label: "PHP and explicit-null", group: G.labels },
  { id: "sd-isis", label: "The IS-IS extensions", group: G.control },
  { id: "sd-ospf", label: "OSPF and LDP alongside", group: G.control },
  { id: "sd-shortest", label: "Shortest path and ECMP", group: G.data },
  { id: "sd-adj", label: "Adjacency SID significance", group: G.data },
  { id: "sd-stack", label: "Stack order and the active segment", group: G.data },
  { id: "sd-msd", label: "Stack depth", group: G.data },
  { id: "sd-config", label: "Configuring it", group: G.ops },
  { id: "sd-verify", label: "How to verify", group: G.ops },
  { id: "sd-lspping", label: "LSP ping and traceroute", group: G.ops },
  { id: "sd-signatures", label: "Failure signatures", group: G.trouble },
  { id: "sd-ladder", label: "The troubleshooting ladder", group: G.trouble },
  { id: "sd-tickets", label: "Five faults, evidence to proof", group: G.trouble },
  { id: "sd-not", label: "What SR-MPLS is not", group: G.master },
  { id: "sd-myths", label: "Common misconceptions", group: G.master },
  { id: "sd-quiz", label: "Knowledge check", group: G.master },
  { id: "sd-explain", label: "Can you explain it?", group: G.master },
  { id: "sd-glossary", label: "Glossary", group: G.master },
  { id: "sd-mental", label: "Mental model", group: G.master },
  { id: "sd-practice", label: "Practice in the SR-MPLS Lab", group: G.master },
];

// Real CLI output and test results: the SR-MPLS Lab's command set and model.
const ticket = (id: SrTicketId, os: SrOs = "xr") => srTicket(id).repro.reduce((acc, a) => srApply(acc, a), srTicketState(id, 1, os));
const T = { srgb: ticket("srgb"), nosid: ticket("nosid"), srdisabled: ticket("srdisabled"), dupsid: ticket("dupsid"), metric: ticket("metric"), srgbJn: ticket("srgb", "junos") };
const R4_17000 = srApply(SR0, { type: "set", text: "R4 SRGB 17000", changes: [{ dev: "R4", f: (c) => void (c.srgb = { start: 17000, range: 8000 }) }] });

function LabBridge() {
  const openLab = usePracticeLabOpener();
  return (
    <PracticeBridge label="Open the SR-MPLS Lab" onPractice={openLab}>
      The six routers of this lesson running IS-IS with segment routing, IOS XR or Junos — your own copy. Nothing you do there changes your lesson progress.
    </PracticeBridge>
  );
}

function SourceRoutingDiagram() {
  return (
    <DiagramSvg h={190} label="The headend imposes an ordered list of segments; transit routers only act on the top segment and hold no per-path state">
      <DNode x={70} y={60} label="Headend" sub="builds list" accent={D.mpls} w={110} />
      <DNode x={320} y={60} label="Transit" sub="reads top only" w={110} />
      <DNode x={570} y={60} label="Target" sub="list done" accent={D.mpls} w={110} />
      <DArrow x1={127} y1={60} x2={263} y2={60} color={D.mpls} />
      <DArrow x1={377} y1={60} x2={513} y2={60} color={D.mpls} />
      <DStack x={195} y={94} labels={[{ text: "segment A" }, { text: "segment B" }]} payload="payload" w={96} />
      <text x={445} y={112} textAnchor="middle" fill={D.muted} fontSize={10}>
        no per-path state here
      </text>
      <text x={320} y={182} textAnchor="middle" fill={D.muted} fontSize={10}>
        the path lives in the packet header, not in signaled state along the way
      </text>
    </DiagramSvg>
  );
}

function SrgbMismatchDiagram() {
  return (
    <DiagramSvg h={170} label="With different SRGBs, the same SID index 6 maps to label 16006 at one router and 20006 at its neighbor, so the upstream router swaps to the neighbor's label">
      <DNode x={120} y={60} label="Router A" sub="SRGB 16000+" w={130} />
      <DNode x={500} y={60} label="Router B" sub="SRGB 20000+" w={130} />
      <DArrow x1={187} y1={60} x2={433} y2={60} color={D.mpls} />
      <DPill x={310} y={36} text="index 6 → label 16006 at A" color={D.cyan} w={200} />
      <DPill x={310} y={86} text="A sends 20006 (B's label for index 6)" color={D.warning} w={250} />
      <text x={320} y={140} textAnchor="middle" fill={D.muted} fontSize={10}>
        the index is global; the label is local to each router&apos;s SRGB
      </text>
      <text x={320} y={158} textAnchor="middle" fill={D.muted} fontSize={10}>
        identical SRGBs (as in the lesson) simply make the label look the same everywhere
      </text>
    </DiagramSvg>
  );
}

function EcmpDiagram() {
  return (
    <DiagramSvg h={170} label="A Node SID follows all equal-cost shortest paths, so traffic can be spread over two equal paths">
      <DNode x={70} y={85} label="A" w={60} h={32} />
      <DNode x={320} y={35} label="B" w={60} h={32} />
      <DNode x={320} y={135} label="C" w={60} h={32} />
      <DNode x={570} y={85} label="Z" w={60} h={32} accent={D.mpls} />
      <DLink x1={100} y1={78} x2={290} y2={40} color={D.success} />
      <DLink x1={100} y1={92} x2={290} y2={130} color={D.success} />
      <DLink x1={350} y1={40} x2={540} y2={78} color={D.success} />
      <DLink x1={350} y1={130} x2={540} y2={92} color={D.success} />
      <text x={190} y={46} textAnchor="end" fill={D.muted} fontSize={10} fontFamily="monospace">
        10
      </text>
      <text x={190} y={136} textAnchor="end" fill={D.muted} fontSize={10} fontFamily="monospace">
        10
      </text>
      <text x={450} y={46} fill={D.muted} fontSize={10} fontFamily="monospace">
        10
      </text>
      <text x={450} y={136} fill={D.muted} fontSize={10} fontFamily="monospace">
        10
      </text>
      <text x={320} y={92} textAnchor="middle" fill={D.success} fontSize={10.5} fontWeight={700}>
        Node SID of Z: both paths
      </text>
    </DiagramSvg>
  );
}

function AdjLocalDiagram() {
  return (
    <DiagramSvg h={160} label="Adj-SID 24035 means send over R3 to R5 only at R3; at R1 it has no forwarding meaning">
      <DNode x={90} y={60} label="R1" sub="no entry for 24035" accent={D.danger} w={140} />
      <DNode x={330} y={60} label="R3" sub="owner of 24035" accent={D.warning} w={130} />
      <DNode x={560} y={60} label="R5" w={80} />
      <DArrow x1={396} y1={60} x2={518} y2={60} color={D.warning} />
      <text x={457} y={48} textAnchor="middle" fill={D.warning} fontSize={10} fontWeight={700}>
        24035
      </text>
      <text x={320} y={120} textAnchor="middle" fill={D.muted} fontSize={10}>
        an ordinary Adj-SID is executable only by the router that owns the adjacency
      </text>
      <text x={320} y={140} textAnchor="middle" fill={D.muted} fontSize={10}>
        so a list must first reach the owner (with a Node SID) before its Adj-SID becomes active
      </text>
    </DiagramSvg>
  );
}

function StackOrderDiagram() {
  return (
    <DiagramSvg h={170} label="The top label is the active segment and has S=0; the last label is the bottom of stack with S=1">
      <DStack x={190} y={24} labels={[{ text: "SID A  S0", tag: "TOP / ACTIVE", color: D.warning }, { text: "SID B  S0" }, { text: "SID C  S1", tag: "BOTTOM / LAST" }]} payload="payload" w={110} />
      <text x={330} y={40} fill={D.text} fontSize={10.5}>
        only the top SID is acted on
      </text>
      <text x={330} y={64} fill={D.text} fontSize={10.5}>
        completing it exposes the next one
      </text>
      <text x={330} y={88} fill={D.text} fontSize={10.5}>
        exactly one label has S=1: the last
      </text>
      <text x={330} y={112} fill={D.text} fontSize={10.5}>
        push keeps it; pop never rewrites it
      </text>
      <text x={320} y={160} textAnchor="middle" fill={D.muted} fontSize={10}>
        list order = stack order, first segment on top
      </text>
    </DiagramSvg>
  );
}

function PhpDiagram() {
  return (
    <DiagramSvg h={190} label="With implicit-null the penultimate hop pops the target's label; with explicit-null the target receives label 0 and pops it itself">
      <text x={20} y={30} fill={D.success} fontSize={11} fontWeight={700}>
        implicit-null (PHP)
      </text>
      <DNode x={250} y={30} label="P" w={60} h={30} />
      <DNode x={520} y={30} label="Target" w={80} h={30} accent={D.mpls} />
      <DArrow x1={282} y1={30} x2={478} y2={30} color={D.success} />
      <text x={380} y={20} textAnchor="middle" fill={D.success} fontSize={10}>
        plain payload
      </text>
      <text x={20} y={112} fill={D.warning} fontSize={11} fontWeight={700}>
        explicit-null
      </text>
      <DNode x={250} y={112} label="P" w={60} h={30} />
      <DNode x={520} y={112} label="Target" w={80} h={30} accent={D.mpls} />
      <DArrow x1={282} y1={112} x2={478} y2={112} color={D.warning} />
      <text x={380} y={102} textAnchor="middle" fill={D.warning} fontSize={10}>
        label 0 kept (e.g. for QoS bits)
      </text>
      <text x={320} y={176} textAnchor="middle" fill={D.muted} fontSize={10}>
        the target chooses by what it advertises; the lesson models implicit-null
      </text>
    </DiagramSvg>
  );
}


const QUIZ: KnowledgeQuestion[] = [
  {
    id: "q-label",
    prompt: "R6 advertises Prefix-SID index 6. R4's SRGB starts at 17000. Which label does R2 swap 16006 to when forwarding toward R6 via R4?",
    options: [
      { id: "a", label: "17006 — R4's SRGB start plus the index" },
      { id: "b", label: "16006 — SR labels never change" },
      { id: "c", label: "6" },
    ],
    correctId: "a",
    explanation: "The outgoing label always comes from the next hop's SRGB. The index is global; the label is local arithmetic.",
  },
  {
    id: "q-metric",
    prompt: "A metric change makes the bottom path shortest. What must R1 change in the packets it sends with 16006?",
    options: [
      { id: "a", label: "Nothing — the label stays 16006; only the outgoing interface changes" },
      { id: "b", label: "It must re-signal the path" },
      { id: "c", label: "It must push 16003 and 16005 too" },
    ],
    correctId: "a",
    explanation: "A Node SID follows the IGP. Every router recomputes its next hop; no signaling is involved.",
  },
  {
    id: "q-adj",
    prompt: "Where can R3's Adjacency SID toward R5 be the top label?",
    options: [
      { id: "a", label: "Only at R3" },
      { id: "b", label: "At any router — it is advertised in IS-IS" },
      { id: "c", label: "At R3 and R5" },
    ],
    correctId: "a",
    explanation: "Adjacency SIDs are local: advertised so the headend can use them, executed only by their owner.",
  },
  {
    id: "q-php",
    prompt: "Which router removes 16006 on the shortest path R1 → R2 → R4 → R6?",
    options: [
      { id: "a", label: "R4, the penultimate hop" },
      { id: "b", label: "R6" },
      { id: "c", label: "R2" },
    ],
    correctId: "a",
    explanation: "Without the P-flag (no-PHP) or E-flag (explicit-null), the hop before the owner pops the Node SID.",
  },
  {
    id: "q-bgp",
    prompt: "R4 has no segment routing. Why does H1 → H6 fail although every loopback is reachable?",
    options: [
      { id: "a", label: "R2 can't label toward R4, so the packet reaches R4 as plain IP — and R4 has no BGP route to 192.168.6.0/24" },
      { id: "b", label: "IS-IS can't run without segment routing" },
      { id: "c", label: "R1 drops the packet because R4 has no SRGB" },
    ],
    correctId: "a",
    explanation: "In a BGP-free core, customer traffic must stay labeled to the egress. IS-IS reachability alone isn't enough.",
  },
];

export function SrFoundationsDeepDiveContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="sd-why" eyebrow="Foundation" title="Source routing, revisited" tone="mpls">
        <DiagramFrame caption="The headend encodes the path; the core executes it without remembering it.">
          <SourceRoutingDiagram />
        </DiagramFrame>
        <p>Source routing is old: the sender lists the hops. What made it impractical was carrying and processing that list. Segment routing (RFC 8402) makes it practical by reusing a forwarding plane that already exists — an MPLS label stack (RFC 8660) or an IPv6 header — and by distributing the segments in the IGP every router already runs. The core keeps one label table, however many paths cross it.</p>
      </GuideSection>

      <GuideSection id="sd-arch" eyebrow="Foundation" title="The SR architecture" tone="mpls">
        <CompareCards
          items={[
            { title: "Control plane", tone: "ospf", tag: "IGP", points: ["IS-IS (RFC 8667) or OSPF (RFC 8665)", "SRGB, Prefix-SIDs, Adj-SIDs in the LSDB"] },
            { title: "Data plane", tone: "mpls", tag: "MPLS", points: ["one segment = one label", "push, swap (CONTINUE), pop (NEXT)"] },
            { title: "Headend", tone: "violet", tag: "policy", points: ["chooses the segment list", "this lesson: one Node SID or a short list"] },
          ]}
        />
        <p>RFC 8402 names the three data-plane operations: <b className="text-pv-text">PUSH</b> a segment, <b className="text-pv-text">CONTINUE</b> the active segment (an MPLS swap), and <b className="text-pv-text">NEXT</b> — the active segment is complete, move to the next one (an MPLS pop).</p>
      </GuideSection>

      <GuideSection id="sd-sids" eyebrow="Foundation" title="SID types" tone="violet">
        <FieldTable
          title="Segments you will meet"
          accent="violet"
          columns={["SID", "Scope", "Meaning", "Where"]}
          rows={[
            ["Prefix-SID", "global", "reach this prefix by the shortest path", "this lesson"],
            ["Node SID", "global", "a Prefix-SID on a router's loopback (N-flag)", "this lesson"],
            ["Anycast SID", "global", "a Prefix-SID shared by several routers: reach the closest", "—"],
            ["Adjacency SID", "local", "pop and send out of this adjacency", "this lesson"],
            ["BGP Peer SIDs", "local", "egress peer engineering: use this BGP peer or link", "—"],
            ["Binding SID", "local", "stands for a whole SR Policy", "next lesson"],
          ]}
        />
      </GuideSection>

      <GuideSection id="sd-srgb" eyebrow="Labels" title="SRGB, SRLB and labels" tone="mpls">
        <DiagramFrame caption="Different SRGBs: the same index, different labels per hop.">
          <SrgbMismatchDiagram />
        </DiagramFrame>
        <p>Global segments are advertised as an <b className="text-pv-text">index</b>; each router maps it into its own SRGB. When two neighbors have different SRGBs, the sender always uses the <b className="text-pv-text">next hop&apos;s</b> label. Local segments — Adjacency SIDs — come from the dynamic label range or from an <b className="text-pv-text">SRLB</b> (Segment Routing Local Block; IOS XR&apos;s default is 15000–15999). Operators keep SRGBs identical so labels read the same everywhere.</p>
        <CliPanel run={srOnly(R4_17000, "R2", "cisco", "show mpls forwarding", /Local|Label  |----|^16006|^16004/)} caption="IOS XR · R2 with R4's SRGB at 17000 — 16006 swapped to 17006" />
      </GuideSection>

      <GuideSection id="sd-conflict" eyebrow="Labels" title="SID conflicts" tone="danger">
        <p>Two prefixes claiming one index is a <b className="text-pv-text">SID conflict</b>. RFC 8660 defines how every router resolves it the same way — its tie-breaks end with the numerically smaller prefix — so the network stays consistent, but one prefix loses its SID. In the lab, R5 claiming index 6 wins over R6: 16006 now leads to R5, and R6&apos;s loopback has no label.</p>
        <CliPanel run={srOnly(T.dupsid, "R1", "cisco", "show isis database verbose", /^R5\.00|^R6\.00|IP-Extended 10\.0\.0\.[56]|Prefix-SID Index: 6/)} caption="IOS XR · R1 — both R5 and R6 advertise index 6" />
        <CliPanel run={srOnly(T.dupsid, "R1", "cisco", "show isis segment-routing label table", /Label|----|^1600[56]/)} caption="IOS XR · R1 — 16006 now means 10.0.0.5; nothing for 10.0.0.6" />
      </GuideSection>

      <GuideSection id="sd-php" eyebrow="Labels" title="PHP and explicit-null" tone="mpls">
        <DiagramFrame caption="Who removes the Node SID.">
          <PhpDiagram />
        </DiagramFrame>
        <p>The Prefix-SID carries flags. Without the <Mono>P</Mono>-flag (no-PHP), the penultimate hop pops the label; with <Mono>P</Mono> set and the <Mono>E</Mono>-flag (explicit-null), it swaps to label 0 so the egress still sees the traffic class bits. The lab advertises <Mono>N:1 P:0 E:0</Mono>: a node SID, popped by the penultimate hop.</p>
      </GuideSection>

      <GuideSection id="sd-isis" eyebrow="Control plane" title="The IS-IS extensions" tone="ospf">
        <FieldTable
          title="Where IS-IS carries segment routing (RFC 8667)"
          accent="ospf"
          columns={["What", "Carried in"]}
          rows={[
            ["SRGB (SR-Capabilities)", "Router Capability TLV 242, sub-TLV 2"],
            ["Algorithms (SPF = 0)", "Router Capability TLV 242, sub-TLV 19"],
            ["SRLB", "Router Capability TLV 242, sub-TLV 22"],
            ["Prefix-SID", "sub-TLV 3 of the prefix TLVs (135, 235, 236, 237)"],
            ["Adjacency SID", "sub-TLV 31 (point-to-point) or 32 (LAN) of the neighbor TLVs (22, 222, 23, 223)"],
          ]}
        />
        <CliPair cisco={srSection(SR0, "R1", "cisco", "show isis database verbose", /^R3\.00-00/)} junos={srSection(SR0_JN, "R1", "juniper", "show isis database extensive", /^R3\.00-00/)} ciscoCaption="IOS XR · R1 — R3's LSP" junosCaption="Junos · R1 — R3's LSP" />
      </GuideSection>

      <GuideSection id="sd-ospf" eyebrow="Control plane" title="OSPF and LDP alongside" tone="ospf">
        <p>OSPF carries the same information in Opaque LSAs (RFC 8665 for OSPFv2, RFC 8666 for OSPFv3). SR and LDP can run side by side during a migration: a router prefers one label source per prefix (IOS XR <Mono>sr-prefer</Mono>), and a <b className="text-pv-text">mapping server</b> (RFC 8661) can advertise Prefix-SIDs on behalf of LDP-only routers. This lab runs SR alone.</p>
      </GuideSection>

      <GuideSection id="sd-shortest" eyebrow="Data plane" title="Shortest path and ECMP" tone="success">
        <DiagramFrame caption="With equal-cost paths, a Node SID spreads across all of them.">
          <EcmpDiagram />
        </DiagramFrame>
        <p>A Node SID uses every equal-cost path the IGP finds — load balancing comes for free. In this lesson the two paths cost 30 and 45, so there is one shortest path; make the bottom metrics 10 and 16006 would be split between R2 and R3.</p>
      </GuideSection>

      <GuideSection id="sd-adj" eyebrow="Data plane" title="Adjacency SID significance" tone="warning">
        <DiagramFrame caption="Valid at its owner, meaningless elsewhere.">
          <AdjLocalDiagram />
        </DiagramFrame>
        <p>Adjacency SIDs are advertised so the headend can build lists with them, but they are executed only by their owner. An Adjacency SID is also the way to force a link the IGP would never pick — even a non-shortest one. Because they are local, two routers may well use the same label number for different links.</p>
      </GuideSection>

      <GuideSection id="sd-stack" eyebrow="Data plane" title="Stack order and the active segment" tone="mpls">
        <DiagramFrame caption="The top label is the active segment.">
          <StackOrderDiagram />
        </DiagramFrame>
        <p>The headend pushes the list so the first segment is on top. Each router acts only on the top label: CONTINUE (swap) while the segment isn&apos;t done, NEXT (pop) when it is. A headend executes its own first segment: when the first segment ends at a neighbor, the label is popped before the packet ever leaves — which is why the packet R1 sends toward R3 carries <Mono>24035 | 16006</Mono>, not 16003.</p>
        <SrResult s={srApply(SR0, { type: "probe", stack: [16003, 24035, 16006] })} title="The lab: [16003, 24035, 16006] from R1" />
      </GuideSection>

      <GuideSection id="sd-msd" eyebrow="Data plane" title="Stack depth" tone="mpls">
        <p>Every label costs 4 bytes and every router has a limit on how many it can push or read: the <b className="text-pv-text">Maximum SID Depth</b>, advertised in the IGP (RFC 8491 for IS-IS). Short lists — a Node SID here and there, an Adjacency SID where it matters — keep stacks well within it. Long strict paths of Adjacency SIDs only are possible but costly.</p>
      </GuideSection>

      <GuideSection id="sd-config" eyebrow="Operations" title="Configuring it" tone="mpls">
        <p>On IOS XR: the SRGB under <Mono>segment-routing global-block</Mono> (optional — 16000–23999 is the default), <Mono>segment-routing mpls</Mono> under the IS-IS IPv4 address family, and <Mono>prefix-sid index N</Mono> on the loopback. On Junos: <Mono>source-packet-routing</Mono> under IS-IS with <Mono>srgb start-label … index-range …</Mono> and <Mono>node-segment ipv4-index N</Mono>, plus <Mono>family mpls</Mono> and <Mono>protocols mpls interface</Mono> on the core interfaces. Adjacency SIDs are allocated automatically on both.</p>
        <CliPair cisco={srCli(SR0, "R6", "cisco", "show running-config router isis")} junos={srCli(SR0_JN, "R6", "juniper", "show configuration protocols isis")} ciscoCaption="IOS XR · R6" junosCaption="Junos · R6" />
      </GuideSection>

      <GuideSection id="sd-verify" eyebrow="Operations" title="How to verify" tone="success">
        <FieldTable
          title="Bottom to top"
          accent="success"
          columns={["Question", "IOS XR", "Junos"]}
          rows={[
            ["IS-IS up?", <Mono key="1">show isis adjacency</Mono>, <Mono key="2">show isis adjacency</Mono>],
            ["SRGB and SIDs advertised?", <Mono key="3">show isis database verbose</Mono>, <Mono key="4">show isis database extensive</Mono>],
            ["Which Node SID labels?", <Mono key="5">show isis segment-routing label table</Mono>, <Mono key="6">show route table inet.3</Mono>],
            ["Swap, pop, Unlabelled?", <Mono key="7">show mpls forwarding</Mono>, <Mono key="8">show route table mpls.0</Mono>],
            ["Customer route labeled?", <Mono key="9">show cef 192.168.6.0/24</Mono>, <Mono key="10">show route 192.168.6.20</Mono>],
          ]}
        />
      </GuideSection>

      <GuideSection id="sd-lspping" eyebrow="Operations" title="LSP ping and traceroute" tone="success">
        <p>MPLS echo (RFC 8029) works for SR too: IOS XR <Mono>ping sr-mpls</Mono> and <Mono>traceroute sr-mpls</Mono> test a Node SID end to end and show the label at each hop. <Mono>ping sr-mpls nil-fec labels …</Mono> sends an echo with a label stack of your choice out of a chosen interface — the quickest way to test a segment list.</p>
        <CliPanel run={srCli(SR0, "R1", "cisco", "traceroute sr-mpls 10.0.0.6/32")} caption="IOS XR · R1 — 16006 swapped by R2, popped by R4" />
        <CliPanel run={srOnly(SR0, "R1", "cisco", "ping sr-mpls nil-fec labels 16003,24035,16006 output interface Gi0/0/0/1 nexthop 10.1.13.3", /Sending|!!!!!|Success/)} caption="IOS XR · R1 — the steered list, sent out toward R3" />
        <Callout tone="cyan" title="Nil FEC skips the headend" icon="i">
          With nil-fec the whole stack leaves R1 untouched: R3 receives 16003 (its own Node SID) and pops it. Sent from R1 as a policy, R1 would execute 16003 itself.
        </Callout>
      </GuideSection>

      <GuideSection id="sd-signatures" eyebrow="Troubleshooting" title="Failure signatures" tone="danger">
        <FailureSignatures
          items={[
            { tag: "SRGB", title: "SRGB too small", tone: "danger", points: ["indexes beyond the range", "no label there; XR upstream Unlabelled"] },
            { tag: "SID", title: "No Prefix-SID", tone: "danger", points: ["IS-IS route only", "Junos: BGP route hidden"] },
            { tag: "SR", title: "SR off on a router", tone: "danger", points: ["no SRGB in its LSP", "upstream can't label toward it"] },
            { tag: "DUP", title: "Duplicate index", tone: "violet", points: ["two LSPs, one index", "conflict log; one loses"] },
            { tag: "IGP", title: "Wrong metric", tone: "warning", points: ["works", "the Node SID takes the long way"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="sd-ladder" eyebrow="Troubleshooting" title="The troubleshooting ladder" tone="danger">
        <TroubleshootingFlow
          steps={[
            { question: "Where does the packet stop?", look: "The test's hop-by-hop walk or traceroute sr-mpls." },
            { question: "Is IS-IS up, and which path is shortest?", look: "Adjacencies and metrics." },
            { question: "Is every router SR-capable, with an SRGB that fits?", look: "SRGB in each LSP." },
            { question: "Does every loopback have its own index?", look: "Prefix-SIDs, conflicts." },
            { question: "Is the destination's label programmed hop by hop?", look: "Label tables: swap, pop — not Unlabelled, not missing." },
            { question: "Does the headend push it?", look: "The customer route's imposed label." },
          ]}
        />
      </GuideSection>

      <GuideSection id="sd-tickets" eyebrow="Troubleshooting" title="Five faults, evidence to proof" tone="danger">
        <FailureWalk
          title="1 · After R2's template change"
          normal="Every router's SRGB is 16000–23999."
          change="R2's template set 16000–16004 (range 5)."
          evidence={<CliPanel run={srOnly(T.srgb, "R1", "cisco", "show mpls forwarding", /Local|Label  |----|^16006/)} caption="IOS XR · R1 — 16006 Unlabelled toward R2" />}
          next="Index 6 doesn't fit R2's SRGB: R2 has no label for R6 and R1 can't send one to R2. The customer packet reaches R2 as IP and dies."
          fix={<Mono>R2: segment-routing → global-block 16000 23999 → commit</Mono>}
          proof="R2 programs 16006 again; a fresh ping from H1 reaches H6."
        />
        <FailureWalk
          title="2 · R6's loopback was re-created"
          normal="R6's loopback carries Prefix-SID index 6."
          change="The new Loopback0 has no prefix-sid."
          evidence={<CliPanel run={srOnly(T.nosid, "R1", "cisco", "show isis segment-routing label table", /Label|----|^\d/)} caption="IOS XR · R1 — no 16006" />}
          next="10.0.0.6 is reachable by IS-IS but has no label: R1 sends the customer packet as IP into a BGP-free core."
          fix={<Mono>R6: router isis CORE → interface Loopback0 → address-family ipv4 unicast → prefix-sid index 6 → commit</Mono>}
          proof="16006 back in every label table; a fresh ping from H1 reaches H6."
        />
        <FailureWalk
          title="3 · R4 came back from maintenance"
          normal="Every router runs segment-routing mpls under IS-IS."
          change="R4's backup has no segment routing."
          evidence={<CliPanel run={srOnly(T.srdisabled, "R2", "cisco", "show mpls forwarding", /Local|Label  |----|^16006/)} caption="IOS XR · R2 — 16006 Unlabelled toward R4" />}
          next="R4 advertises no SRGB; R2 can't label toward it and R4 receives IP it can't route."
          fix={<Mono>R4: router isis CORE → address-family ipv4 unicast → segment-routing mpls → commit</Mono>}
          proof="R4 programs 16006; a fresh ping from H1 reaches H6."
        />
        <FailureWalk
          title="4 · A copy-paste on R5"
          normal="Each loopback has its own index."
          change="R5's copied configuration also says prefix-sid index 6."
          evidence={<CliPanel run={srOnly(T.dupsid, "R1", "cisco", "show logging", /SID conflict|SRMS_CONFLICT/)} caption="IOS XR · R1 — the conflict in the log" />}
          next="10.0.0.5 keeps index 6; R6 has no SID, and anything sent with 16006 ends at R5."
          fix={<Mono>R5: router isis CORE → interface Loopback0 → address-family ipv4 unicast → prefix-sid index 5 → commit</Mono>}
          proof="No conflict, 16006 leads to R6; a fresh ping from H1 reaches H6."
        />
        <FailureWalk
          title="5 · Slower since the maintenance"
          normal="R1's link to R2 has metric 10: the top path is shortest."
          change="It now has metric 100."
          evidence={<CliPanel run={srOnly(T.metric, "R1", "cisco", "traceroute sr-mpls 10.0.0.6/32", /^\s*[L!]?\s*\d+ 10\./)} caption="IOS XR · R1 — 16006 now leaves toward R3" />}
          next="Nothing is broken in SR: the Node SID follows the IGP, and the IGP now prefers the bottom path."
          fix={<Mono>R1: router isis CORE → interface Gi0/0/0/0 → address-family ipv4 unicast → no metric → commit</Mono>}
          proof="R1 reaches R6 via R2 and R4; a fresh ping from H1 takes the top path."
        />
        <SrResult s={T.srgbJn} title="Junos, fault 1: what the ping reports" />
      </GuideSection>

      <GuideSection id="sd-not" eyebrow="Master it" title="What SR-MPLS is not" tone="danger">
        <ChecklistCard tone="danger" mark="✕" title="Not in this lesson — and not implied by it" items={["SR Policies, colors and Binding SIDs (next lesson)", "TI-LFA fast reroute (later)", "Flexible Algorithm (later)", "SRv6 — segments as IPv6 addresses (later)", "a replacement for the IGP: SR runs on top of it"]} />
      </GuideSection>

      <GuideSection id="sd-myths" eyebrow="Master it" title="Common misconceptions" tone="warning">
        <Misconceptions
          items={[
            { myth: "SR labels are global.", correction: "Indexes are global; labels come from each router's SRGB." },
            { myth: "A Node SID pins a path.", correction: "It follows the IGP; change a metric and it moves." },
            { myth: "Any router can execute an Adjacency SID.", correction: "Only its owner can." },
            { myth: "IS-IS reachability means traffic flows.", correction: "In a BGP-free core, customer traffic must stay labeled." },
            { myth: "Segment routing needs LDP for labels.", correction: "The IGP distributes every label; LDP is optional, for migration." },
          ]}
        />
      </GuideSection>

      <GuideSection id="sd-quiz" eyebrow="Master it" title="Knowledge check" tone="cyan">
        <KnowledgeQuiz questions={QUIZ} />
      </GuideSection>

      <GuideSection id="sd-explain" eyebrow="Master it" title="Can you explain it?" tone="violet">
        <ExplainIt
          items={[
            { q: "Where does label 16006 come from?", a: "R6 advertises index 6 for its loopback in IS-IS; every router adds it to its SRGB start, 16000." },
            { q: "Why does R2 swap 16006 to 16006?", a: "Its next hop R4 has the same SRGB, so R4's label for index 6 is also 16006." },
            { q: "Why did [24035, 16006] fail at R1?", a: "R1 had to execute 24035 first, but 24035 is R3's local Adjacency SID." },
            { q: "What does the core remember about a segment list?", a: "Nothing — the path is in the packet; the core only has its normal label table." },
            { q: "Why can a router without SR break traffic while IS-IS is fine?", a: "Upstream can't label toward it; the packet arrives as IP in a core that doesn't know the customer prefix." },
          ]}
        />
      </GuideSection>

      <GuideSection id="sd-glossary" eyebrow="Master it" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "Segment", def: "An instruction; in SR-MPLS, a label." },
            { term: "Active segment", def: "The top label: the instruction being executed." },
            { term: "SRGB", def: "Segment Routing Global Block: labels for global segments." },
            { term: "SRLB", def: "Segment Routing Local Block: labels for local segments." },
            { term: "Prefix-SID / Node SID", def: "Global segment for a prefix / for a router's loopback." },
            { term: "Adjacency SID", def: "Local segment for one adjacency." },
            { term: "PUSH / CONTINUE / NEXT", def: "RFC 8402's operations: push, swap, pop." },
            { term: "MSD", def: "Maximum SID Depth a router can impose or read." },
            { term: "Mapping server", def: "Advertises Prefix-SIDs for routers that can't (RFC 8661)." },
          ]}
        />
      </GuideSection>

      <GuideSection id="sd-mental" eyebrow="Master it" title="Mental model" tone="violet">
        <p>Two kinds of instructions, one stack. Global ones name a destination and let the IGP find the way; local ones name a link and only work where that link starts. The headend writes the stack, every router reads the top line, and nobody keeps notes.</p>
      </GuideSection>

      <GuideSection id="sd-practice" eyebrow="Master it" title="Practice in the SR-MPLS Lab" tone="violet">
        <p>Six Learn levels, then the workspace: every router&apos;s SR state, label table and console, customer pings, segment lists from R1, five challenges and the five tickets above.</p>
        <LabBridge />
        <PresentationBridge>Rewatch the SR-MPLS presentation.</PresentationBridge>
      </GuideSection>
    </div>
  );
}
