"use client";

import { FundamentalsLessonShell, type FundamentalsLessonConfig, type ShellEdge } from "@/components/lesson/FundamentalsLessonShell";
import { fundamentalsCallout } from "@/components/lesson/fundamentalsCallout";
import type { LessonGuideTab } from "@/components/lesson/LessonGuideDialog";
import type { PacketCallout3D } from "@/components/network3d/types";
import type { PacketVisual } from "@/lib/sim-engine/types";
import { EDGE_OF, LACP_DST, LACP_ETHERTYPE, LACP_REPAIR_CORRECT, LACP_REPAIR_OPTIONS, LAG1_KEY, LAG_NAME, MEMBERS, SYSTEMS, createLacpState, eligible, fieldOf, isLacpdu, lacpSteps, lagStatus, selectable, type LacpDevice, type LacpState, type Member } from "@/lib/sim-engine/scenarios/lacpLinkAggregation";
import { LACP_BRIEFING_NOTES, LACP_BRIEFING_PHASES } from "./briefing";
import { lacpInterfacesFor, lacpTraceFor } from "./deviceTrace";
import { explainLacp, lacpTables } from "./explain";
import { lacpNames } from "./addressNames";
import { LacpBundlePanel } from "./LacpBundlePanel";
import { LACP_LESSON_SECTIONS, LacpLessonGuideContent } from "./LessonGuideContent";
import { LACP_DEEP_DIVE_SECTIONS, LacpDeepDiveContent } from "./DeepDiveContent";

const GUIDE_TABS: LessonGuideTab[] = [
  { id: "lesson", label: "This Lesson", hint: "SW1 ═ LAG1 ═ SW2 · Actor/Partner, keys, member failure and a key mismatch", sections: LACP_LESSON_SECTIONS, content: <LacpLessonGuideContent /> },
  { id: "deep", label: "LACP & Link Aggregation Deep Dive", hint: "IEEE link aggregation and LACP in general", sections: LACP_DEEP_DIVE_SECTIONS, content: <LacpDeepDiveContent /> },
];

function memberEdge(s: LacpState, m: Member, dy: number, dz: number): ShellEdge {
  const base = { id: EDGE_OF[m], a: "SW1", b: "SW2", offset: { dx: 0, dy }, offset3D: [0, 0, dz] as [number, number, number] };
  if (!s.up[m]) return { ...base, label: `${m} DOWN ✕`, down: true, visual3D: "failed" };
  const dist = eligible(s, "SW1").includes(m) && eligible(s, "SW2").includes(m);
  const inLag = selectable(s, "SW1", m).ok && selectable(s, "SW2", m).ok;
  const defaulted = !s.lacp.SW1[m].partner && !s.lacp.SW2[m].partner;
  return { ...base, label: `${m} · ${dist ? `${LAG_NAME} DIST` : defaulted ? "defaulted" : inLag ? "negotiating" : `not in ${LAG_NAME}`}`, down: !dist, visual3D: dist ? undefined : "backup" };
}

function lacpCallout(p: PacketVisual, s: LacpState): PacketCallout3D {
  if (isLacpdu(p)) {
    return {
      title: `LACPDU · Actor ${p.from} key ${fieldOf(p, "Actor Key")} · ${fieldOf(p, "Actor State").split(" ")[0]}`,
      detail: `→ ${LACP_DST} · ${LACP_ETHERTYPE} · Partner key ${fieldOf(p, "Partner Key")} ${fieldOf(p, "Partner State").split(" ")[0]}${s.note ? ` · ${s.note.text}` : ""}`,
      color: "#22d3ee",
    };
  }
  return fundamentalsCallout(p, lacpNames, { decision: s.note && (s.note.device === p.from || s.note.device === p.to) ? s.note.text : undefined });
}

