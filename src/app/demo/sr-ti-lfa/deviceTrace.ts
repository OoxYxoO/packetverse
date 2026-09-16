import type { DeviceInterfaceData, DeviceProcessingTrace, LinkDetail, PacketStackFrame, ProcessingStage } from "@/components/network3d/types";
import { BASE_LINKS, GRAPH_EDGES, type LinkDef, type RouterId, type SrTiLfaState } from "@/lib/sim-engine/scenarios/srTiLfa";

/**
 * Scene Adapter for the SR-MPLS TI-LFA lesson's device-interior 3D
 * view. Every stage list and interface/link value below is derived
 * FROM SrTiLfaState — this file makes no TI-LFA computation itself.
 */

const HEADEND_PIPELINE: ProcessingStage[] = [
  { id: "arrive", label: "Packet Arrives" },
  { id: "impose", label: "Impose R6 Node SID" },
  { id: "forward", label: "Forward" },
];
const PLR_NORMAL_PIPELINE: ProcessingStage[] = [
  { id: "ingress", label: "MPLS Ingress" },
  { id: "primary-lookup", label: "Primary Next-Hop Lookup" },
  { id: "forward", label: "Forward" },
];
const PLR_REPAIR_PIPELINE: ProcessingStage[] = [
  { id: "ingress", label: "MPLS Ingress" },
  { id: "primary-lookup", label: "Primary Next-Hop Lookup" },
  { id: "resource-down", label: "Protected Resource DOWN" },
  { id: "backup-lookup", label: "TI-LFA Backup Lookup" },
  { id: "ready-check", label: "Repair State READY?" },
  { id: "obtain-list", label: "Obtain Repair Segment List" },
  { id: "push-repair", label: "Push Repair Segment(s)" },
  { id: "forward", label: "Forward On Safe Next Hop" },
];
const TRANSIT_PIPELINE: ProcessingStage[] = [
  { id: "ingress", label: "MPLS Ingress" },
  { id: "label-lookup", label: "Active SID Lookup" },
  { id: "spf-nexthop", label: "Own Shortest-Path Next Hop" },
  { id: "forward", label: "Forward" },
];
const REPAIR_ENDPOINT_PIPELINE: ProcessingStage[] = [
  { id: "label-lookup", label: "Active SID Lookup" },
  { id: "target-check", label: "Self Is Repair Segment Target" },
  { id: "pop-repair", label: "Pop Repair Segment" },
  { id: "expose-original", label: "Original SID Becomes Active" },
  { id: "forward", label: "Forward (Ordinary SR Forwarding)" },
];
const DESTINATION_PIPELINE: ProcessingStage[] = [
  { id: "label-lookup", label: "Label Lookup" },
  { id: "target-check", label: "Self Is Segment Target" },
  { id: "deliver", label: "Deliver" },
];

const allIds = (s: ProcessingStage[]) => s.map((x) => x.id);

function neighborLinks(router: RouterId, links: LinkDef[]): { neighbor: RouterId; link: LinkDef }[] {
  return links.filter((l) => l.a === router || l.b === router).map((l) => ({ neighbor: l.a === router ? l.b : l.a, link: l }));
}

