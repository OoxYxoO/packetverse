import { Callout, ChecklistCard, CompareCards, DIAGRAM as D, DLink, DNode, DPill, DiagramFrame, DiagramSvg, FailureSignatures, FieldTable, FlowSteps, Glossary, GuideSection, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { DStack } from "@/components/lesson/MplsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { PracticeBridge } from "@/components/lesson/GuideInteractive";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import { PresentationBridge } from "@/components/presentation/LessonPresentation";
import { CliPair, CliPanel, pickLines, runGuideCli } from "@/components/lesson/GuideCli";
import type { CliVendor } from "@/lib/cli/types";
import { createFrNet, frApply, frTicket, frTicketState, type FrDrillResult, type FrOs, type FrR, type FrState } from "@/lib/sim-engine/scenarios/frrNet";
import { frSets, frStaticApi } from "./frr-lab/frCli";

export const FRR_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "fl-mission", label: "What this lesson teaches" },
  { id: "fl-network", label: "The network of this lesson" },
  { id: "fl-ideas", label: "Three ideas you need" },
  { id: "fl-watch", label: "What you will watch" },
  { id: "fl-noprot", label: "Without protection" },
  { id: "fl-roles", label: "PLR, merge point, bypass" },
  { id: "fl-ready", label: "Protection ready" },
  { id: "fl-repair", label: "Local repair" },
  { id: "fl-stack", label: "The repair stack" },
  { id: "fl-reopt", label: "Re-optimization" },
  { id: "fl-node", label: "Link vs node protection" },
  { id: "fl-nodestack", label: "The node-repair stack" },
  { id: "fl-detect", label: "Detection decides" },
  { id: "fl-working", label: "What working looks like" },
  { id: "fl-incident", label: "The incident" },
  { id: "fl-investigate", label: "Walk the evidence" },
  { id: "fl-fix", label: "Repair and prove it" },
  { id: "fl-other", label: "Other ways protection fails" },
  { id: "fl-model", label: "Mental model" },
  { id: "fl-glossary", label: "Glossary" },
  { id: "fl-recap", label: "Recap" },
  { id: "fl-practice", label: "Practice it" },
];

/**
 * Every CLI sample and drill result on this page comes from the Fast Reroute Lab's model and its IOS XR / Junos command
 * sets: the healthy network, a protected R3–R5 failure, and the lab's "node" ticket — the guided lesson's incident (R3
 * builds only link-protecting bypasses; R5 fails).
 */
export const FR_HEALTHY: FrState = createFrNet(0);
export const FR_HEALTHY_JN: FrState = createFrNet(0, "junos");
const noFrr = frApply(FR_HEALTHY, { type: "set", text: "tunnel-te1 without fast reroute", changes: [{ dev: "R1", f: (c) => void (c.tunnels[0].frr = "off") }] });
export const FR_NOPROT = frApply(noFrr, { type: "drill", what: "link:R3-R5" });
export const FR_LINKDRILL = frApply(FR_HEALTHY, { type: "drill", what: "link:R3-R5" });
const fault = (os: FrOs) => frTicket("node").repro.reduce((acc, a) => frApply(acc, a), frTicketState("node", 0, os));
const FR_FAULT = fault("xr");
const FR_FAULT_JN = fault("junos");
const FR_FAULT_RESTORED = frApply(frApply(FR_FAULT, { type: "restore" }), { type: "reopt" });
const FR_FIXED = frApply(frApply(FR_FAULT, { type: "set", text: "R3: NHOP and NNHOP bypasses", changes: [{ dev: "R3", f: (c) => void (c.ifs["ge-0/0/1"].nhopOnly = false) }] }), { type: "drill", what: "node:R5" });
export function frCli(s: FrState, r: FrR, vendor: CliVendor, command: string) {
  return runGuideCli(frSets(frStaticApi(s, r), r)[vendor], command);
}
export function frOnly(s: FrState, r: FrR, vendor: CliVendor, command: string, match: RegExp, keep = 0) {
  const x = frCli(s, r, vendor, command);
  return { ...x, output: pickLines(x.output, match, keep) };
}
const mainRes = (s: FrState): FrDrillResult => s.drills[s.drills.length - 1].results.find((x) => x.lsp === "R1:1")!;
const lost = (ms: number) => (ms === Infinity ? "until the failure is repaired" : ms >= 1000 ? `${(ms / 1000).toFixed(ms >= 10000 ? 0 : 1)} s` : `${ms} ms`);
/** One drill result, as the lab reports it. */
export function DrillResult({ s, title }: { s: FrState; title: string }) {
  const r = mainRes(s);
  return (
    <Callout tone={r.how === "local" && r.lossMs < 1000 ? "success" : "danger"} title={title} icon={r.how === "local" && r.lossMs < 1000 ? "✓" : "!"}>
      {r.how === "local" ? (r.lossMs < 1000 ? "Repaired locally" : "Repaired locally, but late") : r.how === "none" ? "Not repaired" : "Re-signaled by the headend"} — PLR {r.plr}, detection {r.detect === "light" ? "loss of light (10 ms)" : r.detect === "bfd" ? "BFD (45 ms)" : "IS-IS hold time (30 s)"}: {r.why}. Traffic lost: about {lost(r.lossMs)}.
    </Callout>
  );
}

