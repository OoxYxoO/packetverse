import { Callout, CompareCards, DArrow, DIAGRAM as D, DiagramFrame, DiagramSvg, DLink, DNode, DPill, DRegion, FailureSignatures, FieldTable, FlowSteps, GuideSection, Misconceptions, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { DFieldRow, DTable } from "@/components/lesson/FundamentalsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { ExplainIt, KnowledgeQuiz, PracticeBridge, type KnowledgeQuestion } from "@/components/lesson/GuideInteractive";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import { PresentationBridge } from "@/components/presentation/LessonPresentation";
import { CliPair, CliPanel, FailureWalk, pickLines, runGuideCli } from "@/components/lesson/GuideCli";
import type { CliVendor } from "@/lib/cli/types";
import { ALL_ISS, LSP_LIFETIME } from "@/lib/sim-engine/scenarios/isisFundamentals";
import { createIsNet, isApply, isTicket, isTicketState, type IsAction, type IsR, type IsState, type IsTicketId } from "@/lib/sim-engine/scenarios/isisNet";
import { isSets, isStaticApi } from "./isis-lab/isCli";
import { IsisChain } from "./guideSvg";
import { ThreeWayDiagram } from "./LessonGuideContent";

const G = { foundation: "Foundation", nbr: "Neighbors", levels: "Levels and areas", map: "One map", path: "Paths", ops: "Operations", trouble: "Troubleshooting", beyond: "Beyond this lesson", master: "Master it" };
export const ISIS_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "isd-why", label: "Why a provider core runs IS-IS", group: G.foundation },
  { id: "isd-integrated", label: "Integrated IS-IS", group: G.foundation },
  { id: "isd-nsap", label: "NSAP and NET", group: G.foundation },
  { id: "isd-network", label: "The core you will study", group: G.foundation },
  { id: "isd-pdus", label: "The PDU types", group: G.nbr },
  { id: "isd-hello", label: "What a hello must agree on", group: G.nbr },
  { id: "isd-3way", label: "The three-way handshake", group: G.nbr },
  { id: "isd-padding", label: "MTU and hello padding", group: G.nbr },
  { id: "isd-auth", label: "Hello authentication", group: G.nbr },
  { id: "isd-dis", label: "Point-to-point vs broadcast", group: G.nbr },
  { id: "isd-levels", label: "Level 1, Level 2, Level-1-2", group: G.levels },
  { id: "isd-leak", label: "Route leaking", group: G.levels },
  { id: "isd-lsp", label: "What an LSP carries", group: G.map },
  { id: "isd-lifecycle", label: "Sequence, lifetime, purge", group: G.map },
  { id: "isd-flood", label: "Reliable flooding", group: G.map },
  { id: "isd-spf", label: "SPF and the two-way check", group: G.path },
  { id: "isd-rib", label: "From SPF to the routing table", group: G.path },
  { id: "isd-metric", label: "Metrics: outgoing, per direction", group: G.path },
  { id: "isd-overload", label: "The overload bit", group: G.path },
  { id: "isd-config", label: "Configuring it: IOS XR and Junos", group: G.ops },
  { id: "isd-verify", label: "How to verify: walk the chain", group: G.ops },
  { id: "isd-normal", label: "What healthy looks like", group: G.ops },
  { id: "isd-signatures", label: "Failure signatures", group: G.trouble },
  { id: "isd-workflow", label: "Investigation workflow", group: G.trouble },
  { id: "isd-tickets", label: "Five faults, evidence to proof", group: G.trouble },
  { id: "isd-prove", label: "Prove the repair", group: G.trouble },
  { id: "isd-beyond", label: "Where IS-IS goes next", group: G.beyond },
  { id: "isd-myths", label: "Common misconceptions", group: G.master },
  { id: "isd-quiz", label: "Knowledge check", group: G.master },
  { id: "isd-explain", label: "Can you explain it?", group: G.master },
  { id: "isd-practice", label: "Practice in the IS-IS Lab", group: G.master },
];

// Real CLI output: the IS-IS Lab's own command sets run against the lab's model (the six-router core).
const cli = (s: IsState, r: IsR, vendor: CliVendor, command: string) => runGuideCli(isSets(isStaticApi(s, r), r)[vendor], command);
const only = (s: IsState, r: IsR, vendor: CliVendor, command: string, match: RegExp, keep = 0) => {
  const x = cli(s, r, vendor, command);
  return { ...x, output: pickLines(x.output, match, keep) };
};
const apply = (s: IsState, as: IsAction[]) => as.reduce((acc, a) => isApply(acc, a), s);
const WARM = createIsNet();
/** A ticket's network after its test ran: what the student investigates. */
const ticketState = (id: IsTicketId) => apply(isTicketState(id, 1), isTicket(id).repro);
const T = { level: ticketState("level"), loopback: ticketState("loopback"), mtu: ticketState("mtu"), overload: ticketState("overload"), metric: ticketState("metric") };

function LabCore() {
  return (
    <DiagramSvg h={230} label="The lab core: PE1 to P1 and P3, P1 to P2, P3 to P4, P2 and P4 to PE2, a P1 to P3 rung without IS-IS; every metric 10">
      <DLink x1={80} y1={115} x2={230} y2={40} label="10" />
      <DLink x1={230} y1={40} x2={410} y2={40} label="10" />
      <DLink x1={410} y1={40} x2={560} y2={115} label="10" />
      <DLink x1={80} y1={115} x2={230} y2={190} label="10" labelDy={16} />
      <DLink x1={230} y1={190} x2={410} y2={190} label="10" labelDy={16} />
      <DLink x1={410} y1={190} x2={560} y2={115} label="10" labelDy={16} />
      <DLink x1={230} y1={62} x2={230} y2={168} dashed label="rung · no IS-IS" />
      <DNode x={80} y={115} label="PE1" sub="10.0.0.1" accent={D.success} w={84} />
      <DNode x={230} y={40} label="P1" sub="10.0.0.2" w={84} />
      <DNode x={410} y={40} label="P2" sub="10.0.0.3" w={84} />
      <DNode x={560} y={115} label="PE2" sub="10.0.0.4" accent={D.success} w={84} />
      <DNode x={230} y={190} label="P3" sub="10.0.0.5" w={84} />
      <DNode x={410} y={190} label="P4" sub="10.0.0.6" w={84} />
    </DiagramSvg>
  );
}

function LabBridge() {
  const openLab = usePracticeLabOpener();
  return (
    <PracticeBridge label="Open the IS-IS Lab" onPractice={openLab}>
      The six-router core from this page, your own copy. Nothing you do there changes your lesson progress.
    </PracticeBridge>
  );
}

