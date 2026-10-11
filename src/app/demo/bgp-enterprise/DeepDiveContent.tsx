import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DNode, DPill, DRegion, DiagramFrame, DiagramSvg, FailureSignatures, FieldTable, FlowSteps, GuideSection, Misconceptions, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { ExplainIt, KnowledgeQuiz, PracticeBridge, type KnowledgeQuestion } from "@/components/lesson/GuideInteractive";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import { PresentationBridge } from "@/components/presentation/LessonPresentation";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { CliPair, CliPanel, FailureWalk, pickLines, runGuideCli } from "@/components/lesson/GuideCli";
import type { CliVendor } from "@/lib/cli/types";
import { bgApply, bgClone, bgTicket, bgTicketState, createBgNet, type BgNet, type BgRouter, type BgTicketId } from "@/lib/sim-engine/scenarios/bgpNet";
import { bgRouterSets, type BgCliApi } from "./bgp-lab/bgCli";
import { DecisionLadder, NextHopDiagram, PathsDiagram, SessionFlow, Topology } from "./LessonGuideContent";

/**
 * BGP DEEP DIVE — the complete study course, taught on the lesson's own AS65001 with two ISPs. Every CLI sample is
 * produced by running the BGP Lab's model and its real Cisco/Junos command sets.
 * Progression: Foundation → Sessions → Routes → Choosing a path → Policy → Operations → Troubleshooting → Beyond → Master it.
 */

// Real CLI output, run by the lab's own command sets against the lab's model: the guide shows exactly what the lab shows.
function cliApi(s: BgNet): BgCliApi {
  const exec = { kind: "exec" } as const;
  return { view: s, act: () => s, ios: { R1: exec, R2: exec }, setIos: () => undefined, junosEdit: { R1: false, R2: false }, setJunosEdit: () => undefined, cand: { R1: bgClone(s.cfg.r.R1), R2: bgClone(s.cfg.r.R2) }, setCand: () => undefined };
}
const cli = (s: BgNet, r: BgRouter, vendor: CliVendor, command: string) => runGuideCli(bgRouterSets(cliApi(s), r)[vendor]!, command);
/** A ticket's network after its test ran: the state the student investigates. */
const ticketState = (id: BgTicketId) => bgTicket(id).repro.reduce((acc, a) => bgApply(acc, a), bgTicketState(id, 1));
const WARM = createBgNet();

function AsGraph() {
  return (
    <DiagramSvg h={220} label="A prefix is advertised across three autonomous systems, each prepending its AS number">
      <DRegion x={20} y={70} w={150} h={80} label="AS 64500 (origin)" color={D.success} />
      <DRegion x={245} y={70} w={150} h={80} label="AS 64510" color={D.bgp} />
      <DRegion x={470} y={70} w={150} h={80} label="AS 64520" color={D.violet} />
      <DNode x={95} y={118} label="origin" sub="198.51.100.0/24" w={120} accent={D.success} />
      <DNode x={320} y={118} label="transit" w={90} accent={D.bgp} />
      <DNode x={545} y={118} label="receiver" w={90} accent={D.violet} />
      <DArrow x1={156} y1={118} x2={274} y2={118} color={D.bgp} label="AS_PATH: 64500" />
      <DArrow x1={366} y1={118} x2={499} y2={118} color={D.bgp} label="AS_PATH: 64510 64500" />
      <text x={320} y={190} textAnchor="middle" fill={D.muted} fontSize={10}>
        each AS prepends its own number when advertising to an eBGP neighbor
      </text>
    </DiagramSvg>
  );
}

function FsmDiagram() {
  const st: [string, string][] = [
    ["Idle", D.faint],
    ["Connect", D.tcp],
    ["Active", D.warning],
    ["OpenSent", D.bgp],
    ["OpenConfirm", D.bgp],
    ["Established", D.success],
  ];
  return (
    <DiagramSvg h={150} label="BGP finite state machine from Idle to Established">
      {st.map(([s, c], i) => (
        <g key={s}>
          <DPill x={56 + i * 106} y={50} text={s} color={c} w={96} />
          {i < st.length - 1 && <DArrow x1={104 + i * 106} y1={50} x2={112 + i * 106} y2={50} color={D.faint} width={1.6} />}
        </g>
      ))}
      <text x={162} y={88} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        TCP connecting
      </text>
      <text x={268} y={88} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        TCP retry
      </text>
      <text x={374} y={88} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        OPEN sent
      </text>
      <text x={480} y={88} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        OPEN ok, wait KEEPALIVE
      </text>
      <text x={320} y={126} textAnchor="middle" fill={D.muted} fontSize={10}>
        any error → NOTIFICATION + back to Idle · Active is only entered when a TCP attempt fails
      </text>
    </DiagramSvg>
  );
}

function UpdateDiagram() {
  const box = (y: number, t: string, n: string, c: string) => (
    <g>
      <rect x={120} y={y} width={400} height={38} rx={8} fill={c} fillOpacity={0.12} stroke={c} />
      <text x={136} y={y + 17} fill={c} fontSize={11.5} fontWeight={700}>
        {t}
      </text>
      <text x={136} y={y + 31} fill={D.muted} fontSize={10}>
        {n}
      </text>
    </g>
  );
  return (
    <DiagramSvg h={190} label="An UPDATE carries withdrawn routes, path attributes and NLRI">
      {box(12, "Withdrawn Routes", "prefixes that are no longer reachable via this sender", D.danger)}
      {box(66, "Path Attributes", "ORIGIN · AS_PATH · NEXT_HOP · LOCAL_PREF · MED · COMMUNITIES …", D.bgp)}
      {box(120, "NLRI", "prefixes that share exactly these attributes", D.success)}
      <text x={320} y={180} textAnchor="middle" fill={D.muted} fontSize={10}>
        one UPDATE = one set of attributes for one or more prefixes
      </text>
    </DiagramSvg>
  );
}

function BestPathDiagram() {
  const steps = [
    "Weight (Cisco-proprietary, local)",
    "Highest LOCAL_PREF",
    "Locally originated",
    "Shortest AS_PATH",
    "Lowest ORIGIN (IGP < EGP < ?)",
    "Lowest MED (same neighbor AS)",
    "eBGP over iBGP",
    "Lowest IGP metric to NEXT_HOP",
    "Oldest eBGP path / lowest Router ID / …",
  ];
  return (
    <DiagramSvg h={330} label="A common vendor best-path order from weight down to router ID tiebreakers">
      {steps.map((s, i) => (
        <g key={s}>
          <rect x={120} y={10 + i * 35} width={400} height={28} rx={7} fill={D.box} stroke={i === 0 ? D.warning : D.bgp} strokeOpacity={0.7} strokeDasharray={i === 0 ? "4 3" : undefined} />
          <text x={140} y={29 + i * 35} fill={D.text} fontSize={11.5}>
            {i + 1}. {s}
          </text>
        </g>
      ))}
    </DiagramSvg>
  );
}

