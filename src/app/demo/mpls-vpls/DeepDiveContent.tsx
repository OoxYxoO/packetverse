import { CompareCards, DArrow, DIAGRAM as D, DLink, DNode, DPill, DRegion, DiagramFrame, DiagramSvg, FailureSignatures, FieldTable, GuideSection, Misconceptions, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { ExplainIt, KnowledgeQuiz, PracticeBridge, type KnowledgeQuestion } from "@/components/lesson/GuideInteractive";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import { PresentationBridge } from "@/components/presentation/LessonPresentation";
import { CliPair, CliPanel, FailureWalk } from "@/components/lesson/GuideCli";
import { vsApply, vsTicket, vsTicketState, type VsOs, type VsTicketId } from "@/lib/sim-engine/scenarios/vsNet";
import { PingResult, VS_HEALTHY, VS_HEALTHY_JN, VS_LEARNED, vsCli, vsOnly } from "./LessonGuideContent";

const G = { foundation: "Foundation", arch: "Architecture", signal: "Signaling", bridge: "The bridge", loops: "Loops", ops: "Operations", trouble: "Troubleshooting", beyond: "Beyond this lesson", master: "Master it" };
export const VPLS_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "pd-what", label: "Multipoint L2VPN", group: G.foundation },
  { id: "pd-network", label: "The network you will study", group: G.foundation },
  { id: "pd-vsi", label: "VSI, bridge domain, VFI", group: G.arch },
  { id: "pd-mesh", label: "The full mesh and its cost", group: G.arch },
  { id: "pd-signal", label: "Signaling the mesh (LDP)", group: G.signal },
  { id: "pd-labels", label: "Per-neighbor labels", group: G.signal },
  { id: "pd-decision", label: "The forwarding decision", group: G.bridge },
  { id: "pd-bum", label: "BUM and ingress replication", group: G.bridge },
  { id: "pd-aging", label: "Aging, clearing, MAC moves", group: G.bridge },
  { id: "pd-loops", label: "Why split horizon exists", group: G.loops },
  { id: "pd-transport", label: "Transport dependency", group: G.loops },
  { id: "pd-config", label: "Configuring it: IOS XR and Junos", group: G.ops },
  { id: "pd-verify", label: "How to verify", group: G.ops },
  { id: "pd-signatures", label: "Failure signatures", group: G.trouble },
  { id: "pd-workflow", label: "Investigation workflow", group: G.trouble },
  { id: "pd-tickets", label: "Five faults, evidence to proof", group: G.trouble },
  { id: "pd-scale", label: "Scaling limits and what came next", group: G.beyond },
  { id: "pd-myths", label: "Common misconceptions", group: G.master },
  { id: "pd-quiz", label: "Knowledge check", group: G.master },
  { id: "pd-explain", label: "Can you explain it?", group: G.master },
  { id: "pd-practice", label: "Practice in the VPLS Lab", group: G.master },
];

// Real CLI output and ping results: the VPLS Lab's own command sets and model.
const ticket = (id: VsTicketId, os: VsOs = "xr") => vsTicket(id).repro.reduce((acc, a) => vsApply(acc, a), vsTicketState(id, 1, os));
const T = { mesh: ticket("mesh"), vplsid: ticket("vplsid"), mtu: ticket("mtu"), vlan: ticket("vlan"), transport: ticket("transport"), transportJn: ticket("transport", "junos") };

function LabBridge() {
  const openLab = usePracticeLabOpener();
  return (
    <PracticeBridge label="Open the VPLS Lab" onPractice={openLab}>
      The network from this page, IOS XR or Junos, your own copy. Nothing you do there changes your lesson progress.
    </PracticeBridge>
  );
}

