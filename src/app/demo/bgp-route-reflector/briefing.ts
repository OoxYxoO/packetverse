import type { BriefingPhaseDef, BriefingStepNote } from "@/components/lesson/briefing";

/** Mission Briefing framing for the BGP Route Reflector lesson — presentation only. */
export const RR_BRIEFING_PHASES: BriefingPhaseDef[] = [
  { phase: { label: "Mission", tone: "cyan" }, objective: "Scale iBGP inside AS 65000 without a full mesh.", steps: ["intro"] },
  { phase: { label: "Scaling problem", tone: "danger" }, objective: "See why a full iBGP mesh stops scaling.", steps: ["show-fullmesh", "predict-session-count-4", "scale-demo", "predict-session-count-10", "scale-table", "predict-scale-problem"] },
  { phase: { label: "Split horizon", tone: "bgp" }, objective: "Understand the iBGP rule that forces the full mesh.", steps: ["ibgp-share-intro", "predict-split-horizon", "show-split-horizon-blocked", "why-split-horizon"] },
  { phase: { label: "Reflection", tone: "violet" }, objective: "Follow PE1's route through RR1's reflection pipeline.", steps: ["introduce-rr", "predict-rr-is-bgp", "pe1-advertises-rr", "rr-receives", "rr-bestpath", "rr-reflection-decision", "rr-reflects", "predict-what-rr-added"] },
  { phase: { label: "Reflection rules", tone: "violet" }, objective: "Learn who a Route Reflector reflects to, and who it doesn't.", steps: ["rule-client-to-rr", "rule-rr-to-client", "rule-nonclient-to-rr", "rule-rr-to-nonclient", "predict-rule-client-reflected", "predict-rule-nonclient-to-client", "predict-rule-nonclient-to-nonclient"] },
  { phase: { label: "Loop prevention", tone: "warning" }, objective: "See how ORIGINATOR_ID and CLUSTER_LIST keep reflection loop-free.", steps: ["originator-id-explain", "predict-originator-id-purpose", "cluster-id-explain", "introduce-rr2", "reflect-through-two-rr", "predict-cluster-list-purpose"] },
  { phase: { label: "Boundaries", tone: "cyan" }, objective: "Separate what a Route Reflector does from what it doesn't.", steps: ["toggle-intro", "rr-does-not", "predict-rr-does-not", "reconnect-l3vpn-intro", "vpnv4-through-rr", "predict-traffic-through-rr", "control-vs-data-plane"] },
  { phase: { label: "Troubleshooting", tone: "danger" }, objective: "Find and repair why PE3 is missing 10.1.1.0/24.", steps: ["fault-intro", "fault-explain", "predict-troubleshoot", "repair-challenge", "verify-fix"] },
  { phase: { label: "Challenge", tone: "violet" }, objective: "Redesign the 6-PE control plane with Route Reflectors.", steps: ["challenge-intro", "challenge-select", "challenge-complete"] },
  { phase: { label: "Complete", tone: "success" }, objective: "Review how reflection scaled the provider.", steps: ["complete"] },
];

export const RR_BRIEFING_NOTES: Partial<Record<string, BriefingStepNote>> = {
  intro: { doingNow: "PE1–PE4 run a full iBGP mesh inside AS 65000." },
  "show-fullmesh": { doingNow: "Every PE has a direct iBGP session to every other PE." },
  "scale-table": { takeaway: "Sessions grow as n(n−1)/2: 4 → 6, 10 → 45, 100 → 4,950." },
  "ibgp-share-intro": { doingNow: "PE1 advertises 10.1.1.0/24 to PE2 over their direct iBGP session." },
  "show-split-horizon-blocked": { doingNow: "PE2 keeps the route to itself. PE3 never hears it.", takeaway: "iBGP-learned routes aren't passed to another ordinary iBGP peer." },
  "introduce-rr": { doingNow: "PE1–PE4 now peer only with RR1, as its clients." },
  "pe1-advertises-rr": { doingNow: "PE1 sends 10.1.1.0/24 to RR1 as a normal iBGP UPDATE." },
  "rr-receives": { doingNow: "RR1 adds the client's route to its BGP table." },
  "rr-bestpath": { doingNow: "Ordinary best-path selection runs; one candidate wins trivially." },
  "rr-reflection-decision": { doingNow: "RR1 checks where the route came from: a client." },
  "rr-reflects": { doingNow: "RR1 sends the route to PE2, PE3 and PE4 with two attributes added.", takeaway: "NEXT_HOP is unchanged. Only loop-prevention attributes are added." },
  "rule-rr-to-nonclient": { takeaway: "Non-client-learned routes go to clients only." },
  "originator-id-explain": { doingNow: "RR1 stamps ORIGINATOR_ID = 1.1.1.1 on the reflected route." },
  "cluster-id-explain": { doingNow: "RR1 appends its cluster ID 100.100.100.100 to CLUSTER_LIST." },
  "introduce-rr2": { doingNow: "RR2 (cluster 200.200.200.200) now serves PE3 and PE4; RR1 and RR2 peer as non-clients." },
  "reflect-through-two-rr": { doingNow: "The route crosses both clusters and arrives with a two-entry CLUSTER_LIST." },
  "vpnv4-through-rr": { doingNow: "PE2's VPNv4 route (RD 65001:102, label 24002) is reflected to PE1 without RR1 interpreting it." },
  "control-vs-data-plane": { takeaway: "The RR sits in the control plane only; customer traffic never passes through it." },
  "fault-intro": { doingNow: "PE3's session on RR2 was reconfigured without the client flag." },
  "fault-explain": { doingNow: "The session is still up, but PE3 no longer receives the route." },
  "predict-troubleshoot": { doingNow: "The interface, IGP, TCP/179, the session and best-path selection are all healthy. Decide what is actually wrong." },
  "repair-challenge": { doingNow: "Choose the repair for RR2's session with PE3." },
  "verify-fix": { doingNow: "PE3 has 10.1.1.0/24 again, with ORIGINATOR_ID and CLUSTER_LIST intact." },
  "challenge-select": { doingNow: "Weigh each design on coverage, cross-cluster distribution, redundancy and session count." },
};
