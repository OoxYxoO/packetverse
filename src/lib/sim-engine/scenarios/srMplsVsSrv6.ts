import type { PacketLayer, PacketVisual, ScenarioStep } from "../types";
import { fmtLabel, deriveNodeSidLabel, computeAdjSidLabel, type LabelValue } from "./srMplsFoundations";
import { buildSrv6Sid, fmtIpv6, decomposeSrv6Sid, type Hextets } from "./srv6Foundations";
import { FUNCTION, BEHAVIOR_LABEL, BEHAVIOR_FAMILY, type Srv6EndpointBehavior, type InnerPayload } from "./srv6EndpointBehaviors";
import {
  ALL_ROUTERS as CORE_ROUTERS,
  HEADEND as CORE_HEADEND,
  DESTINATION as CORE_DESTINATION,
  PLR as CORE_PLR,
  LINKS as CORE_LINKS,
  PROTECTED_LINK,
  PROTECTED_NODE,
  PRIMARY_PATH,
  shortestPath,
  computePostConvergencePath,
  precomputeTiLfaRepair,
  executeEndXUsd,
  buildRepairSid,
  simulateNaiveForwarding,
  validateRepairPath,
  encapsulateRepairSingleSid,
  buildTiLfaPacketLayers,
  INFRA_ADDRESS,
  type RouterId as CoreRouterId,
  type TiLfaRepairPath,
  type TiLfaPacketState,
  type RepairSid,
  type EndXUsdOutcome,
} from "./srv6TiLfa";
import {
  CUST_A_RD,
  CUST_A_EXPORT_RT,
  CUST_A_IMPORT_RT,
  CE1_IPV4_PREFIX,
  CE2_IPV4_PREFIX,
  CE1_HOST_IPV4,
  CE2_HOST_IPV4,
  PE1_LOCAL_ROUTES,
  PE2_LOCAL_ROUTES,
  allocateServiceSid,
  exportVpnRoute,
  importVpnRoute,
  installVpnRoute,
  encapsulateSrv6VpnPacket,
  processEgressServiceSid,
  type CustomerRoute,
  type VpnRoute,
  type ImportProgress,
  type L3vpnPacketState,
} from "./srv6L3vpn";
import {
  ALL_ROUTERS as CSID_ALL_ROUTERS,
  DEFAULT_STRUCTURE as CSID_DEFAULT_STRUCTURE,
  NEXT_CSID_LAYOUT,
  compressNextCsidRun,
  calculateCompressionMetrics,
  calculateModeledPacketSize,
  computeNextCsidCapacity,
  expandCompressedProgram,
  verifyCompressionEquivalence,
  type SidStructure as CsidSidStructure,
  type RouterId as CsidRouterId,
  type LogicalSegment as CsidLogicalSegment,
} from "./srv6Csid";

/**
 * SR-MPLS vs SRv6 Engineering Capstone (RFC 8402 SR Architecture; RFC
 * 8660 SR-MPLS data plane; RFC 9256 SR Policy; RFC 9855 TI-LFA; RFC
 * 8754 SRH; RFC 8986 SRv6 Network Programming; RFC 9252 SRv6 L3VPN
 * services; RFC 9800 Compressed SRv6/CSID). Follows every prior SR
 * lesson (SR-MPLS Foundations, SR Policy, SR-MPLS TI-LFA, MPLS L3VPN,
 * SRv6 Foundations, SRv6 Endpoint Behaviors, SRv6 Policy, SRv6 L3VPN,
 * SRv6 TI-LFA, SRv6 CSID). This is deliberately NOT another protocol
 * introduction: it is an integration/comparison capstone. One shared
 * topology, one shared traffic requirement, one shared failure, one
 * shared VPN service, one shared TE requirement — solved once in
 * SR-MPLS and once in SRv6, so every difference the learner sees is
 * attributable to data-plane encoding, never to a different example.
 *
 * CENTRAL TEACHING PRINCIPLE: SR-MPLS and SRv6 are the SAME Segment
 * Routing architecture (RFC 8402) with two different data planes. Never
 * "SR-MPLS = old/bad, SRv6 = new/better" or the reverse — this lesson
 * teaches engineering trade-offs, not a winner.
 *
 * ---------------------------------------------------------------------
 * REUSE DECISIONS (inspected against every listed engine before writing
 * anything new — see docs/ARCHITECTURE.md and docs/LESSON-BLUEPRINT.md;
 * this file deliberately widens the ordinary "integration adapter"
 * convention because unlike a normal lesson borrowing one neighboring
 * device (e.g. RR1), this capstone's entire purpose is to sit ON TOP OF
 * previously-completed engines and compare them):
 *
 *  - Topology + TI-LFA engine: `srv6TiLfa.ts` already models EXACTLY
 *    this capstone's core (PE1/P1/P2/P3/P4/PE2, PLR=P1, protected link
 *    P1-P2, primary path PE1-P1-P2-PE2, alternate via P3-P4). Its
 *    RouterId/LinkDef/LINKS and its P-Space/Q-Space/post-convergence/
 *    repair-selection functions are imported and used AS THE SHARED
 *    computation for BOTH architectures (§23 of the brief: "the TI-LFA
 *    computation model is fundamentally the same"). Only the repair
 *    ENCODING differs downstream (an MPLS label repair list here vs.
 *    SrTiLfa's own End.X+USD SID, reused directly). This file does not
 *    alter srv6TiLfa.ts and does not implement a second P-Space/Q-Space
 *    engine — verified empirically before writing any step: for this
 *    exact topology, precomputeTiLfaRepair(LINKS, "P1", "PE2", "LINK",
 *    "P1-P2") yields repairNode=P4, mergeTarget=P2, outgoingInterface
 *    P1→P3 — precisely what the brief's own repair narrative describes.
 *  - VPN engine: `srv6L3vpn.ts`'s full RT-import/BGP-next-hop/Service-
 *    SID-resolution pipeline (`evaluateRtImport`, `resolveBgpNextHop`,
 *    `resolveServiceSid`, `importVpnRoute`, `installVpnRoute`,
 *    `encapsulateSrv6VpnPacket`, `processEgressServiceSid`) is reused
 *    verbatim for the SRv6 L3VPN phase — including its exact CUST-A
 *    RD/RT/prefix constants, which is why they read 65000:100 /
 *    10.10.1.0/24 / 10.20.1.0/24 (this capstone's own brief's numbers).
 *    Those SAME constants are reused for the SR-MPLS side too, so both
 *    encodings carry the identical customer service, per the brief's
 *    "no fake comparison" rule (§7). No second VPN eligibility engine
 *    is implemented; the SR-MPLS side gets a small, LOCALLY-typed VRF/
 *    label model (an MPLS label stack + a one-line RT-match check),
 *    matching this project's own established convention that MPLS
 *    label/packet plumbing is "re-derived, not shared" per lesson
 *    (see srMplsFoundations.ts's own header comment) — VRF import
 *    logic in mplsL3vpn.ts itself is inlined in its steps, not
 *    exported as a reusable pure function, so there is nothing to
 *    import there beyond that established convention.
 *  - CSID header-efficiency lab: `srv6Csid.ts`'s entire compression
 *    engine (`BASE_PROGRAM`, `compressNextCsidRun`, `calculateCompressionMetrics`,
 *    `calculateModeledPacketSize`) is reused wholesale, unmodified, as
 *    a self-contained abstract 8-segment-program exercise (its own
 *    R1-R8 topology, per the brief's §29 instruction to reuse "the
 *    same long logical program" — this is an instruction-count/byte
 *    exercise, not tied to the physical PE1..PE2 core).
 *  - Generic label/SID math: `deriveNodeSidLabel`/`computeAdjSidLabel`
 *    (numeric, topology-independent) and `buildSrv6Sid`/`fmtIpv6`/
 *    `decomposeSrv6Sid`/`hextetsEqual` (SID-independent of any one
 *    lesson's router set) are reused directly for this capstone's own
 *    SR-MPLS Node-SID/Adj-SID and SRv6 End-SID derivation.
 *  - Endpoint programmability comparison (Phase 5) reads `BEHAVIOR_LABEL`/
 *    `BEHAVIOR_FAMILY` from `srv6EndpointBehaviors.ts` directly — no
 *    second End/End.X/End.T/End.DT4/End.DT6 catalog is invented.
 *  - RR1 (control-plane only, MUST NOT appear in any packet journey)
 *    is spliced in at the PAGE level only, mirroring the EXACT existing
 *    convention in `app/demo/mpls-l3vpn/rrIntegration.ts` and
 *    `app/demo/srv6-l3vpn/rrIntegration.ts` — RR1 is not a member of
 *    this file's RouterId or state, structurally guaranteeing it can
 *    never be a packet's `from`/`to`.
 *
 * Scope: shortest-path transport, one explicit-TE requirement, one
 * L3VPN service (CUST-A), one P1-P2 link failure with shared TI-LFA
 * computation, a read-only endpoint-programmability comparison, an
 * 8-segment header-efficiency + CSID lab, one troubleshooting incident
 * (SRv6 locator withdrawn while SR-MPLS keeps working), a 3-scenario
 * engineering decision lab, and a closing requirement matrix. Explicitly
 * deferred (not this lesson's job): a second full SR Policy control
 * plane, node-protection TI-LFA (covered already in both prerequisite
 * TI-LFA lessons), multi-area/inter-domain interworking gateways, BGP
 * CSID signaling, and any new protocol claim not already established by
 * a prerequisite lesson.
 * ---------------------------------------------------------------------
 */

// ===========================================================================
// 1. Shared topology (reused verbatim from srv6TiLfa.ts) + customer stubs
// ===========================================================================

export type Architecture = "SR_MPLS" | "SRV6";
export const ARCHITECTURES: Architecture[] = ["SR_MPLS", "SRV6"];
export function archLabel(a: Architecture): string {
  return a === "SR_MPLS" ? "SR-MPLS" : "SRv6";
}

export type RouterId = CoreRouterId | "CE1" | "CE2";
export const ALL_ROUTERS: RouterId[] = ["CE1", ...CORE_ROUTERS, "CE2"];
export const HEADEND: RouterId = CORE_HEADEND; // PE1
export const DESTINATION: RouterId = CORE_DESTINATION; // PE2
export const PLR: RouterId = CORE_PLR; // P1
export { PROTECTED_LINK, PROTECTED_NODE, PRIMARY_PATH };

export { INFRA_ADDRESS };
export const CE1_ID: RouterId = "CE1";
export const CE2_ID: RouterId = "CE2";

export const GRAPH_NODES = [
  { id: "CE1", label: "CE1", x: 2, y: 50, subLabel: CE1_HOST_IPV4 },
  { id: "PE1", label: "PE1", x: 17, y: 50, subLabel: "Headend" },
  { id: "P1", label: "P1", x: 33, y: 50, subLabel: "PLR" },
  { id: "P2", label: "P2", x: 62, y: 20, subLabel: "Protected" },
  { id: "PE2", label: "PE2", x: 82, y: 38, subLabel: "Destination" },
  { id: "P3", label: "P3", x: 42, y: 82 },
  { id: "P4", label: "P4", x: 62, y: 82 },
  { id: "CE2", label: "CE2", x: 97, y: 50, subLabel: CE2_HOST_IPV4 },
];
export const GRAPH_EDGES: { id: string; a: RouterId; b: RouterId }[] = [
  { id: "CE1-PE1", a: "CE1", b: "PE1" },
  ...CORE_LINKS.map((l) => ({ id: l.id, a: l.a as RouterId, b: l.b as RouterId })),
  { id: "PE2-CE2", a: "PE2", b: "CE2" },
];

export const TERMS: { term: string; expansion: string; meaning: string }[] = [
  { term: "SR", expansion: "Segment Routing", meaning: "RFC 8402: one architecture — a headend imposes an ordered list of instructions (segments). SR-MPLS and SRv6 are two data-plane ENCODINGS of that same architecture, not two architectures." },
  { term: "SR-MPLS", expansion: "SR with an MPLS data plane", meaning: "A segment is an MPLS label. The label stack IS the instruction list (RFC 8660)." },
  { term: "SRv6", expansion: "SR with an IPv6 data plane", meaning: "A segment is a real IPv6 address with endpoint-behavior semantics. The IPv6 Destination Address (plus an optional SRH) IS the instruction list (RFC 8754 / RFC 8986)." },
  { term: "PE / P", expansion: "Provider Edge / Provider (core)", meaning: "PEs hold customer state (VRFs). P routers never do, in either architecture — see Phase 3." },
];

// ===========================================================================
// 2. SR-MPLS transport encoding — Node-SID / Adj-SID (generic label math
//    reused from srMplsFoundations.ts; the topology/index mapping below
//    is this capstone's own, since the physical routers differ).
// ===========================================================================

export const SRGB_START = 16000;
const MPLS_NODE_SID_INDEX: Record<CoreRouterId, number> = { PE1: 1, P1: 2, P3: 3, P4: 4, P2: 5, PE2: 6 };

export function nodeSidLabel(router: CoreRouterId): number {
  return deriveNodeSidLabel(MPLS_NODE_SID_INDEX[router], SRGB_START);
}
export function adjSidLabel(owner: CoreRouterId, neighbor: CoreRouterId): number {
  return computeAdjSidLabel(MPLS_NODE_SID_INDEX[owner], MPLS_NODE_SID_INDEX[neighbor]);
}

export interface MplsSidRow {
  router: CoreRouterId;
  sidType: "NODE" | "ADJ";
  label: number;
  owner?: CoreRouterId;
  neighbor?: CoreRouterId;
  meaning: string;
}
/** One router's own view of the Node-SID database, plus its own local Adj-SIDs — mirrors srMplsFoundations.ts's buildSidDatabase shape without importing its R1-R6-typed version. */
export function buildMplsSidDatabase(): MplsSidRow[] {
  const nodeRows: MplsSidRow[] = CORE_ROUTERS.map((r) => ({ router: r, sidType: "NODE" as const, label: nodeSidLabel(r), meaning: `Reach ${r} via IGP shortest path (global)` }));
  const adjRows: MplsSidRow[] = CORE_LINKS.flatMap((l) => [
    { router: l.a, sidType: "ADJ" as const, label: adjSidLabel(l.a, l.b), owner: l.a, neighbor: l.b, meaning: `At ${l.a}, force the ${l.a}→${l.b} adjacency (local)` },
    { router: l.b, sidType: "ADJ" as const, label: adjSidLabel(l.b, l.a), owner: l.b, neighbor: l.a, meaning: `At ${l.b}, force the ${l.b}→${l.a} adjacency (local)` },
  ]);
  return [...nodeRows, ...adjRows];
}

export interface MplsLabelEntry {
  value: LabelValue;
  purpose: "transport" | "vpn";
  bottomOfStack: boolean;
}
export interface MplsPacket {
  srcIp: string;
  dstIp: string;
  labels: MplsLabelEntry[];
}
export function pushMplsLabel(pkt: MplsPacket, value: LabelValue, purpose: MplsLabelEntry["purpose"] = "transport"): MplsPacket {
  // RFC 3032: S=1 only on the entry pushed onto an EMPTY stack, and it keeps it — pushing above it must not clear the existing bottom entry's S bit.
  return { ...pkt, labels: [{ value, purpose, bottomOfStack: pkt.labels.length === 0 }, ...pkt.labels] };
}
export function swapTopMplsLabel(pkt: MplsPacket, value: LabelValue): MplsPacket {
  if (pkt.labels.length === 0) return pkt;
  const [top, ...rest] = pkt.labels;
  return { ...pkt, labels: [{ ...top, value }, ...rest] };
}
export function popTopMplsLabel(pkt: MplsPacket): MplsPacket {
  const [, ...rest] = pkt.labels;
  return { ...pkt, labels: rest.map((l, i) => ({ ...l, bottomOfStack: i === rest.length - 1 })) };
}
function mplsIpLayer(src: string, dst: string): PacketLayer {
  return { name: "Customer IPv4", color: "var(--pv-proto-ip)", fields: [{ label: "Source IP", value: src }, { label: "Destination IP", value: dst }] };
}
function mplsShimLayer(label: MplsLabelEntry, index: number): PacketLayer {
  return { name: `MPLS Shim (${label.purpose}${index === 0 ? ", active" : ""})`, color: "var(--pv-proto-mpls)", fields: [{ label: "Label", value: fmtLabel(label.value) }, { label: "S (Bottom of Stack)", value: label.bottomOfStack ? "1" : "0" }] };
}
export function buildMplsPacketLayers(pkt: MplsPacket): PacketLayer[] {
  return [...pkt.labels.map((l, i) => mplsShimLayer(l, i)), mplsIpLayer(pkt.srcIp, pkt.dstIp)];
}

// ===========================================================================
// 3. SRv6 transport encoding — End SIDs derived from srv6TiLfa's own
//    reused infrastructure addresses (INFRA_ADDRESS), via the generic
//    decomposeSrv6Sid/buildSrv6Sid helpers — no new locator scheme.
// ===========================================================================

export function endSidHextets(router: CoreRouterId): Hextets {
  const { locator4 } = decomposeSrv6Sid(INFRA_ADDRESS[router]);
  return buildSrv6Sid(locator4, FUNCTION.END);
}
export function endSidText(router: CoreRouterId): string {
  return fmtIpv6(endSidHextets(router));
}
export function endXSidHextets(owner: CoreRouterId): Hextets {
  const { locator4 } = decomposeSrv6Sid(INFRA_ADDRESS[owner]);
  return buildSrv6Sid(locator4, FUNCTION.END_X);
}
export function endXSidText(owner: CoreRouterId): string {
  return fmtIpv6(endXSidHextets(owner));
}

export interface Srv6SidRow {
  router: CoreRouterId;
  behavior: Extract<Srv6EndpointBehavior, "END" | "END_X">;
  sidText: string;
  meaning: string;
}
export function buildSrv6SidDatabase(): Srv6SidRow[] {
  return CORE_ROUTERS.map((r) => ({ router: r, behavior: "END" as const, sidText: endSidText(r), meaning: `${BEHAVIOR_LABEL.END}: reach ${r} via IPv6 FIB (global)` }));
}

