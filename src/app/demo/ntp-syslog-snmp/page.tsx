"use client";

import { FundamentalsLessonShell, type FundamentalsLessonConfig } from "@/components/lesson/FundamentalsLessonShell";
import type { LessonGuideTab } from "@/components/lesson/LessonGuideDialog";
import { kitAdapters, kitCallout, type KitDevice } from "@/components/lesson/ccnaKit";
import { ADDR, OPS_REPAIR_CORRECT, OPS_REPAIR_OPTIONS, ST, createOpsState, opsSteps, type Dev, type OpsState } from "@/lib/sim-engine/scenarios/ccna/ntpSyslogSnmp";
import { OpsPanel } from "./OpsPanel";
import { OPS_BRIEFING_NOTES, OPS_BRIEFING_PHASES, OPS_DEEP_SECTIONS, OPS_LESSON_SECTIONS, OpsDeepDiveContent, OpsLessonGuideContent } from "./guide";

const GUIDE_TABS: LessonGuideTab[] = [
  { id: "lesson", label: "This Lesson", hint: "NTP timestamps and stratum · syslog severities · SNMP polls, traps and versions · a scrambled timeline", sections: OPS_LESSON_SECTIONS, content: <OpsLessonGuideContent /> },
  { id: "deep", label: "Operations Deep Dive", hint: "Streaming telemetry · misconceptions", sections: OPS_DEEP_SECTIONS, content: <OpsDeepDiveContent /> },
];

const dev = (id: Dev, role: string): KitDevice<OpsState> => ({
  id,
  deviceType: id === "FW1" ? "Firewall" : id === "SW1" ? "Switch" : "Router",
  role,
  stages: ST.dev,
  ports: () => [],
  knows: (s) => (s.clocks[id].synced ? `NTP ${s.clocks[id].server} · stratum ${s.clocks[id].stratum} · offset ${s.clocks[id].offset} s` : `NTP ${s.clocks[id].server} · unsynchronised`),
  tables: (s) => [{ title: `${id} NTP`, rows: [{ label: "server", value: s.clocks[id].server ?? "—" }, { label: "state", value: s.clocks[id].synced ? "synchronised" : "unsynchronised" }, { label: "stratum", value: String(s.clocks[id].synced ? s.clocks[id].stratum : 16) }, { label: "offset", value: `${s.clocks[id].offset} s` }] }],
});
const DEVICES: KitDevice<OpsState>[] = [
  { id: "NTP-PUB", deviceType: "Stratum 1 server", role: "GPS-disciplined public time server.", stages: ST.srv, ports: () => [], knows: () => ADDR.pub },
  dev("CORE", "Internal NTP server for every device; client of NTP-PUB."),
  dev("R1", "WAN router."),
  dev("FW1", "Firewall."),
  dev("SW1", "Access switch, replaced last month."),
  { id: "SYSLOG", deviceType: "Syslog server", role: "Collects every device's log on UDP 514.", stages: ST.srv, ports: () => [], knows: (s) => `${s.logs.length} messages`, tables: (s) => [{ title: "SYSLOG messages", rows: s.logs.map((l) => ({ label: l.dev, value: `%${l.mnemonic}` })) }] },
  { id: "NMS", deviceType: "Network management system", role: "SNMP polls (UDP 161) and receives traps (UDP 162).", stages: ST.srv, ports: () => [], knows: () => ADDR.nms },
];
const adapters = kitAdapters(DEVICES, "operations");

