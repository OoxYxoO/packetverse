"use client";

import { FundamentalsLessonShell, type FundamentalsLessonConfig } from "@/components/lesson/FundamentalsLessonShell";
import { EvidenceNotebook } from "@/components/lesson/EvidenceNotebook";
import type { LessonGuideTab } from "@/components/lesson/LessonGuideDialog";
import type { PacketCallout3D } from "@/components/network3d/types";
import type { PacketVisual } from "@/lib/sim-engine/types";
import { fieldOf } from "@/lib/sim-engine/scenarios/fundamentalsPackets";
import { CUST, LOOP, MP_REPAIR_CORRECT, MP_REPAIR_OPTIONS, VRF, createMpState, importable, isBgp, mpSteps, vrfLookup, type MpDevice, type MpState } from "@/lib/sim-engine/scenarios/troubleshootingMpls";
import { MP_BRIEFING_NOTES, MP_BRIEFING_PHASES } from "./briefing";
import { mpInterfacesFor, mpTraceFor } from "./deviceTrace";
import { explainMp, mpTables } from "./explain";
import { MplsPanel } from "./MplsPanel";
import { MP_LESSON_SECTIONS, MpLessonGuideContent } from "./LessonGuideContent";
import { MP_DEEP_DIVE_SECTIONS, MpDeepDiveContent } from "./DeepDiveContent";

const GUIDE_TABS: LessonGuideTab[] = [
  { id: "lesson", label: "This Lesson", hint: "CE1 · PE1 · P1 · P2 · PE2 · CE2 — core healthy, one VPN route missing", sections: MP_LESSON_SECTIONS, content: <MpLessonGuideContent /> },
  { id: "deep", label: "MPLS VPN Deep Dive", hint: "Underlay, LDP, labels, VRF, RD vs RT, VPNv4, PHP, troubleshooting by plane", sections: MP_DEEP_DIVE_SECTIONS, content: <MpDeepDiveContent /> },
];

function mpCallout(p: PacketVisual, s: MpState): PacketCallout3D {
  const decision = s.decision && (s.decision.device === p.from || s.decision.device === p.to) ? s.decision.text : undefined;
  if (isBgp(p)) return { title: `MP-BGP UPDATE · ${fieldOf(p, /^MP_REACH/, "NLRI")}`, detail: [`label ${fieldOf(p, /^MP_REACH/, "VPN label")}`, `RT ${p.layers.find((l) => l.name === "Extended Communities")!.fields.map((f) => f.value).join(", ")}`, `NH ${fieldOf(p, /^MP_REACH/, "Next hop")}`, decision].filter(Boolean).join(" · "), color: "#fb7185" };
  const labels = p.layers.filter((l) => l.name.startsWith("MPLS")).map((l) => l.fields[0].value.split(" ")[0]);
  return { title: `${labels.length ? `[${labels.join(" | ")}] ` : ""}ICMP ${fieldOf(p, /^IPv4/, "Source")} → ${fieldOf(p, /^IPv4/, "Destination")}`, detail: [labels.length ? `${labels.length} label${labels.length > 1 ? "s" : ""} · EtherType 0x8847` : "plain IPv4", `IP TTL ${fieldOf(p, /^IPv4/, "TTL")}`, `${p.from} → ${p.to}`, decision].filter(Boolean).join(" · "), color: labels.length ? "#f472b6" : "#60a5fa" };
}

const POS: Record<MpDevice, { x: number; y: number; kind: "router" | "pe-router" | "p-router" }> = {
  CE1: { x: 7, y: 66, kind: "router" },
  PE1: { x: 24, y: 36, kind: "pe-router" },
  P1: { x: 42, y: 66, kind: "p-router" },
  P2: { x: 60, y: 36, kind: "p-router" },
  PE2: { x: 78, y: 66, kind: "pe-router" },
  CE2: { x: 94, y: 36, kind: "router" },
};
const SUB: Record<MpDevice, string> = { CE1: `${CUST.ce1Lan}/24`, PE1: LOOP.PE1, P1: LOOP.P1, P2: LOOP.P2, PE2: LOOP.PE2, CE2: `${CUST.ce2Lan}/24` };

