import type { PacketLayer, PacketVisual, ScenarioStep } from "../types";

/**
 * BGP ROUTE REFLECTOR — iBGP scaling
 *
 *   Full mesh (the problem):          Route Reflector (the fix):
 *
 *   PE1 ---------- PE2                          RR1
 *    | \          / |                        /   |   \
 *    |  \        /  |                       /    |    \
 *    |   \      /   |                     PE1   PE2   PE3
 *    |    \    /    |                              \
 *   PE3 ---------- PE4                              PE4
 *
 * Scope: one AS (65000), iBGP only — no eBGP, no MPLS forwarding, no
 * VPN label allocation (those already live in the BGP-fundamentals and
 * MPLS L3VPN lessons). This lesson's job is narrow and specific: WHY
 * full-mesh iBGP doesn't scale, WHAT a Route Reflector changes about
 * the normal iBGP split-horizon rule, and the four CLIENT/NON-CLIENT
 * reflection rules plus ORIGINATOR_ID/CLUSTER_LIST loop prevention.
 * Reuses the exact PE1 (1.1.1.1) / PE2 (4.4.4.4) loopbacks from the
 * MPLS L3VPN lesson for the VPNv4-through-an-RR tie-in section, but —
 * consistent with the project convention that scenario files stay
 * fully self-contained — does not import that file; the handful of
 * matching constants are simply redefined here.
 *
 * Explicitly deferred (introductory only): BGP confederations, full
 * RR redundancy/design variations beyond the two-cluster example,
 * add-path, ORR, shadow RRs, RFC 4456 corner cases.
 */

export type RouterId = "PE1" | "PE2" | "PE3" | "PE4" | "PE5" | "PE6" | "RR1" | "RR2";
export const AS_NUMBER = 65000;

export const ROUTER_IP: Record<RouterId, string> = {
  PE1: "1.1.1.1",
  PE2: "4.4.4.4",
  PE3: "5.5.5.5",
  PE4: "6.6.6.6",
  PE5: "7.7.7.7",
  PE6: "8.8.8.8",
  RR1: "9.9.9.9",
  RR2: "10.10.10.10",
};
export const CLUSTER_ID: Partial<Record<RouterId, string>> = { RR1: "100.100.100.100", RR2: "200.200.200.200" };

export const PREFIX = "10.1.1.0/24";
export const ORIGINATOR: RouterId = "PE1";
export const ORIGIN_LOCAL_PREF = 100;

export const TERMS: { term: string; expansion: string; meaning: string }[] = [
  { term: "iBGP", expansion: "Internal BGP", meaning: "BGP sessions between routers inside the same AS — carries routes, but never crosses an AS boundary." },
  { term: "RR", expansion: "Route Reflector", meaning: "An iBGP speaker permitted to re-advertise (reflect) a route learned from one client to other clients — the one exception to normal iBGP split-horizon." },
  { term: "Client", expansion: "RR Client", meaning: "A router that peers with a Route Reflector and has its routes reflected onward on its behalf." },
  { term: "ORIGINATOR_ID", expansion: "Originator ID", meaning: "The router ID of the route's original source — attached by the first RR to reflect it, so a route can never loop back to its own originator." },
  { term: "CLUSTER_LIST", expansion: "Cluster List", meaning: "Every cluster ID a route has been reflected through — extended by each RR, so a route can never loop back into a cluster it already passed through." },
];

// ---------------------------------------------------------------------------
// Session-scaling calculator — pure, data-driven (brief: "use the
// existing calculator/state logic", not hardcoded numbers in the UI).
// ---------------------------------------------------------------------------

export function fullMeshSessionCount(routerCount: number): number {
  return (routerCount * (routerCount - 1)) / 2;
}

/** Sessions with `rrCount` route reflectors serving `clientCount` clients (each client peers with its own RR only; RRs peer with each other). */
export function rrSessionCount(clientCount: number, rrCount: 1 | 2): number {
  return clientCount + (rrCount === 2 ? 1 : 0);
}

export const SCALE_EXAMPLES = [4, 10, 50, 100];

// ---------------------------------------------------------------------------
// RR design — which router is whose client, and which RRs peer as
// ordinary (non-client) iBGP.
// ---------------------------------------------------------------------------

export interface RrDesign {
  mode: "fullmesh" | "singlerr" | "tworr";
  /** RR id -> its client router ids */
  clients: Partial<Record<RouterId, RouterId[]>>;
  /** RR id -> its ordinary (non-client) iBGP peer router ids */
  peers: Partial<Record<RouterId, RouterId[]>>;
}

export const FULL_MESH_DESIGN: RrDesign = { mode: "fullmesh", clients: {}, peers: {} };
export const SINGLE_RR_DESIGN: RrDesign = { mode: "singlerr", clients: { RR1: ["PE1", "PE2", "PE3", "PE4"] }, peers: {} };
export const TWO_RR_DESIGN: RrDesign = {
  mode: "tworr",
  clients: { RR1: ["PE1", "PE2"], RR2: ["PE3", "PE4"] },
  peers: { RR1: ["RR2"], RR2: ["RR1"] },
};
/** The fault: PE3 downgraded from RR2's client to an ordinary (non-client) peer. */
export const TWO_RR_DESIGN_FAULTY: RrDesign = {
  mode: "tworr",
  clients: { RR1: ["PE1", "PE2"], RR2: ["PE4"] },
  peers: { RR1: ["RR2"], RR2: ["RR1", "PE3"] },
};

// ---------------------------------------------------------------------------
// Route model
// ---------------------------------------------------------------------------

export interface RrRoute {
  prefix: string;
  originator: RouterId;
  originatorId: string;
  nextHop: string;
  localPref: number;
}

export interface ReceivedRoute {
  route: RrRoute;
  clusterList: string[];
  receivedFrom: RouterId;
  viaReflection: boolean;
}

export function originateRoute(): RrRoute {
  return { prefix: PREFIX, originator: ORIGINATOR, originatorId: ROUTER_IP[ORIGINATOR], nextHop: ROUTER_IP[ORIGINATOR], localPref: ORIGIN_LOCAL_PREF };
}

function receiveDirect(route: RrRoute, from: RouterId): ReceivedRoute {
  return { route, clusterList: [], receivedFrom: from, viaReflection: false };
}

/** First reflection: the reflecting RR attaches its own cluster id. */
function reflectFirstHop(route: RrRoute, viaRr: RouterId): ReceivedRoute {
  return { route, clusterList: [CLUSTER_ID[viaRr]!], receivedFrom: viaRr, viaReflection: true };
}

/** A route that's already been reflected once, now reflected again by a second RR — the new cluster id is appended, not replaced. */
function reflectAgain(prior: ReceivedRoute, viaRr: RouterId): ReceivedRoute {
  return { ...prior, clusterList: [...prior.clusterList, CLUSTER_ID[viaRr]!], receivedFrom: viaRr };
}

// ---------------------------------------------------------------------------
// Engineer Challenge validation — given a candidate 6-PE design, does
// it actually work? Pure function, no React, no hardcoded "option C is
// correct" — the engine checks the design's own properties.
// ---------------------------------------------------------------------------

export const CHALLENGE_PES: RouterId[] = ["PE1", "PE2", "PE3", "PE4", "PE5", "PE6"];

export interface ChallengeCheck {
  allRoutesDistributed: boolean;
  noMissingClientRoutes: boolean;
  noReflectionLoop: boolean;
  sessionCountReduced: boolean;
  sessionCount: number;
}

export function validateChallengeDesign(design: RrDesign): ChallengeCheck {
  const rrIds = Object.keys(design.clients) as RouterId[];
  const allClients = rrIds.flatMap((rr) => design.clients[rr] ?? []);
  const coversEveryPe = CHALLENGE_PES.every((pe) => allClients.includes(pe));

  // Every RR must be reachable from every other RR (directly peered, or
  // there's only one RR) for a client of one RR to ever learn a route
  // originated behind another RR — otherwise clusters are isolated.
  const rrsFullyConnected = rrIds.length <= 1 || rrIds.every((a) => rrIds.every((b) => a === b || (design.peers[a] ?? []).includes(b)));

  // A route from a client of RR-a only propagates to clients of RR-b if
  // RR-a and RR-b actually peer as (non-client) iBGP — never through a
  // chain, since RRs don't re-reflect non-client-learned routes to
  // other non-clients (that would defeat split-horizon and loop).
  const noIsolatedCluster = rrIds.length <= 1 || rrIds.every((rr) => (design.peers[rr] ?? []).length >= rrIds.length - 1);

  let sessions = 0;
  for (const rr of rrIds) sessions += (design.clients[rr] ?? []).length;
  const peerPairsSeen = new Set<string>();
  for (const rr of rrIds) {
    for (const peer of design.peers[rr] ?? []) {
      const key = [rr, peer].sort().join("-");
      peerPairsSeen.add(key);
    }
  }
  sessions += peerPairsSeen.size;

  const fullMesh = fullMeshSessionCount(CHALLENGE_PES.length);

  return {
    allRoutesDistributed: coversEveryPe && rrsFullyConnected && noIsolatedCluster,
    noMissingClientRoutes: coversEveryPe,
    noReflectionLoop: rrIds.length <= 2, // introductory scope: 2-RR redundancy never loops (no client is dual-homed to both RRs here)
    sessionCountReduced: sessions < fullMesh,
    sessionCount: sessions,
  };
}

