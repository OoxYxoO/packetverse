import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DPill, DiagramFrame, DiagramSvg, FieldTable, FlowSteps, Glossary, GuideSection, Mono } from "@/components/lesson/GuideBlocks";
import { DStack } from "@/components/lesson/MplsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { ARCH_COLOR, ARCH_NAME, ArchSnapshot, type Arch } from "./evoSvg";

export const EVO_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "el-brief", label: "The engineering brief" },
  { id: "el-dims", label: "The comparison dimensions" },
  { id: "el-snapshots", label: "Five architectures at a glance" },
  { id: "el-vpws", label: "VPWS" },
  { id: "el-multipoint", label: "Why multipoint needs more" },
  { id: "el-vpls", label: "LDP-VPLS" },
  { id: "el-mesh", label: "The mesh-growth problem" },
  { id: "el-bgpvpls", label: "BGP-VPLS" },
  { id: "el-incident", label: "The missing-MAC incident" },
  { id: "el-hvpls", label: "H-VPLS" },
  { id: "el-evpn", label: "EVPN" },
  { id: "el-learning", label: "MAC reachability, compared" },
  { id: "el-bum", label: "BUM, compared" },
  { id: "el-transport", label: "What never changed" },
  { id: "el-decide", label: "How to choose" },
  { id: "el-glossary", label: "Glossary" },
  { id: "el-recap", label: "Mental model" },
];

const ORDER: Arch[] = ["VPWS", "VPLS", "BGP_VPLS", "H_VPLS", "EVPN"];

function SnapshotsDiagram() {
  return (
    <DiagramSvg h={170} label="Five thumbnails: VPWS one wire, LDP-VPLS a PE triangle, BGP-VPLS triangle plus route reflector, H-VPLS triangle with spokes, EVPN route reflector with BGP routes">
      {ORDER.map((a, i) => (
        <g key={a}>
          <ArchSnapshot arch={a} cx={68 + i * 126} cy={70} />
          <text x={68 + i * 126} y={140} textAnchor="middle" fill={ARCH_COLOR[a]} fontSize={11} fontWeight={700}>
            {ARCH_NAME[a]}
          </text>
          {i < ORDER.length - 1 && <DArrow x1={120 + i * 126} y1={70} x2={138 + i * 126} y2={70} color={D.faint} width={1.4} />}
        </g>
      ))}
      <text x={320} y={162} textAnchor="middle" fill={D.muted} fontSize={10}>
        each step answers a new requirement; none replaces all the others
      </text>
    </DiagramSvg>
  );
}

function ChangeDiagram() {
  const rows: [Arch, string][] = [
    ["VPWS", "point-to-point transport"],
    ["VPLS", "+ multipoint bridging"],
    ["BGP_VPLS", "+ BGP discovery / signaling"],
    ["H_VPLS", "+ access hierarchy"],
    ["EVPN", "+ control-plane MAC/IP"],
  ];
  return (
    <DiagramSvg h={200} label="What each architecture changes: point-to-point transport, multipoint bridging, BGP discovery, access hierarchy, control-plane MAC/IP">
      {rows.map(([a, t], i) => (
        <g key={a}>
          <DPill x={110} y={24 + i * 36} text={ARCH_NAME[a]} color={ARCH_COLOR[a]} w={130} />
          <text x={200} y={28 + i * 36} fill={D.text} fontSize={11}>
            {t}
          </text>
        </g>
      ))}
      <text x={600} y={190} textAnchor="end" fill={D.muted} fontSize={9.5}>
        H-VPLS and BGP-VPLS change different axes and can be combined
      </text>
    </DiagramSvg>
  );
}

function IncidentDiagram() {
  return (
    <DiagramSvg h={210} label="In BGP-VPLS PE1 has no FDB entry for CE3 until CE3 sends traffic: flood, learn from the reply, then known unicast. In EVPN a Type 2 route can install CE3 before any traffic.">
      <text x={160} y={20} textAnchor="middle" fill={ARCH_COLOR.BGP_VPLS} fontSize={11} fontWeight={700}>
        BGP-VPLS (the incident)
      </text>
      <FlowLine x={160} y={45} steps={["CE1 → CE3: unknown → flood", "CE3 replies → PE1 learns", "CE1 → CE3: known → PE3 only"]} color={ARCH_COLOR.BGP_VPLS} />
      <text x={480} y={20} textAnchor="middle" fill={ARCH_COLOR.EVPN} fontSize={11} fontWeight={700}>
        EVPN (for comparison)
      </text>
      <FlowLine x={480} y={45} steps={["CE3 appears at PE3", "PE3 → Type 2 → PE1 installs", "CE1 → CE3: already known"]} color={ARCH_COLOR.EVPN} />
    </DiagramSvg>
  );
}

