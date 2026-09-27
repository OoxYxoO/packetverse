import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DNode, DiagramFrame, DiagramSvg, Glossary, GuideSection } from "@/components/lesson/GuideBlocks";
import { DHeaderColumn } from "@/components/lesson/Srv6GuideSvg";
import { DRouteCard } from "@/components/lesson/EvpnGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { EVPN_EXPORT_RT, VNI, VTEP_LOOPBACK, rdFor } from "@/lib/sim-engine/scenarios/evpnVxlan";

export const EVPNV_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "vd-planes", label: "Control vs data plane" },
  { id: "vd-vxlan", label: "RFC 7348 VXLAN model" },
  { id: "vd-evpn", label: "EVPN's control-plane role" },
  { id: "vd-evi", label: "EVI / MAC-VRF" },
  { id: "vd-nlri", label: "Type 2 conceptual fields" },
  { id: "vd-macip", label: "MAC-only vs MAC+IP" },
  { id: "vd-nexthop", label: "The VTEP as BGP next hop" },
  { id: "vd-rdrt", label: "RD and RT in depth" },
  { id: "vd-underlay", label: "Underlay independence" },
  { id: "vd-trouble", label: "Troubleshooting ladder" },
  { id: "vd-verify", label: "Verification" },
  { id: "vd-glossary", label: "Glossary" },
  { id: "vd-mental", label: "Mental model" },
];

function PlanesDiagram() {
  const lane = (y: number, title: string, steps: string[], color: string) => (
    <g>
      <text x={24} y={y + 20} fill={color} fontSize={11.5} fontWeight={700}>
        {title}
      </text>
      {steps.map((s, i) => (
        <g key={s}>
          <rect x={150 + i * 158} y={y} width={146} height={34} rx={8} fill={color} fillOpacity={0.12} stroke={color} strokeOpacity={0.75} />
          <text x={150 + i * 158 + 73} y={y + 21} textAnchor="middle" fill={D.text} fontSize={10}>
            {s}
          </text>
          {i < steps.length - 1 && <DArrow x1={150 + i * 158 + 146} y1={y + 17} x2={150 + (i + 1) * 158} y2={y + 17} color={color} width={1.4} />}
        </g>
      ))}
    </g>
  );
  return (
    <DiagramSvg h={170} label="Control plane: local learn, Type 2 advertised, remote install. Data plane: encapsulate, route outer IP, decapsulate">
      {lane(20, "Control plane", ["local MAC learn", "Type 2 over BGP", "remote MAC install"], D.bgp)}
      {lane(90, "Data plane", ["VXLAN encapsulate", "route outer IP", "decapsulate + deliver"], D.ip)}
      <text x={320} y={158} textAnchor="middle" fill={D.muted} fontSize={10}>
        the control plane fills the tables; the data plane only reads them
      </text>
    </DiagramSvg>
  );
}

function VxlanHeaderDiagram() {
  return (
    <DiagramSvg h={200} label="VXLAN adds outer Ethernet, outer IP, UDP and an 8-byte VXLAN header carrying the 24-bit VNI and the I flag">
      <DHeaderColumn
        x={220}
        y={20}
        w={300}
        rows={[
          { text: "Outer Ethernet", color: D.faint, tag: "14 B" },
          { text: "Outer IPv4 (VTEP → VTEP)", color: D.ip, tag: "20 B" },
          { text: "UDP (dst 4789, src = flow hash)", color: D.ip, tag: "8 B" },
          { text: "VXLAN: flags (I) + 24-bit VNI", color: D.violet, tag: "8 B", strong: true },
          { text: "original Ethernet frame", color: D.eth, tag: "inner" },
        ]}
      />
      <text x={520} y={70} textAnchor="middle" fill={D.text} fontSize={11} fontWeight={700}>
        ≈ 50 bytes added
      </text>
      <text x={520} y={88} textAnchor="middle" fill={D.muted} fontSize={10}>
        (IPv4 underlay)
      </text>
      <text x={320} y={150} textAnchor="middle" fill={D.muted} fontSize={10}>
        the source UDP port carries entropy so the underlay can load-balance flows
      </text>
    </DiagramSvg>
  );
}

