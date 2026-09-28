import type { BriefingPhaseDef, BriefingStepNote } from "@/components/lesson/briefing";

/** Mission Briefing — every step in exactly one phase; never names the wrong Option 6 before the investigation. */
export const DH_BRIEFING_PHASES: BriefingPhaseDef[] = [
  { phase: { label: "Observe — Boot", tone: "cyan" }, objective: "Start from a client that has no IPv4 configuration at all.", steps: ["intro", "why-dhcp", "client-init", "predict-src"] },
  { phase: { label: "Observe — Discover", tone: "warning" }, objective: "Follow the first broadcast and see how it reaches a server on another subnet.", steps: ["discover-send", "discover-flood", "predict-relay", "relay-discover", "discover-server", "predict-giaddr"] },
  { phase: { label: "Observe — Offer & Request", tone: "violet" }, objective: "Watch the offer come back and the client choose it.", steps: ["server-offer", "offer-relay", "offer-client", "predict-request", "request-send", "request-relay"] },
  { phase: { label: "Observe — Acknowledge", tone: "success" }, objective: "Complete the lease and see what the client now knows.", steps: ["server-ack", "ack-relay", "client-bound", "dora-summary"] },
  { phase: { label: "Inspect — DNS", tone: "ip" }, objective: "Resolve a name using the DNS server from the lease.", steps: ["dns-why", "dns-query", "dns-route", "dns-server", "dns-response-route", "dns-resolved", "predict-dns-ttl"] },
  { phase: { label: "Incident", tone: "danger" }, objective: "Names stopped working after a scope edit. Diagnosis pending.", steps: ["break-intro", "fault-injected", "fault-reacquire", "fault-query", "fault-lost", "fault-evidence", "trouble-question", "diagnostic-layers"] },
  { phase: { label: "Repair pending", tone: "warning" }, objective: "Choose the change that fixes the cause for this client.", steps: ["repair-challenge"] },
  { phase: { label: "Verify", tone: "success" }, objective: "Make the client learn the fix, then prove name resolution.", steps: ["renew-request", "renew-ack", "verify-query", "verify-answer"] },
  { phase: { label: "Complete", tone: "success" }, objective: "Review boot-to-name end to end.", steps: ["complete"] },
];

export const DH_BRIEFING_NOTES: Partial<Record<string, BriefingStepNote>> = {
  "discover-send": { takeaway: "0.0.0.0 → 255.255.255.255, UDP 68 → 67." },
  "relay-discover": { doingNow: "The relay stamps giaddr and unicasts to the server." },
  "server-offer": { takeaway: "giaddr selects the scope." },
  "request-send": { takeaway: "Option 54 names the chosen server." },
  "client-bound": { takeaway: "Address, mask, gateway and DNS all came from options." },
  "dns-query": { doingNow: "UDP to port 53 on the lease's DNS server." },
  "dns-resolved": { takeaway: "Transaction IDs pair queries with responses." },
  "fault-injected": { doingNow: "A configuration change on DHCP-SRV." },
  "fault-evidence": { doingNow: "A targeted test isolates one variable." },
  "trouble-question": { doingNow: "Diagnosis pending." },
  "repair-challenge": { doingNow: "Choose the change that fixes the cause for this client." },
  "renew-ack": { takeaway: "Only a renewed lease carries the corrected option." },
  "verify-answer": { takeaway: "Name resolution restored." },
};
