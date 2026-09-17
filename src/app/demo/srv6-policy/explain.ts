import type { NodeExplanation } from "@/components/network3d/types";
import { locatorTextFor } from "@/lib/sim-engine/scenarios/srv6Foundations";
import { BEHAVIOR_LABEL } from "@/lib/sim-engine/scenarios/srv6EndpointBehaviors";
import { activeCandidateFor, policyStateFor, srv6PolicySteps, type RouterId, type Srv6PolicyState } from "@/lib/sim-engine/scenarios/srv6Policy";

/**
 * All SR-Policy-specific reasoning for the 3D node inspector lives
 * here, not in network3d/*. Every sentence derives from live
 * Srv6PolicyState at the CURRENT step — never leaking a future
 * candidate, failure, or repair before it has actually happened.
 */

const stepIndex = (id: string) => srv6PolicySteps.findIndex((s) => s.id === id);

const DEVICE_TYPE: Record<RouterId, string> = {
  R1: "SR Policy Headend",
  R2: "Core Router (Transit Only)",
  R3: "SRv6 Endpoint — End / End.X",
  R4: "Core Router (Transit Only)",
  R5: "Core Router (Transit Only)",
  R6: "SRv6 Service Endpoint",
};
const ROLE: Record<RouterId, string> = {
  R1: "Headend — owns the SR Policy, evaluates candidates, imposes H.Encaps",
  R2: "Transit — no local SID relevant to this lesson",
  R3: "Owns End and End.X (adjacency R3→R5) under one locator",
  R4: "Transit — owns a plain End SID, not referenced by the active candidate unless the path requires it",
  R5: "Transit — owns a plain End SID",
  R6: "Owns End.DX6 — the policy's service endpoint",
};

export function explainNode(state: Srv6PolicyState, nodeId: RouterId, currentStepId: string): NodeExplanation {
  const i = stepIndex(currentStepId);
  const hops = state.journey.filter((h) => h.router === nodeId);
  const hop = hops[hops.length - 1];
  const entries = state.localSidTable[nodeId] ?? [];

  const base: NodeExplanation = { id: nodeId, name: nodeId, deviceType: DEVICE_TYPE[nodeId], role: ROLE[nodeId], currentAction: "" };
  const sidTable = { title: "Local SID Table", rows: entries.length ? entries.map((e) => ({ label: e.sidText, value: `${BEHAVIOR_LABEL[e.behavior]} — ${e.parameterText}` })) : [{ label: "Local SIDs", value: "(none instantiated)" }] };
  const locatorRow = { title: "Locator", rows: [{ label: "Advertised", value: locatorTextFor(nodeId) }] };

  if (nodeId === "R1") {
    const active = activeCandidateFor(state);
    const pState = policyStateFor(state);
    let currentAction = "Idle.";
    if (hop) currentAction = `${hop.lookup} → ${hop.action}.`;
    else if (i >= 0) currentAction = "Headend — owns SR Policy <R1,100,R6>, evaluates candidates, and imposes H.Encaps for steered traffic.";
    return {
      ...base,
      controlPlaneRole: `SR Policy state: ${pState}. Active candidate: ${active?.def.name ?? "none"}.`,
      dataPlaneRole: "Never reuses a stale SRH — every H.Encaps is built fresh from whichever candidate is active right now.",
      currentAction,
      packetBefore: hop?.input,
      packetAfter: hop?.output,
      tables: [locatorRow],
    };
  }

  if (entries.length) {
    let currentAction = "Ordinary transit for any DA that isn't one of its own SIDs.";
    if (hop) currentAction = `${hop.lookup} → ${hop.action}.`;
    return {
      ...base,
      controlPlaneRole: `Owns ${entries.length} instantiated local SID${entries.length > 1 ? "s" : ""} under its own locator (${locatorTextFor(nodeId)}).`,
      dataPlaneRole: "Dispatches to the SID's bound behavior when the DA matches — never evaluates Color, candidate preference, or the BSID itself.",
      currentAction,
      packetBefore: hop?.input,
      packetAfter: hop?.output,
      tables: [locatorRow, sidTable],
    };
  }

  let currentAction = "Ordinary transit router — no local SID owned in this lesson.";
  if (hop) currentAction = `${hop.lookup} → ${hop.action}.`;
  return { ...base, controlPlaneRole: "Ordinary transit router — advertises its own locator but owns no local SID relevant to this lesson's scenarios.", dataPlaneRole: "Forwards using its own IPv6 FIB toward whichever locator currently owns the active DA.", currentAction, packetBefore: hop?.input, packetAfter: hop?.output, tables: [locatorRow] };
}

export function forwardingLabelText(state: Srv6PolicyState, router: RouterId): string {
  const hops = state.journey.filter((h) => h.router === router);
  const hop = hops[hops.length - 1];
  if (!hop) return "—";
  return `${hop.input} → ${hop.action} → ${hop.output}`;
}