/** The lab's network. */
function LabNet() {
  const n: Record<string, [number, number, string, string]> = {
    CE1: [50, 110, "…100.1", D.violet],
    PE1: [160, 110, "1.1.1.1", D.mpls],
    P1: [275, 110, "10.10.10.1", D.mpls],
    P2: [390, 50, "10.10.10.2", D.mpls],
    P3: [390, 170, "10.10.10.3", D.mpls],
    PE2: [505, 50, "2.2.2.2", D.mpls],
    PE3: [505, 170, "3.3.3.3", D.mpls],
    CE2: [600, 30, "…100.2", D.warning],
    CE4: [600, 80, "…100.4 (spare)", D.faint],
    CE3: [600, 170, "…100.3", D.success],
  };
  const l: [string, string][] = [["CE1", "PE1"], ["PE1", "P1"], ["P1", "P2"], ["P1", "P3"], ["P2", "PE2"], ["P3", "PE3"], ["PE2", "CE2"], ["PE2", "CE4"], ["PE3", "CE3"]];
  return (
    <DiagramSvg h={240} label="CE1 at PE1; PE1-P1; P1 to P2 and P3; P2-PE2 with CE2 and a spare CE4; P3-PE3 with CE3; pseudowires PE1-PE2, PE1-PE3, PE2-PE3">
      <DRegion x={112} y={14} w={440} h={196} label="IS-IS + LDP core" color={D.mpls} />
      {l.map(([a, b]) => (
        <DLink key={a + b} x1={n[a][0]} y1={n[a][1]} x2={n[b][0]} y2={n[b][1]} color={a === "PE2" && b === "CE4" ? D.faint : a.startsWith("CE") || b.startsWith("CE") ? D.line : D.mpls} dashed={a === "PE2" && b === "CE4"} />
      ))}
      {Object.entries(n).map(([id, [x, y, sub, c]]) => (
        <DNode key={id} x={x} y={y} label={id} sub={sub} accent={c} w={id.startsWith("CE") ? 84 : 80} />
      ))}
      <text x={320} y={232} textAnchor="middle" fill={D.muted} fontSize={10}>
        pseudowires (VPLS ID 500): PE1–PE2 · PE1–PE3 · PE2–PE3 · CE4 cabled to PE2, not yet in the VPLS
      </text>
    </DiagramSvg>
  );
}

const QUIZ: KnowledgeQuestion[] = [
  {
    id: "q-mesh",
    prompt: "A VPLS has 5 PEs. How many pseudowires does the full mesh need?",
    options: [
      { id: "a", label: "10 — N(N−1)/2" },
      { id: "b", label: "5" },
      { id: "c", label: "20" },
    ],
    correctId: "a",
    explanation: "Every pair of PEs needs its own pseudowire: 5 × 4 / 2 = 10.",
  },
  {
    id: "q-split",
    prompt: "PE2 receives a broadcast from PE1 over a pseudowire. Where does it send copies?",
    options: [
      { id: "a", label: "To its local attachment circuits only" },
      { id: "b", label: "To its ACs and its pseudowire to PE3" },
      { id: "c", label: "Back to PE1 too" },
    ],
    correctId: "a",
    explanation: "Split horizon: a frame from a mesh pseudowire never leaves on another one. PE1 sends PE3 its own copy.",
  },
  {
    id: "q-learn",
    prompt: "After CE1 pings CE3 once (empty tables before), which PE has not learned CE3's MAC?",
    options: [
      { id: "a", label: "PE2 — CE3's reply was unicast straight to PE1" },
      { id: "b", label: "PE1" },
      { id: "c", label: "PE3" },
    ],
    correctId: "a",
    explanation: "A PE learns only from frames it receives. CE3's frames never passed PE2.",
  },
  {
    id: "q-pair",
    prompt: "CE1 ↔ CE2 and CE2 ↔ CE3 work, CE1 ↔ CE3 doesn't. First suspect?",
    options: [
      { id: "a", label: "The PE1–PE3 pseudowire (a missing mesh member)" },
      { id: "b", label: "PE2's MAC table" },
      { id: "c", label: "Split horizon misconfigured" },
    ],
    correctId: "a",
    explanation: "Every pair has its own pseudowire. If one pair fails, check that pseudowire — nobody can relay around it.",
  },
  {
    id: "q-empty",
    prompt: "You clear every MAC table. What happens to reachability?",
    options: [
      { id: "a", label: "Nothing breaks — the next frames flood and the tables refill" },
      { id: "b", label: "All sites are cut off until the tables refill" },
      { id: "c", label: "Only broadcast works" },
    ],
    correctId: "a",
    explanation: "Unknown unicast is flooded. An empty table costs efficiency, not reachability.",
  },
  {
    id: "q-label",
    prompt: "Why does PE3 hand PE1 and PE2 different receive labels?",
    options: [
      { id: "a", label: "So it knows which pseudowire (bridge port) a frame came from — for learning and split horizon" },
      { id: "b", label: "To balance load" },
      { id: "c", label: "Because LDP requires unique labels network-wide" },
    ],
    correctId: "a",
    explanation: "Each pseudowire is a separate bridge port. The label identifies the port.",
  },
  {
    id: "q-id",
    prompt: "PE2 is configured with VPLS ID 501, the others 500. What breaks?",
    options: [
      { id: "a", label: "Both of PE2's pseudowires: its site is isolated; PE1–PE3 still works" },
      { id: "b", label: "The whole VPLS" },
      { id: "c", label: "Nothing — the VPLS ID is only a name" },
    ],
    correctId: "a",
    explanation: "The VPLS ID is the PW ID in every mapping. PE2's mappings match nobody's.",
  },
  {
    id: "q-p",
    prompt: "What do P1, P2 and P3 know about CUST-A's MAC addresses?",
    options: [
      { id: "a", label: "Nothing — they switch transport labels only" },
      { id: "b", label: "Everything — they relay the floods" },
      { id: "c", label: "Only the MACs behind PE1" },
    ],
    correctId: "a",
    explanation: "The bridges are on the PEs. The core forwards labels.",
  },
];
function LanDiagram() {
  const sites: [string, number, number][] = [
    ["Site A", 80, 50],
    ["Site B", 560, 50],
    ["Site C", 80, 170],
    ["Site D", 560, 170],
  ];
  return (
    <DiagramSvg h={220} label="Four customer sites attached to one virtual Ethernet switch provided by the MPLS network">
      <rect x={220} y={60} width={200} height={100} rx={20} fill={D.mpls} fillOpacity={0.08} stroke={D.mpls} strokeDasharray="6 4" />
      <text x={320} y={105} textAnchor="middle" fill={D.mpls} fontSize={12} fontWeight={700}>
        one virtual LAN
      </text>
      <text x={320} y={124} textAnchor="middle" fill={D.muted} fontSize={10}>
        PEs + pseudowires + MPLS core
      </text>
      {sites.map(([n, x, y]) => (
        <g key={n}>
          <DLink x1={x < 320 ? x + 40 : x - 40} y1={y} x2={x < 320 ? 220 : 420} y2={y < 110 ? 80 : 140} color={D.ip} />
          <DNode x={x} y={y} label={n} accent={D.ip} w={80} />
        </g>
      ))}
    </DiagramSvg>
  );
}

