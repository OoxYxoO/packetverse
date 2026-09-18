import type { DeviceInterfaceData, DeviceProcessingTrace, LinkDetail, PacketMutation, PacketStackFrame, ProcessingStage } from "@/components/network3d/types";
import {
  GRAPH_EDGES,
  LINKS,
  fmtLabel,
  resolveActiveSegment,
  type FwdAction,
  type JourneyHop,
  type LinkId,
  type RouterId,
  type SrMplsState,
} from "@/lib/sim-engine/scenarios/srMplsFoundations";

/**
 * Scene Adapter for SR-MPLS Foundations' device-interior 3D view. Every
 * stage list and interface/link value below is derived FROM SrMplsState
 * — this file makes no SID/segment/IGP decision itself.
 */

const NODE_SID_PIPELINE: ProcessingStage[] = [
  { id: "ingress", label: "MPLS Ingress" },
  { id: "label-lookup", label: "Active SID Label Lookup" },
  { id: "identify-instruction", label: "Identify Prefix-SID / Forwarding Instruction" },
  { id: "spt-nexthop", label: "Shortest-Path Next Hop Toward SID Prefix" },
  { id: "label-action", label: "MPLS Label Action" },
  { id: "forward", label: "Forward" },
];
const ADJ_SID_PIPELINE: ProcessingStage[] = [
  { id: "active-lookup", label: "Active SID Lookup" },
  { id: "owner-check", label: "SID Owner = Local Router" },
  { id: "type-check", label: "SID Type = Adjacency" },
  { id: "resolve-adjacency", label: "Resolve Specified Adjacency" },
  { id: "send-adjacency", label: "Send Over That Adjacency" },
  { id: "next-active", label: "Next Segment Becomes Active" },
];
const HEADEND_PIPELINE: ProcessingStage[] = [
  { id: "classify", label: "Classify Into Segment List" },
  { id: "push", label: "PUSH Segment Stack" },
  { id: "egress", label: "Egress" },
];
const TAILEND_PIPELINE: ProcessingStage[] = [
  { id: "label-lookup", label: "Label Lookup" },
  { id: "target-check", label: "Self Is Segment Target" },
  { id: "deliver", label: "Deliver" },
];
const INVALID_PIPELINE: ProcessingStage[] = [
  { id: "active-lookup", label: "Active SID Lookup" },
  { id: "ownership-check", label: "Ownership / Scope Check" },
  { id: "not-owned", label: "NOT OWNED HERE" },
  { id: "drop", label: "Drop" },
];

const allIds = (s: ProcessingStage[]) => s.map((x) => x.id);

function neighborLinks(router: RouterId): { neighbor: RouterId; link: (typeof LINKS)[number] }[] {
  return LINKS.filter((l) => l.a === router || l.b === router).map((l) => ({ neighbor: l.a === router ? l.b : l.a, link: l }));
}

// ---------------------------------------------------------------------------
// Hop Inspector enrichment (brief §17/§19) — additive DeviceProcessingTrace
// fields, derived entirely from the JourneyHop the scenario file already
// recorded (`hop.input`/`lookup`/`action`/`output`). This file computes NO
// new forwarding fact; it only reshapes facts the scenario already decided
// into the generic ingress/egress/lookup/nextHop/reason/mutation shape the
// shared <HopInspectorPanel>/<PacketDiffViewer> expect (brief §38).
// ---------------------------------------------------------------------------

const LOOKUP_TYPE_BY_ACTION: Record<FwdAction, string> = {
  PUSH: "Segment List",
  CONTINUE: "LFIB (SPT Next-Hop)",
  POP: "LFIB (PHP / Node SID)",
  POP_AND_FORWARD_ADJ: "LFIB (Adjacency SID)",
  IP_FORWARD: "IP Routing",
  INVALID_SID: "LFIB (Ownership / Scope Check)",
};

// A hop's `input`/`output` string is only ever a real MPLS label when it is
// exactly a numeric label value or "implicit-null" (see `fmtLabel`) — every
// other value (plain "IP", "Delivered", "DROPPED", or a directional hint
// like "toward R2" from the pre-SR IGP-forwarding recap steps) is prose,
// never a label, and must not be presented as one.
function isLabelToken(text: string): boolean {
  return /^\d+$/.test(text) || text === "implicit-null";
}

function frameGroupFor(prefix: string, text: string, markChanged: boolean): PacketStackFrame[] {
  return text.split(" / ").map((part, i) => {
    const trimmed = part.trim();
    const label = isLabelToken(trimmed);
    return { id: `${prefix}-${i}`, text: label ? `MPLS ${trimmed}` : trimmed, tone: label ? "transport" : "ip", justChanged: markChanged && i === 0 };
  });
}

