import type { PacketVisual, ScenarioStep } from "../types";
import { HOST_A_IP, HOST_A_MAC, HOST_B_IP, HOST_B_MAC, VLAN, VNI, VTEP_LOOPBACK as FOUNDATIONS_VTEP_LOOPBACK, buildPacketLayers, type DataFrame } from "./evpnVxlan";

export { VNI, VLAN, HOST_A_IP, HOST_A_MAC, HOST_B_IP, HOST_B_MAC };

/**
 * EVPN BUM Handling + Route Type 3 (IMET) — the second lesson in the
 * EVPN track, building directly on "EVPN + VXLAN Foundations"
 * (`evpnVxlan.ts`). Reuses that lesson's VXLAN wire-format helpers
 * (`buildPacketLayers`, `DataFrame`) and host/VTEP identities for
 * LEAF1/LEAF2 verbatim — this is the SAME fabric with one leaf added,
 * not a new one. See docs/ARCHITECTURE.md §4 for why this reuses
 * pure functions/constants from another lesson's scenario file
 * rather than importing its state type.
 *
 * The question this lesson answers: Route Type 2 (the previous
 * lesson) tells a VTEP "where is this MAC/IP?" — but a broadcast,
 * unknown-unicast, or multicast (BUM) frame has no single answer to
 * that question. Something else has to tell LEAF1 which *other*
 * VTEPs even participate in VNI 10010 at all, so it knows who to
 * replicate toward. That's Route Type 3 (Inclusive Multicast
 * Ethernet Tag — IMET): a VTEP's announcement "I'm here, in VNI
 * 10010" — never a MAC/IP reachability route.
 *
 * Explicitly DEFERRED (unchanged from the Foundations lesson's own
 * boundary, extended): Route Types 1/4/5, EVPN multihoming, Ethernet
 * Segment/ESI, DF election, aliasing, mass withdrawal, IRB (symmetric/
 * asymmetric), anycast gateway, MAC mobility, ARP/ND suppression,
 * EVPN-MPLS, EVPN-VPWS, and underlay (PIM/BIER) multicast replication
 * — this lesson teaches ingress (head-end) replication only, and says
 * so explicitly, rather than implying it's the only way BUM is ever
 * handled in real EVPN fabrics.
 *
 * Pure data + pure functions only — see /lib/sim-engine/types.ts.
 */

export type LeafId = "LEAF1" | "LEAF2" | "LEAF3";
export type EvpnBumDeviceId = "HOST-A" | LeafId | "SPINE1" | "HOST-B" | "HOST-C";
export const LEAF_IDS: LeafId[] = ["LEAF1", "LEAF2", "LEAF3"];
export const FABRIC_DEVICES: EvpnBumDeviceId[] = ["LEAF1", "SPINE1", "LEAF2", "LEAF3"];

export const VTEP_LOOPBACK: Record<LeafId, string> = { ...FOUNDATIONS_VTEP_LOOPBACK, LEAF3: "10.255.0.3" };
export const HOST_FOR_LEAF: Record<LeafId, "HOST-A" | "HOST-B" | "HOST-C"> = { LEAF1: "HOST-A", LEAF2: "HOST-B", LEAF3: "HOST-C" };
export const HOST_C_IP = "10.10.10.33";
export const HOST_C_MAC = "CC:CC:CC:CC:CC:33";

export const BROADCAST_MAC = "FF:FF:FF:FF:FF:FF";

export const EVPN_EXPORT_RT = "65000:10010";
const CORRECT_IMPORT_RT: Record<LeafId, string> = { LEAF1: "65000:10010", LEAF2: "65000:10010", LEAF3: "65000:10010" };
const BROKEN_EXPORT_RT = "65000:99999";
function rdFor(leaf: LeafId): string {
  return `${VTEP_LOOPBACK[leaf]}:${VNI}`;
}

export const TERMS: { term: string; expansion: string; meaning: string }[] = [
  { term: "BUM", expansion: "Broadcast, Unknown-unicast, Multicast", meaning: "Traffic with no single known destination — the frame a VTEP can't just forward to one place." },
  { term: "Type 3", expansion: "Inclusive Multicast Ethernet Tag (IMET)", meaning: "A VTEP announcing \"I participate in this VNI\" — builds the flood list, never MAC/IP reachability." },
  { term: "Flood List", expansion: "VNI Replication Set", meaning: "The set of remote VTEPs a given VTEP must replicate BUM traffic toward, for one VNI." },
  { term: "Ingress Replication", expansion: "Head-End Replication", meaning: "The INGRESS VTEP itself creates one VXLAN copy per remote VTEP — not the only way EVPN can replicate BUM, but the one this lesson teaches first." },
  { term: "Type 2 vs 3", expansion: "Reachability vs. Membership", meaning: "Type 2 answers \"where is this MAC/IP?\" Type 3 answers \"which VTEPs are even in this broadcast domain?\" — different questions, different routes." },
];

