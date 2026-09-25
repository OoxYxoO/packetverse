import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DPill, DiagramFrame, DiagramSvg, FieldTable, FlowSteps, Glossary, GuideSection, Mono } from "@/components/lesson/GuideBlocks";
import { DStack } from "@/components/lesson/MplsGuideSvg";
import { SrTopology, type SrLink } from "@/components/lesson/SrGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";

export const SRP_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "sp-mission", label: "The mission" },
  { id: "sp-baseline", label: "Baseline vs GOLD intent" },
  { id: "sp-identity", label: "Policy identity" },
  { id: "sp-candidates", label: "Two candidate paths" },
  { id: "sp-selection", label: "Selecting the active candidate" },
  { id: "sp-bsid", label: "Binding SID" },
  { id: "sp-steering", label: "Steering" },
  { id: "sp-wire", label: "Policy list vs wire stack" },
  { id: "sp-planes", label: "Policy state vs data plane" },
  { id: "sp-fallback", label: "Fallback and DOWN" },
  { id: "sp-fault", label: "The wrong-path incident" },
  { id: "sp-mistakes", label: "Common mistakes" },
  { id: "sp-challenge", label: "The engineer challenge" },
  { id: "sp-glossary", label: "Glossary" },
  { id: "sp-recap", label: "Mental model" },
];

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
    <>
      <GuideSection id="sp-mission" eyebrow="Introduction" title="The mission: from SIDs to operational intent" tone="mpls">
        <p>You already know Node SIDs, Adj-SIDs and the SRGB. Here GOLD traffic from R1 to R6 must use R1 → R3 → R5 → R6 regardless of the IGP shortest path, keep a fallback, and stay separate from default traffic.</p>
        <Callout tone="cyan" title="Scope of this simulation" icon="i">
          One headend (R1), one policy, two candidate paths, local classification for steering. No PCEP, controller or BGP SR Policy distribution is modeled. Like SR-MPLS Foundations, every Node SID here uses PHP.
        </Callout>
      </GuideSection>

      <GuideSection id="sp-baseline" eyebrow="Setup" title="Baseline vs GOLD intent" tone="ospf">
        <DiagramFrame caption="Numbers are IGP metrics; BLUE/GOLD are TE affinities. R3-R4 is a GOLD cross-link used only by fallback.">
          <BaselineVsGoldDiagram />
        </DiagramFrame>
        <p>
          Without a policy R1 pushes only <Mono>16006</Mono>; R2 forwards it and R4 pops it (PHP), so default traffic uses the top path. GOLD traffic is meant to take the bottom path.
        </p>
      </GuideSection>

      <GuideSection id="sp-identity" eyebrow="Policy state" title="Policy identity" tone="violet">
        <FieldTable
          title="SR Policy ⟨headend, color, endpoint⟩"
          accent="violet"
          columns={["Field", "Value", "Meaning"]}
          rows={[
            ["Headend", "R1", "Where the policy is instantiated"],
            ["Color", <Mono key="c">100</Mono>, "Intent identifier; \"GOLD\" is only PacketVerse's friendly name"],
            ["Endpoint", <Mono key="e">R6 · 10.0.0.6/32</Mono>, "Where the intent delivers traffic"],
            ["Binding SID", <Mono key="b">30001</Mono>, "Local handle R1 allocates for this policy"],
          ]}
        />
      </GuideSection>

      <GuideSection id="sp-candidates" eyebrow="Policy state" title="Two candidate paths" tone="mpls">
        <DiagramFrame caption="Candidate paths are alternatives inside one policy.">
          <CandidatesDiagram />
        </DiagramFrame>
        <p>
          GOLD-EXPLICIT is written by the operator: R3 Node SID, R3→R5 Adj-SID (local to R3), R6 Node SID. GOLD-DYNAMIC is computed by the headend from TE metric and the include-GOLD affinity; R1&apos;s shortest path to R5 already passes R3, so R5&apos;s Node SID alone is enough. Neither reserves bandwidth.
        </p>
      </GuideSection>

      <GuideSection id="sp-selection" eyebrow="Policy state" title="Selecting the active candidate" tone="warning">
        <DiagramFrame caption="Selection runs at the headend only.">
          <SelectionDiagram />
        </DiagramFrame>
        <p>The modeled policy states are DOWN, NO_VALID_CANDIDATE, RESOLVING and UP — a PacketVerse teaching lifecycle, not an official protocol state machine.</p>
      </GuideSection>

      <GuideSection id="sp-bsid" eyebrow="Policy state" title="Binding SID" tone="violet">
        <FlowSteps
          steps={[
            { title: "BSID 30001", body: "A local forwarding handle owned by R1.", tone: "violet" },
            { title: "Policy ⟨R1, 100, R6⟩", body: "The BSID is bound to this policy.", tone: "mpls" },
            { title: "Active candidate", body: "Whichever candidate currently wins selection.", tone: "warning" },
            { title: "Segment list", body: "What R1 actually imposes. The BSID itself is not pushed in this lesson.", tone: "success" },
          ]}
        />
      </GuideSection>

      <GuideSection id="sp-steering" eyebrow="Steering" title="Steering" tone="cyan">
        <p>
          Building a policy and sending traffic into it are separate functions. In this lesson R1 classifies GOLD application traffic locally and maps it to Color 100; unclassified DEFAULT traffic is untouched. BGP color-based steering exists in real networks but is only mentioned, not modeled.
        </p>
      </GuideSection>

      <GuideSection id="sp-wire" eyebrow="Data plane" title="Policy list vs wire stack" tone="mpls">
        <FieldTable
          title="GOLD-EXPLICIT logical list at R1 (top first)"
          accent="mpls"
          columns={["#", "SID", "Instruction", "Completes"]}
          rows={[
            ["1 · TOP / ACTIVE", <Mono key="a">16003</Mono>, "Reach R3", "By PHP at R1 — never imposed"],
            ["2", <Mono key="b">24035</Mono>, "At R3, use R3→R5", "At R3, its owner"],
            ["3 · BOTTOM / LAST", <Mono key="c">16006</Mono>, "Reach R6", "By PHP at R5"],
          ]}
        />
        <DiagramFrame caption="What each wire actually carries for GOLD traffic.">
          <WireDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="sp-planes" eyebrow="Model" title="Policy state vs data plane" tone="cyan">
        <CompareCards
          items={[
            { title: "Headend policy state", tone: "violet", tag: "R1 only", points: ["Color, endpoint, candidates", "Preference and validity", "BSID binding", "Steering classification"] },
            { title: "Data plane", tone: "mpls", tag: "every hop", points: ["SR labels only", "R3 executes its own Adj-SID", "R5 pops 16006 (PHP)", "Transit routers never see Color or preference"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="sp-fallback" eyebrow="Resilience" title="Fallback and DOWN" tone="danger">
        <DiagramFrame caption="Candidate fallback is headend re-selection after the topology change is learned.">
          <FallbackDiagram />
        </DiagramFrame>
        <p>
          If R3-R5 and R3-R4 both fail, no GOLD-tagged path remains, no candidate is valid and the policy is DOWN. In this lesson GOLD steering is strict: GOLD traffic is not silently sent over the IGP path, while DEFAULT traffic still reaches R6.
        </p>
      </GuideSection>

      <GuideSection id="sp-fault" eyebrow="Troubleshooting" title="The wrong-path incident" tone="danger">
        <ChecklistCard
          tone="danger"
          title="How to reason about it (no spoilers)"
          mark="→"
          items={["Connectivity is fine — so the question is intent, not reachability.", "Trace the packet and compare its path with the candidate operations expected.", "List every candidate: valid? preference? which one is ACTIVE?", "Ask which selection input would have to change for the intended candidate to win.", "After a fix, resend GOLD traffic and follow it — recomputation alone is not proof."]}
        />
      </GuideSection>

      <GuideSection id="sp-mistakes" eyebrow="Troubleshooting" title="Common mistakes" tone="warning">
        <ChecklistCard tone="warning" title="Avoid these" mark="!" items={["Treating Color as a label on the packet.", "Assuming the highest preference wins even when invalid.", "Assuming an UP policy steers all traffic to its endpoint.", "Calling candidate fallback \"TI-LFA\".", "Reading the policy's logical list as the wire stack."]} />
      </GuideSection>

      <GuideSection id="sp-challenge" eyebrow="Challenge" title="The engineer challenge" tone="violet">
        <p>Build the full GOLD intent: Color 100 from R1 to R6, an explicit candidate through R3 that forces R3→R5, and a lower-preference valid dynamic fallback. Check each piece against what you watched the headend do.</p>
      </GuideSection>

      <GuideSection id="sp-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "SR Policy", def: "Headend object ⟨headend, color, endpoint⟩ that realizes an intent with candidate paths." },
            { term: "Color", def: "Numeric intent identifier (here 100); never a label." },
            { term: "Candidate path", def: "One way to realize the policy — explicit or dynamic." },
            { term: "Preference", def: "Ranks valid candidates; highest valid one is active." },
            { term: "Binding SID", def: "Local handle bound to the policy (here 30001 at R1)." },
            { term: "Steering", def: "Deciding which traffic enters the policy." },
            { term: "Affinity", def: "Link tag (BLUE/GOLD) a dynamic candidate can require." },
          ]}
        />
      </GuideSection>

      <GuideSection id="sp-recap" eyebrow="Recap" title="Mental model" tone="success">
        <Callout tone="success" title="One sentence" icon="✓">
          The policy is headend intent; selection picks the best valid candidate; steering decides who uses it; and the wire only ever carries SR labels — with PHP removing a Prefix-SID one hop before its target.
        </Callout>
      </GuideSection>
    </>
  );
}