function EviDiagram() {
  return (
    <DiagramSvg h={170} label={`Each leaf holds a MAC-VRF for the EVPN instance of VNI ${VNI}, with its own RD and the shared RT ${EVPN_EXPORT_RT}`}>
      <DRouteCard x={30} y={20} w={260} title="LEAF1 — MAC-VRF (VNI instance)" color={D.cyan} rows={[{ label: "RD", value: rdFor("LEAF1") }, { label: "RT import/export", value: EVPN_EXPORT_RT, strong: true }]} />
      <DRouteCard x={350} y={20} w={260} title="LEAF2 — MAC-VRF (VNI instance)" color={D.cyan} rows={[{ label: "RD", value: rdFor("LEAF2") }, { label: "RT import/export", value: EVPN_EXPORT_RT, strong: true }]} />
      <text x={320} y={130} textAnchor="middle" fill={D.muted} fontSize={10}>
        different RDs keep each leaf&apos;s routes distinct; the shared RT is what makes them import each other&apos;s
      </text>
    </DiagramSvg>
  );
}

function NlriDiagram() {
  return (
    <DiagramSvg h={220} label="Conceptual Type 2 route fields: RD, Ethernet Segment Identifier, Ethernet Tag, MAC address, optional IP address, a label carrying the VNI, plus path attributes such as the next hop and route targets">
      <DRouteCard
        x={40}
        y={16}
        w={280}
        title="Type 2 NLRI (conceptual)"
        rows={[
          { label: "RD", value: "uniqueness" },
          { label: "ESI", value: "0 when single-homed" },
          { label: "Ethernet Tag", value: "service context" },
          { label: "MAC address", value: "always present", strong: true },
          { label: "IP address", value: "optional" },
          { label: "Label / VNI", value: "which segment" },
        ]}
      />
      <DRouteCard x={350} y={16} w={250} title="Path attributes" color={D.violet} rows={[{ label: "Next hop", value: "owning VTEP", strong: true }, { label: "Route Targets", value: "import policy" }, { label: "Extended communities", value: "e.g. encapsulation" }]} />
      <text x={320} y={200} textAnchor="middle" fill={D.muted} fontSize={10}>
        this lesson&apos;s packet view shows the fields it actually uses
      </text>
    </DiagramSvg>
  );
}

function NextHopDiagram() {
  return (
    <DiagramSvg h={150} label={`The BGP next hop of a Type 2 route is the VTEP loopback, for example ${VTEP_LOOPBACK.LEAF2}; the underlay must be able to reach it`}>
      <DNode x={110} y={60} label="Type 2 route" sub="next hop = VTEP" accent={D.bgp} w={170} />
      <DArrow x1={200} y1={60} x2={300} y2={60} color={D.faint} />
      <DNode x={380} y={60} label={`${VTEP_LOOPBACK.LEAF2}`} sub="LEAF2 loopback" accent={D.ip} w={170} />
      <DArrow x1={470} y1={60} x2={540} y2={60} color={D.faint} />
      <DNode x={585} y={60} label="Underlay" sub="must reach it" accent={D.cyan} w={90} />
      <text x={320} y={130} textAnchor="middle" fill={D.muted} fontSize={10}>
        the host (HOST-B) never appears as a next hop — it takes no part in VXLAN or BGP
      </text>
    </DiagramSvg>
  );
}

function LadderDiagram() {
  const steps = ["Access port / VLAN", "Underlay reachability to VTEPs", "BGP EVPN session", "Route received", "Route imported (RT)", "MAC table entry", "VXLAN encap / decap"];
  return (
    <DiagramSvg h={290} label="Troubleshooting ladder from access port up through VXLAN forwarding">
      {steps.map((s, i) => (
        <g key={s}>
          <rect x={170} y={12 + i * 38} width={300} height={30} rx={8} fill={D.cyan} fillOpacity={0.08} stroke={D.cyan} strokeOpacity={0.6} />
          <text x={320} y={32 + i * 38} textAnchor="middle" fill={D.text} fontSize={11}>
            {i + 1}. {s}
          </text>
        </g>
      ))}
    </DiagramSvg>
  );
}

