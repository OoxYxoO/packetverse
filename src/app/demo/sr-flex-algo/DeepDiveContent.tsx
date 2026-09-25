import { Callout, ChecklistCard, DArrow, DIAGRAM as D, DLink, DNode, DPill, DiagramFrame, DiagramSvg, FieldTable, Glossary, GuideSection, Mono } from "@/components/lesson/GuideBlocks";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";

export const FLEX_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "fd-why", label: "Why Flexible Algorithm" },
  { id: "fd-ids", label: "Algorithm IDs" },
  { id: "fd-fad", label: "The FAD" },
  { id: "fd-metrics", label: "Metric types" },
  { id: "fd-affinity", label: "Affinity rules" },
  { id: "fd-consistency", label: "FAD consistency" },
  { id: "fd-participation", label: "Participation" },
  { id: "fd-sids", label: "Algorithm-specific SIDs" },
  { id: "fd-topologies", label: "Separate logical topologies" },
  { id: "fd-relations", label: "SR Policy and TI-LFA" },
  { id: "fd-trouble", label: "Troubleshooting" },
  { id: "fd-verify", label: "Verification" },
  { id: "fd-glossary", label: "Glossary" },
  { id: "fd-mental", label: "Mental model" },
];

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

export function FlexAlgoDeepDiveContent() {
  return (
    <>
      <GuideSection id="fd-why" eyebrow="Purpose" title="Why Flexible Algorithm" tone="mpls">
        <p>One SPF can only optimize one thing. Flex-Algo lets the IGP compute additional constrained shortest-path topologies — low delay, avoid a region, use only certain links — and gives each its own Prefix-SIDs, with no per-path headend state.</p>
      </GuideSection>

      <GuideSection id="fd-ids" eyebrow="Concepts" title="Algorithm IDs" tone="violet">
        <FieldTable
          title="Algorithm numbers"
          accent="violet"
          columns={["ID", "Meaning"]}
          rows={[
            [<Mono key="a">0</Mono>, "Default SPF (IGP metric)"],
            [<Mono key="b">1</Mono>, "Strict SPF — like 0, but transit routers may not override the path with local policy"],
            [<Mono key="c">128–255</Mono>, "Flexible algorithms, each defined by a FAD"],
          ]}
        />
      </GuideSection>

      <GuideSection id="fd-fad" eyebrow="Concepts" title="The FAD" tone="violet">
        <p>A Flex-Algo Definition carries the algorithm ID, the metric type, affinity rules and a priority, and is flooded by the IGP (IS-IS or OSPF). Routers that participate apply it to build the algorithm&apos;s topology.</p>
      </GuideSection>

      <GuideSection id="fd-metrics" eyebrow="Concepts" title="Metric types" tone="ospf">
        <FieldTable
          title="What a FAD can optimize"
          accent="ospf"
          columns={["Metric type", "Typical use"]}
          rows={[
            ["IGP metric", "Same cost model as Algorithm 0, but with constraints"],
            ["TE metric", "An operator-set cost independent of the IGP metric"],
            ["Min unidirectional delay", "Low-latency topologies (the lesson's choice)"],
          ]}
        />
      </GuideSection>

      <GuideSection id="fd-affinity" eyebrow="Constraints" title="Affinity rules" tone="warning">
        <DiagramFrame caption="Admin groups / affinities filter links before SPF.">
          <AffinityRulesDiagram />
        </DiagramFrame>
        <p>The lesson uses exclude BLUE only. Include-any and include-all are explained here for completeness; they are not exercised by the simulation.</p>
      </GuideSection>

      <GuideSection id="fd-consistency" eyebrow="Operations" title="FAD consistency" tone="danger">
        <DiagramFrame caption="Participants must agree on one definition.">
          <ConsistencyDiagram />
        </DiagramFrame>
        <p>If routers applied different definitions for the same algorithm, their SPF results would not match and traffic could loop or black-hole. The winner is chosen by priority (with a tie-break defined by the protocol), and every participant uses it.</p>
      </GuideSection>

      <GuideSection id="fd-participation" eyebrow="Operations" title="Participation" tone="warning">
        <DiagramFrame caption="Non-participants are not transit for that algorithm.">
          <ParticipationDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="fd-sids" eyebrow="Data plane" title="Algorithm-specific SIDs" tone="mpls">
        <DiagramFrame caption="One prefix, one SID per algorithm.">
          <SidMappingDiagram />
        </DiagramFrame>
        <p>Each algorithm gets its own Prefix-SID index for the same prefix, and so its own label from the SRGB. Operators configure those indexes; the lesson derives them as offset + router index (0 → 16006, 128 → 16106) purely as a teaching convention.</p>
      </GuideSection>

      <GuideSection id="fd-topologies" eyebrow="Computation" title="Separate logical topologies" tone="violet">
        <DiagramFrame caption="Same routers, different eligible links, different SPF.">
          <TopologiesDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="fd-relations" eyebrow="Context" title="SR Policy and TI-LFA" tone="cyan">
        <p>SR Policy is headend intent with candidate paths; Flex-Algo is a distributed calculation. A policy can use algorithm-specific SIDs so its segments inherit a Flex-Algo&apos;s constraints. TI-LFA for a Flex-Algo prefix must compute its repair inside the same algorithm&apos;s topology, not Algorithm 0&apos;s.</p>
      </GuideSection>

      <GuideSection id="fd-trouble" eyebrow="Operations" title="Troubleshooting" tone="warning">
        <ChecklistCard
          tone="warning"
          title="Work the layers"
          mark="→"
          items={["Is a FAD for the algorithm advertised, and is it the same winner everywhere?", "Do the links carry the metric type the FAD needs (e.g. delay)?", "Do affinity rules leave any eligible path?", "Is every router on the intended path participating?", "Is there a Prefix-SID for the destination in this algorithm?", "Does the headend's forwarding entry for that SID point where you expect?"]}
        />
      </GuideSection>

      <GuideSection id="fd-verify" eyebrow="Operations" title="Verification" tone="success">
        <FieldTable
          title="Typical checks (names vary by vendor)"
          accent="success"
          columns={["Question", "Look at"]}
          rows={[
            ["Winning definition", <Mono key="a">flex-algo definition / FAD detail</Mono>],
            ["Participants", "IGP database per algorithm"],
            ["Per-algorithm path", "Per-algorithm SPF / route output"],
            ["Labels", "Prefix-SID per algorithm and the LFIB"],
          ]}
        />
      </GuideSection>

      <GuideSection id="fd-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "FAD", def: "Flex-Algo Definition flooded by the IGP." },
            { term: "Admin group / affinity", def: "A link color used by affinity rules." },
            { term: "exclude-any", def: "Remove links carrying any listed color." },
            { term: "include-any", def: "Keep links carrying at least one listed color." },
            { term: "include-all", def: "Keep links carrying all listed colors." },
            { term: "Strict SPF", def: "Algorithm 1: SPF without local policy overrides." },
          ]}
        />
      </GuideSection>

      <GuideSection id="fd-mental" eyebrow="Recap" title="Mental model" tone="success">
        <Callout tone="success" title="Remember" icon="✓">
          Define once (FAD), agree everywhere, compute locally, and address the result with an algorithm-specific SID.
        </Callout>
      </GuideSection>
    </>
  );
}
