import type { DeviceInterfaceData, DeviceProcessingTrace, LinkDetail, PacketStackFrame, ProcessingStage } from "@/components/network3d/types";
import {
  CE_IDS,
  GRAPH_EDGES,
  LINKS,
  buildNamedIpv6Fib,
  fmtIpv6,
  type CeId,
  type LinkDef,
  type NodeId,
  type RouterId,
  type Srv6EndpointAction,
  type Srv6EndpointState,
} from "@/lib/sim-engine/scenarios/srv6EndpointBehaviors";

/**
 * Scene Adapter for SRv6 Endpoint Behaviors' device-interior 3D view.
 * Every stage list and interface/link value below is derived FROM
 * Srv6EndpointState — this file makes no behavior-dispatch decision of
 * its own (that lives entirely in the scenario's
 * processSrv6EndpointBehavior()).
 */

const HEADEND_PIPELINE: ProcessingStage[] = [
  { id: "classify", label: "Classify Traffic" },
  { id: "encaps", label: "Impose Outer IPv6 (+ Inner Payload If Any)" },
  { id: "fib", label: "IPv6 FIB Lookup" },
  { id: "forward", label: "Forward" },
];
const TRANSIT_PIPELINE: ProcessingStage[] = [
  { id: "receive", label: "Receive IPv6 Packet" },
  { id: "local-sid-check", label: "Local SID Table Lookup" },
  { id: "no-match", label: "No Local Match" },
  { id: "fib", label: "IPv6 FIB Lookup" },
  { id: "forward", label: "Forward" },
];
const LOCAL_SID_MATCH_PIPELINE: ProcessingStage[] = [
  { id: "receive", label: "Receive IPv6 Packet" },
  { id: "local-sid-check", label: "Local SID Table Lookup" },
  { id: "match", label: "Local SID Match — Which Behavior?" },
];
const ADJACENCY_PIPELINE: ProcessingStage[] = [
  { id: "bound-adjacency", label: "Use Bound Adjacency (Bypasses Ordinary FIB)" },
  { id: "transmit", label: "Transmit" },
];
const TABLE_LOOKUP_PIPELINE: ProcessingStage[] = [
  { id: "bound-table", label: "Lookup New DA In Bound Table" },
  { id: "transmit", label: "Transmit" },
];
const DECAP_IPV6_PIPELINE: ProcessingStage[] = [
  { id: "final-check", label: "Final-Segment Check" },
  { id: "payload-check", label: "Payload-Type Check (IPv6)" },
  { id: "decap", label: "Remove Outer IPv6 + Extension Headers" },
  { id: "deliver", label: "Deliver To Resolved Target" },
];
const DECAP_IPV4_PIPELINE: ProcessingStage[] = [
  { id: "final-check", label: "Final-Segment Check" },
  { id: "payload-check", label: "Payload-Type Check (IPv4)" },
  { id: "decap", label: "Remove Outer IPv6 + Extension Headers" },
  { id: "deliver", label: "Deliver To Resolved Target" },
];
const DECAP_ETHERNET_PIPELINE: ProcessingStage[] = [
  { id: "final-check", label: "Final-Segment Check" },
  { id: "payload-check", label: "Payload-Type Check (Ethernet)" },
  { id: "decap", label: "Remove Outer IPv6 + Extension Headers" },
  { id: "oif", label: "Forward Via Associated OIF" },
];
const FINAL_END_PIPELINE: ProcessingStage[] = [
  { id: "receive", label: "Receive IPv6 Packet" },
  { id: "local-sid-check", label: "Local SID Table Lookup" },
  { id: "match", label: "Local SID Match — Behavior: End" },
  { id: "final-segment", label: "Segments Left = 0 — Final Segment" },
  { id: "deliver", label: "Next Header / Deliver" },
];
const INVALID_FINAL_PIPELINE: ProcessingStage[] = [
  { id: "receive", label: "Receive IPv6 Packet" },
  { id: "local-sid-check", label: "Local SID Table Lookup" },
  { id: "match", label: "Local SID Match" },
  { id: "final-check", label: "Final-Segment Check: FAILED (SL≠0)" },
  { id: "drop", label: "Drop — Not Executed" },
];
const PAYLOAD_MISMATCH_PIPELINE: ProcessingStage[] = [
  { id: "final-check", label: "Final-Segment Check" },
  { id: "payload-check", label: "Payload-Type Check: FAILED" },
  { id: "drop", label: "Drop — Not Executed" },
];
const DROP_MISSING_SID_PIPELINE: ProcessingStage[] = [
  { id: "receive", label: "Receive IPv6 Packet" },
  { id: "local-sid-check", label: "Local SID Table Lookup" },
  { id: "no-entry", label: "NO ENTRY FOR ACTIVE SID" },
  { id: "drop", label: "Drop" },
];

