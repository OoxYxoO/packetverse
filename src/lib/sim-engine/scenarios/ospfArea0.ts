import type { PacketLayer, PacketVisual, ScenarioStep } from "../types";

/**
 * OSPF — SINGLE AREA, POINT-TO-POINT (project brief: OSPF lesson)
 *
 *                 R2
 *              10 /  \ 10
 *                /    \
 *              R1      R4
 *                \    /
 *              20 \  / 5
 *                 R3
 *
 * Scope (deliberately bounded — see brief "Important scope rule"):
 *   Area 0, point-to-point interfaces, Hello/adjacency, DBD/LSR/LSU/LSAck,
 *   Type-1 Router-LSAs only, flooding, SPF (Dijkstra), cost changes,
 *   route installation, one troubleshooting fault (area mismatch).
 * Explicitly deferred: DR/BDR, broadcast networks, Type 2/3/5 LSAs,
 * ABR/ASBR, stub/NSSA, authentication, virtual links, OSPFv3.
 *
 * Like firstConnection.ts, this file is pure data + pure functions.
 * No React, no DOM, no Three.js — see /lib/sim-engine/types.ts for the
 * architectural rule this enforces.
 */

export type RouterId = "R1" | "R2" | "R3" | "R4";

export const ALL_ROUTERS: RouterId[] = ["R1", "R2", "R3", "R4"];

export const ROUTER_IDS: Record<RouterId, string> = {
  R1: "1.1.1.1",
  R2: "2.2.2.2",
  R3: "3.3.3.3",
  R4: "4.4.4.4",
};

/** Point-to-point interface IP, per router, toward each neighbor. */
export const IFACE_IP: Record<RouterId, Partial<Record<RouterId, string>>> = {
  R1: { R2: "10.0.12.1", R3: "10.0.13.1" },
  R2: { R1: "10.0.12.2", R4: "10.0.24.1" },
  R3: { R1: "10.0.13.2", R4: "10.0.34.1" },
  R4: { R2: "10.0.24.2", R3: "10.0.34.2" },
};

export type NeighborState = "DOWN" | "INIT" | "TWO_WAY" | "EXSTART" | "EXCHANGE" | "LOADING" | "FULL";

export const NEIGHBOR_STATE_ORDER: NeighborState[] = ["DOWN", "INIT", "TWO_WAY", "EXSTART", "EXCHANGE", "LOADING", "FULL"];

export const NEIGHBOR_STATE_LABEL: Record<NeighborState, string> = {
  DOWN: "DOWN",
  INIT: "INIT",
  TWO_WAY: "2-WAY",
  EXSTART: "EXSTART",
  EXCHANGE: "EXCHANGE",
  LOADING: "LOADING",
  FULL: "FULL",
};

/** Feeds the generic <ProtocolStateMachine> — meaning / why / next for every state. */
export const NEIGHBOR_STATE_INFO: Record<NeighborState, { meaning: string; why: string; next: string }> = {
  DOWN: {
    meaning: "No Hello has been received from this neighbor recently.",
    why: "This is the starting state, or the Dead Interval (40s) expired with no Hello heard.",
    next: "A Hello packet must arrive from the neighbor to move to INIT.",
  },
  INIT: {
    meaning: "A Hello was received, but it did not list this router's own Router ID.",
    why: "Communication has only been confirmed in one direction so far.",
    next: "This router must receive a Hello back that lists its own Router ID.",
  },
  TWO_WAY: {
    meaning: "Both routers have confirmed bidirectional communication.",
    why: "Each router has now seen its own Router ID inside the other's Hello packet.",
    next: "On point-to-point links, both routers proceed straight to EXSTART — there is no DR/BDR election.",
  },
  EXSTART: {
    meaning: "The routers are negotiating master/slave roles and an initial DD sequence number.",
    why: "Database synchronization needs one router to lead (master) and drive the sequence.",
    next: "The router with the higher Router ID becomes master, then DBD exchange begins.",
  },
  EXCHANGE: {
    meaning: "Routers are exchanging Database Description (DBD) packets listing LSA headers.",
    why: "Each side needs to know what the other already has before requesting full LSAs.",
    next: "Any LSA that is missing or outdated locally gets queued for a Link State Request.",
  },
  LOADING: {
    meaning: "Missing or outdated LSAs are being requested (LSR) and retrieved (LSU).",
    why: "The DBD comparison revealed gaps between the two link-state databases.",
    next: "Once every requested LSA is received and acknowledged, the databases match exactly.",
  },
  FULL: {
    meaning: "This neighbor's link-state database is fully synchronized with this router's.",
    why: "Every LSA that should be present has been received and acknowledged.",
    next: "SPF (Dijkstra) can now run using a complete, consistent view of the topology.",
  },
};

export interface OspfInterfaceCfg {
  neighbor: RouterId;
  area: string;
  cost: number;
}
type InterfaceTable = Record<RouterId, Partial<Record<RouterId, OspfInterfaceCfg>>>;

interface NeighborEntry {
  state: NeighborState;
}
type NeighborTable = Record<RouterId, Partial<Record<RouterId, NeighborEntry>>>;

export interface RouterLSALink {
  neighbor: RouterId;
  cost: number;
}
export interface RouterLSA {
  originRouter: RouterId;
  sequence: number;
  links: RouterLSALink[];
}
type LSDB = Record<RouterId, Partial<Record<RouterId, RouterLSA>>>;

export interface RouteEntry {
  destination: RouterId;
  nextHop: RouterId;
  cost: number;
  path: RouterId[];
}
type RoutingTable = Record<RouterId, Partial<Record<RouterId, RouteEntry>>>;

export interface PathCandidate {
  path: RouterId[];
  cost: number;
}

export interface OspfState {
  interfaces: InterfaceTable;
  neighborTables: NeighborTable;
  lsdb: LSDB;
  routingTables: RoutingTable;
  spfRoot?: RouterId;
  spfPaths?: PathCandidate[];
  spfBestPath?: RouterId[];
  challengeCost?: number;
  challengeSucceeded?: boolean;
}

/** Static graph layout consumed by <GraphTopologyViewer> — position only, no protocol logic. */
export const GRAPH_NODES: { id: RouterId; label: string; x: number; y: number }[] = [
  { id: "R2", label: "R2", x: 50, y: 12 },
  { id: "R1", label: "R1", x: 14, y: 52 },
  { id: "R4", label: "R4", x: 86, y: 52 },
  { id: "R3", label: "R3", x: 50, y: 90 },
];

export const GRAPH_EDGES: { id: string; a: RouterId; b: RouterId }[] = [
  { id: "R1-R2", a: "R1", b: "R2" },
  { id: "R1-R3", a: "R1", b: "R3" },
  { id: "R2-R4", a: "R2", b: "R4" },
  { id: "R3-R4", a: "R3", b: "R4" },
];

