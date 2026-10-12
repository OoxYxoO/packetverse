import { Callout, CompareCards, DArrow, DIAGRAM as D, DLink, DNode, DPill, DRegion, DiagramFrame, DiagramSvg, FailureSignatures, FieldTable, FlowSteps, GuideSection, Misconceptions, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { DStack } from "@/components/lesson/MplsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { ExplainIt, KnowledgeQuiz, PracticeBridge, type KnowledgeQuestion } from "@/components/lesson/GuideInteractive";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import { PresentationBridge } from "@/components/presentation/LessonPresentation";
import { CliPair, CliPanel, FailureWalk } from "@/components/lesson/GuideCli";
import { l3Apply, l3Ticket, l3TicketState, type L3Os, type L3TicketId } from "@/lib/sim-engine/scenarios/l3Net";
import { L3_HEALTHY, L3_HEALTHY_JN, PingResult, l3Cli, l3Only } from "./LessonGuideContent";

const G = { foundation: "Foundation", vrf: "VRFs and PE-CE", bgp: "MP-BGP", labels: "Labels and forwarding", design: "Design and scale", ops: "Operations", trouble: "Troubleshooting", beyond: "Beyond this lesson", master: "Master it" };
export const L3VPN_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "vd-why", label: "Why L3VPN", group: G.foundation },
  { id: "vd-arch", label: "The architecture", group: G.foundation },
  { id: "vd-network", label: "The network you will study", group: G.foundation },
  { id: "vd-vrf", label: "VRFs and interfaces", group: G.vrf },
  { id: "vd-pece", label: "PE-CE routing", group: G.vrf },
  { id: "vd-nlri", label: "VPNv4 NLRI encoding", group: G.bgp },
  { id: "vd-rd", label: "RD formats and design", group: G.bgp },
  { id: "vd-rt", label: "Route-target topologies", group: G.bgp },
  { id: "vd-extranet", label: "Extranets and shared services", group: G.bgp },
  { id: "vd-label", label: "VPN label allocation", group: G.labels },
  { id: "vd-nh", label: "Next-hop resolution", group: G.labels },
  { id: "vd-mtu", label: "MTU and the stack", group: G.labels },
  { id: "vd-scale", label: "RT filtering, RRs, RTC", group: G.design },
  { id: "vd-config", label: "Configuring it: IOS XR and Junos", group: G.ops },
  { id: "vd-verify", label: "How to verify", group: G.ops },
  { id: "vd-signatures", label: "Failure signatures", group: G.trouble },
  { id: "vd-workflow", label: "Investigation workflow", group: G.trouble },
  { id: "vd-tickets", label: "Five faults, evidence to proof", group: G.trouble },
  { id: "vd-interas", label: "Inter-AS options", group: G.beyond },
  { id: "vd-myths", label: "Common misconceptions", group: G.master },
  { id: "vd-quiz", label: "Knowledge check", group: G.master },
  { id: "vd-explain", label: "Can you explain it?", group: G.master },
  { id: "vd-practice", label: "Practice in the L3VPN Lab", group: G.master },
];

// Real CLI output and ping results: the L3VPN Lab's own command sets and model.
const ticket = (id: L3TicketId, os: L3Os = "xr") => l3Ticket(id).repro.reduce((acc, a) => l3Apply(acc, a), l3TicketState(id, 1, os));
const T = { rt: ticket("rt"), vpnv4: ticket("vpnv4"), static: ticket("static"), transport: ticket("transport"), transportJn: ticket("transport", "junos"), ifvrf: ticket("ifvrf") };

function LabBridge() {
  const openLab = usePracticeLabOpener();
  return (
    <PracticeBridge label="Open the L3VPN Lab" onPractice={openLab}>
      The network from this page, IOS XR or Junos, your own copy. Nothing you do there changes your lesson progress.
    </PracticeBridge>
  );
}

/** The lab's network: two customers with the same addresses, and a shared service. */
function LabNet() {
  const n: Record<string, [number, number, string, string]> = {
    CE1A: [55, 50, "10.1.1.0/24", D.violet],
    CE1B: [55, 170, "10.1.1.0/24", D.warning],
    PE1: [175, 110, "1.1.1.1", D.mpls],
    P1: [285, 110, "2.2.2.2", D.mpls],
    P2: [395, 110, "3.3.3.3", D.mpls],
    PE2: [495, 110, "4.4.4.4", D.mpls],
    CE2A: [585, 35, "10.2.2.0/24", D.violet],
    CE2S: [585, 110, "10.9.9.0/24", D.success],
    CE2B: [585, 185, "10.2.2.0/24", D.warning],
  };
  const l: [string, string][] = [["CE1A", "PE1"], ["CE1B", "PE1"], ["PE1", "P1"], ["P1", "P2"], ["P2", "PE2"], ["PE2", "CE2A"], ["PE2", "CE2S"], ["PE2", "CE2B"]];
  return (
    <DiagramSvg h={240} label="CE1A and CE1B at PE1, CE2A, CE2B and CE2S at PE2; core PE1-P1-P2-PE2; CUST-A and CUST-B use identical prefixes">
      <DRegion x={128} y={66} w={414} h={84} label="IS-IS + LDP · no BGP on P1/P2" color={D.mpls} />
      {l.map(([a, b]) => (
        <DLink key={a + b} x1={n[a][0]} y1={n[a][1]} x2={n[b][0]} y2={n[b][1]} color={a.startsWith("P") && b.startsWith("P") ? D.mpls : D.line} />
      ))}
      {Object.entries(n).map(([id, [x, y, sub, c]]) => (
        <DNode key={id} x={x} y={y} label={id} sub={sub} accent={c} w={id.startsWith("CE") ? 88 : 72} />
      ))}
      <text x={320} y={232} textAnchor="middle" fill={D.muted} fontSize={10}>
        violet CUST-A (RT 65001:100) · amber CUST-B (RT 65001:200) · green SHARED (RT 65001:900)
      </text>
    </DiagramSvg>
  );
}

