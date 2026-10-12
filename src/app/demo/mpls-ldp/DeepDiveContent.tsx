import { Callout, CompareCards, DArrow, DIAGRAM as D, DLink, DNode, DPill, DiagramFrame, DiagramSvg, FailureSignatures, FieldTable, GuideSection, Misconceptions, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { DStack } from "@/components/lesson/MplsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { ExplainIt, KnowledgeQuiz, PracticeBridge, type KnowledgeQuestion } from "@/components/lesson/GuideInteractive";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import { PresentationBridge } from "@/components/presentation/LessonPresentation";
import { CliPair, CliPanel, FailureWalk, pickLines, runGuideCli } from "@/components/lesson/GuideCli";
import type { CliVendor } from "@/lib/cli/types";
import { createMpNet, mpApply, mpTicket, mpTicketState, type MpAction, type MpOs, type MpR, type MpState, type MpTicketId } from "@/lib/sim-engine/scenarios/mplsNet";
import { mpSets, mpStaticApi } from "./mpls-lab/mpCli";

const G = { foundation: "Foundation", label: "The label", ldp: "LDP", fwd: "Forwarding", igp: "LDP and the IGP", ops: "Operations", trouble: "Troubleshooting", beyond: "Beyond this lesson", master: "Master it" };
export const LDP_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "ld-why", label: "Why providers run MPLS", group: G.foundation },
  { id: "ld-terms", label: "LER, LSR, LSP, FEC", group: G.foundation },
  { id: "ld-network", label: "The core you will study", group: G.foundation },
  { id: "ld-shim", label: "The shim header, bit by bit", group: G.label },
  { id: "ld-stack", label: "Label stacks and the S bit", group: G.label },
  { id: "ld-ops", label: "PUSH, SWAP, POP", group: G.label },
  { id: "ld-reserved", label: "Reserved labels", group: G.label },
  { id: "ld-ttl", label: "TTL inside the LSP", group: G.label },
  { id: "ld-discovery", label: "Discovery and transport addresses", group: G.ldp },
  { id: "ld-session", label: "The LDP session", group: G.ldp },
  { id: "ld-modes", label: "Advertisement, control, retention", group: G.ldp },
  { id: "ld-what", label: "Which FECs get labels", group: G.ldp },
  { id: "ld-tables", label: "LIB, LFIB and the ingress", group: G.fwd },
  { id: "ld-null", label: "Implicit and explicit null", group: G.fwd },
  { id: "ld-recursion", label: "BGP next hops and the LSP", group: G.fwd },
  { id: "ld-mtu", label: "MTU: room for labels", group: G.fwd },
  { id: "ld-igp", label: "LDP follows the IGP", group: G.igp },
  { id: "ld-sync", label: "LDP–IGP synchronization", group: G.igp },
  { id: "ld-config", label: "Configuring it: IOS XR and Junos", group: G.ops },
  { id: "ld-verify", label: "How to verify", group: G.ops },
  { id: "ld-normal", label: "What healthy looks like", group: G.ops },
  { id: "ld-lspping", label: "LSP ping and traceroute", group: G.trouble },
  { id: "ld-signatures", label: "Failure signatures", group: G.trouble },
  { id: "ld-workflow", label: "Investigation workflow", group: G.trouble },
  { id: "ld-tickets", label: "Five faults, evidence to proof", group: G.trouble },
  { id: "ld-beyond", label: "Where labels go next", group: G.beyond },
  { id: "ld-myths", label: "Common misconceptions", group: G.master },
  { id: "ld-quiz", label: "Knowledge check", group: G.master },
  { id: "ld-explain", label: "Can you explain it?", group: G.master },
  { id: "ld-practice", label: "Practice in the MPLS + LDP Lab", group: G.master },
];

// Real CLI output: the MPLS + LDP Lab's own command sets run against the lab's model (six routers, two paths).
const cli = (s: MpState, r: MpR, vendor: CliVendor, command: string) => runGuideCli(mpSets(mpStaticApi(s, r), r)[vendor], command);
const only = (s: MpState, r: MpR, vendor: CliVendor, command: string, match: RegExp, keep = 0) => {
  const x = cli(s, r, vendor, command);
  return { ...x, output: pickLines(x.output, match, keep) };
};
const apply = (s: MpState, as: MpAction[]) => as.reduce((acc, a) => mpApply(acc, a), s);
const WARM = createMpNet();
const WARM_JN = createMpNet(0, "junos");
const ticket = (id: MpTicketId, os: MpOs = "xr") => apply(mpTicketState(id, 1, os), mpTicket(id).repro);
const T = { ldpif: ticket("ldpif"), transport: ticket("transport"), mtu: ticket("mtu"), oneway: ticket("oneway"), backup: ticket("backup") };
const FAILED = mpApply(WARM, { type: "link", link: "P1-P2", up: false });

