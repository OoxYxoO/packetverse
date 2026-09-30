"use client";

import { FundamentalsLessonShell, type FundamentalsLessonConfig } from "@/components/lesson/FundamentalsLessonShell";
import { EvidenceNotebook } from "@/components/lesson/EvidenceNotebook";
import type { LessonGuideTab } from "@/components/lesson/LessonGuideDialog";
import type { PacketCallout3D } from "@/components/network3d/types";
import type { PacketVisual } from "@/lib/sim-engine/types";
import { fieldIn, tcpField } from "@/lib/sim-engine/scenarios/enterpriseEdgePackets";
import { FLOW, PA, PA_REPAIR_CORRECT, PA_REPAIR_OPTIONS, createPaState, ifKey, isArp, paSteps, type PaDevice, type PaState } from "@/lib/sim-engine/scenarios/troubleshootingPacketAnalysis";
import { PA_BRIEFING_NOTES, PA_BRIEFING_PHASES } from "./briefing";
import { paInterfacesFor, paTraceFor } from "./deviceTrace";
import { explainPa, paTables } from "./explain";
import { CapturePanel } from "./CapturePanel";
import { PA_LESSON_SECTIONS, PaLessonGuideContent } from "./LessonGuideContent";
import { PA_DEEP_DIVE_SECTIONS, PaDeepDiveContent } from "./DeepDiveContent";

const GUIDE_TABS: LessonGuideTab[] = [
  { id: "lesson", label: "This Lesson", hint: "CLIENT · SW1 · R1 · SERVER — three capture points, a baseline, and a slow TCP open", sections: PA_LESSON_SECTIONS, content: <PaLessonGuideContent /> },
  { id: "deep", label: "Packet Analysis Deep Dive", hint: "Capture points, five-tuples, flags, retransmission, RST vs silence, timing", sections: PA_DEEP_DIVE_SECTIONS, content: <PaDeepDiveContent /> },
];

const TCP_HEX = "#34d399";
const ARP_HEX = "#f59e0b";
function paCallout(p: PacketVisual, s: PaState): PacketCallout3D {
  const decision = s.decision && (s.decision.device === p.from || s.decision.device === p.to) ? s.decision.text : undefined;
  if (isArp(p)) {
    const req = fieldIn(p, /^ARP$/, "Operation").startsWith("1");
    return { title: req ? `ARP request · who has ${fieldIn(p, /^ARP$/, "Target IP")}?` : `ARP reply · ${fieldIn(p, /^ARP$/, "Sender IP")} is at ${fieldIn(p, /^ARP$/, "Sender MAC")}`, detail: [`dst ${fieldIn(p, /^Ethernet/, "Destination MAC")}`, "EtherType 0x0806", decision].filter(Boolean).join(" · "), color: ARP_HEX };
  }
  const seq = tcpField(p, "Sequence Number");
  const ack = tcpField(p, "Acknowledgment Number").split(" ")[0];
  const len = tcpField(p, "Payload");
  return {
    title: `TCP ${p.badge} · ${tcpField(p, "Source Port")} → ${tcpField(p, "Destination Port")}`,
    detail: [`seq ${seq}${p.badge !== "SYN" ? ` · ack ${ack}` : ""}`, len ? len : undefined, `TTL ${fieldIn(p, /^IPv4/, "TTL")}`, `${p.from} → ${p.to}`, decision].filter(Boolean).join(" · "),
    color: TCP_HEX,
  };
}

const POS: Record<PaDevice, { x: number; y: number; kind: "laptop" | "switch" | "router" | "server" }> = {
  CLIENT: { x: 12, y: 66, kind: "laptop" },
  SW1: { x: 31, y: 34, kind: "switch" },
  R1: { x: 69, y: 34, kind: "router" },
  SERVER: { x: 88, y: 66, kind: "server" },
};
const SUB: Record<PaDevice, string> = { CLIENT: `${PA.client}/24`, SW1: "access switch", R1: `gw ${PA.gw}`, SERVER: `${PA.server}:443` };
const CAP_BADGE: Partial<Record<PaDevice, string>> = { SW1: "capture: CLIENT side", R1: "capture: ge-0/0/1", SERVER: "capture: eth0" };

