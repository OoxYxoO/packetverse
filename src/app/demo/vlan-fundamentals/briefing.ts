import type { BriefingPhaseDef, BriefingStepNote } from "@/components/lesson/briefing";

/** Mission Briefing for VLANs & Trunking — every step in exactly one phase; question/incident objectives never give the answer. */
export const VLAN_BRIEFING_PHASES: BriefingPhaseDef[] = [
  { phase: { label: "Observe — One network, two VLANs", tone: "cyan" }, objective: "See how one set of switches becomes two Layer-2 broadcast domains.", steps: ["intro", "why-vlans", "access-ports"] },
  { phase: { label: "Predict — Classification", tone: "warning" }, objective: "Work out how an untagged frame gets its VLAN.", steps: ["predict-classify"] },
  { phase: { label: "Observe — The trunk", tone: "violet" }, objective: "Meet the link that carries more than one VLAN.", steps: ["trunk-intro"] },
  { phase: { label: "Observe — VLAN 10 unicast", tone: "cyan" }, objective: "Follow one VLAN 10 frame from access port, across the trunk, to access port.", steps: ["a-sends", "sw1-classify", "predict-tag", "sw1-tags", "tag-anatomy", "sw2-ingress", "sw2-untag", "b-accepts"] },
  { phase: { label: "Observe — The reply", tone: "violet" }, objective: "Watch the reply use what both switches learned.", steps: ["b-replies", "reply-trunk", "reply-delivered"] },
  { phase: { label: "Inspect — VLAN 20", tone: "ip" }, objective: "Run the second VLAN over the same hardware and compare.", steps: ["c-sends", "c-trunk", "d-delivered", "predict-fdb-scope", "vlan-scoped-fdb"] },
  { phase: { label: "Inspect — Broadcast isolation", tone: "warning" }, objective: "Decide where a broadcast goes when VLANs share switches.", steps: ["predict-broadcast", "a-broadcast", "bcast-sw1", "bcast-sw2", "isolation-note"] },
  { phase: { label: "Predict — Between VLANs", tone: "violet" }, objective: "Find the limit of pure Layer-2 switching.", steps: ["predict-inter-vlan"] },
  { phase: { label: "Incident", tone: "danger" }, objective: "HOST-A cannot reach HOST-B, while HOST-C and HOST-D can talk. Diagnosis pending.", steps: ["break-intro", "fault-injected", "fault-a-sends", "fault-drop", "fault-vlan20-works", "trouble-question", "diagnostic-layers"] },
  { phase: { label: "Repair pending", tone: "warning" }, objective: "Apply the fix for the cause you identified.", steps: ["repair-challenge"] },
  { phase: { label: "Verify", tone: "success" }, objective: "Prove VLAN 10 crosses the trunk again.", steps: ["verify-vlan10", "verify-delivered"] },
  { phase: { label: "Complete", tone: "success" }, objective: "Review access, trunk, tags and per-VLAN forwarding.", steps: ["complete"] },
];

export const VLAN_BRIEFING_NOTES: Partial<Record<string, BriefingStepNote>> = {
  "access-ports": { takeaway: "Hosts send untagged frames." },
  "sw1-classify": { doingNow: "Ingress classification on an access port." },
  "sw1-tags": { takeaway: "Tag added on trunk egress: TPID 0x8100, VID 10." },
  "tag-anatomy": { takeaway: "The tag sits after the source MAC and before the original EtherType." },
  "sw2-untag": { takeaway: "Tag removed on access egress." },
  "c-trunk": { takeaway: "Same trunk, VID 20." },
  "vlan-scoped-fdb": { takeaway: "Every FDB entry is (VLAN, MAC)." },
  "bcast-sw2": { takeaway: "The broadcast stayed in VLAN 10." },
  "fault-injected": { doingNow: "A configuration change on one switch." },
  "trouble-question": { doingNow: "Diagnosis pending." },
  "repair-challenge": { doingNow: "Choose the change that fixes the cause you identified." },
  "verify-delivered": { takeaway: "VLAN 10 restored; VLAN 20 was never affected." },
};
