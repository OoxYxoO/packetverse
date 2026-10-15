"use client";

import { FundamentalsLessonShell, type FundamentalsLessonConfig } from "@/components/lesson/FundamentalsLessonShell";
import type { LessonGuideTab } from "@/components/lesson/LessonGuideDialog";
import { kitAdapters, kitCallout, type KitDevice } from "@/components/lesson/ccnaKit";
import { OD_REPAIR_CORRECT, OD_REPAIR_OPTIONS, ST, createOdState, duplicates, neighborState, ospfDrSteps, present, routerId, routesOn, type OdState } from "@/lib/sim-engine/scenarios/ccna/ospfDr";
import { OdPanel } from "./OdPanel";
import { OD_BRIEFING_NOTES, OD_BRIEFING_PHASES, OD_DEEP_SECTIONS, OD_LESSON_SECTIONS, OdDeepDiveContent, OdLessonGuideContent } from "./guide";

const GUIDE_TABS: LessonGuideTab[] = [
  { id: "lesson", label: "This Lesson", hint: "Router ID rules · why a DR · election · FULL vs 2-WAY · network types · a duplicate router ID", sections: OD_LESSON_SECTIONS, content: <OdLessonGuideContent /> },
  { id: "deep", label: "OSPF DR/BDR Deep Dive", hint: "Neighbour state machine · what must match · misconceptions", sections: OD_DEEP_SECTIONS, content: <OdDeepDiveContent /> },
];

const POS: Record<string, [number, number]> = { R1: [14, 22], R2: [86, 22], R3: [14, 78], R4: [86, 78], R5: [50, 92] };
const ROUTERS = ["R1", "R2", "R3", "R4", "R5"];
const DEVICES: KitDevice<OdState>[] = [
  ...ROUTERS.map(
    (id): KitDevice<OdState> => ({
      id,
      deviceType: "OSPF router",
      role: "On segment 10.0.0.0/24 (area 0) with its own LAN.",
      stages: ST.rtr,
      ports: (s) => {
        const r = s.routers.find((x) => x.id === id)!;
        return [{ id: "Gi0/0", neighbor: "LAN-SW", linkType: "broadcast · area 0", ip: `${r.ifaces[0]}/24`, extra: [["priority", String(r.priority)]] }, { id: "Gi0/1", linkType: `LAN ${r.lan}`, ip: r.ifaces[1] }];
      },
      knows: (s) => {
        const r = s.routers.find((x) => x.id === id)!;
        if (!r.present) return "Not on the segment yet";
        const rid = routerId(r);
        return `RID ${rid.rid} (${rid.how})${s.elected ? ` · ${s.dr === id ? "DR" : s.bdr === id ? "BDR" : "DROTHER"}` : ""}`;
      },
      tables: (s) => [
        { title: `${id} OSPF neighbours`, rows: present(s).filter((r) => r.id !== id).map((r) => ({ label: `${r.id} (${routerId(r).rid})`, value: neighborState(s, id, r.id) })) },
        { title: `${id} routes`, rows: routesOn(s, id).map((x) => ({ label: x.split(" ")[1], value: x })) },
      ],
    }),
  ),
  { id: "LAN-SW", deviceType: "Switch", role: "The shared Ethernet segment.", stages: ST.sw, ports: () => [], knows: () => "Floods OSPF multicast to every router" },
];
const adapters = kitAdapters(DEVICES, "OSPF on a broadcast segment");

