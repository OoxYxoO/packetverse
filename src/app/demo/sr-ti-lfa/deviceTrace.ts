import type { DeviceInterfaceData, DeviceProcessingTrace, LinkDetail, PacketStackFrame, ProcessingStage } from "@/components/network3d/types";
import type { PacketVisual } from "@/lib/sim-engine/types";
import { ALL_ROUTERS, BASE_LINKS, GRAPH_EDGES, type JourneyHop, type LinkDef, type RouterId, type SrTiLfaState } from "@/lib/sim-engine/scenarios/srTiLfa";

/**
 * Scene Adapter for the SR-MPLS TI-LFA lesson's device-interior 3D
 * view. Every stage list and interface/link value below is derived
 * FROM SrTiLfaState — this file makes no TI-LFA computation itself.
 *
 * Like RSVP-TE FRR and SR Policy, this lesson has no separate control-
 * plane packet phase — every inspectable hop already lives in the
 * single, immutable `state.journey`, and `traceFor` takes no step id.
 * The additive Hop Inspector fields (lookupType/lookupKey/lookupResult/
 * nextHopId/reason — "Hop Inspection Contract") are populated straight
 * off each `JourneyHop`; structured before/after packet-stack frames
 * are deliberately left unpopulated (falling back to the existing
 * plain-text packetBefore/packetAfter), matching FRR/sr-policy's
 * precedent, since this domain's hop text doesn't reliably carry a
 * single parseable label value either.
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

const LOOKUP_TYPE_BY_ACTION: Record<string, string> = {
  PUSH: "SR Forwarding State",
  FORWARD: "Active SID Lookup — Node SID",
  DELIVER: "IP Delivery",
  PUSH_REPAIR: "TI-LFA Backup Lookup",
  PUSH_REPAIR_STALE: "TI-LFA Backup Lookup (Stale)",
  POP_REPAIR: "Active SID Lookup — Repair Segment Target",
};

const allIds = (s: ProcessingStage[]) => s.map((x) => x.id);

function neighborLinks(router: RouterId, links: LinkDef[]): { neighbor: RouterId; link: LinkDef }[] {
  return links.filter((l) => l.a === router || l.b === router).map((l) => ({ neighbor: l.a === router ? l.b : l.a, link: l }));
}

/** Next/previous router along the ACTUAL recorded journey (brief: reuse real state, never recompute a path) — mirrors mpls-rsvp-frr's/sr-policy's `nextHopFor`/`prevRouterFor`. Needed because R2 (the PLR) has THREE neighbors — R1, R4 (primary), R3 (repair) — so a fixed neighbor-declaration-order guess is only reliably correct for one of the two exercised paths and silently wrong for the other. */
function nextHopFor(hop: JourneyHop, state: SrTiLfaState): { id?: RouterId; label?: string } {
  if (hop.action === "DELIVER") return {};
  const idx = state.journey.indexOf(hop);
  const isLast = idx === state.journey.length - 1;
  const nextRouter = !isLast ? state.journey[idx + 1]?.router : state.packetAt;
  if (!nextRouter || nextRouter === hop.router) return {};
  return { id: nextRouter, label: nextRouter };
}
/** Walks backward past any of the router's OWN earlier entries (the `verify-deliver` step pushes R3's Node-SID-target POP_REPAIR immediately followed by its own ordinary FORWARD hop in one batch) to find the true previous, DIFFERENT router — a naive `journey[idx-1]` would otherwise report the router as its own predecessor. */
function prevRouterFor(hop: JourneyHop, state: SrTiLfaState): RouterId | undefined {
  const idx = state.journey.indexOf(hop);
  for (let i = idx - 1; i >= 0; i--) {
    if (state.journey[i].router !== hop.router) return state.journey[i].router;
  }
  return undefined;
}

