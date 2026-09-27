import { Callout, ChecklistCard, DArrow, DIAGRAM as D, DNode, DiagramFrame, DiagramSvg, Glossary, GuideSection } from "@/components/lesson/GuideBlocks";
import { DRouteCard } from "@/components/lesson/EvpnGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { HOST_A_MAC, VTEP_LOOPBACK } from "@/lib/sim-engine/scenarios/evpnMacMobility";

export const EVPNM_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "dm-ec", label: "The MAC Mobility EC" },
  { id: "dm-rules", label: "RFC 7432 §15 rules" },
  { id: "dm-lifecycle", label: "Route lifecycle" },
  { id: "dm-tables", label: "Tables that must agree" },
  { id: "dm-sticky", label: "Sticky MACs & duplicate detection" },
  { id: "dm-stale", label: "Stale state" },
  { id: "dm-trouble", label: "Troubleshooting" },
  { id: "dm-verify", label: "Verification" },
  { id: "dm-glossary", label: "Glossary" },
  { id: "dm-mental", label: "Mental model" },
];

function EcDiagram() {
  return (
    <DiagramSvg h={170} label="MAC Mobility extended community: type and sub-type, a sticky/static flag, and a 32-bit sequence number">
      <DRouteCard x={150} y={16} w={340} title="MAC Mobility Extended Community (conceptual)" rows={[{ label: "Type / Sub-type", value: "EVPN / MAC Mobility" }, { label: "Flags", value: "sticky / static bit" }, { label: "Sequence number", value: "32 bits", strong: true }]} />
      <text x={320} y={140} textAnchor="middle" fill={D.muted} fontSize={10}>
        a route attribute — carried in BGP, never inside tenant frames
      </text>
    </DiagramSvg>
  );
}

function RulesDiagram() {
  const box = (x: number, t: string, s: string, c: string) => (
    <g>
      <rect x={x} y={30} width={180} height={62} rx={10} fill={c} fillOpacity={0.12} stroke={c} strokeOpacity={0.75} />
      <text x={x + 90} y={54} textAnchor="middle" fill={D.text} fontSize={11} fontWeight={700}>
        {t}
      </text>
      <text x={x + 90} y={74} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        {s}
      </text>
    </g>
  );
  return (
    <DiagramSvg h={150} label="First advertisement carries no EC (treated as 0); a new location advertises last sequence plus one; the highest sequence wins and the old owner withdraws">
      {box(14, "First advertisement", "no EC → treated as 0", D.faint)}
      <DArrow x1={196} y1={61} x2={228} y2={61} color={D.faint} width={1.4} />
      {box(230, "New location", "EC = last seq + 1", D.bgp)}
      <DArrow x1={412} y1={61} x2={444} y2={61} color={D.faint} width={1.4} />
      {box(446, "Highest wins", "old owner withdraws", D.success)}
      <text x={320} y={128} textAnchor="middle" fill={D.muted} fontSize={10}>
        presence of the EC depends on &quot;is this a move?&quot;, not on the number itself
      </text>
    </DiagramSvg>
  );
}

function LifecycleDiagram() {
  return (
    <DiagramSvg h={190} label={`Route lifecycle for ${HOST_A_MAC}: advertised by LEAF1, superseded by LEAF2's newer route, LEAF1 withdraws its old one`}>
      <DNode x={110} y={40} label="LEAF1 advertises" sub="no EC (eff. 0)" accent={D.faint} w={170} />
      <DArrow x1={196} y1={40} x2={236} y2={40} color={D.faint} />
      <DNode x={320} y={40} label="LEAF2 advertises" sub="EC seq 1" accent={D.bgp} w={160} />
      <DArrow x1={401} y1={40} x2={441} y2={40} color={D.faint} />
      <DNode x={530} y={40} label="LEAF1 withdraws" sub="old route gone" accent={D.danger} w={170} />
      <DRouteCard x={170} y={92} w={300} title="Active RIB afterwards" color={D.success} rows={[{ label: HOST_A_MAC, value: `via ${VTEP_LOOPBACK.LEAF2}`, strong: true }]} />
    </DiagramSvg>
  );
}

