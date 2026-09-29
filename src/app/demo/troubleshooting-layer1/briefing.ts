import type { BriefingPhaseDef, BriefingStepNote } from "@/components/lesson/briefing";

/** Mission Briefing — the track's workflow; every step in exactly one phase; the cause is never named before its question. */
export const L1_BRIEFING_PHASES: BriefingPhaseDef[] = [
  { phase: { label: "Define", tone: "cyan" }, objective: "Meet the path and its one fiber uplink.", steps: ["intro"] },
  { phase: { label: "Scope", tone: "violet" }, objective: "Know what interface state can and cannot tell you.", steps: ["interface-anatomy", "q-admin-oper"] },
  { phase: { label: "Baseline", tone: "success" }, objective: "Record healthy optics, counters and loss.", steps: ["base-optics", "q-rx-side", "base-snap-1", "base-snap-2", "q-lifetime", "base-ping-req", "base-ping-reply", "base-ping-summary"] },
  { phase: { label: "Symptom", tone: "warning" }, objective: "Users report slow, stalling transfers.", steps: ["incident-intro"] },
  { phase: { label: "Gather Evidence", tone: "danger" }, objective: "Measure loss, interface state, counter deltas and light levels.", steps: ["inc-ping-ok", "inc-ping-bad", "inc-ping-summary", "q-scope", "inc-iface-state", "q-up-fault", "inc-snap-1", "inc-snap-2", "q-crc", "q-delta", "inc-optics", "q-rx-peer"] },
  { phase: { label: "Form Hypothesis", tone: "violet" }, objective: "Rule suspects in or out with evidence. Diagnosis pending.", steps: ["hypotheses", "diagnostic-layers"] },
  { phase: { label: "Test", tone: "ip" }, objective: "Name the cause the evidence supports.", steps: ["predict-cause", "q-clear-counters"] },
  { phase: { label: "Repair pending", tone: "warning" }, objective: "Choose the change that fixes the cause you identified.", steps: ["repair-challenge"] },
  { phase: { label: "Verify", tone: "success" }, objective: "Prove it with fresh deltas and the original test.", steps: ["ver-optics", "ver-snap-1", "ver-snap-2", "ver-ping-reply", "ver-ping-summary"] },
  { phase: { label: "Complete", tone: "success" }, objective: "Map the method onto real switches.", steps: ["operations", "complete"] },
];

export const L1_BRIEFING_NOTES: Partial<Record<string, BriefingStepNote>> = {
  "interface-anatomy": { takeaway: "Admin = configured intent; oper = achieved link." },
  "q-rx-side": { takeaway: "Rx at one end describes the fiber from the peer's Tx." },
  "base-snap-2": { takeaway: "One reading is history; two readings are a rate." },
  "incident-intro": { doingNow: "Start again from facts." },
  "inc-ping-bad": { takeaway: "A bad FCS is discarded at ingress — nothing above ever sees it." },
  "q-up-fault": { takeaway: "UP means link, not clean bits." },
  "hypotheses": { doingNow: "Diagnosis pending." },
  "repair-challenge": { doingNow: "Choose the change that fixes the cause you identified." },
  "ver-snap-2": { takeaway: "Repairs do not erase counters — deltas prove the fix." },
};