export interface SrhSeg {
  index: number;
  sidHextets: Hextets;
  sidText: string;
  ownerRouter: CoreRouterId;
}
export interface Srh {
  nextHeader: string;
  hdrExtLen: number;
  routingType: 4;
  segmentsLeft: number;
  lastEntry: number;
  flags: string;
  tag: number;
  segmentList: SrhSeg[];
}
export interface Srv6Packet {
  srcText: string;
  daHextets: Hextets;
  srh?: Srh;
  innerSrcIp: string;
  innerDstIp: string;
}
/** RFC 8754 storage order: Segment List[0] is the FINAL segment, highest index is the FIRST (active) segment — never the other way around. */
export function buildSrh(orderedSids: { sidHextets: Hextets; sidText: string; owner: CoreRouterId }[]): Srh {
  const n = orderedSids.length;
  const storageOrder = [...orderedSids].reverse();
  const segmentList: SrhSeg[] = storageOrder.map((s, i) => ({ index: i, sidHextets: s.sidHextets, sidText: s.sidText, ownerRouter: s.owner }));
  return { nextHeader: "IPv6", hdrExtLen: n * 2, routingType: 4, segmentsLeft: n - 1, lastEntry: n - 1, flags: "0x00", tag: 0, segmentList };
}
function srv6IpLayer(src: string, dst: string): PacketLayer {
  return { name: "Customer IPv4", color: "var(--pv-proto-ip)", fields: [{ label: "Source IP", value: src }, { label: "Destination IP", value: dst }] };
}
function srv6OuterLayer(pkt: Srv6Packet): PacketLayer {
  return { name: "Outer IPv6", color: "var(--pv-proto-ipv6)", fields: [{ label: "Source Address", value: pkt.srcText }, { label: "Destination Address (active segment)", value: fmtIpv6(pkt.daHextets) }] };
}
function srv6SrhLayer(srh: Srh): PacketLayer {
  return { name: `SRH (SL=${srh.segmentsLeft}, LE=${srh.lastEntry})`, color: "var(--pv-proto-srh)", fields: [{ label: "Segments Left", value: String(srh.segmentsLeft) }, ...srh.segmentList.map((s) => ({ label: `Segment List[${s.index}]`, value: `${s.sidText} (${s.ownerRouter})` }))] };
}
export function buildSrv6PacketLayers(pkt: Srv6Packet): PacketLayer[] {
  return [srv6OuterLayer(pkt), ...(pkt.srh ? [srv6SrhLayer(pkt.srh)] : []), srv6IpLayer(pkt.innerSrcIp, pkt.innerDstIp)];
}
export function advanceSrh(pkt: Srv6Packet): Srv6Packet {
  if (!pkt.srh || pkt.srh.segmentsLeft === 0) return pkt;
  const nextSl = pkt.srh.segmentsLeft - 1;
  const nextEntry = pkt.srh.segmentList[nextSl];
  return { ...pkt, daHextets: nextEntry.sidHextets, srh: { ...pkt.srh, segmentsLeft: nextSl } };
}

// ===========================================================================
// 4. Phase 2 — Explicit TE: one shared minimal-segment-list algorithm
//    (ported from the same greedy-compression shape already proven in
//    srPolicy.ts's deriveSegmentListFromPath / srv6Policy.ts's
//    deriveSrv6SegmentListFromPath — those are bound to each lesson's
//    own R1-R6 RouterId/LinkDef and cannot be called directly against
//    this capstone's PE1..PE2 topology without an unsafe cast, exactly
//    the same situation srv6TiLfa.ts's own header comment documents for
//    srTiLfa.ts's P/Q-Space functions). Used ONCE, by both encodings,
//    so both architectures steer the identical computed path.
// ===========================================================================

function pathsEqual(a: RouterId[], b: RouterId[]): boolean {
  return a.length === b.length && a.every((r, i) => r === b[i]);
}

/**
 * Greedy compression, ADJACENCY-AWARE. Extends each segment as far as
 * ordinary shortest-path forwarding actually agrees with the intended
 * explicit path. Critically: when even the IMMEDIATE next hop is not
 * what the current anchor's own ordinary SPF would choose, a plain
 * Node-SID/End segment there would silently deliver the packet via
 * whatever route SPF actually prefers — not the required physical
 * link — so that hop is emitted as a forced-adjacency instruction
 * (Adj-SID / End.X) instead, exactly like this file's own TI-LFA
 * repair encoding already does for the identical reason (see
 * `buildMplsRepairList`). Returns the RAW, untrimmed list — trimming
 * a redundant trailing segment is an ENCODING-SPECIFIC decision (see
 * `buildMplsTeSegments`/`buildSrv6TeSegments` below), never a shared
 * one: it is valid for SR-MPLS but NOT for SRv6 (see those functions'
 * own comments for exactly why the two architectures genuinely differ
 * here).
 */
export interface MinimalTeSegment {
  type: "NODE" | "ADJ";
  owner: CoreRouterId;
  target?: CoreRouterId;
}
export function deriveMinimalTeSegments(path: CoreRouterId[]): MinimalTeSegment[] {
  const segments: MinimalTeSegment[] = [];
  let i = 0;
  while (i < path.length - 1) {
    let bestJ = i + 1;
    let verified = false;
    for (let j = i + 1; j < path.length; j++) {
      const ordinary = shortestPath(CORE_LINKS, path[i], path[j]);
      if (ordinary && pathsEqual(ordinary.path, path.slice(i, j + 1))) {
        bestJ = j;
        verified = true;
      } else break;
    }
    if (verified) {
      segments.push({ type: "NODE", owner: path[bestJ] });
      i = bestJ;
    } else {
      segments.push({ type: "ADJ", owner: path[i], target: path[i + 1] });
      i += 1;
    }
  }
  return segments;
}

/** The one explicit-TE requirement (brief Phase 2): steer PE1→PE2 over the P1-P3-P4-P2 alternate even though ordinary SPF prefers P1-P2 directly. Computed from real topology/SPF (the same post-convergence-path function TI-LFA itself uses), never hand-typed. */
export const TE_EXPLICIT_PATH: CoreRouterId[] = (() => {
  const post = computePostConvergencePath(CORE_LINKS, CORE_HEADEND, CORE_DESTINATION, "LINK", PROTECTED_LINK);
  return post ? post.path : PRIMARY_PATH;
})();

export interface TeSegment {
  order: number;
  type: "NODE" | "ADJ";
  owner: CoreRouterId;
  target?: CoreRouterId;
  explanation: string;
}
function nodeSegmentExplanation(owner: CoreRouterId, isFirst: boolean): string {
  return isFirst
    ? `Node-SID/End(${owner}) — ordinary shortest path from ${CORE_HEADEND} already threads through the whole PE1-P1-P3-P4 chain.`
    : `Node-SID/End(${owner}) — ordinary shortest path from the previous segment already reaches it.`;
}
function adjSegmentExplanation(owner: CoreRouterId, target: CoreRouterId): string {
  return `${owner}'s own ordinary shortest path to ${target} does NOT use the direct ${owner}-${target} link — a Node-SID/End segment here would misroute. A forced-adjacency segment at ${owner} → ${target} is required instead.`;
}
/**
 * SR-MPLS encoding: Node-SID(P4) + Adj-SID(P4→P2) — 2 segments. The
 * trailing Node-SID that `deriveMinimalTeSegments` would otherwise add
 * for the path's own final destination is dropped here deliberately:
 * an MPLS label stack rides OVER an untouched IP header — `dstIp` was
 * set once, at packet construction, and is never touched by any
 * PUSH/SWAP/POP. Once the Adj-SID (bottom of stack) is consumed at its
 * owner, the packet becomes plain, already-addressed IP again, and
 * ordinary destination-based forwarding (which already matches the
 * remaining intended path — that is what made the dropped segment
 * "verified" in the first place) completes the journey for free. No
 * second architecture-neutral function computes this trim: it is only
 * safe for SR-MPLS.
 */
export function buildMplsTeSegments(): TeSegment[] {
  const raw = deriveMinimalTeSegments(TE_EXPLICIT_PATH);
  const last = raw[raw.length - 1];
  const trimmed = raw.length > 1 && last.type === "NODE" && last.owner === TE_EXPLICIT_PATH[TE_EXPLICIT_PATH.length - 1] ? raw.slice(0, -1) : raw;
  return trimmed.map((s, i) => ({ order: i, type: s.type, owner: s.owner, target: s.target, explanation: s.type === "NODE" ? nodeSegmentExplanation(s.owner, i === 0) : adjSegmentExplanation(s.owner, s.target!) }));
}
/**
 * SRv6 BASE encoding (plain End / End.X, no USD): End(P4) + End.X(P4→
 * P2) + End(PE2) — 3 segments, one more than SR-MPLS's base encoding,
 * for a genuine data-plane reason (RFC 8986 §4.1/§4.2), not a weaker
 * minimizer or an unfair segment vocabulary: both architectures get to
 * use a forced-adjacency segment (Adj-SID here, exactly as much as
 * End.X there). The difference is what happens AFTER the forced-
 * adjacency segment is consumed. Plain End.X still performs the
 * ordinary SRH advance (decrement Segments Left, set DA to the NEXT
 * Segment List entry) — it only replaces the FORWARDING decision
 * (bound adjacency instead of a FIB lookup on that new DA); unlike
 * SR-MPLS's label stack, there is no separate, untouched "real
 * destination" field underneath an SRv6 outer header for the packet to
 * fall back on once the SRH is exhausted — whatever DA the last
 * Segments-Left decrement leaves behind IS what the next router acts
 * on. So the trailing End(PE2) segment is NOT redundant here the way
 * the equivalent Node-SID is for SR-MPLS: dropping it would leave DA
 * pointing at P4's own address after the forced hop, which P2 cannot
 * use to reach PE2.
 *
 * This 2-vs-3 result is therefore SCOPED to this specific pair of base
 * behaviors (Node-SID/Adj-SID vs. plain End/End.X) — it is not a
 * universal "SR-MPLS always needs fewer segments" rule. A different
 * SRv6 endpoint-behavior choice for the SAME forced hop (End.X's USD
 * flavor) changes the count again — see `testSrv6TeEndXUsdAlternative`
 * below, which executes that alternative through the real domain
 * behavior rather than assuming the result.
 */
export function buildSrv6TeSegments(): TeSegment[] {
  const raw = deriveMinimalTeSegments(TE_EXPLICIT_PATH);
  return raw.map((s, i) => ({ order: i, type: s.type, owner: s.owner, target: s.target, explanation: s.type === "NODE" ? nodeSegmentExplanation(s.owner, i === 0) : adjSegmentExplanation(s.owner, s.target!) }));
}

/**
 * Advanced/optional comparison (NOT part of the base 2-vs-3 walkthrough
 * above): does choosing a DIFFERENT SRv6 endpoint behavior for the SAME
 * forced hop (P4→P2) change the required segment count? Reuses
 * srv6TiLfa.ts's OWN End.X+USD repair-SID and execution engine exactly
 * as this capstone's TI-LFA repair phase already does for the P1-P2
 * repair (`buildRepairSid`, `encapsulateRepairSingleSid`,
 * `executeEndXUsd`) — no second USD implementation is written here.
 * TI-LFA is one important use case for End.X+USD, already demonstrated
 * elsewhere in PacketVerse (this capstone's own repair phase, and the
 * dedicated SRv6 TI-LFA lesson) — it is not the only one; explicit
 * traffic engineering can use the identical mechanism.
 *
 * The result is EXECUTED through the real domain function, never
 * assumed: `executeEndXUsd` itself decides whether USD can decapsulate
 * here, exactly as it would for any other caller (the TI-LFA phase
 * included). `assertSrv6TeUsdAlternative` (module scope, below) fails
 * the build if that real execution ever stops confirming the
 * USD_DECAP_FORWARD outcome this comparison depends on.
 */
export interface Srv6TeUsdAlternative {
  repairSid: RepairSid;
  outcome: EndXUsdOutcome;
  segmentCount: number;
  physicalPath: CoreRouterId[];
}
export function testSrv6TeEndXUsdAlternative(): Srv6TeUsdAlternative {
  const raw = deriveMinimalTeSegments(TE_EXPLICIT_PATH);
  const adjSeg = raw.find((s) => s.type === "ADJ");
  if (!adjSeg || !adjSeg.target) {
    throw new Error("Explicit TE path no longer contains a forced-adjacency hop; the End.X+USD alternative does not apply.");
  }
  const repairSid = buildRepairSid(adjSeg.owner, adjSeg.target);
  const inner: InnerPayload = { kind: "IPV4", srcIp: CE1_SRC, dstIp: CE2_HOST_IPV4 };
  const encapsulated = encapsulateRepairSingleSid(repairSid, { inner });
  const outcome = executeEndXUsd(repairSid, encapsulated);
  return { repairSid, outcome, segmentCount: 1, physicalPath: TE_EXPLICIT_PATH };
}

// ===========================================================================
// 5. Phase 3 — L3VPN: CUST-A. Constants below are `srv6L3vpn.ts`'s own
//    (RD/RT/prefixes) reused directly — this file just also builds the
//    SR-MPLS-side encoding for the identical customer service.
// ===========================================================================

export { CUST_A_RD, CUST_A_EXPORT_RT, CUST_A_IMPORT_RT, CE1_IPV4_PREFIX, CE2_IPV4_PREFIX, CE1_HOST_IPV4, CE2_HOST_IPV4, PE1_LOCAL_ROUTES, PE2_LOCAL_ROUTES };

export const VPN_LABEL: Partial<Record<CoreRouterId, number>> = { PE1: 9001, PE2: 9002 };

export interface MplsVrfRoute {
  prefix: string;
  origin: "local" | "imported";
  rd?: string;
  viaPe?: RouterId;
}
export interface MplsVrf {
  name: "CUST-A";
  exportRt: string;
  importRt: string;
  routes: MplsVrfRoute[];
}
export interface MplsVpnRoute {
  prefix: string;
  rd: string;
  rt: string;
  nextHop: string;
  vpnLabel: number;
  originPe: RouterId;
}
export function createMplsVrfs(): Partial<Record<RouterId, MplsVrf[]>> {
  return {
    PE1: [{ name: "CUST-A", exportRt: CUST_A_EXPORT_RT, importRt: CUST_A_IMPORT_RT, routes: [{ prefix: CE1_IPV4_PREFIX, origin: "local" }] }],
    PE2: [{ name: "CUST-A", exportRt: CUST_A_EXPORT_RT, importRt: CUST_A_IMPORT_RT, routes: [{ prefix: CE2_IPV4_PREFIX, origin: "local" }] }],
  };
}
export function exportMplsVpnRoute(prefix: string, originPe: RouterId, nextHop: string): MplsVpnRoute {
  const rd = originPe === "PE1" ? CUST_A_RD.PE1! : CUST_A_RD.PE2!;
  const vpnLabel = originPe === "PE1" ? VPN_LABEL.PE1! : VPN_LABEL.PE2!;
  return { prefix, rd, rt: CUST_A_EXPORT_RT, nextHop, vpnLabel, originPe };
}
/** The ONE check that decides import — restated as a one-line predicate, exactly like every other lesson's RT check (mplsL3vpn.ts inlines this same comparison in its own steps rather than exporting it). */
export function mplsRtImportMatches(route: MplsVpnRoute, importRt: string): boolean {
  return route.rt === importRt;
}

// ===========================================================================
// 6. Phase 4 — Failure protection. The P-Space/Q-Space/repair-selection
//    computation is 100% reused from srv6TiLfa.ts (see header). This
//    section only adds the SR-MPLS-side REPAIR ENCODING for the exact
//    same repairNode/mergeTarget/outgoingInterface that computation
//    already produced.
// ===========================================================================

export function computeSharedTiLfaRepair(): TiLfaRepairPath {
  return precomputeTiLfaRepair(CORE_LINKS, CORE_PLR, CORE_DESTINATION, "LINK", PROTECTED_LINK);
}

export interface MplsRepairSegment {
  type: "NODE" | "ADJ";
  owner: CoreRouterId;
  target?: CoreRouterId;
  label: number;
}
/** SR-MPLS encoding of the SAME repair srv6TiLfa.ts's own precomputeTiLfaRepair() selected: Node-SID(repairNode) to reach the repair point via ordinary IGP, then a locally-significant Adj-SID forcing the exact repairNode→mergeTarget adjacency (never trusting the repair node's own downstream FIB, same reasoning as the SRv6 forced End.X+USD adjacency). */
export function buildMplsRepairList(repair: TiLfaRepairPath): MplsRepairSegment[] {
  if (!repair.repairNode || !repair.mergeTarget) return [];
  return [
    { type: "NODE", owner: repair.repairNode, label: nodeSidLabel(repair.repairNode) },
    { type: "ADJ", owner: repair.repairNode, target: repair.mergeTarget, label: adjSidLabel(repair.repairNode, repair.mergeTarget) },
  ];
}

// ===========================================================================
// 7. Phase 6 — Header efficiency + CSID. Reuses srv6Csid.ts's real
//    compression engine (compressNextCsidRun/calculateCompressionMetrics/
//    computeNextCsidCapacity/expandCompressedProgram/verifyCompressionEquivalence)
//    and its exported RouterId/ALL_ROUTERS/DEFAULT_STRUCTURE/NEXT_CSID_LAYOUT
//    constants — but NOT its `BASE_PROGRAM` value. BASE_PROGRAM is that
//    lesson's own R1-headend segment list (7 entries: S1..S7 reaching
//    R2..R8 — R1 is deliberately excluded there because R1 is that
//    lesson's headend, and a headend never imposes a segment to reach
//    itself). This capstone's header-efficiency lab is explicitly an
//    ABSTRACT instruction-count exercise (brief: "the same long logical
//    program," never tied to a physical topology or a specific
//    headend) — so it is entitled to treat all 8 routers in that
//    lesson's own RouterId space (R1..R8, `ALL_ROUTERS`) as 8 distinct
//    waypoints, since R1 genuinely owns a valid, structurally-consistent
//    SID in that domain (NEXT_CSID_VALUE.R1 exists) even though
//    BASE_PROGRAM itself never uses it as a segment. Reusing
//    BASE_PROGRAM directly here would silently understate every
//    instruction-count comparison by one segment (28/112/32 bytes
//    instead of the intended 32/128/32) — exactly the bug this
//    replaces. See HEADER_LAB_PROGRAM below.
// ===========================================================================

