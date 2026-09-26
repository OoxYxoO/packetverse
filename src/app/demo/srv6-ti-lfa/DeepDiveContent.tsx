import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DNode, DPill, DiagramFrame, DiagramSvg, FieldTable, Glossary, GuideSection, Mono } from "@/components/lesson/GuideBlocks";
import { DHeaderColumn } from "@/components/lesson/Srv6GuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";

export const SRV6T_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "td-family", label: "LFA, RLFA and TI-LFA" },
  { id: "td-spaces", label: "P-Space, Q-Space, Extended P-Space" },
  { id: "td-shapes", label: "Repair list shapes" },
  { id: "td-end-endx", label: "End vs End.X in a repair" },
  { id: "td-flavors", label: "USD vs PSP vs USP" },
  { id: "td-timing", label: "Timing and micro-loops" },
  { id: "td-scope", label: "Link, node and SRLG protection" },
  { id: "td-nesting", label: "Protecting SRv6 services" },
  { id: "td-mpls", label: "SRv6 vs SR-MPLS encoding" },
  { id: "td-trouble", label: "Troubleshooting" },
  { id: "td-verify", label: "Verification" },
  { id: "td-glossary", label: "Glossary" },
  { id: "td-mental", label: "Mental model" },
];

function FamilyDiagram() {
  const col = (x: number, title: string, sub: string, color: string, reach: string) => (
    <g>
      <DNode x={x} y={36} label={title} sub={sub} accent={color} w={180} />
      <rect x={x - 90} y={70} width={180} height={62} rx={10} fill={color} fillOpacity={0.08} stroke={color} strokeOpacity={0.5} strokeDasharray="5 4" />
      <text x={x} y={96} textAnchor="middle" fill={D.text} fontSize={10.5} fontWeight={700}>
        backup reach
      </text>
      <text x={x} y={116} textAnchor="middle" fill={D.muted} fontSize={10}>
        {reach}
      </text>
    </g>
  );
  return (
    <DiagramSvg h={170} label="LFA uses a directly connected loop-free neighbor; Remote LFA tunnels to a PQ node; TI-LFA uses a segment list to reach any post-convergence path">
      {col(110, "LFA", "RFC 5286", D.faint, "one neighbor, if loop-free")}
      {col(320, "Remote LFA", "RFC 7490", D.ip, "a PQ node, if one exists")}
      {col(530, "TI-LFA", "RFC 9855", D.success, "the post-convergence path")}
      <text x={320} y={158} textAnchor="middle" fill={D.muted} fontSize={10}>
        coverage grows left to right — TI-LFA can steer where no single loop-free neighbor or PQ node exists
      </text>
    </DiagramSvg>
  );
}

function SpacesDiagram() {
  return (
    <DiagramSvg h={206} label="P-Space is computed from the PLR's shortest-path tree, Extended P-Space adds nodes reachable from the PLR's neighbors, Q-Space is computed from the reverse tree toward the destination; a PQ node lies in both">
      <ellipse cx={230} cy={92} rx={160} ry={66} fill={D.cyan} fillOpacity={0.08} stroke={D.cyan} strokeOpacity={0.7} strokeDasharray="6 5" />
      <ellipse cx={200} cy={92} rx={110} ry={48} fill={D.violet} fillOpacity={0.08} stroke={D.violet} strokeOpacity={0.7} />
      <ellipse cx={420} cy={92} rx={140} ry={60} fill={D.success} fillOpacity={0.08} stroke={D.success} strokeOpacity={0.7} strokeDasharray="6 5" />
      <text x={150} y={62} fill={D.violet} fontSize={11} fontWeight={700}>
        P-Space
      </text>
      <text x={70} y={178} fill={D.cyan} fontSize={10.5} fontWeight={700}>
        dashed cyan = Extended P-Space
      </text>
      <text x={470} y={62} fill={D.success} fontSize={11} fontWeight={700}>
        Q-Space
      </text>
      <DPill x={335} y={96} text="PQ node" color={D.warning} w={78} />
      <text x={320} y={198} textAnchor="middle" fill={D.muted} fontSize={10}>
        P from the PLR&apos;s SPT (resource excluded) · Q from the reverse SPT toward the destination
      </text>
    </DiagramSvg>
  );
}

