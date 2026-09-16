import type { PacketVisual, ScenarioStep } from "../types";
import { HOST_B_IP, HOST_B_MAC, VLAN, VNI, VTEP_LOOPBACK, ES_LEAFS, ESI, ETHERNET_SEGMENT, type LeafId } from "./evpnMultihoming";

export type { LeafId };
import { buildPacketLayers, type DataFrame } from "./evpnVxlan";

/**
 * EVPN Aliasing + Mass Withdrawal — the eighth lesson in the EVPN
 * track, reusing the exact multihomed topology, ESI, and Ethernet
 * Segment model built in EVPN Multihoming Foundations (see
 * docs/ARCHITECTURE.md §4). This lesson answers two questions that
 * DF election deliberately did NOT answer:
 *
 *   1. For ordinary KNOWN UNICAST toward a multihomed destination,
 *      does every remote PE have to pick one single next hop and use
 *      it forever? (No — Aliasing, built from Ethernet A-D per-EVI
 *      routes, gives every remote PE a small eligible set.)
 *   2. When one attached PE's ES-facing link fails, must the fabric
 *      wait for every individual MAC route behind that segment to be
 *      withdrawn one at a time? (No — Mass Withdrawal, built from the
 *      Ethernet A-D per-ES route, rapidly prunes the failed PE as a
 *      forwarding next hop for every destination behind that ES.)
 *
 * SERVER-A here is a *new* dual-homed endpoint (its own IP/MAC — see
 * brief §1), reusing ESI/VLAN/VNI/VTEP identities from the
 * Multihoming lesson rather than redefining them.
 *
 * Explicitly DEFERRED (per the user's own stated scope): a
 * Single-Active deep dive, EVPN-VPWS, advanced/non-default DF
 * algorithms, complex multi-failure scenarios, vendor-specific
 * ESI-LAG configuration syntax. DF election itself is NOT re-taught
 * here — it was fully built in the previous lesson; this lesson only
 * ever *compares against* it, never re-runs an election.
 *
 * Pure data + pure functions only — see /lib/sim-engine/types.ts.
 */

export type EvpnAliasingDeviceId = "SERVER-A" | LeafId | "SPINE1" | "HOST-B";
export const FABRIC_DEVICES: EvpnAliasingDeviceId[] = ["LEAF1", "SPINE1", "LEAF2", "LEAF3"];

export { ESI, VLAN, VNI, VTEP_LOOPBACK, ES_LEAFS, ETHERNET_SEGMENT, HOST_B_IP, HOST_B_MAC };
export const SERVER_A_IP = "10.10.10.11";
export const SERVER_A_MAC = "AA:AA:AA:AA:AA:11";

const EVPN_EXPORT_RT = "65000:10010";
function rdFor(leaf: LeafId): string {
  return `${VTEP_LOOPBACK[leaf]}:${VNI}`;
}

export const TERMS: { term: string; expansion: string; meaning: string }[] = [
  { term: "Aliasing", expansion: "Multiple Eligible Next Hops", meaning: "Built from Ethernet A-D per-EVI routes — gives a remote PE more than one usable path for known-unicast traffic toward an all-active multihomed destination." },
  { term: "A-D per-EVI", expansion: "Route Type 1, Per-Service Form", meaning: "\"This PE participates in this Ethernet Segment for this EVI.\" Used to construct the aliasing/eligible-next-hop set." },
  { term: "A-D per-ES", expansion: "Route Type 1, Per-Segment Form", meaning: "\"This PE is attached to this Ethernet Segment.\" Its withdrawal is the fast failure signal behind Mass Withdrawal." },
  { term: "Mass Withdrawal", expansion: "Rapid Next-Hop Pruning", meaning: "One ES-level withdrawal removes a failed PE as a usable forwarding next hop for every destination behind that segment — not a one-by-one MAC route cleanup." },
  { term: "Flow", expansion: "Deterministic Selection", meaning: "A simplified flow-level abstraction standing in for ECMP hashing — never a claim about a specific ASIC's per-packet algorithm." },
];

// ---------------------------------------------------------------------------
// Route models
// ---------------------------------------------------------------------------

/** Route Type 2 for a MULTIHOMED MAC: carries the ESI itself rather than one owning VTEP — the eligible next-hop set comes from combining this with the A-D per-EVI routes below, never from a single `nextHop` field. */
export interface Type2AliasRoute {
  mac: string;
  ip: string;
  vni: number;
  esi: string;
  rd: string;
  rt: string;
  originLeaf: LeafId;
}

/** Route Type 1, per-EVI form — "this PE participates in this ESI for this EVI." Drives the aliasing set. */
export interface Type1PerEviRoute {
  esi: string;
  originLeaf: LeafId;
  vni: number;
  rd: string;
  rt: string;
}

/** Route Type 1, per-ES form — "this PE is attached to this ESI," full stop. Its withdrawal is the mass-withdraw signal. */
export interface Type1PerEsRoute {
  esi: string;
  originLeaf: LeafId;
  rd: string;
  rt: string;
  withdrawn: boolean;
}

export type FlowId = "A" | "B";
export interface AliasingEntry {
  mac: string;
  esi: string;
  vni: number;
  eligiblePEs: LeafId[];
  selectedPe: Partial<Record<FlowId, LeafId>>;
  source: string;
}

export type MwAction = "UNDERLAY_FORWARD" | "ALIAS_SELECT" | "VXLAN_DECAP" | "LOCAL_DELIVER" | "ES_ATTACHMENT_UNAVAILABLE";
export interface JourneyHop {
  device: EvpnAliasingDeviceId;
  input: string;
  lookup: string;
  action: MwAction;
  output: string;
}

export interface EvpnAliasingState {
  bgpSessionUp: boolean;
  macRoute?: Type2AliasRoute;
  perEviAdRoutes: Partial<Record<LeafId, Type1PerEviRoute>>;
  perEsAdRoutes: Partial<Record<LeafId, Type1PerEsRoute>>;
  aliasing?: AliasingEntry;

