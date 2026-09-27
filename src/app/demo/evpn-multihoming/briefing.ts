import type { BriefingPhaseDef, BriefingStepNote } from "@/components/lesson/briefing";

/** Mission Briefing framing for EVPN Multihoming — presentation only; phase objectives also show on question/repair steps, so they never state an answer, the DF winner before the election, or the incident's cause. */
export const EVPNMH_BRIEFING_PHASES: BriefingPhaseDef[] = [
  { phase: { label: "Mission", tone: "cyan" }, objective: "Decide why SERVER-A is attached to two leafs, and how both leafs know it is one attachment.", steps: ["intro", "predict-why-dual-home", "predict-how-know-same-es"] },
  { phase: { label: "Ethernet Segment", tone: "violet" }, objective: "Identify the shared attachment and the identifier both leafs are configured with.", steps: ["ethernet-segment-intro", "esi-inspector", "physical-dual-attachment", "predict-neither-knows-yet"] },
  { phase: { label: "Discovery", tone: "bgp" }, objective: "Follow how each attached leaf learns about the other, and which routes carry that information.", steps: ["type4-intro", "type4-advertise-leaf1", "type4-advertise-leaf2", "type1-intro", "evpn-summary-extended"] },
  { phase: { label: "Election", tone: "warning" }, objective: "Decide which attached leaf forwards BUM traffic onto the segment, and for which scope.", steps: ["duplicate-bum-problem", "predict-which-should-forward", "df-important-note", "df-election-chamber", "df-status-visual", "enter-leaf1-multihoming-pipeline"] },
  { phase: { label: "BUM delivery", tone: "ip" }, objective: "Send one broadcast toward the multihomed segment and count what SERVER-A receives.", steps: ["hostb-sends-bum", "bum-reaches-leaf1-leaf2", "leaf1-df-forwards", "leaf2-ndf-suppresses", "server-a-receives-one-copy"] },
  { phase: { label: "Unicast", tone: "success" }, objective: "Check what the forwarding role does — and does not — control.", steps: ["all-active-unicast-proof", "split-horizon-note", "control-data-both-recap"] },
  { phase: { label: "Failure", tone: "danger" }, objective: "One attachment fails. Follow the control-plane reaction and send the broadcast again.", steps: ["df-failure-event", "re-election", "resend-bum-after-failure", "before-after-failure"] },
  { phase: { label: "Incident", tone: "danger" }, objective: "SERVER-A reports a delivery problem. Find the failing layer.", steps: ["break-intro", "fault-injected", "trouble-intro", "trouble-question", "diagnostic-layers"] },
  { phase: { label: "Repair", tone: "warning" }, objective: "Apply the fix for the layer you identified, then prove it.", steps: ["repair-challenge", "verify-single-df"] },
  { phase: { label: "Complete", tone: "success" }, objective: "Review the route types and the multihoming roles.", steps: ["type-summary", "complete"] },
];

export const EVPNMH_BRIEFING_NOTES: Partial<Record<string, BriefingStepNote>> = {
  "type4-advertise-leaf1": { doingNow: "Control plane: a BGP UPDATE carrying LEAF1's Type-4 Ethernet Segment route, imported via its ES-Import Route Target." },
  "type4-advertise-leaf2": { doingNow: "Control plane: LEAF2's Type-4 route for the same ESI — each leaf now knows its ES peer." },
  "type1-intro": { doingNow: "LEAF1 holds Ethernet A-D routes in two forms: per-ES and per-EVI." },
  "df-election-chamber": { doingNow: "The default election orders candidate IPs numerically, assigns ordinals, then applies VLAN mod N." },
  "bum-reaches-leaf1-leaf2": { doingNow: "LEAF3 makes one VXLAN copy per VTEP in the VNI's flood list — replication ignores the forwarding role." },
  "leaf2-ndf-suppresses": { doingNow: "A deliberate forwarding decision on the segment — not a dropped or malformed packet." },
  "all-active-unicast-proof": { takeaway: "The BUM forwarding role never switches off ordinary unicast in All-Active mode." },
  "df-failure-event": { doingNow: "Only one leaf's attachment to the segment fails — the leaf itself stays healthy." },
  "resend-bum-after-failure": { doingNow: "Flood-list membership is unchanged; watch what each copy can still do." },
  "fault-injected": { doingNow: "A controlled, educational fault is injected after the segment is fully restored." },
  "trouble-intro": { doingNow: "Links, underlay, BGP EVPN, the ESI and the discovery routes all report healthy." },
  "repair-challenge": { doingNow: "Choose the change that fixes the cause you identified." },
  "verify-single-df": { takeaway: "Repair proven with a real broadcast." },
};