// ---------------------------------------------------------------------------
// Graph layout helpers — generic, not hardcoded per topology, so the
// same helper renders the 4-PE and 10-PE "how messy does this get"
// full meshes and the 6-PE challenge topology.
// ---------------------------------------------------------------------------

export interface GNode {
  id: string;
  label: string;
  x: number;
  y: number;
  subLabel?: string;
}
export interface GEdge {
  id: string;
  a: string;
  b: string;
  label?: string;
}

function circleNodes(ids: RouterId[], cx: number, cy: number, r: number): GNode[] {
  return ids.map((id, i) => {
    const angle = (i / ids.length) * 2 * Math.PI - Math.PI / 2;
    return { id, label: id, x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle), subLabel: ROUTER_IP[id] };
  });
}

function fullMeshEdges(ids: RouterId[]): GEdge[] {
  const edges: GEdge[] = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      edges.push({ id: `${ids[i]}-${ids[j]}`, a: ids[i], b: ids[j], label: "iBGP" });
    }
  }
  return edges;
}

export const FULLMESH_4_NODES = circleNodes(["PE1", "PE2", "PE3", "PE4"], 50, 50, 38);
export const FULLMESH_4_EDGES = fullMeshEdges(["PE1", "PE2", "PE3", "PE4"]);

/** Purely illustrative "how messy does this get" demo — not tied to any real router, so it isn't RouterId-based like the rest of the topologies. */
function demoCircleNodes(count: number, cx: number, cy: number, r: number): GNode[] {
  return Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * 2 * Math.PI - Math.PI / 2;
    return { id: `demo-${i}`, label: `R${i + 1}`, x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  });
}
function demoFullMeshEdges(nodes: GNode[]): GEdge[] {
  const edges: GEdge[] = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      edges.push({ id: `demo-${i}-${j}`, a: nodes[i].id, b: nodes[j].id });
    }
  }
  return edges;
}

export const FULLMESH_10_NODES = demoCircleNodes(10, 50, 50, 42);
export const FULLMESH_10_EDGES = demoFullMeshEdges(FULLMESH_10_NODES);

export const SINGLE_RR_NODES: GNode[] = [
  { id: "RR1", label: "RR1", x: 50, y: 18, subLabel: `${ROUTER_IP.RR1} · Cluster ${CLUSTER_ID.RR1}` },
  { id: "PE1", label: "PE1", x: 14, y: 72, subLabel: ROUTER_IP.PE1 },
  { id: "PE2", label: "PE2", x: 38, y: 88, subLabel: ROUTER_IP.PE2 },
  { id: "PE3", label: "PE3", x: 62, y: 88, subLabel: ROUTER_IP.PE3 },
  { id: "PE4", label: "PE4", x: 86, y: 72, subLabel: ROUTER_IP.PE4 },
];
export const SINGLE_RR_EDGES: GEdge[] = [
  { id: "RR1-PE1", a: "RR1", b: "PE1", label: "client" },
  { id: "RR1-PE2", a: "RR1", b: "PE2", label: "client" },
  { id: "RR1-PE3", a: "RR1", b: "PE3", label: "client" },
  { id: "RR1-PE4", a: "RR1", b: "PE4", label: "client" },
];

export interface GRegion {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  tone?: "cyan" | "violet" | "warning" | "muted";
}

/** One cluster, one region box (brief §11: "route reflection creates a topology that is no longer the simple full mesh") — SINGLE_RR_NODES all belong to the one cluster RR1 forms. */
export const SINGLE_RR_REGIONS: GRegion[] = [{ id: "cluster-rr1", label: `Cluster ${CLUSTER_ID.RR1}`, x: 6, y: 6, width: 88, height: 90, tone: "violet" }];

/** Two clusters — same box shape for the healthy and PE3-faulty topologies, since the fault changes PE3's client/peer RELATIONSHIP, not its physical position. */
export const TWO_RR_REGIONS: GRegion[] = [
  { id: "cluster-rr1", label: `Cluster ${CLUSTER_ID.RR1}`, x: 3, y: 6, width: 40, height: 90, tone: "cyan" },
  { id: "cluster-rr2", label: `Cluster ${CLUSTER_ID.RR2}`, x: 57, y: 6, width: 40, height: 90, tone: "violet" },
];

export const CHALLENGE_TWORR_REGIONS: GRegion[] = [
  { id: "cluster-rr1", label: `Cluster (RR1)`, x: 1, y: 5, width: 50, height: 90, tone: "cyan" },
  { id: "cluster-rr2", label: `Cluster (RR2)`, x: 49, y: 5, width: 50, height: 90, tone: "violet" },
];

export const TWO_RR_NODES: GNode[] = [
  { id: "RR1", label: "RR1", x: 28, y: 18, subLabel: `${ROUTER_IP.RR1} · Cluster ${CLUSTER_ID.RR1}` },
  { id: "RR2", label: "RR2", x: 72, y: 18, subLabel: `${ROUTER_IP.RR2} · Cluster ${CLUSTER_ID.RR2}` },
  { id: "PE1", label: "PE1", x: 10, y: 72, subLabel: ROUTER_IP.PE1 },
  { id: "PE2", label: "PE2", x: 34, y: 88, subLabel: ROUTER_IP.PE2 },
  { id: "PE3", label: "PE3", x: 66, y: 88, subLabel: ROUTER_IP.PE3 },
  { id: "PE4", label: "PE4", x: 90, y: 72, subLabel: ROUTER_IP.PE4 },
];
export const TWO_RR_EDGES: GEdge[] = [
  { id: "RR1-RR2", a: "RR1", b: "RR2", label: "iBGP (peer)" },
  { id: "RR1-PE1", a: "RR1", b: "PE1", label: "client" },
  { id: "RR1-PE2", a: "RR1", b: "PE2", label: "client" },
  { id: "RR2-PE3", a: "RR2", b: "PE3", label: "client" },
  { id: "RR2-PE4", a: "RR2", b: "PE4", label: "client" },
];
export const TWO_RR_EDGES_FAULTY: GEdge[] = [
  { id: "RR1-RR2", a: "RR1", b: "RR2", label: "iBGP (peer)" },
  { id: "RR1-PE1", a: "RR1", b: "PE1", label: "client" },
  { id: "RR1-PE2", a: "RR1", b: "PE2", label: "client" },
  { id: "RR2-PE3", a: "RR2", b: "PE3", label: "peer (!)" },
  { id: "RR2-PE4", a: "RR2", b: "PE4", label: "client" },
];

export const CHALLENGE_FULLMESH_NODES = circleNodes(CHALLENGE_PES, 50, 50, 40);
export const CHALLENGE_FULLMESH_EDGES = fullMeshEdges(CHALLENGE_PES);

