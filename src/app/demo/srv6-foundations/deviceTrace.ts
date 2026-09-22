import type { DeviceInterfaceData, DeviceProcessingTrace, LinkDetail, PacketMutation, PacketStackFrame, ProcessingStage } from "@/components/network3d/types";
import type { PacketVisual } from "@/lib/sim-engine/types";
import {
  GRAPH_EDGES,
  LINKS,
  buildIpv6Fib,
  fmtIpv6,
  linkIdBetween,
  type FwdAction,
  type JourneyHop,
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

// ---------------------------------------------------------------------------
// Hop Inspector enrichment (ARCHITECTURE.md §17/§18) — additive
// DeviceProcessingTrace fields, derived entirely from the JourneyHop the
// scenario file already recorded (`hop.input`/`lookup`/`action`/`output`).
// This file computes NO new forwarding fact; it only reshapes facts the
// scenario already decided into the generic ingress/egress/lookup/
// nextHop/reason/mutation shape the shared <HopInspectorPanel>/
// <PacketDiffViewer> expect.
// ---------------------------------------------------------------------------

const LOOKUP_TYPE_BY_ACTION: Record<FwdAction, string> = {
  SR_POLICY_HEADEND: "Segment Program Classification",
  IPV6_FIB_FORWARD: "IPv6 FIB",
  LOCAL_SID_MATCH: "Local SID Table",
  END_BEHAVIOR: "Local SID Table (End)",
  DA_UPDATE: "Local SID Table (End)",
  FINAL_END: "Local SID Table (End)",
  DELIVER: "Local SID Table (End)",
  DROP_MISSING_LOCAL_SID: "Local SID Table",
};

/** A hop's `input`/`output` for a DA_UPDATE always has the shape "<DA>, SL=<n>" — never any other JourneyHop text. */
function splitDaAndSl(text: string): { da: string; sl?: string } {
  const idx = text.indexOf(", SL=");
  if (idx === -1) return { da: text };
  return { da: text.slice(0, idx), sl: text.slice(idx + ", SL=".length) };
}

function mutationsForHop(hop: JourneyHop): PacketMutation[] {
  if (hop.action !== "DA_UPDATE") return [];
  const before = splitDaAndSl(hop.input);
  const after = splitDaAndSl(hop.output);
  const mutations: PacketMutation[] = [];
  if (before.sl !== undefined && after.sl !== undefined) mutations.push({ type: "SEGMENTS_LEFT_CHANGE", detail: `${before.sl} → ${after.sl}` });
  mutations.push({ type: "DA_CHANGE", detail: `${before.da} → ${after.da}` });
  return mutations;
}

/** Reshapes one hop.input/output string into packet-stack frames — never a new fact, only a display split of the DA/SL text (or terminal prose like "Delivered"/"DROPPED") the scenario already produced. */
function frameGroupFor(prefix: string, text: string, markChanged: boolean): PacketStackFrame[] {
  const { da, sl } = splitDaAndSl(text);
  if (sl !== undefined) {
    return [
      { id: `${prefix}-da`, text: `IPv6 DA = ${da}`, tone: "ip", justChanged: markChanged },
      { id: `${prefix}-srh`, text: `SRH Segments Left = ${sl}`, tone: "transport", justChanged: markChanged },
    ];
  }
  if (da.includes(":")) return [{ id: `${prefix}-da`, text: `IPv6 DA = ${da}`, tone: "ip", justChanged: markChanged }];
  return [{ id: `${prefix}-status`, text: da, tone: "generic", justChanged: markChanged }];
}

function nextHopFor(hop: JourneyHop, state: Srv6State): { id?: RouterId; label?: string } {
  if (hop.output === "Delivered" || hop.action === "DROP_MISSING_LOCAL_SID") return {};
  const idx = state.journey.indexOf(hop);
  const isLast = idx === state.journey.length - 1;
  // When this is the most-recently-recorded hop, `state.packetAt` already
  // reflects where the packet now IS (ARCHITECTURE.md §1) — the next hop
  // this very decision produced. For an earlier, already-passed hop, the
  // next journey entry is the authoritative next hop instead.
  const nextRouter = !isLast ? state.journey[idx + 1]?.router : state.packetAt;
  if (!nextRouter || nextRouter === hop.router) return {};
  return { id: nextRouter, label: nextRouter };
}

/**
 * The real previous DIFFERENT-device hop — scans backward past any
 * consecutive same-router journey entries (e.g. R3's own
 * LOCAL_SID_MATCH -> DA_UPDATE are two separate journey entries for the
 * same internal End-processing instant). A naive "immediately previous
 * entry" lookup would self-reference as "R3-R3" the moment a router logs
 * more than one hop in a row for its own local processing.
 */
function prevRouterFor(hop: JourneyHop, state: Srv6State): RouterId | undefined {
  const idx = state.journey.indexOf(hop);
  for (let i = idx - 1; i >= 0; i--) {
    if (state.journey[i].router !== hop.router) return state.journey[i].router;
  }
  return undefined;
}

/**
 * The real next DIFFERENT-device hop — the egress-interface counterpart
 * of `prevRouterFor` above, scanning forward past consecutive
 * same-router journey entries for the same reason. Deliberately separate
 * from `nextHopFor` (used for the Hop Inspector's "NEXT HOP" field and
 * "Go to next hop" button): a same-router internal step like
 * LOCAL_SID_MATCH genuinely has no "next hop" yet — End hasn't executed
 * — but its own egress INTERFACE display must not fall back to a
 * fabricated static neighbor default just because the immediate next
 * journey entry happens to share its router.
 */
function nextDifferentRouterFor(hop: JourneyHop, state: Srv6State): RouterId | undefined {
  const idx = state.journey.indexOf(hop);
  for (let i = idx + 1; i < state.journey.length; i++) {
    if (state.journey[i].router !== hop.router) return state.journey[i].router;
  }
  const isLast = idx === state.journey.length - 1;
  return isLast && state.packetAt && state.packetAt !== hop.router ? state.packetAt : undefined;
}

/**
 * Picks the ACTUAL ingress/egress interface for a hop, directionally —
 * from the real previous/next DIFFERENT-router hop in `state.journey`
 * (falling back to the static "first two neighbors found" ids when no
 * hop has happened yet, OR when the derived previous/next router isn't
 * actually a direct physical neighbor of `router`). The latter case is
 * real: some steps (the locator-experiment resend, the fault/repair
 * resends) compress more than one physical hop into a single journey
 * entry recorded against the SENDING router — e.g. R1's own entry can
 * legitimately represent "reached R3" via R2 without R2 ever getting
 * its own entry. Naively building `${router}-${thatRouter}` would then
 * fabricate a nonexistent link id (R3-R1, when only R2-R3 exists) — the
 * anti-fake-data rule (ARCHITECTURE.md §18) means an unverifiable
 * direction must fall back to the generic display default, never invent
 * a link. A router with more than two neighbors (e.g. R1: R2 and R4)
 * could otherwise show "Egress: to-R2" next to a hop that actually
 * forwarded toward R4 — the generic ids are a display default, never a
 * forwarding decision (see the "Known correctness fix" in
 * ARCHITECTURE.md §17, which this lesson previously did not apply).
 */
function directionalInterfaces(router: RouterId, hop: JourneyHop | undefined, state: Srv6State, fallbackIngress: string | undefined, fallbackEgress: string | undefined): { ingressInterfaceId?: string; egressInterfaceId?: string } {
  if (!hop) return { ingressInterfaceId: fallbackIngress, egressInterfaceId: fallbackEgress };
  const prevRouter = prevRouterFor(hop, state);
  const nextRouter = nextDifferentRouterFor(hop, state);
  const realPrev = prevRouter && linkIdBetween(router, prevRouter, state.links) ? prevRouter : undefined;
  const realNext = nextRouter && linkIdBetween(router, nextRouter, state.links) ? nextRouter : undefined;
  return {
    ingressInterfaceId: realPrev ? `${router}-${realPrev}` : fallbackIngress,
    egressInterfaceId: realNext ? `${router}-${realNext}` : fallbackEgress,
  };
}

/**
 * Historical (timeline) inspection needs a "which device is this step
 * about" subject even for the handful of steps that mutate state but
 * carry no packet of their own (the fault injection / repair steps).
 * Every packet-carrying step instead resolves from the packet's own
 * `from`/`to` (sender priority — `state.journey` records each hop
 * against the router that PERFORMED the action, exactly like SR-MPLS's
 * `deviceForStep`). A link-metric-only step (the locator experiment)
 * has no single honest device subject and is deliberately left out —
 * it simply won't appear as a HopTimeline entry.
 */
export const PRIMARY_TRANSITION_ROUTER: Partial<Record<string, RouterId>> = {
  "troubleshooting-intro": "R3",
  "fault-inject": "R3",
  "repair-applied": "R3",
};

export function deviceForStep(stepId: string, packet: PacketVisual | undefined): RouterId | undefined {
  if (packet) return (packet.from ?? packet.to) as RouterId;
  return PRIMARY_TRANSITION_ROUTER[stepId];
}

function hopInspectionFields(hop: JourneyHop, state: Srv6State): Partial<DeviceProcessingTrace> {
  const nextHop = nextHopFor(hop, state);
  return {
    lookupType: LOOKUP_TYPE_BY_ACTION[hop.action],
    lookupKey: hop.input,
    lookupResult: `${hop.action} → ${hop.output}`,
    reason: hop.lookup,
    nextHopId: nextHop.id,
    nextHopLabel: nextHop.label,
    mutations: mutationsForHop(hop),
    packetBeforeFrames: frameGroupFor("before", hop.input, false),
    packetAfterFrames: frameGroupFor("after", hop.output, true),
  };
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
    const dir = directionalInterfaces(router, undefined, state, router === "R1" ? undefined : ingressIfaceId, egressIfaceId);
    return { deviceId: router, ingressInterfaceId: dir.ingressInterfaceId, egressInterfaceId: dir.egressInterfaceId, stages, completedStageIds: [] };
  }

  const hopFields = hopInspectionFields(hop, state);

  if (hop.action === "DROP_MISSING_LOCAL_SID") {
    const dir = directionalInterfaces(router, hop, state, ingressIfaceId, undefined);
    return { deviceId: router, ingressInterfaceId: dir.ingressInterfaceId, stages: DROP_PIPELINE, activeStageId: isCurrent ? "drop" : undefined, completedStageIds: isCurrent ? ["receive", "local-sid-check", "no-entry"] : allIds(DROP_PIPELINE), packetBefore: hop.input, packetAfter: hop.output, ...hopFields };
  }

  if (hop.action === "LOCAL_SID_MATCH") {
    const dir = directionalInterfaces(router, hop, state, ingressIfaceId, undefined);
    return { deviceId: router, ingressInterfaceId: dir.ingressInterfaceId, stages: END_PIPELINE, activeStageId: isCurrent ? "match" : undefined, completedStageIds: isCurrent ? ["receive", "local-sid-check"] : ["receive", "local-sid-check", "match"], packetBefore: hop.input, packetAfter: hop.output, ...hopFields };
  }

  if (hop.action === "DA_UPDATE") {
    const dir = directionalInterfaces(router, hop, state, ingressIfaceId, egressIfaceId);
    return { deviceId: router, ingressInterfaceId: dir.ingressInterfaceId, egressInterfaceId: dir.egressInterfaceId, stages: END_PIPELINE, activeStageId: isCurrent ? "update-da" : undefined, completedStageIds: isCurrent ? ["receive", "local-sid-check", "match", "decrement-sl"] : allIds(END_PIPELINE), packetBefore: hop.input, packetAfter: hop.output, ...hopFields };
  }

  if (hop.action === "FINAL_END" || (hop.action === "DELIVER" && router !== "R1")) {
    const dir = directionalInterfaces(router, hop, state, ingressIfaceId, undefined);
    return { deviceId: router, ingressInterfaceId: dir.ingressInterfaceId, stages: FINAL_END_PIPELINE, activeStageId: isCurrent ? "deliver" : undefined, completedStageIds: isCurrent ? ["receive", "local-sid-check", "match", "final-segment"] : allIds(FINAL_END_PIPELINE), packetBefore: hop.input, packetAfter: hop.output, ...hopFields };
  }

  // IPV6_FIB_FORWARD — ordinary transit (also R1's headend forward)
  const stages = router === "R1" ? HEADEND_PIPELINE : TRANSIT_PIPELINE;
  const activeId = router === "R1" ? "forward" : "fib-lookup";
  const completed = router === "R1" ? ["classify", "impose-da", "fib-lookup"] : ["receive", "local-sid-check", "no-match"];
  const dir = directionalInterfaces(router, hop, state, router === "R1" ? undefined : ingressIfaceId, egressIfaceId);
  return { deviceId: router, ingressInterfaceId: dir.ingressInterfaceId, egressInterfaceId: dir.egressInterfaceId, stages, activeStageId: isCurrent ? activeId : undefined, completedStageIds: isCurrent ? completed : allIds(stages), packetBefore: hop.input, packetAfter: hop.output, ...hopFields };
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
