"use client";

import { FundamentalsLessonShell, type FundamentalsLessonConfig } from "@/components/lesson/FundamentalsLessonShell";
import { fundamentalsCallout } from "@/components/lesson/fundamentalsCallout";
import type { LessonGuideTab } from "@/components/lesson/LessonGuideDialog";
import { EDGE_PRIMARY, EDGE_SECONDARY, PRIMARY_PORT, SECONDARY_PORT, SWF_MAC, SWF_REPAIR_CORRECT, SWF_REPAIR_OPTIONS, createSwfState, lookup, switchingFundamentalsSteps, type SwfDevice, type SwfState } from "@/lib/sim-engine/scenarios/switchingFundamentals";
import { SWF_BRIEFING_NOTES, SWF_BRIEFING_PHASES } from "./briefing";
import { swfInterfacesFor, swfTraceFor } from "./deviceTrace";
import { explainSwf, swfTables } from "./explain";
import { swfNames } from "./addressNames";
import { SwitchFdbPanel } from "./SwitchFdbPanel";
import { SWF_LESSON_SECTIONS, SwitchingLessonGuideContent } from "./LessonGuideContent";
import { SWF_DEEP_DIVE_SECTIONS, SwitchingDeepDiveContent } from "./DeepDiveContent";

const GUIDE_TABS: LessonGuideTab[] = [
  { id: "lesson", label: "This Lesson", hint: "SW1 + SW2 · HOST-A/B/C/D · learning, partial knowledge, broadcast and a Layer-2 loop", sections: SWF_LESSON_SECTIONS, content: <SwitchingLessonGuideContent /> },
  { id: "deep", label: "Multi-Switch Forwarding Deep Dive", hint: "Transparent bridging across several switches in general", sections: SWF_DEEP_DIVE_SECTIONS, content: <SwitchingDeepDiveContent /> },
];

