import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DiagramFrame, DiagramSvg, FieldTable, Glossary, GuideSection } from "@/components/lesson/GuideBlocks";
import { DHeaderColumn } from "@/components/lesson/Srv6GuideSvg";
import { DRouteCard, EvpnFabric } from "@/components/lesson/EvpnGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { GATEWAY_IP, GATEWAY_MAC, HOST_A_IP, HOST_A_MAC, HOST_B_IP, HOST_B_MAC, HOST_C_IP, L2_VNI_10, L2_VNI_20, L3_VNI, ROUTER_MAC, VLAN10, VLAN20, VRF, VTEP_LOOPBACK } from "@/lib/sim-engine/scenarios/evpnIrb";

export const EVPNI_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "li-mission", label: "The mission" },
  { id: "li-fabric", label: "Two subnets, one fabric" },
  { id: "li-boundary", label: "Bridge or route?" },
  { id: "li-anycast", label: "Distributed anycast gateway" },
  { id: "li-vnis", label: "L2 VNI vs L3 VNI" },
  { id: "li-symmetric", label: "Symmetric IRB" },
  { id: "li-packet", label: "The packet, stage by stage" },
  { id: "li-rmac", label: "Router MAC" },
  { id: "li-type2", label: "HOST-B's Type 2 route" },
  { id: "li-fault", label: "The incident" },
  { id: "li-glossary", label: "Glossary" },
  { id: "li-recap", label: "Mental model" },
];

function FabricDiagram() {
  return (
    <DiagramSvg h={250} label={`HOST-A (VLAN ${VLAN10}) on LEAF1, HOST-C (VLAN ${VLAN10}) on LEAF2, HOST-B (VLAN ${VLAN20}) on LEAF3`}>
      <EvpnFabric
        leaves={[
          { id: "LEAF1", sub: `VTEP ${VTEP_LOOPBACK.LEAF1}`, host: "HOST-A", hostSub: `${HOST_A_IP} · VLAN ${VLAN10}` },
          { id: "LEAF2", sub: `VTEP ${VTEP_LOOPBACK.LEAF2}`, host: "HOST-C", hostSub: `${HOST_C_IP} · VLAN ${VLAN10}` },
          { id: "LEAF3", sub: `VTEP ${VTEP_LOOPBACK.LEAF3}`, host: "HOST-B", hostSub: `${HOST_B_IP} · VLAN ${VLAN20}` },
        ]}
      />
      <text x={320} y={244} textAnchor="middle" fill={D.muted} fontSize={10}>
        HOST-A ↔ HOST-C: same subnet · HOST-A ↔ HOST-B: different subnets
      </text>
    </DiagramSvg>
  );
}

function AnycastDiagram() {
  return (
    <DiagramSvg h={180} label={`VLAN ${VLAN10} gateway ${GATEWAY_IP[10]} is provided on both LEAF1 and LEAF2; VLAN ${VLAN20} gateway ${GATEWAY_IP[20]} on LEAF3; this lesson uses one shared MAC ${GATEWAY_MAC}`}>
      <DRouteCard x={20} y={16} w={190} title="LEAF1 — IRB VLAN 10" color={D.violet} rows={[{ label: "gateway IP", value: GATEWAY_IP[10], strong: true }, { label: "gateway MAC", value: GATEWAY_MAC }]} />
      <DRouteCard x={225} y={16} w={190} title="LEAF2 — IRB VLAN 10" color={D.violet} rows={[{ label: "gateway IP", value: GATEWAY_IP[10], strong: true }, { label: "gateway MAC", value: GATEWAY_MAC }]} />
      <DRouteCard x={430} y={16} w={190} title="LEAF3 — IRB VLAN 20" color={D.cyan} rows={[{ label: "gateway IP", value: GATEWAY_IP[20], strong: true }, { label: "gateway MAC", value: GATEWAY_MAC }]} />
      <text x={320} y={130} textAnchor="middle" fill={D.text} fontSize={11}>
        each host reaches the gateway on its OWN leaf — no hairpin to a central router
      </text>
      <text x={320} y={152} textAnchor="middle" fill={D.muted} fontSize={10}>
        one shared gateway MAC is this lesson&apos;s simplification, not a universal requirement
      </text>
    </DiagramSvg>
  );
}

function VnisDiagram() {
  return (
    <DiagramSvg h={180} label={`L2 VNI ${L2_VNI_10} bridges VLAN ${VLAN10}; L2 VNI ${L2_VNI_20} bridges VLAN ${VLAN20}; L3 VNI ${L3_VNI} carries routed traffic for VRF ${VRF}`}>
      <DRouteCard x={20} y={16} w={190} title={`L2 VNI ${L2_VNI_10}`} color={D.cyan} rows={[{ label: "carries", value: `VLAN ${VLAN10} bridging` }]} />
      <DRouteCard x={430} y={16} w={190} title={`L2 VNI ${L2_VNI_20}`} color={D.cyan} rows={[{ label: "carries", value: `VLAN ${VLAN20} bridging` }]} />
      <DRouteCard x={210} y={90} w={220} title={`L3 VNI ${L3_VNI}`} color={D.violet} rows={[{ label: "carries", value: `routed VRF ${VRF}`, strong: true }]} />
      <text x={320} y={172} textAnchor="middle" fill={D.muted} fontSize={10}>
        an L3 VNI identifies a VRF&apos;s routed transport — it is not another VLAN
      </text>
    </DiagramSvg>
  );
}

