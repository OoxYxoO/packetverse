"use client";

import { FundamentalsLessonShell, type FundamentalsLessonConfig } from "@/components/lesson/FundamentalsLessonShell";
import { EvidenceNotebook } from "@/components/lesson/EvidenceNotebook";
import type { LessonGuideTab } from "@/components/lesson/LessonGuideDialog";
import type { PacketCallout3D } from "@/components/network3d/types";
import type { PacketVisual } from "@/lib/sim-engine/types";
import { fieldOf } from "@/lib/sim-engine/scenarios/fundamentalsPackets";
import { L1_IP, L1_REPAIR_CORRECT, L1_REPAIR_OPTIONS, UPLINK, createL1State, dbm, deltaOf, isCorrupted, l1Steps, rxBand, type L1Device, type L1State } from "@/lib/sim-engine/scenarios/troubleshootingLayer1";
import { L1_BRIEFING_NOTES, L1_BRIEFING_PHASES } from "./briefing";
import { l1InterfacesFor, l1TraceFor } from "./deviceTrace";
import { explainL1, l1Tables } from "./explain";
import { L1Panel } from "./L1Panel";
import { L1_LESSON_SECTIONS, L1LessonGuideContent } from "./LessonGuideContent";
import { L1_DEEP_DIVE_SECTIONS, L1DeepDiveContent } from "./DeepDiveContent";

const GUIDE_TABS: LessonGuideTab[] = [
  { id: "lesson", label: "This Lesson", hint: "CLIENT · ACCESS-SW · DIST-SW · SERVER — one fiber uplink that stays UP while it errors", sections: L1_LESSON_SECTIONS, content: <L1LessonGuideContent /> },
  { id: "deep", label: "Layer 1 Deep Dive", hint: "Admin vs oper, Tx/Rx, optics, CRC/FCS, drops vs errors, duplex, counter deltas", sections: L1_DEEP_DIVE_SECTIONS, content: <L1DeepDiveContent /> },
];

const ICMP_HEX = "#f472b6";
function l1Callout(p: PacketVisual, s: L1State): PacketCallout3D {
  const decision = s.decision && (s.decision.device === p.from || s.decision.device === p.to) ? s.decision.text : undefined;
  const type = fieldOf(p, /^ICMP/, "Type").split(" ")[0];
  return {
    title: `ICMP ${type === "8" ? "Echo Request" : "Echo Reply"} · seq ${fieldOf(p, /^ICMP/, "Sequence Number")}`,
    detail: [`${fieldOf(p, /^IPv4/, "Source")} → ${fieldOf(p, /^IPv4/, "Destination")}`, `${p.from} → ${p.to}`, isCorrupted(p) ? "FCS check failed at receiver" : undefined, decision].filter(Boolean).join(" · "),
    color: ICMP_HEX,
  };
}

const POS: Record<L1Device, { x: number; y: number; kind: "laptop" | "switch" | "server" }> = {
  CLIENT: { x: 12, y: 66, kind: "laptop" },
  "ACCESS-SW": { x: 33, y: 34, kind: "switch" },
  "DIST-SW": { x: 67, y: 34, kind: "switch" },
  SERVER: { x: 88, y: 66, kind: "server" },
};
const SUB: Record<L1Device, string> = { CLIENT: L1_IP.CLIENT, "ACCESS-SW": "access", "DIST-SW": "distribution", SERVER: L1_IP.SERVER };

