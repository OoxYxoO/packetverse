import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DPill, DiagramFrame, DiagramSvg, FailureSignatures, FieldTable, Glossary, GuideSection, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { DStack } from "@/components/lesson/MplsGuideSvg";
import { SrTopology, type SrLink } from "@/components/lesson/SrGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { PracticeBridge } from "@/components/lesson/GuideInteractive";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import { PresentationBridge } from "@/components/presentation/LessonPresentation";
import { CliPanel, pickLines, runGuideCli } from "@/components/lesson/GuideCli";
import { createSrpNet, srpApply, spTicket, srpTicketState, type SpAction, type SpR, type SpState } from "@/lib/sim-engine/scenarios/srpNet";
import { srpSets, srpStaticApi } from "./srp-lab/srpCli";

export const SRP_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "pl-mission", label: "What this lesson teaches" },
  { id: "pl-network", label: "The network of this lesson" },
  { id: "pl-ideas", label: "Three ideas you need" },
  { id: "pl-identity", label: "A policy is an intent" },
  { id: "pl-candidates", label: "Two candidate paths" },
  { id: "pl-selection", label: "Which one is active" },
  { id: "pl-bsid", label: "The binding SID" },
  { id: "pl-steering", label: "Steering by color" },
  { id: "pl-wire", label: "Policy list vs wire stack" },
  { id: "pl-fallback", label: "When a candidate fails" },
  { id: "pl-down", label: "When none is valid" },
  { id: "pl-incident", label: "The wrong-path incident" },
  { id: "pl-working", label: "What working looks like" },
  { id: "pl-other", label: "Other ways it fails" },
  { id: "pl-model", label: "Mental model" },
  { id: "pl-glossary", label: "Glossary" },
  { id: "pl-recap", label: "Recap" },
  { id: "pl-practice", label: "Practice it" },
];

/** Real IOS XR output and test results on this page come from the SR Policy Lab — the guided lesson's network. */
const P0: SpState = createSrpNet(0);
const run = (s: SpState, ...a: SpAction[]) => a.reduce((acc, x) => srpApply(acc, x), s);
const GOLD1 = run(P0, { type: "ping", to: "H6" });
const DFLT1 = run(P0, { type: "ping", to: "H60" });
const FAIL1 = run(P0, { type: "link", id: "R3-R5", up: false }, { type: "ping", to: "H6" });
const DOWN1 = run(P0, { type: "link", id: "R3-R5", up: false }, { type: "link", id: "R3-R4", up: false }, { type: "ping", to: "H6" });
const INC = spTicket("pref").repro.reduce((acc, a) => srpApply(acc, a), srpTicketState("pref", 0));
const INC_FIX = run(INC, { type: "set", text: "R1: explicit preference back to 200", changes: [{ dev: "R1", f: (c) => void (c.policies[0].cands.find((k) => k.kind === "explicit")!.pref = 200) }] }, { type: "ping", to: "H6" });
export function srpCli(s: SpState, r: SpR, command: string) {
  return runGuideCli(srpSets(srpStaticApi(s, r), r).cisco, command);
}
export function srpOnly(s: SpState, r: SpR, command: string, match: RegExp, keep = 0) {
  const x = srpCli(s, r, command);
  return { ...x, output: pickLines(x.output, match, keep) };
}
/** One test, as the lab reports it. */
export function SrpResult({ s, title }: { s: SpState; title: string }) {
  const t = s.tests[s.tests.length - 1];
  return (
    <Callout tone={t.ok ? "success" : "danger"} title={title} icon={t.ok ? "✓" : "!"}>
      {t.kind === "ping" ? `H1 → ${t.dst}` : `R1 → 10.0.0.6 with [${t.stack?.join(", ")}]`}: {t.ok ? `delivered via ${t.path.join(" → ")}${t.kind === "ping" ? (t.steered ? ` — steered into policy ${t.steered}` : " — not steered") : ""}` : t.why}
    </Callout>
  );
}