function LessonLabBridge() {
  const openLab = usePracticeLabOpener();
  return (
    <PracticeBridge label="Open the Fast Reroute Lab" onPractice={openLab}>
      The same six routers with bypasses at every PLR, failure drills, IOS XR or Junos, your own copy. Nothing you do there changes your lesson progress.
    </PracticeBridge>
  );
}

const P: Record<string, [number, number]> = { R1: [60, 60], R3: [190, 60], R5: [330, 60], R7: [470, 60], R6: [590, 60], R4: [330, 165] };

function Net({ failedLink, failedNode, bypass, primaryColor = D.success }: { failedLink?: boolean; failedNode?: boolean; bypass?: "link" | "node"; primaryColor?: string }) {
  const prim: [string, string][] = [
    ["R1", "R3"],
    ["R3", "R5"],
    ["R5", "R7"],
    ["R7", "R6"],
  ];
  const side: [string, string][] = [
    ["R3", "R4"],
    ["R4", "R5"],
    ["R4", "R7"],
  ];
  const onBypass = (a: string, b: string) => (bypass === "link" ? (a === "R3" && b === "R4") || (a === "R4" && b === "R5") : bypass === "node" ? (a === "R3" && b === "R4") || (a === "R4" && b === "R7") : false);
  return (
    <>
      {prim.map(([a, b]) => {
        const down = (failedLink && a === "R3" && b === "R5") || (failedNode && (a === "R5" || b === "R5"));
        return <DLink key={a + b} x1={P[a][0]} y1={P[a][1]} x2={P[b][0]} y2={P[b][1]} color={down ? D.danger : primaryColor} dashed={down} />;
      })}
      {side.map(([a, b]) => (
        <DLink key={a + b} x1={P[a][0]} y1={P[a][1]} x2={P[b][0]} y2={P[b][1]} color={onBypass(a, b) ? D.warning : D.line} dashed={failedNode && (a === "R5" || b === "R5")} />
      ))}
      {failedLink && (
        <text x={260} y={52} textAnchor="middle" fill={D.danger} fontSize={18} fontWeight={700}>
          ✕
        </text>
      )}
      {Object.entries(P).map(([id, [x, y]]) => (
        <DNode key={id} x={x} y={y} label={id} sub={id === "R1" ? "headend" : id === "R6" ? "tailend" : undefined} accent={failedNode && id === "R5" ? D.danger : D.mpls} w={id === "R1" || id === "R6" ? 84 : 60} h={id === "R1" || id === "R6" ? 42 : 34} />
      ))}
    </>
  );
}

