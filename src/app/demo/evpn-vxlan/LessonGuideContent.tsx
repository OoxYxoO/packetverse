import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DiagramFrame, DiagramSvg, FieldTable, Glossary, GuideSection, Mono } from "@/components/lesson/GuideBlocks";
import { DHeaderColumn } from "@/components/lesson/Srv6GuideSvg";
import { DRouteCard, EvpnFabric } from "@/components/lesson/EvpnGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { EVPN_EXPORT_RT, HOST_A_IP, HOST_A_MAC, HOST_B_IP, HOST_B_MAC, VLAN, VNI, VTEP_LOOPBACK, rdFor } from "@/lib/sim-engine/scenarios/evpnVxlan";

export const EVPNV_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "lv-mission", label: "The mission" },
  { id: "lv-fabric", label: "Physical fabric" },
  { id: "lv-layers", label: "Underlay vs overlay" },
  { id: "lv-vlan-vni", label: "VLAN vs VNI" },
  { id: "lv-vtep", label: "What a VTEP does" },
  { id: "lv-encap", label: "VXLAN encapsulation" },
  { id: "lv-decap", label: "Remote decapsulation" },
  { id: "lv-why-evpn", label: "Why a control plane" },
  { id: "lv-type2", label: "EVPN Type 2" },
  { id: "lv-mac", label: "Local vs remote MAC" },
  { id: "lv-rd-rt", label: "RD vs RT" },
  { id: "lv-fault", label: "The incident" },
  { id: "lv-verify", label: "Verification" },
  { id: "lv-glossary", label: "Glossary" },
  { id: "lv-recap", label: "Mental model" },
];

function FabricDiagram() {
  return (
    <DiagramSvg h={250} label={`Spine-leaf fabric: HOST-A on LEAF1 (VTEP ${VTEP_LOOPBACK.LEAF1}), HOST-B on LEAF2 (VTEP ${VTEP_LOOPBACK.LEAF2}), SPINE1 routes the underlay only`}>
      <EvpnFabric
        leaves={[
          { id: "LEAF1", sub: `VTEP ${VTEP_LOOPBACK.LEAF1}`, host: "HOST-A", hostSub: HOST_A_IP },
          { id: "LEAF2", sub: `VTEP ${VTEP_LOOPBACK.LEAF2}`, host: "HOST-B", hostSub: HOST_B_IP },
        ]}
      />
      <text x={320} y={244} textAnchor="middle" fill={D.muted} fontSize={10}>
        both hosts are in VLAN {VLAN} — but the leaf-to-spine links are routed IP links
      </text>
    </DiagramSvg>
  );
}

function LayersDiagram() {
  const band = (y: number, label: string, sub: string, color: string) => (
    <g>
      <rect x={40} y={y} width={560} height={46} rx={10} fill={color} fillOpacity={0.1} stroke={color} strokeOpacity={0.7} />
      <text x={60} y={y + 20} fill={color} fontSize={12} fontWeight={700}>
        {label}
      </text>
      <text x={60} y={y + 36} fill={D.muted} fontSize={10}>
        {sub}
      </text>
    </g>
  );
  return (
    <DiagramSvg h={190} label="Three layers: tenant overlay segment, VXLAN tunnel between VTEPs, IP underlay between loopbacks">
      {band(16, `Overlay — VNI ${VNI}`, "one logical Layer-2 segment for the tenant hosts", D.violet)}
      {band(70, "VXLAN tunnel — VTEP to VTEP", `${VTEP_LOOPBACK.LEAF1} ↔ ${VTEP_LOOPBACK.LEAF2}, UDP 4789`, D.ip)}
      {band(124, "Underlay — ordinary IP routing", "SPINE1 only needs to reach the VTEP loopbacks", D.cyan)}
    </DiagramSvg>
  );
}

