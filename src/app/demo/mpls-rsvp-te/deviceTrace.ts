import type { DeviceInterfaceData, DeviceProcessingTrace, LinkDetail, PacketStackFrame, ProcessingStage } from "@/components/network3d/types";
import {
  GRAPH_EDGES,
  STEP_IDX,
  TE_LINKS,
  buildRsvpForwardingState,
  computeAvailableBandwidth,
  forSnapshot,
  rsvpTeSteps,
  type LinkId,
  type RouterId,
  type RsvpTeState,
} from "@/lib/sim-engine/scenarios/rsvpTe";

/**
 * The "Scene Adapter" (brief §50: "No CSPF, RSVP, bandwidth, or
 * label-allocation logic belongs in network3d/*") for RSVP-TE's
 * device-interior 3D view. Every stage list, checkpoint, interface,
 * and link-detail value below is computed FROM RsvpTeState (the
 * ScenarioEngine's own output) — this file never makes a CSPF or
 * signaling decision itself, it only re-describes decisions the
 * engine already made, in the generic DeviceProcessingTrace shape the
 * 3D layer understands.
 */

const stepIndex = (id: string) => rsvpTeSteps.findIndex((s) => s.id === id);

// ---------------------------------------------------------------------------
// Conceptual pipelines (brief §13/§17/§24-26) — generic stage lists,
// reused by whichever router is currently playing that role.
// ---------------------------------------------------------------------------

const PATH_PIPELINE: ProcessingStage[] = [
  { id: "ip-ingress", label: "IP / RSVP Ingress" },
  { id: "identify-session", label: "Identify TE Session" },
  { id: "inspect-ero", label: "Inspect ERO" },
  { id: "verify-hop", label: "Verify Local Hop" },
  { id: "check-path-state", label: "Check Path State" },
  { id: "record-prev-hop", label: "Record Previous RSVP Hop" },
  { id: "forward-path", label: "Forward PATH Toward Next ERO Hop" },
];
const RESV_PIPELINE: ProcessingStage[] = [
  { id: "resv-received", label: "RESV Received" },
  { id: "identify-session-resv", label: "Identify TE Session" },
  { id: "reservation-state", label: "Reservation State" },
  { id: "allocate-label", label: "Allocate / Install Label State" },
  { id: "program-forwarding", label: "Program Forwarding Entry" },
  { id: "propagate-resv", label: "Propagate RESV Upstream" },
];
const INGRESS_FWD_PIPELINE: ProcessingStage[] = [
  { id: "classify", label: "Classify Packet Into Tunnel" },
  { id: "select-lsp", label: "Select RSVP-TE LSP" },
  { id: "fwd-state", label: "LSP Forwarding State" },
  { id: "push", label: "PUSH Transport Label" },
  { id: "egress-fwd", label: "Egress Toward Next Hop" },
];
const TRANSIT_FWD_PIPELINE: ProcessingStage[] = [
  { id: "mpls-ingress", label: "MPLS Ingress" },
  { id: "label-lookup", label: "Top-Label Lookup" },
  { id: "fwd-entry", label: "RSVP-Installed Forwarding Entry" },
  { id: "label-action", label: "Label Action" },
  { id: "egress-fwd", label: "Egress" },
];
const TAILEND_FWD_PIPELINE: ProcessingStage[] = [
  { id: "label-lookup-egress", label: "Label Lookup" },
  { id: "delivery", label: "Deliver" },
];

const allIds = (s: ProcessingStage[]) => s.map((x) => x.id);

function neighborLink(router: RouterId): { neighbor: RouterId; link: (typeof TE_LINKS)[number] }[] {
  return TE_LINKS.filter((l) => l.a === router || l.b === router).map((l) => ({ neighbor: l.a === router ? l.b : l.a, link: l }));
}

