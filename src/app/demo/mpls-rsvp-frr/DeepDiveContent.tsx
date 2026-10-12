import { Callout, CompareCards, DArrow, DIAGRAM as D, DLink, DNode, DRegion, DiagramFrame, DiagramSvg, FailureSignatures, FieldTable, GuideSection, Misconceptions, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { DStack } from "@/components/lesson/MplsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { ExplainIt, KnowledgeQuiz, PracticeBridge, type KnowledgeQuestion } from "@/components/lesson/GuideInteractive";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import { PresentationBridge } from "@/components/presentation/LessonPresentation";
import { CliPair, CliPanel, FailureWalk } from "@/components/lesson/GuideCli";
import { frApply, frTicket, frTicketState, type FrTicketId } from "@/lib/sim-engine/scenarios/frrNet";
import { DrillResult, FR_HEALTHY, FR_HEALTHY_JN, frCli, frOnly } from "./LessonGuideContent";

const G = { foundation: "Foundation", backup: "Backup methods", labels: "Labels and signaling", detect: "Detection", design: "Design", ops: "Operations", trouble: "Troubleshooting", beyond: "Beyond this lesson", master: "Master it" };
export const FRR_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "fd-why", label: "Why local protection", group: G.foundation },
  { id: "fd-terms", label: "PLR, MP, NHOP, NNHOP", group: G.foundation },
  { id: "fd-network", label: "The network you will study", group: G.foundation },
  { id: "fd-styles", label: "One-to-one vs facility", group: G.backup },
  { id: "fd-scale", label: "One bypass, many LSPs", group: G.backup },
  { id: "fd-auto", label: "Automatic and manual bypasses", group: G.backup },
  { id: "fd-binding", label: "Which bypass an LSP gets", group: G.backup },
  { id: "fd-labels", label: "How the PLR learns labels", group: G.labels },
  { id: "fd-signal", label: "Signaling during repair", group: G.labels },
  { id: "fd-reopt", label: "After the repair", group: G.labels },
  { id: "fd-detect", label: "Failure detection", group: G.detect },
  { id: "fd-bfd", label: "BFD on silent links", group: G.detect },
  { id: "fd-srlg", label: "SRLG-diverse bypasses", group: G.design },
  { id: "fd-bw", label: "Bandwidth protection", group: G.design },
  { id: "fd-limits", label: "What can't be protected", group: G.design },
  { id: "fd-config", label: "Configuring it: IOS XR and Junos", group: G.ops },
  { id: "fd-verify", label: "How to verify", group: G.ops },
  { id: "fd-signatures", label: "Failure signatures", group: G.trouble },
  { id: "fd-workflow", label: "Investigation workflow", group: G.trouble },
  { id: "fd-tickets", label: "Five faults, evidence to proof", group: G.trouble },
  { id: "fd-alt", label: "FRR vs LFA / TI-LFA", group: G.beyond },
  { id: "fd-myths", label: "Common misconceptions", group: G.master },
  { id: "fd-quiz", label: "Knowledge check", group: G.master },
  { id: "fd-explain", label: "Can you explain it?", group: G.master },
  { id: "fd-practice", label: "Practice in the Fast Reroute Lab", group: G.master },
];

// Real CLI output and drill results: the Fast Reroute Lab's own command sets and model.
const ticket = (id: FrTicketId) => frTicket(id).repro.reduce((acc, a) => frApply(acc, a), frTicketState(id, 1));
const settled = (id: FrTicketId) => frApply(frApply(ticket(id), { type: "restore" }), { type: "reopt" });
const T = { node: ticket("node"), nofrr: ticket("nofrr"), bypassdown: ticket("bypassdown"), plr: ticket("plr"), bfd: ticket("bfd") };
const S = { nofrr: settled("nofrr"), bypassdown: settled("bypassdown"), plr: settled("plr"), bfd: settled("bfd") };

