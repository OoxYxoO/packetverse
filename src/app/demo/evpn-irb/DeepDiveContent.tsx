import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DNode, DiagramFrame, DiagramSvg, Glossary, GuideSection } from "@/components/lesson/GuideBlocks";
import { DRouteCard } from "@/components/lesson/EvpnGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { L2_VNI_10, L2_VNI_20, L3_VNI, ROUTER_MAC, VRF } from "@/lib/sim-engine/scenarios/evpnIrb";

export const EVPNI_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "id-sym-asym", label: "Symmetric vs asymmetric IRB" },
  { id: "id-vrfs", label: "MAC-VRF / IP-VRF split" },
  { id: "id-irb", label: "The IRB interface" },
  { id: "id-anycast", label: "Anycast gateway design" },
  { id: "id-rmac", label: "How the RMAC is learned" },
  { id: "id-type2", label: "Type 2's role in IRB" },
  { id: "id-type5", label: "Type 5 preview" },
  { id: "id-trouble", label: "Troubleshooting" },
  { id: "id-verify", label: "Verification" },
  { id: "id-glossary", label: "Glossary" },
  { id: "id-mental", label: "Mental model" },
];

function SymAsymDiagram() {
  const row = (y: number, title: string, color: string, stages: string[]) => (
    <g>
      <text x={20} y={y + 21} fill={color} fontSize={11.5} fontWeight={700}>
        {title}
      </text>
      {stages.map((s, i) => (
        <g key={s + i}>
          <rect x={150 + i * 160} y={y} width={148} height={34} rx={8} fill={color} fillOpacity={0.12} stroke={color} strokeOpacity={0.75} />
          <text x={150 + i * 160 + 74} y={y + 21} textAnchor="middle" fill={D.text} fontSize={10}>
            {s}
          </text>
          {i < stages.length - 1 && <DArrow x1={150 + i * 160 + 148} y1={y + 17} x2={150 + (i + 1) * 160} y2={y + 17} color={color} width={1.4} />}
        </g>
      ))}
    </g>
  );
  return (
    <DiagramSvg h={170} label={`Symmetric: route, L3 VNI ${L3_VNI}, route. Asymmetric: route at ingress, then bridge on the destination's L2 VNI ${L2_VNI_20}`}>
      {row(20, "Symmetric", D.violet, ["ingress routes", `L3 VNI ${L3_VNI}`, "egress routes"])}
      {row(90, "Asymmetric", D.warning, ["ingress routes", `dest L2 VNI ${L2_VNI_20}`, "egress bridges"])}
      <text x={320} y={158} textAnchor="middle" fill={D.muted} fontSize={10}>
        asymmetric needs every destination segment on the ingress leaf; symmetric does not
      </text>
    </DiagramSvg>
  );
}

function VrfSplitDiagram() {
  return (
    <DiagramSvg h={180} label={`Per leaf: MAC-VRFs for L2 VNIs ${L2_VNI_10} and ${L2_VNI_20}, and an IP-VRF ${VRF} bound to L3 VNI ${L3_VNI}, joined by IRB interfaces`}>
      <DRouteCard x={20} y={20} w={190} title="MAC-VRF (bridging)" color={D.cyan} rows={[{ label: "L2 VNI", value: String(L2_VNI_10) }, { label: "L2 VNI", value: String(L2_VNI_20) }]} />
      <DNode x={320} y={62} label="IRB interfaces" sub="gateway per subnet" accent={D.warning} w={170} />
      <DRouteCard x={430} y={20} w={190} title={`IP-VRF ${VRF}`} color={D.violet} rows={[{ label: "L3 VNI", value: String(L3_VNI), strong: true }, { label: "routes", value: "host + prefix" }]} />
      <DArrow x1={212} y1={62} x2={234} y2={62} color={D.faint} both width={1.4} />
      <DArrow x1={406} y1={62} x2={428} y2={62} color={D.faint} both width={1.4} />
      <text x={320} y={150} textAnchor="middle" fill={D.muted} fontSize={10}>
        bridging tables and routing tables are separate; IRB interfaces connect them
      </text>
    </DiagramSvg>
  );
}

function RmacDiagram() {
  return (
    <DiagramSvg h={170} label={`LEAF3 advertises its Router's MAC ${ROUTER_MAC.LEAF3} as an extended community; LEAF1 uses it as the inner destination MAC on L3 VNI ${L3_VNI}`}>
      <DNode x={110} y={50} label="LEAF3" sub="originates Type 2" accent={D.bgp} w={150} />
      <DArrow x1={186} y1={50} x2={300} y2={50} color={D.bgp} label="Router's MAC EC" />
      <DNode x={380} y={50} label="LEAF1" sub="stores RMAC for LEAF3" accent={D.bgp} w={160} />
      <DArrow x1={380} y1={73} x2={380} y2={108} color={D.faint} />
      <DNode x={380} y={128} label={`inner dst ${ROUTER_MAC.LEAF3}`} sub={`on L3 VNI ${L3_VNI}`} accent={D.mpls} w={220} />
      <text x={110} y={140} textAnchor="middle" fill={D.muted} fontSize={10}>
        control plane → data plane
      </text>
    </DiagramSvg>
  );
}

