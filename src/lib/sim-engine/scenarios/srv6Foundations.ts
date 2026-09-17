import type { PacketLayer, PacketVisual, ScenarioStep } from "@/lib/sim-engine/types";

/**
 * SRv6 Foundations — IPv6 SIDs, Locators, Functions, the Local SID
 * Table, the Segment Routing Header, and End processing. Follows
 * SR-MPLS Foundations, SR Policy, TI-LFA, and Flex-Algo. Central
 * question: what happens when Segment Routing is instantiated directly
 * in the IPv6 data plane instead of MPLS?
 *
 * Answer taught here: segment -> 128-bit IPv6 SID -> IPv6 forwarding +
 * local SID behavior. SRv6 is NOT "MPLS labels written as IPv6
 * addresses" — the forwarding/programming model is genuinely different
 * (RFC 8402 §1, RFC 8754, RFC 8986, RFC 9602).
 *
 * Scope boundary (deliberate): this lesson fully teaches the SRv6 SID,
 * locator, function, the optional-argument CONCEPT (not an
 * argument-aware behavior), the Local SID Table, the active segment,
 * the IPv6 Destination Address, the SRH (Segments Left, Last Entry,
 * Segment List encoding), transit forwarding, and the base End
 * behavior. It only PREVIEWS End.X, End.T, End.DX4, End.DX6, End.DT4,
 * End.DT6, End.DX2, and binding behaviors — none of those are
 * implemented as real forwarding here. SRv6 L3VPN, SRv6 EVPN, uSID/
 * compressed SIDs, SRv6 TI-LFA, PCEP, and BGP SR Policy are explicitly
 * out of scope for this lesson — later modules in the track.
 *
 * Topology (hexagon — R1 and R6 are NOT directly connected):
 *
 *              R2 ───── R3
 *             /           \
 *            /             \
 *          R1               R6
 *            \             /
 *             \           /
 *              R4 ───── R5
 *
 *   Top:    R1-R2=10, R2-R3=10, R3-R6=10  (cost 30)
 *   Bottom: R1-R4=5,  R4-R5=5,  R5-R6=5   (cost 15, shortest by default)
 *
 * Locator note: the spec that inspired this lesson asks for a
 * "same SID, different physical path" locator experiment against R3's
 * locator specifically. This fixed topology has exactly ONE physical
 * path into R3 (via R2) regardless of any metric, so that experiment
 * is run against R6's locator instead — R6 genuinely has two paths
 * (top cost 30 / bottom cost 15), which is the only place in this
 * topology the experiment is demonstrable. Same pedagogical point,
 * same mechanism, the only reachable target for it.
 *
 * Pure data + pure functions only — see /lib/sim-engine/types.ts.
 */

export type RouterId = "R1" | "R2" | "R3" | "R4" | "R5" | "R6";
export const ALL_ROUTERS: RouterId[] = ["R1", "R2", "R3", "R4", "R5", "R6"];
export const HEADEND: RouterId = "R1";
export const DESTINATION: RouterId = "R6";
export const VIA: RouterId = "R3";
export const THIRD_HOP: RouterId = "R5";

export type LinkId = "R1-R2" | "R2-R3" | "R3-R6" | "R1-R4" | "R4-R5" | "R5-R6";
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
];
export const TOP_PATH: RouterId[] = ["R1", "R2", "R3", "R6"];
export const BOTTOM_PATH: RouterId[] = ["R1", "R4", "R5", "R6"];
export const LOCATOR_EXPERIMENT_LINK: LinkId = "R4-R5";
export const LOCATOR_EXPERIMENT_METRIC = 50;

export const TERMS: { term: string; expansion: string; meaning: string }[] = [
  { term: "SID", expansion: "Segment Identifier", meaning: "A 128-bit IPv6 address explicitly instantiated and bound to a segment/behavior — not just any IPv6 address." },
  { term: "Locator", expansion: "SRv6 Locator", meaning: "A routable IPv6 prefix that guides ordinary forwarding toward the node that instantiates the SID." },
  { term: "Function", expansion: "SID Function Bits", meaning: "The bit field inside a SID that identifies which local instruction the owning node binds to it." },
  { term: "Local SID Table", expansion: "Per-Node SID/Behavior Bindings", meaning: "The table on each node that says what to DO when one of its own SIDs becomes the active segment." },
];

// ---------------------------------------------------------------------------
// IPv6 hextet plumbing — represented as arrays of 8 numbers (0..65535).
// Locator length 64 = exactly 4 hextets, function length 16 = exactly 1
// hextet, argument length 0 = unused — a deliberately transparent
// educational allocation (no bit-shifting needed to teach the concept).
// ---------------------------------------------------------------------------

export type Hextets = number[]; // length 8

export const DOMAIN_HEXTETS: [number, number, number] = [0x2001, 0x0db8, 0x0100];
export const LOCATOR_LENGTH = 64;
export const FUNCTION_LENGTH = 16;
export const ARGUMENT_LENGTH = 0;
export const ROUTER_LOCATOR_ID: Record<RouterId, number> = { R1: 1, R2: 2, R3: 3, R4: 4, R5: 5, R6: 6 };
export const END_FUNCTION = 1;

/** RFC 5952-style compression: replace the single longest run of 2+ zero hextets with "::". */
export function fmtIpv6(hextets: Hextets): string {
  let bestStart = -1;
  let bestLen = 0;
  let curStart = -1;
  let curLen = 0;
  for (let i = 0; i < hextets.length; i++) {
    if (hextets[i] === 0) {
      if (curStart === -1) curStart = i;
      curLen++;
      if (curLen > bestLen) {
        bestLen = curLen;
        bestStart = curStart;
      }
    } else {
      curStart = -1;
      curLen = 0;
    }
  }
  if (bestLen >= 2) {
    const before = hextets.slice(0, bestStart).map((h) => h.toString(16));
    const after = hextets.slice(bestStart + bestLen).map((h) => h.toString(16));
    return `${before.join(":")}::${after.join(":")}`;
  }
  return hextets.map((h) => h.toString(16)).join(":");
}

export function hextetsEqual(a: Hextets, b: Hextets): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function routerLocatorHextets(router: RouterId): number[] {
  return [...DOMAIN_HEXTETS, ROUTER_LOCATOR_ID[router]];
}

/** LOC:FUNCT:ARG -> full 128-bit SID. `arg` always 0 in this lesson (ARGUMENT_LENGTH = 0). */
export function buildSrv6Sid(locator4: number[], functionValue: number, arg = 0): Hextets {
  return [...locator4, functionValue, arg, 0, 0];
}

export function decomposeSrv6Sid(hextets: Hextets): { locator4: number[]; functionValue: number; arg: number } {
  return { locator4: hextets.slice(0, 4), functionValue: hextets[4], arg: hextets[5] };
}

export function functionHexText(functionValue: number): string {
  return `0x${functionValue.toString(16).padStart(4, "0")}`;
}

export function locatorHextetsFor(router: RouterId): Hextets {
  return [...routerLocatorHextets(router), 0, 0, 0, 0];
}
export function locatorTextFor(router: RouterId): string {
  return `${fmtIpv6(locatorHextetsFor(router))}/${LOCATOR_LENGTH}`;
}
export function endSidHextets(router: RouterId): Hextets {
  return buildSrv6Sid(routerLocatorHextets(router), END_FUNCTION);
}
export function endSidText(router: RouterId): string {
  return fmtIpv6(endSidHextets(router));
}

// ---------------------------------------------------------------------------
// Locators (advertised, routable prefixes) — independent of whether any
// SID under a locator has actually been instantiated.
// ---------------------------------------------------------------------------

export interface Srv6Locator {
  router: RouterId;
  hextets: Hextets;
  prefixLength: number;
  text: string;
  advertised: boolean;
}
export function buildLocators(): Srv6Locator[] {
  return ALL_ROUTERS.map((r) => ({ router: r, hextets: locatorHextetsFor(r), prefixLength: LOCATOR_LENGTH, text: locatorTextFor(r), advertised: true }));
}

export function ownerRouterForSid(daHextets: Hextets, locators: Srv6Locator[]): RouterId | undefined {
  const loc4 = daHextets.slice(0, 4);
  return locators.find((l) => l.hextets.slice(0, 4).every((v, i) => v === loc4[i]))?.router;
}

// ---------------------------------------------------------------------------
// IPv6 underlay — IGP shortest path (brute-force, same technique as
// srMplsFoundations.ts: trivial to verify correct by inspection on a
// 6-node topology; re-derived per-file since RouterId differs per lesson)
// ---------------------------------------------------------------------------

function neighborsOf(router: RouterId, links: LinkDef[]): { to: RouterId; metric: number }[] {
  const out: { to: RouterId; metric: number }[] = [];
  for (const l of links) {
    if (l.a === router) out.push({ to: l.b, metric: l.metric });
    if (l.b === router) out.push({ to: l.a, metric: l.metric });
  }
  return out;
}
function allSimplePaths(links: LinkDef[], from: RouterId, to: RouterId): RouterId[][] {
  const results: RouterId[][] = [];
  const visit = (current: RouterId, path: RouterId[], visited: Set<RouterId>) => {
    if (current === to) {
      results.push(path);
      return;
    }
    for (const n of neighborsOf(current, links)) {
      if (visited.has(n.to)) continue;
      visited.add(n.to);
      visit(n.to, [...path, n.to], visited);
      visited.delete(n.to);
    }
  };
  visit(from, [from], new Set([from]));
  return results;
}
function pathCost(path: RouterId[], links: LinkDef[]): number {
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const link = links.find((l) => (l.a === path[i] && l.b === path[i + 1]) || (l.a === path[i + 1] && l.b === path[i]));
    total += link?.metric ?? Infinity;
  }
  return total;
}
export interface IgpPathResult {
  path: RouterId[];
  cost: number;
}
export function computeIgpShortestPath(links: LinkDef[], from: RouterId, to: RouterId): IgpPathResult | undefined {
  if (from === to) return { path: [from], cost: 0 };
  const candidates = allSimplePaths(links, from, to).map((path) => ({ path, cost: pathCost(path, links) }));
  candidates.sort((a, b) => a.cost - b.cost);
  return candidates[0];
}
export function nextHopToward(links: LinkDef[], from: RouterId, to: RouterId): RouterId | undefined {
  const result = computeIgpShortestPath(links, from, to);
  return result && result.path.length > 1 ? result.path[1] : undefined;
}
export function linkIdBetween(a: RouterId, b: RouterId, links: LinkDef[] = LINKS): LinkId | undefined {
  return links.find((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a))?.id;
}

