import type { DeviceInterfaceData, DeviceProcessingTrace, LinkDetail, PacketStackFrame, ProcessingStage } from "@/components/network3d/types";
import {
  GRAPH_EDGES,
  LINKS,
  buildIpv6Fib,
  fmtIpv6,
  type LinkId,
  type RouterId,
  type Srv6State,
} from "@/lib/sim-engine/scenarios/srv6Foundations";

/**
 * Scene Adapter for SRv6 Foundations' device-interior 3D view. Every
 * stage list and interface/link value below is derived FROM Srv6State
 * — this file makes no SID/SRH/IGP decision of its own.
 */

const TRANSIT_PIPELINE: ProcessingStage[] = [
  { id: "receive", label: "Receive IPv6 Packet" },
  { id: "local-sid-check", label: "Local SID Table Lookup" },
  { id: "no-match", label: "No Local Match" },
  { id: "fib-lookup", label: "IPv6 FIB Lookup" },
  { id: "forward", label: "Forward" },
];
const HEADEND_PIPELINE: ProcessingStage[] = [
  { id: "classify", label: "Classify Into Segment Program" },
  { id: "impose-da", label: "Impose DA (+ SRH If Needed)" },
  { id: "fib-lookup", label: "IPv6 FIB Lookup" },
  { id: "forward", label: "Forward" },
];
const END_PIPELINE: ProcessingStage[] = [
  { id: "receive", label: "Receive IPv6 Packet" },
  { id: "local-sid-check", label: "Local SID Table Lookup" },
  { id: "match", label: "Local SID Match — Behavior: End" },
  { id: "decrement-sl", label: "Decrement Segments Left" },
  { id: "update-da", label: "Copy Segment List[SL] Into DA" },
];
const FINAL_END_PIPELINE: ProcessingStage[] = [
  { id: "receive", label: "Receive IPv6 Packet" },
  { id: "local-sid-check", label: "Local SID Table Lookup" },
  { id: "match", label: "Local SID Match — Behavior: End" },
  { id: "final-segment", label: "Segments Left = 0 — Final Segment" },
  { id: "deliver", label: "Next Header / Deliver" },
];
const DROP_PIPELINE: ProcessingStage[] = [
  { id: "receive", label: "Receive IPv6 Packet" },
  { id: "local-sid-check", label: "Local SID Table Lookup" },
  { id: "no-entry", label: "NO ENTRY FOR ACTIVE SID" },
  { id: "drop", label: "Drop" },
];

const allIds = (s: ProcessingStage[]) => s.map((x) => x.id);

function neighborLinks(router: RouterId): { neighbor: RouterId; link: (typeof LINKS)[number] }[] {
  return LINKS.filter((l) => l.a === router || l.b === router).map((l) => ({ neighbor: l.a === router ? l.b : l.a, link: l }));
}

