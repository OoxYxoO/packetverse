import type { DeviceInterfaceData, DeviceProcessingTrace, LinkDetail, PacketStackFrame, ProcessingStage } from "@/components/network3d/types";
import { GRAPH_EDGES, LINKS, type ClientId, type LinkDef, type NodeId, type RouterId, type Srv6PolicyAction, type Srv6PolicyState } from "@/lib/sim-engine/scenarios/srv6Policy";

/**
 * Scene Adapter for SRv6 Policy's device-interior 3D view. Every stage
 * list and interface/link value below is derived FROM Srv6PolicyState
 * — this file makes no policy-selection or behavior-dispatch decision
 * of its own (that lives entirely in the scenario's own pure functions
 * and in the reused srv6EndpointBehaviors.ts execution).
 */

const HEADEND_PIPELINE: ProcessingStage[] = [
  { id: "steering", label: "Steering Match (Color → Policy)" },
  { id: "select", label: "Evaluate Candidates → Select Active" },
  { id: "encaps", label: "H.Encaps (Outer IPv6 + SRH)" },
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
  { id: "match", label: "Local SID Match — Execute Behavior" },
];
const ADJACENCY_PIPELINE: ProcessingStage[] = [
  { id: "bound-adjacency", label: "Use Bound Adjacency (Bypasses Ordinary FIB)" },
  { id: "transmit", label: "Transmit" },
];
const DECAP_PIPELINE: ProcessingStage[] = [
  { id: "final-check", label: "Final-Segment Check" },
  { id: "decap", label: "Remove Outer IPv6 + SRH" },
  { id: "deliver", label: "Deliver To Resolved Target" },
];
const FALLBACK_PIPELINE: ProcessingStage[] = [
  { id: "steering", label: "Steering Match (Color → Policy)" },
  { id: "invalid", label: "Policy Invalid — No Valid Candidate" },
  { id: "action", label: "Apply Invalidation Action" },
];

const STAGES_FOR: Record<Srv6PolicyAction, ProcessingStage[]> = {
  HEADEND_ENCAPS: HEADEND_PIPELINE,
  STEERING_MATCH: HEADEND_PIPELINE,
  POLICY_SELECT: HEADEND_PIPELINE,
  IPV6_FIB_FORWARD: TRANSIT_PIPELINE,
  LOCAL_SID_MATCH: LOCAL_SID_MATCH_PIPELINE,
  ADJACENCY_CROSS_CONNECT: ADJACENCY_PIPELINE,
  DECAP_IPV6: DECAP_PIPELINE,
  DELIVER: DECAP_PIPELINE,
  POLICY_UNAVAILABLE_DROP: FALLBACK_PIPELINE,
  POLICY_UNAVAILABLE_FALLBACK: FALLBACK_PIPELINE,
};

const allIds = (s: ProcessingStage[]) => s.map((x) => x.id);

function neighborLinks(router: RouterId): { neighbor: RouterId; link: LinkDef }[] {
  return LINKS.filter((l) => l.a === router || l.b === router).map((l) => ({ neighbor: l.a === router ? l.b : l.a, link: l }));
}
function edgeNeighborsOf(node: NodeId): NodeId[] {
  return GRAPH_EDGES.filter((e) => e.a === node || e.b === node).map((e) => (e.a === node ? e.b : e.a));
}

export function traceFor(router: RouterId, state: Srv6PolicyState): DeviceProcessingTrace | undefined {
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

export function packetFramesFor(state: Srv6PolicyState): PacketStackFrame[] | undefined {
  if (!state.packet) return undefined;
  const outerFrame: PacketStackFrame = { id: "outer-ipv6", text: `Outer IPv6 (DA=${state.packet.outer.daHextets.map((h) => h.toString(16)).join(":")})`, tone: "ip", justChanged: true };
  const frames: PacketStackFrame[] = [outerFrame];
  if (state.packet.outer.srh) frames.push({ id: "srh", text: `SRH (SL=${state.packet.outer.srh.segmentsLeft}, LE=${state.packet.outer.srh.lastEntry})`, tone: "transport" });
  if (state.packet.inner && state.packet.inner.kind === "IPV6") frames.push({ id: "inner", text: "Inner IPv6 (original probe)", tone: "ip" });
  return frames;
}

export function interfacesFor(router: RouterId, state: Srv6PolicyState): DeviceInterfaceData[] {
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
    extra: [{ label: "IGP Metric", value: String(link.metric) }, { label: "Delay", value: String(link.delay) }, ...sidBadges],
  }));
  const edgeIfaces: DeviceInterfaceData[] = edgeNeighborsOf(router)
    .filter((n) => n === "CLIENT1" || n === "RECEIVER6")
    .map((n) => ({ id: `${router}-${n}`, name: `to-${n}`, status: "up", neighborId: n, neighborLabel: n as ClientId, linkType: "Access", mtu: 1500, protocols: ["Customer"], role: "idle", extra: [{ label: "Attachment", value: n }] }));
  return [...coreIfaces, ...edgeIfaces];
}

export function linkDetailFor(linkId: string, state: Srv6PolicyState): LinkDetail | undefined {
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
    protocols: coreLink ? [{ label: "IGP Metric", value: String(coreLink.metric) }, { label: "Delay", value: String(coreLink.delay) }] : [{ label: "Type", value: "Customer Attachment" }],
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

export function forwardingEntryFor(router: RouterId, state: Srv6PolicyState) {
  const hops = state.journey.filter((h) => h.router === router);
  return hops[hops.length - 1];
}
