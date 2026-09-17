import type { PacketVisual, ScenarioStep } from "../types";
import { CLUSTER_ID as RR_CLUSTER_ID, ROUTER_IP as RR_ROUTER_IP, evaluateReflection } from "./bgpRouteReflector";
import {
  ROUTER_LOOPBACK as VPLS_ROUTER_LOOPBACK,
  LINKS,
  type LinkId,
  type LinkDef,
  GRAPH_NODES,
  GRAPH_EDGES,
  SERVICE_GRAPH_NODES,
  SERVICE_GRAPH_EDGES,
  CE_IP,
  CE_MAC,
  BROADCAST_MAC,
  SERVICE_NAME,
  VPLS_SERVICE_ID,
  VLAN,
  PE1_INTERFACE,
  PE2_INTERFACE,
  PE3_INTERFACE,
  AC_INTERFACE,
  type AttachmentCircuit,
  resolveAttachmentCircuit,
  type TransportState,
  transportReachable,
  transportLabelFor,
  type MplsPacketState,
  buildVplsLabelStack,
  processCoreTransportLabel,
  resolveIncomingPwLabel,
  deliverEthernetFrame,
  buildPacketLayers,
  ethLayer,
  ceFrame,
  type PwPairId,
  PW_PAIRS,
  pwPeersOf,
  type PwLinkState,
  pwUpBetween,
  type FdbPort,
  portLabel,
  bridgePortsFor,
  type Fdb,
  learnSourceMac,
  lookupDestinationMac,
  type ForwardingDecision,
  computeVplsEgressSet,
  applySplitHorizon,
  classifyForwardingDecision,
  type JourneyAction,
  type JourneyHop,
  type TroubleshootingState,
  type FloodCopyState,
  type RouterId as VplsRouterId,
} from "./mplsVpls";

/**
 * BGP-Signaled VPLS (RFC 4761) — BGP auto-discovery + label-block PW
 * signaling for the same three-site CUST-A-VPLS customer, replacing
 * the previous lesson's targeted-LDP signaling with MP-BGP over a
 * Route Reflector. The VPLS DATA PLANE — MAC learning, flooding,
 * split horizon, two-label forwarding — is reused unmodified from
 * mplsVpls.ts (see imports above): changing how PWs are SIGNALED does
 * not change how Ethernet frames are switched once they exist.
 *
 * Central question: can BGP discover VPLS membership and signal the
 * pseudowires themselves, instead of targeted LDP? Yes — but this is
 * NOT EVPN: BGP here distributes membership + label-block signaling
 * only. Customer MAC reachability is never carried in BGP; it is
 * still learned entirely from the Ethernet data plane.
 *
 * Explicitly deferred: EVPN (Type 2/3/A-D/IMET routes, MAC mobility
 * sequence numbers — compared conceptually only), H-VPLS, inter-AS
 * VPLS, BGP-signaled VPWS as its own lesson, PBB, flow-aware PW
 * labels, complex multihoming. RFC 8614's control-flag update is
 * noted informationally, not bit-modeled.
 *
 * Pure data + pure functions only — see /lib/sim-engine/types.ts.
 */

// ---------------------------------------------------------------------------
// Topology — same physical CE/PE/P tree as traditional VPLS, plus a
// Route Reflector that exists ONLY in the BGP control plane (no LINKS
// entry, no IGP adjacency, never part of the customer data path).
// ---------------------------------------------------------------------------
export type PeRouterId = "PE1" | "PE2" | "PE3";
export type CeRouterId = "CE1" | "CE2" | "CE3";
export type PRouterId = "P1" | "P2" | "P3";
export type RouterId = PeRouterId | CeRouterId | PRouterId | "RR1";
export const ALL_DEVICES: RouterId[] = ["CE1", "PE1", "P1", "P2", "P3", "PE2", "PE3", "CE2", "CE3", "RR1"];
export const PE_ROUTERS: PeRouterId[] = ["PE1", "PE2", "PE3"];
export const CE_ROUTERS: CeRouterId[] = ["CE1", "CE2", "CE3"];
export const P_ROUTERS: PRouterId[] = ["P1", "P2", "P3"];
export const ROUTER_LOOPBACK: Partial<Record<RouterId, string>> = { ...VPLS_ROUTER_LOOPBACK, RR1: RR_ROUTER_IP.RR1 };
/** RR1's real cluster ID, reused from the Route Reflector lesson's own identity constants — never re-derived. */
export const RR1_CLUSTER_ID = RR_CLUSTER_ID.RR1!;

export const TERMS: { term: string; expansion: string; meaning: string }[] = [
  { term: "RD", expansion: "Route Distinguisher", meaning: "Makes each PE's VPLS NLRI unique in MP-BGP. It does not decide which PE joins the service — that's the Route Target's job." },
  { term: "RT", expansion: "Route Target", meaning: "The service import/export membership policy. A PE imports a VPLS NLRI only if the RT it carries matches the PE's own import RT." },
  { term: "VE ID", expansion: "Virtual Edge Identifier", meaning: "RFC 4761's per-PE identifier inside one VPLS — never a router ID, loopback, VLAN ID, or MPLS label." },
  { term: "Label Block", expansion: "VE Block Offset + Size + Label Base", meaning: "One advertisement can cover a contiguous range of remote VE IDs, each mapped to its own demultiplexor label." },
];

// ---------------------------------------------------------------------------
// BGP control-plane topology — PE1/PE2/PE3 each peer only with RR1;
// RR1 reflects VPLS NLRIs between them. Drawn as its own graph so it
// is never confused with the physical or data-plane topology.
// ---------------------------------------------------------------------------
export const BGP_CONTROL_NODES = [
  { id: "PE1", label: "PE1", x: 15, y: 15, subLabel: ROUTER_LOOPBACK.PE1 },
  { id: "PE2", label: "PE2", x: 15, y: 50, subLabel: ROUTER_LOOPBACK.PE2 },
  { id: "PE3", label: "PE3", x: 15, y: 85, subLabel: ROUTER_LOOPBACK.PE3 },
  { id: "RR1", label: "RR1", x: 75, y: 50, subLabel: ROUTER_LOOPBACK.RR1 },
];
export const BGP_CONTROL_EDGES: { id: string; a: RouterId; b: RouterId; label?: string }[] = [
  { id: "PE1-RR1", a: "PE1", b: "RR1", label: "MP-BGP" },
  { id: "PE2-RR1", a: "PE2", b: "RR1", label: "MP-BGP" },
  { id: "PE3-RR1", a: "PE3", b: "RR1", label: "MP-BGP" },
];

// ---------------------------------------------------------------------------
// VPLS identity — AFI/SAFI, AS, RD/RT, VE IDs, label blocks. Every
// value below is a deterministic constant; the six directional
// service labels are DERIVED from these (see deriveVplsDemuxLabel),
// never hand-picked.
// ---------------------------------------------------------------------------
export const AS_NUMBER = 65000;
export const AFI_L2VPN = 25;
export const SAFI_VPLS = 65;
export const CUST_A_RT = "65000:100";
export const VPLS_XP_AWARD = 700;
export const RD_BY_PE: Record<PeRouterId, string> = { PE1: "65000:1", PE2: "65000:2", PE3: "65000:3" };
export const VE_ID_BY_PE: Record<PeRouterId, number> = { PE1: 1, PE2: 2, PE3: 3 };
export interface LabelBlock {
  vbo: number;
  vbs: number;
  labelBase: number;
}
const LABEL_BASE_BY_PE: Record<PeRouterId, number> = { PE1: 24000, PE2: 25000, PE3: 26000 };
export const BASELINE_LABEL_BLOCK_BY_PE: Record<PeRouterId, LabelBlock> = {
  PE1: { vbo: 1, vbs: 4, labelBase: LABEL_BASE_BY_PE.PE1 },
  PE2: { vbo: 1, vbs: 4, labelBase: LABEL_BASE_BY_PE.PE2 },
  PE3: { vbo: 1, vbs: 4, labelBase: LABEL_BASE_BY_PE.PE3 },
};

export interface Layer2Info {
  encapType: "VPLS";
  mtu: number;
  controlFlagsNote: string;
}
export function buildLayer2Info(mtu = 1500): Layer2Info {
  return { encapType: "VPLS", mtu, controlFlagsNote: "Informational only in this model — RFC 8614 updated the original C/S control-flag processing; PacketVerse does not bit-model control-word negotiation." };
}

export interface VplsNlri {
  originPe: PeRouterId;
  rd: string;
  veId: number;
  block: LabelBlock;
  routeTarget: string;
  nextHop: string;
  layer2Info: Layer2Info;
}
export function buildVplsNlri(originPe: PeRouterId, rd: string, veId: number, block: LabelBlock, routeTarget: string, nextHop: string): VplsNlri {
  return { originPe, rd, veId, block, routeTarget, nextHop, layer2Info: buildLayer2Info() };
}

// ---------------------------------------------------------------------------
// Label block math — the RFC 4761 relationship (§3.2.1). A receiving
// PE whose OWN local VE ID is W may use an advertisement only when
// VBO <= W < VBO+VBS; its send label toward the advertiser is then
// LB + W - VBO. Never returns a fabricated label outside the block.
// ---------------------------------------------------------------------------
export type LabelBlockStatus = "COVERED" | "VE_ID_BELOW_BLOCK" | "VE_ID_ABOVE_BLOCK" | "INVALID_BLOCK";
export interface LabelBlockResult {
  status: LabelBlockStatus;
  computedLabel?: number;
}
export function isVeIdCoveredByLabelBlock(block: LabelBlock, veId: number): boolean {
  return block.vbo > 0 && block.vbs > 0 && veId >= block.vbo && veId < block.vbo + block.vbs;
}
export function deriveVplsDemuxLabel(block: LabelBlock, localVeId: number): LabelBlockResult {
  if (block.vbo <= 0 || block.vbs <= 0) return { status: "INVALID_BLOCK" };
  if (localVeId < block.vbo) return { status: "VE_ID_BELOW_BLOCK" };
  if (localVeId >= block.vbo + block.vbs) return { status: "VE_ID_ABOVE_BLOCK" };
  return { status: "COVERED", computedLabel: block.labelBase + localVeId - block.vbo };
}
/** The label a PE with `myVeId` should push when sending TOWARD the PE that advertised `importedNlri`. */
export function derivePwFromImportedNlri(myVeId: number, importedNlri: VplsNlri): LabelBlockResult {
  return deriveVplsDemuxLabel(importedNlri.block, myVeId);
}
/**
 * Widens a PE's advertised block to also cover a further contiguous
 * range of remote VE IDs — modeled here as ONE wider block (VBO/base
 * unchanged, VBS grows) rather than a second coexisting block, since
 * this lesson's state holds one active block per advertising PE. This
 * is operationally equivalent to publishing a second, immediately-
 * following block (VBO=oldVBO+oldVBS, VBS=additionalVbs): the union of
 * covered VE IDs and every existing VE ID's computed label are
 * unchanged, so already-working directions never break.
 */
export function expandLabelBlock(current: LabelBlock, additionalVbs: number): LabelBlock {
  return { vbo: current.vbo, vbs: current.vbs + additionalVbs, labelBase: current.labelBase };
}
/** Narrative-friendly rendering of a label-block lookup result — the computed label when covered, the semantic out-of-range/invalid state otherwise. Never silently prints "undefined". */
export function formatLabelBlockResult(r: LabelBlockResult): string {
  return r.status === "COVERED" ? String(r.computedLabel) : r.status;
}

// ---------------------------------------------------------------------------
// BGP auto-discovery + RT import — received (what arrived via the
// RR) is always modeled separately from imported (what actually
// entered this PE's VPLS service), which is exactly what the later
// RT-mismatch incident depends on.
// ---------------------------------------------------------------------------
/**
 * Single-RR reflection: every PE receives every OTHER PE's current
 * advertisement once MP-BGP is up. All three PEs are RR1's clients, so
 * this reuses the REAL reflection-rule engine from bgp-route-reflector
 * (`evaluateReflection`) rather than re-deriving the rule locally —
 * for this all-client topology it always decides "reflect", but the
 * decision is asked for genuinely, not assumed.
 */
export function reflectVplsNlri(localAdvertisements: Partial<Record<PeRouterId, VplsNlri>>, mpBgpUp: boolean): Record<PeRouterId, VplsNlri[]> {
  const { decision } = evaluateReflection("client", "client");
  const result = {} as Record<PeRouterId, VplsNlri[]>;
  for (const pe of PE_ROUTERS) {
    result[pe] = mpBgpUp && decision === "reflect" ? PE_ROUTERS.filter((p) => p !== pe).map((p) => localAdvertisements[p]).filter((n): n is VplsNlri => !!n) : [];
  }
  return result;
}
export type RtImportResult = "IMPORTED" | "RT_NOT_MATCHED" | "AF_NOT_ENABLED" | "WITHDRAWN";
export function classifyRtImport(nlri: VplsNlri | undefined, importRt: string, afUp: boolean): RtImportResult {
  if (!nlri) return "WITHDRAWN";
  if (!afUp) return "AF_NOT_ENABLED";
  return nlri.routeTarget === importRt ? "IMPORTED" : "RT_NOT_MATCHED";
}
/** A BGP advertisement this PE has RECEIVED (via RR1), paired with the RESULT of this PE's own RT-import check — received and imported are deliberately never collapsed into one boolean, since the RT-mismatch incident depends on being able to show "received, but not imported." */
export interface ImportedAdvertisement {
  nlri: VplsNlri;
  result: RtImportResult;
}
export function importVplsNlriByRt(received: VplsNlri[], importRt: string, afUp: boolean): ImportedAdvertisement[] {
  return received.map((nlri) => ({ nlri, result: classifyRtImport(nlri, importRt, afUp) }));
}
export function discoverVplsMembers(imported: ImportedAdvertisement[]): PeRouterId[] {
  return imported.filter((a) => a.result === "IMPORTED").map((a) => a.nlri.originPe);
}
export function withdrawVplsNlri(localAdvertisements: Partial<Record<PeRouterId, VplsNlri>>, pe: PeRouterId): Partial<Record<PeRouterId, VplsNlri>> {
  return { ...localAdvertisements, [pe]: undefined };
}

