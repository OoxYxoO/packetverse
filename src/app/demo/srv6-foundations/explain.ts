import type { NodeExplanation } from "@/components/network3d/types";
import { locatorTextFor, srv6Steps, type RouterId, type Srv6State } from "@/lib/sim-engine/scenarios/srv6Foundations";

/**
 * All SRv6-specific reasoning for the 3D node inspector lives here, not
 * in network3d/*. Every sentence derives from live Srv6State at the
 * CURRENT step — never leaking a future segment, fault, or repair
 * before it has actually happened.
 */

const stepIndex = (id: string) => srv6Steps.findIndex((s) => s.id === id);

const DEVICE_TYPE: Record<RouterId, string> = {
  R1: "SRv6 Headend",
  R2: "Core Router (Transit Only)",
  R3: "SRv6 Endpoint — Owns End SID",
  R4: "Core Router (Transit Only)",
  R5: "SRv6 Endpoint — Owns End SID",
  R6: "SRv6 Destination — Owns End SID",
};
const ROLE: Record<RouterId, string> = {
  R1: "Headend — imposes DA (and SRH when more than one segment is needed)",
  R2: "Transit — no local SID relevant to this lesson",
  R3: "Owner of an instantiated End SID",
  R4: "Transit — no local SID relevant to this lesson",
  R5: "Owner of an instantiated End SID",
  R6: "Owner of an instantiated End SID — final destination",
};

export function explainNode(state: Srv6State, nodeId: RouterId, currentStepId: string): NodeExplanation {
  const i = stepIndex(currentStepId);
  const hops = state.journey.filter((h) => h.router === nodeId);
  const hop = hops[hops.length - 1];
  const localSid = state.localSidTable[nodeId];

  const base: NodeExplanation = { id: nodeId, name: nodeId, deviceType: DEVICE_TYPE[nodeId], role: ROLE[nodeId], currentAction: "" };
  const sidTable = {
    title: "SID Ownership",
    rows: [
      { label: "Locator", value: locatorTextFor(nodeId) },
      { label: "Local SID", value: localSid ? localSid.sidText : "(none instantiated)" },
      { label: "Behavior", value: localSid ? localSid.behavior : "—" },
    ],
  };

  if (nodeId === "R3" && state.fault && !localSid) {
    return {
      ...base,
      controlPlaneRole: "Should own an End SID for its own locator — right now its Local SID Table has no entry.",
      dataPlaneRole: "Any packet whose active DA needs R3's End behavior cannot execute it and is dropped.",
      currentAction: hop?.action === "DROP_MISSING_LOCAL_SID" ? "Received a packet whose DA matches nothing in its Local SID Table — dropped. The locator was reachable; the behavior binding simply isn't there." : "Local SID Table is missing its expected End SID entry.",
      packetBefore: hop?.input,
      packetAfter: hop?.output,
      tables: [sidTable],
      note: "Locator reachability and local SID instantiation are two different things — this is the fault.",
    };
  }

  if (nodeId === "R1") {
    let currentAction = "Idle.";
    if (hop) currentAction = `${hop.lookup} → ${hop.action}.`;
    else if (i >= 0) currentAction = "Headend — classifies traffic into the current segment program and imposes DA (+ SRH when needed).";
    return { ...base, controlPlaneRole: "Headend. Builds the high-level segment program and imposes the IPv6 DA once, at ingress.", dataPlaneRole: "Never recomputes the program per packet — the DA/SRH it imposes is exactly the program it was given.", currentAction, packetBefore: hop?.input, packetAfter: hop?.output, tables: [sidTable] };
  }

  if (localSid) {
    let currentAction = "Ordinary transit for any DA that isn't its own SID.";
    if (hop) currentAction = `${hop.lookup} → ${hop.action}.`;
    return {
      ...base,
      controlPlaneRole: `Owns an instantiated End SID under its own locator (${locatorTextFor(nodeId)}).`,
      dataPlaneRole: "When the DA matches its own Local SID Table entry, executes End: decrements Segments Left and copies the next Segment List entry into the DA (or, at Segments Left = 0, completes without decrementing further).",
      currentAction,
      packetBefore: hop?.input,
      packetAfter: hop?.output,
      tables: [sidTable],
    };
  }

  // R2, R4 — ordinary transit, owns nothing
  let currentAction = "Ordinary transit router — no local SID owned in this lesson.";
  if (hop) currentAction = `${hop.lookup} → ${hop.action}.`;
  return { ...base, controlPlaneRole: "Ordinary transit router — advertises its own locator but owns no local SID relevant to this lesson's scenarios.", dataPlaneRole: "Forwards using its own IPv6 FIB toward whichever locator currently owns the active DA — never touches Segments Left or the Segment List.", currentAction, packetBefore: hop?.input, packetAfter: hop?.output, tables: [sidTable] };
}

export function forwardingLabelText(state: Srv6State, router: RouterId): string {
  const hops = state.journey.filter((h) => h.router === router);
  const hop = hops[hops.length - 1];
  if (!hop) return "—";
  return `${hop.input} → ${hop.action} → ${hop.output}`;
}
