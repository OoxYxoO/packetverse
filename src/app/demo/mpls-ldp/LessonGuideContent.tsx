import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DLink, DNode, DPill, DRegion, DiagramFrame, DiagramSvg, FieldTable, FlowSteps, Glossary, GuideSection, Mono } from "@/components/lesson/GuideBlocks";
import { DStack } from "@/components/lesson/MplsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";

export const LDP_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "ll-mission", label: "The mission" },
  { id: "ll-topology", label: "Topology & roles" },
  { id: "ll-fec", label: "FEC 4.4.4.4/32" },
  { id: "ll-ldp", label: "LDP: discovery → session" },
  { id: "ll-labels", label: "Labels flow upstream" },
  { id: "ll-lfib", label: "LIB vs LFIB" },
  { id: "ll-walk", label: "One packet, three routers" },
  { id: "ll-shim", label: "The shim header" },
  { id: "ll-php", label: "implicit-null & PHP" },
  { id: "ll-planes", label: "Control vs data plane" },
  { id: "ll-fault", label: "The P1 ↔ P2 fault" },
  { id: "ll-glossary", label: "Glossary" },
  { id: "ll-recap", label: "Mental model" },
];

function TopologyDiagram() {
  const nodes: [string, number, string, string][] = [
    ["CE1", 50, "10.1.1.10", D.ip],
    ["PE1", 160, "1.1.1.1 · LER", D.mpls],
    ["P1", 268, "2.2.2.2 · LSR", D.mpls],
    ["P2", 376, "3.3.3.3 · LSR", D.mpls],
    ["PE2", 484, "4.4.4.4 · LER", D.mpls],
    ["CE2", 592, "10.2.2.20", D.ip],
  ];
  return (
    <DiagramSvg h={150} label="CE1, PE1, P1, P2, PE2, CE2 in a line; PE1 to PE2 is the MPLS domain">
      <DRegion x={108} y={14} w={430} h={96} label="MPLS domain (OSPF + LDP)" color={D.mpls} />
      {nodes.slice(0, -1).map(([id, x], i) => (
        <DLink key={id} x1={x + 40} y1={66} x2={nodes[i + 1][1] - 40} y2={66} color={i === 0 || i === 4 ? D.line : D.mpls} />
      ))}
      {nodes.map(([id, x, sub, c]) => (
        <DNode key={id} x={x} y={66} label={id} sub={sub} accent={c} w={80} />
      ))}
      <text x={320} y={136} textAnchor="middle" fill={D.muted} fontSize={10}>
        CEs never see a label · PEs push the first and remove the last · Ps only switch labels
      </text>
    </DiagramSvg>
  );
}

function LdpSequenceDiagram() {
  return (
    <DiagramSvg h={230} label="PE1 and P1 exchange Hellos over UDP, then P1 opens a TCP 646 session, then label mappings flow">
      <DNode x={110} y={30} label="PE1" sub="1.1.1.1:0" accent={D.mpls} />
      <DNode x={530} y={30} label="P1" sub="2.2.2.2:0" accent={D.mpls} />
      <line x1={110} y1={54} x2={110} y2={220} stroke={D.line} strokeDasharray="3 4" />
      <line x1={530} y1={54} x2={530} y2={220} stroke={D.line} strokeDasharray="3 4" />
      <DArrow x1={114} y1={80} x2={526} y2={80} color={D.mpls} both dashed label="1 · Hello (UDP 646, multicast) — discovery" />
      <DArrow x1={526} y1={122} x2={114} y2={122} color={D.violet} label="2 · TCP 646 connection (P1 opens it)" />
      <DArrow x1={114} y1={160} x2={526} y2={160} color={D.violet} both label="3 · Initialization + KeepAlive → OPERATIONAL" />
      <DArrow x1={526} y1={202} x2={114} y2={202} color={D.success} label="4 · Label Mapping: FEC 4.4.4.4/32 = 102" />
    </DiagramSvg>
  );
}

function DistributionDiagram() {
  const r: [string, number][] = [
    ["PE1", 110],
    ["P1", 250],
    ["P2", 390],
    ["PE2", 530],
  ];
  return (
    <DiagramSvg h={200} label="Label mappings travel upstream from PE2 to PE1 while traffic travels downstream">
      {r.slice(0, -1).map(([id, x], i) => (
        <DLink key={id} x1={x + 50} y1={50} x2={r[i + 1][1] - 50} y2={50} color={D.mpls} />
      ))}
      {r.map(([id, x]) => (
        <DNode key={id} x={x} y={50} label={id} accent={D.mpls} />
      ))}
      <DArrow x1={486} y1={104} x2={434} y2={104} color={D.violet} label="implicit-null" />
      <DArrow x1={346} y1={104} x2={294} y2={104} color={D.violet} label="203" />
      <DArrow x1={206} y1={104} x2={154} y2={104} color={D.violet} label="102" />
      <text x={320} y={132} textAnchor="middle" fill={D.violet} fontSize={10} fontWeight={700}>
        control plane: Label Mappings travel upstream (toward the ingress)
      </text>
      <DArrow x1={110} y1={168} x2={530} y2={168} color={D.success} label="data plane: traffic toward 4.4.4.4/32 travels downstream" labelDy={-8} />
    </DiagramSvg>
  );
}