/** Recomputes received → imported → discovered → PW mesh, all from current advertisements + RT policy. The single choke point every control-plane-affecting step calls. */
export function recomputeVplsMembership(
  state: Pick<BgpVplsState, "localAdvertisements" | "mpBgpUp" | "l2vpnVplsAfUp" | "importRtByPe" | "veIdByPe">,
): { receivedByPe: Record<PeRouterId, VplsNlri[]>; importedByPe: Record<PeRouterId, ImportedAdvertisement[]>; pwLinks: PwLinkState[] } {
  const receivedByPe = reflectVplsNlri(state.localAdvertisements, state.mpBgpUp);
  const importedByPe = {} as Record<PeRouterId, ImportedAdvertisement[]>;
  for (const pe of PE_ROUTERS) importedByPe[pe] = importVplsNlriByRt(receivedByPe[pe], state.importRtByPe[pe], state.l2vpnVplsAfUp);
  const pwLinks: PwLinkState[] = PW_PAIRS.map((pair) => {
    const a = pair.a as PeRouterId;
    const b = pair.b as PeRouterId;
    const aImportsB = importedByPe[a].find((entry) => entry.nlri.originPe === b && entry.result === "IMPORTED");
    const bImportsA = importedByPe[b].find((entry) => entry.nlri.originPe === a && entry.result === "IMPORTED");
    const aResult = aImportsB ? derivePwFromImportedNlri(state.veIdByPe[a], aImportsB.nlri) : undefined;
    const bResult = bImportsA ? derivePwFromImportedNlri(state.veIdByPe[b], bImportsA.nlri) : undefined;
    return { id: pair.id, up: aResult?.status === "COVERED" && bResult?.status === "COVERED" };
  });
  return { receivedByPe, importedByPe, pwLinks };
}

// ---------------------------------------------------------------------------
// BGP control-plane journey (kept visually and semantically separate
// from the Ethernet customer-data journey below — §59).
// ---------------------------------------------------------------------------
export type BgpJourneyAction = "ADVERTISE" | "REFLECT" | "RECEIVE" | "RT_IMPORT" | "RT_REJECT" | "WITHDRAW" | "SESSION_DOWN";
export interface BgpJourneyHop {
  device: RouterId;
  input: string;
  lookup: string;
  action: BgpJourneyAction;
  output: string;
}

// ---------------------------------------------------------------------------
// Top-level scenario state
// ---------------------------------------------------------------------------
export interface RtRepairAttempt {
  choice: string;
  correct: boolean;
}
export interface BgpVplsState {
  transport: TransportState;
  mpBgpUp: boolean;
  l2vpnVplsAfUp: boolean;
  acs: AttachmentCircuit[];
  veIdByPe: Record<PeRouterId, number>;
  labelBlocksByPe: Record<PeRouterId, LabelBlock>;
  importRtByPe: Record<PeRouterId, string>;
  exportRtByPe: Record<PeRouterId, string>;
  localAdvertisements: Partial<Record<PeRouterId, VplsNlri>>;
  receivedByPe: Record<PeRouterId, VplsNlri[]>;
  importedByPe: Record<PeRouterId, ImportedAdvertisement[]>;
  pwLinks: PwLinkState[];
  fdb: Record<PeRouterId, Fdb>;
  packet?: MplsPacketState;
  packetAt?: RouterId;
  journey: JourneyHop[];
  bgpJourney: BgpJourneyHop[];
  /** RR1's control-plane fan-out of one advertisement to the other clients — visually distinct from `floodCopies` (customer-data BUM replication). */
  bgpFanout?: { id: string; fromId: RouterId; toId: RouterId }[];
  floodCopies?: FloodCopyState[];
  lastDecision?: ForwardingDecision;
  troubleshooting: TroubleshootingState & { repairAttempt?: RtRepairAttempt };
}

export function createBgpVplsState(): BgpVplsState {
  return {
    transport: { igpUp: false, ldpUp: false, lspUp: false },
    mpBgpUp: false,
    l2vpnVplsAfUp: false,
    acs: [
      { peRouter: "PE1", ceRouter: "CE1", interfaceName: PE1_INTERFACE, vlan: VLAN, up: true },
      { peRouter: "PE2", ceRouter: "CE2", interfaceName: PE2_INTERFACE, vlan: VLAN, up: true },
      { peRouter: "PE3", ceRouter: "CE3", interfaceName: PE3_INTERFACE, vlan: VLAN, up: true },
    ],
    veIdByPe: { ...VE_ID_BY_PE },
    labelBlocksByPe: { ...BASELINE_LABEL_BLOCK_BY_PE },
    importRtByPe: { PE1: CUST_A_RT, PE2: CUST_A_RT, PE3: CUST_A_RT },
    exportRtByPe: { PE1: CUST_A_RT, PE2: CUST_A_RT, PE3: CUST_A_RT },
    localAdvertisements: {},
    receivedByPe: { PE1: [], PE2: [], PE3: [] },
    importedByPe: { PE1: [], PE2: [], PE3: [] },
    pwLinks: [
      { id: "PE1-PE2", up: false },
      { id: "PE1-PE3", up: false },
      { id: "PE2-PE3", up: false },
    ],
    fdb: { PE1: [], PE2: [], PE3: [] },
    journey: [],
    bgpJourney: [],
    troubleshooting: { started: false, repaired: false, verified: false },
  };
}

export function fdbFor(state: Pick<BgpVplsState, "fdb">, router: PeRouterId): Fdb {
  return state.fdb[router] ?? [];
}
export function portsFor(state: Pick<BgpVplsState, "acs" | "pwLinks">, router: PeRouterId): FdbPort[] {
  return bridgePortsFor(router, resolveAttachmentCircuit(state.acs, router), state.pwLinks);
}
/** Every control-plane-affecting step calls this single choke point afterward — recomputes received/imported/PW-mesh state from current advertisements + RT/VE-ID/label-block policy, never left to drift out of sync. */
export function applyMembershipRecompute(state: BgpVplsState): BgpVplsState {
  const { receivedByPe, importedByPe, pwLinks } = recomputeVplsMembership(state);
  return { ...state, receivedByPe, importedByPe, pwLinks };
}
/** Which remote PEs THIS PE has actually discovered as CUST-A-VPLS members (RT import succeeded) — the auto-discovery result a learner should read as "membership," never confused with the raw received list. */
export function discoveredMembersFor(state: Pick<BgpVplsState, "importedByPe">, pe: PeRouterId): PeRouterId[] {
  return discoverVplsMembers(state.importedByPe[pe]);
}
/** The service label `from` must push when sending TOWARD `to` — derived from `to`'s imported label block and `from`'s own VE ID, never a stored per-pair constant. Undefined when not covered/not imported (mirrors real forwarding: no label, no PW). */
export function pwLabelToward(state: Pick<BgpVplsState, "veIdByPe" | "importedByPe">, from: PeRouterId, to: PeRouterId): number | undefined {
  const entry = state.importedByPe[from].find((e) => e.nlri.originPe === to && e.result === "IMPORTED");
  if (!entry) return undefined;
  const result = derivePwFromImportedNlri(state.veIdByPe[from], entry.nlri);
  return result.status === "COVERED" ? result.computedLabel : undefined;
}

// ---------------------------------------------------------------------------
// Graph layout — physical + service views reused verbatim from
// traditional VPLS (identical topology); BGP control graph above is
// the only new one.
// ---------------------------------------------------------------------------
export { GRAPH_NODES, GRAPH_EDGES, SERVICE_GRAPH_NODES, SERVICE_GRAPH_EDGES, LINKS, type LinkId, type LinkDef };
// Re-exported so the page/Scene Adapter never needs a second import from mplsVpls.ts directly.
export { SERVICE_NAME, VPLS_SERVICE_ID, BROADCAST_MAC, AC_INTERFACE, PE1_INTERFACE, PE2_INTERFACE, PE3_INTERFACE, transportReachable, PW_PAIRS, type PwPairId, resolveAttachmentCircuit, CE_IP, portLabel, pwUpBetween };

// ---------------------------------------------------------------------------
// Packet / control-message builders
// ---------------------------------------------------------------------------
function vplsPacket(id: string, from: RouterId, to: RouterId, summary: string, badge: string, pkt: MplsPacketState): PacketVisual {
  return { id, protocol: "MPLS", from, to, summary, badge, layers: buildPacketLayers(pkt) };
}
function bgpUpdatePacket(id: string, from: RouterId, to: RouterId, summary: string, badge: "UPDATE" | "WITHDRAW", fields: { label: string; value: string }[]): PacketVisual {
  return { id, protocol: "BGP", from, to, summary, badge, layers: [{ name: "MP-BGP L2VPN/VPLS NLRI", color: "var(--pv-proto-bgp)", fields }] };
}
export function nlriFields(nlri: VplsNlri): { label: string; value: string }[] {
  return [
    { label: "RD", value: nlri.rd },
    { label: "VE ID", value: String(nlri.veId) },
    { label: "VE Block Offset", value: String(nlri.block.vbo) },
    { label: "VE Block Size", value: String(nlri.block.vbs) },
    { label: "Label Base", value: String(nlri.block.labelBase) },
    { label: "Route Target", value: nlri.routeTarget },
    { label: "BGP Next Hop", value: nlri.nextHop },
    { label: "Layer2 Info", value: `${nlri.layer2Info.encapType}, MTU ${nlri.layer2Info.mtu}` },
  ];
}

