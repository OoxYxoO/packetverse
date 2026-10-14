"use client";

import { FundamentalsLessonShell, type FundamentalsLessonConfig } from "@/components/lesson/FundamentalsLessonShell";
import { EvidenceNotebook } from "@/components/lesson/EvidenceNotebook";
import type { LessonGuideTab } from "@/components/lesson/LessonGuideDialog";
import type { PacketCallout3D } from "@/components/network3d/types";
import type { PacketVisual } from "@/lib/sim-engine/types";
import { fieldOf } from "@/lib/sim-engine/scenarios/fundamentalsPackets";
import { IP, RT_REPAIR_CORRECT, RT_REPAIR_OPTIONS, createRtState, fibLookup, hasDiscard, routeKey, rtSteps, type RtDevice, type RtState } from "@/lib/sim-engine/scenarios/troubleshootingRouting";
import { RT_BRIEFING_NOTES, RT_BRIEFING_PHASES } from "./briefing";
import { rtInterfacesFor, rtTraceFor } from "./deviceTrace";
import { explainRt, rtTables } from "./explain";
import { RoutingPanel } from "./RoutingPanel";
import { RT_LESSON_SECTIONS, RtLessonGuideContent } from "./LessonGuideContent";
import { RT_DEEP_DIVE_SECTIONS, RtDeepDiveContent } from "./DeepDiveContent";

const GUIDE_TABS: LessonGuideTab[] = [
  { id: "lesson", label: "This Lesson", hint: "CLIENT · R1 · R2 · R3 · two servers — OSPF healthy, one server unreachable", sections: RT_LESSON_SECTIONS, content: <RtLessonGuideContent /> },
  { id: "deep", label: "Routing Deep Dive", hint: "RIB vs FIB, longest prefix, preference, recursion, discard/reject, traceroute", sections: RT_DEEP_DIVE_SECTIONS, content: <RtDeepDiveContent /> },
];

function rtCallout(p: PacketVisual, s: RtState): PacketCallout3D {
  const decision = s.decision && (s.decision.device === p.from || s.decision.device === p.to) ? s.decision.text : undefined;
  const type = fieldOf(p, /^ICMP/, "Type").split(" ")[0];
  return { title: `ICMP ${type === "8" ? "Echo Request" : "Echo Reply"} · ${fieldOf(p, /^IPv4/, "Source")} → ${fieldOf(p, /^IPv4/, "Destination")}`, detail: [`TTL ${fieldOf(p, /^IPv4/, "TTL")}`, `${p.from} → ${p.to}`, decision].filter(Boolean).join(" · "), color: "#60a5fa" };
}

const POS: Record<RtDevice, { x: number; y: number; kind: "laptop" | "router" | "server" }> = {
  CLIENT: { x: 8, y: 50, kind: "laptop" },
  R1: { x: 29, y: 50, kind: "router" },
  R2: { x: 50, y: 50, kind: "router" },
  R3: { x: 71, y: 50, kind: "router" },
  "SERVER-A": { x: 91, y: 22, kind: "server" },
  "SERVER-B": { x: 91, y: 78, kind: "server" },
};
const SUB: Record<RtDevice, string> = { CLIENT: IP.client, R1: IP.r1Lan, R2: "OSPF", R3: IP.r3Lan, "SERVER-A": IP.srvA, "SERVER-B": IP.srvB };