const config: FundamentalsLessonConfig<OpsState> = {
  lessonId: "ntp-syslog-snmp",
  xp: 150,
  steps: opsSteps,
  createState: createOpsState,
  badge: "CCNA · IP Services",
  title: "NTP, Syslog & SNMP",
  intro: "The operations triad: synchronise every clock with NTP from four timestamps, send the right syslog severities to one server, and measure the network with SNMP polls and traps — then rebuild an outage timeline that one unsynchronised switch scrambled.",
  facts: [
    { q: "Why does time matter?", a: "Logs from many devices only line up if their clocks agree." },
    { q: "What is stratum?", a: "Hops from a reference clock. 16 means unsynchronised." },
    { q: "Which syslog levels are sent?", a: "logging trap N sends severities 0 through N." },
    { q: "Polls or traps?", a: "Polls (UDP 161) for numbers, traps (UDP 162) for events." },
  ],
  terms: [
    { term: "NTP", expansion: "Network Time Protocol", meaning: "UDP 123" },
    { term: "Stratum", expansion: "Distance from reference", meaning: "16 = unsynced" },
    { term: "Syslog", expansion: "System logging", meaning: "UDP 514" },
    { term: "SNMP", expansion: "Simple Network Management", meaning: "UDP 161 / 162" },
    { term: "MIB", expansion: "Management information base", meaning: "OIDs" },
  ],
  guide: { title: "NTP, Syslog & SNMP", subtitle: "NTP-PUB → CORE → R1 · FW1 · SW1 · SYSLOG · NMS", tabs: GUIDE_TABS },
  briefing: { phases: OPS_BRIEFING_PHASES, notes: OPS_BRIEFING_NOTES },
  nodes: (s) => [
    { id: "NTP-PUB", label: "NTP-PUB", subLabel: "stratum 1", x: 50, y: 8, kind: "cloud" },
    { id: "CORE", label: "CORE", subLabel: s.clocks.CORE.synced ? `stratum ${s.clocks.CORE.stratum}` : "unsynced", x: 50, y: 34, kind: "switch" },
    { id: "R1", label: "R1", subLabel: s.clocks.R1.synced ? `stratum ${s.clocks.R1.stratum}` : "unsynced", x: 18, y: 62, kind: "router" },
    { id: "FW1", label: "FW1", subLabel: s.clocks.FW1.synced ? `stratum ${s.clocks.FW1.stratum}` : "unsynced", x: 50, y: 62, kind: "firewall" },
    { id: "SW1", label: "SW1", subLabel: s.clocks.SW1.synced ? `stratum ${s.clocks.SW1.stratum}` : "unsynced", x: 82, y: 62, kind: "switch" },
    { id: "SYSLOG", label: "SYSLOG", subLabel: ADDR.syslog, x: 30, y: 90, kind: "server" },
    { id: "NMS", label: "NMS", subLabel: ADDR.nms, x: 70, y: 90, kind: "server" },
  ],
  edges: () => [
    { id: "pub", a: "NTP-PUB", b: "CORE", label: "NTP" },
    { id: "r1", a: "CORE", b: "R1" },
    { id: "fw", a: "CORE", b: "FW1" },
    { id: "sw", a: "CORE", b: "SW1" },
    { id: "sl", a: "CORE", b: "SYSLOG" },
    { id: "nms", a: "CORE", b: "NMS" },
  ],
  enterable: ["CORE", "SW1", "R1"],
  primaryDevice: { "ntp-core": "CORE", "ntp-clients": "R1", syslog: "R1", "snmp-poll": "SW1", "snmp-trap": "SW1", "fault-injected": "SYSLOG", "inc-timeline": "SYSLOG", "diagnostic-layers": "SW1", "repair-challenge": "SW1", verify: "SW1" },
  ...adapters,
  callout: kitCallout,
  sidePanel: (s) => <OpsPanel s={s} />,
  repair: {
    stepId: "repair-challenge",
    prompt: "SW1's log entries are three hours off and it reports stratum 16. Which change fixes the cause?",
    options: OPS_REPAIR_OPTIONS,
    correctId: OPS_REPAIR_CORRECT,
    success: "SW1 synchronises to CORE (stratum 3), and its messages line up with every other device's.",
    wrongFeedback: {
      "clock-set": "A hand-set clock drifts again, and nothing shows whether it's still right. Fix the source.",
      tz: "The server only stores what devices send. R1 and FW1 already agree with each other.",
      buffer: "The buffer size changes how much is kept locally, not the timestamps on it.",
    },
    attempt: (s) => s.repairAttempt,
  },
  diagnostics: {
    fromStepId: "diagnostic-layers",
    layers: (s) => [
      { label: `CORE — synchronised to ${ADDR.pub}, stratum ${s.clocks.CORE.stratum}`, status: "healthy" },
      { label: `SW1 NTP server — ${s.clocks.SW1.server}${s.clocks.SW1.server === ADDR.oldNtp ? " (decommissioned, unreachable)" : ""}`, status: s.clocks.SW1.server === ADDR.oldNtp ? "failing" : "healthy" },
      { label: `SW1 association — ${s.clocks.SW1.synced ? `synchronised, stratum ${s.clocks.SW1.stratum}` : "unsynchronised, stratum 16"}`, status: s.clocks.SW1.synced ? "healthy" : "failing" },
      { label: `SW1 offset — ${s.clocks.SW1.offset} s`, status: Math.abs(s.clocks.SW1.offset) < 1 ? "healthy" : "failing" },
      { label: "Syslog transport — messages from all devices arrive", status: "healthy" },
    ],
  },
  complete: { badge: "Lesson Complete", title: "You can run the network, not just build it", message: "NTP from four timestamps and a stratum hierarchy, syslog severities filtered and stamped by the sender, SNMP polls and traps with v3 — and one clock for everything." },
};

export default function OpsDemo() {
  return <FundamentalsLessonShell config={config} />;
}
