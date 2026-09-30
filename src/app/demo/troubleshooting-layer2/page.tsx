"use client";

import { FundamentalsLessonShell, type FundamentalsLessonConfig } from "@/components/lesson/FundamentalsLessonShell";
import { EvidenceNotebook } from "@/components/lesson/EvidenceNotebook";
import type { LessonGuideTab } from "@/components/lesson/LessonGuideDialog";
import type { PacketCallout3D } from "@/components/network3d/types";
import type { PacketVisual } from "@/lib/sim-engine/types";
import { L2_IP, L2_REPAIR_CORRECT, L2_REPAIR_OPTIONS, L2_SWITCHES, MGMT_VLAN, USER_VLAN, allowedText, createL2State, fdbText, l2Steps, vidOf, type L2Device, type L2State } from "@/lib/sim-engine/scenarios/troubleshootingLayer2";
import { L2_BRIEFING_NOTES, L2_BRIEFING_PHASES } from "./briefing";
import { l2InterfacesFor, l2TraceFor } from "./deviceTrace";
import { explainL2, l2Tables } from "./explain";
import { L2Panel } from "./L2Panel";
import { L2_LESSON_SECTIONS, L2LessonGuideContent } from "./LessonGuideContent";
import { L2_DEEP_DIVE_SECTIONS, L2DeepDiveContent } from "./DeepDiveContent";

const GUIDE_TABS: LessonGuideTab[] = [
  { id: "lesson", label: "This Lesson", hint: "HOST-A · SW1/SW2/SW3 triangle · HOST-B — VLAN 10 stops at one trunk", sections: L2_LESSON_SECTIONS, content: <L2LessonGuideContent /> },
  { id: "deep", label: "Layer 2 Deep Dive", hint: "MAC learning, 802.1Q, allowed/native VLANs, STP, flooding, loops", sections: L2_DEEP_DIVE_SECTIONS, content: <L2DeepDiveContent /> },
];

const fld = (p: PacketVisual, label: string) => p.layers.flatMap((l) => l.fields).find((x) => x.label === label)?.value ?? "";
function l2Callout(p: PacketVisual, s: L2State): PacketCallout3D {
  const decision = s.decision && (s.decision.device === p.from || s.decision.device === p.to) ? s.decision.text : undefined;
  const vid = vidOf(p);
  const what = p.protocol === "ARP" ? `ARP ${fld(p, "Operation").startsWith("1") ? `who-has ${fld(p, "Target IP")}` : "reply"}` : `ICMP ${fld(p, "Type").startsWith("8") ? "echo" : "reply"} ${fld(p, "Source")} → ${fld(p, "Destination")}`;
  return { title: `${what}${vid ? ` · 802.1Q VID ${vid}` : " · untagged"}`, detail: [`dst ${fld(p, "Destination MAC")}`, `${p.from} → ${p.to}`, decision].filter(Boolean).join(" · "), color: vid === String(MGMT_VLAN) ? "#34d399" : vid ? "#a78bfa" : "#94a3b8" };
}

const POS: Record<L2Device, { x: number; y: number; kind: "laptop" | "switch" }> = {
  "HOST-A": { x: 9, y: 50, kind: "laptop" },
  SW1: { x: 33, y: 50, kind: "switch" },
  SW2: { x: 63, y: 18, kind: "switch" },
  SW3: { x: 63, y: 82, kind: "switch" },
  "HOST-B": { x: 90, y: 82, kind: "laptop" },
};
const SUB: Record<L2Device, string> = { "HOST-A": `${L2_IP["HOST-A"]} · VLAN 10`, SW1: "prio 32768", SW2: "prio 4096 · root", SW3: "prio 8192", "HOST-B": `${L2_IP["HOST-B"]} · VLAN 10` };

