"use client";

import { FundamentalsLessonShell, type FundamentalsLessonConfig } from "@/components/lesson/FundamentalsLessonShell";
import type { LessonGuideTab } from "@/components/lesson/LessonGuideDialog";
import { kitAdapters, kitCallout, type KitDevice } from "@/components/lesson/ccnaKit";
import { AAA_REPAIR_CORRECT, AAA_REPAIR_OPTIONS, ST, aaaSteps, createAaaState, listText, type AaaState } from "@/lib/sim-engine/scenarios/ccna/deviceAccess";
import { AaaPanel } from "./AaaPanel";
import { AAA_BRIEFING_NOTES, AAA_BRIEFING_PHASES, AAA_DEEP_SECTIONS, AAA_LESSON_SECTIONS, AaaDeepDiveContent, AaaLessonGuideContent } from "./guide";

const GUIDE_TABS: LessonGuideTab[] = [
  { id: "lesson", label: "This Lesson", hint: "Storage · entropy · method lists · TACACS+ vs RADIUS", sections: AAA_LESSON_SECTIONS, content: <AaaLessonGuideContent /> },
  { id: "deep", label: "Device Access Deep Dive", hint: "Lines and privilege · other vendors · misconceptions", sections: AAA_DEEP_SECTIONS, content: <AaaDeepDiveContent /> },
];

const switchDev = (id: string, role: string): KitDevice<AaaState> => ({
  id,
  deviceType: "Access switch",
  role,
  stages: ST.sw,
  ports: (s) => [{ id: "vty 0-15", neighbor: "ADMIN", neighborLabel: "NOC (SSH)", linkType: "SSH only" }, { id: "Gi1/0/48", neighbor: "CORE", linkType: "uplink", extra: [["AAA server", s.serverUp ? "reachable" : "no reply"]] }],
  knows: (s) => (id === "SW1" && !s.aaa ? "login local" : listText(s.lists[id])),
  tables: (s) => [
    { title: "Login method list (in order)", rows: s.lists[id].map((m, i) => ({ label: `${i + 1}`, value: m === "tacacs" ? "group tacacs+" : "local" })) },
    { title: "Local accounts", rows: (s.localUsers[id] ?? []).map((u) => ({ label: u, value: "secret (hash)" })) },
  ],
});
const DEVICES: KitDevice<AaaState>[] = [
  { id: "ADMIN", deviceType: "NOC workstation", role: "Engineers log in to the switches over SSH.", stages: ST.admin, ports: () => [], knows: () => "SSH client" },
  { id: "CORE", deviceType: "Core switch", role: "Connects the NOC, the AAA server and the access switches.", stages: ST.sw, ports: () => [], knows: () => "Forwards management traffic" },
  switchDev("SW1", "Access switch, HQ."),
  switchDev("SW2", "Access switch, built from an old template."),
  {
    id: "AAA",
    deviceType: "TACACS+ server",
    role: "Central accounts, roles and the accounting log.",
    stages: ST.srv,
    ports: (s) => [{ id: "eth0", neighbor: "CORE", linkType: "10.9.0.5", up: s.serverUp }],
    knows: (s) => (s.serverUp ? "Answering on TCP 49" : "Unreachable"),
    tables: (s) => [
      { title: "Accounts", rows: Object.entries(s.tacacsUsers).map(([u, a]) => ({ label: u, value: `${a.role} · ${a.enabled ? "enabled" : "disabled"}` })) },
      { title: "Accounting", rows: s.accounting.map((a, i) => ({ label: `#${i + 1}`, value: a })) },
    ],
  },
];
const adapters = kitAdapters(DEVICES, "AAA view");

