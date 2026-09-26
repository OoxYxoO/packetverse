import { Callout, ChecklistCard, DArrow, DIAGRAM as D, DNode, DiagramFrame, DiagramSvg, FieldTable, Glossary, GuideSection } from "@/components/lesson/GuideBlocks";
import { DHeaderColumn } from "@/components/lesson/Srv6GuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { REQUIREMENT_MATRIX, USD_ALTERNATIVE } from "./guideModel";

export const SRCMP_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "kd-arch", label: "One architecture, two encodings" },
  { id: "kd-anatomy", label: "Label vs SID anatomy" },
  { id: "kd-adj", label: "Adjacency scope" },
  { id: "kd-usd", label: "An extra steering SID" },
  { id: "kd-control", label: "Control plane" },
  { id: "kd-migration", label: "Coexistence and migration" },
  { id: "kd-matrix", label: "Requirement matrix" },
  { id: "kd-trouble", label: "Troubleshooting" },
  { id: "kd-verify", label: "Verification" },
  { id: "kd-glossary", label: "Glossary" },
  { id: "kd-mental", label: "Mental model" },
];

function ArchitectureDiagram() {
  return (
    <DiagramSvg h={190} label="Segment Routing (RFC 8402) is one architecture: a headend imposes an ordered list of segments; SR-MPLS encodes segments as MPLS labels, SRv6 encodes them as IPv6 SIDs">
      <DNode x={320} y={34} label="Segment Routing" sub="RFC 8402 — ordered segments at the headend" accent={D.violet} w={300} />
      <DArrow x1={260} y1={57} x2={180} y2={104} color={D.faint} width={1.5} />
      <DArrow x1={380} y1={57} x2={460} y2={104} color={D.faint} width={1.5} />
      <DNode x={160} y={128} label="SR-MPLS" sub="RFC 8660 — label stack" accent={D.mpls} w={200} />
      <DNode x={480} y={128} label="SRv6" sub="RFC 8754 / 8986 — SIDs + SRH" accent={D.ip} w={200} />
      <text x={320} y={178} textAnchor="middle" fill={D.muted} fontSize={10}>
        same concepts (Node/Prefix, Adjacency, Binding, Service segments) — different wire formats
      </text>
    </DiagramSvg>
  );
}

function AnatomyDiagram() {
  const field = (x: number, w: number, y: number, label: string, color: string) => (
    <g>
      <rect x={x} y={y} width={w} height={30} rx={5} fill={color} fillOpacity={0.16} stroke={color} strokeOpacity={0.8} />
      <text x={x + w / 2} y={y + 19} textAnchor="middle" fill={color} fontSize={10} fontWeight={700}>
        {label}
      </text>
    </g>
  );
  return (
    <DiagramSvg h={180} label="An MPLS shim is 32 bits: label 20, traffic class 3, bottom-of-stack 1, TTL 8. An SRv6 SID is a 128-bit IPv6 address: locator, function and optional argument">
      <text x={24} y={34} fill={D.mpls} fontSize={11} fontWeight={700}>
        MPLS shim · 32 bits
      </text>
      {field(170, 250, 14, "Label 20", D.mpls)}
      {field(424, 50, 14, "TC 3", D.faint)}
      {field(478, 40, 14, "S 1", D.warning)}
      {field(522, 90, 14, "TTL 8", D.faint)}
      <text x={24} y={104} fill={D.ip} fontSize={11} fontWeight={700}>
        SRv6 SID · 128 bits
      </text>
      {field(170, 220, 84, "Locator", D.ip)}
      {field(394, 120, 84, "Function", D.violet)}
      {field(518, 94, 84, "Argument", D.faint)}
      <text x={320} y={150} textAnchor="middle" fill={D.muted} fontSize={10}>
        a label is looked up in an LFIB; a SID is routed by its locator and executed in a Local SID Table
      </text>
    </DiagramSvg>
  );
}

