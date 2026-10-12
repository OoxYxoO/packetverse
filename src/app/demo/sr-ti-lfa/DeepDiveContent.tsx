import { Callout, CompareCards, DArrow, DIAGRAM as D, DLink, DNode, DPill, DRegion, DiagramFrame, DiagramSvg, FailureSignatures, FieldTable, Glossary, GuideSection, Misconceptions, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { DStack } from "@/components/lesson/MplsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { ExplainIt, KnowledgeQuiz, PracticeBridge, type KnowledgeQuestion } from "@/components/lesson/GuideInteractive";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import { PresentationBridge } from "@/components/presentation/LessonPresentation";
import { CliPanel, FailureWalk } from "@/components/lesson/GuideCli";
import { createTlNet, tlApply, tlPfx, tlTicket, tlTicketState, type TlAction, type TlR, type TlRtr, type TlState, type TlTicketId } from "@/lib/sim-engine/scenarios/tlNet";
import { TlDrill, tlBlock, tlCli, tlOnly } from "./LessonGuideContent";

const G = { foundation: "Foundation", compute: "Computing the backup", data: "Data plane", timing: "Timing", ops: "Operations", trouble: "Troubleshooting", master: "Master it" };
export const TILFA_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "td-frr", label: "Why fast reroute", group: G.foundation },
  { id: "td-lfa", label: "LFA, remote LFA and TI-LFA", group: G.foundation },
  { id: "td-plr", label: "PLRs and directions", group: G.foundation },
  { id: "td-post", label: "The post-convergence path", group: G.compute },
  { id: "td-pq", label: "P-space and Q-space", group: G.compute },
  { id: "td-encoding", label: "Encoding the repair", group: G.compute },
  { id: "td-protect", label: "Link, node and SRLG protection", group: G.compute },
  { id: "td-coverage", label: "Coverage and its limits", group: G.compute },
  { id: "td-fib", label: "Primary and backup in the FIB", group: G.data },
  { id: "td-labels", label: "Labels, PHP and the hairpin", group: G.data },
  { id: "td-timeline", label: "Detection to convergence", group: G.timing },
  { id: "td-bfd", label: "Detection and BFD", group: G.timing },
  { id: "td-microloops", label: "Microloops", group: G.timing },
  { id: "td-time", label: "About \"50 ms\"", group: G.timing },
  { id: "td-config-xr", label: "Configuring it on IOS XR", group: G.ops },
  { id: "td-config-junos", label: "Configuring it on Junos", group: G.ops },
  { id: "td-verify", label: "How to verify", group: G.ops },
  { id: "td-signatures", label: "Failure signatures", group: G.trouble },
  { id: "td-ladder", label: "The troubleshooting ladder", group: G.trouble },
  { id: "td-tickets", label: "Five faults, evidence to proof", group: G.trouble },
  { id: "td-myths", label: "Common misconceptions", group: G.master },
  { id: "td-quiz", label: "Knowledge check", group: G.master },
  { id: "td-explain", label: "Can you explain it?", group: G.master },
  { id: "td-glossary", label: "Glossary", group: G.master },
  { id: "td-mental", label: "Mental model", group: G.master },
  { id: "td-practice", label: "Practice in the SR TI-LFA Lab", group: G.master },
];

// Real IOS XR / Junos output and drill results: the SR TI-LFA Lab's command set and model.
const X0: TlState = createTlNet(0, "xr");
const J0: TlState = createTlNet(0, "junos");
const run = (s: TlState, ...a: TlAction[]) => a.reduce((acc, x) => tlApply(acc, x), s);
const set = (text: string, changes: { dev: TlR; f: (c: TlRtr) => void }[]): TlAction => ({ type: "set", text, changes });
const ticket = (id: TlTicketId) => tlTicket(id).repro.reduce((acc, a) => tlApply(acc, a), tlTicketState(id, 1));
const T = { notilfa: ticket("notilfa"), reverse: ticket("reverse"), bfd: ticket("bfd"), repairsr: ticket("repairsr"), lfaonly: ticket("lfaonly") };
/** R2's metric toward R4 raised to 100 (R4's stays 10): R3's repair for R6 needs an Adjacency SID. */
const ADJ = run(X0, set("R2 → R4 metric 100", [{ dev: "R2", f: (c) => void (c.ifs["ge-0/0/1"]!.metric = 100) }]));
const ADJ_BK = tlPfx(ADJ.view, "R3", "R6")!.backup!;
const D24 = run(X0, { type: "drill", fail: { link: "R2-R4" } });

function LabBridge() {
  const openLab = usePracticeLabOpener();
  return (
    <PracticeBridge label="Open the SR TI-LFA Lab" onPractice={openLab}>
      TI-LFA and BFD on every router, IOS XR or Junos, failure drills that measure both directions — your own copy. Nothing you do there changes your lesson progress.
    </PracticeBridge>
  );
}


