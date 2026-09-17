import type { PacketLayer, PacketVisual, ScenarioStep } from "../types";
import { buildSrv6Sid, fmtIpv6, functionHexText, hextetsEqual, type Hextets } from "./srv6Foundations";
import { BEHAVIOR_LABEL, FUNCTION, ipv4InPrefix, type InnerPayload, type Srv6EndpointBehavior } from "./srv6EndpointBehaviors";

/**
 * SRv6 L3VPN (RFC 9252 — BGP Overlay Services Based on SRv6; RFC 4364
 * BGP/MPLS IP VPNs; RFC 8950 IPv4/VPN-IPv4 NLRI with an IPv6 next hop;
 * RFC 4659 IPv6 VPN). Follows SRv6 Traffic Engineering / SR Policy.
 * Central question: an MPLS-style BGP L3VPN still needs a VRF, an RD,
 * a Route Target policy, and an MP-BGP VPN route — none of that goes
 * away. What changes is the egress SERVICE/DATA-PLANE instruction:
 * instead of an MPLS VPN label, PE2 advertises a real SRv6 Service SID
 * (bound to a per-VRF End.DT4/End.DT6 behavior) inside a BGP Prefix-SID
 * Attribute's SRv6 L3 Service TLV. Reachability toward that Service SID
 * is a SEPARATE question from ordinary BGP next-hop reachability — the
 * whole troubleshooting arc in this lesson exists to make that concrete.
 *
 * Topology (RR1 is a control-plane-only overlay spliced in by this
 * lesson's own integration adapter, `app/demo/srv6-l3vpn/rrIntegration.ts`
 * — never a member of this file's own RouterId/state, per the project's
 * cross-lesson-integration convention):
 *
 *                              RR1 (MP-BGP only)
 *                            /                \
 *   CE1 ── PE1 ── P1 ── P2 ── PE2 ── CE2
 *                               \
 *                                └── CE3
 *
 * Reuse decisions (checked against `srv6Foundations.ts` and
 * `srv6EndpointBehaviors.ts` before writing anything new):
 *   - `buildSrv6Sid` / `fmtIpv6` / `functionHexText` / `hextetsEqual` —
 *     fully generic SID/format helpers, reused directly.
 *   - `FUNCTION.END_DT4` (0x13) / `FUNCTION.END_DT6` (0x12) — the SAME
 *     numeric function-id allocations as SRv6 Endpoint Behaviors, so
 *     this lesson's Service SIDs never redefine what those function
 *     values mean. `BEHAVIOR_LABEL` and the `Srv6EndpointBehavior`
 *     string union are reused for the same reason. (0x14/End.DT46
 *     stays reserved/preview-only, exactly as in that file.)
 *   - `ipv4InPrefix` — the exact IPv4-prefix-match predicate, reused
 *     directly for CUST-A's IPv4 VRF lookup (End.DT4).
 *   - What is NOT literally reused: `processSrv6EndpointBehavior`,
 *     `Vrf`/`VrfName` ("VRF-CUST6"|"VRF-CUST4"), and `SegmentRoutingHeader`/
 *     `SrhSegment` (whose `ownerRouter` is typed to Endpoint Behaviors'
 *     own closed R1-R6 `RouterId`). This lesson is a genuinely different
 *     topology (CE1/PE1/P1/P2/PE2/CE2/CE3, not R1-R6), so widening those
 *     shared types to fit a new VRF name or router set would either
 *     require editing that lesson's own file (real regression risk) or
 *     an unsafe type cast — neither is "safe reuse" per the project's
 *     own no-cross-lesson-type-coupling rule. Instead, the RFC 8986
 *     End.DT4/End.DT6 ALGORITHM (final-segment check → payload-kind
 *     check → decapsulate → per-family VRF lookup) is restated here,
 *     small and locally typed, exactly the way EVPN built its own
 *     route table instead of forcing MPLS L3VPN's VpnRouteViewer shape.
 *
 * Scope: one customer (CUST-A), dual-stack (IPv4 + IPv6), one explicit
 * export/import RT (no RD/RT conflation, no second customer — unlike
 * MPLS L3VPN this lesson does not need an overlapping-address-space
 * illustration, the SRv6-specific idea is Service SID sharing instead).
 * One fault: PE2's SRv6 locator route withdrawn while its BGP
 * infrastructure loopback stays reachable. Explicitly deferred (preview
 * only, never instantiated): End.DT46, SID transposition, BGP Color
 * steering / a full SR Policy control plane, inter-AS Option A/B/C,
 * Carrier Supporting Carrier, EVPN, SRv6 VPN multihoming, uSID, SRv6
 * TI-LFA, SRv6 protection.
 */

// ---------------------------------------------------------------------------
// Topology
// ---------------------------------------------------------------------------

export type RouterId = "CE1" | "PE1" | "P1" | "P2" | "PE2" | "CE2" | "CE3";
export const PE_ROUTERS: RouterId[] = ["PE1", "PE2"];
export const P_ROUTERS: RouterId[] = ["P1", "P2"];
export const CE_ROUTERS: RouterId[] = ["CE1", "CE2", "CE3"];

export type LinkId = "CE1-PE1" | "PE1-P1" | "P1-P2" | "P2-PE2" | "PE2-CE2" | "PE2-CE3";
export interface LinkDef {
  id: LinkId;
  a: RouterId;
  b: RouterId;
  metric: number;
}
export const LINKS: LinkDef[] = [
  { id: "CE1-PE1", a: "CE1", b: "PE1", metric: 1 },
  { id: "PE1-P1", a: "PE1", b: "P1", metric: 10 },
  { id: "P1-P2", a: "P1", b: "P2", metric: 10 },
  { id: "P2-PE2", a: "P2", b: "PE2", metric: 10 },
  { id: "PE2-CE2", a: "PE2", b: "CE2", metric: 1 },
  { id: "PE2-CE3", a: "PE2", b: "CE3", metric: 1 },
];

export const GRAPH_NODES = [
  { id: "CE1", label: "CE1", x: 4, y: 50, subLabel: "10.10.1.0/24" },
  { id: "PE1", label: "PE1", x: 22, y: 50, subLabel: "VRF CUST-A" },
  { id: "P1", label: "P1", x: 40, y: 50, subLabel: "IPv6 core" },
  { id: "P2", label: "P2", x: 58, y: 50, subLabel: "IPv6 core" },
  { id: "PE2", label: "PE2", x: 76, y: 50, subLabel: "VRF CUST-A" },
  { id: "CE2", label: "CE2", x: 94, y: 35, subLabel: "10.20.1.0/24" },
  { id: "CE3", label: "CE3", x: 94, y: 65, subLabel: "10.20.2.0/24" },
];
export const GRAPH_EDGES = [
  { id: "CE1-PE1", a: "CE1", b: "PE1" },
  { id: "PE1-P1", a: "PE1", b: "P1", label: "IPv6/SRv6 core" },
  { id: "P1-P2", a: "P1", b: "P2", label: "IPv6/SRv6 core" },
  { id: "P2-PE2", a: "P2", b: "PE2", label: "IPv6/SRv6 core" },
  { id: "PE2-CE2", a: "PE2", b: "CE2" },
  { id: "PE2-CE3", a: "PE2", b: "CE3" },
];
export const GRAPH_REGIONS = [{ id: "srv6-core", label: "IPv6/SRv6 Provider Core", x: 16, y: 30, width: 68, height: 40, tone: "cyan" as const }];

export function linkIdBetween(a: RouterId, b: RouterId, links: LinkDef[] = LINKS): LinkId | undefined {
  return links.find((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a))?.id;
}

export const TERMS: { term: string; expansion: string; meaning: string }[] = [
  { term: "VRF", expansion: "Virtual Routing & Forwarding", meaning: "A separate routing table per customer on the same PE. SRv6 does not remove this — CUST-A still gets its own table." },
  { term: "RD", expansion: "Route Distinguisher", meaning: "Makes otherwise-identical VPN prefixes unique in MP-BGP. Does not control import — unchanged from MPLS L3VPN." },
  { term: "RT", expansion: "Route Target", meaning: "Controls which VRFs import/export a VPN route. Still the only thing import policy checks." },
  { term: "Service SID", expansion: "SRv6 Service Segment ID", meaning: "An IPv6 address bound to an endpoint behavior (End.DT4/End.DT6) at the egress PE — replaces the MPLS VPN label as the egress service instruction." },
  { term: "BGP Next Hop", expansion: "IPv6 BGP Next Hop", meaning: "Tracks the egress PE's BGP/route reachability. NOT the same field as the Service SID, and reachable next-hop does not imply resolvable Service SID." },
];

// ---------------------------------------------------------------------------
// IPv6 underlay — infrastructure loopback (BGP next-hop identity) kept
// deliberately separate from each PE's SRv6 locator (Service SID
// reachability), so the troubleshooting lesson can withdraw one while
// keeping the other healthy.
// ---------------------------------------------------------------------------

export const INFRA_LOOPBACK: Partial<Record<RouterId, string>> = {
  PE1: "2001:db8:ffff::1",
  P1: "2001:db8:ffff::11",
  P2: "2001:db8:ffff::12",
  PE2: "2001:db8:ffff::2",
};
const LOCATOR_HEXTETS4: Partial<Record<RouterId, [number, number, number, number]>> = {
  PE1: [0x2001, 0x0db8, 0x0100, 0x0001],
  PE2: [0x2001, 0x0db8, 0x0100, 0x0002],
  P1: [0x2001, 0x0db8, 0x0100, 0x0011], // advanced SR-Policy-preview only — see §SR-Policy-integration below
};
export const LOCATOR_PREFIX: Partial<Record<RouterId, string>> = {
  PE1: "2001:db8:100:1::/64",
  PE2: "2001:db8:100:2::/64",
};
function sidFor(router: RouterId, functionValue: number): Hextets {
  return buildSrv6Sid(LOCATOR_HEXTETS4[router]!, functionValue);
}

// ---------------------------------------------------------------------------
// VRF / RD / RT (RFC 4364) — deliberately one customer, one RT, so
// nothing here is ever confused with the different job of the Service
// SID below.
// ---------------------------------------------------------------------------

export type VrfName = "CUST-A";
export interface VrfDef {
  name: VrfName;
  exportRt: string;
  importRt: string;
}
export function createVrf(name: VrfName, exportRt: string, importRt: string): VrfDef {
  return { name, exportRt, importRt };
}

export const CUST_A_RD: Partial<Record<RouterId, string>> = { PE1: "65000:1", PE2: "65000:2" };
export const CUST_A_EXPORT_RT = "65000:100";
export const CUST_A_IMPORT_RT = "65000:100";
/** Never used in the main narrative state — only inside the read-only RT-mismatch lab (§55). */
export const CUST_A_WRONG_RT = "65000:999";
export const CUST_A_VRF: VrfDef = createVrf("CUST-A", CUST_A_EXPORT_RT, CUST_A_IMPORT_RT);

// ---------------------------------------------------------------------------
// Customer routes — dual-stack, PE2 deliberately owns TWO remote IPv4
// prefixes (CE2, CE3) and two remote IPv6 prefixes, so they can later
// share exactly one per-VRF Service SID each.
// ---------------------------------------------------------------------------

export interface CustomerRoute {
  family: "IPV4" | "IPV6";
  prefix: string;
  prefixHextets?: Hextets;
  prefixLength?: number; // bits, IPv6 only
  ce: RouterId;
}

export const CE1_IPV4_PREFIX = "10.10.1.0/24";
export const CE2_IPV4_PREFIX = "10.20.1.0/24";
export const CE3_IPV4_PREFIX = "10.20.2.0/24";
export const CE1_HOST_IPV4 = "10.10.1.10";
export const CE2_HOST_IPV4 = "10.20.1.10";
export const CE3_HOST_IPV4 = "10.20.2.10";

export const CE1_IPV6_HEXTETS: Hextets = [0x2001, 0x0db8, 0x00ca, 0x0010, 0, 0, 0, 0];
export const CE2_IPV6_HEXTETS: Hextets = [0x2001, 0x0db8, 0x00ca, 0x0020, 0, 0, 0, 0];
export const CE3_IPV6_HEXTETS: Hextets = [0x2001, 0x0db8, 0x00ca, 0x0030, 0, 0, 0, 0];
export const CE1_HOST_IPV6: Hextets = [0x2001, 0x0db8, 0x00ca, 0x0010, 0, 0, 0, 0xa];
export const CE2_HOST_IPV6: Hextets = [0x2001, 0x0db8, 0x00ca, 0x0020, 0, 0, 0, 0xa];
export const CE3_HOST_IPV6: Hextets = [0x2001, 0x0db8, 0x00ca, 0x0030, 0, 0, 0, 0xa];

