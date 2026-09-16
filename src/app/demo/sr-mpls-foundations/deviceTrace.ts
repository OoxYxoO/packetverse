import type { DeviceInterfaceData, DeviceProcessingTrace, LinkDetail, PacketStackFrame, ProcessingStage } from "@/components/network3d/types";
import {
  GRAPH_EDGES,
  LINKS,
  fmtLabel,
  resolveActiveSegment,
  type LinkId,
  type RouterId,
  type SrMplsState,
} from "@/lib/sim-engine/scenarios/srMplsFoundations";

/**
 * Scene Adapter for SR-MPLS Foundations' device-interior 3D view. Every
 * stage list and interface/link value below is derived FROM SrMplsState
 * — this file makes no SID/segment/IGP decision itself.
 */

const NODE_SID_PIPELINE: ProcessingStage[] = [
  { id: "ingress", label: "MPLS Ingress" },
  { id: "label-lookup", label: "Active SID Label Lookup" },
  { id: "identify-instruction", label: "Identify Prefix-SID / Forwarding Instruction" },
  { id: "spt-nexthop", label: "Shortest-Path Next Hop Toward SID Prefix" },
  { id: "label-action", label: "MPLS Label Action" },
  { id: "forward", label: "Forward" },
];
const ADJ_SID_PIPELINE: ProcessingStage[] = [
  { id: "active-lookup", label: "Active SID Lookup" },
  { id: "owner-check", label: "SID Owner = Local Router" },
  { id: "type-check", label: "SID Type = Adjacency" },
  { id: "resolve-adjacency", label: "Resolve Specified Adjacency" },
  { id: "send-adjacency", label: "Send Over That Adjacency" },
  { id: "next-active", label: "Next Segment Becomes Active" },
];
const HEADEND_PIPELINE: ProcessingStage[] = [
  { id: "classify", label: "Classify Into Segment List" },
  { id: "push", label: "PUSH Segment Stack" },
  { id: "egress", label: "Egress" },
];
const TAILEND_PIPELINE: ProcessingStage[] = [
  { id: "label-lookup", label: "Label Lookup" },
  { id: "target-check", label: "Self Is Segment Target" },
  { id: "deliver", label: "Deliver" },
];
const INVALID_PIPELINE: ProcessingStage[] = [
  { id: "active-lookup", label: "Active SID Lookup" },
  { id: "ownership-check", label: "Ownership / Scope Check" },
  { id: "not-owned", label: "NOT OWNED HERE" },
  { id: "drop", label: "Drop" },
];

const allIds = (s: ProcessingStage[]) => s.map((x) => x.id);

function neighborLinks(router: RouterId): { neighbor: RouterId; link: (typeof LINKS)[number] }[] {
  return LINKS.filter((l) => l.a === router || l.b === router).map((l) => ({ neighbor: l.a === router ? l.b : l.a, link: l }));
}

export function traceFor(router: RouterId, state: SrMplsState): DeviceProcessingTrace | undefined {
  const nbrs = neighborLinks(router);
  const ingressIfaceId = nbrs[0] ? `${router}-${nbrs[0].neighbor}` : undefined;
  const egressIfaceId = nbrs[1] ? `${router}-${nbrs[1].neighbor}` : undefined;
  const hops = state.journey.filter((h) => h.router === router);
  const hop = hops[hops.length - 1];
  const isCurrent = state.journey.length > 0 && state.journey[state.journey.length - 1].router === router;

  if (router === "R1") {
    const invalid = state.fault && hop?.action === "INVALID_SID";
    const stages = invalid ? INVALID_PIPELINE : HEADEND_PIPELINE;
    const base: DeviceProcessingTrace = { deviceId: router, egressInterfaceId: egressIfaceId, stages, completedStageIds: [] };
    if (!hop) return base;
    if (invalid) return { ...base, activeStageId: isCurrent ? "drop" : undefined, completedStageIds: allIds(INVALID_PIPELINE), packetBefore: hop.input, packetAfter: hop.output };
    if (isCurrent) return { ...base, activeStageId: "push", completedStageIds: ["classify"], packetBefore: hop.input, packetAfter: hop.output };
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
      completedStageIds: isAdjExec ? ["active-lookup", "owner-check", "type-check", "resolve-adjacency"] : ["ingress", "label-lookup", "identify-instruction", "spt-nexthop"],
      packetBefore: hop.input,
      packetAfter: hop.output,
    };
  }
  return { ...base, completedStageIds: allIds(stages), packetBefore: hop.input, packetAfter: hop.output };
}

