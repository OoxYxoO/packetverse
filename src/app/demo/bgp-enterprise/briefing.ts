import type { BriefingPhaseDef, BriefingStepNote } from "@/components/lesson/briefing";

/** Mission Briefing framing for the BGP Enterprise lesson — presentation only. */
export const BGP_BRIEFING_PHASES: BriefingPhaseDef[] = [
  { phase: { label: "Mission", tone: "cyan" }, objective: "Reach 203.0.113.0/24 (AS65030) from the enterprise AS65001.", steps: ["intro", "predict-need-bgp"] },
  { phase: { label: "Transport", tone: "tcp" }, objective: "Open the TCP/179 connection BGP needs between R1 and R3.", steps: ["tcp-intro", "predict-tcp-first", "tcp-syn", "tcp-synack", "tcp-ack"] },
  { phase: { label: "Session", tone: "bgp" }, objective: "Bring the BGP session from Idle to Established.", steps: ["bgp-connect", "bgp-open-r1", "predict-verify", "bgp-open-r3", "predict-keepalive", "bgp-keepalive", "secondary-sessions"] },
  { phase: { label: "Routes", tone: "bgp" }, objective: "Learn 203.0.113.0/24 from both ISPs and share it inside AS65001.", steps: ["update-r3", "update-r4", "ibgp-share"] },
  { phase: { label: "Best path", tone: "success" }, objective: "Pick one best path per router and install it.", steps: ["predict-bestpath-r1", "bestpath-r1", "install-r1", "bestpath-r2", "install-r2"] },
  { phase: { label: "Troubleshooting", tone: "danger" }, objective: "Find out why R2 can't use a route it can see.", steps: ["trouble-intro", "trouble-question", "trouble-fix"] },
  { phase: { label: "Policy", tone: "violet" }, objective: "See how policy attributes change the best-path decision.", steps: ["prepend-intro", "prepend-apply", "localpref-intro", "localpref-change"] },
  { phase: { label: "Challenge", tone: "violet" }, objective: "Make AS65001 prefer ISP-B without shutting any interface.", steps: ["challenge-intro", "challenge"] },
  { phase: { label: "Complete", tone: "success" }, objective: "Review how attributes and policy decided the path.", steps: ["complete"] },
];

export const BGP_BRIEFING_NOTES: Partial<Record<string, BriefingStepNote>> = {
  intro: { doingNow: "R1 and R2 know only their connected networks. No BGP session exists yet." },
  "tcp-syn": { doingNow: "R1 opens a TCP connection to R3 on port 179." },
  "tcp-synack": { doingNow: "R3 acknowledges the connection request." },
  "tcp-ack": { doingNow: "The handshake completes. BGP now has a transport.", takeaway: "BGP always rides on TCP port 179." },
  "bgp-connect": { doingNow: "TCP is up, so BGP moves from Idle to Connect." },
  "bgp-open-r1": { doingNow: "R1's OPEN carries AS65001, its Hold Time and BGP ID 1.1.1.1." },
  "bgp-open-r3": { doingNow: "R3 answers with its own OPEN. The session is now in OpenConfirm." },
  "bgp-keepalive": { doingNow: "KEEPALIVEs confirm both OPENs.", takeaway: "OPEN, then KEEPALIVE, then Established." },
  "secondary-sessions": { doingNow: "R2↔R4 (eBGP) and R1↔R2 (iBGP) come up the same way." },
  "update-r3": { doingNow: "R3 advertises 203.0.113.0/24 with AS_PATH 65010 65030." },
  "update-r4": { doingNow: "R4 advertises the same prefix with AS_PATH 65020 65100 65030." },
  "ibgp-share": { doingNow: "R1 and R2 exchange their external paths over iBGP.", takeaway: "Each router now holds two candidate paths." },
  "bestpath-r1": { doingNow: "R1 walks the lesson's best-path order until one step separates the paths." },
  "install-r1": { takeaway: "With LOCAL_PREF tied, the shorter AS_PATH wins." },
  "bestpath-r2": { doingNow: "R2 compares its own ISP-B path with the ISP-A path relayed by R1." },
  "install-r2": { doingNow: "R2 installs the ISP-A path, but its NEXT_HOP is still 192.0.2.2." },
  "trouble-intro": { doingNow: "The session is up and the prefix is present, yet traffic can't use it." },
  "trouble-question": { doingNow: "Inspect the BGP table, routing table, neighbor status and NEXT_HOP before you answer." },
  "trouble-fix": { doingNow: "next-hop-self rewrites NEXT_HOP to the iBGP neighbor's own address.", takeaway: "A BGP route is only usable if its NEXT_HOP resolves." },
  "prepend-apply": { doingNow: "ISP-B's path arrives with 65020 prepended twice more." },
  "localpref-change": { doingNow: "ISP-B's LOCAL_PREF is set to 200 for the whole AS.", takeaway: "LOCAL_PREF is compared before AS_PATH." },
  challenge: { doingNow: "Pick a LOCAL_PREF for ISP-B and watch which path becomes best." },
};
