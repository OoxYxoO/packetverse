import type { BriefingPhaseDef, BriefingStepNote } from "@/components/lesson/briefing";

/** Mission Briefing — every step in exactly one phase; the incident's cause is never named before its question. */
export const FW_BRIEFING_PHASES: BriefingPhaseDef[] = [
  { phase: { label: "Observe — Four jobs", tone: "cyan" }, objective: "Meet the client, FW1, the ISP and the web server.", steps: ["intro", "zones", "routes"] },
  { phase: { label: "Policy", tone: "violet" }, objective: "Read the rules FW1 enforces: security policy and source NAT.", steps: ["policy-table", "predict-allow", "nat-rule", "predict-dst"] },
  { phase: { label: "Session", tone: "ip" }, objective: "Follow the first packet of a new connection through FW1.", steps: ["syn-send", "fw-session-miss", "fw-route", "fw-policy"] },
  { phase: { label: "NAT", tone: "warning" }, objective: "Watch the source tuple change — and what else must change with it.", steps: ["predict-tuple", "fw-nat", "predict-checksum"] },
  { phase: { label: "Handshake", tone: "tcp" }, objective: "Carry the SYN to the server and bring its answer back.", steps: ["isp-syn", "web-synack", "isp-synack"] },
  { phase: { label: "Stateful Return", tone: "success" }, objective: "See why the reply gets in without an inbound rule.", steps: ["predict-return", "fw-return", "client-ack", "web-established", "session-table"] },
  { phase: { label: "Inbound Test", tone: "danger" }, objective: "Send a brand-new connection attempt from outside.", steps: ["predict-unsolicited", "scan-send", "scan-isp", "fw-deny"] },
  { phase: { label: "Incident", tone: "danger" }, objective: "HTTPS times out after a change window. Investigate.", steps: ["incident-intro", "inc-syn", "inc-fw", "inc-isp", "inc-synack", "inc-isp-drop", "inc-stuck"] },
  { phase: { label: "Diagnose", tone: "danger" }, objective: "Diagnosis pending.", steps: ["trouble-question", "diagnostic-layers"] },
  { phase: { label: "Repair pending", tone: "warning" }, objective: "Choose the change that fixes the cause you identified.", steps: ["repair-challenge"] },
  { phase: { label: "Verify", tone: "success" }, objective: "Prove a full handshake works again.", steps: ["verify-syn", "verify-fw", "verify-isp", "verify-synack", "verify-return", "verify-ack", "verify-established"] },
  { phase: { label: "Complete", tone: "success" }, objective: "Keep routing, policy, state and NAT apart.", steps: ["processing-order", "complete"] },
];

export const FW_BRIEFING_NOTES: Partial<Record<string, BriefingStepNote>> = {
  routes: { takeaway: "A firewall routes first; policy never replaces a route." },
  "policy-table": { takeaway: "First match wins; everything else hits the default deny." },
  "fw-session-miss": { doingNow: "A SYN with no session takes the full evaluation path." },
  "fw-policy": { takeaway: "The policy name lives in the session, never in the packet." },
  "fw-nat": { takeaway: "Source NAT changes the source tuple only — and both checksums." },
  "fw-return": { takeaway: "Replies are allowed by the session, not by an inbound rule." },
  "session-table": { takeaway: "Original tuple, translated tuple, zones, policy, TCP state — all in the session." },
  "fw-deny": { takeaway: "Same server, new flow: no session, no rule, default deny." },
  "incident-intro": { doingNow: "A source-NAT rule edit during a change window." },
  "trouble-question": { doingNow: "Diagnosis pending." },
  "repair-challenge": { doingNow: "Choose the change that fixes the cause you identified." },
  "verify-established": { takeaway: "SYN, SYN-ACK, ACK — ESTABLISHED, without touching the policy." },
};