const config: FundamentalsLessonConfig<RtState> = {
  lessonId: "troubleshooting-routing",
  xp: 250,
  steps: rtSteps,
  createState: createRtState,
  badge: "Troubleshooting · Routing",
  title: "Routing Troubleshooting: Route Selection & Blackholes",
  intro: "OSPF is Full, the LSDB is synchronized and the server subnet is in the routing table — yet one server is unreachable while its neighbor on the same subnet works. Follow the router's own forwarding decision: every matching route, the longest prefix, and what the winning entry actually does.",
  facts: [
    { q: "Which route is used?", a: "The longest matching prefix in the FIB — for that exact address." },
    { q: "When does preference matter?", a: "Only between routes for the same prefix and length." },
    { q: "Is OSPF Full proof of forwarding?", a: "No — other sources compete in the same RIB." },
    { q: "Discard vs reject?", a: "Discard drops silently; reject returns ICMP unreachable." },
  ],
  terms: [
    { term: "RIB", expansion: "Routing Information Base", meaning: "all usable routes" },
    { term: "FIB", expansion: "Forwarding table", meaning: "best per prefix" },
    { term: "LPM", expansion: "Longest-prefix match", meaning: "most specific wins" },
    { term: "Preference / AD", expansion: "Route-source rank", meaning: "equal prefixes only" },
    { term: "Discard", expansion: "Null route", meaning: "silent drop" },
  ],
  guide: { title: "Routing Troubleshooting: Route Selection & Blackholes", subtitle: "OSPF area 0 · one /24 · one forgotten /32", tabs: GUIDE_TABS },
  briefing: { phases: RT_BRIEFING_PHASES, notes: RT_BRIEFING_NOTES },
  nodes: () => (Object.keys(POS) as RtDevice[]).map((d) => ({ id: d, label: d, subLabel: SUB[d], x: POS[d].x, y: POS[d].y, kind: POS[d].kind })),
  edges: () => [
    { id: "L-C-R1", a: "CLIENT", b: "R1", label: "10.10.10.0/24" },
    { id: "L-R1-R2", a: "R1", b: "R2", label: "192.0.2.0/31" },
    { id: "L-R2-R3", a: "R2", b: "R3", label: "192.0.2.2/31" },
    { id: "L-R3-SA", a: "R3", b: "SERVER-A", label: "server LAN" },
    { id: "L-R3-SB", a: "R3", b: "SERVER-B", label: "server LAN" },
  ],
  regions: [
    { id: "ospf", label: "OSPF area 0", x: 20, y: 30, width: 60, height: 40, tone: "violet" },
    { id: "lan", label: "172.16.20.0/24", x: 82, y: 6, width: 17, height: 88, tone: "cyan" },
  ],
  enterable: ["CLIENT", "R1", "R2", "R3", "SERVER-A", "SERVER-B"],
  primaryDevice: { intro: "R1", "ospf-state": "R1", "base-rib": "R1", "incident-intro": "CLIENT", "inc-ospf": "R1", "inc-r2-counters": "R2", "inc-trace": "CLIENT", "inc-rib-fib": "R1", "inc-config": "R1", "predict-cause": "R1", "repair-challenge": "R1", "ver-rib": "R1" },
  traceFor: (d, s, stepId) => rtTraceFor(d as RtDevice, s, stepId),
  interfacesFor: (d, s, stepId) => rtInterfacesFor(d as RtDevice, s, stepId),
  pipelineTitle: (d) => `${d} · ${d.startsWith("R") ? "RIB → FIB → forward/discard" : "host"}`,
  explainNode: explainRt,
  tablesFor: (d, s) => rtTables(d as RtDevice, s),
  callout: rtCallout,
  nodeBadges: (id) => (id === "R1" || id === "R2" || id === "R3" ? ["OSPF Full"] : undefined),
  repair: {
    stepId: "repair-challenge",
    prompt: "OSPF is Full and unchanged, SERVER-B works, SERVER-A answers R3, and R1's lookup for 172.16.20.20 selects 172.16.20.20/32 discard. Which change fixes it?",
    options: RT_REPAIR_OPTIONS.map((o) => ({ id: o.id, label: o.label })),
    correctId: RT_REPAIR_CORRECT,
    success: "The /32 discard is gone. Now prove it: look up 172.16.20.20 again and follow the packet past R1.",
    wrongFeedback: {
      "restart-ospf": "OSPF is Full with an unchanged LSDB. Restarting it causes an outage and leaves the static /32 exactly where it is.",
      "lower-metric": "The OSPF /24 is already installed. No metric can make a /24 beat a /32 for 172.16.20.20.",
      "clear-arp": "The packet never gets as far as needing a next-hop MAC — R1's FIB action is discard.",
      "restart-r2": "R2 never receives SERVER-A's packets. It is healthy and uninvolved.",
      "server-gw": "SERVER-A answers R3 and its replies are fine; the requests never reach it.",
      default: "A default route is the least specific match of all (/0). The /32 still wins.",
    },
    attempt: (s) => s.repairAttempt,
  },
  diagnostics: {
    fromStepId: "diagnostic-layers",
    layers: (s) => {
      const a = fibLookup(s.r1Rib, IP.srvA).chosen!;
      return [
        { label: "Physical / Ethernet — all links up; SERVER-B path works", status: "healthy" },
        { label: "IP addressing — CLIENT, servers and /31s correct; SERVER-A answers R3", status: "healthy" },
        { label: "OSPF — adjacencies Full, LSDB unchanged, 172.16.20.0/24 installed", status: "healthy" },
        { label: `R1 forwarding for ${IP.srvA} — ${routeKey(a)} ${a.action === "discard" ? "discard" : `via ${a.nextHop}`}`, status: a.action === "discard" ? "failing" : "healthy" },
        { label: `Reachability — SERVER-A ${s.pings.filter((p) => p.dst === IP.srvA).at(-1)?.received ?? "?"}/5 · SERVER-B ${s.pings.filter((p) => p.dst === IP.srvB).at(-1)?.received ?? "?"}/5`, status: hasDiscard(s) ? "failing" : "healthy" },
      ];
    },
  },
  sidePanel: (s) => (
    <div className="space-y-3">
      <RoutingPanel s={s} />
      <EvidenceNotebook entries={s.notebook} />
    </div>
  ),
  complete: { badge: "Lesson Complete", title: "You can read a router's decision", message: "Healthy OSPF, a correct /24 — and a forgotten /32 discard that won longest-prefix match for one address. Scoped by a working neighbor, located by the router's own lookup, repaired by removing one route, proven by the packets that now reach the server." },
};

export default function TroubleshootingRoutingDemo() {
  return <FundamentalsLessonShell config={config} />;
}
