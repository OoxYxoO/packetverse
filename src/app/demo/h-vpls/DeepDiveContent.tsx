import { CompareCards, DArrow, DIAGRAM as D, DLink, DNode, DPill, DRegion, DiagramFrame, DiagramSvg, FailureSignatures, FieldTable, GuideSection, Misconceptions, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { ExplainIt, KnowledgeQuiz, PracticeBridge, type KnowledgeQuestion } from "@/components/lesson/GuideInteractive";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import { PresentationBridge } from "@/components/presentation/LessonPresentation";
import { CliPair, CliPanel, FailureWalk } from "@/components/lesson/GuideCli";
import { hvApply, hvTicket, hvTicketState, type HvOs, type HvTicketId } from "@/lib/sim-engine/scenarios/hvNet";
import { HV_HEALTHY, HV_HEALTHY_JN, HV_LEARNED, HV_LEARNED_JN, PingResult, hvCli, hvOnly } from "./LessonGuideContent";

const G = { foundation: "Foundation", arch: "Architecture", fwd: "Forwarding", ops: "Operations", resil: "Resilience", trouble: "Troubleshooting", beyond: "Beyond this lesson", master: "Master it" };
export const HVPLS_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "hd-why", label: "Why hierarchy", group: G.foundation },
  { id: "hd-network", label: "The network you will study", group: G.foundation },
  { id: "hd-model", label: "The two-tier model", group: G.arch },
  { id: "hd-scale", label: "The arithmetic", group: G.arch },
  { id: "hd-access", label: "Access options", group: G.arch },
  { id: "hd-matrix", label: "The forwarding matrix", group: G.fwd },
  { id: "hd-spoke2spoke", label: "Spoke to spoke through a hub", group: G.fwd },
  { id: "hd-learning", label: "Learning per tier", group: G.fwd },
  { id: "hd-bum", label: "Flooding and replication", group: G.fwd },
  { id: "hd-labels", label: "Labels on each tier", group: G.fwd },
  { id: "hd-config", label: "Configuring it: IOS XR and Junos", group: G.ops },
  { id: "hd-verify", label: "How to verify", group: G.ops },
  { id: "hd-redundancy", label: "Dual-homed access", group: G.resil },
  { id: "hd-failure", label: "Failure domains", group: G.resil },
  { id: "hd-signatures", label: "Failure signatures", group: G.trouble },
  { id: "hd-workflow", label: "Investigation workflow", group: G.trouble },
  { id: "hd-tickets", label: "Five faults, evidence to proof", group: G.trouble },
  { id: "hd-next", label: "What came next", group: G.beyond },
  { id: "hd-myths", label: "Common misconceptions", group: G.master },
  { id: "hd-quiz", label: "Knowledge check", group: G.master },
  { id: "hd-explain", label: "Can you explain it?", group: G.master },
  { id: "hd-practice", label: "Practice in the H-VPLS Lab", group: G.master },
];

// Real CLI output and ping results: the H-VPLS Lab's own command sets and model.
const ticket = (id: HvTicketId, os: HvOs = "xr") => hvTicket(id).repro.reduce((acc, a) => hvApply(acc, a), hvTicketState(id, 1, os));
const T = { spoke: ticket("spoke"), pwid: ticket("pwid"), mesh: ticket("mesh"), vlan: ticket("vlan"), transport: ticket("transport"), transportJn: ticket("transport", "junos"), pwidJn: ticket("pwid", "junos") };

function LabBridge() {
  const openLab = usePracticeLabOpener();
  return (
    <PracticeBridge label="Open the H-VPLS Lab" onPractice={openLab}>
      The network from this page, IOS XR or Junos, your own copy. Nothing you do there changes your lesson progress.
    </PracticeBridge>
  );
}

