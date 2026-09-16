import type { NodeExplanation } from "@/components/network3d/types";
import { BSID, POLICY_COLOR, activeCandidateEvaluation, candidateEvaluations, policyState, type RouterId, type SrPolicyState } from "@/lib/sim-engine/scenarios/srPolicy";

/**
 * All SR-Policy-specific reasoning for the 3D node inspector lives
 * here, not in network3d/*. Every sentence derives from live
 * SrPolicyState — never leaking a future candidate failure, preference
 * fault, or repair before it has actually happened.
 */

const DEVICE_TYPE: Record<RouterId, string> = {
  R1: "SR Policy Headend",
  R2: "Core Router",
  R3: "Core Router",
  R4: "Core Router",
  R5: "Core Router",
  R6: "SR Policy Endpoint",
};
const ROLE: Record<RouterId, string> = {
  R1: "Headend — policy resolution, BSID, steering",
  R2: "Transit",
  R3: "Owner of the R3→R5 Adjacency SID",
  R4: "Transit",
  R5: "Transit",
  R6: "Endpoint — Node SID target",
};

export function explainNode(state: SrPolicyState, nodeId: RouterId): NodeExplanation {
  const hops = state.journey.filter((h) => h.router === nodeId);
  const hop = hops[hops.length - 1];
  const base: NodeExplanation = { id: nodeId, name: nodeId, deviceType: DEVICE_TYPE[nodeId], role: ROLE[nodeId], currentAction: "" };

  if (nodeId === "R1") {
    const evals = candidateEvaluations(state);
    const active = activeCandidateEvaluation(state);
    const pState = policyState(state);
    let currentAction = "Idle.";
    if (hop?.action === "POLICY_UNAVAILABLE") currentAction = `No valid candidate for Color ${POLICY_COLOR} — GOLD steering is strict, so this flow fails rather than silently using ordinary IGP.`;
    else if (hop) currentAction = `${hop.lookup} → ${hop.action}.`;
    else if (state.policyConfigured) currentAction = `Policy <R1,${POLICY_COLOR},R6> is ${pState}${active ? ` — active candidate ${active.def.name}` : ""}.`;
    const table = state.policyConfigured
      ? {
          title: "SR Policy",
          rows: [
            { label: "Policy Key", value: `<R1,${POLICY_COLOR},R6>` },
            { label: "State", value: pState },
            { label: "BSID", value: String(BSID) },
            { label: "Active Candidate", value: active?.def.name ?? "—" },
            ...evals.map((e) => ({ label: `${e.def.name} (pref ${e.def.preference})`, value: e.valid ? "VALID" : "INVALID" })),
          ],
        }
      : undefined;
    return { ...base, controlPlaneRole: "Owns the SR Policy: identity, candidate paths, preference-based selection, BSID allocation, and traffic steering.", dataPlaneRole: "Imposes whichever segment list the active candidate resolves to — never recomputes per packet.", currentAction, packetBefore: hop?.input, packetAfter: hop?.output, tables: table ? [table] : undefined };
  }
  if (nodeId === "R6") {
    const currentAction = hop ? `${hop.lookup} → ${hop.action}.` : "Idle — no packet delivered yet at this point in the timeline.";
    return { ...base, controlPlaneRole: "Policy endpoint — Node-SID target for every candidate's segment list.", dataPlaneRole: "Never evaluates Color, candidate preference, or BSID — only the imposed SID stack.", currentAction, packetBefore: hop?.input, packetAfter: hop?.output };
  }
  if (nodeId === "R3") {
    const currentAction = hop ? `${hop.lookup} → ${hop.action}.` : "Ordinary transit router unless it is the active segment's target or owner.";
    return { ...base, controlPlaneRole: "Owns the R3→R5 Adjacency SID — locally significant, unaware of Color, candidate names, or preference.", dataPlaneRole: "When its own Adj-SID is active, pops it and forwards over that exact link.", currentAction, packetBefore: hop?.input, packetAfter: hop?.output };
  }

  const currentAction = hop ? `${hop.lookup} → ${hop.action}.` : "Ordinary transit router — forwards toward whichever Node SID is currently active, using its own IGP shortest path.";
  return { ...base, controlPlaneRole: "Ordinary transit router — does not evaluate Color, candidate preference, or BSID selection logic.", dataPlaneRole: "Forwards using its own shortest path toward whichever Node SID is on top of the stack; unchanged unless it is the penultimate hop.", currentAction, packetBefore: hop?.input, packetAfter: hop?.output };
}

export function forwardingLabelText(state: SrPolicyState, router: RouterId): string {
  const hops = state.journey.filter((h) => h.router === router);
  const hop = hops[hops.length - 1];
  if (!hop) return "—";
  return `${hop.input} → ${hop.action} → ${hop.output}`;
}
