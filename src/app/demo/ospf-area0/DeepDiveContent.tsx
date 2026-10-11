import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DLink, DNode, DPill, DRegion, DiagramFrame, DiagramSvg, FailureSignatures, FieldTable, FlowSteps, GuideSection, Misconceptions, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { ExplainIt, KnowledgeQuiz, PracticeBridge, type KnowledgeQuestion } from "@/components/lesson/GuideInteractive";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import { PresentationBridge } from "@/components/presentation/LessonPresentation";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { CliPair, CliPanel, FailureWalk, pickLines, runGuideCli } from "@/components/lesson/GuideCli";
import type { CliVendor } from "@/lib/cli/types";
import { createOsNet, osApply, osClone, osTicket, osTicketState, type OsRouter, type OsState, type OsTicketId } from "@/lib/sim-engine/scenarios/ospfNet";
import { osRouterSets, type OsCliApi } from "./ospf-lab/osCli";
import { AreaMismatchDiagram, Diamond, FloodDiagram, HelloDiagram, SyncDiagram } from "./LessonGuideContent";

/**
 * OSPF DEEP DIVE — the complete study course, taught on the lesson's own Area 0 diamond (R1–R4). Every CLI sample is
 * produced by running the OSPF Lab's model and its real Cisco/Junos command sets.
 * Progression: Foundation → Neighbors → One shared map → Path calculation → Change → Operations → Troubleshooting → Beyond → Master it.
 */

// Real CLI output, run by the lab's own command sets against the lab's model: the guide shows exactly what the lab shows.
function cliApi(s: OsState): OsCliApi {
  const exec = { kind: "exec" } as const;
  return { view: s, act: () => s, ios: { R1: exec, R2: exec, R3: exec, R4: exec }, setIos: () => undefined, junosEdit: { R1: false, R2: false, R3: false, R4: false }, setJunosEdit: () => undefined, cand: osClone(s.cfg.r), setCand: () => undefined };
}
const cli = (s: OsState, r: OsRouter, vendor: CliVendor, command: string) => runGuideCli(osRouterSets(cliApi(s), r)[vendor]!, command);
/** A ticket's network after its test ran: the state the student investigates. */
const ticketState = (id: OsTicketId) => osTicket(id).repro.reduce((acc, a) => osApply(acc, a), osTicketState(id, 1));
const WARM = createOsNet();

function AreasDiagram() {
  return (
    <DiagramSvg h={220} label="Area 0 backbone connected to Area 1 and Area 2 through area border routers">
      <DRegion x={220} y={20} w={200} h={120} label="Area 0 (backbone)" color={D.ospf} />
      <DRegion x={14} y={90} w={190} h={110} label="Area 1" color={D.violet} />
      <DRegion x={436} y={90} w={190} h={110} label="Area 2" color={D.success} />
      <DNode x={270} y={80} label="Core A" w={80} />
      <DNode x={370} y={80} label="Core B" w={80} />
      <DNode x={210} y={140} label="ABR 1" sub="Area 0 + 1" accent={D.warning} w={96} />
      <DNode x={430} y={140} label="ABR 2" sub="Area 0 + 2" accent={D.warning} w={96} />
      <DNode x={90} y={170} label="R-a" w={70} />
      <DNode x={550} y={170} label="R-b" w={70} />
      <DLink x1={310} y1={80} x2={330} y2={80} />
      <DLink x1={250} y1={100} x2={220} y2={118} />
      <DLink x1={390} y1={100} x2={420} y2={118} />
      <DLink x1={125} y1={170} x2={162} y2={150} />
      <DLink x1={515} y1={170} x2={478} y2={150} />
    </DiagramSvg>
  );
}

function FsmDiagram() {
  const states: [string, string][] = [
    ["DOWN", D.faint],
    ["INIT", D.warning],
    ["2-WAY", D.ospf],
    ["EXSTART", D.violet],
    ["EXCHANGE", D.violet],
    ["LOADING", D.warning],
    ["FULL", D.success],
  ];
  return (
    <DiagramSvg h={150} label="OSPF neighbor states from DOWN to FULL">
      {states.map(([s, c], i) => (
        <g key={s}>
          <DPill x={48 + i * 91} y={50} text={s} color={c} w={82} />
          {i < states.length - 1 && <DArrow x1={90 + i * 91} y1={50} x2={96 + i * 91} y2={50} color={D.faint} width={1.6} />}
        </g>
      ))}
      <text x={48} y={90} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        no Hello
      </text>
      <text x={139} y={90} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        heard them
      </text>
      <text x={230} y={90} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        they hear me
      </text>
      <text x={366} y={90} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        master/slave, then DBD headers
      </text>
      <text x={503} y={90} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        LSR / LSU
      </text>
      <text x={594} y={90} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        in sync
      </text>
      <text x={320} y={130} textAnchor="middle" fill={D.muted} fontSize={10}>
        on broadcast networks, DROTHER-to-DROTHER neighbors stop at 2-WAY (by design, not a fault)
      </text>
    </DiagramSvg>
  );
}

function DrDiagram() {
  return (
    <DiagramSvg h={200} label="On a broadcast segment, routers become fully adjacent only with the DR and BDR">
      <line x1={80} y1={100} x2={560} y2={100} stroke={D.eth} strokeWidth={4} />
      <text x={320} y={92} textAnchor="middle" fill={D.eth} fontSize={10}>
        shared Ethernet segment
      </text>
      {[
        [120, "DR", D.success],
        [250, "BDR", D.ospf],
        [390, "DROTHER", D.faint],
        [520, "DROTHER", D.faint],
      ].map(([x, l, c]) => (
        <g key={String(x)}>
          <DLink x1={Number(x)} y1={100} x2={Number(x)} y2={140} color={D.eth} />
          <DNode x={Number(x)} y={160} label={String(l)} accent={String(c)} w={96} />
        </g>
      ))}
      <text x={320} y={40} textAnchor="middle" fill={D.text} fontSize={11}>
        DROTHERs send updates to 224.0.0.6 (DR/BDR); the DR re-floods to 224.0.0.5 (all)
      </text>
      <text x={320} y={58} textAnchor="middle" fill={D.muted} fontSize={10}>
        FULL only with DR/BDR · 2-WAY between DROTHERs
      </text>
    </DiagramSvg>
  );
}

