import type { DeviceInterfaceData, DeviceProcessingTrace, LinkDetail, PacketStackFrame, ProcessingStage } from "@/components/network3d/types";
import type { PacketVisual } from "@/lib/sim-engine/types";
import { ALL_ROUTERS, BASE_LINKS, GRAPH_EDGES, type JourneyHop, type LinkDef, type RouterId, type SrFlexAlgoState } from "@/lib/sim-engine/scenarios/srFlexAlgo";

/**
 * Scene Adapter for the SR-MPLS Flex-Algo lesson's device-interior 3D
 * view. Every stage list and interface/link value below is derived
 * FROM SrFlexAlgoState — this file makes no Flex-Algo computation.
 *
 * Like RSVP-TE FRR, SR Policy, and SR-MPLS TI-LFA, this lesson has no
 * separate control-plane packet phase — every inspectable hop already
 * lives in the single, immutable `state.journey`, and `traceFor` takes
 * no step id.
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

const LOOKUP_TYPE_BY_ACTION: Record<string, string> = {
  PUSH: "SR Forwarding State",
  FORWARD: "Active SID Lookup — Node SID",
  DELIVER: "IP Delivery",
};

const allIds = (s: ProcessingStage[]) => s.map((x) => x.id);

function neighborLinks(router: RouterId, links: LinkDef[]): { neighbor: RouterId; link: LinkDef }[] {
  return links.filter((l) => l.a === router || l.b === router).map((l) => ({ neighbor: l.a === router ? l.b : l.a, link: l }));
}

/** Next/previous router along the ACTUAL recorded journey (brief: reuse real state, never recompute a path) — mirrors mpls-rsvp-frr's/sr-policy's/sr-ti-lfa's `nextHopFor`/`prevRouterFor`. Needed because R1 (headend) and R6 (destination) each touch BOTH algorithm branches — R1's real egress is R2 for Algorithm-0 traffic but R3 for Algorithm-128 traffic; R6's real ingress is R4 for Algorithm-0 traffic but R5 for Algorithm-128 traffic. A fixed neighbor-declaration-order guess is only reliably correct for one algorithm's traffic and silently wrong for the other. */
function nextHopFor(hop: JourneyHop, state: SrFlexAlgoState): { id?: RouterId; label?: string } {
  if (hop.action === "DELIVER") return {};
  const idx = state.journey.indexOf(hop);
  const isLast = idx === state.journey.length - 1;
  const nextRouter = !isLast ? state.journey[idx + 1]?.router : state.packetAt;
  if (!nextRouter || nextRouter === hop.router) return {};
  return { id: nextRouter, label: nextRouter };
}
/** Walks backward past any of the router's OWN earlier entries to find the true previous, DIFFERENT router — a naive `journey[idx-1]` would otherwise report the router as its own predecessor whenever a step batches 2+ consecutive hops (e.g. `verify-deliver`'s R5 FORWARD immediately followed by R6 DELIVER in one run() call). */
function prevRouterFor(hop: JourneyHop, state: SrFlexAlgoState): RouterId | undefined {
  const idx = state.journey.indexOf(hop);
  for (let i = idx - 1; i >= 0; i--) {
    if (state.journey[i].router !== hop.router) return state.journey[i].router;
  }
  return undefined;
}

/** Additive Hop Inspector fields derived straight off a real `JourneyHop` — never fabricated per-field text beyond what the step's own `run()` already recorded. Also overrides the base trace's generic ingress/egress interface ids (computed from `neighborLinks`' fixed declaration order) with the interface the packet actually used. */
function enrichFromHop(hop: JourneyHop, state: SrFlexAlgoState): Partial<DeviceProcessingTrace> {
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
    const enrich = enrichFromHop(hop, state);
    if (isCurrent) return { ...base, activeStageId: "forward", completedStageIds: ["arrive", "classify", "impose"], ...enrich };
    return { ...base, completedStageIds: allIds(HEADEND_PIPELINE), ...enrich };
  }

  if (router === "R6") {
    const base: DeviceProcessingTrace = { deviceId: router, ingressInterfaceId: ingressIfaceId, stages: DESTINATION_PIPELINE, completedStageIds: [] };
    if (!hop) return base;
    const enrich = enrichFromHop(hop, state);
    if (isCurrent) return { ...base, activeStageId: hop.action === "DELIVER" ? "deliver" : "target-check", completedStageIds: ["label-lookup"], ...enrich };
    return { ...base, completedStageIds: allIds(DESTINATION_PIPELINE), ...enrich };
  }

  // R2, R3, R4, R5 — ordinary algorithm-specific transit.
  const base: DeviceProcessingTrace = { deviceId: router, ingressInterfaceId: ingressIfaceId, egressInterfaceId: egressIfaceId, stages: TRANSIT_PIPELINE, completedStageIds: [] };
  if (!hop) return base;
  const enrich = enrichFromHop(hop, state);
  if (isCurrent) return { ...base, activeStageId: "forward", completedStageIds: ["ingress", "label-lookup", "algo-spf"], ...enrich };
  return { ...base, completedStageIds: allIds(TRANSIT_PIPELINE), ...enrich };
}

/** Which router is the primary inspection subject of a given historical step — the router `traceFor` currently shows as actively mid-stage, falling back to the packet's endpoints (mirrors mpls-rsvp-frr's/sr-policy's/sr-ti-lfa's `deviceForStep`). `traceFor` here takes no step id, so this needs no step id either. */
export function deviceForStep(state: SrFlexAlgoState, packet: PacketVisual | undefined): RouterId | undefined {
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