function AdjScopeDiagram() {
  return (
    <DiagramSvg h={200} label="A locally significant adjacency segment only has meaning at its owner, so a Node segment must bring the packet there first; a globally routed adjacency segment reaches the owner and forces the link in one instruction">
      <text x={24} y={34} fill={D.text} fontSize={11} fontWeight={700}>
        local adjacency
      </text>
      <DHeaderColumn x={330} y={16} w={300} rows={[{ text: "Node segment → owner", color: D.mpls }, { text: "local Adj segment → link", color: D.mpls, strong: true }]} />
      <text x={24} y={124} fill={D.text} fontSize={11} fontWeight={700}>
        globally routed adjacency
      </text>
      <DHeaderColumn x={330} y={106} w={300} rows={[{ text: "one segment: reach owner + force link", color: D.ip, strong: true }]} />
      <text x={320} y={178} textAnchor="middle" fill={D.muted} fontSize={10}>
        SRv6 End.X is routed via its locator; MPLS Adj-SIDs can also be global (RFC 8402)
      </text>
    </DiagramSvg>
  );
}

function UsdDiagram() {
  return (
    <DiagramSvg h={210} label={`Advanced alternative: one additional steering outer, source ${USD_ALTERNATIVE.steeringSource}, destination ${USD_ALTERNATIVE.steeringSid} End.X plus USD, around the existing transport packet whose destination is ${USD_ALTERNATIVE.transportDa}`}>
      <DHeaderColumn
        x={330}
        y={20}
        w={380}
        rows={[
          { text: `SA ${USD_ALTERNATIVE.steeringSource} · DA ${USD_ALTERNATIVE.steeringSid}`, color: D.warning, tag: "STEERING", strong: true },
          { text: `transport outer · DA ${USD_ALTERNATIVE.transportDa}`, color: D.ip, tag: "TRANSPORT" },
          { text: "customer IPv4", color: D.eth },
        ]}
      />
      <text x={330} y={120} textAnchor="middle" fill={D.text} fontSize={11}>
        End.X + USD at P4 removes only the steering outer, then forces P4→{USD_ALTERNATIVE.forwardedTo}
      </text>
      <text x={330} y={146} textAnchor="middle" fill={D.muted} fontSize={10}>
        {USD_ALTERNATIVE.steeringSidCount} additional steering SID around {USD_ALTERNATIVE.transportSidCount} existing transport SID — not &quot;one SID total&quot;
      </text>
    </DiagramSvg>
  );
}

function ControlPlaneDiagram() {
  return (
    <DiagramSvg h={200} label="Control plane only: PE1 and PE2 peer with the route reflector RR1 over MP-BGP; the IGP distributes SIDs and labels; RR1 is never on the packet path">
      <DNode x={320} y={36} label="RR1" sub="control plane only" accent={D.bgp} w={170} />
      <DNode x={120} y={120} label="PE1" sub="VPN routes" accent={D.ip} w={130} />
      <DNode x={520} y={120} label="PE2" sub="VPN routes" accent={D.ip} w={130} />
      <DArrow x1={262} y1={62} x2={170} y2={96} color={D.bgp} both />
      <DArrow x1={378} y1={62} x2={470} y2={96} color={D.bgp} both />
      <text x={196} y={70} textAnchor="end" fill={D.bgp} fontSize={10.5} fontWeight={700}>
        MP-BGP
      </text>
      <text x={444} y={70} fill={D.bgp} fontSize={10.5} fontWeight={700}>
        MP-BGP
      </text>
      <DArrow x1={190} y1={140} x2={450} y2={140} color={D.ospf} dashed label="IGP: Node/Adj SIDs or locators" labelDy={18} />
      <text x={320} y={188} textAnchor="middle" fill={D.muted} fontSize={10}>
        customer packets never visit RR1 in either architecture
      </text>
    </DiagramSvg>
  );
}

