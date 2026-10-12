import { Callout, CompareCards, DArrow, DIAGRAM as D, DNode, DiagramFrame, DiagramSvg, FailureSignatures, FieldTable, GuideSection, Misconceptions, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { DHeaderColumn } from "@/components/lesson/Srv6GuideSvg";
import { DRouteCard } from "@/components/lesson/EvpnGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { ExplainIt, KnowledgeQuiz, PracticeBridge, type KnowledgeQuestion } from "@/components/lesson/GuideInteractive";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import { PresentationBridge } from "@/components/presentation/LessonPresentation";
import { CliPanel, FailureWalk } from "@/components/lesson/GuideCli";
import { EVPN_EXPORT_RT, VNI, VTEP_LOOPBACK, rdFor } from "@/lib/sim-engine/scenarios/evpnVxlan";
import { evApply, evTicket, evTicketState, type EvTicketId } from "@/lib/sim-engine/scenarios/evNet";
import { EV_FRESH, EV_LEARNED, PingResult, evCli, evOnly } from "./LessonGuideContent";

const G = { foundation: "Foundation", data: "Data plane", control: "Control plane", ops: "Operations", trouble: "Troubleshooting", beyond: "Beyond this lesson", master: "Master it" };
export const EVPNV_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "vd-why", label: "Layer 2 over a routed fabric", group: G.foundation },
  { id: "vd-planes", label: "Control and data plane", group: G.foundation },
  { id: "vd-vxlan", label: "The VXLAN header", group: G.data },
  { id: "vd-bum", label: "Broadcast, unknown, multicast", group: G.data },
  { id: "vd-mtu", label: "MTU and the underlay", group: G.data },
  { id: "vd-evpn", label: "EVPN's role", group: G.control },
  { id: "vd-evi", label: "EVI, MAC-VRF, instance", group: G.control },
  { id: "vd-types", label: "The route types", group: G.control },
  { id: "vd-nlri", label: "Type 2 fields", group: G.control },
  { id: "vd-macip", label: "MAC-only and MAC+IP", group: G.control },
  { id: "vd-nexthop", label: "The VTEP as BGP next hop", group: G.control },
  { id: "vd-rdrt", label: "RD and RT in depth", group: G.control },
  { id: "vd-config", label: "Configuring it on Junos", group: G.ops },
  { id: "vd-verify", label: "How to verify", group: G.ops },
  { id: "vd-signatures", label: "Failure signatures", group: G.trouble },
  { id: "vd-trouble", label: "The troubleshooting ladder", group: G.trouble },
  { id: "vd-tickets", label: "Five faults, evidence to proof", group: G.trouble },
  { id: "vd-next", label: "What comes next", group: G.beyond },
  { id: "vd-myths", label: "Common misconceptions", group: G.master },
  { id: "vd-quiz", label: "Knowledge check", group: G.master },
  { id: "vd-explain", label: "Can you explain it?", group: G.master },
  { id: "vd-practice", label: "Practice in the EVPN-VXLAN Lab", group: G.master },
];

// Real CLI output and ping results: the EVPN-VXLAN Lab's own command set and model.
const ticket = (id: EvTicketId) => evTicket(id).repro.reduce((acc, a) => evApply(acc, a), evTicketState(id, 1));
const T = { rt: ticket("rt"), vni: ticket("vni"), family: ticket("family"), underlay: ticket("underlay"), access: ticket("access") };

function LabBridge() {
  const openLab = usePracticeLabOpener();
  return (
    <PracticeBridge label="Open the EVPN-VXLAN Lab" onPractice={openLab}>
      The fabric from this page on Junos, your own copy. Nothing you do there changes your lesson progress.
    </PracticeBridge>
  );
}

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


