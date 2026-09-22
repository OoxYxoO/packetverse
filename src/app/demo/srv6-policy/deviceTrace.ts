import type { DeviceInterfaceData, DeviceProcessingTrace, LinkDetail, PacketMutation, PacketStackFrame, ProcessingStage } from "@/components/network3d/types";
import type { PacketVisual } from "@/lib/sim-engine/types";
import { GRAPH_EDGES, LINKS, linkIdBetween, type ClientId, type JourneyHop, type LinkDef, type NodeId, type RouterId, type Srv6PolicyAction, type Srv6PolicyState } from "@/lib/sim-engine/scenarios/srv6Policy";

/**
 * Scene Adapter for SRv6 Policy's device-interior 3D view. Every stage
 * list and interface/link value below is derived FROM Srv6PolicyState
 * — this file makes no policy-selection or behavior-dispatch decision
 * of its own (that lives entirely in the scenario's own pure functions
 * and in the reused srv6EndpointBehaviors.ts execution). The Level-3
 * fields added below (ARCHITECTURE.md §18) are purely a RESHAPE of the
 * JourneyHop text the scenario file already authored — never a new
 * forwarding fact.
 */

const HEADEND_PIPELINE: ProcessingStage[] = [
  { id: "steering", label: "Steering Match (Color → Policy)" },
  { id: "select", label: "Evaluate Candidates → Select Active" },
  { id: "encaps", label: "H.Encaps (Outer IPv6 + SRH)" },
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
  { id: "match", label: "Local SID Match — Execute Behavior" },
];
const ADJACENCY_PIPELINE: ProcessingStage[] = [
  { id: "bound-adjacency", label: "Use Bound Adjacency (Bypasses Ordinary FIB)" },
  { id: "transmit", label: "Transmit" },
];
const DECAP_PIPELINE: ProcessingStage[] = [
  { id: "final-check", label: "Final-Segment Check" },
  { id: "decap", label: "Remove Outer IPv6 + SRH" },
  { id: "deliver", label: "Deliver To Resolved Target" },
];
const FALLBACK_PIPELINE: ProcessingStage[] = [
  { id: "steering", label: "Steering Match (Color → Policy)" },
  { id: "invalid", label: "Policy Invalid — No Valid Candidate" },
  { id: "action", label: "Apply Invalidation Action" },
];

const STAGES_FOR: Record<Srv6PolicyAction, ProcessingStage[]> = {
  HEADEND_ENCAPS: HEADEND_PIPELINE,
  STEERING_MATCH: HEADEND_PIPELINE,
  POLICY_SELECT: HEADEND_PIPELINE,
  IPV6_FIB_FORWARD: TRANSIT_PIPELINE,
  LOCAL_SID_MATCH: LOCAL_SID_MATCH_PIPELINE,
  ADJACENCY_CROSS_CONNECT: ADJACENCY_PIPELINE,
  DECAP_IPV6: DECAP_PIPELINE,
  DELIVER: DECAP_PIPELINE,
  POLICY_UNAVAILABLE_DROP: FALLBACK_PIPELINE,
  POLICY_UNAVAILABLE_FALLBACK: FALLBACK_PIPELINE,
};

const allIds = (s: ProcessingStage[]) => s.map((x) => x.id);

function neighborLinks(router: RouterId): { neighbor: RouterId; link: LinkDef }[] {
  return LINKS.filter((l) => l.a === router || l.b === router).map((l) => ({ neighbor: l.a === router ? l.b : l.a, link: l }));
}
function edgeNeighborsOf(node: NodeId): NodeId[] {
  return GRAPH_EDGES.filter((e) => e.a === node || e.b === node).map((e) => (e.a === node ? e.b : e.a));
}

// ---------------------------------------------------------------------------
// Hop Inspector enrichment (ARCHITECTURE.md §17/§18) — additive
// DeviceProcessingTrace fields, reshaped entirely from the JourneyHop
// the scenario file already recorded (`hop.input`/`lookup`/`action`/
// `output`). This file decides no new forwarding fact of its own.
// ---------------------------------------------------------------------------

const LOOKUP_TYPE_BY_ACTION: Record<Srv6PolicyAction, string> = {
  HEADEND_ENCAPS: "H.Encaps (Outer IPv6 + SRH Construction)",
  STEERING_MATCH: "Local Traffic Classifier (Color)",
  POLICY_SELECT: "Candidate Path Evaluation",
  IPV6_FIB_FORWARD: "IPv6 FIB",
  LOCAL_SID_MATCH: "Local SID Table",
  ADJACENCY_CROSS_CONNECT: "Local SID Table (End.X — Bound Adjacency)",
  DECAP_IPV6: "Local SID Table (End.DX6 — Decapsulate)",
  DELIVER: "Local SID Table (End.DX6 — Decapsulate)",
  POLICY_UNAVAILABLE_DROP: "Policy Steering (Drop-Upon-Invalid)",
  POLICY_UNAVAILABLE_FALLBACK: "Policy Steering (DEFAULT Fallback)",
};

