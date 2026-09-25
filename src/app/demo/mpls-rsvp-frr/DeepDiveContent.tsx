import { Callout, CompareCards, DArrow, DIAGRAM as D, DLink, DNode, DRegion, DiagramFrame, DiagramSvg, FieldTable, FlowSteps, Glossary, GuideSection, Mono } from "@/components/lesson/GuideBlocks";
import { DStack } from "@/components/lesson/MplsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";

export const FRR_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "fd-why", label: "Why local protection" },
  { id: "fd-styles", label: "One-to-one vs facility" },
  { id: "fd-scale", label: "One bypass, many LSPs" },
  { id: "fd-labels", label: "How the PLR learns labels" },
  { id: "fd-detect", label: "Failure detection" },
  { id: "fd-srlg", label: "SRLG-diverse bypasses" },
  { id: "fd-bw", label: "Bandwidth protection" },
  { id: "fd-signal", label: "Signaling during repair" },
  { id: "fd-alt", label: "FRR vs LFA / TI-LFA" },
  { id: "fd-trouble", label: "Troubleshooting ladder" },
  { id: "fd-glossary", label: "Glossary" },
  { id: "fd-model", label: "Mental model" },
];

function StylesDiagram() {
  return (
    <DiagramSvg h={200} label="One-to-one backup builds a detour per LSP; facility backup builds one bypass that many LSPs share">
      <text x={160} y={20} textAnchor="middle" fill={D.cyan} fontSize={11} fontWeight={700}>
        one-to-one (detour per LSP)
      </text>
      <DNode x={60} y={70} label="PLR" accent={D.warning} w={64} h={34} />
      <DNode x={260} y={70} label="MP" accent={D.violet} w={64} h={34} />
      <DArrow x1={92} y1={60} x2={228} y2={60} color={D.success} label="LSP-A" labelDy={-6} />
      <path d="M92 82 Q160 130 228 82" fill="none" stroke={D.cyan} strokeWidth={2} strokeDasharray="5 4" />
      <path d="M92 86 Q160 160 228 86" fill="none" stroke={D.cyan} strokeWidth={2} strokeDasharray="5 4" />
      <text x={160} y={176} textAnchor="middle" fill={D.muted} fontSize={10}>
        detour A, detour B… one per protected LSP
      </text>
      <text x={480} y={20} textAnchor="middle" fill={D.warning} fontSize={11} fontWeight={700}>
        facility backup (shared bypass)
      </text>
      <DNode x={380} y={70} label="PLR" accent={D.warning} w={64} h={34} />
      <DNode x={580} y={70} label="MP" accent={D.violet} w={64} h={34} />
      <DArrow x1={412} y1={60} x2={548} y2={60} color={D.success} label="LSP-A, B, C" labelDy={-6} />
      <path d="M412 84 Q480 150 548 84" fill="none" stroke={D.warning} strokeWidth={3} />
      <text x={480} y={176} textAnchor="middle" fill={D.muted} fontSize={10}>
        one bypass tunnel for every LSP crossing the resource
      </text>
    </DiagramSvg>
  );
}

function ScaleDiagram() {
  return (
    <DiagramSvg h={170} label="Three protected LSPs share the same outer bypass label but keep their own inner labels">
      <DStack x={130} y={36} labels={[{ text: "1000 S0", tag: "bypass", color: D.warning }, { text: "300 S1", tag: "LSP-A" }]} w={84} caption="LSP-A packet" />
      <DStack x={320} y={36} labels={[{ text: "1000 S0", tag: "bypass", color: D.warning }, { text: "310 S1", tag: "LSP-B" }]} w={84} caption="LSP-B packet" />
      <DStack x={510} y={36} labels={[{ text: "1000 S0", tag: "bypass", color: D.warning }, { text: "320 S1", tag: "LSP-C" }]} w={84} caption="LSP-C packet" />
      <text x={320} y={160} textAnchor="middle" fill={D.muted} fontSize={10}>
        hypothetical inner labels · same outer bypass label, a different inner label per LSP
      </text>
    </DiagramSvg>
  );
}

