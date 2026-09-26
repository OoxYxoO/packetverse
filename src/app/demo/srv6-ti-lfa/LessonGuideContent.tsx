import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DNode, DiagramFrame, DiagramSvg, FieldTable, FlowSteps, Glossary, GuideSection, Mono } from "@/components/lesson/GuideBlocks";
import { DHeaderColumn, Srv6Topology, type Srv6Link, type Srv6Pos } from "@/components/lesson/Srv6GuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { buildRepairSid, endXFunctionFor, PLR_REPAIR_SOURCE, srSourceFor } from "@/lib/sim-engine/scenarios/srv6TiLfa";

export const SRV6T_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "lt-mission", label: "The mission" },
  { id: "lt-topology", label: "Primary and protection topology" },
  { id: "lt-naive", label: "Why a naive reroute loops" },
  { id: "lt-phases", label: "Precompute, then activate" },
  { id: "lt-pq", label: "P-Space and Q-Space here" },
  { id: "lt-repair", label: "OIF + repair program" },
  { id: "lt-usd", label: "End.X + USD at P4" },
  { id: "lt-walk", label: "The protected packet" },
  { id: "lt-handoff", label: "Convergence handoff" },
  { id: "lt-node", label: "Node protection" },
  { id: "lt-fault", label: "The looping-repair incident" },
  { id: "lt-multi", label: "Single SID vs multi-SID" },
  { id: "lt-vpn", label: "Protecting an L3VPN packet" },
  { id: "lt-mistakes", label: "Common mistakes" },
  { id: "lt-glossary", label: "Glossary" },
  { id: "lt-recap", label: "Mental model" },
];

const POS: Srv6Pos = {
  PE1: [55, 100],
  P1: [185, 100],
  P2: [420, 40],
  PE2: [585, 100],
  P3: [285, 190],
  P4: [455, 190],
};
const LINKS: Srv6Link[] = [
  { a: "PE1", b: "P1", label: "10" },
  { a: "P1", b: "P2", label: "10" },
  { a: "P2", b: "PE2", label: "10" },
  { a: "P1", b: "P3", label: "10" },
  { a: "P3", b: "P4", label: "10" },
  { a: "P4", b: "P2", label: "50" },
  { a: "P4", b: "PE2", label: "70" },
];

function TopologyDiagram() {
  const primary = new Set(["PE1-P1", "P1-P2", "P2-PE2"]);
  return (
    <DiagramSvg h={240} label="Primary path PE1 P1 P2 PE2 with metric 10 per link; protection topology P1 P3 P4 with P4-P2 metric 50 and P4-PE2 metric 70; P1 is the PLR and P1-P2 the protected link">
      <Srv6Topology
        pos={POS}
        links={LINKS.map((l) => (primary.has(`${l.a}-${l.b}`) ? { ...l, color: D.cyan, bold: true, label: `${l.a}-${l.b}` === "P1-P2" ? "10 · protected" : l.label } : { ...l, dashed: true }))}
        sub={{ PE1: "headend", P1: "PLR", P2: "", PE2: "destination" }}
        accent={{ P1: D.warning, PE2: D.success }}
      />
      <text x={320} y={232} textAnchor="middle" fill={D.muted} fontSize={10}>
        solid = primary path (cost 30) · dashed = protection topology · numbers = IGP metrics
      </text>
    </DiagramSvg>
  );
}

function NaiveLoopDiagram() {
  return (
    <DiagramSvg h={150} label="After P1-P2 fails, P1 sends the original packet with DA PE2 to P3; P3 has not converged and its FIB still points to P1, so the packet loops">
      <DNode x={150} y={70} label="P1" sub="knows the failure" accent={D.warning} w={140} />
      <DNode x={470} y={70} label="P3" sub="STALE FIB: PE2 via P1" accent={D.danger} w={170} />
      <DArrow x1={222} y1={56} x2={383} y2={56} color={D.ip} label="DA = PE2 (original)" />
      <DArrow x1={383} y1={86} x2={222} y2={86} color={D.danger} label="back to P1" labelDy={16} />
      <text x={320} y={138} textAnchor="middle" fill={D.muted} fontSize={10}>
        the outgoing interface was fine — the original destination is what P3 misroutes
      </text>
    </DiagramSvg>
  );
}

