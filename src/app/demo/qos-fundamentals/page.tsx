"use client";

import { FundamentalsLessonShell, type FundamentalsLessonConfig } from "@/components/lesson/FundamentalsLessonShell";
import type { LessonGuideTab } from "@/components/lesson/LessonGuideDialog";
import { kitAdapters, kitCallout, type KitDevice } from "@/components/lesson/ccnaKit";
import { LINK_MBPS, QOS_REPAIR_CORRECT, QOS_REPAIR_OPTIONS, ST, createQosState, qosSteps, run, type QosState } from "@/lib/sim-engine/scenarios/ccna/qos";
import { QosPanel } from "./QosPanel";
import { QOS_BRIEFING_NOTES, QOS_BRIEFING_PHASES, QOS_DEEP_SECTIONS, QOS_LESSON_SECTIONS, QosDeepDiveContent, QosLessonGuideContent } from "./guide";

const GUIDE_TABS: LessonGuideTab[] = [
  { id: "lesson", label: "This Lesson", hint: "DSCP and CoS · FIFO vs LLQ computed · policing and shaping · a trust boundary lost", sections: QOS_LESSON_SECTIONS, content: <QosLessonGuideContent /> },
  { id: "deep", label: "QoS Deep Dive", hint: "Voice budgets · misconceptions", sections: QOS_DEEP_SECTIONS, content: <QosDeepDiveContent /> },
];

const DEVICES: KitDevice<QosState>[] = [
  { id: "PHONE", deviceType: "IP phone", role: "Marks voice DSCP EF, CoS 5.", stages: ST.acc, ports: () => [{ id: "eth0", neighbor: "ACC-SW", linkType: "voice VLAN 110" }], knows: () => "Marks EF (46)" },
  { id: "PC", deviceType: "PC", role: "Behind the phone; runs the backup agent.", stages: ST.acc, ports: () => [{ id: "eth0", neighbor: "ACC-SW", linkType: "data VLAN 10" }], knows: () => "Backup 9 Mb/s at 22:00" },
  { id: "ACC-SW", deviceType: "Access switch", role: "The trust boundary: keeps or rewrites markings on ingress.", stages: ST.acc, ports: (s) => [{ id: "Gi1/0/5", neighbor: "PHONE", linkType: s.trustPhones ? "trust DSCP (phone detected)" : "untrusted (re-mark 0)" }, { id: "Gi1/0/48", neighbor: "R1", linkType: "uplink" }], knows: (s) => (s.trustPhones ? "Trusts phones' DSCP" : "Re-marks everything to 0") },
  {
    id: "R1",
    deviceType: "Branch router",
    role: `QoS on the ${LINK_MBPS} Mb/s WAN interface Se0/1/0.`,
    stages: ST.r1,
    ports: () => [{ id: "Gi0/0", neighbor: "ACC-SW", linkType: "LAN" }, { id: "Se0/1/0", neighbor: "WAN", linkType: `${LINK_MBPS} Mb/s WAN` }],
    knows: (s) => (s.policy === "fifo" ? "No policy (FIFO)" : "service-policy output WAN-OUT"),
    tables: (s) => [{ title: "R1 classes (show policy-map interface)", rows: run(s).map((r) => ({ label: `${r.queue}: ${r.name}`, value: `${r.sentMbps}/${r.mbps} Mb/s · drop ${r.lossPct}%` })) }],
  },
  { id: "WAN", deviceType: "WAN", role: "To headquarters (call server, backup server).", stages: ST.r1, ports: () => [], knows: () => "10 Mb/s contract" },
];
const adapters = kitAdapters(DEVICES, "QoS per hop");