export function traceFor(router: RouterId, state: SrTiLfaState): DeviceProcessingTrace | undefined {
  const nbrs = neighborLinks(router, BASE_LINKS);
  const ingressIfaceId = nbrs[0] ? `${router}-${nbrs[0].neighbor}` : undefined;
  const egressIfaceId = nbrs[1] ? `${router}-${nbrs[1].neighbor}` : undefined;
  const hops = state.journey.filter((h) => h.router === router);
  const hop = hops[hops.length - 1];
  const isCurrent = state.journey.length > 0 && state.journey[state.journey.length - 1].router === router;

  if (router === "R1") {
    const base: DeviceProcessingTrace = { deviceId: router, egressInterfaceId: egressIfaceId, stages: HEADEND_PIPELINE, completedStageIds: [] };
    if (!hop) return base;
    if (isCurrent) return { ...base, activeStageId: "forward", completedStageIds: ["arrive", "impose"], packetBefore: hop.input, packetAfter: hop.output };
    return { ...base, completedStageIds: allIds(HEADEND_PIPELINE), packetBefore: hop.input, packetAfter: hop.output };
  }

  if (router === "R2") {
    const isRepair = hop?.action === "PUSH_REPAIR" || hop?.action === "PUSH_REPAIR_STALE";
    const stages = isRepair ? PLR_REPAIR_PIPELINE : PLR_NORMAL_PIPELINE;
    const base: DeviceProcessingTrace = { deviceId: router, ingressInterfaceId: ingressIfaceId, egressInterfaceId: egressIfaceId, stages, completedStageIds: [] };
    if (!hop) return base;
    if (isCurrent) {
      return {
        ...base,
        activeStageId: isRepair ? "push-repair" : "forward",
        completedStageIds: isRepair ? ["ingress", "primary-lookup", "resource-down", "backup-lookup", "ready-check", "obtain-list"] : ["ingress", "primary-lookup"],
        packetBefore: hop.input,
        packetAfter: hop.output,
      };
    }
    return { ...base, completedStageIds: allIds(stages), packetBefore: hop.input, packetAfter: hop.output };
  }

  if (router === "R6") {
    const base: DeviceProcessingTrace = { deviceId: router, ingressInterfaceId: ingressIfaceId, stages: DESTINATION_PIPELINE, completedStageIds: [] };
    if (!hop) return base;
    if (isCurrent) return { ...base, activeStageId: hop.action === "DELIVER" ? "deliver" : "target-check", completedStageIds: ["label-lookup"], packetBefore: hop.input, packetAfter: hop.output };
    return { ...base, completedStageIds: allIds(DESTINATION_PIPELINE), packetBefore: hop.input, packetAfter: hop.output };
  }

  // R3, R4, R5 — ordinary transit, except whichever one is currently
  // the active repair point (POP_REPAIR) for this journey.
  const isRepairEndpoint = hop?.action === "POP_REPAIR";
  const stages = isRepairEndpoint ? REPAIR_ENDPOINT_PIPELINE : TRANSIT_PIPELINE;
  const base: DeviceProcessingTrace = { deviceId: router, ingressInterfaceId: ingressIfaceId, egressInterfaceId: egressIfaceId, stages, completedStageIds: [] };
  if (!hop) return base;
  if (isCurrent) {
    return {
      ...base,
      activeStageId: isRepairEndpoint ? "expose-original" : "forward",
      completedStageIds: isRepairEndpoint ? ["label-lookup", "target-check", "pop-repair"] : ["ingress", "label-lookup", "spf-nexthop"],
      packetBefore: hop.input,
      packetAfter: hop.output,
    };
  }
  return { ...base, completedStageIds: allIds(stages), packetBefore: hop.input, packetAfter: hop.output };
}

export function packetFramesFor(state: SrTiLfaState): PacketStackFrame[] | undefined {
  if (!state.packet) return undefined;
  const labelFrames: PacketStackFrame[] = state.packet.labels.map((l, idx) => ({
    id: `label-${idx}`,
    text: `${l.purpose === "repair" ? "Repair" : "SR"} ${l.value}`,
    tone: l.purpose === "repair" ? "vpn" : "transport",
    justChanged: idx === 0,
  }));
  return [...labelFrames, { id: "ip", text: "IP", tone: "ip" }];
}

export function interfacesFor(router: RouterId, state: SrTiLfaState): DeviceInterfaceData[] {
  const upLinkIds = new Set(state.links.filter((l) => !state.failedLinkIds.includes(l.id)).map((l) => l.id));
  return neighborLinks(router, BASE_LINKS).map(({ neighbor, link }) => {
    const currentMetric = state.links.find((l) => l.id === link.id)?.metric ?? link.metric;
    const isFailedNode = state.failedNode === router || state.failedNode === neighbor;
    return {
      id: `${router}-${neighbor}`,
      name: `to-${neighbor}`,
      status: upLinkIds.has(link.id) && !isFailedNode ? "up" : "down",
      neighborId: neighbor,
      neighborLabel: neighbor,
      linkType: "Core",
      mtu: 1500,
      protocols: ["IGP", "SR-MPLS"],
      role: "idle",
      extra: [{ label: "IGP Metric", value: String(currentMetric) }],
    };
  });
}

export function linkDetailFor(linkId: string, state: SrTiLfaState): LinkDetail | undefined {
  const link = BASE_LINKS.find((l) => l.id === linkId);
  const edge = GRAPH_EDGES.find((e) => e.id === linkId);
  if (!link || !edge) return undefined;
  const currentMetric = state.links.find((l) => l.id === link.id)?.metric ?? link.metric;
  const isUp = !state.failedLinkIds.includes(link.id);
  return {
    aLabel: link.a,
    bLabel: link.b,
    aInterface: { id: `${link.a}-${link.b}`, name: `to-${link.b}`, status: isUp ? "up" : "down", neighborId: link.b, neighborLabel: link.b, linkType: "Core", mtu: 1500, protocols: ["IGP", "SR-MPLS"], role: "idle" },
    bInterface: { id: `${link.b}-${link.a}`, name: `to-${link.a}`, status: isUp ? "up" : "down", neighborId: link.a, neighborLabel: link.a, linkType: "Core", mtu: 1500, protocols: ["IGP", "SR-MPLS"], role: "idle" },
    status: isUp ? "up" : "down",
    mtu: 1500,
    protocols: [{ label: "IGP Metric", value: String(currentMetric) }],
  };
}
