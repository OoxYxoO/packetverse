import type { BriefingPhaseDef, BriefingStepNote } from "@/components/lesson/briefing";

/** Mission Briefing framing for EVPN + VXLAN Foundations — presentation only; the scenario's label/narrative stay the source of truth. Phase objectives also show on question/repair steps, so they never state an answer. */
export const EVPNV_BRIEFING_PHASES: BriefingPhaseDef[] = [
  { phase: { label: "Mission", tone: "cyan" }, objective: "Find out how two hosts in one VLAN can talk across a routed fabric.", steps: ["intro", "predict-l2-problem"] },
  { phase: { label: "VTEP + VNI", tone: "violet" }, objective: "Meet the tunnel endpoints and the fabric-wide segment identifier.", steps: ["vtep-vni-intro", "vlan-vni-mapping", "predict-vni-mapping", "predict-udp-port"] },
  { phase: { label: "VXLAN data plane", tone: "ip" }, objective: "Follow one tenant frame through encapsulation, the underlay and decapsulation.", steps: ["send-host-a", "leaf1-ingress", "spine-forward", "leaf2-egress", "delivered-host-b"] },
  { phase: { label: "The open question", tone: "warning" }, objective: "Work out what LEAF1 would need to know without flooding.", steps: ["limitation-question", "predict-flood-limitation"] },
  { phase: { label: "EVPN control plane", tone: "bgp" }, objective: "Build and advertise a Type 2 route, field by field.", steps: ["evpn-intro", "host-b-local-learn", "evpn-type2-created", "route-builder-rd", "route-builder-rt", "route-builder-nexthop", "evpn-update-sent", "evpn-route-received", "remote-mac-installed", "before-after-recap"] },
  { phase: { label: "Same path, real route", tone: "ip" }, objective: "Send the frame again, now resolved from an EVPN-learned entry.", steps: ["resend-host-a", "leaf1-ingress-confirmed", "spine-forward-confirmed", "leaf2-egress-confirmed", "journey-recap"] },
  { phase: { label: "Incident", tone: "danger" }, objective: "HOST-A can no longer reach HOST-B. Find the failing layer.", steps: ["break-intro", "fault-injected", "trouble-intro", "trouble-question", "diagnostic-layers"] },
  { phase: { label: "Repair", tone: "warning" }, objective: "Apply the fix for the layer you identified, then prove it.", steps: ["repair-challenge", "verify-dataplane"] },
  { phase: { label: "Complete", tone: "success" }, objective: "Review the data plane and the control plane side by side.", steps: ["complete"] },
];

export const EVPNV_BRIEFING_NOTES: Partial<Record<string, BriefingStepNote>> = {
  "vtep-vni-intro": { doingNow: "VTEPs are the leaf loopbacks; SPINE1 is not a VTEP." },
  "vlan-vni-mapping": { doingNow: "Each leaf maps its local VLAN to the fabric-wide VNI." },
  "leaf1-ingress": { doingNow: "LEAF1 wraps the original frame: Outer IP (VTEP → VTEP) / UDP / VXLAN (VNI) / original frame." },
  "spine-forward": { doingNow: "SPINE1 forwards on the outer destination IP only." },
  "leaf2-egress": { doingNow: "LEAF2 strips the outer headers and delivers the unchanged frame." },
  "evpn-type2-created": { doingNow: "LEAF2 builds a Type 2 route for HOST-B: MAC, IP, VNI, RD, RT and a next hop." },
  "evpn-update-sent": { doingNow: "Control plane: a BGP UPDATE in the L2VPN EVPN family — not a data packet." },
  "remote-mac-installed": { takeaway: "Remote MAC learned from the control plane, not from flooding." },
  "journey-recap": { takeaway: "The data path never changed — only how LEAF1 knew where to send it." },
  "fault-injected": { doingNow: "A configuration change is applied on LEAF1." },
  "trouble-intro": { doingNow: "Session, underlay and VTEP reachability all report healthy." },
  "repair-challenge": { doingNow: "Choose the change that fixes the cause you identified." },
  "verify-dataplane": { takeaway: "Repair proven with a real frame, not only a table." },
};
