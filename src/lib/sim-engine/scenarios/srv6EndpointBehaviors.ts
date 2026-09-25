import type { PacketLayer, PacketVisual, ScenarioStep } from "@/lib/sim-engine/types";
import {
  buildIpv6Fib,
  buildLocators,
  endSidHextets,
  endSidText,
  executeEndBehavior,
  fmtIpv6,
  functionHexText,
  hextetsEqual,
  locatorHextetsFor,
  locatorTextFor,
  nextHopToward,
  ownerRouterForSid,
  buildSrv6Sid,
  type Hextets,
  type Ipv6FibRow,
  type LinkDef as FoundationsLinkDef,
  type RouterId,
  type SegmentRoutingHeader,
  type SrhSegment,
  type Srv6Locator,
} from "@/lib/sim-engine/scenarios/srv6Foundations";

/**
 * SRv6 Endpoint Behaviors — End, End.X, End.T, End.DX6, End.DX4,
 * End.DT6, End.DT4, and End.DX2 (RFC 8986 §§4.1-4.9, 4.16). Follows
 * SRv6 Foundations. Central question: a SID is not merely "an IPv6
 * waypoint" — the locally instantiated behavior bound to it determines
 * what happens next once the packet arrives.
 *
 * Fully implemented (real forwarding, real invariants):
 *   End (§4.1), End.X (§4.2), End.T (§4.3), End.DX6 (§4.4),
 *   End.DX4 (§4.5), End.DT6 (§4.6), End.DT4 (§4.7), End.DX2 (§4.9).
 *
 * Preview only (named, compared conceptually, NOT executed as real
 * forwarding here — later lessons):
 *   End.DT46 (§4.8), End.DX2V, End.DT2U, End.DT2M, End.B6.Encaps,
 *   End.B6.Encaps.Red, End.BM, and the PSP/USP/USD endpoint flavors
 *   (§4.16).
 *
 * Explicitly out of scope (later modules in the track): the full SRv6
 * L3VPN control plane, BGP VPN route distribution, EVPN over SRv6,
 * SRv6 Policy/BGP SR Policy, TI-LFA, uSID, and compressed SRv6.
 *
 * Reuse from srv6Foundations.ts (see ARCHITECTURE.md — never
 * reimplement IPv6 formatting, locator/SID derivation, or the base
 * End mutation): fmtIpv6, hextetsEqual, buildSrv6Sid, functionHexText,
 * locatorHextetsFor, locatorTextFor, buildLocators, endSidHextets/Text,
 * executeEndBehavior (the End SL-decrement + DA-rewrite mutation is
 * IDENTICAL for End, End.X, and End.T — only the FORWARDING treatment
 * after that mutation differs), ownerRouterForSid, nextHopToward,
 * buildIpv6Fib, RouterId/Hextets/SegmentRoutingHeader/SrhSegment types,
 * IgpPathResult, ALL_ROUTERS.
 *
 * Topology — extends Foundations' hexagon with one new cross-link
 * (R3-R4) so R3 has a real, distinct physical adjacency to force
 * traffic through via End.X, plus four customer attachment points off
 * R6 (CE6, CE4-A, CE4-B, CE-L2) for the service endpoint behaviors:
 *
 *              R2 ───── R3 ─────────────── R6 ── CE6
 *             /           \  (R3-R4, 20)  / │ \── CE4-A
 *            /             \             /  │  \── CE4-B
 *          R1               \           /   └──── CE-L2
 *            \               \         /
 *             \               \       /
 *              R4 ──────────── R5 ───
 *
 *   R1-R2=10, R2-R3=10, R3-R6=10   (top:    R1→R2→R3→R6 = 30)
 *   R1-R4=5,  R4-R5=5,  R5-R6=5    (bottom: R1→R4→R5→R6 = 15, IGP shortest)
 *   R3-R4=20                       (cross-link — NOT on anyone's shortest
 *                                    path; it exists purely so R3's
 *                                    End.X adjacency has somewhere
 *                                    topologically distinct to force
 *                                    traffic through)
 *
 * With this metric, R1's shortest path to R3's locator is still via R2
 * (cost 20 vs. 25 via R4), and R3's ORDINARY shortest path to R6 is
 * still the direct link (cost 10 vs. 20 via R4-R5) — both unchanged
 * from Foundations' story. Only R3's End.X (adjacency-bound, not
 * metric-bound) and R3's End.T-via-CORE-B (which excludes the direct
 * R3-R6 link entirely) force the longer R3→R4→R5→R6 path.
 *
 * Pure data + pure functions only — see /lib/sim-engine/types.ts.
 */

export type { RouterId };

// ---------------------------------------------------------------------------
// Topology
// ---------------------------------------------------------------------------

export type LinkId = "R1-R2" | "R2-R3" | "R3-R6" | "R1-R4" | "R4-R5" | "R5-R6" | "R3-R4";
export interface LinkDef {
  id: LinkId;
  a: RouterId;
  b: RouterId;
  metric: number;
}
export const LINKS: LinkDef[] = [
  { id: "R1-R2", a: "R1", b: "R2", metric: 10 },
  { id: "R2-R3", a: "R2", b: "R3", metric: 10 },
  { id: "R3-R6", a: "R3", b: "R6", metric: 10 },
  { id: "R1-R4", a: "R1", b: "R4", metric: 5 },
  { id: "R4-R5", a: "R4", b: "R5", metric: 5 },
  { id: "R5-R6", a: "R5", b: "R6", metric: 5 },
  { id: "R3-R4", a: "R3", b: "R4", metric: 20 },
];

export type CeId = "CE6" | "CE4-A" | "CE4-B" | "CE-L2";
export const CE_IDS: CeId[] = ["CE6", "CE4-A", "CE4-B", "CE-L2"];
export type NodeId = RouterId | CeId;

export const GRAPH_NODES = [
  { id: "R1", label: "R1", x: 5, y: 50, subLabel: "Headend" },
  { id: "R2", label: "R2", x: 32, y: 15 },
  { id: "R3", label: "R3", x: 62, y: 15, subLabel: "End / End.X / End.T" },
  { id: "R4", label: "R4", x: 32, y: 85 },
  { id: "R5", label: "R5", x: 62, y: 85 },
  { id: "R6", label: "R6", x: 86, y: 50, subLabel: "Service Endpoint" },
  { id: "CE6", label: "CE6", x: 100, y: 14, subLabel: "IPv6 Customer" },
  { id: "CE4-A", label: "CE4-A", x: 100, y: 38, subLabel: "IPv4 Customer A" },
  { id: "CE4-B", label: "CE4-B", x: 100, y: 62, subLabel: "IPv4 Customer B" },
  { id: "CE-L2", label: "CE-L2", x: 100, y: 86, subLabel: "L2 Customer" },
];
export const GRAPH_EDGES: { id: string; a: NodeId; b: NodeId }[] = [
  ...LINKS.map((l) => ({ id: l.id as string, a: l.a as NodeId, b: l.b as NodeId })),
  { id: "R6-CE6", a: "R6", b: "CE6" },
  { id: "R6-CE4A", a: "R6", b: "CE4-A" },
  { id: "R6-CE4B", a: "R6", b: "CE4-B" },
  { id: "R6-CEL2", a: "R6", b: "CE-L2" },
];

export function linkIdBetween(a: RouterId, b: RouterId): LinkId | undefined {
  return LINKS.find((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a))?.id;
}

// ---------------------------------------------------------------------------
// Locators / SID allocation — LOC:FUNCT:ARG, reusing Foundations' exact
// domain prefix, lengths, and per-router locator derivation.
// ---------------------------------------------------------------------------

export const FUNCTION = {
  END: 1,
  END_X: 2,
  END_T: 3,
  END_DX6: 0x10,
  END_DX4: 0x11,
  END_DT6: 0x12,
  END_DT4: 0x13,
  // 0x14 reserved for End.DT46 — preview only, never instantiated here.
  END_DX2: 0x15,
} as const;

function sidFor(router: RouterId, functionValue: number, arg = 0): Hextets {
  return buildSrv6Sid(locatorHextetsFor(router).slice(0, 4), functionValue, arg);
}
function sidTextFor(router: RouterId, functionValue: number): string {
  return fmtIpv6(sidFor(router, functionValue));
}

export { endSidHextets, endSidText, locatorTextFor, fmtIpv6, functionHexText };

// ---------------------------------------------------------------------------
// IPv6 FIB — MAIN (Foundations' buildIpv6Fib, unmodified) vs. CORE-B
// (the same computation with the direct R3-R6 link excluded from the
// graph) — a real, computed second table, never hardcoded per-router.
// ---------------------------------------------------------------------------

export type FibTableName = "MAIN" | "CORE-B";
export const CORE_B_EXCLUDED_LINK: LinkId = "R3-R6";

function linksForTable(links: LinkDef[], table: FibTableName): LinkDef[] {
  return table === "MAIN" ? links : links.filter((l) => l.id !== CORE_B_EXCLUDED_LINK);
}

/**
 * Foundations' nextHopToward/buildIpv6Fib/computeIgpShortestPath only
 * ever read `a`/`b`/`metric` off each link (never `id`) — this cast
 * lets this file's own extended LinkId (which adds "R3-R4", unknown to
 * Foundations' narrower LinkId union) reuse those pure algorithms
 * without TypeScript rejecting the wider `id` union.
 */
function asFoundationsLinks(links: LinkDef[]): FoundationsLinkDef[] {
  return links as unknown as FoundationsLinkDef[];
}

export function buildNamedIpv6Fib(observer: RouterId, links: LinkDef[], locators: Srv6Locator[], table: FibTableName): Ipv6FibRow[] {
  if (table === "MAIN") return buildIpv6Fib(observer, asFoundationsLinks(links), locators);
  const filtered = linksForTable(links, table);
  return locators.filter((l) => l.router !== observer).map((l) => ({ locatorPrefix: l.text, ownerRouter: l.router, nextHop: nextHopToward(asFoundationsLinks(filtered), observer, l.router) }));
}

// ---------------------------------------------------------------------------
// Behavior / parameter model — a discriminated union, not one arbitrary
// optional string. LocalSidTableViewer/Srv6SidStructureViewer only ever
// see the derived display strings (behavior/parameterText) — the union
// itself is consumed purely by processSrv6EndpointBehavior().
// ---------------------------------------------------------------------------

export type Srv6EndpointBehavior = "END" | "END_X" | "END_T" | "END_DX6" | "END_DX4" | "END_DT6" | "END_DT4" | "END_DX2";

export const BEHAVIOR_FAMILY: Record<Srv6EndpointBehavior, "TOPOLOGICAL" | "SERVICE"> = {
  END: "TOPOLOGICAL",
  END_X: "TOPOLOGICAL",
  END_T: "TOPOLOGICAL",
  END_DX6: "SERVICE",
  END_DX4: "SERVICE",
  END_DT6: "SERVICE",
  END_DT4: "SERVICE",
  END_DX2: "SERVICE",
};
export const BEHAVIOR_LABEL: Record<Srv6EndpointBehavior, string> = {
  END: "End",
  END_X: "End.X",
  END_T: "End.T",
  END_DX6: "End.DX6",
  END_DX4: "End.DX4",
  END_DT6: "End.DT6",
  END_DT4: "End.DT4",
  END_DX2: "End.DX2",
};

export interface EndParameter {
  kind: "END";
}
export interface EndXParameter {
  kind: "END_X";
  adjacency: RouterId;
}
export interface EndTParameter {
  kind: "END_T";
  table: FibTableName;
}
export interface EndDx6Parameter {
  kind: "END_DX6";
  adjacency: CeId;
}
export interface EndDx4Parameter {
  kind: "END_DX4";
  adjacency: CeId;
}
export type VrfName = "VRF-CUST6" | "VRF-CUST4";
export interface EndDt6Parameter {
  kind: "END_DT6";
  table: VrfName;
}
export interface EndDt4Parameter {
  kind: "END_DT4";
  table: VrfName;
}
export interface EndDx2Parameter {
  kind: "END_DX2";
  outgoingInterface: string;
}
export type BehaviorParameter = EndParameter | EndXParameter | EndTParameter | EndDx6Parameter | EndDx4Parameter | EndDt6Parameter | EndDt4Parameter | EndDx2Parameter;

function parameterText(p: BehaviorParameter): string {
  switch (p.kind) {
    case "END":
      return "none";
    case "END_X":
      return `adjacency: ${p.adjacency}`;
    case "END_T":
      return `IPv6 table: ${p.table}`;
    case "END_DX6":
    case "END_DX4":
      return `adjacency: ${p.adjacency}`;
    case "END_DT6":
    case "END_DT4":
      return `FIB table: ${p.table}`;
    case "END_DX2":
      return `OIF: ${p.outgoingInterface}`;
  }
}

// ---------------------------------------------------------------------------
// Local SID Table — now one router can own MULTIPLE local SIDs, each
// bound to a distinct behavior and a distinct typed parameter.
// ---------------------------------------------------------------------------

