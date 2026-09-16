import type { PacketVisual, ScenarioStep } from "../types";
import { HOST_A_IP, HOST_A_MAC, HOST_B_IP, HOST_B_MAC, VLAN, VNI, VTEP_LOOPBACK } from "./evpnBum";
import { buildPacketLayers, type DataFrame } from "./evpnVxlan";

/**
 * EVPN MAC Mobility — the fifth lesson in the EVPN track, extending
 * the same fabric "EVPN + VXLAN Foundations" and "EVPN BUM + Type 3"
 * built (see docs/ARCHITECTURE.md §4 for why this reuses `VTEP_LOOPBACK`
 * and the VNI-10010 `buildPacketLayers`/`DataFrame` pair verbatim from
 * `evpnBum.ts` — this lesson never varies the VNI or introduces a
 * routed L3 VNI at all, so the exact same 2-vs-5-layer wire format
 * already built is the right one to reuse unmodified, unlike the IRB/
 * Type-5 lessons which needed a parameterized variant).
 *
 * The question this lesson answers: Type 2 (already taught) told
 * every remote VTEP "HOST-A is behind LEAF1." What happens when
 * HOST-A physically moves to a different leaf, keeping the exact same
 * MAC and IP? Something has to tell every remote VTEP "no, HOST-A is
 * behind LEAF2 now" — and do it in a way that can't be confused with
 * a duplicate/looping MAC. That's the MAC Mobility Extended Community:
 * a sequence number that lets a newer advertisement for the SAME
 * endpoint identity win over an older one.
 *
 * Explicitly DEFERRED (per the user's own stated sequence): ARP/ND
 * Suppression (the next dedicated module), EVPN multihoming, ESI, DF
 * election (explicitly contrasted with mobility in this lesson, never
 * built). Duplicate-MAC / rapid-move protection is mentioned as a
 * real thing but not modeled — this lesson's one move (plus one
 * optional second move) is always legitimate.
 *
 * Pure data + pure functions only — see /lib/sim-engine/types.ts.
 */

export type LeafId = "LEAF1" | "LEAF2" | "LEAF3";
export type EvpnMobilityDeviceId = "HOST-A" | LeafId | "SPINE1" | "HOST-B";
export const FABRIC_DEVICES: EvpnMobilityDeviceId[] = ["LEAF1", "SPINE1", "LEAF2", "LEAF3"];

export { HOST_A_IP, HOST_A_MAC, HOST_B_IP, HOST_B_MAC, VLAN, VNI, VTEP_LOOPBACK };

const EVPN_EXPORT_RT = "65000:10010";
function rdFor(leaf: LeafId): string {
  return `${VTEP_LOOPBACK[leaf]}:${VNI}`;
}

export const TERMS: { term: string; expansion: string; meaning: string }[] = [
  { term: "MAC Mobility", expansion: "Extended Community", meaning: "A sequence number on a Type 2 route that lets a NEWER advertisement for the same MAC/IP win over an older one — the mechanism, not a packet-hop counter." },
  { term: "Endpoint Identity", expansion: "MAC + IP, Unchanged", meaning: "The thing that moves is the ATTACHMENT — the endpoint's own MAC and IP never change during a legitimate move." },
  { term: "Sequence 0 → 1", expansion: "Newer Wins", meaning: "Every time an endpoint re-appears at a new location, its Type 2 route is re-advertised with a higher sequence number." },
  { term: "Selected Route", expansion: "Not Just Received", meaning: "A remote VTEP can receive a newer route and still keep forwarding to the old one if its own comparison/selection state is broken — receiving ≠ selecting." },
  { term: "Mobility ≠ Multihoming", expansion: "Different Problems", meaning: "Mobility: an endpoint moves from one location to another. Multihoming: an endpoint is intentionally attached to multiple VTEPs at once. Not the same." },
];

// ---------------------------------------------------------------------------
// Type 2 route (with mobility sequence) + per-leaf MAC table model
// ---------------------------------------------------------------------------

export interface Type2Route {
  mac: string;
  ip: string;
  vni: number;
  rd: string;
  rt: string;
  nextHop: string;
  originLeaf: LeafId;
  mobilitySeq: number;
  /** True only on a leaf's own SELECTED reference during the "kept the old route" fault demonstration — never on the route's own historical record. */
  stale?: boolean;
}
function makeHostARoute(originLeaf: LeafId, mobilitySeq: number): Type2Route {
  return { mac: HOST_A_MAC, ip: HOST_A_IP, vni: VNI, rd: rdFor(originLeaf), rt: EVPN_EXPORT_RT, nextHop: VTEP_LOOPBACK[originLeaf], originLeaf, mobilitySeq };
}

export interface MacTableEntry {
  mac: string;
  ip: string;
  source: "local" | "remote";
  remoteVtep?: string;
  mobilitySeq: number;
  stale?: boolean; // true only during the "what if LEAF3 kept the old entry" demonstration (brief §20) — never during ordinary flow
}

