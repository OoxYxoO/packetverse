import type { DeviceInterfaceData, DeviceProcessingTrace, LinkDetail, PacketStackFrame, ProcessingStage } from "@/components/network3d/types";
import type { PacketVisual } from "@/lib/sim-engine/types";
import { GRAPH_EDGES, LINKS, activeCandidateEvaluation, fmtLabel, type FwdAction, type JourneyHop, type RouterId, type SrPolicyState } from "@/lib/sim-engine/scenarios/srPolicy";

/**
 * Scene Adapter for SR Policy's device-interior 3D view. Every stage
 * list and interface/link value below is derived FROM SrPolicyState —
 * this file makes no policy/candidate/steering decision itself.
 *
 * Like RSVP-TE FRR, this lesson has no separate control-plane packet
 * phase — every inspectable hop already lives in the single, immutable
 * `state.journey`, and `traceFor` takes no step id (the domain has no
 * step-phase gating). The additive Hop Inspector fields (lookupType/
 * lookupKey/lookupResult/nextHopId/reason — "Hop Inspection Contract")
 * are populated straight off each `JourneyHop`; structured before/after
 * packet-stack frames are deliberately left unpopulated (falling back
 * to the existing plain-text packetBefore/packetAfter) because this
 * domain's hop text ("policy-resolved", "GOLD-EXPLICIT selected",
 * multi-segment strings joined by " / ") does not reliably carry a
 * single parseable label value.
 */

export const ALL_ROUTERS: RouterId[] = ["R1", "R2", "R3", "R4", "R5", "R6"];

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

const LOOKUP_TYPE_BY_ACTION: Partial<Record<FwdAction, string>> = {
  PUSH: "SR-TE Forwarding State",
  CONTINUE: "Active SID Lookup — Node SID",
  POP: "Active SID Lookup — PHP (implicit-null)",
  POP_AND_FORWARD_ADJ: "Active SID Lookup — Adjacency SID",
  IP_FORWARD: "IP Delivery",
  POLICY_SELECT: "SR Policy Steering / Resolution",
  POLICY_UNAVAILABLE: "SR Policy Steering — No Valid Candidate",
};

const allIds = (s: ProcessingStage[]) => s.map((x) => x.id);

function neighborLinks(router: RouterId): { neighbor: RouterId; link: (typeof LINKS)[number] }[] {
  return LINKS.filter((l) => l.a === router || l.b === router).map((l) => ({ neighbor: l.a === router ? l.b : l.a, link: l }));
}

/** Next/previous router along the ACTUAL recorded journey (brief: reuse real state, never recompute a path) — mirrors mpls-rsvp-frr's `nextHopFor`/`prevRouterFor`. Needed because R1 and R3 each have more than two neighbors here (R1: R2 baseline vs. R3 GOLD; R3: R1/R5/R4), so a fixed neighbor-declaration-order guess is only reliably correct for one of the exercised paths and silently wrong for the other. */
function nextHopFor(hop: JourneyHop, state: SrPolicyState): { id?: RouterId; label?: string } {
  if (hop.action === "IP_FORWARD" || hop.action === "POLICY_UNAVAILABLE") return {};
  const idx = state.journey.indexOf(hop);
  const isLast = idx === state.journey.length - 1;
  const nextRouter = !isLast ? state.journey[idx + 1]?.router : state.packetAt;
  if (!nextRouter || nextRouter === hop.router) return {};
  return { id: nextRouter, label: nextRouter };
}
/** Walks backward past any of the router's OWN earlier entries (a step may record more than one hop in a single batch, and a router can appear in consecutive entries) to find the true previous, DIFFERENT router — a naive `journey[idx-1]` would otherwise report the router as its own predecessor. */
function prevRouterFor(hop: JourneyHop, state: SrPolicyState): RouterId | undefined {
  const idx = state.journey.indexOf(hop);
  for (let i = idx - 1; i >= 0; i--) {
    if (state.journey[i].router !== hop.router) return state.journey[i].router;
  }
  return undefined;
}

/** Additive Hop Inspector fields derived straight off a real `JourneyHop` — never fabricated per-field text beyond what the step's own `run()` already recorded. Also overrides the base trace's generic ingress/egress interface ids (computed from `neighborLinks`' fixed declaration order) with the interface the packet actually used. */
function enrichFromHop(hop: JourneyHop, state: SrPolicyState): Partial<DeviceProcessingTrace> {
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
    const enrich = enrichFromHop(hop, state);
    if (unavailable) return { ...base, activeStageId: isCurrent ? "fail" : undefined, completedStageIds: allIds(UNAVAILABLE_PIPELINE), ...enrich };
    if (isCurrent) return { ...base, activeStageId: hop.action === "POLICY_SELECT" ? "candidate-select" : "impose", completedStageIds: hop.action === "POLICY_SELECT" ? ["arrive", "classify", "policy-key", "state-check"] : allIds(HEADEND_PIPELINE).slice(0, 6), ...enrich };
    return { ...base, completedStageIds: allIds(HEADEND_PIPELINE), ...enrich };
  }
  if (router === "R6") {
    const base: DeviceProcessingTrace = { deviceId: router, ingressInterfaceId: ingressIfaceId, stages: TAILEND_PIPELINE, completedStageIds: [] };
    if (!hop) return base;
    const enrich = enrichFromHop(hop, state);
    if (isCurrent) return { ...base, activeStageId: hop.action === "IP_FORWARD" ? "deliver" : "target-check", completedStageIds: ["label-lookup"], ...enrich };
    return { ...base, completedStageIds: allIds(TAILEND_PIPELINE), ...enrich };
  }

  const isAdjExec = hop?.action === "POP_AND_FORWARD_ADJ";
  const stages = isAdjExec ? ADJ_SID_PIPELINE : NODE_SID_PIPELINE;
  const base: DeviceProcessingTrace = { deviceId: router, ingressInterfaceId: ingressIfaceId, egressInterfaceId: egressIfaceId, stages, completedStageIds: [] };
  if (!hop) return base;
  const enrich = enrichFromHop(hop, state);
  if (isCurrent) {
    return {
      ...base,
      activeStageId: isAdjExec ? "send-adjacency" : hop.action === "POP" ? "label-action" : "forward",
      completedStageIds: isAdjExec ? ["active-lookup", "owner-check", "resolve-adjacency"] : ["ingress", "label-lookup", "identify-instruction", "spt-nexthop"],
      ...enrich,
    };
  }
  return { ...base, completedStageIds: allIds(stages), ...enrich };
}

/** Which router is the primary inspection subject of a given historical step — the router `traceFor` currently shows as actively mid-stage, falling back to the packet's endpoints (mirrors mpls-rsvp-frr's `deviceForStep`). `traceFor` here takes no step id, so this needs no step id either — unlike RSVP-TE, this domain has no separate control-plane phase to disambiguate. */
export function deviceForStep(state: SrPolicyState, packet: PacketVisual | undefined): RouterId | undefined {
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
