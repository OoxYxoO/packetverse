import type { DeviceInterfaceData, DeviceProcessingTrace, LinkDetail, NodeExplanation, PacketStackFrame, ProcessingStage } from "@/components/network3d/types";
import type { PacketVisual } from "@/lib/sim-engine/types";
import { ALL_ROUTERS, GRAPH_EDGES, IFACE_IP, NEIGHBOR_STATE_LABEL, ROUTER_IDS, ospfSteps, type NeighborState, type OspfState, type RouterId, type RouterLSA } from "@/lib/sim-engine/scenarios/ospfArea0";

/**
 * The "Scene Adapter" (brief §27) for OSPF's device-interior 3D view.
 * Every stage list, checkpoint, interface, and link-detail value below
 * is computed FROM OspfState + the current step's PacketVisual (the
 * ScenarioEngine's own output) — this file never makes a neighbor-
 * state, LSDB, or SPF decision itself, it only re-describes decisions
 * ospfArea0.ts already made, in the generic DeviceProcessingTrace/
 * DeviceInterfaceData shape the 3D layer understands. Nothing in
 * components/network3d/ imports this file directly.
 *
 * Unlike MPLS (where PE/P routers play structurally different roles),
 * every OSPF router runs the identical generic pipeline — so the
 * per-packet-type stage lists below (brief §28) are selected by what
 * KIND of OSPF packet is involved and whether this router is
 * currently sending or receiving it, not by router identity.
 */

const stepIndex = (id: string) => ospfSteps.findIndex((s) => s.id === id);

/**
 * Which router is the primary educational subject of a given step, when
 * that differs from "whoever the current packet happens to be addressed
 * to" — e.g. step "r2-to-init" 's packet is R2's OUTGOING reply, but the
 * interesting moment (brief §7) is R2's own DOWN→INIT transition. Packet
 * Follow's auto-enter consults this before falling back to the generic
 * "first router with an active stage" scan.
 */
export const PRIMARY_TRANSITION_ROUTER: Record<string, RouterId> = {
  "r2-to-init": "R2",
  "r1-to-2way": "R1",
  full: "R1",
  "adjacency-reforms": "R1",
};

/** Neighbor-state BEFORE/AFTER text for the transition-at-origin steps above (brief §7/§8). */
const TRANSITIONS: Record<string, { before: string; after: string }> = {
  "r2-to-init": { before: "DOWN", after: "INIT" },
  "r1-to-2way": { before: "DOWN/INIT", after: "2-WAY" },
  full: { before: "LOADING", after: "FULL" },
  "adjacency-reforms": { before: "DOWN", after: "FULL" },
};
const TRANSITION_ROUTERS: Record<string, RouterId[]> = {
  "r2-to-init": ["R2"],
  "r1-to-2way": ["R1", "R2"],
  full: ["R1", "R2"],
  "adjacency-reforms": ["R1", "R2"],
};

// ---------------------------------------------------------------------------
// Conceptual OSPF Control-Plane Pipeline — per-packet-type stage lists
// (brief §5/§28). The umbrella title "Conceptual OSPF Control-Plane
// Pipeline" is fixed inside <ForwardingPipeline3D>; only `stages` vary.
// ---------------------------------------------------------------------------

const SEND_STAGES: ProcessingStage[] = [
  { id: "ospf-process", label: "OSPF Process (Originate)" },
  { id: "build-packet", label: "Build Packet" },
  { id: "egress", label: "Egress Interface" },
];

const HELLO_STAGES: ProcessingStage[] = [
  { id: "ingress", label: "Ingress Interface" },
  { id: "protocol89", label: "Identify IP Protocol 89" },
  { id: "hello-processing", label: "OSPF Hello Processing" },
  { id: "validate-params", label: "Validate Area / Timers / Parameters" },
  { id: "neighbor-lookup", label: "Neighbor Lookup / Create" },
  { id: "state-transition", label: "State Transition" },
];

const DBD_STAGES: ProcessingStage[] = [
  { id: "ingress", label: "Ingress Interface" },
  { id: "protocol89", label: "Identify IP Protocol 89" },
  { id: "neighbor-sync", label: "Neighbor Synchronization" },
  { id: "compare-lsdb", label: "Compare LSDB Summaries" },
  { id: "determine-missing", label: "Determine Missing Information" },
  { id: "state-transition", label: "State Transition" },
];

