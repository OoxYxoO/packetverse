import type { BriefingPhaseDef, BriefingStepNote } from "@/components/lesson/briefing";

/** Mission Briefing — every step in exactly one phase; never names the first flood, the loop cause or the repair early. */
export const SWF_BRIEFING_PHASES: BriefingPhaseDef[] = [
  { phase: { label: "Observe — Two bridges", tone: "cyan" }, objective: "Meet the topology and ask what each switch knows.", steps: ["intro", "topology", "predict-fdbs"] },
  { phase: { label: "Trace — First frame", tone: "ip" }, objective: "Follow HOST-A's first frame across both switches.", steps: ["a-sends", "sw1-learn-lookup", "sw1-flood", "d-discards", "predict-sw2", "sw2-learn", "sw2-flood", "predict-c", "b-accepts", "c-discards"] },
  { phase: { label: "Trace — The reply", tone: "success" }, objective: "See what each switch learns from HOST-B's reply.", steps: ["b-replies", "sw2-reply", "sw1-reply", "fdb-compare"] },
  { phase: { label: "Predict — Second frame", tone: "violet" }, objective: "Predict how the next HOST-A → HOST-B frame crosses both switches.", steps: ["predict-resend", "resend-a", "resend-sw1", "resend-sw2"] },
  { phase: { label: "Inspect — Local switching", tone: "cyan" }, objective: "Watch traffic between two hosts on the same switch.", steps: ["d-sends", "sw1-local", "a-to-d"] },
  { phase: { label: "Inspect — Two switches, one destination", tone: "violet" }, objective: "Compare what each switch does with the same frame.", steps: ["predict-partial", "c-sends", "sw2-partial", "sw1-partial"] },
  { phase: { label: "Trace — Broadcast", tone: "warning" }, objective: "Follow a broadcast through the whole Layer-2 domain.", steps: ["bcast-send", "bcast-sw1", "bcast-sw2", "predict-bcast-vs-unknown"] },
  { phase: { label: "Incident", tone: "danger" }, objective: "Users report duplicate traffic after a cabling change. Diagnosis pending.", steps: ["incident-intro", "predict-loop", "loop-send", "wave-1", "wave-2", "predict-ttl", "wave-3", "wave-stop", "predict-flap", "symptom-send", "symptom-sw1", "trouble-question", "diagnostic-layers"] },
  { phase: { label: "Repair pending", tone: "warning" }, objective: "Choose the change that fixes the cause you identified.", steps: ["repair-challenge"] },
  { phase: { label: "Verify", tone: "success" }, objective: "Prove floods are delivered once and entries stay put.", steps: ["verify-drain", "verify-send", "verify-sw2", "verify-unicast-sw2", "verify-unicast-sw1"] },
  { phase: { label: "Complete", tone: "success" }, objective: "Review how independent bridges behave together.", steps: ["loop-prevention", "complete"] },
];

export const SWF_BRIEFING_NOTES: Partial<Record<string, BriefingStepNote>> = {
  "sw1-learn-lookup": { doingNow: "SW1 consults only its own FDB." },
  "predict-sw2": { doingNow: "The copy has reached SW2." },
  "sw2-learn": { takeaway: "Learning is hop by hop — per switch." },
  "fdb-compare": { takeaway: "Same MACs, different ports: each switch sees from its own position." },
  "resend-sw2": { takeaway: "Two bridges, two independent lookups." },
  "sw1-local": { takeaway: "Local traffic never crosses the inter-switch link." },
  "sw1-partial": { takeaway: "Unknown at one bridge, known at the next." },
  "bcast-sw2": { takeaway: "A broadcast reaches every host in the Layer-2 domain." },
  "incident-intro": { doingNow: "A cabling change between SW1 and SW2." },
  "wave-stop": { takeaway: "The wave limit is a teaching choice, not a protocol field." },
  "trouble-question": { doingNow: "Diagnosis pending." },
  "repair-challenge": { doingNow: "Choose the change that fixes the cause you identified." },
  "verify-sw2": { takeaway: "One copy per host." },
  "verify-unicast-sw1": { takeaway: "Entries are stable again." },
};
