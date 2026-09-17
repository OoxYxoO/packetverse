import type { PacketLayer, PacketVisual, ScenarioStep } from "../types";

/**
 * L2VPN Evolution Capstone — VPWS → LDP-VPLS → BGP-VPLS → H-VPLS → EVPN,
 * one customer (CUST-A), five architectures, compared on the same
 * questions every time: how is the service discovered/signaled, how is
 * MAC reachability learned, how is BUM handled, how does multihoming
 * change, and what stays MPLS transport the whole way through.
 *
 * This file is an ORCHESTRATOR, not a sixth simulator. Every data-plane
 * mechanism (source-MAC learning, split horizon, label-block math, DF
 * election, MAC-mobility sequencing) is imported from the lesson that
 * already built and taught it — mplsL2vpnVpws.ts, mplsVpls.ts,
 * bgpVpls.ts, hVpls.ts, evpnMacMobility.ts, evpnMultihoming.ts — and
 * called for real against this lesson's own CUST-A/CE1-CE3/PE1-PE3
 * topology. Only glue that genuinely does not exist anywhere else
 * (installing a Type-2-style row for CUST-A's own device ids; the
 * comparison/requirement tables themselves) is written fresh here.
 *
 * Explicitly deferred (each already has its own dedicated lesson and is
 * only ever discussed comparatively here, never re-simulated):
 *  - Full hop-by-hop MPLS label-swap simulation through P1/P2/P3 for
 *    every architecture (already taught in depth in mplsL2vpnVpws.ts /
 *    mplsVpls.ts). This lesson uses each protocol's own "service view"
 *    (PE-to-PE) for the shared CE1→CE2/CE3 frame experiments.
 *  - EVPN Type 1/4/5 route mechanics, IRB, ARP/ND suppression, aliasing
 *    and mass withdrawal in full — each has its own lesson; here they
 *    are cited, not re-derived.
 *  - A live BUM replica-count animation for EVPN (Type 3/IMET) — the
 *    dedicated EVPN BUM lesson owns that; this lesson states the
 *    property (ingress replication / underlay multicast) without
 *    re-simulating replica delivery.
 *  - Vendor CLI output for every architecture (each prior lesson's own
 *    CLI panel is not duplicated here).
 *
 * Pure data + pure functions only — see /lib/sim-engine/types.ts.
 */

// ---------------------------------------------------------------------------
// Reused domain logic — imported, never re-derived.
// ---------------------------------------------------------------------------
import {
  CE1_MAC as VPWS_CE1_MAC,
  CE2_MAC as VPWS_CE2_MAC,
  CE1_IP as VPWS_CE1_IP,
  CE2_IP as VPWS_CE2_IP,
  SERVICE_NAME as VPWS_SERVICE_NAME,
  PW_ID as VPWS_PW_ID,
  buildVpwsLabelStack,
  processCoreTransportLabel as vpwsProcessCoreTransportLabel,
  resolveIncomingPwLabel as vpwsResolveIncomingPwLabel,
  buildPacketLayers as vpwsBuildPacketLayers,
  transportLabelFor as vpwsTransportLabelFor,
  allocatePwReceiveLabel as vpwsAllocatePwReceiveLabel,
  type EthernetFrame as VpwsEthernetFrame,
  SERVICE_GRAPH_NODES as VPWS_SERVICE_GRAPH_NODES,
  SERVICE_GRAPH_EDGES as VPWS_SERVICE_GRAPH_EDGES,
} from "./mplsL2vpnVpws";

import {
  CE_IP,
  CE_MAC,
  BROADCAST_MAC,
  SERVICE_NAME as VPLS_SERVICE_NAME,
  type AttachmentCircuit,
  type Fdb,
  type FdbPort,
  learnSourceMac,
  lookupDestinationMac,
  computeVplsEgressSet,
  applySplitHorizon,
  classifyForwardingDecision,
  type ForwardingDecision,
  bridgePortsFor as vplsBridgePortsFor,
  portLabel as vplsPortLabel,
  ethLayer as vplsEthLayer,
  pwPeersOf,
  PW_PAIRS,
  type PwLinkState,
  SERVICE_GRAPH_NODES as VPLS_SERVICE_GRAPH_NODES,
  SERVICE_GRAPH_EDGES as VPLS_SERVICE_GRAPH_EDGES,
} from "./mplsVpls";

import {
  CUST_A_RT,
  RD_BY_PE,
  VE_ID_BY_PE,
  BASELINE_LABEL_BLOCK_BY_PE,
  AS_NUMBER,
  buildVplsNlri,
  derivePwFromImportedNlri,
  formatLabelBlockResult,
  BGP_CONTROL_NODES,
  BGP_CONTROL_EDGES,
} from "./bgpVpls";

import { calculateFullMeshPwCount, calculateHierarchicalPwCount, applyHierarchicalSplitHorizon, classifyHvplsForwardingDecision, type HvplsPort, SERVICE_NAME as HVPLS_SERVICE_NAME, HIERARCHY_GRAPH_NODES, HIERARCHY_GRAPH_EDGES } from "./hVpls";

import { compareMobilityRoutes, selectEndpointLocation, type Type2Route as MobilityType2Route, type LeafId as MobilityLeafId } from "./evpnMacMobility";

import { electDesignatedForwarder, dfRoleFor, type DfCandidate, type DfState, type DfRole, type LeafId as MhLeafId, ETHERNET_SEGMENT } from "./evpnMultihoming";

// ---------------------------------------------------------------------------
// CUST-A topology — CE1/CE2/CE3 on PE1/PE2/PE3, the SAME customer used by
// every prior lesson in this track. RouterId is a superset covering every
// architecture's own device set; no single architecture's view renders all
// of it at once (each `topologyFor()` branch below picks its own subset).
// ---------------------------------------------------------------------------
export type CeId = "CE1" | "CE2" | "CE3";
export type PeId = "PE1" | "PE2" | "PE3";
export type RouterId = CeId | PeId | "P1" | "P2" | "MTU1" | "MTU2" | "RR1" | "CE-DUAL";

export type Architecture = "VPWS" | "VPLS" | "BGP_VPLS" | "H_VPLS" | "EVPN";
export const ARCHITECTURES: Architecture[] = ["VPWS", "VPLS", "BGP_VPLS", "H_VPLS", "EVPN"];
export const ARCHITECTURE_LABEL: Record<Architecture, string> = {
  VPWS: "VPWS",
  VPLS: "LDP-Signaled VPLS",
  BGP_VPLS: "BGP-Signaled VPLS",
  H_VPLS: "H-VPLS",
  EVPN: "EVPN",
};

export const TERMS: { term: string; expansion: string; meaning: string }[] = [
  { term: "CUST-A", expansion: "The Same Customer, Every Time", meaning: "CE1/CE2/CE3 — used across every architecture in this capstone so the learner compares architecture, never business requirement." },
  { term: "Service View", expansion: "PE-to-PE Abstraction", meaning: "Every architecture in this track already taught its own hop-by-hop MPLS label mechanics in a dedicated lesson; this capstone reuses each protocol's own collapsed PE-to-PE view for the shared CE1→CE2/CE3 experiments." },
];

// ---------------------------------------------------------------------------
// Architecture comparison — pure, factual property tables. No component
// ever computes these conclusions; they are handed in already computed
// (ARCHITECTURE.md's rule: no comparison logic in network3d/*).
// ---------------------------------------------------------------------------
export interface ArchitectureProfile {
  architecture: Architecture;
  serviceType: string;
  discovery: string;
  signaling: string;
  macReachability: string;
  bum: string;
  splitHorizon: string;
  multihomingModel: string;
  accessHierarchy: string;
}

