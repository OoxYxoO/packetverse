import type { DeviceInterfaceData, DeviceProcessingTrace, LinkDetail, PacketMutation, PacketStackFrame, ProcessingStage } from "@/components/network3d/types";
import type { PacketVisual } from "@/lib/sim-engine/types";
import {
  ALL_ROUTERS,
  GRAPH_EDGES,
  STEP_IDX,
  TE_LINKS,
  computeAvailableBandwidth,
  fmtLabel,
  forSnapshot,
  rsvpTeSteps,
  type JourneyHop,
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
 *
 * Two genuinely distinct journeys live here (mirrors mpls-ldp's
 * deviceTrace.ts): RSVP control-plane signaling (PATH downstream,
 * RESV upstream) is keyed off `currentStepId` + `RsvpLsp.hops`, since
 * there is no growing per-hop array for signaling; MPLS data-plane
 * forwarding instead reuses the existing, already-correct
 * `state.journey: JourneyHop[]`, exactly like every other MPLS lesson.
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

/** Upstream/downstream neighbor of `router` ALONG THE SIGNALED PATH (distinct from `neighborLink`'s raw adjacency, which is arbitrary-ordered and doesn't know which neighbor is on this LSP) — used only to derive `nextHopId`/reason text, never a second path computation (brief §9: don't recompute a path in React). */
function pathNeighbors(path: RouterId[] | undefined, router: RouterId): { prev?: RouterId; next?: RouterId } {
  if (!path) return {};
  const idx = path.indexOf(router);
  if (idx === -1) return {};
  return { prev: idx > 0 ? path[idx - 1] : undefined, next: idx < path.length - 1 ? path[idx + 1] : undefined };
}

function extractLabel(text: string): number | undefined {
  const m = text.match(/label (\d+)/);
  return m ? Number(m[1]) : undefined;
}
function stackFramesFor(prefix: string, text: string, justChanged: boolean): PacketStackFrame[] {
  const label = extractLabel(text);
  const frames: PacketStackFrame[] = [];
  if (label !== undefined) frames.push({ id: `${prefix}-mpls`, text: `Transport ${label}`, tone: "transport", justChanged });
  frames.push({ id: `${prefix}-ip`, text: "IP", tone: "ip" });
  return frames;
}
function mutationsForHop(hop: JourneyHop): PacketMutation[] {
  switch (hop.action) {
    case "PUSH":
      return [{ type: "PUSH", detail: hop.output }];
    case "SWAP":
      return [{ type: "SWAP", detail: hop.output }];
    case "POP":
      return [{ type: "POP", detail: hop.input }];
    default:
      return [];
  }
}

/** Which of the two path roles (PATH-processing transit, RESV-processing transit) applies right now, keyed off the CURRENT step id — a router plays a different conceptual role at different lesson phases (brief §13 vs §17 vs §24-26). Additive Hop Inspector fields (lookupType/lookupKey/lookupResult/nextHopId/reason/packet frames/mutations — brief §17 "Hop Inspection Contract") are populated wherever the underlying signaling/journey state already carries that information; nothing here is fabricated beyond what RsvpTeState already computed. */
export function traceFor(router: RouterId, state: RsvpTeState, currentStepId: string): DeviceProcessingTrace | undefined {
  const i = stepIndex(currentStepId);
  const path = state.lsp.path;
  const onPath = path?.includes(router) ?? false;
  // Path-aware interface ids — every branch below runs on an on-path
  // router, where the ACTUAL upstream/downstream neighbor is known from
  // the signaled path itself. (A generic `neighborLink`-order guess would
  // show the wrong "Ingress"/"Egress" interface whenever a router's
  // off-LSP neighbor happens to sort first — e.g. R6 always has two
  // neighbors, R4 and R5, and only one of them is actually on the
  // signaled path.)
  const { prev: pathPrevRouter, next: pathNextRouter } = pathNeighbors(path, router);
  const prevIfaceId = pathPrevRouter ? `${router}-${pathPrevRouter}` : undefined;
  const nextIfaceId = pathNextRouter ? `${router}-${pathNextRouter}` : undefined;

  // --- Data-plane phase (brief §24-26) — takes priority once a data packet exists at/after this router. Reuses the existing, already-immutable `state.journey` exactly like every other MPLS lesson (never a second forwarding log). ---
  const inDataPhase = i >= STEP_IDX.sendDataPacket && state.packet;
  if (inDataPhase && onPath && path) {
    const idx = path.indexOf(router);
    const hop = state.journey.find((h) => h.router === router);
    const isCurrentHop = !!hop && hop === state.journey[state.journey.length - 1];
    const nextRouter = pathNextRouter;

    if (idx === 0) {
      const base: DeviceProcessingTrace = { deviceId: router, ingressInterfaceId: undefined, egressInterfaceId: nextIfaceId, stages: INGRESS_FWD_PIPELINE, completedStageIds: [] };
      if (!hop) return base;
      const enrich = {
        lookupType: "RSVP-TE Forwarding State",
        lookupKey: hop.input,
        lookupResult: `${hop.action} → ${hop.output}`,
        reason: hop.lookup,
        nextHopId: nextRouter,
        nextHopLabel: nextRouter,
        packetBefore: hop.input,
        packetAfter: hop.output,
        packetBeforeFrames: stackFramesFor("before", hop.input, false),
        packetAfterFrames: stackFramesFor("after", hop.output, true),
        mutations: mutationsForHop(hop),
      };
      if (isCurrentHop) return { ...base, activeStageId: "push", completedStageIds: ["classify", "select-lsp", "fwd-state"], ...enrich };
      return { ...base, completedStageIds: allIds(INGRESS_FWD_PIPELINE), ...enrich };
    }
    if (idx === path.length - 1) {
      const base: DeviceProcessingTrace = { deviceId: router, ingressInterfaceId: prevIfaceId, egressInterfaceId: undefined, stages: TAILEND_FWD_PIPELINE, completedStageIds: [] };
      if (!hop) return base;
      return {
        ...base,
        completedStageIds: allIds(TAILEND_FWD_PIPELINE),
        lookupType: "IP Delivery",
        lookupResult: hop.output,
        reason: hop.lookup,
        packetBefore: hop.input,
        packetAfter: hop.output,
        packetBeforeFrames: stackFramesFor("before", hop.input, false),
        packetAfterFrames: [{ id: "delivered", text: "IP (delivered)", tone: "ip" }],
      };
    }
    const base: DeviceProcessingTrace = { deviceId: router, ingressInterfaceId: prevIfaceId, egressInterfaceId: nextIfaceId, stages: TRANSIT_FWD_PIPELINE, completedStageIds: [] };
    if (!hop) return base;
    const enrich = {
      lookupType: hop.action === "POP" ? "RSVP-Installed Forwarding Entry (PHP)" : "RSVP-Installed Forwarding Entry",
      lookupKey: hop.input,
      lookupResult: `${hop.action} → ${hop.output}`,
      reason: hop.lookup,
      nextHopId: nextRouter,
      nextHopLabel: nextRouter,
      packetBefore: hop.input,
      packetAfter: hop.output,
      packetBeforeFrames: stackFramesFor("before", hop.input, false),
      packetAfterFrames: stackFramesFor("after", hop.output, true),
      mutations: mutationsForHop(hop),
    };
    if (isCurrentHop) return { ...base, activeStageId: "label-action", completedStageIds: ["mpls-ingress", "label-lookup", "fwd-entry"], ...enrich };
    return { ...base, completedStageIds: allIds(TRANSIT_FWD_PIPELINE), ...enrich };
  }

  // --- RESV phase (brief §17) — travels egress → ingress; reservation/label fields come straight off `HopSignalState`. ---
  const inResvPhase = i >= STEP_IDX.resvHop1 && i < STEP_IDX.lspUp;
  if (inResvPhase && onPath && router !== state.lsp.egress) {
    const hopState = state.lsp.hops[router];
    const upstreamRouter = pathPrevRouter;
    const base: DeviceProcessingTrace = { deviceId: router, ingressInterfaceId: nextIfaceId, egressInterfaceId: prevIfaceId, stages: RESV_PIPELINE, completedStageIds: [] };
    if (hopState?.resvSent) {
      return {
        ...base,
        completedStageIds: allIds(RESV_PIPELINE),
        lookupType: "RSVP RESV — Label Installation",
        lookupKey: hopState.label !== undefined ? `Label ${fmtLabel(hopState.label)}` : undefined,
        lookupResult: `Advertised ${hopState.label !== undefined ? fmtLabel(hopState.label) : "—"} upstream${upstreamRouter ? ` to ${upstreamRouter}` : ""}`,
        reason: "Bandwidth admitted locally; forwarding entry programmed; RESV propagated upstream.",
        nextHopId: upstreamRouter,
        nextHopLabel: upstreamRouter,
        packetBefore: "RESV received from downstream",
        packetAfter: `RESV forwarded upstream${upstreamRouter ? ` to ${upstreamRouter}` : ""}`,
      };
    }
    if (hopState?.resvReceived) {
      const isIngress = router === state.lsp.ingress;
      return {
        ...base,
        activeStageId: "allocate-label",
        completedStageIds: ["resv-received", "identify-session-resv", "reservation-state"],
        lookupType: "RSVP RESV — Label Installation",
        lookupResult: isIngress ? `Reservation confirmed: ${state.lsp.requestedBandwidthMbps} Mbps end to end` : "Reservation received from downstream — allocating a label for upstream advertisement",
        reason: isIngress ? "This is the ingress — nothing further upstream, so RESV is not propagated any further." : undefined,
        packetBefore: "RESV received from downstream",
      };
    }
    return base;
  }

  // --- PATH phase (brief §13) — transit routers only; R1 originates, R6 is tailend-specific. Travels ingress → egress. ---
  const inPathPhase = i >= STEP_IDX.pathHop1 && i < STEP_IDX.resvHop1;
  if (inPathPhase && onPath && router !== state.lsp.ingress && router !== state.lsp.egress) {
    const hopState = state.lsp.hops[router];
    const upstreamRouter = pathPrevRouter;
    const downstreamRouter = pathNextRouter;
    const base: DeviceProcessingTrace = { deviceId: router, ingressInterfaceId: prevIfaceId, egressInterfaceId: nextIfaceId, stages: PATH_PIPELINE, completedStageIds: [] };
    if (hopState?.pathSent) {
      return {
        ...base,
        completedStageIds: allIds(PATH_PIPELINE),
        lookupType: "RSVP PATH Signaling",
        lookupKey: `Session ${state.lsp.egress} / Tunnel-ID 1`,
        lookupResult: `PATH forwarded toward ${downstreamRouter ?? "—"}`,
        reason: `Local hop verified against the ERO; ${upstreamRouter ?? "the sender"} recorded as this session's previous RSVP hop.`,
        nextHopId: downstreamRouter,
        nextHopLabel: downstreamRouter,
        packetBefore: `PATH received from ${upstreamRouter ?? "upstream"}`,
        packetAfter: `PATH forwarded to ${downstreamRouter ?? "—"}`,
      };
    }
    if (hopState?.pathReceived) {
      return {
        ...base,
        activeStageId: "forward-path",
        completedStageIds: ["ip-ingress", "identify-session", "inspect-ero", "verify-hop", "check-path-state", "record-prev-hop"],
        lookupType: "RSVP PATH Signaling",
        lookupKey: `Session ${state.lsp.egress} / Tunnel-ID 1`,
        lookupResult: "Local hop verified against the ERO — about to forward PATH downstream",
        reason: `${upstreamRouter ?? "Upstream"} recorded as this session's previous RSVP hop.`,
        packetBefore: `PATH received from ${upstreamRouter ?? "upstream"}`,
      };
    }
    return base;
  }

  return undefined;
}

/** Steps with a real, inspectable device trace but no `packet` field of their own — the conceptual pipeline-inspection narrative steps, where the previous step's signaling already put a router mid-pipeline (brief §16: reuse real state, never fabricate a new one). Kept as an explicit, auditable map rather than a runtime search, mirroring mpls-ldp's `PRIMARY_TRANSITION_ROUTER`. */
export const PRIMARY_TRANSITION_ROUTER: Partial<Record<string, RouterId>> = {
  "path-r3-pipeline": "R3",
  "resv-r5-pipeline": "R5",
};

/** Which router is the primary inspection subject of a given historical step — the router `traceFor` currently shows as actively mid-stage (works correctly for BOTH the PATH/RESV phases, where the RECEIVING router is the one with real progress, and the data-plane phase, where the SENDING router is — see traceFor's branches), falling back to the packet's endpoints, then the fixed pipeline-narrative map. */
export function deviceForStep(stepId: string, state: RsvpTeState, packet: PacketVisual | undefined): RouterId | undefined {
  const active = ALL_ROUTERS.find((r) => traceFor(r, state, stepId)?.activeStageId !== undefined);
  if (active) return active;
  if (packet) {
    const to = packet.to as RouterId;
    if (ALL_ROUTERS.includes(to) && traceFor(to, state, stepId)) return to;
    const from = packet.from as RouterId;
    if (ALL_ROUTERS.includes(from) && traceFor(from, state, stepId)) return from;
    if (ALL_ROUTERS.includes(to)) return to;
  }
  return PRIMARY_TRANSITION_ROUTER[stepId];
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
