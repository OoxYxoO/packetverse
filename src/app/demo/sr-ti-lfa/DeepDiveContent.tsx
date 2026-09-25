import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DLink, DNode, DPill, DRegion, DiagramFrame, DiagramSvg, FieldTable, Glossary, GuideSection, Mono } from "@/components/lesson/GuideBlocks";
import { DStack } from "@/components/lesson/MplsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";

export const TILFA_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "td-frr", label: "Fast reroute" },
  { id: "td-lfa", label: "LFA, rLFA and TI-LFA" },
  { id: "td-pq", label: "P-Space and Q-Space" },
  { id: "td-encoding", label: "Encoding the repair" },
  { id: "td-protect", label: "Link vs node protection" },
  { id: "td-timeline", label: "Detection to convergence" },
  { id: "td-microloops", label: "Microloops" },
  { id: "td-time", label: "About \"50 ms\"" },
  { id: "td-trouble", label: "Troubleshooting" },
  { id: "td-verify", label: "Verification" },
  { id: "td-glossary", label: "Glossary" },
  { id: "td-mental", label: "Mental model" },
];

function LfaCompareDiagram() {
  return (
    <DiagramSvg h={190} label="Classic LFA picks one loop-free neighbor; TI-LFA pushes segments that reach a safe point anywhere on the post-convergence path">
      <text x={20} y={26} fill={D.cyan} fontSize={11} fontWeight={700}>
        Classic LFA
      </text>
      <DNode x={120} y={62} label="PLR" w={70} h={30} accent={D.warning} />
      <DNode x={330} y={62} label="neighbor N" w={110} h={30} />
      <DArrow x1={157} y1={62} x2={273} y2={62} color={D.cyan} />
      <text x={400} y={66} fill={D.muted} fontSize={10}>
        works only if N is loop-free
      </text>
      <text x={20} y={120} fill={D.success} fontSize={11} fontWeight={700}>
        TI-LFA
      </text>
      <DNode x={120} y={154} label="PLR" w={70} h={30} accent={D.warning} />
      <DNode x={330} y={154} label="PQ node" w={110} h={30} accent={D.success} />
      <DArrow x1={157} y1={154} x2={273} y2={154} color={D.success} />
      <DStack x={215} y={112} labels={[{ text: "repair SID", color: D.warning }]} payload="original" w={90} rowH={14} />
      <text x={400} y={158} fill={D.muted} fontSize={10}>
        SR segments reach a safe point
      </text>
    </DiagramSvg>
  );
}

function PqConceptDiagram() {
  return (
    <DiagramSvg h={190} label="P-Space is what the PLR reaches safely, Q-Space is what reaches the destination safely, and the overlap holds candidate repair points">
      <DRegion x={60} y={30} w={300} h={130} label="P-Space (safe from the PLR)" color={D.cyan} />
      <DRegion x={280} y={30} w={300} h={130} label="" color={D.warning} />
      <text x={568} y={48} textAnchor="end" fill={D.warning} fontSize={10} fontWeight={700}>
        Q-Space (safe to the destination)
      </text>
      <DPill x={320} y={100} text="PQ nodes" color={D.success} w={90} />
      <text x={150} y={110} textAnchor="middle" fill={D.muted} fontSize={10}>
        reach, but not onward
      </text>
      <text x={490} y={110} textAnchor="middle" fill={D.muted} fontSize={10}>
        onward, but not reached
      </text>
      <text x={320} y={182} textAnchor="middle" fill={D.muted} fontSize={10}>
        no PQ node? then the repair needs extra segments (e.g. an Adj-SID) to join P to Q
      </text>
    </DiagramSvg>
  );
}

function EncodingDiagram() {
  return (
    <DiagramSvg h={180} label="A repair can be one Node SID, a Node SID plus an Adj-SID, or other combinations, always pushed above the original SID">
      <text x={130} y={20} textAnchor="middle" fill={D.success} fontSize={11} fontWeight={700}>
        one Node SID
      </text>
      <DStack x={130} y={30} labels={[{ text: "PQ Node SID", color: D.warning, tag: "TOP" }, { text: "original SID" }]} payload="payload" w={116} />
      <text x={400} y={20} textAnchor="middle" fill={D.violet} fontSize={11} fontWeight={700}>
        Node SID + Adj-SID
      </text>
      <DStack x={400} y={30} labels={[{ text: "P node SID", color: D.warning, tag: "TOP" }, { text: "Adj-SID P→Q", color: D.warning }, { text: "original SID" }]} payload="payload" w={116} />
      <text x={320} y={170} textAnchor="middle" fill={D.muted} fontSize={10}>
        the original instruction always stays underneath; the PLR only adds segments on top
      </text>
    </DiagramSvg>
  );
}

