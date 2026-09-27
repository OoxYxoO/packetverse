import { Callout, ChecklistCard, DArrow, DIAGRAM as D, DNode, DiagramFrame, DiagramSvg, Glossary, GuideSection } from "@/components/lesson/GuideBlocks";
import { DHeaderColumn } from "@/components/lesson/Srv6GuideSvg";
import { DRouteCard, EvpnFabric } from "@/components/lesson/EvpnGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { DESTINATION_IP, EXAMPLE_TYPE2_ROUTE, HOST_A_IP, L3_VNI, ROUTER_MAC, TENANT_PREFIX, TENANT_PREFIX_WIDE, VRF, VTEP_LOOPBACK } from "@/lib/sim-engine/scenarios/evpnType5";

export const EVPN5_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "l5-mission", label: "The mission" },
  { id: "l5-fabric", label: "Where the prefix lives" },
  { id: "l5-types", label: "Type 2 vs Type 3 vs Type 5" },
  { id: "l5-route", label: "The Type 5 route" },
  { id: "l5-rdrt", label: "RD vs RT" },
  { id: "l5-import", label: "Import into the VRF" },
  { id: "l5-packet", label: "The routed packet" },
  { id: "l5-lpm", label: "Longest-prefix match" },
  { id: "l5-usable", label: "Received ≠ usable" },
  { id: "l5-fault", label: "The incident" },
  { id: "l5-glossary", label: "Glossary" },
  { id: "l5-recap", label: "Mental model" },
];

function FabricDiagram() {
  return (
    <DiagramSvg h={250} label={`HOST-A (${HOST_A_IP}) on LEAF1; prefix ${TENANT_PREFIX} behind LEAF3 in VRF ${VRF}`}>
      <EvpnFabric
        leaves={[
          { id: "LEAF1", sub: `VTEP ${VTEP_LOOPBACK.LEAF1}`, host: "HOST-A", hostSub: HOST_A_IP },
          { id: "LEAF2", sub: `VTEP ${VTEP_LOOPBACK.LEAF2}` },
          { id: "LEAF3", sub: `VTEP ${VTEP_LOOPBACK.LEAF3}`, host: "BORDER-SVR", hostSub: TENANT_PREFIX, accent: D.violet },
        ]}
      />
      <text x={320} y={244} textAnchor="middle" fill={D.muted} fontSize={10}>
        {TENANT_PREFIX} is a whole subnet in LEAF3&apos;s VRF — no host inside it was learned individually
      </text>
    </DiagramSvg>
  );
}

function TypesDiagram() {
  return (
    <DiagramSvg h={170} label="Type 2 carries one host MAC/IP, Type 3 carries VNI membership, Type 5 carries an IP prefix">
      <DRouteCard x={16} y={20} w={196} title="Type 2" color={D.bgp} rows={[{ label: "answers", value: "where is this host?" }, { label: "key", value: "MAC (+ IP)", strong: true }]} />
      <DRouteCard x={222} y={20} w={196} title="Type 3" color={D.cyan} rows={[{ label: "answers", value: "who is in the VNI?" }, { label: "key", value: "VTEP + VNI", strong: true }]} />
      <DRouteCard x={428} y={20} w={196} title="Type 5" color={D.violet} rows={[{ label: "answers", value: "where is this prefix?" }, { label: "key", value: "IP prefix", strong: true }]} />
      <text x={320} y={140} textAnchor="middle" fill={D.muted} fontSize={10}>
        three route types, three different questions
      </text>
    </DiagramSvg>
  );
}

function RouteDiagram() {
  return (
    <DiagramSvg h={220} label={`Type 5 route for ${TENANT_PREFIX}: next hop ${VTEP_LOOPBACK.LEAF3}, L3 VNI ${L3_VNI}, GW IP 0.0.0.0`}>
      <DRouteCard
        x={150}
        y={14}
        w={340}
        title={`Type 5 — ${TENANT_PREFIX}`}
        color={D.violet}
        rows={[
          { label: "Prefix", value: TENANT_PREFIX, strong: true },
          { label: "RD", value: `${VTEP_LOOPBACK.LEAF3}:${L3_VNI}` },
          { label: "RT", value: EXAMPLE_TYPE2_ROUTE.rt },
          { label: "BGP next hop", value: `${VTEP_LOOPBACK.LEAF3} (LEAF3 VTEP)`, strong: true },
          { label: "L3 VNI", value: String(L3_VNI) },
          { label: "GW IP", value: "0.0.0.0" },
        ]}
      />
      <text x={320} y={196} textAnchor="middle" fill={D.muted} fontSize={10}>
        a BGP control-plane route — none of these fields ride inside the tenant packet
      </text>
    </DiagramSvg>
  );
}

function ImportDiagram() {
  return (
    <DiagramSvg h={170} label={`LEAF1 receives the Type 5 route, checks its RT, imports it and installs ${TENANT_PREFIX} via LEAF3 in VRF ${VRF}`}>
      <DNode x={90} y={60} label="Received" sub="BGP EVPN" accent={D.bgp} w={130} />
      <DArrow x1={156} y1={60} x2={206} y2={60} color={D.faint} />
      <DNode x={270} y={60} label="RT check" sub="import policy" accent={D.warning} w={120} />
      <DArrow x1={331} y1={60} x2={381} y2={60} color={D.faint} />
      <DNode x={500} y={60} label={`VRF ${VRF}`} sub={`${TENANT_PREFIX} via LEAF3`} accent={D.violet} w={220} />
      <text x={320} y={130} textAnchor="middle" fill={D.muted} fontSize={10}>
        the RT decides the import — the RD only kept the route unique
      </text>
    </DiagramSvg>
  );
}

