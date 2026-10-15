import type { BriefingPhaseDef, BriefingStepNote } from "@/components/lesson/briefing";

/** Mission Briefing — every step in exactly one phase; the incident's cause is never named before its question. */
export const DISC_BRIEFING_PHASES: BriefingPhaseDef[] = [
  { phase: { label: "CDP", tone: "cyan" }, objective: "Ask the Cisco neighbours who they are.", steps: ["intro", "cdp-adv", "cdp-table"] },
  { phase: { label: "LLDP", tone: "violet" }, objective: "Find the neighbour CDP can't see; watch entries age.", steps: ["lldp-enable", "aging", "aged"] },
  { phase: { label: "Provisioning and risk", tone: "ip" }, objective: "Use LLDP-MED for phones; decide where discovery belongs.", steps: ["lldp-med", "security"] },
  { phase: { label: "Incident", tone: "danger" }, objective: "A security change overnight. Phones in the morning.", steps: ["fault-injected", "inc-phone"] },
  { phase: { label: "Diagnose", tone: "danger" }, objective: "Diagnosis pending.", steps: ["trouble-question", "diagnostic-layers"] },
  { phase: { label: "Repair pending", tone: "warning" }, objective: "Choose the change that fixes the cause you identified.", steps: ["repair-challenge"] },
  { phase: { label: "Verify", tone: "success" }, objective: "Prove the phones register — and the edge stays quiet.", steps: ["verify"] },
  { phase: { label: "Complete", tone: "success" }, objective: "CDP, LLDP, holdtimes and LLDP-MED.", steps: ["complete"] },
];

export const DISC_BRIEFING_NOTES: Partial<Record<string, BriefingStepNote>> = {
  "cdp-adv": { takeaway: "Discovery frames go one hop and stop." },
  "lldp-enable": { takeaway: "LLDP is the standard every vendor speaks." },
  aged: { takeaway: "Entries live until their holdtime expires — LLDP 120 s, CDP 180 s." },
  "lldp-med": { takeaway: "LLDP-MED provisions phones: voice VLAN, CoS, DSCP." },
  "fault-injected": { doingNow: "A global configuration change." },
  "trouble-question": { doingNow: "Diagnosis pending." },
  "repair-challenge": { doingNow: "Choose the change that fixes the cause you identified." },
  verify: { takeaway: "Disable discovery per port where the neighbour isn't yours — not everywhere." },
};
