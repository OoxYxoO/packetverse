"use client";

import { FundamentalsLessonShell, type FundamentalsLessonConfig } from "@/components/lesson/FundamentalsLessonShell";
import { fundamentalsCallout } from "@/components/lesson/fundamentalsCallout";
import type { LessonGuideTab } from "@/components/lesson/LessonGuideDialog";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { TRUNK_PORT, VLAN_REPAIR_CORRECT, VLAN_REPAIR_OPTIONS, createVlanState, vlanFundamentalsSteps, vlanMacName, type VlanDevice, type VlanState, type VlanSwitch } from "@/lib/sim-engine/scenarios/vlanFundamentals";
import { VLAN_BRIEFING_NOTES, VLAN_BRIEFING_PHASES } from "./briefing";
import { vlanInterfacesFor, vlanTraceFor } from "./deviceTrace";
import { explainVlan, vlanTables } from "./explain";
import { vlanNames } from "./addressNames";
import { VLAN_LESSON_SECTIONS, VlanLessonGuideContent } from "./LessonGuideContent";
import { VLAN_DEEP_DIVE_SECTIONS, VlanDeepDiveContent } from "./DeepDiveContent";

const GUIDE_TABS: LessonGuideTab[] = [
  { id: "lesson", label: "This Lesson", hint: "SW1 ⇄ SW2 trunk · VLAN 10 (A, B) · VLAN 20 (C, D) · allowed-VLAN incident", sections: VLAN_LESSON_SECTIONS, content: <VlanLessonGuideContent /> },
  { id: "deep", label: "VLANs & Trunking Deep Dive", hint: "IEEE 802.1Q VLANs and trunks in general", sections: VLAN_DEEP_DIVE_SECTIONS, content: <VlanDeepDiveContent /> },
];

