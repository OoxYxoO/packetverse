import type { BriefingPhaseDef, BriefingStepNote } from "@/components/lesson/briefing";

/** Mission Briefing for Ethernet & Switching — every step is in exactly one phase; question/incident objectives never state the answer. */
export const ETH_BRIEFING_PHASES: BriefingPhaseDef[] = [
  { phase: { label: "Observe — The LAN", tone: "cyan" }, objective: "Meet the frame, the addresses and the switch ports this lesson uses.", steps: ["intro", "frame-anatomy", "mac-addresses"] },
  { phase: { label: "Predict — Empty table", tone: "warning" }, objective: "Decide what a freshly booted switch knows.", steps: ["predict-empty-fdb"] },
  { phase: { label: "Observe — First frame", tone: "cyan" }, objective: "Follow one unicast frame into a switch that has never seen its destination.", steps: ["a-sends", "predict-learn", "sw1-learns-a", "sw1-lookup-miss", "predict-flood", "flood-unknown", "b-accepts", "c-discards"] },
  { phase: { label: "Observe — The reply", tone: "violet" }, objective: "Watch what one reply changes about the next frames.", steps: ["b-replies", "sw1-learns-b", "known-unicast-reply", "predict-resend", "resend-a", "resend-forward"] },
  { phase: { label: "Inspect — Broadcast", tone: "ip" }, objective: "Compare a broadcast frame with the unknown unicast you saw earlier.", steps: ["broadcast-intro", "c-broadcast", "broadcast-flood", "predict-broadcast-vs-unknown"] },
  { phase: { label: "Inspect — Aging & moves", tone: "violet" }, objective: "See how dynamic entries expire and how a switch finds a host that moved.", steps: ["fdb-aging", "move-intro", "predict-after-move", "b-sends-from-desk", "desk-forwards", "sw1-relearns-b"] },
  { phase: { label: "Incident", tone: "danger" }, objective: "HOST-A can no longer reach HOST-B. Diagnosis pending — gather the evidence.", steps: ["break-intro", "fault-injected", "stale-send", "stale-forward", "stale-lost", "trouble-question", "diagnostic-layers"] },
  { phase: { label: "Repair pending", tone: "warning" }, objective: "Apply the fix for the cause you identified.", steps: ["repair-challenge"] },
  { phase: { label: "Verify", tone: "success" }, objective: "Prove the path with real frames: flood, reply, relearn, known unicast.", steps: ["verify-send", "verify-flood", "verify-reply", "verify-known"] },
  { phase: { label: "Complete", tone: "success" }, objective: "Place the switch next to the router and review the mental model.", steps: ["switch-vs-router", "complete"] },
];

export const ETH_BRIEFING_NOTES: Partial<Record<string, BriefingStepNote>> = {
  "frame-anatomy": { takeaway: "Destination, source, EtherType, payload, FCS." },
  "a-sends": { doingNow: "HOST-A transmits a unicast frame for HOST-B's MAC." },
  "sw1-learns-a": { doingNow: "Source learning on ingress port ge-0/0/1.", takeaway: "Learning uses the SOURCE MAC only." },
  "sw1-lookup-miss": { doingNow: "Destination lookup in the FDB." },
  "flood-unknown": { takeaway: "Flooded copies keep the unicast destination MAC." },
  "c-discards": { takeaway: "Hosts filter on destination MAC." },
  "known-unicast-reply": { takeaway: "Known unicast uses one port." },
  "broadcast-flood": { takeaway: "Broadcast floods because it is addressed to all." },
  "fdb-aging": { doingNow: "Time passes; aging timers run." },
  "move-intro": { doingNow: "A host changes ports." },
  "sw1-relearns-b": { takeaway: "A move is learned from the host's own source frame." },
  "fault-injected": { doingNow: "A physical change happens on the LAN." },
  "trouble-question": { doingNow: "Diagnosis pending." },
  "repair-challenge": { doingNow: "Choose the change that fixes the cause you identified." },
  "verify-known": { takeaway: "Normal known-unicast forwarding restored." },
};
