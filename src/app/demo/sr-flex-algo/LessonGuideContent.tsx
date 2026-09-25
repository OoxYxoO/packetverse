import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DNode, DiagramFrame, DiagramSvg, FieldTable, FlowSteps, Glossary, GuideSection, Mono } from "@/components/lesson/GuideBlocks";
import { SrTopology, type SrLink } from "@/components/lesson/SrGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";

export const FLEX_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "fl-mission", label: "The mission" },
  { id: "fl-topology", label: "Topology and link attributes" },
  { id: "fl-algo0", label: "Algorithm 0" },
  { id: "fl-fad", label: "The Flex-Algo Definition" },
  { id: "fl-distributed", label: "Distributed computation" },
  { id: "fl-spf", label: "Algorithm-128 topology" },
  { id: "fl-sid", label: "Algorithm-specific SID" },
  { id: "fl-compare", label: "Algo 0 vs Algo 128" },
  { id: "fl-affinity", label: "Metric vs affinity" },
  { id: "fl-lab", label: "The same ID, a different path" },
  { id: "fl-fault", label: "The Algorithm-128 incident" },
  { id: "fl-mistakes", label: "Common mistakes" },
  { id: "fl-challenge", label: "The engineer challenge" },
  { id: "fl-glossary", label: "Glossary" },
  { id: "fl-recap", label: "Mental model" },
];

const BLUE = "#60a5fa";
const GOLD = D.warning;

/** Link attributes as the scenario defines them: IGP metric, delay metric, affinity. */
const ATTRS: (SrLink & { igp: number; delay: number; affinity?: "BLUE" | "GOLD" })[] = [
  { a: "R1", b: "R2", igp: 10, delay: 30, affinity: "BLUE" },
  { a: "R2", b: "R4", igp: 10, delay: 30, affinity: "BLUE" },
  { a: "R4", b: "R6", igp: 10, delay: 30, affinity: "BLUE" },
  { a: "R1", b: "R3", igp: 20, delay: 5, affinity: "GOLD" },
  { a: "R3", b: "R5", igp: 20, delay: 5, affinity: "GOLD" },
  { a: "R5", b: "R6", igp: 20, delay: 5, affinity: "GOLD" },
  { a: "R3", b: "R4", igp: 5, delay: 3 },
];

function TopologyDiagram() {
  return (
    <DiagramSvg h={240} label="Top links are BLUE with IGP 10 and delay 30; bottom links are GOLD with IGP 20 and delay 5; the R3-R4 cross-link has IGP 5, delay 3 and no affinity">
      <SrTopology
        links={ATTRS.map((l) => ({ a: l.a, b: l.b, label: `${l.igp} / d${l.delay}`, color: l.affinity === "BLUE" ? BLUE : l.affinity === "GOLD" ? GOLD : D.line }))}
        sub={{ R1: "headend", R6: "destination" }}
        accent={{ R1: D.mpls, R6: D.mpls }}
      />
      <text x={320} y={228} textAnchor="middle" fill={D.muted} fontSize={10}>
        labels are IGP / delay · blue = BLUE affinity · amber = GOLD · grey = no affinity
      </text>
    </DiagramSvg>
  );
}

function PathDiagram({ algo }: { algo: 0 | 128 }) {
  const onPath = algo === 0 ? new Set(["R1-R2", "R2-R4", "R4-R6"]) : new Set(["R1-R3", "R3-R5", "R5-R6"]);
  return (
    <DiagramSvg h={240} label={algo === 0 ? "Algorithm 0 uses IGP metric over all links: R1 R2 R4 R6, total 30" : "Algorithm 128 uses delay and excludes BLUE links: R1 R3 R5 R6, total delay 15"}>
      <SrTopology
        links={ATTRS.map((l) => {
          const id = `${l.a}-${l.b}`;
          const excluded = algo === 128 && l.affinity === "BLUE";
          const label = algo === 0 ? `${l.igp}` : excluded ? "excluded" : `d${l.delay}`;
          return { a: l.a, b: l.b, label, dashed: excluded, color: onPath.has(id) ? (algo === 0 ? D.success : D.violet) : excluded ? D.danger : D.line, bold: onPath.has(id) };
        })}
        sub={{ R1: algo === 0 ? "push 16006" : "push 16106", R6: "destination" }}
        accent={{ R1: D.mpls, R6: D.mpls }}
      />
      <text x={320} y={228} textAnchor="middle" fill={algo === 0 ? D.success : D.violet} fontSize={10.5} fontWeight={700}>
        {algo === 0 ? "ALGORITHM 0 · IGP metric · R1 → R2 → R4 → R6 · total 30" : "ALGORITHM 128 · delay, exclude BLUE · R1 → R3 → R5 → R6 · total delay 15"}
      </text>
    </DiagramSvg>
  );
}

