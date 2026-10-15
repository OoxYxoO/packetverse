"use client";

import { FundamentalsLessonShell, type FundamentalsLessonConfig } from "@/components/lesson/FundamentalsLessonShell";
import { CliPanel } from "@/components/lesson/GuideCli";
import type { LessonGuideTab } from "@/components/lesson/LessonGuideDialog";
import { kitAdapters, kitCallout, type KitDevice } from "@/components/lesson/ccnaKit";
import { ADDR, MGMT_REPAIR_CORRECT, MGMT_REPAIR_OPTIONS, ST, createMgmtState, mgmtSteps, sshStatus, type MgmtState } from "@/lib/sim-engine/scenarios/ccna/deviceMgmt";
import { MGMT_BRIEFING_NOTES, MGMT_BRIEFING_PHASES, MGMT_DEEP_SECTIONS, MGMT_LESSON_SECTIONS, MgmtDeepDiveContent, MgmtLessonGuideContent } from "./guide";

const GUIDE_TABS: LessonGuideTab[] = [
  { id: "lesson", label: "This Lesson", hint: "Telnet vs SSH · enabling SSH · TFTP, FTP and SCP · an SSH refusal", sections: MGMT_LESSON_SECTIONS, content: <MgmtLessonGuideContent /> },
  { id: "deep", label: "Device Management Deep Dive", hint: "Management-plane hardening · misconceptions", sections: MGMT_DEEP_SECTIONS, content: <MgmtDeepDiveContent /> },
];

const sw = (id: "SW1" | "SW2"): KitDevice<MgmtState> => ({
  id,
  deviceType: "Switch",
  role: "Managed remotely over the management VLAN.",
  stages: ST.sw,
  ports: () => [{ id: "Vlan99", neighbor: "ADMIN", linkType: "management", ip: id === "SW1" ? ADDR.sw1 : ADDR.sw2 }],
  knows: (s) => {
    const st = sshStatus(s.dev[id]);
    return `SSH ${st.enabled ? `enabled v${st.version}` : "disabled"} · vty transport input ${s.dev[id].vtyTransport.join(" ")}`;
  },
  tables: (s) => [{ title: `${id} management`, rows: [{ label: "domain", value: s.dev[id].domain ?? "—" }, { label: "RSA key", value: s.dev[id].rsaBits ? `${s.dev[id].rsaBits} bits` : "none" }, { label: "vty transport input", value: s.dev[id].vtyTransport.join(" ") }, { label: "login", value: s.dev[id].loginLocal ? "local" : "line password" }] }],
});
const DEVICES: KitDevice<MgmtState>[] = [
  { id: "ADMIN", deviceType: "Admin workstation", role: "SSH / Telnet client.", stages: ST.pc, ports: () => [{ id: "eth0", neighbor: "MGMT-SW", linkType: "management VLAN", ip: ADDR.admin }], knows: (s) => s.sessions[s.sessions.length - 1] ?? "no sessions yet" },
  { id: "MGMT-SW", deviceType: "Switch", role: "Management VLAN 99.", stages: ST.srv, ports: () => [], knows: () => "VLAN 99" },
  sw("SW1"),
  sw("SW2"),
  { id: "TFTP", deviceType: "File server", role: "TFTP/FTP/SCP server for backups.", stages: ST.srv, ports: () => [{ id: "eth0", neighbor: "MGMT-SW", linkType: "management", ip: ADDR.tftp }], knows: (s) => s.backups.join(", ") || "no backups yet" },
];
const adapters = kitAdapters(DEVICES, "management access");