function LessonLabBridge() {
  const openLab = usePracticeLabOpener();
  return (
    <PracticeBridge label="Open the SR Policy Lab" onPractice={openLab}>
      The network of this lesson on IOS XR: policy GOLD on R1, BGP color steering, link failures, your own copy. Nothing you do there changes your lesson progress.
    </PracticeBridge>
  );
}

const BLUE = "#60a5fa";
const GOLD = D.warning;

const LINKS: SrLink[] = [
  { a: "R1", b: "R2", label: "10 BLUE" },
  { a: "R2", b: "R4", label: "10 BLUE" },
  { a: "R4", b: "R6", label: "10 BLUE+GOLD" },
  { a: "R1", b: "R3", label: "15 GOLD" },
  { a: "R3", b: "R5", label: "15 GOLD" },
  { a: "R5", b: "R6", label: "15 GOLD" },
  { a: "R3", b: "R4", label: "30 GOLD" },
];

function BaselineVsGoldDiagram() {
  const top = new Set(["R1-R2", "R2-R4", "R4-R6"]);
  const bottom = new Set(["R1-R3", "R3-R5", "R5-R6"]);
  return (
    <DiagramSvg h={240} label="Default traffic follows the IGP top path R1 R2 R4 R6; GOLD traffic steered into the policy follows R1 R3 R5 R6">
      <SrTopology
        links={LINKS.map((l) => {
          const id = `${l.a}-${l.b}`;
          return top.has(id) ? { ...l, color: BLUE, bold: true } : bottom.has(id) ? { ...l, color: GOLD, bold: true } : { ...l, dashed: true };
        })}
        sub={{ R1: "headend", R6: "endpoint" }}
        accent={{ R1: D.mpls, R6: D.mpls }}
      />
      <text x={20} y={228} fill={BLUE} fontSize={10.5} fontWeight={700}>
        DEFAULT: IGP shortest path, cost 30
      </text>
      <text x={620} y={228} textAnchor="end" fill={GOLD} fontSize={10.5} fontWeight={700}>
        GOLD: SR Policy Color 100
      </text>
    </DiagramSvg>
  );
}

function CandidatesDiagram() {
  const card = (x: number, title: string, pref: string, kind: string, list: string, color: string) => (
    <g>
      <rect x={x} y={30} width={270} height={100} rx={12} fill={D.box} stroke={color} strokeOpacity={0.8} />
      <text x={x + 14} y={52} fill={color} fontSize={12} fontWeight={700}>
        {title}
      </text>
      <text x={x + 256} y={52} textAnchor="end" fill={D.text} fontSize={11} fontWeight={700}>
        {pref}
      </text>
      <text x={x + 14} y={74} fill={D.muted} fontSize={10}>
        {kind}
      </text>
      <text x={x + 14} y={104} fill={D.text} fontSize={11} fontFamily="monospace">
        {list}
      </text>
    </g>
  );
  return (
    <DiagramSvg h={160} label="GOLD-EXPLICIT, preference 200, list 16003 24035 16006; GOLD-DYNAMIC, preference 100, include GOLD, computed list 16005 16006">
      <text x={320} y={18} textAnchor="middle" fill={D.muted} fontSize={10}>
        policy ⟨R1, Color 100, R6⟩ — two ways to realize the same intent
      </text>
      {card(40, "GOLD-EXPLICIT", "pref 200", "EXPLICIT · list written by the operator", "16003 → 24035 → 16006", D.mpls)}
      {card(330, "GOLD-DYNAMIC", "pref 100", "DYNAMIC · TE metric + include GOLD", "16005 → 16006", D.violet)}
      <text x={320} y={152} textAnchor="middle" fill={D.muted} fontSize={10}>
        both are logical segment lists at R1; both lead R1 → R3 → R5 → R6 while all links are up
      </text>
    </DiagramSvg>
  );
}