function SymmetricDiagram() {
  const stage = (x: number, t: string, s: string, c: string) => (
    <g>
      <rect x={x} y={40} width={140} height={56} rx={10} fill={c} fillOpacity={0.12} stroke={c} strokeOpacity={0.75} />
      <text x={x + 70} y={62} textAnchor="middle" fill={D.text} fontSize={11} fontWeight={700}>
        {t}
      </text>
      <text x={x + 70} y={80} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        {s}
      </text>
    </g>
  );
  return (
    <DiagramSvg h={150} label={`Symmetric IRB: LEAF1 routes in VRF ${VRF}, the packet crosses the fabric on L3 VNI ${L3_VNI}, LEAF3 routes again and bridges into VLAN ${VLAN20}`}>
      {stage(14, "LEAF1 routes", `VRF ${VRF}`, D.bgp)}
      <DArrow x1={156} y1={68} x2={170} y2={68} color={D.faint} width={1.4} />
      {stage(172, "Fabric transport", `L3 VNI ${L3_VNI}`, D.violet)}
      <DArrow x1={314} y1={68} x2={328} y2={68} color={D.faint} width={1.4} />
      {stage(330, "LEAF3 routes", `VRF ${VRF}`, D.bgp)}
      <DArrow x1={472} y1={68} x2={486} y2={68} color={D.faint} width={1.4} />
      {stage(488, "Deliver", `VLAN ${VLAN20}`, D.cyan)}
      <text x={320} y={130} textAnchor="middle" fill={D.muted} fontSize={10}>
        routing happens at BOTH ends — that is what makes it symmetric
      </text>
    </DiagramSvg>
  );
}

function PacketStagesDiagram() {
  return (
    <DiagramSvg h={250} label={`HOST-A sends to the gateway MAC; across the fabric the inner Ethernet uses Router MACs ${ROUTER_MAC.LEAF1} to ${ROUTER_MAC.LEAF3} inside L3 VNI ${L3_VNI}; LEAF3 rewrites to gateway MAC to HOST-B`}>
      <text x={110} y={18} textAnchor="middle" fill={D.text} fontSize={11} fontWeight={700}>
        HOST-A → LEAF1
      </text>
      <DHeaderColumn x={110} y={28} w={200} rows={[{ text: `Eth ${HOST_A_MAC} → GW`, color: D.eth, strong: true }, { text: `IP ${HOST_A_IP} → ${HOST_B_IP}`, color: D.ip }]} caption="dst MAC = gateway" />
      <text x={330} y={18} textAnchor="middle" fill={D.text} fontSize={11} fontWeight={700}>
        LEAF1 → LEAF3
      </text>
      <DHeaderColumn
        x={330}
        y={28}
        w={220}
        rows={[
          { text: `Outer IP ${VTEP_LOOPBACK.LEAF1} → ${VTEP_LOOPBACK.LEAF3}`, color: D.ip },
          { text: `VXLAN · L3 VNI ${L3_VNI}`, color: D.violet, strong: true },
          { text: `inner src ${ROUTER_MAC.LEAF1}`, color: D.mpls, strong: true },
          { text: `inner dst ${ROUTER_MAC.LEAF3}`, color: D.mpls, strong: true },
          { text: `IP ${HOST_A_IP} → ${HOST_B_IP}`, color: D.ip },
        ]}
        caption="inner Ethernet = Router MACs"
      />
      <text x={545} y={18} textAnchor="middle" fill={D.text} fontSize={11} fontWeight={700}>
        LEAF3 → HOST-B
      </text>
      <DHeaderColumn x={545} y={28} w={170} rows={[{ text: `Eth GW → ${HOST_B_MAC}`, color: D.eth, strong: true }, { text: `IP → ${HOST_B_IP}`, color: D.ip }]} caption="rewritten for delivery" />
      <text x={320} y={200} textAnchor="middle" fill={D.muted} fontSize={10}>
        Ethernet headers change at every routed boundary — the IP conversation never does
      </text>
    </DiagramSvg>
  );
}