const BASE_EDGES: [RouterId, RouterId, number][] = [
  ["R1", "R2", 10],
  ["R1", "R3", 20],
  ["R2", "R4", 10],
  ["R3", "R4", 5],
];

function makeInterfaces(): InterfaceTable {
  const ifaces: InterfaceTable = { R1: {}, R2: {}, R3: {}, R4: {} };
  for (const [a, b, cost] of BASE_EDGES) {
    ifaces[a][b] = { neighbor: b, area: "0.0.0.0", cost };
    ifaces[b][a] = { neighbor: a, area: "0.0.0.0", cost };
  }
  return ifaces;
}

function makeNeighborTables(): NeighborTable {
  const nt: NeighborTable = { R1: {}, R2: {}, R3: {}, R4: {} };
  for (const [a, b] of BASE_EDGES) {
    nt[a][b] = { state: "DOWN" };
    nt[b][a] = { state: "DOWN" };
  }
  return nt;
}

export function createOspfState(): OspfState {
  return {
    interfaces: makeInterfaces(),
    neighborTables: makeNeighborTables(),
    lsdb: { R1: {}, R2: {}, R3: {}, R4: {} },
    routingTables: { R1: {}, R2: {}, R3: {}, R4: {} },
  };
}

// ---------------------------------------------------------------------------
// Pure protocol helpers — the "networking logic" layer.
// ---------------------------------------------------------------------------

function buildLSA(router: RouterId, interfaces: InterfaceTable, sequence: number): RouterLSA {
  const links = Object.values(interfaces[router])
    .filter((c): c is OspfInterfaceCfg => Boolean(c))
    .map((c) => ({ neighbor: c.neighbor, cost: c.cost }));
  return { originRouter: router, sequence, links };
}

function nextSequence(lsdb: LSDB, router: RouterId): number {
  return (lsdb[router]?.[router]?.sequence ?? 0) + 1;
}

/** Installs `lsa` into every router's LSDB if newer than what they have. Returns which routers actually learned it. */
function floodLSA(lsdb: LSDB, lsa: RouterLSA): { lsdb: LSDB; installedIn: RouterId[] } {
  const next: LSDB = { ...lsdb };
  const installedIn: RouterId[] = [];
  for (const r of ALL_ROUTERS) {
    const existing = next[r][lsa.originRouter];
    if (!existing || existing.sequence < lsa.sequence) {
      next[r] = { ...next[r], [lsa.originRouter]: lsa };
      installedIn.push(r);
    }
  }
  return { lsdb: next, installedIn };
}

/** Dijkstra SPF rooted at `root`, using root's own LSDB view (exactly what a real OSPF router does). */
export function computeSpf(root: RouterId, lsdbView: Partial<Record<RouterId, RouterLSA>>): Record<RouterId, PathCandidate> {
  const dist: Partial<Record<RouterId, PathCandidate>> = { [root]: { cost: 0, path: [root] } };
  const visited = new Set<RouterId>();

  for (;;) {
    let current: RouterId | null = null;
    let currentCost = Infinity;
    for (const r of ALL_ROUTERS) {
      if (visited.has(r)) continue;
      const d = dist[r];
      if (d && d.cost < currentCost) {
        current = r;
        currentCost = d.cost;
      }
    }
    if (current === null) break;
    visited.add(current);

    const lsa = lsdbView[current];
    if (!lsa) continue;
    for (const link of lsa.links) {
      const newCost = currentCost + link.cost;
      const existing = dist[link.neighbor];
      if (!existing || newCost < existing.cost) {
        dist[link.neighbor] = { cost: newCost, path: [...(dist[current]?.path ?? [current]), link.neighbor] };
      }
    }
  }

  return dist as Record<RouterId, PathCandidate>;
}

/** Enumerates every simple path root→dest using root's LSDB — powers the SPF path-comparison panel. */
export function enumeratePaths(root: RouterId, dest: RouterId, lsdbView: Partial<Record<RouterId, RouterLSA>>): PathCandidate[] {
  const results: PathCandidate[] = [];
  const dfs = (current: RouterId, visited: Set<RouterId>, path: RouterId[], cost: number) => {
    if (current === dest) {
      results.push({ path: [...path], cost });
      return;
    }
    const lsa = lsdbView[current];
    if (!lsa) return;
    for (const link of lsa.links) {
      if (visited.has(link.neighbor)) continue;
      visited.add(link.neighbor);
      dfs(link.neighbor, visited, [...path, link.neighbor], cost + link.cost);
      visited.delete(link.neighbor);
    }
  };
  dfs(root, new Set([root]), [root], 0);
  return results.sort((a, b) => a.cost - b.cost);
}

/** Re-runs SPF at `root` from its current LSDB and writes the resulting routes into routingTables. */
function installSpfRoutes(state: OspfState, root: RouterId): OspfState {
  const dist = computeSpf(root, state.lsdb[root]);
  const table: Partial<Record<RouterId, RouteEntry>> = {};
  for (const dest of ALL_ROUTERS) {
    if (dest === root) continue;
    const d = dist[dest];
    if (!d) continue;
    table[dest] = { destination: dest, nextHop: d.path[1] ?? dest, cost: d.cost, path: d.path };
  }
  return { ...state, routingTables: { ...state.routingTables, [root]: table } };
}

function routeLine(table: Partial<Record<RouterId, RouteEntry>> | undefined, dest: RouterId): string {
  const r = table?.[dest];
  return r ? `via ${r.nextHop}, cost ${r.cost} (${r.path.join(" → ")})` : "no route";
}

// ---------------------------------------------------------------------------
// Packet builders
// ---------------------------------------------------------------------------

const MULTICAST_ALL_SPF = "224.0.0.5 (AllSPFRouters)";

function ipLayer(srcRouter: RouterId, dst: string): PacketLayer {
  const src = Object.values(IFACE_IP[srcRouter]).find(Boolean) ?? "0.0.0.0";
  return {
    name: "IPv4",
    color: "var(--pv-proto-ip)",
    fields: [
      { label: "Source IP", value: src },
      { label: "Destination IP", value: dst },
      { label: "IP Protocol", value: "89 (OSPF)" },
      { label: "TTL", value: "1" },
    ],
  };
}

function helloLayer(router: RouterId, neighborsSeen: RouterId[], area = "0.0.0.0"): PacketLayer {
  return {
    name: "OSPF Hello",
    color: "var(--pv-proto-ospf)",
    fields: [
      { label: "Packet Type", value: "1 (Hello)" },
      { label: "Router ID", value: ROUTER_IDS[router] },
      { label: "Area", value: area },
      { label: "Hello Interval", value: "10" },
      { label: "Dead Interval", value: "40" },
      { label: "Neighbors Seen", value: neighborsSeen.length ? neighborsSeen.map((r) => ROUTER_IDS[r]).join(", ") : "(none yet)" },
    ],
  };
}