function LabelLearnDiagram() {
  return (
    <DiagramSvg h={210} label="The PLR learns the label the merge point expects from the RRO in the RESV, with label recording requested">
      <DNode x={80} y={110} label="R1" sub="headend" accent={D.mpls} w={84} />
      <DNode x={250} y={110} label="R3" sub="PLR" accent={D.warning} w={84} />
      <DNode x={420} y={110} label="R5" sub="NHOP" accent={D.mpls} w={84} />
      <DNode x={570} y={110} label="R7" sub="NNHOP" accent={D.mpls} w={84} />
      <DArrow x1={126} y1={60} x2={524} y2={60} color={D.cyan} label="PATH: SESSION_ATTRIBUTE flags = local protection desired, label recording desired" />
      <DArrow x1={524} y1={160} x2={296} y2={160} color={D.violet} label="RESV RRO: R7 label 200, R5 label 300…" labelDy={16} />
      <text x={320} y={202} textAnchor="middle" fill={D.warning} fontSize={10} fontWeight={700}>
        R3 now knows: link bypass → inner 300 · node bypass → inner 200
      </text>
    </DiagramSvg>
  );
}

function DetectDiagram() {
  const ev: [number, string, string, string][] = [
    [90, "loss of light", "fastest, physical", D.success],
    [250, "BFD", "tens of ms, configurable", D.cyan],
    [410, "RSVP hellos", "slower, protocol level", D.warning],
    [560, "IGP timers", "slowest", D.danger],
  ];
  return (
    <DiagramSvg h={120} label="Detection mechanisms from fastest to slowest: loss of light, BFD, RSVP hellos, IGP timers">
      <DArrow x1={40} y1={40} x2={610} y2={40} color={D.line} />
      <text x={600} y={28} textAnchor="end" fill={D.muted} fontSize={9.5}>
        slower →
      </text>
      {ev.map(([x, t, s, c]) => (
        <g key={t}>
          <circle cx={x} cy={40} r={6} fill={c} />
          <text x={x} y={70} textAnchor="middle" fill={c} fontSize={10.5} fontWeight={700}>
            {t}
          </text>
          <text x={x} y={86} textAnchor="middle" fill={D.muted} fontSize={9.5}>
            {s}
          </text>
        </g>
      ))}
      <text x={320} y={112} textAnchor="middle" fill={D.muted} fontSize={10}>
        FRR switchover is only as fast as detection
      </text>
    </DiagramSvg>
  );
}

function SrlgDiagram() {
  return (
    <DiagramSvg h={195} label="A bypass that shares a fiber conduit (SRLG) with the protected link fails together with it">
      <DRegion x={150} y={28} w={340} h={92} label="shared conduit (SRLG 17)" color={D.danger} />
      <DNode x={80} y={80} label="PLR" accent={D.warning} w={72} h={34} />
      <DNode x={560} y={80} label="MP" accent={D.violet} w={72} h={34} />
      <DLink x1={116} y1={70} x2={524} y2={70} color={D.success} label="protected link" labelDy={-8} />
      <DLink x1={116} y1={90} x2={524} y2={90} color={D.danger} dashed label="bad bypass: same conduit" labelDy={16} />
      <path d="M80 97 Q320 210 560 97" fill="none" stroke={D.warning} strokeWidth={2.4} />
      <text x={320} y={182} textAnchor="middle" fill={D.warning} fontSize={10} fontWeight={700}>
        good bypass: SRLG-diverse path
      </text>
    </DiagramSvg>
  );
}

function RepairSignalDiagram() {
  return (
    <DiagramSvg h={170} label="During repair the PLR refreshes PATH to the merge point through the bypass and tells the headend with a PathErr">
      <DNode x={80} y={100} label="R1" sub="headend" accent={D.mpls} w={84} />
      <DNode x={290} y={100} label="R3" sub="PLR" accent={D.warning} w={84} />
      <DNode x={520} y={100} label="R5" sub="MP" accent={D.violet} w={84} />
      <DArrow x1={244} y1={80} x2={126} y2={80} color={D.danger} label="PathErr: tunnel locally repaired" />
      <path d="M336 110 Q420 170 474 112" fill="none" stroke={D.warning} strokeWidth={2} strokeDasharray="5 4" />
      <text x={420} y={160} textAnchor="middle" fill={D.warning} fontSize={10} fontWeight={700}>
        PATH refresh via the bypass
      </text>
      <text x={320} y={30} textAnchor="middle" fill={D.muted} fontSize={10}>
        keeps downstream state alive and triggers headend reoptimization
      </text>
    </DiagramSvg>
  );
}