const STAGES_FOR: Record<Srv6EndpointAction, ProcessingStage[]> = {
  HEADEND_ENCAPS: HEADEND_PIPELINE,
  IPV6_FIB_FORWARD: TRANSIT_PIPELINE,
  LOCAL_SID_MATCH: LOCAL_SID_MATCH_PIPELINE,
  ADJACENCY_CROSS_CONNECT: ADJACENCY_PIPELINE,
  TABLE_LOOKUP: TABLE_LOOKUP_PIPELINE,
  DECAP_IPV6: DECAP_IPV6_PIPELINE,
  DECAP_IPV4: DECAP_IPV4_PIPELINE,
  DECAP_ETHERNET: DECAP_ETHERNET_PIPELINE,
  L2_CROSS_CONNECT: DECAP_ETHERNET_PIPELINE,
  FINAL_END: FINAL_END_PIPELINE,
  DELIVER: FINAL_END_PIPELINE,
  DROP_MISSING_LOCAL_SID: DROP_MISSING_SID_PIPELINE,
  INVALID_FINAL_SEGMENT: INVALID_FINAL_PIPELINE,
  PAYLOAD_TYPE_MISMATCH: PAYLOAD_MISMATCH_PIPELINE,
};

const allIds = (s: ProcessingStage[]) => s.map((x) => x.id);

function neighborLinks(router: RouterId): { neighbor: RouterId; link: LinkDef }[] {
  return LINKS.filter((l) => l.a === router || l.b === router).map((l) => ({ neighbor: l.a === router ? l.b : l.a, link: l }));
}
function ceNeighborsOf(router: RouterId): CeId[] {
  return router === "R6" ? CE_IDS : [];
}

export function traceFor(router: RouterId, state: Srv6EndpointState): DeviceProcessingTrace | undefined {
  const nbrs = neighborLinks(router);
  const ingressIfaceId = nbrs[0] ? `${router}-${nbrs[0].neighbor}` : undefined;
  const egressIfaceId = nbrs[1] ? `${router}-${nbrs[1].neighbor}` : undefined;
  const hops = state.journey.filter((h) => h.router === router);
  const hop = hops[hops.length - 1];
  const isCurrent = state.journey.length > 0 && state.journey[state.journey.length - 1].router === router;

  if (!hop) {
    const stages = router === "R1" ? HEADEND_PIPELINE : TRANSIT_PIPELINE;
    return { deviceId: router, ingressInterfaceId: router === "R1" ? undefined : ingressIfaceId, egressInterfaceId: egressIfaceId, stages, completedStageIds: [] };
  }

  const stages = STAGES_FOR[hop.action];
  const activeStageId = isCurrent ? stages[stages.length - 1]?.id : undefined;
  const completedStageIds = isCurrent ? stages.slice(0, -1).map((s) => s.id) : allIds(stages);
  return { deviceId: router, ingressInterfaceId: ingressIfaceId, egressInterfaceId: egressIfaceId, stages, activeStageId, completedStageIds, packetBefore: hop.input, packetAfter: hop.output };
}

