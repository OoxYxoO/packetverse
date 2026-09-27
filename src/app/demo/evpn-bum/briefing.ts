import type { BriefingPhaseDef, BriefingStepNote } from "@/components/lesson/briefing";

/** Mission Briefing framing for EVPN BUM + Route Type 3 — presentation only; phase objectives also show on question/repair steps, so they never state an answer. */
export const EVPNB_BRIEFING_PHASES: BriefingPhaseDef[] = [
  { phase: { label: "Mission", tone: "cyan" }, objective: "Work out where a frame with no single destination should go.", steps: ["intro", "predict-bum-problem", "bum-intro", "predict-flood-list-source"] },
  { phase: { label: "Type 3 / IMET", tone: "bgp" }, objective: "Learn how each VTEP announces its membership in a VNI.", steps: ["type3-intro", "type3-advertised", "flood-list-built", "predict-type2-vs-type3"] },
  { phase: { label: "Ingress replication", tone: "ip" }, objective: "Follow one broadcast frame as the ingress VTEP replicates it.", steps: ["send-broadcast", "leaf1-bum-classify", "spine-forward-bum", "leaves-decap-bum"] },
  { phase: { label: "Recap", tone: "violet" }, objective: "Connect the control plane that built the list with the data plane that used it.", steps: ["replication-recap", "control-data-recap"] },
  { phase: { label: "Incident", tone: "danger" }, objective: "One site stops receiving broadcast traffic. Find the failing layer.", steps: ["break-intro", "fault-injected", "trouble-intro", "trouble-question", "diagnostic-layers"] },
  { phase: { label: "Repair", tone: "warning" }, objective: "Apply the fix for the layer you identified, then prove it.", steps: ["repair-challenge", "verify-dataplane"] },
  { phase: { label: "Complete", tone: "success" }, objective: "Review membership, replication and the fault you fixed.", steps: ["complete"] },
];

export const EVPNB_BRIEFING_NOTES: Partial<Record<string, BriefingStepNote>> = {
  "type3-advertised": { doingNow: "Every leaf advertises one Type 3 route for the VNI: RD, RT and its own VTEP." },
  "flood-list-built": { takeaway: "A flood list is built from VNI membership — no host MAC involved." },
  "leaf1-bum-classify": { doingNow: "LEAF1 classifies the frame as BUM and creates one VXLAN copy per flood-list entry." },
  "spine-forward-bum": { doingNow: "SPINE1 routes each copy on its own outer destination IP." },
  "leaves-decap-bum": { doingNow: "Each remote leaf decapsulates its own copy and delivers locally." },
  "replication-recap": { takeaway: "One frame in, one VXLAN copy per remote VTEP out — made by the ingress VTEP." },
  "fault-injected": { doingNow: "A configuration change is applied on one leaf." },
  "trouble-intro": { doingNow: "Session, underlay and unicast reachability all report healthy." },
  "repair-challenge": { doingNow: "Choose the change that fixes the cause you identified." },
  "verify-dataplane": { takeaway: "Replication proven with a real broadcast, not only a table." },
};
