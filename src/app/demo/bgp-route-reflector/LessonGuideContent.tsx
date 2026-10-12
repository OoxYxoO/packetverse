import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DLink, DNode, DPill, DRegion, DiagramFrame, DiagramSvg, FailureSignatures, FieldTable, FlowSteps, Glossary, GuideSection, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { PracticeBridge } from "@/components/lesson/GuideInteractive";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import { PresentationBridge } from "@/components/presentation/LessonPresentation";
import { CliPair, CliPanel, runGuideCli } from "@/components/lesson/GuideCli";
import type { CliVendor } from "@/lib/cli/types";
import { createRrNet, rrApply, rrTicketState, type RrDev, type RrState } from "@/lib/sim-engine/scenarios/rrNet";
import { rrSets, rrStaticApi } from "./rr-lab/rrCli";

export const RR_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "rl-mission", label: "What this lesson teaches" },
  { id: "rl-network", label: "The network of this lesson" },
  { id: "rl-ideas", label: "Three ideas you need" },
  { id: "rl-watch", label: "What you will watch" },
  { id: "rl-mesh", label: "Full mesh and n(n−1)/2" },
  { id: "rl-split", label: "The rule it bends" },
  { id: "rl-rr", label: "Enter RR1" },
  { id: "rl-pipeline", label: "RR1's four stages" },
  { id: "rl-attrs", label: "ORIGINATOR_ID & CLUSTER_LIST" },
  { id: "rl-rules", label: "The reflection rules" },
  { id: "rl-tworr", label: "A second reflector" },
  { id: "rl-not", label: "What an RR doesn't do" },
  { id: "rl-working", label: "What working looks like" },
  { id: "rl-incident", label: "The incident" },
  { id: "rl-investigate", label: "Follow the route" },
  { id: "rl-repair", label: "Repair and prove it" },
  { id: "rl-other", label: "Other ways reflection breaks" },
  { id: "rl-challenge", label: "The 6-PE redesign" },
  { id: "rl-model", label: "Mental model" },
  { id: "rl-glossary", label: "Glossary" },
  { id: "rl-recap", label: "Recap" },
  { id: "rl-practice", label: "Practice it" },
];

/**
 * The CLI samples on this page are the Route Reflector Lab's own IOS XR / Junos command set, run against the lab's model:
 * the healthy two-reflector design, and the lab's “PE3 non-client” ticket — the same fault the guided lesson ends with.
 */
export const RR_HEALTHY: RrState = createRrNet(0);
const RR_PE3_NONCLIENT: RrState = rrTicketState("client", 0);
const RR_PE3_FIXED: RrState = rrApply(RR_PE3_NONCLIENT, { type: "set", text: "RR2: 5.5.5.5 is a route-reflector client again", changes: [{ dev: "RR2", f: (c) => void (c.nbrs.find((x) => x.ip === "5.5.5.5")!.client = true) }] });
export function rrCli(s: RrState, r: RrDev, vendor: CliVendor, command: string) {
  return runGuideCli(rrSets(rrStaticApi(s, r), r)[vendor], command);
}
/** The XR summary is long; the guide keeps only the neighbor table. */
export function rrSummary(s: RrState, r: RrDev) {
  const run = rrCli(s, r, "cisco", "show bgp summary");
  const lines = run.output.split("\n");
  const i = lines.findIndex((l) => l.startsWith("Neighbor"));
  return { ...run, output: [lines[0], "...", ...lines.slice(i)].join("\n") };
}
/** `show bgp` on XR: only the status-code legend and the table. */
function rrTable(s: RrState, r: RrDev) {
  const run = rrCli(s, r, "cisco", "show bgp");
  const lines = run.output.split("\n");
  const i = lines.findIndex((l) => l.startsWith("Status codes"));
  return { ...run, output: [lines[0], "...", ...lines.slice(i)].join("\n") };
}

function LessonLabBridge() {
  const openLab = usePracticeLabOpener();
  return (
    <PracticeBridge label="Open the Route Reflector Lab" onPractice={openLab}>
      The same AS 65000 with customers behind every PE, IOS XR or Junos, your own copy. Nothing you do there changes your lesson progress.
    </PracticeBridge>
  );
}