function TopologyDiagram() {
  return (
    <DiagramSvg h={210} label="Primary LSP R1-R3-R5-R7-R6 with labels 400, 300, 200; R4 sits below with links to R3, R5 and R7">
      <Net />
      <text x={125} y={36} textAnchor="middle" fill={D.success} fontSize={10} fontWeight={700}>
        400
      </text>
      <text x={260} y={36} textAnchor="middle" fill={D.success} fontSize={10} fontWeight={700}>
        300
      </text>
      <text x={400} y={36} textAnchor="middle" fill={D.success} fontSize={10} fontWeight={700}>
        200
      </text>
      <text x={530} y={36} textAnchor="middle" fill={D.success} fontSize={10} fontWeight={700}>
        IP (PHP)
      </text>
      <text x={320} y={204} textAnchor="middle" fill={D.muted} fontSize={10}>
        green = RSVP-PRIMARY, 500 Mbps · numbers = label on each primary link
      </text>
    </DiagramSvg>
  );
}

function RolesDiagram() {
  return (
    <DiagramSvg h={210} label="R3 is the PLR, R3-R5 the protected link, R5 the Merge Point, R3-R4-R5 the bypass">
      <Net failedLink bypass="link" />
      <DPill x={190} y={112} text="PLR" color={D.warning} w={56} />
      <DPill x={400} y={112} text="Merge Point" color={D.violet} w={96} />
      <DPill x={200} y={186} text="bypass R3 → R4 → R5" color={D.warning} w={150} />
      <text x={260} y={30} textAnchor="middle" fill={D.danger} fontSize={10} fontWeight={700}>
        protected link
      </text>
    </DiagramSvg>
  );
}

function RepairStackDiagram() {
  const cols: [number, string, { text: string; tag?: string; color?: string }[]][] = [
    [90, "R1 → R3", [{ text: "400 S1" }]],
    [220, "R3 → R4 (repair)", [{ text: "1000 S0", tag: "OUTER", color: D.warning }, { text: "300 S1", tag: "INNER" }]],
    [360, "R4 → R5", [{ text: "300 S1", tag: "INNER" }]],
    [480, "R5 → R7", [{ text: "200 S1" }]],
    [590, "R7 → R6", []],
  ];
  return (
    <DiagramSvg h={170} label="R1 to R3: 400 S1. R3 to R4: bypass 1000 S0 over protected 300 S1. R4 to R5: 300 S1. R5 to R7: 200 S1. R7 to R6: plain IP">
      {cols.map(([x, t, labels]) => (
        <g key={t}>
          <text x={x} y={20} textAnchor="middle" fill={t.includes("repair") ? D.warning : D.muted} fontSize={9.5} fontWeight={700}>
            {t}
          </text>
          <DStack x={x} y={32} labels={labels} w={78} />
        </g>
      ))}
      <text x={320} y={150} textAnchor="middle" fill={D.muted} fontSize={10}>
        Outer = bypass label (R4 pops it, PHP) · Inner = the label R5 already expects · only the bottom has S=1
      </text>
    </DiagramSvg>
  );
}

function NodeDiagram() {
  return (
    <DiagramSvg h={210} label="R5 fails entirely; the node-protecting bypass R3-R4-R7 skips it and merges at R7">
      <Net failedNode bypass="node" />
      <DPill x={190} y={112} text="PLR" color={D.warning} w={56} />
      <DPill x={540} y={112} text="Merge Point" color={D.violet} w={96} />
      <DPill x={200} y={186} text="bypass R3 → R4 → R7" color={D.warning} w={150} />
      <text x={330} y={30} textAnchor="middle" fill={D.danger} fontSize={10} fontWeight={700}>
        protected node
      </text>
    </DiagramSvg>
  );
}

function NodeStackDiagram() {
  const cols: [number, string, { text: string; tag?: string; color?: string }[]][] = [
    [110, "R1 → R3", [{ text: "400 S1" }]],
    [260, "R3 → R4 (repair)", [{ text: "1020 S0", tag: "OUTER", color: D.warning }, { text: "200 S1", tag: "INNER" }]],
    [410, "R4 → R7", [{ text: "200 S1", tag: "INNER" }]],
    [550, "R7 → R6", []],
  ];
  return (
    <DiagramSvg h={170} label="Node repair: bypass 1020 S0 over 200 S1, the label R7 expects; R4 pops the outer; R7 pops for PHP">
      {cols.map(([x, t, labels]) => (
        <g key={t}>
          <text x={x} y={20} textAnchor="middle" fill={t.includes("repair") ? D.warning : D.muted} fontSize={9.5} fontWeight={700}>
            {t}
          </text>
          <DStack x={x} y={32} labels={labels} w={78} />
        </g>
      ))}
      <text x={320} y={150} textAnchor="middle" fill={D.muted} fontSize={10}>
        the inner label skips R5&apos;s swap: it&apos;s the label R7 (the new Merge Point) expects
      </text>
    </DiagramSvg>
  );
}

