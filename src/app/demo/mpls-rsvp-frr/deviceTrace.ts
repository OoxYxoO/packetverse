import type { DeviceInterfaceData, DeviceProcessingTrace, LinkDetail, PacketStackFrame, ProcessingStage } from "@/components/network3d/types";
import type { PacketVisual } from "@/lib/sim-engine/types";
import {
  ALL_ROUTERS,
  GRAPH_EDGES,
  LINKS,
  STEP_IDX,
  buildFrrForwardingState,
  buildPrimaryForwardingState,
  fmtLabel,
  rsvpFrrSteps,
  type Bypass,
  type JourneyHop,
  type LinkId,
  type RouterId,
  type RsvpFrrState,
} from "@/lib/sim-engine/scenarios/rsvpFrr";

/**
 * The Scene Adapter for RSVP-TE FRR's device-interior 3D view. Every
 * stage list, checkpoint, interface, and link-detail value below is
 * computed FROM RsvpFrrState — this file never makes a PLR/MP/bypass
 * decision itself (brief: "no CSPF, RSVP, bandwidth, or label
 * allocation logic belongs in network3d/*"), it only re-describes
 * decisions the domain layer already made.
 *
 * Unlike RSVP-TE, this lesson never models separate PATH/RESV control
 * packets — bypass establishment is narrated as lifecycle-state
 * transitions, and every hop that IS individually inspectable already
 * lives in the single, immutable `state.journey`. The additive Hop
 * Inspector fields (lookupType/lookupKey/lookupResult/nextHopId/reason —
 * brief "Hop Inspection Contract") are populated straight off each
 * `JourneyHop`; structured before/after packet-STACK frames are
 * deliberately left unpopulated here (falling back to the existing
 * plain-text packetBefore/packetAfter) because this domain's hop text
 * (`"label"`, `"primary label"`, `"outer bypass label"`, …) does not
 * reliably carry a parseable numeric label the way RSVP-TE's does —
 * synthesizing a stack frame from it would risk fabricating a value
 * the domain never actually computed for that field.
 */

const stepIndex = (id: string) => rsvpFrrSteps.findIndex((s) => s.id === id);

// ---------------------------------------------------------------------------
// Conceptual pipelines (brief §21/§22/§23)
// ---------------------------------------------------------------------------

const PLR_PIPELINE: ProcessingStage[] = [
  { id: "mpls-arrive", label: "MPLS Packet Arrives" },
  { id: "primary-entry", label: "Primary Forwarding Entry Identified" },
  { id: "resource-check", label: "Protected Next Resource Unavailable" },
  { id: "backup-lookup", label: "FRR Backup Lookup" },
  { id: "backup-ready", label: "Backup State READY?" },
  { id: "context-prepared", label: "Protected-LSP Forwarding Context Prepared" },
  { id: "push-bypass", label: "Push / Select Bypass Label" },
  { id: "send-bypass", label: "Send Toward Bypass Next Hop" },
];
const BYPASS_TRANSIT_PIPELINE: ProcessingStage[] = [
  { id: "bypass-ingress", label: "Bypass MPLS Ingress" },
  { id: "outer-lookup", label: "Top / Outer Label Lookup" },
  { id: "bypass-forward", label: "Bypass Forwarding" },
  { id: "inner-untouched", label: "Inner Protected-LSP Context Untouched" },
  { id: "toward-mp", label: "Forward Toward Merge Point" },
];
const MP_PIPELINE: ProcessingStage[] = [
  { id: "bypass-terminates", label: "Bypass Terminates" },
  { id: "context-restored", label: "Protected-LSP Context Restored / Exposed" },
  { id: "normal-resume", label: "Normal Protected-LSP Forwarding Continues" },
  { id: "toward-tailend", label: "Toward Tailend" },
];
const NORMAL_TRANSIT_PIPELINE: ProcessingStage[] = [
  { id: "ingress", label: "Ingress" },
  { id: "label-lookup", label: "Label Lookup" },
  { id: "lfib", label: "Primary LFIB" },
  { id: "action", label: "Label Action" },
  { id: "egress", label: "Egress" },
];
const HEADEND_PIPELINE: ProcessingStage[] = [
  { id: "classify", label: "Classify Into Tunnel" },
  { id: "push", label: "PUSH Transport Label" },
  { id: "egress", label: "Egress — Unaware Of Any Failure" },
];
const TAILEND_PIPELINE: ProcessingStage[] = [
  { id: "label-lookup", label: "Label Lookup" },
  { id: "deliver", label: "Deliver" },
];

