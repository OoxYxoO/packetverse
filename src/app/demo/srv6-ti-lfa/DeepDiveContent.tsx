import { CompareCards, DArrow, DIAGRAM as D, DNode, DPill, DiagramFrame, DiagramSvg, FailureSignatures, FieldTable, Glossary, GuideSection, Misconceptions, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { DHeaderColumn } from "@/components/lesson/Srv6GuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { ExplainIt, KnowledgeQuiz, PracticeBridge, type KnowledgeQuestion } from "@/components/lesson/GuideInteractive";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import { PresentationBridge } from "@/components/presentation/LessonPresentation";
import { CliPanel, FailureWalk } from "@/components/lesson/GuideCli";
import { createT6Net, t6Apply, type T6State } from "@/lib/sim-engine/scenarios/s6tNet";
import { T6Result, t6Block, t6Cli, t6Drill, t6Only, t6Set, t6TicketRun } from "./LessonGuideContent";

const G = { foundation: "Foundation", compute: "Computing the repair", data: "Data plane", scope: "Scope and timing", ops: "Operations", trouble: "Troubleshooting", master: "Master it" };
export const SRV6T_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "rd-why", label: "Why local repair", group: G.foundation },
  { id: "rd-family", label: "LFA, remote LFA and TI-LFA", group: G.foundation },
  { id: "rd-post", label: "The post-convergence path", group: G.compute },
  { id: "rd-spaces", label: "P-space, Q-space, extended P-space", group: G.compute },
  { id: "rd-encode", label: "Encoding the path as SIDs", group: G.compute },
  { id: "rd-shapes", label: "Repair list shapes", group: G.compute },
  { id: "rd-endx", label: "End vs End.X in a repair", group: G.data },
  { id: "rd-flavors", label: "USD vs PSP vs USP", group: G.data },
  { id: "rd-nesting", label: "Protecting SRv6 services", group: G.data },
  { id: "rd-scope", label: "Link, node and SRLG protection", group: G.scope },
  { id: "rd-detect", label: "Failure detection", group: G.scope },
  { id: "rd-timing", label: "Timing and micro-loops", group: G.scope },
  { id: "rd-mpls", label: "SRv6 vs SR-MPLS encoding", group: G.scope },
  { id: "rd-config", label: "Configuring it on IOS XR", group: G.ops },
  { id: "rd-verify", label: "How to verify", group: G.ops },
  { id: "rd-signatures", label: "Failure signatures", group: G.trouble },
  { id: "rd-ladder", label: "The troubleshooting ladder", group: G.trouble },
  { id: "rd-tickets", label: "Five faults, evidence to proof", group: G.trouble },
  { id: "rd-myths", label: "Common misconceptions", group: G.master },
  { id: "rd-quiz", label: "Knowledge check", group: G.master },
  { id: "rd-explain", label: "Can you explain it?", group: G.master },
  { id: "rd-glossary", label: "Glossary", group: G.master },
  { id: "rd-mental", label: "Mental model", group: G.master },
  { id: "rd-practice", label: "Practice in the SRv6 TI-LFA Lab", group: G.master },
];

// Real IOS XR output and drill results: the SRv6 TI-LFA Lab's command set and model.
const T0: T6State = createT6Net(0);
const T = { notilfa: t6TicketRun("notilfa"), p4srv6: t6TicketRun("p4srv6"), node: t6TicketRun("node"), bfd: t6TicketRun("bfd"), reverse: t6TicketRun("reverse") };
const NOSID = [t6Set("P4-PE2 15", "P4", (c) => void (c.ifs["ge-0/0/2"]!.metric = 15)), t6Set("PE2-P4 15", "PE2", (c) => void (c.ifs["ge-0/0/1"]!.metric = 15))].reduce((acc, a) => t6Apply(acc, a), T0);
const LFA = t6Apply(t6Apply(NOSID, t6Set("lfa only", "P1", (c) => void (c.ifs["ge-0/0/1"]!.tilfa = false))), t6Drill({ link: "P1-P2" }));
const P2PE2 = t6Apply(T0, t6Drill({ link: "P2-PE2" }));

function LabBridge() {
  const openLab = usePracticeLabOpener();
  return (
    <PracticeBridge label="Open the SRv6 TI-LFA Lab" onPractice={openLab}>
      Every router&apos;s backups and SIDs on IOS XR, drills of any link or router failure, hand-built repairs to compare, five tickets — your own copy. Nothing you do there changes your lesson progress.
    </PracticeBridge>
  );
}

