import { Callout, ChecklistCard, CompareCards, DIAGRAM as D, DLink, DNode, DPill, DRegion, DiagramFrame, DiagramSvg, FieldTable, FlowSteps, Glossary, GuideSection, Mono } from "@/components/lesson/GuideBlocks";
import { DStack } from "@/components/lesson/MplsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";

export const HVPLS_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "hl-mission", label: "The mission" },
  { id: "hl-flat", label: "The flat-mesh problem" },
  { id: "hl-tiers", label: "MTU-s and PE-rs" },
  { id: "hl-topology", label: "This lesson's hierarchy" },
  { id: "hl-core", label: "Core mesh first" },
  { id: "hl-spokes", label: "Spoke pseudowires" },
  { id: "hl-roles", label: "Three port roles" },
  { id: "hl-split", label: "Role-aware split horizon" },
  { id: "hl-learn", label: "Learning at MTU1" },
  { id: "hl-bum", label: "BUM through the tiers" },
  { id: "hl-local", label: "Local switching" },
  { id: "hl-remote", label: "Remote forwarding" },
  { id: "hl-fdb", label: "One MAC, many views" },
  { id: "hl-scale", label: "What hierarchy buys" },
  { id: "hl-planes", label: "Control vs data plane" },
  { id: "hl-fault", label: "The port-role incident" },
  { id: "hl-spokefail", label: "A real spoke failure" },
  { id: "hl-challenge", label: "The engineer challenge" },
  { id: "hl-glossary", label: "Glossary" },
  { id: "hl-recap", label: "Mental model" },
];

const POS: Record<string, [number, number]> = {
  CE1: [40, 30],
  CE2: [40, 90],
  CE3: [40, 200],
  CE4: [600, 60],
  MTU1: [140, 60],
  MTU2: [140, 200],
  MTU3: [500, 60],
  PE1: [260, 60],
  PE2: [300, 170],
  PE3: [390, 60],
};

function Hierarchy({ highlight = [], blocked = [], faultPe1 }: { highlight?: string[]; blocked?: string[]; faultPe1?: boolean }) {
  const links: [string, string, "access" | "spoke" | "mesh"][] = [
    ["CE1", "MTU1", "access"],
    ["CE2", "MTU1", "access"],
    ["CE3", "MTU2", "access"],
    ["MTU3", "CE4", "access"],
    ["MTU1", "PE1", "spoke"],
    ["MTU2", "PE2", "spoke"],
    ["PE3", "MTU3", "spoke"],
    ["PE1", "PE2", "mesh"],
    ["PE1", "PE3", "mesh"],
    ["PE2", "PE3", "mesh"],
  ];
  return (
    <>
      <DRegion x={220} y={20} w={210} h={190} label="PE-rs core mesh" color={D.mpls} />
      {links.map(([a, b, tier]) => {
        const id = `${a}-${b}`;
        const [x1, y1] = POS[a];
        const [x2, y2] = POS[b];
        const base = tier === "access" ? D.ip : tier === "spoke" ? D.warning : D.violet;
        const color = blocked.includes(id) ? D.danger : highlight.includes(id) ? D.success : base;
        return <DLink key={id} x1={x1} y1={y1} x2={x2} y2={y2} color={color} dashed={tier === "spoke" || blocked.includes(id)} />;
      })}
      {Object.entries(POS).map(([id, [x, y]]) => (
        <DNode key={id} x={x} y={y} label={id} accent={id.startsWith("CE") ? D.ip : id.startsWith("MTU") ? D.warning : faultPe1 && id === "PE1" ? D.danger : D.mpls} w={id.startsWith("CE") ? 52 : 64} h={30} />
      ))}
    </>
  );
}