const config: FundamentalsLessonConfig<MgmtState> = {
  lessonId: "device-management-ssh",
  xp: 125,
  steps: mgmtSteps,
  createState: createMgmtState,
  badge: "CCNA · IP Services",
  title: "Device Management: SSH, TFTP & FTP",
  intro: "Read a Telnet password straight out of a capture, then replace Telnet with SSH step by step. Back up a configuration over TFTP, choose a safer transfer — and fix a replacement switch that refuses SSH while Telnet still works.",
  facts: [
    { q: "Why not Telnet?", a: "Every keystroke — the password too — crosses the network in clear text." },
    { q: "Which ports?", a: "SSH uses TCP 22, Telnet TCP 23, TFTP UDP 69, FTP TCP 21." },
    { q: "TFTP or FTP?", a: "TFTP: UDP, no login. FTP: TCP, login in clear text." },
    { q: "Safest file copy?", a: "SCP or SFTP, inside SSH." },
  ],
  terms: [
    { term: "VTY", expansion: "Virtual terminal lines", meaning: "Remote sessions" },
    { term: "SSH", expansion: "Secure Shell", meaning: "TCP 22, encrypted" },
    { term: "Telnet", expansion: "Teletype network", meaning: "TCP 23, clear text" },
    { term: "TFTP", expansion: "Trivial FTP", meaning: "UDP 69, no auth" },
    { term: "SCP", expansion: "Secure copy", meaning: "Files over SSH" },
  ],
  guide: { title: "Device Management: SSH, TFTP & FTP", subtitle: `ADMIN ${ADDR.admin} · SW1 · SW2 · TFTP ${ADDR.tftp}`, tabs: GUIDE_TABS },
  briefing: { phases: MGMT_BRIEFING_PHASES, notes: MGMT_BRIEFING_NOTES },
  nodes: (s) => [
    { id: "ADMIN", label: "ADMIN", subLabel: ADDR.admin, x: 10, y: 50, kind: "laptop" },
    { id: "MGMT-SW", label: "MGMT-SW", subLabel: "VLAN 99", x: 38, y: 50, kind: "switch" },
    { id: "SW1", label: "SW1", subLabel: `vty: ${s.dev.SW1.vtyTransport.join(" ")}`, x: 72, y: 22, kind: "switch" },
    { id: "SW2", label: "SW2", subLabel: `vty: ${s.dev.SW2.vtyTransport.join(" ")}`, x: 72, y: 78, kind: "switch" },
    { id: "TFTP", label: "TFTP", subLabel: ADDR.tftp, x: 92, y: 50, kind: "server" },
  ],
  edges: () => [
    { id: "a", a: "ADMIN", b: "MGMT-SW" },
    { id: "s1", a: "MGMT-SW", b: "SW1" },
    { id: "s2", a: "MGMT-SW", b: "SW2" },
    { id: "t", a: "MGMT-SW", b: "TFTP" },
  ],
  enterable: ["SW1", "SW2"],
  primaryDevice: { telnet: "SW1", "ssh-config": "SW1", "ssh-login": "SW1", tftp: "TFTP", "fault-injected": "SW1", "inc-refused": "SW1", "diagnostic-layers": "SW1", "repair-challenge": "SW1", verify: "SW1" },
  ...adapters,
  callout: kitCallout,
  sidePanel: (s) => <CliPanel run={{ prompt: "ADMIN$ ", command: "history", output: s.sessions.join("\n") || "(no sessions yet)" }} caption="Admin sessions" />,
  repair: {
    stepId: "repair-challenge",
    prompt: "SSH to the replacement SW1 is refused instantly, while Telnet works. Which change fixes the cause?",
    options: MGMT_REPAIR_OPTIONS,
    correctId: MGMT_REPAIR_CORRECT,
    success: "The VTY lines now accept SSH (and only SSH): the admin's session opens encrypted, and Telnet is refused.",
    wrongFeedback: {
      rsa: "show ip ssh already says SSH is enabled, version 2.0 — the key is fine.",
      telnet: "That trades a working fix for clear-text passwords on the network.",
      user: "Authentication never starts — the connection is refused before any login prompt.",
    },
    attempt: (s) => s.repairAttempt,
  },
  diagnostics: {
    fromStepId: "diagnostic-layers",
    layers: (s) => {
      const st = sshStatus(s.dev.SW1);
      return [
        { label: "Reachability — ping SW1 succeeds", status: "healthy" },
        { label: `SSH enabled — ${st.enabled ? `version ${st.version}` : st.why}`, status: st.enabled ? "healthy" : "failing" },
        { label: `VTY transport input — ${s.dev.SW1.vtyTransport.join(" ")}`, status: s.dev.SW1.vtyTransport.includes("ssh") ? "healthy" : "failing" },
        { label: "access-class — none", status: "healthy" },
        { label: "login local — user netadmin exists", status: "healthy" },
      ];
    },
  },
  complete: { badge: "Lesson Complete", title: "You can manage devices safely", message: "SSH v2 with a hostname, domain, 2048-bit key, transport input ssh and login local; Telnet off; TFTP and FTP understood for what they are — and SCP/SFTP for anything sensitive." },
};

export default function DeviceManagementDemo() {
  return <FundamentalsLessonShell config={config} />;
}