function FlowLine({ x, y, steps, color }: { x: number; y: number; steps: string[]; color: string }) {
  return (
    <g>
      {steps.map((s, i) => (
        <g key={s}>
          <DPill x={x} y={y + i * 58} text={s} color={color} w={250} />
          {i < steps.length - 1 && <DArrow x1={x} y1={y + i * 58 + 13} x2={x} y2={y + i * 58 + 44} color={D.faint} width={1.4} />}
        </g>
      ))}
    </g>
  );
}

function LearningDiagram() {
  const rows: [Arch, string, boolean][] = [
    ["VPWS", "not needed (one remote end)", false],
    ["VPLS", "data plane: flood & learn", false],
    ["BGP_VPLS", "data plane: flood & learn", false],
    ["H_VPLS", "data plane, at both tiers", false],
    ["EVPN", "control plane: BGP Type 2", true],
  ];
  return (
    <DiagramSvg h={200} label="Where remote MAC reachability comes from in each architecture">
      {rows.map(([a, t, cp], i) => (
        <g key={a}>
          <text x={20} y={30 + i * 36} fill={ARCH_COLOR[a]} fontSize={11} fontWeight={700}>
            {ARCH_NAME[a]}
          </text>
          <DPill x={cp ? 470 : 250} y={26 + i * 36} text={t} color={cp ? D.success : D.warning} w={230} />
        </g>
      ))}
      <text x={250} y={196} textAnchor="middle" fill={D.warning} fontSize={10} fontWeight={700}>
        data plane
      </text>
      <text x={470} y={196} textAnchor="middle" fill={D.success} fontSize={10} fontWeight={700}>
        control plane
      </text>
    </DiagramSvg>
  );
}

function VpwsStack() {
  return (
    <DiagramSvg h={120} label="The VPWS recap stack: transport 102 S0 over PW 25001 S1 over Ethernet">
      <DStack x={140} y={16} labels={[{ text: "102 S0", tag: "OUTER" }, { text: "25001 S1", tag: "INNER", color: D.violet }]} payload="Ethernet" w={96} />
      <text x={260} y={40} fill={D.text} fontSize={10.5}>
        OUTER: transport to the remote PE
      </text>
      <text x={260} y={63} fill={D.text} fontSize={10.5}>
        INNER: service label owned by the remote PE
      </text>
      <text x={260} y={86} fill={D.muted} fontSize={10}>
        every architecture here keeps this outer/inner split
      </text>
    </DiagramSvg>
  );
}

