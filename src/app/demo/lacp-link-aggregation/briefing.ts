import type { BriefingPhaseDef, BriefingStepNote } from "@/components/lesson/briefing";

/** Mission Briefing — every step in exactly one phase; never names the key fault or its repair before the diagnosis. */
export const LACP_BRIEFING_PHASES: BriefingPhaseDef[] = [
  { phase: { label: "Observe — Two links", tone: "cyan" }, objective: "Meet two parallel cables between the same two switches.", steps: ["intro", "topology", "predict-lacp-dst"] },
  { phase: { label: "Exchange LACP", tone: "violet" }, objective: "Follow the first LACPDUs on one member.", steps: ["m23-sw1-pdu", "m23-sw2-pdu", "predict-keys"] },
  { phase: { label: "Select members", tone: "ip" }, objective: "Watch a member become Collecting and Distributing.", steps: ["m23-sw1-pdu2", "predict-dist", "m23-sw2-pdu2", "m24-negotiate"] },
  { phase: { label: "Aggregate", tone: "success" }, objective: "See two members become one logical link.", steps: ["lag-formed", "predict-active-passive"] },
  { phase: { label: "Distribute flows", tone: "cyan" }, objective: "Follow two flows across the bundle.", steps: ["flow1-send", "flow1-hash", "flow1-sw2", "flow2", "flow2-sw2", "predict-single-flow"] },
  { phase: { label: "Fail a member", tone: "danger" }, objective: "One member cable is about to fail.", steps: ["predict-fail", "fail-23", "flow1-moved"] },
  { phase: { label: "Recover", tone: "warning" }, objective: "Bring the member back — carefully.", steps: ["restore-23-up", "restore-23-sync", "restore-23-dist", "flows-rebalanced"] },
  { phase: { label: "Incident", tone: "danger" }, objective: "LAG1 runs on one member after a clean-up. Investigate.", steps: ["incident-intro", "incident-sw2", "incident-sw1", "incident-traffic"] },
  { phase: { label: "Diagnose", tone: "danger" }, objective: "Diagnosis pending.", steps: ["trouble-question", "diagnostic-layers"] },
  { phase: { label: "Repair pending", tone: "warning" }, objective: "Choose the change that fixes the cause you identified.", steps: ["repair-challenge"] },
  { phase: { label: "Verify", tone: "success" }, objective: "Prove the member renegotiates and carries traffic again.", steps: ["verify-sync", "verify-dist", "verify-flows"] },
  { phase: { label: "Complete", tone: "success" }, objective: "Place LACP next to spanning tree.", steps: ["lacp-vs-stp", "complete"] },
];

export const LACP_BRIEFING_NOTES: Partial<Record<string, BriefingStepNote>> = {
  "m23-sw1-pdu": { takeaway: "Partner information = what the peer says about itself." },
  "m23-sw2-pdu2": { takeaway: "Synchronization → Collecting → Distributing." },
  "lag-formed": { takeaway: "Above LACP, the bundle is one logical port." },
  "flow1-hash": { doingNow: "PacketVerse modeled hash — not a standard." },
  "flow2-sw2": { takeaway: "Different flows can use different members at once." },
  "fail-23": { takeaway: "One usable member keeps the LAG up." },
  "restore-23-up": { doingNow: "Link up is not enough — LACP must renegotiate." },
  "restore-23-dist": { takeaway: "Eligible only after Collecting + Distributing." },
  "incident-intro": { doingNow: "A configuration clean-up on SW2." },
  "trouble-question": { doingNow: "Diagnosis pending." },
  "repair-challenge": { doingNow: "Choose the change that fixes the cause you identified." },
  "verify-dist": { takeaway: "Restored only when Distributing again." },
};