function PqDiagram() {
  const box = (x: number, w: number, title: string, members: string, sub: string, color: string) => (
    <g>
      <rect x={x} y={26} width={w} height={96} rx={12} fill={color} fillOpacity={0.08} stroke={color} strokeOpacity={0.7} strokeDasharray="6 5" />
      <text x={x + 14} y={48} fill={color} fontSize={11.5} fontWeight={700}>
        {title}
      </text>
      <text x={x + 14} y={76} fill={D.text} fontSize={13} fontWeight={700} fontFamily="monospace">
        {members}
      </text>
      <text x={x + 14} y={104} fill={D.muted} fontSize={9.5}>
        {sub}
      </text>
    </g>
  );
  return (
    <DiagramSvg h={170} label="P-Space of P1 is PE1, P3, P4; Extended P-Space adds nothing here; Q-Space of PE2 is only P2; they do not intersect, so the repair forces the P4 to P2 adjacency">
      {box(20, 190, "P-Space(P1)", "PE1 · P3 · P4", "P1's current paths avoid P1-P2", D.cyan)}
      {box(225, 190, "Extended P-Space", "same set here", "via P1's eligible neighbors", D.violet)}
      {box(430, 190, "Q-Space(PE2)", "P2", "current path to PE2 avoids P1-P2", D.success)}
      <text x={320} y={150} textAnchor="middle" fill={D.muted} fontSize={10}>
        no node is in both — so the repair ends with a forced adjacency from the last P-Space node (P4) into Q-Space (P2)
      </text>
    </DiagramSvg>
  );
}

function RepairAnatomyDiagram() {
  return (
    <DiagramSvg h={150} label="The repair has two parts: the outgoing interface P1 to P3, and the repair program: one SID, P4 End.X plus USD toward P2">
      <DNode x={130} y={60} label="Outgoing interface" sub="P1 → P3" accent={D.cyan} w={190} />
      <text x={320} y={66} textAnchor="middle" fill={D.text} fontSize={18} fontWeight={700}>
        +
      </text>
      <DNode x={510} y={60} label="Repair program" sub="<P4 End.X+USD → P2>" accent={D.violet} w={220} />
      <text x={320} y={126} textAnchor="middle" fill={D.muted} fontSize={10}>
        both precomputed and installed before any failure; the failure only activates them
      </text>
    </DiagramSvg>
  );
}

/** P4's two End.X+USD instances — values read from the lesson's own SID allocation, never retyped. */
const LINK_SID = buildRepairSid("P4", "P2");
const NODE_SID = buildRepairSid("P4", "PE2");
const fnHex = (owner: "P4", adj: "P2" | "PE2") => `0x${endXFunctionFor(owner, adj).toString(16)}`;

function LinkVsNodeSidDiagram() {
  const row = (y: number, sid: string, fn: string, adj: string, lab: string, color: string) => (
    <g>
      <rect x={150} y={y} width={470} height={34} rx={8} fill={color} fillOpacity={0.1} stroke={color} strokeOpacity={0.75} />
      <text x={164} y={y + 21} fill={D.text} fontSize={11.5} fontWeight={700} fontFamily="monospace">
        {sid}
      </text>
      <text x={400} y={y + 21} fill={color} fontSize={10.5} fontWeight={700} fontFamily="monospace">
        End.X+USD → {adj}
      </text>
      <text x={606} y={y + 21} textAnchor="end" fill={D.muted} fontSize={9.5} fontFamily="monospace">
        fn {fn}
      </text>
      <text x={140} y={y + 21} textAnchor="end" fill={D.muted} fontSize={9.5}>
        {lab}
      </text>
    </g>
  );
  return (
    <DiagramSvg h={170} label={`P4's Local SID Table holds two End.X plus USD SIDs: ${LINK_SID.sidText} bound to adjacency P2 for link protection, and ${NODE_SID.sidText} bound to adjacency PE2 for node protection`}>
      <DNode x={70} y={26} label="P4" sub="Local SID Table" accent={D.violet} w={110} />
      {row(56, LINK_SID.sidText, fnHex("P4", "P2"), "P2", "link lab", D.cyan)}
      {row(98, NODE_SID.sidText, fnHex("P4", "PE2"), "PE2", "node lab", D.warning)}
      <text x={320} y={156} textAnchor="middle" fill={D.muted} fontSize={10}>
        one End.X SID = one local instance bound to ONE adjacency · two adjacencies need two SIDs
      </text>
    </DiagramSvg>
  );
}

