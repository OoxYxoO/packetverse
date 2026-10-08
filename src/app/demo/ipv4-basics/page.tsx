"use client";

import { FundamentalsLessonShell, type FundamentalsLessonConfig } from "@/components/lesson/FundamentalsLessonShell";
import { fundamentalsCallout } from "@/components/lesson/fundamentalsCallout";
import type { LessonGuideTab } from "@/components/lesson/LessonGuideDialog";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { IPV4_REPAIR_CORRECT, IPV4_REPAIR_OPTIONS, V4_IP, V4_PREFIX, createIpv4State, ipv4BasicsSteps, maskOf, networkOf, type Ipv4Device, type Ipv4State } from "@/lib/sim-engine/scenarios/ipv4Basics";
import { V4_BRIEFING_NOTES, V4_BRIEFING_PHASES } from "./briefing";
import { v4InterfacesFor, v4TraceFor } from "./deviceTrace";
import { explainV4, v4Tables } from "./explain";
import { v4Names } from "./addressNames";
import { SubnetChamber } from "./SubnetChamber";
import { V4_EDGES, V4_NODES, V4_REGIONS } from "./topology";
import { Ipv4LabWorkspace } from "./ipv4-lab/Ipv4LabWorkspace";
import { V4_LESSON_SECTIONS, Ipv4LessonGuideContent } from "./LessonGuideContent";
import { Ipv4Presentation } from "./Ipv4Presentation";
import { V4_DEEP_DIVE_SECTIONS, Ipv4DeepDiveContent } from "./DeepDiveContent";

const GUIDE_TABS: LessonGuideTab[] = [
  { id: "lesson", label: "This Lesson", hint: "HOST-A /26 → R1 → HOST-B /26 · AND test, gateway, TTL, wrong mask", sections: V4_LESSON_SECTIONS, content: <Ipv4LessonGuideContent /> },
  { id: "deep", label: "IPv4 Addressing & Subnetting Deep Dive", hint: "The full lesson on this network · prefixes, local vs remote, next hop vs destination, R1, troubleshooting", sections: V4_DEEP_DIVE_SECTIONS, content: <Ipv4DeepDiveContent /> },
];

const CHAMBER_STEPS = ["subnet-chamber", "predict-block", "four-subnets", "host-a-subnet", "host-b-subnet"];

/**
 * HOST-A's addressing at a glance. While the incident is unresolved the changed setting is not shown here: the learner
 * finds it by inspecting HOST-A (its decision and configuration), so this always-visible panel never spoils the diagnosis.
 */
function HostAPanel({ s }: { s: Ipv4State }) {
  const p = s.hostAPrefix;
  const conceal = s.faultActive && !s.repaired;
  const d = s.decision;
  const hidden = "inspect HOST-A to see";
  const rows = [
    { k: "HOST-A", v: conceal ? V4_IP["HOST-A"] : `${V4_IP["HOST-A"]}/${p}` },
    { k: "Mask", v: conceal ? hidden : maskOf(p) },
    { k: "Derived subnet", v: conceal ? hidden : `${networkOf(V4_IP["HOST-A"], p)}/${p}` },
    { k: "Gateway", v: V4_IP.R1L },
    { k: "Last decision", v: d ? `${d.host} → ${d.onLink ? "on-link" : "remote"} · L2 next hop ${d.l2NextHop}` : "none yet" },
  ];
  return (
    <GlassPanel className="p-4">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">Host addressing</p>
      <div className="space-y-1 text-[11px]">
        {rows.map((r) => (
          <div key={r.k} className="flex flex-wrap justify-between gap-x-3">
            <span className="text-pv-text-faint">{r.k}</span>
            <span className={`pv-mono ${r.v === hidden ? "text-pv-text-faint" : "text-pv-text"}`}>{r.v}</span>
          </div>
        ))}
      </div>
    </GlassPanel>
  );
}

