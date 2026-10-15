"use client";

import { FundamentalsLessonShell, type FundamentalsLessonConfig } from "@/components/lesson/FundamentalsLessonShell";
import type { LessonGuideTab } from "@/components/lesson/LessonGuideDialog";
import { kitAdapters, kitCallout, type KitDevice } from "@/components/lesson/ccnaKit";
import { FHRP_REPAIR_CORRECT, FHRP_REPAIR_OPTIONS, ST, VIP, VMAC, createFhrpState, effPrio, fhrpSteps, type FhrpState, type Rid } from "@/lib/sim-engine/scenarios/ccna/fhrp";
import { FhrpPanel } from "./FhrpPanel";
import { FHRP_BRIEFING_NOTES, FHRP_BRIEFING_PHASES, FHRP_DEEP_SECTIONS, FHRP_LESSON_SECTIONS, FhrpDeepDiveContent, FhrpLessonGuideContent } from "./guide";

const GUIDE_TABS: LessonGuideTab[] = [
  { id: "lesson", label: "This Lesson", hint: "Virtual gateway · HSRP vs VRRP vs GLBP · failover · preempt and tracking · a black-holed WAN outage", sections: FHRP_LESSON_SECTIONS, content: <FhrpLessonGuideContent /> },
  { id: "deep", label: "FHRP Deep Dive", hint: "Timers · aligning with STP · misconceptions", sections: FHRP_DEEP_SECTIONS, content: <FhrpDeepDiveContent /> },
];

const rtr = (id: Rid): KitDevice<FhrpState> => ({
  id,
  deviceType: "Gateway router",
  role: `HSRP group 10 member; WAN-${id === "R1" ? "A" : "B"} uplink.`,
  stages: ST.rtr,
  ports: (s) => [
    { id: "Gi0/0", neighbor: "SW1", linkType: `LAN · HSRP 10 · VIP ${VIP}`, ip: `${s.r[id].ip}/24`, up: s.r[id].up },
    { id: "Gi0/1", neighbor: `WAN-${id === "R1" ? "A" : "B"}`, linkType: "WAN", up: s.r[id].up && s.r[id].wanUp },
  ],
  knows: (s) => (s.r[id].up ? `${s.active === id ? "Active" : s.standby === id ? "Standby" : "Init"} · priority ${effPrio(s.r[id])}${s.r[id].preempt ? " · preempt" : ""}` : "Down"),
  tables: (s) => [{ title: `${id} HSRP`, rows: [{ label: "state", value: s.active === id ? "Active" : s.standby === id ? "Standby" : s.r[id].up ? "Listen" : "Init" }, { label: "priority", value: `${effPrio(s.r[id])} (configured ${s.r[id].priority})` }, { label: "preempt", value: s.r[id].preempt ? "yes" : "no" }, { label: "tracking", value: s.r[id].track ? `${s.r[id].track!.iface} −${s.r[id].track!.decrement} (${s.r[id].wanUp ? "up" : "down"})` : "none" }] }],
});
const DEVICES: KitDevice<FhrpState>[] = [
  { id: "PC1", deviceType: "Host", role: `Gateway ${VIP}.`, stages: ST.pc, ports: (s) => [{ id: "eth0", neighbor: "SW1", linkType: "access", ip: "10.1.1.50/24", extra: [["ARP for gateway", s.pcArp ?? "—"]] }], knows: (s) => `Gateway ${VIP} → ${s.pcArp ?? "not resolved"}` },
  { id: "SW1", deviceType: "Access switch", role: "Learns the virtual MAC on the active router's port.", stages: ST.sw, ports: () => [{ id: "Gi1/0/1", neighbor: "PC1", linkType: "access" }, { id: "Gi1/0/23", neighbor: "R1", linkType: "access" }, { id: "Gi1/0/24", neighbor: "R2", linkType: "access" }], knows: (s) => (s.vmacOn ? `${VMAC} on ${s.vmacOn}'s port` : "virtual MAC not learned yet") },
  rtr("R1"),
  rtr("R2"),
  { id: "WAN-A", deviceType: "ISP", role: "R1's uplink.", stages: ST.sw, ports: () => [], knows: () => "—" },
  { id: "WAN-B", deviceType: "ISP", role: "R2's uplink.", stages: ST.sw, ports: () => [], knows: () => "—" },
];
const adapters = kitAdapters(DEVICES, "first-hop redundancy");

