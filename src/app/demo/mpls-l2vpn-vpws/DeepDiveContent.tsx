import { Callout, CompareCards, DArrow, DIAGRAM as D, DLink, DNode, DRegion, DiagramFrame, DiagramSvg, FailureSignatures, FieldTable, GuideSection, Misconceptions, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { DStack } from "@/components/lesson/MplsGuideSvg";
import type { ReactNode } from "react";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { ExplainIt, KnowledgeQuiz, PracticeBridge, type KnowledgeQuestion } from "@/components/lesson/GuideInteractive";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import { PresentationBridge } from "@/components/presentation/LessonPresentation";
import { CliPair, CliPanel, FailureWalk } from "@/components/lesson/GuideCli";
import { vpApply, vpTicket, vpTicketState, type VpOs, type VpTicketId } from "@/lib/sim-engine/scenarios/vpNet";
import { PingResult, VP_HEALTHY, VP_HEALTHY_JN, vpCli, vpOnly } from "./LessonGuideContent";

const G = { foundation: "Foundation", edge: "The service edge", signal: "Signaling", data: "Encapsulation and forwarding", ops: "Operations", trouble: "Troubleshooting", beyond: "Beyond this lesson", master: "Master it" };
export const VPWS_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "vd-what", label: "What VPWS is", group: G.foundation },
  { id: "vd-model", label: "The PWE3 reference model", group: G.foundation },
  { id: "vd-network", label: "The network you will study", group: G.foundation },
  { id: "vd-ac", label: "Attachment-circuit types", group: G.edge },
  { id: "vd-transparent", label: "No MAC, no IP: transparency", group: G.edge },
  { id: "vd-tldp", label: "Targeted LDP vs link LDP", group: G.signal },
  { id: "vd-fec", label: "PW FEC 128 and 129", group: G.signal },
  { id: "vd-labels", label: "Directional labels", group: G.signal },
  { id: "vd-match", label: "What must match", group: G.signal },
  { id: "vd-stack", label: "Transport label vs PW label", group: G.data },
  { id: "vd-cw", label: "Control word", group: G.data },
  { id: "vd-mtu", label: "MTU", group: G.data },
  { id: "vd-transport", label: "Transport dependency", group: G.data },
  { id: "vd-status", label: "PW status signaling", group: G.ops },
  { id: "vd-config", label: "Configuring it: IOS XR and Junos", group: G.ops },
  { id: "vd-verify", label: "How to verify", group: G.ops },
  { id: "vd-signatures", label: "Failure signatures", group: G.trouble },
  { id: "vd-workflow", label: "Investigation workflow", group: G.trouble },
  { id: "vd-tickets", label: "Five faults, evidence to proof", group: G.trouble },
  { id: "vd-not", label: "What VPWS doesn't do", group: G.beyond },
  { id: "vd-myths", label: "Common misconceptions", group: G.master },
  { id: "vd-quiz", label: "Knowledge check", group: G.master },
  { id: "vd-explain", label: "Can you explain it?", group: G.master },
  { id: "vd-practice", label: "Practice in the L2VPN Lab", group: G.master },
];

// Real CLI output and ping results: the L2VPN Lab's own command sets and model.
const ticket = (id: VpTicketId, os: VpOs = "xr") => vpTicket(id).repro.reduce((acc, a) => vpApply(acc, a), vpTicketState(id, 1, os));
const T = { pwid: ticket("pwid"), mtu: ticket("mtu"), nbr: ticket("nbr"), vlan: ticket("vlan"), transport: ticket("transport"), transportJn: ticket("transport", "junos") };

function LabBridge() {
  const openLab = usePracticeLabOpener();
  return (
    <PracticeBridge label="Open the L2VPN Lab" onPractice={openLab}>
      The network from this page, IOS XR or Junos, your own copy. Nothing you do there changes your lesson progress.
    </PracticeBridge>
  );
}