const LSR_STAGES: ProcessingStage[] = [
  { id: "ingress", label: "Ingress Interface" },
  { id: "protocol89", label: "Identify IP Protocol 89" },
  { id: "lsr-processing", label: "OSPF LSR Processing" },
  { id: "lsdb-gap", label: "Identify LSDB Gap" },
  { id: "state-transition", label: "State Transition" },
];

const LSU_STAGES: ProcessingStage[] = [
  { id: "ingress", label: "Ingress" },
  { id: "ospf-lsu", label: "OSPF LSU" },
  { id: "validate-lsa", label: "Validate LSA" },
  { id: "lsdb-install", label: "LSDB Install / Update" },
  { id: "flood", label: "Flood If Necessary" },
  { id: "trigger-spf", label: "Trigger SPF If Topology Changed" },
];

const LSACK_STAGES: ProcessingStage[] = [
  { id: "ingress", label: "Ingress Interface" },
  { id: "protocol89", label: "Identify IP Protocol 89" },
  { id: "lsack-processing", label: "OSPF LSAck Processing" },
  { id: "lsdb-confirm", label: "Confirm LSDB Acknowledged" },
  { id: "state-transition", label: "State Transition" },
];

const SPF_STAGES: ProcessingStage[] = [
  { id: "lsdb", label: "LSDB" },
  { id: "dijkstra", label: "Dijkstra / SPF" },
  { id: "best-path", label: "Best Path" },
  { id: "rib", label: "RIB" },
];

/** Shown for a router that isn't involved in the current step's packet or SPF run — the full umbrella pipeline (brief §5), entirely dim. */
const IDLE_STAGES: ProcessingStage[] = [
  { id: "ingress", label: "Ingress Interface" },
  { id: "protocol89", label: "Identify IP Protocol 89" },
  { id: "ospf-process", label: "OSPF Process" },
  { id: "neighbor-fsm", label: "Neighbor State Machine" },
  { id: "lsdb", label: "LSDB" },
  { id: "spf", label: "SPF" },
  { id: "rib", label: "RIB" },
  { id: "forwarding", label: "Forwarding Result" },
];

function idleTrace(router: RouterId): DeviceProcessingTrace {
  return { deviceId: router, stages: IDLE_STAGES, completedStageIds: [] };
}

/** Which conceptual OSPF packet kind is this, from the layer the scenario file already built? */
function packetKind(packet: PacketVisual): "hello" | "dbd" | "lsr" | "lsu" | "lsack" | undefined {
  const name = packet.layers[1]?.name;
  if (name === "OSPF Hello") return "hello";
  if (name === "OSPF DBD") return "dbd";
  if (name === "OSPF LSR") return "lsr";
  if (name === "OSPF LSU") return "lsu";
  if (name === "OSPF LSAck") return "lsack";
  return undefined;
}

function neighborLine(state: OspfState, router: RouterId, neighbor: RouterId): string {
  const s = state.neighborTables[router]?.[neighbor]?.state ?? "DOWN";
  return `Neighbor ${ROUTER_IDS[neighbor]}: ${NEIGHBOR_STATE_LABEL[s]}`;
}

/** Interface id for `router`'s port facing `neighbor` — must match `interfacesFor`'s own `id` (Hop Inspector ingress/egress rows resolve interface names by this id). */
function ifaceId(router: RouterId, neighbor: RouterId): string {
  return `${router}-${neighbor}`;
}

/**
 * Per-router trace for the CURRENT packet in flight (if any), or for
 * an SPF run (spfRoot), or the idle umbrella pipeline otherwise.
 * `beforeState`/`afterState` let the sender/receiver show the exact
 * neighbor-state transition this step narrates (brief §7's
 * BEFORE/AFTER panel), without this file inferring it — the
 * transition text is exactly what ospfArea0.ts's own `whatChanged`
 * already says, just re-shown here as `packetBefore`/`packetAfter`.
 */
