"use client";

import { FundamentalsLessonShell, type FundamentalsLessonConfig } from "@/components/lesson/FundamentalsLessonShell";
import type { LessonGuideTab } from "@/components/lesson/LessonGuideDialog";
import { kitAdapters, kitCallout, type KitDevice } from "@/components/lesson/ccnaKit";
import { IFACES, SR_REPAIR_CORRECT, SR_REPAIR_OPTIONS, ST, contenders, createSrState, rib, routeText, staticSteps, type SrState } from "@/lib/sim-engine/scenarios/ccna/staticRouting";
import { SrPanel } from "./SrPanel";
import { SR_BRIEFING_NOTES, SR_BRIEFING_PHASES, SR_DEEP_SECTIONS, SR_LESSON_SECTIONS, SrDeepDiveContent, SrLessonGuideContent } from "./guide";

const GUIDE_TABS: LessonGuideTab[] = [
  { id: "lesson", label: "This Lesson", hint: "Route fields · AD vs longest match · default, host, floating · IPv6 statics · a backup that won", sections: SR_LESSON_SECTIONS, content: <SrLessonGuideContent /> },
  { id: "deep", label: "Static Routing Deep Dive", hint: "AD tables (Cisco and Junos) · next-hop styles · tracking · misconceptions", sections: SR_DEEP_SECTIONS, content: <SrDeepDiveContent /> },
];

const peer = (id: string, role: string): KitDevice<SrState> => ({ id, deviceType: "Router", role, stages: ST.peer, ports: () => [], knows: () => role });
const DEVICES: KitDevice<SrState>[] = [
  {
    id: "R1",
    deviceType: "Edge router",
    role: "Two ISPs, an MPLS WAN to the branch (OSPF) and an LTE router for emergencies.",
    stages: ST.r1,
    ports: (s) => Object.entries(IFACES).map(([id, i]) => ({ id, neighbor: i.to, linkType: `${i.net}/${i.len}`, ip: i.ip, up: s.ifUp[id] })),
    knows: (s) => `${rib(s).length} IPv4 routes · default via ${rib(s).find((r) => r.len === 0)?.via ?? "none"}`,
    tables: (s) => [
      { title: "R1 routing table (IPv4)", rows: rib(s).filter((r) => r.proto !== "L").map((r) => ({ label: `${r.proto}${r.len === 0 ? "*" : ""} ${r.prefix}/${r.len}`, value: routeText(r).split(" ").slice(2).join(" ") })) },
      { title: "Contenders for 10.50.0.0/16", rows: contenders(s, "10.50.0.0", 16).map(({ c, installed }) => ({ label: `${c.proto} AD ${c.ad} via ${c.via}`, value: installed ? "installed" : "not installed" })) },
    ],
  },
  { id: "LAN", deviceType: "LAN", role: "Users on 10.1.1.0/24.", stages: ST.peer, ports: () => [], knows: () => "10.1.1.0/24" },
  peer("ISP-A", "Primary internet provider"),
  peer("ISP-B", "Secondary internet provider"),
  peer("WAN", "MPLS provider edge — OSPF neighbour toward the branch"),
  peer("LTE", "Cellular router — emergency path to the branch"),
  { id: "INTERNET", deviceType: "Internet", role: "8.8.8.8, 192.0.2.10 and the rest.", stages: ST.peer, ports: () => [], knows: () => "—" },
  { id: "BRANCH", deviceType: "Branch site", role: "10.50.0.0/16.", stages: ST.peer, ports: () => [], knows: () => "10.50.0.0/16" },
];
const adapters = kitAdapters(DEVICES, "routing decision");

