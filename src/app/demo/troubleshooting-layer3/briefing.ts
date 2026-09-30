import type { BriefingPhaseDef, BriefingStepNote } from "@/components/lesson/briefing";

/** Mission Briefing — the track's workflow; every step in exactly one phase; the cause is never named before its question. */
export const L3_BRIEFING_PHASES: BriefingPhaseDef[] = [
  { phase: { label: "Define", tone: "cyan" }, objective: "Meet the client, the routers and the two remote servers.", steps: ["intro"] },
  { phase: { label: "Scope", tone: "violet" }, objective: "Learn how a host decides local vs remote.", steps: ["host-decision", "q-local-remote"] },
  { phase: { label: "Baseline", tone: "success" }, objective: "Watch ARP, gateway forwarding and TTL on a healthy path.", steps: ["base-table", "base-arp-gw", "q-arp-who", "base-arp-reply", "base-echo", "base-r1", "base-r2", "base-reply"] },
  { phase: { label: "Symptom", tone: "warning" }, objective: "One server is unreachable. Scope before touching anything.", steps: ["incident-intro"] },
  { phase: { label: "Gather Evidence", tone: "danger" }, objective: "Compare destinations, follow CLIENT's decision, check R1 and the server.", steps: ["inc-server-ok", "q-scope", "inc-decision", "inc-arp", "inc-arp-r1", "inc-arp-fail", "q-r1-silent", "inc-r1-stats", "q-which-route", "q-default", "inc-remote-ok", "q-router-route"] },
  { phase: { label: "Form Hypothesis", tone: "violet" }, objective: "Compare the configuration with the plan. Diagnosis pending.", steps: ["inc-client-config", "q-mask-arp"] },
  { phase: { label: "Test", tone: "ip" }, objective: "Name the cause the evidence supports.", steps: ["diagnostic-layers", "predict-cause"] },
  { phase: { label: "Repair pending", tone: "warning" }, objective: "Choose the change that fixes the cause you identified.", steps: ["repair-challenge"] },
  { phase: { label: "Verify", tone: "success" }, objective: "Prove the packet the broken host never sent now flows.", steps: ["ver-table", "ver-arp-gw", "ver-arp-reply", "ver-echo", "ver-r1", "ver-r2", "ver-reply", "q-headers"] },
  { phase: { label: "Complete", tone: "success" }, objective: "Map the method onto real hosts and routers.", steps: ["operations", "complete"] },
];

export const L3_BRIEFING_NOTES: Partial<Record<string, BriefingStepNote>> = {
  "host-decision": { takeaway: "Prefix length decides what is on-link." },
  "base-arp-gw": { takeaway: "ARP resolves the NEXT HOP, not the final host." },
  "base-echo": { takeaway: "Gateway MAC, remote IP — two layers, two destinations." },
  "base-r1": { takeaway: "TTL drops only at routers." },
  "incident-intro": { doingNow: "Scope: which destinations fail, which work?" },
  "inc-arp": { takeaway: "ARPing for a remote address is a fingerprint." },
  "q-default": { takeaway: "The default route is only used when nothing longer matches." },
  "inc-client-config": { doingNow: "Diagnosis pending." },
  "repair-challenge": { doingNow: "Choose the change that fixes the cause you identified." },
  "ver-echo": { takeaway: "The packet the broken host never produced." },
};
