import { Callout, ChecklistCard, DArrow, DIAGRAM as D, DNode, DiagramFrame, DiagramSvg, Glossary, GuideSection } from "@/components/lesson/GuideBlocks";
import { DRouteCard } from "@/components/lesson/EvpnGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { L3_VNI, ROUTER_MAC, TENANT_PREFIX, VRF, VTEP_LOOPBACK } from "@/lib/sim-engine/scenarios/evpnType5";

export const EVPN5_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "d5-nlri", label: "Type 5 NLRI" },
  { id: "d5-gwip", label: "GW IP vs Router MAC" },
  { id: "d5-models", label: "Interface-less vs interface-ful" },
  { id: "d5-host-vs-prefix", label: "Host route vs prefix route" },
  { id: "d5-resolution", label: "Next-hop resolution" },
  { id: "d5-layers", label: "Dependency layers" },
  { id: "d5-trouble", label: "Troubleshooting" },
  { id: "d5-verify", label: "Verification" },
  { id: "d5-glossary", label: "Glossary" },
  { id: "d5-mental", label: "Mental model" },
];

function NlriDiagram() {
  return (
    <DiagramSvg h={210} label="Conceptual Type 5 NLRI fields: RD, ESI, Ethernet Tag, IP prefix length and prefix, gateway IP, label (VNI)">
      <DRouteCard
        x={40}
        y={14}
        w={300}
        title="Type 5 NLRI (conceptual)"
        rows={[
          { label: "RD", value: "uniqueness" },
          { label: "ESI", value: "0 (none here)" },
          { label: "Ethernet Tag", value: "0" },
          { label: "IP prefix / length", value: TENANT_PREFIX, strong: true },
          { label: "GW IP", value: "0.0.0.0" },
          { label: "Label (VNI)", value: `${L3_VNI}`, strong: true },
        ]}
      />
      <DRouteCard x={370} y={14} w={230} title="Attributes" color={D.violet} rows={[{ label: "Route Target", value: "import policy" }, { label: "Router's MAC EC", value: "routing MAC" }, { label: "Encap EC", value: "VXLAN" }]} />
      <text x={320} y={196} textAnchor="middle" fill={D.muted} fontSize={10}>
        encodings are in RFC 9136 — the lesson shows the teaching-relevant fields
      </text>
    </DiagramSvg>
  );
}

function GwIpDiagram() {
  return (
    <DiagramSvg h={170} label={`With GW IP 0.0.0.0 the packet is sent on L3 VNI ${L3_VNI} to the Router MAC ${ROUTER_MAC.LEAF3}; with a non-zero GW IP, resolution recurses via that overlay address`}>
      <DRouteCard x={30} y={20} w={270} title="GW IP = 0.0.0.0 (this lesson)" color={D.violet} rows={[{ label: "resolve via", value: "next-hop VTEP + RMAC", strong: true }, { label: "inner dst MAC", value: ROUTER_MAC.LEAF3 }]} />
      <DRouteCard x={340} y={20} w={270} title="GW IP set (context)" color={D.warning} rows={[{ label: "resolve via", value: "overlay gateway IP", strong: true }, { label: "used for", value: "appliance / recursive designs" }]} />
      <text x={320} y={140} textAnchor="middle" fill={D.muted} fontSize={10}>
        different resolution models; this lesson uses the left one only
      </text>
    </DiagramSvg>
  );
}

function ModelsDiagram() {
  return (
    <DiagramSvg h={170} label="Interface-less model resolves via Router MAC on the L3 VNI; interface-ful model adds an overlay index such as an SBD IRB">
      <DNode x={160} y={60} label="Interface-less" sub="RMAC + L3 VNI (this lesson)" accent={D.violet} w={240} />
      <DNode x={480} y={60} label="Interface-ful" sub="overlay index / SBD IRB" accent={D.warning} w={220} />
      <text x={320} y={130} textAnchor="middle" fill={D.muted} fontSize={10}>
        RFC 9136 describes several models; the packet format here matches the interface-less one
      </text>
    </DiagramSvg>
  );
}

function HostVsPrefixDiagram() {
  return (
    <DiagramSvg h={160} label="A Type 2 host route is a /32 learned per endpoint; a Type 5 prefix route covers many addresses that were never individually learned">
      <DRouteCard x={30} y={20} w={270} title="Host route (Type 2)" color={D.bgp} rows={[{ label: "scope", value: "one endpoint (/32)" }, { label: "source", value: "learned on a port" }]} />
      <DRouteCard x={340} y={20} w={270} title="Prefix route (Type 5)" color={D.violet} rows={[{ label: "scope", value: TENANT_PREFIX, strong: true }, { label: "source", value: "a route in the VRF" }]} />
      <text x={320} y={130} textAnchor="middle" fill={D.muted} fontSize={10}>
        both can coexist; the more specific one wins for a matching destination
      </text>
    </DiagramSvg>
  );
}

