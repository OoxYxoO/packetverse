import type { DeviceInterfaceData, DeviceProcessingTrace, LinkDetail, NodeExplanation, PacketStackFrame, ProcessingStage } from "@/components/network3d/types";
import type { PacketVisual } from "@/lib/sim-engine/types";
import {
  AS_NUMBER,
  CLUSTER_ID,
  PREFIX,
  ROUTER_IP,
  TWO_RR_DESIGN,
  connectedRrOf,
  evaluateReflection,
  isClientOf,
  isPeerOf,
  reflectionCandidatesFor,
  relationshipOf,
  type PeerRelationship,
  type ReflectionCandidate,
  type RouterId,
  type RrDesign,
  type RrState,
} from "@/lib/sim-engine/scenarios/bgpRouteReflector";

/** Interface id for `router`'s port facing `neighbor` — must match `interfacesFor`'s own `id` (Hop Inspector ingress/egress rows resolve interface names by this id). */
function ifaceId(router: RouterId, neighbor: RouterId): string {
  return `${router}-${neighbor}`;
}

/**
 * The "Scene Adapter" (brief §29) for the Route Reflector 3D view.
 * Every stage list, interface, link-detail, and reflection-candidate
 * value below is computed FROM RrState + RrDesign (the scenario
 * file's own data and its `evaluateReflection`/`reflectionCandidatesFor`
 * rule engine) — this file never decides client/non-client status or
 * a reflection outcome itself, it only re-describes what the scenario
 * file already decided, in the generic DeviceProcessingTrace/
 * DeviceInterfaceData/LinkDetail/NodeExplanation shapes the 3D layer
 * understands. Nothing in components/network3d/ imports this file.
 *
 * RR's mental model is deliberately NOT plain BGP's or OSPF's: there
 * is no per-message TCP/OPEN/KEEPALIVE walk here (session establishment
 * is the BGP-fundamentals lesson's job) — the distinctive moment is the
 * REFLECTION DECISION a route passes through only at an RR, never at
 * an ordinary iBGP speaker (brief §7).
 */

// ---------------------------------------------------------------------------
// Conceptual Route Reflection Pipeline (brief §7) — the RR's own 9-stage
// pipeline. An ordinary PE never makes a reflection decision, so it
// gets a much shorter, generic BGP-UPDATE pipeline instead — "not
// every packet activates every stage" (brief §7) is true both within
// the RR pipeline (only a client-sourced UPDATE reaches the last three
// stages) and between router roles (a PE never reaches them at all).
// ---------------------------------------------------------------------------

const RR_PIPELINE_STAGES: ProcessingStage[] = [
  { id: "ingress", label: "Ingress Interface" },
  { id: "session", label: "TCP / BGP Session" },
  { id: "update-processing", label: "UPDATE Processing" },
  { id: "bgp-table", label: "BGP Table / Best Path" },
  { id: "source-peer-type", label: "Source Peer Type" },
  { id: "reflection-rule", label: "Reflection Rule" },
  { id: "loop-prevention", label: "Loop-Prevention Attributes" },
  { id: "eligible-peers", label: "Eligible Outbound Peers" },
  { id: "reflect", label: "Reflect UPDATE" },
];

const PE_SEND_STAGES: ProcessingStage[] = [
  { id: "bgp-process", label: "BGP Process (Originate/Relay)" },
  { id: "build-update", label: "Build UPDATE" },
  { id: "egress", label: "Egress" },
];
const PE_RECEIVE_STAGES: ProcessingStage[] = [
  { id: "ingress", label: "Ingress Interface" },
  { id: "session", label: "TCP / BGP Session" },
  { id: "update-processing", label: "UPDATE Processing" },
  { id: "bgp-table", label: "BGP Table / Best Path" },
];

const IDLE_STAGES: ProcessingStage[] = [
  { id: "interface", label: "Interface" },
  { id: "session", label: "TCP / BGP Session" },
  { id: "bgp-table", label: "BGP Table" },
  { id: "reflection", label: "Reflection (RR only)" },
  { id: "forwarding", label: "Forwarding Result" },
];
function idleTrace(router: RouterId): DeviceProcessingTrace {
  return { deviceId: router, stages: IDLE_STAGES, completedStageIds: [] };
}

function isRr(router: RouterId): boolean {
  return router === "RR1" || router === "RR2";
}

