import type { BriefingPhaseDef, BriefingStepNote } from "@/components/lesson/briefing";

/** Mission Briefing — every step in exactly one phase; the incident's cause is never named before its question. */
export const WIFI_BRIEFING_PHASES: BriefingPhaseDef[] = [
  { phase: { label: "Radio", tone: "cyan" }, objective: "Read signal strength the way a client does.", steps: ["intro", "rf"] },
  { phase: { label: "Join", tone: "violet" }, objective: "Discover the network, choose an AP, associate.", steps: ["beacons", "scan", "associate", "data"] },
  { phase: { label: "Share the air", tone: "ip" }, objective: "See how clients take turns, and how channels divide the band.", steps: ["csma-ca", "channels", "bands"] },
  { phase: { label: "Incident", tone: "danger" }, objective: "A new AP fixes a dead spot. Something else gets worse.", steps: ["fault-injected", "slow"] },
  { phase: { label: "Diagnose", tone: "danger" }, objective: "Diagnosis pending.", steps: ["trouble-question", "diagnostic-layers"] },
  { phase: { label: "Repair pending", tone: "warning" }, objective: "Choose the change that fixes the cause you identified.", steps: ["repair-challenge"] },
  { phase: { label: "Verify", tone: "success" }, objective: "Prove the speed is back without losing coverage.", steps: ["verify"] },
  { phase: { label: "Complete", tone: "success" }, objective: "SSIDs, signal, SINR and the 1-6-11 plan.", steps: ["complete"] },
];

export const WIFI_BRIEFING_NOTES: Partial<Record<string, BriefingStepNote>> = {
  beacons: { takeaway: "SSID = the network's name; BSSID = one AP radio's MAC." },
  associate: { takeaway: "Association is plugging in the cable." },
  data: { takeaway: "802.11 frames carry receiver, transmitter and destination addresses." },
  "csma-ca": { takeaway: "Wi-Fi avoids collisions; it can't detect them. Every unicast frame is ACKed." },
  bands: { takeaway: "Higher bands: more channels, less range." },
  "fault-injected": { doingNow: "A third AP joins the floor." },
  "trouble-question": { doingNow: "Diagnosis pending." },
  "repair-challenge": { doingNow: "Choose the change that fixes the cause you identified." },
  verify: { takeaway: "Non-overlapping channels: 1, 6 and 11." },
};
