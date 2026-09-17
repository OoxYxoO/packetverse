import type { PacketLayer, PacketVisual, ScenarioStep } from "@/lib/sim-engine/types";
import {
  buildLocators,
  executeEndBehavior,
  fmtIpv6,
  functionHexText,
  locatorHextetsFor,
  locatorTextFor,
  buildSrv6Sid,
  type Hextets,
  type RouterId,
  type SegmentRoutingHeader,
  type SrhSegment,
  type Srv6Locator,
} from "@/lib/sim-engine/scenarios/srv6Foundations";
import {
  BEHAVIOR_LABEL,
  FUNCTION,
  processSrv6EndpointBehavior,
  type BehaviorParameter,
  type EndXParameter,
  type EndpointLocalSidEntry,
  type InnerPayload,
  type Srv6EndpointBehavior,
  type VrfName,
  type Vrf,
} from "@/lib/sim-engine/scenarios/srv6EndpointBehaviors";

export type { RouterId };

/**
 * SRv6 Traffic Engineering / SR Policy (RFC 9256) — the operational
 * layer built on top of SRv6 Endpoint Behaviors' SIDs. Central
 * question: endpoint behaviors tell a SID what to do once traffic
 * arrives there — SR Policy decides WHICH ordered set of SIDs traffic
 * should use, WHY that path was selected, and HOW traffic gets steered
 * onto it in the first place.
 *
 * Fully implemented: RFC 9256 policy identity <Headend,Color,Endpoint>,
 * explicit + dynamic candidate paths, candidate validity (separate from
 * selection), preference-based active-candidate selection, SRv6
 * segment-list derivation, local (non-BGP) traffic steering, H.Encaps,
 * full-SRH construction, End/End.X/End.DX6 composition (execution is
 * REUSED from srv6EndpointBehaviors.ts, never reimplemented), candidate
 * failure/failover, dynamic recomputation, a Drop-Upon-Invalid toggle,
 * a read-only weighted-segment-list lab, a Binding SID, and one
 * standards-faithful End.B6.Encaps experiment.
 *
 * Preview only: composite candidate paths, equal-preference tie
 * breaking, H.Encaps.Red, End.B6.Encaps.Red.
 *
 * Explicitly out of scope (later modules): BGP SR Policy, PCEP, actual
 * controller sessions, SRv6 L3VPN control plane / VPN route signaling,
 * TI-LFA, uSID, EVPN, inter-domain SR Policy.
 *
 * Topology (same shape as SR-MPLS's SR Policy lesson, SRv6-flavored):
 *
 *              R2 ───── R4
 *             /           \
 *            /             \
 *   CLIENT1-R1              R6-RECEIVER6
 *            \             /
 *             \           /
 *              R3 ───── R5
 *               \       /
 *                \─R3-R4 (cross-link)
 *
 *   TOP:    R1-R2=10/20, R2-R4=10/20, R4-R6=10/20   (IGP 30, delay 60)
 *   BOTTOM: R1-R3=15/5,  R3-R5=15/5,  R5-R6=15/5    (IGP 45, delay 15)
 *   CROSS:  R3-R4=20/15
 *
 * Ordinary IGP-shortest path: TOP. Lowest-delay path: BOTTOM.
 *
 * Reuse (never re-derived): fmtIpv6/hextetsEqual/functionHexText/
 * locatorHextetsFor/locatorTextFor/buildLocators/buildSrv6Sid from
 * Foundations; FUNCTION/BEHAVIOR_LABEL/EndpointLocalSidEntry/
 * processSrv6EndpointBehavior/executeEndBehavior/
 * validateFinalBehaviorPosition/InnerPayload from Endpoint Behaviors —
 * the actual End/End.X/End.DX6 packet-processing mechanics are never
 * reimplemented here, only INVOKED with this lesson's own SIDs.
 */

// ---------------------------------------------------------------------------
// Topology
// ---------------------------------------------------------------------------

export type LinkId = "R1-R2" | "R2-R4" | "R4-R6" | "R1-R3" | "R3-R5" | "R5-R6" | "R3-R4";
export interface LinkDef {
  id: LinkId;
  a: RouterId;
  b: RouterId;
  metric: number;
  delay: number;
}
export const LINKS: LinkDef[] = [
  { id: "R1-R2", a: "R1", b: "R2", metric: 10, delay: 20 },
  { id: "R2-R4", a: "R2", b: "R4", metric: 10, delay: 20 },
  { id: "R4-R6", a: "R4", b: "R6", metric: 10, delay: 20 },
  { id: "R1-R3", a: "R1", b: "R3", metric: 15, delay: 5 },
  { id: "R3-R5", a: "R3", b: "R5", metric: 15, delay: 5 },
  { id: "R5-R6", a: "R5", b: "R6", metric: 15, delay: 5 },
  { id: "R3-R4", a: "R3", b: "R4", metric: 20, delay: 15 },
];
export const TOP_PATH: RouterId[] = ["R1", "R2", "R4", "R6"];
export const BOTTOM_PATH: RouterId[] = ["R1", "R3", "R5", "R6"];

export type ClientId = "CLIENT1" | "RECEIVER6";
export type NodeId = RouterId | ClientId;

export const GRAPH_NODES = [
  { id: "CLIENT1", label: "CLIENT1", x: 2, y: 50, subLabel: "Source" },
  { id: "R1", label: "R1", x: 16, y: 50, subLabel: "Headend" },
  { id: "R2", label: "R2", x: 42, y: 18 },
  { id: "R4", label: "R4", x: 60, y: 18 },
  { id: "R3", label: "R3", x: 42, y: 82, subLabel: "End / End.X" },
  { id: "R5", label: "R5", x: 60, y: 82 },
  { id: "R6", label: "R6", x: 84, y: 50, subLabel: "Endpoint" },
  { id: "RECEIVER6", label: "RECEIVER6", x: 98, y: 50, subLabel: "Receiver" },
];
export const GRAPH_EDGES: { id: string; a: NodeId; b: NodeId }[] = [
  ...LINKS.map((l) => ({ id: l.id as string, a: l.a as NodeId, b: l.b as NodeId })),
  { id: "CLIENT1-R1", a: "CLIENT1" as NodeId, b: "R1" as NodeId },
  { id: "R6-RECEIVER6", a: "R6" as NodeId, b: "RECEIVER6" as NodeId },
];

export function linkIdBetween(a: RouterId, b: RouterId, links: LinkDef[] = LINKS): LinkId | undefined {
  return links.find((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a))?.id;
}

// ---------------------------------------------------------------------------
// Dual-objective shortest path (IGP metric or delay) — a genuinely new
// computation (two independent edge weights), so it is written fresh
// here rather than reusing Foundations'/Endpoint Behaviors' single-
// weight (`metric`-only) IGP helpers.
// ---------------------------------------------------------------------------

export type WeightKey = "metric" | "delay";