const config: FundamentalsLessonConfig<L1State> = {
  lessonId: "troubleshooting-layer1",
  xp: 200,
  steps: l1Steps,
  createState: createL1State,
  badge: "Troubleshooting · Layer 1",
  title: "Layer 1 Troubleshooting: Link, Optics & Errors",
  intro: "Read the physical layer like evidence: admin vs operational state, transmit and receive light levels, CRC/FCS and input errors read as deltas. Then chase intermittent loss on a fiber uplink that never goes down — and prove the repair with fresh counters, not a reset.",
  facts: [
    { q: "Admin vs oper?", a: "Admin = configured intent. Oper = whether the hardware achieved link." },
    { q: "Whose light is my Rx?", a: "The peer's Tx minus the loss of the fiber in between." },
    { q: "CRC errors?", a: "Frames whose bits changed in transit; discarded at ingress." },
    { q: "Why deltas?", a: "Counters accumulate since the last clear; only change over time is current." },
  ],
  terms: [
    { term: "DOM", expansion: "Digital optical monitoring", meaning: "Tx/Rx power, temp, alarms" },
    { term: "dBm", expansion: "Power vs 1 mW", meaning: "−3 dB ≈ half the light" },
    { term: "FCS", expansion: "Frame Check Sequence", meaning: "CRC-32 trailer" },
    { term: "Carrier transition", expansion: "Link up/down event", meaning: "flap counter" },
    { term: "Δ", expansion: "Counter delta", meaning: "change over an interval" },
  ],
  guide: { title: "Layer 1 Troubleshooting: Link, Optics & Errors", subtitle: "One 1000BASE-LX uplink · UP but unhealthy · counters read as deltas", tabs: GUIDE_TABS },
  briefing: { phases: L1_BRIEFING_PHASES, notes: L1_BRIEFING_NOTES },
  nodes: () => (Object.keys(POS) as L1Device[]).map((d) => ({ id: d, label: d, subLabel: SUB[d], x: POS[d].x, y: POS[d].y, kind: POS[d].kind })),
  edges: () => [
    { id: "L-C-A", a: "CLIENT", b: "ACCESS-SW", label: "eth0 · ge-0/0/1" },
    { id: "L-UPLINK", a: "ACCESS-SW", b: "DIST-SW", label: `${UPLINK} · ${UPLINK} (fiber)` },
    { id: "L-D-S", a: "DIST-SW", b: "SERVER", label: "ge-0/0/2 · eth0" },
  ],
  regions: [{ id: "subnet", label: "10.30.30.0/24 · one broadcast domain", x: 3, y: 16, width: 94, height: 72, tone: "cyan" }],
  enterable: ["CLIENT", "ACCESS-SW", "DIST-SW", "SERVER"],
  primaryDevice: { intro: "ACCESS-SW", "interface-anatomy": "ACCESS-SW", "base-optics": "ACCESS-SW", "base-snap-1": "ACCESS-SW", "base-snap-2": "ACCESS-SW", "base-ping-summary": "CLIENT", "incident-intro": "CLIENT", "inc-ping-summary": "CLIENT", "inc-iface-state": "ACCESS-SW", "inc-snap-1": "ACCESS-SW", "inc-snap-2": "ACCESS-SW", "inc-optics": "ACCESS-SW", hypotheses: "ACCESS-SW", "predict-cause": "ACCESS-SW", "repair-challenge": "ACCESS-SW", "ver-optics": "ACCESS-SW", "ver-snap-1": "ACCESS-SW", "ver-snap-2": "ACCESS-SW", "ver-ping-summary": "CLIENT" },
  traceFor: (d, s, stepId) => l1TraceFor(d as L1Device, s, stepId),
  interfacesFor: (d, s, stepId) => l1InterfacesFor(d as L1Device, s, stepId),
  pipelineTitle: (d) => `${d} · ${d.endsWith("SW") ? "PHY → MAC (FCS) → switching" : "host stack"}`,
  explainNode: explainL1,
  tablesFor: (d, s) => l1Tables(d as L1Device, s),
  callout: l1Callout,
  nodeBadges: (id, s) => (id === "ACCESS-SW" || id === "DIST-SW" ? [`${UPLINK} ${s.oper[id]}`] : undefined),
  repair: {
    stepId: "repair-challenge",
    prompt: `${UPLINK} is UP, ACCESS-SW's receive level is far below its baseline while DIST-SW's transmit level is normal, and CRC errors rise only on frames arriving at ACCESS-SW. Which change fixes it?`,
    options: L1_REPAIR_OPTIONS.map((o) => ({ id: o.id, label: o.label })),
    correctId: L1_REPAIR_CORRECT,
    success: "The DIST → ACCESS fiber path is cleaned and reseated. Now prove it: read the optics again and take two fresh counter snapshots.",
    wrongFeedback: {
      "clear-counters": "Clearing resets the numbers, not the light. The receiver would keep misreading bits and the counters would climb again.",
      "change-dns": "Pings by IP address lose frames too, and the losses are FCS failures — DNS is never involved.",
      "fix-vlan": "99% of frames cross the uplink with a good FCS. A VLAN problem would drop them all, cleanly.",
      "routing-metric": "CLIENT and SERVER share one subnet: there is no router and no metric on this path.",
      firewall: "There is no filter between the switches. The discarded frames failed a CRC check — a physical signature.",
    },
    attempt: (s) => s.repairAttempt,
  },
  diagnostics: {
    fromStepId: "diagnostic-layers",
    layers: (s) => {
      const d = deltaOf(s, "ACCESS-SW");
      const band = rxBand(s.optics["ACCESS-SW"].rx);
      return [
        { label: `Physical / interface — ${UPLINK} ${s.oper["ACCESS-SW"]} · ACCESS Rx ${dbm(s.optics["ACCESS-SW"].rx)} (${band}) · last Δ CRC ${d ? `+${d.crc}` : "—"}`, status: band === "normal" && (!d || d.crc === 0) ? "healthy" : "failing" },
        { label: "Ethernet / VLAN — frames with good FCS forwarded normally; one broadcast domain", status: "healthy" },
        { label: "IP addressing — both hosts in 10.30.30.0/24; no routing hop", status: "healthy" },
        { label: `Transport / application — ${s.pings.at(-1) ? `${100 - s.pings.at(-1)!.received}% ping loss (${s.pings.at(-1)!.series})` : "not measured"}`, status: s.pings.at(-1)?.lost.length ? "failing" : "healthy" },
      ];
    },
  },
  sidePanel: (s) => (
    <div className="space-y-3">
      <L1Panel s={s} />
      <EvidenceNotebook entries={s.notebook} />
    </div>
  ),
  complete: { badge: "Lesson Complete", title: "You can read the physical layer", message: "Admin vs operational state, Tx/Rx direction, CRC errors as deltas — and a link that stayed UP while it corrupted frames, proven fixed with fresh counters and the original test." },
};

export default function TroubleshootingLayer1Demo() {
  return <FundamentalsLessonShell config={config} />;
}