export const PE1_LOCAL_ROUTES: CustomerRoute[] = [
  { family: "IPV4", prefix: CE1_IPV4_PREFIX, ce: "CE1" },
  { family: "IPV6", prefix: "2001:db8:ca:10::/64", prefixHextets: CE1_IPV6_HEXTETS, prefixLength: 64, ce: "CE1" },
];
export const PE2_LOCAL_ROUTES: CustomerRoute[] = [
  { family: "IPV4", prefix: CE2_IPV4_PREFIX, ce: "CE2" },
  { family: "IPV4", prefix: CE3_IPV4_PREFIX, ce: "CE3" },
  { family: "IPV6", prefix: "2001:db8:ca:20::/64", prefixHextets: CE2_IPV6_HEXTETS, prefixLength: 64, ce: "CE2" },
  { family: "IPV6", prefix: "2001:db8:ca:30::/64", prefixHextets: CE3_IPV6_HEXTETS, prefixLength: 64, ce: "CE3" },
];

function ipv6PrefixMatch(dstHextets: Hextets, prefixHextets: Hextets, prefixLength: number): boolean {
  const n = Math.ceil(prefixLength / 16);
  return prefixHextets.slice(0, n).every((v, i) => v === dstHextets[i]);
}
export function lookupVrfRouteIpv4(routes: CustomerRoute[], dstIp: string): CustomerRoute | undefined {
  return routes.filter((r) => r.family === "IPV4").find((r) => ipv4InPrefix(dstIp, r.prefix));
}
export function lookupVrfRouteIpv6(routes: CustomerRoute[], dstHextets: Hextets): CustomerRoute | undefined {
  return routes.filter((r) => r.family === "IPV6" && r.prefixHextets && r.prefixLength).find((r) => ipv6PrefixMatch(dstHextets, r.prefixHextets!, r.prefixLength!));
}

// ---------------------------------------------------------------------------
// SRv6 Service SIDs (RFC 8986 End.DT4/End.DT6, RFC 9252 §a service model)
// — per-VRF, so BOTH of a PE's local prefixes of the same family always
// share the exact same Service SID (§14/§34's flagship demonstration).
// ---------------------------------------------------------------------------

export type Srv6ServiceBehavior = Extract<Srv6EndpointBehavior, "END_DT4" | "END_DT6">;
export interface Srv6ServiceSid {
  sidHextets: Hextets;
  sidText: string;
  owner: RouterId;
  behavior: Srv6ServiceBehavior;
  vrf: VrfName;
}
export function allocateServiceSid(owner: RouterId, behavior: Srv6ServiceBehavior, vrf: VrfName): Srv6ServiceSid {
  const functionValue = behavior === "END_DT4" ? FUNCTION.END_DT4 : FUNCTION.END_DT6;
  const sidHextets = sidFor(owner, functionValue);
  return { sidHextets, sidText: fmtIpv6(sidHextets), owner, behavior, vrf };
}

export const PE2_DT4_SID = allocateServiceSid("PE2", "END_DT4", "CUST-A");
export const PE2_DT6_SID = allocateServiceSid("PE2", "END_DT6", "CUST-A");
export const PE1_DT4_SID = allocateServiceSid("PE1", "END_DT4", "CUST-A");
export const PE1_DT6_SID = allocateServiceSid("PE1", "END_DT6", "CUST-A");
/** 0x14 stays reserved for End.DT46 exactly as in Endpoint Behaviors — preview only, never instantiated. */
export const END_DT46_RESERVED_FUNCTION = 0x14;

export function localSidTableFor(router: RouterId): Srv6ServiceSid[] {
  if (router === "PE1") return [PE1_DT4_SID, PE1_DT6_SID];
  if (router === "PE2") return [PE2_DT4_SID, PE2_DT6_SID];
  return [];
}
export function findServiceSidByHextets(router: RouterId, daHextets: Hextets): Srv6ServiceSid | undefined {
  return localSidTableFor(router).find((s) => hextetsEqual(s.sidHextets, daHextets));
}

// ---------------------------------------------------------------------------
// BGP Prefix-SID Attribute / SRv6 L3 Service TLV (RFC 9252 §2) — modeled
// with enough anatomy to be memorable without every sub-sub-TLV.
// ---------------------------------------------------------------------------

export interface Srv6L3ServiceTlv {
  type: 5; // RFC 9252: SRv6 L3 Service TLV
  serviceSid: Srv6ServiceSid;
}
export interface BgpPrefixSidAttribute {
  l3Service: Srv6L3ServiceTlv;
}

// ---------------------------------------------------------------------------
// VPN route — an IPv4 or IPv6 customer prefix carried as one MP-BGP
// route, built up field by field (mirrors the MPLS L3VPN lesson's own
// build-the-route pacing) so RD/RT/next-hop/Service-SID are each their
// own explicit step rather than one opaque object appearing all at once.
// ---------------------------------------------------------------------------

export interface VpnRoute {
  family: "IPV4" | "IPV6";
  prefix: string;
  prefixHextets?: Hextets;
  prefixLength?: number;
  originPe: RouterId;
  rd?: string;
  rt?: string;
  bgpNextHop?: string;
  prefixSid?: BgpPrefixSidAttribute;
}
export function createVpnRouteFromCustomerRoute(customerRoute: CustomerRoute, originPe: RouterId): VpnRoute {
  return { family: customerRoute.family, prefix: customerRoute.prefix, prefixHextets: customerRoute.prefixHextets, prefixLength: customerRoute.prefixLength, originPe };
}
export function attachRd(route: VpnRoute, rd: string): VpnRoute {
  return { ...route, rd };
}
export function attachRouteTargets(route: VpnRoute, rt: string): VpnRoute {
  return { ...route, rt };
}
export function attachBgpNextHop(route: VpnRoute, nextHop: string): VpnRoute {
  return { ...route, bgpNextHop: nextHop };
}
/** RFC 9252 §2: attaches the Service SID via the Prefix-SID Attribute's SRv6 L3 Service TLV — never as an ordinary VPN label field. */
export function attachSrv6ServiceSid(route: VpnRoute, serviceSid: Srv6ServiceSid): VpnRoute {
  return { ...route, prefixSid: { l3Service: { type: 5, serviceSid } } };
}
export function exportVpnRoute(customerRoute: CustomerRoute, originPe: RouterId, rd: string, rt: string, nextHop: string, serviceSid: Srv6ServiceSid): VpnRoute {
  let route = createVpnRouteFromCustomerRoute(customerRoute, originPe);
  route = attachRd(route, rd);
  route = attachRouteTargets(route, rt);
  route = attachBgpNextHop(route, nextHop);
  route = attachSrv6ServiceSid(route, serviceSid);
  return route;
}

// ---------------------------------------------------------------------------
// Route lifecycle — RECEIVED, RT-imported, BGP-next-hop-resolved, and
// Service-SID-resolved are four INDEPENDENT stages (never one collapsed
// boolean): a route can be received without being imported, imported
// without its Service SID being resolvable, and so on. `installed`
// requires all three checks to pass.
// ---------------------------------------------------------------------------

export interface RtImportResult {
  evaluated: true;
  passed: boolean;
  reason: string;
}
export function evaluateRtImport(route: VpnRoute, importRt: string): RtImportResult {
  const passed = route.rt === importRt;
  return { evaluated: true, passed, reason: passed ? `Route Target ${route.rt} matches CUST-A's import RT ${importRt}.` : `Route Target ${route.rt ?? "(none)"} does not match CUST-A's import RT ${importRt}.` };
}

export interface BgpNextHopResolution {
  resolvable: boolean;
  reason: string;
}
export function resolveBgpNextHop(nextHop: string, infraReachable: boolean): BgpNextHopResolution {
  return { resolvable: infraReachable, reason: infraReachable ? `${nextHop} is reachable via the IPv6 underlay IGP — ordinary infrastructure routing, unrelated to any SRv6 locator.` : `${nextHop} is unreachable.` };
}

export interface ServiceSidResolution {
  resolvable: boolean;
  reason: string;
}
/** RFC 9252: the ingress PE must have usable SRv6 forwarding toward the Service SID — a locator-route question, not a BGP-next-hop question. */
export function resolveServiceSid(serviceSid: Srv6ServiceSid, locatorReachable: boolean): ServiceSidResolution {
  const locatorPrefix = LOCATOR_PREFIX[serviceSid.owner] ?? "(unknown locator)";
  return {
    resolvable: locatorReachable,
    reason: locatorReachable
      ? `${serviceSid.owner}'s locator ${locatorPrefix} is present in the IPv6 FIB — ${serviceSid.sidText} resolves through it.`
      : `${serviceSid.owner}'s locator ${locatorPrefix} is NOT in the IPv6 FIB — ${serviceSid.sidText} cannot be resolved, even though the BGP next hop is fine.`,
  };
}

export function evaluateVpnRouteEligibility(rtImport: RtImportResult | undefined, bgpNextHop: BgpNextHopResolution | undefined, serviceSidRes: ServiceSidResolution | undefined): boolean {
  return !!rtImport?.passed && !!bgpNextHop?.resolvable && !!serviceSidRes?.resolvable;
}

export interface ImportProgress {
  route: VpnRoute;
  received: boolean;
  rtImport?: RtImportResult;
  bgpNextHop?: BgpNextHopResolution;
  serviceSidResolution?: ServiceSidResolution;
  installed: boolean;
}
export function importVpnRoute(route: VpnRoute, importRt: string): ImportProgress {
  return { route, received: true, rtImport: evaluateRtImport(route, importRt), installed: false };
}
export function installVpnRoute(progress: ImportProgress, infraReachable: boolean, locatorReachable: boolean): ImportProgress {
  const bgpNextHop = resolveBgpNextHop(progress.route.bgpNextHop!, infraReachable);
  const serviceSidResolution = resolveServiceSid(progress.route.prefixSid!.l3Service.serviceSid, locatorReachable);
  const installed = evaluateVpnRouteEligibility(progress.rtImport, bgpNextHop, serviceSidResolution);
  return { ...progress, bgpNextHop, serviceSidResolution, installed };
}

// ---------------------------------------------------------------------------
// Data plane — outer IPv6 (Service SID as DA) + inner customer payload.
// No transport label, no VPN label: the ONE Service SID is both "how do
// I reach PE2" (via ordinary IPv6 FIB toward its locator) AND "what do
// I do once there" (End.DT4/End.DT6). A baseline shortest-path packet
// carries NO Segment Routing Header at all — one segment needs no list.
// ---------------------------------------------------------------------------

export interface SrhSegment {
  index: number;
  sidHextets: Hextets;
  sidText: string;
  ownerRouter: RouterId;
}
export interface SegmentRoutingHeader {
  nextHeader: string;
  hdrExtLen: number;
  routingType: 4;
  segmentsLeft: number;
  lastEntry: number;
  flags: string;
  tag: number;
  segmentList: SrhSegment[];
}
export interface OuterIpv6State {
  srcText: string;
  daHextets: Hextets;
  srh?: SegmentRoutingHeader;
}
export interface L3vpnPacketState {
  outer: OuterIpv6State;
  inner?: InnerPayload;
}

export const PE1_SR_SOURCE = "2001:db8:100:1:0:0:0:c1";
export const PE2_SR_SOURCE = "2001:db8:100:2:0:0:0:c2";

/** RFC 9252 baseline: single Service SID, no SRH — never a synthetic empty one. */
export function encapsulateSrv6VpnPacket(serviceSid: Srv6ServiceSid, inner: InnerPayload, srcText: string): L3vpnPacketState {
  return { outer: { srcText, daHextets: serviceSid.sidHextets }, inner };
}

/** RFC 8986 §4.16-adjacent invariant, restated locally because this lesson's SRH type carries its own (non-R1..R6) RouterId — the check itself is a one-line equality, not logic worth cross-lesson-coupling for. */
export function validateFinalServicePosition(srh?: SegmentRoutingHeader): boolean {
  return !srh || srh.segmentsLeft === 0;
}