export const CHALLENGE_TWORR_NODES: GNode[] = [
  { id: "RR1", label: "RR1", x: 28, y: 15, subLabel: ROUTER_IP.RR1 },
  { id: "RR2", label: "RR2", x: 72, y: 15, subLabel: ROUTER_IP.RR2 },
  { id: "PE1", label: "PE1", x: 6, y: 65, subLabel: ROUTER_IP.PE1 },
  { id: "PE2", label: "PE2", x: 28, y: 88, subLabel: ROUTER_IP.PE2 },
  { id: "PE3", label: "PE3", x: 50, y: 65, subLabel: ROUTER_IP.PE3 },
  { id: "PE4", label: "PE4", x: 50, y: 35, subLabel: ROUTER_IP.PE4 },
  { id: "PE5", label: "PE5", x: 72, y: 88, subLabel: ROUTER_IP.PE5 },
  { id: "PE6", label: "PE6", x: 94, y: 65, subLabel: ROUTER_IP.PE6 },
];
export const CHALLENGE_TWORR_EDGES: GEdge[] = [
  { id: "RR1-RR2", a: "RR1", b: "RR2", label: "iBGP (peer)" },
  { id: "RR1-PE1", a: "RR1", b: "PE1", label: "client" },
  { id: "RR1-PE2", a: "RR1", b: "PE2", label: "client" },
  { id: "RR1-PE3", a: "RR1", b: "PE3", label: "client" },
  { id: "RR2-PE4", a: "RR2", b: "PE4", label: "client" },
  { id: "RR2-PE5", a: "RR2", b: "PE5", label: "client" },
  { id: "RR2-PE6", a: "RR2", b: "PE6", label: "client" },
];
export const CHALLENGE_TWORR_DESIGN: RrDesign = {
  mode: "tworr",
  clients: { RR1: ["PE1", "PE2", "PE3"], RR2: ["PE4", "PE5", "PE6"] },
  peers: { RR1: ["RR2"], RR2: ["RR1"] },
};

// ---------------------------------------------------------------------------
// VPNv4-through-an-RR tie-in — reuses the exact RD/RT/prefix/VPN-label
// values from the MPLS L3VPN lesson's PE2->PE1 route, so a learner who
// took that lesson recognizes it immediately. Locally redefined, not
// imported — scenario files stay self-contained (see mplsL3vpn.ts).
// ---------------------------------------------------------------------------

export const VPNV4_RD = "65001:102";
export const VPNV4_RT = "65001:100";
export const VPNV4_PREFIX = "10.2.2.0/24";
export const VPNV4_LABEL = 24002;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface RrState {
  design: RrDesign;
  route?: RrRoute;
  received: Partial<Record<RouterId, ReceivedRoute>>;
  pipelineStage: string;
  journey: { router: string; action: string; output: string }[];
  splitHorizonDemoed: boolean;
  faultActive: boolean;
  repairAttempt?: { choice: string; correct: boolean };
  challengeChoice?: string;
  challengeSucceeded?: boolean;
  challengeCheck?: ChallengeCheck;
}

export function createRrState(): RrState {
  return {
    design: FULL_MESH_DESIGN,
    received: {},
    pipelineStage: "",
    journey: [],
    splitHorizonDemoed: false,
    faultActive: false,
  };
}

export const PIPELINE_STAGES = ["ROUTE RECEIVED", "BEST PATH SELECTED", "REFLECTION DECISION", "ROUTE REFLECTED"];

// ---------------------------------------------------------------------------
// Packet builders
// ---------------------------------------------------------------------------

function originAttrsLayer(route: RrRoute): PacketLayer {
  return {
    name: "BGP UPDATE (origin attributes)",
    color: "var(--pv-proto-bgp)",
    fields: [
      { label: "Message Type", value: "UPDATE" },
      { label: "PREFIX", value: route.prefix },
      { label: "NEXT_HOP", value: route.nextHop },
      { label: "LOCAL_PREF", value: String(route.localPref) },
    ],
  };
}

function rrAttrsLayer(clusterList: string[], originatorId: string): PacketLayer {
  return {
    name: "BGP UPDATE (RR attributes)",
    color: "var(--pv-proto-violet, #a78bfa)",
    fields: [
      { label: "ORIGINATOR_ID", value: originatorId },
      { label: "CLUSTER_LIST", value: clusterList.length ? clusterList.join(", ") : "(none yet)" },
    ],
  };
}

function bgpUpdatePacket(id: string, from: RouterId, to: RouterId, summary: string, layers: PacketLayer[]): PacketVisual {
  return { id, protocol: "BGP", from, to, summary, badge: "UPDATE", layers };
}

/** X-ray helper: index of the RR-attributes layer, if present (mirrors transportLayerIndex/vpnLayerIndex in the MPLS L3VPN lesson). */
export function rrAttrsLayerIndex(packet: PacketVisual | undefined): number[] | undefined {
  if (!packet) return undefined;
  const i = packet.layers.findIndex((l) => l.name === "BGP UPDATE (RR attributes)");
  return i === -1 ? undefined : [i];
}
export function originAttrsLayerIndex(packet: PacketVisual | undefined): number[] | undefined {
  if (!packet) return undefined;
  const i = packet.layers.findIndex((l) => l.name === "BGP UPDATE (origin attributes)");
  return i === -1 ? undefined : [i];
}

// ---------------------------------------------------------------------------
// Scenario steps
// ---------------------------------------------------------------------------