function ShapesDiagram() {
  const row = (y: number, label: string, list: string, color: string) => (
    <g>
      <text x={24} y={y + 17} fill={D.text} fontSize={11} fontWeight={700}>
        {label}
      </text>
      <rect x={250} y={y} width={366} height={26} rx={7} fill={color} fillOpacity={0.12} stroke={color} strokeOpacity={0.7} />
      <text x={433} y={y + 17} textAnchor="middle" fill={color} fontSize={10.5} fontWeight={700} fontFamily="monospace">
        {list}
      </text>
    </g>
  );
  return (
    <DiagramSvg h={160} label="Three repair list shapes: a PQ node reachable directly needs one End SID; P and Q adjacent needs an End.X SID at the last P node; P and Q far apart need several SIDs">
      {row(20, "PQ node exists", "⟨End(PQ)⟩", D.success)}
      {row(56, "P and Q are neighbors", "⟨End.X(P → Q)⟩  (globally routed)", D.violet)}
      {row(92, "P and Q further apart", "⟨SID₁, …, SIDₙ⟩ → needs an SRH", D.warning)}
      <text x={320} y={146} textAnchor="middle" fill={D.muted} fontSize={10}>
        the lesson&apos;s main repair is the middle shape; its multi-SID lab shows the bottom one
      </text>
    </DiagramSvg>
  );
}

function EndVsEndXDiagram() {
  return (
    <DiagramSvg h={200} label="An End SID delivers the packet to its owner and the owner's normal routing decides what happens next; an End.X SID additionally forces one specific outgoing adjacency">
      <DNode x={110} y={40} label="End SID" sub="owner's locator" accent={D.ip} w={150} />
      <DArrow x1={185} y1={40} x2={300} y2={40} color={D.ip} label="routed to owner" />
      <DNode x={380} y={40} label="Owner" sub="then its own FIB" accent={D.ip} w={150} />
      <text x={560} y={45} textAnchor="middle" fill={D.muted} fontSize={10}>
        no bound adjacency
      </text>
      <DNode x={110} y={128} label="End.X SID" sub="owner's locator" accent={D.violet} w={150} />
      <DArrow x1={185} y1={128} x2={300} y2={128} color={D.violet} label="routed to owner" />
      <DNode x={380} y={128} label="Owner" sub="bound adjacency" accent={D.violet} w={150} />
      <DArrow x1={455} y1={128} x2={560} y2={128} color={D.violet} label="forced link" />
      <text x={320} y={188} textAnchor="middle" fill={D.muted} fontSize={10}>
        only End.X pins the next hop — one End.X SID per bound adjacency
      </text>
    </DiagramSvg>
  );
}

function FlavorsDiagram() {
  return (
    <DiagramSvg h={200} label="PSP removes the SRH at the penultimate segment, USP removes it at the ultimate segment, USD removes the whole outer IPv6 header and exposes the inner packet">
      <text x={110} y={20} textAnchor="middle" fill={D.text} fontSize={11.5} fontWeight={700}>
        PSP
      </text>
      <DHeaderColumn x={110} y={30} w={170} rows={[{ text: "outer IPv6", color: D.ip }, { text: "SRH removed", color: D.faint }, { text: "payload", color: D.ip }]} caption="at the penultimate segment" />
      <text x={320} y={20} textAnchor="middle" fill={D.text} fontSize={11.5} fontWeight={700}>
        USP
      </text>
      <DHeaderColumn x={320} y={30} w={170} rows={[{ text: "outer IPv6", color: D.ip }, { text: "SRH removed", color: D.faint }, { text: "payload", color: D.ip }]} caption="at the ultimate segment" />
      <text x={530} y={20} textAnchor="middle" fill={D.text} fontSize={11.5} fontWeight={700}>
        USD
      </text>
      <DHeaderColumn x={530} y={30} w={170} rows={[{ text: "outer IPv6 removed", color: D.faint }, { text: "+ its extensions", color: D.faint }, { text: "inner packet exposed", color: D.success, strong: true }]} caption="at the ultimate segment" />
      <text x={320} y={186} textAnchor="middle" fill={D.muted} fontSize={10}>
        a TI-LFA repair outer is a whole encapsulation — only USD removes it completely
      </text>
    </DiagramSvg>
  );
}