/** The lab's network: two clusters, four PEs, a customer behind each PE. */
export function LabNetworkDiagram() {
  const pes: [string, number, string, string][] = [
    ["PE1", 90, "1.1.1.1", "CE1 · 10.1.1.0/24"],
    ["PE2", 240, "4.4.4.4", "CE2 · 10.2.2.0/24"],
    ["PE3", 400, "5.5.5.5", "CE3 · 10.3.3.0/24"],
    ["PE4", 550, "6.6.6.6", "CE4 · 10.4.4.0/24"],
  ];
  return (
    <DiagramSvg h={250} label="RR1 serves PE1 and PE2, RR2 serves PE3 and PE4; each PE has a customer network; RR1 and RR2 peer as non-clients">
      <DRegion x={14} y={10} w={300} h={176} label="cluster 100.100.100.100" color={D.violet} />
      <DRegion x={326} y={10} w={300} h={176} label="cluster 200.200.200.200" color={D.bgp} />
      {pes.map(([id, x], i) => (
        <DLink key={id} x1={i < 2 ? 165 : 475} y1={74} x2={x} y2={130} color={i < 2 ? D.violet : D.bgp} />
      ))}
      <DLink x1={213} y1={56} x2={427} y2={56} color={D.warning} dashed label="non-client" />
      <DNode x={165} y={56} label="RR1" sub="9.9.9.9" accent={D.violet} />
      <DNode x={475} y={56} label="RR2" sub="10.10.10.10" accent={D.bgp} />
      {pes.map(([id, x, lo, ce]) => (
        <g key={id}>
          <DNode x={x} y={148} label={id} sub={lo} w={86} />
          <DLink x1={x} y1={172} x2={x} y2={204} color={D.ip} />
          <text x={x} y={220} textAnchor="middle" fill={D.ip} fontSize={10} fontWeight={600}>
            {ce}
          </text>
        </g>
      ))}
      <text x={320} y={242} textAnchor="middle" fill={D.muted} fontSize={10}>
        10.9.9.0/24 is dual-homed: CE1 and CE4 both advertise it
      </text>
    </DiagramSvg>
  );
}

/** Where the route stops in the incident. */
function StopDiagram() {
  return (
    <DiagramSvg h={190} label="PE1's route reaches RR1, then RR2; RR2 reflects it to PE4 but not to PE3, which is configured as a non-client">
      <DNode x={60} y={46} label="PE1" sub="client" w={84} />
      <DNode x={220} y={46} label="RR1" sub="cluster 100…" accent={D.violet} w={100} />
      <DNode x={480} y={46} label="RR2" sub="cluster 200…" accent={D.bgp} w={100} />
      <DNode x={360} y={160} label="PE3" sub="non-client (!)" accent={D.danger} w={110} />
      <DNode x={590} y={160} label="PE4" sub="client" w={84} />
      <DArrow x1={102} y1={46} x2={170} y2={46} color={D.success} />
      <DArrow x1={270} y1={46} x2={430} y2={46} color={D.success} />
      <text x={350} y={36} textAnchor="middle" fill={D.success} fontSize={10} fontWeight={600}>
        RR1 is a non-client of RR2
      </text>
      <DArrow x1={505} y1={70} x2={570} y2={136} color={D.success} />
      <text x={560} y={100} fill={D.success} fontSize={10} fontWeight={600}>
        to a client ✓
      </text>
      <DArrow x1={455} y1={70} x2={385} y2={136} color={D.danger} dashed />
      <text x={410} y={100} textAnchor="end" fill={D.danger} fontSize={10} fontWeight={700}>
        non-client → non-client ✕
      </text>
    </DiagramSvg>
  );
}

function MeshDiagram() {
  const pos: Record<string, [number, number]> = { PE1: [170, 50], PE2: [470, 50], PE3: [170, 170], PE4: [470, 170] };
  const ids = Object.keys(pos);
  const edges: [string, string][] = [];
  ids.forEach((a, i) => ids.slice(i + 1).forEach((b) => edges.push([a, b])));
  return (
    <DiagramSvg h={220} label="Four PEs in a full iBGP mesh: six sessions">
      {edges.map(([a, b]) => (
        <DLink key={a + b} x1={pos[a][0]} y1={pos[a][1]} x2={pos[b][0]} y2={pos[b][1]} color={D.bgp} />
      ))}
      {ids.map((id) => (
        <DNode key={id} x={pos[id][0]} y={pos[id][1]} label={id} sub={{ PE1: "1.1.1.1", PE2: "4.4.4.4", PE3: "5.5.5.5", PE4: "6.6.6.6" }[id]} />
      ))}
      <text x={320} y={210} textAnchor="middle" fill={D.muted} fontSize={10}>
        AS 65000 · every PE peers with every other PE
      </text>
    </DiagramSvg>
  );
}