// ---------------------------------------------------------------------------
// IPv6 FIB — locator-aggregated. No individual /128 route for any one
// SID; every router under a locator shares one aggregate route.
// ---------------------------------------------------------------------------

export interface Ipv6FibRow {
  locatorPrefix: string;
  ownerRouter: RouterId;
  nextHop?: RouterId;
}
export function buildIpv6Fib(observer: RouterId, links: LinkDef[], locators: Srv6Locator[]): Ipv6FibRow[] {
  return locators
    .filter((l) => l.router !== observer)
    .map((l) => ({ locatorPrefix: l.text, ownerRouter: l.router, nextHop: nextHopToward(links, observer, l.router) }));
}

// ---------------------------------------------------------------------------
// Local SID Table — the per-node binding of one SID to one behavior.
// Only routers that actually own an instantiated End SID appear here
// at all (R3, R5, R6 in this lesson) — absence from the table IS the
// deterministic fault model (§56), not a separate "MISSING" flag.
// ---------------------------------------------------------------------------

export type Srv6Behavior = "End";
export interface LocalSidEntry {
  sidHextets: Hextets;
  sidText: string;
  locatorText: string;
  functionValue: number;
  functionText: string;
  behavior: Srv6Behavior;
  owner: RouterId;
  parameters?: string;
}
export function installLocalSid(router: RouterId): LocalSidEntry {
  const hextets = endSidHextets(router);
  return {
    sidHextets: hextets,
    sidText: fmtIpv6(hextets),
    locatorText: locatorTextFor(router),
    functionValue: END_FUNCTION,
    functionText: functionHexText(END_FUNCTION),
    behavior: "End",
    owner: router,
    parameters: "none",
  };
}
export function lookupLocalSid(router: RouterId, daHextets: Hextets, table: Partial<Record<RouterId, LocalSidEntry>>): LocalSidEntry | undefined {
  const entry = table[router];
  return entry && hextetsEqual(entry.sidHextets, daHextets) ? entry : undefined;
}

// ---------------------------------------------------------------------------
// SRH / packet model (RFC 8754)
// ---------------------------------------------------------------------------