function WalkDiagram() {
  const n: [string, number][] = [
    ["CE1", 40],
    ["PE1", 155],
    ["P1", 270],
    ["P2", 385],
    ["PE2", 500],
    ["CE2", 600],
  ];
  const ops: [number, string][] = [
    [155, "PUSH 102"],
    [270, "SWAP 102 → 203"],
    [385, "POP (PHP)"],
    [500, "IP lookup"],
  ];
  const mid = (i: number) => (n[i][1] + n[i + 1][1]) / 2;
  return (
    <DiagramSvg h={150} label="The packet is plain IP, then carries 102, then 203, then is plain IP again after P2">
      {n.slice(0, -1).map(([id, x], i) => (
        <DLink key={id} x1={x + 34} y1={28} x2={n[i + 1][1] - 34} y2={28} color={D.line} />
      ))}
      {n.map(([id, x]) => (
        <DNode key={id} x={x} y={28} label={id} w={68} h={36} accent={id.startsWith("CE") ? D.ip : D.mpls} />
      ))}
      {ops.map(([x, t]) => (
        <text key={t} x={x} y={62} textAnchor="middle" fill={D.warning} fontSize={9.5} fontWeight={700}>
          {t}
        </text>
      ))}
      <DStack x={mid(0)} y={78} labels={[]} w={70} />
      <DStack x={mid(1)} y={78} labels={[{ text: "102 S1" }]} w={70} />
      <DStack x={mid(2)} y={78} labels={[{ text: "203 S1" }]} w={70} />
      <DStack x={mid(3)} y={78} labels={[]} w={70} />
      <DStack x={mid(4)} y={78} labels={[]} w={70} />
    </DiagramSvg>
  );
}

function PhpDiagram() {
  return (
    <DiagramSvg h={170} label="Without PHP the egress PE does two lookups; with PHP it receives plain IP and does one">
      <text x={20} y={30} fill={D.danger} fontSize={10.5} fontWeight={700}>
        Without PHP
      </text>
      <DNode x={170} y={55} label="P2" accent={D.mpls} w={80} />
      <DArrow x1={212} y1={55} x2={350} y2={55} color={D.danger} />
      <DPill x={281} y={36} text="label + IP" color={D.danger} />
      <DNode x={392} y={55} label="PE2" accent={D.mpls} w={80} />
      <text x={440} y={59} fill={D.text} fontSize={10}>
        LFIB lookup, then IP lookup
      </text>
      <text x={20} y={112} fill={D.success} fontSize={10.5} fontWeight={700}>
        With PHP
      </text>
      <DNode x={170} y={137} label="P2" sub="POP" accent={D.mpls} w={80} />
      <DArrow x1={212} y1={137} x2={350} y2={137} color={D.success} />
      <DPill x={281} y={118} text="IP only" color={D.success} />
      <DNode x={392} y={137} label="PE2" sub="imp-null" accent={D.mpls} w={80} />
      <text x={440} y={141} fill={D.text} fontSize={10}>
        one IP lookup
      </text>
    </DiagramSvg>
  );
}

