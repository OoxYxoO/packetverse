import type { PacketLayer, PacketVisual, ScenarioStep } from "../types";

/**
 * SR-MPLS TI-LFA — P-Space, Q-Space, PQ nodes, repair lists, and local
 * fast reroute.
 *
 * Continues directly from /demo/sr-mpls-foundations (Node SID, Adj-SID,
 * SRGB, label stacks), /demo/sr-policy (candidate paths, preference,
 * fallback — explicitly NOT what this lesson is about), and
 * /demo/mpls-rsvp-frr (PLR, Merge Point, local repair, bypass tunnels —
 * the direct conceptual predecessor this lesson contrasts against).
 *
 * Central question: how can an SR router repair traffic locally after a
 * failure without waiting for the headend and without pre-signaling an
 * RSVP bypass tunnel?
 *
 *                      R4
 *                    /    \
 *                   /      \
 *  R1 ───── R2 ─────        ───── R6
 *            \                 /
 *             \               /
 *              R3 ───── R5 ──
 *
 * Required links: R1-R2(10), R2-R4(10), R4-R6(10) [top/primary path],
 * R2-R3(15), R3-R5(15), R5-R6(15) [bottom/post-convergence path].
 * Deliberately NO R3-R4 or R4-R5 cross-link in the base topology — the
 * main worked example (protect R2-R4 or R4, repair via R5's Node SID)
 * depends on R2's own unconstrained shortest path to R5 already going
 * R2→R3→R5 (cost 30) rather than through R4 (cost 35 via R4→R6→R5),
 * which only holds with no cross-link contaminating that comparison. A
 * SEPARATE, clearly-labeled small link set (ADV_MULTI_SID_LINKS, below)
 * is used ONLY for the "when a Node SID alone isn't enough" illustration
 * — it never touches the main lesson's live state.
 *
 * Explicitly deferred (do not build here): Flex-Algo, SRv6, PCEP, BGP SR
 * Policy, multi-area/inter-domain TI-LFA, microloop avoidance, targeted
 * LDP / Remote LFA tunneling (mentioned once as a note, never
 * simulated), a second complete SR Policy simulator (the SR-Policy tie-in
 * reuses only a couple of read-only facts, not srPolicy.ts's engine).
 *
 * Pure data + pure functions only — see /lib/sim-engine/types.ts.
 */

export type RouterId = "R1" | "R2" | "R3" | "R4" | "R5" | "R6";
export const ALL_ROUTERS: RouterId[] = ["R1", "R2", "R3", "R4", "R5", "R6"];
export const HEADEND: RouterId = "R1";
export const DESTINATION: RouterId = "R6";
export const PLR: RouterId = "R2";

export type LinkId = "R1-R2" | "R2-R4" | "R4-R6" | "R2-R3" | "R3-R5" | "R5-R6" | "R3-R4" | "R4-R5";
export interface LinkDef {
  id: LinkId;
  a: RouterId;
  b: RouterId;
  metric: number;
}
export const BASE_LINKS: LinkDef[] = [
  { id: "R1-R2", a: "R1", b: "R2", metric: 10 },
  { id: "R2-R4", a: "R2", b: "R4", metric: 10 },
  { id: "R4-R6", a: "R4", b: "R6", metric: 10 },
  { id: "R2-R3", a: "R2", b: "R3", metric: 15 },
  { id: "R3-R5", a: "R3", b: "R5", metric: 15 },
  { id: "R5-R6", a: "R5", b: "R6", metric: 15 },
];

export const PRIMARY_PATH: RouterId[] = ["R1", "R2", "R4", "R6"];
export const PROTECTED_LINK: LinkId = "R2-R4";
export const PROTECTED_NODE: RouterId = "R4";

export const TERMS: { term: string; expansion: string; meaning: string }[] = [
  { term: "PLR", expansion: "Point of Local Repair", meaning: "The router adjacent to the protected resource that detects a failure and activates a precomputed repair — the same role RSVP-TE FRR uses, expressed with SR instructions instead of a bypass LSP." },
  { term: "P-Space", expansion: "Provider Space", meaning: "Nodes the PLR can reach via its own shortest path without the path traversing the protected resource." },
  { term: "Q-Space", expansion: "Destination's Space", meaning: "Nodes that can reach the destination via their own shortest path without traversing the protected resource." },
  { term: "PQ Node", expansion: "P∩Q Candidate", meaning: "A node in both P-Space and Q-Space — a safe point to repair toward, because it's reachable safely from the PLR and can safely continue toward the destination." },
];

// ---------------------------------------------------------------------------
// SRGB / Node SID / Adjacency SID model — same scheme as
// srMplsFoundations.ts (SRGB_START 16000, per-router index 1..6), kept
// as a local copy rather than a cross-file import because this lesson's
// RouterId/LinkDef are its own types (per-lesson-file convention used
// throughout scenarios/*.ts).
// ---------------------------------------------------------------------------

export const SRGB_START = 16000;
export const NODE_SID_INDEX: Record<RouterId, number> = { R1: 1, R2: 2, R3: 3, R4: 4, R5: 5, R6: 6 };
export function deriveNodeSidLabel(router: RouterId): number {
  return SRGB_START + NODE_SID_INDEX[router];
}
export const R6_NODE_SID = deriveNodeSidLabel("R6"); // 16006

export const ADJ_SID_BASE = 24000;
export interface AdjSid {
  id: string;
  owner: RouterId;
  neighbor: RouterId;
  label: number;
}
export function computeAdjSidLabel(owner: RouterId, neighbor: RouterId): number {
  return ADJ_SID_BASE + NODE_SID_INDEX[owner] * 10 + NODE_SID_INDEX[neighbor];
}
export function buildAllAdjSids(links: LinkDef[]): AdjSid[] {
  const out: AdjSid[] = [];
  for (const l of links) {
    out.push({ id: `adj-${l.a}-${l.b}`, owner: l.a, neighbor: l.b, label: computeAdjSidLabel(l.a, l.b) });
    out.push({ id: `adj-${l.b}-${l.a}`, owner: l.b, neighbor: l.a, label: computeAdjSidLabel(l.b, l.a) });
  }
  return out;
}

export interface SidRow {
  prefix?: string;
  router?: string;
  sidType: "NODE" | "ADJ";
  sidIndex?: number;
  localLabel: number;
  algorithm?: string;
  scope: "GLOBAL" | "LOCAL";
  owner?: string;
  nextHop?: string;
  meaning?: string;
  installed?: boolean;
}
export function buildSidDatabase(links: LinkDef[], observer: RouterId): SidRow[] {
  const nodeRows: SidRow[] = ALL_ROUTERS.map((r) => ({
    prefix: `${r} loopback`,
    router: r,
    sidType: "NODE",
    sidIndex: NODE_SID_INDEX[r],
    localLabel: deriveNodeSidLabel(r),
    algorithm: "SPF",
    scope: "GLOBAL",
    meaning: `Reach ${r} via its own current shortest path.`,
    installed: true,
  }));
  const adjRows: SidRow[] = buildAllAdjSids(links).map((a) => ({
    prefix: `${a.owner}→${a.neighbor} adjacency`,
    router: a.owner,
    sidType: "ADJ",
    localLabel: a.label,
    scope: "LOCAL",
    owner: a.owner,
    nextHop: a.neighbor,
    meaning: `Force the specific ${a.owner}→${a.neighbor} link — only meaningful at ${a.owner}.`,
    installed: a.owner === observer,
  }));
  return [...nodeRows, ...adjRows];
}

// ---------------------------------------------------------------------------
// Generic shortest-path helpers — brute-force over simple paths (the
// topology is tiny; same technique as rsvpFrr.ts's allSimplePaths, with
// an avoidNode parameter for node-protection exclusion).
// ---------------------------------------------------------------------------

