import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DNode, DiagramFrame, DiagramSvg, Glossary, GuideSection } from "@/components/lesson/GuideBlocks";
import { DRouteCard, EvpnFabric } from "@/components/lesson/EvpnGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { HOST_A_IP, HOST_A_MAC, HOST_B_IP, VNI, VTEP_LOOPBACK } from "@/lib/sim-engine/scenarios/evpnMacMobility";

export const EVPNM_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "lm-mission", label: "The mission" },
  { id: "lm-fabric", label: "Before the move" },
  { id: "lm-identity", label: "Identity vs location" },
  { id: "lm-first", label: "The first advertisement" },
  { id: "lm-move", label: "The move" },
  { id: "lm-compare", label: "Newer wins" },
  { id: "lm-withdraw", label: "Withdrawal vs history" },
  { id: "lm-paths", label: "Path before and after" },
  { id: "lm-select", label: "Received ≠ selected" },
  { id: "lm-fault", label: "The stale-path incident" },
  { id: "lm-multihoming", label: "Mobility ≠ multihoming" },
  { id: "lm-glossary", label: "Glossary" },
  { id: "lm-recap", label: "Mental model" },
];

function FabricDiagram() {
  return (
    <DiagramSvg h={250} label={`HOST-A (${HOST_A_IP}) starts on LEAF1, HOST-B (${HOST_B_IP}) on LEAF3, all in VNI ${VNI}`}>
      <EvpnFabric
        leaves={[
          { id: "LEAF1", sub: `VTEP ${VTEP_LOOPBACK.LEAF1}`, host: "HOST-A", hostSub: HOST_A_IP, accent: D.warning },
          { id: "LEAF2", sub: `VTEP ${VTEP_LOOPBACK.LEAF2}` },
          { id: "LEAF3", sub: `VTEP ${VTEP_LOOPBACK.LEAF3}`, host: "HOST-B", hostSub: HOST_B_IP },
        ]}
      />
      <text x={320} y={244} textAnchor="middle" fill={D.muted} fontSize={10}>
        HOST-A&apos;s starting attachment — it will not stay here
      </text>
    </DiagramSvg>
  );
}

function IdentityDiagram() {
  return (
    <DiagramSvg h={170} label={`Identity ${HOST_A_MAC} / ${HOST_A_IP} stays the same; location (which VTEP) changes`}>
      <DRouteCard x={30} y={20} w={270} title="Identity — unchanged" color={D.eth} rows={[{ label: "MAC", value: HOST_A_MAC, strong: true }, { label: "IP", value: HOST_A_IP, strong: true }]} />
      <DRouteCard x={340} y={20} w={270} title="Location — changes" color={D.warning} rows={[{ label: "attached to", value: "a leaf / VTEP" }, { label: "advertised as", value: "BGP next hop" }]} />
      <text x={320} y={130} textAnchor="middle" fill={D.muted} fontSize={10}>
        a legitimate move changes WHERE, never WHO
      </text>
    </DiagramSvg>
  );
}

function FirstAdvDiagram() {
  return (
    <DiagramSvg h={190} label={`LEAF1's first Type 2 advertisement for HOST-A carries no MAC Mobility extended community; its effective sequence is 0`}>
      <DRouteCard
        x={150}
        y={14}
        w={340}
        title="Type 2 — HOST-A (first advertisement)"
        rows={[
          { label: "MAC / IP", value: `${HOST_A_MAC} / ${HOST_A_IP}` },
          { label: "BGP next hop", value: `${VTEP_LOOPBACK.LEAF1} (LEAF1)`, strong: true },
          { label: "MAC Mobility EC", value: "not carried" },
          { label: "effective sequence", value: "0", strong: true },
        ]}
      />
      <text x={320} y={150} textAnchor="middle" fill={D.muted} fontSize={10}>
        RFC 7432 §15: a route without the community is treated as sequence 0
      </text>
    </DiagramSvg>
  );
}

function MoveDiagram() {
  return (
    <DiagramSvg h={150} label="HOST-A detaches from LEAF1 and attaches to LEAF2; the new leaf learns it locally">
      <DNode x={120} y={60} label="LEAF1" sub="HOST-A leaves" accent={D.faint} w={150} />
      <DArrow x1={196} y1={60} x2={444} y2={60} color={D.warning} label="HOST-A moves" />
      <DNode x={520} y={60} label="LEAF2" sub="learns HOST-A locally" accent={D.warning} w={150} />
      <text x={320} y={128} textAnchor="middle" fill={D.muted} fontSize={10}>
        the fabric has to find out — and every remote VTEP has to agree on the new location
      </text>
    </DiagramSvg>
  );
}

function SequenceDiagram() {
  const cols = [
    { title: "First advertisement", via: "LEAF1", ec: "no EC", eff: "0", color: D.faint },
    { title: "After move 1", via: "LEAF2", ec: "EC seq 1", eff: "1", color: D.bgp },
    { title: "After move 2", via: "LEAF1", ec: "EC seq 2", eff: "2", color: D.violet },
  ];
  return (
    <DiagramSvg h={190} label="HOST-A's advertisements over time: via LEAF1 with no EC (effective 0), via LEAF2 with EC sequence 1, via LEAF1 with EC sequence 2">
      {cols.map((c, i) => (
        <g key={c.title}>
          <DRouteCard x={16 + i * 208} y={20} w={192} title={c.title} color={c.color} rows={[{ label: "next hop", value: c.via }, { label: "carried", value: c.ec }, { label: "effective seq", value: c.eff, strong: true }]} />
          {i < cols.length - 1 && <DArrow x1={210 + i * 208} y1={60} x2={222 + i * 208} y2={60} color={D.faint} width={1.4} />}
        </g>
      ))}
      <text x={320} y={150} textAnchor="middle" fill={D.text} fontSize={11}>
        higher sequence = newer location
      </text>
      <text x={320} y={170} textAnchor="middle" fill={D.muted} fontSize={10}>
        a sequence number, not a hop count and not a timestamp
      </text>
    </DiagramSvg>
  );
}

