"use client";

import { FundamentalsLessonShell, type FundamentalsLessonConfig } from "@/components/lesson/FundamentalsLessonShell";
import { fundamentalsAppCallout } from "@/components/lesson/fundamentalsAppCallout";
import type { LessonGuideTab } from "@/components/lesson/LessonGuideDialog";
import { PARENT, R1_IFACE, SD_ADDR, SD_REPAIR_CORRECT, SD_REPAIR_OPTIONS, checkCandidate, createSdState, subnettingDesignSteps, type SdDevice, type SdState, type SegId } from "@/lib/sim-engine/scenarios/subnettingDesign";
import { SD_BRIEFING_NOTES, SD_BRIEFING_PHASES } from "./briefing";
import { sdInterfacesFor, sdTraceFor } from "./deviceTrace";
import { explainSd, sdTables } from "./explain";
import { sdNames } from "./addressNames";
import { PlanSummary, SubnetPlanPanel } from "./SubnetPlanPanel";
import { SD_LESSON_SECTIONS, SubnettingLessonGuideContent } from "./LessonGuideContent";
import { SD_DEEP_DIVE_SECTIONS, SubnettingDeepDiveContent } from "./DeepDiveContent";
import { SubnetPresentationOverlay } from "./subnetting-lab/SubnetPresentation";
import { SubnettingLabWorkspace } from "./subnetting-lab/SubnettingLabWorkspace";

const GUIDE_TABS: LessonGuideTab[] = [
  { id: "lesson", label: "This Lesson", hint: "10.44.0.0/24 → LAN-A/B/C + transit · VLSM · overlap incident", sections: SD_LESSON_SECTIONS, content: <SubnettingLessonGuideContent /> },
  { id: "deep", label: "Subnetting Design Deep Dive", hint: "Address planning, CIDR and VLSM in general", sections: SD_DEEP_DIVE_SECTIONS, content: <SubnettingDeepDiveContent /> },
];

/** Planner shown on teaching steps only — never on a question or during the incident, so it can't answer ahead of the learner. */
const PLANNER_STEPS = new Set(["powers-of-two", "size-lan-a", "size-lan-b", "size-lan-c", "size-transit", "sizing-summary", "place-lan-a", "place-lan-b", "boundaries-27", "candidate-200", "place-lan-c", "place-transit", "plan-review"]);
/** The LAN-C candidate tester appears only after the alignment question has been answered. */
const TESTER_STEPS = new Set(["candidate-200", "place-lan-c", "place-transit", "plan-review"]);
const segLabel = (s: SdState, seg: SegId) => (s.deployed[seg] ? `${seg} · ${s.deployed[seg]!.network}/${s.deployed[seg]!.prefix}` : `${seg} · ${R1_IFACE[seg]}`);