const config: FundamentalsLessonConfig<MpState> = {
  lessonId: "troubleshooting-mpls",
  xp: 300,
  steps: mpSteps,
  createState: createMpState,
  badge: "Troubleshooting · MPLS VPN",
  title: "MPLS Troubleshooting: Transport, VPN Routes & Labels",
  intro: "A customer's L3VPN site is unreachable while the provider core looks perfect: IGP up, LDP Operational, MP-BGP Established, the route even arrives at the right PE. Troubleshoot plane by plane — underlay, transport, VPN control plane, VRF, data plane — and find the one that fails.",
  facts: [
    { q: "Outer vs inner label?", a: "Outer (LDP) = get to the egress PE; inner (VPN) = which VRF there." },
    { q: "RD vs RT?", a: "RD makes prefixes unique; RT decides import/export." },
    { q: "Do P routers know customer routes?", a: "No — they switch on the top label only." },
    { q: "Received = imported?", a: "No — import is a separate policy decision per VRF." },
  ],
  terms: [
    { term: "VRF", expansion: "Virtual routing & forwarding", meaning: "per-customer table" },
    { term: "RD", expansion: "Route Distinguisher", meaning: "uniqueness" },
    { term: "RT", expansion: "Route Target", meaning: "import/export policy" },
    { term: "VPNv4", expansion: "AFI 1 / SAFI 128", meaning: "RD + prefix + label" },
    { term: "PHP", expansion: "Penultimate-hop pop", meaning: "implicit-null (3)" },
  ],
  guide: { title: "MPLS Troubleshooting: Transport, VPN Routes & Labels", subtitle: `VRF ${VRF} · LDP transport · MP-BGP VPNv4 · one Route Target`, tabs: GUIDE_TABS },
  briefing: { phases: MP_BRIEFING_PHASES, notes: MP_BRIEFING_NOTES },
  nodes: () => (Object.keys(POS) as MpDevice[]).map((d) => ({ id: d, label: d, subLabel: SUB[d], x: POS[d].x, y: POS[d].y, kind: POS[d].kind })),
  edges: () => [
    { id: "L-CE1", a: "CE1", b: "PE1", label: `VRF ${VRF}` },
    { id: "L-PE1-P1", a: "PE1", b: "P1", label: "LDP" },
    { id: "L-P1-P2", a: "P1", b: "P2", label: "LDP" },
    { id: "L-P2-PE2", a: "P2", b: "PE2", label: "LDP" },
    { id: "L-CE2", a: "PE2", b: "CE2", label: `VRF ${VRF}` },
  ],
  regions: [{ id: "core", label: "MPLS core · IGP + LDP · MP-BGP PE1↔PE2", x: 15, y: 18, width: 71, height: 66, tone: "violet" }],
  enterable: ["CE1", "PE1", "P1", "P2", "PE2", "CE2"],
  primaryDevice: { intro: "PE1", design: "PE1", "incident-intro": "CE1", "inc-transport": "PE1", "inc-bgp": "PE1", "inc-vrf": "PE1", "inc-pe2-config": "PE2", "predict-cause": "PE2", "repair-challenge": "PE2" },
  traceFor: (d, s, stepId) => mpTraceFor(d as MpDevice, s, stepId),
  interfacesFor: (d, s, stepId) => mpInterfacesFor(d as MpDevice, s, stepId),
  pipelineTitle: (d) => `${d} · ${d.startsWith("PE") ? "VRF + label imposition" : d.startsWith("P") ? "label switching" : "customer IP"}`,
  explainNode: explainMp,
  tablesFor: (d, s) => mpTables(d as MpDevice, s),
  callout: mpCallout,
  nodeBadges: (id) => (id === "PE1" || id === "PE2" ? [`VRF ${VRF}`] : id === "P1" || id === "P2" ? ["no VRF"] : undefined),
  repair: {
    stepId: "repair-challenge",
    prompt: `Transport is healthy, MP-BGP is Established and PE1 receives ${CUST.ce2Lan}/24 from PE2 with RT 65000:200 — but ${VRF} on PE1 imports only 65000:100, and the route is not in the VRF. Which change fixes it?`,
    options: MP_REPAIR_OPTIONS.map((o) => ({ id: o.id, label: o.label })),
    correctId: MP_REPAIR_CORRECT,
    success: "PE2 exports CUST-A with RT 65000:100 again. Now prove it: watch the corrected update, the import and the label stack.",
    wrongFeedback: {
      "reset-ldp": "LDP sessions are Operational and the LSP to 10.0.0.4 answers. Resetting them only causes an outage; the route would still carry RT 65000:200.",
      "igp-metric": "The IGP path to PE2 works. Metrics change which core path is used, not which VRF imports a route.",
      "global-static": "A global-table route cannot serve a VRF, and the customer packet would still have no VPN label for PE2 to select CUST-A.",
      "restart-p1": "P1 only swaps transport labels and has no customer state. It is healthy and irrelevant to route import.",
      "ce1-mask": "CE1 sends correctly addressed packets to PE1; the missing piece is PE1's VRF route.",
      "clear-arp": "The core forwards labelled traffic fine (LSP ping 5/5). ARP is not involved in a route-import decision.",
    },
    attempt: (s) => s.repairAttempt,
  },
  diagnostics: {
    fromStepId: "diagnostic-layers",
    layers: (s) => {
      const rx = s.pe1Vpnv4.find((r) => r.from === "PE2");
      const hit = vrfLookup(s.pe1Vrf, CUST.ce2);
      return [
        { label: `Underlay (IGP) — PE1 reaches ${LOOP.PE2}/32`, status: "healthy" },
        { label: "Transport (LDP) — sessions Operational, FEC 10.0.0.4/32 → 16004, LSP ping 5/5", status: "healthy" },
        { label: `VPN control plane — MP-BGP ${s.bgp}; received ${rx ? `RT ${rx.rts.join(",")} label ${rx.label}` : "nothing"}`, status: "healthy" },
        { label: `VRF ${VRF} import — ${rx ? (importable(rx) ? "imported" : `RT ${rx.rts.join(",")} not in import 65000:100`) : "—"}`, status: rx && importable(rx) ? "healthy" : "failing" },
        { label: `Data plane — PE1 ${VRF} lookup ${CUST.ce2}: ${hit?.source === "imported" ? "VPN + transport labels" : "no route → dropped"}`, status: hit?.source === "imported" ? "healthy" : "failing" },
      ];
    },
  },
  sidePanel: (s) => (
    <div className="space-y-3">
      <MplsPanel s={s} />
      <EvidenceNotebook entries={s.notebook} />
    </div>
  ),
  complete: { badge: "Lesson Complete", title: "You can troubleshoot an MPLS VPN by plane", message: "Underlay and transport healthy, MP-BGP Established and delivering the route — and a Route Target that stopped it at the VRF door. Found plane by plane, fixed at the export policy, proven by the label stack that finally left PE1." },
};

export default function TroubleshootingMplsDemo() {
  return <FundamentalsLessonShell config={config} />;
}