export interface EgressServiceOutcome {
  dropped: boolean;
  reason?: string;
  ceTarget?: RouterId;
  matchedRoute?: CustomerRoute;
  exposedInner?: InnerPayload;
}
/**
 * End.DT4 / End.DT6 execution — decapsulate, then look up the exposed
 * payload in the Service SID's OWN VRF/family table. This restates (does
 * not "reimplement from scratch") the exact RFC 8986 service-behavior
 * algorithm already proven in Endpoint Behaviors' `executeServiceBehavior`
 * (final-segment check → payload-kind check → decap → per-family lookup),
 * typed for this lesson's own CE identifiers instead of forcing an
 * incompatible VrfName through that file's closed union.
 */
export function processEgressServiceSid(serviceSid: Srv6ServiceSid, packet: L3vpnPacketState, ipv4Routes: CustomerRoute[], ipv6Routes: CustomerRoute[]): EgressServiceOutcome {
  if (!validateFinalServicePosition(packet.outer.srh)) {
    return { dropped: true, reason: `${BEHAVIOR_LABEL[serviceSid.behavior]} must be the FINAL segment — Segments Left is ${packet.outer.srh?.segmentsLeft} (must be 0).` };
  }
  if (serviceSid.behavior === "END_DT4") {
    if (!packet.inner || packet.inner.kind !== "IPV4") return { dropped: true, reason: `End.DT4 expects an exposed IPv4 payload — found ${packet.inner?.kind ?? "none"}.` };
    const match = lookupVrfRouteIpv4(ipv4Routes, packet.inner.dstIp);
    return match ? { dropped: false, ceTarget: match.ce, matchedRoute: match, exposedInner: packet.inner } : { dropped: true, reason: `No CUST-A IPv4 route matched ${packet.inner.dstIp}.` };
  }
  if (!packet.inner || packet.inner.kind !== "IPV6") return { dropped: true, reason: `End.DT6 expects an exposed IPv6 payload — found ${packet.inner?.kind ?? "none"}.` };
  const match = lookupVrfRouteIpv6(ipv6Routes, packet.inner.dstHextets);
  return match ? { dropped: false, ceTarget: match.ce, matchedRoute: match, exposedInner: packet.inner } : { dropped: true, reason: `No CUST-A IPv6 route matched ${fmtIpv6(packet.inner.dstHextets)}.` };
}

function ipv4Inner(srcIp: string, dstIp: string): InnerPayload {
  return { kind: "IPV4", srcIp, dstIp };
}
function ipv6Inner(srcHextets: Hextets, dstHextets: Hextets): InnerPayload {
  return { kind: "IPV6", srcHextets, dstHextets };
}

// ---------------------------------------------------------------------------
// Journey / packet visuals
// ---------------------------------------------------------------------------

export type L3vpnAction = "VRF_LOOKUP" | "SRV6_ENCAPSULATE" | "IPV6_FIB_FORWARD" | "LOCAL_SID_MATCH" | "SERVICE_DECAP" | "EGRESS_VRF_LOOKUP" | "DELIVER" | "DROP";
export interface JourneyHop {
  router: RouterId;
  input: string;
  lookup: string;
  action: L3vpnAction;
  output: string;
}

function outerIpv6Layer(pkt: L3vpnPacketState): PacketLayer {
  return {
    name: "Outer IPv6 Header",
    color: "var(--pv-proto-ipv6)",
    fields: [
      { label: "Source Address", value: pkt.outer.srcText },
      { label: "Destination Address (Service SID)", value: fmtIpv6(pkt.outer.daHextets) },
    ],
  };
}
function srhLayer(srh: SegmentRoutingHeader): PacketLayer {
  return {
    name: `Segment Routing Header (SL=${srh.segmentsLeft}, LE=${srh.lastEntry})`,
    color: "var(--pv-proto-srh)",
    fields: [{ label: "Segments Left", value: String(srh.segmentsLeft) }, { label: "Last Entry", value: String(srh.lastEntry) }, ...srh.segmentList.map((s) => ({ label: `Segment List[${s.index}]`, value: `${s.sidText} (${s.ownerRouter})` }))],
  };
}
function innerLayer(inner: InnerPayload): PacketLayer {
  if (inner.kind === "IPV4") return { name: "Inner IPv4 Packet", color: "var(--pv-proto-ip)", fields: [{ label: "Source IP", value: inner.srcIp }, { label: "Destination IP", value: inner.dstIp }] };
  if (inner.kind === "IPV6") return { name: "Inner IPv6 Packet", color: "var(--pv-proto-ipv6)", fields: [{ label: "Source Address", value: fmtIpv6(inner.srcHextets) }, { label: "Destination Address", value: fmtIpv6(inner.dstHextets) }] };
  return { name: "Inner Ethernet Frame", color: "var(--pv-border-strong)", fields: [{ label: "Source MAC", value: inner.srcMac }, { label: "Destination MAC", value: inner.dstMac }] };
}
export function buildL3vpnPacketLayers(pkt: L3vpnPacketState): PacketLayer[] {
  return [outerIpv6Layer(pkt), ...(pkt.outer.srh ? [srhLayer(pkt.outer.srh)] : []), ...(pkt.inner ? [innerLayer(pkt.inner)] : [])];
}
function l3vpnPacket(id: string, from: RouterId, to: RouterId, summary: string, badge: string, pkt: L3vpnPacketState): PacketVisual {
  return { id, protocol: "IPV6", from, to, summary, badge, layers: buildL3vpnPacketLayers(pkt) };
}
function ipv4CustomerPacket(id: string, from: RouterId, to: RouterId, summary: string, srcIp: string, dstIp: string): PacketVisual {
  return { id, protocol: "IP", from, to, summary, layers: [{ name: "IPv4", color: "var(--pv-proto-ip)", fields: [{ label: "Source IP", value: srcIp }, { label: "Destination IP", value: dstIp }] }] };
}
function ipv6CustomerPacket(id: string, from: RouterId, to: RouterId, summary: string, srcHextets: Hextets, dstHextets: Hextets): PacketVisual {
  return { id, protocol: "IPV6", from, to, summary, layers: [{ name: "IPv6", color: "var(--pv-proto-ipv6)", fields: [{ label: "Source Address", value: fmtIpv6(srcHextets) }, { label: "Destination Address", value: fmtIpv6(dstHextets) }] }] };
}
function bgpLayer(fields: { label: string; value: string }[]): PacketLayer {
  return { name: "MP-BGP VPN UPDATE", color: "var(--pv-proto-bgp)", fields };
}
function bgpPacket(id: string, from: RouterId, to: RouterId, summary: string, fields: { label: string; value: string }[]): PacketVisual {
  return { id, protocol: "BGP", from, to, summary, badge: "VPN UPDATE", layers: [bgpLayer(fields)] };
}
export function routeToBgpFields(route: VpnRoute): { label: string; value: string }[] {
  return [
    { label: "AFI/SAFI", value: route.family === "IPV4" ? "IPv4 / VPN-IPv4 (RFC 8950)" : "IPv6 / VPN-IPv6 (RFC 4659)" },
    { label: "NLRI (RD:Prefix)", value: `${route.rd}:${route.prefix}` },
    { label: "Extended Community (RT)", value: route.rt ?? "" },
    { label: "NEXT_HOP (IPv6)", value: route.bgpNextHop ?? "" },
    { label: "Prefix-SID Attribute → SRv6 L3 Service TLV (Type 5)", value: route.prefixSid?.l3Service.serviceSid.sidText ?? "" },
    { label: "Endpoint Behavior", value: route.prefixSid ? BEHAVIOR_LABEL[route.prefixSid.l3Service.serviceSid.behavior] : "" },
  ];
}

// ---------------------------------------------------------------------------
// Per-VRF vs. per-CE comparison (§39/§40) — read-only, never mutates
// the main narrative state, mirrors the weighted-segment-list-lab
// pattern from the SR Policy lesson.
// ---------------------------------------------------------------------------

export interface PerVrfVsPerCeResult {
  dt4Ce: RouterId | undefined;
  dx4Ce: RouterId;
}
/** DT4 performs a real per-VRF IPv4 lookup and can select either CE; a CE2-bound DX4 adjacency is fixed and can never select CE3, no matter the destination. */
export function simulatePerVrfVsPerCe(dstIp: string, pe2Ipv4Routes: CustomerRoute[]): PerVrfVsPerCeResult {
  return { dt4Ce: lookupVrfRouteIpv4(pe2Ipv4Routes, dstIp)?.ce, dx4Ce: "CE2" };
}

// ---------------------------------------------------------------------------
// RT-mismatch lab (§55) — contrast with the main fault: here RT import
// itself fails; in the main incident RT import PASSES and Service SID
// resolution is what fails. Read-only, does not mutate main state.
// ---------------------------------------------------------------------------

export interface RtMismatchLabResult {
  received: true;
  rtImport: RtImportResult;
}
export function simulateRtMismatch(route: VpnRoute, exportedRt: string, importRt: string): RtMismatchLabResult {
  return { received: true, rtImport: evaluateRtImport({ ...route, rt: exportedRt }, importRt) };
}

// ---------------------------------------------------------------------------
// Missing-Service-TLV lab (§56) — small, optional, not a second incident.
// ---------------------------------------------------------------------------

export function simulateMissingServiceTlv(): { received: true; reason: string } {
  return { received: true, reason: "The BGP route itself (RD, RT, prefix, next hop) arrives normally, but with no SRv6 L3 Service TLV there is no Service SID to encode — the ingress PE has nothing to build an SRv6 forwarding instruction from, so no service route can be installed in this SRv6-only model." };
}

// ---------------------------------------------------------------------------
// SR Policy service-steering advanced preview (§44/§45) — read-only,
// concise: shortest-path Service SID delivery vs. a policy-steered path
// <P1 End.X, PE2 End.DT4> where the Service SID is still the FINAL
// service instruction. P1's End.X SID exists ONLY for this preview.
// ---------------------------------------------------------------------------

export const P1_ENDX_SID: Hextets = sidFor("P1", FUNCTION.END_X);
export const P1_ENDX_SID_TEXT = fmtIpv6(P1_ENDX_SID);

interface PreviewSeg {
  sidHextets: Hextets;
  sidText: string;
  ownerLabel: RouterId;
}
function previewSeg(sidHextets: Hextets, ownerLabel: RouterId): PreviewSeg {
  return { sidHextets, sidText: fmtIpv6(sidHextets), ownerLabel };
}
/** RFC 8754 reversed-storage-order SRH, restated locally for the same cross-lesson-typing reason as `SegmentRoutingHeader` above. */
function buildPreviewSrh(segments: PreviewSeg[]): SegmentRoutingHeader {
  const n = segments.length;
  const storageOrder = [...segments].reverse();
  const segmentList: SrhSegment[] = storageOrder.map((s, i) => ({ index: i, sidHextets: s.sidHextets, sidText: s.sidText, ownerRouter: s.ownerLabel }));
  return { nextHeader: "IPv4 (H.Encaps)", hdrExtLen: n * 2, routingType: 4, segmentsLeft: n - 1, lastEntry: n - 1, flags: "0x00", tag: 0, segmentList };
}
export function buildPolicySteeredVpnPacket(inner: InnerPayload, srcText: string): L3vpnPacketState {
  // Travel order <S1, ..., Sn> — P1's End.X first (becomes the initial DA), PE2's End.DT4 final —
  // matching buildPreviewSrh's/buildFullSrh's own reversed-storage-order convention (Segment List[0] = Sn).
  const segs: PreviewSeg[] = [previewSeg(P1_ENDX_SID, "P1"), previewSeg(PE2_DT4_SID.sidHextets, "PE2")];
  return { outer: { srcText, daHextets: P1_ENDX_SID, srh: buildPreviewSrh(segs) }, inner };
}
/** P1's topological End.X advance — a one-hop decrement, restated locally (not imported) for the same closed-RouterId reason `validateFinalServicePosition` is. */
export function advancePolicySrh(srh: SegmentRoutingHeader): { newDaHextets: Hextets; newSrh: SegmentRoutingHeader } {
  const segmentsLeft = srh.segmentsLeft - 1;
  return { newDaHextets: srh.segmentList[segmentsLeft].sidHextets, newSrh: { ...srh, segmentsLeft } };
}