function FamilyDiagram() {
  const col = (x: number, title: string, sub: string, color: string, reach: string) => (
    <g>
      <DNode x={x} y={36} label={title} sub={sub} accent={color} w={180} />
      <rect x={x - 90} y={70} width={180} height={62} rx={10} fill={color} fillOpacity={0.08} stroke={color} strokeOpacity={0.5} strokeDasharray="5 4" />
      <text x={x} y={96} textAnchor="middle" fill={D.text} fontSize={10.5} fontWeight={700}>
        backup reach
      </text>
      <text x={x} y={116} textAnchor="middle" fill={D.muted} fontSize={10}>
        {reach}
      </text>
    </g>
  );
  return (
    <DiagramSvg h={170} label="LFA uses a directly connected loop-free neighbor; Remote LFA tunnels to a PQ node; TI-LFA uses a segment list to reach any post-convergence path">
      {col(110, "LFA", "RFC 5286", D.faint, "one neighbor, if loop-free")}
      {col(320, "Remote LFA", "RFC 7490", D.ip, "a PQ node, if one exists")}
      {col(530, "TI-LFA", "RFC 9855", D.success, "the post-convergence path")}
      <text x={320} y={158} textAnchor="middle" fill={D.muted} fontSize={10}>
        coverage grows left to right — TI-LFA can steer where no single loop-free neighbor or PQ node exists
      </text>
    </DiagramSvg>
  );
}

function SpacesDiagram() {
  return (
    <DiagramSvg h={206} label="P-Space is computed from the PLR's shortest-path tree, Extended P-Space adds nodes reachable from the PLR's neighbors, Q-Space is computed from the reverse tree toward the destination; a PQ node lies in both">
      <ellipse cx={230} cy={92} rx={160} ry={66} fill={D.cyan} fillOpacity={0.08} stroke={D.cyan} strokeOpacity={0.7} strokeDasharray="6 5" />
      <ellipse cx={200} cy={92} rx={110} ry={48} fill={D.violet} fillOpacity={0.08} stroke={D.violet} strokeOpacity={0.7} />
      <ellipse cx={420} cy={92} rx={140} ry={60} fill={D.success} fillOpacity={0.08} stroke={D.success} strokeOpacity={0.7} strokeDasharray="6 5" />
      <text x={150} y={62} fill={D.violet} fontSize={11} fontWeight={700}>
        P-Space
      </text>
      <text x={70} y={178} fill={D.cyan} fontSize={10.5} fontWeight={700}>
        dashed cyan = Extended P-Space
      </text>
      <text x={470} y={62} fill={D.success} fontSize={11} fontWeight={700}>
        Q-Space
      </text>
      <DPill x={335} y={96} text="PQ node" color={D.warning} w={78} />
      <text x={320} y={198} textAnchor="middle" fill={D.muted} fontSize={10}>
        P from the PLR&apos;s SPT (resource excluded) · Q from the reverse SPT toward the destination
      </text>
    </DiagramSvg>
  );
}

function ShapesDiagram() {
  const row = (y: number, label: string, list: string, color: string) => (
    <g>
      <text x={24} y={y + 17} fill={D.text} fontSize={11} fontWeight={700}>
        {label}
      </text>
      <rect x={250} y={y} width={366} height={26} rx={7} fill={color} fillOpacity={0.12} stroke={color} strokeOpacity={0.7} />
      <text x={433} y={y + 17} textAnchor="middle" fill={color} fontSize={10.5} fontWeight={700} fontFamily="monospace">
        {list}
      </text>
    </g>
  );
  return (
    <DiagramSvg h={160} label="Three repair list shapes: a PQ node reachable directly needs one End SID; P and Q adjacent needs an End.X SID at the last P node; P and Q far apart need several SIDs">
      {row(20, "PQ node exists", "⟨End(PQ)⟩", D.success)}
      {row(56, "P and Q are neighbors", "⟨End.X(P → Q)⟩  (globally routed)", D.violet)}
      {row(92, "P and Q further apart", "⟨SID₁, …, SIDₙ⟩ → needs an SRH", D.warning)}
      <text x={320} y={146} textAnchor="middle" fill={D.muted} fontSize={10}>
        the lesson&apos;s main repair is the middle shape; its multi-SID lab shows the bottom one
      </text>
    </DiagramSvg>
  );
}