export type MobilityAction = "L2_BRIDGE" | "UNDERLAY_FORWARD" | "L2_DELIVER";
export interface JourneyHop {
  device: EvpnMobilityDeviceId;
  input: string;
  lookup: string;
  action: MobilityAction;
  output: string;
}

export interface EvpnMobilityState {
  bgpSessionUp: boolean;
  hostALocation: LeafId; // where HOST-A is PHYSICALLY attached right now
  hostARoutes: Type2Route[]; // every Type-2 route HOST-A has ever had advertised, oldest first
  selectedRouteByLeaf: Partial<Record<LeafId, Type2Route>>; // which HOST-A route each OTHER leaf currently selects for forwarding — this is where the fault lives (LEAF3's)
  macTables: Record<LeafId, MacTableEntry[]>;

  packet?: DataFrame;
  packetAt?: EvpnMobilityDeviceId;
  journey: JourneyHop[];
  beforeMoveJourney?: JourneyHop[]; // a snapshot of the pre-move journey, kept so the after-move send can display both simultaneously (brief §13)

  moveCount: 0 | 1 | 2;
  staleDemoShown: boolean;

  faultActive: boolean;
  repairAttempt?: { choice: string; correct: boolean };
  challengeSucceeded?: boolean;
}

function hostBTable(): MacTableEntry {
  return { mac: HOST_B_MAC, ip: HOST_B_IP, source: "local", mobilitySeq: 0 };
}

export function createEvpnMobilityState(): EvpnMobilityState {
  return {
    bgpSessionUp: false,
    hostALocation: "LEAF1",
    hostARoutes: [],
    selectedRouteByLeaf: {},
    macTables: { LEAF1: [], LEAF2: [], LEAF3: [hostBTable()] },
    journey: [],
    moveCount: 0,
    staleDemoShown: false,
    faultActive: false,
  };
}

// ---------------------------------------------------------------------------
// Pure scenario functions (brief §28)
// ---------------------------------------------------------------------------

/** HOST-A physically disconnects from its current leaf and attaches to `toLeaf` — a genuine state change, not a 3D-mesh-only move. Identity (MAC/IP) is untouched. */
export function moveEndpoint(state: EvpnMobilityState, toLeaf: LeafId): EvpnMobilityState {
  const fromLeaf = state.hostALocation;
  const macTables = { ...state.macTables };
  macTables[fromLeaf] = macTables[fromLeaf].filter((e) => e.mac !== HOST_A_MAC);
  return { ...state, hostALocation: toLeaf, macTables };
}

/** LEAF observes HOST-A locally and builds a newer Type 2 route — sequence strictly increases from whatever HOST-A's own last advertisement was. */
export function originateMobilityRoute(state: EvpnMobilityState, fromLeaf: LeafId): { state: EvpnMobilityState; route: Type2Route } {
  const lastSeq = state.hostARoutes.length ? state.hostARoutes[state.hostARoutes.length - 1].mobilitySeq : -1;
  const route = makeHostARoute(fromLeaf, lastSeq + 1);
  const macTables = { ...state.macTables, [fromLeaf]: [...state.macTables[fromLeaf].filter((e) => e.mac !== HOST_A_MAC), { mac: HOST_A_MAC, ip: HOST_A_IP, source: "local" as const, mobilitySeq: route.mobilitySeq }] };
  return { state: { ...state, hostARoutes: [...state.hostARoutes, route], macTables }, route };
}

/** Ordinary mobility comparison: the higher sequence number wins — never a packet-hop counter, never a tiebreak on anything else in this lesson. */
export function compareMobilityRoutes(oldRoute: Type2Route, newRoute: Type2Route): Type2Route {
  return newRoute.mobilitySeq > oldRoute.mobilitySeq ? newRoute : oldRoute;
}

/** What a receiving leaf SHOULD select given everything it's received so far for this MAC — the fault (brief §21) is a leaf failing to apply this correctly, not this function being wrong. */
export function selectEndpointLocation(routes: Type2Route[]): Type2Route | undefined {
  return routes.reduce((best, r) => (!best || r.mobilitySeq > best.mobilitySeq ? r : best), undefined as Type2Route | undefined);
}

// ---------------------------------------------------------------------------
// Graph layout
// ---------------------------------------------------------------------------

interface GNode {
  id: string;
  label: string;
  x: number;
  y: number;
  subLabel?: string;
  kind?: "server" | "switch" | "cloud";
}
interface GEdge {
  id: string;
  a: string;
  b: string;
  label?: string;
}

