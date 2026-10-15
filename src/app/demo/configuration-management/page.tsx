"use client";

import { FundamentalsLessonShell, type FundamentalsLessonConfig } from "@/components/lesson/FundamentalsLessonShell";
import type { LessonGuideTab } from "@/components/lesson/LessonGuideDialog";
import { kitAdapters, kitCallout, type KitDevice } from "@/components/lesson/ccnaKit";
import { CM_REPAIR_CORRECT, CM_REPAIR_OPTIONS, ST, SWITCHES, cmSteps, createCmState, synced, unsyncedCount, type CmState, type SwId } from "@/lib/sim-engine/scenarios/ccna/configManagement";
import { CmPanel } from "./CmPanel";
import { CM_BRIEFING_NOTES, CM_BRIEFING_PHASES, CM_DEEP_SECTIONS, CM_LESSON_SECTIONS, CmDeepDiveContent, CmLessonGuideContent } from "./guide";

const GUIDE_TABS: LessonGuideTab[] = [
  { id: "lesson", label: "This Lesson", hint: "Four tools compared · playbook · plan and state", sections: CM_LESSON_SECTIONS, content: <CmLessonGuideContent /> },
  { id: "deep", label: "Config Management Deep Dive", hint: "Changes as code · vendors · misconceptions", sections: CM_DEEP_SECTIONS, content: <CmDeepDiveContent /> },
];

const sw = (id: SwId): KitDevice<CmState> => ({
  id,
  deviceType: "Access switch",
  role: "Managed by Ansible over SSH.",
  stages: ST.sw,
  ports: () => [{ id: "mgmt", neighbor: "ANSIBLE", linkType: "SSH 22" }],
  knows: (s) => `ntp ${s.actual[id].ntp} (${synced(s, id) ? "synchronized" : "unsynchronized"})`,
});
const DEVICES: KitDevice<CmState>[] = [
  { id: "GIT", deviceType: "Git repository", role: "Source of truth: playbooks and variables.", stages: ST.git, ports: () => [], knows: (s) => `ntp_server: ${s.desired.ntp}` },
  { id: "ANSIBLE", deviceType: "Ansible control node", role: "Runs playbooks against the inventory, agentless.", stages: ST.ctl, ports: () => [{ id: "eth0", linkType: "SSH to 6 switches" }], knows: (s) => `${s.runs.length} runs`, tables: (s) => [{ title: "Runs", rows: s.runs.map((r, i) => ({ label: `#${i + 1} ${r.mode}`, value: `ok=${r.ok.length} changed=${r.changed.length}` })) }] },
  { id: "TF", deviceType: "Terraform", role: "Provisions the cloud network through provider APIs.", stages: ST.tf, ports: () => [{ id: "api", neighbor: "CLOUD", linkType: "HTTPS" }], knows: (s) => `${s.tfState.length} resources in state` },
  { id: "CLOUD", deviceType: "Cloud provider", role: "VPC and subnets.", stages: ST.tf, ports: () => [], knows: (s) => s.tfState.map((r) => r.address).join(", ") || "nothing yet" },
  ...SWITCHES.map(sw),
];
const adapters = kitAdapters(DEVICES, "automation");