function MeshGrowth() {
  const rows: [number, number][] = [
    [3, 3],
    [5, 10],
    [10, 45],
    [20, 190],
    [50, 1225],
  ];
  return (
    <DiagramSvg h={180} label="Full-mesh pseudowire count n(n-1)/2: 3 PEs 3, 5 PEs 10, 10 PEs 45, 20 PEs 190, 50 PEs 1225">
      {rows.map(([n, c], i) => {
        const w = Math.max(6, Math.log10(c + 1) * 130);
        return (
          <g key={n}>
            <text x={90} y={30 + i * 30} textAnchor="end" fill={D.text} fontSize={10.5}>
              {n} PEs
            </text>
            <rect x={100} y={18 + i * 30} width={w} height={18} rx={4} fill={D.violet} fillOpacity={0.3} stroke={D.violet} />
            <text x={108 + w} y={31 + i * 30} fill={D.violet} fontSize={10} fontWeight={700}>
              {c} PWs
            </text>
          </g>
        );
      })}
      <text x={600} y={170} textAnchor="end" fill={D.muted} fontSize={9.5}>
        log-scaled bars · each PW = targeted LDP state on both ends
      </text>
    </DiagramSvg>
  );
}

function DecisionDiagram() {
  const box = (x: number, y: number, t: string, c: string, w = 150) => <DPill x={x} y={y} text={t} color={c} w={w} />;
  return (
    <DiagramSvg h={230} label="Learn the source MAC on the ingress port, classify the destination, forward to one port if known, otherwise replicate to all except ingress, then apply split horizon">
      {box(100, 30, "frame arrives on a port", D.cyan, 170)}
      <DArrow x1={100} y1={43} x2={100} y2={67} color={D.faint} width={1.6} />
      {box(100, 80, "learn SOURCE MAC → port", D.success, 170)}
      <DArrow x1={100} y1={93} x2={100} y2={117} color={D.faint} width={1.6} />
      {box(100, 130, "classify DESTINATION", D.violet, 170)}
      <DArrow x1={186} y1={122} x2={330} y2={60} color={D.success} />
      <text x={232} y={78} textAnchor="middle" fill={D.success} fontSize={10} fontWeight={700}>
        known unicast
      </text>
      <DArrow x1={186} y1={138} x2={330} y2={180} color={D.warning} />
      <text x={150} y={200} fill={D.warning} fontSize={10} fontWeight={700}>
        unknown / broadcast / multicast
      </text>
      {box(460, 55, "send to that ONE port (not ingress)", D.success, 240)}
      {box(460, 170, "replicate to all ports except ingress", D.warning, 250)}
      <DArrow x1={460} y1={183} x2={460} y2={200} color={D.faint} width={1.6} />
      {box(460, 214, "…minus PWs if ingress was a PW", D.danger, 230)}
    </DiagramSvg>
  );
}