/** The lab's network. */
function LabNet() {
  const n: Record<string, [number, number, string, string]> = {
    CE1: [40, 40, "…100.1", D.ip],
    CE2: [40, 100, "…100.2", D.ip],
    MTU1: [140, 70, "10.0.0.1", D.warning],
    PE1: [260, 70, "1.1.1.1", D.mpls],
    P1: [360, 135, "10.10.10.1", D.mpls],
    PE2: [260, 200, "2.2.2.2", D.mpls],
    MTU2: [140, 200, "10.0.0.2", D.warning],
    CE3: [40, 175, "…100.3", D.ip],
    CE5: [40, 230, "…100.5 (spare)", D.faint],
    PE3: [460, 135, "3.3.3.3", D.mpls],
    MTU3: [560, 135, "10.0.0.3", D.warning],
    CE4: [610, 70, "…100.4", D.ip],
  };
  const phys: [string, string, string][] = [["CE1", "MTU1", D.line], ["CE2", "MTU1", D.line], ["CE3", "MTU2", D.line], ["CE5", "MTU2", D.faint], ["MTU3", "CE4", D.line], ["MTU1", "PE1", D.warning], ["MTU2", "PE2", D.warning], ["PE3", "MTU3", D.warning], ["PE1", "P1", D.mpls], ["PE2", "P1", D.mpls], ["PE3", "P1", D.mpls]];
  return (
    <DiagramSvg h={262} label="MTU1 with CE1 and CE2 cabled to PE1; MTU2 with CE3 and a spare CE5 cabled to PE2; MTU3 with CE4 cabled to PE3; PE1, PE2 and PE3 connected through P1">
      <DRegion x={205} y={30} w={310} h={200} label="IS-IS + LDP core" color={D.mpls} />
      {phys.map(([a, b, c]) => (
        <DLink key={a + b} x1={n[a][0]} y1={n[a][1]} x2={n[b][0]} y2={n[b][1]} color={c} dashed={b === "CE5" || a === "CE5"} />
      ))}
      {Object.entries(n).map(([id, [x, y, sub, c]]) => (
        <DNode key={id} x={x} y={y} label={id} sub={sub} accent={c} w={id.startsWith("CE") ? 80 : 84} />
      ))}
      <text x={320} y={256} textAnchor="middle" fill={D.muted} fontSize={10}>
        spokes MTU1–PE1 · MTU2–PE2 · MTU3–PE3 (directly cabled) · mesh PE1–PE2–PE3 (across P1) · PW ID 100
      </text>
    </DiagramSvg>
  );
}

function ModelDiagram() {
  return (
    <DiagramSvg h={228} label="Access tier of MTU-s bridges each with one spoke to a PE-rs; core tier of PE-rs in a full mesh">
      <DRegion x={140} y={16} w={360} h={90} label="core tier: PE-rs full mesh" color={D.mpls} />
      <DRegion x={20} y={130} w={600} h={88} label="" color={D.warning} />
      {/* Label sits at the bottom edge: the spokes climb out through the top of this region. */}
      <text x={32} y={211} fill={D.warning} fontSize={10} fontWeight={700}>
        access tier: MTU-s bridges
      </text>
      {[210, 320, 430].map((x, i) => (
        <DNode key={x} x={x} y={66} label={`PE-rs ${i + 1}`} accent={D.mpls} w={86} h={32} />
      ))}
      <DLink x1={253} y1={66} x2={277} y2={66} color={D.violet} />
      <DLink x1={363} y1={66} x2={387} y2={66} color={D.violet} />
      <path d="M210 50 Q320 20 430 50" fill="none" stroke={D.violet} strokeWidth={2} />
      {[80, 190, 300, 410, 520].map((x, i) => {
        const hub = [210, 210, 320, 430, 430][i];
        return (
          <g key={x}>
            <DLink x1={x} y1={160} x2={hub} y2={82} color={D.warning} dashed />
            <DNode x={x} y={175} label={`MTU-s ${i + 1}`} accent={D.warning} w={80} h={30} />
          </g>
        );
      })}
    </DiagramSvg>
  );
}

function ScaleDiagram() {
  const rows: [number, number, number][] = [
    [10, 45, 13],
    [30, 435, 33],
    [100, 4950, 103],
  ];
  return (
    <DiagramSvg h={150} label="With 3 PE-rs: 10 sites flat 45 vs hierarchical 13; 30 sites 435 vs 33; 100 sites 4950 vs 103">
      {rows.map(([n, flat, hier], i) => {
        const f = Math.log10(flat) * 110;
        const h = Math.log10(hier) * 110;
        return (
          <g key={n}>
            <text x={80} y={32 + i * 42} textAnchor="end" fill={D.text} fontSize={10.5}>
              {n} sites
            </text>
            <rect x={90} y={20 + i * 42} width={f} height={14} rx={3} fill={D.danger} fillOpacity={0.35} />
            <text x={96 + f} y={32 + i * 42} fill={D.danger} fontSize={9.5}>
              flat {flat}
            </text>
            <rect x={90} y={36 + i * 42} width={h} height={10} rx={3} fill={D.success} fillOpacity={0.4} />
            <text x={96 + h} y={45 + i * 42} fill={D.success} fontSize={9.5}>
              H-VPLS {hier}
            </text>
          </g>
        );
      })}
      <text x={620} y={145} textAnchor="end" fill={D.muted} fontSize={9.5}>
        3 PE-rs core (3 mesh PWs) + one spoke per site · log-scaled bars
      </text>
    </DiagramSvg>
  );
}

