import type { BriefingPhaseDef, BriefingStepNote } from "@/components/lesson/briefing";

/** Mission Briefing — every step in exactly one phase; the incident's cause is never named before its question. */
export const COMP_BRIEFING_PHASES: BriefingPhaseDef[] = [
  { phase: { label: "Observe — One request", tone: "cyan" }, objective: "Follow a laptop's request to a server in the building.", steps: ["intro", "predict-first", "laptop-sends", "ap-bridges", "acc-forwards", "predict-core", "core-routes", "server-receives"] },
  { phase: { label: "Leave the building", tone: "violet" }, objective: "Follow a request to a cloud application across the edge.", steps: ["leave-building", "core-default", "predict-fw", "fw-policy", "edge-nat", "isp-carries", "app-receives", "roles"] },
  { phase: { label: "Architectures", tone: "ip" }, objective: "Compare SOHO, 2-tier, 3-tier and spine-leaf by paths and hops.", steps: ["arch-intro", "soho", "two-tier", "three-tier", "three-tier-paths", "spine-leaf", "spine-leaf-why", "wan-cloud"] },
  { phase: { label: "Incident", tone: "danger" }, objective: "A new access point goes in. Something doesn't work.", steps: ["fault-injected", "no-wifi"] },
  { phase: { label: "Diagnose", tone: "danger" }, objective: "Diagnosis pending.", steps: ["trouble-question", "diagnostic-layers"] },
  { phase: { label: "Repair pending", tone: "warning" }, objective: "Choose the change that fixes the cause you identified.", steps: ["repair-challenge"] },
  { phase: { label: "Verify", tone: "success" }, objective: "Prove the meeting room has Wi-Fi again.", steps: ["verify-power", "verify-assoc"] },
  { phase: { label: "Complete", tone: "success" }, objective: "Name every component's job and every design's trade-off.", steps: ["complete"] },
];

export const COMP_BRIEFING_NOTES: Partial<Record<string, BriefingStepNote>> = {
  "ap-bridges": { takeaway: "An AP bridges radio to cable; it does not route." },
  "acc-forwards": { takeaway: "A Layer 2 switch forwards on the destination MAC and changes nothing." },
  "core-routes": { takeaway: "Every routed hop: new MACs, TTL − 1, same IP addresses." },
  "fw-policy": { takeaway: "A firewall decides by policy and remembers the connection." },
  "edge-nat": { takeaway: "The edge router hides private addresses behind one public address." },
  roles: { takeaway: "One job per component, at one layer." },
  soho: { doingNow: "One box doing every job." },
  "three-tier-paths": { takeaway: "Redundant pairs multiply the paths — and the cabling." },
  "spine-leaf-why": { takeaway: "Leaf → spine → leaf: every server equally close." },
  "fault-injected": { doingNow: "A new AP is patched into ACC-SW1." },
  "trouble-question": { doingNow: "Diagnosis pending." },
  "repair-challenge": { doingNow: "Choose the change that fixes the cause you identified." },
  "verify-assoc": { takeaway: "Power, link, controller, radio — then users." },
};