const config: FundamentalsLessonConfig<L2State> = {
  lessonId: "troubleshooting-layer2",
  xp: 200,
  steps: l2Steps,
  createState: createL2State,
  badge: "Troubleshooting · Layer 2",
  title: "Layer 2 Troubleshooting: VLANs, MACs & Loops",
  intro: "Follow VLAN 10 through a redundant triangle of switches: access ports and 802.1Q trunks, MAC learning and aging, and an RSTP tree with one discarding port. Then find why one host cannot reach another while every link is up, spanning tree is unchanged and another VLAN works across the same trunk.",
  facts: [
    { q: "Access vs trunk?", a: "Access: untagged, one VLAN (PVID). Trunk: 802.1Q-tagged, only the allowed VLANs." },
    { q: "Where is a MAC learned?", a: "On the port where frames FROM that MAC arrive, per VLAN; entries age out." },
    { q: "Does link UP mean all VLANs pass?", a: "No — each VLAN must be allowed on every port it crosses." },
    { q: "Why not blame STP?", a: "Only if roles/states changed or a port it needs is not forwarding." },
  ],
  terms: [
    { term: "802.1Q", expansion: "VLAN tag", meaning: "TPID 0x8100 + 12-bit VID" },
    { term: "PVID", expansion: "Port VLAN ID", meaning: "access / untagged VLAN" },
    { term: "Allowed list", expansion: "Trunk membership", meaning: "VLANs a trunk carries" },
    { term: "FDB", expansion: "MAC table", meaning: "VLAN + MAC → port" },
    { term: "RSTP", expansion: "Rapid STP", meaning: "one loop-free tree" },
  ],
  guide: { title: "Layer 2 Troubleshooting: VLANs, MACs & Loops", subtitle: "Three switches · VLAN 10 and 20 · RSTP root SW2 · one trunk, one missing VLAN", tabs: GUIDE_TABS },
  briefing: { phases: L2_BRIEFING_PHASES, notes: L2_BRIEFING_NOTES },
  nodes: () => (Object.keys(POS) as L2Device[]).map((d) => ({ id: d, label: d, subLabel: SUB[d], x: POS[d].x, y: POS[d].y, kind: POS[d].kind })),
  edges: () => [
    { id: "L-A", a: "HOST-A", b: "SW1", label: "ge-0/0/1" },
    { id: "L-12", a: "SW1", b: "SW2", label: "trunk ge-0/0/49" },
    { id: "L-13", a: "SW1", b: "SW3", label: "trunk ge-0/0/50 (SW1: Alternate)", visual3D: "controlPlane" as const },
    { id: "L-23", a: "SW2", b: "SW3", label: "trunk ge-0/0/51" },
    { id: "L-B", a: "SW3", b: "HOST-B", label: "ge-0/0/1" },
  ],
  enterable: ["HOST-A", "SW1", "SW2", "SW3", "HOST-B"],
  primaryDevice: { intro: "SW1", "vlan-design": "SW2", "rstp-state": "SW1", "base-mac": "SW2", "incident-intro": "HOST-A", "inc-ping-summary": "HOST-A", "inc-link-stp": "SW2", "inc-mac-age": "SW2", "inc-vlan-table": "SW2", "predict-cause": "SW2", "repair-challenge": "SW2", "ver-summary": "SW2" },
  traceFor: (d, s, stepId) => l2TraceFor(d as L2Device, s, stepId),
  interfacesFor: (d, s, stepId) => l2InterfacesFor(d as L2Device, s, stepId),
  pipelineTitle: (d) => `${d} · ${d.startsWith("SW") ? "802.1Q bridging" : "host"}`,
  explainNode: explainL2,
  tablesFor: (d, s) => l2Tables(d as L2Device, s),
  callout: l2Callout,
  nodeBadges: (id) => (id === "SW2" ? ["RSTP root"] : undefined),
  repair: {
    stepId: "repair-challenge",
    prompt: "Links are up, RSTP is unchanged, VLAN 20 crosses the SW2 ↔ SW3 trunk, and SW2 drops VLAN 10 at ge-0/0/51's egress check. Which change fixes it?",
    options: L2_REPAIR_OPTIONS.map((o) => ({ id: o.id, label: o.label })),
    correctId: L2_REPAIR_CORRECT,
    success: "SW2 ge-0/0/51 now allows VLANs 10 and 20. Now prove it: send VLAN 10 traffic again and read the MAC tables.",
    wrongFeedback: {
      "host-ip": "HOST-A's addressing is fine — the frames reach SW2 and are dropped there for a VLAN reason. IP never enters the decision.",
      "restart-stp": "RSTP roles and states are identical to the baseline and ge-0/0/51 is Forwarding. Restarting it would only cause an outage.",
      "clear-arp": "HOST-A's ARP entry is correct; clearing it only makes HOST-A broadcast — and the broadcast is dropped at the same place.",
      native: "Both ends use native VLAN 1, and VLAN 10 is tagged. Making 10 the native VLAN on one side would create a mismatch, not a fix.",
      cable: "The trunk is up, error-free and carries VLAN 20. The cable is fine.",
    },
    attempt: (s) => s.repairAttempt,
  },
  diagnostics: {
    fromStepId: "diagnostic-layers",
    layers: (s) => [
      { label: "Physical / interface — all trunks and access ports up/up, no errors", status: "healthy" },
      { label: "Spanning tree — root SW2, roles/states unchanged, SW2 ge-0/0/51 Forwarding", status: "healthy" },
      { label: `VLAN membership — SW2 ge-0/0/51 allowed ${allowedText(s, "SW2", "ge-0/0/51")} · SW3 ge-0/0/51 allowed ${allowedText(s, "SW3", "ge-0/0/51")}`, status: allowedText(s, "SW2", "ge-0/0/51").split(", ").includes(String(USER_VLAN)) ? "healthy" : "failing" },
      { label: `MAC learning, VLAN 10 — ${L2_SWITCHES.map((sw) => `${sw}: ${fdbText(s, sw, USER_VLAN)}`).join(" | ")}`, status: s.faultActive ? "failing" : "healthy" },
      { label: `VLAN ${MGMT_VLAN} across SW2 ↔ SW3 — ${s.pings.find((p) => p.vlan === MGMT_VLAN) ? "5/5" : "not tested"}`, status: "healthy" },
    ],
  },
  sidePanel: (s) => (
    <div className="space-y-3">
      <L2Panel s={s} />
      <EvidenceNotebook entries={s.notebook} />
    </div>
  ),
  complete: { badge: "Lesson Complete", title: "You can trace a VLAN", message: "Access vs trunk, 802.1Q tags, MAC learning and aging, RSTP roles — and a VLAN missing from one side of one trunk, found from the switch's own drop reason and fixed without touching spanning tree." },
};

export default function TroubleshootingLayer2Demo() {
  return <FundamentalsLessonShell config={config} />;
}