function SplitDiagram() {
  return (
    <DiagramSvg h={150} label="PE1 advertises to PE2, but PE2 does not re-advertise to PE3">
      <DNode x={100} y={70} label="PE1" sub="10.1.1.0/24" />
      <DNode x={320} y={70} label="PE2" />
      <DNode x={540} y={70} label="PE3" />
      <DArrow x1={152} y1={70} x2={268} y2={70} color={D.success} label="iBGP UPDATE" />
      <DArrow x1={372} y1={70} x2={450} y2={70} color={D.danger} dashed />
      <text x={462} y={77} fill={D.danger} fontSize={18} fontWeight={700}>
        ✕
      </text>
      <text x={320} y={130} textAnchor="middle" fill={D.muted} fontSize={10}>
        iBGP-learned routes are not passed to another ordinary iBGP peer
      </text>
    </DiagramSvg>
  );
}

function HubDiagram() {
  const pes: [string, number][] = [
    ["PE1", 110],
    ["PE2", 250],
    ["PE3", 390],
    ["PE4", 530],
  ];
  return (
    <DiagramSvg h={200} label="RR1 in the middle with PE1 to PE4 as its clients: four sessions">
      <DRegion x={20} y={10} w={600} h={180} label="cluster 100.100.100.100" color={D.violet} />
      {pes.map(([p, x]) => (
        <DLink key={p} x1={320} y1={70} x2={x} y2={150} color={D.violet} />
      ))}
      <DNode x={320} y={60} label="RR1" sub="9.9.9.9" accent={D.violet} />
      {pes.map(([p, x]) => (
        <DNode key={p} x={x} y={150} label={p} sub="client" w={84} />
      ))}
    </DiagramSvg>
  );
}

function PipelineDiagram() {
  const st: [string, string][] = [
    ["ROUTE RECEIVED", D.ospf],
    ["BEST PATH SELECTED", D.success],
    ["REFLECTION DECISION", D.violet],
    ["ROUTE REFLECTED", D.bgp],
  ];
  return (
    <DiagramSvg h={120} label="RR1 pipeline: route received, best path selected, reflection decision, route reflected">
      {st.map(([s, c], i) => (
        <g key={s}>
          <DPill x={82 + i * 158} y={50} text={s} color={c} w={146} />
          {i < st.length - 1 && <DArrow x1={156 + i * 158} y1={50} x2={162 + i * 158} y2={50} color={D.faint} width={1.6} />}
        </g>
      ))}
      <text x={320} y={100} textAnchor="middle" fill={D.muted} fontSize={10}>
        only the third stage is new; the rest is ordinary BGP
      </text>
    </DiagramSvg>
  );
}

function AttrDiagram() {
  const row = (y: number, who: string, extra: string, c: string) => (
    <g>
      <text x={20} y={y + 20} fill={D.text} fontSize={11.5} fontWeight={600}>
        {who}
      </text>
      <rect x={140} y={y} width={490} height={32} rx={8} fill={c} fillOpacity={0.1} stroke={c} />
      <text x={152} y={y + 20} fill={D.text} fontSize={10} fontFamily="monospace">
        10.1.1.0/24 · NH 1.1.1.1 · LP 100{extra}
      </text>
    </g>
  );
  return (
    <DiagramSvg h={150} label="The reflected UPDATE adds ORIGINATOR_ID and CLUSTER_LIST but keeps NEXT_HOP">
      {row(14, "PE1 → RR1", "", D.ospf)}
      {row(60, "RR1 → clients", " · ORIG 1.1.1.1 · CL [100.100.100.100]", D.violet)}
      {row(106, "via RR2 too", " · ORIG 1.1.1.1 · CL [200…, 100…]", D.bgp)}
    </DiagramSvg>
  );
}

function TwoRrDiagram() {
  return (
    <DiagramSvg h={220} label="RR1 serves PE1 and PE2, RR2 serves PE3 and PE4, and RR1 and RR2 peer as non-clients">
      <DRegion x={14} y={10} w={296} h={200} label="cluster 100.100.100.100" color={D.violet} />
      <DRegion x={330} y={10} w={296} h={200} label="cluster 200.200.200.200" color={D.bgp} />
      <DLink x1={162} y1={70} x2={90} y2={160} color={D.violet} />
      <DLink x1={162} y1={70} x2={234} y2={160} color={D.violet} />
      <DLink x1={478} y1={70} x2={406} y2={160} color={D.bgp} />
      <DLink x1={478} y1={70} x2={550} y2={160} color={D.bgp} />
      <DLink x1={212} y1={60} x2={428} y2={60} color={D.warning} dashed label="non-client iBGP" />
      <DNode x={162} y={60} label="RR1" sub="9.9.9.9" accent={D.violet} />
      <DNode x={478} y={60} label="RR2" sub="10.10.10.10" accent={D.bgp} />
      <DNode x={90} y={165} label="PE1" w={80} />
      <DNode x={234} y={165} label="PE2" w={80} />
      <DNode x={406} y={165} label="PE3" w={80} />
      <DNode x={550} y={165} label="PE4" w={80} />
    </DiagramSvg>
  );
}