export const rrSteps: ScenarioStep<RrState>[] = [
  {
    id: "intro",
    label: "Mission Briefing",
    narrative:
      "Four PE routers — PE1 through PE4 — all sit inside the same provider AS, 65000. Right now they run iBGP in a full mesh: every PE has a direct BGP session to every other PE. It works. The question this lesson answers is what happens as the provider adds more PEs.",
  },
  {
    id: "show-fullmesh",
    label: "Full Mesh iBGP",
    narrative: "Here's the full mesh: PE1, PE2, PE3, PE4, each peered directly with the other three. No missing links, no gaps — every PE learns every other PE's routes directly.",
  },
  {
    id: "predict-session-count-4",
    label: "Predict",
    narrative: "Count the lines in that diagram.",
    question: {
      prompt: "With 4 routers in a full mesh, how many iBGP sessions exist in total?",
      options: [
        { id: "4", label: "4" },
        { id: "6", label: "6" },
        { id: "8", label: "8" },
        { id: "12", label: "12" },
      ],
      correctOptionId: "6",
      explanation: "Full-mesh sessions follow n(n-1)/2: 4×3/2 = 6. Each router needs a session to every OTHER router, and each session is counted once, not twice.",
    },
  },
  {
    id: "scale-demo",
    label: "Now Watch It Grow",
    narrative: "10 routers, same full-mesh rule. Every one of them peered with every other one.",
  },
  {
    id: "predict-session-count-10",
    label: "Predict",
    narrative: "Apply the same formula.",
    question: {
      prompt: "How many iBGP sessions does a 10-router full mesh require?",
      options: [
        { id: "20", label: "20" },
        { id: "45", label: "45" },
        { id: "90", label: "90" },
        { id: "100", label: "100" },
      ],
      correctOptionId: "45",
      explanation: "10×9/2 = 45. Look at how much messier that diagram got for just 6 more routers — and every one of those 45 sessions is a real, individually-configured, individually-monitored iBGP peering.",
    },
  },
  {
    id: "scale-table",
    label: "This Does Not Scale Linearly",
    narrative:
      "4 routers → 6 sessions. 10 routers → 45 sessions. 50 routers → 1,225 sessions. 100 routers → 4,950 sessions. Every single router carries a full BGP session to every other router — and every one of those sessions is configuration, memory, CPU, and a monitoring alert waiting to fire.",
  },
  {
    id: "predict-scale-problem",
    label: "Predict",
    narrative: "Before naming the solution:",
    question: {
      prompt: "How can a service provider scale iBGP without a full mesh between every PE?",
      options: [
        { id: "ebgp-everywhere", label: "Convert every iBGP session to eBGP" },
        { id: "redistribute-igp", label: "Redistribute BGP routes into the IGP instead" },
        { id: "rr", label: "Introduce a Route Reflector that other routers peer with instead of each other" },
        { id: "static", label: "Replace BGP with static routes between PEs" },
      ],
      correctOptionId: "rr",
      explanation:
        "A Route Reflector lets PE routers peer with ONE central router (or a small number of them) instead of with each other — the RR takes on the job of re-advertising routes between its clients, replacing most of the full mesh with a hub-and-spoke design.",
    },
  },
  {
    id: "ibgp-share-intro",
    label: "First, The Rule It Bends",
    narrative: "Before introducing the Route Reflector, watch what ordinary iBGP does today. PE1 advertises 10.1.1.0/24 to PE2 over their direct iBGP session.",
    packet: () => bgpUpdatePacket("pe1-pe2-update", "PE1", "PE2", "UPDATE — 10.1.1.0/24", [originAttrsLayer(originateRoute())]),
    run: (state) => ({
      state: { ...state, route: originateRoute(), received: { ...state.received, PE1: receiveDirect(originateRoute(), "PE1"), PE2: receiveDirect(originateRoute(), "PE1") } },
      events: [
        { type: "BGP_UPDATE_SENT", stepId: "ibgp-share-intro", timestamp: Date.now(), message: "PE1 advertises 10.1.1.0/24 to PE2 via iBGP" },
        { type: "BGP_ROUTE_RECEIVED", stepId: "ibgp-share-intro", timestamp: Date.now(), message: "PE2 receives 10.1.1.0/24" },
      ],
    }),
    whatChanged: () => ["PE2 BGP table: +10.1.1.0/24 (received from PE1, iBGP)"],
  },
  {
    id: "predict-split-horizon",
    label: "Predict",
    narrative: "PE2 now holds this route, learned over iBGP.",
    question: {
      prompt: "Can PE2 re-advertise this iBGP-learned route to PE3, another ordinary iBGP peer?",
      options: [
        { id: "yes", label: "Yes — BGP always re-advertises what it learns" },
        { id: "no", label: "No — not to another ordinary iBGP peer" },
        { id: "only-ebgp", label: "Only if PE3 is an eBGP peer" },
        { id: "yes-with-med", label: "Yes, but only with MED attached" },
      ],
      correctOptionId: "no",
      explanation:
        "This is the iBGP split-horizon rule: a route learned from one iBGP peer is never re-advertised to another iBGP peer. It exists to prevent loops — without it, a route could bounce endlessly around a mesh of internal routers.",
    },
  },
  {
    id: "show-split-horizon-blocked",
    label: "Split Horizon In Action",
    narrative: "PE2 does not forward the route to PE3. PE1 → PE2 → ✕ → PE3. If PE3 needs this route, it needs its OWN direct session — which is exactly why full mesh exists in the first place.",
    run: (state) => ({
      state,
      events: [{ type: "BGP_IBGP_SPLIT_HORIZON_BLOCKED", stepId: "show-split-horizon-blocked", timestamp: Date.now(), message: "PE2 does not re-advertise the iBGP-learned route to PE3" }],
    }),
    whatChanged: () => ["PE2 → PE3: blocked by iBGP split-horizon (no re-advertisement)"],
  },
  {
    id: "why-split-horizon",
    label: "The Tension",
    narrative:
      "Split-horizon prevents loops — but it's exactly why every PE needs a direct session to every other PE. Break the full mesh without another mechanism, and routes stop propagating. A Route Reflector is that other mechanism: a designated router that IS allowed to bend this rule, for its clients only.",
  },
  {
    id: "introduce-rr",
    label: "Introduce The Route Reflector",
    narrative:
      "Same 4 PE routers, same AS 65000 — but now RR1 sits in the middle. PE1 through PE4 each peer only with RR1, not with each other. RR1 = Route Reflector. PE1–PE4 = RR Clients.",
    run: (state) => ({
      state: { ...state, design: SINGLE_RR_DESIGN },
      events: [{ type: "BGP_RR_CLIENT_ADDED", stepId: "introduce-rr", timestamp: Date.now(), message: "RR1 configured with clients PE1, PE2, PE3, PE4" }],
    }),
    whatChanged: () => ["Topology: full mesh (6 sessions) → RR1 + 4 clients (4 sessions)"],
  },
  {
    id: "predict-rr-is-bgp",
    label: "Predict",
    narrative: "Be precise about what changed.",
    question: {
      prompt: "Is a Route Reflector a different routing protocol from BGP?",
      options: [
        { id: "yes-new-protocol", label: "Yes — it's a separate control-plane protocol" },
        { id: "no-still-bgp", label: "No — it's still BGP/iBGP, just with a re-advertisement exception" },
        { id: "yes-ospf-extension", label: "Yes — it's an OSPF extension" },
        { id: "sometimes", label: "Sometimes, depending on vendor" },
      ],
      correctOptionId: "no-still-bgp",
      explanation:
        "A Route Reflector is not a new protocol, a new message type, or a new session type — it's an ordinary iBGP speaker configured with one extra behavior: routes learned from a client CAN be reflected to other clients (and to non-client peers), bending the normal split-horizon rule just for that router.",
    },
  },
  {
    id: "pe1-advertises-rr",
    label: "PE1 → RR1: UPDATE",
    narrative: "PE1 advertises 10.1.1.0/24 to RR1, exactly like any other iBGP UPDATE — PREFIX, NEXT_HOP, LOCAL_PREF. Nothing RR-specific yet.",
    packet: () => bgpUpdatePacket("pe1-rr1-update", "PE1", "RR1", "UPDATE — 10.1.1.0/24", [originAttrsLayer(originateRoute())]),
    run: (state) => ({
      state: { ...state, route: originateRoute(), received: { PE1: receiveDirect(originateRoute(), "PE1") }, pipelineStage: "" },
      events: [{ type: "BGP_UPDATE_SENT", stepId: "pe1-advertises-rr", timestamp: Date.now(), message: "PE1 advertises 10.1.1.0/24 to RR1" }],
    }),
  },
  {
    id: "rr-receives",
    label: "RR1: Route Received",
    narrative: "RR1 receives the UPDATE from PE1 — a client — and adds it to its BGP table.",
    run: (state) => ({
      state: { ...state, received: { ...state.received, RR1: receiveDirect(state.route ?? originateRoute(), "PE1") }, pipelineStage: "ROUTE RECEIVED" },
      events: [{ type: "BGP_ROUTE_RECEIVED", stepId: "rr-receives", timestamp: Date.now(), message: "RR1 receives 10.1.1.0/24 from client PE1" }],
    }),
  },
  {
    id: "rr-bestpath",
    label: "RR1: Best Path Selected",
    narrative: "RR1 runs the normal BGP best-path process. With only one candidate path so far, it's trivially the best.",
    run: (state) => ({
      state: { ...state, pipelineStage: "BEST PATH SELECTED" },
      events: [{ type: "BGP_PATH_EVALUATED", stepId: "rr-bestpath", timestamp: Date.now(), message: "RR1 selects PE1's path as best (only candidate)" }],
    }),
  },
  {
    id: "rr-reflection-decision",
    label: "RR1: Reflection Decision",
    narrative: "This is the step an ordinary iBGP router doesn't have. RR1 checks: this route came from a CLIENT (PE1). The rule for client-learned routes: reflect to every other client, and to every non-client peer too.",
    run: (state) => ({
      state: { ...state, pipelineStage: "REFLECTION DECISION", journey: [...state.journey, { router: "RR1", action: "DECIDE", output: "Client-learned → reflect to PE2, PE3, PE4" }] },
      events: [{ type: "BGP_PATH_EVALUATED", stepId: "rr-reflection-decision", timestamp: Date.now(), message: "RR1: route from client PE1 → reflect to all other clients" }],
    }),
  },
  {
    id: "rr-reflects",
    label: "RR1: Route Reflected",
    narrative: "RR1 reflects the route to PE2, PE3, and PE4 — and before sending, attaches two new attributes: ORIGINATOR_ID (PE1's router ID) and CLUSTER_LIST (RR1's own cluster ID).",
    packet: (state) => {
      const route = state.route ?? originateRoute();
      const reflected = reflectFirstHop(route, "RR1");
      return bgpUpdatePacket("rr1-reflect", "RR1", "PE2", "UPDATE (reflected) — 10.1.1.0/24", [originAttrsLayer(route), rrAttrsLayer(reflected.clusterList, route.originatorId)]);
    },
    run: (state) => {
      const route = { ...(state.route ?? originateRoute()), originatorId: ROUTER_IP.PE1 };
      const reflected = reflectFirstHop(route, "RR1");
      return {
        state: {
          ...state,
          route,
          pipelineStage: "ROUTE REFLECTED",
          received: { ...state.received, PE2: reflected, PE3: reflected, PE4: reflected },
          journey: [...state.journey, { router: "RR1", action: "REFLECT", output: "→ PE2, PE3, PE4" }],
        },
        events: [
          { type: "BGP_ORIGINATOR_ID_SET", stepId: "rr-reflects", timestamp: Date.now(), message: `RR1 sets ORIGINATOR_ID = ${ROUTER_IP.PE1}` },
          { type: "BGP_CLUSTER_LIST_UPDATED", stepId: "rr-reflects", timestamp: Date.now(), message: `RR1 adds cluster ${CLUSTER_ID.RR1} to CLUSTER_LIST` },
          { type: "BGP_ROUTE_REFLECTED", stepId: "rr-reflects", timestamp: Date.now(), message: "RR1 reflects 10.1.1.0/24 to PE2, PE3, PE4" },
        ],
      };
    },
    whatChanged: () => ["PE2, PE3, PE4 BGP table: +10.1.1.0/24 (reflected)", `ORIGINATOR_ID: ${ROUTER_IP.PE1}`, `CLUSTER_LIST: ${CLUSTER_ID.RR1}`],
  },
  {
    id: "predict-what-rr-added",
    label: "Predict",
    narrative: "Compare the UPDATE PE1 sent with the UPDATE RR1 reflected.",
    question: {
      prompt: "What did RR1 add before reflecting the route?",
      options: [
        { id: "originator-cluster", label: "ORIGINATOR_ID and CLUSTER_LIST" },
        { id: "new-nexthop", label: "A new NEXT_HOP pointing at RR1 itself" },
        { id: "higher-localpref", label: "A higher LOCAL_PREF" },
        { id: "as-path", label: "An AS_PATH hop for AS 65000" },
      ],
      correctOptionId: "originator-cluster",
      explanation:
        "By default, an RR does NOT rewrite NEXT_HOP (unlike an eBGP router) and does not touch LOCAL_PREF — it only adds ORIGINATOR_ID (on first reflection) and appends its own cluster ID to CLUSTER_LIST. Since this is iBGP inside one AS, there's no AS_PATH hop to add either.",
    },
  },
  {
    id: "rule-client-to-rr",
    label: "Rule 1: Client → RR",
    narrative: "A client sends its routes to the RR exactly like any iBGP peer — nothing special on this side.",
  },
  {
    id: "rule-rr-to-client",
    label: "Rule 2: RR → Client",
    narrative: "A route learned from ANY source — client or non-client — is reflected to all other clients. Clients always get the full picture.",
  },
  {
    id: "rule-nonclient-to-rr",
    label: "Rule 3: Non-Client → RR",
    narrative: "An ordinary (non-client) iBGP peer sends routes to the RR exactly like normal iBGP — again, nothing special here.",
  },
  {
    id: "rule-rr-to-nonclient",
    label: "Rule 4: RR → Non-Client (the subtle one)",
    narrative:
      "A route learned from a CLIENT is reflected to non-client peers too — the RR is acting as that client's proxy into the rest of the mesh. But a route learned from a NON-CLIENT peer is only reflected to CLIENTS, never to another non-client peer. That second half is still ordinary iBGP split-horizon, just seen from the RR's side of a non-client session.",
  },
  {
    id: "predict-rule-client-reflected",
    label: "Predict",
    narrative: "PE1 (a client of RR1) sends a route to RR1.",
    question: {
      prompt: "Will RR1 reflect that route to PE4, also a client of RR1?",
      options: [
        { id: "yes", label: "Yes — client-learned routes reflect to all other clients" },
        { id: "no", label: "No — split-horizon blocks it" },
        { id: "only-if-lower-id", label: "Only if PE4's router ID is lower than PE1's" },
        { id: "only-nonclient", label: "Only if PE4 were a non-client" },
      ],
      correctOptionId: "yes",
      explanation: "This is Rule 2 in action: any route the RR holds — including one just learned from a client — is reflected to every OTHER client. That's the entire point of a Route Reflector.",
    },
  },
  {
    id: "predict-rule-nonclient-to-client",
    label: "Predict",
    narrative: "RR1 receives a route from RR2 — an ordinary (non-client) iBGP peer, not a client.",
    question: {
      prompt: "Will RR1 reflect that non-client-learned route to PE1, one of its clients?",
      options: [
        { id: "yes", label: "Yes — non-client-learned routes are still reflected to clients" },
        { id: "no", label: "No — only client-learned routes get reflected at all" },
        { id: "only-static", label: "Only if RR1 originates it as static" },
        { id: "never-to-clients", label: "Never — clients only see client-learned routes" },
      ],
      correctOptionId: "yes",
      explanation: "Rule 2 doesn't care where the route came from — client or non-client — clients always receive everything the RR holds. That's what lets a client stay fully meshed with the rest of the network through just one session.",
    },
  },
  {
    id: "predict-rule-nonclient-to-nonclient",
    label: "Predict",
    narrative: "RR1 receives that same route from RR2, a non-client peer.",
    question: {
      prompt: "Will RR1 reflect it to X, ANOTHER non-client iBGP peer?",
      options: [
        { id: "yes", label: "Yes — the RR always reflects everything it has" },
        { id: "no", label: "No — non-client-learned routes are never reflected to other non-client peers" },
        { id: "only-lower-pref", label: "Only if LOCAL_PREF is lower" },
        { id: "depends-cluster", label: "Depends on CLUSTER_LIST length" },
      ],
      correctOptionId: "no",
      explanation:
        "This is the rule that's easy to forget: between two non-client peers, RR1 behaves like any ordinary iBGP router — split-horizon still applies. Reflection only bends the rule FOR clients, never between two ordinary peers.",
    },
  },
  {
    id: "originator-id-explain",
    label: "ORIGINATOR_ID",
    narrative: `PE1 originated this route — its router ID is ${ROUTER_IP.PE1}. The moment RR1 reflects it, RR1 stamps ORIGINATOR_ID = ${ROUTER_IP.PE1} onto the route.`,
  },
  {
    id: "predict-originator-id-purpose",
    label: "Predict",
    narrative: "Think about what could go wrong in a redundant RR design without this field.",
    question: {
      prompt: "What does ORIGINATOR_ID actually prevent?",
      options: [
        { id: "loops", label: "A route looping back to and being re-accepted by its own originator" },
        { id: "encryption", label: "It encrypts the route for transport" },
        { id: "localpref", label: "It sets the default LOCAL_PREF" },
        { id: "session-auth", label: "It authenticates the iBGP session" },
      ],
      correctOptionId: "loops",
      explanation:
        "If a route ever routes back around to the router that originated it — a real risk with redundant RRs — that router checks ORIGINATOR_ID against its own router ID and discards the route instead of re-accepting a copy of what it already originated.",
    },
  },
  {
    id: "cluster-id-explain",
    label: "CLUSTER_ID / CLUSTER_LIST",
    narrative: `RR1 has its own Cluster ID: ${CLUSTER_ID.RR1}. When RR1 reflects a route, it doesn't just pass ORIGINATOR_ID along — it also appends its own Cluster ID to CLUSTER_LIST. Right now CLUSTER_LIST is just [${CLUSTER_ID.RR1}], because the route has only passed through one cluster.`,
  },
  {
    id: "introduce-rr2",
    label: "A Second Route Reflector",
    narrative:
      "For redundancy, real deployments rarely run a single RR — one RR going down would take the whole reflection domain with it. Add RR2, its own cluster (200.200.200.200), with PE3 and PE4 as its clients instead of RR1's. RR1 and RR2 peer with each other as ordinary (non-client) iBGP.",
    run: (state) => ({
      state: { ...state, design: TWO_RR_DESIGN },
      events: [
        { type: "BGP_RR_CLIENT_ADDED", stepId: "introduce-rr2", timestamp: Date.now(), message: "RR2 configured with clients PE3, PE4" },
        { type: "BGP_STATE_CHANGED", stepId: "introduce-rr2", timestamp: Date.now(), message: "RR1 ↔ RR2 iBGP session established (non-client)" },
      ],
    }),
    whatChanged: () => ["RR1 clients: PE1, PE2, PE3, PE4 → PE1, PE2", "RR2 clients: (none) → PE3, PE4", "RR1 ↔ RR2: peered as ordinary iBGP"],
  },
  {
    id: "reflect-through-two-rr",
    label: "The Route Crosses Two Clusters",
    narrative: "PE1's route reaches RR1 (cluster 100.100.100.100) exactly as before. RR1 reflects it to its remaining client PE2, and — because it's client-learned — also to non-client peer RR2. RR2 then reflects it onward to ITS clients, PE3 and PE4, appending its own cluster ID.",
    packet: (state) => {
      const route = { ...(state.route ?? originateRoute()), originatorId: ROUTER_IP.PE1 };
      const afterRr1 = reflectFirstHop(route, "RR1");
      const afterRr2 = reflectAgain(afterRr1, "RR2");
      return bgpUpdatePacket("rr2-reflect", "RR2", "PE3", "UPDATE (double-reflected) — 10.1.1.0/24", [originAttrsLayer(route), rrAttrsLayer(afterRr2.clusterList, route.originatorId)]);
    },
    run: (state) => {
      const route = { ...(state.route ?? originateRoute()), originatorId: ROUTER_IP.PE1 };
      const afterRr1 = reflectFirstHop(route, "RR1");
      const afterRr2 = reflectAgain(afterRr1, "RR2");
      return {
        state: { ...state, received: { PE1: receiveDirect(route, "PE1"), PE2: afterRr1, RR1: afterRr1, RR2: afterRr2, PE3: afterRr2, PE4: afterRr2 }, journey: [...state.journey, { router: "RR2", action: "REFLECT", output: "→ PE3, PE4 (CLUSTER_LIST now 2 entries)" }] },
        events: [
          { type: "BGP_ROUTE_REFLECTED", stepId: "reflect-through-two-rr", timestamp: Date.now(), message: "RR1 reflects to PE2 and non-client peer RR2" },
          { type: "BGP_CLUSTER_LIST_UPDATED", stepId: "reflect-through-two-rr", timestamp: Date.now(), message: `RR2 appends cluster ${CLUSTER_ID.RR2}` },
          { type: "BGP_ROUTE_REFLECTED", stepId: "reflect-through-two-rr", timestamp: Date.now(), message: "RR2 reflects to its clients PE3 and PE4" },
        ],
      };
    },
    whatChanged: (_prev, next) => [`PE3, PE4 CLUSTER_LIST: [${next.received.PE3?.clusterList.join(", ")}]`],
  },
  {
    id: "predict-cluster-list-purpose",
    label: "Predict",
    narrative: "CLUSTER_LIST now holds two entries — one per cluster this route passed through.",
    question: {
      prompt: "What does CLUSTER_LIST protect against, and how is that similar to something you've already learned?",
      options: [
        { id: "loop-like-aspath", label: "Loops between clusters — the same role AS_PATH plays for loops between autonomous systems" },
        { id: "encryption", label: "It's an encryption key for the route" },
        { id: "compression", label: "It compresses the UPDATE message" },
        { id: "qos", label: "It marks the route's QoS priority" },
      ],
      correctOptionId: "loop-like-aspath",
      explanation:
        "If a route's CLUSTER_LIST already contains a cluster's own ID, that cluster's RR discards it rather than re-reflecting it — the same loop-prevention idea as AS_PATH between autonomous systems, just scoped to reflection clusters inside one AS.",
    },
  },
  {
    id: "toggle-intro",
    label: "Full Mesh vs. Route Reflector",
    narrative:
      "Use the toggle above the topology to compare. For this same 4-PE network: full mesh needs 6 sessions. With RR1 and RR2, it needs 5 (2 clients each + the RR1↔RR2 peering) — a small win at 4 routers, but recall the earlier numbers: at 100 routers, full mesh needs 4,950 sessions. A two-RR design needs roughly 100.",
  },
  {
    id: "rr-does-not",
    label: "What A Route Reflector Does NOT Do",
    narrative:
      "A Route Reflector reduces iBGP session-scaling requirements. That's it. It does NOT replace BGP itself, does NOT replace the IGP, does NOT forward MPLS packets, does NOT create or allocate VPN labels, and is NOT part of the customer's L3VPN data connection. It is a control-plane scaling mechanism — nothing more.",
  },
  {
    id: "predict-rr-does-not",
    label: "Predict",
    narrative: "Pick the one TRUE statement about Route Reflectors.",
    question: {
      prompt: "Which statement about Route Reflectors is TRUE?",
      options: [
        { id: "true-scaling", label: "It reduces the number of iBGP sessions a PE needs to maintain" },
        { id: "false-igp", label: "It replaces the IGP" },
        { id: "false-labels", label: "It allocates VPN labels for L3VPN customers" },
        { id: "false-forwards", label: "It forwards customer MPLS packets" },
      ],
      correctOptionId: "true-scaling",
      explanation: "Only the first statement is true. The RR is purely a control-plane scaling mechanism for iBGP — everything else (IGP, label allocation, packet forwarding) belongs to other, unrelated parts of the architecture.",
    },
  },
  {
    id: "reconnect-l3vpn-intro",
    label: "Connecting To MPLS L3VPN",
    narrative: `The MPLS L3VPN lesson showed PE2 advertising a VPNv4 route directly to PE1 over MP-BGP. In a real provider network, PE1 and PE2 don't peer directly at all — they each peer with a Route Reflector instead, exactly like PE1–PE4 do here. Same route, same RD (${VPNV4_RD}), same RT (${VPNV4_RT}), same VPN label (${VPNV4_LABEL}) — just reflected through RR1 instead of sent directly.`,
  },
  {
    id: "vpnv4-through-rr",
    label: "VPNv4 Route, Reflected",
    narrative: `PE2 advertises ${VPNV4_PREFIX} (RD ${VPNV4_RD}, RT ${VPNV4_RT}, VPN label ${VPNV4_LABEL}) to RR1. RR1 reflects the VPNv4 route to PE1 — untouched except for ORIGINATOR_ID and CLUSTER_LIST, exactly like the plain-IPv4 route earlier. RR1 never looks at the RD, the RT, or the VPN label — it just reflects the whole VPNv4 NLRI as one opaque BGP route.`,
    packet: () => bgpUpdatePacket("vpnv4-reflect", "RR1", "PE1", `UPDATE (reflected VPNv4) — ${VPNV4_PREFIX}`, [
      { name: "MP-BGP VPNv4 UPDATE", color: "var(--pv-proto-bgp)", fields: [
        { label: "NLRI (RD:Prefix)", value: `${VPNV4_RD}:${VPNV4_PREFIX}` },
        { label: "Extended Community (RT)", value: VPNV4_RT },
        { label: "NEXT_HOP", value: ROUTER_IP.PE2 },
        { label: "VPN Label", value: String(VPNV4_LABEL) },
      ] },
      rrAttrsLayer([CLUSTER_ID.RR1!], ROUTER_IP.PE2),
    ]),
    run: (state) => ({
      state,
      events: [
        { type: "MPBGP_VPN_ROUTE_ADVERTISED", stepId: "vpnv4-through-rr", timestamp: Date.now(), message: `PE2 advertises ${VPNV4_PREFIX} to RR1` },
        { type: "BGP_ROUTE_REFLECTED", stepId: "vpnv4-through-rr", timestamp: Date.now(), message: `RR1 reflects the VPNv4 route to PE1, untouched except ORIGINATOR_ID/CLUSTER_LIST` },
      ],
    }),
  },
  {
    id: "predict-traffic-through-rr",
    label: "Predict",
    narrative: "The VPNv4 route just traveled PE2 → RR1 → PE1.",
    question: {
      prompt: "Does customer traffic — the actual packets from CE1 to CE2 — pass through the Route Reflector?",
      options: [
        { id: "no", label: "No — not simply because it's the RR" },
        { id: "yes", label: "Yes, every VPN packet transits every RR in the path" },
        { id: "only-first-packet", label: "Only the first packet, to seed the label" },
        { id: "only-if-best-path", label: "Only if the RR is on the IGP best path" },
      ],
      correctOptionId: "no",
      explanation:
        "The RR provided BGP control-plane functionality only — it told PE1 how to reach PE2's route. Data-plane forwarding is a completely separate matter, decided by the MPLS transport LSP (PE1 → P1 → P2 → PE2), which never involves the RR at all.",
    },
  },
  {
    id: "control-vs-data-plane",
    label: "Control Plane vs. Data Plane",
    narrative: "Side by side: the control plane runs through the RR. The data plane does not.",
  },
  {
    id: "fault-intro",
    label: "Something's Wrong",
    narrative: "An engineer reconfigures PE3's session on RR2 — accidentally leaving off the client flag. PE3 is now an ordinary (non-client) iBGP peer of RR2, not a client.",
    run: (state) => ({
      state: { ...state, design: TWO_RR_DESIGN_FAULTY, faultActive: true, received: { PE1: receiveDirect(state.route ?? originateRoute(), "PE1"), PE2: state.received.PE2, RR1: state.received.RR1, RR2: state.received.RR2, PE4: state.received.PE4, PE3: undefined } },
      events: [{ type: "BGP_REFLECTION_REJECTED", stepId: "fault-intro", timestamp: Date.now(), message: "RR2 no longer treats PE3 as a client" }],
    }),
    whatChanged: () => ["RR2's PE3 session: client → ordinary (non-client) peer", "PE3's copy of 10.1.1.0/24: withdrawn"],
  },
  {
    id: "fault-explain",
    label: "Why This Breaks",
    narrative:
      "RR2 still learns the route from RR1 — a non-client peer. Rule 4 says: a route learned from a non-client is reflected to CLIENTS only, never to another non-client peer. PE4 (still a real client) gets it. PE3 — now just another non-client peer, like RR1 — does not. The session is fully up. The route is simply never sent.",
  },
  {
    id: "predict-troubleshoot",
    label: "Troubleshoot",
    narrative: "Interface, IGP, TCP/179, the BGP session itself, and RR2's best-path selection are all healthy. 10.1.1.0/24 is simply missing from PE3's BGP table.",
    question: {
      prompt: "What's actually wrong?",
      options: [
        { id: "session-down", label: "The BGP session between RR2 and PE3 is down" },
        { id: "rr-policy", label: "PE3 is configured as an ordinary peer of RR2, not a client — so non-client-learned routes aren't reflected to it" },
        { id: "igp-broken", label: "The IGP between RR2 and PE3 is broken" },
        { id: "wrong-cluster-id", label: "RR2's Cluster ID is misconfigured" },
      ],
      correctOptionId: "rr-policy",
      explanation:
        "Every layer below RR policy is healthy — that's the point of checking layer by layer. The specific fault is the client relationship: RR2 received this route from a non-client (RR1) and, per the reflection rules, only reflects non-client-learned routes to its CLIENTS. PE3 isn't one right now.",
      hints: [
        "Hint 1: The BGP session to PE3 is Established — don't chase TCP or the interface.",
        "Hint 2: Ask where RR2 learned this specific route FROM — a client, or a peer?",
        "Hint 3: Re-read Rule 4 — what does a non-client-learned route get reflected to?",
      ],
    },
  },
  {
    id: "repair-challenge",
    label: "Apply The Fix",
    narrative: "Choose the correct repair for RR2's session with PE3.",
    action: (state, payload) => {
      const choice = typeof payload === "object" && payload !== null && "choice" in payload ? String((payload as { choice: string }).choice) : "";
      if (choice !== "make-client") {
        return { state: { ...state, repairAttempt: { choice, correct: false } }, events: [] };
      }
      const route = { ...(state.route ?? originateRoute()), originatorId: ROUTER_IP.PE1 };
      const afterRr1 = reflectFirstHop(route, "RR1");
      const afterRr2 = reflectAgain(afterRr1, "RR2");
      return {
        state: { ...state, design: TWO_RR_DESIGN, faultActive: false, repairAttempt: { choice, correct: true }, received: { ...state.received, PE3: afterRr2 } },
        events: [
          { type: "BGP_RR_CLIENT_ADDED", stepId: "repair-challenge", timestamp: Date.now(), message: "PE3 reconfigured as RR2's client" },
          { type: "BGP_ROUTE_REFLECTED", stepId: "repair-challenge", timestamp: Date.now(), message: "RR2 reflects 10.1.1.0/24 to PE3" },
        ],
      };
    },
    requiresState: (state) => state.repairAttempt?.correct === true,
  },
  {
    id: "verify-fix",
    label: "Verify",
    narrative: "PE3 now shows 10.1.1.0/24 in its BGP table, ORIGINATOR_ID and a two-entry CLUSTER_LIST intact — restored purely by fixing the client relationship, nothing else touched.",
    whatChanged: () => ["✓ PE3 reconfigured as RR2 client", "✓ Route reflected to PE3", "✓ RR Policy layer: healthy", "✓ Route Received layer: healthy"],
  },
  {
    id: "challenge-intro",
    label: "Engineer Challenge: Scale The Provider",
    narrative: "The provider now runs 6 PE routers — PE1 through PE6 — still in a full mesh. That's 15 iBGP sessions. Redesign the control plane using Route Reflectors while making sure every PE still learns every other PE's routes.",
    run: (state) => ({
      state: { ...state, design: FULL_MESH_DESIGN, challengeChoice: undefined, challengeSucceeded: false, challengeCheck: undefined },
      events: [{ type: "BGP_POLICY_APPLIED", stepId: "challenge-intro", timestamp: Date.now(), message: "Challenge reset: 6 PE routers, full mesh, 15 sessions" }],
    }),
  },
  {
    id: "challenge-select",
    label: "Choose The Redesign",
    narrative: "Pick a Route Reflector design for the 6-PE network. The engine checks route distribution, client coverage, reflection loops, and session count for whichever one you choose.",
    action: (state, payload) => {
      const choice = typeof payload === "object" && payload !== null && "choice" in payload ? String((payload as { choice: string }).choice) : "";
      let design: RrDesign;
      switch (choice) {
        case "two-rr-peered":
          design = CHALLENGE_TWORR_DESIGN;
          break;
        case "single-rr-all":
          design = { mode: "singlerr", clients: { RR1: CHALLENGE_PES }, peers: {} };
          break;
        case "two-rr-unpeered":
          design = { mode: "tworr", clients: { RR1: ["PE1", "PE2", "PE3"], RR2: ["PE4", "PE5", "PE6"] }, peers: {} };
          break;
        case "no-change":
        default:
          design = FULL_MESH_DESIGN;
          break;
      }
      const check = validateChallengeDesign(design);
      const succeeded = choice === "two-rr-peered" && check.allRoutesDistributed && check.noMissingClientRoutes && check.noReflectionLoop && check.sessionCountReduced;
      return {
        state: { ...state, challengeChoice: choice, challengeCheck: check, challengeSucceeded: succeeded, design: succeeded ? design : state.design },
        events: [{ type: "BGP_POLICY_APPLIED", stepId: "challenge-select", timestamp: Date.now(), message: `Candidate design evaluated: ${choice}` }],
      };
    },
    requiresState: (state) => state.challengeSucceeded === true,
  },
  {
    id: "challenge-complete",
    label: "Challenge Complete",
    narrative: "RR1 (PE1–PE3) and RR2 (PE4–PE6), peered with each other — every PE still reaches every other PE's routes, and the provider went from 15 sessions to 7.",
    whatChanged: () => ["✓ All expected routes distributed", "✓ No missing client routes", "✓ No reflection loop", "✓ Session count: 15 → 7"],
  },
  {
    id: "complete",
    label: "Lesson Complete",
    narrative: "PE3 is back online, the provider's 6-PE network now scales through two redundant Route Reflectors, and every reflected route still carries the ORIGINATOR_ID and CLUSTER_LIST that kept it loop-free the whole way.",
  },
];