export function traceFor(router: RouterId, state: OspfState, currentStepId: string, activePacket: PacketVisual | undefined): DeviceProcessingTrace {
  const i = stepIndex(currentStepId);

  // --- SPF steps: no packet, root router gets the SPF-specific stages ---
  if (currentStepId === "spf-start" && router === (state.spfRoot ?? "R1")) {
    return { deviceId: router, stages: SPF_STAGES, activeStageId: "dijkstra", completedStageIds: ["lsdb"] };
  }
  if ((currentStepId === "spf-complete" || currentStepId === "spf-rerun") && router === (state.spfRoot ?? "R1")) {
    const dest = "R4";
    const route = state.routingTables[router]?.[dest];
    return {
      deviceId: router,
      stages: SPF_STAGES,
      activeStageId: "rib",
      completedStageIds: ["lsdb", "dijkstra", "best-path"],
      forwardingAction: route ? `Route to ${ROUTER_IDS[dest]}: via ${route.nextHop}, cost ${route.cost}` : undefined,
    };
  }
  if ((currentStepId === "cost-changed" || currentStepId === "challenge" || currentStepId === "challenge-intro") && router === "R1") {
    return { deviceId: router, stages: LSU_STAGES, activeStageId: "ospf-lsu", completedStageIds: [] };
  }
  if (currentStepId === "fault-injected") {
    if (router === "R1" || router === "R2") {
      return { deviceId: router, stages: HELLO_STAGES, activeStageId: "validate-params", completedStageIds: ["ingress", "protocol89"], forwardingAction: "Area on this Hello does not match this interface's own area — discarded." };
    }
    return idleTrace(router);
  }

  // --- transition-at-origin steps: the step's packet is this router's OUTGOING reply, but the
  // interesting educational moment is the state transition it just made because of the Hello it
  // received a moment earlier in the same narrative beat (brief §7/§8's BEFORE/AFTER panel) ---
  if (TRANSITIONS[currentStepId] && TRANSITION_ROUTERS[currentStepId]?.includes(router)) {
    const { before, after } = TRANSITIONS[currentStepId];
    const neighbor = router === "R1" ? "R2" : "R1";
    return {
      deviceId: router,
      stages: HELLO_STAGES,
      activeStageId: "state-transition",
      completedStageIds: ["ingress", "protocol89", "hello-processing", "validate-params", "neighbor-lookup"],
      packetBefore: `Neighbor ${ROUTER_IDS[neighbor]}: ${before}`,
      packetAfter: `Neighbor ${ROUTER_IDS[neighbor]}: ${after}`,
    };
  }

  // --- packet-driven steps: sender gets the short SEND trace, receiver gets the type-specific trace ---
  if (activePacket && (router === activePacket.from || router === activePacket.to)) {
    const kind = packetKind(activePacket);
    const from = activePacket.from as RouterId;
    if (router === activePacket.from) {
      const to = activePacket.to as RouterId;
      return { deviceId: router, stages: SEND_STAGES, activeStageId: "egress", completedStageIds: ["ospf-process", "build-packet"], egressInterfaceId: ifaceId(router, to), nextHopId: to, nextHopLabel: ROUTER_IDS[to] };
    }
    // receiver
    const before = neighborLine(state, router, from);
    const ingressInterfaceId = ifaceId(router, from);
    switch (kind) {
      case "hello": {
        const prevState = state.neighborTables[router]?.[from]?.state ?? "DOWN";
        const nowState = prevState;
        return {
          deviceId: router,
          stages: HELLO_STAGES,
          activeStageId: i <= stepIndex("r2-to-init") ? "neighbor-lookup" : "state-transition",
          completedStageIds: ["ingress", "protocol89", "hello-processing", "validate-params"],
          ingressInterfaceId,
          lookupType: "Neighbor Lookup",
          lookupKey: ROUTER_IDS[from],
          lookupResult: `Neighbor state: ${NEIGHBOR_STATE_LABEL[nowState]}`,
          reason: "Area, Hello/Dead interval, and network-type parameters matched.",
          packetBefore: before,
          packetAfter: `Neighbor ${ROUTER_IDS[from]}: ${NEIGHBOR_STATE_LABEL[nowState]}`,
        };
      }
      case "dbd":
        return {
          deviceId: router,
          stages: DBD_STAGES,
          activeStageId: currentStepId === "exstart" ? "neighbor-sync" : "compare-lsdb",
          completedStageIds: currentStepId === "exstart" ? ["ingress", "protocol89"] : ["ingress", "protocol89", "neighbor-sync"],
          ingressInterfaceId,
          lookupType: "DBD Summary Compare",
          lookupKey: ROUTER_IDS[from],
          reason: currentStepId === "exstart" ? "Master/slave relationship and initial sequence number negotiated." : "Comparing this DBD's LSA headers against the local LSDB to find missing entries.",
        };
      case "lsr":
        return {
          deviceId: router,
          stages: LSR_STAGES,
          activeStageId: "lsdb-gap",
          completedStageIds: ["ingress", "protocol89", "lsr-processing"],
          ingressInterfaceId,
          lookupType: "LSR Processing",
          lookupKey: ROUTER_IDS[from],
          reason: "Identifying which LSAs the requester is missing from its LSDB.",
        };
      case "lsu":
        return {
          deviceId: router,
          stages: LSU_STAGES,
          activeStageId: currentStepId === "flood-lsas" || currentStepId === "lsa-reflooded" ? "flood" : "lsdb-install",
          completedStageIds: ["ingress", "ospf-lsu", "validate-lsa"],
          ingressInterfaceId,
          lookupType: "LSDB Install",
          lookupResult: "New/updated Router-LSA installed",
          reason: currentStepId === "flood-lsas" || currentStepId === "lsa-reflooded" ? "Topology changed — this LSA must be reflooded out every other adjacency." : "LSA sequence number is newer than what's currently in the LSDB.",
          forwardingAction: "New/updated Router-LSA installed into local LSDB.",
        };
      case "lsack":
        return {
          deviceId: router,
          stages: LSACK_STAGES,
          activeStageId: "state-transition",
          completedStageIds: ["ingress", "protocol89", "lsack-processing", "lsdb-confirm"],
          ingressInterfaceId,
          lookupType: "LSAck Confirm",
          lookupKey: ROUTER_IDS[from],
          reason: "Reliable flooding confirmed — no retransmission needed for this LSA.",
        };
      default:
        return idleTrace(router);
    }
  }

  return idleTrace(router);
}