function FlatVsHier() {
  return (
    <DiagramSvg h={170} label="Six devices in a flat full mesh need 15 pseudowires; three PE-rs plus three MTU-s need 3 mesh plus 3 spoke, 6 pseudowires">
      <text x={160} y={20} textAnchor="middle" fill={D.danger} fontSize={11} fontWeight={700}>
        flat: 6 devices, 15 PWs
      </text>
      {Array.from({ length: 6 }, (_, i) => {
        const a = (i / 6) * Math.PI * 2;
        return [160 + Math.cos(a) * 60, 95 + Math.sin(a) * 60] as [number, number];
      }).map((p, i, all) => (
        <g key={i}>
          {all.slice(i + 1).map((q, j) => (
            <line key={j} x1={p[0]} y1={p[1]} x2={q[0]} y2={q[1]} stroke={D.danger} strokeOpacity={0.5} />
          ))}
          <circle cx={p[0]} cy={p[1]} r={9} fill={D.box} stroke={D.mpls} />
        </g>
      ))}
      <text x={480} y={20} textAnchor="middle" fill={D.success} fontSize={11} fontWeight={700}>
        hierarchical: 3 mesh + 3 spokes = 6 PWs
      </text>
      {[
        [430, 70],
        [530, 70],
        [480, 140],
      ].map(([x, y], i, all) => (
        <g key={i}>
          {all.slice(i + 1).map(([x2, y2], j) => (
            <line key={j} x1={x} y1={y} x2={x2} y2={y2} stroke={D.violet} strokeWidth={2} />
          ))}
        </g>
      ))}
      {[
        [430, 70, 380, 40],
        [530, 70, 590, 40],
        [480, 140, 480, 165],
      ].map(([x, y, mx, my], i) => (
        <g key={i}>
          <line x1={x} y1={y} x2={mx} y2={my} stroke={D.warning} strokeWidth={2} strokeDasharray="4 3" />
          <circle cx={mx} cy={my} r={7} fill={D.box} stroke={D.warning} />
          <circle cx={x} cy={y} r={9} fill={D.box} stroke={D.mpls} />
        </g>
      ))}
    </DiagramSvg>
  );
}

function TopologyDiagram() {
  return (
    <DiagramSvg h={240} label="CE1 and CE2 on MTU1 spoke to PE1; CE3 on MTU2 spoke to PE2; CE4 on MTU3 spoke to PE3; PE1, PE2, PE3 full mesh">
      <Hierarchy />
      <text x={320} y={232} textAnchor="middle" fill={D.muted} fontSize={10}>
        blue = access (AC) · amber dashed = spoke PW · violet = core mesh PW
      </text>
    </DiagramSvg>
  );
}

function BumDiagram() {
  return (
    <DiagramSvg h={240} label="An unknown frame from CE1 goes to CE2 locally and up the spoke to PE1, which sends it on both mesh PWs; PE2 and PE3 send it down their spokes but not to each other">
      <Hierarchy highlight={["CE1-MTU1", "CE2-MTU1", "MTU1-PE1", "PE1-PE2", "PE1-PE3", "MTU2-PE2", "PE3-MTU3", "CE3-MTU2", "MTU3-CE4"]} blocked={["PE2-PE3"]} />
      <DPill x={472} y={130} text="mesh → mesh ✕" color={D.danger} w={120} />
      <text x={320} y={232} textAnchor="middle" fill={D.muted} fontSize={10}>
        spoke → mesh ✓ · mesh → spoke ✓ · mesh → mesh ✕ · CE3 and CE4 discard (wrong destination MAC)
      </text>
    </DiagramSvg>
  );
}

function StacksDiagram() {
  return (
    <DiagramSvg h={150} label="Spoke copy from MTU1 to PE1 carries transport 901 over PE1's spoke label 34011; PE2 down its spoke to MTU2 carries 802 over MTU2's label 44022">
      <text x={180} y={20} textAnchor="middle" fill={D.warning} fontSize={10.5} fontWeight={700}>
        MTU1 → PE1 (spoke)
      </text>
      <DStack x={180} y={32} labels={[{ text: "901 S0", tag: "OUTER" }, { text: "34011 S1", tag: "INNER", color: D.warning }]} payload="Ethernet" w={90} />
      <text x={460} y={20} textAnchor="middle" fill={D.warning} fontSize={10.5} fontWeight={700}>
        PE2 → MTU2 (spoke)
      </text>
      <DStack x={460} y={32} labels={[{ text: "802 S0", tag: "OUTER" }, { text: "44022 S1", tag: "INNER", color: D.warning }]} payload="Ethernet" w={90} />
      <text x={320} y={140} textAnchor="middle" fill={D.muted} fontSize={10}>
        inner = receiver&apos;s spoke label (PE1 owns 34011, MTU2 owns 44022) · only the bottom label has S=1
      </text>
    </DiagramSvg>
  );
}