function TablesDiagram() {
  return (
    <DiagramSvg h={170} label="A receiving VTEP has a BGP EVPN table, a selected route and a MAC forwarding table; all three must reflect the newest location">
      <DNode x={110} y={60} label="EVPN table" sub="routes received" accent={D.bgp} w={150} />
      <DArrow x1={186} y1={60} x2={246} y2={60} color={D.faint} />
      <DNode x={320} y={60} label="Selection" sub="best route per MAC" accent={D.warning} w={140} />
      <DArrow x1={391} y1={60} x2={451} y2={60} color={D.faint} />
      <DNode x={530} y={60} label="MAC table" sub="remote VTEP used" accent={D.ip} w={150} />
      <text x={320} y={130} textAnchor="middle" fill={D.muted} fontSize={10}>
        each arrow is a step that can lag behind the one before it
      </text>
    </DiagramSvg>
  );
}

function StickyDiagram() {
  return (
    <DiagramSvg h={160} label="Sticky/static MACs are never moved by mobility; rapid repeated moves trigger duplicate-MAC detection">
      <DRouteCard x={30} y={20} w={270} title="Sticky / static MAC" color={D.warning} rows={[{ label: "flag", value: "sticky bit set" }, { label: "effect", value: "move not accepted", strong: true }]} />
      <DRouteCard x={340} y={20} w={270} title="Duplicate detection" color={D.danger} rows={[{ label: "trigger", value: "N moves within M seconds" }, { label: "effect", value: "stop / alert", strong: true }]} />
      <text x={320} y={132} textAnchor="middle" fill={D.muted} fontSize={10}>
        context from RFC 7432 §15 — outside this lesson&apos;s simulation
      </text>
    </DiagramSvg>
  );
}

export function EvpnMacMobilityDeepDiveContent() {
  return (
    <>
      <GuideSection id="dm-ec" eyebrow="Control plane" title="The MAC Mobility EC" tone="bgp">
        <DiagramFrame caption="What the extended community carries.">
          <EcDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="dm-rules" eyebrow="Standard" title="RFC 7432 §15 rules" tone="violet">
        <DiagramFrame caption="The ordering rules in three steps.">
          <RulesDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="dm-lifecycle" eyebrow="Control plane" title="Route lifecycle" tone="bgp">
        <DiagramFrame caption="Supersede, then withdraw.">
          <LifecycleDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="dm-tables" eyebrow="Model" title="Tables that must agree" tone="warning">
        <DiagramFrame caption="From received route to forwarding entry.">
          <TablesDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="dm-sticky" eyebrow="Context" title="Sticky MACs & duplicate detection" tone="danger">
        <DiagramFrame caption="Safeguards around mobility.">
          <StickyDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="dm-stale" eyebrow="Operations" title="Stale state" tone="warning">
        <p>Stale state means some table still reflects an older truth. The control plane can be perfectly correct while one device&apos;s local state has not caught up.</p>
      </GuideSection>

      <GuideSection id="dm-trouble" eyebrow="Operations" title="Troubleshooting" tone="warning">
        <ChecklistCard tone="warning" title="Ladder" mark="→" items={["Endpoint identity unchanged?", "Newest advertisement received, with the expected sequence?", "Older advertisement withdrawn?", "Newest route selected?", "Forwarding entry points at the new VTEP?", "Real frame delivered at the new location?"]} />
      </GuideSection>

      <GuideSection id="dm-verify" eyebrow="Operations" title="Verification" tone="success">
        <ChecklistCard tone="success" title="Evidence" mark="✓" items={["Remote MAC table shows the new VTEP.", "Outer destination of real traffic is the new VTEP.", "No stale entry for the endpoint anywhere."]} />
      </GuideSection>

      <GuideSection id="dm-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "Sticky MAC", def: "A MAC flagged static; mobility must not move it." },
            { term: "Duplicate MAC detection", def: "Stops endless flapping when a MAC moves too often." },
            { term: "Stale entry", def: "Local state that still reflects an older location." },
          ]}
        />
      </GuideSection>

      <GuideSection id="dm-mental" eyebrow="Recap" title="Mental model" tone="success">
        <Callout tone="success" title="Recap" icon="✓">
          Sequence numbers order the moves, withdrawals clean up the past, and every VTEP&apos;s selection and forwarding state must follow the newest advertisement.
        </Callout>
      </GuideSection>
    </>
  );
}