function LfaCompareDiagram() {
  return (
    <DiagramSvg h={190} label="Classic LFA picks one loop-free neighbor; TI-LFA pushes segments that reach a safe point anywhere on the post-convergence path">
      <text x={20} y={26} fill={D.cyan} fontSize={11} fontWeight={700}>
        Classic LFA
      </text>
      <DNode x={120} y={62} label="PLR" w={70} h={30} accent={D.warning} />
      <DNode x={330} y={62} label="neighbor N" w={110} h={30} />
      <DArrow x1={157} y1={62} x2={273} y2={62} color={D.cyan} />
      <text x={400} y={66} fill={D.muted} fontSize={10}>
        works only if N is loop-free
      </text>
      <text x={20} y={120} fill={D.success} fontSize={11} fontWeight={700}>
        TI-LFA
      </text>
      <DNode x={120} y={154} label="PLR" w={70} h={30} accent={D.warning} />
      <DNode x={330} y={154} label="PQ node" w={110} h={30} accent={D.success} />
      <DArrow x1={157} y1={154} x2={273} y2={154} color={D.success} />
      <DStack x={215} y={112} labels={[{ text: "repair SID", color: D.warning }]} payload="original" w={90} rowH={14} />
      <text x={400} y={158} fill={D.muted} fontSize={10}>
        SR segments reach a safe point
      </text>
    </DiagramSvg>
  );
}

function PqConceptDiagram() {
  return (
    <DiagramSvg h={190} label="P-Space is what the PLR reaches safely, Q-Space is what reaches the destination safely, and the overlap holds candidate repair points">
      <DRegion x={60} y={30} w={300} h={130} label="P-Space (safe from the PLR)" color={D.cyan} />
      <DRegion x={280} y={30} w={300} h={130} label="" color={D.warning} />
      <text x={568} y={48} textAnchor="end" fill={D.warning} fontSize={10} fontWeight={700}>
        Q-Space (safe to the destination)
      </text>
      <DPill x={320} y={100} text="PQ nodes" color={D.success} w={90} />
      <text x={150} y={110} textAnchor="middle" fill={D.muted} fontSize={10}>
        reach, but not onward
      </text>
      <text x={490} y={110} textAnchor="middle" fill={D.muted} fontSize={10}>
        onward, but not reached
      </text>
      <text x={320} y={182} textAnchor="middle" fill={D.muted} fontSize={10}>
        no PQ node? then the repair needs extra segments (e.g. an Adj-SID) to join P to Q
      </text>
    </DiagramSvg>
  );
}

function EncodingDiagram() {
  return (
    <DiagramSvg h={180} label="A repair can be one Node SID, a Node SID plus an Adj-SID, or other combinations, always pushed above the original SID">
      <text x={130} y={20} textAnchor="middle" fill={D.success} fontSize={11} fontWeight={700}>
        one Node SID
      </text>
      <DStack x={130} y={30} labels={[{ text: "PQ Node SID", color: D.warning, tag: "TOP" }, { text: "original SID" }]} payload="payload" w={116} />
      <text x={400} y={20} textAnchor="middle" fill={D.violet} fontSize={11} fontWeight={700}>
        Node SID + Adj-SID
      </text>
      <DStack x={400} y={30} labels={[{ text: "P node SID", color: D.warning, tag: "TOP" }, { text: "Adj-SID P→Q", color: D.warning }, { text: "original SID" }]} payload="payload" w={116} />
      <text x={320} y={170} textAnchor="middle" fill={D.muted} fontSize={10}>
        the original instruction always stays underneath; the PLR only adds segments on top
      </text>
    </DiagramSvg>
  );
}

function ProtectionTypesDiagram() {
  return (
    <DiagramSvg h={170} label="Link protection avoids one link; node protection avoids the whole next-hop node and every link into it">
      <text x={160} y={24} textAnchor="middle" fill={D.warning} fontSize={11} fontWeight={700}>
        link protection
      </text>
      <DNode x={70} y={80} label="PLR" w={64} h={30} accent={D.warning} />
      <DNode x={250} y={80} label="N" w={56} h={30} />
      <DLink x1={102} y1={80} x2={222} y2={80} color={D.danger} dashed />
      <text x={162} y={70} textAnchor="middle" fill={D.danger} fontSize={10}>
        avoid this link
      </text>
      <text x={480} y={24} textAnchor="middle" fill={D.danger} fontSize={11} fontWeight={700}>
        node protection
      </text>
      <DNode x={390} y={80} label="PLR" w={64} h={30} accent={D.warning} />
      <DNode x={570} y={80} label="N" w={56} h={30} accent={D.danger} />
      <DLink x1={422} y1={80} x2={542} y2={80} color={D.danger} dashed />
      <text x={570} y={118} textAnchor="middle" fill={D.danger} fontSize={10}>
        avoid N entirely
      </text>
      <text x={320} y={160} textAnchor="middle" fill={D.muted} fontSize={10}>
        node protection is stronger; its P/Q spaces are computed with the node removed
      </text>
    </DiagramSvg>
  );
}

