import type { PacketVisual, ScenarioStep } from "../types";
import { HOST_B_IP, HOST_B_MAC, VLAN, VNI, buildPacketLayers, type DataFrame } from "./evpnVxlan";
import { VTEP_LOOPBACK } from "./evpnBum";

/**
 * EVPN Multihoming Foundations — Ethernet Segment, ESI, Route Types
 * 1/4, and DF Election. The seventh lesson in the EVPN track, reusing
 * the same fabric and wire format `evpnVxlan.ts` already built (see
 * docs/ARCHITECTURE.md §4). HOST-B and its VNI/VLAN identity are
 * imported verbatim; SERVER-A is new — the first dual-homed endpoint
 * in the track.
 *
 * The question this lesson answers: a single-homed endpoint (every
 * earlier lesson) has exactly one VTEP that could ever originate its
 * traffic. What happens when an endpoint is INTENTIONALLY attached to
 * two VTEPs at once, for redundancy? Every remote VTEP now has two
 * possible paths toward it, and — critically — BUM traffic could be
 * delivered to it twice unless exactly one attached PE is elected to
 * forward BUM traffic onto that shared attachment at any moment.
 *
 * Explicitly DEFERRED (per the user's own stated scope): Aliasing,
 * Mass Withdrawal, complex multi-failure convergence, a Single-Active
 * deep dive, EVPN-VPWS, vendor ESI-LAG configuration syntax. DF
 * re-election is taught as ONE part of multihoming convergence, not
 * the whole story — the lesson says so explicitly.
 *
 * Pure data + pure functions only — see /lib/sim-engine/types.ts.
 */

export type LeafId = "LEAF1" | "LEAF2" | "LEAF3";
export type EvpnMultihomingDeviceId = "SERVER-A" | LeafId | "SPINE1" | "HOST-B";
export const FABRIC_DEVICES: EvpnMultihomingDeviceId[] = ["LEAF1", "SPINE1", "LEAF2", "LEAF3"];
export const ES_LEAFS: LeafId[] = ["LEAF1", "LEAF2"];

export { HOST_B_IP, HOST_B_MAC, VLAN, VNI, VTEP_LOOPBACK };
export const SERVER_A_IP = "10.10.10.33";
export const SERVER_A_MAC = "DD:DD:DD:DD:DD:33";

export const ESI = "00:11:22:33:44:55:66:77:88:99";
const EVPN_EXPORT_RT = "65000:10010";
function rdFor(leaf: LeafId): string {
  return `${VTEP_LOOPBACK[leaf]}:${VNI}`;
}

export const TERMS: { term: string; expansion: string; meaning: string }[] = [
  { term: "Ethernet Segment", expansion: "Shared Attachment", meaning: "The Ethernet attachment shared between a multihomed site/device and the EVPN PEs/VTEPs serving it — not just \"two links.\"" },
  { term: "ESI", expansion: "Ethernet Segment Identifier", meaning: "Identifies the Ethernet Segment itself — never an individual host, cable, or VNI." },
  { term: "Type 4", expansion: "Ethernet Segment Route", meaning: "\"Who else is attached to this Ethernet Segment?\" — ES peer discovery and DF-election participation." },
  { term: "Type 1", expansion: "Ethernet Auto-Discovery", meaning: "Multihoming reachability/state signaling associated with the Ethernet Segment — a different route, a different purpose, from Type 4." },
  { term: "DF", expansion: "Designated Forwarder", meaning: "Scoped to one ESI + one EVI: which attached PE forwards BUM traffic onto the shared segment. Never a router-wide \"only this PE forwards\" role." },
];

// ---------------------------------------------------------------------------
// Ethernet Segment / ESI / route models
// ---------------------------------------------------------------------------

export interface EthernetSegment {
  esi: string;
  mode: "all-active";
  leafs: LeafId[];
  vlan: number;
  vni: number;
}
export const ETHERNET_SEGMENT: EthernetSegment = { esi: ESI, mode: "all-active", leafs: ES_LEAFS, vlan: VLAN, vni: VNI };

export interface Type4Route {
  esi: string;
  originLeaf: LeafId;
  originatorIp: string;
  rd: string;
  rt: string;
}
export interface Type1Route {
  esi: string;
  originLeaf: LeafId;
  scope: "per-es" | "per-evi";
  ethernetTag: number;
  rd: string;
  rt: string;
}

export interface DfCandidate {
  leaf: LeafId;
  electionValue: string; // this lesson's basic/default algorithm: the candidate's own VTEP IP
  available: boolean;
}
export interface DfState {
  esi: string;
  evi: string;
  algorithm: string;
  candidates: DfCandidate[];
  winner?: LeafId;
  reason: string;
  previousWinner?: LeafId;
}

export type MhAction = "UNDERLAY_FORWARD" | "DF_FORWARD_TO_ES" | "NDF_SUPPRESS" | "UNICAST_DELIVER";
export interface JourneyHop {
  device: EvpnMultihomingDeviceId;
  input: string;
  lookup: string;
  action: MhAction;
  output: string;
}

