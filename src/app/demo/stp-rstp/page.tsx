"use client";

import { FundamentalsLessonShell, type FundamentalsLessonConfig, type ShellEdge } from "@/components/lesson/FundamentalsLessonShell";
import { fundamentalsCallout } from "@/components/lesson/fundamentalsCallout";
import type { LessonGuideTab } from "@/components/lesson/LessonGuideDialog";
import type { PacketCallout3D } from "@/components/network3d/types";
import type { PacketVisual } from "@/lib/sim-engine/types";
import { BPDU_DST, BRIDGES, LINK_COST, STP_REPAIR_CORRECT, STP_REPAIR_OPTIONS, bidName, bridgeInfo, createStpState, fieldOf, isBpdu, portRole, portState, portSummary, roleShort, stateShort, stpRstpSteps, type LinkId, type StpDevice, type StpState, type StpSw } from "@/lib/sim-engine/scenarios/stpRstp";
import { STP_BRIEFING_NOTES, STP_BRIEFING_PHASES } from "./briefing";
import { stpInterfacesFor, stpTraceFor } from "./deviceTrace";
import { explainStp, stpTables } from "./explain";
import { stpNames } from "./addressNames";
import { SpanningTreePanel } from "./SpanningTreePanel";
import { STP_LESSON_SECTIONS, StpLessonGuideContent } from "./LessonGuideContent";
import { STP_DEEP_DIVE_SECTIONS, StpDeepDiveContent } from "./DeepDiveContent";

const GUIDE_TABS: LessonGuideTab[] = [
  { id: "lesson", label: "This Lesson", hint: "SW1 · SW2 · SW3 triangle · root election, port roles, failover and an RSTP-disabled incident", sections: STP_LESSON_SECTIONS, content: <StpLessonGuideContent /> },
  { id: "deep", label: "STP/RSTP Deep Dive", hint: "Spanning tree protocols in general", sections: STP_DEEP_DIVE_SECTIONS, content: <StpDeepDiveContent /> },
];

const LINKS: { id: LinkId; a: StpSw; ap: string; b: StpSw; bp: string }[] = [
  { id: "L12", a: "SW1", ap: "ge-0/0/1", b: "SW2", bp: "ge-0/0/1" },
  { id: "L13", a: "SW1", ap: "ge-0/0/2", b: "SW3", bp: "ge-0/0/1" },
  { id: "L23", a: "SW2", ap: "ge-0/0/2", b: "SW3", bp: "ge-0/0/2" },
];
const end = (s: StpState, sw: StpSw, port: string) => (portSummary(s, sw).find((p) => p.port === port)!.rstp ? `${roleShort(portRole(s, sw, port))} ${stateShort(portState(s, sw, port))}` : `NO-RSTP ${stateShort(portState(s, sw, port))}`);

function linkEdge(s: StpState, l: (typeof LINKS)[number]): ShellEdge {
  if (!s.linkUp[l.id]) return { id: l.id, a: l.a, b: l.b, label: "LINK DOWN ✕", down: true, visual3D: "failed" };
  const both = portState(s, l.a, l.ap) === "Forwarding" && portState(s, l.b, l.bp) === "Forwarding";
  return { id: l.id, a: l.a, b: l.b, label: `${end(s, l.a, l.ap)} │ ${end(s, l.b, l.bp)}`, down: !both, visual3D: both ? undefined : "backup" };
}