// ---------------------------------------------------------------------------
// Packet visual (brief §6/§22) — the OSPF packet as a 2-frame stack:
// the OSPF-type layer on top, the carrying IPv4 (protocol 89) layer
// underneath, straight from the layers ospfArea0.ts's own packet
// builders already produced.
// ---------------------------------------------------------------------------

export function packetFramesFor(packet: PacketVisual | undefined): PacketStackFrame[] | undefined {
  if (!packet) return undefined;
  const ospfLayer = packet.layers[1];
  const label = ospfLayer?.name?.replace("OSPF ", "") ?? "OSPF";
  return [
    { id: "ospf", text: label, tone: "generic", justChanged: true },
    { id: "ip", text: "IP (proto 89)", tone: "ip" },
  ];
}

// ---------------------------------------------------------------------------
// Physical interfaces (brief §2/§4/§17) — generic naming; Area/Cost/
// Network Type/Hello/Dead/Neighbor State/OSPF-enabled are OSPF-
// specific fields carried in the generic `extra` bag, not new named
// fields on DeviceInterfaceData.
// ---------------------------------------------------------------------------

const PORT_NAMES: Record<RouterId, RouterId[]> = {
  R1: ["R2", "R3"],
  R2: ["R1", "R4"],
  R3: ["R1", "R4"],
  R4: ["R2", "R3"],
};

function portName(router: RouterId, index: number) {
  return `ge-0/0/${index}`;
}

function packetTouchesLink(step: (typeof ospfSteps)[number], state: OspfState, router: RouterId, neighbor: RouterId): boolean {
  const p = step.packet?.(state);
  if (!p) return false;
  return (p.from === router && p.to === neighbor) || (p.from === neighbor && p.to === router);
}

export function interfacesFor(router: RouterId, state: OspfState, currentStepId: string, activePacket: PacketVisual | undefined): DeviceInterfaceData[] {
  const neighbors = PORT_NAMES[router];
  const i = stepIndex(currentStepId);
  return neighbors.map((neighbor, idx) => {
    const cfg = state.interfaces[router]?.[neighbor];
    const nbState: NeighborState = state.neighborTables[router]?.[neighbor]?.state ?? "DOWN";
    const role = activePacket && ((activePacket.to === router && activePacket.from === neighbor) || (activePacket.from === router && activePacket.to === neighbor)) ? (activePacket.to === router ? "ingress" : "egress") : "idle";
    const packetCount = ospfSteps.slice(0, i + 1).filter((s) => packetTouchesLink(s, state, router, neighbor)).length;
    return {
      id: `${router}-${neighbor}`,
      name: portName(router, idx),
      status: "up",
      ip: IFACE_IP[router]?.[neighbor],
      neighborId: neighbor,
      neighborLabel: `${neighbor} (${ROUTER_IDS[neighbor]})`,
      linkType: "Point-to-Point",
      mtu: 1500,
      protocols: ["OSPF"],
      packetCount,
      role,
      extra: [
        { label: "Area", value: cfg?.area ?? "—" },
        { label: "Cost", value: String(cfg?.cost ?? "—") },
        { label: "Network Type", value: "Point-to-Point" },
        { label: "Hello Interval", value: "10s" },
        { label: "Dead Interval", value: "40s" },
        { label: "Neighbor Router ID", value: ROUTER_IDS[neighbor] },
        { label: "Neighbor State", value: NEIGHBOR_STATE_LABEL[nbState] },
        { label: "OSPF Enabled", value: "Yes" },
      ],
    };
  });
}

