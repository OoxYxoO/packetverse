import { CompareCards, DArrow, DIAGRAM as D, DNode, DPill, DiagramFrame, DiagramSvg, FailureSignatures, FieldTable, Glossary, GuideSection, Misconceptions, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { DHeaderColumn } from "@/components/lesson/Srv6GuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { ExplainIt, KnowledgeQuiz, PracticeBridge, type KnowledgeQuestion } from "@/components/lesson/GuideInteractive";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import { PresentationBridge } from "@/components/presentation/LessonPresentation";
import { CliPanel, FailureWalk } from "@/components/lesson/GuideCli";
import { createPNet, pApply, type PState } from "@/lib/sim-engine/scenarios/s6pNet";
import { P6Result, p6Block, p6Cli, p6Only, p6Policy, p6TicketRun } from "./LessonGuideContent";

const G = { foundation: "Foundation", compute: "Candidates and selection", steer: "Steering and encapsulation", ops: "Operations", trouble: "Troubleshooting", master: "Master it" };
export const SRV6P_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "pd-arch", label: "The SR policy architecture", group: G.foundation },
  { id: "pd-identity", label: "Identity: headend, color, end-point", group: G.foundation },
  { id: "pd-sources", label: "Where candidates come from", group: G.foundation },
  { id: "pd-validity", label: "When a candidate is valid", group: G.compute },
  { id: "pd-selection", label: "Selecting the active candidate", group: G.compute },
  { id: "pd-dynamic", label: "Dynamic paths and SID encoding", group: G.compute },
  { id: "pd-stale", label: "Dynamic SIDs and explicit lists", group: G.compute },
  { id: "pd-steering", label: "Automated steering", group: G.steer },
  { id: "pd-bsid", label: "Binding SIDs and stitching", group: G.steer },
  { id: "pd-encaps", label: "H.Encaps and H.Encaps.Red", group: G.steer },
  { id: "pd-invalid", label: "When the policy goes down", group: G.steer },
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
  { id: "pd-practice", label: "Practice in the SRv6 Policy Lab", group: G.master },
];

// Real IOS XR output and test results: the SRv6 Policy Lab's command set and model.
const P0: PState = createPNet(0);
const T = { staleendx: p6TicketRun("staleendx"), r3srv6: p6TicketRun("r3srv6"), color: p6TicketRun("color"), endpoint: p6TicketRun("endpoint"), pref: p6TicketRun("pref") };
const IGP = pApply(P0, p6Policy(P0, (p) => void (p.cands[1].metric = "igp")));
const NOCOLOR67 = pApply(P0, { type: "send", to: "RX67" });

function LabBridge() {
  const openLab = usePracticeLabOpener();
  return (
    <PracticeBridge label="Open the SRv6 Policy Lab" onPractice={openLab}>
      Policy LOW-LATENCY on IOS XR with a controller window to edit it, traffic to two receivers, links to fail and flap — your own copy. Nothing you do there changes your lesson progress.
    </PracticeBridge>
  );
}

function ArchitectureDiagram() {
  return (
    <DiagramSvg h={200} label="An SR Policy identified by headend, color and endpoint holds candidate paths; each candidate holds one or more weighted segment lists; the selected candidate's lists are installed">
      <DNode x={320} y={32} label="SR Policy" sub="⟨headend, color, endpoint⟩ + BSID" accent={D.violet} w={230} />
      <DNode x={170} y={104} label="Candidate path" sub="preference, validity" accent={D.mpls} w={170} />
      <DNode x={470} y={104} label="Candidate path" sub="preference, validity" accent={D.mpls} w={170} />
      <DArrow x1={270} y1={55} x2={200} y2={81} color={D.faint} width={1.4} />
      <DArrow x1={370} y1={55} x2={440} y2={81} color={D.faint} width={1.4} />
      <DPill x={120} y={168} text="SID list · w" color={D.cyan} w={100} />
      <DPill x={225} y={168} text="SID list · w" color={D.cyan} w={100} />
      <DPill x={470} y={168} text="SID list" color={D.cyan} w={100} />
      <DArrow x1={150} y1={127} x2={125} y2={154} color={D.faint} width={1.2} />
      <DArrow x1={190} y1={127} x2={220} y2={154} color={D.faint} width={1.2} />
      <DArrow x1={470} y1={127} x2={470} y2={154} color={D.faint} width={1.2} />
    </DiagramSvg>
  );
}