function PipelineDiagram() {
  const stages: [string, string][] = [
    ["Hello", D.ospf],
    ["Adjacency", D.violet],
    ["LSDB sync", D.violet],
    ["Flooding", D.ospf],
    ["SPF", D.success],
    ["RIB → FIB", D.ip],
  ];
  return (
    <DiagramSvg h={110} label="OSPF pipeline from Hello to forwarding table">
      {stages.map(([s, c], i) => (
        <g key={s}>
          <DPill x={60 + i * 104} y={50} text={s} color={c} w={92} />
          {i < stages.length - 1 && <DArrow x1={107 + i * 104} y1={50} x2={116 + i * 104} y2={50} color={D.faint} width={1.6} />}
        </g>
      ))}
      <text x={320} y={92} textAnchor="middle" fill={D.muted} fontSize={10}>
        control plane on the left · forwarding state on the right
      </text>
    </DiagramSvg>
  );
}

/** What healthy OSPF looks like, read from the routers — the state every later section refers to. */
function NormalState() {
  const rib = cli(WARM, "R1", "cisco", "show ip route ospf");
  const db = cli(WARM, "R1", "cisco", "show ip ospf database");
  return (
    <div className="space-y-5">
      <p>
        Before anything breaks, learn what healthy OSPF looks like. This is the lab&apos;s diamond with a LAN behind every router (192.168.1–4.0/24), fully converged. Below are the verification questions, asked on the real routers, with the three tables in the answers. Every output is exactly what the OSPF Lab prints, and in the five faults below you will compare broken output with it.
      </p>
      <div className="space-y-2">
        <h4 className="text-sm font-bold text-pv-text">1 · Who are my neighbors, and are they FULL?</h4>
        <CliPair cisco={cli(WARM, "R1", "cisco", "show ip ospf neighbor")} junos={cli(WARM, "R1", "juniper", "show ospf neighbor")} ciscoCaption="R1 · Cisco IOS" junosCaption="R1 · Junos" />
        <p className="text-sm text-pv-text-muted">
          R1 has two neighbors, R2 (2.2.2.2) and R3 (3.3.3.3), both <Mono>FULL</Mono>: Hellos are accepted both ways and the databases are synchronized. The <Mono>-</Mono> after FULL (Cisco) means no DR/BDR, as on every point-to-point link. The dead timer counts down from 40 s and is reset by every Hello.
        </p>
      </div>
      <div className="space-y-2">
        <h4 className="text-sm font-bold text-pv-text">2 · Does every router hold the same map?</h4>
        <CliPanel run={{ ...db, output: pickLines(db.output, /Router with ID|Router Link States|^Link ID|^\d+\.\d+\.\d+\.\d+ /) }} />
        <p className="text-sm text-pv-text-muted">
          Four Router-LSAs, one per router, with the same sequence numbers on every router: one shared map. Each LSA has 6 links: 2 point-to-point links to its neighbors, a stub network for each of those two link subnets, its LAN and its loopback. <Mono>show ip ospf database router 4.4.4.4</Mono> (Junos <Mono>show ospf database router advertising-router 4.4.4.4 extensive</Mono>) lists them one by one.
        </p>
      </div>
      <div className="space-y-2">
        <h4 className="text-sm font-bold text-pv-text">3 · Which path did SPF choose to every network?</h4>
        <CliPanel run={{ ...rib, output: pickLines(rib.output, /^O|^ {20,}\[/) }} />
        <CliPanel run={cli(WARM, "R1", "juniper", "show route 192.168.4.10")} />
        <p className="text-sm text-pv-text-muted">
          R1 reaches 192.168.4.0/24 via R2 with metric 21: 10 (R1→R2) + 10 (R2→R4) + 1 (R4&apos;s LAN interface). The path via R3 would cost 20 + 5 + 1 = 26. The metric adds the cost of every <strong>outgoing</strong> interface on the way. 10.0.34.0/30 has two next hops: both paths cost 25, so OSPF keeps both (ECMP). <Mono>[110/21]</Mono> is the administrative distance (OSPF 110; Junos shows it as preference <Mono>OSPF/10</Mono>) and the metric.
        </p>
      </div>
      <div className="space-y-2">
        <h4 className="text-sm font-bold text-pv-text">4 · What does each interface contribute?</h4>
        <CliPair cisco={cli(WARM, "R1", "cisco", "show ip ospf interface brief")} junos={cli(WARM, "R1", "juniper", "show ospf interface")} ciscoCaption="R1 · Cisco IOS" junosCaption="R1 · Junos" />
        <p className="text-sm text-pv-text-muted">
          Every interface is in Area 0. The two links carry the design costs (10 toward R2, 20 toward R3). The LAN (Gi0/0 · ge-0/0/0) and the loopback are in OSPF so their networks are advertised, but they are passive: no Hellos are sent there, so no neighbor forms (<Mono>0/0</Mono>).
        </p>
      </div>
      <Callout tone="success" title="And the traffic proves it" icon="✓">
        A traceroute from H1 to H4 shows 192.168.1.1 → 10.0.12.2 (R2) → 10.0.24.2 (R4) → H4: the path SPF chose. Unplug R1–R2 and trace again: within a second the path is R1 → R3 → R4, because a link that goes down drops the neighbor at once.
      </Callout>
    </div>
  );
}

/** The five faults the lab can break, each walked from normal state to proof. */
function FaultWalks() {
  const area = ticketState("area");
  const mtu = ticketState("mtu");
  const lan = ticketState("lan");
  const cost = ticketState("cost");
  const stat = ticketState("static");
  const aLog = cli(area, "R1", "cisco", "show logging");
  const lDb = cli(lan, "R1", "cisco", "show ip ospf database router 4.4.4.4");
  const mtuR4 = cli(mtu, "R4", "juniper", "show ospf interface ge-0/0/1 detail");
  const mtuR2 = cli(mtu, "R2", "cisco", "show ip interface Gi0/2");
  return (
    <div className="space-y-4">
      <p>These are the five faults of the lab&apos;s tickets. Each one starts from the healthy evidence above and changes one thing. Read the evidence first and compare it with the healthy output, because the difference is the clue. Walk the chain every time: neighbor → LSA → SPF → routing table. Then see how the investigation questions lead to the cause, how to repair it on both vendors, and what proves the repair.</p>
      <FailureWalk
        title="1 · An area mismatch on one link"
        normal={<>R1 and R2 are FULL on 10.0.12.0/30, both interfaces in Area 0.</>}
        change={<>R2&apos;s interface toward R1 is moved into Area 1. Every Hello carries the sending interface&apos;s area, so each router now discards the other&apos;s Hellos.</>}
        evidence={
          <>
            <p>H1 → H4 takes the long way through R3, and the R1–R2 link is up and clean. R2 has disappeared from R1&apos;s neighbors, and both routers log every rejected Hello. The wording tells you which side is which: the side outside the backbone says it heard an Area 0 Hello.</p>
            <CliPanel run={cli(area, "R1", "cisco", "show ip ospf neighbor")} />
            <CliPanel run={aLog} />
            <CliPanel run={cli(area, "R2", "juniper", "show ospf interface")} note={<>ge-0/0/1.0 is in area 0.0.0.1, with no neighbor.</>} />
            <DiagramFrame caption="The Hello carries the sending interface's Area ID. A mismatch means the Hello is discarded before any neighbor state is created.">
              <AreaMismatchDiagram />
            </DiagramFrame>
          </>
        }
        next={<>A neighbor missing on an up link: compare what both ends put in their Hellos (area, hello and dead intervals) and check that neither end is passive: <Mono>show ip ospf interface</Mono> · <Mono>show ospf interface detail</Mono> on both routers.</>}
        fix={<>On R2: Cisco <Mono>interface Gi0/1</Mono>, <Mono>ip ospf 1 area 0</Mono> · Junos <Mono>delete protocols ospf area 0.0.0.1 interface ge-0/0/1</Mono>, <Mono>set protocols ospf area 0.0.0.0 interface ge-0/0/1</Mono>, then <Mono>commit</Mono>.</>}
        proof={<>The adjacency goes through INIT, 2-WAY, EXSTART, EXCHANGE and LOADING to FULL, and the traceroute goes via R2 again.</>}
      />
      <FailureWalk
        title="2 · An MTU mismatch: neighbors stuck in EXSTART"
        normal={<>R2 and R4 are FULL on 10.0.24.0/30, both interfaces with MTU 1500.</>}
        change={<>After the provider changes the circuit, R4&apos;s interface is set to MTU 1400. Hellos don&apos;t carry the MTU, so they are still accepted. The database description packets do carry it, and each router refuses DBDs whose MTU is larger than its own.</>}
        evidence={
          <>
            <p>H1 → H4 detours through R3, although the circuit tests clean. Unlike an area mismatch, R2 and R4 <em>do</em> see each other, but the neighbor never gets past <Mono>EXSTART</Mono>:</p>
            <CliPanel run={cli(mtu, "R2", "cisco", "show ip ospf neighbor")} />
            <CliPanel run={{ ...mtuR4, output: pickLines(mtuR4.output, /Interface|ge-0|MTU/) }} />
            <CliPanel run={{ ...mtuR2, output: pickLines(mtuR2.output, /is up|MTU/) }} />
          </>
        }
        next={<>A neighbor stuck in EXSTART or EXCHANGE: compare the IP MTU at both ends. Junos shows it in <Mono>show ospf interface detail</Mono>. Cisco&apos;s <Mono>show ip ospf interface</Mono> doesn&apos;t, so use <Mono>show ip interface</Mono>.</>}
        fix={<>The same MTU at both ends. On R4: Cisco <Mono>interface Gi0/1</Mono>, <Mono>no ip mtu</Mono> · Junos <Mono>delete interfaces ge-0/0/1 unit 0 family inet mtu</Mono>, then <Mono>commit</Mono>.</>}
        proof={<>The neighbor reaches FULL and the traceroute goes via R2 again.</>}
      />
      <FailureWalk
        title="3 · A LAN that isn't advertised"
        normal={<>R4&apos;s Router-LSA lists 192.168.4.0/24 as a stub network, so every router has a route to it.</>}
        change={<>When R4&apos;s configuration is rebuilt, its LAN interface (Gi0/0 · ge-0/0/0) is left out of OSPF. Its neighbors are unaffected.</>}
        evidence={
          <>
            <p>Nobody reaches H4 or anything on 192.168.4.0/24, yet R4 itself answers and every neighbor is FULL. R1 has no route at all, and R4&apos;s LSA no longer lists the LAN:</p>
            <CliPanel run={cli(lan, "R1", "cisco", "show ip route 192.168.4.10")} />
            <CliPanel run={{ ...lDb, output: pickLines(lDb.output, /Number of Links|Network\/subnet number/) }} note={<>Three stub networks (the two links and the loopback), and no 192.168.4.0.</>} />
          </>
        }
        next={<>Everything FULL but one network missing everywhere: look in the database, not at the neighbors. Is the network a stub in its router&apos;s LSA? Is that interface in OSPF on its router (<Mono>show ip ospf interface brief</Mono> · <Mono>show ospf interface</Mono>)?</>}
        fix={<>The LAN interface back in OSPF, passive. On R4: Cisco <Mono>interface Gi0/0</Mono>, <Mono>ip ospf 1 area 0</Mono> · Junos <Mono>set protocols ospf area 0.0.0.0 interface ge-0/0/0 passive</Mono>, then <Mono>commit</Mono>.</>}
        proof={<>R4&apos;s LSA lists 192.168.4.0 again and H1 reaches H4.</>}
      />
      <FailureWalk
        title="4 · A changed cost moves the path"
        normal={<>R1&apos;s cost toward R2 is 10, so H1 → H4 goes R1 → R2 → R4 with metric 21.</>}
        change={<>During maintenance, R1&apos;s interface cost toward R2 is set to 100. Every neighbor stays FULL: only one number in R1&apos;s LSA changed.</>}
        evidence={
          <>
            <p>H1 → H4 is slower, and all neighbors are FULL. R1&apos;s cost toward R2 is 100, and SPF now prefers R3 (20 + 5 + 1 = 26 beats 100 + 10 + 1 = 111):</p>
            <CliPanel run={cli(cost, "R1", "cisco", "show ip ospf interface brief")} />
            <CliPanel run={cli(cost, "R1", "cisco", "show ip route 192.168.4.10")} />
          </>
        }
        next={<>Everything FULL but a longer path: compare the costs with the design, per direction. The cost counts on the interface traffic <strong>leaves</strong> through, so check every router on the path, and remember the way back is the other routers&apos; choice.</>}
        fix={<>On R1, the cost toward R2 back to 10: Cisco <Mono>interface Gi0/1</Mono>, <Mono>ip ospf cost 10</Mono> · Junos <Mono>set protocols ospf area 0.0.0.0 interface ge-0/0/1 metric 10</Mono>, then <Mono>commit</Mono>.</>}
        proof={<>Metric 21 via R2, and the traceroute goes R1 → R2 → R4.</>}
      />
      <FailureWalk
        title="5 · A leftover static route overrides OSPF"
        normal={<>R1 reaches 192.168.4.0/24 through OSPF, and OSPF reroutes around any single failure.</>}
        change={<>A static route for 192.168.4.0/24 via R3 (10.0.13.2) was left on R1 from a migration. Distance 1 (Junos preference 5) beats OSPF&apos;s 110 (Junos 10), so R1 uses it whatever OSPF computes.</>}
        evidence={
          <>
            <p>When R3–R4 fails, H1 loses floor 4 completely, although R1–R2–R4 is fine. OSPF has the right route. Junos shows it, inactive, under the static one:</p>
            <CliPanel run={cli(stat, "R1", "cisco", "show ip route 192.168.4.10")} />
            <CliPanel run={cli(stat, "R1", "juniper", "show route 192.168.4.10")} />
          </>
        }
        next={<>OSPF has the route, but the router doesn&apos;t use it: read <Mono>show ip route &lt;ip&gt;</Mono> · <Mono>show route &lt;ip&gt;</Mono>. &quot;Known via static&quot; or an active <Mono>[Static/5]</Mono> means OSPF lost the comparison of administrative distance. Static routes never react to a failure further down the path.</>}
        fix={<>On R1, remove the static route: Cisco <Mono>no ip route 192.168.4.0 255.255.255.0 10.0.13.2</Mono> · Junos <Mono>delete routing-options static route 192.168.4.0/24</Mono>, then <Mono>commit</Mono>.</>}
        proof={<>OSPF&apos;s route is active, and with R3–R4 down H1 reaches H4 via R2.</>}
      />
    </div>
  );
}

function LabBridge() {
  const openLab = usePracticeLabOpener();
  return (
    <PracticeBridge label="Open the OSPF Lab" onPractice={openLab}>
      Same diamond, your own copy. Nothing you do there changes your lesson progress.
    </PracticeBridge>
  );
}

const G = { foundation: "Foundation", nbr: "Neighbors", map: "One shared map", path: "Path calculation", change: "Change", ops: "Operations", trouble: "Troubleshooting", beyond: "Beyond this lesson", master: "Master it" };

export const OSPF_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "od-why", label: "Why OSPF exists", group: G.foundation },
  { id: "od-network", label: "The diamond you will study", group: G.foundation },
  { id: "od-rid", label: "The Router ID", group: G.foundation },
  { id: "od-packets", label: "The five packet types", group: G.nbr },
  { id: "od-hello", label: "Hellos and what must match", group: G.nbr },
  { id: "od-fsm", label: "From DOWN to FULL", group: G.nbr },
  { id: "od-nettypes", label: "Point-to-point vs broadcast", group: G.nbr },
  { id: "od-lsas", label: "LSAs: describing the network", group: G.map },
  { id: "od-flood", label: "Reliable flooding", group: G.map },
  { id: "od-spf", label: "SPF on the diamond", group: G.path },
  { id: "od-cost", label: "Cost", group: G.path },
  { id: "od-ecmp", label: "Equal-cost paths", group: G.path },
  { id: "od-rib", label: "From SPF to the routing table", group: G.path },
  { id: "od-converge", label: "Cost changes and failures", group: G.change },
  { id: "od-state", label: "The three tables", group: G.ops },
  { id: "od-verify", label: "How to verify: walk the chain", group: G.ops },
  { id: "od-normal", label: "What healthy looks like", group: G.ops },
  { id: "od-signatures", label: "Failure signatures", group: G.trouble },
  { id: "od-stuck", label: "Where a neighbor gets stuck", group: G.trouble },
  { id: "od-workflow", label: "Investigation workflow", group: G.trouble },
  { id: "od-faults", label: "Five faults, evidence to proof", group: G.trouble },
  { id: "od-prove", label: "Prove the repair", group: G.trouble },
  { id: "od-areas", label: "Areas and the backbone", group: G.beyond },
  { id: "od-myths", label: "Common misconceptions", group: G.master },
  { id: "od-quiz", label: "Knowledge check", group: G.master },
  { id: "od-explain", label: "Can you explain it?", group: G.master },
  { id: "od-practice", label: "Practice in the OSPF Lab", group: G.master },
];

