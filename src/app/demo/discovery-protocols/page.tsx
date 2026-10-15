"use client";

import { FundamentalsLessonShell, type FundamentalsLessonConfig } from "@/components/lesson/FundamentalsLessonShell";
import type { LessonGuideTab } from "@/components/lesson/LessonGuideDialog";
import { kitAdapters, kitCallout, type KitDevice } from "@/components/lesson/ccnaKit";
import { DISC_REPAIR_CORRECT, DISC_REPAIR_OPTIONS, PEERS, ST, VOICE, createDiscState, discoverySteps, neighbors, type DiscState } from "@/lib/sim-engine/scenarios/ccna/discovery";
import { DISC_BRIEFING_NOTES, DISC_BRIEFING_PHASES } from "./briefing";
import { DiscPanel } from "./DiscPanel";
import { DISC_DEEP_SECTIONS, DISC_LESSON_SECTIONS, DiscDeepDiveContent, DiscLessonGuideContent } from "./LessonGuideContent";

const GUIDE_TABS: LessonGuideTab[] = [
  { id: "lesson", label: "This Lesson", hint: "CDP vs LLDP · neighbour tables · holdtime · LLDP-MED · where to disable", sections: DISC_LESSON_SECTIONS, content: <DiscLessonGuideContent /> },
  { id: "deep", label: "Discovery Deep Dive", hint: "TLVs · uses beyond documentation · misconceptions", sections: DISC_DEEP_SECTIONS, content: <DiscDeepDiveContent /> },
];

const DEVICES: KitDevice<DiscState>[] = [
  {
    id: "SW1",
    deviceType: "Cisco access switch",
    role: "Listens for CDP and LLDP on every port; provisions phones with LLDP-MED.",
    stages: ST.sw,
    ports: (s) => PEERS.map((p) => ({ id: p.local, neighbor: p.id, linkType: s.unplugged.includes(p.id) ? "unplugged" : p.id === "PHONE-1" ? `access 10 · voice ${VOICE.vlan}` : "link", up: !s.unplugged.includes(p.id) })),
    knows: (s) => `CDP ${s.sw1.CDP ? "on" : "off"} (${neighbors(s, "CDP").length}) · LLDP ${s.sw1.LLDP ? "on" : "off"} (${neighbors(s, "LLDP").length})`,
    tables: (s) => [
      { title: "SW1 CDP neighbours", rows: neighbors(s, "CDP").map((n) => ({ label: `${n.peer.id} · ${n.peer.local}`, value: `${n.peer.platform} · ${n.peer.port} · ${n.holdLeft} s` })) },
      { title: "SW1 LLDP neighbours", rows: neighbors(s, "LLDP").map((n) => ({ label: `${n.peer.id} · ${n.peer.local}`, value: `${n.peer.caps} · ${n.peer.port} · ${n.holdLeft} s` })) },
    ],
  },
  ...PEERS.map(
    (p): KitDevice<DiscState> => ({
      id: p.id,
      deviceType: p.platform,
      role: `Speaks ${p.speaks.join(" and ")}.`,
      stages: p.id === "PHONE-1" ? ST.phone : ST.peer,
      ports: (s) => [{ id: p.port, neighbor: "SW1", neighborLabel: `SW1 ${p.local}`, linkType: s.unplugged.includes(p.id) ? "unplugged" : "link", up: !s.unplugged.includes(p.id), ip: p.mgmt !== "—" ? p.mgmt : undefined }],
      knows: (s) => (p.id === "PHONE-1" ? (s.phoneUp ? (s.phoneVoiceVlan ? `voice VLAN ${s.phoneVoiceVlan}` : `untagged → VLAN ${VOICE.dataVlan}`) : "not booted") : `Advertises ${p.speaks.join(" + ")}`),
    }),
  ),
];
const adapters = kitAdapters(DEVICES, "discovery");