function LabBridge() {
  const openLab = usePracticeLabOpener();
  return (
    <PracticeBridge label="Open the Fast Reroute Lab" onPractice={openLab}>
      The network from this page, IOS XR or Junos, your own copy. Nothing you do there changes your lesson progress.
    </PracticeBridge>
  );
}

/** The lab's network and who protects what. */
function LabNet() {
  const n: Record<string, [number, number, string]> = { R1: [60, 60, "1.1.1.1"], R3: [190, 60, "3.3.3.3"], R5: [330, 60, "5.5.5.5"], R7: [470, 60, "7.7.7.7"], R6: [590, 60, "6.6.6.6"], R4: [330, 170, "4.4.4.4"] };
  const l: [string, string, string, string][] = [
    ["R1", "R3", "10", D.success],
    ["R3", "R5", "10 · DWDM", D.success],
    ["R5", "R7", "10", D.success],
    ["R7", "R6", "10", D.success],
    ["R3", "R4", "15", D.faint],
    ["R4", "R5", "15", D.faint],
    ["R4", "R7", "20", D.faint],
  ];
  return (
    <DiagramSvg h={230} label="Primary R1-R3-R5-R7-R6; R4 connects to R3, R5 and R7; R3-R5 crosses a DWDM system">
      {l.map(([a, b, t, c]) => (
        <DLink key={a + b} x1={n[a][0]} y1={n[a][1]} x2={n[b][0]} y2={n[b][1]} color={c} label={t} labelDy={n[a][1] === n[b][1] ? -8 : 0} />
      ))}
      {Object.entries(n).map(([id, [x, y, lo]]) => (
        <DNode key={id} x={x} y={y} label={id} sub={lo} accent={D.mpls} w={76} />
      ))}
      <text x={320} y={222} textAnchor="middle" fill={D.muted} fontSize={10}>
        PLRs: R3 (for R3–R5 and R5) · R5 (for R5–R7) · R1, R7 have no way around
      </text>
    </DiagramSvg>
  );
}

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