// ---------------------------------------------------------------------------
// Which RR-reflection event(s) are "in flight" for a given step — an
// origin RR + the router it received the route from. Used both to
// drive the RR's own pipeline stage and to compute simultaneous
// FloodCopy3D targets (brief §6/§15) via the REAL reflection rules,
// exactly like OSPF's flood-wave adapter computes wave membership from
// the real adjacency graph rather than a hand-animated guess.
// ---------------------------------------------------------------------------

const REFLECTION_EVENTS_BY_STEP: Record<string, { rr: RouterId; sender: RouterId }[]> = {
  "rr-reflects": [{ rr: "RR1", sender: "PE1" }],
  "reflect-through-two-rr": [
    { rr: "RR1", sender: "PE1" },
    { rr: "RR2", sender: "RR1" },
  ],
  "repair-challenge": [{ rr: "RR2", sender: "RR1" }],
};

export interface FloodTarget {
  id: string;
  fromId: RouterId;
  toId: RouterId;
}

/** Every simultaneous reflected-copy edge for the current step, excluding whichever edge the single `activePacket` already animates (brief §15's "Route copies should be animated as BGP UPDATEs"). Derived entirely from `reflectionCandidatesFor` — never a hardcoded router list. */
export function floodTargetsForStep(stepId: string, design: RrDesign, activePacket: PacketVisual | undefined): FloodTarget[] {
  const events = REFLECTION_EVENTS_BY_STEP[stepId] ?? [];
  const seen = new Set<string>();
  const targets: FloodTarget[] = [];
  for (const { rr, sender } of events) {
    const candidates = reflectionCandidatesFor(design, rr, sender).filter((c) => c.decision === "reflect");
    for (const c of candidates) {
      if (activePacket && activePacket.from === rr && activePacket.to === c.routerId) continue;
      const key = `${rr}-${c.routerId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      targets.push({ id: `${key}-${stepId}`, fromId: rr, toId: c.routerId });
    }
  }
  return targets;
}

/** Which router is the RR actively deciding reflection for, at steps that carry no packet of their own (mirrors bgp-enterprise's PRIMARY_TRANSITION_ROUTER). */
export const PRIMARY_TRANSITION_ROUTER: Record<string, RouterId> = {
  "rr-receives": "RR1",
  "rr-bestpath": "RR1",
  "rr-reflection-decision": "RR1",
  "rr-reflects": "RR1",
  "reflect-through-two-rr": "RR2",
  "fault-intro": "RR2",
  "repair-challenge": "RR2",
  "verify-fix": "PE3",
};

/**
 * Per-router trace. Every branch just re-describes `state.pipelineStage`
 * (already set by bgpRouteReflector.ts's own `run()`/`action()`
 * functions) and `state.design`/`state.received` — this never decides
 * a client relationship or a reflection outcome itself.
 */
export function traceFor(router: RouterId, state: RrState, currentStepId: string, activePacket: PacketVisual | undefined): DeviceProcessingTrace {
  // --- RR pipeline-stage steps with no packet object of their own ---
  if (currentStepId === "rr-receives" && router === "RR1") {
    return {
      deviceId: router,
      stages: RR_PIPELINE_STAGES,
      activeStageId: "update-processing",
      completedStageIds: ["ingress", "session"],
      ingressInterfaceId: ifaceId("RR1", "PE1"),
      lookupType: "BGP Table Insert",
      lookupKey: state.route?.prefix ?? PREFIX,
      lookupResult: "Added — received from client PE1",
      reason: "New candidate route added to RR1's BGP table.",
      forwardingAction: "RR1 adds PE1's route to its BGP table.",
    };
  }
  if (currentStepId === "rr-bestpath" && router === "RR1") {
    return {
      deviceId: router,
      stages: RR_PIPELINE_STAGES,
      activeStageId: "bgp-table",
      completedStageIds: ["ingress", "session", "update-processing"],
      lookupType: "Best-Path Evaluation",
      lookupKey: state.route?.prefix ?? PREFIX,
      lookupResult: "Only one candidate — trivially best",
      reason: "No competing path exists yet, so best-path comparison has nothing to decide between.",
      forwardingAction: "Only one candidate — trivially best.",
    };
  }
  if (currentStepId === "rr-reflection-decision" && router === "RR1") {
    return {
      deviceId: router,
      stages: RR_PIPELINE_STAGES,
      activeStageId: "reflection-rule",
      completedStageIds: ["ingress", "session", "update-processing", "bgp-table", "source-peer-type"],
      lookupType: "Reflection Rule",
      lookupKey: "Source: client PE1",
      lookupResult: "Reflect to every other client (and any non-client peer)",
      reason: evaluateReflection("client", "client").reason,
      forwardingAction: "Route came from client PE1 → reflect to every other client (and any non-client peer).",
    };
  }
  if (currentStepId === "fault-intro" && router === "RR2") {
    const candidate = reflectionCandidatesFor(state.design, "RR2", "RR1").find((c) => c.routerId === "PE3");
    return {
      deviceId: router,
      stages: RR_PIPELINE_STAGES,
      activeStageId: "eligible-peers",
      completedStageIds: ["ingress", "session", "update-processing", "bgp-table", "source-peer-type", "reflection-rule", "loop-prevention"],
      ingressInterfaceId: ifaceId("RR2", "RR1"),
      lookupType: "Reflection Rule",
      lookupKey: "Source: non-client peer RR1",
      lookupResult: "PE3 no longer eligible — ordinary (non-client) peer, not a client",
      reason: candidate?.reason ?? "Between two non-client peers, ordinary iBGP split-horizon still applies.",
      forwardingAction: "PE3 is no longer eligible — RR2 now treats it as an ordinary (non-client) peer, and this route came from non-client peer RR1.",
    };
  }
  if (currentStepId === "repair-challenge" && router === "RR2" && state.repairAttempt?.correct) {
    const candidate = reflectionCandidatesFor(TWO_RR_DESIGN, "RR2", "RR1").find((c) => c.routerId === "PE3");
    return {
      deviceId: router,
      stages: RR_PIPELINE_STAGES,
      activeStageId: "reflect",
      completedStageIds: ["ingress", "session", "update-processing", "bgp-table", "source-peer-type", "reflection-rule", "loop-prevention", "eligible-peers"],
      ingressInterfaceId: ifaceId("RR2", "RR1"),
      egressInterfaceId: ifaceId("RR2", "PE3"),
      nextHopId: "PE3",
      nextHopLabel: "PE3",
      lookupType: "Reflection Rule",
      lookupKey: "Source: non-client peer RR1",
      lookupResult: "PE3 now eligible — reconfigured as RR2's client",
      reason: candidate?.reason ?? "Non-client-learned routes are still reflected to clients.",
      forwardingAction: "PE3 reconfigured as a client — now eligible, route reflected.",
    };
  }
  if (currentStepId === "verify-fix" && router === "PE3") {
    const received = state.received.PE3;
    return {
      deviceId: router,
      stages: PE_RECEIVE_STAGES,
      activeStageId: "bgp-table",
      completedStageIds: ["ingress", "session", "update-processing"],
      ingressInterfaceId: ifaceId("PE3", "RR2"),
      lookupType: "BGP Table",
      lookupKey: state.route?.prefix ?? PREFIX,
      lookupResult: received ? `Present — CLUSTER_LIST [${received.clusterList.join(", ")}]` : undefined,
      reason: "Route re-reflected now that PE3 is a client of RR2 again.",
      forwardingAction: "Route present, ORIGINATOR_ID and a two-entry CLUSTER_LIST intact.",
    };
  }

  // --- packet-driven steps: sender gets the short SEND trace, receiver gets the type-specific trace ---
  if (activePacket && (router === activePacket.from || router === activePacket.to)) {
    if (router === activePacket.from) {
      const to = activePacket.to as RouterId;
      return { deviceId: router, stages: PE_SEND_STAGES, activeStageId: "egress", completedStageIds: ["bgp-process"], egressInterfaceId: ifaceId(router, to), nextHopId: to, nextHopLabel: to };
    }
    // receiver
    const from = activePacket.from as RouterId;
    const received = state.received[router];
    if (isRr(router)) {
      // This RR is itself relaying onward (reflect-through-two-rr's RR2 leg) — show the full pipeline through "reflect".
      return {
        deviceId: router,
        stages: RR_PIPELINE_STAGES,
        activeStageId: "reflect",
        completedStageIds: ["ingress", "session", "update-processing", "bgp-table", "source-peer-type", "reflection-rule", "loop-prevention", "eligible-peers"],
        ingressInterfaceId: ifaceId(router, from),
        lookupType: "Reflection Rule",
        lookupKey: `Source: ${relationshipOf(state.design, router, from) === "client" ? "client" : "non-client peer"} ${from}`,
        lookupResult: received ? `Reflect onward — CLUSTER_LIST now [${received.clusterList.join(", ")}]` : undefined,
        reason: "Reflects onward to its own clients, appending its own cluster to CLUSTER_LIST.",
        forwardingAction: "Reflects onward to its own clients, appending its own cluster to CLUSTER_LIST.",
      };
    }
    const viaReflection = (received?.clusterList.length ?? 0) > 0;
    return {
      deviceId: router,
      stages: PE_RECEIVE_STAGES,
      activeStageId: "bgp-table",
      completedStageIds: ["ingress", "session", "update-processing"],
      ingressInterfaceId: ifaceId(router, from),
      lookupType: "BGP Table Insert",
      lookupKey: state.route?.prefix ?? PREFIX,
      lookupResult: viaReflection ? `Reflected — CLUSTER_LIST [${received?.clusterList.join(", ")}]` : "Directly learned",
      reason: viaReflection ? "Route reached this PE via a Route Reflector, carrying ORIGINATOR_ID/CLUSTER_LIST." : "Route learned directly from an iBGP peer.",
      forwardingAction: `${viaReflection ? "Reflected route" : "Directly-learned route"} added to BGP table.`,
    };
  }

  return idleTrace(router);
}

// ---------------------------------------------------------------------------
// Packet visual (brief §6/§13) — a BGP UPDATE's layer stack; RR-added
// attributes (ORIGINATOR_ID/CLUSTER_LIST) render as their own frame so
// "what existed before reflection vs. what reflection added" is visible
// in the stack itself, not just in the inspector fields.
// ---------------------------------------------------------------------------

export function packetFramesFor(packet: PacketVisual | undefined): PacketStackFrame[] | undefined {
  if (!packet) return undefined;
  const hasRrAttrs = packet.layers.some((l) => l.name === "BGP UPDATE (RR attributes)");
  const frames: PacketStackFrame[] = [{ id: "bgp", text: `BGP ${packet.badge ?? "UPDATE"}`, tone: "generic", justChanged: true }];
  if (hasRrAttrs) frames.push({ id: "rr-attrs", text: "ORIGINATOR_ID / CLUSTER_LIST", tone: "vpn", justChanged: true });
  frames.push({ id: "tcp", text: "TCP :179", tone: "transport" }, { id: "ip", text: "IP", tone: "ip" });
  return frames;
}

// ---------------------------------------------------------------------------
// Physical interfaces (brief §4/§19) — RR Relationship (Client /
// Non-client) is an RR-specific field carried in the generic `extra`
// bag, never a new named field on DeviceInterfaceData.
// ---------------------------------------------------------------------------

function neighborsFor(router: RouterId, design: RrDesign, visibleRouters: RouterId[]): RouterId[] {
  if (isRr(router)) return [...(design.clients[router] ?? []), ...(design.peers[router] ?? [])];
  if (design.mode === "fullmesh") return visibleRouters.filter((r) => r !== router && !isRr(r));
  const rr = connectedRrOf(design, router);
  return rr ? [rr] : [];
}

function portName(index: number) {
  return `ge-0/0/${index}`;
}

export function interfacesFor(router: RouterId, state: RrState, visibleRouters: RouterId[]): DeviceInterfaceData[] {
  const neighbors = neighborsFor(router, state.design, visibleRouters);
  return neighbors.map((neighbor, idx) => {
    const relationship: PeerRelationship | undefined = isRr(router) ? relationshipOf(state.design, router, neighbor) : isRr(neighbor) ? relationshipOf(state.design, neighbor, router) : undefined;
    const received = state.received[router];
    const receivedFromThisNeighbor = received?.receivedFrom === neighbor;
    return {
      id: `${router}-${neighbor}`,
      name: portName(idx),
      status: "up",
      ip: ROUTER_IP[neighbor],
      neighborId: neighbor,
      neighborLabel: `${neighbor} (${ROUTER_IP[neighbor]})`,
      linkType: "Internal (iBGP)",
      mtu: 1500,
      protocols: ["BGP"],
      packetCount: receivedFromThisNeighbor ? 1 : 0,
      role: "idle",
      extra: [
        { label: "BGP Enabled", value: "Yes" },
        { label: "Session Type", value: "iBGP" },
        { label: "Local AS", value: String(AS_NUMBER) },
        { label: "Peer AS", value: String(AS_NUMBER) },
        { label: "TCP State", value: "ESTABLISHED" },
        { label: "BGP State", value: "Established" },
        { label: "RR Relationship", value: relationship ? (relationship === "client" ? "Client" : "Non-Client") : "—" },
        { label: "Prefixes Received", value: String(receivedFromThisNeighbor ? 1 : 0) },
        { label: "Prefixes Advertised", value: String(state.received[neighbor]?.receivedFrom === router ? 1 : 0) },
        { label: "Reflected Routes", value: String(received?.viaReflection && receivedFromThisNeighbor ? 1 : 0) },
      ],
    };
  });
}

// ---------------------------------------------------------------------------
// Link detail (brief §19)
// ---------------------------------------------------------------------------

export function linkDetailFor(linkId: string, state: RrState, visibleRouters: RouterId[], activePacket: PacketVisual | undefined): LinkDetail | undefined {
  const dashIdx = linkId.indexOf("-", linkId.indexOf("-") + 1) > 0 && linkId.startsWith("RR") ? linkId.indexOf("-") : linkId.lastIndexOf("-");
  const a = linkId.slice(0, dashIdx) as RouterId;
  const b = linkId.slice(dashIdx + 1) as RouterId;
  const aIfaces = interfacesFor(a, state, visibleRouters);
  const bIfaces = interfacesFor(b, state, visibleRouters);
  const aIface = aIfaces.find((f) => f.neighborId === b);
  const bIface = bIfaces.find((f) => f.neighborId === a);
  if (!aIface || !bIface) return undefined;
  const rr = isRr(a) ? a : isRr(b) ? b : undefined;
  const other = rr === a ? b : a;
  const relationship = rr ? relationshipOf(state.design, rr, other) : undefined;
  const traffic = activePacket && ((activePacket.from === a && activePacket.to === b) || (activePacket.from === b && activePacket.to === a)) ? activePacket.summary : undefined;
  return {
    aLabel: a,
    bLabel: b,
    aInterface: aIface,
    bInterface: bIface,
    status: "up",
    mtu: 1500,
    protocols: [
      { label: "Link Type", value: "Internal (iBGP)" },
      { label: "TCP Port", value: "179" },
      { label: "TCP State", value: "ESTABLISHED" },
      { label: "BGP FSM", value: "Established" },
      { label: "RR Relationship", value: relationship ? (relationship === "client" ? `${other} is a Client` : `${other} is a Non-Client peer`) : "—" },
    ],
    currentTraffic: traffic,
  };
}

// ---------------------------------------------------------------------------
// Node explanation (brief §3/§28)
// ---------------------------------------------------------------------------

export function explainRouter(state: RrState, router: RouterId, currentStepId: string, activePacket: PacketVisual | undefined, visibleRouters: RouterId[]): NodeExplanation {
  const neighbors = neighborsFor(router, state.design, visibleRouters);
  const received = state.received[router];
  const rrRole = isRr(router);

  let currentAction: string;
  if (currentStepId === "intro" || currentStepId === "show-fullmesh" || state.design.mode === "fullmesh") {
    currentAction = rrRole ? `${router} is not yet configured as a Route Reflector.` : `${router} peers directly with every other PE in the mesh — no Route Reflector yet.`;
  } else if (activePacket && router === activePacket.from) {
    currentAction = rrRole ? `${router} is reflecting the route onward.` : `${router} is advertising its route via iBGP.`;
  } else if (activePacket && router === activePacket.to) {
    currentAction = rrRole ? `${router} receives the route and evaluates its reflection rules.` : `${router} receives the route${received?.viaReflection ? " — reflected, carrying ORIGINATOR_ID/CLUSTER_LIST" : ""}.`;
  } else if (currentStepId === "show-split-horizon-blocked" && router === "PE2") {
    currentAction = "PE2 does NOT re-advertise this iBGP-learned route to PE3 — ordinary iBGP split-horizon.";
  } else if (currentStepId === "fault-intro" && router === "PE3") {
    currentAction = "PE3's session to RR2 is Established, but PE3 no longer receives the reflected route — it was just downgraded to a non-client peer.";
  } else if (currentStepId === "fault-intro" && router === "RR2") {
    currentAction = "RR2 now treats PE3 as an ordinary peer — a route learned from non-client peer RR1 is not reflected to another non-client.";
  } else if (received) {
    currentAction = `${router} holds ${received.route.prefix}${received.viaReflection ? ` (reflected, CLUSTER_LIST [${received.clusterList.join(", ")}])` : " (directly learned)"}.`;
  } else {
    currentAction = `${router} holds no route to ${state.route?.prefix ?? "10.1.1.0/24"} yet.`;
  }

  return {
    id: router,
    name: router,
    deviceType: rrRole ? "Route Reflector" : "PE Router",
    role: rrRole ? "ROUTE REFLECTOR" : "PE ROUTER",
    currentAction,
    controlPlaneRole: rrRole
      ? "Ordinary iBGP speaker with one extra behavior: routes learned from a client may be reflected to other clients and non-client peers, per the reflection rules."
      : "Runs iBGP: peers with its Route Reflector (or, in full mesh, with every other PE directly) and installs the best path it learns.",
    dataPlaneRole: "Never in the customer forwarding path by virtue of reflecting routes — forwarding is decided by the IGP/MPLS transport, entirely separate from BGP control-plane reflection.",
    tables: [
      {
        title: `${router} — Info`,
        rows: [
          { label: "Router ID", value: ROUTER_IP[router] },
          { label: "AS", value: String(AS_NUMBER) },
          ...(rrRole ? [{ label: "Cluster ID", value: CLUSTER_ID[router] ?? "—" }] : []),
          { label: "BGP Sessions", value: String(neighbors.length) },
          { label: "Route", value: received ? received.route.prefix : "none" },
        ],
      },
      {
        title: `${router} — Sessions`,
        rows: neighbors.map((n) => ({ label: n, value: rrRole ? (isClientOf(state.design, router, n) ? "Client" : isPeerOf(state.design, router, n) ? "Non-Client Peer" : "—") : isRr(n) ? relationshipOf(state.design, n, router) === "client" ? "This router is n's Client" : "Non-Client Peer" : "Full-Mesh Peer" })),
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Diagnostic layers (brief §22/§24) — computed from the real reflection
// rules (`evaluateReflection`), never re-decided here.
// ---------------------------------------------------------------------------

export interface DiagnosticLayer {
  label: string;
  ok: boolean;
  detail?: string;
}

export function diagnosticLayersFor(state: RrState, router: RouterId): DiagnosticLayer[] {
  if (isRr(router)) {
    const received = state.received[router];
    return [
      { label: "Physical Interface", ok: true },
      { label: "TCP/179", ok: true },
      { label: "BGP Session", ok: true },
      { label: "Route at RR", ok: !!received },
      { label: "Best Path", ok: !!received },
      { label: "Reflection Decision", ok: true },
      { label: "Update Sent", ok: !!received },
      { label: "Route at Client", ok: true },
    ];
  }
  const rr = connectedRrOf(state.design, router);
  const rrReceived = rr ? state.received[rr] : undefined;
  const routeAtRr = !!rrReceived;
  const relationship: PeerRelationship = rr ? relationshipOf(state.design, rr, router) : "non-client";
  const sourceRelationship: PeerRelationship = rr && rrReceived ? relationshipOf(state.design, rr, rrReceived.receivedFrom) : "client";
  const candidateResult: ReflectionCandidate | undefined = rr && routeAtRr ? { routerId: router, relationship, ...evaluateReflection(sourceRelationship, relationship) } : undefined;
  const shouldReceive = candidateResult?.decision === "reflect";
  const received = state.received[router];
  return [
    { label: "Physical Interface", ok: true },
    { label: "TCP/179", ok: true },
    { label: "BGP Session", ok: true },
    { label: "Route at RR", ok: routeAtRr },
    { label: "Best Path", ok: routeAtRr },
    { label: "Reflection Decision", ok: !routeAtRr || shouldReceive },
    { label: "Update Sent", ok: !!received },
    { label: "Route at Client", ok: !!received },
  ];
}

