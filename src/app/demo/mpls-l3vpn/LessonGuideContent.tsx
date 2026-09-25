import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DLink, DNode, DPill, DRegion, DiagramFrame, DiagramSvg, FieldTable, FlowSteps, Glossary, GuideSection, Mono } from "@/components/lesson/GuideBlocks";
import { DStack } from "@/components/lesson/MplsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";

export const L3VPN_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "lv-mission", label: "The mission" },
  { id: "lv-topology", label: "Topology" },
  { id: "lv-vrf", label: "VRFs & overlapping prefixes" },
  { id: "lv-rdrt", label: "RD vs RT" },
  { id: "lv-route", label: "Anatomy of a VPNv4 route" },
  { id: "lv-control", label: "Control plane, step by step" },
  { id: "lv-stack", label: "The two-label stack" },
  { id: "lv-roles", label: "Who reads which label" },
  { id: "lv-planes", label: "Control vs data plane" },
  { id: "lv-builder", label: "Route builder method" },
  { id: "lv-fault", label: "The CUST-A fault" },
  { id: "lv-glossary", label: "Glossary" },
  { id: "lv-recap", label: "Mental model" },
];

const VPN = D.violet;

function TopologyDiagram() {
  const n: [string, number, string, string][] = [
    ["CE1", 50, "10.1.1.0/24", D.ip],
    ["PE1", 160, "1.1.1.1", D.mpls],
    ["P1", 268, "2.2.2.2", D.mpls],
    ["P2", 376, "3.3.3.3", D.mpls],
    ["PE2", 484, "4.4.4.4", D.mpls],
    ["CE2", 592, "10.2.2.0/24", D.ip],
  ];
  return (
    <DiagramSvg h={170} label="CE1 behind PE1 and CE2 behind PE2 in VRF CUST-A; P1 and P2 in the core hold no customer routes">
      <DRegion x={108} y={12} w={430} h={98} label="provider core · OSPF + LDP · no customer routes on P1/P2" color={D.mpls} />
      {n.slice(0, -1).map(([id, x], i) => (
        <DLink key={id} x1={x + 44} y1={66} x2={n[i + 1][1] - 44} y2={66} color={i === 0 || i === 4 ? D.line : D.mpls} />
      ))}
      {n.map(([id, x, sub, c]) => (
        <DNode key={id} x={x} y={66} label={id} sub={sub} accent={c} w={88} />
      ))}
      <DPill x={160} y={130} text="VRF CUST-A" color={VPN} />
      <DPill x={484} y={130} text="VRF CUST-A" color={VPN} />
      <DArrow x1={206} y1={154} x2={438} y2={154} color={D.bgp} both label="MP-BGP VPNv4 session (PE ↔ PE)" labelDy={-6} />
    </DiagramSvg>
  );
}

function VrfDiagram() {
  const table = (x: number, title: string, c: string, rows: string[]) => (
    <g>
      <rect x={x} y={34} width={180} height={112} rx={10} fill={c} fillOpacity={0.07} stroke={c} strokeOpacity={0.6} />
      <text x={x + 90} y={54} textAnchor="middle" fill={c} fontSize={11} fontWeight={700}>
        {title}
      </text>
      {rows.map((r, i) => (
        <text key={r} x={x + 14} y={78 + i * 18} fill={D.text} fontSize={10} fontFamily="monospace">
          {r}
        </text>
      ))}
    </g>
  );
  return (
    <DiagramSvg h={160} label="PE1 holds three separate tables: global, VRF CUST-A and VRF CUST-B; both VRFs contain 10.1.1.0/24">
      <text x={320} y={20} textAnchor="middle" fill={D.muted} fontSize={10.5} fontWeight={700}>
        inside PE1
      </text>
      {table(20, "Global table", D.ospf, ["1.1.1.1/32", "2.2.2.2/32", "3.3.3.3/32", "4.4.4.4/32"])}
      {table(230, "VRF CUST-A", VPN, ["10.1.1.0/24 (CE1)", "+ remote routes", "  once imported"])}
      {table(440, "VRF CUST-B", D.warning, ["10.1.1.0/24", "(same prefix,", " no conflict)"])}
    </DiagramSvg>
  );
}

