import type { BriefingPhaseDef, BriefingStepNote } from "@/components/lesson/briefing";

/** Mission Briefing — every step in exactly one phase; the incident's cause is never named before its question. */
export const ISIS_BRIEFING_PHASES: BriefingPhaseDef[] = [
  { phase: { label: "Observe", tone: "cyan" }, objective: "Meet a four-router provider core with no routing yet.", steps: ["intro"] },
  { phase: { label: "Identify", tone: "violet" }, objective: "Read each router's NET and level design.", steps: ["net-decomp", "predict-net", "levels"] },
  { phase: { label: "Discover", tone: "ethernet" }, objective: "See what IS-IS actually travels in.", steps: ["predict-ip", "encapsulation", "predict-pdu"] },
  { phase: { label: "Form Adjacency", tone: "success" }, objective: "Bring P1–P2 up with the three-way handshake.", steps: ["iih-p1-down", "iih-p2-init", "predict-3way", "iih-p1-up", "iih-p2-up", "all-adjacencies"] },
  { phase: { label: "Flood", tone: "warning" }, objective: "Carry PE2's LSP to every router.", steps: ["predict-lsp", "lsp-pe2", "lsp-p2", "psnp-ack", "lsp-p1", "lsp-pe1", "others-flood"] },
  { phase: { label: "Synchronize", tone: "ip" }, objective: "Compare databases with a CSNP.", steps: ["predict-csnp", "csnp"] },
  { phase: { label: "Build LSDB", tone: "cyan" }, objective: "One consistent Level-2 database everywhere.", steps: ["lsdb"] },
  { phase: { label: "Run SPF", tone: "violet" }, objective: "Compute shortest paths and install routes.", steps: ["predict-metric", "spf-pe1", "rib"] },
  { phase: { label: "Forward", tone: "tcp" }, objective: "Send ordinary IPv4 over the routes IS-IS built.", steps: ["ping-pe1", "ping-p1", "ping-p2"] },
  { phase: { label: "Incident", tone: "danger" }, objective: "PE1 loses PE2's loopback while every cable is up. Investigate.", steps: ["incident-intro", "inc-iih-p2", "inc-p1-lsp", "inc-spf", "inc-ping"] },
  { phase: { label: "Diagnose", tone: "danger" }, objective: "Diagnosis pending.", steps: ["predict-why-gone", "predict-what", "diagnostic-layers"] },
  { phase: { label: "Repair pending", tone: "warning" }, objective: "Choose the change that fixes the cause you identified.", steps: ["repair-challenge"] },
  { phase: { label: "Re-Converge", tone: "success" }, objective: "Re-form the adjacency and resynchronize.", steps: ["rep-iih-p2", "rep-iih-p1", "rep-iih-up", "rep-lsp-p1", "rep-csnp", "rep-psnp", "rep-lsp-p2", "rep-spf"] },
  { phase: { label: "Verify", tone: "success" }, objective: "Prove IPv4 forwarding works again.", steps: ["ver-ping-send", "ver-ping-deliver"] },
  { phase: { label: "Complete", tone: "success" }, objective: "Map the lesson onto real routers.", steps: ["operations", "complete"] },
];

export const ISIS_BRIEFING_NOTES: Partial<Record<string, BriefingStepNote>> = {
  "net-decomp": { takeaway: "The NET names the router; the System ID is the six bytes before 00." },
  encapsulation: { takeaway: "802.3 + LLC 0xFE + 0x83 — no IP, no UDP, no TCP." },
  "iih-p2-init": { takeaway: "Hearing your own System ID in a hello proves two-way communication." },
  "all-adjacencies": { takeaway: "Link up and adjacency up are different facts." },
  "lsp-p2": { takeaway: "Newer sequence → install, acknowledge, flood — never back out the ingress." },
  csnp: { takeaway: "CSNPs summarize LSP headers, not routes." },
  "spf-pe1": { takeaway: "SPF uses a link only when both ends report it." },
  "ping-pe1": { takeaway: "User data is plain IPv4 — IS-IS only built the route." },
  "incident-intro": { doingNow: "A configuration change on one IS-IS circuit." },
  "predict-what": { doingNow: "Diagnosis pending." },
  "repair-challenge": { doingNow: "Choose the change that fixes the cause you identified." },
  "rep-psnp": { takeaway: "A PSNP can request an LSP as well as acknowledge one." },
  "ver-ping-deliver": { takeaway: "Adjacency, LSDB, SPF, route, forwarding — all restored." },
};