// ---------------------------------------------------------------------------
// Link detail (brief §10/§23) — kept generic (`protocols: {label,value}[]`)
// so the same LinkDetailPanel can carry BGP/IS-IS/LDP/RSVP fields later.
// ---------------------------------------------------------------------------

export function linkDetailFor(linkId: string, state: OspfState, activePacket: PacketVisual | undefined): LinkDetail | undefined {
  const edge = GRAPH_EDGES.find((e) => e.id === linkId);
  if (!edge) return undefined;
  const { a, b } = edge;
  const aIfaces = interfacesFor(a, state, "", undefined);
  const bIfaces = interfacesFor(b, state, "", undefined);
  const aIface = aIfaces.find((f) => f.neighborId === b);
  const bIface = bIfaces.find((f) => f.neighborId === a);
  if (!aIface || !bIface) return undefined;
  const aCfg = state.interfaces[a]?.[b];
  const bCfg = state.interfaces[b]?.[a];
  const nbState = state.neighborTables[a]?.[b]?.state ?? "DOWN";
  const areaMismatch = aCfg?.area !== bCfg?.area;
  const traffic = activePacket && ((activePacket.from === a && activePacket.to === b) || (activePacket.from === b && activePacket.to === a)) ? `${activePacket.summary}` : undefined;
  return {
    aLabel: a,
    bLabel: b,
    aInterface: aIface,
    bInterface: bIface,
    status: "up",
    mtu: 1500,
    protocols: [
      { label: `${a} Area`, value: aCfg?.area ?? "—" },
      { label: `${b} Area`, value: bCfg?.area ?? "—" },
      { label: "Cost", value: `${a}→${b}: ${aCfg?.cost ?? "—"}, ${b}→${a}: ${bCfg?.cost ?? "—"}` },
      { label: "Network Type", value: "Point-to-Point" },
      { label: "OSPF Adjacency", value: areaMismatch ? "DOWN" : NEIGHBOR_STATE_LABEL[nbState] },
    ],
    currentTraffic: traffic,
  };
}

// ---------------------------------------------------------------------------
// Node explanation (brief §3/§26) — tense-aware, derived from the
// current step id and neighbor/LSDB/routing state, never hardcoded
// per-step text unrelated to what actually happened.
// ---------------------------------------------------------------------------

const ROLE_LABEL = "OSPF ROUTER";