const config: FundamentalsLessonConfig<LacpState> = {
  lessonId: "lacp-link-aggregation",
  xp: 175,
  steps: lacpSteps,
  createState: createLacpState,
  badge: "Enterprise · Layer 2",
  title: "LACP: Link Aggregation & Member Failover",
  intro: "Two cables between SW1 and SW2 become one logical link, LAG1. Follow LACPDUs through Actor and Partner, watch two flows use two members, lose a member and bring it back — then find out why one key on one port kicked a member out of the bundle.",
  facts: [
    { q: "What does LACP negotiate?", a: "Which physical members join one logical link, and when each may collect and distribute." },
    { q: "Must the two switches use the same key?", a: "No. Each system's key must be consistent across its own members." },
    { q: "Does one flow use both members?", a: "Normally not: a flow stays on one member; many flows spread the load." },
    { q: "Where do LACPDUs go?", a: `${LACP_DST}, EtherType ${LACP_ETHERTYPE}, subtype 0x01 — link-local Slow Protocol frames.` },
  ],
  terms: [
    { term: "LAG", expansion: "Link aggregation group", meaning: "Several links, one logical port" },
    { term: "LACP", expansion: "Link Aggregation Control Protocol", meaning: "IEEE 802.1AX negotiation" },
    { term: "Actor", expansion: "The local end", meaning: "What I say about myself" },
    { term: "Partner", expansion: "The remote end", meaning: "What I learned about the peer" },
    { term: "Key", expansion: "Operational key", meaning: "Local grouping of ports" },
  ],
  guide: { title: "LACP: Link Aggregation & Member Failover", subtitle: `SW1 ${SYSTEMS.SW1.priority}/${SYSTEMS.SW1.mac} key ${LAG1_KEY.SW1} · SW2 ${SYSTEMS.SW2.priority}/${SYSTEMS.SW2.mac} key ${LAG1_KEY.SW2}`, tabs: GUIDE_TABS },
  briefing: { phases: LACP_BRIEFING_PHASES, notes: LACP_BRIEFING_NOTES },
  nodes: () => [
    { id: "HOST-A", label: "HOST-A", subLabel: "192.168.80.10", x: 9, y: 50, kind: "laptop" },
    { id: "SW1", label: "SW1", subLabel: `key ${LAG1_KEY.SW1}`, x: 30, y: 50, kind: "switch" },
    { id: "SW2", label: "SW2", subLabel: `key ${LAG1_KEY.SW2}`, x: 68, y: 50, kind: "switch" },
    { id: "HOST-B", label: "HOST-B", subLabel: "192.168.80.20", x: 86, y: 26, kind: "laptop" },
    { id: "HOST-C", label: "HOST-C", subLabel: "192.168.80.21", x: 88, y: 80, kind: "laptop" },
  ],
  edges: (s) => [
    { id: "a-sw1", a: "HOST-A", b: "SW1", label: "ge-0/0/1" },
    memberEdge(s, MEMBERS[0], -6, -0.55),
    memberEdge(s, MEMBERS[1], 6, 0.55),
    { id: "sw2-b", a: "SW2", b: "HOST-B", label: "ge-0/0/1" },
    { id: "sw2-c", a: "SW2", b: "HOST-C", label: "ge-0/0/2" },
  ],
  regions: [],
  enterable: ["SW1", "SW2"],
  primaryDevice: { "fail-23": "SW1", "restore-23-up": "SW1", "incident-intro": "SW2", "repair-challenge": "SW2" },
  traceFor: (d, s, stepId) => lacpTraceFor(d as LacpDevice, s, stepId),
  interfacesFor: (d, s, stepId) => lacpInterfacesFor(d as LacpDevice, s, stepId),
  pipelineTitle: (d) => `${d} · LACP + forwarding pipeline`,
  explainNode: explainLacp,
  tablesFor: (d, s) => lacpTables(d as LacpDevice, s),
  callout: lacpCallout,
  floodCopies: (s) => s.flood,
  packetEdgeId: (s) => s.packetEdge,
  nodeBadges: (id, s) => (id === "SW1" || id === "SW2" ? [`${LAG_NAME} ${eligible(s, id).length}/2`] : undefined),
  repair: {
    stepId: "repair-challenge",
    prompt: "LAG1 runs on one member although both cables are up. Which change fixes it?",
    options: LACP_REPAIR_OPTIONS.map((o) => ({ id: o.id, label: o.label })),
    correctId: LACP_REPAIR_CORRECT,
    success: "SW2's LAG1 members share key 20 again. LACP renegotiates ge-0/0/24 next — it only counts as restored once both ends are Collecting and Distributing.",
    wrongFeedback: {
      "sw1-key-20": "SW1's key never had to equal SW2's — 10 vs 20 worked from the start. The inconsistency is between SW2's own two members (20 and 99).",
      "clear-fdb": "MAC tables don't decide which ports belong to an aggregate. The member stays out while SW2's keys disagree.",
      "stp-priority": "Spanning tree sees LAG1 as one path; changing the root doesn't touch LACP member selection.",
      "shut-23": "That removes the healthy member and leaves LAG1 with nothing that works. The bad member is ge-0/0/24.",
    },
    attempt: (s) => s.repairAttempt,
  },
  diagnostics: {
    fromStepId: "diagnostic-layers",
    layers: (s) => {
      const sel = selectable(s, "SW2", "ge-0/0/24");
      return [
        { label: "L1 — both member links physically up", status: s.up["ge-0/0/23"] && s.up["ge-0/0/24"] ? "healthy" : "failing" },
        { label: "LACP — LACPDUs exchanged on both members (Active/Active)", status: "healthy" },
        { label: `Selection — SW2 ge-0/0/24 ${sel.ok ? "selected into LAG1" : `not selected: ${sel.why}`}`, status: sel.ok ? "healthy" : "failing" },
        { label: `Distribution — ${lagStatus(s).text}`, status: lagStatus(s).members === 2 ? "healthy" : "failing" },
      ];
    },
  },
  sidePanel: (s) => <LacpBundlePanel s={s} />,
  complete: { badge: "Lesson Complete", title: "You can read an LACP bundle", message: "Actor and Partner, local keys, Synchronization → Collecting → Distributing, per-flow member choice, member failover and a consistent key restored." },
};

export default function LacpLinkAggregationDemo() {
  return <FundamentalsLessonShell config={config} />;
}