function MatrixDiagram() {
  const roles = ["AC", "SPOKE", "MESH"];
  return (
    <DiagramSvg h={170} label="Forwarding matrix: every combination allowed except mesh ingress to mesh egress">
      <text x={130} y={24} textAnchor="middle" fill={D.muted} fontSize={10}>
        ingress ↓ / egress →
      </text>
      {roles.map((r, i) => (
        <text key={`c${r}`} x={260 + i * 110} y={24} textAnchor="middle" fill={D.text} fontSize={11} fontWeight={700}>
          {r}
        </text>
      ))}
      {roles.map((row, i) => (
        <g key={row}>
          <text x={130} y={62 + i * 42} textAnchor="middle" fill={D.text} fontSize={11} fontWeight={700}>
            {row}
          </text>
          {roles.map((col, j) => {
            const no = row === "MESH" && col === "MESH";
            return (
              <g key={col}>
                <rect x={215 + j * 110} y={42 + i * 42} width={90} height={32} rx={8} fill={no ? D.danger : D.success} fillOpacity={0.15} stroke={no ? D.danger : D.success} />
                <text x={260 + j * 110} y={63 + i * 42} textAnchor="middle" fill={no ? D.danger : D.success} fontSize={13} fontWeight={700}>
                  {no ? "✕" : "✓"}
                </text>
              </g>
            );
          })}
        </g>
      ))}
    </DiagramSvg>
  );
}

function SpokeToSpoke() {
  return (
    <DiagramSvg h={180} label="Two MTU-s on the same PE-rs reach each other through the hub: spoke in, spoke out">
      <DNode x={320} y={40} label="PE-rs" accent={D.mpls} w={90} />
      <DNode x={150} y={125} label="MTU-s A" accent={D.warning} w={90} />
      <DNode x={490} y={125} label="MTU-s B" accent={D.warning} w={90} />
      <DArrow x1={190} y1={108} x2={280} y2={58} color={D.warning} />
      <DArrow x1={360} y1={58} x2={450} y2={108} color={D.warning} />
      <text x={222} y={74} textAnchor="end" fill={D.warning} fontSize={10} fontWeight={700}>
        spoke in
      </text>
      <text x={418} y={74} fill={D.warning} fontSize={10} fontWeight={700}>
        spoke out ✓
      </text>
      <text x={320} y={172} textAnchor="middle" fill={D.muted} fontSize={10}>
        the hub bridges between its own spokes; no direct MTU-s ↔ MTU-s PW is needed
      </text>
    </DiagramSvg>
  );
}

function RedundancyDiagram() {
  return (
    <DiagramSvg h={170} label="An MTU-s dual-homed to two PE-rs with a primary and a standby spoke">
      <DNode x={120} y={85} label="MTU-s" accent={D.warning} w={90} />
      <DNode x={440} y={40} label="PE-rs 1" accent={D.mpls} w={90} />
      <DNode x={440} y={130} label="PE-rs 2" accent={D.mpls} w={90} />
      <DLink x1={165} y1={78} x2={395} y2={44} color={D.success} label="primary spoke" labelDy={-6} />
      <DLink x1={165} y1={92} x2={395} y2={126} color={D.faint} dashed label="standby spoke" labelDy={18} />
      <DLink x1={440} y1={56} x2={440} y2={114} color={D.violet} />
      <text x={432} y={89} textAnchor="end" fill={D.violet} fontSize={10} fontWeight={700}>
        mesh
      </text>
      <text x={600} y={90} textAnchor="end" fill={D.muted} fontSize={9.5}>
        only one spoke forwards at a time
      </text>
    </DiagramSvg>
  );
}

function FailureDiagram() {
  return (
    <DiagramSvg h={170} label="A spoke failure isolates one access site from the core; a PE-rs failure isolates every MTU-s behind it; a mesh PW failure is local to that pair">
      <DPill x={130} y={40} text="spoke fails" color={D.warning} w={120} />
      <text x={130} y={70} textAnchor="middle" fill={D.text} fontSize={10}>
        that MTU-s: remote cut
      </text>
      <text x={130} y={86} textAnchor="middle" fill={D.success} fontSize={10}>
        local switching survives
      </text>
      <DPill x={320} y={40} text="PE-rs fails" color={D.danger} w={120} />
      <text x={320} y={70} textAnchor="middle" fill={D.text} fontSize={10}>
        every MTU-s on that hub
      </text>
      <text x={320} y={86} textAnchor="middle" fill={D.muted} fontSize={10}>
        unless dual-homed
      </text>
      <DPill x={510} y={40} text="mesh PW fails" color={D.violet} w={130} />
      <text x={510} y={70} textAnchor="middle" fill={D.text} fontSize={10}>
        that hub pair only
      </text>
      <text x={510} y={86} textAnchor="middle" fill={D.muted} fontSize={10}>
        no relay via a third hub
      </text>
      <text x={320} y={140} textAnchor="middle" fill={D.muted} fontSize={10}>
        hierarchy concentrates state, and concentrates impact
      </text>
    </DiagramSvg>
  );
}



