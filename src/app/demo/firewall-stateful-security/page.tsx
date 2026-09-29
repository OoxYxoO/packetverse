"use client";

import { FundamentalsLessonShell, type FundamentalsLessonConfig } from "@/components/lesson/FundamentalsLessonShell";
import { fundamentalsCallout } from "@/components/lesson/fundamentalsCallout";
import type { LessonGuideTab } from "@/components/lesson/LessonGuideDialog";
import type { PacketCallout3D } from "@/components/network3d/types";
import type { PacketVisual } from "@/lib/sim-engine/types";
import { fieldIn } from "@/lib/sim-engine/scenarios/enterpriseEdgePackets";
import { FW, FW_REPAIR_CORRECT, FW_REPAIR_OPTIONS, createFwState, firewallSteps, isTcp, latestSession, lookupRoute, FW1_ROUTES, ISP_ROUTES, tcpField, type FwDevice, type FwState } from "@/lib/sim-engine/scenarios/firewallStateful";
import { FW_BRIEFING_NOTES, FW_BRIEFING_PHASES } from "./briefing";
import { fwInterfacesFor, fwTraceFor } from "./deviceTrace";
import { explainFw, fwTables } from "./explain";
import { fwNames } from "./addressNames";
import { FirewallSessionPanel } from "./FirewallSessionPanel";
import { FW_LESSON_SECTIONS, FwLessonGuideContent } from "./LessonGuideContent";
import { FW_DEEP_DIVE_SECTIONS, FwDeepDiveContent } from "./DeepDiveContent";

const GUIDE_TABS: LessonGuideTab[] = [
  { id: "lesson", label: "This Lesson", hint: "CLIENT · FW1 · ISP · WEB-SERVER · policy, sessions, source NAT and a bad-NAT incident", sections: FW_LESSON_SECTIONS, content: <FwLessonGuideContent /> },
  { id: "deep", label: "Stateful Firewall Deep Dive", hint: "Stateful filtering and NAT in general — vendor-neutral", sections: FW_DEEP_DIVE_SECTIONS, content: <FwDeepDiveContent /> },
];

const TCP_HEX = "#34d399";
function fwCallout(p: PacketVisual, s: FwState): PacketCallout3D {
  const decision = s.decision && (s.decision.device === p.from || s.decision.device === p.to) ? s.decision.text : undefined;
  if (!isTcp(p)) return fundamentalsCallout(p, fwNames, { decision });
  const src = fieldIn(p, /^IPv4 Header$/, "Source");
  const dst = fieldIn(p, /^IPv4 Header$/, "Destination");
  const ack = tcpField(p, "Acknowledgment Number");
  return {
    title: `TCP ${p.badge} · ${src}:${tcpField(p, "Source Port")} → ${dst}:${tcpField(p, "Destination Port")}`,
    detail: [`seq ${tcpField(p, "Sequence Number")}`, /^\d+$/.test(ack) ? `ack ${ack}` : undefined, `TTL ${fieldIn(p, /^IPv4 Header$/, "TTL")}`, decision].filter(Boolean).join(" · "),
    color: TCP_HEX,
  };
}