function ResolveDiagram() {
  return (
    <DiagramSvg h={170} label="A BGP route's next hop is resolved recursively through the IGP to a connected interface">
      <DPill x={120} y={40} text="BGP: 203.0.113.0/24 → NH 192.0.2.2" color={D.bgp} w={220} />
      <DArrow x1={235} y1={40} x2={300} y2={40} color={D.faint} />
      <DPill x={410} y={40} text="IGP: 192.0.2.0/30 → via 10.0.12.1" color={D.ospf} w={210} />
      <DArrow x1={410} y1={54} x2={410} y2={92} color={D.faint} />
      <DPill x={410} y={106} text="connected: 10.0.12.0/30 → ge-0/0/1" color={D.ip} w={220} />
      <text x={320} y={150} textAnchor="middle" fill={D.muted} fontSize={10}>
        if any step fails, the BGP route stays in the BGP table but is not installed
      </text>
    </DiagramSvg>
  );
}

function SplitHorizonDiagram() {
  return (
    <DiagramSvg h={180} label="Routes learned from one iBGP peer are not advertised to another iBGP peer">
      <DRegion x={20} y={20} w={600} h={140} label="one AS (iBGP)" color={D.ospf} />
      <DNode x={120} y={100} label="A" />
      <DNode x={320} y={100} label="B" />
      <DNode x={520} y={100} label="C" />
      <DArrow x1={172} y1={100} x2={268} y2={100} color={D.success} label="iBGP" />
      <DArrow x1={372} y1={100} x2={440} y2={100} color={D.danger} dashed label="not re-advertised" />
      <text x={456} y={106} fill={D.danger} fontSize={16} fontWeight={700}>
        ✕
      </text>
      <text x={320} y={148} textAnchor="middle" fill={D.muted} fontSize={10}>
        hence the iBGP full mesh, or route reflectors / confederations
      </text>
    </DiagramSvg>
  );
}

function PlanesDiagram() {
  return (
    <DiagramSvg h={150} label="BGP feeds the RIB, and the RIB programs the FIB that forwards packets">
      <DNode x={100} y={70} label="BGP table" sub="all paths" accent={D.bgp} w={130} />
      <DArrow x1={166} y1={70} x2={250} y2={70} color={D.faint} label="best + resolvable" />
      <DNode x={320} y={70} label="RIB" sub="all protocols" accent={D.ospf} w={120} />
      <DArrow x1={381} y1={70} x2={460} y2={70} color={D.faint} label="preferred" />
      <DNode x={540} y={70} label="FIB" sub="forwards packets" accent={D.ip} w={130} />
      <text x={320} y={130} textAnchor="middle" fill={D.muted} fontSize={10}>
        BGP never touches user packets; it only decides which routes the FIB gets
      </text>
    </DiagramSvg>
  );
}

/** What healthy BGP looks like, read from the routers — the state every later section refers to. */
function NormalState() {
  return (
    <div className="space-y-5">
      <p>
        Before anything breaks, learn what healthy BGP looks like on the routers. This is the lab&apos;s network, converged: R1 peers with ISP-A (AS65010), R2 with ISP-B (AS65020), R1 and R2 with each other over iBGP. Both ISPs reach AS65030, which owns 203.0.113.0/24 (SRV is 203.0.113.10). The design: ISP-A is the primary. Its routes get LOCAL_PREF 200 on R1, R2 prepends our AS twice toward ISP-B so the internet prefers to come back through ISP-A, and each router announces only our own two prefixes (192.0.2.128/26 behind R1, 192.0.2.192/26 behind R2).
      </p>
      <div className="space-y-2">
        <h4 className="text-sm font-bold text-pv-text">1 · Is every session up?</h4>
        <CliPair cisco={cli(WARM, "R1", "cisco", "show ip bgp summary")} junos={cli(WARM, "R2", "juniper", "show bgp summary")} ciscoCaption="R1 · Cisco IOS" junosCaption="R2 · Junos" />
        <p className="text-sm text-pv-text-muted">
          A number in <Mono>State/PfxRcd</Mono> (Cisco) or <Mono>Establ</Mono> with active/received counts (Junos) means the session is up and routes arrived. A word there instead (<Mono>Active</Mono>, <Mono>Idle</Mono>) means it is not up, however healthy the link is.
        </p>
      </div>
      <div className="space-y-2">
        <h4 className="text-sm font-bold text-pv-text">2 · Which paths does each router have, and which one won?</h4>
        <CliPanel run={cli(WARM, "R1", "cisco", "show ip bgp 203.0.113.0")} />
        <CliPanel run={cli(WARM, "R2", "juniper", "show route 203.0.113.0/24 detail")} />
        <p className="text-sm text-pv-text-muted">
          R1 has one path: its own, from ISP-A, with localpref 200, marked best. R2 has two. Its own path from ISP-B has localpref 100, and R1&apos;s ISP-A path arrives over iBGP with localpref 200 and next hop 10.0.12.1 (next-hop-self on R1). Junos says exactly why the ISP-B path lost: <Mono>Inactive reason: Local Preference</Mono>. R1 doesn&apos;t receive R2&apos;s ISP-B path, because a router passes on only its best path, and R2&apos;s best was learned over iBGP.
        </p>
      </div>
      <div className="space-y-2">
        <h4 className="text-sm font-bold text-pv-text">3 · What does the routing table use?</h4>
        <CliPair cisco={cli(WARM, "R1", "cisco", "show ip route 203.0.113.10")} junos={cli(WARM, "R2", "juniper", "show route 203.0.113.10")} ciscoCaption="R1 · Cisco IOS" junosCaption="R2 · Junos" />
        <p className="text-sm text-pv-text-muted">
          BGP never forwards a packet: it offers its best path to the routing table. On R1 the route is eBGP (distance 20) via ISP-A. On R2 it is iBGP via R1, with its own ISP-B path listed as inactive underneath (Junos gives every BGP route preference 170).
        </p>
      </div>
      <div className="space-y-2">
        <h4 className="text-sm font-bold text-pv-text">4 · What do we announce, and how does the internet see us?</h4>
        <CliPanel run={cli(WARM, "R2", "juniper", "show route advertising-protocol bgp 198.51.100.2")} />
        <CliPanel run={cli(WARM, "R5", "cisco", "show ip bgp 192.0.2.128")} note={<>The looking glass of AS65030 (R5): read-only, but it shows the one thing you can&apos;t see from inside, how others reach you.</>} />
        <p className="text-sm text-pv-text-muted">
          R2 announces only our two prefixes to ISP-B, with our AS three times (two prepends). AS65030 hears our prefix both ways and picks the shorter AS_PATH, through ISP-A (AS65010). The way back is decided by <strong>other</strong> networks: all we can do is make one path look worse.
        </p>
      </div>
      <Callout tone="success" title="And the traffic proves it" icon="✓">
        A traceroute from H1 and one from H2 to SRV both leave through R1 and ISP-A. A traceroute from SRV back to H1 comes in through ISP-A. Cut ISP-A&apos;s link and trace again: within moments everything goes R2 → ISP-B, because the backup session was already up.
      </Callout>
    </div>
  );
}

