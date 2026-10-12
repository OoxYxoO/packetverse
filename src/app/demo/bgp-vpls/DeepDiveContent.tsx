import { Callout, CompareCards, DArrow, DIAGRAM as D, DLink, DNode, DPill, DRegion, DiagramFrame, DiagramSvg, FailureSignatures, FieldTable, FlowSteps, GuideSection, Misconceptions, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { ExplainIt, KnowledgeQuiz, PracticeBridge, type KnowledgeQuestion } from "@/components/lesson/GuideInteractive";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import { PresentationBridge } from "@/components/presentation/LessonPresentation";
import { CliPair, CliPanel, FailureWalk } from "@/components/lesson/GuideCli";
import { bvApply, bvTicket, bvTicketState, type BvOs, type BvTicketId } from "@/lib/sim-engine/scenarios/bvNet";
import { BV_HEALTHY, BV_HEALTHY_JN, PingResult, bvCli, bvOnly } from "./LessonGuideContent";

const G = { foundation: "Foundation", arch: "Architecture", encoding: "Encoding", signal: "Signaling", discovery: "Discovery", ops: "Operations", trouble: "Troubleshooting", beyond: "Beyond this lesson", master: "Master it" };
export const BGP_VPLS_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "bd-what", label: "Why BGP for VPLS", group: G.foundation },
  { id: "bd-network", label: "The network you will study", group: G.foundation },
  { id: "bd-arch", label: "RFC 4761 at a glance", group: G.arch },
  { id: "bd-planes", label: "What changed, what didn't", group: G.arch },
  { id: "bd-nlri", label: "The VPLS NLRI on the wire", group: G.encoding },
  { id: "bd-ext", label: "Route target and layer-2 info", group: G.encoding },
  { id: "bd-math", label: "Label blocks and the arithmetic", group: G.signal },
  { id: "bd-multi", label: "More than one block", group: G.signal },
  { id: "bd-collision", label: "VE ID collisions", group: G.signal },
  { id: "bd-rr", label: "Route reflection", group: G.discovery },
  { id: "bd-seq", label: "From route to pseudowire", group: G.discovery },
  { id: "bd-withdraw", label: "Withdrawal and failure", group: G.discovery },
  { id: "bd-config", label: "Configuring it: IOS XR and Junos", group: G.ops },
  { id: "bd-verify", label: "How to verify", group: G.ops },
  { id: "bd-signatures", label: "Failure signatures", group: G.trouble },
  { id: "bd-workflow", label: "Investigation workflow", group: G.trouble },
  { id: "bd-tickets", label: "Five faults, evidence to proof", group: G.trouble },
  { id: "bd-variant", label: "BGP-AD with LDP signaling", group: G.beyond },
  { id: "bd-compare", label: "LDP VPLS, BGP VPLS, EVPN", group: G.beyond },
  { id: "bd-myths", label: "Common misconceptions", group: G.master },
  { id: "bd-quiz", label: "Knowledge check", group: G.master },
  { id: "bd-explain", label: "Can you explain it?", group: G.master },
  { id: "bd-practice", label: "Practice in the BGP VPLS Lab", group: G.master },
];

// Real CLI output and ping results: the BGP VPLS Lab's own command sets and model.
const ticket = (id: BvTicketId, os: BvOs = "xr") => bvTicket(id).repro.reduce((acc, a) => bvApply(acc, a), bvTicketState(id, 1, os));
const T = { rt: ticket("rt"), family: ticket("family"), rr: ticket("rr"), veid: ticket("veid"), veidJn: ticket("veid", "junos"), transport: ticket("transport"), transportJn: ticket("transport", "junos") };
const VE12 = bvApply(BV_HEALTHY, { type: "set", text: "PE3: VE ID 12", changes: [{ dev: "PE3", f: (c) => void (c.bd!.veId = 12) }] });
const VE12_JN = bvApply(BV_HEALTHY_JN, { type: "set", text: "PE3: VE ID 12", changes: [{ dev: "PE3", f: (c) => void (c.bd!.veId = 12) }] });
const VE12_PING = bvApply(VE12, { type: "test", from: "CE1", dst: "192.168.100.3" });

function LabBridge() {
  const openLab = usePracticeLabOpener();
  return (
    <PracticeBridge label="Open the BGP VPLS Lab" onPractice={openLab}>
      The network from this page, IOS XR or Junos, your own copy. Nothing you do there changes your lesson progress.
    </PracticeBridge>
  );
}

