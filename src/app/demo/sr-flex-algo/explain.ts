import type { NodeExplanation } from "@/components/network3d/types";
import { ALGORITHM_NAME, FAD_128, spfFor, type RouterId, type SrFlexAlgoState } from "@/lib/sim-engine/scenarios/srFlexAlgo";

/**
 * All Flex-Algo-specific reasoning for the 3D node inspector lives
 * here, not in network3d/*. Every sentence derives from live
 * SrFlexAlgoState — never leaking a participation fault or a recompute
 * before it has actually happened in the journey.
 */

const DEVICE_TYPE: Record<RouterId, string> = {
  R1: "SR Headend",
  R2: "Core Router (Algorithm 0 path)",
  R3: "Core Router (Algorithm 128 path)",
  R4: "Core Router (Algorithm 0 path)",
  R5: "Core Router (Algorithm 128 path)",
  R6: "SR Destination",
};
const ROLE: Record<RouterId, string> = {
  R1: "Headend — imposes whichever algorithm-specific Prefix-SID a flow is classified toward",
  R2: "Ordinary Algorithm-0 transit router",
  R3: "Ordinary transit router — on the Algorithm-128 path when participating",
  R4: "Ordinary Algorithm-0 transit router",
  R5: "Ordinary transit router — on the Algorithm-128 path when reachable",
  R6: "Destination — advertises the SAME prefix with a different Prefix-SID per algorithm",
};

export function explainNode(state: SrFlexAlgoState, nodeId: RouterId): NodeExplanation {
  const hops = state.journey.filter((h) => h.router === nodeId);
  const hop = hops[hops.length - 1];
  const base: NodeExplanation = { id: nodeId, name: nodeId, deviceType: DEVICE_TYPE[nodeId], role: ROLE[nodeId], currentAction: "" };

  if (nodeId === "R1") {
    const algo0 = spfFor(state, 0);
    const algo128 = spfFor(state, 128);
    const currentAction = hop ? `${hop.lookup} → ${hop.action}.` : `Idle. Algorithm 0 → ${algo0.path?.join(" → ") ?? "unreachable"}. Algorithm 128 → ${algo128.path?.join(" → ") ?? "unreachable"}.`;
    const table = {
      title: "Algorithm RIB (R1)",
      rows: [
        { label: "Algorithm 0", value: algo0.path?.join(" → ") ?? "unreachable" },
        { label: "Algorithm 128", value: algo128.path?.join(" → ") ?? "unreachable" },
        { label: "FAD 128 Metric", value: FAD_128.metricType },
        { label: "FAD 128 Exclude", value: FAD_128.excludeAffinity ?? "none" },
      ],
    };
    return { ...base, controlPlaneRole: "Owns nothing about Flex-Algo calculation itself — imposes whichever algorithm-specific Prefix-SID a flow is classified toward, then forwards using that algorithm's OWN computed next hop.", dataPlaneRole: "Pushes a single algorithm-specific Prefix-SID label and forwards.", currentAction, packetBefore: hop?.input, packetAfter: hop?.output, tables: [table] };
  }

  if (nodeId === "R6") {
    const currentAction = hop ? `${hop.lookup} → ${hop.action}.` : "Idle — no packet delivered yet at this point in the timeline.";
    return { ...base, controlPlaneRole: "Advertises 10.0.0.6/32 with a distinct Prefix-SID per algorithm — same prefix, algorithm-specific semantics.", dataPlaneRole: "Never evaluates which algorithm got it here — only the currently active SID.", currentAction, packetBefore: hop?.input, packetAfter: hop?.output };
  }

  const participates128 = (state.algorithmParticipation[nodeId] ?? []).includes(128);
  const currentAction = hop
    ? `${hop.lookup} → ${hop.action}.`
    : `Ordinary transit router — forwards toward whichever algorithm's SID is active, using that algorithm's own SPF. Algorithm 128 participation: ${participates128 ? "yes" : "NO"}.`;
  return {
    ...base,
    controlPlaneRole: `Computes its own SPF per participating algorithm. ${ALGORITHM_NAME[128]} participation: ${participates128 ? "enabled" : "DISABLED"}.`,
    dataPlaneRole: "Forwards using whichever algorithm's own shortest path applies to the active SID on top of the stack.",
    currentAction,
    packetBefore: hop?.input,
    packetAfter: hop?.output,
  };
}

export function forwardingLabelText(state: SrFlexAlgoState, router: RouterId): string {
  const hops = state.journey.filter((h) => h.router === router);
  const hop = hops[hops.length - 1];
  if (!hop) return "—";
  return `${hop.input} → ${hop.action} → ${hop.output}`;
}