// ---------------------------------------------------------------------------
// Type 3 (IMET) route + flood-list model
// ---------------------------------------------------------------------------

export interface Type3Route {
  originLeaf: LeafId;
  vtep: string;
  vni: number;
  rd: string;
  rt: string;
}

export interface ReceivedType3Route {
  route: Type3Route;
  rtChecked: boolean;
  rtMatched: boolean;
  imported: boolean;
}

export type ReplicaStage = "none" | "leaf1-to-spine" | "spine-to-leaves" | "delivered";
export interface BumReplica {
  id: string;
  toLeaf: LeafId;
}

export type BumAction = "CLASSIFY_AND_REPLICATE" | "UNDERLAY_FORWARD" | "DECAP_AND_DELIVER";
export interface BumJourneyHop {
  device: EvpnBumDeviceId;
  input: string;
  lookup: string;
  action: BumAction;
  output: string;
}

export interface EvpnBumState {
  exportRt: Record<LeafId, string>; // each leaf's OWN Type-3 export RT — the fault lives here (LEAF3's)
  importRt: Record<LeafId, string>;
  type3Routes: Partial<Record<LeafId, Type3Route>>; // what each leaf has actually advertised so far
  received: Partial<Record<LeafId, ReceivedType3Route[]>>; // what each leaf received FROM the other two
  floodList: Record<LeafId, LeafId[]>; // each leaf's OWN current replication set (derived from received+imported Type-3 routes)
  bgpSessionUp: boolean;

  packet?: DataFrame; // the original broadcast frame, before LEAF1 replicates it
  packetAt?: EvpnBumDeviceId;
  replicaStage: ReplicaStage;
  replicas: BumReplica[];
  journey: BumJourneyHop[];

  faultActive: boolean;
  repairAttempt?: { choice: string; correct: boolean };
  challengeSucceeded?: boolean;
}

export function createEvpnBumState(): EvpnBumState {
  return {
    exportRt: { LEAF1: EVPN_EXPORT_RT, LEAF2: EVPN_EXPORT_RT, LEAF3: EVPN_EXPORT_RT },
    importRt: { ...CORRECT_IMPORT_RT },
    type3Routes: {},
    received: {},
    floodList: { LEAF1: [], LEAF2: [], LEAF3: [] },
    bgpSessionUp: false,
    replicaStage: "none",
    replicas: [],
    journey: [],
    faultActive: false,
  };
}

// ---------------------------------------------------------------------------
// Graph layout (brief: SPINE1 hub, three leafs, three hosts)
// ---------------------------------------------------------------------------

export const GRAPH_NODES = [
  { id: "HOST-A", label: "HOST-A", x: 12, y: 88, subLabel: HOST_A_IP, kind: "server" as const },
  { id: "LEAF1", label: "LEAF1", x: 15, y: 58, subLabel: `VTEP ${VTEP_LOOPBACK.LEAF1}`, kind: "switch" as const },
  { id: "SPINE1", label: "SPINE1", x: 50, y: 18, subLabel: "Underlay only", kind: "switch" as const },
  { id: "HOST-B", label: "HOST-B", x: 50, y: 88, subLabel: HOST_B_IP, kind: "server" as const },
  { id: "LEAF2", label: "LEAF2", x: 50, y: 58, subLabel: `VTEP ${VTEP_LOOPBACK.LEAF2}`, kind: "switch" as const },
  { id: "HOST-C", label: "HOST-C", x: 88, y: 88, subLabel: HOST_C_IP, kind: "server" as const },
  { id: "LEAF3", label: "LEAF3", x: 85, y: 58, subLabel: `VTEP ${VTEP_LOOPBACK.LEAF3}`, kind: "switch" as const },
];
export const GRAPH_EDGES = [
  { id: "HOST-A-LEAF1", a: "HOST-A", b: "LEAF1" },
  { id: "HOST-B-LEAF2", a: "HOST-B", b: "LEAF2" },
  { id: "HOST-C-LEAF3", a: "HOST-C", b: "LEAF3" },
  { id: "LEAF1-SPINE1", a: "LEAF1", b: "SPINE1", label: "Underlay" },
  { id: "LEAF2-SPINE1", a: "LEAF2", b: "SPINE1", label: "Underlay" },
  { id: "LEAF3-SPINE1", a: "LEAF3", b: "SPINE1", label: "Underlay" },
];
export const GRAPH_REGIONS = [{ id: "underlay", label: "IP Underlay Fabric (Spine-Leaf)", x: 4, y: 6, width: 92, height: 60, tone: "cyan" as const }];

