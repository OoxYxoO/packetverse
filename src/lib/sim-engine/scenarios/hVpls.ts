import type { PacketVisual, ScenarioStep } from "../types";
import {
  type EthernetFrame,
  type MplsPacketState,
  type LabelBindingValue,
  buildVplsLabelStack,
  processCoreTransportLabel,
  resolveIncomingPwLabel,
  deliverEthernetFrame,
  ethLayer,
  buildPacketLayers,
  BROADCAST_MAC,
  type FdbPort as GenericFdbPort,
  type Fdb as GenericFdb,
  type LearnChange,
  learnSourceMac,
  ageMacEntry,
  type DestinationLookup as GenericDestinationLookup,
  lookupDestinationMac,
  computeVplsEgressSet,
  portsEqual,
  type ForwardingDecision,
  type TransportState,
  transportReachable,
  PW_PAIRS,
  type PwPairId,
  pwPairFor,
  pwPeersOf,
  activePwPeers,
  pwUpBetween,
  allocatePwReceiveLabel,
  PE_INDEX,
  type PwLinkState,
} from "./mplsVpls";

/**
 * Hierarchical VPLS (H-VPLS) — RFC 4762, especially §10. MTU-s access
 * bridges, spoke pseudowires, a PE-rs core full mesh, and the
 * role-aware split-horizon rule that lets a spoke PW forward onto the
 * core mesh (and vice versa) without reopening the loop the flat-VPLS
 * lesson's mesh-only split horizon exists to prevent.
 *
 * Builds directly on mplsVpls.ts: the core PE-rs mesh in H-VPLS is
 * STRUCTURALLY IDENTICAL to flat VPLS's full mesh (RFC 4762's PE-rs
 * tier behaves like classic VPLS), so this file reuses mplsVpls.ts's
 * mesh-PW primitives verbatim (PW_PAIRS, PwLinkState, pwUpBetween,
 * activePwPeers, allocatePwReceiveLabel, PE_INDEX) rather than
 * re-deriving a second full-mesh implementation. MAC learning,
 * destination lookup, FDB aging, and eligible-egress-set computation
 * are ALSO reused verbatim via mplsVpls.ts's generic FdbPort<K>/Fdb<K>
 * machinery (see that file's own comments), parameterized here over a
 * THREE-role port-kind union ("AC" | "SPOKE_PW" | "MESH_PW") instead
 * of flat VPLS's two ("AC" | "PW").
 *
 * The one piece that is genuinely NEW, not reused: the split-horizon
 * POLICY itself. Flat VPLS's applySplitHorizon blocks every PW-ingress
 * frame from leaving on any other PW — correct there, because flat
 * VPLS has exactly one non-AC port kind. H-VPLS has two, and the rule
 * is role-aware: a spoke PW behaves like an access-side bridging port
 * (AC ↔ SPOKE_PW ↔ MESH_PW all freely allowed), and ONLY mesh-to-mesh
 * is forbidden. This file never uses, and never generalizes to, "PW
 * ingress can never leave another PW" — see applyHierarchicalSplitHorizon
 * below and its accompanying invariant tests.
 *
 * Central question: must every access device that wants to join a
 * VPLS service become another full-mesh core PE? No — H-VPLS answers
 * with hierarchy: MTU-s access bridges attach to the service through
 * ONE spoke pseudowire to a PE-rs hub, and only the PE-rs tier
 * maintains the (much smaller) core full mesh.
 *
 *   CE1 ─┐
 *        ├─ MTU1 ══ spoke ══ PE1
 *   CE2 ─┘                    ║ \
 *                             ║  \
 *                          mesh   mesh
 *                             ║     \
 *   CE3 ─── MTU2 ══spoke══ PE2 ════ PE3 ══spoke══ MTU3 ─── CE4
 *
 * Explicitly deferred (per brief): EVPN and EVPN multihoming,
 * BGP-signaled H-VPLS, inter-provider/multi-domain VPLS, Ethernet
 * access-ring H-VPLS, PBB, VPLS redundancy/dual-homing, ESI/DF
 * election. Named only as future/advanced material where the brief
 * calls for a comparison. Underlying P routers are also deliberately
 * omitted — transport is modeled as the same shared TransportState
 * recap already used by every prior MPLS lesson (a documented
 * simplification, not a claim that H-VPLS needs no P routers): the
 * pedagogical point of this lesson is the spoke/mesh port-role
 * distinction, not re-teaching hop-by-hop LDP transport, which the
 * VPWS and flat-VPLS lessons already covered in full.
 *
 * Pure data + pure functions only — see /lib/sim-engine/types.ts.
 */

// ---------------------------------------------------------------------------
// Topology
// ---------------------------------------------------------------------------
export type CeId = "CE1" | "CE2" | "CE3" | "CE4";
export type MtuId = "MTU1" | "MTU2" | "MTU3";
export type PeId = "PE1" | "PE2" | "PE3";
export type RouterId = CeId | MtuId | PeId;
export const CE_ROUTERS: CeId[] = ["CE1", "CE2", "CE3", "CE4"];
export const MTU_NODES: MtuId[] = ["MTU1", "MTU2", "MTU3"];
export const PE_ROUTERS: PeId[] = ["PE1", "PE2", "PE3"];
export const ALL_DEVICES: RouterId[] = ["CE1", "CE2", "MTU1", "PE1", "CE3", "MTU2", "PE2", "PE3", "MTU3", "CE4"];

export const ROUTER_LOOPBACK: Partial<Record<RouterId, string>> = { PE1: "1.1.1.1", PE2: "2.2.2.2", PE3: "3.3.3.3", MTU1: "10.0.0.1", MTU2: "10.0.0.2", MTU3: "10.0.0.3" };

export type LinkId = "CE1-MTU1" | "CE2-MTU1" | "MTU1-PE1" | "CE3-MTU2" | "MTU2-PE2" | "PE1-PE2" | "PE1-PE3" | "PE2-PE3" | "PE3-MTU3" | "MTU3-CE4";
export interface LinkDef {
  id: LinkId;
  a: RouterId;
  b: RouterId;
  tier: "access" | "spoke" | "mesh";
}
export const LINKS: LinkDef[] = [
  { id: "CE1-MTU1", a: "CE1", b: "MTU1", tier: "access" },
  { id: "CE2-MTU1", a: "CE2", b: "MTU1", tier: "access" },
  { id: "MTU1-PE1", a: "MTU1", b: "PE1", tier: "spoke" },
  { id: "CE3-MTU2", a: "CE3", b: "MTU2", tier: "access" },
  { id: "MTU2-PE2", a: "MTU2", b: "PE2", tier: "spoke" },
  { id: "PE1-PE2", a: "PE1", b: "PE2", tier: "mesh" },
  { id: "PE1-PE3", a: "PE1", b: "PE3", tier: "mesh" },
  { id: "PE2-PE3", a: "PE2", b: "PE3", tier: "mesh" },
  { id: "PE3-MTU3", a: "PE3", b: "MTU3", tier: "spoke" },
  { id: "MTU3-CE4", a: "MTU3", b: "CE4", tier: "access" },
];

export const CE_IP: Record<CeId, string> = { CE1: "192.168.100.1/24", CE2: "192.168.100.2/24", CE3: "192.168.100.3/24", CE4: "192.168.100.4/24" };
export const CE_MAC: Record<CeId, string> = { CE1: "00:11:11:11:11:11", CE2: "00:22:22:22:22:22", CE3: "00:33:33:33:33:33", CE4: "00:44:44:44:44:44" };
export const SERVICE_NAME = "CUST-A-HVPLS";
export const VLAN = 100;
export const HVPLS_XP_AWARD = 700;

export const TERMS: { term: string; expansion: string; meaning: string }[] = [
  { term: "MTU-s", expansion: "Bridging-capable access device", meaning: "RFC 4762's access-tier node — attaches customer sites via ACs and reaches the service through exactly one spoke pseudowire. Never joins the core full mesh." },
  { term: "PE-rs", expansion: "Routing + bridging capable core PE", meaning: "The core hub tier — full-meshed with other PE-rs nodes via core (mesh) pseudowires, and terminates one or more spoke pseudowires from access MTU-s nodes." },
  { term: "Spoke PW", expansion: "Access-tier pseudowire", meaning: "The single pseudowire connecting an MTU-s to its PE-rs hub. Behaves like an access-side bridging port at the PE-rs — never subject to mesh split horizon." },
  { term: "Mesh PW", expansion: "Core pseudowire", meaning: "A pseudowire between two PE-rs core hubs — structurally identical to a flat-VPLS mesh PW, and still subject to the mesh-only split-horizon rule." },
];

// ---------------------------------------------------------------------------
// Attachment circuits — CE-to-MTU, distinct from mplsVpls.ts's
// AttachmentCircuit (which attaches a CE directly to a PE) because
// H-VPLS's access tier genuinely sits one hop further out.
// ---------------------------------------------------------------------------
export interface AttachmentCircuit {
  mtu: MtuId;
  ceRouter: CeId;
  interfaceName: string;
  vlan: number;
  up: boolean;
}
export function resolveAttachmentCircuits(acs: AttachmentCircuit[], mtu: MtuId): AttachmentCircuit[] {
  return acs.filter((a) => a.mtu === mtu);
}

// ---------------------------------------------------------------------------
// Core mesh (PE-rs tier) — reused verbatim from mplsVpls.ts's flat-VPLS
// full-mesh primitives. This is the file's central architectural claim,
// made literal: the H-VPLS core tier IS classic VPLS.
// ---------------------------------------------------------------------------
export { PW_PAIRS, type PwPairId, pwPairFor, pwPeersOf, activePwPeers, pwUpBetween, allocatePwReceiveLabel, PE_INDEX, type PwLinkState, type TransportState, transportReachable };

// ---------------------------------------------------------------------------
// Spoke pseudowires (MTU-s ↔ PE-rs) — structurally point-to-point, like
// VPWS, but modeled locally since mplsVpls.ts's PW-pair machinery is
// specific to the core (PE-rs-to-PE-rs) mesh shape.
// ---------------------------------------------------------------------------
export type SpokePairId = "MTU1-PE1" | "MTU2-PE2" | "MTU3-PE3";
export const SPOKE_PAIRS: { id: SpokePairId; mtu: MtuId; pe: PeId }[] = [
  { id: "MTU1-PE1", mtu: "MTU1", pe: "PE1" },
  { id: "MTU2-PE2", mtu: "MTU2", pe: "PE2" },
  { id: "MTU3-PE3", mtu: "MTU3", pe: "PE3" },
];
export interface SpokeLinkState {
  id: SpokePairId;
  up: boolean;
}
export function spokePairFor(mtu: MtuId): { id: SpokePairId; mtu: MtuId; pe: PeId } {
  return SPOKE_PAIRS.find((p) => p.mtu === mtu)!;
}
export function peSpokePair(pe: PeId): { id: SpokePairId; mtu: MtuId; pe: PeId } {
  return SPOKE_PAIRS.find((p) => p.pe === pe)!;
}
export function spokeUp(spokeLinks: SpokeLinkState[], mtu: MtuId): boolean {
  const pair = spokePairFor(mtu);
  return !!spokeLinks.find((l) => l.id === pair.id)?.up;
}
const MTU_INDEX: Record<MtuId, number> = { MTU1: 1, MTU2: 2, MTU3: 3 };
/** A real function of (self, remote) — the spoke's own directional receive label, never a hand-picked constant. Mirrors allocatePwReceiveLabel's formula style from mplsVpls.ts. */
export function allocateSpokeReceiveLabel(self: RouterId, remote: RouterId): number {
  const base = self.startsWith("PE") ? 34000 : 44000;
  const selfIdx = self.startsWith("PE") ? PE_INDEX[self as PeId] : MTU_INDEX[self as MtuId];
  const remoteIdx = remote.startsWith("PE") ? PE_INDEX[remote as PeId] : MTU_INDEX[remote as MtuId];
  return base + selfIdx * 10 + remoteIdx;
}
/** Simple deterministic per-leg transport label — see the file header's note on why literal P routers are out of scope here. */
export function transportLabelToward(neighbor: RouterId): LabelBindingValue {
  if (neighbor.startsWith("PE")) return 900 + PE_INDEX[neighbor as PeId];
  return 800 + MTU_INDEX[neighbor as MtuId];
}

// ---------------------------------------------------------------------------
// Bridge port roles — RFC 4762's three semantic port kinds. Never
// collapsed back down to a generic "PW" the way flat VPLS's FdbPort
// is — see the file header and applyHierarchicalSplitHorizon below for
// why that distinction is the entire point of this lesson.
// ---------------------------------------------------------------------------
export type VplsPortRole = "AC" | "SPOKE_PW" | "MESH_PW";
export type HvplsPort = GenericFdbPort<VplsPortRole>;
export type Fdb = GenericFdb<VplsPortRole>;
export type DestinationLookup = GenericDestinationLookup<VplsPortRole>;

export function portLabel(port: HvplsPort): string {
  return `${port.kind}: ${port.peer}`;
}

/** MTU-s bridge ports: one AC per attached CE, plus its single spoke port (when up) toward its PE-rs hub. */
export function mtuBridgePortsFor(mtu: MtuId, acs: AttachmentCircuit[], spokeLinks: SpokeLinkState[]): HvplsPort[] {
  const ports: HvplsPort[] = resolveAttachmentCircuits(acs, mtu)
    .filter((a) => a.up)
    .map((a) => ({ kind: "AC" as const, peer: a.ceRouter }));
  if (spokeUp(spokeLinks, mtu)) ports.push({ kind: "SPOKE_PW", peer: spokePairFor(mtu).pe });
  return ports;
}
/**
 * PE-rs bridge ports: its one spoke port toward the attached MTU-s,
 * plus a mesh port toward every other core-mesh member whose PW is up.
 * `spokeRole` is normally "SPOKE_PW" — it is the PE-rs's own CLASSIFICATION
 * of that port, not the pseudowire's up/down state, which is exactly
 * what the troubleshooting incident corrupts (a healthy spoke PW
 * misclassified as a mesh PW) without touching spokeLinks at all.
 */
export function peBridgePortsFor(pe: PeId, spokeLinks: SpokeLinkState[], meshLinks: PwLinkState[], spokeRole: VplsPortRole): HvplsPort[] {
  const ports: HvplsPort[] = [];
  const pair = peSpokePair(pe);
  if (spokeUp(spokeLinks, pair.mtu)) ports.push({ kind: spokeRole, peer: pair.mtu });
  for (const peer of activePwPeers(meshLinks, pe)) ports.push({ kind: "MESH_PW", peer: peer as PeId });
  return ports;
}

