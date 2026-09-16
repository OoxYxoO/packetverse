import type { NodeExplanation } from "@/components/network3d/types";
import { NODE_SID_INDEX, ROUTER_LOOPBACK, resolveActiveSegment, srMplsSteps, type RouterId, type SrMplsState } from "@/lib/sim-engine/scenarios/srMplsFoundations";

/**
 * All SR-MPLS-specific reasoning for the 3D node inspector lives here,
 * not in network3d/*. Every sentence derives from live SrMplsState at
 * the CURRENT step — never leaking a future segment, fault, or repair
 * before it has actually happened.
 */

const stepIndex = (id: string) => srMplsSteps.findIndex((s) => s.id === id);

const DEVICE_TYPE: Record<RouterId, string> = {
  R1: "SR-MPLS Headend",
  R2: "Core Router",
  R3: "Core Router",
  R4: "Core Router",
  R5: "Core Router",
  R6: "SR-MPLS Destination",
};
const ROLE: Record<RouterId, string> = {
  R1: "Headend — imposes the segment stack",
  R2: "Transit",
  R3: "Owner of the R3→R5 Adjacency SID",
  R4: "Transit",
  R5: "Transit",
  R6: "Destination — Node SID target",
};

export function explainNode(state: SrMplsState, nodeId: RouterId, currentStepId: string): NodeExplanation {
  const i = stepIndex(currentStepId);
  const hops = state.journey.filter((h) => h.router === nodeId);
  const hop = hops[hops.length - 1];
  const activeSegment = resolveActiveSegment(state.segmentList ?? []);
  const prefixSid = state.prefixSids.find((p) => p.router === nodeId);
  const ownedAdj = state.adjSids.filter((a) => a.owner === nodeId);

  const base: NodeExplanation = { id: nodeId, name: nodeId, deviceType: DEVICE_TYPE[nodeId], role: ROLE[nodeId], currentAction: "" };
  const sidTable = {
    title: "SID Ownership",
    rows: [
      { label: "Loopback", value: ROUTER_LOOPBACK[nodeId] },
      { label: "Prefix-SID index", value: String(NODE_SID_INDEX[nodeId]) },
      { label: "Node SID label", value: String(prefixSid?.label) },
      ...ownedAdj.map((a) => ({ label: `Adj-SID (${a.owner}→${a.neighbor})`, value: `${a.label} (LOCAL)` })),
    ],
  };

  if (nodeId === "R1") {
    let currentAction = "Idle.";
    if (state.fault && hop?.action === "INVALID_SID") currentAction = "Attempted to impose an active segment it cannot execute — the top SID is owned by R3, not R1. Dropped before forwarding.";
    else if (hop) currentAction = `${hop.lookup} → ${hop.action}.`;
    else if (i >= 0) currentAction = "Headend — imposes whatever segment list operations has configured.";
    return { ...base, controlPlaneRole: "Headend. Builds the segment list and imposes the full MPLS label stack once, at ingress.", dataPlaneRole: "Never recomputes anything per packet — the label stack it pushes is exactly the segment list it was given.", currentAction, packetBefore: hop?.input, packetAfter: hop?.output, tables: [sidTable] };
  }
  if (nodeId === "R6") {
    const currentAction = hop ? `${hop.lookup} → ${hop.action}.` : "Idle — no packet delivered yet at this point in the timeline.";
    return { ...base, controlPlaneRole: "Node-SID target for every segment list in this lesson.", dataPlaneRole: "Never recomputes CSPF or a segment list — pops its own label if it's still on top, or simply delivers if already bare.", currentAction, packetBefore: hop?.input, packetAfter: hop?.output, tables: [sidTable] };
  }
  if (nodeId === "R3") {
    let currentAction = "Ordinary transit router unless it is the active segment's target or owner.";
    if (hop?.action === "POP_AND_FORWARD_ADJ") currentAction = `${hop.lookup} → ${hop.action}.`;
    else if (hop) currentAction = `${hop.lookup} → ${hop.action}.`;
    else if (activeSegment?.type === "ADJ" && activeSegment.owner === "R3") currentAction = "Owns the currently-active Adjacency SID — will resolve it to the R3→R5 link.";
    return { ...base, controlPlaneRole: "Owns the R3→R5 Adjacency SID — locally significant, only meaningful here.", dataPlaneRole: "When its own Adj-SID is active, pops it and forwards over that exact link — never a shortest-path lookup for that instruction.", currentAction, packetBefore: hop?.input, packetAfter: hop?.output, tables: [sidTable] };
  }

  // R2, R4, R5 — ordinary transit, expose only what's relevant right now
  let currentAction = "Ordinary transit router — forwards toward whichever Node SID is currently active, using its own IGP shortest path.";
  if (hop) currentAction = `${hop.lookup} → ${hop.action}.`;
  return { ...base, controlPlaneRole: "Ordinary transit router — owns no Adjacency SID relevant to this lesson's scenarios.", dataPlaneRole: "Forwards using its own shortest path toward whichever Node SID is currently on top of the stack; the label value is unchanged unless it is the penultimate hop.", currentAction, packetBefore: hop?.input, packetAfter: hop?.output, tables: [sidTable] };
}

export function forwardingLabelText(state: SrMplsState, router: RouterId): string {
  const hops = state.journey.filter((h) => h.router === router);
  const hop = hops[hops.length - 1];
  if (!hop) return "—";
  return `${hop.input} → ${hop.action} → ${hop.output}`;
}
