"use client";

import { FundamentalsLessonShell, type FundamentalsLessonConfig, type ShellEdge } from "@/components/lesson/FundamentalsLessonShell";
import type { LessonGuideTab } from "@/components/lesson/LessonGuideDialog";
import type { PacketCallout3D } from "@/components/network3d/types";
import type { PacketVisual } from "@/lib/sim-engine/types";
import { fieldIn, tcpField } from "@/lib/sim-engine/scenarios/enterpriseEdgePackets";
import { SD, SD_REPAIR_CORRECT, SD_REPAIR_OPTIONS, TUN_IDS, createSdState, isProbe, isVoice, metricText, sdwanSteps, tunStatus, type SdDevice, type SdState, type TunId } from "@/lib/sim-engine/scenarios/sdwanPathSelection";
import { SD_BRIEFING_NOTES, SD_BRIEFING_PHASES } from "./briefing";
import { sdInterfacesFor, sdTraceFor } from "./deviceTrace";
import { explainSd, sdTables } from "./explain";
import { SdwanPathPanel } from "./SdwanPathPanel";
import { SD_LESSON_SECTIONS, SdLessonGuideContent } from "./LessonGuideContent";
import { SD_DEEP_DIVE_SECTIONS, SdDeepDiveContent } from "./DeepDiveContent";

const GUIDE_TABS: LessonGuideTab[] = [
  { id: "lesson", label: "This Lesson", hint: "BRANCH-EDGE · TUN-A / TUN-B · SLA probes, Voice/Bulk steering, failover, hysteresis and a monitor-target incident", sections: SD_LESSON_SECTIONS, content: <SdLessonGuideContent /> },
  { id: "deep", label: "SD-WAN Path Engineering Deep Dive", hint: "Path engineering in general — vendor-neutral", sections: SD_DEEP_DIVE_SECTIONS, content: <SdDeepDiveContent /> },
];

const PROBE_HEX = "#f472b6";
const VOICE_HEX = "#fbbf24";
const BULK_HEX = "#34d399";
/** Which overlay path a packet on a WAN leg belongs to (from the link it is on — not from any header). */
const pathOf = (p: PacketVisual): TunId | undefined => ([p.from, p.to].includes("ISP-A") ? "TUN-A" : [p.from, p.to].includes("ISP-B") ? "TUN-B" : undefined);

function sdCallout(p: PacketVisual, s: SdState): PacketCallout3D {
  const decision = s.decision && (s.decision.device === p.from || s.decision.device === p.to) ? s.decision.text : undefined;
  const path = pathOf(p);
  const via = path ? `on ${path} via ${path === "TUN-A" ? "ISP-A" : "ISP-B"} (encapsulation not drawn)` : undefined;
  const src = fieldIn(p, /^IPv4 Header$/, "Source");
  const dst = fieldIn(p, /^IPv4 Header$/, "Destination");
  if (isProbe(p)) return { title: `ICMP ${p.badge === "ECHO" ? "Echo Request" : "Echo Reply"} · ${src} → ${dst} · seq ${fieldIn(p, /^ICMP/, "Sequence Number")}`, detail: ["SLA probe (PacketVerse model)", via, decision].filter(Boolean).join(" · "), color: PROBE_HEX };
  if (isVoice(p)) return { title: `UDP ${src}:${fieldIn(p, /^UDP/, "Source Port")} → ${dst}:${fieldIn(p, /^UDP/, "Destination Port")} · DSCP EF`, detail: [via, decision].filter(Boolean).join(" · ") || "voice media", color: VOICE_HEX };
  return { title: `TCP ${src}:${tcpField(p, "Source Port")} → ${dst}:${tcpField(p, "Destination Port")} · ${tcpField(p, "Payload")}`, detail: [via, decision].filter(Boolean).join(" · ") || "bulk data", color: BULK_HEX };
}

function tunEdge(s: SdState, t: TunId): ShellEdge {
  const x = s.tun[t];
  const a = t === "TUN-A";
  const short = x.eligible ? "eligible" : x.sla === "NO VALID RESULT" ? "no SLA result" : x.sla === "FAIL" ? "SLA ✗ (reachable)" : `recovering ${x.streak}/3`;
  return { id: t, a: "BRANCH-EDGE", b: "HUB-EDGE", label: `${t} overlay · ${short}`, offset: { dx: 0, dy: a ? -9 : 9 }, offset3D: [0, 0, a ? -0.5 : 0.5], ...(x.eligible ? {} : { visual3D: "backup" as const }) };
}