/** The five faults the lab can break, each walked from normal state to proof. */
function FaultWalks() {
  const nhs = ticketState("nhs");
  const ras = ticketState("remoteas");
  const lp = ticketState("localpref");
  const pre = ticketState("prepend");
  const leak = ticketState("leak");
  const rasNb = cli(ras, "R2", "juniper", "show bgp neighbor 198.51.100.2");
  const preRun = cli(pre, "R1", "cisco", "show running-config");
  return (
    <div className="space-y-4">
      <p>These are the five faults of the lab&apos;s tickets. Each one starts from the healthy evidence above and changes one thing. Read the evidence first and compare it with the healthy output, because the difference is the clue. Walk the chain every time: session → path → choice → announcement → routing table. Then see how the investigation questions lead to the cause, how to repair it on both vendors, and what proves the repair.</p>
      <FailureWalk
        title="1 · next-hop-self missing on the iBGP session"
        normal={<>R1 relays its ISP-A path to R2 with next hop 10.0.12.1 (itself), which R2 reaches directly.</>}
        change={<>A clean-up removes <Mono>next-hop-self</Mono> from R1&apos;s iBGP session. iBGP passes the next hop on unchanged, so R2 now receives ISP-A&apos;s own address, 192.0.2.2, which it has no route to.</>}
        evidence={
          <>
            <p>H2&apos;s traffic leaves through ISP-B while H1 is fine, and every session is up. R2 still holds the ISP-A path with localpref 200, but can&apos;t use it:</p>
            <CliPanel run={cli(nhs, "R2", "cisco", "show ip bgp 203.0.113.0")} />
            <DiagramFrame caption="By default iBGP doesn't change NEXT_HOP, so R2 receives ISP-A's own interface address as the next hop.">
              <NextHopDiagram />
            </DiagramFrame>
          </>
        }
        next={<>A path that has every right to win but doesn&apos;t: check that it is usable. Cisco marks it <Mono>(inaccessible)</Mono> and leaves out <Mono>valid</Mono>, and Junos says <Mono>Next hop type: Unusable</Mono>. Fix it on the router that <em>sends</em> the path. Advertising the external link subnet into the IGP would also work.</>}
        fix={<>On R1, toward R2: Cisco <Mono>router bgp 65001</Mono>, <Mono>neighbor 10.0.12.2 next-hop-self</Mono> · Junos <Mono>set protocols bgp group INTERNAL export NHS</Mono>, then <Mono>commit</Mono>.</>}
        proof={<>R2&apos;s ISP-A path shows next hop 10.0.12.1, valid, best, and H2&apos;s traceroute leaves through R1.</>}
      />
      <FailureWalk
        title="2 · The backup session never came up"
        normal={<>R2&apos;s session to ISP-B is Established, so if ISP-A fails, R2&apos;s ISP-B path takes over.</>}
        change={<>R2 is configured to expect AS 65200 from ISP-B, whose real AS is 65020. ISP-B&apos;s OPEN announces 65020, so R2 refuses it with a NOTIFICATION and the session never establishes.</>}
        evidence={
          <>
            <p>Nobody notices while ISP-A works. When ISP-A&apos;s link goes down, the whole office loses the internet. The session to ISP-B says <Mono>Active</Mono> and has never been up, and the log names the reason. The bytes are the AS that ISP-B really sent: 0xFDFC = 65020.</p>
            <CliPanel run={cli(ras, "R2", "cisco", "show ip bgp summary")} />
            <CliPanel run={cli(ras, "R2", "cisco", "show logging")} />
            <CliPanel run={{ ...rasNb, output: pickLines(rasNb.output, /Peer:|State:|Last Error|Bad Peer AS/) }} />
          </>
        }
        next={<>A session in Active or Idle with the link up: compare the configured remote AS with the AS the peer really announces (the NOTIFICATION, or Junos <Mono>Bad Peer AS</Mono>). Check every session, the backup too, before you need it.</>}
        fix={<>On R2, the real AS: Cisco <Mono>router bgp 65001</Mono>, <Mono>neighbor 198.51.100.2 remote-as 65020</Mono> · Junos <Mono>set protocols bgp group ISP-B neighbor 198.51.100.2 peer-as 65020</Mono>, then <Mono>commit</Mono>.</>}
        proof={<>The session is Established with a prefix count. Cut ISP-A again: H1 reaches SRV via R2 and ISP-B.</>}
      />
      <FailureWalk
        title="3 · The LOCAL_PREF policy is missing"
        normal={<>R1 gives routes from ISP-A localpref 200, so R1 and R2 both prefer ISP-A.</>}
        change={<>The import policy on R1&apos;s ISP-A session is removed (Cisco <Mono>route-map LP200 in</Mono> · Junos <Mono>import LP200</Mono>). Every path now has the default localpref 100.</>}
        evidence={
          <>
            <p>H2&apos;s traffic goes out through ISP-B although all sessions are up and R2 has a valid ISP-A path. With localpref equal and both AS_PATHs two ASes long, the decision falls through to <em>eBGP over iBGP</em>: each router simply uses its own ISP.</p>
            <CliPanel run={cli(lp, "R2", "juniper", "show route 203.0.113.0/24 detail")} note={<>Inactive reason: Interior &gt; Exterior &gt; Exterior via Interior. In plain words, an external path beats one learned over iBGP.</>} />
          </>
        }
        next={<>Everything up but the wrong exit: compare the competing paths&apos; attributes in decision order (LOCAL_PREF, then AS_PATH length, then eBGP over iBGP). The step that decided tells you which policy is missing.</>}
        fix={<>On R1, the import policy back on the ISP-A session: Cisco <Mono>router bgp 65001</Mono>, <Mono>neighbor 192.0.2.2 route-map LP200 in</Mono> · Junos <Mono>set protocols bgp group ISP-A import LP200</Mono>, then <Mono>commit</Mono>.</>}
        proof={<>R2&apos;s inactive reason becomes <Mono>Local Preference</Mono>, and H2&apos;s traceroute leaves through R1.</>}
      />
      <FailureWalk
        title="4 · Prepending on the wrong router"
        normal={<>R2 prepends our AS twice toward ISP-B, so AS65030 prefers to reach us through ISP-A.</>}
        change={<>A change &quot;to make ISP-B the backup&quot; moves the prepend: R1 now prepends toward ISP-A and R2 doesn&apos;t prepend at all. That is the opposite of the intent.</>}
        evidence={
          <>
            <p>Outbound traffic still uses ISP-A, but replies arrive through ISP-B (metered). Our own routers look fine. The evidence is in what we announce, and in how the internet sees it:</p>
            <CliPanel run={cli(pre, "R1", "cisco", "show ip bgp neighbors 192.0.2.2 advertised-routes")} />
            <CliPanel run={cli(pre, "R5", "cisco", "show ip bgp 192.0.2.128")} note={<>AS65030 now sees the ISP-A path as longer and comes back through ISP-B.</>} />
            <CliPanel run={{ ...preRun, output: pickLines(preRun.output, /neighbor 192\.0\.2\.2/) }} />
          </>
        }
        next={<>The way back is wrong but the way out is right: look at what you announce to each ISP (<Mono>advertised-routes</Mono> · <Mono>advertising-protocol</Mono>) and at a looking glass. Prepend makes a path look worse: it belongs toward the <em>backup</em>.</>}
        fix={<>No prepend toward ISP-A, prepend back toward ISP-B. Cisco: <Mono>no neighbor 192.0.2.2 route-map PREPEND out</Mono> on R1, <Mono>neighbor 198.51.100.2 route-map PREPEND out</Mono> on R2 (under <Mono>router bgp 65001</Mono>) · Junos: <Mono>delete protocols bgp group ISP-A export PREPEND</Mono> on R1, <Mono>set protocols bgp group ISP-B export PREPEND</Mono> on R2, then <Mono>commit</Mono>.</>}
        proof={<>The looking glass prefers 65010 65001 again, and SRV&apos;s traceroute comes in through ISP-A.</>}
      />
      <FailureWalk
        title="5 · A route leak to an ISP"
        normal={<>Each router announces only our own prefixes to its ISP (prefix-list <Mono>OWN</Mono> · policy <Mono>OWN-ONLY</Mono>).</>}
        change={<>R2&apos;s outbound filter toward ISP-B is removed. R2 now passes on everything it uses, including 203.0.113.0/24 learned from ISP-A, so ISP-B is offered a path to AS65030 through us.</>}
        evidence={
          <>
            <p>ISP-B&apos;s NOC calls: we announce a prefix that isn&apos;t ours, with ISP-A&apos;s AS in the path. R2&apos;s announcements to ISP-B show it:</p>
            <CliPanel run={cli(leak, "R2", "cisco", "show ip bgp neighbors 198.51.100.2 advertised-routes")} />
          </>
        }
        next={<>Anything in an ISP&apos;s advertised-routes that isn&apos;t one of our prefixes is a leak, and another ISP&apos;s AS in its AS_PATH confirms it. Check the outbound filter on every eBGP session. An enterprise must never become a transit path between its ISPs.</>}
        fix={<>On R2, the outbound filter back: Cisco <Mono>router bgp 65001</Mono>, <Mono>neighbor 198.51.100.2 prefix-list OWN out</Mono> · Junos <Mono>set protocols bgp group ISP-B export OWN-ONLY</Mono>, then <Mono>commit</Mono>.</>}
        proof={<>advertised-routes lists only 192.0.2.128/26 and 192.0.2.192/26.</>}
      />
    </div>
  );
}

