import type { BriefingPhaseDef, BriefingStepNote } from "@/components/lesson/briefing";

/** Mission Briefing — every step in exactly one phase; objectives never give away a sizing, placement or diagnosis answer. */
export const SD_BRIEFING_PHASES: BriefingPhaseDef[] = [
  { phase: { label: "Observe — Requirements", tone: "cyan" }, objective: "Understand the parent block and what each network needs.", steps: ["intro", "requirements", "powers-of-two"] },
  { phase: { label: "Predict — Strategy", tone: "warning" }, objective: "Choose an allocation strategy before touching any addresses.", steps: ["predict-order", "largest-first"] },
  { phase: { label: "Inspect — Sizing", tone: "violet" }, objective: "Turn each host count into the smallest prefix that fits.", steps: ["size-lan-a", "predict-lan-b", "size-lan-b", "size-lan-c", "size-transit", "sizing-summary"] },
  { phase: { label: "Inspect — Placement", tone: "ip" }, objective: "Place each network on a valid boundary without overlap.", steps: ["place-lan-a", "place-lan-b", "boundaries-27", "predict-200", "candidate-200", "place-lan-c", "place-transit", "free-space", "plan-review"] },
  { phase: { label: "Verify — Deployment", tone: "success" }, objective: "Deploy the plan and prove it with real packets.", steps: ["deploy", "predict-gateway", "verify-a-b-send", "verify-a-b-route", "verify-b-c-send", "verify-b-c-route", "verify-c-a-send", "verify-c-a-route", "verify-transit", "verify-transit-reply"] },
  { phase: { label: "Incident", tone: "danger" }, objective: "Review a revised plan. Diagnosis pending.", steps: ["break-intro", "fault-proposed", "fault-apply", "trouble-question", "diagnostic-layers"] },
  { phase: { label: "Repair pending", tone: "warning" }, objective: "Choose a network that satisfies every design rule.", steps: ["repair-challenge"] },
  { phase: { label: "Verify", tone: "success" }, objective: "Apply the corrected plan and prove it.", steps: ["verify-replan", "verify-a-c-send", "verify-a-c-route"] },
  { phase: { label: "Complete", tone: "success" }, objective: "Review the design process end to end.", steps: ["complete"] },
];

export const SD_BRIEFING_NOTES: Partial<Record<string, BriefingStepNote>> = {
  "powers-of-two": { takeaway: "Ordinary capacity = 2^h − 2." },
  "size-lan-a": { doingNow: "Find the host bits for 100 hosts." },
  "size-transit": { takeaway: "/30 is the conventional 2-host subnet here." },
  "place-lan-a": { doingNow: "The largest block starts at the parent's first address." },
  "boundaries-27": { takeaway: "A /27 starts on a multiple of 32." },
  "candidate-200": { doingNow: "The planner explains a rejected candidate." },
  "free-space": { takeaway: "Leftover space is address space, not automatically a subnet." },
  deploy: { doingNow: "R1 takes the first usable address of each segment." },
  "verify-transit-reply": { takeaway: "Every prefix in the plan carries real traffic." },
  "fault-proposed": { doingNow: "A revised plan arrives for review." },
  "trouble-question": { doingNow: "Diagnosis pending." },
  "repair-challenge": { doingNow: "Choose the network that passes every rule." },
  "verify-a-c-route": { takeaway: "The corrected plan is deployed and verified." },
};