// ---------------------------------------------------------------------------
// Scenario steps
// ---------------------------------------------------------------------------
export const bgpVplsSteps: ScenarioStep<BgpVplsState>[] = [
  {
    id: "intro",
    label: "Introduction",
    narrative: "Central question: can BGP discover the VPLS members and signal their pseudowires instead of targeted LDP? Yes — but BGP-signaled VPLS is NOT EVPN. Watch closely for exactly what BGP does and does not carry.",
  },
  {
    id: "recap-ldp-vpls",
    label: "Recap: Targeted-LDP VPLS",
    narrative: "You already built CUST-A-VPLS with a full mesh of pseudowires signaled by targeted LDP — one session per PE pair, PW FEC matching, directional labels. The Ethernet bridging behavior on top (MAC learning, flooding, split horizon) doesn't change today. Only the signaling protocol underneath the pseudowires changes.",
  },
  {
    id: "predict-can-bgp-signal",
    label: "Predict",
    narrative: "Before continuing:",
    question: {
      prompt: "Could BGP realistically replace targeted LDP as the way PE1/PE2/PE3 discover each other and signal their pseudowires?",
      options: [
        { id: "yes-rfc4761", label: "Yes — RFC 4761 defines exactly this: BGP auto-discovery plus label-block PW signaling" },
        { id: "no-l2-only-ldp", label: "No — only LDP can ever signal a Layer 2 pseudowire" },
        { id: "yes-becomes-evpn", label: "Yes, and doing so makes it EVPN" },
        { id: "no-needs-manual-config", label: "No — multipoint PW membership can only ever be manually configured, never discovered" },
      ],
      correctOptionId: "yes-rfc4761",
      explanation: "RFC 4761 replaces targeted LDP with MP-BGP for both auto-discovery (who's in this VPLS) and PW signaling (which label to use toward each member) — while keeping the exact same classic VPLS data plane. It is a different control-plane mechanism from EVPN, not a rebranding of it.",
    },
  },
  {
    id: "bgp-vpls-mental-model",
    label: "The BGP-VPLS Mental Model",
    narrative: "VPLS configuration → RD + RT + VE ID → BGP VPLS NLRI → BGP auto-discovery → label-block signaling → remote PE/PW state → full-mesh VPLS data plane → ordinary Ethernet MAC learning. BGP replaces membership/PW signaling. It does NOT turn customer MAC learning into a BGP control-plane function.",
  },
  {
    id: "topology-intro",
    label: "Topology",
    narrative: `CE1 (${CE_IP.CE1}), CE2 (${CE_IP.CE2}), and CE3 (${CE_IP.CE3}) attach to PE1, PE2, and PE3 — the identical physical network as the targeted-LDP lesson. P1/P2/P3 remain plain MPLS transit.`,
  },
  {
    id: "bgp-control-topology-intro",
    label: "A New Control-Plane Topology",
    narrative: `PE1, PE2, and PE3 each peer with a single Route Reflector, RR1, in AS ${AS_NUMBER} — the same illustrative design already taught in the BGP Route Reflector lesson. No PE-to-PE BGP sessions exist; RR1 reflects VPLS reachability/signaling between all three.`,
  },
  {
    id: "transport-recap-intro",
    label: "Transport Recap",
    narrative: "Exactly as before: IGP reachability, then LDP hop-by-hop label distribution, then a working label-switched path between every PE loopback. Ordinary transport LDP is completely independent of how the VPLS SERVICE gets signaled.",
  },
  {
    id: "transport-lsp-up",
    label: "Transport: LSP UP",
    narrative: "IGP converged, LDP sessions up hop by hop, label-switched paths established between every PE loopback.",
    run: (state) => ({ state: { ...state, transport: { igpUp: true, ldpUp: true, lspUp: true } }, events: [] }),
    whatChanged: () => ["Transport: DOWN → UP (IGP + LDP + LSP) — unrelated to VPLS service signaling"],
  },
  {
    id: "mp-bgp-sessions-up",
    label: "MP-BGP Sessions: PE1/PE2/PE3 → RR1",
    narrative: "All three PE-to-RR1 MP-BGP sessions reach ESTABLISHED. This is ordinary BGP session establishment — nothing VPLS-specific has happened yet.",
    run: (state) => ({ state: { ...state, mpBgpUp: true }, events: [{ type: "BGP_STATE_CHANGED", stepId: "mp-bgp-sessions-up", timestamp: Date.now(), message: "PE1/PE2/PE3 ↔ RR1 sessions: ESTABLISHED" }] }),
    whatChanged: () => ["MP-BGP sessions: IDLE → ESTABLISHED"],
  },
  {
    id: "predict-transport-independent",
    label: "Predict",
    narrative: "Before continuing:",
    question: {
      prompt: "Can the underlying MPLS transport still use ordinary LDP while BGP signals the VPLS service itself?",
      options: [
        { id: "yes", label: "Yes — transport LDP and BGP VPLS service signaling are completely independent layers" },
        { id: "no-must-remove-ldp", label: "No — introducing BGP VPLS requires removing LDP from the core entirely" },
        { id: "no-must-use-rsvp", label: "No — BGP-signaled services require RSVP-TE transport" },
        { id: "only-with-sr", label: "Only if the core also runs Segment Routing" },
      ],
      correctOptionId: "yes",
      explanation: "Transport (how a labeled packet reaches the far PE) and service signaling (which label identifies this customer's service there) are independent layers in MPLS. Swapping targeted LDP for BGP at the service layer changes nothing about how the core forwards labeled packets.",
    },
  },
  {
    id: "predict-transport-vs-membership",
    label: "Predict",
    narrative: "Right now: PE loopback reachability UP, MPLS transport UP, MP-BGP sessions to RR1 UP. Before continuing:",
    question: {
      prompt: "Does this mean CUST-A-VPLS members have been discovered and pseudowires installed?",
      options: [
        { id: "no", label: "No — nothing has advertised a VPLS NLRI yet; membership and PW state are both still absent" },
        { id: "yes", label: "Yes — a healthy BGP session automatically implies every configured service is up" },
        { id: "partially", label: "Partially — membership is known but labels aren't" },
        { id: "yes-because-transport", label: "Yes, because transport reachability is what actually creates VPLS membership" },
      ],
      correctOptionId: "no",
      explanation: "Underlay/transport health and service signaling are separate questions. An ESTABLISHED BGP session is necessary but nowhere near sufficient — no PE has advertised anything about CUST-A-VPLS yet, so there is no discovered membership and no PW label state at all.",
    },
  },
  {
    id: "afi-safi-intro",
    label: "A New MP-BGP Address Family",
    narrative: `MP-BGP carries this service in its own address family: AFI ${AFI_L2VPN} (L2VPN), SAFI ${SAFI_VPLS} (VPLS) — the "L2VPN/VPLS" address family. This is a distinct identity from EVPN's own address family, from VPNv4, and from plain IPv4 unicast.`,
  },
  {
    id: "enable-l2vpn-vpls-af",
    label: "Enable L2VPN/VPLS On Every Session",
    narrative: "PE1, PE2, and PE3 each enable the L2VPN/VPLS address family on their existing session to RR1. Only once this is active can any VPLS NLRI actually be advertised, reflected, or imported over that session.",
    run: (state) => ({ state: { ...state, l2vpnVplsAfUp: true }, events: [{ type: "BGP_STATE_CHANGED", stepId: "enable-l2vpn-vpls-af", timestamp: Date.now(), message: "L2VPN/VPLS address family active on all three PE-RR1 sessions" }] }),
    whatChanged: () => ["L2VPN/VPLS address family: not negotiated → active"],
  },
  {
    id: "rd-intro",
    label: "Route Distinguisher",
    narrative: `Every PE's VPLS NLRI carries a Route Distinguisher: PE1 = ${RD_BY_PE.PE1}, PE2 = ${RD_BY_PE.PE2}, PE3 = ${RD_BY_PE.PE3}. The RD's only job is to make each PE's own advertisement unique in MP-BGP — it does not decide which PE joins the service.`,
  },
  {
    id: "rt-intro",
    label: "Route Target",
    narrative: `Separately, every PE configures a Route Target for CUST-A-VPLS: ${CUST_A_RT}, used for both import and export. The RT is the service membership policy — a PE imports a VPLS NLRI only when its own import RT matches an RT carried on that NLRI.`,
  },
  {
    id: "predict-rt-purpose",
    label: "Predict",
    narrative: "Before continuing:",
    question: {
      prompt: "What does the Route Target primarily control?",
      options: [
        { id: "membership", label: "VPLS service import/export membership policy" },
        { id: "label", label: "The exact PW service label to use" },
        { id: "unique-nlri", label: "Making each PE's NLRI unique (that's the RD's job, not the RT's)" },
        { id: "ve-id", label: "Which VE ID a PE is assigned" },
      ],
      correctOptionId: "membership",
      explanation: "RT and RD are different, and neither is a label or a VE ID. RD makes an advertisement unique; RT decides whether a receiving PE treats an advertisement as belonging to its own service.",
    },
  },
  {
    id: "ve-id-intro",
    label: "VE ID",
    narrative: `Each PE is assigned a VE ID scoped to this one VPLS: PE1 = ${VE_ID_BY_PE.PE1}, PE2 = ${VE_ID_BY_PE.PE2}, PE3 = ${VE_ID_BY_PE.PE3}. A VE ID is not a router ID, not a loopback address, not an MPLS label, not a VLAN ID, and not a Route Target.`,
  },
  {
    id: "label-block-intro",
    label: "The Label Block",
    narrative: "One BGP VPLS advertisement can signal a contiguous BLOCK of demultiplexor labels for a range of remote VE IDs — not one label for one peer. Three distinct fields make up a block: VE Block Offset (VBO), VE Block Size (VBS), and Label Base (LB). None of these is itself a label.",
  },
  {
    id: "nlri-anatomy",
    label: "VPLS BGP NLRI Anatomy",
    narrative: `PE1's advertisement: RD ${RD_BY_PE.PE1}, VE ID ${VE_ID_BY_PE.PE1}, VE Block Offset ${BASELINE_LABEL_BLOCK_BY_PE.PE1.vbo}, VE Block Size ${BASELINE_LABEL_BLOCK_BY_PE.PE1.vbs}, Label Base ${BASELINE_LABEL_BLOCK_BY_PE.PE1.labelBase}, Route Target ${CUST_A_RT}. This block covers remote VE IDs ${BASELINE_LABEL_BLOCK_BY_PE.PE1.vbo} through ${BASELINE_LABEL_BLOCK_BY_PE.PE1.vbo + BASELINE_LABEL_BLOCK_BY_PE.PE1.vbs - 1}.`,
  },
  {
    id: "layer2-info-intro",
    label: "Layer2 Info Extended Community",
    narrative: "Every VPLS NLRI also carries a Layer2 Info Extended Community: Encapsulation Type = VPLS, Layer-2 MTU = 1500. Its control flags are shown here as informational only — RFC 8614 updated how control flags are actually processed, so this lesson does not bit-model a control-word negotiation state machine.",
  },
  {
    id: "predict-label-base-not-final-label",
    label: "Predict",
    narrative: "Before continuing:",
    question: {
      prompt: "Is the Label Base always the exact PW label a particular remote PE will use?",
      options: [
        { id: "no-derived", label: "No — the actual label is derived from the label block and the sender's own VE ID" },
        { id: "yes", label: "Yes — Label Base is simply that peer's PW label" },
        { id: "no-random", label: "No — the actual label is chosen at random per packet" },
        { id: "yes-if-single-block", label: "Yes, but only when a PE has advertised exactly one block" },
      ],
      correctOptionId: "no-derived",
      explanation: "Label Base is the START of a block, not a finished label. The formula is label = Label Base + sender's VE ID − VE Block Offset, and it's only valid when the sender's VE ID actually falls inside the block.",
    },
  },
  {
    id: "pe1-advertises",
    label: "PE1 Advertises Its VPLS NLRI",
    narrative: `PE1 builds and sends a VPLS NLRI to RR1: RD ${RD_BY_PE.PE1}, VE ID ${VE_ID_BY_PE.PE1}, VE Block Offset ${BASELINE_LABEL_BLOCK_BY_PE.PE1.vbo}, VE Block Size ${BASELINE_LABEL_BLOCK_BY_PE.PE1.vbs}, Label Base ${BASELINE_LABEL_BLOCK_BY_PE.PE1.labelBase}, Route Target ${CUST_A_RT}, Next Hop ${ROUTER_LOOPBACK.PE1}.`,
    packet: (state) => {
      const nlri = buildVplsNlri("PE1", RD_BY_PE.PE1, state.veIdByPe.PE1, state.labelBlocksByPe.PE1, state.exportRtByPe.PE1, ROUTER_LOOPBACK.PE1 ?? "");
      return bgpUpdatePacket("pe1-advertise", "PE1", "RR1", "VPLS NLRI — ANNOUNCE", "UPDATE", nlriFields(nlri));
    },
    run: (state) => {
      const nlri = buildVplsNlri("PE1", RD_BY_PE.PE1, state.veIdByPe.PE1, state.labelBlocksByPe.PE1, state.exportRtByPe.PE1, ROUTER_LOOPBACK.PE1 ?? "");
      const next = applyMembershipRecompute({ ...state, localAdvertisements: { ...state.localAdvertisements, PE1: nlri } });
      const bgpJourney = [...state.bgpJourney, { device: "PE1" as VplsRouterId, input: "local CUST-A-VPLS config", lookup: `Build VPLS NLRI (RD ${nlri.rd}, VE ID ${nlri.veId})`, action: "ADVERTISE" as BgpJourneyAction, output: `Sent to RR1 — RT ${nlri.routeTarget}` }];
      return { state: { ...next, bgpJourney }, events: [{ type: "BGP_UPDATE_SENT", stepId: "pe1-advertises", timestamp: Date.now(), message: "PE1 advertises its VPLS NLRI to RR1" }] };
    },
    whatChanged: () => ["PE1's VPLS NLRI advertised — not yet received by PE2/PE3"],
  },
  {
    id: "rr1-reflects",
    label: "RR1 Reflects PE1's NLRI",
    narrative: "RR1 reflects PE1's advertisement to its other clients, PE2 and PE3 — the same client-to-client reflection rule already taught in the Route Reflector lesson, now carrying a VPLS NLRI instead of an IPv4 route.",
    packet: (state) => {
      const nlri = state.localAdvertisements.PE1;
      return nlri ? bgpUpdatePacket("rr1-reflect", "RR1", "PE2", "VPLS NLRI — reflected", "UPDATE", nlriFields(nlri)) : undefined;
    },
    run: (state) => ({
      state: { ...state, bgpFanout: [{ id: "fanout-pe2", fromId: "RR1", toId: "PE2" }, { id: "fanout-pe3", fromId: "RR1", toId: "PE3" }] },
      events: [{ type: "BGP_UPDATE_SENT", stepId: "rr1-reflects", timestamp: Date.now(), message: "RR1 reflects PE1's VPLS NLRI to PE2 and PE3" }],
    }),
  },
  {
    id: "pe2-receives",
    label: "PE2 Receives PE1's NLRI",
    narrative: "PE2 receives the reflected advertisement. This is the RECEIVED state — before any RT import check has even run.",
    run: (state) => {
      const bgpJourney = [...state.bgpJourney, { device: "PE2" as VplsRouterId, input: "BGP UPDATE from RR1", lookup: "Store in Adj-RIB-In — no RT check applied yet", action: "RECEIVE" as BgpJourneyAction, output: `Received: PE1's NLRI (RD ${state.localAdvertisements.PE1?.rd ?? "—"})` }];
      return { state: { ...state, bgpJourney }, events: [] };
    },
  },
  {
    id: "pe2-rt-import-check",
    label: "PE2: RT Import Check",
    narrative: `PE2 compares PE1's Route Target (${CUST_A_RT}) against its own import RT (${CUST_A_RT}) — MATCH. PE1's NLRI is imported into CUST-A-VPLS.`,
    run: (state) => {
      const bgpJourney = [...state.bgpJourney, { device: "PE2" as VplsRouterId, input: `RT ${state.localAdvertisements.PE1?.routeTarget ?? "—"}`, lookup: `Compare against PE2 import RT ${state.importRtByPe.PE2}`, action: "RT_IMPORT" as BgpJourneyAction, output: "MATCH — imported" }];
      return { state: { ...state, bgpJourney }, events: [{ type: "RT_IMPORT_EVALUATED", stepId: "pe2-rt-import-check", timestamp: Date.now(), message: "PE2 RT import check: match" }] };
    },
  },
  {
    id: "pe2-discovers-pe1",
    label: "Auto-Discovery: PE2 Discovers PE1",
    narrative: "Because the RT matched, PE2 now knows PE1 participates in CUST-A-VPLS — this is auto-discovery. The same BGP UPDATE that discovered PE1 also carried everything needed for PW signaling (VE ID, VE Block Offset, VE Block Size, Label Base) — discovery and signaling arrive together.",
  },
  {
    id: "pe3-receives-imports",
    label: "PE3 Also Receives And Imports",
    narrative: "RR1 reflected the same advertisement to PE3. PE3's own RT import check also matches, and PE3 discovers PE1 as a member too.",
    run: (state) => {
      const bgpJourney = [...state.bgpJourney, { device: "PE3" as VplsRouterId, input: "BGP UPDATE from RR1", lookup: `RT ${state.localAdvertisements.PE1?.routeTarget ?? "—"} vs. import RT ${state.importRtByPe.PE3}`, action: "RT_IMPORT" as BgpJourneyAction, output: "MATCH — PE1 discovered" }];
      return { state: { ...state, bgpFanout: undefined, bgpJourney }, events: [] };
    },
  },
  {
    id: "pe2-advertises",
    label: "PE2 Advertises Its Own VPLS NLRI",
    narrative: `PE2 does the same in reverse: RD ${RD_BY_PE.PE2}, VE ID ${VE_ID_BY_PE.PE2}, Label Base ${BASELINE_LABEL_BLOCK_BY_PE.PE2.labelBase}, RT ${CUST_A_RT} — reflected by RR1 to PE1 and PE3, both of which import it.`,
    packet: (state) => {
      const nlri = buildVplsNlri("PE2", RD_BY_PE.PE2, state.veIdByPe.PE2, state.labelBlocksByPe.PE2, state.exportRtByPe.PE2, ROUTER_LOOPBACK.PE2 ?? "");
      return bgpUpdatePacket("pe2-advertise", "PE2", "RR1", "VPLS NLRI — ANNOUNCE", "UPDATE", nlriFields(nlri));
    },
    run: (state) => {
      const nlri = buildVplsNlri("PE2", RD_BY_PE.PE2, state.veIdByPe.PE2, state.labelBlocksByPe.PE2, state.exportRtByPe.PE2, ROUTER_LOOPBACK.PE2 ?? "");
      const next = applyMembershipRecompute({ ...state, localAdvertisements: { ...state.localAdvertisements, PE2: nlri } });
      const bgpJourney = [...state.bgpJourney, { device: "PE2" as VplsRouterId, input: "local CUST-A-VPLS config", lookup: `Build VPLS NLRI (RD ${nlri.rd}, VE ID ${nlri.veId})`, action: "ADVERTISE" as BgpJourneyAction, output: `Sent to RR1 — reflected to PE1, PE3` }];
      return { state: { ...next, bgpJourney }, events: [{ type: "BGP_UPDATE_SENT", stepId: "pe2-advertises", timestamp: Date.now(), message: "PE2 advertises its VPLS NLRI to RR1" }] };
    },
    whatChanged: () => ["PE2's VPLS NLRI advertised, reflected, and imported by PE1 and PE3"],
  },
  {
    id: "pe3-advertises",
    label: "PE3 Advertises Its Own VPLS NLRI",
    narrative: `PE3 completes the set: RD ${RD_BY_PE.PE3}, VE ID ${VE_ID_BY_PE.PE3}, Label Base ${BASELINE_LABEL_BLOCK_BY_PE.PE3.labelBase}, RT ${CUST_A_RT}.`,
    packet: (state) => {
      const nlri = buildVplsNlri("PE3", RD_BY_PE.PE3, state.veIdByPe.PE3, state.labelBlocksByPe.PE3, state.exportRtByPe.PE3, ROUTER_LOOPBACK.PE3 ?? "");
      return bgpUpdatePacket("pe3-advertise", "PE3", "RR1", "VPLS NLRI — ANNOUNCE", "UPDATE", nlriFields(nlri));
    },
    run: (state) => {
      const nlri = buildVplsNlri("PE3", RD_BY_PE.PE3, state.veIdByPe.PE3, state.labelBlocksByPe.PE3, state.exportRtByPe.PE3, ROUTER_LOOPBACK.PE3 ?? "");
      const next = applyMembershipRecompute({ ...state, localAdvertisements: { ...state.localAdvertisements, PE3: nlri } });
      const bgpJourney = [...state.bgpJourney, { device: "PE3" as VplsRouterId, input: "local CUST-A-VPLS config", lookup: `Build VPLS NLRI (RD ${nlri.rd}, VE ID ${nlri.veId})`, action: "ADVERTISE" as BgpJourneyAction, output: "Sent to RR1 — reflected to PE1, PE2" }];
      return { state: { ...next, bgpJourney }, events: [{ type: "BGP_UPDATE_SENT", stepId: "pe3-advertises", timestamp: Date.now(), message: "PE3 advertises its VPLS NLRI to RR1" }] };
    },
    whatChanged: () => ["PE3's VPLS NLRI advertised — every PE has now advertised, been reflected, and been imported by the other two"],
  },
  {
    id: "full-mesh-membership-recap",
    label: "Membership: Fully Discovered",
    narrative: "Every PE has now discovered both other PEs as CUST-A-VPLS members via BGP auto-discovery — no targeted LDP session was needed for any of this.",
  },
  {
    id: "predict-rr-not-dataplane",
    label: "Predict",
    narrative: "Before continuing:",
    question: {
      prompt: "PE1 uses RR1 to learn about PE2 and PE3. Must customer Ethernet traffic between them also traverse RR1?",
      options: [
        { id: "no", label: "No — RR1 is a control-plane speaker only; customer frames travel PE-to-PE across the MPLS core" },
        { id: "yes", label: "Yes — RR1 becomes the hub for all customer traffic once it reflects the service" },
        { id: "only-unknown", label: "Only unknown-unicast/BUM traffic needs to pass through RR1" },
        { id: "only-if-p-routers-down", label: "Only if the direct core path between the two PEs is down" },
      ],
      correctOptionId: "no",
      explanation: "BGP UPDATE: PE1 → RR1 → PE2. Customer data: PE1 → MPLS core → PE2, directly. Route reflection removes the need for a PE-to-PE BGP session, not the need for a direct data-plane path.",
    },
  },
  {
    id: "label-block-viewer-pe1",
    label: "PE1's Label Block, Fully Expanded",
    narrative: `PE1's block (VBO ${BASELINE_LABEL_BLOCK_BY_PE.PE1.vbo}, VBS ${BASELINE_LABEL_BLOCK_BY_PE.PE1.vbs}, LB ${BASELINE_LABEL_BLOCK_BY_PE.PE1.labelBase}) covers remote VE IDs 1-4: VE ID 1 (PE1 itself) → ${formatLabelBlockResult(deriveVplsDemuxLabel(BASELINE_LABEL_BLOCK_BY_PE.PE1, 1))}, VE ID 2 (PE2) → ${formatLabelBlockResult(deriveVplsDemuxLabel(BASELINE_LABEL_BLOCK_BY_PE.PE1, 2))}, VE ID 3 (PE3) → ${formatLabelBlockResult(deriveVplsDemuxLabel(BASELINE_LABEL_BLOCK_BY_PE.PE1, 3))}, VE ID 4 (unused) → ${formatLabelBlockResult(deriveVplsDemuxLabel(BASELINE_LABEL_BLOCK_BY_PE.PE1, 4))}. PE2 uses ${formatLabelBlockResult(deriveVplsDemuxLabel(BASELINE_LABEL_BLOCK_BY_PE.PE1, 2))} toward PE1; PE3 uses ${formatLabelBlockResult(deriveVplsDemuxLabel(BASELINE_LABEL_BLOCK_BY_PE.PE1, 3))} toward PE1 — both from the SAME block, distinguished only by which VE ID computes the offset.`,
  },
  {
    id: "predict-receive-side-meaning",
    label: "Predict",
    narrative: "Before continuing:",
    question: {
      prompt: `PE1 may receive label ${formatLabelBlockResult(deriveVplsDemuxLabel(BASELINE_LABEL_BLOCK_BY_PE.PE1, 2))} from PE2 and label ${formatLabelBlockResult(deriveVplsDemuxLabel(BASELINE_LABEL_BLOCK_BY_PE.PE1, 3))} from PE3. What does this mean?`,
      options: [
        { id: "both-cust-a-demux", label: "Both belong to CUST-A-VPLS — the specific value also identifies which VE sent it, from PE1's own block" },
        { id: "one-service-label", label: "BGP VPLS always uses one shared service label per PE for every remote sender" },
        { id: "different-services", label: "They must belong to two different services, since the labels differ" },
        { id: "random", label: "The specific values are arbitrary and carry no meaning" },
      ],
      correctOptionId: "both-cust-a-demux",
      explanation: "With the RFC 4761 label-block model, a PE does not get one flat service label reused by every sender — each remote VE ID maps to its own value within the block, still all belonging to the same VPLS.",
    },
  },
  {
    id: "compute-pe1-to-pe2",
    label: "Compute: PE1 → PE2",
    narrative: `PE1 sends toward PE2 using PE2's advertised block (VBO ${BASELINE_LABEL_BLOCK_BY_PE.PE2.vbo}, LB ${BASELINE_LABEL_BLOCK_BY_PE.PE2.labelBase}) with PE1's own VE ID (${VE_ID_BY_PE.PE1}): label = ${BASELINE_LABEL_BLOCK_BY_PE.PE2.labelBase} + ${VE_ID_BY_PE.PE1} − ${BASELINE_LABEL_BLOCK_BY_PE.PE2.vbo} = ${formatLabelBlockResult(deriveVplsDemuxLabel(BASELINE_LABEL_BLOCK_BY_PE.PE2, VE_ID_BY_PE.PE1))}.`,
  },
  {
    id: "compute-pe2-to-pe1",
    label: "Compute: PE2 → PE1",
    narrative: `PE2 sends toward PE1 using PE1's advertised block (VBO ${BASELINE_LABEL_BLOCK_BY_PE.PE1.vbo}, LB ${BASELINE_LABEL_BLOCK_BY_PE.PE1.labelBase}) with PE2's own VE ID (${VE_ID_BY_PE.PE2}): label = ${formatLabelBlockResult(deriveVplsDemuxLabel(BASELINE_LABEL_BLOCK_BY_PE.PE1, VE_ID_BY_PE.PE2))} — a genuinely different value from the PE1→PE2 direction.`,
  },
  {
    id: "compute-pe1-to-pe3",
    label: "Compute: PE1 → PE3",
    narrative: `Using PE3's block with PE1's VE ID (${VE_ID_BY_PE.PE1}): label = ${formatLabelBlockResult(deriveVplsDemuxLabel(BASELINE_LABEL_BLOCK_BY_PE.PE3, VE_ID_BY_PE.PE1))}.`,
  },
  {
    id: "compute-pe3-to-pe1",
    label: "Compute: PE3 → PE1",
    narrative: `Using PE1's block with PE3's VE ID (${VE_ID_BY_PE.PE3}): label = ${formatLabelBlockResult(deriveVplsDemuxLabel(BASELINE_LABEL_BLOCK_BY_PE.PE1, VE_ID_BY_PE.PE3))}.`,
  },
  {
    id: "compute-pe2-to-pe3",
    label: "Compute: PE2 → PE3",
    narrative: `Using PE3's block with PE2's VE ID (${VE_ID_BY_PE.PE2}): label = ${formatLabelBlockResult(deriveVplsDemuxLabel(BASELINE_LABEL_BLOCK_BY_PE.PE3, VE_ID_BY_PE.PE2))}.`,
  },
  {
    id: "compute-pe3-to-pe2",
    label: "Compute: PE3 → PE2",
    narrative: `Using PE2's block with PE3's VE ID (${VE_ID_BY_PE.PE3}): label = ${formatLabelBlockResult(deriveVplsDemuxLabel(BASELINE_LABEL_BLOCK_BY_PE.PE2, VE_ID_BY_PE.PE3))}.`,
  },
  {
    id: "six-labels-recap",
    label: "Six Directional Labels, All Derived",
    narrative: `PE1→PE2 ${formatLabelBlockResult(deriveVplsDemuxLabel(BASELINE_LABEL_BLOCK_BY_PE.PE2, VE_ID_BY_PE.PE1))} · PE2→PE1 ${formatLabelBlockResult(deriveVplsDemuxLabel(BASELINE_LABEL_BLOCK_BY_PE.PE1, VE_ID_BY_PE.PE2))} · PE1→PE3 ${formatLabelBlockResult(deriveVplsDemuxLabel(BASELINE_LABEL_BLOCK_BY_PE.PE3, VE_ID_BY_PE.PE1))} · PE3→PE1 ${formatLabelBlockResult(deriveVplsDemuxLabel(BASELINE_LABEL_BLOCK_BY_PE.PE1, VE_ID_BY_PE.PE3))} · PE2→PE3 ${formatLabelBlockResult(deriveVplsDemuxLabel(BASELINE_LABEL_BLOCK_BY_PE.PE3, VE_ID_BY_PE.PE2))} · PE3→PE2 ${formatLabelBlockResult(deriveVplsDemuxLabel(BASELINE_LABEL_BLOCK_BY_PE.PE2, VE_ID_BY_PE.PE3))}. Every one of these six values came from the label-block formula — none was a hardcoded peer-label lookup.`,
  },
  {
    id: "pw-mesh-up",
    label: "Full PW Mesh: UP",
    narrative: "With membership discovered in both directions on every pair, and every directional label covered by its block, all three logical pseudowires come up: PE1↔PE2, PE1↔PE3, PE2↔PE3 — a full mesh, signaled entirely by BGP.",
    run: (state) => ({ state: applyMembershipRecompute(state), events: [{ type: "VPN_ROUTE_INSTALLED", stepId: "pw-mesh-up", timestamp: Date.now(), message: "Full BGP-signaled VPLS PW mesh installed" }] }),
    whatChanged: () => ["PW PE1-PE2, PE1-PE3, PE2-PE3: all UP — signaled entirely by BGP"],
  },
  {
    id: "bgp-table-no-macs",
    label: "The Mandatory Check: What's In The BGP Table?",
    narrative: "BGP VPLS table, right now: PE memberships ✓, VE IDs ✓, label blocks ✓, Route Targets ✓, PW signaling ✓. Customer MACs: ✕ — nothing about CE1, CE2, or CE3's MAC address has ever appeared in any BGP UPDATE.",
  },
  {
    id: "fdb-empty-recap",
    label: "Every FDB Is Still Empty",
    narrative: "Despite a fully-signaled BGP-VPLS mesh, PE1/PE2/PE3's Ethernet FDBs are completely empty. Customer MAC learning remains data-plane learning, exactly like traditional VPLS — BGP built the mesh; it did not build the MAC table.",
  },
  {
    id: "send-ce1-to-ce2-1",
    label: "CE1 Sends A Frame To CE2",
    narrative: `CE1 sends an ordinary Ethernet frame — Src ${CE_MAC.CE1}, Dst ${CE_MAC.CE2}. PE1 receives it, unlabeled, on its AC.`,
    packet: () => ({ id: "ce1-frame-1", protocol: "IP", from: "CE1", to: "CE1", summary: "Ethernet frame toward CE2", layers: [ethLayer(ceFrame("CE1", "CE2", "First frame — CE1 to CE2"))] }),
    run: (state) => ({ state: { ...state, packet: { frame: ceFrame("CE1", "CE2", "First frame — CE1 to CE2"), labels: [] }, packetAt: "CE1", journey: [], floodCopies: undefined }, events: [{ type: "PACKET_SENT", stepId: "send-ce1-to-ce2-1", timestamp: Date.now(), message: "CE1 sends Ethernet frame toward CE2" }] }),
  },
  {
    id: "pe1-learn-ce1",
    label: "PE1: Learn Source MAC",
    narrative: `PE1 learns ${CE_MAC.CE1} on its AC port — the first entry in its FDB, learned purely from the data plane.`,
    packet: (state) => (state.packet ? vplsPacket("pe1-ac-in", "CE1", "PE1", "Ethernet frame", "AC", state.packet) : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const { fdb, change } = learnSourceMac(fdbFor(state, "PE1"), CE_MAC.CE1, { kind: "AC", peer: "CE1" });
      const journey = [...state.journey, { device: "PE1" as VplsRouterId, input: "Ethernet frame (unlabeled)", lookup: `Learn source ${CE_MAC.CE1} on AC: CE1`, action: "AC_INGRESS" as JourneyAction, output: `FDB[PE1]: ${CE_MAC.CE1} → AC: CE1 (${change})` }];
      return { state: { ...state, packetAt: "PE1", journey, fdb: { ...state.fdb, PE1: fdb } }, events: [{ type: "MAC_LEARNED", stepId: "pe1-learn-ce1", timestamp: Date.now(), message: `PE1 learns ${CE_MAC.CE1} on AC: CE1` }] };
    },
    whatChanged: () => [`PE1 FDB: + ${CE_MAC.CE1} → AC: CE1`],
  },
  {
    id: "pe1-lookup-ce2-unknown",
    label: "PE1: Destination Lookup — Unknown",
    narrative: `PE1 looks up ${CE_MAC.CE2}. No entry — UNKNOWN_UNICAST.`,
    run: (state) => {
      const lookup = lookupDestinationMac(fdbFor(state, "PE1"), CE_MAC.CE2);
      const journey = [...state.journey, { device: "PE1" as VplsRouterId, input: CE_MAC.CE2, lookup: "FDB lookup — no entry found", action: "LOOKUP_DEST" as JourneyAction, output: lookup.kind }];
      return { state: { ...state, journey, lastDecision: "UNKNOWN_UNICAST" }, events: [] };
    },
  },
  {
    id: "predict-unknown-unicast-bgp",
    label: "Predict",
    narrative: "Before continuing:",
    question: {
      prompt: "PE1 doesn't know where CE2's MAC is. Since BGP already signaled the whole mesh, should PE1 ask BGP where CE2 is?",
      options: [
        { id: "flood", label: "No — flood it out every other eligible bridge port, exactly like classic VPLS always has" },
        { id: "ask-bgp", label: "Yes — query the BGP VPLS table for the MAC's location" },
        { id: "drop", label: "Drop the frame — an unknown destination cannot be forwarded" },
        { id: "guess-pe2", label: "Guess CE2 is behind PE2 and send only there" },
      ],
      correctOptionId: "flood",
      explanation: "BGP never carried a customer MAC route to ask. Unknown-unicast still means flood, exactly as in targeted-LDP VPLS — the signaling protocol underneath the pseudowires changed; the Ethernet bridging behavior on top did not.",
    },
  },
  {
    id: "pe1-flood-decision",
    label: "PE1: Compute Flood Egress Set",
    narrative: "PE1's bridge ports: AC: CE1 (ingress — excluded), PW: PE2, PW: PE3. Ingress was the AC, so split horizon doesn't apply. Raw egress = final egress = [PW: PE2, PW: PE3].",
    run: (state) => {
      const ports = portsFor(state, "PE1");
      const ingress: FdbPort = { kind: "AC", peer: "CE1" };
      const lookup = lookupDestinationMac(fdbFor(state, "PE1"), CE_MAC.CE2);
      const raw = computeVplsEgressSet(ports, ingress, lookup);
      const final = applySplitHorizon(raw, ingress);
      const decision = classifyForwardingDecision(lookup, raw, final);
      const journey = [...state.journey, { device: "PE1" as VplsRouterId, input: CE_MAC.CE2, lookup: `Egress set: [${raw.map(portLabel).join(", ")}]`, action: "REPLICATE" as JourneyAction, output: `Flood to: ${final.map(portLabel).join(", ")}` }];
      return { state: { ...state, journey, lastDecision: decision }, events: [] };
    },
    whatChanged: () => ["PE1 decision: UNKNOWN_UNICAST → flood to PW: PE2 and PW: PE3"],
  },
  {
    id: "flood-copy-visual",
    label: "Two Replicas Leave PE1",
    narrative: "PE1 pushes a separate two-label stack for each replica — one toward PE2, one toward PE3 — using BGP-derived labels this time instead of targeted-LDP-advertised ones.",
    packet: (state) => (state.packet ? vplsPacket("flood-both", "PE1", "PE1", "Replicate: 2 copies", "FLOOD", state.packet) : undefined),
    run: (state) => ({ state: { ...state, floodCopies: [{ id: "fc-pe2", fromPe: "PE1", toPe: "PE2" }, { id: "fc-pe3", fromPe: "PE1", toPe: "PE3" }] }, events: [] }),
  },
  {
    id: "pe1-push-copy-pe2",
    label: "PE1 → PE2: Push Two Labels",
    narrative: `Following the copy addressed to PE2: PE1 pushes the BGP-derived service label (${formatLabelBlockResult(deriveVplsDemuxLabel(BASELINE_LABEL_BLOCK_BY_PE.PE2, VE_ID_BY_PE.PE1))}) — computed from PE2's label block, not a targeted-LDP-advertised value — then the transport label toward P1.`,
    packet: (state) => {
      if (!state.packet) return undefined;
      const label = pwLabelToward(state, "PE1", "PE2");
      if (label === undefined) return undefined;
      const withStack = buildVplsLabelStack(state.packet.frame, label, transportLabelFor("P1", "PE2"));
      return vplsPacket("pe1-push-pe2", "PE1", "P1", "PUSH BGP-derived PW + transport", "PUSH", withStack);
    },
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const label = pwLabelToward(state, "PE1", "PE2");
      if (label === undefined) return { state, events: [] };
      const packet = buildVplsLabelStack(state.packet.frame, label, transportLabelFor("P1", "PE2"));
      const journey = [...state.journey, { device: "PE1" as VplsRouterId, input: "Ethernet frame", lookup: `Resolve BGP-derived label toward PE2 (${label}) + transport LSP to PE2`, action: "PUSH_PW" as JourneyAction, output: `label ${transportLabelFor("P1", "PE2")} (transport) + label ${label} (service)` }];
      return { state: { ...state, packetAt: "P1", packet, journey }, events: [{ type: "VPN_LABEL_PUSHED", stepId: "pe1-push-copy-pe2", timestamp: Date.now(), message: "PE1 pushes BGP-derived PW label + transport label toward PE2" }] };
    },
  },
  {
    id: "core-forward-to-pe2",
    label: "P1 → P2: Transport Forward + PHP",
    narrative: `P1 swaps the outer label toward P2, never touching the inner BGP-derived service label. P2, directly attached to PE2, pops the transport label entirely (PHP).`,
    packet: (state) => (state.packet ? vplsPacket("core-to-pe2", "P1", "PE2", "Swap, then PHP", "SWAP/POP", state.packet) : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const afterP1 = processCoreTransportLabel(state.packet, transportLabelFor("P2", "PE2"));
      const afterP2 = processCoreTransportLabel(afterP1, "IMPLICIT_NULL");
      const journey = [
        ...state.journey,
        { device: "P1" as VplsRouterId, input: `label ${transportLabelFor("P1", "PE2")}`, lookup: "Transport forwarding — outer label only", action: "SWAP_TRANSPORT" as JourneyAction, output: `label ${transportLabelFor("P2", "PE2")} (transport), inner service label untouched` },
        { device: "P2" as VplsRouterId, input: `label ${transportLabelFor("P2", "PE2")}`, lookup: "Transport forwarding — PHP toward PE2", action: "POP_TRANSPORT" as JourneyAction, output: "Service label only" },
      ];
      return { state: { ...state, packetAt: "PE2", packet: afterP2, journey }, events: [{ type: "TRANSPORT_LABEL_SWAPPED", stepId: "core-forward-to-pe2", timestamp: Date.now(), message: "Core forwards toward PE2 on transport label alone; P1/P2 never see BGP VPLS state" }] };
    },
  },
  {
    id: "pe2-pw-lookup-learn-ce1",
    label: "PE2: Service-Label Lookup + Learn CE1",
    narrative: `PE2 resolves the incoming service label to CUST-A-VPLS, arriving on PW: PE1. It learns ${CE_MAC.CE1} → PW: PE1 in its own FDB — remote MAC locations are still learned from the data plane, exactly like classic VPLS.`,
    packet: (state) => (state.packet ? vplsPacket("pe2-pw-in", "P2", "PE2", "Service label lookup", "PW", state.packet) : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const label = resolveIncomingPwLabel(state.packet);
      const { fdb, change } = learnSourceMac(fdbFor(state, "PE2"), CE_MAC.CE1, { kind: "PW", peer: "PE1" });
      const journey = [...state.journey, { device: "PE2" as VplsRouterId, input: `label ${label}`, lookup: `Service label → CUST-A-VPLS, ingress PW: PE1; learn source ${CE_MAC.CE1}`, action: "PW_INGRESS" as JourneyAction, output: `FDB[PE2]: ${CE_MAC.CE1} → PW: PE1 (${change})` }];
      return { state: { ...state, journey, fdb: { ...state.fdb, PE2: fdb } }, events: [{ type: "MAC_LEARNED", stepId: "pe2-pw-lookup-learn-ce1", timestamp: Date.now(), message: `PE2 learns ${CE_MAC.CE1} on PW: PE1` }] };
    },
    whatChanged: () => [`PE2 FDB: + ${CE_MAC.CE1} → PW: PE1`],
  },
  {
    id: "pe2-deliver-ce2",
    label: "PE2: Flood To Local AC — CE2 Receives",
    narrative: `PE2 doesn't know ${CE_MAC.CE2} yet either — but CE2 IS behind PE2's own AC. Raw egress = [AC: CE2, PW: PE3]; ingress was a PW, so split horizon strips PW: PE3 → final egress = [AC: CE2]. Ordinary flooding delivers the frame to CE2.`,
    packet: (state) => (state.packet ? { id: "pe2-deliver", protocol: "IP", from: "PE2", to: "PE2", summary: "Delivered to CE2 via AC (flooded)", layers: [ethLayer(deliverEthernetFrame(state.packet))] } : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const ports = portsFor(state, "PE2");
      const ingress: FdbPort = { kind: "PW", peer: "PE1" };
      const lookup = lookupDestinationMac(fdbFor(state, "PE2"), CE_MAC.CE2);
      const raw = computeVplsEgressSet(ports, ingress, lookup);
      const final = applySplitHorizon(raw, ingress);
      const decision = classifyForwardingDecision(lookup, raw, final);
      const journey = [
        ...state.journey,
        { device: "PE2" as VplsRouterId, input: CE_MAC.CE2, lookup: `Egress set: [${raw.map(portLabel).join(", ")}] → split horizon → [${final.map(portLabel).join(", ")}]`, action: "SPLIT_HORIZON_BLOCK" as JourneyAction, output: `Deliver to: ${final.map(portLabel).join(", ")}` },
        { device: "CE2" as VplsRouterId, input: "Ethernet frame", lookup: "AC delivery — destination MAC matches CE2", action: "AC_EGRESS" as JourneyAction, output: "Delivered and accepted" },
      ];
      return { state: { ...state, packetAt: "CE2", packet: state.packet, journey, lastDecision: decision }, events: [{ type: "VPN_PACKET_DELIVERED", stepId: "pe2-deliver-ce2", timestamp: Date.now(), message: "PE2 delivers flooded frame to CE2" }] };
    },
    whatChanged: () => ["CE2 receives the frame — its destination MAC matches, so it accepts it"],
  },
  {
    id: "pe3-parallel-copy",
    label: "Meanwhile, At PE3: The Other Replica",
    narrative: `PE3's copy takes the parallel path PE1 → P1 → P3 → PE3, pushed with the BGP-derived label toward PE3 (${formatLabelBlockResult(deriveVplsDemuxLabel(BASELINE_LABEL_BLOCK_BY_PE.PE3, VE_ID_BY_PE.PE1))}), PHP at P3. PE3 learns ${CE_MAC.CE1} → PW: PE1. Split horizon strips PW: PE2 from its egress (ingress was a PW) → final egress = [AC: CE3]. CE3 receives a copy but discards it — wrong destination MAC, ordinary NIC behavior, not a VPLS mechanism.`,
    run: (state) => {
      const { fdb } = learnSourceMac(fdbFor(state, "PE3"), CE_MAC.CE1, { kind: "PW", peer: "PE1" });
      return { state: { ...state, fdb: { ...state.fdb, PE3: fdb } }, events: [{ type: "MAC_LEARNED", stepId: "pe3-parallel-copy", timestamp: Date.now(), message: `PE3 learns ${CE_MAC.CE1} on PW: PE1` }] };
    },
    whatChanged: () => [`PE3 FDB: + ${CE_MAC.CE1} → PW: PE1`, "CE3 receives a copy of the flooded frame and discards it (wrong destination MAC)"],
  },
  {
    id: "split-horizon-intro",
    label: "Split Horizon: Same Rule, New Signaling",
    narrative: "PE2 never relayed onto PW: PE3, and PE3 never relayed onto PW: PE2 — pseudowire split horizon, unchanged from targeted-LDP VPLS. BGP replaced how the PWs were signaled; it did not touch this loop-prevention rule at all.",
  },
  {
    id: "split-horizon-visual",
    label: "The Rule, Stated Plainly",
    narrative: "A local AC may flood a frame out to several pseudowires. A frame received FROM one classic-VPLS mesh pseudowire is never relayed out ANOTHER mesh pseudowire — regardless of whether that pseudowire was signaled by targeted LDP or by BGP.",
  },
  {
    id: "ce2-sends-to-ce1",
    label: "CE2 Sends A Unicast Frame To CE1",
    narrative: `CE2 sends Src ${CE_MAC.CE2}, Dst ${CE_MAC.CE1}. PE2 receives it on its AC.`,
    packet: () => ({ id: "ce2-frame", protocol: "IP", from: "CE2", to: "CE2", summary: "Ethernet frame toward CE1", layers: [ethLayer(ceFrame("CE2", "CE1", "Return frame — CE2 to CE1"))] }),
    run: (state) => ({ state: { ...state, packet: { frame: ceFrame("CE2", "CE1", "Return frame — CE2 to CE1"), labels: [] }, packetAt: "CE2", journey: [], floodCopies: undefined }, events: [{ type: "PACKET_SENT", stepId: "ce2-sends-to-ce1", timestamp: Date.now(), message: "CE2 sends Ethernet frame toward CE1" }] }),
  },
  {
    id: "pe2-learn-ce2-local",
    label: "PE2: Learn CE2, Look Up CE1",
    narrative: `PE2 learns ${CE_MAC.CE2} → AC: CE2, then looks up ${CE_MAC.CE1} — already known from the earlier flood: → PW: PE1 (REMOTE_UNICAST). No flooding required.`,
    packet: (state) => (state.packet ? vplsPacket("pe2-ac-in", "CE2", "PE2", "Ethernet frame", "AC", state.packet) : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const { fdb } = learnSourceMac(fdbFor(state, "PE2"), CE_MAC.CE2, { kind: "AC", peer: "CE2" });
      const lookup = lookupDestinationMac(fdb, CE_MAC.CE1);
      const journey = [{ device: "PE2" as VplsRouterId, input: "Ethernet frame (unlabeled)", lookup: `Learn ${CE_MAC.CE2} on AC: CE2; look up ${CE_MAC.CE1}`, action: "LEARN_SOURCE" as JourneyAction, output: lookup.kind }];
      return { state: { ...state, packetAt: "PE2", journey, fdb: { ...state.fdb, PE2: fdb }, lastDecision: "REMOTE_UNICAST" }, events: [{ type: "MAC_LEARNED", stepId: "pe2-learn-ce2-local", timestamp: Date.now(), message: `PE2 learns ${CE_MAC.CE2} on AC: CE2` }] };
    },
    whatChanged: () => [`PE2 FDB: + ${CE_MAC.CE2} → AC: CE2`, `Lookup for ${CE_MAC.CE1}: REMOTE_UNICAST → PW: PE1 (already known)`],
  },
  {
    id: "pe2-direct-to-pe1",
    label: "PE2: Known Unicast — One Copy, Direct",
    narrative: `PE2 pushes the BGP-derived label toward PE1 (${formatLabelBlockResult(deriveVplsDemuxLabel(BASELINE_LABEL_BLOCK_BY_PE.PE1, VE_ID_BY_PE.PE2))}) and sends a single direct copy. PE3 never sees this frame.`,
    packet: (state) => {
      if (!state.packet) return undefined;
      const label = pwLabelToward(state, "PE2", "PE1");
      if (label === undefined) return undefined;
      return vplsPacket("pe2-push", "PE2", "P2", "PUSH BGP-derived PW + transport (known unicast)", "PUSH", buildVplsLabelStack(state.packet.frame, label, transportLabelFor("P2", "PE1")));
    },
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const label = pwLabelToward(state, "PE2", "PE1");
      if (label === undefined) return { state, events: [] };
      const packet = buildVplsLabelStack(state.packet.frame, label, transportLabelFor("P2", "PE1"));
      const journey = [...state.journey, { device: "PE2" as VplsRouterId, input: "Ethernet frame", lookup: "Known unicast — single direct copy toward PW: PE1", action: "PUSH_PW" as JourneyAction, output: `label ${transportLabelFor("P2", "PE1")} (transport) + label ${label} (service)` }];
      return { state: { ...state, packetAt: "P2", packet, journey }, events: [{ type: "VPN_LABEL_PUSHED", stepId: "pe2-direct-to-pe1", timestamp: Date.now(), message: "PE2 pushes labels for known-unicast delivery to PE1" }] };
    },
    whatChanged: () => ["Exactly one copy leaves PE2 — no flooding, no replication"],
  },
  {
    id: "pe1-learn-ce2-remote",
    label: "PE1: Deliver, And Learn CE2",
    narrative: "The core forwards via P2 → P1 (PHP at P1), PE1 resolves the service label, learns CE2 → PW: PE2, and delivers to CE1. Both directions are now fully learned at both PEs.",
    packet: (state) => (state.packet ? { id: "pe1-deliver", protocol: "IP", from: "PE1", to: "PE1", summary: "Delivered to CE1", layers: [ethLayer(deliverEthernetFrame(processCoreTransportLabel(processCoreTransportLabel(state.packet, transportLabelFor("P1", "PE1")), "IMPLICIT_NULL")))] } : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const afterP2 = processCoreTransportLabel(state.packet, transportLabelFor("P1", "PE1"));
      const afterP1 = processCoreTransportLabel(afterP2, "IMPLICIT_NULL");
      const { fdb } = learnSourceMac(fdbFor(state, "PE1"), CE_MAC.CE2, { kind: "PW", peer: "PE2" });
      const journey = [
        ...state.journey,
        { device: "P2" as VplsRouterId, input: `label ${transportLabelFor("P2", "PE1")}`, lookup: "Transport forwarding — outer label only", action: "SWAP_TRANSPORT" as JourneyAction, output: `label ${transportLabelFor("P1", "PE1")} (transport)` },
        { device: "PE1" as VplsRouterId, input: "service label", lookup: `Service label → CUST-A-VPLS; learn ${CE_MAC.CE2} on PW: PE2; deliver to AC: CE1`, action: "PW_LOOKUP" as JourneyAction, output: "Delivered to CE1" },
      ];
      return { state: { ...state, packetAt: "CE1", packet: afterP1, journey, fdb: { ...state.fdb, PE1: fdb } }, events: [{ type: "VPN_PACKET_DELIVERED", stepId: "pe1-learn-ce2-remote", timestamp: Date.now(), message: "PE1 delivers to CE1 and learns CE2 remotely" }] };
    },
    whatChanged: () => [`PE1 FDB: + ${CE_MAC.CE2} → PW: PE2`, "CE1 receives the reply — the round trip is complete"],
  },
  {
    id: "known-unicast-recap",
    label: "Data-Plane Learning, Unchanged",
    narrative: "FIRST FRAME: PE1 floods (unknown), PE2 and PE3 both learn CE1, only CE2 accepts. RETURN FRAME: PE2 already knows PE1 — direct, single copy. Every mechanic is identical to targeted-LDP VPLS — only the label values underneath came from BGP's label-block math instead of targeted LDP.",
  },
  {
    id: "predict-bgp-doesnt-carry-macs",
    label: "Predict",
    narrative: "Before continuing:",
    question: {
      prompt: "In RFC 4761 BGP VPLS, does BGP distribute customer MAC addresses?",
      options: [
        { id: "no", label: "No — BGP distributes membership, VE IDs, and label blocks; MACs are learned entirely from the Ethernet data plane" },
        { id: "yes", label: "Yes — every learned MAC is advertised as a BGP route to every other PE" },
        { id: "only-known", label: "Only known-unicast MACs, never ones learned via flooding" },
        { id: "yes-via-l2info", label: "Yes — inside the Layer2 Info Extended Community" },
      ],
      correctOptionId: "no",
      explanation: "You just watched PE2 and PE1 learn CE1/CE2's MAC addresses purely by observing Ethernet frames — nothing in any BGP UPDATE ever named a customer MAC. That's the defining difference from EVPN, which DOES carry MAC/IP reachability in its own route types.",
    },
  },
  {
    id: "ldp-vpls-vs-bgp-vpls",
    label: "Traditional (LDP) VPLS vs. BGP-Signaled VPLS",
    narrative: "LDP VPLS — PE discovery: configured/separate mechanism. PW signaling: targeted LDP, one session per pair. MAC learning: data plane. BGP VPLS — PE discovery: BGP (RT-based auto-discovery). PW signaling: BGP (label blocks, one session per PE via RR). MAC learning: STILL data plane. The data-plane column never changes.",
  },
  {
    id: "bgp-vpls-vs-evpn",
    label: "BGP VPLS vs. EVPN — The Most Important Comparison",
    narrative: "BGP VPLS: BGP distributes VPLS membership + label-block signaling; BGP does NOT distribute customer MAC routes; MAC learning is data-plane. EVPN: BGP distributes Ethernet service reachability AND MAC/IP reachability through its own EVPN route types (Type 2, etc.); remote MAC learning becomes control-plane capable. BGP-signaled VPLS is not EVPN, even though both use BGP.",
  },
  {
    id: "why-evpn-developed-note",
    label: "Why EVPN Was Developed Anyway",
    narrative: "BGP-VPLS still relies on flooding to discover unknown MACs and has no protection against a stale relearn during a host move. EVPN's Type 2 routes and MAC Mobility sequence number exist specifically to close those two gaps — a genuinely different control-plane capability, not a rebrand of what you just built.",
  },
  {
    id: "predict-switching-doesnt-remove-learning",
    label: "Predict",
    narrative: "Before continuing:",
    question: {
      prompt: "Does switching from targeted-LDP VPLS to BGP-signaled VPLS remove traditional Ethernet MAC learning and flooding?",
      options: [
        { id: "no", label: "No — the Ethernet bridging data plane is completely unchanged; only PW signaling changed" },
        { id: "yes", label: "Yes — BGP signaling replaces the need for MAC learning entirely" },
        { id: "yes-partially", label: "Yes, for known unicast; flooding is still needed for BUM" },
        { id: "only-for-new-pes", label: "Only for PEs that joined the mesh after the BGP migration" },
      ],
      correctOptionId: "no",
      explanation: "Every MAC-learning, flooding, and split-horizon mechanic you saw is identical to the targeted-LDP lesson. BGP changed how the pseudowires are discovered and labeled — nothing about the Ethernet bridge on top of them.",
    },
  },
  {
    id: "control-data-both-recap",
    label: "Control / Data / Both",
    narrative: "Control: IGP, transport LDP, MP-BGP, route reflection, VPLS NLRI, RT import/export, VE ID, label blocks, PW setup. Data: Ethernet source-MAC learning, flooding, split horizon, known-unicast switching, MPLS transport, the BGP-derived service label. Both are required together — BGP builds service PW state; Ethernet frames populate the FDB; useful VPLS forwarding needs both.",
  },
  {
    id: "label-block-expansion-intro",
    label: "Advanced: What Happens Outside The Block?",
    narrative: `So far every VE ID (1, 2, 3) fell inside every advertised block (VBO ${BASELINE_LABEL_BLOCK_BY_PE.PE1.vbo}, VBS ${BASELINE_LABEL_BLOCK_BY_PE.PE1.vbs}). What happens when a PE's own VE ID falls OUTSIDE a remote PE's block?`,
  },
  {
    id: "pe3-ve-id-change-to-7",
    label: "PE3's VE ID Changes To 7",
    narrative: "PE3 is reconfigured with VE ID 7 instead of 3 — a real operational change (a renumbering, a template applied inconsistently). PE3 re-advertises with its new VE ID; PE1 and PE2's existing blocks (VBO 1, VBS 4 — covering remote VE IDs 1-4) do not cover 7.",
    run: (state) => {
      const nlri = buildVplsNlri("PE3", RD_BY_PE.PE3, 7, state.labelBlocksByPe.PE3, state.exportRtByPe.PE3, ROUTER_LOOPBACK.PE3 ?? "");
      const next = applyMembershipRecompute({ ...state, veIdByPe: { ...state.veIdByPe, PE3: 7 }, localAdvertisements: { ...state.localAdvertisements, PE3: nlri } });
      return { state: next, events: [{ type: "BGP_UPDATE_SENT", stepId: "pe3-ve-id-change-to-7", timestamp: Date.now(), message: "PE3 re-advertises with VE ID 7" }] };
    },
    whatChanged: () => ["PE3 VE ID: 3 → 7"],
  },
  {
    id: "predict-out-of-block",
    label: "Predict",
    narrative: "Before continuing:",
    question: {
      prompt: "PE3's VE ID (7) is outside PE1's and PE2's existing remote VE sets (1-4). Should PE1 invent a label for PE3 anyway?",
      options: [
        { id: "no", label: "No — an out-of-block VE ID gets no fabricated label; that direction of the PW simply does not install" },
        { id: "yes-extrapolate", label: "Yes — extrapolate the formula beyond the advertised block size" },
        { id: "yes-reuse", label: "Yes — reuse the label already assigned to VE ID 3" },
        { id: "yes-zero", label: "Yes — fall back to label 0 as a wildcard" },
      ],
      correctOptionId: "no",
      explanation: "The domain model returns a semantic VE_ID_ABOVE_BLOCK state rather than a number. No label is fabricated outside an advertised block — the direction stays down until the block is actually expanded (or the VE ID is corrected).",
    },
  },
  {
    id: "out-of-block-symptom",
    label: "Symptom: Two Legs Down, One Unaffected",
    narrative: `PE3→PE1 and PE3→PE2 (both computed using PE3's own VE ID against PE1's/PE2's blocks) are now VE_ID_ABOVE_BLOCK — uncovered. PE1↔PE2 (never involving PE3's VE ID at all) is completely unaffected — exactly the "one otherwise-healthy variable changes" pattern.`,
  },
  {
    id: "expand-block-pe1",
    label: "PE1 Expands Its Advertised Block",
    narrative: `PE1 widens its block to VBO ${BASELINE_LABEL_BLOCK_BY_PE.PE1.vbo}, VBS 8 (same Label Base ${BASELINE_LABEL_BLOCK_BY_PE.PE1.labelBase}) — now covering remote VE IDs 1 through 8, including 7. Existing VE IDs 1-4 keep their exact same computed labels; nothing already working changes.`,
    run: (state) => {
      const widened = expandLabelBlock(state.labelBlocksByPe.PE1, 4);
      const nlri = buildVplsNlri("PE1", RD_BY_PE.PE1, state.veIdByPe.PE1, widened, state.exportRtByPe.PE1, ROUTER_LOOPBACK.PE1 ?? "");
      const next = applyMembershipRecompute({ ...state, labelBlocksByPe: { ...state.labelBlocksByPe, PE1: widened }, localAdvertisements: { ...state.localAdvertisements, PE1: nlri } });
      return { state: next, events: [{ type: "BGP_UPDATE_SENT", stepId: "expand-block-pe1", timestamp: Date.now(), message: "PE1 re-advertises with an expanded label block (VBS 4 → 8)" }] };
    },
    whatChanged: () => ["PE1 block: VBS 4 → 8 — now covers remote VE IDs 1-8"],
  },
  {
    id: "expand-block-pe2",
    label: "PE2 Expands Its Advertised Block",
    narrative: "PE2 does the same — VBS 4 → 8, same Label Base, now covering VE ID 7 too.",
    run: (state) => {
      const widened = expandLabelBlock(state.labelBlocksByPe.PE2, 4);
      const nlri = buildVplsNlri("PE2", RD_BY_PE.PE2, state.veIdByPe.PE2, widened, state.exportRtByPe.PE2, ROUTER_LOOPBACK.PE2 ?? "");
      const next = applyMembershipRecompute({ ...state, labelBlocksByPe: { ...state.labelBlocksByPe, PE2: widened }, localAdvertisements: { ...state.localAdvertisements, PE2: nlri } });
      return { state: next, events: [{ type: "BGP_UPDATE_SENT", stepId: "expand-block-pe2", timestamp: Date.now(), message: "PE2 re-advertises with an expanded label block (VBS 4 → 8)" }] };
    },
    whatChanged: () => ["PE2 block: VBS 4 → 8 — now covers remote VE IDs 1-8", "PE3→PE1 and PE3→PE2 now COVERED — full mesh restored with VE ID 7"],
  },
  {
    id: "label-block-lesson",
    label: "The Label-Block Takeaway",
    narrative: "Label Base is not simply \"the peer's PW label.\" It is the start of a block. The actual label for a given sender is derived using the sender's VE ID and the block offset — and when a VE ID falls outside every advertised block, the correct behavior is no PW in that direction, never a guessed number.",
  },
  {
    id: "veid-reset-rejoin",
    label: "PE3 Renumbers Back To VE ID 3",
    narrative: "For the rest of this lesson, PE3 returns to its original VE ID 3 — a clean baseline before the next incident.",
    run: (state) => {
      const nlri = buildVplsNlri("PE3", RD_BY_PE.PE3, 3, state.labelBlocksByPe.PE3, state.exportRtByPe.PE3, ROUTER_LOOPBACK.PE3 ?? "");
      const next = applyMembershipRecompute({ ...state, veIdByPe: { ...state.veIdByPe, PE3: 3 }, localAdvertisements: { ...state.localAdvertisements, PE3: nlri } });
      return { state: next, events: [] };
    },
    whatChanged: () => ["PE3 VE ID: 7 → 3 (baseline restored)"],
  },
  {
    id: "withdrawal-intro",
    label: "Withdrawal: PE3 Leaves CUST-A-VPLS",
    narrative: "Now a genuine control-plane departure: PE3 withdraws its VPLS advertisement entirely — modeling a decommission, a maintenance window, or a misconfiguration removed.",
  },
  {
    id: "pe3-withdraws",
    label: "PE3 Withdraws Its VPLS NLRI",
    narrative: "PE1 and PE2 should remove PE3 membership and PE3-facing PW/service forwarding — without affecting PE1↔PE2 service at all.",
    packet: (state) => (state.localAdvertisements.PE3 ? bgpUpdatePacket("pe3-withdraw", "PE3", "RR1", "VPLS NLRI — WITHDRAW", "WITHDRAW", nlriFields(state.localAdvertisements.PE3)) : undefined),
    run: (state) => {
      const next = applyMembershipRecompute({ ...state, localAdvertisements: withdrawVplsNlri(state.localAdvertisements, "PE3") });
      const bgpJourney = [...state.bgpJourney, { device: "PE3" as VplsRouterId, input: "administrative withdrawal", lookup: "Remove local VPLS NLRI", action: "WITHDRAW" as BgpJourneyAction, output: "PE1/PE2 remove PE3 membership and PW state" }];
      return { state: { ...next, bgpJourney }, events: [{ type: "VPN_ROUTE_WITHDRAWN", stepId: "pe3-withdraws", timestamp: Date.now(), message: "PE3 withdraws its VPLS NLRI" }] };
    },
    whatChanged: () => ["PE3 membership withdrawn — PW PE1-PE3 and PE2-PE3: DOWN. PW PE1-PE2: unaffected"],
  },
  {
    id: "pe3-rejoins",
    label: "PE3 Rejoins",
    narrative: "PE3 re-advertises its VPLS NLRI (RD, VE ID 3, its label block, RT) — a fresh BGP UPDATE, not a cached state restoration. Membership and PW state rebuild from this new advertisement.",
    run: (state) => {
      const nlri = buildVplsNlri("PE3", RD_BY_PE.PE3, 3, state.labelBlocksByPe.PE3, state.exportRtByPe.PE3, ROUTER_LOOPBACK.PE3 ?? "");
      const next = applyMembershipRecompute({ ...state, localAdvertisements: { ...state.localAdvertisements, PE3: nlri } });
      return { state: next, events: [{ type: "BGP_UPDATE_SENT", stepId: "pe3-rejoins", timestamp: Date.now(), message: "PE3 re-advertises its VPLS NLRI" }] };
    },
    whatChanged: () => ["PW PE1-PE3, PE2-PE3: DOWN → UP — full mesh restored"],
  },
  {
    id: "troubleshooting-intro",
    label: "INCIDENT",
    narrative: "CE1 ↔ CE2 works fine. CE3 cannot participate in CUST-A-VPLS at all. PE3 can reach every PE loopback. MPLS transport is healthy. PE3's MP-BGP session to RR1 is Established.",
    run: (state) => ({ state: { ...state, troubleshooting: { ...state.troubleshooting, started: true } }, events: [] }),
  },
  {
    id: "fault-injection",
    label: "Fault: PE3's Route Target Is Wrong",
    narrative: `PE1 and PE2 both import/export ${CUST_A_RT} for CUST-A-VPLS. PE3 has somehow been configured with import/export RT 65000:999 instead — a real, deterministic policy fault. Physical interfaces, IGP, MPLS transport, and PE3's BGP session to RR1 all remain healthy.`,
    run: (state) => {
      const next = applyMembershipRecompute({ ...state, importRtByPe: { ...state.importRtByPe, PE3: "65000:999" }, exportRtByPe: { ...state.exportRtByPe, PE3: "65000:999" } });
      const nlri = buildVplsNlri("PE3", RD_BY_PE.PE3, next.veIdByPe.PE3, next.labelBlocksByPe.PE3, "65000:999", ROUTER_LOOPBACK.PE3 ?? "");
      const final = applyMembershipRecompute({ ...next, localAdvertisements: { ...next.localAdvertisements, PE3: nlri } });
      return {
        state: { ...final, fdb: { PE1: [], PE2: [], PE3: [] }, packet: undefined, packetAt: undefined, journey: [], floodCopies: undefined },
        events: [{ type: "RT_IMPORT_EVALUATED", stepId: "fault-injection", timestamp: Date.now(), message: "PE3 import/export RT changed to 65000:999 — no longer matches CUST-A-VPLS" }],
      };
    },
    whatChanged: () => ["PE3 import/export RT: 65000:100 → 65000:999", "FDB tables reset for a clean diagnostic run"],
  },
  {
    id: "incident-symptoms",
    label: "Why This Is Confusing",
    narrative: "Nothing about PE3's session status changed — it's still Established. Nothing about transport changed. The break is entirely inside service membership policy: PE1 and PE2 no longer import PE3's NLRI, and PE3 no longer imports theirs.",
  },
  {
    id: "predict-established-doesnt-mean-works",
    label: "Predict",
    narrative: "Before continuing:",
    question: {
      prompt: "PE3's BGP session to RR1 shows Established. Does that guarantee CUST-A-VPLS service membership is working?",
      options: [
        { id: "no", label: "No — Established only means the session itself is healthy; RT import is a separate, per-service policy check" },
        { id: "yes", label: "Yes — an Established session always implies every configured address family is fully working" },
        { id: "only-l2vpn", label: "Yes, specifically for the L2VPN/VPLS address family" },
        { id: "depends-on-transport", label: "Yes, as long as MPLS transport is also healthy" },
      ],
      correctOptionId: "no",
      explanation: "This is the same lesson MPLS L3VPN and EVPN both teach with an RT mismatch: a healthy session proves the pipes work, not that policy lets anything through them. \"Established\" and \"RT import succeeded\" are two different questions.",
    },
  },
  {
    id: "received-vs-imported-evidence",
    label: "Received vs. Imported — The Real Evidence",
    narrative: "RR1 still reflects PE3's NLRI to PE1 and PE2 — they RECEIVE it. But their own RT import check (65000:100 vs. PE3's 65000:999) fails, so it is never IMPORTED. Symmetrically, PE3 receives PE1's and PE2's NLRIs but doesn't import them either. Received and imported are not the same thing, and this incident only makes sense once you can see both.",
  },
  {
    id: "diagnostic-ladder",
    label: "Diagnose Before You Fix",
    narrative: "Work the ladder: interfaces, IGP, MPLS transport, PE↔RR1 BGP sessions, L2VPN/VPLS address family, then — only then — each PE's actual configured RT. That's where this one lives.",
  },
  {
    id: "repair-challenge",
    label: "Engineer Challenge: Restore CE3's Membership",
    narrative: "Choose the correct repair.",
    action: (state, payload) => {
      const choice = (payload as { choice?: string } | undefined)?.choice ?? "";
      if (choice !== "fix-pe3-rt") {
        return { state: { ...state, troubleshooting: { ...state.troubleshooting, repairAttempt: { choice, correct: false } } }, events: [] };
      }
      const next = applyMembershipRecompute({ ...state, importRtByPe: { ...state.importRtByPe, PE3: CUST_A_RT }, exportRtByPe: { ...state.exportRtByPe, PE3: CUST_A_RT } });
      const nlri = buildVplsNlri("PE3", RD_BY_PE.PE3, next.veIdByPe.PE3, next.labelBlocksByPe.PE3, CUST_A_RT, ROUTER_LOOPBACK.PE3 ?? "");
      const final = applyMembershipRecompute({ ...next, localAdvertisements: { ...next.localAdvertisements, PE3: nlri } });
      return {
        state: { ...final, troubleshooting: { ...state.troubleshooting, repairAttempt: { choice, correct: true }, repaired: true } },
        events: [{ type: "RT_IMPORT_EVALUATED", stepId: "repair-challenge", timestamp: Date.now(), message: "PE3 RT corrected to 65000:100 — membership restored" }],
      };
    },
    requiresState: (state) => state.troubleshooting.repaired === true,
  },
  {
    id: "repaired-recompute",
    label: "RT Corrected — Membership And PW Mesh Rebuild",
    narrative: "PE3 re-advertises with the corrected RT. PE1 and PE2 now import it; PE3 now imports theirs. Recomputation alone isn't proof — verify with a real frame next.",
    run: (state) => ({ state: { ...state, packet: undefined, packetAt: undefined, journey: [], floodCopies: undefined, fdb: { PE1: [], PE2: [], PE3: [] } }, events: [] }),
    whatChanged: () => ["FDB cleared for a clean verification run"],
  },
  {
    id: "verify-send-ce1-ce3",
    label: "Mandatory Verification: Send CE1 → CE3",
    narrative: "Send a real frame end to end and follow it through every hop.",
    packet: () => ({ id: "verify-frame", protocol: "IP", from: "CE1", to: "CE1", summary: "Ethernet frame toward CE3 (verification)", layers: [ethLayer(ceFrame("CE1", "CE3", "Verification — CE1 to CE3"))] }),
    run: (state) => {
      const { fdb } = learnSourceMac(fdbFor(state, "PE1"), CE_MAC.CE1, { kind: "AC", peer: "CE1" });
      return { state: { ...state, packet: { frame: ceFrame("CE1", "CE3", "Verification — CE1 to CE3"), labels: [] }, packetAt: "PE1", journey: [], fdb: { ...state.fdb, PE1: fdb } }, events: [] };
    },
  },
  {
    id: "verify-flood-deliver",
    label: "PE1: Flood To Both — Including PE3 Again",
    narrative: "CE3's MAC is still unknown, so PE1 floods to both PW: PE2 and PW: PE3 now that the PE1-PE3 PW is genuinely up again.",
    packet: (state) => (state.packet ? vplsPacket("verify-flood", "PE1", "PE1", "Replicate: 2 copies", "FLOOD", state.packet) : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const label = pwLabelToward(state, "PE1", "PE3");
      if (label === undefined) return { state, events: [] };
      const packet = buildVplsLabelStack(state.packet.frame, label, transportLabelFor("P1", "PE3"));
      const journey = [{ device: "PE1" as VplsRouterId, input: "Ethernet frame", lookup: "Bridge ports restored: [AC: CE1, PW: PE2, PW: PE3]", action: "PUSH_PW" as JourneyAction, output: `Flood to PW: PE2 and PW: PE3 — label ${label} toward PE3` }];
      return { state: { ...state, packetAt: "P1", packet, journey, floodCopies: [{ id: "fc-verify-pe2", fromPe: "PE1", toPe: "PE2" }, { id: "fc-verify-pe3", fromPe: "PE1", toPe: "PE3" }] }, events: [] };
    },
  },
  {
    id: "verify-known-unicast-after-learning",
    label: "PE3 Delivers To CE3 — Verified",
    narrative: "P1 forwards on transport alone, PHP at P3, PE3 resolves the BGP-derived service label, learns CE1 on PW: PE1, and floods to its own AC — CE3 finally receives the frame. The RT repair, not any data-plane change, is what fixed this.",
    packet: (state) => (state.packet ? { id: "verify-delivered", protocol: "IP", from: "PE3", to: "PE3", summary: "Delivered to CE3 (verified)", layers: [ethLayer(deliverEthernetFrame(state.packet))] } : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const afterP1 = processCoreTransportLabel(state.packet, transportLabelFor("P3", "PE3"));
      const afterP3 = processCoreTransportLabel(afterP1, "IMPLICIT_NULL");
      const { fdb } = learnSourceMac(fdbFor(state, "PE3"), CE_MAC.CE1, { kind: "PW", peer: "PE1" });
      const journey = [
        ...state.journey,
        { device: "P1" as VplsRouterId, input: "service+transport labels", lookup: "Transport forwarding", action: "SWAP_TRANSPORT" as JourneyAction, output: "swapped toward P3" },
        { device: "PE3" as VplsRouterId, input: "service label", lookup: "Service label → CUST-A-VPLS; learn CE1 on PW: PE1; flood to AC: CE3", action: "AC_EGRESS" as JourneyAction, output: "Delivered to CE3" },
      ];
      return { state: { ...state, packetAt: "CE3", packet: afterP3, journey, fdb: { ...state.fdb, PE3: fdb }, troubleshooting: { ...state.troubleshooting, verified: true } }, events: [{ type: "VPN_PACKET_DELIVERED", stepId: "verify-known-unicast-after-learning", timestamp: Date.now(), message: "Verified: repaired RT restores CE1 ↔ CE3" }] };
    },
    whatChanged: () => ["Verified: CE1 → PE1 → P1 → P3 → PE3 → CE3 restored end to end"],
  },
  {
    id: "engineer-challenge-intro",
    label: "Engineer Challenge: Signal The Virtual LAN",
    narrative: "Recap and confirm: build CUST-A-VPLS across PE1, PE2, and PE3 using BGP for both auto-discovery and pseudowire signaling. Everything below was already demonstrated in this lesson — this is the checklist.",
  },
  {
    id: "engineer-challenge-confirm",
    label: "Confirm Full BGP-Signaled VPLS Coverage",
    narrative: "MPLS transport verified ✓ · PE↔RR1 MP-BGP sessions ESTABLISHED ✓ · L2VPN/VPLS address family active ✓ · Unique RDs configured ✓ · Matching RT membership configured ✓ · Unique VE IDs assigned ✓ · VBO/VBS/Label Base inspected ✓ · VPLS NLRI advertised and reflected ✓ · RT import verified at every PE ✓ · All six directional labels calculated from label blocks ✓ · Full PW mesh established ✓ · Unknown-unicast flooding and MAC learning demonstrated ✓ · Split horizon demonstrated ✓ · Known unicast demonstrated ✓ · Proved BGP never carried a customer MAC ✓ · RT-mismatch incident diagnosed and correctly repaired ✓.",
    requiresState: (state) => state.troubleshooting.verified === true,
  },
  {
    id: "complete",
    label: "Complete",
    narrative: `You replaced targeted LDP with BGP as the VPLS signaling mechanism: MP-BGP auto-discovery via a Route Reflector, RD/RT/VE-ID identity, RFC 4761 label blocks, and BGP UPDATE/WITHDRAW-driven membership — while proving, frame by frame, that the classic VPLS data plane (MAC learning, flooding, split horizon) never changed and that BGP never once carried a customer MAC address. You diagnosed and repaired a Route Target mismatch that left PE3's session healthy but its service membership broken. +${VPLS_XP_AWARD} XP awarded.`,
  },
];

