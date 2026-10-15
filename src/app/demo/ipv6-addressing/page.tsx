"use client";

import { FundamentalsLessonShell, type FundamentalsLessonConfig } from "@/components/lesson/FundamentalsLessonShell";
import type { LessonGuideTab } from "@/components/lesson/LessonGuideDialog";
import { kitAdapters, kitCallout, type KitDevice } from "@/components/lesson/ccnaKit";
import { PC1_LLA, ST, V6, V6_REPAIR_CORRECT, V6_REPAIR_OPTIONS, classify, compress, createV6State, ipv6Steps, solicitedNode, type V6State } from "@/lib/sim-engine/scenarios/ccna/ipv6Addr";
import { V6_BRIEFING_NOTES, V6_BRIEFING_PHASES } from "./briefing";
import { V6Panel } from "./V6Panel";
import { V6_LESSON_SECTIONS, V6LessonGuideContent } from "./LessonGuideContent";
import { V6_DEEP_DIVE_SECTIONS, V6DeepDiveContent } from "./DeepDiveContent";

const GUIDE_TABS: LessonGuideTab[] = [
  { id: "lesson", label: "This Lesson", hint: "Notation · address types · EUI-64 · SLAAC and neighbor discovery · a router that won't advertise", sections: V6_LESSON_SECTIONS, content: <V6LessonGuideContent /> },
  { id: "deep", label: "IPv6 Addressing Deep Dive", hint: "Header changes · prefix planning · DHCPv6 modes · multicast groups · failure signatures", sections: V6_DEEP_DIVE_SECTIONS, content: <V6DeepDiveContent /> },
];

const LAN = `${compress(V6.lan)}/64`;
const SRVNET = `${compress(V6.srvNet)}/64`;

const DEVICES: KitDevice<V6State>[] = [
  {
    id: "PC1",
    deviceType: "IPv6 host",
    role: "Configures itself with SLAAC; finds neighbors and routers with ICMPv6.",
    stages: ST.host,
    ports: (s) => [{ id: "eth0", neighbor: "SW1", linkType: "Ethernet", ip: [s.pc1.linkLocal, s.pc1.gua].filter(Boolean).join(" · ") || "no address", extra: [["MAC", V6.pc1Mac]] }],
    knows: (s) => (s.pc1.gua ? `GUA ${s.pc1.gua} · default router ${s.pc1.defaultRouter}` : s.pc1.linkLocal ? `Only ${s.pc1.linkLocal} — no global address, no default router` : "No address yet"),
    tables: (s) => [
      { title: "PC1 IPv6 addresses", rows: [s.pc1.linkLocal, s.pc1.gua].filter((a): a is string => !!a).map((a) => ({ label: classify(a), value: a })) },
      { title: "PC1 multicast groups", rows: s.pc1.groups.map((g) => ({ label: g === "ff02::1" ? "all nodes" : "solicited-node", value: g })) },
      { title: "PC1 routing", rows: [{ label: "on-link", value: s.pc1.prefixes.map((p) => `${compress(p)}/64`).join(", ") || "none" }, { label: "default router", value: s.pc1.defaultRouter ?? "none" }] },
      { title: "PC1 neighbor cache", rows: Object.entries(s.pc1.neighbors).map(([a, m]) => ({ label: a, value: m })) },
    ],
  },
  { id: "SW1", deviceType: "Layer 2 switch", role: "Forwards frames; multicast frames are flooded within the VLAN (unless MLD snooping is on).", stages: ST.sw, ports: () => [{ id: "Gi1/0/1", neighbor: "PC1", linkType: "access" }, { id: "Gi1/0/24", neighbor: "R1", linkType: "access" }], knows: () => "Doesn't read IPv6 at all" },
  {
    id: "R1",
    deviceType: "Router",
    role: "Default router for the LAN; sends Router Advertisements and forwards IPv6 — when IPv6 routing is enabled.",
    stages: ST.router,
    ports: () => [
      { id: "Gi0/0", neighbor: "SW1", linkType: `LAN ${LAN}`, ip: `${compress(V6.r1Gua0)}/64 · ${V6.r1Lla}`, extra: [["MAC", V6.r1Mac0]] },
      { id: "Gi0/1", neighbor: "SERVER", linkType: `servers ${SRVNET}`, ip: `${compress(V6.r1Gua1)}/64`, extra: [["MAC", V6.r1Mac1]] },
    ],
    knows: (s) => (s.r1Routing ? "IPv6 unicast routing ON · sending RAs on Gi0/0" : "IPv6 unicast routing OFF — host behaviour, no RAs"),
    tables: (s) => [
      { title: "R1 IPv6 routing table", rows: s.r1Routing ? [{ label: `C ${LAN}`, value: "Gi0/0" }, { label: `L ${compress(V6.r1Gua0)}/128`, value: "Gi0/0" }, { label: `C ${SRVNET}`, value: "Gi0/1" }, { label: `L ${compress(V6.r1Gua1)}/128`, value: "Gi0/1" }] : [{ label: "—", value: "not routing IPv6" }] },
      { title: "R1 groups on Gi0/0", rows: [{ label: "ff02::1", value: "all nodes" }, ...(s.r1Routing ? [{ label: "ff02::2", value: "all routers" }] : []), { label: solicitedNode(V6.r1Lla), value: "for fe80::1" }] },
      { title: "R1 neighbor cache", rows: Object.entries(s.r1Neighbors).map(([a, m]) => ({ label: a, value: m })) },
    ],
  },
  { id: "SERVER", deviceType: "Server", role: `Static address on ${SRVNET}.`, stages: ST.server, ports: () => [{ id: "eth0", neighbor: "R1", linkType: "Ethernet", ip: `${V6.srv}/64` }], knows: () => `${V6.srv} · gateway ${V6.r1Lla}` },
];
const adapters = kitAdapters(DEVICES, "IPv6 pipeline");

