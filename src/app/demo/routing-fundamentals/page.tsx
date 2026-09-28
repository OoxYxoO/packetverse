"use client";

import { FundamentalsLessonShell, type FundamentalsLessonConfig } from "@/components/lesson/FundamentalsLessonShell";
import { fundamentalsCallout } from "@/components/lesson/fundamentalsCallout";
import type { LessonGuideTab } from "@/components/lesson/LessonGuideDialog";
import { RT_ADDR, RT_REPAIR_CORRECT, RT_REPAIR_OPTIONS, createRtState, matchingRoutes, routeKey, routingFundamentalsSteps, type RtDevice, type RtState } from "@/lib/sim-engine/scenarios/routingFundamentals";
import { RT_BRIEFING_NOTES, RT_BRIEFING_PHASES } from "./briefing";
import { rtInterfacesFor, rtTraceFor } from "./deviceTrace";
import { explainRt, rtTables } from "./explain";
import { rtNames } from "./addressNames";
import { RoutingTablePanel } from "./RoutingTablePanel";
import { RT_LESSON_SECTIONS, RoutingLessonGuideContent } from "./LessonGuideContent";
import { RT_DEEP_DIVE_SECTIONS, RoutingDeepDiveContent } from "./DeepDiveContent";

const GUIDE_TABS: LessonGuideTab[] = [
  { id: "lesson", label: "This Lesson", hint: "HOST-A → R1 → R2 → SERVER-A/B · connected, static, default · longest prefix · a /25 discard incident", sections: RT_LESSON_SECTIONS, content: <RoutingLessonGuideContent /> },
  { id: "deep", label: "Routing Fundamentals Deep Dive", hint: "Routing tables and IPv4 forwarding decisions in general", sections: RT_DEEP_DIVE_SECTIONS, content: <RoutingDeepDiveContent /> },
];