const QUIZ: KnowledgeQuestion[] = [
  {
    id: "q-plr",
    prompt: "R5–R7 fails. Which router is the point of local repair for tunnel-te1?",
    options: [
      { id: "a", label: "R5 — the router just before the failed link" },
      { id: "b", label: "R3" },
      { id: "c", label: "R1, the headend" },
    ],
    correctId: "a",
    explanation: "Each protected link or router has its own PLR: the upstream neighbor on the LSP. For R5–R7 that is R5.",
  },
  {
    id: "q-nhop",
    prompt: "R3 only has an NHOP bypass (R3–R4–R5). R5 loses power. What happens to tunnel-te1?",
    options: [
      { id: "a", label: "No local repair: the bypass ends at R5; the headend re-signals after ~1.5 s" },
      { id: "b", label: "R3 repairs locally through R4" },
      { id: "c", label: "R7 repairs it" },
    ],
    correctId: "a",
    explanation: "An NHOP bypass merges at the next hop. When that router is the failure, only an NNHOP bypass helps.",
  },
  {
    id: "q-label",
    prompt: "During a node repair at R3, which label is under the bypass label?",
    options: [
      { id: "a", label: "The label R7 gave to R5 for tunnel-te1 — learned from the RRO" },
      { id: "b", label: "R3's own incoming label" },
      { id: "c", label: "Implicit-null" },
    ],
    correctId: "a",
    explanation: "The merge point must receive the label it expects. For an NNHOP bypass that is R7's label, which R3 learns from the recorded labels.",
  },
  {
    id: "q-bfd",
    prompt: "The bypass is up and bound, but a DWDM span failure costs 30 seconds. Why?",
    options: [
      { id: "a", label: "The PLR keeps its light and has no BFD: it detects the failure only when IS-IS times out" },
      { id: "b", label: "Bypasses take 30 seconds to activate" },
      { id: "c", label: "The headend blocks the repair" },
    ],
    correctId: "a",
    explanation: "Local repair starts at detection. Silent failures need BFD (here 45 ms).",
  },
  {
    id: "q-req",
    prompt: "Protection is configured on every PLR, yet a failure costs 1.5 s. What do you check first on the headend?",
    options: [
      { id: "a", label: "Whether the LSP requests fast reroute at all" },
      { id: "b", label: "The IS-IS metrics" },
      { id: "c", label: "The bypass bandwidth" },
    ],
    correctId: "a",
    explanation: "An LSP that doesn't request protection is never bound to a bypass.",
  },
  {
    id: "q-reopt",
    prompt: "After a local repair, what does the headend do?",
    options: [
      { id: "a", label: "Signals a new path that avoids the failure (make-before-break); the bypass is released" },
      { id: "b", label: "Nothing — traffic stays on the bypass" },
      { id: "c", label: "Tears down the LSP" },
    ],
    correctId: "a",
    explanation: "Bypasses are temporary. The PLR's PathErr tells the headend to re-optimize.",
  },
  {
    id: "q-facility",
    prompt: "Ten LSPs leave R3 toward R5. How many NHOP bypasses does facility backup need at R3?",
    options: [
      { id: "a", label: "One — it protects every LSP leaving through that interface" },
      { id: "b", label: "Ten" },
      { id: "c", label: "One per LSP and per hop" },
    ],
    correctId: "a",
    explanation: "Facility backup shares one bypass per protected resource; each LSP keeps its own inner label.",
  },
  {
    id: "q-limit",
    prompt: "Why can't R7–R6 be protected in this network?",
    options: [
      { id: "a", label: "R6 has only one link: there is no way around it" },
      { id: "b", label: "R7 doesn't run BFD" },
      { id: "c", label: "The tail never protects" },
    ],
    correctId: "a",
    explanation: "Protection needs a second way out. A single-homed router can't be bypassed.",
  },
];

