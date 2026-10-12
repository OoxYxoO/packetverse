import { Callout, ChecklistCard, CompareCards, DIAGRAM as D, DLink, DNode, DPill, DRegion, DiagramFrame, DiagramSvg, FailureSignatures, FieldTable, FlowSteps, Glossary, GuideSection, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { DStack } from "@/components/lesson/MplsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { PracticeBridge } from "@/components/lesson/GuideInteractive";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import { PresentationBridge } from "@/components/presentation/LessonPresentation";
import { CliPair, CliPanel, pickLines, runGuideCli } from "@/components/lesson/GuideCli";
import type { CliVendor } from "@/lib/cli/types";
import { createHvNet, hvApply, hvTicket, hvTicketState, type HvCe, type HvOs, type HvR, type HvState } from "@/lib/sim-engine/scenarios/hvNet";
import { hvSets, hvStaticApi } from "./hv-lab/hvCli";

export const HVPLS_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "hv-mission", label: "What this lesson teaches" },
  { id: "hv-network", label: "The network of this lesson" },
  { id: "hv-ideas", label: "Three ideas you need" },
  { id: "hv-watch", label: "What you will watch" },
  { id: "hv-flat", label: "Why a flat mesh hurts" },
  { id: "hv-tiers", label: "MTU-s and PE-rs" },
  { id: "hv-core", label: "The core mesh" },
  { id: "hv-spokes", label: "One spoke per access device" },
  { id: "hv-roles", label: "Port roles in the configuration" },
  { id: "hv-local", label: "Neighbors stay local" },
  { id: "hv-bum", label: "Flooding through the tiers" },
  { id: "hv-split", label: "Split horizon by role" },
  { id: "hv-labels", label: "Labels on each tier" },
  { id: "hv-fdb", label: "One MAC, many views" },
  { id: "hv-scale", label: "What hierarchy buys" },
  { id: "hv-working", label: "What working looks like" },
  { id: "hv-incident", label: "The incident" },
  { id: "hv-investigate", label: "Walk the evidence" },
  { id: "hv-fix", label: "Repair and prove it" },
  { id: "hv-other", label: "Other ways it fails" },
  { id: "hv-model", label: "Mental model" },
  { id: "hv-glossary", label: "Glossary" },
  { id: "hv-recap", label: "Recap" },
  { id: "hv-practice", label: "Practice it" },
];

/**
 * Every CLI sample and ping result on this page comes from the H-VPLS Lab's model and its IOS XR / Junos command sets:
 * the healthy network (and its MAC tables after real pings) and the lab's "spoke" ticket — the guided lesson's incident
 * (PE1 has MTU1's pseudowire in its core mesh: the VFI / the default mesh group).
 */
export const HV_HEALTHY: HvState = createHvNet(0);
export const HV_HEALTHY_JN: HvState = createHvNet(0, "junos");
const ping = (s: HvState, from: HvCe, dst: string) => hvApply(s, { type: "test", from, dst });
export const HV_LOCAL = ping(HV_HEALTHY, "CE1", "192.168.100.2");
const HV_LOCAL_JN = ping(HV_HEALTHY_JN, "CE1", "192.168.100.2");
export const HV_LEARNED = ping(HV_HEALTHY, "CE1", "192.168.100.3");
export const HV_LEARNED_JN = ping(HV_HEALTHY_JN, "CE1", "192.168.100.3");
const HV_AGAIN = ping(HV_LEARNED, "CE1", "192.168.100.3");
const fault = (os: HvOs) => hvTicket("spoke").repro.reduce((acc, a) => hvApply(acc, a), hvTicketState("spoke", 0, os));
const HV_FAULT = fault("xr");
const HV_FAULT_JN = fault("junos");
const HV_FAULT_LOCAL = ping(HV_FAULT, "CE1", "192.168.100.2");
const HV_FIXED = ping(
  hvApply(HV_FAULT, {
    type: "set",
    text: "PE1: MTU1's pseudowire back as an access pseudowire",
    changes: [
      {
        dev: "PE1",
        f: (c) => {
          const bd = c.bd!;
          const n = bd.mesh.find((x) => x.ip === "10.0.0.1")!;
          bd.mesh = bd.mesh.filter((x) => x !== n);
          bd.spokes.push(n);
        },
      },
    ],
  }),
  "CE1",
  "192.168.100.3",
);
export function hvCli(s: HvState, r: HvR, vendor: CliVendor, command: string) {
  return runGuideCli(hvSets(hvStaticApi(s, r), r)[vendor], command);
}
export function hvOnly(s: HvState, r: HvR, vendor: CliVendor, command: string, match: RegExp, keep = 0) {
  const x = hvCli(s, r, vendor, command);
  return { ...x, output: pickLines(x.output, match, keep) };
}
/** One customer ping, as the lab reports it. */
export function PingResult({ s, title }: { s: HvState; title: string }) {
  const t = s.tests[s.tests.length - 1];
  return (
    <Callout tone={t.ok ? "success" : "danger"} title={title} icon={t.ok ? "✓" : "!"}>
      {t.from} → {t.dst}: {t.ok ? `delivered to ${t.reached}, and the reply came back — ${t.flooded ? "some frames flooded" : "every frame unicast"}` : t.why}
    </Callout>
  );
}

