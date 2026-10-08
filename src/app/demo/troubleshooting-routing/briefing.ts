import type { BriefingPhaseDef, BriefingStepNote } from "@/components/lesson/briefing";

/** Mission Briefing — the track's workflow; every step in exactly one phase; the cause is never named before its question. */
export const RT_BRIEFING_PHASES: BriefingPhaseDef[] = [
  { phase: { label: "Define", tone: "cyan" }, objective: "Meet the routers, OSPF and the two servers.", steps: ["intro"] },
  { phase: { label: "Scope", tone: "violet" }, objective: "Record the control plane and R1's table.", steps: ["ospf-state", "base-rib"] },
  { phase: { label: "Baseline", tone: "success" }, objective: "Follow a healthy echo hop by hop.", steps: ["base-echo", "base-r1", "base-r2", "base-r3", "q-ttl", "base-summary"] },
  { phase: { label: "Symptom", tone: "warning" }, objective: "One server is 'down'. Scope before touching anything.", steps: ["incident-intro"] },
  { phase: { label: "Gather Evidence", tone: "danger" }, objective: "Compare servers, check OSPF, follow the failing packet, count where it stops.", steps: ["inc-ping-b", "q-server-b", "inc-ospf", "q-ospf-proof", "inc-echo-a", "inc-r1-a", "q-matches", "inc-r2-counters", "q-where", "inc-trace", "inc-server-a-ok"] },
  { phase: { label: "Form Hypothesis", tone: "violet" }, objective: "Reason about route selection. Diagnosis pending.", steps: ["q-lpm", "q-pref", "inc-rib-fib", "q-rib-fib", "q-metric", "inc-config"] },
  { phase: { label: "Test", tone: "ip" }, objective: "Name the cause the evidence supports.", steps: ["diagnostic-layers", "predict-cause"] },
  { phase: { label: "Repair pending", tone: "warning" }, objective: "Choose the change that fixes the cause you identified.", steps: ["repair-challenge"] },
  { phase: { label: "Verify", tone: "success" }, objective: "Prove the packet now reaches R2 and SERVER-A.", steps: ["ver-rib", "ver-echo", "ver-r1", "ver-r2", "ver-r3", "ver-summary"] },
  { phase: { label: "Complete", tone: "success" }, objective: "Map the method onto real routers.", steps: ["operations", "complete"] },
];

export const RT_BRIEFING_NOTES: Partial<Record<string, BriefingStepNote>> = {
  "ospf-state": { takeaway: "Control plane healthy ≠ every destination forwarded." },
  "q-ttl": { takeaway: "Routers rewrite L2 and TTL; the IP destination never changes." },
  "incident-intro": { doingNow: "Scope: which destinations fail?" },
  "inc-ping-b": { takeaway: "A working neighbor on the same path is strong scoping evidence." },
  "inc-r1-a": { takeaway: "Read the router's own lookup for the failing address." },
  "q-lpm": { doingNow: "Diagnosis pending." },
  "q-pref": { takeaway: "Preference only breaks ties between equal prefixes." },
  "repair-challenge": { doingNow: "Choose the change that fixes the cause you identified." },
  "ver-r2": { takeaway: "Proof: packets appear where they were missing." },
};