// ---------------------------------------------------------------------------
// Read-only CLI panel — output derived live from state.
// ---------------------------------------------------------------------------

export interface CliOutput {
  cmd: string;
  output: string;
}
export interface CliCommandEntry {
  id: string;
  label: string;
  cisco: CliOutput;
  juniper: CliOutput;
}

export function isClientOf(design: RrDesign, rr: RouterId, router: RouterId): boolean {
  return (design.clients[rr] ?? []).includes(router);
}
export function isPeerOf(design: RrDesign, rr: RouterId, router: RouterId): boolean {
  return (design.peers[rr] ?? []).includes(router);
}
/** Every RR this router has a session to, whether as a client or an ordinary peer — a session that exists either way. */
function rrPartnersOf(design: RrDesign, router: RouterId): RouterId[] {
  return (Object.keys(design.clients) as RouterId[]).filter((rr) => rr !== router && (isClientOf(design, rr, router) || isPeerOf(design, rr, router)));
}
function relationshipLabel(design: RrDesign, rr: RouterId, router: RouterId): string {
  return isClientOf(design, rr, router) ? `RR Client of ${rr}` : `Ordinary iBGP peer of ${rr} (not a client)`;
}

// ---------------------------------------------------------------------------
// Reflection-rule engine (brief §8/§9/§22-24) — the SAME four rules the
// scenario steps narrate (rule-client-to-rr / rule-rr-to-client /
// rule-nonclient-to-rr / rule-rr-to-nonclient), expressed as one pure,
// data-driven function so the Reflection Decision Viewer (and the
// troubleshooting diagnostic layers) can compute a real answer for any
// design/router combination instead of a component hardcoding "PE2 is a
// client, PE4 is a client, so reflect" itself.
// ---------------------------------------------------------------------------