const QUIZ: KnowledgeQuestion[] = [
  {
    id: "q-count",
    prompt: "4 PE-rs and 40 MTU-s, one spoke each. How many pseudowires?",
    options: [
      { id: "a", label: "46 — 6 mesh + 40 spokes" },
      { id: "b", label: "946 — a full mesh of 44" },
      { id: "c", label: "44" },
    ],
    correctId: "a",
    explanation: "Core mesh 4 × 3 / 2 = 6, plus one spoke per access device.",
  },
  {
    id: "q-rule",
    prompt: "A PE-rs receives a broadcast on a mesh pseudowire. Where may it send copies?",
    options: [
      { id: "a", label: "To its spokes and attachment circuits — never to another mesh pseudowire" },
      { id: "b", label: "Everywhere except back where it came from" },
      { id: "c", label: "Only to its attachment circuits" },
    ],
    correctId: "a",
    explanation: "Only mesh → mesh is forbidden. Spokes are outside the core's split-horizon group.",
  },
  {
    id: "q-spoke-in",
    prompt: "A PE-rs receives a broadcast on a spoke. Where may it send copies?",
    options: [
      { id: "a", label: "To every mesh neighbor, its other spokes and its attachment circuits" },
      { id: "b", label: "Only to its attachment circuits" },
      { id: "c", label: "Only back down the spoke" },
    ],
    correctId: "a",
    explanation: "A spoke behaves like an access port of the hub's bridge: its frames may enter the core.",
  },
  {
    id: "q-local",
    prompt: "CE1 and CE2 are behind the same MTU-s. After learning, which devices carry their ping?",
    options: [
      { id: "a", label: "Only the MTU-s" },
      { id: "b", label: "The MTU-s and its hub" },
      { id: "c", label: "Every PE-rs" },
    ],
    correctId: "a",
    explanation: "Known unicast between two local attachment circuits is switched on the MTU-s itself.",
  },
  {
    id: "q-xr",
    prompt: "On an IOS XR PE-rs, where does a spoke belong?",
    options: [
      { id: "a", label: "Directly under the bridge domain, as an access pseudowire" },
      { id: "b", label: "Inside the VFI with the mesh neighbors" },
      { id: "c", label: "In a separate bridge domain" },
    ],
    correctId: "a",
    explanation: "The VFI is the split-horizon group. A spoke inside it becomes a mesh member.",
  },
  {
    id: "q-junos",
    prompt: "On Junos, what puts a neighbor in the core's split-horizon group?",
    options: [
      { id: "a", label: "Listing it directly under protocols vpls (the default mesh group)" },
      { id: "b", label: "Listing it under mesh-group SPOKES" },
      { id: "c", label: "Adding local-switching" },
    ],
    correctId: "a",
    explanation: "The default mesh group is the core. Spokes go into a mesh group of their own.",
  },
  {
    id: "q-island",
    prompt: "Every pseudowire is up, the transport is fine, an MTU-s's sites reach only each other. First suspect?",
    options: [
      { id: "a", label: "Its hub has the spoke in the core's split-horizon group" },
      { id: "b", label: "A missing mesh pseudowire" },
      { id: "c", label: "The MTU-s's MAC table" },
    ],
    correctId: "a",
    explanation: "A missing mesh pseudowire cuts one pair of hubs, and shows down. Here nothing is down — the role is wrong.",
  },
  {
    id: "q-mesh",
    prompt: "PE2 loses its mesh pseudowire to PE3. Which sites lose each other?",
    options: [
      { id: "a", label: "Those behind PE2 and those behind PE3" },
      { id: "b", label: "Nobody — PE1 relays" },
      { id: "c", label: "Every site" },
    ],
    correctId: "a",
    explanation: "PE1 may not relay between two mesh pseudowires. The core mesh must be full.",
  },
];