export interface EvpnMultihomingState {
  bgpSessionUp: boolean;
  type4Routes: Partial<Record<LeafId, Type4Route>>;
  esPeersDiscovered: Partial<Record<LeafId, LeafId[]>>;
  type1Routes: Partial<Record<LeafId, Type1Route[]>>;
  dfState: DfState;
  leaf1Failed: boolean;
  dualDfFault: boolean;

  bumSent: boolean;
  replicaStage: "none" | "leaf3-to-spine" | "spine-to-es-leafs" | "delivered";
  forwardingCopies: { leaf: LeafId; delivered: boolean; reason: string }[];
  packetAt?: EvpnMultihomingDeviceId;
  journey: JourneyHop[];

  unicastDemoShown: boolean;

  repairAttempt?: { choice: string; correct: boolean };
  challengeSucceeded?: boolean;
}

function candidateSet(leaf1Failed: boolean): DfCandidate[] {
  return ES_LEAFS.filter((l) => !(leaf1Failed && l === "LEAF1")).map((l) => ({ leaf: l, electionValue: VTEP_LOOPBACK[l], available: true }));
}

export function createEvpnMultihomingState(): EvpnMultihomingState {
  return {
    bgpSessionUp: false,
    type4Routes: {},
    esPeersDiscovered: {},
    type1Routes: {},
    dfState: { esi: ESI, evi: `VLAN ${VLAN} / VNI ${VNI}`, algorithm: "Basic/default for this lesson (ordinal — lowest candidate VTEP IP wins)", candidates: candidateSet(false), reason: "Not yet elected" },
    leaf1Failed: false,
    dualDfFault: false,
    bumSent: false,
    replicaStage: "none",
    forwardingCopies: [],
    journey: [],
    unicastDemoShown: false,
  };
}

// ---------------------------------------------------------------------------
// Pure scenario functions (brief §41)
// ---------------------------------------------------------------------------

export function originateEthernetSegmentRoute(leaf: LeafId): Type4Route {
  return { esi: ESI, originLeaf: leaf, originatorIp: VTEP_LOOPBACK[leaf], rd: rdFor(leaf), rt: EVPN_EXPORT_RT };
}
export function originateEthernetAdRoute(leaf: LeafId, scope: "per-es" | "per-evi"): Type1Route {
  return { esi: ESI, originLeaf: leaf, scope, ethernetTag: scope === "per-evi" ? VNI : 0xffffffff, rd: rdFor(leaf), rt: EVPN_EXPORT_RT };
}
export function discoverEsPeers(routes: Partial<Record<LeafId, Type4Route>>): Partial<Record<LeafId, LeafId[]>> {
  const origins = (Object.keys(routes) as LeafId[]).filter((l) => routes[l]);
  const peers: Partial<Record<LeafId, LeafId[]>> = {};
  for (const l of origins) peers[l] = origins.filter((o) => o !== l);
  return peers;
}

/** Standards-valid but deliberately BASIC default election: lowest candidate VTEP IP wins. Real deployments may use other algorithms (e.g. highest-random-weight, preference-based) — always call this what it is, never "the" universal algorithm. */
export function electDesignatedForwarder(candidates: DfCandidate[], _previousWinner: LeafId | undefined): { winner?: LeafId; reason: string } {
  const available = candidates.filter((c) => c.available);
  if (available.length === 0) return { winner: undefined, reason: "No candidates available for this ESI/EVI." };
  const sorted = [...available].sort((a, b) => a.electionValue.localeCompare(b.electionValue));
  const winner = sorted[0].leaf;
  return { winner, reason: `${winner} has the lowest candidate VTEP IP (${sorted[0].electionValue}) among {${available.map((c) => c.leaf).join(", ")}} — basic/default ordinal election.` };
}

export function shouldForwardBumToEs(leaf: LeafId, dfState: DfState): boolean {
  return dfState.winner === leaf;
}

/**
 * Three-state DF role, generic enough for any future DF-based lesson:
 * before an election has run, a candidate is neither DF nor NDF — it's
 * simply "not-elected" yet. Never collapse this into a false NDF just
 * because `winner !== leaf`.
 */
export type DfRole = "not-elected" | "df" | "ndf";
export function dfRoleFor(dfState: DfState, leaf: LeafId): DfRole {
  if (!dfState.winner) return "not-elected";
  return dfState.winner === leaf ? "df" : "ndf";
}

export function failEsPe(state: EvpnMultihomingState, leaf: LeafId): EvpnMultihomingState {
  if (leaf !== "LEAF1") return state;
  return { ...state, leaf1Failed: true };
}

export function recomputeDf(state: EvpnMultihomingState): EvpnMultihomingState {
  const candidates = candidateSet(state.leaf1Failed);
  const { winner, reason } = electDesignatedForwarder(candidates, state.dfState.winner);
  return { ...state, dfState: { ...state.dfState, candidates, winner, reason, previousWinner: state.dfState.winner } };
}