/**
 * The RFC 4762 hierarchical split-horizon rule (brief §17-19): ONLY
 * mesh-to-mesh is forbidden. A spoke PW behaves like an access-side
 * bridging port — AC, SPOKE_PW, and MESH_PW may all freely forward to
 * one another. This function (and classifyHvplsForwardingDecision
 * below) are the only new forwarding-policy logic in this file —
 * everything upstream of them (learnSourceMac, lookupDestinationMac,
 * computeVplsEgressSet) is reused unmodified from mplsVpls.ts.
 *
 * This is deliberately NOT "block every non-AC port" (flat VPLS's
 * rule) and deliberately NOT "PW ingress can never leave another PW"
 * — the step sequence below (SPOKE → MESH replication at PE1, MESH →
 * SPOKE delivery at PE2/PE3) exercises exactly why that broader
 * statement is false in a hierarchical topology.
 */
export function applyHierarchicalSplitHorizon(egress: HvplsPort[], ingressPort: HvplsPort | undefined): HvplsPort[] {
  if (!ingressPort || ingressPort.kind !== "MESH_PW") return egress;
  return egress.filter((p) => p.kind !== "MESH_PW");
}
/** Semantic decision label, mirroring mplsVpls.ts's classifyForwardingDecision but keyed to the mesh-only rule above. */
export function classifyHvplsForwardingDecision(lookup: DestinationLookup, rawEgress: HvplsPort[], finalEgress: HvplsPort[]): ForwardingDecision {
  const blockedSomeMesh = rawEgress.some((p) => p.kind === "MESH_PW") && !finalEgress.some((p) => p.kind === "MESH_PW") && rawEgress.length > finalEgress.length;
  if (blockedSomeMesh && (lookup.kind === "BROADCAST" || lookup.kind === "MULTICAST" || lookup.kind === "UNKNOWN_UNICAST")) return "SPLIT_HORIZON_BLOCKED";
  if (lookup.kind === "REMOTE_UNICAST" && rawEgress.length > 0 && finalEgress.length === 0) return "SPLIT_HORIZON_BLOCKED";
  return lookup.kind;
}

// ---------------------------------------------------------------------------
// Scaling — pure calculations only, never mutating narrative/engine
// state (brief §40-41's read-only lab lives entirely in the page,
// driven by these two functions).
// ---------------------------------------------------------------------------
export function calculateFullMeshPwCount(n: number): number {
  return n <= 1 ? 0 : (n * (n - 1)) / 2;
}
export function calculateHierarchicalPwCount(coreCount: number, spokeCount: number): number {
  return calculateFullMeshPwCount(coreCount) + spokeCount;
}

// ---------------------------------------------------------------------------
// MAC/FDB per device — reused generically from mplsVpls.ts, just
// parameterized over VplsPortRole. No new learning/lookup/aging logic.
// ---------------------------------------------------------------------------
export { learnSourceMac, lookupDestinationMac, ageMacEntry, computeVplsEgressSet, portsEqual, type LearnChange };

export function fdbFor(state: Pick<HvplsState, "fdb">, router: MtuId | PeId): Fdb {
  return state.fdb[router] ?? [];
}
export function bridgePortsFor(state: Pick<HvplsState, "acs" | "spokeLinks" | "meshLinks" | "spokeRoleByPe">, router: MtuId | PeId): HvplsPort[] {
  if (router.startsWith("MTU")) return mtuBridgePortsFor(router as MtuId, state.acs, state.spokeLinks);
  return peBridgePortsFor(router as PeId, state.spokeLinks, state.meshLinks, state.spokeRoleByPe[router as PeId]);
}

// ---------------------------------------------------------------------------
// Graph layouts — Physical / Hierarchy / Service / MAC-learning views
// (brief §52). Hierarchy uses distinct access/core tiers vertically;
// Service labels each edge by its port role; MAC-learning reuses
// Service positions with live FDB-count subLabels (computed by the
// page, not here).
// ---------------------------------------------------------------------------
export const GRAPH_NODES = [
  { id: "CE1", label: "CE1", x: 4, y: 12, subLabel: CE_IP.CE1 },
  { id: "CE2", label: "CE2", x: 4, y: 32, subLabel: CE_IP.CE2 },
  { id: "MTU1", label: "MTU1", x: 20, y: 22, subLabel: ROUTER_LOOPBACK.MTU1 },
  { id: "PE1", label: "PE1", x: 38, y: 22, subLabel: ROUTER_LOOPBACK.PE1 },
  { id: "CE3", label: "CE3", x: 4, y: 68, subLabel: CE_IP.CE3 },
  { id: "MTU2", label: "MTU2", x: 20, y: 68, subLabel: ROUTER_LOOPBACK.MTU2 },
  { id: "PE2", label: "PE2", x: 52, y: 55, subLabel: ROUTER_LOOPBACK.PE2 },
  { id: "PE3", label: "PE3", x: 68, y: 22, subLabel: ROUTER_LOOPBACK.PE3 },
  { id: "MTU3", label: "MTU3", x: 84, y: 22, subLabel: ROUTER_LOOPBACK.MTU3 },
  { id: "CE4", label: "CE4", x: 98, y: 22, subLabel: CE_IP.CE4 },
];
export const GRAPH_EDGES: { id: LinkId; a: RouterId; b: RouterId }[] = LINKS.map((l) => ({ id: l.id, a: l.a, b: l.b }));

export const HIERARCHY_GRAPH_NODES = [
  { id: "CE1", label: "CE1", x: 6, y: 4, subLabel: "customer" },
  { id: "CE2", label: "CE2", x: 20, y: 4, subLabel: "customer" },
  { id: "CE3", label: "CE3", x: 40, y: 4, subLabel: "customer" },
  { id: "CE4", label: "CE4", x: 90, y: 4, subLabel: "customer" },
  { id: "MTU1", label: "MTU1", x: 13, y: 38, subLabel: "ACCESS TIER" },
  { id: "MTU2", label: "MTU2", x: 40, y: 38, subLabel: "ACCESS TIER" },
  { id: "MTU3", label: "MTU3", x: 90, y: 38, subLabel: "ACCESS TIER" },
  { id: "PE1", label: "PE1", x: 20, y: 72, subLabel: "CORE TIER" },
  { id: "PE2", label: "PE2", x: 55, y: 90, subLabel: "CORE TIER" },
  { id: "PE3", label: "PE3", x: 88, y: 72, subLabel: "CORE TIER" },
];
export const HIERARCHY_GRAPH_EDGES: { id: string; a: RouterId; b: RouterId; label?: string }[] = [
  { id: "CE1-MTU1", a: "CE1", b: "MTU1" },
  { id: "CE2-MTU1", a: "CE2", b: "MTU1" },
  { id: "CE3-MTU2", a: "CE3", b: "MTU2" },
  { id: "CE4-MTU3", a: "CE4", b: "MTU3" },
  { id: "MTU1-PE1", a: "MTU1", b: "PE1", label: "SPOKE" },
  { id: "MTU2-PE2", a: "MTU2", b: "PE2", label: "SPOKE" },
  { id: "MTU3-PE3", a: "MTU3", b: "PE3", label: "SPOKE" },
  { id: "PE1-PE2", a: "PE1", b: "PE2", label: "MESH" },
  { id: "PE1-PE3", a: "PE1", b: "PE3", label: "MESH" },
  { id: "PE2-PE3", a: "PE2", b: "PE3", label: "MESH" },
];

export const SERVICE_GRAPH_NODES = GRAPH_NODES;
export const SERVICE_GRAPH_EDGES: { id: string; a: RouterId; b: RouterId; label?: string }[] = LINKS.map((l) => ({ id: l.id, a: l.a, b: l.b, label: l.tier === "spoke" ? "SPOKE" : l.tier === "mesh" ? "MESH" : undefined }));

// ---------------------------------------------------------------------------
// Packet / frame builders
// ---------------------------------------------------------------------------
export function ceFrame(src: CeId, dst: CeId | "BROADCAST", note: string): EthernetFrame {
  return { srcMac: CE_MAC[src], dstMac: dst === "BROADCAST" ? BROADCAST_MAC : CE_MAC[dst], note };
}
function hvplsPacket(id: string, from: RouterId, to: RouterId, summary: string, badge: string, pkt: MplsPacketState): PacketVisual {
  return { id, protocol: "MPLS", from, to, summary, badge, layers: buildPacketLayers(pkt) };
}
function ldpPacket(id: string, from: RouterId, to: RouterId, summary: string, badge: string, fields: { label: string; value: string }[]): PacketVisual {
  return { id, protocol: "MPLS", from, to, summary, badge, layers: [{ name: "Targeted LDP", color: "var(--pv-proto-mpls)", fields }] };
}
function frameOnly(id: string, from: RouterId, frame: EthernetFrame, summary: string): PacketVisual {
  return { id, protocol: "IP", from, to: from, summary, layers: [ethLayer(frame)] };
}
export { ethLayer, buildPacketLayers, buildVplsLabelStack, processCoreTransportLabel, resolveIncomingPwLabel, deliverEthernetFrame };

// ---------------------------------------------------------------------------
// Top-level scenario state
// ---------------------------------------------------------------------------
export type JourneyAction =
  | "AC_INGRESS"
  | "SPOKE_INGRESS"
  | "MESH_INGRESS"
  | "LEARN_SOURCE"
  | "LOOKUP_DEST"
  | "LOCAL_SWITCH"
  | "REPLICATE"
  | "PUSH_SPOKE"
  | "PUSH_MESH"
  | "POP_TRANSPORT"
  | "MESH_SPLIT_HORIZON_BLOCK"
  | "AC_EGRESS"
  | "SPOKE_EGRESS"
  | "MESH_EGRESS"
  | "AC_UNAVAILABLE";
export interface JourneyHop {
  device: RouterId;
  input: string;
  lookup: string;
  action: JourneyAction;
  output: string;
}
export interface TroubleshootingState {
  started: boolean;
  repairAttempt?: { choice: string; correct: boolean };
  repaired: boolean;
  verified: boolean;
  spokeFailureStarted?: boolean;
  spokeFailureRestored?: boolean;
}
export interface HvplsFloodCopy {
  id: string;
  fromId: RouterId;
  toId: RouterId;
}
export interface HvplsState {
  transport: TransportState;
  acs: AttachmentCircuit[];
  spokeLinks: SpokeLinkState[];
  meshLinks: PwLinkState[];
  /** Each PE-rs's own CLASSIFICATION of its spoke-facing port — see peBridgePortsFor's doc comment. Normally "SPOKE_PW" everywhere; the incident corrupts PE1's to "MESH_PW" without ever touching spokeLinks. */
  spokeRoleByPe: Record<PeId, VplsPortRole>;
  fdb: Record<MtuId | PeId, Fdb>;
  packet?: MplsPacketState;
  packetAt?: RouterId;
  journey: JourneyHop[];
  floodCopies?: HvplsFloodCopy[];
  lastDecision?: ForwardingDecision;
  troubleshooting: TroubleshootingState;
}

export function createHvplsState(): HvplsState {
  return {
    transport: { igpUp: false, ldpUp: false, lspUp: false },
    acs: [
      { mtu: "MTU1", ceRouter: "CE1", interfaceName: "ge-0/0/0.100", vlan: VLAN, up: true },
      { mtu: "MTU1", ceRouter: "CE2", interfaceName: "ge-0/0/1.100", vlan: VLAN, up: true },
      { mtu: "MTU2", ceRouter: "CE3", interfaceName: "ge-0/0/0.100", vlan: VLAN, up: true },
      { mtu: "MTU3", ceRouter: "CE4", interfaceName: "ge-0/0/0.100", vlan: VLAN, up: true },
    ],
    spokeLinks: [
      { id: "MTU1-PE1", up: false },
      { id: "MTU2-PE2", up: false },
      { id: "MTU3-PE3", up: false },
    ],
    meshLinks: [
      { id: "PE1-PE2", up: false },
      { id: "PE1-PE3", up: false },
      { id: "PE2-PE3", up: false },
    ],
    spokeRoleByPe: { PE1: "SPOKE_PW", PE2: "SPOKE_PW", PE3: "SPOKE_PW" },
    fdb: { MTU1: [], MTU2: [], MTU3: [], PE1: [], PE2: [], PE3: [] },
    journey: [],
    troubleshooting: { started: false, repaired: false, verified: false },
  };
}

