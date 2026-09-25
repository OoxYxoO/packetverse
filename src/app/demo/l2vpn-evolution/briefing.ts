import type { BriefingPhaseDef, BriefingStepNote } from "@/components/lesson/briefing";

/** Mission Briefing framing for the L2VPN Evolution capstone — presentation only; the scenario's label/narrative stay the source of truth. Phase objectives also show on question/challenge steps, so they never state an answer or rank architectures. */
export const EVO_BRIEFING_PHASES: BriefingPhaseDef[] = [
  { phase: { label: "Engineering brief", tone: "cyan" }, objective: "Compare five L2VPN architectures on the same customer and the same questions.", steps: ["intro", "cust-a-requirement", "why-all-exist-thesis"] },
  { phase: { label: "VPWS", tone: "mpls" }, objective: "Recall what a point-to-point pseudowire provides, and where it stops.", steps: ["vpws-topology", "vpws-signaling-recap", "predict-p-router-mac", "vpws-scaling-question"] },
  { phase: { label: "LDP-VPLS", tone: "violet" }, objective: "See how a mesh of pseudowires becomes a multipoint LAN, and what it costs.", steps: ["vpls-topology", "vpls-control-data-split", "vpls-first-frame-unknown", "vpls-source-learn", "vpls-known-unicast", "predict-vpws-p2p", "vpls-scaling-question"] },
  { phase: { label: "BGP-VPLS", tone: "bgp" }, objective: "Identify exactly which function BGP-VPLS changes, and which it leaves alone.", steps: ["bgp-vpls-intro", "bgp-vpls-control-vs-service", "bgp-vpls-anti-confusion", "predict-bgp-vpls-mac", "bgp-vpls-label-block-recap", "predict-hvpls-bgpvpls-orthogonal"] },
  { phase: { label: "Incident", tone: "danger" }, objective: "An engineer believes a BGP route is missing. Work out what is really happening.", steps: ["incident-setup", "incident-symptoms", "incident-diagnostic-ladder", "trouble-question-mental-model", "repair-challenge", "verify-dataplane", "incident-evpn-equivalent"] },
  { phase: { label: "H-VPLS", tone: "warning" }, objective: "See what hierarchy changes in the service topology, and what it doesn't.", steps: ["hvpls-transition-question", "hvpls-topology", "hvpls-architectural-lesson", "predict-hvpls-mac-learning", "hvpls-split-horizon", "hvpls-scaling-comparison"] },
  { phase: { label: "EVPN", tone: "success" }, objective: "Compare how EVPN distributes Ethernet reachability with the traditional models.", steps: ["evpn-transition-question", "evpn-mental-model", "predict-evpn-fundamental-change", "evpn-type2-recap", "evpn-ce3-install", "evpn-vs-traditional-signature", "evpn-bum-comparison", "predict-evpn-eliminates-bum", "evpn-unknown-unicast-comparison", "evpn-mac-mobility-comparison", "evpn-multihoming-comparison", "evpn-failure-convergence"] },
  { phase: { label: "Comparison", tone: "violet" }, objective: "Put every property side by side and see who owns which state.", steps: ["service-label-comparison", "predict-transport-independence", "architecture-comparison-table", "state-ownership-table", "conceptual-timeline"] },
  { phase: { label: "Decision labs", tone: "cyan" }, objective: "Match each requirement set to an architecture using the comparison dimensions.", steps: ["decision-lab-a", "decision-lab-b", "decision-lab-c", "decision-lab-d", "decision-lab-e"] },
  { phase: { label: "Challenge", tone: "violet" }, objective: "Choose an architecture that satisfies every stated requirement at once.", steps: ["engineer-challenge"] },
  { phase: { label: "Recap", tone: "success" }, objective: "Review why five architectures exist and what each changed.", steps: ["complete"] },
];

export const EVO_BRIEFING_NOTES: Partial<Record<string, BriefingStepNote>> = {
  "cust-a-requirement": { doingNow: "CE1, CE2, CE3 of CUST-A (192.168.100.0/24) are reused for every architecture." },
  "vpws-signaling-recap": { doingNow: "Data plane recap: transport 102 (S0) over PW label 25001 (S1)." },
  "predict-p-router-mac": { doingNow: "Think about which label a P router ever reads." },
  "vpws-scaling-question": { takeaway: "Point-to-point wires don't add up to one broadcast domain." },
  "vpls-first-frame-unknown": { doingNow: "Data plane: CE2's MAC is unknown at PE1, so the frame is replicated to both PEs." },
  "vpls-source-learn": { doingNow: "Data plane: PE1 learns CE2 from the source MAC of the reply." },
  "vpls-known-unicast": { doingNow: "Data plane: known unicast goes to PE2 only." },
  "predict-vpws-p2p": { doingNow: "Recall each architecture's service type." },
  "bgp-vpls-control-vs-service": { doingNow: "Control: PEs ↔ RR1. Service: PE full mesh." },
  "predict-bgp-vpls-mac": { doingNow: "Look back at what the BGP-VPLS NLRI contains." },
  "bgp-vpls-label-block-recap": { takeaway: "Label = Label Base + VE ID − VBO; MAC learning unchanged." },
  "predict-hvpls-bgpvpls-orthogonal": { doingNow: "Ask whether the two change the same thing." },
  "incident-symptoms": { doingNow: "Membership, labels and mesh are healthy; only an FDB entry is missing." },
  "trouble-question-mental-model": { doingNow: "Compare the symptoms with how this architecture learns MACs." },
  "repair-challenge": { doingNow: "Choose how to proceed. Wrong choices explain why." },
  "verify-dataplane": { doingNow: "Data plane: CE1 → CE3 again." },
  "hvpls-split-horizon": { takeaway: "Spoke → mesh ✓, mesh → spoke ✓, mesh → mesh ✕." },
  "predict-hvpls-mac-learning": { doingNow: "Ask what H-VPLS restructures." },
  "evpn-ce3-install": { doingNow: "Control plane: PE3 advertises CE3 in an EVPN Type 2 route; PE1 installs it." },
  "predict-evpn-fundamental-change": { doingNow: "Compare where MAC reachability comes from in each model." },
  "predict-evpn-eliminates-bum": { doingNow: "Separate Type 3 membership from the BUM traffic itself." },
  "predict-transport-independence": { doingNow: "Compare the outer label in every architecture." },
  "architecture-comparison-table": { takeaway: "Each architecture changed one dimension; none is best for every requirement." },
  "decision-lab-a": { doingNow: "Read the requirement, then check each architecture's service type." },
  "engineer-challenge": { doingNow: "Check every requirement against every architecture before choosing." },
};
