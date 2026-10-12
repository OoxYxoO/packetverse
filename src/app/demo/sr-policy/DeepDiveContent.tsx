import { Callout, DArrow, DIAGRAM as D, DNode, DPill, DiagramFrame, DiagramSvg, FailureSignatures, FieldTable, Glossary, GuideSection, Misconceptions, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { DStack } from "@/components/lesson/MplsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { ExplainIt, KnowledgeQuiz, PracticeBridge, type KnowledgeQuestion } from "@/components/lesson/GuideInteractive";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import { PresentationBridge } from "@/components/presentation/LessonPresentation";
import { CliPanel, FailureWalk } from "@/components/lesson/GuideCli";
import { createSrpNet, srpApply, spTicket, srpTicketState, type SpAction, type SpState, type SpTicketId } from "@/lib/sim-engine/scenarios/srpNet";
import { SrpResult, srpCli, srpOnly } from "./LessonGuideContent";

const G = { foundation: "Foundation", cands: "Candidate paths", steer: "Steering", data: "Data plane", ops: "Operations", trouble: "Troubleshooting", master: "Master it" };
export const SRP_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "pd-why", label: "Why policies, not lists", group: G.foundation },
  { id: "pd-arch", label: "SR policy architecture", group: G.foundation },
  { id: "pd-identity", label: "Identity and color", group: G.foundation },
  { id: "pd-selection", label: "Candidate path selection", group: G.cands },
  { id: "pd-explicit", label: "Explicit paths and validation", group: G.cands },
  { id: "pd-dynamic", label: "Dynamic paths and constraints", group: G.cands },
  { id: "pd-encoding", label: "Encoding a path as segments", group: G.cands },
  { id: "pd-weights", label: "Preference vs weight", group: G.cands },
  { id: "pd-bsid", label: "The binding SID", group: G.steer },
  { id: "pd-steering", label: "Steering methods", group: G.steer },
  { id: "pd-invalid", label: "When the policy is down", group: G.steer },
  { id: "pd-wire", label: "Policy list vs wire stack", group: G.data },
  { id: "pd-fallback", label: "Re-selection vs local repair", group: G.data },
  { id: "pd-config", label: "Configuring it on IOS XR", group: G.ops },
  { id: "pd-verify", label: "How to verify", group: G.ops },
  { id: "pd-signatures", label: "Failure signatures", group: G.trouble },
  { id: "pd-ladder", label: "The troubleshooting ladder", group: G.trouble },
  { id: "pd-tickets", label: "Five faults, evidence to proof", group: G.trouble },
  { id: "pd-myths", label: "Common misconceptions", group: G.master },
  { id: "pd-quiz", label: "Knowledge check", group: G.master },
  { id: "pd-explain", label: "Can you explain it?", group: G.master },
  { id: "pd-glossary", label: "Glossary", group: G.master },
  { id: "pd-mental", label: "Mental model", group: G.master },
  { id: "pd-practice", label: "Practice in the SR Policy Lab", group: G.master },
];

// Real IOS XR output and test results: the SR Policy Lab's command set and model.
const P0: SpState = createSrpNet(0);
const run = (s: SpState, ...a: SpAction[]) => a.reduce((acc, x) => srpApply(acc, x), s);
const ticket = (id: SpTicketId) => spTicket(id).repro.reduce((acc, a) => srpApply(acc, a), srpTicketState(id, 1));
const T = { pref: ticket("pref"), color: ticket("color"), endpoint: ticket("endpoint"), srdisabled: ticket("srdisabled"), listtypo: ticket("listtypo") };
const LBL_FAIL = run(P0, { type: "set", text: "label list", changes: [{ dev: "R1", f: (c) => void (c.lists["GOLD-EXPLICIT"] = [{ idx: 10, label: 16003 }, { idx: 20, label: 24035 }, { idx: 30, label: 16006 }]) }] }, { type: "link", id: "R3-R5", up: false }, { type: "ping", to: "H6" });
const BLUE = run(P0, { type: "set", text: "BLUE dynamic", changes: [{ dev: "R1", f: (c) => void Object.assign(c.policies[0].cands.find((k) => k.kind === "dynamic")!, { include: ["BLUE"] }) }] });

function LabBridge() {
  const openLab = usePracticeLabOpener();
  return (
    <PracticeBridge label="Open the SR Policy Lab" onPractice={openLab}>
      Policy GOLD on R1, IOS XR on every router, BGP color steering and link failures — your own copy. Nothing you do there changes your lesson progress.
    </PracticeBridge>
  );
}