function TimingDiagram() {
  const seg = (x: number, w: number, label: string, color: string) => (
    <g>
      <rect x={x} y={60} width={w} height={30} rx={6} fill={color} fillOpacity={0.18} stroke={color} strokeOpacity={0.8} />
      <text x={x + w / 2} y={79} textAnchor="middle" fill={color} fontSize={10.5} fontWeight={700}>
        {label}
      </text>
    </g>
  );
  return (
    <DiagramSvg h={160} label="Timeline: steady state, failure detected, TI-LFA active until every router converges, then post-convergence forwarding; micro-loops can appear while routers converge at different times">
      <DArrow x1={24} y1={120} x2={620} y2={120} color={D.faint} label="time" labelDy={18} />
      {seg(24, 110, "steady", D.success)}
      {seg(138, 60, "detect", D.danger)}
      {seg(202, 250, "TI-LFA repair active", D.warning)}
      {seg(456, 164, "post-convergence", D.ospf)}
      <text x={327} y={44} textAnchor="middle" fill={D.muted} fontSize={10}>
        other routers converge in any order here → micro-loop risk (a separate mechanism)
      </text>
    </DiagramSvg>
  );
}

function NestingDiagram() {
  return (
    <DiagramSvg h={170} label="A TI-LFA repair outer is added around whatever SRv6 packet is protected: a policy packet with its SRH, or a service packet; the repair node removes only the repair outer">
      <DHeaderColumn
        x={320}
        y={20}
        w={330}
        rows={[
          { text: "repair outer · SA = PLR · DA = repair SID", color: D.warning, tag: "TI-LFA", strong: true },
          { text: "protected SRv6 packet (any: policy, VPN, transport)", color: D.bgp, tag: "UNTOUCHED" },
          { text: "its own payload", color: D.ip },
        ]}
      />
      <text x={320} y={130} textAnchor="middle" fill={D.muted} fontSize={10}>
        the repair never edits the protected packet&apos;s DA, SRH or Segments Left
      </text>
    </DiagramSvg>
  );
}