function neighborsOf(router: RouterId, links: LinkDef[]): { to: RouterId; link: LinkDef }[] {
  const out: { to: RouterId; link: LinkDef }[] = [];
  for (const l of links) {
    if (l.a === router) out.push({ to: l.b, link: l });
    if (l.b === router) out.push({ to: l.a, link: l });
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
function pathCost(path: RouterId[], links: LinkDef[], weightKey: WeightKey): number {
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const link = links.find((l) => (l.a === path[i] && l.b === path[i + 1]) || (l.a === path[i + 1] && l.b === path[i]));
    total += link?.[weightKey] ?? Infinity;
  }
  return total;
}
export interface PathResult {
  path: RouterId[];
  cost: number;
}
export function computeShortestPath(links: LinkDef[], from: RouterId, to: RouterId, weightKey: WeightKey = "metric"): PathResult | undefined {
  if (from === to) return { path: [from], cost: 0 };
  const candidates = allSimplePaths(links, from, to).map((path) => ({ path, cost: pathCost(path, links, weightKey) }));
  candidates.sort((a, b) => a.cost - b.cost);
  return candidates[0];
}
export function nextHopToward(links: LinkDef[], from: RouterId, to: RouterId, weightKey: WeightKey = "metric"): RouterId | undefined {
  const result = computeShortestPath(links, from, to, weightKey);
  return result && result.path.length > 1 ? result.path[1] : undefined;
}

// ---------------------------------------------------------------------------
// SRv6 SIDs — reuses Foundations' locator/SID derivation and Endpoint
// Behaviors' FUNCTION numbering (End=1, End.X=2, End.DX6=0x10) directly.
// ---------------------------------------------------------------------------

function sidFor(router: RouterId, functionValue: number, arg = 0): Hextets {
  return buildSrv6Sid(locatorHextetsFor(router).slice(0, 4), functionValue, arg);
}
function sidTextFor(router: RouterId, functionValue: number): string {
  return fmtIpv6(sidFor(router, functionValue));
}

function makeEntry(router: RouterId, functionValue: number, behavior: Srv6EndpointBehavior, parameter: BehaviorParameter, parameterText: string): EndpointLocalSidEntry {
  const hextets = sidFor(router, functionValue);
  return { sidHextets: hextets, sidText: fmtIpv6(hextets), locatorText: locatorTextFor(router), functionValue, functionText: functionHexText(functionValue), behavior, owner: router, parameter, parameterText };
}

export const RECEIVER6_ADJACENCY = "RECEIVER6";

function installLocalSids(): Partial<Record<RouterId, EndpointLocalSidEntry[]>> {
  return {
    R3: [
      makeEntry("R3", FUNCTION.END, "END", { kind: "END" }, "none"),
      makeEntry("R3", FUNCTION.END_X, "END_X", { kind: "END_X", adjacency: "R5" }, "adjacency: R3→R5"),
    ],
    R4: [makeEntry("R4", FUNCTION.END, "END", { kind: "END" }, "none")],
    R5: [makeEntry("R5", FUNCTION.END, "END", { kind: "END" }, "none")],
    R6: [makeEntry("R6", FUNCTION.END_DX6, "END_DX6", { kind: "END_DX6", adjacency: RECEIVER6_ADJACENCY as never }, `adjacency: ${RECEIVER6_ADJACENCY}`)],
  };
}

export type LocalSidTable = Partial<Record<RouterId, EndpointLocalSidEntry[]>>;

export function findLocalSid(table: LocalSidTable, router: RouterId, functionValue: number): EndpointLocalSidEntry | undefined {
  return (table[router] ?? []).find((e) => e.functionValue === functionValue);
}
export function findLocalSidByText(table: LocalSidTable, sidText: string): EndpointLocalSidEntry | undefined {
  for (const entries of Object.values(table)) {
    const hit = entries?.find((e) => e.sidText === sidText);
    if (hit) return hit;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// SR Database — R1's CONTROL-PLANE knowledge of routers' local SIDs,
// deliberately modeled as separate state from "the SID is physically
// instantiated at its owner." This is what makes the main incident
// possible: R3's End.X can be locally installed and the link healthy
// while R1's own verified knowledge of it is stale/withdrawn.
// ---------------------------------------------------------------------------

export interface SrDatabaseEntry {
  sidText: string;
  owner: RouterId;
  behavior: Srv6EndpointBehavior;
  parameterText: string;
  verified: boolean;
}
export function buildSrDatabase(table: LocalSidTable, r3EndXVerified: boolean): SrDatabaseEntry[] {
  const out: SrDatabaseEntry[] = [];
  for (const entries of Object.values(table)) {
    for (const e of entries ?? []) {
      const verified = e.behavior === "END_X" ? r3EndXVerified : true;
      out.push({ sidText: e.sidText, owner: e.owner, behavior: e.behavior, parameterText: e.parameterText, verified });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Candidate paths (RFC 9256) — identity is separate from the segment
// list(s) it resolves to; a candidate path is never identified BY its
// segment list.
// ---------------------------------------------------------------------------

export type CandidateType = "EXPLICIT" | "DYNAMIC";
export interface CandidatePathIdentity {
  protocolOrigin: "CONFIG" | "LOCAL";
  originator: RouterId;
  discriminator: number;
}
export interface ExplicitSegmentSpec {
  router: RouterId;
  functionValue: number;
}
export interface CandidatePathDef {
  id: string;
  name: string;
  identity: CandidatePathIdentity;
  type: CandidateType;
  preference: number;
  explicitSpecs?: ExplicitSegmentSpec[];
  objective?: "MIN_DELAY";
  weight?: number;
}

/** Weight assumed for an explicit segment list that never declared one (e.g. EXPLICIT_CANDIDATE's single implicit list) — any positive value works since a lone list is never divided against another. */
export const DEFAULT_EXPLICIT_SEGMENT_LIST_WEIGHT = 1;

export interface SegmentListValidity {
  valid: boolean;
  reason: string;
}
/** RFC 9256 §5.1: a candidate-path segment list with weight 0 is invalid — checked generically for any weight value, never special-cased to particular lab numbers. */
export function validateSegmentListWeight(weight: number): SegmentListValidity {
  if (weight === 0) return { valid: false, reason: "ZERO_WEIGHT: a segment list with weight 0 is invalid (RFC 9256 §5.1)." };
  return { valid: true, reason: "Weight is non-zero." };
}

export const EXPLICIT_CANDIDATE: CandidatePathDef = {
  id: "cp-explicit",
  name: "CP-EXPLICIT",
  identity: { protocolOrigin: "CONFIG", originator: "R1", discriminator: 10 },
  type: "EXPLICIT",
  preference: 200,
  explicitSpecs: [
    { router: "R3", functionValue: FUNCTION.END_X },
    { router: "R6", functionValue: FUNCTION.END_DX6 },
  ],
};
export const DYNAMIC_CANDIDATE: CandidatePathDef = {
  id: "cp-dynamic",
  name: "CP-DYNAMIC",
  identity: { protocolOrigin: "LOCAL", originator: "R1", discriminator: 20 },
  type: "DYNAMIC",
  preference: 100,
  objective: "MIN_DELAY",
};

export interface ResolvedSegment {
  sidHextets: Hextets;
  sidText: string;
  owner: RouterId;
  behavior: Srv6EndpointBehavior;
  parameterText: string;
}
export interface CandidateEvaluation {
  def: CandidatePathDef;
  valid: boolean;
  reason: string;
  segments: ResolvedSegment[];
  computedPath?: RouterId[];
}

function toResolvedSegment(e: EndpointLocalSidEntry): ResolvedSegment {
  return { sidHextets: e.sidHextets, sidText: e.sidText, owner: e.owner, behavior: e.behavior, parameterText: e.parameterText };
}

/**
 * Explicit candidate validity (RFC 9256 §2.9-adjacent educational
 * model): non-empty list, every SID actually exists AND is verified in
 * R1's SR Database, any End.X's underlying adjacency link is currently
 * up, the first SID is reachable from the headend, and the final SID
 * belongs to the policy's endpoint. Never reduced to "preference exists."
 */
export function validateExplicitCandidate(def: CandidatePathDef, table: LocalSidTable, srDb: SrDatabaseEntry[], upLinks: LinkDef[], headend: RouterId, destination: RouterId): CandidateEvaluation {
  const specs = def.explicitSpecs ?? [];
  if (specs.length === 0) return { def, valid: false, reason: "Segment list is empty.", segments: [] };
  const weightCheck = validateSegmentListWeight(def.weight ?? DEFAULT_EXPLICIT_SEGMENT_LIST_WEIGHT);
  if (!weightCheck.valid) return { def, valid: false, reason: weightCheck.reason, segments: [] };

  const segments: ResolvedSegment[] = [];
  for (const spec of specs) {
    const entry = findLocalSid(table, spec.router, spec.functionValue);
    if (!entry) return { def, valid: false, reason: `No such SID: ${spec.router} function ${functionHexText(spec.functionValue)}.`, segments };
    const dbEntry = srDb.find((e) => e.sidText === entry.sidText);
    if (!dbEntry || !dbEntry.verified) return { def, valid: false, reason: `${entry.sidText} (${BEHAVIOR_LABEL[entry.behavior]}) is not verified in R1's SR Database.`, segments };
    if (entry.behavior === "END_X") {
      const p = entry.parameter as EndXParameter;
      if (!linkIdBetween(entry.owner, p.adjacency, upLinks)) return { def, valid: false, reason: `Adjacency ${entry.owner}→${p.adjacency} is down.`, segments };
    }
    segments.push(toResolvedSegment(entry));
  }

  const first = segments[0];
  if (!computeShortestPath(upLinks, headend, first.owner)) return { def, valid: false, reason: `Headend cannot reach ${first.owner}'s locator.`, segments };

  const last = segments[segments.length - 1];
  if (last.owner !== destination) return { def, valid: false, reason: `Final segment (${last.sidText}) does not belong to endpoint ${destination}.`, segments };

  return { def, valid: true, reason: "All segments exist, are verified, and are executable.", segments };
}

/**
 * Minimal SRv6 program derivation — walks the computed path and, at
 * each position, uses the LONGEST suffix reachable via R1's own
 * ordinary (unconstrained) shortest path as a single plain End SID;
 * only when the ordinary path diverges does it insert an End.X
 * adjacency segment. This is PacketVerse's own deterministic
 * educational derivation, not a universal vendor compression
 * algorithm. The final hop is always represented by the destination's
 * REAL final behavior SID (End.DX6here), never a generic End.
 */
export function deriveSrv6SegmentListFromPath(path: RouterId[], links: LinkDef[], table: LocalSidTable, finalFunctionValue: number): ExplicitSegmentSpec[] {
  const specs: ExplicitSegmentSpec[] = [];
  let i = 0;
  while (i < path.length - 1) {
    let bestJ = i + 1;
    for (let j = i + 1; j < path.length; j++) {
      const ordinary = computeShortestPath(links, path[i], path[j]);
      if (ordinary && pathsEqual(ordinary.path, path.slice(i, j + 1))) bestJ = j;
      else break;
    }
    const target = path[bestJ];
    const isFinal = bestJ === path.length - 1;
    const functionValue = isFinal ? finalFunctionValue : FUNCTION.END;
    if (bestJ === i + 1 && !pathsEqual(computeShortestPath(links, path[i], path[i + 1])?.path ?? [], [path[i], path[i + 1]])) {
      // Ordinary FIB from the current position does not even reach the very
      // next hop directly — force it via that router's End.X adjacency.
      const endXEntry = (table[path[i]] ?? []).find((e) => e.behavior === "END_X" && (e.parameter as EndXParameter).adjacency === path[i + 1]);
      if (endXEntry) specs.push({ router: endXEntry.owner, functionValue: endXEntry.functionValue });
      i += 1;
    } else {
      specs.push({ router: target, functionValue });
      i = bestJ;
    }
  }
  return specs;
}
function pathsEqual(a: RouterId[], b: RouterId[]): boolean {
  return a.length === b.length && a.every((r, idx) => r === b[idx]);
}

/** Dynamic candidates are computed fresh from live TE state every time — never stored, so they can never go stale relative to the current topology. */
export function computeDynamicCandidate(def: CandidatePathDef, table: LocalSidTable, upLinks: LinkDef[], headend: RouterId, destination: RouterId): CandidateEvaluation {
  const weightKey: WeightKey = def.objective === "MIN_DELAY" ? "delay" : "metric";
  const result = computeShortestPath(upLinks, headend, destination, weightKey);
  if (!result) return { def, valid: false, reason: `No path from ${headend} to ${destination} exists in the current topology.`, segments: [] };
  const finalEntry = (table[destination] ?? []).find((e) => e.behavior === "END_DX6");
  if (!finalEntry) return { def, valid: false, reason: `Endpoint ${destination} has no service SID instantiated.`, segments: [] };
  const specs = deriveSrv6SegmentListFromPath(result.path, upLinks, table, finalEntry.functionValue);
  const segments: ResolvedSegment[] = [];
  for (const spec of specs) {
    const entry = findLocalSid(table, spec.router, spec.functionValue);
    if (!entry) return { def, valid: false, reason: `Derivation referenced a non-existent SID: ${spec.router} function ${functionHexText(spec.functionValue)}.`, segments: [] };
    segments.push(toResolvedSegment(entry));
  }
  return { def, valid: true, reason: `Computed via ${def.objective ?? "IGP"}-constrained shortest path (cost ${result.cost}).`, segments, computedPath: result.path };
}

export function evaluateCandidate(def: CandidatePathDef, table: LocalSidTable, srDb: SrDatabaseEntry[], upLinks: LinkDef[], headend: RouterId, destination: RouterId): CandidateEvaluation {
  return def.type === "EXPLICIT" ? validateExplicitCandidate(def, table, srDb, upLinks, headend, destination) : computeDynamicCandidate(def, table, upLinks, headend, destination);
}

/** Highest-PREFERENCE VALID candidate wins. An invalid higher-preference candidate never beats a valid lower-preference one. */
export function selectActiveCandidate(evaluations: CandidateEvaluation[]): CandidateEvaluation | undefined {
  const valid = evaluations.filter((e) => e.valid);
  if (valid.length === 0) return undefined;
  return valid.reduce((best, e) => (e.def.preference > best.def.preference ? e : best));
}

export type PolicyState = "DOWN" | "UP" | "NO_VALID_CANDIDATE";
export function determinePolicyState(active: CandidateEvaluation | undefined, everConfigured: boolean): PolicyState {
  if (!everConfigured) return "DOWN";
  return active ? "UP" : "NO_VALID_CANDIDATE";
}

// ---------------------------------------------------------------------------
// Binding SID — a real R1-local SRv6 SID (an IPv6 address), never an
// MPLS label. Bound to the policy itself, not merely an alias for the
// first SID of whichever candidate happens to be active.
// ---------------------------------------------------------------------------

export const BSID_FUNCTION = 0x9000;
export const BSID_HEXTETS: Hextets = sidFor("R1", BSID_FUNCTION);
export const BSID_TEXT: string = fmtIpv6(BSID_HEXTETS);

// ---------------------------------------------------------------------------
// Weighted segment-list lab (read-only, deterministic, flow-based —
// intentionally decoupled from the main CP-EXPLICIT/CP-DYNAMIC pair so
// the graded main path stays a simple, deterministic two-candidate
// comparison per the lesson's own scope choice).
// ---------------------------------------------------------------------------

export interface WeightedSegmentListEntry {
  id: string;
  weight: number;
  specs: ExplicitSegmentSpec[];
}
export const WEIGHTED_LAB_LISTS: WeightedSegmentListEntry[] = [
  { id: "SL-A", weight: 80, specs: [{ router: "R3", functionValue: FUNCTION.END_X }, { router: "R6", functionValue: FUNCTION.END_DX6 }] },
  { id: "SL-B", weight: 20, specs: [{ router: "R5", functionValue: FUNCTION.END }, { router: "R6", functionValue: FUNCTION.END_DX6 }] },
];
export const PSEUDO_FLOWS: string[] = Array.from({ length: 20 }, (_, i) => `flow-${i + 1}`);

function deterministicHash(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return h;
}
export type SegmentListSelection = { status: "SELECTED"; list: WeightedSegmentListEntry } | { status: "NO_VALID_SEGMENT_LIST"; reason: string };

/** Deterministic FLOW-based selection (never packet-by-packet round robin): the same flow id always maps to the same list. A zero-weight list (RFC 9256 §5.1: invalid) is excluded from the candidate set before bucketing, exactly like an invalid explicit candidate is excluded from selection — and if EVERY list is invalid, there is no fallback to the unfiltered set: selection reports NO_VALID_SEGMENT_LIST rather than reviving an invalid list or dividing by a zero total weight. */
export function selectSegmentListForFlow(flowId: string, lists: WeightedSegmentListEntry[]): SegmentListSelection {
  const usable = lists.filter((l) => validateSegmentListWeight(l.weight).valid);
  if (usable.length === 0) return { status: "NO_VALID_SEGMENT_LIST", reason: "Every segment list has weight 0 (RFC 9256 §5.1)." };
  const total = usable.reduce((sum, l) => sum + l.weight, 0);
  const bucket = deterministicHash(flowId) % total;
  let acc = 0;
  for (const l of usable) {
    acc += l.weight;
    if (bucket < acc) return { status: "SELECTED", list: l };
  }
  return { status: "SELECTED", list: usable[usable.length - 1] };
}

// ---------------------------------------------------------------------------
// Steering (local classifier only — no BGP Color Extended Community)
// ---------------------------------------------------------------------------

export type FlowIntent = "LOW_LATENCY" | "DEFAULT";
export const POLICY_COLOR = 100;
export function matchSteeringRule(intent: FlowIntent): number | undefined {
  return intent === "LOW_LATENCY" ? POLICY_COLOR : undefined;
}

// ---------------------------------------------------------------------------
// Packet model — reuses Endpoint Behaviors' EndpointPacketState/
// InnerPayload/layer-builder shape directly (outer IPv6 + optional SRH
// + inner payload); this lesson only ever produces an inner IPv6 probe.
// ---------------------------------------------------------------------------

export interface OuterIpv6State {
  srcText: string;
  daHextets: Hextets;
  hopLimit: number;
  srh?: SegmentRoutingHeader;
}
export interface PolicyPacketState {
  outer: OuterIpv6State;
  inner?: InnerPayload;
}

export const CLIENT1_TEXT = "2001:db8:100:1:0:0:0:c1";
export const RECEIVER6_TEXT = "2001:db8:cafe:6::a";
function receiverInner(): InnerPayload {
  return { kind: "IPV6", srcHextets: [0x2001, 0x0db8, 0x0100, 0x0001, 0, 0, 0, 0xc1], dstHextets: [0x2001, 0x0db8, 0xcafe, 0x0006, 0, 0, 0, 0xa] };
}

export interface HighLevelSeg {
  sidHextets: Hextets;
  sidText: string;
  ownerLabel: string;
}
function seg(sidHextets: Hextets, ownerLabel: string): HighLevelSeg {
  return { sidHextets, sidText: fmtIpv6(sidHextets), ownerLabel };
}
export function segmentsToHighLevel(segments: ResolvedSegment[]): HighLevelSeg[] {
  return segments.map((s) => seg(s.sidHextets, s.owner));
}

/** RFC 8754 full-SRH encoding — reversed storage order, Segment List[0] = the FINAL segment. */
function buildFullSrh(segments: HighLevelSeg[]): SegmentRoutingHeader {
  const n = segments.length;
  const storageOrder = [...segments].reverse();
  const segmentList: SrhSegment[] = storageOrder.map((s, i) => ({ index: i, sidHextets: s.sidHextets, sidText: s.sidText, ownerRouter: s.ownerLabel as RouterId }));
  return { nextHeader: "IPv6 (H.Encaps)", hdrExtLen: n * 2, routingType: 4, segmentsLeft: n - 1, lastEntry: n - 1, flags: "0x00", tag: 0, segmentList };
}

/** H.Encaps (RFC 8986 §5) — encapsulates the original packet as payload under a new outer IPv6 + (full) SRH built from the active candidate's segment list. Outer DA = first SID; original packet is fully preserved as inner payload. */
export function executeHEncaps(segments: ResolvedSegment[], inner: InnerPayload, srcText: string = "R1-SR-SOURCE"): PolicyPacketState {
  const highLevel = segmentsToHighLevel(segments);
  if (highLevel.length === 1) return { outer: { srcText, daHextets: highLevel[0].sidHextets, hopLimit: 64 }, inner };
  return { outer: { srcText, daHextets: highLevel[0].sidHextets, hopLimit: 64, srh: buildFullSrh(highLevel) }, inner };
}
export function buildPolicySrh(segments: ResolvedSegment[]): SegmentRoutingHeader | undefined {
  const highLevel = segmentsToHighLevel(segments);
  return highLevel.length > 1 ? buildFullSrh(highLevel) : undefined;
}

// ---------------------------------------------------------------------------
// Packet layers / visuals
// ---------------------------------------------------------------------------

function outerIpv6Layer(pkt: PolicyPacketState): PacketLayer {
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
function innerIpv6Layer(inner: InnerPayload): PacketLayer {
  if (inner.kind !== "IPV6") return { name: "Payload", color: "var(--pv-border-strong)", fields: [] };
  return { name: "Inner IPv6 Packet (original, preserved)", color: "var(--pv-proto-ipv6)", fields: [{ label: "Source Address", value: fmtIpv6(inner.srcHextets) }, { label: "Destination Address", value: fmtIpv6(inner.dstHextets) }] };
}
export function buildPolicyPacketLayers(pkt: PolicyPacketState): PacketLayer[] {
  return [outerIpv6Layer(pkt), ...(pkt.outer.srh ? [srhPacketLayer(pkt.outer.srh)] : []), ...(pkt.inner ? [innerIpv6Layer(pkt.inner)] : [])];
}
function policyPacket(id: string, from: NodeId, to: NodeId, summary: string, badge: string, pkt: PolicyPacketState): PacketVisual {
  return { id, protocol: "IPV6", from, to, summary, badge, layers: buildPolicyPacketLayers(pkt) };
}

// ---------------------------------------------------------------------------
// Drop-Upon-Invalid
// ---------------------------------------------------------------------------

export type PolicyForwardingAction = "STEERED" | "FALLBACK_IGP" | "DROP";
export interface PolicyForwardingState {
  action: PolicyForwardingAction;
  detail: string;
}
/** Optional RFC 9256 behavior, never the universal default — PacketVerse's own explicit, labeled choice for its unconfigured DEFAULT is fall-through to ordinary IGP, never a silent one. */
export function installPolicyForwarding(policyValid: boolean, dropUponInvalid: boolean): PolicyForwardingState {
  if (policyValid) return { action: "STEERED", detail: "Active candidate segment list installed." };
  if (dropUponInvalid) return { action: "DROP", detail: "Policy invalid and Drop-Upon-Invalid is enabled — steering stays attached to the policy; the forwarding action is DROP, not an automatic reroute over IGP." };
  return { action: "FALLBACK_IGP", detail: "Policy invalid; PacketVerse's modeled DEFAULT falls through to ordinary IGP forwarding — an explicit choice made for this lesson, not a claim that every vendor behaves identically." };
}

// ---------------------------------------------------------------------------
// End.B6.Encaps (advanced experiment) — a real INCOMING SRH whose active
// segment is R1's own BSID with SL>0 (another segment still remains).
// End.B6.Encaps advances that incoming SRH exactly like ordinary End,
// then pushes a BRAND NEW outer IPv6+SRH for the policy bound to the
// BSID, nesting the (now-advanced) incoming packet as its payload. This
// is never modeled as a bare DA=BSID packet with no SRH.
// ---------------------------------------------------------------------------

export interface BindingSidExperimentResult {
  incomingBefore: { da: string; sl: number };
  incomingAfter: { da: string; sl: number };
  incomingFinalSid: string;
  nestedOuterDa: string;
  nestedSrhSummary: string;
  layers: PacketLayer[];
}
export function executeBindingSidExperiment(activeSegments: ResolvedSegment[], finalServiceSidHextets: Hextets, finalServiceSidText: string): BindingSidExperimentResult {
  const incomingSrh = buildFullSrh([seg(BSID_HEXTETS, "R1"), seg(finalServiceSidHextets, "R6")]);
  const before = { da: BSID_TEXT, sl: incomingSrh.segmentsLeft };
  const advanced = executeEndBehavior(BSID_HEXTETS, incomingSrh);
  const after = { da: fmtIpv6(advanced.newDaHextets), sl: advanced.newSrh?.segmentsLeft ?? 0 };

  const nestedOuter = executeHEncaps(activeSegments, undefined as unknown as InnerPayload, "R1-SR-SOURCE");
  const nestedSrh = buildPolicySrh(activeSegments);

  const layers: PacketLayer[] = [
    { name: "NEW Outer IPv6 (End.B6.Encaps — bound policy)", color: "var(--pv-proto-ipv6)", fields: [{ label: "Destination Address (first SID of bound policy)", value: fmtIpv6(nestedOuter.outer.daHextets) }] },
    ...(nestedSrh ? [srhPacketLayer(nestedSrh)] : []),
    { name: "— nested original packet (now advanced) —", color: "var(--pv-border-strong)", fields: [{ label: "Destination Address", value: after.da }, { label: "Segments Left", value: String(after.sl) }, { label: "Final segment (unchanged)", value: finalServiceSidText }] },
    { name: "Original incoming SRH segment list (unchanged storage)", color: "var(--pv-proto-srh)", fields: incomingSrh.segmentList.map((s) => ({ label: `Segment List[${s.index}]`, value: s.sidText })) },
  ];

  return { incomingBefore: before, incomingAfter: after, incomingFinalSid: finalServiceSidText, nestedOuterDa: fmtIpv6(nestedOuter.outer.daHextets), nestedSrhSummary: nestedSrh ? `SL=${nestedSrh.segmentsLeft}, LE=${nestedSrh.lastEntry}` : "single segment, no SRH", layers };
}

// ---------------------------------------------------------------------------
// Journey / forwarding actions
// ---------------------------------------------------------------------------

export type Srv6PolicyAction =
  | "HEADEND_ENCAPS"
  | "STEERING_MATCH"
  | "POLICY_SELECT"
  | "IPV6_FIB_FORWARD"
  | "LOCAL_SID_MATCH"
  | "ADJACENCY_CROSS_CONNECT"
  | "DECAP_IPV6"
  | "DELIVER"
  | "POLICY_UNAVAILABLE_DROP"
  | "POLICY_UNAVAILABLE_FALLBACK";
export interface JourneyHop {
  router: NodeId;
  input: string;
  lookup: string;
  action: Srv6PolicyAction;
  output: string;
}

// ---------------------------------------------------------------------------
// Top-level scenario state
// ---------------------------------------------------------------------------

export interface TroubleshootingState {
  started: boolean;
  repairAttempt?: { choice: string; correct: boolean };
  verified: boolean;
}

export interface Srv6PolicyState {
  links: LinkDef[];
  locators: Srv6Locator[];
  localSidTable: LocalSidTable;
  srDbR3EndXVerified: boolean;
  policyConfigured: boolean;
  candidates: CandidatePathDef[];
  dropUponInvalid: boolean;
  flow?: FlowIntent;
  packet?: PolicyPacketState;
  packetAt?: NodeId;
  journey: JourneyHop[];
  bsidExperiment?: BindingSidExperimentResult;
  fault?: { reason: string };
  troubleshooting: TroubleshootingState;
}

export const HEADEND: RouterId = "R1";
export const DESTINATION: RouterId = "R6";

export function createSrv6PolicyState(): Srv6PolicyState {
  return {
    links: LINKS,
    locators: buildLocators(),
    localSidTable: installLocalSids(),
    srDbR3EndXVerified: true,
    policyConfigured: false,
    candidates: [],
    dropUponInvalid: false,
    journey: [],
    troubleshooting: { started: false, verified: false },
  };
}

export function srDatabaseFor(state: Srv6PolicyState): SrDatabaseEntry[] {
  return buildSrDatabase(state.localSidTable, state.srDbR3EndXVerified);
}
export function candidateEvaluationsFor(state: Srv6PolicyState): CandidateEvaluation[] {
  const srDb = srDatabaseFor(state);
  return state.candidates.map((c) => evaluateCandidate(c, state.localSidTable, srDb, state.links, HEADEND, DESTINATION));
}
export function activeCandidateFor(state: Srv6PolicyState): CandidateEvaluation | undefined {
  return selectActiveCandidate(candidateEvaluationsFor(state));
}
export function policyStateFor(state: Srv6PolicyState): PolicyState {
  return determinePolicyState(activeCandidateFor(state), state.policyConfigured);
}

// ---------------------------------------------------------------------------
// Helpers for step authoring
// ---------------------------------------------------------------------------

function entryFor(state: Srv6PolicyState, router: RouterId, functionValue: number): EndpointLocalSidEntry {
  const e = findLocalSid(state.localSidTable, router, functionValue);
  if (!e) throw new Error(`Missing local SID: ${router} function ${functionValue}`);
  return e;
}
const EMPTY_VRFS = {} as Record<VrfName, Vrf>;

const R3_END_X_SID = sidTextFor("R3", FUNCTION.END_X);
const R6_DX6_SID = sidTextFor("R6", FUNCTION.END_DX6);
const R5_END_SID = sidTextFor("R5", FUNCTION.END);
const R3_END_SID = sidTextFor("R3", FUNCTION.END);

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

export const srv6PolicySteps: ScenarioStep<Srv6PolicyState>[] = [
  // === 1. The problem ===========================================================
  {
    id: "intro",
    label: "The Central Question",
    narrative: "SRv6 Endpoint Behaviors taught what a SID does once traffic arrives. This lesson asks the question that comes before that: which ordered set of SIDs should traffic use, why was that path selected, and how does traffic get steered onto it in the first place?",
  },
  {
    id: "ordinary-vs-te",
    label: "Ordinary Reachability vs. Traffic Engineering",
    narrative: `Ordinary IPv6 forwarding answers "how do I reach R6?" Traffic engineering asks "how do I reach R6 while satisfying a particular network intent?" — low latency, a specific adjacency, avoiding a resource, or a preferred engineered path.`,
  },
  {
    id: "sr-policy-intro",
    label: "Introduce: SR Policy",
    narrative: "An SR Policy (RFC 9256) is how that intent becomes real forwarding state — not merely a stored segment list, but an object with identity, one or more candidate paths, validity, preference-based selection, and traffic steering.",
  },

  // === 2. Policy identity ========================================================
  {
    id: "policy-identity",
    label: "Mandatory: Policy Identity <Headend, Color, Endpoint>",
    narrative: `SR Policy <R1, ${POLICY_COLOR}, R6>. Headend: where the policy is instantiated (R1). Color: a non-zero 32-bit intent identifier (${POLICY_COLOR}). Endpoint: the destination node for the policy (R6).`,
    run: (state) => ({ state: { ...state, policyConfigured: true }, events: [] }),
  },
  {
    id: "color-accuracy",
    label: "Mandatory: Color Is Not...",
    narrative: `Color ${POLICY_COLOR} is NOT an MPLS label, an SRv6 SID, an SRH field, or an IPv6 address. It represents policy intent — a value used to SELECT which policy applies, never something imposed onto the wire.`,
  },
  {
    id: "predict-color-srv6-sid",
    label: "Predict",
    narrative: "Before continuing:",
    question: {
      prompt: `Is Color ${POLICY_COLOR} an SRv6 SID?`,
      options: [
        { id: "no", label: "No — Color is a policy/intent identifier, never a routable SID" },
        { id: "yes", label: "Yes — the color value becomes part of the SID" },
      ],
      correctOptionId: "no",
      explanation: "Color selects/matches policy intent. It never becomes an SRH field, a Tag, an IPv6 address, or a SID.",
    },
  },
  {
    id: "sr-mpls-vs-srv6-model",
    label: "Same Policy Architecture, Different Data Plane",
    narrative: "SR-MPLS and SRv6 share the exact same RFC 9256 policy model: identity <H,C,E>, candidate paths, and highest-preference-among-valid selection. Only the segment representation and headend action differ — MPLS label stack + PUSH vs. SRv6 SIDs + H.Encaps.",
  },

  // === 3. Topology + metrics =====================================================
  {
    id: "topology-intro",
    label: "Topology and Dual Metrics",
    narrative: "R1 and R6 are connected by two paths: TOP (via R2, R4) and BOTTOM (via R3, R5), plus a cross-link R3-R4. Every link carries BOTH an IGP metric and a delay metric.",
  },
  {
    id: "predict-igp-shortest",
    label: "Predict",
    narrative: "Before any policy exists:",
    question: {
      prompt: "With no SR Policy in effect, which path does ordinary IGP-shortest-path forwarding take from R1 toward R6?",
      options: [
        { id: "top", label: "TOP (R1→R2→R4→R6, IGP cost 30)" },
        { id: "bottom", label: "BOTTOM (R1→R3→R5→R6, IGP cost 45)" },
      ],
      correctOptionId: "top",
      explanation: "TOP's IGP cost (10+10+10=30) beats BOTTOM's (15+15+15=45) — ordinary forwarding takes TOP.",
    },
  },
  {
    id: "delay-metric-reveal",
    label: "But BOTTOM Has Lower Delay",
    narrative: "TOP: delay 20+20+20 = 60. BOTTOM: delay 5+5+5 = 15. The IGP-shortest path and the lowest-delay path are DIFFERENT paths — exactly the gap SR Policy exists to close.",
  },

  // === 4. SIDs ====================================================================
  {
    id: "sid-allocation",
    label: "SRv6 SIDs For This Lesson",
    narrative: `R3: End (${R3_END_SID}), End.X → R5 (${R3_END_X_SID}). R4: End. R5: End (${R5_END_SID}). R6: End.DX6 → RECEIVER6 (${R6_DX6_SID}). All reuse Foundations' locator scheme and Endpoint Behaviors' exact End/End.X/End.DX6 processing — never reimplemented here.`,
  },
  {
    id: "why-dx6-not-end",
    label: "Why The Final SID Is End.DX6, Not Plain End",
    narrative: "The policy will use H.Encaps with an inner IPv6 probe. Plain End does not decapsulate an H.Encaps packet. The final segment must be R6's End.DX6 so the outer SRv6 encapsulation can actually be removed and the inner probe cross-connected to RECEIVER6.",
  },
  {
    id: "why-not-r3-end-first",
    label: "Mandatory: No Unnecessary R3 End SID",
    narrative: "R3's End.X SID is itself routed under R3's own locator — R1 can route directly to it. There is no need to first send an R3 End SID merely to \"arrive\" before executing End.X, the way some SR-MPLS Adj-SID examples chain a Node SID first. This is a genuine SR-MPLS/SRv6 distinction.",
  },

  // === 5. Explicit candidate ======================================================
  {
    id: "explicit-candidate-intro",
    label: "Explicit Candidate: CP-EXPLICIT",
    narrative: `CP-EXPLICIT — identity CONFIG/R1/10, preference 200. Segment list: <${R3_END_X_SID} (R3 End.X → R5), ${R6_DX6_SID} (R6 End.DX6)>.`,
    run: (state) => ({ state: { ...state, candidates: [EXPLICIT_CANDIDATE] }, events: [] }),
  },
  {
    id: "explicit-forwarding-preview",
    label: "Explicit Path, Forwarding-Wise",
    narrative: "Headend's first active SID: R3 End.X. Physical: R1 → R3. At R3: End.X executes (SL decrements, DA becomes R6 End.DX6, adjacency forced = R3→R5). Then R3 → R5 → R6, and R6 decapsulates to RECEIVER6.",
  },
  {
    id: "explicit-candidate-validation",
    label: "Explicit Candidate Validation",
    narrative: "Validation checks: segment list non-empty, every referenced SID actually exists, every SID is VERIFIED in R1's SR Database, any End.X's underlying adjacency link is up, the first SID is reachable from the headend, and the final SID belongs to endpoint R6.",
  },

  // === 6. Dynamic candidate =======================================================
  {
    id: "dynamic-candidate-intro",
    label: "Dynamic Candidate: CP-DYNAMIC",
    narrative: "CP-DYNAMIC — identity LOCAL/R1/20, preference 100, objective MIN_DELAY. Instead of a fixed list, R1 computes the segment list fresh from the TE database every time it's evaluated.",
    run: (state) => ({ state: { ...state, candidates: [EXPLICIT_CANDIDATE, DYNAMIC_CANDIDATE] }, events: [] }),
  },
  {
    id: "dynamic-computation-explain",
    label: "Dynamic Computation",
    narrative: "TE database → apply objective MIN_DELAY → shortest-delay path R1→R3→R5→R6 (delay 15) → derive a compact SRv6 program from it. Nothing here is UI-hardcoded — computeDynamicCandidate() and deriveSrv6SegmentListFromPath() are real pure functions.",
  },
  {
    id: "dynamic-segment-list-reveal",
    label: "Derived Segment List: Minimal, Not Mechanical",
    narrative: `R1's ORDINARY (unconstrained) shortest path to R5 already passes through R3 — so a plain ${R5_END_SID} (R5 End) alone reaches R5 via R1→R3→R5, no adjacency SID required. The derived dynamic segment list is <${R5_END_SID}, ${R6_DX6_SID}> — proven by domain computation, not assumed because it "looks reasonable."`,
  },
  {
    id: "predict-dynamic-recompute",
    label: "Predict",
    narrative: "Before moving on:",
    question: {
      prompt: "Does the dynamic candidate's computation rerun when the relevant topology input changes?",
      options: [
        { id: "yes", label: "Yes — it is computed fresh every time it's evaluated, never cached" },
        { id: "no", label: "No — it is computed once and then frozen like the explicit list" },
      ],
      correctOptionId: "yes",
      explanation: "computeDynamicCandidate() re-derives the path and segment list from current TE state on every evaluation — it can never go stale relative to the live topology.",
    },
  },

  // === 7. Selection ================================================================
  {
    id: "selection-fn-explain",
    label: "selectActiveCandidate()",
    narrative: "Validate every candidate, discard the invalid ones, and take the highest preference among the SURVIVORS. An invalid higher-preference candidate never wins merely because its number is larger.",
  },
  {
    id: "predict-both-valid-preference",
    label: "Predict",
    narrative: "Both CP-EXPLICIT (pref 200) and CP-DYNAMIC (pref 100) are currently valid.",
    question: {
      prompt: "Which candidate should be active?",
      options: [
        { id: "explicit", label: "CP-EXPLICIT — higher preference among valid candidates" },
        { id: "dynamic", label: "CP-DYNAMIC — lower preference is always safer" },
      ],
      correctOptionId: "explicit",
      explanation: "Among valid candidates, highest preference wins. CP-EXPLICIT (200) beats CP-DYNAMIC (100).",
    },
  },
  {
    id: "active-candidate-shown",
    label: "Active Candidate: CP-EXPLICIT",
    narrative: "Both candidates are VALID. CP-EXPLICIT (preference 200) beats CP-DYNAMIC (preference 100) — CP-EXPLICIT is ACTIVE. Validity is checked first; preference is compared only among the survivors.",
  },

  // === 8. Binding SID =============================================================
  {
    id: "bsid-intro",
    label: "Binding SID",
    narrative: `R1 allocates a Binding SID for this policy: ${BSID_TEXT}. In SRv6, a BSID is an IPv6 SID — not an MPLS label. It represents an instruction bound to the POLICY itself, not merely an alias for whichever segment list is currently active.`,
  },
  {
    id: "predict-bsid-mpls",
    label: "Predict",
    narrative: "Before continuing:",
    question: {
      prompt: "Is an SRv6 Binding SID an MPLS label?",
      options: [
        { id: "no", label: "No — it is an IPv6 SID, locally significant to R1" },
        { id: "yes", label: "Yes — SRv6 reuses MPLS labels for the BSID" },
      ],
      correctOptionId: "no",
      explanation: "SRv6's Binding SID is a real 128-bit IPv6 address, bound to the policy at R1 — never an MPLS label.",
    },
  },

  // === 9. Steering ================================================================
  {
    id: "steering-separate",
    label: "Steering Is Separate From Policy Construction",
    narrative: "An UP SR Policy does not automatically intercept every packet toward its endpoint. Constructing the policy and steering traffic into it are two different functions.",
  },
  {
    id: "predict-up-means-steered",
    label: "Predict",
    narrative: "The SR Policy is UP with an active candidate.",
    question: {
      prompt: "Does an UP SR Policy automatically mean every packet toward its endpoint uses it?",
      options: [
        { id: "no", label: "No — traffic must be classified and steered into the policy" },
        { id: "yes", label: "Yes — an UP policy intercepts all matching traffic automatically" },
      ],
      correctOptionId: "no",
      explanation: "A policy can be UP while unclassified traffic still uses ordinary IGP forwarding, never having been steered into it at all.",
    },
  },
  {
    id: "steering-method",
    label: "PacketVerse Local Policy-Based Steering",
    narrative: `Flow intent LOW_LATENCY → Color ${POLICY_COLOR} → Endpoint R6 → match SR Policy <R1,${POLICY_COLOR},R6>. RFC 9256 supports several steering methods (including BGP destination steering via Color Extended Communities) — this lesson deliberately models only local, non-BGP classification.`,
  },
  {
    id: "color-not-srh-field",
    label: "Mandatory: Color Never Becomes SRH State",
    narrative: `Color ${POLICY_COLOR} selects and matches policy intent. It does NOT become Segments Left, the SRH Tag, the IPv6 DA, or a SID. PacketVerse never sets SRH Tag = Color.`,
  },

  // === 10. H.Encaps + main packet walk ============================================
  {
    id: "h-encaps-explain",
    label: "H.Encaps",
    narrative: "R1 steers the classified packet onto the active policy using H.Encaps: a NEW outer IPv6 header (SA = R1's SR source, DA = the first SID of the active candidate's segment list) plus an SRH carrying the rest of the list, with the ORIGINAL packet fully preserved as the inner payload.",
  },
  {
    id: "send-low-latency",
    label: "Send: LOW_LATENCY Flow",
    narrative: `CLIENT1 sends an IPv6 probe to RECEIVER6. R1 classifies it as LOW_LATENCY → Color ${POLICY_COLOR} → matches SR Policy <R1,${POLICY_COLOR},R6>.`,
    packet: () => ({ id: "client-probe", protocol: "IPV6", from: "CLIENT1", to: "R1", summary: "Original IPv6 probe, CLIENT1 → RECEIVER6", layers: [innerIpv6Layer(receiverInner())] }),
    run: (state) => ({ state: { ...state, flow: "LOW_LATENCY", packet: undefined, packetAt: "R1", journey: [] }, events: [] }),
  },
  {
    id: "r1-steering-match",
    label: "R1: Steering Match",
    narrative: `Local classifier: LOW_LATENCY → Color ${POLICY_COLOR}, Endpoint R6 → SR Policy <R1,${POLICY_COLOR},R6> matched.`,
    run: (state) => ({ state: { ...state, journey: [...state.journey, { router: "R1", input: "IPv6 probe", lookup: `Steering: intent LOW_LATENCY → Color ${POLICY_COLOR}`, action: "STEERING_MATCH", output: `Policy <R1,${POLICY_COLOR},R6> matched` }] }, events: [] }),
  },
  {
    id: "r1-policy-select",
    label: "R1: Policy Resolution",
    narrative: "Policy resolved → candidates evaluated → CP-EXPLICIT (preference 200) is VALID and ACTIVE → its segment list is selected for imposition.",
    run: (state) => {
      const active = activeCandidateFor(state);
      return { state: { ...state, journey: [...state.journey, { router: "R1", input: "Policy matched", lookup: "Evaluate candidates → highest-preference VALID wins", action: "POLICY_SELECT", output: `${active?.def.name ?? "NONE"} selected` }] }, events: [] };
    },
  },
  {
    id: "r1-h-encaps",
    label: "R1: H.Encaps",
    narrative: `Outer SA = R1-SR-SOURCE, outer DA = ${R3_END_X_SID} (first SID). SRH: Segment List[0] = ${R6_DX6_SID}, Segment List[1] = ${R3_END_X_SID}. Last Entry = 1, Segments Left = 1. Inner: the original IPv6 probe, fully preserved.`,
    packet: (state) => {
      const active = activeCandidateFor(state);
      if (!active) return undefined;
      const pkt = executeHEncaps(active.segments, receiverInner());
      return policyPacket("h-encaps", "R1", "R1", "H.Encaps applied", "H.ENCAPS", pkt);
    },
    run: (state) => {
      const active = activeCandidateFor(state);
      if (!active) return { state, events: [] };
      const pkt = executeHEncaps(active.segments, receiverInner());
      return { state: { ...state, packet: pkt, packetAt: "R1", journey: [...state.journey, { router: "R1", input: "Active segment list resolved", lookup: "H.Encaps: new outer IPv6 + SRH, original packet preserved as payload", action: "HEADEND_ENCAPS", output: fmtIpv6(pkt.outer.daHextets) }] }, events: [] };
    },
  },
  {
    id: "predict-hencaps-da",
    label: "Predict",
    narrative: "Before the packet moves:",
    question: {
      prompt: "Does H.Encaps set the outer IPv6 DA to the first SID of the active segment list?",
      options: [
        { id: "yes", label: "Yes — outer DA = the first (currently active) segment" },
        { id: "no", label: "No — outer DA is always the endpoint's address directly" },
      ],
      correctOptionId: "yes",
      explanation: "The active segment IS the outer DA. The remaining segments ride in the SRH, imposed in reversed storage order.",
    },
  },
  {
    id: "r1-forward-to-r3",
    label: "R1: Route Toward R3's Locator",
    narrative: "R1 does an ordinary IPv6 FIB lookup toward the active DA's locator — R3 is directly connected.",
    packet: (state) => (state.packet ? policyPacket("r1-fwd", "R1", "R3", "IPv6 FIB forward toward R3 locator", "FIB", state.packet) : undefined),
    run: (state) => ({ state: { ...state, packetAt: "R3", journey: [...state.journey, { router: "R1", input: fmtIpv6(state.packet!.outer.daHextets), lookup: "IPv6 FIB: R3 locator — directly connected", action: "IPV6_FIB_FORWARD", output: fmtIpv6(state.packet!.outer.daHextets) }] }, events: [] }),
  },
  {
    id: "r3-local-sid-match",
    label: "R3: Local SID Match — End.X",
    narrative: `R3's Local SID Table matches ${R3_END_X_SID} to behavior End.X (adjacency R5).`,
    packet: (state) => (state.packet ? policyPacket("r3-match", "R3", "R3", "Local SID match — End.X", "MATCH", state.packet) : undefined),
    run: (state) => ({ state: { ...state, journey: [...state.journey, { router: "R3", input: fmtIpv6(state.packet!.outer.daHextets), lookup: "Local SID table: MATCH — End.X, adjacency R5", action: "LOCAL_SID_MATCH", output: "Execute End.X" }] }, events: [] }),
  },
  {
    id: "r3-execute-endx",
    label: "R3: Execute End.X",
    narrative: `End.X performs the SAME segment advancement as End: Segments Left 1 → 0, DA → ${R6_DX6_SID}. The DA is NOT rewritten to R5's address — forwarding is forced via the bound adjacency R3→R5.`,
    packet: (state) => {
      if (!state.packet) return undefined;
      const entry = entryFor(state, "R3", FUNCTION.END_X);
      const outcome = processSrv6EndpointBehavior(entry, state.packet.outer.daHextets, state.packet.outer.srh, state.packet.inner, EMPTY_VRFS);
      return policyPacket("r3-endx", "R3", "R3", "End.X: SL 1→0, DA R3→R6", "END.X", { ...state.packet, outer: { ...state.packet.outer, daHextets: outcome.newDaHextets!, srh: outcome.newSrh } });
    },
    run: (state) => {
      const entry = entryFor(state, "R3", FUNCTION.END_X);
      const outcome = processSrv6EndpointBehavior(entry, state.packet!.outer.daHextets, state.packet!.outer.srh, state.packet!.inner, EMPTY_VRFS);
      return { state: { ...state, packet: { ...state.packet!, outer: { ...state.packet!.outer, daHextets: outcome.newDaHextets!, srh: outcome.newSrh } }, journey: [...state.journey, { router: "R3", input: `${fmtIpv6(state.packet!.outer.daHextets)}, SL=1`, lookup: "End.X executes", action: "LOCAL_SID_MATCH", output: `DA → ${fmtIpv6(outcome.newDaHextets!)}, SL=0 — forward via adjacency R5` }] }, events: [] };
    },
  },
  {
    id: "r3-forward-adjacency",
    label: "R3 → R5: Forced Via Bound Adjacency",
    narrative: "R3 does not do an ordinary IPv6 FIB lookup here — End.X sends the packet out its bound adjacency, R3→R5, regardless of what unconstrained IGP forwarding would otherwise choose.",
    packet: (state) => (state.packet ? policyPacket("r3-adj", "R3", "R5", "Adjacency cross-connect (End.X)", "END.X", state.packet) : undefined),
    run: (state) => ({ state: { ...state, packetAt: "R5", journey: [...state.journey, { router: "R3", input: fmtIpv6(state.packet!.outer.daHextets), lookup: "End.X adjacency: R3→R5 (bound, not FIB-computed)", action: "ADJACENCY_CROSS_CONNECT", output: fmtIpv6(state.packet!.outer.daHextets) }] }, events: [] }),
  },
  {
    id: "r5-transit",
    label: "R5: Ordinary Transit",
    narrative: "R5 owns its own End SID, but this DA is R6's — no local match here, so R5 is ordinary transit, forwarding directly to R6.",
    packet: (state) => (state.packet ? policyPacket("r5-transit", "R5", "R6", "IPv6 FIB forward (unchanged)", "FIB", state.packet) : undefined),
    run: (state) => ({ state: { ...state, packetAt: "R6", journey: [...state.journey, { router: "R5", input: fmtIpv6(state.packet!.outer.daHextets), lookup: "Local SID table: no match. IPv6 FIB: directly connected to R6.", action: "IPV6_FIB_FORWARD", output: fmtIpv6(state.packet!.outer.daHextets) }] }, events: [] }),
  },
  {
    id: "r6-execute-dx6",
    label: "R6: Execute End.DX6 — Decap",
    narrative: "Final-segment check passes (Segments Left = 0). Payload check: inner is IPv6, as expected. Decapsulate the outer IPv6 + SRH, exposing the original probe, then cross-connect it directly to RECEIVER6.",
    packet: (state) => (state.packet ? policyPacket("r6-dx6", "R6", "R6", "Local SID match — End.DX6", "MATCH", state.packet) : undefined),
    run: (state) => {
      const entry = entryFor(state, "R6", FUNCTION.END_DX6);
      const outcome = processSrv6EndpointBehavior(entry, state.packet!.outer.daHextets, state.packet!.outer.srh, state.packet!.inner, EMPTY_VRFS);
      return { state: { ...state, journey: [...state.journey, { router: "R6", input: fmtIpv6(state.packet!.outer.daHextets), lookup: "Local SID table: MATCH — End.DX6, adjacency RECEIVER6", action: "LOCAL_SID_MATCH", output: `Decapsulate → adjacency ${outcome.ceTarget}` }] }, events: [] };
    },
  },
  {
    id: "r6-deliver",
    label: "R6 → RECEIVER6: Delivered",
    narrative: "Path taken: R1 → R3 → R5 → R6 → RECEIVER6 — the SR Policy's active candidate, not the ordinary IGP-shortest TOP path.",
    packet: (state) => (state.packet ? policyPacket("r6-deliver", "R6", "RECEIVER6", "Decap + adjacency cross-connect to RECEIVER6", "DECAP", state.packet) : undefined),
    run: (state) => ({ state: { ...state, journey: [...state.journey, { router: "R6", input: "IPv6 probe", lookup: "End.DX6: decapsulate, cross-connect to RECEIVER6", action: "DECAP_IPV6", output: "Delivered to RECEIVER6" }] }, events: [] }),
    whatChanged: () => ["Delivered R1 → R3 → R5 → R6 → RECEIVER6 via SR Policy CP-EXPLICIT — not the ordinary IGP-shortest TOP path"],
  },

  // === 11. Full SRH recap =========================================================
  {
    id: "full-srh-recap",
    label: "Full SRH, Reviewed",
    narrative: `<R3 End.X, R6 End.DX6> encodes as: outer DA = ${R3_END_X_SID}, Last Entry = 1, Segments Left = 1, Segment List[0] = ${R6_DX6_SID} (final), Segment List[1] = ${R3_END_X_SID} (first). Storage order is reversed — index 0 is always the final segment.`,
  },
  {
    id: "hencaps-red-preview",
    label: "Preview: H.Encaps.Red",
    narrative: "H.Encaps.Red (Reduced SRH) excludes the first SID from SRH storage entirely, because it already exists as the outer IPv6 DA. This lesson deliberately stays on full SRH for visibility — H.Encaps.Red is previewed only, never used as the main mode here.",
  },

  // === 12. Weighted segment-list lab (read-only) ==================================
  {
    id: "weighted-lab-intro",
    label: "Read-Only Lab: Weighted Segment Lists",
    narrative: "A candidate path can own MORE than one segment list, with weights distributing traffic among them. SL-A (weight 80) and SL-B (weight 20) are shown here purely for illustration — decoupled from CP-EXPLICIT/CP-DYNAMIC so the main policy stays a simple, deterministic two-candidate comparison.",
  },
  {
    id: "weighted-lab-explain",
    label: "Flow-Based, Not Packet Round-Robin",
    narrative: "Twenty deterministic pseudo-flows (flow-1 .. flow-20) are hashed once each into SL-A or SL-B, approximating an 80/20 split. The SAME flow always maps to the SAME list — weights apply to flows, never to every fifth individual packet.",
  },
  {
    id: "candidate-not-segment-list",
    label: "Mandatory: Candidate Path ≠ Segment List",
    narrative: "A candidate path's identity (CONFIG/R1/10, say) never changes just because it happens to own two weighted segment lists instead of one, or because a dynamic recomputation replaces its list contents. The candidate IS the identity + type + preference; the segment list is only what it currently resolves to.",
  },

  // === 13. Candidate failure / failover ============================================
  {
    id: "failure-intro",
    label: "Candidate Failure",
    narrative: "CP-EXPLICIT (preference 200) is currently ACTIVE. Now fail the R3-R5 link.",
  },
  {
    id: "fail-r3-r5",
    label: "R3-R5 Link Down",
    narrative: "R3's End.X SID is associated with the R3→R5 adjacency. When the link fails, the control plane coherently withdraws verification of that SID from R1's SR Database — it does not merely get manually marked invalid.",
    run: (state) => ({ state: { ...state, links: state.links.filter((l) => l.id !== "R3-R5"), srDbR3EndXVerified: false, packet: undefined, packetAt: undefined, journey: [] }, events: [] }),
    whatChanged: () => ["R3-R5: UP → DOWN", "R1's SR Database: R3 End.X verification withdrawn", "CP-EXPLICIT: VALID → INVALID"],
  },
  {
    id: "predict-invalid-vs-valid",
    label: "Predict",
    narrative: "CP-EXPLICIT has preference 200 but is now INVALID. CP-DYNAMIC has preference 100 and is VALID.",
    question: {
      prompt: "Which candidate should be active?",
      options: [
        { id: "dynamic", label: "CP-DYNAMIC — the highest-preference VALID candidate wins" },
        { id: "explicit", label: "CP-EXPLICIT — its preference number is still larger" },
      ],
      correctOptionId: "dynamic",
      explanation: "An invalid higher-preference candidate never wins merely because its number is larger. Preference is only compared among VALID candidates.",
    },
  },
  {
    id: "dynamic-recompute",
    label: "CP-DYNAMIC Recomputes",
    narrative: `With R3-R5 down, the lowest-delay path is now R1→R3→R4→R6 (delay 5+15+20=40, beating TOP's 60). R1's ORDINARY shortest path to R3 is direct, and from R3 the ordinary shortest path to R6 (with R3-R5 down) already goes via R4 — so the derived list collapses to <${R3_END_SID}, ${R6_DX6_SID}>. Calculated, not asserted.`,
  },
  {
    id: "dynamic-becomes-active",
    label: "CP-DYNAMIC Becomes Active",
    narrative: "CP-DYNAMIC remains VALID and, as the only valid candidate, becomes ACTIVE. SR Policy state remains UP throughout — candidate failure did not make the whole policy fail.",
  },
  {
    id: "predict-candidate-vs-policy-failure",
    label: "Predict",
    narrative: "CP-EXPLICIT just became invalid, and CP-DYNAMIC took over.",
    question: {
      prompt: "Can candidate failure occur while the SR Policy itself remains valid?",
      options: [
        { id: "yes", label: "Yes — as long as another candidate is still valid, the policy stays UP" },
        { id: "no", label: "No — any candidate failure takes the whole policy down" },
      ],
      correctOptionId: "yes",
      explanation: "The policy is UP if AT LEAST ONE candidate is valid. Candidate failure and policy failure are different events.",
    },
  },
  {
    id: "send-after-failover",
    label: "Send Again After Failover",
    narrative: "New traffic must be freshly encapsulated from the NEW active candidate — never a reused, stale SRH from CP-EXPLICIT.",
    packet: () => ({ id: "client-probe-2", protocol: "IPV6", from: "CLIENT1", to: "R1", summary: "Original IPv6 probe, CLIENT1 → RECEIVER6", layers: [innerIpv6Layer(receiverInner())] }),
    run: (state) => ({ state: { ...state, packet: undefined, packetAt: "R1", journey: [] }, events: [] }),
  },
  {
    id: "failover-h-encaps",
    label: "R1: Fresh H.Encaps From CP-DYNAMIC",
    narrative: `New outer DA = ${R3_END_SID} (R3 End — not End.X this time). New SRH built from CP-DYNAMIC's freshly computed list.`,
    packet: (state) => {
      const active = activeCandidateFor(state);
      if (!active) return undefined;
      const pkt = executeHEncaps(active.segments, receiverInner());
      return policyPacket("failover-encaps", "R1", "R1", "H.Encaps from CP-DYNAMIC", "H.ENCAPS", pkt);
    },
    run: (state) => {
      const active = activeCandidateFor(state);
      if (!active) return { state, events: [] };
      const pkt = executeHEncaps(active.segments, receiverInner());
      return { state: { ...state, packet: pkt, packetAt: "R1", journey: [...state.journey, { router: "R1", input: "CP-DYNAMIC active", lookup: "H.Encaps: fresh outer IPv6 + SRH from the new active candidate", action: "HEADEND_ENCAPS", output: fmtIpv6(pkt.outer.daHextets) }] }, events: [] };
    },
  },
  {
    id: "failover-transit",
    label: "R1 → R3 → R4 → R6 → RECEIVER6",
    narrative: "R3's plain End SID completes and advances toward R6; ordinary IPv6 FIB (with R3-R5 down) now takes R3→R4→R6; R6's End.DX6 decapsulates and delivers to RECEIVER6.",
    packet: (state) => (state.packet ? policyPacket("failover-deliver", "R3", "RECEIVER6", "Delivered via CP-DYNAMIC's new path", "DECAP", state.packet) : undefined),
    run: (state) => {
      const r3 = entryFor(state, "R3", FUNCTION.END);
      const outcome = processSrv6EndpointBehavior(r3, state.packet!.outer.daHextets, state.packet!.outer.srh, state.packet!.inner, EMPTY_VRFS);
      const afterR3 = { ...state.packet!, outer: { ...state.packet!.outer, daHextets: outcome.newDaHextets!, srh: outcome.newSrh } };
      const r6 = entryFor(state, "R6", FUNCTION.END_DX6);
      const finalOutcome = processSrv6EndpointBehavior(r6, afterR3.outer.daHextets, afterR3.outer.srh, afterR3.inner, EMPTY_VRFS);
      return {
        state: {
          ...state,
          packet: afterR3,
          journey: [
            ...state.journey,
            { router: "R3", input: fmtIpv6(state.packet!.outer.daHextets), lookup: "Local SID table: MATCH — End; ordinary FIB forward next", action: "LOCAL_SID_MATCH", output: `DA → ${fmtIpv6(outcome.newDaHextets!)}` },
            { router: "R3", input: fmtIpv6(outcome.newDaHextets!), lookup: "IPv6 FIB (R3-R5 down): shortest path to R6 via R4", action: "IPV6_FIB_FORWARD", output: fmtIpv6(outcome.newDaHextets!) },
            { router: "R4", input: fmtIpv6(outcome.newDaHextets!), lookup: "Local SID table: no match. IPv6 FIB: directly connected to R6.", action: "IPV6_FIB_FORWARD", output: fmtIpv6(outcome.newDaHextets!) },
            { router: "R6", input: fmtIpv6(outcome.newDaHextets!), lookup: "Local SID table: MATCH — End.DX6", action: "DECAP_IPV6", output: `Delivered to ${finalOutcome.ceTarget}` },
          ],
        },
        events: [],
      };
    },
    whatChanged: () => ["Delivered R1 → R3 → R4 → R6 → RECEIVER6 — a fresh SRH and physical path from CP-DYNAMIC, not a reused stale one"],
  },
  {
    id: "not-tilfa",
    label: "This Is Not TI-LFA",
    narrative: "Candidate-path failover is headend policy re-selection, reacting after R1 learns the topology changed — not a local, precomputed repair near the failure. This lesson does not build or claim TI-LFA's sub-50ms local repair.",
  },

  // === 14. Recovery + main troubleshooting incident ===============================
  {
    id: "restore-r3-r5-partial",
    label: "R3-R5 Restored — But Verification Stays Missing",
    narrative: "The physical R3-R5 link recovers, and R3's Local SID Table still shows its End.X SID installed. But R1's SR Database is deliberately left WITHOUT re-verifying that SID — a real, separate control-plane step that has not happened yet.",
    run: (state) => ({ state: { ...state, links: LINKS, troubleshooting: { ...state.troubleshooting, started: true }, packet: undefined, packetAt: undefined, journey: [] }, events: [] }),
    whatChanged: () => ["R3-R5: DOWN → UP (physical)", "R3 local End.X: installed (unchanged)", "R1 SR Database: R3 End.X verification — still missing"],
  },
  {
    id: "incident-report",
    label: "Incident",
    narrative: "R3-R5 is restored. R3 shows its End.X SID installed. IPv6 connectivity is healthy end to end. CP-EXPLICIT has preference 200, but CP-DYNAMIC (preference 100) remains active.",
  },
  {
    id: "predict-fault-hypothesis",
    label: "Predict",
    narrative: "Before diagnosing:",
    question: {
      prompt: "Given the link and the local SID are both healthy, what is the most likely reason CP-EXPLICIT still isn't active?",
      options: [
        { id: "sr-db", label: "R1's SR Database has not re-verified R3's End.X SID yet" },
        { id: "igp", label: "The IGP has stopped computing a path to R3" },
        { id: "endpoint", label: "R6 is no longer reachable" },
      ],
      correctOptionId: "sr-db",
      explanation: "Physical link health and local SID instantiation are confirmed healthy. What's missing is R1's own control-plane verification of that SID — exactly the \"locator route ≠ local SID entry\"-style distinction applied one layer up, at the policy's own SR Database.",
      hints: ["Every layer below policy-candidate validity — interfaces, IGP, the local SID itself — is confirmed healthy.", "The question is what R1's OWN SR Database believes about that SID, not whether R3 actually has it."],
    },
  },
  {
    id: "diagnostic-ladder",
    label: "Diagnostic Ladder",
    narrative: "R1 interfaces, R3-R5 adjacency, IPv6 IGP, R3's locator, R6's endpoint reachability, the policy identity, CP-EXPLICIT's configuration and preference, and R3's local End.X installation are ALL healthy. R1's SR Database verification of that exact SID is what's missing — which is why the explicit segment list, and therefore CP-EXPLICIT itself, is invalid.",
  },

  // === 15. Wrong repairs / correct repair ==========================================
  {
    id: "repair-challenge",
    label: "Engineer Challenge — Engineer The IPv6 Path",
    narrative: "Choose the correct repair to restore CP-EXPLICIT as the active candidate.",
    action: (state, payload) => {
      const choice = typeof payload === "object" && payload !== null && "choice" in payload ? String((payload as { choice: string }).choice) : "";
      const correct = choice === "reverify-sr-db";
      return { state: { ...state, srDbR3EndXVerified: correct ? true : state.srDbR3EndXVerified, troubleshooting: { ...state.troubleshooting, repairAttempt: { choice, correct } } }, events: [] };
    },
    requiresState: (state) => state.troubleshooting.repairAttempt?.correct === true,
  },
  {
    id: "repair-verified-note",
    label: "SR Database Re-Verified",
    narrative: `R1 relearns and verifies R3's End.X SID (${R3_END_X_SID}). Advertisement/relearn → SR Database verification → explicit segment list becomes valid → selection reruns → preference 200 wins.`,
    whatChanged: () => ["R1's SR Database: R3 End.X — UNVERIFIED → VERIFIED", "CP-EXPLICIT: INVALID → VALID and ACTIVE"],
  },
  {
    id: "mandatory-resend",
    label: "Mandatory Resend",
    narrative: "Re-verifying the SR Database alone doesn't complete the repair — resend the flow and confirm the physical path end to end.",
    packet: () => ({ id: "client-probe-3", protocol: "IPV6", from: "CLIENT1", to: "R1", summary: "Original IPv6 probe, CLIENT1 → RECEIVER6", layers: [innerIpv6Layer(receiverInner())] }),
    run: (state) => ({ state: { ...state, packet: undefined, packetAt: "R1", journey: [] }, events: [] }),
  },
  {
    id: "repaired-h-encaps",
    label: "R1: H.Encaps From Restored CP-EXPLICIT",
    narrative: `CP-EXPLICIT (preference 200) is active again. New outer DA = ${R3_END_X_SID}.`,
    packet: (state) => {
      const active = activeCandidateFor(state);
      if (!active) return undefined;
      const pkt = executeHEncaps(active.segments, receiverInner());
      return policyPacket("repaired-encaps", "R1", "R1", "H.Encaps from restored CP-EXPLICIT", "H.ENCAPS", pkt);
    },
    run: (state) => {
      const active = activeCandidateFor(state);
      if (!active) return { state, events: [] };
      const pkt = executeHEncaps(active.segments, receiverInner());
      return { state: { ...state, packet: pkt, packetAt: "R1", journey: [...state.journey, { router: "R1", input: "CP-EXPLICIT active", lookup: "H.Encaps: outer IPv6 + SRH from restored CP-EXPLICIT", action: "HEADEND_ENCAPS", output: fmtIpv6(pkt.outer.daHextets) }] }, events: [] };
    },
  },
  {
    id: "repaired-transit",
    label: "R1 → R3 (End.X, R3→R5) → R5 → R6 → RECEIVER6",
    narrative: "R3's End.X forces the R3→R5 adjacency exactly as originally engineered; R6's End.DX6 decapsulates and delivers.",
    packet: (state) => (state.packet ? policyPacket("repaired-deliver", "R3", "RECEIVER6", "Delivered via restored CP-EXPLICIT", "DECAP", state.packet) : undefined),
    run: (state) => {
      const r3 = entryFor(state, "R3", FUNCTION.END_X);
      const outcome = processSrv6EndpointBehavior(r3, state.packet!.outer.daHextets, state.packet!.outer.srh, state.packet!.inner, EMPTY_VRFS);
      const afterR3 = { ...state.packet!, outer: { ...state.packet!.outer, daHextets: outcome.newDaHextets!, srh: outcome.newSrh } };
      const r6 = entryFor(state, "R6", FUNCTION.END_DX6);
      const finalOutcome = processSrv6EndpointBehavior(r6, afterR3.outer.daHextets, afterR3.outer.srh, afterR3.inner, EMPTY_VRFS);
      return {
        state: {
          ...state,
          packet: afterR3,
          troubleshooting: { ...state.troubleshooting, verified: true },
          journey: [
            ...state.journey,
            { router: "R3", input: fmtIpv6(state.packet!.outer.daHextets), lookup: "End.X executes", action: "LOCAL_SID_MATCH", output: `DA → ${fmtIpv6(outcome.newDaHextets!)} — forward via adjacency R5` },
            { router: "R3", input: fmtIpv6(outcome.newDaHextets!), lookup: "End.X adjacency: R3→R5", action: "ADJACENCY_CROSS_CONNECT", output: fmtIpv6(outcome.newDaHextets!) },
            { router: "R5", input: fmtIpv6(outcome.newDaHextets!), lookup: "Local SID table: no match. IPv6 FIB: directly connected to R6.", action: "IPV6_FIB_FORWARD", output: fmtIpv6(outcome.newDaHextets!) },
            { router: "R6", input: fmtIpv6(outcome.newDaHextets!), lookup: "Local SID table: MATCH — End.DX6", action: "DECAP_IPV6", output: `Delivered to ${finalOutcome.ceTarget} — repair verified` },
          ],
        },
        events: [],
      };
    },
    whatChanged: () => ["Delivered R1 → R3 → R5 → R6 → RECEIVER6 — CP-EXPLICIT restored and verified with a real resend"],
  },

  // === 16. Wrong repairs (standards-validation asides) =============================
  {
    id: "wrong-repair-1-note",
    label: "Wrong Repair: Raise Preference To 500",
    narrative: "Increasing CP-EXPLICIT's preference from 200 to 500 changes nothing — invalid candidates never become active because of higher preference. This is the same rule already proven twice in this lesson.",
  },
  {
    id: "wrong-repair-2-note",
    label: "Wrong Repair: Change R1's Route To R6",
    narrative: "R1's ordinary IPv6 reachability to R6 was never broken — CP-DYNAMIC has been delivering traffic the entire time. Changing routes fixes nothing about SR Database verification.",
  },
  {
    id: "wrong-repair-3-note",
    label: "Wrong Repair: Manually Edit The Current Packet's SRH",
    narrative: "The headend constructs the SRH FROM the active candidate's policy state, every time, from scratch. Hand-editing one packet's SRH doesn't repair the control-plane cause and won't survive the next H.Encaps.",
  },

  // === 17. Policy-invalid experiment + Drop-Upon-Invalid ===========================
  {
    id: "policy-invalid-setup",
    label: "Policy-Invalid Experiment",
    narrative: "Now deliberately invalidate BOTH candidates — fail R3-R5 (again) and R4-R6 too. With R3-R5 and R4-R6 both down, R5 and R6 are cut off from R1 entirely (R3-R4 alone cannot reach R6 without R4-R6) — no path exists for CP-DYNAMIC to compute either.",
    run: (state) => ({ state: { ...state, links: state.links.filter((l) => l.id !== "R3-R5" && l.id !== "R4-R6"), srDbR3EndXVerified: false, packet: undefined, packetAt: undefined, journey: [] }, events: [] }),
    whatChanged: () => ["R3-R5: DOWN", "R4-R6: DOWN", "CP-EXPLICIT: INVALID", "CP-DYNAMIC: no path exists — INVALID"],
  },
  {
    id: "policy-invalid-shown",
    label: "SR Policy: INVALID",
    narrative: "No valid candidate exists. SR Policy <R1,100,R6> transitions to NO_VALID_CANDIDATE. Try the Drop-Upon-Invalid toggle below and resend to see the difference yourself.",
    action: (state, payload) => {
      if (typeof payload !== "object" || payload === null) return { state, events: [] };
      const p = payload as { toggleDrop?: boolean; send?: boolean };
      let next = state;
      if (p.toggleDrop !== undefined) next = { ...next, dropUponInvalid: p.toggleDrop };
      if (p.send) {
        const fwd = installPolicyForwarding(false, next.dropUponInvalid);
        next = {
          ...next,
          fault: next.dropUponInvalid ? { reason: "SR Policy invalid and Drop-Upon-Invalid is enabled — traffic is dropped, not rerouted." } : undefined,
          packet: undefined,
          packetAt: "R1",
          journey: [{ router: "R1", input: "IPv6 probe", lookup: `Policy invalid; Drop-Upon-Invalid = ${next.dropUponInvalid}`, action: next.dropUponInvalid ? "POLICY_UNAVAILABLE_DROP" : "POLICY_UNAVAILABLE_FALLBACK", output: fwd.detail }],
        };
      }
      return { state: next, events: [] };
    },
  },
  {
    id: "predict-drop-mandatory",
    label: "Predict",
    narrative: "Before the drop experiment:",
    question: {
      prompt: "Does Drop-Upon-Invalid always apply automatically to every SR Policy?",
      options: [
        { id: "no", label: "No — it is an optional, configured behavior" },
        { id: "yes", label: "Yes — every invalid policy always drops traffic by default" },
      ],
      correctOptionId: "no",
      explanation: "Drop-Upon-Invalid is one optional RFC 9256 behavior. This lesson's own unconfigured DEFAULT is an explicit fall-through to ordinary IGP — not a universal claim about every vendor's actual default.",
    },
  },
  {
    id: "default-fallback-demo",
    label: "DEFAULT Mode: Modeled Fallback",
    narrative: "Send LOW_LATENCY traffic with Drop-Upon-Invalid OFF (the current default). PacketVerse's own modeled choice: an invalid policy falls through to ordinary IGP forwarding — explicitly labeled, not implied to be every vendor's behavior.",
    packet: () => ({ id: "client-probe-4", protocol: "IPV6", from: "CLIENT1", to: "R1", summary: "LOW_LATENCY probe — policy invalid, DEFAULT mode", layers: [innerIpv6Layer(receiverInner())] }),
    run: (state) => {
      const fwd = installPolicyForwarding(false, state.dropUponInvalid);
      return { state: { ...state, packet: undefined, packetAt: "R1", journey: [{ router: "R1", input: "IPv6 probe", lookup: `Policy invalid; Drop-Upon-Invalid = ${state.dropUponInvalid}`, action: "POLICY_UNAVAILABLE_FALLBACK", output: fwd.detail }] }, events: [] };
    },
    whatChanged: () => ["DEFAULT mode: policy invalid → falls through to ordinary IGP (PacketVerse's modeled, labeled choice)"],
  },
  {
    id: "enable-drop-upon-invalid",
    label: "Enable Drop-Upon-Invalid",
    narrative: "Toggle Drop-Upon-Invalid ON for this policy.",
    run: (state) => ({ state: { ...state, dropUponInvalid: true }, events: [] }),
    whatChanged: () => ["Drop-Upon-Invalid: DEFAULT → enabled"],
  },
  {
    id: "drop-upon-invalid-demo",
    label: "Drop-Upon-Invalid: Steering Stays Attached, Action = DROP",
    narrative: "Resend the same flow. Now steering remains attached to the (invalid) policy — the forwarding action is DROP, not a silent reroute over IGP.",
    packet: () => ({ id: "client-probe-5", protocol: "IPV6", from: "CLIENT1", to: "R1", summary: "LOW_LATENCY probe — policy invalid, Drop-Upon-Invalid ON", layers: [innerIpv6Layer(receiverInner())] }),
    run: (state) => {
      const fwd = installPolicyForwarding(false, state.dropUponInvalid);
      return { state: { ...state, fault: { reason: "SR Policy invalid and Drop-Upon-Invalid is enabled — traffic is dropped, not rerouted." }, packet: undefined, packetAt: "R1", journey: [{ router: "R1", input: "IPv6 probe", lookup: `Policy invalid; Drop-Upon-Invalid = ${state.dropUponInvalid}`, action: "POLICY_UNAVAILABLE_DROP", output: fwd.detail }] }, events: [] };
    },
    whatChanged: () => ["Drop-Upon-Invalid ON: policy invalid → DROP, no IGP fallback"],
  },
  {
    id: "restore-topology-final",
    label: "Restore Topology",
    narrative: "Restore R3-R5 and R3-R4, and disable Drop-Upon-Invalid. Both candidates return to VALID; CP-EXPLICIT (preference 200) resumes as ACTIVE.",
    run: (state) => ({ state: { ...state, links: LINKS, srDbR3EndXVerified: true, dropUponInvalid: false, fault: undefined, packet: undefined, packetAt: undefined, journey: [] }, events: [] }),
    whatChanged: () => ["R3-R5, R3-R4: UP", "R1 SR Database: R3 End.X — verified", "Drop-Upon-Invalid: disabled", "SR Policy: UP, CP-EXPLICIT ACTIVE"],
  },

  // === 18. Binding SID / End.B6.Encaps advanced experiment =========================
  {
    id: "hencaps-vs-bsid-intro",
    label: "H.Encaps vs. End.B6.Encaps",
    narrative: "H.Encaps: locally classified traffic → headend applies the policy → new IPv6/SRH. End.B6.Encaps: a packet reaches the active LOCAL Binding SID as an endpoint behavior → the policy bound to that BSID applies → a new IPv6/SRH. Both instantiate policy steering, but in different processing contexts — never confuse them.",
  },
  {
    id: "bsid-experiment-setup",
    label: "Advanced Experiment: End.B6.Encaps",
    narrative: `An INCOMING packet arrives with an SRH whose active segment is R1's own BSID (${BSID_TEXT}), with ANOTHER segment still remaining (Segments Left > 0) — never a bare DA=BSID packet with no SRH.`,
  },
  {
    id: "bsid-experiment-execute",
    label: "End.B6.Encaps Executes",
    narrative: "End.B6.Encaps advances the INCOMING SRH exactly like ordinary End (SL decrements, DA becomes the next segment) — then pushes a BRAND NEW outer IPv6 + SRH for the policy bound to this BSID, nesting the (now-advanced) incoming packet as payload. New outer DA = the first SID of that bound policy.",
    packet: (state) => {
      const active = activeCandidateFor(state);
      const r6 = entryFor(state, "R6", FUNCTION.END_DX6);
      if (!active) return undefined;
      const result = executeBindingSidExperiment(active.segments, r6.sidHextets, r6.sidText);
      return { id: "bsid-experiment", protocol: "IPV6", from: "R1", to: "R1", summary: "NESTED POLICY ENCAPSULATION — End.B6.Encaps", badge: "END.B6.ENCAPS", layers: result.layers };
    },
    run: (state) => {
      const active = activeCandidateFor(state);
      const r6 = entryFor(state, "R6", FUNCTION.END_DX6);
      if (!active) return { state, events: [] };
      const result = executeBindingSidExperiment(active.segments, r6.sidHextets, r6.sidText);
      return { state: { ...state, bsidExperiment: result }, events: [] };
    },
    whatChanged: () => ["Incoming SRH advanced (BSID → next segment); a NEW outer IPv6+SRH for the bound policy now wraps it — nested policy encapsulation, not direct headend H.Encaps"],
  },
  {
    id: "b6-encaps-red-preview",
    label: "Preview: End.B6.Encaps.Red",
    narrative: "End.B6.Encaps.Red applies the same bound-policy concept with the Reduced-SRH optimization. No packet is implemented for it here — preview only.",
  },

  // === 19. SR-MPLS comparison ========================================================
  {
    id: "sr-mpls-comparison",
    label: "SR-MPLS vs. SRv6 Policy — Side By Side",
    narrative: "Policy identity: <H,C,E> both. Candidate selection: RFC 9256 both. Preference: same model both. Segment representation: labels vs. IPv6 SIDs. Headend action: push label stack vs. H.Encaps. Active segment: top label vs. IPv6 DA. Program: label stack vs. SRH. Adjacency segment: Adj-SID label vs. End.X SID. BSID: label vs. IPv6 SID. The policy architecture is shared — only the data-plane instantiation differs.",
  },

  // === 20. Completion ===============================================================
  {
    id: "engineer-challenge-complete",
    label: "Engineer Challenge Complete",
    narrative: "You built SR Policy <R1,100,R6>, inspected TE metrics, created and validated an explicit candidate, computed and validated a dynamic candidate, watched preference decide between two VALID candidates, steered a LOW_LATENCY flow with H.Encaps, verified the full SRH and End.X/End.DX6 composition, survived a real candidate failure and dynamic failover, diagnosed and repaired an SR-Database-verification fault, and explored Drop-Upon-Invalid and a standards-faithful End.B6.Encaps nested encapsulation.",
  },
  {
    id: "complete",
    label: "Lesson Complete",
    narrative: "An SR Policy does not simply choose a segment list: it validates candidate paths, selects the best valid candidate, installs its forwarding program, and steers traffic into that program.",
  },
];

export const STEP_IDX = {
  policyIdentity: stepIdx(srv6PolicySteps, "policy-identity"),
  explicitCandidateIntro: stepIdx(srv6PolicySteps, "explicit-candidate-intro"),
  dynamicCandidateIntro: stepIdx(srv6PolicySteps, "dynamic-candidate-intro"),
  bsidIntro: stepIdx(srv6PolicySteps, "bsid-intro"),
  weightedLabIntro: stepIdx(srv6PolicySteps, "weighted-lab-intro"),
  failureIntro: stepIdx(srv6PolicySteps, "failure-intro"),
  troubleshootingIntro: stepIdx(srv6PolicySteps, "incident-report"),
  diagnosticLadder: stepIdx(srv6PolicySteps, "diagnostic-ladder"),
  repairChallenge: stepIdx(srv6PolicySteps, "repair-challenge"),
  policyInvalidSetup: stepIdx(srv6PolicySteps, "policy-invalid-setup"),
  bsidExperimentSetup: stepIdx(srv6PolicySteps, "bsid-experiment-setup"),
  srMplsComparison: stepIdx(srv6PolicySteps, "sr-mpls-comparison"),
};
function stepIdx(steps: ScenarioStep<Srv6PolicyState>[], id: string): number {
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

export function buildSrv6PolicyCliCommands(state: Srv6PolicyState): CliCommandEntry[] {
  const evals = candidateEvaluationsFor(state);
  const active = selectActiveCandidate(evals);
  const pState = policyStateFor(state);
  const policyTab: CliCommandEntry = {
    id: "policy",
    label: "sr policy",
    concept: `SR Policy <R1,${POLICY_COLOR},R6>, state ${pState}, BSID ${BSID_TEXT}.`,
    cisco: {
      cmd: `show segment-routing traffic-eng policy color ${POLICY_COLOR} endpoint ipv6`,
      output: state.policyConfigured
        ? `Color: ${POLICY_COLOR}  Endpoint: R6\n  Status: ${pState}\n  BSID: ${BSID_TEXT}\n  Candidate Paths:\n${evals.map((e) => `    ${e.def.name} pref ${e.def.preference} ${e.valid ? "valid" : "invalid"}${e === active ? " (active)" : ""}`).join("\n")}`
        : "% Policy not configured",
    },
    juniper: { cmd: `show sr-te policy color ${POLICY_COLOR} endpoint ipv6`, output: state.policyConfigured ? `Color: ${POLICY_COLOR}, State: ${pState}, BSID: ${BSID_TEXT}` : "policy not found" },
  };
  const candidatesTab: CliCommandEntry = {
    id: "candidates",
    label: "candidate paths",
    concept: "Each candidate path's own identity, preference, and validity reason.",
    cisco: { cmd: "show segment-routing traffic-eng policy detail", output: evals.map((e) => `${e.def.name} (${e.def.identity.protocolOrigin}/${e.def.identity.originator}/${e.def.identity.discriminator}): pref ${e.def.preference}, ${e.valid ? "VALID" : "INVALID"} — ${e.reason}`).join("\n") },
    juniper: { cmd: "show sr-te policy candidate-path", output: evals.map((e) => `${e.def.name} pref=${e.def.preference} ${e.valid ? "up" : "down"}`).join("\n") },
  };
  const srDbTab: CliCommandEntry = {
    id: "sr-db",
    label: "sr database",
    concept: "R1's own verified knowledge of routed SRv6 SIDs — separate from whether a SID is actually instantiated at its owner.",
    cisco: { cmd: "show segment-routing srv6 sid database", output: srDatabaseFor(state).map((e) => `${e.sidText}  ${BEHAVIOR_LABEL[e.behavior]}  ${e.verified ? "VERIFIED" : "NOT VERIFIED"}`).join("\n") },
    juniper: { cmd: "show srv6 sid-database", output: srDatabaseFor(state).map((e) => `${e.sidText} ${e.verified ? "up" : "down"}`).join("\n") },
  };
  return [policyTab, candidatesTab, srDbTab];
}