function Type2Diagram() {
  return (
    <DiagramSvg h={210} label={`LEAF3's Type 2 route for HOST-B carries Label2 / IP-VRF VNI ${L3_VNI} and the Router's MAC extended community ${ROUTER_MAC.LEAF3}`}>
      <DRouteCard
        x={150}
        y={14}
        w={340}
        title="Type 2 — HOST-B (symmetric IRB attributes)"
        rows={[
          { label: "MAC / IP", value: `${HOST_B_MAC} / ${HOST_B_IP}` },
          { label: "BGP next hop", value: `${VTEP_LOOPBACK.LEAF3} (LEAF3 VTEP)` },
          { label: "Label2 / IP-VRF VNI", value: String(L3_VNI), strong: true },
          { label: "Router's MAC EC", value: ROUTER_MAC.LEAF3, strong: true },
        ]}
      />
      <text x={320} y={150} textAnchor="middle" fill={D.text} fontSize={11}>
        control-plane route attributes — never fields inside the tenant packet
      </text>
      <text x={320} y={170} textAnchor="middle" fill={D.muted} fontSize={10}>
        LEAF1 uses them to pick the L3 VNI and the inner destination Router MAC
      </text>
    </DiagramSvg>
  );
}

export function EvpnIrbLessonGuideContent() {
  return (
    <>
      <GuideSection id="li-mission" eyebrow="Introduction" title="The mission: route between subnets inside the fabric" tone="cyan">
        <p>Bridging only works inside one subnet. HOST-B lives in a different subnet, so the fabric has to route. This lesson routes locally on each leaf with a distributed anycast gateway and symmetric IRB.</p>
      </GuideSection>

      <GuideSection id="li-fabric" eyebrow="Setup" title="Two subnets, one fabric" tone="ospf">
        <DiagramFrame caption="The lesson's topology and VLANs.">
          <FabricDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="li-boundary" eyebrow="Decision" title="Bridge or route?" tone="warning">
        <CompareCards
          items={[
            { title: "Same subnet", tone: "cyan", tag: "bridge", points: ["HOST-A → HOST-C", `L2 VNI ${L2_VNI_10}`, "No gateway involved"] },
            { title: "Different subnet", tone: "violet", tag: "route", points: ["HOST-A → HOST-B", "Frame addressed to the gateway MAC", `Routed in VRF ${VRF}`] },
          ]}
        />
      </GuideSection>

      <GuideSection id="li-anycast" eyebrow="Gateway" title="Distributed anycast gateway" tone="violet">
        <DiagramFrame caption="The same gateway identity is available locally wherever the subnet exists.">
          <AnycastDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="li-vnis" eyebrow="Identifiers" title="L2 VNI vs L3 VNI" tone="violet">
        <DiagramFrame caption="Bridged segments and routed transport use different VNIs.">
          <VnisDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="li-symmetric" eyebrow="Model" title="Symmetric IRB" tone="bgp">
        <DiagramFrame caption="Route in, carry on the L3 VNI, route out.">
          <SymmetricDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="li-packet" eyebrow="Data plane" title="The packet, stage by stage" tone="ip">
        <DiagramFrame caption="The same fields the lesson's packet inspector shows.">
          <PacketStagesDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="li-rmac" eyebrow="Detail" title="Router MAC" tone="mpls">
        <FieldTable
          title="Router MACs in this lesson"
          accent="mpls"
          columns={["Leaf", "Router MAC", "Used as"]}
          rows={[
            ["LEAF1", ROUTER_MAC.LEAF1, "inner source MAC on the L3 VNI"],
            ["LEAF3", ROUTER_MAC.LEAF3, "inner destination MAC on the L3 VNI"],
          ]}
        />
      </GuideSection>

      <GuideSection id="li-type2" eyebrow="Control plane" title="HOST-B's Type 2 route" tone="bgp">
        <DiagramFrame caption="This lesson resolves HOST-B with Type 2; prefix routes (Type 5) are the next lesson.">
          <Type2Diagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="li-fault" eyebrow="Troubleshooting" title="The incident" tone="danger">
        <ChecklistCard tone="danger" title="How to reason about it (no spoilers)" mark="→" items={["Test same-subnet and inter-subnet traffic separately.", "Walk the layers: underlay, BGP session, EVPN routes, VRF, VNIs, forwarding on each leaf.", "At each layer, look for evidence rather than assumptions.", "Pick the fix only for the first layer that fails."]} />
      </GuideSection>

      <GuideSection id="li-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "IRB", def: "Integrated Routing and Bridging on the same device." },
            { term: "Anycast gateway", def: "The same gateway IP (and MAC) configured on every leaf serving a subnet." },
            { term: "L2 VNI", def: "VNI for one bridged segment." },
            { term: "L3 VNI", def: "VNI for a VRF's routed traffic between VTEPs." },
            { term: "Router MAC (RMAC)", def: "A leaf's routing MAC, used as the inner Ethernet address on the L3 VNI." },
          ]}
        />
      </GuideSection>

      <GuideSection id="li-recap" eyebrow="Recap" title="Mental model" tone="success">
        <Callout tone="success" title="One sentence" icon="✓">
          Hosts send off-subnet traffic to a gateway that lives on their own leaf; the leaf routes in the VRF, carries the packet on the L3 VNI between Router MACs, and the far leaf routes again into the destination subnet.
        </Callout>
      </GuideSection>
    </>
  );
}