// ===========================================================================
// Scenario steps
// ===========================================================================
export const hVplsSteps: ScenarioStep<HvplsState>[] = [
  {
    id: "intro",
    label: "Introduction",
    narrative: "Central question: if dozens or hundreds of access sites need to join the same VPLS service, must every single one become another full-mesh core PE? RFC 4762's answer is no — it builds hierarchy instead. This lesson is Hierarchical VPLS (H-VPLS).",
  },
  {
    id: "recap-flat-vpls",
    label: "Recap: Flat (Classic) VPLS",
    narrative: "You already built classic VPLS: every participating PE joins one full mesh of pseudowires with every other PE. For n mesh PEs, that's PW count = n(n-1)/2 — a real number you calculated directly, not an approximation.",
  },
  {
    id: "predict-flat-scaling",
    label: "Predict",
    narrative: "Before continuing:",
    question: {
      prompt: `Six devices all need to join one flat VPLS mesh. How many pseudowires does a full mesh require? (${calculateFullMeshPwCount(6)} is one of the options.)`,
      options: [
        { id: "fifteen", label: `${calculateFullMeshPwCount(6)} — n(n-1)/2 with n=6` },
        { id: "six", label: "6 — one PW per device is enough" },
        { id: "thirty", label: "30 — every device needs a PW to every other device counted twice" },
        { id: "twelve", label: "12 — pair devices up and double it" },
      ],
      correctOptionId: "fifteen",
      explanation: `calculateFullMeshPwCount(6) = 6×5/2 = ${calculateFullMeshPwCount(6)}. This is exactly the scaling problem H-VPLS exists to solve — it grows quadratically as new sites join.`,
    },
  },
  {
    id: "central-question",
    label: "The Central Question",
    narrative: "What happens when dozens or hundreds of access devices need the same service? Must every one of them become another full-mesh VPLS PE, paying that same n(n-1)/2 cost as the mesh grows? H-VPLS's answer: no — it creates hierarchy.",
  },
  {
    id: "hierarchy-mental-model",
    label: "The H-VPLS Mental Model",
    narrative: "CUSTOMER SITES → MTU-s (access, bridging-capable) → SPOKE PW → PE-rs (core hub, routing + bridging) → MESH PWs → other PE-rs hubs → SPOKE PW → remote MTU-s → REMOTE CUSTOMER SITES. Two tiers, two different pseudowire roles, one Ethernet bridging model spanning both.",
  },
  {
    id: "terminology-mtu-pe",
    label: "Terminology: MTU-s and PE-rs",
    narrative: "RFC 4762 calls the access tier MTU-s (bridging-capable access device) and the core hub tier PE-rs (routing + bridging capable). PacketVerse may also show the friendly labels ACCESS NODE / CORE VPLS PE. Vendor terminology varies — not every real deployment literally names devices MTU-s and PE-rs.",
  },
  {
    id: "terminology-spoke-mesh",
    label: "Terminology: Spoke PW and Mesh PW",
    narrative: "A SPOKE pseudowire connects an MTU-s to its one PE-rs hub — the access-tier pseudowire. A MESH (or hub) pseudowire connects two PE-rs core hubs — the same core pseudowire you already built in flat VPLS. Same PW signaling mechanics underneath; different role in the bridging hierarchy.",
  },
  {
    id: "why-hierarchy-flat-example",
    label: "Why Hierarchy: The Flat Example",
    narrative: `Six VPLS-capable devices, flat: full mesh = 6×5/2 = ${calculateFullMeshPwCount(6)} pseudowires — calculateFullMeshPwCount(6).`,
  },
  {
    id: "why-hierarchy-hierarchical-example",
    label: "Why Hierarchy: The Hierarchical Example",
    narrative: `The same six devices, restructured as 3 PE-rs core hubs + 3 MTU-s access nodes: core mesh = calculateFullMeshPwCount(3) = ${calculateFullMeshPwCount(3)}; access spokes = 3; total = calculateHierarchicalPwCount(3, 3) = ${calculateHierarchicalPwCount(3, 3)} pseudowires. This is exactly this lesson's own topology.`,
  },
  {
    id: "predict-hierarchy-savings",
    label: "Predict",
    narrative: "Before continuing:",
    question: {
      prompt: "Does H-VPLS guarantee some fixed savings ratio over flat VPLS in every deployment?",
      options: [
        { id: "depends", label: "No — the savings depend entirely on the core-to-access ratio chosen; hierarchy changes the SHAPE of the scaling curve, not a fixed guaranteed number" },
        { id: "always-half", label: "Yes — H-VPLS always cuts the PW count exactly in half" },
        { id: "no-benefit", label: "No — H-VPLS never actually reduces PW count in practice" },
        { id: "always-same", label: "The PW count is always identical between flat and hierarchical designs" },
      ],
      correctOptionId: "depends",
      explanation: "calculateHierarchicalPwCount(coreCount, spokeCount) is a real function of two independent inputs. The scaling LAB later in this lesson lets you vary both and see the relationship directly — there is no single fixed ratio to memorize.",
    },
  },
  {
    id: "topology-intro",
    label: "Topology",
    narrative: `CE1 (${CE_IP.CE1}) and CE2 (${CE_IP.CE2}) attach to MTU1. CE3 (${CE_IP.CE3}) attaches to MTU2. CE4 (${CE_IP.CE4}) attaches to MTU3. MTU1, MTU2, and MTU3 are access-tier bridges — each reaches the service through exactly one spoke PW to its PE-rs hub (PE1, PE2, PE3 respectively). PE1, PE2, and PE3 form the core full mesh.`,
  },
  {
    id: "customer-service-intro",
    label: "The Customer Service",
    narrative: `Service ${SERVICE_NAME}, VLAN ${VLAN} — one Ethernet broadcast domain spanning CE1 through CE4, exactly like the flat-VPLS lesson's CUST-A-VPLS, just with more sites and a hierarchical access design underneath.`,
  },
  {
    id: "mtu-is-a-bridge",
    label: "MTU-s Is A Bridge",
    narrative: "This is fundamental: MTU1 is an ordinary Ethernet bridge with its own FDB. Its ports: an AC to CE1, an AC to CE2, and its spoke PW to PE1 (which behaves as a virtual bridge port). Ordinary bridging rules — learn source, look up destination, flood if unknown — run at MTU1 exactly like they run at any VPLS PE.",
  },
  {
    id: "predict-mtu-role",
    label: "Predict",
    narrative: "Before continuing:",
    question: {
      prompt: "Does MTU1 need to become a full core-mesh member to serve CE1 and CE2?",
      options: [
        { id: "no", label: "No — MTU1 only needs its local ACs plus one spoke PW to its PE-rs hub" },
        { id: "yes", label: "Yes — every bridging device in a VPLS service must join the core mesh" },
        { id: "only-if-two-ces", label: "Only because MTU1 happens to have two attached CEs" },
        { id: "no-mtu-is-passive", label: "No, but only because MTU1 never actually bridges — it just repeats frames" },
      ],
      correctOptionId: "no",
      explanation: "This is the entire point of the hierarchy: MTU1 is a real, independently-learning bridge, but it participates in the service through exactly one spoke relationship, never through direct core-mesh membership.",
    },
  },
  {
    id: "transport-recap",
    label: "Transport Recap",
    narrative: "Exactly as in every prior MPLS lesson: IGP reachability, then LDP label distribution, then a working label-switched path between every hub/access loopback. Transport is completely independent of whether a given pseudowire ends up playing a spoke role or a mesh role.",
  },
  {
    id: "transport-lsp-up",
    label: "Transport: LSP UP",
    narrative: "IGP converged, LDP operational, label-switched paths established. No H-VPLS service state exists yet — transport readiness says nothing about spoke or mesh PW state.",
    run: (state) => ({ state: { ...state, transport: { igpUp: true, ldpUp: true, lspUp: true } }, events: [] }),
    whatChanged: () => ["Transport: DOWN → UP (IGP + LDP + LSP)"],
  },
  {
    id: "core-mesh-intro",
    label: "Building The Core Mesh First",
    narrative: "Just like flat VPLS: PE1, PE2, and PE3 signal a full mesh of core pseudowires between themselves via targeted LDP — the identical mechanism you already built, now called the PE-rs core mesh.",
  },
  {
    id: "establish-mesh-pe1-pe2",
    label: "Establish Mesh PW: PE1 ↔ PE2",
    narrative: `PE1 allocates receive label ${allocatePwReceiveLabel("PE1", "PE2")} for traffic from PE2; PE2 allocates ${allocatePwReceiveLabel("PE2", "PE1")} for traffic from PE1. Mesh PW PE1-PE2 comes UP — same directional-label mechanism as flat VPLS's mesh.`,
    packet: () => ldpPacket("mesh-map-pe1-pe2", "PE1", "PE2", "Label Mapping (mesh)", "MAPPING", [{ label: "PE1→ label", value: String(allocatePwReceiveLabel("PE1", "PE2")) }, { label: "PE2→ label", value: String(allocatePwReceiveLabel("PE2", "PE1")) }]),
    run: (state) => ({ state: { ...state, meshLinks: state.meshLinks.map((l) => (l.id === "PE1-PE2" ? { ...l, up: true } : l)) }, events: [{ type: "VPN_ROUTE_INSTALLED", stepId: "establish-mesh-pe1-pe2", timestamp: Date.now(), message: "Mesh PW PE1-PE2 UP" }] }),
    whatChanged: () => ["Mesh PW PE1-PE2: DOWN → UP"],
  },
  {
    id: "establish-mesh-pe1-pe3",
    label: "Establish Mesh PW: PE1 ↔ PE3",
    narrative: `PE1 allocates ${allocatePwReceiveLabel("PE1", "PE3")}; PE3 allocates ${allocatePwReceiveLabel("PE3", "PE1")}. Mesh PW PE1-PE3 comes UP.`,
    packet: () => ldpPacket("mesh-map-pe1-pe3", "PE1", "PE3", "Label Mapping (mesh)", "MAPPING", [{ label: "PE1→ label", value: String(allocatePwReceiveLabel("PE1", "PE3")) }, { label: "PE3→ label", value: String(allocatePwReceiveLabel("PE3", "PE1")) }]),
    run: (state) => ({ state: { ...state, meshLinks: state.meshLinks.map((l) => (l.id === "PE1-PE3" ? { ...l, up: true } : l)) }, events: [{ type: "VPN_ROUTE_INSTALLED", stepId: "establish-mesh-pe1-pe3", timestamp: Date.now(), message: "Mesh PW PE1-PE3 UP" }] }),
    whatChanged: () => ["Mesh PW PE1-PE3: DOWN → UP"],
  },
  {
    id: "establish-mesh-pe2-pe3",
    label: "Establish Mesh PW: PE2 ↔ PE3",
    narrative: `PE2 allocates ${allocatePwReceiveLabel("PE2", "PE3")}; PE3 allocates ${allocatePwReceiveLabel("PE3", "PE2")}. The core mesh's third and final leg comes UP — three PE-rs, three mesh PWs, exactly calculateFullMeshPwCount(3).`,
    packet: () => ldpPacket("mesh-map-pe2-pe3", "PE2", "PE3", "Label Mapping (mesh)", "MAPPING", [{ label: "PE2→ label", value: String(allocatePwReceiveLabel("PE2", "PE3")) }, { label: "PE3→ label", value: String(allocatePwReceiveLabel("PE3", "PE2")) }]),
    run: (state) => ({ state: { ...state, meshLinks: state.meshLinks.map((l) => (l.id === "PE2-PE3" ? { ...l, up: true } : l)) }, events: [{ type: "VPN_ROUTE_INSTALLED", stepId: "establish-mesh-pe2-pe3", timestamp: Date.now(), message: "Mesh PW PE2-PE3 UP" }] }),
    whatChanged: () => ["Mesh PW PE2-PE3: DOWN → UP"],
  },
  {
    id: "spoke-pw-intro",
    label: "Now, The Spokes",
    narrative: "With the core mesh complete, each MTU-s signals exactly ONE pseudowire — its spoke — to its PE-rs hub. Same targeted-LDP-style directional label allocation, just a point-to-point relationship instead of a mesh leg.",
  },
  {
    id: "establish-spoke-mtu1-pe1",
    label: "Establish Spoke PW: MTU1 ↔ PE1",
    narrative: `PE1 allocates receive label ${allocateSpokeReceiveLabel("PE1", "MTU1")} for traffic from MTU1; MTU1 allocates ${allocateSpokeReceiveLabel("MTU1", "PE1")} for traffic from PE1. Spoke PW MTU1-PE1 comes UP.`,
    packet: () => ldpPacket("spoke-map-mtu1", "MTU1", "PE1", "Label Mapping (spoke)", "MAPPING", [{ label: "MTU1→ label", value: String(allocateSpokeReceiveLabel("MTU1", "PE1")) }, { label: "PE1→ label", value: String(allocateSpokeReceiveLabel("PE1", "MTU1")) }]),
    run: (state) => ({ state: { ...state, spokeLinks: state.spokeLinks.map((l) => (l.id === "MTU1-PE1" ? { ...l, up: true } : l)) }, events: [{ type: "VPN_ROUTE_INSTALLED", stepId: "establish-spoke-mtu1-pe1", timestamp: Date.now(), message: "Spoke PW MTU1-PE1 UP" }] }),
    whatChanged: () => ["Spoke PW MTU1-PE1: DOWN → UP"],
  },
  {
    id: "establish-spoke-mtu2-pe2",
    label: "Establish Spoke PW: MTU2 ↔ PE2",
    narrative: `PE2 allocates ${allocateSpokeReceiveLabel("PE2", "MTU2")}; MTU2 allocates ${allocateSpokeReceiveLabel("MTU2", "PE2")}. Spoke PW MTU2-PE2 comes UP.`,
    packet: () => ldpPacket("spoke-map-mtu2", "MTU2", "PE2", "Label Mapping (spoke)", "MAPPING", [{ label: "MTU2→ label", value: String(allocateSpokeReceiveLabel("MTU2", "PE2")) }, { label: "PE2→ label", value: String(allocateSpokeReceiveLabel("PE2", "MTU2")) }]),
    run: (state) => ({ state: { ...state, spokeLinks: state.spokeLinks.map((l) => (l.id === "MTU2-PE2" ? { ...l, up: true } : l)) }, events: [{ type: "VPN_ROUTE_INSTALLED", stepId: "establish-spoke-mtu2-pe2", timestamp: Date.now(), message: "Spoke PW MTU2-PE2 UP" }] }),
    whatChanged: () => ["Spoke PW MTU2-PE2: DOWN → UP"],
  },
  {
    id: "establish-spoke-mtu3-pe3",
    label: "Establish Spoke PW: MTU3 ↔ PE3",
    narrative: `PE3 allocates ${allocateSpokeReceiveLabel("PE3", "MTU3")}; MTU3 allocates ${allocateSpokeReceiveLabel("MTU3", "PE3")}. All three spokes are now UP — the hierarchy is complete: ${calculateHierarchicalPwCount(3, 3)} pseudowires total (3 mesh + 3 spoke).`,
    packet: () => ldpPacket("spoke-map-mtu3", "MTU3", "PE3", "Label Mapping (spoke)", "MAPPING", [{ label: "MTU3→ label", value: String(allocateSpokeReceiveLabel("MTU3", "PE3")) }, { label: "PE3→ label", value: String(allocateSpokeReceiveLabel("PE3", "MTU3")) }]),
    run: (state) => ({ state: { ...state, spokeLinks: state.spokeLinks.map((l) => (l.id === "MTU3-PE3" ? { ...l, up: true } : l)) }, events: [{ type: "VPN_ROUTE_INSTALLED", stepId: "establish-spoke-mtu3-pe3", timestamp: Date.now(), message: "Spoke PW MTU3-PE3 UP" }] }),
    whatChanged: () => ["Spoke PW MTU3-PE3: DOWN → UP", "Hierarchy complete: 3 mesh + 3 spoke = 6 pseudowires"],
  },
  {
    id: "predict-spoke-signaling",
    label: "Predict",
    narrative: "Before continuing:",
    question: {
      prompt: "Does H-VPLS require a genuinely different PW signaling protocol from what you already used in flat VPLS?",
      options: [
        { id: "no-same-ldp-style", label: "No — this baseline model uses the same LDP-style directional PW signaling for both spoke and mesh PWs" },
        { id: "yes-bgp-required", label: "Yes — spokes can only be signaled by BGP" },
        { id: "yes-different-protocol", label: "Yes — spokes require a completely separate protocol from mesh PWs" },
        { id: "no-signaling-needed", label: "No signaling is needed at all for a spoke PW" },
      ],
      correctOptionId: "no-same-ldp-style",
      explanation: "H-VPLS is orthogonal to which signaling protocol is used. This lesson keeps both spoke and mesh PWs on the same LDP-style model already taught — BGP-signaled H-VPLS is a different, later topic, not covered here.",
    },
  },
  {
    id: "bridge-ports-mtu1",
    label: "Inspect: MTU1's Bridge Ports",
    narrative: "MTU1's bridge ports right now: AC: CE1, AC: CE2, SPOKE_PW: PE1. Three ports, one bridge context, ordinary Ethernet rules across all of them.",
  },
  {
    id: "bridge-ports-pe1",
    label: "Inspect: PE1's Bridge Ports",
    narrative: "PE1's bridge ports right now: SPOKE_PW: MTU1, MESH_PW: PE2, MESH_PW: PE3. Notice the port ROLES are explicit and distinct — not just \"AC\" and generic \"PW\" the way flat VPLS modeled it.",
  },
  {
    id: "predict-port-roles",
    label: "Predict",
    narrative: "Before continuing:",
    question: {
      prompt: "Why does H-VPLS need THREE distinct port-role labels (AC, SPOKE_PW, MESH_PW) instead of flat VPLS's two (AC, PW)?",
      options: [
        { id: "different-forwarding-rules", label: "Because spoke PWs and mesh PWs follow genuinely different forwarding/split-horizon rules at a PE-rs" },
        { id: "cosmetic", label: "Purely cosmetic — all pseudowire ports behave identically regardless of role" },
        { id: "spoke-is-ac", label: "Because a spoke PW is secretly just another AC, not a PW at all" },
        { id: "mesh-is-ac", label: "Because a mesh PW is secretly just another AC, not a PW at all" },
      ],
      correctOptionId: "different-forwarding-rules",
      explanation: "This is the whole reason the role distinction exists: mesh-to-mesh forwarding is forbidden (loop prevention on the core), but spoke-to-mesh, mesh-to-spoke, AC-to-spoke, and spoke-to-AC are all allowed. Collapsing spoke and mesh into one generic \"PW\" role — like flat VPLS did — would make that impossible to express correctly.",
    },
  },
  {
    id: "ready-but-empty",
    label: "Ready, But Empty",
    narrative: "Transport UP, core mesh UP, all three spokes UP, all ACs UP. Every MTU-s and PE-rs FDB is still completely empty — the hierarchy exists; nothing has been learned yet.",
  },
  {
    id: "local-switching-intro",
    label: "First Traffic: CE1 → CE2, Both Behind MTU1",
    narrative: "CE1 sends a frame to CE2 — both are local customer sites behind the SAME MTU1. Watch what MTU1 does with a destination it hasn't learned yet.",
  },
  {
    id: "send-ce1-to-ce2-1",
    label: "CE1 Sends A Frame To CE2",
    narrative: `Src ${CE_MAC.CE1}, Dst ${CE_MAC.CE2}. MTU1 receives it, unlabeled, on its AC to CE1. MTU1 has never seen CE2's MAC — as a source or otherwise.`,
    packet: () => frameOnly("ce1-frame-1", "CE1", ceFrame("CE1", "CE2", "First frame — CE1 to CE2"), "Ethernet frame toward CE2"),
    run: (state) => ({ state: { ...state, packet: { frame: ceFrame("CE1", "CE2", "First frame — CE1 to CE2"), labels: [] }, packetAt: "CE1", journey: [], floodCopies: undefined, lastDecision: undefined }, events: [{ type: "PACKET_SENT", stepId: "send-ce1-to-ce2-1", timestamp: Date.now(), message: "CE1 sends Ethernet frame toward CE2" }] }),
  },
  {
    id: "mtu1-learn-ce1",
    label: "MTU1: Learn Source MAC",
    narrative: `MTU1 learns ${CE_MAC.CE1} on AC: CE1 — its first FDB entry. MTU1's bridging behavior is identical to a VPLS PE's: learn unconditionally on every ingress port before any forwarding decision.`,
    packet: (state) => (state.packet ? hvplsPacket("mtu1-ac-in", "CE1", "MTU1", "Ethernet frame", "AC", state.packet) : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const { fdb, change } = learnSourceMac(fdbFor(state, "MTU1"), CE_MAC.CE1, { kind: "AC", peer: "CE1" });
      const journey: JourneyHop[] = [{ device: "MTU1", input: "Ethernet frame (unlabeled)", lookup: `Learn source ${CE_MAC.CE1} on AC: CE1`, action: "AC_INGRESS", output: `FDB[MTU1]: ${CE_MAC.CE1} → AC: CE1 (${change})` }];
      return { state: { ...state, packetAt: "MTU1", journey, fdb: { ...state.fdb, MTU1: fdb } }, events: [{ type: "MAC_LEARNED", stepId: "mtu1-learn-ce1", timestamp: Date.now(), message: `MTU1 learns ${CE_MAC.CE1} on AC: CE1` }] };
    },
    whatChanged: () => [`MTU1 FDB: + ${CE_MAC.CE1} → AC: CE1`],
  },
  {
    id: "predict-unknown-at-mtu",
    label: "Predict",
    narrative: "Before continuing:",
    question: {
      prompt: "CE2's MAC is unknown to MTU1. Which ports are eligible to receive the flooded frame?",
      options: [
        { id: "ac-and-spoke", label: "Every non-ingress port: AC: CE2 AND SPOKE_PW: PE1" },
        { id: "ac-only", label: "Only AC: CE2 — never flood onto the spoke for unknown local traffic" },
        { id: "spoke-only", label: "Only SPOKE_PW: PE1 — local ACs never receive flooded traffic" },
        { id: "neither", label: "Neither — an unknown destination is simply dropped" },
      ],
      correctOptionId: "ac-and-spoke",
      explanation: "MTU1 doesn't know CE2 is local yet — from MTU1's perspective this is ordinary unknown-unicast flooding, and the ingress was an AC, so nothing restricts the flood. Both AC: CE2 and SPOKE_PW: PE1 are eligible; only the (as-yet-untaught) SPOKE_PW ↔ MESH_PW distinction has any restriction at all, and it doesn't apply here.",
    },
  },
  {
    id: "mtu1-flood-decision",
    label: "MTU1: Flood — Unknown Destination",
    narrative: "MTU1's bridge ports: AC: CE1 (ingress, excluded), AC: CE2, SPOKE_PW: PE1. Raw egress = final egress = [AC: CE2, SPOKE_PW: PE1] — ingress was an AC, so hierarchical split horizon (which only restricts MESH_PW egress after MESH_PW ingress) has nothing to filter here.",
    run: (state) => {
      const ports = bridgePortsFor(state, "MTU1");
      const ingress: HvplsPort = { kind: "AC", peer: "CE1" };
      const lookup = lookupDestinationMac(fdbFor(state, "MTU1"), CE_MAC.CE2);
      const raw = computeVplsEgressSet(ports, ingress, lookup);
      const final = applyHierarchicalSplitHorizon(raw, ingress);
      const decision = classifyHvplsForwardingDecision(lookup, raw, final);
      const journey = [...state.journey, { device: "MTU1" as RouterId, input: CE_MAC.CE2, lookup: `Egress set: [${raw.map(portLabel).join(", ")}]`, action: "REPLICATE" as JourneyAction, output: `Flood to: ${final.map(portLabel).join(", ")}` }];
      return { state: { ...state, journey, lastDecision: decision, floodCopies: [{ id: "fc-mtu1-ce2", fromId: "MTU1", toId: "CE2" }, { id: "fc-mtu1-pe1", fromId: "MTU1", toId: "PE1" }] }, events: [] };
    },
    whatChanged: () => ["MTU1 floods to AC: CE2 AND SPOKE_PW: PE1 — two independent copies"],
  },
  {
    id: "ce2-receives-directly",
    label: "CE2 Receives — Via The Local AC Copy",
    narrative: `The AC: CE2 copy is delivered immediately — CE2's destination MAC matches, so it accepts the frame. This copy never touched the spoke or the core.`,
    packet: (state) => (state.packet ? frameOnly("mtu1-deliver-ce2", "MTU1", deliverEthernetFrame(state.packet), "Delivered to CE2 (flooded)") : undefined),
    run: (state) => {
      const journey = [...state.journey, { device: "CE2" as RouterId, input: "Ethernet frame", lookup: "AC delivery — destination MAC matches CE2", action: "AC_EGRESS" as JourneyAction, output: "Delivered and accepted" }];
      return { state: { ...state, journey }, events: [{ type: "VPN_PACKET_DELIVERED", stepId: "ce2-receives-directly", timestamp: Date.now(), message: "MTU1 delivers flooded frame to CE2 directly" }] };
    },
  },
  {
    id: "pe1-receives-spoke-copy",
    label: "Meanwhile: PE1 Receives The Other Copy Via Its Spoke",
    narrative: `PE1's spoke-ingress copy arrives with a pushed spoke label (${allocateSpokeReceiveLabel("PE1", "MTU1")}) and transport label. PE1 resolves the spoke label, learns ${CE_MAC.CE1} → SPOKE_PW: MTU1 in its own FDB, and looks up ${CE_MAC.CE2}: still unknown to PE1. PE1's ports: SPOKE_PW: MTU1 (ingress), MESH_PW: PE2, MESH_PW: PE3. Ingress was a spoke — hierarchical split horizon does NOT restrict spoke-ingress traffic, so PE1 floods to BOTH mesh peers. This is SPOKE → MESH, explicitly allowed.`,
    packet: (state) => {
      if (!state.packet) return undefined;
      const withLabels = buildVplsLabelStack(state.packet.frame, allocateSpokeReceiveLabel("PE1", "MTU1"), transportLabelToward("PE1"));
      return hvplsPacket("mtu1-push-spoke", "MTU1", "PE1", "PUSH spoke + transport", "PUSH", withLabels);
    },
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const afterPop = processCoreTransportLabel(buildVplsLabelStack(state.packet.frame, allocateSpokeReceiveLabel("PE1", "MTU1"), transportLabelToward("PE1")), "IMPLICIT_NULL");
      const { fdb } = learnSourceMac(fdbFor(state, "PE1"), CE_MAC.CE1, { kind: "SPOKE_PW", peer: "MTU1" });
      const ports = bridgePortsFor(state, "PE1");
      const ingress: HvplsPort = { kind: "SPOKE_PW", peer: "MTU1" };
      const lookup = lookupDestinationMac(fdb, CE_MAC.CE2);
      const raw = computeVplsEgressSet(ports, ingress, lookup);
      const final = applyHierarchicalSplitHorizon(raw, ingress);
      const journey = [...state.journey, { device: "PE1" as RouterId, input: `label ${allocateSpokeReceiveLabel("PE1", "MTU1")}`, lookup: `Spoke label → ${SERVICE_NAME}; learn ${CE_MAC.CE1} on SPOKE_PW: MTU1; lookup ${CE_MAC.CE2}: UNKNOWN_UNICAST`, action: "SPOKE_INGRESS" as JourneyAction, output: `SPOKE → MESH allowed. Flood to: ${final.map(portLabel).join(", ")}` }];
      return { state: { ...state, packet: afterPop, packetAt: "PE1", journey, fdb: { ...state.fdb, PE1: fdb }, lastDecision: "UNKNOWN_UNICAST", floodCopies: [{ id: "fc-pe1-pe2", fromId: "PE1", toId: "PE2" }, { id: "fc-pe1-pe3", fromId: "PE1", toId: "PE3" }] }, events: [{ type: "MAC_LEARNED", stepId: "pe1-receives-spoke-copy", timestamp: Date.now(), message: `PE1 learns ${CE_MAC.CE1} on SPOKE_PW: MTU1` }] };
    },
    whatChanged: () => [`PE1 FDB: + ${CE_MAC.CE1} → SPOKE_PW: MTU1`, "PE1 floods to MESH_PW: PE2 AND MESH_PW: PE3 — spoke ingress permits mesh egress"],
  },
  {
    id: "predict-spoke-to-mesh",
    label: "Predict",
    narrative: "Before continuing:",
    question: {
      prompt: "Is a frame received on a spoke PW allowed to be forwarded onto an eligible core mesh PW?",
      options: [
        { id: "yes", label: "Yes — a spoke behaves like an access-side port for bridging purposes" },
        { id: "no", label: "No — a PW can never forward onto another PW, spoke or mesh" },
        { id: "only-known", label: "Only for known-unicast traffic, never for flooding" },
        { id: "only-one-mesh-peer", label: "Yes, but only to exactly one mesh peer, never both" },
      ],
      correctOptionId: "yes",
      explanation: "You just watched PE1 do exactly this. The rule you learned in flat VPLS — no PW-to-PW relay — was actually a mesh-only rule that happened to cover every PW that existed at the time. It was never \"no PW can ever forward onto another PW.\"",
    },
  },
  {
    id: "pe2-receives-mesh-delivers-spoke",
    label: "PE2: Mesh Ingress — Delivers Down Its Spoke",
    narrative: `PE2 receives PE1's mesh copy. Its ports: SPOKE_PW: MTU2, MESH_PW: PE1 (ingress), MESH_PW: PE3. Raw egress (unknown ${CE_MAC.CE2}) = [SPOKE_PW: MTU2, MESH_PW: PE3]. Ingress was MESH_PW — hierarchical split horizon strips MESH_PW egress. Final egress = [SPOKE_PW: MTU2] only. This single journey entry shows BOTH halves of the rule: MESH → SPOKE allowed, MESH → MESH blocked (PE3 excluded).`,
    packet: (state) => (state.packet ? hvplsPacket("pe2-mesh-in", "PE1", "PE2", "Mesh label lookup", "MESH", state.packet) : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const { fdb } = learnSourceMac(fdbFor(state, "PE2"), CE_MAC.CE1, { kind: "MESH_PW", peer: "PE1" });
      const ports = bridgePortsFor(state, "PE2");
      const ingress: HvplsPort = { kind: "MESH_PW", peer: "PE1" };
      const lookup = lookupDestinationMac(fdb, CE_MAC.CE2);
      const raw = computeVplsEgressSet(ports, ingress, lookup);
      const final = applyHierarchicalSplitHorizon(raw, ingress);
      const decision = classifyHvplsForwardingDecision(lookup, raw, final);
      const journey = [...state.journey, { device: "PE2" as RouterId, input: `label ${allocatePwReceiveLabel("PE2", "PE1")}`, lookup: `Egress set: [${raw.map(portLabel).join(", ")}] → hierarchical split horizon → [${final.map(portLabel).join(", ")}]`, action: "MESH_SPLIT_HORIZON_BLOCK" as JourneyAction, output: `MESH → SPOKE allowed, MESH → MESH blocked. Deliver to: ${final.map(portLabel).join(", ")}` }];
      return { state: { ...state, packetAt: "PE2", journey, fdb: { ...state.fdb, PE2: fdb }, lastDecision: decision }, events: [{ type: "MAC_LEARNED", stepId: "pe2-receives-mesh-delivers-spoke", timestamp: Date.now(), message: `PE2 learns ${CE_MAC.CE1} on MESH_PW: PE1` }] };
    },
    whatChanged: () => [`PE2 FDB: + ${CE_MAC.CE1} → MESH_PW: PE1`, "PE2 does NOT relay to MESH_PW: PE3 — mesh split horizon"],
  },
  {
    id: "pe3-receives-direct-from-pe1",
    label: "PE3: Its Own Direct Mesh Copy From PE1",
    narrative: `PE3 got its own copy directly from PE1's mesh flood — not relayed via PE2. Same rule applies: ingress MESH_PW: PE1, raw egress = [SPOKE_PW: MTU3, MESH_PW: PE2], split horizon strips MESH_PW: PE2 → final = [SPOKE_PW: MTU3]. This is exactly why the core mesh must be FULL: PE3 cannot rely on PE2 relaying PE1's traffic (that relay is forbidden), so PE1 needs its own direct leg to PE3.`,
    run: (state) => {
      const { fdb } = learnSourceMac(fdbFor(state, "PE3"), CE_MAC.CE1, { kind: "MESH_PW", peer: "PE1" });
      const ports = bridgePortsFor(state, "PE3");
      const ingress: HvplsPort = { kind: "MESH_PW", peer: "PE1" };
      const lookup = lookupDestinationMac(fdb, CE_MAC.CE2);
      const raw = computeVplsEgressSet(ports, ingress, lookup);
      const final = applyHierarchicalSplitHorizon(raw, ingress);
      const journey = [...state.journey, { device: "PE3" as RouterId, input: `label ${allocatePwReceiveLabel("PE3", "PE1")}`, lookup: `Egress set: [${raw.map(portLabel).join(", ")}] → [${final.map(portLabel).join(", ")}]`, action: "MESH_SPLIT_HORIZON_BLOCK" as JourneyAction, output: `Deliver to: ${final.map(portLabel).join(", ")}` }];
      return { state: { ...state, journey, fdb: { ...state.fdb, PE3: fdb }, floodCopies: [{ id: "fc-pe2-mtu2", fromId: "PE2", toId: "MTU2" }, { id: "fc-pe3-mtu3", fromId: "PE3", toId: "MTU3" }] }, events: [{ type: "MAC_LEARNED", stepId: "pe3-receives-direct-from-pe1", timestamp: Date.now(), message: `PE3 learns ${CE_MAC.CE1} on MESH_PW: PE1` }] };
    },
    whatChanged: () => [`PE3 FDB: + ${CE_MAC.CE1} → MESH_PW: PE1`, "PE3 delivers down its own spoke to MTU3 — never via PE2"],
  },
  {
    id: "mtu2-mtu3-discard",
    label: "MTU2 And MTU3 Flood To Their ACs — CE3/CE4 Discard",
    narrative: `MTU2 receives via its spoke, floods to AC: CE3 (its only other port). MTU3 receives via its spoke, floods to AC: CE4. Both CE3 and CE4 receive a copy of a frame addressed to ${CE_MAC.CE2} — an ordinary Ethernet NIC discard, not an H-VPLS mechanism. CE2's real location (local to MTU1) meant this entire core round-trip was ultimately wasted bandwidth — exactly why MAC learning matters.`,
    run: (state) => {
      const { fdb: fdbMtu2 } = learnSourceMac(fdbFor(state, "MTU2"), CE_MAC.CE1, { kind: "SPOKE_PW", peer: "PE2" });
      const { fdb: fdbMtu3 } = learnSourceMac(fdbFor(state, "MTU3"), CE_MAC.CE1, { kind: "SPOKE_PW", peer: "PE3" });
      return { state: { ...state, fdb: { ...state.fdb, MTU2: fdbMtu2, MTU3: fdbMtu3 }, floodCopies: undefined }, events: [{ type: "MAC_LEARNED", stepId: "mtu2-mtu3-discard", timestamp: Date.now(), message: `MTU2 and MTU3 learn ${CE_MAC.CE1} on their respective spokes` }] };
    },
    whatChanged: () => [`MTU2 FDB: + ${CE_MAC.CE1} → SPOKE_PW: PE2`, `MTU3 FDB: + ${CE_MAC.CE1} → SPOKE_PW: PE3`, "CE3 and CE4 both discard — wrong destination MAC"],
  },
  {
    id: "predict-mesh-to-mesh",
    label: "Predict",
    narrative: "Before continuing:",
    question: {
      prompt: "Is a frame received on one core mesh PW normally forwarded out another core mesh PW?",
      options: [
        { id: "no", label: "No — mesh-to-mesh is exactly the one case hierarchical split horizon forbids" },
        { id: "yes", label: "Yes, whenever the destination MAC is unknown" },
        { id: "yes-if-spoke-down", label: "Yes, if the destination's own spoke happens to be down" },
        { id: "only-broadcast", label: "Only for broadcast traffic" },
      ],
      correctOptionId: "no",
      explanation: "PE2 never relayed PE1's frame onto MESH_PW: PE3, and PE3 never relayed onto MESH_PW: PE2 — you watched both. This is the one loop-prevention rule H-VPLS keeps from flat VPLS, unchanged: the core mesh must stay loop-free the same way it always did.",
    },
  },
  {
    id: "ce2-replies",
    label: "CE2 Replies To CE1",
    narrative: `CE2 sends Src ${CE_MAC.CE2}, Dst ${CE_MAC.CE1}. MTU1 receives it on AC: CE2.`,
    packet: () => frameOnly("ce2-frame", "CE2", ceFrame("CE2", "CE1", "Reply — CE2 to CE1"), "Ethernet frame toward CE1"),
    run: (state) => ({ state: { ...state, packet: { frame: ceFrame("CE2", "CE1", "Reply — CE2 to CE1"), labels: [] }, packetAt: "CE2", journey: [], floodCopies: undefined }, events: [{ type: "PACKET_SENT", stepId: "ce2-replies", timestamp: Date.now(), message: "CE2 replies toward CE1" }] }),
  },
  {
    id: "mtu1-local-deliver-ce1",
    label: "MTU1: Learn CE2, Deliver To CE1 — Locally",
    narrative: `MTU1 learns ${CE_MAC.CE2} → AC: CE2. It looks up ${CE_MAC.CE1}: already known (learned earlier) → AC: CE1, LOCAL_UNICAST. Exactly one copy, delivered directly. The spoke to PE1 is completely unused for this frame.`,
    packet: (state) => (state.packet ? hvplsPacket("mtu1-ac-in-2", "CE2", "MTU1", "Ethernet frame", "AC", state.packet) : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const { fdb } = learnSourceMac(fdbFor(state, "MTU1"), CE_MAC.CE2, { kind: "AC", peer: "CE2" });
      const lookup = lookupDestinationMac(fdb, CE_MAC.CE1);
      const journey = [{ device: "MTU1" as RouterId, input: "Ethernet frame (unlabeled)", lookup: `Learn ${CE_MAC.CE2} on AC: CE2; look up ${CE_MAC.CE1}: ${lookup.kind} → AC: CE1`, action: "LOCAL_SWITCH" as JourneyAction, output: "Delivered directly to CE1 — spoke PW: MTU1-PE1 UNUSED" }];
      return { state: { ...state, packetAt: "CE1", journey, fdb: { ...state.fdb, MTU1: fdb }, lastDecision: lookup.kind === "LOCAL_UNICAST" ? "LOCAL_UNICAST" : undefined }, events: [{ type: "MAC_LEARNED", stepId: "mtu1-local-deliver-ce1", timestamp: Date.now(), message: `MTU1 learns ${CE_MAC.CE2} and delivers locally to CE1` }] };
    },
    whatChanged: () => [`MTU1 FDB: + ${CE_MAC.CE2} → AC: CE2`, "Delivered CE2 → CE1 with zero spoke/core traversal"],
  },
  {
    id: "send-ce1-to-ce2-2-local",
    label: "CE1 → CE2 Again — Now Fully Local",
    narrative: `Both CE1 and CE2 are now known locally at MTU1. CE1 sends to CE2 again: lookup ${CE_MAC.CE2} → LOCAL_UNICAST → AC: CE2. One local delivery, no flooding, no spoke, no core involvement whatsoever.`,
    packet: () => frameOnly("ce1-frame-2", "CE1", ceFrame("CE1", "CE2", "Second frame — now fully local"), "Ethernet frame toward CE2 (local)"),
    run: (state) => {
      const lookup = lookupDestinationMac(fdbFor(state, "MTU1"), CE_MAC.CE2);
      const journey: JourneyHop[] = [{ device: "MTU1", input: "Ethernet frame", lookup: `FDB hit: ${lookup.kind}`, action: "LOCAL_SWITCH", output: "Delivered directly to CE2 — spoke PW: MTU1-PE1 UNUSED" }];
      return { state: { ...state, packet: { frame: ceFrame("CE1", "CE2", "Second frame — now fully local"), labels: [] }, packetAt: "CE2", journey, floodCopies: undefined, lastDecision: "LOCAL_UNICAST" }, events: [{ type: "PACKET_SENT", stepId: "send-ce1-to-ce2-2-local", timestamp: Date.now(), message: "CE1 sends a second frame toward CE2, now local" }] };
    },
    whatChanged: () => ["CE1 → CE2: fully local switching at MTU1 — no provider-core bandwidth required"],
  },
  {
    id: "signature-local-switching-visual",
    label: "The Signature Visual: Local Switching",
    narrative: "CE1 → MTU1 → CE2. Spoke PW to PE1: UNUSED. Traffic between sites behind the same bridging MTU-s can remain entirely local once learned — one of H-VPLS's biggest practical efficiency wins.",
  },
  {
    id: "predict-local-switching",
    label: "Predict",
    narrative: "Before continuing:",
    question: {
      prompt: "Can two customer sites behind the same bridging MTU-s be switched locally, without ever traversing the spoke PW, once their MACs are learned?",
      options: [
        { id: "yes", label: "Yes — exactly as you just watched" },
        { id: "no-always-spoke", label: "No — every frame must always traverse the spoke to reach the PE-rs for a forwarding decision" },
        { id: "only-broadcast", label: "Only for broadcast traffic, never unicast" },
        { id: "only-first-frame", label: "Only the very first frame; every subsequent frame must use the spoke" },
      ],
      correctOptionId: "yes",
      explanation: "MTU1 is a real, independent bridge with its own FDB — once both MACs are local entries, ordinary known-unicast bridging delivers directly, with zero spoke or core involvement.",
    },
  },
  {
    id: "predict-spoke-failure-preview",
    label: "Predict",
    narrative: "Before continuing:",
    question: {
      prompt: "If MTU1's spoke PW to PE1 failed entirely, would CE1 ↔ CE2 traffic still work?",
      options: [
        { id: "yes", label: "Yes — assuming their local ACs and MTU1's bridge itself remain healthy, local switching doesn't depend on the spoke at all" },
        { id: "no", label: "No — every frame at MTU1 requires the spoke to be up" },
        { id: "only-known", label: "Only already-known traffic — new sources couldn't be learned" },
        { id: "unsure", label: "Impossible to know without more information" },
      ],
      correctOptionId: "yes",
      explanation: "You'll verify this directly later in an optional experiment — but you already have everything you need to answer it: local switching at MTU1 never involved the spoke in the first place.",
    },
  },
  {
    id: "remote-traffic-intro",
    label: "Now, Genuinely Remote Traffic: CE1 → CE3",
    narrative: "CE3 sits behind MTU2 — a different access node entirely, reached only through the core. This is the real test of the hierarchy end to end.",
  },
  {
    id: "send-ce1-to-ce3",
    label: "CE1 Sends A Frame To CE3",
    narrative: `Src ${CE_MAC.CE1}, Dst ${CE_MAC.CE3}. MTU1 receives it on AC: CE1 — already known locally, so this is a REFRESH, not a new learn. ${CE_MAC.CE3} is still unknown everywhere.`,
    packet: () => frameOnly("ce1-frame-3", "CE1", ceFrame("CE1", "CE3", "CE1 to CE3 — genuinely remote"), "Ethernet frame toward CE3"),
    run: (state) => {
      const { fdb } = learnSourceMac(fdbFor(state, "MTU1"), CE_MAC.CE1, { kind: "AC", peer: "CE1" });
      return { state: { ...state, packet: { frame: ceFrame("CE1", "CE3", "CE1 to CE3 — genuinely remote"), labels: [] }, packetAt: "MTU1", journey: [], fdb: { ...state.fdb, MTU1: fdb }, floodCopies: undefined }, events: [{ type: "PACKET_SENT", stepId: "send-ce1-to-ce3", timestamp: Date.now(), message: "CE1 sends Ethernet frame toward CE3" }] };
    },
  },
  {
    id: "mtu1-flood-remote",
    label: "MTU1: Unknown — Flood To AC And Spoke",
    narrative: `Lookup ${CE_MAC.CE3}: UNKNOWN_UNICAST. MTU1 floods to every non-ingress port: [AC: CE2, SPOKE_PW: PE1].`,
    run: (state) => {
      const ports = bridgePortsFor(state, "MTU1");
      const ingress: HvplsPort = { kind: "AC", peer: "CE1" };
      const lookup = lookupDestinationMac(fdbFor(state, "MTU1"), CE_MAC.CE3);
      const raw = computeVplsEgressSet(ports, ingress, lookup);
      const final = applyHierarchicalSplitHorizon(raw, ingress);
      const journey = [{ device: "MTU1" as RouterId, input: CE_MAC.CE3, lookup: `UNKNOWN_UNICAST — egress [${raw.map(portLabel).join(", ")}]`, action: "REPLICATE" as JourneyAction, output: `Flood to: ${final.map(portLabel).join(", ")}` }];
      return { state: { ...state, journey, lastDecision: "UNKNOWN_UNICAST", floodCopies: [{ id: "fc-r-mtu1-ce2", fromId: "MTU1", toId: "CE2" }, { id: "fc-r-mtu1-pe1", fromId: "MTU1", toId: "PE1" }] }, events: [] };
    },
    whatChanged: () => ["MTU1 floods toward CE2 (discards) and into the core via its spoke"],
  },
  {
    id: "pe1-spoke-ingress-relearn-flood",
    label: "PE1: Spoke Ingress, Flood To Both Mesh Peers",
    narrative: `PE1 resolves the spoke label, refreshes ${CE_MAC.CE1} on SPOKE_PW: MTU1, looks up ${CE_MAC.CE3}: still unknown. Ingress spoke → hierarchical split horizon doesn't restrict mesh egress. PE1 floods to MESH_PW: PE2 AND MESH_PW: PE3.`,
    packet: (state) => {
      if (!state.packet) return undefined;
      const withLabels = buildVplsLabelStack(state.packet.frame, allocateSpokeReceiveLabel("PE1", "MTU1"), transportLabelToward("PE1"));
      return hvplsPacket("pe1-spoke-in-r", "MTU1", "PE1", "Spoke label lookup", "SPOKE", withLabels);
    },
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const { fdb } = learnSourceMac(fdbFor(state, "PE1"), CE_MAC.CE1, { kind: "SPOKE_PW", peer: "MTU1" });
      const ports = bridgePortsFor(state, "PE1");
      const ingress: HvplsPort = { kind: "SPOKE_PW", peer: "MTU1" };
      const lookup = lookupDestinationMac(fdb, CE_MAC.CE3);
      const raw = computeVplsEgressSet(ports, ingress, lookup);
      const final = applyHierarchicalSplitHorizon(raw, ingress);
      const journey = [...state.journey, { device: "PE1" as RouterId, input: `label ${allocateSpokeReceiveLabel("PE1", "MTU1")}`, lookup: `Spoke ingress; lookup ${CE_MAC.CE3}: UNKNOWN_UNICAST`, action: "SPOKE_INGRESS" as JourneyAction, output: `Flood to: ${final.map(portLabel).join(", ")}` }];
      return { state: { ...state, packetAt: "PE1", journey, fdb: { ...state.fdb, PE1: fdb }, floodCopies: [{ id: "fc-r-pe1-pe2", fromId: "PE1", toId: "PE2" }, { id: "fc-r-pe1-pe3", fromId: "PE1", toId: "PE3" }] }, events: [] };
    },
    whatChanged: () => ["PE1 floods spoke-ingress traffic to both mesh peers"],
  },
  {
    id: "pe2-mesh-ingress-delivers-ce3",
    label: "PE2: Mesh Ingress — Delivers Down Its Spoke To CE3",
    narrative: `PE2 receives on MESH_PW: PE1. Egress after hierarchical split horizon = [SPOKE_PW: MTU2] only (MESH_PW: PE3 stripped). PE2 forwards down its spoke.`,
    packet: (state) => (state.packet ? hvplsPacket("pe2-mesh-in-r", "PE1", "PE2", "Mesh label lookup", "MESH", state.packet) : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const { fdb } = learnSourceMac(fdbFor(state, "PE2"), CE_MAC.CE1, { kind: "MESH_PW", peer: "PE1" });
      const ports = bridgePortsFor(state, "PE2");
      const ingress: HvplsPort = { kind: "MESH_PW", peer: "PE1" };
      const lookup = lookupDestinationMac(fdb, CE_MAC.CE3);
      const raw = computeVplsEgressSet(ports, ingress, lookup);
      const final = applyHierarchicalSplitHorizon(raw, ingress);
      const withSpokeLabels = buildVplsLabelStack(state.packet.frame, allocateSpokeReceiveLabel("MTU2", "PE2"), transportLabelToward("MTU2"));
      const journey = [...state.journey, { device: "PE2" as RouterId, input: `label ${allocatePwReceiveLabel("PE2", "PE1")}`, lookup: `Mesh ingress; egress [${raw.map(portLabel).join(", ")}] → [${final.map(portLabel).join(", ")}]`, action: "MESH_SPLIT_HORIZON_BLOCK" as JourneyAction, output: `MESH → SPOKE: forward to MTU2 (not to MESH_PW: PE3)` }];
      return { state: { ...state, packet: withSpokeLabels, packetAt: "PE2", journey, fdb: { ...state.fdb, PE2: fdb } }, events: [] };
    },
    whatChanged: () => [`PE2 FDB: + ${CE_MAC.CE1} → MESH_PW: PE1`, "PE2 forwards to MTU2 only — no relay to PE3"],
  },
  {
    id: "mtu2-delivers-ce3",
    label: "MTU2 Delivers To CE3 — The Genuine Destination",
    narrative: `MTU2 pops the transport label, resolves the spoke label, learns ${CE_MAC.CE1} → SPOKE_PW: PE2, looks up ${CE_MAC.CE3}: still unknown to MTU2 too — floods to its only other port, AC: CE3. CE3 receives it — the actual destination, at last.`,
    packet: (state) => (state.packet ? hvplsPacket("mtu2-spoke-in", "PE2", "MTU2", "Spoke label lookup", "SPOKE", state.packet) : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const afterPop = processCoreTransportLabel(state.packet, "IMPLICIT_NULL");
      const { fdb } = learnSourceMac(fdbFor(state, "MTU2"), CE_MAC.CE1, { kind: "SPOKE_PW", peer: "PE2" });
      const journey = [...state.journey, { device: "MTU2" as RouterId, input: `label ${allocateSpokeReceiveLabel("MTU2", "PE2")}`, lookup: `Spoke label → ${SERVICE_NAME}; learn ${CE_MAC.CE1} on SPOKE_PW: PE2; flood to AC: CE3`, action: "AC_EGRESS" as JourneyAction, output: "Delivered to CE3" }];
      return { state: { ...state, packet: afterPop, packetAt: "CE3", journey, fdb: { ...state.fdb, MTU2: fdb } }, events: [{ type: "VPN_PACKET_DELIVERED", stepId: "mtu2-delivers-ce3", timestamp: Date.now(), message: "MTU2 delivers to CE3" }] };
    },
    whatChanged: () => [`MTU2 FDB: + ${CE_MAC.CE1} → SPOKE_PW: PE2`, "CE3 receives the frame"],
  },
  {
    id: "pe3-mtu3-discard-path",
    label: "PE3 Also Received A Direct Mesh Copy — CE4 Discards",
    narrative: "PE3 got its own direct copy from PE1 (never via PE2, by the same mesh split-horizon rule), forwarded it down its spoke to MTU3, which flooded to CE4. CE4 discards — wrong destination MAC, ordinary Ethernet behavior.",
    run: (state) => {
      const { fdb: fdbPe3 } = learnSourceMac(fdbFor(state, "PE3"), CE_MAC.CE1, { kind: "MESH_PW", peer: "PE1" });
      const { fdb: fdbMtu3 } = learnSourceMac(fdbFor(state, "MTU3"), CE_MAC.CE1, { kind: "SPOKE_PW", peer: "PE3" });
      return { state: { ...state, fdb: { ...state.fdb, PE3: fdbPe3, MTU3: fdbMtu3 }, floodCopies: undefined }, events: [] };
    },
    whatChanged: () => [`PE3 FDB: + ${CE_MAC.CE1} → MESH_PW: PE1`, `MTU3 FDB: + ${CE_MAC.CE1} → SPOKE_PW: PE3`, "CE4 discards — wrong destination MAC"],
  },
  {
    id: "ce3-responds",
    label: "CE3 Responds To CE1",
    narrative: `CE3 sends Src ${CE_MAC.CE3}, Dst ${CE_MAC.CE1}. MTU2 receives it on AC: CE3.`,
    packet: () => frameOnly("ce3-frame", "CE3", ceFrame("CE3", "CE1", "Reply — CE3 to CE1"), "Ethernet frame toward CE1"),
    run: (state) => ({ state: { ...state, packet: { frame: ceFrame("CE3", "CE1", "Reply — CE3 to CE1"), labels: [] }, packetAt: "CE3", journey: [], floodCopies: undefined }, events: [{ type: "PACKET_SENT", stepId: "ce3-responds", timestamp: Date.now(), message: "CE3 replies toward CE1" }] }),
  },
  {
    id: "known-unicast-hierarchy-path",
    label: "Known Unicast, Hierarchically: MTU2 → PE2 → PE1 → MTU1 → CE1",
    narrative: `MTU2 learns ${CE_MAC.CE3} → AC: CE3, looks up ${CE_MAC.CE1}: REMOTE_UNICAST → SPOKE_PW: PE2 (already known). PE2 looks up ${CE_MAC.CE1}: known → MESH_PW: PE1 directly (not via PE3). PE1 looks up ${CE_MAC.CE1}: known → SPOKE_PW: MTU1. MTU1 looks up ${CE_MAC.CE1}: LOCAL_UNICAST → AC: CE1. Every hop is now a single, direct copy — no flooding anywhere on this path.`,
    packet: (state) => (state.packet ? hvplsPacket("ce3-known-path", "MTU2", "MTU1", "Known unicast — spoke → mesh → spoke", "PUSH", state.packet) : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const { fdb: fdbMtu2 } = learnSourceMac(fdbFor(state, "MTU2"), CE_MAC.CE3, { kind: "AC", peer: "CE3" });
      const { fdb: fdbPe2 } = learnSourceMac(fdbFor(state, "PE2"), CE_MAC.CE3, { kind: "SPOKE_PW", peer: "MTU2" });
      const { fdb: fdbPe1 } = learnSourceMac(fdbFor(state, "PE1"), CE_MAC.CE3, { kind: "MESH_PW", peer: "PE2" });
      const { fdb: fdbMtu1 } = learnSourceMac(fdbFor(state, "MTU1"), CE_MAC.CE3, { kind: "SPOKE_PW", peer: "PE1" });
      const delivered = deliverEthernetFrame(state.packet);
      const journey: JourneyHop[] = [
        { device: "MTU2", input: "Ethernet frame", lookup: `Learn ${CE_MAC.CE3} on AC: CE3; lookup ${CE_MAC.CE1}: REMOTE_UNICAST → SPOKE_PW: PE2`, action: "PUSH_SPOKE", output: "Single copy toward PE2" },
        { device: "PE2", input: `label ${allocateSpokeReceiveLabel("PE2", "MTU2")}`, lookup: `Learn ${CE_MAC.CE3} on SPOKE_PW: MTU2; lookup ${CE_MAC.CE1}: REMOTE_UNICAST → MESH_PW: PE1`, action: "PUSH_MESH", output: "Single copy directly to PE1 — not via PE3" },
        { device: "PE1", input: `label ${allocatePwReceiveLabel("PE1", "PE2")}`, lookup: `Learn ${CE_MAC.CE3} on MESH_PW: PE2; lookup ${CE_MAC.CE1}: REMOTE_UNICAST → SPOKE_PW: MTU1`, action: "PUSH_SPOKE", output: "Single copy down its spoke" },
        { device: "MTU1", input: `label ${allocateSpokeReceiveLabel("MTU1", "PE1")}`, lookup: `Learn ${CE_MAC.CE3} on SPOKE_PW: PE1; lookup ${CE_MAC.CE1}: LOCAL_UNICAST → AC: CE1`, action: "AC_EGRESS", output: "Delivered to CE1" },
      ];
      return { state: { ...state, packet: { frame: delivered, labels: [] }, packetAt: "CE1", journey, fdb: { ...state.fdb, MTU2: fdbMtu2, PE2: fdbPe2, PE1: fdbPe1, MTU1: fdbMtu1 }, lastDecision: "REMOTE_UNICAST" }, events: [{ type: "VPN_PACKET_DELIVERED", stepId: "known-unicast-hierarchy-path", timestamp: Date.now(), message: "Known-unicast hierarchical delivery: MTU2 → PE2 → PE1 → MTU1 → CE1" }] };
    },
    whatChanged: () => ["CE3 → CE1 delivered as known unicast — spoke → mesh → spoke, single copies throughout"],
  },
  {
    id: "mac-tables-hierarchical-perspectives",
    label: "Same MAC, Different Hierarchical Perspectives",
    narrative: `${CE_MAC.CE1}'s FDB entry looks different at every device that has learned it: at MTU1 it's a local AC; at PE1 it's SPOKE_PW: MTU1; at PE2 and PE3 it's MESH_PW: PE1; at MTU2 and MTU3 it's SPOKE_PW: PE2/PE3 respectively. These are independently learned, never synchronized by any control-plane mechanism — exactly like flat VPLS.`,
  },
  {
    id: "predict-fdb-sync",
    label: "Predict",
    narrative: "Before continuing:",
    question: {
      prompt: "Do MTU1, PE1, PE2, PE3, MTU2, and MTU3's FDBs ever get automatically synchronized with each other?",
      options: [
        { id: "no", label: "No — every device's FDB is learned entirely independently from the traffic it personally observes" },
        { id: "yes-ldp", label: "Yes — targeted LDP synchronizes every device's FDB mesh-wide" },
        { id: "yes-spoke-only", label: "Yes, but only between an MTU-s and its own PE-rs" },
        { id: "yes-periodic", label: "Yes, via a periodic background sync process" },
      ],
      correctOptionId: "no",
      explanation: "H-VPLS inherits flat VPLS's defining characteristic: every bridge's FDB is a purely local, data-plane-learned table. Nothing distributes or synchronizes MAC reachability across devices — not even between a spoke's two endpoints.",
    },
  },
  {
    id: "ce1-to-ce4-intro",
    label: "One More Comparison: CE1 → CE4",
    narrative: "CE4 sits behind MTU3 — a DIFFERENT core mesh leg than CE3. CE4 has never sourced traffic, so its MAC is still unknown everywhere, even though MTU3 already relayed one discarded copy to it earlier.",
  },
  {
    id: "send-ce1-to-ce4",
    label: "CE1 Sends To CE4 — Unknown, Different Leg",
    narrative: `MTU1 floods to AC: CE2 and SPOKE_PW: PE1 (as always for unknown). PE1 floods to both mesh peers. This time PE3's copy is the one that finds its real destination: PE3 → MTU3 → CE4.`,
    packet: () => frameOnly("ce1-frame-4", "CE1", ceFrame("CE1", "CE4", "CE1 to CE4 — different core leg"), "Ethernet frame toward CE4"),
    run: (state) => {
      const { fdb } = learnSourceMac(fdbFor(state, "MTU1"), CE_MAC.CE1, { kind: "AC", peer: "CE1" });
      return { state: { ...state, packet: { frame: ceFrame("CE1", "CE4", "CE1 to CE4 — different core leg"), labels: [] }, packetAt: "MTU3", journey: [{ device: "MTU1", input: "Ethernet frame", lookup: "Flood — unknown", action: "REPLICATE", output: "Flood to AC: CE2, SPOKE_PW: PE1" }, { device: "PE1", input: CE_MAC.CE4, lookup: "Spoke ingress, unknown — flood to both mesh peers", action: "SPOKE_INGRESS", output: "Flood to MESH_PW: PE2, MESH_PW: PE3" }, { device: "PE3", input: CE_MAC.CE4, lookup: "Mesh ingress — egress restricted to SPOKE_PW: MTU3 only", action: "MESH_SPLIT_HORIZON_BLOCK", output: "Forward to MTU3" }, { device: "MTU3", input: CE_MAC.CE4, lookup: "Flood to AC: CE4 — genuine destination", action: "AC_EGRESS", output: "Delivered to CE4" }], fdb: { ...state.fdb, MTU1: fdb } }, events: [{ type: "VPN_PACKET_DELIVERED", stepId: "send-ce1-to-ce4", timestamp: Date.now(), message: "CE1 → CE4 delivered via the PE1-PE3 mesh leg and MTU3's spoke" }] };
    },
    whatChanged: () => ["CE1 → CE4 reaches its destination via a completely different core mesh leg than CE1 → CE3 did"],
  },
  {
    id: "ce4-replies-known",
    label: "CE4 Replies — Learned And Delivered",
    narrative: "CE4's reply teaches MTU3, PE3, PE1, and MTU1 exactly like CE3's reply did for the PE2 leg. Every subsequent CE1 ↔ CE4 frame becomes known unicast too.",
    run: (state) => {
      const { fdb: fdbMtu3 } = learnSourceMac(fdbFor(state, "MTU3"), CE_MAC.CE4, { kind: "AC", peer: "CE4" });
      const { fdb: fdbPe3 } = learnSourceMac(fdbFor(state, "PE3"), CE_MAC.CE4, { kind: "SPOKE_PW", peer: "MTU3" });
      const { fdb: fdbPe1 } = learnSourceMac(fdbFor(state, "PE1"), CE_MAC.CE4, { kind: "MESH_PW", peer: "PE3" });
      const { fdb: fdbMtu1 } = learnSourceMac(fdbFor(state, "MTU1"), CE_MAC.CE4, { kind: "SPOKE_PW", peer: "PE1" });
      return { state: { ...state, fdb: { ...state.fdb, MTU3: fdbMtu3, PE3: fdbPe3, PE1: fdbPe1, MTU1: fdbMtu1 }, packetAt: "CE1" }, events: [] };
    },
    whatChanged: () => ["CE1 ↔ CE4 now fully known, hierarchical, single-copy end to end"],
  },
  {
    id: "compare-local-vs-remote",
    label: "Recap: Local vs. Remote, Compared",
    narrative: "CE1 ↔ CE2: fully local at MTU1, spoke never touched. CE1 ↔ CE3: spoke (MTU1→PE1) → mesh (PE1→PE2) → spoke (PE2→MTU2). CE1 ↔ CE4: spoke (MTU1→PE1) → a DIFFERENT mesh leg (PE1→PE3) → spoke (PE3→MTU3). Three genuinely different paths, one consistent set of forwarding rules.",
  },
  {
    id: "scaling-lab-intro",
    label: "The Scaling Lab",
    narrative: `This topology: 3 core PE-rs + 3 access MTU-s = ${calculateHierarchicalPwCount(3, 3)} pseudowires (calculateHierarchicalPwCount(3,3)) vs. a flat mesh of the same 6 devices = ${calculateFullMeshPwCount(6)} (calculateFullMeshPwCount(6)). Use the interactive lab below to vary access-node and core-PE-rs counts and see how the two curves diverge.`,
  },
  {
    id: "why-access-scales-better",
    label: "Why Access Nodes Scale Better",
    narrative: "An MTU-s only ever needs to know its own local customer ports and its one spoke relationship — never a direct PW to every other access device. Adding a 100th MTU-s costs exactly one new spoke, not 99 new pseudowires.",
  },
  {
    id: "core-still-has-responsibility",
    label: "The Core Still Does Real Work",
    narrative: "Hierarchy restructures scale — it doesn't eliminate service state. Every PE-rs still performs full VPLS bridging, still participates in the core mesh, still learns remote MACs, still replicates BUM traffic, and still aggregates its attached spokes. H-VPLS moves where complexity lives; it doesn't make it disappear.",
  },
  {
    id: "flat-vs-hvpls-comparison",
    label: "Flat VPLS vs. H-VPLS",
    narrative: "FLAT VPLS: every participating PE is part of one full mesh; no hierarchy. H-VPLS: access MTU-s nodes spoke toward a hub; PE-rs nodes maintain a smaller core full mesh. Same Ethernet bridging model underneath both — MAC learning, flooding, split horizon (generalized) — just restructured across two tiers.",
  },
  {
    id: "bgp-vpls-orthogonality",
    label: "H-VPLS vs. BGP-Signaled VPLS",
    narrative: "These answer different questions and are NOT the same axis: H-VPLS is about SERVICE TOPOLOGY hierarchy (how many PWs, how they're tiered). BGP-signaled VPLS is about SIGNALING/DISCOVERY (how PWs get set up). Using BGP to signal a service does not automatically make it hierarchical, and building an H-VPLS hierarchy doesn't require BGP — this lesson kept the same LDP-style signaling from earlier lessons throughout.",
  },
  {
    id: "evpn-preview",
    label: "A Brief Look Ahead: EVPN",
    narrative: "H-VPLS still fundamentally uses traditional VPLS bridging — data-plane MAC learning, flooding-based discovery, PW-role-based split horizon. EVPN introduces a genuinely different BGP-based Ethernet control plane (MAC/IP routes, ARP suppression, sequence-numbered mobility) that the next lesson covers in full — not built here.",
  },
  {
    id: "troubleshooting-intro",
    label: "INCIDENT",
    narrative: "CE1 ↔ CE2 (both behind MTU1) works perfectly. But CE1 and CE2 cannot reliably reach any remote site. All pseudowires show UP — spoke and mesh alike. MPLS transport is healthy. PE1's MAC table is actively learning.",
    run: (state) => ({ state: { ...state, troubleshooting: { ...state.troubleshooting, started: true } }, events: [] }),
  },
  {
    id: "fault-injection",
    label: "Fault: PE1 Misclassifies Its Spoke As A Mesh PW",
    narrative: "PE1's relationship to MTU1 gets misconfigured — its bridge port role for that pseudowire is recorded as MESH_PW instead of SPOKE_PW. The underlying spoke pseudowire itself stays completely healthy: signaling operational, labels valid, state UP. Only PE1's forwarding-policy CLASSIFICATION of that port is wrong.",
    run: (state) => ({
      state: { ...state, spokeRoleByPe: { ...state.spokeRoleByPe, PE1: "MESH_PW" }, fdb: { MTU1: [], MTU2: [], MTU3: [], PE1: [], PE2: [], PE3: [] }, journey: [], packet: undefined, packetAt: undefined, floodCopies: undefined },
      events: [{ type: "LDP_SESSION_RESET", stepId: "fault-injection", timestamp: Date.now(), message: "PE1 reclassifies its MTU1 spoke as MESH_PW — the pseudowire itself stays UP" }],
    }),
    whatChanged: () => ["PE1's port toward MTU1: SPOKE_PW → MESH_PW (classification only — the PW is still UP)", "FDB tables reset for a clean diagnostic run"],
  },
  {
    id: "why-local-still-works",
    label: "Why CE1 ↔ CE2 Still Works",
    narrative: "MTU1's own bridge is completely unaffected by PE1's misconfiguration — the fault lives entirely at PE1, one hop further out. Local switching between CE1 and CE2 never reaches PE1 at all, so it keeps working perfectly. This is what makes the incident diagnostically interesting.",
  },
  {
    id: "demonstrate-fault",
    label: "Demonstrate: CE1 → CE3, During The Incident",
    narrative: `Send a fresh frame CE1 → CE3. MTU1 floods normally — its spoke to PE1 is still UP, so a copy still reaches PE1 fine.`,
    packet: () => frameOnly("fault-frame", "CE1", ceFrame("CE1", "CE3", "CE1 to CE3 — during the incident"), "Ethernet frame toward CE3"),
    run: (state) => {
      const { fdb } = learnSourceMac(fdbFor(state, "MTU1"), CE_MAC.CE1, { kind: "AC", peer: "CE1" });
      const journey: JourneyHop[] = [{ device: "MTU1", input: "Ethernet frame", lookup: "Flood — unknown destination", action: "REPLICATE", output: "Flood to AC: CE2, SPOKE_PW: PE1 — spoke still UP, frame arrives at PE1 fine" }];
      return { state: { ...state, packet: { frame: ceFrame("CE1", "CE3", "CE1 to CE3 — during the incident"), labels: [] }, packetAt: "PE1", journey, fdb: { ...state.fdb, MTU1: fdb } }, events: [] };
    },
    whatChanged: () => ["MTU1 → PE1: delivered normally — the spoke pseudowire itself was never the problem"],
  },
  {
    id: "signature-fault-visual",
    label: "PE1 Cannot Relay — Because It Thinks This Is A Mesh Port",
    narrative: `PE1 learns ${CE_MAC.CE1} on what it now believes is a MESH_PW, looks up ${CE_MAC.CE3}: UNKNOWN_UNICAST. Raw egress = [MESH_PW: PE2, MESH_PW: PE3] (both classified as mesh; PE1's OWN spoke-facing port is also now misclassified as MESH_PW). Ingress kind = MESH_PW → hierarchical split horizon strips EVERY mesh-classified port from egress, including PE2 and PE3. Final egress = []. Decision: SPLIT_HORIZON_BLOCKED. No remote site receives this frame — not because any pseudowire is down, but because PE1's OWN classification of its spoke made the correct SPOKE → MESH rule inapplicable.`,
    packet: (state) => (state.packet ? hvplsPacket("fault-pe1-in", "MTU1", "PE1", "Spoke label lookup (misclassified)", "SPOKE", state.packet) : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const { fdb } = learnSourceMac(fdbFor(state, "PE1"), CE_MAC.CE1, { kind: state.spokeRoleByPe.PE1, peer: "MTU1" });
      const ports = bridgePortsFor(state, "PE1");
      const ingress: HvplsPort = { kind: state.spokeRoleByPe.PE1, peer: "MTU1" };
      const lookup = lookupDestinationMac(fdb, CE_MAC.CE3);
      const raw = computeVplsEgressSet(ports, ingress, lookup);
      const final = applyHierarchicalSplitHorizon(raw, ingress);
      const decision = classifyHvplsForwardingDecision(lookup, raw, final);
      const journey = [...state.journey, { device: "PE1" as RouterId, input: `label ${allocateSpokeReceiveLabel("PE1", "MTU1")}`, lookup: `Ingress classified as ${ingress.kind} (should be SPOKE_PW); egress [${raw.map(portLabel).join(", ")}] → [${final.map(portLabel).join(", ") || "(none)"}]`, action: "MESH_SPLIT_HORIZON_BLOCK" as JourneyAction, output: `${CE_MAC.CE3} unreachable via PE1 — no remote site receives this frame` }];
      return { state: { ...state, packetAt: "PE1", journey, fdb: { ...state.fdb, PE1: fdb }, lastDecision: decision }, events: [{ type: "PACKET_DROPPED", stepId: "signature-fault-visual", timestamp: Date.now(), message: "PE1 cannot relay its own misclassified spoke onto the mesh — every mesh-classified port is excluded, including the spoke itself" }] };
    },
    whatChanged: () => ["Decision: SPLIT_HORIZON_BLOCKED — no remote site receives the frame"],
  },
  {
    id: "diagnostic-ladder",
    label: "Diagnose Before You Fix",
    narrative: "Work the ladder bottom-up: interfaces, transport, spoke PW state, mesh PW state, MAC learning, and only then the specific port-role classification. Don't assume a link-down/session-down fault just because remote traffic fails — this incident proves everything underneath can be perfectly healthy.",
  },
  {
    id: "trouble-question",
    label: "Diagnose The Incident",
    narrative: "Based on everything you've observed:",
    question: {
      prompt: "What is actually wrong at PE1?",
      hints: ["Every pseudowire — spoke and mesh alike — shows UP.", "PE1's MAC table is actively learning new entries.", "Local CE1 ↔ CE2 traffic at MTU1 is completely unaffected — the fault is not at MTU1 at all.", "The frame reaches PE1 just fine. The problem is what PE1 does with it once it's there."],
      options: [
        { id: "role-misclassified", label: "PE1's port toward MTU1 is classified as MESH_PW instead of SPOKE_PW, so hierarchical split horizon incorrectly blocks its own spoke egress too" },
        { id: "spoke-pw-down", label: "The spoke pseudowire MTU1-PE1 is down" },
        { id: "split-horizon-disabled", label: "Split horizon has been disabled mesh-wide" },
        { id: "vlan-mismatch", label: "CE3's VLAN tag no longer matches MTU2's configuration" },
      ],
      correctOptionId: "role-misclassified",
      explanation: "The spoke PW is genuinely UP — you watched MTU1's flood reach PE1 normally. The failure is purely a forwarding-POLICY misclassification: PE1 believes its MTU1-facing port is a mesh port, so the mesh-only split-horizon rule now (incorrectly) also blocks that port's own egress.",
    },
  },
  {
    id: "repair-challenge",
    label: "Engineer Challenge: Restore Remote Reachability",
    narrative: "Choose the correct repair.",
    action: (state, payload) => {
      const choice = (payload as { choice?: string } | undefined)?.choice ?? "";
      if (choice !== "reclassify-pe1-spoke") {
        return { state: { ...state, troubleshooting: { ...state.troubleshooting, repairAttempt: { choice, correct: false } } }, events: [] };
      }
      return {
        state: { ...state, spokeRoleByPe: { ...state.spokeRoleByPe, PE1: "SPOKE_PW" }, troubleshooting: { ...state.troubleshooting, repairAttempt: { choice, correct: true }, repaired: true } },
        events: [{ type: "VPN_ROUTE_INSTALLED", stepId: "repair-challenge", timestamp: Date.now(), message: "PE1's port toward MTU1 reclassified as SPOKE_PW" }],
      };
    },
    requiresState: (state) => state.troubleshooting.repaired === true,
  },
  {
    id: "repaired-recompute",
    label: "PE1's Spoke Role Restored — Verify Next",
    narrative: "PE1's port toward MTU1 is SPOKE_PW again. But recomputation alone isn't proof — verify with a real end-to-end frame next, exactly like every prior lesson's repair discipline.",
    run: (state) => ({ state: { ...state, packet: undefined, packetAt: undefined, journey: [], floodCopies: undefined, fdb: { MTU1: [], MTU2: [], MTU3: [], PE1: [], PE2: [], PE3: [] } }, events: [] }),
    whatChanged: () => ["FDBs cleared for a clean verification run"],
  },
  {
    id: "verify-send-ce1-ce3",
    label: "Mandatory Verification: Resend CE1 → CE3",
    narrative: "Send a real frame end to end and follow every hop, exactly like the prior lessons' repair-verification discipline.",
    packet: () => frameOnly("verify-frame", "CE1", ceFrame("CE1", "CE3", "Verification — CE1 to CE3"), "Ethernet frame toward CE3 (verification)"),
    run: (state) => {
      const { fdb } = learnSourceMac(fdbFor(state, "MTU1"), CE_MAC.CE1, { kind: "AC", peer: "CE1" });
      return { state: { ...state, packet: { frame: ceFrame("CE1", "CE3", "Verification — CE1 to CE3"), labels: [] }, packetAt: "MTU1", journey: [], fdb: { ...state.fdb, MTU1: fdb } }, events: [] };
    },
  },
  {
    id: "verify-spoke-to-mesh-restored",
    label: "PE1: SPOKE → MESH Works Again",
    narrative: `PE1's ingress port toward MTU1 is now correctly classified SPOKE_PW. Split horizon no longer restricts it — PE1 floods to both mesh peers again.`,
    packet: (state) => (state.packet ? hvplsPacket("verify-pe1-flood", "MTU1", "PE1", "Spoke label lookup (repaired)", "SPOKE", state.packet) : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const { fdb } = learnSourceMac(fdbFor(state, "PE1"), CE_MAC.CE1, { kind: "SPOKE_PW", peer: "MTU1" });
      const ports = bridgePortsFor(state, "PE1");
      const ingress: HvplsPort = { kind: "SPOKE_PW", peer: "MTU1" };
      const lookup = lookupDestinationMac(fdb, CE_MAC.CE3);
      const raw = computeVplsEgressSet(ports, ingress, lookup);
      const final = applyHierarchicalSplitHorizon(raw, ingress);
      const journey = [...state.journey, { device: "PE1" as RouterId, input: `label ${allocateSpokeReceiveLabel("PE1", "MTU1")}`, lookup: `Ingress correctly classified SPOKE_PW; egress [${raw.map(portLabel).join(", ")}]`, action: "SPOKE_INGRESS" as JourneyAction, output: `Flood to: ${final.map(portLabel).join(", ")}` }];
      return { state: { ...state, packetAt: "PE1", journey, fdb: { ...state.fdb, PE1: fdb }, floodCopies: [{ id: "fc-v-pe1-pe2", fromId: "PE1", toId: "PE2" }, { id: "fc-v-pe1-pe3", fromId: "PE1", toId: "PE3" }] }, events: [] };
    },
    whatChanged: () => ["PE1 floods to both mesh peers again — the repair, not a relaxed split-horizon rule, fixed this"],
  },
  {
    id: "verify-delivered-ce3",
    label: "CE3 Receives — Verified",
    narrative: "PE2 receives on the mesh, forwards down its spoke; MTU2 delivers to CE3. The repaired classification, not a globally disabled split horizon, is what restored connectivity.",
    packet: (state) => (state.packet ? frameOnly("verify-delivered", "MTU2", deliverEthernetFrame(state.packet), "Delivered to CE3 (verified)") : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const { fdb: fdbPe2 } = learnSourceMac(fdbFor(state, "PE2"), CE_MAC.CE1, { kind: "MESH_PW", peer: "PE1" });
      const { fdb: fdbMtu2 } = learnSourceMac(fdbFor(state, "MTU2"), CE_MAC.CE1, { kind: "SPOKE_PW", peer: "PE2" });
      const journey = [
        ...state.journey,
        { device: "PE2" as RouterId, input: `label ${allocatePwReceiveLabel("PE2", "PE1")}`, lookup: "Mesh ingress → spoke egress toward MTU2", action: "MESH_SPLIT_HORIZON_BLOCK" as JourneyAction, output: "Forward to MTU2" },
        { device: "MTU2" as RouterId, input: `label ${allocateSpokeReceiveLabel("MTU2", "PE2")}`, lookup: `Learn ${CE_MAC.CE1} on SPOKE_PW: PE2; flood to AC: CE3`, action: "AC_EGRESS" as JourneyAction, output: "Delivered to CE3" },
      ];
      return { state: { ...state, packet: { frame: deliverEthernetFrame(state.packet), labels: [] }, packetAt: "CE3", journey, fdb: { ...state.fdb, PE2: fdbPe2, MTU2: fdbMtu2 }, troubleshooting: { ...state.troubleshooting, verified: true } }, events: [{ type: "VPN_PACKET_DELIVERED", stepId: "verify-delivered-ce3", timestamp: Date.now(), message: "Verified: CE1 → CE3 restored end to end" }] };
    },
    whatChanged: () => ["Verified: MTU1 → PE1 → PE2 → MTU2 → CE3 restored end to end"],
  },
  {
    id: "optional-spoke-failure-intro",
    label: "Optional Experiment: A Real Spoke Failure",
    narrative: "Separate from the repaired incident — what happens if MTU1's spoke to PE1 fails outright (a real link/PW failure this time, not a misclassification)? Keep the core mesh healthy and watch what survives.",
  },
  {
    id: "fail-mtu1-spoke",
    label: "Fail Spoke PW: MTU1-PE1",
    narrative: "The physical/PW-state spoke between MTU1 and PE1 goes genuinely down this time.",
    run: (state) => ({ state: { ...state, spokeLinks: state.spokeLinks.map((l) => (l.id === "MTU1-PE1" ? { ...l, up: false } : l)), troubleshooting: { ...state.troubleshooting, spokeFailureStarted: true } }, events: [{ type: "LDP_SESSION_RESET", stepId: "fail-mtu1-spoke", timestamp: Date.now(), message: "Spoke PW MTU1-PE1: UP → DOWN" }] }),
    whatChanged: () => ["Spoke PW MTU1-PE1: UP → DOWN — a genuine link failure, core mesh unaffected"],
  },
  {
    id: "local-survival-demo",
    label: "CE1 ↔ CE2: Still Locally Switchable",
    narrative: "MTU1's own bridge and its two ACs are completely unaffected by the spoke's failure. CE1 ↔ CE2 traffic, once learned, keeps switching locally — exactly as predicted earlier. Remote sites (CE3, CE4), however, become unreachable from CE1/CE2: MTU1's only path out is gone.",
    run: (state) => {
      const ports = bridgePortsFor(state, "MTU1");
      const journey: JourneyHop[] = [{ device: "MTU1", input: CE_MAC.CE2, lookup: `Bridge ports now: [${ports.map(portLabel).join(", ")}] — SPOKE_PW: PE1 absent`, action: "LOCAL_SWITCH", output: "CE1 ↔ CE2 still delivered directly — no dependency on the spoke" }];
      return { state: { ...state, journey }, events: [] };
    },
    whatChanged: () => ["CE1 ↔ CE2 local switching survives the spoke failure intact"],
  },
  {
    id: "predict-spoke-failure-confirmed",
    label: "Predict",
    narrative: "Before continuing:",
    question: {
      prompt: "With MTU1's spoke down, can CE1 ↔ CE2 traffic still be locally switched by MTU1?",
      options: [
        { id: "yes", label: "Yes, assuming their local ACs and MTU1's bridge itself remain operational" },
        { id: "no", label: "No — a bridge cannot forward at all once any one of its ports fails" },
        { id: "only-broadcast-survives", label: "Only broadcast/ARP traffic survives; unicast requires the spoke" },
        { id: "depends-on-pe1", label: "It depends on whether PE1 itself is still reachable through some other path" },
      ],
      correctOptionId: "yes",
      explanation: "You just watched it happen. Local switching at MTU1 never depended on the spoke — losing the spoke removes reachability to remote sites only, not local bridging between CE1 and CE2.",
    },
  },
  {
    id: "restore-spoke",
    label: "Restore Spoke PW: MTU1-PE1",
    narrative: "The spoke comes back up. Full hierarchical reachability is restored.",
    run: (state) => ({ state: { ...state, spokeLinks: state.spokeLinks.map((l) => (l.id === "MTU1-PE1" ? { ...l, up: true } : l)), troubleshooting: { ...state.troubleshooting, spokeFailureRestored: true } }, events: [{ type: "VPN_ROUTE_INSTALLED", stepId: "restore-spoke", timestamp: Date.now(), message: "Spoke PW MTU1-PE1: DOWN → UP" }] }),
    whatChanged: () => ["Spoke PW MTU1-PE1: DOWN → UP — hierarchy fully restored"],
  },
  {
    id: "engineer-challenge-intro",
    label: "Engineer Challenge: Scale The Virtual LAN",
    narrative: `Recap and confirm: extend ${SERVICE_NAME} across three access MTU-s without ever adding an MTU-s to the core full-mesh PW topology. Everything below was already demonstrated in this lesson — this is the checklist.`,
  },
  {
    id: "engineer-challenge-confirm",
    label: "Confirm Full H-VPLS Coverage",
    narrative: "Core PE-rs full mesh built (3 PWs) ✓ · Access MTU-s spokes established, one per MTU-s (3 PWs) ✓ · Bridge port roles (AC/SPOKE_PW/MESH_PW) classified correctly at every device ✓ · Directional labels verified on both spoke and mesh legs ✓ · Local CE1↔CE2 switching at MTU1 verified — spoke unused ✓ · SPOKE → MESH replication observed at PE1 ✓ · MESH → SPOKE delivery observed at PE2 and PE3 ✓ · MESH → MESH blocking verified (mesh split horizon intact) ✓ · Remote MACs learned hierarchically at every tier ✓ · Known-unicast hierarchical delivery (spoke → mesh → spoke) verified ✓ · PW-count scaling compared against flat VPLS ✓ · Misclassified-spoke incident diagnosed and correctly repaired — never by disabling split horizon globally ✓ · Repair verified with a real end-to-end frame ✓.",
    requiresState: (state) => state.troubleshooting.verified === true,
  },
  {
    id: "complete",
    label: "Complete",
    narrative: `You built Hierarchical VPLS: a full core mesh among PE-rs hubs, one spoke pseudowire per access MTU-s, role-aware bridge ports (AC / SPOKE_PW / MESH_PW), and the generalized split-horizon rule that only forbids mesh-to-mesh relay — never spoke-to-mesh or mesh-to-spoke. You proved local switching stays local, watched a frame cross spoke → mesh → spoke end to end, diagnosed a spoke misclassified as a mesh port, and repaired it correctly. +${HVPLS_XP_AWARD} XP awarded.`,
  },
];