function LoopDiagram() {
  return (
    <DiagramSvg h={210} label="Without split horizon a broadcast from PE1 reaches PE2 and PE3, which relay it to each other and back to PE1, looping forever">
      <DNode x={320} y={40} label="PE1" accent={D.mpls} />
      <DNode x={140} y={170} label="PE2" accent={D.mpls} />
      <DNode x={500} y={170} label="PE3" accent={D.mpls} />
      <DArrow x1={280} y1={60} x2={180} y2={148} color={D.warning} />
      <DArrow x1={360} y1={60} x2={460} y2={148} color={D.warning} />
      <text x={236} y={84} textAnchor="end" fill={D.warning} fontSize={10} fontWeight={700}>
        copy
      </text>
      <text x={404} y={84} fill={D.warning} fontSize={10} fontWeight={700}>
        copy
      </text>
      <DArrow x1={192} y1={176} x2={448} y2={176} color={D.danger} both dashed label="relayed PW → PW (forbidden)" />
      <text x={320} y={120} textAnchor="middle" fill={D.danger} fontSize={11} fontWeight={700}>
        no TTL in Ethernet → endless copies
      </text>
    </DiagramSvg>
  );
}

function ReplicationDiagram() {
  return (
    <DiagramSvg h={170} label="Ingress replication sends one unicast copy per remote PE from the ingress PE; P2MP replication lets the core copy the packet">
      <text x={160} y={20} textAnchor="middle" fill={D.warning} fontSize={11} fontWeight={700}>
        ingress replication (this lesson)
      </text>
      <DNode x={60} y={90} label="PE1" accent={D.mpls} w={70} h={34} />
      {[40, 90, 140].map((y, i) => (
        <g key={y}>
          <DArrow x1={97} y1={90} x2={243} y2={y} color={D.warning} />
          <DNode x={270} y={y} label={`PE${i + 2}`} accent={D.mpls} w={50} h={28} />
        </g>
      ))}
      <text x={480} y={20} textAnchor="middle" fill={D.cyan} fontSize={11} fontWeight={700}>
        P2MP LSP (optimization, not modeled)
      </text>
      <DNode x={370} y={90} label="PE1" accent={D.mpls} w={70} h={34} />
      <DArrow x1={407} y1={90} x2={463} y2={90} color={D.cyan} />
      <DNode x={490} y={90} label="P" accent={D.faint} w={44} h={28} />
      {[40, 90, 140].map((y) => (
        <DArrow key={y} x1={513} y1={90} x2={573} y2={y} color={D.cyan} />
      ))}
      <text x={320} y={165} textAnchor="middle" fill={D.muted} fontSize={10}>
        ingress replication costs PE1 bandwidth per copy; P2MP moves the copying into the core
      </text>
    </DiagramSvg>
  );
}

function MoveDiagram() {
  return (
    <DiagramSvg h={150} label="A MAC learned on PW PE2 is relearned on PW PE3 when a frame from that MAC arrives there; the newest observation wins">
      <DPill x={130} y={40} text="CE2 MAC → PW: PE2" color={D.success} w={190} />
      <DArrow x1={230} y1={40} x2={390} y2={40} color={D.faint} />
      <text x={320} y={70} textAnchor="middle" fill={D.muted} fontSize={10}>
        frame from CE2 arrives via PW: PE3
      </text>
      <DPill x={510} y={40} text="CE2 MAC → PW: PE3" color={D.warning} w={190} />
      <text x={320} y={100} textAnchor="middle" fill={D.text} fontSize={10.5}>
        traditional VPLS: most recent observation wins, no sequence number
      </text>
      <text x={320} y={125} textAnchor="middle" fill={D.muted} fontSize={10}>
        stale entries elsewhere wait for aging (or optional LDP MAC Address Withdrawal)
      </text>
    </DiagramSvg>
  );
}