function stpCallout(p: PacketVisual, s: StpState): PacketCallout3D {
  if (isBpdu(p)) {
    const root = fieldOf(p, "Root ID");
    const rootName = Object.entries(BRIDGES).find(([, b]) => root.endsWith(b.mac))?.[0] ?? root;
    const bridge = fieldOf(p, "Bridge ID");
    const bridgeName = Object.entries(BRIDGES).find(([, b]) => bridge.endsWith(b.mac))?.[0] ?? bridge;
    const decision = s.decision && (s.decision.device === p.from || s.decision.device === p.to) ? ` · ${s.decision.text}` : "";
    return { title: `RST BPDU · Root ${rootName} · cost ${fieldOf(p, "Root Path Cost")}`, detail: `from ${bridgeName} → ${BPDU_DST} (link-local) · ${fieldOf(p, "Flags").replace(/^0x[0-9A-F]+ /, "")}${decision}`, color: "#22d3ee" };
  }
  const cc = fundamentalsCallout(p, stpNames, { decision: s.decision && (s.decision.device === p.from || s.decision.device === p.to) ? s.decision.text : undefined });
  if (!s.flood.some((f) => f.id === p.id)) return cc;
  const note = s.copyNotes[p.id];
  return { ...cc, title: `${p.broadcast ? "Broadcast" : "Flooded"} copy${note ? ` ${note}` : ""}` };
}

