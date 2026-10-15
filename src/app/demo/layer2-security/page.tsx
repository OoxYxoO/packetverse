"use client";

import { FundamentalsLessonShell, type FundamentalsLessonConfig } from "@/components/lesson/FundamentalsLessonShell";
import type { LessonGuideTab } from "@/components/lesson/LessonGuideDialog";
import { kitAdapters, kitCallout, type KitDevice } from "@/components/lesson/ccnaKit";
import { IP, L2_REPAIR_CORRECT, L2_REPAIR_OPTIONS, MAC, ST, createL2State, l2Steps, type L2State } from "@/lib/sim-engine/scenarios/ccna/layer2Security";
import { L2Panel } from "./L2Panel";
import { L2_BRIEFING_NOTES, L2_BRIEFING_PHASES, L2_DEEP_SECTIONS, L2_LESSON_SECTIONS, L2DeepDiveContent, L2LessonGuideContent } from "./guide";

const GUIDE_TABS: LessonGuideTab[] = [
  { id: "lesson", label: "This Lesson", hint: "Five attacks · five controls · a silent printer", sections: L2_LESSON_SECTIONS, content: <L2LessonGuideContent /> },
  { id: "deep", label: "Layer 2 Security Deep Dive", hint: "802.1X · other vendors · misconceptions", sections: L2_DEEP_SECTIONS, content: <L2DeepDiveContent /> },
];

const host = (id: string, deviceType: string, role: string, port: string, ip: string, mac: string): KitDevice<L2State> => ({ id, deviceType, role, stages: ST.host, ports: () => [{ id: "eth0", neighbor: "ACC-SW", neighborLabel: `ACC-SW ${port}`, linkType: `${ip} · ${mac}` }], knows: () => `${ip} · ${mac}` });
const DEVICES: KitDevice<L2State>[] = [
  { ...host("PC1", "User PC", "DHCP client on Gi1/0/1.", "Gi1/0/1", IP.pc1, MAC.pc1), knows: (s) => `ARP: ${IP.gw} → ${s.pc1ArpGw} · IPv6 router ${s.pc1V6Router}` },
  { ...host("PC2", "User PC", "DHCP client on Gi1/0/2.", "Gi1/0/2", IP.pc2, MAC.pc2), knows: (s) => `Gateway ${s.pc2Gateway ?? "—"}` },
  { ...host("ATK", "Attacker laptop", "In the conference room.", "Gi1/0/5", IP.atk, MAC.atk), ports: (s) => [{ id: "eth0", neighbor: "ACC-SW", neighborLabel: `ACC-SW ${s.atkPort}`, linkType: MAC.atk }] },
  host("PRN", "Printer", "Static address 10.1.10.200.", "Gi1/0/20", IP.prn, MAC.prn),
  { id: "R1", deviceType: "Router", role: "Default gateway and DHCP relay for VLAN 10.", stages: ST.host, ports: () => [{ id: "Gi0/0", neighbor: "ACC-SW", neighborLabel: "ACC-SW Gi1/0/48", linkType: `${IP.gw} · ${MAC.gw}` }], knows: () => "ip helper-address 10.1.99.5" },
  {
    id: "ACC-SW",
    deviceType: "Access switch",
    role: "VLAN 10 users, the printer, conference-room ports and the uplink.",
    stages: ST.sw,
    ports: (s) => [
      { id: "Gi1/0/1", neighbor: "PC1", linkType: "access VLAN 10" },
      { id: "Gi1/0/2", neighbor: "PC2", linkType: s.storm ? "access · storm-control 5%" : "access VLAN 10" },
      { id: "Gi1/0/5", neighbor: s.atkPort === "Gi1/0/5" ? "ATK" : undefined, neighborLabel: "conference room", linkType: s.errDisabled.includes("Gi1/0/5") ? "err-disabled" : "access VLAN 10", up: !s.errDisabled.includes("Gi1/0/5") },
      { id: "Gi1/0/6", neighbor: s.atkPort === "Gi1/0/6" ? "ATK" : undefined, neighborLabel: "conference room", linkType: "access VLAN 10" },
      ...(s.printer ? [{ id: "Gi1/0/20", neighbor: "PRN", linkType: "access VLAN 10" }] : []),
      { id: "Gi1/0/48", neighbor: "R1", linkType: s.trusted.includes("Gi1/0/48") ? "uplink · trusted" : "uplink" },
    ],
    knows: (s) => [s.portSec && "port-security", s.snooping && "snooping", s.dai && "DAI", s.raGuard && "RA Guard", s.storm && "storm-control"].filter(Boolean).join(" · ") || "no L2 security yet",
    tables: (s) => [{ title: "DHCP snooping bindings", rows: s.bindings.map((b) => ({ label: b.port, value: `${b.mac} · ${b.ip}` })) }],
  },
];
const adapters = kitAdapters(DEVICES, "access-port security");