export function packetFramesFor(state: Srv6EndpointState): PacketStackFrame[] | undefined {
  if (!state.packet) return undefined;
  const outerFrame: PacketStackFrame = { id: "outer-ipv6", text: `Outer IPv6 (DA=${fmtIpv6(state.packet.outer.daHextets)})`, tone: "ip", justChanged: true };
  const frames: PacketStackFrame[] = [outerFrame];
  if (state.packet.outer.srh) frames.push({ id: "srh", text: `SRH (SL=${state.packet.outer.srh.segmentsLeft}, LE=${state.packet.outer.srh.lastEntry})`, tone: "transport" });
  const inner = state.packet.inner;
  if (!inner) {
    frames.push({ id: "payload", text: "Payload", tone: "generic" });
  } else if (inner.kind === "IPV6") {
    frames.push({ id: "inner", text: `Inner IPv6 (dst=${fmtIpv6(inner.dstHextets)})`, tone: "ip" });
  } else if (inner.kind === "IPV4") {
    frames.push({ id: "inner", text: `Inner IPv4 (dst=${inner.dstIp})`, tone: "ip" });
  } else {
    frames.push({ id: "inner", text: `Inner Ethernet (${inner.srcMac} → ${inner.dstMac})`, tone: "generic" });
  }
  return frames;
}

export function interfacesFor(router: RouterId, state: Srv6EndpointState): DeviceInterfaceData[] {
  const entries = state.localSidTable[router] ?? [];
  const sidBadges = entries.length ? [{ label: "Local SIDs Owned", value: String(entries.length) }] : [];
  const coreIfaces: DeviceInterfaceData[] = neighborLinks(router).map(({ neighbor, link }) => ({
    id: `${router}-${neighbor}`,
    name: `to-${neighbor}`,
    status: "up",
    neighborId: neighbor,
    neighborLabel: neighbor,
    linkType: "Core",
    mtu: 1500,
    protocols: ["IGP", "SRv6"],
    role: "idle",
    extra: [{ label: "IGP Metric", value: String(link.metric) }, ...sidBadges],
  }));
  const ceIfaces: DeviceInterfaceData[] = ceNeighborsOf(router).map((ce) => ({
    id: `${router}-${ce}`,
    name: `to-${ce}`,
    status: "up",
    neighborId: ce,
    neighborLabel: ce,
    linkType: "Access",
    mtu: 1500,
    protocols: ["Customer"],
    role: "idle",
    extra: [{ label: "Attachment", value: ce }],
  }));
  return [...coreIfaces, ...ceIfaces];
}

export function linkDetailFor(linkId: string, state: Srv6EndpointState): LinkDetail | undefined {
  const edge = GRAPH_EDGES.find((e) => e.id === linkId);
  if (!edge) return undefined;
  const coreLink = LINKS.find((l) => l.id === linkId);
  const onPath = linkIdsFor(state.journey.map((h) => h.router)).includes(linkId);
  return {
    aLabel: edge.a,
    bLabel: edge.b,
    aInterface: { id: `${edge.a}-${edge.b}`, name: `to-${edge.b}`, status: "up", neighborId: edge.b, neighborLabel: edge.b, linkType: coreLink ? "Core" : "Access", mtu: 1500, protocols: coreLink ? ["IGP", "SRv6"] : ["Customer"], role: "idle" },
    bInterface: { id: `${edge.b}-${edge.a}`, name: `to-${edge.a}`, status: "up", neighborId: edge.a, neighborLabel: edge.a, linkType: coreLink ? "Core" : "Access", mtu: 1500, protocols: coreLink ? ["IGP", "SRv6"] : ["Customer"], role: "idle" },
    status: "up",
    mtu: 1500,
    protocols: coreLink ? [{ label: "IGP Metric", value: String(coreLink.metric) }] : [{ label: "Type", value: "Customer Attachment" }],
    currentTraffic: onPath ? "Carrying current packet's journey" : undefined,
  };
}

function linkIdsFor(path: NodeId[]): string[] {
  const ids: string[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const e = GRAPH_EDGES.find((x) => (x.a === path[i] && x.b === path[i + 1]) || (x.b === path[i] && x.a === path[i + 1]));
    if (e) ids.push(e.id);
  }
  return ids;
}

export function forwardingEntryFor(router: RouterId, state: Srv6EndpointState) {
  const hops = state.journey.filter((h) => h.router === router);
  return hops[hops.length - 1];
}

export function ipv6FibFor(router: RouterId, state: Srv6EndpointState, table: "MAIN" | "CORE-B" = "MAIN") {
  return buildNamedIpv6Fib(router, state.links, state.locators, table);
}