/** The lab's network. */
function LabNet() {
  const n: Record<string, [number, number, string, string]> = {
    CE1: [50, 130, "…100.1", D.violet],
    PE1: [160, 130, "1.1.1.1 · VE 1", D.mpls],
    P1: [275, 130, "10.10.10.1", D.mpls],
    RR1: [275, 40, "9.9.9.9", D.bgp],
    P2: [390, 75, "10.10.10.2", D.mpls],
    P3: [390, 190, "10.10.10.3", D.mpls],
    PE2: [505, 75, "2.2.2.2 · VE 2", D.mpls],
    PE3: [505, 190, "3.3.3.3 · VE 3", D.mpls],
    CE2: [600, 50, "…100.2", D.warning],
    CE4: [600, 110, "…100.4 (spare)", D.faint],
    CE3: [600, 190, "…100.3", D.success],
  };
  const l: [string, string][] = [["CE1", "PE1"], ["PE1", "P1"], ["P1", "RR1"], ["P1", "P2"], ["P1", "P3"], ["P2", "PE2"], ["P3", "PE3"], ["PE2", "CE2"], ["PE2", "CE4"], ["PE3", "CE3"]];
  return (
    <DiagramSvg h={250} label="CE1 at PE1; PE1-P1; RR1 hangs off P1; P1 to P2 and P3; P2-PE2 with CE2 and a spare CE4; P3-PE3 with CE3">
      <DRegion x={112} y={14} w={440} h={206} label="IS-IS + LDP core" color={D.mpls} />
      {l.map(([a, b]) => (
        <DLink key={a + b} x1={n[a][0]} y1={n[a][1]} x2={n[b][0]} y2={n[b][1]} color={a === "PE2" && b === "CE4" ? D.faint : a.startsWith("CE") || b.startsWith("CE") ? D.line : b === "RR1" ? D.bgp : D.mpls} dashed={a === "PE2" && b === "CE4"} />
      ))}
      {Object.entries(n).map(([id, [x, y, sub, c]]) => (
        <DNode key={id} x={x} y={y} label={id} sub={sub} accent={c} w={id.startsWith("CE") ? 84 : 92} />
      ))}
      <text x={320} y={244} textAnchor="middle" fill={D.muted} fontSize={10}>
        iBGP L2VPN VPLS: each PE ↔ RR1 · RT 65000:100 · CE4 cabled to PE2, not yet in the VPLS
      </text>
    </DiagramSvg>
  );
}

function ArchDiagram() {
  return (
    <DiagramSvg h={216} label="PEs run VSIs; BGP through a route reflector distributes VPLS NLRI; pseudowires form automatically between members">
      <DNode x={320} y={36} label="RR" sub="MP-BGP L2VPN/VPLS" accent={D.bgp} w={150} />
      {[110, 320, 530].map((x, i) => (
        <g key={x}>
          <DArrow x1={x} y1={128} x2={320 + (x - 320) * 0.3} y2={62} color={D.bgp} both />
          <DNode x={x} y={150} label={`PE${i + 1}`} sub="VSI" accent={D.mpls} w={100} />
        </g>
      ))}
      <path d="M160 170 Q320 210 480 170" fill="none" stroke={D.violet} strokeWidth={2} strokeDasharray="5 4" />
      <text x={320} y={208} textAnchor="middle" fill={D.violet} fontSize={10} fontWeight={700}>
        pseudowires derived from the NLRI (data plane)
      </text>
    </DiagramSvg>
  );
}

function NlriBytes() {
  const cells: [string, string, number, string][] = [
    ["Length", "2 B", 60, D.faint],
    ["RD", "8 B", 140, D.bgp],
    ["VE ID", "2 B", 80, D.violet],
    ["VE Block Offset", "2 B", 110, D.mpls],
    ["VE Block Size", "2 B", 100, D.mpls],
    ["Label Base", "3 B", 100, D.mpls],
  ];
  let x = 20;
  return (
    <DiagramSvg h={110} label="VPLS NLRI: length 2 bytes, RD 8, VE ID 2, VE block offset 2, VE block size 2, label base 3">
      {cells.map(([n, b, w, c]) => {
        const g = (
          <g key={n}>
            <rect x={x} y={20} width={w - 4} height={46} rx={6} fill={c} fillOpacity={0.14} stroke={c} />
            <text x={x + (w - 4) / 2} y={40} textAnchor="middle" fill={c} fontSize={10} fontWeight={700}>
              {n}
            </text>
            <text x={x + (w - 4) / 2} y={57} textAnchor="middle" fill={D.muted} fontSize={9.5}>
              {b}
            </text>
          </g>
        );
        x += w;
        return g;
      })}
      <text x={320} y={96} textAnchor="middle" fill={D.muted} fontSize={10}>
        AFI 25 (L2VPN) / SAFI 65 (VPLS) · the label base is a 20-bit label in a 3-byte field
      </text>
    </DiagramSvg>
  );
}

function MultiBlock() {
  return (
    <DiagramSvg h={170} label="PE1's first block VBO 1 base 24000 covers VE 1 to 10; its second block VBO 11 base 24100 covers VE 11 to 20; PE3 with VE ID 12 uses 24101">
      <text x={20} y={30} fill={D.mpls} fontSize={10.5} fontWeight={700}>
        block A: VBO 1, VBS 10, base 24000
      </text>
      {[1, 2, 3, 4].map((ve, i) => (
        <g key={ve}>
          <rect x={250 + i * 90} y={14} width={84} height={26} rx={6} fill={D.mpls} fillOpacity={0.1} stroke={D.mpls} />
          <text x={292 + i * 90} y={31} textAnchor="middle" fill={D.text} fontSize={9.5}>
            VE {ve} → {24000 + ve - 1}
          </text>
        </g>
      ))}
      <text x={20} y={80} fill={D.warning} fontSize={10.5} fontWeight={700}>
        block B: VBO 11, VBS 10, base 24100
      </text>
      {[11, 12, 13, 14].map((ve, i) => (
        <g key={ve}>
          <rect x={250 + i * 90} y={64} width={84} height={26} rx={6} fill={ve === 12 ? D.success : D.warning} fillOpacity={ve === 12 ? 0.25 : 0.1} stroke={ve === 12 ? D.success : D.warning} />
          <text x={292 + i * 90} y={81} textAnchor="middle" fill={D.text} fontSize={9.5}>
            VE {ve} → {24100 + ve - 11}
          </text>
        </g>
      ))}
      <text x={320} y={130} textAnchor="middle" fill={D.text} fontSize={10.5}>
        PE3 renumbered to VE 12 → it sends to PE1 with 24100 + 12 − 11 = 24101
      </text>
      <text x={320} y={152} textAnchor="middle" fill={D.muted} fontSize={10}>
        IOS XR numbering (first four slots of each block shown); Junos uses blocks of 8: offsets 1, 9, 17…
      </text>
    </DiagramSvg>
  );
}