export function Srv6TiLfaDeepDiveContent() {
  return (
    <>
      <GuideSection id="td-family" eyebrow="Background" title="LFA, RLFA and TI-LFA" tone="cyan">
        <DiagramFrame caption="Each generation widens which failures can be repaired locally.">
          <FamilyDiagram />
        </DiagramFrame>
        <p>
          TI-LFA (RFC 9855) uses Segment Routing to steer the repaired packet along the post-convergence path, so traffic already follows the route the network will settle on. &quot;Topology Independent&quot; means coverage does not depend on a lucky neighbor — it still uses the full link-state topology.
        </p>
      </GuideSection>

      <GuideSection id="td-spaces" eyebrow="Computation" title="P-Space, Q-Space, Extended P-Space" tone="warning">
        <DiagramFrame caption="Both spaces are computed with the protected resource treated as failed.">
          <SpacesDiagram />
        </DiagramFrame>
        <FieldTable
          title="Definitions"
          accent="warning"
          columns={["Set", "Computed from", "Meaning"]}
          rows={[
            ["P-Space", "PLR's shortest-path tree", "reachable from the PLR without crossing the resource"],
            ["Extended P-Space", "each PLR neighbor's tree", "reachable from a neighbor the PLR can send to directly"],
            ["Q-Space", "reverse tree toward the destination", "reaches the destination without crossing the resource"],
          ]}
        />
        <p>Which P node becomes the repair node is an implementation choice. PacketVerse uses one documented, deterministic strategy; real implementations may pick a different valid repair.</p>
      </GuideSection>

      <GuideSection id="td-shapes" eyebrow="Repair program" title="Repair list shapes" tone="violet">
        <DiagramFrame caption="The shape depends on how far apart P-Space and Q-Space are.">
          <ShapesDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="td-end-endx" eyebrow="Endpoint behaviors" title="End vs End.X in a repair" tone="violet">
        <DiagramFrame caption="Reaching a node and forcing a link are different instructions.">
          <EndVsEndXDiagram />
        </DiagramFrame>
        <p>
          An End SID only gets the packet to its owner; everything after that follows the owner&apos;s current FIB and every FIB along the way. An End.X SID is one local instance bound to one adjacency, so a router with two protected adjacencies advertises two End.X SIDs.
        </p>
      </GuideSection>

      <GuideSection id="td-flavors" eyebrow="Endpoint behaviors" title="USD vs PSP vs USP" tone="violet">
        <DiagramFrame caption="Flavors change what is removed, and where.">
          <FlavorsDiagram />
        </DiagramFrame>
        <CompareCards
          items={[
            { title: "PSP / USP", tone: "cyan", tag: "SRH removal", points: ["Remove the SRH only", "The outer IPv6 header stays"] },
            { title: "USD", tone: "warning", tag: "decapsulation", points: ["Removes the whole outer IPv6 header and extensions", "Exposes the inner packet for the next forwarding decision"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="td-timing" eyebrow="Operations" title="Timing and micro-loops" tone="ospf">
        <DiagramFrame caption="TI-LFA covers the local repair window; micro-loop avoidance is a different mechanism.">
          <TimingDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="td-scope" eyebrow="Design" title="Link, node and SRLG protection" tone="warning">
        <FieldTable
          title="What is excluded from the computation"
          accent="warning"
          columns={["Mode", "Excluded", "Consequence"]}
          rows={[
            ["Link", "the protected link", "the far-end node may still merge the traffic"],
            ["Node", "the protected node and all its links", "the repair must merge beyond that node"],
            ["SRLG", "every link sharing the risk group", "one physical failure cannot break the repair too"],
          ]}
        />
      </GuideSection>

      <GuideSection id="td-nesting" eyebrow="Integration" title="Protecting SRv6 services" tone="bgp">
        <DiagramFrame caption="Protection is a temporary outer layer, independent of the service.">
          <NestingDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="td-mpls" eyebrow="Comparison" title="SRv6 vs SR-MPLS encoding" tone="mpls">
        <FieldTable
          title="Same computation, different encoding"
          accent="mpls"
          columns={["Aspect", "SR-MPLS", "SRv6"]}
          rows={[
            ["Repair program", "label stack pushed above the existing labels", "outer IPv6 (+ SRH when more than one SID)"],
            ["Adjacency segment", "Adj-SID label (often locally significant)", "End.X SID (globally routed via the locator)"],
            ["Repair removal", "labels popped hop by hop / PHP", "USD at the final repair segment"],
          ]}
        />
      </GuideSection>

      <GuideSection id="td-trouble" eyebrow="Operations" title="Troubleshooting" tone="warning">
        <ChecklistCard
          tone="warning"
          title="Work from the PLR outward"
          mark="→"
          items={[
            "Is the backup entry installed and marked ready before the failure?",
            "Does the outgoing interface itself avoid the protected resource?",
            "Does every SID in the repair program exist, and what behavior does it actually have?",
            "Where does each transit router's CURRENT FIB send the repair outer's destination?",
            "At the last repair segment, is the outer removed and the intended adjacency used?",
          ]}
        />
      </GuideSection>

      <GuideSection id="td-verify" eyebrow="Operations" title="Verification" tone="success">
        <ChecklistCard
          tone="success"
          title="Evidence, not assumptions"
          mark="✓"
          items={[
            <>
              The PLR&apos;s TI-LFA table: protected resource, repair node, outgoing interface, repair SIDs.
            </>,
            <>
              The repair node&apos;s Local SID Table: behavior, flavor and bound adjacency for the SID in the outer <Mono>DA</Mono>.
            </>,
            "A resend (or trace) while downstream routers are still pre-convergence.",
          ]}
        />
      </GuideSection>

      <GuideSection id="td-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "Post-convergence path", def: "The path SPF selects once the protected resource is removed everywhere." },
            { term: "PQ node", def: "A node in both P-Space and Q-Space — a single End SID can reach it safely." },
            { term: "Repair node", def: "The node whose SID ends the repair program; here it also forces the merge adjacency." },
            { term: "End.X", def: "Endpoint with cross-connect: forces one specific bound adjacency." },
            { term: "USD", def: "Ultimate Segment Decapsulation — removes the whole outer IPv6 header and its extensions." },
            { term: "Micro-loop", def: "A transient loop while routers converge at different times; not what TI-LFA itself solves." },
          ]}
        />
      </GuideSection>

      <GuideSection id="td-mental" eyebrow="Recap" title="Mental model" tone="success">
        <Callout tone="success" title="Recap" icon="✓">
          Compute the post-convergence path, find where P-Space ends, encode just enough segments to get past every stale FIB, and remove the whole repair outer at the last segment. The protected packet never changes; only a temporary wrapper is added and removed.
        </Callout>
      </GuideSection>
    </>
  );
}