function SelectionDiagram() {
  const steps = [
    { t: "validate each candidate", c: D.cyan },
    { t: "drop invalid ones", c: D.danger },
    { t: "highest preference", c: D.warning },
    { t: "tie-breakers", c: D.violet },
  ];
  return (
    <DiagramSvg h={110} label="Validate each candidate, drop invalid ones, pick the highest preference, then deterministic tie-breakers">
      {steps.map((s, i) => (
        <g key={s.t}>
          <DPill x={82 + i * 158} y={40} text={s.t} color={s.c} w={148} />
          {i < steps.length - 1 && <DArrow x1={157 + i * 158} y1={40} x2={165 + i * 158} y2={40} color={D.faint} width={1.2} />}
        </g>
      ))}
      <text x={320} y={90} textAnchor="middle" fill={D.muted} fontSize={10}>
        tie-breakers: protocol origin, then originator, then discriminator
      </text>
    </DiagramSvg>
  );
}

function AutoSteeringDiagram() {
  return (
    <DiagramSvg h={170} label="Automated steering: a BGP route with next hop E and Color community C resolves onto the policy with headend H, color C, endpoint E">
      <DNode x={130} y={50} label="BGP route" sub="next hop E · Color C" accent={D.bgp} w={180} />
      <DArrow x1={222} y1={50} x2={300} y2={50} color={D.faint} width={1.4} label="match" />
      <DNode x={420} y={50} label="SR Policy ⟨H, C, E⟩" sub="if one exists and is valid" accent={D.violet} w={220} />
      <DNode x={130} y={128} label="local classifier" sub="ACL / flow intent → Color" accent={D.cyan} w={180} />
      <DArrow x1={222} y1={128} x2={330} y2={75} color={D.faint} width={1.2} />
      <text x={430} y={132} textAnchor="middle" fill={D.muted} fontSize={10}>
        or traffic arrives on the policy&apos;s BSID
      </text>
    </DiagramSvg>
  );
}

function EncapsCompareDiagram() {
  return (
    <DiagramSvg h={190} label="H.Encaps stores every SID in the SRH, including the first; H.Encaps.Red leaves the first SID only in the outer DA, and omits the SRH entirely for a single SID">
      <text x={170} y={20} textAnchor="middle" fill={D.ip} fontSize={11.5} fontWeight={700}>
        H.Encaps ⟨S1, S2, S3⟩
      </text>
      <DHeaderColumn
        x={170}
        y={32}
        w={200}
        rows={[
          { text: "outer DA = S1", color: D.warning, strong: true },
          { text: "SRH SL 2 · LE 2", color: D.violet },
          { text: "[0] S3 · [1] S2 · [2] S1", color: D.violet },
          { text: "original packet", color: D.ip },
        ]}
      />
      <text x={470} y={20} textAnchor="middle" fill={D.violet} fontSize={11.5} fontWeight={700}>
        H.Encaps.Red ⟨S1, S2, S3⟩
      </text>
      <DHeaderColumn
        x={470}
        y={32}
        w={200}
        rows={[
          { text: "outer DA = S1", color: D.warning, strong: true },
          { text: "SRH SL 2 · LE 1", color: D.violet },
          { text: "[0] S3 · [1] S2", color: D.violet },
          { text: "original packet", color: D.ip },
        ]}
      />
      <text x={320} y={170} textAnchor="middle" fill={D.muted} fontSize={10}>
        reduced mode saves 16 bytes per packet; SL still starts at n − 1
      </text>
    </DiagramSvg>
  );
}

