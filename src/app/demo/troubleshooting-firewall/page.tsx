"use client";

import { FundamentalsLessonShell, type FundamentalsLessonConfig } from "@/components/lesson/FundamentalsLessonShell";
import { EvidenceNotebook } from "@/components/lesson/EvidenceNotebook";
import type { LessonGuideTab } from "@/components/lesson/LessonGuideDialog";
import type { PacketCallout3D } from "@/components/network3d/types";
import type { PacketVisual } from "@/lib/sim-engine/types";
import { fieldIn, tcpField } from "@/lib/sim-engine/scenarios/enterpriseEdgePackets";
import { FW_REPAIR_CORRECT, FW_REPAIR_OPTIONS, IP, createFwState, fwSteps, sessionOf, type FwDevice, type FwState } from "@/lib/sim-engine/scenarios/troubleshootingFirewall";
import { FW_BRIEFING_NOTES, FW_BRIEFING_PHASES } from "./briefing";
import { fwInterfacesFor, fwTraceFor } from "./deviceTrace";
import { explainFw, fwTables } from "./explain";
import { FirewallPanel } from "./FirewallPanel";
import { FW_LESSON_SECTIONS, FwLessonGuideContent } from "./LessonGuideContent";
import { FW_DEEP_DIVE_SECTIONS, FwDeepDiveContent } from "./DeepDiveContent";

const GUIDE_TABS: LessonGuideTab[] = [
  { id: "lesson", label: "This Lesson", hint: "CLIENT · EDGE-R1 · FW1 / FW2 · EDGE-R2 · SERVER — allowed, answered, never completed", sections: FW_LESSON_SECTIONS, content: <FwLessonGuideContent /> },
  { id: "deep", label: "Firewall Deep Dive", hint: "Zones, policy vs session, state table, asymmetric routing, logs, NAT context", sections: FW_DEEP_DIVE_SECTIONS, content: <FwDeepDiveContent /> },
];

function fwCallout(p: PacketVisual, s: FwState): PacketCallout3D {
  const decision = s.decision && (s.decision.device === p.from || s.decision.device === p.to) ? s.decision.text : undefined;
  return { title: `TCP ${p.badge} · ${tcpField(p, "Source Port")} → ${tcpField(p, "Destination Port")}`, detail: [`seq ${tcpField(p, "Sequence Number")}${p.badge !== "SYN" ? ` · ack ${tcpField(p, "Acknowledgment Number").split(" ")[0]}` : ""}`, `TTL ${fieldIn(p, /^IPv4/, "TTL")}`, `${p.from} → ${p.to}`, decision].filter(Boolean).join(" · "), color: "#34d399" };
}

const POS: Record<FwDevice, { x: number; y: number; kind: "laptop" | "router" | "firewall" | "server" }> = {
  CLIENT: { x: 7, y: 50, kind: "laptop" },
  "EDGE-R1": { x: 27, y: 50, kind: "router" },
  FW1: { x: 50, y: 20, kind: "firewall" },
  FW2: { x: 50, y: 80, kind: "firewall" },
  "EDGE-R2": { x: 73, y: 50, kind: "router" },
  SERVER: { x: 93, y: 50, kind: "server" },
};
const SUB: Record<FwDevice, string> = { CLIENT: IP.client, "EDGE-R1": IP.r1Lan, FW1: "stateful", FW2: "stateful", "EDGE-R2": IP.r2Lan, SERVER: `${IP.server}:443` };

