"use client";

import { FundamentalsLessonShell, type FundamentalsLessonConfig } from "@/components/lesson/FundamentalsLessonShell";
import type { LessonGuideTab } from "@/components/lesson/LessonGuideDialog";
import { kitAdapters, kitCallout, type KitDevice } from "@/components/lesson/ccnaKit";
import { SEC_REPAIR_CORRECT, SEC_REPAIR_OPTIONS, ST, createSecState, secSteps, type SecState } from "@/lib/sim-engine/scenarios/ccna/securityConcepts";
import { SEC_BRIEFING_NOTES, SEC_BRIEFING_PHASES, SEC_DEEP_SECTIONS, SEC_LESSON_SECTIONS, SecDeepDiveContent, SecLessonGuideContent } from "./guide";

const GUIDE_TABS: LessonGuideTab[] = [
  { id: "lesson", label: "This Lesson", hint: "Vulnerability, threat, exploit · attacks computed · a security program · a tailgater", sections: SEC_LESSON_SECTIONS, content: <SecLessonGuideContent /> },
  { id: "deep", label: "Security Concepts Deep Dive", hint: "CIA · defence in depth · misconceptions", sections: SEC_DEEP_SECTIONS, content: <SecDeepDiveContent /> },
];

const simple = (id: string, deviceType: string, role: string, stages: (typeof ST)[keyof typeof ST]): KitDevice<SecState> => ({ id, deviceType, role, stages, ports: () => [], knows: () => role });
const DEVICES: KitDevice<SecState>[] = [
  simple("ATTACKER", "Attacker", "Outside: scans, floods, phishes.", ST.user),
  { ...simple("FW", "Firewall + IPS", "Permits only HTTPS to the web server and the VPN.", ST.fw), tables: (s) => [{ title: "Security alerts", rows: s.alerts.map((a, i) => ({ label: `#${i + 1}`, value: a })) }] },
  simple("WEB", "Web server", "Public website 203.0.113.80.", ST.srv),
  { ...simple("VPN", "VPN gateway", "Remote access for staff.", ST.vpn), knows: (s) => (s.mfa ? "Password + MFA required" : "Password only") },
  { ...simple("ACC-SW", "Access switch", "User ports, including meeting rooms.", ST.sw), ports: (s) => [{ id: "Gi1/0/30", neighbor: s.rogue ? "ROGUE" : undefined, neighborLabel: s.rogue ? "ROGUE laptop" : "meeting-room jack", linkType: s.jackLive ? "access VLAN 10" : "shutdown", up: s.jackLive && s.rogue }], knows: (s) => (s.jackLive ? "Gi1/0/30 live in VLAN 10" : "unused ports shut down") },
  simple("USER", "Staff", "400 employees reading e-mail.", ST.user),
  simple("ROGUE", "Unknown laptop", "Plugged in by a visitor.", ST.user),
];
const adapters = kitAdapters(DEVICES, "security view");