const allIds = (s: ProcessingStage[]) => s.map((x) => x.id);

function neighborLinks(router: RouterId): { neighbor: RouterId; link: (typeof LINKS)[number] }[] {
  return LINKS.filter((l) => l.a === router || l.b === router).map((l) => ({ neighbor: l.a === router ? l.b : l.a, link: l }));
}

function activeBypassFor(state: RsvpFrrState): Bypass | undefined {
  if (state.activeBypassId === state.linkBypass?.id) return state.linkBypass;
  if (state.activeBypassId === state.nodeBypass?.id) return state.nodeBypass;
  return undefined;
}

const LOOKUP_TYPE_BY_ACTION: Partial<Record<JourneyHop["action"], string>> = {
  PUSH: "RSVP-TE Forwarding State",
  SWAP: "Primary LFIB",
  POP: "Primary LFIB (PHP)",
  SWAP_AND_PUSH_BYPASS: "FRR Backup Forwarding (PLR)",
  POP_BYPASS: "Bypass LFIB (outer label only)",
  IP_FORWARD: "IP Delivery",
};

/** Next/previous router along the ACTUAL recorded journey (brief: reuse real state, never recompute a path) — the next journey entry if one already exists (an earlier, already-passed hop), or `state.packetAt` when this IS the most-recently-recorded hop, mirrors mpls-ldp's `nextHopFor`. */
function nextHopFor(hop: JourneyHop, state: RsvpFrrState): { id?: RouterId; label?: string } {
  if (hop.action === "IP_FORWARD") return {};
  const idx = state.journey.indexOf(hop);
  const isLast = idx === state.journey.length - 1;
  const nextRouter = !isLast ? state.journey[idx + 1]?.router : state.packetAt;
  if (!nextRouter || nextRouter === hop.router) return {};
  return { id: nextRouter, label: nextRouter };
}
function prevRouterFor(hop: JourneyHop, state: RsvpFrrState): RouterId | undefined {
  const idx = state.journey.indexOf(hop);
  return idx > 0 ? state.journey[idx - 1].router : undefined;
}

/**
 * Additive Hop Inspector fields derived straight off a real `JourneyHop` —
 * never fabricated per-field text beyond what the step's own `run()`
 * already recorded. This also OVERRIDES the base trace's generic
 * `ingressInterfaceId`/`egressInterfaceId` (computed from `neighborLinks`'
 * fixed declaration order) with the interface the packet actually used —
 * important here specifically because R4, R5, and R7 each have more than
 * two neighbors (a primary-path one plus one or two bypass-only ones), so
 * the generic guess is only reliably correct for ordinary primary transit
 * and silently wrong the moment R4 carries bypass traffic toward R7
 * instead of R5, or R5/R7 receive traffic as a Merge Point via the bypass
 * (from R4) instead of their normal primary-path predecessor.
 */
