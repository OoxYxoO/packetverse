"use client";

import { FundamentalsLessonShell, type FundamentalsLessonConfig } from "@/components/lesson/FundamentalsLessonShell";
import { fundamentalsCallout } from "@/components/lesson/fundamentalsCallout";
import type { LessonGuideTab } from "@/components/lesson/LessonGuideDialog";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { ETH_MAC, ETH_REPAIR_CORRECT, ETH_REPAIR_OPTIONS, FDB_AGING_SEC, createEthState, ethernetSwitchingSteps, lookup, macName, type EthDevice, type EthState, type EthSwitch } from "@/lib/sim-engine/scenarios/ethernetSwitching";
import { ETH_BRIEFING_NOTES, ETH_BRIEFING_PHASES } from "./briefing";
import { ethInterfacesFor, ethTraceFor } from "./deviceTrace";
import { ethTables, explainEth } from "./explain";
import { ethNames } from "./addressNames";
import { ETH_REGIONS, ethEdges, ethNodes, hostBAtSw1 } from "./topology";
import { ETH_LESSON_SECTIONS, EthernetLessonGuideContent } from "./LessonGuideContent";
import { ETH_DEEP_DIVE_SECTIONS, EthernetDeepDiveContent } from "./DeepDiveContent";
import { EthernetLabWorkspace } from "./ethernet-lab/EthernetLabWorkspace";

const GUIDE_TABS: LessonGuideTab[] = [
  { id: "lesson", label: "This Lesson", hint: "SW1 · HOST-A/B/C · learning, flooding, aging, a MAC move and a stale entry", sections: ETH_LESSON_SECTIONS, content: <EthernetLessonGuideContent /> },
  { id: "deep", label: "Ethernet & Switching Deep Dive", hint: "The full lesson on this LAN · frames, the FDB, aging, moves, CLI and troubleshooting", sections: ETH_DEEP_DIVE_SECTIONS, content: <EthernetDeepDiveContent /> },
];

