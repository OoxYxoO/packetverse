import { Callout, CompareCards, DArrow, DIAGRAM as D, DLink, DNode, DRegion, DiagramFrame, DiagramSvg, FailureSignatures, FieldTable, GuideSection, Misconceptions, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { ExplainIt, KnowledgeQuiz, PracticeBridge, type KnowledgeQuestion } from "@/components/lesson/GuideInteractive";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import { PresentationBridge } from "@/components/presentation/LessonPresentation";
import { CliPair, CliPanel, FailureWalk, pickLines, runGuideCli } from "@/components/lesson/GuideCli";
import type { CliVendor } from "@/lib/cli/types";
import { createRrNet, rrApply, rrTicket, rrTicketState, type RrDev, type RrState, type RrTicketId } from "@/lib/sim-engine/scenarios/rrNet";
import { rrSets, rrStaticApi } from "./rr-lab/rrCli";
import { LabNetworkDiagram, rrSummary } from "./LessonGuideContent";

const G = { foundation: "Foundation", mech: "Reflection", path: "Paths and next hops", design: "Design", ops: "Operations", trouble: "Troubleshooting", beyond: "Beyond this lesson", master: "Master it" };
export const RR_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "rd-mesh", label: "The iBGP full-mesh requirement", group: G.foundation },
  { id: "rd-why", label: "Why split horizon exists", group: G.foundation },
  { id: "rd-network", label: "The network you will study", group: G.foundation },
  { id: "rd-what", label: "Route reflection (RFC 4456)", group: G.mech },
  { id: "rd-roles", label: "Reflector, client, non-client", group: G.mech },
  { id: "rd-rules", label: "The advertisement rules", group: G.mech },
  { id: "rd-attrs", label: "ORIGINATOR_ID and CLUSTER_LIST", group: G.mech },
  { id: "rd-loops", label: "Loop prevention in action", group: G.mech },
  { id: "rd-best", label: "Best path through a reflector", group: G.path },
  { id: "rd-visibility", label: "Path hiding", group: G.path },
  { id: "rd-nexthop", label: "NEXT_HOP and next-hop-self", group: G.path },
  { id: "rd-redundancy", label: "Redundant reflectors", group: G.design },
  { id: "rd-samecluster", label: "Same cluster or different?", group: G.design },
  { id: "rd-hierarchy", label: "Hierarchical reflection", group: G.design },
  { id: "rd-placement", label: "Placement and the data path", group: G.design },
  { id: "rd-confed", label: "Alternative: confederations", group: G.design },
  { id: "rd-config", label: "Configuring it: IOS XR and Junos", group: G.ops },
  { id: "rd-verify", label: "How to verify", group: G.ops },
  { id: "rd-normal", label: "What healthy looks like", group: G.ops },
  { id: "rd-signatures", label: "Failure signatures", group: G.trouble },
  { id: "rd-workflow", label: "Investigation workflow", group: G.trouble },
  { id: "rd-tickets", label: "Five faults, evidence to proof", group: G.trouble },
  { id: "rd-beyond", label: "Where reflectors go next", group: G.beyond },
  { id: "rd-myths", label: "Common misconceptions", group: G.master },
  { id: "rd-quiz", label: "Knowledge check", group: G.master },
  { id: "rd-explain", label: "Can you explain it?", group: G.master },
  { id: "rd-practice", label: "Practice in the Route Reflector Lab", group: G.master },
];

// Real CLI output: the Route Reflector Lab's own command sets run against the lab's model.
const cli = (s: RrState, r: RrDev, vendor: CliVendor, command: string) => runGuideCli(rrSets(rrStaticApi(s, r), r)[vendor], command);
const only = (s: RrState, r: RrDev, vendor: CliVendor, command: string, match: RegExp, keep = 0) => {
  const x = cli(s, r, vendor, command);
  return { ...x, output: pickLines(x.output, match, keep) };
};
const WARM = createRrNet();
const ticket = (id: RrTicketId) => rrTicket(id).repro.reduce((acc, a) => rrApply(acc, a), rrTicketState(id, 1));
const T = { client: ticket("client"), cluster: ticket("cluster"), typo: ticket("typo"), nhs: ticket("nhs"), filter: ticket("filter") };

function LabBridge() {
  const openLab = usePracticeLabOpener();
  return (
    <PracticeBridge label="Open the Route Reflector Lab" onPractice={openLab}>
      The network from this page, IOS XR or Junos, your own copy. Nothing you do there changes your lesson progress.
    </PracticeBridge>
  );
}

/** 10.9.9.0/24 is dual-homed; RR1 reflects only its best path, so PE2 never learns the PE4 exit. */
function HidingDiagram() {
  return (
    <DiagramSvg h={190} label="RR1 has two paths to 10.9.9.0/24, via PE1 and via PE4, but sends PE2 only its best one, via PE1">
      <DNode x={320} y={40} label="RR1" sub="2 paths, best = PE1" accent={D.violet} w={150} />
      <DNode x={90} y={140} label="PE1" sub="exit 1 · CE1" w={100} />
      <DNode x={320} y={150} label="PE2" sub="sees 1 path" accent={D.warning} w={100} />
      <DNode x={550} y={140} label="RR2 / PE4" sub="exit 2 · CE4" accent={D.bgp} w={120} />
      <DArrow x1={120} y1={118} x2={260} y2={58} color={D.success} label="via 1.1.1.1" />
      <DArrow x1={520} y1={118} x2={390} y2={58} color={D.bgp} label="via 6.6.6.6" />
      <DArrow x1={320} y1={64} x2={320} y2={126} color={D.success} label="best only" />
    </DiagramSvg>
  );
}