function LessonLabBridge() {
  const openLab = usePracticeLabOpener();
  return (
    <PracticeBridge label="Open the H-VPLS Lab" onPractice={openLab}>
      Three MTU-s, three PE-rs, real MAC tables on both tiers, IOS XR or Junos, your own copy. Nothing you do there changes your lesson progress.
    </PracticeBridge>
  );
}

const POS: Record<string, [number, number]> = {
  CE1: [40, 30],
  CE2: [40, 90],
  CE3: [40, 200],
  CE4: [600, 60],
  MTU1: [140, 60],
  MTU2: [140, 200],
  MTU3: [500, 60],
  PE1: [260, 60],
  PE2: [300, 170],
  PE3: [390, 60],
};

function Hierarchy({ highlight = [], blocked = [], faultPe1 }: { highlight?: string[]; blocked?: string[]; faultPe1?: boolean }) {
  const links: [string, string, "access" | "spoke" | "mesh"][] = [
    ["CE1", "MTU1", "access"],
    ["CE2", "MTU1", "access"],
    ["CE3", "MTU2", "access"],
    ["MTU3", "CE4", "access"],
    ["MTU1", "PE1", "spoke"],
    ["MTU2", "PE2", "spoke"],
    ["PE3", "MTU3", "spoke"],
    ["PE1", "PE2", "mesh"],
    ["PE1", "PE3", "mesh"],
    ["PE2", "PE3", "mesh"],
  ];
  return (
    <>
      <DRegion x={220} y={20} w={210} h={190} label="PE-rs core mesh" color={D.mpls} />
      {links.map(([a, b, tier]) => {
        const id = `${a}-${b}`;
        const [x1, y1] = POS[a];
        const [x2, y2] = POS[b];
        const base = tier === "access" ? D.ip : tier === "spoke" ? D.warning : D.violet;
        const color = blocked.includes(id) ? D.danger : highlight.includes(id) ? D.success : base;
        return <DLink key={id} x1={x1} y1={y1} x2={x2} y2={y2} color={color} dashed={tier === "spoke" || blocked.includes(id)} />;
      })}
      {Object.entries(POS).map(([id, [x, y]]) => (
        <DNode key={id} x={x} y={y} label={id} accent={id.startsWith("CE") ? D.ip : id.startsWith("MTU") ? D.warning : faultPe1 && id === "PE1" ? D.danger : D.mpls} w={id.startsWith("CE") ? 52 : 64} h={30} />
      ))}
    </>
  );
}

function FlatVsHier() {
  return (
    <DiagramSvg h={170} label="Six devices in a flat full mesh need 15 pseudowires; three PE-rs plus three MTU-s need 3 mesh plus 3 spoke, 6 pseudowires">
      <text x={160} y={20} textAnchor="middle" fill={D.danger} fontSize={11} fontWeight={700}>
        flat: 6 devices, 15 PWs
      </text>
      {Array.from({ length: 6 }, (_, i) => {
        const a = (i / 6) * Math.PI * 2;
        return [160 + Math.cos(a) * 60, 95 + Math.sin(a) * 60] as [number, number];
      }).map((p, i, all) => (
        <g key={i}>
          {all.slice(i + 1).map((q, j) => (
            <line key={j} x1={p[0]} y1={p[1]} x2={q[0]} y2={q[1]} stroke={D.danger} strokeOpacity={0.5} />
          ))}
          <circle cx={p[0]} cy={p[1]} r={9} fill={D.box} stroke={D.mpls} />
        </g>
      ))}
      <text x={480} y={20} textAnchor="middle" fill={D.success} fontSize={11} fontWeight={700}>
        hierarchical: 3 mesh + 3 spokes = 6 PWs
      </text>
      {[
        [430, 70],
        [530, 70],
        [480, 140],
      ].map(([x, y], i, all) => (
        <g key={i}>
          {all.slice(i + 1).map(([x2, y2], j) => (
            <line key={j} x1={x} y1={y} x2={x2} y2={y2} stroke={D.violet} strokeWidth={2} />
          ))}
        </g>
      ))}
      {[
        [430, 70, 380, 40],
        [530, 70, 590, 40],
        [480, 140, 480, 165],
      ].map(([x, y, mx, my], i) => (
        <g key={i}>
          <line x1={x} y1={y} x2={mx} y2={my} stroke={D.warning} strokeWidth={2} strokeDasharray="4 3" />
          <circle cx={mx} cy={my} r={7} fill={D.box} stroke={D.warning} />
          <circle cx={x} cy={y} r={9} fill={D.box} stroke={D.mpls} />
        </g>
      ))}
    </DiagramSvg>
  );
}

