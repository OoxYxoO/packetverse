"use client";

import { FundamentalsLessonShell, type FundamentalsLessonConfig } from "@/components/lesson/FundamentalsLessonShell";
import type { LessonGuideTab } from "@/components/lesson/LessonGuideDialog";
import { kitAdapters, kitCallout, type KitDevice } from "@/components/lesson/ccnaKit";
import { AI_REPAIR_CORRECT, AI_REPAIR_OPTIONS, ST, aiSteps, createAiState, type AiState } from "@/lib/sim-engine/scenarios/ccna/aiOps";
import { aceText } from "@/lib/sim-engine/scenarios/ccna/acl";
import { AiPanel } from "./AiPanel";
import { AI_BRIEFING_NOTES, AI_BRIEFING_PHASES, AI_DEEP_SECTIONS, AI_LESSON_SECTIONS, AiDeepDiveContent, AiLessonGuideContent } from "./guide";

const GUIDE_TABS: LessonGuideTab[] = [
  { id: "lesson", label: "This Lesson", hint: "Predictive vs generative · anomaly · forecast · review", sections: AI_LESSON_SECTIONS, content: <AiLessonGuideContent /> },
  { id: "deep", label: "AI in Operations Deep Dive", hint: "Uses · guardrails · misconceptions", sections: AI_DEEP_SECTIONS, content: <AiDeepDiveContent /> },
];

const DEVICES: KitDevice<AiState>[] = [
  { id: "WAN-R", deviceType: "WAN router", role: "Streams latency and utilization telemetry.", stages: ST.ana, ports: () => [{ id: "telemetry", neighbor: "AIOPS", linkType: "gRPC telemetry" }], knows: () => "Streaming every 5 min" },
  { id: "AIOPS", deviceType: "Analytics platform", role: "Learns baselines, scores anomalies, forecasts.", stages: ST.ana, ports: () => [], knows: (s) => (s.anomaly ? `Anomaly z=${s.anomaly.z}` : s.baseline ? "Baseline learned" : "Collecting") },
  { id: "GENAI", deviceType: "AI assistant", role: "Drafts text and configuration from prompts.", stages: ST.gen, ports: () => [], knows: (s) => (s.draft ? "Draft delivered" : "Idle") },
  { id: "ENG", deviceType: "Network engineer", role: "Owns every change that reaches the network.", stages: ST.eng, ports: () => [], knows: (s) => (s.validated ? "Reviews + tests every draft" : "—") },
  { id: "R1", deviceType: "Router", role: "Guest LAN on Gi0/1.", stages: ST.r1, ports: (s) => [{ id: "Gi0/1", neighbor: "GUEST", linkType: s.applied ? "ACL GUEST-IN in" : "no ACL" }], knows: (s) => (s.applied ? "GUEST-IN applied" : "No ACL"), tables: (s) => (s.applied ? [{ title: "GUEST-IN", rows: s.applied.aces.map((e) => ({ label: String(e.seq), value: aceText(e).replace(/^\d+ /, "") })) }] : []) },
  { id: "GUEST", deviceType: "Guest laptop", role: "10.1.20.33", stages: ST.eng, ports: () => [], knows: () => "10.1.20.33" },
];
const adapters = kitAdapters(DEVICES, "operations");

