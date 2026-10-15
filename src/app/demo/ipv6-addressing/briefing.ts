import type { BriefingPhaseDef, BriefingStepNote } from "@/components/lesson/briefing";

/** Mission Briefing — every step in exactly one phase; the incident's cause is never named before its question. */
export const V6_BRIEFING_PHASES: BriefingPhaseDef[] = [
  { phase: { label: "Notation", tone: "cyan" }, objective: "Read and shorten a 128-bit address.", steps: ["intro", "notation"] },
  { phase: { label: "Self-configuration", tone: "violet" }, objective: "Watch PC1 configure itself with no server.", steps: ["link-local", "dad", "rs", "ra", "slaac"] },
  { phase: { label: "Address types", tone: "ip" }, objective: "Name every address PC1 holds — and the ones it doesn't.", steps: ["address-types", "ula-anycast"] },
  { phase: { label: "Across the router", tone: "tcp" }, objective: "Ping a server on another subnet.", steps: ["ping-start", "na", "echo", "r1-routes", "server-replies"] },
  { phase: { label: "Incident", tone: "danger" }, objective: "R1 is replaced. PC1 reboots.", steps: ["fault-injected", "inc-rs", "inc-no-ra", "inc-ping"] },
  { phase: { label: "Diagnose", tone: "danger" }, objective: "Diagnosis pending.", steps: ["trouble-question", "diagnostic-layers"] },
  { phase: { label: "Repair pending", tone: "warning" }, objective: "Choose the change that fixes the cause you identified.", steps: ["repair-challenge"] },
  { phase: { label: "Verify", tone: "success" }, objective: "Prove PC1 configures itself and reaches the server.", steps: ["verify-ra", "verify-ping"] },
  { phase: { label: "Complete", tone: "success" }, objective: "Addresses, types and the RA that ties them together.", steps: ["complete"] },
];

export const V6_BRIEFING_NOTES: Partial<Record<string, BriefingStepNote>> = {
  intro: { takeaway: "128 bits, written as eight hex groups." },
  dad: { takeaway: "Solicited-node multicast: IPv6 has no broadcast." },
  rs: { doingNow: "PC1 asks every router on the link to speak." },
  slaac: { takeaway: "SLAAC: prefix from the router, interface ID from the host." },
  "ula-anycast": { takeaway: "Unique local is internal-only; anycast is one address on many devices." },
  na: { takeaway: "Neighbor discovery replaces ARP." },
  "r1-routes": { takeaway: "Hop Limit is IPv6's TTL: − 1 per router." },
  "fault-injected": { doingNow: "A new router with the old interface configuration." },
  "trouble-question": { doingNow: "Diagnosis pending." },
  "repair-challenge": { doingNow: "Choose the change that fixes the cause you identified." },
  "verify-ping": { takeaway: "Addresses on interfaces don't make a router; routing does." },
};
