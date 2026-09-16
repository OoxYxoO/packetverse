import type { DeviceInterfaceData, DeviceProcessingTrace, LinkDetail, PacketStackFrame, ProcessingStage } from "@/components/network3d/types";
import {
  GRAPH_EDGES,
  LINKS,
  STEP_IDX,
  buildFrrForwardingState,
  buildPrimaryForwardingState,
  fmtLabel,
  rsvpFrrSteps,
  type Bypass,
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
    if (journeyIdx === -1) return base;
    if (isCurrent) return { ...base, activeStageId: "push", completedStageIds: ["classify"], packetBefore: hop!.input, packetAfter: hop!.output };
    return { ...base, completedStageIds: allIds(HEADEND_PIPELINE), packetBefore: hop!.input, packetAfter: hop!.output };
  }
  // Tailend R6
  if (router === "R6") {
    const base: DeviceProcessingTrace = { deviceId: router, ingressInterfaceId: ingressIfaceId, stages: TAILEND_PIPELINE, completedStageIds: [] };
    if (journeyIdx === -1) return base;
    return { ...base, completedStageIds: allIds(TAILEND_PIPELINE), packetBefore: hop!.input, packetAfter: hop!.output };
  }

  // R3 — PLR during FRR activation
  if (router === "R3" && active && i >= 0) {
    const base: DeviceProcessingTrace = { deviceId: router, ingressInterfaceId: ingressIfaceId, egressInterfaceId: egressIfaceId, stages: PLR_PIPELINE, completedStageIds: [] };
    if (journeyIdx === -1) {
      if (i >= STEP_IDX.triggerFailure && i < STEP_IDX.r3PushBypass) return { ...base, activeStageId: "resource-check", completedStageIds: ["mpls-arrive", "primary-entry"] };
      return base;
    }
    if (isCurrent) return { ...base, activeStageId: "push-bypass", completedStageIds: ["mpls-arrive", "primary-entry", "resource-check", "backup-lookup", "backup-ready", "context-prepared"], packetBefore: hop!.input, packetAfter: hop!.output };
    return { ...base, completedStageIds: allIds(PLR_PIPELINE), packetBefore: hop!.input, packetAfter: hop!.output };
  }
  // R4 — bypass-only transit
  if (router === "R4") {
    const base: DeviceProcessingTrace = { deviceId: router, ingressInterfaceId: ingressIfaceId, egressInterfaceId: egressIfaceId, stages: BYPASS_TRANSIT_PIPELINE, completedStageIds: [] };
    if (journeyIdx === -1) return base;
    if (isCurrent) return { ...base, activeStageId: "bypass-forward", completedStageIds: ["bypass-ingress", "outer-lookup"], packetBefore: hop!.input, packetAfter: hop!.output };
    return { ...base, completedStageIds: allIds(BYPASS_TRANSIT_PIPELINE), packetBefore: hop!.input, packetAfter: hop!.output };
  }
  // R5 — Merge Point for link protection (or ordinary transit before failure)
  if (router === "R5") {
    const isMp = active?.mergePoint === "R5";
    const stages = isMp ? MP_PIPELINE : NORMAL_TRANSIT_PIPELINE;
    const base: DeviceProcessingTrace = { deviceId: router, ingressInterfaceId: ingressIfaceId, egressInterfaceId: egressIfaceId, stages, completedStageIds: [] };
    if (journeyIdx === -1) return base;
    if (isCurrent) return { ...base, activeStageId: isMp ? "context-restored" : "action", completedStageIds: isMp ? ["bypass-terminates"] : ["ingress", "label-lookup", "lfib"], packetBefore: hop!.input, packetAfter: hop!.output };
    return { ...base, completedStageIds: allIds(stages), packetBefore: hop!.input, packetAfter: hop!.output };
  }
  // R7 — Merge Point for node protection (or ordinary transit)
  if (router === "R7") {
    const isMp = active?.mergePoint === "R7";
    const stages = isMp ? MP_PIPELINE : NORMAL_TRANSIT_PIPELINE;
    const base: DeviceProcessingTrace = { deviceId: router, ingressInterfaceId: ingressIfaceId, egressInterfaceId: egressIfaceId, stages, completedStageIds: [] };
    if (journeyIdx === -1) return base;
    if (isCurrent) return { ...base, activeStageId: isMp ? "context-restored" : "action", completedStageIds: isMp ? ["bypass-terminates"] : ["ingress", "label-lookup", "lfib"], packetBefore: hop!.input, packetAfter: hop!.output };
    return { ...base, completedStageIds: allIds(stages), packetBefore: hop!.input, packetAfter: hop!.output };
  }

  // R3 outside FRR (ordinary transit)
  const base: DeviceProcessingTrace = { deviceId: router, ingressInterfaceId: ingressIfaceId, egressInterfaceId: egressIfaceId, stages: NORMAL_TRANSIT_PIPELINE, completedStageIds: [] };
  if (journeyIdx === -1) return base;
  if (isCurrent) return { ...base, activeStageId: "action", completedStageIds: ["ingress", "label-lookup", "lfib"], packetBefore: hop!.input, packetAfter: hop!.output };
  return { ...base, completedStageIds: allIds(NORMAL_TRANSIT_PIPELINE), packetBefore: hop!.input, packetAfter: hop!.output };
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