function ProtectionTypesDiagram() {
  return (
    <DiagramSvg h={170} label="Link protection avoids one link; node protection avoids the whole next-hop node and every link into it">
      <text x={160} y={24} textAnchor="middle" fill={D.warning} fontSize={11} fontWeight={700}>
        link protection
      </text>
      <DNode x={70} y={80} label="PLR" w={64} h={30} accent={D.warning} />
      <DNode x={250} y={80} label="N" w={56} h={30} />
      <DLink x1={102} y1={80} x2={222} y2={80} color={D.danger} dashed />
      <text x={162} y={70} textAnchor="middle" fill={D.danger} fontSize={10}>
        avoid this link
      </text>
      <text x={480} y={24} textAnchor="middle" fill={D.danger} fontSize={11} fontWeight={700}>
        node protection
      </text>
      <DNode x={390} y={80} label="PLR" w={64} h={30} accent={D.warning} />
      <DNode x={570} y={80} label="N" w={56} h={30} accent={D.danger} />
      <DLink x1={422} y1={80} x2={542} y2={80} color={D.danger} dashed />
      <text x={570} y={118} textAnchor="middle" fill={D.danger} fontSize={10}>
        avoid N entirely
      </text>
      <text x={320} y={160} textAnchor="middle" fill={D.muted} fontSize={10}>
        node protection is stronger; its P/Q spaces are computed with the node removed
      </text>
    </DiagramSvg>
  );
}

function TimelineDiagram() {
  const stages = [
    { t: "precompute", c: D.violet },
    { t: "detect", c: D.danger },
    { t: "local repair", c: D.success },
    { t: "IGP flood + SPF", c: D.cyan },
    { t: "converged", c: D.success },
  ];
  return (
    <DiagramSvg h={110} label="Precompute, detect, local repair, IGP flooding and SPF, converged">
      {stages.map((s, i) => (
        <g key={s.t}>
          <DPill x={70 + i * 125} y={40} text={s.t} color={s.c} w={112} />
          {i < stages.length - 1 && <DArrow x1={127 + i * 125} y1={40} x2={138 + i * 125} y2={40} color={D.faint} width={1.4} />}
        </g>
      ))}
      <text x={320} y={90} textAnchor="middle" fill={D.muted} fontSize={10}>
        repair labels are used only between detection and convergence
      </text>
    </DiagramSvg>
  );
}