function SidDiagram() {
  return (
    <DiagramSvg h={170} label="R6's prefix 10.0.0.6/32 has two Prefix-SIDs: 16006 for Algorithm 0 with next hop R2 at R1, and 16106 for Algorithm 128 with next hop R3">
      <DNode x={110} y={85} label="10.0.0.6/32" sub="R6's prefix" accent={D.mpls} w={140} />
      <DArrow x1={182} y1={72} x2={318} y2={42} color={D.success} />
      <DArrow x1={182} y1={98} x2={318} y2={128} color={D.violet} />
      <DNode x={420} y={42} label="16006" sub="Algo 0 · index 6" accent={D.success} w={150} />
      <DNode x={420} y={128} label="16106" sub="Algo 128 · index 106" accent={D.violet} w={150} />
      <text x={505} y={46} fill={D.muted} fontSize={10}>
        R1 → R2
      </text>
      <text x={505} y={132} fill={D.muted} fontSize={10}>
        R1 → R3
      </text>
    </DiagramSvg>
  );
}

export function FlexAlgoLessonGuideContent() {
  return (
    <>
      <GuideSection id="fl-mission" eyebrow="Introduction" title="The mission: a second shortest-path topology" tone="mpls">
        <p>Normal Node-SID forwarding follows the IGP shortest path. Here the IGP computes another shortest-path topology alongside it — one that optimizes delay and avoids BLUE links — and gives R6 a second SID that means &quot;reach me over that topology&quot;.</p>
        <Callout tone="cyan" title="Scope of this simulation" icon="i">
          SRGB 16000; algorithm-specific SID index = algorithm offset (0 or 100) + router index — PacketVerse&apos;s convention for this lesson. Single-label forwarding; the SID&apos;s target completes it. One definition (FAD 128) that every router advertises identically.
        </Callout>
      </GuideSection>

      <GuideSection id="fl-topology" eyebrow="Setup" title="Topology and link attributes" tone="ospf">
        <DiagramFrame caption="Every link carries independent IGP, TE and delay metrics plus an optional affinity.">
          <TopologyDiagram />
        </DiagramFrame>
        <FieldTable
          title="Totals per branch"
          accent="ospf"
          columns={["Branch", "IGP total", "Delay total", "Affinity"]}
          rows={[
            ["Top R1-R2-R4-R6", "30", "90", "BLUE"],
            ["Bottom R1-R3-R5-R6", "60", "15", "GOLD"],
          ]}
        />
      </GuideSection>

      <GuideSection id="fl-algo0" eyebrow="Baseline" title="Algorithm 0" tone="success">
        <DiagramFrame caption="The default SPF every router already runs.">
          <PathDiagram algo={0} />
        </DiagramFrame>
        <p>
          Algorithm 0 is the standard IGP shortest path: no definition, no constraints, no opt-in. R6&apos;s Algorithm-0 Prefix-SID is <Mono>16006</Mono> (16000 + 0 + 6); R1 pushes it and each router forwards on its own Algorithm-0 SPF.
        </p>
      </GuideSection>

      <GuideSection id="fl-fad" eyebrow="Control plane" title="The Flex-Algo Definition" tone="violet">
        <FieldTable
          title="FAD 128 (PacketVerse name: LOW-LATENCY)"
          accent="violet"
          columns={["Field", "Value"]}
          rows={[
            ["Algorithm", <Mono key="a">128</Mono>],
            ["Metric type", "DELAY"],
            ["Exclude affinity", "BLUE (added after metric type is understood)"],
            ["Include affinity", "none"],
            ["Priority", "100"],
          ]}
        />
        <p>128 is an algorithm identifier distributed by the IGP — not a label, VLAN, DSCP value or SR Policy color.</p>
      </GuideSection>

      <GuideSection id="fl-distributed" eyebrow="Control plane" title="Distributed computation" tone="violet">
        <FlowSteps
          steps={[
            { title: "Advertise", body: "The IGP floods the FAD and each link's attributes.", tone: "ospf" },
            { title: "Participate", body: "Each router that participates in 128 builds the constrained topology.", tone: "violet" },
            { title: "Compute", body: "Every participant runs its own Algorithm-128 SPF — no router pushes routes to others.", tone: "cyan" },
            { title: "Program", body: "Each router installs its own entry for the Algorithm-128 SIDs.", tone: "mpls" },
          ]}
        />
      </GuideSection>

      <GuideSection id="fl-spf" eyebrow="Computation" title="Algorithm-128 topology" tone="violet">
        <DiagramFrame caption="BLUE links are removed first; delay decides among the rest.">
          <PathDiagram algo={128} />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="fl-sid" eyebrow="Data plane" title="Algorithm-specific SID" tone="mpls">
        <DiagramFrame caption="Same prefix, two SIDs, two LFIB entries at R1.">
          <SidDiagram />
        </DiagramFrame>
        <p>
          <Mono>16106</Mono> does not mean a fixed path; it means &quot;reach 10.0.0.6/32 according to Algorithm 128&apos;s current topology and metric&quot;. R1 pushes <Mono>16106 S1</Mono> toward R3; R3 and R5 forward it on their own Algorithm-128 SPF; R6 completes it.
        </p>
      </GuideSection>

      <GuideSection id="fl-compare" eyebrow="Comparison" title="Algo 0 vs Algo 128" tone="cyan">
        <CompareCards
          items={[
            { title: "Algorithm 0", tone: "success", tag: "default", points: ["IGP metric", "All links eligible", "R1 → R2 → R4 → R6 (IGP 30)", "SID 16006"] },
            { title: "Algorithm 128", tone: "violet", tag: "FAD 128", points: ["Delay metric", "BLUE links excluded", "R1 → R3 → R5 → R6 (delay 15)", "SID 16106"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="fl-affinity" eyebrow="Constraints" title="Metric vs affinity" tone="warning">
        <p>The metric type decides what a path costs among eligible links. The affinity rule decides which links may be used at all. They are independent: a definition can change one without touching the other.</p>
      </GuideSection>

      <GuideSection id="fl-lab" eyebrow="Lab" title="The same ID, a different path" tone="violet">
        <p>
          In the lab, raising R3-R5&apos;s delay from 5 to 80 (with the BLUE exclusion lifted) makes Algorithm 128 choose R1 → R3 → R4 → R6 over the cross-link, total delay 38. The algorithm ID stayed 128; only the inputs changed.
        </p>
      </GuideSection>

      <GuideSection id="fl-fault" eyebrow="Troubleshooting" title="The Algorithm-128 incident" tone="danger">
        <ChecklistCard
          tone="danger"
          title="How to reason about it (no spoilers)"
          mark="→"
          items={["Algorithm 0 works, so physical links, IGP and SR are fine.", "Check the definition: is FAD 128 advertised and identical everywhere?", "Check participation: which routers compute Algorithm 128?", "Check continuity: does the computed path only cross participants?", "Check forwarding: does R1 have an entry for 16106?", "After a fix, send a real packet toward 16106 and follow it."]}
        />
      </GuideSection>

      <GuideSection id="fl-mistakes" eyebrow="Troubleshooting" title="Common mistakes" tone="warning">
        <ChecklistCard tone="warning" title="Avoid these" mark="!" items={["Calling Algorithm 0 \"just another Flex-Algo\".", "Treating Flex-Algo 128 as SR Policy Color 128.", "Expecting an algorithm to be a fixed path.", "Treating an affinity exclusion as a metric change.", "Forgetting that every router on the path must participate."]} />
      </GuideSection>

      <GuideSection id="fl-challenge" eyebrow="Challenge" title="The engineer challenge" tone="violet">
        <p>Confirm the LOW-LATENCY topology end to end: DELAY metric, BLUE excluded, every required router participating, an Algorithm-128 SID for R6, and a path that really differs from Algorithm 0.</p>
      </GuideSection>

      <GuideSection id="fl-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "Flex-Algo", def: "An additional IGP-computed algorithm defined by a FAD." },
            { term: "Algorithm 0", def: "The default IGP SPF." },
            { term: "FAD", def: "Flex-Algo Definition: algorithm ID, metric type, affinity rules, priority." },
            { term: "Affinity", def: "A link tag (BLUE, GOLD) a FAD can include or exclude." },
            { term: "Participation", def: "A router opting in to compute an algorithm." },
            { term: "Algorithm SID", def: "A Prefix-SID bound to one algorithm (16106 for R6, Algo 128)." },
          ]}
        />
      </GuideSection>

      <GuideSection id="fl-recap" eyebrow="Recap" title="Mental model" tone="success">
        <Callout tone="success" title="One sentence" icon="✓">
          A FAD tells every participating router which links count and how to cost them; each router computes that topology itself; and an algorithm-specific SID lets a packet ask for that topology instead of the default one.
        </Callout>
      </GuideSection>
    </>
  );
}