/** The control-plane-only BGP EVPN mesh — never a data-plane hop, spliced in only once the session's up (mirrors the Foundations lesson's `withEvpnSession`, extended to a 3-way mesh). */
export function withEvpnMesh<N extends { id: string; x: number; y: number }, E extends { id: string; a: string; b: string; label?: string }>(nodes: N[], edges: E[], active: boolean): { nodes: N[]; edges: E[] } {
  if (!active) return { nodes, edges };
  return {
    nodes,
    edges: [
      ...edges,
      { id: "LEAF1-LEAF2-evpn", a: "LEAF1", b: "LEAF2", label: "BGP EVPN" } as E,
      { id: "LEAF2-LEAF3-evpn", a: "LEAF2", b: "LEAF3", label: "BGP EVPN" } as E,
      { id: "LEAF1-LEAF3-evpn", a: "LEAF1", b: "LEAF3", label: "BGP EVPN" } as E,
    ],
  };
}

/** Simplified logical view — one flattened L2 segment over VNI 10010, spine hidden, all three sites spoking off the same overlay cloud. */
export const LOGICAL_GRAPH_NODES = [
  { id: "HOST-A", label: "HOST-A", x: 8, y: 18, subLabel: HOST_A_IP, kind: "server" as const },
  { id: "LEAF1", label: "LEAF1", x: 26, y: 18, subLabel: `VTEP ${VTEP_LOOPBACK.LEAF1}`, kind: "switch" as const },
  { id: "HOST-B", label: "HOST-B", x: 92, y: 18, subLabel: HOST_B_IP, kind: "server" as const },
  { id: "LEAF2", label: "LEAF2", x: 74, y: 18, subLabel: `VTEP ${VTEP_LOOPBACK.LEAF2}`, kind: "switch" as const },
  { id: "VNI-10010", label: "VNI 10010", x: 50, y: 55, subLabel: "Logical L2 segment", kind: "cloud" as const },
  { id: "LEAF3", label: "LEAF3", x: 50, y: 85, subLabel: `VTEP ${VTEP_LOOPBACK.LEAF3}`, kind: "switch" as const },
  { id: "HOST-C", label: "HOST-C", x: 50, y: 99, subLabel: HOST_C_IP, kind: "server" as const },
];
export const LOGICAL_GRAPH_EDGES = [
  { id: "HOST-A-LEAF1", a: "HOST-A", b: "LEAF1" },
  { id: "LEAF1-VNI", a: "LEAF1", b: "VNI-10010", label: "VNI 10010" },
  { id: "HOST-B-LEAF2", a: "HOST-B", b: "LEAF2" },
  { id: "LEAF2-VNI", a: "LEAF2", b: "VNI-10010", label: "VNI 10010" },
  { id: "LEAF3-VNI", a: "LEAF3", b: "VNI-10010", label: "VNI 10010" },
  { id: "HOST-C-LEAF3", a: "HOST-C", b: "LEAF3" },
];

// ---------------------------------------------------------------------------
// Packet builders
// ---------------------------------------------------------------------------

function broadcastFrame(overrides: Partial<DataFrame> = {}): DataFrame {
  return { innerSrcMac: HOST_A_MAC, innerDstMac: BROADCAST_MAC, innerSrcIp: HOST_A_IP, innerDstIp: "255.255.255.255", encapsulated: false, ...overrides };
}

function framePacket(id: string, from: EvpnBumDeviceId, to: EvpnBumDeviceId, summary: string, frame: DataFrame): PacketVisual {
  return { id, protocol: frame.encapsulated ? "VXLAN" : "ETHERNET", from, to, summary, badge: frame.encapsulated ? "VXLAN" : "BROADCAST", layers: buildPacketLayers(frame) };
}

/** One in-flight replica's own packet, addressed to its specific remote VTEP — the whole point being that HOST-A sent exactly one frame, but each replica is its own independent VXLAN packet with its own outer destination. */
export function replicaPacket(replica: BumReplica, from: EvpnBumDeviceId, to: EvpnBumDeviceId, encapsulated: boolean): PacketVisual {
  const frame: DataFrame = broadcastFrame({ encapsulated, outerSrcVtep: VTEP_LOOPBACK.LEAF1, outerDstVtep: VTEP_LOOPBACK[replica.toLeaf] });
  return framePacket(`bum-${replica.id}`, from, to, `${encapsulated ? "VXLAN copy" : "Frame"} toward ${replica.toLeaf} (${VTEP_LOOPBACK[replica.toLeaf]})`, frame);
}