export function VplsDeepDiveContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="pd-what" eyebrow="Foundation" title="Multipoint L2VPN" tone="mpls">
        <p>VPLS (RFC 4762 with LDP signaling, RFC 4761 with BGP) emulates an Ethernet LAN across an MPLS network: any number of customer sites, one broadcast domain. The PEs do what a switch does — learn, forward, flood — and the pseudowires between them are the switch&apos;s backplane. It was the standard way to sell &quot;Ethernet everywhere&quot; before EVPN.</p>
        <DiagramFrame caption="What the customer sees: one LAN. What the provider runs: bridges and pseudowires.">
          <LanDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="pd-network" eyebrow="Foundation" title="The network you will study" tone="cyan">
        <DiagramFrame caption="The VPLS Lab. Every output on this page comes from it.">
          <LabNet />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="pd-vsi" eyebrow="Architecture" title="VSI, bridge domain, VFI" tone="violet">
        <FieldTable
          title="The same thing, three names"
          accent="violet"
          columns={["Term", "Where", "What it is"]}
          rows={[
            ["VSI", "RFC 4762", "virtual switching instance: the per-VPLS bridge on a PE"],
            ["Bridge domain + VFI", "IOS XR", "the bridge (with its ACs) and its set of mesh pseudowires"],
            ["Routing instance type vpls", "Junos", "the bridge, its interfaces and protocols vpls (vpls-id, neighbors)"],
          ]}
        />
        <CliPair cisco={vsCli(VS_HEALTHY, "PE1", "cisco", "show running-config l2vpn")} junos={vsCli(VS_HEALTHY_JN, "PE1", "juniper", "show configuration routing-instances")} ciscoCaption="IOS XR · PE1 — bridge group, bridge-domain, VFI" junosCaption="Junos · PE1 — instance-type vpls" />
      </GuideSection>

      <GuideSection id="pd-mesh" eyebrow="Architecture" title="The full mesh and its cost" tone="violet">
        <DiagramFrame caption="Pseudowires grow with the square of the number of PEs.">
          <MeshGrowth />
        </DiagramFrame>
        <p>Every PE needs a pseudowire — and a targeted LDP session — to every other PE: N(N−1)/2 of each. Adding a site means touching every existing PE (with LDP signaling, nothing discovers the new member). This is the scaling limit that H-VPLS and BGP auto-discovery, later in this path, address.</p>
      </GuideSection>

      <GuideSection id="pd-signal" eyebrow="Signaling" title="Signaling the mesh (LDP)" tone="violet">
        <p>Each pseudowire is signaled exactly like a VPWS pseudowire: FEC 128 with the VPLS ID as PW ID, over a targeted LDP session between loopbacks. Both ends must list each other and agree on the VPLS ID and MTU. VPLS pseudowires usually run without a control word.</p>
        <CliPanel run={vsOnly(VS_HEALTHY, "PE1", "cisco", "show mpls ldp discovery", /Targeted|->|LDP Id: [23]/)} caption="IOS XR · PE1 — two targeted neighbors, both answering" />
      </GuideSection>

      <GuideSection id="pd-labels" eyebrow="Signaling" title="Per-neighbor labels" tone="mpls">
        <p>A PE allocates one receive label per neighbor — PE1 receives 24012 from PE2 and 24013 from PE3 — so the label alone tells it which bridge port a frame came in on. That is what lets it learn the source MAC on the right pseudowire and apply split horizon.</p>
        <CliPair cisco={vsOnly(VS_HEALTHY, "PE1", "cisco", "show mpls forwarding", /Local|Label|---|PW\(/)} junos={vsOnly(VS_HEALTHY_JN, "PE1", "juniper", "show vpls connections", /Neighbor  |vpls-id 500\)|Incoming label/)} ciscoCaption="IOS XR · PE1 — one receive label per neighbor" junosCaption="Junos · PE1 — incoming / outgoing label per neighbor" />
      </GuideSection>

      <GuideSection id="pd-decision" eyebrow="The bridge" title="The forwarding decision" tone="success">
        <DiagramFrame caption="Learn the source, look up the destination, then one port or all ports — minus split horizon.">
          <DecisionDiagram />
        </DiagramFrame>
        <CliPanel run={vsCli(VS_LEARNED, "PE1", "cisco", "show l2vpn forwarding bridge-domain mac-address location 0/0/CPU0")} caption="IOS XR · PE1 after one CE1 → CE3 ping" />
      </GuideSection>

      <GuideSection id="pd-bum" eyebrow="The bridge" title="BUM and ingress replication" tone="warning">
        <DiagramFrame caption="The ingress PE makes one copy per pseudowire; the core carries each as ordinary unicast labels.">
          <ReplicationDiagram />
        </DiagramFrame>
        <p>Broadcast, unknown unicast and multicast are copied by the ingress PE, once per pseudowire. With many PEs that is many copies on the PE&apos;s uplink — another scaling cost (multicast trees with P2MP LSPs can help).</p>
        <PingResult s={VS_LEARNED} title="The lab: CE1's first ping to CE3 — its ARP broadcast was flooded" />
      </GuideSection>

      <GuideSection id="pd-aging" eyebrow="The bridge" title="Aging, clearing, MAC moves" tone="cyan">
        <DiagramFrame caption="After a move, traffic follows the old entry until the host sends from its new port.">
          <MoveDiagram />
        </DiagramFrame>
        <CompareCards
          items={[
            { title: "Aging and clearing", tone: "cyan", tag: "self-healing", points: ["300 s default aging", "IOS XR: clear l2vpn bridge-domain bd-name VPLS-A", "Junos: clear vpls mac-table instance VPLS-A", "the next frame floods and relearns"] },
            { title: "MAC moves", tone: "warning", tag: "convergence", points: ["learning follows the newest source port", "LDP MAC address withdrawal flushes remote tables on topology change", "EVPN replaces it with signaled MAC mobility"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="pd-loops" eyebrow="Loops" title="Why split horizon exists" tone="danger">
        <DiagramFrame caption="Without split horizon, a broadcast circles the triangle forever.">
          <LoopDiagram />
        </DiagramFrame>
        <p>Ethernet frames carry no TTL. The PE triangle (and any larger mesh) is full of loops, so VPLS forbids forwarding from one mesh pseudowire to another. No spanning tree runs in the core; the rule alone keeps it loop-free — at the price of the full mesh.</p>
      </GuideSection>

      <GuideSection id="pd-transport" eyebrow="Loops" title="Transport dependency" tone="mpls">
        <CompareCards
          items={[
            { title: "IOS XR", tone: "cyan", tag: "no label from P3", points: ["the pseudowires to PE3 stay up", "P1 forwards unlabeled", "P3 receives PE3's PW label and drops it"] },
            { title: "Junos", tone: "violet", tag: "no LSP to 3.3.3.3", points: ["the pseudowires to PE3 go down (VC-Dn)", "no LSP in inet.3", "CE3 isolated"] },
          ]}
        />
        <CliPair cisco={vsCli(T.transport, "P1", "cisco", "show mpls forwarding")} junos={vsOnly(T.transportJn, "PE1", "juniper", "show vpls connections", /Neighbor  |vpls-id 500\)/)} ciscoCaption="IOS XR · P1 — 3.3.3.3 Unlabelled" junosCaption="Junos · PE1 — VC-Dn toward 3.3.3.3" />
      </GuideSection>

      <GuideSection id="pd-config" eyebrow="Operations" title="Configuring it: IOS XR and Junos" tone="cyan">
        <CliPair cisco={vsOnly(VS_HEALTHY, "PE1", "cisco", "show running-config", /l2transport|encapsulation dot1q/)} junos={vsCli(VS_HEALTHY_JN, "PE1", "juniper", "show configuration interfaces ge-0/0/1")} ciscoCaption="IOS XR · PE1 — the attachment circuit" junosCaption="Junos · PE1 — vlan-vpls encapsulation on the unit" />
        <p className="text-sm text-pv-text-muted">The service itself is in the previous section. On Junos, <Mono>no-tunnel-services</Mono> makes the router use label-switched interfaces (lsi) instead of a tunnel PIC, and <Mono>lo0.0</Mono> must be under <Mono>protocols ldp</Mono> for the targeted sessions.</p>
      </GuideSection>

      <GuideSection id="pd-verify" eyebrow="Operations" title="How to verify" tone="success">
        <FieldTable
          title="The questions, and where the answers are"
          accent="success"
          columns={["Question", "IOS XR", "Junos"]}
          rows={[
            ["ACs and pseudowires up?", <Mono key="1">show l2vpn bridge-domain</Mono>, <Mono key="2">show vpls connections</Mono>],
            ["Labels, MTU, VLANs?", <Mono key="3">show l2vpn bridge-domain detail</Mono>, <Mono key="4">show vpls connections</Mono>],
            ["Where is each MAC?", <Mono key="5">show l2vpn forwarding bridge-domain mac-address location 0/0/CPU0</Mono>, <Mono key="6">show vpls mac-table</Mono>],
            ["Targeted sessions?", <Mono key="7">show mpls ldp discovery</Mono>, <Mono key="8">show ldp neighbor</Mono>],
            ["LSPs to the other PEs?", <Mono key="9">show mpls forwarding</Mono>, <Mono key="10">show route table inet.3</Mono>],
          ]}
        />
      </GuideSection>

      <GuideSection id="pd-signatures" eyebrow="Troubleshooting" title="Failure signatures" tone="danger">
        <FailureSignatures
          items={[
            { tag: "MESH", title: "A missing neighbor", tone: "danger", points: ["one pair of sites cut", "the other pairs fine"] },
            { tag: "ID", title: "Different VPLS ID", tone: "danger", points: ["one PE isolated", "no remote labels"] },
            { tag: "MTU", title: "Different MTU", tone: "warning", points: ["labels known", "that PE's pseudowires down"] },
            { tag: "VLAN", title: "AC on the wrong VLAN", tone: "violet", points: ["every pseudowire up", "one site silent"] },
            { tag: "LSP", title: "Transport broken", tone: "warning", points: ["XR: PWs up, drops in the core", "Junos: VC-Dn"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="pd-workflow" eyebrow="Troubleshooting" title="Investigation workflow" tone="danger">
        <TroubleshootingFlow
          steps={[
            { question: "Which pairs of sites fail?", look: "Ping every pair: one pair, one site, or everything?" },
            { question: "Is each site's attachment circuit in the bridge?", look: "VLANs and bridge membership on each PE." },
            { question: "Does every PE list every other PE?", look: "Neighbors in each VFI / instance." },
            { question: "Is every pseudowire up?", look: "VPLS ID and MTU at both ends; targeted sessions." },
            { question: "Is the transport complete?", look: "Labels toward each PE loopback." },
          ]}
        />
      </GuideSection>

      <GuideSection id="pd-tickets" eyebrow="Troubleshooting" title="Five faults, evidence to proof" tone="danger">
        <p>The VPLS Lab&apos;s five tickets, with the fault in place (IOS XR view unless noted).</p>
        <FailureWalk
          title="1 · Site 1 can't see site 3"
          normal="Each PE lists both other PEs."
          change="PE3's cleanup removed neighbor 1.1.1.1."
          evidence={<CliPanel run={vsOnly(T.mesh, "PE3", "cisco", "show l2vpn bridge-domain", /ACs: d|VFI VPLS|Neighbor/)} caption="IOS XR · PE3 — one neighbor" />}
          next="PE1's targeted hellos to 3.3.3.3 go unanswered; PE2 can't relay (split horizon)."
          fix={<Mono>PE3: l2vpn → bridge group CUST-A → bridge-domain VPLS-A → vfi VPLS-A → neighbor 1.1.1.1 pw-id 500 → commit</Mono>}
          proof="Six pseudowire ends up; a fresh ping from CE1 reaches CE3."
        />
        <FailureWalk
          title="2 · Site 2 is alone"
          normal="Every pseudowire uses PW ID 500."
          change="A template set PE2's neighbors to pw-id 501 (Junos: vpls-id 501)."
          evidence={<CliPanel run={vsOnly(T.vplsid, "PE2", "cisco", "show running-config l2vpn", /vfi|neighbor/)} caption="IOS XR · PE2 — pw-id 501" />}
          next="PE1 and PE3 advertise PW 500 toward PE2; PE2's mappings for 501 match nobody's."
          fix={<Mono>PE2: … vfi VPLS-A → neighbor 1.1.1.1 pw-id 500 → neighbor 3.3.3.3 pw-id 500 → commit</Mono>}
          proof="PE2's pseudowires up; a fresh ping from CE2 reaches CE1."
        />
        <FailureWalk
          title="3 · Jumbo frames for site 3"
          normal="Every PE signals MTU 1500."
          change="PE3's bridge domain got mtu 1504."
          evidence={<CliPanel run={vsOnly(T.mtu, "PE1", "cisco", "show l2vpn bridge-domain detail", /PW: neighbor|MTU  /)} caption="IOS XR · PE1 — MTU 1500 / 1504 toward PE3" />}
          next="Labels arrive; the MTU check keeps both of PE3's pseudowires down."
          fix={<Mono>PE3: … bridge-domain VPLS-A → no mtu → commit</Mono>}
          proof="All pseudowires up; a fresh ping from CE1 reaches CE3."
        />
        <FailureWalk
          title="4 · Every pseudowire up, site 2 silent"
          normal="PE2's AC accepts VLAN 100, like CE2."
          change="After a line-card swap: encapsulation dot1q 200."
          evidence={<CliPanel run={vsOnly(T.vlan, "PE2", "cisco", "show l2vpn bridge-domain detail", /AC:|VLAN ranges|PWs:/)} caption="IOS XR · PE2 — VLAN ranges [200, 200]" />}
          next="CE2's frames match no AC; floods toward CE2 leave tagged 200 and are dropped."
          fix={<Mono>PE2: interface GigabitEthernet0/0/0/1.100 l2transport → encapsulation dot1q 100 → commit</Mono>}
          proof="VLAN ranges [100, 100]; a fresh ping from CE1 reaches CE2."
        />
        <FailureWalk
          title="5 · After the P1 upgrade"
          normal="LDP on every core link."
          change="P1's interface toward P3 lost LDP."
          evidence={<CliPanel run={vsCli(T.transport, "P1", "cisco", "show mpls forwarding")} caption="IOS XR · P1 — 3.3.3.3 Unlabelled" />}
          next="The pseudowires stay up on IOS XR (VC-Dn on Junos); P3 drops PE3's PW labels."
          fix={<Mono>P1: mpls ldp → interface GigabitEthernet0/0/0/2 → commit</Mono>}
          proof="P1 swaps 24104 → 24306 again; a fresh ping from CE1 reaches CE3."
        />
      </GuideSection>

      <GuideSection id="pd-scale" eyebrow="Beyond this lesson" title="Scaling limits and what came next" tone="violet">
        <FieldTable
          title="Where classic LDP-VPLS hurts"
          accent="violet"
          columns={["Limit", "Why", "Answer later in this path"]}
          rows={[
            ["N(N−1)/2 pseudowires and sessions", "full mesh + split horizon", "H-VPLS (spokes to hub PEs)"],
            ["Manual neighbor lists", "LDP has no discovery", "BGP-signaled / auto-discovered VPLS"],
            ["Ingress replication of BUM", "a copy per pseudowire", "P2MP trees; EVPN"],
            ["Learning only from traffic", "no MAC signaling", "EVPN (MACs in BGP, mobility, multihoming)"],
          ]}
        />
      </GuideSection>

      <GuideSection id="pd-myths" eyebrow="Master it" title="Common misconceptions" tone="warning">
        <Misconceptions
          items={[
            { myth: "If two pairs of sites work, the VPLS is fine.", correction: "Each pair rides its own pseudowire. Test every pair." },
            { myth: "A PE can relay between two pseudowires if the direct one is down.", correction: "Split horizon forbids it, always." },
            { myth: "An empty MAC table breaks connectivity.", correction: "Unknown frames are flooded; the table refills." },
            { myth: "The P routers learn customer MACs.", correction: "Only the PEs bridge; the core switches labels." },
            { myth: "VPLS discovers its members.", correction: "LDP-signaled VPLS needs every neighbor configured on every PE." },
            { myth: "One receive label per VPLS is enough.", correction: "One per neighbor: the label is the bridge port." },
          ]}
        />
      </GuideSection>

      <GuideSection id="pd-quiz" eyebrow="Master it" title="Knowledge check" tone="cyan">
        <KnowledgeQuiz questions={QUIZ} />
      </GuideSection>

      <GuideSection id="pd-explain" eyebrow="Master it" title="Can you explain it?" tone="violet">
        <ExplainIt
          items={[
            { q: "Why does VPLS need a full mesh of pseudowires?", a: "Split horizon forbids relaying from one pseudowire to another, so every PE must reach every other PE directly." },
            { q: "Why did CE1 ↔ CE3 fail while CE1 ↔ CE2 and CE2 ↔ CE3 worked?", a: "Only the PE1–PE3 pseudowire was down (PE3 didn't list PE1); PE2 couldn't relay between its two pseudowires." },
            { q: "Why does PE2 not know CE3's MAC after CE1 pings CE3?", a: "CE3's reply was unicast from PE3 to PE1 — PE2 received only the flooded ARP request from CE1." },
            { q: "Why do PEs allocate a label per neighbor?", a: "The label tells the receiving PE which pseudowire the frame came on — needed for learning and split horizon." },
            { q: "What does clearing the MAC tables cost?", a: "A round of flooding while the tables relearn; reachability is unaffected." },
          ]}
        />
      </GuideSection>

      <GuideSection id="pd-practice" eyebrow="Master it" title="Practice in the VPLS Lab" tone="success">
        <p>Six Learn levels take you from &quot;one LAN across the provider&quot; to reading the evidence; the engineering workspace gives you all six routers (IOS XR or Junos), real MAC tables, pings from four sites, five challenges and the five tickets above.</p>
        <LabBridge />
        <PresentationBridge>Rewatch the VPLS presentation.</PresentationBridge>
      </GuideSection>
    </div>
  );
}