function GrowthDiagram() {
  const pts: [number, number][] = [
    [4, 6],
    [10, 45],
    [20, 190],
    [30, 435],
    [40, 780],
    [50, 1225],
  ];
  const x = (n: number) => 70 + (n / 50) * 520;
  const y = (s: number) => 190 - (s / 1225) * 160;
  return (
    <DiagramSvg h={220} label="Full-mesh sessions grow quadratically while RR sessions grow linearly">
      <line x1={70} y1={190} x2={600} y2={190} stroke={D.line} />
      <line x1={70} y1={20} x2={70} y2={190} stroke={D.line} />
      <polyline points={pts.map(([n, s]) => `${x(n)},${y(s)}`).join(" ")} fill="none" stroke={D.danger} strokeWidth={2.5} />
      <polyline points={pts.map(([n]) => `${x(n)},${y(n + 1)}`).join(" ")} fill="none" stroke={D.success} strokeWidth={2.5} />
      <text x={540} y={40} fill={D.danger} fontSize={11} fontWeight={700}>
        full mesh n(n−1)/2
      </text>
      <text x={540} y={176} fill={D.success} fontSize={11} fontWeight={700}>
        with RRs ≈ n
      </text>
      <text x={335} y={212} textAnchor="middle" fill={D.muted} fontSize={10}>
        routers (4 → 50)
      </text>
    </DiagramSvg>
  );
}

function RulesDiagram() {
  return (
    <DiagramSvg h={230} label="Client-learned routes go to everyone; non-client-learned routes go only to clients">
      <DNode x={320} y={115} label="RR" accent={D.violet} w={80} />
      <DNode x={100} y={50} label="client A" sub="source" w={100} />
      <DNode x={100} y={180} label="client B" w={100} />
      <DNode x={540} y={50} label="non-client X" sub="source" accent={D.warning} w={120} />
      <DNode x={540} y={180} label="non-client Y" accent={D.warning} w={120} />
      <DArrow x1={150} y1={62} x2={280} y2={105} color={D.success} />
      <DArrow x1={280} y1={125} x2={150} y2={168} color={D.success} label="A's route" labelDy={18} />
      <DArrow x1={360} y1={125} x2={480} y2={168} color={D.success} label="A's route" labelDy={18} />
      <DArrow x1={480} y1={62} x2={360} y2={105} color={D.warning} />
      <text x={420} y={100} fill={D.warning} fontSize={10} fontWeight={700}>
        X&apos;s route → clients only
      </text>
      <text x={320} y={222} textAnchor="middle" fill={D.muted} fontSize={10}>
        X&apos;s route reaches client B, but never non-client Y
      </text>
    </DiagramSvg>
  );
}

function LoopDiagram() {
  return (
    <DiagramSvg h={200} label="A route that returns to a cluster it already passed through is rejected by its CLUSTER_LIST">
      <DNode x={120} y={60} label="RR-a" sub="cluster 1" accent={D.violet} w={110} />
      <DNode x={520} y={60} label="RR-b" sub="cluster 2" accent={D.bgp} w={110} />
      <DNode x={320} y={160} label="RR-c" sub="cluster 3" accent={D.ospf} w={110} />
      <DArrow x1={176} y1={60} x2={464} y2={60} color={D.faint} label="CL [1]" />
      <DArrow x1={500} y1={82} x2={370} y2={140} color={D.faint} label="CL [2, 1]" labelDy={-4} />
      <DArrow x1={270} y1={140} x2={140} y2={82} color={D.danger} dashed label="CL [3, 2, 1]" labelDy={-4} />
      <text x={120} y={120} textAnchor="middle" fill={D.danger} fontSize={11} fontWeight={700}>
        contains 1 → drop
      </text>
    </DiagramSvg>
  );
}

function RedundancyDiagram() {
  return (
    <DiagramSvg h={200} label="Clients peer with two RRs so that losing one RR doesn't stop reflection">
      <DRegion x={20} y={10} w={600} h={180} label="redundant RR pair" color={D.violet} />
      <DNode x={220} y={60} label="RR1" accent={D.violet} w={80} />
      <DNode x={420} y={60} label="RR2" accent={D.violet} w={80} />
      <DLink x1={260} y1={60} x2={380} y2={60} color={D.warning} dashed label="iBGP" />
      {[120, 270, 370, 520].map((x) => (
        <g key={x}>
          <DLink x1={220} y1={82} x2={x} y2={140} color={D.violet} />
          <DLink x1={420} y1={82} x2={x} y2={140} color={D.violet} />
          <DNode x={x} y={150} label="client" w={80} />
        </g>
      ))}
    </DiagramSvg>
  );
}