/** The lab's network: two services between the same PEs. */
function LabNet() {
  const n: Record<string, [number, number, string, string]> = {
    CE1A: [55, 50, "VLAN 100 · .1", D.violet],
    CE1B: [55, 170, "VLAN 200 · .1", D.warning],
    PE1: [175, 110, "1.1.1.1", D.mpls],
    P1: [285, 110, "2.2.2.2", D.mpls],
    P2: [395, 110, "3.3.3.3", D.mpls],
    PE2: [505, 110, "4.4.4.4", D.mpls],
    CE2A: [590, 50, "VLAN 100 · .2", D.violet],
    CE2B: [590, 170, "VLAN 200 · .2", D.warning],
  };
  const l: [string, string][] = [["CE1A", "PE1"], ["CE1B", "PE1"], ["PE1", "P1"], ["P1", "P2"], ["P2", "PE2"], ["PE2", "CE2A"], ["PE2", "CE2B"]];
  return (
    <DiagramSvg h={240} label="CE1A and CE1B at PE1, CE2A and CE2B at PE2; core PE1-P1-P2-PE2; CUST-A on PW 5000, CUST-B on PW 5100, both using 192.168.100.0/24">
      <DRegion x={128} y={66} w={424} h={84} label="IS-IS + LDP · no customer state on P1/P2" color={D.mpls} />
      {l.map(([a, b]) => (
        <DLink key={a + b} x1={n[a][0]} y1={n[a][1]} x2={n[b][0]} y2={n[b][1]} color={a.startsWith("P") && b.startsWith("P") ? D.mpls : D.line} />
      ))}
      {Object.entries(n).map(([id, [x, y, sub, c]]) => (
        <DNode key={id} x={x} y={y} label={id} sub={sub} accent={c} w={id.startsWith("CE") ? 96 : 72} />
      ))}
      <text x={320} y={232} textAnchor="middle" fill={D.muted} fontSize={10}>
        violet CUST-A · PW 5000 (labels 24001 / 25001) · amber CUST-B · PW 5100 (24002 / 25002)
      </text>
    </DiagramSvg>
  );
}

const QUIZ: KnowledgeQuestion[] = [
  {
    id: "q-ac",
    prompt: "CUST-A and CUST-B both use 192.168.100.0/24 on the same PEs. Why don't their frames mix?",
    options: [
      { id: "a", label: "Each arrives on its own attachment circuit, which is cross-connected to its own pseudowire" },
      { id: "b", label: "The PEs keep a MAC table per customer" },
      { id: "c", label: "Their route distinguishers differ" },
    ],
    correctId: "a",
    explanation: "VPWS never looks at MAC or IP addresses. The attachment circuit (port + VLAN) decides the pseudowire.",
  },
  {
    id: "q-label",
    prompt: "PE1 pushes 25001 for CUST-A. Who chose that label?",
    options: [
      { id: "a", label: "PE2, which advertised it in its label mapping for PW 5000" },
      { id: "b", label: "PE1" },
      { id: "c", label: "It is derived from the PW ID" },
    ],
    correctId: "a",
    explanation: "The receiver allocates the pseudowire label; the sender pushes it. Each direction has its own label.",
  },
  {
    id: "q-pwid",
    prompt: "The targeted session is up, both ACs are up, but one pseudowire is down with no remote label. First suspect?",
    options: [
      { id: "a", label: "The two ends use different PW IDs" },
      { id: "b", label: "The transport LSP" },
      { id: "c", label: "MAC learning" },
    ],
    correctId: "a",
    explanation: "A PE only matches a received mapping with the same PW FEC. Different PW IDs mean no remote label at either end.",
  },
  {
    id: "q-mtu",
    prompt: "The remote label is known, but the pseudowire stays down. What do you compare?",
    options: [
      { id: "a", label: "The MTU and control-word settings both ends signaled" },
      { id: "b", label: "The IS-IS metrics" },
      { id: "c", label: "The PE loopbacks" },
    ],
    correctId: "a",
    explanation: "Both ends must signal the same MTU and agree on the control word, or the pseudowire is refused.",
  },
  {
    id: "q-vlan",
    prompt: "Every pseudowire is up, yet CUST-A's sites can't ping. What lives outside the pseudowire's checks?",
    options: [
      { id: "a", label: "The attachment circuits: a VLAN mismatch with a CE drops the frames at the edge" },
      { id: "b", label: "The PW ID" },
      { id: "c", label: "The targeted session" },
    ],
    correctId: "a",
    explanation: "The pseudowire only checks what the two PEs signal. Whether a CE's VLAN matches the AC is the edge's business.",
  },
  {
    id: "q-tldp",
    prompt: "Why can the targeted LDP session stay up while the transport LSP is broken?",
    options: [
      { id: "a", label: "It runs over plain IP between the loopbacks; IS-IS still reaches them" },
      { id: "b", label: "It uses the transport labels" },
      { id: "c", label: "It runs over the pseudowire itself" },
    ],
    correctId: "a",
    explanation: "LDP sessions are TCP over IP. That's why a pseudowire can look fine while frames die in the core.",
  },
  {
    id: "q-p",
    prompt: "What does P2 know about pseudowire 5000?",
    options: [
      { id: "a", label: "Nothing — it pops the transport label (PHP) and forwards" },
      { id: "b", label: "Its PW ID" },
      { id: "c", label: "Its PW labels" },
    ],
    correctId: "a",
    explanation: "Customer services live on the PEs. P routers switch transport labels only.",
  },
  {
    id: "q-cw",
    prompt: "What does the control word protect against in the core?",
    options: [
      { id: "a", label: "A router mistaking the Ethernet frame under the labels for an IP packet when it hashes for load-balancing" },
      { id: "b", label: "Label spoofing" },
      { id: "c", label: "MTU problems" },
    ],
    correctId: "a",
    explanation: "With the control word, the first nibble after the labels is 0, never 4 or 6, so no router takes the frame for IPv4/IPv6.",
  },
];
function ReferenceModel() {
  return (
    <DiagramSvg h={190} label="CE, attachment circuit, PE, pseudowire over a PSN tunnel, PE, attachment circuit, CE; the emulated service spans CE to CE">
      <DRegion x={20} y={14} w={600} h={40} label="emulated service (what the customers see: one Ethernet wire)" color={D.success} />
      <DNode x={60} y={110} label="CE" accent={D.ip} w={70} />
      <DNode x={190} y={110} label="PE" accent={D.mpls} w={70} />
      <DNode x={450} y={110} label="PE" accent={D.mpls} w={70} />
      <DNode x={580} y={110} label="CE" accent={D.ip} w={70} />
      <DLink x1={95} y1={110} x2={155} y2={110} color={D.ip} label="AC" labelDy={-8} />
      <DLink x1={485} y1={110} x2={545} y2={110} color={D.ip} label="AC" labelDy={-8} />
      <rect x={225} y={88} width={190} height={44} rx={22} fill={D.mpls} fillOpacity={0.08} stroke={D.mpls} strokeDasharray="5 4" />
      <DLink x1={225} y1={110} x2={415} y2={110} color={D.violet} />
      <text x={320} y={104} textAnchor="middle" fill={D.violet} fontSize={10} fontWeight={700}>
        pseudowire
      </text>
      <text x={320} y={150} textAnchor="middle" fill={D.mpls} fontSize={10}>
        PSN tunnel (MPLS transport LSP)
      </text>
      <text x={320} y={180} textAnchor="middle" fill={D.muted} fontSize={10}>
        RFC 3985 PWE3 architecture: the PW rides inside a tunnel; the tunnel can carry many PWs
      </text>
    </DiagramSvg>
  );
}