function IntegratedDiagram() {
  const f = (label: string, sub: string, w: number, color: string, strong?: boolean) => ({ label, sub, w, color, strong });
  return (
    <DiagramSvg h={170} label="Integrated IS-IS: a CLNS protocol, discriminator 0x83, carrying IPv4 and IPv6 reachability in TLVs">
      <DFieldRow x={40} y={14} fields={[f("Data link", "802.3 / PPP / HDLC", 150, D.eth), f("LLC / NLPID", "FE FE 03 · 0x83", 150, D.violet, true), f("IS-IS PDU", "hello · LSP · SNP", 140, D.cyan), f("TLVs", "IPv4 · IPv6 · …", 120, D.warning, true)]} />
      <text x={320} y={92} textAnchor="middle" fill={D.text} fontSize={10.5} fontWeight={700}>
        ISO 10589 defined IS-IS for CLNP; RFC 1195 added IP (Integrated / Dual IS-IS)
      </text>
      <text x={320} y={112} textAnchor="middle" fill={D.muted} fontSize={10}>
        IP is just another set of TLVs — adding IPv6 (RFC 5308) or segment routing needs no new transport.
      </text>
      <text x={320} y={132} textAnchor="middle" fill={D.muted} fontSize={10}>
        Not reachable by IP → hard to attack from outside, and runs before any IP route exists.
      </text>
    </DiagramSvg>
  );
}

function NsapDiagram() {
  const f = (label: string, sub: string, w: number, color: string, strong?: boolean) => ({ label, sub, w, color, strong });
  return (
    <DiagramSvg h={170} label="NSAP structure: AFI, area, System ID, NSEL; the NET is the NSAP with NSEL 00">
      <DFieldRow x={40} y={14} fields={[f("AFI", "49 (private)", 90, D.violet), f("Rest of Area ID", "0001 (1–12 bytes)", 170, D.violet), f("System ID", "6 bytes", 190, D.cyan, true), f("NSEL", "1 byte", 110, D.faint)]} />
      <text x={40} y={84} fill={D.violet} fontSize={10}>
        ◄──── Area address (variable) ────►
      </text>
      <text x={320} y={112} textAnchor="middle" fill={D.text} fontSize={10.5} fontWeight={700}>
        NET = NSAP with NSEL 00 · 49.0001.0000.0000.0001.00
      </text>
      <text x={320} y={132} textAnchor="middle" fill={D.muted} fontSize={10}>
        Common practice: derive the System ID from the loopback, e.g. 10.0.0.1 → 0100.0000.0001 (010.000.000.001).
      </text>
      <text x={320} y={150} textAnchor="middle" fill={D.muted} fontSize={10}>
        Up to three area addresses per router during renumbering / area merge.
      </text>
    </DiagramSvg>
  );
}

function LevelsDiagram() {
  return (
    <DiagramSvg h={230} label="Level-1 areas connect through Level-1-2 routers to the Level-2 backbone; L1 routers use the ATT bit for a default route">
      <DRegion x={20} y={24} w={190} h={150} label="Area 49.0001 (L1)" color={D.success} />
      <DRegion x={430} y={24} w={190} h={150} label="Area 49.0002 (L1)" color={D.success} />
      <DRegion x={150} y={58} w={340} h={84} label="Level-2 backbone (contiguous L2 chain)" color={D.violet} />
      <DNode x={80} y={140} label="R1" sub="L1 only" accent={D.success} w={86} />
      <DNode x={200} y={112} label="R2" sub="L1/L2 · ATT" accent={D.violet} w={86} />
      <DNode x={440} y={112} label="R3" sub="L1/L2 · ATT" accent={D.violet} w={86} />
      <DNode x={560} y={140} label="R4" sub="L1 only" accent={D.success} w={86} />
      <DLink x1={123} y1={140} x2={157} y2={122} color={D.success} />
      <DLink x1={243} y1={112} x2={397} y2={112} color={D.violet} label="L2 adjacency" />
      <DLink x1={483} y1={122} x2={517} y2={140} color={D.success} />
      <text x={320} y={200} textAnchor="middle" fill={D.muted} fontSize={10}>
        Area borders sit on links, not inside routers. L1 = intra-area; L2 = inter-area backbone.
      </text>
      <text x={320} y={218} textAnchor="middle" fill={D.muted} fontSize={10}>
        L1-only routers follow the ATT (attached) bit set by L1/L2 routers → default route to nearest L1/L2.
      </text>
    </DiagramSvg>
  );
}

function LeakDiagram() {
  return (
    <DiagramSvg h={170} label="Route leaking: L1 routes are advertised up to L2 by default; L2 routes leak down into L1 only by policy, with the up/down bit set">
      <DNode x={120} y={50} label="Level-2" sub="all areas' prefixes" accent={D.violet} w={150} />
      <DNode x={120} y={130} label="Level-1 area" sub="own prefixes + default" accent={D.success} w={150} />
      <DArrow x1={90} y1={108} x2={90} y2={74} color={D.success} />
      <DArrow x1={150} y1={74} x2={150} y2={108} color={D.warning} dashed />
      <text x={220} y={80} fill={D.success} fontSize={10}>
        ↑ L1 → L2: automatic on L1/L2 routers
      </text>
      <text x={220} y={100} fill={D.warning} fontSize={10}>
        ↓ L2 → L1: only with a leaking policy (RFC 5302)
      </text>
      <text x={220} y={120} fill={D.muted} fontSize={10}>
        Leaked prefixes carry the up/down bit — never re-advertised to L2 (loop prevention)
      </text>
      <text x={220} y={140} fill={D.muted} fontSize={10}>
        Why leak? Optimal exit and specific loopbacks (e.g. BGP next hops, LDP FECs)
      </text>
    </DiagramSvg>
  );
}

function DisDiagram() {
  return (
    <DiagramSvg h={220} label="Broadcast LAN: routers elect a DIS which creates a pseudonode; point-to-point has no DIS">
      <text x={160} y={18} textAnchor="middle" fill={D.text} fontSize={11} fontWeight={700}>
        Broadcast circuit
      </text>
      <DNode x={160} y={70} label="Pseudonode" sub="LAN LSP · ID .01" accent={D.warning} w={120} />
      <DNode x={60} y={150} label="R1" sub="prio 64" accent={D.cyan} w={72} />
      <DNode x={160} y={150} label="R2 · DIS" sub="prio 100" accent={D.warning} w={80} />
      <DNode x={260} y={150} label="R3" sub="prio 64" accent={D.cyan} w={72} />
      <DLink x1={60} y1={128} x2={130} y2={92} />
      <DLink x1={160} y1={128} x2={160} y2={92} />
      <DLink x1={260} y1={128} x2={190} y2={92} />
      <text x={165} y={194} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        Highest priority, then highest MAC wins
      </text>
      <text x={165} y={210} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        preemptive · no backup DIS · CSNP every 10 s
      </text>
      <line x1={330} y1={20} x2={330} y2={190} stroke={D.line} strokeDasharray="3 4" />
      <text x={480} y={18} textAnchor="middle" fill={D.text} fontSize={11} fontWeight={700}>
        Point-to-point circuit (this lesson)
      </text>
      <DNode x={410} y={100} label="P1" accent={D.cyan} w={72} />
      <DNode x={560} y={100} label="P2" accent={D.cyan} w={72} />
      <DLink x1={446} y1={100} x2={524} y2={100} color={D.success} label="P2P IIH (17)" />
      <text x={480} y={160} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        No DIS, no pseudonode, three-way handshake,
      </text>
      <text x={480} y={176} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        PSNP acks — the norm for two-router Ethernet links
      </text>
    </DiagramSvg>
  );
}