const config: FundamentalsLessonConfig<AiState> = {
  lessonId: "ai-ml-network-operations",
  xp: 125,
  steps: aiSteps,
  createState: createAiState,
  badge: "CCNA · Automation & Programmability",
  title: "AI & Machine Learning in Network Operations",
  intro: "See what a learned baseline catches that a fixed threshold misses, turn twelve weeks of utilization into an upgrade date, and let a generative assistant draft an ACL — then find out what happens when nobody checks it.",
  facts: [
    { q: "What is telemetry?", a: "Operational data streamed from devices." },
    { q: "What is a baseline?", a: "What normal looks like for a metric." },
    { q: "What is an anomaly?", a: "A value far outside the learned normal." },
    { q: "What is a prompt?", a: "The request you give a generative model." },
  ],
  terms: [
    { term: "AI", expansion: "Artificial intelligence", meaning: "Predictive · generative" },
    { term: "ML", expansion: "Machine learning", meaning: "Learn from data" },
    { term: "σ", expansion: "Standard deviation", meaning: "Typical spread" },
    { term: "LLM", expansion: "Large language model", meaning: "Generates text" },
    { term: "HITL", expansion: "Human in the loop", meaning: "Engineer approves" },
  ],
  guide: { title: "AI & ML in Network Operations", subtitle: "WAN-R · analytics · AI assistant · engineer · R1", tabs: GUIDE_TABS },
  briefing: { phases: AI_BRIEFING_PHASES, notes: AI_BRIEFING_NOTES },
  nodes: (s) => [
    { id: "WAN-R", label: "WAN-R", subLabel: "telemetry", x: 10, y: 22, kind: "router" },
    { id: "AIOPS", label: "AIOPS", subLabel: s.anomaly ? "anomaly!" : "analytics", x: 40, y: 22, kind: "server" },
    { id: "GENAI", label: "GENAI", subLabel: "assistant", x: 76, y: 22, kind: "server" },
    { id: "ENG", label: "ENG", subLabel: s.validated ? "review + test" : "engineer", x: 58, y: 58, kind: "laptop" },
    { id: "R1", label: "R1", subLabel: s.applied ? "GUEST-IN" : "", x: 40, y: 86, kind: "router" },
    { id: "GUEST", label: "GUEST", subLabel: "10.1.20.33", x: 10, y: 86, kind: "laptop" },
  ],
  edges: () => [
    { id: "t", a: "WAN-R", b: "AIOPS", label: "telemetry" },
    { id: "g", a: "ENG", b: "GENAI", label: "prompt" },
    { id: "a", a: "AIOPS", b: "ENG", label: "alerts" },
    { id: "c", a: "ENG", b: "R1", label: "change" },
    { id: "u", a: "GUEST", b: "R1", label: "Gi0/1" },
  ],
  enterable: ["AIOPS", "R1"],
  primaryDevice: { forecast: "AIOPS", "fault-injected": "R1", "diagnostic-layers": "R1", "repair-challenge": "ENG", verify: "ENG" },
  ...adapters,
  callout: kitCallout,
  sidePanel: (s) => <AiPanel s={s} />,
  repair: {
    stepId: "repair-challenge",
    prompt: "An unreviewed AI-drafted ACL used subnet masks as wildcards and blocked guests. Which change fixes the cause?",
    options: AI_REPAIR_OPTIONS,
    correctId: AI_REPAIR_CORRECT,
    success: "The wildcards are corrected and drafts now go through review and the intended test flows before deployment.",
    wrongFeedback: {
      regen: "A new answer may be right or wrong — and still unverified. The process is the problem.",
      anyany: "Guests would reach the database too: the policy is gone.",
      noacl: "That restores the web server and removes all protection for the server LAN.",
    },
    attempt: (s) => s.repairAttempt,
  },
  diagnostics: {
    fromStepId: "diagnostic-layers",
    layers: (s) => [
      { label: "Request — clear policy for guests", status: "healthy" },
      { label: `Draft — source ${s.validated ? "10.1.20.0 0.0.0.255" : "10.1.20.0 255.255.255.0 (subnet mask)"}`, status: s.validated ? "healthy" : "failing" },
      { label: `Review and test before deployment — ${s.validated ? "required" : "skipped"}`, status: s.validated ? "healthy" : "failing" },
      { label: "R1 — enforcing what it was given", status: "healthy" },
    ],
  },
  complete: { badge: "Lesson Complete", title: "AI assists; you decide", message: "Learned baselines and z-scores, supervised and unsupervised learning, a capacity forecast, a generated draft — and the review and testing that make AI output safe to deploy." },
};

export default function AiMlNetworkOperationsDemo() {
  return <FundamentalsLessonShell config={config} />;
}