const config: FundamentalsLessonConfig<L2State> = {
  lessonId: "layer2-security",
  xp: 125,
  steps: l2Steps,
  createState: createL2State,
  badge: "CCNA · Security Fundamentals",
  title: "Layer 2 Security",
  intro: "An attacker plugs into a conference-room port. Watch five access-layer attacks work — MAC flooding, a rogue DHCP server, ARP spoofing, a rogue IPv6 router, a broadcast storm — then switch on the control that stops each, and see what the switch shows when it fires.",
  facts: [
    { q: "What is a trusted port?", a: "One whose DHCP server messages and ARPs are not inspected." },
    { q: "What is err-disabled?", a: "A port the switch shut down for a violation." },
    { q: "What is a binding?", a: "A snooping record of MAC, IP, VLAN and port." },
    { q: "What is a router advertisement?", a: "An IPv6 message announcing a router and prefix." },
  ],
  terms: [
    { term: "DHCP snooping", expansion: "DHCP filtering", meaning: "Trusted ports only" },
    { term: "DAI", expansion: "Dynamic ARP inspection", meaning: "Check ARPs" },
    { term: "Port security", expansion: "MAC limit per port", meaning: "Stop floods" },
    { term: "RA Guard", expansion: "Router advertisement guard", meaning: "IPv6 routers" },
    { term: "Storm control", expansion: "Traffic level limit", meaning: "Cap floods" },
  ],
  guide: { title: "Layer 2 Security", subtitle: "PC1 · PC2 · ATK · PRN · ACC-SW · R1", tabs: GUIDE_TABS },
  briefing: { phases: L2_BRIEFING_PHASES, notes: L2_BRIEFING_NOTES },
  nodes: (s) => [
    { id: "PC1", label: "PC1", subLabel: "Gi1/0/1", x: 10, y: 18, kind: "laptop" },
    { id: "PC2", label: "PC2", subLabel: "Gi1/0/2", x: 10, y: 50, kind: "laptop" },
    { id: "ATK", label: "ATK", subLabel: s.atkPort, x: 10, y: 84, kind: "laptop" },
    { id: "ACC-SW", label: "ACC-SW", subLabel: "VLAN 10", x: 46, y: 50, kind: "switch" },
    { id: "R1", label: "R1", subLabel: "gateway · relay", x: 84, y: 30, kind: "router" },
    ...(s.printer ? [{ id: "PRN", label: "PRN", subLabel: "static .200", x: 84, y: 78, kind: "server" as const }] : []),
  ],
  edges: (s) => [
    { id: "p1", a: "PC1", b: "ACC-SW", label: "Gi1/0/1" },
    { id: "p2", a: "PC2", b: "ACC-SW", label: "Gi1/0/2" },
    { id: "atk", a: "ATK", b: "ACC-SW", label: s.atkPort },
    { id: "up", a: "ACC-SW", b: "R1", label: s.trusted.length ? "Gi1/0/48 trusted" : "Gi1/0/48" },
    ...(s.printer ? [{ id: "prn", a: "ACC-SW", b: "PRN", label: "Gi1/0/20" }] : []),
  ],
  enterable: ["ACC-SW"],
  primaryDevice: { "fault-injected": "ACC-SW", "diagnostic-layers": "ACC-SW", "repair-challenge": "ACC-SW" },
  ...adapters,
  callout: kitCallout,
  sidePanel: (s) => <L2Panel s={s} />,
  repair: {
    stepId: "repair-challenge",
    prompt: "DAI drops the statically addressed printer's ARPs. Which change fixes the cause and keeps the protection?",
    options: L2_REPAIR_OPTIONS,
    correctId: L2_REPAIR_CORRECT,
    success: "A static ARP ACL entry tells DAI exactly which IP-MAC pair the printer may claim. The printer works; spoofed ARPs are still dropped.",
    wrongFeedback: {
      trust: "It would work — but a trusted port may send any ARP. Anyone unplugging the printer gets a port that can spoof the gateway.",
      off: "Printing returns, and so does ARP spoofing on the whole VLAN.",
      dhcp: "The printer never uses DHCP; the server has nothing to do with it.",
    },
    attempt: (s) => s.repairAttempt,
  },
  diagnostics: {
    fromStepId: "diagnostic-layers",
    layers: (s) => [
      { label: "Link — Gi1/0/20 up", status: "healthy" },
      { label: "Port security / storm control — no violations on Gi1/0/20", status: "healthy" },
      { label: `DHCP snooping bindings — ${s.bindings.map((b) => b.ip).join(", ")}`, status: "healthy" },
      { label: `DAI — printer ${s.arpAcl.length ? "matched by static ARP ACL" : "has no binding → ARPs dropped"}`, status: s.arpAcl.length ? "healthy" : "failing" },
    ],
  },
  complete: { badge: "Lesson Complete", title: "The access edge is defended", message: "Port security, DHCP snooping, dynamic ARP inspection, RA Guard and storm control — each stopping a real attack — and static ARP entries for hosts DHCP doesn't know." },
};

export default function Layer2SecurityDemo() {
  return <FundamentalsLessonShell config={config} />;
}