function PathsDiagram() {
  return (
    <DiagramSvg h={170} label={`Before the move LEAF3 encapsulates HOST-A's traffic toward ${VTEP_LOOPBACK.LEAF1}; after it, toward ${VTEP_LOOPBACK.LEAF2}`}>
      <DRouteCard x={30} y={20} w={270} title="Before the move" color={D.faint} rows={[{ label: "LEAF3 → HOST-A", value: `outer dst ${VTEP_LOOPBACK.LEAF1}`, strong: true }]} />
      <DRouteCard x={340} y={20} w={270} title="After the move" color={D.ip} rows={[{ label: "LEAF3 → HOST-A", value: `outer dst ${VTEP_LOOPBACK.LEAF2}`, strong: true }]} />
      <text x={320} y={110} textAnchor="middle" fill={D.text} fontSize={11}>
        same inner frame, different outer destination
      </text>
      <text x={320} y={132} textAnchor="middle" fill={D.muted} fontSize={10}>
        the data plane follows whichever route LEAF3 has selected
      </text>
    </DiagramSvg>
  );
}

export function EvpnMacMobilityLessonGuideContent() {
  return (
    <>
      <GuideSection id="lm-mission" eyebrow="Introduction" title="The mission: follow a moving endpoint" tone="cyan">
        <p>Virtual machines and hosts move. When HOST-A re-attaches somewhere else, every VTEP must stop sending its traffic to the old place — without HOST-A changing its MAC or IP.</p>
      </GuideSection>

      <GuideSection id="lm-fabric" eyebrow="Setup" title="Before the move" tone="ospf">
        <DiagramFrame caption="The lesson's starting topology.">
          <FabricDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="lm-identity" eyebrow="Concept" title="Identity vs location" tone="warning">
        <DiagramFrame caption="The key separation in this lesson.">
          <IdentityDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="lm-first" eyebrow="Control plane" title="The first advertisement" tone="bgp">
        <DiagramFrame caption="Values from this lesson's first Type 2 route.">
          <FirstAdvDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="lm-move" eyebrow="Event" title="The move" tone="warning">
        <DiagramFrame caption="You trigger this move yourself in the lesson.">
          <MoveDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="lm-compare" eyebrow="Control plane" title="Newer wins" tone="bgp">
        <DiagramFrame caption="How HOST-A's advertisements evolve across both moves.">
          <SequenceDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="lm-withdraw" eyebrow="Control plane" title="Withdrawal vs history" tone="violet">
        <Callout tone="cyan" title="History is not the RIB" icon="i">
          The lesson keeps every past advertisement visible so you can compare them. In real EVPN, the previous owner withdraws its older route once a newer one exists — the active RIB holds only the current location.
        </Callout>
      </GuideSection>

      <GuideSection id="lm-paths" eyebrow="Data plane" title="Path before and after" tone="ip">
        <DiagramFrame caption="What LEAF3's encapsulation looks like on each side of the move.">
          <PathsDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="lm-select" eyebrow="Concept" title="Received ≠ selected" tone="warning">
        <p>Receiving a route and forwarding with it are separate steps. A VTEP can hold the newer advertisement in its table and still send traffic somewhere else.</p>
      </GuideSection>

      <GuideSection id="lm-fault" eyebrow="Troubleshooting" title="The stale-path incident" tone="danger">
        <ChecklistCard tone="danger" title="How to reason about it (no spoilers)" mark="→" items={["Confirm what changed and what did not.", "Walk the layers: underlay, BGP session, routes received, local tables, forwarding.", "At each layer, look for evidence rather than assumptions.", "Pick the fix only for the first layer that fails."]} />
      </GuideSection>

      <GuideSection id="lm-multihoming" eyebrow="Scope" title="Mobility ≠ multihoming" tone="violet">
        <CompareCards
          items={[
            { title: "Mobility", tone: "warning", tag: "this lesson", points: ["One attachment at a time", "Location changes over time", "Sequence number orders the moves"] },
            { title: "Multihoming", tone: "violet", tag: "later lesson", points: ["Several attachments at once", "Intentional redundancy", "Uses Ethernet Segments, not mobility sequences"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="lm-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "MAC Mobility EC", def: "Extended community carrying a sequence number on a Type 2 route (RFC 7432 §15)." },
            { term: "Effective sequence", def: "The sequence used for comparison; 0 when no MAC Mobility EC is carried." },
            { term: "Withdrawal", def: "A BGP message removing a previously advertised route." },
            { term: "Selected route", def: "The route a VTEP actually uses for forwarding." },
          ]}
        />
      </GuideSection>

      <GuideSection id="lm-recap" eyebrow="Recap" title="Mental model" tone="success">
        <Callout tone="success" title="One sentence" icon="✓">
          The endpoint keeps its identity; its location is re-advertised with a higher mobility sequence; the old route is withdrawn; and every VTEP must actually select the newest location for forwarding to follow.
        </Callout>
      </GuideSection>
    </>
  );
}
