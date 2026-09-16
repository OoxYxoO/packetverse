import type { DeviceInterfaceData, DeviceProcessingTrace, LinkDetail, PacketStackFrame, ProcessingStage } from "@/components/network3d/types";
import { GRAPH_EDGES, LINKS, activeCandidateEvaluation, fmtLabel, type RouterId, type SrPolicyState } from "@/lib/sim-engine/scenarios/srPolicy";

/**
 * Scene Adapter for SR Policy's device-interior 3D view. Every stage
 * list and interface/link value below is derived FROM SrPolicyState —
 * this file makes no policy/candidate/steering decision itself.
 */

const HEADEND_PIPELINE: ProcessingStage[] = [
  { id: "arrive", label: "Packet Arrives" },
  { id: "classify", label: "Steering / Classification Lookup" },
  { id: "policy-key", label: "Policy Key Resolved" },
  { id: "state-check", label: "Policy State UP?" },
  { id: "candidate-select", label: "Active Candidate Selected" },
  { id: "segment-resolve", label: "Segment List Resolved" },
  { id: "impose", label: "MPLS SID Stack Imposed" },
  { id: "forward", label: "Forward" },
];
const NODE_SID_PIPELINE: ProcessingStage[] = [
  { id: "ingress", label: "MPLS Ingress" },
  { id: "label-lookup", label: "Active SID Label Lookup" },
  { id: "identify-instruction", label: "Identify Forwarding Instruction" },
  { id: "spt-nexthop", label: "Shortest-Path Next Hop" },
  { id: "label-action", label: "MPLS Label Action" },
  { id: "forward", label: "Forward" },
];
const ADJ_SID_PIPELINE: ProcessingStage[] = [
  { id: "active-lookup", label: "Active SID Lookup" },
  { id: "owner-check", label: "SID Owner = Local Router" },
  { id: "resolve-adjacency", label: "Resolve Specified Adjacency" },
  { id: "send-adjacency", label: "Send Over That Adjacency" },
  { id: "next-active", label: "Next Segment Becomes Active" },
];
const TAILEND_PIPELINE: ProcessingStage[] = [
  { id: "label-lookup", label: "Label Lookup" },
  { id: "target-check", label: "Self Is Segment Target" },
  { id: "deliver", label: "Deliver" },
];
const UNAVAILABLE_PIPELINE: ProcessingStage[] = [
  { id: "classify", label: "Steering / Classification Lookup" },
  { id: "policy-key", label: "Policy Key Resolved" },
  { id: "no-valid", label: "NO VALID CANDIDATE" },
  { id: "fail", label: "Steering Fails — No IGP Fallback (Strict)" },
];

const allIds = (s: ProcessingStage[]) => s.map((x) => x.id);

function neighborLinks(router: RouterId): { neighbor: RouterId; link: (typeof LINKS)[number] }[] {
  return LINKS.filter((l) => l.a === router || l.b === router).map((l) => ({ neighbor: l.a === router ? l.b : l.a, link: l }));
}

