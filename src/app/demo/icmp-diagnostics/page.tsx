"use client";

import { FundamentalsLessonShell, type FundamentalsLessonConfig } from "@/components/lesson/FundamentalsLessonShell";
import { fundamentalsAppCallout } from "@/components/lesson/fundamentalsAppCallout";
import type { LessonGuideTab } from "@/components/lesson/LessonGuideDialog";
import { IC_ADDR, IC_REPAIR_CORRECT, IC_REPAIR_OPTIONS, createIcmpState, icmpDiagnosticsSteps, type IcDevice, type IcmpState } from "@/lib/sim-engine/scenarios/icmpDiagnostics";
import { IC_BRIEFING_NOTES, IC_BRIEFING_PHASES } from "./briefing";
import { icInterfacesFor, icTraceFor } from "./deviceTrace";
import { explainIc, icTables } from "./explain";
import { icNames } from "./addressNames";
import { IcmpProbePanel, PmtuCalculator } from "./IcmpProbePanel";
import { IC_LESSON_SECTIONS, IcmpLessonGuideContent } from "./LessonGuideContent";
import { IcmpPresentation } from "./IcmpPresentation";
import { IcmpLabWorkspace } from "./icmp-lab/IcmpLabWorkspace";
import { IC_DEEP_DIVE_SECTIONS, IcmpDeepDiveContent } from "./DeepDiveContent";

const GUIDE_TABS: LessonGuideTab[] = [
  { id: "lesson", label: "This Lesson", hint: "HOST-A → R1 → R2 → HOST-B · ping · traceroute · PMTU incident", sections: IC_LESSON_SECTIONS, content: <IcmpLessonGuideContent /> },
  { id: "deep", label: "ICMP & Diagnostics Deep Dive", hint: "ICMP messages and diagnostic tools in general", sections: IC_DEEP_DIVE_SECTIONS, content: <IcmpDeepDiveContent /> },
];
/** The size calculator appears only after the repair, so it never answers the diagnosis or the repair challenge. */
const CALC_STEPS = new Set(["verify-send", "verify-forward", "verify-deliver", "verify-reply"]);