export interface SrhSegment {
  /** Storage index in Segment List[] — 0 is always the FINAL segment, never reordered as processing advances. */
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
export interface Ipv6PacketState {
  srcText: string;
  daHextets: Hextets;
  hopLimit: number;
  srh?: SegmentRoutingHeader;
}

export const HOST_BEHIND_R1 = "2001:db8:100:1:0:0:0:a";
export const HOST_BEHIND_R6 = "2001:db8:100:6:0:0:0:b";

/**
 * High-level order <S1, S2, ..., Sn> -> full SRH. Storage order is
 * REVERSED relative to travel order: Segment List[0] is always the
 * FINAL segment (Sn), Segment List[n-1] is the FIRST segment (S1).
 * DA is imposed as S1's SID; Segments Left = Last Entry = n-1.
 */
export function buildFullSrh(highLevelOrder: RouterId[]): SegmentRoutingHeader {
  const n = highLevelOrder.length;
  const storageOrder = [...highLevelOrder].reverse();
  const segmentList: SrhSegment[] = storageOrder.map((r, i) => ({ index: i, sidHextets: endSidHextets(r), sidText: endSidText(r), ownerRouter: r }));
  return {
    nextHeader: "58 (ICMPv6 probe)",
    hdrExtLen: n * 2, // RFC 8754: 8-octet units, excluding the first 8 octets; each 128-bit SID = 2 units
    routingType: 4,
    segmentsLeft: n - 1,
    lastEntry: n - 1,
    flags: "0x00",
    tag: 0,
    segmentList,
  };
}
export function buildSingleSidPacket(target: RouterId, src: string = HOST_BEHIND_R1): Ipv6PacketState {
  return { srcText: src, daHextets: endSidHextets(target), hopLimit: 64 };
}
export function buildMultiSidPacket(highLevelOrder: RouterId[], src: string = HOST_BEHIND_R1): Ipv6PacketState {
  const srh = buildFullSrh(highLevelOrder);
  return { srcText: src, daHextets: endSidHextets(highLevelOrder[0]), hopLimit: 64, srh };
}

export function validateSrh(srh: SegmentRoutingHeader): { valid: boolean; reason?: string } {
  if (srh.segmentList.length === 0) return { valid: false, reason: "Empty segment list." };
  if (srh.lastEntry !== srh.segmentList.length - 1) return { valid: false, reason: "Last Entry inconsistent with Segment List length." };
  if (srh.segmentsLeft > srh.lastEntry) return { valid: false, reason: "Segments Left exceeds Last Entry." };
  return { valid: true };
}

/** The active segment IS the IPv6 Destination Address — not a stored "active" flag on any SRH row. */
export function determineActiveSid(daHextets: Hextets): Hextets {
  return daHextets;
}

export function processIpv6Transit(router: RouterId, daHextets: Hextets, links: LinkDef[], locators: Srv6Locator[]): { ownerRouter?: RouterId; nextHop?: RouterId } {
  const ownerRouter = ownerRouterForSid(daHextets, locators);
  if (!ownerRouter) return {};
  return { ownerRouter, nextHop: nextHopToward(links, router, ownerRouter) };
}

/** The DA/Segments-Left mutation at the heart of End processing (RFC 8754 §4.1 step 4-6, non-final case). */
export function advanceSegment(srh: SegmentRoutingHeader): { segmentsLeft: number; newDaHextets: Hextets } {
  const segmentsLeft = srh.segmentsLeft - 1;
  return { segmentsLeft, newDaHextets: srh.segmentList[segmentsLeft].sidHextets };
}

export interface EndResult {
  newDaHextets: Hextets;
  newSrh?: SegmentRoutingHeader;
  final: boolean;
}
/** End behavior for a VALID match (ownership/state already confirmed by the caller). */
export function executeEndBehavior(daHextets: Hextets, srh: SegmentRoutingHeader | undefined): EndResult {
  if (!srh) return { newDaHextets: daHextets, newSrh: undefined, final: true };
  if (srh.segmentsLeft === 0) return { newDaHextets: daHextets, newSrh: srh, final: true };
  const { segmentsLeft, newDaHextets } = advanceSegment(srh);
  return { newDaHextets, newSrh: { ...srh, segmentsLeft }, final: false };
}

/** Read-only path preview for the segment-list lab: chains each segment's own locator sub-path in turn. No per-hop SRH mutation detail — that lives in the scripted narrative steps. */
export function computeSrv6PacketPath(highLevelOrder: RouterId[], links: LinkDef[] = LINKS, headend: RouterId = HEADEND): RouterId[] {
  let current = headend;
  const path: RouterId[] = [current];
  for (const target of highLevelOrder) {
    const sub = computeIgpShortestPath(links, current, target);
    if (!sub) break;
    path.push(...sub.path.slice(1));
    current = target;
  }
  return path;
}

// ---------------------------------------------------------------------------
// Packet layers / visuals
// ---------------------------------------------------------------------------

function ipv6Layer(pkt: Ipv6PacketState): PacketLayer {
  return {
    name: "IPv6 Header",
    color: "var(--pv-proto-ipv6)",
    fields: [
      { label: "Source Address", value: pkt.srcText },
      { label: "Destination Address (active segment)", value: fmtIpv6(pkt.daHextets) },
      { label: "Hop Limit", value: String(pkt.hopLimit) },
    ],
  };
}
function srhPacketLayer(srh: SegmentRoutingHeader): PacketLayer {
  return {
    name: `Segment Routing Header (SL=${srh.segmentsLeft}, LE=${srh.lastEntry})`,
    color: "var(--pv-proto-srh)",
    fields: [
      { label: "Next Header", value: srh.nextHeader },
      { label: "Hdr Ext Len", value: String(srh.hdrExtLen) },
      { label: "Routing Type", value: `${srh.routingType} (SRH)` },
      { label: "Segments Left", value: String(srh.segmentsLeft) },
      { label: "Last Entry", value: String(srh.lastEntry) },
      { label: "Flags", value: srh.flags },
      { label: "Tag", value: String(srh.tag) },
      ...srh.segmentList.map((s) => ({ label: `Segment List[${s.index}]`, value: s.sidText })),
    ],
  };
}
function payloadLayer(): PacketLayer {
  return { name: "Payload", color: "var(--pv-border-strong)", fields: [{ label: "Conceptual destination", value: "Application endpoint behind R6" }] };
}
export function buildIpv6PacketLayers(pkt: Ipv6PacketState): PacketLayer[] {
  return [ipv6Layer(pkt), ...(pkt.srh ? [srhPacketLayer(pkt.srh)] : []), payloadLayer()];
}
function ipv6Packet(id: string, from: RouterId, to: RouterId, summary: string, badge: string, pkt: Ipv6PacketState): PacketVisual {
  return { id, protocol: "IPV6", from, to, summary, badge, layers: buildIpv6PacketLayers(pkt) };
}

// ---------------------------------------------------------------------------
// Graph layout
// ---------------------------------------------------------------------------

export const GRAPH_NODES = [
  { id: "R1", label: "R1", x: 5, y: 50, subLabel: "Headend" },
  { id: "R2", label: "R2", x: 35, y: 15 },
  { id: "R3", label: "R3", x: 65, y: 15, subLabel: "Owns End SID" },
  { id: "R6", label: "R6", x: 95, y: 50, subLabel: "Destination" },
  { id: "R4", label: "R4", x: 35, y: 85 },
  { id: "R5", label: "R5", x: 65, y: 85, subLabel: "Owns End SID" },
];
export const GRAPH_EDGES: { id: LinkId; a: RouterId; b: RouterId }[] = LINKS.map((l) => ({ id: l.id, a: l.a, b: l.b }));

// ---------------------------------------------------------------------------
// Top-level scenario state
// ---------------------------------------------------------------------------

export type FwdAction = "SR_POLICY_HEADEND" | "IPV6_FIB_FORWARD" | "LOCAL_SID_MATCH" | "END_BEHAVIOR" | "DA_UPDATE" | "FINAL_END" | "DELIVER" | "DROP_MISSING_LOCAL_SID";
export interface JourneyHop {
  router: RouterId;
  input: string;
  lookup: string;
  action: FwdAction;
  output: string;
}

export interface TroubleshootingState {
  started: boolean;
  repairAttempt?: { choice: string; correct: boolean };
  correctVerified: boolean;
}

export interface Srv6State {
  links: LinkDef[];
  locators: Srv6Locator[];
  localSidTable: Partial<Record<RouterId, LocalSidEntry>>;
  packet?: Ipv6PacketState;
  packetAt?: RouterId;
  journey: JourneyHop[];
  highLevelOrder?: RouterId[];
  locatorMetricChanged: boolean;
  fault?: { reason: string };
  troubleshooting: TroubleshootingState;
}

export function createSrv6State(): Srv6State {
  return {
    links: LINKS,
    locators: buildLocators(),
    localSidTable: { R3: installLocalSid("R3"), R5: installLocalSid("R5"), R6: installLocalSid("R6") },
    journey: [],
    locatorMetricChanged: false,
    troubleshooting: { started: false, correctVerified: false },
  };
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

const R3_SID = endSidText("R3");
const R5_SID = endSidText("R5");
const R6_SID = endSidText("R6");

export const srv6Steps: ScenarioStep<Srv6State>[] = [
  // --- 1. Central question -------------------------------------------------
  {
    id: "intro",
    label: "The Central Question",
    narrative:
      "You've built SR-MPLS segment lists — a segment is an MPLS SID/label, imposed as a label stack. This lesson asks: what happens when Segment Routing is instantiated directly in the IPv6 data plane instead of MPLS?",
  },
  {
    id: "recap-sr-mpls",
    label: "Recap: SR-MPLS",
    narrative: "SR-MPLS: segment → MPLS SID/label → label stack. The active segment is whichever label sits on top of the stack.",
  },
  {
    id: "predict-srv6-is-mpls-in-ipv6",
    label: "Predict",
    narrative: "Before defining SRv6:",
    question: {
      prompt: "Is SRv6 accurately described as \"MPLS labels written as IPv6 addresses\"?",
      options: [
        { id: "no", label: "No — the forwarding/programming model is genuinely different, not a re-encoding of MPLS" },
        { id: "yes", label: "Yes — it's the same MPLS mechanism with IPv6-shaped labels" },
      ],
      correctOptionId: "no",
      explanation: "SRv6 segments are 128-bit IPv6 addresses forwarded by ordinary IPv6 routing, with behavior execution driven by a per-node Local SID Table — not an MPLS label-switching mechanism wearing an IPv6 costume.",
    },
  },
  {
    id: "srv6-intro",
    label: "Introduce: SRv6",
    narrative: "SRv6: segment → 128-bit IPv6 SID → IPv6 forwarding + local SID behavior. The IPv6 data plane itself carries the segment — no MPLS label stack underneath.",
  },
  {
    id: "signature-sr-mpls-vs-srv6",
    label: "Signature Visual: Active Segment",
    narrative: "SR-MPLS: the active segment is the top MPLS label — [16003, 16006, IP]. SRv6: the active segment is the IPv6 Destination Address itself, with an SRH carrying whatever remains of the segment program.",
  },
  {
    id: "what-is-a-sid",
    label: "What Is An SRv6 SID?",
    narrative: "An SRv6 SID is a 128-bit IPv6 address explicitly instantiated and bound to a segment/instruction. Mandatory distinction: an ordinary IPv6 address is NOT automatically an SRv6 SID — it must be instantiated with a behavior binding first.",
  },
  {
    id: "predict-q1-every-address-is-sid",
    label: "Predict",
    narrative: "Before going further:",
    question: {
      prompt: "Is every IPv6 address on an SRv6 router automatically an SRv6 SID?",
      options: [
        { id: "no", label: "No — a SID must be explicitly instantiated and bound to a behavior" },
        { id: "yes", label: "Yes — any address a router owns can be used as a SID" },
      ],
      correctOptionId: "no",
      explanation: "A router can own many ordinary IPv6 addresses (interfaces, loopbacks) that were never bound to any segment behavior. Only an address explicitly instantiated in a Local SID Table is a SID.",
    },
  },

  // --- 2. SID structure ------------------------------------------------------
  {
    id: "sid-structure-intro",
    label: "SID Structure — LOC:FUNCT:ARG",
    narrative: "RFC 8986 structures a SID as LOC : FUNCT : ARG. LOC (Locator) guides ordinary IPv6 forwarding toward the owning node. FUNCT (Function) identifies the local instruction. ARG (Argument) is optional, consumed only by behaviors that define argument semantics.",
  },
  {
    id: "sid-layout-domain",
    label: "This Lesson's SID Layout",
    narrative: `Domain prefix 2001:db8:100::/48. Each SRv6 node gets a /${LOCATOR_LENGTH} locator: R1 ${locatorTextFor("R1")}, R2 ${locatorTextFor("R2")}, R3 ${locatorTextFor("R3")}, R4 ${locatorTextFor("R4")}, R5 ${locatorTextFor("R5")}, R6 ${locatorTextFor("R6")}.`,
  },
  {
    id: "sid-layout-lengths",
    label: "Locator / Function / Argument Lengths",
    narrative: `Locator length = ${LOCATOR_LENGTH}. Function field = ${FUNCTION_LENGTH} bits. Argument field = ${ARGUMENT_LENGTH} bits. Remaining low-order bits are zero. This is a deliberately transparent educational allocation, not a universal requirement.`,
  },
  {
    id: "build-r3-sid",
    label: "Derive R3's End SID",
    narrative: `R3's locator is ${locatorTextFor("R3")}. Its End SID, function ${functionHexText(END_FUNCTION)}, is ${R3_SID} — derived from the SID structure, not a scattered hardcoded string.`,
  },
  {
    id: "build-r6-sid",
    label: "Derive R6's End SID",
    narrative: `R6's locator is ${locatorTextFor("R6")}. Its End SID is ${R6_SID}.`,
  },
  {
    id: "arg-treatment",
    label: "ARG Is Optional",
    narrative: "The main End SID in this lesson uses zero ARG bits — so it's clear arguments are NOT something every SID requires. Argument-aware behaviors are previewed later, not implemented here.",
  },
  {
    id: "locator-is-routable",
    label: "The Locator Is Routable",
    narrative: `Transit forwarding does not require every transit router to know every individual SID. Transit nodes route toward ${locatorTextFor("R3")} using ordinary IPv6 forwarding — R3 itself owns whatever specific local SIDs exist under that locator.`,
  },
  {
    id: "predict-q6-locator-vs-local-sid",
    label: "Predict",
    narrative: "Before installing any local SID behavior:",
    question: {
      prompt: "Is a locator route the same thing as a local SID entry?",
      options: [
        { id: "no", label: "No — a locator route says how to REACH the owner; a local SID entry says what the owner DOES with one specific SID" },
        { id: "yes", label: "Yes — advertising the locator is the same as instantiating the SID" },
      ],
      correctOptionId: "no",
      explanation: "\"How do I reach R3?\" (locator route) and \"what does R3 do when this exact SID becomes active?\" (local SID entry) are two different questions, answered by two different tables.",
    },
  },
  {
    id: "locator-vs-local-sid",
    label: "Mandatory Distinction",
    narrative: "LOCATOR ROUTE — \"How do I reach R3?\" ≠ LOCAL SID ENTRY — \"What does R3 do when this exact SID becomes active?\" This distinction drives the troubleshooting incident later in this lesson.",
  },

  // --- 3. Topology / underlay -------------------------------------------------
  {
    id: "topology-intro",
    label: "Topology and IGP Costs",
    narrative: "R1 (headend) and R6 (destination) are connected by two paths: top via R2, R3 (cost 10 each, total 30) and bottom via R4, R5 (cost 5 each, total 15). R1 and R6 are not directly connected.",
  },
  {
    id: "predict-igp-shortest-default",
    label: "Predict",
    narrative: "Before any SRv6 SID is used at all:",
    question: {
      prompt: "With no SRv6 policy in effect, which path does ordinary IPv6 forwarding take from R1 toward R6?",
      options: [
        { id: "bottom", label: "R1 → R4 → R5 → R6 (cost 15) — the IGP shortest path" },
        { id: "top", label: "R1 → R2 → R3 → R6 (cost 30)" },
      ],
      correctOptionId: "bottom",
      explanation: "Ordinary IPv6 forwarding follows the IGP shortest path — cost 15 via R4/R5 beats cost 30 via R2/R3.",
    },
  },
  {
    id: "underlay-first",
    label: "Underlay First",
    narrative: "Before any SRH: IPv6 IGP adjacencies, locator reachability, and each router's IPv6 FIB. R1 can already route toward R3's locator and R6's locator using nothing but ordinary IPv6 forwarding.",
  },
  {
    id: "locator-fib-r1",
    label: "R1's IPv6 FIB",
    narrative: "R1's FIB holds one aggregate route per locator prefix — not one route per individual SID. This is the underlay everything else in this lesson rides on top of.",
  },
  {
    id: "transit-node-requirement",
    label: "Transit-Node Requirement",
    narrative: "Mandatory rule: a transit router whose destination is not one of its own locally-instantiated SIDs behaves as an ordinary IPv6 transit router. It does not execute another router's End behavior merely because it can see an SRH.",
  },

  // --- 4. Local SID table -----------------------------------------------------
  {
    id: "local-sid-table-intro",
    label: "The Local SID Table",
    narrative: `R3, R5, and R6 each instantiate one End SID: R3 = ${R3_SID}, R5 = ${R5_SID}, R6 = ${R6_SID}. Installing a SID in a Local SID Table is what makes it a real segment, not just an address.`,
  },
  {
    id: "sid-db-vs-fib",
    label: "IPv6 FIB vs. Local SID Table",
    narrative: "Device Explorer deliberately keeps these separate tabs: IPv6 FIB (how to reach any locator) and Local SID Table (what this exact node does when one of its own SIDs is active). They are never merged into one vague \"routing table.\"",
  },

  // --- 5. Single-SID, no SRH ---------------------------------------------------
  {
    id: "single-sid-intro",
    label: "One SID, No SRH",
    narrative: `Before multiple segments: a single-SID policy toward R6's End SID (${R6_SID}) needs no SRH at all when no SRH-specific flags, tag, or TLVs are required. SRv6 does NOT mean "every packet must carry an SRH."`,
  },
  {
    id: "predict-q5-single-sid-no-srh",
    label: "Predict",
    narrative: "Before sending:",
    question: {
      prompt: "Can a valid single-SID SRv6 policy exist without an SRH?",
      options: [
        { id: "yes", label: "Yes — when no SRH-specific information is needed, the IPv6 DA alone carries the whole policy" },
        { id: "no", label: "No — SRv6 packets always require an SRH" },
      ],
      correctOptionId: "yes",
      explanation: "The active segment is the DA. A one-segment policy needs nothing else — the SRH exists to carry a remaining segment list, and there isn't one here.",
    },
  },
  {
    id: "send-single-sid",
    label: "Send Toward R6's End SID",
    narrative: `A host behind R1 sends toward R6's End SID. The classified packet: IPv6 DA = ${R6_SID}, no SRH.`,
    packet: () => ({ id: "ipv6-single-classify", protocol: "IPV6", from: "R1", to: "R1", summary: "Packet classified for R6 End SID", layers: buildIpv6PacketLayers(buildSingleSidPacket("R6")) }),
    run: (state) => ({ state: { ...state, packet: buildSingleSidPacket("R6"), packetAt: "R1", journey: [], highLevelOrder: ["R6"] }, events: [{ type: "PACKET_SENT", stepId: "send-single-sid", timestamp: Date.now(), message: `Sent toward R6 End SID ${R6_SID}, no SRH` }] }),
  },
  {
    id: "r1-single-fib",
    label: "R1: IPv6 FIB Lookup",
    narrative: "R1's own local SID table has no match for this DA — it does an ordinary IPv6 FIB lookup toward R6's locator and forwards toward R4 (the IGP shortest path).",
    packet: (state) => (state.packet ? ipv6Packet("single-r1-fib", "R1", "R4", "IPv6 FIB forward toward R6 locator", "FIB", state.packet) : undefined),
    run: (state) => ({ state: { ...state, packetAt: "R4", journey: [...state.journey, { router: "R1", input: fmtIpv6(state.packet!.daHextets), lookup: "Local SID table: no match. IPv6 FIB: shortest path to R6 locator via R4", action: "IPV6_FIB_FORWARD", output: fmtIpv6(state.packet!.daHextets) }] }, events: [] }),
  },
  {
    id: "r4-single-transit",
    label: "R4: Ordinary Transit",
    narrative: "R4 has no local SID matching this DA — ordinary IPv6 transit forwarding toward R5.",
    packet: (state) => (state.packet ? ipv6Packet("single-r4", "R4", "R5", "IPv6 FIB forward (unchanged)", "FIB", state.packet) : undefined),
    run: (state) => ({ state: { ...state, packetAt: "R5", journey: [...state.journey, { router: "R4", input: fmtIpv6(state.packet!.daHextets), lookup: "Local SID table: no match. IPv6 FIB: shortest path to R6 locator via R5", action: "IPV6_FIB_FORWARD", output: fmtIpv6(state.packet!.daHextets) }] }, events: [] }),
  },
  {
    id: "r5-single-transit",
    label: "R5: Ordinary Transit",
    narrative: "R5 owns its own End SID — but this DA doesn't match it. No local SID match here either, so R5 is an ordinary transit hop for this packet, forwarding directly to R6.",
    packet: (state) => (state.packet ? ipv6Packet("single-r5", "R5", "R6", "IPv6 FIB forward (unchanged)", "FIB", state.packet) : undefined),
    run: (state) => ({ state: { ...state, packetAt: "R6", journey: [...state.journey, { router: "R5", input: fmtIpv6(state.packet!.daHextets), lookup: "Local SID table: no match (R5's own End SID is different). IPv6 FIB: directly connected to R6", action: "IPV6_FIB_FORWARD", output: fmtIpv6(state.packet!.daHextets) }] }, events: [] }),
  },
  {
    id: "r6-single-local-match-deliver",
    label: "R6: Local SID Match — Deliver",
    narrative: "R6's Local SID Table matches this DA to its own End SID. No SRH is present, so there is nothing to advance — End completes and the packet is delivered. Path taken: R1 → R4 → R5 → R6, the IGP shortest path toward R6's locator.",
    packet: (state) => (state.packet ? { id: "single-delivered", protocol: "IPV6", from: "R6", to: "R6", summary: "Delivered via R6 End SID", layers: buildIpv6PacketLayers(state.packet) } : undefined),
    run: (state) => ({ state: { ...state, journey: [...state.journey, { router: "R6", input: fmtIpv6(state.packet!.daHextets), lookup: "Local SID table: MATCH (End). No SRH present — nothing to advance.", action: "DELIVER", output: "Delivered" }] }, events: [{ type: "PACKET_RECEIVED", stepId: "r6-single-local-match-deliver", timestamp: Date.now(), message: "Delivered via R6 End SID, no SRH" }] }),
    whatChanged: () => ["Delivered R1 → R4 → R5 → R6 — a full SRv6 policy, zero SRH bytes on the wire"],
  },
  {
    id: "single-sid-recap",
    label: "No Fake SRH",
    narrative: "Notice the Packet Inspector never showed an empty SRH for this packet — SRv6 does not mean every packet carries the extension header, and this lesson never renders one that isn't actually there.",
  },

  // --- 6. Multi-SID / SRH -------------------------------------------------------
  {
    id: "multi-sid-need",
    label: "A New Requirement",
    narrative: "Requirement: reach R6, but first visit R3. A single End SID toward R6 can't express that — it needs an ordered program of more than one segment.",
    run: (state) => ({ state: { ...state, packet: undefined, packetAt: undefined, journey: [], highLevelOrder: undefined }, events: [] }),
  },
  {
    id: "high-level-order-intro",
    label: "High-Level SID Program",
    narrative: "High-level notation <S1, S2> — S1 is the first segment, S2 is the final segment. For this requirement: S1 = R3 End SID, S2 = R6 End SID.",
  },
  {
    id: "predict-q3-segment-list-0",
    label: "Predict",
    narrative: "Before revealing the SRH encoding for <R3, R6>:",
    question: {
      prompt: "What is Segment List[0] once <R3, R6> is encoded into a full SRH?",
      options: [
        { id: "r6", label: "R6's End SID" },
        { id: "r3", label: "R3's End SID" },
      ],
      correctOptionId: "r6",
      explanation: "SRH storage order is reversed relative to travel order — Segment List[0] is always the FINAL segment, which is R6 here, not the first one visited.",
    },
  },
  {
    id: "srh-reversed-encoding",
    label: "SRH Storage Order Is Reversed",
    narrative: `High-level <R3, R6> encodes as: DA = ${R3_SID} (R3), Last Entry = 1, Segments Left = 1, Segment List[0] = ${R6_SID} (R6), Segment List[1] = ${R3_SID} (R3). Segment List[0] is the FINAL segment, not the first.`,
  },
  {
    id: "full-srh-mode-note",
    label: "Full SRH, Deliberately",
    narrative: "This lesson deliberately uses a full SRH (the complete Segment List stays on the wire) rather than Reduced SRH, so the whole segment program remains visible. This is not the only valid SRH encoding strategy — just the clearest one to teach from.",
  },
  {
    id: "srh-viewer-intro",
    label: "The SRH, Built For Real",
    narrative: "The SRH below is built by buildFullSrh([\"R3\",\"R6\"]) from real state — not hardcoded.",
    run: (state) => ({ state: { ...state, packet: buildMultiSidPacket(["R3", "R6"]), packetAt: "R1", journey: [], highLevelOrder: ["R3", "R6"] }, events: [] }),
  },
  {
    id: "predict-q2-active-segment-location",
    label: "Predict",
    narrative: "Before sending:",
    question: {
      prompt: "Where is the currently active SRv6 segment represented?",
      options: [
        { id: "da", label: "The IPv6 Destination Address" },
        { id: "srh-row", label: "Whichever SRH Segment List row is drawn highlighted" },
      ],
      correctOptionId: "da",
      explanation: "The active segment is the IPv6 DA itself. The SRH's Segment List helps determine what comes NEXT — it doesn't define what's active right now.",
    },
  },
  {
    id: "active-segment-rule",
    label: "Mandatory: Active Segment = IPv6 DA",
    narrative: "The active SRv6 segment is the IPv6 Destination Address. Do not read \"whichever SRH row is highlighted\" as the definition — the SRH only helps determine what happens after the current segment completes.",
  },
  {
    id: "initial-packet-r1",
    label: "R1: Classify Into The Segment List",
    narrative: `At R1: IPv6 SA = host behind R1, IPv6 DA = R3 End SID (${R3_SID}). SRH Segment List[0] = ${R6_SID}, Segment List[1] = ${R3_SID}. Last Entry = 1, Segments Left = 1.`,
    packet: () => ({ id: "multi-classify", protocol: "IPV6", from: "R1", to: "R1", summary: "Classified for the <R3, R6> segment program", badge: "HEADEND", layers: buildIpv6PacketLayers(buildMultiSidPacket(["R3", "R6"])) }),
    run: (state) => ({
      state: { ...state, packet: buildMultiSidPacket(["R3", "R6"]), packetAt: "R1", journey: [], highLevelOrder: ["R3", "R6"] },
      events: [{ type: "PACKET_SENT", stepId: "initial-packet-r1", timestamp: Date.now(), message: "Imposed DA=R3 End SID with full SRH <R3,R6>" }],
    }),
  },
  {
    id: "r1-forwards-toward-r3",
    label: "R1: Route Toward R3's Locator",
    narrative: "R1 does not \"pop\" a SID — it routes the packet using ordinary IPv6 forwarding toward the active DA's locator. Physical path so far: R1 → R2 (the only path toward R3's locator).",
    packet: (state) => (state.packet ? ipv6Packet("multi-r1", "R1", "R2", "IPv6 FIB forward toward R3 locator", "FIB", state.packet) : undefined),
    run: (state) => ({ state: { ...state, packetAt: "R2", journey: [...state.journey, { router: "R1", input: fmtIpv6(state.packet!.daHextets), lookup: "Local SID table: no match. IPv6 FIB: shortest path to R3 locator via R2", action: "IPV6_FIB_FORWARD", output: fmtIpv6(state.packet!.daHextets) }] }, events: [] }),
  },
  {
    id: "predict-q4-transit-decrements-sl",
    label: "Predict",
    narrative: "R2 is about to forward a packet that carries an SRH.",
    question: {
      prompt: "Does an ordinary IPv6 transit router decrement Segments Left just because the packet it's forwarding contains an SRH?",
      options: [
        { id: "no", label: "No — only the router that actually owns and executes the active SID touches Segments Left" },
        { id: "yes", label: "Yes — every router that forwards an SRH-carrying packet decrements Segments Left" },
      ],
      correctOptionId: "no",
      explanation: "R2 is not the active segment's owner. It does an ordinary IPv6 FIB lookup and forwards — DA, Segments Left, and the Segment List are all untouched.",
    },
  },
  {
    id: "r2-transit",
    label: "R2: Ordinary Transit — SRH Unchanged",
    narrative: "R2's local SID table has no match for this DA (it isn't R2's own SID). Ordinary IPv6 FIB lookup, forward toward R3 — DA, Segments Left, and the Segment List are all unchanged.",
    packet: (state) => (state.packet ? ipv6Packet("multi-r2", "R2", "R3", "IPv6 FIB forward (SRH unchanged)", "FIB", state.packet) : undefined),
    run: (state) => ({ state: { ...state, packetAt: "R3", journey: [...state.journey, { router: "R2", input: fmtIpv6(state.packet!.daHextets), lookup: "Local SID table: no match. IPv6 FIB: shortest path to R3 locator — directly connected. SRH untouched.", action: "IPV6_FIB_FORWARD", output: fmtIpv6(state.packet!.daHextets) }] }, events: [] }),
    whatChanged: () => ["R2: ordinary IPv6 transit — Segments Left still 1, Segment List untouched"],
  },
  {
    id: "r3-local-sid-match",
    label: "R3: Local SID Match",
    narrative: `R3's Local SID Table matches this DA (${R3_SID}) to its own instantiated End SID. This is what triggers behavior execution — not merely "the packet arrived here."`,
    packet: (state) => (state.packet ? ipv6Packet("multi-r3-match", "R3", "R3", "Local SID match — behavior: End", "MATCH", state.packet) : undefined),
    run: (state) => ({ state: { ...state, journey: [...state.journey, { router: "R3", input: fmtIpv6(state.packet!.daHextets), lookup: "Local SID table: MATCH — owner R3, behavior End", action: "LOCAL_SID_MATCH", output: "Execute End" }] }, events: [] }),
  },
  {
    id: "r3-end-execute",
    label: "R3: Execute End",
    narrative: `Before: DA = ${R3_SID}, SL = 1. R3 executes End: decrement Segments Left (1 → 0), copy Segment List[0] into the IPv6 Destination Address. After: DA = ${R6_SID}, SL = 0.`,
    packet: (state) => {
      if (!state.packet?.srh) return undefined;
      const result = executeEndBehavior(state.packet.daHextets, state.packet.srh);
      return ipv6Packet("multi-r3-end", "R3", "R3", "End: SL 1→0, DA R3→R6", "END", { ...state.packet, daHextets: result.newDaHextets, srh: result.newSrh });
    },
    run: (state) => {
      if (!state.packet?.srh) return { state, events: [] };
      const result = executeEndBehavior(state.packet.daHextets, state.packet.srh);
      const newPacket: Ipv6PacketState = { ...state.packet, daHextets: result.newDaHextets, srh: result.newSrh };
      return {
        state: { ...state, packet: newPacket, journey: [...state.journey, { router: "R3", input: `${fmtIpv6(state.packet.daHextets)}, SL=1`, lookup: "End: decrement Segments Left, copy Segment List[0] into DA", action: "DA_UPDATE", output: `${fmtIpv6(result.newDaHextets)}, SL=0` }] },
        events: [{ type: "ROUTE_SELECTED", stepId: "r3-end-execute", timestamp: Date.now(), message: "R3 End: SL 1→0, DA R3→R6" }],
      };
    },
    whatChanged: () => ["R3 End behavior: Segments Left 1 → 0", "IPv6 Destination Address: R3 End SID → R6 End SID"],
  },
  {
    id: "r3-r6-forward",
    label: "R3: Forward Toward The New DA",
    narrative: `With the new DA (${R6_SID}), R3 does an ordinary IPv6 FIB lookup toward R6's locator — directly connected. R3 → R6.`,
    packet: (state) => (state.packet ? ipv6Packet("multi-r3-fwd", "R3", "R6", "IPv6 FIB forward toward new DA", "FIB", state.packet) : undefined),
    run: (state) => ({ state: { ...state, packetAt: "R6", journey: [...state.journey, { router: "R3", input: fmtIpv6(state.packet!.daHextets), lookup: "IPv6 FIB: shortest path to R6 locator — directly connected", action: "IPV6_FIB_FORWARD", output: fmtIpv6(state.packet!.daHextets) }] }, events: [] }),
  },
  {
    id: "r6-final-end",
    label: "R6: Final End (Segments Left = 0)",
    narrative: "R6's Local SID Table matches this DA to its own End SID. Segments Left is already 0 — this is the FINAL End: stop segment advancement (never decrement below zero) and continue to the next header.",
    packet: (state) => (state.packet ? ipv6Packet("multi-r6-final", "R6", "R6", "Final End — SL already 0", "END", state.packet) : undefined),
    run: (state) => ({ state: { ...state, journey: [...state.journey, { router: "R6", input: `${fmtIpv6(state.packet!.daHextets)}, SL=0`, lookup: "Local SID table: MATCH — owner R6, behavior End. Segments Left = 0: final segment.", action: "FINAL_END", output: "Next header / deliver" }] }, events: [] }),
  },
  {
    id: "r6-deliver-multi",
    label: "R6 Delivers",
    narrative: "R6 delivers the packet. Path taken: R1 → R2 → R3 → R6. R1→R2→R3 used two physical hops for the first segment; R3→R6 was one physical hop for the second — segment count and physical hop count are not the same thing.",
    packet: (state) => (state.packet ? { id: "multi-delivered", protocol: "IPV6", from: "R6", to: "R6", summary: "Delivered via <R3, R6>", layers: buildIpv6PacketLayers(state.packet) } : undefined),
    run: (state) => ({ state: { ...state, journey: [...state.journey, { router: "R6", input: "IPv6", lookup: "Delivery", action: "DELIVER", output: "Delivered" }] }, events: [{ type: "PACKET_RECEIVED", stepId: "r6-deliver-multi", timestamp: Date.now(), message: "Delivered R1 → R2 → R3 → R6 via <R3, R6>" }] }),
    whatChanged: () => ["Delivered R1 → R2 → R3 → R6 — the <R3, R6> segment program executed correctly"],
  },
  {
    id: "local-sid-table-is-programming",
    label: "The Local SID Table Is Behavior Programming",
    narrative: "R3's End SID behavior wasn't magically universal — it exists because R3's Local SID Table was explicitly programmed with that entry. A SID is locally instantiated and bound to a behavior; function bits alone don't define behavior everywhere.",
  },

  // --- 7. Locator aggregation / experiment ---------------------------------------
  {
    id: "locator-aggregation-demo",
    label: "Locator Aggregation",
    narrative: `R1's FIB carries ${locatorTextFor("R3")} as one aggregate route — no individual /128 route for ${R3_SID}. This is an important scale characteristic: the number of instantiated SIDs behind a locator never grows R1's FIB.`,
  },
  {
    id: "locator-experiment-intro",
    label: "Locator Experiment",
    narrative: "Change the IGP path toward a locator while its End SID stays exactly the same, and watch the physical path change. (This topology has only one physical path into R3, so the experiment runs against R6's locator — R6 genuinely has two paths.)",
  },
  {
    id: "locator-experiment-change-metric",
    label: `R4-R5 Metric: 5 → ${LOCATOR_EXPERIMENT_METRIC}`,
    narrative: `The R4-R5 metric changes to ${LOCATOR_EXPERIMENT_METRIC}. Bottom path cost is now 5+${LOCATOR_EXPERIMENT_METRIC}+5 = ${5 + LOCATOR_EXPERIMENT_METRIC + 5}; top path cost is still 30. The top path is now shortest toward R6's locator.`,
    run: (state) => ({ state: { ...state, links: state.links.map((l) => (l.id === LOCATOR_EXPERIMENT_LINK ? { ...l, metric: LOCATOR_EXPERIMENT_METRIC } : l)), locatorMetricChanged: true, packet: undefined, packetAt: undefined, journey: [] }, events: [] }),
    whatChanged: () => [`R4-R5: 5 → ${LOCATOR_EXPERIMENT_METRIC}`, "Shortest path to R6's locator is now R1 → R2 → R3 → R6 (cost 30)"],
  },
  {
    id: "locator-experiment-resend",
    label: "Send The Same Single SID Again",
    narrative: `Send the identical single-SID packet toward R6's End SID (${R6_SID}) again — same SID, unchanged.`,
    packet: () => ({ id: "locator-exp-classify", protocol: "IPV6", from: "R1", to: "R1", summary: "Same R6 End SID, unchanged", layers: buildIpv6PacketLayers(buildSingleSidPacket("R6")) }),
    run: (state) => ({ state: { ...state, packet: buildSingleSidPacket("R6"), packetAt: "R1", journey: [], highLevelOrder: ["R6"] }, events: [] }),
  },
  {
    id: "locator-experiment-r1-r2-r3-r6",
    label: "New Physical Path: R1 → R2 → R3 → R6",
    narrative: "Same End SID, same Local SID Table entry at R6 — but R1's IPv6 FIB now sends it via R2 and R3 instead of R4 and R5, because the IGP's shortest path toward R6's locator changed. R2 and R3 are both ordinary transit here (this DA is R6's End SID, not R3's).",
    packet: (state) => (state.packet ? ipv6Packet("locator-exp-fwd", "R1", "R6", "IPv6 FIB forward — new shortest path via R2, R3", "FIB", state.packet) : undefined),
    run: (state) => ({
      state: {
        ...state,
        packetAt: "R6",
        journey: [
          ...state.journey,
          { router: "R1", input: fmtIpv6(state.packet!.daHextets), lookup: "IPv6 FIB: shortest path to R6 locator now via R2", action: "IPV6_FIB_FORWARD", output: fmtIpv6(state.packet!.daHextets) },
          { router: "R2", input: fmtIpv6(state.packet!.daHextets), lookup: "Local SID table: no match. IPv6 FIB: shortest path to R6 locator via R3", action: "IPV6_FIB_FORWARD", output: fmtIpv6(state.packet!.daHextets) },
          { router: "R3", input: fmtIpv6(state.packet!.daHextets), lookup: "Local SID table: no match (this DA is R6's End SID, not R3's). IPv6 FIB: directly connected to R6", action: "IPV6_FIB_FORWARD", output: fmtIpv6(state.packet!.daHextets) },
          { router: "R6", input: fmtIpv6(state.packet!.daHextets), lookup: "Local SID table: MATCH (End). No SRH present.", action: "DELIVER", output: "Delivered" },
        ],
      },
      events: [],
    }),
    whatChanged: () => ["Delivered via R1 → R2 → R3 → R6 — same SID, new physical path"],
  },
  {
    id: "predict-q9-path-can-change",
    label: "Predict",
    narrative: "R6's End SID never changed through this experiment.",
    question: {
      prompt: "Can the physical path toward the same SRv6 SID change when the IGP path to its locator changes?",
      options: [
        { id: "yes", label: "Yes — the locator is routed by ordinary IPv6 forwarding, which is re-evaluated by whatever the IGP believes right now" },
        { id: "no", label: "No — a SID freezes the physical path it was first reached by" },
      ],
      correctOptionId: "yes",
      explanation: "Exactly like an SR-MPLS Node SID, an SRv6 End SID is not a hardcoded hop-by-hop path — it's \"reach this node,\" re-evaluated continuously by the current IGP state.",
    },
  },
  {
    id: "locator-experiment-restore",
    label: "Restore The IGP",
    narrative: "Restore the R4-R5 metric to 5. The bottom path (cost 15) is shortest toward R6's locator again.",
    run: (state) => ({ state: { ...state, links: state.links.map((l) => (l.id === LOCATOR_EXPERIMENT_LINK ? { ...l, metric: 5 } : l)), locatorMetricChanged: false, packet: undefined, packetAt: undefined, journey: [] }, events: [] }),
    whatChanged: () => ["R4-R5: 50 → 5 (restored)"],
  },
  {
    id: "sid-vs-locator-comparison",
    label: "Mandatory: SID vs. Locator",
    narrative: `LOCATOR — a routable prefix leading toward the SID owner (${locatorTextFor("R3")}). SID — the full 128-bit value associated with a segment and an endpoint behavior (${R3_SID}). The bare locator prefix is never itself an instantiated End SID unless a scenario explicitly instantiates one under it.`,
  },
  {
    id: "sr-mpls-node-sid-comparison",
    label: "SR-MPLS Node SID vs. SRv6 End SID",
    narrative: "SR-MPLS: Node SID label 16003 → LFIB/IGP path → R3. SRv6: R3 End SID → IPv6 DA / locator routing → R3's local End behavior. Same underlying idea (\"reach this node, then do the bound thing\"), different data plane.",
  },
  {
    id: "no-srgb",
    label: "No SRGB For SRv6",
    narrative: "SRv6 does not use the SR-MPLS Segment Routing Global Block to derive these IPv6 SIDs. Device Explorer for this lesson deliberately shows no SRGB, label index, or MPLS incoming label.",
  },
  {
    id: "no-mpls-ops",
    label: "No MPLS Label Operations",
    narrative: "PUSH, SWAP, PHP, and POP are not the main SRv6 forwarding operations here. Instead: IPv6 FIB FORWARD, LOCAL SID MATCH, EXECUTE END, DECREMENT SEGMENTS LEFT, UPDATE IPv6 DA.",
  },

  // --- 8. SRH field precision / segments-left distinction ---------------------
  {
    id: "srh-field-explanation",
    label: "SRH Fields, Precisely",
    narrative: "Routing Type = 4. Last Entry: the zero-based index of the FINAL element in Segment List storage. Segments Left: a pointer/counter used for remaining segment processing — it is NOT a count of physical hops remaining.",
  },
  {
    id: "predict-q7-end-is-label-swap",
    label: "Predict",
    narrative: "Before moving on:",
    question: {
      prompt: "Does the basic SRv6 End behavior perform an MPLS-style label swap?",
      options: [
        { id: "no", label: "No — it decrements Segments Left and rewrites the IPv6 Destination Address" },
        { id: "yes", label: "Yes — it swaps the incoming SID for an outgoing one, just like MPLS" },
      ],
      correctOptionId: "no",
      explanation: "There is no label being swapped — End mutates the IPv6 header itself (Segments Left, Destination Address), an IPv6 operation, not an MPLS one.",
    },
  },
  {
    id: "segments-left-distinction",
    label: "Mandatory: Segments Left ≠ Physical Hops",
    narrative: "Physical transit through R2 (R1 → R2 → R3) left Segments Left at 1, unchanged. Only R3's own End execution changed it, 1 → 0. Segments Left tracks segment-program progress, not physical hop count.",
  },
  {
    id: "predict-q8-sl-counts-hops",
    label: "Predict",
    narrative: "One more check before the optional 3-SID example:",
    question: {
      prompt: "Does Segments Left count physical router hops remaining to the final destination?",
      options: [
        { id: "no", label: "No — it counts remaining SEGMENTS in the program, decremented only by End execution" },
        { id: "yes", label: "Yes — it decrements at every physical hop" },
      ],
      correctOptionId: "no",
      explanation: "R1 → R2 → R3 was two physical hops but zero Segments Left decrements; R3's single End execution was one decrement across zero additional physical hops at that instant.",
    },
  },

  // --- 9. Optional 3-SID demonstration -----------------------------------------
  {
    id: "three-sid-demo-intro",
    label: "Optional: A Third Segment",
    narrative: `Brief demonstration: <R3, R5, R6>. Full SRH: DA = ${R3_SID}, Last Entry = 2, Segments Left = 2, Segment List[0] = ${R6_SID}, Segment List[1] = ${R5_SID}, Segment List[2] = ${R3_SID}.`,
    run: (state) => ({ state: { ...state, packet: buildMultiSidPacket(["R3", "R5", "R6"]), packetAt: "R1", journey: [], highLevelOrder: ["R3", "R5", "R6"] }, events: [] }),
  },
  {
    id: "three-sid-r1-r2-r3",
    label: "R1 → R2 → R3: First Segment",
    narrative: "R1 routes toward R3's locator (via R2, cost 20) exactly as before — this segment doesn't care that two more segments remain.",
    packet: (state) => (state.packet ? ipv6Packet("three-r1", "R1", "R3", "IPv6 FIB forward toward R3 locator", "FIB", state.packet) : undefined),
    run: (state) => ({ state: { ...state, packetAt: "R3", journey: [...state.journey, { router: "R1", input: fmtIpv6(state.packet!.daHextets), lookup: "IPv6 FIB: shortest path to R3 locator via R2", action: "IPV6_FIB_FORWARD", output: fmtIpv6(state.packet!.daHextets) }] }, events: [] }),
  },
  {
    id: "three-sid-r3-end",
    label: "R3: End — SL 2 → 1, DA → R5",
    narrative: `R3's Local SID Table matches. End: Segments Left 2 → 1, DA becomes Segment List[1] = ${R5_SID} (R5).`,
    packet: (state) => {
      if (!state.packet?.srh) return undefined;
      const result = executeEndBehavior(state.packet.daHextets, state.packet.srh);
      return ipv6Packet("three-r3-end", "R3", "R3", "End: SL 2→1, DA R3→R5", "END", { ...state.packet, daHextets: result.newDaHextets, srh: result.newSrh });
    },
    run: (state) => {
      if (!state.packet?.srh) return { state, events: [] };
      const result = executeEndBehavior(state.packet.daHextets, state.packet.srh);
      return { state: { ...state, packet: { ...state.packet, daHextets: result.newDaHextets, srh: result.newSrh }, journey: [...state.journey, { router: "R3", input: `${fmtIpv6(state.packet.daHextets)}, SL=2`, lookup: "Local SID table: MATCH — End", action: "DA_UPDATE", output: `${fmtIpv6(result.newDaHextets)}, SL=1` }] }, events: [] };
    },
    whatChanged: () => ["R3 End: Segments Left 2 → 1", "DA: R3 End SID → R5 End SID"],
  },
  {
    id: "three-sid-r3-r6",
    label: "R3 → R6: Toward R5's Locator",
    narrative: "The new DA is R5's End SID. R3's own locator routing sends it toward R5 — and the shortest path from R3 toward R5's locator happens to run through R6.",
    packet: (state) => (state.packet ? ipv6Packet("three-r3-r6", "R3", "R6", "IPv6 FIB forward toward R5 locator", "FIB", state.packet) : undefined),
    run: (state) => ({ state: { ...state, packetAt: "R6", journey: [...state.journey, { router: "R3", input: fmtIpv6(state.packet!.daHextets), lookup: "IPv6 FIB: shortest path to R5 locator via R6", action: "IPV6_FIB_FORWARD", output: fmtIpv6(state.packet!.daHextets) }] }, events: [] }),
  },
  {
    id: "three-sid-r6-transit",
    label: "R6: Ordinary Transit — Not This DA's Owner",
    narrative: "R6 owns its own End SID — but this DA is R5's, not R6's. No local SID match here, so R6 is an ordinary transit hop for this specific packet, forwarding directly to R5.",
    packet: (state) => (state.packet ? ipv6Packet("three-r6-transit", "R6", "R5", "IPv6 FIB forward (unchanged)", "FIB", state.packet) : undefined),
    run: (state) => ({ state: { ...state, packetAt: "R5", journey: [...state.journey, { router: "R6", input: fmtIpv6(state.packet!.daHextets), lookup: "Local SID table: no match (this DA is R5's End SID, not R6's). IPv6 FIB: directly connected to R5", action: "IPV6_FIB_FORWARD", output: fmtIpv6(state.packet!.daHextets) }] }, events: [] }),
    whatChanged: () => ["R6 transits a packet not destined to itself — its own End SID is irrelevant to THIS DA"],
  },
  {
    id: "three-sid-r5-end",
    label: "R5: End — SL 1 → 0, DA → R6",
    narrative: `R5's Local SID Table matches. End: Segments Left 1 → 0, DA becomes Segment List[0] = ${R6_SID} (R6).`,
    packet: (state) => {
      if (!state.packet?.srh) return undefined;
      const result = executeEndBehavior(state.packet.daHextets, state.packet.srh);
      return ipv6Packet("three-r5-end", "R5", "R5", "End: SL 1→0, DA R5→R6", "END", { ...state.packet, daHextets: result.newDaHextets, srh: result.newSrh });
    },
    run: (state) => {
      if (!state.packet?.srh) return { state, events: [] };
      const result = executeEndBehavior(state.packet.daHextets, state.packet.srh);
      return { state: { ...state, packet: { ...state.packet, daHextets: result.newDaHextets, srh: result.newSrh }, journey: [...state.journey, { router: "R5", input: `${fmtIpv6(state.packet.daHextets)}, SL=1`, lookup: "Local SID table: MATCH — End", action: "DA_UPDATE", output: `${fmtIpv6(result.newDaHextets)}, SL=0` }] }, events: [] };
    },
    whatChanged: () => ["R5 End: Segments Left 1 → 0", "DA: R5 End SID → R6 End SID"],
  },
  {
    id: "three-sid-r5-r6",
    label: "R5 → R6: Toward The Final Segment",
    narrative: "With the DA now R6's End SID, R5 does an ordinary IPv6 FIB lookup toward R6's locator — directly connected.",
    packet: (state) => (state.packet ? ipv6Packet("three-r5-r6", "R5", "R6", "IPv6 FIB forward toward new DA", "FIB", state.packet) : undefined),
    run: (state) => ({ state: { ...state, packetAt: "R6", journey: [...state.journey, { router: "R5", input: fmtIpv6(state.packet!.daHextets), lookup: "IPv6 FIB: shortest path to R6 locator — directly connected", action: "IPV6_FIB_FORWARD", output: fmtIpv6(state.packet!.daHextets) }] }, events: [] }),
  },
  {
    id: "three-sid-r6-final",
    label: "R6: Final End — Deliver",
    narrative: "R6's Local SID Table matches, Segments Left is already 0 — final End, deliver. Full path: R1 → R2 → R3 → R6 → R5 → R6. Three segments, five physical hops — segment count and physical hop count really are different things.",
    packet: (state) => (state.packet ? { id: "three-delivered", protocol: "IPV6", from: "R6", to: "R6", summary: "Delivered via <R3, R5, R6>", layers: buildIpv6PacketLayers(state.packet) } : undefined),
    run: (state) => ({ state: { ...state, journey: [...state.journey, { router: "R6", input: "IPv6, SL=0", lookup: "Local SID table: MATCH — final End", action: "DELIVER", output: "Delivered" }] }, events: [] }),
    whatChanged: () => ["Delivered via <R3, R5, R6> — 3 segments, 5 physical hops"],
  },

  // --- 10. Previews / views / comparisons ---------------------------------------
  {
    id: "end-x-preview",
    label: "Preview: End.X",
    narrative: "End = a basic endpoint, Prefix-SID-style behavior (\"reach me, then continue the program\"). End.X = an endpoint with an L3 cross-connect, Adjacency-SID-style behavior (\"reach me, then use this one specific link\"). End.X forwarding is not implemented in this lesson — see SRv6 Endpoint Behaviors next.",
  },
  {
    id: "service-behavior-preview-table",
    label: "Preview: Service Endpoint Behaviors",
    narrative: "End.DX4 (decapsulation + IPv4 cross-connect), End.DX6 (decapsulation + IPv6 cross-connect), End.DT4 (decapsulation + IPv4 table lookup), End.DT6 (decapsulation + IPv6 table lookup), End.DX2 (decapsulation + L2 cross-connect) — preview only. The base End behavior taught here does NOT decapsulate into a VRF; those semantics belong to these other endpoint behaviors, covered later in the track.",
  },
  {
    id: "views-intro",
    label: "Views: Control / Data / Both",
    narrative: "Control shows locator advertisements, IGP topology, and the Local SID Table. Data shows the current IPv6 DA, SRH state, and forwarding action.",
  },
  {
    id: "physical-ipv6-srv6-views-intro",
    label: "Physical / IPv6 Underlay / SRv6 Program",
    narrative: "Physical: the actual links. IPv6 Underlay: locator reachability and the current SPF. SRv6 Program: the active segment program, de-emphasizing ordinary transit nodes while keeping them visible in Physical view.",
  },
  {
    id: "sr-mpls-vs-srv6-full-comparison",
    label: "SR-MPLS vs. SRv6, Side By Side",
    narrative: "SID encoding: label vs. IPv6 address. Active segment: top label vs. IPv6 DA. Segment list: label stack vs. SRH when needed. Forwarding core: MPLS LFIB vs. IPv6 FIB. Endpoint action: label action vs. SID behavior. SRGB: relevant vs. not used for SRv6 SID allocation. PHP: an MPLS concept vs. no equivalent SRv6 mechanism.",
  },
  {
    id: "segment-lab-intro",
    label: "Segment-Program Lab",
    narrative: "Build a high-level segment program from R3/R5/R6's instantiated End SIDs and preview the resulting physical path — read-only, computed against the real IGP and Local SID Table state.",
  },

  // --- 11. Troubleshooting -----------------------------------------------------
  {
    id: "troubleshooting-intro",
    label: "Incident",
    narrative: "R1 can ping ordinary R3 infrastructure addresses. R1 has a valid IPv6 route to R3's locator. R2 forwards toward R3 correctly. A packet carrying <R3, R6> reaches R3 — but never advances toward R6.",
    run: (state) => ({ state: { ...state, troubleshooting: { ...state.troubleshooting, started: true }, packet: undefined, packetAt: undefined, journey: [], fault: undefined, highLevelOrder: undefined }, events: [] }),
  },
  {
    id: "predict-fault-hypothesis",
    label: "Predict",
    narrative: "Before diagnosing:",
    question: {
      prompt: "Given R3's locator IS reachable but the expected local SID behavior never triggers, what's the most likely fault category?",
      options: [
        { id: "local-sid-missing", label: "R3's Local SID Table is missing the expected entry for the active SID" },
        { id: "igp-down", label: "The IGP has stopped computing a path to R3" },
        { id: "srh-malformed", label: "The SRH itself is malformed" },
      ],
      correctOptionId: "local-sid-missing",
      explanation: "Locator reachability working while the specific local SID behavior fails to trigger is exactly the \"locator route ≠ local SID entry\" distinction from earlier in this lesson.",
      hints: [
        "Every layer below the local SID lookup — interfaces, IGP, locator advertisement — is confirmed healthy in the incident report.",
        "The packet visibly ARRIVES at R3. The question is what R3 does once it's there.",
      ],
    },
  },
  {
    id: "diagnostic-ladder",
    label: "Diagnostic Ladder",
    narrative: "Interfaces, IGP, R3's locator advertisement, R3's ordinary IPv6 reachability, and SRH structure are all healthy. The packet arrives at R3. R3's Local SID Table simply doesn't have an entry for the active SID — so the required segment can't execute.",
  },
  {
    id: "fault-inject",
    label: "Fault: R3's End SID Is Missing",
    narrative: "R3's local SID entry has been removed from its Local SID Table — everything else in the network stays exactly as healthy as before.",
    run: (state) => ({ state: { ...state, localSidTable: { ...state.localSidTable, R3: undefined }, fault: { reason: "R3's Local SID Table has no entry for its own End SID — the locator is reachable, but the local SID behavior was never instantiated." } }, events: [] }),
    whatChanged: () => ["R3's Local SID Table entry removed — locator advertisement and IGP reachability are untouched"],
  },
  {
    id: "fault-send",
    label: "Resend <R3, R6>",
    narrative: `Resend the same, previously-working segment program: <R3, R6>. DA = ${R3_SID}.`,
    packet: () => ({ id: "fault-classify", protocol: "IPV6", from: "R1", to: "R1", summary: "Same <R3, R6> program as before", layers: buildIpv6PacketLayers(buildMultiSidPacket(["R3", "R6"])) }),
    run: (state) => ({ state: { ...state, packet: buildMultiSidPacket(["R3", "R6"]), packetAt: "R1", journey: [], highLevelOrder: ["R3", "R6"] }, events: [] }),
  },
  {
    id: "fault-r1-r2-healthy",
    label: "R1 → R2 → R3: Reaches R3 Fine",
    narrative: "R1's IPv6 FIB lookup, R2's transit forwarding — both work exactly as before. The packet arrives at R3 with an untouched DA and SRH.",
    packet: (state) => (state.packet ? ipv6Packet("fault-r1r2", "R1", "R3", "IPv6 FIB forward — reaches R3 fine", "FIB", state.packet) : undefined),
    run: (state) => ({
      state: {
        ...state,
        packetAt: "R3",
        journey: [
          ...state.journey,
          { router: "R1", input: fmtIpv6(state.packet!.daHextets), lookup: "IPv6 FIB: shortest path to R3 locator via R2", action: "IPV6_FIB_FORWARD", output: fmtIpv6(state.packet!.daHextets) },
          { router: "R2", input: fmtIpv6(state.packet!.daHextets), lookup: "IPv6 FIB: shortest path to R3 locator — directly connected. SRH untouched.", action: "IPV6_FIB_FORWARD", output: fmtIpv6(state.packet!.daHextets) },
        ],
      },
      events: [],
    }),
  },
  {
    id: "fault-r3-missing-sid-drop",
    label: "R3: No Local SID Match — Drop",
    narrative: `R3's Local SID Table has no entry matching this DA (${R3_SID}) anymore. There is no ordinary host/interface destination using that exact address either. The required segment cannot execute — PacketVerse models this deterministic outcome as EXPECTED_LOCAL_SID_MISSING: drop.`,
    packet: (state) => (state.packet ? ipv6Packet("fault-drop", "R3", "R3", "No local SID match — dropped", "DROP", state.packet) : undefined),
    run: (state) => ({
      state: { ...state, journey: [...state.journey, { router: "R3", input: fmtIpv6(state.packet!.daHextets), lookup: "Local SID table: NO MATCH — no entry for this SID", action: "DROP_MISSING_LOCAL_SID", output: "DROPPED" }] },
      events: [{ type: "PACKET_DROPPED", stepId: "fault-r3-missing-sid-drop", timestamp: Date.now(), message: "R3: dropped — active SID has no Local SID Table entry" }],
    }),
    whatChanged: () => ["Packet dropped at R3 — locator was reachable, but no local SID entry exists for the active DA"],
  },

  // --- 12. Wrong repairs / correct repair --------------------------------------
  {
    id: "repair-challenge",
    label: "Engineer Challenge — Program The IPv6 Path",
    narrative: "Choose the correct repair to restore the <R3, R6> segment program.",
    action: (state, payload) => {
      const choice = typeof payload === "object" && payload !== null && "choice" in payload ? String((payload as { choice: string }).choice) : "";
      const correct = choice === "restore-local-sid";
      return { state: { ...state, troubleshooting: { ...state.troubleshooting, repairAttempt: { choice, correct } } }, events: [] };
    },
    requiresState: (state) => state.troubleshooting.repairAttempt?.correct === true,
  },
  {
    id: "repair-applied",
    label: "R3's Local SID Restored",
    narrative: `Restore R3's local SID entry: ${R3_SID}, behavior End, owner R3.`,
    run: (state) => ({ state: { ...state, localSidTable: { ...state.localSidTable, R3: installLocalSid("R3") }, fault: undefined }, events: [] }),
    whatChanged: () => ["R3's Local SID Table: End SID entry reinstalled"],
  },
  {
    id: "repaired-send",
    label: "Mandatory Resend",
    narrative: "Restoring the table entry alone doesn't complete the repair — resend the <R3, R6> program and verify it end to end.",
    packet: () => ({ id: "repaired-classify", protocol: "IPV6", from: "R1", to: "R1", summary: "Resending <R3, R6> after repair", layers: buildIpv6PacketLayers(buildMultiSidPacket(["R3", "R6"])) }),
    run: (state) => ({ state: { ...state, packet: buildMultiSidPacket(["R3", "R6"]), packetAt: "R1", journey: [], highLevelOrder: ["R3", "R6"] }, events: [] }),
  },
  {
    id: "repaired-r1-r2",
    label: "R1 → R2 → R3",
    narrative: "Same IPv6 FIB forwarding as always — nothing about reachability ever needed fixing.",
    packet: (state) => (state.packet ? ipv6Packet("repaired-r1r2", "R1", "R3", "IPv6 FIB forward", "FIB", state.packet) : undefined),
    run: (state) => ({
      state: {
        ...state,
        packetAt: "R3",
        journey: [
          ...state.journey,
          { router: "R1", input: fmtIpv6(state.packet!.daHextets), lookup: "IPv6 FIB: shortest path to R3 locator via R2", action: "IPV6_FIB_FORWARD", output: fmtIpv6(state.packet!.daHextets) },
          { router: "R2", input: fmtIpv6(state.packet!.daHextets), lookup: "IPv6 FIB: shortest path to R3 locator — directly connected", action: "IPV6_FIB_FORWARD", output: fmtIpv6(state.packet!.daHextets) },
        ],
      },
      events: [],
    }),
  },
  {
    id: "repaired-r3-end",
    label: "R3: Local SID Match — End Executes",
    narrative: `R3's Local SID Table now matches this DA again. End: Segments Left 1 → 0, DA → ${R6_SID}.`,
    packet: (state) => {
      if (!state.packet?.srh) return undefined;
      const result = executeEndBehavior(state.packet.daHextets, state.packet.srh);
      return ipv6Packet("repaired-r3-end", "R3", "R3", "End: SL 1→0, DA R3→R6", "END", { ...state.packet, daHextets: result.newDaHextets, srh: result.newSrh });
    },
    run: (state) => {
      if (!state.packet?.srh) return { state, events: [] };
      const result = executeEndBehavior(state.packet.daHextets, state.packet.srh);
      return { state: { ...state, packet: { ...state.packet, daHextets: result.newDaHextets, srh: result.newSrh }, journey: [...state.journey, { router: "R3", input: `${fmtIpv6(state.packet.daHextets)}, SL=1`, lookup: "Local SID table: MATCH — End", action: "DA_UPDATE", output: `${fmtIpv6(result.newDaHextets)}, SL=0` }] }, events: [{ type: "ROUTE_SELECTED", stepId: "repaired-r3-end", timestamp: Date.now(), message: "R3 End executes again — SL 1→0, DA R3→R6" }] };
    },
    whatChanged: () => ["R3 End behavior restored: Segments Left 1 → 0, DA R3 → R6"],
  },
  {
    id: "repaired-r3-r6",
    label: "R3 → R6",
    narrative: "IPv6 FIB forward toward the new DA's locator — directly connected.",
    packet: (state) => (state.packet ? ipv6Packet("repaired-r3r6", "R3", "R6", "IPv6 FIB forward toward new DA", "FIB", state.packet) : undefined),
    run: (state) => ({ state: { ...state, packetAt: "R6", journey: [...state.journey, { router: "R3", input: fmtIpv6(state.packet!.daHextets), lookup: "IPv6 FIB: shortest path to R6 locator — directly connected", action: "IPV6_FIB_FORWARD", output: fmtIpv6(state.packet!.daHextets) }] }, events: [] }),
  },
  {
    id: "repaired-r6-final",
    label: "R6: Final End — Deliver",
    narrative: "R6's Local SID Table matches, Segments Left already 0 — final End, deliver.",
    packet: (state) => (state.packet ? ipv6Packet("repaired-r6-final", "R6", "R6", "Final End", "END", state.packet) : undefined),
    run: (state) => ({ state: { ...state, journey: [...state.journey, { router: "R6", input: `${fmtIpv6(state.packet!.daHextets)}, SL=0`, lookup: "Local SID table: MATCH — final End", action: "FINAL_END", output: "Next header / deliver" }] }, events: [] }),
  },
  {
    id: "repaired-deliver",
    label: "R6 Delivers — Repair Verified",
    narrative: "R6 delivers the packet. Path taken: R1 → R2 → R3 → R6, exactly as originally designed. The repair is verified end to end, not merely \"table entry restored.\"",
    packet: (state) => (state.packet ? { id: "repaired-delivered", protocol: "IPV6", from: "R6", to: "R6", summary: "Delivered — repair verified", layers: buildIpv6PacketLayers(state.packet) } : undefined),
    run: (state) => ({ state: { ...state, troubleshooting: { ...state.troubleshooting, correctVerified: true }, journey: [...state.journey, { router: "R6", input: "IPv6", lookup: "Delivery", action: "DELIVER", output: "Delivered" }] }, events: [{ type: "PACKET_RECEIVED", stepId: "repaired-deliver", timestamp: Date.now(), message: "Delivered R1 → R2 → R3 → R6 — repair verified" }] }),
    whatChanged: () => ["Delivered R1 → R2 → R3 → R6 — repair verified with a real resend"],
  },
  {
    id: "engineer-challenge",
    label: "Engineer Challenge Complete",
    narrative: "You verified the IPv6 underlay, inspected locator advertisements, read R3/R5/R6's Local SID Tables, identified their End SIDs, constructed <R3, R6>, encoded a correct full SRH (reverse storage order, correct Segments Left/Last Entry), sent it, confirmed R2 stayed a pure IPv6 transit hop, watched R3 execute End, verified the DA change to R6, and confirmed R6's final End processing — then diagnosed and repaired a missing Local SID Table entry.",
  },
  {
    id: "complete",
    label: "Lesson Complete",
    narrative: "You built and traced a real SRv6 segment program — the 128-bit SID, LOC:FUNCT:ARG, the Local SID Table, the reversed SRH storage order, Segments Left, the IPv6 DA as the active segment, and the base End behavior that ties them all together.",
  },
];

export const STEP_IDX = {
  whatIsASid: stepIdx(srv6Steps, "what-is-a-sid"),
  sidStructureIntro: stepIdx(srv6Steps, "sid-structure-intro"),
  buildR3Sid: stepIdx(srv6Steps, "build-r3-sid"),
  localSidTableIntro: stepIdx(srv6Steps, "local-sid-table-intro"),
  singleSidIntro: stepIdx(srv6Steps, "single-sid-intro"),
  srhViewerIntro: stepIdx(srv6Steps, "srh-viewer-intro"),
  viewsIntro: stepIdx(srv6Steps, "views-intro"),
  segmentLabIntro: stepIdx(srv6Steps, "segment-lab-intro"),
  troubleshootingIntro: stepIdx(srv6Steps, "troubleshooting-intro"),
  diagnosticLadder: stepIdx(srv6Steps, "diagnostic-ladder"),
  repairChallenge: stepIdx(srv6Steps, "repair-challenge"),
  engineerChallenge: stepIdx(srv6Steps, "engineer-challenge"),
  serviceBehaviorPreview: stepIdx(srv6Steps, "service-behavior-preview-table"),
  srMplsComparison: stepIdx(srv6Steps, "sr-mpls-vs-srv6-full-comparison"),
};

function stepIdx(steps: ScenarioStep<Srv6State>[], id: string): number {
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

export function buildSrv6CliCommands(state: Srv6State, router: RouterId): CliCommandEntry[] {
  const locator = state.locators.find((l) => l.router === router);
  const localSid = state.localSidTable[router];
  const locatorEntry: CliCommandEntry = {
    id: "locator",
    label: "locator",
    concept: `${router}'s advertised SRv6 locator: ${locator?.text}. Advertising a locator only makes the prefix reachable — it does not, by itself, instantiate any SID under it.`,
    cisco: { cmd: "show segment-routing srv6 locator", output: `Locator: ${locator?.text}\nAlgorithm: SPF\nAdvertised: ${locator?.advertised ? "Yes" : "No"}` },
    juniper: { cmd: "show srv6 locator", output: `${locator?.text}  algorithm 0  advertised` },
  };
  const localSidEntry: CliCommandEntry = {
    id: "local-sid",
    label: "local sid",
    concept: localSid
      ? `${router} has instantiated one local SID: ${localSid.sidText}, bound to behavior ${localSid.behavior}.`
      : `${router} has NO local SID instantiated right now — any packet whose active DA would need this router's End behavior cannot execute it.`,
    cisco: {
      cmd: "show segment-routing srv6 sid",
      output: localSid ? `SID: ${localSid.sidText}\nLocator: ${localSid.locatorText}\nFunction: ${localSid.functionText}\nBehavior: ${localSid.behavior}\nOwner: ${localSid.owner}` : "% No local SIDs instantiated",
    },
    juniper: { cmd: "show route table srv6-sid.0", output: localSid ? `${localSid.sidText}  End  local` : "(empty)" },
  };
  const srhEntry: CliCommandEntry = {
    id: "srh",
    label: "packet / srh",
    concept: state.packet ? `Current packet: DA = ${fmtIpv6(state.packet.daHextets)}${state.packet.srh ? `, Segments Left = ${state.packet.srh.segmentsLeft}, Last Entry = ${state.packet.srh.lastEntry}` : ", no SRH present"}.` : "No packet in flight right now.",
    cisco: {
      cmd: "show ipv6 route <destination> detail",
      output: state.packet
        ? `Destination: ${fmtIpv6(state.packet.daHextets)}\n${state.packet.srh ? `SRH: Segments Left ${state.packet.srh.segmentsLeft}, Last Entry ${state.packet.srh.lastEntry}, ${state.packet.srh.segmentList.length} segments` : "SRH: not present"}`
        : "% No active packet",
    },
    juniper: {
      cmd: "show route table inet6.0 extensive",
      output: state.packet ? `${fmtIpv6(state.packet.daHextets)}${state.packet.srh ? `\n  SRH: SL=${state.packet.srh.segmentsLeft} LE=${state.packet.srh.lastEntry}` : ""}` : "(no route)",
    },
  };
  return [locatorEntry, localSidEntry, srhEntry];
}