function ArchitectureDiagram() {
  return (
    <DiagramSvg h={200} label="A policy identified by headend, color and endpoint holds candidate paths; each candidate has one or more segment lists; the active candidate's list is imposed">
      <DNode x={320} y={34} label="SR Policy" sub="⟨headend, color, endpoint⟩" accent={D.violet} w={200} />
      <DNode x={170} y={104} label="Candidate A" sub="preference, validity" accent={D.mpls} w={170} />
      <DNode x={470} y={104} label="Candidate B" sub="preference, validity" accent={D.mpls} w={170} />
      <DArrow x1={280} y1={57} x2={200} y2={81} color={D.faint} width={1.4} />
      <DArrow x1={360} y1={57} x2={440} y2={81} color={D.faint} width={1.4} />
      <DPill x={170} y={168} text="segment list(s)" color={D.cyan} w={130} />
      <DPill x={470} y={168} text="segment list(s)" color={D.cyan} w={130} />
      <DArrow x1={170} y1={127} x2={170} y2={154} color={D.faint} width={1.4} />
      <DArrow x1={470} y1={127} x2={470} y2={154} color={D.faint} width={1.4} />
    </DiagramSvg>
  );
}

function PreferenceDiagram() {
  const rows = [
    { name: "Candidate A", pref: "pref 200", valid: false },
    { name: "Candidate B", pref: "pref 100", valid: true },
    { name: "Candidate C", pref: "pref 50", valid: true },
  ];
  return (
    <DiagramSvg h={170} label="Invalid candidates are removed first; among the valid ones the highest preference becomes active">
      {rows.map((r, i) => (
        <g key={r.name} opacity={r.valid ? 1 : 0.55}>
          <rect x={40} y={20 + i * 44} width={250} height={32} rx={8} fill={D.box} stroke={r.valid ? D.cyan : D.danger} strokeOpacity={0.8} />
          <text x={56} y={41 + i * 44} fill={D.text} fontSize={11} fontWeight={700}>
            {r.name}
          </text>
          <text x={274} y={41 + i * 44} textAnchor="end" fill={D.muted} fontSize={10.5} fontFamily="monospace">
            {r.pref}
          </text>
          <text x={306} y={41 + i * 44} fill={r.valid ? D.success : D.danger} fontSize={10.5} fontWeight={700}>
            {r.valid ? "VALID" : "INVALID — ignored"}
          </text>
        </g>
      ))}
      <DPill x={530} y={80} text="ACTIVE: Candidate B" color={D.success} w={170} />
      <text x={320} y={160} textAnchor="middle" fill={D.muted} fontSize={10}>
        validity first, preference second
      </text>
    </DiagramSvg>
  );
}

function BsidDiagram() {
  return (
    <DiagramSvg h={170} label="An upstream node can push the BSID; the headend that owns it replaces the BSID with the active segment list">
      <DNode x={80} y={60} label="Upstream" w={110} />
      <DNode x={320} y={60} label="Headend" sub="owns the BSID" accent={D.violet} w={130} />
      <DNode x={560} y={60} label="Endpoint" accent={D.mpls} w={110} />
      <DArrow x1={137} y1={60} x2={253} y2={60} color={D.violet} />
      <DArrow x1={387} y1={60} x2={503} y2={60} color={D.mpls} />
      <DStack x={195} y={86} labels={[{ text: "BSID", color: D.violet }]} payload="payload" w={80} />
      <DStack x={445} y={86} labels={[{ text: "segment list" }]} payload="payload" w={100} />
      <text x={320} y={160} textAnchor="middle" fill={D.muted} fontSize={10}>
        the general BSID use; in this lesson R1 resolves 30001 locally and never puts it on the wire
      </text>
    </DiagramSvg>
  );
}

function WeightDiagram() {
  return (
    <DiagramSvg h={160} label="Inside one active candidate, traffic can be split across segment lists by weight, for example 70 and 30">
      <DNode x={100} y={75} label="Active candidate" accent={D.mpls} w={150} />
      <DArrow x1={177} y1={66} x2={380} y2={36} color={D.cyan} />
      <DArrow x1={177} y1={84} x2={380} y2={114} color={D.cyan} />
      <DPill x={470} y={36} text="segment list A · weight 70" color={D.cyan} w={180} />
      <DPill x={470} y={114} text="segment list B · weight 30" color={D.cyan} w={180} />
      <text x={320} y={152} textAnchor="middle" fill={D.muted} fontSize={10}>
        preference picks the candidate; weight shares load inside it (not modeled in the lesson)
      </text>
    </DiagramSvg>
  );
}

