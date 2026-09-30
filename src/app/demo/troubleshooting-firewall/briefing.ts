import type { BriefingPhaseDef, BriefingStepNote } from "@/components/lesson/briefing";

/** Mission Briefing — the track's workflow; every step in exactly one phase; the cause is never named before its question. */
export const FW_BRIEFING_PHASES: BriefingPhaseDef[] = [
  { phase: { label: "Define", tone: "cyan" }, objective: "Meet the two firewalls and the service.", steps: ["intro"] },
  { phase: { label: "Scope", tone: "violet" }, objective: "Know the routes and the one-way policy.", steps: ["design"] },
  { phase: { label: "Baseline", tone: "success" }, objective: "Watch a session form and admit its own reply.", steps: ["base-syn", "base-r1", "base-fw1", "base-server", "base-synack", "base-r2", "base-fw1-return", "q-reverse", "base-ack"] },
  { phase: { label: "Symptom", tone: "warning" }, objective: "Connections hang after edge work. Scope before changing anything.", steps: ["incident-intro"] },
  { phase: { label: "Gather Evidence", tone: "danger" }, objective: "Follow the SYN and the SYN-ACK; read sessions and logs.", steps: ["inc-syn", "inc-fw1", "inc-server", "inc-synack", "inc-r2", "inc-fw2", "inc-retx", "q-server-syn", "inc-fw1-session", "q-allow", "q-fw1-state", "q-fw2"] },
  { phase: { label: "Form Hypothesis", tone: "violet" }, objective: "Compare both directions. Diagnosis pending.", steps: ["inc-routes", "q-fw1-never", "q-asym", "hypotheses", "q-broad-policy"] },
  { phase: { label: "Test", tone: "ip" }, objective: "Name the cause the evidence supports.", steps: ["diagnostic-layers", "predict-cause"] },
  { phase: { label: "Repair pending", tone: "warning" }, objective: "Choose the change that fixes the cause you identified.", steps: ["repair-challenge"] },
  { phase: { label: "Verify", tone: "success" }, objective: "Prove the reply returns through the session and the handshake completes.", steps: ["ver-syn", "ver-server", "ver-r2", "ver-fw1", "ver-ack"] },
  { phase: { label: "Complete", tone: "success" }, objective: "Map the method onto real firewalls.", steps: ["operations", "complete"] },
];

export const FW_BRIEFING_NOTES: Partial<Record<string, BriefingStepNote>> = {
  "base-fw1": { takeaway: "Policy is evaluated for new flows; the session admits the reply." },
  "incident-intro": { doingNow: "Scope: which devices see which packets?" },
  "inc-fw2": { takeaway: "A reply with no session is out-of-state." },
  "inc-fw1-session": { takeaway: "Zero reverse packets = the reply never came back this way." },
  "inc-routes": { doingNow: "Diagnosis pending." },
  "q-broad-policy": { takeaway: "Fix the path, not the rulebase." },
  "repair-challenge": { doingNow: "Choose the change that fixes the cause you identified." },
  "ver-ack": { takeaway: "Proof: ESTABLISHED, traffic both ways, on one firewall." },
};