function TldpVsLink() {
  return (
    <DiagramSvg h={180} label="Link LDP Hellos go to a multicast address on a directly connected link; targeted LDP Hellos are unicast between non-adjacent loopbacks">
      <text x={20} y={24} fill={D.mpls} fontSize={11} fontWeight={700}>
        Link (basic) discovery
      </text>
      <DNode x={100} y={60} label="R1" accent={D.mpls} w={70} h={34} />
      <DNode x={260} y={60} label="R2" accent={D.mpls} w={70} h={34} />
      <DArrow x1={137} y1={60} x2={223} y2={60} color={D.mpls} both label="224.0.0.2" />
      <text x={20} y={100} fill={D.violet} fontSize={11} fontWeight={700}>
        Extended (targeted) discovery
      </text>
      <DNode x={100} y={150} label="PE1" accent={D.mpls} w={70} h={34} />
      <DNode x={250} y={150} label="P1" accent={D.faint} w={60} h={30} />
      <DNode x={380} y={150} label="P2" accent={D.faint} w={60} h={30} />
      <DNode x={540} y={150} label="PE2" accent={D.mpls} w={70} h={34} />
      <path d="M100 130 Q320 70 540 130" fill="none" stroke={D.violet} strokeWidth={2} strokeDasharray="6 4" />
      <text x={320} y={96} textAnchor="middle" fill={D.violet} fontSize={10} fontWeight={700}>
        unicast Hello to 4.4.4.4 · same UDP/TCP 646
      </text>
    </DiagramSvg>
  );
}

function FecDiagram() {
  const row = (y: number, title: string, c: string, cells: [string, number][]) => {
    let x = 120;
    return (
      <g>
        <text x={16} y={y + 22} fill={c} fontSize={11} fontWeight={700}>
          {title}
        </text>
        {cells.map(([name, w]) => {
          const g = (
            <g key={name}>
              <rect x={x} y={y} width={w - 4} height={34} rx={6} fill={c} fillOpacity={0.12} stroke={c} />
              <text x={x + (w - 4) / 2} y={y + 21} textAnchor="middle" fill={c} fontSize={10} fontWeight={700}>
                {name}
              </text>
            </g>
          );
          x += w;
          return g;
        })}
      </g>
    );
  };
  return (
    <DiagramSvg h={140} label="PWid FEC 128 carries control-word bit, PW type, group ID, PW ID and interface parameters; generalized FEC 129 carries AGI, SAII and TAII">
      {row(18, "FEC 128", D.mpls, [["C bit", 60], ["PW type", 90], ["Group ID", 90], ["PW ID", 90], ["Interface params (MTU…)", 170]])}
      {row(76, "FEC 129", D.violet, [["C bit", 60], ["PW type", 90], ["AGI", 110], ["SAII", 110], ["TAII", 130]])}
    </DiagramSvg>
  );
}