const config: FundamentalsLessonConfig<PaState> = {
  lessonId: "troubleshooting-packet-analysis",
  xp: 200,
  steps: paSteps,
  createState: createPaState,
  badge: "Troubleshooting · Packet Analysis",
  title: "Packet Analysis: Read the Evidence",
  intro: "Read a healthy TCP conversation at three capture points — ARP, the three-way handshake, data and an orderly close — then investigate a connection that sometimes opens slowly. Correlate the captures, test the hypothesis with interface counters, repair, and prove it with a new capture.",
  facts: [
    { q: "What identifies one flow?", a: "The five-tuple: protocol, source/destination IP, source/destination port — both directions." },
    { q: "What changes between captures?", a: "TTL and MACs change at routing hops; IPs, ports and seq/ack do not." },
    { q: "Retransmission?", a: "Same flow, same seq, same flags, seen again at the same capture point." },
    { q: "Silence vs refusal?", a: "A closed port answers at once with RST; loss makes the sender wait for a timer." },
  ],
  terms: [
    { term: "SYN / SYN-ACK / ACK", expansion: "TCP handshake", meaning: "0x02 · 0x12 · 0x10" },
    { term: "Five-tuple", expansion: "Flow identity", meaning: "proto · IPs · ports" },
    { term: "RTO", expansion: "Retransmission timeout", meaning: "1 s initial (RFC 6298)" },
    { term: "SPAN", expansion: "Port mirroring", meaning: "copies frames to a capture" },
    { term: "RST", expansion: "Reset", meaning: "explicit refusal" },
  ],
  guide: { title: "Packet Analysis: Read the Evidence", subtitle: "Three capture points · one TCP/443 service · a slow open, located and proven", tabs: GUIDE_TABS },
  briefing: { phases: PA_BRIEFING_PHASES, notes: PA_BRIEFING_NOTES },
  nodes: () => (Object.keys(POS) as PaDevice[]).map((d) => ({ id: d, label: d, subLabel: SUB[d], x: POS[d].x, y: POS[d].y, kind: POS[d].kind })),
  edges: () => [
    { id: "L-C-SW1", a: "CLIENT", b: "SW1", label: "eth0 · ge-0/0/1" },
    { id: "L-SW1-R1", a: "SW1", b: "R1", label: "ge-0/0/24 · ge-0/0/0" },
    { id: "L-R1-S", a: "R1", b: "SERVER", label: "ge-0/0/1 · eth0" },
  ],
  regions: [
    { id: "lan", label: "10.10.10.0/24", x: 3, y: 18, width: 43, height: 68, tone: "cyan" },
    { id: "srv", label: "10.20.20.0/24", x: 77, y: 40, width: 21, height: 46, tone: "violet" },
  ],
  enterable: ["CLIENT", "SW1", "R1", "SERVER"],
  primaryDevice: { intro: "CLIENT", "capture-points": "SW1", "incident-intro": "CLIENT", "inc-wait": "CLIENT", "compare-captures": "R1", "r1-counters": "R1", "predict-cause": "R1", "repair-challenge": "R1", "ver-compare": "CLIENT" },
  traceFor: (d, s, stepId) => paTraceFor(d as PaDevice, s, stepId),
  interfacesFor: (d, s, stepId) => paInterfacesFor(d as PaDevice, s, stepId),
  pipelineTitle: (d) => `${d} · ${d === "R1" ? "IPv4 routing" : d === "SW1" ? "Ethernet switching + mirror" : "TCP/IP host stack"}`,
  explainNode: explainPa,
  tablesFor: (d, s) => paTables(d as PaDevice, s),
  callout: paCallout,
  nodeBadges: (id) => (CAP_BADGE[id as PaDevice] ? [CAP_BADGE[id as PaDevice]!] : undefined),
  repair: {
    stepId: "repair-challenge",
    prompt: "The captures and R1's counters agree: a server→client frame vanished after R1's server-facing interface. Which change fixes it?",
    options: PA_REPAIR_OPTIONS.map((o) => ({ id: o.id, label: o.label })),
    correctId: PA_REPAIR_CORRECT,
    success: "The drop condition on R1 ge-0/0/0 egress is cleared. Now prove it: repeat the connection and capture again.",
    wrongFeedback: {
      "change-port": "The port answers — every SYN got a SYN-ACK and there was never a RST. Moving the service changes nothing on the return path.",
      "client-mask": "CLIENT's /24 and gateway are correct: its SYNs reach the server every time. The loss is on the way back.",
      "clear-arp": "ARP resolved normally and the same path worked one second later. Clearing caches only forces new ARP exchanges.",
      "restart-dns": "No name resolution appears in any capture; the client connects by IP. DNS is not on this path.",
      "raise-mtu": "The lost frame was a 44-byte SYN-ACK — far below any MTU. Size is not the discriminator here.",
    },
    attempt: (s) => s.repairAttempt,
  },
  diagnostics: {
    fromStepId: "diagnostic-layers",
    layers: (s) => {
      const drops = s.counters[ifKey("R1", "ge-0/0/0")].outDrops;
      const inc = s.flows.incident;
      const ver = s.flows.verify;
      return [
        { label: `Physical / interface — links up/up · R1 ge-0/0/0 output drops ${drops}${s.dropCondition ? " (+1 in the handshake window)" : " (no new drops)"}`, status: s.dropCondition ? "failing" : "healthy" },
        { label: `Ethernet / ARP — ${PA.gw} resolved; SW1 forwards unchanged`, status: "healthy" },
        { label: "IP addressing / routing — SYNs reach SERVER every time (SERVER capture)", status: "healthy" },
        { label: `Transport — :${FLOW.incident.sport} ${inc ? `${inc.synRetransmits} SYN retransmission(s)` : "not seen"}${ver ? ` · :${FLOW.verify.sport} ${ver.synRetransmits} retransmissions` : ""}`, status: ver ? (ver.synRetransmits === 0 ? "healthy" : "failing") : inc && inc.synRetransmits > 0 ? "failing" : "healthy" },
        { label: "Application — TCP/443 listening (SYN-ACKs sent, no RST)", status: "healthy" },
      ];
    },
  },
  sidePanel: (s) => (
    <div className="space-y-3">
      <CapturePanel s={s} />
      <EvidenceNotebook entries={s.notebook} />
    </div>
  ),
  complete: { badge: "Lesson Complete", title: "You can read the evidence", message: "Capture points, five-tuples, flags, sequence arithmetic and retransmissions — and a silent loss located between two captures, confirmed by a counter, repaired and proven with a new capture." },
};

export default function TroubleshootingPacketAnalysisDemo() {
  return <FundamentalsLessonShell config={config} />;
}
