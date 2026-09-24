import type { BriefingPhaseDef, BriefingStepNote } from "@/components/lesson/briefing";

/** Mission Briefing framing for the OSPF lesson — presentation only; the scenario's label/narrative stay the source of truth. */
export const OSPF_BRIEFING_PHASES: BriefingPhaseDef[] = [
  { phase: { label: "Mission", tone: "cyan" }, objective: "Let OSPF discover the network so R1 can reach R4 without static routes.", steps: ["intro"] },
  { phase: { label: "Adjacency", tone: "ospf" }, objective: "Bring R1 and R2 from DOWN to 2-WAY using Hellos.", steps: ["hello-1", "predict-init", "r2-to-init", "predict-2way", "r1-to-2way", "predict-p2p-next"] },
  { phase: { label: "Database sync", tone: "violet" }, objective: "Synchronize R1's and R2's link-state databases until the adjacency is FULL.", steps: ["exstart", "exchange", "loading", "lsu-install", "full", "mesh-forms"] },
  { phase: { label: "Flooding", tone: "ospf" }, objective: "Get every Router-LSA to every router so all LSDBs match.", steps: ["flood-lsas", "spf-why"] },
  { phase: { label: "SPF", tone: "success" }, objective: "Compute R1's shortest path to R4 from the shared LSDB.", steps: ["spf-start", "spf-complete"] },
  { phase: { label: "Reconvergence", tone: "warning" }, objective: "See how one cost change re-floods and moves the best path.", steps: ["cost-change-intro", "cost-changed", "lsa-reflooded", "spf-rerun"] },
  { phase: { label: "Troubleshooting", tone: "danger" }, objective: "Find and fix why R1 and R2 stopped forming an adjacency.", steps: ["break-intro", "fault-injected", "troubleshoot-question", "fault-fixed", "adjacency-reforms"] },
  { phase: { label: "Challenge", tone: "violet" }, objective: "Steer R1's path to R4 through R3 by changing only one cost.", steps: ["challenge-intro", "challenge"] },
  { phase: { label: "Complete", tone: "success" }, objective: "Review what OSPF did on its own.", steps: ["complete"] },
];

export const OSPF_BRIEFING_NOTES: Partial<Record<string, BriefingStepNote>> = {
  intro: { doingNow: "All four adjacencies are DOWN. Nothing has been exchanged yet." },
  "hello-1": { doingNow: "R1 multicasts a Hello to 224.0.0.5. It hasn't heard anyone yet, so its neighbor list is empty." },
  "r2-to-init": { doingNow: "R2 records R1 in INIT and replies with a Hello that now lists R1." },
  "r1-to-2way": { doingNow: "R1 sees 1.1.1.1 listed in R2's Hello, so two-way communication is proven.", takeaway: "Seeing your own Router ID in a neighbor's Hello means 2-WAY." },
  exstart: { doingNow: "Empty DBDs negotiate master/slave. R2 (2.2.2.2) wins with the higher Router ID." },
  exchange: { doingNow: "R2 leads the DBD exchange, listing LSA headers." },
  loading: { doingNow: "R1 sends an LSR for the Router-LSA it is missing." },
  "lsu-install": { doingNow: "R2 answers with an LSU carrying its full Router-LSA." },
  full: { doingNow: "R1 acknowledges. The databases match and the adjacency is FULL.", takeaway: "Headers first, then only the missing LSAs." },
  "mesh-forms": { doingNow: "The same sequence forms R1↔R3, R2↔R4 and R3↔R4." },
  "flood-lsas": { doingNow: "Router-LSAs are flooded hop by hop until every router holds all four.", takeaway: "Every LSDB in the area ends up identical." },
  "spf-start": { doingNow: "R1 compares the cumulative cost of its two candidate paths to R4." },
  "spf-complete": { takeaway: "The lowest total cost wins: R1 → R2 → R4 costs 20." },
  "cost-changed": { doingNow: "R1's cost toward R2 becomes 50, and R1 originates a new Router-LSA." },
  "lsa-reflooded": { doingNow: "The new LSA replaces the stale copy on every router." },
  "spf-rerun": { takeaway: "Change a cost, re-flood, re-run SPF: the path moves by itself." },
  "fault-injected": { doingNow: "R2's interface toward R1 has been moved into Area 1, and the adjacency drops." },
  "troubleshoot-question": { doingNow: "Compare the interfaces, the Hellos and the neighbor table before you answer." },
  "fault-fixed": { doingNow: "R2's interface is back in Area 0." },
  "adjacency-reforms": { doingNow: "Hellos are accepted again and the adjacency returns to FULL." },
  challenge: { doingNow: "Pick a cost for R1 → R2 and watch R1's route to R4." },
};