function HierarchyDiagram() {
  return (
    <DiagramSvg h={210} label="Top-level RRs serve lower-level RRs as clients, which in turn serve PEs">
      <DNode x={320} y={36} label="Top RR" accent={D.violet} w={100} />
      <DNode x={180} y={110} label="Region RR-1" accent={D.bgp} w={120} />
      <DNode x={460} y={110} label="Region RR-2" accent={D.bgp} w={120} />
      <DLink x1={290} y1={56} x2={200} y2={90} color={D.violet} />
      <DLink x1={350} y1={56} x2={440} y2={90} color={D.violet} />
      {[90, 180, 270].map((x) => (
        <g key={x}>
          <DLink x1={180} y1={132} x2={x} y2={170} color={D.bgp} />
          <DNode x={x} y={180} label="PE" w={60} h={34} />
        </g>
      ))}
      {[370, 460, 550].map((x) => (
        <g key={x}>
          <DLink x1={460} y1={132} x2={x} y2={170} color={D.bgp} />
          <DNode x={x} y={180} label="PE" w={60} h={34} />
        </g>
      ))}
    </DiagramSvg>
  );
}


const QUIZ: KnowledgeQuestion[] = [
  {
    id: "q-split",
    prompt: "Why can't PE2 simply pass PE1's iBGP route on to PE3 in a plain iBGP design?",
    options: [
      { id: "a", label: "iBGP split horizon: an iBGP-learned route is never advertised to another iBGP peer" },
      { id: "b", label: "PE2 has no IGP route to PE3" },
      { id: "c", label: "The AS_PATH would contain 65000 twice" },
    ],
    correctId: "a",
    explanation: "Inside one AS the AS_PATH doesn't change, so it can't detect loops. Split horizon replaces it — at the price of a full mesh.",
  },
  {
    id: "q-nonclient",
    prompt: "RR2 learns 10.1.1.0/24 from RR1, a non-client. To whom may RR2 advertise it?",
    options: [
      { id: "a", label: "Only to its clients" },
      { id: "b", label: "To clients and non-clients" },
      { id: "c", label: "Only to non-clients" },
    ],
    correctId: "a",
    explanation: "Routes from non-clients go to clients only; non-client to non-client is ordinary split horizon.",
  },
  {
    id: "q-cl",
    prompt: "PE3 sees CLUSTER_LIST 200.200.200.200, 100.100.100.100 on PE1's route. What does it tell you?",
    options: [
      { id: "a", label: "The route was reflected by cluster 100… first, then by cluster 200…" },
      { id: "b", label: "PE3 is a client of both clusters" },
      { id: "c", label: "The route crossed two autonomous systems" },
    ],
    correctId: "a",
    explanation: "Each reflector prepends its cluster ID, so the list reads newest first: RR2 (200…) reflected what RR1 (100…) had reflected.",
  },
  {
    id: "q-nh",
    prompt: "Customer traffic from CE3 to 10.1.1.10 — which router does it go to after PE3?",
    options: [
      { id: "a", label: "Toward PE1 (1.1.1.1), along the IGP path" },
      { id: "b", label: "To RR2, which learned the route" },
      { id: "c", label: "To RR1, the first reflector" },
    ],
    correctId: "a",
    explanation: "A reflector doesn't change NEXT_HOP. The route says 1.1.1.1, so traffic goes to PE1 over the IGP (or an LSP).",
  },
  {
    id: "q-samecid",
    prompt: "RR2 is rebuilt with RR1's cluster ID, but each still has its own clients. What happens?",
    options: [
      { id: "a", label: "Each reflector drops the other's reflected routes: nothing crosses between the two groups" },
      { id: "b", label: "Nothing — cluster IDs are only labels" },
      { id: "c", label: "The RR1–RR2 session goes down" },
    ],
    correctId: "a",
    explanation: "A reflector rejects routes whose CLUSTER_LIST contains its own cluster ID. Sharing an ID only works when every client peers with both.",
  },
  {
    id: "q-nhs",
    prompt: "RR1 lists 10.2.2.0/24 from PE2 with next hop 172.16.2.2 (inaccessible). Why don't the other PEs have it at all?",
    options: [
      { id: "a", label: "The path is never best on RR1, and a reflector only advertises its best path" },
      { id: "b", label: "Reflectors never forward eBGP routes" },
      { id: "c", label: "The other PEs drop it because of ORIGINATOR_ID" },
    ],
    correctId: "a",
    explanation: "An unresolvable next hop makes the path invalid. With no best path there is nothing to reflect — the fix is next-hop-self on PE2.",
  },
  {
    id: "q-hiding",
    prompt: "10.9.9.0/24 is reachable through PE1 and PE4. Why does PE2 only see the PE1 path?",
    options: [
      { id: "a", label: "RR1 reflects only its best path; Add-Path would be needed to send both" },
      { id: "b", label: "PE4's path is a loop" },
      { id: "c", label: "PE2 discards the second path" },
    ],
    correctId: "a",
    explanation: "Reflection hides alternatives: clients see the reflector's choice. Add-Path (RFC 7911) or diverse-path designs restore them.",
  },
  {
    id: "q-client-knows",
    prompt: "What must be configured on PE3 to make it a route-reflector client?",
    options: [
      { id: "a", label: "Nothing special — a normal iBGP session to the reflector" },
      { id: "b", label: "route-reflector-client toward RR2" },
      { id: "c", label: "PE3's own cluster ID" },
    ],
    correctId: "a",
    explanation: "Only the reflector knows who its clients are. That's why route reflection can be introduced without touching the clients' software.",
  },
];