const config: FundamentalsLessonConfig<OdState> = {
  lessonId: "ospf-dr-bdr",
  xp: 150,
  steps: ospfDrSteps,
  createState: createOdState,
  badge: "CCNA · IP Connectivity",
  title: "OSPF on Shared Networks: DR, BDR & Router ID",
  intro: "Four routers share one Ethernet segment. Choose their router IDs by the rules, watch hellos elect a designated router and a backup, see who becomes FULL with whom and why a newcomer waits — then fix a pasted configuration that made one router invisible.",
  facts: [
    { q: "Why a DR?", a: "Everyone synchronises with two routers instead of with everyone." },
    { q: "Where do DROTHERs send updates?", a: "224.0.0.6 — only the DR and BDR listen there." },
    { q: "What's the default priority?", a: "1. The range is 0–255." },
    { q: "Is there a DR on point-to-point?", a: "No — two routers need no election." },
  ],
  terms: [
    { term: "RID", expansion: "Router ID", meaning: "Unique 32-bit name" },
    { term: "DR / BDR", expansion: "Designated / backup router", meaning: "Segment hub" },
    { term: "DROTHER", expansion: "Not DR or BDR", meaning: "2-WAY with peers" },
    { term: "224.0.0.5", expansion: "AllSPFRouters", meaning: "Everyone" },
    { term: "224.0.0.6", expansion: "AllDRouters", meaning: "DR + BDR" },
  ],
  guide: { title: "OSPF on Shared Networks: DR, BDR & Router ID", subtitle: "R1–R4 (+R5) · segment 10.0.0.0/24 · area 0", tabs: GUIDE_TABS },
  briefing: { phases: OD_BRIEFING_PHASES, notes: OD_BRIEFING_NOTES },
  nodes: (s) => [
    { id: "LAN-SW", label: "LAN-SW", subLabel: "10.0.0.0/24", x: 50, y: 50, kind: "switch" },
    ...present(s).map((r) => ({ id: r.id, label: r.id, subLabel: `${s.ridsKnown ? routerId(r).rid : `p${r.priority}`}${s.elected ? ` · ${s.dr === r.id ? "DR" : s.bdr === r.id ? "BDR" : "DROTHER"}` : ""}${duplicates(s).has(r.id) ? " · DUP" : ""}`, x: POS[r.id][0], y: POS[r.id][1], kind: "router" as const })),
  ],
  edges: (s) => present(s).map((r) => ({ id: r.id, a: r.id, b: "LAN-SW", label: `p${r.priority}` })),
  enterable: ["R1", "R3", "R4"],
  primaryDevice: { "router-id": "R3", hello: "R1", election: "R1", adjacencies: "R3", flood: "R1", "late-joiner": "R5", "fault-injected": "R3", "inc-missing": "R1", "diagnostic-layers": "R3", "repair-challenge": "R3", verify: "R1" },
  ...adapters,
  callout: kitCallout,
  sidePanel: (s) => <OdPanel s={s} />,
  repair: {
    stepId: "repair-challenge",
    prompt: "R3's LAN is missing everywhere since it was replaced. Which change fixes the cause?",
    options: OD_REPAIR_OPTIONS,
    correctId: OD_REPAIR_CORRECT,
    success: "With router ID 3.3.3.3 and the process restarted, R3 forms FULL adjacencies with the DR and BDR, and 192.168.30.0/24 is flooded to everyone.",
    wrongFeedback: {
      prio: "Priority only matters for the election — and it isn't preemptive. R3's hellos are still rejected for the duplicate ID.",
      area: "A different area needs an ABR and doesn't fix the duplicate; R3's LSAs would still be discarded.",
      reload: "R1 comes back with 1.1.1.1 and the duplicate is still there.",
    },
    attempt: (s) => s.repairAttempt,
  },
  diagnostics: {
    fromStepId: "diagnostic-layers",
    layers: (s) => {
      const dup = duplicates(s);
      const r3 = s.routers.find((r) => r.id === "R3")!;
      return [
        { label: "Segment — Gi0/0 up on all routers", status: "healthy" },
        { label: "Hello parameters — area 0, 10/40 s, /24", status: "healthy" },
        { label: `Router IDs — R3 uses ${routerId(r3).rid}${dup.size ? " (also R1's)" : ""}`, status: dup.size ? "failing" : "healthy" },
        { label: `Neighbours — R1↔R3 ${neighborState(s, "R1", "R3")}`, status: neighborState(s, "R1", "R3") === "FULL" ? "healthy" : "failing" },
        { label: `Routes — 192.168.30.0/24 ${routesOn(s, "R1").some((x) => x.includes("192.168.30")) ? "on R1" : "missing on R1"}`, status: routesOn(s, "R1").some((x) => x.includes("192.168.30")) ? "healthy" : "failing" },
      ];
    },
  },
  complete: { badge: "Lesson Complete", title: "You can read an OSPF segment", message: "Router IDs chosen by rule and kept unique; DR and BDR by priority then router ID, never preempted; FULL to the DR and BDR, 2-WAY between the rest; and no election on point-to-point links." },
};

export default function OspfDrBdrDemo() {
  return <FundamentalsLessonShell config={config} />;
}