function ResolutionDiagram() {
  return (
    <DiagramSvg h={170} label={`VRF ${VRF} route ${TENANT_PREFIX} via ${VTEP_LOOPBACK.LEAF3} must resolve in the underlay routing table before it can forward`}>
      <DNode x={120} y={50} label={`VRF ${VRF}`} sub={`${TENANT_PREFIX} → ${VTEP_LOOPBACK.LEAF3}`} accent={D.violet} w={220} />
      <DArrow x1={232} y1={50} x2={330} y2={50} color={D.faint} label="recurse" />
      <DNode x={460} y={50} label="Underlay RIB" sub={`route to ${VTEP_LOOPBACK.LEAF3}?`} accent={D.ip} w={220} />
      <text x={320} y={120} textAnchor="middle" fill={D.text} fontSize={11}>
        overlay route usable only if its next-hop VTEP is reachable
      </text>
    </DiagramSvg>
  );
}

function LayersDiagram() {
  const layers = ["BGP EVPN session", "Type 5 UPDATE received", "RT import", "VRF route installed", "Next-hop VTEP resolved", "Packet delivered"];
  return (
    <DiagramSvg h={230} label="Dependency layers of a Type 5 route, from BGP session to packet delivery">
      {layers.map((l, i) => (
        <g key={l}>
          <rect x={170} y={12 + i * 34} width={300} height={28} rx={7} fill={D.violet} fillOpacity={0.1 + i * 0.03} stroke={D.violet} strokeOpacity={0.6} />
          <text x={320} y={30 + i * 34} textAnchor="middle" fill={D.text} fontSize={11}>
            {i + 1}. {l}
          </text>
        </g>
      ))}
    </DiagramSvg>
  );
}

export function EvpnType5DeepDiveContent() {
  return (
    <>
      <GuideSection id="d5-nlri" eyebrow="Control plane" title="Type 5 NLRI" tone="bgp">
        <DiagramFrame caption="Field-level view of the prefix route.">
          <NlriDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="d5-gwip" eyebrow="Resolution" title="GW IP vs Router MAC" tone="violet">
        <DiagramFrame caption="Two ways a Type 5 route can be resolved.">
          <GwIpDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="d5-models" eyebrow="Design" title="Interface-less vs interface-ful" tone="warning">
        <DiagramFrame caption="Context only — the lesson simulates one model.">
          <ModelsDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="d5-host-vs-prefix" eyebrow="Routing" title="Host route vs prefix route" tone="bgp">
        <DiagramFrame caption="Granularity differs; forwarding is the same.">
          <HostVsPrefixDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="d5-resolution" eyebrow="Resolution" title="Next-hop resolution" tone="ip">
        <DiagramFrame caption="Overlay routes recurse through the underlay.">
          <ResolutionDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="d5-layers" eyebrow="Model" title="Dependency layers" tone="violet">
        <DiagramFrame caption="Every layer must hold for traffic to flow.">
          <LayersDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="d5-trouble" eyebrow="Operations" title="Troubleshooting" tone="warning">
        <ChecklistCard tone="warning" title="Ladder" mark="→" items={["Session up?", "Route received with the expected prefix?", "RT matches the VRF's import policy?", "Route installed in the VRF?", "Next hop resolvable?", "Real packet delivered?"]} />
      </GuideSection>

      <GuideSection id="d5-verify" eyebrow="Operations" title="Verification" tone="success">
        <ChecklistCard tone="success" title="Evidence" mark="✓" items={["Prefix present in the ingress VRF with the expected next hop.", "L3 VNI and Router MAC match the egress leaf.", "A packet to an address inside the prefix is delivered."]} />
      </GuideSection>

      <GuideSection id="d5-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "Interface-less", def: "Type 5 model resolved via Router MAC and L3 VNI, no overlay index." },
            { term: "Overlay index", def: "A GW IP or ESI that a Type 5 route resolves through recursively." },
            { term: "Recursive resolution", def: "Resolving a route's next hop through another routing table." },
          ]}
        />
      </GuideSection>

      <GuideSection id="d5-mental" eyebrow="Recap" title="Mental model" tone="success">
        <Callout tone="success" title="Recap" icon="✓">
          A Type 5 route stacks on several layers — session, import, installation, next-hop resolution. Traffic flows only when every layer holds.
        </Callout>
      </GuideSection>
    </>
  );
}
