import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DiagramFrame, DiagramSvg, FieldTable, FlowSteps, Glossary, GuideSection, Mono } from "@/components/lesson/GuideBlocks";
import { DHeaderColumn, SRV6_POLICY_POS, Srv6Topology, type Srv6Link } from "@/components/lesson/Srv6GuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";

export const SRV6P_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "lp-mission", label: "The mission" },
  { id: "lp-identity", label: "Policy identity and Color" },
  { id: "lp-topology", label: "Two metrics, two paths" },
  { id: "lp-sids", label: "This lesson's SIDs" },
  { id: "lp-candidates", label: "Two candidate paths" },
  { id: "lp-selection", label: "Selecting the active candidate" },
  { id: "lp-steering", label: "Steering and the BSID" },
  { id: "lp-encaps", label: "H.Encaps at R1" },
  { id: "lp-walk", label: "Following the probe" },
  { id: "lp-weights", label: "Weighted segment lists" },
  { id: "lp-failover", label: "Candidate failover" },
  { id: "lp-fault", label: "The inactive-candidate incident" },
  { id: "lp-invalid", label: "No valid candidate" },
  { id: "lp-b6", label: "End.B6.Encaps" },
  { id: "lp-mistakes", label: "Common mistakes" },
  { id: "lp-glossary", label: "Glossary" },
  { id: "lp-recap", label: "Mental model" },
];

const LINKS: Srv6Link[] = [
  { a: "R1", b: "R2", label: "10 / d20" },
  { a: "R2", b: "R4", label: "10 / d20" },
  { a: "R4", b: "R6", label: "10 / d20" },
  { a: "R1", b: "R3", label: "15 / d5" },
  { a: "R3", b: "R5", label: "15 / d5" },
  { a: "R5", b: "R6", label: "15 / d5" },
  { a: "R3", b: "R4", label: "20 / d15" },
];

function TopologyDiagram() {
  return (
    <DiagramSvg h={240} label="TOP path R1 R2 R4 R6 has IGP metric 10 and delay 20 per link; BOTTOM path R1 R3 R5 R6 has IGP metric 15 and delay 5 per link; cross-link R3-R4 has metric 20 and delay 15">
      <Srv6Topology pos={SRV6_POLICY_POS} links={LINKS} sub={{ R1: "headend", R3: "End · End.X", R5: "End", R6: "End.DX6" }} accent={{ R1: D.ip, R3: D.warning, R5: D.warning, R6: D.violet }} boxW={82} />
      <text x={320} y={230} textAnchor="middle" fill={D.muted} fontSize={10}>
        labels: IGP metric / delay · CLIENT1 sits behind R1, RECEIVER6 behind R6
      </text>
    </DiagramSvg>
  );
}

function CandidatesDiagram() {
  const card = (x: number, title: string, pref: string, kind: string, list: string, color: string) => (
    <g>
      <rect x={x} y={30} width={280} height={100} rx={12} fill={D.box} stroke={color} strokeOpacity={0.8} />
      <text x={x + 14} y={52} fill={color} fontSize={12} fontWeight={700}>
        {title}
      </text>
      <text x={x + 266} y={52} textAnchor="end" fill={D.text} fontSize={11} fontWeight={700}>
        {pref}
      </text>
      <text x={x + 14} y={74} fill={D.muted} fontSize={10}>
        {kind}
      </text>
      <text x={x + 14} y={104} fill={D.text} fontSize={10.5} fontFamily="monospace">
        {list}
      </text>
    </g>
  );
  return (
    <DiagramSvg h={160} label="CP-EXPLICIT, identity CONFIG R1 10, preference 200, list R3 End.X then R6 End.DX6; CP-DYNAMIC, identity LOCAL R1 20, preference 100, objective MIN_DELAY, list computed from the TE database">
      <text x={320} y={18} textAnchor="middle" fill={D.muted} fontSize={10}>
        policy ⟨R1, Color 100, R6⟩ — two ways to realize one intent
      </text>
      {card(30, "CP-EXPLICIT", "pref 200", "CONFIG/R1/10 · written by the operator", "⟨R3 End.X, R6 End.DX6⟩", D.mpls)}
      {card(330, "CP-DYNAMIC", "pref 100", "LOCAL/R1/20 · MIN_DELAY, recomputed", "derived from the TE database", D.violet)}
      <text x={320} y={152} textAnchor="middle" fill={D.muted} fontSize={10}>
        a candidate is identity + type + preference; its segment list is just the current contents
      </text>
    </DiagramSvg>
  );
}