const config: FundamentalsLessonConfig<QosState> = {
  lessonId: "qos-fundamentals",
  xp: 150,
  steps: qosSteps,
  createState: createQosState,
  badge: "CCNA · IP Services",
  title: "QoS Fundamentals",
  intro: "Push 13 Mb/s through a 10 Mb/s WAN link and decide who suffers. Mark at a trusted edge, compare FIFO tail drop with low-latency queuing — computed per flow — shape to the contract instead of being policed, and find out why voice broke up after a switch swap.",
  facts: [
    { q: "When does QoS matter?", a: "Only during congestion — when offered load exceeds the link." },
    { q: "What is EF?", a: "DSCP 46, the standard marking for voice." },
    { q: "What is CoS?", a: "A 3-bit priority in the 802.1Q tag — Layer 2 marking." },
    { q: "What is tail drop?", a: "Dropping new arrivals because the queue is already full." },
  ],
  terms: [
    { term: "DSCP", expansion: "Differentiated services code point", meaning: "IP marking" },
    { term: "CoS", expansion: "Class of service (802.1p)", meaning: "Tag marking" },
    { term: "LLQ", expansion: "Low-latency queuing", meaning: "Priority queue" },
    { term: "CBWFQ", expansion: "Class-based WFQ", meaning: "Guarantees" },
    { term: "CIR / Bc / Tc", expansion: "Rate / burst / interval", meaning: "Token bucket" },
  ],
  guide: { title: "QoS Fundamentals", subtitle: "PHONE + PC → ACC-SW → R1 → 10 Mb/s WAN", tabs: GUIDE_TABS },
  briefing: { phases: QOS_BRIEFING_PHASES, notes: QOS_BRIEFING_NOTES },
  nodes: (s) => [
    { id: "PHONE", label: "PHONE", subLabel: "EF 46", x: 8, y: 30, kind: "laptop" },
    { id: "PC", label: "PC", subLabel: "backup", x: 8, y: 72, kind: "laptop" },
    { id: "ACC-SW", label: "ACC-SW", subLabel: "access", x: 32, y: 50, kind: "switch" },
    { id: "R1", label: "R1", subLabel: s.policy === "fifo" ? "FIFO" : "LLQ", x: 60, y: 50, kind: "router" },
    { id: "WAN", label: "WAN", subLabel: `${LINK_MBPS} Mb/s`, x: 90, y: 50, kind: "cloud" },
  ],
  edges: () => [
    { id: "ph", a: "PHONE", b: "ACC-SW", label: "voice" },
    { id: "pc", a: "PC", b: "ACC-SW", label: "data" },
    { id: "up", a: "ACC-SW", b: "R1", label: "1 Gb/s" },
    { id: "wan", a: "R1", b: "WAN", label: `${LINK_MBPS} Mb/s · Se0/1/0` },
  ],
  enterable: ["R1", "ACC-SW"],
  primaryDevice: { fifo: "R1", llq: "R1", shaper: "R1", "fault-injected": "ACC-SW", "inc-choppy": "ACC-SW", "diagnostic-layers": "R1", "repair-challenge": "ACC-SW", verify: "R1" },
  ...adapters,
  callout: kitCallout,
  sidePanel: (s) => <QosPanel s={s} />,
  repair: {
    stepId: "repair-challenge",
    prompt: "Voice now lands in class-default and drops 30% during the backup. Which change fixes the cause?",
    options: QOS_REPAIR_OPTIONS,
    correctId: QOS_REPAIR_CORRECT,
    success: "Phone ports trust DSCP again, so voice reaches R1 as EF, enters the priority queue and loses nothing.",
    wrongFeedback: {
      prio: "The priority class matches zero packets — making it bigger changes nothing.",
      nopolicy: "That's FIFO: everyone loses 23% instead, video included.",
      backup: "Then 9 Mb/s of backup competes in the 2 Mb/s priority queue and gets policed — and voice still arrives as 0.",
    },
    attempt: (s) => s.repairAttempt,
  },
  diagnostics: {
    fromStepId: "diagnostic-layers",
    layers: (s) => {
      const v = run(s)[0];
      return [
        { label: "Phone marking — EF (46)", status: "healthy" },
        { label: `Access port trust — ${s.trustPhones ? "trusts phone DSCP" : "re-marks to 0"}`, status: s.trustPhones ? "healthy" : "failing" },
        { label: `R1 classification — voice arrives as DSCP ${v.dscp}`, status: v.dscp === 46 ? "healthy" : "failing" },
        { label: `Queue — voice in ${v.queue}`, status: v.queue.startsWith("PRIORITY") ? "healthy" : "failing" },
        { label: `Result — voice loss ${v.lossPct}%, queuing ${v.delayMs} ms`, status: v.lossPct === 0 ? "healthy" : "failing" },
      ];
    },
  },
  complete: { badge: "Lesson Complete", title: "You can decide who waits", message: "Mark at a trusted edge, LLQ for voice and CBWFQ for the rest, shape to the contract — and keep the trust boundary intact when hardware changes." },
};

export default function QosDemo() {
  return <FundamentalsLessonShell config={config} />;
}