// ---------------------------------------------------------------------------
// Top-level scenario state
// ---------------------------------------------------------------------------

export interface TroubleshootingState {
  started: boolean;
  verified: boolean;
}
export interface Srv6L3vpnState {
  links: LinkDef[];
  /** The ONLY fault surface in this lesson: a PE's SRv6 locator route can be withdrawn while its BGP infra loopback stays reachable. Keyed generically even though only PE2 is ever withdrawn. */
  locatorWithdrawn: Partial<Record<RouterId, boolean>>;
  localRoutes: Partial<Record<RouterId, CustomerRoute[]>>;
  /** Every VPN route ever advertised in this lesson, both directions. */
  advertisedRoutes: VpnRoute[];
  /** Receiving PE → its import/installation progress per received route. */
  installedAt: Partial<Record<RouterId, ImportProgress[]>>;
  packet?: L3vpnPacketState;
  packetAt?: RouterId;
  journey: JourneyHop[];
  troubleshooting: TroubleshootingState;
  repairAttempt?: { choice: string; correct: boolean };
}

export function createSrv6L3vpnState(): Srv6L3vpnState {
  return {
    links: LINKS,
    locatorWithdrawn: {},
    localRoutes: { PE1: PE1_LOCAL_ROUTES, PE2: PE2_LOCAL_ROUTES },
    advertisedRoutes: [],
    installedAt: {},
    journey: [],
    troubleshooting: { started: false, verified: false },
  };
}