function dbdLayer(router: RouterId, opts: { master: boolean; init: boolean; headers?: string[] }): PacketLayer {
  return {
    name: "OSPF DBD",
    color: "var(--pv-proto-ospf)",
    fields: [
      { label: "Packet Type", value: "2 (Database Description)" },
      { label: "Router ID", value: ROUTER_IDS[router] },
      { label: "Flags", value: `I=${opts.init ? 1 : 0}, M=${opts.headers ? 0 : 1}, MS=${opts.master ? 1 : 0}` },
      { label: "DD Sequence", value: opts.master ? "0x1001" : "0x1000" },
      { label: "LSA Headers", value: opts.headers?.length ? opts.headers.join("; ") : "(none — negotiating)" },
    ],
  };
}

function lsrLayer(router: RouterId, requests: string[]): PacketLayer {
  return {
    name: "OSPF LSR",
    color: "var(--pv-proto-ospf)",
    fields: [
      { label: "Packet Type", value: "3 (Link State Request)" },
      { label: "Router ID", value: ROUTER_IDS[router] },
      { label: "Requesting", value: requests.join("; ") },
    ],
  };
}

function lsuLayer(router: RouterId, lsa: RouterLSA): PacketLayer {
  return {
    name: "OSPF LSU",
    color: "var(--pv-proto-ospf)",
    fields: [
      { label: "Packet Type", value: "4 (Link State Update)" },
      { label: "Router ID", value: ROUTER_IDS[router] },
      { label: "LSA Type", value: "1 (Router-LSA)" },
      { label: "Advertising Router", value: ROUTER_IDS[lsa.originRouter] },
      { label: "Sequence", value: String(lsa.sequence) },
      { label: "Links", value: lsa.links.map((l) => `${l.neighbor} (cost ${l.cost})`).join(", ") },
    ],
  };
}

function lsackLayer(router: RouterId, acked: string): PacketLayer {
  return {
    name: "OSPF LSAck",
    color: "var(--pv-proto-ospf)",
    fields: [
      { label: "Packet Type", value: "5 (Link State Ack)" },
      { label: "Router ID", value: ROUTER_IDS[router] },
      { label: "Acknowledging", value: acked },
    ],
  };
}

function ospfPacket(id: string, from: RouterId, to: RouterId, summary: string, layer: PacketLayer, broadcast = false): PacketVisual {
  const dst = broadcast ? MULTICAST_ALL_SPF : (IFACE_IP[to][from] ?? "0.0.0.0");
  return {
    id,
    protocol: "OSPF",
    from,
    to,
    summary,
    broadcast,
    layers: [ipLayer(from, dst), layer],
  };
}

// ---------------------------------------------------------------------------
// Scenario steps
// ---------------------------------------------------------------------------