function SequenceDiagram() {
  const st: [string, string][] = [
    ["configure", D.violet],
    ["UPDATE → RR", D.bgp],
    ["reflect to clients", D.bgp],
    ["RT import", D.warning],
    ["compute label", D.mpls],
    ["PW up both ways", D.success],
  ];
  return (
    <DiagramSvg h={100} label="Configure, advertise, reflect, import, compute label, pseudowire up">
      {st.map(([s, c], i) => (
        <g key={s}>
          <DPill x={54 + i * 106} y={40} text={s} color={c} w={100} />
          {i < st.length - 1 && <DArrow x1={104 + i * 106} y1={40} x2={110 + i * 106} y2={40} color={D.faint} width={1.4} />}
        </g>
      ))}
      <text x={54} y={66} textAnchor="middle" fill={D.muted} fontSize={9}>
        RD · RT · VE · block
      </text>
      <text x={320} y={90} textAnchor="middle" fill={D.muted} fontSize={10}>
        no per-pair session and no separate label exchange: discovery and signaling are the same message
      </text>
    </DiagramSvg>
  );
}

function MacPlaneDiagram() {
  const row = (y: number, name: string, c: string, learn: string, ctrl: string) => (
    <g>
      <text x={20} y={y + 5} fill={c} fontSize={11} fontWeight={700}>
        {name}
      </text>
      <DPill x={270} y={y} text={ctrl} color={D.bgp} w={220} />
      <DPill x={510} y={y} text={learn} color={D.success} w={200} />
    </g>
  );
  return (
    <DiagramSvg h={170} label="LDP-VPLS: LDP signals PWs, MACs learned in data plane. BGP-VPLS: BGP signals PWs, MACs learned in data plane. EVPN: BGP carries MAC/IP routes">
      <text x={270} y={20} textAnchor="middle" fill={D.muted} fontSize={10} fontWeight={700}>
        what the control plane carries
      </text>
      <text x={510} y={20} textAnchor="middle" fill={D.muted} fontSize={10} fontWeight={700}>
        where remote MACs come from
      </text>
      {row(50, "LDP-VPLS", D.violet, "data plane (flood & learn)", "targeted LDP: PW labels")}
      {row(95, "BGP-VPLS", D.bgp, "data plane (flood & learn)", "BGP: membership + label blocks")}
      {row(140, "EVPN", D.success, "control plane (Type 2 routes)", "BGP: MAC/IP + more")}
    </DiagramSvg>
  );
}

function WithdrawDiagram() {
  return (
    <DiagramSvg h={150} label="PE3 sends a withdraw; RR reflects it; PE1 and PE2 remove PE3's membership and PWs while PE1 to PE2 keeps working">
      <DNode x={90} y={70} label="PE3" accent={D.danger} w={80} />
      <DNode x={300} y={70} label="RR" accent={D.bgp} w={70} />
      <DNode x={520} y={35} label="PE1" accent={D.mpls} w={80} />
      <DNode x={520} y={110} label="PE2" accent={D.mpls} w={80} />
      <DArrow x1={132} y1={70} x2={262} y2={70} color={D.danger} label="WITHDRAW" />
      <DArrow x1={337} y1={62} x2={478} y2={38} color={D.danger} />
      <DArrow x1={337} y1={78} x2={478} y2={106} color={D.danger} />
      <text x={600} y={78} textAnchor="end" fill={D.success} fontSize={9.5}>
        PE1 ↔ PE2 unaffected
      </text>
      <text x={320} y={142} textAnchor="middle" fill={D.muted} fontSize={10}>
        membership and PW state follow the BGP route: no route, no PW
      </text>
    </DiagramSvg>
  );
}