function EndVsEndXDiagram() {
  return (
    <DiagramSvg h={200} label="An End SID delivers the packet to its owner and the owner's normal routing decides what happens next; an End.X SID additionally forces one specific outgoing adjacency">
      <DNode x={110} y={40} label="End SID" sub="owner's locator" accent={D.ip} w={150} />
      <DArrow x1={185} y1={40} x2={300} y2={40} color={D.ip} label="routed to owner" />
      <DNode x={380} y={40} label="Owner" sub="then its own FIB" accent={D.ip} w={150} />
      <text x={560} y={45} textAnchor="middle" fill={D.muted} fontSize={10}>
        no bound adjacency
      </text>
      <DNode x={110} y={128} label="End.X SID" sub="owner's locator" accent={D.violet} w={150} />
      <DArrow x1={185} y1={128} x2={300} y2={128} color={D.violet} label="routed to owner" />
      <DNode x={380} y={128} label="Owner" sub="bound adjacency" accent={D.violet} w={150} />
      <DArrow x1={455} y1={128} x2={560} y2={128} color={D.violet} label="forced link" />
      <text x={320} y={188} textAnchor="middle" fill={D.muted} fontSize={10}>
        only End.X pins the next hop — one End.X SID per bound adjacency
      </text>
    </DiagramSvg>
  );
}

function FlavorsDiagram() {
  return (
    <DiagramSvg h={200} label="PSP removes the SRH at the penultimate segment, USP removes it at the ultimate segment, USD removes the whole outer IPv6 header and exposes the inner packet">
      <text x={110} y={20} textAnchor="middle" fill={D.text} fontSize={11.5} fontWeight={700}>
        PSP
      </text>
      <DHeaderColumn x={110} y={30} w={170} rows={[{ text: "outer IPv6", color: D.ip }, { text: "SRH removed", color: D.faint }, { text: "payload", color: D.ip }]} caption="at the penultimate segment" />
      <text x={320} y={20} textAnchor="middle" fill={D.text} fontSize={11.5} fontWeight={700}>
        USP
      </text>
      <DHeaderColumn x={320} y={30} w={170} rows={[{ text: "outer IPv6", color: D.ip }, { text: "SRH removed", color: D.faint }, { text: "payload", color: D.ip }]} caption="at the ultimate segment" />
      <text x={530} y={20} textAnchor="middle" fill={D.text} fontSize={11.5} fontWeight={700}>
        USD
      </text>
      <DHeaderColumn x={530} y={30} w={170} rows={[{ text: "outer IPv6 removed", color: D.faint }, { text: "+ its extensions", color: D.faint }, { text: "inner packet exposed", color: D.success, strong: true }]} caption="at the ultimate segment" />
      <text x={320} y={186} textAnchor="middle" fill={D.muted} fontSize={10}>
        a TI-LFA repair outer is a whole encapsulation — only USD removes it completely
      </text>
    </DiagramSvg>
  );
}

function TimingDiagram() {
  const seg = (x: number, w: number, label: string, color: string) => (
    <g>
      <rect x={x} y={60} width={w} height={30} rx={6} fill={color} fillOpacity={0.18} stroke={color} strokeOpacity={0.8} />
      <text x={x + w / 2} y={79} textAnchor="middle" fill={color} fontSize={10.5} fontWeight={700}>
        {label}
      </text>
    </g>
  );
  return (
    <DiagramSvg h={160} label="Timeline: steady state, failure detected, TI-LFA active until every router converges, then post-convergence forwarding; micro-loops can appear while routers converge at different times">
      <DArrow x1={24} y1={120} x2={620} y2={120} color={D.faint} label="time" labelDy={18} />
      {seg(24, 110, "steady", D.success)}
      {seg(138, 60, "detect", D.danger)}
      {seg(202, 250, "TI-LFA repair active", D.warning)}
      {seg(456, 164, "post-convergence", D.ospf)}
      <text x={327} y={44} textAnchor="middle" fill={D.muted} fontSize={10}>
        other routers converge in any order here → micro-loop risk (a separate mechanism)
      </text>
    </DiagramSvg>
  );
}

function NestingDiagram() {
  return (
    <DiagramSvg h={170} label="A TI-LFA repair outer is added around whatever SRv6 packet is protected: a policy packet with its SRH, or a service packet; the repair node removes only the repair outer">
      <DHeaderColumn
        x={320}
        y={20}
        w={330}
        rows={[
          { text: "repair outer · SA = PLR · DA = repair SID", color: D.warning, tag: "TI-LFA", strong: true },
          { text: "protected SRv6 packet (any: policy, VPN, transport)", color: D.bgp, tag: "UNTOUCHED" },
          { text: "its own payload", color: D.ip },
        ]}
      />
      <text x={320} y={130} textAnchor="middle" fill={D.muted} fontSize={10}>
        the repair never edits the protected packet&apos;s DA, SRH or Segments Left
      </text>
    </DiagramSvg>
  );
}