const config: FundamentalsLessonConfig<SrState> = {
  lessonId: "static-routing-floating-ipv6",
  xp: 150,
  steps: staticSteps,
  createState: createSrState,
  badge: "CCNA · IP Connectivity",
  title: "Static Routes: Floating, Host & IPv6",
  intro: "Read a routing table field by field, watch longest-prefix match choose between a default and a host route, and build a floating backup that waits behind administrative distance — in IPv4 and IPv6. Then fix a ‘backup’ that quietly stole every branch packet.",
  facts: [
    { q: "What is a host route?", a: "A route to one address: /32 in IPv4, /128 in IPv6." },
    { q: "Do static routes adapt?", a: "Only to their own exit interface going down — nothing else." },
    { q: "What is the gateway of last resort?", a: "The next hop of the default route, 0.0.0.0/0." },
    { q: "What's different in IPv6?", a: "Syntax only — and link-local next hops need an interface." },
  ],
  terms: [
    { term: "AD", expansion: "Administrative distance", meaning: "Trust per source" },
    { term: "LPM", expansion: "Longest prefix match", meaning: "Per-packet choice" },
    { term: "S*", expansion: "Static candidate default", meaning: "0.0.0.0/0" },
    { term: "Host route", expansion: "/32 (IPv4) or /128", meaning: "One destination" },
    { term: "Floating", expansion: "Static with high AD", meaning: "Waits as backup" },
  ],
  guide: { title: "Static Routes: Floating, Host & IPv6", subtitle: "R1 · ISP-A · ISP-B · MPLS WAN (OSPF) · LTE · branch 10.50.0.0/16", tabs: GUIDE_TABS },
  briefing: { phases: SR_BRIEFING_PHASES, notes: SR_BRIEFING_NOTES },
  nodes: (s) => [
    { id: "LAN", label: "LAN", subLabel: "10.1.1.0/24", x: 6, y: 50, kind: "laptop" },
    { id: "R1", label: "R1", subLabel: "edge", x: 30, y: 50, kind: "router" },
    { id: "ISP-A", label: "ISP-A", subLabel: s.ifUp["Gi0/1"] ? "primary" : "down", x: 58, y: 12, kind: "router" },
    { id: "ISP-B", label: "ISP-B", subLabel: "secondary", x: 58, y: 36, kind: "router" },
    { id: "WAN", label: "WAN", subLabel: s.ifUp["Gi0/3"] ? "MPLS · OSPF" : "down", x: 58, y: 64, kind: "router" },
    { id: "LTE", label: "LTE", subLabel: "backup", x: 58, y: 90, kind: "router" },
    { id: "INTERNET", label: "INTERNET", x: 90, y: 24, kind: "cloud" },
    { id: "BRANCH", label: "BRANCH", subLabel: "10.50.0.0/16", x: 90, y: 76, kind: "cloud" },
  ],
  edges: (s) => [
    { id: "lan", a: "LAN", b: "R1", label: "Gi0/0" },
    { id: "a", a: "R1", b: "ISP-A", label: "Gi0/1", down: !s.ifUp["Gi0/1"] },
    { id: "b", a: "R1", b: "ISP-B", label: "Gi0/2" },
    { id: "w", a: "R1", b: "WAN", label: "Gi0/3", down: !s.ifUp["Gi0/3"] },
    { id: "l", a: "R1", b: "LTE", label: "Gi0/4" },
    { id: "ai", a: "ISP-A", b: "INTERNET" },
    { id: "bi", a: "ISP-B", b: "INTERNET" },
    { id: "wb", a: "WAN", b: "BRANCH" },
    { id: "lb", a: "LTE", b: "BRANCH" },
  ],
  enterable: ["R1"],
  primaryDevice: Object.fromEntries(staticSteps.map((st) => [st.id, "R1"])),
  ...adapters,
  callout: kitCallout,
  sidePanel: (s) => <SrPanel s={s} />,
  repair: {
    stepId: "repair-challenge",
    prompt: "A static ‘backup’ with AD 5 is carrying all branch traffic over LTE. Which change fixes the cause?",
    options: SR_REPAIR_OPTIONS,
    correctId: SR_REPAIR_CORRECT,
    success: "AD 250 is above OSPF's 110, so the OSPF route is installed while the WAN is up — and the static still takes over if it fails.",
    wrongFeedback: {
      "remove-ospf": "Then the static would be the only route — LTE forever, and no dynamic routing to the branch.",
      cost: "OSPF cost only competes with other OSPF routes. Against a static, AD decides, and 5 beats 110 whatever the cost.",
      "more-specific": "It would steer traffic (longest match), but it's a workaround that must be maintained per subnet and breaks the backup for those subnets.",
    },
    attempt: (s) => s.repairAttempt,
  },
  diagnostics: {
    fromStepId: "diagnostic-layers",
    layers: (s) => {
      const inst = rib(s).find((r) => r.prefix === "10.50.0.0" && r.len === 16);
      return [
        { label: `WAN link and OSPF neighbour — ${s.ifUp["Gi0/3"] ? "up / FULL" : "down"}`, status: s.ifUp["Gi0/3"] ? "healthy" : "failing" },
        { label: "OSPF database — 10.50.0.0/16, cost 20", status: "healthy" },
        { label: `Installed route — ${inst ? routeText(inst) : "none"}`, status: inst?.proto === "O" ? "healthy" : "failing" },
        { label: `Path — ${inst ? IFACES[inst.iface].to : "—"}`, status: inst?.proto === "O" ? "healthy" : "failing" },
      ];
    },
  },
  complete: { badge: "Lesson Complete", title: "You can write routes that behave", message: "Every field of a route; AD to install and longest match to forward; default, network, host and floating statics in IPv4 and IPv6 — and a backup that stays a backup." },
};

export default function StaticRoutingDemo() {
  return <FundamentalsLessonShell config={config} />;
}
