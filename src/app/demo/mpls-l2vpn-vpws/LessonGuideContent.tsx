import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DLink, DNode, DPill, DiagramFrame, DiagramSvg, FailureSignatures, FieldTable, FlowSteps, Glossary, GuideSection, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { DStack } from "@/components/lesson/MplsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { PracticeBridge } from "@/components/lesson/GuideInteractive";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import { PresentationBridge } from "@/components/presentation/LessonPresentation";
import { CliPair, CliPanel, pickLines, runGuideCli } from "@/components/lesson/GuideCli";
import type { CliVendor } from "@/lib/cli/types";
import { createVpNet, vpApply, vpTicket, vpTicketState, type VpCe, type VpOs, type VpR, type VpState } from "@/lib/sim-engine/scenarios/vpNet";
import { vpSets, vpStaticApi } from "./vp-lab/vpCli";

export const VPWS_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "vl-mission", label: "What this lesson teaches" },
  { id: "vl-network", label: "The network of this lesson" },
  { id: "vl-ideas", label: "Three ideas you need" },
  { id: "vl-watch", label: "What you will watch" },
  { id: "vl-ac", label: "Attachment circuits" },
  { id: "vl-lsp-vs-pw", label: "Transport LSP ≠ pseudowire" },
  { id: "vl-tldp", label: "Targeted LDP" },
  { id: "vl-fec", label: "PW FEC and PW ID" },
  { id: "vl-labels", label: "Directional labels" },
  { id: "vl-pwup", label: "When the pseudowire comes up" },
  { id: "vl-walk", label: "A frame, hop by hop" },
  { id: "vl-extras", label: "Control word and MTU" },
  { id: "vl-working", label: "What working looks like" },
  { id: "vl-incident", label: "The incident" },
  { id: "vl-investigate", label: "Walk the evidence" },
  { id: "vl-fix", label: "Repair and prove it" },
  { id: "vl-other", label: "Other ways a pseudowire fails" },
  { id: "vl-model", label: "Mental model" },
  { id: "vl-glossary", label: "Glossary" },
  { id: "vl-recap", label: "Recap" },
  { id: "vl-practice", label: "Practice it" },
];

/**
 * Every CLI sample and ping result on this page comes from the L2VPN Lab's model and its IOS XR / Junos command sets:
 * the healthy network and the lab's "pwid" ticket — the guided lesson's incident (PE2 defines CUST-A's pseudowire with
 * PW ID 6000).
 */
export const VP_HEALTHY: VpState = createVpNet(0);
export const VP_HEALTHY_JN: VpState = createVpNet(0, "junos");
const ping = (s: VpState, from: VpCe, dst: string) => vpApply(s, { type: "test", from, dst });
const fault = (os: VpOs) => vpTicket("pwid").repro.reduce((acc, a) => vpApply(acc, a), vpTicketState("pwid", 0, os));
const VP_FAULT = fault("xr");
const VP_FAULT_JN = fault("junos");
const VP_FIXED = ping(vpApply(VP_FAULT, { type: "set", text: "PE2: CUST-A's pseudowire back to PW ID 5000", changes: [{ dev: "PE2", f: (c) => void (c.xcs.find((x) => x.ac?.endsWith(".100"))!.pwid = 5000) }] }), "CE1A", "192.168.100.2");
const OK_A = ping(VP_HEALTHY, "CE1A", "192.168.100.2");
const OK_B = ping(VP_HEALTHY, "CE1B", "192.168.100.2");
export function vpCli(s: VpState, r: VpR, vendor: CliVendor, command: string) {
  return runGuideCli(vpSets(vpStaticApi(s, r), r)[vendor], command);
}
export function vpOnly(s: VpState, r: VpR, vendor: CliVendor, command: string, match: RegExp, keep = 0) {
  const x = vpCli(s, r, vendor, command);
  return { ...x, output: pickLines(x.output, match, keep) };
}
/** One customer ping, as the lab reports it. */
export function PingResult({ s, title }: { s: VpState; title: string }) {
  const t = s.tests[s.tests.length - 1];
  return (
    <Callout tone={t.ok ? "success" : "danger"} title={title} icon={t.ok ? "✓" : "!"}>
      {t.from} → {t.dst}: {t.ok ? `delivered to ${t.reached}, and the reply came back` : t.why}
    </Callout>
  );
}