function PduDiagram() {
  return (
    <DiagramSvg h={250} label="IS-IS PDU types 15, 16, 17, 18, 20, 24, 25, 26 and 27">
      <DTable
        x={60}
        y={8}
        title="IS-IS PDU types"
        cols={[
          { label: "TYPE", w: 70 },
          { label: "PDU", w: 200 },
          { label: "PURPOSE", w: 250 },
        ]}
        rows={[
          ["15", "L1 LAN IIH", "Hello on broadcast circuits, Level 1"],
          ["16", "L2 LAN IIH", "Hello on broadcast circuits, Level 2"],
          ["17", "P2P IIH", "Hello on point-to-point, both levels"],
          ["18", "L1 LSP", "Level-1 link state"],
          ["20", "L2 LSP", "Level-2 link state"],
          ["24", "L1 CSNP", "Level-1 complete database summary"],
          ["25", "L2 CSNP", "Level-2 complete database summary"],
          ["26", "L1 PSNP", "Level-1 ack / request"],
          ["27", "L2 PSNP", "Level-2 ack / request"],
        ]}
        highlight={{ row: 2, color: D.success }}
      />
    </DiagramSvg>
  );
}

function LifecycleDiagram() {
  return (
    <DiagramSvg h={214} label="LSP lifecycle: originate with sequence and lifetime counting down, refresh with a higher sequence, purge at zero lifetime; higher sequence is newer, at the same sequence a purge beats a non-zero lifetime">
      <DPill x={90} y={40} text="originate seq n" color={D.success} w={140} />
      <DPill x={260} y={40} text={`lifetime ${LSP_LIFETIME} ↓`} color={D.cyan} w={130} />
      <DPill x={420} y={40} text="refresh seq n+1" color={D.warning} w={140} />
      <DPill x={570} y={40} text="purge (lifetime 0)" color={D.danger} w={130} />
      <DArrow x1={162} y1={40} x2={193} y2={40} color={D.muted} width={1.5} />
      <DArrow x1={327} y1={40} x2={348} y2={40} color={D.muted} width={1.5} />
      <DArrow x1={492} y1={40} x2={503} y2={40} color={D.muted} width={1.5} />
      <text x={320} y={84} textAnchor="middle" fill={D.text} fontSize={10.5} fontWeight={700}>
        Higher sequence = newer · same sequence: purge (lifetime 0) beats non-zero · otherwise same version
      </text>
      <text x={320} y={102} textAnchor="middle" fill={D.text} fontSize={10}>
        Same sequence, both lifetimes non-zero → the same version, even if the lifetime values differ.
      </text>
      <text x={320} y={120} textAnchor="middle" fill={D.warning} fontSize={10}>
        Same sequence, different checksum → inconsistent/corrupt copy (error handling), not an age tie-break.
      </text>
      <text x={320} y={142} textAnchor="middle" fill={D.muted} fontSize={10}>
        Refresh before expiry (default refresh ≈ 900 s for a 1200 s lifetime); any change also bumps the sequence.
      </text>
      <text x={320} y={160} textAnchor="middle" fill={D.muted} fontSize={10}>
        Remaining Lifetime counts down in every copy; it is outside the checksum, so aging needs no recomputation.
      </text>
      <text x={320} y={178} textAnchor="middle" fill={D.muted} fontSize={10}>
        Stale own LSP after reboot? Re-originate above the stored sequence. Sequence wrap → stop for MaxAge + ZeroAge.
      </text>
      <text x={320} y={196} textAnchor="middle" fill={D.muted} fontSize={10}>
        Fragments: one router may own LSP IDs …-00 to …-FF when TLVs outgrow a PDU.
      </text>
    </DiagramSvg>
  );
}

function TlvDiagram() {
  return (
    <DiagramSvg h={230} label="Common TLVs 1, 22, 128/130 vs 135, 129, 132, 137, 232, 236 and 240; narrow metrics max 63, wide metrics 24 and 32 bit">
      <DTable
        x={30}
        y={8}
        title="Common TLVs"
        cols={[
          { label: "TLV", w: 70 },
          { label: "NAME", w: 220 },
          { label: "NOTE", w: 290 },
        ]}
        rows={[
          ["1", "Area Addresses", "must share one at L1"],
          ["2 / 22", "IS Reachability (narrow / extended)", "22: 24-bit metric + sub-TLVs (TE)"],
          ["128 / 135", "IP Reachability (narrow / extended)", "135: 32-bit metric, up/down bit"],
          ["129 · 132", "Protocols Supported · IP Interface", "0xCC = IPv4, 0x8E = IPv6"],
          ["137", "Dynamic Hostname", "\"PE2\" in show output instead of 0000.0000.0004"],
          ["232 / 236", "IPv6 Interface / IPv6 Reachability", "RFC 5308"],
          ["240", "P2P Three-Way Adjacency", "RFC 5303"],
        ]}
      />
      <text x={320} y={210} textAnchor="middle" fill={D.warning} fontSize={10}>
        Narrow metrics: 6 bits (max 63 per link). Wide metrics (metric-style wide) are needed for TE and large cores.
      </text>
    </DiagramSvg>
  );
}

function EcmpDiagram() {
  return (
    <DiagramSvg h={210} label="ECMP: two equal-cost paths are both installed; overload bit makes other routers avoid transiting a router">
      <DNode x={50} y={90} label="PE1" accent={D.violet} w={70} />
      <DNode x={200} y={40} label="P1" accent={D.cyan} w={70} />
      <DNode x={200} y={140} label="P3" sub="OL bit" accent={D.danger} w={70} />
      <DNode x={350} y={90} label="PE2" accent={D.violet} w={70} />
      <DArrow x1={85} y1={80} x2={165} y2={48} color={D.success} label="10" />
      <DArrow x1={235} y1={48} x2={315} y2={80} color={D.success} label="10" />
      <DLink x1={85} y1={100} x2={165} y2={132} color={D.line} dashed label="10" labelDy={16} />
      <DLink x1={235} y1={132} x2={315} y2={100} color={D.line} dashed label="10" labelDy={16} />
      <text x={410} y={34} fill={D.text} fontSize={10} fontWeight={700}>
        Without OL: two equal paths (20)
      </text>
      <text x={410} y={50} fill={D.muted} fontSize={9.5}>
        → both installed (ECMP),
      </text>
      <text x={410} y={64} fill={D.muted} fontSize={9.5}>
        flows hashed across them
      </text>
      <text x={410} y={130} fill={D.danger} fontSize={10} fontWeight={700}>
        P3 sets overload bit
      </text>
      <text x={410} y={146} fill={D.muted} fontSize={9.5}>
        → not used for transit;
      </text>
      <text x={410} y={160} fill={D.muted} fontSize={9.5}>
        its own prefixes still reachable
      </text>
      <text x={320} y={196} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        Use OL during maintenance or on-startup until BGP converges (set-overload-bit on-startup wait-for-bgp).
      </text>
    </DiagramSvg>
  );
}

function LadderDiagram() {
  return (
    <DiagramSvg h={120} label="Troubleshooting ladder along the chain: physical, circuit level, adjacency, LSDB, SPF, forwarding">
      <IsisChain y={50} segs={{ a: "both", b: "down", c: "both" }} colors={{ a: D.success, c: D.success }} labels={{ b: "where is it broken?" }} />
      <text x={320} y={108} textAnchor="middle" fill={D.muted} fontSize={10}>
        link → circuit level / area / auth / MTU → adjacency → LSDB → SPF → RIB/FIB → forwarding
      </text>
    </DiagramSvg>
  );
}