function stepIdx(id: string): number {
  return hVplsSteps.findIndex((s) => s.id === id);
}
export const STEP_IDX = {
  topologyIntro: stepIdx("topology-intro"),
  transportRecap: stepIdx("transport-recap"),
  coreMeshIntro: stepIdx("core-mesh-intro"),
  spokePwIntro: stepIdx("spoke-pw-intro"),
  bridgePortsMtu1: stepIdx("bridge-ports-mtu1"),
  readyButEmpty: stepIdx("ready-but-empty"),
  localSwitchingIntro: stepIdx("local-switching-intro"),
  sendCe1ToCe21: stepIdx("send-ce1-to-ce2-1"),
  signatureLocalSwitchingVisual: stepIdx("signature-local-switching-visual"),
  remoteTrafficIntro: stepIdx("remote-traffic-intro"),
  scalingLabIntro: stepIdx("scaling-lab-intro"),
  troubleshootingIntro: stepIdx("troubleshooting-intro"),
  faultInjection: stepIdx("fault-injection"),
  diagnosticLadder: stepIdx("diagnostic-ladder"),
  repairChallenge: stepIdx("repair-challenge"),
  optionalSpokeFailureIntro: stepIdx("optional-spoke-failure-intro"),
  engineerChallengeIntro: stepIdx("engineer-challenge-intro"),
  complete: stepIdx("complete"),
};