function LabBridge() {
  const openLab = usePracticeLabOpener();
  return (
    <PracticeBridge label="Open the BGP Lab" onPractice={openLab}>
      Same AS numbers and addresses, your own copy. Nothing you do there changes your lesson progress.
    </PracticeBridge>
  );
}

const G = { foundation: "Foundation", session: "Sessions", routes: "Routes", choose: "Choosing a path", policy: "Policy", ops: "Operations", trouble: "Troubleshooting", beyond: "Beyond this lesson", master: "Master it" };

export const BGP_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "bd-why", label: "Why BGP exists", group: G.foundation },
  { id: "bd-network", label: "The network you will study", group: G.foundation },
  { id: "bd-as", label: "ASes, eBGP and iBGP", group: G.foundation },
  { id: "bd-session", label: "A session over TCP 179", group: G.session },
  { id: "bd-msgs", label: "The message types", group: G.session },
  { id: "bd-update", label: "UPDATEs and the AS_PATH", group: G.routes },
  { id: "bd-attrs", label: "Path attributes", group: G.routes },
  { id: "bd-nexthop", label: "NEXT_HOP must resolve", group: G.routes },
  { id: "bd-loops", label: "Loop prevention and advertising", group: G.routes },
  { id: "bd-bestpath", label: "Best-path selection", group: G.choose },
  { id: "bd-rib", label: "From BGP to forwarding", group: G.choose },
  { id: "bd-policy", label: "Inbound and outbound policy", group: G.policy },
  { id: "bd-steer", label: "The way out, the way back", group: G.policy },
  { id: "bd-state", label: "The state each router keeps", group: G.ops },
  { id: "bd-verify", label: "How to verify: walk the chain", group: G.ops },
  { id: "bd-normal", label: "What healthy looks like", group: G.ops },
  { id: "bd-signatures", label: "Failure signatures", group: G.trouble },
  { id: "bd-stuck", label: "Symptom → usual cause", group: G.trouble },
  { id: "bd-workflow", label: "Investigation workflow", group: G.trouble },
  { id: "bd-faults", label: "Five faults, evidence to proof", group: G.trouble },
  { id: "bd-prove", label: "Prove the repair", group: G.trouble },
  { id: "bd-scale", label: "Larger BGP networks", group: G.beyond },
  { id: "bd-myths", label: "Common misconceptions", group: G.master },
  { id: "bd-quiz", label: "Knowledge check", group: G.master },
  { id: "bd-explain", label: "Can you explain it?", group: G.master },
  { id: "bd-practice", label: "Practice in the BGP Lab", group: G.master },
];