  esAttachmentFailed: boolean; // LEAF1's SERVER-A-facing ES link only — LEAF1 itself, its underlay, and BGP EVPN all stay up
  massWithdrawalProcessed: boolean;

  activeFlow?: FlowId;
  packetAt?: EvpnAliasingDeviceId;
  journey: JourneyHop[];
  failedDeliveryShown: boolean;

  macCountExample: 1 | 100 | 1000;

  staleAliasingFault: boolean;
  repairAttempt?: { choice: string; correct: boolean };
  challengeSucceeded?: boolean;
}

export function createEvpnAliasingState(): EvpnAliasingState {
  return {
    bgpSessionUp: true,
    perEviAdRoutes: {},
    perEsAdRoutes: {},
    esAttachmentFailed: false,
    massWithdrawalProcessed: false,
    journey: [],
    failedDeliveryShown: false,
    macCountExample: 1,
    staleAliasingFault: false,
  };
}

// ---------------------------------------------------------------------------
// Pure scenario functions (brief §40)
// ---------------------------------------------------------------------------

export function getEligibleEsPeers(
  perEviAdRoutes: Partial<Record<LeafId, Type1PerEviRoute>>,
  perEsAdRoutes: Partial<Record<LeafId, Type1PerEsRoute>>,
  massWithdrawalProcessed: boolean,
): LeafId[] {
  const advertised = ES_LEAFS.filter((l) => perEviAdRoutes[l]);
  if (!massWithdrawalProcessed) return advertised;
  return advertised.filter((l) => !perEsAdRoutes[l]?.withdrawn);
}

export function selectFlowNextHop(eligiblePEs: LeafId[], flow: FlowId): LeafId | undefined {
  if (eligiblePEs.length === 0) return undefined;
  const sorted = [...eligiblePEs].sort();
  const idx = flow === "A" ? 0 : 1;
  return sorted[idx % sorted.length];
}

export function buildAliasingSet(
  macRoute: Type2AliasRoute,
  perEviAdRoutes: Partial<Record<LeafId, Type1PerEviRoute>>,
  perEsAdRoutes: Partial<Record<LeafId, Type1PerEsRoute>>,
  massWithdrawalProcessed: boolean,
): AliasingEntry {
  const eligiblePEs = getEligibleEsPeers(perEviAdRoutes, perEsAdRoutes, massWithdrawalProcessed);
  const selectedPe: Partial<Record<FlowId, LeafId>> = {};
  (["A", "B"] as FlowId[]).forEach((f) => {
    const pe = selectFlowNextHop(eligiblePEs, f);
    if (pe) selectedPe[f] = pe;
  });
  return { mac: macRoute.mac, esi: macRoute.esi, vni: macRoute.vni, eligiblePEs, selectedPe, source: "Type-2 MAC/IP + Ethernet A-D per-EVI" };
}

export function recomputeAliasingSet(state: EvpnAliasingState): EvpnAliasingState {
  if (!state.macRoute) return state;
  return { ...state, aliasing: buildAliasingSet(state.macRoute, state.perEviAdRoutes, state.perEsAdRoutes, state.massWithdrawalProcessed) };
}

export function failEsAttachment(state: EvpnAliasingState, leaf: LeafId): EvpnAliasingState {
  if (leaf !== "LEAF1") return state;
  return { ...state, esAttachmentFailed: true };
}

export function withdrawEthernetAdPerEs(state: EvpnAliasingState, leaf: LeafId): EvpnAliasingState {
  const route = state.perEsAdRoutes[leaf];
  if (!route) return state;
  return { ...state, perEsAdRoutes: { ...state.perEsAdRoutes, [leaf]: { ...route, withdrawn: true } } };
}

export function applyMassWithdrawal(state: EvpnAliasingState): EvpnAliasingState {
  return recomputeAliasingSet({ ...state, massWithdrawalProcessed: true });
}

// ---------------------------------------------------------------------------
// Graph layout — identical topology/positions to the Multihoming lesson
// ---------------------------------------------------------------------------

interface GNode { id: string; label: string; x: number; y: number; subLabel?: string; kind?: "server" | "switch" | "cloud"; }
interface GEdge { id: string; a: string; b: string; label?: string; }

export const GRAPH_NODES: GNode[] = [
  { id: "SERVER-A", label: "SERVER-A", x: 32, y: 88, subLabel: `${SERVER_A_IP} · Dual-Homed`, kind: "server" },
  { id: "LEAF1", label: "LEAF1", x: 15, y: 58, subLabel: `VTEP ${VTEP_LOOPBACK.LEAF1}`, kind: "switch" },
  { id: "SPINE1", label: "SPINE1", x: 50, y: 18, subLabel: "Underlay only", kind: "switch" },
  { id: "LEAF2", label: "LEAF2", x: 50, y: 58, subLabel: `VTEP ${VTEP_LOOPBACK.LEAF2}`, kind: "switch" },
  { id: "HOST-B", label: "HOST-B", x: 85, y: 88, subLabel: `${HOST_B_IP} · VLAN ${VLAN}`, kind: "server" },
  { id: "LEAF3", label: "LEAF3", x: 85, y: 58, subLabel: `VTEP ${VTEP_LOOPBACK.LEAF3}`, kind: "switch" },
];
export const GRAPH_EDGES: GEdge[] = [
  { id: "SERVER-A-LEAF1", a: "SERVER-A", b: "LEAF1", label: `ESI ${ESI.slice(-8)}` },
  { id: "SERVER-A-LEAF2", a: "SERVER-A", b: "LEAF2", label: `ESI ${ESI.slice(-8)}` },
  { id: "HOST-B-LEAF3", a: "HOST-B", b: "LEAF3" },
  { id: "LEAF1-SPINE1", a: "LEAF1", b: "SPINE1", label: "Underlay" },
  { id: "LEAF2-SPINE1", a: "LEAF2", b: "SPINE1", label: "Underlay" },
  { id: "LEAF3-SPINE1", a: "LEAF3", b: "SPINE1", label: "Underlay" },
];
export const GRAPH_REGIONS = [
  { id: "underlay", label: "IP Underlay Fabric (Spine-Leaf)", x: 4, y: 6, width: 92, height: 60, tone: "cyan" as const },
  { id: "ethernet-segment", label: `Ethernet Segment ${ESI.slice(-8)}`, x: 4, y: 50, width: 64, height: 40, tone: "violet" as const },
];

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