function CwDiagram() {
  return (
    <DiagramSvg h={170} label="Packet with transport label, PW label, optional control word and Ethernet frame; control word starts with 0000, has flags, length and a 16-bit sequence number">
      <DStack x={110} y={20} labels={[{ text: "Transport S0" }, { text: "PW S1", color: D.violet }, { text: "Control word", color: D.warning }]} payload="Ethernet" w={120} />
      <DArrow x1={176} y1={78} x2={222} y2={78} color={D.faint} />
      {[
        ["0000", 50],
        ["flags", 60],
        ["frag", 46],
        ["length", 70],
        ["sequence number (16 bits)", 170],
      ].reduce<{ x: number; els: ReactNode[] }>(
        (acc, [name, w]) => {
          acc.els.push(
            <g key={name as string}>
              <rect x={acc.x} y={60} width={(w as number) - 4} height={36} rx={6} fill={D.warning} fillOpacity={0.12} stroke={D.warning} />
              <text x={acc.x + ((w as number) - 4) / 2} y={82} textAnchor="middle" fill={D.warning} fontSize={10} fontWeight={700}>
                {name as string}
              </text>
            </g>,
          );
          acc.x += w as number;
          return acc;
        },
        { x: 230, els: [] },
      ).els}
      <text x={430} y={124} textAnchor="middle" fill={D.muted} fontSize={10}>
        first nibble 0000 keeps core ECMP from mistaking the payload for IPv4/IPv6
      </text>
    </DiagramSvg>
  );
}

function RolesDiagram() {
  const cols: [number, string, string, string][] = [
    [110, "Ingress PE", "AC lookup, push PW + transport", D.success],
    [320, "Transit P", "swap / PHP-pop outer label only", D.mpls],
    [530, "Egress PE", "PW lookup → pop → AC", D.warning],
  ];
  return (
    <DiagramSvg h={130} label="Ingress PE pushes two labels, transit P swaps or pops the outer label, egress PE looks up and pops the PW label">
      {cols.map(([x, t, d, c], i) => (
        <g key={t}>
          <DNode x={x} y={45} label={t} accent={c} w={150} />
          <text x={x} y={95} textAnchor="middle" fill={D.text} fontSize={10}>
            {d}
          </text>
          {i < 2 && <DArrow x1={x + 78} y1={45} x2={cols[i + 1][0] - 78} y2={45} color={D.faint} />}
        </g>
      ))}
    </DiagramSvg>
  );
}

function StatusDiagram() {
  return (
    <DiagramSvg h={160} label="The AC at PE2 goes down, PE2 signals PW status to PE1, and PE1 marks the service down toward CE1">
      <DNode x={70} y={80} label="CE1" accent={D.ip} w={70} />
      <DNode x={220} y={80} label="PE1" accent={D.mpls} w={80} />
      <DNode x={420} y={80} label="PE2" accent={D.mpls} w={80} />
      <DNode x={570} y={80} label="CE2" accent={D.ip} w={70} />
      <DLink x1={105} y1={80} x2={180} y2={80} color={D.ip} />
      <DLink x1={460} y1={80} x2={535} y2={80} color={D.danger} dashed label="AC down" labelDy={-8} />
      <DArrow x1={378} y1={60} x2={262} y2={60} color={D.danger} label="PW status: AC fault (LDP)" />
      <DLink x1={260} y1={96} x2={380} y2={96} color={D.violet} label="targeted LDP still UP" labelDy={20} />
      <text x={320} y={150} textAnchor="middle" fill={D.muted} fontSize={10}>
        a healthy signaling session does not mean a healthy service
      </text>
    </DiagramSvg>
  );
}