export function FrrDeepDiveContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="fd-why" eyebrow="Foundation" title="Why local protection" tone="mpls">
        <p>When a link or router on an LSP fails, end-to-end recovery needs the headend: it must learn about the failure (PathErr, IGP flooding), recompute the path and signal a new LSP. Each step is quick, together they cost around a second and a half — too long for voice, video or anything that counts packets. Fast reroute moves the decision to the router that sees the failure first, with a detour prepared in advance.</p>
        <DrillResult s={frApply(frApply(FR_HEALTHY, { type: "set", text: "no frr", changes: [{ dev: "R1", f: (c) => void (c.tunnels[0].frr = "off") }] }), { type: "drill", what: "link:R5-R7" })} title="The lab: R5–R7 fails, tunnel-te1 without fast reroute" />
      </GuideSection>

      <GuideSection id="fd-terms" eyebrow="Foundation" title="PLR, MP, NHOP, NNHOP" tone="cyan">
        <FieldTable
          title="The vocabulary of RFC 4090"
          accent="mpls"
          columns={["Term", "Meaning", "In the lab"]}
          rows={[
            ["PLR", "Point of Local Repair: the router before the protected resource", "R3 for R3–R5 and R5; R5 for R5–R7"],
            ["MP", "Merge point: where the bypass rejoins the LSP", "R5 (NHOP) or R7 (NNHOP) for R3's bypasses"],
            ["NHOP bypass", "to the next hop, avoiding the link", "R3–R4–R5, R5–R4–R7"],
            ["NNHOP bypass", "to the next-next hop, avoiding the next router", "R3–R4–R7"],
            ["Protected LSP", "an LSP that requested protection", "tunnel-te1 (node protection)"],
          ]}
        />
      </GuideSection>

      <GuideSection id="fd-network" eyebrow="Foundation" title="The network you will study" tone="cyan">
        <DiagramFrame caption="The Fast Reroute Lab. Every output on this page comes from it.">
          <LabNet />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="fd-styles" eyebrow="Backup methods" title="One-to-one vs facility" tone="violet">
        <DiagramFrame caption="Detours per LSP, or one bypass for all.">
          <StylesDiagram />
        </DiagramFrame>
        <CompareCards
          items={[
            { title: "One-to-one (detour)", tone: "warning", tag: "per LSP", points: ["a separate detour LSP per protected LSP and hop", "no label stacking", "state grows with the number of LSPs"] },
            { title: "Facility (bypass)", tone: "success", tag: "shared", points: ["one bypass per protected link / router", "label stacking at the PLR", "the method this lab — and most networks — use"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="fd-scale" eyebrow="Backup methods" title="One bypass, many LSPs" tone="violet">
        <DiagramFrame caption="Same outer label, each LSP's own inner label.">
          <ScaleDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="fd-auto" eyebrow="Backup methods" title="Automatic and manual bypasses" tone="cyan">
        <CompareCards
          items={[
            { title: "Automatic", tone: "success", tag: "per interface", points: ["IOS XR: auto-tunnel backup (nhop-only for link protection only)", "Junos: rsvp interface link-protection (no-node-protection)", "NHOP and NNHOP bypasses built as LSPs need them"] },
            { title: "Manual", tone: "violet", tag: "per bypass", points: ["IOS XR: a tunnel-te with an explicit path + backup-path on the interface", "Junos: link-protection bypass NAME to … path …", "full control of the bypass path"] },
          ]}
        />
        <CliPair cisco={frCli(FR_HEALTHY, "R3", "cisco", "show mpls traffic-eng tunnels backup")} junos={frCli(FR_HEALTHY_JN, "R3", "juniper", "show mpls lsp bypass")} ciscoCaption="IOS XR · R3 — tunnel-te1000 (NHOP) and tunnel-te1001 (NNHOP)" junosCaption="Junos · R3 — Bypass->192.0.2.3 and Bypass->192.0.2.3->192.0.2.5" />
      </GuideSection>

      <GuideSection id="fd-binding" eyebrow="Backup methods" title="Which bypass an LSP gets" tone="warning">
        <p>The PLR binds each protected LSP to a bypass that is up: an NNHOP bypass merging at the LSP&apos;s next-next hop when node protection is desired, otherwise the NHOP bypass. An LSP that asks for link protection only uses NHOP bypasses. The penultimate hop can only offer NHOP protection.</p>
        <CliPanel run={frCli(FR_HEALTHY, "R5", "cisco", "show mpls traffic-eng fast-reroute database")} caption="IOS XR · R5 — the penultimate hop's PLR: NHOP only (tt1000 to R7)" />
      </GuideSection>

      <GuideSection id="fd-labels" eyebrow="Labels and signaling" title="How the PLR learns labels" tone="mpls">
        <DiagramFrame caption="Label recording in the RRO tells the PLR what the merge point expects.">
          <LabelLearnDiagram />
        </DiagramFrame>
        <p>For an NHOP repair the PLR needs the label it already uses toward the next hop. For an NNHOP repair it needs the label the next-next hop gave to the next hop — something it never received directly. The headend therefore asks for label recording; every hop adds its label to the RESV&apos;s Record Route Object.</p>
        <CliPanel run={frOnly(FR_HEALTHY, "R1", "cisco", "show mpls traffic-eng tunnels 1", /Record Route|IPv4|Label/)} caption="IOS XR · R1 — the RRO with node IDs, labels and protection flags" />
      </GuideSection>

      <GuideSection id="fd-signal" eyebrow="Labels and signaling" title="Signaling during repair" tone="mpls">
        <DiagramFrame caption="The PLR keeps the LSP alive through the bypass and tells the headend.">
          <RepairSignalDiagram />
        </DiagramFrame>
        <p>During the repair the PLR sends PATH refreshes to the merge point through the bypass (so the downstream state doesn&apos;t time out) and a PathErr &quot;tunnel locally repaired&quot; to the headend.</p>
      </GuideSection>

      <GuideSection id="fd-reopt" eyebrow="Labels and signaling" title="After the repair" tone="success">
        <p>The headend re-optimizes onto a path that avoids the failure, make-before-break, then tears down the old LSP; the bypass carries traffic only for those seconds. When the failure is repaired, the LSP stays on its valid new path until a re-optimization — manual (<Mono>mpls traffic-eng reoptimize</Mono>, <Mono>clear mpls lsp optimize</Mono>) or periodic.</p>
      </GuideSection>

      <GuideSection id="fd-detect" eyebrow="Detection" title="Failure detection" tone="danger">
        <DiagramFrame caption="From fastest to slowest.">
          <DetectDiagram />
        </DiagramFrame>
        <FieldTable
          title="Detection in the lab"
          accent="danger"
          columns={["Failure", "PLR sees", "Time"]}
          rows={[
            ["fiber cut (R5–R7)", "loss of light", "10 ms"],
            ["DWDM span (R3–R5) with BFD", "BFD 3 × 15 ms", "45 ms"],
            ["DWDM span (R3–R5) without BFD", "IS-IS hold time", "30 s"],
            ["router power loss", "its neighbors lose light (BFD across R3–R5)", "10 / 45 ms"],
          ]}
        />
      </GuideSection>

      <GuideSection id="fd-bfd" eyebrow="Detection" title="BFD on silent links" tone="warning">
        <p>BFD sends tiny hellos (here every 15 ms, 3 missed = down) and tells RSVP and the IGP the instant the path stops working. It matters wherever a failure leaves the interface up: transport systems, media converters, some carrier circuits.</p>
        <CliPair cisco={{ prompt: "RP/0/RP0/CPU0:R3(config)#", command: "rsvp", output: "RP/0/RP0/CPU0:R3(config-rsvp)#interface GigabitEthernet0/0/0/1\nRP/0/RP0/CPU0:R3(config-rsvp-if)#bfd fast-detect\nRP/0/RP0/CPU0:R3(config-rsvp-if)#bfd minimum-interval 15\nRP/0/RP0/CPU0:R3(config-rsvp-if)#bfd multiplier 3\nRP/0/RP0/CPU0:R3(config-rsvp-if)#commit" }} junos={{ prompt: "admin@R3# ", command: "set protocols rsvp interface ge-0/0/1.0 bfd-liveness-detection minimum-interval 15", output: "\n[edit]\nadmin@R3# commit\ncommit complete" }} ciscoCaption="IOS XR · R3" junosCaption="Junos · R3" />
      </GuideSection>

      <GuideSection id="fd-srlg" eyebrow="Design" title="SRLG-diverse bypasses" tone="danger">
        <DiagramFrame caption="A bypass in the same conduit fails together with the link.">
          <SrlgDiagram />
        </DiagramFrame>
        <p>A bypass only helps if it doesn&apos;t share fate with what it protects. Shared Risk Link Groups mark links that share a conduit, a duct or a transport system, and bypass CSPF can avoid them.</p>
      </GuideSection>

      <GuideSection id="fd-bw" eyebrow="Design" title="Bandwidth protection" tone="warning">
        <p>Facility bypasses usually reserve no bandwidth: they carry the traffic for seconds, until the headend re-optimizes. If the detour links are busy, the repaired traffic may be squeezed during that window. Bandwidth protection (requested by the LSP, provided by bypasses with reserved bandwidth) trades capacity for certainty.</p>
      </GuideSection>

      <GuideSection id="fd-limits" eyebrow="Design" title="What can't be protected" tone="cyan">
        <p>A PLR needs a second way out that avoids the failure. In the lab R1 and R6 are single-homed, so R1–R3 and R7–R6 have no protection; R7 is the penultimate hop, so a failure of R7 itself can&apos;t be bypassed (there is no next-next hop to merge at). The cure is topology, not configuration.</p>
        <DrillResult s={frApply(FR_HEALTHY, { type: "drill", what: "node:R7" })} title="The lab: R7 fails" />
      </GuideSection>

      <GuideSection id="fd-config" eyebrow="Operations" title="Configuring it: IOS XR and Junos" tone="cyan">
        <CliPair cisco={frOnly(FR_HEALTHY, "R1", "cisco", "show running-config", /tunnel-te1|destination|fast-reroute|signalled|path-option/)} junos={frCli(FR_HEALTHY_JN, "R1", "juniper", "show configuration protocols mpls")} ciscoCaption="IOS XR · R1 — the protected LSP" junosCaption="Junos · R1 — node-link-protection on the LSP" />
        <CliPair cisco={frOnly(FR_HEALTHY, "R3", "cisco", "show running-config", /^mpls|^rsvp|interface Gi|auto-tunnel|bfd|tunnel-id/)} junos={frCli(FR_HEALTHY_JN, "R3", "juniper", "show configuration protocols rsvp")} ciscoCaption="IOS XR · R3 — automatic bypasses and BFD" junosCaption="Junos · R3 — link-protection and BFD" />
      </GuideSection>

      <GuideSection id="fd-verify" eyebrow="Operations" title="How to verify" tone="cyan">
        <FieldTable
          title="Questions and commands"
          accent="cyan"
          columns={["Question", "IOS XR", "Junos"]}
          rows={[
            ["Does the LSP ask for protection?", <Mono key="1">show mpls traffic-eng tunnels 1</Mono>, <Mono key="2">show mpls lsp extensive</Mono>],
            ["What is bound at this PLR?", <Mono key="3">show mpls traffic-eng fast-reroute database</Mono>, <Mono key="4">show rsvp session detail</Mono>],
            ["Are the bypasses up?", <Mono key="5">show mpls traffic-eng tunnels backup</Mono>, <Mono key="6">show mpls lsp bypass</Mono>],
            ["Is detection fast?", <Mono key="7">show bfd session</Mono>, <Mono key="8">show bfd session</Mono>],
            ["Back on the best path?", <Mono key="9">mpls traffic-eng reoptimize</Mono>, <Mono key="10">clear mpls lsp optimize</Mono>],
          ]}
        />
        <Callout tone="warning" title="Ready is a claim, a drill is proof" icon="!">
          Show commands say a bypass exists. Only a failure — a drill in the lab, a maintenance window in production — proves the PLR detects in time and the bypass avoids the failure.
        </Callout>
      </GuideSection>

      <GuideSection id="fd-signatures" eyebrow="Troubleshooting" title="Failure signatures" tone="danger">
        <FailureSignatures
          items={[
            { tag: "NODE", title: "Link protection only", tone: "danger", points: ["link failures repaired, router failures not", "PLR bound to an NHOP bypass"] },
            { tag: "REQ", title: "No protection requested", tone: "danger", points: ["automatic bypasses never built", "Fast Reroute: Disabled"] },
            { tag: "BYP", title: "Bypass down", tone: "warning", points: ["PCALC error on the bypass", "LSP falls back to NHOP or nothing"] },
            { tag: "PLR", title: "No bypass at this PLR", tone: "violet", points: ["that hop unprotected", "check the PLR for the failed link, not the headend"] },
            { tag: "BFD", title: "Slow detection", tone: "warning", points: ["bypass ready, repair after 30 s", "silent link without BFD"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="fd-workflow" eyebrow="Troubleshooting" title="Investigation workflow" tone="danger">
        <TroubleshootingFlow
          steps={[
            { question: "What exactly failed, and what did it cost?", look: "The drill (or the outage) — which link or router, how long." },
            { question: "Does the LSP request protection, and which kind?", look: "The headend's tunnel / LSP detail." },
            { question: "Which router is the PLR for this failure?", look: "The router before it on the LSP's path." },
            { question: "What is bound there, and does it avoid the failure?", look: "The PLR's FRR database / RSVP session detail." },
            { question: "Is the bypass up?", look: "Backup tunnels / bypass LSPs and their PCALC errors." },
            { question: "How fast does the PLR detect it?", look: "Loss of light or BFD — not the IGP." },
          ]}
        />
      </GuideSection>

      <GuideSection id="fd-tickets" eyebrow="Troubleshooting" title="Five faults, evidence to proof" tone="danger">
        <p>The Fast Reroute Lab&apos;s five tickets. The drill results are from the lab with the fault in place; the CLI is from the same network once the failure is repaired and re-optimized (IOS XR view).</p>
        <FailureWalk
          title="1 · FRR was ready — R5 died anyway"
          normal="R3 builds NHOP and NNHOP bypasses; tunnel-te1 is bound to the NNHOP one."
          change="R3's interface toward R5 was set to nhop-only."
          evidence={<DrillResult s={T.node} title="Drill: R5 fails" />}
          next="R3's FRR database: tunnel-te1 bound to the NHOP bypass, which ends at R5."
          fix={<Mono>R3: mpls traffic-eng → interface Gi0/0/0/1 → no auto-tunnel backup nhop-only → commit</Mono>}
          proof="R3 binds tunnel-te1 to the NNHOP bypass to R7; the drill is repaired locally (~55 ms)."
        />
        <FailureWalk
          title="2 · Protection configured, nothing protected"
          normal="tunnel-te1 requests node protection."
          change="tunnel-te1 rebuilt from a template without fast-reroute."
          evidence={<CliPanel run={frOnly(S.nofrr, "R1", "cisco", "show mpls traffic-eng tunnels 1", /Name:|Fast Reroute|Session Attributes/)} caption="IOS XR · R1" />}
          next="The PLRs build no bypasses for it (nothing requests them): every failure waits for the headend."
          fix={<Mono>interface tunnel-te1 → fast-reroute → fast-reroute protect node → commit</Mono>}
          proof="R3 and R5 bind tunnel-te1 again; a drill of R5–R7 is repaired locally (~20 ms)."
        />
        <FailureWalk
          title="3 · Node protection quietly gone"
          normal="R3's NNHOP bypass runs R3–R4–R7."
          change="R4's interface toward R7 was moved to a new card and left out of MPLS-TE."
          evidence={<CliPanel run={frOnly(S.bypassdown, "R3", "cisco", "show mpls traffic-eng tunnels backup", /tunnel-te|Oper|Dest|PCALC|Path/)} caption="IOS XR · R3 — tunnel-te1001 down" />}
          next="Without R4–R7 in the TED there is also no path for R1 around R5: the LSP is down until R5 returns."
          fix={<Mono>R4: mpls traffic-eng → interface Gi0/0/0/2 → commit</Mono>}
          proof="The NNHOP bypass is up and bound; a drill of R5 failing is repaired locally."
        />
        <FailureWalk
          title="4 · One cut repaired in milliseconds, the next one not"
          normal="R5 protects tunnel-te1 toward R7 with an NHOP bypass."
          change="R5's interface toward R7 lost its auto-tunnel backup."
          evidence={<CliPanel run={frCli(S.plr, "R5", "cisco", "show mpls traffic-eng fast-reroute database")} caption="IOS XR · R5 — no binding toward R7" />}
          next="R3 is not involved: the PLR for R5–R7 is R5."
          fix={<Mono>R5: mpls traffic-eng → interface Gi0/0/0/1 → auto-tunnel backup → commit</Mono>}
          proof="R5 binds tunnel-te1 to its NHOP bypass; a drill of R5–R7 is repaired locally."
        />
        <FailureWalk
          title="5 · Thirty seconds of frozen video"
          normal="BFD on both ends of the DWDM span."
          change="R3's swapped line card lost its RSVP BFD configuration."
          evidence={<CliPanel run={frCli(S.bfd, "R3", "cisco", "show bfd session")} caption="IOS XR · R3 — no BFD session toward R5" />}
          next="The bypass is up and bound; the drill shows detection by IS-IS hold time: 30 s."
          fix={<Mono>R3: rsvp → interface Gi0/0/0/1 → bfd fast-detect → commit</Mono>}
          proof="BFD up on R3–R5; a drill of the span is repaired locally in ~55 ms."
        />
      </GuideSection>

      <GuideSection id="fd-alt" eyebrow="Beyond this lesson" title="FRR vs LFA / TI-LFA" tone="violet">
        <CompareCards
          items={[
            { title: "RSVP-TE FRR", tone: "cyan", tag: "this lesson", points: ["bypasses are signaled RSVP LSPs", "protects TE LSPs", "state at the PLRs and along the bypasses"] },
            { title: "TI-LFA (Segment Routing)", tone: "violet", tag: "later in this path", points: ["the backup path is computed by the IGP", "encoded as a segment list — no signaling", "covers all traffic, topology-independent"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="fd-myths" eyebrow="Master it" title="Common misconceptions" tone="warning">
        <Misconceptions
          items={[
            { myth: "“FRR ready” means every failure is covered.", correction: "It means a bypass exists for some failure. Node failures need NNHOP bypasses; detection needs to be fast." },
            { myth: "The headend repairs failures quickly.", correction: "The headend repairs them properly — in seconds. The PLR repairs them quickly." },
            { myth: "The bypass carries traffic until the failure is fixed.", correction: "Only until the headend re-optimizes, usually seconds." },
            { myth: "A link-protecting bypass protects the next router.", correction: "It ends at that router. Only an NNHOP bypass skips it." },
            { myth: "BFD is optional when fast reroute is configured.", correction: "On silent failures, FRR without BFD waits for the IGP." },
            { myth: "Every link can be protected.", correction: "A single-homed router has no way around." },
          ]}
        />
      </GuideSection>

      <GuideSection id="fd-quiz" eyebrow="Master it" title="Knowledge check" tone="cyan">
        <KnowledgeQuiz questions={QUIZ} />
      </GuideSection>

      <GuideSection id="fd-explain" eyebrow="Master it" title="Can you explain it?" tone="violet">
        <ExplainIt
          items={[
            { q: "Why is local repair faster than headend recovery?", a: "The PLR sees the failure first and switches to a pre-signaled bypass; the headend must learn about it, recompute and signal." },
            { q: "Why does the merge point see nothing unusual during a repair?", a: "The PLR swaps to exactly the label the merge point expects and pushes the bypass label on top; the last bypass hop pops it." },
            { q: "Why did the R5 failure freeze the video although FRR was ready?", a: "R3 only had an NHOP bypass, which ends at R5. Without an NNHOP bypass to R7, R3 couldn't repair and R1 had to re-signal." },
            { q: "Why does BFD matter on the R3–R5 span but not on R5–R7?", a: "R3–R5 crosses a DWDM system: a failure keeps the light on, so only BFD detects it fast. A fiber cut on R5–R7 is seen as loss of light." },
            { q: "Why can't R7–R6 be protected?", a: "R6 has only one link; there is no path from R7 to R6 that avoids it." },
          ]}
        />
      </GuideSection>

      <GuideSection id="fd-practice" eyebrow="Master it" title="Practice in the Fast Reroute Lab" tone="success">
        <p>Six Learn levels take you from &quot;why local repair&quot; to reading the evidence; the engineering workspace gives you all six routers (IOS XR or Junos), traffic, failure drills, re-optimization, five challenges and the five tickets above.</p>
        <LabBridge />
        <PresentationBridge>Rewatch the fast reroute presentation.</PresentationBridge>
      </GuideSection>
    </div>
  );
}