const QUIZ: KnowledgeQuestion[] = [
  {
    id: "q-rd-rt",
    prompt: "PE3's VPLS route reaches PE1 with RD 65000:3 and RT 65000:999. PE1 imports 65000:100. What happens?",
    options: [
      { id: "a", label: "PE1 receives the route but doesn't import it — no pseudowire to PE3" },
      { id: "b", label: "PE1 imports it because the RD is from the same AS" },
      { id: "c", label: "RR1 refuses to reflect it" },
    ],
    correctId: "a",
    explanation: "The RT is the membership test. The RD only makes the route unique; RR1 reflects regardless of RT.",
  },
  {
    id: "q-label",
    prompt: "PE3's block has base 26000 and offset 1. Which label does PE2 (VE 2) push toward PE3?",
    options: [
      { id: "a", label: "26001" },
      { id: "b", label: "26002" },
      { id: "c", label: "25002" },
    ],
    correctId: "a",
    explanation: "Receiver's base + sender's VE ID − offset = 26000 + 2 − 1.",
  },
  {
    id: "q-block",
    prompt: "IOS XR, default block size. PE3 moves to VE ID 12. What do PE1 and PE2 do?",
    options: [
      { id: "a", label: "Each advertises a second block at offset 11, so PE3 has a slot" },
      { id: "b", label: "Nothing; the pseudowires to PE3 stay down until someone raises ve-range" },
      { id: "c", label: "They renumber themselves" },
    ],
    correctId: "a",
    explanation: "A PE that imports a VE ID beyond its blocks advertises another block. No configuration is needed.",
  },
  {
    id: "q-collision",
    prompt: "PE1 and PE3 both use VE ID 1. What does PE2 do?",
    options: [
      { id: "a", label: "Uses the one with the lower loopback (PE1) and ignores PE3" },
      { id: "b", label: "Brings up both pseudowires" },
      { id: "c", label: "Brings up neither" },
    ],
    correctId: "a",
    explanation: "Two routes for the same VE ID: one is designated, by the lowest next hop. PE1 and PE3 themselves see a collision.",
  },
  {
    id: "q-family",
    prompt: "PE2's session to RR1 is Established, but PE2 has received no VPLS routes. First suspect?",
    options: [
      { id: "a", label: "The L2VPN VPLS address family isn't negotiated on that session" },
      { id: "b", label: "The route target" },
      { id: "c", label: "The VE ID" },
    ],
    correctId: "a",
    explanation: "A wrong RT still shows routes received (just not imported). Zero received means no family.",
  },
  {
    id: "q-rr",
    prompt: "RR1 holds all three VPLS routes; no PE holds any other PE's route. What is missing?",
    options: [
      { id: "a", label: "The PEs aren't route-reflector clients" },
      { id: "b", label: "A full iBGP mesh between the PEs" },
      { id: "c", label: "LDP on RR1" },
    ],
    correctId: "a",
    explanation: "Without clients RR1 follows the plain iBGP rule: never pass an iBGP route to another iBGP peer.",
  },
  {
    id: "q-mac",
    prompt: "Where does PE1 learn CE3's MAC address in BGP VPLS?",
    options: [
      { id: "a", label: "From CE3's frames arriving on the pseudowire from PE3" },
      { id: "b", label: "From PE3's BGP route" },
      { id: "c", label: "From RR1" },
    ],
    correctId: "a",
    explanation: "BGP carries membership and labels only; MACs are learned from traffic, as in LDP VPLS.",
  },
  {
    id: "q-rr-data",
    prompt: "RR1 loses power. What happens to customer traffic between sites that are already up?",
    options: [
      { id: "a", label: "Once the BGP sessions time out the routes are withdrawn and the pseudowires go down — unless there is a second RR" },
      { id: "b", label: "Nothing ever: RR1 isn't in the data path" },
      { id: "c", label: "Traffic is rerouted through P1" },
    ],
    correctId: "a",
    explanation: "RR1 isn't in the data path, but the pseudowires exist only while the routes do. Production designs use two RRs.",
  },
];

export function BgpVplsDeepDiveContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="bd-what" eyebrow="Foundation" title="Why BGP for VPLS" tone="bgp">
        <p>LDP-signaled VPLS (RFC 4762) has no discovery: every PE is configured with every other PE, and every pair runs its own targeted LDP session. That is N(N−1)/2 sessions and as many configuration lines on each PE, touched every time a site is added. <b className="text-pv-text">BGP VPLS</b> (RFC 4761) uses the protocol providers already run between PEs. A PE advertises its membership once; route reflectors distribute it; every member finds every other member and derives its labels from the same message.</p>
        <CompareCards
          items={[
            { title: "Auto-discovery", tone: "bgp", tag: "who", points: ["one route per PE per VPLS", "members = routes carrying your RT"] },
            { title: "Signaling", tone: "mpls", tag: "which labels", points: ["label blocks indexed by VE ID", "no per-pair exchange"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="bd-network" eyebrow="Foundation" title="The network you will study" tone="cyan">
        <DiagramFrame caption="The lab's network: three PEs, three P routers, a route reflector in the control plane only.">
          <LabNet />
        </DiagramFrame>
        <FieldTable
          title="Identity"
          accent="violet"
          columns={["PE", "RD", "VE ID", "IOS XR block (base)", "Junos block (base)"]}
          rows={[
            ["PE1 · 1.1.1.1", <Mono key="1">65000:1</Mono>, "1", <Mono key="2">24000</Mono>, <Mono key="3">262145</Mono>],
            ["PE2 · 2.2.2.2", <Mono key="4">65000:2</Mono>, "2", <Mono key="5">25000</Mono>, <Mono key="6">262401</Mono>],
            ["PE3 · 3.3.3.3", <Mono key="7">65000:3</Mono>, "3", <Mono key="8">26000</Mono>, <Mono key="9">262657</Mono>],
          ]}
        />
      </GuideSection>

      <GuideSection id="bd-arch" eyebrow="Architecture" title="RFC 4761 at a glance" tone="bgp">
        <DiagramFrame caption="Each PE talks BGP to the reflector; the pseudowires follow from the routes.">
          <ArchDiagram />
        </DiagramFrame>
        <p>Every PE runs a VSI (bridge domain / VPLS instance) per customer VPLS, exactly as in LDP VPLS. What is new is where its pseudowires come from: from the VPLS routes it imports.</p>
      </GuideSection>

      <GuideSection id="bd-planes" eyebrow="Architecture" title="What changed, what didn't" tone="violet">
        <CompareCards
          items={[
            { title: "Control plane", tone: "bgp", tag: "BGP took over", points: ["MP-BGP sessions to the RR", "discovery by RT import", "labels from label blocks", "withdrawal removes membership"] },
            { title: "Data plane", tone: "success", tag: "unchanged", points: ["source-MAC learning", "flooding of BUM", "mesh split horizon", "PW label over transport label"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="bd-nlri" eyebrow="Encoding" title="The VPLS NLRI on the wire" tone="bgp">
        <DiagramFrame caption="Seventeen bytes after the length field; one route per label block.">
          <NlriBytes />
        </DiagramFrame>
        <p>IOS XR prints a VPLS route as <Mono>VE-ID:VBO/32</Mono> under its RD; Junos prints <Mono>RD:VE-ID:VBO/96</Mono>.</p>
        <CliPair cisco={bvOnly(BV_HEALTHY, "RR1", "cisco", "show bgp l2vpn vpls", /Network|Route Distinguisher|\*>/)} junos={bvOnly(BV_HEALTHY_JN, "RR1", "juniper", "show route table bgp.l2vpn.0", /^bgp|^65000/)} ciscoCaption="IOS XR · RR1 — three routes, 1:1, 2:1, 3:1 under three RDs" junosCaption="Junos · RR1 — the same three routes" />
      </GuideSection>

      <GuideSection id="bd-ext" eyebrow="Encoding" title="Route target and layer-2 info" tone="violet">
        <FieldTable
          title="Extended communities attached to the route"
          accent="violet"
          columns={["Community", "Carries", "Used for"]}
          rows={[
            ["Route target", "65000:100", "membership: import only matching routes"],
            ["Layer2 Info", "encapsulation (VPLS), control flags, MTU", "compatibility: the MTUs must match"],
          ]}
        />
        <CliPair cisco={bvOnly(BV_HEALTHY, "PE1", "cisco", "show bgp l2vpn vpls rd 65000:3 3:1/32", /entry|from|Extended|Originator|Block/)} junos={bvOnly(BV_HEALTHY_JN, "RR1", "juniper", "show route table bgp.l2vpn.0 detail", /65000:3:3:1|Communities|Label-base/)} ciscoCaption="IOS XR · PE1 — PE3's route as reflected: RT, MTU, originator, cluster list, block" junosCaption="Junos · RR1 — target, Layer2-info, label base and range" />
        <Callout tone="cyan" title="Control flags" icon="i">
          The Layer2 Info control flags (control word, sequencing) were later clarified by RFC 8614. This lab runs without a control word.
        </Callout>
      </GuideSection>

      <GuideSection id="bd-math" eyebrow="Signaling" title="Label blocks and the arithmetic" tone="mpls">
        <FlowSteps
          steps={[
            { title: "Receiver advertises", body: "Label base LB, offset VBO, size VBS.", tone: "mpls" },
            { title: "Sender checks coverage", body: "Its own VE ID V must satisfy VBO ≤ V < VBO + VBS.", tone: "warning" },
            { title: "Sender computes", body: <>label = LB + V − VBO, pushed as the inner label toward that receiver.</>, tone: "success" },
            { title: "Receiver demultiplexes", body: "The slot tells it which VSI, and which remote VE, the frame came from.", tone: "violet" },
          ]}
        />
        <CliPanel run={bvOnly(BV_HEALTHY, "PE1", "cisco", "show l2vpn bridge-domain detail", /PW: neighbor|VE-ID local|Label  /)} caption="IOS XR · PE1 — local label from its own block, remote from the neighbor's" />
      </GuideSection>

      <GuideSection id="bd-multi" eyebrow="Signaling" title="More than one block" tone="warning">
        <DiagramFrame caption="A VE ID beyond every block gets a new block — not a wider one.">
          <MultiBlock />
        </DiagramFrame>
        <p>The block size is fixed per PE (IOS XR <Mono>ve-range</Mono>, default 10, range 11–100 when set; Junos <Mono>label-block-size</Mono> 2, 4, 8 or 16, default 8). When a PE imports a VE ID outside its blocks, it allocates another block and advertises it as another route with the same RD and VE ID and a different offset.</p>
        <CliPair cisco={bvOnly(VE12, "RR1", "cisco", "show bgp l2vpn vpls", /Network|Route Distinguisher|\*>|Processed/)} junos={bvOnly(VE12_JN, "RR1", "juniper", "show route table bgp.l2vpn.0", /^bgp|^65000/)} ciscoCaption="IOS XR · RR1 after PE3 → VE 12 — PE1 and PE2 each add a block at offset 11" junosCaption="Junos · RR1 — the extra blocks at offset 9" />
        <PingResult s={VE12_PING} title="The lab: CE1 → CE3 after the renumbering" />
      </GuideSection>

      <GuideSection id="bd-collision" eyebrow="Signaling" title="VE ID collisions" tone="danger">
        <p>Two PEs advertising the same VE ID would claim the same slot in every block. Between themselves they detect a <b className="text-pv-text">collision</b> and bring nothing up (Junos marks it <Mono>SC</Mono>). A third PE that receives both picks one — the one with the lowest next hop — and treats the other as not designated (<Mono>RN</Mono>), so the PE left out sees that pseudowire held down from the far end (<Mono>RD</Mono>). The result: one site silently isolated.</p>
        <CliPair cisco={bvOnly(T.veid, "PE3", "cisco", "show l2vpn bridge-domain detail", /PW: neighbor|VE-ID local|Down reason/)} junos={bvOnly(T.veidJn, "PE3", "juniper", "show vpls connections", /Local site|rmt|Remote PE/)} ciscoCaption="IOS XR · PE3 with PE2's VE ID 2" junosCaption="Junos · PE3 — SC toward site 2" />
      </GuideSection>

      <GuideSection id="bd-rr" eyebrow="Discovery" title="Route reflection" tone="bgp">
        <p>Without a reflector, iBGP needs a full mesh — the same N² problem moved into BGP. With one, each PE has one session (two in production). The reflector applies the ordinary rules: a route from a client goes to all peers, a route from a non-client only to clients. It adds <Mono>ORIGINATOR_ID</Mono> and <Mono>CLUSTER_LIST</Mono>, keeps the next hop unchanged, never forwards a customer frame and needs no VSI. RT Constraint (RFC 4684) can further limit which VPLS routes a PE receives.</p>
        <CliPair cisco={bvOnly(BV_HEALTHY, "RR1", "cisco", "show running-config router bgp", /neighbor|address-family|route-reflector/)} junos={bvCli(BV_HEALTHY_JN, "RR1", "juniper", "show configuration protocols bgp")} ciscoCaption="IOS XR · RR1 — each PE a route-reflector client for l2vpn vpls-vpws" junosCaption="Junos · RR1 — cluster makes the group's neighbors clients" />
      </GuideSection>

      <GuideSection id="bd-seq" eyebrow="Discovery" title="From route to pseudowire" tone="success">
        <DiagramFrame caption="Membership and labels travel in the same UPDATE.">
          <SequenceDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="bd-withdraw" eyebrow="Discovery" title="Withdrawal and failure" tone="danger">
        <DiagramFrame caption="Leaving the VPLS is one BGP message.">
          <WithdrawDiagram />
        </DiagramFrame>
        <p>A session failure to the reflector withdraws everything learned over it, so a single-RR design needs redundancy. MAC entries learned on removed pseudowires are flushed locally.</p>
      </GuideSection>

      <GuideSection id="bd-config" eyebrow="Operations" title="Configuring it: IOS XR and Junos" tone="cyan">
        <CliPair cisco={bvOnly(BV_HEALTHY, "PE1", "cisco", "show running-config", /l2transport|encapsulation dot1q|^l2vpn|bridge group|bridge-domain|interface GigabitEthernet0\/0\/0\/1\.100$|vfi|vpn-id|autodiscovery|rd |route-target|signaling|ve-id/)} junos={bvCli(BV_HEALTHY_JN, "PE1", "juniper", "show configuration routing-instances")} ciscoCaption="IOS XR · PE1 — the attachment circuit and the bridge domain with BGP discovery and signaling" junosCaption="Junos · PE1 — the VPLS instance" />
        <CliPair cisco={bvOnly(BV_HEALTHY, "PE1", "cisco", "show running-config router bgp", /bgp|neighbor|remote-as|update-source|address-family/)} junos={bvCli(BV_HEALTHY_JN, "PE1", "juniper", "show configuration protocols bgp")} ciscoCaption="IOS XR · PE1 — the family on the session to RR1" junosCaption="Junos · PE1 — family l2vpn signaling" />
        <p className="text-sm text-pv-text-muted">On Junos the unit facing the CE uses <Mono>encapsulation vlan-vpls</Mono>, and <Mono>no-tunnel-services</Mono> makes the router use label-switched interfaces (lsi) instead of a tunnel PIC. Neither vendor needs targeted LDP or a neighbor list for BGP VPLS.</p>
      </GuideSection>

      <GuideSection id="bd-verify" eyebrow="Operations" title="How to verify" tone="success">
        <FieldTable
          title="The questions, and where the answers are"
          accent="success"
          columns={["Question", "IOS XR", "Junos"]}
          rows={[
            ["Sessions up, family negotiated, routes received?", <Mono key="1">show bgp l2vpn vpls summary</Mono>, <Mono key="2">show bgp summary</Mono>],
            ["Which routes, which RTs and blocks?", <Mono key="3">show bgp l2vpn vpls [rd … …]</Mono>, <Mono key="4">show route table bgp.l2vpn.0 detail</Mono>],
            ["Pseudowires up, VE IDs, labels?", <Mono key="5">show l2vpn bridge-domain detail</Mono>, <Mono key="6">show vpls connections</Mono>],
            ["Where is each MAC?", <Mono key="7">show l2vpn forwarding bridge-domain mac-address location 0/0/CPU0</Mono>, <Mono key="8">show vpls mac-table</Mono>],
            ["LSPs to the other PEs?", <Mono key="9">show mpls forwarding</Mono>, <Mono key="10">show route table inet.3</Mono>],
          ]}
        />
      </GuideSection>

      <GuideSection id="bd-signatures" eyebrow="Troubleshooting" title="Failure signatures" tone="danger">
        <FailureSignatures
          items={[
            { tag: "RT", title: "Wrong route target", tone: "danger", points: ["routes received, not imported", "that PE isolated"] },
            { tag: "AF", title: "Family not negotiated", tone: "danger", points: ["session Established", "zero VPLS routes"] },
            { tag: "RR", title: "No route-reflector clients", tone: "danger", points: ["RR holds all routes", "PEs receive none"] },
            { tag: "VE", title: "Duplicate VE ID", tone: "violet", points: ["collision / not designated", "one site isolated"] },
            { tag: "MTU", title: "Different MTU", tone: "warning", points: ["routes imported, labels computed", "that PE's pseudowires down"] },
            { tag: "LSP", title: "Transport broken", tone: "warning", points: ["XR: PWs up, drops in the core", "Junos: VC-Dn"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="bd-workflow" eyebrow="Troubleshooting" title="Investigation workflow" tone="danger">
        <TroubleshootingFlow
          steps={[
            { question: "Which pairs of sites fail?", look: "One site, one pair, or everything?" },
            { question: "Is each site's attachment circuit in the VPLS?", look: "VLAN and bridge membership on each PE." },
            { question: "Does every PE exchange L2VPN VPLS routes with the RR?", look: "Session state and routes received per neighbor." },
            { question: "Has every PE imported every other PE?", look: "Received vs imported; compare RTs; does the RR reflect?" },
            { question: "Is every pseudowire up?", look: "Unique VE IDs, MTUs, labels both ways." },
            { question: "Is the transport complete?", look: "Labels toward each PE loopback." },
          ]}
        />
      </GuideSection>

      <GuideSection id="bd-tickets" eyebrow="Troubleshooting" title="Five faults, evidence to proof" tone="danger">
        <p>The BGP VPLS Lab&apos;s five tickets, with the fault in place (IOS XR view unless noted).</p>
        <FailureWalk
          title="1 · Site 3 dropped out"
          normal="Every PE uses RT 65000:100."
          change="Last night's change gave PE3 route target 65000:999."
          evidence={<CliPanel run={bvOnly(T.rt, "RR1", "cisco", "show bgp l2vpn vpls rd 65000:3 3:1/32", /entry|Extended/)} caption="IOS XR · RR1 — PE3's route, RT 65000:999" />}
          next="PE1 and PE2 receive it and don't import it; PE3 doesn't import theirs."
          fix={<Mono>PE3: l2vpn → bridge group CUST-A → bridge-domain VPLS-A → vfi VPLS-A → autodiscovery bgp → route-target 65000:100 → commit</Mono>}
          proof="All six pseudowire ends up; a fresh ping from CE1 reaches CE3."
        />
        <FailureWalk
          title="2 · PE2 stopped discovering"
          normal="Each PE activates the L2VPN VPLS family toward RR1."
          change="PE2's regenerated BGP configuration left the family out."
          evidence={<CliPanel run={bvOnly(T.family, "PE2", "cisco", "show bgp l2vpn vpls summary", /Neighbor  |^9\.9\.9\.9/)} caption="IOS XR · PE2 — Established, 0 routes" />}
          next="RR1 holds only PE1's and PE3's routes; PE2 neither sends nor receives."
          fix={<Mono>PE2: router bgp 65000 → neighbor 9.9.9.9 → address-family l2vpn vpls-vpws → commit</Mono>}
          proof="PE2 receives two routes; its pseudowires come up; a fresh ping from CE2 reaches CE1."
        />
        <FailureWalk
          title="3 · Every session up, nothing works"
          normal="Every PE is a route-reflector client of RR1."
          change="The replacement RR1 was configured without route-reflector-client (Junos: without cluster)."
          evidence={<CliPanel run={bvOnly(T.rr, "PE1", "cisco", "show bgp l2vpn vpls", /Route Distinguisher|\*>|Processed/)} caption="IOS XR · PE1 — only its own route" />}
          next="RR1 holds all three routes and, following the plain iBGP rule, gives them to nobody."
          fix={<Mono>RR1: router bgp 65000 → neighbor 1.1.1.1 / 2.2.2.2 / 3.3.3.3 → address-family l2vpn vpls-vpws → route-reflector-client → commit</Mono>}
          proof="Each PE holds three routes; the mesh is up; a fresh ping from CE1 reaches CE2."
        />
        <FailureWalk
          title="4 · A copy-paste at PE3"
          normal="VE IDs 1, 2 and 3."
          change="PE3 was provisioned from PE2's configuration and kept VE ID 2."
          evidence={<CliPanel run={bvOnly(T.veid, "PE3", "cisco", "show l2vpn bridge-domain detail", /PW: neighbor|VE-ID local|Down reason/)} caption="IOS XR · PE3 — collision with PE2, not designated at PE1" />}
          next="PE1 keeps PE2 (lower loopback) for VE 2; PE2 and PE3 collide."
          fix={<Mono>PE3: … autodiscovery bgp → signaling-protocol bgp → ve-id 3 → commit</Mono>}
          proof="Three distinct VE IDs; the mesh is up; a fresh ping from CE1 reaches CE3."
        />
        <FailureWalk
          title="5 · After the P1 upgrade"
          normal="LDP on every core link."
          change="P1's interface toward P3 lost LDP."
          evidence={<CliPair cisco={bvCli(T.transport, "P1", "cisco", "show mpls forwarding")} junos={bvOnly(T.transportJn, "PE1", "juniper", "show vpls connections", /Local site|rmt|Remote PE/)} ciscoCaption="IOS XR · P1 — 3.3.3.3 Unlabelled" junosCaption="Junos · PE1 — VC-Dn toward site 3" />}
          next="BGP is perfect; the frames to PE3 have no LSP."
          fix={<Mono>P1: mpls ldp → interface GigabitEthernet0/0/0/2 → commit</Mono>}
          proof="P1 swaps 24104 → 24306 again; a fresh ping from CE1 reaches CE3."
        />
      </GuideSection>

      <GuideSection id="bd-variant" eyebrow="Beyond this lesson" title="BGP auto-discovery with LDP signaling" tone="cyan">
        <p>A second standard combination keeps BGP only for discovery and signals the pseudowires with targeted LDP using the generalized PWid FEC (FEC 129) — RFC 6074. On IOS XR it is <Mono>signaling-protocol ldp</Mono> under <Mono>autodiscovery bgp</Mono>; on Junos, <Mono>instance-type vpls</Mono> with <Mono>l2vpn-id</Mono>. It keeps per-pair LDP sessions but removes the neighbor lists. This lesson models RFC 4761, BGP for both.</p>
      </GuideSection>

      <GuideSection id="bd-compare" eyebrow="Beyond this lesson" title="LDP VPLS, BGP VPLS, EVPN" tone="violet">
        <DiagramFrame caption="The key question: where does a PE learn remote customer MACs?">
          <MacPlaneDiagram />
        </DiagramFrame>
        <CompareCards
          items={[
            { title: "LDP VPLS → BGP VPLS", tone: "bgp", tag: "changes", points: ["discovery: manual → RT import", "signaling: per-pair LDP → label blocks", "data plane: unchanged"] },
            { title: "BGP VPLS → EVPN", tone: "success", tag: "changes", points: ["customer MAC/IP in BGP (type 2 routes)", "native multihoming (ESI, DF)", "a different address family"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="bd-myths" eyebrow="Master it" title="Common misconceptions" tone="warning">
        <Misconceptions
          items={[
            { myth: "BGP VPLS carries customer MACs in BGP.", correction: "That is EVPN. BGP VPLS carries membership and labels; MACs are learned from frames." },
            { myth: "An Established BGP session means VPLS routes flow.", correction: "Only if the L2VPN VPLS family is negotiated on it." },
            { myth: "The RD decides which PEs belong to the VPLS.", correction: "The RT does; the RD only keeps routes unique." },
            { myth: "The route reflector forwards customer frames.", correction: "It is control plane only; frames go PE to PE over the LSPs." },
            { myth: "A VE ID outside the block needs a bigger block configured.", correction: "PEs advertise an additional block on their own." },
            { myth: "Duplicate VE IDs just share the labels.", correction: "They collide: one site is isolated." },
          ]}
        />
      </GuideSection>

      <GuideSection id="bd-quiz" eyebrow="Master it" title="Knowledge check" tone="cyan">
        <KnowledgeQuiz questions={QUIZ} />
      </GuideSection>

      <GuideSection id="bd-explain" eyebrow="Master it" title="Can you explain it?" tone="violet">
        <ExplainIt
          items={[
            { q: "What two jobs does BGP take over from targeted LDP?", a: "Auto-discovery (which PEs are members — those whose routes carry my RT) and signaling (labels, derived from each PE's label block and VE ID)." },
            { q: "Why can PE3's session be Established while CE3 reaches nobody?", a: "The session says nothing about the routes: with a different RT, PE3's route is received but not imported, and PE3 doesn't import the others'." },
            { q: "How does PE2 know which neighbor a frame came from?", a: "Each sender picks a different slot in PE2's block — base + its own VE ID − offset — so each neighbor arrives on its own label." },
            { q: "What happens when a VE ID leaves every block?", a: "The other PEs import it and advertise an additional block covering it; labels for existing VE IDs don't change." },
            { q: "Why does RR1 need its PEs to be clients?", a: "Plain iBGP never passes a route learned from one iBGP peer to another; reflection to and from clients is the exception." },
          ]}
        />
      </GuideSection>

      <GuideSection id="bd-practice" eyebrow="Master it" title="Practice in the BGP VPLS Lab" tone="success">
        <p>Six Learn levels take you from &quot;the same LAN, built by BGP&quot; to reading the evidence; the engineering workspace gives you all seven routers (IOS XR or Junos), the BGP tables, label blocks, MAC tables, pings from four sites, five challenges and the five tickets above.</p>
        <LabBridge />
        <PresentationBridge>Rewatch the BGP VPLS presentation.</PresentationBridge>
      </GuideSection>
    </div>
  );
}
