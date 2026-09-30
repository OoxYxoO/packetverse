import type { BriefingPhaseDef, BriefingStepNote } from "@/components/lesson/briefing";

/** Mission Briefing — the track's workflow; every step in exactly one phase; the cause is never named before its question. */
export const PA_BRIEFING_PHASES: BriefingPhaseDef[] = [
  { phase: { label: "Define", tone: "cyan" }, objective: "Pin down the service under test.", steps: ["intro"] },
  { phase: { label: "Scope", tone: "violet" }, objective: "Choose where to look, and know what each point can show.", steps: ["capture-points", "predict-capture"] },
  { phase: { label: "Baseline", tone: "tcp" }, objective: "Learn what a healthy conversation looks like.", steps: ["base-arp-req", "base-arp-rep", "base-syn", "q-syn", "base-syn-srv", "base-synack", "q-synack", "base-synack-cl", "base-ack", "base-req", "base-resp", "q-seqack", "base-ack2", "base-fin", "base-fin-srv", "base-last-ack", "q-flow"] },
  { phase: { label: "Symptom", tone: "warning" }, objective: "A user reports slow connections. Capture before concluding.", steps: ["incident-intro"] },
  { phase: { label: "Gather Evidence", tone: "danger" }, objective: "Record the slow connection at all three capture points.", steps: ["inc-syn", "inc-syn-srv", "inc-synack", "inc-wait", "inc-syn-retx", "q-retx", "inc-syn-retx-srv", "q-server-got", "inc-synack2", "inc-synack2-cl", "inc-ack"] },
  { phase: { label: "Form Hypothesis", tone: "violet" }, objective: "Correlate the captures. Diagnosis pending.", steps: ["compare-captures", "q-which-capture", "q-missing", "q-closed"] },
  { phase: { label: "Test", tone: "ip" }, objective: "Test the hypothesis against an independent source.", steps: ["r1-counters", "diagnostic-layers", "predict-cause"] },
  { phase: { label: "Repair pending", tone: "warning" }, objective: "Choose the change that fixes the cause you identified.", steps: ["repair-challenge"] },
  { phase: { label: "Verify", tone: "success" }, objective: "Prove the symptom is gone with the same instruments.", steps: ["ver-syn", "ver-synack", "ver-synack-cl", "ver-ack", "ver-compare"] },
  { phase: { label: "Complete", tone: "success" }, objective: "Map the method onto real tools.", steps: ["operations", "complete"] },
];

export const PA_BRIEFING_NOTES: Partial<Record<string, BriefingStepNote>> = {
  "capture-points": { takeaway: "A capture shows only what passed that point." },
  "base-syn-srv": { takeaway: "Routing changes TTL and MACs — never ports or sequence numbers." },
  "base-synack": { takeaway: "SYN-ACK = the port is listening; Ack = client ISN + 1." },
  "q-flow": { takeaway: "One flow = one five-tuple, in both directions." },
  "incident-intro": { doingNow: "Capture first; a symptom is not a diagnosis." },
  "inc-syn-retx": { takeaway: "Same seq + same tuple + one timeout later = retransmission." },
  "inc-synack2-cl": { takeaway: "'Retransmission' is judged per capture point." },
  "compare-captures": { doingNow: "Diagnosis pending." },
  "q-closed": { takeaway: "Refusal is fast (RST); loss is silent (timer)." },
  "repair-challenge": { doingNow: "Choose the change that fixes the cause you identified." },
  "ver-compare": { takeaway: "Proof = same test, symptom gone; counters by delta." },
};