function FdbPanel({ s }: { s: EthState }) {
  const table = (sw: EthSwitch) => (
    <div key={sw}>
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">{sw} FDB</p>
      {s.fdb[sw].length === 0 ? (
        <p className="pv-mono text-[11px] text-pv-text-faint">empty</p>
      ) : (
        <div className="space-y-0.5 pv-mono text-[11px]">
          {s.fdb[sw].map((e) => (
            <div key={e.mac} className="flex flex-wrap justify-between gap-x-3">
              <span className="text-pv-text">{e.mac}</span>
              <span className="text-pv-text-muted">
                {e.port} · {macName(e.mac)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
  return (
    <GlassPanel className="space-y-3 p-4">
      {table("SW1")}
      {table("DESK-SW")}
      <p className="text-[10px] text-pv-text-faint">Dynamic entries · learned from source MACs · aging time {FDB_AGING_SEC} s</p>
    </GlassPanel>
  );
}

const config: FundamentalsLessonConfig<EthState> = {
  lessonId: "ethernet-switching",
  xp: 150,
  steps: ethernetSwitchingSteps,
  createState: createEthState,
  badge: "Fundamentals · Layer 2",
  title: "Ethernet & Switching",
  intro: "One switch, three hosts and a hot-desk switch. Watch SW1 learn source MACs, flood unknown unicast and broadcast, forward known unicast, age entries out, follow a host that moved — then fix a stale-entry incident.",
  facts: [
    { q: "What does a switch learn?", a: "The SOURCE MAC of each frame, against the port it arrived on." },
    { q: "When does it flood?", a: "Unknown unicast (lookup miss) and broadcast — never back out the ingress port." },
    { q: "Does it change the frame?", a: "No. Destination, source, EtherType and payload leave exactly as they arrived." },
    { q: "How long do entries live?", a: `Until they age out (${FDB_AGING_SEC} s default) or the source appears on another port.` },
  ],
  terms: [
    { term: "MAC", expansion: "Media Access Control address", meaning: "48-bit NIC address" },
    { term: "FDB", expansion: "Forwarding database", meaning: "MAC → port table" },
    { term: "FCS", expansion: "Frame Check Sequence", meaning: "CRC-32 error check" },
    { term: "BUM", expansion: "Broadcast, unknown unicast, multicast", meaning: "Flooded traffic" },
    { term: "EtherType", expansion: "Payload type field", meaning: "0x0800 IPv4, 0x0806 ARP" },
  ],
  guide: { title: "Ethernet & Switching", subtitle: "SW1 · 00:11:22:33:44:0A / 0B / 0C · ge-0/0/1–4", tabs: GUIDE_TABS },
  briefing: { phases: ETH_BRIEFING_PHASES, notes: ETH_BRIEFING_NOTES },
  nodes: ethNodes,
  edges: ethEdges,
  regions: ETH_REGIONS,
  enterable: ["SW1", "DESK-SW"],
  primaryDevice: { "b-accepts": "HOST-B", "c-discards": "HOST-C", "fdb-aging": "SW1", "move-intro": "SW1", "fault-injected": "SW1", "stale-lost": "DESK-SW", "repair-challenge": "SW1" },
  traceFor: (d, s, stepId) => ethTraceFor(d as EthDevice, s, stepId),
  interfacesFor: (d, s, stepId) => ethInterfacesFor(d as EthDevice, s, stepId),
  pipelineTitle: (d) => `${d} · Bridge pipeline`,
  explainNode: explainEth,
  tablesFor: (d, s) => ethTables(d as EthDevice, s),
  callout: (p, s) => fundamentalsCallout(p, ethNames, { decision: s.decision && (s.decision.device === p.from || s.decision.device === p.to) ? s.decision.text : undefined }),
  floodCopies: (s) => s.flood,
  nodeBadges: (id, s) => (id === "SW1" ? [`FDB ${s.fdb.SW1.length}`] : id === "HOST-B" && s.faultActive ? ["STALE ENTRY?"] : undefined),
  repair: {
    stepId: "repair-challenge",
    prompt: "HOST-A → HOST-B frames are forwarded to the wrong place. Which change fixes it?",
    options: ETH_REPAIR_OPTIONS.map((o) => ({ id: o.id, label: o.label })),
    correctId: ETH_REPAIR_CORRECT,
    success: "Stale entry cleared. The next frame to HOST-B is unknown unicast again, so SW1 floods it and relearns HOST-B from its reply.",
    wrongFeedback: {
      arp: "ARP maps IP → MAC, and HOST-A already uses HOST-B's correct MAC. The problem is WHERE SW1 thinks that MAC lives.",
      "static-ge4": "A static entry would pin HOST-B to ge-0/0/4 permanently — the wrong port, and it would never relearn.",
      "replace-cable": "ge-0/0/4 is UP and working. That link staying up is why the old entry was never flushed.",
    },
    attempt: (s) => s.repairAttempt,
  },
  diagnostics: {
    fromStepId: "diagnostic-layers",
    layers: (s) => {
      const entry = lookup(s.fdb.SW1, ETH_MAC["HOST-B"]);
      const actual = hostBAtSw1(s) ? "ge-0/0/2" : "ge-0/0/4";
      const stale = !!entry && entry.port !== actual;
      return [
        { label: "L1 — every link is up (ge-0/0/1–4, DESK-SW)", status: "healthy" },
        { label: "Frame addressing — dst 00:11:22:33:44:0B is HOST-B's MAC", status: "healthy" },
        { label: `SW1 FDB — HOST-B → ${entry?.port ?? "no entry (will flood)"}`, status: stale ? "failing" : "healthy" },
        { label: "HOST-B NIC — accepts its own MAC", status: "healthy" },
      ];
    },
  },
  sidePanel: (s) => <FdbPanel s={s} />,
  practiceLab: {
    entry: { title: "Ethernet Lab", buttonLabel: "Practice switching", description: "Send frames yourself on this same LAN and watch SW1 learn, flood, forward, age and go stale." },
    contextNote: (stepId) => (stepId && ["a-sends", "predict-learn", "sw1-learns-a", "sw1-lookup-miss", "predict-flood", "flood-unknown", "fdb-aging", "move-intro", "stale-lost"].includes(stepId) ? "Want to experiment instead of only watching?" : undefined),
    render: ({ open, onClose }) => <EthernetLabWorkspace open={open} onClose={onClose} />,
  },
  complete: { badge: "Lesson Complete", title: "You can read a switch's mind", message: "Source learning, flooding, known unicast, broadcast, aging, MAC moves and a stale-entry repair — all from one FDB." },
};

export default function EthernetSwitchingDemo() {
  return <FundamentalsLessonShell config={config} />;
}