function LabCore() {
  return (
    <DiagramSvg h={230} label="CE1 to PE1; PE1 to P1 to P2 to PE2 (metric 10 each); PE1 to P3 to P4 to PE2 (metric 20 each); PE2 to CE2; P1–P3 rung without IS-IS or LDP">
      <DLink x1={60} y1={115} x2={150} y2={115} />
      <DLink x1={150} y1={115} x2={260} y2={40} label="10" />
      <DLink x1={260} y1={40} x2={400} y2={40} label="10" />
      <DLink x1={400} y1={40} x2={500} y2={115} label="10" />
      <DLink x1={150} y1={115} x2={260} y2={190} label="20" labelDy={16} />
      <DLink x1={260} y1={190} x2={400} y2={190} label="20" labelDy={16} />
      <DLink x1={400} y1={190} x2={500} y2={115} label="20" labelDy={16} />
      <DLink x1={500} y1={115} x2={590} y2={115} />
      <DLink x1={260} y1={62} x2={260} y2={168} dashed label="rung" />
      <DNode x={50} y={115} label="CE1" sub="10.1.1.10" accent={D.ip} w={74} />
      <DNode x={150} y={115} label="PE1" sub="1.1.1.1" accent={D.success} w={74} />
      <DNode x={260} y={40} label="P1" sub="2.2.2.2" accent={D.mpls} w={74} />
      <DNode x={400} y={40} label="P2" sub="3.3.3.3" accent={D.mpls} w={74} />
      <DNode x={500} y={115} label="PE2" sub="4.4.4.4" accent={D.success} w={74} />
      <DNode x={590} y={115} label="CE2" sub="10.2.2.20" accent={D.ip} w={74} />
      <DNode x={260} y={190} label="P3" sub="5.5.5.5" accent={D.mpls} w={74} />
      <DNode x={400} y={190} label="P4" sub="6.6.6.6" accent={D.mpls} w={74} />
    </DiagramSvg>
  );
}
function LabBridge() {
  const openLab = usePracticeLabOpener();
  return (
    <PracticeBridge label="Open the MPLS + LDP Lab" onPractice={openLab}>
      The core from this page, IOS XR or Junos, your own copy. Nothing you do there changes your lesson progress.
    </PracticeBridge>
  );
}

function ShimBitsDiagram() {
  const scale = 17.5;
  const fields: [string, number, string][] = [
    ["Label (20)", 20, D.mpls],
    ["TC (3)", 3, D.warning],
    ["S", 1, D.success],
    ["TTL (8)", 8, D.cyan],
  ];
  let x = 40;
  return (
    <DiagramSvg h={110} label="MPLS shim: 20-bit label, 3-bit traffic class, 1-bit bottom of stack, 8-bit TTL">
      {fields.map(([name, bits, c]) => {
        const w = bits * scale;
        const g = (
          <g key={name}>
            <rect x={x} y={30} width={w} height={34} fill={c} fillOpacity={0.16} stroke={c} />
            <text x={x + w / 2} y={52} textAnchor="middle" fill={c} fontSize={bits > 1 ? 11 : 10} fontWeight={700}>
              {name}
            </text>
          </g>
        );
        x += w;
        return g;
      })}
      <text x={40} y={22} fill={D.muted} fontSize={9.5}>
        bit 0
      </text>
      <text x={600} y={22} textAnchor="end" fill={D.muted} fontSize={9.5}>
        bit 31
      </text>
      <text x={320} y={92} textAnchor="middle" fill={D.muted} fontSize={10}>
        4 bytes per label, inserted between the Layer 2 header and the IP header
      </text>
    </DiagramSvg>
  );
}

function StackDiagram() {
  return (
    <DiagramSvg h={170} label="Three example stacks: one label with S=1; two labels with only the bottom S=1; three labels with only the bottom S=1">
      <DStack x={130} y={40} labels={[{ text: "102 S1", tag: "only" }]} caption="one label" />
      <DStack x={330} y={40} labels={[{ text: "102 S0", tag: "outer" }, { text: "24002 S1", tag: "bottom" }]} caption="two labels" />
      <DStack x={530} y={20} labels={[{ text: "1000 S0", tag: "outer" }, { text: "300 S0", tag: "middle" }, { text: "24002 S1", tag: "bottom" }]} caption="three labels" />
    </DiagramSvg>
  );
}

function OpsDiagram() {
  const row = (y: number, op: string, c: string, before: string[], after: string[], note: string) => (
    <g>
      <DPill x={60} y={y + 20} text={op} color={c} w={80} />
      <DStack x={200} y={y} labels={before.map((t) => ({ text: t }))} w={90} />
      <DArrow x1={256} y1={y + 20} x2={330} y2={y + 20} color={c} />
      <DStack x={390} y={y} labels={after.map((t) => ({ text: t }))} w={90} />
      <text x={450} y={y + 24} fill={D.muted} fontSize={10}>
        {note}
      </text>
    </g>
  );
  return (
    <DiagramSvg h={230} label="PUSH adds a label on top, SWAP replaces the top label, POP removes the top label">
      {row(10, "PUSH", D.success, [], ["102 S1"], "new top label")}
      {row(80, "SWAP", D.warning, ["102 S1"], ["203 S1"], "top value changes, S kept")}
      {row(150, "POP", D.danger, ["203 S1"], [], "top removed, rest unchanged")}
    </DiagramSvg>
  );
}

function SessionDiagram() {
  const st: [string, string, string][] = [
    ["NON-EXISTENT", D.faint, "no TCP session"],
    ["INITIALIZED", D.violet, "TCP 646 up"],
    ["OPENSENT", D.violet, "Init sent (active)"],
    ["OPENREC", D.violet, "Init rcvd, KeepAlive sent"],
    ["OPERATIONAL", D.success, "KeepAlive received"],
  ];
  return (
    <DiagramSvg h={130} label="LDP session states: non-existent, initialized, opensent, openrec, operational">
      {st.map(([s, c, note], i) => (
        <g key={s}>
          <DPill x={68 + i * 126} y={40} text={s} color={c} w={112} />
          {i < st.length - 1 && <DArrow x1={125 + i * 126} y1={40} x2={137 + i * 126} y2={40} color={D.faint} width={1.6} />}
          <text x={68 + i * 126} y={72} textAnchor="middle" fill={D.muted} fontSize={9}>
            {note}
          </text>
        </g>
      ))}
      <text x={320} y={110} textAnchor="middle" fill={D.muted} fontSize={10}>
        simplified from RFC 5036 (the passive side skips OPENSENT) · only OPERATIONAL sessions exchange Label Mappings
      </text>
    </DiagramSvg>
  );
}

