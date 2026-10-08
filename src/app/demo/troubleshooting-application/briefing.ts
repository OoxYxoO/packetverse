import type { BriefingPhaseDef, BriefingStepNote } from "@/components/lesson/briefing";

/** Mission Briefing — the track's workflow; every step in exactly one phase; the cause is never named before its question. */
export const AP_BRIEFING_PHASES: BriefingPhaseDef[] = [
  { phase: { label: "Define", tone: "cyan" }, objective: "Meet the service, the resolver and the two web servers.", steps: ["intro"] },
  { phase: { label: "Scope", tone: "violet" }, objective: "Know the intended record and its TTL.", steps: ["design"] },
  { phase: { label: "Baseline", tone: "success" }, objective: "Watch name → address → TCP → HTTP succeed.", steps: ["base-query", "base-answer", "base-syn", "base-synack", "base-get", "base-200"] },
  { phase: { label: "Symptom", tone: "warning" }, objective: "Users see an error after a migration. Scope before changing anything.", steps: ["incident-intro"] },
  { phase: { label: "Gather Evidence", tone: "danger" }, objective: "Follow the same chain: DNS answer, handshake, request, status.", steps: ["inc-query", "inc-answer", "q-dns-addr", "inc-syn", "inc-synack", "q-tcp", "inc-get", "inc-503", "q-503", "q-503-net"] },
  { phase: { label: "Form Hypothesis", tone: "violet" }, objective: "Change one variable: test the intended service directly. Diagnosis pending.", steps: ["inc-direct-get", "inc-direct-200", "q-direct", "q-host", "inc-authoritative", "q-arp"] },
  { phase: { label: "Test", tone: "ip" }, objective: "Name the cause the evidence supports.", steps: ["diagnostic-layers", "predict-cause"] },
  { phase: { label: "Repair pending", tone: "warning" }, objective: "Choose the change that fixes the cause you identified.", steps: ["repair-challenge"] },
  { phase: { label: "Verify", tone: "success" }, objective: "Handle caching, then prove the name leads to a 200.", steps: ["ver-stale", "q-old-answer", "q-ttl", "ver-flush", "ver-query", "ver-answer", "ver-syn", "ver-get", "ver-200"] },
  { phase: { label: "Complete", tone: "success" }, objective: "Map the method onto real tools.", steps: ["operations", "complete"] },
];

export const AP_BRIEFING_NOTES: Partial<Record<string, BriefingStepNote>> = {
  "base-answer": { takeaway: "The client caches the answer for its TTL." },
  "incident-intro": { doingNow: "Scope: which layer actually answered?" },
  "inc-503": { takeaway: "A status code means the application answered." },
  "inc-direct-200": { takeaway: "Same request, different address source → different result." },
  "inc-authoritative": { doingNow: "Diagnosis pending." },
  "repair-challenge": { doingNow: "Choose the change that fixes the cause you identified." },
  "ver-stale": { takeaway: "A correct fix can be invisible until caches expire." },
  "ver-flush": { takeaway: "Flushing is a verification aid, not the repair." },
  "ver-200": { takeaway: "Proof: by name, fresh lookup, 200 OK." },
};
