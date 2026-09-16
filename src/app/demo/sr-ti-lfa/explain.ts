import type { NodeExplanation } from "@/components/network3d/types";
import { PLR, PROTECTED_LINK, R6_NODE_SID, type RouterId, type SrTiLfaState } from "@/lib/sim-engine/scenarios/srTiLfa";

/**
 * All TI-LFA-specific reasoning for the 3D node inspector lives here,
 * not in network3d/*. Every sentence derives from live SrTiLfaState —
 * never leaking a repair point, a stale-repair diagnosis, or a failure
 * before it has actually happened in the journey.
 */

const DEVICE_TYPE: Record<RouterId, string> = {
  R1: "SR Headend",
  R2: "PLR / Local Repair Point",
  R3: "Core Router",
  R4: "Core Router (Protected Node)",
  R5: "Core Router",
  R6: "SR Destination",
};
const ROLE: Record<RouterId, string> = {
  R1: "Headend — imposes the R6 Node SID, unaware any repair exists",
  R2: `PLR for ${PROTECTED_LINK} — detects failure locally and activates a precomputed repair`,
  R3: "Ordinary transit router, unless it is the current repair point",
  R4: "Top-path transit router — the protected node in the node-protection example",
  R5: "Ordinary transit router, unless it is the current repair point",
  R6: "Destination — Node SID target underneath every repair",
};

export function explainNode(state: SrTiLfaState, nodeId: RouterId): NodeExplanation {
  const hops = state.journey.filter((h) => h.router === nodeId);
  const hop = hops[hops.length - 1];
  const base: NodeExplanation = { id: nodeId, name: nodeId, deviceType: DEVICE_TYPE[nodeId], role: ROLE[nodeId], currentAction: "" };

  if (nodeId === "R1") {
    const currentAction = hop ? `${hop.lookup} → ${hop.action}.` : "Idle — has no visibility into TI-LFA at all; only ever imposes the R6 Node SID.";
    return { ...base, controlPlaneRole: "Owns nothing about protection — imposes the destination Node SID exactly the same way whether or not TI-LFA exists anywhere downstream.", dataPlaneRole: "Pushes [R6 Node SID][IP] and forwards toward its own shortest-path next hop.", currentAction, packetBefore: hop?.input, packetAfter: hop?.output };
  }

  if (nodeId === PLR) {
    const comp = state.linkProtection;
    let currentAction = "Idle.";
    if (hop?.action === "PUSH_REPAIR") currentAction = "Protected resource DOWN — pushed the precomputed repair segment(s) immediately, without waiting for R1 or global convergence.";
    else if (hop?.action === "PUSH_REPAIR_STALE") currentAction = "Protected resource DOWN — activated a repair segment list that was never recomputed after a topology change, and it does not reach the post-convergence path.";
    else if (hop) currentAction = `${hop.lookup} → ${hop.action}.`;
    else if (comp?.repairPoint) currentAction = `TI-LFA repair for ${PROTECTED_LINK} is precomputed: repair point ${comp.repairPoint}, lifecycle ${state.linkProtectionLifecycle}.`;
    const table = comp
      ? {
          title: "TI-LFA Protection",
          rows: [
            { label: "Protected Resource", value: PROTECTED_LINK },
            { label: "Repair Point", value: comp.repairPoint ?? "none" },
            { label: "Lifecycle", value: state.linkProtectionLifecycle },
            { label: "Repair Segments", value: comp.repairSegments.map((s) => `${s.type}(${s.target})`).join(", ") || "(none)" },
          ],
        }
      : undefined;
    return { ...base, controlPlaneRole: "The PLR: precomputes post-convergence SPF, P-Space, Q-Space, a PQ candidate, and a minimal repair segment list — all before any failure.", dataPlaneRole: "On local failure detection, pushes the precomputed repair segment(s) on top of the original SR instruction — no new computation at failure time.", currentAction, packetBefore: hop?.input, packetAfter: hop?.output, tables: table ? [table] : undefined };
  }

  if (nodeId === "R6") {
    const currentAction = hop ? `${hop.lookup} → ${hop.action}.` : "Idle — no packet delivered yet at this point in the timeline.";
    return { ...base, controlPlaneRole: "Destination — every repair segment list resolves back to this router's own Node SID underneath.", dataPlaneRole: "Never evaluates whether a repair happened — only the currently active SID.", currentAction, packetBefore: hop?.input, packetAfter: hop?.output };
  }

  const isRepairEndpoint = hop?.action === "POP_REPAIR";
  const currentAction = isRepairEndpoint
    ? "Repair segment target reached — popped the repair label, exposing the original R6 Node SID underneath, and resumed ordinary SR forwarding. Did not recompute the PLR's TI-LFA algorithm."
    : hop
      ? `${hop.lookup} → ${hop.action}.`
      : "Ordinary transit router — forwards toward whichever SID is currently active, using its own IGP shortest path, with no knowledge of TI-LFA.";
  return {
    ...base,
    controlPlaneRole: "Does not evaluate protected resources, P-Space, Q-Space, or repair points — that reasoning belongs entirely to the PLR.",
    dataPlaneRole: `Forwards using its own shortest path toward whichever SID is on top of the stack${nodeId === "R4" ? " — until it fails as the protected node in the node-protection example" : ""}.`,
    currentAction,
    packetBefore: hop?.input,
    packetAfter: hop?.output,
  };
}

export function forwardingLabelText(state: SrTiLfaState, router: RouterId): string {
  const hops = state.journey.filter((h) => h.router === router);
  const hop = hops[hops.length - 1];
  if (!hop) return "—";
  return `${hop.input} → ${hop.action} → ${hop.output}`;
}

export { R6_NODE_SID };