function MigrationDiagram() {
  return (
    <DiagramSvg h={170} label="Coexistence: one IGP can carry both MPLS SIDs and SRv6 locators, so services can move gradually from one encoding to the other">
      <DNode x={320} y={34} label="One IGP" sub="SR-MPLS SIDs + SRv6 locators" accent={D.ospf} w={260} />
      <DArrow x1={260} y1={57} x2={190} y2={100} color={D.faint} width={1.5} />
      <DArrow x1={380} y1={57} x2={450} y2={100} color={D.faint} width={1.5} />
      <DNode x={170} y={120} label="services on SR-MPLS" sub="existing" accent={D.mpls} w={210} />
      <DNode x={470} y={120} label="services on SRv6" sub="introduced gradually" accent={D.ip} w={210} />
      <text x={320} y={162} textAnchor="middle" fill={D.muted} fontSize={10}>
        a per-service choice, not a flag day
      </text>
    </DiagramSvg>
  );
}

export function SrMplsVsSrv6DeepDiveContent() {
  return (
    <>
      <GuideSection id="kd-arch" eyebrow="Background" title="One architecture, two encodings" tone="violet">
        <DiagramFrame caption="Segment Routing defines what a segment means; the data plane defines how it is carried.">
          <ArchitectureDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="kd-anatomy" eyebrow="Encoding" title="Label vs SID anatomy" tone="mpls">
        <DiagramFrame caption="Different sizes, different lookups.">
          <AnatomyDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="kd-adj" eyebrow="Encoding" title="Adjacency scope" tone="warning">
        <DiagramFrame caption="Why segment counts can differ for the same path.">
          <AdjScopeDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="kd-usd" eyebrow="Advanced" title="An extra steering SID" tone="warning">
        <DiagramFrame caption="Values from the lesson's own End.X + USD alternative.">
          <UsdDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="kd-control" eyebrow="Control plane" title="Control plane" tone="bgp">
        <DiagramFrame caption="A control-plane diagram — not a packet path.">
          <ControlPlaneDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="kd-migration" eyebrow="Operations" title="Coexistence and migration" tone="ospf">
        <DiagramFrame caption="Both encodings can run on one network.">
          <MigrationDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="kd-matrix" eyebrow="Decisions" title="Requirement matrix" tone="cyan">
        <FieldTable title="From the lesson's own matrix — no row names a winner" accent="cyan" columns={["Requirement", "SR-MPLS", "SRv6"]} rows={REQUIREMENT_MATRIX.map((r) => [r.requirement, r.srMpls, r.srv6])} />
      </GuideSection>

      <GuideSection id="kd-trouble" eyebrow="Operations" title="Troubleshooting" tone="warning">
        <ChecklistCard
          tone="warning"
          title="What to inspect at each rung"
          mark="→"
          items={["SR-MPLS: label bindings, LFIB entries, PHP behavior, bottom-of-stack bit.", "SRv6: locator routes, Local SID Table entries, SRH Segments Left, decapsulation behavior.", "Both: BGP route present, RT imported into the VRF, data plane proven with a resend."]}
        />
      </GuideSection>

      <GuideSection id="kd-verify" eyebrow="Operations" title="Verification" tone="success">
        <ChecklistCard tone="success" title="Evidence" mark="✓" items={["Label stack or outer IPv6 + SRH at each hop.", "The egress action (PHP + lookup, or End.DT4 decapsulation + lookup).", "Delivery at the customer edge after any fix."]} />
      </GuideSection>

      <GuideSection id="kd-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "LFIB", def: "Label Forwarding Information Base — incoming label to operation and next hop." },
            { term: "Locator", def: "The routable prefix part of an SRv6 SID." },
            { term: "Local SID Table", def: "Where an SRv6 node binds its SIDs to behaviors." },
            { term: "Route reflector", def: "A BGP control-plane node; never a data-plane hop here." },
          ]}
        />
      </GuideSection>

      <GuideSection id="kd-mental" eyebrow="Recap" title="Mental model" tone="success">
        <Callout tone="success" title="Recap" icon="✓">
          Decide what the network must do first — transport, TE, services, protection. Then choose the encoding that fits your constraints; both carry the same Segment Routing program.
        </Callout>
      </GuideSection>
    </>
  );
}
