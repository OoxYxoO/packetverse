import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DNode, DPill, DiagramFrame, DiagramSvg, FieldTable, Glossary, GuideSection, Mono } from "@/components/lesson/GuideBlocks";
import { DHeaderColumn } from "@/components/lesson/Srv6GuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";

export const SRV6P_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "pd-arch", label: "SR Policy architecture" },
  { id: "pd-sources", label: "Where candidates come from" },
  { id: "pd-selection", label: "Validity and selection" },
  { id: "pd-steering", label: "Steering methods" },
  { id: "pd-encaps", label: "H.Encaps vs H.Encaps.Red" },
  { id: "pd-bsid", label: "Binding SIDs and stitching" },
  { id: "pd-weights", label: "Weighted lists and ECMP" },
  { id: "pd-invalid", label: "When no candidate is valid" },
  { id: "pd-repair", label: "Re-selection vs local repair" },
  { id: "pd-compare", label: "SRv6 vs SR-MPLS policy" },
  { id: "pd-trouble", label: "Troubleshooting" },
  { id: "pd-verify", label: "Verification" },
  { id: "pd-glossary", label: "Glossary" },
  { id: "pd-mental", label: "Mental model" },
];

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

export function Srv6PolicyDeepDiveContent() {
  return (
    <>
      <GuideSection id="pd-arch" eyebrow="Architecture" title="SR Policy architecture" tone="violet">
        <DiagramFrame caption="RFC 9256 — identical for SR-MPLS and SRv6.">
          <ArchitectureDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="pd-sources" eyebrow="Control plane" title="Where candidates come from" tone="cyan">
        <FieldTable
          title="Candidate path sources"
          accent="cyan"
          columns={["Source", "Typical use"]}
          rows={[
            ["Local configuration", "Explicit lists or local dynamic computation (as in this lesson)"],
            ["PCEP", "A path computation element computes and maintains the path"],
            ["BGP SR Policy", "A controller distributes candidate paths to headends"],
          ]}
        />
        <p>Several sources can offer candidates for the same policy; selection treats them uniformly.</p>
      </GuideSection>

      <GuideSection id="pd-selection" eyebrow="Selection" title="Validity and selection" tone="warning">
        <DiagramFrame caption="Validity first, preference second.">
          <SelectionDiagram />
        </DiagramFrame>
        <p>
          An explicit list is invalid if its first SID is unreachable or a SID cannot be resolved or verified. A dynamic candidate is invalid if no path meets its constraints. Selection re-runs on every relevant change.
        </p>
      </GuideSection>

      <GuideSection id="pd-steering" eyebrow="Steering" title="Steering methods" tone="cyan">
        <DiagramFrame caption="Building a policy does not steer anything by itself.">
          <AutoSteeringDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="pd-encaps" eyebrow="Data plane" title="H.Encaps vs H.Encaps.Red" tone="ip">
        <DiagramFrame caption="Both keep the original packet intact inside a new outer header.">
          <EncapsCompareDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="pd-bsid" eyebrow="Scale" title="Binding SIDs and stitching" tone="violet">
        <DiagramFrame caption="A BSID hides a whole policy behind one SID.">
          <StitchingDiagram />
        </DiagramFrame>
        <p>
          In SRv6 the BSID is an IPv6 SID bound to <Mono>End.B6.Encaps</Mono> (or its reduced variant). The node advances the incoming SRH like End, then encapsulates the packet into the bound policy.
        </p>
      </GuideSection>

      <GuideSection id="pd-weights" eyebrow="Load sharing" title="Weighted lists and ECMP" tone="violet">
        <p>
          A candidate path can hold several segment lists with weights; traffic is split per flow by hashing, so packets of one flow stay in order. Separately, each segment can itself use IGP ECMP toward its owner&apos;s locator.
        </p>
      </GuideSection>

      <GuideSection id="pd-invalid" eyebrow="Resilience" title="When no candidate is valid" tone="danger">
        <CompareCards
          items={[
            { title: "Default behavior", tone: "warning", tag: "implementation choice", points: ["Steered traffic is typically forwarded on the IGP path", "Intent silently degrades"] },
            { title: "Drop-Upon-Invalid", tone: "danger", tag: "RFC 9256 option", points: ["Steered traffic is dropped", "Protects strict intents (e.g. disjointness)"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="pd-repair" eyebrow="Resilience" title="Re-selection vs local repair" tone="danger">
        <CompareCards
          items={[
            { title: "Candidate re-selection", tone: "violet", tag: "headend", points: ["After the headend learns of the change", "New encapsulation from the new candidate"] },
            { title: "TI-LFA", tone: "warning", tag: "local", points: ["Precomputed at the router next to the failure", "Acts before the headend reacts"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="pd-compare" eyebrow="Model" title="SRv6 vs SR-MPLS policy" tone="mpls">
        <FieldTable
          title="Same policy model, different data plane"
          accent="mpls"
          columns={["", "SR-MPLS", "SRv6"]}
          rows={[
            ["Identity, candidates, selection", "RFC 9256", "RFC 9256"],
            ["Segments", "Labels", "IPv6 SIDs"],
            ["Headend action", "PUSH a label stack", "H.Encaps (outer IPv6 + SRH)"],
            ["Active segment", "Top label", "Outer IPv6 DA"],
            ["BSID", "MPLS label", "IPv6 SID (End.B6.Encaps)"],
          ]}
        />
      </GuideSection>

      <GuideSection id="pd-trouble" eyebrow="Operations" title="Troubleshooting" tone="warning">
        <ChecklistCard
          tone="warning"
          title="Policy checklist"
          mark="→"
          items={[
            "Is traffic steered into the policy at all (color, endpoint, classifier)?",
            "Which candidates exist, which are valid, and why?",
            "Are all SIDs in each list known and verified at the headend?",
            "Does the installed encapsulation match the active candidate's list?",
            "Does a real packet follow the intended physical path?",
          ]}
        />
      </GuideSection>

      <GuideSection id="pd-verify" eyebrow="Operations" title="Verification" tone="success">
        <ChecklistCard tone="success" title="What to check (vendor-neutral)" mark="✓" items={["Policy state: UP, active candidate, BSID.", "Per-candidate validity and preference.", "Forwarding entry: outer DA and SRH the headend imposes.", "A capture of a steered packet at each hop."]} />
      </GuideSection>

      <GuideSection id="pd-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "Color", def: "32-bit intent identifier; selects a policy, never carried in the packet." },
            { term: "Automated steering", def: "BGP routes whose color and next hop match a policy are steered into it." },
            { term: "Tie-breaker", def: "Protocol origin, originator and discriminator, used after preference." },
            { term: "H.Encaps.Red", def: "Encapsulation that omits the first SID from the SRH." },
            { term: "End.B6.Encaps", def: "Endpoint behavior of an SRv6 BSID." },
            { term: "Stitching", def: "Using a BSID to hand traffic to another node's policy." },
          ]}
        />
      </GuideSection>

      <GuideSection id="pd-mental" eyebrow="Recap" title="Mental model" tone="success">
        <Callout tone="success" title="One sentence" icon="✓">
          A policy is headend state: candidates are validated, the best valid one is selected, steering decides who enters, and the SRv6 data plane only ever sees an outer IPv6 header, an SRH and SIDs.
        </Callout>
      </GuideSection>
    </>
  );
}