const config: FundamentalsLessonConfig<FwState> = {
  lessonId: "firewall-stateful-security",
  xp: 200,
  steps: firewallSteps,
  createState: createFwState,
  badge: "Enterprise · Security",
  title: "Stateful Firewall: Policy, Sessions & Source NAT",
  intro: "Follow one HTTPS connection through a firewall that routes, enforces zone policy, tracks TCP sessions and translates the client's private source. Then watch an unsolicited connection get dropped — and an outage that policy logs say is ALLOWED.",
  facts: [
    { q: "Does allow mean it works?", a: "No. Routing, NAT and the return path must work too — policy is one check of several." },
    { q: "Why do replies get in?", a: "They match an existing session in reverse. No broad inbound rule is needed." },
    { q: "What does source NAT change?", a: "The source address and port only — and so both checksums. Never the destination." },
    { q: "What stops unsolicited traffic?", a: "No session, no publishing rule, no allowing policy → the implicit default deny." },
  ],
  terms: [
    { term: "Zone", expansion: "Security zone", meaning: "Interfaces grouped by trust" },
    { term: "Session", expansion: "Flow state entry", meaning: "5-tuple, NAT, TCP state" },
    { term: "SNAT / PAT", expansion: "Source NAT + port translation", meaning: "Many clients, one public address" },
    { term: "Default deny", expansion: "Implicit last rule", meaning: "Drops anything not allowed" },
    { term: "5-tuple", expansion: "Proto · src/dst IP · ports", meaning: "Identifies a flow" },
  ],
  guide: { title: "Stateful Firewall: Policy, Sessions & Source NAT", subtitle: `trust 10.10.10.0/24 · untrust ${FW.untrust}/30 · WEB ${FW.web}:443`, tabs: GUIDE_TABS },
  briefing: { phases: FW_BRIEFING_PHASES, notes: FW_BRIEFING_NOTES },
  nodes: (s) => {
    const last = latestSession(s);
    return [
      { id: "CLIENT", label: "CLIENT", subLabel: FW.client, x: 9, y: 50, kind: "laptop" },
      { id: "FW1", label: "FW1", subLabel: last ? `session ${last.id} ${last.state}` : "no sessions", x: 36, y: 50, kind: "firewall" },
      { id: "ISP", label: "ISP", subLabel: FW.ispFw, x: 64, y: 50, kind: "router" },
      { id: "WEB-SERVER", label: "WEB-SERVER", subLabel: `${FW.web}:443`, x: 91, y: 50, kind: "server" },
    ];
  },
  edges: () => [
    { id: "c-fw", a: "CLIENT", b: "FW1", label: "trust · 10.10.10.0/24" },
    { id: "fw-isp", a: "FW1", b: "ISP", label: "untrust · /30" },
    { id: "isp-web", a: "ISP", b: "WEB-SERVER", label: "203.0.113.0/24" },
  ],
  regions: [
    { id: "trust", label: "zone trust", x: 2, y: 24, width: 27, height: 52, tone: "cyan" },
    { id: "untrust", label: "zone untrust → Internet", x: 44, y: 24, width: 54, height: 52, tone: "warning" },
  ],
  enterable: ["FW1", "ISP"],
  primaryDevice: { zones: "FW1", routes: "FW1", "policy-table": "FW1", "nat-rule": "FW1", "session-table": "FW1", "fw-deny": "FW1", "incident-intro": "FW1", "inc-isp-drop": "ISP", "inc-stuck": "FW1", "repair-challenge": "FW1" },
  traceFor: (d, s, stepId) => fwTraceFor(d as FwDevice, s, stepId),
  interfacesFor: (d, s, stepId) => fwInterfacesFor(d as FwDevice, s, stepId),
  pipelineTitle: (d) => (d === "FW1" ? "FW1 · session → route → policy → NAT (this lesson's model)" : `${d} · IP routing`),
  explainNode: explainFw,
  tablesFor: (d, s) => fwTables(d as FwDevice, s),
  callout: fwCallout,
  nodeBadges: (id, s) => (id === "FW1" ? [`SNAT ${s.natAddr}`] : undefined),
  repair: {
    stepId: "repair-challenge",
    prompt: "Policy allows the flow, yet the handshake never completes. Which change fixes it?",
    options: FW_REPAIR_OPTIONS.map((o) => ({ id: o.id, label: o.label })),
    correctId: FW_REPAIR_CORRECT,
    success: "SNAT-OUT translates to 198.51.100.2 again — FW1's own untrust address, inside the /30 the ISP routes back. The stale half-open session is cleared, so the retry builds a fresh one.",
    wrongFeedback: {
      "allow-any": "ALLOW-WEB already allows every attempt. A broader rule changes nothing about where the server's replies go — and weakens the policy.",
      "clear-arp": "FW1 reaches the ISP fine; the SYN leaves and arrives. The reply never comes back to FW1 at all, so its ARP cache is not involved.",
      "raise-ttl": "The SYN reaches the server with TTL to spare. TTL has nothing to do with where replies are routed.",
      "port-80": "That changes the application instead of fixing the translation — replies to 198.51.100.99 would still have no route home.",
    },
    attempt: (s) => s.repairAttempt,
  },
  diagnostics: {
    fromStepId: "diagnostic-layers",
    layers: (s) => {
      const natOk = s.natAddr === FW.untrust;
      const ispRoute = lookupRoute(ISP_ROUTES, s.natAddr);
      const last = latestSession(s);
      return [
        { label: `Routing — FW1 default route ${lookupRoute(FW1_ROUTES, FW.web).nextHop ? "via 198.51.100.1 present" : "missing"}`, status: "healthy" },
        { label: "Security policy — ALLOW-WEB matches TCP/443 (allow)", status: "healthy" },
        { label: `Source NAT — translates to ${s.natAddr} ${natOk ? "(FW1's untrust address)" : "(not an address of FW1)"}`, status: natOk ? "healthy" : "failing" },
        { label: `Return path — ISP route to ${s.natAddr}: ${ispRoute ? `${ispRoute.prefix}/${ispRoute.len} → FW1` : "none"}`, status: ispRoute ? "healthy" : "failing" },
        { label: `Session — ${last ? `${last.id} ${last.state}` : "none"}`, status: last && last.state === "ESTABLISHED" ? "healthy" : last ? "failing" : "healthy" },
      ];
    },
  },
  sidePanel: (s) => <FirewallSessionPanel s={s} />,
  complete: { badge: "Lesson Complete", title: "You can separate routing, policy, state and NAT", message: "Zone policy with a default deny, sessions that admit only their own replies, source NAT that rewrites the source tuple and both checksums — and an outage that was never a policy problem." },
};

export default function FirewallStatefulDemo() {
  return <FundamentalsLessonShell config={config} />;
}