export function LdpLessonGuideContent() {
  return (
    <>
      <GuideSection id="ll-mission" eyebrow="Introduction" title="The mission: label-switch one packet across the core" tone="mpls">
        <p>
          CE1 (<Mono>10.1.1.10</Mono>) sends to CE2 (<Mono>10.2.2.20</Mono>) across a provider core. Without MPLS, every router does a full IP lookup on every hop. In this lesson you bring up <b className="text-pv-text">LDP</b>, watch it distribute labels for one FEC, then follow one packet through <b className="text-pv-text">PUSH → SWAP → POP</b>.
        </p>
        <Callout tone="cyan" title="Scope of this simulation" icon="i">
          Transport labels only: one FEC (<Mono>4.4.4.4/32</Mono>), one LSP, no VPNs and no traffic engineering. OSPF is already converged and is not re-taught here. TC/QoS behavior is left for later.
        </Callout>
        <Callout tone="warning" title="MPLS isn't about speed" icon="!">
          Label lookups aren&apos;t inherently faster than IP lookups on modern hardware. MPLS is valuable because it classifies once at the edge and then lets the core forward, engineer and layer services on labels.
        </Callout>
      </GuideSection>

      <GuideSection id="ll-topology" eyebrow="Setup" title="Topology and roles" tone="cyan">
        <DiagramFrame caption="PE1 and PE2 are the Label Edge Routers; P1 and P2 are Label Switching Routers.">
          <TopologyDiagram />
        </DiagramFrame>
        <FieldTable
          title="Who does what"
          accent="mpls"
          columns={["Router", "Role", "Loopback"]}
          rows={[
            ["CE1 / CE2", "Customer Edge: outside MPLS, plain IP only", "—"],
            ["PE1", "Ingress LER: pushes the first label", <Mono key="a">1.1.1.1</Mono>],
            ["P1, P2", "LSRs: switch labels, never read the customer IP header", <Mono key="b">2.2.2.2 · 3.3.3.3</Mono>],
            ["PE2", "Egress LER: owns the FEC", <Mono key="c">4.4.4.4</Mono>],
          ]}
        />
      </GuideSection>

      <GuideSection id="ll-fec" eyebrow="Concept" title="The FEC: what a label stands for" tone="mpls">
        <p>
          A label isn&apos;t tied to a customer, a flow or a session. It stands for a <b className="text-pv-text">Forwarding Equivalence Class</b>: a set of packets forwarded the same way. Here the FEC is &quot;reach PE2&apos;s loopback <Mono>4.4.4.4/32</Mono>&quot;, a prefix OSPF already reaches.
        </p>
        <Callout tone="mpls" title="Labels are locally significant" icon="#">
          A label value only means something between two neighbors. P1&apos;s <Mono>102</Mono> and P2&apos;s <Mono>203</Mono> both mean &quot;toward 4.4.4.4/32&quot;, each on its own link.
        </Callout>
      </GuideSection>

      <GuideSection id="ll-ldp" eyebrow="Control plane" title="LDP: discovery first, then a session" tone="mpls">
        <DiagramFrame caption="Hellos only find neighbors. Label information needs the TCP session.">
          <LdpSequenceDiagram />
        </DiagramFrame>
        <FlowSteps
          steps={[
            { title: "DOWN → HELLO", body: "Routers multicast LDP Hellos on UDP 646 to find LDP speakers on directly connected links.", tone: "mpls" },
            { title: "HELLO → SESSION", body: "One side opens a TCP 646 connection; Initialization and KeepAlive messages negotiate the session.", tone: "violet" },
            { title: "SESSION → OPERATIONAL", body: "The session is up and can carry Label Mapping messages.", tone: "success" },
          ]}
        />
        <p>PE1↔P1 is shown in detail; P1↔P2 and P2↔PE2 run the identical sequence independently.</p>
      </GuideSection>

      <GuideSection id="ll-labels" eyebrow="Control plane" title="Labels flow upstream, traffic flows downstream" tone="violet">
        <DiagramFrame caption="Each router picks its own local label and tells its upstream neighbor.">
          <DistributionDiagram />
        </DiagramFrame>
        <FlowSteps
          steps={[
            { title: "PE2 owns the FEC", body: <>It&apos;s the last hop, so it advertises <Mono>implicit-null</Mono> to P2: &quot;pop before sending to me.&quot;</>, tone: "violet" },
            { title: "P2 allocates 203", body: "…advertises it to P1, and learns its own action toward PE2.", tone: "violet" },
            { title: "P1 allocates 102", body: "…advertises it to PE1, and learns its own action: 102 in, 203 out.", tone: "violet" },
            { title: "PE1 builds its LFIB", body: "IGP reachability plus P1's label gives: unlabeled in → PUSH 102 → P1.", tone: "success" },
          ]}
        />
      </GuideSection>

      <GuideSection id="ll-lfib" eyebrow="Tables" title="LIB vs LFIB" tone="violet">
        <CompareCards
          items={[
            { title: "LIB", tone: "violet", tag: "control plane", points: ["Every binding heard from every LDP neighbor", "Kept even if not currently used", "Bookkeeping, not forwarding"] },
            { title: "LFIB", tone: "success", tag: "data plane", points: ["Only bindings from the IGP next hop", "Used to switch real packets", "In label → action → out label"] },
          ]}
        />
        <FieldTable
          title="The LFIB this lesson builds for 4.4.4.4/32"
          accent="mpls"
          columns={["Router", "In", "Action", "Out", "Next hop"]}
          rows={[
            ["PE1", "unlabeled", "PUSH", <Mono key="1">102</Mono>, "P1"],
            ["P1", <Mono key="2">102</Mono>, "SWAP", <Mono key="3">203</Mono>, "P2"],
            ["P2", <Mono key="4">203</Mono>, "POP", "— (imp-null)", "PE2"],
          ]}
        />
      </GuideSection>

      <GuideSection id="ll-walk" eyebrow="Data plane" title="One packet, three label operations" tone="success">
        <DiagramFrame caption="The stack under each link is what's on the wire there. Only one label, so it is always the bottom one (S=1).">
          <WalkDiagram />
        </DiagramFrame>
        <p>
          P1 decides using only the incoming label and its LFIB. It never reads the customer&apos;s IP destination. That same property is what later lets P routers carry VPN traffic without any customer routes.
        </p>
      </GuideSection>

      <GuideSection id="ll-shim" eyebrow="On the wire" title="The 32-bit shim header" tone="mpls">
        <FieldTable
          title="MPLS shim (open it in the Packet Inspector)"
          accent="mpls"
          columns={["Field", "Bits", "Meaning"]}
          rows={[
            ["Label", "20", "The forwarding value the next router looks up"],
            ["TC", "3", "Traffic Class (QoS marking); not used in this lesson"],
            ["S", "1", "Bottom of Stack: 1 on the last label before the payload"],
            ["TTL", "8", "Loop protection, like the IP TTL"],
          ]}
        />
      </GuideSection>

      <GuideSection id="ll-php" eyebrow="Egress" title="implicit-null and penultimate hop popping" tone="mpls">
        <p>
          <Mono>implicit-null</Mono> (value 3) is a <b className="text-pv-text">signaling value</b>. It&apos;s never written into a packet. When PE2 advertises it, the router one hop before (the penultimate hop, P2) removes the label, so PE2 receives plain IP.
        </p>
        <DiagramFrame caption="PHP moves the last label removal one hop earlier so the egress PE does only one lookup.">
          <PhpDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="ll-planes" eyebrow="Big picture" title="Control plane vs data plane" tone="violet">
        <CompareCards
          items={[
            { title: "Control plane", tone: "violet", tag: "builds state", points: ["OSPF: how to reach 4.4.4.4/32", "LDP: which label means that FEC on each link", "Never touches a customer packet"] },
            { title: "Data plane", tone: "success", tag: "uses state", points: ["PUSH at PE1, SWAP at P1, POP at P2", "Uses only the LFIB", "Never runs OSPF or LDP per packet"] },
          ]}
        />
        <Callout tone="warning" title="LDP depends on the IGP" icon="!">
          LDP only labels FECs the IGP says are reachable. Keep that dependency in mind for the prediction about a disappearing OSPF route.
        </Callout>
      </GuideSection>

      <GuideSection id="ll-fault" eyebrow="Troubleshooting" title="The P1 ↔ P2 fault" tone="danger">
        <p>
          After the break, the complaint is: &quot;PE1 can reach PE2&apos;s loopback by IP, but the LSP is broken.&quot; OSPF looks healthy.
        </p>
        <ChecklistCard
          tone="danger"
          mark="→"
          title="How to reason about it (no spoilers)"
          items={[
            "Confirm IP reachability to 4.4.4.4/32 through the core.",
            "Compare the IGP adjacency with the LDP adjacency on each link.",
            "Look for the router whose LIB or LFIB is missing an entry for the FEC.",
            "Pick the repair that fixes that layer, not a bigger hammer (reboots, unrelated knobs).",
          ]}
        />
      </GuideSection>

      <GuideSection id="ll-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "LER / PE", def: "Label Edge Router: pushes the first label (ingress) or handles the last hop (egress)." },
            { term: "LSR / P", def: "Label Switching Router: swaps labels in the core." },
            { term: "FEC", def: "Forwarding Equivalence Class: packets forwarded identically; here 4.4.4.4/32." },
            { term: "LSP", def: "Label Switched Path: PE1 → P1 → P2 → PE2 for this FEC." },
            { term: "LDP", def: "Label Distribution Protocol: discovers neighbors (UDP 646) and exchanges label mappings (TCP 646)." },
            { term: "LIB", def: "Every label binding heard from every neighbor." },
            { term: "LFIB", def: "The bindings actually used to forward: in label → action → out label." },
            { term: "implicit-null", def: "Signaling value 3: pop before sending to me. Never on the wire." },
            { term: "PHP", def: "Penultimate Hop Popping: the hop before the egress removes the label." },
            { term: "S bit", def: "Bottom of Stack: 1 only on the last label before the payload." },
          ]}
        />
      </GuideSection>

      <GuideSection id="ll-recap" eyebrow="Recap" title="Mental model" tone="mpls">
        <div className="rounded-2xl border border-pv-mpls/30 bg-gradient-to-br from-pv-mpls/10 to-pv-violet/5 p-5 text-sm leading-relaxed text-pv-text">
          OSPF says where 4.4.4.4/32 is. LDP gives that FEC a label on every link, flowing upstream from PE2. The LFIB turns that into PUSH 102 at PE1, SWAP 102 → 203 at P1 and POP at P2, so PE2 receives plain IP. If a single LDP session is down, IP still works but the LSP is broken at that link.
        </div>
      </GuideSection>
    </>
  );
}