const QUIZ: KnowledgeQuestion[] = [
  {
    id: "q-ip",
    prompt: "An engineer changes P1's IPv4 address on the P1–P2 link to the wrong subnet. What happens to the P1–P2 IS-IS adjacency on a point-to-point circuit?",
    options: [
      { id: "a", label: "It stays Up: IS-IS hellos don't use IPv4 addresses to form the adjacency" },
      { id: "b", label: "It goes Down: the addresses must be in the same subnet" },
      { id: "c", label: "It goes Down after ARP times out" },
    ],
    correctId: "a",
    explanation: "Hellos ride in LLC frames and carry System IDs, not IP addresses, so the adjacency survives. IPv4 forwarding over that link may now be broken — a good example of why the adjacency and the data plane are separate facts.",
  },
  {
    id: "q-init",
    prompt: "P3 shows P4 as Initializing; P4 shows no entry for P3 at all. Whose receive check is failing?",
    options: [
      { id: "a", label: "P4's: it never accepts P3's hellos, so it never lists P3" },
      { id: "b", label: "P3's: it drops P4's hellos" },
      { id: "c", label: "Neither — this is normal for a few seconds" },
    ],
    correctId: "a",
    explanation: "P3 hears P4 (that's why it's Initializing) but never sees itself listed in P4's hellos. P4 lists only neighbors it accepts, so P4 is dropping P3's hellos.",
  },
  {
    id: "q-area",
    prompt: "Two Level-2-only routers have NETs in areas 49.0001 and 49.0002. Do they form an adjacency?",
    options: [
      { id: "a", label: "Yes: Level 2 doesn't compare areas" },
      { id: "b", label: "No: areas must match" },
      { id: "c", label: "Only if both run Level 1 as well" },
    ],
    correctId: "a",
    explanation: "Level 2 is the backbone between areas, so it never compares area addresses. Only Level-1 adjacencies require a shared area.",
  },
  {
    id: "q-metric",
    prompt: "P1's metric toward P2 is 100, P2's toward P1 is 10. Which statement is true?",
    options: [
      { id: "a", label: "Traffic from P1's side may avoid the link while traffic from P2's side still uses it" },
      { id: "b", label: "Both directions cost 100" },
      { id: "c", label: "Both directions cost 55 (the average)" },
    ],
    correctId: "a",
    explanation: "Each router advertises its own outgoing metric to each neighbor. SPF adds the metric of the direction it is traveling, so the two directions can choose different paths.",
  },
  {
    id: "q-ol",
    prompt: "P3 sets the overload bit. Can PE1 still ping 10.0.0.5 (P3's loopback)?",
    options: [
      { id: "a", label: "Yes: overload stops transit through P3, not traffic to P3" },
      { id: "b", label: "No: an overloaded router is removed from SPF" },
      { id: "c", label: "Only over the P1–P3 rung" },
    ],
    correctId: "a",
    explanation: "SPF still reaches an overloaded router and installs its own prefixes; it just never continues the tree through it.",
  },
  {
    id: "q-stale",
    prompt: "After a router is isolated, its LSP is still in everyone's database for a while. Why doesn't traffic go toward it?",
    options: [
      { id: "a", label: "The two-way check: its neighbors no longer list it, so SPF can't use any link to it" },
      { id: "b", label: "Stale LSPs are deleted at once" },
      { id: "c", label: "The checksum fails" },
    ],
    correctId: "a",
    explanation: "A stale LSP may still claim neighbors, but those neighbors' current LSPs don't list it back. SPF only uses links both ends report.",
  },
];