export function packetFramesFor(state: SrMplsState): PacketStackFrame[] | undefined {
  if (!state.packet) return undefined;
  const active = resolveActiveSegment(state.segmentList ?? []);
  const labelFrames: PacketStackFrame[] = state.packet.labels.map((l, idx) => ({ id: `label-${idx}`, text: `${l.value === active?.sid ? "Active" : "Segment"} ${fmtLabel(l.value)}`, tone: "transport", justChanged: idx === 0 }));
  return [...labelFrames, { id: "ip", text: "IP", tone: "ip" }];
}

export function interfacesFor(router: RouterId, state: SrMplsState): DeviceInterfaceData[] {
  const ownedAdj = state.adjSids.filter((a) => a.owner === router);
  return neighborLinks(router).map(({ neighbor, link }) => {
    const adj = ownedAdj.find((a) => a.neighbor === neighbor);
    return {
      id: `${router}-${neighbor}`,
      name: `to-${neighbor}`,
      status: "up",
      neighborId: neighbor,
      neighborLabel: neighbor,
      linkType: "Core",
      mtu: 1500,
      protocols: ["IGP", "SR-MPLS"],
      role: "idle",
      extra: [{ label: "IGP Metric", value: String(link.metric) }, ...(adj ? [{ label: "Local Adj-SID", value: String(adj.label) }] : [])],
    };
  });
}

export function linkDetailFor(linkId: string, state: SrMplsState): LinkDetail | undefined {
  const link = LINKS.find((l) => l.id === linkId);
  const edge = GRAPH_EDGES.find((e) => e.id === linkId);
  if (!link || !edge) return undefined;
  const onPath = linkIdsFor(state.journey.map((h) => h.router)).includes(link.id as LinkId);
  return {
    aLabel: link.a,
    bLabel: link.b,
    aInterface: { id: `${link.a}-${link.b}`, name: `to-${link.b}`, status: "up", neighborId: link.b, neighborLabel: link.b, linkType: "Core", mtu: 1500, protocols: ["IGP", "SR-MPLS"], role: "idle" },
    bInterface: { id: `${link.b}-${link.a}`, name: `to-${link.a}`, status: "up", neighborId: link.a, neighborLabel: link.a, linkType: "Core", mtu: 1500, protocols: ["IGP", "SR-MPLS"], role: "idle" },
    status: "up",
    mtu: 1500,
    protocols: [
      { label: "IGP Metric", value: String(link.metric) },
      { label: "Adj-SID (a→b)", value: String(state.adjSids.find((a) => a.owner === link.a && a.neighbor === link.b)?.label ?? "—") },
      { label: "Adj-SID (b→a)", value: String(state.adjSids.find((a) => a.owner === link.b && a.neighbor === link.a)?.label ?? "—") },
    ],
    currentTraffic: onPath ? "Carrying current packet's journey" : undefined,
  };
}

function linkIdsFor(path: RouterId[]): LinkId[] {
  const ids: LinkId[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const l = LINKS.find((x) => (x.a === path[i] && x.b === path[i + 1]) || (x.b === path[i] && x.a === path[i + 1]));
    if (l) ids.push(l.id);
  }
  return ids;
}

export function forwardingEntryFor(router: RouterId, state: SrMplsState) {
  const hops = state.journey.filter((h) => h.router === router);
  return hops[hops.length - 1];
}

export { fmtLabel };
