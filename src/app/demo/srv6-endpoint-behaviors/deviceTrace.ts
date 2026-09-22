import type { DeviceInterfaceData, DeviceProcessingTrace, LinkDetail, PacketMutation, PacketStackFrame, ProcessingStage } from "@/components/network3d/types";
import type { PacketVisual } from "@/lib/sim-engine/types";
import {
  CE_IDS,
  GRAPH_EDGES,
  LINKS,
  buildNamedIpv6Fib,
  fmtIpv6,
  linkIdBetween,
  type CeId,
  type JourneyHop,
  type LinkDef,
  type NodeId,
  type RouterId,
  type Srv6EndpointAction,
  type Srv6EndpointState,
} from "@/lib/sim-engine/scenarios/srv6EndpointBehaviors";

/**
 * Scene Adapter for SRv6 Endpoint Behaviors' device-interior 3D view.
 * Every stage list and interface/link value below is derived FROM
 * Srv6EndpointState — this file makes no behavior-dispatch decision of
 * its own (that lives entirely in the scenario's
 * processSrv6EndpointBehavior()). The Level-3 fields added below
 * (ARCHITECTURE.md §18) are purely a RESHAPE of the JourneyHop text the
 * scenario file already authored — never a new forwarding fact.
 */

const HEADEND_PIPELINE: ProcessingStage[] = [
  { id: "classify", label: "Classify Traffic" },
  { id: "encaps", label: "Impose Outer IPv6 (+ Inner Payload If Any)" },
  { id: "fib", label: "IPv6 FIB Lookup" },
  { id: "forward", label: "Forward" },
];
const TRANSIT_PIPELINE: ProcessingStage[] = [
  { id: "receive", label: "Receive IPv6 Packet" },
  { id: "local-sid-check", label: "Local SID Table Lookup" },
  { id: "no-match", label: "No Local Match" },
  { id: "fib", label: "IPv6 FIB Lookup" },
  { id: "forward", label: "Forward" },
];
const LOCAL_SID_MATCH_PIPELINE: ProcessingStage[] = [
  { id: "receive", label: "Receive IPv6 Packet" },
  { id: "local-sid-check", label: "Local SID Table Lookup" },
  { id: "match", label: "Local SID Match — Which Behavior?" },
];
const ADJACENCY_PIPELINE: ProcessingStage[] = [
  { id: "bound-adjacency", label: "Use Bound Adjacency (Bypasses Ordinary FIB)" },
  { id: "transmit", label: "Transmit" },
];
const TABLE_LOOKUP_PIPELINE: ProcessingStage[] = [
  { id: "bound-table", label: "Lookup New DA In Bound Table" },
  { id: "transmit", label: "Transmit" },
];
const DECAP_IPV6_PIPELINE: ProcessingStage[] = [
  { id: "final-check", label: "Final-Segment Check" },
  { id: "payload-check", label: "Payload-Type Check (IPv6)" },
  { id: "decap", label: "Remove Outer IPv6 + Extension Headers" },
  { id: "deliver", label: "Deliver To Resolved Target" },
];
const DECAP_IPV4_PIPELINE: ProcessingStage[] = [
  { id: "final-check", label: "Final-Segment Check" },
  { id: "payload-check", label: "Payload-Type Check (IPv4)" },
  { id: "decap", label: "Remove Outer IPv6 + Extension Headers" },
  { id: "deliver", label: "Deliver To Resolved Target" },
];
const DECAP_ETHERNET_PIPELINE: ProcessingStage[] = [
  { id: "final-check", label: "Final-Segment Check" },
  { id: "payload-check", label: "Payload-Type Check (Ethernet)" },
  { id: "decap", label: "Remove Outer IPv6 + Extension Headers" },
  { id: "oif", label: "Forward Via Associated OIF" },
];
const FINAL_END_PIPELINE: ProcessingStage[] = [
  { id: "receive", label: "Receive IPv6 Packet" },
  { id: "local-sid-check", label: "Local SID Table Lookup" },
  { id: "match", label: "Local SID Match — Behavior: End" },
  { id: "final-segment", label: "Segments Left = 0 — Final Segment" },
  { id: "deliver", label: "Next Header / Deliver" },
];
const INVALID_FINAL_PIPELINE: ProcessingStage[] = [
  { id: "receive", label: "Receive IPv6 Packet" },
  { id: "local-sid-check", label: "Local SID Table Lookup" },
  { id: "match", label: "Local SID Match" },
  { id: "final-check", label: "Final-Segment Check: FAILED (SL≠0)" },
  { id: "drop", label: "Drop — Not Executed" },
];
const PAYLOAD_MISMATCH_PIPELINE: ProcessingStage[] = [
  { id: "final-check", label: "Final-Segment Check" },
  { id: "payload-check", label: "Payload-Type Check: FAILED" },
  { id: "drop", label: "Drop — Not Executed" },
];
const DROP_MISSING_SID_PIPELINE: ProcessingStage[] = [
  { id: "receive", label: "Receive IPv6 Packet" },
  { id: "local-sid-check", label: "Local SID Table Lookup" },
  { id: "no-entry", label: "NO ENTRY FOR ACTIVE SID" },
  { id: "drop", label: "Drop" },
];

