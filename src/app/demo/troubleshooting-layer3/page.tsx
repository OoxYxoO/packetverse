"use client";

import { FundamentalsLessonShell, type FundamentalsLessonConfig } from "@/components/lesson/FundamentalsLessonShell";
import { EvidenceNotebook } from "@/components/lesson/EvidenceNotebook";
import type { LessonGuideTab } from "@/components/lesson/LessonGuideDialog";
import type { PacketCallout3D } from "@/components/network3d/types";
import type { PacketVisual } from "@/lib/sim-engine/types";
import { fieldOf } from "@/lib/sim-engine/scenarios/fundamentalsPackets";
import { GOOD_PREFIX, L3, L3_REPAIR_CORRECT, L3_REPAIR_OPTIONS, R1_ROUTES, clientLookup, createL3State, isArp, l3Steps, routeText, rtLookup, rtText, type L3Device, type L3State } from "@/lib/sim-engine/scenarios/troubleshootingLayer3";
import { L3_BRIEFING_NOTES, L3_BRIEFING_PHASES } from "./briefing";
import { l3InterfacesFor, l3TraceFor } from "./deviceTrace";
import { explainL3, l3Tables } from "./explain";
import { L3Panel } from "./L3Panel";
import { L3_LESSON_SECTIONS, L3LessonGuideContent } from "./LessonGuideContent";
import { L3_DEEP_DIVE_SECTIONS, L3DeepDiveContent } from "./DeepDiveContent";

const GUIDE_TABS: LessonGuideTab[] = [
  { id: "lesson", label: "This Lesson", hint: "CLIENT · SW1 · R1 · R2 · two servers — one reachable, one not", sections: L3_LESSON_SECTIONS, content: <L3LessonGuideContent /> },
  { id: "deep", label: "Layer 3 Deep Dive", hint: "Connected routes, local vs remote, ARP, LPM, masks, TTL, ICMP, asymmetry", sections: L3_DEEP_DIVE_SECTIONS, content: <L3DeepDiveContent /> },
];

function l3Callout(p: PacketVisual, s: L3State): PacketCallout3D {
  const decision = s.decision && (s.decision.device === p.from || s.decision.device === p.to) ? s.decision.text : undefined;
  if (isArp(p)) {
    const req = fieldOf(p, /^ARP$/, "Operation").startsWith("1");
    return { title: req ? `ARP request · who has ${fieldOf(p, /^ARP$/, "Target IP")}?` : `ARP reply · ${fieldOf(p, /^ARP$/, "Sender IP")} is at ${fieldOf(p, /^ARP$/, "Sender MAC")}`, detail: [`Ethernet dst ${fieldOf(p, /^Ethernet/, "Destination MAC")}`, `target MAC ${fieldOf(p, /^ARP$/, "Target MAC")}`, decision].filter(Boolean).join(" · "), color: "#f59e0b" };
  }
  const type = fieldOf(p, /^ICMP/, "Type").split(" ")[0];
  return {
    title: `ICMP ${type === "8" ? "Echo Request" : "Echo Reply"} · ${fieldOf(p, /^IPv4/, "Source")} → ${fieldOf(p, /^IPv4/, "Destination")}`,
    detail: [`Ethernet dst ${fieldOf(p, /^Ethernet/, "Destination MAC")}`, `TTL ${fieldOf(p, /^IPv4/, "TTL")}`, `${p.from} → ${p.to}`, decision].filter(Boolean).join(" · "),
    color: "#60a5fa",
  };
}

const POS: Record<L3Device, { x: number; y: number }> = {
  CLIENT: { x: 9, y: 70 },
  SW1: { x: 27, y: 38 },
  R1: { x: 48, y: 70 },
  R2: { x: 68, y: 38 },
  SERVER: { x: 90, y: 16 },
  "REMOTE-SERVER": { x: 90, y: 70 },
};
const KIND: Record<L3Device, "laptop" | "switch" | "router" | "server"> = { CLIENT: "laptop", SW1: "switch", R1: "router", R2: "router", SERVER: "server", "REMOTE-SERVER": "server" };
const SUB: Record<L3Device, string> = { CLIENT: L3.client, SW1: "access", R1: `${L3.gw} | ${L3.r1T}`, R2: `${L3.r2T} · two LANs`, SERVER: `${L3.server}/24`, "REMOTE-SERVER": `${L3.remote}/24` };