function VlanVniDiagram() {
  return (
    <DiagramSvg h={170} label={`LEAF1 maps local VLAN ${VLAN} to VNI ${VNI}; LEAF2 maps its own local VLAN ${VLAN} to the same VNI; the VNI unifies them`}>
      <DRouteCard x={30} y={20} w={190} title="LEAF1 (local)" rows={[{ label: "access VLAN", value: String(VLAN) }, { label: "mapped to", value: `VNI ${VNI}`, strong: true }]} color={D.cyan} />
      <DRouteCard x={420} y={20} w={190} title="LEAF2 (local)" rows={[{ label: "access VLAN", value: String(VLAN) }, { label: "mapped to", value: `VNI ${VNI}`, strong: true }]} color={D.cyan} />
      <rect x={250} y={36} width={140} height={44} rx={10} fill={D.violet} fillOpacity={0.14} stroke={D.violet} />
      <text x={320} y={57} textAnchor="middle" fill={D.violet} fontSize={12} fontWeight={700}>
        VNI {VNI}
      </text>
      <text x={320} y={72} textAnchor="middle" fill={D.muted} fontSize={9}>
        fabric-wide, 24-bit
      </text>
      <DArrow x1={222} y1={58} x2={248} y2={58} color={D.violet} />
      <DArrow x1={418} y1={58} x2={392} y2={58} color={D.violet} />
      <text x={320} y={140} textAnchor="middle" fill={D.muted} fontSize={10}>
        VLAN numbers are local to each leaf — the VNI is what joins the two access ports
      </text>
    </DiagramSvg>
  );
}

function EncapDiagram() {
  return (
    <DiagramSvg h={210} label={`VXLAN stack leaving LEAF1: outer Ethernet, outer IP ${VTEP_LOOPBACK.LEAF1} to ${VTEP_LOOPBACK.LEAF2}, UDP 4789, VXLAN VNI ${VNI}, then the original HOST-A to HOST-B frame`}>
      <text x={200} y={18} textAnchor="middle" fill={D.text} fontSize={11.5} fontWeight={700}>
        leaving LEAF1
      </text>
      <DHeaderColumn
        x={200}
        y={28}
        w={290}
        rows={[
          { text: "Outer Ethernet (per underlay hop)", color: D.faint, tag: "L2" },
          { text: `Outer IP ${VTEP_LOOPBACK.LEAF1} → ${VTEP_LOOPBACK.LEAF2}`, color: D.ip, tag: "VTEPs", strong: true },
          { text: "UDP dst 4789", color: D.ip, tag: "UDP" },
          { text: `VXLAN · VNI ${VNI}`, color: D.violet, tag: "VXLAN", strong: true },
          { text: `Ethernet ${HOST_A_MAC} → ${HOST_B_MAC}`, color: D.eth, tag: "INNER" },
          { text: `IPv4 ${HOST_A_IP} → ${HOST_B_IP}`, color: D.eth },
        ]}
      />
      <text x={500} y={60} textAnchor="middle" fill={D.muted} fontSize={10}>
        SPINE1 reads only
      </text>
      <text x={500} y={74} textAnchor="middle" fill={D.ip} fontSize={10} fontWeight={700}>
        the outer IP
      </text>
      <DArrow x1={440} y1={70} x2={350} y2={70} color={D.faint} width={1.4} />
      <text x={320} y={200} textAnchor="middle" fill={D.muted} fontSize={10}>
        the inner frame is carried unchanged — HOST-B receives exactly what HOST-A sent
      </text>
    </DiagramSvg>
  );
}