/** A genuine 8-segment logical program (S1..S8, one per router in srv6Csid.ts's own 8-router RouterId space) — every number downstream (MPLS bytes, uncompressed SRv6 bytes, CSID container bytes) is DERIVED from this array's actual length and the real reused compression engine, never hardcoded. */
export const HEADER_LAB_PROGRAM: CsidLogicalSegment[] = CSID_ALL_ROUTERS.map((r, i) => ({ id: `S${i + 1}`, owner: r, behavior: "END" as const }));
export const HEADER_LAB_SEGMENT_COUNT = HEADER_LAB_PROGRAM.length;
export const MPLS_STACK_BYTES_PER_LABEL = 4;
export const SRV6_SID_BYTES = 16;

export function mplsStackBytes(segmentCount: number): number {
  return segmentCount * MPLS_STACK_BYTES_PER_LABEL;
}
export function srv6UncompressedBytes(segmentCount: number): number {
  return segmentCount * SRV6_SID_BYTES;
}
export interface SegmentEncodingComparisonRow {
  architecture: string;
  instructionCount: number;
  instructionBytes: number;
  outerHeaderBytes: number;
  extensionHeaderBytes: number;
  modeledTotalOverhead: number;
  notes: string;
}
export const MTU_LAB_PAYLOAD_BYTES = 1400;
/** Near-MTU MTU case (brief §32): models total packet-size impact, never conflating instruction-storage bytes with total overhead. */
export function buildSegmentEncodingComparison(): SegmentEncodingComparisonRow[] {
  const csid = computeCsidLab();
  const n = csid.segmentCount;
  const mplsBytes = mplsStackBytes(n);
  const uncompressed = calculateModeledPacketSize(srv6UncompressedBytes(n), true, MTU_LAB_PAYLOAD_BYTES);
  const compressed = calculateModeledPacketSize(csid.metrics.compressedSegmentBytes, csid.metrics.compressedContainerCount > 1, MTU_LAB_PAYLOAD_BYTES);
  return [
    { architecture: "SR-MPLS", instructionCount: n, instructionBytes: mplsBytes, outerHeaderBytes: 0, extensionHeaderBytes: 0, modeledTotalOverhead: mplsBytes, notes: "Label stack only — this data plane has no separate outer/extension-header concept." },
    { architecture: "SRv6 (uncompressed)", instructionCount: n, instructionBytes: uncompressed.segmentValueBytes, outerHeaderBytes: uncompressed.outerIpv6Bytes, extensionHeaderBytes: uncompressed.srhBytes - uncompressed.segmentValueBytes, modeledTotalOverhead: uncompressed.outerIpv6Bytes + uncompressed.srhBytes, notes: "Full 16-byte SIDs plus outer IPv6 header and SRH base." },
    { architecture: "SRv6 (NEXT-CSID)", instructionCount: csid.metrics.compressedContainerCount, instructionBytes: compressed.segmentValueBytes, outerHeaderBytes: compressed.outerIpv6Bytes, extensionHeaderBytes: compressed.srhBytes - compressed.segmentValueBytes, modeledTotalOverhead: compressed.outerIpv6Bytes + compressed.srhBytes, notes: "Compressed containers under the same outer IPv6; SRH present only once more than one container remains." },
  ];
}
export function computeCsidLab() {
  const structures: Record<CsidRouterId, CsidSidStructure | undefined> = Object.fromEntries(HEADER_LAB_PROGRAM.map((s) => [s.owner, CSID_DEFAULT_STRUCTURE])) as Record<CsidRouterId, CsidSidStructure | undefined>;
  const plan = compressNextCsidRun(HEADER_LAB_PROGRAM, structures, NEXT_CSID_LAYOUT);
  const metrics = calculateCompressionMetrics(HEADER_LAB_PROGRAM.length, plan);
  const capacity = computeNextCsidCapacity(NEXT_CSID_LAYOUT);
  return { plan, metrics, capacity, segmentCount: HEADER_LAB_PROGRAM.length };
}

/**
 * Domain invariant, asserted at module load (fails the build/dev server
 * loudly, never silently): the header-efficiency lab's three numbers
 * must be DERIVED from a genuine 8-segment logical program via the real
 * reused compression engine, and NEXT-CSID's expansion must reproduce
 * that exact original program (RFC 9800's own compression-equivalence
 * requirement — compression may never change what the program means).
 */
function assertHeaderLabInvariants(): void {
  const csid = computeCsidLab();
  if (HEADER_LAB_PROGRAM.length !== 8) {
    throw new Error(`Header-efficiency lab must compare the same 8-segment logical program across all three encodings; got ${HEADER_LAB_PROGRAM.length} segments.`);
  }
  const mplsBytes = mplsStackBytes(csid.segmentCount);
  if (mplsBytes !== 32) {
    throw new Error(`SR-MPLS instruction storage for an 8-segment program must derive to 32 bytes (8 x 4); got ${mplsBytes}.`);
  }
  const srv6FullBytes = srv6UncompressedBytes(csid.segmentCount);
  if (srv6FullBytes !== 128) {
    throw new Error(`SRv6 uncompressed instruction storage for an 8-segment program must derive to 128 bytes (8 x 16); got ${srv6FullBytes}.`);
  }
  if (csid.metrics.compressedSegmentBytes !== 32) {
    throw new Error(`SRv6 NEXT-CSID instruction storage for this layout must derive to 32 bytes (2 containers x 16); got ${csid.metrics.compressedSegmentBytes}.`);
  }
  const expanded = expandCompressedProgram(csid.plan);
  if (!verifyCompressionEquivalence(HEADER_LAB_PROGRAM, csid.plan)) {
    throw new Error("NEXT-CSID compression of the 8-segment header-efficiency program does not expand back to the original program — compression must never change program meaning (RFC 9800).");
  }
  if (expanded.length !== HEADER_LAB_PROGRAM.length) {
    throw new Error(`Expanded CSID program must have the same length as the original 8-segment program; got ${expanded.length}.`);
  }
}
assertHeaderLabInvariants();

// ===========================================================================
// 8. Architecture comparison layer — factual properties only. No
//    winner/score/rating field exists anywhere in this section.
// ===========================================================================

export interface TransportComparisonRow {
  requirement: string;
  srMpls: string;
  srv6: string;
}
export function compareTransportEncoding(): TransportComparisonRow[] {
  return [
    { requirement: "Segment representation", srMpls: `MPLS label (${MPLS_STACK_BYTES_PER_LABEL} bytes)`, srv6: `IPv6 address (${SRV6_SID_BYTES} bytes)` },
    { requirement: "Headend instruction", srMpls: `Push Node-SID label ${nodeSidLabel("PE2")}`, srv6: `Set IPv6 DA = ${endSidText("PE2")}` },
    { requirement: "Core (P-router) forwarding state", srMpls: "LFIB (incoming label → operation → outgoing label/interface)", srv6: "Ordinary IPv6 FIB (longest-prefix match on the locator)" },
    { requirement: "Core forwarding operation", srMpls: "Label SWAP (or PHP at the penultimate hop)", srv6: "Ordinary IPv6 forwarding — no per-packet SID rewrite" },
    { requirement: "Endpoint match", srMpls: "Label lookup in LFIB", srv6: "DA matches a Local SID Table entry → endpoint behavior" },
  ];
}
export function compareTeEncoding(): TransportComparisonRow[] {
  const mplsSegs = buildMplsTeSegments();
  const srv6Segs = buildSrv6TeSegments();
  const mplsContent = mplsSegs.map((s) => (s.type === "NODE" ? `Node-SID(${s.owner})=${nodeSidLabel(s.owner)}` : `Adj-SID(${s.owner}→${s.target})=${adjSidLabel(s.owner, s.target!)}`)).join(" → ");
  const srv6Content = srv6Segs.map((s) => (s.type === "NODE" ? `${s.owner} End=${endSidText(s.owner)}` : `${s.owner} End.X→${s.target}=${endXSidText(s.owner)}`)).join(" ; ");
  return [
    { requirement: "Segment list length (base encoding)", srMpls: `${mplsSegs.length} label(s)`, srv6: `${srv6Segs.length} SID(s) — End/End.X` },
    { requirement: "Segment list content (base encoding)", srMpls: mplsContent, srv6: srv6Content },
    { requirement: "Imposition mechanism", srMpls: "PUSH the label stack at the headend", srv6: srv6Segs.length > 1 ? "H.Encaps with a full SRH" : "H.Encaps, single SID (no SRH needed)" },
    { requirement: "Wire representation", srMpls: "Label stack under the transport label", srv6: "Outer IPv6 DA + SRH segment list" },
    { requirement: "Why the base counts differ", srMpls: "Adj-SID (bottom of stack) exposes the untouched, always-present IP destination once popped — no trailing segment needed.", srv6: "Plain End.X still advances DA to the next SRH entry (RFC 8986 §4.2) — a real trailing End(PE2) segment is required so P2 has something valid to forward on." },
    { requirement: "Does this generalize?", srMpls: "No — this is scoped to Node-SID/Adj-SID vs. plain End/End.X.", srv6: "No — a different endpoint-behavior choice (End.X+USD) changes the count again; see the advanced comparison next." },
  ];
}
export function compareVpnEncoding(): TransportComparisonRow[] {
  return [
    { requirement: "Customer isolation", srMpls: "VRF CUST-A", srv6: "VRF CUST-A (identical concept, identical name)" },
    { requirement: "Route uniqueness", srMpls: `RD ${CUST_A_RD.PE1} / ${CUST_A_RD.PE2}`, srv6: `RD ${CUST_A_RD.PE1} / ${CUST_A_RD.PE2} (same RDs)` },
    { requirement: "Import/export policy", srMpls: `RT ${CUST_A_EXPORT_RT}`, srv6: `RT ${CUST_A_EXPORT_RT} (same RT)` },
    { requirement: "Control-plane transport", srMpls: "MP-BGP VPNv4", srv6: "MP-BGP VPNv4 (RFC 8950, IPv6 next hop)" },
    { requirement: "Service identifier attached to the route", srMpls: "VPN label (an MPLS label)", srv6: "Service SID (a real IPv6 address, via the SRv6 L3 Service TLV)" },
    { requirement: "Egress data-plane action", srMpls: "Pop VPN label → per-label VRF context → route lookup", srv6: "End.DT4 → decapsulate → VRF route lookup" },
    { requirement: "P-router customer state", srMpls: "None", srv6: "None" },
  ];
}
export function compareProtectionEncoding(repair: TiLfaRepairPath): TransportComparisonRow[] {
  const mplsRepair = buildMplsRepairList(repair);
  return [
    { requirement: "Protected resource", srMpls: PROTECTED_LINK, srv6: PROTECTED_LINK },
    { requirement: "Point of Local Repair", srMpls: CORE_PLR, srv6: CORE_PLR },
    { requirement: "Repair topology computation", srMpls: "Shared: P-Space / Q-Space / post-convergence SPF", srv6: "Shared: P-Space / Q-Space / post-convergence SPF" },
    { requirement: "Repair outgoing interface", srMpls: `${CORE_PLR}→${repair.outgoingInterface ?? "?"}`, srv6: `${CORE_PLR}→${repair.outgoingInterface ?? "?"}` },
    { requirement: "Repair encoding", srMpls: mplsRepair.map((s) => `${s.type === "NODE" ? "Node-SID" : "Adj-SID"}(${s.owner}${s.target ? `→${s.target}` : ""})=${s.label}`).join(" + "), srv6: `${repair.repairNode ?? "?"} End.X+USD → ${repair.mergeTarget ?? "?"}` },
  ];
}

export interface ArchitectureComparison {
  transport: TransportComparisonRow[];
  te: TransportComparisonRow[];
  vpn: TransportComparisonRow[];
  protection: TransportComparisonRow[];
  instructionBytesMpls: number;
  instructionBytesSrv6Uncompressed: number;
  instructionBytesSrv6Csid: number;
}
export function compareArchitectures(): ArchitectureComparison {
  const repair = computeSharedTiLfaRepair();
  const csid = computeCsidLab();
  return {
    transport: compareTransportEncoding(),
    te: compareTeEncoding(),
    vpn: compareVpnEncoding(),
    protection: compareProtectionEncoding(repair),
    instructionBytesMpls: mplsStackBytes(csid.segmentCount),
    instructionBytesSrv6Uncompressed: srv6UncompressedBytes(csid.segmentCount),
    instructionBytesSrv6Csid: csid.metrics.compressedSegmentBytes,
  };
}

export interface RequirementMatrixRow {
  requirement: string;
  srMpls: string;
  srv6: string;
}
export function buildRequirementMatrix(): RequirementMatrixRow[] {
  const csid = computeCsidLab();
  return [
    { requirement: "Shortest-path transport", srMpls: "Node-SID label imposed at headend", srv6: "IPv6 DA set to destination's End SID" },
    { requirement: "Explicit TE (base End/End.X encoding)", srMpls: `${buildMplsTeSegments().length}-label stack (PUSH)`, srv6: `${buildSrv6TeSegments().length}-SID program (H.Encaps${buildSrv6TeSegments().length > 1 ? " + SRH" : ""}); 1 SID with End.X+USD` },
    { requirement: "L3VPN", srMpls: "VRF + RD + RT + MP-BGP + VPN label", srv6: "VRF + RD + RT + MP-BGP + Service SID (End.DT4)" },
    { requirement: "Local FRR (TI-LFA)", srMpls: "OIF + MPLS label repair list", srv6: "OIF + IPv6 SID repair list (End.X+USD)" },
    { requirement: "Service identification", srMpls: "VPN label (locally significant per PE)", srv6: "Service SID (globally routable IPv6 address)" },
    { requirement: "Core (P-router) forwarding state", srMpls: "LFIB", srv6: "IPv6 FIB" },
    { requirement: "Packet instruction encoding", srMpls: "MPLS label stack (4 bytes/entry)", srv6: "IPv6 address / SRH (16 bytes/entry, or compressed)" },
    { requirement: "Endpoint processing", srMpls: "Label pop / lookup", srv6: "Named endpoint behavior (End, End.X, End.DT4, ...)" },
    { requirement: `Long segment program (${csid.segmentCount} segments)`, srMpls: `${mplsStackBytes(csid.segmentCount)} bytes`, srv6: `${srv6UncompressedBytes(csid.segmentCount)} bytes uncompressed / ${csid.metrics.compressedSegmentBytes} bytes with CSID` },
  ];
}

// ===========================================================================
// 9. Troubleshooting incident — reuses srv6L3vpn.ts's own installVpnRoute
//    with locatorReachable=false. No second eligibility engine.
// ===========================================================================

export function evaluateSrv6LocatorIncident(route: VpnRoute, locatorReachable: boolean): ImportProgress {
  const progress = importVpnRoute(route, CUST_A_IMPORT_RT);
  return installVpnRoute(progress, true, locatorReachable);
}

// ===========================================================================
// 10. Journey / top-level state
// ===========================================================================

export type MplsFwdAction = "PUSH" | "SWAP" | "PHP_POP" | "VPN_LOOKUP" | "IP_FORWARD" | "REPAIR_PUSH" | "REPAIR_FORWARD_ADJ";
export type Srv6FwdAction = "SET_DA" | "IPV6_FIB_FORWARD" | "LOCAL_SID_MATCH" | "END_ADVANCE" | "END_DT4_DECAP" | "REPAIR_ENCAPSULATE" | "USD_DECAP_FORWARD";

/**
 * A native, per-hop packet snapshot — each architecture keeps its OWN
 * packet shape (an MPLS label stack over untouched IPv4; an outer IPv6
 * header with an optional SRH; an SRv6 L3VPN outer; a TI-LFA repair
 * outer). Never normalized into one generic packet with relabelled
 * fields: the two data planes genuinely differ in what they carry.
 */
export type HopPacket =
  | { kind: "MPLS"; packet: MplsPacket }
  | { kind: "SRV6"; packet: Srv6Packet }
  | { kind: "SRV6_L3VPN"; packet: L3vpnPacketState }
  | { kind: "SRV6_TILFA"; packet: TiLfaPacketState }
  | { kind: "IPV4"; srcIp: string; dstIp: string };

export interface JourneyHop {
  architecture: Architecture;
  router: RouterId;
  input: string;
  lookup: string;
  action: string;
  output: string;
  /** The step whose run() recorded this hop — the ONE journey array interleaves both architectures and several independent packets, so array adjacency never implies physical adjacency. */
  stepId: string;
  /** Physical neighbor the packet arrived from / leaves toward, recorded only where the modeled path actually establishes it (never inferred from the next logical segment). */
  ingressPeer?: RouterId;
  egressPeer?: RouterId;
  /** Native packet state as it entered / left this router's processing — computed once in run(), only ever read by the UI. */
  before?: HopPacket;
  after?: HopPacket;
}

/** Next physical router after `router` on a real, SPF/TI-LFA-derived path — undefined if `router` is not on it or is its last node. */
function nextOnPath(path: RouterId[], router: RouterId): RouterId | undefined {
  const i = path.indexOf(router);
  return i >= 0 && i < path.length - 1 ? path[i + 1] : undefined;
}
/** Narrows a router id from a reused engine (srv6L3vpn.ts's own RouterId includes customer sites this capstone's topology does not have) to a router that physically exists here — undefined otherwise, never cast. */
function capstoneRouter(id: string | undefined): RouterId | undefined {
  return ALL_ROUTERS.find((r) => r === id);
}
function prevOnPath(path: RouterId[], router: RouterId): RouterId | undefined {
  const i = path.indexOf(router);
  return i > 0 ? path[i - 1] : undefined;
}

/**
 * Which data plane a step is about. `BOTH` = the step records native
 * hops for BOTH architectures (the two repair executions at the repair
 * node — parallel alternatives, never one packet's progression);
 * `SHARED` = architecture-independent (requirements, shared TI-LFA
 * computation, comparisons, decision labs, predictions about both).
 * Used by the UI to keep packet/table/device state from ever mixing
 * across technologies.
 */