export type PeerRelationship = "client" | "non-client";

export function relationshipOf(design: RrDesign, rr: RouterId, router: RouterId): PeerRelationship {
  return isClientOf(design, rr, router) ? "client" : "non-client";
}

/** Which RR (if any) `router` itself has a session to — as a client or as an ordinary peer. Undefined for a router with no RR session in this design (e.g. every PE, in full-mesh mode). */
export function connectedRrOf(design: RrDesign, router: RouterId): RouterId | undefined {
  return (Object.keys(design.clients) as RouterId[]).find((rr) => isClientOf(design, rr, router) || isPeerOf(design, rr, router));
}

export interface ReflectionRuleResult {
  decision: "reflect" | "withhold";
  reason: string;
}

/** The four reflection rules (brief §9), as one function: given the relationship the ROUTE arrived on and the relationship of a CANDIDATE outbound peer, decide reflect vs. withhold. Never special-cases a router name — only relationships. */
export function evaluateReflection(sourceRelationship: PeerRelationship, candidateRelationship: PeerRelationship): ReflectionRuleResult {
  if (sourceRelationship === "client") {
    return candidateRelationship === "client"
      ? { decision: "reflect", reason: "Client-learned routes are reflected to every other client — that's the entire point of a Route Reflector." }
      : { decision: "reflect", reason: "Client-learned routes are also reflected to non-client peers — the RR acts as that client's proxy into the rest of the mesh." };
  }
  return candidateRelationship === "client"
    ? { decision: "reflect", reason: "Non-client-learned routes are still reflected to clients — that's what keeps a client fully meshed through just one session." }
    : { decision: "withhold", reason: "Between two non-client peers, ordinary iBGP split-horizon still applies — a non-client-learned route is never reflected to another non-client." };
}