export function TiLfaDeepDiveContent() {
  return (
    <>
      <GuideSection id="td-frr" eyebrow="Background" title="Fast reroute" tone="mpls">
        <p>Fast reroute means a router next to a failure switches traffic to a precomputed alternative before the rest of the network converges. The point of local repair (PLR) does this without waiting for the headend or any new signaling.</p>
      </GuideSection>

      <GuideSection id="td-lfa" eyebrow="Background" title="LFA, rLFA and TI-LFA" tone="cyan">
        <DiagramFrame caption="From one neighbor to a list of segments.">
          <LfaCompareDiagram />
        </DiagramFrame>
        <FieldTable
          title="IP/LDP and SR repair techniques"
          accent="cyan"
          columns={["Technique", "Repair", "Coverage"]}
          rows={[
            ["Classic LFA", "A loop-free neighbor", "Topology dependent"],
            ["Remote LFA", "Tunnel to a PQ node (targeted LDP)", "Better, not complete"],
            ["TI-LFA", "SR segments along the post-convergence path", "Any topology with a surviving path"],
          ]}
        />
      </GuideSection>

      <GuideSection id="td-pq" eyebrow="Computation" title="P-Space and Q-Space" tone="violet">
        <DiagramFrame caption="Two safety regions; the repair joins them.">
          <PqConceptDiagram />
        </DiagramFrame>
        <p>Both spaces come from real shortest-path comparisons with the protected resource removed. TI-LFA aims the repair along the post-convergence path, so traffic already sits where it will stay after convergence.</p>
      </GuideSection>

      <GuideSection id="td-encoding" eyebrow="Computation" title="Encoding the repair" tone="mpls">
        <DiagramFrame caption="Repairs are not always a single Node SID.">
          <EncodingDiagram />
        </DiagramFrame>
        <p>Node SIDs are used wherever the PLR&apos;s (or an intermediate node&apos;s) own shortest path already matches the safe path; an Adj-SID is added only where it does not. With PHP in a network, the labels actually on the wire can be shorter than the computed list.</p>
      </GuideSection>

      <GuideSection id="td-protect" eyebrow="Protection" title="Link vs node protection" tone="warning">
        <DiagramFrame caption="Choose what failure you are protecting against.">
          <ProtectionTypesDiagram />
        </DiagramFrame>
        <p>SRLG protection extends the same idea to links that share a risk (a fiber, a duct). Always check which protection type an implementation actually computed.</p>
      </GuideSection>

      <GuideSection id="td-timeline" eyebrow="Timeline" title="Detection to convergence" tone="cyan">
        <DiagramFrame caption="Local repair bridges the gap until convergence.">
          <TimelineDiagram />
        </DiagramFrame>
        <CompareCards
          items={[
            { title: "Precomputed", tone: "violet", tag: "before failure", points: ["Post-convergence SPF", "P/Q spaces", "Repair list", "Backup entry installed"] },
            { title: "At failure", tone: "success", tag: "local", points: ["Fast local detection (e.g. BFD or loss of light)", "Swap to backup entry", "Push repair segment(s)"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="td-microloops" eyebrow="Convergence" title="Microloops" tone="warning">
        <p>During convergence, routers update their forwarding tables at slightly different moments; for a short time two routers can point at each other and traffic loops. Microloop avoidance keeps traffic on explicit segments until neighbors have converged. It is a separate feature from TI-LFA and is not modeled here.</p>
      </GuideSection>

      <GuideSection id="td-time" eyebrow="Expectations" title="About &quot;50 ms&quot;" tone="danger">
        <Callout tone="danger" title="A target, not a guarantee" icon="!">
          Sub-50 ms restoration is a common engineering objective for fast reroute. Real results depend on failure detection time, hardware programming, the number of prefixes and the platform. No protocol guarantees a fixed number.
        </Callout>
      </GuideSection>

      <GuideSection id="td-trouble" eyebrow="Operations" title="Troubleshooting" tone="warning">
        <ChecklistCard
          tone="warning"
          title="When protection disappoints"
          mark="→"
          items={["Is TI-LFA enabled for the right protection type (link, node, SRLG)?", "Does a surviving path exist at all?", "Is the backup installed and READY — and against the current topology?", "Does the repair list resolve: every SID known, every Adj-SID owned by its executor?", "Is detection fast enough to matter?", "After recomputation, test with a real failure and a real packet."]}
        />
      </GuideSection>

      <GuideSection id="td-verify" eyebrow="Operations" title="Verification" tone="success">
        <FieldTable
          title="Typical checks (names vary by vendor)"
          accent="success"
          columns={["Question", "Look at"]}
          rows={[
            ["Is a backup computed?", <Mono key="a">TI-LFA / backup path detail</Mono>],
            ["Which repair SIDs?", "Backup label stack of the protected prefix"],
            ["Is it installed?", "MPLS forwarding table backup entries"],
            ["Did it work?", "Failure test with packet capture or counters"],
          ]}
        />
      </GuideSection>

      <GuideSection id="td-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "FRR", def: "Fast reroute — local switch-over to a precomputed alternative." },
            { term: "LFA / rLFA", def: "Loop-free alternate / remote LFA — IP/LDP-era repair methods." },
            { term: "Post-convergence path", def: "Where traffic will flow once all routers reconverge." },
            { term: "PQ node", def: "A node in both P-Space and Q-Space." },
            { term: "SRLG", def: "Shared-risk link group — links that can fail together." },
            { term: "Microloop", def: "A transient loop while routers converge at different times." },
          ]}
        />
      </GuideSection>

      <GuideSection id="td-mental" eyebrow="Recap" title="Mental model" tone="success">
        <Callout tone="success" title="Remember" icon="✓">
          Compute the post-convergence path early, find a safe place to aim for, encode it as the fewest segments that work, and push them above the original instruction the moment the failure is detected.
        </Callout>
      </GuideSection>
    </>
  );
}
