import type { BriefingPhaseDef, BriefingStepNote } from "@/components/lesson/briefing";

/** Mission Briefing — every step in exactly one phase; never names the winning prefix, the discard route or the repair early. */
export const RT_BRIEFING_PHASES: BriefingPhaseDef[] = [
  { phase: { label: "Observe — The tables", tone: "cyan" }, objective: "See where each route in the tables comes from.", steps: ["intro", "topology", "predict-connected", "connected-routes", "static-routes", "default-route"] },
  { phase: { label: "Trace — To SERVER-A", tone: "ip" }, objective: "Follow one ping from HOST-A through both routers.", steps: ["predict-host-l2", "a-sends", "r1-receives", "predict-lpm", "r1-selects", "predict-default-override", "predict-hop-change", "r1-forwards", "r2-forwards", "server-a-receives"] },
  { phase: { label: "Trace — The reply", tone: "success" }, objective: "See which routes carry the reply back.", steps: ["server-a-replies", "r2-return", "r1-return", "a-receives"] },
  { phase: { label: "Inspect — A remote destination", tone: "violet" }, objective: "Follow a destination outside the specific routes.", steps: ["default-send", "default-r1", "predict-default", "default-r2", "table-vs-decision"] },
  { phase: { label: "Incident", tone: "danger" }, objective: "One server is unreachable after maintenance. Diagnosis pending.", steps: ["incident-intro", "fault-a-send", "fault-a-r1", "predict-b-match", "probe-b-send", "probe-b-r1", "probe-b-r2", "probe-b-reply", "trouble-question", "diagnostic-layers"] },
  { phase: { label: "Repair pending", tone: "warning" }, objective: "Choose the change that fixes the cause you identified.", steps: ["repair-challenge"] },
  { phase: { label: "Verify", tone: "success" }, objective: "Prove both servers are reachable and the table is clean.", steps: ["verify-a-send", "verify-a-r1", "verify-a-r2", "verify-a-reply", "verify-b", "verify-table"] },
  { phase: { label: "Complete", tone: "success" }, objective: "Place static routing next to dynamic routing.", steps: ["dynamic-context", "complete"] },
];

export const RT_BRIEFING_NOTES: Partial<Record<string, BriefingStepNote>> = {
  "connected-routes": { takeaway: "Connected = a configured, up interface — not a typed route." },
  "static-routes": { takeaway: "A static next hop is resolved through a connected route." },
  "a-sends": { takeaway: "The Ethernet destination is the gateway; the IPv4 destination is the server." },
  "r1-receives": { doingNow: "R1 reads the IPv4 destination." },
  "r1-selects": { takeaway: "Longest prefix wins; the others stay installed." },
  "r1-forwards": { takeaway: "New frame and TTL − 1 per routed hop; IPv4 addresses unchanged." },
  "r2-return": { takeaway: "Reachability needs a route in BOTH directions." },
  "default-r2": { takeaway: "A default route is a next hop, not a guarantee." },
  "table-vs-decision": { takeaway: "Which routes exist ≠ which route wins." },
  "incident-intro": { doingNow: "A maintenance change on R1." },
  "trouble-question": { doingNow: "Diagnosis pending." },
  "repair-challenge": { doingNow: "Choose the change that fixes the cause you identified." },
  "verify-table": { takeaway: "Both servers reachable; no stray routes." },
};