export function traceFor(router: RouterId, state: Srv6State): DeviceProcessingTrace | undefined {
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

  if (hop.action === "DROP_MISSING_LOCAL_SID") {
    return { deviceId: router, ingressInterfaceId: ingressIfaceId, stages: DROP_PIPELINE, activeStageId: isCurrent ? "drop" : undefined, completedStageIds: isCurrent ? ["receive", "local-sid-check", "no-entry"] : allIds(DROP_PIPELINE), packetBefore: hop.input, packetAfter: hop.output };
  }

  if (hop.action === "LOCAL_SID_MATCH") {
    return { deviceId: router, ingressInterfaceId: ingressIfaceId, stages: END_PIPELINE, activeStageId: isCurrent ? "match" : undefined, completedStageIds: isCurrent ? ["receive", "local-sid-check"] : ["receive", "local-sid-check", "match"], packetBefore: hop.input, packetAfter: hop.output };
  }

  if (hop.action === "DA_UPDATE") {
    return { deviceId: router, ingressInterfaceId: ingressIfaceId, egressInterfaceId: egressIfaceId, stages: END_PIPELINE, activeStageId: isCurrent ? "update-da" : undefined, completedStageIds: isCurrent ? ["receive", "local-sid-check", "match", "decrement-sl"] : allIds(END_PIPELINE), packetBefore: hop.input, packetAfter: hop.output };
  }

  if (hop.action === "FINAL_END" || (hop.action === "DELIVER" && router !== "R1")) {
    return { deviceId: router, ingressInterfaceId: ingressIfaceId, stages: FINAL_END_PIPELINE, activeStageId: isCurrent ? "deliver" : undefined, completedStageIds: isCurrent ? ["receive", "local-sid-check", "match", "final-segment"] : allIds(FINAL_END_PIPELINE), packetBefore: hop.input, packetAfter: hop.output };
  }

  // IPV6_FIB_FORWARD — ordinary transit (also R1's headend forward)
  const stages = router === "R1" ? HEADEND_PIPELINE : TRANSIT_PIPELINE;
  const activeId = router === "R1" ? "forward" : "fib-lookup";
  const completed = router === "R1" ? ["classify", "impose-da", "fib-lookup"] : ["receive", "local-sid-check", "no-match"];
  return { deviceId: router, ingressInterfaceId: router === "R1" ? undefined : ingressIfaceId, egressInterfaceId: egressIfaceId, stages, activeStageId: isCurrent ? activeId : undefined, completedStageIds: isCurrent ? completed : allIds(stages), packetBefore: hop.input, packetAfter: hop.output };
}

export function packetFramesFor(state: Srv6State): PacketStackFrame[] | undefined {
  if (!state.packet) return undefined;
  const ipv6Frame: PacketStackFrame = { id: "ipv6", text: `IPv6 (DA=${fmtIpv6(state.packet.daHextets)})`, tone: "ip", justChanged: true };
  if (!state.packet.srh) return [ipv6Frame, { id: "payload", text: "Payload", tone: "generic" }];
  const srhFrame: PacketStackFrame = { id: "srh", text: `SRH (SL=${state.packet.srh.segmentsLeft}, LE=${state.packet.srh.lastEntry})`, tone: "transport" };
  return [ipv6Frame, srhFrame, { id: "payload", text: "Payload", tone: "generic" }];
}

export function interfacesFor(router: RouterId, state: Srv6State): DeviceInterfaceData[] {
  const localSid = state.localSidTable[router];
  return neighborLinks(router).map(({ neighbor, link }) => ({
    id: `${router}-${neighbor}`,
    name: `to-${neighbor}`,
    status: "up",
    neighborId: neighbor,
    neighborLabel: neighbor,
    linkType: "Core",
    mtu: 1500,
    protocols: ["IGP", "SRv6"],
    role: "idle",
    extra: [{ label: "IGP Metric", value: String(link.metric) }, ...(localSid ? [{ label: "Local SID Owned", value: localSid.sidText }] : [])],
  }));
}

export function linkDetailFor(linkId: string, state: Srv6State): LinkDetail | undefined {
  const link = LINKS.find((l) => l.id === linkId);
  const edge = GRAPH_EDGES.find((e) => e.id === linkId);
  if (!link || !edge) return undefined;
  const onPath = linkIdsFor(state.journey.map((h) => h.router)).includes(link.id as LinkId);
  return {
    aLabel: link.a,
    bLabel: link.b,
    aInterface: { id: `${link.a}-${link.b}`, name: `to-${link.b}`, status: "up", neighborId: link.b, neighborLabel: link.b, linkType: "Core", mtu: 1500, protocols: ["IGP", "SRv6"], role: "idle" },
    bInterface: { id: `${link.b}-${link.a}`, name: `to-${link.a}`, status: "up", neighborId: link.a, neighborLabel: link.a, linkType: "Core", mtu: 1500, protocols: ["IGP", "SRv6"], role: "idle" },
    status: "up",
    mtu: 1500,
    protocols: [{ label: "IGP Metric", value: String(link.metric) }],
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

export function forwardingEntryFor(router: RouterId, state: Srv6State) {
  const hops = state.journey.filter((h) => h.router === router);
  return hops[hops.length - 1];
}

export function ipv6FibFor(router: RouterId, state: Srv6State) {
  return buildIpv6Fib(router, state.links, state.locators);
}