function PacketDiagram() {
  return (
    <DiagramSvg h={200} label={`LEAF1 to LEAF3 packet toward ${DESTINATION_IP}: outer IP between VTEPs, VXLAN L3 VNI ${L3_VNI}, inner Ethernet ${ROUTER_MAC.LEAF1} to ${ROUTER_MAC.LEAF3}`}>
      <DHeaderColumn
        x={320}
        y={16}
        w={320}
        rows={[
          { text: `Outer IP ${VTEP_LOOPBACK.LEAF1} → ${VTEP_LOOPBACK.LEAF3}`, color: D.ip, strong: true },
          { text: `VXLAN · L3 VNI ${L3_VNI}`, color: D.violet, strong: true },
          { text: `Inner Eth ${ROUTER_MAC.LEAF1} → ${ROUTER_MAC.LEAF3}`, color: D.mpls },
          { text: `Inner IP ${HOST_A_IP} → ${DESTINATION_IP}`, color: D.ip },
        ]}
        caption="the same symmetric-IRB wire format as the previous lesson"
      />
      <text x={320} y={184} textAnchor="middle" fill={D.muted} fontSize={10}>
        only the control plane that built the route changed
      </text>
    </DiagramSvg>
  );
}

function LpmDiagram() {
  return (
    <DiagramSvg h={170} label={`Two candidate routes, ${TENANT_PREFIX} via LEAF3 and ${TENANT_PREFIX_WIDE} via LEAF2, compared for destination ${DESTINATION_IP}`}>
      <DRouteCard x={30} y={20} w={270} title="Candidate A" color={D.violet} rows={[{ label: "prefix", value: TENANT_PREFIX, strong: true }, { label: "via", value: "LEAF3" }]} />
      <DRouteCard x={340} y={20} w={270} title="Candidate B" color={D.cyan} rows={[{ label: "prefix", value: TENANT_PREFIX_WIDE, strong: true }, { label: "via", value: "LEAF2" }]} />
      <text x={320} y={120} textAnchor="middle" fill={D.text} fontSize={11}>
        destination {DESTINATION_IP} — which one? (the lesson asks you)
      </text>
      <text x={320} y={142} textAnchor="middle" fill={D.muted} fontSize={10}>
        EVPN supplies the candidates; ordinary routing rules choose
      </text>
    </DiagramSvg>
  );
}

export function EvpnType5LessonGuideContent() {
  return (
    <>
      <GuideSection id="l5-mission" eyebrow="Introduction" title="The mission: advertise a whole prefix" tone="cyan">
        <p>Type 2 advertises hosts one at a time. {TENANT_PREFIX} is a subnet whose hosts were never learned individually — the fabric needs a route that says &quot;this whole prefix lives behind this VTEP.&quot;</p>
      </GuideSection>

      <GuideSection id="l5-fabric" eyebrow="Setup" title="Where the prefix lives" tone="ospf">
        <DiagramFrame caption="The IRB fabric, with a prefix sitting in LEAF3's VRF.">
          <FabricDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="l5-types" eyebrow="Route types" title="Type 2 vs Type 3 vs Type 5" tone="bgp">
        <DiagramFrame caption="Each route type answers its own question.">
          <TypesDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="l5-route" eyebrow="Control plane" title="The Type 5 route" tone="violet">
        <DiagramFrame caption="Values from this lesson's route.">
          <RouteDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="l5-rdrt" eyebrow="Control plane" title="RD vs RT" tone="bgp">
        <p>The RD makes the route unique inside BGP. The RT is the policy tag that decides which VRFs import it. Same rule as every earlier EVPN and L3VPN lesson.</p>
      </GuideSection>

      <GuideSection id="l5-import" eyebrow="Control plane" title="Import into the VRF" tone="warning">
        <DiagramFrame caption="From received route to installed VRF route.">
          <ImportDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="l5-packet" eyebrow="Data plane" title="The routed packet" tone="ip">
        <DiagramFrame caption="What actually crosses the spine.">
          <PacketDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="l5-lpm" eyebrow="Routing" title="Longest-prefix match" tone="ospf">
        <DiagramFrame caption="An overlapping route arrives later in the lesson.">
          <LpmDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="l5-usable" eyebrow="Concept" title="Received ≠ usable" tone="warning">
        <Callout tone="warning" title="A route is a promise, not a path" icon="!">
          A route can be received and imported and still fail to forward, if something it depends on is not actually available.
        </Callout>
      </GuideSection>

      <GuideSection id="l5-fault" eyebrow="Troubleshooting" title="The incident" tone="danger">
        <ChecklistCard tone="danger" title="How to reason about it (no spoilers)" mark="→" items={["Note what still works and what does not.", "List every layer a prefix route depends on, from session to delivery.", "At each layer, look for evidence rather than assumptions.", "Pick the fix only for the first layer that fails."]} />
      </GuideSection>

      <GuideSection id="l5-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "Type 5", def: "EVPN IP Prefix Route (RFC 9136)." },
            { term: "LPM", def: "Longest Prefix Match — the most specific matching route wins." },
            { term: "GW IP", def: "Optional overlay gateway field; 0.0.0.0 in this symmetric-IRB model." },
            { term: "L3 VNI", def: "The VNI that carries a VRF's routed traffic between VTEPs." },
          ]}
        />
      </GuideSection>

      <GuideSection id="l5-recap" eyebrow="Recap" title="Mental model" tone="success">
        <Callout tone="success" title="One sentence" icon="✓">
          Type 5 carries a prefix into remote VRFs; RT import installs it; ordinary longest-prefix match picks among candidates; and the packet still travels the symmetric-IRB way over the L3 VNI.
        </Callout>
      </GuideSection>
    </>
  );
}