export type StepArchitecture = Architecture | "BOTH" | "SHARED";
const SR_MPLS_STEPS = new Set(["mpls-transport-intro", "mpls-transport-push", "mpls-transport-core", "predict-mpls-label-bytes", "mpls-te-build", "mpls-vpn-build", "mpls-vpn-packet", "mpls-repair-encoding", "header-efficiency-mpls"]);
const SRV6_STEPS = new Set([
  "srv6-transport-intro",
  "srv6-transport-setda",
  "srv6-transport-core",
  "srv6-transport-endpoint",
  "srv6-te-build",
  "srv6-te-usd-alternative",
  "srv6-vpn-build",
  "srv6-vpn-packet",
  "srv6-repair-encoding",
  "header-efficiency-srv6",
  "header-efficiency-csid",
  "incident-intro",
  "incident-fault-injected",
  "incident-ladder",
  "wrong-repair-1",
  "wrong-repair-2",
  "wrong-repair-3",
  "incident-repair",
  "incident-resend",
]);
const BOTH_STEPS = new Set(["repair-execution"]);
export function stepArchitecture(stepId: string): StepArchitecture {
  if (SR_MPLS_STEPS.has(stepId)) return "SR_MPLS";
  if (SRV6_STEPS.has(stepId)) return "SRV6";
  if (BOTH_STEPS.has(stepId)) return "BOTH";
  return "SHARED";
}

/** Reverse lookup of what a label value MEANS in this capstone's own allocation (Node-SID, local Adj-SID, or per-PE VPN label) — derived from the same label functions that allocated it. */
export function describeMplsLabel(value: LabelValue): string {
  for (const r of CORE_ROUTERS) if (nodeSidLabel(r) === value) return `Node-SID(${r})`;
  for (const l of CORE_LINKS) {
    if (adjSidLabel(l.a, l.b) === value) return `Adj-SID(${l.a}→${l.b})`;
    if (adjSidLabel(l.b, l.a) === value) return `Adj-SID(${l.b}→${l.a})`;
  }
  for (const pe of ["PE1", "PE2"] as const) if (VPN_LABEL[pe] === value) return `VPN label (${pe} CUST-A)`;
  return "label";
}

/**
 * Owner + behavior of a transport/TE SID, derived from the same SID
 * builders — never a string guess. Repair and Service SIDs are labeled
 * by their own packet context (a TI-LFA repair outer / an L3VPN outer),
 * not here: P4's End.X SID address is shared by the TE program (plain
 * End.X) and the repair list (End.X+USD flavor) in this model, so the
 * address alone cannot say which flavor applies.
 */
export function describeSrv6Sid(sid: Hextets): string {
  const text = fmtIpv6(sid);
  for (const r of CORE_ROUTERS) if (endSidText(r) === text) return `End(${r})`;
  for (const r of CORE_ROUTERS) if (endXSidText(r) === text) return `End.X(${r})`;
  return "SID";
}

export type ViewMode = "REQUIREMENT" | "SR_MPLS" | "SRV6" | "SIDE_BY_SIDE" | "PACKET" | "FAILURE";

export interface DecisionLabAnswer {
  scenarioId: "existing-mpls-core" | "ipv6-native-core" | "long-explicit-path";
  choice: Architecture;
  justification: string;
}

export interface TroubleshootingState {
  started: boolean;
  locatorWithdrawn: boolean;
  wrongAttempts: string[];
  repaired: boolean;
  verified: boolean;
}

export interface CapstoneState {
  // Phase 1/2 — transport + TE (both encodings, always both built so
  // SIDE_BY_SIDE never has to wait on step order).
  mplsSegments: TeSegment[];
  srv6Segments: TeSegment[];
  mplsTransportPacket?: MplsPacket;
  srv6TransportPacket?: Srv6Packet;
  mplsTePacket?: MplsPacket;
  srv6TePacket?: Srv6Packet;

  // Phase 3 — VPN
  mplsVrfs: Partial<Record<RouterId, MplsVrf[]>>;
  mplsVpnRoute?: MplsVpnRoute;
  mplsVpnPacket?: MplsPacket;
  srv6VpnRoute?: VpnRoute;
  srv6ImportProgress?: ImportProgress;
  srv6VpnPacket?: L3vpnPacketState;

  // Phase 4 — protection
  sharedRepair?: TiLfaRepairPath;
  mplsRepairList: MplsRepairSegment[];
  linkFailed: boolean;
  mplsRepairPacket?: MplsPacket;
  srv6RepairPacket?: TiLfaPacketState;

  // Phase 6 — header efficiency
  csidComputed: boolean;

  // Journey (shared across both architectures, tagged)
  journey: JourneyHop[];

  // Troubleshooting incident
  troubleshooting: TroubleshootingState;

  // Engineering decision lab
  decisions: DecisionLabAnswer[];

  activeArchitecture: Architecture;
  completed: boolean;
}

export function createCapstoneState(): CapstoneState {
  return {
    mplsSegments: [],
    srv6Segments: [],
    mplsVrfs: createMplsVrfs(),
    mplsRepairList: [],
    linkFailed: false,
    csidComputed: false,
    journey: [],
    troubleshooting: { started: false, locatorWithdrawn: false, wrongAttempts: [], repaired: false, verified: false },
    decisions: [],
    activeArchitecture: "SR_MPLS",
    completed: false,
  };
}

// ===========================================================================
// 11. Packet visual builders
// ===========================================================================

function mplsPacketVisual(id: string, from: RouterId, to: RouterId, summary: string, pkt: MplsPacket): PacketVisual {
  return { id, protocol: "MPLS", from, to, summary, layers: buildMplsPacketLayers(pkt) };
}
function srv6PacketVisual(id: string, from: RouterId, to: RouterId, summary: string, pkt: Srv6Packet): PacketVisual {
  return { id, protocol: "IPV6", from, to, summary, layers: buildSrv6PacketLayers(pkt) };
}
function srv6L3vpnPacketVisual(id: string, from: RouterId, to: RouterId, summary: string, pkt: L3vpnPacketState): PacketVisual {
  const layers: PacketLayer[] = [
    { name: "Outer IPv6", color: "var(--pv-proto-ipv6)", fields: [{ label: "Source Address", value: pkt.outer.srcText }, { label: "Destination Address (Service SID)", value: fmtIpv6(pkt.outer.daHextets) }] },
    ...(pkt.inner && pkt.inner.kind === "IPV4" ? [{ name: "Customer IPv4", color: "var(--pv-proto-ip)", fields: [{ label: "Source IP", value: pkt.inner.srcIp }, { label: "Destination IP", value: pkt.inner.dstIp }] }] : []),
  ];
  return { id, protocol: "IPV6", from, to, summary, layers };
}
function tiLfaPacketVisual(id: string, from: RouterId, to: RouterId, summary: string, pkt: TiLfaPacketState): PacketVisual {
  return { id, protocol: "IPV6", from, to, summary, layers: buildTiLfaPacketLayers(pkt) };
}

// ===========================================================================
// 12. Scenario steps
// ===========================================================================

const CE1_SRC = "192.0.2.10"; // illustrative CE1-side source used for transport-only (pre-VPN) packets

// Precomputed, purely-deterministic results used inside static `narrative`
// strings below (ScenarioStep.narrative is a plain string, not a function —
// every value referenced here comes from the fixed topology/constants
// above, never from anything a learner's choice can change).
const MPLS_TE_SEGS = buildMplsTeSegments();
const SRV6_TE_SEGS = buildSrv6TeSegments();
const SRV6_TE_USD = testSrv6TeEndXUsdAlternative();
/** Build-time proof (mirrors `assertHeaderLabInvariants` below) that the advanced End.X+USD comparison narrative is describing what the real domain function actually does, not an assumed result. */
function assertSrv6TeUsdAlternative(): void {
  if (SRV6_TE_USD.outcome.action !== "USD_DECAP_FORWARD") throw new Error(`Expected End.X+USD to decapsulate and forward for the TE alternative, got action=${SRV6_TE_USD.outcome.action} (${SRV6_TE_USD.outcome.reason})`);
  if (SRV6_TE_USD.outcome.forwardedTo !== SRV6_TE_USD.repairSid.adjacency) throw new Error("End.X+USD alternative forwarded to an unexpected adjacency.");
  if (SRV6_TE_USD.segmentCount !== 1) throw new Error("End.X+USD alternative should require exactly one SID.");
}
assertSrv6TeUsdAlternative();
const SHARED_REPAIR: TiLfaRepairPath = computeSharedTiLfaRepair();
const SHARED_REPAIR_NODE_LABEL = SHARED_REPAIR.repairNode ? nodeSidLabel(SHARED_REPAIR.repairNode) : 0;
const SHARED_REPAIR_ADJ_LABEL = SHARED_REPAIR.repairNode && SHARED_REPAIR.mergeTarget ? adjSidLabel(SHARED_REPAIR.repairNode, SHARED_REPAIR.mergeTarget) : 0;
const NAIVE_DEMO = simulateNaiveForwarding(CORE_LINKS, CORE_DESTINATION, "LINK", PROTECTED_LINK, { [CORE_PLR]: true }, CORE_PLR, 6);
const CSID_LAB = computeCsidLab();
const ARCH_COMPARISON = compareArchitectures();
const MTU_COMPARISON = buildSegmentEncodingComparison();

/** ScenarioEngine.applyStepEffects only evaluates a step's whatChanged() when that step also defines run() — without this, the comparison bullets on these read-only steps were silently never shown. */
const noopRun = (state: CapstoneState) => ({ state, events: [] });