// ---------------------------------------------------------------------------
// Graph layout
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

/** Logical view (brief §23) — the ESI as one shared object above both PEs, DF/NDF roles drawn directly on the two paths down to SERVER-A. */
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

function bumFrame(overrides: Partial<DataFrame> = {}): DataFrame {
  return { innerSrcMac: HOST_B_MAC, innerDstMac: "FF:FF:FF:FF:FF:FF", innerSrcIp: HOST_B_IP, innerDstIp: "255.255.255.255", encapsulated: false, ...overrides };
}
function unicastFrame(overrides: Partial<DataFrame> = {}): DataFrame {
  return { innerSrcMac: SERVER_A_MAC, innerDstMac: HOST_B_MAC, innerSrcIp: SERVER_A_IP, innerDstIp: HOST_B_IP, encapsulated: false, ...overrides };
}
function framePacket(id: string, from: EvpnMultihomingDeviceId, to: EvpnMultihomingDeviceId, summary: string, badge: string, f: DataFrame): PacketVisual {
  return { id, protocol: f.encapsulated ? "VXLAN" : "ETHERNET", from, to, summary, badge, broadcast: f.innerDstMac === "FF:FF:FF:FF:FF:FF", layers: buildPacketLayers(f) };
}

function type4Packet(id: string, from: LeafId, to: LeafId, route: Type4Route): PacketVisual {
  return { id, protocol: "BGP", from, to, summary: `EVPN Type 4 — ESI ${route.esi.slice(-8)} from ${route.originLeaf}`, badge: "EVPN TYPE 4 UPDATE", layers: [{ name: "BGP UPDATE (EVPN)", color: "var(--pv-proto-bgp)", fields: [
    { label: "AFI/SAFI", value: "L2VPN EVPN" },
    { label: "Route Type", value: "4 (Ethernet Segment Route)" },
    { label: "Ethernet Segment Identifier", value: route.esi },
    { label: "Originating PE / Router IP", value: route.originatorIp },
    { label: "RD", value: route.rd },
    { label: "Route Target", value: route.rt },
  ] }] };
}
function type1Packet(id: string, from: LeafId, to: LeafId, route: Type1Route): PacketVisual {
  return { id, protocol: "BGP", from, to, summary: `EVPN Type 1 — Ethernet A-D (${route.scope}) from ${route.originLeaf}`, badge: "EVPN TYPE 1 UPDATE", layers: [{ name: "BGP UPDATE (EVPN)", color: "var(--pv-proto-bgp)", fields: [
    { label: "AFI/SAFI", value: "L2VPN EVPN" },
    { label: "Route Type", value: "1 (Ethernet Auto-Discovery)" },
    { label: "Ethernet Segment Identifier", value: route.esi },
    { label: "Ethernet Tag ID (Advanced)", value: route.scope === "per-evi" ? String(route.ethernetTag) : "0xFFFFFFFF (per-ES)" },
    { label: "RD", value: route.rd },
    { label: "Route Target", value: route.rt },
  ] }] };
}

export { framePacket, type4Packet, type1Packet, bumFrame, unicastFrame };

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

