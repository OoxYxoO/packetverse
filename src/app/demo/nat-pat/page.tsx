"use client";

import { FundamentalsLessonShell, type FundamentalsLessonConfig } from "@/components/lesson/FundamentalsLessonShell";
import type { LessonGuideTab } from "@/components/lesson/LessonGuideDialog";
import { kitAdapters, kitCallout, type KitDevice } from "@/components/lesson/ccnaKit";
import { NAT_REPAIR_CORRECT, NAT_REPAIR_OPTIONS, OUTSIDE_IP, ST, WEB, createNatState, natSteps, permitted, type NatState } from "@/lib/sim-engine/scenarios/ccna/natPat";
import { NatPanel } from "./NatPanel";
import { NAT_BRIEFING_NOTES, NAT_BRIEFING_PHASES, NAT_DEEP_SECTIONS, NAT_LESSON_SECTIONS, NatDeepDiveContent, NatLessonGuideContent } from "./guide";

const GUIDE_TABS: LessonGuideTab[] = [
  { id: "lesson", label: "This Lesson", hint: "Inside/outside, local/global · static, dynamic, PAT · the translation table · an untranslated subnet", sections: NAT_LESSON_SECTIONS, content: <NatLessonGuideContent /> },
  { id: "deep", label: "NAT Deep Dive", hint: "Ports per address · what NAT breaks · misconceptions", sections: NAT_DEEP_SECTIONS, content: <NatDeepDiveContent /> },
];

const host = (id: string, ip: string): KitDevice<NatState> => ({ id, deviceType: "Host", role: `Inside host ${ip}.`, stages: ST.host, ports: () => [{ id: "eth0", neighbor: "R1", linkType: "inside", ip }], knows: (s) => (permitted(s, ip) ? "Permitted by ACL 1" : "Not in ACL 1") });
const DEVICES: KitDevice<NatState>[] = [
  host("PC1", "10.1.1.10"),
  host("PC2", "10.1.1.11"),
  host("PC3", "10.1.1.12"),
  host("PC4", "10.1.2.20"),
  { id: "WEB", deviceType: "Web server", role: `Published as ${WEB.global}.`, stages: ST.host, ports: () => [{ id: "eth0", neighbor: "R1", linkType: "inside", ip: WEB.local }], knows: () => `static NAT ${WEB.local} ↔ ${WEB.global}` },
  {
    id: "R1",
    deviceType: "Border router",
    role: "NAT between the office (inside) and the ISP (outside).",
    stages: ST.r1,
    ports: () => [
      { id: "Gi0/0", neighbor: "PC1", linkType: "ip nat inside · 10.1.1.0/24", ip: "10.1.1.1" },
      { id: "Gi0/2", neighbor: "PC4", linkType: "ip nat inside · 10.1.2.0/24", ip: "10.1.2.1" },
      { id: "Gi0/1", neighbor: "ISP", linkType: "ip nat outside", ip: OUTSIDE_IP },
    ],
    knows: (s) => `${s.table.length} translation(s) · mode ${s.mode}`,
    tables: (s) => [{ title: "R1 NAT translations", rows: s.table.map((x) => ({ label: `${x.kind} ${x.insideLocal}`, value: `→ ${x.insideGlobal}` })) }, { title: "ACL 1", rows: s.acl.map(([p, l]) => ({ label: "permit", value: `${p}/${l}` })) }],
  },
  { id: "ISP", deviceType: "Internet provider", role: "Routes 203.0.113.0/29 to R1; drops private sources.", stages: ST.isp, ports: () => [], knows: () => "Drops RFC 1918 sources" },
  { id: "INTERNET", deviceType: "Internet", role: "Websites and customers.", stages: ST.host, ports: () => [], knows: () => "198.51.100.0/24" },
];
const adapters = kitAdapters(DEVICES, "NAT pipeline");