function RetentionDiagram() {
  return (
    <DiagramSvg h={200} label="R1 hears labels for the same FEC from R2 and R3; the LIB keeps both, the LFIB uses only the IGP next hop's">
      <DNode x={110} y={100} label="R1" sub="LIB: 17 (R2), 25 (R3)" accent={D.mpls} w={150} />
      <DNode x={470} y={45} label="R2" sub="IGP next hop" accent={D.success} w={120} />
      <DNode x={470} y={138} label="R3" sub="not next hop" accent={D.faint} w={120} />
      <DArrow x1={410} y1={52} x2={188} y2={90} color={D.success} label="label 17" labelDy={-6} />
      <DArrow x1={410} y1={132} x2={188} y2={110} color={D.faint} label="label 25" labelDy={16} />
      <DPill x={300} y={186} text="LFIB: out label 17 via R2 · 25 kept for fast failover (liberal retention)" color={D.mpls} w={470} />
    </DiagramSvg>
  );
}

function NullDiagram() {
  return (
    <DiagramSvg h={150} label="Implicit null: the penultimate hop pops. Explicit null: a label 0 stays on so the egress still sees the TC bits">
      <text x={20} y={30} fill={D.mpls} fontSize={10.5} fontWeight={700}>
        implicit-null (3)
      </text>
      <DNode x={200} y={52} label="P" sub="POP" accent={D.mpls} w={80} />
      <DArrow x1={242} y1={52} x2={380} y2={52} color={D.mpls} />
      <DPill x={311} y={34} text="IP" color={D.ip} />
      <DNode x={422} y={52} label="egress PE" accent={D.mpls} w={90} />
      <text x={20} y={100} fill={D.warning} fontSize={10.5} fontWeight={700}>
        explicit-null (0)
      </text>
      <DNode x={200} y={122} label="P" sub="SWAP → 0" accent={D.mpls} w={80} />
      <DArrow x1={242} y1={122} x2={380} y2={122} color={D.warning} />
      <DPill x={311} y={104} text="0 + IP" color={D.warning} />
      <DNode x={422} y={122} label="egress PE" accent={D.mpls} w={90} />
      <text x={475} y={126} fill={D.muted} fontSize={9.5}>
        still sees the TC bits
      </text>
    </DiagramSvg>
  );
}


const QUIZ: KnowledgeQuestion[] = [
  {
    id: "q-local",
    prompt: "P1 advertises label 24102 for 4.4.4.4/32 and P3 advertises 24405 for the same FEC. Is that a conflict?",
    options: [
      { id: "a", label: "No — labels are local: each router chooses the label it wants to receive" },
      { id: "b", label: "Yes — a FEC must have one label in the whole network" },
      { id: "c", label: "Only if both are next hops of PE1" },
    ],
    correctId: "a",
    explanation: "A label only means something to the router that allocated it. PE1 pushes 24102 when sending to P1 and 24405 when sending to P3.",
  },
  {
    id: "q-disc",
    prompt: "P1 lists P2 as a discovery source, but there is no LDP session. What is the most likely cause?",
    options: [
      { id: "a", label: "P1 has no route to P2's transport address (its loopback)" },
      { id: "b", label: "P2 isn't sending Hellos" },
      { id: "c", label: "The labels are in conflict" },
    ],
    correctId: "a",
    explanation: "Discovery proves Hellos arrive on the link. The session is TCP to the transport address, which needs an IGP route.",
  },
  {
    id: "q-unlab",
    prompt: "On IOS XR, P1's LFIB shows 'Unlabelled' toward P2 for 4.4.4.4/32. What happens to a labeled customer packet?",
    options: [
      { id: "a", label: "P1 removes the label and sends plain IP to P2, which drops it if it has no route for the customer address" },
      { id: "b", label: "P1 drops it immediately" },
      { id: "c", label: "P1 sends it to P3 instead" },
    ],
    correctId: "a",
    explanation: "Unlabelled means 'no downstream label': the packet continues as IP. In a BGP-free core the next router can't route the customer address.",
  },
  {
    id: "q-ordered",
    prompt: "The same broken session on Junos (ordered control). Where is the customer packet dropped?",
    options: [
      { id: "a", label: "At PE1: no LDP route to the BGP next hop in inet.3, so the BGP route is hidden" },
      { id: "b", label: "At P2, exactly like IOS XR" },
      { id: "c", label: "At PE2" },
    ],
    correctId: "a",
    explanation: "With ordered control no label reaches PE1 without a complete chain from the egress. Junos resolves BGP next hops through inet.3 only, so PE1 has no usable route.",
  },
  {
    id: "q-php",
    prompt: "Why does PE2 advertise implicit-null for its own loopback?",
    options: [
      { id: "a", label: "So P2 pops the label and PE2 does a single IP lookup" },
      { id: "b", label: "Because PE2 has no labels left" },
      { id: "c", label: "To hide its loopback from the core" },
    ],
    correctId: "a",
    explanation: "Penultimate-hop popping saves the egress a label lookup that would only say 'this is for you'.",
  },
  {
    id: "q-mtu",
    prompt: "100-byte customer pings work, 1500-byte pings with DF set fail. What do you check first?",
    options: [
      { id: "a", label: "The MTU of every core link — a label adds 4 bytes" },
      { id: "b", label: "The LDP sessions" },
      { id: "c", label: "The BGP routes" },
    ],
    correctId: "a",
    explanation: "A session or route problem would break small packets too. Size-dependent loss in an MPLS core points at MTU.",
  },
];