/** Recomputes every receiving PE's installed routes from `advertisedRoutes` + `locatorWithdrawn` — the single source of truth the fault/repair steps recompute through, never a manually-flipped boolean. */
export function recomputeInstalledRoutes(state: Srv6L3vpnState): Partial<Record<RouterId, ImportProgress[]>> {
  const receivers: RouterId[] = ["PE1", "PE2"];
  const result: Partial<Record<RouterId, ImportProgress[]>> = {};
  for (const receiver of receivers) {
    const existing = state.installedAt[receiver];
    if (!existing) continue;
    result[receiver] = existing.map((progress) => {
      const infraReachable = true; // BGP infra loopbacks are never withdrawn in this lesson
      const locatorReachable = !state.locatorWithdrawn[progress.route.originPe];
      return installVpnRoute(progress, infraReachable, locatorReachable);
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// CLI (concept / Cisco IOS / Juniper) — state-derived only.
// ---------------------------------------------------------------------------

const pad = (s: string, n: number) => s.padEnd(n);

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

export function buildSrv6L3vpnCliCommands(state: Srv6L3vpnState, router: RouterId): CliCommandEntry[] {
  const isPe = router === "PE1" || router === "PE2";
  const local = state.localRoutes[router] ?? [];
  const installed = state.installedAt[router] ?? [];
  const sids = localSidTableFor(router);

  const vrfCisco: CliOutput = { cmd: "show vrf detail CUST-A", output: isPe ? `VRF CUST-A; RD ${CUST_A_RD[router] ?? "-"}\n  Export RT: ${CUST_A_EXPORT_RT}\n  Import RT: ${CUST_A_IMPORT_RT}` : "% VRF CUST-A not configured — P routers carry no customer VRF" };
  const vrfJuniper: CliOutput = { cmd: "show route instance CUST-A", output: isPe ? `CUST-A: RD ${CUST_A_RD[router] ?? "-"}, Type vrf` : "error: no such routing instance" };

  const routeRows = local.map((r) => `${r.family === "IPV4" ? "C" : "C6"}    ${r.prefix} is directly connected, via ${r.ce}`);
  const importedRows = installed.map((p) => `${p.route.family === "IPV4" ? "B" : "B6"}    ${p.route.prefix} [${p.installed ? "200/0" : "inactive"}] via ${p.route.originPe} (rd ${p.route.rd})`);
  const vrfRouteCisco: CliOutput = { cmd: `show ip route vrf CUST-A`, output: isPe ? [...routeRows, ...importedRows].join("\n") || "(no routes)" : "% VRF CUST-A not found" };
  const vrfRouteJuniper: CliOutput = { cmd: `show route table CUST-A.inet.0`, output: isPe ? [...routeRows, ...importedRows].join("\n") || "(no routes)" : "error: no such table" };

  const bgpRows = state.advertisedRoutes
    .filter((r) => r.originPe === router)
    .map((r) => `*  ${r.rd}:${r.prefix}  ${r.bgpNextHop}  RT ${r.rt}  SID ${r.prefixSid?.l3Service.serviceSid.sidText}`);
  const bgpCisco: CliOutput = {
    cmd: "show bgp ipv4 vpn vrf CUST-A",
    output: `${pad("Network", 26)}${pad("Next Hop", 30)}${pad("RT", 14)}Service SID\n${bgpRows.join("\n") || "(no VPN routes originated)"}`,
  };
  const bgpJuniper: CliOutput = { cmd: "show route advertising-protocol bgp <rr1> table bgp.l3vpn-srv6.0", output: bgpRows.join("\n") || "(no routes)" };

  const sidCisco: CliOutput = {
    cmd: "show segment-routing srv6 sid",
    output: isPe
      ? `${pad("SID", 24)}${pad("Behavior", 12)}Table\n${sids.map((s) => `${pad(s.sidText, 24)}${pad(BEHAVIOR_LABEL[s.behavior], 12)}${s.vrf}`).join("\n")}\nLocator ${LOCATOR_PREFIX[router]}: ${state.locatorWithdrawn[router] ? "WITHDRAWN" : "advertised"}`
      : "(no local SRv6 service SIDs — P routers only forward on the outer IPv6 destination)",
  };
  const sidJuniper: CliOutput = { cmd: "show route table inet6.0 protocol srv6-local-sid", output: sidCisco.output };

  return [
    { id: "vrf", label: "vrf detail", cisco: vrfCisco, juniper: vrfJuniper },
    { id: "vrf-route", label: "vrf route", cisco: vrfRouteCisco, juniper: vrfRouteJuniper },
    { id: "bgp-vpn", label: "bgp vpn routes", cisco: bgpCisco, juniper: bgpJuniper },
    { id: "srv6-sid", label: "srv6 local sids", cisco: sidCisco, juniper: sidJuniper },
  ];
}

// ---------------------------------------------------------------------------
// Scenario steps
// ---------------------------------------------------------------------------

const findEntry = (state: Srv6L3vpnState, receiver: RouterId, prefix: string) => (state.installedAt[receiver] ?? []).find((p) => p.route.prefix === prefix);

export const srv6L3vpnSteps: ScenarioStep<Srv6L3vpnState>[] = [
  // --- A. Recap & mental model -------------------------------------------
  {
    id: "intro",
    label: "The Question",
    narrative:
      "MPLS L3VPN builds private Layer-3 connectivity across a shared provider core using a VRF, an RD, a Route Target policy, and MP-BGP — then forwards customer traffic with a two-label MPLS stack. What happens to all of that when the provider core no longer runs MPLS at all, and forwards on plain IPv6/SRv6 instead?",
  },
  {
    id: "predict-problem",
    label: "Predict",
    narrative: "Before naming what changes:",
    question: {
      prompt: "Moving the data plane to SRv6 most directly changes which single piece of the MPLS L3VPN model?",
      options: [
        { id: "vrf-gone", label: "The VRF concept disappears — SRv6 doesn't need per-customer tables" },
        { id: "service-instruction", label: "The egress service/data-plane instruction — an SRv6 Service SID replaces the MPLS VPN label" },
        { id: "bgp-gone", label: "MP-BGP is no longer needed at all" },
        { id: "rt-gone", label: "Route Target policy becomes unnecessary" },
      ],
      correctOptionId: "service-instruction",
      explanation: "VRF, RD, RT, and MP-BGP VPN routes all survive unchanged. What actually changes is how the egress PE tells the ingress PE what to do with the packet: an SRv6 Service SID bound to an endpoint behavior, instead of an MPLS VPN label.",
    },
  },
  {
    id: "mental-model",
    label: "SRv6 L3VPN Mental Model",
    narrative:
      "Control plane: CE route → VRF → RD + RT → MP-BGP VPN route + SRv6 Service SID. Data plane: customer IP → ingress PE → outer IPv6 (DA = egress Service SID) → IPv6/SRv6 core → egress PE → End.DT4/End.DT6 → VRF lookup → remote CE. Same shape as MPLS L3VPN end to end — only the highlighted piece changed.",
  },
  {
    id: "predict-continuity",
    label: "Predict",
    narrative: "This is the single most important continuity in the whole lesson.",
    question: {
      prompt: "Does moving L3VPN to an SRv6 data plane remove VRFs, RD, RT, and MP-BGP VPN routes?",
      options: [
        { id: "no", label: "No — all four survive unchanged; only the service/data-plane instruction changes" },
        { id: "yes-all", label: "Yes — SRv6 replaces the entire BGP L3VPN architecture" },
        { id: "vrf-only", label: "Only the VRF is removed; RD/RT/MP-BGP stay" },
        { id: "rt-only", label: "Only RT is removed, since the Service SID already implies a VRF" },
      ],
      correctOptionId: "no",
      explanation: "SRv6 changes the service data-plane encoding, not the VPN architecture. VRF, RD, RT, and MP-BGP VPN routes are all still exactly as necessary as in MPLS L3VPN.",
    },
  },
  {
    id: "topology-intro",
    label: "Topology",
    narrative: "CE1 sits behind PE1. CE2 and CE3 both sit behind PE2. P1 and P2 are plain IPv6 transit — no MPLS anywhere in this core. RR1 (introduced shortly) is a control-plane-only route reflector; it never appears in a customer packet's journey.",
  },
  {
    id: "roles-intro",
    label: "Roles",
    narrative: "PE1 and PE2 are ingress/egress PEs — VRF CUST-A lives on both. P1/P2 are IPv6 provider transit only. RR1 is MP-BGP control plane only. CE1/CE2/CE3 are customer routers, outside this lesson's control-plane scope (same simplification MPLS L3VPN used for CE-PE routing).",
  },
  {
    id: "infra-vs-locator",
    label: "Two Separate Provider Identities",
    narrative: `PE2 has TWO distinct IPv6 identities: a BGP infrastructure loopback (${INFRA_LOOPBACK.PE2}) used for ordinary BGP/route reachability, and a completely separate SRv6 locator (${LOCATOR_PREFIX.PE2}) that Service SIDs are built from. PE1 has the same split (${INFRA_LOOPBACK.PE1} / ${LOCATOR_PREFIX.PE1}). This separation is deliberate — it is what makes "BGP next hop reachable but Service SID unresolvable" a real, distinct failure mode later in this lesson.`,
  },
  {
    id: "predict-infra-vs-locator",
    label: "Predict",
    narrative: "Keep these two IPv6 identities distinct in your head from here on.",
    question: {
      prompt: "Is the SRv6 Service SID necessarily the same value as the BGP next hop?",
      options: [
        { id: "no", label: "No — they are separate fields with separate jobs and separate reachability" },
        { id: "yes", label: "Yes — the Service SID is just another name for the BGP next hop" },
        { id: "sometimes", label: "Only when the PE has just one interface" },
        { id: "rt-decides", label: "It depends on the Route Target" },
      ],
      correctOptionId: "no",
      explanation: "BGP next hop tracks the egress PE's ordinary route reachability (its infrastructure loopback). The Service SID is a distinct SRv6 forwarding instruction built from that PE's locator. Reachable next hop never guarantees a resolvable Service SID.",
    },
  },

  // --- B. VRF / RD / RT -----------------------------------------------------
  {
    id: "vrf-intro",
    label: "VRF CUST-A",
    narrative: "PE1 and PE2 both hold VRF CUST-A — a routing table completely separate from the provider's own global IPv6 table, exactly as in MPLS L3VPN. It currently holds only each PE's own local customer routes.",
  },
  {
    id: "rd-intro",
    label: "Route Distinguisher",
    narrative: `PE1's RD for CUST-A is ${CUST_A_RD.PE1}; PE2's is ${CUST_A_RD.PE2}. The RD's only job is making an otherwise-plain customer prefix into a globally unique VPN route in MP-BGP.`,
  },
  {
    id: "predict-rd",
    label: "Predict",
    narrative: "Be precise about what the RD actually does.",
    question: {
      prompt: "What does the Route Distinguisher (RD) control?",
      options: [
        { id: "unique", label: "Nothing about import — it only makes VPN routes unique in MP-BGP" },
        { id: "import", label: "Which VRF a route is imported into" },
        { id: "sid", label: "Which Service SID gets attached to the route" },
        { id: "locator", label: "Whether the Service SID's locator is reachable" },
      ],
      correctOptionId: "unique",
      explanation: "RD is a uniqueness mechanism only. It is easy to assume it also decides import — it does not. That's the Route Target's job, and it has nothing to do with Service SID resolvability either.",
    },
  },
  {
    id: "rt-intro",
    label: "Route Target",
    narrative: `CUST-A's export RT and import RT are both ${CUST_A_EXPORT_RT} — one shared RT scheme in this lesson, deliberately not RD (so the two are never confused). A route is imported only when its attached RT matches CUST-A's import RT.`,
  },
  {
    id: "predict-rt",
    label: "Predict",
    narrative: "This distinction matters exactly as much here as it did in MPLS L3VPN.",
    question: {
      prompt: "Which one decides whether a received VPN route is imported into CUST-A?",
      options: [
        { id: "rt", label: "The Route Target" },
        { id: "rd", label: "The Route Distinguisher" },
        { id: "sid", label: "The Service SID" },
        { id: "nexthop", label: "The BGP next hop" },
      ],
      correctOptionId: "rt",
      explanation: "Route Target — unchanged from MPLS L3VPN. The Service SID and BGP next hop matter later, for a completely different question (resolvability, not import).",
    },
  },
  {
    id: "customer-routes-ipv4",
    label: "Customer IPv4 Routes",
    narrative: `CE1 owns ${CE1_IPV4_PREFIX}. PE2 owns TWO remote prefixes on the other side: ${CE2_IPV4_PREFIX} behind CE2 and ${CE3_IPV4_PREFIX} behind CE3 — deliberately, because both are about to share one Service SID.`,
  },
  {
    id: "customer-routes-ipv6",
    label: "Customer IPv6 Routes (Dual Stack)",
    narrative: "CUST-A is dual-stack: CE1 also owns 2001:db8:ca:10::/64, CE2 owns 2001:db8:ca:20::/64, CE3 owns 2001:db8:ca:30::/64 — clearly separate address space from both the provider infrastructure loopbacks and the SRv6 locators.",
  },

  // --- C. Service SID allocation ---------------------------------------------
  {
    id: "service-sid-intro",
    label: "Allocate Per-VRF Service SIDs",
    narrative: `PE2 instantiates two per-VRF Service SIDs: ${PE2_DT4_SID.sidText} bound to End.DT4 / table CUST-A, and ${PE2_DT6_SID.sidText} bound to End.DT6 / table CUST-A. Function values ${functionHexText(FUNCTION.END_DT4)} and ${functionHexText(FUNCTION.END_DT6)} are the SAME allocations Endpoint Behaviors used — this lesson never redefines what they mean.`,
  },
  {
    id: "per-vrf-shared-sid",
    label: "One SID, Multiple Prefixes",
    narrative: `Both ${CE2_IPV4_PREFIX} and ${CE3_IPV4_PREFIX} will be advertised with the exact SAME End.DT4 Service SID, ${PE2_DT4_SID.sidText}. The Service SID selects the VRF/table; the packet's OWN inner destination is what selects the final CE route inside that table.`,
  },
  {
    id: "predict-shared-sid",
    label: "Predict",
    narrative: "Confirm the flagship per-VRF idea before it's demonstrated live.",
    question: {
      prompt: "Can multiple VPN prefixes share one per-VRF End.DT4 Service SID?",
      options: [
        { id: "yes", label: "Yes — the SID selects the table; the inner destination picks the final route" },
        { id: "no", label: "No — every prefix needs its own unique Service SID" },
        { id: "only-same-ce", label: "Only if both prefixes are behind the same CE" },
        { id: "only-ipv6", label: "Only for IPv6 routes, never IPv4" },
      ],
      correctOptionId: "yes",
      explanation: "This is the whole point of per-VRF service SIDs (as opposed to per-CE adjacency SIDs): one SID identifies the VRF/table, and any number of prefixes inside that table can share it.",
    },
  },
  {
    id: "bgp-prefix-sid-intro",
    label: "BGP Prefix-SID Attribute",
    narrative: "RFC 9252 carries the Service SID inside the BGP Prefix-SID Attribute, not as an ordinary VPN label field. PE2's VPN route will include: MP-BGP VPN NLRI, RD, RT, IPv6 BGP Next Hop, and a Prefix-SID Attribute.",
  },
  {
    id: "srv6-l3-service-tlv",
    label: "SRv6 L3 Service TLV",
    narrative: `Inside the Prefix-SID Attribute sits an SRv6 L3 Service TLV (Type 5): Service SID ${PE2_DT4_SID.sidText}, Behavior End.DT4. This is deliberately NOT represented as an ordinary MPLS-style label field anywhere in this model.`,
  },
  {
    id: "predict-nexthop-vs-sid",
    label: "Predict",
    narrative: "The route you're about to build carries both an IPv6 next hop and a Service SID — two different fields.",
    question: {
      prompt: "Is the SRv6 Service SID interchangeable with the BGP next hop on the same route?",
      options: [
        { id: "no", label: "No — next hop tracks PE reachability, Service SID drives SRv6 service forwarding" },
        { id: "yes", label: "Yes — they always carry the same address" },
        { id: "sid-is-nexthop-plus-one", label: "The Service SID is just the next hop plus a fixed offset" },
        { id: "only-ipv4", label: "Only for IPv4 VPN routes are they different" },
      ],
      correctOptionId: "no",
      explanation: "They travel on the same route but answer different questions: next hop = \"is PE2 reachable at all\"; Service SID = \"what SRv6 forwarding instruction executes once traffic reaches it.\"",
    },
  },

  // --- D. Building & advertising the IPv4 VPN route --------------------------
  {
    id: "route-create",
    label: "Build The Route: Start",
    narrative: `PE2 starts from its own local route, ${CE2_IPV4_PREFIX} (behind CE2).`,
    run: (state) => {
      const local = (state.localRoutes.PE2 ?? []).find((r) => r.prefix === CE2_IPV4_PREFIX)!;
      const route = createVpnRouteFromCustomerRoute(local, "PE2");
      return { state: { ...state, advertisedRoutes: [...state.advertisedRoutes, route] }, events: [{ type: "VRF_ROUTE_LEARNED", stepId: "route-create", timestamp: Date.now(), message: `PE2 starts building a VPN route for ${CE2_IPV4_PREFIX}` }] };
    },
    whatChanged: () => [`Route shell created for ${CE2_IPV4_PREFIX}`],
  },
  {
    id: "route-add-rd",
    label: "Build The Route: RD",
    narrative: `PE2 attaches its RD, ${CUST_A_RD.PE2}.`,
    run: (state) => {
      const routes = state.advertisedRoutes.map((r) => (r.prefix === CE2_IPV4_PREFIX ? attachRd(r, CUST_A_RD.PE2!) : r));
      return { state: { ...state, advertisedRoutes: routes }, events: [{ type: "RD_APPLIED", stepId: "route-add-rd", timestamp: Date.now(), message: `PE2 attaches RD ${CUST_A_RD.PE2}` }] };
    },
    whatChanged: () => [`Route: ${CE2_IPV4_PREFIX} → ${CUST_A_RD.PE2}:${CE2_IPV4_PREFIX}`],
  },
  {
    id: "route-attach-rt",
    label: "Build The Route: RT",
    narrative: `PE2 attaches export RT ${CUST_A_EXPORT_RT} and its own IPv6 BGP next hop, ${INFRA_LOOPBACK.PE2}.`,
    run: (state) => {
      const routes = state.advertisedRoutes.map((r) => (r.prefix === CE2_IPV4_PREFIX ? attachBgpNextHop(attachRouteTargets(r, CUST_A_EXPORT_RT), INFRA_LOOPBACK.PE2!) : r));
      return { state: { ...state, advertisedRoutes: routes }, events: [{ type: "RT_ATTACHED", stepId: "route-attach-rt", timestamp: Date.now(), message: `PE2 attaches RT ${CUST_A_EXPORT_RT} and next hop ${INFRA_LOOPBACK.PE2}` }] };
    },
    whatChanged: () => [`RT attached: ${CUST_A_EXPORT_RT}`, `BGP next hop set: ${INFRA_LOOPBACK.PE2}`],
  },
  {
    id: "route-attach-servicesid",
    label: "Build The Route: Service SID",
    narrative: `Finally, PE2 attaches its per-VRF Service SID, ${PE2_DT4_SID.sidText} (End.DT4), via the SRv6 L3 Service TLV.`,
    run: (state) => {
      const routes = state.advertisedRoutes.map((r) => (r.prefix === CE2_IPV4_PREFIX ? attachSrv6ServiceSid(r, PE2_DT4_SID) : r));
      return { state: { ...state, advertisedRoutes: routes }, events: [{ type: "SRV6_SERVICE_SID_ATTACHED", stepId: "route-attach-servicesid", timestamp: Date.now(), message: `PE2 attaches Service SID ${PE2_DT4_SID.sidText} (End.DT4)` }] };
    },
    whatChanged: () => [`Service SID attached: ${PE2_DT4_SID.sidText} (End.DT4)`],
  },
  {
    id: "mpbgp-advertise-ipv4",
    label: "MP-BGP Advertisement",
    narrative: "PE2 advertises the complete VPN route to PE1 over MP-BGP — RD, RT, IPv6 next hop, and the Prefix-SID Attribute's SRv6 L3 Service TLV, all in one UPDATE.",
    packet: (state) => {
      const route = state.advertisedRoutes.find((r) => r.prefix === CE2_IPV4_PREFIX);
      return route ? bgpPacket("vpn-ipv4-advertise", "PE2", "PE1", `VPN UPDATE — ${CE2_IPV4_PREFIX}`, routeToBgpFields(route)) : undefined;
    },
    run: (state) => {
      const route = state.advertisedRoutes.find((r) => r.prefix === CE2_IPV4_PREFIX);
      if (!route) return { state, events: [] };
      const progress = importVpnRoute(route, CUST_A_IMPORT_RT);
      const withInstall = installVpnRoute(progress, true, !state.locatorWithdrawn.PE2);
      return {
        state: { ...state, installedAt: { ...state.installedAt, PE1: [...(state.installedAt.PE1 ?? []), withInstall] } },
        events: [
          { type: "MPBGP_VPN_ROUTE_ADVERTISED", stepId: "mpbgp-advertise-ipv4", timestamp: Date.now(), message: "PE2 advertises the VPN route" },
          { type: "MPBGP_VPN_ROUTE_RECEIVED", stepId: "mpbgp-advertise-ipv4", timestamp: Date.now(), message: "PE1 receives the VPN route" },
        ],
      };
    },
    whatChanged: () => [`PE1 receives ${CE2_IPV4_PREFIX} via MP-BGP`],
  },
  {
    id: "predict-rt-import",
    label: "Predict",
    narrative: `PE1's CUST-A import RT is ${CUST_A_IMPORT_RT}. The received route's RT is ${CUST_A_EXPORT_RT}.`,
    question: {
      prompt: "With import and export RT matching, and everything else still to check, what is true right now?",
      options: [
        { id: "rt-only", label: "RT import passes — but the route isn't necessarily usable yet" },
        { id: "fully-usable", label: "The route is already fully usable for forwarding" },
        { id: "rd-blocks", label: "It's rejected because PE1 and PE2 use different RDs" },
        { id: "sid-auto", label: "The Service SID is automatically resolvable once RT matches" },
      ],
      correctOptionId: "rt-only",
      explanation: "RT import is only ONE of the required stages. BGP next-hop resolution and Service SID resolution are separate checks, still to come.",
    },
  },
  {
    id: "rt-import-check",
    label: "RT Import Check",
    narrative: "RT import passes at PE1 — already computed and stored on the route's own import progress, independently of anything else.",
  },
  {
    id: "bgp-nexthop-resolve",
    label: "BGP Next-Hop Resolution",
    narrative: `PE1 resolves ${INFRA_LOOPBACK.PE2} via the ordinary IPv6 underlay IGP — reachable.`,
  },
  {
    id: "service-sid-resolve",
    label: "Service SID Resolution",
    narrative: `PE1 checks whether it has usable SRv6 forwarding toward ${PE2_DT4_SID.sidText} — which means checking whether PE2's locator, ${LOCATOR_PREFIX.PE2}, is present in the IPv6 FIB. It is: the Service SID resolves.`,
  },
  {
    id: "route-installed",
    label: "Route Installed",
    narrative: `All three checks passed (RT import, BGP next hop, Service SID resolution) — PE1 installs ${CE2_IPV4_PREFIX} into CUST-A, associated with Service SID ${PE2_DT4_SID.sidText}. No MPLS VPN label appears anywhere.`,
    whatChanged: () => [`CUST-A @ PE1: +${CE2_IPV4_PREFIX} (installed via ${PE2_DT4_SID.sidText})`],
  },
  {
    id: "second-prefix-same-sid",
    label: "A Second Prefix, The Same Service SID",
    narrative: `PE2 now advertises ${CE3_IPV4_PREFIX} (behind CE3) the exact same way — same RD, same RT, same Service SID ${PE2_DT4_SID.sidText}. PE1 imports and installs it too.`,
    run: (state) => {
      const local = (state.localRoutes.PE2 ?? []).find((r) => r.prefix === CE3_IPV4_PREFIX)!;
      let route = createVpnRouteFromCustomerRoute(local, "PE2");
      route = attachRd(route, CUST_A_RD.PE2!);
      route = attachRouteTargets(route, CUST_A_EXPORT_RT);
      route = attachBgpNextHop(route, INFRA_LOOPBACK.PE2!);
      route = attachSrv6ServiceSid(route, PE2_DT4_SID);
      const progress = installVpnRoute(importVpnRoute(route, CUST_A_IMPORT_RT), true, !state.locatorWithdrawn.PE2);
      return {
        state: { ...state, advertisedRoutes: [...state.advertisedRoutes, route], installedAt: { ...state.installedAt, PE1: [...(state.installedAt.PE1 ?? []), progress] } },
        events: [
          { type: "MPBGP_VPN_ROUTE_ADVERTISED", stepId: "second-prefix-same-sid", timestamp: Date.now(), message: `PE2 advertises ${CE3_IPV4_PREFIX} with the SAME Service SID` },
          { type: "VPN_ROUTE_INSTALLED", stepId: "second-prefix-same-sid", timestamp: Date.now(), message: `PE1 installs ${CE3_IPV4_PREFIX}` },
        ],
      };
    },
    whatChanged: () => [`CUST-A @ PE1: +${CE3_IPV4_PREFIX} (installed via the SAME ${PE2_DT4_SID.sidText})`],
  },

  // --- E. Data plane: CE1 -> CE2 ---------------------------------------------
  {
    id: "send-ce1-ce2",
    label: "CE1 Sends To CE2",
    narrative: `CE1 sends a plain IPv4 packet: ${CE1_HOST_IPV4} → ${CE2_HOST_IPV4}.`,
    packet: () => ipv4CustomerPacket("ip-ce1-ce2", "CE1", "PE1", "Plain IPv4 packet", CE1_HOST_IPV4, CE2_HOST_IPV4),
    run: (state) => ({ state: { ...state, packetAt: "PE1", journey: [] }, events: [{ type: "PACKET_SENT", stepId: "send-ce1-ce2", timestamp: Date.now(), message: "CE1 sends toward PE1" }] }),
  },
  {
    id: "pe1-vrf-lookup",
    label: "PE1: Ingress VRF Lookup",
    narrative: `PE1 looks up ${CE2_HOST_IPV4} in VRF CUST-A — not the global table. It matches the installed ${CE2_IPV4_PREFIX} route: Service SID ${PE2_DT4_SID.sidText}.`,
    run: (state) => {
      const entry = findEntry(state, "PE1", CE2_IPV4_PREFIX);
      const journey = [...state.journey, { router: "PE1" as RouterId, input: `IPv4 packet (VRF CUST-A match)`, lookup: `VRF lookup → ${CE2_IPV4_PREFIX} via Service SID ${entry?.route.prefixSid?.l3Service.serviceSid.sidText}`, action: "VRF_LOOKUP" as L3vpnAction, output: "Service SID selected" }];
      return { state: { ...state, journey }, events: [{ type: "VPN_CONTEXT_SELECTED", stepId: "pe1-vrf-lookup", timestamp: Date.now(), message: "PE1 selects the Service SID for this destination" }] };
    },
  },
  {
    id: "pe1-encapsulate",
    label: "PE1: SRv6 Encapsulation",
    narrative: `PE1 builds a fresh outer IPv6 header: DA = ${PE2_DT4_SID.sidText} (PE2's End.DT4 Service SID). No Segment Routing Header — a single Service SID needs no segment list at all.`,
    packet: () => l3vpnPacket("srv6-encap", "PE1", "P1", "Outer IPv6 — DA = PE2 End.DT4", "H.Encaps", encapsulateSrv6VpnPacket(PE2_DT4_SID, ipv4Inner(CE1_HOST_IPV4, CE2_HOST_IPV4), PE1_SR_SOURCE)),
    run: (state) => {
      const pkt = encapsulateSrv6VpnPacket(PE2_DT4_SID, ipv4Inner(CE1_HOST_IPV4, CE2_HOST_IPV4), PE1_SR_SOURCE);
      const journey = [...state.journey, { router: "PE1" as RouterId, input: "IPv4 packet (VRF CUST-A match)", lookup: `Encapsulate: outer IPv6 DA = ${PE2_DT4_SID.sidText}, no SRH`, action: "SRV6_ENCAPSULATE" as L3vpnAction, output: "Outer IPv6 [Service SID][IPv4]" }];
      return { state: { ...state, packet: pkt, packetAt: "P1", journey }, events: [{ type: "SRV6_VPN_PACKET_ENCAPSULATED", stepId: "pe1-encapsulate", timestamp: Date.now(), message: "PE1 encapsulates with the Service SID as outer DA" }] };
    },
    whatChanged: () => ["Packet: [IPv4] → [Outer IPv6 DA=Service SID][IPv4] — no SRH"],
  },
  {
    id: "predict-no-srh",
    label: "Predict",
    narrative: "The packet PE1 just built carries exactly one segment — the Service SID itself.",
    question: {
      prompt: "Does this baseline, single-Service-SID SRv6 VPN packet need a Segment Routing Header?",
      options: [
        { id: "no", label: "No — a single segment needs no segment list; the DA alone carries it" },
        { id: "yes-empty", label: "Yes — an empty SRH must always be added for SRv6 to work" },
        { id: "yes-mpls", label: "Yes — but only to hold the equivalent of a VPN label" },
        { id: "depends-family", label: "Only for IPv6 VPN routes, not IPv4" },
      ],
      correctOptionId: "no",
      explanation: "SRH is not mandatory merely because the data plane is SRv6. One segment fits entirely in the destination address; a synthetic empty SRH would add nothing but overhead.",
    },
  },
  {
    id: "p1-transit",
    label: "P1: Ordinary IPv6 Forwarding",
    narrative: `P1 sees only an IPv6 destination address, ${PE2_DT4_SID.sidText}, which falls inside PE2's locator ${LOCATOR_PREFIX.PE2}. P1 forwards toward PE2 using its ordinary IPv6 FIB — nothing about CUST-A, RD, RT, or End.DT4 is visible to it.`,
    run: (state) => ({ state: { ...state, packetAt: "P2" }, events: [] }),
  },
  {
    id: "predict-p-routers",
    label: "Predict",
    narrative: "P1 just forwarded this packet with zero knowledge of the customer route inside it.",
    question: {
      prompt: "Do provider P routers need CUST-A's customer routes in any table?",
      options: [
        { id: "no", label: "No — P routers only need ordinary IPv6 reachability to each PE's locator" },
        { id: "yes", label: "Yes, every P router needs every customer route" },
        { id: "only-v6", label: "Only for the IPv6 side of the dual-stack VPN" },
        { id: "only-locator", label: "Only the End.DT4 table binding, not the routes themselves" },
      ],
      correctOptionId: "no",
      explanation: "This is the scalability property SRv6 L3VPN keeps from MPLS L3VPN: P routers carry zero customer state. They forward on the outer IPv6 destination only.",
    },
  },
  {
    id: "p2-transit",
    label: "P2: Ordinary IPv6 Forwarding",
    narrative: "P2 does the same — plain IPv6 FIB forward toward PE2, still no CUST-A knowledge whatsoever.",
    run: (state) => ({ state: { ...state, packetAt: "PE2" }, events: [] }),
  },
  {
    id: "pe2-local-sid-match",
    label: "PE2: Local SID Match",
    narrative: `PE2 receives the packet with DA = ${PE2_DT4_SID.sidText} — a match in its own Local SID Table: behavior End.DT4, table CUST-A.`,
  },
  {
    id: "pe2-dt4-execute",
    label: "PE2: Execute End.DT4",
    narrative: `PE2 decapsulates the outer IPv6 header, exposes the inner IPv4 packet, selects table CUST-A, and looks up ${CE2_HOST_IPV4} — matching ${CE2_IPV4_PREFIX} → CE2.`,
    packet: () => ipv4CustomerPacket("deliver-ce2", "PE2", "CE2", "Delivered via CUST-A", CE1_HOST_IPV4, CE2_HOST_IPV4),
    run: (state) => {
      const outcome = processEgressServiceSid(PE2_DT4_SID, encapsulateSrv6VpnPacket(PE2_DT4_SID, ipv4Inner(CE1_HOST_IPV4, CE2_HOST_IPV4), PE1_SR_SOURCE), state.localRoutes.PE2 ?? [], []);
      const journey = [...state.journey, { router: "PE2" as RouterId, input: `[Service SID][IPv4]`, lookup: `End.DT4 → CUST-A IPv4 lookup(${CE2_HOST_IPV4})`, action: "SERVICE_DECAP" as L3vpnAction, output: outcome.ceTarget ? `IPv4 packet → ${outcome.ceTarget}` : "dropped" }];
      return { state: { ...state, packet: { outer: { srcText: PE1_SR_SOURCE, daHextets: PE2_DT4_SID.sidHextets }, inner: ipv4Inner(CE1_HOST_IPV4, CE2_HOST_IPV4) }, packetAt: "CE2", journey }, events: [{ type: "VPN_PACKET_DELIVERED", stepId: "pe2-dt4-execute", timestamp: Date.now(), message: "PE2 delivers to CE2 via CUST-A" }] };
    },
    whatChanged: () => ["Packet: [Service SID][IPv4] → [IPv4] — delivered to CE2 via CUST-A"],
  },

  // --- F. Same SID, different CE ---------------------------------------------
  {
    id: "send-ce1-ce3",
    label: "CE1 Sends To CE3",
    narrative: `Now CE1 sends to ${CE3_HOST_IPV4} instead. Ingress uses the SAME End.DT4 Service SID, ${PE2_DT4_SID.sidText} — the VRF lookup at PE1 resolves the same way because BOTH remote prefixes share it.`,
    packet: () => ipv4CustomerPacket("ip-ce1-ce3", "CE1", "PE1", "Plain IPv4 packet", CE1_HOST_IPV4, CE3_HOST_IPV4),
    run: (state) => ({ state: { ...state, packet: undefined, packetAt: "PE2", journey: [{ router: "PE1" as RouterId, input: "IPv4 packet", lookup: `VRF lookup → ${CE3_IPV4_PREFIX} via SAME Service SID ${PE2_DT4_SID.sidText}`, action: "VRF_LOOKUP" as L3vpnAction, output: "Encapsulated toward PE2" }] }, events: [{ type: "PACKET_SENT", stepId: "send-ce1-ce3", timestamp: Date.now(), message: "CE1 sends toward CE3 using the same Service SID path" }] }),
  },
  {
    id: "pe2-dt4-execute-ce3",
    label: "PE2: Same SID, Different CE",
    narrative: `PE2 decapsulates the SAME Service SID's packet, selects the SAME CUST-A table — but this time the inner destination ${CE3_HOST_IPV4} matches ${CE3_IPV4_PREFIX} → CE3. One Service SID, two different outcomes, purely from the packet's own inner destination.`,
    packet: () => ipv4CustomerPacket("deliver-ce3", "PE2", "CE3", "Delivered via CUST-A", CE1_HOST_IPV4, CE3_HOST_IPV4),
    run: (state) => {
      const journey = [...state.journey, { router: "PE2" as RouterId, input: "[Service SID][IPv4]", lookup: `End.DT4 → CUST-A IPv4 lookup(${CE3_HOST_IPV4})`, action: "SERVICE_DECAP" as L3vpnAction, output: "IPv4 packet → CE3" }];
      return { state: { ...state, packetAt: "CE3", journey }, events: [{ type: "VPN_PACKET_DELIVERED", stepId: "pe2-dt4-execute-ce3", timestamp: Date.now(), message: "PE2 delivers to CE3 via CUST-A — same Service SID as CE2" }] };
    },
    whatChanged: () => ["Same Service SID, same VRF, different inner destination → CE3 selected"],
  },
  {
    id: "predict-same-sid-diff-ce",
    label: "Predict",
    narrative: "You just watched one Service SID resolve to two different customer edges.",
    question: {
      prompt: "Does End.DT4 choose the final CE through a real per-VRF IPv4 route lookup?",
      options: [
        { id: "yes", label: "Yes — the table lookup after decapsulation is what actually selects the CE" },
        { id: "no", label: "No — the Service SID alone fully determines the destination CE" },
        { id: "only-first-packet", label: "Only for the first packet; later ones are cached to one CE" },
        { id: "requires-srh", label: "Only if an SRH carries the CE identity explicitly" },
      ],
      correctOptionId: "yes",
      explanation: "End.DT4's whole value is that it performs a genuine VRF/table lookup after decapsulating — the Service SID identifies the table, the packet's own destination picks the row.",
    },
  },

  // --- G. Reverse direction ---------------------------------------------------
  {
    id: "pe1-advertises-ce1",
    label: "Reverse Direction: PE1 Advertises CE1",
    narrative: `PE1 advertises ${CE1_IPV4_PREFIX} to PE2 the same way — RD ${CUST_A_RD.PE1}, RT ${CUST_A_EXPORT_RT}, next hop ${INFRA_LOOPBACK.PE1}, and PE1's OWN Service SID ${PE1_DT4_SID.sidText}. A Service SID is only ever locally significant at the PE that advertised it — PE2 never reuses PE1's Service SID for anything, and vice versa.`,
    run: (state) => {
      const local = (state.localRoutes.PE1 ?? []).find((r) => r.prefix === CE1_IPV4_PREFIX)!;
      const route = exportVpnRoute(local, "PE1", CUST_A_RD.PE1!, CUST_A_EXPORT_RT, INFRA_LOOPBACK.PE1!, PE1_DT4_SID);
      const progress = installVpnRoute(importVpnRoute(route, CUST_A_IMPORT_RT), true, !state.locatorWithdrawn.PE1);
      return {
        state: { ...state, advertisedRoutes: [...state.advertisedRoutes, route], installedAt: { ...state.installedAt, PE2: [...(state.installedAt.PE2 ?? []), progress] } },
        events: [
          { type: "MPBGP_VPN_ROUTE_ADVERTISED", stepId: "pe1-advertises-ce1", timestamp: Date.now(), message: `PE1 advertises ${CE1_IPV4_PREFIX} with its OWN Service SID` },
          { type: "VPN_ROUTE_INSTALLED", stepId: "pe1-advertises-ce1", timestamp: Date.now(), message: `PE2 installs ${CE1_IPV4_PREFIX}` },
        ],
      };
    },
    whatChanged: () => [`CUST-A @ PE2: +${CE1_IPV4_PREFIX} (via PE1's own Service SID ${PE1_DT4_SID.sidText})`],
  },
  {
    id: "send-ce2-ce1",
    label: "Reverse Traffic: CE2 → CE1",
    narrative: `CE2 sends ${CE2_HOST_IPV4} → ${CE1_HOST_IPV4}. PE2's ingress VRF lookup this time selects PE1's Service SID, ${PE1_DT4_SID.sidText} — never PE2's own. At PE1, the SAME End.DT4 dispatch executes locally, using PE1's own CUST-A table.`,
    packet: () => l3vpnPacket("reverse-encap", "PE2", "P2", "Outer IPv6 — DA = PE1 End.DT4", "H.Encaps", encapsulateSrv6VpnPacket(PE1_DT4_SID, ipv4Inner(CE2_HOST_IPV4, CE1_HOST_IPV4), PE2_SR_SOURCE)),
    run: (state) => {
      const outcome = processEgressServiceSid(PE1_DT4_SID, encapsulateSrv6VpnPacket(PE1_DT4_SID, ipv4Inner(CE2_HOST_IPV4, CE1_HOST_IPV4), PE2_SR_SOURCE), state.localRoutes.PE1 ?? [], []);
      const journey = [
        { router: "PE2" as RouterId, input: "IPv4 packet (VRF CUST-A match)", lookup: `VRF lookup → ${CE1_IPV4_PREFIX} via PE1's Service SID ${PE1_DT4_SID.sidText}`, action: "SRV6_ENCAPSULATE" as L3vpnAction, output: "Outer IPv6 toward PE1" },
        { router: "PE1" as RouterId, input: "[Service SID][IPv4]", lookup: `End.DT4 → CUST-A IPv4 lookup(${CE1_HOST_IPV4})`, action: "SERVICE_DECAP" as L3vpnAction, output: outcome.ceTarget ? `IPv4 packet → ${outcome.ceTarget}` : "dropped" },
      ];
      return { state: { ...state, packetAt: "CE1", journey }, events: [{ type: "VPN_PACKET_DELIVERED", stepId: "send-ce2-ce1", timestamp: Date.now(), message: "PE1 delivers to CE1 via its own Service SID" }] };
    },
    whatChanged: () => [`Reverse traffic uses PE1's own ${PE1_DT4_SID.sidText} — never PE2's Service SID`],
  },

  // --- H. IPv6 VPN + End.DT6 ---------------------------------------------------
  {
    id: "ipv6-vpn-intro",
    label: "IPv6 VPN: End.DT6",
    narrative: `CUST-A is dual-stack. PE2 attaches its End.DT6 Service SID, ${PE2_DT6_SID.sidText}, to both remote IPv6 prefixes (2001:db8:ca:20::/64 and 2001:db8:ca:30::/64) — same per-VRF sharing idea, now for the IPv6 table.`,
    run: (state) => {
      const routesToAdvertise = (state.localRoutes.PE2 ?? []).filter((r) => r.family === "IPV6");
      const vpnRoutes = routesToAdvertise.map((r) => exportVpnRoute(r, "PE2", CUST_A_RD.PE2!, CUST_A_EXPORT_RT, INFRA_LOOPBACK.PE2!, PE2_DT6_SID));
      const progresses = vpnRoutes.map((route) => installVpnRoute(importVpnRoute(route, CUST_A_IMPORT_RT), true, !state.locatorWithdrawn.PE2));
      return {
        state: { ...state, advertisedRoutes: [...state.advertisedRoutes, ...vpnRoutes], installedAt: { ...state.installedAt, PE1: [...(state.installedAt.PE1 ?? []), ...progresses] } },
        events: [{ type: "SRV6_SERVICE_SID_ATTACHED", stepId: "ipv6-vpn-intro", timestamp: Date.now(), message: `PE2 advertises both IPv6 prefixes via ${PE2_DT6_SID.sidText}` }],
      };
    },
    whatChanged: () => [`CUST-A @ PE1: +2 IPv6 routes, both via ${PE2_DT6_SID.sidText} (End.DT6)`],
  },
  {
    id: "send-ce1-ce2-ipv6",
    label: "CE1 → CE2, IPv6",
    narrative: `CE1 sends an IPv6 packet: ${fmtIpv6(CE1_HOST_IPV6)} → ${fmtIpv6(CE2_HOST_IPV6)}. PE1 encapsulates with OUTER provider IPv6 (DA = ${PE2_DT6_SID.sidText}) wrapping the INNER customer IPv6 packet — two different IPv6 headers, clearly distinguished by role.`,
    packet: () => l3vpnPacket("ipv6-encap", "PE1", "P1", "Outer provider IPv6, inner customer IPv6", "H.Encaps", encapsulateSrv6VpnPacket(PE2_DT6_SID, ipv6Inner(CE1_HOST_IPV6, CE2_HOST_IPV6), PE1_SR_SOURCE)),
    run: (state) => ({ state: { ...state, packet: encapsulateSrv6VpnPacket(PE2_DT6_SID, ipv6Inner(CE1_HOST_IPV6, CE2_HOST_IPV6), PE1_SR_SOURCE), packetAt: "PE2" }, events: [{ type: "SRV6_VPN_PACKET_ENCAPSULATED", stepId: "send-ce1-ce2-ipv6", timestamp: Date.now(), message: "PE1 encapsulates the IPv6 VPN packet" }] }),
  },
  {
    id: "pe2-dt6-execute",
    label: "PE2: Execute End.DT6",
    narrative: `PE2 decapsulates, selects CUST-A's IPv6 table, and looks up ${fmtIpv6(CE2_HOST_IPV6)} — matching 2001:db8:ca:20::/64 → CE2.`,
    packet: () => ipv6CustomerPacket("deliver-ce2-v6", "PE2", "CE2", "Delivered via CUST-A", CE1_HOST_IPV6, CE2_HOST_IPV6),
    run: (state) => {
      const outcome = processEgressServiceSid(PE2_DT6_SID, encapsulateSrv6VpnPacket(PE2_DT6_SID, ipv6Inner(CE1_HOST_IPV6, CE2_HOST_IPV6), PE1_SR_SOURCE), [], state.localRoutes.PE2 ?? []);
      const journey = [...state.journey, { router: "PE2" as RouterId, input: "[Service SID][IPv6]", lookup: `End.DT6 → CUST-A IPv6 lookup(${fmtIpv6(CE2_HOST_IPV6)})`, action: "SERVICE_DECAP" as L3vpnAction, output: outcome.ceTarget ? `IPv6 packet → ${outcome.ceTarget}` : "dropped" }];
      return { state: { ...state, packetAt: "CE2", journey }, events: [{ type: "VPN_PACKET_DELIVERED", stepId: "pe2-dt6-execute", timestamp: Date.now(), message: "PE2 delivers the IPv6 packet to CE2 via CUST-A" }] };
    },
    whatChanged: () => ["Packet: [Service SID][inner IPv6] → [inner IPv6] — delivered to CE2 via CUST-A's IPv6 table"],
  },
  {
    id: "dual-stack-recap",
    label: "Dual-Stack VRF",
    narrative: "CUST-A holds one IPv4 table (End.DT4 → CUST-A) and one IPv6 table (End.DT6 → CUST-A) inside the same VRF. RFC 9252 also defines End.DT46 — a single combined behavior for both families through one SID — preview only, never instantiated here (function 0x14 stays reserved).",
  },

  // --- I. Per-VRF vs per-CE -----------------------------------------------------
  {
    id: "per-vrf-vs-per-ce-lab",
    label: "Read-Only Lab: Per-VRF vs. Per-CE",
    narrative: `Compare ${PE2_DT4_SID.sidText} (End.DT4, table CUST-A) against a hypothetical End.DX4 SID fixed to CE2's adjacency. Sending to ${CE3_HOST_IPV4}: End.DT4 performs a real VRF lookup and reaches CE3. A CE2-bound End.DX4 has no VRF lookup at all — it cannot magically reach CE3, no matter the destination.`,
  },
  {
    id: "predict-dt4-vs-dx4",
    label: "Predict",
    narrative: "Same destination, two different SID types.",
    question: {
      prompt: "Does an End.DX4 SID fixed to CE2's adjacency perform the same per-VRF lookup End.DT4 does?",
      options: [
        { id: "no", label: "No — DX4 cross-connects to one fixed adjacency; it never consults a VRF table" },
        { id: "yes", label: "Yes — DX4 and DT4 are functionally identical" },
        { id: "only-ipv6", label: "Only when the payload is IPv6" },
        { id: "only-with-srh", label: "Only if an SRH is present" },
      ],
      correctOptionId: "no",
      explanation: "DX4 is per-CE: fixed adjacency, no lookup. DT4 is per-VRF: real table lookup, and can select any CE the table knows about — the exact distinction that let one Service SID serve both CE2 and CE3.",
    },
  },

  // --- J. Explicit distinctions ---------------------------------------------------
  {
    id: "service-sid-not-vpn-route",
    label: "A Service SID Is Not A VPN Route",
    narrative: "A VPN route says WHICH customer prefix is reachable. A Service SID says WHAT service action to perform at the egress PE. They travel together on the same advertisement, but they are different concepts — the route viewer keeps them as separate fields for exactly this reason.",
  },
  {
    id: "service-sid-not-nexthop",
    label: "A Service SID Is Not The BGP Next Hop",
    narrative: `${INFRA_LOOPBACK.PE2} (BGP next hop) tracks PE2's ordinary reachability. ${PE2_DT4_SID.sidText} (Service SID) drives SRv6 service forwarding. Both are visible, side by side, in every route you've built this lesson.`,
  },

  // --- K. Non-transposition + SR Policy preview ------------------------------
  {
    id: "transposition-preview",
    label: "Preview: SID Transposition",
    narrative: "RFC 9252 also defines a transposition mechanism, encoding part of the Service SID into fields normally used by an MPLS label, to save bits on the wire. This lesson keeps transposition OFF and always models the full Service SID explicitly in the SRv6 L3 Service TLV — transposition itself is preview-only here, never implemented.",
  },
  {
    id: "sr-policy-integration-preview",
    label: "Advanced Preview: SR Policy Service Steering",
    narrative: `Shortest-path service steering used a single Service SID as the outer DA. A policy-steered alternative instead builds <P1 End.X, ${PE2_DT4_SID.sidText}>: outer DA = ${P1_ENDX_SID_TEXT} (P1's End.X), SRH = [${PE2_DT4_SID.sidText}, ${P1_ENDX_SID_TEXT}]. At P1, End.X advances the DA to ${PE2_DT4_SID.sidText}. At PE2, Segments Left is already 0 — End.DT4 still executes as the FINAL service instruction, exactly as before. SR Policy controls the transport path; the Service SID still controls the VPN service action.`,
  },
  {
    id: "predict-policy-plus-service",
    label: "Predict",
    narrative: "The advanced experiment kept the Service SID as the very last segment.",
    question: {
      prompt: "Can an SRv6 VPN Service SID be used as the final service instruction after an SR Policy transport segment?",
      options: [
        { id: "yes", label: "Yes — SR Policy only changes the transport path; the Service SID is still the final instruction" },
        { id: "no", label: "No — Service SIDs only work in the shortest-path, single-segment case" },
        { id: "requires-color", label: "Only with a full BGP Color steering control plane" },
        { id: "requires-transposition", label: "Only if SID transposition is enabled" },
      ],
      correctOptionId: "yes",
      explanation: "SR Policy and the VPN service model are orthogonal: policy decides WHICH path the packet takes through the core; the Service SID, wherever it sits in the list, still decides what happens at the egress PE.",
    },
  },

  // --- L/M. RT-mismatch + missing-TLV labs -----------------------------------
  {
    id: "rt-mismatch-lab",
    label: "Read-Only Lab: RT Mismatch",
    narrative: `Contrast with the incident coming up: if PE2 exported RT ${CUST_A_WRONG_RT} instead of ${CUST_A_EXPORT_RT}, the route would still be RECEIVED at PE1 — but RT IMPORT would FAIL outright, before Service SID resolution is ever even evaluated.`,
  },
  {
    id: "missing-service-tlv-lab",
    label: "Read-Only Lab: Missing Service TLV",
    narrative: "A separate small case: if the BGP route arrived with RD/RT/next-hop intact but no SRv6 L3 Service TLV at all, there is simply no Service SID to build an SRv6 forwarding instruction from — no service route can be installed in this SRv6-only model, even though the plain BGP route itself is fine.",
  },

  // --- N. Fault injection -----------------------------------------------------
  {
    id: "break-intro",
    label: "Break The Network",
    narrative: "Everything above has worked cleanly. Time to break exactly one thing: PE2's SRv6 locator route — not PE2 itself, and not its BGP session.",
  },
  {
    id: "fault-injected",
    label: "PE2's Locator Route Withdrawn",
    narrative: `PE2's SRv6 locator, ${LOCATOR_PREFIX.PE2}, is withdrawn from the IPv6 IGP. PE2's BGP infrastructure loopback, ${INFRA_LOOPBACK.PE2}, stays fully reachable — this is not a PE2-down fault.`,
    run: (state) => {
      const next = { ...state, locatorWithdrawn: { ...state.locatorWithdrawn, PE2: true } };
      const installedAt = recomputeInstalledRoutes(next);
      return {
        state: { ...next, installedAt },
        events: [
          { type: "SRV6_LOCATOR_WITHDRAWN", stepId: "fault-injected", timestamp: Date.now(), message: `PE2's locator ${LOCATOR_PREFIX.PE2} withdrawn from the IPv6 IGP` },
          { type: "SRV6_SERVICE_SID_UNRESOLVABLE", stepId: "fault-injected", timestamp: Date.now(), message: "PE1 can no longer resolve PE2's Service SIDs" },
        ],
      };
    },
    whatChanged: () => [`PE2 locator ${LOCATOR_PREFIX.PE2}: withdrawn`, "All PE2-originated CUST-A routes at PE1: installed → NOT installed (Service SID unresolvable)"],
  },
  {
    id: "incident",
    label: "Incident",
    narrative: "PE1 still receives the CUST-A VPN routes. RT import still matches. PE2's BGP next hop is still reachable. But CUST-A traffic toward CE2/CE3 can no longer be forwarded through the SRv6 service.",
  },
  {
    id: "predict-fault-usability",
    label: "Predict",
    narrative: "Before diagnosing further:",
    question: {
      prompt: "If RT import succeeds but Service SID resolution fails, is the route usable for SRv6 service forwarding?",
      options: [
        { id: "no", label: "No — installation requires RT import AND BGP next-hop reachability AND Service SID resolution" },
        { id: "yes", label: "Yes — RT import passing is already enough" },
        { id: "yes-nexthop", label: "Yes, as long as the BGP next hop is reachable" },
        { id: "depends-family", label: "Only for IPv6 routes, not IPv4" },
      ],
      correctOptionId: "no",
      explanation: "All three checks are required. A route can pass RT import and have a perfectly healthy BGP next hop and STILL be unusable if its Service SID can't be resolved — exactly what just happened to PE2's routes.",
    },
  },
  {
    id: "trouble-question",
    label: "Troubleshoot",
    narrative: "Inspect the MP-BGP session, the received routes, RT import, the BGP next hop, and Service SID resolution before answering.",
    question: {
      prompt: "Where exactly is this failure?",
      options: [
        { id: "rt", label: "Route Target import policy" },
        { id: "nexthop", label: "BGP next-hop reachability" },
        { id: "locator", label: "PE2's SRv6 locator route / Service SID resolvability" },
        { id: "mpbgp", label: "The MP-BGP session itself" },
      ],
      correctOptionId: "locator",
      explanation: "MP-BGP is Established, the route is received, RT import passes, and the BGP next hop is fine. The single missing dependency is PE2's locator route — without it, PE1 cannot resolve PE2's Service SIDs, so the route can't be installed as usable.",
      hints: [
        "Hint 1: The route IS received at PE1, and RT import already passes.",
        "Hint 2: PE2's BGP next hop, its infrastructure loopback, is reachable.",
        "Hint 3: Compare PE2's locator prefix against the current IPv6 FIB.",
      ],
    },
  },
  {
    id: "diagnostic-layers",
    label: "Layer By Layer",
    narrative: "MP-BGP Established, VPN route received, RT import passed, and BGP next hop reachable are all healthy — none of that guarantees Service SID resolvability, which is the one thing that just broke.",
  },

  // --- O. Repair ----------------------------------------------------------------
  {
    id: "repair-challenge",
    label: "Apply The Fix",
    narrative: "Choose the correct repair.",
    action: (state, payload) => {
      const choice = typeof payload === "object" && payload !== null && "choice" in payload ? String((payload as { choice: string }).choice) : "";
      if (choice !== "restore-locator") return { state: { ...state, repairAttempt: { choice, correct: false } }, events: [] };
      const next = { ...state, locatorWithdrawn: { ...state.locatorWithdrawn, PE2: false } };
      const installedAt = recomputeInstalledRoutes(next);
      return {
        state: { ...next, installedAt, repairAttempt: { choice, correct: true } },
        events: [
          { type: "SRV6_LOCATOR_RESTORED", stepId: "repair-challenge", timestamp: Date.now(), message: `PE2's locator ${LOCATOR_PREFIX.PE2} restored` },
          { type: "SRV6_SERVICE_SID_RESOLVED", stepId: "repair-challenge", timestamp: Date.now(), message: "PE1 resolves PE2's Service SIDs again" },
          { type: "VPN_ROUTE_INSTALLED", stepId: "repair-challenge", timestamp: Date.now(), message: "All PE2-originated CUST-A routes re-installed at PE1" },
        ],
      };
    },
    requiresState: (state) => (state.installedAt.PE1 ?? []).filter((p) => p.route.originPe === "PE2").every((p) => p.installed),
  },

  // --- P. Mandatory resend -------------------------------------------------------
  {
    id: "verify-dataplane",
    label: "Verify End To End",
    narrative: `Send CE1 → ${CE3_HOST_IPV4} again to prove the repair restored the data plane, not just the control plane.`,
    packet: () => ipv4CustomerPacket("verify-ce1-ce3", "CE1", "PE1", "Verification packet", CE1_HOST_IPV4, CE3_HOST_IPV4),
    run: (state) => {
      const journey: JourneyHop[] = [
        { router: "PE1", input: "IPv4 packet (VRF CUST-A match)", lookup: `VRF lookup → ${CE3_IPV4_PREFIX} via ${PE2_DT4_SID.sidText}`, action: "SRV6_ENCAPSULATE", output: `Outer IPv6 DA=${PE2_DT4_SID.sidText}, no SRH` },
        { router: "P1", input: "Outer IPv6", lookup: `IPv6 FIB → toward ${LOCATOR_PREFIX.PE2}`, action: "IPV6_FIB_FORWARD", output: "Forwarded toward P2" },
        { router: "P2", input: "Outer IPv6", lookup: `IPv6 FIB → toward ${LOCATOR_PREFIX.PE2}`, action: "IPV6_FIB_FORWARD", output: "Forwarded toward PE2" },
        { router: "PE2", input: "[Service SID][IPv4]", lookup: `End.DT4 → CUST-A IPv4 lookup(${CE3_HOST_IPV4})`, action: "SERVICE_DECAP", output: "IPv4 packet → CE3" },
      ];
      return { state: { ...state, packet: undefined, packetAt: "CE3", journey }, events: [{ type: "VPN_PACKET_DELIVERED", stepId: "verify-dataplane", timestamp: Date.now(), message: "CE1 → CE3 delivered — SRv6 service fully restored" }] };
    },
    whatChanged: () => ["✓ PE2 locator restored", "✓ Service SID resolved", "✓ CUST-A route re-installed", "✓ IPv6 core transit unchanged", "✓ End.DT4 executed", "✓ Packet delivered to CE3"],
  },

  // --- Q. Comparison + wrap ---------------------------------------------------
  {
    id: "mpls-vs-srv6-comparison",
    label: "MPLS L3VPN vs. SRv6 L3VPN",
    narrative:
      "VRF ✓/✓. RD ✓/✓. RT ✓/✓. MP-BGP VPN route ✓/✓. Provider transport: MPLS vs. IPv6/SRv6. Service instruction: VPN label vs. Service SID. Per-VRF action: label→VRF vs. End.DT4/DT6. Transit P-router state: LFIB labels vs. plain IPv6 FIB. SRv6 changes the service data-plane encoding — it does not replace BGP L3VPN.",
  },
  {
    id: "complete",
    label: "Lesson Complete",
    narrative: "You built VRF CUST-A end to end on an SRv6 data plane: real RD/RT policy, real MP-BGP VPN routes, real per-VRF Service SIDs shared across multiple prefixes, real End.DT4/End.DT6 forwarding, and a real repair after PE2's locator route — not PE2 itself — went missing.",
  },
];

export const STEP_IDX: Record<string, number> = Object.fromEntries(srv6L3vpnSteps.map((s, i) => [s.id, i]));