export const ospfSteps: ScenarioStep<OspfState>[] = [
  {
    id: "intro",
    label: "Mission Briefing",
    narrative:
      "R1 knows only its directly connected networks. It has no idea what's behind R2, R3 or R4 — and typing static routes for every network, on every router, doesn't scale. OSPF exists to solve exactly this: routers automatically discover neighbors, synchronize a shared map of the network, and calculate their own best paths through it. All four links start with OSPF enabled but no adjacency formed yet — every neighbor relationship below is DOWN.",
  },
  {
    id: "hello-1",
    label: "Hello (R1 → R2)",
    narrative:
      "R1 sends an OSPF Hello out its interface toward R2, addressed to the AllSPFRouters multicast group. R1 doesn't know about R2 yet, so its Hello lists no neighbors.",
    packet: () => ospfPacket("hello-1", "R1", "R2", "Hello — no neighbors listed yet", helloLayer("R1", []), true),
    run: (state) => ({
      state,
      events: [{ type: "OSPF_HELLO_SENT", stepId: "hello-1", timestamp: Date.now(), message: "R1 sends Hello toward R2 (neighbor list empty)" }],
    }),
  },
  {
    id: "predict-init",
    label: "Predict",
    narrative: "R2 just received that Hello.",
    question: {
      prompt: "R1's Hello doesn't list R2 — R1 doesn't know about R2 yet. When R2 receives this Hello, what neighbor state should R2 enter?",
      options: [
        { id: "down", label: "DOWN" },
        { id: "init", label: "INIT" },
        { id: "full", label: "FULL" },
        { id: "loading", label: "LOADING" },
      ],
      correctOptionId: "init",
      explanation:
        "R2 has now heard from R1, so it's no longer DOWN — but R1's Hello didn't list R2's Router ID, so R2 can't yet confirm the link is bidirectional. That partial state is INIT.",
    },
  },
  {
    id: "r2-to-init",
    label: "R2 → INIT",
    narrative:
      "R2 records R1 as a neighbor in state INIT, then replies with its own Hello — and this time R1's Router ID IS included, since R2 has now heard from R1.",
    packet: () => ospfPacket("hello-2", "R2", "R1", "Hello — lists R1 as a neighbor", helloLayer("R2", ["R1"]), true),
    run: (state) => ({
      state: { ...state, neighborTables: { ...state.neighborTables, R2: { ...state.neighborTables.R2, R1: { state: "INIT" } } } },
      events: [
        { type: "OSPF_HELLO_RECEIVED", stepId: "r2-to-init", timestamp: Date.now(), message: "R2 receives R1's Hello" },
        { type: "OSPF_NEIGHBOR_DISCOVERED", stepId: "r2-to-init", timestamp: Date.now(), message: "R2 discovers neighbor R1" },
        { type: "OSPF_NEIGHBOR_STATE_CHANGED", stepId: "r2-to-init", timestamp: Date.now(), message: "R2's view of R1: DOWN → INIT" },
        { type: "OSPF_HELLO_SENT", stepId: "r2-to-init", timestamp: Date.now(), message: "R2 sends Hello toward R1, now listing R1" },
      ],
    }),
    whatChanged: () => ["R2's neighbor table: R1 = DOWN → INIT"],
  },
  {
    id: "predict-2way",
    label: "Predict",
    narrative: "R1 just received R2's Hello — and finds its own Router ID (1.1.1.1) listed inside it.",
    question: {
      prompt: "R1 sees its own Router ID listed in R2's Hello. What does this confirm, and what state should R1 enter?",
      options: [
        { id: "down", label: "Still DOWN — one Hello isn't enough" },
        { id: "init", label: "INIT — same as R2" },
        { id: "twoway", label: "2-WAY — bidirectional communication is confirmed" },
        { id: "full", label: "FULL — the databases must already match" },
      ],
      correctOptionId: "twoway",
      explanation:
        "Seeing its own Router ID in the neighbor's Hello proves communication works in both directions. R1 jumps straight from DOWN to 2-WAY — it never needs to pass through INIT, because bidirectionality is already confirmed the moment it sees itself listed.",
    },
  },
  {
    id: "r1-to-2way",
    label: "R1 & R2 → 2-WAY",
    narrative:
      "R1 moves straight to 2-WAY. R1's next Hello will list R2 as well — and the instant R2 sees itself listed, it jumps to 2-WAY too. Both sides now agree the link is bidirectional.",
    packet: () => ospfPacket("hello-3", "R1", "R2", "Hello — lists R2 as a neighbor", helloLayer("R1", ["R2"]), true),
    run: (state) => ({
      state: {
        ...state,
        neighborTables: {
          ...state.neighborTables,
          R1: { ...state.neighborTables.R1, R2: { state: "TWO_WAY" } },
          R2: { ...state.neighborTables.R2, R1: { state: "TWO_WAY" } },
        },
      },
      events: [
        { type: "OSPF_NEIGHBOR_STATE_CHANGED", stepId: "r1-to-2way", timestamp: Date.now(), message: "R1's view of R2: DOWN → 2-WAY" },
        { type: "OSPF_NEIGHBOR_STATE_CHANGED", stepId: "r1-to-2way", timestamp: Date.now(), message: "R2's view of R1: INIT → 2-WAY" },
      ],
    }),
    whatChanged: () => ["R1's neighbor table: R2 = DOWN → 2-WAY", "R2's neighbor table: R1 = INIT → 2-WAY"],
  },
  {
    id: "predict-p2p-next",
    label: "Predict",
    narrative: "The two routers have reached 2-WAY.",
    question: {
      prompt: "What happens next on this point-to-point link?",
      options: [
        { id: "dr", label: "Elect a DR and BDR before going further" },
        { id: "exstart", label: "Both routers proceed straight to EXSTART to begin database synchronization" },
        { id: "done", label: "Nothing — 2-WAY is the final state on a P2P link" },
        { id: "hello-forever", label: "They keep exchanging Hellos until a timer expires" },
      ],
      correctOptionId: "exstart",
      explanation:
        "DR/BDR election only happens on multi-access (broadcast/NBMA) networks, where flooding to every neighbor individually would be wasteful. A point-to-point link has exactly two routers — every 2-WAY neighbor here becomes fully adjacent, starting with EXSTART.",
    },
  },
  {
    id: "exstart",
    label: "EXSTART",
    narrative:
      "Both routers send an empty DBD packet to negotiate who leads the synchronization. The router with the higher Router ID becomes master — here, R2 (2.2.2.2) outranks R1 (1.1.1.1) and becomes master.",
    packet: () => ospfPacket("dbd-negotiate", "R1", "R2", "DBD — negotiating master/slave", dbdLayer("R1", { master: false, init: true })),
    run: (state) => ({
      state: {
        ...state,
        neighborTables: {
          ...state.neighborTables,
          R1: { ...state.neighborTables.R1, R2: { state: "EXSTART" } },
          R2: { ...state.neighborTables.R2, R1: { state: "EXSTART" } },
        },
      },
      events: [{ type: "OSPF_DBD_SENT", stepId: "exstart", timestamp: Date.now(), message: "Empty DBD exchanged — R2 (higher Router ID) becomes master" }],
    }),
    whatChanged: () => ["R1 & R2 neighbor state: 2-WAY → EXSTART", "Master/Slave negotiated: R2 = master, R1 = slave"],
  },
  {
    id: "exchange",
    label: "EXCHANGE",
    narrative:
      "As master, R2 leads the exchange of Database Description packets — this time carrying real LSA headers, so each side learns what the other already has.",
    packet: () =>
      ospfPacket("dbd-headers", "R2", "R1", "DBD — lists R2's known LSA headers", dbdLayer("R2", { master: true, init: false, headers: ["Router-LSA 2.2.2.2"] })),
    run: (state) => ({
      state: {
        ...state,
        neighborTables: {
          ...state.neighborTables,
          R1: { ...state.neighborTables.R1, R2: { state: "EXCHANGE" } },
          R2: { ...state.neighborTables.R2, R1: { state: "EXCHANGE" } },
        },
      },
      events: [{ type: "OSPF_DBD_SENT", stepId: "exchange", timestamp: Date.now(), message: "DBD with LSA headers exchanged" }],
    }),
    whatChanged: () => ["R1 & R2 neighbor state: EXSTART → EXCHANGE"],
  },
  {
    id: "loading",
    label: "LOADING",
    narrative:
      "Comparing DBDs, R1 realizes it has no copy of R2's Router-LSA. It sends a Link State Request asking for it explicitly.",
    packet: () => ospfPacket("lsr-1", "R1", "R2", "LSR — requesting R2's Router-LSA", lsrLayer("R1", ["Router-LSA 2.2.2.2"])),
    run: (state) => ({
      state: {
        ...state,
        neighborTables: {
          ...state.neighborTables,
          R1: { ...state.neighborTables.R1, R2: { state: "LOADING" } },
          R2: { ...state.neighborTables.R2, R1: { state: "LOADING" } },
        },
      },
      events: [{ type: "OSPF_LSR_SENT", stepId: "loading", timestamp: Date.now(), message: "R1 requests R2's Router-LSA" }],
    }),
    whatChanged: () => ["R1 & R2 neighbor state: EXCHANGE → LOADING"],
  },
  {
    id: "lsu-install",
    label: "LSU — Install LSAs",
    narrative:
      "R2 sends the full Router-LSA in a Link State Update. The same exchange happens in the other direction too — each router installs both its own LSA and its neighbor's into its local database.",
    packet: () =>
      ospfPacket("lsu-1", "R2", "R1", "LSU — R2's full Router-LSA", lsuLayer("R2", { originRouter: "R2", sequence: 1, links: [{ neighbor: "R1", cost: 10 }, { neighbor: "R4", cost: 10 }] })),
    run: (state) => {
      const lsaR1 = buildLSA("R1", state.interfaces, 1);
      const lsaR2 = buildLSA("R2", state.interfaces, 1);
      const lsdb: LSDB = {
        ...state.lsdb,
        R1: { ...state.lsdb.R1, R1: lsaR1, R2: lsaR2 },
        R2: { ...state.lsdb.R2, R2: lsaR2, R1: lsaR1 },
      };
      return {
        state: { ...state, lsdb },
        events: [
          { type: "OSPF_LSU_SENT", stepId: "lsu-install", timestamp: Date.now(), message: "R2 sends its Router-LSA to R1" },
          { type: "OSPF_LSU_SENT", stepId: "lsu-install", timestamp: Date.now(), message: "R1 sends its Router-LSA to R2" },
          { type: "OSPF_LSA_INSTALLED", stepId: "lsu-install", timestamp: Date.now(), message: "R1 installs Router-LSA R1 + Router-LSA R2" },
          { type: "OSPF_LSA_INSTALLED", stepId: "lsu-install", timestamp: Date.now(), message: "R2 installs Router-LSA R2 + Router-LSA R1" },
        ],
      };
    },
    whatChanged: () => ["R1 LSDB: +Router-LSA R1, +Router-LSA R2", "R2 LSDB: +Router-LSA R2, +Router-LSA R1"],
  },
  {
    id: "full",
    label: "FULL",
    narrative: "R1 acknowledges the update. Both databases now match exactly for what each router has exchanged — the adjacency is FULL.",
    packet: () => ospfPacket("lsack-1", "R1", "R2", "LSAck — acknowledging R2's Router-LSA", lsackLayer("R1", "Router-LSA 2.2.2.2")),
    run: (state) => ({
      state: {
        ...state,
        neighborTables: {
          ...state.neighborTables,
          R1: { ...state.neighborTables.R1, R2: { state: "FULL" } },
          R2: { ...state.neighborTables.R2, R1: { state: "FULL" } },
        },
      },
      events: [
        { type: "OSPF_LSACK_SENT", stepId: "full", timestamp: Date.now(), message: "R1 acknowledges R2's LSA" },
        { type: "OSPF_NEIGHBOR_STATE_CHANGED", stepId: "full", timestamp: Date.now(), message: "R1 & R2 neighbor state: LOADING → FULL" },
      ],
    }),
    whatChanged: () => ["R1 & R2 neighbor state: LOADING → FULL"],
  },
  {
    id: "mesh-forms",
    label: "Meanwhile…",
    narrative:
      "The exact same Hello → 2-WAY → EXSTART → EXCHANGE → LOADING → FULL sequence you just walked through happens independently and simultaneously on every other link in the area — R1↔R3, R2↔R4, and R3↔R4.",
    run: (state) => {
      let lsdb = state.lsdb;
      lsdb = { ...lsdb, R3: { ...lsdb.R3, R3: buildLSA("R3", state.interfaces, 1) } };
      lsdb = { ...lsdb, R4: { ...lsdb.R4, R4: buildLSA("R4", state.interfaces, 1) } };
      return {
        state: {
          ...state,
          lsdb,
          neighborTables: {
            ...state.neighborTables,
            R1: { ...state.neighborTables.R1, R3: { state: "FULL" } },
            R3: { ...state.neighborTables.R3, R1: { state: "FULL" }, R4: { state: "FULL" } },
            R2: { ...state.neighborTables.R2, R4: { state: "FULL" } },
            R4: { ...state.neighborTables.R4, R2: { state: "FULL" }, R3: { state: "FULL" } },
          },
        },
        events: [
          { type: "OSPF_NEIGHBOR_STATE_CHANGED", stepId: "mesh-forms", timestamp: Date.now(), message: "R1 ↔ R3 neighbor state: DOWN → FULL" },
          { type: "OSPF_NEIGHBOR_STATE_CHANGED", stepId: "mesh-forms", timestamp: Date.now(), message: "R2 ↔ R4 neighbor state: DOWN → FULL" },
          { type: "OSPF_NEIGHBOR_STATE_CHANGED", stepId: "mesh-forms", timestamp: Date.now(), message: "R3 ↔ R4 neighbor state: DOWN → FULL" },
        ],
      };
    },
    whatChanged: () => ["R1↔R3, R2↔R4, R3↔R4 adjacencies: DOWN → FULL", "R3 and R4 each install their own Router-LSA"],
  },
  {
    id: "flood-lsas",
    label: "Flood LSAs Area-Wide",
    narrative:
      "Now that every adjacency is FULL, each router's Router-LSA propagates across the whole area — relayed hop by hop until every router has all four, even ones it isn't directly connected to. R4, for example, learns about R1 only because R2 (or R3) re-floods it onward.",
    packet: () => ospfPacket("lsu-relay", "R2", "R4", "LSU — relaying Router-LSA R1 onward", lsuLayer("R2", { originRouter: "R1", sequence: 1, links: [{ neighbor: "R2", cost: 10 }, { neighbor: "R3", cost: 20 }] })),
    run: (state) => {
      let lsdb = state.lsdb;
      const events: { type: "OSPF_LSA_INSTALLED"; stepId: string; timestamp: number; message: string }[] = [];
      for (const origin of ALL_ROUTERS) {
        const lsa = lsdb[origin][origin];
        if (!lsa) continue;
        const result = floodLSA(lsdb, lsa);
        lsdb = result.lsdb;
        if (result.installedIn.length) {
          events.push({
            type: "OSPF_LSA_INSTALLED",
            stepId: "flood-lsas",
            timestamp: Date.now(),
            message: `Router-LSA ${origin} installed in: ${result.installedIn.join(", ")}`,
          });
        }
      }
      return { state: { ...state, lsdb }, events };
    },
    whatChanged: (prev, next) => {
      const before = ALL_ROUTERS.map((r) => Object.keys(prev.lsdb[r]).length);
      const after = ALL_ROUTERS.map((r) => Object.keys(next.lsdb[r]).length);
      return ALL_ROUTERS.map((r, i) => `${r} LSDB: ${before[i]} LSA${before[i] === 1 ? "" : "s"} → ${after[i]} LSAs`);
    },
  },
  {
    id: "spf-why",
    label: "Why SPF Runs",
    narrative:
      "Every router's LSDB is now identical — the same four Router-LSAs, everywhere. That's the precondition for SPF: each router independently runs Dijkstra's algorithm over this shared map and computes its own shortest-path tree. No router needs to ask another for directions.",
  },
  {
    id: "spf-start",
    label: "SPF Started (R1)",
    narrative: "Let's watch R1 calculate its best path to R4. R1 has two candidate paths through the diamond — SPF will compare their cumulative cost.",
    run: (state) => {
      const paths = enumeratePaths("R1", "R4", state.lsdb.R1);
      return {
        state: { ...state, spfRoot: "R1", spfPaths: paths },
        events: [{ type: "OSPF_SPF_STARTED", stepId: "spf-start", timestamp: Date.now(), message: "R1 begins SPF (Dijkstra) using its LSDB" }],
      };
    },
  },
  {
    id: "spf-complete",
    label: "SPF Complete — Route Installed",
    narrative: "SPF finds R1 → R2 → R4 (cost 20) is cheaper than R1 → R3 → R4 (cost 25). R1 installs the winning path into its routing table.",
    run: (state) => {
      const next = installSpfRoutes(state, "R1");
      const best = next.routingTables.R1?.R4?.path ?? [];
      return {
        state: { ...next, spfBestPath: best },
        events: [
          { type: "OSPF_SPF_COMPLETED", stepId: "spf-complete", timestamp: Date.now(), message: "R1 SPF complete" },
          { type: "OSPF_ROUTE_INSTALLED", stepId: "spf-complete", timestamp: Date.now(), message: `R1 installs route to R4 via ${best[1]}, cost ${next.routingTables.R1?.R4?.cost}` },
        ],
      };
    },
    whatChanged: (_prev, next) => [`R1 route to R4: ${routeLine(next.routingTables.R1, "R4")}`],
  },
  {
    id: "cost-change-intro",
    label: "Costs Aren't Permanent",
    narrative:
      "Link costs aren't fixed — engineers tune them to steer traffic, often after a circuit downgrade or a deliberate policy change. Let's see what happens if R1's link to R2 suddenly gets five times more expensive.",
  },
  {
    id: "cost-changed",
    label: "Cost Changed",
    narrative: "R1's outbound interface cost to R2 changes from 10 to 50. R1 immediately originates a new Router-LSA reflecting the change — but hasn't flooded it yet.",
    run: (state) => {
      const interfaces: InterfaceTable = { ...state.interfaces, R1: { ...state.interfaces.R1, R2: { neighbor: "R2", area: "0.0.0.0", cost: 50 } } };
      const seq = nextSequence(state.lsdb, "R1");
      const newLsa = buildLSA("R1", interfaces, seq);
      return {
        state: { ...state, interfaces, lsdb: { ...state.lsdb, R1: { ...state.lsdb.R1, R1: newLsa } } },
        events: [{ type: "OSPF_COST_CHANGED", stepId: "cost-changed", timestamp: Date.now(), message: "R1's interface to R2: cost 10 → 50" }],
      };
    },
    whatChanged: () => ["R1 interface → R2 cost: 10 → 50", "R1 originates a new Router-LSA (sequence bumped) — not yet flooded"],
  },
  {
    id: "lsa-reflooded",
    label: "LSA Reflooded",
    narrative: "R1's updated Router-LSA floods out to every other router in the area, replacing their stale copy.",
    packet: () => {
      const lsa = { originRouter: "R1" as RouterId, sequence: 2, links: [{ neighbor: "R2" as RouterId, cost: 50 }, { neighbor: "R3" as RouterId, cost: 20 }] };
      return ospfPacket("lsu-cost", "R2", "R4", "LSU — R1's updated Router-LSA (cost 50)", lsuLayer("R2", lsa));
    },
    run: (state) => {
      const lsa = state.lsdb.R1.R1;
      if (!lsa) return { state, events: [] };
      const { lsdb, installedIn } = floodLSA(state.lsdb, lsa);
      return {
        state: { ...state, lsdb },
        events: [{ type: "OSPF_LSA_INSTALLED", stepId: "lsa-reflooded", timestamp: Date.now(), message: `Updated Router-LSA R1 installed in: ${installedIn.join(", ") || "(already current everywhere)"}` }],
      };
    },
    whatChanged: () => ["R2, R3, R4 LSDBs updated with R1's new cost (sequence 2)"],
  },
  {
    id: "spf-rerun",
    label: "SPF Re-run",
    narrative: "R1 reruns SPF against its updated LSDB. The picture has changed.",
    run: (state) => {
      const before = state.routingTables.R1?.R4;
      const paths = enumeratePaths("R1", "R4", state.lsdb.R1);
      const next = installSpfRoutes({ ...state, spfPaths: paths }, "R1");
      const after = next.routingTables.R1?.R4;
      return {
        state: { ...next, spfBestPath: after?.path ?? [] },
        events: [
          { type: "OSPF_SPF_STARTED", stepId: "spf-rerun", timestamp: Date.now(), message: "R1 SPF re-triggered by topology change" },
          { type: "OSPF_SPF_COMPLETED", stepId: "spf-rerun", timestamp: Date.now(), message: "R1 SPF complete" },
          {
            type: "OSPF_ROUTE_INSTALLED",
            stepId: "spf-rerun",
            timestamp: Date.now(),
            message: `R1 route to R4 changed: via ${before?.nextHop} (cost ${before?.cost}) → via ${after?.nextHop} (cost ${after?.cost})`,
          },
        ],
      };
    },
    whatChanged: (prev, next) => [
      `Route to R4: BEFORE via ${prev.routingTables.R1?.R4?.nextHop} (cost ${prev.routingTables.R1?.R4?.cost}) → AFTER via ${next.routingTables.R1?.R4?.nextHop} (cost ${next.routingTables.R1?.R4?.cost})`,
      "This is why the route changed: it's cheaper now, not because anything broke.",
    ],
  },
  {
    id: "break-intro",
    label: "Break the Network",
    narrative:
      "You've seen OSPF converge cleanly twice now. Time to break it on purpose. R1 and R2 are directly cabled together — but a misconfiguration is about to take their adjacency down.",
  },
  {
    id: "fault-injected",
    label: "Fault Injected",
    narrative: "Someone changes R2's interface toward R1 from Area 0 into Area 1. R1 stays in Area 0. The adjacency immediately drops.",
    run: (state) => ({
      state: {
        ...state,
        interfaces: { ...state.interfaces, R2: { ...state.interfaces.R2, R1: { ...(state.interfaces.R2.R1 as OspfInterfaceCfg), area: "0.0.0.1" } } },
        neighborTables: {
          ...state.neighborTables,
          R1: { ...state.neighborTables.R1, R2: { state: "DOWN" } },
          R2: { ...state.neighborTables.R2, R1: { state: "DOWN" } },
        },
      },
      events: [
        { type: "OSPF_COST_CHANGED", stepId: "fault-injected", timestamp: Date.now(), message: "R2's interface to R1 reassigned: Area 0.0.0.0 → 0.0.0.1" },
        { type: "OSPF_NEIGHBOR_STATE_CHANGED", stepId: "fault-injected", timestamp: Date.now(), message: "R1 ↔ R2 neighbor state: FULL → DOWN" },
      ],
    }),
    whatChanged: () => ["R2 interface → R1: Area 0.0.0.0 → 0.0.0.1", "R1 ↔ R2 adjacency: FULL → DOWN"],
  },
  {
    id: "troubleshoot-question",
    label: "Troubleshoot",
    narrative:
      "R1 and R2 are directly connected, but they never become OSPF neighbors — R1 just keeps sending Hellos into the dark. Inspect the interface configuration, the Hello packets, and the neighbor table before you answer.",
    question: {
      prompt: "What is preventing the R1 ↔ R2 adjacency from forming?",
      options: [
        { id: "area", label: "R1 and R2's interfaces are in different OSPF areas" },
        { id: "hello", label: "Hello/Dead interval mismatch" },
        { id: "auth", label: "OSPF authentication mismatch" },
        { id: "mtu", label: "Interface MTU mismatch" },
      ],
      correctOptionId: "area",
      explanation:
        "A Hello packet carries the sending interface's Area ID. If it doesn't match the receiving interface's own area, the Hello is silently discarded before any neighbor state is even created — R2's interface toward R1 is now in Area 1 while R1 is still in Area 0.",
      hints: [
        "Hint 1: The physical link and Hello Interval/Dead Interval are fine — check something in the Hello packet itself.",
        "Hint 2: Every OSPF interface belongs to an area, and that area ID is carried inside every Hello. Compare R1's and R2's interface configuration toward each other.",
      ],
    },
  },
  {
    id: "fault-fixed",
    label: "Area Corrected",
    narrative: "You correct R2's interface back to Area 0, matching R1.",
    run: (state) => ({
      state: { ...state, interfaces: { ...state.interfaces, R2: { ...state.interfaces.R2, R1: { ...(state.interfaces.R2.R1 as OspfInterfaceCfg), area: "0.0.0.0" } } } },
      events: [],
    }),
    whatChanged: () => ["R2 interface → R1: Area 0.0.0.1 → 0.0.0.0"],
  },
  {
    id: "adjacency-reforms",
    label: "Adjacency Reforms",
    narrative: "With both interfaces back in Area 0, Hellos are accepted again and the adjacency reforms straight to FULL — the mechanics are identical to the walkthrough you already completed.",
    packet: () => ospfPacket("hello-recover", "R1", "R2", "Hello — accepted again, areas now match", helloLayer("R1", ["R2"])),
    run: (state) => ({
      state: {
        ...state,
        neighborTables: {
          ...state.neighborTables,
          R1: { ...state.neighborTables.R1, R2: { state: "FULL" } },
          R2: { ...state.neighborTables.R2, R1: { state: "FULL" } },
        },
      },
      events: [
        { type: "OSPF_HELLO_SENT", stepId: "adjacency-reforms", timestamp: Date.now(), message: "Hello accepted — areas now match" },
        { type: "OSPF_NEIGHBOR_STATE_CHANGED", stepId: "adjacency-reforms", timestamp: Date.now(), message: "R1 ↔ R2 neighbor state: DOWN → FULL" },
      ],
    }),
    whatChanged: () => ["R1 ↔ R2 adjacency: DOWN → FULL"],
  },
  {
    id: "challenge-intro",
    label: "Engineer Challenge",
    narrative:
      "Network Engineer Challenge — R1's link to R2 is reset to its original cost of 10, so R1 → R2 → R4 is the best path again. Your task: change R1's outbound cost to R2 so that R1 → R3 → R4 becomes preferred instead — without disabling any interface.",
    run: (state) => {
      const interfaces: InterfaceTable = { ...state.interfaces, R1: { ...state.interfaces.R1, R2: { neighbor: "R2", area: "0.0.0.0", cost: 10 } } };
      const seq = nextSequence(state.lsdb, "R1");
      const resetLsa = buildLSA("R1", interfaces, seq);
      const { lsdb } = floodLSA(state.lsdb, resetLsa);
      const withSpf = installSpfRoutes({ ...state, interfaces, lsdb, challengeCost: 10, challengeSucceeded: false }, "R1");
      const next = { ...withSpf, spfPaths: enumeratePaths("R1", "R4", withSpf.lsdb.R1) };
      return {
        state: next,
        events: [{ type: "OSPF_COST_CHANGED", stepId: "challenge-intro", timestamp: Date.now(), message: "R1's interface to R2 reset: cost → 10 (baseline restored)" }],
      };
    },
    whatChanged: (_prev, next) => [`Baseline restored: route to R4 is ${routeLine(next.routingTables.R1, "R4")}`],
  },
  {
    id: "challenge",
    label: "Change The Cost",
    narrative:
      "Pick a new cost for R1's interface toward R2. The engine will re-flood R1's LSA and rerun SPF immediately — watch the routing table and try again if R1 → R2 → R4 still wins.",
    action: (state, payload) => {
      const cost = typeof payload === "object" && payload !== null && "cost" in payload ? Number((payload as { cost: number }).cost) : 10;
      const interfaces: InterfaceTable = { ...state.interfaces, R1: { ...state.interfaces.R1, R2: { neighbor: "R2", area: "0.0.0.0", cost } } };
      const seq = nextSequence(state.lsdb, "R1");
      const newLsa = buildLSA("R1", interfaces, seq);
      const { lsdb } = floodLSA(state.lsdb, newLsa);
      const withSpf = installSpfRoutes({ ...state, interfaces, lsdb }, "R1");
      const succeeded = withSpf.routingTables.R1?.R4?.nextHop === "R3";
      return {
        state: { ...withSpf, challengeCost: cost, challengeSucceeded: succeeded, spfPaths: enumeratePaths("R1", "R4", withSpf.lsdb.R1) },
        events: [
          { type: "OSPF_COST_CHANGED", stepId: "challenge", timestamp: Date.now(), message: `R1's interface to R2: cost → ${cost}` },
          { type: "OSPF_SPF_COMPLETED", stepId: "challenge", timestamp: Date.now(), message: "R1 SPF recalculated" },
          {
            type: "OSPF_ROUTE_INSTALLED",
            stepId: "challenge",
            timestamp: Date.now(),
            message: `R1 route to R4: via ${withSpf.routingTables.R1?.R4?.nextHop}, cost ${withSpf.routingTables.R1?.R4?.cost}`,
          },
        ],
      };
    },
    requiresState: (state) => state.challengeSucceeded === true,
  },
  {
    id: "complete",
    label: "Challenge Complete",
    narrative:
      "R1 → R3 → R4 is now the installed route, purely because you made it the cheaper path. OSPF converged on its own the moment the LSA changed — nothing was disabled, nothing was forced.",
    whatChanged: (_prev, next) => [`✓ Desired path achieved: ${routeLine(next.routingTables.R1, "R4")}`, "✓ OSPF converged", "✓ Route installed"],
  },
];