function TopologyDiagram() {
  return (
    <DiagramSvg h={240} label="CE1 and CE2 on MTU1 spoke to PE1; CE3 on MTU2 spoke to PE2; CE4 on MTU3 spoke to PE3; PE1, PE2, PE3 full mesh">
      <Hierarchy />
      <text x={320} y={232} textAnchor="middle" fill={D.muted} fontSize={10}>
        blue = access (AC) · amber dashed = spoke PW · violet = core mesh PW
      </text>
    </DiagramSvg>
  );
}

function BumDiagram() {
  return (
    <DiagramSvg h={240} label="An unknown frame from CE1 goes to CE2 locally and up the spoke to PE1, which sends it on both mesh PWs; PE2 and PE3 send it down their spokes but not to each other">
      <Hierarchy highlight={["CE1-MTU1", "CE2-MTU1", "MTU1-PE1", "PE1-PE2", "PE1-PE3", "MTU2-PE2", "PE3-MTU3", "CE3-MTU2", "MTU3-CE4"]} blocked={["PE2-PE3"]} />
      <DPill x={472} y={130} text="mesh → mesh ✕" color={D.danger} w={120} />
      <text x={320} y={232} textAnchor="middle" fill={D.muted} fontSize={10}>
        spoke → mesh ✓ · mesh → spoke ✓ · mesh → mesh ✕ · CE3 and CE4 discard (wrong destination MAC)
      </text>
    </DiagramSvg>
  );
}

function FaultDiagram() {
  return (
    <DiagramSvg h={240} label="PE1 wrongly classifies its port to MTU1 as a mesh PW, so frames from MTU1 are treated as mesh ingress and blocked from the other mesh PWs">
      <Hierarchy highlight={["CE1-MTU1", "MTU1-PE1"]} blocked={["PE1-PE2", "PE1-PE3"]} faultPe1 />
      <DPill x={122} y={138} text="PE1 sees MTU1 as MESH_PW" color={D.danger} w={176} />
    </DiagramSvg>
  );
}

function StacksDiagram() {
  return (
    <DiagramSvg h={170} label="MTU1 to PE1 carries only PE1's spoke label 34011; PE1 to P1 carries P1's transport label 24702 over PE2's mesh label 25021; PE2 to MTU2 carries only MTU2's spoke label 44022">
      <text x={110} y={20} textAnchor="middle" fill={D.warning} fontSize={10.5} fontWeight={700}>
        MTU1 → PE1 (spoke)
      </text>
      <DStack x={110} y={32} labels={[{ text: "34011 S1", tag: "PW", color: D.warning }]} payload="Ethernet" w={84} />
      <text x={320} y={20} textAnchor="middle" fill={D.violet} fontSize={10.5} fontWeight={700}>
        PE1 → P1 (mesh, across the core)
      </text>
      <DStack x={320} y={32} labels={[{ text: "24702 S0", tag: "LDP" }, { text: "25021 S1", tag: "PW", color: D.violet }]} payload="Ethernet" w={84} />
      <text x={530} y={20} textAnchor="middle" fill={D.warning} fontSize={10.5} fontWeight={700}>
        PE2 → MTU2 (spoke)
      </text>
      <DStack x={530} y={32} labels={[{ text: "44022 S1", tag: "PW", color: D.warning }]} payload="Ethernet" w={84} />
      <text x={320} y={160} textAnchor="middle" fill={D.muted} fontSize={10}>
        a directly connected hub needs no transport label (PHP) · P1 pops 24702 before PE2
      </text>
    </DiagramSvg>
  );
}