const STAGES_FOR: Record<Srv6EndpointAction, ProcessingStage[]> = {
  HEADEND_ENCAPS: HEADEND_PIPELINE,
  IPV6_FIB_FORWARD: TRANSIT_PIPELINE,
  LOCAL_SID_MATCH: LOCAL_SID_MATCH_PIPELINE,
  ADJACENCY_CROSS_CONNECT: ADJACENCY_PIPELINE,
  TABLE_LOOKUP: TABLE_LOOKUP_PIPELINE,
  DECAP_IPV6: DECAP_IPV6_PIPELINE,
  DECAP_IPV4: DECAP_IPV4_PIPELINE,
  DECAP_ETHERNET: DECAP_ETHERNET_PIPELINE,
  L2_CROSS_CONNECT: DECAP_ETHERNET_PIPELINE,
  FINAL_END: FINAL_END_PIPELINE,
  DELIVER: FINAL_END_PIPELINE,
  DROP_MISSING_LOCAL_SID: DROP_MISSING_SID_PIPELINE,
  INVALID_FINAL_SEGMENT: INVALID_FINAL_PIPELINE,
  PAYLOAD_TYPE_MISMATCH: PAYLOAD_MISMATCH_PIPELINE,
};

const allIds = (s: ProcessingStage[]) => s.map((x) => x.id);

function neighborLinks(router: RouterId): { neighbor: RouterId; link: LinkDef }[] {
  return LINKS.filter((l) => l.a === router || l.b === router).map((l) => ({ neighbor: l.a === router ? l.b : l.a, link: l }));
}
function ceNeighborsOf(router: RouterId): CeId[] {
  return router === "R6" ? CE_IDS : [];
}

// ---------------------------------------------------------------------------
// Hop Inspector enrichment (ARCHITECTURE.md §17/§18) — additive
// DeviceProcessingTrace fields, reshaped entirely from the JourneyHop
// the scenario file already recorded (`hop.input`/`lookup`/`action`/
// `output`). This file decides no new forwarding fact of its own.
// ---------------------------------------------------------------------------

const LOOKUP_TYPE_BY_ACTION: Record<Srv6EndpointAction, string> = {
  HEADEND_ENCAPS: "Headend Classification + Encapsulation",
  IPV6_FIB_FORWARD: "IPv6 FIB",
  LOCAL_SID_MATCH: "Local SID Table",
  ADJACENCY_CROSS_CONNECT: "Local SID Table (End.X — Bound Adjacency)",
  TABLE_LOOKUP: "Local SID Table (End.T — Bound IPv6 Table)",
  DECAP_IPV6: "Local SID Table (Service Behavior)",
  DECAP_IPV4: "Local SID Table (Service Behavior)",
  DECAP_ETHERNET: "Local SID Table (Service Behavior)",
  L2_CROSS_CONNECT: "Local SID Table (End.DX2 — Bound OIF)",
  FINAL_END: "Local SID Table (End)",
  DELIVER: "Local SID Table (End)",
  DROP_MISSING_LOCAL_SID: "Local SID Table",
  INVALID_FINAL_SEGMENT: "Local SID Table (Final-Segment Validation)",
  PAYLOAD_TYPE_MISMATCH: "Local SID Table (Payload-Type Validation)",
};

