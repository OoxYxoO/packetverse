import type { BriefingPhaseDef, BriefingStepNote } from "@/components/lesson/briefing";

/** Mission Briefing framing for EVPN-VPWS + Single-Active — presentation only; phase objectives also show on question/repair steps, so they never state an answer, the Primary before the election, or the incident's cause. */
export const EVPNVP_BRIEFING_PHASES: BriefingPhaseDef[] = [
  { phase: { label: "Act 1 — Redundancy", tone: "cyan" }, objective: "Meet a redundancy mode where only one attached PE forwards a service at a time.", steps: ["act1-intro", "single-active-intro", "predict-backup-down"] },
  { phase: { label: "Act 1 — Election", tone: "warning" }, objective: "Decide which attached PE carries the service, and how the remote side learns the mode.", steps: ["topology-intro", "es-inspector", "single-active-election", "all-active-vs-single-active"] },
  { phase: { label: "Act 2 — Service", tone: "violet" }, objective: "Define a point-to-point Ethernet service and decide how EVPN signals it.", steps: ["act2-intro", "predict-vpws-mechanism", "vpws-mental-model", "vpws-service-instance"] },
  { phase: { label: "Act 2 — Signaling", tone: "bgp" }, objective: "Follow the routes each PE advertises until the service can come up.", steps: ["pe1-advertises-adevi", "pe2-advertises-adevi", "pe3-advertises-adevi", "vpws-route-discovery", "vpws-service-viewer", "primary-backup-signaling", "not-all-active-note"] },
  { phase: { label: "Act 2 — Forwarding", tone: "ip" }, objective: "Carry one customer frame across the provider core and back.", steps: ["cea-sends-frame", "pe1-service-lookup", "mpls-data-plane", "vpws-service-label-explain", "core-transport-only", "pe3-disposition", "full-journey-recap", "return-direction"] },
  { phase: { label: "Act 2 — Context", tone: "success" }, objective: "Compare the service with multipoint bridging and traditional pseudowires.", steps: ["logical-vpws-view", "control-data-both-recap", "compare-vpws-vs-bridging", "compare-traditional-pw"] },
  { phase: { label: "Failover", tone: "danger" }, objective: "One service attachment fails. Follow the control-plane reaction and the new data path.", steps: ["failure-intro", "control-plane-response", "primary-backup-failover", "pb-route-transition", "pe3-failover-pipeline", "data-path-failover", "failure-distinction-note", "restore-pe1-ac"] },
  { phase: { label: "Scale", tone: "violet" }, objective: "Connect the service to faster ES-level signaling and to many service instances.", steps: ["mass-withdrawal-tie-in", "multiple-vpws-scaling", "service-instance-id-note", "transport-independence-note"] },
  { phase: { label: "Incident", tone: "danger" }, objective: "CE-A and CE-B can no longer exchange traffic. Find the failing layer.", steps: ["break-intro", "fault-injected", "trouble-intro", "trouble-question", "diagnostic-layers"] },
  { phase: { label: "Repair", tone: "warning" }, objective: "Apply the fix for the layer you identified, then prove the redundancy still works.", steps: ["repair-challenge", "verify-repair", "challenge-refail-pe1", "challenge-resend"] },
  { phase: { label: "Complete", tone: "success" }, objective: "Review Single-Active redundancy and the point-to-point service.", steps: ["single-active-vs-all-active-vpws", "complete"] },
];

export const EVPNVP_BRIEFING_NOTES: Partial<Record<string, BriefingStepNote>> = {
  "es-inspector": { doingNow: "Control plane: PE1 and PE2 advertise per-ES routes whose ESI Label community carries the Single-Active flag." },
  "single-active-election": { doingNow: "The default election orders loopbacks numerically, assigns ordinals, then applies service ID mod N." },
  "pe1-advertises-adevi": { doingNow: "Control plane: PE1's Ethernet A-D per-EVI route — service ID, service label, and its P/B role." },
  "pe3-advertises-adevi": { doingNow: "Control plane: PE3's per-EVI route — the single remote endpoint for this service." },
  "primary-backup-signaling": { doingNow: "P/B flags ride in the route's Layer-2 Attributes community — never in the customer frame." },
  "mpls-data-plane": { doingNow: "Data plane: transport label toward the destination PE over that PE's advertised service label." },
  "core-transport-only": { doingNow: "The core swaps only the top transport label." },
  "return-direction": { doingNow: "The reverse direction uses labels chosen for the opposite destination PE." },
  "failure-intro": { doingNow: "Only this service's attachment on one PE fails — the PE, its core links and BGP stay up." },
  "control-plane-response": { doingNow: "Control plane: a BGP WITHDRAW of that PE's per-EVI route for this service." },
  "data-path-failover": { takeaway: "Same service, new destination PE — so both labels change." },
  "mass-withdrawal-tie-in": { takeaway: "A per-EVI withdrawal is service-specific; the per-ES route is the ES-wide signal." },
  "fault-injected": { doingNow: "A controlled, educational fault is injected on one PE." },
  "trouble-intro": { doingNow: "BGP EVPN, the per-EVI routes and remote-endpoint discovery all report healthy." },
  "repair-challenge": { doingNow: "Choose the change that fixes the cause you identified." },
  "verify-repair": { takeaway: "Service proven with a real frame." },
  "challenge-resend": { takeaway: "The virtual wire survives failover with the backup PE's labels." },
};