function StitchingDiagram() {
  return (
    <DiagramSvg h={150} label="A headend in domain A sends a short list ending with a BSID owned by a border node; the border node applies its own policy for domain B">
      <DNode x={100} y={60} label="Headend" sub="domain A" accent={D.ip} w={130} />
      <DArrow x1={166} y1={60} x2={250} y2={60} color={D.faint} width={1.4} label="⟨…, BSID⟩" />
      <DNode x={320} y={60} label="Border node" sub="owns the BSID" accent={D.violet} w={140} />
      <DArrow x1={391} y1={60} x2={470} y2={60} color={D.faint} width={1.4} label="its own policy" />
      <DNode x={545} y={60} label="Endpoint" sub="domain B" accent={D.success} w={130} />
      <text x={320} y={124} textAnchor="middle" fill={D.muted} fontSize={10}>
        the headend never learns domain B&apos;s path — shorter headers, isolated churn
      </text>
    </DiagramSvg>
  );
}


const QUIZ: KnowledgeQuestion[] = [
  { id: "q-id", prompt: "What identifies an SR policy?", options: [{ id: "a", label: "Headend, color and end-point" }, { id: "b", label: "Its binding SID" }, { id: "c", label: "Its first SID" }], correctId: "a", explanation: "⟨headend, color, end-point⟩; the BSID is an attribute, the SIDs belong to candidates." },
  { id: "q-sel", prompt: "Candidate A: preference 300, invalid. Candidate B: preference 50, valid. Which is active?", options: [{ id: "a", label: "B" }, { id: "b", label: "A" }, { id: "c", label: "Neither — the policy is down" }], correctId: "a", explanation: "Validity first, preference second." },
  { id: "q-steer", prompt: "The policy is up, but the app's traffic takes the IGP path. First place to look?", options: [{ id: "a", label: "The route's color and next hop" }, { id: "b", label: "The candidate's SIDs" }, { id: "c", label: "TI-LFA" }], correctId: "a", explanation: "Up is not steered: no matching color + next hop, no policy." },
  { id: "q-color", prompt: "Where is color 100 carried?", options: [{ id: "a", label: "In BGP routes, as an extended community" }, { id: "b", label: "In the SRH tag" }, { id: "c", label: "In the SID's function bits" }], correctId: "a", explanation: "Color is control-plane only; the wire carries SIDs." },
  { id: "q-fail", prompt: "R3–R5 fails and the dynamic candidate takes over. Is that TI-LFA?", options: [{ id: "a", label: "No — headend re-selection after the topology change" }, { id: "b", label: "Yes" }], correctId: "a", explanation: "TI-LFA repairs locally at the point of failure, before the headend reacts." },
  { id: "q-stale", prompt: "R3's link flapped and its End.X came back with a new value. The explicit candidate…", options: [{ id: "a", label: "stays invalid until its list is updated" }, { id: "b", label: "follows the new SID automatically" }, { id: "c", label: "becomes dynamic" }], correctId: "a", explanation: "An explicit list is literal; it names a SID that no longer exists." },
];