export function FrrDeepDiveContent() {
  return (
    <>
      <GuideSection id="fd-why" eyebrow="Background" title="Why local protection" tone="mpls">
        <p>
          End-to-end recovery needs the failure to reach the headend, a new CSPF run and fresh PATH/RESV signaling. That&apos;s often hundreds of milliseconds to seconds. RSVP-TE Fast Reroute (RFC 4090) pre-installs a repair at the router next to each protected resource, so traffic is redirected as soon as the failure is detected. The design target is commonly about 50 ms.
        </p>
      </GuideSection>

      <GuideSection id="fd-styles" eyebrow="Backup methods" title="One-to-one vs facility backup" tone="violet">
        <DiagramFrame caption="The lesson implements facility backup.">
          <StylesDiagram />
        </DiagramFrame>
        <CompareCards
          items={[
            { title: "One-to-one (detour)", tone: "cyan", tag: "per LSP", points: ["Each protected LSP gets its own detour LSP", "No extra label on repair (detour label replaces)", "State grows with LSPs × protected hops"] },
            { title: "Facility (bypass)", tone: "warning", tag: "per resource", points: ["One bypass per protected link/node", "Repair pushes an extra outer label", "Scales to many LSPs"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="fd-scale" eyebrow="Backup methods" title="One bypass, many LSPs" tone="warning">
        <DiagramFrame caption="Label stacking is what lets one tunnel carry many protected LSPs.">
          <ScaleDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="fd-labels" eyebrow="Control plane" title="How the PLR learns the Merge Point's label" tone="violet">
        <p>
          For the repair stack the PLR needs the label the MP expects: its own next hop&apos;s label (link protection) or the next-next hop&apos;s (node protection). It learns them from label subobjects in the RESV&apos;s Record Route Object, which the headend asks for when it requests protection.
        </p>
        <DiagramFrame caption="Using this lesson's labels: 300 is R5's, 200 is R7's.">
          <LabelLearnDiagram />
        </DiagramFrame>
        <Callout tone="warning" title="Inner label = what the MP expects" icon="!">
          Link protection: inner = NHOP&apos;s label (<Mono>300</Mono>, what R5 expects). Node protection: inner = NNHOP&apos;s label (<Mono>200</Mono>, what R7 expects). Either way the outer bypass label sits on top with S=0 and the inner label keeps S=1.
        </Callout>
      </GuideSection>

      <GuideSection id="fd-detect" eyebrow="Detection" title="Failure detection" tone="cyan">
        <DiagramFrame caption="Detection and repair are separate problems.">
          <DetectDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="fd-srlg" eyebrow="Design" title="SRLG-diverse bypasses" tone="danger">
        <DiagramFrame caption="Different links on a diagram can share one physical risk.">
          <SrlgDiagram />
        </DiagramFrame>
        <p>
          A <b className="text-pv-text">Shared Risk Link Group</b> marks links that can fail together (same fiber duct, same line card). A bypass should avoid the protected resource&apos;s SRLGs, not just the resource itself.
        </p>
      </GuideSection>

      <GuideSection id="fd-bw" eyebrow="Design" title="Bandwidth protection" tone="warning">
        <CompareCards
          items={[
            { title: "Bandwidth-protected bypass", tone: "success", tag: "guaranteed", points: ["Bypass reserves bandwidth (as in this lesson)", "Protected traffic keeps its guarantee during repair", "Consumes capacity even when idle"] },
            { title: "Zero-bandwidth bypass", tone: "warning", tag: "best effort", points: ["Common in practice", "Repair is fast, but may congest", "Relies on repair being short-lived"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="fd-signal" eyebrow="Control plane" title="Signaling during repair" tone="violet">
        <DiagramFrame caption="Repair is data-plane fast; the control plane catches up behind it.">
          <RepairSignalDiagram />
        </DiagramFrame>
        <FlowSteps
          steps={[
            { title: "Keep state alive", body: "The PLR refreshes PATH toward the MP through the bypass, so downstream soft state doesn't time out.", tone: "warning" },
            { title: "Tell the headend", body: "A PathErr (and RRO flags) report that local repair is in use.", tone: "danger" },
            { title: "Reoptimize", body: "The headend computes a new path and moves the LSP make-before-break style.", tone: "success" },
          ]}
        />
      </GuideSection>

      <GuideSection id="fd-alt" eyebrow="Context" title="FRR vs LFA and TI-LFA" tone="cyan">
        <FieldTable
          title="Local protection options"
          accent="cyan"
          columns={["Mechanism", "Where it applies", "Needs pre-signaled tunnels?"]}
          rows={[
            ["RSVP-TE FRR", "RSVP-TE LSPs", "Yes: bypass or detour LSPs"],
            ["LFA / rLFA", "IGP/LDP traffic", "No: precomputed IGP alternates (partial coverage)"],
            ["TI-LFA", "Segment Routing", "No: repair segment list (full coverage in most topologies)"],
          ]}
        />
      </GuideSection>

      <GuideSection id="fd-trouble" eyebrow="Operations" title="Troubleshooting ladder" tone="danger">
        <FieldTable
          title="Is the LSP actually protected against the failure you care about?"
          accent="danger"
          columns={["Check", "Question", "Typical command idea"]}
          rows={[
            ["Protection requested", "Does the LSP ask for local protection (and node protection)?", "show mpls traffic-eng tunnels detail"],
            ["Bypass exists", "Is a bypass UP at the PLR for this resource?", "show mpls traffic-eng fast-reroute database"],
            ["Type matches", "Link (NHOP) or node (NNHOP) bypass? Does its MP survive the failure?", "fast-reroute database: protection type / MP"],
            ["Bypass path", "Does it avoid the resource and its SRLGs?", "show mpls traffic-eng tunnels (bypass)"],
            ["Status", "READY vs ACTIVE vs UNAVAILABLE", "show ip rsvp fast-reroute"],
            ["Detection", "Will the PLR notice fast enough?", "show bfd neighbors"],
          ]}
        />
        <Callout tone="warning" title="READY isn't a promise" icon="!">
          Protection can be READY and still not cover the failure that actually happens. Always compare the protected resource with the one that failed.
        </Callout>
      </GuideSection>

      <GuideSection id="fd-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "NHOP / NNHOP", def: "Next hop / next-next hop: the MP for link vs node protection." },
            { term: "Detour", def: "One-to-one backup LSP for a single protected LSP." },
            { term: "Facility backup", def: "Shared bypass protecting every LSP across a resource." },
            { term: "SRLG", def: "Shared Risk Link Group: links that can fail together." },
            { term: "Label recording", def: "RRO carries each hop's label so the PLR can build the repair stack." },
            { term: "PathErr", def: "RSVP error/notification sent toward the headend." },
            { term: "BFD", def: "Bidirectional Forwarding Detection: fast liveness checks." },
            { term: "TI-LFA", def: "Topology-Independent LFA: SR-based local protection." },
          ]}
        />
      </GuideSection>

      <GuideSection id="fd-model" eyebrow="Recap" title="Mental model" tone="mpls">
        <div className="rounded-2xl border border-pv-mpls/30 bg-gradient-to-br from-pv-mpls/10 to-pv-violet/5 p-5 text-sm leading-relaxed text-pv-text">
          Protection is a promise about one specific resource. The bypass must avoid that resource (and its shared risks) and end at a Merge Point that survives it. At failure the PLR builds a two-label repair stack: outer = bypass, inner = the MP&apos;s expected label, S=1 only at the bottom. The headend reoptimizes afterwards. If the resource that failed isn&apos;t the one that was protected, READY protection does nothing.
        </div>
      </GuideSection>
    </>
  );
}
