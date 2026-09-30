"use client";

import { FundamentalsLessonShell, type FundamentalsLessonConfig } from "@/components/lesson/FundamentalsLessonShell";
import { EvidenceNotebook } from "@/components/lesson/EvidenceNotebook";
import type { LessonGuideTab } from "@/components/lesson/LessonGuideDialog";
import type { PacketCallout3D } from "@/components/network3d/types";
import type { PacketVisual } from "@/lib/sim-engine/types";
import { fieldOf } from "@/lib/sim-engine/scenarios/fundamentalsPackets";
import { tcpField } from "@/lib/sim-engine/scenarios/enterpriseEdgePackets";
import { AP_REPAIR_CORRECT, AP_REPAIR_OPTIONS, IP, NAME, apSteps, cached, createApState, isDns, remaining, type ApDevice, type ApState } from "@/lib/sim-engine/scenarios/troubleshootingApplication";
import { AP_BRIEFING_NOTES, AP_BRIEFING_PHASES } from "./briefing";
import { apInterfacesFor, apTraceFor } from "./deviceTrace";
import { apTables, explainAp } from "./explain";
import { ApplicationPanel } from "./ApplicationPanel";
import { AP_LESSON_SECTIONS, ApLessonGuideContent } from "./LessonGuideContent";
import { AP_DEEP_DIVE_SECTIONS, ApDeepDiveContent } from "./DeepDiveContent";

const GUIDE_TABS: LessonGuideTab[] = [
  { id: "lesson", label: "This Lesson", hint: "CLIENT · NETWORK · DNS · WEB-OLD · WEB-NEW — every layer worked, the answer was 503", sections: AP_LESSON_SECTIONS, content: <ApLessonGuideContent /> },
  { id: "deep", label: "DNS & HTTP Deep Dive", hint: "Caches, authority, A records, TTL, five-tuple, handshake, Host header, status codes", sections: AP_DEEP_DIVE_SECTIONS, content: <ApDeepDiveContent /> },
];

function apCallout(p: PacketVisual, s: ApState): PacketCallout3D {
  if (isDns(p)) {
    const ans = fieldOf(p, /^DNS/, "Answer");
    return { title: ans ? "DNS response" : "DNS query", detail: [ans || fieldOf(p, /^DNS/, "Question"), `${p.from} → ${p.to}`].filter(Boolean).join(" · "), color: "#a78bfa" };
  }
  const http = p.layers.find((l) => l.name.startsWith("HTTP"));
  const decision = s.decision && (s.decision.device === p.from || s.decision.device === p.to) ? s.decision.text : undefined;
  return { title: http ? http.fields[0].value : `TCP ${p.badge} · ${tcpField(p, "Source Port")} → ${tcpField(p, "Destination Port")}`, detail: [`seq ${tcpField(p, "Sequence Number")} · ack ${tcpField(p, "Acknowledgment Number").split(" ")[0]}`, `${p.from} → ${p.to}`, decision].filter(Boolean).join(" · "), color: http ? "#fbbf24" : "#34d399" };
}

const POS: Record<ApDevice, { x: number; y: number; kind: "laptop" | "router" | "server" }> = {
  CLIENT: { x: 8, y: 50, kind: "laptop" },
  NETWORK: { x: 38, y: 50, kind: "router" },
  DNS: { x: 70, y: 14, kind: "server" },
  "WEB-OLD": { x: 90, y: 50, kind: "server" },
  "WEB-NEW": { x: 70, y: 86, kind: "server" },
};
const SUB: Record<ApDevice, string> = { CLIENT: IP.client, NETWORK: "gateway", DNS: `${IP.dns}:53`, "WEB-OLD": `${IP.old}:80`, "WEB-NEW": `${IP.new}:80` };