function FaultDiagram() {
  return (
    <DiagramSvg h={240} label="PE1 wrongly classifies its port to MTU1 as a mesh PW, so frames from MTU1 are treated as mesh ingress and blocked from the other mesh PWs">
      <Hierarchy highlight={["CE1-MTU1", "MTU1-PE1"]} blocked={["PE1-PE2", "PE1-PE3"]} faultPe1 />
      <DPill x={122} y={138} text="PE1 sees MTU1 as MESH_PW" color={D.danger} w={176} />
    </DiagramSvg>
  );
}

export function HvplsLessonGuideContent() {
  return (
    <>
      <GuideSection id="hl-mission" eyebrow="Introduction" title="The mission: scale the virtual LAN" tone="mpls">
        <p>
          <Mono>CUST-A-HVPLS</Mono> (VLAN 100) spans four sites, CE1–CE4. If every access device joined one flat VPLS mesh, the PW count would grow as n(n−1)/2. H-VPLS (RFC 4762 §10) adds a tier: access MTU-s bridges reach the service through one spoke each, and only the PE-rs hubs keep a full mesh.
        </p>
        <Callout tone="cyan" title="Scope of this simulation" icon="i">
          Three MTU-s, three PE-rs, LDP-style signaling for spokes and mesh. P routers are deliberately omitted (transport is recapped as a shared state). Redundant/dual-homed spokes, BGP-signaled H-VPLS and EVPN are only compared.
        </Callout>
      </GuideSection>

      <GuideSection id="hl-flat" eyebrow="Motivation" title="The flat-mesh problem" tone="danger">
        <DiagramFrame caption="Same six devices, restructured: the lesson's own numbers.">
          <FlatVsHier />
        </DiagramFrame>
        <p>Savings depend on the shape of the network; H-VPLS doesn&apos;t promise a fixed ratio. Adding one more MTU-s costs exactly one spoke, instead of one PW to every existing member.</p>
      </GuideSection>

      <GuideSection id="hl-tiers" eyebrow="Roles" title="MTU-s and PE-rs" tone="violet">
        <CompareCards
          items={[
            { title: "MTU-s", tone: "warning", tag: "access tier", points: ["Bridging-capable access device", "ACs to local customer sites", "Exactly one spoke PW to its hub", "Never joins the core mesh"] },
            { title: "PE-rs", tone: "mpls", tag: "core tier", points: ["Routing + bridging capable core PE", "Full mesh with the other PE-rs", "Terminates spokes from its MTU-s", "Still does full VPLS bridging"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="hl-topology" eyebrow="Setup" title="This lesson's hierarchy" tone="cyan">
        <DiagramFrame caption="Customers → MTU-s → spoke → PE-rs ↔ PE-rs → spoke → MTU-s → customers.">
          <TopologyDiagram />
        </DiagramFrame>
        <FieldTable
          title="Sites"
          accent="ip"
          columns={["Site", "MAC", "Access"]}
          rows={[
            ["CE1", <Mono key="1">00:11:11:11:11:11</Mono>, "MTU1 (10.0.0.1) → PE1"],
            ["CE2", <Mono key="2">00:22:22:22:22:22</Mono>, "MTU1 (10.0.0.1) → PE1"],
            ["CE3", <Mono key="3">00:33:33:33:33:33</Mono>, "MTU2 (10.0.0.2) → PE2"],
            ["CE4", <Mono key="4">00:44:44:44:44:44</Mono>, "MTU3 (10.0.0.3) → PE3"],
          ]}
        />
      </GuideSection>

      <GuideSection id="hl-core" eyebrow="Control plane" title="Core mesh first" tone="mpls">
        <p>PE1, PE2 and PE3 build the same full mesh as flat VPLS, with the same receive-label scheme (for example PE1 receives on <Mono>24012</Mono> from PE2, PE2 on <Mono>25021</Mono> from PE1).</p>
      </GuideSection>

      <GuideSection id="hl-spokes" eyebrow="Control plane" title="Spoke pseudowires" tone="warning">
        <FieldTable
          title="Spoke receive labels (each end owns its own)"
          accent="warning"
          columns={["Spoke", "PE-rs receives on", "MTU-s receives on"]}
          rows={[
            ["MTU1 ↔ PE1", <Mono key="a">34011</Mono>, <Mono key="b">44011</Mono>],
            ["MTU2 ↔ PE2", <Mono key="c">34022</Mono>, <Mono key="d">44022</Mono>],
            ["MTU3 ↔ PE3", <Mono key="e">34033</Mono>, <Mono key="f">44033</Mono>],
          ]}
        />
        <p>Spokes use the same directional, receiver-owned labels. What differs isn&apos;t the signaling but how the bridge treats the port.</p>
      </GuideSection>

      <GuideSection id="hl-roles" eyebrow="Bridging" title="Three port roles" tone="violet">
        <FieldTable
          title="Bridge ports in this lesson"
          accent="violet"
          columns={["Device", "Ports"]}
          rows={[
            ["MTU1", "AC: CE1 · AC: CE2 · SPOKE_PW: PE1"],
            ["PE1", "SPOKE_PW: MTU1 · MESH_PW: PE2 · MESH_PW: PE3"],
            ["PE2", "SPOKE_PW: MTU2 · MESH_PW: PE1 · MESH_PW: PE3"],
          ]}
        />
      </GuideSection>

      <GuideSection id="hl-split" eyebrow="Loop prevention" title="Role-aware split horizon" tone="danger">
        <FieldTable
          title="May a frame that arrived on … leave on …?"
          accent="danger"
          columns={["Ingress ↓ / egress →", "AC", "SPOKE_PW", "MESH_PW"]}
          rows={[
            ["AC", "✓", "✓", "✓"],
            ["SPOKE_PW", "✓", "✓", "✓"],
            ["MESH_PW", "✓", "✓", "✕"],
          ]}
        />
        <Callout tone="warning" title="Not flat VPLS's rule" icon="!">
          Flat VPLS blocks PW → PW. In H-VPLS a spoke behaves like an access port, so spoke → mesh and mesh → spoke are allowed; only mesh → mesh is forbidden. Applying the flat rule here would cut every access site off from the core.
        </Callout>
      </GuideSection>

      <GuideSection id="hl-learn" eyebrow="Data plane" title="Learning at MTU1" tone="success">
        <p>CE1 sends to CE2. MTU1 learns <Mono>00:11:11:11:11:11</Mono> on AC: CE1, finds CE2 unknown, and floods to AC: CE2 and SPOKE_PW: PE1. CE2 accepts its copy directly.</p>
      </GuideSection>

      <GuideSection id="hl-bum" eyebrow="Data plane" title="BUM through the tiers" tone="warning">
        <DiagramFrame caption="The first unknown frame, end to end.">
          <BumDiagram />
        </DiagramFrame>
        <DiagramFrame caption="The two-label spoke stacks the lesson shows.">
          <StacksDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="hl-local" eyebrow="Data plane" title="Local switching" tone="success">
        <p>After CE2 replies, MTU1 knows both MACs as local ACs. CE1 ↔ CE2 is then switched entirely inside MTU1; the spoke and the core are never touched. It even survives a spoke failure.</p>
      </GuideSection>

      <GuideSection id="hl-remote" eyebrow="Data plane" title="Remote forwarding" tone="mpls">
        <FlowSteps
          steps={[
            { title: "CE1 → CE3 (unknown)", body: "MTU1 floods to CE2 and its spoke; PE1 (spoke ingress) floods to both mesh peers.", tone: "warning" },
            { title: "PE2 (mesh ingress)", body: <>Sends only down its spoke (<Mono>802 / 44022</Mono>); mesh PW to PE3 is stripped.</>, tone: "mpls" },
            { title: "CE3 replies (known)", body: "MTU2 → spoke → PE2 → mesh straight to PE1 → spoke → MTU1 → CE1: one copy each hop.", tone: "success" },
            { title: "CE1 → CE4", body: "Same pattern down a different core leg: PE1 → PE3 → MTU3.", tone: "cyan" },
          ]}
        />
      </GuideSection>

      <GuideSection id="hl-fdb" eyebrow="State" title="One MAC, many views" tone="violet">
        <p>
          CE1&apos;s MAC is an AC entry at MTU1, SPOKE_PW: MTU1 at PE1, MESH_PW: PE1 at PE2 and PE3, and SPOKE_PW at MTU2/MTU3. Every table is independent and learned from traffic; nothing synchronizes them.
        </p>
      </GuideSection>

      <GuideSection id="hl-scale" eyebrow="Scaling" title="What hierarchy buys, and what it doesn't" tone="cyan">
        <CompareCards
          items={[
            { title: "Gains", tone: "success", tag: "access tier", points: ["One spoke per new site", "Local switching at the MTU-s", "Smaller core mesh"] },
            { title: "Still true", tone: "warning", tag: "core tier", points: ["PE-rs learn every remote MAC", "PE-rs replicate BUM across the mesh", "A hub failure affects all its spokes"] },
          ]}
        />
        <p>H-VPLS is about service topology. BGP-signaled VPLS is about discovery and signaling. They answer different questions and can be combined.</p>
      </GuideSection>

      <GuideSection id="hl-planes" eyebrow="Big picture" title="Control plane vs data plane" tone="violet">
        <CompareCards
          items={[
            { title: "Control plane", tone: "violet", tag: "builds tiers", points: ["Transport LSPs", "Core mesh PWs between PE-rs", "One spoke PW per MTU-s", "Port roles: AC / SPOKE_PW / MESH_PW"] },
            { title: "Data plane", tone: "success", tag: "bridges", points: ["Source learning at every tier", "Local switching at MTU-s", "Role-aware split horizon", "Two-label spoke and mesh stacks"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="hl-fault" eyebrow="Troubleshooting" title="The port-role incident" tone="danger">
        <DiagramFrame caption="Everything is UP; only a classification is wrong.">
          <FaultDiagram />
        </DiagramFrame>
        <ChecklistCard
          tone="danger"
          mark="→"
          title="How to reason about it (no spoilers)"
          items={["Local traffic still works: the problem is beyond MTU1's own bridge.", "All PWs are UP, so look at how ports are treated, not whether they exist.", "Compare the egress set PE1 computes with the split-horizon matrix.", "Verify with a real frame after repairing."]}
        />
      </GuideSection>

      <GuideSection id="hl-spokefail" eyebrow="Failure" title="A real spoke failure" tone="warning">
        <p>When MTU1&apos;s spoke genuinely fails, CE1 ↔ CE2 keeps working locally; only traffic to remote sites is cut until the spoke returns. The spoke is a single point of failure for that access site, which is why real designs often add a redundant spoke.</p>
      </GuideSection>

      <GuideSection id="hl-challenge" eyebrow="Challenge" title="Scale the virtual LAN" tone="violet">
        <p>The closing checklist covers the core mesh, one spoke per MTU-s, correct port roles, role-aware split horizon, local switching, remote forwarding and the verified repair.</p>
      </GuideSection>

      <GuideSection id="hl-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "MTU-s", def: "Multi-tenant unit, switching-capable: the access-tier bridge." },
            { term: "PE-rs", def: "PE that is routing- and switching-capable: the core hub." },
            { term: "Spoke PW", def: "MTU-s ↔ PE-rs pseudowire; treated like an access port." },
            { term: "Mesh PW", def: "PE-rs ↔ PE-rs pseudowire; subject to mesh split horizon." },
            { term: "Local switching", def: "Forwarding between two ACs on the same MTU-s." },
            { term: "RFC 4762 §10", def: "The hierarchical VPLS model used here." },
          ]}
        />
      </GuideSection>

      <GuideSection id="hl-recap" eyebrow="Recap" title="Mental model" tone="mpls">
        <div className="rounded-2xl border border-pv-mpls/30 bg-gradient-to-br from-pv-mpls/10 to-pv-violet/5 p-5 text-sm leading-relaxed text-pv-text">
          H-VPLS is a switch hierarchy. MTU-s bridges are access switches with one uplink each; PE-rs hubs are a small, fully meshed core. Uplinks behave like access ports, so traffic can climb from a spoke into the core and descend from the core into a spoke. Only core-to-core relaying is forbidden, and that single rule keeps the mesh loop-free.
        </div>
      </GuideSection>
    </>
  );
}