const QUIZ: KnowledgeQuestion[] = [
  { id: "q-plr", prompt: "Who repairs CE1 → CE2 traffic when P1–P2 fails?", options: [{ id: "a", label: "P1, the router in front of the failure" }, { id: "b", label: "PE1, the headend" }, { id: "c", label: "Every router after convergence" }], correctId: "a", explanation: "The PLR switches locally, before convergence." },
  { id: "q-stale", prompt: "Why can't P1 simply send PE2's traffic to P3?", options: [{ id: "a", label: "P3's not-yet-converged route to PE2 points back to P1" }, { id: "b", label: "P3 has no link to P4" }, { id: "c", label: "SRv6 forbids it" }], correctId: "a", explanation: "Stale tables loop the packet until convergence." },
  { id: "q-endx", prompt: "Why does the repair use P4's End.X and not P4's End?", options: [{ id: "a", label: "P4's own old path toward P2 goes back via P1; End.X forces the P4–P2 link" }, { id: "b", label: "End can't be the last segment" }, { id: "c", label: "End.X is shorter" }], correctId: "a", explanation: "P4 is in P-space but not in Q-space." },
  { id: "q-usd", prompt: "What does USD do at P4?", options: [{ id: "a", label: "Removes the repair's outer header and sends the exposed packet out of the forced link" }, { id: "b", label: "Removes the inner VPN header" }, { id: "c", label: "Pops an MPLS label" }], correctId: "a", explanation: "Ultimate segment decapsulation of the repair encapsulation." },
  { id: "q-node", prompt: "P1–P2 cut: 165 ms. P2 reload: 950 ms. Likely cause?", options: [{ id: "a", label: "P1's protection is link-only — the repair merges at the dead P2" }, { id: "b", label: "BFD is off" }, { id: "c", label: "P2 has no TI-LFA" }], correctId: "a", explanation: "Node protection avoids the next-hop router." },
  { id: "q-bfd", prompt: "A DWDM span fails, the backup exists, and the outage is 30 s. Why?", options: [{ id: "a", label: "No BFD: detection waits for the IS-IS hold time" }, { id: "b", label: "The backup is wrong" }, { id: "c", label: "Micro-loops" }], correctId: "a", explanation: "Repair is only as fast as detection." },
];