function SelectionDiagram() {
  const steps = [
    { t: "validate every candidate", c: D.cyan },
    { t: "discard invalid ones", c: D.danger },
    { t: "compare preference", c: D.warning },
    { t: "one ACTIVE candidate", c: D.success },
  ];
  return (
    <DiagramSvg h={110} label="Validate every candidate, discard invalid ones, compare preference among the rest, and one candidate becomes active">
      {steps.map((s, i) => (
        <g key={s.t}>
          <DPill x={82 + i * 158} y={40} text={s.t} color={s.c} w={146} />
          {i < steps.length - 1 && <DArrow x1={156 + i * 158} y1={40} x2={166 + i * 158} y2={40} color={D.faint} width={1.4} />}
        </g>
      ))}
      <text x={320} y={90} textAnchor="middle" fill={D.muted} fontSize={10}>
        preference only ranks VALID candidates; an invalid one never wins on its number alone
      </text>
    </DiagramSvg>
  );
}

function WireDiagram() {
  const cols = [
    { x: 130, head: "R1 → R3", labels: [{ text: "24035 S0", color: D.warning, tag: "TOP" }, { text: "16006 S1", tag: "BOTTOM" }], payload: "IP" },
    { x: 330, head: "R3 → R5", labels: [{ text: "16006 S1", tag: "TOP" }], payload: "IP" },
    { x: 530, head: "R5 → R6", labels: [], payload: "IP only" },
  ];
  return (
    <DiagramSvg h={170} label="GOLD-EXPLICIT on the wire: R1 to R3 carries 24035 over 16006, R3 to R5 carries 16006, R5 to R6 carries plain IP">
      {cols.map((c) => (
        <g key={c.head}>
          <text x={c.x} y={20} textAnchor="middle" fill={D.text} fontSize={11.5} fontWeight={700}>
            {c.head}
          </text>
          <DStack x={c.x} y={32} labels={c.labels} payload={c.payload} w={96} />
        </g>
      ))}
      <text x={130} y={124} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        16003 done by PHP at R1
      </text>
      <text x={330} y={124} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        R3 executed its own 24035
      </text>
      <text x={530} y={124} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        16006 done by PHP at R5
      </text>
      <text x={320} y={160} textAnchor="middle" fill={D.muted} fontSize={10}>
        no Color, preference or BSID on any wire — only SR labels
      </text>
    </DiagramSvg>
  );
}

function FallbackDiagram() {
  return (
    <DiagramSvg h={240} label="With R3-R5 down, GOLD-EXPLICIT is invalid and GOLD-DYNAMIC recomputes to R1 R3 R4 R6 over the GOLD-tagged R3-R4 link">
      <SrTopology
        links={LINKS.map((l) => {
          const id = `${l.a}-${l.b}`;
          if (id === "R3-R5") return { ...l, color: D.danger, dashed: true, label: "DOWN" };
          if (id === "R1-R3" || id === "R3-R4" || id === "R4-R6") return { ...l, color: D.violet, bold: true };
          return l;
        })}
        sub={{ R1: "headend", R6: "endpoint" }}
        accent={{ R1: D.mpls, R6: D.mpls }}
      />
      <text x={320} y={228} textAnchor="middle" fill={D.violet} fontSize={10.5} fontWeight={700}>
        GOLD-DYNAMIC active: R1 → R3 → R4 → R6 (headend re-selection, not TI-LFA)
      </text>
    </DiagramSvg>
  );
}


export function SrPolicyLessonGuideContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="pl-mission" eyebrow="This lesson" title="What this lesson teaches" tone="mpls">
        <p>
          The last lesson ended with a segment list that forced traffic through R3 and R5: <Mono>[16003, 24035, 16006]</Mono>. That is a path — but not yet something you can operate. Which traffic should use it? What happens when R3–R5 fails? Who notices? This lesson wraps segment lists in an <b className="text-pv-text">SR policy</b>: an intent on the headend, with candidate paths, a fallback, and a way for traffic to ask for it.
        </p>
        <p>You will meet policy GOLD on R1, its explicit and dynamic candidates, its binding SID, and the BGP color that steers one customer prefix into it while another prefix ignores it. Then links fail, candidates switch, the policy goes down — and finally an incident where everything is up and the traffic still isn&apos;t where operations expected.</p>
        <ChecklistCard tone="violet" title="By the end of this lesson you can" mark="→" items={["say what identifies an SR policy, and what color means", "tell explicit from dynamic candidates and pick the active one", "explain the binding SID", "explain how BGP color steers traffic into a policy", "predict candidate switchover and policy down — and their effect on traffic", "find an SR policy fault from evidence, fix it and prove it"]} />
      </GuideSection>

      <GuideSection id="pl-network" eyebrow="This lesson" title="The network of this lesson" tone="cyan">
        <DiagramFrame caption="The top path is the IGP shortest path; GOLD intent prefers the GOLD-tagged bottom path.">
          <BaselineVsGoldDiagram />
        </DiagramFrame>
        <p>The SR-MPLS lesson&apos;s six routers, plus a GOLD-tagged cross-link R3–R4 (metric 30). Links carry <b className="text-pv-text">affinities</b> — administrative colors on links: the top links are BLUE, R4–R6 is BLUE and GOLD, the bottom links and R3–R4 are GOLD. R1 is the <b className="text-pv-text">headend</b>. Behind R6 sit two servers: H6 (<Mono>192.168.6.20</Mono>) runs the GOLD application, H60 (<Mono>192.168.60.20</Mono>) is ordinary traffic.</p>
        <Callout tone="cyan" title="IOS XR in the lab" icon="i">
          The SR Policy Lab runs IOS XR on every router: SR policies, segment lists and automated steering exactly as configured there. Junos implements the same RFC 9256 ideas under <Mono>protocols source-packet-routing</Mono>; this lesson shows IOS XR only.
        </Callout>
      </GuideSection>

      <GuideSection id="pl-ideas" eyebrow="This lesson" title="Three ideas you need" tone="violet">
        <CompareCards
          items={[
            { title: "Intent", tone: "violet", tag: "identity", points: ["⟨headend, color, end-point⟩", "the BSID is its handle"] },
            { title: "Candidates", tone: "mpls", tag: "paths", points: ["explicit or dynamic", "highest valid preference wins"] },
            { title: "Steering", tone: "warning", tag: "traffic", points: ["BGP route with the color", "next hop = end-point"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="pl-identity" eyebrow="Policy" title="A policy is an intent" tone="violet">
        <p>Policy GOLD on R1 is identified by its <b className="text-pv-text">color</b> 100 and its <b className="text-pv-text">end-point</b> 10.0.0.6 (RFC 9256). Color is an opaque number the operator gives a meaning — here &quot;the GOLD application&quot; — not a label, not DSCP. R2–R6 know nothing about the policy.</p>
        <CliPanel run={srpOnly(P0, "R1", "show segment-routing traffic-eng policy", /Color:|Name: srte|Status|Admin|Binding SID/)} caption="IOS XR · R1 — color 100, end-point 10.0.0.6, up, binding SID 30001" />
      </GuideSection>

      <GuideSection id="pl-candidates" eyebrow="Policy" title="Two candidate paths" tone="mpls">
        <DiagramFrame caption="Explicit: operator-written. Dynamic: computed by the headend under constraints.">
          <CandidatesDiagram />
        </DiagramFrame>
        <p><b className="text-pv-text">Preference 200 — explicit.</b> Segment-list GOLD-EXPLICIT, written as addresses: R3&apos;s loopback, R5&apos;s address on the R3–R5 link, R6&apos;s loopback. R1 resolves them to <Mono>[16003, 24035, 16006]</Mono>, checking every hop against the topology.</p>
        <p><b className="text-pv-text">Preference 100 — dynamic.</b> R1 computes the path itself: minimize TE metric, use only links with affinity GOLD. Today: R1 → R3 → R5 → R6, cost 45, encoded as the shortest stack, <Mono>[16005, 16006]</Mono>. No bandwidth is reserved.</p>
        <CliPanel run={srpOnly(P0, "R1", "show segment-routing traffic-eng policy", /Preference|Explicit|Dynamic|Metric Type|Affinity|^\s+1\d{4}|^\s+24\d{3}/)} caption="IOS XR · R1 — both candidates, their segment lists, which one is active" />
      </GuideSection>

      <GuideSection id="pl-selection" eyebrow="Policy" title="Which one is active" tone="warning">
        <DiagramFrame caption="Validate, discard the invalid, then highest preference.">
          <SelectionDiagram />
        </DiagramFrame>
        <p>R1 validates every candidate whenever the topology changes. Among the valid ones, the highest preference is <b className="text-pv-text">active</b>; the others wait, already computed. A higher number never wins on its own — an invalid preference 200 loses to a valid preference 100.</p>
      </GuideSection>

      <GuideSection id="pl-bsid" eyebrow="Policy" title="The binding SID" tone="violet">
        <p>R1 binds label <Mono>30001</Mono> to the policy. A packet reaching R1 with 30001 on top is given the active segment list — whatever it is at that moment. The binding SID is local to R1: a handle a controller or another domain can push to say &quot;use GOLD&quot;, without knowing the path.</p>
        <CliPanel run={srpOnly(P0, "R1", "show mpls forwarding", /Local|Label  |----|^30001/)} caption="IOS XR · R1 — 30001 bound to the policy" />
        <SrpResult s={run(P0, { type: "probe", stack: [30001] })} title="The lab: R1 sends a packet with only [30001]" />
      </GuideSection>

      <GuideSection id="pl-steering" eyebrow="Steering" title="Steering by color" tone="cyan">
        <p>A policy only carries traffic that is <b className="text-pv-text">steered</b> into it. R6 exports 192.168.6.0/24 with the BGP extended community <b className="text-pv-text">color 100</b>; 192.168.60.0/24 goes out plain. On R1, a route whose color and next hop match a policy&apos;s color and end-point is steered into it — automated steering. The other prefix resolves over R6&apos;s Node SID as usual.</p>
        <CliPanel run={srpOnly(P0, "R1", "show bgp ipv4 unicast 192.168.6.0/24", /routing table entry|C:100|Extended community|SR policy/)} caption="IOS XR · R1 — color 100, steered into the policy, BSID 30001" />
        <SrpResult s={GOLD1} title="The lab: H1 → H6 (colored)" />
        <SrpResult s={DFLT1} title="The lab: H1 → H60 (no color)" />
      </GuideSection>

      <GuideSection id="pl-wire" eyebrow="Data plane" title="Policy list vs wire stack" tone="mpls">
        <DiagramFrame caption="What each link actually carries.">
          <WireDiagram />
        </DiagramFrame>
        <p>The policy&apos;s list is <Mono>[16003, 24035, 16006]</Mono>, but R1 executes the first segment itself: R3 is its neighbor, so 16003 is popped before the packet leaves. No color, preference or BSID ever appears on a wire.</p>
        <CliPanel run={srpOnly(P0, "R1", "show cef 192.168.6.0/24", /^192|local-label|next hop/)} caption="IOS XR · R1 — via the BSID; 24035 16006 imposed toward R3" />
      </GuideSection>

      <GuideSection id="pl-fallback" eyebrow="Resilience" title="When a candidate fails" tone="danger">
        <DiagramFrame caption="Headend re-selection: the explicit candidate is invalid, the dynamic one recomputes.">
          <FallbackDiagram />
        </DiagramFrame>
        <p>R3–R5 fails. The explicit list names R5&apos;s address on that link, and there is no adjacency left to resolve it to: preference 200 is <b className="text-pv-text">invalid</b>. R1 recomputes the dynamic candidate over the GOLD links that remain — R3 → R4 → R6, <Mono>[16003, 16006]</Mono> — and makes it active.</p>
        <SrpResult s={FAIL1} title="The lab: H1 → H6 with R3–R5 down" />
        <CliPanel run={srpOnly(FAIL1, "R1", "show segment-routing traffic-eng policy", /Preference|Explicit|Reason|Dynamic|^\s+1\d{4}/)} caption="IOS XR · R1 — explicit invalid (no adjacency), dynamic active" />
        <Callout tone="warning" title="Not fast reroute" icon="!">
          This happens at the headend, after IS-IS has converged. Local protection within 50 ms at the point of failure is TI-LFA, a later lesson.
        </Callout>
      </GuideSection>

      <GuideSection id="pl-down" eyebrow="Resilience" title="When none is valid" tone="danger">
        <p>Take R3–R4 down too. No GOLD path remains, both candidates are invalid, and policy GOLD is <b className="text-pv-text">down</b>. The colored route has no policy to use, so IOS XR resolves it over R6&apos;s Node SID — GOLD traffic still arrives, over R2 and R4.</p>
        <SrpResult s={DOWN1} title="The lab: H1 → H6 with both GOLD links down" />
        <Callout tone="cyan" title="Strict or fallback" icon="i">
          The guided lesson keeps GOLD strict — no valid candidate, no forwarding — to make the point that a down policy is a real event. Falling back to the ordinary path is the IOS XR default; operators who need strict behavior configure it.
        </Callout>
      </GuideSection>

      <GuideSection id="pl-incident" eyebrow="Incident" title="The wrong-path incident" tone="danger">
        <p>GOLD traffic reaches R6, no loss is reported, IS-IS and SR are healthy, policy GOLD is up. But a capture on R1&apos;s link to R3 doesn&apos;t show the planned stack.</p>
        <SrpResult s={INC} title="The lab: H1 → H6 (the ticket)" />
        <TroubleshootingFlow
          steps={[
            { question: "Is the policy up, with color 100 and end-point 10.0.0.6?", look: "Yes." },
            { question: "Is the GOLD route steered into it?", look: "Yes — colored, BSID 30001." },
            { question: "Which candidate is active?", look: "Preference 100, the dynamic one." },
            { question: "Why?", look: "The explicit candidate's preference is 80. Both are valid; 100 > 80." },
          ]}
        />
        <CliPanel run={srpOnly(INC, "R1", "show segment-routing traffic-eng policy", /Preference|Explicit|Dynamic|^\s+1\d{4}|^\s+24\d{3}/)} caption="IOS XR · R1 — preference 80 explicit, preference 100 dynamic (active)" />
        <CliPanel run={{ prompt: "RP/0/RP0/CPU0:R1(config)#", command: "segment-routing traffic-eng policy GOLD candidate-paths", output: "RP/0/RP0/CPU0:R1(config-sr-te-policy-path)#no preference 80\nRP/0/RP0/CPU0:R1(config-sr-te-policy-path)#preference 200\nRP/0/RP0/CPU0:R1(config-sr-te-policy-path-pref)#explicit segment-list GOLD-EXPLICIT\nRP/0/RP0/CPU0:R1(config-sr-te-policy-path-pref)#commit" }} caption="IOS XR · R1 — the repair" />
        <SrpResult s={INC_FIX} title="The lab: a fresh ping after the fix" />
        <ChecklistCard tone="success" title="Proved, not assumed" mark="✓" items={["the explicit candidate (200) is active again", "the GOLD ping leaves R1 with [24035, 16006]", "nothing else changed: IGP, SIDs and steering were never the problem"]} />
      </GuideSection>

      <GuideSection id="pl-working" eyebrow="Evidence" title="What working looks like" tone="success">
        <FieldTable
          title="Healthy, in five questions (IOS XR on R1)"
          accent="success"
          columns={["Question", "Command", "Healthy answer"]}
          rows={[
            ["Is the policy up, which candidate is active?", <Mono key="1">show segment-routing traffic-eng policy</Mono>, "up · preference 200 explicit (active)"],
            ["Are both candidates valid?", <Mono key="2">show segment-routing traffic-eng policy</Mono>, "explicit (valid) · dynamic (inactive)"],
            ["Is the GOLD route steered?", <Mono key="3">show bgp ipv4 unicast 192.168.6.0/24</Mono>, "C:100 (bsid:30001)"],
            ["Which labels leave R1?", <Mono key="4">show cef 192.168.6.0/24</Mono>, "24035 16006 toward R3"],
            ["Does traffic follow?", "fresh pings to H6 and H60", "H6 via R3, R5 · H60 via R2, R4"],
          ]}
        />
      </GuideSection>

      <GuideSection id="pl-other" eyebrow="Beyond this incident" title="Other ways it fails" tone="warning">
        <FailureSignatures
          items={[
            { tag: "CLR", title: "Route lost its color", tone: "danger", points: ["policy up", "GOLD prefix not steered"] },
            { tag: "EP", title: "Wrong end-point", tone: "danger", points: ["policy up", "nothing matches it"] },
            { tag: "SR", title: "Router without SR on the path", tone: "violet", points: ["policy up (explicit valid)", "GOLD dropped mid-path"] },
            { tag: "LBL", title: "Wrong label in a label list", tone: "warning", points: ["only the first label is checked", "dropped where it's executed"] },
          ]}
        />
        <p className="text-sm text-pv-text-muted">Each is a ticket in the SR Policy Lab, together with this incident.</p>
      </GuideSection>

      <GuideSection id="pl-model" eyebrow="Mental model" title="Mental model" tone="cyan">
        <p>
          Think of a courier company at a single depot (the headend). A customer contract (the policy) says: parcels marked with a gold sticker (color 100) going to the northern warehouse (the end-point) travel by the scenic route. The contract lists route plans in order of preference: first, a fixed itinerary written by the planner (explicit); second, &quot;work out the best route that uses only gold-rated roads&quot; (dynamic). Every morning the depot checks each plan against the road reports and uses the best one that is still possible. Shippers put the sticker on their parcels themselves (BGP color); parcels without it go the usual way. The drivers on the road never see the contract — only the turn-by-turn card in each parcel. And if a contract shows the second plan in use while the first is perfectly drivable, somebody changed the order of the plans.
        </p>
        <Callout tone="cyan" title="When it breaks, ask in this order" icon="→">
          Which traffic is affected? Is IS-IS up and every router SR-capable? Is the policy up, with the right color and end-point? Which candidate is active, and why? Is the route colored and steered? Does every label exist where it is executed?
        </Callout>
      </GuideSection>

      <GuideSection id="pl-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "SR policy", def: "An intent on a headend, identified by color and end-point, realized by candidate paths (RFC 9256)." },
            { term: "Color", def: "An opaque number that names an intent." },
            { term: "End-point", def: "Where the policy's traffic goes (here R6, 10.0.0.6)." },
            { term: "Candidate path", def: "One way to realize the policy: explicit or dynamic, with a preference." },
            { term: "Active candidate", def: "The valid candidate with the highest preference." },
            { term: "Binding SID", def: "A local label on the headend that stands for the policy's active segment list." },
            { term: "Affinity", def: "An administrative color on a link, used as a constraint by dynamic paths." },
            { term: "Automated steering", def: "BGP routes with a color are steered into the policy with that color and their next hop as end-point." },
          ]}
        />
      </GuideSection>

      <GuideSection id="pl-recap" eyebrow="Reference" title="Recap" tone="success">
        <ChecklistCard tone="success" title="You can now" mark="✓" items={["identify a policy by color and end-point", "pick the active candidate and say why", "use and explain the binding SID", "explain steering by BGP color", "predict switchover, policy down and the fallback", "find, fix and prove a preference fault"]} />
      </GuideSection>

      <GuideSection id="pl-practice" eyebrow="Next" title="Practice it" tone="violet">
        <p>The Deep Dive tab covers SR policies in full: RFC 9256, candidate path selection and validation, explicit segment lists, dynamic computation and constraints, the binding SID, steering methods, weights, configuration and verification on IOS XR, and every failure signature with real evidence. The lab lets you operate it.</p>
        <LessonLabBridge />
        <PresentationBridge>Rewatch the SR Policy presentation.</PresentationBridge>
      </GuideSection>
    </div>
  );
}
