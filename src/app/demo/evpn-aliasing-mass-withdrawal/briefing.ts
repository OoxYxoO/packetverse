import type { BriefingPhaseDef, BriefingStepNote } from "@/components/lesson/briefing";

/** Mission Briefing framing for EVPN Aliasing + Mass Withdrawal — presentation only; phase objectives also show on question/repair steps, so they never state an answer, which path will fail, or the incident's cause. */
export const EVPNAL_BRIEFING_PHASES: BriefingPhaseDef[] = [
  { phase: { label: "Mission", tone: "cyan" }, objective: "Decide how a remote leaf can reach a multihomed server for known-unicast traffic.", steps: ["intro", "known-unicast-setup", "predict-only-leaf1"] },
  { phase: { label: "Control plane", tone: "bgp" }, objective: "Follow the routes a remote leaf combines before any path becomes usable.", steps: ["aliasing-problem-intro", "type1-deep-dive", "leaf1-advertises-perevi-perces", "leaf2-advertises-perevi-perces", "aliasing-decision-chamber", "aliasing-vs-df"] },
  { phase: { label: "Forwarding", tone: "ip" }, objective: "Send two example flows and see which eligible leaf each one uses.", steps: ["flow-a-intro", "flow-a-leaf3-pipeline", "flow-a-delivered", "flow-b-intro", "flow-b-delivered", "control-data-both-recap"] },
  { phase: { label: "Failure", tone: "danger" }, objective: "One attachment fails. Decide how quickly the remote leaf can stop using it.", steps: ["fail-es-attachment", "convergence-problem", "predict-must-wait"] },
  { phase: { label: "Convergence", tone: "violet" }, objective: "Follow the failure signal from the attached leaf to the remote leaf's forwarding state.", steps: ["mass-withdrawal-intro", "withdraw-per-es", "enter-leaf3-mass-withdrawal", "leaf3-processes-withdrawal", "next-hop-transformation", "type2-route-still-visible", "resend-after-mass-withdrawal"] },
  { phase: { label: "Context", tone: "warning" }, objective: "Separate the three multihoming mechanisms and why the fast signal matters.", steps: ["scaling-visualization", "mass-withdrawal-vs-df", "combined-failure-view", "aliasing-vs-df-vs-mass-withdrawal", "type1-summary"] },
  { phase: { label: "Incident", tone: "danger" }, objective: "Some flows to SERVER-A fail. Find the failing layer.", steps: ["break-intro", "fault-injected", "trouble-intro", "trouble-question", "diagnostic-layers"] },
  { phase: { label: "Repair", tone: "warning" }, objective: "Apply the fix for the layer you identified, then prove it.", steps: ["repair-challenge", "verify-converged"] },
  { phase: { label: "Complete", tone: "success" }, objective: "Review the route types and the three mechanisms.", steps: ["route-type-recap", "complete"] },
];

export const EVPNAL_BRIEFING_NOTES: Partial<Record<string, BriefingStepNote>> = {
  "known-unicast-setup": { doingNow: "Control plane: a Type-2 MAC/IP route for SERVER-A carrying its ESI — not a list of next hops." },
  "leaf1-advertises-perevi-perces": { doingNow: "Control plane: LEAF1's per-EVI route (Ethernet Tag 0, VNI in the label) plus its All-Active per-ES route." },
  "leaf2-advertises-perevi-perces": { doingNow: "Control plane: LEAF2 advertises the same pair for its own attachment." },
  "aliasing-decision-chamber": { takeaway: "A leaf is eligible only with both its per-EVI and its active All-Active per-ES route." },
  "flow-a-intro": { doingNow: "Flow A and Flow B are a deterministic teaching abstraction — not a real hash algorithm." },
  "flow-a-leaf3-pipeline": { doingNow: "Data plane: LEAF3 encapsulates toward the leaf selected for this flow." },
  "fail-es-attachment": { doingNow: "Only one leaf's attachment to the segment fails — the leaf, its underlay and BGP stay up." },
  "withdraw-per-es": { doingNow: "Control plane: a BGP WITHDRAW of the Ethernet A-D per-ES route." },
  "leaf3-processes-withdrawal": { doingNow: "LEAF3 applies the received withdrawal to its forwarding state." },
  "type2-route-still-visible": { takeaway: "A route that still exists is not the same as a usable next hop." },
  "fault-injected": { doingNow: "A controlled, educational fault is injected on one leaf." },
  "trouble-intro": { doingNow: "The MAC route, the BGP session and VTEP reachability all report healthy." },
  "repair-challenge": { doingNow: "Choose the change that fixes the cause you identified." },
  "verify-converged": { takeaway: "Convergence proven with a real flow." },
};