const QUIZ: KnowledgeQuestion[] = [
  {
    id: "q-rdrt",
    prompt: "PE1's CUST-A uses RD 65001:101 and PE2's CUST-A uses 65001:102. Can the two sites exchange routes?",
    options: [
      { id: "a", label: "Yes — import is decided by route targets; RDs only keep routes unique" },
      { id: "b", label: "No — both PEs must use the same RD" },
      { id: "c", label: "Only with a route reflector" },
    ],
    correctId: "a",
    explanation: "Different RDs per PE are common. As long as the export RT of one VRF is in the import list of the other, routes flow.",
  },
  {
    id: "q-label",
    prompt: "Which router chooses the VPN label 24002 that PE1 pushes toward CUST-A's site 2?",
    options: [
      { id: "a", label: "PE2, the egress PE — it identifies VRF CUST-A there" },
      { id: "b", label: "PE1" },
      { id: "c", label: "P2, the penultimate hop" },
    ],
    correctId: "a",
    explanation: "The VPN label is allocated by the PE that advertises the route and only means something to it.",
  },
  {
    id: "q-core",
    prompt: "Why don't P1 and P2 need BGP?",
    options: [
      { id: "a", label: "They forward on the transport label to the PE's loopback and never look at customer addresses" },
      { id: "b", label: "They learn customer routes through IS-IS" },
      { id: "c", label: "They use the VPN label" },
    ],
    correctId: "a",
    explanation: "The BGP-free core only needs IGP routes and labels for the PE loopbacks.",
  },
  {
    id: "q-vpnv4",
    prompt: "The PE1–PE2 session is Established, but no VPN routes cross. What do you check first?",
    options: [
      { id: "a", label: "Whether both sides negotiated the VPNv4 family" },
      { id: "b", label: "The RDs" },
      { id: "c", label: "The MTU" },
    ],
    correctId: "a",
    explanation: "Families are negotiated per session at OPEN. If one side doesn't offer VPNv4, the session carries none.",
  },
  {
    id: "q-filter",
    prompt: "PE2 advertises CUST-A's route with RT 65001:100, but PE1 shows no trace of it in BGP. What is the most likely reason?",
    options: [
      { id: "a", label: "No VRF on PE1 imports 65001:100, so RT filtering discarded it" },
      { id: "b", label: "The transport LSP is down" },
      { id: "c", label: "P1 filtered it" },
    ],
    correctId: "a",
    explanation: "A PE keeps only VPN routes some local VRF imports. Check the import route targets.",
  },
  {
    id: "q-transport",
    prompt: "IOS XR: every VRF has its routes, BGP is up, but packets die in the core. P1 shows 'Unlabelled' for 4.4.4.4. What does P2 receive?",
    options: [
      { id: "a", label: "PE2's VPN label, which P2 never allocated — it drops the packet" },
      { id: "b", label: "A plain IP packet it routes to PE2" },
      { id: "c", label: "The transport label, as usual" },
    ],
    correctId: "a",
    explanation: "Without a label from P2, P1 removes the transport label. The VPN label underneath means nothing to P2.",
  },
  {
    id: "q-junos",
    prompt: "Same fault on Junos. Where does it show up first?",
    options: [
      { id: "a", label: "On PE1: the VPN routes are hidden because inet.3 has no LSP to 4.4.4.4" },
      { id: "b", label: "On P2: it drops labeled packets" },
      { id: "c", label: "Nowhere — Junos forwards it as IP" },
    ],
    correctId: "a",
    explanation: "Junos resolves BGP next hops of VPN routes in inet.3. No LSP, no usable route.",
  },
  {
    id: "q-extranet",
    prompt: "CUST-A's VRFs import the SHARED route target, but pings to the service still fail. What is missing?",
    options: [
      { id: "a", label: "VRF SHARED must import CUST-A's route target, so the replies have a way back" },
      { id: "b", label: "A new RD" },
      { id: "c", label: "A third label" },
    ],
    correctId: "a",
    explanation: "Route targets are directional. Shared services need imports in both directions.",
  },
];
const VPN = D.violet;