function LessonLabBridge() {
  const openLab = usePracticeLabOpener();
  return (
    <PracticeBridge label="Open the L2VPN Lab" onPractice={openLab}>
      Two customers with the same IP addresses on two pseudowires, IOS XR or Junos, your own copy. Nothing you do there changes your lesson progress.
    </PracticeBridge>
  );
}

const N: [string, number, string, string][] = [
  ["CE1", 45, "00:…:01", D.ip],
  ["PE1", 160, "1.1.1.1", D.mpls],
  ["P1", 268, "2.2.2.2", D.mpls],
  ["P2", 376, "3.3.3.3", D.mpls],
  ["PE2", 484, "4.4.4.4", D.mpls],
  ["CE2", 597, "00:…:02", D.ip],
];

function TopologyDiagram() {
  return (
    <DiagramSvg h={190} label="CE1 on PE1's AC, P1 and P2 in the core, PE2's AC to CE2; a targeted LDP session runs directly between PE1 and PE2">
      <text x={322} y={157} textAnchor="middle" fill={D.mpls} fontSize={10} fontWeight={700}>
        MPLS core · IS-IS + LDP transport
      </text>
      {N.slice(0, -1).map(([id, x], i) => (
        <DLink key={id} x1={x + 40} y1={115} x2={N[i + 1][1] - 40} y2={115} color={i === 0 || i === 4 ? D.ip : D.mpls} label={i === 0 || i === 4 ? "AC" : undefined} labelDy={-8} />
      ))}
      {N.map(([id, x, sub, c]) => (
        <DNode key={id} x={x} y={115} label={id} sub={sub} accent={c} w={80} />
      ))}
      <path d="M160 92 Q322 10 484 92" fill="none" stroke={D.violet} strokeWidth={2} strokeDasharray="6 4" />
      <DPill x={322} y={40} text="targeted LDP · loopback ↔ loopback" color={D.violet} w={230} />
      <text x={320} y={178} textAnchor="middle" fill={D.muted} fontSize={10}>
        AC = ge-0/0/0.100 (VLAN 100) on each PE · service CUST-A-VPWS · PW ID 5000
      </text>
    </DiagramSvg>
  );
}

function TldpDiagram() {
  const rows: [string, string, boolean][] = [
    ["Targeted Hello (unicast)", D.mpls, false],
    ["TCP session (loopbacks)", D.violet, true],
    ["LDP Initialization", D.violet, true],
    ["OPERATIONAL", D.success, true],
  ];
  return (
    <DiagramSvg h={240} label="Targeted Hello, TCP session, Initialization, operational, then label mappings each way">
      <DNode x={110} y={28} label="PE1" sub="1.1.1.1" accent={D.mpls} />
      <DNode x={530} y={28} label="PE2" sub="4.4.4.4" accent={D.mpls} />
      <line x1={110} y1={52} x2={110} y2={216} stroke={D.line} strokeDasharray="3 4" />
      <line x1={530} y1={52} x2={530} y2={216} stroke={D.line} strokeDasharray="3 4" />
      {rows.map(([t, c, both], i) => (
        <DArrow key={t} x1={114} y1={72 + i * 30} x2={526} y2={72 + i * 30} color={c} both={both} label={t} />
      ))}
      <DArrow x1={114} y1={190} x2={526} y2={190} color={D.success} label="Label Mapping: PW-ETHERNET-5000 · label 24001" />
      <DArrow x1={526} y1={212} x2={114} y2={212} color={D.warning} label="Label Mapping: PW-ETHERNET-5000 · label 25001" labelDy={16} />
    </DiagramSvg>
  );
}