export interface ReflectionCandidate {
  routerId: RouterId;
  relationship: PeerRelationship;
  decision: "reflect" | "withhold";
  reason: string;
}

/** Every OTHER router `rr` has a session to (its clients + its ordinary peers, excluding the sender itself), each evaluated against the real reflection rules — the data the Reflection Decision Viewer renders (brief §8). Nothing here is hardcoded per router name; it's entirely derived from `design`. */
export function reflectionCandidatesFor(design: RrDesign, rr: RouterId, receivedFromRouter: RouterId): ReflectionCandidate[] {
  const sourceRelationship = relationshipOf(design, rr, receivedFromRouter);
  const others = [...(design.clients[rr] ?? []), ...(design.peers[rr] ?? [])].filter((r) => r !== receivedFromRouter);
  return others.map((routerId) => {
    const relationship = relationshipOf(design, rr, routerId);
    const { decision, reason } = evaluateReflection(sourceRelationship, relationship);
    return { routerId, relationship, decision, reason };
  });
}

// ---------------------------------------------------------------------------
// Session-count scaling graph (brief §20/§21) — a full mesh for ANY
// router count, not just the two fixed 4/10 demos above, so the
// interactive slider can render a real (bounded) 3D mesh and still
// report the exact calculated session count for counts too large to
// sensibly render as individual 3D links.
// ---------------------------------------------------------------------------