function EncapsDiagram() {
  return (
    <DiagramSvg h={220} label="H.Encaps at R1: a new outer IPv6 header with DA R3 End.X, an SRH with SL 1, LE 1, Segment List 0 R6 End.DX6 and 1 R3 End.X, and the original probe preserved inside">
      <text x={130} y={22} textAnchor="middle" fill={D.text} fontSize={11.5} fontWeight={700}>
        from CLIENT1
      </text>
      <DHeaderColumn x={130} y={36} w={170} rows={[{ text: "IPv6 → 2001:db8:cafe:6::a", color: D.ip }]} caption="original probe" />
      <DArrow x1={220} y1={46} x2={300} y2={46} color={D.faint} width={1.4} label="H.Encaps" />
      <text x={470} y={22} textAnchor="middle" fill={D.text} fontSize={11.5} fontWeight={700}>
        leaving R1
      </text>
      <DHeaderColumn
        x={470}
        y={36}
        w={250}
        rows={[
          { text: "outer DA = 2001:db8:100:3:2:: (R3 End.X)", color: D.warning, tag: "OUTER", strong: true },
          { text: "SRH · SL 1 · LE 1", color: D.violet, tag: "SRH" },
          { text: "[0] 2001:db8:100:6:10:: (R6 End.DX6)", color: D.violet },
          { text: "[1] 2001:db8:100:3:2:: (R3 End.X)", color: D.violet },
          { text: "inner probe, unchanged", color: D.ip, tag: "INNER" },
        ]}
      />
      <text x={320} y={200} textAnchor="middle" fill={D.muted} fontSize={10}>
        Color 100 selected the policy — it appears in no header field
      </text>
    </DiagramSvg>
  );
}

function WalkDiagram() {
  const cols = [
    { x: 90, head: "R1 → R3", da: "DA R3 End.X", sl: "SL 1", note: "FIB toward R3's locator" },
    { x: 250, head: "R3 → R5", da: "DA R6 End.DX6", sl: "SL 0", note: "End.X, forced R3→R5" },
    { x: 410, head: "R5 → R6", da: "DA R6 End.DX6", sl: "SL 0", note: "R5 is transit" },
    { x: 565, head: "at R6", da: "DA R6 End.DX6", sl: "SL 0", note: "before End.DX6 decap" },
  ];
  return (
    <DiagramSvg h={150} label="R1 to R3 carries DA R3 End.X with SL 1; R3 executes End.X, so R3 to R5 and R5 to R6 carry DA R6 End.DX6 with SL 0; R6 decapsulates and delivers the probe to RECEIVER6">
      {cols.map((c, i) => (
        <g key={c.head}>
          <text x={c.x} y={20} textAnchor="middle" fill={D.text} fontSize={11} fontWeight={700}>
            {c.head}
          </text>
          <DHeaderColumn x={c.x} y={32} w={128} rows={[{ text: c.da, color: D.warning, strong: true }, { text: `${c.sl} · LE 1`, color: D.violet }]} caption={c.note} />
          {i < cols.length - 1 && <DArrow x1={c.x + 66} y1={43} x2={cols[i + 1].x - 66} y2={43} color={D.faint} width={1.2} />}
        </g>
      ))}
      <text x={320} y={140} textAnchor="middle" fill={D.muted} fontSize={10}>
        End.DX6 removes the outer IPv6 + SRH and cross-connects the original probe to RECEIVER6
      </text>
    </DiagramSvg>
  );
}