function DirectionalDiagram() {
  return (
    <DiagramSvg h={200} label="PE1 advertises 24001, which PE2 uses toward PE1; PE2 advertises 25001, which PE1 uses toward PE2">
      <DNode x={120} y={100} label="PE1" sub="receives on 24001" accent={D.mpls} w={140} />
      <DNode x={520} y={100} label="PE2" sub="receives on 25001" accent={D.mpls} w={140} />
      <DArrow x1={192} y1={70} x2={448} y2={70} color={D.violet} label="advertises 24001 (control)" />
      <DArrow x1={448} y1={130} x2={192} y2={130} color={D.violet} label="advertises 25001 (control)" labelDy={18} />
      <text x={320} y={25} textAnchor="middle" fill={D.success} fontSize={10.5} fontWeight={700}>
        CE1 → CE2 data carries 25001 (PE2&apos;s label)
      </text>
      <text x={320} y={190} textAnchor="middle" fill={D.warning} fontSize={10.5} fontWeight={700}>
        CE2 → CE1 data carries 24001 (PE1&apos;s label)
      </text>
    </DiagramSvg>
  );
}

function WalkDiagram({ reverse }: { reverse?: boolean }) {
  const hops = reverse
    ? [
        ["CE2 → PE2", []],
        ["PE2 → P2", [{ text: "100 S0", tag: "OUTER" }, { text: "24001 S1", tag: "INNER", color: D.warning }]],
        ["P2 → P1", [{ text: "101 S0", tag: "OUTER" }, { text: "24001 S1", tag: "INNER", color: D.warning }]],
        ["P1 → PE1", [{ text: "24001 S1", tag: "PW", color: D.warning }]],
        ["PE1 → CE1", []],
      ]
    : [
        ["CE1 → PE1", []],
        ["PE1 → P1", [{ text: "102 S0", tag: "OUTER" }, { text: "25001 S1", tag: "INNER", color: D.success }]],
        ["P1 → P2", [{ text: "203 S0", tag: "OUTER" }, { text: "25001 S1", tag: "INNER", color: D.success }]],
        ["P2 → PE2", [{ text: "25001 S1", tag: "PW", color: D.success }]],
        ["PE2 → CE2", []],
      ];
  return (
    <DiagramSvg h={150} label={reverse ? "Reverse stacks: Ethernet, 100 over 24001, 101 over 24001, 24001, Ethernet" : "Forward stacks: Ethernet, 102 over 25001, 203 over 25001, 25001, Ethernet"}>
      {(hops as [string, { text: string; tag: string; color?: string }[]][]).map(([t, labels], i) => (
        <g key={t}>
          <text x={70 + i * 125} y={18} textAnchor="middle" fill={D.muted} fontSize={10} fontWeight={700}>
            {t}
          </text>
          <DStack x={70 + i * 125} y={30} labels={labels} payload="Ethernet" w={78} />
        </g>
      ))}
      <text x={320} y={140} textAnchor="middle" fill={D.muted} fontSize={10}>
        only the bottom label has S=1 · P routers touch only the outer label · PHP leaves the PW label alone
      </text>
    </DiagramSvg>
  );
}

