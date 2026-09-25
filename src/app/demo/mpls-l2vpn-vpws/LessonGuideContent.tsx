import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DLink, DNode, DPill, DiagramFrame, DiagramSvg, FieldTable, FlowSteps, Glossary, GuideSection, Mono } from "@/components/lesson/GuideBlocks";
import { DStack } from "@/components/lesson/MplsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";

export const VPWS_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "vl-mission", label: "The mission" },
  { id: "vl-topology", label: "CE / PE / P topology" },
  { id: "vl-ac", label: "Attachment circuits" },
  { id: "vl-transport", label: "Transport first" },
  { id: "vl-lsp-vs-pw", label: "Transport LSP ≠ pseudowire" },
  { id: "vl-tldp", label: "Targeted LDP" },
  { id: "vl-fec", label: "PW FEC and PW ID" },
  { id: "vl-labels", label: "Directional receive labels" },
  { id: "vl-pwup", label: "When the PW comes UP" },
  { id: "vl-encap", label: "Ingress: two labels" },
  { id: "vl-core", label: "Core: transport only" },
  { id: "vl-egress", label: "Egress: PW lookup" },
  { id: "vl-reverse", label: "The reverse direction" },
  { id: "vl-planes", label: "Control vs data plane" },
  { id: "vl-extras", label: "Control word, status, MTU" },
  { id: "vl-fault", label: "The PW-down incident" },
  { id: "vl-challenge", label: "The engineer challenge" },
  { id: "vl-glossary", label: "Glossary" },
  { id: "vl-recap", label: "Mental model" },
];

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
        MPLS core · IGP + LDP transport
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
    <>
      <GuideSection id="vl-mission" eyebrow="Introduction" title="The mission: one virtual wire" tone="mpls">
        <p>
          CE1 (<Mono>192.168.100.1</Mono>) and CE2 (<Mono>192.168.100.2</Mono>) must behave as if a single Ethernet cable joined them, even though an MPLS provider core sits in between. The provider never routes their traffic or looks at their IP addresses. This lesson builds service <Mono>CUST-A-VPWS</Mono> as a traditional, LDP-signaled pseudowire.
        </p>
        <Callout tone="cyan" title="Scope of this simulation" icon="i">
          One Ethernet pseudowire, PW ID <Mono>5000</Mono>, signaled by targeted LDP with a PWid FEC (the FEC 128 style). Transport is LDP only; RSVP-TE and SR-MPLS are mentioned as alternatives but not simulated. EVPN-VPWS, VPLS and FEC 129 are compared, not built.
        </Callout>
      </GuideSection>

      <GuideSection id="vl-topology" eyebrow="Setup" title="CE / PE / P topology" tone="cyan">
        <DiagramFrame caption="The signaling session skips the core; the data path goes through it.">
          <TopologyDiagram />
        </DiagramFrame>
        <FieldTable
          title="Roles"
          accent="mpls"
          columns={["Device", "Role", "Knows about the PW?"]}
          rows={[
            ["CE1 / CE2", "Customer Ethernet devices", "No: they just send frames"],
            ["PE1 / PE2", "Pseudowire endpoints, own the ACs", "Yes: FEC, labels, AC"],
            ["P1 / P2", "Transport-only core", "No: outer label only"],
          ]}
        />
      </GuideSection>

      <GuideSection id="vl-ac" eyebrow="Service edge" title="Attachment circuits" tone="ip">
        <p>
          The <b className="text-pv-text">attachment circuit</b> is the customer-facing side of the service on each PE: <Mono>ge-0/0/0.100</Mono> on PE1 toward CE1 and on PE2 toward CE2. It isn&apos;t the pseudowire; it&apos;s where the pseudowire starts and ends locally.
        </p>
        <Callout tone="warning" title="VLAN 100 vs PW ID 5000" icon="!">
          VLAN 100 is a local, per-interface tag on the AC. PW ID 5000 names the pseudowire in signaling between PE1 and PE2. They are different numbers for different jobs.
        </Callout>
      </GuideSection>

      <GuideSection id="vl-transport" eyebrow="Prerequisite" title="Transport first" tone="mpls">
        <FlowSteps
          steps={[
            { title: "IGP UP", body: "PE1, P1, P2 and PE2 reach each other's loopbacks.", tone: "ospf" },
            { title: "LDP transport UP", body: <>PE2 advertises implicit-null to P2; P2 allocates <Mono>203</Mono>; P1 allocates <Mono>102</Mono>.</>, tone: "mpls" },
            { title: "Transport LSP UP", body: "PE1 can reach 4.4.4.4 by label switching alone.", tone: "success" },
          ]}
        />
        <p>At this point the pseudowire is still <b className="text-pv-text">DOWN</b>. Reachability alone doesn&apos;t tell PE2 which customer port a frame belongs to.</p>
      </GuideSection>

      <GuideSection id="vl-lsp-vs-pw" eyebrow="Two different things" title="Transport LSP ≠ pseudowire" tone="violet">
        <CompareCards
          items={[
            { title: "Transport LSP", tone: "mpls", tag: "outer label", points: ["Gets a packet from PE1 to PE2", "Built hop by hop by ordinary LDP", "P routers act on it"] },
            { title: "Pseudowire", tone: "violet", tag: "inner label", points: ["Identifies the customer service at the egress PE", "Signaled PE-to-PE by targeted LDP", "Only PE1 and PE2 understand it"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="vl-tldp" eyebrow="Control plane" title="Targeted LDP" tone="violet">
        <DiagramFrame caption="PacketVerse lifecycle: DOWN → TARGETED HELLO → TCP SESSION → INITIALIZATION → OPERATIONAL (a teaching simplification, not an exact FSM).">
          <TldpDiagram />
        </DiagramFrame>
        <p>
          Unlike link LDP, the two PEs aren&apos;t neighbors, so the session is explicitly configured and uses <b className="text-pv-text">unicast</b> targeted Hellos between loopbacks. The TCP session carries signaling only; customer frames never travel inside it.
        </p>
      </GuideSection>

      <GuideSection id="vl-fec" eyebrow="Control plane" title="PW FEC and PW ID" tone="violet">
        <p>
          Both PEs describe the same pseudowire with the same FEC: PW type <Mono>Ethernet</Mono> + PW ID <Mono>5000</Mono> (shown as <Mono>PW-ETHERNET-5000</Mono>). The PW ID is an identifier in signaling. It is <b className="text-pv-text">never</b> the label pushed on a packet.
        </p>
      </GuideSection>

      <GuideSection id="vl-labels" eyebrow="Control plane" title="Directional receive labels" tone="mpls">
        <DiagramFrame caption="Each PE allocates the label it wants to receive, and advertises it to the other PE.">
          <DirectionalDiagram />
        </DiagramFrame>
        <FieldTable
          title="Label ownership in this lesson"
          accent="mpls"
          columns={["Direction", "Inner PW label", "Owned / advertised by"]}
          rows={[
            ["CE1 → CE2 (PE1 sends)", <Mono key="a">25001</Mono>, "PE2 (receiver)"],
            ["CE2 → CE1 (PE2 sends)", <Mono key="b">24001</Mono>, "PE1 (receiver)"],
          ]}
        />
      </GuideSection>

      <GuideSection id="vl-pwup" eyebrow="State" title="When the pseudowire comes UP" tone="success">
        <ChecklistCard
          tone="success"
          mark="✓"
          title="This lesson's PW-UP conditions (deterministic model)"
          items={["Both attachment circuits up", "Targeted LDP OPERATIONAL", "PW FEC matches on both PEs", "Compatible PW type", "Remote label learned on both sides", "Transport LSP reachable"]}
        />
      </GuideSection>

      <GuideSection id="vl-encap" eyebrow="Data plane" title="Ingress: PE1 builds the two-label stack" tone="mpls">
        <DiagramFrame caption="Forward direction, CE1 → CE2. The PW label is pushed first, so it is the bottom of the stack.">
          <WalkDiagram />
        </DiagramFrame>
        <FlowSteps
          steps={[
            { title: "AC ingress", body: "Frame arrives on ge-0/0/0.100 → service CUST-A-VPWS → pseudowire to PE2.", tone: "ip" },
            { title: "Push PW label", body: <>PE2&apos;s advertised <Mono>25001</Mono>. Stack was empty, so S=1.</>, tone: "violet" },
            { title: "Push transport label", body: <><Mono>102</Mono> toward P1 on top, S=0. <Mono>25001</Mono> keeps S=1.</>, tone: "mpls" },
          ]}
        />
      </GuideSection>

      <GuideSection id="vl-core" eyebrow="Data plane" title="Core: P routers act on transport only" tone="mpls">
        <p>
          P1 swaps the outer label <Mono>102 → 203</Mono>. P2 is the penultimate hop and pops it (PHP), leaving <Mono>25001 S1</Mono>. Neither P router ever reads the PW label, the PW ID, the AC or a customer MAC.
        </p>
      </GuideSection>

      <GuideSection id="vl-egress" eyebrow="Data plane" title="Egress: PE2's PW lookup" tone="success">
        <p>
          PE2 looks up <Mono>25001</Mono>, its <b className="text-pv-text">own</b> receive label, and finds CUST-A-VPWS → AC <Mono>ge-0/0/0.100</Mono> → CE2. It pops the PW label and delivers the Ethernet frame. No MAC lookup is needed: there is only one possible destination.
        </p>
      </GuideSection>

      <GuideSection id="vl-reverse" eyebrow="Data plane" title="The reverse direction" tone="warning">
        <DiagramFrame caption="CE2 → CE1 uses PE1's label 24001. The transport labels are different too.">
          <WalkDiagram reverse />
        </DiagramFrame>
        <p>PE2 pushes PE1&apos;s label <Mono>24001</Mono>, not its own 25001, then transport <Mono>100</Mono>. P2 swaps to <Mono>101</Mono>, and P1 pops it (PHP). PE1 looks up its own receive label and delivers to CE1.</p>
      </GuideSection>

      <GuideSection id="vl-planes" eyebrow="Big picture" title="Control plane vs data plane" tone="violet">
        <CompareCards
          items={[
            { title: "Control plane", tone: "violet", tag: "builds the wire", points: ["IGP + LDP transport LSPs", "Targeted LDP session PE1 ↔ PE2", "PW FEC match, label mappings 24001 / 25001"] },
            { title: "Data plane", tone: "success", tag: "uses the wire", points: ["Ethernet frame on the AC", "Push PW label, push transport label", "P routers swap/pop the outer label; PE pops the PW label"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="vl-extras" eyebrow="Details" title="Control word, PW status and MTU" tone="cyan">
        <ChecklistCard
          tone="cyan"
          mark="i"
          title="As modeled here"
          items={[
            "Control word: enabled on both PEs; a mismatch is reported but informational in this model.",
            "PW status: an AC failure takes the service down even though targeted LDP and transport stay up.",
            "MTU lab: PE1/PE2 1500 vs 1400 can be compared; whether a mismatch blocks the PW is a documented modeling choice here, because real behavior varies by implementation.",
          ]}
        />
      </GuideSection>

      <GuideSection id="vl-fault" eyebrow="Troubleshooting" title="The PW-down incident" tone="danger">
        <p>
          CE1 can&apos;t reach CE2. Loopbacks are reachable, transport is up, targeted LDP is UP and both ACs are UP, yet the pseudowire stays DOWN.
        </p>
        <ChecklistCard
          tone="danger"
          mark="→"
          title="How to reason about it (no spoilers)"
          items={["Walk the ladder bottom-up: transport, targeted LDP, ACs.", "Then compare what each PE signals for this pseudowire, field by field.", "Remember what must match for a remote label to be associated.", "Verify any fix with real traffic, not just a state change."]}
        />
      </GuideSection>

      <GuideSection id="vl-challenge" eyebrow="Challenge" title="Build the virtual wire" tone="violet">
        <p>The final challenge is a checklist of everything you have already demonstrated: transport, loopbacks, targeted LDP, a matching FEC and PW ID, local/remote labels, PW UP, the two-label stack, core behavior, PHP, egress lookup and verified delivery.</p>
      </GuideSection>

      <GuideSection id="vl-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "AC", def: "Attachment circuit: the local customer-facing interface/VLAN of the service." },
            { term: "PW", def: "Pseudowire: the emulated point-to-point circuit between PE1 and PE2." },
            { term: "Targeted LDP", def: "LDP session between non-adjacent PE loopbacks, used to signal the PW." },
            { term: "PW FEC", def: "PW type + PW ID: what both PEs must agree on." },
            { term: "PW ID", def: "5000: identifies the PW in signaling, never pushed as a label." },
            { term: "PW label", def: "Inner, directional label owned by the receiving PE (24001 / 25001)." },
            { term: "Transport label", def: "Outer label that carries the packet across the core (102, 203; reverse 100, 101)." },
            { term: "PHP", def: "The penultimate P router pops the transport label." },
          ]}
        />
      </GuideSection>

      <GuideSection id="vl-recap" eyebrow="Recap" title="Mental model" tone="mpls">
        <div className="rounded-2xl border border-pv-mpls/30 bg-gradient-to-br from-pv-mpls/10 to-pv-violet/5 p-5 text-sm leading-relaxed text-pv-text">
          Transport gets packets between PE loopbacks; the pseudowire says which customer port they belong to. Targeted LDP lets each PE tell the other “send this PW to me with my label”. Data then rides with two labels: outer transport, rewritten hop by hop, and inner PW label, owned by the receiver and read only by the egress PE.
        </div>
      </GuideSection>
    </>
  );
}