export function HvplsLessonGuideContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="hv-mission" eyebrow="This lesson" title="What this lesson teaches" tone="mpls">
        <p>
          The VPLS lesson made every PE a member of one full mesh. That is fine for three PEs and painful for thirty. This lesson builds <b className="text-pv-text">Hierarchical VPLS</b> (RFC 4762, section 10): small access bridges — <b className="text-pv-text">MTU-s</b> — each join the service through one <b className="text-pv-text">spoke</b> pseudowire to a hub, and only the hubs — <b className="text-pv-text">PE-rs</b> — form the full mesh.
        </p>
        <p>You will watch CE1 and CE2 talk without their frames ever leaving MTU1, a broadcast climb a spoke, cross the core and come down the other spokes, and the one rule that keeps the core loop-free. Then an incident where every pseudowire is up, the transport is perfect — and CE1 and CE2 are stuck on an island.</p>
        <ChecklistCard tone="violet" title="By the end of this lesson you can" mark="→" items={["explain why a flat VPLS mesh stops scaling", "name the two tiers and what each one does", "follow frames through local switching, spoke → mesh and mesh → spoke", "state which forwarding split horizon forbids — and which it allows", "read spoke and mesh roles in IOS XR and Junos configurations", "find a role misconfiguration from evidence, fix it and prove it"]} />
      </GuideSection>

      <GuideSection id="hv-network" eyebrow="This lesson" title="The network of this lesson" tone="cyan">
        <DiagramFrame caption="Three access bridges, three spokes, three core mesh pseudowires.">
          <TopologyDiagram />
        </DiagramFrame>
        <FieldTable
          title="Who is who"
          accent="mpls"
          columns={["Device", "Loopback", "Role", "Sites behind it"]}
          rows={[
            ["MTU1", <Mono key="1">10.0.0.1</Mono>, "MTU-s (spoke to PE1)", "CE1 · CE2"],
            ["MTU2", <Mono key="2">10.0.0.2</Mono>, "MTU-s (spoke to PE2)", "CE3"],
            ["MTU3", <Mono key="3">10.0.0.3</Mono>, "MTU-s (spoke to PE3)", "CE4"],
            ["PE1 · PE2 · PE3", <Mono key="4">1.1.1.1 · 2.2.2.2 · 3.3.3.3</Mono>, "PE-rs (core mesh)", "their MTU-s"],
          ]}
        />
        <Callout tone="cyan" title="The lab uses the same network" icon="i">
          Service HVPLS-A on VLAN 100, PW ID 100 everywhere; the CEs share <Mono>192.168.100.0/24</Mono>. The guided lesson leaves the core routers out; the lab adds P1 (10.10.10.1) between the three PE-rs, while each MTU-s is cabled straight to its hub. A fifth site, CE5, waits unconnected on MTU2. Every output on this page comes from the lab.
        </Callout>
      </GuideSection>

      <GuideSection id="hv-ideas" eyebrow="This lesson" title="Three ideas you need" tone="violet">
        <CompareCards
          items={[
            { title: "Two tiers", tone: "cyan", tag: "topology", points: ["MTU-s: a bridge with one spoke", "PE-rs: a full mesh among the hubs"] },
            { title: "Roles", tone: "violet", tag: "configuration", points: ["each pseudowire is a spoke or a mesh member", "the role lives in the configuration"] },
            { title: "Split horizon by role", tone: "danger", tag: "loop prevention", points: ["mesh → mesh is forbidden", "everything else is allowed"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="hv-watch" eyebrow="This lesson" title="What you will watch" tone="cyan">
        <FlowSteps
          steps={[
            { title: "The hierarchy", body: "Core mesh, then one spoke per MTU-s.", tone: "violet" },
            { title: "Local", body: "CE1 ↔ CE2 stays on MTU1.", tone: "success" },
            { title: "Up and down", body: "Spoke → mesh → spoke.", tone: "warning" },
            { title: "The rule", body: "No mesh → mesh.", tone: "danger" },
            { title: "The incident", body: "A spoke in the core group.", tone: "danger" },
            { title: "Repair", body: "The right role, a fresh ping.", tone: "success" },
          ]}
        />
      </GuideSection>

      <GuideSection id="hv-flat" eyebrow="Motivation" title="Why a flat mesh hurts" tone="danger">
        <DiagramFrame caption="The same six devices, flat and hierarchical.">
          <FlatVsHier />
        </DiagramFrame>
        <p>Six VPLS devices full-meshed need <Mono>6 × 5 / 2 = 15</Mono> pseudowires; a hundred need 4950, and every new site touches every existing PE. In a hierarchy of three hubs and three access devices it is <Mono>3 + 3 = 6</Mono>, and the hundredth access device costs exactly one new spoke.</p>
      </GuideSection>

      <GuideSection id="hv-tiers" eyebrow="Roles" title="MTU-s and PE-rs" tone="violet">
        <CompareCards
          items={[
            { title: "MTU-s", tone: "warning", tag: "access tier", points: ["an ordinary Ethernet bridge for the customer", "its attachment circuits + one spoke", "never in the core mesh"] },
            { title: "PE-rs", tone: "violet", tag: "core tier", points: ["full-meshed with the other hubs", "terminates the spokes of its access devices", "learns every remote MAC, replicates every flood"] },
          ]}
        />
        <p className="text-sm text-pv-text-muted">RFC 4762 names them MTU-s and PE-rs; vendors and operators often just say access node and hub, or N-PE and U-PE.</p>
      </GuideSection>

      <GuideSection id="hv-core" eyebrow="Control plane" title="The core mesh" tone="mpls">
        <p>The three PE-rs signal a full mesh exactly as in the VPLS lesson: one targeted LDP session per pair, one receive label per neighbor. PE1 receives on <Mono>24012</Mono> from PE2 and <Mono>24013</Mono> from PE3.</p>
        <CliPair cisco={hvOnly(HV_HEALTHY, "PE1", "cisco", "show l2vpn bridge-domain", /PWs:|List of|VFI|Neighbor/)} junos={hvOnly(HV_HEALTHY_JN, "PE1", "juniper", "show vpls connections", /Instance|VPLS-id|Mesh-group|rmt/)} ciscoCaption="IOS XR · PE1 — one access PW, two VFI neighbors" junosCaption="Junos · PE1 — mesh group SPOKES and the default group __ves__" />
      </GuideSection>

      <GuideSection id="hv-spokes" eyebrow="Control plane" title="One spoke per access device" tone="warning">
        <p>Each MTU-s signals one pseudowire, to its hub — the same targeted-LDP mechanics, a point-to-point relationship instead of a mesh leg. PE1 receives MTU1&apos;s frames on <Mono>34011</Mono>; MTU1 receives PE1&apos;s on <Mono>44011</Mono>. Nine pseudowires&apos; worth of signaling work disappears compared with a flat mesh.</p>
        <CliPair cisco={hvOnly(HV_HEALTHY, "MTU1", "cisco", "show l2vpn bridge-domain detail", /ACs:|AC:|PW: neighbor|Label  /)} junos={hvCli(HV_HEALTHY_JN, "MTU1", "juniper", "show configuration routing-instances")} ciscoCaption="IOS XR · MTU1 — two attachment circuits and one access pseudowire" junosCaption="Junos · MTU1 — two interfaces and one neighbor: its hub" />
      </GuideSection>

      <GuideSection id="hv-roles" eyebrow="Configuration" title="Port roles in the configuration" tone="violet">
        <p>Nothing in the pseudowire itself says spoke or mesh. The PE-rs decides, from where the neighbor sits in its configuration:</p>
        <FieldTable
          title="Where the role lives"
          accent="violet"
          columns={["", "Spoke (outside the core's group)", "Core mesh (one split-horizon group)"]}
          rows={[
            ["IOS XR", <Mono key="1">neighbor X pw-id N</Mono>, <Mono key="2">vfi NAME → neighbor X pw-id N</Mono>],
            ["", "directly under the bridge domain: an access pseudowire", "inside the VFI"],
            ["Junos", <Mono key="3">mesh-group SPOKES → neighbor X</Mono>, <Mono key="4">neighbor X</Mono>],
            ["", "its own mesh group (and vpls-id); local-switching lets members talk", "directly under protocols vpls: the default mesh group"],
          ]}
        />
        <CliPair cisco={hvCli(HV_HEALTHY, "PE1", "cisco", "show running-config l2vpn")} junos={hvCli(HV_HEALTHY_JN, "PE1", "juniper", "show configuration routing-instances")} ciscoCaption="IOS XR · PE1" junosCaption="Junos · PE1" />
      </GuideSection>

      <GuideSection id="hv-local" eyebrow="Data plane" title="Neighbors stay local" tone="success">
        <p>CE1 asks for CE2 with a broadcast; MTU1 floods it to CE2 and up its spoke, so the whole service hears the request. CE2&apos;s reply is unicast to a MAC MTU1 already knows — it never leaves MTU1, and neither do the pings after it. PE1 learns CE1 from the broadcast and never learns CE2.</p>
        <CliPair cisco={hvCli(HV_LOCAL, "MTU1", "cisco", "show l2vpn forwarding bridge-domain mac-address location 0/0/CPU0")} junos={hvCli(HV_LOCAL_JN, "PE1", "juniper", "show vpls mac-table")} ciscoCaption="IOS XR · MTU1 after CE1 → CE2 — both on attachment circuits" junosCaption="Junos · PE1 — CE1 only, behind the spoke (lsi)" />
        <CliPanel run={hvOnly(HV_LOCAL, "PE1", "cisco", "show l2vpn forwarding bridge-domain mac-address location 0/0/CPU0", /Mac Address|----|dynamic/)} caption="IOS XR · PE1 — CE1 only, behind the spoke from 10.0.0.1" />
      </GuideSection>

      <GuideSection id="hv-bum" eyebrow="Data plane" title="Flooding through the tiers" tone="warning">
        <DiagramFrame caption="An unknown destination: up the spoke, across the mesh, down the spokes.">
          <BumDiagram />
        </DiagramFrame>
        <p>CE1 asks for CE3. MTU1 floods up its spoke. PE1 received the frame on a spoke and floods it to both mesh neighbors. PE2 received it on the mesh: down its spoke to MTU2, but not on to PE3 — PE3 got its own copy from PE1. MTU2 delivers to CE3; MTU3 delivers to CE4, who ignores it.</p>
        <PingResult s={HV_LEARNED} title="The lab: the first ping CE1 → CE3" />
        <PingResult s={HV_AGAIN} title="The lab: the same ping again" />
      </GuideSection>

      <GuideSection id="hv-split" eyebrow="Loop prevention" title="Split horizon by role" tone="danger">
        <FieldTable
          title="Who may forward to whom (at a PE-rs)"
          accent="danger"
          columns={["Frame came in on", "To an AC", "To a spoke", "To a mesh PW"]}
          rows={[
            ["an attachment circuit", "✓", "✓", "✓"],
            ["a spoke", "✓", "✓ (another spoke)", "✓"],
            ["a mesh pseudowire", "✓", "✓", "✕ never"],
          ]}
        />
        <p>The three core pseudowires form a loop, and Ethernet has no TTL — so the mesh is one split-horizon group and nobody relays inside it. That is also why it must stay full: if PE1 loses its pseudowire to PE3, PE2 may not bridge the gap, and the sites behind PE1 lose those behind PE3. A spoke has nothing to loop with; it sits outside the group.</p>
      </GuideSection>

      <GuideSection id="hv-labels" eyebrow="Data plane" title="Labels on each tier" tone="mpls">
        <DiagramFrame caption="A spoke to a directly connected hub carries one label; a mesh pseudowire across P1 carries two.">
          <StacksDiagram />
        </DiagramFrame>
        <Callout tone="cyan" title="The numbers on this page" icon="i">
          The pseudowire labels (24012 … mesh, 34011 / 44011 … spokes) are the same in the guided lesson and the lab. The guided lesson draws a transport label on the spokes too (901, 802) and leaves the P router out; in the lab each MTU-s is directly connected to its hub, so PHP leaves only the PW label, and the mesh crosses P1 with P1&apos;s labels (24702 toward PE2). Junos numbers everything from 299776.
        </Callout>
        <CliPanel run={hvOnly(HV_HEALTHY, "PE1", "cisco", "show mpls forwarding", /Local|Label|---|PW\(|2\.2\.2\.2\/32|10\.0\.0\.1\/32/)} caption="IOS XR · PE1 — the PW labels it receives on, the transport labels it pushes" />
      </GuideSection>

      <GuideSection id="hv-fdb" eyebrow="State" title="One MAC, many views" tone="violet">
        <p>After CE1 → CE3, every bridge has learned CE1 — each on its own port: MTU1 on the attachment circuit, PE1 on the spoke from MTU1, PE2 on the mesh pseudowire from PE1, MTU2 on the spoke from PE2. Nobody synchronizes these tables; each learned from the frames it saw.</p>
        <CliPair cisco={hvOnly(HV_LEARNED, "PE2", "cisco", "show l2vpn forwarding bridge-domain mac-address location 0/0/CPU0", /Mac Address|----|dynamic/)} junos={hvCli(HV_LEARNED_JN, "MTU2", "juniper", "show vpls mac-table")} ciscoCaption="IOS XR · PE2 — CE1 behind 1.1.1.1 (mesh), CE3 behind 10.0.0.2 (spoke)" junosCaption="Junos · MTU2 — CE1 behind its spoke, CE3 on its interface" />
      </GuideSection>

      <GuideSection id="hv-scale" eyebrow="Scaling" title="What hierarchy buys — and what it doesn't" tone="cyan">
        <CompareCards
          items={[
            { title: "Buys", tone: "success", tag: "edge", points: ["one spoke per access device", "small MAC tables and simple configuration at the edge", "local switching between sites on one MTU-s"] },
            { title: "Doesn't remove", tone: "warning", tag: "hubs", points: ["the core mesh among the PE-rs", "every remote MAC at every PE-rs", "BUM replication at the hubs"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="hv-working" eyebrow="Evidence" title="What working looks like" tone="success">
        <FieldTable
          title="Healthy, in five questions"
          accent="success"
          columns={["Question", "IOS XR", "Healthy answer"]}
          rows={[
            ["Is every AC in its MTU-s bridge?", <Mono key="1">show l2vpn bridge-domain detail</Mono>, "AC up, VLAN ranges [100, 100]"],
            ["Is every spoke up?", <Mono key="2">show l2vpn bridge-domain</Mono>, "one access PW up on each MTU-s and PE-rs"],
            ["Is the core mesh full?", <Mono key="3">show l2vpn bridge-domain</Mono>, "two VFI neighbors up on each PE-rs"],
            ["Is every PW in the right place?", <Mono key="4">show l2vpn bridge-domain</Mono>, "MTU-s under Access PWs, PE-rs under the VFI"],
            ["Does every pair of sites work?", "fresh pings", "CE1↔CE3, CE1↔CE4, CE3↔CE4 …"],
          ]}
        />
      </GuideSection>

      <GuideSection id="hv-incident" eyebrow="Incident" title="The incident" tone="danger">
        <DiagramFrame caption="PE1 treats MTU1's pseudowire as a core mesh member.">
          <FaultDiagram />
        </DiagramFrame>
        <p>After a tidy-up of PE1&apos;s VPLS configuration, CE1 and CE2 still reach each other but nobody else. Every pseudowire on PE1 shows up, and the transport is healthy.</p>
        <PingResult s={HV_FAULT} title="The lab: CE1 pings 192.168.100.3 (the ticket)" />
        <PingResult s={HV_FAULT_LOCAL} title="The lab: CE1 pings 192.168.100.2 — still fine" />
      </GuideSection>

      <GuideSection id="hv-investigate" eyebrow="Incident" title="Walk the evidence" tone="danger">
        <TroubleshootingFlow
          steps={[
            { question: "Which pairs fail?", look: "Everything between MTU1's sites and the rest." },
            { question: "Are the attachment circuits and the spoke up?", look: "Yes, all of them." },
            { question: "Is the core mesh full, the transport complete?", look: "Yes." },
            { question: "Where does PE1 have MTU1's pseudowire?", look: "Inside the VFI (Junos: the default mesh group) — the core's split-horizon group." },
          ]}
        />
        <CliPanel run={hvOnly(HV_FAULT, "PE1", "cisco", "show l2vpn bridge-domain", /List of|VFI|Neighbor/)} caption="IOS XR · PE1 — no access PW; 10.0.0.1 sits in the VFI with the mesh" />
        <CliPanel run={hvOnly(HV_FAULT_JN, "PE1", "juniper", "show vpls connections", /Mesh-group|rmt/)} caption="Junos · PE1 — 10.0.0.1 in __ves__, together with 2.2.2.2 and 3.3.3.3" />
      </GuideSection>

      <GuideSection id="hv-fix" eyebrow="Incident" title="Repair and prove it" tone="success">
        <CliPair cisco={{ prompt: "RP/0/RP0/CPU0:PE1(config)#", command: "l2vpn", output: "RP/0/RP0/CPU0:PE1(config-l2vpn)#bridge group CUST-A\nRP/0/RP0/CPU0:PE1(config-l2vpn-bg)#bridge-domain HVPLS-A\nRP/0/RP0/CPU0:PE1(config-l2vpn-bg-bd)#vfi HVPLS-A\nRP/0/RP0/CPU0:PE1(config-l2vpn-bg-bd-vfi)#no neighbor 10.0.0.1 pw-id 100\nRP/0/RP0/CPU0:PE1(config-l2vpn-bg-bd-vfi)#exit\nRP/0/RP0/CPU0:PE1(config-l2vpn-bg-bd)#neighbor 10.0.0.1 pw-id 100\nRP/0/RP0/CPU0:PE1(config-l2vpn-bg-bd-pw)#commit" }} junos={{ prompt: "admin@PE1# ", command: "delete routing-instances HVPLS-A protocols vpls neighbor 10.0.0.1", output: "\n[edit]\nadmin@PE1# set routing-instances HVPLS-A protocols vpls mesh-group SPOKES neighbor 10.0.0.1\n\n[edit]\nadmin@PE1# commit and-quit\ncommit complete\nExiting configuration mode" }} ciscoCaption="IOS XR · PE1" junosCaption="Junos · PE1" />
        <PingResult s={HV_FIXED} title="The lab: a fresh ping after the fix" />
        <ChecklistCard tone="success" title="Proved, not assumed" mark="✓" items={["PE1 has 10.0.0.1 as an access pseudowire / in mesh group SPOKES again", "every pseudowire is up, as it was all along", "a fresh ping from CE1 reaches CE3 across spoke, mesh and spoke"]} />
      </GuideSection>

      <GuideSection id="hv-other" eyebrow="Beyond this incident" title="Other ways it fails" tone="warning">
        <FailureSignatures
          items={[
            { tag: "PW ID", title: "Spoke PW ID mismatch", tone: "danger", points: ["that spoke down", "the MTU-s's sites isolated"] },
            { tag: "MESH", title: "Missing mesh member", tone: "danger", points: ["one pair of hubs cut", "no relay through the third"] },
            { tag: "VLAN", title: "AC on the wrong VLAN", tone: "violet", points: ["every pseudowire up", "one site silent, even locally"] },
            { tag: "LSP", title: "Transport broken", tone: "warning", points: ["XR: PWs up, drops in the core", "Junos: PWs down"] },
          ]}
        />
        <p className="text-sm text-pv-text-muted">Each is a ticket in the H-VPLS Lab, together with this incident.</p>
      </GuideSection>

      <GuideSection id="hv-model" eyebrow="Mental model" title="Mental model" tone="cyan">
        <p>
          Picture a company with a mailroom in every small office (the MTU-s) and three regional sorting centers (the PE-rs) joined by direct trucks. A small office sorts its own internal mail and sends everything else on its one van to its regional center. The centers exchange mail on their trucks — but a center never reloads mail that arrived on one truck onto another truck; each center delivers only to its own vans. That rule keeps parcels from circling the three centers forever, and it is why every pair of centers needs its own truck. The incident is a center that files one office&apos;s van under &quot;truck&quot;: the van arrives, the center refuses to reload its mail onto the other trucks, and the office can only write to itself.
        </p>
        <Callout tone="cyan" title="When it breaks, ask in this order" icon="→">
          Which pairs of sites fail? Is each site&apos;s attachment circuit in its MTU-s bridge? Is every spoke up — same PW ID and MTU? Is the core mesh full? Is every pseudowire in the right group? Is the transport complete?
        </Callout>
      </GuideSection>

      <GuideSection id="hv-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "H-VPLS", def: "Hierarchical VPLS: access bridges with spokes to hubs, a full mesh only among the hubs (RFC 4762 §10)." },
            { term: "MTU-s", def: "Multi-tenant unit, switch-capable: the access-tier bridge with one spoke." },
            { term: "PE-rs", def: "PE, routing and switching capable: a hub in the core mesh that terminates spokes." },
            { term: "Spoke pseudowire", def: "The pseudowire from an MTU-s to its hub; outside the core's split-horizon group." },
            { term: "Mesh pseudowire", def: "A pseudowire between two PE-rs; inside the core's split-horizon group." },
            { term: "Access pseudowire (IOS XR)", def: "A neighbor configured directly under the bridge domain, outside the VFI." },
            { term: "Mesh group (Junos)", def: "A set of VPLS neighbors with split horizon among them; the default one is __ves__." },
            { term: "local-switching (Junos)", def: "Lets the members of one mesh group forward to each other." },
          ]}
        />
      </GuideSection>

      <GuideSection id="hv-recap" eyebrow="Reference" title="Recap" tone="success">
        <ChecklistCard tone="success" title="You can now" mark="✓" items={["explain what a flat mesh costs and what hierarchy saves", "name the tiers and their jobs", "follow local, spoke → mesh and mesh → spoke forwarding", "state the split-horizon rule by role", "read roles in IOS XR and Junos", "find, fix and prove a role misconfiguration"]} />
      </GuideSection>

      <GuideSection id="hv-practice" eyebrow="Next" title="Practice it" tone="violet">
        <p>The Deep Dive tab covers H-VPLS in full: the two-tier model and its arithmetic, access options, the forwarding matrix, spoke-to-spoke through a hub, learning and flooding per tier, redundancy and failure domains, IOS XR and Junos configuration, and every failure signature with real evidence. The lab lets you operate it.</p>
        <LessonLabBridge />
        <PresentationBridge>Rewatch the H-VPLS presentation.</PresentationBridge>
      </GuideSection>
    </div>
  );
}