/** Additive Hop Inspector fields derived straight off a real `JourneyHop` — never fabricated per-field text beyond what the step's own `run()` already recorded. Also overrides the base trace's generic ingress/egress interface ids (computed from `neighborLinks`' fixed declaration order) with the interface the packet actually used. */
function enrichFromHop(hop: JourneyHop, state: SrTiLfaState): Partial<DeviceProcessingTrace> {
  const nextHop = nextHopFor(hop, state);
  const prevRouter = prevRouterFor(hop, state);
  return {
    ingressInterfaceId: prevRouter ? `${hop.router}-${prevRouter}` : undefined,
    egressInterfaceId: nextHop.id ? `${hop.router}-${nextHop.id}` : undefined,
    lookupType: LOOKUP_TYPE_BY_ACTION[hop.action],
    lookupKey: hop.input,
    lookupResult: `${hop.action} → ${hop.output}`,
    reason: hop.lookup,
    nextHopId: nextHop.id,
    nextHopLabel: nextHop.label,
    packetBefore: hop.input,
    packetAfter: hop.output,
  };
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
    const enrich = enrichFromHop(hop, state);
    if (isCurrent) return { ...base, activeStageId: "forward", completedStageIds: ["arrive", "impose"], ...enrich };
    return { ...base, completedStageIds: allIds(HEADEND_PIPELINE), ...enrich };
  }

  if (router === "R2") {
    const isRepair = hop?.action === "PUSH_REPAIR" || hop?.action === "PUSH_REPAIR_STALE";
    const stages = isRepair ? PLR_REPAIR_PIPELINE : PLR_NORMAL_PIPELINE;
    const base: DeviceProcessingTrace = { deviceId: router, ingressInterfaceId: ingressIfaceId, egressInterfaceId: egressIfaceId, stages, completedStageIds: [] };
    if (!hop) return base;
    const enrich = enrichFromHop(hop, state);
    if (isCurrent) {
      return {
        ...base,
        activeStageId: isRepair ? "push-repair" : "forward",
        completedStageIds: isRepair ? ["ingress", "primary-lookup", "resource-down", "backup-lookup", "ready-check", "obtain-list"] : ["ingress", "primary-lookup"],
        ...enrich,
      };
    }
    return { ...base, completedStageIds: allIds(stages), ...enrich };
  }

  if (router === "R6") {
    const base: DeviceProcessingTrace = { deviceId: router, ingressInterfaceId: ingressIfaceId, stages: DESTINATION_PIPELINE, completedStageIds: [] };
    if (!hop) return base;
    const enrich = enrichFromHop(hop, state);
    if (isCurrent) return { ...base, activeStageId: hop.action === "DELIVER" ? "deliver" : "target-check", completedStageIds: ["label-lookup"], ...enrich };
    return { ...base, completedStageIds: allIds(DESTINATION_PIPELINE), ...enrich };
  }

  // R3, R4, R5 — ordinary transit, except whichever one is currently
  // the active repair point (POP_REPAIR) for this journey.
  const isRepairEndpoint = hop?.action === "POP_REPAIR";
  const stages = isRepairEndpoint ? REPAIR_ENDPOINT_PIPELINE : TRANSIT_PIPELINE;
  const base: DeviceProcessingTrace = { deviceId: router, ingressInterfaceId: ingressIfaceId, egressInterfaceId: egressIfaceId, stages, completedStageIds: [] };
  if (!hop) return base;
  const enrich = enrichFromHop(hop, state);
  if (isCurrent) {
    return {
      ...base,
      activeStageId: isRepairEndpoint ? "expose-original" : "forward",
      completedStageIds: isRepairEndpoint ? ["label-lookup", "target-check", "pop-repair"] : ["ingress", "label-lookup", "spf-nexthop"],
      ...enrich,
    };
  }
  return { ...base, completedStageIds: allIds(stages), ...enrich };
}

/** Which router is the primary inspection subject of a given historical step — the router `traceFor` currently shows as actively mid-stage, falling back to the packet's endpoints (mirrors mpls-rsvp-frr's/sr-policy's `deviceForStep`). `traceFor` here takes no step id, so this needs no step id either. */
export function deviceForStep(state: SrTiLfaState, packet: PacketVisual | undefined): RouterId | undefined {
  const active = ALL_ROUTERS.find((r) => traceFor(r, state)?.activeStageId !== undefined);
  if (active) return active;
  if (packet) {
    const to = packet.to as RouterId;
    if (ALL_ROUTERS.includes(to) && traceFor(to, state)) return to;
    const from = packet.from as RouterId;
    if (ALL_ROUTERS.includes(from) && traceFor(from, state)) return from;
    if (ALL_ROUTERS.includes(to)) return to;
  }
  return undefined;
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
