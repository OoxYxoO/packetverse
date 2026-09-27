import { Callout, ChecklistCard, DArrow, DIAGRAM as D, DNode, DiagramFrame, DiagramSvg, Glossary, GuideSection } from "@/components/lesson/GuideBlocks";
import { DRouteCard } from "@/components/lesson/EvpnGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { VNI, VTEP_LOOPBACK } from "@/lib/sim-engine/scenarios/evpnBum";

export const EVPNB_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "bd-imet", label: "IMET semantics" },
  { id: "bd-pmsi", label: "Tunnel information" },
  { id: "bd-lifecycle", label: "Replication-set lifecycle" },
  { id: "bd-ir-vs-mcast", label: "Ingress replication vs multicast" },
  { id: "bd-unknown", label: "Unknown-unicast caveats" },
  { id: "bd-planes", label: "Control vs data plane state" },
  { id: "bd-trouble", label: "Troubleshooting" },
  { id: "bd-verify", label: "Verification" },
  { id: "bd-glossary", label: "Glossary" },
  { id: "bd-mental", label: "Mental model" },
];

function ImetDiagram() {
  return (
    <DiagramSvg h={190} label="Conceptual Type 3 route: RD, Ethernet Tag, originating router's IP address, route targets and tunnel information">
      <DRouteCard x={40} y={16} w={270} title="Type 3 NLRI (conceptual)" rows={[{ label: "RD", value: "uniqueness" }, { label: "Ethernet Tag", value: "service context" }, { label: "Originating router IP", value: "the VTEP", strong: true }]} />
      <DRouteCard x={340} y={16} w={260} title="Attributes" color={D.violet} rows={[{ label: "Route Targets", value: "import policy" }, { label: "Tunnel info (PMSI)", value: "how to send BUM" }]} />
      <text x={320} y={150} textAnchor="middle" fill={D.muted} fontSize={10}>
        one route per VTEP per broadcast domain — never per host
      </text>
    </DiagramSvg>
  );
}

function LifecycleDiagram() {
  const box = (x: number, t: string, s: string, c: string) => (
    <g>
      <rect x={x} y={40} width={130} height={56} rx={10} fill={c} fillOpacity={0.12} stroke={c} strokeOpacity={0.75} />
      <text x={x + 65} y={62} textAnchor="middle" fill={D.text} fontSize={11} fontWeight={700}>
        {t}
      </text>
      <text x={x + 65} y={80} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        {s}
      </text>
    </g>
  );
  return (
    <DiagramSvg h={150} label="Replication set lifecycle: Type 3 received, RT checked, imported, VTEP added to flood list; withdrawn, VTEP removed">
      {box(20, "Type 3 received", "from a VTEP", D.bgp)}
      <DArrow x1={152} y1={68} x2={172} y2={68} color={D.faint} width={1.4} />
      {box(174, "RT checked", "import policy", D.violet)}
      <DArrow x1={306} y1={68} x2={326} y2={68} color={D.faint} width={1.4} />
      {box(328, "VTEP added", "to the flood list", D.success)}
      <DArrow x1={460} y1={68} x2={480} y2={68} color={D.faint} width={1.4} />
      {box(482, "Withdrawn", "VTEP removed", D.danger)}
      <text x={320} y={126} textAnchor="middle" fill={D.muted} fontSize={10}>
        the data plane only ever replicates to what the control plane currently lists
      </text>
    </DiagramSvg>
  );
}

function IrVsMcastDiagram() {
  return (
    <DiagramSvg h={200} label={`Ingress replication: LEAF1 sends one unicast copy to each remote VTEP. Underlay multicast: LEAF1 sends one packet to a group and the underlay replicates`}>
      <text x={160} y={20} textAnchor="middle" fill={D.ip} fontSize={12} fontWeight={700}>
        Ingress replication (this lesson)
      </text>
      <DNode x={70} y={80} label="LEAF1" sub="makes copies" accent={D.ip} w={100} />
      <DArrow x1={122} y1={70} x2={230} y2={50} color={D.ip} label={VTEP_LOOPBACK.LEAF2} />
      <DArrow x1={122} y1={90} x2={230} y2={120} color={D.ip} label={VTEP_LOOPBACK.LEAF3} labelDy={18} />
      <text x={480} y={20} textAnchor="middle" fill={D.violet} fontSize={12} fontWeight={700}>
        Underlay multicast (context)
      </text>
      <DNode x={390} y={80} label="LEAF1" sub="sends once" accent={D.violet} w={100} />
      <DArrow x1={442} y1={80} x2={520} y2={80} color={D.violet} label="group" />
      <DNode x={570} y={80} label="Underlay" sub="replicates" accent={D.violet} w={90} />
      <text x={320} y={180} textAnchor="middle" fill={D.muted} fontSize={10}>
        both are valid designs; they move replication work to different places
      </text>
    </DiagramSvg>
  );
}