export const ARCHITECTURE_PROFILES: Record<Architecture, ArchitectureProfile> = {
  VPWS: {
    architecture: "VPWS",
    serviceType: "Point-to-point Ethernet virtual wire",
    discovery: "None — a single, manually configured remote endpoint",
    signaling: "Targeted LDP (PWid FEC 128, directional VC labels)",
    macReachability: "Not applicable — exactly one remote site, no destination-MAC selection is ever needed",
    bum: "Not applicable — there is no flooding decision in a point-to-point service",
    splitHorizon: "Not applicable — only one remote port exists",
    multihomingModel: "Not covered in this traditional model (EVPN-VPWS single-active is its own, separate lesson)",
    accessHierarchy: "Flat — exactly one PW per service instance",
  },
  VPLS: {
    architecture: "VPLS",
    serviceType: "Multipoint Ethernet LAN service",
    discovery: "None — every pseudowire manually configured, per pair",
    signaling: "Targeted LDP, full mesh of service pseudowires",
    macReachability: "Data-plane source-MAC learning (flood first, learn from what comes back)",
    bum: "Flooded over every service PW except the ingress port",
    splitHorizon: "Mesh PW → mesh PW forwarding forbidden (this is what makes the full mesh loop-free)",
    multihomingModel: "No single unified mechanism taught in this traditional model",
    accessHierarchy: "Flat full mesh — n(n-1)/2 pseudowires",
  },
  BGP_VPLS: {
    architecture: "BGP_VPLS",
    serviceType: "Multipoint Ethernet LAN service — identical service to LDP-VPLS",
    discovery: "BGP auto-discovery via Route Target import (RFC 4761)",
    signaling: "MP-BGP VPLS NLRI — RD, VE ID, label block — over a Route Reflector",
    macReachability: "Still data-plane source-MAC learning — BGP here never carries a customer MAC address",
    bum: "Flooded over every service PW except the ingress port — unchanged from LDP-VPLS",
    splitHorizon: "Mesh PW → mesh PW forwarding forbidden — unchanged from LDP-VPLS",
    multihomingModel: "No single unified mechanism taught in this traditional model",
    accessHierarchy: "Flat full mesh — n(n-1)/2 pseudowires, membership now auto-discovered",
  },
  H_VPLS: {
    architecture: "H_VPLS",
    serviceType: "Hierarchical multipoint Ethernet LAN service — same service as flat VPLS",
    discovery: "None at the access tier (a BGP-signaled core is an orthogonal, combinable choice)",
    signaling: "Spoke PW (MTU-s ↔ PE-rs) plus a smaller core mesh PW (PE-rs ↔ PE-rs), each targeted LDP",
    macReachability: "Still data-plane source-MAC learning, at both tiers",
    bum: "Flooded over every eligible port except ingress, at both tiers",
    splitHorizon: "Mesh → mesh forwarding forbidden; spoke ↔ mesh forwarding freely allowed",
    multihomingModel: "No single unified mechanism taught in this traditional model",
    accessHierarchy: "Hierarchical — access MTU-s spokes plus a smaller PE-rs core mesh",
  },
  EVPN: {
    architecture: "EVPN",
    serviceType: "Multipoint Ethernet service, control-plane-distributed reachability",
    discovery: "BGP auto-discovery via Route Target import (same family of mechanism as BGP-VPLS)",
    signaling: "BGP EVPN NLRI — Type 1/2/3/4/5 routes — over a Route Reflector",
    macReachability: "Control-plane distributed — customer MAC/IP reachability carried directly in Type 2 routes",
    bum: "Type 3/IMET establishes replication-list membership; ingress replication or underlay multicast still carries the BUM traffic itself — not eliminated",
    splitHorizon: "Ethernet Segment / ESI-based DF election replaces pseudowire split horizon",
    multihomingModel: "Native — Ethernet Segment, ESI, DF election, aliasing, mass withdrawal, all-active/single-active",
    accessHierarchy: "Flat BGP control plane; access hierarchy becomes an underlay/fabric design choice, not a service-signaling one",
  },
};

export function describeArchitecture(architecture: Architecture): ArchitectureProfile {
  return ARCHITECTURE_PROFILES[architecture];
}
export const getServiceTopology = (a: Architecture): string => ARCHITECTURE_PROFILES[a].serviceType;
export const getDiscoveryModel = (a: Architecture): string => ARCHITECTURE_PROFILES[a].discovery;
export const getSignalingModel = (a: Architecture): string => ARCHITECTURE_PROFILES[a].signaling;
export const getEndpointLearningModel = (a: Architecture): string => ARCHITECTURE_PROFILES[a].macReachability;
export const getBumModel = (a: Architecture): string => ARCHITECTURE_PROFILES[a].bum;
export const getMultihomingModel = (a: Architecture): string => ARCHITECTURE_PROFILES[a].multihomingModel;

// ---------------------------------------------------------------------------
// State ownership matrix (brief §28/§48) — who knows what, factually.
// ---------------------------------------------------------------------------
export interface StateOwnershipRow {
  node: string;
  customerFdb: string;
  pwOrNlriState: string;
  evpnRoutes: string;
}
export const STATE_OWNERSHIP_ROWS: StateOwnershipRow[] = [
  { node: "P router (any architecture)", customerFdb: "✕", pwOrNlriState: "✕ — transport labels only", evpnRoutes: "✕" },
  { node: "Traditional VPLS PE", customerFdb: "✓ local FDB", pwOrNlriState: "✓ PW state", evpnRoutes: "✕" },
  { node: "BGP-VPLS Route Reflector", customerFdb: "✕", pwOrNlriState: "VPLS NLRI only (membership + label block)", evpnRoutes: "✕" },
  { node: "BGP-VPLS PE", customerFdb: "✓ local FDB", pwOrNlriState: "✓ PW state + VPLS NLRI", evpnRoutes: "✕" },
  { node: "EVPN Route Reflector", customerFdb: "✕", pwOrNlriState: "✕", evpnRoutes: "✓ relays only — never customer-switches a frame" },
  { node: "EVPN PE", customerFdb: "✓ local FDB", pwOrNlriState: "N/A / model-dependent — may still carry MPLS transport state", evpnRoutes: "✓" },
];
export function getStateOwnership(): StateOwnershipRow[] {
  return STATE_OWNERSHIP_ROWS;
}

// ---------------------------------------------------------------------------
// Requirement evaluation (brief §54) — property match, never a "winner".
// ---------------------------------------------------------------------------
export type Requirement = "point-to-point" | "multipoint" | "bgp-discovery" | "access-hierarchy" | "control-plane-mac-ip" | "native-multihoming" | "fast-mac-mobility" | "data-plane-learning-ok";
type SupportLevel = "supported" | "unsupported" | "partial";
export const REQUIREMENT_LABEL: Record<Requirement, string> = {
  "point-to-point": "Point-to-point transparent Ethernet",
  multipoint: "Multipoint Ethernet LAN",
  "bgp-discovery": "BGP-based member discovery/signaling",
  "access-hierarchy": "Fewer full-mesh access relationships (hierarchy)",
  "control-plane-mac-ip": "Control-plane MAC/IP distribution",
  "native-multihoming": "Native modern multihoming (ESI/DF)",
  "fast-mac-mobility": "Fast, sequence-numbered MAC mobility signaling",
  "data-plane-learning-ok": "Data-plane MAC learning is acceptable",
};
const REQUIREMENT_SUPPORT: Record<Requirement, Record<Architecture, SupportLevel>> = {
  "point-to-point": { VPWS: "supported", VPLS: "unsupported", BGP_VPLS: "unsupported", H_VPLS: "unsupported", EVPN: "partial" },
  multipoint: { VPWS: "unsupported", VPLS: "supported", BGP_VPLS: "supported", H_VPLS: "supported", EVPN: "supported" },
  "bgp-discovery": { VPWS: "unsupported", VPLS: "unsupported", BGP_VPLS: "supported", H_VPLS: "partial", EVPN: "supported" },
  "access-hierarchy": { VPWS: "unsupported", VPLS: "unsupported", BGP_VPLS: "unsupported", H_VPLS: "supported", EVPN: "partial" },
  "control-plane-mac-ip": { VPWS: "unsupported", VPLS: "unsupported", BGP_VPLS: "unsupported", H_VPLS: "unsupported", EVPN: "supported" },
  "native-multihoming": { VPWS: "unsupported", VPLS: "unsupported", BGP_VPLS: "unsupported", H_VPLS: "unsupported", EVPN: "supported" },
  "fast-mac-mobility": { VPWS: "unsupported", VPLS: "unsupported", BGP_VPLS: "unsupported", H_VPLS: "unsupported", EVPN: "supported" },
  "data-plane-learning-ok": { VPWS: "partial", VPLS: "supported", BGP_VPLS: "supported", H_VPLS: "supported", EVPN: "partial" },
};
export function evaluateRequirements(architecture: Architecture, requirements: Requirement[]): { requirement: Requirement; status: SupportLevel }[] {
  return requirements.map((r) => ({ requirement: r, status: REQUIREMENT_SUPPORT[r][architecture] }));
}