function PlanesDiagram() {
  return (
    <DiagramSvg h={200} label="The VPNv4 route goes through the RR; customer traffic goes directly between PEs over the MPLS core">
      <DNode x={320} y={40} label="RR1" sub="control plane only" accent={D.violet} w={150} />
      <DNode x={110} y={150} label="PE1" />
      <DNode x={530} y={150} label="PE2" />
      <DArrow x1={500} y1={126} x2={380} y2={60} color={D.violet} label="VPNv4 UPDATE" labelDy={-6} />
      <DArrow x1={260} y1={60} x2={140} y2={126} color={D.violet} label="reflected" labelDy={-6} />
      <DArrow x1={162} y1={160} x2={478} y2={160} color={D.mpls} both label="customer packets (MPLS core, never via RR)" labelDy={-8} />
    </DiagramSvg>
  );
}

export function RrLessonGuideContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="rl-mission" eyebrow="This lesson" title="What this lesson teaches" tone="violet">
        <p>
          Provider <b className="text-pv-text">AS 65000</b> runs iBGP between its PE routers so that every PE learns the customer routes behind every other PE. With four PEs a full mesh of sessions is fine. With a hundred it isn&apos;t. This lesson shows the rule that forces the mesh, and how a <b className="text-pv-text">route reflector</b> bends that rule safely.
        </p>
        <p>You will watch PE1&apos;s route travel through RR1, then through a second reflector, and see the two attributes that keep it from looping. Then one PE is reconfigured as a non-client: its session stays up, and half the network disappears from its table. You find out why, fix it and prove it.</p>
        <ChecklistCard
          tone="violet"
          title="By the end of this lesson you can"
          mark="→"
          items={["explain why iBGP needs a full mesh, and what n(n−1)/2 means for growth", "say exactly which rule a route reflector relaxes", "apply the reflection rules for clients and non-clients", "read ORIGINATOR_ID and CLUSTER_LIST and explain how they stop loops", "design two reflectors for redundancy", "find why a PE with an Established session is missing routes — and prove the fix"]}
        />
      </GuideSection>

      <GuideSection id="rl-network" eyebrow="This lesson" title="The network of this lesson" tone="cyan">
        <DiagramFrame caption="Two clusters, four PEs, a customer behind each PE. The IGP (IS-IS) reaches every loopback; BGP only runs where shown.">
          <LabNetworkDiagram />
        </DiagramFrame>
        <FieldTable
          title="Who is who"
          accent="bgp"
          columns={["Router", "Loopback / router ID", "Role"]}
          rows={[
            ["RR1", <Mono key="1">9.9.9.9</Mono>, "reflector, cluster 100.100.100.100; clients PE1, PE2"],
            ["RR2", <Mono key="2">10.10.10.10</Mono>, "reflector, cluster 200.200.200.200; clients PE3, PE4"],
            ["PE1 / PE2", <Mono key="3">1.1.1.1 / 4.4.4.4</Mono>, "clients of RR1; customers CE1 / CE2"],
            ["PE3 / PE4", <Mono key="4">5.5.5.5 / 6.6.6.6</Mono>, "clients of RR2; customers CE3 / CE4"],
          ]}
        />
        <p className="text-sm text-pv-text-muted">The guided lesson follows one prefix, 10.1.1.0/24 behind PE1, and ends with a six-PE redesign (PE5 7.7.7.7, PE6 8.8.8.8). The Route Reflector Lab adds a customer behind every PE so you can test from both sides; every output on this page comes from the lab.</p>
      </GuideSection>

      <GuideSection id="rl-ideas" eyebrow="This lesson" title="Three ideas you need" tone="violet">
        <CompareCards
          items={[
            { title: "Split horizon", tone: "danger", tag: "the rule", points: ["an iBGP-learned route is never passed to another iBGP peer", "inside one AS it is the loop protection"] },
            { title: "Reflection", tone: "violet", tag: "the exception", points: ["a reflector may pass routes on for its clients", "it is still plain BGP — clients need no new feature"] },
            { title: "Loop guards", tone: "warning", tag: "the safety", points: ["ORIGINATOR_ID: who first sent it into the AS", "CLUSTER_LIST: which clusters it passed through"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="rl-watch" eyebrow="This lesson" title="What you will watch" tone="cyan">
        <FlowSteps
          steps={[
            { title: "The mesh", body: "Four PEs, six sessions — and the growth curve.", tone: "bgp" },
            { title: "Split horizon", body: "PE2 won't pass PE1's route to PE3.", tone: "danger" },
            { title: "RR1", body: "Receive, select, decide, reflect.", tone: "violet" },
            { title: "Two reflectors", body: "CLUSTER_LIST grows to two entries.", tone: "violet" },
            { title: "The incident", body: "PE3 is a non-client: session up, routes gone.", tone: "danger" },
            { title: "Repair", body: "Client again, prove the table and the traffic.", tone: "success" },
          ]}
        />
      </GuideSection>

      <GuideSection id="rl-mesh" eyebrow="The problem" title="Full mesh and n(n−1)/2" tone="bgp">
        <DiagramFrame caption="Every PE learns every other PE's routes because it has a session to each of them.">
          <MeshDiagram />
        </DiagramFrame>
        <FieldTable
          title="Full-mesh sessions"
          accent="danger"
          columns={["PEs", "Sessions", "Touched to add one PE"]}
          rows={[
            ["4", "6", "4 routers"],
            ["10", "45", "10 routers"],
            ["50", "1,225", "50 routers"],
            ["100", "4,950", "100 routers"],
          ]}
        />
        <p>Every session is configuration, memory, CPU and something to monitor — and adding one PE means changing every existing one. That is the cost a reflector removes.</p>
      </GuideSection>

      <GuideSection id="rl-split" eyebrow="Root cause" title="The rule a route reflector bends" tone="danger">
        <DiagramFrame caption="Split horizon prevents loops, and forces the full mesh.">
          <SplitDiagram />
        </DiagramFrame>
        <p>
          eBGP prevents loops with AS_PATH: a router drops a route that already contains its own AS. Inside one AS the AS_PATH never changes, so iBGP uses a blunter rule instead: <b className="text-pv-text">a route learned from an iBGP peer is never advertised to another iBGP peer</b>. PE2 hears 10.1.1.0/24 from PE1 and keeps it to itself. The only way for PE3 to learn it is a session with PE1 — hence the mesh.
        </p>
      </GuideSection>

      <GuideSection id="rl-rr" eyebrow="The fix" title="Enter RR1" tone="violet">
        <DiagramFrame caption="Each PE has one session, to RR1. The gap to the mesh widens with every PE added.">
          <HubDiagram />
        </DiagramFrame>
        <p>
          Same PEs, same AS, but each PE now peers only with <b className="text-pv-text">RR1</b>. RR1 is configured to treat them as <b className="text-pv-text">clients</b>, and that one word lets it re-advertise (reflect) iBGP routes between them. The clients are ordinary BGP speakers: they don&apos;t know they are clients.
        </p>
        <CliPair cisco={{ prompt: "RP/0/RP0/CPU0:RR1(config)#", command: "router bgp 65000", output: "RP/0/RP0/CPU0:RR1(config-bgp)#bgp cluster-id 100.100.100.100\nRP/0/RP0/CPU0:RR1(config-bgp)#neighbor 1.1.1.1\nRP/0/RP0/CPU0:RR1(config-bgp-nbr)#remote-as 65000\nRP/0/RP0/CPU0:RR1(config-bgp-nbr)#update-source Loopback0\nRP/0/RP0/CPU0:RR1(config-bgp-nbr)#address-family ipv4 unicast\nRP/0/RP0/CPU0:RR1(config-bgp-nbr-af)#route-reflector-client\nRP/0/RP0/CPU0:RR1(config-bgp-nbr-af)#commit" }} junos={{ prompt: "admin@RR1# ", command: "set protocols bgp group CLIENTS cluster 100.100.100.100", output: "\n[edit]\nadmin@RR1# set protocols bgp group CLIENTS neighbor 1.1.1.1\n\n[edit]\nadmin@RR1# commit\ncommit complete" }} ciscoCaption="IOS XR · RR1 — the client role is per neighbor" junosCaption="Junos · RR1 — a group with a cluster ID is a client group" />
      </GuideSection>

      <GuideSection id="rl-pipeline" eyebrow="Walkthrough" title="What RR1 does with PE1's UPDATE" tone="violet">
        <DiagramFrame caption="The guided lesson steps through these four stages one at a time.">
          <PipelineDiagram />
        </DiagramFrame>
        <FlowSteps
          steps={[
            { title: "Route received", body: "PE1 sends an ordinary iBGP UPDATE: prefix, NEXT_HOP 1.1.1.1, LOCAL_PREF 100.", tone: "cyan" },
            { title: "Best path selected", body: "Normal best-path selection. A reflector only ever reflects its best path.", tone: "success" },
            { title: "Reflection decision", body: "It came from a client, so it goes to every other client and to every non-client peer.", tone: "violet" },
            { title: "Route reflected", body: "RR1 adds ORIGINATOR_ID and its cluster ID, and sends it on.", tone: "violet" },
          ]}
        />
      </GuideSection>

      <GuideSection id="rl-attrs" eyebrow="Loop prevention" title="ORIGINATOR_ID and CLUSTER_LIST" tone="warning">
        <DiagramFrame caption="The route gains two attributes as it is reflected. NEXT_HOP, LOCAL_PREF and AS_PATH stay as PE1 sent them.">
          <AttrDiagram />
        </DiagramFrame>
        <ChecklistCard
          tone="warning"
          mark="↺"
          title="How they stop loops"
          items={["ORIGINATOR_ID = the router ID of the PE that sent the route into the AS (1.1.1.1). A router that sees its own ID there drops the route.", "CLUSTER_LIST = every cluster the route was reflected through. A reflector that sees its own cluster ID there drops the route — AS_PATH, but between clusters."]}
        />
      </GuideSection>

      <GuideSection id="rl-rules" eyebrow="Rules" title="The reflection rules" tone="violet">
        <FieldTable
          title="What a reflector does with its best path, learned from…"
          accent="violet"
          columns={["Learned from", "To its clients?", "To non-client iBGP peers?"]}
          rows={[
            ["a client", "yes (all others)", "yes"],
            ["a non-client iBGP peer", "yes", "no — ordinary split horizon"],
            ["an eBGP peer", "yes", "yes"],
          ]}
        />
        <p>The second row is the one that matters most in this lesson: a route that arrives from a non-client can only go to clients. Get a PE&apos;s role wrong and that row silently cuts it off.</p>
      </GuideSection>

      <GuideSection id="rl-tworr" eyebrow="Redundancy" title="A second reflector" tone="bgp">
        <DiagramFrame caption="A route from cluster 1 reaches cluster 2 through the non-client session between the reflectors.">
          <TwoRrDiagram />
        </DiagramFrame>
        <p>
          One reflector is a single point of failure, so <b className="text-pv-text">RR2</b> (cluster 200.200.200.200) takes PE3 and PE4. RR1 and RR2 peer as ordinary non-clients. PE1&apos;s route reaches RR1 from a client, so RR1 sends it to PE2 and to RR2. RR2 learned it from a non-client, so it reflects it to its clients only — PE3 and PE4 — and prepends its own cluster ID.
        </p>
        <CliPanel run={rrCli(RR_HEALTHY, "PE3", "cisco", "show bgp 10.1.1.0/24")} caption="IOS XR · PE3 — next hop still PE1, learned from RR2, two clusters in the list" />
        <p className="text-sm text-pv-text-muted">This lab gives each reflector its own clients. Two reflectors that share all the clients (and often one cluster ID) is the other common design — the lab&apos;s challenges let you build it.</p>
      </GuideSection>

      <GuideSection id="rl-not" eyebrow="Boundaries" title="What a route reflector does not do" tone="danger">
        <DiagramFrame caption="The routes go through the reflector; the traffic goes directly between PEs.">
          <PlanesDiagram />
        </DiagramFrame>
        <ChecklistCard tone="danger" mark="✕" title="Not a reflector's job" items={["It isn't a new protocol — it's BGP with a re-advertisement exception.", "It doesn't change NEXT_HOP: traffic goes PE to PE, never through the reflector.", "It doesn't replace the IGP: every PE still needs a route to every next hop.", "It doesn't forward customer packets, and for VPN routes it doesn't interpret the RD, route targets or labels."]} />
        <p>That last point is why reflectors are the backbone of MPLS L3VPN later in this path: the VPNv4 routes ride through the same reflectors, untouched.</p>
      </GuideSection>

      <GuideSection id="rl-working" eyebrow="Evidence" title="What working looks like" tone="success">
        <FieldTable
          title="Healthy, in four questions"
          accent="success"
          columns={["Question", "IOS XR / Junos", "Healthy answer"]}
          rows={[
            ["Is every session up?", <Mono key="1">show bgp summary</Mono>, "RR1: three neighbors, prefix counts, no Active/Idle"],
            ["Is the PE a client?", <Mono key="2">show bgp neighbors 5.5.5.5</Mono>, "“Route-Reflector Client” (Junos: a group with a cluster)"],
            ["Does the PE have the prefix?", <Mono key="3">show bgp 10.1.1.0/24</Mono>, "next hop 1.1.1.1, Originator 1.1.1.1, two clusters"],
            ["Does the traffic flow?", <Mono key="4">ping from the customer</Mono>, "CE3 reaches 10.1.1.10"],
          ]}
        />
        <CliPanel run={rrSummary(RR_HEALTHY, "RR1")} caption="IOS XR · RR1 — two clients and RR2, all Established" />
        <CliPair cisco={rrCli(RR_HEALTHY, "RR2", "cisco", "show bgp neighbors 5.5.5.5")} junos={rrCli(RR_HEALTHY, "RR2", "juniper", "show bgp neighbor 5.5.5.5")} ciscoCaption="IOS XR · RR2 — PE3 is a client" junosCaption="Junos · RR2 — PE3 is in the client group" />
        <CliPanel run={rrCli(RR_HEALTHY, "PE3", "juniper", "show route 10.1.1.10 detail")} caption="Junos · PE3 — the same route, with Originator ID and Cluster list" />
      </GuideSection>

      <GuideSection id="rl-incident" eyebrow="Incident" title="The incident" tone="danger">
        <p>
          After a cleanup on RR2, CE3 reaches CE4 but nothing behind PE1 or PE2. PE3&apos;s session to RR2 is Established and the IGP is fine. Somebody rewrote PE3&apos;s neighbor on RR2 without the client role.
        </p>
        <DiagramFrame caption="The route reaches RR2 from a non-client — and PE3 is now a non-client too.">
          <StopDiagram />
        </DiagramFrame>
        <CompareCards
          items={[
            { title: "What it is", tone: "danger", tag: "cause", points: ["RR2 treats PE3 as an ordinary iBGP peer", "routes from RR1 (non-client) may only go to clients", "PE4 still gets them; PE3 doesn't"] },
            { title: "What it can't be", tone: "success", tag: "ruled out", points: ["the session: Established", "the IGP: every loopback reachable", "PE1's route: RR2 has it, with a valid next hop"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="rl-investigate" eyebrow="Incident" title="Follow the route" tone="danger">
        <TroubleshootingFlow
          steps={[
            { question: "What exactly is missing?", look: "PE3's table: its own and PE4's prefixes, nothing from cluster 1." },
            { question: "Does RR2 have the route?", look: "Yes: 10.1.1.0/24 from 9.9.9.9, valid, best — advertised to 6.6.6.6 only." },
            { question: "What does RR2 send PE3?", look: "Only PE4's prefixes — routes from a client." },
            { question: "Why not the rest?", look: "PE3 is no longer a Route-Reflector Client: non-client → non-client is forbidden." },
          ]}
        />
        <CliPanel run={rrTable(RR_PE3_NONCLIENT, "PE3")} caption="IOS XR · PE3 — only its own and PE4's prefixes" />
        <CliPanel run={rrCli(RR_PE3_NONCLIENT, "RR2", "cisco", "show bgp 10.1.1.0/24")} caption="IOS XR · RR2 — the route is here and best, advertised only to 6.6.6.6" />
        <CliPair cisco={rrCli(RR_PE3_NONCLIENT, "RR2", "cisco", "show bgp neighbors 5.5.5.5")} junos={rrCli(RR_PE3_NONCLIENT, "RR2", "juniper", "show bgp neighbor 5.5.5.5")} ciscoCaption="IOS XR · RR2 — no “Route-Reflector Client” line" junosCaption="Junos · RR2 — PE3 sits in group CORE (no cluster)" />
      </GuideSection>

      <GuideSection id="rl-repair" eyebrow="Incident" title="Repair and prove it" tone="success">
        <CliPair cisco={{ prompt: "RP/0/RP0/CPU0:RR2(config)#", command: "router bgp 65000", output: "RP/0/RP0/CPU0:RR2(config-bgp)#neighbor 5.5.5.5\nRP/0/RP0/CPU0:RR2(config-bgp-nbr)#address-family ipv4 unicast\nRP/0/RP0/CPU0:RR2(config-bgp-nbr-af)#route-reflector-client\nRP/0/RP0/CPU0:RR2(config-bgp-nbr-af)#commit" }} junos={{ prompt: "admin@RR2# ", command: "delete protocols bgp group CORE neighbor 5.5.5.5", output: "\n[edit]\nadmin@RR2# set protocols bgp group CLIENTS neighbor 5.5.5.5\n\n[edit]\nadmin@RR2# commit\ncommit complete" }} ciscoCaption="IOS XR · RR2" junosCaption="Junos · RR2 — move PE3 back into the client group" />
        <CliPanel run={rrTable(RR_PE3_FIXED, "PE3")} caption="IOS XR · PE3 — every customer prefix is back" />
        <ChecklistCard tone="success" title="Proved, not assumed" mark="✓" items={["RR2 shows PE3 as a Route-Reflector Client", "PE3 has 10.1.1.0/24 and 10.2.2.0/24, next hops 1.1.1.1 and 4.4.4.4", "a fresh ping from CE3 to 10.1.1.10 succeeds"]} />
      </GuideSection>

      <GuideSection id="rl-other" eyebrow="Beyond this incident" title="Other ways reflection breaks" tone="warning">
        <FailureSignatures
          items={[
            { tag: "CID", title: "Two clusters, one cluster ID", tone: "danger", points: ["every session up, nothing crosses between clusters", "each reflector drops the other's routes as loops"] },
            { tag: "NBR", title: "Wrong neighbor address", tone: "warning", points: ["the PE is an island: no session at all", "show bgp summary: Active toward an address nobody owns"] },
            { tag: "NHS", title: "No next-hop-self on a PE", tone: "violet", points: ["the reflector has the route, nobody else does", "next hop is the CE's address: inaccessible, never best, never reflected"] },
            { tag: "POL", title: "Outbound policy between reflectors", tone: "warning", points: ["one prefix missing in the other cluster only", "compare advertised-routes with the BGP table"] },
          ]}
        />
        <p className="text-sm text-pv-text-muted">Each is a ticket in the Route Reflector Lab, together with this incident.</p>
      </GuideSection>

      <GuideSection id="rl-challenge" eyebrow="Engineer challenge" title="The 6-PE redesign" tone="violet">
        <p>The guided lesson ends with six PEs: a full mesh needs 15 sessions. A good design passes four checks — the guided challenge scores yours against them.</p>
        <ChecklistCard tone="violet" mark="→" title="How to judge a design" items={["Coverage: is every PE a client of some reflector?", "Distribution: can a route from one cluster reach the clients of the other?", "Redundancy: does losing one reflector take down all reflection?", "Scale: fewer sessions than the 15-session mesh?"]} />
      </GuideSection>

      <GuideSection id="rl-model" eyebrow="Mental model" title="Mental model" tone="cyan">
        <p>
          Think of iBGP as a meeting where nobody may repeat what they heard from a colleague — only what they saw themselves. That keeps rumours from circling, but everyone has to talk to everyone. A reflector is the one person allowed to repeat what clients tell it. To keep rumours from circling anyway, it writes two things on every note: who said it first (ORIGINATOR_ID) and which reflectors already passed it on (CLUSTER_LIST).
        </p>
        <Callout tone="cyan" title="When it breaks, ask in this order" icon="→">
          Is every session Established? Which PE is missing which prefix? Does the reflector have it — and is it best (valid next hop)? Who did the reflector learn it from, and is the receiver a client? Did a loop check (same cluster, same originator) or a policy drop it?
        </Callout>
      </GuideSection>

      <GuideSection id="rl-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "iBGP split horizon", def: "A route learned from an iBGP peer is not advertised to another iBGP peer." },
            { term: "Route reflector", def: "An iBGP speaker allowed to re-advertise iBGP routes for its clients." },
            { term: "Client / non-client", def: "A peer the reflector reflects for / an ordinary iBGP peer. Only the reflector knows the difference." },
            { term: "Cluster", def: "A reflector and its clients, named by the cluster ID (by default the reflector's router ID)." },
            { term: "ORIGINATOR_ID", def: "Router ID of the router that sent the route into the AS; added by the first reflector." },
            { term: "CLUSTER_LIST", def: "Cluster IDs the route was reflected through, newest first." },
            { term: "Next-hop-self", def: "A PE replaces the eBGP next hop (the CE) with its own loopback when it advertises into iBGP." },
          ]}
        />
      </GuideSection>

      <GuideSection id="rl-recap" eyebrow="Reference" title="Recap" tone="success">
        <ChecklistCard tone="success" title="You can now" mark="✓" items={["explain why iBGP forces a full mesh and how it grows", "name the rule a reflector relaxes and the rules it applies", "read ORIGINATOR_ID and CLUSTER_LIST", "design two reflectors and connect their clusters", "find why an Established PE is missing routes, and prove the repair"]} />
      </GuideSection>

      <GuideSection id="rl-practice" eyebrow="Next" title="Practice it" tone="violet">
        <p>The Deep Dive tab covers route reflection in full: the exact advertisement rules, both loop attributes, redundancy designs and the same-cluster debate, hierarchy, best-path effects of a reflector, next-hop handling, and every failure signature with real evidence. The lab lets you operate it.</p>
        <LessonLabBridge />
        <PresentationBridge>Rewatch the route reflector presentation.</PresentationBridge>
      </GuideSection>
    </div>
  );
}