export const capstoneSteps: ScenarioStep<CapstoneState>[] = [
  {
    id: "brief",
    label: "Engineering Brief",
    narrative:
      "ENGINEERING BRIEF — build a provider service on ONE shared topology (CE1—PE1—P1—P2—PE2—CE2, with an alternate P1—P3—P4—P2 core path) that: (1) transports PE1→PE2 traffic, (2) provides a CUST-A L3VPN, (3) steers one flow over an explicit path, (4) survives a P1-P2 failure with local FRR, (5) preserves service delivery through the repair, (6) keeps packet overhead understandable. You will implement this brief once in SR-MPLS, then once in SRv6 — same topology, same customer, same failure, same TE requirement, every time.",
  },
  {
    id: "predict-same-architecture",
    label: "Same Architecture?",
    narrative: "Before building anything: what IS the relationship between SR-MPLS and SRv6?",
    question: {
      prompt: "Do SR-MPLS and SRv6 belong to different Segment Routing architectures?",
      options: [
        { id: "yes", label: "Yes — they're fundamentally different architectures" },
        { id: "no", label: "No — both implement RFC 8402 Segment Routing with different data-plane encodings" },
      ],
      correctOptionId: "no",
      explanation: "RFC 8402 defines ONE Segment Routing architecture. SR-MPLS and SRv6 are two data-plane encodings of it — the difference you're about to build is in the wire format and the capabilities that format exposes, not in the underlying model.",
    },
  },
  {
    id: "topology-tour",
    label: "Shared Topology",
    narrative:
      "CE1—PE1—P1—P2—PE2—CE2, plus an alternate core path PE1's own single uplink P1 also reaches: P1—P3—P4—P2. Metrics are the real IGP costs already proven in the SRv6 TI-LFA lesson (PE1-P1=10, P1-P2=10, P2-PE2=10, P1-P3=10, P3-P4=10, P4-P2=50, P4-PE2=70) — reused exactly, not re-typed, so this capstone's TI-LFA phase computes the identical repair that lesson already verified. Ordinary SPF prefers PE1→P1→P2→PE2 (cost 30). RR1 (route reflector) exists for MP-BGP VPN routes only — it is never shown on this topology because it never appears in the customer packet's journey.",
    run: (state) => ({ state, events: [{ type: "OSPF_SPF_COMPLETED", stepId: "topology-tour", timestamp: Date.now(), message: `Primary path PE1→PE2: ${PRIMARY_PATH.join(" → ")} (cost 30)` }] }),
    whatChanged: () => [`Primary (default SPF) path: ${PRIMARY_PATH.join(" → ")}`, `Alternate core path: P1 → P3 → P4 → P2`],
  },
  {
    id: "predict-rr-role",
    label: "RR1's Role",
    narrative: "RR1 reflects MP-BGP VPN routes between PE1 and PE2 later in this lesson.",
    question: {
      prompt: "Will RR1 ever appear as a hop in the customer's actual packet journey, in either architecture?",
      options: [
        { id: "yes", label: "Yes, whenever a VPN route it reflected is in use" },
        { id: "no", label: "No — RR1 is control-plane only" },
      ],
      correctOptionId: "no",
      explanation: "A Route Reflector re-advertises BGP UPDATEs between its clients — it never becomes part of the forwarding path those routes describe. Every packet in this lesson goes PE1 → (core) → PE2 directly.",
    },
  },

  // ------------------------------------------------------------------
  // Phase 1 — Transport (SR-MPLS)
  // ------------------------------------------------------------------
  {
    id: "mpls-transport-intro",
    label: "SR-MPLS: Shortest-Path Transport",
    narrative: "SR-MPLS first. Every core router already has an IGP-advertised Node-SID (Prefix-SID) — one MPLS label, globally significant, meaning \"reach this router via whatever the IGP currently thinks is shortest.\" The forwarding instruction is encoded entirely in the MPLS label stack.",
    run: (state) => ({ state: { ...state, activeArchitecture: "SR_MPLS" }, events: [] }),
  },
  {
    id: "mpls-transport-push",
    label: "PE1 Pushes the Node-SID",
    narrative: `PE1 imposes one label toward PE2: Node-SID(PE2) = ${nodeSidLabel("PE2")}.`,
    run: (state) => {
      const unlabeled: MplsPacket = { srcIp: CE1_SRC, dstIp: CE2_HOST_IPV4, labels: [] };
      const pkt = pushMplsLabel(unlabeled, nodeSidLabel("PE2"));
      const journey: JourneyHop = { architecture: "SR_MPLS", router: "PE1", input: "Unlabeled IPv4", lookup: `SID database: Node-SID(PE2)=${nodeSidLabel("PE2")}`, action: "PUSH", output: `Label ${nodeSidLabel("PE2")} pushed`, stepId: "mpls-transport-push", ingressPeer: CE1_ID, egressPeer: nextOnPath(PRIMARY_PATH, "PE1"), before: { kind: "MPLS", packet: unlabeled }, after: { kind: "MPLS", packet: pkt } };
      return { state: { ...state, mplsTransportPacket: pkt, journey: [...state.journey, journey] }, events: [{ type: "MPLS_LABEL_PUSHED", stepId: "mpls-transport-push", timestamp: Date.now(), message: `PE1 pushes Node-SID(PE2)=${nodeSidLabel("PE2")}` }] };
    },
    packet: (state) => (state.mplsTransportPacket ? mplsPacketVisual("mpls-transport", "PE1", "P1", "PUSH Node-SID(PE2)", state.mplsTransportPacket) : undefined),
    whatChanged: () => [`PE1 pushes label ${nodeSidLabel("PE2")} (Node-SID PE2)`],
  },
  {
    id: "mpls-transport-core",
    label: "P1/P2: LFIB Forwarding",
    narrative: "P1 and P2 never inspect the destination IP. Each looks up the incoming label in its own LFIB and either swaps it for the next hop's binding or, at the penultimate hop, pops it (PHP) — pure label-switching.",
    run: (state) => {
      const atP1 = state.mplsTransportPacket;
      const afterSwap = atP1 ? swapTopMplsLabel(atP1, nodeSidLabel("PE2")) : undefined;
      const afterPhp = afterSwap ? popTopMplsLabel(afterSwap) : undefined;
      const j1: JourneyHop = { architecture: "SR_MPLS", router: "P1", input: `Label ${nodeSidLabel("PE2")}`, lookup: "LFIB: incoming label → SWAP", action: "SWAP", output: `Label ${nodeSidLabel("PE2")} unchanged (global SID), forward to P2`, stepId: "mpls-transport-core", ingressPeer: prevOnPath(PRIMARY_PATH, "P1"), egressPeer: nextOnPath(PRIMARY_PATH, "P1"), before: atP1 && { kind: "MPLS", packet: atP1 }, after: afterSwap && { kind: "MPLS", packet: afterSwap } };
      const j2: JourneyHop = { architecture: "SR_MPLS", router: "P2", input: `Label ${nodeSidLabel("PE2")}`, lookup: "LFIB: this label's target is one hop away → PHP", action: "PHP_POP", output: "Label popped, plain IP forwarded to PE2", stepId: "mpls-transport-core", ingressPeer: prevOnPath(PRIMARY_PATH, "P2"), egressPeer: nextOnPath(PRIMARY_PATH, "P2"), before: afterSwap && { kind: "MPLS", packet: afterSwap }, after: afterPhp && { kind: "MPLS", packet: afterPhp } };
      return { state: { ...state, journey: [...state.journey, j1, j2] }, events: [{ type: "MPLS_LABEL_SWAPPED", stepId: "mpls-transport-core", timestamp: Date.now(), message: "P1 swaps (Node-SID unchanged); P2 performs PHP" }] };
    },
    // P1→P2 is the physical leg this labeled packet actually crosses; after P2's PHP the packet toward PE2 carries no label at all, so drawing this labeled visual on a P1→PE2 line (no such link) was both a fake adjacency and a wrong packet.
    packet: (state) => (state.mplsTransportPacket ? mplsPacketVisual("mpls-transport-core", "P1", "P2", "SWAP → PHP", state.mplsTransportPacket) : undefined),
  },
  {
    id: "predict-mpls-label-bytes",
    label: "Label Size",
    narrative: "One MPLS label stack entry is a fixed-width field.",
    question: {
      prompt: "Is one MPLS label stack entry 4 bytes (32 bits)?",
      options: [{ id: "yes", label: "Yes — 32 bits" }, { id: "no", label: "No — it's 128 bits" }],
      correctOptionId: "yes",
      explanation: "20-bit label + 3-bit traffic class + 1-bit bottom-of-stack + 8-bit TTL = 32 bits = 4 bytes. Keep this number — it's the whole reason Phase 6's byte comparison comes out the way it does.",
    },
  },

  // ------------------------------------------------------------------
  // Phase 1 — Transport (SRv6)
  // ------------------------------------------------------------------
  {
    id: "srv6-transport-intro",
    label: "SRv6: Shortest-Path Transport",
    narrative: "Same requirement, same topology, same primary path. In SRv6 every core router owns a real IPv6 address with an endpoint behavior bound to it — a SID. The forwarding instruction is encoded as an IPv6 Destination Address, not a label.",
    run: (state) => ({ state: { ...state, activeArchitecture: "SRV6" }, events: [] }),
  },
  {
    id: "srv6-transport-setda",
    label: "PE1 Sets the DA",
    narrative: `PE1 sets the packet's IPv6 Destination Address to PE2's End SID: ${endSidText("PE2")}. No label, no push — the destination address itself IS the segment.`,
    run: (state) => {
      const pkt: Srv6Packet = { srcText: "2001:db8:100:1::c1", daHextets: endSidHextets("PE2"), innerSrcIp: CE1_SRC, innerDstIp: CE2_HOST_IPV4 };
      const journey: JourneyHop = { architecture: "SRV6", router: "PE1", input: "Plain customer IPv4", lookup: `Local SID / locator database: ${BEHAVIOR_LABEL.END}(PE2)`, action: "SET_DA", output: `Outer IPv6 DA = ${endSidText("PE2")}`, stepId: "srv6-transport-setda", ingressPeer: CE1_ID, egressPeer: nextOnPath(PRIMARY_PATH, "PE1"), before: { kind: "IPV4", srcIp: CE1_SRC, dstIp: CE2_HOST_IPV4 }, after: { kind: "SRV6", packet: pkt } };
      return { state: { ...state, srv6TransportPacket: pkt, journey: [...state.journey, journey] }, events: [{ type: "SRV6_SERVICE_SID_RESOLVED", stepId: "srv6-transport-setda", timestamp: Date.now(), message: `PE1 sets DA = ${endSidText("PE2")}` }] };
    },
    packet: (state) => (state.srv6TransportPacket ? srv6PacketVisual("srv6-transport", "PE1", "P1", "DA = PE2 End SID", state.srv6TransportPacket) : undefined),
  },
  {
    id: "srv6-transport-core",
    label: "P1/P2: Ordinary IPv6 FIB",
    narrative: "P1 and P2 do NOT consult a Local SID Table at all — the DA doesn't match either of their own locators, so it's an ordinary longest-prefix-match IPv6 FIB lookup, identical in kind to any other IPv6 packet they'd ever forward.",
    run: (state) => {
      const pkt = state.srv6TransportPacket;
      const snap: HopPacket | undefined = pkt && { kind: "SRV6", packet: pkt };
      const j1: JourneyHop = { architecture: "SRV6", router: "P1", input: `DA=${endSidText("PE2")}`, lookup: "IPv6 FIB: longest-prefix match on PE2's locator", action: "IPV6_FIB_FORWARD", output: "Forward to P2 — DA untouched", stepId: "srv6-transport-core", ingressPeer: prevOnPath(PRIMARY_PATH, "P1"), egressPeer: nextOnPath(PRIMARY_PATH, "P1"), before: snap, after: snap };
      const j2: JourneyHop = { architecture: "SRV6", router: "P2", input: `DA=${endSidText("PE2")}`, lookup: "IPv6 FIB: longest-prefix match on PE2's locator", action: "IPV6_FIB_FORWARD", output: "Forward to PE2 — DA untouched", stepId: "srv6-transport-core", ingressPeer: prevOnPath(PRIMARY_PATH, "P2"), egressPeer: nextOnPath(PRIMARY_PATH, "P2"), before: snap, after: snap };
      return { state: { ...state, journey: [...state.journey, j1, j2] }, events: [] };
    },
    // P1→P2 is a real link; P1→PE2 is not (the packet reaches PE2 only via P2).
    packet: (state) => (state.srv6TransportPacket ? srv6PacketVisual("srv6-transport-core", "P1", "P2", "Ordinary IPv6 forwarding", state.srv6TransportPacket) : undefined),
  },
  {
    id: "srv6-transport-endpoint",
    label: "PE2: Local SID Match",
    narrative: `At PE2, the DA finally matches a Local SID Table entry: ${BEHAVIOR_LABEL.END}. PE2 executes the End behavior and delivers the (already-plain) customer packet.`,
    run: (state) => {
      const pkt = state.srv6TransportPacket;
      const journey: JourneyHop = { architecture: "SRV6", router: "PE2", input: `DA=${endSidText("PE2")}`, lookup: "Local SID Table: match found", action: "LOCAL_SID_MATCH", output: "End behavior executed — deliver toward CE2", stepId: "srv6-transport-endpoint", ingressPeer: prevOnPath(PRIMARY_PATH, "PE2"), egressPeer: CE2_ID, before: pkt && { kind: "SRV6", packet: pkt } };
      return { state: { ...state, journey: [...state.journey, journey] }, events: [] };
    },
  },
  {
    id: "compare-transport-encoding",
    label: "SIDE-BY-SIDE: Transport Encoding",
    narrative: "Same requirement, same path, same routers — two different forwarding-instruction encodings: a label stack entry vs. an IPv6 address. Core routers do ordinary label-switching or ordinary IPv6 forwarding either way; neither one consults customer state.",
    run: noopRun,
    whatChanged: () => compareTransportEncoding().map((r) => `${r.requirement}: SR-MPLS=${r.srMpls} | SRv6=${r.srv6}`),
  },

  // ------------------------------------------------------------------
  // Phase 2 — Explicit TE
  // ------------------------------------------------------------------
  {
    id: "te-requirement",
    label: "TE Requirement",
    narrative: `Requirement: steer PE1→PE2 traffic over the alternate core path ${TE_EXPLICIT_PATH.join(" → ")} even though ordinary SPF prefers ${PRIMARY_PATH.join(" → ")}. Computed from the SAME post-convergence-SPF function this lesson's own TI-LFA phase will reuse later — this is not a coincidence: an SR Policy and a TI-LFA repair can steer traffic over the identical alternate topology, for two different reasons (proactive engineering choice vs. reactive failure response).`,
  },
  {
    id: "predict-minimal-segments",
    label: "How Many Segments?",
    narrative: `The alternate path is ${TE_EXPLICIT_PATH.length - 1} physical hops after ${CORE_HEADEND} (${TE_EXPLICIT_PATH.slice(1).join(", ")}). A naive design imposes one segment per hop.`,
    question: {
      prompt: "Does steering over this exact path require one segment per physical hop?",
      options: [
        { id: "yes", label: `Yes — ${TE_EXPLICIT_PATH.length - 1} segments, one per hop` },
        { id: "no", label: "No — fewer segments suffice wherever ordinary shortest-path forwarding already agrees with the desired path" },
      ],
      correctOptionId: "no",
      explanation: `A Node-SID (or End SID) already carries a packet along whatever the IGP's OWN shortest path to that node is — one segment covers a whole stretch wherever that agrees with the desired route. Where it does NOT agree (even for a single hop), a Node-SID/End segment would misroute, so that hop needs a forced-adjacency segment (Adj-SID/End.X) instead — never assumed away. Here the minimal list is ${MPLS_TE_SEGS.length} segments for SR-MPLS and ${SRV6_TE_SEGS.length} for SRv6 (the "SIDE-BY-SIDE" view explains exactly why those counts differ).`,
    },
  },
  {
    id: "mpls-te-build",
    label: "SR-MPLS: Build the Policy",
    narrative: `SR-MPLS SR Policy segment list, derived (not hand-typed) from the real topology: ${MPLS_TE_SEGS.map((s) => (s.type === "NODE" ? `Node-SID(${s.owner})=${nodeSidLabel(s.owner)}` : `Adj-SID(${s.owner}→${s.target})=${adjSidLabel(s.owner, s.target!)}`)).join(" then ")}.`,
    run: (state) => {
      const segments = buildMplsTeSegments();
      const unlabeled: MplsPacket = { srcIp: CE1_SRC, dstIp: CE2_HOST_IPV4, labels: [] };
      let pkt: MplsPacket = unlabeled;
      for (let i = segments.length - 1; i >= 0; i--) {
        const s = segments[i];
        pkt = pushMplsLabel(pkt, s.type === "NODE" ? nodeSidLabel(s.owner) : adjSidLabel(s.owner, s.target!));
      }
      const stack = pkt.labels.map((l) => l.value).join(", ");
      const journey: JourneyHop = { architecture: "SR_MPLS", router: "PE1", input: "Unlabeled IPv4", lookup: `SR Policy (explicit path ${TE_EXPLICIT_PATH.join("→")}) → ${segments.length}-segment list`, action: "PUSH", output: `Label stack [${stack}] pushed (top first) — transit forwarding along the policy is not simulated in this capstone`, stepId: "mpls-te-build", ingressPeer: CE1_ID, egressPeer: nextOnPath(TE_EXPLICIT_PATH, "PE1"), before: { kind: "MPLS", packet: unlabeled }, after: { kind: "MPLS", packet: pkt } };
      return { state: { ...state, activeArchitecture: "SR_MPLS", mplsSegments: segments, mplsTePacket: pkt, journey: [...state.journey, journey] }, events: [{ type: "MPLS_LABEL_PUSHED", stepId: "mpls-te-build", timestamp: Date.now(), message: `PE1 pushes ${segments.length}-label TE stack` }] };
    },
    packet: (state) => (state.mplsTePacket ? mplsPacketVisual("mpls-te", "PE1", "P1", `PUSH ${state.mplsSegments.length}-label TE stack`, state.mplsTePacket) : undefined),
  },
  {
    id: "srv6-te-build",
    label: "SRv6: Build the Policy",
    narrative: `SRv6 SR Policy, same intent, same derivation, using the BASE End/End.X encoding: ${SRV6_TE_SEGS.map((s) => (s.type === "NODE" ? `${s.owner} End=${endSidText(s.owner)}` : `${s.owner} End.X→${s.target}=${endXSidText(s.owner)}`)).join(" then ")}. Under this encoding, it needs one more segment than SR-MPLS's base encoding: plain End.X still advances the SRH to the next real entry (RFC 8986 §4.2) rather than falling back to an untouched IP header the way MPLS's label stack does, so the trailing End(${SRV6_TE_SEGS[SRV6_TE_SEGS.length - 1]?.owner}) segment is genuinely required here, not padding. ${SRV6_TE_SEGS.length > 1 ? "More than one SID → a full SRH is required (never a fake single-SID shortcut)." : "Exactly one SID → no SRH needed."} (A different endpoint-behavior choice changes this count again — see the advanced comparison after the next step.)`,
    run: (state) => {
      const segments = buildSrv6TeSegments();
      const orderedSids = segments.map((s) => (s.type === "NODE" ? { sidHextets: endSidHextets(s.owner), sidText: endSidText(s.owner), owner: s.owner } : { sidHextets: endXSidHextets(s.owner), sidText: endXSidText(s.owner), owner: s.owner }));
      const srh = segments.length > 1 ? buildSrh(orderedSids) : undefined;
      const pkt: Srv6Packet = { srcText: "2001:db8:100:1::c1", daHextets: orderedSids[0].sidHextets, srh, innerSrcIp: CE1_SRC, innerDstIp: CE2_HOST_IPV4 };
      const journey: JourneyHop = { architecture: "SRV6", router: "PE1", input: "Plain customer IPv4", lookup: `SR Policy (explicit path ${TE_EXPLICIT_PATH.join("→")}) → ${segments.length}-SID program`, action: "H_ENCAPS", output: `Outer IPv6 DA = ${orderedSids[0].sidText}${srh ? `, SRH SL=${srh.segmentsLeft}` : ", no SRH"} — transit forwarding along the policy is not simulated in this capstone`, stepId: "srv6-te-build", ingressPeer: CE1_ID, egressPeer: nextOnPath(TE_EXPLICIT_PATH, "PE1"), before: { kind: "IPV4", srcIp: CE1_SRC, dstIp: CE2_HOST_IPV4 }, after: { kind: "SRV6", packet: pkt } };
      return { state: { ...state, activeArchitecture: "SRV6", srv6Segments: segments, srv6TePacket: pkt, journey: [...state.journey, journey] }, events: [{ type: "SRV6_SERVICE_SID_RESOLVED", stepId: "srv6-te-build", timestamp: Date.now(), message: `PE1 H.Encaps ${segments.length}-SID TE program` }] };
    },
    packet: (state) => (state.srv6TePacket ? srv6PacketVisual("srv6-te", "PE1", "P1", `H.Encaps ${state.srv6Segments.length}-SID program`, state.srv6TePacket) : undefined),
  },
  {
    id: "compare-te-encoding",
    label: "SIDE-BY-SIDE: Same Intent, Different Encoding",
    narrative: `LOGICAL INTENT is identical: ${TE_EXPLICIT_PATH.join(" → ")}. SR-MPLS expresses it as a label stack (Node-SID + a forced-adjacency Adj-SID where ordinary SPF disagrees); SRv6's BASE encoding expresses it as an IPv6 DA plus an SRH segment list (End + a forced-adjacency End.X for the same reason). Same path intent, different forwarding-plane encoding — scoped to these specific base behaviors, not a universal segment-count rule (see the advanced comparison next).`,
    run: noopRun,
    whatChanged: () => compareTeEncoding().map((r) => `${r.requirement}: SR-MPLS=${r.srMpls} | SRv6=${r.srv6}`),
  },
  {
    id: "srv6-te-usd-alternative",
    label: "Advanced: End.X+USD Alternative",
    narrative: `Advanced/optional: does a DIFFERENT SRv6 endpoint-behavior choice for the SAME forced hop (${SRV6_TE_USD.repairSid.owner}→${SRV6_TE_USD.repairSid.adjacency}) change the segment count above? RFC 8986's End.X USD flavor removes the ENTIRE outer IPv6 header at the owning router, exposing the original packet underneath, then forces it onward — the SAME mechanism this capstone's own TI-LFA repair phase already used for the P1-P2 repair (TI-LFA is one important use case for End.X+USD, already demonstrated elsewhere in PacketVerse — not the only one). Tested here through the real domain function, not assumed: H.Encaps at PE1 straight to a globally-routed End.X+USD SID at ${SRV6_TE_USD.repairSid.owner} (${SRV6_TE_USD.repairSid.sidText}), forcing ${SRV6_TE_USD.repairSid.owner}→${SRV6_TE_USD.repairSid.adjacency} — no separate reachability segment first, because this SRv6 SID's IPv6 address is globally routable via its locator regardless of which behavior is bound to it. This capstone's modeled MPLS Adj-SID, by contrast, is locally significant (RFC 8402's default) — see the note below for why that's a modeling choice, not a hard architectural limit. Real executed result: ${SRV6_TE_USD.outcome.reason}`,
    // A no-op run() is required so the engine actually evaluates whatChanged()
    // below (ScenarioEngine.applyStepEffects only calls whatChanged for steps
    // that also define run — see src/lib/sim-engine/ScenarioEngine.ts).
    run: (state) => ({ state, events: [{ type: "SRV6_SERVICE_SID_RESOLVED", stepId: "srv6-te-usd-alternative", timestamp: Date.now(), message: `End.X+USD alternative: ${SRV6_TE_USD.outcome.action}` }] }),
    whatChanged: () => [
      `Base comparison: SR-MPLS = ${MPLS_TE_SEGS.length} instructions | SRv6 End/End.X (base encoding) = ${SRV6_TE_SEGS.length} SIDs`,
      `Advanced SRv6 alternative: H.Encaps + a globally routed End.X+USD SID at ${SRV6_TE_USD.repairSid.owner} exposes the original IP packet and forces ${SRV6_TE_USD.repairSid.owner}→${SRV6_TE_USD.repairSid.adjacency} directly — ${SRV6_TE_USD.segmentCount} SID reaches ${CORE_DESTINATION} once ordinary IP forwarding takes over at ${SRV6_TE_USD.repairSid.adjacency}.`,
      `Local Adj-SID vs. globally routed End.X: this capstone models the common/default LOCALLY significant MPLS Adj-SID (RFC 8402), so the headend needs Node-SID(${SRV6_TE_USD.repairSid.owner})=${nodeSidLabel(SRV6_TE_USD.repairSid.owner)} first to reach the Adj-SID's owner, then Adj-SID(${SRV6_TE_USD.repairSid.owner}→${SRV6_TE_USD.repairSid.adjacency})=${adjSidLabel(SRV6_TE_USD.repairSid.owner, SRV6_TE_USD.repairSid.adjacency)}. The modeled SRv6 End.X+USD SID is globally reachable through ${SRV6_TE_USD.repairSid.owner}'s own IPv6 locator, so the headend can steer straight to it.`,
      `Standards nuance: RFC 8402 also permits a GLOBALLY significant Adj-SID — that could fold this SR-MPLS example down to one label too, the same way End.X+USD did for SRv6, but only at the cost of flooding that adjacency's reachability as extra forwarding state across the relevant SR domain/area (not modeled here).`,
      `2 MPLS labels vs. 1 SRv6 SID here is a property of the segment-allocation model demonstrated — local vs. global SID advertisement, which endpoint/adjacency behaviors are used, and the encapsulation method — not a universal law about which data plane always needs fewer segments.`,
    ],
  },

  // ------------------------------------------------------------------
  // Phase 3 — L3VPN
  // ------------------------------------------------------------------
  {
    id: "vpn-requirement",
    label: "L3VPN Requirement",
    narrative: `Requirement: CUST-A, connecting CE1 (${CE1_IPV4_PREFIX}) and CE2 (${CE2_IPV4_PREFIX}), RT ${CUST_A_EXPORT_RT}, a different RD per PE (${CUST_A_RD.PE1} / ${CUST_A_RD.PE2}). Built once in SR-MPLS, once in SRv6 — same VRF name, same RD, same RT, same prefixes, both times.`,
  },
  {
    id: "predict-vrf-rt-common",
    label: "What Carries Over?",
    narrative: "SRv6 changes the data plane. Does it change the VPN control-plane concepts?",
    question: {
      prompt: "Does SRv6 L3VPN eliminate the need for VRF, RD, and RT?",
      options: [{ id: "yes", label: "Yes — SRv6 replaces them with the Service SID" }, { id: "no", label: "No — VRF/RD/RT are unchanged; only the egress service identifier and its encoding change" }],
      correctOptionId: "no",
      explanation: "RFC 9252 keeps the entire RFC 4364 control-plane model — VRF, RD, RT, MP-BGP VPNv4 — completely intact. What's new is the SRv6 L3 Service TLV carrying a real Service SID instead of an MPLS VPN label.",
    },
  },
  {
    id: "mpls-vpn-build",
    label: "SR-MPLS: Build CUST-A",
    narrative: `PE2 exports ${CE2_IPV4_PREFIX} with RD ${CUST_A_RD.PE2}, RT ${CUST_A_EXPORT_RT}, VPN label ${VPN_LABEL.PE2}. PE1's CUST-A import RT matches — imported.`,
    run: (state) => {
      const route = exportMplsVpnRoute(CE2_IPV4_PREFIX, "PE2", "4.4.4.4");
      const matched = mplsRtImportMatches(route, CUST_A_IMPORT_RT);
      const vrfs = { ...state.mplsVrfs, PE1: (state.mplsVrfs.PE1 ?? []).map((v) => (v.name === "CUST-A" && matched ? { ...v, routes: [...v.routes, { prefix: route.prefix, origin: "imported" as const, rd: route.rd, viaPe: "PE2" as RouterId }] } : v)) };
      return { state: { ...state, activeArchitecture: "SR_MPLS", mplsVrfs: vrfs, mplsVpnRoute: route }, events: [{ type: "RT_IMPORT_EVALUATED", stepId: "mpls-vpn-build", timestamp: Date.now(), message: `RT ${route.rt} matches PE1 import RT ${CUST_A_IMPORT_RT}` }, { type: "VPN_ROUTE_IMPORTED", stepId: "mpls-vpn-build", timestamp: Date.now(), message: `${route.prefix} imported into CUST-A` }] };
    },
    whatChanged: (_, next) => [`PE2 exports ${next.mplsVpnRoute?.prefix} — RD ${next.mplsVpnRoute?.rd}, RT ${next.mplsVpnRoute?.rt}, VPN label ${next.mplsVpnRoute?.vpnLabel}`, "PE1 imports it into VRF CUST-A"],
  },
  {
    id: "mpls-vpn-packet",
    label: "SR-MPLS: VPN Packet",
    narrative: `CE1 (${CE1_HOST_IPV4}) sends to CE2 (${CE2_HOST_IPV4}). PE1 pushes TWO labels: the VPN label ${VPN_LABEL.PE2} (bottom), then the transport Node-SID(PE2)=${nodeSidLabel("PE2")} (top). P1/P2 read only the top (transport) label; the VPN label rides along unread.`,
    run: (state) => {
      const unlabeled: MplsPacket = { srcIp: CE1_HOST_IPV4, dstIp: CE2_HOST_IPV4, labels: [] };
      let pkt: MplsPacket = unlabeled;
      pkt = pushMplsLabel(pkt, VPN_LABEL.PE2!, "vpn");
      pkt = pushMplsLabel(pkt, nodeSidLabel("PE2"), "transport");
      const afterSwap = swapTopMplsLabel(pkt, nodeSidLabel("PE2"));
      const afterPhp = popTopMplsLabel(afterSwap);
      const afterVpnPop = popTopMplsLabel(afterPhp);
      const hop = (router: RouterId, before: MplsPacket, after: MplsPacket, egressPeer: RouterId | undefined): Pick<JourneyHop, "stepId" | "ingressPeer" | "egressPeer" | "before" | "after"> => ({ stepId: "mpls-vpn-packet", ingressPeer: router === "PE1" ? CE1_ID : prevOnPath(PRIMARY_PATH, router), egressPeer, before: { kind: "MPLS", packet: before }, after: { kind: "MPLS", packet: after } });
      const journey: JourneyHop[] = [
        { architecture: "SR_MPLS", router: "PE1", input: "Customer IPv4", lookup: "VRF CUST-A route lookup → VPN label; transport toward PE2 → Node-SID", action: "PUSH", output: `Labels: [${nodeSidLabel("PE2")}, ${VPN_LABEL.PE2}]`, ...hop("PE1", unlabeled, pkt, nextOnPath(PRIMARY_PATH, "PE1")) },
        { architecture: "SR_MPLS", router: "P1", input: `Top label ${nodeSidLabel("PE2")}`, lookup: "LFIB (transport label only)", action: "SWAP", output: "VPN label untouched, unread", ...hop("P1", pkt, afterSwap, nextOnPath(PRIMARY_PATH, "P1")) },
        { architecture: "SR_MPLS", router: "P2", input: `Top label ${nodeSidLabel("PE2")}`, lookup: "LFIB (transport label only)", action: "PHP_POP", output: "Transport label popped; VPN label now exposed", ...hop("P2", afterSwap, afterPhp, nextOnPath(PRIMARY_PATH, "P2")) },
        { architecture: "SR_MPLS", router: "PE2", input: `VPN label ${VPN_LABEL.PE2}`, lookup: "Per-label VRF context → CUST-A route table", action: "VPN_LOOKUP", output: `Delivered to CE2 (${CE2_HOST_IPV4})`, ...hop("PE2", afterPhp, afterVpnPop, CE2_ID) },
      ];
      return { state: { ...state, activeArchitecture: "SR_MPLS", mplsVpnPacket: pkt, journey: [...state.journey, ...journey] }, events: [{ type: "TRANSPORT_LABEL_PUSHED", stepId: "mpls-vpn-packet", timestamp: Date.now(), message: "PE1 pushes VPN + transport labels" }, { type: "VPN_PACKET_DELIVERED", stepId: "mpls-vpn-packet", timestamp: Date.now(), message: "Delivered to CE2 via VPN label" }] };
    },
    packet: (state) => (state.mplsVpnPacket ? mplsPacketVisual("mpls-vpn", "PE1", "P1", "Transport label over VPN label", state.mplsVpnPacket) : undefined),
  },
  {
    id: "srv6-vpn-build",
    label: "SRv6: Build CUST-A",
    narrative: `PE2 allocates a Service SID bound to End.DT4 for CUST-A and advertises it via the SRv6 L3 Service TLV, alongside the SAME RD/RT/prefix as the SR-MPLS side. PE1's CUST-A import RT matches — imported.`,
    run: (state) => {
      const serviceSid = allocateServiceSid("PE2", "END_DT4", "CUST-A");
      const customerRoute: CustomerRoute = PE2_LOCAL_ROUTES.find((r) => r.prefix === CE2_IPV4_PREFIX) ?? PE2_LOCAL_ROUTES[0];
      const route = exportVpnRoute(customerRoute, "PE2", CUST_A_RD.PE2!, CUST_A_EXPORT_RT, "2001:db8:100:2::c2", serviceSid);
      const progress = installVpnRoute(importVpnRoute(route, CUST_A_IMPORT_RT), true, true);
      return { state: { ...state, activeArchitecture: "SRV6", srv6VpnRoute: route, srv6ImportProgress: progress }, events: [{ type: "RT_IMPORT_EVALUATED", stepId: "srv6-vpn-build", timestamp: Date.now(), message: progress.rtImport?.reason ?? "" }, { type: "SRV6_SERVICE_SID_RESOLVED", stepId: "srv6-vpn-build", timestamp: Date.now(), message: progress.serviceSidResolution?.reason ?? "" }] };
    },
    whatChanged: (_, next) => [`PE2 advertises Service SID ${next.srv6VpnRoute?.prefixSid?.l3Service.serviceSid.sidText} (End.DT4) for ${next.srv6VpnRoute?.prefix}`, `PE1 installs it: ${next.srv6ImportProgress?.installed ? "installed" : "not installed"}`],
  },
  {
    id: "srv6-vpn-packet",
    label: "SRv6: VPN Packet",
    narrative: `CE1 sends to CE2. PE1 encapsulates the plain customer IPv4 packet in outer IPv6 with DA = PE2's Service SID directly — no VPN label, no separate transport label. The ONE Service SID is both "how do I reach PE2" and "what do I do once there."`,
    run: (state) => {
      if (!state.srv6VpnRoute?.prefixSid) return { state, events: [] };
      const serviceSid = state.srv6VpnRoute.prefixSid.l3Service.serviceSid;
      const pkt = encapsulateSrv6VpnPacket(serviceSid, { kind: "IPV4", srcIp: CE1_HOST_IPV4, dstIp: CE2_HOST_IPV4 }, "2001:db8:100:1::c1");
      const outcome = processEgressServiceSid(serviceSid, pkt, PE2_LOCAL_ROUTES, []);
      const customer: HopPacket = { kind: "IPV4", srcIp: CE1_HOST_IPV4, dstIp: CE2_HOST_IPV4 };
      const encapsulated: HopPacket = { kind: "SRV6_L3VPN", packet: pkt };
      const exposed: HopPacket | undefined = !outcome.dropped && outcome.exposedInner?.kind === "IPV4" ? { kind: "IPV4", srcIp: outcome.exposedInner.srcIp, dstIp: outcome.exposedInner.dstIp } : undefined;
      const peers = (router: RouterId) => ({ stepId: "srv6-vpn-packet", ingressPeer: router === "PE1" ? CE1_ID : prevOnPath(PRIMARY_PATH, router), egressPeer: router === "PE2" ? (outcome.dropped ? undefined : capstoneRouter(outcome.ceTarget)) : nextOnPath(PRIMARY_PATH, router) });
      const journey: JourneyHop[] = [
        { architecture: "SRV6", router: "PE1", input: "Customer IPv4", lookup: "VRF CUST-A route lookup → Service SID", action: "SET_DA", output: `Outer IPv6 DA = ${serviceSid.sidText}`, ...peers("PE1"), before: customer, after: encapsulated },
        { architecture: "SRV6", router: "P1", input: `DA=${serviceSid.sidText}`, lookup: "IPv6 FIB (no VRF state)", action: "IPV6_FIB_FORWARD", output: "Forward toward PE2", ...peers("P1"), before: encapsulated, after: encapsulated },
        { architecture: "SRV6", router: "P2", input: `DA=${serviceSid.sidText}`, lookup: "IPv6 FIB (no VRF state)", action: "IPV6_FIB_FORWARD", output: "Forward toward PE2", ...peers("P2"), before: encapsulated, after: encapsulated },
        { architecture: "SRV6", router: "PE2", input: `DA=${serviceSid.sidText}`, lookup: "Local SID Table: End.DT4 → CUST-A VRF", action: "END_DT4_DECAP", output: outcome.dropped ? `DROPPED: ${outcome.reason}` : `Delivered to ${outcome.ceTarget} (${CE2_HOST_IPV4})`, ...peers("PE2"), before: encapsulated, after: exposed },
      ];
      return { state: { ...state, activeArchitecture: "SRV6", srv6VpnPacket: pkt, journey: [...state.journey, ...journey] }, events: [{ type: "SRV6_VPN_PACKET_ENCAPSULATED", stepId: "srv6-vpn-packet", timestamp: Date.now(), message: "PE1 encapsulates with Service SID as DA" }, { type: "VPN_PACKET_DELIVERED", stepId: "srv6-vpn-packet", timestamp: Date.now(), message: "Delivered via End.DT4" }] };
    },
    packet: (state) => (state.srv6VpnPacket ? srv6L3vpnPacketVisual("srv6-vpn", "PE1", "P1", "DA = Service SID (End.DT4)", state.srv6VpnPacket) : undefined),
  },
  {
    id: "predict-p-router-vrf",
    label: "P-Router State",
    narrative: "P1 and P2 just forwarded VPN traffic in both architectures.",
    question: {
      prompt: "Do P1/P2 need CUST-A routes installed, in either architecture?",
      options: [{ id: "yes", label: "Yes, at least in one of the two" }, { id: "no", label: "No — neither architecture requires it" }],
      correctOptionId: "no",
      explanation: "Provider core transport nodes never need customer VRF routes merely because they transit VPN traffic — true in SR-MPLS (they read only the transport label) and equally true in SRv6 (they read only the outer IPv6 DA against their own IPv6 FIB, never a VRF).",
    },
  },
  {
    id: "compare-vpn-encoding",
    label: "SIDE-BY-SIDE: VPN Control Plane vs. Service Plane",
    narrative: "COMMON: VRF, RD, RT, MP-BGP VPN route — byte-for-byte identical policy on both sides. DIFFERENT: the service identifier attached to that route (an MPLS VPN label vs. a real, globally-routable IPv6 Service SID) and what the egress PE does with it.",
    run: noopRun,
    whatChanged: () => compareVpnEncoding().map((r) => `${r.requirement}: SR-MPLS=${r.srMpls} | SRv6=${r.srv6}`),
  },
  {
    id: "predict-bgp-next-hop",
    label: "BGP Next Hop vs. Service Identifier",
    narrative: "PE1 resolves PE2's BGP next hop (ordinary IGP/infrastructure reachability) completely separately from PE2's service identifier.",
    question: {
      prompt: "Is the BGP next hop the same value as the VPN label (SR-MPLS) or the Service SID (SRv6)?",
      options: [{ id: "same", label: "Yes, they're the same field" }, { id: "different", label: "No — next hop is infrastructure reachability; the label/SID is a separate service identifier" }],
      correctOptionId: "different",
      explanation: "In both architectures, BGP next-hop resolution answers \"can I reach the advertising PE at all,\" while the VPN label / Service SID answers \"what do I do once I get there.\" An SRv6 Service SID is never assumed to equal the BGP next hop, even though both are IPv6 addresses.",
    },
  },

  // ------------------------------------------------------------------
  // Phase 4 — Failure protection (shared TI-LFA computation)
  // ------------------------------------------------------------------
  {
    id: "failure-requirement",
    label: "Protection Requirement",
    narrative: `Requirement: survive a ${PROTECTED_LINK} failure with local FRR, at PLR ${CORE_PLR}, without losing the CUST-A service traffic just built.`,
  },
  {
    id: "shared-tilfa-compute",
    label: "SHARED: TI-LFA Topology Computation",
    narrative: "This is the critical capstone point: the P-Space, Q-Space, post-convergence-path, and repair-node selection are computed ONCE, using the exact same algorithm this capstone already used for Phase 2's TE path. Only what happens AFTER a repair node is chosen differs between architectures.",
    run: (state) => {
      const repair = computeSharedTiLfaRepair();
      return { state: { ...state, sharedRepair: repair, mplsRepairList: buildMplsRepairList(repair) }, events: [{ type: "OSPF_SPF_COMPLETED", stepId: "shared-tilfa-compute", timestamp: Date.now(), message: `Repair node ${repair.repairNode}, merge target ${repair.mergeTarget}, OIF ${CORE_PLR}→${repair.outgoingInterface}` }] };
    },
    whatChanged: (_, next) => [`P-Space(${CORE_PLR}): ${next.sharedRepair?.pSpace.join(", ")}`, `Extended P-Space: ${next.sharedRepair?.extendedPSpace.join(", ")}`, `Q-Space(${CORE_DESTINATION}): ${next.sharedRepair?.qSpace.join(", ")}`, `Repair node: ${next.sharedRepair?.repairNode}, merge target: ${next.sharedRepair?.mergeTarget}`],
  },
  {
    id: "predict-tilfa-shared",
    label: "Same Algorithm?",
    narrative: "You just watched ONE computation feed both architectures' repairs.",
    question: {
      prompt: "Is the TI-LFA topology computation (P-Space/Q-Space/post-convergence path) fundamentally a different algorithm because one repair list ends up using labels and the other SIDs?",
      options: [{ id: "yes", label: "Yes — different encodings need different algorithms" }, { id: "no", label: "No — it's the identical repair-topology computation either way" }],
      correctOptionId: "no",
      explanation: "The repair TOPOLOGY problem (which node is safe, reachable, and loop-free) is completely shared. Only the REPAIR ENCODING — how that chosen node/adjacency gets expressed in the data plane — differs.",
    },
  },
  {
    id: "link-fails",
    label: "P1-P2 Fails",
    narrative: `${PROTECTED_LINK} goes down. ${CORE_PLR} detects it locally and instantly, without waiting for IGP flooding.`,
    run: (state) => ({ state: { ...state, linkFailed: true }, events: [{ type: "SRV6_LOCATOR_WITHDRAWN", stepId: "link-fails", timestamp: Date.now(), message: `${PROTECTED_LINK} down; ${CORE_PLR} activates local repair` }] }),
  },
  {
    id: "mpls-repair-encoding",
    label: "SR-MPLS: Repair Encoding",
    narrative: `${CORE_PLR} encodes the SAME chosen repair as an MPLS label stack: Node-SID(${SHARED_REPAIR.repairNode})=${SHARED_REPAIR_NODE_LABEL}, then a locally-significant Adj-SID forcing ${SHARED_REPAIR.repairNode}→${SHARED_REPAIR.mergeTarget}=${SHARED_REPAIR_ADJ_LABEL}.`,
    run: (state) => {
      if (!state.sharedRepair) return { state, events: [] };
      const modeledInput: MplsPacket = { srcIp: CE1_HOST_IPV4, dstIp: CE2_HOST_IPV4, labels: [] };
      let pkt: MplsPacket = modeledInput;
      const list = state.mplsRepairList;
      for (let i = list.length - 1; i >= 0; i--) pkt = pushMplsLabel(pkt, list[i].label);
      const journey: JourneyHop = { architecture: "SR_MPLS", router: CORE_PLR, input: "Primary next hop down", lookup: `Repair OIF ${CORE_PLR}→${state.sharedRepair.outgoingInterface}; repair labels [${list.map((s) => s.label).join(", ")}]`, action: "REPAIR_PUSH", output: "Repair label stack pushed", stepId: "mpls-repair-encoding", ingressPeer: prevOnPath(PRIMARY_PATH, CORE_PLR), egressPeer: state.sharedRepair.outgoingInterface, before: { kind: "MPLS", packet: modeledInput }, after: { kind: "MPLS", packet: pkt } };
      return { state: { ...state, activeArchitecture: "SR_MPLS", mplsRepairPacket: pkt, journey: [...state.journey, journey] }, events: [{ type: "MPLS_LABEL_PUSHED", stepId: "mpls-repair-encoding", timestamp: Date.now(), message: "PLR pushes repair label stack" }] };
    },
    packet: (state) => (state.mplsRepairPacket ? mplsPacketVisual("mpls-repair", CORE_PLR, "P3", "Repair: Node-SID + Adj-SID", state.mplsRepairPacket) : undefined),
  },
  {
    id: "srv6-repair-encoding",
    label: "SRv6: Repair Encoding",
    narrative: `${CORE_PLR} encodes the IDENTICAL chosen repair as one SRv6 SID: ${SHARED_REPAIR.repairNode} End.X+USD → ${SHARED_REPAIR.mergeTarget}. A single globally-routed SID expresses what SR-MPLS needed two labels for.`,
    run: (state) => {
      if (!state.sharedRepair?.repairList.sids[0]) return { state, events: [] };
      const sid = state.sharedRepair.repairList.sids[0];
      const modeledInput: TiLfaPacketState = { inner: { kind: "IPV4", srcIp: CE1_HOST_IPV4, dstIp: CE2_HOST_IPV4 } };
      const wrapped = encapsulateRepairSingleSid(sid, modeledInput);
      const journey: JourneyHop = { architecture: "SRV6", router: CORE_PLR, input: "Primary next hop down", lookup: `Repair OIF ${CORE_PLR}→${state.sharedRepair.outgoingInterface}; repair SID ${sid.sidText}`, action: "REPAIR_ENCAPSULATE", output: "Repair outer added (no SRH — single SID)", stepId: "srv6-repair-encoding", ingressPeer: prevOnPath(PRIMARY_PATH, CORE_PLR), egressPeer: state.sharedRepair.outgoingInterface, before: { kind: "SRV6_TILFA", packet: modeledInput }, after: { kind: "SRV6_TILFA", packet: wrapped } };
      return { state: { ...state, activeArchitecture: "SRV6", srv6RepairPacket: wrapped, journey: [...state.journey, journey] }, events: [{ type: "SRV6_VPN_PACKET_ENCAPSULATED", stepId: "srv6-repair-encoding", timestamp: Date.now(), message: "PLR wraps traffic in the repair SID" }] };
    },
    packet: (state) => (state.srv6RepairPacket ? tiLfaPacketVisual("srv6-repair", CORE_PLR, "P3", "Repair: End.X+USD SID", state.srv6RepairPacket) : undefined),
  },
  {
    id: "repair-execution",
    label: "Repair Node Executes",
    narrative: `At ${SHARED_REPAIR.repairNode}: SR-MPLS pops the Node-SID label, reads the Adj-SID, forces the ${SHARED_REPAIR.repairNode}→${SHARED_REPAIR.mergeTarget} adjacency. SRv6's USD flavor removes the entire repair outer header, exposing the original packet, then forces the same adjacency. Both land the packet at ${SHARED_REPAIR.mergeTarget} with the ORIGINAL customer packet (its VPN encapsulation, if any, untouched underneath).`,
    run: (state) => {
      if (!state.sharedRepair?.repairNode || !state.sharedRepair.mergeTarget) return { state, events: [] };
      const repairNode = state.sharedRepair.repairNode;
      // Physical predecessor of the repair node on the real post-convergence path (P1→P3→P4 here) — never the previous logical segment's owner.
      const repairIngress = state.sharedRepair.postConvergencePath ? prevOnPath(state.sharedRepair.postConvergencePath, repairNode) : undefined;
      // Node-SID pop, then the local Adj-SID is consumed as the packet is forced onto its adjacency — leaving the modeled, untouched IPv4 packet (see buildMplsTeSegments for the same Adj-SID semantics).
      const mplsIn = state.mplsRepairPacket;
      const mplsOut = mplsIn ? popTopMplsLabel(popTopMplsLabel(mplsIn)) : undefined;
      const mplsJourney: JourneyHop = { architecture: "SR_MPLS", router: repairNode, input: "Repair label stack", lookup: "LFIB: Node-SID pop, then local Adj-SID", action: "REPAIR_FORWARD_ADJ", output: `Forced onto the ${repairNode}→${state.sharedRepair.mergeTarget} adjacency`, stepId: "repair-execution", ingressPeer: repairIngress, egressPeer: state.sharedRepair.mergeTarget, before: mplsIn && { kind: "MPLS", packet: mplsIn }, after: mplsOut && { kind: "MPLS", packet: mplsOut } };
      let srv6Journey: JourneyHop | undefined;
      if (state.srv6RepairPacket) {
        const outcome = executeEndXUsd(state.sharedRepair.repairList.sids[0], state.srv6RepairPacket);
        srv6Journey = { architecture: "SRV6", router: repairNode, input: "Repair SID (final segment)", lookup: "Local SID Table: End.X, flavor USD", action: outcome.action, output: outcome.reason, stepId: "repair-execution", ingressPeer: repairIngress, egressPeer: outcome.forwardedTo, before: { kind: "SRV6_TILFA", packet: state.srv6RepairPacket }, after: outcome.exposedPacket && { kind: "SRV6_TILFA", packet: outcome.exposedPacket } };
      }
      return { state: { ...state, journey: [...state.journey, mplsJourney, ...(srv6Journey ? [srv6Journey] : [])] }, events: [] };
    },
  },
  {
    id: "stale-fib-check",
    label: "Stale-FIB Loop Check",
    narrative: `${CORE_PLR} knows about the failure; P3 and P4 do not YET (IGP is still converging). A naive redirect that just points at P3 without an explicit forced repair would use P3's STALE FIB. Simulated against real per-router FIB state: ${NAIVE_DEMO.looped ? "genuinely loops" : "happens not to loop this time"} — this is exactly why the repair forces the exact adjacency instead of trusting downstream forwarding.`,
    run: (state) => {
      const naive = simulateNaiveForwarding(CORE_LINKS, CORE_DESTINATION, "LINK", PROTECTED_LINK, { [CORE_PLR]: true }, CORE_PLR, 6);
      const valid = state.sharedRepair ? validateRepairPath(state.sharedRepair, CORE_LINKS) : undefined;
      return { state, events: [{ type: "OSPF_SPF_COMPLETED", stepId: "stale-fib-check", timestamp: Date.now(), message: `Naive forwarding looped: ${naive.looped}. Forced repair valid: ${valid?.valid}` }] };
    },
  },
  {
    id: "compare-protection-encoding",
    label: "SIDE-BY-SIDE: Repair Encoding",
    narrative: "SAME failure, SAME PLR, SAME desired repair topology. SR-MPLS: OIF + a two-entry label repair list (Node-SID + Adj-SID). SRv6: OIF + one globally-routed End.X+USD SID. A globally routed End.X can fold what SR-MPLS needed two labels to express into one SID — that's a real difference, not a universal one (see the header-efficiency phase for why it doesn't always work out that way).",
    run: noopRun,
    whatChanged: (_, next) => (next.sharedRepair ? compareProtectionEncoding(next.sharedRepair).map((r) => `${r.requirement}: SR-MPLS=${r.srMpls} | SRv6=${r.srv6}`) : []),
  },
  {
    id: "predict-endx-always-smaller",
    label: "Always Smaller?",
    narrative: "The SRv6 repair just used one SID where SR-MPLS needed two labels.",
    question: {
      prompt: "Does a globally routed End.X SID always produce a smaller repair encoding than SR-MPLS?",
      options: [{ id: "yes", label: "Yes — SRv6 repair is always more compact" }, { id: "no", label: "No — it happened to fold two hops into one SID here; the general case depends on topology" }],
      correctOptionId: "no",
      explanation: "Here, one End.X SID could express both \"reach the repair node\" and \"force this exact adjacency\" because the repair node is globally reachable. That's a real, useful property — but it's not a law; a different topology could need more SIDs, or an SR-MPLS design could need only one label.",
    },
  },

  // ------------------------------------------------------------------
  // Phase 5 — Endpoint programmability (read-only comparison)
  // ------------------------------------------------------------------
  {
    id: "endpoint-programmability",
    label: "Endpoint Programmability",
    narrative:
      "One genuine architectural difference: an SR-MPLS segment is primarily a forwarding instruction expressed as a label — the label value itself carries no semantic beyond \"what to do with this stack.\" An SRv6 SID IS an IPv6 address bound to a named endpoint-behavior (End, End.X, End.T, End.DT4, End.DT6, ...), each independently specified by RFC 8986. This capstone already used End (topological) and End.X+USD (protection) and End.DT4 (VPN service) — all from the SAME SID-address space, distinguished by which local behavior a router bound to that address.",
    run: noopRun,
    whatChanged: () => (["END", "END_X", "END_DT4"] as Srv6EndpointBehavior[]).map((b) => `${BEHAVIOR_LABEL[b]}: ${BEHAVIOR_FAMILY[b]}`),
  },
  {
    id: "predict-mpls-no-services",
    label: "MPLS and Services",
    narrative: "Don't over-read the endpoint-programmability difference.",
    question: {
      prompt: "Does the fact that SRv6 exposes named endpoint behaviors mean MPLS cannot provide VPN, TE, or FRR services?",
      options: [{ id: "yes", label: "Yes — MPLS is \"just dumb labels\"" }, { id: "no", label: "No — this capstone just built VPN, TE, and FRR entirely in SR-MPLS" }],
      correctOptionId: "no",
      explanation: "You built a full L3VPN, an explicit-TE policy, and a TI-LFA local repair in SR-MPLS in this exact lesson. The real difference is that SRv6 exposes its endpoint behaviors directly through the SID address space (RFC 8986's network-programming model) — not that MPLS lacks sophisticated services.",
    },
  },

  // ------------------------------------------------------------------
  // Phase 6 — Header efficiency + CSID
  // ------------------------------------------------------------------
  {
    id: "header-efficiency-setup",
    label: "Header Efficiency: The Long Program",
    narrative: `An abstract, topology-independent instruction-count exercise: the same logical 8-segment program (S1..S8), reusing the SRv6 CSID lesson's own compression engine and 8-router SID space — compare SR-MPLS label-stack bytes against uncompressed SRv6 SID-list bytes.`,
    run: (state) => {
      const csid = computeCsidLab();
      return { state: { ...state, csidComputed: true }, events: [{ type: "SRV6_CSID_COMPRESSED", stepId: "header-efficiency-setup", timestamp: Date.now(), message: `${csid.segmentCount} segments → ${csid.metrics.compressedContainerCount} NEXT-CSID container(s)` }] };
    },
  },
  {
    id: "header-efficiency-mpls",
    label: "SR-MPLS: Instruction Storage",
    narrative: `${HEADER_LAB_SEGMENT_COUNT} segments × 4 bytes/label = ${mplsStackBytes(HEADER_LAB_SEGMENT_COUNT)} bytes of label-stack storage.`,
  },
  {
    id: "header-efficiency-srv6",
    label: "SRv6: Uncompressed Instruction Storage",
    narrative: `${HEADER_LAB_SEGMENT_COUNT} segments × 16 bytes/SID = ${srv6UncompressedBytes(HEADER_LAB_SEGMENT_COUNT)} bytes of segment-value storage — NOT total packet overhead; SRv6 also carries an outer IPv6 header and (when more than one SID remains) an SRH base, exactly like SR-MPLS carries its own encapsulation context.`,
  },
  {
    id: "header-efficiency-csid",
    label: "SRv6: RFC 9800 NEXT-CSID",
    narrative: `NEXT-CSID packs multiple 16-bit compressed SIDs into containers sharing one Locator-Block: ${CSID_LAB.segmentCount} segments compress into ${CSID_LAB.metrics.compressedContainerCount} container(s) of ${SRV6_SID_BYTES} bytes each = ${CSID_LAB.metrics.compressedSegmentBytes} bytes, a ${CSID_LAB.metrics.percentageReduction.toFixed(0)}% reduction in segment-value storage over the uncompressed list — while the logical program (RFC 9800's own compression-equivalence requirement) is unchanged.`,
    run: (state) => ({ state, events: [{ type: "SRV6_CSID_CONTAINER_ADVANCED", stepId: "header-efficiency-csid", timestamp: Date.now(), message: "Compression plan computed" }] }),
  },
  {
    id: "header-efficiency-mtu-case",
    label: "MTU Case: Modeled Packet Size",
    narrative: `Near-MTU case, calculated (never asserted): SR-MPLS modeled overhead ${MTU_COMPARISON[0].modeledTotalOverhead} bytes. SRv6 uncompressed modeled overhead ${MTU_COMPARISON[1].modeledTotalOverhead} bytes (outer IPv6 ${MTU_COMPARISON[1].outerHeaderBytes}B + SRH ${MTU_COMPARISON[1].instructionBytes + MTU_COMPARISON[1].extensionHeaderBytes}B). SRv6 CSID modeled overhead ${MTU_COMPARISON[2].modeledTotalOverhead} bytes. Packet-size impact depends on the actual segment count and encoding — never a universal per-architecture statement.`,
  },
  {
    id: "predict-equal-storage-equal-overhead",
    label: "Equal Storage, Equal Overhead?",
    narrative: `SR-MPLS instruction storage (${mplsStackBytes(HEADER_LAB_SEGMENT_COUNT)} bytes) happens to equal SRv6's CSID-compressed storage (${CSID_LAB.metrics.compressedSegmentBytes} bytes) in this example.`,
    question: {
      prompt: "Does equal segment-instruction storage between SR-MPLS and CSID-compressed SRv6 mean their TOTAL packet overhead is identical?",
      options: [{ id: "yes", label: "Yes — same instruction bytes means same total overhead" }, { id: "no", label: "No — outer IPv6/SRH-base overhead and MPLS's own encapsulation context are separate accounting" }],
      correctOptionId: "no",
      explanation: "This lesson deliberately labels these numbers \"segment-instruction storage,\" never \"total packet overhead.\" SRv6 still carries an outer IPv6 header (and, when more than one CSID container remains, SRH base fields) that SR-MPLS's own encapsulation context accounts for differently. Equal instruction-storage bytes is a real, useful data point — not a total-overhead equivalence claim.",
    },
  },

  // ------------------------------------------------------------------
  // Requirement matrix + engineering decision lab
  // ------------------------------------------------------------------
  {
    id: "requirement-matrix",
    label: "Requirement Matrix",
    narrative: "Every requirement from the brief, both implementations, side by side. No winner column — just what each encoding actually is.",
    run: noopRun,
    whatChanged: () => buildRequirementMatrix().map((r) => `${r.requirement} — SR-MPLS: ${r.srMpls} | SRv6: ${r.srv6}`),
  },
  {
    id: "decision-lab-a",
    label: "Decision Lab A: Existing MPLS Core",
    narrative: "Fictional requirement: an existing MPLS-enabled backbone, extensive MPLS operational tooling already in place, L3VPN already deployed, shortest migration path desired. Which architecture fits this requirement best?",
    question: {
      prompt: "For Scenario A (existing MPLS core, minimal migration risk desired), which architecture better fits the stated requirement?",
      options: [{ id: "sr-mpls", label: "SR-MPLS — reuses existing MPLS operations/tooling" }, { id: "srv6", label: "SRv6 — replace the data plane" }],
      correctOptionId: "sr-mpls",
      explanation: "SR-MPLS lets this operator reuse significant existing MPLS operational knowledge and infrastructure. This is a fit for THIS requirement, not a universal statement that SR-MPLS is always correct.",
    },
    action: (state, payload) => {
      const choice = payload as Architecture;
      return { state: { ...state, decisions: [...state.decisions.filter((d) => d.scenarioId !== "existing-mpls-core"), { scenarioId: "existing-mpls-core", choice, justification: "Existing MPLS operational investment favors SR-MPLS for this requirement." }] }, events: [] };
    },
  },
  {
    id: "decision-lab-b",
    label: "Decision Lab B: IPv6-Native Core with Service Programming",
    narrative: "Fictional requirement: an IPv6 provider core, a desire for SRv6 endpoint behaviors and service SIDs, and a network-programming model for services. Which architecture fits best?",
    question: {
      prompt: "For Scenario B (IPv6-native core, service-programming model desired), which architecture better fits the stated requirement?",
      options: [{ id: "sr-mpls", label: "SR-MPLS" }, { id: "srv6", label: "SRv6 — directly exposes the endpoint-behavior programming model" }],
      correctOptionId: "srv6",
      explanation: "SRv6 directly provides the RFC 8986 network-programming model this requirement asks for. Again: a fit for this requirement, not a universal verdict.",
    },
    action: (state, payload) => {
      const choice = payload as Architecture;
      return { state: { ...state, decisions: [...state.decisions.filter((d) => d.scenarioId !== "ipv6-native-core"), { scenarioId: "ipv6-native-core", choice, justification: "IPv6-native service-programming requirement favors SRv6." }] }, events: [] };
    },
  },
  {
    id: "decision-lab-c",
    label: "Decision Lab C: Long Explicit Path, MTU Headroom Concern",
    narrative: `Fictional requirement: a long explicit segment list, with an active MTU/headroom concern. Calculate before deciding: SR-MPLS stack = ${mplsStackBytes(CSID_LAB.segmentCount)} bytes. SRv6 uncompressed = ${srv6UncompressedBytes(CSID_LAB.segmentCount)} bytes. SRv6 CSID-compressed = ${CSID_LAB.metrics.compressedSegmentBytes} bytes.`,
    question: {
      prompt: "For Scenario C (long explicit path, tight MTU headroom), which encoding minimizes segment-instruction storage, based on the numbers you just calculated?",
      options: [{ id: "sr-mpls", label: "SR-MPLS label stack" }, { id: "srv6-uncompressed", label: "SRv6, uncompressed" }, { id: "srv6-csid", label: "SR-MPLS and CSID-compressed SRv6 are comparable; plain uncompressed SRv6 is the outlier" }],
      correctOptionId: "srv6-csid",
      explanation: "Uncompressed SRv6 (16 bytes/SID) is by far the largest for a long program. SR-MPLS (4 bytes/label) and CSID-compressed SRv6 land in the same range here — the decision should be made from the calculated numbers, not an assumption about which architecture is \"lighter.\"",
    },
    action: (state, payload) => {
      const choice = payload as Architecture;
      return { state: { ...state, decisions: [...state.decisions.filter((d) => d.scenarioId !== "long-explicit-path"), { scenarioId: "long-explicit-path", choice, justification: "MTU-sensitive long segment lists favor whichever encoding minimizes computed instruction bytes for the actual segment count." }] }, events: [] };
    },
  },
  {
    id: "migration-coexistence",
    label: "Migration & Coexistence",
    narrative: "Networks do not switch from SR-MPLS to SRv6 in one instant. Coexistence is normal: different domains, different services, a phased migration, and interworking boundaries between them. This lesson does not implement a full interworking gateway — that's a separate, larger engineering problem.",
  },

  // ------------------------------------------------------------------
  // Troubleshooting incident
  // ------------------------------------------------------------------
  {
    id: "incident-intro",
    label: "Incident: SRv6 Stops, SR-MPLS Keeps Working",
    narrative: "Incident: the learner switches CUST-A's data plane from SR-MPLS to SRv6. CE1→CE2 traffic that worked perfectly under SR-MPLS now fails under SRv6 — even though the SR-MPLS side of this same lesson still works. Diagnose it.",
    run: (state) => ({ state: { ...state, troubleshooting: { ...state.troubleshooting, started: true } }, events: [] }),
  },
  {
    id: "incident-fault-injected",
    label: "Fault: PE2's SRv6 Locator Withdrawn",
    narrative: "PE2's BGP next hop stays reachable. The VPN route is still received. RT import still succeeds. But PE2's SRv6 LOCATOR route has gone missing from the IPv6 FIB — a real, independent failure mode, distinct from anything about RT or BGP session state.",
    run: (state) => {
      if (!state.srv6VpnRoute) return { state, events: [] };
      const progress = evaluateSrv6LocatorIncident(state.srv6VpnRoute, false);
      return { state: { ...state, activeArchitecture: "SRV6", srv6ImportProgress: progress, troubleshooting: { ...state.troubleshooting, locatorWithdrawn: true } }, events: [{ type: "SRV6_LOCATOR_WITHDRAWN", stepId: "incident-fault-injected", timestamp: Date.now(), message: "PE2's SRv6 locator route withdrawn" }, { type: "SRV6_SERVICE_SID_UNRESOLVABLE", stepId: "incident-fault-injected", timestamp: Date.now(), message: progress.serviceSidResolution?.reason ?? "" }] };
    },
    whatChanged: (_, next) => [`SR-MPLS VPN forwarding: unaffected (separate encoding, still healthy)`, `SRv6 Service SID resolution: ${next.srv6ImportProgress?.serviceSidResolution?.resolvable ? "resolvable" : "UNRESOLVABLE"}`],
  },
  {
    id: "incident-ladder",
    label: "Diagnostic Ladder",
    narrative: "CE route advertised ✓ | VPN route received ✓ | RT import ✓ | BGP next hop reachable ✓ | SR-MPLS: VPN label usable ✓, transport path ✓ | SRv6: Service SID advertised ✓, PE2 locator route ✕, Service SID resolvable ✕, VPN forwarding route usable ✕.",
    question: {
      prompt: "Given MP-BGP is Established, the VPN route is received, and RT import succeeds, where does this fault actually live?",
      options: [
        { id: "rt", label: "Route Target import policy" },
        { id: "bgp-session", label: "The MP-BGP session itself" },
        { id: "locator", label: "PE2's SRv6 locator reachability" },
      ],
      correctOptionId: "locator",
      explanation: "RT import already succeeded and the BGP session is healthy — those layers are proven fine. Service SID resolution is a SEPARATE dependency (locator-route reachability in the IPv6 FIB), and that's exactly what's missing.",
      hints: ["Hint 1: RT import already evaluated as a match — that layer is healthy.", "Hint 2: The BGP session and VPN route reception are both already confirmed healthy.", "Hint 3: Compare Service SID resolution specifically against BGP next-hop resolution."],
    },
  },
  {
    id: "wrong-repair-1",
    label: "Wrong Repair #1: Change RT",
    narrative: "A tempting first guess.",
    question: {
      prompt: "Would changing PE1's CUST-A import RT fix this incident?",
      options: [{ id: "yes", label: "Yes, RT drives every import decision" }, { id: "no", label: "No — RT import already succeeded" }],
      correctOptionId: "no",
      explanation: "RT import already matched. Changing it addresses a layer that was never broken.",
    },
  },
  {
    id: "wrong-repair-2",
    label: "Wrong Repair #2: Restart BGP",
    narrative: "Another tempting guess.",
    question: {
      prompt: "Would restarting the MP-BGP session fix this incident?",
      options: [{ id: "yes", label: "Yes, resetting often clears stuck state" }, { id: "no", label: "No — the VPN route and BGP next hop are already healthy" }],
      correctOptionId: "no",
      explanation: "The session is Established, the route is received, and the next hop resolves. Restarting a healthy session doesn't touch the actual fault (locator reachability).",
    },
  },
  {
    id: "wrong-repair-3",
    label: "Wrong Repair #3: Add an MPLS VPN Label",
    narrative: "A data-plane-confused guess.",
    question: {
      prompt: "Would adding an MPLS VPN label to the SRv6 service fix this incident?",
      options: [{ id: "yes", label: "Yes, add a label as a fallback" }, { id: "no", label: "No — this mixes data-plane encodings incorrectly" }],
      correctOptionId: "no",
      explanation: "SRv6 L3VPN doesn't use MPLS VPN labels at all — the Service SID is both the reachability and the service instruction. Mixing an MPLS label into an SRv6 service is the wrong data-plane repair, not a valid fallback.",
    },
  },
  {
    id: "incident-repair",
    label: "Correct Repair: Restore the Locator",
    narrative: "Restore PE2's SRv6 locator reachability, then recompute in order: locator route → Service SID resolution → forwarding eligibility → installed route. No shortcut straight to \"repaired.\"",
    action: (state) => {
      if (!state.srv6VpnRoute) return { state, events: [] };
      const progress = evaluateSrv6LocatorIncident(state.srv6VpnRoute, true);
      return { state: { ...state, activeArchitecture: "SRV6", srv6ImportProgress: progress, troubleshooting: { ...state.troubleshooting, repaired: progress.installed } }, events: [{ type: "SRV6_LOCATOR_RESTORED", stepId: "incident-repair", timestamp: Date.now(), message: "PE2 locator route restored" }, { type: "SRV6_SERVICE_SID_RESOLVED", stepId: "incident-repair", timestamp: Date.now(), message: progress.serviceSidResolution?.reason ?? "" }] };
    },
    requiresState: (state) => state.troubleshooting.repaired === true,
  },
  {
    id: "incident-resend",
    label: "Mandatory Resend",
    narrative: "Resend CE1 → CE2 and verify the FULL path: PE1 SRv6 service encapsulation → core → PE2 End.DT4 → CUST-A → CE2. Only after this real resend does the incident count as resolved.",
    run: (state) => {
      if (!state.srv6VpnRoute?.prefixSid) return { state, events: [] };
      const serviceSid = state.srv6VpnRoute.prefixSid.l3Service.serviceSid;
      const pkt = encapsulateSrv6VpnPacket(serviceSid, { kind: "IPV4", srcIp: CE1_HOST_IPV4, dstIp: CE2_HOST_IPV4 }, "2001:db8:100:1::c1");
      const outcome = processEgressServiceSid(serviceSid, pkt, PE2_LOCAL_ROUTES, []);
      const verified = !outcome.dropped;
      const encapsulated: HopPacket = { kind: "SRV6_L3VPN", packet: pkt };
      // Only the two endpoints this step actually computes are recorded. The core path between them is not re-simulated here (and P1-P2 is still down from the protection phase), so no transit hop and no PE2 ingress peer is claimed.
      const journey: JourneyHop[] = [
        { architecture: "SRV6", router: "PE1", input: "Customer IPv4", lookup: `CUST-A route installed: ${state.srv6ImportProgress?.installed ? "yes" : "no"} → Service SID`, action: "SET_DA", output: `Outer IPv6 DA = ${serviceSid.sidText}`, stepId: "incident-resend", ingressPeer: CE1_ID, egressPeer: nextOnPath(PRIMARY_PATH, "PE1"), before: { kind: "IPV4", srcIp: CE1_HOST_IPV4, dstIp: CE2_HOST_IPV4 }, after: encapsulated },
        { architecture: "SRV6", router: "PE2", input: `DA=${serviceSid.sidText}`, lookup: "Local SID Table: End.DT4 → CUST-A VRF", action: "END_DT4_DECAP", output: outcome.dropped ? `DROPPED: ${outcome.reason}` : `Delivered to ${outcome.ceTarget} (${CE2_HOST_IPV4})`, stepId: "incident-resend", egressPeer: outcome.dropped ? undefined : capstoneRouter(outcome.ceTarget), before: encapsulated, after: !outcome.dropped && outcome.exposedInner?.kind === "IPV4" ? { kind: "IPV4", srcIp: outcome.exposedInner.srcIp, dstIp: outcome.exposedInner.dstIp } : undefined },
      ];
      return { state: { ...state, activeArchitecture: "SRV6", srv6VpnPacket: pkt, journey: [...state.journey, ...journey], troubleshooting: { ...state.troubleshooting, verified } }, events: [{ type: "VPN_PACKET_DELIVERED", stepId: "incident-resend", timestamp: Date.now(), message: verified ? "Delivered to CE2 — incident resolved" : "Still failing" }] };
    },
    // The headend's own egress leg (PE1→P1) — a real link. PE1→PE2 has no direct link.
    packet: (state) => (state.srv6VpnPacket ? srv6L3vpnPacketVisual("incident-resend", "PE1", "P1", "Resend after repair", state.srv6VpnPacket) : undefined),
    requiresState: (state) => state.troubleshooting.verified === true,
  },
  {
    id: "predict-cross-arch-troubleshooting",
    label: "Cross-Architecture Troubleshooting",
    narrative: "One more reasoning check before the summary.",
    question: {
      prompt: "If the same physical link fails, should you troubleshoot the TI-LFA topology computation differently merely because one side uses MPLS labels and the other uses SRv6 SIDs?",
      options: [{ id: "yes", label: "Yes, each data plane needs its own topology troubleshooting method" }, { id: "no", label: "No — the repair-topology problem is shared; only the repair-encoding troubleshooting differs" }],
      correctOptionId: "no",
      explanation: "Exactly like Phase 4 demonstrated: P-Space/Q-Space/post-convergence-path is one shared computation. Troubleshooting the topology layer is identical work either way; only the encoding-specific repair verification differs.",
    },
  },

  // ------------------------------------------------------------------
  // Final summary + completion
  // ------------------------------------------------------------------
  {
    id: "final-summary",
    label: "Final Engineering Summary",
    narrative: `FINAL SUMMARY — L3VPN: SR-MPLS uses transport + VPN labels; SRv6 uses provider IPv6 + End.DT4 Service SID. Explicit TE: SR-MPLS uses an MPLS SID label stack; SRv6 uses an IPv6 SID list/SRH. Local repair: SR-MPLS uses OIF + label repair list; SRv6 uses OIF + IPv6 SID repair list. Long segment program: SR-MPLS ${ARCH_COMPARISON.instructionBytesMpls} bytes; SRv6 uncompressed ${ARCH_COMPARISON.instructionBytesSrv6Uncompressed} bytes; SRv6 CSID ${ARCH_COMPARISON.instructionBytesSrv6Csid} bytes. Neither architecture is a universal winner — the same Segment Routing model, two data planes, real engineering trade-offs.`,
  },
  {
    id: "predict-final-verdict",
    label: "Final Verdict Check",
    narrative: "Last prediction question.",
    question: {
      prompt: "Is either SR-MPLS or SRv6 universally the best choice for every network?",
      options: [{ id: "sr-mpls-always", label: "SR-MPLS, always" }, { id: "srv6-always", label: "SRv6, always" }, { id: "neither", label: "No — the right choice depends on the network's existing infrastructure, operational model, and requirements" }],
      correctOptionId: "neither",
      explanation: "You just made three different correct architecture choices for three different fictional requirements in the same lesson. That's the point: engineering trade-offs, not a universal verdict.",
    },
  },
  {
    id: "complete",
    label: "Segment Routing Architect",
    narrative: "Capstone complete. You solved the identical engineering brief twice — once in SR-MPLS, once in SRv6 — and can now explain exactly what changes between them and what doesn't.",
    run: (state) => ({ state: { ...state, completed: true }, events: [{ type: "SCENARIO_COMPLETED", stepId: "complete", timestamp: Date.now(), message: "SR-MPLS vs SRv6 capstone complete" }] }),
  },
];