// ---------------------------------------------------------------------------
// Topology per architecture — reusing each source lesson's OWN graph data
// verbatim (percent-space {id,label,x,y,subLabel} nodes / {id,a,b,label}
// edges). This file adds no new topology facts, only picks which existing
// one is shown for a given architecture.
// ---------------------------------------------------------------------------
export function topologyFor(architecture: Architecture) {
  switch (architecture) {
    case "VPWS":
      return { nodes: VPWS_SERVICE_GRAPH_NODES, edges: VPWS_SERVICE_GRAPH_EDGES };
    case "H_VPLS":
      return { nodes: HIERARCHY_GRAPH_NODES, edges: HIERARCHY_GRAPH_EDGES };
    case "BGP_VPLS":
      return { nodes: BGP_CONTROL_NODES, edges: BGP_CONTROL_EDGES };
    case "VPLS":
    case "EVPN":
    default:
      return { nodes: VPLS_SERVICE_GRAPH_NODES, edges: VPLS_SERVICE_GRAPH_EDGES };
  }
}
/** The SERVICE topology (PE-to-PE mesh) independent of which control plane signals it — used to show BGP-VPLS's/EVPN's service view alongside its control view. */
export function serviceTopology() {
  return { nodes: VPLS_SERVICE_GRAPH_NODES, edges: VPLS_SERVICE_GRAPH_EDGES };
}

// ---------------------------------------------------------------------------
// Same-frame experiment — CE1 → CE2 (and CE1 → CE3), reusing the REAL
// VPLS data-plane functions (learnSourceMac / lookupDestinationMac /
// computeVplsEgressSet / applySplitHorizon / classifyForwardingDecision)
// unmodified from mplsVpls.ts. VPLS and BGP-VPLS share this exact lane —
// only the signaling that got the PW mesh up differs, never this logic.
// ---------------------------------------------------------------------------
export interface JourneyHop {
  device: RouterId;
  input: string;
  lookup: string;
  action: string;
  output: string;
}

const CUST_A_AC: Record<PeId, AttachmentCircuit> = {
  PE1: { peRouter: "PE1", ceRouter: "CE1", interfaceName: "ge-0/0/0.100", vlan: 100, up: true },
  PE2: { peRouter: "PE2", ceRouter: "CE2", interfaceName: "ge-0/0/0.100", vlan: 100, up: true },
  PE3: { peRouter: "PE3", ceRouter: "CE3", interfaceName: "ge-0/0/0.100", vlan: 100, up: true },
};
const CUST_A_PW_LINKS: PwLinkState[] = PW_PAIRS.map((p) => ({ id: p.id, up: true }));
function portsFor(pe: PeId): FdbPort[] {
  return vplsBridgePortsFor(pe, CUST_A_AC[pe], CUST_A_PW_LINKS);
}
function ingressPortFor(pe: PeId, from: RouterId): FdbPort | undefined {
  return portsFor(pe).find((p) => p.peer === from);
}

export interface FloodFrameResult {
  fdb: Fdb;
  decision: ForwardingDecision;
  egress: FdbPort[];
  lookup: ReturnType<typeof lookupDestinationMac>;
}
/** Runs one real frame through one PE's bridge — the exact function chain mplsVpls.ts's own lesson uses. `srcPe` is where the frame ingresses; `srcMac`/`dstMac` are the customer MACs. */
export function runFrameThroughPe(fdbIn: Fdb, srcPe: PeId, srcMac: string, dstMac: string): FloodFrameResult {
  const ingress = ingressPortFor(srcPe, srcMac === CE_MAC.CE1 ? "CE1" : srcMac === CE_MAC.CE2 ? "CE2" : "CE3");
  const { fdb } = learnSourceMac(fdbIn, srcMac, ingress ?? { kind: "AC", peer: "self" });
  const lookup = lookupDestinationMac(fdb, dstMac);
  const allPorts = portsFor(srcPe);
  const rawEgress = computeVplsEgressSet(allPorts, ingress, lookup);
  const egress = applySplitHorizon(rawEgress, ingress);
  const decision = classifyForwardingDecision(lookup, rawEgress, egress);
  return { fdb, decision, egress, lookup };
}

// ---------------------------------------------------------------------------
// BGP-VPLS label-block recap (brief §11) — reusing bgpVpls.ts's own math
// unmodified against CUST-A's real VE IDs / label blocks.
// ---------------------------------------------------------------------------
export function labelBlockRecapRows(): { label: string; value: string }[] {
  const pe1ToPe2 = derivePwFromImportedNlri(VE_ID_BY_PE.PE1, buildVplsNlri("PE2", RD_BY_PE.PE2, VE_ID_BY_PE.PE2, BASELINE_LABEL_BLOCK_BY_PE.PE2, CUST_A_RT, "2.2.2.2"));
  const pe2ToPe1 = derivePwFromImportedNlri(VE_ID_BY_PE.PE2, buildVplsNlri("PE1", RD_BY_PE.PE1, VE_ID_BY_PE.PE1, BASELINE_LABEL_BLOCK_BY_PE.PE1, CUST_A_RT, "1.1.1.1"));
  return [
    { label: "AS", value: String(AS_NUMBER) },
    { label: "Route Target (CUST-A)", value: CUST_A_RT },
    { label: "PE1 — RD / VE ID / Label Block", value: `${RD_BY_PE.PE1} / ${VE_ID_BY_PE.PE1} / VBO=${BASELINE_LABEL_BLOCK_BY_PE.PE1.vbo} VBS=${BASELINE_LABEL_BLOCK_BY_PE.PE1.vbs} LB=${BASELINE_LABEL_BLOCK_BY_PE.PE1.labelBase}` },
    { label: "PE2 — RD / VE ID / Label Block", value: `${RD_BY_PE.PE2} / ${VE_ID_BY_PE.PE2} / VBO=${BASELINE_LABEL_BLOCK_BY_PE.PE2.vbo} VBS=${BASELINE_LABEL_BLOCK_BY_PE.PE2.vbs} LB=${BASELINE_LABEL_BLOCK_BY_PE.PE2.labelBase}` },
    { label: "Label PE1 uses toward PE2", value: `LB + VE-ID − VBO = ${formatLabelBlockResult(pe1ToPe2)}` },
    { label: "Label PE2 uses toward PE1", value: `LB + VE-ID − VBO = ${formatLabelBlockResult(pe2ToPe1)}` },
  ];
}

// ---------------------------------------------------------------------------
// H-VPLS scaling + split-horizon demo — reusing hVpls.ts's own math and
// hierarchical split-horizon classifier unmodified.
// ---------------------------------------------------------------------------
export function scalingComparisonRows(accessSites: number): { label: string; value: string }[] {
  return [
    { label: "Flat full mesh (this many PE-rs-equivalent nodes)", value: `${calculateFullMeshPwCount(accessSites)} pseudowires — n(n−1)/2` },
    { label: "H-VPLS (same access-site count, 3 PE-rs core)", value: `${calculateHierarchicalPwCount(3, accessSites)} pseudowires — core mesh + one spoke per site` },
  ];
}
const MESH_PORT: HvplsPort = { kind: "MESH_PW", peer: "PE2" };
const MESH_PORT_2: HvplsPort = { kind: "MESH_PW", peer: "PE3" };
const SPOKE_PORT: HvplsPort = { kind: "SPOKE_PW", peer: "MTU1" };
export function hvplsSplitHorizonDemo(): { ingress: string; candidateEgress: string; allowed: string; decision: ForwardingDecision }[] {
  const allPorts = [MESH_PORT, MESH_PORT_2, SPOKE_PORT];
  const lookup = { kind: "BROADCAST" as const };
  const meshRawEgress = computeVplsEgressSet(allPorts, MESH_PORT, lookup);
  const spokeRawEgress = computeVplsEgressSet(allPorts, SPOKE_PORT, lookup);
  const meshIngressEgress = applyHierarchicalSplitHorizon(meshRawEgress, MESH_PORT);
  const spokeIngressEgress = applyHierarchicalSplitHorizon(spokeRawEgress, SPOKE_PORT);
  return [
    { ingress: vplsPortLabel(MESH_PORT), candidateEgress: meshRawEgress.map(vplsPortLabel).join(", "), allowed: meshIngressEgress.map(vplsPortLabel).join(", ") || "(none)", decision: classifyHvplsForwardingDecision(lookup, meshRawEgress, meshIngressEgress) },
    { ingress: vplsPortLabel(SPOKE_PORT), candidateEgress: spokeRawEgress.map(vplsPortLabel).join(", "), allowed: spokeIngressEgress.map(vplsPortLabel).join(", ") || "(none)", decision: classifyHvplsForwardingDecision(lookup, spokeRawEgress, spokeIngressEgress) },
  ];
}

