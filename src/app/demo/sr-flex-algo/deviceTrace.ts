import type { DeviceInterfaceData, DeviceProcessingTrace, LinkDetail, PacketStackFrame, ProcessingStage } from "@/components/network3d/types";
import { BASE_LINKS, GRAPH_EDGES, type LinkDef, type RouterId, type SrFlexAlgoState } from "@/lib/sim-engine/scenarios/srFlexAlgo";

/**
 * Scene Adapter for the SR-MPLS Flex-Algo lesson's device-interior 3D
 * view. Every stage list and interface/link value below is derived
 * FROM SrFlexAlgoState — this file makes no Flex-Algo computation.
 */

const HEADEND_PIPELINE: ProcessingStage[] = [
  { id: "arrive", label: "Packet Arrives" },
  { id: "classify", label: "Classify Toward Algorithm-Specific Prefix-SID" },
  { id: "impose", label: "Impose Algorithm Prefix-SID" },
  { id: "forward", label: "Forward" },
];
const TRANSIT_PIPELINE: ProcessingStage[] = [
  { id: "ingress", label: "MPLS Ingress" },
  { id: "label-lookup", label: "Active SID Lookup" },
  { id: "algo-spf", label: "This Algorithm's Own SPF Next Hop" },
  { id: "forward", label: "Forward" },
];
const DESTINATION_PIPELINE: ProcessingStage[] = [
  { id: "label-lookup", label: "Label Lookup" },
  { id: "target-check", label: "Self Is SID Target" },
  { id: "deliver", label: "Deliver" },
];

const allIds = (s: ProcessingStage[]) => s.map((x) => x.id);

function neighborLinks(router: RouterId, links: LinkDef[]): { neighbor: RouterId; link: LinkDef }[] {
  return links.filter((l) => l.a === router || l.b === router).map((l) => ({ neighbor: l.a === router ? l.b : l.a, link: l }));
}

export function traceFor(router: RouterId, state: SrFlexAlgoState): DeviceProcessingTrace | undefined {
  const nbrs = neighborLinks(router, BASE_LINKS);
  const ingressIfaceId = nbrs[0] ? `${router}-${nbrs[0].neighbor}` : undefined;
  const egressIfaceId = nbrs[1] ? `${router}-${nbrs[1].neighbor}` : undefined;
  const hops = state.journey.filter((h) => h.router === router);
  const hop = hops[hops.length - 1];
  const isCurrent = state.journey.length > 0 && state.journey[state.journey.length - 1].router === router;

  if (router === "R1") {
    const base: DeviceProcessingTrace = { deviceId: router, egressInterfaceId: egressIfaceId, stages: HEADEND_PIPELINE, completedStageIds: [] };
    if (!hop) return base;
    if (isCurrent) return { ...base, activeStageId: "forward", completedStageIds: ["arrive", "classify", "impose"], packetBefore: hop.input, packetAfter: hop.output };
    return { ...base, completedStageIds: allIds(HEADEND_PIPELINE), packetBefore: hop.input, packetAfter: hop.output };
  }

  if (router === "R6") {
    const base: DeviceProcessingTrace = { deviceId: router, ingressInterfaceId: ingressIfaceId, stages: DESTINATION_PIPELINE, completedStageIds: [] };
    if (!hop) return base;
    if (isCurrent) return { ...base, activeStageId: hop.action === "DELIVER" ? "deliver" : "target-check", completedStageIds: ["label-lookup"], packetBefore: hop.input, packetAfter: hop.output };
    return { ...base, completedStageIds: allIds(DESTINATION_PIPELINE), packetBefore: hop.input, packetAfter: hop.output };
  }

  // R2, R3, R4, R5 — ordinary algorithm-specific transit.
  const base: DeviceProcessingTrace = { deviceId: router, ingressInterfaceId: ingressIfaceId, egressInterfaceId: egressIfaceId, stages: TRANSIT_PIPELINE, completedStageIds: [] };
  if (!hop) return base;
  if (isCurrent) return { ...base, activeStageId: "forward", completedStageIds: ["ingress", "label-lookup", "algo-spf"], packetBefore: hop.input, packetAfter: hop.output };
  return { ...base, completedStageIds: allIds(TRANSIT_PIPELINE), packetBefore: hop.input, packetAfter: hop.output };
}

export function packetFramesFor(state: SrFlexAlgoState): PacketStackFrame[] | undefined {
  if (!state.packet) return undefined;
  const labelFrames: PacketStackFrame[] = state.packet.labels.map((l, idx) => ({ id: `label-${idx}`, text: `Algo ${state.activeAlgorithm} · ${l.value}`, tone: "transport", justChanged: idx === 0 }));
  return [...labelFrames, { id: "ip", text: "IP", tone: "ip" }];
}

export function interfacesFor(router: RouterId, state: SrFlexAlgoState): DeviceInterfaceData[] {
  return neighborLinks(router, BASE_LINKS).map(({ neighbor, link }) => {
    const participants128 = state.algorithmParticipation;
    const bothParticipate128 = (participants128[router] ?? []).includes(128) && (participants128[neighbor] ?? []).includes(128);
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
      extra: [
        { label: "IGP Metric", value: String(link.igpMetric) },
        { label: "Delay Metric", value: String(link.delayMetric) },
        { label: "Affinity", value: link.affinity ?? "none" },
        { label: "Algorithm 128 Eligible (participation)", value: bothParticipate128 ? "yes" : "no" },
      ],
    };
  });
}

export function linkDetailFor(linkId: string, state: SrFlexAlgoState): LinkDetail | undefined {
  const link = BASE_LINKS.find((l) => l.id === linkId);
  const edge = GRAPH_EDGES.find((e) => e.id === linkId);
  if (!link || !edge) return undefined;
  void state;
  return {
    aLabel: link.a,
    bLabel: link.b,
    aInterface: { id: `${link.a}-${link.b}`, name: `to-${link.b}`, status: "up", neighborId: link.b, neighborLabel: link.b, linkType: "Core", mtu: 1500, protocols: ["IGP", "SR-MPLS"], role: "idle" },
    bInterface: { id: `${link.b}-${link.a}`, name: `to-${link.a}`, status: "up", neighborId: link.a, neighborLabel: link.a, linkType: "Core", mtu: 1500, protocols: ["IGP", "SR-MPLS"], role: "idle" },
    status: "up",
    mtu: 1500,
    protocols: [
      { label: "IGP Metric", value: String(link.igpMetric) },
      { label: "Delay Metric", value: String(link.delayMetric) },
      { label: "Affinity", value: link.affinity ?? "none" },
    ],
  };
}