const config: FundamentalsLessonConfig<SdState> = {
  lessonId: "subnetting-design",
  xp: 175,
  steps: subnettingDesignSteps,
  createState: createSdState,
  badge: "Fundamentals · Address planning",
  title: "Subnetting Design Lab",
  intro: `Design a real address plan: fit four networks into ${PARENT.network}/${PARENT.prefix} from their host counts, place them on valid boundaries, reject an overlapping proposal, and prove the plan with packets.`,
  facts: [
    { q: "How big must a subnet be?", a: "For an ordinary LAN subnet: 2^h − 2 ≥ hosts. The smallest h that works sets the prefix: 32 − h. (/31 and /32 differ — see the Deep Dive.)" },
    { q: "Why largest first?", a: "Big blocks need big boundaries. Placing them first keeps every block aligned and the free space contiguous." },
    { q: "What is a valid network address?", a: "A multiple of the block size: host bits all zero." },
    { q: "What must never happen?", a: "Two subnets sharing any address." },
  ],
  terms: [
    { term: "VLSM", expansion: "Variable-Length Subnet Masking", meaning: "Different prefix per subnet" },
    { term: "CIDR", expansion: "Classless Inter-Domain Routing", meaning: "Prefix-length addressing" },
    { term: "Block", expansion: "2^(32 − prefix)", meaning: "Addresses per subnet" },
    { term: "Host bits", expansion: "32 − prefix", meaning: "Bits for hosts" },
    { term: "Overlap", expansion: "Shared addresses", meaning: "An invalid design" },
  ],
  guide: { title: "Subnetting Design Lab", subtitle: `${PARENT.network}/${PARENT.prefix} · LAN-A 100 · LAN-B 50 · LAN-C 25 · transit 2`, tabs: GUIDE_TABS },
  briefing: { phases: SD_BRIEFING_PHASES, notes: SD_BRIEFING_NOTES },
  nodes: (s) => [
    { id: "HOST-A", label: "HOST-A", subLabel: s.deployed["LAN-A"] ? `${SD_ADDR["HOST-A"]}/${s.deployed["LAN-A"].prefix}` : "LAN-A", x: 10, y: 22, kind: "laptop" },
    { id: "HOST-B", label: "HOST-B", subLabel: s.deployed["LAN-B"] ? `${SD_ADDR["HOST-B"]}/${s.deployed["LAN-B"].prefix}` : "LAN-B", x: 26, y: 86, kind: "laptop" },
    { id: "HOST-C", label: "HOST-C", subLabel: s.deployed["LAN-C"] ? `${SD_ADDR["HOST-C"]}/${s.deployed["LAN-C"].prefix}` : "LAN-C", x: 62, y: 88, kind: "laptop" },
    { id: "R1", label: "R1", subLabel: "gateway", x: 44, y: 46, kind: "router" },
    { id: "R2", label: "R2", subLabel: s.deployed.TRANSIT ? `${SD_ADDR["R2:TRANSIT"]}/${s.deployed.TRANSIT.prefix}` : "transit", x: 88, y: 28, kind: "router" },
  ],
  edges: (s) => [
    { id: "a-r1", a: "HOST-A", b: "R1", label: segLabel(s, "LAN-A") },
    { id: "b-r1", a: "HOST-B", b: "R1", label: segLabel(s, "LAN-B") },
    { id: "c-r1", a: "HOST-C", b: "R1", label: segLabel(s, "LAN-C") },
    { id: "r1-r2", a: "R1", b: "R2", label: segLabel(s, "TRANSIT") },
  ],
  enterable: ["R1", "R2"],
  primaryDevice: { deploy: "R1", "fault-apply": "R1", "verify-replan": "R1", "repair-challenge": "R1" },
  traceFor: (d, s, stepId) => sdTraceFor(d as SdDevice, s, stepId),
  interfacesFor: (d, s, stepId) => sdInterfacesFor(d as SdDevice, s, stepId),
  pipelineTitle: (d) => `${d} · ${d === "R1" ? "Plan + forwarding" : "Forwarding"} pipeline`,
  explainNode: explainSd,
  tablesFor: (d, s) => sdTables(d as SdDevice, s),
  callout: (p, s) => fundamentalsAppCallout(p, sdNames, { decision: s.note && (s.note.device === p.from || s.note.device === p.to) ? s.note.text : undefined }),
  nodeBadges: (id, s) => (id === "R1" && s.faultActive ? ["PLAN CONFLICT"] : undefined),
  repair: {
    stepId: "repair-challenge",
    prompt: "LAN-C needs 25 hosts. Which network satisfies every rule in the current plan?",
    options: SD_REPAIR_OPTIONS.map((o) => ({ id: o.id, label: o.label })),
    correctId: SD_REPAIR_CORRECT,
    success: "10.44.0.192/27 is aligned (6 × 32), inside the /24, holds 30 hosts and touches neither LAN-B (.128–.191) nor the transit /30 (.224–.227).",
    wrongFeedback: {
      "c-160-27": ".160 is a valid /27 boundary, but .160–.191 sits inside LAN-B's 10.44.0.128/26. Overlap.",
      "c-200-27": "200 is not a multiple of 32, so 10.44.0.200 is a host inside 10.44.0.192/27, not a network address.",
      "c-192-28": "A /28 has 16 addresses, 14 usable. LAN-C needs 25.",
    },
    attempt: (s) => s.repairAttempt,
  },
  diagnostics: {
    fromStepId: "diagnostic-layers",
    layers: (s) => {
      const c = s.plan.find((a) => a.id === "LAN-C")!;
      const check = c.network && c.prefix !== undefined ? checkCandidate(s.plan, "LAN-C", c.network, c.prefix) : undefined;
      return [
        { label: `LAN-C boundary — ${c.network}/${c.prefix} is a multiple of the block size`, status: check && check.verdict !== "misaligned" ? "healthy" : "failing" },
        { label: "LAN-C capacity — at least 25 ordinary hosts", status: check && check.verdict !== "too-small" ? "healthy" : "failing" },
        { label: "Inside the parent 10.44.0.0/24", status: check && check.verdict !== "outside-parent" ? "healthy" : "failing" },
        { label: "No overlap with LAN-A, LAN-B or the transit link", status: check?.verdict === "overlap" ? "failing" : "healthy" },
      ];
    },
  },
  panels: (s, stepId) => (stepId && PLANNER_STEPS.has(stepId) ? <SubnetPlanPanel plan={s.plan} showTester={TESTER_STEPS.has(stepId)} showFreeBlocks={stepId === "plan-review"} /> : null),
  sidePanel: (s) => <PlanSummary plan={s.plan} faulty={s.faultActive} />,
  practiceLab: {
    entry: { title: "Subnet Explorer", buttonLabel: "Practice Subnetting", description: "See address space on a board, calculate subnets yourself, compare FLSM with VLSM, then subnet a real branch network: design the plan, configure R1 and every PC and server from it (Cisco/Junos and host terminals), watch the packets, and troubleshoot seven addressing tickets." },
    contextNote: (stepId) => (stepId && ["powers-of-two", "size-lan-a", "size-lan-b", "size-lan-c", "size-transit", "place-lan-a", "place-lan-b", "boundaries-27", "place-lan-c", "place-transit", "plan-review"].includes(stepId) ? "Want to design it yourself instead of only watching?" : undefined),
    render: ({ open, onClose }) => <SubnettingLabWorkspace open={open} onClose={onClose} initialMode="explore" />,
  },
  presentation: { topic: "subnetting", render: (p) => <SubnetPresentationOverlay {...p} /> },
  complete: { badge: "Lesson Complete", title: "You designed and proved an address plan", message: "Host counts → prefixes → aligned, non-overlapping blocks → deployed and verified." },
};

export default function SubnettingDesignDemo() {
  return <FundamentalsLessonShell config={config} />;
}