export function Srv6PolicyDeepDiveContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="pd-arch" eyebrow="Foundation" title="The SR policy architecture" tone="violet">
        <DiagramFrame caption="Policy → candidate paths → segment lists.">
          <ArchitectureDiagram />
        </DiagramFrame>
        <p>RFC 9256 defines an SR policy as an object on a headend that steers packets onto an ordered list of segments. It has three layers: the <b className="text-pv-text">policy</b> (its identity and attributes, such as the binding SID), its <b className="text-pv-text">candidate paths</b> (alternatives, each with a preference and an origin), and each candidate&apos;s <b className="text-pv-text">segment lists</b> (one or more, weighted). One candidate is active at a time; its segment lists are what gets installed.</p>
      </GuideSection>

      <GuideSection id="pd-identity" eyebrow="Foundation" title="Identity: headend, color, end-point" tone="violet">
        <FieldTable
          title="The tuple"
          accent="violet"
          columns={["Field", "In the lab", "Meaning"]}
          rows={[
            ["Headend", "R1", "Where the policy is instantiated and traffic is encapsulated"],
            ["Color", <Mono key="c">100</Mono>, "A 32-bit number naming an intent — here low latency"],
            ["End-point", <Mono key="e">2001:db8::6</Mono>, "R6's loopback — must match the BGP next hop for steering"],
          ]}
        />
        <p>Two policies on one headend can share an end-point with different colors (low latency vs. high bandwidth to R6), or a color with different end-points. The name (LOW-LATENCY) is a label; the tuple is the identity — IOS XR even prints an automatic name built from it.</p>
        <CliPanel run={p6Only(P0, "R1", "show segment-routing traffic-eng policy", /^Color|Name: srte|Symbolic name/)} caption="IOS XR · R1 — the tuple, the automatic name, and the controller's names for each candidate" />
      </GuideSection>

      <GuideSection id="pd-sources" eyebrow="Foundation" title="Where candidates come from" tone="mpls">
        <FieldTable
          title="Candidate origins"
          accent="mpls"
          columns={["Origin", "How it arrives", "Typical use"]}
          rows={[
            ["Local configuration", "the headend's own config", "simple, static intents"],
            ["PCEP", "a controller (PCE) initiates or updates it", "central computation — the lab"],
            ["BGP SR Policy", "a BGP NLRI from a controller", "large-scale distribution"],
          ]}
        />
        <p>A policy can hold candidates from several origins at once. In the lab both of LOW-LATENCY&apos;s candidates come from the PCE at 2001:db8::100 — IOS XR shows them as <Mono>(PCEP)</Mono> with a symbolic name and PLSP-ID.</p>
        <CliPanel run={p6Block(P0, "R1", "show segment-routing traffic-eng policy", /Preference: 200/, /Explicit/)} caption="IOS XR · R1 — a PCEP-initiated candidate" />
      </GuideSection>

      <GuideSection id="pd-validity" eyebrow="Candidates and selection" title="When a candidate is valid" tone="danger">
        <FieldTable
          title="Validity checks (as the lab applies them)"
          accent="danger"
          columns={["Check", "Fails when"]}
          rows={[
            ["End-point", "it is not a node in the topology"],
            ["Headend", "SRv6 is not enabled on the headend"],
            ["Explicit: non-empty", "the segment list is empty"],
            ["Explicit: SIDs exist", "a SID is not in the SR database — nobody advertises it"],
            ["Explicit: reachable", "the first SID's owner is unreachable"],
            ["Dynamic: path", "no path to the end-point under the objective"],
            ["Dynamic: encodable", "a node on the path has no SRv6 SIDs to express it"],
          ]}
        />
        <p>Validity is re-evaluated whenever the topology or the SR database changes — a valid candidate can become invalid without anyone touching the policy.</p>
      </GuideSection>

      <GuideSection id="pd-selection" eyebrow="Candidates and selection" title="Selecting the active candidate" tone="warning">
        <DiagramFrame caption="Validate, discard, pick the highest preference.">
          <SelectionDiagram />
        </DiagramFrame>
        <p>Among the valid candidates, the highest preference wins; RFC 9256 adds tie-breakers (origin, originator, discriminator) for equal preferences. The policy is up when at least one candidate is valid. The pref ticket shows the rule at work: two valid candidates, and a typo (200 → 20) quietly hands the job to the dynamic one.</p>
        <CliPanel run={p6Only(T.pref, "R1", "show segment-routing traffic-eng policy", /Preference|Explicit|Dynamic/)} caption="IOS XR · R1 — both valid; 100 beats 20" />
      </GuideSection>

      <GuideSection id="pd-dynamic" eyebrow="Candidates and selection" title="Dynamic paths and SID encoding" tone="mpls">
        <p>A dynamic candidate is an objective — minimize delay, or IGP metric, or TE metric, with constraints — that the PCE (or the headend) solves on the TE database. The result is a path of nodes; it is then <b className="text-pv-text">encoded</b> into SIDs. The encoder walks the path and uses an End SID wherever the IGP&apos;s own shortest path already follows the computed path, and an End.X SID where it must force a specific link.</p>
        <FieldTable
          title="The lab's encodings"
          accent="mpls"
          columns={["Situation", "Path", "SID list"]}
          rows={[
            ["Healthy, metric delay", "R1 → R3 → R5 → R6", <Mono key="1">[R5 End]</Mono>],
            ["R3–R5 down, metric delay", "R1 → R3 → R4 → R6", <Mono key="2">[R3 End]</Mono>],
            ["Healthy, metric igp", "R1 → R2 → R4 → R6", <Mono key="3">[] — the service SID alone</Mono>],
          ]}
        />
        <CliPanel run={p6Block(IGP, "R1", "show segment-routing traffic-eng policy", /Preference: 100/, /Attributes/)} caption="IOS XR · R1 — a dynamic candidate on the IGP metric: no SID needed, the IGP path is the path" />
      </GuideSection>

      <GuideSection id="pd-stale" eyebrow="Candidates and selection" title="Dynamic SIDs and explicit lists" tone="cyan">
        <p>IOS XR allocates End.X SIDs dynamically. When an adjacency is torn down and rebuilt, the SID it gets back is not guaranteed to be the same. A dynamic candidate doesn&apos;t care — it is re-encoded from the current SR database. An explicit list does: it names the old value and stays invalid. Remedies: update the list (the lab&apos;s fix), have the PCE build explicit paths from adjacencies rather than literal SIDs, or allocate static End.X functions for SIDs that operators hard-code.</p>
        <CliPanel run={p6Only(T.staleendx, "R3", "show segment-routing srv6 sid", /End\.X/)} caption="IOS XR · R3 after a flap — End.X toward R5 (Gi0/0/0/1) came back as …:3:43::" />
      </GuideSection>

      <GuideSection id="pd-steering" eyebrow="Steering and encapsulation" title="Automated steering" tone="cyan">
        <DiagramFrame caption="A BGP route with next hop E and color C resolves onto ⟨H, C, E⟩.">
          <AutoSteeringDiagram />
        </DiagramFrame>
        <p>With automated steering the headend resolves a BGP route through a policy when the route carries a color extended community and the policy ⟨color, next hop⟩ exists and is up. The egress decides which routes get which intent, simply by coloring them; the headend never needs per-prefix configuration. Other methods exist — per-flow steering, static routes onto a policy, the binding SID — but color is the common one.</p>
        <CliPanel run={p6Only(P0, "R1", "show bgp ipv6 unicast", /Network|2001:db8:6/)} caption="IOS XR · R1 — RX66's route carries C:100, RX67's carries nothing" />
        <P6Result s={NOCOLOR67} title="The lab: RX67 — no color, no policy" />
      </GuideSection>

      <GuideSection id="pd-bsid" eyebrow="Steering and encapsulation" title="Binding SIDs and stitching" tone="violet">
        <DiagramFrame caption="A border node's binding SID hides domain B's path from domain A.">
          <StitchingDiagram />
        </DiagramFrame>
        <p>Every policy gets a <b className="text-pv-text">binding SID</b> (BSID): a local SID whose behavior is “steer into this policy” — End.B6.Encaps on SRv6. A remote headend can put the BSID in its own list; when the packet reaches the BSID owner, that node pushes its policy&apos;s header. This keeps lists short, hides one domain&apos;s paths from another, and lets the inner path change without touching the outer one.</p>
        <CliPanel run={p6Only(P0, "R1", "show segment-routing traffic-eng policy", /Binding SID|SRv6 Behavior/)} caption="IOS XR · R1 — LOW-LATENCY's binding SID" />
      </GuideSection>

      <GuideSection id="pd-encaps" eyebrow="Steering and encapsulation" title="H.Encaps and H.Encaps.Red" tone="ip">
        <DiagramFrame caption="Reduced encapsulation leaves the first SID only in the outer DA.">
          <EncapsCompareDiagram />
        </DiagramFrame>
        <p>H.Encaps writes every SID into the SRH; H.Encaps.Red (reduced) omits the first — it is already the destination address — and omits the SRH entirely when there is a single SID. IOS XR uses the reduced form. For RX66, R1 sends DA = R3&apos;s End.X SID with an SRH that holds only R6&apos;s service SID.</p>
        <CliPanel run={p6Only(P0, "R1", "show cef ipv6 2001:db8:66::/64", /SID-list/)} caption="IOS XR · R1 — the SID list behind RX66's prefix" />
      </GuideSection>

      <GuideSection id="pd-invalid" eyebrow="Steering and encapsulation" title="When the policy goes down" tone="danger">
        <CompareCards
          items={[
            { title: "Default", tone: "warning", tag: "fallback", points: ["steered routes resolve normally again", "traffic takes the IGP path"] },
            { title: "Drop upon invalidation", tone: "danger", tag: "per policy", points: ["routes stay attached to the policy", "traffic is dropped, never misrouted"] },
          ]}
        />
        <p>Falling back keeps traffic flowing on a path that ignores the intent; dropping protects intents that must never be violated (strict disjointness, sovereignty). The end-point ticket shows the fallback: the policy is down and BGP finds no matching policy for color 100 and R6.</p>
        <CliPanel run={p6Only(T.endpoint, "R1", "show bgp ipv6 unicast 2001:db8:66::/64", /C:100|SR policy/)} caption="IOS XR · R1 — color 100 and next hop 2001:db8::6 match no policy" />
      </GuideSection>

      <GuideSection id="pd-config" eyebrow="Operations" title="Configuring it on IOS XR" tone="mpls">
        <p>In the lab the policy comes from the PCE; R1&apos;s configuration only enables the PCC. The pieces that the routers own are configurable in their consoles:</p>
        <CliPanel run={p6Block(P0, "R1", "show running-config", /^segment-routing/, /^!$/)} caption="IOS XR · R1 — the PCC: source address and the controller" />
        <CliPanel run={p6Block(P0, "R6", "show running-config", /^extcommunity-set/, /^segment-routing/)} caption="IOS XR · R6 — the color, and the service SID for the global IPv6 table" />
        <FieldTable
          title="The statements"
          accent="mpls"
          columns={["Statement", "Where", "Effect"]}
          rows={[
            [<Mono key="1">segment-routing srv6 → locator MAIN</Mono>, "router isis → address-family ipv6 unicast", "End and End.X SIDs — the material lists are made of"],
            [<Mono key="2">advertise-delay &lt;µs&gt;</Mono>, "performance-measurement → interface → delay-measurement", "the delay the dynamic computation uses"],
            [<Mono key="3">route-policy SET-COLOR-100 out</Mono>, "R6: neighbor → address-family ipv6 unicast", "colors RX66's prefix — steering"],
            [<Mono key="4">pce address ipv6 …</Mono>, "R1: segment-routing traffic-eng → pcc", "lets the controller instantiate policies"],
          ]}
        />
        <p className="text-sm text-pv-text-muted">A locally configured policy uses <Mono>segment-routing traffic-eng → policy &lt;name&gt;</Mono> with <Mono>color &lt;c&gt; end-point ipv6 &lt;addr&gt;</Mono> and <Mono>candidate-paths → preference &lt;n&gt;</Mono> (explicit segment lists or dynamic). The lab keeps policies on the controller so every change goes through one place.</p>
      </GuideSection>

      <GuideSection id="pd-verify" eyebrow="Operations" title="How to verify" tone="success">
        <FieldTable
          title="Verification on IOS XR"
          accent="success"
          columns={["Question", "Command"]}
          rows={[
            ["Policies, candidates, why invalid, BSID", <Mono key="1">show segment-routing traffic-eng policy [color &lt;c&gt;]</Mono>],
            ["Color and policy on a route", <Mono key="2">show bgp ipv6 unicast &lt;prefix&gt;</Mono>],
            ["The SID list installed", <Mono key="3">show cef ipv6 &lt;prefix&gt;</Mono>],
            ["SIDs on a node", <Mono key="4">show segment-routing srv6 sid</Mono>],
            ["Delays used by the computation", <Mono key="5">show performance-measurement interfaces</Mono>],
            ["Policy state changes", <Mono key="6">show logging</Mono>],
          ]}
        />
        <CliPanel run={p6Cli(P0, "R1", "show cef ipv6 2001:db8:66::/64")} caption="IOS XR · R1 — RX66's prefix through the policy's binding SID" />
      </GuideSection>

      <GuideSection id="pd-signatures" eyebrow="Troubleshooting" title="Failure signatures" tone="danger">
        <FailureSignatures
          items={[
            { tag: "SID", title: "Stale explicit SID", tone: "danger", points: ["explicit invalid: SID not in the SR database", "the SID's owner shows a different value"] },
            { tag: "SRv6", title: "Owner without SRv6", tone: "danger", points: ["explicit invalid", "the node has no SIDs"] },
            { tag: "COL", title: "No color", tone: "warning", points: ["policy up", "route not steered"] },
            { tag: "EP", title: "Wrong end-point", tone: "danger", points: ["policy down", "no match for color + next hop"] },
            { tag: "PREF", title: "Preference", tone: "violet", points: ["both valid", "the wrong one active"] },
            { tag: "LINK", title: "Link failure", tone: "warning", points: ["explicit invalid", "dynamic recomputed, longer"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="pd-ladder" eyebrow="Troubleshooting" title="The troubleshooting ladder" tone="danger">
        <TroubleshootingFlow
          steps={[
            { question: "What does the app see?", look: "Latency and path of a fresh test." },
            { question: "Is its route colored and matched to a policy?", look: "show bgp ipv6 unicast <prefix> on R1." },
            { question: "Is the policy up, and which candidate is active?", look: "show segment-routing traffic-eng policy." },
            { question: "Why is each candidate valid or invalid?", look: "The Reason line." },
            { question: "Do the explicit SIDs exist where they should?", look: "show segment-routing srv6 sid on their owners." },
            { question: "What does R1 push now?", look: "show cef ipv6 <prefix>." },
          ]}
        />
      </GuideSection>

      <GuideSection id="pd-tickets" eyebrow="Troubleshooting" title="Five faults, evidence to proof" tone="danger">
        <FailureWalk title="1 · The engineered path isn't active" normal="Explicit [R3 End.X→R5 …:3:41::] active at 200." change="R3–R5 flapped; R3 re-allocated the End.X as …:3:43::." evidence={<CliPanel run={p6Only(T.staleendx, "R1", "show segment-routing traffic-eng policy", /Preference|Reason/)} caption="IOS XR · R1 — 200 invalid: …:3:41:: is not in the SR database" />} next="The dynamic candidate carries the traffic; nothing is down." fix={<Mono>Controller: explicit SIDs → 2001:db8:100:3:43:: → push</Mono>} proof="200 active; a fresh test carries […:3:43::, …:6:42::] in 15 ms." />
        <FailureWalk title="2 · Invalid after an upgrade" normal="R3 advertises its locator and SIDs." change="The upgrade dropped segment-routing srv6 from R3's IS-IS." evidence={<CliPanel run={p6Block(T.r3srv6, "R3", "show running-config router isis", /^router isis/, /^ interface/)} caption="IOS XR · R3 — IS-IS without segment-routing srv6: no End, no End.X" />} next="Explicit invalid; dynamic [R5 End] still works through R3 as plain IPv6." fix={<Mono>R3: router isis CORE → address-family ipv6 unicast → segment-routing srv6 → locator MAIN → commit</Mono>} proof="R3's End.X back; 200 active; 15 ms." />
        <FailureWalk title="3 · The app takes the long way" normal="R6 colors 2001:db8:66::/64 with 100." change="R6's export policy was rewritten without the color." evidence={<CliPanel run={p6Only(T.color, "R1", "show cef ipv6 2001:db8:66::/64", /via|SID-list/)} caption="IOS XR · R1 — only the service SID, via the IGP" />} next="The policy is up and unused; the app gets 60 ms." fix={<Mono>R6: router bgp 65000 → neighbor 2001:db8::1 → address-family ipv6 unicast → route-policy SET-COLOR-100 out → commit</Mono>} proof="C:100 on the route; a fresh test steered, 15 ms." />
        <FailureWalk title="4 · Re-created with the wrong end-point" normal="End-point 2001:db8::6." change="The controller re-created the policy with 2001:db8::66." evidence={<CliPanel run={p6Only(T.endpoint, "R1", "show segment-routing traffic-eng policy", /^Color|Operational|Reason/)} caption="IOS XR · R1 — end-point …::66, down" />} next="No candidate valid; the route matches no policy: 60 ms." fix={<Mono>Controller: end-point → 2001:db8::6 → push</Mono>} proof="Policy up; a fresh test steered, 15 ms." />
        <FailureWalk title="5 · The wrong candidate wins" normal="Explicit 200, dynamic 100." change="An edit set the explicit preference to 20." evidence={<CliPanel run={p6Only(T.pref, "R1", "show segment-routing traffic-eng policy", /Preference/)} caption="IOS XR · R1 — 100 active, 20 valid but outranked" />} next="Same latency today, but not the engineered path." fix={<Mono>Controller: explicit preference → 200 → push</Mono>} proof="200 active; a fresh test through the explicit list." />
      </GuideSection>

      <GuideSection id="pd-myths" eyebrow="Master it" title="Common misconceptions" tone="warning">
        <Misconceptions
          items={[
            { myth: "An up policy carries traffic.", correction: "Only steered traffic: color and next hop must match." },
            { myth: "Color travels in the packet.", correction: "Color lives in BGP and in the policy; the wire carries SIDs." },
            { myth: "Higher preference always wins.", correction: "Only among valid candidates." },
            { myth: "Candidate failover is fast reroute.", correction: "It is headend re-selection; TI-LFA protects locally." },
            { myth: "An explicit list follows SID changes.", correction: "It is literal — a re-allocated SID invalidates it." },
          ]}
        />
      </GuideSection>

      <GuideSection id="pd-quiz" eyebrow="Master it" title="Knowledge check" tone="cyan">
        <KnowledgeQuiz questions={QUIZ} />
      </GuideSection>

      <GuideSection id="pd-explain" eyebrow="Master it" title="Can you explain it?" tone="violet">
        <ExplainIt
          items={[
            { q: "Why does RX66 take the bottom and RX67 the top?", a: "RX66's route carries color 100 and is steered into LOW-LATENCY; RX67's has no color and follows the IGP." },
            { q: "Why does the explicit list have only one SID?", a: "R1 reaches R3's locator directly, and from R5 the service SID routes on to R6; only the R3→R5 link needs forcing." },
            { q: "Why is the dynamic list [R5 End] and not [R3 End, R5 End]?", a: "R1's ordinary route to R5 already passes R3, so R5's End reproduces the whole path." },
            { q: "What happens when R3–R5 fails?", a: "R3's End.X disappears, the explicit candidate becomes invalid, the dynamic one is recomputed via R4 (40 ms) and becomes active." },
            { q: "How can a policy be fine and the app still slow?", a: "Steering: no color on the route, or color + next hop matching no policy." },
          ]}
        />
      </GuideSection>

      <GuideSection id="pd-glossary" eyebrow="Master it" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "SR policy", def: "⟨headend, color, end-point⟩ with candidate paths." },
            { term: "Candidate path", def: "Explicit or dynamic; preference; origin (config, PCEP, BGP)." },
            { term: "Segment list", def: "The SIDs a candidate resolves to; can be weighted." },
            { term: "Automated steering", def: "Color + next hop of a BGP route select the policy." },
            { term: "Binding SID", def: "Local SID that steers into the policy (End.B6.Encaps)." },
            { term: "PCC / PCE", def: "Path computation client (the headend) and element (the controller)." },
            { term: "Drop upon invalidation", def: "Drop steered traffic while the policy is down." },
          ]}
        />
      </GuideSection>

      <GuideSection id="pd-mental" eyebrow="Master it" title="Mental model" tone="violet">
        <p>A policy is a standing order with a backup plan. The color on a route is the customer&apos;s membership card — no card, no standing order. The order lists itineraries by preference, and only bookable itineraries count. An itinerary written as a list of station names breaks when a station is renamed; one that says “ask the planner” never does.</p>
      </GuideSection>

      <GuideSection id="pd-practice" eyebrow="Master it" title="Practice in the SRv6 Policy Lab" tone="violet">
        <p>Six Learn levels, then the workspace: every router&apos;s SIDs, interfaces with metrics and delays, an IOS XR console, a Controller window to edit the policy, traffic to two receivers, link failures and flaps, five challenges and the five tickets above.</p>
        <LabBridge />
        <PresentationBridge>Rewatch the SRv6 Policy presentation.</PresentationBridge>
      </GuideSection>
    </div>
  );
}