function LayersDiagram() {
  return (
    <DiagramSvg h={200} label="Leaving P1: repair outer IPv6 with source P1 and destination P4 End.X plus USD, no SRH, wrapping the original PE1 to PE2 packet. After P4: only the original packet, forced toward P2">
      <text x={188} y={20} textAnchor="middle" fill={D.text} fontSize={11.5} fontWeight={700}>
        leaving P1 (toward P3)
      </text>
      <DHeaderColumn
        x={188}
        y={32}
        w={250}
        rows={[
          { text: "repair outer · SA = P1", color: D.warning, tag: "REPAIR", strong: true },
          { text: "DA = P4 End.X+USD", color: D.warning },
          { text: "no SRH (single SID)", color: D.faint },
          { text: "IPv6 · PE1 → PE2 (untouched)", color: D.ip, tag: "ORIGINAL" },
        ]}
      />
      <DArrow x1={318} y1={72} x2={388} y2={72} color={D.faint} label="USD at P4" />
      <text x={505} y={20} textAnchor="middle" fill={D.text} fontSize={11.5} fontWeight={700}>
        leaving P4 (forced to P2)
      </text>
      <DHeaderColumn x={505} y={32} w={210} rows={[{ text: "IPv6 · PE1 → PE2 (untouched)", color: D.ip, tag: "ORIGINAL" }]} />
      <text x={320} y={180} textAnchor="middle" fill={D.muted} fontSize={10}>
        USD removes the ENTIRE repair outer (and any extension headers) — never just an SRH
      </text>
    </DiagramSvg>
  );
}

function NestedDiagram() {
  return (
    <DiagramSvg h={200} label="Nested protection: repair outer from P1 to P4 End.X plus USD wraps the SRv6 L3VPN outer from PE1 to PE2 End.DT4, which wraps customer IPv4; P4 removes only the repair outer">
      <DHeaderColumn
        x={200}
        y={24}
        w={270}
        rows={[
          { text: "repair outer · SA P1 → DA P4 End.X+USD", color: D.warning, tag: "TI-LFA", strong: true },
          { text: "L3VPN outer · SA PE1 → DA PE2 End.DT4", color: D.bgp, tag: "SERVICE" },
          { text: "customer IPv4 10.10.1.10 → 10.20.1.10", color: D.ip, tag: "CUSTOMER" },
        ]}
      />
      <DArrow x1={345} y1={60} x2={400} y2={60} color={D.faint} label="P4" />
      <DHeaderColumn
        x={520}
        y={24}
        w={210}
        rows={[
          { text: "L3VPN outer (intact)", color: D.bgp, strong: true },
          { text: "customer IPv4", color: D.ip },
        ]}
      />
      <text x={320} y={150} textAnchor="middle" fill={D.muted} fontSize={10}>
        P4 does not execute End.DT4 — PE2 does, exactly as if no failure had happened
      </text>
    </DiagramSvg>
  );
}