function TimelineDiagram() {
  const stages = [
    { t: "precompute", c: D.violet },
    { t: "detect", c: D.danger },
    { t: "local repair", c: D.success },
    { t: "IGP flood + SPF", c: D.cyan },
    { t: "converged", c: D.success },
  ];
  return (
    <DiagramSvg h={110} label="Precompute, detect, local repair, IGP flooding and SPF, converged">
      {stages.map((s, i) => (
        <g key={s.t}>
          <DPill x={70 + i * 125} y={40} text={s.t} color={s.c} w={112} />
          {i < stages.length - 1 && <DArrow x1={127 + i * 125} y1={40} x2={138 + i * 125} y2={40} color={D.faint} width={1.4} />}
        </g>
      ))}
      <text x={320} y={90} textAnchor="middle" fill={D.muted} fontSize={10}>
        repair labels are used only between detection and convergence
      </text>
    </DiagramSvg>
  );
}


const QUIZ: KnowledgeQuestion[] = [
  {
    id: "q-plr",
    prompt: "A flow H6 → H1 crosses R4 → R2. The R2–R4 link fails. Which router repairs it?",
    options: [
      { id: "a", label: "R4 — it sends the traffic into the failure" },
      { id: "b", label: "R2" },
      { id: "c", label: "R6, the ingress" },
    ],
    correctId: "a",
    explanation: "The PLR is the router upstream of the failure for that direction.",
  },
  {
    id: "q-post",
    prompt: "Why does TI-LFA repair along the post-convergence path?",
    options: [
      { id: "a", label: "So traffic doesn't move again when the IGP converges" },
      { id: "b", label: "Because it is always the shortest backup" },
      { id: "c", label: "Because RSVP requires it" },
    ],
    correctId: "a",
    explanation: "Repair and converged path coincide: one move, and no transient loops between them.",
  },
  {
    id: "q-pq",
    prompt: "What makes a router a PQ node for R2's repair to R6?",
    options: [
      { id: "a", label: "R2 reaches it, and it reaches R6, both without the protected resource" },
      { id: "b", label: "It is directly connected to R2" },
      { id: "c", label: "It has the lowest Node SID" },
    ],
    correctId: "a",
    explanation: "In P-space of the PLR and Q-space of the destination.",
  },
  {
    id: "q-lfa",
    prompt: "R4's only other neighbor reaches R1 back through R4. With classic LFA, what does R4 get?",
    options: [
      { id: "a", label: "No backup for R1" },
      { id: "b", label: "A backup via that neighbor anyway" },
      { id: "c", label: "A remote LFA tunnel automatically" },
    ],
    correctId: "a",
    explanation: "No loop-free alternate exists; TI-LFA adds a label (16005) to steer around the loop.",
  },
  {
    id: "q-bfd",
    prompt: "A DWDM fault keeps the light on. TI-LFA is configured, BFD is not. How long is traffic lost?",
    options: [
      { id: "a", label: "Until the IS-IS hold time expires (30 s here)" },
      { id: "b", label: "About 50 ms" },
      { id: "c", label: "Not at all" },
    ],
    correctId: "a",
    explanation: "The backup is used only after detection; without BFD the silent failure is found by the hold time.",
  },
  {
    id: "q-sr",
    prompt: "R3 lost segment routing; every path around R2–R4 crosses R3. What does R2 show?",
    options: [
      { id: "a", label: "No backup for R6" },
      { id: "b", label: "A backup via R3 that will work" },
      { id: "c", label: "A classic LFA" },
    ],
    correctId: "a",
    explanation: "A repair needs every router on the post-convergence path to execute SR labels.",
  },
];

