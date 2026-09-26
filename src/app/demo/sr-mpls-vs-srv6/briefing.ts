import type { BriefingPhaseDef, BriefingStepNote } from "@/components/lesson/briefing";

/** Mission Briefing framing for the SR-MPLS vs SRv6 capstone — presentation only; the scenario's label/narrative stay the source of truth. Phase objectives also show on question/repair steps, so they never state an answer. */
export const SRCMP_BRIEFING_PHASES: BriefingPhaseDef[] = [
  { phase: { label: "Brief", tone: "cyan" }, objective: "Solve one engineering brief twice, on one shared topology.", steps: ["brief", "predict-same-architecture", "topology-tour", "predict-rr-role"] },
  { phase: { label: "SR-MPLS transport", tone: "mpls" }, objective: "Carry PE1→PE2 traffic with an SR-MPLS label.", steps: ["mpls-transport-intro", "mpls-transport-push", "mpls-transport-core", "predict-mpls-label-bytes"] },
  { phase: { label: "SRv6 transport", tone: "ip" }, objective: "Carry the same traffic on the SRv6 data plane.", steps: ["srv6-transport-intro", "srv6-transport-setda", "srv6-transport-core", "srv6-transport-endpoint", "compare-transport-encoding"] },
  { phase: { label: "Explicit TE", tone: "warning" }, objective: "Steer the same flow over the alternate path in both encodings.", steps: ["te-requirement", "predict-minimal-segments", "mpls-te-build", "srv6-te-build", "compare-te-encoding", "srv6-te-usd-alternative"] },
  { phase: { label: "L3VPN", tone: "bgp" }, objective: "Build the same CUST-A service in both encodings.", steps: ["vpn-requirement", "predict-vrf-rt-common", "mpls-vpn-build", "mpls-vpn-packet", "srv6-vpn-build", "srv6-vpn-packet", "predict-p-router-vrf", "compare-vpn-encoding", "predict-bgp-next-hop"] },
  { phase: { label: "Protection", tone: "danger" }, objective: "Survive the P1-P2 failure with one shared computation, two encodings.", steps: ["failure-requirement", "shared-tilfa-compute", "predict-tilfa-shared", "link-fails", "mpls-repair-encoding", "srv6-repair-encoding", "repair-execution", "stale-fib-check", "compare-protection-encoding", "predict-endx-always-smaller"] },
  { phase: { label: "Programmability", tone: "violet" }, objective: "Compare how each data plane exposes endpoint instructions.", steps: ["endpoint-programmability", "predict-mpls-no-services"] },
  { phase: { label: "Header efficiency", tone: "cyan" }, objective: "Calculate instruction storage for a long program in each encoding.", steps: ["header-efficiency-setup", "header-efficiency-mpls", "header-efficiency-srv6", "header-efficiency-csid", "header-efficiency-mtu-case", "predict-equal-storage-equal-overhead"] },
  { phase: { label: "Decisions", tone: "warning" }, objective: "Match each fictional requirement to the encoding that fits it.", steps: ["requirement-matrix", "decision-lab-a", "decision-lab-b", "decision-lab-c", "migration-coexistence"] },
  { phase: { label: "Incident", tone: "danger" }, objective: "SRv6 VPN traffic fails while SR-MPLS keeps working. Find the failing layer.", steps: ["incident-intro", "incident-fault-injected", "incident-ladder", "wrong-repair-1", "wrong-repair-2", "wrong-repair-3"] },
  { phase: { label: "Repair", tone: "warning" }, objective: "Apply the fix for the failing layer, then prove it.", steps: ["incident-repair", "incident-resend", "predict-cross-arch-troubleshooting"] },
  { phase: { label: "Summary", tone: "success" }, objective: "Review what changes between the encodings and what does not.", steps: ["final-summary", "predict-final-verdict", "complete"] },
];

export const SRCMP_BRIEFING_NOTES: Partial<Record<string, BriefingStepNote>> = {
  "topology-tour": { doingNow: "CE1—PE1—P1—P2—PE2—CE2, alternate core P1—P3—P4—P2. RR1 is control-plane only." },
  "mpls-transport-push": { doingNow: "SR-MPLS: PE1 pushes Node-SID(PE2) = 16006, S = 1." },
  "mpls-transport-core": { doingNow: "P1 swaps 16006 to the same global value; P2 PHPs it; PE2 does the IPv4 lookup." },
  "srv6-transport-setda": { doingNow: "SRv6: outer DA = PE2's global-table End.DT4 SID, one SID, no SRH." },
  "srv6-transport-core": { doingNow: "P1 and P2 forward on PE2's locator with the ordinary IPv6 FIB." },
  "srv6-transport-endpoint": { doingNow: "PE2's End.DT4 (global table) removes the outer IPv6 header, then looks up the customer destination." },
  "mpls-te-build": { doingNow: "Stack 16004 S0 / 24045 S0 / 16006 S1: P3 PHPs 16004, P4 consumes its local Adj-SID, P2 PHPs 16006." },
  "srv6-te-build": { doingNow: "DA = P4 End.X, SRH SL 1: [0] PE2 End.DT4, [1] P4 End.X. At P4: SL 1→0, DA → PE2 End.DT4, forced P4→P2." },
  "compare-te-encoding": { takeaway: "3 labels vs 2 SIDs here follows from local Adj-SID vs globally routed End.X — not a universal rule." },
  "srv6-te-usd-alternative": { doingNow: "One additional steering outer (DA = P4 End.X+USD) around the existing End.DT4 transport packet." },
  "mpls-vpn-packet": { doingNow: "Transport 16006 over VPN label 9002; P routers read only the top label." },
  "srv6-vpn-packet": { doingNow: "Outer DA = CUST-A Service SID (End.DT4, VRF CUST-A) — a different SID from the global-table transport End.DT4." },
  "shared-tilfa-compute": { doingNow: "One computation: repair node P4, merge P2, outgoing interface P1→P3." },
  "mpls-repair-encoding": { doingNow: "Repair list [16004, 24045] above the transport label 16006 — full protected stack of three." },
  "srv6-repair-encoding": { doingNow: "Repair outer (SA = P1, DA = P4 End.X+USD, no SRH) around the transport outer (SA = PE1)." },
  "repair-execution": { doingNow: "SR-MPLS: P3 PHP, P4 Adj-SID, P2 PHP. SRv6: P4 USD removes only the repair outer; PE2 End.DT4 decapsulates." },
  "compare-protection-encoding": { takeaway: "Like with like: 2 repair labels vs 1 repair outer, each above an existing transport instruction." },
  "header-efficiency-csid": { doingNow: "Reuses the CSID lesson's real compression engine." },
  "incident-fault-injected": { doingNow: "PE2's SRv6 locator route is withdrawn; BGP, the route and RT import stay healthy." },
  "incident-repair": { doingNow: "Apply the fix for the layer you identified." },
  "incident-resend": { doingNow: "Resend CE1 → CE2 over the CUST-A Service SID to prove the data plane." },
  "final-summary": { takeaway: "One architecture, two encodings, real trade-offs — no universal winner." },
};