const QUIZ: KnowledgeQuestion[] = [
  {
    id: "q-spine",
    prompt: "What does SPINE1 need to forward a VXLAN packet from LEAF1 to LEAF2?",
    options: [
      { id: "a", label: "A route to LEAF2's loopback" },
      { id: "b", label: "HOST-B's MAC address" },
      { id: "c", label: "VNI 10010 configured" },
    ],
    correctId: "a",
    explanation: "The spine routes on the outer IP destination. It never inspects the VXLAN header.",
  },
  {
    id: "q-vlan",
    prompt: "LEAF1 maps VLAN 10 and LEAF2 maps VLAN 110 to VNI 10010. Can their hosts talk?",
    options: [
      { id: "a", label: "Yes — the VNI is what must match" },
      { id: "b", label: "No — the VLAN IDs must match" },
      { id: "c", label: "Only with VLAN translation on the spine" },
    ],
    correctId: "a",
    explanation: "The VLAN ID never leaves the leaf; the VXLAN header carries only the VNI.",
  },
  {
    id: "q-type3",
    prompt: "No host has sent anything yet. Which EVPN routes already exist?",
    options: [
      { id: "a", label: "Type 3 — one per leaf per VNI" },
      { id: "b", label: "Type 2 for every host" },
      { id: "c", label: "None" },
    ],
    correctId: "a",
    explanation: "Type 3 announces membership of a VNI; Type 2 needs a locally learned MAC.",
  },
  {
    id: "q-learn",
    prompt: "How does LEAF1 learn that HOST-B lives behind LEAF2?",
    options: [
      { id: "a", label: "From LEAF2's Type 2 route" },
      { id: "b", label: "From the source MAC of decapsulated packets" },
      { id: "c", label: "From the spine" },
    ],
    correctId: "a",
    explanation: "With EVPN, remote MACs are learned in the control plane; data-plane learning across the fabric is off.",
  },
  {
    id: "q-received",
    prompt: "show bgp summary on LEAF1: bgp.evpn.0 0/1/0/0. What does that mean?",
    options: [
      { id: "a", label: "One route received, none accepted — look at the route targets" },
      { id: "b", label: "The session is down" },
      { id: "c", label: "LEAF2 advertises nothing" },
    ],
    correctId: "a",
    explanation: "Active/Received/Accepted/Damped: the route arrived and was not imported.",
  },
  {
    id: "q-session",
    prompt: "The EVPN session is down, the leaf–spine links are up. First check?",
    options: [
      { id: "a", label: "Each leaf's loopback in the underlay (show route 10.255.0.2)" },
      { id: "b", label: "The route targets" },
      { id: "c", label: "The VNI mapping" },
    ],
    correctId: "a",
    explanation: "The session runs between loopbacks: no underlay route, no session.",
  },
  {
    id: "q-flood",
    prompt: "A leaf receives a broadcast in a VXLAN packet. Where does it send copies?",
    options: [
      { id: "a", label: "To its local ports in that VNI's VLAN only" },
      { id: "b", label: "To its local ports and every other VTEP" },
      { id: "c", label: "Back to the sender" },
    ],
    correctId: "a",
    explanation: "The ingress leaf already replicated to every VTEP. Sending it back into the fabric would loop.",
  },
  {
    id: "q-nh",
    prompt: "What is the BGP next hop of LEAF2's Type 2 route for HOST-B?",
    options: [
      { id: "a", label: "10.255.0.2 — LEAF2's VTEP" },
      { id: "b", label: "10.10.10.22 — HOST-B" },
      { id: "c", label: "10.255.0.254 — the spine" },
    ],
    correctId: "a",
    explanation: "The next hop is the tunnel endpoint the traffic must be sent to.",
  },
];

export function EvpnVxlanDeepDiveContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="vd-why" eyebrow="Foundation" title="Layer 2 over a routed fabric" tone="cyan">
        <p>Data-center fabrics route between leaf and spine — every link active, no spanning tree, failures contained by the IGP. Applications still need Layer 2 adjacency across racks: clusters, virtual-machine mobility, legacy software. VXLAN (RFC 7348) carries the Ethernet frames over the routed fabric; EVPN (RFC 7432, applied to VXLAN by RFC 8365) gives the leaves a BGP control plane to know where everything is.</p>
      </GuideSection>

      <GuideSection id="vd-planes" eyebrow="Foundation" title="Control and data plane" tone="violet">
        <DiagramFrame caption="Two independent pipelines that meet at the forwarding table.">
          <PlanesDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="vd-vxlan" eyebrow="Data plane" title="The VXLAN header" tone="ip">
        <DiagramFrame caption="VXLAN is a MAC-in-UDP encapsulation.">
          <VxlanHeaderDiagram />
        </DiagramFrame>
        <p>UDP destination port 4789; the source port is derived from a hash of the inner headers, so the underlay&apos;s ECMP spreads different flows over different spines. The 24-bit VNI allows about 16 million segments, against 4094 VLANs.</p>
      </GuideSection>

      <GuideSection id="vd-bum" eyebrow="Data plane" title="Broadcast, unknown, multicast" tone="warning">
        <CompareCards
          items={[
            { title: "Ingress replication", tone: "violet", tag: "this lab", points: ["the ingress leaf sends one unicast copy per remote VTEP", "the list comes from Type 3 routes", "no multicast in the underlay"] },
            { title: "Underlay multicast", tone: "cyan", tag: "alternative", points: ["each VNI maps to a multicast group", "the underlay replicates", "needs PIM in the fabric"] },
          ]}
        />
        <p>A leaf that receives a flooded VXLAN packet delivers it to its local ports in that VNI and never sends it back into the fabric — the ingress leaf already reached every VTEP.</p>
      </GuideSection>

      <GuideSection id="vd-mtu" eyebrow="Data plane" title="MTU and the underlay" tone="ip">
        <p>The envelope adds 50 bytes (outer Ethernet 14, IP 20, UDP 8, VXLAN 8) — 54 with a VLAN tag on the outer frame. A host sending full 1500-byte frames needs fabric links of at least 1550 bytes; fabrics usually run jumbo frames (9000+) to be safe. VXLAN packets are not fragmented by the VTEPs.</p>
      </GuideSection>

      <GuideSection id="vd-evpn" eyebrow="Control plane" title="EVPN's role" tone="bgp">
        <CompareCards
          items={[
            { title: "VXLAN", tone: "ip", tag: "data plane", points: ["encapsulates tenant frames", "carries the VNI", "knows nothing about reachability"] },
            { title: "EVPN", tone: "bgp", tag: "control plane", points: ["BGP address family L2VPN EVPN (AFI 25 / SAFI 70)", "advertises VTEP membership and MAC/IP", "never forwards a tenant packet"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="vd-evi" eyebrow="Control plane" title="EVI, MAC-VRF, instance" tone="cyan">
        <DiagramFrame caption="An EVPN instance is represented on each leaf by a MAC-VRF.">
          <EviDiagram />
        </DiagramFrame>
        <p>On a Junos QFX leaf the EVPN instance is the default switching instance (<Mono>default-switch</Mono>): its RD and VTEP source come from <Mono>switch-options</Mono>, and each VLAN with a VNI is a bridge domain inside it, with its own route target in <Mono>vni-options</Mono>.</p>
      </GuideSection>

      <GuideSection id="vd-types" eyebrow="Control plane" title="The route types" tone="bgp">
        <FieldTable
          title="EVPN route types"
          accent="violet"
          columns={["Type", "Name", "Used for", "In this lesson"]}
          rows={[
            ["1", "Ethernet auto-discovery", "multihoming, fast convergence", "later lessons"],
            ["2", "MAC/IP advertisement", "where each MAC (and IP) lives", "yes"],
            ["3", "Inclusive multicast Ethernet tag", "VNI membership, BUM flood lists", "yes"],
            ["4", "Ethernet segment", "designated-forwarder election", "later lessons"],
            ["5", "IP prefix", "routes into the fabric", "later lessons"],
          ]}
        />
        <CliPanel run={evOnly(EV_LEARNED, "LEAF1", "show route table bgp.evpn.0", /^(2|3):/)} caption="Junos · LEAF1 — Type 2 (MAC and MAC+IP) and Type 3 routes" />
      </GuideSection>

      <GuideSection id="vd-nlri" eyebrow="Control plane" title="Type 2 fields" tone="bgp">
        <DiagramFrame caption="Conceptual view — field encodings are defined in RFC 7432 and RFC 8365.">
          <NlriDiagram />
        </DiagramFrame>
        <p>Junos prints a Type 2 route as <Mono>2:RD::Ethernet-tag::MAC::IP/304</Mono> — here <Mono>2:10.255.0.2:10010::10010::bb:bb:bb:bb:bb:22::10.10.10.22</Mono> — and a Type 3 route as <Mono>3:RD::Ethernet-tag::originator/248</Mono>.</p>
      </GuideSection>

      <GuideSection id="vd-macip" eyebrow="Control plane" title="MAC-only and MAC+IP" tone="bgp">
        <CompareCards
          items={[
            { title: "MAC-only Type 2", tone: "cyan", tag: "bridging", points: ["enough to forward frames to the right VTEP", "advertised as soon as the MAC is learned"] },
            { title: "MAC+IP Type 2", tone: "violet", tag: "binding", points: ["adds the host's IP once the leaf has seen its ARP", "enables ARP suppression and host routing (later lessons)"] },
          ]}
        />
        <CliPanel run={evCli(EV_LEARNED, "LEAF2", "show evpn database")} caption="Junos · LEAF2 — HOST-A behind 10.255.0.1 with its IP, HOST-B local" />
      </GuideSection>

      <GuideSection id="vd-nexthop" eyebrow="Control plane" title="The VTEP as BGP next hop" tone="ip">
        <DiagramFrame caption="The next hop must be resolvable through the underlay.">
          <NextHopDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="vd-rdrt" eyebrow="Control plane" title="RD and RT in depth" tone="bgp">
        <p>The RD is prepended to each route so identical MAC information from different leaves never collides inside BGP. The RT is an extended community checked against the import policy: a Junos leaf keeps an EVPN route only if one of its instances imports the route target, and uses it only for a VNI it has. Changing an RD never changes what is imported; changing an RT can.</p>
        <Callout tone="cyan" title="Per-VNI targets" icon="i">
          <Mono>vni-options vni 10010 vrf-target target:65000:10010</Mono> sets import and export for that VNI; <Mono>switch-options vrf-target</Mono> sets the instance-wide target used for routes that belong to no single VNI. Many designs use <Mono>vrf-target auto</Mono> to derive targets from the VNI.
        </Callout>
      </GuideSection>

      <GuideSection id="vd-config" eyebrow="Operations" title="Configuring it on Junos" tone="cyan">
        <CliPanel run={evCli(EV_FRESH, "LEAF1", "show configuration")} caption="Junos · LEAF1 — the whole leaf: access ports, underlay, BGP EVPN, protocols evpn, switch-options, VLANs" />
        <p className="text-sm text-pv-text-muted">Five pieces, all required: the VLAN with its VNI, the VTEP source and RD, encapsulation vxlan with the VNI extended and targeted, the BGP session with family evpn signaling — and the loopback in the underlay.</p>
      </GuideSection>

      <GuideSection id="vd-verify" eyebrow="Operations" title="How to verify" tone="success">
        <FieldTable
          title="The questions, and where the answers are (Junos)"
          accent="success"
          columns={["Question", "Command"]}
          rows={[
            ["Is the other VTEP reachable?", <Mono key="1">show route 10.255.0.2</Mono>],
            ["Is the session up, routes accepted?", <Mono key="2">show bgp summary</Mono>],
            ["Which EVPN routes?", <Mono key="3">show route table bgp.evpn.0</Mono>],
            ["Which remote VTEPs per VNI?", <Mono key="4">show ethernet-switching vxlan-tunnel-end-point remote</Mono>],
            ["Where is each MAC?", <Mono key="5">show evpn database</Mono>],
            ["How is it forwarded?", <Mono key="6">show ethernet-switching table</Mono>],
          ]}
        />
      </GuideSection>

      <GuideSection id="vd-signatures" eyebrow="Troubleshooting" title="Failure signatures" tone="danger">
        <FailureSignatures
          items={[
            { tag: "RT", title: "Route target mismatch", tone: "danger", points: ["received, not accepted", "no remote VTEP"] },
            { tag: "VNI", title: "VLAN → wrong VNI", tone: "danger", points: ["accepted, VNI unknown", "drops at the far leaf"] },
            { tag: "AF", title: "No family evpn", tone: "danger", points: ["Established", "zero EVPN routes"] },
            { tag: "IGP", title: "Loopback not in the underlay", tone: "warning", points: ["session down", "no route to the VTEP"] },
            { tag: "PORT", title: "Host port in the wrong VLAN", tone: "violet", points: ["that host silent", "Type 2 withdrawn"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="vd-trouble" eyebrow="Troubleshooting" title="The troubleshooting ladder" tone="warning">
        <DiagramFrame caption="Bottom up.">
          <LadderDiagram />
        </DiagramFrame>
        <TroubleshootingFlow
          steps={[
            { question: "Is the host's port in the right VLAN?", look: "show ethernet-switching interface" },
            { question: "Can each VTEP reach the other?", look: "show route to the remote loopback" },
            { question: "Session up with family evpn?", look: "show bgp summary" },
            { question: "Same VNI on both leaves?", look: "show configuration vlans" },
            { question: "Routes accepted?", look: "received vs accepted; the route targets" },
          ]}
        />
      </GuideSection>

      <GuideSection id="vd-tickets" eyebrow="Troubleshooting" title="Five faults, evidence to proof" tone="danger">
        <p>The EVPN-VXLAN Lab&apos;s five tickets, with the fault in place.</p>
        <FailureWalk
          title="1 · HOST-A can't reach HOST-B"
          normal="Both leaves use route target 65000:10010 for VNI 10010."
          change="LEAF1's VNI 10010 got target 65000:99999."
          evidence={<CliPanel run={evOnly(T.rt, "LEAF1", "show bgp summary", /Peer|^10\.255|bgp\.evpn/)} caption="Junos · LEAF1 — 1 received, 0 accepted" />}
          next="No usable Type 3 route: no remote VTEP, the flood never leaves LEAF1."
          fix={<Mono>LEAF1: set protocols evpn vni-options vni 10010 vrf-target target:65000:10010 → commit</Mono>}
          proof="LEAF2 back in the remote VTEP list; a fresh ping from HOST-A reaches HOST-B."
        />
        <FailureWalk
          title="2 · LEAF2 rebuilt from a template"
          normal="V10 maps to VNI 10010 on both leaves."
          change="The template mapped LEAF2's V10 to VNI 10011."
          evidence={<CliPanel run={evCli(T.vni, "LEAF2", "show configuration vlans")} caption="Junos · LEAF2 — vni 10011" />}
          next="LEAF1 accepts LEAF2's routes (same target) but for a VNI it doesn't have; VXLAN for VNI 10010 is dropped at LEAF2."
          fix={<Mono>LEAF2: set vlans V10 vxlan vni 10010 · extended-vni-list 10010 · vni-options vni 10010 vrf-target target:65000:10010 → commit</Mono>}
          proof="Both leaves see each other for VNI 10010; a fresh ping from HOST-B reaches HOST-A."
        />
        <FailureWalk
          title="3 · Established, but empty"
          normal="The OVERLAY group carries family evpn signaling."
          change="A BGP clean-up on LEAF2 dropped the family."
          evidence={<CliPanel run={evOnly(T.family, "LEAF2", "show bgp summary", /Peer|^10\.255|inet\.0/)} caption="Junos · LEAF2 — Establ, inet.0 only" />}
          next="No EVPN routes at all: no flood list, no remote MACs."
          fix={<Mono>LEAF2: set protocols bgp group OVERLAY family evpn signaling → commit</Mono>}
          proof="bgp.evpn.0 routes accepted; a fresh ping from HOST-A reaches HOST-B."
        />
        <FailureWalk
          title="4 · Everything down after an OSPF change"
          normal="Each leaf's lo0.0 is in OSPF (passive)."
          change="LEAF2's lo0.0 left OSPF."
          evidence={<CliPanel run={evCli(T.underlay, "LEAF1", "show route table inet.0")} caption="Junos · LEAF1 — no route to 10.255.0.2" />}
          next="No route to LEAF2's loopback: no session, and nowhere to send VXLAN."
          fix={<Mono>LEAF2: set protocols ospf area 0.0.0.0 interface lo0.0 passive → commit</Mono>}
          proof="An OSPF route to 10.255.0.2, the session up; a fresh ping from HOST-A reaches HOST-B."
        />
        <FailureWalk
          title="5 · HOST-B was re-patched"
          normal="HOST-B's port xe-0/0/1 is in V10."
          change="After maintenance it is in V20."
          evidence={<CliPanel run={evCli(T.access, "LEAF2", "show ethernet-switching interface xe-0/0/1")} caption="Junos · LEAF2 — xe-0/0/1.0 member of V20" />}
          next="HOST-B lands in a VLAN without a VNI; its Type 2 route for VNI 10010 disappears."
          fix={<Mono>LEAF2: set interfaces xe-0/0/1 unit 0 family ethernet-switching vlan members V10 → commit</Mono>}
          proof="V10 on xe-0/0/1; a fresh ping from HOST-A reaches HOST-B."
        />
        <PingResult s={T.rt} title="The lab: ticket 1 reproduced" />
      </GuideSection>

      <GuideSection id="vd-next" eyebrow="Beyond this lesson" title="What comes next" tone="violet">
        <FieldTable
          title="The rest of the EVPN story"
          accent="violet"
          columns={["Topic", "What it adds"]}
          rows={[
            ["BUM in depth", "Type 3 details, replication choices, split horizon at the far leaf"],
            ["ARP/ND suppression", "leaves answer ARP from MAC+IP routes"],
            ["IRB and anycast gateway", "routing between VNIs at the leaf"],
            ["Type 5 routes", "IP prefixes into the fabric"],
            ["Multihoming", "a host on two leaves: ESI, Type 1/4, designated forwarder"],
          ]}
        />
      </GuideSection>

      <GuideSection id="vd-myths" eyebrow="Master it" title="Common misconceptions" tone="warning">
        <Misconceptions
          items={[
            { myth: "The spine must know the tenant VLANs.", correction: "It routes the outer IP header; tenant MACs and VLANs never reach it." },
            { myth: "VLAN IDs must match across the fabric.", correction: "Only the VNI must match; VLAN IDs are local to each leaf." },
            { myth: "An Established session means the routes are used.", correction: "Check received versus accepted, and whether the VNI is local." },
            { myth: "Remote MACs are learned from VXLAN traffic.", correction: "With EVPN they come from Type 2 routes." },
            { myth: "EVPN removes all flooding.", correction: "Broadcasts like ARP still flood — to the VTEPs on the Type 3 list." },
            { myth: "The BGP next hop is the host.", correction: "It is the VTEP that owns the host." },
          ]}
        />
      </GuideSection>

      <GuideSection id="vd-quiz" eyebrow="Master it" title="Knowledge check" tone="cyan">
        <KnowledgeQuiz questions={QUIZ} />
      </GuideSection>

      <GuideSection id="vd-explain" eyebrow="Master it" title="Can you explain it?" tone="violet">
        <ExplainIt
          items={[
            { q: "What does VXLAN do, and what doesn't it do?", a: "It carries Ethernet frames inside UDP/IP between VTEPs, tagged with a VNI. It doesn't tell a leaf where a MAC lives or which VTEPs share a VNI." },
            { q: "What do Type 3 and Type 2 routes each tell a leaf?", a: "Type 3: this VTEP has this VNI — so it gets a copy of every broadcast. Type 2: this MAC (and IP) lives behind this VTEP." },
            { q: "Why did HOST-A fail to reach HOST-B with the session Established?", a: "LEAF1's VNI 10010 imported 65000:99999, so it dropped LEAF2's routes — no remote VTEP, no remote MAC." },
            { q: "Why can LEAF2 know HOST-C even if HOST-C never crossed the fabric?", a: "LEAF1 learned HOST-C locally and advertised a Type 2 route for it." },
            { q: "Why does the underlay come first in troubleshooting?", a: "The session and the tunnels both run between loopbacks: without loopback reachability nothing above can work." },
          ]}
        />
      </GuideSection>

      <GuideSection id="vd-practice" eyebrow="Master it" title="Practice in the EVPN-VXLAN Lab" tone="success">
        <p>Six Learn levels take you from &quot;one LAN across a routed fabric&quot; to reading the evidence; the engineering workspace gives you both leaves and the spine on Junos, EVPN routes and MAC tables, pings from five hosts, five challenges and the five tickets above.</p>
        <LabBridge />
        <PresentationBridge>Rewatch the EVPN-VXLAN presentation.</PresentationBridge>
      </GuideSection>
    </div>
  );
}