function stepIdx(id: string): number {
  return bgpVplsSteps.findIndex((s) => s.id === id);
}
export const STEP_IDX = {
  topologyIntro: stepIdx("topology-intro"),
  bgpControlTopologyIntro: stepIdx("bgp-control-topology-intro"),
  transportRecapIntro: stepIdx("transport-recap-intro"),
  transportLspUp: stepIdx("transport-lsp-up"),
  mpBgpSessionsUp: stepIdx("mp-bgp-sessions-up"),
  afiSafiIntro: stepIdx("afi-safi-intro"),
  rdIntro: stepIdx("rd-intro"),
  labelBlockIntro: stepIdx("label-block-intro"),
  nlriAnatomy: stepIdx("nlri-anatomy"),
  pe1Advertises: stepIdx("pe1-advertises"),
  fullMeshMembershipRecap: stepIdx("full-mesh-membership-recap"),
  labelBlockViewerPe1: stepIdx("label-block-viewer-pe1"),
  sixLabelsRecap: stepIdx("six-labels-recap"),
  pwMeshUp: stepIdx("pw-mesh-up"),
  bgpTableNoMacs: stepIdx("bgp-table-no-macs"),
  sendCe1ToCe21: stepIdx("send-ce1-to-ce2-1"),
  splitHorizonVisual: stepIdx("split-horizon-visual"),
  ldpVsBgpVpls: stepIdx("ldp-vpls-vs-bgp-vpls"),
  labelBlockExpansionIntro: stepIdx("label-block-expansion-intro"),
  withdrawalIntro: stepIdx("withdrawal-intro"),
  troubleshootingIntro: stepIdx("troubleshooting-intro"),
  faultInjection: stepIdx("fault-injection"),
  diagnosticLadder: stepIdx("diagnostic-ladder"),
  repairChallenge: stepIdx("repair-challenge"),
  engineerChallengeIntro: stepIdx("engineer-challenge-intro"),
  complete: stepIdx("complete"),
};

