import type { BriefingPhaseDef, BriefingStepNote } from "@/components/lesson/briefing";

/** Mission Briefing — every step in exactly one phase; never names the root, a port role or the repair before its question. */
export const STP_BRIEFING_PHASES: BriefingPhaseDef[] = [
  { phase: { label: "Observe — The triangle", tone: "cyan" }, objective: "Meet three bridges joined in a physical loop.", steps: ["intro", "topology", "self-root", "bpdu-anatomy"] },
  { phase: { label: "Elect the root", tone: "violet" }, objective: "Compare Bridge IDs to find the root bridge.", steps: ["predict-root", "predict-root-rp"] },
  { phase: { label: "Choose Root Ports", tone: "ip" }, objective: "Find each non-root bridge's best path to the root.", steps: ["sw2-learns-root", "predict-sw3-rp", "sw3-learns-root", "root-ports"] },
  { phase: { label: "Designated / Alternate", tone: "warning" }, objective: "Settle the one segment both non-root bridges share.", steps: ["predict-designated", "cross-bpdus", "sync-forwarding", "predict-alt-down"] },
  { phase: { label: "Verify the tree", tone: "success" }, objective: "Watch customer frames use only Forwarding ports.", steps: ["final-tree", "c-bcast-send", "c-bcast-sw3", "c-bcast-sw1", "c-bcast-sw2", "predict-alt-data", "c-bcast-sw3-discard", "b-to-c-send", "b-to-c-sw2", "b-to-c-sw1", "b-to-c-sw3"] },
  { phase: { label: "Fail a root link", tone: "danger" }, objective: "A link carrying a Root Port is about to fail.", steps: ["predict-after-fail", "fail-link"] },
  { phase: { label: "Reconverge", tone: "cyan" }, objective: "See the backup path take over, then the original return.", steps: ["sw3-reconverge", "b-to-c-after-send", "b-to-c-after-sw3", "restore-link"] },
  { phase: { label: "Incident", tone: "danger" }, objective: "Duplicate traffic after a change window. Investigate.", steps: ["incident-intro", "incident-bpdu", "loop-send", "wave-1", "wave-2", "wave-3"] },
  { phase: { label: "Diagnose", tone: "danger" }, objective: "Diagnosis pending.", steps: ["trouble-question", "diagnostic-layers"] },
  { phase: { label: "Repair pending", tone: "warning" }, objective: "Choose the change that fixes the cause you identified.", steps: ["repair-challenge"] },
  { phase: { label: "Verify", tone: "success" }, objective: "Prove the tree is loop-free again.", steps: ["verify-bpdu", "verify-send", "verify-sw1", "verify-tree"] },
  { phase: { label: "Complete", tone: "success" }, objective: "Place RSTP next to link aggregation.", steps: ["stp-vs-lacp", "complete"] },
];

export const STP_BRIEFING_NOTES: Partial<Record<string, BriefingStepNote>> = {
  "self-root": { doingNow: "Every bridge starts by claiming root." },
  "bpdu-anatomy": { takeaway: "BPDUs are link-local bridge control frames — no IP." },
  "sw2-learns-root": { takeaway: "A better vector wins; the port it arrived on leads toward the root." },
  "root-ports": { takeaway: "One Root Port per non-root bridge; none on the root." },
  "sync-forwarding": { doingNow: "Root and Designated ports forward after synchronization." },
  "final-tree": { takeaway: "Three cables, one loop-free forwarding tree." },
  "c-bcast-sw3-discard": { takeaway: "A Discarding port drops customer data but keeps hearing BPDUs." },
  "b-to-c-sw3": { takeaway: "Control plane and data plane are different paths." },
  "sw3-reconverge": { takeaway: "An Alternate port is a pre-computed backup Root Port." },
  "incident-intro": { doingNow: "A port configuration change on SW3." },
  "trouble-question": { doingNow: "Diagnosis pending." },
  "repair-challenge": { doingNow: "Choose the change that fixes the cause you identified." },
  "verify-tree": { takeaway: "One copy per host, nothing circulating." },
};