// ---------------------------------------------------------------------------
// Read-only CLI panel (brief §10) — output strings are derived live from
// state, hand-formatted to look like each vendor's conventions rather
// than copied from real documentation.
// ---------------------------------------------------------------------------

const CISCO_IFACE: Record<RouterId, Partial<Record<RouterId, string>>> = {
  R1: { R2: "Gi0/0", R3: "Gi0/1" },
  R2: { R1: "Gi0/0", R4: "Gi0/1" },
  R3: { R1: "Gi0/0", R4: "Gi0/1" },
  R4: { R2: "Gi0/0", R3: "Gi0/1" },
};
const JUNOS_IFACE: Record<RouterId, Partial<Record<RouterId, string>>> = {
  R1: { R2: "ge-0/0/0.0", R3: "ge-0/0/1.0" },
  R2: { R1: "ge-0/0/0.0", R4: "ge-0/0/1.0" },
  R3: { R1: "ge-0/0/0.0", R4: "ge-0/0/1.0" },
  R4: { R2: "ge-0/0/0.0", R3: "ge-0/0/1.0" },
};

const pad = (s: string, n: number) => s.padEnd(n);

const CISCO_STATE_LABEL: Record<NeighborState, string> = {
  DOWN: "DOWN",
  INIT: "INIT",
  TWO_WAY: "2WAY",
  EXSTART: "EXSTART",
  EXCHANGE: "EXCHANGE",
  LOADING: "LOADING",
  FULL: "FULL",
};
const JUNOS_STATE_LABEL: Record<NeighborState, string> = {
  DOWN: "Down",
  INIT: "Init",
  TWO_WAY: "2-Way",
  EXSTART: "ExStart",
  EXCHANGE: "Exchange",
  LOADING: "Loading",
  FULL: "Full",
};

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