/** A hop's DA/SRH text always has the shape "<DA>, SL=<n>" or a bare "<DA>" — never any other JourneyHop text shape. */
function splitDaAndSl(text: string): { da: string; sl?: string } {
  const idx = text.indexOf(", SL=");
  if (idx === -1) return { da: text };
  return { da: text.slice(0, idx), sl: text.slice(idx + ", SL=".length) };
}

/** Matches the scenario's own "DA → <hex>, SL=<n>[ — ...]" execution phrasing (End.X/End advancing a segment) — never re-derives the mutation from raw hextets. */
function parseExecutedDaSl(output: string): { da: string; sl: string } | undefined {
  const m = /DA\s*→\s*([0-9a-fA-F:]+),\s*SL=(\d+)/.exec(output);
  if (!m) return undefined;
  return { da: m[1], sl: m[2] };
}

/** The scenario always phrases a delivery hop as "Delivered to <target>" (with an optional trailing "— ..." clause) — the target's own id, never invented by this file. */
function parseDeliveredTarget(output: string): string | undefined {
  const m = /Delivered to (\S+)/.exec(output);
  return m ? m[1].replace(/[.,]$/, "") : undefined;
}

function mutationsForHop(hop: JourneyHop): PacketMutation[] {
  if (hop.action === "HEADEND_ENCAPS") {
    return [{ type: "ENCAPSULATE", detail: `Outer IPv6 + SRH imposed, DA (active segment) = ${splitDaAndSl(hop.output).da}` }];
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
  if (hop.action === "DECAP_IPV6" || hop.action === "DELIVER") {
    return [{ type: "DECAPSULATE", detail: "Outer IPv6 header + SRH removed — inner probe exposed" }];
  }
  return [];
}

/** Reshapes one hop.input/output string into packet-stack frames — never a new fact, only a display split of text the scenario already produced (a DA/SL pair, a bare IPv6 address, or terminal prose like "Delivered to RECEIVER6"/a fallback detail sentence). */
function frameGroupFor(prefix: string, text: string, markChanged: boolean): PacketStackFrame[] {
  const { da, sl } = splitDaAndSl(text);
  if (sl !== undefined) {
    return [
      { id: `${prefix}-da`, text: `IPv6 DA = ${da}`, tone: "ip", justChanged: markChanged },
      { id: `${prefix}-srh`, text: `SRH Segments Left = ${sl}`, tone: "transport", justChanged: markChanged },
    ];
  }
  if (da.includes(":") && !da.includes(" ")) return [{ id: `${prefix}-da`, text: `Address = ${da}`, tone: "ip", justChanged: markChanged }];
  return [{ id: `${prefix}-status`, text: da, tone: "generic", justChanged: markChanged }];
}

/**
 * A LOCAL_SID_MATCH hop records the behavior decision (End.X's bound
 * adjacency is already named in `reason`) but not yet a transmission —
 * the actual egress interface only becomes real once a SEPARATE
 * forwarding hop (ADJACENCY_CROSS_CONNECT / IPV6_FIB_FORWARD) executes
 * next. Likewise HEADEND_ENCAPS/STEERING_MATCH/POLICY_SELECT are R1's
 * own control-plane decision hops, each followed by its own separate
 * IPV6_FIB_FORWARD hop that actually leaves an interface. Falling back
 * to a static neighbor here would silently show a not-yet-real egress
 * the moment it happens to coincide with the eventual one — exactly
 * the misconception this lesson exists to correct.
 */
const NO_EGRESS_YET_ACTIONS = new Set<Srv6PolicyAction>(["STEERING_MATCH", "POLICY_SELECT", "HEADEND_ENCAPS", "LOCAL_SID_MATCH", "DECAP_IPV6", "DELIVER", "POLICY_UNAVAILABLE_DROP", "POLICY_UNAVAILABLE_FALLBACK"]);

/** Terminal actions with no real next hop to report — a decap/deliver ends the journey, and a policy-unavailable action's fallback/drop path is never itself animated (anti-fake-data rule: no invented post-fallback IGP hop). */
const NO_NEXT_HOP_ACTIONS = new Set<Srv6PolicyAction>(["DECAP_IPV6", "DELIVER", "POLICY_UNAVAILABLE_DROP", "POLICY_UNAVAILABLE_FALLBACK"]);

function nextHopFor(hop: JourneyHop, state: Srv6PolicyState): { id?: string; label?: string } {
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
 * consecutive same-router journey entries (e.g. R3's own
 * LOCAL_SID_MATCH → LOCAL_SID_MATCH-execute → ADJACENCY_CROSS_CONNECT
 * are three separate journey entries recorded against the same router
 * for the same End.X processing instant). A naive "immediately
 * previous entry" lookup would self-reference as "R3-R3" the moment a
 * router logs more than one hop in a row for its own local processing.
 */
function prevRouterFor(hop: JourneyHop, state: Srv6PolicyState): RouterId | undefined {
  const idx = state.journey.indexOf(hop);
  for (let i = idx - 1; i >= 0; i--) {
    if (state.journey[i].router !== hop.router) return state.journey[i].router as RouterId;
  }
  return undefined;
}

/** The next DIFFERENT-router hop — the egress-interface counterpart of `prevRouterFor` above. Deliberately separate from `nextHopFor` (used for the "NEXT HOP" field, which may legitimately target RECEIVER6, not just a router). */
function nextDifferentRouterFor(hop: JourneyHop, state: Srv6PolicyState): RouterId | undefined {
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
 * (falling back to the static "first two neighbors found" ids only
 * when no hop has happened yet, or when the derived previous/next
 * router isn't actually a direct physical neighbor of `router`). The
 * anti-fake-data rule (ARCHITECTURE.md §18) means an unverifiable
 * direction must fall back to the generic display default, never
 * invent a link — this is the "Known correctness fix" (ARCHITECTURE.md
 * §17): never `nbrs[0]`/`nbrs[1]` unconditionally.
 */
function directionalInterfaces(router: RouterId, hop: JourneyHop | undefined, fallbackIngress: string | undefined, fallbackEgress: string | undefined, state: Srv6PolicyState): { ingressInterfaceId?: string; egressInterfaceId?: string } {
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
 * about" subject even for steps that mutate state but carry no packet
 * of their own — the R1-owned SR Policy/SR Database/topology events.
 * Steps that only reset packet/journey to empty with no other
 * observable state fact (e.g. `send-low-latency`-style resends) are
 * deliberately left out — they have no single honest device subject
 * beyond the packet they immediately carry.
 */
export const PRIMARY_TRANSITION_ROUTER: Partial<Record<string, RouterId>> = {
  "fail-r3-r5": "R1",
  "restore-r3-r5-partial": "R1",
  "repair-challenge": "R1",
  "policy-invalid-setup": "R1",
  "restore-topology-final": "R1",
};

const ROUTER_ID_SET = new Set<string>(["R1", "R2", "R3", "R4", "R5", "R6"]);

/** Sender-priority (`packet.from ?? packet.to`), matching this lesson's `traceFor` reading a growing `state.journey: JourneyHop[]` keyed by the router that PERFORMED each action (ARCHITECTURE.md §18) — a receiver-priority default would show "no forwarding activity recorded" for hops recorded against the sender. Falls back to whichever endpoint is an actual router when the packet's `from`/`to` is CLIENT1/RECEIVER6. */
export function deviceForStep(stepId: string, packet: PacketVisual | undefined): RouterId | undefined {
  if (packet) {
    const from = String(packet.from);
    const to = String(packet.to);
    if (ROUTER_ID_SET.has(from)) return from as RouterId;
    if (ROUTER_ID_SET.has(to)) return to as RouterId;
    return undefined;
  }
  return PRIMARY_TRANSITION_ROUTER[stepId];
}

function hopInspectionFields(hop: JourneyHop, state: Srv6PolicyState): Partial<DeviceProcessingTrace> {
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

export function traceFor(router: RouterId, state: Srv6PolicyState): DeviceProcessingTrace | undefined {
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
  // R1 is the headend — it has no real ingress interface in this topology (the packet originates there from CLIENT1, modeled separately), so a static "first neighbor" fallback would fabricate one.
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

export function packetFramesFor(state: Srv6PolicyState): PacketStackFrame[] | undefined {
  if (!state.packet) return undefined;
  const outerFrame: PacketStackFrame = { id: "outer-ipv6", text: `Outer IPv6 (DA=${state.packet.outer.daHextets.map((h) => h.toString(16)).join(":")})`, tone: "ip", justChanged: true };
  const frames: PacketStackFrame[] = [outerFrame];
  if (state.packet.outer.srh) frames.push({ id: "srh", text: `SRH (SL=${state.packet.outer.srh.segmentsLeft}, LE=${state.packet.outer.srh.lastEntry})`, tone: "transport" });
  if (state.packet.inner && state.packet.inner.kind === "IPV6") frames.push({ id: "inner", text: "Inner IPv6 (original probe)", tone: "ip" });
  return frames;
}

export function interfacesFor(router: RouterId, state: Srv6PolicyState): DeviceInterfaceData[] {
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
    extra: [{ label: "IGP Metric", value: String(link.metric) }, { label: "Delay", value: String(link.delay) }, ...sidBadges],
  }));
  const edgeIfaces: DeviceInterfaceData[] = edgeNeighborsOf(router)
    .filter((n) => n === "CLIENT1" || n === "RECEIVER6")
    .map((n) => ({ id: `${router}-${n}`, name: `to-${n}`, status: "up", neighborId: n, neighborLabel: n as ClientId, linkType: "Access", mtu: 1500, protocols: ["Customer"], role: "idle", extra: [{ label: "Attachment", value: n }] }));
  return [...coreIfaces, ...edgeIfaces];
}

export function linkDetailFor(linkId: string, state: Srv6PolicyState): LinkDetail | undefined {
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
    protocols: coreLink ? [{ label: "IGP Metric", value: String(coreLink.metric) }, { label: "Delay", value: String(coreLink.delay) }] : [{ label: "Type", value: "Customer Attachment" }],
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

export function forwardingEntryFor(router: RouterId, state: Srv6PolicyState) {
  const hops = state.journey.filter((h) => h.router === router);
  return hops[hops.length - 1];
}