/** A hop's DA/SRH text always has the shape "<DA>, SL=<n>" or a bare "<DA>" — never any other JourneyHop text shape. */
function splitDaAndSl(text: string): { da: string; sl?: string } {
  const idx = text.indexOf(", SL=");
  if (idx === -1) return { da: text };
  return { da: text.slice(0, idx), sl: text.slice(idx + ", SL=".length) };
}

/** Matches the scenario's own "<Behavior> executes → [DA ]<hex>, SL=<n>[ — ...]" output phrasing — never re-derives the mutation from raw hextets. */
function parseExecutedDaSl(output: string): { da: string; sl: string } | undefined {
  const m = /→\s*(?:DA\s+)?([0-9a-fA-F:]+),\s*SL=(\d+)/.exec(output);
  if (!m) return undefined;
  return { da: m[1], sl: m[2] };
}

/** The scenario always phrases a delivery-to-CE hop as "... Delivered to <CeId>" (with an optional trailing "— WRONG, should be ..." clause) — the target's own id, never invented by this file. */
function parseDeliveredTarget(output: string): string | undefined {
  const m = /Delivered to (\S+)/.exec(output);
  return m ? m[1].replace(/[.,]$/, "") : undefined;
}

function mutationsForHop(hop: JourneyHop): PacketMutation[] {
  if (hop.action === "HEADEND_ENCAPS") {
    return [{ type: "ENCAPSULATE", detail: `Outer IPv6 imposed, DA = ${fmtIpv6ish(hop.output)}` }];
  }
  if (hop.action === "LOCAL_SID_MATCH") {
    const before = splitDaAndSl(hop.input);
    const executed = parseExecutedDaSl(hop.output);
    if (before.sl !== undefined && executed) {
      return [
        { type: "SEGMENTS_LEFT_CHANGE", detail: `${before.sl} → ${executed.sl}` },
        { type: "DA_CHANGE", detail: `${before.da} → ${executed.da}` },
      ];
    }
    return [];
  }
  if (hop.action === "DECAP_IPV6" || hop.action === "DECAP_IPV4" || hop.action === "DECAP_ETHERNET" || hop.action === "L2_CROSS_CONNECT") {
    return [{ type: "DECAPSULATE", detail: "Outer IPv6 header (+ SRH, if present) removed — inner payload exposed" }];
  }
  return [];
}

function fmtIpv6ish(text: string): string {
  return splitDaAndSl(text).da;
}

/** Reshapes one hop.input/output string into packet-stack frames — never a new fact, only a display split of text the scenario already produced (a DA/SL pair, a bare IPv6/IPv4/MAC address, or terminal prose like "Delivered to CE6"/a drop reason). */
function frameGroupFor(prefix: string, text: string, markChanged: boolean): PacketStackFrame[] {
  const { da, sl } = splitDaAndSl(text);
  if (sl !== undefined) {
    return [
      { id: `${prefix}-da`, text: `IPv6 DA = ${da}`, tone: "ip", justChanged: markChanged },
      { id: `${prefix}-srh`, text: `SRH Segments Left = ${sl}`, tone: "transport", justChanged: markChanged },
    ];
  }
  if (da.includes(":") && !da.includes(" ")) return [{ id: `${prefix}-da`, text: `Address = ${da}`, tone: "ip", justChanged: markChanged }];
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(da)) return [{ id: `${prefix}-da`, text: `IPv4 Address = ${da}`, tone: "ip", justChanged: markChanged }];
  if (/^\S+\s*→\s*\S+$/.test(da)) return [{ id: `${prefix}-mac`, text: `Ethernet ${da}`, tone: "generic", justChanged: markChanged }];
  return [{ id: `${prefix}-status`, text: da, tone: "generic", justChanged: markChanged }];
}