export const STEP_IDX: Record<string, number> = Object.fromEntries(capstoneSteps.map((s, i) => [s.id, i]));

export type ComparisonPhase = "transport" | "te" | "vpn" | "protection" | "header" | "other";
/** Robust step-index-range lookup for which comparison table a UI should show — never substring-matches step ids (e.g. "predict-same-architecture" contains "te", which a naive `.includes("te")` would misclassify as the TE phase). */
export function comparisonPhaseForIndex(index: number): ComparisonPhase {
  if (index >= STEP_IDX["mpls-transport-intro"] && index < STEP_IDX["te-requirement"]) return "transport";
  if (index >= STEP_IDX["te-requirement"] && index < STEP_IDX["vpn-requirement"]) return "te";
  if (index >= STEP_IDX["vpn-requirement"] && index < STEP_IDX["failure-requirement"]) return "vpn";
  if (index >= STEP_IDX["failure-requirement"] && index < STEP_IDX["endpoint-programmability"]) return "protection";
  if (index >= STEP_IDX["header-efficiency-setup"] && index < STEP_IDX["requirement-matrix"]) return "header";
  return "other";
}

/**
 * Anti-spoiler: each phase's side-by-side table directly states the
 * answer to that phase's own prediction(s) — "4 bytes" (predict-mpls-
 * label-bytes), "2 labels vs. 3 SIDs" (predict-minimal-segments),
 * "identical VRF/RD/RT" + "P-router customer state: None" (predict-vrf-
 * rt-common, predict-p-router-vrf), "shared repair computation"
 * (predict-tilfa-shared), modeled total overhead (the MTU case the
 * narrative itself presents first). A phase's table is therefore only
 * revealed from the first step AFTER those predictions; the requirement
 * matrix (which restates every phase's result) only from its own step.
 */
