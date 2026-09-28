import type { BriefingPhaseDef, BriefingStepNote } from "@/components/lesson/briefing";

/** Mission Briefing — every step in exactly one phase; never reveals a traceroute hop or the PMTU diagnosis early. */
export const IC_BRIEFING_PHASES: BriefingPhaseDef[] = [
  { phase: { label: "Observe — ICMP", tone: "cyan" }, objective: "See where ICMP sits and what an Echo message carries.", steps: ["intro", "icmp-in-ip", "predict-ports", "echo-anatomy"] },
  { phase: { label: "Observe — Ping", tone: "ip" }, objective: "Follow one Echo Request and its reply across two routers.", steps: ["ping-send", "r1-forward", "predict-ttl", "r2-forward", "b-receives", "b-reply", "reply-r2", "reply-r1", "predict-match", "a-matches"] },
  { phase: { label: "Inspect — Traceroute", tone: "violet" }, objective: "Use rising TTLs to discover each hop on the path.", steps: ["trace-intro", "predict-hop1", "probe1-send", "probe1-expire", "probe2-send", "probe2-r1", "probe2-expire", "probe2-return", "probe3-send", "probe3-arrives", "probe3-reply", "trace-result"] },
  { phase: { label: "Predict — MTU", tone: "warning" }, objective: "Understand what an MTU measures and what DF changes.", steps: ["mtu-intro"] },
  { phase: { label: "Incident", tone: "danger" }, objective: "Large test pings fail after maintenance. Diagnosis pending.", steps: ["break-intro", "fault-injected", "small-ping", "big-ping-send", "big-ping-drop", "trouble-question", "diagnostic-layers"] },
  { phase: { label: "Repair pending", tone: "warning" }, objective: "Choose the change that fixes the cause you identified.", steps: ["repair-challenge"] },
  { phase: { label: "Verify", tone: "success" }, objective: "Prove the repaired probe crosses the path both ways.", steps: ["verify-send", "verify-forward", "verify-deliver", "verify-reply"] },
  { phase: { label: "Complete", tone: "success" }, objective: "Review what each ICMP message told you.", steps: ["complete"] },
];

export const IC_BRIEFING_NOTES: Partial<Record<string, BriefingStepNote>> = {
  "icmp-in-ip": { takeaway: "IPv4 Protocol 1 — no ports." },
  "r1-forward": { doingNow: "Each forwarding router decrements TTL." },
  "b-reply": { takeaway: "The reply is a new, independently routed packet." },
  "a-matches": { takeaway: "Identifier + Sequence pair replies with requests." },
  "trace-intro": { doingNow: "This lesson models ICMP-Echo-based traceroute." },
  "probe1-expire": { takeaway: "Time Exceeded's source address reveals the hop." },
  "trace-result": { takeaway: "Rising TTL maps the path one hop at a time." },
  "fault-injected": { doingNow: "A maintenance change on the R1–R2 link." },
  "trouble-question": { doingNow: "Diagnosis pending." },
  "repair-challenge": { doingNow: "Choose the change that fixes the cause you identified." },
  "verify-reply": { takeaway: "The DF probe fits the path MTU in both directions." },
};