function VlanPanel({ s }: { s: VlanState }) {
  const sw = (id: VlanSwitch) => (
    <div key={id}>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">{id} FDB</p>
        <span className={`pv-mono text-[10px] ${s.allowed[id].length < 2 ? "text-pv-danger" : "text-pv-text-faint"}`}>
          {TRUNK_PORT} allows {s.allowed[id].join(", ") || "none"}
        </span>
      </div>
      {s.fdb[id].length === 0 ? (
        <p className="pv-mono text-[11px] text-pv-text-faint">empty</p>
      ) : (
        <div className="space-y-0.5 pv-mono text-[11px]">
          {s.fdb[id].map((e) => (
            <div key={`${e.vlan}-${e.mac}`} className="flex flex-wrap justify-between gap-x-3">
              <span className={e.vlan === 10 ? "text-pv-cyan-soft" : "text-pv-violet"}>VLAN {e.vlan}</span>
              <span className="text-pv-text-muted">
                {vlanMacName(e.mac)} → {e.port}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
  return <GlassPanel className="space-y-3 p-4">{(["SW1", "SW2"] as VlanSwitch[]).map(sw)}</GlassPanel>;
}

const config: FundamentalsLessonConfig<VlanState> = {
  lessonId: "vlan-fundamentals",
  xp: 150,
  steps: vlanFundamentalsSteps,
  createState: createVlanState,
  badge: "Fundamentals · Layer 2",
  title: "VLANs & Trunking",
  intro: "Two switches, one trunk, two VLANs. Watch access ports classify untagged frames, the trunk carry 802.1Q tags, FDBs stay per VLAN and broadcasts stay inside their VLAN — then fix a trunk that stopped carrying one VLAN.",
  facts: [
    { q: "Who picks the VLAN?", a: "The switch, from the access port the frame arrives on." },
    { q: "Where is the tag?", a: "Only on the trunk: TPID 0x8100 + TCI, before the original EtherType." },
    { q: "What does a VLAN isolate?", a: "The Layer-2 broadcast domain. Inter-VLAN traffic needs Layer 3." },
    { q: "What does 'allowed' mean?", a: "The VLANs a trunk carries. Others are filtered even with the link up." },
  ],
  terms: [
    { term: "VLAN", expansion: "Virtual LAN", meaning: "One L2 broadcast domain" },
    { term: "VID", expansion: "VLAN Identifier", meaning: "12-bit VLAN number" },
    { term: "TPID", expansion: "Tag Protocol Identifier", meaning: "0x8100 for 802.1Q" },
    { term: "TCI", expansion: "Tag Control Information", meaning: "PCP · DEI · VID" },
    { term: "Trunk", expansion: "Tagged inter-switch link", meaning: "Carries many VLANs" },
  ],
  guide: { title: "VLANs & Trunking", subtitle: `VLAN 10: HOST-A, HOST-B · VLAN 20: HOST-C, HOST-D · ${TRUNK_PORT} 802.1Q trunk`, tabs: GUIDE_TABS },
  briefing: { phases: VLAN_BRIEFING_PHASES, notes: VLAN_BRIEFING_NOTES },
  nodes: () => [
    { id: "HOST-A", label: "HOST-A", subLabel: "VLAN 10", x: 10, y: 24, kind: "laptop" },
    { id: "HOST-C", label: "HOST-C", subLabel: "VLAN 20", x: 10, y: 78, kind: "laptop" },
    { id: "SW1", label: "SW1", subLabel: "802.1Q", x: 34, y: 51, kind: "switch" },
    { id: "SW2", label: "SW2", subLabel: "802.1Q", x: 66, y: 51, kind: "switch" },
    { id: "HOST-B", label: "HOST-B", subLabel: "VLAN 10", x: 90, y: 24, kind: "laptop" },
    { id: "HOST-D", label: "HOST-D", subLabel: "VLAN 20", x: 90, y: 78, kind: "laptop" },
  ],
  edges: (s) => [
    { id: "a-sw1", a: "HOST-A", b: "SW1", label: "ge-0/0/1 · V10" },
    { id: "c-sw1", a: "HOST-C", b: "SW1", label: "ge-0/0/2 · V20" },
    { id: "trunk", a: "SW1", b: "SW2", label: `trunk · ${s.allowed.SW1.join(",")} | ${s.allowed.SW2.join(",")}` },
    { id: "sw2-b", a: "SW2", b: "HOST-B", label: "ge-0/0/1 · V10" },
    { id: "sw2-d", a: "SW2", b: "HOST-D", label: "ge-0/0/2 · V20" },
  ],
  enterable: ["SW1", "SW2"],
  primaryDevice: { "b-accepts": "HOST-B", "fault-injected": "SW1", "fault-drop": "SW1", "repair-challenge": "SW1" },
  traceFor: (d, s, stepId) => vlanTraceFor(d as VlanDevice, s, stepId),
  interfacesFor: (d, s, stepId) => vlanInterfacesFor(d as VlanDevice, s, stepId),
  pipelineTitle: (d) => `${d} · 802.1Q bridge pipeline`,
  explainNode: explainVlan,
  tablesFor: (d, s) => vlanTables(d as VlanDevice, s),
  callout: (p, s) => fundamentalsCallout(p, vlanNames, { markUntagged: true, decision: s.note && (s.note.device === p.from || s.note.device === p.to) ? s.note.text : undefined }),
  floodCopies: (s) => s.flood,
  nodeBadges: (id, s) => (id === "SW1" && s.allowed.SW1.length < 2 ? [`TRUNK ALLOWS ${s.allowed.SW1.join(",")}`] : undefined),
  repair: {
    stepId: "repair-challenge",
    prompt: "VLAN 10 no longer crosses the trunk; VLAN 20 does. Which change fixes it?",
    options: VLAN_REPAIR_OPTIONS.map((o) => ({ id: o.id, label: o.label })),
    correctId: VLAN_REPAIR_CORRECT,
    success: `VLAN 10 is back in SW1 ${TRUNK_PORT}'s allowed list. VLAN 10 frames can be tagged VID 10 onto the trunk again.`,
    wrongFeedback: {
      bounce: "The link is up and already carrying VLAN 20. Bouncing it would interrupt VLAN 20 and change nothing for VLAN 10.",
      "move-a": "That would put HOST-A in VLAN 20 with HOST-C and HOST-D, away from HOST-B. It breaks the design instead of fixing the trunk.",
      route: "HOST-A and HOST-B are in the same VLAN. Their traffic is switched, not routed.",
    },
    attempt: (s) => s.repairAttempt,
  },
  diagnostics: {
    fromStepId: "diagnostic-layers",
    layers: (s) => [
      { label: `L1 — ${TRUNK_PORT} and all host ports up`, status: "healthy" },
      { label: "Access VLANs — A, B in 10 · C, D in 20", status: "healthy" },
      { label: `SW1 trunk allowed list — ${s.allowed.SW1.join(", ")}`, status: s.allowed.SW1.includes(10) ? "healthy" : "failing" },
      { label: `SW2 trunk allowed list — ${s.allowed.SW2.join(", ")}`, status: "healthy" },
      { label: "VLAN 20 traffic across the trunk", status: "healthy" },
    ],
  },
  sidePanel: (s) => <VlanPanel s={s} />,
  complete: { badge: "Lesson Complete", title: "You can trace a frame through VLANs", message: "Access classification, 802.1Q tagging, per-VLAN FDBs, broadcast isolation and an allowed-VLAN repair." },
};

export default function VlanFundamentalsDemo() {
  return <FundamentalsLessonShell config={config} />;
}