export interface EndpointLocalSidEntry {
  sidHextets: Hextets;
  sidText: string;
  locatorText: string;
  functionValue: number;
  functionText: string;
  behavior: Srv6EndpointBehavior;
  owner: RouterId;
  parameter: BehaviorParameter;
  parameterText: string;
}

function makeEntry(router: RouterId, functionValue: number, behavior: Srv6EndpointBehavior, parameter: BehaviorParameter): EndpointLocalSidEntry {
  const hextets = sidFor(router, functionValue);
  return { sidHextets: hextets, sidText: fmtIpv6(hextets), locatorText: locatorTextFor(router), functionValue, functionText: functionHexText(functionValue), behavior, owner: router, parameter, parameterText: parameterText(parameter) };
}

function installR3Sids(): EndpointLocalSidEntry[] {
  return [
    makeEntry("R3", FUNCTION.END, "END", { kind: "END" }),
    makeEntry("R3", FUNCTION.END_X, "END_X", { kind: "END_X", adjacency: "R4" }),
    makeEntry("R3", FUNCTION.END_T, "END_T", { kind: "END_T", table: "CORE-B" }),
  ];
}
function installR6Sids(): EndpointLocalSidEntry[] {
  return [
    makeEntry("R6", FUNCTION.END, "END", { kind: "END" }),
    makeEntry("R6", FUNCTION.END_DX6, "END_DX6", { kind: "END_DX6", adjacency: "CE6" }),
    makeEntry("R6", FUNCTION.END_DX4, "END_DX4", { kind: "END_DX4", adjacency: "CE4-A" }),
    makeEntry("R6", FUNCTION.END_DT6, "END_DT6", { kind: "END_DT6", table: "VRF-CUST6" }),
    makeEntry("R6", FUNCTION.END_DT4, "END_DT4", { kind: "END_DT4", table: "VRF-CUST4" }),
    makeEntry("R6", FUNCTION.END_DX2, "END_DX2", { kind: "END_DX2", outgoingInterface: "ge-0/0/7 (to CE-L2)" }),
  ];
}

export type LocalSidTable = Partial<Record<RouterId, EndpointLocalSidEntry[]>>;

export function lookupLocalSid(router: RouterId, daHextets: Hextets, table: LocalSidTable): EndpointLocalSidEntry | undefined {
  return (table[router] ?? []).find((e) => hextetsEqual(e.sidHextets, daHextets));
}

/** The R6→CE4-B fault: R6's End.DT4 SID gets misconfigured as End.DX4/CE4-A — same SID value, wrong behavior binding. */
export function withDt4MisconfiguredAsDx4(entries: EndpointLocalSidEntry[]): EndpointLocalSidEntry[] {
  return entries.map((e) => {
    if (e.functionValue !== FUNCTION.END_DT4) return e;
    const parameter: EndDx4Parameter = { kind: "END_DX4", adjacency: "CE4-A" };
    return { ...e, behavior: "END_DX4", parameter, parameterText: `${parameterText(parameter)} (MISCONFIGURED — should be End.DT4 / VRF-CUST4)` };
  });
}
export function withDt4Restored(entries: EndpointLocalSidEntry[]): EndpointLocalSidEntry[] {
  return entries.map((e) => {
    if (e.functionValue !== FUNCTION.END_DT4) return e;
    const parameter: EndDt4Parameter = { kind: "END_DT4", table: "VRF-CUST4" };
    return { ...e, behavior: "END_DT4", parameter, parameterText: parameterText(parameter) };
  });
}

// ---------------------------------------------------------------------------
// VRFs — service tables consulted only AFTER decapsulation (End.DT6 /
// End.DT4), never by the cross-connect behaviors (End.DX6 / End.DX4).
// ---------------------------------------------------------------------------

export interface Ipv6VrfRoute {
  prefixHextets: Hextets;
  prefixLength: number;
  ceId: CeId;
}
export interface Ipv4VrfRoute {
  prefix: string; // "10.10.1.0/24"
  ceId: CeId;
}
export interface Vrf {
  name: VrfName;
  family: "IPV6" | "IPV4";
  ipv6Routes?: Ipv6VrfRoute[];
  ipv4Routes?: Ipv4VrfRoute[];
}

export const CUST6_PREFIX_HEXTETS: Hextets = [0x2001, 0x0db8, 0xcafe, 0x0006, 0, 0, 0, 0];
export const CUST6_HOST_HEXTETS: Hextets = [0x2001, 0x0db8, 0xcafe, 0x0006, 0, 0, 0, 0xb];