const config: FundamentalsLessonConfig<ApState> = {
  lessonId: "troubleshooting-application",
  xp: 250,
  steps: apSteps,
  createState: createApState,
  badge: "Troubleshooting · Application",
  title: "Application Troubleshooting: DNS, TCP & HTTP",
  intro: "The page loads an error, so 'the network is down' — except every packet arrives and every connection completes. Separate name resolution, transport and application: read the DNS answer and its TTL, the five-tuple and TCP flags, the HTTP request's Host header and the status code, and compare a direct test against the name.",
  facts: [
    { q: "Protocol?", a: "Plain HTTP on TCP/80 — every byte is readable; no TLS." },
    { q: "Who picks the server?", a: "DNS: the answer becomes the IP destination." },
    { q: "What is a status code?", a: "The application's answer — proof the request arrived." },
    { q: "Why does an old answer linger?", a: "Caches keep it until its TTL expires." },
  ],
  terms: [
    { term: "A record", expansion: "Name → IPv4", meaning: "portal → address" },
    { term: "TTL", expansion: "Time to live (DNS)", meaning: "how long to cache" },
    { term: "Authoritative", expansion: "Source of truth", meaning: "owns the zone" },
    { term: "Host header", expansion: "HTTP/1.1 site name", meaning: "which site on the server" },
    { term: "503", expansion: "Service Unavailable", meaning: "app answered: not serving" },
  ],
  guide: { title: "Application Troubleshooting: DNS, TCP & HTTP", subtitle: "One name · two web servers · plain HTTP on TCP/80", tabs: GUIDE_TABS },
  briefing: { phases: AP_BRIEFING_PHASES, notes: AP_BRIEFING_NOTES },
  nodes: () => (Object.keys(POS) as ApDevice[]).map((d) => ({ id: d, label: d, subLabel: SUB[d], x: POS[d].x, y: POS[d].y, kind: POS[d].kind })),
  edges: () => [
    { id: "L-C", a: "CLIENT", b: "NETWORK", label: "10.30.1.0/24" },
    { id: "L-DNS", a: "NETWORK", b: "DNS" },
    { id: "L-OLD", a: "NETWORK", b: "WEB-OLD", label: "10.40.40.0/24" },
    { id: "L-NEW", a: "NETWORK", b: "WEB-NEW" },
  ],
  enterable: ["CLIENT", "NETWORK", "DNS", "WEB-OLD", "WEB-NEW"],
  primaryDevice: { intro: "CLIENT", design: "DNS", "incident-intro": "CLIENT", "inc-authoritative": "DNS", "predict-cause": "DNS", "repair-challenge": "DNS", "ver-stale": "CLIENT", "ver-flush": "CLIENT" },
  traceFor: (d, s, stepId) => apTraceFor(d as ApDevice, s, stepId),
  interfacesFor: (d, s, stepId) => apInterfacesFor(d as ApDevice, s, stepId),
  pipelineTitle: (d) => `${d} · ${d === "CLIENT" ? "cache → DNS → TCP → HTTP" : d === "DNS" ? "query → zone → answer" : d.startsWith("WEB") ? "TCP → Host → status" : "routing"}`,
  explainNode: explainAp,
  tablesFor: (d, s) => apTables(d as ApDevice, s),
  callout: apCallout,
  nodeBadges: (id, s) => {
    if (id !== "CLIENT") return undefined;
    const c = cached(s);
    return c ? [`cache ${c.address} · ${remaining(s)} s`] : undefined;
  },
  repair: {
    stepId: "repair-challenge",
    prompt: `DNS answered ${NAME} with ${IP.old}; TCP to ${IP.old}:80 completed; the request arrived and ${IP.old} answered 503. The same request sent directly to ${IP.new} returns 200. The authoritative server itself answers ${IP.old}. Which change fixes the cause?`,
    options: AP_REPAIR_OPTIONS.map((o) => ({ id: o.id, label: o.label })),
    correctId: AP_REPAIR_CORRECT,
    success: `The authoritative record now says ${IP.new}. Now prove it — and remember that clients may still hold the old answer until its TTL runs out.`,
    wrongFeedback: {
      "flush-cache": "Flushing one client's cache makes it ask again — and the authoritative server would still answer the old address. A flush can help you verify a fix; it cannot be the fix.",
      "restart-switch": "Every packet already arrives and every connection completes. The switch is not involved in which address the name returns.",
      gateway: "The gateway works: DNS, the handshake and the HTTP exchange all crossed it. Changing it cannot change a DNS answer.",
      "fw-80": "TCP/80 is already open — the handshake completed and the server answered. Nothing is being filtered.",
      "clear-arp": "ARP maps next hops to MAC addresses on one link. Packets reached their destinations; the destination itself came from DNS.",
      mtu: "Small requests and responses crossed intact in both directions. Nothing points to packet size.",
      "restart-old": `WEB-OLD is behaving as configured: the portal is retired there. Restarting it does not send clients to ${IP.new}.`,
    },
    attempt: (s) => s.repairAttempt,
  },
  diagnostics: {
    fromStepId: "diagnostic-layers",
    layers: (s) => [
      { label: "Network / IP — DNS, TCP and HTTP packets all delivered both ways", status: "healthy" },
      { label: "Transport — TCP/80 handshake completes", status: "healthy" },
      { label: `Application — ${IP.new} direct: 200 OK`, status: "healthy" },
      { label: `Name resolution — authoritative A ${NAME} → ${s.authA}`, status: s.authA === IP.new ? "healthy" : "failing" },
      { label: `Result by name — ${s.http.length ? s.http[s.http.length - 1].status : "—"}`, status: s.http.length && s.http[s.http.length - 1].status.startsWith("200") ? "healthy" : "failing" },
    ],
  },
  sidePanel: (s) => (
    <div className="space-y-3">
      <ApplicationPanel s={s} />
      <EvidenceNotebook entries={s.notebook} />
    </div>
  ),
  complete: { badge: "Lesson Complete", title: "You can separate the network from the application", message: "Every layer worked, and a name still led users to a retired server. Found by reading the DNS answer and comparing a direct test; repaired at the authoritative record; verified with a fresh lookup and a 200 by name — with the cache handled deliberately." },
};

export default function TroubleshootingApplicationDemo() {
  return <FundamentalsLessonShell config={config} />;
}