const COMPARISON_REVEAL_STEP: Record<Exclude<ComparisonPhase, "other">, string> = {
  transport: "srv6-transport-intro",
  te: "mpls-te-build",
  vpn: "compare-vpn-encoding",
  protection: "link-fails",
  header: "header-efficiency-mtu-case",
};
export function comparisonRevealIndex(phase: ComparisonPhase): number {
  return phase === "other" ? STEP_IDX["requirement-matrix"] : STEP_IDX[COMPARISON_REVEAL_STEP[phase]];
}
export function comparisonRevealed(phase: ComparisonPhase, index: number): boolean {
  return index >= comparisonRevealIndex(phase);
}

export interface LocalSidEntry {
  sid: string;
  behavior: string;
  usedBy: string;
}
/**
 * The SRv6 Local SID entries THIS router actually owns in this capstone,
 * as far as the lesson has built them: its End SID always; an End.X
 * only where the TE program or the TI-LFA repair list binds one to it;
 * PE2's End.DT4 Service SID once allocated. Deduplicated by address —
 * the TE End.X and the repair End.X+USD at the same owner are built from
 * the same locator + END_X function, so they are shown as one address
 * used two ways rather than two invented entries.
 */
export function localSidEntries(state: CapstoneState, router: CoreRouterId): LocalSidEntry[] {
  const rows: LocalSidEntry[] = [{ sid: endSidText(router), behavior: BEHAVIOR_LABEL.END, usedBy: "Topological End SID (reachable via this router's locator)" }];
  const endX = new Map<string, string[]>();
  const teAdj = state.srv6Segments.find((s) => s.type === "ADJ" && s.owner === router);
  if (teAdj) endX.set(endXSidText(router), [...(endX.get(endXSidText(router)) ?? []), `SR Policy: plain End.X → ${teAdj.target}`]);
  for (const s of state.sharedRepair?.repairList.sids ?? []) if (s.owner === router) endX.set(s.sidText, [...(endX.get(s.sidText) ?? []), `TI-LFA repair: End.X+${s.flavors.join("+")} → ${s.adjacency}`]);
  for (const [sid, uses] of endX) rows.push({ sid, behavior: BEHAVIOR_LABEL.END_X, usedBy: uses.join(" · ") });
  const svc = state.srv6VpnRoute?.prefixSid?.l3Service.serviceSid;
  if (svc && svc.owner === router) rows.push({ sid: svc.sidText, behavior: BEHAVIOR_LABEL.END_DT4, usedBy: "CUST-A Service SID (decapsulate + VRF IPv4 lookup)" });
  return rows;
}