const config: FundamentalsLessonConfig<SwfState> = {
  lessonId: "switching-fundamentals",
  xp: 175,
  steps: switchingFundamentalsSteps,
  createState: createSwfState,
  badge: "Fundamentals · Layer 2",
  title: "Switching Fundamentals: Multi-Switch Forwarding",
  intro: "Two switches, four hosts, one broadcast domain. Watch each switch learn and look up on its own, see a frame known at one switch and unknown at the next — then find out what a second active cable between the switches does.",
  facts: [
    { q: "Do switches share MAC tables?", a: "No. Each bridge learns only from source MACs arriving on its own ports." },
    { q: "Who decides the path?", a: "Every switch, separately: one lookup per bridge, each in its own FDB." },
    { q: "How far does a broadcast go?", a: "To every host in the Layer-2 domain, across every switch in it." },
    { q: "Does Ethernet have a TTL?", a: "No. A switch forwards the frame unchanged — there is no hop count." },
  ],
  terms: [
    { term: "FDB", expansion: "Forwarding database", meaning: "One switch's MAC → port table" },
    { term: "Bridge", expansion: "IEEE 802.1D learning bridge", meaning: "What an Ethernet switch is" },
    { term: "Flood", expansion: "Send out every other forwarding port", meaning: "Unknown unicast and broadcast" },
    { term: "L2 loop", expansion: "Layer-2 forwarding loop", meaning: "Frames circulate between bridges" },
    { term: "MAC flap", expansion: "MAC address moving between ports", meaning: "A classic loop symptom" },
  ],
  guide: { title: "Switching Fundamentals: Multi-Switch Forwarding", subtitle: `SW1 ↔ SW2 · ${PRIMARY_PORT} primary · ${SECONDARY_PORT} secondary · hosts …:55:0A–0D`, tabs: GUIDE_TABS },
  briefing: { phases: SWF_BRIEFING_PHASES, notes: SWF_BRIEFING_NOTES },
  nodes: (s) => [
    { id: "HOST-A", label: "HOST-A", subLabel: "…:55:0A", x: 10, y: 26, kind: "laptop" },
    { id: "HOST-D", label: "HOST-D", subLabel: "…:55:0D", x: 20, y: 82, kind: "laptop" },
    { id: "SW1", label: "SW1", subLabel: `FDB ${s.fdb.SW1.length}`, x: 31, y: 50, kind: "switch" },
    { id: "SW2", label: "SW2", subLabel: `FDB ${s.fdb.SW2.length}`, x: 69, y: 50, kind: "switch" },
    { id: "HOST-B", label: "HOST-B", subLabel: "…:55:0B", x: 88, y: 28, kind: "laptop" },
    { id: "HOST-C", label: "HOST-C", subLabel: "…:55:0C", x: 80, y: 82, kind: "laptop" },
  ],
  edges: (s) => [
    { id: "a-sw1", a: "HOST-A", b: "SW1", label: "ge-0/0/1" },
    { id: "d-sw1", a: "HOST-D", b: "SW1", label: "ge-0/0/2" },
    { id: EDGE_PRIMARY, a: "SW1", b: "SW2", label: `${PRIMARY_PORT} primary`, offset: { dx: 0, dy: -6 }, offset3D: [0, 0, -0.55] },
    { id: EDGE_SECONDARY, a: "SW1", b: "SW2", label: `${SECONDARY_PORT} ${s.secondaryUp ? "on" : "off"}`, offset: { dx: 0, dy: 6 }, offset3D: [0, 0, 0.55], down: !s.secondaryUp, visual3D: s.secondaryUp ? undefined : "disabled" },
    { id: "sw2-b", a: "SW2", b: "HOST-B", label: "ge-0/0/1" },
    { id: "sw2-c", a: "SW2", b: "HOST-C", label: "ge-0/0/2" },
  ],
  regions: [{ id: "l2", label: "One Layer-2 broadcast domain", x: 3, y: 6, width: 94, height: 90, tone: "muted" }],
  enterable: ["SW1", "SW2"],
  primaryDevice: { "b-accepts": "HOST-B", "c-discards": "HOST-C", "incident-intro": "SW1", "repair-challenge": "SW1" },
  traceFor: (d, s, stepId) => swfTraceFor(d as SwfDevice, s, stepId),
  interfacesFor: (d, s, stepId) => swfInterfacesFor(d as SwfDevice, s, stepId),
  pipelineTitle: (d) => `${d} · Bridge pipeline`,
  explainNode: explainSwf,
  tablesFor: (d, s) => swfTables(d as SwfDevice, s),
  callout: (p, s) => {
    const cc = fundamentalsCallout(p, swfNames, { decision: s.decision && (s.decision.device === p.from || s.decision.device === p.to) ? s.decision.text : undefined });
    // Flood copies get a compact title (the main packet's callout already carries the full decision), so simultaneous copies stay readable.
    if (!s.flood.some((f) => f.id === p.id)) return cc;
    const note = s.copyNotes[p.id];
    return { ...cc, title: `${p.broadcast ? "Broadcast" : "Flooded"} copy${note ? ` ${note}` : ""}` };
  },
  floodCopies: (s) => s.flood,
  packetEdgeId: (s) => s.packetEdge,
  nodeBadges: (id, s) => (id === "SW1" || id === "SW2" ? [`FDB ${s.fdb[id].length}`] : undefined),
  repair: {
    stepId: "repair-challenge",
    prompt: "Broadcasts keep circulating between SW1 and SW2. Which change fixes it?",
    options: SWF_REPAIR_OPTIONS.map((o) => ({ id: o.id, label: o.label })),
    correctId: SWF_REPAIR_CORRECT,
    success: "One SW1↔SW2 path remains. A flooded copy can no longer come back to the switch that sent it, so the circulating copies drain and the entries settle.",
    wrongFeedback: {
      "clear-fdb": "Clearing the FDBs empties the tables for a moment, but the copies are still circulating over both links. The next wave relearns — and moves — the same entries.",
      "raise-ttl": "Switches never read or change the IPv4 TTL, and this ARP broadcast has no IPv4 header at all. Ethernet has no TTL of its own.",
      "change-mac": "The loop doesn't depend on which MAC HOST-A uses. Any broadcast from any host would circulate the same way.",
      "restart-b": "HOST-B only receives duplicates. The copies circulate between the switches whether HOST-B is up or not.",
    },
    attempt: (s) => s.repairAttempt,
  },
  diagnostics: {
    fromStepId: "diagnostic-layers",
    layers: (s) => {
      const aOnSw1 = lookup(s.fdb.SW1, SWF_MAC["HOST-A"])?.port;
      const circulating = s.loop?.circulating ?? 0;
      return [
        { label: `L1 — every cable up · SW1↔SW2 links forwarding: ${s.secondaryUp ? `${PRIMARY_PORT} + ${SECONDARY_PORT}` : PRIMARY_PORT}`, status: "healthy" },
        { label: `Layer-2 topology — ${s.secondaryUp ? "two active paths between SW1 and SW2, no loop prevention" : "one active path between SW1 and SW2"}`, status: s.secondaryUp ? "failing" : "healthy" },
        { label: `SW1 FDB — HOST-A → ${aOnSw1 ?? "no entry"} (HOST-A is on ge-0/0/1)`, status: aOnSw1 && aOnSw1 !== "ge-0/0/1" ? "failing" : "healthy" },
        { label: `Hosts — broadcast copies still circulating: ${circulating}`, status: circulating > 0 ? "failing" : "healthy" },
      ];
    },
  },
  sidePanel: (s) => <SwitchFdbPanel s={s} />,
  complete: { badge: "Lesson Complete", title: "You can follow a frame through several switches", message: "Independent FDBs, hop-by-hop learning, partial knowledge, domain-wide broadcast — and why two active paths without loop prevention become an endless loop." },
};

export default function SwitchingFundamentalsDemo() {
  return <FundamentalsLessonShell config={config} />;
}
