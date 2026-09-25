import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DNode, DPill, DiagramFrame, DiagramSvg, FieldTable, FlowSteps, Glossary, GuideSection, Mono } from "@/components/lesson/GuideBlocks";
import { DStack } from "@/components/lesson/MplsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";

export const SRP_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "pq-arch", label: "SR Policy architecture" },
  { id: "pq-identity", label: "Identity and color" },
  { id: "pq-candidates", label: "Candidate paths" },
  { id: "pq-explicit", label: "Explicit vs dynamic" },
  { id: "pq-bsid", label: "Binding SID" },
  { id: "pq-steering", label: "Steering" },
  { id: "pq-weights", label: "Preference vs weight" },
  { id: "pq-wire", label: "Policy list vs wire stack" },
  { id: "pq-fallback", label: "Fallback vs local repair" },
  { id: "pq-trouble", label: "Troubleshooting" },
  { id: "pq-verify", label: "Verification" },
  { id: "pq-glossary", label: "Glossary" },
  { id: "pq-mental", label: "Mental model" },
];

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

export function SrPolicyDeepDiveContent() {
  return (
    <>
      <GuideSection id="pq-arch" eyebrow="Architecture" title="SR Policy architecture" tone="mpls">
        <DiagramFrame caption="Policy → candidate paths → segment lists.">
          <ArchitectureDiagram />
        </DiagramFrame>
        <p>An SR Policy is a headend construct that turns intent into a segment list. Candidates can be configured locally, computed at the headend, or provided by a controller (PCEP or BGP SR Policy); this lesson models local configuration and headend computation only.</p>
      </GuideSection>

      <GuideSection id="pq-identity" eyebrow="Concepts" title="Identity and color" tone="violet">
        <FieldTable
          title="What identifies a policy"
          accent="violet"
          columns={["Part", "What it is", "What it is not"]}
          rows={[
            ["Headend", "The router that instantiates the policy", "Every router on the path"],
            ["Color", "A numeric intent identifier", "An MPLS label, VLAN or DSCP value"],
            ["Endpoint", "Where the intent delivers", "Every hop in the segment list"],
          ]}
        />
      </GuideSection>

      <GuideSection id="pq-candidates" eyebrow="Selection" title="Candidate paths" tone="warning">
        <DiagramFrame caption="Validity first, preference second.">
          <PreferenceDiagram />
        </DiagramFrame>
        <p>Validation checks that SIDs exist and resolve, that Adj-SIDs can execute at their owners and their links are up, and that constraints are satisfiable. Only then does preference rank the survivors.</p>
      </GuideSection>

      <GuideSection id="pq-explicit" eyebrow="Selection" title="Explicit vs dynamic" tone="mpls">
        <CompareCards
          items={[
            { title: "Explicit", tone: "mpls", tag: "operator-written", points: ["A fixed segment list", "Predictable path", "Invalid if one SID can't execute", "No recomputation around failures"] },
            { title: "Dynamic", tone: "violet", tag: "headend-computed", points: ["Computed from metric + constraints", "Recomputes after topology change", "Can collapse to fewer SIDs", "No bandwidth reservation implied"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="pq-bsid" eyebrow="Concepts" title="Binding SID" tone="violet">
        <DiagramFrame caption="A BSID hides a policy's segment list behind one local label.">
          <BsidDiagram />
        </DiagramFrame>
        <p>A Binding SID gives the policy a stable handle: the segment list behind it can change without anyone upstream noticing. It is local to the headend that owns it — transit routers are not expected to understand it.</p>
      </GuideSection>

      <GuideSection id="pq-steering" eyebrow="Steering" title="Steering" tone="cyan">
        <FlowSteps
          steps={[
            { title: "Classify", body: "Local match on the flow (as in this lesson).", tone: "cyan" },
            { title: "Color match", body: "Real networks often use a BGP route's color to pick the policy (not modeled).", tone: "violet" },
            { title: "BSID", body: "An upstream node can steer by pushing the BSID.", tone: "violet" },
            { title: "Impose", body: "The headend imposes the active candidate's list.", tone: "mpls" },
          ]}
        />
        <Callout tone="warning" title="UP is not the same as used" icon="!">
          A policy can be UP while traffic that was never steered into it keeps using ordinary IGP forwarding.
        </Callout>
      </GuideSection>

      <GuideSection id="pq-weights" eyebrow="Advanced" title="Preference vs weight" tone="cyan">
        <DiagramFrame caption="Two different knobs at two different levels.">
          <WeightDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="pq-wire" eyebrow="Data plane" title="Policy list vs wire stack" tone="mpls">
        <p>
          A candidate&apos;s segment list is a logical instruction list at the headend. On the wire, Prefix-SIDs whose target advertises implicit-null are removed by the penultimate hop — and if the headend itself is that hop, the first SID is never imposed. In the lesson, GOLD-EXPLICIT&apos;s logical list <Mono>16003 → 24035 → 16006</Mono> leaves R1 as <Mono>24035 S0 / 16006 S1</Mono>.
        </p>
      </GuideSection>

      <GuideSection id="pq-fallback" eyebrow="Resilience" title="Fallback vs local repair" tone="danger">
        <DiagramFrame caption="Headend re-selection and local repair act at different places and times.">
          <FallbackTimelineDiagram />
        </DiagramFrame>
        <p>No universal recovery time applies to either mechanism; it depends on detection, flooding and hardware. When no candidate is valid the policy goes DOWN, and what happens to its traffic is a design choice — strict (drop) or fall back to the IGP.</p>
      </GuideSection>

      <GuideSection id="pq-trouble" eyebrow="Operations" title="Troubleshooting" tone="warning">
        <ChecklistCard
          tone="warning"
          title="Work from intent to packets"
          mark="→"
          items={["Is the policy present with the expected headend, color and endpoint?", "Is it UP? If not, why is every candidate invalid?", "Which candidate is ACTIVE, and is that the intended one?", "Does the active list resolve: SIDs known, Adj-SIDs owned and links up?", "Is the traffic actually steered into the policy?", "Does a traced packet follow the expected path?"]}
        />
      </GuideSection>

      <GuideSection id="pq-verify" eyebrow="Operations" title="Verification" tone="success">
        <FieldTable
          title="Typical checks (names vary by vendor)"
          accent="success"
          columns={["Question", "Look at"]}
          rows={[
            ["Policy state and active candidate", <Mono key="a">SR-TE policy detail</Mono>],
            ["Segment list and its resolution", "Policy segment-list output"],
            ["Which traffic is steered", "Steering / classification counters"],
            ["Actual labels per hop", "MPLS forwarding table and packet trace"],
          ]}
        />
      </GuideSection>

      <GuideSection id="pq-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "Headend", def: "The router that owns and instantiates the policy." },
            { term: "Endpoint", def: "The destination the policy's intent delivers to." },
            { term: "Candidate path", def: "An alternative realization of the policy with a preference." },
            { term: "Segment list", def: "The ordered SIDs a candidate imposes." },
            { term: "BSID", def: "Binding SID — local handle for the policy." },
            { term: "Weight", def: "Load share between segment lists inside one candidate." },
            { term: "PCEP", def: "Protocol a controller can use to provide candidates (not modeled)." },
          ]}
        />
      </GuideSection>

      <GuideSection id="pq-mental" eyebrow="Recap" title="Mental model" tone="success">
        <Callout tone="success" title="Remember" icon="✓">
          Intent lives at the headend; candidates compete by validity then preference; steering chooses who uses the winner; the data plane sees nothing but the imposed SR labels.
        </Callout>
      </GuideSection>
    </>
  );
}