const config: FundamentalsLessonConfig<NatState> = {
  lessonId: "nat-pat",
  xp: 150,
  steps: natSteps,
  createState: createNatState,
  badge: "CCNA · IP Services",
  title: "NAT & PAT",
  intro: "Translate private addresses at the border. Publish a server with static NAT, run out of a dynamic pool, share one public address among everyone with PAT, and follow replies home through the translation table — then fix a new subnet that leaves the router untranslated.",
  facts: [
    { q: "Why NAT?", a: "Private addresses aren't routed on the internet, and public ones are scarce." },
    { q: "Which NAT works inbound?", a: "Static NAT — the mapping exists before any packet." },
    { q: "How does PAT tell hosts apart?", a: "By source port on the shared address." },
    { q: "Where does NAT happen?", a: "On the border router, between interfaces marked inside and outside." },
  ],
  terms: [
    { term: "Inside local", expansion: "Real inside address", meaning: "10.1.1.10" },
    { term: "Inside global", expansion: "Translated address", meaning: "203.0.113.2:port" },
    { term: "PAT", expansion: "Port address translation", meaning: "Overload" },
    { term: "Static NAT", expansion: "Permanent 1:1", meaning: "Publish servers" },
    { term: "Pool", expansion: "Dynamic addresses", meaning: "1 host each" },
  ],
  guide: { title: "NAT & PAT", subtitle: `inside 10.1.1.0/24 + 10.1.2.0/24 · R1 · outside ${OUTSIDE_IP} · ISP`, tabs: GUIDE_TABS },
  briefing: { phases: NAT_BRIEFING_PHASES, notes: NAT_BRIEFING_NOTES },
  nodes: () => [
    { id: "PC1", label: "PC1", subLabel: "10.1.1.10", x: 8, y: 14, kind: "laptop" },
    { id: "PC2", label: "PC2", subLabel: "10.1.1.11", x: 8, y: 36, kind: "laptop" },
    { id: "PC3", label: "PC3", subLabel: "10.1.1.12", x: 8, y: 58, kind: "laptop" },
    { id: "WEB", label: "WEB", subLabel: WEB.local, x: 24, y: 86, kind: "server" },
    { id: "PC4", label: "PC4", subLabel: "10.1.2.20 · new floor", x: 8, y: 86, kind: "laptop" },
    { id: "R1", label: "R1", subLabel: "NAT", x: 44, y: 50, kind: "router" },
    { id: "ISP", label: "ISP", subLabel: "203.0.113.1", x: 68, y: 50, kind: "router" },
    { id: "INTERNET", label: "INTERNET", subLabel: "198.51.100.0/24", x: 92, y: 50, kind: "cloud" },
  ],
  edges: () => [
    { id: "p1", a: "PC1", b: "R1" },
    { id: "p2", a: "PC2", b: "R1" },
    { id: "p3", a: "PC3", b: "R1" },
    { id: "w", a: "WEB", b: "R1" },
    { id: "p4", a: "PC4", b: "R1", label: "Gi0/2" },
    { id: "isp", a: "R1", b: "ISP", label: "outside" },
    { id: "net", a: "ISP", b: "INTERNET" },
  ],
  regions: [
    { id: "in", label: "inside (private)", x: 1, y: 4, width: 34, height: 92, tone: "cyan" },
    { id: "out", label: "outside (public)", x: 56, y: 4, width: 43, height: 92, tone: "warning" },
  ],
  enterable: ["R1"],
  primaryDevice: Object.fromEntries(natSteps.map((st) => [st.id, "R1"])),
  ...adapters,
  callout: kitCallout,
  sidePanel: (s) => <NatPanel s={s} />,
  repair: {
    stepId: "repair-challenge",
    prompt: "The new floor's packets leave R1 with private sources. Which change fixes the cause?",
    options: NAT_REPAIR_OPTIONS,
    correctId: NAT_REPAIR_CORRECT,
    success: "ACL 1 now permits 10.1.2.0/24, so the new floor's flows are translated to 203.0.113.2 and routed by the ISP.",
    wrongFeedback: {
      static: "That would burn a public address per host — and there are only four. PAT already shares one; it just needs to select the subnet.",
      pool: "PAT isn't short of ports or addresses; the new subnet never reaches the translation step.",
      inside: "Gi0/1 faces the ISP: it must stay ip nat outside, or nothing at all would translate.",
    },
    attempt: (s) => s.repairAttempt,
  },
  diagnostics: {
    fromStepId: "diagnostic-layers",
    layers: (s) => [
      { label: "PC4 → gateway 10.1.2.1 — reachable", status: "healthy" },
      { label: "Interfaces — Gi0/0, Gi0/2 inside · Gi0/1 outside", status: "healthy" },
      { label: `ACL 1 — ${s.acl.map(([p, l]) => `${p}/${l}`).join(", ")}`, status: permitted(s, "10.1.2.20") ? "healthy" : "failing" },
      { label: `Translation for 10.1.2.20 — ${s.table.some((x) => x.insideLocal.startsWith("10.1.2.20")) ? "present" : "none"}`, status: s.table.some((x) => x.insideLocal.startsWith("10.1.2.20")) ? "healthy" : "failing" },
      { label: `Source seen by the ISP — ${permitted(s, "10.1.2.20") ? OUTSIDE_IP : "10.1.2.20 (dropped)"}`, status: permitted(s, "10.1.2.20") ? "healthy" : "failing" },
    ],
  },
  complete: { badge: "Lesson Complete", title: "You can translate at the border", message: "Inside local and global, static NAT for servers, dynamic pools that run dry, PAT sharing one address by port — and the ACL that decides who gets translated." },
};

export default function NatPatDemo() {
  return <FundamentalsLessonShell config={config} />;
}