function FailoverDiagram() {
  return (
    <DiagramSvg h={240} label="With R3-R5 down, CP-EXPLICIT is invalid; CP-DYNAMIC recomputes the lowest-delay path R1 R3 R4 R6, delay 40">
      <Srv6Topology
        pos={SRV6_POLICY_POS}
        links={LINKS.map((l) => {
          const id = `${l.a}-${l.b}`;
          if (id === "R3-R5") return { ...l, color: D.danger, dashed: true, label: "DOWN" };
          if (id === "R1-R3" || id === "R3-R4" || id === "R4-R6") return { ...l, color: D.violet, bold: true };
          return l;
        })}
        sub={{ R1: "headend", R6: "endpoint" }}
        accent={{ R1: D.ip, R6: D.violet }}
        boxW={82}
      />
      <text x={320} y={230} textAnchor="middle" fill={D.violet} fontSize={10.5} fontWeight={700}>
        CP-DYNAMIC active: R1 → R3 → R4 → R6 (delay 5 + 15 + 20 = 40) — headend re-selection, not TI-LFA
      </text>
    </DiagramSvg>
  );
}

function B6Diagram() {
  return (
    <DiagramSvg h={180} label="End.B6.Encaps: an incoming packet whose active segment is R1's BSID is advanced like End, then a new outer IPv6 header and SRH for the bound policy are pushed, with the advanced original packet nested inside">
      <text x={140} y={20} textAnchor="middle" fill={D.text} fontSize={11} fontWeight={700}>
        incoming
      </text>
      <DHeaderColumn x={140} y={32} w={200} rows={[{ text: "DA = R1 BSID ::9000", color: D.warning, strong: true }, { text: "SRH SL 1 · [0] R6 End.DX6", color: D.violet }]} />
      <DArrow x1={245} y1={55} x2={325} y2={55} color={D.faint} width={1.4} label="End.B6.Encaps" />
      <text x={480} y={20} textAnchor="middle" fill={D.text} fontSize={11} fontWeight={700}>
        leaving R1
      </text>
      <DHeaderColumn
        x={480}
        y={32}
        w={220}
        rows={[
          { text: "NEW outer DA = R3 End.X", color: D.warning, tag: "NEW", strong: true },
          { text: "NEW SRH · SL 1 · LE 1", color: D.violet },
          { text: "nested: DA R6 End.DX6 · SL 0", color: D.ip, tag: "NESTED" },
        ]}
      />
      <text x={320} y={160} textAnchor="middle" fill={D.muted} fontSize={10}>
        the incoming SRH is advanced first, then encapsulated — never a bare DA = BSID packet
      </text>
    </DiagramSvg>
  );
}