const NO_NEXT_HOP_ACTIONS = new Set<Srv6EndpointAction>(["DELIVER", "INVALID_FINAL_SEGMENT", "PAYLOAD_TYPE_MISMATCH", "DROP_MISSING_LOCAL_SID"]);

/**
 * LOCAL_SID_MATCH records the behavior decision (and, for End.X/End.T,
 * names its bound adjacency/table in `reason`/`lookupResult` already)
 * but not yet a transmission — the actual egress interface is only
 * real once a SEPARATE forwarding hop (ADJACENCY_CROSS_CONNECT/
 * TABLE_LOOKUP/IPV6_FIB_FORWARD) executes. Falling back to a static
 * neighbor here would silently show End.X's forced adjacency as the
 * router's *ordinary* next hop the moment they happen to coincide —
 * exactly the misconception this lesson exists to correct.
 */
const NO_EGRESS_YET_ACTIONS = new Set<Srv6EndpointAction>(["LOCAL_SID_MATCH", "DECAP_IPV6", "DECAP_IPV4", "DECAP_ETHERNET", "L2_CROSS_CONNECT", "DELIVER", "INVALID_FINAL_SEGMENT", "PAYLOAD_TYPE_MISMATCH", "DROP_MISSING_LOCAL_SID"]);

function nextHopFor(hop: JourneyHop, state: Srv6EndpointState): { id?: string; label?: string } {
  if (NO_NEXT_HOP_ACTIONS.has(hop.action)) return {};
  const delivered = parseDeliveredTarget(hop.output);
  if (delivered) return { id: delivered, label: delivered };
  const idx = state.journey.indexOf(hop);
  const isLast = idx === state.journey.length - 1;
  const nextRouter = !isLast ? state.journey[idx + 1]?.router : state.packetAt;
  if (!nextRouter || nextRouter === hop.router) return {};
  return { id: String(nextRouter), label: String(nextRouter) };
}

/**
 * The real previous DIFFERENT-device hop — scans backward past any
 * consecutive same-router journey entries (e.g. a service behavior's
 * LOCAL_SID_MATCH → DECAP_IPV4 are two separate journey entries
 * recorded against the same router for the same internal processing
 * instant). A naive "immediately previous entry" lookup would
 * self-reference as "R6-R6" the moment a router logs more than one
 * hop in a row for its own local processing.
 */
function prevRouterFor(hop: JourneyHop, state: Srv6EndpointState): RouterId | undefined {
  const idx = state.journey.indexOf(hop);
  for (let i = idx - 1; i >= 0; i--) {
    if (state.journey[i].router !== hop.router) return state.journey[i].router as RouterId;
  }
  return undefined;
}

/** The next DIFFERENT-router hop — the egress-interface counterpart of `prevRouterFor` above. Deliberately separate from `nextHopFor` (used for the "NEXT HOP" field, which may legitimately target a CE, not just a router). */
function nextDifferentRouterFor(hop: JourneyHop, state: Srv6EndpointState): RouterId | undefined {
  const idx = state.journey.indexOf(hop);
  for (let i = idx + 1; i < state.journey.length; i++) {
    if (state.journey[i].router !== hop.router) return state.journey[i].router as RouterId;
  }
  const isLast = idx === state.journey.length - 1;
  return isLast && state.packetAt && state.packetAt !== hop.router ? (state.packetAt as RouterId) : undefined;
}

/**
 * Picks the ACTUAL ingress/egress interface for a hop, directionally —
 * from the real previous/next DIFFERENT-router hop in `state.journey`
 * (falling back to the static "first two neighbors found" ids when no
 * hop has happened yet, or when the derived previous/next router isn't
 * actually a direct physical neighbor of `router`). The anti-fake-data
 * rule (ARCHITECTURE.md §18) means an unverifiable direction must fall
 * back to the generic display default, never invent a link — this is
 * the same "Known correctness fix" applied in srv6-foundations and
 * other Level-3 lessons (ARCHITECTURE.md §17), which this lesson
 * previously did not apply (it used `nbrs[0]`/`nbrs[1]` unconditionally).
 */