function RouteAnatomyDiagram() {
  const cells: [string, string, number, string][] = [
    ["RD", "makes it unique", 110, D.bgp],
    ["IPv4 prefix", "the customer route", 110, D.ip],
    ["Route Target", "import/export policy", 120, VPN],
    ["Next hop", "the originating PE", 110, D.ospf],
    ["VPN label", "chosen by the originating PE", 130, D.mpls],
  ];
  let x = 20;
  return (
    <DiagramSvg h={120} label="A VPNv4 route carries RD, prefix, route target, next hop and VPN label">
      {cells.map(([name, note, w, c]) => {
        const g = (
          <g key={name}>
            <rect x={x} y={24} width={w - 6} height={40} rx={8} fill={c} fillOpacity={0.14} stroke={c} />
            <text x={x + (w - 6) / 2} y={49} textAnchor="middle" fill={c} fontSize={11} fontWeight={700}>
              {name}
            </text>
            <text x={x + (w - 6) / 2} y={84} textAnchor="middle" fill={D.muted} fontSize={9}>
              {note}
            </text>
          </g>
        );
        x += w;
        return g;
      })}
      <text x={320} y={110} textAnchor="middle" fill={D.muted} fontSize={10}>
        one MP-BGP VPNv4 UPDATE carries all five
      </text>
    </DiagramSvg>
  );
}

function StackEvolutionDiagram() {
  const t = (s: string, tag: string, c: string = D.mpls) => ({ text: s, tag, color: c });
  const cols: [number, string, { text: string; tag: string; color: string }[]][] = [
    [80, "PE1: PUSH VPN", [t("24002 S1", "VPN", VPN)]],
    [215, "PE1: PUSH transport", [t("102 S0", "OUTER"), t("24002 S1", "INNER", VPN)]],
    [350, "P1: SWAP outer", [t("203 S0", "OUTER"), t("24002 S1", "INNER", VPN)]],
    [485, "P2: PHP (outer only)", [t("24002 S1", "VPN", VPN)]],
    [600, "PE2 → CE2", []],
  ];
  return (
    <DiagramSvg h={170} label="VPN only 24002 S1; then 102 S0 over 24002 S1; then 203 S0 over 24002 S1; then 24002 S1; then plain IP">
      {cols.map(([x, title, labels]) => (
        <g key={title}>
          <text x={x} y={20} textAnchor="middle" fill={D.warning} fontSize={9.5} fontWeight={700}>
            {title}
          </text>
          <DStack x={x} y={34} labels={labels} w={78} />
        </g>
      ))}
      <text x={320} y={150} textAnchor="middle" fill={D.muted} fontSize={10}>
        OUTER = transport (swapped hop by hop) · INNER = VPN (untouched until PE2) · S=1 only at the bottom
      </text>
    </DiagramSvg>
  );
}

function PlanesDiagram() {
  return (
    <DiagramSvg h={190} label="MP-BGP carries the VPN route between PEs on top; the labeled packet crosses P1 and P2 below">
      <DNode x={100} y={40} label="PE1" sub="imports" accent={D.mpls} />
      <DNode x={540} y={40} label="PE2" sub="originates" accent={D.mpls} />
      <DArrow x1={488} y1={40} x2={152} y2={40} color={D.bgp} label="VPNv4 route + VPN label (control plane)" />
      <DNode x={100} y={140} label="PE1" accent={D.mpls} />
      <DNode x={250} y={140} label="P1" accent={D.mpls} w={80} />
      <DNode x={390} y={140} label="P2" accent={D.mpls} w={80} />
      <DNode x={540} y={140} label="PE2" accent={D.mpls} />
      <DArrow x1={152} y1={140} x2={208} y2={140} color={D.success} />
      <DArrow x1={292} y1={140} x2={348} y2={140} color={D.success} />
      <DArrow x1={432} y1={140} x2={488} y2={140} color={D.success} />
      <text x={320} y={182} textAnchor="middle" fill={D.success} fontSize={10} fontWeight={700}>
        customer packet with the two-label stack (data plane): P1/P2 never see the VPN route
      </text>
    </DiagramSvg>
  );
}