// ---------------------------------------------------------------------------
// EVPN Type-2 reachability — the one genuinely new piece of glue: no
// existing EVPN scenario file uses CUST-A's own CE1/CE2/CE3/PE1/PE2/PE3
// ids (they use HOST-A/LEAF/VXLAN naming), so installing a row for THIS
// lesson's own device ids is written fresh. The MECHANISM (advertise on
// local learn, install on remote receipt) is not a new invention — it's
// the same mechanism evpnVxlan.ts already taught, re-expressed here.
// ---------------------------------------------------------------------------
export interface Type2RouteRow {
  mac: string;
  ip: string;
  originPe: PeId;
  rd: string;
  rt: string;
}
export function advertiseType2(originPe: PeId, mac: string, ip: string): Type2RouteRow {
  return { mac, ip, originPe, rd: RD_BY_PE[originPe], rt: CUST_A_RT };
}
export function installedFrom(routes: Type2RouteRow[], mac: string): Type2RouteRow | undefined {
  return routes.find((r) => r.mac === mac);
}

// ---------------------------------------------------------------------------
// EVPN MAC Mobility comparison — reusing evpnMacMobility.ts's OWN
// sequence-number comparison unmodified. LEAF1/LEAF2 here are that
// lesson's device ids; the narrative maps them onto CUST-A's PE1/PE2 for
// this one comparison, since the underlying algorithm has no dependency
// on which lesson's device ids are attached to it.
// ---------------------------------------------------------------------------
export function mobilityComparisonDemo(): { before: MobilityType2Route; after: MobilityType2Route; selected: MobilityType2Route } {
  const before: MobilityType2Route = { mac: CE_MAC.CE2, ip: "192.168.100.2", vni: 0, rd: RD_BY_PE.PE2, rt: CUST_A_RT, nextHop: "PE2-loopback", originLeaf: "LEAF1" as MobilityLeafId, mobilitySeq: 0 };
  const after: MobilityType2Route = { ...before, nextHop: "PE3-loopback", originLeaf: "LEAF2" as MobilityLeafId, mobilitySeq: 1 };
  const selected = compareMobilityRoutes(before, after);
  return { before, after, selected };
}
export { selectEndpointLocation };

// ---------------------------------------------------------------------------
// EVPN Multihoming comparison — reusing evpnMultihoming.ts's OWN DF
// election unmodified. LEAF1/LEAF2 stand in for CE-DUAL's two attaching
// PEs, for the same reason as above.
// ---------------------------------------------------------------------------
export function multihomingComparisonDemo(): { dfState: DfState; roleByLeaf: Record<MhLeafId, DfRole> } {
  const candidates: DfCandidate[] = [
    { leaf: "LEAF1" as MhLeafId, electionValue: "1.1.1.1", available: true },
    { leaf: "LEAF2" as MhLeafId, electionValue: "2.2.2.2", available: true },
  ];
  const { winner, reason } = electDesignatedForwarder(candidates, undefined);
  const dfState: DfState = { esi: ETHERNET_SEGMENT.esi, evi: "CUST-A", algorithm: "Basic/default (lowest candidate loopback wins)", candidates, winner, reason };
  return { dfState, roleByLeaf: { LEAF1: dfRoleFor(dfState, "LEAF1" as MhLeafId), LEAF2: dfRoleFor(dfState, "LEAF2" as MhLeafId) } as Record<MhLeafId, DfRole> };
}

// ---------------------------------------------------------------------------
// Top-level scenario state
// ---------------------------------------------------------------------------
export interface TroubleshootingIncidentState {
  ce3Sent: boolean;
  repairAttempt?: { choice: string; correct: boolean };
  resolved: boolean;
  verified: boolean;
}

export interface L2vpnEvolutionState {
  packet?: PacketVisual;
  packetAt?: RouterId;
  journey: JourneyHop[];

  fdb: Record<PeId, Fdb>;

  type2Routes: Type2RouteRow[];

  incident: TroubleshootingIncidentState;

  challenge?: { choice: string; correct: boolean };
}

export function createL2vpnEvolutionState(): L2vpnEvolutionState {
  return {
    journey: [],
    fdb: { PE1: [], PE2: [], PE3: [] },
    type2Routes: [],
    incident: { ce3Sent: false, resolved: false, verified: false },
  };
}

// ---------------------------------------------------------------------------
// Packet-visual builders
// ---------------------------------------------------------------------------
function ethLayerFrom(srcMac: string, dstMac: string, note: string): PacketLayer {
  return vplsEthLayer(vplsCeFrom(srcMac, dstMac, note));
}
function vplsCeFrom(srcMac: string, dstMac: string, note: string) {
  return { srcMac, dstMac, note };
}
function ceCustAPacket(id: string, from: RouterId, to: RouterId, summary: string, srcMac: string, dstMac: string, note: string): PacketVisual {
  return { id, protocol: "IP", from, to, summary, layers: [ethLayerFrom(srcMac, dstMac, note)] };
}

