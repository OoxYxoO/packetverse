"use client";

import { FundamentalsLessonShell, type FundamentalsLessonConfig, type ShellEdge } from "@/components/lesson/FundamentalsLessonShell";
import { fundamentalsAppCallout } from "@/components/lesson/fundamentalsAppCallout";
import type { LessonGuideTab } from "@/components/lesson/LessonGuideDialog";
import type { PacketCallout3D } from "@/components/network3d/types";
import type { PacketVisual } from "@/lib/sim-engine/types";
import { fieldIn } from "@/lib/sim-engine/scenarios/enterpriseEdgePackets";
import { VPN, VPN_REPAIR_CORRECT, VPN_REPAIR_OPTIONS, createVpnState, espSeq, espSpi, gwbAccepts, ipsecSteps, isEsp, isIke, type VpnDevice, type VpnState } from "@/lib/sim-engine/scenarios/ipsecVpn";
import { VPN_BRIEFING_NOTES, VPN_BRIEFING_PHASES } from "./briefing";
import { vpnInterfacesFor, vpnTraceFor } from "./deviceTrace";
import { explainVpn, vpnTables } from "./explain";
import { vpnNames } from "./addressNames";
import { VpnSaPanel } from "./VpnSaPanel";
import { VPN_LESSON_SECTIONS, VpnLessonGuideContent } from "./LessonGuideContent";
import { VPN_DEEP_DIVE_SECTIONS, VpnDeepDiveContent } from "./DeepDiveContent";

const GUIDE_TABS: LessonGuideTab[] = [
  { id: "lesson", label: "This Lesson", hint: "GW-A · GW-B · IKEv2, CHILD SAs, ESP tunnel mode and a traffic-selector incident", sections: VPN_LESSON_SECTIONS, content: <VpnLessonGuideContent /> },
  { id: "deep", label: "IPsec / IKEv2 Deep Dive", hint: "IKEv2 and ESP in general — standards-based", sections: VPN_DEEP_DIVE_SECTIONS, content: <VpnDeepDiveContent /> },
];

const IKE_HEX = "#a78bfa";
const ESP_HEX = "#f472b6";
function vpnCallout(p: PacketVisual, s: VpnState): PacketCallout3D {
  const decision = s.decision && (s.decision.device === p.from || s.decision.device === p.to) ? s.decision.text : undefined;
  const outer = `${fieldIn(p, /^IPv4 Header$/, "Source")} → ${fieldIn(p, /^IPv4 Header$/, "Destination")}`;
  if (isIke(p)) {
    const ex = fieldIn(p, /^IKEv2/, "Exchange Type").replace(/^(\d+) \((.+)\)$/, "$2 ($1)");
    const resp = fieldIn(p, /^IKEv2/, "Flags").includes("Response");
    return { title: `IKEv2 ${ex} ${resp ? "response" : "request"} · MsgID ${fieldIn(p, /^IKEv2/, "Message ID")}`, detail: [`UDP 500 · ${outer}`, ex.startsWith("IKE_SA_INIT") ? "cleartext" : "payloads encrypted (SK)", decision].filter(Boolean).join(" · "), color: IKE_HEX };
  }
  if (isEsp(p)) return { title: `ESP · SPI ${espSpi(p)} · seq ${espSeq(p)}`, detail: [`outer ${outer} · proto 50`, "inner packet encrypted", decision].filter(Boolean).join(" · "), color: ESP_HEX };
  return fundamentalsAppCallout(p, vpnNames, { decision });
}

function tunnelEdge(s: VpnState): ShellEdge {
  const base = { id: "tunnel", a: "GW-A", b: "GW-B", offset: { dx: 0, dy: -24 }, offset3D: [0, 0, -1.3] as [number, number, number] };
  if (s.child && s.childStatus === "INSTALLED") return { ...base, label: "IPsec · IKE SA + CHILD SA (ESP)" };
  if (s.ike.phase === "ESTABLISHED" && s.childStatus === "DELETING") return { ...base, label: "IKE SA up · CHILD SA being deleted", down: true, visual3D: "controlPlane" };
  if (s.ike.phase === "ESTABLISHED") return { ...base, label: `IKE SA up · no CHILD SA${s.childStatus.startsWith("FAILED") ? " (TS_UNACCEPTABLE)" : ""}`, down: true, visual3D: "controlPlane" };
  return { ...base, label: s.ike.phase === "NONE" ? "no SA yet" : `IKE: ${s.ike.phase}`, down: true, visual3D: "controlPlane" };
}