export function L3vpnLessonGuideContent() {
  return (
    <>
      <GuideSection id="lv-mission" eyebrow="Introduction" title="The mission: one private network over a shared core" tone="violet">
        <p>
          Customer A has Site 1 (<Mono>10.1.1.0/24</Mono> behind CE1) and Site 2 (<Mono>10.2.2.0/24</Mono> behind CE2). The provider also carries many other customers, some using the same addresses, and the core can&apos;t hold all their routes. This lesson builds an <b className="text-pv-text">MPLS L3VPN</b> for Customer A.
        </p>
        <Callout tone="cyan" title="Scope of this simulation" icon="i">
          OSPF, LDP and the PE1 → PE2 transport LSP already work (previous lesson). PE-CE routing is taken as given. The route built live is PE2&apos;s <Mono>10.2.2.0/24</Mono>. The optional Route Reflector toggle only changes how the MP-BGP route travels; the RR lesson covers that in depth.
        </Callout>
      </GuideSection>

      <GuideSection id="lv-topology" eyebrow="Setup" title="Topology" tone="cyan">
        <DiagramFrame caption="VRFs live only on the PEs. P1 and P2 are the same label switches as in the LDP lesson.">
          <TopologyDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="lv-vrf" eyebrow="Separation" title="VRFs and overlapping prefixes" tone="violet">
        <p>
          A <b className="text-pv-text">VRF</b> is a separate routing table on the PE. Customer routes never enter the global table the core uses. Customer B uses the exact same <Mono>10.1.1.0/24</Mono> in its own VRF on PE1, and that&apos;s legal.
        </p>
        <DiagramFrame caption="Identical prefixes in different VRFs don't conflict, because they live in different tables.">
          <VrfDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="lv-rdrt" eyebrow="Two attributes" title="RD vs RT: different jobs" tone="bgp">
        <CompareCards
          items={[
            { title: "Route Distinguisher (RD)", tone: "bgp", tag: "uniqueness", points: ["Prepended to the prefix to form a VPNv4 route", "Keeps identical customer prefixes distinct in MP-BGP", "Says nothing about who imports the route"] },
            { title: "Route Target (RT)", tone: "violet", tag: "policy", points: ["Extended community attached on export", "Compared with a VRF's import RT on receive", "A match is what installs the route in a VRF"] },
          ]}
        />
        <FieldTable
          title="VRF configuration in this lesson"
          accent="bgp"
          columns={["VRF", "PE", "RD", "Import / export RT"]}
          rows={[
            ["CUST-A", "PE1", <Mono key="1">65001:101</Mono>, <Mono key="2">65001:100</Mono>],
            ["CUST-A", "PE2", <Mono key="3">65001:102</Mono>, <Mono key="4">65001:100</Mono>],
            ["CUST-B", "PE1", <Mono key="5">65001:201</Mono>, <Mono key="6">65001:200</Mono>],
          ]}
        />
        <Callout tone="warning" title="The classic confusion" icon="!">
          Two PEs can use <i>different</i> RDs for the same VRF and still exchange routes, because import is decided by RT, not RD.
        </Callout>
      </GuideSection>

      <GuideSection id="lv-route" eyebrow="Control plane" title="Anatomy of a VPNv4 route" tone="bgp">
        <DiagramFrame caption="Five fields, three different jobs: uniqueness, policy, forwarding.">
          <RouteAnatomyDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="lv-control" eyebrow="Control plane" title="Building PE2's route, step by step" tone="bgp">
        <FlowSteps
          steps={[
            { title: "Learn", body: "CE2 advertises 10.2.2.0/24; PE2 installs it in VRF CUST-A.", tone: "cyan" },
            { title: "Add RD", body: "PE2 prepends its RD for the VRF: now a VPNv4 route.", tone: "bgp" },
            { title: "Attach RT", body: "PE2 adds its export RT as an extended community.", tone: "violet" },
            { title: "Allocate VPN label", body: "PE2 picks a service label that means 'VRF CUST-A' to PE2 itself. It isn't a transport label.", tone: "mpls" },
            { title: "Advertise", body: "One MP-BGP VPNv4 UPDATE to PE1 carries everything; next hop = PE2's loopback.", tone: "bgp" },
            { title: "Import check", body: "PE1 compares the route's RT with CUST-A's import RT and installs it only on a match.", tone: "success" },
          ]}
        />
      </GuideSection>

      <GuideSection id="lv-stack" eyebrow="Data plane" title="The two-label stack" tone="mpls">
        <p>
          PE1 looks up <Mono>10.2.2.20</Mono> in VRF CUST-A and finds the VPN label plus next hop <Mono>4.4.4.4</Mono>. Reaching <Mono>4.4.4.4</Mono> is the LDP transport LSP&apos;s job. So the packet needs two labels for two jobs.
        </p>
        <DiagramFrame caption="The VPN label is pushed first, so it is the bottom (S=1). The transport label goes on top with S=0.">
          <StackEvolutionDiagram />
        </DiagramFrame>
        <FieldTable
          title="Stack at each point"
          accent="mpls"
          columns={["Point", "Stack (top first)", "Meaning"]}
          rows={[
            ["After PUSH VPN", <Mono key="a">24002 S1</Mono>, "VPN only"],
            ["After PUSH transport", <Mono key="b">102 S0 / 24002 S1</Mono>, "Transport + VPN"],
            ["After P1 SWAP", <Mono key="c">203 S0 / 24002 S1</Mono>, "Only the outer label changed"],
            ["After P2 PHP", <Mono key="d">24002 S1</Mono>, "Outer popped, VPN label survives"],
          ]}
        />
      </GuideSection>

      <GuideSection id="lv-roles" eyebrow="Data plane" title="Who reads which label" tone="mpls">
        <FieldTable
          title="Each router acts only on what it needs"
          accent="mpls"
          columns={["Router", "Reads", "Ignores"]}
          rows={[
            ["PE1", "Customer IP (in VRF CUST-A)", "—"],
            ["P1", "OUTER transport label", "INNER VPN label, customer IP"],
            ["P2", "OUTER transport label (PHP)", "INNER VPN label, customer IP"],
            ["PE2", "INNER VPN label → VRF CUST-A", "—"],
          ]}
        />
        <Callout tone="success" title="Why the core scales" icon="✓">
          P routers hold no customer routes at all. The VPN label is physically in the packet as it crosses them, but they never use it.
        </Callout>
      </GuideSection>

      <GuideSection id="lv-planes" eyebrow="Big picture" title="Control plane vs data plane" tone="violet">
        <DiagramFrame caption="Routes travel PE to PE over MP-BGP; packets travel hop by hop on labels.">
          <PlanesDiagram />
        </DiagramFrame>
        <CompareCards
          items={[
            { title: "Control plane", tone: "violet", tag: "builds state", points: ["IGP: reach the remote PE loopback", "LDP: transport label to it", "MP-BGP: VPN route, RD, RT, next hop, VPN label", "VRF: keeps it per customer"] },
            { title: "Data plane", tone: "success", tag: "uses state", points: ["VRF lookup at PE1", "PUSH VPN, PUSH transport", "SWAP outer, PHP outer", "VPN label lookup at PE2"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="lv-builder" eyebrow="Practice" title="Route builder: how to pick each field" tone="violet">
        <ChecklistCard
          tone="violet"
          mark="?"
          title="Ask these questions (no spoilers)"
          items={[
            "RD: who originates the route, and which of that PE's VRFs is it in?",
            "RT: what does the receiving VRF import?",
            "Next hop: which address must the transport LSP reach for the packet to arrive at the right PE?",
            "VPN label: which router allocates it, and whose forwarding context does it identify?",
          ]}
        />
      </GuideSection>

      <GuideSection id="lv-fault" eyebrow="Troubleshooting" title="The CUST-A fault" tone="danger">
        <p>
          After the break, the complaint is: MP-BGP is Established, PE2&apos;s loopback is reachable, MPLS transport works, PE1 even receives the VPNv4 route, yet <Mono>10.2.2.0/24</Mono> isn&apos;t in CUST-A.
        </p>
        <ChecklistCard
          tone="danger"
          mark="→"
          title="How to reason about it"
          items={["Walk the layers bottom-up: IGP → LDP/transport → MP-BGP session → route received → import policy → VRF table.", "Stop at the first layer that fails; everything below it is healthy.", "\"Session up\" and \"route received\" aren't the same as \"route installed\"."]}
        />
      </GuideSection>

      <GuideSection id="lv-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "VRF", def: "Per-customer routing and forwarding table on a PE." },
            { term: "RD", def: "Route Distinguisher: 8 bytes prepended to make a VPNv4 route unique." },
            { term: "RT", def: "Route Target: extended community that drives VRF import/export." },
            { term: "VPNv4", def: "MP-BGP address family carrying RD + IPv4 prefix + VPN label." },
            { term: "VPN label", def: "Inner (bottom) label chosen by the egress PE to identify the VRF." },
            { term: "Transport label", def: "Outer label (LDP here) that gets the packet to the egress PE." },
            { term: "PHP", def: "The penultimate hop pops the outer label only." },
            { term: "S bit", def: "1 only on the bottom label: the VPN label here." },
          ]}
        />
      </GuideSection>

      <GuideSection id="lv-recap" eyebrow="Recap" title="Mental model" tone="violet">
        <div className="rounded-2xl border border-pv-violet/30 bg-gradient-to-br from-pv-violet/10 to-pv-mpls/5 p-5 text-sm leading-relaxed text-pv-text">
          The VRF keeps the customer separate. The RD makes its route unique. The RT decides who imports it. MP-BGP carries the route and the VPN label PE to PE. In the data plane the INNER VPN label says &quot;which customer at PE2&quot; and the OUTER transport label says &quot;get to PE2&quot;. The core only ever reads the outer one.
        </div>
      </GuideSection>
    </>
  );
}