const QUIZ: KnowledgeQuestion[] = [
  {
    id: "q-active",
    prompt: "show ip bgp summary lists R2's neighbor 198.51.100.2 in state Active. What does that mean?",
    options: [
      { id: "a", label: "The session is up and exchanging routes" },
      { id: "b", label: "The session is not up; BGP keeps trying to connect" },
      { id: "c", label: "The neighbor is the active (primary) ISP" },
      { id: "d", label: "The neighbor is sending updates" },
    ],
    correctId: "b",
    explanation: "Despite its name, Active means the session is not Established. Only Established sessions exchange routes, with a prefix count instead of a state in the summary.",
  },
  {
    id: "q-aspath",
    prompt: "AS65030 announces 203.0.113.0/24. What AS_PATH does R1 receive from ISP-A (AS65010)?",
    options: [
      { id: "a", label: "65030" },
      { id: "b", label: "65010 65030" },
      { id: "c", label: "65001 65010 65030" },
      { id: "d", label: "An empty path" },
    ],
    correctId: "b",
    explanation: "Every eBGP hop prepends its own AS. AS65030 sends 65030, ISP-A adds 65010 in front. R1 adds 65001 only when it announces the route to another AS.",
  },
  {
    id: "q-lp",
    prompt: "R1 gives ISP-A's path LOCAL_PREF 200 and shares it over iBGP. Which exit does R2 use?",
    options: [
      { id: "a", label: "Its own ISP-B path, because eBGP beats iBGP" },
      { id: "b", label: "ISP-A via R1, because LOCAL_PREF 200 beats 100 before anything else is compared" },
      { id: "c", label: "Both, as multipath" },
      { id: "d", label: "The path with the lower MED" },
    ],
    correctId: "b",
    explanation: "LOCAL_PREF is compared first and travels inside the AS. 200 beats R2's own path at 100, so the eBGP-over-iBGP rule is never reached.",
  },
  {
    id: "q-nh",
    prompt: "R2 sees the ISP-A path with NEXT_HOP 192.0.2.2 marked inaccessible. What fixes it?",
    options: [
      { id: "a", label: "Raising LOCAL_PREF on R2" },
      { id: "b", label: "next-hop-self on R1 toward R2" },
      { id: "c", label: "Prepending toward ISP-A" },
      { id: "d", label: "Restarting the iBGP session" },
    ],
    correctId: "b",
    explanation: "iBGP passes the next hop unchanged, and R2 has no route to ISP-A's link. With next-hop-self, R1 advertises itself (10.0.12.1), which R2 reaches directly.",
  },
  {
    id: "q-prepend",
    prompt: "Which tool influences how the internet reaches AS65001?",
    options: [
      { id: "a", label: "LOCAL_PREF on R1" },
      { id: "b", label: "AS-path prepending on what R2 announces to ISP-B" },
      { id: "c", label: "next-hop-self" },
      { id: "d", label: "The router ID" },
    ],
    correctId: "b",
    explanation: "LOCAL_PREF never leaves our AS and only chooses our exit. Prepending makes our path through ISP-B look longer to others, a hint they usually follow.",
  },
  {
    id: "q-leak",
    prompt: "R2 announces 203.0.113.0/24 (learned via ISP-A) to ISP-B. What is that called, and what prevents it?",
    options: [
      { id: "a", label: "Failover; LOCAL_PREF prevents it" },
      { id: "b", label: "A route leak; an outbound filter that allows only our own prefixes" },
      { id: "c", label: "Prepending; MED prevents it" },
      { id: "d", label: "Normal transit; nothing needs to prevent it" },
    ],
    correctId: "b",
    explanation: "An enterprise is a stub. Passing one provider's routes to another offers transit through our office. Prefix-list OWN out (Junos export OWN-ONLY) announces only what is ours.",
  },
];