export function Srv6TiLfaLessonGuideContent() {
  return (
    <>
      <GuideSection id="lt-mission" eyebrow="Introduction" title="The mission: protect traffic before the network converges" tone="danger">
        <p>
          When P1-P2 fails, IGP convergence will eventually fix forwarding everywhere. TI-LFA protects traffic in the gap between local failure detection and that convergence, using a repair P1 computed and installed in advance.
        </p>
        <Callout tone="cyan" title="Scope of this simulation" icon="i">
          One destination (PE2), one PLR (P1), link protection of P1-P2 as the main lab, node protection of P2 as a second lab, a small multi-SID example, and a nested SRv6 L3VPN packet. SRLG, Flex-Algo-aware protection, micro-loop avoidance and restoration-time numbers are previews only.
        </Callout>
      </GuideSection>

      <GuideSection id="lt-topology" eyebrow="Setup" title="Primary and protection topology" tone="ospf">
        <DiagramFrame caption="PLR = P1 · protected resource = link P1-P2 · destination = PE2.">
          <TopologyDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="lt-naive" eyebrow="Motivation" title="Why a naive reroute loops" tone="danger">
        <DiagramFrame caption="Built from real per-router FIB state, not a scripted animation.">
          <NaiveLoopDiagram />
        </DiagramFrame>
        <p>
          The lesson first shows P3&apos;s route to PE2 before any failure: via P1. Until P3 converges, it keeps that route, so any packet still addressed to PE2 comes straight back.
        </p>
      </GuideSection>

      <GuideSection id="lt-phases" eyebrow="Timing" title="Precompute, then activate" tone="cyan">
        <FlowSteps
          steps={[
            { title: "STEADY_STATE", body: "Primary path active; the repair is precomputed and installed.", tone: "success" },
            { title: "LOCAL_FAILURE_DETECTED", body: "P1 sees its own interface go down — no flooding needed.", tone: "danger" },
            { title: "TI_LFA_ACTIVE", body: "P1 wraps protected traffic in the repair. No new computation.", tone: "warning" },
            { title: "IGP_CONVERGING → PLR_CONVERGED → POST_CONVERGENCE", body: "The network converges; the repair is released.", tone: "ospf" },
          ]}
        />
        <p>These phases are a PacketVerse teaching model, not an official state machine, and no restoration time is claimed.</p>
      </GuideSection>

      <GuideSection id="lt-pq" eyebrow="Computation" title="P-Space and Q-Space here" tone="warning">
        <DiagramFrame caption="Computed from the lesson's topology with P1-P2 as the protected resource.">
          <PqDiagram />
        </DiagramFrame>
        <p>
          The post-convergence path is P1 → P3 → P4 → P2 → PE2. PacketVerse picks the last P-Space node on that path (P4) as the repair node and forces the next hop (P2) as the merge point. This is a documented educational strategy — real implementations may choose differently among valid repairs.
        </p>
      </GuideSection>

      <GuideSection id="lt-repair" eyebrow="Repair" title="OIF + repair program" tone="violet">
        <DiagramFrame caption="A TI-LFA repair is never just a SID list.">
          <RepairAnatomyDiagram />
        </DiagramFrame>
        <p>
          P4&apos;s End.X SID is globally routed through P4&apos;s locator, so the program needs no separate P4 End SID first. With one SID the repair needs no SRH: the SID fits in the outer destination address.
        </p>
      </GuideSection>

      <GuideSection id="lt-usd" eyebrow="Endpoint behavior" title="End.X + USD at P4" tone="violet">
        <CompareCards
          items={[
            { title: "End.X", tone: "violet", tag: "base behavior", points: ["Local SID match at P4", "Forces the P4→P2 adjacency", "Never rewrites the exposed packet's destination"] },
            { title: "USD flavor", tone: "warning", tag: "Ultimate Segment Decapsulation", points: ["Removes the entire repair outer IPv6 header and its extensions", "Exposes the packet underneath", "Not USP, not PSP, not MPLS PHP"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="lt-walk" eyebrow="Data plane" title="The protected packet" tone="ip">
        <DiagramFrame caption="P3 forwards on P4's locator with its ordinary FIB — no TI-LFA knowledge needed.">
          <LayersDiagram />
        </DiagramFrame>
        <FieldTable
          title="Source ownership"
          accent="ip"
          columns={["Header", "Built by", "Source address"]}
          rows={[
            ["Original IPv6 packet", "PE1", <Mono key="a">{srSourceFor("PE1")}</Mono>],
            ["TI-LFA repair outer", "P1 (the PLR)", <Mono key="b">{PLR_REPAIR_SOURCE}</Mono>],
          ]}
        />
      </GuideSection>

      <GuideSection id="lt-handoff" eyebrow="Convergence" title="Convergence handoff" tone="success">
        <p>Once P3, P4, P2 and finally P1 have converged, P1&apos;s own FIB already follows P1 → P3 → P4 → P2 → PE2. The repair outer is released and ordinary forwarding carries traffic — TI-LFA was temporary by design.</p>
      </GuideSection>

      <GuideSection id="lt-node" eyebrow="Variant" title="Node protection" tone="warning">
        <CompareCards
          items={[
            { title: "Link protection (P1-P2)", tone: "cyan", tag: "main lab", points: ["P2 is still alive", "Repair: P4 End.X+USD → P2"] },
            { title: "Node protection (P2)", tone: "warning", tag: "second lab", points: ["P2 is presumed gone", "Repair: P4 End.X+USD → PE2 over P4-PE2"] },
          ]}
        />
        <DiagramFrame caption="Same repair node, same outgoing interface P1→P3 — a different End.X SID, because the bound adjacency differs.">
          <LinkVsNodeSidDiagram />
        </DiagramFrame>
        <p>
          An End.X SID identifies one locally instantiated behavior together with its bound adjacency, so P4 cannot reuse one SID for both labs. Function <Mono>{fnHex("P4", "P2")}</Mono> is P4&apos;s first End.X instance; <Mono>{fnHex("P4", "PE2")}</Mono> is a PacketVerse-local function allocation for the second — RFC 8986 leaves function values to the operator and assigns no value to this binding.
        </p>
      </GuideSection>

      <GuideSection id="lt-fault" eyebrow="Troubleshooting" title="The looping-repair incident" tone="danger">
        <ChecklistCard
          tone="danger"
          title="How to reason about it (no spoilers)"
          mark="→"
          items={[
            "Confirm what works: detection, the backup entry, every alternate link.",
            "Trace the repaired packet hop by hop and note where it turns back.",
            "At that router, compare the packet's outer destination with that router's CURRENT (possibly stale) FIB.",
            "Separate the two halves of the repair: outgoing interface and repair program — check each on its own.",
            "After a fix, resend while the stale FIB is still modeled; recomputation alone is not proof.",
          ]}
        />
      </GuideSection>

      <GuideSection id="lt-multi" eyebrow="Contrast" title="Single SID vs multi-SID" tone="cyan">
        <FieldTable
          title="Two separate cases in this lesson"
          accent="cyan"
          columns={["Case", "Outer DA", "SRH"]}
          rows={[
            ["Main repair <P4 End.X+USD>", "P4 End.X+USD", "None — one SID fits in the DA"],
            ["Education example <S1, S2>", "S1", "SL 1 · LE 1 · [0] S2 · [1] S1"],
          ]}
        />
      </GuideSection>

      <GuideSection id="lt-vpn" eyebrow="Integration" title="Protecting an L3VPN packet" tone="bgp">
        <DiagramFrame caption="Two independent layers: the temporary repair and the customer service.">
          <NestedDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="lt-mistakes" eyebrow="Troubleshooting" title="Common mistakes" tone="warning">
        <ChecklistCard
          tone="warning"
          title="Avoid these"
          mark="!"
          items={[
            "Reading \"Topology Independent\" as \"needs no topology\".",
            "Describing the repair as only a SID list, forgetting the outgoing interface.",
            "Expecting every transit router to run TI-LFA.",
            "Saying USD removes only the SRH.",
            "Adding an SRH to a single-SID repair.",
            "Assuming TI-LFA preserves an SR Policy's latency or affinity intent.",
          ]}
        />
      </GuideSection>

      <GuideSection id="lt-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "PLR", def: "Point of Local Repair — here P1, directly upstream of the protected link." },
            { term: "P-Space", def: "Nodes the PLR's current shortest paths reach without the protected resource." },
            { term: "Q-Space", def: "Nodes whose own current path to the destination avoids the protected resource." },
            { term: "Post-convergence path", def: "The path SPF settles on once the resource is removed everywhere." },
            { term: "Repair program", def: "The SID list the PLR imposes; here one End.X+USD SID." },
            { term: "USD", def: "End.X flavor that removes the whole repair outer and exposes the packet underneath." },
            { term: "Stale FIB", def: "A router's forwarding entry computed before it learned of the failure." },
          ]}
        />
      </GuideSection>

      <GuideSection id="lt-recap" eyebrow="Recap" title="Mental model" tone="success">
        <Callout tone="success" title="One sentence" icon="✓">
          P1 precomputes an outgoing interface plus a repair program whose destination no stale router can misread; when P1-P2 fails it wraps traffic immediately, P4&apos;s End.X+USD removes that wrapper and forces the safe link, and convergence later takes over.
        </Callout>
      </GuideSection>
    </>
  );
}