function UnknownDiagram() {
  return (
    <DiagramSvg h={150} label="A unicast frame for a MAC not yet in the table is treated like BUM and flooded to the flood list">
      <DNode x={110} y={60} label="dst MAC unknown" sub="no Type 2 entry" accent={D.warning} w={170} />
      <DArrow x1={200} y1={60} x2={300} y2={60} color={D.faint} />
      <DNode x={390} y={60} label="Handled as BUM" sub={`flood list for VNI ${VNI}`} accent={D.violet} w={180} />
      <text x={320} y={126} textAnchor="middle" fill={D.muted} fontSize={10}>
        EVPN reduces unknown unicast by advertising MACs, but cannot remove it entirely
      </text>
    </DiagramSvg>
  );
}

function PlanesDiagram() {
  return (
    <DiagramSvg h={170} label="Control plane state: Type 3 routes and the flood list. Data plane action: replicate the BUM frame to each listed VTEP">
      <DRouteCard x={30} y={20} w={270} title="Control plane state" color={D.bgp} rows={[{ label: "Type 3 routes", value: "received / imported" }, { label: "Flood list", value: "derived per VNI", strong: true }]} />
      <DRouteCard x={340} y={20} w={270} title="Data plane action" color={D.ip} rows={[{ label: "BUM frame", value: "classified at ingress" }, { label: "Copies", value: "one per listed VTEP", strong: true }]} />
      <DArrow x1={302} y1={60} x2={338} y2={60} color={D.faint} />
      <text x={320} y={140} textAnchor="middle" fill={D.muted} fontSize={10}>
        a wrong list means wrong copies — the data plane cannot fix what the control plane got wrong
      </text>
    </DiagramSvg>
  );
}

export function EvpnBumDeepDiveContent() {
  return (
    <>
      <GuideSection id="bd-imet" eyebrow="Control plane" title="IMET semantics" tone="bgp">
        <DiagramFrame caption="Conceptual fields — encodings are defined in RFC 7432 / RFC 8365.">
          <ImetDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="bd-pmsi" eyebrow="Control plane" title="Tunnel information" tone="violet">
        <p>Alongside membership, a Type 3 route carries tunnel information describing how BUM traffic should be delivered to that VTEP — for example ingress replication to its address. This lesson shows the membership effect directly and keeps the tunnel attribute as background.</p>
      </GuideSection>

      <GuideSection id="bd-lifecycle" eyebrow="Operations" title="Replication-set lifecycle" tone="violet">
        <DiagramFrame caption="Membership changes flow straight into replication.">
          <LifecycleDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="bd-ir-vs-mcast" eyebrow="Design" title="Ingress replication vs multicast" tone="ip">
        <DiagramFrame caption="Comparison for context — the lesson models the left side only.">
          <IrVsMcastDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="bd-unknown" eyebrow="Traffic" title="Unknown-unicast caveats" tone="warning">
        <DiagramFrame caption="Unknown unicast follows the same path as broadcast.">
          <UnknownDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="bd-planes" eyebrow="Model" title="Control vs data plane state" tone="violet">
        <DiagramFrame caption="Where each piece of state lives.">
          <PlanesDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="bd-trouble" eyebrow="Operations" title="Troubleshooting" tone="warning">
        <ChecklistCard tone="warning" title="Ladder" mark="→" items={["Underlay reachability to every VTEP.", "BGP EVPN session state.", "Type 3 route received from each member.", "Type 3 route imported (RT) on the ingress VTEP.", "Flood list contents per VNI.", "Copies actually leaving the ingress VTEP."]} />
      </GuideSection>

      <GuideSection id="bd-verify" eyebrow="Operations" title="Verification" tone="success">
        <ChecklistCard tone="success" title="Evidence" mark="✓" items={["Every expected VTEP in the flood list.", "One VXLAN copy per member on a real broadcast.", "Delivery at every remote site."]} />
      </GuideSection>

      <GuideSection id="bd-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "PMSI tunnel", def: "Attribute describing how BUM traffic reaches a VTEP (e.g. ingress replication)." },
            { term: "Replication set", def: "Another name for the flood list." },
            { term: "Underlay multicast", def: "Letting the IP network replicate BUM traffic to a multicast group." },
          ]}
        />
      </GuideSection>

      <GuideSection id="bd-mental" eyebrow="Recap" title="Mental model" tone="success">
        <Callout tone="success" title="Recap" icon="✓">
          Membership is control-plane state (Type 3); replication is a data-plane action that reads it. Fix membership, and replication follows.
        </Callout>
      </GuideSection>
    </>
  );
}