function mutationsForAction(hop: JourneyHop): PacketMutation[] {
  switch (hop.action) {
    case "PUSH":
      return [{ type: "PUSH", detail: hop.output }];
    case "POP":
    case "POP_AND_FORWARD_ADJ":
      return [{ type: "POP", detail: hop.input }];
    default:
      return [];
  }
}

function nextHopFor(hop: JourneyHop, state: SrMplsState): { id?: RouterId; label?: string } {
  if (hop.output === "Delivered" || hop.action === "INVALID_SID") return {};
  const idx = state.journey.indexOf(hop);
  const isLast = idx === state.journey.length - 1;
  // When this is the most-recently-recorded hop, `state.packetAt` already
  // reflects where the packet now IS (see ARCHITECTURE.md §1) — i.e. the
  // next hop this very decision produced. For an earlier, already-passed
  // hop, the next journey entry is the authoritative next hop instead.
  const nextRouter = !isLast ? state.journey[idx + 1]?.router : state.packetAt;
  if (!nextRouter || nextRouter === hop.router) return {};
  return { id: nextRouter, label: nextRouter };
}

function prevRouterFor(hop: JourneyHop, state: SrMplsState): RouterId | undefined {
  const idx = state.journey.indexOf(hop);
  return idx > 0 ? state.journey[idx - 1].router : undefined;
}

/**
 * Picks the ACTUAL ingress/egress interface for a hop, directionally —
 * from the real previous/next router in `state.journey` (falling back to
 * the static "first two neighbors found" ids only when no hop has
 * happened yet, i.e. nothing directional to derive). Fixes a case where
 * a router with more than two neighbors (e.g. R1: R2 and R3) could show
 * "Egress: to-R3" next to "Action: IP_FORWARD → toward R2" — the generic
 * ids are a display default, never a forwarding decision (brief §38).
 */
function directionalInterfaces(router: RouterId, hop: JourneyHop | undefined, state: SrMplsState, fallbackIngress: string | undefined, fallbackEgress: string | undefined): { ingressInterfaceId?: string; egressInterfaceId?: string } {
  if (!hop) return { ingressInterfaceId: fallbackIngress, egressInterfaceId: fallbackEgress };
  const prevRouter = prevRouterFor(hop, state);
  const next = nextHopFor(hop, state);
  return {
    ingressInterfaceId: prevRouter ? `${router}-${prevRouter}` : fallbackIngress,
    egressInterfaceId: next.id ? `${router}-${next.id}` : fallbackEgress,
  };
}

function hopInspectionFields(hop: JourneyHop, state: SrMplsState): Partial<DeviceProcessingTrace> {
  const nextHop = nextHopFor(hop, state);
  return {
    lookupType: LOOKUP_TYPE_BY_ACTION[hop.action],
    lookupKey: hop.input,
    lookupResult: `${hop.action} → ${hop.output}`,
    reason: hop.lookup,
    nextHopId: nextHop.id,
    nextHopLabel: nextHop.label,
    mutations: mutationsForAction(hop),
    packetBeforeFrames: frameGroupFor("before", hop.input, false),
    packetAfterFrames: frameGroupFor("after", hop.output, true),
  };
}