export function explainRouter(state: OspfState, router: RouterId, currentStepId: string, activePacket: PacketVisual | undefined): NodeExplanation {
  const i = stepIndex(currentStepId);
  const neighbors = PORT_NAMES[router];
  const neighborRows = neighbors.map((n) => ({ label: ROUTER_IDS[n], value: NEIGHBOR_STATE_LABEL[state.neighborTables[router]?.[n]?.state ?? "DOWN"] }));
  const lsdbCount = Object.keys(state.lsdb[router] ?? {}).length;
  const routeRows = Object.values(state.routingTables[router] ?? {})
    .filter((r): r is NonNullable<typeof r> => Boolean(r))
    .map((r) => ({ label: ROUTER_IDS[r.destination], value: `via ${r.nextHop}, cost ${r.cost}` }));

  let currentAction: string;
  let packetBefore: string | undefined;
  let packetAfter: string | undefined;
  if (i < 0) currentAction = "Idle.";
  else if (TRANSITIONS[currentStepId] && TRANSITION_ROUTERS[currentStepId]?.includes(router)) {
    const { before, after } = TRANSITIONS[currentStepId];
    const neighbor = router === "R1" ? "R2" : "R1";
    packetBefore = `Neighbor ${ROUTER_IDS[neighbor]}: ${before}`;
    packetAfter = `Neighbor ${ROUTER_IDS[neighbor]}: ${after}`;
    currentAction = `${router} just transitioned its adjacency toward ${neighbor}: ${before} → ${after}.`;
  } else if (activePacket && (router === activePacket.from || router === activePacket.to)) {
    const kind = packetKind(activePacket) ?? "packet";
    currentAction = router === activePacket.from ? `${router} is sending an OSPF ${kind.toUpperCase()} toward ${activePacket.to}.` : `${router} is receiving an OSPF ${kind.toUpperCase()} from ${activePacket.from}.`;
  } else if ((currentStepId === "spf-start" || currentStepId === "spf-complete" || currentStepId === "spf-rerun") && router === (state.spfRoot ?? "R1")) {
    currentAction = currentStepId === "spf-start" ? `${router} is running SPF (Dijkstra) over its LSDB.` : `${router} has completed SPF and installed the resulting route.`;
  } else if (currentStepId === "fault-injected" && (router === "R1" || router === "R2")) {
    currentAction = `${router}'s adjacency toward its neighbor just dropped — check the interface area.`;
  } else {
    currentAction = `Idle — ${lsdbCount} LSA${lsdbCount === 1 ? "" : "s"} in LSDB, ${routeRows.length} OSPF route${routeRows.length === 1 ? "" : "s"} installed.`;
  }

  return {
    id: router,
    name: router,
    deviceType: "OSPF Router",
    role: ROLE_LABEL,
    currentAction,
    packetBefore,
    packetAfter,
    controlPlaneRole: "Runs OSPF: forms adjacencies, floods LSAs, computes SPF, installs routes.",
    dataPlaneRole: "Forwards normal IP traffic using the routes OSPF installed — OSPF packets themselves never carry user traffic.",
    tables: [
      {
        title: `${router} — Info`,
        rows: [
          { label: "Router ID", value: ROUTER_IDS[router] },
          { label: "Area", value: "0.0.0.0" },
          { label: "Interfaces", value: String(neighbors.length) },
          { label: "LSDB Entries", value: String(lsdbCount) },
          { label: "SPF State", value: router !== (state.spfRoot ?? "R1") ? "Not run" : state.spfBestPath ? "Complete" : state.spfPaths ? "Running" : "Not run" },
        ],
      },
      { title: `${router} — Neighbor Table`, rows: neighborRows },
      { title: `${router} — Routing Table (OSPF)`, rows: routeRows.length ? routeRows : [{ label: "—", value: "no OSPF routes yet" }] },
    ],
  };
}

// ---------------------------------------------------------------------------
// LSA Flooding Mode (brief §1) — a visualization adapter over the SAME
// neighborTables/lsdb the rest of this file already reads. This never
// decides adjacency, cost, or flooding eligibility itself — it just
// walks the already-established FULL-adjacency graph breadth-first from
// an origin to get a hop-by-hop animation order. Excluding already-
// visited routers is what naturally (a) stops a copy from bouncing back
// out the interface it arrived on, and (b) stops flooding once every
// router has the LSA — the real OSPF behavior this is reenacting.
// ---------------------------------------------------------------------------

/** Which router is the visual origin of the flood for a given step — the router that just (re)originated a Router-LSA. "flood-lsas" is really four simultaneous origins (every router floods its own initial LSA at once); R1 is shown as the representative case. */
export const FLOOD_ORIGIN_BY_STEP: Record<string, RouterId> = {
  "flood-lsas": "R1",
  "lsa-reflooded": "R1",
  challenge: "R1",
};

/** Breadth-first waves of routers reached from `origin`, following only FULL adjacencies. wave[0] = [origin]; wave[1] = its direct FULL neighbors; etc. A router that would be reached from two directions in the same wave (R4 from both R2 and R3 here) appears once — visualized as receiving two simultaneous copies, one of which is then redundant. */
export function computeFloodWaves(origin: RouterId, neighborTables: OspfState["neighborTables"]): RouterId[][] {
  const waves: RouterId[][] = [[origin]];
  const visited = new Set<RouterId>([origin]);
  for (let guard = 0; guard < ALL_ROUTERS.length; guard++) {
    const prev = waves[waves.length - 1];
    const next: RouterId[] = [];
    for (const r of prev) {
      for (const n of ALL_ROUTERS) {
        if (visited.has(n)) continue;
        const st = neighborTables[r]?.[n]?.state;
        if (st === "FULL" && !next.includes(n)) next.push(n);
      }
    }
    if (next.length === 0) break;
    next.forEach((n) => visited.add(n));
    waves.push(next);
  }
  return waves;
}