export function buildCliCommands(state: OspfState, router: RouterId): CliCommandEntry[] {
  const neighborIds = Object.keys(state.neighborTables[router]) as RouterId[];

  const neighborRowsCisco = neighborIds
    .map((n) => {
      const entry = state.neighborTables[router][n];
      const st = `${CISCO_STATE_LABEL[entry?.state ?? "DOWN"]}/  -`;
      const addr = IFACE_IP[n]?.[router] ?? "-";
      return `${pad(ROUTER_IDS[n], 16)}${pad("0", 6)}${pad(st, 16)}${pad("00:00:38", 12)}${pad(addr, 16)}${CISCO_IFACE[router][n] ?? "-"}`;
    })
    .join("\n");
  const neighborCisco: CliOutput = {
    cmd: "show ip ospf neighbor",
    output: `${pad("Neighbor ID", 16)}${pad("Pri", 6)}${pad("State", 16)}${pad("Dead Time", 12)}${pad("Address", 16)}Interface\n${neighborRowsCisco || "(no neighbors)"}`,
  };

  const neighborRowsJunos = neighborIds
    .map((n) => {
      const entry = state.neighborTables[router][n];
      const st = JUNOS_STATE_LABEL[entry?.state ?? "DOWN"];
      const addr = IFACE_IP[n]?.[router] ?? "-";
      return `${pad(addr, 17)}${pad(JUNOS_IFACE[router][n] ?? "-", 23)}${pad(st, 10)}${pad(ROUTER_IDS[n], 17)}${pad("0", 5)}32`;
    })
    .join("\n");
  const neighborJuniper: CliOutput = {
    cmd: "show ospf neighbor",
    output: `${pad("Address", 17)}${pad("Interface", 23)}${pad("State", 10)}${pad("ID", 17)}${pad("Pri", 5)}Dead\n${neighborRowsJunos || "(no neighbors)"}`,
  };

  const lsas = Object.values(state.lsdb[router]).filter((l): l is RouterLSA => Boolean(l));
  const dbRowsCisco = lsas
    .map((l) => `${pad(ROUTER_IDS[l.originRouter], 16)}${pad(ROUTER_IDS[l.originRouter], 16)}${pad("12", 12)}${pad(`0x8000000${l.sequence}`, 12)}${l.links.length}`)
    .join("\n");
  const dbCisco: CliOutput = {
    cmd: "show ip ospf database",
    output: `            OSPF Router with ID (${ROUTER_IDS[router]}) (Process ID 1)\n\n                Router Link States (Area 0)\n\n${pad("Link ID", 16)}${pad("ADV Router", 16)}${pad("Age", 12)}${pad("Seq#", 12)}Link count\n${dbRowsCisco || "(empty)"}`,
  };

  const dbRowsJunos = lsas
    .map((l) => `${pad("Router", 11)}${pad(ROUTER_IDS[l.originRouter], 17)}${pad(ROUTER_IDS[l.originRouter], 18)}${pad(`0x8000000${l.sequence}`, 13)}${pad("12", 5)}${pad("0x22", 5)}${pad("0x1234", 7)}${28 + l.links.length * 12}`)
    .join("\n");
  const dbJuniper: CliOutput = {
    cmd: "show ospf database",
    output: `    OSPF database, Area 0.0.0.0\n${pad("Type", 11)}${pad("ID", 17)}${pad("Adv Rtr", 18)}${pad("Seq", 13)}${pad("Age", 5)}${pad("Opt", 5)}${pad("Cksum", 7)}Len\n${dbRowsJunos || "(empty)"}`,
  };

  const routeEntries = Object.values(state.routingTables[router]).filter((r): r is RouteEntry => Boolean(r));
  const routeRowsCisco = routeEntries
    .map((r) => `O    ${ROUTER_IDS[r.destination]}/32 [110/${r.cost}] via ${IFACE_IP[r.nextHop]?.[router] ?? IFACE_IP[router]?.[r.nextHop]}, 00:01:10, ${CISCO_IFACE[router][r.nextHop] ?? "-"}`)
    .join("\n");
  const routeCisco: CliOutput = { cmd: "show ip route ospf", output: routeRowsCisco || "(no OSPF routes)" };

  const routeRowsJunos = routeEntries
    .map((r) => `${ROUTER_IDS[r.destination]}/32    *[OSPF/10] 00:01:10, metric ${r.cost}\n                    > to ${IFACE_IP[r.nextHop]?.[router] ?? "-"} via ${JUNOS_IFACE[router][r.nextHop] ?? "-"}`)
    .join("\n");
  const routeJuniper: CliOutput = { cmd: "show route protocol ospf", output: routeRowsJunos || "(no OSPF routes)" };

  const ifaceRowsCisco = neighborIds
    .map((n) => {
      const cfg = state.interfaces[router][n];
      return `${CISCO_IFACE[router][n]} is up, line protocol is up\n  Internet Address ${IFACE_IP[router]?.[n]}/30, Area ${cfg?.area}\n  Process ID 1, Router ID ${ROUTER_IDS[router]}, Network Type POINT_TO_POINT, Cost: ${cfg?.cost}`;
    })
    .join("\n");
  const ifaceCisco: CliOutput = { cmd: "show ip ospf interface", output: ifaceRowsCisco || "(no OSPF interfaces)" };

  const ifaceRowsJunos = neighborIds
    .map((n) => {
      const cfg = state.interfaces[router][n];
      return `${pad(JUNOS_IFACE[router][n] ?? "-", 21)}${pad("PtToPt", 8)}${pad(cfg?.area ?? "-", 16)}${pad("0.0.0.0", 17)}${pad("0.0.0.0", 17)}1  (cost ${cfg?.cost})`;
    })
    .join("\n");
  const ifaceJuniper: CliOutput = {
    cmd: "show ospf interface",
    output: `${pad("Interface", 21)}${pad("State", 8)}${pad("Area", 16)}${pad("DR ID", 17)}${pad("BDR ID", 17)}Nbrs\n${ifaceRowsJunos || "(no OSPF interfaces)"}`,
  };

  return [
    { id: "neighbor", label: "neighbor", cisco: neighborCisco, juniper: neighborJuniper },
    { id: "database", label: "database", cisco: dbCisco, juniper: dbJuniper },
    { id: "route", label: "route", cisco: routeCisco, juniper: routeJuniper },
    { id: "interface", label: "interface", cisco: ifaceCisco, juniper: ifaceJuniper },
  ];
}