export function traceFor(router: RouterId, state: SrMplsState): DeviceProcessingTrace | undefined {
  const nbrs = neighborLinks(router);
  const ingressIfaceId = nbrs[0] ? `${router}-${nbrs[0].neighbor}` : undefined;
  const egressIfaceId = nbrs[1] ? `${router}-${nbrs[1].neighbor}` : undefined;
  const hops = state.journey.filter((h) => h.router === router);
  const hop = hops[hops.length - 1];
  const isCurrent = state.journey.length > 0 && state.journey[state.journey.length - 1].router === router;

  if (router === "R1") {
    const invalid = state.fault && hop?.action === "INVALID_SID";
    const stages = invalid ? INVALID_PIPELINE : HEADEND_PIPELINE;
    const dir = directionalInterfaces(router, hop, state, undefined, egressIfaceId);
    const base: DeviceProcessingTrace = { deviceId: router, egressInterfaceId: dir.egressInterfaceId, stages, completedStageIds: [] };
    if (!hop) return base;
    const hopFields = hopInspectionFields(hop, state);
    if (invalid) return { ...base, activeStageId: isCurrent ? "drop" : undefined, completedStageIds: allIds(INVALID_PIPELINE), packetBefore: hop.input, packetAfter: hop.output, ...hopFields };
    if (isCurrent) return { ...base, activeStageId: "push", completedStageIds: ["classify"], packetBefore: hop.input, packetAfter: hop.output, ...hopFields };
    return { ...base, completedStageIds: allIds(HEADEND_PIPELINE), packetBefore: hop.input, packetAfter: hop.output, ...hopFields };
  }
  if (router === "R6") {
    const dir = directionalInterfaces(router, hop, state, ingressIfaceId, undefined);
    const base: DeviceProcessingTrace = { deviceId: router, ingressInterfaceId: dir.ingressInterfaceId, stages: TAILEND_PIPELINE, completedStageIds: [] };
    if (!hop) return base;
    const hopFields = hopInspectionFields(hop, state);
    if (isCurrent) return { ...base, activeStageId: hop.action === "IP_FORWARD" ? "deliver" : "target-check", completedStageIds: ["label-lookup"], packetBefore: hop.input, packetAfter: hop.output, ...hopFields };
    return { ...base, completedStageIds: allIds(TAILEND_PIPELINE), packetBefore: hop.input, packetAfter: hop.output, ...hopFields };
  }

  const isAdjExec = hop?.action === "POP_AND_FORWARD_ADJ";
  const stages = isAdjExec ? ADJ_SID_PIPELINE : NODE_SID_PIPELINE;
  const dir = directionalInterfaces(router, hop, state, ingressIfaceId, egressIfaceId);
  const base: DeviceProcessingTrace = { deviceId: router, ingressInterfaceId: dir.ingressInterfaceId, egressInterfaceId: dir.egressInterfaceId, stages, completedStageIds: [] };
  if (!hop) return base;
  const hopFields = hopInspectionFields(hop, state);
  if (isCurrent) {
    return {
      ...base,
      activeStageId: isAdjExec ? "send-adjacency" : hop.action === "POP" ? "label-action" : "forward",
      completedStageIds: isAdjExec ? ["active-lookup", "owner-check", "type-check", "resolve-adjacency"] : ["ingress", "label-lookup", "identify-instruction", "spt-nexthop"],
      packetBefore: hop.input,
      packetAfter: hop.output,
      ...hopFields,
    };
  }
  return { ...base, completedStageIds: allIds(stages), packetBefore: hop.input, packetAfter: hop.output, ...hopFields };
}

export function packetFramesFor(state: SrMplsState): PacketStackFrame[] | undefined {
  if (!state.packet) return undefined;
  const active = resolveActiveSegment(state.segmentList ?? []);
  const labelFrames: PacketStackFrame[] = state.packet.labels.map((l, idx) => ({ id: `label-${idx}`, text: `${l.value === active?.sid ? "Active" : "Segment"} ${fmtLabel(l.value)}`, tone: "transport", justChanged: idx === 0 }));
  return [...labelFrames, { id: "ip", text: "IP", tone: "ip" }];
}

export function interfacesFor(router: RouterId, state: SrMplsState): DeviceInterfaceData[] {
  const ownedAdj = state.adjSids.filter((a) => a.owner === router);
  return neighborLinks(router).map(({ neighbor, link }) => {
    const adj = ownedAdj.find((a) => a.neighbor === neighbor);
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
      extra: [{ label: "IGP Metric", value: String(link.metric) }, ...(adj ? [{ label: "Local Adj-SID", value: String(adj.label) }] : [])],
    };
  });
}

export function linkDetailFor(linkId: string, state: SrMplsState): LinkDetail | undefined {
  const link = LINKS.find((l) => l.id === linkId);
  const edge = GRAPH_EDGES.find((e) => e.id === linkId);
  if (!link || !edge) return undefined;
  const onPath = linkIdsFor(state.journey.map((h) => h.router)).includes(link.id as LinkId);
  return {
    aLabel: link.a,
    bLabel: link.b,
    aInterface: { id: `${link.a}-${link.b}`, name: `to-${link.b}`, status: "up", neighborId: link.b, neighborLabel: link.b, linkType: "Core", mtu: 1500, protocols: ["IGP", "SR-MPLS"], role: "idle" },
    bInterface: { id: `${link.b}-${link.a}`, name: `to-${link.a}`, status: "up", neighborId: link.a, neighborLabel: link.a, linkType: "Core", mtu: 1500, protocols: ["IGP", "SR-MPLS"], role: "idle" },
    status: "up",
    mtu: 1500,
    protocols: [
      { label: "IGP Metric", value: String(link.metric) },
      { label: "Adj-SID (a→b)", value: String(state.adjSids.find((a) => a.owner === link.a && a.neighbor === link.b)?.label ?? "—") },
      { label: "Adj-SID (b→a)", value: String(state.adjSids.find((a) => a.owner === link.b && a.neighbor === link.a)?.label ?? "—") },
    ],
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

export function forwardingEntryFor(router: RouterId, state: SrMplsState) {
  const hops = state.journey.filter((h) => h.router === router);
  return hops[hops.length - 1];
}

export { fmtLabel };