function directionalInterfaces(router: RouterId, hop: JourneyHop | undefined, fallbackIngress: string | undefined, fallbackEgress: string | undefined, state: Srv6EndpointState): { ingressInterfaceId?: string; egressInterfaceId?: string } {
  if (!hop) return { ingressInterfaceId: fallbackIngress, egressInterfaceId: fallbackEgress };
  const prevRouter = prevRouterFor(hop, state);
  const nextRouter = nextDifferentRouterFor(hop, state);
  const realPrev = prevRouter && linkIdBetween(router, prevRouter) ? prevRouter : undefined;
  const realNext = nextRouter && linkIdBetween(router, nextRouter) ? nextRouter : undefined;
  return {
    ingressInterfaceId: realPrev ? `${router}-${realPrev}` : fallbackIngress,
    egressInterfaceId: realNext ? `${router}-${realNext}` : fallbackEgress,
  };
}

/**
 * Historical (timeline) inspection needs a "which device is this step
 * about" subject even for the two steps that mutate state but carry no
 * packet of their own (the fault injection / repair steps — both are
 * R6-local Local SID Table rebindings). `troubleshooting-intro` resets
 * the lesson's packet/journey and is deliberately left out — it has no
 * single honest device subject.
 */
export const PRIMARY_TRANSITION_ROUTER: Partial<Record<string, RouterId>> = {
  "fault-inject": "R6",
  "repair-applied": "R6",
};

export function deviceForStep(stepId: string, packet: PacketVisual | undefined): RouterId | undefined {
  if (packet) return (packet.from ?? packet.to) as RouterId;
  return PRIMARY_TRANSITION_ROUTER[stepId];
}