export const VRFS: Record<VrfName, Vrf> = {
  "VRF-CUST6": { name: "VRF-CUST6", family: "IPV6", ipv6Routes: [{ prefixHextets: CUST6_PREFIX_HEXTETS, prefixLength: 64, ceId: "CE6" }] },
  "VRF-CUST4": {
    name: "VRF-CUST4",
    family: "IPV4",
    ipv4Routes: [
      { prefix: "10.10.1.0/24", ceId: "CE4-A" },
      { prefix: "10.10.2.0/24", ceId: "CE4-B" },
    ],
  },
};

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, oct) => (acc << 8) + Number(oct), 0) >>> 0;
}
export function ipv4InPrefix(ip: string, prefix: string): boolean {
  const [base, lenStr] = prefix.split("/");
  const len = Number(lenStr);
  const mask = len === 0 ? 0 : (0xffffffff << (32 - len)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}
export function lookupIpv4Vrf(vrf: Vrf, dstIp: string): CeId | undefined {
  return vrf.ipv4Routes?.find((r) => ipv4InPrefix(dstIp, r.prefix))?.ceId;
}
export function ipv6InVrfRoute(dstHextets: Hextets, route: Ipv6VrfRoute): boolean {
  const n = route.prefixLength / 16;
  return route.prefixHextets.slice(0, n).every((v, i) => v === dstHextets[i]);
}
export function lookupIpv6Vrf(vrf: Vrf, dstHextets: Hextets): CeId | undefined {
  return vrf.ipv6Routes?.find((r) => ipv6InVrfRoute(dstHextets, r))?.ceId;
}

// ---------------------------------------------------------------------------
// Packet model — outer SRv6 IPv6 (+ optional SRH) wrapping an optional
// inner payload (IPv6 / IPv4 / Ethernet). No fake MPLS labels anywhere.
// ---------------------------------------------------------------------------

export type InnerPayload = { kind: "IPV6"; srcHextets: Hextets; dstHextets: Hextets } | { kind: "IPV4"; srcIp: string; dstIp: string } | { kind: "ETHERNET"; srcMac: string; dstMac: string };

export interface OuterIpv6State {
  srcText: string;
  daHextets: Hextets;
  hopLimit: number;
  srh?: SegmentRoutingHeader;
}
export interface EndpointPacketState {
  outer: OuterIpv6State;
  inner?: InnerPayload;
}

export const HOST_BEHIND_R1 = "2001:db8:100:1:0:0:0:a";

export interface HighLevelSeg {
  sidHextets: Hextets;
  sidText: string;
  ownerLabel: string;
}
export function seg(sidHextets: Hextets, ownerLabel: string): HighLevelSeg {
  return { sidHextets, sidText: fmtIpv6(sidHextets), ownerLabel };
}

/** Generalized full-SRH builder (RFC 8754) — same reversed-storage-order encoding as Foundations' buildFullSrh, generalized to arbitrary (not just End-only) SIDs. */
export function buildEndpointSrh(segments: HighLevelSeg[]): SegmentRoutingHeader {
  const n = segments.length;
  const storageOrder = [...segments].reverse();
  const segmentList: SrhSegment[] = storageOrder.map((s, i) => ({ index: i, sidHextets: s.sidHextets, sidText: s.sidText, ownerRouter: s.ownerLabel as RouterId }));
  return { nextHeader: "Payload", hdrExtLen: n * 2, routingType: 4, segmentsLeft: n - 1, lastEntry: n - 1, flags: "0x00", tag: 0, segmentList };
}
export function buildEndpointPacket(segments: HighLevelSeg[], inner?: InnerPayload, srcText: string = HOST_BEHIND_R1): EndpointPacketState {
  if (segments.length === 1) return { outer: { srcText, daHextets: segments[0].sidHextets, hopLimit: 64 }, inner };
  return { outer: { srcText, daHextets: segments[0].sidHextets, hopLimit: 64, srh: buildEndpointSrh(segments) }, inner };
}

// ---------------------------------------------------------------------------
// Processing results — dispatched, semantic outcomes. No UI-invented
// interpretation lives outside this union.
// ---------------------------------------------------------------------------

export type Srv6EndpointAction =
  | "HEADEND_ENCAPS"
  | "IPV6_FIB_FORWARD"
  | "LOCAL_SID_MATCH"
  | "ADJACENCY_CROSS_CONNECT"
  | "TABLE_LOOKUP"
  | "DECAP_IPV6"
  | "DECAP_IPV4"
  | "DECAP_ETHERNET"
  | "L2_CROSS_CONNECT"
  | "FINAL_END"
  | "DELIVER"
  | "DROP_MISSING_LOCAL_SID"
  | "INVALID_FINAL_SEGMENT"
  | "PAYLOAD_TYPE_MISMATCH";

export interface BehaviorExecutionOutcome {
  action: Srv6EndpointAction;
  final: boolean;
  newDaHextets?: Hextets;
  newSrh?: SegmentRoutingHeader;
  adjacency?: RouterId | CeId;
  table?: FibTableName | VrfName;
  exposedInner?: InnerPayload;
  ceTarget?: CeId;
  oif?: string;
  dropped?: boolean;
  dropReason?: string;
}

/** RFC 8986 §4.16-adjacent invariant: a final-segment behavior's SRH (if any) must show Segments Left = 0. */
export function validateFinalBehaviorPosition(srh?: SegmentRoutingHeader): boolean {
  return !srh || srh.segmentsLeft === 0;
}

const EXPECTED_PAYLOAD: Record<"END_DX6" | "END_DX4" | "END_DT6" | "END_DT4" | "END_DX2", InnerPayload["kind"]> = {
  END_DX6: "IPV6",
  END_DX4: "IPV4",
  END_DT6: "IPV6",
  END_DT4: "IPV4",
  END_DX2: "ETHERNET",
};

export function decapsulateOuterIpv6(pkt: EndpointPacketState): InnerPayload | undefined {
  return pkt.inner;
}
export function resolveAdjacency(param: EndXParameter | EndDx6Parameter | EndDx4Parameter): RouterId | CeId {
  return param.adjacency;
}
export function resolveOutgoingInterface(param: EndDx2Parameter): string {
  return param.outgoingInterface;
}
export function lookupIpv4Table(vrf: Vrf, dstIp: string): CeId | undefined {
  return lookupIpv4Vrf(vrf, dstIp);
}
export function lookupIpv6Table(vrf: Vrf, dstHextets: Hextets): CeId | undefined {
  return lookupIpv6Vrf(vrf, dstHextets);
}

function executeEndX(daHextets: Hextets, srh: SegmentRoutingHeader | undefined, p: EndXParameter): BehaviorExecutionOutcome {
  const r = executeEndBehavior(daHextets, srh);
  return { action: "ADJACENCY_CROSS_CONNECT", final: r.final, newDaHextets: r.newDaHextets, newSrh: r.newSrh, adjacency: resolveAdjacency(p) };
}
function executeEndT(daHextets: Hextets, srh: SegmentRoutingHeader | undefined, p: EndTParameter): BehaviorExecutionOutcome {
  const r = executeEndBehavior(daHextets, srh);
  return { action: "TABLE_LOOKUP", final: r.final, newDaHextets: r.newDaHextets, newSrh: r.newSrh, table: p.table };
}

function executeServiceBehavior(behavior: "END_DX6" | "END_DX4" | "END_DT6" | "END_DT4" | "END_DX2", param: BehaviorParameter, srh: SegmentRoutingHeader | undefined, inner: InnerPayload | undefined, vrfs: Record<VrfName, Vrf>): BehaviorExecutionOutcome {
  if (!validateFinalBehaviorPosition(srh)) {
    return { action: "INVALID_FINAL_SEGMENT", final: true, dropped: true, dropReason: `${BEHAVIOR_LABEL[behavior]} must be the FINAL segment — Segments Left is ${srh?.segmentsLeft} (must be 0).` };
  }
  const expected = EXPECTED_PAYLOAD[behavior];
  if (!inner || inner.kind !== expected) {
    return { action: "PAYLOAD_TYPE_MISMATCH", final: true, dropped: true, dropReason: `${BEHAVIOR_LABEL[behavior]} expects an exposed ${expected} payload — found ${inner?.kind ?? "none"}.` };
  }
  const decapAction = expected === "IPV6" ? "DECAP_IPV6" : expected === "IPV4" ? "DECAP_IPV4" : "DECAP_ETHERNET";

  if (behavior === "END_DX6" || behavior === "END_DX4") {
    const p = param as EndDx6Parameter | EndDx4Parameter;
    return { action: decapAction, final: true, exposedInner: inner, adjacency: resolveAdjacency(p), ceTarget: p.adjacency };
  }
  if (behavior === "END_DT6") {
    const p = param as EndDt6Parameter;
    const vrf = vrfs[p.table];
    const ce = lookupIpv6Table(vrf, (inner as { kind: "IPV6"; dstHextets: Hextets }).dstHextets);
    return { action: decapAction, final: true, exposedInner: inner, table: p.table, ceTarget: ce, dropped: !ce, dropReason: ce ? undefined : `No route in ${p.table} matched this destination.` };
  }
  if (behavior === "END_DT4") {
    const p = param as EndDt4Parameter;
    const vrf = vrfs[p.table];
    const ce = lookupIpv4Table(vrf, (inner as { kind: "IPV4"; dstIp: string }).dstIp);
    return { action: decapAction, final: true, exposedInner: inner, table: p.table, ceTarget: ce, dropped: !ce, dropReason: ce ? undefined : `No route in ${p.table} matched this destination.` };
  }
  // END_DX2
  const p = param as EndDx2Parameter;
  return { action: "L2_CROSS_CONNECT", final: true, exposedInner: inner, oif: resolveOutgoingInterface(p) };
}

/** The single dispatch point — every local SID match is processed here, never re-derived per step or per component. */
export function processSrv6EndpointBehavior(entry: EndpointLocalSidEntry, daHextets: Hextets, srh: SegmentRoutingHeader | undefined, inner: InnerPayload | undefined, vrfs: Record<VrfName, Vrf>): BehaviorExecutionOutcome {
  switch (entry.behavior) {
    case "END": {
      const r = executeEndBehavior(daHextets, srh);
      return { action: "IPV6_FIB_FORWARD", final: r.final, newDaHextets: r.newDaHextets, newSrh: r.newSrh };
    }
    case "END_X":
      return executeEndX(daHextets, srh, entry.parameter as EndXParameter);
    case "END_T":
      return executeEndT(daHextets, srh, entry.parameter as EndTParameter);
    default:
      return executeServiceBehavior(entry.behavior, entry.parameter, srh, inner, vrfs);
  }
}

// ---------------------------------------------------------------------------
// Packet layers / visuals
// ---------------------------------------------------------------------------

function outerIpv6Layer(pkt: EndpointPacketState): PacketLayer {
  return {
    name: "Outer IPv6 Header",
    color: "var(--pv-proto-ipv6)",
    fields: [
      { label: "Source Address", value: pkt.outer.srcText },
      { label: "Destination Address (active segment)", value: fmtIpv6(pkt.outer.daHextets) },
      { label: "Hop Limit", value: String(pkt.outer.hopLimit) },
    ],
  };
}
function srhPacketLayer(srh: SegmentRoutingHeader): PacketLayer {
  return {
    name: `Segment Routing Header (SL=${srh.segmentsLeft}, LE=${srh.lastEntry})`,
    color: "var(--pv-proto-srh)",
    fields: [
      { label: "Segments Left", value: String(srh.segmentsLeft) },
      { label: "Last Entry", value: String(srh.lastEntry) },
      ...srh.segmentList.map((s) => ({ label: `Segment List[${s.index}]`, value: s.sidText })),
    ],
  };
}
function innerLayer(inner: InnerPayload): PacketLayer {
  if (inner.kind === "IPV6") return { name: "Inner IPv6 Packet", color: "var(--pv-proto-ipv6)", fields: [{ label: "Source Address", value: fmtIpv6(inner.srcHextets) }, { label: "Destination Address", value: fmtIpv6(inner.dstHextets) }] };
  if (inner.kind === "IPV4") return { name: "Inner IPv4 Packet", color: "var(--pv-proto-ip)", fields: [{ label: "Source IP", value: inner.srcIp }, { label: "Destination IP", value: inner.dstIp }] };
  return { name: "Inner Ethernet Frame", color: "var(--pv-border-strong)", fields: [{ label: "Source MAC", value: inner.srcMac }, { label: "Destination MAC", value: inner.dstMac }] };
}
function payloadLayer(): PacketLayer {
  return { name: "Payload", color: "var(--pv-border-strong)", fields: [{ label: "Conceptual payload", value: "Application data" }] };
}
export function buildEndpointPacketLayers(pkt: EndpointPacketState): PacketLayer[] {
  return [outerIpv6Layer(pkt), ...(pkt.outer.srh ? [srhPacketLayer(pkt.outer.srh)] : []), pkt.inner ? innerLayer(pkt.inner) : payloadLayer()];
}
function endpointPacket(id: string, from: NodeId, to: NodeId, summary: string, badge: string, pkt: EndpointPacketState): PacketVisual {
  return { id, protocol: "IPV6", from, to, summary, badge, layers: buildEndpointPacketLayers(pkt) };
}

// ---------------------------------------------------------------------------
// IGP helpers (reuse Foundations' pure algorithms against this file's own
// LinkDef[] — same RouterId, same computeIgpShortestPath/nextHopToward
// signatures, so nothing is reimplemented).
// ---------------------------------------------------------------------------

export function ordinaryNextHop(observer: RouterId, target: RouterId, links: LinkDef[]): RouterId | undefined {
  return nextHopToward(asFoundationsLinks(links), observer, target);
}
export function ownerFor(daHextets: Hextets, locators: Srv6Locator[]): RouterId | undefined {
  return ownerRouterForSid(daHextets, locators);
}

// ---------------------------------------------------------------------------
// Top-level scenario state
// ---------------------------------------------------------------------------

export type Srv6EndpointFwdAction = Srv6EndpointAction;
export interface JourneyHop {
  router: NodeId;
  input: string;
  lookup: string;
  action: Srv6EndpointFwdAction;
  output: string;
}

export interface TroubleshootingState {
  started: boolean;
  repairAttempt?: { choice: string; correct: boolean };
  correctVerified: boolean;
}

export type ChallengeKey = "a" | "b" | "c" | "d";
export interface ChallengeState {
  answers: Partial<Record<ChallengeKey, { choice: string; correct: boolean }>>;
}

export interface Srv6EndpointState {
  links: LinkDef[];
  locators: Srv6Locator[];
  localSidTable: LocalSidTable;
  vrfs: Record<VrfName, Vrf>;
  packet?: EndpointPacketState;
  packetAt?: NodeId;
  journey: JourneyHop[];
  highLevelOrder?: HighLevelSeg[];
  fault?: { reason: string };
  troubleshooting: TroubleshootingState;
  challenge: ChallengeState;
}

export function createSrv6EndpointState(): Srv6EndpointState {
  return {
    links: LINKS,
    locators: buildLocators(),
    localSidTable: { R3: installR3Sids(), R6: installR6Sids() },
    vrfs: VRFS,
    journey: [],
    troubleshooting: { started: false, correctVerified: false },
    challenge: { answers: {} },
  };
}

// ---------------------------------------------------------------------------
// Segment helpers for step authoring
// ---------------------------------------------------------------------------

function r3Seg(fn: number): HighLevelSeg {
  return seg(sidFor("R3", fn), "R3");
}
function r6Seg(fn: number): HighLevelSeg {
  return seg(sidFor("R6", fn), "R6");
}
const R3_END = r3Seg(FUNCTION.END);
const R3_END_X = r3Seg(FUNCTION.END_X);
const R3_END_T = r3Seg(FUNCTION.END_T);
const R6_END = r6Seg(FUNCTION.END);
const R6_DX6 = r6Seg(FUNCTION.END_DX6);
const R6_DX4 = r6Seg(FUNCTION.END_DX4);
const R6_DT6 = r6Seg(FUNCTION.END_DT6);
const R6_DT4 = r6Seg(FUNCTION.END_DT4);
const R6_DX2 = r6Seg(FUNCTION.END_DX2);

const CUST6_INNER: InnerPayload = { kind: "IPV6", srcHextets: [0x2001, 0x0db8, 0x0100, 0x0001, 0, 0, 0, 0xa], dstHextets: CUST6_HOST_HEXTETS };
function ipv4Inner(dstIp: string): InnerPayload {
  return { kind: "IPV4", srcIp: "192.168.99.10", dstIp };
}
const ETHERNET_INNER: InnerPayload = { kind: "ETHERNET", srcMac: "CE-A-MAC", dstMac: "CE-B-MAC" };

function findEntry(state: Srv6EndpointState, router: RouterId, fn: number): EndpointLocalSidEntry {
  const e = (state.localSidTable[router] ?? []).find((x) => x.functionValue === fn);
  if (!e) throw new Error(`Missing local SID: ${router} function ${fn}`);
  return e;
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

export const srv6EndpointSteps: ScenarioStep<Srv6EndpointState>[] = [
  // === 1. Central question / recap ===========================================
  {
    id: "intro",
    label: "The Central Question",
    narrative: `SRv6 Foundations built a Local SID Table entry: SID ${endSidText("R3")}, behavior = End. This lesson asks the question that follows immediately: why does SRv6 have MANY different endpoint behaviors, if they're all just represented by IPv6 SIDs?`,
  },
  {
    id: "central-answer",
    label: "Because Reaching The Node Is Only Half",
    narrative: "Reaching the node that owns a SID is only half of the operation. The locally-bound BEHAVIOR determines what happens next — that's the whole subject of this lesson.",
  },
  {
    id: "behavior-mental-model",
    label: "The Behavior Mental Model",
    narrative: "IPv6 DA matches a local SID → Local SID Table lookup → WHICH BEHAVIOR is bound? (End? End.X? End.T? End.DX4? End.DT4? End.DX2? ...) → behavior-specific packet processing. Behavior names are never cosmetic metadata — each one produces a genuinely different forwarding decision.",
  },
  {
    id: "predict-why-many-behaviors",
    label: "Predict",
    narrative: "Before the taxonomy:",
    question: {
      prompt: "If every SID is already routed to its owner by ordinary IPv6 forwarding, why does SRv6 need more than one endpoint behavior?",
      options: [
        { id: "different-actions", label: "Because the same \"packet arrived here\" event can require genuinely different local actions — forward normally, force one adjacency, decapsulate into a VRF, cross-connect to an interface..." },
        { id: "cosmetic", label: "It doesn't really need more than one — the different names are cosmetic labels for the same underlying forwarding" },
      ],
      correctOptionId: "different-actions",
      explanation: "Arrival and action are two different questions. The Local SID Table's job is to answer \"what do I DO now\" — and that answer genuinely varies: continue the program, force an adjacency, select a table, or decapsulate and hand off to a service.",
    },
  },

  // === 2. Behavior taxonomy ===================================================
  {
    id: "taxonomy-intro",
    label: "Behavior Families",
    narrative: "TOPOLOGICAL / TRANSIT-ENDPOINT behaviors (End, End.X, End.T) manipulate or forward the SRv6 packet itself. SERVICE-ENDPOINT behaviors (End.DX6, End.DX4, End.DT6, End.DT4, End.DX2) expose an inner payload by removing the outer IPv6 encapsulation, then forward it behavior-specifically.",
  },
  {
    id: "mnemonic",
    label: "The Mnemonic (Not A Replacement For RFC 8986)",
    narrative: "D = decapsulation. X = cross-connect. T = table lookup. 6 = IPv6 payload. 4 = IPv4 payload. 2 = Layer 2 / Ethernet payload. This is a teaching aid, not the standard's own definition.",
  },
  {
    id: "topology-extended",
    label: "Extended Topology: R3 Gets A Second Adjacency",
    narrative: `Foundations' hexagon gets one new link: R3-R4 (metric 20). R3's shortest path to R6 is still direct (cost 10 vs. 20 via R4-R5) — but R3 now has a real, distinct physical adjacency toward R4 for End.X to bind to.`,
  },
  {
    id: "predict-normal-r3-r6",
    label: "Predict",
    narrative: "Before any endpoint-behavior SID is used:",
    question: {
      prompt: "With no SRv6 behavior forcing anything, what does R3's ordinary IPv6 FIB say about reaching R6?",
      options: [
        { id: "direct", label: "Direct R3 → R6 (cost 10) — shortest path" },
        { id: "via-r4", label: "R3 → R4 → R5 → R6 (cost 30)" },
      ],
      correctOptionId: "direct",
      explanation: "R3-R6 is a direct cost-10 link; via R4-R5 the same trip costs 20+5+5=30. Ordinary forwarding always takes the direct link — this is the baseline End.X and End.T will each override differently.",
    },
  },

  // === 3. Richer Local SID Table ==============================================
  {
    id: "sid-allocation-r3",
    label: "R3's Local SID Table — Three Behaviors, One Locator",
    narrative: `Under the SAME locator (${locatorTextFor("R3")}), R3 now instantiates three distinct SIDs: ${sidTextFor("R3", FUNCTION.END)} (End), ${sidTextFor("R3", FUNCTION.END_X)} (End.X → adjacency R4), ${sidTextFor("R3", FUNCTION.END_T)} (End.T → table CORE-B). Same locator, three different local instructions.`,
  },
  {
    id: "sid-allocation-r6",
    label: "R6's Local SID Table — The Service Endpoints",
    narrative: `R6 instantiates: ${sidTextFor("R6", FUNCTION.END)} (End), ${sidTextFor("R6", FUNCTION.END_DX6)} (End.DX6 → CE6), ${sidTextFor("R6", FUNCTION.END_DX4)} (End.DX4 → CE4-A), ${sidTextFor("R6", FUNCTION.END_DT6)} (End.DT6 → VRF-CUST6), ${sidTextFor("R6", FUNCTION.END_DT4)} (End.DT4 → VRF-CUST4), ${sidTextFor("R6", FUNCTION.END_DX2)} (End.DX2 → CE-L2).`,
  },
  {
    id: "richer-local-sid-table",
    label: "The Local SID Table Now Carries Parameters",
    narrative: "Each row now carries a Parameter Type and Parameter alongside SID/Locator/Function/Behavior/State — an adjacency, a table name, or an outgoing interface, depending on what the bound behavior actually needs.",
  },
  {
    id: "predict-two-sids-different-behaviors",
    label: "Predict",
    narrative: "Quick check before moving on:",
    question: {
      prompt: "Can two SIDs under the exact same locator execute two completely different behaviors?",
      options: [
        { id: "yes", label: "Yes — the locator only routes to the owner; the Function bits (and the table entry they index) decide the behavior, independently per SID" },
        { id: "no", label: "No — every SID under one locator must share the same behavior" },
      ],
      correctOptionId: "yes",
      explanation: "R3 just did exactly this: one locator, three SIDs (End, End.X, End.T), three different bound behaviors. The locator only answers \"how do I reach the owner\" — it says nothing about behavior.",
    },
  },

  // === 4. End recap ============================================================
  {
    id: "end-recap",
    label: "Recap: End (RFC 8986 §4.1)",
    narrative: `End is the baseline: if Segments Left > 0, decrement it and copy the next Segment List entry into the DA, then do an ORDINARY IPv6 FIB lookup on the new DA. If Segments Left is already 0, it's the final segment — continue to the next header. This baseline is what End.X and End.T both build on.`,
  },

  // === 5. End vs End.X =========================================================
  {
    id: "predict-endx-rewrites-da",
    label: "Predict",
    narrative: "Before building the End.X policy:",
    question: {
      prompt: "Does End.X replace the active IPv6 Destination Address with the adjacency neighbor's own address?",
      options: [
        { id: "no", label: "No — End.X still performs ordinary segment advancement (DA becomes the NEXT SID); only the forwarding TREATMENT changes" },
        { id: "yes", label: "Yes — End.X rewrites the DA to the neighbor's address, like a static route" },
      ],
      correctOptionId: "no",
      explanation: "This is the single most common SRv6 misconception this lesson exists to correct. End.X still copies Segment List[SL] into the DA exactly like End — the difference is entirely in HOW the resulting packet gets transmitted (via one specific adjacency, not an ordinary FIB lookup).",
    },
  },
  {
    id: "policy-a-intro",
    label: "Policy A: <R3 End, R6 End>",
    narrative: "Same final destination, R6, via R3's plain End SID first.",
    run: (state) => ({ state: { ...state, packet: buildEndpointPacket([R3_END, R6_END]), packetAt: "R1", journey: [], highLevelOrder: [R3_END, R6_END] }, events: [] }),
  },
  {
    id: "policy-a-classify",
    label: "R1: Classify + Impose",
    narrative: `IPv6 DA = ${R3_END.sidText} (R3 End). SRH Segment List[0] = ${R6_END.sidText}, Segment List[1] = ${R3_END.sidText}. Segments Left = 1.`,
    packet: (state) => (state.packet ? endpointPacket("a-classify", "R1", "R1", "Classified for <R3 End, R6 End>", "HEADEND", state.packet) : undefined),
    run: (state) => ({ state: { ...state, packetAt: "R2", journey: [{ router: "R1", input: fmtIpv6(state.packet!.outer.daHextets), lookup: "IPv6 FIB: shortest path to R3 locator via R2", action: "IPV6_FIB_FORWARD", output: fmtIpv6(state.packet!.outer.daHextets) }] }, events: [] }),
  },
  {
    id: "policy-a-transit",
    label: "R2 → R3: Ordinary Transit",
    narrative: "R2's own Local SID Table has no match — ordinary IPv6 FIB forward. The packet arrives at R3 with DA and SRH untouched.",
    packet: (state) => (state.packet ? endpointPacket("a-transit", "R2", "R3", "IPv6 FIB forward (unchanged)", "FIB", state.packet) : undefined),
    run: (state) => ({ state: { ...state, packetAt: "R3", journey: [...state.journey, { router: "R2", input: fmtIpv6(state.packet!.outer.daHextets), lookup: "Local SID table: no match. IPv6 FIB forward.", action: "IPV6_FIB_FORWARD", output: fmtIpv6(state.packet!.outer.daHextets) }] }, events: [] }),
  },
  {
    id: "policy-a-r3-end",
    label: "R3: Local SID Match — Execute End",
    narrative: `R3's Local SID Table matches ${R3_END.sidText} to behavior End. Execute: Segments Left 1 → 0, DA → ${R6_END.sidText}.`,
    // run() already executed this endpoint behavior; the engine renders packet() from that POST-run state, so show it as-is (never execute the behavior a second time).
    packet: (state) => (state.packet ? endpointPacket("a-r3-end", "R3", "R3", "End: SL 1→0, DA R3→R6", "END", state.packet) : undefined),
    run: (state) => {
      const entry = findEntry(state, "R3", FUNCTION.END);
      const outcome = processSrv6EndpointBehavior(entry, state.packet!.outer.daHextets, state.packet!.outer.srh, state.packet!.inner, state.vrfs);
      return { state: { ...state, packet: { ...state.packet!, outer: { ...state.packet!.outer, daHextets: outcome.newDaHextets!, srh: outcome.newSrh } }, journey: [...state.journey, { router: "R3", input: `${fmtIpv6(state.packet!.outer.daHextets)}, SL=1`, lookup: "Local SID table: MATCH — behavior End", action: "LOCAL_SID_MATCH", output: `End executes → ${fmtIpv6(outcome.newDaHextets!)}, SL=0` }] }, events: [] };
    },
  },
  {
    id: "policy-a-r3-forward",
    label: "R3 → R6: Ordinary FIB Forward",
    narrative: "With the new DA (R6's End SID), R3 does an ordinary IPv6 FIB lookup — the direct link wins. R3 → R6.",
    packet: (state) => (state.packet ? endpointPacket("a-fwd", "R3", "R6", "IPv6 FIB forward toward new DA", "FIB", state.packet) : undefined),
    run: (state) => ({ state: { ...state, packetAt: "R6", journey: [...state.journey, { router: "R3", input: fmtIpv6(state.packet!.outer.daHextets), lookup: "IPv6 FIB: shortest path to R6 locator — directly connected", action: "IPV6_FIB_FORWARD", output: fmtIpv6(state.packet!.outer.daHextets) }] }, events: [] }),
  },
  {
    id: "policy-a-deliver",
    label: "R6: Final End — Delivered",
    narrative: "R6's Local SID Table matches, Segments Left already 0 — final End. Path taken: R1 → R2 → R3 → R6.",
    packet: (state) => (state.packet ? endpointPacket("a-deliver", "R6", "R6", "Delivered via Policy A", "END", state.packet) : undefined),
    run: (state) => ({ state: { ...state, journey: [...state.journey, { router: "R6", input: fmtIpv6(state.packet!.outer.daHextets), lookup: "Local SID table: MATCH — final End", action: "DELIVER", output: "Delivered" }] }, events: [] }),
    whatChanged: () => ["Policy A delivered R1 → R2 → R3 → R6 — R3's End used ORDINARY IPv6 FIB forwarding toward the new DA"],
  },
  {
    id: "policy-b-intro",
    label: "Policy B: <R3 End.X-via-R4, R6 End>",
    narrative: "Same final destination, R6 — but this time R1 imposes R3's End.X SID first, not R3's plain End SID.",
    run: (state) => ({ state: { ...state, packet: buildEndpointPacket([R3_END_X, R6_END]), packetAt: "R1", journey: [], highLevelOrder: [R3_END_X, R6_END] }, events: [] }),
  },
  {
    id: "policy-b-classify-transit",
    label: "R1 → R2 → R3: Reaches R3 Exactly As Before",
    narrative: `IPv6 DA = ${R3_END_X.sidText} (R3 End.X). R1 and R2 don't know or care that this is an End.X SID rather than a plain End SID — it's still just R3's locator to them.`,
    packet: (state) => (state.packet ? endpointPacket("b-transit", "R1", "R3", "IPv6 FIB forward toward R3 locator", "FIB", state.packet) : undefined),
    run: (state) => ({
      state: {
        ...state,
        packetAt: "R3",
        journey: [
          { router: "R1", input: fmtIpv6(state.packet!.outer.daHextets), lookup: "IPv6 FIB: shortest path to R3 locator via R2", action: "IPV6_FIB_FORWARD", output: fmtIpv6(state.packet!.outer.daHextets) },
          { router: "R2", input: fmtIpv6(state.packet!.outer.daHextets), lookup: "Local SID table: no match. IPv6 FIB forward.", action: "IPV6_FIB_FORWARD", output: fmtIpv6(state.packet!.outer.daHextets) },
        ],
      },
      events: [],
    }),
  },
  {
    id: "policy-b-r3-endx",
    label: "R3: Local SID Match — Execute End.X",
    narrative: `R3's Local SID Table matches ${R3_END_X.sidText} to behavior End.X (adjacency: R4). End.X performs the SAME segment advancement as End: Segments Left 1 → 0, DA → ${R6_END.sidText}. The DA is NOT rewritten to R4's address.`,
    // run() already executed this endpoint behavior; the engine renders packet() from that POST-run state, so show it as-is (never execute the behavior a second time).
    packet: (state) => (state.packet ? endpointPacket("b-r3-endx", "R3", "R3", "End.X: SL 1→0, DA R3→R6 (adjacency R4 bound)", "END.X", state.packet) : undefined),
    run: (state) => {
      const entry = findEntry(state, "R3", FUNCTION.END_X);
      const outcome = processSrv6EndpointBehavior(entry, state.packet!.outer.daHextets, state.packet!.outer.srh, state.packet!.inner, state.vrfs);
      return { state: { ...state, packet: { ...state.packet!, outer: { ...state.packet!.outer, daHextets: outcome.newDaHextets!, srh: outcome.newSrh } }, journey: [...state.journey, { router: "R3", input: `${fmtIpv6(state.packet!.outer.daHextets)}, SL=1`, lookup: "Local SID table: MATCH — behavior End.X, adjacency R4", action: "LOCAL_SID_MATCH", output: `End.X executes → DA ${fmtIpv6(outcome.newDaHextets!)}, SL=0 — forward via adjacency R4` }] }, events: [] };
    },
  },
  {
    id: "policy-b-r3-forward-adjacency",
    label: "R3 → R4: Forced Via Associated Adjacency (NOT Ordinary FIB)",
    narrative: "R3 does not do an IPv6 FIB lookup toward the new DA's locator here — End.X sends the packet out its bound adjacency, R3→R4, regardless of what ordinary IPv6 forwarding would have chosen.",
    packet: (state) => (state.packet ? endpointPacket("b-adj", "R3", "R4", "Adjacency cross-connect (End.X) — bypasses ordinary FIB", "END.X", state.packet) : undefined),
    run: (state) => ({ state: { ...state, packetAt: "R4", journey: [...state.journey, { router: "R3", input: fmtIpv6(state.packet!.outer.daHextets), lookup: "End.X adjacency: R3→R4 (bound, not computed by FIB)", action: "ADJACENCY_CROSS_CONNECT", output: fmtIpv6(state.packet!.outer.daHextets) }] }, events: [] }),
    whatChanged: () => ["R3 sent the packet via its BOUND adjacency (R3→R4), not the ordinary FIB shortest path (which would have been direct R3→R6)"],
  },
  {
    id: "policy-b-r4-r5-transit",
    label: "R4 → R5 → R6: Ordinary Transit From Here On",
    narrative: "Once on R4, the packet is just an ordinary IPv6 packet with DA = R6's End SID. R4 and R5 have no local SID matching it — plain FIB forwarding all the way to R6.",
    packet: (state) => (state.packet ? endpointPacket("b-r4r5", "R4", "R6", "IPv6 FIB forward (unchanged)", "FIB", state.packet) : undefined),
    run: (state) => ({
      state: {
        ...state,
        packetAt: "R6",
        journey: [
          ...state.journey,
          { router: "R4", input: fmtIpv6(state.packet!.outer.daHextets), lookup: "Local SID table: no match. IPv6 FIB: shortest path to R6 via R5", action: "IPV6_FIB_FORWARD", output: fmtIpv6(state.packet!.outer.daHextets) },
          { router: "R5", input: fmtIpv6(state.packet!.outer.daHextets), lookup: "Local SID table: no match. IPv6 FIB: directly connected to R6", action: "IPV6_FIB_FORWARD", output: fmtIpv6(state.packet!.outer.daHextets) },
        ],
      },
      events: [],
    }),
  },
  {
    id: "policy-b-deliver",
    label: "R6: Final End — Delivered",
    narrative: "R6's Local SID Table matches, Segments Left already 0 — final End. Path taken: R1 → R2 → R3 → R4 → R5 → R6 — the SAME next segment (R6), a DIFFERENT physical path, because R3's bound behavior was End.X, not End.",
    packet: (state) => (state.packet ? endpointPacket("b-deliver", "R6", "R6", "Delivered via Policy B", "END", state.packet) : undefined),
    run: (state) => ({ state: { ...state, journey: [...state.journey, { router: "R6", input: fmtIpv6(state.packet!.outer.daHextets), lookup: "Local SID table: MATCH — final End", action: "DELIVER", output: "Delivered" }] }, events: [] }),
    whatChanged: () => ["Policy B delivered R1 → R2 → R3 → R4 → R5 → R6 — same next segment as Policy A, forced through R3's bound adjacency instead of ordinary FIB"],
  },
  {
    id: "signature-end-vs-endx",
    label: "Signature Visual: End vs. End.X",
    narrative: "Same next segment (R6's End SID) both times. End: R3 → R6 (ordinary FIB). End.X: R3 → R4 → R5 → R6 (forced adjacency J = R3→R4). Same next segment. Different forwarding instruction.",
  },
  {
    id: "endx-accuracy-note",
    label: "Mandatory: What End.X Actually Changes",
    narrative: "The active segment advancement still produces DA = next SID, exactly like End. End.X changes ONLY the forwarding treatment used to transmit toward that new destination — via a specific bound adjacency instead of an ordinary FIB lookup. Never describe End.X as \"an IPv6 static route\" or \"rewriting the DA to the neighbor.\"",
  },
  {
    id: "endx-adjsid-analogy",
    label: "End.X Is The SRv6 Adj-SID-Style Behavior",
    narrative: "End ~ a Prefix-SID-style topological segment (\"reach this node via the shortest path\"). End.X ~ an Adjacency-SID-style topological segment (\"reach this node, then use exactly this one link\") — the SRv6 analog of SR-MPLS's Adjacency SID, expressed as an endpoint behavior instead of a label.",
  },

  // === 6. End.T ================================================================
  {
    id: "endt-intro",
    label: "End.T: A Second IPv6 Table",
    narrative: `R3 has two IPv6 FIB tables: MAIN (the one used so far) and CORE-B — identical except CORE-B excludes the direct R3-R6 link. Same next-active DA resolves differently depending on which table is consulted.`,
  },
  {
    id: "predict-endt-decapsulates",
    label: "Predict",
    narrative: "Before sending toward End.T:",
    question: {
      prompt: "Does End.T decapsulate the packet?",
      options: [
        { id: "no", label: "No — End.T is a topological behavior: endpoint + a specific IPv6 table lookup. Nothing is removed from the packet." },
        { id: "yes", label: "Yes — like End.DT6, it strips the outer IPv6 header first" },
      ],
      correctOptionId: "no",
      explanation: "End.T never touches encapsulation. It performs the exact same End mutation (decrement Segments Left, copy the next SID into DA), then looks up the new DA in table T instead of the default table — that's the entire difference from End.",
    },
  },
  {
    id: "policy-c-intro",
    label: "Policy C: <R3 End.T-via-CORE-B, R6 End>",
    narrative: "Same next segment (R6) again — this time via R3's End.T SID.",
    run: (state) => ({ state: { ...state, packet: buildEndpointPacket([R3_END_T, R6_END]), packetAt: "R1", journey: [], highLevelOrder: [R3_END_T, R6_END] }, events: [] }),
  },
  {
    id: "policy-c-transit",
    label: "R1 → R2 → R3: Reaches R3 As Always",
    narrative: `IPv6 DA = ${R3_END_T.sidText} (R3 End.T). Transit routers treat this exactly like any other SID under R3's locator.`,
    packet: (state) => (state.packet ? endpointPacket("c-transit", "R1", "R3", "IPv6 FIB forward toward R3 locator", "FIB", state.packet) : undefined),
    run: (state) => ({
      state: {
        ...state,
        packetAt: "R3",
        journey: [
          { router: "R1", input: fmtIpv6(state.packet!.outer.daHextets), lookup: "IPv6 FIB: shortest path to R3 locator via R2", action: "IPV6_FIB_FORWARD", output: fmtIpv6(state.packet!.outer.daHextets) },
          { router: "R2", input: fmtIpv6(state.packet!.outer.daHextets), lookup: "Local SID table: no match. IPv6 FIB forward.", action: "IPV6_FIB_FORWARD", output: fmtIpv6(state.packet!.outer.daHextets) },
        ],
      },
      events: [],
    }),
  },
  {
    id: "policy-c-r3-endt",
    label: "R3: Local SID Match — Execute End.T",
    narrative: `R3's Local SID Table matches ${R3_END_T.sidText} to behavior End.T (table: CORE-B). Same End mutation as always: Segments Left 1 → 0, DA → ${R6_END.sidText}. The NEXT lookup will use CORE-B, not MAIN.`,
    // run() already executed this endpoint behavior; the engine renders packet() from that POST-run state, so show it as-is (never execute the behavior a second time).
    packet: (state) => (state.packet ? endpointPacket("c-r3-endt", "R3", "R3", "End.T: SL 1→0, DA R3→R6 (table CORE-B bound)", "END.T", state.packet) : undefined),
    run: (state) => {
      const entry = findEntry(state, "R3", FUNCTION.END_T);
      const outcome = processSrv6EndpointBehavior(entry, state.packet!.outer.daHextets, state.packet!.outer.srh, state.packet!.inner, state.vrfs);
      return { state: { ...state, packet: { ...state.packet!, outer: { ...state.packet!.outer, daHextets: outcome.newDaHextets!, srh: outcome.newSrh } }, journey: [...state.journey, { router: "R3", input: `${fmtIpv6(state.packet!.outer.daHextets)}, SL=1`, lookup: "Local SID table: MATCH — behavior End.T, table CORE-B", action: "LOCAL_SID_MATCH", output: `End.T executes → DA ${fmtIpv6(outcome.newDaHextets!)}, SL=0 — next lookup in CORE-B` }] }, events: [] };
    },
  },
  {
    id: "policy-c-core-b-lookup",
    label: "R3: IPv6 Lookup In CORE-B — Not MAIN",
    narrative: `CORE-B excludes the direct R3-R6 link. Looking up R6's locator in CORE-B gives next-hop R4 (cost 30 via R4-R5-R6) — MAIN would have given direct R6 (cost 10). R3 forwards to R4.`,
    packet: (state) => (state.packet ? endpointPacket("c-coreb", "R3", "R4", "CORE-B table lookup forward", "END.T", state.packet) : undefined),
    run: (state) => ({ state: { ...state, packetAt: "R4", journey: [...state.journey, { router: "R3", input: fmtIpv6(state.packet!.outer.daHextets), lookup: "CORE-B: R6 locator → next-hop R4 (direct R3-R6 excluded from this table)", action: "TABLE_LOOKUP", output: fmtIpv6(state.packet!.outer.daHextets) }] }, events: [] }),
    whatChanged: () => ["R3 looked up the new DA in CORE-B (not MAIN) — CORE-B's exclusion of the direct link changed the next hop to R4"],
  },
  {
    id: "policy-c-r4-r5-transit",
    label: "R4 → R5 → R6: Ordinary Transit",
    narrative: "From R4 onward this is just an ordinary IPv6 packet — R4 and R5 have no local SID matching it, and no table binding follows the packet past R3's own lookup.",
    packet: (state) => (state.packet ? endpointPacket("c-r4r5", "R4", "R6", "IPv6 FIB forward (unchanged)", "FIB", state.packet) : undefined),
    run: (state) => ({
      state: {
        ...state,
        packetAt: "R6",
        journey: [
          ...state.journey,
          { router: "R4", input: fmtIpv6(state.packet!.outer.daHextets), lookup: "Local SID table: no match. IPv6 FIB forward.", action: "IPV6_FIB_FORWARD", output: fmtIpv6(state.packet!.outer.daHextets) },
          { router: "R5", input: fmtIpv6(state.packet!.outer.daHextets), lookup: "Local SID table: no match. IPv6 FIB: directly connected to R6", action: "IPV6_FIB_FORWARD", output: fmtIpv6(state.packet!.outer.daHextets) },
        ],
      },
      events: [],
    }),
  },
  {
    id: "policy-c-deliver",
    label: "R6: Final End — Delivered",
    narrative: "Path taken: R1 → R2 → R3 → R4 → R5 → R6 — same next segment as Policy A and B, again a different physical path, this time because R3 consulted CORE-B instead of MAIN.",
    packet: (state) => (state.packet ? endpointPacket("c-deliver", "R6", "R6", "Delivered via Policy C", "END", state.packet) : undefined),
    run: (state) => ({ state: { ...state, journey: [...state.journey, { router: "R6", input: fmtIpv6(state.packet!.outer.daHextets), lookup: "Local SID table: MATCH — final End", action: "DELIVER", output: "Delivered" }] }, events: [] }),
    whatChanged: () => ["Policy C delivered R1 → R2 → R3 → R4 → R5 → R6 — End.T's bound table (CORE-B) changed the next-hop decision, not the segment advancement"],
  },
  {
    id: "end-vs-endt-comparison",
    label: "Signature Visual: End vs. End.T",
    narrative: "End: lookup R6 in the packet's normal/current table (MAIN) → direct R6. End.T: associate the packet with CORE-B → lookup R6 in CORE-B → R4. Same DA both times — different table, different next hop.",
  },
  {
    id: "endt-vs-dt6-distinction",
    label: "Mandatory: End.T Is Not End.DT6",
    narrative: "End.T: endpoint + a specific IPv6 table lookup — NO decapsulation, the outer SRv6 packet keeps moving. End.DT6: final endpoint + decapsulation + a specific IPv6 table lookup on the EXPOSED inner packet. The D matters — it's the entire difference between \"keep routing the SRv6 packet\" and \"hand the customer packet to its own service.\"",
  },

  // === 7. Decapsulation family intro ==========================================
  {
    id: "decap-family-transition",
    label: "A New Family: Decapsulation",
    narrative: "End, End.X, and End.T all manipulate or forward the SRv6 packet ITSELF. End.DX6, End.DX4, End.DT6, End.DT4, and End.DX2 instead expose an INNER payload by removing the outer IPv6 encapsulation, then forward that inner payload behavior-specifically.",
  },
  {
    id: "outer-inner-packet-model",
    label: "Outer vs. Inner — Two Different Namespaces",
    narrative: "OUTER: IPv6, DA = the active SRv6 SID (plus an SRH only when the program genuinely needs one). INNER: an IPv6 packet, an IPv4 packet, or an Ethernet frame — customer traffic riding underneath. During transport, the outer DA is the SRv6 forwarding namespace; the inner destination means nothing to any transit router.",
  },
  {
    id: "headend-encaps-note",
    label: "Headend: A Simplified SRv6 Encapsulation",
    narrative: "For these service examples, R1 performs a simplified SRv6 headend encapsulation — imposing the outer IPv6 DA needed to reach the service SID. The full headend-encapsulation lesson (H.Encaps, H.Encaps.Red, Binding SID) is later material; this lesson only needs enough of it to build the outer packet.",
  },
  {
    id: "final-segment-rule",
    label: "Mandatory: The Final-Segment Rule",
    narrative: "End.DX6, End.DX4, End.DT6, End.DT4, and End.DX2 are modeled as FINAL-segment behaviors. If an SRH is processed while one of these SIDs is active, Segments Left MUST equal 0 — DA = a service SID with SL > 0 must NOT execute normal service delivery.",
  },
  {
    id: "final-segment-invalid-demo",
    label: "Invalid Example: End.DT4 With Segments Left = 1",
    narrative: "Deliberately wrong order: <R6 End.DT4, R3 End> — R6's End.DT4 SID is visited FIRST, so when it becomes active at R6, Segments Left is still 1 (one more segment, R3's End, remains). Sent this way, the service behavior must be rejected, not executed.",
    run: (state) => ({
      state: { ...state, packet: buildEndpointPacket([R6_DT4, R3_END], ipv4Inner("10.10.2.8")), packetAt: "R6", journey: [], highLevelOrder: [R6_DT4, R3_END] },
      events: [],
    }),
  },
  {
    id: "final-segment-invalid-result",
    label: "R6: INVALID_FINAL_SEGMENT — Rejected",
    narrative: `R6's Local SID Table matches ${R6_DT4.sidText} to End.DT4 — but Segments Left is 1, not 0. PacketVerse models this as INVALID_FINAL_SEGMENT: the service behavior does not execute. No decapsulation, no VRF lookup — the packet is dropped.`,
    packet: (state) => (state.packet ? endpointPacket("invalid-final", "R6", "R6", "Rejected: not the final segment", "DROP", state.packet) : undefined),
    run: (state) => {
      const entry = findEntry(state, "R6", FUNCTION.END_DT4);
      const outcome = processSrv6EndpointBehavior(entry, state.packet!.outer.daHextets, state.packet!.outer.srh, state.packet!.inner, state.vrfs);
      return { state: { ...state, journey: [...state.journey, { router: "R6", input: `${fmtIpv6(state.packet!.outer.daHextets)}, SL=${state.packet!.outer.srh?.segmentsLeft}`, lookup: "Local SID table: MATCH — End.DT4. Final-segment check: FAILED (SL≠0).", action: "INVALID_FINAL_SEGMENT", output: outcome.dropReason ?? "Dropped" }] }, events: [] };
    },
    whatChanged: () => ["R6 rejected the service behavior — a final-segment behavior can never execute with Segments Left > 0, no matter how healthy everything else is"],
  },

  // === 8. End.DX6 ===============================================================
  {
    id: "dx6-intro",
    label: "End.DX6: Decapsulation + IPv6 Cross-Connect",
    narrative: `R6's End.DX6 SID (${R6_DX6.sidText}) is bound to adjacency CE6. Send a customer IPv6 packet (dst ${fmtIpv6(CUST6_HOST_HEXTETS)}) encapsulated toward it.`,
    run: (state) => ({ state: { ...state, packet: buildEndpointPacket([R6_DX6], CUST6_INNER), packetAt: "R1", journey: [], highLevelOrder: [R6_DX6] }, events: [] }),
  },
  {
    id: "dx6-encaps-transit",
    label: "R1 Encapsulates; R2/R3/R4/R5 Ordinary Transit",
    narrative: `Outer DA = ${R6_DX6.sidText}, no SRH needed (single segment). R1 → R2 → R3 → R6 is the IGP shortest path toward R6's locator — none of these routers have any reason to look inside the outer IPv6 header.`,
    packet: (state) => (state.packet ? endpointPacket("dx6-transit", "R1", "R6", "Headend encaps + IPv6 FIB forward", "FIB", state.packet) : undefined),
    run: (state) => ({
      state: {
        ...state,
        packetAt: "R6",
        journey: [
          { router: "R1", input: fmtIpv6(state.packet!.outer.daHextets), lookup: "Headend: encapsulate inner IPv6 behind outer DA = R6 End.DX6 SID", action: "HEADEND_ENCAPS", output: fmtIpv6(state.packet!.outer.daHextets) },
          { router: "R2", input: fmtIpv6(state.packet!.outer.daHextets), lookup: "Local SID table: no match. IPv6 FIB forward.", action: "IPV6_FIB_FORWARD", output: fmtIpv6(state.packet!.outer.daHextets) },
          { router: "R3", input: fmtIpv6(state.packet!.outer.daHextets), lookup: "Local SID table: no match (this DA is R6's, not R3's). IPv6 FIB forward.", action: "IPV6_FIB_FORWARD", output: fmtIpv6(state.packet!.outer.daHextets) },
        ],
      },
      events: [],
    }),
  },
  {
    id: "dx6-r6-match",
    label: "R6: Local SID Match — Execute End.DX6",
    narrative: `R6's Local SID Table matches ${R6_DX6.sidText} to End.DX6 (adjacency CE6). Final-segment check: passes (no SRH). Payload check: inner is IPv6, as expected. Decapsulate the outer IPv6 header — expose the inner IPv6 packet.`,
    packet: (state) => (state.packet ? endpointPacket("dx6-match", "R6", "R6", "Local SID match — End.DX6", "MATCH", state.packet) : undefined),
    run: (state) => {
      const entry = findEntry(state, "R6", FUNCTION.END_DX6);
      const outcome = processSrv6EndpointBehavior(entry, state.packet!.outer.daHextets, state.packet!.outer.srh, state.packet!.inner, state.vrfs);
      return { state: { ...state, journey: [...state.journey, { router: "R6", input: fmtIpv6(state.packet!.outer.daHextets), lookup: "Local SID table: MATCH — End.DX6, adjacency CE6", action: "LOCAL_SID_MATCH", output: `Decapsulate → adjacency ${outcome.ceTarget}` }] }, events: [] };
    },
  },
  {
    id: "dx6-deliver",
    label: "R6 → CE6: Cross-Connect, No Tenant Lookup",
    narrative: `The exposed inner IPv6 packet (dst ${fmtIpv6(CUST6_HOST_HEXTETS)}) is sent DIRECTLY to CE6 via the bound adjacency — R6 never performs an IPv6 routing-table lookup for it. The SID itself identified where the exposed traffic goes.`,
    packet: (state) => (state.packet ? endpointPacket("dx6-deliver", "R6", "CE6", "Decap + adjacency cross-connect to CE6", "DECAP", state.packet) : undefined),
    run: (state) => ({ state: { ...state, journey: [...state.journey, { router: "R6", input: fmtIpv6(CUST6_HOST_HEXTETS), lookup: "End.DX6: decapsulate, cross-connect to adjacency CE6 — no tenant table consulted", action: "DECAP_IPV6", output: "Delivered to CE6" }] }, events: [] }),
    whatChanged: () => ["Delivered to CE6 by fixed adjacency — End.DX6 never performed a routing-table lookup on the exposed inner IPv6 packet"],
  },

  // === 9. End.DX4 ===============================================================
  {
    id: "dx4-intro",
    label: "End.DX4: Decapsulation + IPv4 Cross-Connect",
    narrative: `R6's End.DX4 SID (${R6_DX4.sidText}) is bound to adjacency CE4-A. Send a customer IPv4 packet (dst 10.10.1.5) toward it.`,
    run: (state) => ({ state: { ...state, packet: buildEndpointPacket([R6_DX4], ipv4Inner("10.10.1.5")), packetAt: "R1", journey: [], highLevelOrder: [R6_DX4] }, events: [] }),
  },
  {
    id: "dx4-transit",
    label: "R1 Encapsulates; Ordinary Transit To R6",
    narrative: `Outer DA = ${R6_DX4.sidText}. Same IGP shortest path toward R6's locator as always.`,
    packet: (state) => (state.packet ? endpointPacket("dx4-transit", "R1", "R6", "Headend encaps + IPv6 FIB forward", "FIB", state.packet) : undefined),
    run: (state) => ({
      state: {
        ...state,
        packetAt: "R6",
        journey: [
          { router: "R1", input: fmtIpv6(state.packet!.outer.daHextets), lookup: "Headend: encapsulate inner IPv4 behind outer DA = R6 End.DX4 SID", action: "HEADEND_ENCAPS", output: fmtIpv6(state.packet!.outer.daHextets) },
          { router: "R2", input: fmtIpv6(state.packet!.outer.daHextets), lookup: "Local SID table: no match. IPv6 FIB forward.", action: "IPV6_FIB_FORWARD", output: fmtIpv6(state.packet!.outer.daHextets) },
          { router: "R3", input: fmtIpv6(state.packet!.outer.daHextets), lookup: "Local SID table: no match. IPv6 FIB forward.", action: "IPV6_FIB_FORWARD", output: fmtIpv6(state.packet!.outer.daHextets) },
        ],
      },
      events: [],
    }),
  },
  {
    id: "dx4-r6-match-deliver",
    label: "R6: Execute End.DX4 — Decap + Fixed Adjacency",
    narrative: "Final-segment check passes, inner payload is IPv4 as expected. Decapsulate, then send DIRECTLY to CE4-A via the bound adjacency — no VRF route lookup is required by this behavior.",
    packet: (state) => (state.packet ? endpointPacket("dx4-deliver", "R6", "CE4-A", "Decap + adjacency cross-connect to CE4-A", "DECAP", state.packet) : undefined),
    run: (state) => {
      const entry = findEntry(state, "R6", FUNCTION.END_DX4);
      const outcome = processSrv6EndpointBehavior(entry, state.packet!.outer.daHextets, state.packet!.outer.srh, state.packet!.inner, state.vrfs);
      return { state: { ...state, journey: [...state.journey, { router: "R6", input: fmtIpv6(state.packet!.outer.daHextets), lookup: "Local SID table: MATCH — End.DX4, adjacency CE4-A", action: "LOCAL_SID_MATCH", output: `Decapsulate → adjacency ${outcome.ceTarget}` }, { router: "R6", input: "10.10.1.5", lookup: "End.DX4: decapsulate, cross-connect to adjacency CE4-A — no VRF lookup", action: "DECAP_IPV4", output: "Delivered to CE4-A" }] }, events: [] };
    },
    whatChanged: () => ["Delivered to CE4-A by fixed adjacency, regardless of the customer destination address — End.DX4 never consults a VRF"],
  },
  {
    id: "dx-analogy",
    label: "DX ~ Per-CE Service Demultiplexing",
    narrative: "End.DX6/End.DX4 conceptually resemble per-CE VPN service delivery — the SID itself identifies exactly where exposed traffic gets cross-connected, the same way a per-CE MPLS VPN label identifies one specific outgoing interface. Don't overextend the analogy beyond that one shared idea.",
  },
  {
    id: "dx-vs-dt-visual",
    label: "Signature Visual: DX vs. DT",
    narrative: "DX: decapsulate → fixed L3 adjacency J → CE. DT: decapsulate → select table T → destination lookup → selected CE/next hop. X = cross-connect. T = table lookup.",
  },

  // === 10. End.DT6 ===============================================================
  {
    id: "dt6-intro",
    label: "End.DT6: Decapsulation + IPv6 Table Lookup",
    narrative: `R6's End.DT6 SID (${R6_DT6.sidText}) is bound to table VRF-CUST6. Send the SAME customer IPv6 packet (dst ${fmtIpv6(CUST6_HOST_HEXTETS)}) — this time toward the DT6 SID.`,
    run: (state) => ({ state: { ...state, packet: buildEndpointPacket([R6_DT6], CUST6_INNER), packetAt: "R1", journey: [], highLevelOrder: [R6_DT6] }, events: [] }),
  },
  {
    id: "dt6-transit",
    label: "R1 Encapsulates; Ordinary Transit To R6",
    narrative: `Outer DA = ${R6_DT6.sidText}. Transit is identical to every other service SID under R6's locator.`,
    packet: (state) => (state.packet ? endpointPacket("dt6-transit", "R1", "R6", "Headend encaps + IPv6 FIB forward", "FIB", state.packet) : undefined),
    run: (state) => ({
      state: {
        ...state,
        packetAt: "R6",
        journey: [
          { router: "R1", input: fmtIpv6(state.packet!.outer.daHextets), lookup: "Headend: encapsulate inner IPv6 behind outer DA = R6 End.DT6 SID", action: "HEADEND_ENCAPS", output: fmtIpv6(state.packet!.outer.daHextets) },
          { router: "R2", input: fmtIpv6(state.packet!.outer.daHextets), lookup: "Local SID table: no match. IPv6 FIB forward.", action: "IPV6_FIB_FORWARD", output: fmtIpv6(state.packet!.outer.daHextets) },
          { router: "R3", input: fmtIpv6(state.packet!.outer.daHextets), lookup: "Local SID table: no match. IPv6 FIB forward.", action: "IPV6_FIB_FORWARD", output: fmtIpv6(state.packet!.outer.daHextets) },
        ],
      },
      events: [],
    }),
  },
  {
    id: "dt6-r6-deliver",
    label: "R6: Execute End.DT6 — Decap + VRF-CUST6 Lookup",
    narrative: `Final-segment and payload checks pass. Decapsulate, associate the exposed packet with VRF-CUST6, then perform an IPv6 lookup for ${fmtIpv6(CUST6_HOST_HEXTETS)} — VRF-CUST6's single route resolves to CE6.`,
    packet: (state) => (state.packet ? endpointPacket("dt6-deliver", "R6", "CE6", "Decap + VRF-CUST6 lookup → CE6", "DECAP", state.packet) : undefined),
    run: (state) => {
      const entry = findEntry(state, "R6", FUNCTION.END_DT6);
      const outcome = processSrv6EndpointBehavior(entry, state.packet!.outer.daHextets, state.packet!.outer.srh, state.packet!.inner, state.vrfs);
      return { state: { ...state, journey: [...state.journey, { router: "R6", input: fmtIpv6(state.packet!.outer.daHextets), lookup: "Local SID table: MATCH — End.DT6, table VRF-CUST6", action: "LOCAL_SID_MATCH", output: "Decapsulate → VRF-CUST6 lookup" }, { router: "R6", input: fmtIpv6(CUST6_HOST_HEXTETS), lookup: `VRF-CUST6: IPv6 lookup → ${outcome.ceTarget}`, action: "DECAP_IPV6", output: `Delivered to ${outcome.ceTarget}` }] }, events: [] };
    },
    whatChanged: () => ["Delivered to CE6 via an actual VRF-CUST6 route lookup, not a fixed adjacency"],
  },

  // === 11. End.DT4 (multi-prefix) ================================================
  {
    id: "dt4-intro",
    label: "End.DT4: Decapsulation + IPv4 Table Lookup",
    narrative: `R6's End.DT4 SID (${R6_DT4.sidText}) is bound to table VRF-CUST4, which holds TWO routes: 10.10.1.0/24 → CE4-A, 10.10.2.0/24 → CE4-B. One SID, two possible outcomes.`,
  },
  {
    id: "dt4-send-a",
    label: "Send Toward 10.10.1.5",
    narrative: "First customer packet: inner IPv4 dst 10.10.1.5.",
    run: (state) => ({ state: { ...state, packet: buildEndpointPacket([R6_DT4], ipv4Inner("10.10.1.5")), packetAt: "R1", journey: [], highLevelOrder: [R6_DT4] }, events: [] }),
  },
  {
    id: "dt4-a-transit-deliver",
    label: "R1 → R6 → VRF-CUST4 Lookup → CE4-A",
    narrative: "Ordinary transit to R6, then: decapsulate, associate with VRF-CUST4, look up 10.10.1.5 → matches 10.10.1.0/24 → CE4-A.",
    packet: (state) => (state.packet ? endpointPacket("dt4-a-deliver", "R6", "CE4-A", "Decap + VRF-CUST4 lookup → CE4-A", "DECAP", state.packet) : undefined),
    run: (state) => {
      const entry = findEntry(state, "R6", FUNCTION.END_DT4);
      const outcome = processSrv6EndpointBehavior(entry, state.packet!.outer.daHextets, state.packet!.outer.srh, state.packet!.inner, state.vrfs);
      return {
        state: {
          ...state,
          packetAt: "R6",
          journey: [
            { router: "R1", input: fmtIpv6(state.packet!.outer.daHextets), lookup: "Headend: encapsulate inner IPv4 behind outer DA = R6 End.DT4 SID", action: "HEADEND_ENCAPS", output: fmtIpv6(state.packet!.outer.daHextets) },
            { router: "R6", input: "10.10.1.5", lookup: `VRF-CUST4: IPv4 lookup → ${outcome.ceTarget}`, action: "DECAP_IPV4", output: `Delivered to ${outcome.ceTarget}` },
          ],
        },
        events: [],
      };
    },
  },
  {
    id: "dt4-send-b",
    label: "Send Toward 10.10.2.8",
    narrative: "SAME SID, SAME behavior, SAME table — different customer destination: 10.10.2.8.",
    run: (state) => ({ state: { ...state, packet: buildEndpointPacket([R6_DT4], ipv4Inner("10.10.2.8")), packetAt: "R1", journey: [], highLevelOrder: [R6_DT4] }, events: [] }),
  },
  {
    id: "dt4-b-transit-deliver",
    label: "R1 → R6 → VRF-CUST4 Lookup → CE4-B",
    narrative: "Decapsulate, associate with VRF-CUST4, look up 10.10.2.8 → matches 10.10.2.0/24 → CE4-B. The exact same End.DT4 SID just resolved to a different CE.",
    packet: (state) => (state.packet ? endpointPacket("dt4-b-deliver", "R6", "CE4-B", "Decap + VRF-CUST4 lookup → CE4-B", "DECAP", state.packet) : undefined),
    run: (state) => {
      const entry = findEntry(state, "R6", FUNCTION.END_DT4);
      const outcome = processSrv6EndpointBehavior(entry, state.packet!.outer.daHextets, state.packet!.outer.srh, state.packet!.inner, state.vrfs);
      return {
        state: {
          ...state,
          packetAt: "R6",
          journey: [
            { router: "R1", input: fmtIpv6(state.packet!.outer.daHextets), lookup: "Headend: encapsulate inner IPv4 behind outer DA = R6 End.DT4 SID", action: "HEADEND_ENCAPS", output: fmtIpv6(state.packet!.outer.daHextets) },
            { router: "R6", input: "10.10.2.8", lookup: `VRF-CUST4: IPv4 lookup → ${outcome.ceTarget}`, action: "DECAP_IPV4", output: `Delivered to ${outcome.ceTarget}` },
          ],
        },
        events: [],
      };
    },
    whatChanged: () => ["Same End.DT4 SID, same VRF-CUST4 table — a different customer destination resolved to a different CE (CE4-B instead of CE4-A)"],
  },
  {
    id: "per-ce-vs-per-vrf",
    label: "Per-CE vs. Per-VRF",
    narrative: "End.DX4/End.DX6 cross-connect semantics ~ per-CE style demultiplexing. End.DT4/End.DT6 table-lookup semantics ~ per-VRF style demultiplexing. Not every implementation's SID allocation strategy must follow one exact deployment pattern — this is the conceptual shape, not a mandated design.",
  },

  // === 12. End.DX2 ================================================================
  {
    id: "dx2-intro",
    label: "End.DX2: Decapsulation + L2 Cross-Connect",
    narrative: `R6's End.DX2 SID (${R6_DX2.sidText}) is bound to outgoing interface ge-0/0/7 (CE-L2). Send an Ethernet frame, CE-A-MAC → CE-B-MAC, encapsulated toward it.`,
    run: (state) => ({ state: { ...state, packet: buildEndpointPacket([R6_DX2], ETHERNET_INNER), packetAt: "R1", journey: [], highLevelOrder: [R6_DX2] }, events: [] }),
  },
  {
    id: "dx2-transit",
    label: "R1 Encapsulates; Ordinary Transit To R6",
    narrative: `Outer DA = ${R6_DX2.sidText}. The inner Ethernet frame is completely invisible to every transit router — they only ever see the outer IPv6 header.`,
    packet: (state) => (state.packet ? endpointPacket("dx2-transit", "R1", "R6", "Headend encaps + IPv6 FIB forward", "FIB", state.packet) : undefined),
    run: (state) => ({
      state: {
        ...state,
        packetAt: "R6",
        journey: [
          { router: "R1", input: fmtIpv6(state.packet!.outer.daHextets), lookup: "Headend: encapsulate inner Ethernet frame behind outer DA = R6 End.DX2 SID", action: "HEADEND_ENCAPS", output: fmtIpv6(state.packet!.outer.daHextets) },
          { router: "R2", input: fmtIpv6(state.packet!.outer.daHextets), lookup: "Local SID table: no match. IPv6 FIB forward.", action: "IPV6_FIB_FORWARD", output: fmtIpv6(state.packet!.outer.daHextets) },
          { router: "R3", input: fmtIpv6(state.packet!.outer.daHextets), lookup: "Local SID table: no match. IPv6 FIB forward.", action: "IPV6_FIB_FORWARD", output: fmtIpv6(state.packet!.outer.daHextets) },
        ],
      },
      events: [],
    }),
  },
  {
    id: "dx2-r6-execute",
    label: "R6: Execute End.DX2 — No Generic MAC Lookup",
    narrative: "Final-segment check passes, inner payload is Ethernet as expected. Remove the outer IPv6 header, expose the Ethernet frame — and forward it DIRECTLY through the associated OIF. R6 does NOT learn a MAC or consult a bridge table here.",
    packet: (state) => (state.packet ? endpointPacket("dx2-execute", "R6", "R6", "Local SID match — End.DX2", "MATCH", state.packet) : undefined),
    run: (state) => {
      const entry = findEntry(state, "R6", FUNCTION.END_DX2);
      const outcome = processSrv6EndpointBehavior(entry, state.packet!.outer.daHextets, state.packet!.outer.srh, state.packet!.inner, state.vrfs);
      return { state: { ...state, journey: [...state.journey, { router: "R6", input: fmtIpv6(state.packet!.outer.daHextets), lookup: "Local SID table: MATCH — End.DX2, OIF ge-0/0/7", action: "LOCAL_SID_MATCH", output: `Decapsulate → OIF ${outcome.oif}` }] }, events: [] };
    },
  },
  {
    id: "dx2-deliver",
    label: "R6 → CE-L2: L2 Cross-Connect",
    narrative: "The exposed Ethernet frame (CE-A-MAC → CE-B-MAC) is sent directly out ge-0/0/7 toward CE-L2 — no destination-MAC bridge-table lookup, no flooding decision. This is exactly the DX cross-connect pattern, just for an Ethernet payload.",
    packet: (state) => (state.packet ? endpointPacket("dx2-deliver", "R6", "CE-L2", "Decap + OIF cross-connect to CE-L2", "L2-XC", state.packet) : undefined),
    run: (state) => ({ state: { ...state, journey: [...state.journey, { router: "R6", input: "CE-A-MAC → CE-B-MAC", lookup: "End.DX2: decapsulate, cross-connect to OIF ge-0/0/7 — no MAC table consulted", action: "L2_CROSS_CONNECT", output: "Delivered to CE-L2" }] }, events: [] }),
    whatChanged: () => ["Delivered to CE-L2 by fixed OIF — basic End.DX2 never performs a generic destination-MAC bridge-table lookup"],
  },
  {
    id: "dx2-advanced-preview",
    label: "Preview: Advanced L2 Behaviors",
    narrative: "End.DX2V adds VLAN-aware L2 table semantics. End.DT2U adds unicast MAC-lookup semantics. End.DT2M adds BUM/flooding semantics. Basic End.DX2 itself is NOT a generic multipoint Ethernet bridge — these are different, more advanced behaviors, previewed only.",
  },

  // === 13. Behavior comparison + endpoint flavors preview =========================
  {
    id: "behavior-comparison-intro",
    label: "Every Behavior, Side By Side",
    narrative: "The comparison viewer below draws directly from this lesson's own domain model — advances-segment / decapsulates / payload / forwarding action / associated parameter / must-be-final, for all eight fully-implemented behaviors.",
  },
  {
    id: "endpoint-flavors-preview",
    label: "Preview: PSP / USP / USD",
    narrative: "PSP, USP, and USD are behavior FLAVORS that modify SRH removal/decapsulation timing for the End/End.X/End.T family. They are previewed conceptually only — no packet forwarding for them is implemented here. PSP is comparable in spirit to MPLS PHP, but it is not the same mechanism — don't equate them.",
  },
  {
    id: "dt46-and-others-preview",
    label: "Preview: End.DT46, End.DX2V, End.DT2U, End.DT2M, End.B6.Encaps(.Red), End.BM",
    narrative: "End.DT46 (dual-stack decapsulation + table lookup), End.B6.Encaps / End.B6.Encaps.Red (SRv6 re-encapsulation), and End.BM (SR-MPLS-in-SRv6 mapping) round out RFC 8986's behavior catalog — named and positioned in the taxonomy here, not implemented as real forwarding.",
  },

  // === 14. Troubleshooting =========================================================
  {
    id: "troubleshooting-intro",
    label: "Incident",
    narrative: "An SRv6 packet reaches R6. The service SID is installed and active. Decapsulation succeeds. Traffic for customer destination 10.10.2.8 does not reach CE4-B.",
    run: (state) => ({ state: { ...state, troubleshooting: { ...state.troubleshooting, started: true }, packet: undefined, packetAt: undefined, journey: [], fault: undefined, highLevelOrder: undefined }, events: [] }),
  },
  {
    id: "predict-fault-hypothesis",
    label: "Predict",
    narrative: "Before diagnosing:",
    question: {
      prompt: "R6 must deliver this IPv4 customer traffic using a VRF-CUST4 route lookup. Given everything below the local-SID binding is confirmed healthy, what's the most likely fault category?",
      options: [
        { id: "wrong-behavior", label: "R6's service SID is bound to the wrong BEHAVIOR — a cross-connect instead of a table lookup" },
        { id: "igp-down", label: "The IGP has stopped computing a path to R6" },
        { id: "missing-route", label: "The provider's IPv6 core is missing a route to the customer prefix" },
      ],
      correctOptionId: "wrong-behavior",
      explanation: "Decapsulation succeeding while the customer packet still goes to the wrong place is exactly the DX-vs-DT distinction from earlier in this lesson: a fixed adjacency delivers to ONE place regardless of destination, while only a table lookup can route different prefixes to different CEs.",
      hints: ["Underlay, locator reachability, the local SID match, the final-segment check, and decapsulation are ALL confirmed healthy in the incident report.", "The question is what happens to the exposed IPv4 packet, not whether it got exposed."],
    },
  },
  {
    id: "diagnostic-ladder",
    label: "Diagnostic Ladder",
    narrative: "Interfaces, underlay IGP, R6's locator reachability, the local SID match, the final-segment check (SL=0), and outer decapsulation are ALL healthy. What's broken is the SERVICE SEMANTICS the SID is bound to.",
  },
  {
    id: "fault-inject",
    label: "Fault: R6's Service SID Misbound As End.DX4",
    narrative: `R6's SID that should be End.DT4 (table VRF-CUST4) has been misconfigured as End.DX4 (fixed adjacency CE4-A). The SID value itself hasn't changed — only its behavior binding.`,
    run: (state) => ({ state: { ...state, localSidTable: { ...state.localSidTable, R6: withDt4MisconfiguredAsDx4(state.localSidTable.R6 ?? []) }, fault: { reason: "R6's service SID (function 0x13) is bound to End.DX4/CE4-A instead of End.DT4/VRF-CUST4 — decapsulation succeeds, but the exposed IPv4 packet is cross-connected to a fixed adjacency instead of routed." } }, events: [] }),
    whatChanged: () => ["R6's Local SID Table entry rebound: End.DT4/VRF-CUST4 → End.DX4/CE4-A (misconfigured) — the SID's IPv6 value is untouched"],
  },
  {
    id: "fault-send",
    label: "Resend Toward 10.10.2.8",
    narrative: "Resend the same, previously-working customer packet: inner IPv4 dst 10.10.2.8, toward the same service SID.",
    run: (state) => ({ state: { ...state, packet: buildEndpointPacket([R6_DT4], ipv4Inner("10.10.2.8")), packetAt: "R1", journey: [], highLevelOrder: [R6_DT4] }, events: [] }),
  },
  {
    id: "fault-transit-healthy",
    label: "R1 → R2 → R3 → R6: Everything Below Is Fine",
    narrative: "Headend encapsulation, IGP forwarding, locator reachability, the local SID match, the final-segment check, and decapsulation ALL succeed exactly as before.",
    packet: (state) => (state.packet ? endpointPacket("fault-transit", "R1", "R6", "Reaches R6 fine — decapsulation succeeds", "FIB", state.packet) : undefined),
    run: (state) => ({
      state: {
        ...state,
        packetAt: "R6",
        journey: [
          { router: "R1", input: fmtIpv6(state.packet!.outer.daHextets), lookup: "Headend: encapsulate inner IPv4", action: "HEADEND_ENCAPS", output: fmtIpv6(state.packet!.outer.daHextets) },
          { router: "R6", input: fmtIpv6(state.packet!.outer.daHextets), lookup: "Local SID table: MATCH. Final-segment check: passes. Decapsulation: succeeds.", action: "LOCAL_SID_MATCH", output: "Exposed IPv4, dst 10.10.2.8" },
        ],
      },
      events: [],
    }),
  },
  {
    id: "fault-wrong-delivery",
    label: "R6: Delivered To The WRONG CE",
    narrative: `The SID is now bound to End.DX4 — a FIXED adjacency, CE4-A. Regardless of the customer destination (10.10.2.8, which belongs to CE4-B's prefix), End.DX4 sends it to CE4-A. VRF-CUST4 is never consulted.`,
    packet: (state) => (state.packet ? endpointPacket("fault-wrong", "R6", "CE4-A", "End.DX4 (misconfigured) — WRONG CE, no VRF lookup", "DECAP", state.packet) : undefined),
    run: (state) => {
      const entry = findEntry(state, "R6", FUNCTION.END_DX4);
      const outcome = processSrv6EndpointBehavior(entry, state.packet!.outer.daHextets, state.packet!.outer.srh, state.packet!.inner, state.vrfs);
      return { state: { ...state, journey: [...state.journey, { router: "R6", input: "10.10.2.8", lookup: "End.DX4 (misconfigured): decapsulate, cross-connect to FIXED adjacency CE4-A — VRF-CUST4 never consulted", action: "DECAP_IPV4", output: `Delivered to ${outcome.ceTarget} — WRONG, should be CE4-B` }] }, events: [] };
    },
    whatChanged: () => ["Traffic for 10.10.2.8 reached CE4-A instead of CE4-B — VRF-CUST4's 10.10.2.0/24 → CE4-B route was never consulted"],
  },
  {
    id: "final-segment-dt4-experiment",
    label: "Standards Validation Aside",
    narrative: "Separately from this incident: recall from earlier that sending a service SID with Segments Left ≠ 0 is rejected outright (INVALID_FINAL_SEGMENT) — that's a different failure mode from this one. Here, the final-segment check PASSES; the bound behavior itself is simply wrong.",
  },

  // === 15. Engineer Challenge (repair the fault) ===================================
  {
    id: "repair-challenge",
    label: "Engineer Challenge — Repair The Service Binding",
    narrative: "Choose the correct repair to restore End.DT4/VRF-CUST4 delivery to CE4-B.",
    action: (state, payload) => {
      const choice = typeof payload === "object" && payload !== null && "choice" in payload ? String((payload as { choice: string }).choice) : "";
      const correct = choice === "rebind-dt4";
      return { state: { ...state, troubleshooting: { ...state.troubleshooting, repairAttempt: { choice, correct } } }, events: [] };
    },
    requiresState: (state) => state.troubleshooting.repairAttempt?.correct === true,
  },
  {
    id: "repair-applied",
    label: "R6's Service SID Rebound",
    narrative: `Rebind the SID: End.DX4/CE4-A → End.DT4/VRF-CUST4. The SID's IPv6 value (${sidTextFor("R6", FUNCTION.END_DT4)}) never changed.`,
    run: (state) => ({ state: { ...state, localSidTable: { ...state.localSidTable, R6: withDt4Restored(state.localSidTable.R6 ?? []) }, fault: undefined }, events: [] }),
    whatChanged: () => ["R6's Local SID Table: service SID rebound to End.DT4 / VRF-CUST4"],
  },
  {
    id: "repaired-resend",
    label: "Mandatory Resend",
    narrative: "Rebinding the table entry alone doesn't complete the repair — resend the SAME customer packet (dst 10.10.2.8) and verify it end to end.",
    run: (state) => ({ state: { ...state, packet: buildEndpointPacket([R6_DT4], ipv4Inner("10.10.2.8")), packetAt: "R1", journey: [], highLevelOrder: [R6_DT4] }, events: [] }),
  },
  {
    id: "repaired-transit",
    label: "R1 → R2 → R3 → R6",
    narrative: "Same headend encapsulation and IGP forwarding as always — nothing here ever needed fixing.",
    packet: (state) => (state.packet ? endpointPacket("repaired-transit", "R1", "R6", "Headend encaps + IPv6 FIB forward", "FIB", state.packet) : undefined),
    run: (state) => ({
      state: {
        ...state,
        packetAt: "R6",
        journey: [{ router: "R1", input: fmtIpv6(state.packet!.outer.daHextets), lookup: "Headend: encapsulate inner IPv4", action: "HEADEND_ENCAPS", output: fmtIpv6(state.packet!.outer.daHextets) }],
      },
      events: [],
    }),
  },
  {
    id: "repaired-deliver",
    label: "R6: End.DT4 — VRF-CUST4 Lookup → CE4-B",
    narrative: "Decapsulate, associate with VRF-CUST4, look up 10.10.2.8 → matches 10.10.2.0/24 → CE4-B. Repair verified end to end with a real resend, not merely \"binding restored.\"",
    packet: (state) => (state.packet ? endpointPacket("repaired-deliver", "R6", "CE4-B", "Decap + VRF-CUST4 lookup → CE4-B — repair verified", "DECAP", state.packet) : undefined),
    run: (state) => {
      const entry = findEntry(state, "R6", FUNCTION.END_DT4);
      const outcome = processSrv6EndpointBehavior(entry, state.packet!.outer.daHextets, state.packet!.outer.srh, state.packet!.inner, state.vrfs);
      return { state: { ...state, troubleshooting: { ...state.troubleshooting, correctVerified: true }, journey: [...state.journey, { router: "R6", input: "10.10.2.8", lookup: `VRF-CUST4: IPv4 lookup → ${outcome.ceTarget}`, action: "DECAP_IPV4", output: `Delivered to ${outcome.ceTarget} — repair verified` }] }, events: [] };
    },
    whatChanged: () => ["Delivered to CE4-B via a real VRF-CUST4 route lookup — repair verified with a real resend, not a flag flip"],
  },

  // === 16. Engineer Challenge: Program The Endpoint ================================
  {
    id: "program-the-endpoint",
    label: "Engineer Challenge — Program The Endpoint",
    narrative: "Four requirements. Pick the correct endpoint behavior for each — every one was already verified with a real packet earlier in this lesson.",
    action: (state, payload) => {
      if (typeof payload !== "object" || payload === null || !("key" in payload) || !("choice" in payload)) return { state, events: [] };
      const key = String((payload as { key: string }).key) as ChallengeKey;
      const choice = String((payload as { choice: string }).choice);
      const correctFor: Record<ChallengeKey, string> = { a: "END_X", b: "END_DT4", c: "END_DX6", d: "END_DX2" };
      const correct = choice === correctFor[key];
      return { state: { ...state, challenge: { answers: { ...state.challenge.answers, [key]: { choice, correct } } } }, events: [] };
    },
    requiresState: (state) => (["a", "b", "c", "d"] as ChallengeKey[]).every((k) => state.challenge.answers[k]?.correct === true),
  },
  {
    id: "challenge-verified",
    label: "Challenge Verified — Real Packets, Not Just Answers",
    narrative: "A: End.X forced traffic through R3→R4→R5→R6 (Policy B, verified earlier). B: End.DT4 routed 10.10.2.8 to CE4-B via VRF-CUST4 (verified earlier and again in the repair). C: End.DX6 cross-connected the exposed IPv6 packet straight to CE6 with no tenant lookup (verified earlier). D: End.DX2 cross-connected the Ethernet frame straight to CE-L2 with no MAC-table lookup (verified earlier). Every requirement traces back to a real, already-run packet in this lesson.",
  },

  // === 17. Completion ===============================================================
  {
    id: "engineer-challenge-complete",
    label: "Engineer Challenge Complete",
    narrative: "You built a richer Local SID Table with real behavior parameters, traced End, End.X, and End.T against the identical next segment, walked the full decapsulation family (DX6, DX4, DT6, DT4, DX2) with real payload/final-segment validation, diagnosed a DX-vs-DT service-binding fault, and repaired it with a verified resend.",
  },
  {
    id: "complete",
    label: "Lesson Complete",
    narrative: "The SID gets the packet to an instruction; the endpoint behavior defines what that instruction actually does. That's the whole lesson.",
  },
];

export const STEP_IDX = {
  taxonomyIntro: stepIdx(srv6EndpointSteps, "taxonomy-intro"),
  richerLocalSidTable: stepIdx(srv6EndpointSteps, "richer-local-sid-table"),
  endVsEndxComparison: stepIdx(srv6EndpointSteps, "signature-end-vs-endx"),
  endtIntro: stepIdx(srv6EndpointSteps, "endt-intro"),
  outerInnerModel: stepIdx(srv6EndpointSteps, "outer-inner-packet-model"),
  behaviorComparisonIntro: stepIdx(srv6EndpointSteps, "behavior-comparison-intro"),
  troubleshootingIntro: stepIdx(srv6EndpointSteps, "troubleshooting-intro"),
  repairChallenge: stepIdx(srv6EndpointSteps, "repair-challenge"),
  programTheEndpoint: stepIdx(srv6EndpointSteps, "program-the-endpoint"),
  dxVsDtVisual: stepIdx(srv6EndpointSteps, "dx-vs-dt-visual"),
  endpointFlavorsPreview: stepIdx(srv6EndpointSteps, "endpoint-flavors-preview"),
};

function stepIdx(steps: ScenarioStep<Srv6EndpointState>[], id: string): number {
  return steps.findIndex((s) => s.id === id);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export interface CliOutput {
  cmd: string;
  output: string;
}
export interface CliCommandEntry {
  id: string;
  label: string;
  concept?: string;
  cisco: CliOutput;
  juniper: CliOutput;
}

export function buildEndpointCliCommands(state: Srv6EndpointState, router: RouterId): CliCommandEntry[] {
  const entries = state.localSidTable[router] ?? [];
  const localSidEntry: CliCommandEntry = {
    id: "local-sid",
    label: "local sid table",
    concept: entries.length ? `${router} has instantiated ${entries.length} local SID${entries.length > 1 ? "s" : ""}: ${entries.map((e) => `${e.sidText} (${BEHAVIOR_LABEL[e.behavior]})`).join(", ")}.` : `${router} has no local SIDs instantiated right now.`,
    cisco: { cmd: "show segment-routing srv6 sid", output: entries.length ? entries.map((e) => `SID: ${e.sidText}\nBehavior: ${BEHAVIOR_LABEL[e.behavior]}\nParameter: ${e.parameterText}`).join("\n---\n") : "% No local SIDs instantiated" },
    juniper: { cmd: "show route table srv6-sid.0 detail", output: entries.length ? entries.map((e) => `${e.sidText}  ${BEHAVIOR_LABEL[e.behavior]}  ${e.parameterText}`).join("\n") : "(empty)" },
  };
  const packetEntry: CliCommandEntry = {
    id: "packet",
    label: "packet / srh",
    concept: state.packet ? `Current packet: outer DA = ${fmtIpv6(state.packet.outer.daHextets)}${state.packet.outer.srh ? `, Segments Left = ${state.packet.outer.srh.segmentsLeft}` : ", no SRH"}${state.packet.inner ? `, inner = ${state.packet.inner.kind}` : ""}.` : "No packet in flight right now.",
    cisco: { cmd: "show ipv6 route <destination> detail", output: state.packet ? `Outer DA: ${fmtIpv6(state.packet.outer.daHextets)}\n${state.packet.outer.srh ? `SRH: SL=${state.packet.outer.srh.segmentsLeft}` : "SRH: not present"}` : "% No active packet" },
    juniper: { cmd: "show route table inet6.0 extensive", output: state.packet ? fmtIpv6(state.packet.outer.daHextets) : "(no route)" },
  };
  return [localSidEntry, packetEntry];
}
