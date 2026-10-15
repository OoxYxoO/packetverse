import type { BriefingPhaseDef, BriefingStepNote } from "@/components/lesson/briefing";

/** Mission Briefing — every step in exactly one phase; the incident's cause is never named before its question. */
export const CAB_BRIEFING_PHASES: BriefingPhaseDef[] = [
  { phase: { label: "Copper", tone: "cyan" }, objective: "Cable a desk and bring the link up.", steps: ["intro", "predict-desk", "desk-media", "autoneg", "desk-frame", "mdix"] },
  { phase: { label: "Fiber", tone: "violet" }, objective: "Reach the next building and the data center.", steps: ["predict-uplink", "uplink-fiber", "predict-dc", "dc-link"] },
  { phase: { label: "Shared vs point-to-point", tone: "ip" }, objective: "See why collisions belong to hubs and half duplex.", steps: ["shared-media", "point-to-point", "counters-healthy"] },
  { phase: { label: "Incident", tone: "danger" }, objective: "A maintenance change on the printer's port. Then complaints.", steps: ["fault-injected", "slow-printing", "counters"] },
  { phase: { label: "Diagnose", tone: "danger" }, objective: "Diagnosis pending.", steps: ["trouble-question", "diagnostic-layers"] },
  { phase: { label: "Repair pending", tone: "warning" }, objective: "Choose the change that fixes the cause you identified.", steps: ["repair-challenge"] },
  { phase: { label: "Verify", tone: "success" }, objective: "Prove it with fresh counters.", steps: ["verify-negotiate", "verify-traffic"] },
  { phase: { label: "Complete", tone: "success" }, objective: "Pick media by distance and speed; match both ends.", steps: ["complete"] },
];

export const CAB_BRIEFING_NOTES: Partial<Record<string, BriefingStepNote>> = {
  "desk-media": { takeaway: "Copper reaches 100 m: 90 m in the wall, 10 m of patch cords." },
  autoneg: { takeaway: "Auto-negotiation: the best speed and duplex both ends support." },
  "predict-uplink": { doingNow: "350 m at 10 Gb/s: check every medium's reach." },
  "uplink-fiber": { takeaway: "Multimode + SR optics: hundreds of metres at 10G." },
  "dc-link": { takeaway: "Single-mode + LR optics: kilometres." },
  "point-to-point": { takeaway: "A hub is one collision domain; a full-duplex switch port has no collisions at all." },
  "counters-healthy": { takeaway: "Healthy full duplex: every error counter stays at zero." },
  "fault-injected": { doingNow: "One end is set by hand; the other is left on auto." },
  "trouble-question": { doingNow: "Diagnosis pending." },
  "repair-challenge": { doingNow: "Choose the change that fixes the cause you identified." },
  "verify-traffic": { takeaway: "Deltas after the repair — not a counter reset — prove the fix." },
};