function neighborsOf(links: LinkDef[]): Partial<Record<RouterId, { to: RouterId; link: LinkDef }[]>> {
  const adj: Partial<Record<RouterId, { to: RouterId; link: LinkDef }[]>> = {};
  for (const l of links) {
    (adj[l.a] ??= []).push({ to: l.b, link: l });
    (adj[l.b] ??= []).push({ to: l.a, link: l });
  }
  return adj;
}
function allSimplePaths(links: LinkDef[], from: RouterId, to: RouterId, avoidNode?: RouterId): RouterId[][] {
  const adj = neighborsOf(links);
  const results: RouterId[][] = [];
  const visited = new Set<RouterId>([from]);
  const path: RouterId[] = [from];
  function dfs(current: RouterId) {
    if (current === to) {
      results.push([...path]);
      return;
    }
    for (const { to: next } of adj[current] ?? []) {
      if (visited.has(next) || next === avoidNode) continue;
      visited.add(next);
      path.push(next);
      dfs(next);
      path.pop();
      visited.delete(next);
    }
  }
  if (from !== avoidNode && to !== avoidNode) dfs(from);
  return results;
}
export function linkBetween(links: LinkDef[], x: RouterId, y: RouterId): LinkDef | undefined {
  return links.find((l) => (l.a === x && l.b === y) || (l.b === x && l.a === y));
}
function pathCost(path: RouterId[], links: LinkDef[]): number {
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const l = linkBetween(links, path[i], path[i + 1]);
    total += l ? l.metric : Number.POSITIVE_INFINITY;
  }
  return total;
}
export function shortestPath(links: LinkDef[], from: RouterId, to: RouterId, avoidNode?: RouterId): { path: RouterId[]; cost: number } | undefined {
  if (from === to) return { path: [from], cost: 0 };
  const candidates = allSimplePaths(links, from, to, avoidNode).map((path) => ({ path, cost: pathCost(path, links) }));
  candidates.sort((a, b) => a.cost - b.cost);
  return candidates[0];
}
export function linkIdsOnPath(path: RouterId[], links: LinkDef[]): LinkId[] {
  const ids: LinkId[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const l = linkBetween(links, path[i], path[i + 1]);
    if (l) ids.push(l.id);
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Protected resource / P-Space / Q-Space / PQ selection / post-
// convergence path — the heart of TI-LFA. Every function here is pure
// and takes the CURRENT links array, so calling it again after a
// metric/topology change naturally recomputes fresh answers (used both
// for the honest "READY" computation and, later, to reveal a stale one).
// ---------------------------------------------------------------------------

export type ProtectionType = "LINK" | "NODE";

/** A path is safe for a given protected resource if it never traverses that link (LINK) or that node at all (NODE). */
export function isPathSafe(path: RouterId[], links: LinkDef[], protectionType: ProtectionType, protectedResource: string): boolean {
  if (protectionType === "LINK") return !linkIdsOnPath(path, links).includes(protectedResource as LinkId);
  return !path.includes(protectedResource as RouterId);
}

/** PacketVerse teaching simplification: P-Space(PLR) = nodes whose OWN unconstrained shortest path from the PLR never traverses the protected resource. Real TI-LFA also computes "extended" P-Space via each neighbor's own SPF tree — out of scope here, noted in the lesson narrative, not simulated. */
export function computePSpace(links: LinkDef[], plr: RouterId, protectionType: ProtectionType, protectedResource: string): RouterId[] {
  return ALL_ROUTERS.filter((x) => {
    if (x === plr) return false;
    const sp = shortestPath(links, plr, x);
    return !!sp && isPathSafe(sp.path, links, protectionType, protectedResource);
  });
}

/** Q-Space(destination) = nodes whose OWN unconstrained shortest path TO the destination never traverses the protected resource. */
export function computeQSpace(links: LinkDef[], destination: RouterId, protectionType: ProtectionType, protectedResource: string): RouterId[] {
  return ALL_ROUTERS.filter((y) => {
    if (y === destination) return false;
    const sp = shortestPath(links, y, destination);
    return !!sp && isPathSafe(sp.path, links, protectionType, protectedResource);
  });
}

/** PQ candidates: in both spaces, excluding the PLR and the destination themselves (a PQ node is a distinct repair point, not a restatement of either endpoint). */
export function findPqCandidates(pSpace: RouterId[], qSpace: RouterId[], plr: RouterId, destination: RouterId): RouterId[] {
  return pSpace.filter((n) => qSpace.includes(n) && n !== plr && n !== destination);
}

/** Tie-break policy (documented PacketVerse simplification, not an RFC rule): among valid PQ candidates, prefer the one CLOSEST to the destination — it minimizes how much of the post-convergence path still depends on ordinary (unrepaired) forwarding beyond the repair segment. Deterministic tie-break by router id. */
export function selectRepairPoint(pqCandidates: RouterId[], links: LinkDef[], destination: RouterId): RouterId | undefined {
  if (pqCandidates.length === 0) return undefined;
  const ranked = pqCandidates
    .map((c) => ({ c, d: shortestPath(links, c, destination)?.cost ?? Number.POSITIVE_INFINITY }))
    .sort((a, b) => a.d - b.d || a.c.localeCompare(b.c));
  return ranked[0].c;
}

/** The path the packet SHOULD take after failure — real SPF with the protected resource actually removed from the graph, unlike P/Q-Space's unconstrained-comparison technique. This is "the answer"; P/Q-Space is how TI-LFA finds a safe way to reach a point already on it before the PLR itself has reconverged. */
export function computePostConvergencePath(links: LinkDef[], from: RouterId, to: RouterId, protectionType: ProtectionType, protectedResource: string): { path: RouterId[]; cost: number } | undefined {
  const usableLinks = protectionType === "LINK" ? links.filter((l) => l.id !== protectedResource) : links;
  const avoidNode = protectionType === "NODE" ? (protectedResource as RouterId) : undefined;
  return shortestPath(usableLinks, from, to, avoidNode);
}

// ---------------------------------------------------------------------------
// Minimal repair segment-list derivation — same greedy technique as SR
// Policy's deriveSegmentListFromPath (srPolicy.ts): walk the desired
// sub-path, extend a Node SID span as far as the CURRENT unconstrained
// shortest path between two points on that sub-path still matches it
// exactly; fall back to one Adjacency SID only when even the single next
// hop doesn't match. This is what naturally enforces "prefer minimal
// valid repair lists" AND "avoid the protected resource" simultaneously:
// a mismatch between natural forwarding and the desired safe sub-path is
// exactly the situation where natural forwarding would take an unsafe
// shortcut, so forcing that one hop with an Adj-SID is required, never
// merely a size optimization.
// ---------------------------------------------------------------------------
export type RepairSegmentType = "NODE" | "ADJ";
export interface RepairSegmentSpec {
  order: number;
  type: RepairSegmentType;
  target: RouterId;
  adjId?: string;
}
function pathsEqual(a?: RouterId[], b?: RouterId[]): boolean {
  return !!a && !!b && a.length === b.length && a.every((v, i) => v === b[i]);
}
export function deriveMinimalRepairSegments(subPath: RouterId[], links: LinkDef[]): RepairSegmentSpec[] {
  const specs: RepairSegmentSpec[] = [];
  let i = 0;
  let order = 0;
  while (i < subPath.length - 1) {
    let bestJ: number | undefined;
    for (let j = i + 1; j < subPath.length; j++) {
      const natural = shortestPath(links, subPath[i], subPath[j]);
      if (natural && pathsEqual(natural.path, subPath.slice(i, j + 1))) bestJ = j;
    }
    if (bestJ !== undefined) {
      specs.push({ order: order++, type: "NODE", target: subPath[bestJ] });
      i = bestJ;
    } else {
      specs.push({ order: order++, type: "ADJ", target: subPath[i + 1], adjId: `adj-${subPath[i]}-${subPath[i + 1]}` });
      i += 1;
    }
  }
  return specs;
}

/** Full TI-LFA computation for one protected resource — the pipeline in item 17 of the brief, expressed as one pure function: normal topology → post-convergence SPF → P/Q-Space → PQ candidate → repair point → minimal repair segment list. */
export interface TiLfaComputation {
  protectionType: ProtectionType;
  protectedResource: string;
  plr: RouterId;
  destination: RouterId;
  postConvergencePath?: RouterId[];
  postConvergenceCost?: number;
  pSpace: RouterId[];
  qSpace: RouterId[];
  pqCandidates: RouterId[];
  repairPoint?: RouterId;
  repairSegments: RepairSegmentSpec[];
}
export function computeTiLfa(links: LinkDef[], plr: RouterId, destination: RouterId, protectionType: ProtectionType, protectedResource: string): TiLfaComputation {
  const post = computePostConvergencePath(links, plr, destination, protectionType, protectedResource);
  const pSpace = computePSpace(links, plr, protectionType, protectedResource);
  const qSpace = computeQSpace(links, destination, protectionType, protectedResource);
  const pqCandidates = findPqCandidates(pSpace, qSpace, plr, destination);
  const repairPoint = selectRepairPoint(pqCandidates, links, destination);
  const subPath = repairPoint && post ? post.path.slice(0, post.path.indexOf(repairPoint) + 1) : undefined;
  const repairSegments = subPath && subPath.length > 1 ? deriveMinimalRepairSegments(subPath, links) : [];
  return { protectionType, protectedResource, plr, destination, postConvergencePath: post?.path, postConvergenceCost: post?.cost, pSpace, qSpace, pqCandidates, repairPoint, repairSegments };
}

/** Validates an ALREADY-COMPUTED repair list against the CURRENT links — this is what reveals staleness after a topology/metric change the repair was never recomputed against. Walks the segment chain from the PLR; each NODE segment's target must still be reached, from wherever the chain currently is, via a current shortest path that avoids the protected resource. */
export function validateRepairList(comp: Pick<TiLfaComputation, "plr" | "protectionType" | "protectedResource" | "repairSegments">, links: LinkDef[]): { valid: boolean; reason: string } {
  if (comp.repairSegments.length === 0) return { valid: false, reason: "No repair segments computed." };
  let from = comp.plr;
  for (const seg of comp.repairSegments) {
    if (seg.type === "NODE") {
      const natural = shortestPath(links, from, seg.target);
      if (!natural) return { valid: false, reason: `${from} currently has no path to ${seg.target}.` };
      if (!isPathSafe(natural.path, links, comp.protectionType, comp.protectedResource)) {
        return { valid: false, reason: `${from}'s CURRENT shortest path to ${seg.target} now traverses the protected resource (${comp.protectedResource}) — the repair list is stale.` };
      }
      from = seg.target;
    } else {
      const link = linkBetween(links, from, seg.target);
      if (!link) return { valid: false, reason: `The forced adjacency ${from}→${seg.target} no longer exists.` };
      from = seg.target;
    }
  }
  return { valid: true, reason: "Repair list is current and avoids the protected resource end to end." };
}

/** READY requires: a repair point was actually found, AND the resulting repair list validates against the CURRENT links. Mirrors rsvpFrr.ts's determineProtectionReadiness in spirit — same three-state shape, SR-flavored. */
export function determineProtectionReadiness(comp: TiLfaComputation | undefined, links: LinkDef[]): "READY" | "UNAVAILABLE" | "NOT_CONFIGURED" {
  if (!comp || !comp.repairPoint || comp.repairSegments.length === 0) return "NOT_CONFIGURED";
  return validateRepairList(comp, links).valid ? "READY" : "UNAVAILABLE";
}

// ---------------------------------------------------------------------------
// Advanced illustration only (item 35/36 of the brief) — a small,
// separate link set used ONLY to show that a Node SID alone cannot
// always reproduce a safe repair path. Never touches the main lesson's
// live state; computed through the exact same deriveMinimalRepairSegments
// used everywhere else, proving the algorithm (not a hand-authored
// special case) is what produces the Adj-SID fallback.
//
// Only difference from BASE_LINKS: a cheap detour through the protected
// node R4 exists from R3 (R3-R4=8, R4-R5=2, so R3→R4→R5=10) — cheap
// enough that R3's own shortest path to R5 prefers it over the direct
// R3-R5=15 link, but NOT cheap enough to also contaminate R2's own
// shortest path to R3 (R2-R4-R3 = 10+8 = 18 > the direct R2-R3 = 15),
// so segment 1 (R2→R3) stays a safe Node SID while segment 2 (R3→R5)
// is forced to an explicit Adjacency SID.
// ---------------------------------------------------------------------------
export const ADV_MULTI_SID_LINKS: LinkDef[] = [
  { id: "R1-R2", a: "R1", b: "R2", metric: 10 },
  { id: "R2-R4", a: "R2", b: "R4", metric: 10 },
  { id: "R4-R6", a: "R4", b: "R6", metric: 10 },
  { id: "R2-R3", a: "R2", b: "R3", metric: 15 },
  { id: "R3-R5", a: "R3", b: "R5", metric: 15 },
  { id: "R5-R6", a: "R5", b: "R6", metric: 15 },
  { id: "R3-R4", a: "R3", b: "R4", metric: 8 },
  { id: "R4-R5", a: "R4", b: "R5", metric: 2 },
];

// ---------------------------------------------------------------------------
// MPLS label stack model — plain numeric labels (matching srPolicy.ts's
// convention; no implicit-null/PHP modeling in this lesson — not the
// teaching point here). "repair" vs "segment" purpose is what lets the
// packet-stack renderer visually distinguish a TI-LFA repair label from
// the original SR instruction underneath it.
// ---------------------------------------------------------------------------
export interface MplsLabel {
  value: number;
  bottomOfStack: boolean;
  purpose: "segment" | "repair";
}
export interface MplsPacketState {
  srcIp: string;
  dstIp: string;
  labels: MplsLabel[];
}
/** RFC 3032: existing labels keep their S bits; only a label pushed onto an empty stack is the bottom (S=1). */
function pushLabel(pkt: MplsPacketState, value: number, purpose: "segment" | "repair"): MplsPacketState {
  return { ...pkt, labels: [{ value, bottomOfStack: pkt.labels.length === 0, purpose }, ...pkt.labels] };
}
/** Removes only the top label — the remaining labels' S bits are already correct and are never rewritten. */
function popTopLabel(pkt: MplsPacketState): MplsPacketState {
  const [, ...rest] = pkt.labels;
  return { ...pkt, labels: rest };
}

// ---------------------------------------------------------------------------
// PacketVerse TI-LFA Recovery Lifecycle — a teaching abstraction, not an
// official protocol FSM (mirrors rsvpFrr.ts's FrrLifecycle exactly in
// spirit, renamed/reshaped for SR repair instead of an RSVP bypass).
// ---------------------------------------------------------------------------
export type TiLfaLifecycle = "UNPROTECTED" | "COMPUTING" | "READY" | "FAILURE_DETECTED" | "LOCAL_REPAIR_ACTIVE" | "CONVERGING" | "CONVERGED";
export const TI_LFA_LIFECYCLE_ORDER: TiLfaLifecycle[] = ["UNPROTECTED", "COMPUTING", "READY", "FAILURE_DETECTED", "LOCAL_REPAIR_ACTIVE", "CONVERGING", "CONVERGED"];
export const TI_LFA_LIFECYCLE_INFO: Record<TiLfaLifecycle, { meaning: string; why: string; next: string }> = {
  UNPROTECTED: { meaning: "No repair has been computed for this resource yet.", why: "TI-LFA protection has to be explicitly computed from the current topology — it isn't automatic just because SR is enabled.", next: "Computing P-Space, Q-Space, and a PQ candidate begins protection." },
  COMPUTING: { meaning: "P-Space, Q-Space, and a minimal repair segment list are being derived from the current topology.", why: "This all happens BEFORE any failure — TI-LFA repair is precomputed, never derived reactively at failure time.", next: "Once a valid repair segment list is derived and validated, protection becomes READY." },
  READY: { meaning: "A repair segment list is precomputed and installed, but is NOT currently carrying any traffic.", why: "READY means the safety net exists — it says nothing about whether it's in use. Normal traffic keeps using the primary path.", next: "It stays this way until (and unless) the protected resource actually fails." },
  FAILURE_DETECTED: { meaning: "The PLR has locally detected that the protected resource is gone.", why: "Detection happens locally, at the PLR, immediately — not at the headend, and not by waiting for IGP flooding.", next: "The PLR immediately pushes the precomputed repair segment(s)." },
  LOCAL_REPAIR_ACTIVE: { meaning: "Protected traffic is now forwarding with the repair segment(s) pushed on top of the original SR instruction.", why: "The repair was precomputed specifically so this step requires no new computation or signaling round-trip.", next: "Traffic stays here until IGP convergence completes globally." },
  CONVERGING: { meaning: "IGP has flooded the failure and routers are recomputing SPF — a separate, global process.", why: "Local repair and global convergence are two different mechanisms running on two different timelines.", next: "Once SPF converges, ordinary forwarding itself uses the new safe path." },
  CONVERGED: { meaning: "Ordinary post-convergence SR forwarding now reaches the destination without needing the repair segment.", why: "Local repair did its job (no interruption) and has handed off to normal, globally-converged forwarding.", next: "This is the new steady state, until the next failure." },
};

// ---------------------------------------------------------------------------
// Top-level scenario state
// ---------------------------------------------------------------------------

export interface JourneyHop {
  router: RouterId;
  input: string;
  lookup: string;
  action: string;
  output: string;
}

export interface TroubleshootingState {
  started: boolean;
  metricChanged: boolean;
  repairAttempt?: { choice: string; correct: boolean };
  recomputed: boolean;
  verified: boolean;
}

export interface SrTiLfaState {
  links: LinkDef[];
  topologyVersion: number;
  failedLinkIds: LinkId[];
  failedNode?: RouterId;
  tiLfaEnabled: boolean;
  linkProtection?: TiLfaComputation;
  linkProtectionLifecycle: TiLfaLifecycle;
  nodeProtection?: TiLfaComputation;
  nodeProtectionLifecycle: TiLfaLifecycle;
  activeProtectionType?: ProtectionType;
  packet?: MplsPacketState;
  packetAt?: RouterId;
  packetDropped?: boolean;
  journey: JourneyHop[];
  globalConverged: boolean;
  reoptimized?: { path: RouterId[]; cost: number };
  advMultiSidSegments?: RepairSegmentSpec[];
  troubleshooting: TroubleshootingState;
}

export function createSrTiLfaState(): SrTiLfaState {
  return {
    links: BASE_LINKS,
    topologyVersion: 0,
    failedLinkIds: [],
    tiLfaEnabled: false,
    linkProtectionLifecycle: "UNPROTECTED",
    nodeProtectionLifecycle: "UNPROTECTED",
    journey: [],
    globalConverged: true,
    troubleshooting: { started: false, metricChanged: false, recomputed: false, verified: false },
  };
}

// ---------------------------------------------------------------------------
// Graph layout
// ---------------------------------------------------------------------------
export const GRAPH_NODES = [
  { id: "R1", label: "R1", x: 5, y: 50, subLabel: "Headend" },
  { id: "R2", label: "R2", x: 30, y: 50, subLabel: "PLR" },
  { id: "R4", label: "R4", x: 58, y: 20 },
  { id: "R3", label: "R3", x: 58, y: 80 },
  { id: "R5", label: "R5", x: 80, y: 80 },
  { id: "R6", label: "R6", x: 96, y: 50, subLabel: "Destination" },
];
export const GRAPH_EDGES: { id: LinkId; a: RouterId; b: RouterId }[] = BASE_LINKS.map((l) => ({ id: l.id, a: l.a, b: l.b }));

// ---------------------------------------------------------------------------
// Packet builders
// ---------------------------------------------------------------------------
function ipLayer(src: string, dst: string): PacketLayer {
  return { name: "IPv4", color: "var(--pv-proto-ip)", fields: [{ label: "Source IP", value: src }, { label: "Destination IP", value: dst }] };
}
function shimLayer(label: MplsLabel): PacketLayer {
  return {
    name: `MPLS Shim (${label.purpose === "repair" ? "TI-LFA repair" : "SR segment"})`,
    color: label.purpose === "repair" ? "var(--pv-proto-mpls-alt, var(--pv-proto-mpls))" : "var(--pv-proto-mpls)",
    fields: [
      { label: "Label", value: String(label.value) },
      { label: "S (Bottom of Stack)", value: label.bottomOfStack ? "1" : "0" },
    ],
  };
}
export function buildPacketLayers(pkt: MplsPacketState): PacketLayer[] {
  return [...pkt.labels.map(shimLayer), ipLayer(pkt.srcIp, pkt.dstIp)];
}
function mplsPacket(id: string, from: RouterId, to: RouterId, summary: string, badge: string, pkt: MplsPacketState): PacketVisual {
  return { id, protocol: "MPLS", from, to, summary, badge, layers: buildPacketLayers(pkt) };
}
const HOST_BEHIND_R1 = "10.1.1.10";
const HOST_BEHIND_R6 = "10.6.6.20";

// ---------------------------------------------------------------------------
// Scenario steps
// ---------------------------------------------------------------------------

export const srTiLfaSteps: ScenarioStep<SrTiLfaState>[] = [
  {
    id: "intro",
    label: "The Central Question",
    narrative: "How can an SR router repair traffic locally after a failure — without waiting for the headend, and without pre-signaling an RSVP bypass tunnel? You already know SR-MPLS Foundations (Node SID, Adj-SID, SRGB), SR Policy (candidate paths, preference, fallback), and RSVP-TE Fast Reroute (PLR, Merge Point, local repair via a pre-signaled bypass). This lesson asks what local repair looks like when it's expressed with SR instructions instead.",
  },
  {
    id: "recap-known",
    label: "Recap: What You Already Know",
    narrative: "SR-MPLS: a Node SID means \"reach this router via its own current shortest path\"; an Adjacency SID means \"use this one specific link, only at the router that owns it.\" SR Policy: candidate paths, preference, and headend-side fallback — a different mechanism from what this lesson builds. RSVP-TE FRR: a PLR activates a pre-signaled bypass the instant it detects a protected resource is gone, without waiting for the headend.",
  },
  {
    id: "rsvp-frr-recap",
    label: "RSVP FRR, Recapped",
    narrative: "RSVP-TE FRR's shape: failure → PLR → pre-signaled RSVP bypass LSP → Merge Point. The bypass is a real, small RSVP-TE LSP of its own — signaled, labeled, and reserved before any failure, ready the instant the PLR needs it.",
  },
  {
    id: "ti-lfa-preview",
    label: "TI-LFA's Shape",
    narrative: "TI-LFA's shape: failure → local repair point → precomputed SR repair segment list → post-convergence path. Same idea — protection exists before the failure, and the PLR reacts locally — but nothing is signaled ahead of time. The repair is computed from topology and encoded as a short list of SR instructions.",
  },
  {
    id: "protection-object-distinction",
    label: "What's Actually Being Protected",
    narrative: "RSVP FRR: protection is expressed as RSVP LSP/bypass state — a real tunnel, signaled hop by hop. TI-LFA: protection is expressed as Segment Routing instructions — a label stack the PLR computes locally, nothing signaled. Neither is universally superior — they solve the same local-repair problem with different machinery, and both exist to avoid waiting for the headend/global convergence.",
  },
  {
    id: "name-explain",
    label: "TI-LFA: The Name",
    narrative: "TI-LFA = Topology Independent Loop-Free Alternate. \"Topology Independent\" does NOT mean TI-LFA ignores the topology — the repair is computed FROM the topology, same as everything else in SR. It means the repair isn't limited to \"pick one adjacent backup next hop\" (classic LFA) — it can be encoded as a short list of SR instructions that reaches a safe point regardless of how the local topology happens to be shaped.",
  },
  {
    id: "name-caution",
    label: "What TI-LFA Does NOT Claim",
    narrative: "Two claims this lesson will not make: TI-LFA cannot survive absolutely every possible failure — if no surviving alternate physical path exists, no local-repair technology can manufacture connectivity that isn't there. And this lesson makes no universal recovery-time or zero-packet-loss guarantee — those depend on real hardware and real deployments, not a teaching simulation.",
  },
  {
    id: "topology-intro",
    label: "Topology",
    narrative: "R1 is the SR headend. R6 is the destination. Two paths exist from R2 to R6: a top path via R4 (R2-R4=10, R4-R6=10) and a bottom path via R3 and R5 (R2-R3=15, R3-R5=15, R5-R6=15). With these metrics, the IGP shortest path R1→R6 is R1→R2→R4→R6.",
  },
  {
    id: "predict-shortest-path",
    label: "Predict",
    narrative: "Before moving on:",
    question: {
      prompt: "Given R1-R2=10, R2-R4=10, R4-R6=10, R2-R3=15, R3-R5=15, R5-R6=15 — what is the current IGP shortest path from R1 to R6?",
      options: [
        { id: "top", label: "R1 → R2 → R4 → R6 (cost 30)" },
        { id: "bottom", label: "R1 → R2 → R3 → R5 → R6 (cost 55)" },
        { id: "equal", label: "Both paths are equal-cost" },
        { id: "depends", label: "It depends on which router computes it" },
      ],
      correctOptionId: "top",
      explanation: "R1→R2→R4→R6 costs 10+10+10=30. R1→R2→R3→R5→R6 costs 10+15+15+15=55. The top path via R4 is the clear IGP shortest path — this is the PRIMARY path this whole lesson protects.",
    },
  },
  {
    id: "node-sid-recap",
    label: "R6's Node SID",
    narrative: `R6's Node SID is ${R6_NODE_SID} (SRGB 16000 + index ${NODE_SID_INDEX.R6}) — exactly the model from SR-MPLS Foundations. R1 imposes [${R6_NODE_SID}][IP] once; every router along the way forwards toward whichever Node SID is active, using its OWN current shortest path — nothing end-to-end is signaled.`,
    run: (state) => ({ state, events: [{ type: "MPLS_LABEL_INSTALLED", stepId: "node-sid-recap", timestamp: Date.now(), message: `R6 Node SID installed network-wide: ${R6_NODE_SID}` }] }),
  },
  {
    id: "send-normal-1",
    label: "Send Traffic (Baseline)",
    narrative: `A host behind R1 (${HOST_BEHIND_R1}) sends traffic toward a host behind R6 (${HOST_BEHIND_R6}).`,
    packet: () => ({ id: "ip-normal", protocol: "IP", from: "R1", to: "R1", summary: `Classified toward R6 Node SID ${R6_NODE_SID}`, layers: [ipLayer(HOST_BEHIND_R1, HOST_BEHIND_R6)] }),
    run: (state) => ({ state: { ...state, packet: { srcIp: HOST_BEHIND_R1, dstIp: HOST_BEHIND_R6, labels: [] }, packetAt: "R1", journey: [], packetDropped: false }, events: [{ type: "PACKET_SENT", stepId: "send-normal-1", timestamp: Date.now(), message: "Packet classified toward R6" }] }),
  },
  {
    id: "r1-push-normal",
    label: "R1: PUSH",
    narrative: "R1 imposes the R6 Node SID and forwards toward its own shortest-path next hop, R2.",
    packet: (state) => (state.packet ? mplsPacket("push1", "R1", "R2", "PUSH", "PUSH", state.packet) : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const packet = pushLabel(state.packet, R6_NODE_SID, "segment");
      const journey = [...state.journey, { router: "R1" as RouterId, input: "IP packet (unlabeled)", lookup: "Impose R6 Node SID", action: "PUSH", output: `label ${R6_NODE_SID} + IP` }];
      return { state: { ...state, packet, packetAt: "R2", journey }, events: [{ type: "MPLS_LABEL_PUSHED", stepId: "r1-push-normal", timestamp: Date.now(), message: "R1 pushes R6 Node SID" }] };
    },
  },
  {
    id: "r2-swap-normal",
    label: "R2: Forward (Normal)",
    narrative: "R2's own current shortest path to R6 is via R4 — ordinary Node-SID forwarding, nothing FRR/TI-LFA-related yet.",
    packet: (state) => (state.packet ? mplsPacket("swap1", "R2", "R4", "FORWARD", "FORWARD", state.packet) : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const journey = [...state.journey, { router: "R2" as RouterId, input: `label ${R6_NODE_SID}`, lookup: "Active SID lookup → own shortest path to R6 (via R4)", action: "FORWARD", output: `label ${R6_NODE_SID}` }];
      return { state: { ...state, packetAt: "R4", journey }, events: [] };
    },
  },
  {
    id: "r4-swap-normal",
    label: "R4: Forward (Normal)",
    narrative: "R4 forwards toward R6 — the final hop.",
    packet: (state) => (state.packet ? mplsPacket("swap2", "R4", "R6", "FORWARD", "FORWARD", state.packet) : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const journey = [...state.journey, { router: "R4" as RouterId, input: `label ${R6_NODE_SID}`, lookup: "Active SID lookup → own shortest path to R6 (direct)", action: "FORWARD", output: `label ${R6_NODE_SID}` }];
      return { state: { ...state, packetAt: "R6", journey }, events: [] };
    },
  },
  {
    id: "r6-deliver-normal",
    label: "R6 Delivers",
    narrative: "R6 is the segment's target — pops the label and delivers. Ordinary, healthy SR-MPLS forwarding: R1 → R2 → R4 → R6.",
    packet: (state) => (state.packet ? { id: "ip-delivered1", protocol: "IP", from: "R6", to: "R6", summary: "Delivered", layers: buildPacketLayers(state.packet) } : undefined),
    run: (state) => ({ state: { ...state, packet: popTopLabel(state.packet ?? { srcIp: "", dstIp: "", labels: [] }), journey: [...state.journey, { router: "R6" as RouterId, input: `label ${R6_NODE_SID}`, lookup: "Self is segment target", action: "DELIVER", output: "Delivered" }] }, events: [{ type: "MPLS_PACKET_FORWARDED", stepId: "r6-deliver-normal", timestamp: Date.now(), message: "R6 delivers — nothing protected yet" }] }),
    whatChanged: () => ["Delivered R1 → R2 → R4 → R6 — ordinary SR-MPLS forwarding, no protection involved yet"],
  },
  {
    id: "protected-resource-intro",
    label: "Protected Resource: R2-R4",
    narrative: "First protected resource: the R2-R4 link. R2 is the router immediately upstream of it — the PLR / local repair point. R1 does not need to react before R2 does; R1 is the headend, not the repair point.",
    run: (state) => ({ state: { ...state, tiLfaEnabled: false }, events: [] }),
  },
  {
    id: "predict-plr",
    label: "Predict",
    narrative: "For protecting the R2-R4 link specifically:",
    question: {
      prompt: "Who should activate local repair for a failure on R2-R4?",
      options: [
        { id: "r2-plr", label: "R2 — the PLR / local repair point" },
        { id: "r1-headend", label: "R1 — the headend" },
        { id: "r6-dest", label: "R6 — the destination" },
        { id: "every-router", label: "Every router simultaneously" },
      ],
      correctOptionId: "r2-plr",
      explanation: "R2 is directly attached to the protected link and detects its failure first. Local repair means R2 acts immediately — it doesn't wait for R1, and R1 isn't required to react first.",
    },
  },
  {
    id: "no-tilfa-intro",
    label: "First, Without TI-LFA",
    narrative: "Before building protection, watch what happens to a failure with nothing precomputed — TI-LFA is off.",
  },
  {
    id: "fail-no-protection",
    label: "R2-R4 DOWN (No Protection)",
    narrative: "The R2-R4 link fails, with no repair precomputed anywhere.",
    run: (state) => ({ state: { ...state, failedLinkIds: ["R2-R4"] }, events: [{ type: "MPLS_LSP_CHANGED", stepId: "fail-no-protection", timestamp: Date.now(), message: "R2-R4 down — no protection exists" }] }),
    whatChanged: () => ["R2-R4: UP → DOWN"],
  },
  {
    id: "no-backup-interruption",
    label: "R2: No Local Backup",
    narrative: "R2's primary next hop toward R6 (R4) is gone, and R2 has nothing precomputed to substitute. Traffic in flight is simply interrupted — R2 has no repair segment list to push.",
    whatChanged: () => ["R2: primary next-hop unavailable → no local repair installed → traffic interruption"],
  },
  {
    id: "normal-recovery-concept",
    label: "Ordinary End-to-End Recovery",
    narrative: "Without local protection: the failure floods via IGP → every router eventually recomputes SPF → R2's own forwarding for the R6 Node SID eventually shifts to the bottom path. This is real recovery, but it isn't instantaneous — PacketVerse makes no universal convergence-time claim. This whole wait is exactly what local repair exists to avoid.",
  },
  {
    id: "restore-for-tilfa",
    label: "Reset: Build Protection First",
    narrative: "R2-R4 is restored. For the rest of this lesson, TI-LFA protection will be precomputed BEFORE any failure — that's the whole point.",
    run: (state) => ({ state: { ...state, failedLinkIds: [], tiLfaEnabled: true }, events: [] }),
  },
  {
    id: "post-convergence-intro",
    label: "The Post-Convergence Path",
    narrative: "Fundamental concept: the post-convergence path is what SPF would compute AFTER the network fully reconverges around the failure — R2's shortest path to R6 with R2-R4 removed. TI-LFA's whole job is to get the packet onto this safe path immediately, before that reconvergence actually happens.",
  },
  {
    id: "post-convergence-compute",
    label: "Computed: Pre- vs. Post-Failure SPF",
    narrative: "Computed from the domain layer, not hardcoded in the page.",
    run: (state) => {
      const post = computePostConvergencePath(state.links, "R2", "R6", "LINK", "R2-R4");
      return { state, events: [{ type: "OSPF_SPF_COMPLETED", stepId: "post-convergence-compute", timestamp: Date.now(), message: `Post-convergence R2→R6: ${post?.path.join(" → ")}` }] };
    },
  },
  {
    id: "p-space-intro",
    label: "P-Space",
    narrative: "P-Space: the nodes the PLR (R2) can reach via its own shortest path WITHOUT that path traversing the protected resource. It is derived from real shortest-path comparisons — never just \"every node physically connected to R2.\"",
  },
  {
    id: "p-space-compute",
    label: "Computed: P-Space From R2",
    narrative: "Highlighted below — a distinct region, derived, not hand-picked.",
    run: (state) => {
      const pSpace = computePSpace(state.links, "R2", "LINK", "R2-R4");
      return { state, events: [{ type: "OSPF_SPF_COMPLETED", stepId: "p-space-compute", timestamp: Date.now(), message: `P-Space(R2): ${pSpace.join(", ") || "(empty)"}` }] };
    },
  },
  {
    id: "q-space-intro",
    label: "Q-Space",
    narrative: "Q-Space: the nodes that can reach the destination (R6) via THEIR OWN shortest path without traversing the protected resource. Safe from the destination side, exactly mirroring P-Space's safety from the PLR side.",
  },
  {
    id: "q-space-compute",
    label: "Computed: Q-Space To R6",
    narrative: "Highlighted separately below.",
    run: (state) => {
      const qSpace = computeQSpace(state.links, "R6", "LINK", "R2-R4");
      return { state, events: [{ type: "OSPF_SPF_COMPLETED", stepId: "q-space-compute", timestamp: Date.now(), message: `Q-Space(R6): ${qSpace.join(", ") || "(empty)"}` }] };
    },
  },
  {
    id: "pq-intersection",
    label: "P-Space ∩ Q-Space",
    narrative: "The intersection of P-Space and Q-Space is the set of candidate repair points — a PQ node is safe to reach from the PLR AND safe to continue from toward the destination.",
  },
  {
    id: "pq-select",
    label: "Selecting The Repair Point",
    narrative: "Among the PQ candidates, PacketVerse selects the one closest to the destination — it minimizes how much of the trip after the repair segment still depends on ordinary forwarding. The domain layer derives this; it is not chosen by the UI.",
    run: (state) => {
      const comp = computeTiLfa(state.links, "R2", "R6", "LINK", "R2-R4");
      return { state: { ...state, linkProtection: comp }, events: [{ type: "OSPF_SPF_COMPLETED", stepId: "pq-select", timestamp: Date.now(), message: `PQ candidates: ${comp.pqCandidates.join(", ")} — selected ${comp.repairPoint}` }] };
    },
    whatChanged: (_, next) => [`PQ candidates: ${next.linkProtection?.pqCandidates.join(", ")}`, `Repair point selected: ${next.linkProtection?.repairPoint}`],
  },
  {
    id: "classic-lfa-note",
    label: "Why Not Just A Backup Next Hop?",
    narrative: "Classic LFA asks a simpler question: does a directly usable, loop-free ALTERNATE NEXT HOP exist? Sometimes yes — but sometimes reaching the safe post-convergence path takes more than one adjacent next hop can express. This lesson doesn't build a separate classic-LFA simulation — just the concept, for contrast.",
  },
  {
    id: "remote-lfa-note",
    label: "Advanced Note: Remote LFA",
    narrative: "Advanced note only, not simulated: Remote LFA tunnels traffic (via targeted LDP) to a remote repair point when no adjacent LFA exists. TI-LFA instead uses SR instructions to follow the actual post-convergence path — no separate tunnel/targeted-session machinery needed.",
  },
  {
    id: "repair-list-intro",
    label: "Deriving The Repair Segment List",
    narrative: "Segment Routing lets the repair be expressed as instructions instead of a single next-hop choice. The repair segment list is computed — the same minimal-segment technique from SR Policy: extend a Node SID as far as it safely matches the desired path, fall back to an Adjacency SID only when it doesn't.",
  },
  {
    id: "repair-list-compute",
    label: "Computed Repair List",
    narrative: "For R2 → R5 (the selected repair point), R2's own current shortest path to R5 is R2→R3→R5 — which already matches the whole sub-path in one span. One Node SID suffices.",
    run: (state) => {
      if (!state.linkProtection) return { state, events: [] };
      return { state, events: [{ type: "MPLS_LABEL_INSTALLED", stepId: "repair-list-compute", timestamp: Date.now(), message: `Repair segments: ${state.linkProtection.repairSegments.map((s) => s.type).join(", ")}` }] };
    },
  },
  {
    id: "precompute-pipeline",
    label: "The Full Precomputation Pipeline",
    narrative: "Normal IGP topology → protected-resource analysis → post-convergence SPF → P/Q-Space computation → repair point selection → repair segment list → backup forwarding installed. Every stage happens BEFORE any failure.",
  },
  {
    id: "protection-ready",
    label: "Protection READY",
    narrative: "Primary: ACTIVE. TI-LFA repair (R2-R4): READY. Repair traffic: NONE. Repair segment list: [R5 Node SID] on top of [R6 Node SID].",
    run: (state) => ({ state: { ...state, linkProtectionLifecycle: "READY" }, events: [{ type: "MPLS_LABEL_INSTALLED", stepId: "protection-ready", timestamp: Date.now(), message: "TI-LFA link protection READY" }] }),
  },
  {
    id: "predict-ready-means-active",
    label: "Predict",
    narrative: "Before sending traffic again:",
    question: {
      prompt: "Before any failure, does READY TI-LFA protection mean user traffic is already traversing the repair path?",
      options: [
        { id: "no", label: "No — traffic still uses the primary path; READY only means the repair is precomputed and installed" },
        { id: "yes", label: "Yes — READY means the repair is already carrying traffic" },
        { id: "half", label: "Half the traffic uses each path" },
        { id: "depends", label: "It depends on the SR Policy color" },
      ],
      correctOptionId: "no",
      explanation: "READY is readiness, not activity. Repair labels must not appear on normal traffic before a failure — exactly like a READY RSVP bypass carries nothing until activated.",
    },
  },
  {
    id: "failure-detection-note",
    label: "Failure Detection ≠ Repair",
    narrative: "This lesson uses deterministic local link/interface-down detection at R2 — the same style as RSVP-TE FRR. (BFD can provide faster detection in real deployments; that's a note, not something simulated here.) Detection and repair computation are separate concerns — the computation already happened, long before this failure.",
  },
  {
    id: "send-normal-2",
    label: "Send Traffic (Protection READY, Still Normal)",
    narrative: "Send traffic again. Even with the repair fully READY, primary traffic still flows over the ordinary primary path.",
    packet: () => ({ id: "ip-normal2", protocol: "IP", from: "R1", to: "R1", summary: `Classified toward R6 Node SID ${R6_NODE_SID}`, layers: [ipLayer(HOST_BEHIND_R1, HOST_BEHIND_R6)] }),
    run: (state) => ({ state: { ...state, packet: { srcIp: HOST_BEHIND_R1, dstIp: HOST_BEHIND_R6, labels: [] }, packetAt: "R1", journey: [], packetDropped: false }, events: [{ type: "PACKET_SENT", stepId: "send-normal-2", timestamp: Date.now(), message: "Packet classified toward R6" }] }),
  },
  {
    id: "r1-push-normal-2",
    label: "R1 → R2 (Normal, Protected)",
    narrative: "R1 pushes exactly as before — R1 has no idea a repair even exists. Adding protection changed nothing about R1's own forwarding.",
    packet: (state) => (state.packet ? mplsPacket("push2", "R1", "R2", "PUSH", "PUSH", state.packet) : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const packet = pushLabel(state.packet, R6_NODE_SID, "segment");
      const journey = [...state.journey, { router: "R1" as RouterId, input: "IP", lookup: "Impose R6 Node SID", action: "PUSH", output: `label ${R6_NODE_SID}` }];
      return { state: { ...state, packet, packetAt: "R2", journey }, events: [] };
    },
  },
  {
    id: "r2-forward-normal-2",
    label: "R2 → R4 (Normal, Protected)",
    narrative: "R2 forwards over the still-healthy primary link — R2-R4 hasn't failed yet, so the repair stays on standby, carrying nothing.",
    packet: (state) => (state.packet ? mplsPacket("fwd2b", "R2", "R4", "FORWARD", "FORWARD", state.packet) : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const journey = [...state.journey, { router: "R2" as RouterId, input: `label ${R6_NODE_SID}`, lookup: "Active SID lookup → own shortest path to R6 (via R4)", action: "FORWARD", output: `label ${R6_NODE_SID}` }];
      return { state: { ...state, packetAt: "R4", journey }, events: [] };
    },
    whatChanged: () => ["Traffic still uses the primary path — a READY repair never preempts healthy primary forwarding"],
  },
  {
    id: "trigger-failure",
    label: "R2-R4 LINK DOWN",
    narrative: "Now the R2-R4 link fails — for real this time, with protection already precomputed.",
    run: (state) => ({ state: { ...state, failedLinkIds: ["R2-R4"], linkProtectionLifecycle: "FAILURE_DETECTED" }, events: [{ type: "MPLS_LSP_CHANGED", stepId: "trigger-failure", timestamp: Date.now(), message: "R2-R4 down" }] }),
    whatChanged: () => ["R2-R4: UP → DOWN", "TI-LFA lifecycle: READY → FAILURE_DETECTED"],
  },
  {
    id: "r2-detects-failure",
    label: "R2 Detects Locally",
    narrative: "R2 detects the protected resource is gone via local interface-down detection — immediately, without waiting for IGP flooding or any signal from R1.",
  },
  {
    id: "repair-activate",
    label: "Local Repair Activates",
    narrative: "R2 immediately pushes the precomputed repair segment(s). No new computation happens here — the repair list was already derived, long before this moment. R1 does not recompute anything first.",
    run: (state) => ({ state: { ...state, linkProtectionLifecycle: "LOCAL_REPAIR_ACTIVE", activeProtectionType: "LINK" }, events: [{ type: "MPLS_LABEL_INSTALLED", stepId: "repair-activate", timestamp: Date.now(), message: "TI-LFA local repair ACTIVE" }] }),
  },
  {
    id: "repair-label-stack",
    label: "R2: Pushes The Repair Segment",
    narrative: "Before: [R6 Node SID][IP]. After local repair: [R5 Node SID ← repair][R6 Node SID ← original][IP]. The original SR instruction survives underneath the repair segment.",
    packet: (state) => (state.packet ? mplsPacket("repair-push", "R2", "R3", "PUSH REPAIR", "REPAIR", state.packet) : undefined),
    run: (state) => {
      const base = state.packet ?? { srcIp: HOST_BEHIND_R1, dstIp: HOST_BEHIND_R6, labels: [{ value: R6_NODE_SID, bottomOfStack: true, purpose: "segment" as const }] };
      const repairTarget = state.linkProtection?.repairPoint;
      const repairLabel = repairTarget ? deriveNodeSidLabel(repairTarget) : R6_NODE_SID;
      const packet = pushLabel(base, repairLabel, "repair");
      const journey = [...state.journey, { router: "R2" as RouterId, input: `label ${R6_NODE_SID}`, lookup: "Protected next-hop DOWN → TI-LFA backup lookup → repair segment list", action: "PUSH_REPAIR", output: `label ${repairLabel} (repair) + label ${R6_NODE_SID} (original)` }];
      return { state: { ...state, packet, packetAt: state.linkProtection?.repairSegments[0]?.type === "ADJ" ? state.linkProtection.repairSegments[0].target : "R3", journey }, events: [{ type: "MPLS_LABEL_PUSHED", stepId: "repair-label-stack", timestamp: Date.now(), message: "R2 pushes TI-LFA repair segment" }] };
    },
  },
  {
    id: "r2-xray-pipeline",
    label: "R2 X-Ray: Conceptual Local Repair Pipeline",
    narrative: "Conceptual TI-LFA Local Repair Pipeline (an explicitly educational abstraction, not real ASIC internals): packet arrives → primary next-hop lookup → protected resource DOWN → TI-LFA backup lookup → repair state READY? → obtain repair segment list → push repair segment(s) → forward on the safe next hop.",
  },
  {
    id: "r3-transit-normal",
    label: "R3: Ordinary Transit",
    narrative: "R3 processes the active top SID — R5's Node SID (16005), the repair segment — using ordinary SR forwarding toward R5. R3 does not need to know why R2 imposed the repair segment, what failed, or how TI-LFA computed it; it simply forwards toward the currently active SID like any normal SR transit router.",
    packet: (state) => (state.packet ? mplsPacket("r3-transit", "R3", "R5", "FORWARD", "FORWARD", state.packet) : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const journey = [...state.journey, { router: "R3" as RouterId, input: "active SID (repair)", lookup: "Ordinary SID forwarding — no TI-LFA knowledge required", action: "FORWARD", output: "forwarded toward R5" }];
      return { state: { ...state, packetAt: "R5", journey }, events: [] };
    },
  },
  {
    id: "repair-completes-r5",
    label: "R5: Repair Segment Completes",
    narrative: "R5 is the repair segment's target — the repair label is popped, and R6's Node SID (which survived underneath the whole time) becomes the active segment. R5 does not recompute R2's TI-LFA algorithm — it just completes the segment that targets it.",
    packet: (state) => (state.packet ? mplsPacket("repair-complete", "R5", "R5", "POP REPAIR", "REPAIR COMPLETE", state.packet) : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const packet = popTopLabel(state.packet);
      const journey = [...state.journey, { router: "R5" as RouterId, input: "repair segment", lookup: "Self is repair segment target", action: "POP_REPAIR", output: `original SID ${R6_NODE_SID} now active` }];
      return { state: { ...state, packet, journey }, events: [{ type: "MPLS_LABEL_POPPED", stepId: "repair-completes-r5", timestamp: Date.now(), message: "R5: repair segment completes, original SID exposed" }] };
    },
  },
  {
    id: "predict-repair-completes",
    label: "Predict",
    narrative: "Before continuing:",
    question: {
      prompt: "When the repair SID completes at the repair point, what should normally become active next?",
      options: [
        { id: "original-sid", label: "The original underlying SR segment — here, R6's Node SID" },
        { id: "nothing", label: "Nothing — the packet is done being labeled" },
        { id: "recompute", label: "R5 recomputes a brand new TI-LFA repair of its own" },
        { id: "back-to-r2", label: "The packet returns to R2 for re-evaluation" },
      ],
      correctOptionId: "original-sid",
      explanation: "The original SR instruction survived underneath the repair segment the whole time. Once the repair segment completes, it's simply exposed and normal SR forwarding resumes toward it — no recomputation at R5.",
    },
  },
  {
    id: "r5-to-r6",
    label: "R5 → R6: Normal Forwarding Resumes",
    narrative: "R5 forwards using its own ordinary shortest path toward the now-active R6 Node SID — a direct link. Completely normal SR-MPLS forwarding, unaware anything was ever repaired.",
    packet: (state) => (state.packet ? mplsPacket("resume", "R5", "R6", "FORWARD", "FORWARD", state.packet) : undefined),
    run: (state) => {
      const journey = [...state.journey, { router: "R5" as RouterId, input: `label ${R6_NODE_SID}`, lookup: "Active SID lookup → own shortest path to R6 (direct)", action: "FORWARD", output: `label ${R6_NODE_SID}` }];
      return { state: { ...state, packetAt: "R6", journey }, events: [] };
    },
  },
  {
    id: "destination-reached",
    label: "R6 Delivers",
    narrative: "R6 is the segment's target — pops and delivers. The repaired path: R1 → R2 → R3 → R5 → R6, with local repair active only across R2 → R3 → R5.",
    packet: (state) => (state.packet ? { id: "ip-delivered2", protocol: "IP", from: "R6", to: "R6", summary: "Delivered via TI-LFA local repair", layers: buildPacketLayers(state.packet) } : undefined),
    run: (state) => ({ state: { ...state, packet: popTopLabel(state.packet ?? { srcIp: "", dstIp: "", labels: [] }), journey: [...state.journey, { router: "R6" as RouterId, input: `label ${R6_NODE_SID}`, lookup: "Self is segment target", action: "DELIVER", output: "Delivered" }] }, events: [{ type: "MPLS_PACKET_FORWARDED", stepId: "destination-reached", timestamp: Date.now(), message: "R6 delivers via local repair" }] }),
    whatChanged: () => ["Delivered R1 → R2 → R3 → R5 → R6 — local repair carried it across the failure without R1 ever reacting"],
  },
  {
    id: "repaired-path-highlight",
    label: "The Local Repair Section",
    narrative: "Highlighted: Primary (R1→R2, now dead-ended at the failed link), Failed Resource (R2-R4), Repair Segment (R2→R3→R5 — the local repair section), Post-Convergence Path (R2→R3→R5→R6, which the repair segment funnels into).",
  },
  {
    id: "local-vs-global",
    label: "Local Repair vs. Global Convergence",
    narrative: "Two separate processes, running on two different timelines. LOCAL: R2 detects the failure → activates the precomputed repair → traffic continues. GLOBAL: IGP floods the failure → every router runs SPF → R1 eventually learns the new path → steady-state forwarding converges. Local repair already restored traffic long before the global process even starts making progress.",
  },
  {
    id: "global-convergence-compute",
    label: "Global IGP Convergence",
    narrative: "IGP now floods the R2-R4 failure network-wide, and SPF recomputes everywhere — a real, separate computation, run once, not per packet.",
    run: (state) => {
      const reopt = computePostConvergencePath(state.links, HEADEND, DESTINATION, "LINK", "R2-R4");
      return { state: { ...state, globalConverged: true, reoptimized: reopt, linkProtectionLifecycle: "CONVERGING" }, events: [{ type: "OSPF_SPF_COMPLETED", stepId: "global-convergence-compute", timestamp: Date.now(), message: `Global SPF converged: ${reopt?.path.join(" → ")}` }] };
    },
    whatChanged: (_, next) => [`Global SPF R1→R6 converged: ${next.reoptimized?.path.join(" → ")}`, "TI-LFA lifecycle: LOCAL_REPAIR_ACTIVE → CONVERGING"],
  },
  {
    id: "post-convergence-forwarding",
    label: "Ordinary Forwarding Resumes",
    narrative: "Once R2 has itself converged, its OWN shortest path toward the R6 Node SID is now R2→R3→R5→R6 directly — no repair segment required. R1's imposed stack goes back to just [R6 Node SID][IP]; R2 forwards it correctly on its own, without any TI-LFA involvement.",
    run: (state) => ({ state: { ...state, linkProtectionLifecycle: "CONVERGED" }, events: [] }),
  },
  {
    id: "repair-temporary",
    label: "TI-LFA Repair Is Temporary",
    narrative: "TI-LFA repair labels are used only during the local-protection interval — between failure detection and global convergence. After convergence, forwarding uses the normal converged LFIB. Repair labels are never left permanently stacked once convergence catches up.",
  },
  {
    id: "recovery-timeline",
    label: "Simulated Recovery Timeline",
    narrative: "A full timeline of everything that just happened — precomputation through convergence.",
  },
  {
    id: "protection-lifecycle-recap",
    label: "PacketVerse TI-LFA Recovery Lifecycle",
    narrative: "A PacketVerse teaching abstraction, not an official protocol FSM: UNPROTECTED → COMPUTING → READY → FAILURE_DETECTED → LOCAL_REPAIR_ACTIVE → CONVERGING → CONVERGED.",
  },
  {
    id: "restore-after-link-demo",
    label: "Restore For Node Protection",
    narrative: "R2-R4 is restored, and the primary path resumes. Next: protecting the NODE R4 itself, not just the one link into it.",
    run: (state) => ({ state: { ...state, failedLinkIds: [], linkProtectionLifecycle: "READY", activeProtectionType: undefined, packet: undefined, packetAt: undefined, journey: [], reoptimized: undefined, globalConverged: true }, events: [] }),
  },
  {
    id: "node-protection-intro",
    label: "Protecting R4 As A Node",
    narrative: "A different, stronger failure mode: R4 fails completely, not just the R2-R4 link. A node-protecting repair must avoid R4 entirely — not just the one link into it. The domain layer computes this independently; it does not assume the link-protecting result still applies.",
  },
  {
    id: "node-protection-compute",
    label: "Computed: Node-Protecting Repair",
    narrative: "P-Space and Q-Space recomputed with R4 excluded entirely as a node — not merely the R2-R4 link.",
    run: (state) => {
      const comp = computeTiLfa(state.links, "R2", "R6", "NODE", PROTECTED_NODE);
      return { state: { ...state, nodeProtection: comp, nodeProtectionLifecycle: "READY" }, events: [{ type: "OSPF_SPF_COMPLETED", stepId: "node-protection-compute", timestamp: Date.now(), message: `Node-protecting repair point: ${comp.repairPoint}` }] };
    },
    whatChanged: (_, next) => [`Node protection (R4): PQ candidates ${next.nodeProtection?.pqCandidates.join(", ")}, repair point ${next.nodeProtection?.repairPoint}`],
  },
  {
    id: "protection-comparison",
    label: "Link Protection vs. Node Protection",
    narrative: "LINK PROTECTION (R2-R4): repair avoids just that one link. NODE PROTECTION (R4): repair avoids R4 entirely — a stronger constraint. In this topology both happen to compute the same physical repair path, because R2's own shortest path to R5 never touched R4 in the first place — but they are two independently-verified constraints, not one assumption reused for the other.",
  },
  {
    id: "multi-sid-example",
    label: "Advanced Example: When A Node SID Alone Isn't Enough",
    narrative: "A separate illustration (not this lesson's live topology, and not re-derived through the full P/Q-Space pipeline — this isolates the segment-derivation algorithm itself): the desired safe sub-path is still R2 → R3 → R5. R2's own shortest path to R3 matches directly, so a Node SID suffices there. But in THIS illustrative topology, R3's own shortest path to R5 prefers a cheap cross-link through the protected node instead of the direct R3-R5 link — so a plain Node SID at R3 would not reproduce the intended hop. The SAME minimal-segment algorithm used everywhere else in this lesson correctly falls back to an explicit Adjacency SID for just that one hop.",
    run: (state) => {
      const segments = deriveMinimalRepairSegments(["R2", "R3", "R5"], ADV_MULTI_SID_LINKS);
      return { state: { ...state, advMultiSidSegments: segments }, events: [{ type: "MPLS_LABEL_INSTALLED", stepId: "multi-sid-example", timestamp: Date.now(), message: `Advanced repair segments: ${segments.map((s) => `${s.type}(${s.target})`).join(" → ")}` }] };
    },
  },
  {
    id: "classic-lfa-vs-tilfa",
    label: "Classic LFA vs. TI-LFA",
    narrative: "CLASSIC LFA: an alternate next hop satisfies a loop-free condition — simple, but limited to what one adjacent next hop can express. TI-LFA: an SR repair list recreates the safe post-convergence path when one simple next hop isn't enough. Classic LFA isn't obsolete — it's just a narrower tool that TI-LFA's SR instructions can generalize.",
  },
  {
    id: "rsvp-frr-vs-tilfa",
    label: "RSVP FRR vs. TI-LFA",
    narrative: "RSVP FRR — protection object: an RSVP bypass LSP; prepared with: RSVP signaling; local repair: PLR activates the bypass. TI-LFA — protection object: an SR repair segment list; prepared with: IGP topology + SR SID state; local repair: PLR activates repair instructions. Both share the same goal: local repair before global convergence completes — expressed through different machinery.",
  },
  {
    id: "sr-policy-interaction",
    label: "Advanced Tie-In: SR Policy",
    narrative: "If R1 were steering GOLD traffic via an SR Policy whose active candidate currently traverses R2-R4, and R2-R4 fails: R2 can activate TI-LFA locally BEFORE R1 ever re-evaluates the SR Policy candidate. Only later might SR Policy candidate fallback/reoptimization change the end-to-end segment list. This isn't simulated fully here — just the ordering, which matters.",
  },
  {
    id: "predict-sr-policy-vs-tilfa",
    label: "Predict",
    narrative: "Before moving on:",
    question: {
      prompt: "Is SR Policy candidate fallback the same mechanism as TI-LFA?",
      options: [
        { id: "no", label: "No — TI-LFA is local repair at the PLR; candidate fallback is headend policy re-selection" },
        { id: "yes", label: "Yes — they're the same underlying mechanism" },
        { id: "tilfa-subset", label: "TI-LFA is a special case of candidate fallback" },
        { id: "only-with-policy", label: "TI-LFA only exists when an SR Policy is configured" },
      ],
      correctOptionId: "no",
      explanation: "TI-LFA activates locally at the PLR (R2), immediately, without any headend involvement. SR Policy candidate fallback is a headend (R1) re-selection among candidates — a completely different mechanism that can also run independently of TI-LFA, and typically reacts afterward.",
    },
  },
  {
    id: "repair-path-failure-experiment",
    label: "Operational Experiment: Fail The Repair Path Itself",
    narrative: "Before the primary fails: fail R3-R5 — a link the REPAIR path depends on — while the primary R2-R4 stays completely healthy.",
    run: (state) => ({ state: { ...state, failedLinkIds: ["R3-R5"] }, events: [{ type: "MPLS_LSP_CHANGED", stepId: "repair-path-failure-experiment", timestamp: Date.now(), message: "R3-R5 down — primary R2-R4 unaffected" }] }),
    whatChanged: () => ["R3-R5: UP → DOWN (primary R2-R4 stays healthy)"],
  },
  {
    id: "protection-unavailable-primary-up",
    label: "PRIMARY: UP · PROTECTION: UNAVAILABLE",
    narrative: "Exactly the lesson RSVP-TE FRR already taught: PRIMARY stays UP (traffic never used the repair path). But TI-LFA protection readiness becomes UNAVAILABLE — the repair segment list depended on R3-R5, and no other valid repair path currently exists.",
    run: (state) => {
      const comp = computeTiLfa(state.links, "R2", "R6", "LINK", "R2-R4");
      const ready = determineProtectionReadiness(comp, state.links);
      return { state: { ...state, linkProtection: comp, linkProtectionLifecycle: ready === "READY" ? "READY" : "UNPROTECTED" }, events: [] };
    },
    whatChanged: (_, next) => [`Primary: UP (unaffected)`, `TI-LFA readiness: ${next.linkProtection?.repairPoint ? "degraded/unavailable" : "UNAVAILABLE — no valid PQ candidate"}`],
  },
  {
    id: "restore-repair-path",
    label: "Restore R3-R5",
    narrative: "R3-R5 is restored, and protection recomputes back to READY.",
    run: (state) => {
      const comp = computeTiLfa(state.links, "R2", "R6", "LINK", "R2-R4");
      return { state: { ...state, failedLinkIds: [], linkProtection: comp, linkProtectionLifecycle: "READY" }, events: [] };
    },
  },
  {
    id: "no-repair-path-scenario",
    label: "No-Repair-Path Scenario",
    narrative: "Now fail BOTH R2-R4 and R3-R5 at once — no surviving path to R6 exists at all from R2 except through the failed resources.",
    run: (state) => {
      const links = state.links.filter((l) => l.id !== "R2-R4" && l.id !== "R3-R5");
      const comp = computeTiLfa(links, "R2", "R6", "LINK", "R2-R4");
      return { state: { ...state, failedLinkIds: ["R2-R4", "R3-R5"], linkProtection: comp, linkProtectionLifecycle: comp.repairPoint ? "READY" : "UNPROTECTED" }, events: [{ type: "MPLS_LSP_CHANGED", stepId: "no-repair-path-scenario", timestamp: Date.now(), message: "R2-R4 and R3-R5 both down" }] };
    },
    whatChanged: (_, next) => [next.linkProtection?.repairPoint ? `Unexpected: a repair point was still found (${next.linkProtection.repairPoint})` : "NO REPAIR PATH — no PQ candidate exists; TI-LFA cannot manufacture connectivity that isn't there"],
  },
  {
    id: "restore-all",
    label: "Restore Everything",
    narrative: "Both links restored; protection recomputes cleanly back to READY.",
    run: (state) => {
      const comp = computeTiLfa(BASE_LINKS, "R2", "R6", "LINK", "R2-R4");
      return { state: { ...state, links: BASE_LINKS, failedLinkIds: [], linkProtection: comp, linkProtectionLifecycle: "READY", topologyVersion: state.topologyVersion }, events: [] };
    },
  },
  {
    id: "troubleshooting-intro",
    label: "An IGP Metric Changes Elsewhere",
    narrative: "Somewhere else in the network, an administrator retunes the R2-R3 metric from 15 to 25 for unrelated reasons. Primary traffic is unaffected — R1→R2→R4→R6 doesn't use R2-R3 at all.",
    run: (state) => {
      const links = state.links.map((l) => (l.id === "R2-R3" ? { ...l, metric: 25 } : l));
      return { state: { ...state, links, topologyVersion: state.topologyVersion + 1, troubleshooting: { ...state.troubleshooting, metricChanged: true } }, events: [{ type: "OSPF_COST_CHANGED", stepId: "troubleshooting-intro", timestamp: Date.now(), message: "R2-R3 metric: 15 → 25" }] };
    },
    whatChanged: () => ["R2-R3 metric: 15 → 25 (primary path unaffected)"],
  },
  {
    id: "incident-narrative",
    label: "INCIDENT",
    narrative: "SR traffic to R6 was healthy. TI-LFA showed READY before this event. After a failure of R2-R4, traffic did not successfully reach the post-convergence path. IGP eventually converges and connectivity returns, but local protection failed.",
    run: (state) => ({ state: { ...state, troubleshooting: { ...state.troubleshooting, started: true } }, events: [] }),
  },
  {
    id: "fail-for-incident",
    label: "R2-R4 LINK DOWN (Stale Protection)",
    narrative: "R2-R4 fails. TI-LFA still shows READY — it was never recomputed against the R2-R3 metric change — so it activates immediately, exactly as designed.",
    run: (state) => ({ state: { ...state, failedLinkIds: ["R2-R4"], linkProtectionLifecycle: "LOCAL_REPAIR_ACTIVE", activeProtectionType: "LINK" }, events: [{ type: "MPLS_LSP_CHANGED", stepId: "fail-for-incident", timestamp: Date.now(), message: "R2-R4 down — stale TI-LFA repair activates" }] }),
  },
  {
    id: "stale-repair-fails",
    label: "The Stale Repair Fails",
    narrative: "R2 pushes the OLD repair segment (R5 Node SID) — computed back when R2-R3 was 15. With R2-R3 now 25, R2's own CURRENT shortest path to R5 no longer matches what the repair assumed, and the repair packet does not reach the post-convergence path.",
    packet: (state) => (state.packet ? mplsPacket("stale-repair", "R2", "R2", "PUSH REPAIR (STALE)", "REPAIR FAILED", state.packet) : undefined),
    run: (state) => {
      const base = state.packet ?? { srcIp: HOST_BEHIND_R1, dstIp: HOST_BEHIND_R6, labels: [{ value: R6_NODE_SID, bottomOfStack: true, purpose: "segment" as const }] };
      const packet = pushLabel(base, deriveNodeSidLabel("R5"), "repair");
      const journey = [...state.journey, { router: "R2" as RouterId, input: `label ${R6_NODE_SID}`, lookup: "Stale repair segment list (computed before the metric change)", action: "PUSH_REPAIR_STALE", output: "repair packet does not reach the post-convergence path" }];
      return { state: { ...state, packet, packetAt: "R2", packetDropped: true, journey }, events: [{ type: "MPLS_PACKET_DROPPED", stepId: "stale-repair-fails", timestamp: Date.now(), message: "Stale TI-LFA repair fails to reach the post-convergence path" }] };
    },
  },
  {
    id: "diagnostic-ladder",
    label: "Diagnose Before You Fix",
    narrative: "Something about the repair computation doesn't match the current topology. Work the diagnostic ladder below before touching anything.",
  },
  {
    id: "repair-challenge",
    label: "Engineer Challenge: Fix The Stale Repair",
    narrative: "Choose the correct repair.",
    action: (state, payload) => {
      const choice = (payload as { choice?: string } | undefined)?.choice ?? "";
      if (choice !== "recompute-tilfa") {
        return { state: { ...state, troubleshooting: { ...state.troubleshooting, repairAttempt: { choice, correct: false } } }, events: [] };
      }
      const comp = computeTiLfa(state.links, "R2", "R6", "LINK", PROTECTED_LINK);
      return {
        state: { ...state, linkProtection: comp, troubleshooting: { ...state.troubleshooting, repairAttempt: { choice, correct: true }, recomputed: true } },
        events: [{ type: "MPLS_LABEL_INSTALLED", stepId: "repair-challenge", timestamp: Date.now(), message: `TI-LFA recomputed: repair point ${comp.repairPoint}, segments ${comp.repairSegments.map((s) => s.type).join(",")}` }],
      };
    },
    requiresState: (state) => state.troubleshooting.recomputed === true,
  },
  {
    id: "repaired-restore",
    label: "Repair READY Again",
    narrative: "Recomputed against the current topology, the new repair point is R3 (R5 is no longer safely reachable from R2 without crossing the protected resource, now that R2-R3 costs more than the top path). R2-R4 is restored so this can be verified cleanly.",
    run: (state) => ({ state: { ...state, failedLinkIds: [], linkProtectionLifecycle: "READY", activeProtectionType: undefined, packet: undefined, packetAt: undefined, packetDropped: false, journey: [] }, events: [] }),
  },
  {
    id: "verify-trigger-fail",
    label: "Fail R2-R4 Again",
    narrative: "Mandatory verification: fail the protected link again and follow the packet through the newly-correct repair.",
    run: (state) => ({ state: { ...state, failedLinkIds: ["R2-R4"], linkProtectionLifecycle: "FAILURE_DETECTED" }, events: [{ type: "MPLS_LSP_CHANGED", stepId: "verify-trigger-fail", timestamp: Date.now(), message: "R2-R4 down (verification)" }] }),
  },
  {
    id: "verify-push",
    label: "R1 → R2: Send + Push",
    narrative: "A fresh packet, pushed with R6's Node SID exactly as always.",
    packet: (state) => (state.packet ? mplsPacket("verify-push", "R1", "R2", `PUSH R6 Node SID ${R6_NODE_SID}`, "PUSH", state.packet) : undefined),
    run: (state) => {
      const withLabel = pushLabel({ srcIp: HOST_BEHIND_R1, dstIp: HOST_BEHIND_R6, labels: [] }, R6_NODE_SID, "segment");
      const journey = [{ router: "R1" as RouterId, input: "IP", lookup: "Impose R6 Node SID", action: "PUSH", output: `label ${R6_NODE_SID}` }];
      return { state: { ...state, packet: withLabel, packetAt: "R2", journey, packetDropped: false }, events: [] };
    },
  },
  {
    id: "verify-repair",
    label: "R2: Activates The CORRECT Repair",
    narrative: "R2 detects R2-R4 down and pushes the freshly-recomputed repair segment — R3's Node SID, derived from the CURRENT topology.",
    packet: (state) => (state.packet ? mplsPacket("verify-repair-pkt", "R2", "R3", "PUSH REPAIR", "REPAIR", state.packet) : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const repairLabel = deriveNodeSidLabel("R3");
      const packet = pushLabel(state.packet, repairLabel, "repair");
      const journey = [...state.journey, { router: "R2" as RouterId, input: `label ${R6_NODE_SID}`, lookup: "TI-LFA backup lookup → recomputed repair segment list", action: "PUSH_REPAIR", output: `label ${repairLabel} (repair) + label ${R6_NODE_SID} (original)` }];
      return { state: { ...state, packet, packetAt: "R3", journey, linkProtectionLifecycle: "LOCAL_REPAIR_ACTIVE", activeProtectionType: "LINK" }, events: [{ type: "MPLS_LABEL_PUSHED", stepId: "verify-repair", timestamp: Date.now(), message: "R2 pushes the corrected repair segment" }] };
    },
  },
  {
    id: "verify-deliver",
    label: "R3 Completes, R5 Relays, R6 Delivers",
    narrative: "R3 is the repair point — the repair segment completes there, exposing R6's Node SID. R3 forwards via its own shortest path to R6 (through R5), R5 relays normally, and R6 delivers. Verified: the repair genuinely reaches the destination this time.",
    packet: (state) => (state.packet ? { id: "verify-delivered", protocol: "IP", from: "R6", to: "R6", summary: "Delivered via corrected TI-LFA repair", layers: buildPacketLayers(state.packet) } : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      // R3 pops the repair segment; R6 (the R6 Node SID target — no PHP is modeled in this lesson) removes 16006 on delivery.
      const afterPop = popTopLabel(popTopLabel(state.packet));
      const journey = [
        ...state.journey,
        { router: "R3" as RouterId, input: "repair segment", lookup: "Self is repair segment target", action: "POP_REPAIR", output: `original SID ${R6_NODE_SID} now active` },
        { router: "R3" as RouterId, input: `label ${R6_NODE_SID}`, lookup: "Own shortest path to R6 (via R5)", action: "FORWARD", output: `label ${R6_NODE_SID}` },
        { router: "R5" as RouterId, input: `label ${R6_NODE_SID}`, lookup: "Own shortest path to R6 (direct)", action: "FORWARD", output: `label ${R6_NODE_SID}` },
        { router: "R6" as RouterId, input: `label ${R6_NODE_SID}`, lookup: "Self is segment target", action: "DELIVER", output: "Delivered" },
      ];
      return { state: { ...state, packet: afterPop, packetAt: "R6", journey, troubleshooting: { ...state.troubleshooting, verified: true } }, events: [{ type: "MPLS_PACKET_FORWARDED", stepId: "verify-deliver", timestamp: Date.now(), message: "Verified: corrected repair delivers to R6" }] };
    },
    whatChanged: () => ["Verified: R1 → R2 → R3 → R5 → R6 via the corrected repair — recomputation alone was not enough, delivery had to be proven"],
  },
  {
    id: "engineer-challenge-intro",
    label: "Engineer Challenge: Survive The Failure",
    narrative: "Recap and confirm: protect SR traffic from R1 to R6 against both an R2-R4 link failure and a complete R4 node failure. Everything below was already demonstrated in this lesson — this is the checklist.",
  },
  {
    id: "engineer-challenge-confirm",
    label: "Confirm Full Protection Coverage",
    narrative: "Primary path inspected ✓ · Repair point (R2) identified ✓ · Post-convergence SPF inspected ✓ · P-Space inspected ✓ · Q-Space inspected ✓ · PQ candidate identified ✓ · Minimal repair segment list built ✓ · Protection verified READY ✓ · Normal traffic sent ✓ · Protected resource failed ✓ · Local repair stack inspected ✓ · Repair packet followed to the destination ✓ · Global convergence awaited ✓ · Repair labels confirmed no longer needed ✓ · Node protection (R4) independently verified ✓.",
    requiresState: (state) => !!state.nodeProtection?.repairPoint && state.troubleshooting.verified === true,
  },
  {
    id: "complete",
    label: "Complete",
    narrative: "You built TI-LFA local repair from real topology: post-convergence SPF, P-Space, Q-Space, a derived PQ candidate, and a minimal repair segment list — activated locally at the PLR, without waiting for the headend and without any pre-signaled bypass tunnel. You protected both a link and a node, diagnosed a stale repair computation, and verified the fix by actually following a packet through it. +600 XP awarded.",
  },
];

function stepIdx(id: string): number {
  return srTiLfaSteps.findIndex((s) => s.id === id);
}
export const STEP_IDX = {
  topologyIntro: stepIdx("topology-intro"),
  baselineComplete: stepIdx("r6-deliver-normal"),
  protectedResourceIntro: stepIdx("protected-resource-intro"),
  postConvergenceIntro: stepIdx("post-convergence-intro"),
  pSpaceCompute: stepIdx("p-space-compute"),
  qSpaceCompute: stepIdx("q-space-compute"),
  pqSelect: stepIdx("pq-select"),
  repairListCompute: stepIdx("repair-list-compute"),
  protectionReady: stepIdx("protection-ready"),
  triggerFailure: stepIdx("trigger-failure"),
  repairLabelStack: stepIdx("repair-label-stack"),
  repairedPathHighlight: stepIdx("repaired-path-highlight"),
  recoveryTimeline: stepIdx("recovery-timeline"),
  nodeProtectionCompute: stepIdx("node-protection-compute"),
  protectionComparison: stepIdx("protection-comparison"),
  multiSidExample: stepIdx("multi-sid-example"),
  troubleshootingIntro: stepIdx("troubleshooting-intro"),
  diagnosticLadder: stepIdx("diagnostic-ladder"),
  repairChallenge: stepIdx("repair-challenge"),
  engineerChallengeIntro: stepIdx("engineer-challenge-intro"),
  complete: stepIdx("complete"),
};

// ---------------------------------------------------------------------------
// CLI perspectives — CONCEPT / Cisco IOS-XR / Junos. Every string below
// is derived from live state, never hardcoded vendor doc text beyond the
// small set of realistic, minimal commands.
// ---------------------------------------------------------------------------
export interface TiLfaCliVendorOutput {
  cmd: string;
  output: string;
}
export interface TiLfaCliEntry {
  id: string;
  label: string;
  concept: string;
  cisco: TiLfaCliVendorOutput;
  juniper: TiLfaCliVendorOutput;
}
export function buildSrTiLfaCliCommands(state: SrTiLfaState, router: RouterId): TiLfaCliEntry[] {
  const comp = state.linkProtection;
  const readiness = comp ? determineProtectionReadiness(comp, state.links) : "NOT_CONFIGURED";
  return [
    {
      id: "sr-sid-db",
      label: "SID Database",
      concept: "Every router's Node SID — derived from SRGB + per-router index, not configured per pair.",
      cisco: { cmd: `show mpls segment-routing prefix-sid`, output: buildSidDatabase(state.links, router).filter((r) => r.sidType === "NODE").map((r) => `${r.router} Prefix-SID index ${r.sidIndex}, label ${r.localLabel}`).join("\n") },
      juniper: { cmd: `show route table inet.3 protocol spring`, output: buildSidDatabase(state.links, router).filter((r) => r.sidType === "NODE").map((r) => `${r.router}/32 via Node-SID ${r.localLabel}`).join("\n") },
    },
    {
      id: "protected-resource",
      label: "Protected Resource",
      concept: "The specific resource this router is protecting — a link here, a node in the later node-protection example.",
      cisco: { cmd: `show mpls traffic-eng fast-reroute database`, output: `Protected: ${PROTECTED_LINK} (link)\nPLR: ${PLR}\nProtection: TI-LFA` },
      juniper: { cmd: `show ti-lfa protection`, output: `protected-link ${PROTECTED_LINK};\nplr ${PLR};` },
    },
    {
      id: "repair-state",
      label: "Repair State",
      concept: readiness === "READY" ? "Precomputed and installed — carrying no traffic yet." : readiness === "UNAVAILABLE" ? "A repair was computed but does not currently validate against the live topology." : "No valid PQ candidate currently exists.",
      cisco: { cmd: `show mpls traffic-eng fast-reroute database repair`, output: comp ? `Repair state: ${readiness}\nRepair point: ${comp.repairPoint ?? "none"}\nRepair segments: ${comp.repairSegments.map((s) => `${s.type}(${s.target})`).join(", ") || "(none)"}` : "No repair computed." },
      juniper: { cmd: `show ti-lfa repair-list`, output: comp ? `state ${readiness};\nrepair-point ${comp.repairPoint ?? "none"};\nsegments [ ${comp.repairSegments.map((s) => s.type + ":" + s.target).join(" ")} ];` : "no repair computed;" },
    },
    {
      id: "lfib",
      label: "LFIB / Forwarding",
      concept: "What this router is actually doing with the packet right now — reflects live journey state, not a static table.",
      cisco: { cmd: `show mpls forwarding-table`, output: state.journey.filter((h) => h.router === router).map((h) => `In: ${h.input}  Action: ${h.action}  Out: ${h.output}`).join("\n") || "(no forwarding entry recorded at this router yet)" },
      juniper: { cmd: `show route forwarding-table label-switched-path`, output: state.journey.filter((h) => h.router === router).map((h) => `in ${h.input} -> ${h.action} -> out ${h.output}`).join("\n") || "(no forwarding entry recorded at this router yet)" },
    },
    {
      id: "failure-state",
      label: "Failure / Local Repair",
      concept: state.linkProtectionLifecycle === "LOCAL_REPAIR_ACTIVE" ? "Local repair is actively carrying traffic right now — before global convergence." : "No active local repair right now.",
      cisco: { cmd: `show mpls traffic-eng fast-reroute log`, output: `Failed links: ${state.failedLinkIds.join(", ") || "none"}\nFailed node: ${state.failedNode ?? "none"}\nLink protection lifecycle: ${state.linkProtectionLifecycle}` },
      juniper: { cmd: `show ti-lfa events`, output: `failed-links [ ${state.failedLinkIds.join(" ")} ];\nlifecycle ${state.linkProtectionLifecycle};` },
    },
  ];
}