function enrichFromHop(hop: JourneyHop, state: RsvpFrrState): Partial<DeviceProcessingTrace> {
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

export function traceFor(router: RouterId, state: RsvpFrrState, currentStepId: string): DeviceProcessingTrace | undefined {
  const i = stepIndex(currentStepId);
  const nbrs = neighborLinks(router);
  const ingressIfaceId = nbrs[0] ? `${router}-${nbrs[0].neighbor}` : undefined;
  const egressIfaceId = nbrs[1] ? `${router}-${nbrs[1].neighbor}` : undefined;
  const active = activeBypassFor(state);
  const journeyIdx = state.journey.findIndex((h) => h.router === router);
  const isCurrent = journeyIdx !== -1 && journeyIdx === state.journey.length - 1;
  const hop = journeyIdx !== -1 ? state.journey[journeyIdx] : undefined;

  // Headend R1
  if (router === "R1") {
    const base: DeviceProcessingTrace = { deviceId: router, egressInterfaceId: egressIfaceId, stages: HEADEND_PIPELINE, completedStageIds: [] };
    if (!hop) return base;
    const enrich = enrichFromHop(hop, state);
    if (isCurrent) return { ...base, activeStageId: "push", completedStageIds: ["classify"], ...enrich };
    return { ...base, completedStageIds: allIds(HEADEND_PIPELINE), ...enrich };
  }
  // Tailend R6
  if (router === "R6") {
    const base: DeviceProcessingTrace = { deviceId: router, ingressInterfaceId: ingressIfaceId, stages: TAILEND_PIPELINE, completedStageIds: [] };
    if (!hop) return base;
    return { ...base, completedStageIds: allIds(TAILEND_PIPELINE), ...enrichFromHop(hop, state) };
  }

  // R3 — PLR during FRR activation
  if (router === "R3" && active && i >= 0) {
    const base: DeviceProcessingTrace = { deviceId: router, ingressInterfaceId: ingressIfaceId, egressInterfaceId: egressIfaceId, stages: PLR_PIPELINE, completedStageIds: [] };
    if (!hop) {
      if (i >= STEP_IDX.triggerFailure && i < STEP_IDX.r3PushBypass) return { ...base, activeStageId: "resource-check", completedStageIds: ["mpls-arrive", "primary-entry"] };
      return base;
    }
    const enrich = enrichFromHop(hop, state);
    if (isCurrent) return { ...base, activeStageId: "push-bypass", completedStageIds: ["mpls-arrive", "primary-entry", "resource-check", "backup-lookup", "backup-ready", "context-prepared"], ...enrich };
    return { ...base, completedStageIds: allIds(PLR_PIPELINE), ...enrich };
  }
  // R4 — bypass-only transit
  if (router === "R4") {
    const base: DeviceProcessingTrace = { deviceId: router, ingressInterfaceId: ingressIfaceId, egressInterfaceId: egressIfaceId, stages: BYPASS_TRANSIT_PIPELINE, completedStageIds: [] };
    if (!hop) return base;
    const enrich = enrichFromHop(hop, state);
    if (isCurrent) return { ...base, activeStageId: "bypass-forward", completedStageIds: ["bypass-ingress", "outer-lookup"], ...enrich };
    return { ...base, completedStageIds: allIds(BYPASS_TRANSIT_PIPELINE), ...enrich };
  }
  // R5 — Merge Point for link protection (or ordinary transit before failure)
  if (router === "R5") {
    const isMp = active?.mergePoint === "R5";
    const stages = isMp ? MP_PIPELINE : NORMAL_TRANSIT_PIPELINE;
    const base: DeviceProcessingTrace = { deviceId: router, ingressInterfaceId: ingressIfaceId, egressInterfaceId: egressIfaceId, stages, completedStageIds: [] };
    if (!hop) return base;
    const enrich = enrichFromHop(hop, state);
    if (isCurrent) return { ...base, activeStageId: isMp ? "context-restored" : "action", completedStageIds: isMp ? ["bypass-terminates"] : ["ingress", "label-lookup", "lfib"], ...enrich };
    return { ...base, completedStageIds: allIds(stages), ...enrich };
  }
  // R7 — Merge Point for node protection (or ordinary transit)
  if (router === "R7") {
    const isMp = active?.mergePoint === "R7";
    const stages = isMp ? MP_PIPELINE : NORMAL_TRANSIT_PIPELINE;
    const base: DeviceProcessingTrace = { deviceId: router, ingressInterfaceId: ingressIfaceId, egressInterfaceId: egressIfaceId, stages, completedStageIds: [] };
    if (!hop) return base;
    const enrich = enrichFromHop(hop, state);
    if (isCurrent) return { ...base, activeStageId: isMp ? "context-restored" : "action", completedStageIds: isMp ? ["bypass-terminates"] : ["ingress", "label-lookup", "lfib"], ...enrich };
    return { ...base, completedStageIds: allIds(stages), ...enrich };
  }

  // R3 outside FRR (ordinary transit)
  const base: DeviceProcessingTrace = { deviceId: router, ingressInterfaceId: ingressIfaceId, egressInterfaceId: egressIfaceId, stages: NORMAL_TRANSIT_PIPELINE, completedStageIds: [] };
  if (!hop) return base;
  const enrich = enrichFromHop(hop, state);
  if (isCurrent) return { ...base, activeStageId: "action", completedStageIds: ["ingress", "label-lookup", "lfib"], ...enrich };
  return { ...base, completedStageIds: allIds(NORMAL_TRANSIT_PIPELINE), ...enrich };
}

/** Which router is the primary inspection subject of a given historical step — the router `traceFor` currently shows as actively mid-stage, falling back to the packet's endpoints (mirrors mpls-rsvp-te's `deviceForStep`). Every packet-carrying step in this lesson already yields real per-router trace data, so no separate narrative-step fallback map is needed here (unlike RSVP-TE's PATH/RESV pipeline-inspection steps — this lesson has no non-journey signaling phase). */
export function deviceForStep(stepId: string, state: RsvpFrrState, packet: PacketVisual | undefined): RouterId | undefined {
  const active = ALL_ROUTERS.find((r) => traceFor(r, state, stepId)?.activeStageId !== undefined);
  if (active) return active;
  if (packet) {
    const to = packet.to as RouterId;
    if (ALL_ROUTERS.includes(to) && traceFor(to, state, stepId)) return to;
    const from = packet.from as RouterId;
    if (ALL_ROUTERS.includes(from) && traceFor(from, state, stepId)) return from;
    if (ALL_ROUTERS.includes(to)) return to;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Packet visual stack
// ---------------------------------------------------------------------------

export function packetFramesFor(state: RsvpFrrState): PacketStackFrame[] | undefined {
  if (!state.packet) return undefined;
  const labelFrames: PacketStackFrame[] = state.packet.labels.map((l, idx) => ({ id: `label-${idx}`, text: `${l.purpose === "bypass" ? "Bypass" : "Protected"} ${l.value}`, tone: l.purpose === "bypass" ? "transport" : "vpn", justChanged: idx === 0 }));
  return [...labelFrames, { id: "ip", text: "IP", tone: "ip" }];
}

// ---------------------------------------------------------------------------
// Physical interfaces
// ---------------------------------------------------------------------------

export function interfacesFor(router: RouterId, state: RsvpFrrState): DeviceInterfaceData[] {
  return neighborLinks(router).map(({ neighbor, link }) => {
    const down = state.failedLinkIds.includes(link.id) || state.failedNode === router || state.failedNode === neighbor;
    return {
      id: `${router}-${neighbor}`,
      name: `to-${neighbor}`,
      status: down ? "down" : "up",
      neighborId: neighbor,
      neighborLabel: neighbor,
      linkType: "Core",
      mtu: 1500,
      protocols: ["IGP", "RSVP-TE"],
      role: "idle",
      extra: [
        { label: "IGP Metric", value: String(link.igpMetric) },
        { label: "TE Metric", value: String(link.teMetric) },
        { label: "Max Reservable", value: `${link.maxReservableMbps} Mbps` },
      ],
    };
  });
}

// ---------------------------------------------------------------------------
// Link detail
// ---------------------------------------------------------------------------

export function linkDetailFor(linkId: string, state: RsvpFrrState): LinkDetail | undefined {
  const link = LINKS.find((l) => l.id === linkId);
  const edge = GRAPH_EDGES.find((e) => e.id === linkId);
  if (!link || !edge) return undefined;
  const down = state.failedLinkIds.includes(link.id);
  const active = activeBypassFor(state);
  const onActiveBypass = active && linkIdsFor(active.path).includes(link.id as LinkId);
  const onPrimary = linkIdsFor(state.primaryLsp.path).includes(link.id as LinkId);
  const trafficParts: string[] = [];
  if (onActiveBypass) trafficParts.push(`Active FRR detour carrying ${active!.reservedMbps} Mbps`);
  else if (onPrimary && !down) trafficParts.push(`RSVP-PRIMARY: ${state.primaryLsp.requestedBandwidthMbps} Mbps`);
  const reservedForProtection = [state.linkBypass, state.nodeBypass].filter((b) => b && linkIdsFor(b.path).includes(link.id as LinkId));

  return {
    aLabel: link.a,
    bLabel: link.b,
    aInterface: { id: `${link.a}-${link.b}`, name: `to-${link.b}`, status: down ? "down" : "up", neighborId: link.b, neighborLabel: link.b, linkType: "Core", mtu: 1500, protocols: ["IGP", "RSVP-TE"], role: "idle" },
    bInterface: { id: `${link.b}-${link.a}`, name: `to-${link.a}`, status: down ? "down" : "up", neighborId: link.a, neighborLabel: link.a, linkType: "Core", mtu: 1500, protocols: ["IGP", "RSVP-TE"], role: "idle" },
    status: down ? "down" : "up",
    mtu: 1500,
    protocols: [
      { label: "IGP Metric", value: String(link.igpMetric) },
      { label: "TE Metric", value: String(link.teMetric) },
      { label: "Max Reservable", value: `${link.maxReservableMbps} Mbps` },
      { label: "Protected", value: link.id === "R3-R5" ? "Yes (link)" : "No" },
      { label: "Protection Reservation", value: reservedForProtection.length ? reservedForProtection.map((b) => `${b!.reservedMbps} Mbps (${b!.protectionType})`).join(", ") : "None" },
    ],
    currentTraffic: trafficParts.join("; ") || undefined,
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

export function forwardingEntryFor(router: RouterId, state: RsvpFrrState) {
  const active = activeBypassFor(state);
  const fwd = active ? buildFrrForwardingState(state.primaryLsp, active) : buildPrimaryForwardingState(state.primaryLsp);
  return fwd[router];
}

export { fmtLabel };