export function VpwsDeepDiveContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="vd-what" eyebrow="Foundation" title="What VPWS is" tone="mpls">
        <p>A Virtual Private Wire Service emulates a point-to-point Layer 2 circuit across a packet network: whatever enters one attachment circuit leaves the other, in order, unchanged. Classic VPWS signals each wire with LDP (RFC 4447) and carries Ethernet frames inside MPLS (RFC 4448). It replaced leased lines and Frame Relay / ATM circuits — and it is still the simplest way to hand a customer &quot;a cable&quot; between two sites.</p>
        <PingResult s={vpApply(VP_HEALTHY, { type: "test", from: "CE1B", dst: "192.168.100.2" })} title="The lab: CE1B pings 192.168.100.2 — CUST-A's address too — and reaches its own site" />
      </GuideSection>

      <GuideSection id="vd-model" eyebrow="Foundation" title="The PWE3 reference model" tone="mpls">
        <DiagramFrame caption="Customers see one wire; the provider sees attachment circuits, a pseudowire and the tunnel it rides in.">
          <ReferenceModel />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="vd-network" eyebrow="Foundation" title="The network you will study" tone="cyan">
        <DiagramFrame caption="The L2VPN Lab. Every output on this page comes from it.">
          <LabNet />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="vd-ac" eyebrow="The service edge" title="Attachment-circuit types" tone="cyan">
        <FieldTable
          title="What an Ethernet AC can be"
          accent="cyan"
          columns={["Mode", "What enters the wire", "Configured as"]}
          rows={[
            ["Port (raw)", "every frame on the port, any tag", "XR: interface X l2transport · Junos: encapsulation ethernet-ccc"],
            ["VLAN (this lab)", "frames with one VLAN tag", "XR: X.100 l2transport + encapsulation dot1q 100 · Junos: unit 100 vlan-ccc + vlan-id 100"],
            ["QinQ", "frames with an outer and inner tag", "dot1q + second-dot1q / vlan-tags outer inner"],
          ]}
        />
        <p className="text-sm text-pv-text-muted">The two ends needn&apos;t use the same VLAN number — the PEs can rewrite tags — but each AC must match what its own CE sends. A CE on VLAN 100 facing an AC on VLAN 200 is the lab&apos;s fourth ticket.</p>
      </GuideSection>

      <GuideSection id="vd-transparent" eyebrow="The service edge" title="No MAC, no IP: transparency" tone="violet">
        <p>A VPWS PE learns no MAC addresses and routes nothing: the cross-connect is the whole forwarding decision. Customers can run any protocol over the wire — their own VLANs, spanning tree, IS-IS, MPLS — and reuse any addresses. The price: exactly two endpoints. For many sites you need VPLS or EVPN (the next lessons).</p>
      </GuideSection>

      <GuideSection id="vd-tldp" eyebrow="Signaling" title="Targeted LDP vs link LDP" tone="violet">
        <DiagramFrame caption="Link hellos are multicast on one link; targeted hellos are unicast to a remote loopback.">
          <TldpVsLink />
        </DiagramFrame>
        <CliPanel run={vpOnly(VP_HEALTHY, "PE1", "cisco", "show mpls ldp discovery", /.*/)} caption="IOS XR · PE1 — one link neighbor (P1), one targeted neighbor (PE2)" />
        <Callout tone="warning" title="Junos needs the loopback in LDP" icon="!">
          A Junos PE accepts and sends targeted hellos only if <Mono>lo0.0</Mono> is listed under <Mono>protocols ldp</Mono>. Without it the l2circuit never gets a session.
        </Callout>
      </GuideSection>

      <GuideSection id="vd-fec" eyebrow="Signaling" title="PW FEC 128 and 129" tone="violet">
        <DiagramFrame caption="FEC 128 names a wire by PW ID; FEC 129 by attachment identifiers (used with auto-discovery).">
          <FecDiagram />
        </DiagramFrame>
        <p>This lesson and its lab use FEC 128 (&quot;PWid FEC&quot;): both PEs are configured with the neighbor&apos;s address and the same PW ID. FEC 129 (&quot;generalized&quot;) identifies each end separately, which BGP auto-discovery needs.</p>
      </GuideSection>

      <GuideSection id="vd-labels" eyebrow="Signaling" title="Directional labels" tone="mpls">
        <p>Each PE allocates a local label per pseudowire and advertises it in its label mapping; the other PE pushes it. In the lab PE1 receives CUST-A on 24001 and CUST-B on 24002, PE2 on 25001 and 25002.</p>
        <CliPair cisco={vpOnly(VP_HEALTHY, "PE1", "cisco", "show mpls forwarding", /Local|Label|---|PW\(/)} junos={vpOnly(VP_HEALTHY_JN, "PE1", "juniper", "show route table mpls.0", /^2998|via ge-0\/0\/[12]\./)} ciscoCaption="IOS XR · PE1 — the labels it receives on, popped toward each AC" junosCaption="Junos · PE1 — L2CKT receive labels" />
      </GuideSection>

      <GuideSection id="vd-match" eyebrow="Signaling" title="What must match" tone="success">
        <FieldTable
          title="The two ends of a pseudowire"
          accent="success"
          columns={["Parameter", "Must match?", "If not"]}
          rows={[
            ["PW ID (and PW type)", "yes", "no remote label: down on both ends"],
            ["MTU", "yes", "down: MTU mismatch (XR shows both values; Junos MM)"],
            ["Control word", "yes (as configured here)", "down: control-word mismatch (Junos CM)"],
            ["VLAN numbers of the two ACs", "no", "— (each AC must match its own CE)"],
            ["Neighbor address", "must be the other PE's loopback", "targeted hellos go nowhere"],
          ]}
        />
      </GuideSection>

      <GuideSection id="vd-stack" eyebrow="Encapsulation and forwarding" title="Transport label vs PW label" tone="mpls">
        <DiagramFrame caption="Ingress pushes two labels, transit touches only the top one, egress pops the PW label.">
          <RolesDiagram />
        </DiagramFrame>
        <CompareCards
          items={[
            { title: "Transport label", tone: "mpls", tag: "outer", points: ["from hop-by-hop LDP (or RSVP-TE / SR)", "gets the frame to the far PE", "swapped, then popped by P2 (PHP)"] },
            { title: "PW label", tone: "violet", tag: "inner, S=1", points: ["from targeted LDP", "chosen by the far PE", "selects the attachment circuit"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="vd-cw" eyebrow="Encapsulation and forwarding" title="Control word" tone="warning">
        <DiagramFrame caption="Four bytes between the label stack and the frame.">
          <CwDiagram />
        </DiagramFrame>
        <p>Core routers that load-balance peek at the first nibble after the labels: 4 means IPv4, 6 IPv6. An Ethernet frame whose destination MAC starts with 4 or 6 would be hashed as IP and its packets could be reordered. The control word starts with 0000, so nobody guesses. IOS XR enables it through a pw-class (<Mono>encapsulation mpls → control-word</Mono>); Junos uses it by default (<Mono>no-control-word</Mono> turns it off).</p>
      </GuideSection>

      <GuideSection id="vd-mtu" eyebrow="Encapsulation and forwarding" title="MTU" tone="warning">
        <p>Each PE advertises its attachment circuit&apos;s MTU, and the ends must agree. On IOS XR the AC MTU comes from the l2transport sub-interface (<Mono>mtu 1518</Mono> on a dot1q sub-interface = 1500 of payload; the lab&apos;s second ticket sets 1522 = 1504); Junos signals <Mono>mtu</Mono> under the l2circuit interface. Separately, the core must carry the frame plus two labels and the control word: 1500 + 14 + 4 + 8 + 4 bytes.</p>
        <CliPanel run={vpOnly(T.mtu, "PE1", "cisco", "show l2vpn xconnect group CUST-A detail", /state is|MPLS  |MTU  /)} caption="IOS XR · PE1 — local 1500, remote 1504: down" />
      </GuideSection>

      <GuideSection id="vd-transport" eyebrow="Encapsulation and forwarding" title="Transport dependency" tone="mpls">
        <CompareCards
          items={[
            { title: "IOS XR", tone: "cyan", tag: "no label from P2", points: ["pseudowire stays up (signaling is fine)", "P1 forwards unlabeled", "P2 receives PW label 25001 and drops it"] },
            { title: "Junos", tone: "violet", tag: "no LSP to 4.4.4.4", points: ["the l2circuit needs an LSP to its neighbor in inet.3", "VC-Dn on PE1", "frames are dropped at PE1"] },
          ]}
        />
        <CliPair cisco={vpCli(T.transport, "P1", "cisco", "show mpls forwarding")} junos={vpOnly(T.transportJn, "PE1", "juniper", "show l2circuit connections", /Neighbor|Interface  |\(vc/)} ciscoCaption="IOS XR · P1 — 4.4.4.4 Unlabelled" junosCaption="Junos · PE1 — VC-Dn" />
      </GuideSection>

      <GuideSection id="vd-status" eyebrow="Operations" title="PW status signaling" tone="danger">
        <DiagramFrame caption="A healthy signaling session doesn't mean a healthy service.">
          <StatusDiagram />
        </DiagramFrame>
        <p>With the PW status TLV, a PE tells its peer when its attachment circuit fails, so the far end can report the service down instead of blackholing. Older implementations withdraw the label instead. Either way, the targeted session stays up.</p>
      </GuideSection>

      <GuideSection id="vd-config" eyebrow="Operations" title="Configuring it: IOS XR and Junos" tone="cyan">
        <CliPair cisco={vpCli(VP_HEALTHY, "PE1", "cisco", "show running-config l2vpn")} junos={vpCli(VP_HEALTHY_JN, "PE1", "juniper", "show configuration protocols l2circuit")} ciscoCaption="IOS XR · PE1 — pw-class with control word, one p2p per service" junosCaption="Junos · PE1 — l2circuit per neighbor and interface" />
        <CliPair cisco={vpOnly(VP_HEALTHY, "PE1", "cisco", "show running-config", /l2transport|encapsulation dot1q/)} junos={vpCli(VP_HEALTHY_JN, "PE1", "juniper", "show configuration interfaces ge-0/0/1")} ciscoCaption="IOS XR · PE1 — the attachment circuits" junosCaption="Junos · PE1 — the attachment circuit for CUST-A" />
      </GuideSection>

      <GuideSection id="vd-verify" eyebrow="Operations" title="How to verify" tone="success">
        <FieldTable
          title="The questions, and where the answers are"
          accent="success"
          columns={["Question", "IOS XR", "Junos"]}
          rows={[
            ["Are the cross-connects up?", <Mono key="1">show l2vpn xconnect</Mono>, <Mono key="2">show l2circuit connections</Mono>],
            ["Labels, MTU, control word, VLAN?", <Mono key="3">show l2vpn xconnect group &lt;g&gt; detail</Mono>, <Mono key="4">show l2circuit connections</Mono>],
            ["Is the targeted session up?", <Mono key="5">show mpls ldp discovery</Mono>, <Mono key="6">show ldp neighbor</Mono>],
            ["Is there an LSP to the far PE?", <Mono key="7">show mpls forwarding</Mono>, <Mono key="8">show route table inet.3</Mono>],
            ["Which labels are programmed?", <Mono key="9">show mpls forwarding</Mono>, <Mono key="10">show route table mpls.0</Mono>],
          ]}
        />
      </GuideSection>

      <GuideSection id="vd-signatures" eyebrow="Troubleshooting" title="Failure signatures" tone="danger">
        <FailureSignatures
          items={[
            { tag: "ID", title: "Different PW IDs", tone: "danger", points: ["session up, ACs up", "no remote label (XR local ready, Junos OL)"] },
            { tag: "MTU", title: "Different MTUs", tone: "danger", points: ["remote label known", "down: MTU mismatch"] },
            { tag: "NBR", title: "Wrong neighbor", tone: "warning", points: ["targeted hello unanswered", "the far end waits for a mapping"] },
            { tag: "VLAN", title: "AC vs CE VLAN", tone: "violet", points: ["pseudowire up", "frames dropped at the edge"] },
            { tag: "LSP", title: "Transport broken", tone: "warning", points: ["XR: PW up, drop in the core", "Junos: VC-Dn"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="vd-workflow" eyebrow="Troubleshooting" title="Investigation workflow" tone="danger">
        <TroubleshootingFlow
          steps={[
            { question: "Where does a fresh ping stop?", look: "Ingress PE (PW down), core (label drop) or the far edge (VLAN)." },
            { question: "Does each CE's VLAN land in an attachment circuit?", look: "The sub-interfaces' VLANs on both PEs." },
            { question: "Is the targeted LDP session up?", look: "Discovery / LDP neighbors: hellos answered?" },
            { question: "Does each pseudowire have a remote label?", look: "PW ID at both ends; then MTU and control word." },
            { question: "Is the transport LSP complete?", look: "Labels hop by hop; Junos inet.3." },
          ]}
        />
      </GuideSection>

      <GuideSection id="vd-tickets" eyebrow="Troubleshooting" title="Five faults, evidence to proof" tone="danger">
        <p>The L2VPN Lab&apos;s five tickets, with the fault in place (IOS XR view unless noted).</p>
        <FailureWalk
          title="1 · CUST-A's wire is dead"
          normal="Both PEs define CUST-A's pseudowire as PW ID 5000."
          change="PE2's was re-entered as PW ID 6000."
          evidence={<CliPanel run={vpOnly(T.pwid, "PE2", "cisco", "show l2vpn xconnect group CUST-A detail", /state is|MPLS  |Label  |Remote label/)} caption="IOS XR · PE2 — remote label unknown" />}
          next="PE1 shows the same from its side. The targeted session is up; PW 5100 works."
          fix={<Mono>PE2: l2vpn → xconnect group CUST-A → p2p VPWS-A → no neighbor ipv4 1.1.1.1 pw-id 6000 → neighbor ipv4 1.1.1.1 pw-id 5000 → pw-class CW → commit</Mono>}
          proof="Remote label 24001 learned, state up ( established ); a fresh ping from CE1A reaches CE2A."
        />
        <FailureWalk
          title="2 · Jumbo-ready, and down"
          normal="Both ends signal MTU 1500."
          change="PE2's CUST-A sub-interface got mtu 1522 (AC MTU 1504)."
          evidence={<CliPanel run={vpOnly(T.mtu, "PE1", "cisco", "show l2vpn xconnect group CUST-A detail", /state is|MPLS  |MTU  /)} caption="IOS XR · PE1 — MTU 1500 / 1504" />}
          next="The remote label is known — signaling works; the MTU check refuses the pseudowire."
          fix={<Mono>PE2: interface GigabitEthernet0/0/0/1.100 l2transport → no mtu → commit</Mono>}
          proof="MTU 1500 / 1500, state up; a fresh ping succeeds."
        />
        <FailureWalk
          title="3 · CUST-B never came up"
          normal="PE1's CUST-B cross-connect points at 4.4.4.4."
          change="Re-provisioned from a ticket with 4.4.4.14."
          evidence={<CliPanel run={vpOnly(T.nbr, "PE1", "cisco", "show mpls ldp discovery", /Targeted|->|LDP Id: 4/)} caption="IOS XR · PE1 — hellos to 4.4.4.14, never answered" />}
          next="PE2's side of PW 5100 waits for a mapping from 1.1.1.1 that PE1 sends nowhere."
          fix={<Mono>PE1: l2vpn → xconnect group CUST-B → p2p VPWS-B → no neighbor ipv4 4.4.4.14 pw-id 5100 → neighbor ipv4 4.4.4.4 pw-id 5100 → pw-class CW → commit</Mono>}
          proof="Both ends of PW 5100 up; a fresh ping from CE1B reaches CE2B."
        />
        <FailureWalk
          title="4 · The wire is up, nothing passes"
          normal="PE2's CUST-A AC accepts VLAN 100, like CE2A."
          change="After a line-card swap the sub-interface was retyped with encapsulation dot1q 200."
          evidence={<CliPanel run={vpCli(T.vlan, "PE2", "cisco", "show l2vpn xconnect group CUST-A detail")} caption="IOS XR · PE2 — state up, but VLAN ranges [200, 200]" />}
          next="Frames from CE1A leave PE2 tagged 200; CE2A drops them. CE2A's VLAN 100 frames match no AC."
          fix={<Mono>PE2: interface GigabitEthernet0/0/0/1.100 l2transport → encapsulation dot1q 100 → commit</Mono>}
          proof="VLAN ranges [100, 100]; a fresh ping from CE1A reaches CE2A."
        />
        <FailureWalk
          title="5 · After the core upgrade"
          normal="LDP on every core link."
          change="P1's interface toward P2 lost LDP in the upgrade."
          evidence={<CliPanel run={vpCli(T.transport, "P1", "cisco", "show mpls forwarding")} caption="IOS XR · P1 — 4.4.4.4 Unlabelled: P2 receives 25001 and drops it" />}
          next="The pseudowires stay up on IOS XR (on Junos they go VC-Dn): signaling runs over IP."
          fix={<Mono>P1: mpls ldp → interface GigabitEthernet0/0/0/1 → commit</Mono>}
          proof="P1 swaps 24102 → 24203 again; a fresh ping from CE1A reaches CE2A."
        />
      </GuideSection>

      <GuideSection id="vd-not" eyebrow="Beyond this lesson" title="What VPWS doesn't do" tone="danger">
        <FieldTable
          title="And where to look instead"
          accent="danger"
          columns={["Need", "VPWS?", "Instead"]}
          rows={[
            ["More than two sites", "no", "VPLS (next lessons), EVPN"],
            ["Route the customer's IP", "no", "L3VPN"],
            ["Auto-discover the endpoints", "not with FEC 128", "BGP-signaled / auto-discovered L2VPN, EVPN-VPWS"],
            ["Redundant attachment (two PEs)", "with extras", "pseudowire redundancy, EVPN multihoming"],
          ]}
        />
      </GuideSection>

      <GuideSection id="vd-myths" eyebrow="Master it" title="Common misconceptions" tone="warning">
        <Misconceptions
          items={[
            { myth: "The PW ID is the label in the packet.", correction: "It names the pseudowire in signaling. Each PE allocates its own label." },
            { myth: "Both directions use the same label.", correction: "Each PE chooses the label it receives on." },
            { myth: "A pseudowire that shows up carries traffic.", correction: "The ACs' VLANs and the transport LSP are outside the pseudowire's checks." },
            { myth: "The P routers must know the pseudowire.", correction: "They switch transport labels only." },
            { myth: "VPWS learns MAC addresses.", correction: "It forwards everything from one AC to the other; MAC learning is VPLS." },
            { myth: "Link LDP is enough to signal pseudowires.", correction: "The PEs need a targeted session between their loopbacks." },
          ]}
        />
      </GuideSection>

      <GuideSection id="vd-quiz" eyebrow="Master it" title="Knowledge check" tone="cyan">
        <KnowledgeQuiz questions={QUIZ} />
      </GuideSection>

      <GuideSection id="vd-explain" eyebrow="Master it" title="Can you explain it?" tone="violet">
        <ExplainIt
          items={[
            { q: "Why can two customers use the same IP subnet on the same PEs?", a: "The PEs never read IP or MAC addresses; each customer's attachment circuit is cross-connected to its own pseudowire." },
            { q: "Why did PW ID 6000 at PE2 break CUST-A but not CUST-B?", a: "Only CUST-A's PW FEC differed. Neither PE received a mapping for its configured PW ID 5000/6000; PW 5100 still matched." },
            { q: "Why does PE1 push 25001 and PE2 push 24001?", a: "Each PE advertises the label it wants to receive; the other uses it. Labels are directional." },
            { q: "How can the pseudowire be up while nothing passes?", a: "An attachment circuit on the wrong VLAN, or (IOS XR) a broken transport LSP — neither is part of pseudowire signaling." },
            { q: "Why does a broken LSP look different on Junos?", a: "Junos keeps the l2circuit down without an LSP to the neighbor in inet.3; IOS XR brings it up and the frame dies in the core." },
          ]}
        />
      </GuideSection>

      <GuideSection id="vd-practice" eyebrow="Master it" title="Practice in the L2VPN Lab" tone="success">
        <p>Six Learn levels take you from &quot;a wire across the provider&quot; to reading the evidence; the engineering workspace gives you all four routers (IOS XR or Junos), pings from four customer sites, five challenges and the five tickets above.</p>
        <LabBridge />
        <PresentationBridge>Rewatch the L2VPN presentation.</PresentationBridge>
      </GuideSection>
    </div>
  );
}