export const LOGICAL_GRAPH_NODES: GNode[] = [
  { id: "ESI", label: `ESI ${ESI.slice(-8)}`, x: 50, y: 15, kind: "cloud" },
  { id: "LEAF1", label: "LEAF1", x: 30, y: 45, kind: "switch" },
  { id: "LEAF2", label: "LEAF2", x: 70, y: 45, kind: "switch" },
  { id: "SERVER-A", label: "SERVER-A", x: 50, y: 80, subLabel: SERVER_A_IP, kind: "server" },
];
export const LOGICAL_GRAPH_EDGES: GEdge[] = [
  { id: "esi-leaf1", a: "ESI", b: "LEAF1" },
  { id: "esi-leaf2", a: "ESI", b: "LEAF2" },
  { id: "leaf1-servera", a: "LEAF1", b: "SERVER-A" },
  { id: "leaf2-servera", a: "LEAF2", b: "SERVER-A" },
];

// ---------------------------------------------------------------------------
// Packet builders
// ---------------------------------------------------------------------------

function unicastFrame(overrides: Partial<DataFrame> = {}): DataFrame {
  return { innerSrcMac: HOST_B_MAC, innerDstMac: SERVER_A_MAC, innerSrcIp: HOST_B_IP, innerDstIp: SERVER_A_IP, encapsulated: false, ...overrides };
}
function framePacket(id: string, from: EvpnAliasingDeviceId, to: EvpnAliasingDeviceId, summary: string, badge: string, f: DataFrame): PacketVisual {
  return { id, protocol: f.encapsulated ? "VXLAN" : "ETHERNET", from, to, summary, badge, layers: buildPacketLayers(f) };
}

function type2Packet(id: string, from: LeafId, to: EvpnAliasingDeviceId, route: Type2AliasRoute): PacketVisual {
  return {
    id,
    protocol: "BGP",
    from,
    to,
    summary: `EVPN Type 2 — ${route.mac} (multihomed)`,
    badge: "EVPN TYPE 2 UPDATE",
    layers: [{ name: "BGP UPDATE (EVPN)", color: "var(--pv-proto-bgp)", fields: [
      { label: "AFI/SAFI", value: "L2VPN EVPN" },
      { label: "Route Type", value: "2 (MAC/IP Advertisement)" },
      { label: "MAC Address", value: route.mac },
      { label: "IP Address", value: route.ip },
      { label: "Ethernet Segment Identifier", value: route.esi },
      { label: "RD", value: route.rd },
      { label: "Route Target", value: route.rt },
    ] }],
  };
}
function type1PerEviPacket(id: string, from: LeafId, to: EvpnAliasingDeviceId, route: Type1PerEviRoute): PacketVisual {
  return {
    id,
    protocol: "BGP",
    from,
    to,
    summary: `EVPN Type 1 — A-D per-EVI from ${route.originLeaf}`,
    badge: "EVPN TYPE 1 · A-D PER-EVI",
    layers: [{ name: "BGP UPDATE (EVPN)", color: "var(--pv-proto-bgp)", fields: [
      { label: "AFI/SAFI", value: "L2VPN EVPN" },
      { label: "Route Type", value: "1 (Ethernet Auto-Discovery — per EVI)" },
      { label: "Ethernet Segment Identifier", value: route.esi },
      { label: "Ethernet Tag ID (Advanced)", value: String(route.vni) },
      { label: "RD", value: route.rd },
      { label: "Route Target", value: route.rt },
    ] }],
  };
}
function type1PerEsPacket(id: string, from: LeafId, to: EvpnAliasingDeviceId, route: Type1PerEsRoute, action: "announce" | "withdraw"): PacketVisual {
  return {
    id,
    protocol: "BGP",
    from,
    to,
    summary: `EVPN Type 1 — A-D per-ES ${action === "withdraw" ? "WITHDRAW" : "advertise"} from ${route.originLeaf}`,
    badge: action === "withdraw" ? "EVPN TYPE 1 · A-D PER-ES · WITHDRAW" : "EVPN TYPE 1 · A-D PER-ES",
    layers: [{ name: "BGP UPDATE (EVPN)", color: "var(--pv-proto-bgp)", fields: [
      { label: "AFI/SAFI", value: "L2VPN EVPN" },
      { label: "Route Type", value: "1 (Ethernet Auto-Discovery — per ES)" },
      { label: "Ethernet Segment Identifier", value: route.esi },
      { label: "Originating PE", value: route.originLeaf },
      { label: "RD", value: route.rd },
      { label: "Action", value: action === "withdraw" ? "WITHDRAW" : "ANNOUNCE" },
    ] }],
  };
}

export { framePacket, unicastFrame, type2Packet, type1PerEviPacket, type1PerEsPacket };

function layerIndex(packet: PacketVisual | undefined, name: string): number[] | undefined {
  const i = packet?.layers.findIndex((l) => l.name === name) ?? -1;
  return i >= 0 ? [i] : undefined;
}
export function outerIpLayerIndex(packet: PacketVisual | undefined): number[] | undefined {
  return layerIndex(packet, "Outer IP");
}

// ---------------------------------------------------------------------------
// Scenario steps
// ---------------------------------------------------------------------------

const REPAIR_CORRECT_ID = "process-mass-withdrawal";