export interface CliCommandEntry {
  command: string;
  output: string;
}
/** Conceptual CLI, deliberately vendor-neutral. */
export function buildCapstoneCliCommands(state: CapstoneState, architecture: Architecture, router: RouterId): CliCommandEntry[] {
  if (architecture === "SR_MPLS") {
    return [
      { command: "show igp segment-routing", output: `Node-SID database (${CORE_ROUTERS.length} entries)` },
      { command: "show mpls forwarding", output: state.mplsRepairPacket ? "Repair label stack active" : "Primary path only" },
      { command: "show sr policy", output: state.mplsSegments.length > 0 ? `${state.mplsSegments.length}-label explicit policy up` : "No policy configured" },
      { command: "show vpn route CUST-A", output: state.mplsVpnRoute ? `${state.mplsVpnRoute.prefix} via RD ${state.mplsVpnRoute.rd}` : "No VPN routes" },
    ];
  }
  return [
    { command: "show ipv6 route", output: `Locator routes (${CORE_ROUTERS.length} entries)` },
    { command: "show srv6 locator", output: `Locator present at ${router}: ${!(router === "PE2" && state.troubleshooting.locatorWithdrawn && !state.troubleshooting.repaired)}` },
    { command: "show srv6 local-sid", output: router === "CE1" || router === "CE2" ? "Not an SRv6 node" : localSidEntries(state, router).map((e) => `${e.sid} ${e.behavior}`).join(" · ") },
    { command: "show sr policy", output: state.srv6Segments.length > 0 ? `${state.srv6Segments.length}-SID explicit policy up` : "No policy configured" },
    { command: "show vpn route CUST-A", output: state.srv6VpnRoute ? `${state.srv6VpnRoute.prefix} via Service SID ${state.srv6VpnRoute.prefixSid?.l3Service.serviceSid.sidText}` : "No VPN routes" },
  ];
}