const config: FundamentalsLessonConfig<FhrpState> = {
  lessonId: "fhrp-hsrp-vrrp",
  xp: 150,
  steps: fhrpSteps,
  createState: createFhrpState,
  badge: "CCNA · IP Connectivity",
  title: "First Hop Redundancy: HSRP & VRRP",
  intro: "Give a subnet a default gateway that survives a router failure. Elect an active router for a shared virtual IP and MAC, watch traffic move after the hold time and come back with preempt — then fix a WAN outage that tracking noticed and nothing acted on.",
  facts: [
    { q: "What do hosts use as gateway?", a: `A virtual IP (${VIP}) owned by whichever router is active.` },
    { q: "Do hosts notice a failover?", a: "No — the virtual MAC stays the same." },
    { q: "HSRP or VRRP?", a: "HSRP is Cisco's; VRRP is the open standard. Same idea." },
    { q: "What does tracking do?", a: "Lowers a router's priority when its uplink fails." },
  ],
  terms: [
    { term: "FHRP", expansion: "First hop redundancy protocol", meaning: "Shared gateway" },
    { term: "VIP", expansion: "Virtual IP", meaning: "Hosts' gateway" },
    { term: "Active / Standby", expansion: "HSRP roles", meaning: "Forwards / waits" },
    { term: "Preempt", expansion: "Take-over permission", meaning: "Higher priority wins" },
    { term: "Track", expansion: "Object tracking", meaning: "Priority − n on failure" },
  ],
  guide: { title: "First Hop Redundancy: HSRP & VRRP", subtitle: `PC1 · SW1 · R1 + R2 · VIP ${VIP} · group 10`, tabs: GUIDE_TABS },
  briefing: { phases: FHRP_BRIEFING_PHASES, notes: FHRP_BRIEFING_NOTES },
  nodes: (s) => [
    { id: "PC1", label: "PC1", subLabel: `gw ${VIP}`, x: 8, y: 50, kind: "laptop" },
    { id: "SW1", label: "SW1", x: 30, y: 50, kind: "switch" },
    { id: "R1", label: "R1", subLabel: s.r.R1.up ? `${s.active === "R1" ? "Active" : s.standby === "R1" ? "Standby" : "—"} · p${effPrio(s.r.R1)}` : "down", x: 56, y: 26, kind: "router" },
    { id: "R2", label: "R2", subLabel: s.r.R2.up ? `${s.active === "R2" ? "Active" : s.standby === "R2" ? "Standby" : "—"} · p${effPrio(s.r.R2)}` : "down", x: 56, y: 74, kind: "router" },
    { id: "WAN-A", label: "WAN-A", x: 88, y: 26, kind: "cloud" },
    { id: "WAN-B", label: "WAN-B", x: 88, y: 74, kind: "cloud" },
  ],
  edges: (s) => [
    { id: "pc", a: "PC1", b: "SW1" },
    { id: "r1", a: "SW1", b: "R1", label: "10.1.1.2", down: !s.r.R1.up },
    { id: "r2", a: "SW1", b: "R2", label: "10.1.1.3" },
    { id: "wa", a: "R1", b: "WAN-A", label: "Gi0/1", down: !s.r.R1.up || !s.r.R1.wanUp },
    { id: "wb", a: "R2", b: "WAN-B", label: "Gi0/1" },
  ],
  regions: [{ id: "vip", label: `virtual gateway ${VIP} · ${VMAC}`, x: 44, y: 8, width: 24, height: 84, tone: "violet" }],
  enterable: ["R1", "R2", "PC1"],
  primaryDevice: { hello: "R1", election: "R1", "host-arp": "R1", traffic: "R1", failover: "R2", restore: "R1", "fault-injected": "R1", "inc-down": "R1", "diagnostic-layers": "R2", "repair-challenge": "R2", verify: "R2" },
  ...adapters,
  callout: kitCallout,
  sidePanel: (s) => <FhrpPanel s={s} />,
  repair: {
    stepId: "repair-challenge",
    prompt: "R1 lost its WAN and dropped to priority 90, yet it stays active and drops all traffic. Which change fixes the cause?",
    options: FHRP_REPAIR_OPTIONS,
    correctId: FHRP_REPAIR_CORRECT,
    success: "With preempt, R2 (100) takes over from R1 (90) immediately and forwards everyone out its healthy WAN link.",
    wrongFeedback: {
      prio: "R1 would stay active even longer: 150 − 20 = 130 beats R2's 100.",
      notrack: "Then R1 keeps priority 110 when its WAN fails — still active, still black-holing.",
      hosts: "That defeats the point of a virtual gateway and breaks again when R2 fails.",
    },
    attempt: (s) => s.repairAttempt,
  },
  diagnostics: {
    fromStepId: "diagnostic-layers",
    layers: (s) => [
      { label: `Hosts — gateway ${VIP}, ARP ${s.pcArp ?? "—"}`, status: "healthy" },
      { label: `HSRP — active ${s.active}, standby ${s.standby}`, status: "healthy" },
      { label: `Priorities — R1 ${effPrio(s.r.R1)}, R2 ${effPrio(s.r.R2)}`, status: "healthy" },
      { label: `Preempt on R2 — ${s.r.R2.preempt ? "yes" : "no"}`, status: s.r.R2.preempt ? "healthy" : "failing" },
      { label: `Active router can route out — ${s.active && s.r[s.active].wanUp ? "yes" : "no (WAN down)"}`, status: s.active && s.r[s.active].wanUp ? "healthy" : "failing" },
    ],
  },
  complete: { badge: "Lesson Complete", title: "Your gateway can survive a failure", message: "A virtual IP and MAC, active and standby by priority, failover after the hold time, preempt to let a better router take over — and tracking that only works when the other router may preempt." },
};

export default function FhrpDemo() {
  return <FundamentalsLessonShell config={config} />;
}
