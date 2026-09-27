import type { BriefingPhaseDef, BriefingStepNote } from "@/components/lesson/briefing";

/** Mission Briefing framing for EVPN IRB + Distributed Anycast Gateway — presentation only; phase objectives also show on question/repair steps, so they never state an answer. */
export const EVPNI_BRIEFING_PHASES: BriefingPhaseDef[] = [
  { phase: { label: "Mission", tone: "cyan" }, objective: "Decide what has to happen when the destination is in another subnet.", steps: ["intro", "predict-different-subnet", "predict-gateway-target", "predict-gateway-location"] },
  { phase: { label: "Anycast gateway", tone: "violet" }, objective: "Find out where each host's default gateway actually lives.", steps: ["anycast-gateway-intro", "anycast-gateway-object", "predict-gateway-mac-design"] },
  { phase: { label: "ARP to the gateway", tone: "ip" }, objective: "Resolve the gateway MAC and look at the frame HOST-A really sends.", steps: ["arp-intro", "arp-request", "arp-reply", "packet-before-routing"] },
  { phase: { label: "Ingress routing", tone: "bgp" }, objective: "Route inside the VRF and pick the transport identifier for routed traffic.", steps: ["enter-leaf1-irb", "predict-l2-vs-l3-vni", "type2-hostb-reachability", "vrf-routing-decision"] },
  { phase: { label: "L3 VNI transport", tone: "ip" }, objective: "Follow the routed packet across the fabric and out to HOST-B.", steps: ["packet-transformation", "rmac-advanced", "spine-forward-irb", "leaf3-egress-irb", "packet-after-leaf3", "delivered-hostb"] },
  { phase: { label: "Recap", tone: "violet" }, objective: "Compare bridging with routing, and symmetric with asymmetric IRB.", steps: ["control-data-recap", "same-subnet-vs-intersubnet", "asymmetric-vs-symmetric"] },
  { phase: { label: "Incident", tone: "danger" }, objective: "Inter-subnet traffic fails while same-subnet traffic works. Find the failing layer.", steps: ["break-intro", "fault-injected", "same-subnet-still-works", "trouble-intro", "trouble-question", "diagnostic-layers"] },
  { phase: { label: "Repair", tone: "warning" }, objective: "Apply the fix for the layer you identified, then prove it.", steps: ["repair-challenge", "verify-dataplane"] },
  { phase: { label: "Complete", tone: "success" }, objective: "Review the local gateway, both routing stages and the L3 VNI.", steps: ["complete"] },
];

export const EVPNI_BRIEFING_NOTES: Partial<Record<string, BriefingStepNote>> = {
  "anycast-gateway-intro": { doingNow: "LEAF1 and LEAF2 provide the same gateway IP and MAC for VLAN 10." },
  "arp-reply": { doingNow: "LEAF1 answers the gateway ARP locally." },
  "packet-before-routing": { doingNow: "Ethernet destination = gateway; IP destination = HOST-B." },
  "type2-hostb-reachability": { doingNow: "Control plane: LEAF3's Type 2 route for HOST-B, including symmetric-IRB route attributes." },
  "packet-transformation": { doingNow: "LEAF1 routes, rewrites the inner Ethernet to Router MACs and encapsulates with the L3 VNI." },
  "spine-forward-irb": { doingNow: "SPINE1 forwards on the outer destination IP only." },
  "leaf3-egress-irb": { doingNow: "LEAF3 decapsulates, routes again in the VRF and delivers into VLAN 20." },
  "packet-after-leaf3": { takeaway: "Ethernet headers changed at each routed boundary; the IP conversation did not." },
  "fault-injected": { doingNow: "A configuration change is applied on one leaf." },
  "trouble-intro": { doingNow: "Gateway, Type 2 reachability and same-subnet traffic all report healthy." },
  "repair-challenge": { doingNow: "Choose the change that fixes the cause you identified." },
  "verify-dataplane": { takeaway: "Routed delivery proven with a real packet." },
};