const QUIZ: KnowledgeQuestion[] = [
  {
    id: "q-2way",
    prompt: "R2 receives R1's first Hello, which lists no neighbors. What state does R2 put R1 in?",
    options: [
      { id: "a", label: "FULL" },
      { id: "b", label: "INIT" },
      { id: "c", label: "2-WAY" },
      { id: "d", label: "EXSTART" },
    ],
    correctId: "b",
    explanation: "R2 hears R1, but R1 hasn't shown that it hears R2. Only when a router sees its own Router ID in the neighbor's Hello is two-way communication proven: 2-WAY.",
  },
  {
    id: "q-mtu",
    prompt: "R2 and R4 see each other but stay stuck in EXSTART. What is the classic cause?",
    options: [
      { id: "a", label: "An area mismatch" },
      { id: "b", label: "Different hello intervals" },
      { id: "c", label: "An MTU mismatch" },
      { id: "d", label: "A passive interface" },
    ],
    correctId: "c",
    explanation: "Area, timers and passive interfaces stop Hellos, so the neighbor never appears. The MTU is checked later, in the database description packets: the neighbor appears and gets stuck in EXSTART/EXCHANGE.",
  },
  {
    id: "q-spf",
    prompt: "R1 → R2 → R4 costs 10 + 10 and R1 → R3 → R4 costs 20 + 5. Which path does R1 install to R4?",
    options: [
      { id: "a", label: "Via R2 (20)" },
      { id: "b", label: "Via R3 (25)" },
      { id: "c", label: "Both, as ECMP" },
      { id: "d", label: "The one with fewer hops" },
    ],
    correctId: "a",
    explanation: "SPF adds the outgoing interface costs from R1's own position: 20 beats 25. Hop count plays no role; only equal totals would give two next hops.",
  },
  {
    id: "q-lsdb",
    prompt: "R4 has no link to R1. How does R4 learn R1's networks?",
    options: [
      { id: "a", label: "R2 and R3 summarize them" },
      { id: "b", label: "R1's Router-LSA is flooded through R2 and R3, unchanged" },
      { id: "c", label: "R4 sends an LSR directly to R1" },
      { id: "d", label: "It doesn't: R4 uses a default route" },
    ],
    correctId: "b",
    explanation: "Every router passes on every newer LSA it receives. R1's LSA reaches R4 through both neighbors, so all four routers hold the same database.",
  },
  {
    id: "q-static",
    prompt: "R1 has OSPF route O [110/21] to 192.168.4.0/24 and someone adds a static route to the same prefix. Which one is used?",
    options: [
      { id: "a", label: "OSPF, because it has a metric" },
      { id: "b", label: "The static route, because its administrative distance (1) is lower than OSPF's (110)" },
      { id: "c", label: "Both, as ECMP" },
      { id: "d", label: "The newer one" },
    ],
    correctId: "b",
    explanation: "For the same prefix length the router trusts the source with the lowest administrative distance (Junos preference 5 vs 10). A leftover static route silently overrides OSPF.",
  },
  {
    id: "q-dead",
    prompt: "A link fails silently: it stays up but drops every packet. With default timers, when does OSPF react?",
    options: [
      { id: "a", label: "Immediately" },
      { id: "b", label: "After 10 seconds" },
      { id: "c", label: "After the 40-second dead interval" },
      { id: "d", label: "Never" },
    ],
    correctId: "c",
    explanation: "A link that goes down is noticed at once. A silent failure is only noticed when no Hello has arrived for the dead interval, 40 s by default (BFD can shorten this).",
  },
];