const config: FundamentalsLessonConfig<AaaState> = {
  lessonId: "device-access-aaa",
  xp: 125,
  steps: aaaSteps,
  createState: createAaaState,
  badge: "CCNA · Security Fundamentals",
  title: "Device Access & AAA: TACACS+ and RADIUS",
  intro: "Who may log in to a switch, and what may they do? See how each password form is stored, compute password strength, then move logins to a TACACS+ server — and learn the one rule that decides when a method list falls back to local accounts.",
  facts: [
    { q: "What does AAA stand for?", a: "Authentication, authorization, accounting." },
    { q: "What is a method list?", a: "The ordered list of places a device checks a login." },
    { q: "What is a break-glass account?", a: "A single local account for when the AAA server is unreachable." },
    { q: "Which ports?", a: "TACACS+ TCP 49; RADIUS UDP 1812/1813." },
  ],
  terms: [
    { term: "AAA", expansion: "Authentication, authorization, accounting", meaning: "Who · what · record" },
    { term: "TACACS+", expansion: "Terminal Access Controller Access-Control System Plus", meaning: "Device admin" },
    { term: "RADIUS", expansion: "Remote Authentication Dial-In User Service", meaning: "Network access" },
    { term: "Secret", expansion: "Hashed password", meaning: "Type 8 / 9" },
    { term: "MFA", expansion: "Multi-factor authentication", meaning: "Know + have / are" },
  ],
  guide: { title: "Device Access & AAA", subtitle: "ADMIN · CORE · SW1 · SW2 · TACACS+ server", tabs: GUIDE_TABS },
  briefing: { phases: AAA_BRIEFING_PHASES, notes: AAA_BRIEFING_NOTES },
  nodes: (s) => [
    { id: "ADMIN", label: "ADMIN", subLabel: "NOC", x: 8, y: 50, kind: "laptop" },
    { id: "CORE", label: "CORE", x: 38, y: 50, kind: "switch" },
    { id: "AAA", label: "AAA", subLabel: s.serverUp ? "TACACS+ 10.9.0.5" : "unreachable", x: 38, y: 12, kind: "server" },
    { id: "SW1", label: "SW1", subLabel: "HQ", x: 72, y: 26, kind: "switch" },
    { id: "SW2", label: "SW2", subLabel: "old template", x: 72, y: 78, kind: "switch" },
  ],
  edges: (s) => [
    { id: "a", a: "ADMIN", b: "CORE", label: "SSH" },
    { id: "srv", a: "CORE", b: "AAA", label: "TCP 49", down: !s.serverUp },
    { id: "s1", a: "CORE", b: "SW1" },
    { id: "s2", a: "CORE", b: "SW2" },
  ],
  enterable: ["SW1", "SW2", "AAA"],
  primaryDevice: { storage: "SW1", strength: "SW1", local: "SW1", aaa: "SW1", reject: "SW1", error: "SW1", authz: "AAA", accounting: "AAA", "fault-injected": "SW2", "inc-login": "SW2", "diagnostic-layers": "SW2", "repair-challenge": "SW2", verify: "SW2" },
  ...adapters,
  callout: kitCallout,
  sidePanel: (s) => <AaaPanel s={s} />,
  repair: {
    stepId: "repair-challenge",
    prompt: "A departed engineer logged in to SW2 although his TACACS+ account is disabled. Which change fixes the cause?",
    options: AAA_REPAIR_OPTIONS,
    correctId: AAA_REPAIR_CORRECT,
    success: "SW2 asks the server first, and only one break-glass account remains locally. mark is refused; alice still gets in.",
    wrongFeedback: {
      disable: "It's already disabled. SW2 never asked the server.",
      enable: "The enable secret guards privileged mode; mark logged in with a local username and password.",
      radius: "The protocol isn't the problem — the order is. With local first, no server would be asked.",
    },
    attempt: (s) => s.repairAttempt,
  },
  diagnostics: {
    fromStepId: "diagnostic-layers",
    layers: (s) => [
      { label: "SSH session — reaches SW2", status: "healthy" },
      { label: `Method list — ${listText(s.lists.SW2).replace("aaa authentication login default ", "")}`, status: s.lists.SW2[0] === "local" ? "failing" : "healthy" },
      { label: `Local database — ${(s.localUsers.SW2 ?? []).join(", ")}`, status: s.localUsers.SW2.includes("mark") ? "failing" : "healthy" },
      { label: "TACACS+ server — mark disabled", status: "healthy" },
    ],
  },
  complete: { badge: "Lesson Complete", title: "You control who gets in", message: "Hashed secrets, long random passwords, a server-first method list with one break-glass account, per-command authorization and accounting — and RADIUS for network access." },
};

export default function DeviceAccessAaaDemo() {
  return <FundamentalsLessonShell config={config} />;
}