const config: FundamentalsLessonConfig<VpnState> = {
  lessonId: "ipsec-site-to-site-vpn",
  xp: 225,
  steps: ipsecSteps,
  createState: createVpnState,
  badge: "Enterprise · VPN",
  title: "IPsec Site-to-Site VPN: IKEv2, CHILD SAs & ESP",
  intro: "Build a standards-based IPsec tunnel between two sites: IKE_SA_INIT for keys, IKE_AUTH for identity and the first CHILD SA, then ESP tunnel mode for the hosts' traffic. Then face a tunnel whose IKE SA is healthy while no host packet gets through.",
  facts: [
    { q: "What does IKE_SA_INIT do?", a: "Agrees algorithms and runs Diffie-Hellman. It does not authenticate anyone." },
    { q: "IKE SA or CHILD SA?", a: "IKE SA protects IKE. CHILD SAs (one per direction) protect user data with ESP." },
    { q: "Inner vs outer header?", a: "Inner: the hosts' private addresses, encrypted. Outer: the gateways, protocol 50." },
    { q: "Whose SPI is in a packet?", a: "The receiver's — it chose the SPI so it can find the right keys." },
  ],
  terms: [
    { term: "IKEv2", expansion: "Internet Key Exchange v2", meaning: "RFC 7296 · UDP/500" },
    { term: "ESP", expansion: "Encapsulating Security Payload", meaning: "RFC 4303 · IP protocol 50" },
    { term: "SA / SPI", expansion: "Security Association / Parameter Index", meaning: "One-way keys + their ID" },
    { term: "TSi / TSr", expansion: "Traffic Selectors", meaning: "Which inner traffic is protected" },
    { term: "SK", expansion: "Encrypted & Authenticated payload", meaning: "Protects IKE after INIT" },
  ],
  guide: { title: "IPsec Site-to-Site VPN: IKEv2, CHILD SAs & ESP", subtitle: `${VPN.siteA} ↔ ${VPN.siteB} · peers ${VPN.gwaPub} ↔ ${VPN.gwbPub}`, tabs: GUIDE_TABS },
  briefing: { phases: VPN_BRIEFING_PHASES, notes: VPN_BRIEFING_NOTES },
  nodes: (s) => [
    { id: "HOST-A", label: "HOST-A", subLabel: VPN.hostA, x: 6, y: 64, kind: "laptop" },
    { id: "GW-A", label: "GW-A", subLabel: VPN.gwaPub, x: 27, y: 64, kind: "router" },
    { id: "INTERNET", label: "INTERNET", subLabel: "public transit", x: 50, y: 64, kind: "cloud" },
    { id: "GW-B", label: "GW-B", subLabel: `${VPN.gwbPub}${s.gwbRemote !== VPN.siteA ? " · TS edited" : ""}`, x: 73, y: 64, kind: "router" },
    { id: "HOST-B", label: "HOST-B", subLabel: VPN.hostB, x: 94, y: 64, kind: "laptop" },
  ],
  edges: (s) => [
    { id: "a-lan", a: "HOST-A", b: "GW-A", label: "10.10.10.0/24" },
    { id: "a-wan", a: "GW-A", b: "INTERNET", label: `${VPN.gwaPub}` },
    { id: "b-wan", a: "INTERNET", b: "GW-B", label: `${VPN.gwbPub}` },
    { id: "b-lan", a: "GW-B", b: "HOST-B", label: "10.20.20.0/24" },
    tunnelEdge(s),
  ],
  regions: [
    { id: "site-a", label: "Site A · 10.10.10.0/24", x: 1, y: 48, width: 34, height: 36, tone: "cyan" },
    { id: "site-b", label: "Site B · 10.20.20.0/24", x: 65, y: 48, width: 34, height: 36, tone: "violet" },
  ],
  enterable: ["GW-A", "GW-B"],
  primaryDevice: { sites: "GW-A", "sa-summary": "GW-A", "incident-intro": "GW-B", "repair-challenge": "GW-B" },
  traceFor: (d, s, stepId) => vpnTraceFor(d as VpnDevice, s, stepId),
  interfacesFor: (d, s, stepId) => vpnInterfacesFor(d as VpnDevice, s, stepId),
  pipelineTitle: (d) => (d === "GW-A" || d === "GW-B" ? `${d} · selectors → IKE / CHILD SA → ESP` : `${d} · IP forwarding`),
  explainNode: explainVpn,
  tablesFor: (d, s) => vpnTables(d as VpnDevice, s),
  callout: vpnCallout,
  floodCopies: (s) => s.flood,
  nodeBadges: (id, s) => (id === "GW-A" || id === "GW-B" ? [`IKE ${s.ike.phase === "ESTABLISHED" ? "UP" : s.ike.phase === "NONE" ? "—" : "…"}`, `CHILD ${s.childStatus === "INSTALLED" ? "UP" : s.childStatus === "NONE" ? "—" : s.childStatus === "NEGOTIATING" ? "…" : s.childStatus === "DELETING" ? "DEL" : "FAIL"}`] : undefined),
  repair: {
    stepId: "repair-challenge",
    prompt: "The IKE SA is up and authenticated, but CREATE_CHILD_SA keeps failing with TS_UNACCEPTABLE. Which change fixes it?",
    options: VPN_REPAIR_OPTIONS.map((o) => ({ id: o.id, label: o.label })),
    correctId: VPN_REPAIR_CORRECT,
    success: "GW-B's remote Site-A selector is 10.10.10.0/24 again, matching what GW-A requests. The next CREATE_CHILD_SA can be accepted.",
    wrongFeedback: {
      "peer-ip": "IKE already reaches GW-B at 203.0.113.10 — the CREATE_CHILD_SA exchange crossed the Internet both ways. The peer address is not the problem.",
      "ike-id": "Authentication succeeded in IKE_AUTH and the IKE SA is still up. Changing identities would only risk breaking that.",
      "raise-ttl": "TTL has nothing to do with which subnets a CHILD SA may protect.",
      bypass: "That avoids IPsec instead of repairing it: Site A ↔ Site B traffic would cross the Internet in cleartext.",
    },
    attempt: (s) => s.repairAttempt,
  },
  diagnostics: {
    fromStepId: "diagnostic-layers",
    layers: (s) => {
      const tsOk = gwbAccepts(s, VPN.siteA, VPN.siteB);
      return [
        { label: `Public reachability — IKE ${s.ike.lastExchange ? `last exchange ${s.ike.lastExchange}` : "not tried"}`, status: "healthy" },
        { label: `IKE SA — ${s.ike.phase}`, status: s.ike.phase === "ESTABLISHED" ? "healthy" : "failing" },
        { label: `Peer authentication — ${s.ike.peersAuthenticated ? "valid" : "not done"}`, status: s.ike.peersAuthenticated ? "healthy" : "failing" },
        { label: `Traffic selectors — GW-A requests ${VPN.siteA} ↔ ${VPN.siteB}; GW-B allows ${s.gwbRemote} ↔ ${VPN.siteB}`, status: tsOk ? "healthy" : "failing" },
        { label: `CHILD SA — ${s.childStatus}${s.lastNotify ? ` (${s.lastNotify})` : ""}`, status: s.childStatus === "INSTALLED" ? "healthy" : "failing" },
        { label: `ESP data — HOST-A: ${s.hostA.lastResult}`, status: s.childStatus === "INSTALLED" ? "healthy" : "failing" },
      ];
    },
  },
  sidePanel: (s) => <VpnSaPanel s={s} />,
  complete: { badge: "Lesson Complete", title: "You can read an IPsec tunnel", message: "Diffie-Hellman in IKE_SA_INIT, authentication and the first CHILD SA in IKE_AUTH, directional ESP SAs in tunnel mode, anti-replay sequence numbers — and a CHILD SA failure you can tell apart from a dead peer." },
};

export default function IpsecVpnDemo() {
  return <FundamentalsLessonShell config={config} />;
}