function TimelineDiagram() {
  const ev: [number, string, string][] = [
    [80, "failure", D.danger],
    [220, "PLR detects", D.warning],
    [360, "local repair", D.warning],
    [500, "headend reoptimizes", D.violet],
  ];
  return (
    <DiagramSvg h={120} label="Failure, detection at the PLR, local repair, then later headend reoptimization">
      <line x1={40} y1={50} x2={600} y2={50} stroke={D.line} strokeWidth={2} />
      {ev.map(([x, t, c]) => (
        <g key={t}>
          <circle cx={x} cy={50} r={7} fill={c} />
          <text x={x} y={80} textAnchor="middle" fill={c} fontSize={10.5} fontWeight={700}>
            {t}
          </text>
        </g>
      ))}
      <text x={290} y={30} textAnchor="middle" fill={D.warning} fontSize={10}>
        local, no signaling needed
      </text>
      <text x={500} y={104} textAnchor="middle" fill={D.muted} fontSize={10}>
        later: new end-to-end LSP
      </text>
    </DiagramSvg>
  );
}

export function FrrLessonGuideContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="fl-mission" eyebrow="This lesson" title="What this lesson teaches" tone="mpls">
        <p>
          tunnel-te1 carries a video stream from R1 to R6 over R3, R5 and R7. When something on that path fails, the headend can build a new LSP — but that takes about one and a half seconds, and the picture freezes. This lesson shows how <b className="text-pv-text">RSVP-TE Fast Reroute</b> lets the router next to the failure repair it in milliseconds, using a bypass it prepared in advance.
        </p>
        <p>You will watch R3 detect a failure and switch to its bypass, the label trick that makes the merge point see nothing unusual, and the headend re-optimizing calmly afterwards. Then R5 loses power while &quot;FRR was ready&quot; — and the video freezes anyway. You find out why, fix it and prove it with a drill.</p>
        <ChecklistCard
          tone="violet"
          title="By the end of this lesson you can"
          mark="→"
          items={["explain why waiting for the headend is too slow", "name the PLR, the merge point and the bypass for a given failure", "tell NHOP (link) protection from NNHOP (node) protection", "follow the label stack during a local repair", "explain why detection time decides everything", "prove protection with a failure drill — and fix it when it fails"]}
        />
      </GuideSection>

      <GuideSection id="fl-network" eyebrow="This lesson" title="The network of this lesson" tone="cyan">
        <DiagramFrame caption="The primary LSP runs along the top; R4 below offers the way around.">
          <TopologyDiagram />
        </DiagramFrame>
        <FieldTable
          title="Who is who"
          accent="mpls"
          columns={["Router", "TE router ID", "Role"]}
          rows={[
            ["R1", <Mono key="1">1.1.1.1</Mono>, "headend of tunnel-te1 (500 Mbps, node protection requested)"],
            ["R3, R5", <Mono key="2">3.3.3.3, 5.5.5.5</Mono>, "midpoints — and the points of local repair for what follows them"],
            ["R7", <Mono key="3">7.7.7.7</Mono>, "penultimate hop; merge point for R3's node-protecting bypass"],
            ["R4", <Mono key="4">4.4.4.4</Mono>, "carries the bypasses"],
            ["R6", <Mono key="5">6.6.6.6</Mono>, "tail"],
          ]}
        />
        <p className="text-sm text-pv-text-muted">R3–R5 crosses a DWDM system: when it fails, both routers keep their light, so they need BFD to notice quickly. The Fast Reroute Lab uses exactly this network; every output on this page comes from it.</p>
      </GuideSection>

      <GuideSection id="fl-ideas" eyebrow="This lesson" title="Three ideas you need" tone="violet">
        <CompareCards
          items={[
            { title: "Prepare", tone: "cyan", tag: "before", points: ["bypasses are signaled before anything fails", "the LSP asks for protection"] },
            { title: "Repair locally", tone: "violet", tag: "during", points: ["the router next to the failure switches", "in milliseconds, without the headend"] },
            { title: "Clean up", tone: "success", tag: "after", points: ["the headend re-optimizes", "the bypass is free again"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="fl-watch" eyebrow="This lesson" title="What you will watch" tone="cyan">
        <FlowSteps
          steps={[
            { title: "No protection", body: "R3–R5 fails: ~1.5 s of loss.", tone: "danger" },
            { title: "Bypasses", body: "R3 and R5 prepare their detours.", tone: "mpls" },
            { title: "Local repair", body: "R3 switches in ~55 ms.", tone: "success" },
            { title: "Node protection", body: "Why NHOP can't save you from R5.", tone: "violet" },
            { title: "The incident", body: "FRR ready, R5 dies, video freezes.", tone: "danger" },
            { title: "Repair", body: "Allow NNHOP bypasses, prove it with a drill.", tone: "success" },
          ]}
        />
      </GuideSection>

      <GuideSection id="fl-noprot" eyebrow="Why FRR" title="Without protection" tone="warning">
        <DiagramFrame caption="Failure, detection, then the slow part: the headend.">
          <TimelineDiagram />
        </DiagramFrame>
        <p>R3 notices the failure first, but without a prepared detour it can only report it. R1 learns about it (PathErr, IS-IS), runs CSPF again and signals a new LSP over R4.</p>
        <DrillResult s={FR_NOPROT} title="The lab: R3–R5 fails, tunnel-te1 without fast reroute" />
      </GuideSection>

      <GuideSection id="fl-roles" eyebrow="The idea" title="PLR, merge point, bypass" tone="violet">
        <DiagramFrame caption="The router before the failure repairs; the bypass rejoins the LSP at the merge point.">
          <RolesDiagram />
        </DiagramFrame>
        <p>
          The <b className="text-pv-text">Point of Local Repair</b> (PLR) is the router just before the protected link or router — here R3. Its <b className="text-pv-text">bypass</b> is a small RSVP-TE LSP of its own, signaled in advance, that goes around the failure and ends at the <b className="text-pv-text">merge point</b> (MP). One bypass protects every LSP that leaves R3 that way: <b className="text-pv-text">facility backup</b>.
        </p>
      </GuideSection>

      <GuideSection id="fl-ready" eyebrow="Before a failure" title="Protection ready" tone="mpls">
        <p>R1 asks for protection in the LSP&apos;s PATH (local protection desired, node protection desired). Each router that can protect it builds bypasses and reports &quot;local protection available&quot; in the Record Route.</p>
        <CliPanel run={frOnly(FR_HEALTHY, "R1", "cisco", "show mpls traffic-eng tunnels 1", /Name:|Fast Reroute|Session Attributes|Record Route|IPv4/)} caption="IOS XR · R1 — node protection desired; R3 reports node protection available (0x29), R5 link protection (0x21)" />
        <CliPair cisco={frCli(FR_HEALTHY, "R3", "cisco", "show mpls traffic-eng fast-reroute database")} junos={frCli(FR_HEALTHY_JN, "R3", "juniper", "show rsvp session detail")} ciscoCaption="IOS XR · R3 — tunnel-te1 bound to tunnel-te1001, Ready" junosCaption="Junos · R3 — the same binding, with the merge-point label" />
      </GuideSection>

      <GuideSection id="fl-repair" eyebrow="A link fails" title="Local repair" tone="success">
        <p>R3–R5 fails. R3 detects it (BFD: 45 ms), switches tunnel-te1 onto its bypass (~10 ms) and tells R1 the LSP was locally repaired. The video barely notices.</p>
        <DrillResult s={FR_LINKDRILL} title="The lab: R3–R5 fails, tunnel-te1 protected" />
        <Callout tone="cyan" title="Which bypass?" icon="i">
          The guided lesson first repairs this failure with the link-protecting bypass R3–R4–R5. In the lab, tunnel-te1 asks for node protection, so R3 binds its node-protecting bypass R3–R4–R7 — a path around R5 also avoids the R3–R5 link, so it covers both.
        </Callout>
      </GuideSection>

      <GuideSection id="fl-stack" eyebrow="A link fails" title="The repair stack" tone="violet">
        <DiagramFrame caption="Two labels between the PLR and the merge point: the bypass label on top of the label the merge point expects.">
          <RepairStackDiagram />
        </DiagramFrame>
        <Callout tone="cyan" title="The numbers on this page" icon="i">
          The guided lesson uses short labels: R3 = <b>400</b>, R5 = <b>300</b>, R7 = <b>200</b>, the link bypass at R4 = <b>1000</b>, the node bypass at R4 = <b>1020</b>. The lab allocates like a real IOS XR router: R3 = 24101, R5 = 24301, R7 = 24401, bypass labels at R4 = 24250 and 24251. The rule is the same: the PLR swaps to the label the merge point expects, then pushes the bypass label.
        </Callout>
      </GuideSection>

      <GuideSection id="fl-reopt" eyebrow="A link fails" title="Re-optimization" tone="cyan">
        <p>The bypass is a stopgap. R1 computes a new path that avoids the failure (R1–R3–R4–R7–R6), signals it make-before-break and moves the video onto it; R3&apos;s bypass is free again. When R3–R5 comes back, the LSP stays where it is until re-optimization (<Mono>mpls traffic-eng reoptimize</Mono>, <Mono>clear mpls lsp optimize</Mono> or the periodic timer).</p>
        <CliPanel run={frOnly(FR_LINKDRILL, "R1", "cisco", "show mpls traffic-eng tunnels 1", /Name:|Admin:|Strict/)} caption="IOS XR · R1 — after the repair: re-signaled over R4" />
      </GuideSection>

      <GuideSection id="fl-node" eyebrow="A router fails" title="Link vs node protection" tone="warning">
        <DiagramFrame caption="If R5 itself fails, only a bypass that skips R5 helps.">
          <NodeDiagram />
        </DiagramFrame>
        <CompareCards
          items={[
            { title: "NHOP bypass", tone: "warning", tag: "link", points: ["to the next hop (R5), avoiding the link", "useless when R5 itself fails"] },
            { title: "NNHOP bypass", tone: "success", tag: "node", points: ["to the next-next hop (R7), avoiding R5", "covers R5 and the R3–R5 link"] },
          ]}
        />
        <p className="text-sm text-pv-text-muted">R7 is the penultimate hop: there is no next-next hop to merge at, so R5–R7 and R7 can only get link protection. R1–R3 and R7–R6 have no way around at all.</p>
      </GuideSection>

      <GuideSection id="fl-nodestack" eyebrow="A router fails" title="The node-repair stack" tone="violet">
        <DiagramFrame caption="The inner label is R7's — the PLR learned it from the Record Route.">
          <NodeStackDiagram />
        </DiagramFrame>
        <p>For a node repair R3 needs the label R7 gave to R5 — a router two hops away. It learns it from the labels recorded in the RESV&apos;s Record Route Object, which is why protection requests turn label recording on.</p>
      </GuideSection>

      <GuideSection id="fl-detect" eyebrow="Detection" title="Detection decides" tone="danger">
        <p>Repair starts when the PLR knows. A cut fiber means loss of light in about 10 ms. R3–R5 crosses a DWDM system: when the span inside it fails, both routers keep their light. <b className="text-pv-text">BFD</b> (here 3 × 15 ms) notices; without it, R3 waits for IS-IS to declare R5 dead — 30 seconds, with the bypass ready and unused.</p>
        <CliPair cisco={frCli(FR_HEALTHY, "R3", "cisco", "show bfd session")} junos={frCli(FR_HEALTHY_JN, "R3", "juniper", "show bfd session")} ciscoCaption="IOS XR · R3 — BFD toward R5, 45 ms detection" junosCaption="Junos · R3" />
      </GuideSection>

      <GuideSection id="fl-working" eyebrow="Evidence" title="What working looks like" tone="success">
        <FieldTable
          title="Healthy, in five questions"
          accent="success"
          columns={["Question", "IOS XR", "Healthy answer"]}
          rows={[
            ["Does the LSP ask for protection?", <Mono key="1">show mpls traffic-eng tunnels 1</Mono>, "Fast Reroute: Enabled, Protection Desired: Node"],
            ["What is bound at the PLR?", <Mono key="2">show mpls traffic-eng fast-reroute database</Mono>, "R3: tt1001 (NNHOP), Ready"],
            ["Is the bypass up?", <Mono key="3">show mpls traffic-eng tunnels backup</Mono>, "Oper up, Protected LSPs: 1"],
            ["Is detection fast?", <Mono key="4">show bfd session</Mono>, "UP, 45 ms on the DWDM span"],
            ["Does it work?", "a failure drill", "repaired locally, tens of milliseconds"],
          ]}
        />
        <CliPanel run={frCli(FR_HEALTHY, "R3", "cisco", "show mpls traffic-eng tunnels backup")} caption="IOS XR · R3 — its two automatic bypasses" />
      </GuideSection>

      <GuideSection id="fl-incident" eyebrow="Incident" title="The incident" tone="danger">
        <p>tunnel-te1 shows fast reroute enabled and protected. R5 loses power, and the video freezes for more than a second. R3, R4 and R7 are fine. Last month someone &quot;tidied up&quot; R3&apos;s protection settings.</p>
        <DrillResult s={FR_FAULT} title="The lab: R5 fails (the ticket)" />
        <CompareCards
          items={[
            { title: "What it is", tone: "danger", tag: "cause", points: ["R3 builds NHOP bypasses only", "its bypass ends at R5 — the router that died", "R1 has to re-signal: > 1 s lost"] },
            { title: "What it can't be", tone: "success", tag: "ruled out", points: ["the request: node protection desired", "detection: BFD, 45 ms", "the headend: it did reroute, just late"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="fl-investigate" eyebrow="Incident" title="Walk the evidence" tone="danger">
        <TroubleshootingFlow
          steps={[
            { question: "What did the drill show?", look: "R5 fails: no local repair, ~1.5 s lost." },
            { question: "Does tunnel-te1 ask for protection?", look: "Yes — node protection desired." },
            { question: "Which router is the PLR, and what is bound?", look: "R3: tunnel-te1000 — the NHOP bypass to R5." },
            { question: "Why only NHOP?", look: "R3's interface toward R5: auto-tunnel backup nhop-only." },
          ]}
        />
        <CliPanel run={frCli(FR_FAULT_RESTORED, "R3", "cisco", "show mpls traffic-eng fast-reroute database")} caption="IOS XR · R3 — bound to tt1000, the NHOP bypass (the inner label is R5's)" />
        <CliPanel run={frOnly(FR_FAULT_RESTORED, "R3", "cisco", "show running-config mpls", /interface|auto-tunnel|nhop-only/)} caption="IOS XR · R3 — nhop-only on the interface toward R5" />
        <CliPanel run={frOnly(FR_FAULT_JN, "R3", "juniper", "show configuration protocols rsvp", /interface ge-0\/0\/1|link-protection|no-node-protection/)} caption="Junos · R3 — the same setting: link-protection no-node-protection" />
      </GuideSection>

      <GuideSection id="fl-fix" eyebrow="Incident" title="Repair and prove it" tone="success">
        <CliPair cisco={{ prompt: "RP/0/RP0/CPU0:R3(config)#", command: "mpls traffic-eng", output: "RP/0/RP0/CPU0:R3(config-mpls-te)#interface GigabitEthernet0/0/0/1\nRP/0/RP0/CPU0:R3(config-mpls-te-if)#no auto-tunnel backup nhop-only\nRP/0/RP0/CPU0:R3(config-mpls-te-if)#commit" }} junos={{ prompt: "admin@R3# ", command: "delete protocols rsvp interface ge-0/0/1.0 link-protection no-node-protection", output: "\n[edit]\nadmin@R3# commit and-quit\ncommit complete\nExiting configuration mode" }} ciscoCaption="IOS XR · R3" junosCaption="Junos · R3" />
        <DrillResult s={FR_FIXED} title="The lab: the same drill after the fix" />
        <ChecklistCard tone="success" title="Proved, not assumed" mark="✓" items={["R3 has an NNHOP bypass to R7, and tunnel-te1 is bound to it", "a fresh drill of R5 failing is repaired locally in ~55 ms"]} />
      </GuideSection>

      <GuideSection id="fl-other" eyebrow="Beyond this incident" title="Other ways protection fails" tone="warning">
        <FailureSignatures
          items={[
            { tag: "REQ", title: "The LSP doesn't ask", tone: "danger", points: ["protection configured everywhere", "no bypass built or bound for it"] },
            { tag: "BYP", title: "The bypass can't be signaled", tone: "warning", points: ["a link on its path isn't usable for TE", "the LSP falls back to NHOP"] },
            { tag: "PLR", title: "The wrong router was checked", tone: "violet", points: ["each link has its own PLR", "R5 protects R5–R7, not R3"] },
            { tag: "BFD", title: "Nobody notices in time", tone: "warning", points: ["silent failure, no BFD", "30 s with a ready bypass"] },
          ]}
        />
        <p className="text-sm text-pv-text-muted">Each is a ticket in the Fast Reroute Lab, together with this incident.</p>
      </GuideSection>

      <GuideSection id="fl-model" eyebrow="Mental model" title="Mental model" tone="cyan">
        <p>
          Think of a motorway with a slip road around every junction that might close. The slip roads are built in advance (bypasses). When a junction closes, the traffic officer standing right before it (the PLR) waves cars onto the slip road the moment they hear about it — they don&apos;t phone head office. The slip road rejoins the motorway after the closure (the merge point), where cars carry on with the same signs as before. Head office then reroutes everything properly. A slip road that ends in the closed junction is useless, and an officer who doesn&apos;t hear about the closure helps nobody.
        </p>
        <Callout tone="cyan" title="When it breaks, ask in this order" icon="→">
          What did the drill show? Does the LSP ask for protection (and which kind)? Which router is the PLR for this failure, and what is it bound to? Is that bypass up — and does it avoid the failure? How fast does the PLR detect it?
        </Callout>
      </GuideSection>

      <GuideSection id="fl-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "PLR", def: "Point of Local Repair: the router before the protected link or router; it switches traffic onto the bypass." },
            { term: "MP", def: "Merge point: where the bypass ends and the traffic rejoins the protected LSP." },
            { term: "Bypass", def: "A pre-signaled LSP around a link (NHOP) or a router (NNHOP)." },
            { term: "Facility backup", def: "One bypass protects every LSP leaving the PLR the same way (RFC 4090)." },
            { term: "NHOP / NNHOP", def: "Next hop / next-next hop: where a link-protecting / node-protecting bypass merges." },
            { term: "BFD", def: "Bidirectional Forwarding Detection: fast hellos that detect failures the interface doesn't show." },
            { term: "Re-optimization", def: "The headend moving an LSP to its best path, make-before-break." },
          ]}
        />
      </GuideSection>

      <GuideSection id="fl-recap" eyebrow="Reference" title="Recap" tone="success">
        <ChecklistCard tone="success" title="You can now" mark="✓" items={["explain why local repair beats waiting for the headend", "name the PLR, merge point and bypass for a failure", "tell link from node protection", "follow the repair label stack", "explain why detection decides", "prove protection with a drill and fix it when it fails"]} />
      </GuideSection>

      <GuideSection id="fl-practice" eyebrow="Next" title="Practice it" tone="violet">
        <p>The Deep Dive tab covers fast reroute in full: one-to-one vs facility backup, how the PLR learns labels, detection and BFD, SRLG diversity, bandwidth protection, signaling during and after repair, IOS XR and Junos configuration, FRR vs LFA / TI-LFA and every failure signature with real evidence. The lab lets you operate it.</p>
        <LessonLabBridge />
        <PresentationBridge>Rewatch the fast reroute presentation.</PresentationBridge>
      </GuideSection>
    </div>
  );
}