export function IsisDeepDiveContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="isd-why" eyebrow="Foundation" title="Why a provider core runs IS-IS" tone="cyan">
        <p>
          Every service a provider sells rides on one promise: <b className="text-pv-text">any router can reach any other router&apos;s loopback, over the best path, and finds a new path within moments when something fails</b>. BGP sessions, MPLS label paths, VPN tunnels and segment routing in the next lessons are all built between loopbacks. The interior gateway protocol (IGP) keeps that promise.
        </p>
        <CompareCards
          items={[
            { title: "OSPF", tone: "cyan", tag: "Enterprise path", points: ["runs over IPv4 (protocol 89)", "areas around area 0, several LSA types", "the usual enterprise choice"] },
            { title: "IS-IS", tone: "violet", tag: "provider cores", points: ["runs directly on the link, independent of IP", "two levels, one LSP per router, extended with TLVs", "common in large provider backbones"] },
          ]}
        />
        <p className="text-sm text-pv-text-muted">Both are link-state protocols: describe yourself, flood it, run SPF. Providers often prefer IS-IS for its independence from IP (it routes IPv4 and IPv6 alike, and can&apos;t be reached by IP packets from outside), its simple flat Level-2 designs and its TLV extensibility — later used for traffic engineering and segment routing.</p>
      </GuideSection>

      <GuideSection id="isd-integrated" eyebrow="Foundation" title="Integrated IS-IS" tone="cyan">
        <DiagramFrame caption="An OSI routing protocol that learned to carry IP.">
          <IntegratedDiagram />
        </DiagramFrame>
        <p>ISO 10589 defined IS-IS to route the OSI network protocol CLNP. RFC 1195 added IPv4 reachability as just another set of TLVs (&quot;Integrated IS-IS&quot;), and RFC 5308 did the same for IPv6. The routing machinery — hellos, LSPs, SPF — never changed. That is why a new feature in IS-IS usually means a new TLV, not a new protocol.</p>
      </GuideSection>

      <GuideSection id="isd-nsap" eyebrow="Foundation" title="NSAP and NET" tone="violet">
        <DiagramFrame caption="The NET is an NSAP address whose selector byte is 00: it names the routing process itself.">
          <NsapDiagram />
        </DiagramFrame>
        <FieldTable
          title="Reading a NET"
          accent="violet"
          columns={["Part", "In 49.0001.0000.0000.0002.00", "Rule"]}
          rows={[
            ["Area", <Mono key="a">49.0001</Mono>, "49 = private address space; must be shared by Level-1 neighbors"],
            ["System ID", <Mono key="s">0000.0000.0002</Mono>, "exactly six bytes; unique in the whole domain"],
            ["NSEL", <Mono key="n">00</Mono>, "always 00 in a NET"],
          ]}
        />
        <Callout tone="warning" title="Duplicate System IDs" icon="!">
          Two routers with the same System ID originate LSPs with the same LSP ID. Each keeps overwriting the other&apos;s LSP with a higher sequence number and the network flaps. Many operators derive the System ID from the loopback (10.0.0.2 → 0100.0000.0002) to make duplicates unlikely.
        </Callout>
      </GuideSection>

      <GuideSection id="isd-network" eyebrow="Foundation" title="The core you will study" tone="cyan">
        <DiagramFrame caption="The IS-IS Lab's core: the lesson's four routers plus P3 and P4, so PE1 has two equal paths to PE2. The P1–P3 rung is cabled but not in IS-IS.">
          <LabCore />
        </DiagramFrame>
        <p>Every example on this page is printed by the lab&apos;s own IOS XR and Junos command sets from this network. All six routers are Level-2-only in area 49.0001; every link is a point-to-point circuit with metric 10; every loopback is a passive IS-IS interface.</p>
      </GuideSection>

      <GuideSection id="isd-pdus" eyebrow="Neighbors" title="The PDU types" tone="cyan">
        <DiagramFrame caption="Three families: hellos (IIH), link-state PDUs (LSP) and sequence-number PDUs (CSNP / PSNP), each per level.">
          <PduDiagram />
        </DiagramFrame>
        <p>On point-to-point circuits there is one hello type for both levels (17); the circuit-type field inside it says which levels the sender runs. Every IS-IS PDU travels in an 802.3 frame with LLC <Mono>FE FE 03</Mono> to a multicast MAC (<Mono>{ALL_ISS}</Mono> on point-to-point links). None of them has an IP header.</p>
      </GuideSection>

      <GuideSection id="isd-hello" eyebrow="Neighbors" title="What a hello must agree on" tone="success">
        <FieldTable
          title="Checks a router applies to every received hello"
          accent="success"
          columns={["Check", "If it fails", "Evidence"]}
          rows={[
            ["The interface runs IS-IS (Junos: unit has family iso)", "no hellos sent, none processed", "show isis interface · show interfaces terse"],
            ["A common level (is-type ∩ circuit-type, both sides)", "hello rejected; no adjacency", "show isis interface <if> on both ends"],
            ["Level 1 only: a shared area", "Level-1 adjacency refused", "the area in each NET"],
            ["The hello fits the receiver's MTU (hellos are padded)", "dropped as a giant: one-way", "interface giants · one side Initializing"],
            ["Authentication matches (if the receiver has a key)", "dropped: one-way or none", "authentication drops in the log / statistics"],
            ["Same circuit type (point-to-point vs broadcast)", "hellos of the wrong kind ignored", "Media Type in show isis interface"],
          ]}
        />
        <p className="text-sm text-pv-text-muted">Unlike OSPF, IS-IS doesn&apos;t require matching hello timers or subnet masks on point-to-point circuits: each side tells the other its own holding time, and the IP subnet isn&apos;t part of forming the adjacency.</p>
      </GuideSection>

      <GuideSection id="isd-3way" eyebrow="Neighbors" title="The three-way handshake" tone="success">
        <DiagramFrame caption="TLV 240 carries the sender's view: Down, Initializing or Up, plus the neighbor's System ID once it has one.">
          <ThreeWayDiagram />
        </DiagramFrame>
        <p>
          RFC 5303 added the three-way handshake to point-to-point IS-IS so that a link working in only one direction never becomes an adjacency. The rule worth memorizing for troubleshooting: <b className="text-pv-text">Initializing on router A means A hears B but B doesn&apos;t list A</b> — so the failing check is B&apos;s receive side.
        </p>
        <CliPanel run={cli(T.mtu, "P4", "cisco", "show isis neighbors")} caption="IOS XR · P4 in the MTU ticket — P3 is stuck in Init" />
      </GuideSection>

      <GuideSection id="isd-padding" eyebrow="Neighbors" title="MTU and hello padding" tone="warning">
        <p>
          IS-IS pads its hellos (TLV 8) up to the full interface MTU. A hello therefore proves more than reachability: it proves the link can carry the largest frame this router will send. If one end has a larger MTU, its padded hellos arrive as <b className="text-pv-text">giants</b> at the smaller end and are dropped before IS-IS ever sees them.
        </p>
        <CliPair cisco={only(T.mtu, "P3", "cisco", "show interfaces Gi0/0/0/1", /is up|MTU|giants|input errors/)} junos={only(T.mtu, "P4", "juniper", "show isis adjacency", /./)} ciscoCaption="IOS XR · P3 (drops P4's padded hellos)" junosCaption="Junos · P4 (hears P3, isn't heard back)" />
        <Callout tone="cyan" title="Why pad at all?" icon="i">
          Without padding, two routers with mismatched MTUs would form an adjacency and then silently lose every full-size LSP or data packet. Padding turns a hidden data-plane problem into a visible control-plane one. Some networks disable padding on fast, trusted links to save bandwidth; this lab keeps it on.
        </Callout>
      </GuideSection>

      <GuideSection id="isd-auth" eyebrow="Neighbors" title="Hello authentication" tone="warning">
        <p>Hello authentication (HMAC-MD5 here; modern networks also use keychains with HMAC-SHA) stops a stray device from becoming a neighbor. A router with a key drops hellos that lack the right authentication TLV; a router without a key accepts hellos regardless. A key on one side only therefore produces a one-way adjacency, and the router doing the dropping logs it.</p>
        <FieldTable
          title="Where the key lives"
          accent="warning"
          columns={["", "IOS XR (router isis CORE → interface)", "Junos"]}
          rows={[
            ["Set", <Mono key="1">hello-password hmac-md5 clear &lt;key&gt;</Mono>, <Mono key="2">set protocols isis interface ge-0/0/1.0 level 2 hello-authentication-key &lt;key&gt;</Mono>],
            ["Shown as", "hello-password hmac-md5 encrypted …", "hello-authentication-key \"$9$…\"; (plus hello-authentication-type md5)"],
          ]}
        />
        <p className="text-sm text-pv-text-muted">LSPs and SNPs can be authenticated too (per level), so that nobody can inject routing information. Hello and LSP authentication are configured separately.</p>
      </GuideSection>

      <GuideSection id="isd-dis" eyebrow="Neighbors" title="Point-to-point vs broadcast" tone="warning">
        <DiagramFrame caption="On a LAN, IS-IS elects a DIS and models the LAN as a pseudonode; on point-to-point circuits none of that exists.">
          <DisDiagram />
        </DiagramFrame>
        <p>An Ethernet link between exactly two routers is usually configured as point-to-point (RFC 5309): no DIS election, no pseudonode LSP, faster convergence and simpler databases. Both ends must agree — a point-to-point hello is ignored by an interface running in broadcast mode. Every core link in this course is point-to-point.</p>
      </GuideSection>

      <GuideSection id="isd-levels" eyebrow="Levels and areas" title="Level 1, Level 2, Level-1-2" tone="success">
        <DiagramFrame caption="Areas sit on links, not inside routers: a router is in one area, the border is the link between areas.">
          <LevelsDiagram />
        </DiagramFrame>
        <FieldTable
          title="How a router and an interface choose their levels"
          accent="success"
          columns={["Setting", "IOS XR", "Junos", "Effect"]}
          rows={[
            ["Router type", <Mono key="1">is-type level-2-only</Mono>, <Mono key="2">level 1 disable</Mono>, "the levels the router runs at all"],
            ["Interface", <Mono key="3">circuit-type level-1 | level-1-2 | level-2-only</Mono>, <Mono key="4">interface … level 1|2 disable</Mono>, "the levels allowed on that interface"],
            ["Result", "router ∩ interface", "router ∩ interface", "empty = the interface runs no level and forms no adjacency"],
          ]}
        />
        <p className="text-sm text-pv-text-muted">A flat Level-2-only design (this core) gives every router the whole map and keeps operations simple. Large networks add Level-1 areas to shrink databases; Level-1-only routers then reach the rest of the network through a default route toward the nearest Level-1-2 router that sets the ATT (attached) bit.</p>
      </GuideSection>

      <GuideSection id="isd-leak" eyebrow="Levels and areas" title="Route leaking" tone="warning">
        <DiagramFrame caption="Level 1 → Level 2 is automatic; Level 2 → Level 1 only by policy, marked with the up/down bit.">
          <LeakDiagram />
        </DiagramFrame>
        <p>Leaking matters for the MPLS lessons ahead: a PE in a Level-1 area that only has a default route can&apos;t build a label path to a specific remote loopback. Providers either keep the core flat (Level 2) or leak the loopbacks into Level 1.</p>
      </GuideSection>

      <GuideSection id="isd-lsp" eyebrow="One map" title="What an LSP carries" tone="violet">
        <DiagramFrame caption="Each TLV is a typed piece of information; routers skip TLVs they don't understand.">
          <TlvDiagram />
        </DiagramFrame>
        <CliPanel run={cli(WARM, "PE1", "cisco", "show isis database detail P1")} caption="IOS XR · PE1's copy of P1's LSP" />
        <p className="text-sm text-pv-text-muted">The IS-Extended entries are P1&apos;s neighbors and its outgoing metric to each; the IP-Extended entries are its loopback and the /31 of each IS-IS link. Note what is <b>not</b> there: the P1–P3 rung, because IS-IS doesn&apos;t run on it.</p>
      </GuideSection>

      <GuideSection id="isd-lifecycle" eyebrow="One map" title="Sequence, lifetime, purge" tone="warning">
        <DiagramFrame caption="Recency is decided by the sequence number; lifetime only decides when a copy dies.">
          <LifecycleDiagram />
        </DiagramFrame>
        <CliPair cisco={cli(WARM, "PE1", "cisco", "show isis database")} junos={cli(WARM, "PE1", "juniper", "show isis database")} ciscoCaption="IOS XR · PE1 (Holdtime = remaining lifetime)" junosCaption="Junos · PE1 (Lifetime counts down from 1200)" />
        <p className="text-sm text-pv-text-muted">Every router refreshes its own LSP well before its {LSP_LIFETIME}-second lifetime runs out (the lab refreshes after 900 s), raising the sequence number even when nothing changed. A lifetime that reaches zero means the originator has gone silent, and the LSP is purged.</p>
      </GuideSection>

      <GuideSection id="isd-flood" eyebrow="One map" title="Reliable flooding" tone="warning">
        <FlowSteps
          steps={[
            { title: "Receive a newer LSP", body: "Install it, acknowledge it with a PSNP (point-to-point), flood it on every other adjacency.", tone: "success" },
            { title: "Receive an older LSP", body: "Keep your newer copy and send it back toward the sender.", tone: "warning" },
            { title: "Receive the same LSP", body: "Acknowledge it; nothing to flood.", tone: "cyan" },
            { title: "New adjacency", body: "Exchange CSNPs (every LSP header you hold) and send what the other side lacks or holds older.", tone: "violet" },
            { title: "No acknowledgement", body: "Retransmit the LSP after a few seconds until it is acknowledged.", tone: "danger" },
          ]}
        />
        <p className="text-sm text-pv-text-muted">The result is a property you can check on any router: within a level, every router holds the same LSPs with the same sequence numbers and checksums. If two routers disagree for more than a moment, flooding is broken somewhere between them.</p>
      </GuideSection>

      <GuideSection id="isd-spf" eyebrow="Paths" title="SPF and the two-way check" tone="ip">
        <p>Each router runs Dijkstra with itself as the root over the LSPs of one level. Starting from the root, it repeatedly takes the closest router not yet placed, and adds that router&apos;s neighbors with the metric that router advertises toward them. A link is used only if <b className="text-pv-text">both</b> ends list each other. Equal-cost paths are all kept.</p>
        <CliPanel run={cli(WARM, "PE1", "cisco", "show isis topology")} caption="IOS XR · PE1's SPF result — PE2 at 30 over two first hops" />
        <DiagramFrame caption="Two equal paths are both installed; an overloaded router is never used for transit.">
          <EcmpDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="isd-rib" eyebrow="Paths" title="From SPF to the routing table" tone="ip">
        <p>For each prefix in the LSPs, a router adds the advertiser&apos;s SPF distance and the prefix&apos;s own metric, keeps the lowest total, and installs it with the first hops toward that advertiser. PE2&apos;s loopback: 30 + 10 = 40, via P1 and via P3.</p>
        <CliPair cisco={only(WARM, "PE1", "cisco", "show route isis", /10\.0\.0\.|^\s+\[115/)} junos={only(WARM, "PE1", "juniper", "show route protocol isis", /^10\.0\.0\.|>/)} ciscoCaption="IOS XR · PE1 (loopbacks)" junosCaption="Junos · PE1 (loopbacks)" />
        <FieldTable
          title="Route preference"
          accent="ip"
          columns={["Rule", "IOS XR", "Junos"]}
          rows={[
            ["IS-IS against other sources", "administrative distance 115", "preference 15 (L1 internal) / 18 (L2 internal)"],
            ["Same prefix at both levels", "Level 1 preferred over Level 2", "Level 1 preferred (15 < 18)"],
            ["Equal cost", "all next hops installed (up to the maximum paths)", "all next hops kept; the forwarding table load-balances with a load-balance policy (configured in the lab)"],
          ]}
        />
      </GuideSection>

      <GuideSection id="isd-metric" eyebrow="Paths" title="Metrics: outgoing, per direction" tone="ip">
        <p>A metric belongs to an interface and describes the cost of <b className="text-pv-text">leaving</b> through it. P1&apos;s metric toward P2 and P2&apos;s metric toward P1 are two independent numbers in two different LSPs. Changing only one moves traffic in only one direction — the classic cause of asymmetric paths.</p>
        <CliPair cisco={only(T.metric, "PE1", "cisco", "show route 10.0.0.4", /Known via|via Gigabit/)} junos={only(T.metric, "P1", "juniper", "show isis interface", /Interface|ge-0\/0\/1/)} ciscoCaption="IOS XR · PE1 after P1 → P2 became 100: bottom path only" junosCaption="Junos · P1's interfaces: 100 toward P2" />
        <Callout tone="cyan" title="Wide metrics" icon="i">
          The original &quot;narrow&quot; metrics allow only 0–63 per link (and 1023 per path). Wide metrics (TLV 22/135, <Mono>metric-style wide</Mono>) allow 24-bit link metrics and are required for traffic engineering. Mixing styles between routers breaks SPF, so a core uses one style everywhere — this lab uses wide.
        </Callout>
      </GuideSection>

      <GuideSection id="isd-overload" eyebrow="Paths" title="The overload bit" tone="violet">
        <p>The overload (OL) bit in a router&apos;s LSP tells everyone: reach me, but don&apos;t route through me. Operators set it before maintenance so traffic drains away gracefully, and many routers set it at boot until BGP has converged. A forgotten overload bit is a classic incident: the router looks healthy and carries nothing.</p>
        <CliPanel run={cli(T.overload, "PE1", "cisco", "show isis database")} caption="IOS XR · PE1 in the overload ticket — ATT/P/OL = 0/0/1 on P1" />
        <FieldTable title="Setting and clearing it" accent="violet" columns={["", "IOS XR", "Junos"]} rows={[["Set", <Mono key="1">router isis CORE → set-overload-bit</Mono>, <Mono key="2">set protocols isis overload</Mono>], ["Clear", <Mono key="3">no set-overload-bit</Mono>, <Mono key="4">delete protocols isis overload</Mono>]]} />
      </GuideSection>

      <GuideSection id="isd-config" eyebrow="Operations" title="Configuring it: IOS XR and Junos" tone="cyan">
        <p>Both platforms edit a candidate configuration and activate it on <Mono>commit</Mono> — the standard way providers change routers, because a whole change lands at once and can be rolled back.</p>
        <CliPanel run={cli(WARM, "PE1", "cisco", "show running-config router isis")} caption="IOS XR · PE1" />
        <CliPanel run={cli(WARM, "PE1", "juniper", "show configuration protocols isis")} caption="Junos · PE1 (the NET is on lo0: family iso address)" />
        <CompareCards
          items={[
            { title: "IOS XR", tone: "cyan", tag: "modes", points: ["configure → router isis CORE → interface … → address-family ipv4 unicast → metric", "commit · show commit changes diff · rollback configuration last 1"] },
            { title: "Junos", tone: "violet", tag: "set statements", points: ["set protocols isis interface ge-0/0/0.0 point-to-point", "every IS-IS unit also needs family iso; the NET lives on lo0", "commit · show | compare · rollback 1"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="isd-verify" eyebrow="Operations" title="How to verify: walk the chain" tone="cyan">
        <FieldTable
          title="One question per layer"
          accent="cyan"
          columns={["Question", "IOS XR", "Junos"]}
          rows={[
            ["Is the link up, with what MTU?", <Mono key="1">show interfaces brief</Mono>, <Mono key="2">show interfaces terse · show interfaces &lt;if&gt;</Mono>],
            ["Is the interface in IS-IS, at which level?", <Mono key="3">show isis interface brief</Mono>, <Mono key="4">show isis interface</Mono>],
            ["Are the adjacencies Up?", <Mono key="5">show isis adjacency</Mono>, <Mono key="6">show isis adjacency</Mono>],
            ["Same LSPs everywhere?", <Mono key="7">show isis database</Mono>, <Mono key="8">show isis database</Mono>],
            ["What does one LSP say?", <Mono key="9">show isis database detail P1</Mono>, <Mono key="10">show isis database P1.00-00 detail</Mono>],
            ["What did SPF choose?", <Mono key="11">show isis topology · show route isis</Mono>, <Mono key="12">show route protocol isis</Mono>],
            ["When did SPF run, and why?", <Mono key="13">show isis spf-log</Mono>, <Mono key="14">show isis spf log</Mono>],
          ]}
        />
      </GuideSection>

      <GuideSection id="isd-normal" eyebrow="Operations" title="What healthy looks like" tone="success">
        <CliPair cisco={cli(WARM, "P1", "cisco", "show isis adjacency")} junos={cli(WARM, "P1", "juniper", "show isis adjacency")} ciscoCaption="IOS XR · P1" junosCaption="Junos · P1" />
        <CliPair cisco={cli(WARM, "PE1", "cisco", "show isis interface brief")} junos={cli(WARM, "PE1", "juniper", "show isis interface")} ciscoCaption="IOS XR · PE1" junosCaption="Junos · PE1" />
        <CliPanel run={cli(WARM, "PE1", "cisco", "show route 10.0.0.4")} caption="IOS XR · PE1 — two equal next hops" />
      </GuideSection>

      <GuideSection id="isd-signatures" eyebrow="Troubleshooting" title="Failure signatures" tone="danger">
        <FailureSignatures
          items={[
            { tag: "LVL", title: "No common level", tone: "danger", points: ["link up, no adjacency on either side", "one interface runs no level (show isis interface)", "both LSPs drop the neighbor"] },
            { tag: "MTU", title: "MTU mismatch", tone: "warning", points: ["larger side Initializing, smaller side nothing", "giants on the smaller side"] },
            { tag: "AUTH", title: "Key mismatch", tone: "warning", points: ["one-way or none", "authentication drops logged on the keyed side"] },
            { tag: "LO", title: "Loopback missing", tone: "danger", points: ["every adjacency Up, databases in sync", "no /32 for that loopback in its LSP or anyone's RIB"] },
            { tag: "OL", title: "Overload bit", tone: "violet", points: ["router reachable, never transit", "OL = 1 in its LSP"] },
            { tag: "MET", title: "One-sided metric", tone: "cyan", points: ["paths differ by direction", "the two ends of one link show different metrics"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="isd-workflow" eyebrow="Troubleshooting" title="Investigation workflow" tone="danger">
        <DiagramFrame caption="Find the first layer where the evidence stops matching the healthy picture.">
          <LadderDiagram />
        </DiagramFrame>
        <TroubleshootingFlow
          steps={[
            { question: "What does the test show: no route, or an unexpected path?", look: "ping / traceroute from the router that has the problem; show route <ip>." },
            { question: "Are the links up underneath?", look: "show interfaces brief / terse — rule out Layer 1 first." },
            { question: "Does every link have an adjacency Up at BOTH ends?", look: "show isis adjacency on both routers; a one-sided Initializing points at the other side's receive check." },
            { question: "Do the routers hold the same LSPs?", look: "show isis database on two routers: same IDs, same sequence numbers." },
            { question: "What does each LSP say about its originator?", look: "show isis database detail: neighbors, metrics, prefixes, overload bit." },
            { question: "Fix one thing, then prove it", look: "the adjacency, the LSP, the route, and fresh traffic — in that order." },
          ]}
        />
      </GuideSection>

      <GuideSection id="isd-tickets" eyebrow="Troubleshooting" title="Five faults, evidence to proof" tone="danger">
        <p>These are the IS-IS Lab&apos;s five tickets. Each output below is from the lab with that ticket&apos;s fault in place, after the user&apos;s test.</p>
        <FailureWalk
          title="1 · The top path carries nothing (level)"
          normal="P1–P2 is a Level-2 adjacency; PE1 load-shares to PE2 over P1 and P3."
          change="P2's Gi0/0/0/0 got circuit-type level-1 on a Level-2-only router."
          evidence={<CliPanel run={cli(T.level, "P1", "cisco", "show isis neighbors")} caption="IOS XR · P1 — only PE1 left" />}
          next="Compare both ends with show isis interface: P2's interface runs no level. PE1's route to 10.0.0.4 now has one next hop (P3)."
          fix={<Mono>router isis CORE → interface GigabitEthernet0/0/0/0 → no circuit-type → commit</Mono>}
          proof="P1–P2 Up on both routers; PE1 back to two equal next hops; a fresh trace succeeds."
        />
        <FailureWalk
          title="2 · PE2 unreachable by loopback only"
          normal="PE2's LSP advertises 10.0.0.4/32 alongside its two /31s."
          change="Loopback0 was removed from IS-IS on PE2."
          evidence={<CliPanel run={only(T.loopback, "PE1", "cisco", "show isis database detail PE2", /PE2\.00-00|Metric/)} caption="IOS XR · PE1's copy of PE2's LSP — no 10.0.0.4/32" />}
          next="Every adjacency is Up and the databases agree, so look at content: the prefix is simply not advertised. show route 10.0.0.4 on PE1: not in table."
          fix={<Mono>set protocols isis interface lo0.0 passive · commit</Mono>}
          proof="PE2's LSP carries 10.0.0.4/32 again (higher sequence); a fresh ping from PE1 succeeds."
        />
        <FailureWalk
          title="3 · P3–P4 never comes back (MTU)"
          normal="Both ends 1514; P3–P4 Up."
          change="P4's ge-0/0/0 MTU raised to 9014."
          evidence={<CliPanel run={only(T.mtu, "P3", "cisco", "show interfaces Gi0/0/0/1", /MTU|giants/)} caption="IOS XR · P3 — giants arriving from P4" />}
          next="P4 shows P3 Initializing (it hears P3); P3 shows nothing. The smaller side drops the larger side's padded hellos."
          fix={<Mono>delete interfaces ge-0/0/0 mtu · commit (on P4)</Mono>}
          proof="Same MTU both ends; adjacency Up on both; a fresh trace to 10.0.0.6 succeeds."
        />
        <FailureWalk
          title="4 · Nothing transits P1 (overload)"
          normal="P1's LSP has OL = 0; PE1 → PE2 uses P1 and P3."
          change="P1 kept the overload bit after maintenance."
          evidence={<CliPanel run={only(T.overload, "PE1", "cisco", "show isis database", /LSPID|P1\.00/)} caption="IOS XR · PE1 — OL = 1 on P1's LSP" />}
          next="Adjacencies are Up and P1 answers pings, but SPF won't continue through it: PE1 → 10.0.0.4 has only P3."
          fix={<Mono>router isis CORE → no set-overload-bit → commit</Mono>}
          proof="OL = 0 in P1's LSP; PE1 has two next hops again; fresh trace succeeds."
        />
        <FailureWalk
          title="5 · Two directions, two paths (metric)"
          normal="Metric 10 both ways on every link; both directions load-share."
          change="P1's metric toward P2 became 100."
          evidence={<CliPair cisco={only(T.metric, "PE1", "cisco", "show route 10.0.0.4", /Known via|via Gigabit/)} junos={only(T.metric, "PE2", "juniper", "show route 10.0.0.1", /10\.0\.0\.1|>/)} ciscoCaption="IOS XR · PE1 → PE2: bottom only" junosCaption="Junos · PE2 → PE1: still both" />}
          next="Compare the two ends of P1–P2: 100 one way, 10 the other. Metrics are per direction."
          fix={<Mono>interface GigabitEthernet0/0/0/1 → address-family ipv4 unicast → no metric → commit (on P1)</Mono>}
          proof="Same metric both ways; PE1 and PE2 each have two equal next hops to the other; fresh traces both ways succeed."
        />
      </GuideSection>

      <GuideSection id="isd-prove" eyebrow="Troubleshooting" title="Prove the repair" tone="success">
        <FlowSteps
          steps={[
            { title: "The adjacency", body: "Up on both routers, at the expected level.", tone: "success" },
            { title: "The LSPs", body: "New sequence numbers, same on every router; content as intended.", tone: "violet" },
            { title: "The route", body: "The metric and next hops you expect, in both directions if paths matter.", tone: "ip" },
            { title: "Fresh traffic", body: "A new ping or trace after the change — not the one from before.", tone: "warning" },
          ]}
        />
        <p className="text-sm text-pv-text-muted">An accepted command proves only that the router liked the syntax. The network is repaired when the evidence says so.</p>
      </GuideSection>

      <GuideSection id="isd-beyond" eyebrow="Beyond this lesson" title="Where IS-IS goes next" tone="violet">
        <FieldTable
          title="IS-IS in the rest of the Service Provider path"
          accent="violet"
          columns={["Topic", "What IS-IS adds"]}
          rows={[
            ["MPLS + LDP", "LDP labels follow IS-IS routes to every loopback; IGP–LDP sync keeps them aligned"],
            ["RSVP-TE", "TE extensions in TLV 22 sub-TLVs: bandwidth, admin groups — the TE database CSPF uses"],
            ["Segment routing", "Prefix-SIDs and adjacency-SIDs advertised in IS-IS TLVs — no separate label protocol"],
            ["TI-LFA / Flex-Algo", "precomputed repair paths and extra SPF topologies, all from the same LSDB"],
            ["Fast convergence", "BFD for sub-second failure detection; SPF and LSP generation throttling"],
            ["IPv6", "multi-topology or single topology with TLV 236 — the same LSPs, more TLVs"],
          ]}
        />
      </GuideSection>

      <GuideSection id="isd-myths" eyebrow="Master it" title="Common misconceptions" tone="warning">
        <Misconceptions
          items={[
            { myth: "IS-IS runs over IP, like OSPF.", correction: "It runs directly on the link (LLC), so IP addressing, ARP and IP routing don't affect hellos." },
            { myth: "Routers in different areas can't form an adjacency.", correction: "Only Level-1 adjacencies need the same area; Level 2 never compares areas." },
            { myth: "If the link is up, the adjacency is up.", correction: "Levels, MTU padding, keys and circuit type all have to agree first." },
            { myth: "A metric is the cost of the link.", correction: "It's the cost of leaving one router through one interface — each direction has its own." },
            { myth: "An overloaded router disappears from the network.", correction: "It stays reachable; it just stops being a transit." },
            { myth: "A stale LSP still attracts traffic.", correction: "The two-way check keeps SPF away from links the neighbors no longer confirm." },
          ]}
        />
      </GuideSection>

      <GuideSection id="isd-quiz" eyebrow="Master it" title="Knowledge check" tone="cyan">
        <KnowledgeQuiz questions={QUIZ} />
      </GuideSection>

      <GuideSection id="isd-explain" eyebrow="Master it" title="Can you explain it?" tone="violet">
        <ExplainIt
          items={[
            { q: "Why can IS-IS build IP routing before any IP route exists?", a: "Its PDUs ride directly on the link with an LLC header; neither hellos nor LSPs need IP to travel between neighbors." },
            { q: "What does Initializing tell you, and which side do you check next?", a: "That this router hears the neighbor but isn't listed in the neighbor's hellos — check the neighbor's receive side (level, MTU, key)." },
            { q: "How do six routers end up with identical databases?", a: "Each originates its own LSP; flooding with sequence numbers, acknowledgements and CSNP/PSNP synchronization delivers the newest copy of every LSP to every router." },
            { q: "Why did the line topology lose PE2 completely while the lab core only changed path?", a: "In the line, P1–P2 was the only path; in the lab, SPF finds the equal-cost path over P3–P4 — the same fault, a different symptom." },
            { q: "When would you set the overload bit on purpose?", a: "Before maintenance on a router, or at boot until BGP has converged, so traffic drains around it without losing reachability to it." },
          ]}
        />
      </GuideSection>

      <GuideSection id="isd-practice" eyebrow="Master it" title="Practice in the IS-IS Lab" tone="success">
        <p>Six Learn levels walk you from hellos to the evidence ladder; the engineering workspace gives you all six routers with IOS XR or Junos, six challenges (bring up the rung, steer traffic, drain a router, survive a failure, authenticate a link, rebuild PE1 from nothing) and the five tickets above.</p>
        <LabBridge />
        <PresentationBridge>Rewatch the IS-IS presentation.</PresentationBridge>
      </GuideSection>
    </div>
  );
}