const config: FundamentalsLessonConfig<RtState> = {
  lessonId: "routing-fundamentals",
  xp: 200,
  steps: routingFundamentalsSteps,
  createState: createRtState,
  badge: "Fundamentals · Layer 3",
  title: "Routing Fundamentals: Static Routes & Longest Prefix Match",
  intro: "Read R1's and R2's routing tables, watch longest-prefix match choose between /24, /16 and /0, follow a new Ethernet frame and TTL − 1 at every router — then find the route that silently drops half of a /24.",
  facts: [
    { q: "Where do routes come from?", a: "Connected interfaces, and static routes an operator configures. No routing protocol here." },
    { q: "Which route wins?", a: "Of all installed routes that contain the destination, the longest prefix." },
    { q: "What is a next hop?", a: "The neighbour to hand the packet to. It never replaces the IPv4 destination." },
    { q: "What changes per router?", a: "A new Ethernet frame, TTL − 1 and a recomputed header checksum." },
  ],
  terms: [
    { term: "LPM", expansion: "Longest prefix match", meaning: "Most specific route wins" },
    { term: "Static", expansion: "Operator-configured route", meaning: "Prefix + next hop" },
    { term: "0.0.0.0/0", expansion: "Default route", meaning: "Matches everything, wins last" },
    { term: "Next hop", expansion: "Neighbour router address", meaning: "Resolved via a connected route" },
    { term: "Discard", expansion: "Blackhole / discard route", meaning: "Matching packets dropped here" },
  ],
  guide: { title: "Routing Fundamentals: Static Routes & Longest Prefix Match", subtitle: `HOST-A ${RT_ADDR["HOST-A"]} → R1 ${RT_ADDR["R1:TRANSIT"]} ↔ R2 ${RT_ADDR["R2:TRANSIT"]} → SERVER-A ${RT_ADDR["SERVER-A"]} · SERVER-B ${RT_ADDR["SERVER-B"]}`, tabs: GUIDE_TABS },
  briefing: { phases: RT_BRIEFING_PHASES, notes: RT_BRIEFING_NOTES },
  nodes: () => [
    { id: "HOST-A", label: "HOST-A", subLabel: RT_ADDR["HOST-A"], x: 8, y: 50, kind: "laptop" },
    { id: "R1", label: "R1", subLabel: "gw 10.10.10.1", x: 29, y: 50, kind: "router" },
    { id: "R2", label: "R2", subLabel: "gw 172.16.50.1", x: 53, y: 50, kind: "router" },
    { id: "SERVER-A", label: "SERVER-A", subLabel: RT_ADDR["SERVER-A"], x: 77, y: 27, kind: "server" },
    { id: "SERVER-B", label: "SERVER-B", subLabel: RT_ADDR["SERVER-B"], x: 87, y: 80, kind: "server" },
  ],
  edges: () => [
    { id: "a-r1", a: "HOST-A", b: "R1", label: "10.10.10.0/24" },
    { id: "r1-r2", a: "R1", b: "R2", label: "10.0.12.0/30" },
    { id: "r2-sa", a: "R2", b: "SERVER-A", label: "ge-0/0/0" },
    { id: "r2-sb", a: "R2", b: "SERVER-B", label: "ge-0/0/0" },
  ],
  regions: [{ id: "srv-lan", label: "Server LAN 172.16.50.0/24", x: 67, y: 5, width: 31, height: 91, tone: "violet" }],
  enterable: ["R1", "R2"],
  primaryDevice: { "connected-routes": "R1", "static-routes": "R1", "server-a-receives": "SERVER-A", "a-receives": "HOST-A", "default-r2": "R2", "incident-intro": "R1", "fault-a-r1": "R1", "repair-challenge": "R1" },
  traceFor: (d, s, stepId) => rtTraceFor(d as RtDevice, s, stepId),
  interfacesFor: (d, s, stepId) => rtInterfacesFor(d as RtDevice, s, stepId),
  pipelineTitle: (d) => `${d} · IPv4 forwarding pipeline`,
  explainNode: explainRt,
  tablesFor: (d, s) => rtTables(d as RtDevice, s),
  callout: (p, s) => fundamentalsCallout(p, rtNames, { decision: s.note && (s.note.device === p.from || s.note.device === p.to) ? s.note.text : undefined }),
  repair: {
    stepId: "repair-challenge",
    prompt: "R1 drops traffic for SERVER-A but not SERVER-B. Which change fixes it?",
    options: RT_REPAIR_OPTIONS.map((o) => ({ id: o.id, label: o.label })),
    correctId: RT_REPAIR_CORRECT,
    success: "The /25 discard route is gone. For 172.16.50.50 the longest valid match is the existing 172.16.50.0/24 via 10.0.12.2 again.",
    wrongFeedback: {
      "change-default": "The default route is a /0. It wins only when nothing longer matches — and the /25 matches SERVER-A with 25 fixed bits.",
      "add-16": "Another /16 is less specific than the /25 (16 fixed bits against 25). The /25 still wins for SERVER-A.",
      "raise-ttl": "R1 drops the packet at route selection while its TTL is still 64. TTL is not what stops it.",
      "flush-arp": "ARP resolves a next hop after a route is selected. The selected route here is a discard route, so there is no next hop to resolve.",
    },
    attempt: (s) => s.repairAttempt,
  },
  diagnostics: {
    fromStepId: "diagnostic-layers",
    layers: (s) => {
      const win = matchingRoutes(s.rib.R1, RT_ADDR["SERVER-A"])[0];
      return [
        { label: "L1/L2 — every interface up · next-hop ARP entries resolved", status: "healthy" },
        { label: "R1 — 172.16.50.0/24 via 10.0.12.2 is installed", status: s.rib.R1.some((r) => routeKey(r) === "172.16.50.0/24") ? "healthy" : "failing" },
        { label: `R1 — longest match for 172.16.50.50: ${win ? `${routeKey(win)}${win.discard ? " (discard)" : ""}` : "none"}`, status: win?.discard ? "failing" : "healthy" },
        { label: "R2 — connected 172.16.50.0/24 · return route 10.10.10.0/24", status: "healthy" },
      ];
    },
  },
  sidePanel: (s) => <RoutingTablePanel s={s} />,
  complete: { badge: "Lesson Complete", title: "You can read a routing table like a router", message: "Connected, static and default routes, longest-prefix match, recursive next hops, a new frame per hop — and a /25 discard route found and removed." },
};

export default function RoutingFundamentalsDemo() {
  return <FundamentalsLessonShell config={config} />;
}