const config: FundamentalsLessonConfig<L3State> = {
  lessonId: "troubleshooting-layer3",
  xp: 200,
  steps: l3Steps,
  createState: createL3State,
  badge: "Troubleshooting · Layer 3",
  title: "Layer 3 Troubleshooting: ARP, Addressing & Forwarding",
  intro: "Follow a host's own routing decision: connected route vs default route, ARP for the next hop, a frame to the gateway's MAC carrying a remote IP, and TTL dropping only at routers. Then work out why one remote server is unreachable while another, behind the same routers, still works.",
  facts: [
    { q: "Local or remote?", a: "The host's own table decides: a matching connected route means on-link." },
    { q: "Whose MAC?", a: "Always the next hop's: the destination itself if on-link, otherwise the gateway." },
    { q: "When is the default route used?", a: "Only when no longer prefix matches." },
    { q: "TTL?", a: "−1 at every router; switches never touch it." },
  ],
  terms: [
    { term: "Connected route", expansion: "From address + prefix", meaning: "on-link network" },
    { term: "Default route", expansion: "0.0.0.0/0", meaning: "via the gateway" },
    { term: "LPM", expansion: "Longest-prefix match", meaning: "most specific wins" },
    { term: "ARP", expansion: "Address Resolution", meaning: "IPv4 → MAC on one link" },
    { term: "Proxy ARP", expansion: "Router answers for others", meaning: "off here" },
  ],
  guide: { title: "Layer 3 Troubleshooting: ARP, Addressing & Forwarding", subtitle: "One host, two remote servers, one wrong assumption about what is local", tabs: GUIDE_TABS },
  briefing: { phases: L3_BRIEFING_PHASES, notes: L3_BRIEFING_NOTES },
  nodes: () => (Object.keys(POS) as L3Device[]).map((d) => ({ id: d, label: d, subLabel: SUB[d], x: POS[d].x, y: POS[d].y, kind: KIND[d] })),
  edges: () => [
    { id: "L-C", a: "CLIENT", b: "SW1", label: "eth0 · ge-0/0/1" },
    { id: "L-SW-R1", a: "SW1", b: "R1", label: "ge-0/0/24 · ge-0/0/0" },
    { id: "L-R1-R2", a: "R1", b: "R2", label: "192.0.2.0/31" },
    { id: "L-R2-S", a: "R2", b: "SERVER", label: "ge-0/0/1" },
    { id: "L-R2-RS", a: "R2", b: "REMOTE-SERVER", label: "ge-0/0/2" },
  ],
  regions: [
    { id: "lan", label: "10.10.10.0/24", x: 2, y: 22, width: 34, height: 64, tone: "cyan" },
    { id: "srv", label: "10.20.20.0/24", x: 80, y: 3, width: 19, height: 28, tone: "violet" },
    { id: "rem", label: "10.10.20.0/24", x: 80, y: 57, width: 19, height: 28, tone: "violet" },
  ],
  enterable: ["CLIENT", "SW1", "R1", "R2", "SERVER", "REMOTE-SERVER"],
  primaryDevice: { intro: "CLIENT", "host-decision": "CLIENT", "base-table": "CLIENT", "incident-intro": "CLIENT", "inc-decision": "CLIENT", "inc-arp-fail": "CLIENT", "inc-r1-stats": "R1", "inc-client-config": "CLIENT", "predict-cause": "CLIENT", "repair-challenge": "CLIENT", "ver-table": "CLIENT" },
  traceFor: (d, s, stepId) => l3TraceFor(d as L3Device, s, stepId),
  interfacesFor: (d, s, stepId) => l3InterfacesFor(d as L3Device, s, stepId),
  pipelineTitle: (d) => `${d} · ${d === "R1" || d === "R2" ? "IPv4 routing" : d === "SW1" ? "Ethernet switching" : "host IP stack"}`,
  explainNode: explainL3,
  tablesFor: (d, s) => l3Tables(d as L3Device, s),
  callout: l3Callout,
  repair: {
    stepId: "repair-challenge",
    prompt: `10.20.20.20 works through the gateway; for ${L3.remote}, CLIENT ARPs on its own segment and never sends an IPv4 packet. R1 and R2 routes are correct and REMOTE-SERVER answers R2. Which change fixes it?`,
    options: L3_REPAIR_OPTIONS.map((o) => ({ id: o.id, label: o.label })),
    correctId: L3_REPAIR_CORRECT,
    success: `CLIENT is ${L3.client}/${GOOD_PREFIX} again. Now prove it: watch which address CLIENT ARPs for, and follow the packet.`,
    wrongFeedback: {
      "r1-default": "R1 never receives the traffic — CLIENT decides the destination is on-link and never sends it to R1.",
      "clear-r2-arp": "R2 already reaches REMOTE-SERVER (5/5 from R2). Its ARP cache is not involved.",
      "restart-sw": "SW1 floods CLIENT's ARP broadcasts correctly. Nobody on this segment owns 10.10.20.20, restart or not.",
      "server-port": "No packet ever reaches REMOTE-SERVER, so no port is involved — and ping has no ports.",
      "disable-stp": "There is no loop and no blocked port; spanning tree has nothing to do with CLIENT's on-link decision.",
    },
    attempt: (s) => s.repairAttempt,
  },
  diagnostics: {
    fromStepId: "diagnostic-layers",
    layers: (s) => {
      const d = clientLookup(s.clientPrefix, L3.remote);
      return [
        { label: "Physical / Ethernet — all links up; SW1 forwards and floods normally", status: "healthy" },
        { label: `IP addressing — CLIENT ${L3.client}/${s.clientPrefix} (plan /${GOOD_PREFIX}); gateway ${L3.gw}`, status: s.clientPrefix === GOOD_PREFIX ? "healthy" : "failing" },
        { label: `CLIENT next hop for ${L3.remote} — ${routeText(d.route)} → ${d.onLink ? `ARP for ${L3.remote} itself` : `gateway ${L3.gw}`}`, status: d.onLink ? "failing" : "healthy" },
        { label: `ARP / neighbor — ${Object.keys(s.arpPending).length ? `${Object.keys(s.arpPending).join(", ")} INCOMPLETE` : "resolved"}`, status: Object.keys(s.arpPending).length ? "failing" : "healthy" },
        { label: `Routing — R1 ${rtText(rtLookup(R1_ROUTES, L3.remote)!)}; R2 connected ge-0/0/2`, status: "healthy" },
        { label: "REMOTE-SERVER — answers R2 (5/5)", status: "healthy" },
      ];
    },
  },
  sidePanel: (s) => (
    <div className="space-y-3">
      <L3Panel s={s} />
      <EvidenceNotebook entries={s.notebook} />
    </div>
  ),
  complete: { badge: "Lesson Complete", title: "You can read a host's routing decision", message: "Connected vs default routes, ARP for the next hop, gateway MAC with remote IP, TTL at routers only — and a wrong mask that made a remote server look local, fixed on the client and proven by the packet it never used to send." },
};

export default function TroubleshootingLayer3Demo() {
  return <FundamentalsLessonShell config={config} />;
}