export function TiLfaDeepDiveContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="td-frr" eyebrow="Foundation" title="Why fast reroute" tone="mpls">
        <p>An IGP converges in a sequence: detect the failure, generate and flood a new LSP, wait for the SPF timers, run SPF on every router, update the RIB, then program the FIB — hundreds of prefixes, line card by line card. Even tuned, that is hundreds of milliseconds; at scale, seconds. <b className="text-pv-text">Fast reroute</b> splits the problem: precompute a backup next hop at the router upstream of the failure and program it into the FIB in advance, so the data plane can switch on detection alone. The IGP still converges — afterwards, with traffic already flowing.</p>
        <TimelineDiagramFrame />
      </GuideSection>

      <GuideSection id="td-lfa" eyebrow="Foundation" title="LFA, remote LFA and TI-LFA" tone="cyan">
        <DiagramFrame caption="Classic LFA picks a neighbor; TI-LFA pushes segments.">
          <LfaCompareDiagram />
        </DiagramFrame>
        <FieldTable
          title="Three generations of IP fast reroute"
          accent="cyan"
          columns={["", "Classic LFA", "Remote LFA", "TI-LFA"]}
          rows={[
            ["Standard", "RFC 5286", "RFC 7490", "RFC 9855"],
            ["Backup", "a loop-free neighbor", "a tunnel to a PQ node (LDP)", "segments along the post-convergence path"],
            ["Condition", "dist(N,D) < dist(N,S) + dist(S,D)", "a PQ node exists", "any path exists"],
            ["Coverage", "topology-dependent (often 70–90 %)", "better, still gaps", "100 % of what is reachable"],
            ["Path after repair", "whatever the neighbor uses", "via the PQ node", "the post-convergence path"],
            ["Needs", "nothing", "targeted LDP sessions", "segment routing on the repair path"],
          ]}
        />
        <p>In this network R2 has a classic LFA for 10.0.0.6 (R3: 30 &lt; 15 + 20) but R4 has none for 10.0.0.1 (R6: 30 is not &lt; 10 + 20). TI-LFA covers both.</p>
      </GuideSection>

      <GuideSection id="td-plr" eyebrow="Foundation" title="PLRs and directions" tone="warning">
        <p>Protection is per router, per interface, per destination. For a link failure the PLRs are the two ends — one per traffic direction. For a node failure they are every neighbor of that node that uses it as a next hop. A single-homed router such as R1 can be a PLR for nothing: there is no second way out.</p>
        <Callout tone="warning" title="Protect both ends" icon="!">
          Configuration drift often leaves one end of a link protected and the other not. The symptom is directional: requests keep flowing, replies stall for a second.
        </Callout>
      </GuideSection>

      <GuideSection id="td-post" eyebrow="Computing the backup" title="The post-convergence path" tone="mpls">
        <p>For each destination D whose primary next hop goes out the protected interface, the PLR S runs SPF on its own LSDB with the protected link (or the next-hop node) removed. The result is the path traffic will take once every router has converged. TI-LFA&apos;s design choice (RFC 9855) is to repair onto exactly that path:</p>
        <FieldTable
          title="Why the post-convergence path"
          accent="mpls"
          columns={["Property", "Consequence"]}
          rows={[
            ["Same as the converged path", "traffic moves once; no second shift when IS-IS converges"],
            ["Computed from the PLR's LSDB", "no signaling, no state on other routers"],
            ["Exists if any path exists", "100 % coverage of reachable destinations"],
            ["Usually well-provisioned", "it is where the IGP sends traffic anyway, so capacity planning already covers it"],
          ]}
        />
      </GuideSection>

      <GuideSection id="td-pq" eyebrow="Computing the backup" title="P-space and Q-space" tone="violet">
        <DiagramFrame caption="The overlap holds the candidate repair points.">
          <PqConceptDiagram />
        </DiagramFrame>
        <p><b className="text-pv-text">P-space</b> of S: routers S reaches on its pre-failure shortest paths without the protected resource. <b className="text-pv-text">Extended P-space</b> adds what S&apos;s neighbors reach that way, since S can send to a neighbor directly. <b className="text-pv-text">Q-space</b> of D: routers whose pre-failure shortest path to D avoids the protected resource. If the post-convergence path passes a router in both, one Node SID gets the packet there; otherwise the repair bridges the last P node to the first Q node with Adjacency SIDs.</p>
        <p>In the lesson&apos;s network, for R2–R4 and destination R6: P = {"{R1, R3, R5}"}, Q = {"{R3, R4, R5}"}; R5 is the repair point on the post-convergence path R2 → R3 → R5 → R6.</p>
      </GuideSection>

      <GuideSection id="td-encoding" eyebrow="Computing the backup" title="Encoding the repair" tone="mpls">
        <DiagramFrame caption="Node SIDs where the old shortest path agrees, Adjacency SIDs where it doesn't.">
          <EncodingDiagram />
        </DiagramFrame>
        <p>The encoding walks the post-convergence path from the PLR. As long as the PLR&apos;s pre-failure shortest path to a router along it follows the same hops, one Node SID covers that stretch. Where it would leave the path, the repair switches to the Adjacency SID of the next link. The destination&apos;s own label goes at the bottom.</p>
        <p>An example from the lab: raise R2&apos;s metric toward R4 to 100 (R4 keeps 10 toward R2). Now R3 protects 10.0.0.6 against R5 failing. Its post-convergence path is {ADJ_BK.path.join(" → ")}. R3&apos;s shortest path to R2 is direct (16002), but R2&apos;s own shortest path to R4 no longer uses the R2–R4 link — so the repair names it: R2&apos;s Adjacency SID toward R4, <Mono>24024</Mono>. Repair: <Mono>[{ADJ_BK.repair.join(", ")}]</Mono>. R3 executes the first segment itself (R2 is its neighbor), so the wire toward R2 carries <Mono>24024 | 16006</Mono>.</p>
        <CliPanel run={tlOnly(ADJ, "R3", "show isis fast-reroute 10.0.0.6/32 detail", /^L2|via|Backup path|P node|Q node|Prefix label/)} caption="IOS XR · R3 — P node R2 (its neighbor: ImpNull), Q node R4 via R2's Adjacency SID 24024" />
        <Callout tone="cyan" title="Label stack depth" icon="i">
          Every extra segment is one more label imposed by the PLR. Platforms limit the number of labels they can push (IOS XR shows it as &quot;MPLS Max Label Stack&quot; under <Mono>show isis interface</Mono>); Junos limits repair labels with <Mono>backup-spf-options use-post-convergence-lfa maximum-labels</Mono>. Typical networks need one or two.
        </Callout>
      </GuideSection>

      <GuideSection id="td-protect" eyebrow="Computing the backup" title="Link, node and SRLG protection" tone="warning">
        <DiagramFrame caption="Link protection avoids one link; node protection avoids the next-hop router and all its links.">
          <ProtectionTypesDiagram />
        </DiagramFrame>
        <FieldTable
          title="What each mode removes before computing the backup"
          accent="warning"
          columns={["Mode", "Removed", "IOS XR", "Junos"]}
          rows={[
            ["Link", "the protected link", "fast-reroute per-prefix ti-lfa", "post-convergence-lfa"],
            ["Node", "the next-hop router", "+ tiebreaker node-protecting index n", "post-convergence-lfa node-protection"],
            ["SRLG", "every link sharing a risk group", "+ tiebreaker srlg-disjoint index n", "(SRLG-aware backup selection)"],
          ]}
        />
        <p>Node protection cannot apply when the destination <i>is</i> the next hop — there it falls back to link protection, as R2&apos;s backup for 10.0.0.4 shows. In a ring like this lab, link and node protection give the same paths; in meshed cores they differ.</p>
      </GuideSection>

      <GuideSection id="td-coverage" eyebrow="Computing the backup" title="Coverage and its limits" tone="danger">
        <p>TI-LFA covers every destination that has a path after the failure, provided every router on that path executes the repair&apos;s segments. It cannot help a single-homed router (R1&apos;s summary shows 0 of 5 protected) and it cannot help when the only way around crosses a router without segment routing. It protects against the failures it was computed for: a second, simultaneous failure on the repair path is not covered.</p>
        <CliPanel run={tlCli(X0, "R1", "show isis fast-reroute summary")} caption="IOS XR · R1 — nothing can be protected over a single link" />
      </GuideSection>

      <GuideSection id="td-fib" eyebrow="Data plane" title="Primary and backup in the FIB" tone="mpls">
        <p>The PLR programs each protected prefix with two paths: the primary and the backup, flagged as such. Hardware switches from one to the other when the primary interface or its BFD session goes down — one pointer change for all prefixes sharing that next hop (prefix-independent convergence), not a rewrite per prefix.</p>
        <CliPanel run={tlOnly(X0, "R2", "show cef 10.0.0.6", /^10\.0\.0\.6|local label|via|next hop|labels imposed/)} caption="IOS XR · R2 — protected primary toward R4, backup (TI-LFA) toward R3 with {16005 16006}" />
        <CliPanel run={tlOnly(J0, "R2", "show route table mpls.0", /^16006|to 10\.1\.2[34]\.[34] via ge-0\/0\/[12]\.0, Swap 16006/)} caption="Junos · R2 — label 16006: primary Swap toward R4, backup Swap + Push 16005(top) toward R3" />
      </GuideSection>

      <GuideSection id="td-labels" eyebrow="Data plane" title="Labels, PHP and the hairpin" tone="violet">
        <p>The repair stack interacts with penultimate-hop popping exactly like any other: R3 pops 16005 on its way to R5, R5 pops 16006 on its way to R6. When the backup&apos;s first hop is itself the repair point, its Node SID is not pushed at all — the PLR sends the next label straight to it.</p>
        <p>Repairs can also turn traffic around. For H6 → H1 R4 is the PLR, but R6 still sends to R4 until it converges: the packet travels R6 → R4 → R6 → R5 → R3 → R2 → R1. That is not a loop — R4 pushes 16005, and R6 forwards toward R5 — and it lasts until R6&apos;s own SPF moves it.</p>
        <TlDrill s={D24} title="The lab: R2–R4 fails — both repairs and their paths" />
      </GuideSection>

      <GuideSection id="td-timeline" eyebrow="Timing" title="Detection to convergence" tone="mpls">
        <TimelineDiagramFrame />
        <FieldTable
          title="What happens, in order (this lab's numbers)"
          accent="mpls"
          columns={["Phase", "Who", "Time"]}
          rows={[
            ["Precompute and install the backup", "every PLR, after every SPF", "before the failure"],
            ["Detect", "the PLR: loss of light / BFD / hold time", "10 ms / 150 ms / 30 s"],
            ["Switch to the backup", "the PLR's forwarding hardware", "~15 ms"],
            ["Flood, SPF, reprogram", "every router", "hundreds of ms"],
            ["Converged", "traffic on the post-convergence path — the same path", "—"],
            ["New backups", "every PLR, for the new topology", "after the SPF"],
          ]}
        />
      </GuideSection>

      <GuideSection id="td-bfd" eyebrow="Timing" title="Detection and BFD" tone="danger">
        <p>The backup is triggered by the primary path going down. An interface that loses carrier goes down in milliseconds. A path that fails without a carrier change — a DWDM transponder, a provider&apos;s Ethernet service, a unidirectional fault — is only detected by protocol timers. BFD (RFC 5880) runs asynchronous control packets between the two ends; with 50 ms × 3 a failure is declared after 150 ms. IS-IS registers as a BFD client and drops the adjacency immediately, which triggers the switch.</p>
        <CompareCards
          items={[
            { title: "Loss of light", tone: "success", tag: "~10 ms", points: ["fiber cut, port down", "no configuration needed"] },
            { title: "BFD", tone: "mpls", tag: "interval × multiplier", points: ["silent failures", "must run on both ends"] },
            { title: "IGP hold time", tone: "danger", tag: "seconds", points: ["the only detector without BFD", "30 s here"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="td-microloops" eyebrow="Timing" title="Microloops" tone="warning">
        <p>During convergence routers update their FIBs at different moments. A router that has already moved can send to one that hasn&apos;t, which sends it back: a <b className="text-pv-text">microloop</b>, lasting until both have converged. Repairing along the post-convergence path removes microloops between the PLR&apos;s repair and the converged state; loops elsewhere in the network are handled by SR microloop avoidance, which temporarily steers traffic with segment lists while FIBs settle (IOS XR <Mono>microloop avoidance segment-routing</Mono>).</p>
      </GuideSection>

      <GuideSection id="td-time" eyebrow="Timing" title={'About "50 ms"'} tone="cyan">
        <p>&quot;50 ms&quot; comes from SONET/SDH protection switching and is often quoted for FRR. It is a target for the switch itself, not a guarantee for the outage: the loss is detection plus switch. With loss of light that is tens of milliseconds; with BFD at 50 ms × 3 it is about 165 ms; without BFD on a silent failure it is the hold time. The lab&apos;s numbers are illustrative, chosen to show these proportions.</p>
      </GuideSection>

      <GuideSection id="td-config-xr" eyebrow="Operations" title="Configuring it on IOS XR" tone="mpls">
        <CliPanel run={tlBlock(X0, "R2", "show running-config router isis", /^ interface GigabitEthernet0\/0\/0\/1/, /^ interface /, "router isis CORE\n address-family ipv4 unicast\n  metric-style wide\n  segment-routing mpls\n !")} caption="IOS XR · R2 — TI-LFA with node protection on the interface toward R4, BFD on the silent link" />
        <FieldTable
          title="The statements"
          accent="mpls"
          columns={["Statement", "Where", "Effect"]}
          rows={[
            [<Mono key="1">fast-reroute per-prefix</Mono>, "router isis → interface → address-family", "compute a backup for every prefix using this interface (classic LFA alone)"],
            [<Mono key="2">fast-reroute per-prefix ti-lfa</Mono>, "same", "use TI-LFA: repair along the post-convergence path"],
            [<Mono key="3">fast-reroute per-prefix tiebreaker node-protecting index 100</Mono>, "same", "prefer backups that avoid the next-hop router"],
            [<Mono key="4">bfd fast-detect ipv4</Mono>, "router isis → interface", "IS-IS becomes a BFD client on this link"],
            [<Mono key="5">bfd minimum-interval 50 · bfd multiplier 3</Mono>, "router isis → interface", "150 ms detection"],
          ]}
        />
        <Callout tone="warning" title="ti-lfa needs per-prefix" icon="!">
          On IOS XR, <Mono>ti-lfa</Mono> and the tiebreaker only take effect under <Mono>fast-reroute per-prefix</Mono>. Remove per-prefix and the backups disappear.
        </Callout>
      </GuideSection>

      <GuideSection id="td-config-junos" eyebrow="Operations" title="Configuring it on Junos" tone="mpls">
        <CliPanel run={tlBlock(J0, "R2", "show configuration protocols isis", /^backup-spf-options/, /^interface ge-0\/0\/2/)} caption="Junos · R2 — backup-spf-options, post-convergence-lfa node-protection, BFD" />
        <FieldTable
          title="The statements"
          accent="mpls"
          columns={["Statement", "Effect"]}
          rows={[
            [<Mono key="1">protocols isis backup-spf-options use-post-convergence-lfa</Mono>, "compute post-convergence (TI-LFA) backups"],
            [<Mono key="2">protocols isis backup-spf-options use-source-packet-routing</Mono>, "encode them with SR labels"],
            [<Mono key="3">protocols isis interface ge-0/0/1.0 level 2 post-convergence-lfa node-protection</Mono>, "protect this interface, avoiding the next-hop node"],
            [<Mono key="4">protocols isis interface ge-0/0/1.0 link-protection</Mono>, "classic LFA only"],
            [<Mono key="5">protocols isis interface ge-0/0/1.0 bfd-liveness-detection minimum-interval 50 · multiplier 3</Mono>, "150 ms detection"],
          ]}
        />
      </GuideSection>

      <GuideSection id="td-verify" eyebrow="Operations" title="How to verify" tone="success">
        <FieldTable
          title="Verification, IOS XR · Junos"
          accent="success"
          columns={["Question", "IOS XR", "Junos"]}
          rows={[
            ["Is the interface protected?", <Mono key="1">show isis interface &lt;if&gt;</Mono>, <Mono key="2">show configuration protocols isis</Mono>],
            ["Backup per prefix, repair labels?", <Mono key="3">show isis fast-reroute [&lt;pfx&gt; detail]</Mono>, <Mono key="4">show isis backup spf results</Mono>],
            ["Coverage?", <Mono key="5">show isis fast-reroute summary</Mono>, <Mono key="6">show isis backup coverage</Mono>],
            ["Installed?", <Mono key="7">show route &lt;ip&gt; · show cef &lt;ip&gt; · show mpls forwarding labels &lt;n&gt; detail</Mono>, <Mono key="8">show route table inet.3 / mpls.0</Mono>],
            ["Detection?", <Mono key="9">show bfd session · show isis adjacency</Mono>, <Mono key="10">show bfd session</Mono>],
            ["Does it work?", "a failure drill / maintenance test", "same"],
          ]}
        />
        <CliPanel run={tlCli(J0, "R2", "show isis backup coverage")} caption="Junos · R2 — 80 %: everything except R1, behind R2's only link to it" />
      </GuideSection>

      <GuideSection id="td-signatures" eyebrow="Troubleshooting" title="Failure signatures" tone="danger">
        <FailureSignatures
          items={[
            { tag: "PLR", title: "No fast reroute on the PLR", tone: "danger", points: ["No FRR backup / Interface is not protected", "one direction ~1 s"] },
            { tag: "END", title: "One end only", tone: "danger", points: ["H1 → H6 fine", "H6 → H1 ~1 s"] },
            { tag: "BFD", title: "No BFD on a silent link", tone: "warning", points: ["backup present", "Hold time expired, ~30 s"] },
            { tag: "SR", title: "No SR on the repair path", tone: "violet", points: ["no backup anywhere around", "lost until repaired"] },
            { tag: "LFA", title: "Classic LFA only", tone: "warning", points: ["Direct LFA Enabled, TI LFA Not Enabled", "some destinations unprotected"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="td-ladder" eyebrow="Troubleshooting" title="The troubleshooting ladder" tone="danger">
        <TroubleshootingFlow
          steps={[
            { question: "Which direction lost traffic, and how long?", look: "~1 s: no backup. ~30 s: detection. Until repaired: no path." },
            { question: "Which router is the PLR for it?", look: "The router upstream of the failure, per direction." },
            { question: "How fast did it detect the failure?", look: "BFD session state; adjacency-down reason in the log." },
            { question: "Does it have a backup for the destination?", look: "show isis fast-reroute / backup spf results." },
            { question: "Can every router on the repair execute it?", look: "Segment routing on each; label tables." },
            { question: "Does the post-convergence path work at all?", look: "Ping after the IGP converged." },
          ]}
        />
      </GuideSection>

      <GuideSection id="td-tickets" eyebrow="Troubleshooting" title="Five faults, evidence to proof" tone="danger">
        <FailureWalk
          title="1 · A one-second freeze, downstream"
          normal="R2 runs TI-LFA with node protection on its link to R4."
          change="R2 was replaced from a minimal template without fast reroute."
          evidence={<CliPanel run={tlOnly(T.notilfa, "R2", "show isis fast-reroute 10.0.0.6/32 detail", /^L2|via|No FRR/)} caption="IOS XR · R2 — no backup for 10.0.0.6" />}
          next="R2 detects in 150 ms and then waits for convergence; R4 still protects the other direction."
          fix={<Mono>R2: router isis CORE → interface Gi0/0/0/1 → address-family ipv4 unicast → fast-reroute per-prefix · fast-reroute per-prefix ti-lfa · tiebreaker node-protecting index 100 → commit</Mono>}
          proof="R2 shows a TI-LFA backup via R3; a fresh drill repairs both directions in ~165 ms."
        />
        <FailureWalk
          title="2 · Only the replies stall"
          normal="R4 protects its link to R2 for traffic toward R1."
          change="R4's regenerated configuration lost fast reroute on that interface."
          evidence={<TlDrill s={T.reverse} title="The lab: the drill" />}
          next="H6 → H1 enters the failure at R4 — R4 is that direction's PLR."
          fix={<Mono>R4: router isis CORE → interface Gi0/0/0/0 → address-family ipv4 unicast → fast-reroute per-prefix · ti-lfa → commit</Mono>}
          proof="R4 shows a TI-LFA backup for 10.0.0.1; a fresh drill repairs both directions."
        />
        <FailureWalk
          title="3 · Thirty seconds of silence"
          normal="BFD runs on both ends of the DWDM link R2–R4."
          change="BFD was removed from both ends."
          evidence={<CliPanel run={tlOnly(T.bfd, "R2", "show logging", /ADJCHANGE.*Down/)} caption="IOS XR · R2 — Adjacency to R4 Down, Hold time expired" />}
          next="The light stayed on; only the IS-IS hold time detected the failure. The backups were ready all along."
          fix={<Mono>R2 and R4: router isis CORE → interface → bfd minimum-interval 50 · bfd multiplier 3 · bfd fast-detect ipv4 → commit</Mono>}
          proof="show bfd session UP on both; a fresh drill: ~165 ms."
        />
        <FailureWalk
          title="4 · Protected, then black"
          normal="Every router runs segment routing."
          change="R3 came back from an RMA without segment routing."
          evidence={<CliPanel run={tlCli(T.repairsr, "R2", "show isis fast-reroute summary")} caption="IOS XR · R2 — three of four destinations without a backup" />}
          next="Every way around R2–R4 crosses R3: no backup on R2 or R4, and after convergence R3 drops the unlabelled traffic."
          fix={<Mono>R3: router isis CORE → address-family ipv4 unicast → segment-routing mpls → commit</Mono>}
          proof="R3 programs labels again; R2 and R4 show backups; a fresh drill repairs both directions."
        />
        <FailureWalk
          title="5 · Fast reroute is configured…"
          normal="R4 runs TI-LFA toward R2."
          change="R4's interface runs fast-reroute per-prefix without ti-lfa: classic LFA only."
          evidence={<CliPanel run={tlOnly(T.lfaonly, "R4", "show isis interface Gi0/0/0/0", /FRR|Direct LFA|TI LFA/)} caption="IOS XR · R4 — Direct LFA Enabled, TI LFA Not Enabled" />}
          next="R6, R4's only alternative, reaches R1 back through R4: no loop-free alternate, so no backup for 10.0.0.1."
          fix={<Mono>R4: … address-family ipv4 unicast → fast-reroute per-prefix ti-lfa → commit</Mono>}
          proof="R4 shows a TI-LFA backup [16005] via R6; a fresh drill repairs both directions."
        />
      </GuideSection>

      <GuideSection id="td-myths" eyebrow="Master it" title="Common misconceptions" tone="warning">
        <Misconceptions
          items={[
            { myth: "TI-LFA guarantees 50 ms.", correction: "It guarantees a precomputed switch; the outage is detection plus switch." },
            { myth: "Protecting one end of a link protects the link.", correction: "Each direction has its own PLR." },
            { myth: "The repair lists every hop.", correction: "Only where the pre-failure shortest path would stray; usually one or two segments." },
            { myth: "Classic LFA and TI-LFA differ only in name.", correction: "Classic LFA needs a loop-free neighbor; TI-LFA covers any topology with SR labels." },
            { myth: "TI-LFA is signaled like an RSVP bypass.", correction: "Nothing is signaled; the PLR computes it from IS-IS alone." },
            { myth: "A configured backup is a working backup.", correction: "Every router on the repair needs SR, and detection must work — prove it with a drill." },
          ]}
        />
      </GuideSection>

      <GuideSection id="td-quiz" eyebrow="Master it" title="Knowledge check" tone="cyan">
        <KnowledgeQuiz questions={QUIZ} />
      </GuideSection>

      <GuideSection id="td-explain" eyebrow="Master it" title="Can you explain it?" tone="violet">
        <ExplainIt
          items={[
            { q: "Why is R2's repair for R6 just [16005]?", a: "R2's normal path to R5 already follows the post-convergence path (via R3), and R5's normal path to R6 is direct; one Node SID covers the detour." },
            { q: "Why does H6 → H1 hairpin at R4 during a repair?", a: "R6 hasn't converged and still sends to R4; R4, the PLR, pushes 16005 back toward R6, which forwards toward R5." },
            { q: "Why can R2 have a classic LFA for R6 but R4 none for R1?", a: "R3's path to R6 doesn't return through R2 (30 < 35); R6's path to R1 returns through R4 (30 = 30)." },
            { q: "What decides whether the loss is 165 ms or 30 s?", a: "Detection: BFD on both ends of the silent link, or only the IS-IS hold time." },
            { q: "Why does a router without SR break protection elsewhere?", a: "It sits on every post-convergence path around the failure, and can't execute the repair labels." },
          ]}
        />
      </GuideSection>

      <GuideSection id="td-glossary" eyebrow="Master it" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "TI-LFA", def: "Topology-Independent LFA: backup along the post-convergence path, encoded with SR (RFC 9855)." },
            { term: "LFA", def: "Loop-free alternate: a neighbor used as backup next hop (RFC 5286)." },
            { term: "Remote LFA", def: "A tunnel to a PQ node, usually LDP (RFC 7490)." },
            { term: "PLR", def: "Point of local repair." },
            { term: "P-space / Q-space", def: "Reachable from the PLR / reaching the destination, without the protected resource." },
            { term: "PQ node", def: "In both spaces: a safe repair point." },
            { term: "Node protection", def: "Backup avoids the next-hop router entirely." },
            { term: "SRLG", def: "Shared risk link group: links that fail together." },
            { term: "BFD", def: "Fast bidirectional liveness detection (RFC 5880)." },
            { term: "Microloop", def: "A transient loop while routers update their FIBs at different times." },
          ]}
        />
      </GuideSection>

      <GuideSection id="td-mental" eyebrow="Master it" title="Mental model" tone="violet">
        <p>Every router keeps, for every destination, a sealed envelope: &quot;if my way there breaks, go here first&quot;. The envelope is written from the map everyone already has, describes the road everyone will take once the news spreads, and is opened the instant the break is noticed — which is why noticing matters as much as the envelope.</p>
      </GuideSection>

      <GuideSection id="td-practice" eyebrow="Master it" title="Practice in the SR TI-LFA Lab" tone="violet">
        <p>Six Learn levels, then the workspace: every router&apos;s per-interface protection and BFD, its backups, an IOS XR / Junos console, failure drills for every link and the core routers, five challenges and the five tickets above.</p>
        <LabBridge />
        <PresentationBridge>Rewatch the SR TI-LFA presentation.</PresentationBridge>
      </GuideSection>
    </div>
  );
}

function TimelineDiagramFrame() {
  return (
    <DiagramFrame caption="Local repair happens between detection and convergence.">
      <TimelineDiagram />
    </DiagramFrame>
  );
}