const config: FundamentalsLessonConfig<SdState> = {
  lessonId: "sdwan-path-selection",
  xp: 200,
  steps: sdwanSteps,
  createState: createSdState,
  badge: "Enterprise · WAN",
  title: "SD-WAN: SLA-Based Path Selection & Failover",
  intro: "A branch with two Internet circuits and two overlay paths to the hub. Measure each path, steer Voice and Bulk by application policy, fail Voice over when one path browns out, bring it back carefully — then find out why calls die while both circuits are up. A PacketVerse generic SD-WAN model: vendor-neutral, no invented wire format.",
  facts: [
    { q: "Is UP the same as good?", a: "No. A circuit can be UP and a tunnel reachable while the path fails an application's SLA." },
    { q: "Who picks the path?", a: "The edge, per packet, from installed policy and its own live measurements." },
    { q: "Why two classes?", a: "Voice needs a low-latency SLA path; Bulk just needs a working one. They can use different paths." },
    { q: "Why not switch straight back?", a: "Modeled hysteresis: 3 passing intervals before a recovered path is trusted again." },
  ],
  terms: [
    { term: "Underlay", expansion: "Transport circuits", meaning: "ISP-A, ISP-B" },
    { term: "Overlay", expansion: "Logical paths", meaning: "TUN-A, TUN-B" },
    { term: "SLA", expansion: "Service-level thresholds", meaning: "RTT · jitter · loss" },
    { term: "Eligible", expansion: "Passes the SLA", meaning: "May carry Voice" },
    { term: "Hysteresis", expansion: "Recovery dampening", meaning: "Avoids flapping" },
  ],
  guide: { title: "SD-WAN: SLA-Based Path Selection & Failover", subtitle: "Voice SLA: RTT ≤ 100 ms · jitter ≤ 30 ms · loss ≤ 1.0% · PacketVerse generic model", tabs: GUIDE_TABS },
  briefing: { phases: SD_BRIEFING_PHASES, notes: SD_BRIEFING_NOTES },
  nodes: (s) => [
    { id: "CLIENT", label: "CLIENT", subLabel: SD.client, x: 7, y: 50, kind: "laptop" },
    { id: "BRANCH-EDGE", label: "BRANCH-EDGE", subLabel: `Voice → ${s.selection.VOICE === "NONE" ? "none" : s.selection.VOICE}`, x: 24, y: 50, kind: "router" },
    { id: "ISP-A", label: "ISP-A", subLabel: "underlay A", x: 40, y: 14, kind: "cloud" },
    { id: "ISP-B", label: "ISP-B", subLabel: "underlay B", x: 60, y: 86, kind: "cloud" },
    { id: "HUB-EDGE", label: "HUB-EDGE", subLabel: `lo ${SD.hubLo}`, x: 76, y: 50, kind: "router" },
    { id: "APP", label: "APP", subLabel: SD.app, x: 93, y: 50, kind: "server" },
  ],
  edges: (s) => [
    { id: "c-br", a: "CLIENT", b: "BRANCH-EDGE", label: "LAN" },
    { id: "br-ispa", a: "BRANCH-EDGE", b: "ISP-A", label: `ISP-A circuit ${s.tun["TUN-A"].underlay}` },
    { id: "ispa-hub", a: "ISP-A", b: "HUB-EDGE", label: "ISP-A" },
    { id: "br-ispb", a: "BRANCH-EDGE", b: "ISP-B", label: `ISP-B circuit ${s.tun["TUN-B"].underlay}` },
    { id: "ispb-hub", a: "ISP-B", b: "HUB-EDGE", label: "ISP-B" },
    tunEdge(s, "TUN-A"),
    tunEdge(s, "TUN-B"),
    { id: "hub-app", a: "HUB-EDGE", b: "APP", label: "hub LAN" },
  ],
  regions: [],
  enterable: ["BRANCH-EDGE", "HUB-EDGE"],
  primaryDevice: { "underlay-overlay": "BRANCH-EDGE", policies: "BRANCH-EDGE", "measure-healthy": "BRANCH-EDGE", "local-decision": "BRANCH-EDGE", "degrade-a": "BRANCH-EDGE", "measure-bad": "BRANCH-EDGE", "restore-a": "BRANCH-EDGE", "recover-1": "BRANCH-EDGE", "recover-2": "BRANCH-EDGE", "recover-3": "BRANCH-EDGE", "incident-intro": "BRANCH-EDGE", "measure-b-invalid": "BRANCH-EDGE", "degrade-a-again": "BRANCH-EDGE", "repair-challenge": "BRANCH-EDGE", "ver-b-eligible": "BRANCH-EDGE" },
  traceFor: (d, s, stepId) => sdTraceFor(d as SdDevice, s, stepId),
  interfacesFor: (d, s, stepId) => sdInterfacesFor(d as SdDevice, s, stepId),
  pipelineTitle: (d) => (d === "BRANCH-EDGE" ? "BRANCH-EDGE · classify → policy → path state → select" : `${d} · forwarding`),
  explainNode: explainSd,
  tablesFor: (d, s) => sdTables(d as SdDevice, s),
  callout: sdCallout,
  floodCopies: (s) => s.flood,
  nodeBadges: (id, s) => (id === "BRANCH-EDGE" ? TUN_IDS.map((t) => `${t} ${s.tun[t].eligible ? "✓" : "✗"}`) : undefined),
  repair: {
    stepId: "repair-challenge",
    prompt: "Both circuits are UP and both overlays reachable, yet Voice has no eligible path. Which change fixes the cause?",
    options: SD_REPAIR_OPTIONS.map((o) => ({ id: o.id, label: o.label })),
    correctId: SD_REPAIR_CORRECT,
    success: "TUN-B's monitor probes the hub loopback 10.255.0.1 again. Valid replies will produce real measurements — and after enough passing intervals, TUN-B can carry Voice.",
    wrongFeedback: {
      "raise-rtt": "That would hide TUN-A's genuinely poor quality (and admit other bad paths), and it still gives TUN-B no measurements at all — its probes get no replies.",
      "shut-ispa": "TUN-A is already ineligible for Voice. Shutting ISP-A removes Bulk's fallback and does nothing for TUN-B's monitoring.",
      "change-dns": "No name resolution is involved: probes and flows use IP addresses, and the transport works.",
      "clear-arp": "CLIENT reaches BRANCH-EDGE fine — the voice packet arrived there. The decision to drop it was the SLA policy's.",
    },
    attempt: (s) => s.repairAttempt,
  },
  diagnostics: {
    fromStepId: "diagnostic-layers",
    layers: (s) => {
      const a = s.tun["TUN-A"];
      const b = s.tun["TUN-B"];
      return [
        { label: `Underlay — ISP-A ${a.underlay} · ISP-B ${b.underlay}`, status: "healthy" },
        { label: `Overlay — TUN-A ${a.overlay} · TUN-B ${b.overlay}`, status: "healthy" },
        { label: `TUN-A measurement — ${metricText(a.last)} → ${a.sla}`, status: a.sla === "PASS" ? "healthy" : "failing" },
        { label: `TUN-B monitor target — ${b.target} (hub loopback is ${SD.hubLo})`, status: b.target === SD.hubLo ? "healthy" : "failing" },
        { label: `TUN-B measurement — ${metricText(b.last)} → ${b.sla}`, status: b.sla === "PASS" ? "healthy" : "failing" },
        { label: `Voice eligibility — ${TUN_IDS.filter((t) => s.tun[t].eligible).join(", ") || "no eligible path"} · ${TUN_IDS.map((t) => `${t} ${tunStatus(s.tun[t])}`).join(" · ")}`, status: s.selection.VOICE === "NONE" ? "failing" : "healthy" },
        { label: `Bulk forwarding — ${s.selection.BULK}`, status: s.selection.BULK === "NONE" ? "failing" : "healthy" },
      ];
    },
  },
  sidePanel: (s) => <SdwanPathPanel s={s} />,
  complete: { badge: "Lesson Complete", title: "You can engineer paths by SLA", message: "Underlay vs overlay, probe-based measurements, per-application steering, SLA failover, modeled hysteresis — and a monitor that must point at something that answers." },
};

export default function SdwanPathSelectionDemo() {
  return <FundamentalsLessonShell config={config} />;
}