function type3Packet(id: string, from: LeafId, to: LeafId, route: Type3Route): PacketVisual {
  return {
    id,
    protocol: "BGP",
    from,
    to,
    summary: `EVPN Type 3 (IMET) — ${from} announces VNI ${route.vni}`,
    badge: "IMET UPDATE",
    layers: [
      {
        name: "BGP UPDATE (EVPN)",
        color: "var(--pv-proto-bgp)",
        fields: [
          { label: "AFI/SAFI", value: "L2VPN EVPN" },
          { label: "Route Type", value: "3 (Inclusive Multicast Ethernet Tag)" },
          { label: "RD", value: route.rd },
          { label: "Originating Router's IP", value: route.vtep },
          { label: "VNI", value: String(route.vni) },
          { label: "Route Target", value: route.rt },
        ],
      },
    ],
  };
}

// X-ray focus indices — reused shape from the Foundations lesson (Outer IP only at the spine; VNI header at egress leafs).
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

// ---------------------------------------------------------------------------
// Scenario steps
// ---------------------------------------------------------------------------

export const evpnBumSteps: ScenarioStep<EvpnBumState>[] = [
  {
    id: "intro",
    label: "A Third Site Joins",
    narrative:
      "The same VNI 10010 now spans three leafs: LEAF1 (HOST-A), LEAF2 (HOST-B), and the newly added LEAF3 (HOST-C) — all behind SPINE1. Unicast between any two of them already works the way the previous lesson taught: a Type 2 route says exactly which VTEP owns a given MAC. But not every frame has one destination.",
  },
  {
    id: "predict-bum-problem",
    label: "Predict",
    narrative: "Before naming the mechanism:",
    question: {
      prompt: "HOST-A sends a frame with destination MAC FF:FF:FF:FF:FF:FF (a broadcast). Which remote VTEPs should LEAF1 replicate it toward?",
      options: [
        { id: "none", label: "None — broadcast traffic never leaves the local switch" },
        { id: "closest", label: "Only LEAF2, because it's the \"closest\" remote VTEP" },
        { id: "all-members", label: "Every remote VTEP that participates in VNI 10010" },
        { id: "spine-decides", label: "SPINE1 decides, based on the frame's contents" },
      ],
      correctOptionId: "all-members",
      explanation:
        "A broadcast (or any BUM frame) has to reach every device in the same broadcast domain — that's what \"broadcast domain\" means. Across a VXLAN fabric, that's every remote VTEP that participates in VNI 10010, not just one, and not decided by the underlay.",
    },
  },
  {
    id: "bum-intro",
    label: "BUM",
    narrative:
      "BUM = Broadcast, Unknown-unicast, Multicast — any frame LEAF1 can't resolve to exactly one known destination MAC. A Type 2 route (the previous lesson) only ever answers \"where is THIS MAC?\" It has nothing to say about a frame with no single MAC to look up.",
  },
  {
    id: "predict-flood-list-source",
    label: "Predict",
    narrative: "Before LEAF1 can replicate anything, it needs a list of who to replicate to:",
    question: {
      prompt: "How does LEAF1 learn which other VTEPs currently participate in VNI 10010?",
      options: [
        { id: "flood-underlay", label: "It floods to every device in the underlay, VNI or not" },
        { id: "bgp-evpn-route", label: "A BGP EVPN control-plane route tells it" },
        { id: "spine-tells-it", label: "SPINE1 tells it directly" },
        { id: "manual-per-vtep", label: "An operator configures each remote VTEP by hand, one at a time" },
      ],
      correctOptionId: "bgp-evpn-route",
      explanation:
        "Same pattern as Type 2, applied to a different question: a control-plane route, not manual configuration and not the underlay flooding blindly, tells LEAF1 exactly which VTEPs are in VNI 10010 right now.",
    },
  },
  {
    id: "type3-intro",
    label: "EVPN Route Type 3 (IMET)",
    narrative:
      "That route is EVPN Route Type 3 — Inclusive Multicast Ethernet Tag (IMET). Each VTEP advertises one Type 3 route per VNI it participates in: not \"here's a MAC,\" just \"I'm here, in VNI 10010.\" Type 2 answers \"where is this MAC/IP?\" Type 3 answers \"which VTEPs are even in this broadcast domain?\" — genuinely different questions, carried as genuinely different routes.",
    run: (state) => ({ state: { ...state, bgpSessionUp: true }, events: [{ type: "BGP_STATE_CHANGED", stepId: "type3-intro", timestamp: Date.now(), message: "LEAF1 ↔ LEAF2 ↔ LEAF3 BGP EVPN mesh Established" }] }),
    whatChanged: () => ["LEAF1 ↔ LEAF2 ↔ LEAF3 BGP EVPN session: Established"],
  },
  {
    id: "type3-advertised",
    label: "Every Leaf Advertises Type 3",
    narrative: `Each leaf advertises its own Type 3 route for VNI ${VNI}: RD unique per leaf, RT ${EVPN_EXPORT_RT} shared, next-hop = its own VTEP. Watch LEAF1 → LEAF2's copy — the same exchange happens, pairwise, between every leaf.`,
    packet: (state) => (state.type3Routes.LEAF1 ? type3Packet("t3-l1-l2", "LEAF1", "LEAF2", state.type3Routes.LEAF1) : undefined),
    run: (state) => {
      const routes: Record<LeafId, Type3Route> = {
        LEAF1: { originLeaf: "LEAF1", vtep: VTEP_LOOPBACK.LEAF1, vni: VNI, rd: rdFor("LEAF1"), rt: state.exportRt.LEAF1 },
        LEAF2: { originLeaf: "LEAF2", vtep: VTEP_LOOPBACK.LEAF2, vni: VNI, rd: rdFor("LEAF2"), rt: state.exportRt.LEAF2 },
        LEAF3: { originLeaf: "LEAF3", vtep: VTEP_LOOPBACK.LEAF3, vni: VNI, rd: rdFor("LEAF3"), rt: state.exportRt.LEAF3 },
      };
      const received: Partial<Record<LeafId, ReceivedType3Route[]>> = {};
      const floodList: Record<LeafId, LeafId[]> = { LEAF1: [], LEAF2: [], LEAF3: [] };
      for (const self of LEAF_IDS) {
        const others = LEAF_IDS.filter((l) => l !== self);
        received[self] = others.map((origin) => {
          const route = routes[origin];
          const rtMatched = route.rt === state.importRt[self];
          return { route, rtChecked: true, rtMatched, imported: rtMatched };
        });
        floodList[self] = received[self]!.filter((r) => r.imported).map((r) => r.route.originLeaf);
      }
      return {
        state: { ...state, type3Routes: routes, received, floodList },
        events: [{ type: "MPBGP_VPN_ROUTE_ADVERTISED", stepId: "type3-advertised", timestamp: Date.now(), message: "All three leafs advertise Type 3 (IMET) routes for VNI 10010" }],
      };
    },
    whatChanged: () => [`LEAF1 flood list: LEAF2, LEAF3`, `LEAF2 flood list: LEAF1, LEAF3`, `LEAF3 flood list: LEAF1, LEAF2`],
  },
  {
    id: "flood-list-built",
    label: "Flood List Built",
    narrative: `Every leaf now has a real, BGP-distributed answer to "who else is in VNI ${VNI}?" — LEAF1's flood list: LEAF2, LEAF3. This is exactly what LEAF1 will consult the moment a BUM frame arrives — nothing here has anything to do with any specific host's MAC address.`,
  },
  {
    id: "predict-type2-vs-type3",
    label: "Predict",
    narrative: "One more distinction before the first broadcast moves:",
    question: {
      prompt: "LEAF1 already holds a Type 2 route for HOST-B (via LEAF2). Does that route also tell LEAF1 which VTEPs to flood a broadcast frame toward?",
      options: [
        { id: "yes", label: "Yes — Type 2 already covers this" },
        { id: "no", label: "No — Type 2 is one host's reachability; VNI-wide membership is Type 3's job" },
      ],
      correctOptionId: "no",
      explanation: "A Type 2 route is scoped to one MAC/IP. It says nothing about the fabric-wide set of VTEPs in a VNI — that's a completely separate fact, carried by a completely separate route type.",
    },
  },
  {
    id: "send-broadcast",
    label: "HOST-A Sends A Broadcast",
    narrative: "HOST-A sends one Ethernet frame — destination MAC FF:FF:FF:FF:FF:FF. Exactly one frame leaves HOST-A's NIC.",
    packet: () => framePacket("f-host-a-bum", "HOST-A", "LEAF1", "Broadcast Ethernet frame — HOST-A", broadcastFrame()),
    run: (state) => ({ state: { ...state, packet: broadcastFrame(), packetAt: "LEAF1" }, events: [{ type: "PACKET_SENT", stepId: "send-broadcast", timestamp: Date.now(), message: "HOST-A sends a broadcast frame" }] }),
  },
  {
    id: "leaf1-bum-classify",
    label: "LEAF1 — Conceptual BUM Forwarding Pipeline",
    narrative:
      "Enter LEAF1's Conceptual BUM Forwarding Pipeline: the frame arrives on the access port, LEAF1 determines the VNI, classifies the destination — this is BUM, not a known unicast MAC — consults the VNI 10010 flood list, and creates one VXLAN copy per remote VTEP on that list. One frame in; two VXLAN packets out.",
    packet: (state) => (state.packet ? framePacket("f-leaf1-classify", "HOST-A", "LEAF1", "Classified as BUM — consulting flood list", state.packet) : undefined),
    run: (state) => {
      const remotes = state.floodList.LEAF1;
      const replicas: BumReplica[] = remotes.map((toLeaf) => ({ id: `rep-${toLeaf}`, toLeaf }));
      const journey = [
        ...state.journey,
        { device: "LEAF1" as EvpnBumDeviceId, input: "Broadcast Ethernet frame", lookup: `Destination FF:FF:FF:FF:FF:FF → BUM → flood list [${remotes.join(", ")}]`, action: "CLASSIFY_AND_REPLICATE" as BumAction, output: `${replicas.length} VXLAN cop${replicas.length === 1 ? "y" : "ies"} created` },
      ];
      return { state: { ...state, replicaStage: "leaf1-to-spine", replicas, packetAt: "SPINE1", journey }, events: [{ type: "PACKET_SENT", stepId: "leaf1-bum-classify", timestamp: Date.now(), message: `LEAF1 replicates toward ${remotes.join(", ")}` }] };
    },
    whatChanged: () => ["LEAF1: destination classified as BUM (not a known unicast MAC)", "LEAF1: VNI 10010 flood list consulted", "LEAF1: one VXLAN copy created per remote VTEP"],
  },
  {
    id: "spine-forward-bum",
    label: "SPINE1 — Still Just Outer IP",
    narrative:
      "SPINE1 receives two ordinary underlay IP/UDP packets — one addressed to LEAF2's VTEP, one to LEAF3's. It forwards each on its outer destination IP alone, exactly as it did for unicast traffic. SPINE1 still never inspects the VXLAN header, the inner frame, or any tenant MAC — it doesn't even know this is a broadcast.",
    run: (state) => ({
      state: { ...state, replicaStage: "spine-to-leaves", packetAt: undefined, journey: [...state.journey, { device: "SPINE1" as EvpnBumDeviceId, input: "2 underlay IP/UDP packets", lookup: "Outer IP lookup, per packet (ECMP)", action: "UNDERLAY_FORWARD" as BumAction, output: "Forwarded toward LEAF2 and LEAF3 independently" }] },
      events: [{ type: "PACKET_SENT", stepId: "spine-forward-bum", timestamp: Date.now(), message: "SPINE1 forwards both underlay copies on outer IP alone" }],
    }),
  },
  {
    id: "leaves-decap-bum",
    label: "LEAF2 + LEAF3 — Decapsulate And Deliver",
    narrative:
      "Both LEAF2 and LEAF3 decapsulate their own copy: strip the outer headers, read VNI 10010, and deliver the now-plain broadcast frame out every locally eligible port for that VNI. HOST-B and HOST-C each receive exactly the frame HOST-A sent — neither ever saw a VXLAN header.",
    run: (state) => ({
      state: {
        ...state,
        replicaStage: "delivered",
        journey: [
          ...state.journey,
          { device: "LEAF2" as EvpnBumDeviceId, input: `VXLAN(VNI ${VNI}) from LEAF1`, lookup: `VNI ${VNI} → local eligible ports`, action: "DECAP_AND_DELIVER" as BumAction, output: "Delivered to HOST-B" },
          { device: "LEAF3" as EvpnBumDeviceId, input: `VXLAN(VNI ${VNI}) from LEAF1`, lookup: `VNI ${VNI} → local eligible ports`, action: "DECAP_AND_DELIVER" as BumAction, output: "Delivered to HOST-C" },
        ],
      },
      events: [{ type: "PACKET_RECEIVED", stepId: "leaves-decap-bum", timestamp: Date.now(), message: "LEAF2 and LEAF3 both decapsulate and deliver" }],
    }),
    whatChanged: () => ["LEAF2: VXLAN header removed, delivered to HOST-B", "LEAF3: VXLAN header removed, delivered to HOST-C"],
  },
  {
    id: "replication-recap",
    label: "One Frame, Two Copies",
    narrative:
      "HOST-A sent exactly one Ethernet frame. LEAF1 — the ingress VTEP — is what produced two independent VXLAN copies, one per flood-list entry. This is ingress (head-end) replication: the simplest EVPN BUM mechanism, and the one this lesson teaches. It is not the only way EVPN fabrics replicate BUM traffic — some designs instead let the underlay itself replicate (multicast-based underlay replication) — but ingress replication is the right place to start.",
  },
  {
    id: "control-data-recap",
    label: "Control Plane Built The List, Data Plane Used It",
    narrative:
      "Control plane: Type 3 advertisements → VNI participation learned → flood list constructed. Data plane: broadcast frame arrives → ingress replication → multiple independent VXLAN packets. Neither half works without the other — the flood list a moment ago is the exact list LEAF1 just replicated against.",
  },
  {
    id: "break-intro",
    label: "Break The Fabric",
    narrative: "Everything has worked cleanly so far. Time to break something specific: LEAF3's own Type 3 advertisement.",
  },
  {
    id: "fault-injected",
    label: "LEAF3's Type 3 Route Rejected",
    narrative: `An engineer misconfigures LEAF3's Type 3 export RT to ${BROKEN_EXPORT_RT}. It no longer matches LEAF1's and LEAF2's VNI ${VNI} import RT (${EVPN_EXPORT_RT}) — both of them reject LEAF3's IMET route and drop it from their flood lists. LEAF1's existing Type 2 route for HOST-B is completely unaffected — unicast to HOST-B still works fine; only BUM replication toward LEAF3 breaks.`,
    run: (state) => {
      const exportRt = { ...state.exportRt, LEAF3: BROKEN_EXPORT_RT };
      const received = { ...state.received };
      const floodList = { ...state.floodList };
      for (const self of (["LEAF1", "LEAF2"] as LeafId[])) {
        received[self] = (received[self] ?? []).map((r) => (r.route.originLeaf === "LEAF3" ? { ...r, rtMatched: false, imported: false } : r));
        floodList[self] = floodList[self].filter((l) => l !== "LEAF3");
      }
      return {
        state: { ...state, exportRt, received, floodList, faultActive: true },
        events: [
          { type: "RT_IMPORT_EVALUATED", stepId: "fault-injected", timestamp: Date.now(), message: `LEAF3 Type 3 export RT changed to ${BROKEN_EXPORT_RT} — no longer matches` },
          { type: "VPN_ROUTE_WITHDRAWN", stepId: "fault-injected", timestamp: Date.now(), message: "LEAF3 dropped from LEAF1's and LEAF2's flood lists" },
        ],
      };
    },
    whatChanged: () => [`LEAF3 Type 3 export RT: ${EVPN_EXPORT_RT} → ${BROKEN_EXPORT_RT}`, "LEAF1 flood list: LEAF2, LEAF3 → LEAF2 only", "LEAF2 flood list: LEAF1, LEAF3 → LEAF1 only"],
  },
  {
    id: "trouble-intro",
    label: "Troubleshoot",
    narrative:
      "Complaint: \"HOST-C can't receive broadcast or unknown-unicast traffic from HOST-A or HOST-B anymore. Physical, underlay IGP, VTEP reachability, and the BGP EVPN session all show healthy. Existing Type 2 (unicast) reachability between LEAF1 and LEAF2 is completely unaffected.\" Inspect LEAF1's flood list, LEAF3's Type 3 route, and its RT before you answer.",
  },
  {
    id: "trouble-question",
    label: "Troubleshoot",
    narrative: "Every layer beneath VNI membership policy is healthy.",
    question: {
      prompt: "Where is LEAF3 disappearing from the flood list?",
      options: [
        { id: "bgp-session", label: "The BGP EVPN session itself" },
        { id: "underlay", label: "Underlay IGP reachability to LEAF3" },
        { id: "type3-rt", label: "LEAF3's Type 3 (IMET) route target no longer matches" },
        { id: "type2", label: "A Type 2 route problem" },
      ],
      correctOptionId: "type3-rt",
      explanation:
        "The BGP EVPN session is Established and the underlay is fine — LEAF3's Type 3 route is still sent, but its RT no longer matches LEAF1's and LEAF2's VNI 10010 import policy, so it's filtered out before ever being installed. This has nothing to do with Type 2 — unicast reachability that was already learned stays completely intact.",
      hints: [
        "Hint 1: the BGP EVPN session is Established — don't troubleshoot the session itself.",
        "Hint 2: unicast (Type 2) traffic is unaffected — this isn't a MAC/IP reachability problem.",
        "Hint 3: compare LEAF3's advertised Type 3 RT against LEAF1's/LEAF2's VNI 10010 import RT.",
      ],
    },
  },
  {
    id: "diagnostic-layers",
    label: "Layer By Layer",
    narrative: "A healthy BGP EVPN session doesn't mean every route is correctly imported — Type 2 and Type 3 are checked, and can fail, completely independently of each other.",
  },
  {
    id: "repair-challenge",
    label: "Apply The Fix",
    narrative: "Restore broadcast reachability to all VTEPs in VNI 10010.",
    action: (state, payload) => {
      const choice = typeof payload === "object" && payload !== null && "choice" in payload ? String((payload as { choice: string }).choice) : "";
      if (choice !== "fix-rt") return { state: { ...state, repairAttempt: { choice, correct: false } }, events: [] };
      const exportRt = { ...state.exportRt, LEAF3: EVPN_EXPORT_RT };
      const received = { ...state.received };
      const floodList = { ...state.floodList };
      for (const self of (["LEAF1", "LEAF2"] as LeafId[])) {
        received[self] = (received[self] ?? []).map((r) => (r.route.originLeaf === "LEAF3" ? { ...r, route: { ...r.route, rt: EVPN_EXPORT_RT }, rtMatched: true, imported: true } : r));
        floodList[self] = LEAF_IDS.filter((l) => l !== self);
      }
      return {
        state: { ...state, exportRt, received, floodList, faultActive: false, repairAttempt: { choice, correct: true }, challengeSucceeded: true },
        events: [
          { type: "RT_IMPORT_EVALUATED", stepId: "repair-challenge", timestamp: Date.now(), message: `LEAF3 Type 3 export RT corrected to ${EVPN_EXPORT_RT} — match` },
          { type: "VPN_ROUTE_IMPORTED", stepId: "repair-challenge", timestamp: Date.now(), message: "LEAF3 re-added to LEAF1's and LEAF2's flood lists" },
        ],
      };
    },
    requiresState: (state) => state.challengeSucceeded === true,
  },
  {
    id: "verify-dataplane",
    label: "Verify End To End",
    narrative: "Send a broadcast through again to prove the repair actually restored replication, not just the control-plane table.",
    packet: () => framePacket("f-verify-bum", "HOST-A", "LEAF1", "Verification broadcast frame", broadcastFrame()),
    run: (state) => {
      const remotes = state.floodList.LEAF1;
      const replicas: BumReplica[] = remotes.map((toLeaf) => ({ id: `verify-${toLeaf}`, toLeaf }));
      const journey: BumJourneyHop[] = [
        { device: "LEAF1", input: "Broadcast Ethernet frame", lookup: `VNI 10010 flood list [${remotes.join(", ")}]`, action: "CLASSIFY_AND_REPLICATE", output: `${replicas.length} VXLAN copies created` },
        { device: "SPINE1", input: "2 underlay IP/UDP packets", lookup: "Outer IP lookup, per packet", action: "UNDERLAY_FORWARD", output: "Forwarded toward LEAF2 and LEAF3" },
        { device: "LEAF2", input: `VXLAN(VNI ${VNI})`, lookup: `VNI ${VNI} → local eligible ports`, action: "DECAP_AND_DELIVER", output: "Delivered to HOST-B" },
        { device: "LEAF3", input: `VXLAN(VNI ${VNI})`, lookup: `VNI ${VNI} → local eligible ports`, action: "DECAP_AND_DELIVER", output: "Delivered to HOST-C" },
      ];
      return {
        state: { ...state, packet: broadcastFrame(), replicaStage: "delivered", replicas, journey },
        events: [{ type: "VPN_PACKET_DELIVERED", stepId: "verify-dataplane", timestamp: Date.now(), message: "Both HOST-B and HOST-C receive the broadcast — replication fully restored" }],
      };
    },
    whatChanged: () => ["✓ LEAF3 Type 3 route re-imported", "✓ LEAF1 and LEAF2 flood lists restored to all 3 leafs", "✓ Two VXLAN replicas created again", "✓ HOST-B and HOST-C both receive the broadcast"],
  },
  {
    id: "complete",
    label: "Lesson Complete",
    narrative:
      "All three leafs agree on VNI 10010's membership again, and a single broadcast from HOST-A reaches every other site — built on the exact same ingress-replication mechanism you watched the first time, now proven to recover from a real, realistic control-plane fault.",
  },
];