function hopInspectionFields(hop: JourneyHop, state: Srv6EndpointState): Partial<DeviceProcessingTrace> {
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

export function traceFor(router: RouterId, state: Srv6EndpointState): DeviceProcessingTrace | undefined {
  const nbrs = neighborLinks(router);
  const staticIngress = nbrs[0] ? `${router}-${nbrs[0].neighbor}` : undefined;
  const staticEgress = nbrs[1] ? `${router}-${nbrs[1].neighbor}` : undefined;
  const hops = state.journey.filter((h) => h.router === router);
  const hop = hops[hops.length - 1];
  const isCurrent = state.journey.length > 0 && state.journey[state.journey.length - 1].router === router;

  if (!hop) {
    const stages = router === "R1" ? HEADEND_PIPELINE : TRANSIT_PIPELINE;
    const dir = directionalInterfaces(router, undefined, router === "R1" ? undefined : staticIngress, staticEgress, state);
    return { deviceId: router, ingressInterfaceId: dir.ingressInterfaceId, egressInterfaceId: dir.egressInterfaceId, stages, completedStageIds: [] };
  }

  const stages = STAGES_FOR[hop.action];
  const activeStageId = isCurrent ? stages[stages.length - 1]?.id : undefined;
  const completedStageIds = isCurrent ? stages.slice(0, -1).map((s) => s.id) : allIds(stages);
  const hopFields = hopInspectionFields(hop, state);

  const wantsEgress = !NO_EGRESS_YET_ACTIONS.has(hop.action);
  // R1 is the headend — it has no real ingress interface in this topology (the packet originates there), so a static "first neighbor" fallback would fabricate one.
  const dir = directionalInterfaces(router, hop, router === "R1" ? undefined : staticIngress, wantsEgress ? staticEgress : undefined, state);

  return {
    deviceId: router,
    ingressInterfaceId: dir.ingressInterfaceId,
    egressInterfaceId: dir.egressInterfaceId,
    stages,
    activeStageId,
    completedStageIds,
    packetBefore: hop.input,
    packetAfter: hop.output,
    ...hopFields,
  };
}

export function packetFramesFor(state: Srv6EndpointState): PacketStackFrame[] | undefined {
  if (!state.packet) return undefined;
  const outerFrame: PacketStackFrame = { id: "outer-ipv6", text: `Outer IPv6 (DA=${fmtIpv6(state.packet.outer.daHextets)})`, tone: "ip", justChanged: true };
  const frames: PacketStackFrame[] = [outerFrame];
  if (state.packet.outer.srh) frames.push({ id: "srh", text: `SRH (SL=${state.packet.outer.srh.segmentsLeft}, LE=${state.packet.outer.srh.lastEntry})`, tone: "transport" });
  const inner = state.packet.inner;
  if (!inner) {
    frames.push({ id: "payload", text: "Payload", tone: "generic" });
  } else if (inner.kind === "IPV6") {
    frames.push({ id: "inner", text: `Inner IPv6 (dst=${fmtIpv6(inner.dstHextets)})`, tone: "ip" });
  } else if (inner.kind === "IPV4") {
    frames.push({ id: "inner", text: `Inner IPv4 (dst=${inner.dstIp})`, tone: "ip" });
  } else {
    frames.push({ id: "inner", text: `Inner Ethernet (${inner.srcMac} → ${inner.dstMac})`, tone: "generic" });
  }
  return frames;
}

export function interfacesFor(router: RouterId, state: Srv6EndpointState): DeviceInterfaceData[] {
  const entries = state.localSidTable[router] ?? [];
  const sidBadges = entries.length ? [{ label: "Local SIDs Owned", value: String(entries.length) }] : [];
  const coreIfaces: DeviceInterfaceData[] = neighborLinks(router).map(({ neighbor, link }) => ({
    id: `${router}-${neighbor}`,
    name: `to-${neighbor}`,
    status: "up",
    neighborId: neighbor,
    neighborLabel: neighbor,
    linkType: "Core",
    mtu: 1500,
    protocols: ["IGP", "SRv6"],
    role: "idle",
    extra: [{ label: "IGP Metric", value: String(link.metric) }, ...sidBadges],
  }));
  const ceIfaces: DeviceInterfaceData[] = ceNeighborsOf(router).map((ce) => ({
    id: `${router}-${ce}`,
    name: `to-${ce}`,
    status: "up",
    neighborId: ce,
    neighborLabel: ce,
    linkType: "Access",
    mtu: 1500,
    protocols: ["Customer"],
    role: "idle",
    extra: [{ label: "Attachment", value: ce }],
  }));
  return [...coreIfaces, ...ceIfaces];
}

export function linkDetailFor(linkId: string, state: Srv6EndpointState): LinkDetail | undefined {
  const edge = GRAPH_EDGES.find((e) => e.id === linkId);
  if (!edge) return undefined;
  const coreLink = LINKS.find((l) => l.id === linkId);
  const onPath = linkIdsFor(state.journey.map((h) => h.router)).includes(linkId);
  return {
    aLabel: edge.a,
    bLabel: edge.b,
    aInterface: { id: `${edge.a}-${edge.b}`, name: `to-${edge.b}`, status: "up", neighborId: edge.b, neighborLabel: edge.b, linkType: coreLink ? "Core" : "Access", mtu: 1500, protocols: coreLink ? ["IGP", "SRv6"] : ["Customer"], role: "idle" },
    bInterface: { id: `${edge.b}-${edge.a}`, name: `to-${edge.a}`, status: "up", neighborId: edge.a, neighborLabel: edge.a, linkType: coreLink ? "Core" : "Access", mtu: 1500, protocols: coreLink ? ["IGP", "SRv6"] : ["Customer"], role: "idle" },
    status: "up",
    mtu: 1500,
    protocols: coreLink ? [{ label: "IGP Metric", value: String(coreLink.metric) }] : [{ label: "Type", value: "Customer Attachment" }],
    currentTraffic: onPath ? "Carrying current packet's journey" : undefined,
  };
}

function linkIdsFor(path: NodeId[]): string[] {
  const ids: string[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const e = GRAPH_EDGES.find((x) => (x.a === path[i] && x.b === path[i + 1]) || (x.b === path[i] && x.a === path[i + 1]));
    if (e) ids.push(e.id);
  }
  return ids;
}

export function forwardingEntryFor(router: RouterId, state: Srv6EndpointState) {
  const hops = state.journey.filter((h) => h.router === router);
  return hops[hops.length - 1];
}

export function ipv6FibFor(router: RouterId, state: Srv6EndpointState, table: "MAIN" | "CORE-B" = "MAIN") {
  return buildNamedIpv6Fib(router, state.links, state.locators, table);
}