// ---------------------------------------------------------------------------
// CLI perspectives — CONCEPT / Cisco IOS-XR / Junos.
// ---------------------------------------------------------------------------
export interface HvplsCliVendorOutput {
  cmd: string;
  output: string;
}
export interface HvplsCliEntry {
  id: string;
  label: string;
  concept: string;
  cisco: HvplsCliVendorOutput;
  juniper: HvplsCliVendorOutput;
}
export function buildHvplsCliCommands(state: HvplsState, router: RouterId): HvplsCliEntry[] {
  if (router.startsWith("MTU")) {
    const mtu = router as MtuId;
    const acs = resolveAttachmentCircuits(state.acs, mtu);
    const pair = spokePairFor(mtu);
    const fdb = fdbFor(state, mtu);
    return [
      {
        id: "acs",
        label: "Attachment Circuits",
        concept: "Local customer-facing ports on this access bridge.",
        cisco: { cmd: "show bridge-domain", output: acs.map((a) => `${a.interfaceName}: ${a.ceRouter} (${a.up ? "up" : "down"})`).join("\n") || "(none)" },
        juniper: { cmd: "show bridge domain", output: acs.map((a) => `interface ${a.interfaceName} { ce ${a.ceRouter}; state ${a.up ? "up" : "down"}; }`).join("\n") || "(none)" },
      },
      {
        id: "spoke",
        label: "Spoke Pseudowire",
        concept: `This MTU-s's single spoke PW toward its PE-rs hub — an access-tier pseudowire, structurally identical signaling to a mesh PW, different bridging role.`,
        cisco: { cmd: `show xconnect all`, output: `${pair.id}: ${spokeUp(state.spokeLinks, mtu) ? "UP" : "DOWN"} — local label ${allocateSpokeReceiveLabel(mtu, pair.pe)}, remote label ${allocateSpokeReceiveLabel(pair.pe, mtu)}` },
        juniper: { cmd: `show vpls connections`, output: `neighbor ${ROUTER_LOOPBACK[pair.pe]} { spoke; state ${spokeUp(state.spokeLinks, mtu) ? "Up" : "Down"}; local-label ${allocateSpokeReceiveLabel(mtu, pair.pe)}; remote-label ${allocateSpokeReceiveLabel(pair.pe, mtu)}; }` },
      },
      {
        id: "fdb",
        label: "MAC Table",
        concept: "Locally-learned source MACs, AC or spoke alike.",
        cisco: { cmd: "show bridge-domain mac address-table", output: fdb.length ? fdb.map((e) => `${e.mac}  ${e.port.kind}: ${e.port.peer}`).join("\n") : "(empty)" },
        juniper: { cmd: "show bridge mac-table", output: fdb.length ? fdb.map((e) => `${e.mac} ${e.port.kind.toLowerCase()} ${e.port.peer}`).join("\n") : "(empty)" },
      },
    ];
  }
  const pe = router as PeId;
  const pair = peSpokePair(pe);
  const meshPeers = pwPeersOf(pe);
  const fdb = fdbFor(state, pe);
  const ports = bridgePortsFor(state, pe);
  return [
    {
      id: "service",
      label: "H-VPLS Service",
      concept: "This PE-rs's local VPLS bridge context, plus a summary of every bridge port and its ROLE.",
      cisco: { cmd: "show l2vpn vfi", output: `VFI ${SERVICE_NAME}\n${ports.map((p) => `  ${p.kind} → ${p.peer}`).join("\n")}` },
      juniper: { cmd: "show vpls connections extensive", output: `instance ${SERVICE_NAME} {\n${ports.map((p) => `  ${p.kind.toLowerCase()} ${p.peer};`).join("\n")}\n}` },
    },
    {
      id: "spoke",
      label: "Spoke Pseudowire",
      concept: `This PE-rs's spoke toward its attached MTU-s — currently classified as ${state.spokeRoleByPe[pe]}.`,
      cisco: { cmd: "show xconnect all", output: `${pair.id}: ${spokeUp(state.spokeLinks, pair.mtu) ? "UP" : "DOWN"} — classified as ${state.spokeRoleByPe[pe]}` },
      juniper: { cmd: "show vpls connections", output: `neighbor ${ROUTER_LOOPBACK[pair.mtu]} { role ${state.spokeRoleByPe[pe].toLowerCase()}; state ${spokeUp(state.spokeLinks, pair.mtu) ? "Up" : "Down"}; }` },
    },
    {
      id: "mesh",
      label: "Core Mesh Pseudowires",
      concept: "This PE-rs's mesh legs toward the other core PE-rs hubs — reused verbatim from flat VPLS's own PW mesh.",
      cisco: { cmd: "show xconnect all", output: meshPeers.map((peer) => `${pe}-${peer}: ${pwUpBetween(state.meshLinks, pe, peer) ? "UP" : "DOWN"} — local label ${allocatePwReceiveLabel(pe, peer)}, remote label ${allocatePwReceiveLabel(peer, pe)}`).join("\n") },
      juniper: { cmd: "show vpls connections", output: meshPeers.map((peer) => `neighbor ${ROUTER_LOOPBACK[peer as PeId]} { mesh; state ${pwUpBetween(state.meshLinks, pe, peer) ? "Up" : "Down"}; }`).join("\n") },
    },
    {
      id: "fdb",
      label: "MAC Table",
      concept: "MACs learned on this PE-rs's spoke and mesh ports alike.",
      cisco: { cmd: "show l2vpn vfi mac", output: fdb.length ? fdb.map((e) => `${e.mac}  ${e.port.kind}: ${e.port.peer}`).join("\n") : "(empty)" },
      juniper: { cmd: "show vpls mac-table", output: fdb.length ? fdb.map((e) => `${e.mac} ${e.port.kind.toLowerCase()} ${e.port.peer}`).join("\n") : "(empty)" },
    },
  ];
}