export const evpnMultihomingSteps: ScenarioStep<EvpnMultihomingState>[] = [
  {
    id: "intro",
    label: "Why Attach SERVER-A To Two Leafs?",
    narrative: "SERVER-A is dual-homed — physically connected to both LEAF1 and LEAF2 through one logical attachment. HOST-B, behind LEAF3, is single-homed, exactly like every earlier lesson's endpoints.",
  },
  {
    id: "predict-why-dual-home",
    label: "Predict",
    narrative: "Before naming the mechanism:",
    question: {
      prompt: "Why attach SERVER-A to two separate leafs instead of one?",
      options: [
        { id: "redundancy", label: "Redundancy — link or node failure shouldn't take SERVER-A offline, and both may forward at once" },
        { id: "speed", label: "It makes each individual link faster" },
        { id: "required", label: "EVPN requires every endpoint to be dual-homed" },
        { id: "cheaper", label: "It's simply cheaper than a single link" },
      ],
      correctOptionId: "redundancy",
      explanation: "Link and node resiliency — if one leaf or one link fails, SERVER-A stays reachable through the other. In All-Active mode, both attachments can even participate in forwarding at once, not just standby.",
    },
  },
  {
    id: "predict-how-know-same-es",
    label: "Predict",
    narrative: "LEAF1 and LEAF2 are two separate, independent devices.",
    question: {
      prompt: "How does EVPN know that LEAF1 and LEAF2 both connect to the very same shared attachment?",
      options: [
        { id: "guess", label: "It infers this automatically from VLAN 10 alone" },
        { id: "shared-id", label: "Both are configured with the same shared identifier for that attachment" },
        { id: "spine", label: "SPINE1 tells them" },
        { id: "cant", label: "It can't — this has to be manually synchronized out of band every time" },
      ],
      correctOptionId: "shared-id",
      explanation: "Both PEs are configured with the same identifier for the shared attachment — that identifier is what this lesson is about.",
    },
  },
  {
    id: "ethernet-segment-intro",
    label: "The Ethernet Segment",
    narrative: "An Ethernet Segment represents the Ethernet attachment shared between a multihomed site/device and the EVPN PEs serving it — not merely \"two links that happen to exist.\" Click the Ethernet Segment object: SERVER-A ├── LEAF1, └── LEAF2.",
    run: (state) => ({ state: { ...state, bgpSessionUp: true }, events: [{ type: "BGP_STATE_CHANGED", stepId: "ethernet-segment-intro", timestamp: Date.now(), message: "LEAF1 ↔ LEAF2 ↔ LEAF3 BGP EVPN mesh Established" }] }),
  },
  {
    id: "esi-inspector",
    label: "The Ethernet Segment Identifier",
    narrative: `ESI ${ESI} is assigned identically on both LEAF1 and LEAF2 — LEAF3 has no ESI at all, it isn't part of this segment. The ESI identifies the Ethernet Segment itself: never an individual host, an individual cable, or a VNI. Mode: All-Active (multiple PEs may actively forward) — Single-Active, where only one PE forwards at a time, exists but isn't built in this lesson.`,
  },
  {
    id: "physical-dual-attachment",
    label: "SERVER-A's Two Active Attachments",
    narrative: "In the 3D view, SERVER-A shows two live links — to LEAF1 and to LEAF2. Click either one: physical state, VLAN/VNI, Ethernet Segment, ESI, multihoming mode, and DF status for this Ethernet Tag/EVI are all part of that link's own detail. The ESI itself is not a new protocol running over the cable — it's an identifier both ends already agree on.",
  },
  {
    id: "predict-neither-knows-yet",
    label: "Predict",
    narrative: "LEAF1 knows \"I am attached to ESI X.\" So does LEAF2. But so far, neither has told the other.",
    question: {
      prompt: "At this exact moment, does LEAF1 know that LEAF2 is attached to the same Ethernet Segment?",
      options: [
        { id: "yes", label: "Yes — this is automatic" },
        { id: "no", label: "No — each only knows its own local attachment until something tells it otherwise" },
      ],
      correctOptionId: "no",
      explanation: "Local configuration only tells a leaf about its own attachment. Discovering the OTHER PE(s) sharing the same Ethernet Segment needs its own control-plane mechanism.",
    },
  },
  {
    id: "type4-intro",
    label: "EVPN Route Type 4 — Ethernet Segment Route",
    narrative: 'That mechanism is EVPN Route Type 4. Mental shortcut: "Which PEs participate in this Ethernet Segment?" Type 4 never advertises ordinary host MAC reachability — that remains Type 2\'s job, unchanged.',
  },
  {
    id: "type4-advertise-leaf1",
    label: "LEAF1 Advertises Type 4",
    narrative: "LEAF1 advertises its own ESI membership.",
    packet: (state) => (state.type4Routes.LEAF1 ? type4Packet("t4-leaf1", "LEAF1", "LEAF2", state.type4Routes.LEAF1) : undefined),
    run: (state) => {
      const route = originateEthernetSegmentRoute("LEAF1");
      const type4Routes = { ...state.type4Routes, LEAF1: route };
      return { state: { ...state, type4Routes, esPeersDiscovered: discoverEsPeers(type4Routes) }, events: [{ type: "MPBGP_VPN_ROUTE_ADVERTISED", stepId: "type4-advertise-leaf1", timestamp: Date.now(), message: "LEAF1 advertises a Type 4 Ethernet Segment route" }] };
    },
  },
  {
    id: "type4-advertise-leaf2",
    label: "LEAF2 Advertises Type 4 — ES Membership Discovered",
    narrative: `LEAF2 advertises the exact same ESI. Now both directions are known: ESI ${ESI.slice(-8)} → LEAF1, LEAF2.`,
    packet: (state) => (state.type4Routes.LEAF2 ? type4Packet("t4-leaf2", "LEAF2", "LEAF1", state.type4Routes.LEAF2) : undefined),
    run: (state) => {
      const route = originateEthernetSegmentRoute("LEAF2");
      const type4Routes = { ...state.type4Routes, LEAF2: route };
      return { state: { ...state, type4Routes, esPeersDiscovered: discoverEsPeers(type4Routes) }, events: [{ type: "MPBGP_VPN_ROUTE_ADVERTISED", stepId: "type4-advertise-leaf2", timestamp: Date.now(), message: "LEAF2 advertises a Type 4 Ethernet Segment route — ES membership fully discovered" }] };
    },
    whatChanged: () => ["LEAF1 discovers LEAF2 as an ES peer", "LEAF2 discovers LEAF1 as an ES peer"],
  },
  {
    id: "type1-intro",
    label: "EVPN Route Type 1 — Ethernet Auto-Discovery",
    narrative: 'Type 1 (Ethernet A-D) signals multihoming reachability and convergence-related state tied to the Ethernet Segment — advertised per-ES and per-EVI (the per-EVI detail sits behind [Advanced]). Type 1 vs. Type 4: Type 1 is about multihoming reachability/state; Type 4 is about ES peer discovery and DF-election participation. Related, never interchangeable.',
    run: (state) => {
      const perEs = originateEthernetAdRoute("LEAF1", "per-es");
      const perEvi = originateEthernetAdRoute("LEAF1", "per-evi");
      return { state: { ...state, type1Routes: { ...state.type1Routes, LEAF1: [perEs, perEvi] } }, events: [{ type: "MPBGP_VPN_ROUTE_ADVERTISED", stepId: "type1-intro", timestamp: Date.now(), message: "LEAF1 advertises Ethernet A-D (Type 1) routes" }] };
    },
  },
  {
    id: "evpn-summary-extended",
    label: "The EVPN Route Table, Now With Five Types",
    narrative: "Open any leaf's EVPN Routes tab: Type 1 · Ethernet A-D, Type 2 · MAC/IP, Type 3 · IMET, Type 4 · Ethernet Segment, Type 5 · IP Prefix — filterable, each with its own textual category badge, never relying on color alone.",
  },
  {
    id: "duplicate-bum-problem",
    label: "The Duplicate-Delivery Problem",
    narrative: "HOST-B sends a broadcast toward VNI 10010. LEAF3 replicates it as BUM — and if BOTH LEAF1 and LEAF2 forwarded that same frame onto SERVER-A's Ethernet Segment, SERVER-A would receive two copies of one broadcast.",
  },
  {
    id: "predict-which-should-forward",
    label: "Predict",
    narrative: "Both LEAF1 and LEAF2 are legitimately attached to the same Ethernet Segment.",
    question: {
      prompt: "Which PE should actually forward this BUM traffic onto the shared Ethernet Segment?",
      options: [
        { id: "both", label: "Both — duplicate delivery is fine" },
        { id: "neither", label: "Neither — BUM should never reach a multihomed segment" },
        { id: "elected", label: "Exactly one, elected for this specific ESI/EVI" },
      ],
      correctOptionId: "elected",
      explanation: "Exactly one attached PE needs to be elected to forward BUM traffic onto the shared segment for this specific ESI/EVI — introducing Designated Forwarder election.",
    },
  },
  {
    id: "df-important-note",
    label: "What DF Does NOT Mean",
    narrative: "DF does not mean \"only this PE may forward every packet.\" In an All-Active Ethernet Segment, multiple PEs may participate in unicast forwarding. DF election controls one specific thing: which PE forwards BUM traffic toward the multihomed Ethernet Segment, so duplicate delivery is avoided.",
  },
  {
    id: "df-election-chamber",
    label: "DF Election Chamber",
    narrative: `ESI ${ESI.slice(-8)}, Ethernet Tag/EVI VLAN ${VLAN} / VNI ${VNI}. Candidates: LEAF1 (${VTEP_LOOPBACK.LEAF1}), LEAF2 (${VTEP_LOOPBACK.LEAF2}). Election algorithm: basic/default for this lesson — lowest candidate VTEP IP wins. Other algorithms exist (preference-based, HRW) but are deferred.`,
    run: (state) => ({ state: recomputeDf(state), events: [{ type: "ROUTE_SELECTED", stepId: "df-election-chamber", timestamp: Date.now(), message: "DF election computed for this ESI/EVI" }] }),
  },
  {
    id: "df-status-visual",
    label: "DF / NDF, Scoped",
    narrative: `LEAF1: DF for ESI ${ESI.slice(-8)}, VLAN ${VLAN}/VNI ${VNI}. LEAF2: NDF for that exact same scope. This is never a permanent, router-wide role — it's specific to this one Ethernet Segment and this one EVI.`,
  },
  {
    id: "enter-leaf1-multihoming-pipeline",
    label: "LEAF1 — Conceptual EVPN Multihoming Control Pipeline",
    narrative: "Ethernet Segment configured → ESI recognized → Type 4 advertised → ES peers discovered → Type 1 state/signaling → DF candidates determined → DF election → forwarding role installed.",
  },
  {
    id: "hostb-sends-bum",
    label: "HOST-B Sends A Broadcast",
    narrative: "An ordinary broadcast, exactly like the BUM lesson's own opening frame.",
    packet: () => framePacket("f-bum", "HOST-B", "LEAF3", "Broadcast Ethernet frame — HOST-B", "BROADCAST", bumFrame()),
    run: (state) => ({ state: { ...state, bumSent: true, packetAt: "LEAF3" }, events: [{ type: "PACKET_SENT", stepId: "hostb-sends-bum", timestamp: Date.now(), message: "HOST-B sends a broadcast" }] }),
  },
  {
    id: "bum-reaches-leaf1-leaf2",
    label: "Ingress Replication — Toward Both ES Members",
    narrative: "LEAF3 replicates the broadcast toward every remote VTEP in the VNI's flood list — LEAF1 and LEAF2 both receive their own independent VXLAN copy. Replication itself doesn't know or care about DF status at all.",
    packet: () => framePacket("f-bum-vxlan", "LEAF3", "SPINE1", "VXLAN replicas toward LEAF1 and LEAF2", "VXLAN", { ...bumFrame(), encapsulated: true, outerSrcVtep: VTEP_LOOPBACK.LEAF3 }),
    run: (state) => ({ state: { ...state, replicaStage: "leaf3-to-spine", journey: [...state.journey, { device: "LEAF3", input: "Broadcast frame", lookup: "VNI 10010 flood list → LEAF1, LEAF2", action: "UNDERLAY_FORWARD", output: "2 VXLAN copies created" }] }, events: [] }),
  },
  {
    id: "leaf1-df-forwards",
    label: "LEAF1 (DF) — Forward Toward The ES",
    narrative: "LEAF1 decapsulates, reads VNI 10010, classifies the frame as BUM, resolves the destination Ethernet Segment, checks its own DF status — DF — and forwards onto the segment.",
    run: (state) => ({
      state: { ...state, replicaStage: "spine-to-es-leafs", journey: [...state.journey, { device: "LEAF1", input: "VXLAN(VNI 10010)", lookup: `Destination ES → DF status = DF`, action: "DF_FORWARD_TO_ES", output: "Forwarded onto the Ethernet Segment" }] },
      events: [{ type: "PACKET_RECEIVED", stepId: "leaf1-df-forwards", timestamp: Date.now(), message: "LEAF1 forwards the BUM frame onto the ES (DF)" }],
    }),
  },
  {
    id: "leaf2-ndf-suppresses",
    label: "LEAF2 (NDF) — Suppress The Duplicate",
    narrative: "LEAF2 goes through the exact same decapsulation and BUM classification — but its own DF status for this ESI/EVI is NON-DF, so it suppresses delivery onto the segment. This is a deliberate forwarding decision, not a dropped or malformed packet.",
    run: (state) => ({
      state: { ...state, replicaStage: "delivered", forwardingCopies: [{ leaf: "LEAF1", delivered: true, reason: "DF — forwarded" }, { leaf: "LEAF2", delivered: false, reason: "NDF — suppressed by DF role" }], journey: [...state.journey, { device: "LEAF2", input: "VXLAN(VNI 10010)", lookup: `Destination ES → DF status = NON-DF`, action: "NDF_SUPPRESS", output: "Suppressed by DF role — no duplicate sent" }, { device: "SERVER-A", input: "1 copy (from LEAF1)", lookup: "—", action: "UNICAST_DELIVER", output: "One copy delivered" }] },
      events: [{ type: "PACKET_DROPPED", stepId: "leaf2-ndf-suppresses", timestamp: Date.now(), message: "LEAF2 suppresses the duplicate BUM copy (NDF)" }],
    }),
  },
  {
    id: "server-a-receives-one-copy",
    label: "SERVER-A Receives Exactly One Copy",
    narrative: "One broadcast sent, one broadcast delivered — even though both PEs are legitimately attached and both received the VXLAN replica. DF election is what made this a single delivery instead of two.",
  },
  {
    id: "all-active-unicast-proof",
    label: "Proving All-Active Unicast Still Works",
    narrative: "DF/NDF status governs BUM forwarding toward the ES specifically. Send ordinary unicast: SERVER-A → HOST-B, via LEAF2 — the very leaf that was NDF for BUM a moment ago.",
    packet: () => framePacket("f-unicast", "SERVER-A", "LEAF2", "Unicast — SERVER-A → HOST-B, via LEAF2", "FRAME", unicastFrame()),
    run: (state) => ({ state: { ...state, unicastDemoShown: true, journey: [...state.journey, { device: "LEAF2", input: "Unicast Ethernet frame", lookup: "Ordinary MAC lookup — DF/NDF status irrelevant to unicast", action: "UNICAST_DELIVER", output: "Forwarded normally, All-Active" }] }, events: [{ type: "PACKET_SENT", stepId: "all-active-unicast-proof", timestamp: Date.now(), message: "LEAF2 forwards ordinary unicast traffic despite being NDF for BUM" }] }),
    whatChanged: () => ["LEAF2 (NDF for BUM) forwards ordinary unicast traffic normally — NDF never means inactive for unicast"],
  },
  {
    id: "split-horizon-note",
    label: "Split-Horizon Protection",
    narrative: "One more high-level piece: EVPN multihoming also avoids sending traffic received FROM an Ethernet Segment back TOWARD that same Ethernet Segment through the other attached PE. The implementation-specific VXLAN mechanics behind this sit behind [Advanced] — not built out fully in this lesson.",
  },
  {
    id: "control-data-both-recap",
    label: "Control Election, Data Behavior",
    narrative: "Control: ESI → Type 4 → Type 1 → ES membership → DF election. Data: remote BUM → LEAF1 + LEAF2 both receive → only the DF delivers toward the ES. The control-plane election is what determines the data-plane BUM behavior you just watched.",
  },
  {
    id: "df-failure-event",
    label: "LEAF1 Fails",
    narrative: "BEFORE: LEAF1 = DF, LEAF2 = NDF. Now fail LEAF1's Ethernet-Segment attachment.",
    run: (state) => ({ state: failEsPe(state, "LEAF1"), events: [{ type: "BGP_SESSION_RESET", stepId: "df-failure-event", timestamp: Date.now(), message: "LEAF1's Ethernet-Segment attachment becomes unavailable" }] }),
  },
  {
    id: "re-election",
    label: "Re-Election",
    narrative: "The candidate set changes — LEAF1 is no longer available. LEAF2 is selected as the new DF for this ESI/EVI. AFTER: LEAF1 = unavailable, LEAF2 = DF.",
    run: (state) => ({ state: recomputeDf(state), events: [{ type: "ROUTE_SELECTED", stepId: "re-election", timestamp: Date.now(), message: "DF re-elected — LEAF2 becomes DF" }] }),
    whatChanged: (prev, next) => [`DF for ESI ${ESI.slice(-8)} / VLAN ${VLAN}: ${prev.dfState.winner} → ${next.dfState.winner}`],
  },
  {
    id: "resend-bum-after-failure",
    label: "Resend The Same Broadcast",
    narrative: "The identical broadcast from HOST-B, sent again — this time it should be delivered via LEAF2.",
    packet: () => framePacket("f-bum-2", "HOST-B", "LEAF3", "Broadcast Ethernet frame — HOST-B (after failure)", "BROADCAST", bumFrame()),
    run: (state) => ({
      state: { ...state, replicaStage: "delivered", forwardingCopies: [{ leaf: "LEAF2", delivered: true, reason: "New DF — forwarded" }], journey: [...state.journey, { device: "LEAF3", input: "Broadcast frame", lookup: "VNI 10010 flood list → LEAF2 (LEAF1 unavailable)", action: "UNDERLAY_FORWARD", output: "1 VXLAN copy created" }, { device: "LEAF2", input: "VXLAN(VNI 10010)", lookup: "Destination ES → DF status = DF (new)", action: "DF_FORWARD_TO_ES", output: "Forwarded onto the Ethernet Segment" }, { device: "SERVER-A", input: "1 copy (from LEAF2)", lookup: "—", action: "UNICAST_DELIVER", output: "One copy delivered, via the new DF" }] },
      events: [{ type: "PACKET_RECEIVED", stepId: "resend-bum-after-failure", timestamp: Date.now(), message: "LEAF2 (new DF) delivers the broadcast to SERVER-A" }],
    }),
  },
  {
    id: "before-after-failure",
    label: "Before / After — Resiliency, Proven",
    narrative: "BEFORE: Remote BUM → LEAF1 (DF) → SERVER-A. AFTER: Remote BUM → LEAF2 (new DF) → SERVER-A. Important limitation: DF re-election is only ONE part of EVPN multihoming convergence — Aliasing, Mass Withdrawal, and detailed failure convergence are later modules, not fully explained by DF election alone.",
  },
  {
    id: "break-intro",
    label: "Break The Fabric",
    narrative: "Everything has worked cleanly so far. Time for one controlled, educational fault: a control-plane inconsistency, not normal EVPN behavior.",
  },
  {
    id: "fault-injected",
    label: "Both LEAF1 And LEAF2 Believe They Are DF",
    narrative: "Physical ES links, underlay, BGP EVPN, ESI, Type-4 discovery, and Type-1 signaling are all healthy — LEAF1 and LEAF2 both correctly see each other as ES peers. But their DF election state has become inconsistent: both now believe they are DF for the same ESI/EVI.",
    run: (state) => ({ state: { ...state, leaf1Failed: false, dualDfFault: true, dfState: { ...state.dfState, candidates: candidateSet(false), winner: "LEAF1", previousWinner: state.dfState.winner, reason: "INCONSISTENT — LEAF2 independently also believes it is DF (educational fault)" } }, events: [{ type: "BGP_STATE_CHANGED", stepId: "fault-injected", timestamp: Date.now(), message: "DF election state made inconsistent between LEAF1 and LEAF2 (deliberate fault)" }] }),
    whatChanged: () => ["LEAF1 believes: DF", "LEAF2 ALSO believes: DF — inconsistent"],
  },
  {
    id: "trouble-intro",
    label: "Troubleshoot",
    narrative: "Complaint: \"SERVER-A is receiving every broadcast twice.\" Physical ES links, underlay, BGP EVPN, ESI, Type-4 ES discovery, and Type-1 A-D are all healthy. Enter LEAF1 — it sees itself as DF. Enter LEAF2 — it ALSO sees itself as DF.",
  },
  {
    id: "trouble-question",
    label: "Troubleshoot",
    narrative: "Every layer up through DF candidate set is healthy.",
    question: {
      prompt: "What's actually causing the duplicate delivery?",
      options: [
        { id: "bgp-evpn", label: "The BGP EVPN session itself" },
        { id: "esi", label: "LEAF1 and LEAF2 have different ESIs configured" },
        { id: "df-consistency", label: "DF election state is inconsistent — both believe they're DF for the same ESI/EVI" },
        { id: "vni", label: "VNI 10010 is misconfigured" },
      ],
      correctOptionId: "df-consistency",
      explanation: "Both PEs correctly recognize the same ESI, correctly discovered each other via Type 4, and correctly hold Type-1 state — the election OUTCOME itself has simply become inconsistent between them, so both act as DF and both forward.",
      hints: [
        "Hint 1: physical, underlay, BGP EVPN, ESI, Type-4, and Type-1 are all confirmed healthy.",
        "Hint 2: this is a deliberately injected control-plane inconsistency, not normal EVPN behavior.",
        "Hint 3: compare what LEAF1 believes about DF status against what LEAF2 believes.",
      ],
    },
  },
  {
    id: "diagnostic-layers",
    label: "Layer By Layer",
    narrative: "Every layer beneath DF election consistency is healthy — the fault is narrowly scoped to the election outcome itself, exactly where it should be to teach the decision chain clearly.",
  },
  {
    id: "repair-challenge",
    label: "Apply The Fix",
    narrative: "Protect the multihomed Ethernet Segment — repair the DF election state so exactly one DF remains.",
    action: (state, payload) => {
      const choice = typeof payload === "object" && payload !== null && "choice" in payload ? String((payload as { choice: string }).choice) : "";
      if (choice !== "recompute-df") return { state: { ...state, repairAttempt: { choice, correct: false } }, events: [] };
      const recomputed = recomputeDf({ ...state, dualDfFault: false });
      return { state: { ...recomputed, repairAttempt: { choice, correct: true }, challengeSucceeded: true }, events: [{ type: "ROUTE_SELECTED", stepId: "repair-challenge", timestamp: Date.now(), message: "DF election recomputed — consistent again" }] };
    },
    requiresState: (state) => state.challengeSucceeded === true,
  },
  {
    id: "verify-single-df",
    label: "Verify — One DF, One Copy",
    narrative: "Resend the broadcast one more time to prove the repair actually restored single delivery.",
    packet: () => framePacket("f-verify", "HOST-B", "LEAF3", "Verification broadcast", "BROADCAST", bumFrame()),
    run: (state) => ({
      state: { ...state, replicaStage: "delivered", forwardingCopies: [{ leaf: state.dfState.winner ?? "LEAF1", delivered: true, reason: "DF — forwarded" }, { leaf: (["LEAF1", "LEAF2"] as LeafId[]).find((l) => l !== state.dfState.winner) ?? "LEAF2", delivered: false, reason: "NDF — suppressed" }], journey: [...state.journey, { device: "LEAF3", input: "Broadcast frame", lookup: "VNI 10010 flood list → LEAF1, LEAF2", action: "UNDERLAY_FORWARD", output: "2 VXLAN copies created" }, { device: state.dfState.winner ?? "LEAF1", input: "VXLAN(VNI 10010)", lookup: "Destination ES → DF status = DF", action: "DF_FORWARD_TO_ES", output: "Forwarded onto the Ethernet Segment" }, { device: "SERVER-A", input: "1 copy", lookup: "—", action: "UNICAST_DELIVER", output: "Exactly one copy delivered" }] },
      events: [{ type: "PACKET_RECEIVED", stepId: "verify-single-df", timestamp: Date.now(), message: "SERVER-A receives exactly one copy again" }],
    }),
    whatChanged: () => ["✓ DF election consistent again", "✓ Exactly one DF, one NDF", "✓ SERVER-A receives one copy, not two", "✓ All-Active unicast unaffected throughout"],
  },
  {
    id: "type-summary",
    label: "Type 1 Through 5 — The Full Map",
    narrative: 'Type 1: "Advertise Ethernet-Segment-related reachability/state." Type 2: "Where is this MAC/IP endpoint?" Type 3: "Who participates in this BUM domain?" Type 4: "Who else is attached to this Ethernet Segment?" Type 5: "Where is this IP prefix?" The shortcuts are mnemonics — the precise purposes are what actually matter.',
  },
  {
    id: "complete",
    label: "Lesson Complete",
    narrative: "SERVER-A stayed reachable through a physical failure, never received a duplicate broadcast once DF election was consistent, and its All-Active unicast forwarding was never affected by which PE happened to be DF for BUM.",
  },
];