export function Srv6TiLfaDeepDiveContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="rd-why" eyebrow="Foundation" title="Why local repair" tone="danger">
        <p>An IGP repairs every failure eventually: the routers adjacent to it flood new LSPs, every router reruns SPF and reprograms its forwarding table. That takes hundreds of milliseconds across a real network — longer for large tables — and traffic crossing the failure is lost throughout. Fast reroute shortens the outage to <b className="text-pv-text">detection + a local switch</b>: the router next to the failure (the PLR) has a backup already installed in hardware and uses it the instant it knows. Convergence still happens; it just stops mattering for the customer.</p>
      </GuideSection>

      <GuideSection id="rd-family" eyebrow="Foundation" title="LFA, remote LFA and TI-LFA" tone="violet">
        <DiagramFrame caption="Three generations of IP fast reroute.">
          <FamilyDiagram />
        </DiagramFrame>
        <FieldTable
          title="How each finds a safe path"
          accent="violet"
          columns={["Mechanism", "Idea", "Limitation"]}
          rows={[
            ["Classic LFA (RFC 5286)", "a neighbor whose own shortest path to the destination doesn't come back", "often none exists (none here, until metrics change)"],
            ["Remote LFA (RFC 7490)", "tunnel to a remote node in P ∩ Q", "needs a node in both spaces; not always the post-convergence path"],
            ["TI-LFA (RFC 9855)", "force the post-convergence path with segments", "needs segment routing on the routers the repair names"],
          ]}
        />
        <p>The lab can show the classic case too: lower P4–PE2 to 15 on both ends and P3&apos;s own path to PE2 stops coming back through P1 — an LFA appears, and even TI-LFA&apos;s repair shrinks to “just the outgoing interface”.</p>
        <T6Result s={LFA} title="The lab: classic LFA after a metric change (TI-LFA off on P1)" />
      </GuideSection>

      <GuideSection id="rd-post" eyebrow="Computing the repair" title="The post-convergence path" tone="cyan">
        <p>TI-LFA&apos;s defining choice is to send traffic, during the repair, along the path it will take <b className="text-pv-text">after</b> convergence: the PLR runs SPF with the protected resource removed and takes its path to the destination. Repairing onto the final path avoids a second change when convergence completes, keeps the repair on links the operator expects to carry that traffic, and is always available when any path exists.</p>
        <CliPanel run={t6Only(T0, "P1", "show route ipv6 2001:db8:110:2::", /Routing entry|via GigabitEthernet|SRv6 Headend|metric is/)} caption="IOS XR · P1 — primary (metric 20) and post-convergence backup (metric 90, node-protecting)" />
      </GuideSection>

      <GuideSection id="rd-spaces" eyebrow="Computing the repair" title="P-space, Q-space, extended P-space" tone="warning">
        <DiagramFrame caption="Where the PLR can send safely; where the destination is reached safely.">
          <SpacesDiagram />
        </DiagramFrame>
        <p>The <b className="text-pv-text">P-space</b> of the PLR holds nodes it reaches without the protected resource; the <b className="text-pv-text">extended P-space</b> adds nodes any of the PLR&apos;s neighbors reach that way. The <b className="text-pv-text">Q-space</b> holds nodes whose shortest path to the destination avoids the resource. Where they meet, a single segment would do; where they don&apos;t, an adjacency segment bridges the gap — here from P4 (P-space) to P2 (Q-space).</p>
      </GuideSection>

      <GuideSection id="rd-encode" eyebrow="Computing the repair" title="Encoding the path as SIDs" tone="mpls">
        <p>The repair is the post-convergence path compressed against the pre-failure shortest paths: walk the path; wherever the old shortest path already follows it, one End SID of the furthest such node suffices; wherever it doesn&apos;t, an End.X forces the next link. The PLR&apos;s own first hop needs no SID at all — it is the backup outgoing interface. And [End X, End.X X→Y] collapses to End.X X→Y, because the End.X SID is routed to X&apos;s locator anyway.</p>
        <FieldTable
          title="The lab's repairs"
          accent="mpls"
          columns={["PLR · failure", "Post-convergence path", "Repair"]}
          rows={[
            ["P1 · link P1–P2", "P1 → P3 → P4 → P2 → PE2", <Mono key="1">OIF → P3, [P4 End.X → P2]</Mono>],
            ["P1 · node P2", "P1 → P3 → P4 → PE2", <Mono key="2">OIF → P3, [P4 End.X → PE2]</Mono>],
            ["P2 · link P2–P1 (replies)", "P2 → P4 → P3 → P1 → PE1", <Mono key="3">OIF → P4, no SID</Mono>],
            ["P2 · link P2–PE2", "P2 → P1 → P3 → P4 → PE2", <Mono key="4">OIF → P1, [P4 End.X → PE2]</Mono>],
          ]}
        />
        <T6Result s={P2PE2} title="The lab: a P2–PE2 cut — a different PLR, the same repair SID" />
      </GuideSection>

      <GuideSection id="rd-shapes" eyebrow="Computing the repair" title="Repair list shapes" tone="violet">
        <DiagramFrame caption="Zero, one or several SIDs, depending on the topology.">
          <ShapesDiagram />
        </DiagramFrame>
        <p>No SID (the backup neighbor is already safe — an LFA in TI-LFA clothing); one SID (the common case, fits in the destination address, no SRH); several SIDs (longer detours, an SRH after the first). Longer lists cost header bytes and, on some hardware, encapsulation depth; uSIDs compress them.</p>
      </GuideSection>

      <GuideSection id="rd-endx" eyebrow="Data plane" title="End vs End.X in a repair" tone="violet">
        <DiagramFrame caption="End trusts the node's routing; End.X forces the link.">
          <EndVsEndXDiagram />
        </DiagramFrame>
        <p>An End SID hands the packet to the owner&apos;s routing table — fine when that node&apos;s (possibly stale) path is safe. An End.X SID forces one adjacency regardless of the table — required when the node is in P-space but its path to the destination is not yet safe.</p>
      </GuideSection>

      <GuideSection id="rd-flavors" eyebrow="Data plane" title="USD vs PSP vs USP" tone="warning">
        <DiagramFrame caption="What the endpoint does with the outer header and SRH.">
          <FlavorsDiagram />
        </DiagramFrame>
        <p>PSP pops the SRH at the penultimate segment; USP removes it at the last; <b className="text-pv-text">USD</b> removes the whole outer IPv6 header at the last segment and processes the exposed packet. With H.Encaps repairs, USD at the last repair SID is what returns the original packet to the network unchanged. IOS XR allocates End/End.X with PSP and USD together.</p>
        <CliPanel run={t6Only(T0, "P4", "show segment-routing srv6 sid", /^SID|^---|End\.X/)} caption="IOS XR · P4 — End.X (PSP/USD)" />
      </GuideSection>

      <GuideSection id="rd-nesting" eyebrow="Data plane" title="Protecting SRv6 services" tone="ip">
        <DiagramFrame caption="The repair wraps whatever the protected packet already is.">
          <NestingDiagram />
        </DiagramFrame>
        <p>The protected traffic here is already an SRv6 L3VPN packet (DA = PE2&apos;s End.DT4). The repair simply adds an outer header; USD at P4 removes it; the VPN packet continues and PE2 executes its service SID as if nothing happened. Protection is transparent to the service — and the customer.</p>
      </GuideSection>

      <GuideSection id="rd-scope" eyebrow="Scope and timing" title="Link, node and SRLG protection" tone="danger">
        <CompareCards
          items={[
            { title: "Link", tone: "warning", tag: "default", points: ["avoid the failed link", "may merge at the next-hop router"] },
            { title: "Node", tone: "danger", tag: "tiebreaker", points: ["avoid the next-hop router", "falls back to link if impossible"] },
            { title: "SRLG", tone: "violet", tag: "shared risk", points: ["avoid every link sharing a conduit/system", "needs SRLG data in the IGP"] },
          ]}
        />
        <p>Node protection costs nothing when the router stays up — the repair still avoids the failed link — so it is the usual choice. Where no node-avoiding path exists (P1&apos;s only path to PE1 is the PE1–P1 link), there is simply no backup.</p>
        <CliPanel run={t6Only(T.node, "P1", "show isis fast-reroute 2001:db8:110:2::/64 detail", /Backup path|node:|NP:/)} caption="IOS XR · P1 without the node-protecting tiebreaker — a link repair that merges at P2" />
      </GuideSection>

      <GuideSection id="rd-detect" eyebrow="Scope and timing" title="Failure detection" tone="warning">
        <FieldTable
          title="How the PLR learns about the failure"
          accent="warning"
          columns={["Method", "Lab time", "When"]}
          rows={[
            ["Loss of light / interface down", "10 ms", "direct fiber, router failure"],
            ["BFD", "150 ms (50 ms × 3)", "links whose interfaces stay up: DWDM, L2 transport"],
            ["IS-IS hold time", "30 s", "silent failures without BFD"],
          ]}
        />
        <CliPanel run={t6Cli(T0, "P1", "show isis adjacency")} caption="IOS XR · P1 — the IPv6 BFD column shows which adjacencies are guarded" />
      </GuideSection>

      <GuideSection id="rd-timing" eyebrow="Scope and timing" title="Timing and micro-loops" tone="cyan">
        <DiagramFrame caption="Detection, local switch, convergence.">
          <TimingDiagram />
        </DiagramFrame>
        <p>After the local switch, convergence still runs. Routers update at slightly different moments, and for a few milliseconds two of them can point at each other — a <b className="text-pv-text">micro-loop</b>. That is a convergence problem, not a TI-LFA one; segment-routing micro-loop avoidance keeps traffic on the repair path until convergence settles. The lab models the protected interval, not micro-loops.</p>
      </GuideSection>

      <GuideSection id="rd-mpls" eyebrow="Scope and timing" title="SRv6 vs SR-MPLS encoding" tone="mpls">
        <CompareCards
          items={[
            { title: "SR-MPLS TI-LFA", tone: "mpls", tag: "labels", points: ["push Node/Adjacency SID labels", "label stack depth limits", "PHP and label rules"] },
            { title: "SRv6 TI-LFA", tone: "ip", tag: "SIDs", points: ["H.Encaps (or H.Insert) with SRv6 SIDs", "first SID in the DA, rest in an SRH", "USD restores the original packet"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="rd-config" eyebrow="Operations" title="Configuring it on IOS XR" tone="mpls">
        <CliPanel run={t6Block(T0, "P1", "show running-config", /^ interface GigabitEthernet0\/0\/0\/1/, /^ interface GigabitEthernet0\/0\/0\/2/)} caption="IOS XR · P1 — the protected interface: BFD and TI-LFA (node-protecting)" />
        <FieldTable
          title="The statements"
          accent="mpls"
          columns={["Statement", "Where", "Effect"]}
          rows={[
            [<Mono key="1">fast-reroute per-prefix</Mono>, "router isis → interface → address-family ipv6 unicast", "compute backups (classic LFA)"],
            [<Mono key="2">fast-reroute per-prefix ti-lfa</Mono>, "same", "use TI-LFA repairs"],
            [<Mono key="3">fast-reroute per-prefix tiebreaker node-protecting index 100</Mono>, "same", "prefer node-protecting backups"],
            [<Mono key="4">bfd fast-detect ipv6</Mono>, "router isis → interface", "fast detection on silent links"],
            [<Mono key="5">segment-routing srv6 → locator MAIN</Mono>, "router isis → address-family ipv6 unicast", "End/End.X SIDs — required on every router a repair names"],
          ]}
        />
      </GuideSection>

      <GuideSection id="rd-verify" eyebrow="Operations" title="How to verify" tone="success">
        <FieldTable
          title="Verification on IOS XR"
          accent="success"
          columns={["Question", "Command"]}
          rows={[
            ["Which prefixes are protected?", <Mono key="1">show isis fast-reroute summary</Mono>],
            ["One prefix's backup and repair SIDs", <Mono key="2">show isis fast-reroute &lt;prefix&gt; detail</Mono>],
            ["Installed in forwarding?", <Mono key="3">show cef ipv6 &lt;address&gt;</Mono>],
            ["FRR settings of an interface", <Mono key="4">show isis interface &lt;if&gt;</Mono>],
            ["BFD", <Mono key="5">show bfd session · show isis adjacency</Mono>],
            ["SIDs on the repair path", <Mono key="6">show segment-routing srv6 sid</Mono>],
          ]}
        />
        <CliPanel run={t6Cli(T0, "P1", "show cef ipv6 2001:db8:110:2::")} caption="IOS XR · P1 — primary and backup, with the repair SID list" />
        <CliPanel run={t6Cli(T0, "P1", "show isis fast-reroute summary")} caption="IOS XR · P1 — two unprotected prefixes: PE1's, which has no alternative path" />
      </GuideSection>

      <GuideSection id="rd-signatures" eyebrow="Troubleshooting" title="Failure signatures" tone="danger">
        <FailureSignatures
          items={[
            { tag: "LFA", title: "TI-LFA not enabled", tone: "danger", points: ["No FRR backup (no LFA exists)", "cut ≈ detection + convergence"] },
            { tag: "SID", title: "Repair node without SRv6", tone: "danger", points: ["TI-LFA on, no backup", "reason names the router"] },
            { tag: "NODE", title: "Link-only protection", tone: "warning", points: ["TI-LFA (link)", "router failure ≈ convergence"] },
            { tag: "BFD", title: "BFD missing", tone: "warning", points: ["backup present", "~30 s on silent failures"] },
            { tag: "DIR", title: "One direction unprotected", tone: "violet", points: ["asymmetric drill results", "the other PLR has no backup"] },
            { tag: "LOOP", title: "Repair that doesn't force", tone: "danger", points: ["traffic loops through stale tables", "a hand-built or wrong repair"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="rd-ladder" eyebrow="Troubleshooting" title="The troubleshooting ladder" tone="danger">
        <TroubleshootingFlow
          steps={[
            { question: "What does a drill cost, per direction?", look: "Run the failure as a drill: PLR, detection, recovery, loss." },
            { question: "Who is the PLR, and how did it detect it?", look: "Loss of light, BFD or hold time." },
            { question: "What does its interface ask for?", look: "show isis interface — FRR, TI-LFA, tiebreaker." },
            { question: "Does it have a backup, and why not?", look: "show isis fast-reroute <prefix> detail." },
            { question: "Do the routers the repair names have SIDs?", look: "show segment-routing srv6 sid on them." },
            { question: "After the fix, does a fresh drill prove it?", look: "Both directions, under a second." },
          ]}
        />
      </GuideSection>

      <GuideSection id="rd-tickets" eyebrow="Troubleshooting" title="Five faults, evidence to proof" tone="danger">
        <FailureWalk title="1 · The cut wasn't protected" normal="P1 Gi0/0/0/1: per-prefix + TI-LFA." change="TI-LFA was removed; per-prefix stayed." evidence={<CliPanel run={t6Only(T.notilfa, "P1", "show isis interface Gi0/0/0/1", /FRR|LFA|Tie Breaker/)} caption="IOS XR · P1 — TI LFA Not Enabled" />} next="No classic LFA exists here: no backup, ~950 ms." fix={<Mono>P1: router isis CORE → interface Gi0/0/0/1 → address-family ipv6 unicast → fast-reroute per-prefix ti-lfa → commit</Mono>} proof="Backup installed; a fresh drill repairs locally in ~165 ms." />
        <FailureWalk title="2 · TI-LFA on, still no backup" normal="P4 advertises its locator; End.X SIDs exist." change="P4's upgrade dropped segment-routing srv6 from IS-IS." evidence={<CliPanel run={t6Only(T.p4srv6, "P1", "show isis fast-reroute 2001:db8:110:2::/64 detail", /No FRR|SRv6 SID that/)} caption="IOS XR · P1 — no backup: P4 has no SID" />} next="The repair can't force P4's link." fix={<Mono>P4: router isis CORE → address-family ipv6 unicast → segment-routing srv6 → locator MAIN → commit</Mono>} proof="P1's backup returns; fresh drill ~165 ms." />
        <FailureWalk title="3 · P2's reload hurt" normal="P1 protects toward P2 with node protection." change="The node-protecting tiebreaker was removed." evidence={<T6Result s={T.node} title="The lab: P2 fails — the link repair dies at P2" />} next="A cut is still fine; a router failure isn't." fix={<Mono>P1: … interface Gi0/0/0/1 → address-family ipv6 unicast → fast-reroute per-prefix tiebreaker node-protecting index 100 → commit</Mono>} proof="Backup P4 End.X → PE2; a fresh P2 drill ~25 ms." />
        <FailureWalk title="4 · 30 seconds on a DWDM cut" normal="BFD on both ends of P1–P2." change="P1 lost bfd fast-detect ipv6." evidence={<CliPanel run={t6Cli(T.bfd, "P2", "show bfd session")} caption="IOS XR · P2 — BFD session DOWN (P1 doesn't run it)" />} next="Detection falls back to the IS-IS hold time." fix={<Mono>P1: router isis CORE → interface Gi0/0/0/1 → bfd fast-detect ipv6 → commit</Mono>} proof="BFD UP; fresh drill ~165 ms both ways." />
        <FailureWalk title="5 · Only one direction survived" normal="P2 protects the replies toward PE1." change="P2's Gi0/0/0/0 lost its fast-reroute configuration." evidence={<CliPanel run={t6Only(T.reverse, "P2", "show isis fast-reroute 2001:db8:110:1::/64 detail", /^L2|via fe80|No FRR/)} caption="IOS XR · P2 — no backup toward PE1" />} next="CE1 → CE2 ~165 ms, CE2 → CE1 ~950 ms." fix={<Mono>P2: … interface Gi0/0/0/0 → address-family ipv6 unicast → fast-reroute per-prefix · fast-reroute per-prefix ti-lfa → commit</Mono>} proof="Both directions repaired locally." />
      </GuideSection>

      <GuideSection id="rd-myths" eyebrow="Master it" title="Common misconceptions" tone="warning">
        <Misconceptions
          items={[
            { myth: "“Topology independent” means TI-LFA ignores the topology.", correction: "It is computed from the same link-state database; it just isn't limited to an adjacent LFA." },
            { myth: "The headend reroutes the traffic.", correction: "The PLR does, locally; the headend may not even know." },
            { myth: "Every router on the repair path runs TI-LFA for it.", correction: "They just forward on the outer destination; only the PLR acts." },
            { myth: "A backup in the table means fast recovery.", correction: "Only if the failure is detected fast (BFD on silent links)." },
            { myth: "Protecting one direction protects the flow.", correction: "Each direction has its own PLR and backup." },
          ]}
        />
      </GuideSection>

      <GuideSection id="rd-quiz" eyebrow="Master it" title="Knowledge check" tone="cyan">
        <KnowledgeQuiz questions={QUIZ} />
      </GuideSection>

      <GuideSection id="rd-explain" eyebrow="Master it" title="Can you explain it?" tone="violet">
        <ExplainIt
          items={[
            { q: "Why does one SID get the packet from P1 to P2 around the failure?", a: "It is routed to P4's locator on old tables (P1 → P3 → P4) and executed at P4 as End.X with USD, forcing P4 → P2." },
            { q: "Why does node protection use P4 → PE2 instead?", a: "It must avoid P2 entirely, so the forced link is P4–PE2." },
            { q: "Why can a repair to P2's End loop?", a: "P3 routes P2's locator with its stale table — back via P1." },
            { q: "Why did the replies have no repair SID?", a: "P2's backup neighbor P4 already has a safe path to PE1, so the outgoing interface is enough." },
            { q: "Why is a 30 s outage possible with a perfect backup?", a: "Without BFD a silent failure is only noticed when the IS-IS hold time expires." },
          ]}
        />
      </GuideSection>

      <GuideSection id="rd-glossary" eyebrow="Master it" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "RFC 9855", def: "Topology Independent Fast Reroute using Segment Routing." },
            { term: "PLR", def: "Point of local repair." },
            { term: "Extended P-space", def: "Nodes any neighbor of the PLR reaches without the protected resource." },
            { term: "Repair list", def: "The SIDs the PLR imposes on the backup path." },
            { term: "USD", def: "Ultimate Segment Decapsulation flavor." },
            { term: "SRLG", def: "Shared risk link group: links that fail together." },
            { term: "Micro-loop", def: "Transient loop while routers converge at different moments." },
          ]}
        />
      </GuideSection>

      <GuideSection id="rd-mental" eyebrow="Master it" title="Mental model" tone="violet">
        <p>A sealed detour card, written in advance for each road and each direction, using only landmarks that yesterday&apos;s maps still get right — plus one explicit “take this road” where a map would lead back. Useless unless someone notices the closure quickly.</p>
      </GuideSection>

      <GuideSection id="rd-practice" eyebrow="Master it" title="Practice in the SRv6 TI-LFA Lab" tone="violet">
        <p>Six Learn levels, then the workspace: every router&apos;s backups, interfaces with FRR and BFD, SIDs, an IOS XR console, drills of any failure, two hand-built repairs to compare, five challenges and the five tickets above.</p>
        <LabBridge />
        <PresentationBridge>Rewatch the SRv6 TI-LFA presentation.</PresentationBridge>
      </GuideSection>
    </div>
  );
}