function FallbackTimelineDiagram() {
  return (
    <DiagramSvg h={170} label="Candidate fallback happens at the headend after it learns of the failure; TI-LFA acts at the point of local repair immediately">
      <text x={20} y={40} fill={D.violet} fontSize={11} fontWeight={700}>
        SR Policy fallback
      </text>
      <DArrow x1={170} y1={36} x2={600} y2={36} color={D.violet} />
      <text x={385} y={60} textAnchor="middle" fill={D.muted} fontSize={10}>
        failure → IGP flooding → headend re-selects a valid candidate
      </text>
      <text x={20} y={110} fill={D.success} fontSize={11} fontWeight={700}>
        TI-LFA local repair
      </text>
      <DArrow x1={170} y1={106} x2={330} y2={106} color={D.success} />
      <text x={250} y={130} textAnchor="middle" fill={D.muted} fontSize={10}>
        the local repair point reacts at once
      </text>
      <text x={320} y={160} textAnchor="middle" fill={D.muted} fontSize={10}>
        different place, different time — they complement each other
      </text>
    </DiagramSvg>
  );
}


const QUIZ: KnowledgeQuestion[] = [
  {
    id: "q-identity",
    prompt: "What identifies an SR policy on its headend?",
    options: [
      { id: "a", label: "Its color and end-point" },
      { id: "b", label: "Its binding SID" },
      { id: "c", label: "Its name" },
    ],
    correctId: "a",
    explanation: "RFC 9256: ⟨headend, color, end-point⟩. The name and the BSID are attributes.",
  },
  {
    id: "q-select",
    prompt: "Candidate 200 is invalid, candidate 100 is valid. Which is active?",
    options: [
      { id: "a", label: "100 — only valid candidates compete" },
      { id: "b", label: "200 — higher preference" },
      { id: "c", label: "None until 200 is fixed" },
    ],
    correctId: "a",
    explanation: "Validity first, then preference.",
  },
  {
    id: "q-steer",
    prompt: "R6 stops coloring 192.168.6.0/24. What happens to its traffic on R1?",
    options: [
      { id: "a", label: "It is no longer steered and follows R6's Node SID" },
      { id: "b", label: "It is dropped" },
      { id: "c", label: "It still uses the policy — the next hop matches" },
    ],
    correctId: "a",
    explanation: "Automated steering needs both: the color and the next hop matching the policy.",
  },
  {
    id: "q-validate",
    prompt: "A segment list written with MPLS labels has a wrong second label. What does the policy state show?",
    options: [
      { id: "a", label: "Up — only the first label is checked; traffic dies where the wrong label is executed" },
      { id: "b", label: "Down — every label is validated" },
      { id: "c", label: "The dynamic candidate takes over" },
    ],
    correctId: "a",
    explanation: "Address-based lists are validated hop by hop; label-based lists only by their first SID.",
  },
  {
    id: "q-frr",
    prompt: "R3–R5 fails and the dynamic candidate becomes active. Is that fast reroute?",
    options: [
      { id: "a", label: "No — headend re-selection after IGP convergence" },
      { id: "b", label: "Yes — that is TI-LFA" },
      { id: "c", label: "Yes — RSVP FRR" },
    ],
    correctId: "a",
    explanation: "Local protection at the point of failure is TI-LFA, a later lesson.",
  },
];

export function SrPolicyDeepDiveContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="pd-why" eyebrow="Foundation" title="Why policies, not lists" tone="mpls">
        <p>A segment list is a path. To operate traffic engineering you need more: an intent that survives failures, a choice between paths, a way to attract exactly the traffic that needs it, and a handle others can use. An SR policy (RFC 9256) is that container — and it lives on the headend only, so the core stays stateless.</p>
      </GuideSection>

      <GuideSection id="pd-arch" eyebrow="Foundation" title="SR policy architecture" tone="mpls">
        <DiagramFrame caption="Policy → candidate paths → segment lists → forwarding; steering feeds traffic in.">
          <ArchitectureDiagram />
        </DiagramFrame>
        <p>A policy holds candidate paths; each candidate holds one or more segment lists (with weights); the active candidate&apos;s lists are programmed under the policy&apos;s binding SID. Candidates can be configured locally, delivered by BGP (SR Policy SAFI) or by a PCE (PCEP) — this lesson configures them locally.</p>
      </GuideSection>

      <GuideSection id="pd-identity" eyebrow="Foundation" title="Identity and color" tone="violet">
        <p>The policy is identified by <b className="text-pv-text">color</b> and <b className="text-pv-text">end-point</b> on its headend. Color is a 32-bit opaque value; its meaning (low latency, GOLD application, avoid a region) is a convention. The same color toward different end-points makes different policies; two colors toward the same end-point can take different paths.</p>
        <CliPanel run={srpOnly(P0, "R1", "show segment-routing traffic-eng policy", /Color:|Name: srte|Admin|Binding SID/)} caption="IOS XR · R1 — srte_c_100_ep_10.0.0.6: the name IOS XR derives from the identity" />
      </GuideSection>

      <GuideSection id="pd-selection" eyebrow="Candidate paths" title="Candidate path selection" tone="warning">
        <DiagramFrame caption="Preference decides only among valid candidates.">
          <PreferenceDiagram />
        </DiagramFrame>
        <p>Every candidate is validated; the valid one with the highest preference is active (RFC 9256 also defines tie-breaks between candidates from different sources). When the active candidate becomes invalid, the next valid one takes over; when the original comes back, it is active again.</p>
      </GuideSection>

      <GuideSection id="pd-explicit" eyebrow="Candidate paths" title="Explicit paths and validation" tone="mpls">
        <FieldTable
          title="Two ways to write a segment list on IOS XR"
          accent="mpls"
          columns={["Form", "Example", "Validated"]}
          rows={[
            [<Mono key="a">index N address ipv4 A</Mono>, "10.0.0.3 · 10.1.35.5 · 10.0.0.6", "every hop, against the SR-TE topology"],
            [<Mono key="b">index N mpls label L</Mono>, "16003 · 24035 · 16006", "only the first label, at the headend"],
          ]}
        />
        <p>Addresses resolve to SIDs: a loopback becomes its Prefix-SID, the remote address of a link becomes the Adjacency SID toward it. If a hop can&apos;t be resolved — a link is down — the candidate is invalid. Raw labels are taken on trust: with R3–R5 down, a label-based list stays valid and traffic dies at R3.</p>
        <SrpResult s={LBL_FAIL} title="The lab: the same list written as labels, with R3–R5 down" />
      </GuideSection>

      <GuideSection id="pd-dynamic" eyebrow="Candidate paths" title="Dynamic paths and constraints" tone="mpls">
        <p>A dynamic candidate is computed by the headend (or a PCE) from the TE topology the IGP floods: TE metric, IGP metric or latency as the objective; affinities (include-any, include-all, exclude-any), SRLGs and segment-count limits as constraints. Change a constraint and the path follows:</p>
        <CliPanel run={srpOnly(BLUE, "R1", "show segment-routing traffic-eng policy", /Preference: 100|Dynamic|Metric Type|Affinity|^\s+16006/)} caption="IOS XR · R1 — include-any BLUE: the dynamic path becomes the top path, [16006]" />
        <Callout tone="warning" title="No reservation" icon="!">
          SR policies compute paths; they don&apos;t reserve bandwidth on the routers along them. Bandwidth-aware placement needs a controller that tracks utilization.
        </Callout>
      </GuideSection>

      <GuideSection id="pd-encoding" eyebrow="Candidate paths" title="Encoding a path as segments" tone="mpls">
        <p>The headend turns the computed path into the fewest segments: a Node SID wherever the plain IGP shortest path already goes the same way, an Adjacency SID where it doesn&apos;t. R1 → R3 → R5 → R6 becomes <Mono>[16005, 16006]</Mono>: the shortest path to R5 is via R3, and from R5 to R6 it is the direct link. With R3–R5 down, R1 → R3 → R4 → R6 becomes <Mono>[16003, 16006]</Mono>.</p>
      </GuideSection>

      <GuideSection id="pd-weights" eyebrow="Candidate paths" title="Preference vs weight" tone="cyan">
        <DiagramFrame caption="Preference chooses a candidate; weight shares traffic between segment lists inside it.">
          <WeightDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="pd-bsid" eyebrow="Steering" title="The binding SID" tone="violet">
        <DiagramFrame caption="One label on the headend stands for the whole active list.">
          <BsidDiagram />
        </DiagramFrame>
        <p>The BSID decouples users from paths: another domain, a controller or a longer segment list can push 30001 and let R1 decide. It also shortens label stacks — one label instead of a whole list.</p>
        <CliPanel run={srpOnly(P0, "R1", "show mpls forwarding labels 30001", /Local|Label  |----|^30001/)} caption="IOS XR · R1 — the BSID in the forwarding table" />
      </GuideSection>

      <GuideSection id="pd-steering" eyebrow="Steering" title="Steering methods" tone="cyan">
        <FieldTable
          title="How traffic gets into a policy"
          accent="cyan"
          columns={["Method", "How"]}
          rows={[
            ["Automated steering (this lab)", "BGP route with color C and next hop E → policy (C, E)"],
            ["On-demand next hop (ODN)", "a colored route triggers the headend to create the policy from a template"],
            ["Binding SID", "a packet arrives with the BSID on top"],
            ["Per-flow / static", "local classification or static routes into the policy"],
          ]}
        />
        <CliPanel run={srpOnly(P0, "R1", "show bgp ipv4 unicast 192.168.6.0/24", /routing table entry|C:100|Extended community|SR policy/)} caption="IOS XR · R1 — the colored route, steered" />
        <CliPanel run={srpCli(P0, "R6", "show running-config route-policy")} caption="IOS XR · R6 — the policy that sets the color" />
      </GuideSection>

      <GuideSection id="pd-invalid" eyebrow="Steering" title="When the policy is down" tone="danger">
        <p>With no valid candidate, the policy is down and its BSID is withdrawn. Routes steered by color then resolve over their next hop as if they had no color — the IOS XR default — so traffic keeps flowing on the ordinary path. Some designs prefer to drop instead, so GOLD traffic never takes a path that violates its intent; that is a per-policy choice.</p>
      </GuideSection>

      <GuideSection id="pd-wire" eyebrow="Data plane" title="Policy list vs wire stack" tone="mpls">
        <p>The headend executes the first segment itself, so the wire stack is the list minus whatever R1 already completed. Transit routers see ordinary SR labels — no color, no preference, no policy.</p>
        <CliPanel run={srpOnly(P0, "R1", "show cef 192.168.6.0/24", /^192|local-label|next hop/)} caption="IOS XR · R1 — labels imposed {24035 16006}" />
      </GuideSection>

      <GuideSection id="pd-fallback" eyebrow="Data plane" title="Re-selection vs local repair" tone="danger">
        <DiagramFrame caption="Detection, IGP flooding, headend re-validation — then the switch.">
          <FallbackTimelineDiagram />
        </DiagramFrame>
        <p>Candidate switchover is a headend decision after the IGP has converged — hundreds of milliseconds to seconds. Sub-50 ms protection comes from TI-LFA at the point of failure, which repairs traffic locally while the headend re-selects.</p>
      </GuideSection>

      <GuideSection id="pd-config" eyebrow="Operations" title="Configuring it on IOS XR" tone="mpls">
        <p>Under <Mono>segment-routing traffic-eng</Mono>: affinity names in <Mono>affinity-map</Mono>, each interface&apos;s affinities, the segment lists, and the policy with its color, end-point, binding SID and candidate paths. IS-IS floods the TE attributes (<Mono>mpls traffic-eng</Mono> under its address family). On R6, the route-policy sets the color on export.</p>
        <CliPanel run={srpCli(P0, "R1", "show running-config segment-routing")} caption="IOS XR · R1 — the whole SR-TE configuration" />
      </GuideSection>

      <GuideSection id="pd-verify" eyebrow="Operations" title="How to verify" tone="success">
        <FieldTable
          title="On the headend"
          accent="success"
          columns={["Question", "IOS XR"]}
          rows={[
            ["Policy up? Active candidate? Segment lists?", <Mono key="1">show segment-routing traffic-eng policy [color 100]</Mono>],
            ["Is the route colored and steered?", <Mono key="2">show bgp ipv4 unicast 192.168.6.0/24</Mono>],
            ["Which labels leave the headend?", <Mono key="3">show cef 192.168.6.0/24</Mono>],
            ["Is the BSID programmed?", <Mono key="4">show mpls forwarding labels 30001</Mono>],
            ["Does a list work end to end?", <Mono key="5">ping sr-mpls nil-fec labels … output interface … nexthop …</Mono>],
          ]}
        />
      </GuideSection>

      <GuideSection id="pd-signatures" eyebrow="Troubleshooting" title="Failure signatures" tone="danger">
        <FailureSignatures
          items={[
            { tag: "PRF", title: "Preferences swapped", tone: "warning", points: ["up, delivered", "the other candidate is active"] },
            { tag: "CLR", title: "Route lost its color", tone: "danger", points: ["up", "GOLD prefix not steered"] },
            { tag: "EP", title: "Wrong end-point", tone: "danger", points: ["up", "BGP: policy not found"] },
            { tag: "SR", title: "No SR on a path router", tone: "violet", points: ["up", "GOLD dropped mid-path"] },
            { tag: "LBL", title: "Wrong label", tone: "violet", points: ["up (label list)", "dropped where executed"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="pd-ladder" eyebrow="Troubleshooting" title="The troubleshooting ladder" tone="danger">
        <TroubleshootingFlow
          steps={[
            { question: "Which traffic is affected?", look: "GOLD only, default only, or both." },
            { question: "Is IS-IS up and every router SR-capable?", look: "Adjacencies, label tables." },
            { question: "Is the policy up, with the right color and end-point?", look: "The policy database." },
            { question: "Which candidate is active, and why?", look: "Validity and preference." },
            { question: "Is the route colored and steered?", look: "The BGP route on the headend." },
            { question: "Does every label exist where it is executed?", look: "Follow the stack hop by hop." },
          ]}
        />
      </GuideSection>

      <GuideSection id="pd-tickets" eyebrow="Troubleshooting" title="Five faults, evidence to proof" tone="danger">
        <FailureWalk
          title="1 · Not the engineered path"
          normal="The explicit candidate has preference 200, the dynamic one 100."
          change="The explicit candidate's preference was set to 80."
          evidence={<CliPanel run={srpOnly(T.pref, "R1", "show segment-routing traffic-eng policy", /Preference/)} caption="IOS XR · R1 — preference 100 active" />}
          next="Both valid; 100 beats 80. Same routers, different stack: [16005, 16006]."
          fix={<Mono>R1: policy GOLD → candidate-paths → no preference 80 → preference 200 → explicit segment-list GOLD-EXPLICIT → commit</Mono>}
          proof="Preference 200 active; a fresh GOLD ping leaves R1 with [24035, 16006]."
        />
        <FailureWalk
          title="2 · GOLD on the default path"
          normal="R6 colors 192.168.6.0/24 with 100."
          change="R6's template no longer applies route-policy SET-COLOR out."
          evidence={<CliPanel run={srpOnly(T.color, "R1", "show bgp ipv4 unicast 192.168.6.0/24", /routing table entry|from 10\.0\.0\.6|Extended community|SR policy/)} caption="IOS XR · R1 — no color on the route" />}
          next="The policy is up, but nothing is steered into it."
          fix={<Mono>R6: router bgp 65000 → neighbor 10.0.0.1 → address-family ipv4 unicast → route-policy SET-COLOR out → commit</Mono>}
          proof="C:100 on R1; a fresh GOLD ping is steered over R3 and R5."
        />
        <FailureWalk
          title="3 · After the policy was re-created"
          normal="Policy GOLD: color 100, end-point 10.0.0.6."
          change="The re-created policy says end-point 10.0.0.66."
          evidence={<CliPanel run={srpOnly(T.endpoint, "R1", "show bgp ipv4 unicast 192.168.6.0/24", /C:100|SR policy/)} caption="IOS XR · R1 — color 100, but no policy for 10.0.0.6" />}
          next="(100, 10.0.0.6) matches nothing; the route resolves normally."
          fix={<Mono>R1: policy GOLD → color 100 end-point ipv4 10.0.0.6 → commit</Mono>}
          proof="The route shows the BSID again; a fresh GOLD ping is steered."
        />
        <FailureWalk
          title="4 · Only GOLD is broken"
          normal="Every router runs segment routing."
          change="R5 lost segment-routing mpls."
          evidence={<SrpResult s={T.srdisabled} title="The lab: the GOLD ping" />}
          next="The explicit list still validates; R5 receives 16006 and has no label table."
          fix={<Mono>R5: router isis CORE → address-family ipv4 unicast → segment-routing mpls → commit</Mono>}
          proof="R5 programs 16006; a fresh GOLD ping reaches H6."
        />
        <FailureWalk
          title="5 · A segment list from the change ticket"
          normal="GOLD-EXPLICIT resolves to [16003, 24035, 16006]."
          change="It was re-typed with labels: 16003, 24053, 16006."
          evidence={<CliPanel run={srpOnly(T.listtypo, "R1", "show running-config segment-routing", /segment-list|index/)} caption="IOS XR · R1 — index 20 mpls label 24053" />}
          next="Only the first label is checked: up. R3 receives 24053 — R5's Adjacency SID — and drops it."
          fix={<Mono>R1: segment-list GOLD-EXPLICIT → index 20 mpls label 24035 (better: address ipv4 10.1.35.5) → commit</Mono>}
          proof="A fresh GOLD ping leaves R1 with [24035, 16006] and reaches H6."
        />
      </GuideSection>

      <GuideSection id="pd-myths" eyebrow="Master it" title="Common misconceptions" tone="warning">
        <Misconceptions
          items={[
            { myth: "Color is a label or a QoS marking.", correction: "It is an opaque intent identifier, carried in BGP." },
            { myth: "The highest preference is always active.", correction: "Only among valid candidates." },
            { myth: "A policy that is up carries the traffic.", correction: "Only steered traffic uses it — check the route's color and next hop." },
            { myth: "Every label of an explicit list is validated.", correction: "Only addresses are; label lists are checked at the first label." },
            { myth: "Candidate switchover is fast reroute.", correction: "It is headend re-selection; TI-LFA protects locally." },
          ]}
        />
      </GuideSection>

      <GuideSection id="pd-quiz" eyebrow="Master it" title="Knowledge check" tone="cyan">
        <KnowledgeQuiz questions={QUIZ} />
      </GuideSection>

      <GuideSection id="pd-explain" eyebrow="Master it" title="Can you explain it?" tone="violet">
        <ExplainIt
          items={[
            { q: "What is the difference between a segment list and an SR policy?", a: "A list is a path; a policy is an intent (color, end-point) with candidate paths, validation, fallback and a BSID." },
            { q: "Why is the explicit candidate active, and when does that change?", a: "It is valid with the highest preference (200); it changes when it becomes invalid or its preference drops below the dynamic one." },
            { q: "How does 192.168.6.0/24 end up in the policy, and 192.168.60.0/24 not?", a: "Only the first carries color 100; with next hop 10.0.0.6 it matches policy (100, 10.0.0.6)." },
            { q: "Why can a label-based list hide a typo?", a: "IOS XR checks only its first label; the rest is executed blindly by the routers on the path." },
            { q: "What does the BSID buy you?", a: "A stable handle for the policy: users push one label and the headend decides the path." },
          ]}
        />
      </GuideSection>

      <GuideSection id="pd-glossary" eyebrow="Master it" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "SR policy", def: "⟨headend, color, end-point⟩ with candidate paths (RFC 9256)." },
            { term: "Candidate path", def: "Explicit or dynamic way to realize a policy, with a preference." },
            { term: "Segment list weight", def: "Traffic share between lists of one candidate." },
            { term: "Binding SID", def: "A label on the headend that stands for the active list." },
            { term: "Affinity", def: "Administrative link colors used as constraints." },
            { term: "Automated steering", def: "Colored BGP routes steered into the matching policy." },
            { term: "ODN", def: "On-demand next hop: policies created from templates when colored routes appear." },
            { term: "PCE", def: "Path Computation Element: an external computer of paths (PCEP)." },
          ]}
        />
      </GuideSection>

      <GuideSection id="pd-mental" eyebrow="Master it" title="Mental model" tone="violet">
        <p>The headend holds a contract per (color, destination); the contract ranks plans; the best plan that still works is followed; traffic signs up by wearing the contract&apos;s color; nobody on the road knows the contract exists.</p>
      </GuideSection>

      <GuideSection id="pd-practice" eyebrow="Master it" title="Practice in the SR Policy Lab" tone="violet">
        <p>Six Learn levels, then the workspace: R1&apos;s policy and candidates, every router&apos;s interfaces and affinities, an IOS XR console, link failures, five challenges and the five tickets above.</p>
        <LabBridge />
        <PresentationBridge>Rewatch the SR Policy presentation.</PresentationBridge>
      </GuideSection>
    </div>
  );
}