const config: FundamentalsLessonConfig<V6State> = {
  lessonId: "ipv6-addressing",
  xp: 175,
  steps: ipv6Steps,
  createState: createV6State,
  badge: "CCNA · Network Fundamentals",
  title: "IPv6 Addressing",
  intro: "Follow PC1 from power-on to a ping across a router: link-local by EUI-64, duplicate address detection, Router Solicitation and Advertisement, SLAAC and neighbor discovery. Name every address type — then fix a router that has every address configured but leaves its LAN stranded.",
  facts: [
    { q: "How do you shorten an address?", a: "Drop leading zeros; replace one longest run of zero groups with ::." },
    { q: "Which address does every interface have?", a: "A link-local address in fe80::/10." },
    { q: "What is EUI-64?", a: "An interface ID made from a MAC: flip bit 7, insert ff:fe in the middle." },
    { q: "Is there broadcast?", a: "No. Multicast groups, including solicited-node, do that job." },
  ],
  terms: [
    { term: "GUA", expansion: "Global unicast address", meaning: "2000::/3, routable" },
    { term: "LLA", expansion: "Link-local address", meaning: "fe80::/10, this link" },
    { term: "SLAAC", expansion: "Stateless autoconfiguration", meaning: "Prefix + own ID" },
    { term: "RS / RA", expansion: "Router Solicitation / Advertisement", meaning: "Find routers, prefixes" },
    { term: "NS / NA", expansion: "Neighbor Solicitation / Advertisement", meaning: "IPv6's ARP" },
  ],
  guide: { title: "IPv6 Addressing", subtitle: `PC1 · SW1 · R1 · SERVER · ${LAN} · ${SRVNET}`, tabs: GUIDE_TABS },
  briefing: { phases: V6_BRIEFING_PHASES, notes: V6_BRIEFING_NOTES },
  nodes: (s) => [
    { id: "PC1", label: "PC1", subLabel: s.pc1.gua ? "SLAAC" : s.pc1.linkLocal ? "link-local only" : "booting", x: 10, y: 50, kind: "laptop" },
    { id: "SW1", label: "SW1", x: 33, y: 50, kind: "switch" },
    { id: "R1", label: "R1", subLabel: V6.r1Lla, x: 58, y: 50, kind: "router" },
    { id: "SERVER", label: "SERVER", subLabel: compress(V6.srv), x: 88, y: 50, kind: "server" },
  ],
  edges: () => [
    { id: "pc-sw", a: "PC1", b: "SW1" },
    { id: "sw-r1", a: "SW1", b: "R1", label: `Gi0/0 · ${LAN}` },
    { id: "r1-srv", a: "R1", b: "SERVER", label: `Gi0/1 · ${SRVNET}` },
  ],
  regions: [
    { id: "lan", label: `LAN ${LAN}`, x: 2, y: 28, width: 62, height: 44, tone: "cyan" },
    { id: "srv", label: `servers ${SRVNET}`, x: 66, y: 28, width: 32, height: 44, tone: "violet" },
  ],
  enterable: ["PC1", "R1"],
  primaryDevice: { "link-local": "PC1", dad: "PC1", rs: "PC1", ra: "R1", slaac: "PC1", "address-types": "PC1", "ping-start": "PC1", na: "R1", echo: "PC1", "r1-routes": "R1", "server-replies": "SERVER", "fault-injected": "R1", "inc-rs": "PC1", "inc-no-ra": "R1", "inc-ping": "PC1", "diagnostic-layers": "R1", "repair-challenge": "R1", "verify-ra": "R1", "verify-ping": "R1" },
  ...adapters,
  callout: kitCallout,
  sidePanel: (s) => <V6Panel s={s} />,
  repair: {
    stepId: "repair-challenge",
    prompt: "R1 has its addresses but PC1 gets no Router Advertisement. Which change fixes the cause?",
    options: V6_REPAIR_OPTIONS,
    correctId: V6_REPAIR_CORRECT,
    success: "R1 joins ff02::2, answers Router Solicitations and forwards IPv6 again. PC1 rebuilds its global address and finds its default router.",
    wrongFeedback: {
      prefix48: "LANs must be /64 for SLAAC — a /48 would stop autoconfiguration even with RAs. And no RAs are being sent at all.",
      "static-pc": "PC1 would have an address but still no default router — and every other host on the LAN would still be stranded.",
      reboot: "PC1 already asked (RS) and got silence. Asking again changes nothing on R1.",
    },
    attempt: (s) => s.repairAttempt,
  },
  diagnostics: {
    fromStepId: "diagnostic-layers",
    layers: (s) => [
      { label: "Link — PC1 ↔ SW1 ↔ R1 Gi0/0 up", status: "healthy" },
      { label: `PC1 link-local — ${s.pc1.linkLocal ?? PC1_LLA}`, status: "healthy" },
      { label: `R1 addresses — ${compress(V6.r1Gua0)}/64, ${V6.r1Lla}`, status: "healthy" },
      { label: `R1 IPv6 routing — ${s.r1Routing ? "enabled" : "disabled"}`, status: s.r1Routing ? "healthy" : "failing" },
      { label: `Router Advertisements — ${s.r1Routing ? "sent" : "none"}`, status: s.r1Routing ? "healthy" : "failing" },
      { label: `PC1 global address and gateway — ${s.pc1.gua ? `${s.pc1.gua} via ${s.pc1.defaultRouter}` : "none"}`, status: s.pc1.gua ? "healthy" : "unknown" },
    ],
  },
  complete: { badge: "Lesson Complete", title: "You can read, build and verify IPv6 addresses", message: "Compressed notation, link-local by EUI-64, SLAAC from a Router Advertisement, neighbor discovery without broadcast, every address type — and a router that must be routing before it will advertise." },
};

export default function Ipv6AddressingDemo() {
  return <FundamentalsLessonShell config={config} />;
}