function Type2Diagram() {
  return (
    <DiagramSvg h={250} label={`LEAF2 advertises a Type 2 route for HOST-B to LEAF1: MAC ${HOST_B_MAC}, IP ${HOST_B_IP}, VNI ${VNI}, RD ${rdFor("LEAF2")}, RT ${EVPN_EXPORT_RT}, next hop ${VTEP_LOOPBACK.LEAF2}`}>
      <DRouteCard
        x={180}
        y={16}
        w={280}
        title="EVPN Type 2 — MAC/IP Advertisement"
        rows={[
          { label: "MAC", value: HOST_B_MAC },
          { label: "IP", value: HOST_B_IP },
          { label: "VNI", value: String(VNI) },
          { label: "RD (uniqueness)", value: rdFor("LEAF2") },
          { label: "RT (import policy)", value: EVPN_EXPORT_RT },
          { label: "BGP next hop", value: `${VTEP_LOOPBACK.LEAF2} (LEAF2 VTEP)`, strong: true },
        ]}
      />
      <text x={80} y={186} textAnchor="middle" fill={D.text} fontSize={12} fontWeight={700}>
        LEAF1
      </text>
      <text x={560} y={186} textAnchor="middle" fill={D.text} fontSize={12} fontWeight={700}>
        LEAF2
      </text>
      <DArrow x1={525} y1={182} x2={115} y2={182} color={D.bgp} dashed label="" />
      <text x={320} y={216} textAnchor="middle" fill={D.bgp} fontSize={10} fontWeight={700}>
        BGP UPDATE (L2VPN EVPN) — control plane, never a tenant packet
      </text>
      <text x={320} y={234} textAnchor="middle" fill={D.muted} fontSize={10}>
        the next hop names the VTEP that owns the endpoint — never the host itself
      </text>
    </DiagramSvg>
  );
}

function MacTableDiagram() {
  return (
    <DiagramSvg h={160} label={`LEAF1 MAC table: ${HOST_A_MAC} local on the access port; ${HOST_B_MAC} remote via VTEP ${VTEP_LOOPBACK.LEAF2}, learned from EVPN`}>
      <DRouteCard
        x={120}
        y={16}
        w={400}
        title="LEAF1 — VNI MAC table"
        color={D.cyan}
        rows={[
          { label: `${HOST_A_MAC} (${HOST_A_IP})`, value: "LOCAL · access port" },
          { label: `${HOST_B_MAC} (${HOST_B_IP})`, value: `REMOTE · via ${VTEP_LOOPBACK.LEAF2} (EVPN)`, strong: true },
        ]}
      />
      <text x={320} y={130} textAnchor="middle" fill={D.muted} fontSize={10}>
        the forwarding entry is installed FROM the Type 2 route — related to it, not the same object
      </text>
    </DiagramSvg>
  );
}