/** Which of the two path roles (PATH-processing transit, RESV-processing transit) applies right now, keyed off the CURRENT step id — a router plays a different conceptual role at different lesson phases (brief §13 vs §17 vs §24-26). */
export function traceFor(router: RouterId, state: RsvpTeState, currentStepId: string): DeviceProcessingTrace | undefined {
  const i = stepIndex(currentStepId);
  const path = state.lsp.path;
  const onPath = path?.includes(router) ?? false;
  const nbrs = neighborLink(router);
  const ingressIfaceId = nbrs[0] ? `${router}-${nbrs[0].neighbor}` : undefined;
  const egressIfaceId = nbrs[1] ? `${router}-${nbrs[1].neighbor}` : undefined;

  // --- Data-plane phase (brief §24-26) — takes priority once a data packet exists at/after this router. ---
  const inDataPhase = i >= STEP_IDX.sendDataPacket && state.packet;
  if (inDataPhase && onPath && path) {
    const idx = path.indexOf(router);
    const fwd = buildRsvpForwardingState(state.lsp);
    const myEntry = fwd[router];
    if (idx === 0) {
      const base: DeviceProcessingTrace = { deviceId: router, ingressInterfaceId: undefined, egressInterfaceId: egressIfaceId, stages: INGRESS_FWD_PIPELINE, completedStageIds: [] };
      if (state.packetAt !== router && state.journey.some((h) => h.router === router)) return { ...base, completedStageIds: allIds(INGRESS_FWD_PIPELINE), packetAfter: myEntry ? `PUSH ${myEntry.outgoingLabel !== undefined ? String(myEntry.outgoingLabel) : ""}` : undefined };
      if (state.packetAt === router) return { ...base, activeStageId: "push", completedStageIds: ["classify", "select-lsp", "fwd-state"], packetBefore: "IP packet (unlabeled)", packetAfter: myEntry ? `PUSH ${myEntry.outgoingLabel !== undefined ? String(myEntry.outgoingLabel) : ""}` : undefined };
      return base;
    }
    if (idx === path.length - 1) {
      const base: DeviceProcessingTrace = { deviceId: router, ingressInterfaceId: ingressIfaceId, egressInterfaceId: undefined, stages: TAILEND_FWD_PIPELINE, completedStageIds: [] };
      if (state.journey.some((h) => h.router === router)) return { ...base, completedStageIds: allIds(TAILEND_FWD_PIPELINE), packetBefore: "IP packet (unlabeled, after upstream PHP)", packetAfter: "Delivered" };
      return base;
    }
    const base: DeviceProcessingTrace = { deviceId: router, ingressInterfaceId: ingressIfaceId, egressInterfaceId: egressIfaceId, stages: TRANSIT_FWD_PIPELINE, completedStageIds: [] };
    const journeyIdx = state.journey.findIndex((h) => h.router === router);
    if (journeyIdx === -1) return base;
    const isCurrent = journeyIdx === state.journey.length - 1;
    const hop = state.journey[journeyIdx];
    if (isCurrent) return { ...base, activeStageId: "label-action", completedStageIds: ["mpls-ingress", "label-lookup", "fwd-entry"], packetBefore: hop.input, packetAfter: hop.output };
    return { ...base, completedStageIds: allIds(TRANSIT_FWD_PIPELINE), packetBefore: hop.input, packetAfter: hop.output };
  }

  // --- RESV phase (brief §17) ---
  const inResvPhase = i >= STEP_IDX.resvHop1 && i < STEP_IDX.lspUp;
  if (inResvPhase && onPath && router !== state.lsp.egress) {
    const hopState = state.lsp.hops[router];
    const base: DeviceProcessingTrace = { deviceId: router, ingressInterfaceId: egressIfaceId, egressInterfaceId: ingressIfaceId, stages: RESV_PIPELINE, completedStageIds: [] };
    if (hopState?.resvSent) return { ...base, completedStageIds: allIds(RESV_PIPELINE) };
    if (hopState?.resvReceived) return { ...base, activeStageId: "allocate-label", completedStageIds: ["resv-received", "identify-session-resv", "reservation-state"] };
    return base;
  }

  // --- PATH phase (brief §13) — transit routers only; R1 originates, R6 is tailend-specific. ---
  const inPathPhase = i >= STEP_IDX.pathHop1 && i < STEP_IDX.resvHop1;
  if (inPathPhase && onPath && router !== state.lsp.ingress && router !== state.lsp.egress) {
    const hopState = state.lsp.hops[router];
    const base: DeviceProcessingTrace = { deviceId: router, ingressInterfaceId: ingressIfaceId, egressInterfaceId: egressIfaceId, stages: PATH_PIPELINE, completedStageIds: [] };
    if (hopState?.pathSent) return { ...base, completedStageIds: allIds(PATH_PIPELINE) };
    if (hopState?.pathReceived) return { ...base, activeStageId: "forward-path", completedStageIds: ["ip-ingress", "identify-session", "inspect-ero", "verify-hop", "check-path-state", "record-prev-hop"] };
    return base;
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Packet visual stack (brief §5-9 equivalent) — derived straight from state.packet.
// ---------------------------------------------------------------------------

export function packetFramesFor(state: RsvpTeState): PacketStackFrame[] | undefined {
  if (!state.packet) return undefined;
  const labelFrames: PacketStackFrame[] = state.packet.labels.map((l, idx) => ({ id: `label-${idx}`, text: `Transport ${l.value}`, tone: "transport", justChanged: idx === 0 }));
  return [...labelFrames, { id: "ip", text: "IP", tone: "ip" }];
}

// ---------------------------------------------------------------------------
// Physical interfaces (brief §42-44)
// ---------------------------------------------------------------------------

export function interfacesFor(router: RouterId, state: RsvpTeState): DeviceInterfaceData[] {
  return neighborLink(router).map(({ neighbor, link }) => {
    const available = computeAvailableBandwidth(link, state.backgroundReservations, forSnapshot(state.lsp));
    const onLsp = state.lsp.state === "UP" && state.lsp.path && state.lsp.path.includes(router) && state.lsp.path.includes(neighbor) && Math.abs(state.lsp.path.indexOf(router) - state.lsp.path.indexOf(neighbor)) === 1;
    return {
      id: `${router}-${neighbor}`,
      name: `to-${neighbor}`,
      status: "up",
      neighborId: neighbor,
      neighborLabel: neighbor,
      linkType: onLsp ? "Core (RSVP-TE LSP)" : "Core",
      mtu: 1500,
      protocols: link.rsvpEnabled ? ["IGP", "RSVP-TE"] : ["IGP"],
      role: onLsp ? (state.lsp.path![0] === router ? "egress" : "idle") : "idle",
      extra: [
        { label: "IGP Metric", value: String(link.igpMetric) },
        { label: "TE Metric", value: String(link.teMetric) },
        { label: "Max Reservable", value: `${link.maxReservableMbps} Mbps` },
        { label: "Available", value: `${available} Mbps` },
        { label: "Affinity", value: link.affinity },
      ],
    };
  });
}

// ---------------------------------------------------------------------------
// Link detail (brief §46)
// ---------------------------------------------------------------------------

export function linkDetailFor(linkId: string, state: RsvpTeState): LinkDetail | undefined {
  const link = TE_LINKS.find((l) => l.id === linkId);
  const edge = GRAPH_EDGES.find((e) => e.id === linkId);
  if (!link || !edge) return undefined;
  const available = computeAvailableBandwidth(link, state.backgroundReservations, forSnapshot(state.lsp));
  const onLsp = state.lsp.path?.includes(link.a) && state.lsp.path?.includes(link.b) && Math.abs(state.lsp.path!.indexOf(link.a) - state.lsp.path!.indexOf(link.b)) === 1 && state.lsp.state === "UP";
  const bgOnLink = state.backgroundReservations.filter((r) => r.linkId === link.id);
  const trafficParts: string[] = [];
  if (onLsp) trafficParts.push(`LSP ${state.lsp.id}: ${state.lsp.reservedBandwidthMbps} Mbps reserved`);
  bgOnLink.forEach((r) => trafficParts.push(`${r.label}: ${r.mbps} Mbps reserved`));

  return {
    aLabel: link.a,
    bLabel: link.b,
    aInterface: { id: `${link.a}-${link.b}`, name: `to-${link.b}`, status: "up", neighborId: link.b, neighborLabel: link.b, linkType: "Core", mtu: 1500, protocols: ["IGP", "RSVP-TE"], role: "idle" },
    bInterface: { id: `${link.b}-${link.a}`, name: `to-${link.a}`, status: "up", neighborId: link.a, neighborLabel: link.a, linkType: "Core", mtu: 1500, protocols: ["IGP", "RSVP-TE"], role: "idle" },
    status: "up",
    mtu: 1500,
    protocols: [
      { label: "IGP Metric", value: String(link.igpMetric) },
      { label: "TE Metric", value: String(link.teMetric) },
      { label: "Max Reservable", value: `${link.maxReservableMbps} Mbps` },
      { label: "Available", value: `${available} Mbps` },
      { label: "Affinity", value: link.affinity },
      { label: "RSVP", value: link.rsvpEnabled ? "Enabled" : "Disabled" },
    ],
    currentTraffic: trafficParts.join("; ") || undefined,
  };
}

export function linkIdForRouters(a: RouterId, b: RouterId): LinkId | undefined {
  return TE_LINKS.find((l) => (l.a === a && l.b === b) || (l.b === a && l.a === b))?.id;
}