// ---------------------------------------------------------------------------
// Scenario steps
// ---------------------------------------------------------------------------
export const l2vpnEvolutionSteps: ScenarioStep<L2vpnEvolutionState>[] = [
  {
    id: "intro",
    label: "The Central Question",
    narrative: "VPWS, VPLS, BGP-VPLS, H-VPLS, and EVPN can ALL provide some form of Layer-2 service. Why do all five exist? Not because newer automatically replaced older — each one changes exactly one axis of the architecture: service type, discovery/signaling, topology hierarchy, or the Ethernet control-plane model itself. This capstone answers through architecture, never marketing.",
  },
  {
    id: "cust-a-requirement",
    label: "One Customer, Five Architectures",
    narrative: `CUST-A has three sites — CE1, CE2, CE3 — the exact same customer, same MACs and subnet (192.168.100.0/24), used across every architecture in this lesson. Holding the business requirement constant is what lets you compare architecture instead of comparing customers.`,
  },
  {
    id: "why-all-exist-thesis",
    label: "The Answer, Stated Up Front",
    narrative: "VPWS solves point-to-point Layer-2 transport. VPLS solves multipoint Ethernet LAN service. BGP-VPLS changes service discovery/signaling. H-VPLS changes service topology/scaling hierarchy. EVPN changes the Ethernet control-plane model. Every step from here on is evidence for one of those five sentences.",
  },

  // ---------------- VPWS ----------------
  {
    id: "vpws-topology",
    label: "VPWS — Topology",
    narrative: `CE1 ═══════════════ CE2. Service: ${VPWS_SERVICE_NAME}. Point-to-point — exactly one remote endpoint, so no destination-MAC selection is ever required.`,
  },
  {
    id: "vpws-signaling-recap",
    label: "VPWS — Signaling (Recap)",
    narrative: `Signaled by targeted LDP (PWid FEC 128) — already taught in depth in the dedicated VPWS lesson, recapped here only. Service label: the PW label. Signature stack: [TRANSPORT LABEL] over [PW LABEL] over [ETHERNET FRAME].`,
    packet: () => {
      const frame: VpwsEthernetFrame = { srcMac: VPWS_CE1_MAC, dstMac: VPWS_CE2_MAC, note: `${VPWS_CE1_IP} → ${VPWS_CE2_IP}` };
      const withPw = buildVpwsLabelStack(frame, vpwsAllocatePwReceiveLabel("PE2"), vpwsTransportLabelFor("P1"));
      return { id: "vpws-stack", protocol: "MPLS", from: "CE1", to: "CE2", summary: "VPWS two-label stack (recap)", layers: vpwsBuildPacketLayers(withPw) };
    },
    run: (state) => {
      const frame: VpwsEthernetFrame = { srcMac: VPWS_CE1_MAC, dstMac: VPWS_CE2_MAC, note: `${VPWS_CE1_IP} → ${VPWS_CE2_IP}` };
      const withPw = buildVpwsLabelStack(frame, vpwsAllocatePwReceiveLabel("PE2"), vpwsTransportLabelFor("P1"));
      const atPe2 = vpwsProcessCoreTransportLabel(withPw, "IMPLICIT_NULL");
      const pwLabel = vpwsResolveIncomingPwLabel(atPe2);
      const journey: JourneyHop[] = [
        { device: "CE1", input: "Ethernet frame", lookup: "AC ingress", action: "AC_INGRESS", output: "hand to PE1" },
        { device: "PE1", input: "Ethernet frame", lookup: `Resolve remote PW label (PW ID ${VPWS_PW_ID})`, action: "PUSH_PW+TRANSPORT", output: `[transport][pw ${vpwsAllocatePwReceiveLabel("PE2")}][eth]` },
        { device: "PE2", input: `[pw ${pwLabel}][eth]`, lookup: "PW label lookup → AC", action: "POP_PW", output: "deliver Ethernet frame to CE2" },
      ];
      return { state: { ...state, journey }, events: [{ type: "MPLS_LABEL_PUSHED", stepId: "vpws-signaling-recap", timestamp: Date.now(), message: "VPWS two-label stack built (recap)" }] };
    },
  },
  {
    id: "predict-p-router-mac",
    label: "Predict",
    narrative: "Before continuing:",
    question: {
      prompt: "Do P routers (in any of these architectures — VPWS, VPLS, BGP-VPLS, H-VPLS, EVPN) need customer MAC state?",
      options: [
        { id: "no", label: "No — P routers act on the outer transport label only, in every one of these architectures" },
        { id: "yes", label: "Yes, at least in the multipoint architectures (VPLS, BGP-VPLS, H-VPLS, EVPN)" },
        { id: "only-evpn", label: "Only in EVPN, since it distributes MAC reachability via BGP" },
        { id: "only-hvpls", label: "Only in H-VPLS's core mesh tier" },
      ],
      correctOptionId: "no",
      explanation: "This is one of the most important invariants in the whole track: P routers forward on the outer transport label alone in all five architectures. Customer MAC state — whether learned from the data plane or distributed by BGP EVPN — never reaches a P router.",
    },
  },
  {
    id: "vpws-scaling-question",
    label: "What If CE3 Must Join?",
    narrative: "CE3 needs to join the same LAN as CE1 and CE2. A second point-to-point pseudowire does not create one multipoint Ethernet broadcast domain — CE1 and CE3 would need their own separate wire, and CE2/CE3 another, with no shared MAC learning between them. VPWS, by itself, does not scale to this requirement. Transition: VPLS.",
  },

  // ---------------- VPLS ----------------
  {
    id: "vpls-topology",
    label: "VPLS — Topology",
    narrative: "PE1 / PE2 / PE3 — a full mesh of service pseudowires, one per pair, so any two customer sites can reach each other over exactly one PW hop at the service layer.",
  },
  {
    id: "vpls-control-data-split",
    label: "VPLS — Control Plane vs. Data Plane",
    narrative: "CONTROL: targeted LDP, PW signaling — gets the mesh of pseudowires up. DATA: source-MAC learning, FDB, flood, known unicast — this is what actually switches customer frames, and it runs entirely independently of how the PWs were signaled.",
  },
  {
    id: "vpls-first-frame-unknown",
    label: "CE1 → CE2: Destination Unknown, PE1 Floods",
    narrative: "CE1 sends a frame toward CE2's MAC. PE1 has never seen that MAC — unknown unicast — so it floods over every port except the ingress AC: onto both mesh pseudowires. PE2 and PE3 both receive a copy.",
    packet: () => ceCustAPacket("f1", "CE1", "PE1", "Unknown unicast — flooded", CE_MAC.CE1, CE_MAC.CE2, "destination MAC not yet in any FDB"),
    run: (state) => {
      const result = runFrameThroughPe(state.fdb.PE1, "PE1", CE_MAC.CE1, CE_MAC.CE2);
      const journey: JourneyHop[] = [{ device: "PE1", input: "Ethernet frame from CE1", lookup: `Lookup ${CE_MAC.CE2} in FDB — ${result.lookup.kind}`, action: result.decision, output: `Flood to: ${result.egress.map(vplsPortLabel).join(", ") || "(none)"}` }];
      return { state: { ...state, fdb: { ...state.fdb, PE1: result.fdb }, journey, packetAt: "PE2" }, events: [{ type: "MAC_LEARNED", stepId: "vpls-first-frame-unknown", timestamp: Date.now(), message: `PE1 learns CE1 → ${CE_MAC.CE1}` }] };
    },
    whatChanged: () => ["PE1 FDB: learned CE1 on its AC", "Decision: UNKNOWN_UNICAST → flooded to both mesh PWs"],
  },
  {
    id: "vpls-source-learn",
    label: "CE2 Replies — PE1 Learns CE2",
    narrative: "CE2 answers. PE2 learns CE2 on its own AC and forwards the reply across the mesh PW toward PE1. When it arrives, PE1 observes the SOURCE MAC on that pseudowire and learns: CE2 lives behind PE2.",
    packet: () => ceCustAPacket("f2", "CE2", "PE1", "Reply — learned via data plane", CE_MAC.CE2, CE_MAC.CE1, "PE1 observes source MAC on the PW from PE2"),
    run: (state) => {
      const pe2Learn = learnSourceMac(state.fdb.PE2, CE_MAC.CE2, { kind: "AC", peer: "CE2" });
      const pe1Learn = learnSourceMac(state.fdb.PE1, CE_MAC.CE2, { kind: "PW", peer: "PE2" });
      const journey: JourneyHop[] = [...state.journey, { device: "PE1", input: "Reply frame arriving on PW from PE2", lookup: "Source-MAC learning", action: "MAC_LEARNED", output: `CE2 → PW to PE2` }];
      return { state: { ...state, fdb: { ...state.fdb, PE1: pe1Learn.fdb, PE2: pe2Learn.fdb }, journey }, events: [{ type: "MAC_LEARNED", stepId: "vpls-source-learn", timestamp: Date.now(), message: "PE1 learns CE2 behind PE2" }] };
    },
    whatChanged: () => ["PE1 FDB: CE2 → PW to PE2 (learned from the data plane, not from any control-plane advertisement)"],
  },
  {
    id: "vpls-known-unicast",
    label: "Next Frame: Known Unicast, PE2 Only",
    narrative: "CE1 sends CE1→CE2 again. This time PE1's FDB already has CE2 — known unicast, forwarded to PE2 alone. PE3 never sees this frame.",
    packet: () => ceCustAPacket("f3", "CE1", "PE2", "Known unicast — PE2 only", CE_MAC.CE1, CE_MAC.CE2, "destination MAC now known"),
    run: (state) => {
      const result = runFrameThroughPe(state.fdb.PE1, "PE1", CE_MAC.CE1, CE_MAC.CE2);
      const journey: JourneyHop[] = [...state.journey, { device: "PE1", input: "Ethernet frame from CE1", lookup: `Lookup ${CE_MAC.CE2} in FDB — ${result.lookup.kind}`, action: result.decision, output: `Forward to: ${result.egress.map(vplsPortLabel).join(", ") || "(none)"}` }];
      return { state: { ...state, fdb: { ...state.fdb, PE1: result.fdb }, journey }, events: [] };
    },
    whatChanged: () => ["Decision: REMOTE_UNICAST → PE2 only, not flooded"],
  },
  {
    id: "predict-vpws-p2p",
    label: "Predict",
    narrative: "Before continuing:",
    question: {
      prompt: "Which architecture in this track is inherently point-to-point?",
      options: [
        { id: "vpws", label: "VPWS" },
        { id: "vpls", label: "VPLS" },
        { id: "hvpls", label: "H-VPLS" },
        { id: "evpn", label: "EVPN" },
      ],
      correctOptionId: "vpws",
      explanation: "VPWS's service model has exactly one remote endpoint by definition. Every other architecture here is multipoint (VPLS, BGP-VPLS, H-VPLS) or control-plane-multipoint (EVPN) — even EVPN-VPWS, a point-to-point variant, is a different lesson entirely.",
    },
  },
  {
    id: "vpls-scaling-question",
    label: "Must Every PE Mesh With Every Other PE?",
    narrative: `In the classic full-mesh model: yes. With ${calculateFullMeshPwCount(3)} pseudowires for 3 PEs, the relationship count grows as n(n−1)/2 — quadratically. At 10 PEs that's already ${calculateFullMeshPwCount(10)} pseudowires, each independently signaled and maintained.`,
  },

  // ---------------- BGP-VPLS ----------------
  {
    id: "bgp-vpls-intro",
    label: "BGP-Signaled VPLS — Change Only the Signaling",
    narrative: "BGP-VPLS changes exactly one thing: HOW the service is discovered and signaled. It does not touch how customer MAC addresses are learned.",
  },
  {
    id: "bgp-vpls-control-vs-service",
    label: "Control Plane vs. Service Topology",
    narrative: "CONTROL: RR1 at the hub, PE1/PE2/PE3 as spokes — a BGP session topology that carries VPLS NLRI, nothing else. SERVICE: PE1/PE2/PE3 still full-meshed at the data-plane service layer — visually and conceptually distinct from the control-plane star.",
  },
  {
    id: "bgp-vpls-anti-confusion",
    label: "Mandatory Distinction",
    narrative: "BGP-VPLS: BGP carries membership + service-label information. BGP carries individual customer MACs? NO. EVPN: BGP CAN carry customer MAC/IP reachability directly. This is one of the most important distinctions in the whole capstone.",
  },
  {
    id: "predict-bgp-vpls-mac",
    label: "Predict",
    narrative: "Before continuing:",
    question: {
      prompt: "Does BGP-signaled VPLS advertise individual customer MAC reachability, the way EVPN Type 2 does?",
      options: [
        { id: "no", label: "No — BGP-VPLS's NLRI carries membership and label-block information only" },
        { id: "yes", label: "Yes — that's what the VPLS NLRI's next-hop field is for" },
        { id: "only-known", label: "Only for MACs already known at the RR" },
        { id: "only-af", label: "Only if the L2VPN AFI/SAFI is combined with the EVPN AFI/SAFI" },
      ],
      correctOptionId: "no",
      explanation: "The RFC 4761 VPLS NLRI carries an RD, VE ID, and label block — enough to auto-discover membership and derive a per-pair PW label. It was never designed to, and does not, carry a customer MAC address. That is exactly the property EVPN changes.",
    },
  },
  {
    id: "bgp-vpls-label-block-recap",
    label: "Label-Block Recap",
    narrative: "Enough to remember, not the full derivation: Label = Label Base + VE-ID − VE Block Offset. BGP signaling changed; Ethernet MAC learning did not.",
    run: (state) => ({ state, events: [{ type: "BGP_ROUTE_INSTALLED", stepId: "bgp-vpls-label-block-recap", timestamp: Date.now(), message: "CUST-A VPLS NLRI installed for PE1/PE2/PE3" }] }),
  },
  {
    id: "predict-hvpls-bgpvpls-orthogonal",
    label: "Predict",
    narrative: "Before continuing:",
    question: {
      prompt: "Are H-VPLS and BGP-VPLS mutually exclusive ideas?",
      options: [
        { id: "no", label: "No — one describes topology hierarchy, the other describes discovery/signaling; they're orthogonal and combinable" },
        { id: "yes", label: "Yes — a network must choose exactly one" },
        { id: "only-core", label: "They can combine only if the core tier uses LDP, never BGP" },
        { id: "only-access", label: "They can combine only at the access tier" },
      ],
      correctOptionId: "no",
      explanation: "H-VPLS's spoke/core split and BGP-VPLS's BGP-based discovery answer completely different questions. A real network can run a BGP-signaled core mesh with hierarchical spokes at the same time — the two ideas don't compete.",
    },
  },

  // ---------------- BGP-VPLS mental-model troubleshooting incident ----------------
  {
    id: "incident-setup",
    label: "Incident: CE1 → CE3, First Frame",
    narrative: "An engineer expects BGP-VPLS to advertise individual customer MAC addresses. PE1 does not yet know CE3's MAC. The engineer treats this as a missing BGP route. Investigate before repairing anything.",
    run: (state) => ({ state: { ...state, incident: { ...state.incident, ce3Sent: false } }, events: [] }),
  },
  {
    id: "incident-symptoms",
    label: "Symptoms",
    narrative: "PE1 sees PE3's VPLS NLRI. PE1 has a valid derived service label toward PE3. The VPLS mesh is healthy. The customer FDB entry for CE3 is absent at PE1. The first CE1→CE3 frame will flood. The network is behaving correctly — this is a mental-model troubleshooting incident, not a fault.",
  },
  {
    id: "incident-diagnostic-ladder",
    label: "Diagnostic Ladder",
    narrative: "Work bottom-up before touching anything.",
  },
  {
    id: "trouble-question-mental-model",
    label: "Diagnose",
    narrative: "Before choosing a repair:",
    question: {
      prompt: "BGP session ✓, VPLS AF ✓, RT import ✓, PE3 membership ✓, label-block coverage ✓, service label ✓, service adjacency ✓ — but PE1 has no FDB entry for CE3's MAC. What is actually wrong?",
      options: [
        { id: "nothing", label: "Nothing is wrong — CE3 simply hasn't sent traffic yet, so PE1 has never had a chance to learn its MAC from the data plane" },
        { id: "missing-route", label: "A BGP MAC route for CE3 is missing" },
        { id: "rt-mismatch", label: "PE3's Route Target doesn't match" },
        { id: "label-block", label: "PE3's label block doesn't cover its own VE ID" },
      ],
      correctOptionId: "nothing",
      hints: ["Every control-plane layer above the FDB is already checked and healthy.", "BGP-VPLS's NLRI was never designed to carry a customer MAC address in the first place — so there's no missing route to find."],
      explanation: "Every layer from the BGP session down to the service label is healthy — there is nothing to repair in the control plane. BGP-VPLS's MAC reachability model is data-plane learning; PE1 will learn CE3's MAC the moment CE3 actually sends a frame, exactly like the very first VPLS flood/learn sequence you just ran.",
    },
  },
  {
    id: "repair-challenge",
    label: "Engineer Challenge: Resolve The Incident",
    narrative: "Choose how to proceed.",
    action: (state, payload) => {
      const choice = (payload as { choice?: string } | undefined)?.choice ?? "";
      if (choice !== "observe-traffic") {
        return { state: { ...state, incident: { ...state.incident, repairAttempt: { choice, correct: false } } }, events: [] };
      }
      const pe3Learn = learnSourceMac(state.fdb.PE3, CE_MAC.CE3, { kind: "AC", peer: "CE3" });
      const pe1Learn = learnSourceMac(state.fdb.PE1, CE_MAC.CE3, { kind: "PW", peer: "PE3" });
      return {
        state: { ...state, fdb: { ...state.fdb, PE1: pe1Learn.fdb, PE3: pe3Learn.fdb }, incident: { ...state.incident, ce3Sent: true, repairAttempt: { choice, correct: true }, resolved: true } },
        events: [{ type: "MAC_LEARNED", stepId: "repair-challenge", timestamp: Date.now(), message: "PE1 learns CE3 behind PE3 from real customer traffic" }],
      };
    },
    requiresState: (state) => state.incident.resolved === true,
  },
  {
    id: "verify-dataplane",
    label: "Verify: Known Unicast To CE3",
    narrative: "Send CE1→CE3 again and confirm it is now forwarded directly to PE3, not flooded.",
    packet: () => ceCustAPacket("f4", "CE1", "PE3", "Known unicast — PE3 only", CE_MAC.CE1, CE_MAC.CE3, "destination MAC now known"),
    run: (state) => {
      const result = runFrameThroughPe(state.fdb.PE1, "PE1", CE_MAC.CE1, CE_MAC.CE3);
      const journey: JourneyHop[] = [...state.journey, { device: "PE1", input: "Ethernet frame from CE1", lookup: `Lookup ${CE_MAC.CE3} in FDB — ${result.lookup.kind}`, action: result.decision, output: `Forward to: ${result.egress.map(vplsPortLabel).join(", ") || "(none)"}` }];
      return { state: { ...state, fdb: { ...state.fdb, PE1: result.fdb }, journey, incident: { ...state.incident, verified: result.decision !== "UNKNOWN_UNICAST" } }, events: [] };
    },
    whatChanged: (prev, next) => [next.incident.verified ? "Verified: CE1 → CE3 is now REMOTE_UNICAST, forwarded to PE3 only" : "Still flooding — re-check the previous step"],
  },
  {
    id: "incident-evpn-equivalent",
    label: "The EVPN Equivalent",
    narrative: "EVPN: CE3's MAC may be learned locally by PE3 → a Type 2 route is advertised → PE1 receives control-plane reachability, potentially before CE3 ever sends a frame toward CE1. This is why the same symptom (\"PE1 doesn't know CE3 yet\") means something architecturally different under EVPN — it would usually indicate an actual missing/rejected route, not an unlearned data-plane entry.",
  },

  // ---------------- H-VPLS ----------------
  {
    id: "hvpls-transition-question",
    label: "What If The Access Tier Itself Becomes Too Large?",
    narrative: "Dozens of access sites would each need to join the same full core mesh under flat VPLS — the n(n−1)/2 cost returns, now at the access tier. H-VPLS's answer: split the tiers.",
  },
  {
    id: "hvpls-topology",
    label: "H-VPLS — Topology",
    narrative: `MTU1 ─SPOKE─ PE1 ═MESH═ PE2 ─SPOKE─ MTU2, with PE1 ═ PE2 ═ PE3 forming the (smaller) core mesh only. Service: ${HVPLS_SERVICE_NAME}.`,
  },
  {
    id: "hvpls-architectural-lesson",
    label: "What H-VPLS Actually Changes",
    narrative: "H-VPLS changes topology — not Ethernet MAC-learning architecture. It still uses traditional bridging, data-plane MAC learning, and pseudowires, at both tiers.",
  },
  {
    id: "predict-hvpls-mac-learning",
    label: "Predict",
    narrative: "Before continuing:",
    question: {
      prompt: "Does H-VPLS replace data-plane MAC learning with BGP MAC advertisements?",
      options: [
        { id: "no", label: "No — H-VPLS restructures the PW topology into spokes + core; MAC learning stays data-plane, at both tiers" },
        { id: "yes", label: "Yes — the PE-rs core tier requires BGP MAC distribution" },
        { id: "only-spoke", label: "Only at the spoke (MTU-s) tier" },
        { id: "only-core", label: "Only at the core (PE-rs) tier" },
      ],
      correctOptionId: "no",
      explanation: "H-VPLS is purely a topology/scaling change. Every MTU-s and PE-rs node still learns customer MACs from the data plane exactly like flat VPLS — nothing about MAC learning changes when the mesh is split into tiers.",
    },
  },
  {
    id: "hvpls-split-horizon",
    label: "Split-Horizon Refinement",
    narrative: "SPOKE → MESH ✓. MESH → SPOKE ✓. MESH → MESH ✕. This is a genuine refinement over flat VPLS's simpler \"mesh PW → another mesh PW ✕\" rule — spoke traffic may now freely cross onto the mesh and back.",
    run: (state) => ({ state, events: [] }),
  },
  {
    id: "hvpls-scaling-comparison",
    label: "Scaling Comparison",
    narrative: `At 10 access sites behind a 3-PE core: flat full mesh needs ${calculateFullMeshPwCount(10)} pseudowires; H-VPLS needs ${calculateHierarchicalPwCount(3, 10)} — the core mesh stays small regardless of how many access sites join.`,
  },

  // ---------------- EVPN ----------------
  {
    id: "evpn-transition-question",
    label: "What If Ethernet Reachability Itself Should Live In The Control Plane?",
    narrative: "Every architecture so far still learns customer MACs by watching data-plane traffic. What if the provider wants Ethernet endpoint reachability itself distributed through BGP, the way an IP prefix already is in L3VPN?",
  },
  {
    id: "evpn-mental-model",
    label: "EVPN Mental Model",
    narrative: "Customer MAC learned locally → BGP EVPN advertisement → remote PE learns reachability → remote forwarding state. Unlike traditional VPLS, the remote PE does not always need to wait to observe data-plane source traffic before learning the MAC's location. EVPN does NOT universally eliminate flooding — it changes how MAC location is learned, not whether BUM traffic can occur.",
  },
  {
    id: "predict-evpn-fundamental-change",
    label: "Predict",
    narrative: "Before continuing:",
    question: {
      prompt: "What changes most fundamentally when moving from traditional VPLS to EVPN?",
      options: [
        { id: "control-plane", label: "Ethernet reachability moves into a BGP-based control-plane model" },
        { id: "transport", label: "The MPLS transport mechanism is replaced" },
        { id: "flooding", label: "Flooding is eliminated entirely" },
        { id: "topology", label: "The physical topology must become flat again" },
      ],
      correctOptionId: "control-plane",
      explanation: "EVPN's defining change is architectural: MAC/IP reachability becomes a BGP-distributed control-plane property instead of something only ever inferred from data-plane traffic. Transport, topology, and flooding are all separate axes that EVPN does not uniformly change.",
    },
  },
  {
    id: "evpn-type2-recap",
    label: "EVPN Type 2 Recap",
    narrative: "MAC/IP Advertisement route: MAC, optional IP, Ethernet Tag, ESI where relevant, MPLS/VNI service information. Already fully built in the dedicated EVPN lessons — recapped, not re-derived, here.",
  },
  {
    id: "evpn-ce3-install",
    label: "CE3 Appears At PE3 — Type 2 Advertised",
    narrative: "CE3 sends a frame. PE3 learns CE3 locally and advertises a Type 2 route. PE1 receives it and installs CE3's reachability — before CE1 has ever sent a frame toward CE3.",
    run: (state) => {
      const route = advertiseType2("PE3", CE_MAC.CE3, "192.168.100.3");
      return { state: { ...state, type2Routes: [...state.type2Routes.filter((r) => r.mac !== route.mac), route] }, events: [{ type: "BGP_ROUTE_INSTALLED", stepId: "evpn-ce3-install", timestamp: Date.now(), message: "PE1 installs CE3 reachability from EVPN Type 2" }] };
    },
    whatChanged: () => ["PE1 installs CE3 → PE3 reachability via BGP EVPN Type 2 — no CE3 traffic toward CE1 required first"],
  },
  {
    id: "evpn-vs-traditional-signature",
    label: "Signature Comparison",
    narrative: "TRADITIONAL VPLS: CE2 sends frame → PE2 learns CE2 → frame crosses PW → PE1 observes source CE2 → PE1 learns CE2. EVPN: CE2 appears at PE2 → PE2 learns CE2 → BGP EVPN Type 2 → PE1 installs CE2 reachability. The mechanism that gets PE1 the answer is what changed.",
  },
  {
    id: "evpn-bum-comparison",
    label: "BUM Comparison",
    narrative: "Traditional VPLS: BUM replication over the PW service topology. EVPN: Type 3/IMET establishes BUM replication-list membership; the actual replication still happens via ingress replication or underlay multicast, depending on transport.",
  },
  {
    id: "predict-evpn-eliminates-bum",
    label: "Predict",
    narrative: "Before continuing:",
    question: {
      prompt: "Does EVPN universally eliminate BUM traffic?",
      options: [
        { id: "no", label: "No — Type 3/IMET manages replication membership, but BUM traffic itself can still occur" },
        { id: "yes", label: "Yes — every frame becomes known unicast under EVPN" },
        { id: "only-arp", label: "Only ARP/broadcast traffic is eliminated" },
        { id: "only-mpls", label: "Only when the underlay is MPLS, not VXLAN" },
      ],
      correctOptionId: "no",
      explanation: "EVPN changes how BUM membership is established and (with ARP/ND suppression) can reduce some specific broadcast traffic, but it does not universally eliminate flooding. Unknown destinations, and genuine broadcast/multicast traffic, still require BUM handling.",
    },
  },
  {
    id: "evpn-unknown-unicast-comparison",
    label: "Unknown Unicast Comparison",
    narrative: "Traditional VPLS: unknown MAC → flood, always. EVPN: if remote MAC reachability already exists via Type 2, destination known → direct forwarding. But unknown destinations can still require architecture-dependent BUM handling — EVPN does not mean zero flooding.",
  },
  {
    id: "evpn-mac-mobility-comparison",
    label: "MAC Mobility Comparison",
    narrative: "Traditional VPLS: a new source frame observed on a new PW triggers an FDB relearn/update — no ordering guarantee beyond \"most recent wins.\" EVPN: a Type 2 reachability update carries an explicit MAC Mobility sequence number, so every receiver can determine which advertisement is actually newer, even out of arrival order.",
    run: (state) => {
      const { before, after, selected } = mobilityComparisonDemo();
      void before;
      void after;
      return { state, events: [{ type: "BGP_ROUTE_INSTALLED", stepId: "evpn-mac-mobility-comparison", timestamp: Date.now(), message: `Mobility comparison: sequence ${selected.mobilitySeq} wins (reusing the EVPN MAC Mobility lesson's own comparator)` }] };
    },
  },
  {
    id: "evpn-multihoming-comparison",
    label: "Multihoming Comparison",
    narrative: "Traditional VPLS: multihoming varies by design/vendor, and is not the primary native model taught in the traditional lessons. EVPN: Ethernet Segment, ESI, DF election, aliasing, mass withdrawal, all-active/single-active — a native, standardized model.",
    run: (state) => {
      const { dfState } = multihomingComparisonDemo();
      return { state, events: [{ type: "BGP_ROUTE_INSTALLED", stepId: "evpn-multihoming-comparison", timestamp: Date.now(), message: `CE-DUAL: DF elected — ${dfState.reason}` }] };
    },
  },
  {
    id: "evpn-failure-convergence",
    label: "Failure Convergence Comparison",
    narrative: "Traditional VPLS: data-plane learned MAC state + PW/service state, plus optional MAC-withdrawal mechanisms. EVPN: control-plane Ethernet reachability + Ethernet Segment signaling + mass-withdrawal mechanisms — a faster, more explicit signal on PE failure.",
  },
  {
    id: "service-label-comparison",
    label: "Service-Label Comparison",
    narrative: "VPWS: PW label. VPLS: PW/service label. BGP-VPLS: BGP-derived service demultiplexor (same label math, discovered by BGP). EVPN/MPLS: EVPN service label. The outer transport label remains conceptually separate from all four.",
  },
  {
    id: "predict-transport-independence",
    label: "Predict",
    narrative: "Before continuing:",
    question: {
      prompt: "Can the MPLS transport architecture remain separate from the Ethernet service control plane?",
      options: [
        { id: "yes", label: "Yes — LDP, RSVP-TE, or SR-MPLS can all provide transport underneath any of these five service architectures" },
        { id: "no", label: "No — each service architecture requires its own matching transport protocol" },
        { id: "only-evpn", label: "Only EVPN can decouple transport this way" },
        { id: "only-ldp", label: "Only when transport is LDP" },
      ],
      correctOptionId: "yes",
      explanation: "Service signaling architecture and transport architecture are independent axes. VPWS, VPLS, BGP-VPLS, H-VPLS, and EVPN all describe how the SERVICE is signaled and how reachability is learned — none of them mandate a specific transport mechanism underneath.",
    },
  },

  // ---------------- Comparison views ----------------
  {
    id: "architecture-comparison-table",
    label: "Architecture Comparison",
    narrative: "Every property from this lesson, side by side.",
  },
  {
    id: "state-ownership-table",
    label: "State Ownership",
    narrative: "Who knows what, factually — never a P router, never a route reflector doing customer switching.",
  },
  {
    id: "conceptual-timeline",
    label: "PacketVerse Concept Progression",
    narrative: "VPWS → (multipoint requirement) → VPLS → (signaling/discovery scaling) → BGP-VPLS → (access hierarchy scaling) → H-VPLS → (richer Ethernet control plane) → EVPN. This is a teaching progression, not a claim that every production network historically migrated through exactly these stages.",
  },

  // ---------------- Decision lab ----------------
  {
    id: "decision-lab-a",
    label: "Decision Lab A",
    narrative: "Two sites only. Transparent Ethernet. No multipoint requirement.",
    question: {
      prompt: "Which architecture fits Requirement A?",
      options: ARCHITECTURES.map((a) => ({ id: a, label: ARCHITECTURE_LABEL[a] })),
      correctOptionId: "VPWS",
      explanation: "Exactly two sites, no multipoint need — VPWS's point-to-point service matches this requirement directly; anything multipoint is unnecessary machinery here.",
    },
  },
  {
    id: "decision-lab-b",
    label: "Decision Lab B",
    narrative: "Three-site Ethernet LAN. Small, stable network. Data-plane MAC learning acceptable.",
    question: {
      prompt: "Which architecture fits Requirement B?",
      options: ARCHITECTURES.map((a) => ({ id: a, label: ARCHITECTURE_LABEL[a] })),
      correctOptionId: "VPLS",
      explanation: "Multipoint, small and stable, data-plane learning acceptable — traditional VPLS satisfies exactly this and nothing more elaborate is required.",
    },
  },
  {
    id: "decision-lab-c",
    label: "Decision Lab C",
    narrative: "Large access aggregation. Wants fewer full-mesh access relationships. Traditional bridging acceptable.",
    question: {
      prompt: "Which architecture fits Requirement C?",
      options: ARCHITECTURES.map((a) => ({ id: a, label: ARCHITECTURE_LABEL[a] })),
      correctOptionId: "H_VPLS",
      explanation: "The specific pain point — too many full-mesh access relationships — is exactly the topology/hierarchy problem H-VPLS's spoke/core split solves, while still allowing traditional data-plane bridging.",
    },
  },
  {
    id: "decision-lab-d",
    label: "Decision Lab D",
    narrative: "Wants BGP-based VPLS member discovery/signaling but wants to retain classic VPLS MAC learning.",
    question: {
      prompt: "Which architecture fits Requirement D?",
      options: ARCHITECTURES.map((a) => ({ id: a, label: ARCHITECTURE_LABEL[a] })),
      correctOptionId: "BGP_VPLS",
      explanation: "This requirement names its own answer: BGP for discovery/signaling, classic VPLS MAC learning retained — precisely BGP-VPLS's value proposition, nothing more.",
    },
  },
  {
    id: "decision-lab-e",
    label: "Decision Lab E",
    narrative: "Wants control-plane MAC/IP distribution and native modern Ethernet multihoming semantics.",
    question: {
      prompt: "Which architecture fits Requirement E?",
      options: ARCHITECTURES.map((a) => ({ id: a, label: ARCHITECTURE_LABEL[a] })),
      correctOptionId: "EVPN",
      explanation: "Control-plane MAC/IP distribution and native ESI/DF-based multihoming are properties only EVPN provides among these five — this is a property match, not a blanket recommendation.",
    },
  },

  // ---------------- Engineer Challenge ----------------
  {
    id: "engineer-challenge",
    label: "Engineer Challenge: Choose The Service Architecture",
    narrative: "8 sites. Ethernet multipoint. Dual-homed critical servers. Needs fast MAC-mobility signaling. Wants control-plane endpoint reachability. MPLS core already exists. Inspect: service type, scale, endpoint-learning model, multihoming, mobility, BUM, failure convergence, signaling — then choose.",
    question: {
      prompt: "Given ALL of these requirements together — multipoint, dual-homed critical servers, fast MAC mobility, control-plane endpoint reachability — which architecture satisfies every one of them?",
      options: ARCHITECTURES.map((a) => ({ id: a, label: ARCHITECTURE_LABEL[a] })),
      correctOptionId: "EVPN",
      explanation: "VPWS fails immediately (not multipoint). VPLS/BGP-VPLS/H-VPLS all satisfy multipoint but have no native multihoming model and no sequence-numbered mobility signaling. EVPN is the only architecture among these five that satisfies dual-homed multihoming (ESI/DF) AND fast, sequence-numbered mobility AND control-plane endpoint reachability simultaneously — scored against the stated requirements, not a blanket \"EVPN is best\" claim.",
    },
  },
  {
    id: "complete",
    label: "Complete",
    narrative: "BGP-VPLS changes how the VPLS is discovered and signaled; H-VPLS changes how the VPLS is structured; EVPN changes how Ethernet reachability itself is distributed. You've traced one customer, CUST-A, through all five architectures — same requirement, five different answers to how the network delivers it.",
  },
];

function stepIdx(id: string): number {
  return l2vpnEvolutionSteps.findIndex((s) => s.id === id);
}
export const STEP_IDX = {
  intro: stepIdx("intro"),
  vpwsTopology: stepIdx("vpws-topology"),
  vplsTopology: stepIdx("vpls-topology"),
  bgpVplsIntro: stepIdx("bgp-vpls-intro"),
  incidentSetup: stepIdx("incident-setup"),
  hvplsTopology: stepIdx("hvpls-topology"),
  evpnTransitionQuestion: stepIdx("evpn-transition-question"),
  architectureComparisonTable: stepIdx("architecture-comparison-table"),
  decisionLabA: stepIdx("decision-lab-a"),
  engineerChallenge: stepIdx("engineer-challenge"),
  complete: stepIdx("complete"),
};

export const L2VPN_EVOLUTION_XP_AWARD = 800;

export { CE_MAC, CE_IP, BROADCAST_MAC, VPLS_SERVICE_NAME, VPWS_SERVICE_NAME, HVPLS_SERVICE_NAME, pwPeersOf };