export function Srv6PolicyLessonGuideContent() {
  return (
    <>
      <GuideSection id="lp-mission" eyebrow="Introduction" title="The mission: intent → candidate paths → H.Encaps" tone="ip">
        <p>
          Endpoint Behaviors showed what a SID does once reached. This lesson decides which ordered SIDs traffic should use, why that path was selected, and how traffic is steered onto it: SR Policy (RFC 9256) on the SRv6 data plane.
        </p>
        <Callout tone="cyan" title="Scope of this simulation" icon="i">
          One headend (R1), one policy ⟨R1, 100, R6⟩, local classification for steering, full SRH (H.Encaps.Red is a preview). The End, End.X and End.DX6 processing is reused from the earlier lessons, not re-implemented. No PCEP, controller or BGP SR Policy distribution is modeled.
        </Callout>
      </GuideSection>

      <GuideSection id="lp-identity" eyebrow="Policy state" title="Policy identity and Color" tone="violet">
        <FieldTable
          title="SR Policy ⟨headend, color, endpoint⟩"
          accent="violet"
          columns={["Field", "Value", "Meaning"]}
          rows={[
            ["Headend", "R1", "Where the policy is instantiated"],
            ["Color", <Mono key="c">100</Mono>, "Intent identifier (LOW_LATENCY here) used to select the policy"],
            ["Endpoint", "R6", "Where the intent delivers traffic"],
            ["Binding SID", <Mono key="b">2001:db8:100:1:9000::</Mono>, "R1-local SID bound to the policy"],
          ]}
        />
      </GuideSection>

      <GuideSection id="lp-topology" eyebrow="Setup" title="Two metrics, two paths" tone="ospf">
        <DiagramFrame caption="Every link carries an IGP metric and a delay metric.">
          <TopologyDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="lp-sids" eyebrow="Setup" title="This lesson's SIDs" tone="ip">
        <FieldTable
          title="SIDs used by the policies"
          accent="ip"
          columns={["SID", "Owner · behavior", "Why"]}
          rows={[
            [<Mono key="1">2001:db8:100:3:1::</Mono>, "R3 End", "Reach R3, then continue"],
            [<Mono key="2">2001:db8:100:3:2::</Mono>, "R3 End.X → R5", "Force the R3→R5 adjacency"],
            [<Mono key="3">2001:db8:100:5:1::</Mono>, "R5 End", "Reach R5, then continue"],
            [<Mono key="4">2001:db8:100:6:10::</Mono>, "R6 End.DX6 → RECEIVER6", "Final segment: remove H.Encaps and deliver"],
          ]}
        />
        <p>
          The final SID is End.DX6, not plain End: H.Encaps adds an outer header that only a decapsulating behavior removes. R3&apos;s End.X SID is itself routed under R3&apos;s locator, so R1 needs no separate R3 End SID before it.
        </p>
      </GuideSection>

      <GuideSection id="lp-candidates" eyebrow="Policy state" title="Two candidate paths" tone="mpls">
        <DiagramFrame caption="Candidates are alternatives inside one policy.">
          <CandidatesDiagram />
        </DiagramFrame>
        <FlowSteps
          steps={[
            { title: "Validate", body: "Non-empty list, every SID exists and is verified in R1's SR Database, End.X links up, first SID reachable, final SID owned by R6.", tone: "cyan" },
            { title: "Compute (dynamic)", body: "TE database → MIN_DELAY path → the smallest SID list that reproduces it.", tone: "violet" },
          ]}
        />
      </GuideSection>

      <GuideSection id="lp-selection" eyebrow="Policy state" title="Selecting the active candidate" tone="warning">
        <p>
          Selection validates every candidate, discards the invalid ones, and takes the highest preference among the survivors. Selection re-runs whenever an input changes: topology, SR Database verification, or configuration.
        </p>
      </GuideSection>

      <GuideSection id="lp-steering" eyebrow="Steering" title="Steering and the BSID" tone="cyan">
        <CompareCards
          items={[
            { title: "Steering (modeled)", tone: "cyan", tag: "local", points: ["Flow intent LOW_LATENCY", "→ Color 100 → endpoint R6", "→ policy ⟨R1, 100, R6⟩", "Other traffic is untouched"] },
            { title: "Binding SID", tone: "violet", tag: "R1-local", points: ["An IPv6 SID, function 0x9000", "Bound to the policy itself", "Used by End.B6.Encaps in the advanced experiment"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="lp-encaps" eyebrow="Data plane" title="H.Encaps at R1" tone="ip">
        <DiagramFrame caption="The active candidate's list becomes a new outer header and SRH.">
          <EncapsDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="lp-walk" eyebrow="Data plane" title="Following the probe" tone="ip">
        <DiagramFrame caption="R1 → R3 → R5 → R6 → RECEIVER6.">
          <WalkDiagram />
        </DiagramFrame>
        <p>
          The packet visual at R6 is labeled &quot;Stage shown: at R6 before End.DX6 decap&quot; — it is the input to the decapsulation, still carrying the outer header and SRH. The journey records the delivery to RECEIVER6.
        </p>
      </GuideSection>

      <GuideSection id="lp-weights" eyebrow="Lab" title="Weighted segment lists" tone="violet">
        <FieldTable
          title="Read-only lab (separate from CP-EXPLICIT / CP-DYNAMIC)"
          accent="violet"
          columns={["List", "Weight", "Segments"]}
          rows={[
            ["SL-A", "80", <Mono key="a">⟨R3 End.X, R6 End.DX6⟩</Mono>],
            ["SL-B", "20", <Mono key="b">⟨R5 End, R6 End.DX6⟩</Mono>],
          ]}
        />
        <p>Twenty pseudo-flows are hashed once each; the same flow always uses the same list. Weights split flows, never individual packets.</p>
      </GuideSection>

      <GuideSection id="lp-failover" eyebrow="Resilience" title="Candidate failover" tone="danger">
        <DiagramFrame caption="The policy stays UP; only the active candidate changes.">
          <FailoverDiagram />
        </DiagramFrame>
        <p>
          New traffic is freshly encapsulated from CP-DYNAMIC&apos;s list (outer DA = R3 End). The failover visual is labeled as the stage after R3&apos;s End and before R6&apos;s decapsulation.
        </p>
      </GuideSection>

      <GuideSection id="lp-fault" eyebrow="Troubleshooting" title="The inactive-candidate incident" tone="danger">
        <ChecklistCard
          tone="danger"
          title="How to reason about it (no spoilers)"
          mark="→"
          items={[
            "Traffic is delivered — so this is about intent, not reachability.",
            "List every candidate: valid or invalid? preference? which one is ACTIVE?",
            "For each candidate, find out with evidence why it is or is not eligible.",
            "Ask which input selection reads — not which knob is easiest to turn.",
            "After a fix, resend and confirm the physical path, not just the policy state.",
          ]}
        />
      </GuideSection>

      <GuideSection id="lp-invalid" eyebrow="Resilience" title="No valid candidate" tone="danger">
        <CompareCards
          items={[
            { title: "Drop-Upon-Invalid OFF", tone: "warning", tag: "PacketVerse default", points: ["Steered traffic falls through to ordinary IGP forwarding", "A modeled choice, clearly labeled"] },
            { title: "Drop-Upon-Invalid ON", tone: "danger", tag: "optional", points: ["Steering stays attached to the invalid policy", "The forwarding action is DROP"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="lp-b6" eyebrow="Advanced" title="End.B6.Encaps" tone="violet">
        <DiagramFrame caption="H.Encaps starts from classified traffic; End.B6.Encaps starts from a packet whose active SID is the BSID.">
          <B6Diagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="lp-mistakes" eyebrow="Troubleshooting" title="Common mistakes" tone="warning">
        <ChecklistCard
          tone="warning"
          title="Avoid these"
          mark="!"
          items={[
            "Treating Color as a SID, an SRH field or the SRH Tag.",
            "Letting an invalid candidate win on preference alone.",
            "Assuming an UP policy steers all traffic to its endpoint.",
            "Ending an H.Encaps list with plain End instead of a decapsulating SID.",
            "Calling candidate failover TI-LFA.",
            "Reusing a stale SRH after the active candidate changes.",
          ]}
        />
      </GuideSection>

      <GuideSection id="lp-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "SR Policy", def: "Headend object ⟨headend, color, endpoint⟩ with candidate paths (RFC 9256)." },
            { term: "Candidate path", def: "One way to realize the policy: explicit or dynamic, with a preference." },
            { term: "SR Database", def: "R1's verified view of SIDs that candidates may use." },
            { term: "H.Encaps", def: "Push a new outer IPv6 header and SRH; keep the original packet inside." },
            { term: "Binding SID", def: "Local SID bound to the policy; End.B6.Encaps applies it." },
            { term: "Drop-Upon-Invalid", def: "Optional: drop steered traffic when no candidate is valid." },
          ]}
        />
      </GuideSection>

      <GuideSection id="lp-recap" eyebrow="Recap" title="Mental model" tone="success">
        <Callout tone="success" title="One sentence" icon="✓">
          Color picks the policy, validity then preference picks the candidate, H.Encaps turns its list into a real outer header and SRH, and only SIDs — never Color — travel on the wire.
        </Callout>
      </GuideSection>
    </>
  );
}