export function LdpDeepDiveContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="ld-why" eyebrow="Foundation" title="Why providers run MPLS" tone="mpls">
        <p>
          MPLS is often explained as &quot;faster than IP lookups&quot;. On modern hardware that isn&apos;t the point. Providers run MPLS because a label lets the <b className="text-pv-text">edge decide once</b> and the core simply follow: the core no longer needs customer routes (a BGP-free core), and the same label machinery carries VPNs, traffic-engineered paths and fast reroute in the lessons ahead.
        </p>
        <CompareCards
          items={[
            { title: "Plain IP core", tone: "cyan", tag: "every hop decides", points: ["every core router needs every customer route", "every routing change in any customer reaches the core"] },
            { title: "MPLS core", tone: "violet", tag: "edge decides", points: ["only PEs know customer routes (BGP)", "the core forwards on labels toward PE loopbacks (IGP + LDP)"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="ld-terms" eyebrow="Foundation" title="LER, LSR, LSP, FEC" tone="mpls">
        <FieldTable
          title="The vocabulary"
          accent="mpls"
          columns={["Term", "Meaning", "In this core"]}
          rows={[
            ["FEC", "packets forwarded the same way", "everything whose BGP next hop is 4.4.4.4 → FEC 4.4.4.4/32"],
            ["LSP", "the one-way labeled path for one FEC", "PE1 → P1 → P2 → PE2 for 4.4.4.4/32"],
            ["LER", "label edge router: pushes or pops at the edge", "PE1 and PE2"],
            ["LSR", "label switching router: swaps", "P1–P4"],
            ["Upstream / downstream", "toward the ingress / toward the egress", "P1 is upstream of P2 for 4.4.4.4"],
          ]}
        />
      </GuideSection>

      <GuideSection id="ld-network" eyebrow="Foundation" title="The core you will study" tone="cyan">
        <DiagramFrame caption="The lab's core: the lesson's routers plus P3 and P4 as a higher-metric backup path. IS-IS Level 2, LDP on every core link except the P1–P3 rung.">
          <LabCore />
        </DiagramFrame>
        <p className="text-sm text-pv-text-muted">Every CLI sample below is printed by the lab&apos;s own IOS XR and Junos command sets. IOS XR samples use XR labels (24000 and up), Junos samples Junos labels (299776 and up) — and Junos label control is ordered, so some samples differ by more than the numbers.</p>
      </GuideSection>

      <GuideSection id="ld-shim" eyebrow="The label" title="The shim header, bit by bit" tone="violet">
        <DiagramFrame caption="Four bytes between the Layer-2 header (EtherType 0x8847) and the IP packet.">
          <ShimBitsDiagram />
        </DiagramFrame>
        <p>The label (20 bits) is all an LSR looks at. TC (3 bits) carries a QoS class; S marks the bottom of the stack; TTL counts down hop by hop like the IP TTL and protects against loops inside the LSP.</p>
      </GuideSection>

      <GuideSection id="ld-stack" eyebrow="The label" title="Label stacks and the S bit" tone="violet">
        <DiagramFrame caption="Only the bottom label has S = 1; routers act on the top label.">
          <StackDiagram />
        </DiagramFrame>
        <p className="text-sm text-pv-text-muted">This lesson uses a single transport label. The L3VPN lesson adds a VPN label underneath it; traffic engineering and fast reroute add labels on top.</p>
      </GuideSection>

      <GuideSection id="ld-ops" eyebrow="The label" title="PUSH, SWAP, POP" tone="violet">
        <DiagramFrame caption="The three operations an MPLS router can perform on the top label.">
          <OpsDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="ld-reserved" eyebrow="The label" title="Reserved labels" tone="violet">
        <FieldTable
          title="Labels 0–15 are reserved"
          accent="violet"
          columns={["Label", "Name", "Use"]}
          rows={[
            ["0", "IPv4 explicit null", "the egress asked to receive a label; it pops it and routes IPv4"],
            ["1", "Router alert", "deliver to the control plane"],
            ["2", "IPv6 explicit null", "as 0, for IPv6"],
            ["3", "Implicit null", "never on the wire: a signal that means “pop before sending to me”"],
            ["7", "Entropy label indicator", "load-balancing entropy follows"],
            ["13", "OAM alert", "operations and maintenance"],
          ]}
        />
      </GuideSection>

      <GuideSection id="ld-ttl" eyebrow="The label" title="TTL inside the LSP" tone="violet">
        <p>By default the ingress copies the IP TTL (minus one) into the label, every LSR decrements the label TTL, and the router that pops copies it back into the IP header. That is why a traceroute through the core still shows every hop — and each hop can report the label it received.</p>
        <CliPair cisco={cli(WARM, "PE1", "cisco", "traceroute 10.2.2.20")} junos={cli(WARM_JN, "PE1", "juniper", "traceroute 10.2.2.20")} ciscoCaption="IOS XR · PE1" junosCaption="Junos · PE1" />
        <p className="text-sm text-pv-text-muted">Operators can hide the core from customer traceroutes by not propagating the TTL (IOS XR <Mono>mpls ip-ttl-propagate disable</Mono>, Junos <Mono>no-propagate-ttl</Mono>); the LSP then looks like a single hop.</p>
      </GuideSection>

      <GuideSection id="ld-discovery" eyebrow="LDP" title="Discovery and transport addresses" tone="mpls">
        <p>
          Every LDP interface multicasts Hellos (UDP 646, to 224.0.0.2, TTL 1) every 5 seconds with a 15-second hold time. A Hello carries the router&apos;s <b className="text-pv-text">LDP identifier</b> (router ID : label space, e.g. 2.2.2.2:0) and its <b className="text-pv-text">transport address</b> — the address it will use for the TCP session, normally its loopback.
        </p>
        <CliPanel run={cli(WARM, "P1", "cisco", "show mpls ldp discovery")} caption="IOS XR · P1 — Hellos sent and received on every LDP interface" />
        <CliPanel run={cli(WARM_JN, "P1", "juniper", "show ldp neighbor")} caption="Junos · P1 — Hello adjacencies (not yet sessions)" />
      </GuideSection>

      <GuideSection id="ld-session" eyebrow="LDP" title="The LDP session" tone="mpls">
        <DiagramFrame caption="The router with the higher transport address opens the TCP connection.">
          <SessionDiagram />
        </DiagramFrame>
        <p>The session is TCP 646 between the two transport addresses — so it needs an IGP route to the neighbor&apos;s loopback in both directions. Initialization messages negotiate parameters; Keepalives keep the session alive (hold time 180 s on IOS XR by default). Only an Operational session carries label mappings.</p>
        <CliPair cisco={only(WARM, "P1", "cisco", "show mpls ldp neighbor", /Peer LDP|TCP connection|State|Up time/)} junos={cli(WARM_JN, "P1", "juniper", "show ldp session")} ciscoCaption="IOS XR · P1" junosCaption="Junos · P1" />
      </GuideSection>

      <GuideSection id="ld-modes" eyebrow="LDP" title="Advertisement, control, retention" tone="mpls">
        <FieldTable
          title="Three independent choices"
          accent="mpls"
          columns={["Choice", "Options", "Common default"]}
          rows={[
            ["Advertisement", "downstream unsolicited (DU) · downstream on demand (DoD)", "DU: send every binding to every neighbor"],
            ["Label control", "independent · ordered", "IOS XR independent; Junos ordered"],
            ["Retention", "liberal (keep all) · conservative (keep only the next hop's)", "liberal: instant switch when the IGP path moves"],
          ]}
        />
        <DiagramFrame caption="Liberal retention: the LIB keeps every neighbor's binding; the LFIB uses the IGP next hop's.">
          <RetentionDiagram />
        </DiagramFrame>
        <Callout tone="warning" title="Independent vs ordered control in practice" icon="!">
          Independent control (IOS XR) labels every FEC as soon as it is in the routing table; if the next hop gave no label, the entry is <b>Unlabelled</b> and the packet continues as IP. Ordered control (Junos) advertises a label only once one arrived from downstream — a broken chain shows up at the ingress as a missing LSP, not in the middle of the core.
        </Callout>
      </GuideSection>

      <GuideSection id="ld-what" eyebrow="LDP" title="Which FECs get labels" tone="mpls">
        <p>By default IOS XR allocates labels for every IGP prefix; Junos LDP advertises only its loopback address. Providers usually label only the /32 loopbacks (IOS XR <Mono>label local allocate for host-routes</Mono>), because those are the only next hops services need. The lab does exactly that on both platforms.</p>
        <CliPair cisco={only(WARM, "PE1", "cisco", "show mpls ldp bindings", /\/32|Local binding/)} junos={only(WARM_JN, "PE1", "juniper", "show ldp database", /Input label|Label|\/32/)} ciscoCaption="IOS XR · PE1 — one local label per loopback" junosCaption="Junos · PE1" />
      </GuideSection>

      <GuideSection id="ld-tables" eyebrow="Forwarding" title="LIB, LFIB and the ingress" tone="success">
        <FieldTable
          title="Three tables, three questions"
          accent="success"
          columns={["Table", "Answers", "IOS XR", "Junos"]}
          rows={[
            ["LIB", "which labels did I hear for this FEC?", <Mono key="1">show mpls ldp bindings</Mono>, <Mono key="2">show ldp database</Mono>],
            ["LFIB", "what do I do with incoming label X?", <Mono key="3">show mpls forwarding</Mono>, <Mono key="4">show route table mpls.0</Mono>],
            ["Ingress (FTN)", "which label do I push for this IP destination?", <Mono key="5">show cef &lt;ip&gt;</Mono>, <Mono key="6">show route &lt;ip&gt; · inet.3</Mono>],
          ]}
        />
        <CliPair cisco={cli(WARM, "P1", "cisco", "show mpls forwarding")} junos={only(WARM_JN, "P1", "juniper", "show route table mpls.0", /^\d|Swap|Pop|mpls\.0/)} ciscoCaption="IOS XR · P1's LFIB" junosCaption="Junos · P1's mpls.0" />
      </GuideSection>

      <GuideSection id="ld-null" eyebrow="Forwarding" title="Implicit and explicit null" tone="success">
        <DiagramFrame caption="Implicit null pops one hop early; explicit null keeps label 0 to the egress.">
          <NullDiagram />
        </DiagramFrame>
        <p className="text-sm text-pv-text-muted">IOS XR: <Mono>mpls ldp → address-family ipv4 → label local advertise explicit-null</Mono>. Junos: <Mono>set protocols ldp explicit-null</Mono>. With explicit-null, P2&apos;s LFIB shows outgoing label 0 instead of Pop.</p>
      </GuideSection>

      <GuideSection id="ld-recursion" eyebrow="Forwarding" title="BGP next hops and the LSP" tone="success">
        <p>Customer prefixes are BGP routes whose next hop is the remote PE&apos;s loopback. Forwarding resolves them recursively: 10.2.2.0/24 → next hop 4.4.4.4 → the LSP for 4.4.4.4/32. IOS XR shows the imposed label in CEF; Junos resolves BGP next hops through <Mono>inet.3</Mono>, the table LDP fills — no LSP, no usable BGP route.</p>
        <CliPair cisco={cli(WARM, "PE1", "cisco", "show cef 10.2.2.20")} junos={cli(WARM_JN, "PE1", "juniper", "show route 10.2.2.20")} ciscoCaption="IOS XR · PE1" junosCaption="Junos · PE1" />
      </GuideSection>

      <GuideSection id="ld-mtu" eyebrow="Forwarding" title="MTU: room for labels" tone="warning">
        <p>Every label adds 4 bytes. A customer sending full 1500-byte IP packets needs core links that carry 1504 bytes for one label, 1508 for two (VPNs), more for TE and FRR. Providers run their core links with a large MTU (9000+) so customer packets never need fragmenting — and a single link left at 1500 breaks only the big packets.</p>
        <CliPanel run={only(T.mtu, "P1", "cisco", "show interfaces GigabitEthernet0/0/0/1", /MTU|drops/)} caption="IOS XR · P1 in the MTU ticket" />
      </GuideSection>

      <GuideSection id="ld-igp" eyebrow="LDP and the IGP" title="LDP follows the IGP" tone="ospf">
        <p>LDP never chooses paths: the outgoing label is always the one from the IGP next hop. When the IGP path moves, the LFIB moves with it — instantly, thanks to liberal retention.</p>
        <CliPair cisco={cli(WARM, "PE1", "cisco", "show cef 10.2.2.20")} junos={cli(FAILED, "PE1", "cisco", "show cef 10.2.2.20")} ciscoCaption="IOS XR · PE1 — before: via P1" junosCaption="IOS XR · PE1 — after P1–P2 fails: via P3, P3's label" />
      </GuideSection>

      <GuideSection id="ld-sync" eyebrow="LDP and the IGP" title="LDP–IGP synchronization" tone="ospf">
        <p>The IGP converges without asking LDP. After a link comes up (or LDP fails on a link), the IGP may send traffic over a link that has no LDP session yet — black-holing labeled traffic while IP is fine. <b className="text-pv-text">LDP–IGP synchronization</b> (RFC 5443) makes the IGP advertise the maximum metric on such a link until LDP is operational, so traffic avoids it.</p>
        <FieldTable title="Turning it on" accent="ospf" columns={["", "IOS XR", "Junos"]} rows={[["Per interface", <Mono key="1">router isis CORE → interface … → address-family ipv4 unicast → mpls ldp sync</Mono>, <Mono key="2">set protocols isis interface ge-0/0/1.0 ldp-synchronization</Mono>], ["Check", <Mono key="3">show mpls ldp igp sync</Mono>, <Mono key="4">show isis interface detail</Mono>]]} />
        <CliPanel run={cli(WARM, "P1", "cisco", "show mpls ldp igp sync")} caption="IOS XR · P1 — sync not configured yet, LDP ready everywhere" />
      </GuideSection>

      <GuideSection id="ld-config" eyebrow="Operations" title="Configuring it: IOS XR and Junos" tone="cyan">
        <CliPanel run={cli(WARM, "PE1", "cisco", "show running-config mpls ldp")} caption="IOS XR · PE1" />
        <CliPanel run={cli(WARM_JN, "PE1", "juniper", "show configuration protocols")} caption="Junos · PE1 (MPLS needs protocols mpls, protocols ldp and family mpls on each unit)" />
        <Callout tone="warning" title="The classic Junos trap" icon="!">
          On Junos an interface carries labels only when it appears in <Mono>protocols mpls</Mono>, has <Mono>family mpls</Mono> on its unit, and runs LDP. Forget one of the three and LDP stays silent on that link.
        </Callout>
      </GuideSection>

      <GuideSection id="ld-verify" eyebrow="Operations" title="How to verify" tone="cyan">
        <FieldTable
          title="Walk from the IGP to the label"
          accent="cyan"
          columns={["Question", "IOS XR", "Junos"]}
          rows={[
            ["Loopbacks reachable?", <Mono key="1">show route isis</Mono>, <Mono key="2">show route protocol isis</Mono>],
            ["Hellos both ways?", <Mono key="3">show mpls ldp discovery</Mono>, <Mono key="4">show ldp neighbor</Mono>],
            ["Sessions Operational?", <Mono key="5">show mpls ldp neighbor brief</Mono>, <Mono key="6">show ldp session</Mono>],
            ["Labels heard?", <Mono key="7">show mpls ldp bindings &lt;fec&gt;</Mono>, <Mono key="8">show ldp database</Mono>],
            ["What happens to label X?", <Mono key="9">show mpls forwarding</Mono>, <Mono key="10">show route table mpls.0</Mono>],
            ["Does the LSP work?", <Mono key="11">ping / traceroute mpls ipv4 &lt;fec&gt;/32</Mono>, <Mono key="12">ping / traceroute mpls ldp &lt;fec&gt;</Mono>],
          ]}
        />
      </GuideSection>

      <GuideSection id="ld-normal" eyebrow="Operations" title="What healthy looks like" tone="success">
        <CliPair cisco={cli(WARM, "PE1", "cisco", "show mpls ldp neighbor brief")} junos={cli(WARM_JN, "PE1", "juniper", "show ldp session")} ciscoCaption="IOS XR · PE1" junosCaption="Junos · PE1" />
        <CliPair cisco={cli(WARM, "PE1", "cisco", "show mpls ldp bindings 4.4.4.4/32")} junos={cli(WARM_JN, "PE1", "juniper", "show route table inet.3")} ciscoCaption="IOS XR · PE1 — labels from P1 (used) and P3 (kept)" junosCaption="Junos · PE1 — the LSPs BGP can use" />
      </GuideSection>

      <GuideSection id="ld-lspping" eyebrow="Troubleshooting" title="LSP ping and traceroute" tone="danger">
        <p>An ordinary ping to a loopback may travel as plain IP and prove nothing about the LSP. <b className="text-pv-text">LSP ping</b> (RFC 8029) sends an MPLS echo request down the LSP for a specific FEC, with a destination address in 127/8 so it can never be IP-routed to the target by mistake. Each router that can&apos;t forward it with a label answers with a return code.</p>
        <CliPair cisco={cli(WARM, "PE1", "cisco", "traceroute mpls ipv4 4.4.4.4/32")} junos={cli(T.ldpif, "PE1", "cisco", "traceroute mpls ipv4 4.4.4.4/32")} ciscoCaption="IOS XR · PE1 — healthy" junosCaption="IOS XR · PE1 — LDP missing on P1–P2: B at hop 1" />
      </GuideSection>

      <GuideSection id="ld-signatures" eyebrow="Troubleshooting" title="Failure signatures" tone="danger">
        <FailureSignatures
          items={[
            { tag: "IF", title: "LDP missing on a link", tone: "danger", points: ["IS-IS up, no Hellos on that link", "XR: Unlabelled in the LFIB · Junos: no LSP at the ingress"] },
            { tag: "TA", title: "Transport address unreachable", tone: "warning", points: ["discovery up, no session", "the neighbor's loopback is missing from the IGP"] },
            { tag: "MTU", title: "No room for labels", tone: "warning", points: ["size-dependent loss", "MTU drops on one core interface"] },
            { tag: "1W", title: "One PE without LDP", tone: "violet", points: ["XR: requests arrive, replies die (LSPs are one-way)", "Junos: neither direction has an LSP"] },
            { tag: "BKP", title: "Backup path without LDP", tone: "warning", points: ["only after a failure moves the IGP", "prevent with LDP everywhere and LDP–IGP sync"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="ld-workflow" eyebrow="Troubleshooting" title="Investigation workflow" tone="danger">
        <TroubleshootingFlow
          steps={[
            { question: "Do loopback pings work while customer traffic fails?", look: "Yes → the IGP is fine; the problem is in MPLS." },
            { question: "Does the LSP work?", look: "LSP ping / traceroute to the BGP next hop: where does the label disappear?" },
            { question: "Is there an LDP session on every link the IGP uses?", look: "Discovery only → transport address route. No discovery → LDP (Junos: mpls / family mpls) on the interface." },
            { question: "Did the next hop give a label? What does the LFIB do?", look: "Bindings, then forwarding: Unlabelled or missing entries." },
            { question: "Only big packets?", look: "MTU on every core link along the path." },
            { question: "Fix one thing, then prove it", look: "session, LFIB, LSP ping, fresh customer traffic." },
          ]}
        />
      </GuideSection>

      <GuideSection id="ld-tickets" eyebrow="Troubleshooting" title="Five faults, evidence to proof" tone="danger">
        <p>The MPLS + LDP Lab&apos;s five tickets, each output from the lab with the fault in place after the user&apos;s test (IOS XR view).</p>
        <FailureWalk
          title="1 · Customers down, loopbacks fine"
          normal="LDP sessions on every core link; P1 swaps 24102 → 24203."
          change="LDP removed from P1's interface toward P2."
          evidence={<CliPanel run={only(T.ldpif, "P1", "cisco", "show mpls forwarding prefix 4.4.4.4/32", /Local|Label|-----|4\.4\.4\.4/)} caption="IOS XR · P1" />}
          next="No session P1–P2 (show mpls ldp neighbor brief); LSP ping from PE1 returns B."
          fix={<Mono>mpls ldp → interface GigabitEthernet0/0/0/1 → commit</Mono>}
          proof="Session Operational; LFIB swaps again; LSP ping and a fresh CE1 → CE2 ping succeed."
        />
        <FailureWalk
          title="2 · LDP neighbors that never become neighbors"
          normal="P2's loopback 3.3.3.3 is in IS-IS; the P1–P2 session runs between loopbacks."
          change="P2's Loopback0 was removed from IS-IS."
          evidence={<CliPanel run={only(T.transport, "P1", "cisco", "show mpls ldp discovery", /Local|Gigabit|LDP Id/)} caption="IOS XR · P1 — Hellos from 3.3.3.3, but no session" />}
          next="show route 3.3.3.3 on P1: not in table — no route to the transport address."
          fix={<Mono>router isis CORE → interface Loopback0 → passive → commit (on P2)</Mono>}
          proof="3.3.3.3/32 back in IS-IS; session Operational; fresh customer ping succeeds."
        />
        <FailureWalk
          title="3 · Small works, big doesn't"
          normal="Every core link 9216 bytes."
          change="P1–P2 set to 1514 (1500 bytes of IP) after a card swap."
          evidence={<CliPanel run={only(T.mtu, "P1", "cisco", "show interfaces GigabitEthernet0/0/0/1", /MTU|drops/)} caption="IOS XR · P1" />}
          next="1500-byte DF pings fail, 100-byte pings work: a label makes 1504."
          fix={<Mono>interface GigabitEthernet0/0/0/1 → mtu 9216 → commit (both ends)</Mono>}
          proof="Both ends 9216; a fresh 1500-byte CE1 → CE2 ping succeeds."
        />
        <FailureWalk
          title="4 · PE2 after its maintenance"
          normal="Both PEs run LDP; each direction has its own LSP."
          change="LDP was left disabled on PE2."
          evidence={<CliPanel run={cli(T.oneway, "PE2", "cisco", "show cef 10.1.1.10")} caption="IOS XR · PE2 — no label imposed toward 1.1.1.1" />}
          next="IOS XR: CE1's request arrives (P2 pops and PE2 routes it), CE2's reply leaves PE2 unlabeled and dies at P2. LSPs are one-way."
          fix={<Mono>mpls ldp (with its interfaces) → commit on PE2</Mono>}
          proof="PE2 has sessions and pushes labels toward 1.1.1.1; a fresh CE1 → CE2 ping succeeds both ways."
        />
        <FailureWalk
          title="5 · The backup path that wasn't"
          normal="LDP on every core link, including P3–P4."
          change="P3–P4 never got LDP; the P1–P2 fiber was cut."
          evidence={<CliPanel run={cli(T.backup, "PE1", "cisco", "traceroute mpls ipv4 4.4.4.4/32")} caption="IOS XR · PE1 — labeled to P3, unlabeled after" />}
          next="IS-IS now uses P3–P4, where no LDP session exists. A latent fault exposed by a failure."
          fix={<Mono>enable LDP on P3 Gi0/0/0/1 and P4 Gi0/0/0/0</Mono>}
          proof="Session P3–P4 Operational; PE1 labels via P3; a fresh customer ping succeeds while P1–P2 is still down."
        />
      </GuideSection>

      <GuideSection id="ld-beyond" eyebrow="Beyond this lesson" title="Where labels go next" tone="violet">
        <FieldTable
          title="The same machinery, more labels"
          accent="violet"
          columns={["Lesson", "What changes"]}
          rows={[
            ["BGP route reflection", "how PEs learn each other's routes at scale — the next hops LDP must label"],
            ["RSVP-TE / FRR", "labels signaled along engineered paths, and pre-built bypass labels"],
            ["L3VPN", "a VPN label under the transport label: two-label stacks, per-customer VRFs"],
            ["L2VPN / VPLS / EVPN", "labels that carry Ethernet frames between sites"],
            ["Segment routing", "labels advertised by the IGP itself — no LDP at all"],
          ]}
        />
      </GuideSection>

      <GuideSection id="ld-myths" eyebrow="Master it" title="Common misconceptions" tone="warning">
        <Misconceptions
          items={[
            { myth: "MPLS exists because label lookups are faster.", correction: "It exists so the edge decides once: BGP-free cores, VPNs, traffic engineering and fast reroute all ride on it." },
            { myth: "A label is the same on every router.", correction: "Labels are local: each router picks the label it wants to receive." },
            { myth: "LDP chooses the path.", correction: "The IGP chooses; LDP only attaches labels to the IGP's next hops." },
            { myth: "If the loopbacks ping, MPLS is fine.", correction: "Loopback pings can travel as plain IP. Prove the LSP with LSP ping." },
            { myth: "An LSP works in both directions.", correction: "LSPs are one-way; the return traffic needs its own labels." },
            { myth: "Discovery means the session is up.", correction: "Hellos only prove the link; the session also needs a route to the neighbor's loopback." },
          ]}
        />
      </GuideSection>

      <GuideSection id="ld-quiz" eyebrow="Master it" title="Knowledge check" tone="cyan">
        <KnowledgeQuiz questions={QUIZ} />
      </GuideSection>

      <GuideSection id="ld-explain" eyebrow="Master it" title="Can you explain it?" tone="violet">
        <ExplainIt
          items={[
            { q: "Why can P1 forward CE1's packet with a label but not without one?", a: "Without a label P1 must route 10.2.2.20, which only the PEs know (BGP). With a label P1 only needs its own label table, built from IS-IS routes to the PE loopbacks." },
            { q: "Why does a broken LDP session cause the drop in a different place on IOS XR and Junos?", a: "IOS XR (independent) still labels upstream and strips the label where the chain breaks; Junos (ordered) never builds the LSP upstream, so the ingress has no LDP route and hides the BGP route." },
            { q: "Why does PE1 already have a label from P3 before anything fails?", a: "Liberal retention: LDP keeps every neighbor's binding; the LFIB just doesn't use it until the IGP makes P3 the next hop." },
            { q: "What problem does LDP–IGP synchronization solve?", a: "The IGP converging onto a link where LDP isn't ready: with sync the IGP advertises max metric there until LDP is operational." },
            { q: "Why do only big packets fail when one core link has a 1500-byte MTU?", a: "A label adds 4 bytes: 1500-byte customer packets become 1504-byte labeled packets." },
          ]}
        />
      </GuideSection>

      <GuideSection id="ld-practice" eyebrow="Master it" title="Practice in the MPLS + LDP Lab" tone="success">
        <p>Six Learn levels walk you from &quot;why labels&quot; to the evidence ladder; the engineering workspace gives you every router (IOS XR or Junos, with the label behavior of each), the CEs, six challenges and the five tickets above.</p>
        <LabBridge />
        <PresentationBridge>Rewatch the MPLS presentation.</PresentationBridge>
      </GuideSection>
    </div>
  );
}