const config: FundamentalsLessonConfig<Ipv4State> = {
  lessonId: "ipv4-basics",
  xp: 150,
  steps: ipv4BasicsSteps,
  createState: createIpv4State,
  badge: "Fundamentals · Layer 3",
  title: "IPv4 Addressing & Subnetting",
  intro: `Two /26 subnets joined by one router. Work out networks and broadcasts, watch HOST-A decide between on-link and gateway, follow the packet through R1 (TTL and checksum), then fix a wrong-mask incident.`,
  facts: [
    { q: "What decides 'local'?", a: "My IP AND my mask vs destination AND my mask." },
    { q: "Who is the L2 next hop?", a: "For remote destinations, the default gateway — the IPv4 destination doesn't change." },
    { q: "What does a router change?", a: "TTL −1, the header checksum, and the whole Ethernet header." },
    { q: "What does /26 mean?", a: `${maskOf(V4_PREFIX)} · blocks of 64 · 62 ordinary hosts.` },
  ],
  terms: [
    { term: "CIDR", expansion: "Classless Inter-Domain Routing", meaning: "Prefix-length addressing" },
    { term: "/26", expansion: "Prefix length", meaning: "26 network bits" },
    { term: "TTL", expansion: "Time To Live", meaning: "Hop limit, −1 per router" },
    { term: "GW", expansion: "Default gateway", meaning: "Router for off-link traffic" },
    { term: "ARP", expansion: "Address Resolution Protocol", meaning: "IPv4 → MAC (own lesson)" },
  ],
  guide: { title: "IPv4 Addressing & Subnetting", subtitle: `${V4_IP["HOST-A"]}/${V4_PREFIX} · ${V4_IP["HOST-B"]}/${V4_PREFIX} · R1 ${V4_IP.R1L} / ${V4_IP.R1R}`, tabs: GUIDE_TABS },
  briefing: { phases: V4_BRIEFING_PHASES, notes: V4_BRIEFING_NOTES },
  nodes: () => V4_NODES,
  edges: () => V4_EDGES,
  regions: V4_REGIONS,
  enterable: ["R1", "SW-A", "SW-B"],
  primaryDevice: { "and-math": "HOST-A", "b-receives": "HOST-B", "b-decides": "HOST-B", "fault-decision": "HOST-A", "fault-r1-silent": "R1", "fault-unresolved": "HOST-A", "repair-challenge": "HOST-A", "verify-decision": "HOST-A" },
  traceFor: (d, s, stepId) => v4TraceFor(d as Ipv4Device, s, stepId),
  interfacesFor: (d, s, stepId) => v4InterfacesFor(d as Ipv4Device, s, stepId),
  pipelineTitle: (d) => (d === "R1" ? "R1 · IPv4 forwarding pipeline" : `${d} · Bridge pipeline`),
  explainNode: explainV4,
  tablesFor: (d, s) => v4Tables(d as Ipv4Device, s),
  callout: (p, s) => fundamentalsCallout(p, v4Names, { decision: s.note && (s.note.device === p.from || s.note.device === p.to) ? s.note.text : undefined }),
  // No badge names the changed setting: the incident is diagnosed from evidence (HOST-A's decision and configuration).
  nodeBadges: (id, s) => (id === "HOST-A" && s.hostAUnresolved ? ["UNREACHABLE"] : undefined),
  repair: {
    stepId: "repair-challenge",
    prompt: "HOST-A cannot reach HOST-B. Which change fixes the cause?",
    options: IPV4_REPAIR_OPTIONS.map((o) => ({ id: o.id, label: o.label })),
    correctId: IPV4_REPAIR_CORRECT,
    success: `HOST-A is back to /${V4_PREFIX}. It will treat ${V4_IP["HOST-B"]} as remote and send via ${V4_IP.R1L}.`,
    wrongFeedback: {
      "proxy-arp": "Proxy ARP would make R1 answer for HOST-B and hide the mistake. HOST-A would still have the wrong idea of its own subnet, which causes other problems (for example the wrong broadcast address). Fix the host.",
      "static-route": `R1 already has ${V4_IP["HOST-B"]}'s /${V4_PREFIX} as a connected route. The packet never reaches R1, because HOST-A doesn't send it to R1.`,
      "readdress-b": "Moving HOST-B into HOST-A's /26 hides the symptom for this one host and breaks HOST-B's own subnet. The fault is HOST-A's mask.",
    },
    attempt: (s) => s.repairAttempt,
  },
  diagnostics: {
    fromStepId: "diagnostic-layers",
    layers: (s) => [
      { label: "L1/L2 — links and both switches forwarding", status: "healthy" },
      { label: `R1 — connected routes ${networkOf(V4_IP.R1L, V4_PREFIX)}/${V4_PREFIX} and ${networkOf(V4_IP.R1R, V4_PREFIX)}/${V4_PREFIX}`, status: "healthy" },
      { label: `HOST-B — ${V4_IP["HOST-B"]}/${V4_PREFIX}, gateway ${V4_IP.R1R}`, status: "healthy" },
      { label: `HOST-A — ${V4_IP["HOST-A"]}/${s.hostAPrefix} (${maskOf(s.hostAPrefix)})`, status: s.hostAPrefix === V4_PREFIX ? "healthy" : "failing" },
    ],
  },
  panels: (_s, stepId) => (stepId && CHAMBER_STEPS.includes(stepId) ? <SubnetChamber /> : null),
  sidePanel: (s) => <HostAPanel s={s} />,
  practiceLab: {
    entry: { title: "IPv4 Lab", buttonLabel: "Practice IPv4", description: "Five short levels (address and prefix, local or remote, through R1, TTL and checksum, wrong settings), then every host and R1 in its own window — Linux, Windows, Cisco and Junos terminals, captures, settings you change and verify — and tickets to solve from evidence." },
    contextNote: (stepId) => (stepId && ["predict-local", "and-math", "predict-l2-next-hop", "a-sends", "r1-forwards", "header-recap", "verify-delivered"].includes(stepId) ? "Want to experiment instead of only watching?" : undefined),
    render: ({ open, onClose }) => <Ipv4LabWorkspace open={open} onClose={onClose} />,
  },
  presentation: { topic: "IPv4", render: (p) => <Ipv4Presentation {...p} /> },
  complete: { badge: "Lesson Complete", title: "You can subnet and follow a routed packet", message: "CIDR arithmetic, the AND test, gateway vs destination, TTL and checksum at the router — and a wrong mask found and fixed." },
};

export default function Ipv4BasicsDemo() {
  return <FundamentalsLessonShell config={config} />;
}
