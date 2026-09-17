import type { NodeExplanation } from "@/components/network3d/types";
import { BEHAVIOR_LABEL, locatorTextFor, srv6EndpointSteps, type RouterId, type Srv6EndpointState } from "@/lib/sim-engine/scenarios/srv6EndpointBehaviors";

/**
 * All SRv6 endpoint-behavior reasoning for the 3D node inspector lives
 * here, not in network3d/*. Every sentence derives from live
 * Srv6EndpointState at the CURRENT step — never leaking a future
 * segment, fault, or repair before it has actually happened.
 */

const stepIndex = (id: string) => srv6EndpointSteps.findIndex((s) => s.id === id);

const DEVICE_TYPE: Record<RouterId, string> = {
  R1: "SRv6 Headend",
  R2: "Core Router (Transit Only)",
  R3: "SRv6 Endpoint — End / End.X / End.T",
  R4: "Core Router (Transit Only)",
  R5: "Core Router (Transit Only)",
  R6: "SRv6 Service Endpoint",
};
const ROLE: Record<RouterId, string> = {
  R1: "Headend — imposes the outer DA (and inner payload, for the service examples)",
  R2: "Transit — no local SID relevant to this lesson",
  R3: "Owns three local SIDs under one locator: End, End.X, End.T",
  R4: "Transit — no local SID relevant to this lesson",
  R5: "Transit — no local SID relevant to this lesson",
  R6: "Owns six local SIDs under one locator: End, End.DX6, End.DX4, End.DT6, End.DT4, End.DX2",
};

export function explainNode(state: Srv6EndpointState, nodeId: RouterId, currentStepId: string): NodeExplanation {
  const i = stepIndex(currentStepId);
  const hops = state.journey.filter((h) => h.router === nodeId);
  const hop = hops[hops.length - 1];
  const entries = state.localSidTable[nodeId] ?? [];

  const base: NodeExplanation = { id: nodeId, name: nodeId, deviceType: DEVICE_TYPE[nodeId], role: ROLE[nodeId], currentAction: "" };
  const sidTable = {
    title: "Local SID Table",
    rows: entries.length ? entries.map((e) => ({ label: e.sidText, value: `${BEHAVIOR_LABEL[e.behavior]} — ${e.parameterText}` })) : [{ label: "Local SIDs", value: "(none instantiated)" }],
  };
  const locatorRow = { title: "Locator", rows: [{ label: "Advertised", value: locatorTextFor(nodeId) }] };

  if (nodeId === "R6" && state.fault) {
    return {
      ...base,
      controlPlaneRole: "Should be bound End.DT4 / VRF-CUST4 for this service SID — right now it's misbound as End.DX4 / CE4-A.",
      dataPlaneRole: "Decapsulation still succeeds, but the exposed IPv4 packet is cross-connected to a fixed adjacency instead of routed through the VRF.",
      currentAction: hop ? `${hop.lookup} → ${hop.action}.` : "Local SID Table entry is misbound — a fixed adjacency instead of a table lookup.",
      packetBefore: hop?.input,
      packetAfter: hop?.output,
      tables: [locatorRow, sidTable],
      note: "The SID value never changed — only what R6 does when it becomes active.",
    };
  }

  if (nodeId === "R1") {
    let currentAction = "Idle.";
    if (hop) currentAction = `${hop.lookup} → ${hop.action}.`;
    else if (i >= 0) currentAction = "Headend — classifies traffic and imposes the outer IPv6 DA (+ SRH when more than one segment is needed, + inner payload for service examples).";
    return { ...base, controlPlaneRole: "Headend. Builds the segment program and imposes the outer IPv6 DA once, at ingress.", dataPlaneRole: "Never recomputes the program per packet.", currentAction, packetBefore: hop?.input, packetAfter: hop?.output, tables: [locatorRow] };
  }

  if (entries.length) {
    let currentAction = "Ordinary transit for any DA that isn't one of its own SIDs.";
    if (hop) currentAction = `${hop.lookup} → ${hop.action}.`;
    return {
      ...base,
      controlPlaneRole: `Owns ${entries.length} instantiated local SID${entries.length > 1 ? "s" : ""} under its own locator (${locatorTextFor(nodeId)}).`,
      dataPlaneRole: "When the DA matches one of its own SIDs, dispatches to that SID's bound behavior — a different local action per behavior, never a generic \"forward\" step.",
      currentAction,
      packetBefore: hop?.input,
      packetAfter: hop?.output,
      tables: [locatorRow, sidTable],
    };
  }

  let currentAction = "Ordinary transit router — no local SID owned in this lesson.";
  if (hop) currentAction = `${hop.lookup} → ${hop.action}.`;
  return { ...base, controlPlaneRole: "Ordinary transit router — advertises its own locator but owns no local SID relevant to this lesson's scenarios.", dataPlaneRole: "Forwards using its own IPv6 FIB toward whichever locator currently owns the active DA — never touches Segments Left, an adjacency binding, or a table binding.", currentAction, packetBefore: hop?.input, packetAfter: hop?.output, tables: [locatorRow] };
}

export function forwardingLabelText(state: Srv6EndpointState, router: RouterId): string {
  const hops = state.journey.filter((h) => h.router === router);
  const hop = hops[hops.length - 1];
  if (!hop) return "—";
  return `${hop.input} → ${hop.action} → ${hop.output}`;
}