const config: FundamentalsLessonConfig<CmState> = {
  lessonId: "configuration-management",
  xp: 125,
  steps: cmSteps,
  createState: createCmState,
  badge: "CCNA · Automation & Programmability",
  title: "Configuration Management: Ansible, Terraform, Puppet & Chef",
  intro: "Describe six switches once in Git and let Ansible make them match: preview with check mode, apply only what differs, run again and change nothing. Compare push and pull tools, plan a cloud network with Terraform — then watch a nightly run undo a 2 a.m. fix, and put the fix where it belongs.",
  facts: [
    { q: "What is a playbook?", a: "Ansible's YAML list of tasks for a group of hosts." },
    { q: "What is drift?", a: "A device that no longer matches its source of truth." },
    { q: "What is a state file?", a: "Terraform's record of what it built." },
    { q: "What is an agent?", a: "Software on the managed node that applies its configuration." },
  ],
  terms: [
    { term: "Ansible", expansion: "Agentless push", meaning: "YAML · SSH" },
    { term: "Terraform", expansion: "Infrastructure as code", meaning: "HCL · plan/apply" },
    { term: "Puppet", expansion: "Agent pull", meaning: "Manifests" },
    { term: "Chef", expansion: "Agent pull", meaning: "Ruby recipes" },
    { term: "Idempotent", expansion: "Safe to repeat", meaning: "No-op if equal" },
  ],
  guide: { title: "Configuration Management", subtitle: "Git · Ansible · 6 switches · Terraform · cloud", tabs: GUIDE_TABS },
  briefing: { phases: CM_BRIEFING_PHASES, notes: CM_BRIEFING_NOTES },
  nodes: (s) => [
    { id: "GIT", label: "GIT", subLabel: "source of truth", x: 8, y: 20, kind: "server" },
    { id: "ANSIBLE", label: "ANSIBLE", subLabel: "control node", x: 30, y: 46, kind: "server" },
    { id: "TF", label: "TF", subLabel: "terraform", x: 8, y: 80, kind: "laptop" },
    { id: "CLOUD", label: "CLOUD", subLabel: s.tfState.length ? "VPC built" : "empty", x: 30, y: 90, kind: "cloud" },
    ...SWITCHES.map((id, i) => ({ id, label: id, subLabel: synced(s, id) ? s.actual[id].ntp : "unsynced", x: 60 + (i % 2) * 22, y: 22 + Math.floor(i / 2) * 30, kind: "switch" as const })),
  ],
  edges: (s) => [
    { id: "g", a: "GIT", b: "ANSIBLE", label: "pull playbook" },
    { id: "t", a: "TF", b: "CLOUD", label: "API" },
    ...SWITCHES.map((id) => ({ id: `e-${id}`, a: "ANSIBLE", b: id, down: !synced(s, id) })),
  ],
  enterable: ["ANSIBLE", "TF", "SW1"],
  primaryDevice: { intro: "GIT", "fault-injected": "SW1", "diagnostic-layers": "ANSIBLE", "repair-challenge": "GIT" },
  ...adapters,
  callout: kitCallout,
  sidePanel: (s) => <CmPanel s={s} />,
  repair: {
    stepId: "repair-challenge",
    prompt: "The nightly run put all six switches back on the dead NTP server. Which change fixes the cause?",
    options: CM_REPAIR_OPTIONS,
    correctId: CM_REPAIR_CORRECT,
    success: "Git now says 10.9.0.124. The playbook applies it, and every later run keeps it that way.",
    wrongFeedback: {
      hand: "Tonight's run reverts it again — Git still names the dead server.",
      disable: "That stops all drift correction, and Git still holds the wrong value for the next run.",
      revive: "The server was retired for a reason. The source of truth needs to name the new one.",
    },
    attempt: (s) => s.repairAttempt,
  },
  diagnostics: {
    fromStepId: "diagnostic-layers",
    layers: (s) => [
      { label: `Source of truth — ntp_server ${s.desired.ntp}`, status: s.ntpAlive.includes(s.desired.ntp) ? "healthy" : "failing" },
      { label: `Last run — changed=${s.runs[s.runs.length - 1]?.changed.length ?? 0}`, status: "unknown" },
      { label: `Devices — ${unsyncedCount(s)} of 6 unsynchronized`, status: unsyncedCount(s) ? "failing" : "healthy" },
      { label: "NTP service — 10.9.0.124 answering", status: "healthy" },
    ],
  },
  complete: { badge: "Lesson Complete", title: "Your network lives in Git", message: "A source of truth, check mode, idempotent runs, push versus pull, Terraform's plan and state — and every change, even an emergency one, recorded where the tools read it." },
};

export default function ConfigurationManagementDemo() {
  return <FundamentalsLessonShell config={config} />;
}