export const evpnAliasingSteps: ScenarioStep<EvpnAliasingState>[] = [
  {
    id: "intro",
    label: "The Same Multihomed Segment, A Different Question",
    narrative: "SERVER-A is dual-homed to LEAF1 and LEAF2 — the exact same ESI and Ethernet Segment from the Multihoming lesson. This time we're not asking about BUM traffic at all. We're asking about ordinary known unicast.",
  },
  {
    id: "known-unicast-setup",
    label: "HOST-B Wants To Reach SERVER-A",
    narrative: `HOST-B wants to send known-unicast traffic to SERVER-A (MAC ${SERVER_A_MAC}). Assume SERVER-A's MAC was originally learned through LEAF1.`,
    run: (state) => {
      const macRoute: Type2AliasRoute = { mac: SERVER_A_MAC, ip: SERVER_A_IP, vni: VNI, esi: ESI, rd: rdFor("LEAF1"), rt: EVPN_EXPORT_RT, originLeaf: "LEAF1" };
      return { state: { ...state, macRoute }, events: [{ type: "MPBGP_VPN_ROUTE_ADVERTISED", stepId: "known-unicast-setup", timestamp: Date.now(), message: "LEAF1 advertises a Type-2 MAC/IP route for SERVER-A, carrying ESI " + ESI.slice(-8) }] };
    },
    packet: (state) => (state.macRoute ? type2Packet("t2-leaf1", "LEAF1", "LEAF3", state.macRoute) : undefined),
  },
  {
    id: "predict-only-leaf1",
    label: "Predict",
    narrative: "LEAF3 now has a Type-2 route for SERVER-A pointing at ESI " + ESI.slice(-8) + ", originated by LEAF1.",
    question: {
      prompt: "Does LEAF3 have to send every known-unicast flow for SERVER-A only through LEAF1?",
      options: [
        { id: "yes-only-leaf1", label: "Yes — the route came from LEAF1, so LEAF1 is the only usable path" },
        { id: "no-multiple", label: "No — since SERVER-A is multihomed, more than one PE can be an eligible path" },
      ],
      correctOptionId: "no-multiple",
      explanation: "SERVER-A is attached to an all-active Ethernet Segment shared by LEAF1 and LEAF2 — EVPN Aliasing is the mechanism that lets LEAF3 discover and use both as eligible next hops, not just the one that happened to originate the Type-2 route.",
    },
  },
  {
    id: "aliasing-problem-intro",
    label: "The Aliasing Problem",
    narrative: "LEAF3 knows: SERVER-A's MAC → a Type-2 route → ESI X. It also knows — from Ethernet A-D signaling — that ESI X / EVI VNI 10010 is reachable through both LEAF1 and LEAF2. The relationship becomes: MAC → ESI X → { LEAF1, LEAF2 }.",
  },
  {
    id: "type1-deep-dive",
    label: "Type 1, Two Purposes",
    narrative: "The Multihoming lesson introduced Route Type 1. It actually comes in two forms, distinguished by purpose, not by a different route-type number: A-D PER EVI — \"this PE participates in this Ethernet Segment for this EVI\" — and A-D PER ES — \"this PE is attached to this Ethernet Segment,\" whose withdrawal can rapidly signal failure for many MAC destinations at once. Both are Route Type 1.",
  },
  {
    id: "leaf1-advertises-perevi-perces",
    label: "LEAF1 Advertises Both A-D Forms",
    narrative: "LEAF1 advertises A-D per-EVI (for aliasing) and A-D per-ES (for failure signaling) — two different forms of the same route type.",
    packet: (state) => (state.perEviAdRoutes.LEAF1 ? type1PerEviPacket("ad-evi-leaf1", "LEAF1", "LEAF3", state.perEviAdRoutes.LEAF1) : undefined),
    run: (state) => {
      const perEvi: Type1PerEviRoute = { esi: ESI, originLeaf: "LEAF1", vni: VNI, rd: rdFor("LEAF1"), rt: EVPN_EXPORT_RT };
      const perEs: Type1PerEsRoute = { esi: ESI, originLeaf: "LEAF1", rd: rdFor("LEAF1"), rt: EVPN_EXPORT_RT, withdrawn: false };
      return {
        state: { ...state, perEviAdRoutes: { ...state.perEviAdRoutes, LEAF1: perEvi }, perEsAdRoutes: { ...state.perEsAdRoutes, LEAF1: perEs } },
        events: [{ type: "MPBGP_VPN_ROUTE_ADVERTISED", stepId: "leaf1-advertises-perevi-perces", timestamp: Date.now(), message: "LEAF1 advertises A-D per-EVI and A-D per-ES for ESI " + ESI.slice(-8) }],
      };
    },
  },
  {
    id: "leaf2-advertises-perevi-perces",
    label: "LEAF2 Advertises Both A-D Forms",
    narrative: "LEAF2 does the same for its own attachment to the identical ESI.",
    packet: (state) => (state.perEviAdRoutes.LEAF2 ? type1PerEviPacket("ad-evi-leaf2", "LEAF2", "LEAF3", state.perEviAdRoutes.LEAF2) : undefined),
    run: (state) => {
      const perEvi: Type1PerEviRoute = { esi: ESI, originLeaf: "LEAF2", vni: VNI, rd: rdFor("LEAF2"), rt: EVPN_EXPORT_RT };
      const perEs: Type1PerEsRoute = { esi: ESI, originLeaf: "LEAF2", rd: rdFor("LEAF2"), rt: EVPN_EXPORT_RT, withdrawn: false };
      const nextState = { ...state, perEviAdRoutes: { ...state.perEviAdRoutes, LEAF2: perEvi }, perEsAdRoutes: { ...state.perEsAdRoutes, LEAF2: perEs } };
      return {
        state: recomputeAliasingSet(nextState),
        events: [{ type: "MPBGP_VPN_ROUTE_ADVERTISED", stepId: "leaf2-advertises-perevi-perces", timestamp: Date.now(), message: "LEAF2 advertises A-D per-EVI and A-D per-ES — LEAF3 can now build its aliasing set" }],
      };
    },
    whatChanged: () => ["LEAF3 now holds A-D per-EVI routes from both LEAF1 and LEAF2", "Eligible next-hop set for SERVER-A's MAC becomes { LEAF1, LEAF2 }"],
  },
  {
    id: "aliasing-decision-chamber",
    label: "EVPN Aliasing",
    narrative: `Destination ${SERVER_A_MAC} → Type-2 route → ESI ${ESI.slice(-8)} → A-D per-EVI routes from LEAF1 and LEAF2 → eligible next-hops { LEAF1, LEAF2 }.`,
  },
  {
    id: "aliasing-vs-df",
    label: "This Is Not DF Election",
    narrative: "DF election primarily influences specific BUM forwarding toward the Ethernet Segment. Aliasing provides multiple eligible paths for known-unicast forwarding toward an all-active multihomed Ethernet Segment. NDF does NOT mean \"never use this PE for known unicast.\"",
  },
  {
    id: "flow-a-intro",
    label: "Flow A — HOST-B Sends A Known-Unicast Flow",
    narrative: "Send the first example flow. This is a simplified deterministic flow-selection abstraction, not a claim about any proprietary ASIC hashing algorithm — different flows may use different eligible next hops.",
    packet: () => framePacket("f-flow-a-in", "HOST-B", "LEAF3", "Known unicast — HOST-B → SERVER-A (Flow A)", "FRAME", unicastFrame()),
    run: (state) => ({ state: { ...state, activeFlow: "A", packetAt: "LEAF3" }, events: [{ type: "PACKET_SENT", stepId: "flow-a-intro", timestamp: Date.now(), message: "HOST-B sends Flow A toward SERVER-A" }] }),
  },
  {
    id: "flow-a-leaf3-pipeline",
    label: "LEAF3 — Conceptual EVPN Aliasing Forwarding Pipeline",
    narrative: "Destination MAC lookup → Type-2 route → ESI identified → A-D per-EVI lookup → eligible PE set → flow/ECMP selection → remote VTEP → VXLAN encapsulation.",
    packet: (state) => (state.aliasing?.selectedPe.A ? framePacket("f-flow-a-vxlan", "LEAF3", "SPINE1", `VXLAN toward ${state.aliasing.selectedPe.A} (Flow A)`, "VXLAN", { ...unicastFrame(), encapsulated: true, outerSrcVtep: VTEP_LOOPBACK.LEAF3, outerDstVtep: state.aliasing.selectedPe.A ? VTEP_LOOPBACK[state.aliasing.selectedPe.A] : undefined }) : undefined),
    run: (state) => {
      const pe = state.aliasing?.selectedPe.A ?? "LEAF1";
      return {
        state: { ...state, packetAt: pe, journey: [...state.journey, { device: "LEAF3", input: `Known unicast → ${SERVER_A_MAC}`, lookup: `Type-2 → ESI ${ESI.slice(-8)} → A-D per-EVI eligible set {${(state.aliasing?.eligiblePEs ?? []).join(", ")}} → flow selects ${pe}`, action: "ALIAS_SELECT", output: `VXLAN encapsulated toward ${pe}` }] },
        events: [{ type: "ROUTE_SELECTED", stepId: "flow-a-leaf3-pipeline", timestamp: Date.now(), message: `LEAF3 selects ${pe} as the aliasing next hop for Flow A` }],
      };
    },
  },
  {
    id: "flow-a-delivered",
    label: "Flow A Reaches SERVER-A Via LEAF1",
    narrative: "LEAF1 decapsulates, recognizes VNI 10010 → ESI X → the local Ethernet Segment, and delivers to SERVER-A. This delivery required no DF status check at all — known-unicast aliasing is independent of BUM's DF-controlled forwarding.",
    packet: (state) => framePacket("f-flow-a-out", state.aliasing?.selectedPe.A ?? "LEAF1", "SERVER-A", "Decapsulated — delivered to SERVER-A (Flow A)", "FRAME", unicastFrame()),
    run: (state) => {
      const pe = state.aliasing?.selectedPe.A ?? "LEAF1";
      return {
        state: { ...state, packetAt: "SERVER-A", journey: [...state.journey, { device: pe, input: `VXLAN(VNI ${VNI})`, lookup: `VNI ${VNI} → local ESI ${ESI.slice(-8)} → SERVER-A (no DF check needed)`, action: "LOCAL_DELIVER", output: "Delivered to SERVER-A" }] },
        events: [{ type: "PACKET_RECEIVED", stepId: "flow-a-delivered", timestamp: Date.now(), message: "SERVER-A receives Flow A via LEAF1" }],
      };
    },
  },
  {
    id: "flow-b-intro",
    label: "Flow B — A Different Flow, A Different Eligible Next Hop",
    narrative: "Send a second, different example flow toward the same destination.",
    packet: () => framePacket("f-flow-b-in", "HOST-B", "LEAF3", "Known unicast — HOST-B → SERVER-A (Flow B)", "FRAME", unicastFrame({ innerSrcIp: HOST_B_IP })),
    run: (state) => ({ state: { ...state, activeFlow: "B", packetAt: "LEAF3" }, events: [{ type: "PACKET_SENT", stepId: "flow-b-intro", timestamp: Date.now(), message: "HOST-B sends Flow B toward SERVER-A" }] }),
  },
  {
    id: "flow-b-delivered",
    label: "Flow B Reaches SERVER-A Via LEAF2",
    narrative: "Same destination, same eligible set — but Flow B's deterministic selection lands on LEAF2 this time. Both flows succeed; different flows may simply use different eligible next hops.",
    packet: (state) => (state.aliasing?.selectedPe.B ? framePacket("f-flow-b-vxlan", "LEAF3", state.aliasing.selectedPe.B, `VXLAN toward ${state.aliasing.selectedPe.B} (Flow B)`, "VXLAN", { ...unicastFrame(), encapsulated: true, outerSrcVtep: VTEP_LOOPBACK.LEAF3, outerDstVtep: VTEP_LOOPBACK[state.aliasing.selectedPe.B] }) : undefined),
    run: (state) => {
      const pe = state.aliasing?.selectedPe.B ?? "LEAF2";
      return {
        state: { ...state, packetAt: "SERVER-A", journey: [...state.journey, { device: "LEAF3", input: `Known unicast → ${SERVER_A_MAC}`, lookup: `A-D per-EVI eligible set {${(state.aliasing?.eligiblePEs ?? []).join(", ")}} → flow selects ${pe}`, action: "ALIAS_SELECT", output: `VXLAN encapsulated toward ${pe}` }, { device: pe, input: `VXLAN(VNI ${VNI})`, lookup: `VNI ${VNI} → local ESI ${ESI.slice(-8)} → SERVER-A (no DF check needed)`, action: "LOCAL_DELIVER", output: "Delivered to SERVER-A" }] },
        events: [{ type: "PACKET_RECEIVED", stepId: "flow-b-delivered", timestamp: Date.now(), message: "SERVER-A receives Flow B via LEAF2" }],
      };
    },
    whatChanged: () => ["Flow A used LEAF1; Flow B used LEAF2 — both succeeded through the same eligible set"],
  },
  {
    id: "control-data-both-recap",
    label: "Control Builds The Set, Data Uses It",
    narrative: "Control: LEAF1 Type-1 per-EVI + LEAF2 Type-1 per-EVI + Type-2 MAC → LEAF3 builds the alias set. Data: HOST-B → LEAF3 → (LEAF1 or LEAF2) → SERVER-A. The control-plane A-D signaling is what determines which paths the data plane may legitimately choose from.",
  },
  {
    id: "fail-es-attachment",
    label: "LEAF1's Ethernet-Segment Attachment Fails",
    narrative: "Fail only LEAF1's SERVER-A-facing ES link — not LEAF1 itself. LEAF1 the device stays up, its underlay stays up, BGP EVPN stays up, its VTEP stays reachable. Only its attachment to this one Ethernet Segment goes down.",
    run: (state) => ({ state: failEsAttachment(state, "LEAF1"), events: [{ type: "BGP_STATE_CHANGED", stepId: "fail-es-attachment", timestamp: Date.now(), message: "LEAF1's ES-facing attachment to SERVER-A becomes unavailable (LEAF1 itself remains healthy)" }] }),
  },
  {
    id: "convergence-problem",
    label: "The Convergence Problem",
    narrative: "LEAF3 may still have SERVER-A's MAC → ESI X → eligible { LEAF1, LEAF2 } — nothing has told it otherwise yet. But LEAF1 no longer has a working attachment to SERVER-A.",
    packet: () => framePacket("f-flow-fails", "HOST-B", "LEAF3", "Known unicast — HOST-B → SERVER-A (hashes to LEAF1)", "FRAME", unicastFrame()),
    run: (state) => ({
      state: { ...state, failedDeliveryShown: true, packetAt: "LEAF1", journey: [...state.journey, { device: "LEAF3", input: `Known unicast → ${SERVER_A_MAC}`, lookup: `Stale eligible set {${(state.aliasing?.eligiblePEs ?? []).join(", ")}} → flow selects LEAF1`, action: "ALIAS_SELECT", output: "VXLAN encapsulated toward LEAF1" }, { device: "LEAF1", input: `VXLAN(VNI ${VNI})`, lookup: "ES attachment to SERVER-A unavailable", action: "ES_ATTACHMENT_UNAVAILABLE", output: "Traffic cannot reach SERVER-A through LEAF1" }] },
      events: [{ type: "PACKET_DROPPED", stepId: "convergence-problem", timestamp: Date.now(), message: "A flow hashing to LEAF1 cannot reach SERVER-A" }],
    }),
  },
  {
    id: "predict-must-wait",
    label: "Predict",
    narrative: "SERVER-A's MAC route itself hasn't changed — only LEAF1's usability as a next hop has.",
    question: {
      prompt: "Must the fabric wait for every individual MAC route associated with this Ethernet Segment to be withdrawn one at a time?",
      options: [
        { id: "yes-wait", label: "Yes — each MAC route must converge independently" },
        { id: "no-es-signal", label: "No — one ES-level signal can invalidate the failed PE for every affected destination at once" },
      ],
      correctOptionId: "no-es-signal",
      explanation: "This is exactly what Mass Withdrawal is for: a single Ethernet A-D per-ES withdrawal rapidly removes the failed PE as a usable next hop for every MAC destination behind that segment — not a one-by-one Type-2 cleanup.",
    },
  },
  {
    id: "mass-withdrawal-intro",
    label: "Mass Withdrawal",
    narrative: "LEAF1 detects its ESI attachment is unavailable → withdraws its Ethernet A-D per-ES route → remote PEs learn LEAF1 is no longer an eligible next hop for destinations behind this ES → many forwarding dependencies can update without waiting for one Type-2 withdrawal per MAC. This does not mean every MAC route is deleted immediately — individual route cleanup may occur separately.",
  },
  {
    id: "withdraw-per-es",
    label: "BGP WITHDRAW — Ethernet A-D Per-ES",
    narrative: "This is visually and semantically different from an advertisement: the action is WITHDRAW, not a new route with a red color.",
    packet: (state) => (state.perEsAdRoutes.LEAF1 ? type1PerEsPacket("ad-es-withdraw", "LEAF1", "LEAF3", { ...state.perEsAdRoutes.LEAF1, withdrawn: true }, "withdraw") : undefined),
    run: (state) => ({ state: withdrawEthernetAdPerEs(state, "LEAF1"), events: [{ type: "VPN_ROUTE_WITHDRAWN", stepId: "withdraw-per-es", timestamp: Date.now(), message: "LEAF1 withdraws its Ethernet A-D per-ES route for ESI " + ESI.slice(-8) }] }),
  },
  {
    id: "enter-leaf3-mass-withdrawal",
    label: "LEAF3 — Conceptual Mass Withdrawal Processing Pipeline",
    narrative: "BGP EVPN WITHDRAW → Route Type 1, A-D per-ES → ESI X → failed PE = LEAF1 → find dependent ES destinations → remove LEAF1 from eligible next-hop sets → retain surviving PE(s) → update forwarding state.",
  },
  {
    id: "leaf3-processes-withdrawal",
    label: "LEAF3 Processes The Withdrawal",
    narrative: "LEAF3 applies the withdrawal and recomputes its aliasing next-hop set for every destination behind this ES.",
    run: (state) => ({ state: applyMassWithdrawal(state), events: [{ type: "ROUTE_SELECTED", stepId: "leaf3-processes-withdrawal", timestamp: Date.now(), message: "LEAF3 recomputes the aliasing set — LEAF1 pruned" }] }),
    whatChanged: (prev, next) => [`Eligible next-hop set for ${SERVER_A_MAC}: {${(prev.aliasing?.eligiblePEs ?? []).join(", ")}} → {${(next.aliasing?.eligiblePEs ?? []).join(", ")}}`],
  },
  {
    id: "next-hop-transformation",
    label: "Next-Hop Set, Before And After",
    narrative: `${SERVER_A_MAC} → ESI ${ESI.slice(-8)} → { LEAF1, LEAF2 } before, { LEAF2 } after Mass Withdrawal. LEAF1 removed — SERVER-A's MAC identity never changed.`,
  },
  {
    id: "type2-route-still-visible",
    label: "An Important Distinction: Route Exists ≠ Next Hop Usable",
    narrative: "SERVER-A's Type-2 MAC route may still exist in control-plane history — but LEAF1 is no longer a usable forwarding next hop, because of the A-D per-ES withdrawal. A route object existing is not the same thing as a next hop being eligible/usable — the same distinction the BGP and Type-5 lessons drew between a route being received and a route being installed/used.",
  },
  {
    id: "resend-after-mass-withdrawal",
    label: "Resend Both Flows",
    narrative: "Flow A and Flow B are sent again, identically.",
    packet: () => framePacket("f-flow-a2", "HOST-B", "LEAF3", "Known unicast — HOST-B → SERVER-A (Flow A, resend)", "FRAME", unicastFrame()),
    run: (state) => {
      const pe = state.aliasing?.selectedPe.A ?? "LEAF2";
      return {
        state: { ...state, packetAt: "SERVER-A", journey: [...state.journey, { device: "LEAF3", input: `Known unicast → ${SERVER_A_MAC}`, lookup: `Eligible set {${(state.aliasing?.eligiblePEs ?? []).join(", ")}} → flow selects ${pe}`, action: "ALIAS_SELECT", output: `VXLAN encapsulated toward ${pe}` }, { device: pe, input: `VXLAN(VNI ${VNI})`, lookup: `VNI ${VNI} → local ESI ${ESI.slice(-8)} → SERVER-A`, action: "LOCAL_DELIVER", output: "Delivered to SERVER-A" }] },
        events: [{ type: "PACKET_RECEIVED", stepId: "resend-after-mass-withdrawal", timestamp: Date.now(), message: "Both Flow A and Flow B now converge on LEAF2 — SERVER-A remains reachable" }],
      };
    },
    whatChanged: () => ["Flow A now uses LEAF2 (was LEAF1)", "Flow B still uses LEAF2", "SERVER-A remains fully reachable through the surviving PE"],
  },
  {
    id: "scaling-visualization",
    label: "Why This Matters At Scale",
    narrative: "Consider this Ethernet Segment carrying 1 MAC, 100 MACs, or 1,000 MACs. Without a fast ES-level signal, potentially many dependent MAC forwarding entries would need to individually converge. With A-D per-ES withdrawal, one ES-level failure signal can invalidate the failed PE across every dependent MAC destination at once. This is a control-plane dependency/scaling comparison, not a claim about exact convergence time or packet counts.",
  },
  {
    id: "mass-withdrawal-vs-df",
    label: "Mass Withdrawal Is Not DF Re-Election",
    narrative: "DF re-election answers: \"who forwards relevant BUM traffic toward the ES?\" Mass Withdrawal answers: \"which failed PE must be removed from forwarding for destinations behind this ES?\" Both can occur around the same failure — they solve different problems.",
  },
  {
    id: "combined-failure-view",
    label: "One Failure, Two Independent Updates",
    narrative: "LEAF1's ES link fails → in parallel: DF state may change (BUM role updated) AND A-D per-ES is withdrawn (known-unicast next-hop set updated). These are two independent mechanisms responding to the same event, not one causing the other.",
  },
  {
    id: "aliasing-vs-df-vs-mass-withdrawal",
    label: "Three Concepts, Three Purposes",
    narrative: "ALIASING — purpose: multiple eligible paths toward an all-active ES; traffic: known unicast. DF ELECTION — purpose: avoid duplicate BUM delivery toward the ES; traffic: BUM. MASS WITHDRAWAL — purpose: rapidly prune a failed ES-facing PE; event: failure/convergence.",
  },
  {
    id: "type1-summary",
    label: "Type 1 Through 5, Extended",
    narrative: "The EVPN route viewer can now filter Route Type 1 further: ALL TYPE 1, PER ES, or PER EVI — still just one route type, two forms, distinguished by purpose.",
  },
  {
    id: "break-intro",
    label: "Break The Fabric",
    narrative: "Everything converged cleanly so far. Time for one controlled, educational fault: a processing inconsistency, not normal EVPN behavior.",
  },
  {
    id: "fault-injected",
    label: "LEAF3 Never Applied The Mass Withdrawal",
    narrative: "LEAF1's ES attachment has failed and LEAF1 correctly generated the A-D per-ES withdrawal — but in this injected fault, LEAF3 has not applied the mass-withdrawal state and still considers { LEAF1, LEAF2 } eligible. Traffic sometimes hashes toward LEAF1 and fails.",
    run: (state) => {
      const stale = { ...state, staleAliasingFault: true, massWithdrawalProcessed: false };
      return { state: recomputeAliasingSet(stale), events: [{ type: "BGP_STATE_CHANGED", stepId: "fault-injected", timestamp: Date.now(), message: "LEAF3's aliasing next-hop set made stale (deliberate fault) — LEAF1 still considered eligible" }] };
    },
    whatChanged: () => ["LEAF3's aliasing set reverted to { LEAF1, LEAF2 } despite LEAF1's withdrawal already having been sent"],
  },
  {
    id: "trouble-intro",
    label: "Troubleshoot",
    narrative: "Complaint: \"SERVER-A is reachable sometimes, but some flows fail.\" Type-2 MAC route exists. BGP session exists. VTEP is reachable. Yet one next hop is still invalid.",
  },
  {
    id: "trouble-question",
    label: "Troubleshoot",
    narrative: "Checking only `show bgp` shows a healthy session and a present route.",
    question: {
      prompt: "Why can `show bgp` alone be insufficient here?",
      options: [
        { id: "bgp-down", label: "Because the BGP session is actually down" },
        { id: "route-missing", label: "Because the Type-2 route is missing" },
        { id: "local-attach", label: "Because the local ES attachment behind a reachable VTEP can fail independently of BGP/session health" },
        { id: "vni-wrong", label: "Because VNI 10010 is misconfigured" },
      ],
      correctOptionId: "local-attach",
      explanation: "LEAF1's device, underlay, BGP EVPN session, and VTEP reachability are all healthy — the failure is narrowly scoped to its local ES-facing attachment, plus a processing gap on LEAF3 that hasn't yet pruned LEAF1 from the aliasing set.",
      hints: [
        "Hint 1: the Type-2 MAC route, BGP session, and VTEP reachability are all confirmed healthy.",
        "Hint 2: the A-D per-ES withdrawal was sent — the question is whether it has been processed.",
        "Hint 3: compare what LEAF1's own ES attachment state says against what LEAF3's aliasing set says.",
      ],
    },
  },
  {
    id: "diagnostic-layers",
    label: "Layer By Layer",
    narrative: "The failure is narrowly scoped to mass-withdrawal processing and its downstream aliasing state — every layer beneath it is healthy.",
  },
  {
    id: "repair-challenge",
    label: "Engineer Challenge — Converge The Multihomed Segment",
    narrative: "SERVER-A is dual-homed. LEAF1's ES-facing attachment has failed. BGP and underlay remain healthy. Some flows still fail. Inspect the aliasing set, find LEAF1 still listed, inspect LEAF1's A-D routes, discover the per-ES withdrawal was already sent — then apply the fix: process the mass withdrawal and recompute the aliasing next-hop set.",
    action: (state, payload) => {
      const choice = typeof payload === "object" && payload !== null && "choice" in payload ? String((payload as { choice: string }).choice) : "";
      if (choice !== REPAIR_CORRECT_ID) return { state: { ...state, repairAttempt: { choice, correct: false } }, events: [] };
      const repaired = applyMassWithdrawal({ ...state, staleAliasingFault: false });
      return { state: { ...repaired, repairAttempt: { choice, correct: true }, challengeSucceeded: true }, events: [{ type: "ROUTE_SELECTED", stepId: "repair-challenge", timestamp: Date.now(), message: "Mass withdrawal processed — LEAF1 pruned from the aliasing set" }] };
    },
    requiresState: (state) => state.challengeSucceeded === true,
  },
  {
    id: "verify-converged",
    label: "Verify — Traffic Converges",
    narrative: "Resend the flow that previously failed to prove SERVER-A is reachable again.",
    packet: () => framePacket("f-verify", "HOST-B", "LEAF3", "Verification flow — HOST-B → SERVER-A", "FRAME", unicastFrame()),
    run: (state) => {
      const pe = state.aliasing?.selectedPe.A ?? "LEAF2";
      return {
        state: { ...state, packetAt: "SERVER-A", journey: [...state.journey, { device: "LEAF3", input: `Known unicast → ${SERVER_A_MAC}`, lookup: `Eligible set {${(state.aliasing?.eligiblePEs ?? []).join(", ")}} → flow selects ${pe}`, action: "ALIAS_SELECT", output: `VXLAN encapsulated toward ${pe}` }, { device: pe, input: `VXLAN(VNI ${VNI})`, lookup: `VNI ${VNI} → local ESI ${ESI.slice(-8)} → SERVER-A`, action: "LOCAL_DELIVER", output: "Delivered to SERVER-A" }] },
        events: [{ type: "PACKET_RECEIVED", stepId: "verify-converged", timestamp: Date.now(), message: "SERVER-A receives the flow via LEAF2 — converged" }],
      };
    },
    whatChanged: () => ["✓ Mass withdrawal processed", "✓ LEAF1 pruned from the eligible set", "✓ All flows now use LEAF2", "✓ SERVER-A reachable"],
  },
  {
    id: "route-type-recap",
    label: "The Full Route-Type Mental Map",
    narrative: 'Type 1: "Ethernet-Segment reachability/state" (per-ES: attachment; per-EVI: aliasing). Type 2: "Where is this MAC/IP?" Type 3: "Who participates in this BUM domain?" Type 4: "Who else is attached to this Ethernet Segment?" (ES discovery/DF). Type 5: "Where is this IP prefix?"',
  },
  {
    id: "complete",
    label: "Lesson Complete",
    narrative: "SERVER-A stayed reachable through a PE failure without waiting for a single MAC route to be withdrawn individually — Aliasing gave LEAF3 more than one usable path, and Mass Withdrawal rapidly pruned the failed PE the moment its ES attachment went down.",
  },
];