function ArchDiagram() {
  return (
    <DiagramSvg h={210} label="CE routers peer with PEs using PE-CE routing; PEs exchange VPNv4 routes over MP-BGP; P routers run only the IGP and LDP">
      <DNode x={60} y={150} label="CE" sub="site 1" accent={D.ip} w={80} />
      <DNode x={200} y={150} label="PE" sub="VRFs" accent={D.mpls} w={80} />
      <DNode x={320} y={150} label="P" sub="IGP + LDP" accent={D.mpls} w={80} />
      <DNode x={440} y={150} label="PE" sub="VRFs" accent={D.mpls} w={80} />
      <DNode x={580} y={150} label="CE" sub="site 2" accent={D.ip} w={80} />
      <DLink x1={100} y1={150} x2={160} y2={150} color={D.ip} label="PE-CE" labelDy={-10} />
      <DLink x1={240} y1={150} x2={280} y2={150} color={D.mpls} />
      <DLink x1={360} y1={150} x2={400} y2={150} color={D.mpls} />
      <DLink x1={480} y1={150} x2={540} y2={150} color={D.ip} label="PE-CE" labelDy={-10} />
      <DArrow x1={200} y1={60} x2={440} y2={60} color={D.bgp} both label="MP-BGP VPNv4 (often via route reflectors)" />
      <line x1={200} y1={66} x2={200} y2={126} stroke={D.bgp} strokeDasharray="3 4" />
      <line x1={440} y1={66} x2={440} y2={126} stroke={D.bgp} strokeDasharray="3 4" />
      <text x={320} y={200} textAnchor="middle" fill={D.muted} fontSize={10}>
        customer routes exist only on CEs and in PE VRFs, never on P routers
      </text>
    </DiagramSvg>
  );
}

function NlriDiagram() {
  const cells: [string, number, string][] = [
    ["Length", 50, D.faint],
    ["Label (3 B)", 110, D.mpls],
    ["RD (8 B)", 190, D.bgp],
    ["IPv4 prefix (≤4 B)", 180, D.ip],
  ];
  let x = 50;
  return (
    <DiagramSvg h={110} label="VPNv4 NLRI: length, 3-byte label field, 8-byte route distinguisher, IPv4 prefix">
      {cells.map(([name, w, c]) => {
        const g = (
          <g key={name}>
            <rect x={x} y={30} width={w} height={36} fill={c} fillOpacity={0.15} stroke={c} />
            <text x={x + w / 2} y={53} textAnchor="middle" fill={c} fontSize={11} fontWeight={700}>
              {name}
            </text>
          </g>
        );
        x += w;
        return g;
      })}
      <text x={320} y={94} textAnchor="middle" fill={D.muted} fontSize={10}>
        AFI 1 / SAFI 128 · RD + prefix form the 12-byte VPN-IPv4 address · RTs ride as extended communities
      </text>
    </DiagramSvg>
  );
}

function HubSpokeDiagram() {
  return (
    <DiagramSvg h={210} label="Hub exports RT hub and imports RT spoke; spokes export RT spoke and import RT hub, so spokes only learn the hub's routes">
      <DNode x={320} y={50} label="Hub PE" sub="exp HUB · imp SPOKE" accent={VPN} w={170} />
      <DNode x={140} y={165} label="Spoke A" sub="exp SPOKE · imp HUB" accent={D.warning} w={170} />
      <DNode x={500} y={165} label="Spoke B" sub="exp SPOKE · imp HUB" accent={D.warning} w={170} />
      <DArrow x1={260} y1={74} x2={170} y2={140} color={VPN} both />
      <DArrow x1={380} y1={74} x2={470} y2={140} color={VPN} both />
      <DLink x1={228} y1={165} x2={412} y2={165} color={D.danger} dashed label="no direct import" labelDy={-8} />
    </DiagramSvg>
  );
}

function AllocationDiagram() {
  return (
    <DiagramSvg h={170} label="Per-prefix gives each route its own label; per-CE one label per attached CE; per-VRF one label for the whole VRF">
      {[
        [110, "per-prefix", ["10.2.2.0/24 → 24002", "10.2.3.0/24 → 24003", "10.2.4.0/24 → 24004"], D.mpls],
        [320, "per-CE", ["CE2 routes → 24002", "CE3 routes → 24010", ""], D.warning],
        [530, "per-VRF", ["all CUST-A → 24002", "(egress IP lookup", " in the VRF)"], VPN],
      ].map(([x, title, rows, c]) => (
        <g key={title as string}>
          <DPill x={x as number} y={24} text={title as string} color={c as string} w={120} />
          <rect x={(x as number) - 95} y={46} width={190} height={84} rx={10} fill={c as string} fillOpacity={0.06} stroke={c as string} strokeOpacity={0.5} />
          {(rows as string[]).map((r, i) => (
            <text key={i} x={(x as number) - 82} y={72 + i * 20} fill={D.text} fontSize={9.5} fontFamily="monospace">
              {r}
            </text>
          ))}
        </g>
      ))}
      <text x={320} y={158} textAnchor="middle" fill={D.muted} fontSize={10}>
        hypothetical labels · fewer labels means more work (a lookup) at the egress PE
      </text>
    </DiagramSvg>
  );
}

function NextHopDiagram() {
  return (
    <DiagramSvg h={170} label="The VPN route's next hop 4.4.4.4 must resolve to an LSP; the transport label comes from that LSP">
      <DPill x={150} y={30} text="VRF route 10.2.2.0/24" color={VPN} w={180} />
      <DArrow x1={240} y1={30} x2={330} y2={30} color={D.faint} />
      <DPill x={420} y={30} text="NH 4.4.4.4 · VPN label" color={D.bgp} w={180} />
      <DArrow x1={420} y1={44} x2={420} y2={82} color={D.faint} />
      <DPill x={420} y={96} text="LSP to 4.4.4.4 · transport label" color={D.mpls} w={230} />
      <DStack x={150} y={78} labels={[{ text: "transport S0", tag: "OUTER" }, { text: "VPN S1", tag: "INNER", color: VPN }]} w={100} />
      <text x={320} y={158} textAnchor="middle" fill={D.danger} fontSize={10} fontWeight={700}>
        no labeled path to the next hop ⇒ the VPN route can&apos;t be used (or traffic is blackholed)
      </text>
    </DiagramSvg>
  );
}