const config: FundamentalsLessonConfig<FwState> = {
  lessonId: "troubleshooting-firewall",
  xp: 250,
  steps: fwSteps,
  createState: createFwState,
  badge: "Troubleshooting · Firewall",
  title: "Firewall Troubleshooting: Policy, Sessions & Asymmetric Paths",
  intro: "The firewall permitted the connection and the server answered — yet the client never connects. Read the evidence a stateful firewall leaves behind: policy logs, session state and counters in each direction, drop reasons — and the routes on both sides that decide which firewall a reply meets.",
  facts: [
    { q: "When is policy checked?", a: "For new flows — a SYN with no session." },
    { q: "How do replies pass?", a: "By matching the session on the reversed five-tuple." },
    { q: "What breaks it?", a: "A reply arriving at a firewall that never saw the request." },
    { q: "NAT here?", a: "None — every address and port is real on every link." },
  ],
  terms: [
    { term: "Session", expansion: "Per-flow state", meaning: "tuple · TCP state · counters" },
    { term: "Zone", expansion: "Interface group", meaning: "trust / dmz" },
    { term: "Out-of-state", expansion: "No matching session", meaning: "non-SYN dropped" },
    { term: "Asymmetric path", expansion: "Different return path", meaning: "breaks state" },
    { term: "Five-tuple", expansion: "Flow identity", meaning: "proto · IPs · ports" },
  ],
  guide: { title: "Firewall Troubleshooting: Policy, Sessions & Asymmetric Paths", subtitle: "Two independent stateful firewalls · no NAT · one return route", tabs: GUIDE_TABS },
  briefing: { phases: FW_BRIEFING_PHASES, notes: FW_BRIEFING_NOTES },
  nodes: () => (Object.keys(POS) as FwDevice[]).map((d) => ({ id: d, label: d, subLabel: SUB[d], x: POS[d].x, y: POS[d].y, kind: POS[d].kind })),
  edges: () => [
    { id: "L-C", a: "CLIENT", b: "EDGE-R1", label: "10.10.10.0/24" },
    { id: "L-R1-F1", a: "EDGE-R1", b: "FW1", label: "trust" },
    { id: "L-R1-F2", a: "EDGE-R1", b: "FW2", label: "trust" },
    { id: "L-F1-R2", a: "FW1", b: "EDGE-R2", label: "dmz" },
    { id: "L-F2-R2", a: "FW2", b: "EDGE-R2", label: "dmz" },
    { id: "L-S", a: "EDGE-R2", b: "SERVER", label: "10.20.20.0/24" },
  ],
  enterable: ["CLIENT", "EDGE-R1", "FW1", "FW2", "EDGE-R2", "SERVER"],
  primaryDevice: { intro: "FW1", design: "FW1", "incident-intro": "CLIENT", "inc-fw1-session": "FW1", "inc-routes": "EDGE-R2", hypotheses: "FW1", "predict-cause": "EDGE-R2", "repair-challenge": "EDGE-R2" },
  traceFor: (d, s, stepId) => fwTraceFor(d as FwDevice, s, stepId),
  interfacesFor: (d, s, stepId) => fwInterfacesFor(d as FwDevice, s, stepId),
  pipelineTitle: (d) => `${d} · ${d.startsWith("FW") ? "session → route → policy → state" : d.startsWith("EDGE") ? "routing" : "TCP host"}`,
  explainNode: explainFw,
  tablesFor: (d, s) => fwTables(d as FwDevice, s),
  callout: fwCallout,
  nodeBadges: (id, s) => (id === "FW1" || id === "FW2" ? [`${s.sessions[id].length} session${s.sessions[id].length === 1 ? "" : "s"}`] : undefined),
  repair: {
    stepId: "repair-challenge",
    prompt: "FW1 permitted the SYN and holds a half-open session with zero reverse packets; SERVER received the SYN and sent SYN-ACKs; FW2 dropped them with 'no matching session'; EDGE-R2 routes 10.10.10.0/24 via FW2. Which change fixes it?",
    options: FW_REPAIR_OPTIONS.map((o) => ({ id: o.id, label: o.label })),
    correctId: FW_REPAIR_CORRECT,
    success: "EDGE-R2 routes the client subnet via FW1 again. Now prove it: a new connection, and the reply meeting FW1's session.",
    wrongFeedback: {
      "fw2-allow": "FW2 would pass the SYN-ACK, but it still has no session, and the client's ACK goes through FW1, which never saw the SYN-ACK. You would weaken security and still not get a clean flow.",
      stateless: "Turning off state inspection removes the protection the firewall exists for — and leaves the routing asymmetry in place.",
      "restart-fw1": "FW1 behaves correctly: it permitted the SYN and is waiting for a reply that is routed elsewhere.",
      "clear-dns": "The client connects by IP and its SYN is on the wire. DNS is not involved.",
      "server-port": "The server answers on 443 — its SYN-ACKs are in the capture. The port is fine.",
      nat: "There is no NAT in this design, and adding it would not change which firewall EDGE-R2 sends replies to.",
    },
    attempt: (s) => s.repairAttempt,
  },
  diagnostics: {
    fromStepId: "diagnostic-layers",
    layers: (s) => {
      const inc = sessionOf(s, "FW1", "incident");
      return [
        { label: "Physical / IP — CLIENT's SYN reaches SERVER (server capture)", status: "healthy" },
        { label: "FW1 policy — ALLOW-WEB permit, session created", status: "healthy" },
        { label: `Return routing — EDGE-R2 10.10.10.0/24 → ${s.r2Return}`, status: s.r2Return === "FW1" ? "healthy" : "failing" },
        { label: `FW2 — ${s.drops.FW2.length} SYN-ACK drop(s): no matching session`, status: s.r2Return === "FW1" ? "healthy" : "failing" },
        { label: `Transport — incident session ${inc ? `${inc.state}, s→c ${inc.s2c}` : "—"}`, status: s.repaired ? "healthy" : "failing" },
      ];
    },
  },
  sidePanel: (s) => (
    <div className="space-y-3">
      <FirewallPanel s={s} />
      <EvidenceNotebook entries={s.notebook} />
    </div>
  ),
  complete: { badge: "Lesson Complete", title: "You can read a stateful firewall", message: "Policy allowed the SYN, the server answered — and one return route sent the answer to a firewall with no state. Found with session counters, drop logs and both directions' routes; fixed by restoring path symmetry; proven by an ESTABLISHED session with traffic both ways." },
};

export default function TroubleshootingFirewallDemo() {
  return <FundamentalsLessonShell config={config} />;
}