export function BgpDeepDiveContent() {
  return (
    <>
      <GuideSection id="bd-why" eyebrow="Foundation" title="Why BGP exists" tone="bgp">
        <p>
          OSPF works because every router in one organization trusts one map of the whole network. The internet is tens of thousands of independent organizations. None will publish its inside to the others, none will let a stranger&apos;s costs decide where its traffic goes, and each has its own business rules. <b className="text-pv-text">BGP</b> (Border Gateway Protocol, BGP-4) exchanges reachability <em>between</em> them, and lets each one decide by policy which of several paths to use.
        </p>
        <FlowSteps
          steps={[
            { title: "No shared map", body: "We can't see inside ISP-A or ISP-B, and they won't flood their topology to us.", tone: "danger" },
            { title: "Several ways out, and back", body: "Two ISPs both reach AS65030. Something must decide which one we use, and we can only influence how others reach us.", tone: "warning" },
            { title: "Policy, not just distance", body: "The cheapest-looking path isn't always the one the business wants. Contracts and costs decide.", tone: "violet" },
          ]}
        />
        <p>BGP is a <b className="text-pv-text">path-vector</b> protocol: each route carries the list of autonomous systems it crossed (the AS_PATH), not just a metric, so every AS can apply its own policy and detect loops.</p>
        <DiagramFrame caption="The AS_PATH grows as a route crosses AS boundaries.">
          <AsGraph />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="bd-network" eyebrow="Foundation" title="The network you will study" tone="cyan">
        <p>A company, AS65001, buys internet access from ISP-A (AS65010) on R1 and ISP-B (AS65020) on R2. SRV (203.0.113.10) sits in AS65030. The design: ISP-A is the primary for traffic leaving and coming back, ISP-B is the backup, and the company never carries traffic between the two ISPs.</p>
        <DiagramFrame caption="R1 is dual-homed through ISP-A, R2 through ISP-B. R1↔R2 is the enterprise's internal (iBGP) session.">
          <Topology />
        </DiagramFrame>
        <FieldTable
          title="Sessions"
          accent="bgp"
          columns={["Session", "Type", "Addresses"]}
          rows={[
            ["R1 ↔ R3 (ISP-A)", "eBGP", <Mono key="1">192.0.2.1 ↔ 192.0.2.2</Mono>],
            ["R2 ↔ R4 (ISP-B)", "eBGP", <Mono key="2">198.51.100.1 ↔ 198.51.100.2</Mono>],
            ["R1 ↔ R2", "iBGP (AS65001)", <Mono key="3">10.0.12.1 ↔ 10.0.12.2</Mono>],
          ]}
        />
        <Callout tone="cyan" title="What is simulated" icon="i">
          TCP/179, the session states, eBGP and iBGP, OPEN/KEEPALIVE/UPDATE/NOTIFICATION, NEXT_HOP, AS_PATH, LOCAL_PREF, a simplified best-path order, AS-path prepending and outbound filters. Route reflectors, communities, MP-BGP and RPKI are explained at the end, not simulated.
        </Callout>
      </GuideSection>

      <GuideSection id="bd-as" eyebrow="Foundation" title="Autonomous systems, eBGP and iBGP" tone="violet">
        <p>An AS is a network under one administration with one routing policy. AS numbers are 16-bit or 32-bit (4-byte); private ranges such as <Mono>64512–65534</Mono> are for internal use, like the <Mono>650xx</Mono> numbers here. BGP between different ASes is eBGP; BGP inside one AS, so that all its border routers know what the others learned, is iBGP.</p>
        <CompareCards
          items={[
            { title: "eBGP", tone: "bgp", tag: "between ASes", points: ["Peers in different ASes, usually directly connected", "Own AS is prepended to AS_PATH", "NEXT_HOP set to the sender's address", "Loop check: reject routes that contain your own AS"] },
            { title: "iBGP", tone: "cyan", tag: "inside an AS", points: ["Peers in the same AS, often via loopbacks", "AS_PATH and NEXT_HOP unchanged by default", "LOCAL_PREF carried", "Routes from one iBGP peer aren't sent to another"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="bd-session" eyebrow="Sessions" title="A session over TCP 179" tone="tcp">
        <p>
          BGP routers don&apos;t discover each other: each is told who its neighbors are (Cisco <Mono>neighbor 192.0.2.2 remote-as 65010</Mono> · Junos <Mono>set protocols bgp group ISP-A neighbor 192.0.2.2 peer-as 65010</Mono>). BGP has no transport of its own: the two open a TCP connection to port 179, then exchange OPEN messages carrying their AS number, Hold Time and BGP Identifier. Each checks the peer&apos;s AS against the one it was configured to expect. A KEEPALIVE from each side brings the session to <b className="text-pv-text">Established</b>.
        </p>
        <DiagramFrame caption="OPEN carries identity (AS number and BGP Identifier) plus the Hold Time; the first KEEPALIVE confirms it.">
          <SessionFlow />
        </DiagramFrame>
        <DiagramFrame caption="Stuck in Active or Connect means TCP isn't coming up; a NOTIFICATION after OPEN points at OPEN parameters.">
          <FsmDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="bd-msgs" eyebrow="Sessions" title="The message types" tone="bgp">
        <FieldTable
          title="BGP messages"
          accent="bgp"
          columns={["Message", "Purpose"]}
          rows={[
            ["OPEN", "Start a session: version, AS number, Hold Time, BGP Identifier, capabilities (e.g. 4-byte ASN, MP-BGP)"],
            ["KEEPALIVE", "Confirm the OPEN and keep the session alive within the Hold Time"],
            ["UPDATE", "Advertise new routes and/or withdraw old ones"],
            ["NOTIFICATION", "Report an error and close the session (e.g. a wrong peer AS)"],
            ["ROUTE-REFRESH", "Ask a peer to resend its routes after a policy change"],
          ]}
        />
      </GuideSection>

      <GuideSection id="bd-update" eyebrow="Routes" title="UPDATEs and the AS_PATH" tone="bgp">
        <p>
          Over an Established session, routers announce prefixes with their attributes. AS65030 announces 203.0.113.0/24; ISP-A passes it on as AS_PATH <Mono>65010 65030</Mono>. Every eBGP hop adds its own AS. Inside our AS, iBGP passes routes unchanged: no AS is added, and LOCAL_PREF travels with them.
        </p>
        <DiagramFrame caption="Withdrawals and advertisements can travel in the same message.">
          <UpdateDiagram />
        </DiagramFrame>
        <DiagramFrame caption="The guided lesson's version: ISP-B's path transits AS65100, so it is longer. In the lab, ISP-B connects straight to AS65030, both paths are two ASes long, and policy has to decide.">
          <PathsDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="bd-attrs" eyebrow="Routes" title="Path attributes" tone="violet">
        <FieldTable
          title="Common attributes"
          accent="violet"
          columns={["Attribute", "Category", "Meaning"]}
          rows={[
            ["ORIGIN", "Well-known mandatory", "How the route entered BGP: IGP, EGP or incomplete"],
            ["AS_PATH", "Well-known mandatory", "Sequence of ASes crossed; loop check and length metric"],
            ["NEXT_HOP", "Well-known mandatory", "Where to send traffic for this prefix"],
            ["LOCAL_PREF", "Well-known discretionary (iBGP only)", "AS-wide exit preference; higher wins"],
            ["MED", "Optional non-transitive", "Hint to a neighbor AS about which entry point to use; lower wins"],
            ["COMMUNITIES", "Optional transitive", "Tags that trigger policy elsewhere"],
          ]}
        />
        <Callout tone="warning" title="Weight is not a BGP attribute" icon="!">
          &quot;Weight&quot; is a Cisco-proprietary, router-local value. It is never sent to peers.
        </Callout>
      </GuideSection>

      <GuideSection id="bd-nexthop" eyebrow="Routes" title="NEXT_HOP must resolve" tone="ip">
        <p>A path is only usable if its NEXT_HOP is reachable through the routing table, often recursively: the BGP next hop through an IGP route, that route through a connected interface.</p>
        <DiagramFrame caption="Recursive resolution: BGP route → next hop → IGP route → connected interface.">
          <ResolveDiagram />
        </DiagramFrame>
        <p>That is the trap in this network: iBGP passes ISP-A&apos;s next hop (192.0.2.2) unchanged to R2, which has no route to ISP-A&apos;s link. The fix is <b className="text-pv-text">next-hop-self</b> on R1 toward R2 (Cisco <Mono>neighbor 10.0.12.2 next-hop-self</Mono> · Junos an export policy that sets <Mono>next-hop self</Mono>, here <Mono>NHS</Mono>).</p>
        <DiagramFrame caption="Without next-hop-self, R2 sees the route but can't use it.">
          <NextHopDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="bd-loops" eyebrow="Routes" title="Loop prevention and what gets advertised" tone="danger">
        <FlowSteps
          steps={[
            { title: "Between ASes: AS_PATH", body: "A router rejects any route whose AS_PATH already contains its own AS number.", tone: "bgp" },
            { title: "Inside an AS: iBGP split horizon", body: "Routes learned from an iBGP peer are not re-advertised to other iBGP peers, because AS_PATH doesn't change inside the AS.", tone: "cyan" },
            { title: "With route reflectors", body: "ORIGINATOR_ID and CLUSTER_LIST replace split horizon's safety (see the Route Reflector lesson).", tone: "violet" },
          ]}
        />
        <DiagramFrame caption="The iBGP rule that makes a full mesh (or reflection) necessary.">
          <SplitHorizonDiagram />
        </DiagramFrame>
        <ChecklistCard
          tone="cyan"
          mark="•"
          title="Default advertisement rules"
          items={["Only the best path per prefix is advertised (unless Add-Path is used).", "eBGP-learned best paths go to all peers, iBGP and eBGP.", "iBGP-learned best paths go to eBGP peers, but not to other iBGP peers.", "Outbound policy can filter or modify anything before it is sent."]}
        />
      </GuideSection>

      <GuideSection id="bd-bestpath" eyebrow="Choosing a path" title="Best-path selection" tone="success">
        <p>A router may hold several paths to 203.0.113.0/24. It ignores those whose next hop it can&apos;t reach, then compares the rest step by step: the first difference decides, and later steps are never consulted. Only the best path enters the routing table and is passed on.</p>
        <DiagramFrame caption="The lesson's simplified order.">
          <DecisionLadder />
        </DiagramFrame>
        <p>Real implementations have more steps. A common (Cisco-style) sequence:</p>
        <DiagramFrame caption="The first step that separates the candidates decides.">
          <BestPathDiagram />
        </DiagramFrame>
        <p>MED is only compared between paths from the <em>same</em> neighboring AS. ISP-A and ISP-B are different ASes, so MED plays no part in this network.</p>
      </GuideSection>

      <GuideSection id="bd-rib" eyebrow="Choosing a path" title="From BGP to forwarding" tone="ip">
        <p>BGP offers its best paths to the routing table with administrative distance 20 (eBGP) or 200 (iBGP) on Cisco, preference 170 for both on Junos. The routing table installs the winner in the forwarding table; BGP never touches packets.</p>
        <DiagramFrame caption="Only the FIB touches packets.">
          <PlanesDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="bd-policy" eyebrow="Policy" title="Inbound and outbound policy" tone="violet">
        <p>BGP is a policy protocol. Inbound policy decides what you accept and with which attributes; outbound policy decides what you announce. This network uses three policies:</p>
        <FlowSteps
          steps={[
            { title: "LOCAL_PREF 200 on what R1 learns from ISP-A", body: <>Cisco <Mono>neighbor 192.0.2.2 route-map LP200 in</Mono> · Junos <Mono>set protocols bgp group ISP-A import LP200</Mono>. Makes ISP-A the exit for the whole AS.</>, tone: "cyan" },
            { title: "Prepend our AS twice toward ISP-B", body: <>Cisco <Mono>neighbor 198.51.100.2 route-map PREPEND out</Mono> · Junos <Mono>set protocols bgp group ISP-B export PREPEND</Mono>. Makes the way in through ISP-B look longer.</>, tone: "violet" },
            { title: "Announce only our own prefixes", body: <>Cisco <Mono>neighbor 198.51.100.2 prefix-list OWN out</Mono> (and toward ISP-A) · Junos <Mono>export OWN-ONLY</Mono>. Only 192.0.2.128/26 and 192.0.2.192/26 leave our AS.</>, tone: "warning" },
          ]}
        />
        <p className="text-sm text-pv-text-muted">Prefix lists, AS-path filters, communities and route-maps / policy statements are the usual tools. RPKI origin validation adds a check that the originating AS is authorized to announce a prefix.</p>
      </GuideSection>

      <GuideSection id="bd-steer" eyebrow="Policy" title="The way out, the way back, and failover" tone="warning">
        <p><strong>The way out is our choice.</strong> R1&apos;s LOCAL_PREF 200 is shared over iBGP, so R2 also prefers ISP-A (200 beats its own ISP-B path at 100, before anything else is compared). Without that policy both paths would tie on LOCAL_PREF and AS_PATH length, and each router would fall through to eBGP over iBGP and use its own ISP.</p>
        <p><strong>The way back is other networks&apos; choice.</strong> LOCAL_PREF never leaves our AS. AS65030 sees <Mono>65010 65001</Mono> through ISP-A and <Mono>65020 65001 65001 65001</Mono> through ISP-B, and prefers ISP-A. Prepending is a hint, not a guarantee.</p>
        <p><strong>Failover.</strong> When ISP-A&apos;s link goes down, R1 loses the session and withdraws its path. R2&apos;s ISP-B path becomes best, R2 tells R1, and traffic leaves via R2. That works only if the backup session was Established all along.</p>
        <CompareCards
          items={[
            { title: "Outbound (you choose your exit)", tone: "violet", tag: "strong", points: ["LOCAL_PREF across your AS", "Weight on a single router (Cisco)"] },
            { title: "Inbound (others choose)", tone: "warning", tag: "influence only", points: ["AS-path prepending on your announcements", "MED toward one neighbor AS", "More-specific prefixes, communities agreed with the ISP"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="bd-state" eyebrow="Operations" title="The state each router keeps" tone="cyan">
        <FlowSteps
          steps={[
            { title: "Its sessions", body: "Each neighbor, its AS, the session state (Established, Active, Idle) and how many prefixes it sent.", tone: "violet" },
            { title: "Every path it received", body: "Per prefix: AS_PATH, NEXT_HOP, LOCAL_PREF, whether it is usable, and which one is best (and why the others lost).", tone: "warning" },
            { title: "What it announces", body: "Per neighbor: the prefixes it sends, with the AS_PATH the neighbor will see.", tone: "cyan" },
            { title: "The routing table", body: "The best path for each prefix, offered to forwarding.", tone: "success" },
          ]}
        />
      </GuideSection>

      <GuideSection id="bd-verify" eyebrow="Operations" title="How to verify: session, path, announcement, table" tone="success">
        <FlowSteps
          steps={[
            { title: "Is every session Established?", body: <>Cisco <Mono>show ip bgp summary</Mono> · Junos <Mono>show bgp summary</Mono>; for one peer, <Mono>show ip bgp neighbors 198.51.100.2</Mono> · <Mono>show bgp neighbor 198.51.100.2</Mono> (Last Error).</>, tone: "violet" },
            { title: "Which paths, and why did the best win?", body: <>Cisco <Mono>show ip bgp 203.0.113.0</Mono> · Junos <Mono>show route 203.0.113.0/24 detail</Mono> (Inactive reason).</>, tone: "warning" },
            { title: "What do we announce, and how does the internet see us?", body: <>Cisco <Mono>show ip bgp neighbors 192.0.2.2 advertised-routes</Mono> · Junos <Mono>show route advertising-protocol bgp 198.51.100.2</Mono>; the looking glass on R5: <Mono>show ip bgp 192.0.2.128</Mono>.</>, tone: "cyan" },
            { title: "What does the routing table use?", body: <>Cisco <Mono>show ip route 203.0.113.10</Mono> · Junos <Mono>show route 203.0.113.10</Mono>.</>, tone: "success" },
          ]}
        />
        <p>Then prove it with traffic: traceroutes from inside (the way out) and from SRV (the way back), then cut ISP-A and trace again. Cisco logs session changes and refusals (<Mono>show logging</Mono>).</p>
      </GuideSection>

      <GuideSection id="bd-normal" eyebrow="Operations" title="What healthy BGP looks like on the routers" tone="success">
        <NormalState />
      </GuideSection>

      <GuideSection id="bd-signatures" eyebrow="Troubleshooting" title="Failure signatures: sessions, paths and policies" tone="danger">
        <p>BGP faults reach you as &quot;the wrong ISP is used&quot;, &quot;the internet comes back the wrong way&quot;, &quot;failover didn&apos;t work&quot;, or a call from an ISP:</p>
        <FailureSignatures
          items={[
            { tag: "remote-as", title: "A wrong remote AS", tone: "danger", points: ["Summary: Active, never a prefix count", "Log: %BGP-3-NOTIFICATION … peer in wrong AS · Junos: Bad Peer AS", "Often invisible until the other ISP fails"] },
            { tag: "next-hop", title: "A next hop that can't be reached", tone: "warning", points: ["Session Established, path received", "show ip bgp: (inaccessible) · Junos: Next hop type Unusable", "Fix: next-hop-self toward the iBGP peer"] },
            { tag: "policy", title: "A policy missing or on the wrong neighbor", tone: "violet", points: ["Everything up, traffic uses the wrong ISP", "LOCAL_PREF equal (out) or prepend toward the primary (in)", "Compare the paths' attributes, not the sessions"] },
            { tag: "leak", title: "A route leak", tone: "ip", points: ["advertised-routes to an ISP lists a prefix that isn't ours", "AS_PATH shows the other ISP's AS behind ours", "Fix: prefix-list OWN out / export OWN-ONLY"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="bd-stuck" eyebrow="Troubleshooting" title="Symptom → usual cause" tone="danger">
        <FieldTable
          title="Where it breaks"
          accent="danger"
          columns={["Symptom", "Usual cause"]}
          rows={[
            ["Stuck in Active/Connect", "No TCP: wrong neighbor IP, no route to it, ACL/firewall on 179, wrong update-source"],
            ["NOTIFICATION after OPEN", "Wrong remote AS, bad BGP ID, unsupported capability or authentication mismatch"],
            ["Established, 0 prefixes", "Inbound filter, nothing advertised, or wrong address family"],
            ["Path in BGP but not in the routing table", "NEXT_HOP unreachable, or a better route from another protocol"],
            ["Unexpected exit path", "LOCAL_PREF or weight policy, or tie-breakers you didn't expect"],
          ]}
        />
      </GuideSection>

      <GuideSection id="bd-workflow" eyebrow="Troubleshooting" title="Investigation workflow: walk the chain" tone="danger">
        <TroubleshootingFlow
          steps={[
            { question: "No reply at all, or the wrong ISP, leaving or coming back?", look: "ping for reachability; traceroute from inside (the way out) and from the server side (the way back)." },
            { question: "Is every session Established?", look: "show ip bgp summary / show bgp summary. Active means not up: check remote-as against the neighbor's real AS (show logging: peer in wrong AS), shutdown, the link." },
            { question: "Does the router have the paths, and are they usable?", look: "show ip bgp <prefix> / show route <prefix> detail: (inaccessible) or Unusable next hop means next-hop-self is missing on the iBGP peer." },
            { question: "Which attribute decided?", look: "Compare LOCAL_PREF first, then AS_PATH length, then eBGP/iBGP. Junos names it: Inactive reason." },
            { question: "What do we announce, and to whom?", look: "advertised-routes / advertising-protocol: only our prefixes to each ISP, prepending only toward the backup." },
          ]}
        />
      </GuideSection>

      <GuideSection id="bd-faults" eyebrow="Troubleshooting" title="Five faults, from evidence to proof" tone="danger">
        <FaultWalks />
      </GuideSection>

      <GuideSection id="bd-prove" eyebrow="Troubleshooting" title="Prove the repair with fresh traffic" tone="success">
        <ChecklistCard
          tone="success"
          title="The proof, every time"
          mark="✓"
          items={[
            "Repeat the exact test that failed, and see it succeed",
            "Every session on a working link is Established",
            "The best path on R1 and R2 is the designed one (via ISP-A), for the designed reason (LOCAL_PREF)",
            "We announce only our two prefixes, prepended only toward ISP-B; the looking glass prefers ISP-A",
            "Traceroutes out and back go through ISP-A; cut ISP-A and the traffic fails over to ISP-B",
          ]}
        />
        <p>The lab&apos;s tickets check exactly this: a ticket only closes when the routers&apos; state is right <em>and</em> a fresh run of the user&apos;s test succeeds.</p>
      </GuideSection>

      <GuideSection id="bd-scale" eyebrow="Beyond this lesson" title="Larger BGP networks" tone="violet">
        <FlowSteps
          steps={[
            { title: "Route reflectors", body: "iBGP split horizon needs a full mesh between all BGP routers of an AS. A route reflector re-advertises iBGP routes to its clients instead (the Route Reflector lesson).", tone: "violet" },
            { title: "Communities", body: "Tags attached to routes, such as \"do not announce to peers\" or \"lower my LOCAL_PREF\", that an ISP's policy acts on.", tone: "cyan" },
            { title: "RPKI origin validation", body: "Signed records saying which AS may originate a prefix; routers can reject announcements from the wrong origin.", tone: "success" },
            { title: "MP-BGP", body: "The same protocol carrying other address families: IPv6, VPN routes, EVPN.", tone: "warning" },
          ]}
        />
      </GuideSection>

      <GuideSection id="bd-myths" eyebrow="Master it" title="Common misconceptions" tone="warning">
        <Misconceptions
          items={[
            { myth: "Active means the session is working.", correction: "Active means BGP is trying to connect. Only Established exchanges routes." },
            { myth: "BGP discovers its neighbors.", correction: "Every neighbor is configured, with the AS it must have. A wrong remote-as keeps the session down." },
            { myth: "BGP picks the shortest path by link cost.", correction: "It is policy-first: LOCAL_PREF, then AS_PATH length, then more tie-breakers. No link costs are involved." },
            { myth: "LOCAL_PREF tells the internet how to reach us.", correction: "LOCAL_PREF never leaves our AS; it chooses our exit. The way in is influenced with prepending, MED or communities." },
            { myth: "If a router has the path, it can use it.", correction: "Only if its NEXT_HOP is reachable. Over iBGP that usually needs next-hop-self." },
            { myth: "BGP forwards packets.", correction: "BGP chooses paths. The routing table and forwarding table move packets." },
          ]}
        />
      </GuideSection>

      <GuideSection id="bd-quiz" eyebrow="Master it" title="Knowledge check" tone="success">
        <KnowledgeQuiz questions={QUIZ} />
      </GuideSection>

      <GuideSection id="bd-explain" eyebrow="Master it" title="Can you explain it?" tone="success">
        <ExplainIt
          items={[
            { q: "Why does R2 use ISP-A although it has its own eBGP path to ISP-B?", a: "R1 sets LOCAL_PREF 200 on ISP-A's path and shares it over iBGP. LOCAL_PREF is compared first, and 200 beats R2's own path at 100, so the eBGP-over-iBGP rule is never reached." },
            { q: "Why can a wrong remote-as on R2 stay unnoticed for weeks?", a: "Traffic leaves through ISP-A anyway, so the down backup session changes nothing visible. It only shows when ISP-A fails and there is no path left." },
            { q: "Why does prepending on R1 instead of R2 bring traffic in the wrong way?", a: "Prepending makes the path through the ISP it is applied to look longer. Applied toward ISP-A, the primary looks worse, and the internet comes back through ISP-B." },
            { q: "Why is an outbound filter needed on an enterprise with two ISPs?", a: "Without it, each router announces its best paths, including routes learned from the other ISP, to its ISP. That offers transit between two providers through the office: a route leak." },
          ]}
        />
      </GuideSection>

      <GuideSection id="bd-practice" eyebrow="Practice" title="Practice in the BGP Lab" tone="cyan">
        <ChecklistCard
          tone="cyan"
          title="In the lab you will"
          mark="→"
          items={[
            "Read an UPDATE and follow its AS_PATH",
            "Make ISP-B the primary without cutting anything, and bring traffic in through ISP-B",
            "Lose ISP-A without losing the internet",
            "Cause and stop a route leak, and break a session on purpose and read why",
            "Solve five tickets from evidence, on Cisco IOS or Junos, and prove each repair",
          ]}
        />
        <PresentationBridge>See OPENs, UPDATEs growing their AS_PATH, LOCAL_PREF picking the exit and prepending steering the way back in the BGP presentation.</PresentationBridge>
        <LabBridge />
      </GuideSection>
    </>
  );
}