export function EvpnVxlanDeepDiveContent() {
  return (
    <>
      <GuideSection id="vd-planes" eyebrow="Model" title="Control vs data plane" tone="violet">
        <DiagramFrame caption="Two independent pipelines that meet at the forwarding table.">
          <PlanesDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="vd-vxlan" eyebrow="Encapsulation" title="RFC 7348 VXLAN model" tone="ip">
        <DiagramFrame caption="VXLAN is a MAC-in-UDP encapsulation.">
          <VxlanHeaderDiagram />
        </DiagramFrame>
        <p>RFC 7348 describes VXLAN with a flood-and-learn data plane, commonly using underlay multicast for BUM traffic. EVPN (RFC 8365) replaces that learning with a BGP control plane while keeping the same VXLAN encapsulation.</p>
      </GuideSection>

      <GuideSection id="vd-evpn" eyebrow="Control plane" title="EVPN's control-plane role" tone="bgp">
        <CompareCards
          items={[
            { title: "VXLAN", tone: "ip", tag: "data plane", points: ["Encapsulates tenant frames", "Carries the VNI", "Knows nothing about reachability by itself"] },
            { title: "EVPN", tone: "bgp", tag: "control plane", points: ["BGP address family L2VPN EVPN", "Advertises MAC/IP, membership and prefixes", "Never forwards a tenant packet"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="vd-evi" eyebrow="Structure" title="EVI / MAC-VRF" tone="cyan">
        <DiagramFrame caption="An EVPN instance is represented on each leaf by a MAC-VRF.">
          <EviDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="vd-nlri" eyebrow="Control plane" title="Type 2 conceptual fields" tone="bgp">
        <DiagramFrame caption="Conceptual view — field encodings are defined in RFC 7432 and RFC 8365.">
          <NlriDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="vd-macip" eyebrow="Control plane" title="MAC-only vs MAC+IP" tone="bgp">
        <CompareCards
          items={[
            { title: "MAC-only Type 2", tone: "cyan", tag: "bridging", points: ["Enough to forward frames to the right VTEP", "No IP binding for the endpoint"] },
            { title: "MAC+IP Type 2", tone: "violet", tag: "bridging + binding", points: ["Also binds the IP to the MAC", "Enables features such as ARP/ND suppression and host routing"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="vd-nexthop" eyebrow="Control plane" title="The VTEP as BGP next hop" tone="ip">
        <DiagramFrame caption="The next hop must be resolvable through the underlay.">
          <NextHopDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="vd-rdrt" eyebrow="Control plane" title="RD and RT in depth" tone="bgp">
        <p>The RD is prepended to the route so identical MAC/IP information from different leaves never collides inside BGP. The RT is an extended community evaluated against import policy. Changing an RD never changes what is imported; changing an RT can.</p>
      </GuideSection>

      <GuideSection id="vd-underlay" eyebrow="Design" title="Underlay independence" tone="ospf">
        <p>The underlay can be any routing design that makes the VTEP loopbacks reachable — OSPF, IS-IS or eBGP. The spine never needs to understand VXLAN, the VNI or any tenant MAC.</p>
      </GuideSection>

      <GuideSection id="vd-trouble" eyebrow="Operations" title="Troubleshooting ladder" tone="warning">
        <DiagramFrame caption="Walk up from the bottom; stop at the first rung that fails.">
          <LadderDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="vd-verify" eyebrow="Operations" title="Verification" tone="success">
        <ChecklistCard tone="success" title="Evidence" mark="✓" items={["VTEP loopbacks reachable in the underlay routing table.", "BGP EVPN session Established.", "Type 2 routes received and imported with the expected RT.", "MAC table entries pointing at the right remote VTEP.", "A real frame delivered end to end."]} />
      </GuideSection>

      <GuideSection id="vd-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "EVI", def: "EVPN Instance — the service instance a set of leaves share." },
            { term: "MAC-VRF", def: "The per-leaf table for one EVPN instance's MAC/IP routes." },
            { term: "NLRI", def: "Network Layer Reachability Information — the route's key fields." },
            { term: "I flag", def: "VXLAN header bit meaning the VNI field is valid." },
            { term: "Flood-and-learn", def: "Learning remote locations by flooding and observing replies." },
          ]}
        />
      </GuideSection>

      <GuideSection id="vd-mental" eyebrow="Recap" title="Mental model" tone="success">
        <Callout tone="success" title="Recap" icon="✓">
          The underlay reaches VTEPs, VXLAN carries frames between them, and EVPN distributes who lives behind which VTEP. Keep the three layers separate when you troubleshoot.
        </Callout>
      </GuideSection>
    </>
  );
}