export function EvoLessonGuideContent() {
  return (
    <>
      <GuideSection id="el-brief" eyebrow="Introduction" title="The engineering brief" tone="violet">
        <p>
          VPWS, LDP-VPLS, BGP-VPLS, H-VPLS and EVPN can all deliver a Layer-2 service. This capstone keeps the <b className="text-pv-text">same customer</b> (CUST-A: CE1, CE2, CE3 on <Mono>192.168.100.0/24</Mono>) and asks the same questions of each architecture, so the only thing that changes is the architecture.
        </p>
        <Callout tone="cyan" title="Scope of this capstone" icon="i">
          It is an orchestrator: each mechanism is reused from its own lesson and shown in a PE-to-PE service view. Full hop-by-hop MPLS walks, EVPN route types beyond Type 2/3, and vendor CLI are left to the dedicated lessons.
        </Callout>
      </GuideSection>

      <GuideSection id="el-dims" eyebrow="Method" title="The comparison dimensions" tone="cyan">
        <ChecklistCard
          tone="cyan"
          mark="?"
          title="Ask every architecture the same questions"
          items={["Service type: point-to-point or multipoint?", "Discovery: how do PEs find each other?", "Signaling: how are service labels exchanged?", "MAC reachability: data plane or control plane?", "BUM: how is it replicated?", "Split horizon and multihoming", "What stays pure MPLS transport?"]}
        />
      </GuideSection>

      <GuideSection id="el-snapshots" eyebrow="Overview" title="Five architectures at a glance" tone="violet">
        <DiagramFrame caption="Switch between these in the lesson with the architecture selector (2D, 3D and Focus).">
          <SnapshotsDiagram />
        </DiagramFrame>
        <DiagramFrame caption="What each step changed.">
          <ChangeDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="el-vpws" eyebrow="Architecture 1" title="VPWS" tone="mpls">
        <p>CE1 ═ CE2: one targeted-LDP-signaled pseudowire (PWid FEC 128), exactly one remote endpoint, no MAC lookup needed.</p>
        <DiagramFrame caption="The signature stack, recapped from the VPWS lesson.">
          <VpwsStack />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="el-multipoint" eyebrow="Transition" title="Why multipoint needs more" tone="warning">
        <p>When CE3 must join the same LAN, a second point-to-point pseudowire doesn&apos;t create one broadcast domain. Someone has to decide which remote site each frame goes to, and that requires a bridge.</p>
      </GuideSection>

      <GuideSection id="el-vpls" eyebrow="Architecture 2" title="LDP-VPLS" tone="violet">
        <FlowSteps
          steps={[
            { title: "Control", body: "Targeted LDP builds a full mesh of pseudowires between PE1, PE2 and PE3.", tone: "violet" },
            { title: "First frame", body: "CE2's MAC is unknown at PE1 → flood to both PEs.", tone: "warning" },
            { title: "Reply", body: "PE1 learns CE2 from the source MAC arriving on the PW from PE2.", tone: "success" },
            { title: "Next frame", body: "Known unicast → PE2 only.", tone: "cyan" },
          ]}
        />
      </GuideSection>

      <GuideSection id="el-mesh" eyebrow="Transition" title="The mesh-growth problem" tone="danger">
        <p>A full mesh needs n(n−1)/2 pseudowires, each configured per pair. Two different pressures follow: <b className="text-pv-text">configuration and signaling</b> (answered by BGP-VPLS) and <b className="text-pv-text">mesh size at the access edge</b> (answered by H-VPLS).</p>
      </GuideSection>

      <GuideSection id="el-bgpvpls" eyebrow="Architecture 3" title="BGP-VPLS" tone="bgp">
        <p>
          BGP-VPLS changes only <b className="text-pv-text">discovery and signaling</b>: PEs peer with RR1 and advertise RD, RT, VE ID and a label block, with label = Label Base + VE ID − VBO. The service is still a full PW mesh, and customer MACs are still learned from traffic.
        </p>
        <Callout tone="warning" title="The most common misconception" icon="!">
          BGP-VPLS does not advertise customer MAC addresses. That is exactly what separates it from EVPN.
        </Callout>
      </GuideSection>

      <GuideSection id="el-incident" eyebrow="Incident" title="The missing-MAC incident" tone="danger">
        <p>An engineer expects PE1 to have a BGP route for CE3&apos;s MAC. Membership, labels and the mesh are all healthy; only the FDB entry is missing.</p>
        <DiagramFrame caption="Compare the two learning models before deciding what (if anything) is broken.">
          <IncidentDiagram />
        </DiagramFrame>
        <ChecklistCard
          tone="danger"
          mark="→"
          title="How to reason about it (no spoilers)"
          items={["Walk the ladder: session, address family, RT import, membership, labels, adjacency.", "Then ask how this architecture is supposed to learn a remote MAC.", "Decide what action the symptoms actually call for, then verify with traffic."]}
        />
      </GuideSection>

      <GuideSection id="el-hvpls" eyebrow="Architecture 4" title="H-VPLS" tone="warning">
        <p>
          H-VPLS changes the <b className="text-pv-text">service topology</b>: MTU-s access nodes attach with one spoke each, and only the PE-rs core is fully meshed. Split horizon is refined: spoke → mesh ✓, mesh → spoke ✓, mesh → mesh ✕. MAC learning is still data-plane.
        </p>
        <FieldTable
          title="Scaling example (from the lesson)"
          accent="warning"
          columns={["10 access sites", "Pseudowires"]}
          rows={[
            ["Flat full mesh", "45"],
            ["H-VPLS, 3-PE core", "13 (3 mesh + 10 spokes)"],
          ]}
        />
      </GuideSection>

      <GuideSection id="el-evpn" eyebrow="Architecture 5" title="EVPN" tone="success">
        <p>
          EVPN moves <b className="text-pv-text">Ethernet reachability into BGP</b>: when CE3 appears at PE3, PE3 advertises a Type 2 (MAC/IP) route and PE1 can install CE3 before CE1 ever sends to it. It also brings native multihoming (Ethernet Segment, ESI, DF election, aliasing, mass withdrawal) and sequence-numbered MAC mobility.
        </p>
        <Callout tone="cyan" title="EVPN does not eliminate BUM" icon="i">
          Type 3 (IMET) routes set up who receives BUM; ingress replication or underlay multicast still carries it. Unknown destinations can still occur.
        </Callout>
      </GuideSection>

      <GuideSection id="el-learning" eyebrow="Comparison" title="MAC reachability, compared" tone="violet">
        <DiagramFrame caption="Only EVPN moves remote-MAC knowledge into the control plane.">
          <LearningDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="el-bum" eyebrow="Comparison" title="BUM, compared" tone="warning">
        <FieldTable
          title="Replication and loop prevention"
          accent="warning"
          columns={["Architecture", "BUM", "Loop / duplicate prevention"]}
          rows={[
            ["VPWS", "n/a (one remote port)", "n/a"],
            ["LDP-VPLS", "Replicated over every service PW except ingress", "Mesh PW → mesh PW forbidden"],
            ["BGP-VPLS", "Same as LDP-VPLS", "Same as LDP-VPLS"],
            ["H-VPLS", "Replicated at both tiers", "Only mesh → mesh forbidden"],
            ["EVPN", "Type 3 builds the list; ingress replication or multicast", "ESI-based split horizon, DF election"],
          ]}
        />
      </GuideSection>

      <GuideSection id="el-transport" eyebrow="Constant" title="What never changed" tone="mpls">
        <p>In every architecture the outer label is ordinary MPLS transport, P routers hold no customer MACs, and route reflectors never switch customer frames. The service layer evolved; the transport stayed separate.</p>
      </GuideSection>

      <GuideSection id="el-decide" eyebrow="Method" title="How to choose (no universal winner)" tone="cyan">
        <CompareCards
          items={[
            { title: "Start from requirements", tone: "cyan", tag: "method", points: ["Point-to-point or multipoint?", "Is data-plane learning acceptable?", "Is BGP-based discovery wanted?", "Is access hierarchy needed?", "Are multihoming or fast MAC mobility required?"] },
            { title: "Then match capabilities", tone: "violet", tag: "evaluate", points: ["Check each requirement against each architecture", "Prefer the simplest design that meets all of them", "Consider what the network already runs"] },
          ]}
        />
        <p>The decision labs and the final challenge in the lesson apply exactly this method.</p>
      </GuideSection>

      <GuideSection id="el-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "Service view", def: "The PE-to-PE abstraction this capstone uses for every architecture." },
            { term: "Flood and learn", def: "Data-plane MAC learning used by VPLS, BGP-VPLS and H-VPLS." },
            { term: "Type 2 route", def: "EVPN MAC/IP advertisement route." },
            { term: "Type 3 route", def: "EVPN Inclusive Multicast (IMET): BUM membership." },
            { term: "ESI / DF", def: "EVPN Ethernet Segment Identifier / Designated Forwarder." },
            { term: "Spoke / mesh PW", def: "H-VPLS access and core pseudowires." },
            { term: "Label block", def: "BGP-VPLS: Label Base + VE Block Offset + Size." },
          ]}
        />
      </GuideSection>

      <GuideSection id="el-recap" eyebrow="Recap" title="Mental model" tone="violet">
        <div className="rounded-2xl border border-pv-violet/30 bg-gradient-to-br from-pv-violet/10 to-pv-mpls/5 p-5 text-sm leading-relaxed text-pv-text">
          Each architecture answered one new question. VPWS: connect two ports. VPLS: connect many as a LAN. BGP-VPLS: stop configuring the mesh by hand. H-VPLS: stop growing the mesh at the edge. EVPN: stop learning remote MACs only from traffic. Which one fits depends on which of those questions your network actually has.
        </div>
      </GuideSection>
    </>
  );
}