const config: FundamentalsLessonConfig<IcmpState> = {
  lessonId: "icmp-diagnostics",
  xp: 175,
  steps: icmpDiagnosticsSteps,
  createState: createIcmpState,
  badge: "Fundamentals · Diagnostics",
  title: "ICMP & Network Diagnostics",
  intro: "Ping across two routers, map the path with ICMP-Echo-based traceroute, then find out why large DF packets fail after a maintenance change — all by reading ICMP Type and Code.",
  facts: [
    { q: "Where does ICMP live?", a: "Directly in IPv4 (Protocol 1). No TCP, no UDP, no ports." },
    { q: "What does TTL do?", a: "Each forwarding router subtracts one. At expiry the router discards the packet and sends Time Exceeded (11/0)." },
    { q: "How does traceroute work?", a: "Probes with TTL 1, 2, 3 … make each hop reveal itself with Time Exceeded." },
    { q: "What does 3/4 mean?", a: "Fragmentation Needed and DF set. The message carries the next-hop MTU." },
  ],
  terms: [
    { term: "ICMP", expansion: "Internet Control Message Protocol", meaning: "IP's control/error messages" },
    { term: "TTL", expansion: "Time To Live", meaning: "Hop limit, −1 per router" },
    { term: "MTU", expansion: "Maximum Transmission Unit", meaning: "Largest IPv4 packet on a link" },
    { term: "DF", expansion: "Don't Fragment", meaning: "Routers must not fragment" },
    { term: "PMTUD", expansion: "Path MTU Discovery", meaning: "Find the path's smallest MTU" },
  ],
  guide: { title: "ICMP & Network Diagnostics", subtitle: `${IC_ADDR["HOST-A"]} → ${IC_ADDR["HOST-B"]} · R1 ${IC_ADDR["R1:TRANSIT"]} ↔ R2 ${IC_ADDR["R2:TRANSIT"]}`, tabs: GUIDE_TABS },
  briefing: { phases: IC_BRIEFING_PHASES, notes: IC_BRIEFING_NOTES },
  nodes: () => [
    { id: "HOST-A", label: "HOST-A", subLabel: IC_ADDR["HOST-A"], x: 8, y: 66, kind: "laptop" },
    { id: "R1", label: "R1", subLabel: IC_ADDR["R1:LAN"], x: 34, y: 36, kind: "router" },
    { id: "R2", label: "R2", subLabel: IC_ADDR["R2:LAN"], x: 66, y: 36, kind: "router" },
    { id: "HOST-B", label: "HOST-B", subLabel: IC_ADDR["HOST-B"], x: 92, y: 66, kind: "laptop" },
  ],
  edges: (s) => [
    { id: "a-r1", a: "HOST-A", b: "R1", label: "192.0.2.0/24" },
    { id: "r1-r2", a: "R1", b: "R2", label: `203.0.113.0/30 · MTU ${s.transitMtu}` },
    { id: "r2-b", a: "R2", b: "HOST-B", label: "198.51.100.0/24" },
  ],
  regions: [],
  enterable: ["R1", "R2"],
  primaryDevice: { "b-receives": "HOST-B", "a-matches": "HOST-A", "repair-challenge": "HOST-A" },
  traceFor: (d, s, stepId) => icTraceFor(d as IcDevice, s, stepId),
  interfacesFor: (d, s, stepId) => icInterfacesFor(d as IcDevice, s, stepId),
  pipelineTitle: (d) => `${d} · IPv4 forwarding + ICMP`,
  explainNode: explainIc,
  tablesFor: (d, s) => icTables(d as IcDevice, s),
  callout: (p, s) => fundamentalsAppCallout(p, icNames, { decision: s.note && (s.note.device === p.from || s.note.device === p.to) ? s.note.text : undefined }),
  repair: {
    stepId: "repair-challenge",
    prompt: "The transit IP MTU is 1400 and must stay that way. Which change lets HOST-A's DF probe through?",
    options: IC_REPAIR_OPTIONS.map((o) => ({ id: o.id, label: o.label })),
    correctId: IC_REPAIR_CORRECT,
    success: "20 (IPv4) + 8 (ICMP) + 1372 (data) = 1400 bytes, which fits the 1400-byte IP MTU exactly, with DF still set.",
    wrongFeedback: {
      "data-1400": "1400 bytes of data makes 20 + 8 + 1400 = 1428 bytes. The IPv4 and ICMP headers count against the MTU too.",
      ttl: "TTL was 64 and never ran out. The error was Type 3 Code 4, not Type 11.",
      seq: "The sequence number only matches replies to requests. It doesn't change the packet's size.",
      dns: "No names are involved. The probe targets an IP address, and the failure is about size.",
    },
    attempt: (s) => s.repairAttempt,
  },
  diagnostics: {
    fromStepId: "diagnostic-layers",
    layers: (s) => [
      { label: "Links up · static routes present (small pings pass)", status: "healthy" },
      { label: "TTL — probes leave with 64; no Time Exceeded seen", status: "healthy" },
      { label: `Probe size ${20 + 8 + s.probe.dataLength} B vs transit IP MTU ${s.transitMtu} B (DF ${s.probe.df ? "set" : "clear"})`, status: s.probe.df && 20 + 8 + s.probe.dataLength > s.transitMtu ? "failing" : "healthy" },
    ],
  },
  panels: (_s, stepId) => (stepId && CALC_STEPS.has(stepId) ? <PmtuCalculator /> : null),
  sidePanel: (s) => <IcmpProbePanel s={s} />,
  practiceLab: {
    entry: { title: "ICMP Lab", buttonLabel: "Practice ICMP", description: "Six short levels on what the network's signals mean (one ping, TTL, traceroute, unreachables, MTU and DF, silence), then a diagnostics desk: follow every probe on the topology, open the routers (Cisco/Junos) and hosts, read captures and counters, and solve six tickets by fixing the real configuration and proving the repair." },
    contextNote: (stepId) => (stepId && /trace|pmtu|ttl|frag|big|fix|verify/i.test(stepId) ? "Want to run the tools yourself?" : undefined),
    render: ({ open, onClose }) => <IcmpLabWorkspace open={open} onClose={onClose} />,
  },
  presentation: { topic: "ICMP", render: (p) => <IcmpPresentation {...p} /> },
  complete: { badge: "Lesson Complete", title: "You can read the network through ICMP", message: "Echo for reachability, Time Exceeded for the path, Fragmentation Needed for the path MTU." },
};

export default function IcmpDiagnosticsDemo() {
  return <FundamentalsLessonShell config={config} />;
}