export const GRAPH_NODES: GNode[] = [
  { id: "HOST-A", label: "HOST-A", x: 15, y: 88, subLabel: `${HOST_A_IP} · VLAN ${VLAN}`, kind: "server" },
  { id: "LEAF1", label: "LEAF1", x: 15, y: 58, subLabel: `VTEP ${VTEP_LOOPBACK.LEAF1}`, kind: "switch" },
  { id: "SPINE1", label: "SPINE1", x: 50, y: 18, subLabel: "Underlay only", kind: "switch" },
  { id: "LEAF2", label: "LEAF2", x: 50, y: 58, subLabel: `VTEP ${VTEP_LOOPBACK.LEAF2}`, kind: "switch" },
  { id: "HOST-B", label: "HOST-B", x: 85, y: 88, subLabel: `${HOST_B_IP} · VLAN ${VLAN}`, kind: "server" },
  { id: "LEAF3", label: "LEAF3", x: 85, y: 58, subLabel: `VTEP ${VTEP_LOOPBACK.LEAF3}`, kind: "switch" },
];
export const GRAPH_EDGES: GEdge[] = [
  { id: "HOST-A-LEAF1", a: "HOST-A", b: "LEAF1" },
  { id: "HOST-B-LEAF3", a: "HOST-B", b: "LEAF3" },
  { id: "LEAF1-SPINE1", a: "LEAF1", b: "SPINE1", label: "Underlay" },
  { id: "LEAF2-SPINE1", a: "LEAF2", b: "SPINE1", label: "Underlay" },
  { id: "LEAF3-SPINE1", a: "LEAF3", b: "SPINE1", label: "Underlay" },
];
export const GRAPH_REGIONS = [{ id: "underlay", label: "IP Underlay Fabric (Spine-Leaf)", x: 4, y: 6, width: 92, height: 60, tone: "cyan" as const }];

export function withEvpnMesh(nodes: GNode[], edges: GEdge[], active: boolean): { nodes: GNode[]; edges: GEdge[] } {
  if (!active) return { nodes, edges };
  return {
    nodes,
    edges: [
      ...edges,
      { id: "LEAF1-LEAF2-evpn", a: "LEAF1", b: "LEAF2", label: "BGP EVPN" },
      { id: "LEAF2-LEAF3-evpn", a: "LEAF2", b: "LEAF3", label: "BGP EVPN" },
      { id: "LEAF1-LEAF3-evpn", a: "LEAF1", b: "LEAF3", label: "BGP EVPN" },
    ],
  };
}

/** Attachment moves with HOST-A's current node position; the logical view (brief §16) instead keeps identity and location as two permanently separate boxes. */
export function physicalNodesFor(hostALocation: LeafId): GNode[] {
  return GRAPH_NODES.map((n) => (n.id === "HOST-A" ? { ...n, x: hostALocation === "LEAF1" ? 15 : hostALocation === "LEAF2" ? 50 : 65, y: hostALocation === "LEAF3" ? 40 : 88 } : n));
}
export function physicalEdgesFor(hostALocation: LeafId): GEdge[] {
  return GRAPH_EDGES.map((e) => (e.id === "HOST-A-LEAF1" ? { ...e, a: "HOST-A", b: hostALocation } : e));
}

export const LOGICAL_GRAPH_NODES: GNode[] = [
  { id: "IDENTITY", label: "Endpoint Identity", x: 30, y: 20, subLabel: `${HOST_A_MAC} / ${HOST_A_IP}`, kind: "cloud" },
  { id: "LOCATION", label: "Current Location", x: 70, y: 20, subLabel: "Changes on move", kind: "cloud" },
  { id: "LEAF1", label: "LEAF1", x: 55, y: 55, kind: "switch" },
  { id: "LEAF2", label: "LEAF2", x: 85, y: 55, kind: "switch" },
];
export const LOGICAL_GRAPH_EDGES: GEdge[] = [{ id: "identity-location", a: "IDENTITY", b: "LOCATION", label: "unchanged ↔ changes" }];

// ---------------------------------------------------------------------------
// Packet builders
// ---------------------------------------------------------------------------

function frame(overrides: Partial<DataFrame> = {}): DataFrame {
  return { innerSrcMac: HOST_B_MAC, innerDstMac: HOST_A_MAC, innerSrcIp: HOST_B_IP, innerDstIp: HOST_A_IP, encapsulated: false, ...overrides };
}
function framePacket(id: string, from: EvpnMobilityDeviceId, to: EvpnMobilityDeviceId, summary: string, f: DataFrame): PacketVisual {
  return { id, protocol: f.encapsulated ? "VXLAN" : "ETHERNET", from, to, summary, badge: f.encapsulated ? "VXLAN" : "FRAME", layers: buildPacketLayers(f) };
}
function type2Packet(id: string, from: LeafId, to: LeafId, route: Type2Route): PacketVisual {
  return {
    id,
    protocol: "BGP",
    from,
    to,
    summary: `EVPN Type 2 — ${route.mac} (mobility seq ${route.mobilitySeq})`,
    badge: "EVPN UPDATE",
    layers: [{ name: "BGP UPDATE (EVPN)", color: "var(--pv-proto-bgp)", fields: [
      { label: "AFI/SAFI", value: "L2VPN EVPN" },
      { label: "Route Type", value: "2 (MAC/IP Advertisement)" },
      { label: "RD", value: route.rd },
      { label: "MAC Address", value: route.mac },
      { label: "IP Address", value: route.ip },
      { label: "Route Target", value: route.rt },
      { label: "Next Hop", value: route.nextHop },
      { label: "MAC Mobility Extended Community — Sequence", value: String(route.mobilitySeq) },
    ] }],
  };
}