/** Upper bound for literally rendering every full-mesh link in 3D — n(n-1)/2 grows too fast to stay legible (or performant) much past this. Counts above it still get an exact `fullMeshSessionCount`, just not a fully-drawn mesh. */
export const MAX_RENDERED_MESH_ROUTERS = 20;

export function scaleMeshGraph(routerCount: number): { nodes: GNode[]; edges: GEdge[] } {
  const nodes = demoCircleNodes(routerCount, 50, 50, Math.min(44, 30 + routerCount));
  return { nodes, edges: demoFullMeshEdges(nodes) };
}

export function buildRrCliCommands(state: RrState, router: RouterId): CliCommandEntry[] {
  const received = state.received[router];
  const isRr = router === "RR1" || router === "RR2";
  const partners = rrPartnersOf(state.design, router);
  /** Every session `router` itself has — its own clients+peers for an RR, or `partners` (the RRs it's a client/peer of) for a PE. `rrPartnersOf` alone would show an RR with zero sessions, since it only ever looks up OTHER routers' relationship to an RR, never an RR's own client/peer lists. */
  const sessionPartners: RouterId[] = isRr ? [...(state.design.clients[router] ?? []), ...(state.design.peers[router] ?? [])] : partners;

  const summaryCisco: CliOutput = {
    cmd: "show bgp ipv4 unicast summary",
    output: `BGP router identifier ${ROUTER_IP[router]}, local AS number ${AS_NUMBER}\n${isRr ? `Route Reflector — Cluster ID ${CLUSTER_ID[router]}` : partners.map((rr) => relationshipLabel(state.design, rr, router)).join("; ") || "(no BGP sessions configured)"}\nNeighbor        V    AS  MsgRcvd  MsgSent  Up/Down  State/PfxRcd\n${sessionPartners
      .map((peer) => `${(ROUTER_IP[peer] + "        ").slice(0, 16)}4  ${AS_NUMBER}      112      109  01:04:22  ${received ? "1" : "0"}`)
      .join("\n") || "(no sessions)"}`,
  };

  const summaryJuniper: CliOutput = { cmd: "show bgp summary", output: summaryCisco.output.replace("show bgp ipv4 unicast summary", "show bgp summary") };

  const routeCisco: CliOutput = {
    cmd: `show bgp ipv4 unicast ${PREFIX.split("/")[0]}`,
    output: !received
      ? "% Network not in table"
      : `BGP routing table entry for ${PREFIX}\n  Local\n    ${received.route.nextHop} from ${received.receivedFrom} (${ROUTER_IP[received.receivedFrom]})\n      Origin IGP, localpref ${received.route.localPref}${received.viaReflection ? ", (Received from a RouteReflector)" : ""}\n      Originator: ${received.route.originatorId}${received.clusterList.length ? `, Cluster list: ${received.clusterList.join(" ")}` : ""}`,
  };
  const routeJuniper: CliOutput = {
    cmd: `show route ${PREFIX.split("/")[0]} extensive`,
    output: !received
      ? "(no matching routes)"
      : `${PREFIX}\n        *BGP    Preference: 170/-101\n                Next hop: ${received.route.nextHop}\n                Localpref: ${received.route.localPref}\n                ${received.clusterList.length ? `Cluster list:  ${received.clusterList.join(" ")}` : "Cluster list:  (none)"}\n                Originator ID: ${received.route.originatorId}`,
  };

const neighborCisco: CliOutput = isRr
    ? {
        cmd: "show bgp neighbors",
        output:
          [
            ...(state.design.clients[router] ?? []).map((c) => `BGP neighbor is ${ROUTER_IP[c]}, remote AS ${AS_NUMBER}, internal link\n  BGP state = Established\n  ${c} is a ROUTE-REFLECTOR CLIENT`),
            ...(state.design.peers[router] ?? []).map((p) => `BGP neighbor is ${ROUTER_IP[p]}, remote AS ${AS_NUMBER}, internal link\n  BGP state = Established\n  ${p} is an ordinary iBGP peer (not a client)`),
          ].join("\n\n") || "(no neighbors)",
      }
    : {
        cmd: "show bgp neighbors",
        output:
          partners
            .map((rr) => `BGP neighbor is ${ROUTER_IP[rr]}, remote AS ${AS_NUMBER}, internal link\n  BGP state = Established\n  ${relationshipLabel(state.design, rr, router)}`)
            .join("\n\n") || "(no neighbors)",
      };
  const neighborJuniper: CliOutput = { cmd: "show bgp neighbor", output: neighborCisco.output };

  const clientConfigCisco: CliOutput = {
    cmd: isRr ? "show run | section router bgp" : "(not a Route Reflector)",
    output: isRr
      ? `router bgp ${AS_NUMBER}\n bgp cluster-id ${CLUSTER_ID[router]}\n${(state.design.clients[router] ?? []).map((c) => ` neighbor ${ROUTER_IP[c]} route-reflector-client`).join("\n") || " (no clients configured)"}${router === "RR2" && state.faultActive ? "\n neighbor " + ROUTER_IP.PE3 + " remote-as " + AS_NUMBER + "  ! missing route-reflector-client" : ""}`
      : "PE routers have no cluster-id or route-reflector-client configuration — those are RR-only.",
  };
  const clientConfigJuniper: CliOutput = {
    cmd: isRr ? "show configuration protocols bgp" : "(not a Route Reflector)",
    output: isRr
      ? `cluster ${CLUSTER_ID[router]};\ngroup rr-clients {\n  type internal;\n${(state.design.clients[router] ?? []).map((c) => `  neighbor ${ROUTER_IP[c]} { cluster; }`).join("\n") || "  (no clients configured)"}\n}`
      : "PE routers carry no cluster or client stanza — those live on the Route Reflector only.",
  };

  return [
    { id: "summary", label: "bgp summary", cisco: summaryCisco, juniper: summaryJuniper },
    { id: "route", label: `route ${PREFIX.split("/")[0]}`, cisco: routeCisco, juniper: routeJuniper },
    { id: "neighbor", label: "neighbors", cisco: neighborCisco, juniper: neighborJuniper },
    { id: "rr-config", label: "rr config", cisco: clientConfigCisco, juniper: clientConfigJuniper },
  ];
}
