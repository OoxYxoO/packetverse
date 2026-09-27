import type { BriefingPhaseDef, BriefingStepNote } from "@/components/lesson/briefing";

/** Mission Briefing framing for EVPN Route Type 5 — presentation only; phase objectives also show on question/repair steps, so they never state an answer. */
export const EVPN5_BRIEFING_PHASES: BriefingPhaseDef[] = [
  { phase: { label: "Mission", tone: "cyan" }, objective: "Decide how a whole IP prefix can be advertised across the fabric.", steps: ["intro", "predict-prefix-vs-host", "type5-intro", "type2-vs-type3-vs-type5"] },
  { phase: { label: "Build the route", tone: "bgp" }, objective: "Turn LEAF3's VRF prefix into an EVPN route and advertise it.", steps: ["prefix-on-leaf3", "create-type5-route", "type5-route-object", "type5-bgp-update"] },
  { phase: { label: "Import", tone: "violet" }, objective: "Decide whether LEAF1's VRF imports the route, and what it installs.", steps: ["enter-leaf1-type5-import", "predict-rt-import", "vrf-route-installed", "evpn-table-recap"] },
  { phase: { label: "Forwarding", tone: "ip" }, objective: "Send traffic into the prefix over the routed transport.", steps: ["host-a-sends", "enter-leaf1-forwarding", "packet-transformation", "spine-forward-type5", "leaf3-egress-type5", "control-data-recap"] },
  { phase: { label: "Longest match", tone: "ospf" }, objective: "A second, overlapping route appears. Decide which one is used.", steps: ["lpm-intro", "predict-lpm", "lpm-recap"] },
  { phase: { label: "Incident", tone: "danger" }, objective: "The prefix becomes unreachable. Find the failing layer.", steps: ["break-intro", "fault-injected", "trouble-intro", "trouble-question", "diagnostic-layers"] },
  { phase: { label: "Repair", tone: "warning" }, objective: "Apply the fix for the layer you identified, then prove it.", steps: ["repair-challenge", "verify-dataplane"] },
  { phase: { label: "Complete", tone: "success" }, objective: "Review prefix routes, import, resolution and forwarding.", steps: ["complete"] },
];

export const EVPN5_BRIEFING_NOTES: Partial<Record<string, BriefingStepNote>> = {
  "create-type5-route": { doingNow: "LEAF3 builds a Type 5 route: prefix, RD, RT, next-hop VTEP and L3 VNI." },
  "type5-bgp-update": { doingNow: "Control plane: a BGP UPDATE carrying the Type 5 route — not a data packet." },
  "vrf-route-installed": { doingNow: "LEAF1's VRF now holds the prefix via LEAF3." },
  "packet-transformation": { doingNow: "LEAF1 routes, rewrites to Router MACs and encapsulates with the L3 VNI." },
  "spine-forward-type5": { doingNow: "SPINE1 forwards on the outer destination IP only." },
  "lpm-recap": { takeaway: "Longest-prefix match is ordinary routing; EVPN only supplied the candidates." },
  "fault-injected": { doingNow: "A change is made in the fabric." },
  "trouble-intro": { doingNow: "BGP EVPN, the UPDATE, RT import and VRF policy all report healthy." },
  "repair-challenge": { doingNow: "Choose the change that fixes the cause you identified." },
  "verify-dataplane": { takeaway: "Forwarding proven with a real packet." },
};