const config: FundamentalsLessonConfig<StpState> = {
  lessonId: "stp-rstp",
  xp: 200,
  steps: stpRstpSteps,
  createState: createStpState,
  badge: "Enterprise · Layer 2",
  title: "STP/RSTP: Building a Loop-Free Layer 2",
  intro: "Three switches cabled in a triangle. Watch RSTP elect a root, pick Root, Designated and Alternate ports, keep customer frames off the redundant link, take it over when a link fails — then find out why one port taken out of RSTP brings the loop back.",
  facts: [
    { q: "Who becomes root?", a: "The lowest Bridge ID: priority first, MAC only as a tie-break." },
    { q: "What is a Root Port?", a: "A non-root bridge's single best path toward the root. The root has none." },
    { q: "What does Alternate mean?", a: "A backup path to the root: link up, BPDUs heard, customer data Discarding." },
    { q: "Where do BPDUs go?", a: "01:80:C2:00:00:00 — link-local bridge control frames, never IP, never forwarded as data." },
  ],
  terms: [
    { term: "RSTP", expansion: "Rapid Spanning Tree Protocol", meaning: "IEEE 802.1w / 802.1D-2004" },
    { term: "BPDU", expansion: "Bridge Protocol Data Unit", meaning: "Link-local RSTP control frame" },
    { term: "Bridge ID", expansion: "Priority + MAC", meaning: "Lowest wins root" },
    { term: "RP / DP", expansion: "Root / Designated Port", meaning: "Forwarding roles" },
    { term: "ALT", expansion: "Alternate Port", meaning: "Backup, Discarding" },
  ],
  guide: { title: "STP/RSTP: Building a Loop-Free Layer 2", subtitle: `SW1 ${BRIDGES.SW1.priority} · SW2 ${BRIDGES.SW2.priority} · SW3 ${BRIDGES.SW3.priority} · link cost ${LINK_COST}`, tabs: GUIDE_TABS },
  briefing: { phases: STP_BRIEFING_PHASES, notes: STP_BRIEFING_NOTES },
  nodes: (s) => [
    { id: "HOST-A", label: "HOST-A", subLabel: "…:77:0A", x: 26, y: 12, kind: "laptop" },
    { id: "SW1", label: "SW1", subLabel: bridgeInfo(s, "SW1").rootPort ? `pri ${BRIDGES.SW1.priority}` : `pri ${BRIDGES.SW1.priority} · root`, x: 52, y: 13, kind: "switch" },
    { id: "SW2", label: "SW2", subLabel: `pri ${BRIDGES.SW2.priority} · root ${bidName(bridgeInfo(s, "SW2").rootId)}`, x: 24, y: 64, kind: "switch" },
    { id: "SW3", label: "SW3", subLabel: `pri ${BRIDGES.SW3.priority} · root ${bidName(bridgeInfo(s, "SW3").rootId)}`, x: 76, y: 64, kind: "switch" },
    { id: "HOST-B", label: "HOST-B", subLabel: "…:77:0B", x: 9, y: 86, kind: "laptop" },
    { id: "HOST-C", label: "HOST-C", subLabel: "…:77:0C", x: 89, y: 86, kind: "laptop" },
  ],
  edges: (s) => [{ id: "a-sw1", a: "HOST-A", b: "SW1", label: "edge" }, ...LINKS.map((l) => linkEdge(s, l)), { id: "b-sw2", a: "SW2", b: "HOST-B", label: "edge" }, { id: "c-sw3", a: "SW3", b: "HOST-C", label: "edge" }],
  regions: [],
  enterable: ["SW1", "SW2", "SW3"],
  primaryDevice: { "root-ports": "SW1", "sync-forwarding": "SW3", "c-bcast-sw3-discard": "SW3", "fail-link": "SW3", "sw3-reconverge": "SW3", "restore-link": "SW3", "incident-intro": "SW3", "repair-challenge": "SW3" },
  traceFor: (d, s, stepId) => stpTraceFor(d as StpDevice, s, stepId),
  interfacesFor: (d, s, stepId) => stpInterfacesFor(d as StpDevice, s, stepId),
  pipelineTitle: (d) => `${d} · RSTP + bridge pipeline`,
  explainNode: explainStp,
  tablesFor: (d, s) => stpTables(d as StpDevice, s),
  callout: stpCallout,
  floodCopies: (s) => s.flood,
  nodeBadges: (id, s) => (id === "SW1" || id === "SW2" || id === "SW3" ? [bridgeInfo(s, id).rootPort ? `RP ${bridgeInfo(s, id).rootPort}` : "claims root"] : undefined),
  repair: {
    stepId: "repair-challenge",
    prompt: "Broadcasts circulate around the triangle again. Which change fixes it?",
    options: STP_REPAIR_OPTIONS.map((o) => ({ id: o.id, label: o.label })),
    correctId: STP_REPAIR_CORRECT,
    success: "RSTP runs on SW3 ge-0/0/2 again. It hears SW2's better BPDU and, after RSTP reconverges, returns to Alternate/Discarding — the triangle is loop-free again.",
    wrongFeedback: {
      "clear-fdb": "Empty MAC tables refill in milliseconds from the same looping copies. Nothing holds the redundant port Discarding.",
      "raise-ttl": "Switches don't touch the IPv4 TTL, and Ethernet has no TTL of its own. Loop prevention is RSTP's job.",
      "disable-host-c": "HOST-C only receives duplicates. Removing it doesn't take the SW2–SW3 port back under RSTP control.",
      "change-mac": "Any broadcast from any host would loop the same way. The loop is in the forwarding topology, not in HOST-A.",
    },
    attempt: (s) => s.repairAttempt,
  },
  diagnostics: {
    fromStepId: "diagnostic-layers",
    layers: (s) => {
      const off = portSummary(s, "SW3").find((p) => p.port === "ge-0/0/2")!;
      const allFwd = (["L12", "L13", "L23"] as LinkId[]).every((id) => {
        const l = LINKS.find((x) => x.id === id)!;
        return s.linkUp[id] && portState(s, l.a, l.ap) === "Forwarding" && portState(s, l.b, l.bp) === "Forwarding";
      });
      return [
        { label: "L1 — all three inter-switch links physically up", status: "healthy" },
        { label: `RSTP participation — SW3 ge-0/0/2 ${off.rstp ? "enabled" : "DISABLED"}`, status: off.rstp ? "healthy" : "failing" },
        { label: `Active topology — ${allFwd ? "all three links forward customer data (loop)" : "one port on the triangle Discarding (loop-free)"}`, status: allFwd ? "failing" : "healthy" },
        { label: `Customer delivery — copies still circulating: ${s.loop?.circulating ?? 0}`, status: (s.loop?.circulating ?? 0) > 0 ? "failing" : "healthy" },
      ];
    },
  },
  sidePanel: (s) => <SpanningTreePanel s={s} />,
  complete: { badge: "Lesson Complete", title: "You can read a spanning tree", message: "Root by lowest Bridge ID, Root / Designated / Alternate roles, Discarding without link-down, rapid failover — and why every redundant port must stay under RSTP control." },
};

export default function StpRstpDemo() {
  return <FundamentalsLessonShell config={config} />;
}