export function traceFor(router: RouterId, state: SrPolicyState): DeviceProcessingTrace | undefined {
  const nbrs = neighborLinks(router);
  const ingressIfaceId = nbrs[0] ? `${router}-${nbrs[0].neighbor}` : undefined;
  const egressIfaceId = nbrs[1] ? `${router}-${nbrs[1].neighbor}` : undefined;
  const hops = state.journey.filter((h) => h.router === router);
  const hop = hops[hops.length - 1];
  const isCurrent = state.journey.length > 0 && state.journey[state.journey.length - 1].router === router;

  if (router === "R1") {
    const unavailable = hop?.action === "POLICY_UNAVAILABLE";
    const stages = unavailable ? UNAVAILABLE_PIPELINE : HEADEND_PIPELINE;
    const base: DeviceProcessingTrace = { deviceId: router, egressInterfaceId: egressIfaceId, stages, completedStageIds: [] };
    if (!hop) return base;
    if (unavailable) return { ...base, activeStageId: isCurrent ? "fail" : undefined, completedStageIds: allIds(UNAVAILABLE_PIPELINE), packetBefore: hop.input, packetAfter: hop.output };
    if (isCurrent) return { ...base, activeStageId: hop.action === "POLICY_SELECT" ? "candidate-select" : "impose", completedStageIds: hop.action === "POLICY_SELECT" ? ["arrive", "classify", "policy-key", "state-check"] : allIds(HEADEND_PIPELINE).slice(0, 6), packetBefore: hop.input, packetAfter: hop.output };
    return { ...base, completedStageIds: allIds(HEADEND_PIPELINE), packetBefore: hop.input, packetAfter: hop.output };
  }
  if (router === "R6") {
    const base: DeviceProcessingTrace = { deviceId: router, ingressInterfaceId: ingressIfaceId, stages: TAILEND_PIPELINE, completedStageIds: [] };
    if (!hop) return base;
    if (isCurrent) return { ...base, activeStageId: hop.action === "IP_FORWARD" ? "deliver" : "target-check", completedStageIds: ["label-lookup"], packetBefore: hop.input, packetAfter: hop.output };
    return { ...base, completedStageIds: allIds(TAILEND_PIPELINE), packetBefore: hop.input, packetAfter: hop.output };
  }

  const isAdjExec = hop?.action === "POP_AND_FORWARD_ADJ";
  const stages = isAdjExec ? ADJ_SID_PIPELINE : NODE_SID_PIPELINE;
  const base: DeviceProcessingTrace = { deviceId: router, ingressInterfaceId: ingressIfaceId, egressInterfaceId: egressIfaceId, stages, completedStageIds: [] };
  if (!hop) return base;
  if (isCurrent) {
    return {
      ...base,
      activeStageId: isAdjExec ? "send-adjacency" : hop.action === "POP" ? "label-action" : "forward",
      completedStageIds: isAdjExec ? ["active-lookup", "owner-check", "resolve-adjacency"] : ["ingress", "label-lookup", "identify-instruction", "spt-nexthop"],
      packetBefore: hop.input,
      packetAfter: hop.output,
    };
  }
  return { ...base, completedStageIds: allIds(stages), packetBefore: hop.input, packetAfter: hop.output };
}

export function packetFramesFor(state: SrPolicyState): PacketStackFrame[] | undefined {
  if (!state.packet) return undefined;
  const active = activeCandidateEvaluation(state);
  const activeSid = active?.segmentList.find((s) => s.active)?.sid;
  const labelFrames: PacketStackFrame[] = state.packet.labels.map((l, idx) => ({ id: `label-${idx}`, text: `${l.value === activeSid ? "Active" : "Segment"} ${fmtLabel(l.value)}`, tone: "transport", justChanged: idx === 0 }));
  return [...labelFrames, { id: "ip", text: "IP", tone: "ip" }];
}

export function interfacesFor(router: RouterId, state: SrPolicyState): DeviceInterfaceData[] {
  const upLinkIds = new Set(state.links.map((l) => l.id));
  return neighborLinks(router).map(({ neighbor, link }) => ({
    id: `${router}-${neighbor}`,
    name: `to-${neighbor}`,
    status: upLinkIds.has(link.id) ? "up" : "down",
    neighborId: neighbor,
    neighborLabel: neighbor,
    linkType: "Core",
    mtu: 1500,
    protocols: ["IGP", "SR-TE"],
    role: "idle",
    extra: [{ label: "TE Metric", value: String(link.metric) }, { label: "Affinity", value: link.affinities.join(", ") }],
  }));
}

export function linkDetailFor(linkId: string, state: SrPolicyState): LinkDetail | undefined {
  const link = LINKS.find((l) => l.id === linkId);
  const edge = GRAPH_EDGES.find((e) => e.id === linkId);
  if (!link || !edge) return undefined;
  const isUp = state.links.some((l) => l.id === link.id);
  return {
    aLabel: link.a,
    bLabel: link.b,
    aInterface: { id: `${link.a}-${link.b}`, name: `to-${link.b}`, status: isUp ? "up" : "down", neighborId: link.b, neighborLabel: link.b, linkType: "Core", mtu: 1500, protocols: ["IGP", "SR-TE"], role: "idle" },
    bInterface: { id: `${link.b}-${link.a}`, name: `to-${link.a}`, status: isUp ? "up" : "down", neighborId: link.a, neighborLabel: link.a, linkType: "Core", mtu: 1500, protocols: ["IGP", "SR-TE"], role: "idle" },
    status: isUp ? "up" : "down",
    mtu: 1500,
    protocols: [
      { label: "TE Metric", value: String(link.metric) },
      { label: "Affinity", value: link.affinities.join(", ") },
    ],
  };
}

export function forwardingEntryFor(router: RouterId, state: SrPolicyState) {
  const hops = state.journey.filter((h) => h.router === router);
  return hops[hops.length - 1];
}

export { fmtLabel };