/** Edges (GRAPH_EDGES ids) that deliver flood wave `waveIndex` — the edges from every router in wave[waveIndex-1] to every newly-reached router in wave[waveIndex] that they're actually adjacent to. Two edges landing on the same router (the duplicate-delivery case) both appear. */
export function floodEdgesForWave(waves: RouterId[][], waveIndex: number, neighborTables: OspfState["neighborTables"]): { id: string; from: RouterId; to: RouterId }[] {
  if (waveIndex <= 0 || waveIndex >= waves.length) return [];
  const senders = waves[waveIndex - 1];
  const receivers = waves[waveIndex];
  const edges: { id: string; from: RouterId; to: RouterId }[] = [];
  for (const to of receivers) {
    for (const from of senders) {
      if (neighborTables[from]?.[to]?.state !== "FULL") continue;
      const graphEdge = GRAPH_EDGES.find((e) => (e.a === from && e.b === to) || (e.a === to && e.b === from));
      if (graphEdge) edges.push({ id: `flood-${graphEdge.id}-${from}-${to}`, from, to });
    }
  }
  return edges;
}

/** The LSA as an inspectable object (brief §1's click-to-inspect), reusing the same PacketVisual/PacketInspector machinery every other OSPF packet type already uses. `age` isn't modeled anywhere in OspfState (no timestamps are tracked), so it's shown honestly rather than invented. */
export function lsaInspectorPacket(lsa: RouterLSA): PacketVisual {
  return {
    id: `lsa-${lsa.originRouter}-seq${lsa.sequence}`,
    protocol: "OSPF",
    from: lsa.originRouter,
    to: "Area 0.0.0.0",
    summary: `Router-LSA ${ROUTER_IDS[lsa.originRouter]} (sequence ${lsa.sequence})`,
    broadcast: true,
    layers: [
      {
        name: "Router-LSA",
        color: "var(--pv-proto-ospf)",
        fields: [
          { label: "LSA Type", value: "1 (Router-LSA)" },
          { label: "Advertising Router", value: ROUTER_IDS[lsa.originRouter] },
          { label: "Link State ID", value: ROUTER_IDS[lsa.originRouter] },
          { label: "Sequence", value: String(lsa.sequence) },
          { label: "Age", value: "(not modeled in this simulation)" },
          { label: "Links", value: lsa.links.map((l) => `${l.neighbor} (cost ${l.cost})`).join(", ") },
        ],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Data-plane demonstration (brief §3/§4) — kept entirely separate from
// `traceFor` above (which is OSPF control-plane only) rather than
// threading a new parameter through it, so the existing, already-
// verified control-plane trace logic is untouched. This is the ONE
// place in the OSPF lesson a normal IP packet's forwarding decision is
// shown, and it explicitly never routes through OSPF's own packet
// machinery — it just reads the route OSPF already installed.
// ---------------------------------------------------------------------------

const DATA_FORWARD_STAGES: ProcessingStage[] = [
  { id: "ip-arrives", label: "IP Packet Arrives" },
  { id: "dest-lookup", label: "Destination Lookup" },
  { id: "routing-table", label: "Routing Table" },
  { id: "ospf-route", label: "OSPF-Installed Route" },
  { id: "next-hop", label: "Next Hop" },
  { id: "egress", label: "Egress Interface" },
];

/** The conceptual forwarding pipeline for a normal IP packet currently departing `fromRouter` toward `toRouter` over the route OSPF installed. */
export function dataForwardTrace(fromRouter: RouterId, toRouter: RouterId): DeviceProcessingTrace {
  return {
    deviceId: fromRouter,
    stages: DATA_FORWARD_STAGES,
    activeStageId: "egress",
    completedStageIds: ["ip-arrives", "dest-lookup", "routing-table", "ospf-route", "next-hop"],
    forwardingAction: `Next hop: ${ROUTER_IDS[toRouter]} — via the route OSPF's SPF already installed, not decided by this packet.`,
  };
}