const config: FundamentalsLessonConfig<DiscState> = {
  lessonId: "discovery-protocols",
  xp: 125,
  steps: discoverySteps,
  createState: createDiscState,
  badge: "CCNA · Network Access",
  title: "Discovery Protocols: CDP & LLDP",
  intro: "Map an undocumented wiring closet by asking the neighbours. Read Cisco's CDP and the standard LLDP from live neighbour tables, watch an entry age out, provision a phone with LLDP-MED — then undo a security change that took every third-party phone offline.",
  facts: [
    { q: "Does it carry traffic?", a: "No — it only describes the neighbour; it never forwards anything." },
    { q: "How far do they reach?", a: "One hop. Neighbours consume the frames; they are never forwarded." },
    { q: "What's in an advertisement?", a: "Name, port, model, capabilities, management address." },
    { q: "Why do phones care?", a: "They learn their voice VLAN and QoS from it." },
  ],
  terms: [
    { term: "CDP", expansion: "Cisco Discovery Protocol", meaning: "Cisco neighbours" },
    { term: "LLDP", expansion: "Link Layer Discovery Protocol", meaning: "Any vendor" },
    { term: "TLV", expansion: "Type-length-value", meaning: "One field" },
    { term: "Holdtime", expansion: "Entry lifetime", meaning: "CDP 180 s · LLDP 120 s" },
    { term: "LLDP-MED", expansion: "Media endpoint discovery", meaning: "Phone provisioning" },
  ],
  guide: { title: "Discovery Protocols: CDP & LLDP", subtitle: "SW1 · SW2 · AP1 · R1 (Junos) · PHONE-1", tabs: GUIDE_TABS },
  briefing: { phases: DISC_BRIEFING_PHASES, notes: DISC_BRIEFING_NOTES },
  nodes: (s) => [
    { id: "SW1", label: "SW1", subLabel: "Cisco access", x: 48, y: 46, kind: "switch" },
    { id: "SW2", label: "SW2", subLabel: "Cisco", x: 14, y: 22, kind: "switch" },
    { id: "AP1", label: "AP1", subLabel: "Cisco", x: 14, y: 74, kind: "accessPoint" },
    { id: "R1", label: "R1", subLabel: "Juniper", x: 84, y: 30, kind: "router" },
    { id: "PHONE-1", label: "PHONE-1", subLabel: s.phoneUp ? (s.phoneVoiceVlan ? `voice VLAN ${s.phoneVoiceVlan}` : `VLAN ${VOICE.dataVlan}`) : "SIP phone", x: 70, y: 84, kind: "laptop" },
  ],
  edges: (s) => PEERS.map((p) => ({ id: p.id, a: "SW1", b: p.id, label: p.local, down: s.unplugged.includes(p.id) })),
  enterable: ["SW1", "PHONE-1", "R1"],
  primaryDevice: { "cdp-adv": "SW1", "cdp-table": "SW1", "lldp-enable": "SW1", aging: "SW1", aged: "SW1", "lldp-med": "PHONE-1", "fault-injected": "SW1", "inc-phone": "PHONE-1", "diagnostic-layers": "SW1", "repair-challenge": "SW1", verify: "PHONE-1" },
  ...adapters,
  callout: kitCallout,
  sidePanel: (s) => <DiscPanel s={s} />,
  repair: {
    stepId: "repair-challenge",
    prompt: "Third-party phones land in the data VLAN since LLDP was disabled. Which change fixes the cause and keeps the security goal?",
    options: DISC_REPAIR_OPTIONS,
    correctId: DISC_REPAIR_CORRECT,
    success: "LLDP runs again, so phones receive their voice VLAN; it's off only where the neighbour is untrusted, which is what the review actually needed.",
    wrongFeedback: {
      manual: "It works for one phone and breaks on the next replacement or factory reset. The network should provision phones.",
      cdp: "CDP is still on — and these standards-based phones don't speak it.",
      data: "Then voice mixes with data: no VLAN separation, no voice QoS, and the call-server policy still blocks it.",
    },
    attempt: (s) => s.repairAttempt,
  },
  diagnostics: {
    fromStepId: "diagnostic-layers",
    layers: (s) => [
      { label: "Power and link — PHONE-1 on Gi1/0/5, PoE granted", status: "healthy" },
      { label: `Address — ${s.phoneVoiceVlan ? "10.110.0.x (voice)" : "10.10.10.x (data)"}`, status: s.phoneVoiceVlan ? "healthy" : "failing" },
      { label: `Voice VLAN on port — switchport voice vlan ${VOICE.vlan}`, status: "healthy" },
      { label: `LLDP on SW1 — ${s.sw1.LLDP ? "running" : "disabled globally"}`, status: s.sw1.LLDP ? "healthy" : "failing" },
      { label: `LLDP-MED network policy sent — ${s.sw1.LLDP ? "yes" : "no"}`, status: s.sw1.LLDP ? "healthy" : "failing" },
    ],
  },
  complete: { badge: "Lesson Complete", title: "You can ask the network who's there", message: "CDP for Cisco, LLDP for everyone, entries that age by holdtime, LLDP-MED provisioning phones — and discovery disabled per port, only where the neighbour isn't yours." },
};

export default function DiscoveryProtocolsDemo() {
  return <FundamentalsLessonShell config={config} />;
}