function layerIndex(packet: PacketVisual | undefined, name: string): number[] | undefined {
  const i = packet?.layers.findIndex((l) => l.name === name) ?? -1;
  return i >= 0 ? [i] : undefined;
}
export function outerIpLayerIndex(packet: PacketVisual | undefined): number[] | undefined {
  return layerIndex(packet, "Outer IP");
}
export function vniLayerIndex(packet: PacketVisual | undefined): number[] | undefined {
  return layerIndex(packet, "VXLAN Header");
}

export { type2Packet, framePacket, frame as bridgeFrame };

// ---------------------------------------------------------------------------
// Scenario steps
// ---------------------------------------------------------------------------

export const evpnMobilitySteps: ScenarioStep<EvpnMobilityState>[] = [
  {
    id: "intro",
    label: "An Endpoint That Moves",
    narrative: `HOST-A (${HOST_A_MAC}, ${HOST_A_IP}) sits on LEAF1. HOST-B sits on LEAF3. LEAF2 also participates in VNI ${VNI} but doesn't host anything yet. Type 2 already taught every remote VTEP "HOST-A is behind LEAF1" — but what happens when that stops being true?`,
  },
  {
    id: "leaf1-local-learn",
    label: "LEAF1 Learns HOST-A Locally",
    narrative: `LEAF1 learns HOST-A on its own access port: MAC ${HOST_A_MAC}, IP ${HOST_A_IP}, LOCAL. Mobility Sequence: 0 — every endpoint's very first advertisement starts at sequence 0.`,
    run: (state) => {
      const macTables = { ...state.macTables, LEAF1: [{ mac: HOST_A_MAC, ip: HOST_A_IP, source: "local" as const, mobilitySeq: 0 }] };
      return { state: { ...state, bgpSessionUp: true, macTables }, events: [{ type: "MAC_LEARNED", stepId: "leaf1-local-learn", timestamp: Date.now(), message: "LEAF1 learns HOST-A locally" }, { type: "BGP_STATE_CHANGED", stepId: "leaf1-local-learn", timestamp: Date.now(), message: "LEAF1 ↔ LEAF2 ↔ LEAF3 BGP EVPN mesh Established" }] };
    },
  },
  {
    id: "type2-seq0-advertised",
    label: "Type 2, Sequence 0",
    narrative: "LEAF1 builds and advertises HOST-A's Type 2 route — Mobility Sequence 0, the baseline every future move will be compared against.",
    packet: (state) => (state.hostARoutes[0] ? type2Packet("t2-seq0", "LEAF1", "LEAF3", state.hostARoutes[0]) : undefined),
    run: (state) => {
      const { state: next, route } = originateMobilityRoute(state, "LEAF1");
      const selectedRouteByLeaf = { LEAF2: route, LEAF3: route };
      return { state: { ...next, selectedRouteByLeaf }, events: [{ type: "VPN_ROUTE_CREATED", stepId: "type2-seq0-advertised", timestamp: Date.now(), message: "LEAF1 advertises HOST-A, mobility sequence 0" }] };
    },
    whatChanged: () => ["LEAF2 and LEAF3: learn HOST-A remotely, via LEAF1, mobility sequence 0"],
  },
  {
    id: "remote-learn-recap",
    label: "Remote VTEPs Agree",
    narrative: `LEAF2 and LEAF3 both now show: HOST-A, MAC ${HOST_A_MAC}, IP ${HOST_A_IP}, remote VTEP LEAF1, sequence 0.`,
  },
  {
    id: "send-before-move",
    label: "BEFORE MOVE — HOST-B → HOST-A",
    narrative: "HOST-B sends toward HOST-A. LEAF3 looks up the MAC, finds remote VTEP LEAF1, and VXLAN-encapsulates toward it.",
    packet: () => framePacket("f-before", "HOST-B", "LEAF3", "HOST-B → HOST-A (before the move)", frame()),
    run: (state) => ({ state: { ...state, packet: frame(), packetAt: "LEAF3" }, events: [{ type: "PACKET_SENT", stepId: "send-before-move", timestamp: Date.now(), message: "HOST-B sends toward HOST-A" }] }),
  },
  {
    id: "before-move-journey",
    label: "Full Path — Via LEAF1",
    narrative: "HOST-B → LEAF3 → VXLAN → SPINE1 → LEAF1 → HOST-A. Saved as the BEFORE MOVE journey — we'll compare against it once HOST-A moves.",
    packet: (state) => (state.packet ? framePacket("f-before-vxlan", "LEAF3", "LEAF1", "VXLAN toward LEAF1", { ...state.packet, encapsulated: true, outerSrcVtep: VTEP_LOOPBACK.LEAF3, outerDstVtep: VTEP_LOOPBACK.LEAF1 }) : undefined),
    run: (state) => {
      const journey: JourneyHop[] = [
        { device: "LEAF3", input: "Ethernet frame", lookup: `MAC ${HOST_A_MAC} → remote VTEP LEAF1`, action: "L2_BRIDGE", output: `VXLAN(VNI ${VNI}) → ${VTEP_LOOPBACK.LEAF1}` },
        { device: "SPINE1", input: `Outer dst IP ${VTEP_LOOPBACK.LEAF1}`, lookup: "Underlay route lookup", action: "UNDERLAY_FORWARD", output: `Forward toward ${VTEP_LOOPBACK.LEAF1}` },
        { device: "LEAF1", input: `VXLAN(VNI ${VNI})`, lookup: "Local MAC → HOST-A access port", action: "L2_DELIVER", output: "Delivered to HOST-A" },
      ];
      return { state: { ...state, journey, beforeMoveJourney: journey, packetAt: "HOST-A" }, events: [{ type: "PACKET_RECEIVED", stepId: "before-move-journey", timestamp: Date.now(), message: "HOST-A receives — path confirmed via LEAF1" }] };
    },
  },
  {
    id: "move-host",
    label: "Move HOST-A",
    narrative: "Click MOVE HOST-A TO LEAF2 below — a genuine simulation-state change: HOST-A disconnects from LEAF1 and attaches to LEAF2. Its MAC and IP stay exactly the same; only its attachment changes.",
    action: (state) => ({ state: { ...moveEndpoint(state, "LEAF2"), moveCount: 1 }, events: [{ type: "MAC_LEARNED", stepId: "move-host", timestamp: Date.now(), message: "HOST-A physically attaches to LEAF2" }] }),
    requiresState: (state) => state.moveCount >= 1,
  },
  {
    id: "predict-what-must-evpn-do",
    label: "Predict",
    narrative: "Remote VTEPs currently believe HOST-A's MAC is behind LEAF1.",
    question: {
      prompt: "What must EVPN do now?",
      options: [
        { id: "change-mac", label: "Change HOST-A's MAC" },
        { id: "change-ip", label: "Change HOST-A's IP" },
        { id: "advertise-new", label: "Advertise the same endpoint from its new VTEP with newer mobility information" },
        { id: "flood-forever", label: "Flood every frame toward HOST-A forever" },
      ],
      correctOptionId: "advertise-new",
      explanation: "The endpoint's identity (MAC/IP) never changes just because it moved. What has to happen is a fresh Type 2 advertisement from the new location, carrying mobility information a remote VTEP can use to recognize it as newer than what it already has.",
    },
  },
  {
    id: "enter-leaf2-local-learn",
    label: "LEAF2 — Conceptual Local Endpoint Learning Pipeline",
    narrative: "Enter LEAF2: an access-port event occurs on VLAN 10, the source MAC is learned, its IP association is observed, and — critically — LEAF2 finds an EXISTING remote EVPN entry for this exact MAC. The endpoint is now local; LEAF2 must generate an updated Type 2 route.",
    run: (state) => ({ state, events: [{ type: "MAC_LEARNED", stepId: "enter-leaf2-local-learn", timestamp: Date.now(), message: "LEAF2 observes HOST-A locally — an existing remote entry already exists for this MAC" }] }),
  },
  {
    id: "mobility-community-intro",
    label: "The MAC Mobility Extended Community",
    narrative: "Only now does the mechanism get a name: the MAC Mobility Extended Community — a sequence number attached to a Type 2 route. A higher sequence identifies a newer mobility advertisement for this exact MAC. It is control-plane information carried on the BGP route, never a packet-hop counter and never present in an ordinary data packet.",
  },
  {
    id: "route-comparison",
    label: "MAC Mobility Comparison",
    narrative: "OLD (sequence 0, via LEAF1) vs. NEW (sequence 1, via LEAF2) — same MAC, same IP, same VNI. Only next-hop and sequence differ. The new route wins because its sequence is higher.",
    run: (state) => {
      const { state: next } = originateMobilityRoute(state, "LEAF2");
      return { state: next, events: [{ type: "VPN_ROUTE_CREATED", stepId: "route-comparison", timestamp: Date.now(), message: "LEAF2 generates a newer Type 2 route for HOST-A, mobility sequence 1" }] };
    },
  },
  {
    id: "type2-seq1-advertised",
    label: "BGP EVPN UPDATE — Sequence 1",
    narrative: "LEAF2 advertises the moved endpoint over the exact same BGP UPDATE mechanism every earlier EVPN route type reused.",
    packet: (state) => (state.hostARoutes[1] ? type2Packet("t2-seq1", "LEAF2", "LEAF3", state.hostARoutes[1]) : undefined),
    run: (state) => ({ state, events: [{ type: "MPBGP_VPN_ROUTE_ADVERTISED", stepId: "type2-seq1-advertised", timestamp: Date.now(), message: "LEAF2 advertises HOST-A, mobility sequence 1" }] }),
  },
  {
    id: "enter-leaf3-mobility-update",
    label: "LEAF3 — Conceptual EVPN Mobility Update Pipeline",
    narrative: "Auto-enter LEAF3 as the UPDATE arrives: Route Type 2, the same MAC/IP identity LEAF3 already has an entry for, its mobility sequence compared against what's on file — the newer advertisement is selected, the remote VTEP changes, and LEAF3's MAC/EVPN state is updated.",
    run: (state) => {
      const routes = state.hostARoutes;
      const selected = selectEndpointLocation(routes);
      if (!selected) return { state, events: [] };
      const macTables = { ...state.macTables, LEAF3: [...state.macTables.LEAF3.filter((e) => e.mac !== HOST_A_MAC), { mac: HOST_A_MAC, ip: HOST_A_IP, source: "remote" as const, remoteVtep: selected.nextHop, mobilitySeq: selected.mobilitySeq }] };
      return { state: { ...state, selectedRouteByLeaf: { ...state.selectedRouteByLeaf, LEAF3: selected }, macTables }, events: [{ type: "BGP_UPDATE_RECEIVED", stepId: "enter-leaf3-mobility-update", timestamp: Date.now(), message: "LEAF3 compares mobility sequences — newer advertisement selected" }] };
    },
  },
  {
    id: "remote-mac-before-after",
    label: "Before / After — LEAF3's Remote MAC Entry",
    narrative: `BEFORE: HOST-A, REMOTE, VTEP LEAF1. AFTER: HOST-A, REMOTE, VTEP LEAF2. The old entry doesn't sit alongside the new one as an equally valid alternative — it's replaced, because the mobility comparison determined it's no longer current.`,
    whatChanged: () => ["LEAF3: HOST-A remote VTEP — BEFORE: LEAF1 (seq 0)", "LEAF3: HOST-A remote VTEP — AFTER: LEAF2 (seq 1)"],
  },
  {
    id: "route-lifecycle-recap",
    label: "Old Route, New Route, Selected Route",
    narrative: "Four distinct things, not one: the OLD route (seq 0, still exists in history) — the NEW route (seq 1) — the SELECTED route (whichever one comparison says is current) — and the forwarding entry (what LEAF3 actually installs, following the selected route). A route isn't deleted just because it stopped being selected.",
  },
  {
    id: "send-after-move",
    label: "AFTER MOVE — HOST-B → HOST-A, Again",
    narrative: "Send the exact same traffic again. Compare both journeys: BEFORE went HOST-B → LEAF3 → VXLAN → LEAF1 → HOST-A. Watch what happens now.",
    packet: () => framePacket("f-after", "HOST-B", "LEAF3", "HOST-B → HOST-A (after the move)", frame()),
    run: (state) => ({ state: { ...state, packet: frame(), packetAt: "LEAF3" }, events: [{ type: "PACKET_SENT", stepId: "send-after-move", timestamp: Date.now(), message: "HOST-B sends toward HOST-A again" }] }),
  },
  {
    id: "after-move-journey",
    label: "Full Path — Now Via LEAF2",
    narrative: "HOST-B → LEAF3 → VXLAN → SPINE1 → LEAF2 → HOST-A. Same source, same destination, same MAC/IP identity — a completely different path, because the selected route changed.",
    packet: (state) => (state.packet ? framePacket("f-after-vxlan", "LEAF3", "LEAF2", "VXLAN toward LEAF2", { ...state.packet, encapsulated: true, outerSrcVtep: VTEP_LOOPBACK.LEAF3, outerDstVtep: VTEP_LOOPBACK.LEAF2 }) : undefined),
    run: (state) => {
      const journey: JourneyHop[] = [
        { device: "LEAF3", input: "Ethernet frame", lookup: `MAC ${HOST_A_MAC} → remote VTEP LEAF2 (selected, seq 1)`, action: "L2_BRIDGE", output: `VXLAN(VNI ${VNI}) → ${VTEP_LOOPBACK.LEAF2}` },
        { device: "SPINE1", input: `Outer dst IP ${VTEP_LOOPBACK.LEAF2}`, lookup: "Underlay route lookup", action: "UNDERLAY_FORWARD", output: `Forward toward ${VTEP_LOOPBACK.LEAF2}` },
        { device: "LEAF2", input: `VXLAN(VNI ${VNI})`, lookup: "Local MAC → HOST-A access port", action: "L2_DELIVER", output: "Delivered to HOST-A" },
      ];
      return { state: { ...state, journey, packetAt: "HOST-A" }, events: [{ type: "PACKET_RECEIVED", stepId: "after-move-journey", timestamp: Date.now(), message: "HOST-A receives — path now via LEAF2" }] };
    },
  },
  {
    id: "cause-effect-recap",
    label: "The Core Lesson",
    narrative: "Physical host move → local MAC learning → new Type 2 → higher mobility sequence → EVPN UPDATE → remote MAC table changed → remote VTEP changed → data path changed. Every later effect traces back to one physical event.",
  },
  {
    id: "control-data-recap",
    label: "Control Plane Changed The Route; Data Plane Followed",
    narrative: "Control plane: HOST-A moves → LEAF2 advertises Type 2 sequence 1 → LEAF3 updates the endpoint's location. Data plane: HOST-B's traffic now VXLANs toward LEAF2. The route update is the cause; the changed packet path is the effect.",
  },
  {
    id: "identity-vs-location",
    label: "Identity vs. Location",
    narrative: `Endpoint identity — MAC ${HOST_A_MAC}, IP ${HOST_A_IP} — never changed. Only its location did: LEAF1 → LEAF2. Switch to Logical view to see these drawn as two permanently separate things.`,
  },
  {
    id: "stale-forwarding-demo",
    label: "What If LEAF3 Kept The Old Entry?",
    narrative: "Before the fault: a quick thought experiment. If LEAF3 had simply kept forwarding to its old AA:AA:AA:AA:AA:11 → LEAF1 entry, a packet would still reach LEAF1 — where HOST-A is no longer locally attached at all. That's stale forwarding state. The EVPN mobility update is exactly what prevents this from actually happening.",
    run: (state) => ({ state: { ...state, staleDemoShown: true }, events: [] }),
  },
  {
    id: "break-intro",
    label: "Break The Fabric",
    narrative: "Everything has worked cleanly so far. Time to inject one controlled, educational fault: LEAF3 receives the newer Type 2 route but its mobility comparison state is broken, so it incorrectly keeps the older one. This is a simulation fault built to teach the decision chain — not a claim about a common vendor bug.",
  },
  {
    id: "fault-injected",
    label: "LEAF3's Mobility Comparison Fails",
    narrative: "Physical, underlay, VTEP reachability, BGP EVPN, and the new Type 2 route's arrival are all still healthy. LEAF3 simply fails to act on the comparison — it keeps forwarding to LEAF1.",
    run: (state) => ({
      state: { ...state, selectedRouteByLeaf: { ...state.selectedRouteByLeaf, LEAF3: { ...state.hostARoutes[0], stale: true } }, macTables: { ...state.macTables, LEAF3: [...state.macTables.LEAF3.filter((e) => e.mac !== HOST_A_MAC), { mac: HOST_A_MAC, ip: HOST_A_IP, source: "remote" as const, remoteVtep: VTEP_LOOPBACK.LEAF1, mobilitySeq: 0, stale: true }] }, faultActive: true },
      events: [{ type: "BGP_UPDATE_RECEIVED", stepId: "fault-injected", timestamp: Date.now(), message: "LEAF3 receives sequence 1 but its mobility comparison state incorrectly keeps sequence 0" }],
    }),
    whatChanged: () => ["LEAF3: mobility comparison broken — kept sequence 0 / LEAF1 despite receiving sequence 1"],
  },
  {
    id: "trouble-intro",
    label: "Troubleshoot",
    narrative: "Complaint: \"HOST-A physically sits on LEAF2, but traffic from HOST-B still goes toward LEAF1.\" Physical, underlay, BGP EVPN, and the new Type 2 route's arrival at LEAF3 all check out. Inspect LEAF3's own mobility comparison and selected route.",
  },
  {
    id: "trouble-question",
    label: "Troubleshoot",
    narrative: "Every layer up through the new route's arrival is healthy.",
    question: {
      prompt: "Where does forwarding actually break?",
      options: [
        { id: "bgp-evpn", label: "The BGP EVPN session itself" },
        { id: "identity", label: "MAC/IP identity match" },
        { id: "comparison", label: "LEAF3's mobility sequence comparison / route selection" },
        { id: "underlay", label: "Underlay reachability to LEAF2" },
      ],
      correctOptionId: "comparison",
      explanation: "LEAF3 received the newer, sequence-1 route just fine — its own comparison/selection logic simply failed to act on it, so it kept forwarding to the older, sequence-0 location. Receiving a route is not the same as selecting it.",
      hints: [
        "Hint 1: the new Type 2 route did arrive at LEAF3 — this isn't a BGP session or reachability problem.",
        "Hint 2: MAC/IP identity matches perfectly on both routes — that's not what's broken.",
        "Hint 3: compare which route LEAF3 has actually SELECTED against which one it received.",
      ],
    },
  },
  {
    id: "diagnostic-layers",
    label: "Layer By Layer",
    narrative: "A newer route can be fully received and still not win, if the receiving leaf's own comparison/selection logic doesn't act on it. Received ≠ selected — the same principle as every earlier 'route known ≠ usable' lesson, now applied to mobility specifically.",
  },
  {
    id: "repair-challenge",
    label: "Apply The Fix",
    narrative: "Find the moving host — repair LEAF3's mobility state so it selects HOST-A's current location.",
    action: (state, payload) => {
      const choice = typeof payload === "object" && payload !== null && "choice" in payload ? String((payload as { choice: string }).choice) : "";
      if (choice !== "repair-mobility") return { state: { ...state, repairAttempt: { choice, correct: false } }, events: [] };
      const selected = selectEndpointLocation(state.hostARoutes);
      if (!selected) return { state: { ...state, repairAttempt: { choice, correct: false } }, events: [] };
      const macTables = { ...state.macTables, LEAF3: [...state.macTables.LEAF3.filter((e) => e.mac !== HOST_A_MAC), { mac: HOST_A_MAC, ip: HOST_A_IP, source: "remote" as const, remoteVtep: selected.nextHop, mobilitySeq: selected.mobilitySeq }] };
      return { state: { ...state, selectedRouteByLeaf: { ...state.selectedRouteByLeaf, LEAF3: selected }, macTables, faultActive: false, repairAttempt: { choice, correct: true }, challengeSucceeded: true }, events: [{ type: "ROUTE_SELECTED", stepId: "repair-challenge", timestamp: Date.now(), message: "LEAF3's mobility comparison repaired — sequence 1 / LEAF2 now selected" }] };
    },
    requiresState: (state) => state.challengeSucceeded === true,
  },
  {
    id: "verify-dataplane",
    label: "Verify End To End",
    narrative: "Resend HOST-B → HOST-A to prove the repair actually restored the correct path.",
    packet: () => framePacket("f-verify", "HOST-B", "LEAF3", "Verification frame", frame()),
    run: (state) => {
      const journey: JourneyHop[] = [
        { device: "LEAF3", input: "Ethernet frame", lookup: `MAC ${HOST_A_MAC} → remote VTEP LEAF2 (selected, seq 1)`, action: "L2_BRIDGE", output: `VXLAN(VNI ${VNI}) → ${VTEP_LOOPBACK.LEAF2}` },
        { device: "SPINE1", input: `Outer dst IP ${VTEP_LOOPBACK.LEAF2}`, lookup: "Underlay route lookup", action: "UNDERLAY_FORWARD", output: `Forward toward ${VTEP_LOOPBACK.LEAF2}` },
        { device: "LEAF2", input: `VXLAN(VNI ${VNI})`, lookup: "Local MAC → HOST-A access port", action: "L2_DELIVER", output: "Delivered to HOST-A" },
      ];
      return { state: { ...state, packet: { ...frame(), encapsulated: false }, packetAt: "HOST-A", journey }, events: [{ type: "PACKET_RECEIVED", stepId: "verify-dataplane", timestamp: Date.now(), message: "HOST-A reachable through LEAF2 again" }] };
    },
    whatChanged: () => ["✓ Mobility comparison repaired", "✓ LEAF3 selects sequence 1 / LEAF2", "✓ Remote MAC table corrected", "✓ HOST-A reachable through LEAF2"],
  },
  {
    id: "second-move-optional",
    label: "Optional — HOST-A Moves Again",
    narrative: "HOST-A moves once more: LEAF2 → LEAF1. Watch the sequence progress again — 1 → 2 — proving this isn't a one-time special case, it's the same mechanism every time an endpoint moves.",
    run: (state) => {
      const moved = moveEndpoint(state, "LEAF1");
      const { state: next, route } = originateMobilityRoute(moved, "LEAF1");
      const macTables = { ...next.macTables, LEAF3: [...next.macTables.LEAF3.filter((e) => e.mac !== HOST_A_MAC), { mac: HOST_A_MAC, ip: HOST_A_IP, source: "remote" as const, remoteVtep: VTEP_LOOPBACK.LEAF1, mobilitySeq: route.mobilitySeq }] };
      return { state: { ...next, macTables, selectedRouteByLeaf: { ...next.selectedRouteByLeaf, LEAF3: route }, moveCount: 2 }, events: [{ type: "VPN_ROUTE_CREATED", stepId: "second-move-optional", timestamp: Date.now(), message: "HOST-A moves again — mobility sequence 2" }] };
    },
    whatChanged: () => ["HOST-A: LEAF2 → LEAF1", "Mobility sequence: 1 → 2", "LEAF3: remote VTEP updated to LEAF1 again"],
  },
  {
    id: "mobility-vs-multihoming",
    label: "Mobility Is Not Multihoming",
    narrative: "MAC Mobility: an endpoint moves from one location to another, one at a time — exactly what this lesson built. EVPN Multihoming: an endpoint (or a whole network segment) is intentionally attached through multiple VTEPs AT ONCE, on purpose, for redundancy. Different problems, different mechanisms — multihoming and ESI/DF election belong in a later lesson.",
  },
  {
    id: "complete",
    label: "Lesson Complete",
    narrative: "HOST-A moved twice, kept the exact same MAC and IP both times, and every remote VTEP correctly followed it — a newer Type 2 advertisement, recognized by its mobility sequence, is all it took.",
  },
];