export function RrDeepDiveContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="rd-mesh" eyebrow="Foundation" title="The iBGP full-mesh requirement" tone="bgp">
        <DiagramFrame caption="Full-mesh sessions grow with the square of the number of routers; reflector sessions grow linearly.">
          <GrowthDiagram />
        </DiagramFrame>
        <p>
          Every iBGP speaker in an AS must learn every external route. Without help, that means a session from every router to every other: <b className="text-pv-text">n(n−1)/2</b> sessions, and adding a router means configuring all the others. At a few dozen PEs this becomes the bottleneck of the whole network — in configuration, memory, CPU and operational risk.
        </p>
      </GuideSection>

      <GuideSection id="rd-why" eyebrow="Foundation" title="Why iBGP split horizon exists" tone="bgp">
        <p>
          eBGP detects loops with AS_PATH: a router rejects any route that already contains its own AS. iBGP routes never gain an AS hop, so AS_PATH can&apos;t see loops inside the AS. RFC 4271 therefore forbids re-advertising an iBGP-learned route to another iBGP peer. Every router must hear each route directly from the router that brought it into the AS — the full mesh.
        </p>
        <Callout tone="cyan" title="Split horizon is not a bug" icon="i">
          It is the AS&apos;s internal loop protection. Route reflection doesn&apos;t remove it — it relaxes it on chosen sessions and adds two attributes that do the same job.
        </Callout>
      </GuideSection>

      <GuideSection id="rd-network" eyebrow="Foundation" title="The network you will study" tone="cyan">
        <DiagramFrame caption="The Route Reflector Lab: AS 65000, IS-IS between all loopbacks, BGP as drawn. Every output on this page comes from it.">
          <LabNetworkDiagram />
        </DiagramFrame>
        <p className="text-sm text-pv-text-muted">The PEs run eBGP to their customers and advertise the customer prefixes into iBGP with next-hop-self. The reflectors carry no customer traffic.</p>
      </GuideSection>

      <GuideSection id="rd-what" eyebrow="Reflection" title="Route reflection (RFC 4456)" tone="violet">
        <p>
          A <b className="text-pv-text">route reflector</b> is an iBGP speaker allowed to re-advertise iBGP routes on behalf of its <b className="text-pv-text">clients</b>. Clients need no special software or configuration — they run normal iBGP to the reflector. The reflector and its clients form a <b className="text-pv-text">cluster</b>, named by a 4-byte cluster ID (by default the reflector&apos;s router ID).
        </p>
      </GuideSection>

      <GuideSection id="rd-roles" eyebrow="Reflection" title="Reflector, client, non-client" tone="violet">
        <FieldTable
          title="Roles"
          accent="violet"
          columns={["Role", "Configured where", "In the lab"]}
          rows={[
            ["Route reflector", "has at least one client neighbor", "RR1, RR2"],
            ["Client", "on the reflector only (route-reflector-client / a group with cluster)", "PE1, PE2 of RR1; PE3, PE4 of RR2"],
            ["Non-client", "any other iBGP peer of the reflector", "RR1 ↔ RR2"],
          ]}
        />
      </GuideSection>

      <GuideSection id="rd-rules" eyebrow="Reflection" title="The advertisement rules" tone="violet">
        <DiagramFrame caption="Client-learned routes go to everyone; non-client-learned routes go only to clients.">
          <RulesDiagram />
        </DiagramFrame>
        <FieldTable
          title="A reflector's best path, learned from…"
          accent="violet"
          columns={["Learned from", "To clients", "To non-clients", "To eBGP peers"]}
          rows={[
            ["a client", "yes (not back to the sender)", "yes", "yes"],
            ["a non-client", "yes", "no", "yes"],
            ["an eBGP peer", "yes", "yes", "yes"],
          ]}
        />
        <p>Two consequences matter in practice: a reflector only ever advertises its <b className="text-pv-text">best</b> path, and a peer&apos;s role is decided entirely by the reflector&apos;s configuration.</p>
      </GuideSection>

      <GuideSection id="rd-attrs" eyebrow="Reflection" title="ORIGINATOR_ID and CLUSTER_LIST" tone="warning">
        <FieldTable
          title="The reflector's attributes"
          accent="warning"
          columns={["Attribute", "Set by", "Value", "Drop rule"]}
          rows={[
            ["ORIGINATOR_ID (type 9)", "the first reflector, if absent", "router ID of the route's originator in the AS", "a router drops a route carrying its own router ID"],
            ["CLUSTER_LIST (type 10)", "every reflector, prepending", "cluster IDs the route passed through", "a reflector drops a route containing its own cluster ID"],
          ]}
        />
        <Callout tone="cyan" title="Optional, non-transitive" icon="i">
          Both attributes never leave the AS: they are removed when the route is sent to an eBGP peer.
        </Callout>
        <CliPair cisco={cli(WARM, "PE3", "cisco", "show bgp 10.1.1.0/24")} junos={only(WARM, "PE3", "juniper", "show route 10.1.1.10 detail", /10\.1\.1\.0|Source|Protocol next hop|AS path|Cluster list|Originator ID/)} ciscoCaption="IOS XR · PE3" junosCaption="Junos · PE3" />
      </GuideSection>

      <GuideSection id="rd-loops" eyebrow="Reflection" title="Loop prevention in action" tone="danger">
        <DiagramFrame caption="A route returning to a cluster it already passed through is rejected by its CLUSTER_LIST.">
          <LoopDiagram />
        </DiagramFrame>
        <p>In the lab, PE3&apos;s route travels PE3 → RR2 (CLUSTER_LIST 200…) → RR1 (100…, 200…) → PE1 and PE2. RR1 learned it from a non-client, so it never sends it back to RR2 — but if a design error did, RR2 would find 200.200.200.200 in the list and drop it. The cluster ticket shows this check firing on routes that should have been accepted.</p>
      </GuideSection>

      <GuideSection id="rd-best" eyebrow="Paths and next hops" title="Best path through a reflector" tone="success">
        <p>
          A reflector runs the ordinary decision process: valid next hop, then LOCAL_PREF, AS_PATH length, origin, MED, eBGP over iBGP, IGP cost to the next hop. Route reflection adds two late tie-breakers: the <b className="text-pv-text">ORIGINATOR_ID</b> is compared in place of the router ID, and a <b className="text-pv-text">shorter CLUSTER_LIST</b> is preferred (vendors place these slightly differently in the order).
        </p>
        <Callout tone="warning" title="The reflector's view, not the client's" icon="!">
          The IGP cost is measured from the <b>reflector</b>. A client accepts whatever its reflector chose, even if a different exit would be closer to the client. Optimal route reflection (RFC 9107) lets a reflector choose from a client&apos;s point of view.
        </Callout>
      </GuideSection>

      <GuideSection id="rd-visibility" eyebrow="Paths and next hops" title="Path hiding" tone="warning">
        <DiagramFrame caption="Two exits exist; the clients of RR1 only ever hear about one.">
          <HidingDiagram />
        </DiagramFrame>
        <p>
          10.9.9.0/24 is advertised by CE1 (behind PE1) and CE4 (behind PE4). RR1 has both paths, picks the one via PE1 (lower IGP cost from RR1), and reflects only that one. PE2 has no backup path: if PE1 fails, it waits for withdrawals and new updates. <b className="text-pv-text">Add-Path</b> (RFC 7911) lets a reflector send several paths for one prefix.
        </p>
        <CliPanel run={only(WARM, "RR1", "cisco", "show bgp 10.9.9.0/24", /Paths:|Path #|from|Originator|internal/)} caption="IOS XR · RR1 — two paths, best via 1.1.1.1" />
        <CliPanel run={only(WARM, "PE2", "cisco", "show bgp 10.9.9.0/24", /Paths:|Path #|from|Originator|internal/)} caption="IOS XR · PE2 — one path" />
      </GuideSection>

      <GuideSection id="rd-nexthop" eyebrow="Paths and next hops" title="NEXT_HOP and next-hop-self" tone="ip">
        <p>
          A reflector does not change NEXT_HOP, so traffic always flows PE to PE, never through the reflector. That puts one requirement on the PEs: the next hop they advertise must be reachable by everyone. A PE that leaves the eBGP next hop (its CE&apos;s address) in place advertises something the core can&apos;t resolve; that is why PEs set <b className="text-pv-text">next-hop-self</b> toward the reflector.
        </p>
        <CliPair cisco={cli(T.nhs, "RR1", "cisco", "show bgp 10.2.2.0/24")} junos={cli(T.nhs, "RR1", "juniper", "show route 10.2.2.0 hidden")} ciscoCaption="IOS XR · RR1 — next hop inaccessible, no best path" junosCaption="Junos · RR1 — the same route, hidden as Unusable" />
        <p className="text-sm text-pv-text-muted">On IOS XR, next-hop-self configured on a reflector does not touch reflected routes unless <Mono>ibgp policy out enforce-modifications</Mono> is set — reflectors are meant to leave next hops alone.</p>
      </GuideSection>

      <GuideSection id="rd-redundancy" eyebrow="Design" title="Redundant reflectors" tone="violet">
        <DiagramFrame caption="Clients peer with two reflectors so losing one doesn't stop reflection.">
          <RedundancyDiagram />
        </DiagramFrame>
        <p>
          The lab starts with each reflector serving its own clients — losing RR2 isolates PE3 and PE4. The usual production design gives every client two reflectors. The lab&apos;s challenges let you build both: add RR2 as a second reflector for PE1 and PE2, then switch RR1 off and prove nothing is lost.
        </p>
      </GuideSection>

      <GuideSection id="rd-samecluster" eyebrow="Design" title="Same cluster or different?" tone="warning">
        <CompareCards
          items={[
            { title: "One cluster ID", tone: "violet", tag: "shared", points: ["the reflectors drop each other's reflected routes", "less state on each reflector", "every client must peer with both reflectors"] },
            { title: "Different cluster IDs", tone: "success", tag: "separate", points: ["each reflector accepts the other's reflections", "more paths stored, more robust", "survives a client losing one session"] },
          ]}
        />
        <p>The cluster ticket in the lab is the failure mode of the first design applied wrongly: two reflectors with separate clients sharing one ID. Every session is up and nothing crosses.</p>
      </GuideSection>

      <GuideSection id="rd-hierarchy" eyebrow="Design" title="Hierarchical reflection" tone="bgp">
        <DiagramFrame caption="Top-level reflectors treat regional reflectors as clients, which in turn serve PEs.">
          <HierarchyDiagram />
        </DiagramFrame>
        <p>A reflector can itself be the client of a higher-level reflector. CLUSTER_LIST grows by one entry per level, and the loop rules still hold. Large providers use two levels at most: every level adds path hiding.</p>
      </GuideSection>

      <GuideSection id="rd-placement" eyebrow="Design" title="Placement and the data path" tone="cyan">
        <p>Because next hops don&apos;t change, a reflector doesn&apos;t need to sit on the forwarding path. Most providers run <b className="text-pv-text">out-of-path</b> reflectors — often virtual routers — that only carry BGP. Place them for IGP diversity (two failure domains) and keep their IGP view similar to their clients&apos;, or use optimal route reflection.</p>
      </GuideSection>

      <GuideSection id="rd-confed" eyebrow="Design" title="Alternative: confederations" tone="violet">
        <p>A confederation (RFC 5065) splits the AS into sub-ASes that run eBGP-like sessions between them, so AS_PATH-style loop detection works inside the AS. It is more invasive (every router knows its sub-AS) and rarely used alone today; route reflection is the standard answer.</p>
      </GuideSection>

      <GuideSection id="rd-config" eyebrow="Operations" title="Configuring it: IOS XR and Junos" tone="cyan">
        <CliPair cisco={cli(WARM, "RR2", "cisco", "show running-config router bgp")} junos={cli(WARM, "RR2", "juniper", "show configuration protocols bgp")} ciscoCaption="IOS XR · RR2 — per-neighbor client role" junosCaption="Junos · RR2 — the CLIENTS group has a cluster" />
        <CliPair cisco={cli(WARM, "PE1", "cisco", "show running-config router bgp")} junos={cli(WARM, "PE1", "juniper", "show configuration policy-options")} ciscoCaption="IOS XR · PE1 — a plain iBGP neighbor with next-hop-self" junosCaption="Junos · PE1 — next-hop-self is an export policy" />
        <p className="text-sm text-pv-text-muted">IOS XR applies configuration only after <Mono>commit</Mono>; Junos with <Mono>commit</Mono> (or <Mono>commit check</Mono> first). Both keep a rollback history — the lab supports <Mono>rollback configuration last 1</Mono> and <Mono>rollback 1</Mono>.</p>
      </GuideSection>

      <GuideSection id="rd-verify" eyebrow="Operations" title="How to verify" tone="cyan">
        <FieldTable
          title="Questions and commands"
          accent="cyan"
          columns={["Question", "IOS XR", "Junos"]}
          rows={[
            ["Sessions up?", <Mono key="1">show bgp summary</Mono>, <Mono key="2">show bgp summary</Mono>],
            ["Client or not?", <Mono key="3">show bgp neighbors &lt;ip&gt;</Mono>, <Mono key="4">show bgp neighbor &lt;ip&gt;</Mono>],
            ["Which paths, which attributes?", <Mono key="5">show bgp &lt;prefix&gt;</Mono>, <Mono key="6">show route &lt;ip&gt; detail</Mono>],
            ["What is sent to a peer?", <Mono key="7">show bgp neighbors &lt;ip&gt; advertised-routes</Mono>, <Mono key="8">show route advertising-protocol bgp &lt;ip&gt;</Mono>],
            ["What is received?", <Mono key="9">show bgp neighbors &lt;ip&gt; routes</Mono>, <Mono key="10">show route receive-protocol bgp &lt;ip&gt;</Mono>],
            ["Unusable paths?", <Mono key="11">show bgp &lt;prefix&gt; (inaccessible)</Mono>, <Mono key="12">show route &lt;ip&gt; hidden</Mono>],
          ]}
        />
      </GuideSection>

      <GuideSection id="rd-normal" eyebrow="Operations" title="What healthy looks like" tone="success">
        <CliPanel run={rrSummary(WARM, "RR2")} caption="IOS XR · RR2 — two clients and RR1, prefix counts in the last column" />
        <CliPanel run={cli(WARM, "RR1", "cisco", "show bgp neighbors 10.10.10.10 advertised-routes")} caption="IOS XR · RR1 — the three cluster-1 prefixes go to RR2" />
      </GuideSection>

      <GuideSection id="rd-signatures" eyebrow="Troubleshooting" title="Failure signatures" tone="danger">
        <FailureSignatures
          items={[
            { tag: "ROLE", title: "Client configured as non-client", tone: "danger", points: ["session up, only same-cluster routes", "no “Route-Reflector Client” line / wrong Junos group"] },
            { tag: "CID", title: "Shared cluster ID, separate clients", tone: "danger", points: ["peer advertises N prefixes, you accept 0", "nothing crosses between the clusters"] },
            { tag: "NBR", title: "Wrong neighbor address", tone: "warning", points: ["Active in show bgp summary", "an address no router owns"] },
            { tag: "NHS", title: "Missing next-hop-self", tone: "violet", points: ["reflector has the path as inaccessible / Unusable", "nobody else has it at all"] },
            { tag: "POL", title: "Outbound policy", tone: "warning", points: ["one prefix missing in one place", "BGP table has it, advertised-routes doesn't"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="rd-workflow" eyebrow="Troubleshooting" title="Investigation workflow" tone="danger">
        <TroubleshootingFlow
          steps={[
            { question: "What exactly fails?", look: "Which source, which prefix: run the user's test." },
            { question: "Are the sessions Established?", look: "show bgp summary on the reflectors and the PE." },
            { question: "Who is missing what?", look: "Compare the BGP tables: which PE lacks which prefix." },
            { question: "Does the reflector have it — as best?", look: "show bgp <prefix>: present, valid, best? Inaccessible next hop?" },
            { question: "Does it leave the reflector?", look: "advertised-routes toward the PE or the other reflector; then the receiver's accepted count." },
            { question: "Fix one thing, then prove it", look: "the table on the PE, then a fresh customer test." },
          ]}
        />
      </GuideSection>

      <GuideSection id="rd-tickets" eyebrow="Troubleshooting" title="Five faults, evidence to proof" tone="danger">
        <p>The Route Reflector Lab&apos;s five tickets, each output from the lab with the fault in place after the user&apos;s test (IOS XR view).</p>
        <FailureWalk
          title="1 · PE3 only sees half the network"
          normal="PE3 is a client of RR2 and has every customer prefix."
          change="PE3's neighbor on RR2 was rewritten without route-reflector-client."
          evidence={<CliPanel run={only(T.client, "RR2", "cisco", "show bgp 10.1.1.0/24", /Paths|Advertised|6\.6\.6\.6|from|Originator/)} caption="IOS XR · RR2 — best path, advertised to 6.6.6.6 only" />}
          next="show bgp neighbors 5.5.5.5 on RR2: no “Route-Reflector Client”. Routes from RR1 (non-client) may only go to clients."
          fix={<Mono>router bgp 65000 → neighbor 5.5.5.5 → address-family ipv4 unicast → route-reflector-client → commit</Mono>}
          proof="RR2 lists PE3 as a client; PE3 has 10.1.1.0/24 and 10.2.2.0/24; a fresh CE3 → 10.1.1.10 ping succeeds."
        />
        <FailureWalk
          title="2 · The clusters stopped talking"
          normal="RR1 uses cluster 100.100.100.100, RR2 200.200.200.200."
          change="RR2 was rebuilt from RR1's template — cluster ID included."
          evidence={<CliPanel run={only(T.cluster, "RR2", "cisco", "show bgp neighbors 9.9.9.9", /neighbor is|state|accepted|advertised/)} caption="IOS XR · RR2 — RR1 sends 3 prefixes, RR2 accepts 0" />}
          next="RR1's advertised-routes to RR2 lists all three; show running-config on both: the same bgp cluster-id. Each drops the other's routes as loops."
          fix={<Mono>router bgp 65000 → bgp cluster-id 200.200.200.200 → commit (on RR2)</Mono>}
          proof="Different cluster IDs; PE4 learns 10.1.1.0/24 with CLUSTER_LIST 200…, 100…; a fresh CE4 → 10.1.1.10 ping succeeds."
        />
        <FailureWalk
          title="3 · PE4 is an island"
          normal="RR2 peers with 6.6.6.6."
          change="A paper re-addressing turned RR2's neighbor into 6.6.6.7."
          evidence={<CliPanel run={only(T.typo, "RR2", "cisco", "show bgp summary", /Neighbor|^\d/)} caption="IOS XR · RR2 — 6.6.6.7 Active" />}
          next="No router owns 6.6.6.7; PE4's own summary shows its session to 10.10.10.10 never comes up."
          fix={<Mono>router bgp 65000 → no neighbor 6.6.6.7 → neighbor 6.6.6.6 (remote-as, update-source, route-reflector-client) → commit</Mono>}
          proof="RR2 ↔ PE4 Established; PE3 has 10.4.4.0/24; a fresh CE3 → 10.4.4.10 ping succeeds."
        />
        <FailureWalk
          title="4 · Everyone has PE2's route — and nobody uses it"
          normal="PE2 advertises 10.2.2.0/24 with next hop 4.4.4.4."
          change="PE2's migrated config lost next-hop-self."
          evidence={<CliPanel run={only(T.nhs, "RR1", "cisco", "show bgp 10.2.2.0/24", /Paths|Not advertised|inaccessible|internal/)} caption="IOS XR · RR1 — inaccessible, no best path, not advertised" />}
          next="172.16.2.2 is CE2's address on a link outside the IGP. No best path on RR1 means nothing to reflect."
          fix={<Mono>router bgp 65000 → neighbor 9.9.9.9 → address-family ipv4 unicast → next-hop-self → commit (on PE2)</Mono>}
          proof="PE1 has 10.2.2.0/24 via 4.4.4.4; a fresh CE1 → 10.2.2.10 ping succeeds."
        />
        <FailureWalk
          title="5 · One prefix missing across the clusters"
          normal="RR1 sends every cluster-1 prefix to RR2."
          change="A policy update applied route-policy RR1-TO-RR2 out, permitting only two prefixes."
          evidence={<CliPanel run={cli(T.filter, "RR1", "cisco", "show bgp neighbors 10.10.10.10 advertised-routes")} caption="IOS XR · RR1 — 10.2.2.0/24 isn't sent" />}
          next="show running-config prefix-set RR1-TO-RR2: 10.1.1.0/24 and 10.9.9.0/24 only."
          fix={<Mono>add 10.2.2.0/24 to the prefix set, or remove route-policy RR1-TO-RR2 out → commit</Mono>}
          proof="RR1 advertises 10.2.2.0/24 to RR2; PE3 has it; a fresh CE3 → 10.2.2.10 ping succeeds."
        />
      </GuideSection>

      <GuideSection id="rd-beyond" eyebrow="Beyond this lesson" title="Where reflectors go next" tone="violet">
        <FieldTable
          title="The same reflectors, more address families"
          accent="violet"
          columns={["Lesson", "What the reflectors carry"]}
          rows={[
            ["MPLS L3VPN", "VPNv4 routes with RD, route targets and VPN labels — reflected untouched"],
            ["BGP VPLS / EVPN", "L2VPN and EVPN routes between PEs"],
            ["SR / SRv6 services", "the same service routes, over a different transport"],
          ]}
        />
        <p className="text-sm text-pv-text-muted">A plain PE discards VPN routes whose route targets it doesn&apos;t import; a reflector must keep them all (both IOS XR and Junos do so once the router has clients). RT Constrain (RFC 4684) limits what a reflector sends to each PE.</p>
      </GuideSection>

      <GuideSection id="rd-myths" eyebrow="Master it" title="Common misconceptions" tone="warning">
        <Misconceptions
          items={[
            { myth: "A route reflector forwards the customers' traffic.", correction: "It only carries routes. NEXT_HOP is unchanged, so traffic goes PE to PE." },
            { myth: "Clients have to be configured as clients.", correction: "Only the reflector knows; clients run normal iBGP." },
            { myth: "If the session is Established, the PE gets everything.", correction: "Role, loop checks, next hops and policies decide what is reflected." },
            { myth: "Two reflectors should always share a cluster ID.", correction: "Only if every client peers with both. Separate clients need separate IDs." },
            { myth: "The reflector sends every path it knows.", correction: "Only its best path, unless Add-Path is enabled." },
            { myth: "Route reflection removes split horizon.", correction: "Non-client to non-client is still forbidden." },
          ]}
        />
      </GuideSection>

      <GuideSection id="rd-quiz" eyebrow="Master it" title="Knowledge check" tone="cyan">
        <KnowledgeQuiz questions={QUIZ} />
      </GuideSection>

      <GuideSection id="rd-explain" eyebrow="Master it" title="Can you explain it?" tone="violet">
        <ExplainIt
          items={[
            { q: "Why does iBGP need a full mesh without reflectors?", a: "Split horizon forbids passing iBGP routes to iBGP peers, because AS_PATH can't detect loops inside the AS. Each router must hear each route from its originator." },
            { q: "Why does PE4 get RR1's routes from RR2, but a non-client PE3 doesn't?", a: "RR2 learned them from RR1, a non-client. Non-client routes go to clients only: PE4 is a client, PE3 is not." },
            { q: "What do ORIGINATOR_ID and CLUSTER_LIST each protect against?", a: "ORIGINATOR_ID stops a route returning to the router that brought it into the AS; CLUSTER_LIST stops it re-entering a cluster it already passed through." },
            { q: "Why can a reflector have a route and still not reflect it?", a: "It only reflects its best path. An unresolvable next hop (missing next-hop-self) makes the path invalid, and an outbound policy can block it per neighbor." },
            { q: "Why doesn't customer traffic pass through the reflector?", a: "The reflector leaves NEXT_HOP unchanged, so every PE forwards toward the originating PE's loopback over the IGP or an LSP." },
          ]}
        />
      </GuideSection>

      <GuideSection id="rd-practice" eyebrow="Master it" title="Practice in the Route Reflector Lab" tone="success">
        <p>Six Learn levels take you from the full mesh to the evidence ladder; the engineering workspace gives you both reflectors and all four PEs (IOS XR or Junos), customer tests, five design challenges and the five tickets above.</p>
        <LabBridge />
        <PresentationBridge>Rewatch the route reflector presentation.</PresentationBridge>
      </GuideSection>
    </div>
  );
}