export function EvpnVxlanLessonGuideContent() {
  return (
    <>
      <GuideSection id="lv-mission" eyebrow="Introduction" title="The mission: one VLAN across a routed fabric" tone="cyan">
        <p>
          HOST-A and HOST-B share VLAN {VLAN}, but they sit behind different leaf switches joined by a routed spine. A VLAN does not cross a Layer-3 hop by itself. This lesson carries their frames across the fabric with VXLAN, then replaces guesswork with a BGP EVPN control plane.
        </p>
        <Callout tone="cyan" title="VXLAN moves the frame. EVPN tells VTEPs where the endpoint lives." icon="i">
          VXLAN is the data-plane encapsulation. EVPN is the BGP control plane. They are separate layers that work together.
        </Callout>
      </GuideSection>

      <GuideSection id="lv-fabric" eyebrow="Setup" title="Physical fabric" tone="ospf">
        <DiagramFrame caption="The lesson's topology — the addresses come straight from the scenario.">
          <FabricDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="lv-layers" eyebrow="Model" title="Underlay vs overlay" tone="ip">
        <DiagramFrame caption="Each layer only needs to understand its own addresses.">
          <LayersDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="lv-vlan-vni" eyebrow="Identifiers" title="VLAN vs VNI" tone="violet">
        <DiagramFrame caption="Two different identifiers with two different scopes.">
          <VlanVniDiagram />
        </DiagramFrame>
        <p>A VLAN ID is locally significant on each switch. A VNI is a 24-bit identifier carried in the VXLAN header and shared across the fabric. Two leaves could use different local VLAN numbers for the same VNI.</p>
      </GuideSection>

      <GuideSection id="lv-vtep" eyebrow="Roles" title="What a VTEP does" tone="violet">
        <FieldTable
          title="Who does what"
          accent="violet"
          columns={["Device", "Role", "Needs tenant MACs?"]}
          rows={[
            ["LEAF1", `VTEP ${VTEP_LOOPBACK.LEAF1} — encapsulates`, "Yes"],
            ["SPINE1", "Routes outer IP packets", "No"],
            ["LEAF2", `VTEP ${VTEP_LOOPBACK.LEAF2} — decapsulates`, "Yes"],
          ]}
        />
      </GuideSection>

      <GuideSection id="lv-encap" eyebrow="Data plane" title="VXLAN encapsulation" tone="ip">
        <DiagramFrame caption="The exact stack the lesson's packet inspector shows.">
          <EncapDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="lv-decap" eyebrow="Data plane" title="Remote decapsulation" tone="ip">
        <p>LEAF2 removes the outer Ethernet, IP, UDP and VXLAN headers, uses the VNI to pick the right segment, and delivers the original frame out of HOST-B&apos;s access port.</p>
      </GuideSection>

      <GuideSection id="lv-why-evpn" eyebrow="Motivation" title="Why a control plane" tone="warning">
        <CompareCards
          items={[
            { title: "Flood-and-learn", tone: "warning", tag: "without EVPN", points: ["Unknown destinations are replicated to every VTEP in the VNI", "Locations are guessed from replies", "Cost grows with the fabric"] },
            { title: "BGP EVPN", tone: "bgp", tag: "this lesson", points: ["The owning VTEP advertises MAC/IP reachability", "Receivers install a verified entry", "No flood needed to find a known endpoint"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="lv-type2" eyebrow="Control plane" title="EVPN Type 2" tone="bgp">
        <DiagramFrame caption="Type 2 answers one question: where is this endpoint?">
          <Type2Diagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="lv-mac" eyebrow="Tables" title="Local vs remote MAC" tone="cyan">
        <DiagramFrame caption="A local entry comes from the access port; a remote entry comes from EVPN.">
          <MacTableDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="lv-rd-rt" eyebrow="Control plane" title="RD vs RT" tone="bgp">
        <FieldTable
          title="Two fields, two jobs"
          accent="bgp"
          columns={["Field", "Value here", "Job"]}
          rows={[
            ["RD", <Mono key="rd">{rdFor("LEAF2")}</Mono>, "Keeps the route unique in BGP — never decides import"],
            ["RT", <Mono key="rt">{EVPN_EXPORT_RT}</Mono>, "Export/import policy — decides which VNI table imports it"],
          ]}
        />
      </GuideSection>

      <GuideSection id="lv-fault" eyebrow="Troubleshooting" title="The incident" tone="danger">
        <ChecklistCard
          tone="danger"
          title="How to reason about it (no spoilers)"
          mark="→"
          items={["Note what still works and what does not.", "Walk the layers bottom-up: access port, underlay, BGP session, EVPN routes, MAC table, forwarding.", "At each layer, look for evidence rather than assumptions.", "Pick the fix only for the first layer that fails."]}
        />
      </GuideSection>

      <GuideSection id="lv-verify" eyebrow="Operations" title="Verification" tone="success">
        <ChecklistCard tone="success" title="Evidence" mark="✓" items={["The received Type 2 route and its RT.", "LEAF1's MAC table entry for HOST-B and its remote VTEP.", "A real frame from HOST-A reaching HOST-B after any change."]} />
      </GuideSection>

      <GuideSection id="lv-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "VTEP", def: "VXLAN Tunnel Endpoint — encapsulates and decapsulates, identified by its loopback." },
            { term: "VNI", def: "VXLAN Network Identifier — the 24-bit, fabric-wide overlay segment ID." },
            { term: "Underlay", def: "The routed IP network that carries VXLAN between VTEPs." },
            { term: "Overlay", def: "The tenant segment built on top of the underlay." },
            { term: "Type 2", def: "EVPN MAC/IP Advertisement route: where an endpoint lives." },
            { term: "RD / RT", def: "Route Distinguisher (uniqueness) and Route Target (import policy)." },
          ]}
        />
      </GuideSection>

      <GuideSection id="lv-recap" eyebrow="Recap" title="Mental model" tone="success">
        <Callout tone="success" title="One sentence" icon="✓">
          VXLAN wraps the tenant frame so the IP underlay can carry it between VTEPs; EVPN Type 2 tells each VTEP which remote VTEP owns each MAC/IP, and the RT decides whether that information is imported.
        </Callout>
      </GuideSection>
    </>
  );
}
