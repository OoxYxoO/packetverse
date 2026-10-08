import type { BriefingPhaseDef, BriefingStepNote } from "@/components/lesson/briefing";

/** Mission Briefing — the track's workflow; every step in exactly one phase; the cause is never named before its question. */
export const MP_BRIEFING_PHASES: BriefingPhaseDef[] = [
  { phase: { label: "Define", tone: "cyan" }, objective: "Meet the VPN, the core and its five planes.", steps: ["intro"] },
  { phase: { label: "Scope", tone: "violet" }, objective: "Separate the RD's job from the RT's.", steps: ["design", "q-rd-rt"] },
  { phase: { label: "Baseline", tone: "success" }, objective: "Follow a VPN route and a customer packet end to end.", steps: ["base-update", "base-import", "base-ce1", "base-pe1", "q-labels", "base-p1", "q-p-routes", "base-p2", "base-pe2"] },
  { phase: { label: "Symptom", tone: "warning" }, objective: "Site 2 unreachable after a PE2 change. Scope by plane.", steps: ["incident-intro"] },
  { phase: { label: "Gather Evidence", tone: "danger" }, objective: "Check each plane: update, import, data, transport, BGP, VRF.", steps: ["inc-update", "inc-pe1-rx", "inc-ce1", "inc-transport", "q-loopback", "inc-bgp", "q-established", "inc-vrf"] },
  { phase: { label: "Form Hypothesis", tone: "violet" }, objective: "Reason about RD, RT and import. Diagnosis pending.", steps: ["q-rd", "q-rt", "q-received-absent", "inc-pe2-config", "q-ldp-reset"] },
  { phase: { label: "Test", tone: "ip" }, objective: "Name the plane and the cause.", steps: ["diagnostic-layers", "predict-cause"] },
  { phase: { label: "Repair pending", tone: "warning" }, objective: "Choose the change that fixes the cause you identified.", steps: ["repair-challenge"] },
  { phase: { label: "Verify", tone: "success" }, objective: "Prove the route is imported and the label stack returns.", steps: ["ver-update", "ver-import", "ver-ce1", "ver-pe1", "ver-p1", "ver-p2", "ver-pe2"] },
  { phase: { label: "Complete", tone: "success" }, objective: "Map the planes onto real routers.", steps: ["operations", "complete"] },
];

export const MP_BRIEFING_NOTES: Partial<Record<string, BriefingStepNote>> = {
  design: { takeaway: "RD = uniqueness; RT = import/export policy." },
  "base-pe1": { takeaway: "Outer label = transport to PE2; inner label = which VRF." },
  "base-p1": { takeaway: "P routers act on the top label only." },
  "incident-intro": { doingNow: "Scope by plane." },
  "inc-pe1-rx": { takeaway: "Received is not the same as imported." },
  "inc-transport": { takeaway: "Transport healthy ≠ VPN healthy." },
  "q-rd": { doingNow: "Diagnosis pending." },
  "repair-challenge": { doingNow: "Choose the change that fixes the cause you identified." },
  "ver-pe1": { takeaway: "Proof: the two-label stack leaves PE1 again." },
};