export function L3vpnDeepDiveContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="vd-why" eyebrow="Foundation" title="Why L3VPN" tone="violet">
        <p>
          Enterprises want their sites connected as one private routed network, without building their own WAN. A provider could give each customer dedicated circuits — expensive — or carry customer routes in its own routing tables — impossible, because customers reuse the same private addresses and number in the hundreds of thousands of routes. BGP/MPLS IP VPNs (RFC 4364) solve both: customer routes live in per-customer tables at the edge, travel between edges in BGP, and the packets cross a shared label-switched core that never sees them.
        </p>
        <PingResult s={l3Apply(L3_HEALTHY, { type: "test", from: "CE1B", dst: "10.2.2.20" })} title="The lab: CE1B pings 10.2.2.20 — the same address CUST-A uses — and reaches its own site" />
      </GuideSection>

      <GuideSection id="vd-arch" eyebrow="Foundation" title="The architecture" tone="violet">
        <DiagramFrame caption="The PE is where customer state lives; the core stays customer-agnostic.">
          <ArchDiagram />
        </DiagramFrame>
        <FieldTable
          title="Three roles"
          accent="mpls"
          columns={["Role", "Knows", "Runs"]}
          rows={[
            ["CE — customer edge", "its own site's routes", "plain IP routing toward the PE (static, eBGP, OSPF…)"],
            ["PE — provider edge", "one VRF per attached customer, plus the core", "VRFs, MP-BGP VPNv4, IGP, LDP"],
            ["P — provider core", "only PE and P loopbacks and their labels", "IGP and LDP (or RSVP-TE / Segment Routing)"],
          ]}
        />
      </GuideSection>

      <GuideSection id="vd-network" eyebrow="Foundation" title="The network you will study" tone="cyan">
        <DiagramFrame caption="The L3VPN Lab. Every output on this page comes from it.">
          <LabNet />
        </DiagramFrame>
        <FieldTable
          title="VRFs in the lab"
          accent="bgp"
          columns={["VRF", "PE1 (RD)", "PE2 (RD)", "Route target", "Sites"]}
          rows={[
            ["CUST-A", <Mono key="1">65001:101</Mono>, <Mono key="2">65001:102</Mono>, <Mono key="3">65001:100</Mono>, "CE1A 10.1.1.0/24 (+ 10.1.2.0/24, not announced) · CE2A 10.2.2.0/24"],
            ["CUST-B", <Mono key="4">65001:201</Mono>, <Mono key="5">65001:202</Mono>, <Mono key="6">65001:200</Mono>, "CE1B 10.1.1.0/24 · CE2B 10.2.2.0/24"],
            ["SHARED", "—", <Mono key="7">65001:902</Mono>, <Mono key="8">65001:900</Mono>, "CE2S 10.9.9.0/24"],
          ]}
        />
      </GuideSection>

      <GuideSection id="vd-vrf" eyebrow="VRFs and PE-CE" title="VRFs and interfaces" tone="violet">
        <p>A VRF is a routing table, a forwarding table and the set of interfaces bound to them. Binding an interface to a VRF moves its address and its connected route into that VRF. A packet&apos;s VRF is decided only by the interface it arrives on — never by its source address.</p>
        <CompareCards
          items={[
            { title: "Port in the VRF", tone: "success", tag: "normal", points: ["connected 172.16.x.0/29 in the VRF", "static routes toward the CE resolve", "the customer's packets are looked up in the VRF"] },
            { title: "Port left in the global table", tone: "danger", tag: "fault", points: ["the VRF loses the connected route", "statics toward the CE don't resolve: the route disappears", "the CE's packets land in the global table"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="vd-pece" eyebrow="VRFs and PE-CE" title="PE-CE routing" tone="cyan">
        <p>The PE learns each site&apos;s prefixes from its CE: statically (as in the lab), or with eBGP, OSPF, IS-IS or RIP running inside the VRF. Whatever the protocol, the routes must enter the VRF&apos;s BGP table to be advertised: IOS XR redistributes them under <Mono>router bgp → vrf → address-family ipv4 unicast</Mono>; Junos advertises the VRF&apos;s active routes through its vrf-target export (or a vrf-export policy) without a separate redistribute.</p>
        <Callout tone="warning" title="A static route needs the right next hop" icon="!">
          A static route whose next hop sits in the VRF&apos;s connected subnet is installed and advertised even if nobody answers at that address. The remote PE has the route, packets arrive — and the egress PE drops them because ARP fails. The lab&apos;s third ticket.
        </Callout>
      </GuideSection>

      <GuideSection id="vd-nlri" eyebrow="MP-BGP" title="VPNv4 NLRI encoding" tone="bgp">
        <DiagramFrame caption="The VPN label travels inside the NLRI itself; the RT travels beside it as an attribute.">
          <NlriDiagram />
        </DiagramFrame>
        <p>
          Because the RD is part of the address, <Mono>65001:102:10.2.2.0/24</Mono> and <Mono>65001:202:10.2.2.0/24</Mono> are simply different routes to BGP. Best-path selection runs per VPNv4 route. The family must be negotiated at OPEN on both sides (IOS XR <Mono>address-family vpnv4 unicast</Mono> under the neighbor, Junos <Mono>family inet-vpn unicast</Mono>).
        </p>
        <CliPanel run={l3Only(L3_HEALTHY, "PE1", "cisco", "show bgp vpnv4 unicast", /Network|Route Distinguisher|10\.[12]\.[12]\.0/)} caption="IOS XR · PE1 — local routes under each VRF's RD, PE2's routes under PE2's RDs" />
      </GuideSection>

      <GuideSection id="vd-rd" eyebrow="MP-BGP" title="RD formats and design" tone="bgp">
        <FieldTable
          title="8-byte RD = 2-byte type + 6-byte value"
          accent="bgp"
          columns={["Type", "Administrator", "Assigned number", "Example"]}
          rows={[
            ["0", "2-byte ASN", "4 bytes", <Mono key="a">65001:101</Mono>],
            ["1", "IPv4 address", "2 bytes", <Mono key="b">1.1.1.1:101</Mono>],
            ["2", "4-byte ASN", "2 bytes", <Mono key="c">4200000001:7</Mono>],
          ]}
        />
        <Callout tone="cyan" title="A unique RD per PE is a common design" icon="i">
          The lab gives CUST-A RD 65001:101 on PE1 and 65001:102 on PE2. With route reflectors, per-PE RDs keep both paths of a multihomed site visible instead of letting the RR pick one. Two VRFs on the same PE can&apos;t share an RD: both routers refuse the commit.
        </Callout>
      </GuideSection>

      <GuideSection id="vd-rt" eyebrow="MP-BGP" title="Route-target topologies" tone="violet">
        <p>Route targets are just import and export sets, so they build more than any-to-any meshes. A VRF can import several RTs and export several.</p>
        <DiagramFrame caption="Hub-and-spoke: spokes reach each other only through the hub.">
          <HubSpokeDiagram />
        </DiagramFrame>
        <CompareCards
          items={[
            { title: "Full mesh", tone: "violet", tag: "any-to-any", points: ["every site exports and imports the same RT", "CUST-A and CUST-B in the lab"] },
            { title: "Hub and spoke", tone: "warning", tag: "via a hub", points: ["spokes export SPOKE, import HUB", "the hub imports SPOKE, re-advertises with HUB"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="vd-extranet" eyebrow="MP-BGP" title="Extranets and shared services" tone="violet">
        <p>To give CUST-A a shared service (VRF SHARED, RT 65001:900), CUST-A&apos;s VRFs import 65001:900 <b className="text-pv-text">and</b> SHARED imports 65001:100 — otherwise requests arrive and replies have no route back. CUST-B imports neither. On IOS XR a VRF simply lists several import RTs. On Junos <Mono>vrf-target import</Mono> takes one value; importing several needs a vrf-import policy. And Junos leaks routes between two VRFs of the same PE (here CUST-A and SHARED on PE2) only when both instances run <Mono>routing-options auto-export</Mono>; IOS XR does that by itself:</p>
        <CliPair
          cisco={{ prompt: "RP/0/RP0/CPU0:PE2(config)#", command: "vrf CUST-A", output: "RP/0/RP0/CPU0:PE2(config-vrf)#address-family ipv4 unicast\nRP/0/RP0/CPU0:PE2(config-vrf-af)#import route-target\nRP/0/RP0/CPU0:PE2(config-vrf-import-rt)#65001:900\nRP/0/RP0/CPU0:PE2(config-vrf-import-rt)#commit" }}
          junos={{ prompt: "admin@PE2# ", command: "set policy-options community CUST-A members target:65001:100", output: "\n[edit]\nadmin@PE2# set policy-options community SHARED members target:65001:900\n\n[edit]\nadmin@PE2# set policy-options policy-statement CUST-A-IMP term 1 from community CUST-A\n\n[edit]\nadmin@PE2# set policy-options policy-statement CUST-A-IMP term 1 from community SHARED\n\n[edit]\nadmin@PE2# set policy-options policy-statement CUST-A-IMP term 1 then accept\n\n[edit]\nadmin@PE2# set routing-instances CUST-A vrf-import CUST-A-IMP\n\n[edit]\nadmin@PE2# set routing-instances CUST-A routing-options auto-export\n\n[edit]\nadmin@PE2# set routing-instances SHARED routing-options auto-export\n\n[edit]\nadmin@PE2# commit\ncommit complete" }}
          ciscoCaption="IOS XR · PE2 — CUST-A also imports SHARED's RT (repeat on PE1, and the reverse in VRF SHARED)"
          junosCaption="Junos · PE2 — a vrf-import policy accepting both communities, auto-export for the local leak (SHARED gets the mirror policy)"
        />
      </GuideSection>

      <GuideSection id="vd-label" eyebrow="Labels and forwarding" title="VPN label allocation" tone="mpls">
        <DiagramFrame caption="The trade-off is label count vs work at the egress PE.">
          <AllocationDiagram />
        </DiagramFrame>
        <p>
          Whatever the mode, the VPN label is <b className="text-pv-text">locally significant to the egress PE</b>: only PE2 interprets 24002. PE1 copies it into the stack; P routers never read it. IOS XR allocates per prefix by default (<Mono>label mode per-vrf</Mono> changes it); Junos allocates per next hop by default and <Mono>vrf-table-label</Mono> gives one label per VRF with an IP lookup at the egress.
        </p>
        <CliPanel run={l3Only(L3_HEALTHY, "PE2", "cisco", "show mpls forwarding", /Local|Label|---|\[V\]/)} caption="IOS XR · PE2 — one label per VRF prefix: 24002 CUST-A, 24012 CUST-B, 24022 SHARED" />
      </GuideSection>

      <GuideSection id="vd-nh" eyebrow="Labels and forwarding" title="Next-hop resolution" tone="mpls">
        <DiagramFrame caption="Two lookups at the ingress PE produce the two labels.">
          <NextHopDiagram />
        </DiagramFrame>
        <FlowSteps
          steps={[
            { title: "VRF lookup", body: "Destination → VPN route → BGP next hop + VPN label.", tone: "violet" },
            { title: "Recursive lookup", body: "BGP next hop → IGP route + LDP (or RSVP-TE / SR) LSP → transport label.", tone: "mpls" },
            { title: "Impose", body: "VPN label at the bottom (S=1), transport label on top (S=0).", tone: "success" },
          ]}
        />
        <CompareCards
          items={[
            { title: "IOS XR", tone: "cyan", tag: "no LSP", points: ["the route stays usable over the IGP path", "a hop without a label sends the packet on with only the VPN label", "the next router drops it"] },
            { title: "Junos", tone: "violet", tag: "no LSP", points: ["VPN next hops resolve in inet.3 only", "no LSP to the PE: the VPN route is hidden", "the ingress PE has no usable route"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="vd-mtu" eyebrow="Labels and forwarding" title="MTU and the stack" tone="warning">
        <p>Each label adds 4 bytes: the two-label stack adds 8; a TE or FRR bypass label makes 12. Core links need an MPLS MTU large enough for the customer&apos;s packet plus the deepest stack, or large packets are dropped while pings with small packets succeed.</p>
      </GuideSection>

      <GuideSection id="vd-scale" eyebrow="Design and scale" title="RT filtering, route reflectors, RTC" tone="bgp">
        <FieldTable
          title="How providers keep VPNv4 manageable"
          accent="bgp"
          columns={["Mechanism", "What it does", "Watch out"]}
          rows={[
            ["RT filtering (default on PEs)", "discards VPN routes no local VRF imports", "add an import later and the PE must ask for the routes again (route refresh — automatic)"],
            ["Route reflectors", "replace the PE full mesh (the Route Reflector lesson)", "a route reflector keeps every VPN route (no RT filtering); Option B ASBRs need retain route-target all"],
            ["RT Constraint (RTC)", "PEs tell the RR which RTs they want", "the RR then sends only those"],
            ["BGP-free core", "P routers run no BGP", "their LSPs to every PE loopback must be complete"],
          ]}
        />
      </GuideSection>

      <GuideSection id="vd-config" eyebrow="Operations" title="Configuring it: IOS XR and Junos" tone="cyan">
        <p>PE1 in the lab, with both customers. IOS XR splits the service over three places: the VRF (route targets), router bgp (RD, redistribution, the VPNv4 neighbor) and router static. Junos keeps each VRF in one routing instance.</p>
        <CliPair cisco={l3Cli(L3_HEALTHY, "PE1", "cisco", "show running-config vrf")} junos={l3Cli(L3_HEALTHY_JN, "PE1", "juniper", "show configuration routing-instances")} ciscoCaption="IOS XR · PE1 — VRFs and route targets" junosCaption="Junos · PE1 — routing instances: interface, RD, vrf-target, static route" />
        <CliPair cisco={l3Cli(L3_HEALTHY, "PE1", "cisco", "show running-config router bgp")} junos={l3Cli(L3_HEALTHY_JN, "PE1", "juniper", "show configuration protocols bgp")} ciscoCaption="IOS XR · PE1 — RD per VRF, redistribute static, the VPNv4 neighbor" junosCaption="Junos · PE1 — family inet-vpn unicast toward PE2" />
        <CliPanel run={l3Cli(L3_HEALTHY, "PE1", "cisco", "show running-config router static")} caption="IOS XR · PE1 — static routes toward the CEs, per VRF" />
      </GuideSection>

      <GuideSection id="vd-verify" eyebrow="Operations" title="How to verify" tone="success">
        <FieldTable
          title="The questions, and where the answers are"
          accent="success"
          columns={["Question", "IOS XR", "Junos"]}
          rows={[
            ["Which VRFs, RDs and RTs?", <Mono key="1">show vrf all</Mono>, <Mono key="2">show configuration routing-instances</Mono>],
            ["Is VPNv4 up, prefixes received?", <Mono key="3">show bgp vpnv4 unicast summary</Mono>, <Mono key="4">show bgp summary</Mono>],
            ["Did the route arrive, with which RT and label?", <Mono key="5">show bgp vpnv4 unicast rd &lt;rd&gt; &lt;prefix&gt;</Mono>, <Mono key="6">show route table bgp.l3vpn.0 detail</Mono>],
            ["Is it in the VRF?", <Mono key="7">show route vrf CUST-A</Mono>, <Mono key="8">show route table CUST-A.inet.0</Mono>],
            ["Which labels are pushed?", <Mono key="9">show cef vrf CUST-A 10.2.2.20</Mono>, <Mono key="10">show route table CUST-A.inet.0 10.2.2.20</Mono>],
            ["Is there an LSP to the remote PE?", <Mono key="11">show mpls forwarding</Mono>, <Mono key="12">show route table inet.3</Mono>],
          ]}
        />
      </GuideSection>

      <GuideSection id="vd-signatures" eyebrow="Troubleshooting" title="Failure signatures" tone="danger">
        <FailureSignatures
          items={[
            { tag: "RT", title: "Wrong import route target", tone: "danger", points: ["one customer, one direction", "route advertised, not imported", "the other customer is fine"] },
            { tag: "AF", title: "No VPNv4 on one side", tone: "danger", points: ["session Established", "no VPN routes for anyone"] },
            { tag: "STA", title: "Static to a wrong CE address", tone: "warning", points: ["remote PE has the route", "egress PE: ARP incomplete"] },
            { tag: "LSP", title: "Transport LSP broken", tone: "violet", points: ["routes everywhere (XR) or hidden (Junos)", "packets dropped in the core"] },
            { tag: "IF", title: "Port not in its VRF", tone: "warning", points: ["the site's routes vanish from the VPN", "the CE answers ARP, nobody reaches it"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="vd-workflow" eyebrow="Troubleshooting" title="Investigation workflow" tone="danger">
        <TroubleshootingFlow
          steps={[
            { question: "Where does a fresh ping die?", look: "Ingress PE (no route), core (label drop) or egress PE (ARP)." },
            { question: "Is the CE's port in the right VRF?", look: "The VRF's connected route and interface list." },
            { question: "Is VPNv4 negotiated, and are prefixes received?", look: "BGP summary and neighbor capabilities." },
            { question: "Does the remote PE advertise the route, with which RT?", look: "Its VPNv4 table: RD, RT, label, advertised to." },
            { question: "Does the local VRF import that RT?", look: "The VRF's import list (or Junos vrf-import policy)." },
            { question: "Is the LSP to the remote PE complete?", look: "Label forwarding hop by hop; Junos inet.3." },
          ]}
        />
      </GuideSection>

      <GuideSection id="vd-tickets" eyebrow="Troubleshooting" title="Five faults, evidence to proof" tone="danger">
        <p>The L3VPN Lab&apos;s five tickets, with the fault in place (IOS XR view unless noted).</p>
        <FailureWalk
          title="1 · CUST-A site 1 lost site 2"
          normal="PE1's CUST-A imports 65001:100."
          change="Overnight, the import became 65001:999."
          evidence={<CliPanel run={l3Only(T.rt, "PE1", "cisco", "show route vrf CUST-A", /^[SBCL] /)} caption="IOS XR · PE1 — no 10.2.2.0/24 in CUST-A" />}
          next="PE2 advertises the route with RT 65001:100; PE1's summary shows one prefix fewer; show vrf all shows import 65001:999."
          fix={<Mono>PE1: vrf CUST-A → address-family ipv4 unicast → import route-target → no 65001:999 → 65001:100 → commit</Mono>}
          proof="10.2.2.0/24 back in CUST-A via 4.4.4.4; a fresh ping from CE1A reaches CE2A."
        />
        <FailureWalk
          title="2 · Every VPN is cut in half"
          normal="Both PEs activate VPNv4 toward each other."
          change="PE2's BGP configuration was regenerated without address-family vpnv4 unicast."
          evidence={<CliPanel run={l3Only(T.vpnv4, "PE1", "cisco", "show bgp neighbors 4.4.4.4", /state|capabilities|Address family|accepted/)} caption="IOS XR · PE1 — Established, but VPNv4 only advertised, not received" />}
          next="PE1 offers VPNv4, PE2 doesn't: the family isn't used. Every customer loses its remote site."
          fix={<Mono>PE2: router bgp 65000 → neighbor 1.1.1.1 → address-family vpnv4 unicast → commit</Mono>}
          proof="VPNv4 advertised and received; prefixes accepted; fresh pings from CE1A and CE1B succeed."
        />
        <FailureWalk
          title="3 · CUST-B site 2 is invisible"
          normal="PE2's CUST-B static route points at CE2B, 172.16.2.2."
          change="Re-typed during a cleanup: next hop 172.16.2.3."
          evidence={<CliPanel run={l3Only(T.static, "PE2", "cisco", "show arp vrf CUST-B", /Address|172\.16\.2/)} caption="IOS XR · PE2 — 172.16.2.3 Incomplete" />}
          next="The route is installed and advertised (PE1 has it); packets reach PE2 and die there."
          fix={<Mono>PE2: router static → vrf CUST-B → address-family ipv4 unicast → no 10.2.2.0/24 172.16.2.3 → 10.2.2.0/24 172.16.2.2 → commit</Mono>}
          proof="The static points at 172.16.2.2; a fresh ping from CE1B reaches CE2B."
        />
        <FailureWalk
          title="4 · The core pings, the VPNs don't"
          normal="LDP on every core link: PE1 pushes 24102, P1 swaps to 24203, P2 pops."
          change="After P1's upgrade, its interface toward P2 no longer runs LDP."
          evidence={
            <>
              <CliPanel run={l3Cli(T.transport, "P1", "cisco", "show mpls forwarding")} caption="IOS XR · P1 — 4.4.4.4 Unlabelled: P2 receives PE2's VPN label and drops it" />
              <CliPanel run={l3Cli(T.transportJn, "PE1", "juniper", "show route table bgp.l3vpn.0")} caption="Junos · PE1 — the same fault: both VPN routes hidden (no LSP in inet.3)" />
            </>
          }
          next="P1's LDP neighbors: only PE1. IS-IS and BGP are fine — the LSP isn't."
          fix={<Mono>P1: mpls ldp → interface GigabitEthernet0/0/0/1 → commit</Mono>}
          proof="P1 swaps 24102 → 24203 again; a fresh ping from CE1A reaches CE2A."
        />
        <FailureWalk
          title="5 · A new port for CUST-A site 2"
          normal="PE2's port toward CE2A is in VRF CUST-A."
          change="The site moved to a new port, configured without vrf CUST-A."
          evidence={<CliPanel run={l3Only(T.ifvrf, "PE2", "cisco", "show route vrf CUST-A", /^[SBCL] /)} caption="IOS XR · PE2 — CUST-A has no connected route and no static: 10.2.2.0/24 is gone" />}
          next="The static's next hop isn't in a connected subnet of the VRF any more, so it isn't installed or advertised."
          fix={<Mono>PE2: interface GigabitEthernet0/0/0/1 → vrf CUST-A → commit</Mono>}
          proof="Connected and static routes back in CUST-A; a fresh ping from CE1A reaches CE2A."
        />
      </GuideSection>

      <GuideSection id="vd-interas" eyebrow="Beyond this lesson" title="Inter-AS options" tone="violet">
        <FieldTable
          title="When a VPN crosses two providers (RFC 4364 §10)"
          accent="violet"
          columns={["Option", "Between the ASBRs", "Trade-off"]}
          rows={[
            ["A — back-to-back VRFs", "one sub-interface and eBGP session per VRF, plain IP", "simple and isolated; doesn't scale"],
            ["B — VPNv4 between ASBRs", "eBGP VPNv4, labels exchanged", "scales; ASBRs hold every VPN route"],
            ["C — multihop VPNv4", "PEs (or RRs) exchange VPNv4 directly; labeled loopbacks between the ASes", "most scalable; most trust between providers"],
          ]}
        />
      </GuideSection>

      <GuideSection id="vd-myths" eyebrow="Master it" title="Common misconceptions" tone="warning">
        <Misconceptions
          items={[
            { myth: "The RD decides which VRF imports a route.", correction: "Only route targets do. The RD just keeps routes unique." },
            { myth: "Both PEs must use the same RD for a customer.", correction: "They often don't; per-PE RDs are common." },
            { myth: "P routers need the customer routes.", correction: "They need only the PE loopbacks and labels." },
            { myth: "BGP Established means the VPN works.", correction: "The VPNv4 family, the import RTs and the transport LSP must all be right." },
            { myth: "One import RT is enough for a shared service.", correction: "Replies need the reverse import too." },
            { myth: "If PE1 has the route, the problem is at PE1.", correction: "The egress PE still has to deliver: ARP, the static next hop, the port's VRF." },
          ]}
        />
      </GuideSection>

      <GuideSection id="vd-quiz" eyebrow="Master it" title="Knowledge check" tone="cyan">
        <KnowledgeQuiz questions={QUIZ} />
      </GuideSection>

      <GuideSection id="vd-explain" eyebrow="Master it" title="Can you explain it?" tone="violet">
        <ExplainIt
          items={[
            { q: "Why can two customers use 10.2.2.0/24 on the same PE?", a: "Each lives in its own VRF table, chosen by the interface; in BGP the RD makes the two routes different VPNv4 routes." },
            { q: "Why does the packet carry two labels?", a: "The transport label gets it to the egress PE across a core that knows only loopbacks; the VPN label tells the egress PE which VRF it belongs to." },
            { q: "Why did changing one import RT break only CUST-A, one direction?", a: "PE1's CUST-A no longer imports PE2's CUST-A route; CUST-B's RTs and the reverse direction are untouched." },
            { q: "Why do IOS XR and Junos show a broken LSP differently?", a: "Junos resolves VPN next hops only in inet.3 and hides the route; IOS XR keeps it and the packet dies in the core when the transport label is gone." },
            { q: "What does a shared service need besides an extra import?", a: "The service VRF must import the customer's route target, or replies have no route back." },
          ]}
        />
      </GuideSection>

      <GuideSection id="vd-practice" eyebrow="Master it" title="Practice in the L3VPN Lab" tone="success">
        <p>Six Learn levels take you from &quot;two customers, one address plan&quot; to reading the evidence; the engineering workspace gives you all four routers and five customer sites (IOS XR or Junos), pings with a hop-by-hop trace, five challenges and the five tickets above.</p>
        <LabBridge />
        <PresentationBridge>Rewatch the L3VPN presentation.</PresentationBridge>
      </GuideSection>
    </div>
  );
}
