import type { BriefingPhaseDef, BriefingStepNote } from "@/components/lesson/briefing";

/** Mission Briefing for IPv4 Addressing & Subnetting — every step in exactly one phase; question/incident objectives never give the answer. */
export const V4_BRIEFING_PHASES: BriefingPhaseDef[] = [
  { phase: { label: "Observe — Addresses", tone: "cyan" }, objective: "Read an IPv4 address as 32 bits split into network and host parts.", steps: ["intro", "address-anatomy", "prefix-mask"] },
  { phase: { label: "Predict — The boundary", tone: "warning" }, objective: "Work out what a prefix length means in bits and addresses.", steps: ["predict-mask"] },
  { phase: { label: "Inspect — Subnetting", tone: "violet" }, objective: "Find network, broadcast and host range for any address and prefix.", steps: ["subnet-chamber", "predict-block", "four-subnets", "host-a-subnet", "host-b-subnet"] },
  { phase: { label: "Predict — Next hop", tone: "warning" }, objective: "Decide how HOST-A reaches a destination: directly or through a gateway.", steps: ["predict-local", "and-math", "predict-l2-next-hop"] },
  { phase: { label: "Observe — Routing", tone: "ip" }, objective: "Follow one packet across the router and compare Layer 2 with Layer 3.", steps: ["a-sends", "swa-forwards", "r1-lookup", "predict-ttl", "r1-forwards", "swb-forwards", "b-receives"] },
  { phase: { label: "Observe — The reply", tone: "violet" }, objective: "Watch the return path make the same decisions from the other side.", steps: ["b-decides", "b-sends", "reply-to-r1", "reply-routed", "reply-delivered", "header-recap", "cidr-note"] },
  { phase: { label: "Incident", tone: "danger" }, objective: "HOST-A can no longer reach HOST-B. Diagnosis pending — gather the evidence.", steps: ["break-intro", "fault-injected", "fault-decision", "fault-arp", "fault-flood", "fault-r1-silent", "fault-unresolved", "trouble-question", "diagnostic-layers"] },
  { phase: { label: "Repair pending", tone: "warning" }, objective: "Apply the fix for the cause you identified.", steps: ["repair-challenge"] },
  { phase: { label: "Verify", tone: "success" }, objective: "Prove the fix with the same decision and a real packet.", steps: ["verify-decision", "verify-send", "verify-routed", "verify-delivered"] },
  { phase: { label: "Complete", tone: "success" }, objective: "Review addressing, subnetting and routed forwarding.", steps: ["complete"] },
];

export const V4_BRIEFING_NOTES: Partial<Record<string, BriefingStepNote>> = {
  "prefix-mask": { takeaway: "Prefix length = number of network bits." },
  "subnet-chamber": { doingNow: "Try addresses at block edges." },
  "and-math": { doingNow: "HOST-A ANDs both addresses with its own mask.", takeaway: "Different networks → use the gateway." },
  "a-sends": { takeaway: "IPv4 destination = HOST-B; Ethernet destination = R1." },
  "r1-lookup": { doingNow: "R1 matches a connected route." },
  "r1-forwards": { takeaway: "TTL −1, checksum updated, new Ethernet header." },
  "header-recap": { takeaway: "L2 is per link; L3 is end to end." },
  "fault-injected": { doingNow: "A configuration change on one host." },
  "fault-r1-silent": { doingNow: "R1 processes a request it cannot answer." },
  "trouble-question": { doingNow: "Diagnosis pending." },
  "repair-challenge": { doingNow: "Choose the change that fixes the cause you identified." },
  "verify-delivered": { takeaway: "Service restored." },
};