export function HvplsDeepDiveContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="hd-why" eyebrow="Foundation" title="Why hierarchy" tone="mpls">
        <p>Flat VPLS (RFC 4762) puts every participating PE into one full mesh: N(N−1)/2 pseudowires and targeted sessions, every PE carrying every MAC, every new site touching every existing PE. Section 10 of the same RFC adds hierarchy: access devices with one pseudowire each, a mesh only among the hubs. The bridging model doesn&apos;t change — learning, flooding, split horizon — it is redistributed across two tiers.</p>
      </GuideSection>

      <GuideSection id="hd-network" eyebrow="Foundation" title="The network you will study" tone="cyan">
        <DiagramFrame caption="The lab's network.">
          <LabNet />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="hd-model" eyebrow="Architecture" title="The two-tier model" tone="violet">
        <DiagramFrame caption="Access tier of MTU-s bridges; core tier of PE-rs in a full mesh.">
          <ModelDiagram />
        </DiagramFrame>
        <p>An MTU-s needs only its own ports and one pseudowire. A PE-rs runs a full VPLS bridge: its mesh pseudowires, its spokes and possibly its own attachment circuits.</p>
      </GuideSection>

      <GuideSection id="hd-scale" eyebrow="Architecture" title="The arithmetic" tone="success">
        <DiagramFrame caption="Pseudowires: flat versus hierarchical, with a 3-hub core.">
          <ScaleDiagram />
        </DiagramFrame>
        <FieldTable
          title="Counting"
          accent="success"
          columns={["Design", "Formula", "This lab"]}
          rows={[
            ["Flat VPLS, N devices", "N(N−1)/2", "6 devices → 15"],
            ["H-VPLS, H hubs, A access devices", "H(H−1)/2 + A", "3 + 3 → 6"],
          ]}
        />
      </GuideSection>

      <GuideSection id="hd-access" eyebrow="Architecture" title="Access options" tone="warning">
        <CompareCards
          items={[
            { title: "MPLS spokes", tone: "warning", tag: "this lab", points: ["the MTU-s runs LDP and signals a pseudowire", "the spoke is a real PW with its own label"] },
            { title: "Ethernet access", tone: "cyan", tag: "QinQ", points: ["the MTU-s is a plain switch", "an 802.1ad S-tag identifies the customer toward the PE-rs"] },
          ]}
        />
        <p className="text-sm text-pv-text-muted">Both are described in RFC 4762. With Ethernet access, the PE-rs sees an attachment circuit instead of a spoke pseudowire; the core is the same.</p>
      </GuideSection>

      <GuideSection id="hd-matrix" eyebrow="Forwarding" title="The forwarding matrix" tone="danger">
        <DiagramFrame caption="Every combination is allowed except mesh in, mesh out.">
          <MatrixDiagram />
        </DiagramFrame>
        <p>IOS XR implements the rule with split-horizon groups: the VFI&apos;s pseudowires form one. Junos implements it with mesh groups: no forwarding between members of the same group (unless <Mono>local-switching</Mono>), forwarding between groups allowed. Same matrix, different words.</p>
      </GuideSection>

      <GuideSection id="hd-spoke2spoke" eyebrow="Forwarding" title="Spoke to spoke through a hub" tone="warning">
        <DiagramFrame caption="Two MTU-s on one hub reach each other through it.">
          <SpokeToSpoke />
        </DiagramFrame>
        <p>On IOS XR, two access pseudowires are not in any split-horizon group, so the hub bridges between them. On Junos, two members of the SPOKES mesh group need <Mono>local-switching</Mono> to talk; without it they are split-horizoned from each other like the core.</p>
      </GuideSection>

      <GuideSection id="hd-learning" eyebrow="Forwarding" title="Learning per tier" tone="success">
        <p>Each bridge learns from the frames it receives, on the port it received them on. After CE1 → CE3, CE1&apos;s MAC sits on a different port at every device.</p>
        <CliPair cisco={hvOnly(HV_LEARNED, "PE1", "cisco", "show l2vpn forwarding bridge-domain mac-address location 0/0/CPU0", /Mac Address|----|dynamic/)} junos={hvCli(HV_LEARNED_JN, "MTU2", "juniper", "show vpls mac-table")} ciscoCaption="IOS XR · PE1 — CE1 behind the spoke, CE3 behind 2.2.2.2" junosCaption="Junos · MTU2 — CE1 behind its spoke (lsi), CE3 on its interface" />
      </GuideSection>

      <GuideSection id="hd-bum" eyebrow="Forwarding" title="Flooding and replication" tone="warning">
        <p>An MTU-s sends a flooded frame once, up its spoke. The hub makes one copy per mesh neighbor and per other spoke; each remote hub makes one copy per spoke. Replication concentrates at the PE-rs — the same ingress replication as flat VPLS, done by fewer, bigger devices.</p>
        <PingResult s={HV_LEARNED} title="The lab: CE1 → CE3 with empty tables" />
      </GuideSection>

      <GuideSection id="hd-labels" eyebrow="Forwarding" title="Labels on each tier" tone="mpls">
        <p>A spoke to a directly connected hub carries one label — the hub&apos;s receive label for that spoke — because PHP removes the transport label before the hub. A mesh pseudowire crosses P1 with two: P1&apos;s transport label over the far hub&apos;s receive label.</p>
        <CliPair cisco={hvOnly(HV_HEALTHY, "PE1", "cisco", "show mpls forwarding", /Local|Label|---|PW\(|\/32/)} junos={hvCli(HV_HEALTHY_JN, "PE1", "juniper", "show route table mpls.0")} ciscoCaption="IOS XR · PE1 — 24012/24013 from the mesh, 34011 from MTU1" junosCaption="Junos · PE1 — VPLS labels and LDP labels in mpls.0" />
      </GuideSection>

      <GuideSection id="hd-config" eyebrow="Operations" title="Configuring it: IOS XR and Junos" tone="cyan">
        <CliPair cisco={hvCli(HV_HEALTHY, "PE1", "cisco", "show running-config l2vpn")} junos={hvCli(HV_HEALTHY_JN, "PE1", "juniper", "show configuration routing-instances")} ciscoCaption="IOS XR · PE1 (PE-rs) — access PW + VFI" junosCaption="Junos · PE1 (PE-rs) — default group + mesh-group SPOKES" />
        <CliPair cisco={hvCli(HV_HEALTHY, "MTU1", "cisco", "show running-config l2vpn")} junos={hvCli(HV_HEALTHY_JN, "MTU1", "juniper", "show configuration routing-instances")} ciscoCaption="IOS XR · MTU1 (MTU-s) — ACs + one access PW" junosCaption="Junos · MTU1 (MTU-s) — interfaces + one neighbor" />
        <p className="text-sm text-pv-text-muted">On Junos every VPLS device also needs <Mono>protocols ldp interface lo0.0</Mono> for the targeted sessions, and the units facing the CEs use <Mono>encapsulation vlan-vpls</Mono>.</p>
      </GuideSection>

      <GuideSection id="hd-verify" eyebrow="Operations" title="How to verify" tone="success">
        <FieldTable
          title="The questions, and where the answers are"
          accent="success"
          columns={["Question", "IOS XR", "Junos"]}
          rows={[
            ["Spokes and mesh, and their state?", <Mono key="1">show l2vpn bridge-domain</Mono>, <Mono key="2">show vpls connections</Mono>],
            ["Labels, MTU, split-horizon group?", <Mono key="3">show l2vpn bridge-domain detail</Mono>, <Mono key="4">show vpls connections</Mono>],
            ["Where is each MAC?", <Mono key="5">show l2vpn forwarding bridge-domain mac-address location 0/0/CPU0</Mono>, <Mono key="6">show vpls mac-table</Mono>],
            ["Targeted sessions?", <Mono key="7">show mpls ldp discovery</Mono>, <Mono key="8">show ldp neighbor</Mono>],
            ["LSPs between the hubs?", <Mono key="9">show mpls forwarding</Mono>, <Mono key="10">show route table inet.3</Mono>],
          ]}
        />
      </GuideSection>

      <GuideSection id="hd-redundancy" eyebrow="Resilience" title="Dual-homed access" tone="cyan">
        <DiagramFrame caption="An MTU-s with a primary and a standby spoke.">
          <RedundancyDiagram />
        </DiagramFrame>
        <p>A single spoke is a single point of failure for every site behind the MTU-s. Production designs dual-home it to two PE-rs with a primary and a backup pseudowire (IOS XR <Mono>backup neighbor</Mono>; Junos pseudowire redundancy), only one forwarding at a time to avoid a loop. This lab keeps one spoke per access device.</p>
      </GuideSection>

      <GuideSection id="hd-failure" eyebrow="Resilience" title="Failure domains" tone="danger">
        <DiagramFrame caption="What each failure takes with it.">
          <FailureDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="hd-signatures" eyebrow="Troubleshooting" title="Failure signatures" tone="danger">
        <FailureSignatures
          items={[
            { tag: "ROLE", title: "Spoke in the core group", tone: "danger", points: ["every PW up", "that MTU-s's sites reach only each other"] },
            { tag: "PW ID", title: "Spoke PW ID mismatch", tone: "danger", points: ["that spoke down", "the access device isolated"] },
            { tag: "MESH", title: "Missing mesh member", tone: "danger", points: ["one pair of hubs cut", "no relay via the third"] },
            { tag: "VLAN", title: "AC on the wrong VLAN", tone: "violet", points: ["every PW up", "one site silent, even locally"] },
            { tag: "LSP", title: "Transport broken", tone: "warning", points: ["XR: PWs up, drops at P1", "Junos: VC-Dn"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="hd-workflow" eyebrow="Troubleshooting" title="Investigation workflow" tone="danger">
        <TroubleshootingFlow
          steps={[
            { question: "Which pairs of sites fail?", look: "One site, one access device, one pair of hubs?" },
            { question: "Is each site's attachment circuit in its MTU-s bridge?", look: "VLAN and bridge membership." },
            { question: "Is every spoke up?", look: "PW ID / VPLS ID and MTU at both ends." },
            { question: "Is the core mesh full?", look: "Every PE-rs lists both others." },
            { question: "Is every pseudowire in the right group?", look: "Access PW vs VFI; mesh-group SPOKES vs default." },
            { question: "Is the transport complete?", look: "Labels between the hubs' loopbacks." },
          ]}
        />
      </GuideSection>

      <GuideSection id="hd-tickets" eyebrow="Troubleshooting" title="Five faults, evidence to proof" tone="danger">
        <p>The H-VPLS Lab&apos;s five tickets, with the fault in place (IOS XR view unless noted).</p>
        <FailureWalk
          title="1 · MTU1's sites are on an island"
          normal="PE1 has 10.0.0.1 as an access pseudowire, outside the VFI."
          change="A tidy-up moved it into the VFI."
          evidence={<CliPanel run={hvOnly(T.spoke, "PE1", "cisco", "show l2vpn bridge-domain", /List of|VFI|Neighbor/)} caption="IOS XR · PE1 — 10.0.0.1 inside the VFI" />}
          next="Every PW is up; PE1 refuses to flood MTU1's frames to the other VFI members."
          fix={<Mono>PE1: … vfi HVPLS-A → no neighbor 10.0.0.1 pw-id 100 → exit → neighbor 10.0.0.1 pw-id 100 → commit</Mono>}
          proof="10.0.0.1 under Access PWs again; a fresh ping from CE1 reaches CE3."
        />
        <FailureWalk
          title="2 · Site 3 after a software refresh"
          normal="MTU2's spoke uses PW ID 100, like PE2."
          change="The regenerated configuration says 101."
          evidence={<CliPair cisco={hvOnly(T.pwid, "MTU2", "cisco", "show l2vpn bridge-domain", /Access PWs|Neighbor/)} junos={hvOnly(T.pwidJn, "PE2", "juniper", "show vpls connections", /Mesh-group|rmt/)} ciscoCaption="IOS XR · MTU2 — pw-id 101, down" junosCaption="Junos · PE2 — the spoke to 10.0.0.2 without an outgoing label (OL)" />}
          next="No matching label mapping: the spoke stays down and CE3 has no way in."
          fix={<Mono>MTU2: … bridge-domain HVPLS-A → no neighbor 2.2.2.2 pw-id 101 → neighbor 2.2.2.2 pw-id 100 → commit</Mono>}
          proof="The spoke is up; a fresh ping from CE3 reaches CE1."
        />
        <FailureWalk
          title="3 · Two sites can't see each other"
          normal="Each PE-rs lists both others in its core mesh."
          change="PE3 lost neighbor 2.2.2.2."
          evidence={<CliPanel run={hvOnly(T.mesh, "PE2", "cisco", "show l2vpn bridge-domain", /VFI|Neighbor/)} caption="IOS XR · PE2 — the mesh pseudowire to 3.3.3.3 down" />}
          next="CE3 ↔ CE4 needs PE2–PE3; PE1 may not relay between two mesh pseudowires."
          fix={<Mono>PE3: … vfi HVPLS-A → neighbor 2.2.2.2 pw-id 100 → commit</Mono>}
          proof="Twelve pseudowire ends up; a fresh ping from CE3 reaches CE4."
        />
        <FailureWalk
          title="4 · CE2 is alone — even next door"
          normal="MTU1's attachment circuit toward CE2 accepts VLAN 100."
          change="After moving CE2: encapsulation dot1q 200."
          evidence={<CliPanel run={hvOnly(T.vlan, "MTU1", "cisco", "show l2vpn bridge-domain detail", /AC:|VLAN ranges/)} caption="IOS XR · MTU1 — VLAN ranges [200, 200] on Gi0/0/0/2.100" />}
          next="CE2's frames match no attachment circuit; even local switching fails."
          fix={<Mono>MTU1: interface GigabitEthernet0/0/0/2.100 l2transport → encapsulation dot1q 100 → commit</Mono>}
          proof="VLAN ranges [100, 100]; a fresh ping from CE2 reaches CE1."
        />
        <FailureWalk
          title="5 · After PE3's maintenance"
          normal="LDP on every link."
          change="PE3's core interface lost LDP."
          evidence={<CliPair cisco={hvOnly(T.transport, "PE3", "cisco", "show mpls forwarding", /Local|Label|---|\/32/)} junos={hvOnly(T.transportJn, "PE1", "juniper", "show vpls connections", /Mesh-group|rmt/)} ciscoCaption="IOS XR · PE3 — every remote loopback Unlabelled" junosCaption="Junos · PE1 — VC-Dn toward 3.3.3.3" />}
          next="IOS XR keeps the pseudowires up; P1 drops PE3's frames (only a PW label on top). Junos takes them down."
          fix={<Mono>PE3: mpls ldp → interface GigabitEthernet0/0/0/0 → commit</Mono>}
          proof="LDP on PE3–P1; a fresh ping from CE1 reaches CE4."
        />
      </GuideSection>

      <GuideSection id="hd-next" eyebrow="Beyond this lesson" title="What came next" tone="violet">
        <FieldTable
          title="Where hierarchical VPLS still hurts"
          accent="violet"
          columns={["Limit", "Why", "Answer later in this path"]}
          rows={[
            ["Manual neighbor lists at the hubs", "LDP has no discovery", "BGP auto-discovery (previous lesson)"],
            ["Learning only from traffic", "no MAC signaling", "EVPN (MACs in BGP)"],
            ["Active/standby dual-homing", "one spoke forwards at a time", "EVPN all-active multihoming"],
            ["BUM replication at the hubs", "ingress replication", "P2MP trees; EVPN"],
          ]}
        />
      </GuideSection>

      <GuideSection id="hd-myths" eyebrow="Master it" title="Common misconceptions" tone="warning">
        <Misconceptions
          items={[
            { myth: "A pseudowire can never forward to another pseudowire.", correction: "Only mesh → mesh is forbidden. Spoke ↔ mesh is the whole point of H-VPLS." },
            { myth: "If every pseudowire is up, frames cross them.", correction: "A pseudowire in the wrong split-horizon group is up and useless." },
            { myth: "MTU-s devices join the core mesh.", correction: "They have exactly one pseudowire, to their hub." },
            { myth: "Hierarchy makes the hubs' job smaller.", correction: "The PE-rs still learn every MAC and replicate every flood." },
            { myth: "Disabling split horizon in the core fixes reachability.", correction: "It creates a loop. Fix roles, or complete the mesh." },
            { myth: "H-VPLS needs BGP.", correction: "This lesson is LDP-signaled throughout; hierarchy and discovery are separate questions." },
          ]}
        />
      </GuideSection>

      <GuideSection id="hd-quiz" eyebrow="Master it" title="Knowledge check" tone="cyan">
        <KnowledgeQuiz questions={QUIZ} />
      </GuideSection>

      <GuideSection id="hd-explain" eyebrow="Master it" title="Can you explain it?" tone="violet">
        <ExplainIt
          items={[
            { q: "What does H-VPLS change compared with flat VPLS?", a: "Access devices join with one spoke to a hub; only the hubs form the full mesh. The bridging rules stay the same, with split horizon applied per role." },
            { q: "Why is mesh → mesh forbidden but spoke → mesh allowed?", a: "The mesh is a loop of pseudowires with no TTL, so nobody may relay inside it. A spoke is a single branch — forwarding from it into the mesh can't loop." },
            { q: "Why did MTU1's sites only reach each other in the incident?", a: "PE1 had MTU1's pseudowire inside the VFI / default mesh group, so frames from MTU1 counted as mesh frames and could not be flooded to PE2 and PE3." },
            { q: "Why does the spoke carry only one label?", a: "MTU1 and PE1 are directly connected: the transport label is implicit null (PHP), leaving just PE1's receive label." },
            { q: "Where does each vendor keep the role?", a: "IOS XR: access pseudowire under the bridge domain vs neighbor inside the VFI. Junos: a named mesh group for spokes vs the default mesh group." },
          ]}
        />
      </GuideSection>

      <GuideSection id="hd-practice" eyebrow="Master it" title="Practice in the H-VPLS Lab" tone="success">
        <p>Six Learn levels take you from &quot;two tiers&quot; to reading the evidence; the engineering workspace gives you all seven devices (IOS XR or Junos), MAC tables on both tiers, pings from five sites, five challenges and the five tickets above.</p>
        <LabBridge />
        <PresentationBridge>Rewatch the H-VPLS presentation.</PresentationBridge>
      </GuideSection>
    </div>
  );
}