export function OspfDeepDiveContent() {
  return (
    <>
      <GuideSection id="od-why" eyebrow="Foundation" title="Why OSPF exists" tone="ospf">
        <p>
          In the Routing lesson every route was typed by hand. Four routers and four LANs already mean twelve static routes, and a static route never changes by itself: when a link fails, traffic keeps going into it until someone edits every router. <b className="text-pv-text">OSPF</b> (Open Shortest Path First) is an interior gateway protocol that replaces that work: routers find their neighbors, share one map of the network, and each computes its own best paths, again whenever something changes.
        </p>
        <DiagramFrame caption="Every OSPF behavior fits somewhere in this pipeline.">
          <PipelineDiagram />
        </DiagramFrame>
        <CompareCards
          items={[
            { title: "Link-state (OSPF, IS-IS)", tone: "cyan", tag: "map", points: ["Every router knows the whole area topology", "Each computes its own shortest-path tree", "Fast, loop-free convergence"] },
            { title: "Distance-vector (RIP)", tone: "violet", tag: "rumor", points: ["Routers only know neighbors' distances", "Routes learned second-hand", "Slower convergence, loop-prevention workarounds"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="od-network" eyebrow="Foundation" title="The diamond you will study" tone="cyan">
        <p>Everything below is taught on the lesson&apos;s network: four routers in a diamond, all in Area 0, every link point-to-point, a LAN behind every router (192.168.1.0/24 behind R1 up to 192.168.4.0/24 behind R4).</p>
        <DiagramFrame caption="Router IDs 1.1.1.1 – 4.4.4.4, all interfaces in Area 0. The numbers are each link's cost.">
          <Diamond />
        </DiagramFrame>
        <FieldTable
          title="Point-to-point links"
          accent="ospf"
          columns={["Link", "Addresses", "Cost (outbound, both ends)"]}
          rows={[
            ["R1 ↔ R2", <Mono key="a">10.0.12.1 / 10.0.12.2</Mono>, "10"],
            ["R1 ↔ R3", <Mono key="b">10.0.13.1 / 10.0.13.2</Mono>, "20"],
            ["R2 ↔ R4", <Mono key="c">10.0.24.1 / 10.0.24.2</Mono>, "10"],
            ["R3 ↔ R4", <Mono key="d">10.0.34.1 / 10.0.34.2</Mono>, "5"],
          ]}
        />
        <Callout tone="cyan" title="What is simulated" icon="i">
          The guided lesson and the lab model a single area, point-to-point links and Router-LSAs. DR/BDR, other LSA types and multiple areas are explained below but not simulated.
        </Callout>
      </GuideSection>

      <GuideSection id="od-rid" eyebrow="Foundation" title="The Router ID" tone="cyan">
        <p>
          Each OSPF router has a 32-bit <b className="text-pv-text">Router ID</b> written like an IPv4 address (here 1.1.1.1 to 4.4.4.4). It names the router in every packet and LSA, breaks ties such as who leads a database exchange, and must be unique in the domain. Configure it explicitly (Cisco <Mono>router-id 1.1.1.1</Mono> · Junos <Mono>set routing-options router-id 1.1.1.1</Mono>); otherwise the router picks one from its interface addresses, and it changes when they do.
        </p>
      </GuideSection>

      <GuideSection id="od-packets" eyebrow="Neighbors" title="The five OSPF packet types" tone="violet">
        <p>OSPF runs directly over IP as <b className="text-pv-text">protocol 89</b> (no TCP or UDP), usually multicast to <Mono>224.0.0.5</Mono> (all OSPF routers) or <Mono>224.0.0.6</Mono> (DR/BDR), with TTL 1: it only ever talks to directly connected neighbors.</p>
        <FieldTable
          title="Packet types"
          accent="ospf"
          columns={["Type", "Name", "Purpose"]}
          rows={[
            ["1", "Hello", "Discover neighbors, check parameters, keepalive"],
            ["2", "DBD (Database Description)", "Summarize the LSDB with LSA headers"],
            ["3", "LSR (Link State Request)", "Ask for specific LSAs that are missing or outdated"],
            ["4", "LSU (Link State Update)", "Carry full LSAs, for sync and for flooding"],
            ["5", "LSAck", "Acknowledge received LSAs (reliable flooding)"],
          ]}
        />
        <Callout tone="warning" title="Don't mix them up" icon="!">
          Packet types (1–5) are how routers talk. <b>LSA types</b> (1, 2, 3, 4, 5, 7…) are what they talk about, carried inside LSUs.
        </Callout>
      </GuideSection>

      <GuideSection id="od-hello" eyebrow="Neighbors" title="Hellos, and what must match" tone="ospf">
        <p>
          Every 10 s each OSPF interface sends a Hello with its Router ID, area, hello and dead intervals, and the neighbors it already hears. When a router sees its own ID in a neighbor&apos;s Hello, two-way communication is proven: <b className="text-pv-text">2-WAY</b>.
        </p>
        <DiagramFrame caption="The neighbor list inside the Hello is what proves two-way communication.">
          <HelloDiagram />
        </DiagramFrame>
        <ChecklistCard
          tone="cyan"
          mark="="
          title="Must match, or the Hello is discarded"
          items={[
            "Area ID (the fault in the guided lesson)",
            "Hello and dead intervals (10 s / 40 s by default on point-to-point and broadcast)",
            "Subnet and mask, on broadcast networks",
            "Authentication type and key",
            "Area type flags (stub / NSSA)",
            "Neither end passive, and both interfaces in OSPF",
          ]}
        />
        <DiagramFrame caption="An area mismatch: the Hello is discarded, no neighbor entry is created.">
          <AreaMismatchDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="od-fsm" eyebrow="Neighbors" title="From DOWN to FULL" tone="violet">
        <p>
          On a point-to-point link every 2-WAY neighbor goes on to become fully adjacent. In <b className="text-pv-text">EXSTART</b> the two routers agree who leads the exchange (the higher Router ID). In <b className="text-pv-text">EXCHANGE</b> they swap the headers of the LSAs they hold; the MTU is compared here, in the DBD packets. In <b className="text-pv-text">LOADING</b> each requests what it is missing, and then the adjacency is <b className="text-pv-text">FULL</b>.
        </p>
        <DiagramFrame caption="Each state is a checkpoint; where a neighbor gets stuck points at the cause.">
          <FsmDiagram />
        </DiagramFrame>
        <DiagramFrame caption="Headers first (DBD), then only the missing LSAs are requested (LSR), delivered (LSU) and acknowledged (LSAck).">
          <SyncDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="od-nettypes" eyebrow="Neighbors" title="Point-to-point vs broadcast" tone="cyan">
        <CompareCards
          items={[
            { title: "Point-to-point", tone: "cyan", tag: "2 routers", points: ["No DR/BDR election", "Every neighbor becomes FULL", "Typical for routed links (and this lesson)"] },
            { title: "Broadcast (e.g. Ethernet)", tone: "violet", tag: "many routers", points: ["DR and BDR elected", "FULL only with DR/BDR; other pairs stay 2-WAY", "DR originates the segment's Network-LSA (Type 2)"] },
          ]}
        />
        <p>
          With N routers on one segment, a full mesh of adjacencies would need N(N−1)/2 synchronizations. A <b className="text-pv-text">Designated Router</b> and a <b className="text-pv-text">Backup DR</b> are elected instead (highest interface priority, then highest Router ID; the election is non-preemptive), and everyone synchronizes with them. Two routers staying in 2-WAY on a broadcast segment is normal, not a fault.
        </p>
        <DiagramFrame caption="The DR acts as the segment's hub for flooding.">
          <DrDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="od-lsas" eyebrow="One shared map" title="LSAs: describing the network" tone="ospf">
        <p>Each router describes itself in one <strong>Router-LSA</strong>: its FULL neighbors with its own cost toward each, and the networks on its OSPF interfaces (its LAN, its link subnets, its loopback). A LAN interface can be in OSPF but <em>passive</em>: it is advertised, but no Hellos are sent there. Larger networks use more LSA types:</p>
        <FieldTable
          title="Common OSPFv2 LSA types"
          accent="ospf"
          columns={["Type", "Name", "Originated by", "Scope"]}
          rows={[
            ["1", "Router-LSA", "Every router: its own links and costs", "Area"],
            ["2", "Network-LSA", "The DR: routers on a broadcast segment", "Area"],
            ["3", "Summary-LSA", "ABR: prefixes from other areas", "Area"],
            ["4", "ASBR-Summary", "ABR: how to reach an ASBR", "Area"],
            ["5", "AS-External", "ASBR: redistributed external routes", "Whole domain (not stub areas)"],
            ["7", "NSSA-External", "ASBR inside an NSSA; translated to Type 5 by the ABR", "NSSA"],
          ]}
        />
      </GuideSection>

      <GuideSection id="od-flood" eyebrow="One shared map" title="Reliable flooding" tone="ospf">
        <p>
          A router that receives a newer LSA installs it, acknowledges it and passes it on. R4 has no link to R1, yet it gets R1&apos;s LSA through R2 and R3. Every LSA carries a <b className="text-pv-text">sequence number</b>: a higher number replaces an older copy, and a duplicate is acknowledged and dropped. Unacknowledged LSAs are retransmitted. The result is the <b className="text-pv-text">LSDB</b>: the same set of LSAs on every router in the area.
        </p>
        <DiagramFrame caption="Flooding is reliable: each LSU is acknowledged, and duplicates are recognised by their sequence numbers.">
          <FloodDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="od-spf" eyebrow="Path calculation" title="SPF on the diamond" tone="success">
        <p>Each router runs Dijkstra&apos;s shortest-path-first algorithm on the shared map with <em>itself</em> as the root, adding up the cost of every outgoing interface. For R1 → R4: via R2 = 10 + 10 = 20, via R3 = 20 + 5 = 25. R1 installs the path via R2. R4 computes its own tree, from its own position: the way back is R4&apos;s choice.</p>
        <DiagramFrame caption="R1 → R2 → R4 = 10 + 10 = 20 beats R1 → R3 → R4 = 20 + 5 = 25.">
          <Diamond highlight={[["R1", "R2"], ["R2", "R4"]]} note="best path: R1 → R2 → R4 (total 20)" h={260} />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="od-cost" eyebrow="Path calculation" title="Cost" tone="warning">
        <p>
          Cost is a per-interface, <b className="text-pv-text">outbound</b> metric; a path&apos;s cost is the sum of the outgoing interface costs along it. By default it is derived from bandwidth (<Mono>reference bandwidth ÷ interface bandwidth</Mono>). The classic reference of 100 Mb/s makes every link of 100 Mb/s or faster cost 1, so modern networks raise it (Cisco <Mono>auto-cost reference-bandwidth</Mono> · Junos <Mono>reference-bandwidth</Mono>) or set costs explicitly, as in this lesson (Cisco <Mono>ip ospf cost 10</Mono> · Junos <Mono>interface ge-0/0/1.0 metric 10</Mono>).
        </p>
        <Callout tone="warning" title="Asymmetry is allowed" icon="!">
          The two ends of a link can have different costs, so the forward and return paths can differ. That is normal.
        </Callout>
      </GuideSection>

      <GuideSection id="od-ecmp" eyebrow="Path calculation" title="Equal-cost paths" tone="success">
        <p>
          When two or more paths have exactly the <b className="text-pv-text">same lowest cost</b>, OSPF installs them all (equal-cost multipath, ECMP). Raise R1&apos;s cost toward R2 to 15 and both paths cost 25: R1 gets two next hops to R4. Traffic is then usually spread per flow by hashing packet headers, so a single flow stays on one path.
        </p>
      </GuideSection>

      <GuideSection id="od-rib" eyebrow="Path calculation" title="From SPF to the routing table" tone="ip">
        <p>
          SPF results become OSPF routes offered to the routing table (RIB) with administrative distance 110 (Junos preference 10). The RIB still has the last word: for each prefix it uses the longest match, then the most trusted source, and installs the winner in the forwarding table (FIB) the hardware uses per packet.
        </p>
        <FieldTable
          title="Who wins for the same prefix"
          columns={["Source", "Cisco distance", "Junos preference"]}
          rows={[
            ["Connected", "0", "0"],
            ["Static", "1", "5"],
            ["OSPF (internal)", "110", "10"],
          ]}
        />
        <p>A leftover static route for a prefix therefore wins over OSPF, whatever SPF computed.</p>
      </GuideSection>

      <GuideSection id="od-converge" eyebrow="Change" title="Cost changes and failures" tone="danger">
        <p>
          <strong>A cost change moves the path.</strong> Raise R1&apos;s cost toward R2 from 10 to 50: R1 originates a new Router-LSA with a higher sequence number, floods it, and every router reruns SPF. R1 → R2 → R4 now costs 60, while R1 → R3 → R4 still costs 25. Nothing was disabled: one number in the map changed.
        </p>
        <DiagramFrame caption="After the change: R1 → R3 → R4 (total 25) wins.">
          <Diamond costs={{ "R1-R2": "50" }} highlight={[["R1", "R3"], ["R3", "R4"]]} note="after the change: R1 → R3 → R4 (total 25) wins" h={260} />
        </DiagramFrame>
        <FlowSteps
          steps={[
            { title: "Detect", body: "The link goes down (at once), or the dead interval expires after a silent failure (40 s), or BFD reports it (sub-second).", tone: "danger" },
            { title: "Originate", body: "Affected routers issue new LSAs with higher sequence numbers.", tone: "warning" },
            { title: "Flood", body: "The new LSAs replace stale copies everywhere in the area.", tone: "ospf" },
            { title: "Recompute", body: "Each router reruns SPF (throttled by SPF timers).", tone: "success" },
            { title: "Reprogram", body: "Changed routes are updated in the RIB and FIB.", tone: "ip" },
          ]}
        />
      </GuideSection>

      <GuideSection id="od-state" eyebrow="Operations" title="The three tables" tone="cyan">
        <p>Each router keeps three tables, built in this order. Every verification and every fault is about one of them:</p>
        <FlowSteps
          steps={[
            { title: "The neighbor table", body: "Each neighbor's Router ID, its state (FULL, EXSTART, INIT…), its dead timer and the interface it is on.", tone: "violet" },
            { title: "The link-state database", body: "Every Router-LSA, with its sequence number: the map. Identical on every router of the area.", tone: "warning" },
            { title: "The routing table", body: "The best route to every prefix: OSPF routes [110/metric] via a next hop, next to connected and static routes.", tone: "success" },
          ]}
        />
        <p>A missing neighbor means a missing piece of the map, and a missing piece of the map means missing routes. That chain, neighbor → LSA → SPF → table, is how you investigate every fault.</p>
      </GuideSection>

      <GuideSection id="od-verify" eyebrow="Operations" title="How to verify: walk the chain" tone="success">
        <FlowSteps
          steps={[
            { title: "Are all neighbors FULL?", body: <>Cisco <Mono>show ip ospf neighbor</Mono> · Junos <Mono>show ospf neighbor</Mono>.</>, tone: "violet" },
            { title: "Does every interface have the right area, cost and timers?", body: <>Cisco <Mono>show ip ospf interface brief</Mono> or <Mono>show ip ospf interface Gi0/1</Mono>, MTU with <Mono>show ip interface Gi0/1</Mono> · Junos <Mono>show ospf interface</Mono> or <Mono>show ospf interface detail</Mono>.</>, tone: "cyan" },
            { title: "Is every network in the map?", body: <>Cisco <Mono>show ip ospf database</Mono>, <Mono>show ip ospf database router 4.4.4.4</Mono> · Junos <Mono>show ospf database</Mono>, <Mono>show ospf database router advertising-router 4.4.4.4 extensive</Mono>.</>, tone: "warning" },
            { title: "Does the routing table use OSPF's route?", body: <>Cisco <Mono>show ip route ospf</Mono>, <Mono>show ip route 192.168.4.10</Mono> · Junos <Mono>show route protocol ospf</Mono>, <Mono>show route 192.168.4.10</Mono>.</>, tone: "success" },
          ]}
        />
        <p>Then prove it with traffic: a traceroute along the designed path, then a link cut and a traceroute along the other path. Cisco logs adjacency changes and rejected Hellos (<Mono>show logging</Mono>).</p>
      </GuideSection>

      <GuideSection id="od-normal" eyebrow="Operations" title="What healthy OSPF looks like on the routers" tone="success">
        <NormalState />
      </GuideSection>

      <GuideSection id="od-signatures" eyebrow="Troubleshooting" title="Failure signatures: a missing piece in the chain" tone="danger">
        <p>OSPF faults reach you as &quot;traffic takes the long way&quot;, &quot;nobody reaches that floor&quot;, or &quot;a failure took everything down&quot;. Each one is a missing or wrong piece in the chain neighbor → LSA → SPF → table:</p>
        <FailureSignatures
          items={[
            { tag: "area", title: "An area or timer mismatch", tone: "danger", points: ["The neighbor is missing from show ip ospf neighbor", "Cisco logs OSPF-4-ERRRCV mismatched area ID / hello parameters", "Traffic takes another path (or none)"] },
            { tag: "mtu", title: "An MTU mismatch", tone: "warning", points: ["The neighbor is visible but stuck in EXSTART/EXCHANGE", "Hellos fine, database description refused", "Different MTUs: show ip interface (Cisco) · show ospf interface detail (Junos)"] },
            { tag: "lan", title: "A LAN that isn't advertised", tone: "violet", points: ["Everything FULL, but no router has the LAN", "Its router's LSA lists no stub network for it", "ping: Destination Net Unreachable"] },
            { tag: "static", title: "A static route that overrides OSPF", tone: "ip", points: ["show ip route: S [1/0] where you expect O [110/x]", "Works until a failure, then loops or blackholes", "Remove the static (or make it a floating static)"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="od-stuck" eyebrow="Troubleshooting" title="Where a neighbor gets stuck, and why" tone="danger">
        <FieldTable
          title="Where it gets stuck → usual cause"
          accent="danger"
          columns={["Symptom", "Usual cause"]}
          rows={[
            ["No neighbor at all", "Area ID, hello/dead, mask, authentication or stub-flag mismatch; ACL blocking protocol 89; passive interface"],
            ["Stuck in INIT", "One-way communication: the other side isn't receiving our Hellos"],
            ["2-WAY between DROTHERs", "Normal on broadcast networks, not a fault"],
            ["Stuck in EXSTART/EXCHANGE", "MTU mismatch, or duplicate Router IDs"],
            ["Stuck in LOADING", "Corrupted or unacknowledged LSAs"],
            ["FULL but route missing", "The network isn't advertised, it is filtered, or a more trusted source has a route"],
          ]}
        />
      </GuideSection>

      <GuideSection id="od-workflow" eyebrow="Troubleshooting" title="Investigation workflow: walk the chain" tone="danger">
        <TroubleshootingFlow
          steps={[
            { question: "No reply at all, or a longer path than designed?", look: "ping for reachability, traceroute for the path." },
            { question: "Are all neighbors FULL?", look: "show ip ospf neighbor / show ospf neighbor. Missing: Hellos rejected (area, timers, passive, not in OSPF). EXSTART: MTU." },
            { question: "Is the destination in every router's database?", look: "show ip ospf database router <rid>: is the LAN a stub network of its router?" },
            { question: "Are the costs as designed, per direction?", look: "show ip ospf interface brief on each router on the path; remember the way back is the other router's choice." },
            { question: "Does the routing table use OSPF's route?", look: "show ip route <ip> / show route <ip>: a static route (distance 1 / preference 5) beats OSPF." },
          ]}
        />
      </GuideSection>

      <GuideSection id="od-faults" eyebrow="Troubleshooting" title="Five faults, from evidence to proof" tone="danger">
        <FaultWalks />
      </GuideSection>

      <GuideSection id="od-prove" eyebrow="Troubleshooting" title="Prove the repair with fresh traffic" tone="success">
        <ChecklistCard
          tone="success"
          title="The proof, every time"
          mark="✓"
          items={[
            "Repeat the exact test that failed, and see it succeed",
            "Every working link has a FULL adjacency",
            "The destination is in the database, and the routing table uses OSPF's route with the designed metric",
            "A traceroute follows the designed path",
            "Cut a link on that path: the traceroute takes the other path, then restore the link",
          ]}
        />
        <p>The lab&apos;s tickets check exactly this: a ticket only closes when the routers&apos; state is right <em>and</em> a fresh run of the user&apos;s test succeeds.</p>
      </GuideSection>

      <GuideSection id="od-areas" eyebrow="Beyond this lesson" title="Areas and the Area 0 backbone" tone="ospf">
        <p>
          Large OSPF domains are split into <b className="text-pv-text">areas</b>. Full topology detail (Router- and Network-LSAs) stays inside each area; <b className="text-pv-text">Area Border Routers</b> summarize it into other areas as Type-3 LSAs. Every other area must attach to <b className="text-pv-text">Area 0</b>, the backbone, and traffic between areas crosses it. Smaller databases and SPF runs per area keep large networks stable.
        </p>
        <DiagramFrame caption="Smaller LSDBs and SPF runs per area; changes in one area don't trigger full SPF in the others.">
          <AreasDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="od-myths" eyebrow="Master it" title="Common misconceptions" tone="warning">
        <Misconceptions
          items={[
            { myth: "OSPF picks the path with the fewest hops.", correction: "It picks the lowest total of outgoing interface costs. R1 → R2 → R4 wins at 20 against 25, and a cost change can move it without changing a single hop." },
            { myth: "An MTU mismatch stops the Hellos.", correction: "Hellos still work, so the neighbor appears. It gets stuck in EXSTART/EXCHANGE, because the MTU is checked in the DBD packets." },
            { myth: "Each router learns routes from its neighbors.", correction: "Each router learns the whole map (every Router-LSA) and computes its own routes from its own position." },
            { myth: "OSPF runs over TCP or UDP.", correction: "It runs directly over IP, protocol 89, with TTL 1." },
            { myth: "If OSPF computed a route, the router uses it.", correction: "The routing table decides: a static route for the same prefix (distance 1) beats OSPF (110)." },
            { myth: "Two routers stuck in 2-WAY are always broken.", correction: "On a broadcast segment, two routers that are neither DR nor BDR stay 2-WAY by design. On point-to-point links, every neighbor should reach FULL." },
          ]}
        />
      </GuideSection>

      <GuideSection id="od-quiz" eyebrow="Master it" title="Knowledge check" tone="success">
        <KnowledgeQuiz questions={QUIZ} />
      </GuideSection>

      <GuideSection id="od-explain" eyebrow="Master it" title="Can you explain it?" tone="success">
        <ExplainIt
          items={[
            { q: "Why does an area mismatch on R1–R2 make H1 → H4 take the R3 path instead of failing?", a: "R2 discards R1's Hellos, so there is no adjacency and the R1–R2 link drops out of the map. SPF still finds R1 → R3 → R4 (25), so traffic takes the longer path." },
            { q: "Why can the way back from H4 to H1 differ from the way there?", a: "Each router computes its own tree from its own position with its own outgoing costs. R4 chooses the return path, R1 the forward one." },
            { q: "Why does setting R1's cost toward R2 to 15 give two next hops?", a: "Both paths then total 25 (15 + 10 and 20 + 5). Equal lowest totals are installed together as ECMP." },
            { q: "Why does a silent link failure take 40 seconds to fix itself, but a cut cable only an instant?", a: "A cut cable brings the interface down at once and the neighbor is dropped. A silent failure keeps the link up, so OSPF only notices when no Hello has arrived for the dead interval." },
          ]}
        />
      </GuideSection>

      <GuideSection id="od-practice" eyebrow="Practice" title="Practice in the OSPF Lab" tone="cyan">
        <ChecklistCard
          tone="cyan"
          title="In the lab you will"
          mark="→"
          items={[
            "Read a Hello and watch an LSA flood, router by router",
            "Send H1 → H4 through R3 by cost alone, and make R1 load-share",
            "Lose a link without losing H4, and measure the dead interval",
            "Solve five tickets from evidence, on Cisco IOS or Junos, and prove each repair",
          ]}
        />
        <PresentationBridge>See Hellos, an LSA flood, SPF choosing a path and a static route winning in the OSPF presentation.</PresentationBridge>
        <LabBridge />
      </GuideSection>
    </>
  );
}
