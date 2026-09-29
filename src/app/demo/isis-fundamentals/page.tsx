"use client";

import { FundamentalsLessonShell, type FundamentalsLessonConfig, type ShellEdge } from "@/components/lesson/FundamentalsLessonShell";
import { fundamentalsAppCallout } from "@/components/lesson/fundamentalsAppCallout";
import type { LessonGuideTab } from "@/components/lesson/LessonGuideDialog";
import type { PacketCallout3D } from "@/components/network3d/types";
import type { PacketVisual } from "@/lib/sim-engine/types";
import { fieldIn } from "@/lib/sim-engine/scenarios/enterpriseEdgePackets";
import { ISIS_REPAIR_CORRECT, ISIS_REPAIR_OPTIONS, LINKS, ROUTER, adjOf, circuitOf, commonLevel, createIsisState, hex8s, isIsis, isisSteps, linkAdjText, lspIn, pduTypeOf, routeTo, upNeighbors, type IsisRouter, type IsisState } from "@/lib/sim-engine/scenarios/isisFundamentals";
import { ISIS_BRIEFING_NOTES, ISIS_BRIEFING_PHASES } from "./briefing";
import { isisInterfacesFor, isisTraceFor } from "./deviceTrace";
import { explainIsis, isisTables } from "./explain";
import { isisNames } from "./addressNames";
import { IsisPanel } from "./IsisPanel";
import { ISIS_LESSON_SECTIONS, IsisLessonGuideContent } from "./LessonGuideContent";
import { ISIS_DEEP_DIVE_SECTIONS, IsisDeepDiveContent } from "./DeepDiveContent";

const GUIDE_TABS: LessonGuideTab[] = [
  { id: "lesson", label: "This Lesson", hint: "PE1 · P1 · P2 · PE2 · Level-2 P2P adjacencies, LSP flooding, SPF and a level-mismatch incident", sections: ISIS_LESSON_SECTIONS, content: <IsisLessonGuideContent /> },
  { id: "deep", label: "IS-IS Deep Dive", hint: "IS-IS in general — levels, DIS, PDUs, TLVs, operations", sections: ISIS_DEEP_DIVE_SECTIONS, content: <IsisDeepDiveContent /> },
];

const ISIS_HEX = "#22d3ee";
const PDU_SHORT: Record<number, string> = { 17: "P2P IIH (17)", 20: "L2 LSP (20)", 25: "L2 CSNP (25)", 27: "L2 PSNP (27)" };
function isisCallout(p: PacketVisual, s: IsisState): PacketCallout3D {
  const decision = s.decision && (s.decision.device === p.from || s.decision.device === p.to) ? s.decision.text : undefined;
  if (!isIsis(p)) return fundamentalsAppCallout(p, isisNames, { decision });
  const t = pduTypeOf(p);
  const detail =
    t === 17
      ? `three-way ${fieldIn(p, /^TLV 240/, "Adjacency Three-Way State").replace(/^\d+ \((.+)\)$/, "$1")} · circuit type ${fieldIn(p, /^P2P IIH Header$/, "Circuit Type").split(" ")[0]}`
      : t === 20
        ? `${fieldIn(p, /^LSP Header$/, "LSP ID").split(" ")[0]} · seq ${fieldIn(p, /^LSP Header$/, "Sequence Number")}`
        : `${p.summary.split(" · ").slice(-1)[0]}`;
  return { title: `IS-IS ${PDU_SHORT[t]} · ${p.from} → ${p.to}`, detail: [detail, "802.3/LLC · no IP", decision].filter(Boolean).join(" · "), color: ISIS_HEX };
}

function linkEdge(s: IsisState, l: (typeof LINKS)[number]): ShellEdge {
  const adj = linkAdjText(s, l.id);
  // Physical Ethernet stays up in this lesson; only the IS-IS adjacency changes, so the link is never drawn as failed.
  return { id: l.id, a: l.a, b: l.b, label: `Ethernet UP · IS-IS ${adj}`, ...(adj === "L2 UP" ? {} : { visual3D: "controlPlane" as const }) };
}

// Zigzag so every link is long enough to carry its Ethernet / IS-IS label clear of the node cards.
const POS: Record<IsisRouter, { x: number; y: number }> = { PE1: { x: 12, y: 66 }, P1: { x: 32, y: 34 }, P2: { x: 68, y: 34 }, PE2: { x: 87, y: 66 } };