// ---------------------------------------------------------------------------
// CLI perspectives — CONCEPT / Cisco IOS-XR / Junos.
// ---------------------------------------------------------------------------
export interface BgpVplsCliVendorOutput {
  cmd: string;
  output: string;
}
export interface BgpVplsCliEntry {
  id: string;
  label: string;
  concept: string;
  cisco: BgpVplsCliVendorOutput;
  juniper: BgpVplsCliVendorOutput;
}
export function buildBgpVplsCliCommands(state: BgpVplsState, router: RouterId): BgpVplsCliEntry[] {
  if (router === "RR1") {
    const advertisedPes = PE_ROUTERS.filter((pe) => state.localAdvertisements[pe]);
    return [
      {
        id: "bgp-l2vpn-summary",
        label: "BGP L2VPN/VPLS Peers",
        concept: "RR1's clients for AFI 25 / SAFI 65 — every PE peers only with RR1, never with each other.",
        cisco: { cmd: "show bgp l2vpn vpls summary", output: PE_ROUTERS.map((pe) => `${ROUTER_LOOPBACK[pe]}  4  ${AS_NUMBER}  Established  (client)`).join("\n") },
        juniper: { cmd: "show bgp summary table L2VPN.vpls", output: PE_ROUTERS.map((pe) => `${ROUTER_LOOPBACK[pe]}  Establ  (client)`).join("\n") },
      },
      {
        id: "l2vpn-vpls-rib",
        label: "L2VPN/VPLS RIB",
        concept: "PacketVerse conceptual BGP VPLS RIB — every NLRI RR1 currently holds, before any PE's own import policy is applied.",
        cisco: { cmd: "show bgp l2vpn vpls all", output: advertisedPes.map((pe) => { const n = state.localAdvertisements[pe]!; return `RD ${n.rd}  VE ID ${n.veId}  RT ${n.routeTarget}  LB ${n.block.labelBase}  (from ${pe})`; }).join("\n") || "(no advertisements yet)" },
        juniper: { cmd: "show route table bgp.l2vpn.0", output: advertisedPes.map((pe) => { const n = state.localAdvertisements[pe]!; return `${n.rd}:VE${n.veId}  rt ${n.routeTarget}  label-base ${n.block.labelBase}`; }).join("\n") || "(no advertisements yet)" },
      },
    ];
  }
  if (PE_ROUTERS.includes(router as PeRouterId)) {
    const pe = router as PeRouterId;
    const ac = resolveAttachmentCircuit(state.acs, pe);
    const fdb = fdbFor(state, pe);
    const imported = state.importedByPe[pe];
    return [
      {
        id: "bgp-session",
        label: "MP-BGP Session To RR1",
        concept: "L2VPN/VPLS address family riding an ordinary BGP session — the same session model already taught in the BGP lessons.",
        cisco: { cmd: "show bgp l2vpn vpls neighbor", output: `Neighbor: ${ROUTER_LOOPBACK.RR1}\nState: ${state.mpBgpUp ? "Established" : "Idle"}\nAddress family: L2VPN/VPLS ${state.l2vpnVplsAfUp ? "(active)" : "(not negotiated)"}` },
        juniper: { cmd: "show bgp neighbor", output: `peer ${ROUTER_LOOPBACK.RR1};\nstate ${state.mpBgpUp ? "Established" : "Idle"};\nfamily l2vpn vpls;` },
      },
      {
        id: "vpls-identity",
        label: "VPLS Service Identity",
        concept: "RD/RT/VE-ID/label-block identity this PE advertises for CUST-A-VPLS.",
        cisco: { cmd: "show running-config | section l2 vfi", output: `vfi CUST-A-VPLS\n rd ${RD_BY_PE[pe]}\n route-target import ${state.importRtByPe[pe]}\n route-target export ${state.exportRtByPe[pe]}\n ve-id ${state.veIdByPe[pe]}\n ve-range ${state.labelBlocksByPe[pe].vbs}` },
        juniper: { cmd: "show configuration routing-instances CUST-A-VPLS", output: `route-distinguisher ${RD_BY_PE[pe]};\nvrf-target import ${state.importRtByPe[pe]} export ${state.exportRtByPe[pe]};\nprotocols vpls { site PE ve-id ${state.veIdByPe[pe]}; }` },
      },
      {
        id: "imported-nlri",
        label: "Imported VPLS NLRIs",
        concept: "Received-vs-imported distinction — every entry below already passed this PE's own RT import check.",
        cisco: { cmd: "show bgp l2vpn vpls", output: imported.filter((e) => e.result === "IMPORTED").map((e) => `RD ${e.nlri.rd}  VE ID ${e.nlri.veId}  LB ${e.nlri.block.labelBase}  (from ${e.nlri.originPe})`).join("\n") || "(none imported)" },
        juniper: { cmd: "show route table CUST-A-VPLS.l2vpn.0", output: imported.filter((e) => e.result === "IMPORTED").map((e) => `${e.nlri.rd}:VE${e.nlri.veId}  label-base ${e.nlri.block.labelBase}`).join("\n") || "(none imported)" },
      },
      {
        id: "pseudowires",
        label: "Pseudowires",
        concept: "Derived entirely from BGP state — never a targeted-LDP session.",
        cisco: { cmd: "show l2vpn vpls-pw", output: pwPeersOf(pe).map((peer) => { const p = peer as PeRouterId; return `${pe}-${p}: ${pwUpBetween(state.pwLinks, pe, p) ? "UP" : "DOWN"} — send-label ${pwLabelToward(state, pe, p) ?? "n/a"}`; }).join("\n") },
        juniper: { cmd: "show vpls connections", output: pwPeersOf(pe).map((peer) => { const p = peer as PeRouterId; return `${pe}-${p}: ${pwUpBetween(state.pwLinks, pe, p) ? "Up" : "Down"}  label ${pwLabelToward(state, pe, p) ?? "n/a"}`; }).join("\n") },
      },
      {
        id: "ac",
        label: "Attachment Circuit",
        concept: "The local customer-facing interface this VPLS bridge context binds to.",
        cisco: { cmd: `show interfaces ${ac?.interfaceName ?? "unknown"}`, output: ac ? `Interface: ${ac.interfaceName}\nVLAN: ${ac.vlan}\nStatus: ${ac.up ? "up" : "DOWN"}` : "(not a PE)" },
        juniper: { cmd: `show interfaces ${ac?.interfaceName ?? "unknown"} terse`, output: ac ? `${ac.interfaceName}  ${ac.up ? "up" : "down"}  vlan ${ac.vlan}` : "(not a PE)" },
      },
      {
        id: "fdb",
        label: "MAC / FDB Table",
        concept: "Learned purely from the data plane — no BGP VPLS NLRI ever populates this table.",
        cisco: { cmd: "show bridge-domain CUST-A-VPLS mac address-table", output: fdb.length ? fdb.map((e) => `${e.mac}  ${portLabel(e.port)}  age ${e.age}`).join("\n") : "(empty)" },
        juniper: { cmd: "show vpls mac-table", output: fdb.length ? fdb.map((e) => `${e.mac}  ${portLabel(e.port)}  age ${e.age}`).join("\n") : "(empty)" },
      },
      {
        id: "forwarding",
        label: "Forwarding Journey",
        concept: "This router's hops recorded for the packet currently in flight, if any.",
        cisco: { cmd: "show mpls forwarding-table", output: state.journey.filter((h) => h.device === pe).map((h) => `In: ${h.input}  Action: ${h.action}  Out: ${h.output}`).join("\n") || "(no forwarding entry recorded at this router yet)" },
        juniper: { cmd: "show route forwarding-table", output: state.journey.filter((h) => h.device === pe).map((h) => `in ${h.input} -> ${h.action} -> out ${h.output}`).join("\n") || "(no forwarding entry recorded at this router yet)" },
      },
    ];
  }
  // P routers — transport only, no VPLS/BGP awareness.
  return [
    {
      id: "transport",
      label: "MPLS Transport",
      concept: "Ordinary transit — forwards on the outer transport label only, with no visibility into BGP, RT, VE ID, or any customer MAC.",
      cisco: { cmd: "show mpls forwarding-table", output: state.journey.filter((h) => h.device === router).map((h) => `In: ${h.input}  Action: ${h.action}  Out: ${h.output}`).join("\n") || "(no forwarding entry recorded at this router yet)" },
      juniper: { cmd: "show route forwarding-table", output: state.journey.filter((h) => h.device === router).map((h) => `in ${h.input} -> ${h.action} -> out ${h.output}`).join("\n") || "(no forwarding entry recorded at this router yet)" },
    },
  ];
}