const config: FundamentalsLessonConfig<SecState> = {
  lessonId: "security-fundamentals",
  xp: 125,
  steps: secSteps,
  createState: createSecState,
  badge: "CCNA · Security Fundamentals",
  title: "Security Concepts & Threats",
  intro: "Learn the language of security, then watch the attacks you must recognise — a port scan, a SYN flood, phishing — with their numbers computed. See what stops a stolen password, and why a security program is people and buildings as much as firewalls.",
  facts: [
    { q: "Vulnerability or threat?", a: "A weakness vs someone who could use it." },
    { q: "What is a DDoS?", a: "A denial of service from many sources at once." },
    { q: "What is phishing?", a: "Deceptive messages that trick people into giving up credentials." },
    { q: "What is defence in depth?", a: "Several independent layers, so one failure isn't a breach." },
  ],
  terms: [
    { term: "Exploit", expansion: "Attack technique", meaning: "Uses a weakness" },
    { term: "IPS", expansion: "Intrusion prevention system", meaning: "Detects and blocks" },
    { term: "DoS", expansion: "Denial of service", meaning: "Exhaust a resource" },
    { term: "MITM", expansion: "Man in the middle", meaning: "Intercept traffic" },
    { term: "MFA", expansion: "Multi-factor authentication", meaning: "Know + have / are" },
  ],
  guide: { title: "Security Concepts & Threats", subtitle: "ATTACKER · FW/IPS · WEB · VPN · ACC-SW · staff", tabs: GUIDE_TABS },
  briefing: { phases: SEC_BRIEFING_PHASES, notes: SEC_BRIEFING_NOTES },
  nodes: (s) => [
    { id: "ATTACKER", label: "ATTACKER", subLabel: "internet", x: 8, y: 30, kind: "laptop" },
    { id: "FW", label: "FW", subLabel: "firewall + IPS", x: 32, y: 30, kind: "firewall" },
    { id: "WEB", label: "WEB", subLabel: "203.0.113.80", x: 56, y: 10, kind: "server" },
    { id: "VPN", label: "VPN", subLabel: s.mfa ? "MFA" : "password", x: 56, y: 44, kind: "router" },
    { id: "ACC-SW", label: "ACC-SW", subLabel: "users", x: 78, y: 62, kind: "switch" },
    { id: "USER", label: "USER", subLabel: "400 staff", x: 94, y: 40, kind: "laptop" },
    ...(s.rogue ? [{ id: "ROGUE", label: "ROGUE", subLabel: "meeting room", x: 94, y: 88, kind: "laptop" as const }] : []),
  ],
  edges: (s) => [
    { id: "a", a: "ATTACKER", b: "FW", label: "internet" },
    { id: "w", a: "FW", b: "WEB" },
    { id: "v", a: "FW", b: "VPN" },
    { id: "acc", a: "VPN", b: "ACC-SW" },
    { id: "u", a: "ACC-SW", b: "USER" },
    ...(s.rogue ? [{ id: "r", a: "ACC-SW", b: "ROGUE", label: "Gi1/0/30", down: !s.jackLive }] : []),
  ],
  enterable: ["FW", "VPN", "ACC-SW"],
  primaryDevice: { recon: "FW", dos: "WEB", phish: "USER", "vpn-stolen": "VPN", mfa: "VPN", "fault-injected": "ACC-SW", "inc-scan": "ACC-SW", "diagnostic-layers": "ACC-SW", "repair-challenge": "ACC-SW", verify: "ACC-SW" },
  ...adapters,
  callout: kitCallout,
  repair: {
    stepId: "repair-challenge",
    prompt: "A visitor tailgated in and plugged into a live meeting-room port. Which change fixes the cause?",
    options: SEC_REPAIR_OPTIONS,
    correctId: SEC_REPAIR_CORRECT,
    success: "Unused ports are shut down and visitors are escorted. The jack gives no link, and the next laptop gets nowhere.",
    wrongFeedback: {
      mac: "The next visitor brings a different laptop. Close the door, not one key.",
      wifi: "The laptop came in on a cable, not over Wi-Fi.",
      av: "The servers were never the entry point — the wall port was.",
    },
    attempt: (s) => s.repairAttempt,
  },
  diagnostics: {
    fromStepId: "diagnostic-layers",
    layers: (s) => [
      { label: "Physical access — visitor entered without a badge", status: "failing" },
      { label: `Access port Gi1/0/30 — ${s.jackLive ? "live in VLAN 10" : "shut down"}`, status: s.jackLive ? "failing" : "healthy" },
      { label: "Network admission (802.1X) — not deployed yet", status: "unknown" },
      { label: "Internal monitoring — sweep detected", status: "healthy" },
      { label: "Servers and VPN — patched, MFA on", status: "healthy" },
    ],
  },
  complete: { badge: "Lesson Complete", title: "You can name the threats — and the layers", message: "Vulnerabilities, threats, exploits and mitigations; reconnaissance, DoS, spoofing, MITM and phishing with their numbers; MFA for stolen passwords; and awareness, training and physical control around the technology." },
};

export default function SecurityFundamentalsDemo() {
  return <FundamentalsLessonShell config={config} />;
}
