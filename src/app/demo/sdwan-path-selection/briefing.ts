import type { BriefingPhaseDef, BriefingStepNote } from "@/components/lesson/briefing";

/** Mission Briefing — every step in exactly one phase; the incident's cause is never named before its question. */
export const SD_BRIEFING_PHASES: BriefingPhaseDef[] = [
  { phase: { label: "Observe — Two paths", tone: "cyan" }, objective: "Separate underlay, overlay and application policy.", steps: ["intro", "underlay-overlay", "policies"] },
  { phase: { label: "Measure", tone: "violet" }, objective: "Measure each path with probes (PacketVerse SLA model).", steps: ["predict-physical", "probe-a", "probe-a-reply", "probe-b", "probe-b-reply", "measure-healthy"] },
  { phase: { label: "Classify", tone: "ip" }, objective: "Recognise the application behind a packet.", steps: ["voice-send", "classify-voice", "predict-voice-path"] },
  { phase: { label: "Select", tone: "warning" }, objective: "Pick a path from policy and live path state.", steps: ["select-voice"] },
  { phase: { label: "Forward", tone: "success" }, objective: "Carry two application classes on two paths at once.", steps: ["voice-hub", "bulk-send", "predict-bulk", "bulk-forward", "bulk-app", "predict-controller", "local-decision"] },
  { phase: { label: "Degrade", tone: "danger" }, objective: "One underlay gets worse without going down.", steps: ["degrade-a", "probe-a-bad", "predict-degrade", "predict-down", "measure-bad"] },
  { phase: { label: "Fail Over", tone: "warning" }, objective: "Watch Voice move to the other path.", steps: ["voice-after", "voice-failover", "voice-after-hub"] },
  { phase: { label: "Recover", tone: "success" }, objective: "Earn eligibility back — carefully.", steps: ["restore-a", "predict-hysteresis", "recover-1", "recover-2", "recover-3", "voice-back"] },
  { phase: { label: "Incident", tone: "danger" }, objective: "Calls fail although both circuits are up. Investigate.", steps: ["incident-intro", "probe-b-wrong", "measure-b-invalid", "degrade-a-again", "voice-blocked"] },
  { phase: { label: "Diagnose", tone: "danger" }, objective: "Diagnosis pending.", steps: ["predict-monitor", "diagnostic-layers"] },
  { phase: { label: "Repair pending", tone: "warning" }, objective: "Choose the change that fixes the cause you identified.", steps: ["repair-challenge"] },
  { phase: { label: "Verify", tone: "success" }, objective: "Prove Voice has an eligible path again.", steps: ["ver-probe-b", "ver-b-eligible", "ver-voice", "ver-voice-app"] },
  { phase: { label: "Complete", tone: "success" }, objective: "Separate the generic model from product specifics.", steps: ["sdwan-wrap", "complete"] },
];

export const SD_BRIEFING_NOTES: Partial<Record<string, BriefingStepNote>> = {
  "underlay-overlay": { takeaway: "Circuit up, tunnel reachable and path good enough are three different facts." },
  "probe-a": { doingNow: "An ordinary ICMP Echo — no SD-WAN header." },
  "measure-healthy": { takeaway: "SLA decisions use a whole interval of samples." },
  "classify-voice": { takeaway: "The class is local state on the edge, never a packet field." },
  "bulk-forward": { takeaway: "Two classes, two paths at once: application steering, not ECMP." },
  "local-decision": { takeaway: "Controllers distribute policy; the edge decides per packet." },
  "measure-bad": { takeaway: "Reachable but SLA-ineligible — not down." },
  "voice-failover": { takeaway: "Same packet, different path." },
  "recover-3": { takeaway: "Three passing intervals (PacketVerse model) before returning." },
  "incident-intro": { doingNow: "A monitoring configuration change." },
  "predict-monitor": { doingNow: "Diagnosis pending." },
  "repair-challenge": { doingNow: "Choose the change that fixes the cause you identified." },
  "ver-voice-app": { takeaway: "Voice flows again on a measured, eligible path." },
};
