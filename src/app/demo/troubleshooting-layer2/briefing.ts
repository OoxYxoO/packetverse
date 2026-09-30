import type { BriefingPhaseDef, BriefingStepNote } from "@/components/lesson/briefing";

/** Mission Briefing — the track's workflow; every step in exactly one phase; the cause is never named before its question. */
export const L2_BRIEFING_PHASES: BriefingPhaseDef[] = [
  { phase: { label: "Define", tone: "cyan" }, objective: "Meet the hosts, the VLANs and the redundant triangle.", steps: ["intro"] },
  { phase: { label: "Scope", tone: "violet" }, objective: "Understand access ports, trunks, tags and the spanning tree.", steps: ["vlan-design", "q-tag", "rstp-state", "q-stp-path"] },
  { phase: { label: "Baseline", tone: "success" }, objective: "Watch VLAN 10 work end to end and record the MAC tables.", steps: ["base-arp", "base-arp-sw2", "base-arp-sw3", "base-reply", "base-ping", "base-mac"] },
  { phase: { label: "Symptom", tone: "warning" }, objective: "HOST-A cannot reach HOST-B. Scope before you change anything.", steps: ["incident-intro"] },
  { phase: { label: "Gather Evidence", tone: "danger" }, objective: "Follow the frame, check links and RSTP, test another VLAN, read the MAC tables.", steps: ["inc-echo", "inc-sw2", "inc-ping-summary", "q-link-up", "inc-link-stp", "q-stp", "inc-vlan20", "q-other-vlans", "inc-mac-age", "q-missing-mac", "inc-unknown"] },
  { phase: { label: "Form Hypothesis", tone: "violet" }, objective: "Compare configuration along the path. Diagnosis pending.", steps: ["inc-vlan-table", "q-where-check", "q-isolate"] },
  { phase: { label: "Test", tone: "ip" }, objective: "Name the cause the evidence supports.", steps: ["diagnostic-layers", "predict-cause"] },
  { phase: { label: "Repair pending", tone: "warning" }, objective: "Choose the change that fixes the cause you identified.", steps: ["repair-challenge"] },
  { phase: { label: "Verify", tone: "success" }, objective: "Prove VLAN 10 crosses again, with RSTP untouched.", steps: ["ver-arp", "ver-sw3", "ver-reply", "ver-summary"] },
  { phase: { label: "Complete", tone: "success" }, objective: "Map the method onto real switches.", steps: ["operations", "complete"] },
];

export const L2_BRIEFING_NOTES: Partial<Record<string, BriefingStepNote>> = {
  "q-tag": { takeaway: "The 802.1Q tag carries the VLAN across trunks." },
  "rstp-state": { takeaway: "One port discards; the tree has no loop." },
  "base-mac": { takeaway: "A MAC is learned where frames FROM it arrive." },
  "incident-intro": { doingNow: "Scope: which hosts, which VLAN, which path?" },
  "inc-sw2": { takeaway: "A known MAC can still be dropped — read the drop reason." },
  "inc-link-stp": { takeaway: "Redundancy makes STP a suspect, not a culprit." },
  "inc-vlan20": { takeaway: "One VLAN failing on a working trunk points at membership." },
  "inc-vlan-table": { doingNow: "Diagnosis pending." },
  "repair-challenge": { doingNow: "Choose the change that fixes the cause you identified." },
  "ver-summary": { takeaway: "Proof: the service works, MAC tables are symmetric, RSTP untouched." },
};