export function VpwsLessonGuideContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="vl-mission" eyebrow="This lesson" title="What this lesson teaches" tone="mpls">
        <p>
          Customer A wants its two sites — CE1 (<Mono>192.168.100.1</Mono>) and CE2 (<Mono>192.168.100.2</Mono>) — joined as if by one Ethernet cable, although an MPLS provider core sits in between. The provider must not route their traffic or even look at their addresses. This lesson builds that service as a traditional, LDP-signaled <b className="text-pv-text">pseudowire</b>: a Virtual Private Wire Service (VPWS).
        </p>
        <p>You will watch the two PEs open a targeted LDP session, agree on a pseudowire by its PW ID, and each choose the label it wants to receive. Then a frame crosses the core with two labels, in both directions. Finally PE2 is configured with the wrong PW ID, the wire goes dead while everything else looks healthy — and you find it, fix it and prove it.</p>
        <ChecklistCard
          tone="violet"
          title="By the end of this lesson you can"
          mark="→"
          items={["explain what an attachment circuit is and why the PEs never look at customer addresses", "tell the transport LSP from the pseudowire", "explain targeted LDP, the PW FEC and the PW ID", "say which PE chose which label, in each direction", "list what must match for a pseudowire to come up", "find a pseudowire fault from evidence, fix it and prove it"]}
        />
      </GuideSection>

      <GuideSection id="vl-network" eyebrow="This lesson" title="The network of this lesson" tone="cyan">
        <DiagramFrame caption="The pseudowire is signaled directly between the PE loopbacks; P1 and P2 only carry the transport LSP.">
          <TopologyDiagram />
        </DiagramFrame>
        <FieldTable
          title="Who is who"
          accent="mpls"
          columns={["Device", "Address", "Role"]}
          rows={[
            ["PE1, PE2", <Mono key="1">1.1.1.1, 4.4.4.4</Mono>, "provider edges: attachment circuits, pseudowires, targeted LDP"],
            ["P1, P2", <Mono key="2">2.2.2.2, 3.3.3.3</Mono>, "core: IS-IS and LDP only — no customer state"],
            ["CE1, CE2", <Mono key="3">192.168.100.1, .2</Mono>, "Customer A's sites, VLAN 100"],
          ]}
        />
        <Callout tone="cyan" title="The lab uses the same core, with two customers" icon="i">
          The guided lesson follows Customer A (CE1, CE2, PW ID 5000) on <Mono>ge-0/0/0.100</Mono>. In the L2VPN Lab the PEs use <Mono>ge-0/0/0</Mono> toward the core, so CUST-A&apos;s attachment circuits are <Mono>ge-0/0/1.100</Mono> (CE1A, CE2A) — and CUST-B rides PW 5100 on <Mono>ge-0/0/2.200</Mono> (CE1B, CE2B) with the very same IP addresses. Every output on this page comes from the lab.
        </Callout>
      </GuideSection>

      <GuideSection id="vl-ideas" eyebrow="This lesson" title="Three ideas you need" tone="violet">
        <CompareCards
          items={[
            { title: "Attachment circuit", tone: "cyan", tag: "edge", points: ["port + VLAN at each PE", "decides the service — no MAC or IP lookup"] },
            { title: "Pseudowire", tone: "violet", tag: "signaling", points: ["targeted LDP between the PE loopbacks", "same PW ID at both ends; each PE picks its label"] },
            { title: "Two labels", tone: "mpls", tag: "data plane", points: ["PW label: which wire at the far PE", "transport label: get to the far PE"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="vl-watch" eyebrow="This lesson" title="What you will watch" tone="cyan">
        <FlowSteps
          steps={[
            { title: "Transport", body: "The LSP between the PEs works — and isn't a pseudowire.", tone: "mpls" },
            { title: "Targeted LDP", body: "PE1 and PE2 open a session between loopbacks.", tone: "violet" },
            { title: "Labels", body: "Each PE advertises the label it wants for PW 5000.", tone: "violet" },
            { title: "Frames", body: "CE1 → CE2 and back, two labels each way.", tone: "success" },
            { title: "The incident", body: "PE2 says PW 6000; the wire goes dead.", tone: "danger" },
            { title: "Repair", body: "One PW ID, a fresh frame as proof.", tone: "success" },
          ]}
        />
      </GuideSection>

      <GuideSection id="vl-ac" eyebrow="Service edge" title="Attachment circuits" tone="cyan">
        <p>
          The <b className="text-pv-text">attachment circuit</b> (AC) is the customer&apos;s side of the service at each PE — here one VLAN on one port. A frame tagged VLAN 100 on that port belongs to CUST-A&apos;s wire; the PE doesn&apos;t look at its MAC or IP addresses. That is why CUST-B can use the same 192.168.100.0/24: its frames arrive on a different attachment circuit.
        </p>
        <CliPair cisco={vpOnly(VP_HEALTHY, "PE1", "cisco", "show running-config", /l2transport|encapsulation dot1q/)} junos={vpOnly(VP_HEALTHY_JN, "PE1", "juniper", "show configuration interfaces ge-0/0/1", /.*/)} ciscoCaption="IOS XR · PE1 — l2transport sub-interfaces, one VLAN each" junosCaption="Junos · PE1 — unit 100 with vlan-ccc encapsulation" />
        <PingResult s={OK_B} title="The lab: CE1B pings 192.168.100.2 — the same address CUST-A uses — and reaches its own site" />
      </GuideSection>

      <GuideSection id="vl-lsp-vs-pw" eyebrow="Two different things" title="Transport LSP ≠ pseudowire" tone="violet">
        <CompareCards
          items={[
            { title: "Transport LSP", tone: "mpls", tag: "from the MPLS lesson", points: ["hop-by-hop LDP toward the PE2 loopback", "shared by every service between the PEs", "P routers take part"] },
            { title: "Pseudowire", tone: "violet", tag: "this lesson", points: ["one per service (PW 5000, PW 5100)", "signaled PE to PE over targeted LDP", "P routers know nothing about it"] },
          ]}
        />
        <p className="text-sm text-pv-text-muted">A working LSP is necessary but not sufficient: before targeted LDP signals the pseudowire, PE1 can reach 4.4.4.4 with labels and still has nowhere to put CE1&apos;s frames.</p>
      </GuideSection>

      <GuideSection id="vl-tldp" eyebrow="Control plane" title="Targeted LDP" tone="violet">
        <p>Link LDP discovers neighbors with multicast hellos on each interface. PE1 and PE2 are four hops apart, so they send <b className="text-pv-text">targeted</b> hellos — unicast, to each other&apos;s loopback — and build an LDP session over TCP between 1.1.1.1 and 4.4.4.4. A PE does this for every pseudowire neighbor it is configured with; Junos also needs <Mono>lo0.0</Mono> under <Mono>protocols ldp</Mono>.</p>
        <DiagramFrame caption="Discovery, session, initialization — then one label mapping in each direction.">
          <TldpDiagram />
        </DiagramFrame>
        <CliPair cisco={vpOnly(VP_HEALTHY, "PE1", "cisco", "show mpls ldp discovery", /Targeted|->|LDP Id: 4/)} junos={vpCli(VP_HEALTHY_JN, "PE1", "juniper", "show ldp neighbor")} ciscoCaption="IOS XR · PE1 — targeted hellos to 4.4.4.4, answered" junosCaption="Junos · PE1 — 4.4.4.4 heard on lo0.0: the targeted neighbor" />
      </GuideSection>

      <GuideSection id="vl-fec" eyebrow="Control plane" title="PW FEC and PW ID" tone="violet">
        <p>Over the targeted session each PE sends a label mapping per pseudowire. Its <b className="text-pv-text">PW FEC</b> (FEC 128) names the wire: the pseudowire type (Ethernet) and the <b className="text-pv-text">PW ID</b> — 5000 for CUST-A. The two ends must configure the same PW ID, or each describes a wire the other doesn&apos;t know. The PW ID is never a label.</p>
      </GuideSection>

      <GuideSection id="vl-labels" eyebrow="Control plane" title="Directional labels" tone="mpls">
        <DiagramFrame caption="Each PE advertises the label it wants to receive; the other PE pushes it.">
          <DirectionalDiagram />
        </DiagramFrame>
        <CliPair cisco={vpOnly(VP_HEALTHY, "PE1", "cisco", "show l2vpn xconnect group CUST-A detail", /Group CUST-A|PW: neighbor|MPLS  |Label  |MTU  +1500  |Control word e/)} junos={vpOnly(VP_HEALTHY_JN, "PE1", "juniper", "show l2circuit connections", /Neighbor|Interface  |vc 5000|Incoming label: 299808/)} ciscoCaption="IOS XR · PE1 — receives on 24001, pushes 25001 (PE2's choice)" junosCaption="Junos · PE1 — the same, with Junos label numbers" />
        <Callout tone="cyan" title="The numbers on this page" icon="i">
          The PW labels are the guided lesson&apos;s: PE1 receives on <b>24001</b>, PE2 on <b>25001</b>. For transport the guided lesson uses short labels (P1 = 102, P2 = 203; 101 and 100 on the way back); the lab allocates like IOS XR: P1 = 24102, P2 = 24203 toward 4.4.4.4, and 24202, 24101 back toward 1.1.1.1. Junos numbers everything from 299776.
        </Callout>
      </GuideSection>

      <GuideSection id="vl-pwup" eyebrow="State" title="When the pseudowire comes up" tone="success">
        <ChecklistCard tone="success" title="Up means all of this is true" mark="✓" items={["both attachment circuits exist and are up", "the targeted LDP session is Operational", "both PEs advertised the same PW FEC (Ethernet, PW ID 5000)", "both signaled the same MTU and the same control-word setting", "each PE holds the other's label (Junos also wants an LSP to the neighbor in inet.3)"]} />
        <CliPair cisco={vpCli(VP_HEALTHY, "PE1", "cisco", "show l2vpn xconnect")} junos={vpOnly(VP_HEALTHY_JN, "PE1", "juniper", "show l2circuit connections", /Neighbor|Interface  |\(vc/)} ciscoCaption="IOS XR · PE1 — both cross-connects UP, segment by segment" junosCaption="Junos · PE1 — St Up" />
      </GuideSection>

      <GuideSection id="vl-walk" eyebrow="Data plane" title="A frame, hop by hop" tone="mpls">
        <DiagramFrame caption="CE1 → CE2: PW label 25001 underneath, the transport label on top.">
          <WalkDiagram />
        </DiagramFrame>
        <DiagramFrame caption="CE2 → CE1: PE1's label 24001 underneath.">
          <WalkDiagram reverse />
        </DiagramFrame>
        <FieldTable
          title="Who reads which label (lab numbers)"
          accent="mpls"
          columns={["Router", "Reads", "Does"]}
          rows={[
            ["PE1", "the AC the frame arrived on", "pushes 25001, then 24102"],
            ["P1", "the top label", "swaps 24102 → 24203"],
            ["P2", "the top label", "pops it (PHP) — 25001 stays"],
            ["PE2", "the PW label 25001", "sends the frame out of ge-0/0/1.100, VLAN 100"],
          ]}
        />
        <CliPair cisco={vpOnly(VP_HEALTHY, "PE1", "cisco", "show mpls forwarding", /Local|Label|---|PW\(|4\.4\.4\.4\/32/)} junos={vpOnly(VP_HEALTHY_JN, "PE1", "juniper", "show route table mpls.0", /^299808|^ge-0\/0\/1\.100|via ge-0\/0\/1\.100|Push 299840/)} ciscoCaption="IOS XR · PE1 — incoming 24001 pops toward the AC" junosCaption="Junos · PE1 — receive and transmit entries for the circuit" />
        <PingResult s={OK_A} title="The lab: CE1A pings 192.168.100.2" />
      </GuideSection>

      <GuideSection id="vl-extras" eyebrow="Details" title="Control word and MTU" tone="cyan">
        <CompareCards
          items={[
            { title: "Control word", tone: "violet", tag: "4 bytes", points: ["sits between the labels and the frame", "keeps core routers from mistaking the frame for an IP packet when they load-balance", "both ends must agree (IOS XR: pw-class, Junos: on by default)"] },
            { title: "MTU", tone: "warning", tag: "signaled", points: ["each PE advertises the attachment circuit's MTU", "a mismatch keeps the pseudowire down", "the core needs room for frame + labels + control word"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="vl-working" eyebrow="Evidence" title="What working looks like" tone="success">
        <FieldTable
          title="Healthy, in five questions"
          accent="success"
          columns={["Question", "IOS XR", "Healthy answer"]}
          rows={[
            ["Is each AC up, on the right VLAN?", <Mono key="1">show l2vpn xconnect group CUST-A detail</Mono>, "AC up, VLAN ranges [100, 100]"],
            ["Is the targeted session up?", <Mono key="2">show mpls ldp discovery</Mono>, "1.1.1.1 -> 4.4.4.4 (active/passive), xmit/recv"],
            ["Does each PW have a remote label?", <Mono key="3">show l2vpn xconnect detail</Mono>, "Label 24001 / 25001, state up ( established )"],
            ["Do MTU and control word match?", <Mono key="4">show l2vpn xconnect detail</Mono>, "MTU 1500 / 1500, control word enabled / enabled"],
            ["Does it work?", "a fresh ping from the CE", "delivered, reply back"],
          ]}
        />
      </GuideSection>

      <GuideSection id="vl-incident" eyebrow="Incident" title="The incident" tone="danger">
        <p>CUST-A&apos;s sites lost each other after a change on PE2. The core is fine, the targeted LDP session is up, both customer ports are up — and the pseudowire is down. CUST-B, on the same session, is fine.</p>
        <PingResult s={VP_FAULT} title="The lab: CE1A pings 192.168.100.2 (the ticket)" />
        <CompareCards
          items={[
            { title: "What it is", tone: "danger", tag: "cause", points: ["PE2 defines CUST-A's wire as PW ID 6000", "PE1 advertises 5000, PE2 advertises 6000", "neither receives a mapping for its own PW ID"] },
            { title: "What it can't be", tone: "success", tag: "ruled out", points: ["the targeted session: Operational (CUST-B uses it)", "the transport LSP: complete", "the attachment circuits: up, VLAN 100"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="vl-investigate" eyebrow="Incident" title="Walk the evidence" tone="danger">
        <TroubleshootingFlow
          steps={[
            { question: "Where does the frame stop?", look: "At PE1: the pseudowire for ge-0/0/1.100 is down." },
            { question: "Are the attachment circuits up?", look: "Yes, VLAN 100 on both PEs." },
            { question: "Is the targeted LDP session up?", look: "Yes — and PW 5100 works over it." },
            { question: "What does each PE say about PW 5000?", look: "No remote label. PE2 is configured with PW ID 6000." },
          ]}
        />
        <CliPanel run={vpCli(VP_FAULT, "PE1", "cisco", "show l2vpn xconnect")} caption="IOS XR · PE1 — VPWS-A down, segment 2 DN; VPWS-B up" />
        <CliPanel run={vpOnly(VP_FAULT, "PE2", "cisco", "show l2vpn xconnect group CUST-A detail", /Group CUST-A|PW: neighbor|MPLS  |Label  |Remote label not received/)} caption="IOS XR · PE2 — PW ID 6000, remote label unknown" />
        <CliPanel run={vpOnly(VP_FAULT_JN, "PE1", "juniper", "show l2circuit connections", /OL --|Neighbor|Interface  |\(vc/)} caption="Junos · PE1 — St OL: no outgoing label for vc 5000" />
      </GuideSection>

      <GuideSection id="vl-fix" eyebrow="Incident" title="Repair and prove it" tone="success">
        <CliPair cisco={{ prompt: "RP/0/RP0/CPU0:PE2(config)#", command: "l2vpn", output: "RP/0/RP0/CPU0:PE2(config-l2vpn)#xconnect group CUST-A\nRP/0/RP0/CPU0:PE2(config-l2vpn-xc)#p2p VPWS-A\nRP/0/RP0/CPU0:PE2(config-l2vpn-xc-p2p)#no neighbor ipv4 1.1.1.1 pw-id 6000\nRP/0/RP0/CPU0:PE2(config-l2vpn-xc-p2p)#neighbor ipv4 1.1.1.1 pw-id 5000\nRP/0/RP0/CPU0:PE2(config-l2vpn-xc-p2p-pw)#pw-class CW\nRP/0/RP0/CPU0:PE2(config-l2vpn-xc-p2p-pw)#commit" }} junos={{ prompt: "admin@PE2# ", command: "set protocols l2circuit neighbor 1.1.1.1 interface ge-0/0/1.100 virtual-circuit-id 5000", output: "\n[edit]\nadmin@PE2# commit and-quit\ncommit complete\nExiting configuration mode" }} ciscoCaption="IOS XR · PE2" junosCaption="Junos · PE2 — set replaces the single virtual-circuit-id" />
        <PingResult s={VP_FIXED} title="The lab: a fresh ping after the fix" />
        <ChecklistCard tone="success" title="Proved, not assumed" mark="✓" items={["both PEs advertise PW ID 5000 and hold each other's label", "the cross-connect is UP on both PEs", "a fresh ping from CE1A reaches CE2A and the reply comes back"]} />
      </GuideSection>

      <GuideSection id="vl-other" eyebrow="Beyond this incident" title="Other ways a pseudowire fails" tone="warning">
        <FailureSignatures
          items={[
            { tag: "MTU", title: "Different MTUs", tone: "danger", points: ["remote label known", "pseudowire down: MTU mismatch"] },
            { tag: "NBR", title: "Wrong neighbor address", tone: "warning", points: ["targeted hellos unanswered", "no mapping arrives"] },
            { tag: "VLAN", title: "AC on the wrong VLAN", tone: "violet", points: ["pseudowire up", "frames dropped at the edge"] },
            { tag: "LSP", title: "Transport broken", tone: "warning", points: ["XR: PW up, P2 drops the PW label", "Junos: PW down, no LSP in inet.3"] },
          ]}
        />
        <p className="text-sm text-pv-text-muted">Each is a ticket in the L2VPN Lab, together with this incident.</p>
      </GuideSection>

      <GuideSection id="vl-model" eyebrow="Mental model" title="Mental model" tone="cyan">
        <p>
          Think of a pneumatic tube between two offices. Each office has one hatch for this tube (the attachment circuit): whatever is dropped in comes out at the other end, unopened. The tube itself rides inside the building&apos;s shared mail chutes (the transport LSP). Before it works, the two mailrooms phone each other (targeted LDP) and agree on the tube&apos;s number (the PW ID); each tells the other which slot to drop capsules into on its side (the directional label). If one mailroom thinks it&apos;s tube 6000, nothing ever arrives — even though the phones, the chutes and both hatches work.
        </p>
        <Callout tone="cyan" title="When it breaks, ask in this order" icon="→">
          Where does a fresh ping stop? Does each CE&apos;s VLAN land in an attachment circuit? Is the targeted LDP session up? Does each pseudowire have a remote label — same PW ID, MTU and control word? Is the transport LSP to the far PE complete?
        </Callout>
      </GuideSection>

      <GuideSection id="vl-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "VPWS", def: "Virtual Private Wire Service: a point-to-point Layer 2 service between two attachment circuits." },
            { term: "AC", def: "Attachment circuit: the customer-facing port or VLAN of the service at one PE." },
            { term: "PW", def: "Pseudowire: the emulated circuit between two PEs, one label path in each direction." },
            { term: "Targeted LDP", def: "An LDP session between non-adjacent routers (the PE loopbacks), used to signal pseudowires." },
            { term: "PW FEC / PW ID", def: "FEC 128: the pseudowire type + an ID both ends must configure identically." },
            { term: "PW label", def: "The inner label, allocated by the receiving PE; it selects the attachment circuit." },
            { term: "Control word", def: "An optional 4-byte header between the labels and the frame." },
            { term: "Cross-connect", def: "IOS XR's name for the binding of an AC to a pseudowire (Junos: an l2circuit)." },
          ]}
        />
      </GuideSection>

      <GuideSection id="vl-recap" eyebrow="Reference" title="Recap" tone="success">
        <ChecklistCard tone="success" title="You can now" mark="✓" items={["explain attachment circuits and L2 transparency", "tell the LSP from the pseudowire", "explain targeted LDP, the PW FEC and the PW ID", "follow directional labels in both directions", "list what must match for a pseudowire to come up", "find, fix and prove a PW ID mismatch"]} />
      </GuideSection>

      <GuideSection id="vl-practice" eyebrow="Next" title="Practice it" tone="violet">
        <p>The Deep Dive tab covers VPWS in full: the PWE3 reference model, attachment-circuit types, FEC 128 and 129, label mapping fields, the control word, MTU, PW status, transport dependency, IOS XR and Junos configuration, and every failure signature with real evidence. The lab lets you operate it.</p>
        <LessonLabBridge />
        <PresentationBridge>Rewatch the L2VPN presentation.</PresentationBridge>
      </GuideSection>
    </div>
  );
}
