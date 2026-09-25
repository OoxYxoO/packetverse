import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DLink, DNode, DPill, DiagramFrame, DiagramSvg, FieldTable, FlowSteps, Glossary, GuideSection, Mono } from "@/components/lesson/GuideBlocks";
import { DStack } from "@/components/lesson/MplsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";

export const SRF_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "sd-what", label: "Segment Routing" },
  { id: "sd-sids", label: "SID types" },
  { id: "sd-srgb", label: "SRGB, SRLB and labels" },
  { id: "sd-igp", label: "IGP extensions" },
  { id: "sd-shortest", label: "Shortest path and ECMP" },
  { id: "sd-adj", label: "Adj-SID significance" },
  { id: "sd-stack", label: "Stack order and active SID" },
  { id: "sd-php", label: "PHP and explicit-null" },
  { id: "sd-planes", label: "Control vs data plane" },
  { id: "sd-not", label: "What SR-MPLS is not" },
  { id: "sd-trouble", label: "Troubleshooting" },
  { id: "sd-verify", label: "Verification" },
  { id: "sd-glossary", label: "Glossary" },
  { id: "sd-mental", label: "Mental model" },
];

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

export function SrFoundationsDeepDiveContent() {
  return (
    <>
      <GuideSection id="sd-what" eyebrow="Architecture" title="Segment Routing" tone="mpls">
        <DiagramFrame caption="Source routing: the list is in the packet.">
          <SourceRoutingDiagram />
        </DiagramFrame>
        <p>
          Segment Routing is a source-routing architecture: the headend encodes a path as an ordered list of segments. SR-MPLS encodes each segment as an MPLS label, so it reuses the existing MPLS data plane; SRv6 encodes them as IPv6 addresses (a later lesson).
        </p>
      </GuideSection>

      <GuideSection id="sd-sids" eyebrow="Concepts" title="SID types" tone="violet">
        <FieldTable
          title="Common SR-MPLS SIDs"
          accent="violet"
          columns={["SID", "Scope", "Meaning"]}
          rows={[
            ["Prefix-SID", "Global (SR domain)", "Reach this prefix by the shortest path"],
            ["Node SID", "Global", "A Prefix-SID for a router's own loopback"],
            ["Anycast SID", "Global", "A Prefix-SID shared by several routers — reach the nearest"],
            ["Adj-SID", "Usually local", "At the owner, use this adjacency"],
            ["Binding SID", "Local to the headend", "A handle for a policy (see SR Policy)"],
          ]}
        />
      </GuideSection>

      <GuideSection id="sd-srgb" eyebrow="Labels" title="SRGB, SRLB and labels" tone="mpls">
        <DiagramFrame caption="Index is advertised; label is derived per router.">
          <SrgbMismatchDiagram />
        </DiagramFrame>
        <p>
          The <b className="text-pv-text">SRGB</b> is the block global SIDs are taken from: label = SRGB start + index. The <b className="text-pv-text">SRLB</b> is a separate local block some implementations use for locally allocated SIDs such as Adj-SIDs; others allocate Adj-SIDs dynamically. Always check which label a router actually programmed.
        </p>
      </GuideSection>

      <GuideSection id="sd-igp" eyebrow="Control plane" title="IGP extensions" tone="ospf">
        <FlowSteps
          steps={[
            { title: "SR capability", body: "Each router advertises that it supports SR-MPLS and its SRGB range.", tone: "ospf" },
            { title: "Prefix-SID", body: "Attached to a prefix advertisement: an index plus flags such as no-PHP / explicit-null.", tone: "violet" },
            { title: "Adj-SID", body: "Attached to an adjacency: the label the owner uses for that link.", tone: "violet" },
            { title: "Local programming", body: "Each router builds its LFIB from its own SPF — nothing path-specific is signaled.", tone: "mpls" },
          ]}
        />
      </GuideSection>

      <GuideSection id="sd-shortest" eyebrow="Forwarding" title="Shortest path and ECMP" tone="success">
        <DiagramFrame caption="A Node SID follows every equal-cost shortest path.">
          <EcmpDiagram />
        </DiagramFrame>
        <p>A Node or Prefix SID never names links; it inherits whatever the IGP computes, including ECMP. That is why the path can change when a metric changes while the SID stays identical.</p>
      </GuideSection>

      <GuideSection id="sd-adj" eyebrow="Forwarding" title="Adj-SID significance" tone="warning">
        <DiagramFrame caption="Ownership decides where an Adj-SID can be executed.">
          <AdjLocalDiagram />
        </DiagramFrame>
        <Callout tone="warning" title="Strict steering" icon="!">
          Adj-SIDs give strict, link-level control; Node SIDs give loose, shortest-path control. Real lists mix them and use an Adj-SID only where the shortest path would not take the wanted link. Global Adj-SIDs exist in some designs, but they are not the default.
        </Callout>
      </GuideSection>

      <GuideSection id="sd-stack" eyebrow="Data plane" title="Stack order and active SID" tone="mpls">
        <DiagramFrame caption="Top = active; bottom = S=1.">
          <StackOrderDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="sd-php" eyebrow="Data plane" title="PHP and explicit-null" tone="mpls">
        <DiagramFrame caption="Two ways a target can ask for its Prefix-SID to be handled.">
          <PhpDiagram />
        </DiagramFrame>
        <p>
          With PHP the logical segment list and the wire stack differ: a Prefix-SID is removed one hop before its target. When the headend is itself the penultimate hop for the first segment, that SID is never imposed at all. Whether PHP happens depends on what the target advertises, so do not assume one behavior everywhere.
        </p>
      </GuideSection>

      <GuideSection id="sd-planes" eyebrow="Model" title="Control plane vs data plane" tone="cyan">
        <CompareCards
          items={[
            { title: "Control plane", tone: "violet", tag: "IGP + SR extensions", points: ["Topology and metrics", "SRGB, Prefix-SIDs, Adj-SIDs", "SPF per router", "LFIB programming"] },
            { title: "Data plane", tone: "mpls", tag: "MPLS", points: ["Headend pushes the stack", "Top label decides the action", "Continue, pop, or execute an adjacency", "No per-path state in transit"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="sd-not" eyebrow="Limits" title="What SR-MPLS is not" tone="danger">
        <ChecklistCard tone="danger" title="SR-MPLS does not by itself provide" mark="×" items={["Bandwidth reservation or admission control.", "Automatic protection — that is TI-LFA, a separate function.", "Policy intent or candidate selection — that is SR Policy.", "Different metrics or constraints per path — that is Flex-Algo."]} />
      </GuideSection>

      <GuideSection id="sd-trouble" eyebrow="Operations" title="Troubleshooting" tone="warning">
        <ChecklistCard
          tone="warning"
          title="Work the layers"
          mark="→"
          items={["IGP adjacency and SPF result for the target prefix.", "SR enabled; SRGB ranges advertised and not overlapping other label users.", "Prefix-SID index present and unique; label derived as expected.", "Adj-SID owner matches the router that will execute it.", "Stack order: first segment on top; exactly one S=1 at the bottom.", "PHP expectations match what each target advertises."]}
        />
      </GuideSection>

      <GuideSection id="sd-verify" eyebrow="Operations" title="Verification" tone="success">
        <FieldTable
          title="Typical checks (names vary by vendor)"
          accent="success"
          columns={["Question", "Look at"]}
          rows={[
            ["Which SIDs are known?", <Mono key="a">SID / prefix-SID database</Mono>],
            ["What label does a prefix use here?", <Mono key="b">MPLS forwarding table (LFIB)</Mono>],
            ["Which SIDs does a router own?", "Local Prefix-SID and Adj-SID listings"],
            ["What does the packet carry?", "Packet capture or label trace per hop"],
          ]}
        />
      </GuideSection>

      <GuideSection id="sd-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "SR-MPLS", def: "Segment Routing with segments encoded as MPLS labels." },
            { term: "Segment list", def: "The ordered instructions imposed by the headend." },
            { term: "SRGB", def: "Global label block used for Prefix-SIDs." },
            { term: "SRLB", def: "Local label block some implementations use for local SIDs." },
            { term: "Adj-SID", def: "Adjacency segment; normally local to its owner." },
            { term: "ECMP", def: "Equal-cost multipath — several shortest paths used together." },
            { term: "Implicit-null", def: "Ask the penultimate hop to pop the label (PHP)." },
            { term: "Explicit-null", def: "Keep label 0 to the target, which pops it itself." },
          ]}
        />
      </GuideSection>

      <GuideSection id="sd-mental" eyebrow="Recap" title="Mental model" tone="success">
        <Callout tone="success" title="Remember" icon="✓">
          SIDs are learned through the IGP; the path is written into the packet; each router acts only on the top label; Node SIDs are loose, Adj-SIDs are strict and owned; and PHP can remove a Prefix-SID before its target ever sees it.
        </Callout>
      </GuideSection>
    </>
  );
}