const config: FundamentalsLessonConfig<IsisState> = {
  lessonId: "isis-fundamentals",
  xp: 250,
  steps: isisSteps,
  createState: createIsisState,
  badge: "Service Provider · IGP",
  title: "IS-IS Fundamentals: Adjacencies, LSP Flooding & SPF",
  intro: "Build a Level-2 IS-IS core from nothing: NETs and System IDs, point-to-point hellos straight over Layer 2, the three-way handshake, LSP flooding with CSNP/PSNP, SPF — then ordinary IPv4 over the routes. Finally, lose a route while every Ethernet link stays up.",
  facts: [
    { q: "Does IS-IS run over IP?", a: "No. 802.3 + LLC 0xFE, discriminator 0x83 — no IPv4, UDP or TCP." },
    { q: "What is a NET?", a: "Area + six-byte System ID + NSEL 00. It names the router, not an interface." },
    { q: "When is an adjacency Up?", a: "When you hear your own System ID in the neighbor's three-way TLV (240)." },
    { q: "What does SPF use?", a: "Only links both ends report in their LSPs. The result becomes IPv4 routes." },
  ],
  terms: [
    { term: "IIH", expansion: "IS-IS Hello", meaning: "P2P type 17" },
    { term: "LSP", expansion: "Link State PDU", meaning: "L2 type 20" },
    { term: "CSNP / PSNP", expansion: "Sequence Number PDUs", meaning: "L2 25 / 27" },
    { term: "NET", expansion: "Network Entity Title", meaning: "Area · System ID · 00" },
    { term: "TLV 22 / 135", expansion: "Extended IS / IP reach", meaning: "Wide metrics" },
  ],
  guide: { title: "IS-IS Fundamentals: Adjacencies, LSP Flooding & SPF", subtitle: "Level-2 only · area 49.0001 · point-to-point Ethernet circuits · metric 10", tabs: GUIDE_TABS },
  briefing: { phases: ISIS_BRIEFING_PHASES, notes: ISIS_BRIEFING_NOTES },
  nodes: (s) =>
    (["PE1", "P1", "P2", "PE2"] as IsisRouter[]).map((r) => ({ id: r, label: r, subLabel: `${ROUTER[r].loopback}${lspIn(s, r, r) ? ` · seq ${Number(lspIn(s, r, r)!.seq)}` : ""}`, x: POS[r].x, y: POS[r].y, kind: "router" as const })),
  edges: (s) => LINKS.map((l) => linkEdge(s, l)),
  regions: [{ id: "l2", label: "IS-IS Level-2 domain · area 49.0001", x: 2, y: 18, width: 96, height: 68, tone: "cyan" }],
  enterable: ["PE1", "P1", "P2", "PE2"],
  primaryDevice: { "net-decomp": "PE1", levels: "P1", encapsulation: "P2", "all-adjacencies": "P1", "others-flood": "P1", lsdb: "PE1", "spf-pe1": "PE1", rib: "PE1", "incident-intro": "P2", "inc-spf": "PE1", "inc-ping": "PE1", "repair-challenge": "P2", "rep-spf": "PE1" },
  traceFor: (d, s, stepId) => isisTraceFor(d as IsisRouter, s, stepId),
  interfacesFor: (d, s, stepId) => isisInterfacesFor(d as IsisRouter, s, stepId),
  pipelineTitle: (d) => `${d} · IS-IS control plane + IPv4 forwarding`,
  explainNode: explainIsis,
  tablesFor: (d, s) => isisTables(d as IsisRouter, s),
  callout: isisCallout,
  floodCopies: (s) => s.flood,
  nodeBadges: (id, s) => [`L2 adj ${upNeighbors(s, id as IsisRouter).length}`],
  repair: {
    stepId: "repair-challenge",
    prompt: "Ethernet and IPv4 are fine, but the P1–P2 IS-IS adjacency is Down and PE1 has no route to 10.0.0.4. Which change fixes it?",
    options: ISIS_REPAIR_OPTIONS.map((o) => ({ id: o.id, label: o.label })),
    correctId: ISIS_REPAIR_CORRECT,
    success: "P2's ge-0/0/0 runs Level 2 again. P1 and P2 now share a level, so their IIHs can bring the adjacency back up.",
    wrongFeedback: {
      "change-31": "The /31 is correct and IS-IS doesn't use it to form the adjacency anyway — the hellos travel in LLC frames, not IP.",
      "restart-bgp": "BGP is not involved in building the IGP. The core has no IS-IS path, whatever BGP does.",
      "clear-arp": "ARP resolves IPv4 next hops; IS-IS hellos don't use ARP. The adjacency fails on levels, not addressing.",
      "raise-mtu": "Hellos are being received — the MTU is not the problem. The circuit-type fields show no common level.",
    },
    attempt: (s) => s.repairAttempt,
  },
  diagnostics: {
    fromStepId: "diagnostic-layers",
    layers: (s) => {
      const common = commonLevel(s, "P1", "P2");
      const rt = routeTo(s, "PE1", "10.0.0.4/32");
      const p1 = lspIn(s, "PE1", "P1");
      return [
        { label: `Ethernet P1 ge-0/0/1 ↔ P2 ge-0/0/0 — ${s.physUp["L-P1-P2"] ? "UP" : "DOWN"}`, status: s.physUp["L-P1-P2"] ? "healthy" : "failing" },
        { label: "IPv4 192.0.2.2/31 ↔ 192.0.2.3/31 — configured", status: "healthy" },
        { label: `IS-IS circuit level — P1 ${circuitOf(s, "P1", "P2")} · P2 ${circuitOf(s, "P2", "P1")} · common ${common}`, status: common === "none" ? "failing" : "healthy" },
        { label: `Adjacency P1–P2 — P1 ${adjOf(s, "P1", "P2").state} · P2 ${adjOf(s, "P2", "P1").state}`, status: adjOf(s, "P1", "P2").state === "UP" && adjOf(s, "P2", "P1").state === "UP" ? "healthy" : "failing" },
        { label: `PE1 LSDB — P1's LSP ${p1 ? hex8s(p1.seq) : "—"} ${p1?.isReach.some((n) => n.neighbor === "P2") ? "lists P2" : "does not list P2"}`, status: p1?.isReach.some((n) => n.neighbor === "P2") ? "healthy" : "failing" },
        { label: `PE1 route to 10.0.0.4/32 — ${rt ? `metric ${rt.metric} via ${rt.nextHop}` : "none"}`, status: rt ? "healthy" : "failing" },
      ];
    },
  },
  sidePanel: (s) => <IsisPanel s={s} />,
  complete: { badge: "Lesson Complete", title: "You can build and read an IS-IS core", message: "NETs, point-to-point hellos over Layer 2, three-way adjacencies, LSP flooding with CSNP/PSNP, SPF with the two-way check — and a level mismatch you can tell apart from a broken link." },
};

export default function IsisFundamentalsDemo() {
  return <FundamentalsLessonShell config={config} />;
}