function IrbIfaceDiagram() {
  return (
    <DiagramSvg h={150} label="An IRB interface is a routed interface attached to a bridge domain; it owns the gateway IP for that subnet">
      <DNode x={130} y={60} label="Bridge domain" sub="VLAN / L2 VNI" accent={D.cyan} w={170} />
      <DArrow x1={218} y1={60} x2={300} y2={60} color={D.faint} both />
      <DNode x={380} y={60} label="IRB interface" sub="gateway IP + MAC" accent={D.warning} w={160} />
      <DArrow x1={462} y1={60} x2={530} y2={60} color={D.faint} both />
      <DNode x={585} y={60} label="IP-VRF" sub="routing" accent={D.violet} w={90} />
      <text x={320} y={126} textAnchor="middle" fill={D.muted} fontSize={10}>
        the anycast gateway is simply the same IRB address configured on every serving leaf
      </text>
    </DiagramSvg>
  );
}

function Type5PreviewDiagram() {
  return (
    <DiagramSvg h={150} label="Type 2 carries one host's MAC and IP; Type 5, the next lesson, carries an IP prefix">
      <DRouteCard x={40} y={20} w={260} title="Type 2 (this lesson)" color={D.bgp} rows={[{ label: "carries", value: "one host MAC/IP" }]} />
      <DRouteCard x={340} y={20} w={260} title="Type 5 (next lesson)" color={D.violet} rows={[{ label: "carries", value: "an IP prefix" }]} />
      <text x={320} y={120} textAnchor="middle" fill={D.muted} fontSize={10}>
        preview only — this lesson&apos;s simulation uses Type 2 for HOST-B
      </text>
    </DiagramSvg>
  );
}

export function EvpnIrbDeepDiveContent() {
  return (
    <>
      <GuideSection id="id-sym-asym" eyebrow="Models" title="Symmetric vs asymmetric IRB" tone="violet">
        <DiagramFrame caption="RFC 9135 describes both; this lesson simulates symmetric IRB.">
          <SymAsymDiagram />
        </DiagramFrame>
        <CompareCards
          items={[
            { title: "Symmetric", tone: "violet", tag: "this lesson", points: ["Routes at ingress and egress", "Shared L3 VNI per VRF", "Leaves only provision their local subnets"] },
            { title: "Asymmetric", tone: "warning", tag: "comparison", points: ["Routes only at ingress", "Bridges on the destination L2 VNI", "Every leaf needs every destination segment"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="id-vrfs" eyebrow="Structure" title="MAC-VRF / IP-VRF split" tone="cyan">
        <DiagramFrame caption="Conceptual split — vendor configuration differs.">
          <VrfSplitDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="id-irb" eyebrow="Structure" title="The IRB interface" tone="warning">
        <DiagramFrame caption="Where bridging meets routing on a leaf.">
          <IrbIfaceDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="id-anycast" eyebrow="Design" title="Anycast gateway design" tone="violet">
        <p>The gateway IP is always subnet-specific. Whether every IRB interface shares one anycast MAC or each subnet uses its own is a design choice; this lesson shares one MAC purely to keep the picture simple.</p>
      </GuideSection>

      <GuideSection id="id-rmac" eyebrow="Control → data" title="How the RMAC is learned" tone="mpls">
        <DiagramFrame caption="The Router's MAC extended community carries the remote leaf's routing MAC.">
          <RmacDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="id-type2" eyebrow="Control plane" title="Type 2's role in IRB" tone="bgp">
        <p>In symmetric IRB a host&apos;s Type 2 route carries more than bridging information: a second label (the IP-VRF VNI) and the Router&apos;s MAC extended community, so remote leaves can route to that host directly over the L3 VNI.</p>
      </GuideSection>

      <GuideSection id="id-type5" eyebrow="Next" title="Type 5 preview" tone="violet">
        <DiagramFrame caption="Host routes vs prefix routes.">
          <Type5PreviewDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="id-trouble" eyebrow="Operations" title="Troubleshooting" tone="warning">
        <ChecklistCard tone="warning" title="Ladder" mark="→" items={["Host resolves its gateway (ARP reply from the local leaf).", "Same-subnet bridging works.", "Remote host route present in the VRF.", "L3 VNI configuration for the VRF on each leaf.", "Router MACs resolved for the remote leaf.", "Packet delivered after egress routing."]} />
      </GuideSection>

      <GuideSection id="id-verify" eyebrow="Operations" title="Verification" tone="success">
        <ChecklistCard tone="success" title="Evidence" mark="✓" items={["VRF routing table on the ingress leaf.", "L3 VNI and Router MAC for the remote leaf.", "A real inter-subnet packet delivered end to end."]} />
      </GuideSection>

      <GuideSection id="id-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "IP-VRF", def: "A tenant routing table, bound to an L3 VNI." },
            { term: "MAC-VRF", def: "A tenant bridging table for one EVPN instance." },
            { term: "Label2", def: "The second label in a symmetric-IRB Type 2 route: the IP-VRF VNI." },
            { term: "Router's MAC EC", def: "Extended community carrying the originating leaf's routing MAC." },
          ]}
        />
      </GuideSection>

      <GuideSection id="id-mental" eyebrow="Recap" title="Mental model" tone="success">
        <Callout tone="success" title="Recap" icon="✓">
          Bridge within a subnet, route between subnets, and in symmetric IRB route on both leaves: the L3 VNI and Router MACs carry the packet between the two routing stages.
        </Callout>
      </GuideSection>
    </>
  );
}
