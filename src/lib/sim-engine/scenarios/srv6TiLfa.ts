import type { PacketLayer, PacketVisual, ScenarioStep } from "../types";
import { buildSrv6Sid, fmtIpv6, hextetsEqual, type Hextets } from "./srv6Foundations";
import { FUNCTION, type InnerPayload } from "./srv6EndpointBehaviors";
import { PE2_DT4_SID, PE1_SR_SOURCE as VPN_PE1_SOURCE } from "./srv6L3vpn";

/**
 * SRv6 Protection / TI-LFA (RFC 9855 — Topology Independent Fast Reroute
 * Using Segment Routing; RFC 8986 SRv6 Network Programming, specifically
 * the USD flavor; RFC 8754 SRH; RFC 8402 SR Architecture). Follows SRv6
 * L3VPN. Central question: IGP convergence eventually repairs the
 * network, but TI-LFA protects traffic locally, at the Point of Local
 * Repair (PLR), for the interval BETWEEN local failure detection and
 * that convergence completing — using a precomputed outgoing interface
 * plus an SRv6 repair program, never a from-scratch computation at
 * failure time.
 *
 * "Topology Independent" does NOT mean topology-free — RFC 9855's
 * repair is computed FROM the link-state topology/LSDB, same as classic
 * LFA. "TI" means the repair coverage isn't limited to whichever single
 * adjacent backup next hop classic LFA happens to find; it can encode a
 * short SR program that reaches a genuinely safe point regardless of
 * local topology shape.
 *
 *                          ┌──── P2 ──── PE2
 *                          │
 *   PE1 ─── P1 ────────────┘
 *            \
 *             \
 *              P3 ─── P4 ──┬──── P2
 *                          └──────── PE2
 *
 * Required links: PE1-P1(10), P1-P2(10), P2-PE2(10) [primary path];
 * P1-P3(10), P3-P4(10), P4-P2(50), P4-PE2(70) [protection topology].
 * PLR = P1. Protected resource (main lab) = link P1-P2, destination PE2.
 *
 * Reuse decisions (checked against existing files before writing
 * anything new, per the project's own no-cross-lesson-type-coupling
 * convention — this topology's own RouterId/LinkDef are NOT the R1-R6
 * union `srTiLfa.ts` already owns, so its P/Q/SPF pure functions can't
 * be called directly without an unsafe cast; the ALGORITHM — shortest
 * path, isPathSafe, P-Space, Q-Space, minimal-segment derivation — is
 * ported faithfully, extended with a real `computeExtendedPSpace()`
 * (srTiLfa.ts explicitly scopes that out as a documented simplification;
 * this lesson implements it for real) and a per-router stale-FIB model
 * srTiLfa.ts's single-shared-topology design has no need for):
 *   - `buildSrv6Sid` / `fmtIpv6` / `hextetsEqual` — generic SID/format
 *     helpers, reused directly from `srv6Foundations.ts`.
 *   - `FUNCTION.END_X` (0x2) — the SAME numeric allocation Endpoint
 *     Behaviors uses; USD is modeled as a FLAVOR on that same base
 *     behavior (`flavors: ["USD"]`), never a fake "TI_LFA_SID" behavior
 *     name, per RFC 8986's own flavor model.
 *   - `InnerPayload` — the generic exposed-payload union, reused
 *     directly from `srv6EndpointBehaviors.ts`.
 *   - `PE2_DT4_SID` — the REAL Service SID value from `srv6L3vpn.ts`,
 *     reused directly (read-only: `.sidHextets`/`.sidText`) for the
 *     nested-VPN-repair integration experiment (§46-49) — this is the
 *     exact same PE2, continuing that lesson's own packet concept, not
 *     a re-derived lookalike.
 *
 * Repair-node selection strategy (documented PacketVerse educational
 * choice, not an RFC-mandated universal algorithm, per RFC 9855's own
 * acknowledgment that implementations choose among valid strategies):
 * walk the expected post-convergence path from the PLR; the LAST node
 * on it that is still a member of P-Space (extended P-Space included)
 * is the repair node; the very next node after it on that same path is
 * the forced adjacency target. The repair NEVER relies on the repair
 * node's own downstream destination-based forwarding to complete the
 * journey — the original payload is a plain IPv6 packet with no SRv6
 * SID of its own (§15), so, exactly like P3's stale FIB cannot be
 * trusted for the first hop, no node's potentially-stale ordinary
 * forwarding is trusted for the last hop either; the repair always
 * forces the exact next link via an explicit End.X adjacency segment.
 * This unifies link and node protection under one mechanism and is why
 * a real Q-Space is still computed and shown (§23/§28) even though the
 * chosen merge is a forced adjacency rather than a bare Q-Space lookup.
 *
 * Scope: one destination (PE2), one PLR (P1), link protection (P1-P2)
 * as the main lab, node protection (P2) as a secondary lab, a small
 * separate two-SID SRH illustration, an SR-Policy caveat comparison
 * (read-only, no second policy engine), and one SRv6 L3VPN nested-
 * repair integration. Explicitly deferred (preview only, never
 * implemented): full SRLG computation, Flex-Algo-aware protection,
 * micro-loop-avoidance mechanisms, remote-LFA-style tunneling, uSID/
 * compressed repair lists, BFD, RSVP FRR, PCEP/controllers, a second
 * full SR Policy engine, inter-area/inter-domain protection.
 */

// ---------------------------------------------------------------------------
// Topology
// ---------------------------------------------------------------------------

export type RouterId = "PE1" | "P1" | "P2" | "P3" | "P4" | "PE2";
export const ALL_ROUTERS: RouterId[] = ["PE1", "P1", "P2", "P3", "P4", "PE2"];
export const HEADEND: RouterId = "PE1";
export const DESTINATION: RouterId = "PE2";
export const PLR: RouterId = "P1";

export type LinkId = "PE1-P1" | "P1-P2" | "P2-PE2" | "P1-P3" | "P3-P4" | "P4-P2" | "P4-PE2";
export interface LinkDef {
  id: LinkId;
  a: RouterId;
  b: RouterId;
  metric: number;
}
export const LINKS: LinkDef[] = [
  { id: "PE1-P1", a: "PE1", b: "P1", metric: 10 },
  { id: "P1-P2", a: "P1", b: "P2", metric: 10 },
  { id: "P2-PE2", a: "P2", b: "PE2", metric: 10 },
  { id: "P1-P3", a: "P1", b: "P3", metric: 10 },
  { id: "P3-P4", a: "P3", b: "P4", metric: 10 },
  { id: "P4-P2", a: "P4", b: "P2", metric: 50 },
  { id: "P4-PE2", a: "P4", b: "PE2", metric: 70 },
];
export const PRIMARY_PATH: RouterId[] = ["PE1", "P1", "P2", "PE2"];
export const PROTECTED_LINK: LinkId = "P1-P2";
export const PROTECTED_NODE: RouterId = "P2";

export const GRAPH_NODES = [
  { id: "PE1", label: "PE1", x: 4, y: 50, subLabel: "Headend" },
  { id: "P1", label: "P1", x: 26, y: 50, subLabel: "PLR" },
  { id: "P2", label: "P2", x: 62, y: 22, subLabel: "Protected" },
  { id: "PE2", label: "PE2", x: 92, y: 40, subLabel: "Destination" },
  { id: "P3", label: "P3", x: 40, y: 80 },
  { id: "P4", label: "P4", x: 62, y: 80 },
];
export const GRAPH_EDGES: { id: LinkId; a: RouterId; b: RouterId }[] = LINKS.map((l) => ({ id: l.id, a: l.a, b: l.b }));

export function linkBetween(links: LinkDef[], x: RouterId, y: RouterId): LinkDef | undefined {
  return links.find((l) => (l.a === x && l.b === y) || (l.b === x && l.a === y));
}
export function linkIdBetween(links: LinkDef[], x: RouterId, y: RouterId): LinkId | undefined {
  return linkBetween(links, x, y)?.id;
}

export const TERMS: { term: string; expansion: string; meaning: string }[] = [
  { term: "PLR", expansion: "Point of Local Repair", meaning: "The router directly upstream of the protected resource that detects the failure and activates a precomputed repair — locally, without waiting for the headend or global convergence." },
  { term: "TI-LFA", expansion: "Topology Independent LFA", meaning: "Uses the SAME link-state topology as everything else — 'independent' means the repair isn't limited to one adjacent backup next hop, not that it ignores topology." },
  { term: "P-Space", expansion: "PLR's Safe Space", meaning: "Nodes the PLR's OWN pre-convergence shortest path reaches without traversing the protected resource." },
  { term: "Q-Space", expansion: "Destination's Safe Space", meaning: "Nodes whose OWN pre-convergence shortest path reaches the destination without traversing the protected resource." },
  { term: "USD", expansion: "Ultimate Segment Decapsulation", meaning: "An End.X flavor: remove the repair's outer IPv6 header and extensions, exposing the original packet, then force it to a specific adjacency — not USP, not PSP, not MPLS PHP." },
];

// ---------------------------------------------------------------------------
// Generic shortest-path helpers — same brute-force-over-simple-paths
// technique as srTiLfa.ts's own helpers, typed to this lesson's own
// RouterId/LinkDef (a genuinely different topology, not R1-R6).
// ---------------------------------------------------------------------------

function neighborsOf(router: RouterId, links: LinkDef[]): RouterId[] {
  const out: RouterId[] = [];
  for (const l of links) {
    if (l.a === router) out.push(l.b);
    if (l.b === router) out.push(l.a);
  }
  return out;
}
function allSimplePaths(links: LinkDef[], from: RouterId, to: RouterId, avoidNode?: RouterId): RouterId[][] {
  const results: RouterId[][] = [];
  const visited = new Set<RouterId>([from]);
  const path: RouterId[] = [from];
  function dfs(current: RouterId) {
    if (current === to) {
      results.push([...path]);
      return;
    }
    for (const next of neighborsOf(current, links)) {
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
function pathCost(path: RouterId[], links: LinkDef[]): number {
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const l = linkBetween(links, path[i], path[i + 1]);
    total += l ? l.metric : Number.POSITIVE_INFINITY;
  }
  return total;
}
export interface PathResult {
  path: RouterId[];
  cost: number;
}
export function shortestPath(links: LinkDef[], from: RouterId, to: RouterId, avoidNode?: RouterId): PathResult | undefined {
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
// Protected resource / pre- and post-convergence FIB — the stale-FIB
// model this lesson needs and srTiLfa.ts's single-shared-topology design
// does not: each router's CURRENT forwarding view depends on whether
// THAT router has learned about the failure yet.
// ---------------------------------------------------------------------------

export type ProtectionMode = "LINK" | "NODE";

export function isPathSafe(path: RouterId[], links: LinkDef[], mode: ProtectionMode, protectedResource: string): boolean {
  if (mode === "LINK") return !linkIdsOnPath(path, links).includes(protectedResource as LinkId);
  return !path.includes(protectedResource as RouterId);
}

/** The topology as removing the protected resource would leave it — used for post-convergence SPF and for a router that HAS learned of the failure. Never mutates `links`. */
export function withResourceRemoved(links: LinkDef[], mode: ProtectionMode, protectedResource: string): { links: LinkDef[]; avoidNode?: RouterId } {
  if (mode === "LINK") return { links: links.filter((l) => l.id !== protectedResource) };
  return { links, avoidNode: protectedResource as RouterId };
}

export interface PreConvergenceFib {
  router: RouterId;
  destination: RouterId;
  nextHop?: RouterId;
  path?: RouterId[];
  cost?: number;
  knowsFailure: boolean;
}
/** A single router's CURRENT FIB entry toward `destination` — computed against the FULL topology if that router has not yet learned of the failure, or the failure-adjusted topology if it has. This is what lets P3 and P4 keep pointing at stale next hops while P1 has already converged locally. */
export function computePreConvergenceFib(router: RouterId, destination: RouterId, links: LinkDef[], mode: ProtectionMode, protectedResource: string, knowsFailure: boolean): PreConvergenceFib {
  const view = knowsFailure ? withResourceRemoved(links, mode, protectedResource) : { links, avoidNode: undefined };
  const sp = shortestPath(view.links, router, destination, view.avoidNode);
  return { router, destination, nextHop: sp && sp.path.length > 1 ? sp.path[1] : undefined, path: sp?.path, cost: sp?.cost, knowsFailure };
}

/** The path SPF will settle on once every router has converged — real SPF with the protected resource genuinely removed from the graph. This is "the answer"; P-Space/Q-Space is how the PLR reaches a safe point on it before that convergence has happened anywhere else. */
export function computePostConvergencePath(links: LinkDef[], from: RouterId, to: RouterId, mode: ProtectionMode, protectedResource: string): PathResult | undefined {
  const view = withResourceRemoved(links, mode, protectedResource);
  return shortestPath(view.links, from, to, view.avoidNode);
}

// ---------------------------------------------------------------------------
// P-Space / Extended P-Space / Q-Space (RFC 9855 §6) — a node belongs to
// P-Space only if its PRE-CONVERGENCE (current, resource-still-present)
// shortest path from the PLR happens to already avoid the resource; this
// is never "merely physically reachable without the failed link."
// ---------------------------------------------------------------------------

export function computePSpace(links: LinkDef[], plr: RouterId, mode: ProtectionMode, protectedResource: string): RouterId[] {
  return ALL_ROUTERS.filter((x) => {
    if (x === plr) return false;
    const sp = shortestPath(links, plr, x);
    return !!sp && isPathSafe(sp.path, links, mode, protectedResource);
  });
}

/** Extended P-Space (RFC 9855 §6.2): widen P-Space using each ELIGIBLE neighbor of the PLR's OWN shortest-path tree — a neighbor reachable only by crossing the protected resource is not eligible. srTiLfa.ts explicitly scopes this out as "not simulated"; this lesson implements it for real. */
export function computeExtendedPSpace(links: LinkDef[], plr: RouterId, mode: ProtectionMode, protectedResource: string): RouterId[] {
  const base = new Set(computePSpace(links, plr, mode, protectedResource));
  const eligibleNeighbors = neighborsOf(plr, links).filter((n) => {
    if (mode === "LINK") return linkIdBetween(links, plr, n) !== protectedResource;
    return n !== protectedResource;
  });
  for (const n of eligibleNeighbors) {
    for (const x of ALL_ROUTERS) {
      if (x === plr || x === n) continue;
      const sp = shortestPath(links, n, x);
      if (sp && isPathSafe(sp.path, links, mode, protectedResource)) base.add(x);
    }
  }
  base.delete(plr);
  return Array.from(base);
}

export function computeQSpace(links: LinkDef[], destination: RouterId, mode: ProtectionMode, protectedResource: string): RouterId[] {
  return ALL_ROUTERS.filter((y) => {
    if (y === destination) return false;
    const sp = shortestPath(links, y, destination);
    return !!sp && isPathSafe(sp.path, links, mode, protectedResource);
  });
}

export function findPqCandidates(pSpace: RouterId[], qSpace: RouterId[], plr: RouterId, destination: RouterId): RouterId[] {
  return pSpace.filter((n) => qSpace.includes(n) && n !== plr && n !== destination);
}

// ---------------------------------------------------------------------------
// Repair-node selection + repair path (outgoing interface + repair list,
// NEVER only a SID list) — see the file header for the documented
// strategy: last (extended) P-Space node on the post-convergence path,
// plus one forced End.X+USD adjacency to the next node on that path.
// ---------------------------------------------------------------------------

export type Srv6Flavor = "USD" | "PSP" | "USP";
export interface RepairSid {
  sidHextets: Hextets;
  sidText: string;
  owner: RouterId;
  behavior: "END_X";
  flavors: Srv6Flavor[];
  adjacency: RouterId;
}
export interface Srv6RepairList {
  sids: RepairSid[];
}
export interface TiLfaRepairPath {
  mode: ProtectionMode;
  protectedResource: string;
  plr: RouterId;
  destination: RouterId;
  postConvergencePath?: RouterId[];
  postConvergenceCost?: number;
  pSpace: RouterId[];
  extendedPSpace: RouterId[];
  qSpace: RouterId[];
  pqCandidates: RouterId[];
  repairNode?: RouterId;
  mergeTarget?: RouterId;
  outgoingInterface?: RouterId; // the PLR's own first hop toward repairNode — plain IPv6 reachability, no SID needed for this leg
  repairList: Srv6RepairList;
  strategy: "LAST_P_SPACE_NODE_PLUS_FORCED_ADJACENCY" | "NO_REPAIR_AVAILABLE";
}

const LOCATOR_HEXTETS4: Record<RouterId, [number, number, number, number]> = {
  PE1: [0x2001, 0x0db8, 0x0110, 0x0001],
  P1: [0x2001, 0x0db8, 0x0110, 0x0011],
  P2: [0x2001, 0x0db8, 0x0110, 0x0012],
  P3: [0x2001, 0x0db8, 0x0110, 0x0013],
  P4: [0x2001, 0x0db8, 0x0110, 0x0014],
  PE2: [0x2001, 0x0db8, 0x0110, 0x0002],
};
export const INFRA_ADDRESS: Record<RouterId, Hextets> = Object.fromEntries(ALL_ROUTERS.map((r) => [r, buildSrv6Sid(LOCATOR_HEXTETS4[r], 0)])) as Record<RouterId, Hextets>;
export const INFRA_ADDRESS_TEXT: Record<RouterId, string> = Object.fromEntries(ALL_ROUTERS.map((r) => [r, fmtIpv6(INFRA_ADDRESS[r])])) as Record<RouterId, string>;

/** A globally-routed End.X+USD repair SID at `owner`, forcing the specific adjacency `adjacency` — reachable via ordinary IPv6 forwarding toward `owner`'s locator, exactly like SRv6 L3VPN's Service SIDs, and deliberately NOT prefixed with a separate Node/End SID first (§13). */
export function buildRepairSid(owner: RouterId, adjacency: RouterId): RepairSid {
  const sidHextets = buildSrv6Sid(LOCATOR_HEXTETS4[owner], FUNCTION.END_X);
  return { sidHextets, sidText: fmtIpv6(sidHextets), owner, behavior: "END_X", flavors: ["USD"], adjacency };
}
export function findRepairSidByHextets(state: { repairSids: RepairSid[] }, daHextets: Hextets): RepairSid | undefined {
  return state.repairSids.find((s) => hextetsEqual(s.sidHextets, daHextets));
}

export function precomputeTiLfaRepair(links: LinkDef[], plr: RouterId, destination: RouterId, mode: ProtectionMode, protectedResource: string): TiLfaRepairPath {
  const post = computePostConvergencePath(links, plr, destination, mode, protectedResource);
  const pSpace = computePSpace(links, plr, mode, protectedResource);
  const extendedPSpace = computeExtendedPSpace(links, plr, mode, protectedResource);
  const qSpace = computeQSpace(links, destination, mode, protectedResource);
  const pqCandidates = findPqCandidates(pSpace, qSpace, plr, destination);

  if (!post || post.path.length < 2) {
    return { mode, protectedResource, plr, destination, pSpace, extendedPSpace, qSpace, pqCandidates, repairList: { sids: [] }, strategy: "NO_REPAIR_AVAILABLE" };
  }

  const eligibleSpace = new Set([...pSpace, ...extendedPSpace]);
  let repairNodeIndex = -1;
  for (let i = post.path.length - 2; i >= 1; i--) {
    if (eligibleSpace.has(post.path[i])) {
      repairNodeIndex = i;
      break;
    }
  }
  if (repairNodeIndex === -1) {
    return { mode, protectedResource, plr, destination, postConvergencePath: post.path, postConvergenceCost: post.cost, pSpace, extendedPSpace, qSpace, pqCandidates, repairList: { sids: [] }, strategy: "NO_REPAIR_AVAILABLE" };
  }
  const repairNode = post.path[repairNodeIndex];
  const mergeTarget = post.path[repairNodeIndex + 1];
  const toRepairNode = shortestPath(links, plr, repairNode);
  const outgoingInterface = toRepairNode && toRepairNode.path.length > 1 ? toRepairNode.path[1] : undefined;
  const repairSid = buildRepairSid(repairNode, mergeTarget);

  return {
    mode,
    protectedResource,
    plr,
    destination,
    postConvergencePath: post.path,
    postConvergenceCost: post.cost,
    pSpace,
    extendedPSpace,
    qSpace,
    pqCandidates,
    repairNode,
    mergeTarget,
    outgoingInterface,
    repairList: { sids: [repairSid] },
    strategy: "LAST_P_SPACE_NODE_PLUS_FORCED_ADJACENCY",
  };
}

/** Re-validates an ALREADY-COMPUTED repair against the CURRENT topology — reveals staleness after a change the repair was never recomputed against, or (in the troubleshooting incident) a repair that was simply wrong from the start. */
export function validateRepairPath(repair: TiLfaRepairPath, links: LinkDef[]): { valid: boolean; reason: string } {
  if (repair.strategy === "NO_REPAIR_AVAILABLE" || !repair.repairNode || repair.repairList.sids.length === 0) return { valid: false, reason: "No repair computed." };
  const toRepairNode = shortestPath(links, repair.plr, repair.repairNode);
  if (!toRepairNode) return { valid: false, reason: `${repair.plr} currently has no path to ${repair.repairNode}.` };
  if (!isPathSafe(toRepairNode.path, links, repair.mode, repair.protectedResource)) return { valid: false, reason: `${repair.plr}'s current path to ${repair.repairNode} now traverses the protected resource — stale.` };
  return { valid: true, reason: "Repair path is current and avoids the protected resource end to end." };
}
/** Specifically checks the invariant a wrong/stale repair violates: does the chosen repair genuinely avoid the protected resource, independent of anything else? */
export function validateRepairAvoidsResource(repair: TiLfaRepairPath): boolean {
  if (!repair.postConvergencePath) return false;
  return isPathSafe(repair.postConvergencePath, LINKS, repair.mode, repair.protectedResource);
}

// ---------------------------------------------------------------------------
// Naive-reroute loop — derived from REAL per-router FIB state, never a
// hardcoded `if (fault) loop = true`.
// ---------------------------------------------------------------------------

export interface NaiveHop {
  router: RouterId;
  fib: PreConvergenceFib;
  forwardedTo?: RouterId;
}
/** Simulates sending the ORIGINAL (unrepaired) packet hop by hop using each router's own current (possibly stale) FIB — stops when it reaches the destination, revisits a router (loop), or has no next hop. Caps at `maxHops` purely so a genuine loop terminates the simulation instead of running forever. */
export function simulateNaiveForwarding(links: LinkDef[], destination: RouterId, mode: ProtectionMode, protectedResource: string, failureKnownAt: Partial<Record<RouterId, boolean>>, startAt: RouterId, maxHops = 6): { hops: NaiveHop[]; looped: boolean; delivered: boolean } {
  const hops: NaiveHop[] = [];
  const visited: RouterId[] = [];
  let current = startAt;
  for (let i = 0; i < maxHops; i++) {
    const fib = computePreConvergenceFib(current, destination, links, mode, protectedResource, !!failureKnownAt[current]);
    hops.push({ router: current, fib, forwardedTo: fib.nextHop });
    if (!fib.nextHop) return { hops, looped: false, delivered: false };
    if (fib.nextHop === destination) {
      hops.push({ router: destination, fib: computePreConvergenceFib(destination, destination, links, mode, protectedResource, true) });
      return { hops, looped: false, delivered: true };
    }
    if (visited.includes(fib.nextHop) && visited.includes(current)) return { hops, looped: true, delivered: false };
    visited.push(current);
    current = fib.nextHop;
  }
  return { hops, looped: true, delivered: false };
}

// ---------------------------------------------------------------------------
// H.Encaps repair packet + End.X+USD execution — RFC 8986 semantics: a
// single-SID repair carries NO SRH; USD removes the repair's outer IPv6
// header and extensions (never "only the SRH", which would be USP/PSP
// territory), exposing the original packet, then forces it to the
// specific adjacency. If the exposed payload isn't a supported IP kind,
// falls back to plain End.X semantics instead of magically decapsulating.
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
export interface RepairOuterState {
  srcText: string;
  daHextets: Hextets;
  srh?: SegmentRoutingHeader;
}
/** What a pre-existing (nested) SRv6 outer IS — never inferred from its address. */
export type NestedOuterRole = "L3VPN_SERVICE" | "GLOBAL_DT4_TRANSPORT";
/**
 * A SEPARATE, optional layer representing a pre-existing SRv6 outer that a
 * TI-LFA repair (or a TE steering outer) wraps around whole: an SRv6 L3VPN
 * service outer (DA = a VRF Service SID, e.g. from /demo/srv6-l3vpn) or a
 * generic transport outer (DA = an egress PE's global-table End.DT4 SID).
 * Undefined for the plain infrastructure baseline. The field keeps its
 * historical name; `role` states which of the two it is.
 */
export interface VpnOuterState {
  srcText: string;
  daHextets: Hextets;
  daText: string;
  role: NestedOuterRole;
}
export interface TiLfaPacketState {
  repairOuter?: RepairOuterState; // present only while TI-LFA repair is actively wrapping the packet
  vpnOuter?: VpnOuterState; // present only in the L3VPN integration experiment
  inner?: InnerPayload; // the ultimate customer/infrastructure payload — always plain IP, never carries its own SRv6 SID
}

/** Source of the ORIGINAL protected packet — PE1 (the headend) originates it. Never used as a TI-LFA repair outer source. */
export const PE1_SR_SOURCE = "2001:db8:110:1:0:0:0:c1";
/** Per-node SR source address (`<locator>::c1`) — whichever node performs an H.Encaps owns that outer's source address. */
export function srSourceFor(router: RouterId): string {
  return fmtIpv6([...LOCATOR_HEXTETS4[router], 0, 0, 0, 0xc1]);
}
/** The PLR's own source for every TI-LFA repair outer — P1 performs the H.Encaps, so P1 (not PE1) owns it. */
export const PLR_REPAIR_SOURCE = srSourceFor(PLR);

/** Single-SID repair: no SRH at all — one segment fits entirely in the outer destination address. `srcText` is REQUIRED: it must belong to the node actually performing this H.Encaps (the PLR for TI-LFA repair). */
export function encapsulateRepairSingleSid(repairSid: RepairSid, packet: TiLfaPacketState, srcText: string): TiLfaPacketState {
  return { ...packet, repairOuter: { srcText, daHextets: repairSid.sidHextets } };
}
/** Two-SID repair, for the SRH-education lab only (§57-59) — real reversed-storage-order SRH, Segment List[0] = the FINAL segment. */
export function encapsulateRepairMultiSid(sids: RepairSid[], packet: TiLfaPacketState, srcText: string): TiLfaPacketState {
  const n = sids.length;
  const storageOrder = [...sids].reverse();
  const segmentList: SrhSegment[] = storageOrder.map((s, i) => ({ index: i, sidHextets: s.sidHextets, sidText: s.sidText, ownerRouter: s.owner }));
  const srh: SegmentRoutingHeader = { nextHeader: "IPv6 (H.Encaps repair)", hdrExtLen: n * 2, routingType: 4, segmentsLeft: n - 1, lastEntry: n - 1, flags: "0x00", tag: 0, segmentList };
  return { ...packet, repairOuter: { srcText, daHextets: sids[0].sidHextets, srh } };
}
export function validateFinalRepairPosition(srh?: SegmentRoutingHeader): boolean {
  return !srh || srh.segmentsLeft === 0;
}

export interface EndXUsdOutcome {
  action: "USD_DECAP_FORWARD" | "END_X_ADVANCE_NO_USD" | "DROP";
  exposedPacket?: TiLfaPacketState;
  forwardedTo?: RouterId;
  reason: string;
}
/** RFC 8986 End.X + USD flavor: for a supported exposed IPv4/IPv6 payload, remove the repair outer IPv6 header (and any extensions/SRH) entirely, exposing the packet underneath, then force it onward via the adjacency — never rewriting the exposed packet's own destination. If there is no supported payload to decapsulate, falls back to plain End.X (advance the SRH one segment) rather than inventing a decapsulation that RFC 8986 doesn't define here. */
export function executeEndXUsd(repairSid: RepairSid, packet: TiLfaPacketState): EndXUsdOutcome {
  if (!validateFinalRepairPosition(packet.repairOuter?.srh)) {
    return { action: "DROP", reason: `End.X must be the FINAL repair segment — Segments Left is ${packet.repairOuter?.srh?.segmentsLeft} (must be 0).` };
  }
  const hasUsd = repairSid.flavors.includes("USD");
  const decapsulatable = !!packet.vpnOuter || !!packet.inner;
  if (hasUsd && decapsulatable) {
    const exposed: TiLfaPacketState = { vpnOuter: packet.vpnOuter, inner: packet.inner };
    return { action: "USD_DECAP_FORWARD", exposedPacket: exposed, forwardedTo: repairSid.adjacency, reason: `USD removes the repair outer IPv6 header (and its extensions) entirely, exposing the packet underneath, then forces it to adjacency ${repairSid.adjacency}.` };
  }
  return { action: "END_X_ADVANCE_NO_USD", reason: "No supported exposed IP payload beneath the repair outer — falls back to ordinary End.X semantics (topological advance), not a manufactured decapsulation." };
}

// ---------------------------------------------------------------------------
// Multi-SID / SRH-education lab (§57-59) — a small, separate illustration,
// never touching the main single-SID repair's own state.
// ---------------------------------------------------------------------------

export const MULTI_SID_INTERMEDIATE = buildRepairSid("P3", "P4"); // S1: a second, illustrative End.X+USD hop
export const MULTI_SID_FINAL = buildRepairSid("P4", "P2"); // S2 / final segment
export function buildMultiSidIllustration(): { sids: RepairSid[]; srh: SegmentRoutingHeader; outerDaHextets: Hextets } {
  const sids = [MULTI_SID_INTERMEDIATE, MULTI_SID_FINAL];
  const pkt = encapsulateRepairMultiSid(sids, {}, PLR_REPAIR_SOURCE);
  return { sids, srh: pkt.repairOuter!.srh!, outerDaHextets: pkt.repairOuter!.daHextets };
}

// ---------------------------------------------------------------------------
// SRv6 L3VPN nested-repair integration (§46-49) — TI-LFA wraps the ENTIRE
// pre-existing SRv6 VPN packet (outer DA = PE2 End.DT4) inside a further
// repair outer. P4 removes ONLY the repair outer; the VPN outer survives
// completely intact, and PE2 (not P4) is what later executes End.DT4.
// ---------------------------------------------------------------------------

/** `vpnSrcText` must belong to the INGRESS PE (PE1) that built this VPN packet — never the egress PE2. */
export function buildNestedVpnServicePacket(inner: InnerPayload, vpnSrcText: string): TiLfaPacketState {
  return { vpnOuter: { srcText: vpnSrcText, daHextets: PE2_DT4_SID.sidHextets, daText: PE2_DT4_SID.sidText, role: "L3VPN_SERVICE" }, inner };
}

// ---------------------------------------------------------------------------
// TI-LFA lifecycle (§9) — a PacketVerse teaching abstraction, not an
// official protocol FSM, mirroring srTiLfa.ts's own lifecycle in shape.
// No hardcoded restoration-time guarantee is ever stated.
// ---------------------------------------------------------------------------

export type TiLfaPhase = "STEADY_STATE" | "LOCAL_FAILURE_DETECTED" | "TI_LFA_ACTIVE" | "IGP_CONVERGING" | "PLR_CONVERGED" | "POST_CONVERGENCE";
export const TI_LFA_PHASE_ORDER: TiLfaPhase[] = ["STEADY_STATE", "LOCAL_FAILURE_DETECTED", "TI_LFA_ACTIVE", "IGP_CONVERGING", "PLR_CONVERGED", "POST_CONVERGENCE"];
export const TI_LFA_PHASE_INFO: Record<TiLfaPhase, string> = {
  STEADY_STATE: "Primary path active; the repair is precomputed and installed, carrying no traffic.",
  LOCAL_FAILURE_DETECTED: "P1 has detected the protected resource is gone via local interface-down detection — immediately, without IGP flooding.",
  TI_LFA_ACTIVE: "P1 is actively wrapping protected traffic in the precomputed repair program. This is temporary local repair, not a claim of any fixed restoration time.",
  IGP_CONVERGING: "IGP is flooding the failure network-wide; every router is recomputing SPF — a separate, distributed process running on its own timeline.",
  PLR_CONVERGED: "P1 itself has now converged — its own ordinary FIB toward the destination already avoids the protected resource, with no repair needed.",
  POST_CONVERGENCE: "Repair encapsulation has been released. Ordinary, fully-converged forwarding now carries traffic; TI-LFA did its job and stepped aside.",
};

// ---------------------------------------------------------------------------
// Packet visuals
// ---------------------------------------------------------------------------

function repairOuterLayer(o: RepairOuterState): PacketLayer {
  return { name: "TI-LFA Repair Outer IPv6", color: "var(--pv-proto-ipv6)", fields: [{ label: "Source Address", value: o.srcText }, { label: "Destination Address (repair SID)", value: fmtIpv6(o.daHextets) }] };
}
function repairSrhLayer(srh: SegmentRoutingHeader): PacketLayer {
  return { name: `Repair SRH (SL=${srh.segmentsLeft}, LE=${srh.lastEntry})`, color: "var(--pv-proto-srh)", fields: [{ label: "Segments Left", value: String(srh.segmentsLeft) }, { label: "Last Entry", value: String(srh.lastEntry) }, ...srh.segmentList.map((s) => ({ label: `Segment List[${s.index}]`, value: `${s.sidText} (${s.ownerRouter})` }))] };
}
function vpnOuterLayer(o: VpnOuterState): PacketLayer {
  if (o.role === "GLOBAL_DT4_TRANSPORT") return { name: "SRv6 Transport Outer IPv6 (pre-existing)", color: "var(--pv-proto-ipv6)", fields: [{ label: "Source Address", value: o.srcText }, { label: "Destination Address (global-table End.DT4 SID)", value: o.daText }] };
  return { name: "SRv6 L3VPN Outer IPv6 (pre-existing)", color: "var(--pv-proto-ipv6)", fields: [{ label: "Source Address", value: o.srcText }, { label: "Destination Address (Service SID)", value: o.daText }] };
}
function innerLayer(inner: InnerPayload): PacketLayer {
  if (inner.kind === "IPV4") return { name: "Inner IPv4 Packet", color: "var(--pv-proto-ip)", fields: [{ label: "Source IP", value: inner.srcIp }, { label: "Destination IP", value: inner.dstIp }] };
  if (inner.kind === "IPV6") return { name: "Inner IPv6 Packet", color: "var(--pv-proto-ipv6)", fields: [{ label: "Source Address", value: fmtIpv6(inner.srcHextets) }, { label: "Destination Address", value: fmtIpv6(inner.dstHextets) }] };
  return { name: "Inner Ethernet Frame", color: "var(--pv-border-strong)", fields: [{ label: "Source MAC", value: inner.srcMac }, { label: "Destination MAC", value: inner.dstMac }] };
}
export function buildTiLfaPacketLayers(pkt: TiLfaPacketState): PacketLayer[] {
  return [...(pkt.repairOuter ? [repairOuterLayer(pkt.repairOuter), ...(pkt.repairOuter.srh ? [repairSrhLayer(pkt.repairOuter.srh)] : [])] : []), ...(pkt.vpnOuter ? [vpnOuterLayer(pkt.vpnOuter)] : []), ...(pkt.inner ? [innerLayer(pkt.inner)] : [])];
}
function tiLfaPacket(id: string, from: RouterId, to: RouterId, summary: string, badge: string, pkt: TiLfaPacketState): PacketVisual {
  return { id, protocol: "IPV6", from, to, summary, badge, layers: buildTiLfaPacketLayers(pkt) };
}
function plainIpv6Packet(id: string, from: RouterId, to: RouterId, summary: string, srcText: string, dstText: string): PacketVisual {
  return { id, protocol: "IPV6", from, to, summary, layers: [{ name: "IPv6", color: "var(--pv-proto-ipv6)", fields: [{ label: "Source Address", value: srcText }, { label: "Destination Address", value: dstText }] }] };
}

// ---------------------------------------------------------------------------
// Journey / top-level state
// ---------------------------------------------------------------------------

export type TiLfaAction = "IPV6_FIB_FORWARD" | "LOCAL_FAILURE_DETECT" | "REPAIR_ENCAPSULATE" | "REPAIR_FORWARD" | "LOCAL_SID_MATCH" | "USD_DECAP" | "FORCED_ADJACENCY" | "NAIVE_FORWARD" | "LOOP" | "DELIVER" | "DROP";
export interface JourneyHop {
  router: RouterId;
  input: string;
  lookup: string;
  action: TiLfaAction;
  output: string;
}
export interface TroubleshootingState {
  started: boolean;
  verified: boolean;
}
export interface Srv6TiLfaState {
  links: LinkDef[];
  failedLinkIds: LinkId[];
  failedNode?: RouterId;
  failureKnownAt: Partial<Record<RouterId, boolean>>;
  phase: TiLfaPhase;
  linkRepair?: TiLfaRepairPath;
  nodeRepair?: TiLfaRepairPath;
  activeMode?: ProtectionMode;
  packet?: TiLfaPacketState;
  packetAt?: RouterId;
  journey: JourneyHop[];
  naiveDemo?: { hops: NaiveHop[]; looped: boolean };
  troubleshooting: TroubleshootingState;
  repairAttempt?: { choice: string; correct: boolean };
}

export function createSrv6TiLfaState(): Srv6TiLfaState {
  return {
    links: LINKS,
    failedLinkIds: [],
    failureKnownAt: {},
    phase: "STEADY_STATE",
    journey: [],
    troubleshooting: { started: false, verified: false },
  };
}

// ---------------------------------------------------------------------------
// Scenario steps
// ---------------------------------------------------------------------------

function baselinePacket(): TiLfaPacketState {
  return { inner: { kind: "IPV6", srcHextets: [0x2001, 0x0db8, 0x0110, 0x0001, 0, 0, 0, 0xc1], dstHextets: INFRA_ADDRESS.PE2 } };
}

export const srv6TiLfaSteps: ScenarioStep<Srv6TiLfaState>[] = [
  // --- A. Intro / terminology -------------------------------------------------
  {
    id: "intro",
    label: "The Central Question",
    narrative: "PE1 → P1 → P2 → PE2 is the primary path. If P1-P2 fails, does P1 have to wait until every router finishes IGP convergence before restoring traffic? No — P1 can perform local fast repair using a precomputed TI-LFA repair path, without waiting for the headend, P3, P4, or anyone else to converge first.",
  },
  {
    id: "predict-plr-wait",
    label: "Predict",
    narrative: "Before going further:",
    question: {
      prompt: "After P1-P2 fails, must P1 wait for full IGP convergence before restoring traffic?",
      options: [
        { id: "no", label: "No — P1 can activate a precomputed local repair immediately" },
        { id: "yes", label: "Yes — nothing can be forwarded until every router reconverges" },
        { id: "only-pe1", label: "Only PE1 can decide to reroute" },
        { id: "only-destination", label: "Only PE2 can decide to reroute" },
      ],
      correctOptionId: "no",
      explanation: "This is the whole point of TI-LFA: local repair at the PLR, activated the instant a local failure is detected — IGP convergence is a separate, slower, global process running in parallel.",
    },
  },
  {
    id: "terminology-plr",
    label: "PLR: Point of Local Repair",
    narrative: `PLR = the router directly upstream of the protected failure that activates FRR. In this lesson's main scenario, PLR = ${PLR}, protected resource = link ${PROTECTED_LINK}, destination = ${DESTINATION}.`,
  },
  {
    id: "ti-accuracy",
    label: '"Topology Independent" — Accuracy Check',
    narrative: "\"Topology Independent\" does NOT mean TI-LFA needs no topology information — it absolutely uses the link-state topology/LSDB, exactly like classic LFA. \"TI\" means the repair isn't limited to whichever single adjacent backup next hop happens to be available (classic LFA) — SR repair encoding provides loop-free coverage across a much wider set of topologies.",
  },
  {
    id: "predict-ti-meaning",
    label: "Predict",
    narrative: "Confirm this before moving on.",
    question: {
      prompt: 'Does "Topology Independent" mean TI-LFA does not use LSDB/topology information?',
      options: [
        { id: "no", label: "No — it still uses the same link-state topology as everything else" },
        { id: "yes", label: "Yes — TI-LFA computes repairs without any topology data" },
        { id: "partial", label: "It uses topology only for node protection, not link protection" },
        { id: "depends", label: "Only true for SRv6, not SR-MPLS" },
      ],
      correctOptionId: "no",
      explanation: "\"TI\" refers to providing loop-free repair coverage across suitable topologies through SR repair encoding, rather than being limited to a directly available classic LFA — not to ignoring topology.",
    },
  },

  // --- B. Topology / metrics --------------------------------------------------
  {
    id: "topology-intro",
    label: "Topology",
    narrative: `PE1─P1─P2─PE2 is the primary chain. P1 also connects to P3, which connects to P4, which connects to BOTH P2 and PE2 directly — this gives P1 a genuine alternate physical path that doesn't depend on the primary at all.`,
  },
  {
    id: "metrics-recap",
    label: "Metrics",
    narrative: "PE1-P1=10, P1-P2=10, P2-PE2=10 (primary, cost 30). P1-P3=10, P3-P4=10, P4-P2=50, P4-PE2=70 — deliberately asymmetric so the primary is clearly cheapest, and so P4's two exits toward PE2 (via P2, or direct) cost differently.",
  },
  {
    id: "predict-shortest-path",
    label: "Predict",
    narrative: "Before failure:",
    question: {
      prompt: "Given these metrics, what is PE1's current shortest path to PE2?",
      options: [
        { id: "primary", label: "PE1 → P1 → P2 → PE2 (cost 30)" },
        { id: "via-p3", label: "PE1 → P1 → P3 → P4 → P2 → PE2 (cost 80)" },
        { id: "equal", label: "Both paths are equal-cost" },
        { id: "via-p4-direct", label: "PE1 → P1 → P3 → P4 → PE2 (cost 90)" },
      ],
      correctOptionId: "primary",
      explanation: "30 is clearly cheapest. The P3/P4 side is the protection topology this whole lesson uses — not part of the primary path.",
    },
  },

  // --- C. Why naive reroute is dangerous --------------------------------------
  {
    id: "p3-pre-failure-route",
    label: "P3's Own Route To PE2 (Before Any Failure)",
    narrative: "Before anything fails, compute P3's own shortest path to PE2: via P1 (P3-P1-P2-PE2 = 10+10+10 = 30) beats via P4 (P3-P4-P2-PE2 = 10+50+10 = 70). So P3's FIB currently points toward P1 for PE2 — completely correctly, right now.",
    run: (state) => {
      const fib = computePreConvergenceFib("P3", "PE2", state.links, "LINK", "P1-P2", false);
      return { state, events: [{ type: "OSPF_SPF_COMPLETED", stepId: "p3-pre-failure-route", timestamp: Date.now(), message: `P3→PE2 pre-failure: next hop ${fib.nextHop}, cost ${fib.cost}` }] };
    },
  },
  {
    id: "predict-p3-route",
    label: "Predict",
    narrative: "Hold onto this fact — it's about to matter a lot.",
    question: {
      prompt: "Right now, before any failure, which router does P3's FIB point to for reaching PE2?",
      options: [
        { id: "p1", label: "P1 — cost 30 beats the 70-cost path via P4" },
        { id: "p4", label: "P4 — it's P3's only other neighbor" },
        { id: "pe2-direct", label: "PE2 directly — P3 has no direct link to PE2" },
        { id: "both", label: "Load-balanced between P1 and P4" },
      ],
      correctOptionId: "p1",
      explanation: "P3-P1-P2-PE2 (cost 30) beats P3-P4-P2-PE2 (cost 70). P3's FIB entry for PE2 points to P1 — this stays true until P3 itself learns about any relevant failure.",
    },
  },
  {
    id: "naive-fail-injected",
    label: "P1-P2 Fails",
    narrative: `The ${PROTECTED_LINK} link fails. P1 detects it immediately (local interface-down). P3 and P4 do NOT know yet — their FIBs are unchanged.`,
    run: (state) => ({ state: { ...state, failedLinkIds: [PROTECTED_LINK], failureKnownAt: { P1: true }, phase: "LOCAL_FAILURE_DETECTED" }, events: [{ type: "OSPF_COST_CHANGED", stepId: "naive-fail-injected", timestamp: Date.now(), message: `${PROTECTED_LINK} down — P1 knows, P3/P4 do not` }] }),
    whatChanged: () => [`${PROTECTED_LINK}: UP → DOWN`, "P1: knows failure. P3: does NOT know. P4: does NOT know."],
  },
  {
    id: "naive-forward-p1-p3",
    label: "Naive: P1 Just Sends It To P3",
    narrative: "Imagine P1 has no repair program at all — just its own newly-recomputed next hop toward PE2 (P1's OWN post-failure shortest path is via P3), and it sends the ORIGINAL, unmodified packet (still DA=PE2) there.",
    packet: () => plainIpv6Packet("naive-1", "P1", "P3", "Original packet, unmodified DA=PE2", PE1_SR_SOURCE, INFRA_ADDRESS_TEXT.PE2),
    run: (state) => {
      const naive = simulateNaiveForwarding(state.links, "PE2", "LINK", "P1-P2", { P1: true }, "P1", 4);
      const journey = naive.hops.slice(0, -1).map((h) => ({ router: h.router, input: `IPv6, DA=${INFRA_ADDRESS_TEXT.PE2}`, lookup: `${h.fib.knowsFailure ? "post-failure" : "STALE pre-failure"} FIB → next hop ${h.forwardedTo}`, action: "NAIVE_FORWARD" as TiLfaAction, output: `forwarded to ${h.forwardedTo}` }));
      return { state: { ...state, naiveDemo: { hops: naive.hops, looped: naive.looped }, journey, packetAt: "P3" }, events: [{ type: "PACKET_SENT", stepId: "naive-forward-p1-p3", timestamp: Date.now(), message: "P1 naively forwards the original packet to P3" }] };
    },
  },
  {
    id: "naive-p3-stale-fib",
    label: "P3: Stale FIB",
    narrative: "P3 has NOT learned of the failure. Its FIB for PE2 still says \"via P1\" — the SAME entry computed before any failure. P3 forwards the packet right back to P1.",
    packet: () => plainIpv6Packet("naive-2", "P3", "P1", "Original packet, still DA=PE2", PE1_SR_SOURCE, INFRA_ADDRESS_TEXT.PE2),
    run: (state) => ({ state: { ...state, packetAt: "P1" }, events: [{ type: "PACKET_SENT", stepId: "naive-p3-stale-fib", timestamp: Date.now(), message: "P3's stale FIB sends the packet back to P1" }] }),
  },
  {
    id: "naive-loop-p3-p1",
    label: "TRANSIENT FORWARDING LOOP",
    narrative: "P1 → P3 → P1 → P3 … P1 still has no repair program, so it sends the SAME packet to P3 again. P3's FIB is still stale. This is a genuine transient forwarding loop, derived from real (if naive) per-router forwarding state — not a scripted animation.",
    whatChanged: () => ["Naive redirect (no repair program): P1 → P3 → P1 → P3 … LOOP — this is exactly what TI-LFA's repair encoding exists to prevent"],
  },
  {
    id: "predict-naive-loop",
    label: "Predict",
    narrative: "Before the fix:",
    question: {
      prompt: "Why can simply sending PE2-bound traffic from P1 to P3 (with no repair encoding) loop?",
      options: [
        { id: "stale-fib", label: "P3 may still have a pre-convergence route back through P1" },
        { id: "p3-broken", label: "P3's hardware is broken" },
        { id: "wrong-metric", label: "The P1-P3 metric is misconfigured" },
        { id: "cant-loop", label: "It can't loop — IPv6 prevents this automatically" },
      ],
      correctOptionId: "stale-fib",
      explanation: "P3 hasn't converged yet. Its FIB entry for PE2 was computed before the failure and still says \"via P1\" — sending the ORIGINAL packet there, with nothing telling P3 to do anything different, bounces it straight back.",
    },
  },
  {
    id: "naive-loop-explained",
    label: "Why This Is The Motivation For A Repair Program",
    narrative: "The problem isn't reaching P3 — it's what P3 does with a packet still addressed to PE2 while P3 hasn't converged. TI-LFA's answer: don't send the ORIGINAL destination. Send a repair-specific instruction that P3 cannot misinterpret using its stale FIB.",
  },

  // --- D. Pre- vs post-convergence, restore for TI-LFA build -----------------
  {
    id: "restore-for-tilfa",
    label: "Restore: Build Protection First",
    narrative: "P1-P2 is restored. For the rest of this lesson, TI-LFA protection is precomputed BEFORE any failure — exactly the point of local repair.",
    run: (state) => ({ state: { ...state, failedLinkIds: [], failureKnownAt: {}, phase: "STEADY_STATE", naiveDemo: undefined, journey: [], packetAt: undefined }, events: [] }),
  },
  {
    id: "post-convergence-intro",
    label: "Pre-Convergence vs. Post-Convergence",
    narrative: "OLD/PRE-CONVERGENCE FIB is what every router currently believes. EXPECTED POST-CONVERGENCE TOPOLOGY is what SPF will settle on once every router has actually reconverged around the failure — computed by removing the protected resource from the graph and rerunning SPF, never hardcoded.",
  },
  {
    id: "post-convergence-compute",
    label: "Computed: Post-Convergence Path",
    narrative: "Derived from the domain layer with P1-P2 genuinely removed from the graph.",
    run: (state) => {
      const post = computePostConvergencePath(state.links, PLR, DESTINATION, "LINK", PROTECTED_LINK);
      return { state, events: [{ type: "OSPF_SPF_COMPLETED", stepId: "post-convergence-compute", timestamp: Date.now(), message: `Post-convergence P1→PE2: ${post?.path.join(" → ")} (cost ${post?.cost})` }] };
    },
  },

  // --- E. Timing phases + precompute vs activate ------------------------------
  {
    id: "phases-intro",
    label: "TI-LFA Timing Phases",
    narrative: "STEADY_STATE → LOCAL_FAILURE_DETECTED → TI_LFA_ACTIVE → IGP_CONVERGING → PLR_CONVERGED → POST_CONVERGENCE. TI-LFA is TEMPORARY local repair — not a permanent replacement for IGP convergence, and this lesson makes no hardcoded restoration-time guarantee (no \"50ms\" claim). It's fast local repair; actual timing depends on failure detection and implementation.",
  },
  {
    id: "precompute-intro",
    label: "Precompute, Then Activate — Never The Reverse",
    narrative: "Before any failure, P1 already has: primary next hop, protected resource, backup outgoing interface, and repair list — all installed. Failure activation does not perform the whole topology computation for the first time; it just applies what's already there.",
  },

  // --- F. Repair anatomy -------------------------------------------------------
  {
    id: "repair-anatomy-intro",
    label: "Repair Path = Outgoing Interface + Repair List",
    narrative: `A TI-LFA repair path is never only a SID list. It has TWO parts: OUTGOING INTERFACE (P1 → P3) and REPAIR LIST (one SRv6 repair SID: P4 End.X+USD, adjacency = P4→P2).`,
  },
  {
    id: "why-p4-endx",
    label: "Why P4 End.X — Not Destination PE2",
    narrative: "The expected post-convergence route is P1 → P3 → P4 → P2 → PE2. P3 must NOT be allowed to route using destination PE2 — its stale FIB points back to P1. So the repair packet's DA becomes P4's End.X repair SID instead: P3 simply forwards toward P4's locator using ordinary IPv6 reachability, with no idea a repair is even happening.",
  },
  {
    id: "globally-routed-adjacency",
    label: "Globally Routed SRv6 Adjacency SID",
    narrative: `P4's End.X SID (adjacency = P2) is instantiated at ${INFRA_ADDRESS_TEXT.P4.replace("::", "")}-style locator space and is GLOBALLY reachable — any router with ordinary IPv6 reachability to P4 can route to it directly. SR-MPLS would typically need Node-SID(P4) + Adj-SID(P4→P2) as two separate label operations; SRv6's End.X can encode the same repair instruction as ONE globally-routed SID. This lesson never automatically prepends a separate P4 End (node) SID first — the End.X SID alone is sufficient and is exactly what's used.`,
  },

  // --- G. USD ------------------------------------------------------------------
  {
    id: "usd-intro",
    label: "USD: Ultimate Segment Decapsulation",
    narrative: "End.X + USD, at P4: the repair outer IPv6 reaches P4's End.X+USD SID → remove the repair outer IPv6 header and its extensions entirely → expose the original packet underneath → forward the exposed packet to adjacency J = P2. This is NOT USP, NOT PSP, and NOT MPLS PHP.",
  },
  {
    id: "predict-usd",
    label: "Predict",
    narrative: "Be precise about what USD actually removes.",
    question: {
      prompt: "What does USD remove?",
      options: [
        { id: "outer", label: "The repair's outer IPv6 header and its extensions, exposing the inner IP packet" },
        { id: "srh-only", label: "Only the Segment Routing Header, leaving the outer IPv6 header intact (this is USP)" },
        { id: "penultimate", label: "The label at the penultimate hop (this is MPLS PHP)" },
        { id: "nothing", label: "Nothing — USD only updates a counter" },
      ],
      correctOptionId: "outer",
      explanation: "USD removes the entire outer IPv6 encapsulation and its extension headers, exposing the packet underneath — not just the SRH (that's USP) and not merely the penultimate label pop (that's MPLS PHP, an entirely different data plane).",
    },
  },

  // --- H. Baseline packet ------------------------------------------------------
  {
    id: "baseline-packet-intro",
    label: "The Baseline Packet",
    narrative: `Source: PE1 infrastructure address. Destination: PE2 infrastructure address. [IPv6] PE1 → PE2 — no SRH. Normal journey: PE1 → P1 → P2 → PE2.`,
    packet: () => plainIpv6Packet("baseline", "PE1", "P1", "Plain infrastructure IPv6, no SRH", PE1_SR_SOURCE, INFRA_ADDRESS_TEXT.PE2),
    run: (state) => ({ state: { ...state, packet: baselinePacket(), packetAt: "P1", journey: [] }, events: [{ type: "PACKET_SENT", stepId: "baseline-packet-intro", timestamp: Date.now(), message: "PE1 sends plain IPv6 toward PE2" }] }),
  },

  // --- I. P-Space / Extended P-Space / Q-Space --------------------------------
  {
    id: "p-space-intro",
    label: "P-Space",
    narrative: "P-Space: a node belongs to P-Space only if the PLR's OWN pre-convergence shortest path to it already avoids the protected resource. Never \"merely physically reachable without the failed link.\"",
  },
  {
    id: "p-space-compute",
    label: "Computed: P-Space(P1)",
    narrative: "Derived, not hand-picked.",
    run: (state) => {
      const pSpace = computePSpace(state.links, PLR, "LINK", PROTECTED_LINK);
      return { state, events: [{ type: "OSPF_SPF_COMPLETED", stepId: "p-space-compute", timestamp: Date.now(), message: `P-Space(P1): ${pSpace.join(", ")}` }] };
    },
  },
  {
    id: "extended-p-space-intro",
    label: "Extended P-Space",
    narrative: "Extended P-Space widens P-Space using each ELIGIBLE neighbor of the PLR's own shortest-path tree — a neighbor only reachable by crossing the protected resource is not eligible.",
  },
  {
    id: "extended-p-space-compute",
    label: "Computed: Extended P-Space(P1)",
    narrative: "In THIS topology, extended P-Space adds no members beyond base P-Space — P4 is already directly reachable via P1's own unconstrained shortest path (P1→P3→P4). Extended P-Space matters in topologies where the PLR's own tie-break misses a neighbor-safe node; it's computed for real here either way.",
    run: (state) => {
      const ext = computeExtendedPSpace(state.links, PLR, "LINK", PROTECTED_LINK);
      return { state, events: [{ type: "OSPF_SPF_COMPLETED", stepId: "extended-p-space-compute", timestamp: Date.now(), message: `Extended P-Space(P1): ${ext.join(", ")}` }] };
    },
  },
  {
    id: "q-space-intro",
    label: "Q-Space",
    narrative: "Q-Space: nodes from which destination PE2 can be reached using PRE-CONVERGENCE shortest paths without traversing the protected resource. Not the same as post-convergence reachability — Q-Space asks whether that node's CURRENT best path already happens to be safe.",
  },
  {
    id: "q-space-compute",
    label: "Computed: Q-Space(PE2)",
    narrative: "A genuinely interesting result: P3's current best path to PE2 (cost 30, via P1) crosses the protected link, so P3 is excluded. P4's current best path (cost 40, via P3→P1→P2→PE2 — routing backward through P1 to reach the cheap segment) ALSO crosses it, so P4 is excluded too. Only P2 itself, with its own direct link to PE2, qualifies.",
    run: (state) => {
      const qSpace = computeQSpace(state.links, DESTINATION, "LINK", PROTECTED_LINK);
      return { state, events: [{ type: "OSPF_SPF_COMPLETED", stepId: "q-space-compute", timestamp: Date.now(), message: `Q-Space(PE2): ${qSpace.join(", ") || "(empty)"}` }] };
    },
  },

  // --- J. Select P/Q + derive repair list -------------------------------------
  {
    id: "select-repair-node",
    label: "Selecting The Repair Node",
    narrative: "PacketVerse's documented strategy (not an RFC-mandated universal algorithm): walk the post-convergence path from the PLR; the LAST node still in P-Space (or extended P-Space) is the repair node; the very next node on that same path becomes the forced adjacency target. This never depends on that node's own potentially-stale downstream forwarding.",
    run: (state) => {
      const repair = precomputeTiLfaRepair(state.links, PLR, DESTINATION, "LINK", PROTECTED_LINK);
      return { state: { ...state, linkRepair: repair }, events: [{ type: "OSPF_SPF_COMPLETED", stepId: "select-repair-node", timestamp: Date.now(), message: `Repair node: ${repair.repairNode}, merge target: ${repair.mergeTarget}` }] };
    },
    whatChanged: (_, next) => [`Repair node selected: ${next.linkRepair?.repairNode}`, `Forced adjacency target: ${next.linkRepair?.mergeTarget}`],
  },
  {
    id: "repair-list-derive",
    label: "Deriving The Repair List",
    narrative: "Outgoing interface: P1 → P3 (ordinary IPv6 reachability toward P4's locator — no SID needed for this leg at all). Repair list: <P4 End.X+USD → P2> — one SID, because the globally-routed End.X SID already expresses the full required instruction. No separate P4 End (Node) SID is prepended.",
  },

  // --- L. H.Encaps repair packet -----------------------------------------------
  {
    id: "h-encaps-intro",
    label: "TI-LFA H.Encaps",
    narrative: `When P1 detects the P1-P2 failure, the original packet is steered into the repair program using H.Encaps: OUTER IPv6 (SA = P1's own SR source ${PLR_REPAIR_SOURCE}, DA = P4 End.X+USD repair SID) wrapping the INNER original PE1→PE2 packet — whose own source is still PE1 — completely unmodified.`,
  },
  {
    id: "predict-no-srh",
    label: "Predict",
    narrative: "The repair list contains only <P4 End.X+USD → P2>.",
    question: {
      prompt: "Does this single-SID repair require a Segment Routing Header?",
      options: [
        { id: "no", label: "No — one segment fits entirely in the destination address; SRH isn't mandatory just because it's SRv6" },
        { id: "yes", label: "Yes — every SRv6 repair must carry an SRH" },
        { id: "only-node", label: "Only for node protection, not link protection" },
        { id: "only-usd", label: "Only because USD requires an SRH to signal decapsulation" },
      ],
      correctOptionId: "no",
      explanation: "A single-SID repair needs no segment list — the DA alone carries it. SRH becomes necessary only once a repair genuinely needs more than one segment (the separate multi-SID lab later in this lesson).",
    },
  },
  {
    id: "protection-ready",
    label: "Protection READY",
    narrative: "Outgoing interface, repair list, and validation are all precomputed and installed. Primary traffic still uses PE1 → P1 → P2 → PE2 — READY means precomputed, not active.",
    run: (state) => ({ state: { ...state, phase: "STEADY_STATE" }, events: [] }),
  },

  // --- N. Activation -------------------------------------------------------------
  {
    id: "trigger-failure",
    label: "P1-P2 LINK DOWN",
    narrative: "The protected link fails for real, with protection already precomputed. P3 and P4 do not yet know.",
    run: (state) => ({ state: { ...state, failedLinkIds: [PROTECTED_LINK], failureKnownAt: { P1: true }, phase: "LOCAL_FAILURE_DETECTED" }, events: [{ type: "OSPF_COST_CHANGED", stepId: "trigger-failure", timestamp: Date.now(), message: "P1-P2 down" }] }),
    whatChanged: () => ["P1-P2: UP → DOWN", "P1: knows. P3: does not know yet. P4: does not know yet."],
  },
  {
    id: "p1-detects",
    label: "P1 Detects Locally",
    narrative: "Local interface-down detection at P1 — immediate, no IGP flooding required.",
  },
  {
    id: "p1-activates-repair",
    label: "P1 Activates The Precomputed Repair",
    narrative: "No new computation happens here — the repair path was already derived. P1 immediately begins wrapping protected traffic.",
    run: (state) => ({ state: { ...state, phase: "TI_LFA_ACTIVE", activeMode: "LINK" }, events: [{ type: "SRV6_LOCATOR_WITHDRAWN", stepId: "p1-activates-repair", timestamp: Date.now(), message: "TI-LFA local repair ACTIVE at P1" }] }),
  },
  {
    id: "p1-encaps-packet",
    label: "P1: H.Encaps The Repair",
    narrative: "P1 builds the repair outer: DA = P4 End.X+USD SID. No SRH — a single repair SID needs none. The original packet survives completely unmodified underneath.",
    packet: (state) => (state.packet?.repairOuter ? tiLfaPacket("repair-encap", "P1", "P3", "Repair outer added, original packet preserved", "H.Encaps", state.packet) : undefined),
    run: (state) => {
      const sid = state.linkRepair?.repairList.sids[0];
      if (!sid) return { state, events: [] };
      const pkt = encapsulateRepairSingleSid(sid, baselinePacket(), PLR_REPAIR_SOURCE);
      const journey = [...state.journey, { router: "P1" as RouterId, input: "IPv6 (VRF-free, primary next hop down)", lookup: `Repair outgoing interface P1→${state.linkRepair!.outgoingInterface}; repair SID ${sid.sidText}`, action: "REPAIR_ENCAPSULATE" as TiLfaAction, output: "Repair outer added" }];
      return { state: { ...state, packet: pkt, packetAt: state.linkRepair!.outgoingInterface, journey }, events: [{ type: "SRV6_VPN_PACKET_ENCAPSULATED", stepId: "p1-encaps-packet", timestamp: Date.now(), message: "P1 H.Encaps the repair" }] };
    },
    whatChanged: () => ["Packet: [IPv6, DA=PE2] → [Repair Outer DA=P4 End.X+USD][IPv6, DA=PE2] — no SRH"],
  },

  // --- O. Transit ---------------------------------------------------------------
  {
    id: "p3-transit-repair",
    label: "P3: Ordinary Transit",
    narrative: "P3 receives an IPv6 packet whose DA falls inside P4's locator. P3 has no idea this is a repair — it just forwards toward P4 using its own ordinary IPv6 FIB, completely unaware of TI-LFA, the failure, or anything else.",
    packet: (state) => (state.packet ? tiLfaPacket("p3-transit", "P3", "P4", "Ordinary IPv6 forwarding toward P4's locator", "FORWARD", state.packet) : undefined),
    run: (state) => {
      const journey = [...state.journey, { router: "P3" as RouterId, input: "Repair outer IPv6", lookup: "Ordinary IPv6 FIB → toward P4's locator", action: "IPV6_FIB_FORWARD" as TiLfaAction, output: "Forwarded toward P4" }];
      return { state: { ...state, packetAt: "P4", journey }, events: [] };
    },
  },
  {
    id: "predict-p-routers",
    label: "Predict",
    narrative: "P3 just forwarded a repair packet without knowing anything about the repair.",
    question: {
      prompt: "Is P3 required to know anything about TI-LFA, the failure, or the repair computation to forward this packet correctly?",
      options: [
        { id: "no", label: "No — P3 just does ordinary IPv6 forwarding on the outer destination" },
        { id: "yes", label: "Yes — every transit router must run the same TI-LFA computation" },
        { id: "partial", label: "Only P3 needs to know, not P4" },
        { id: "only-node-protect", label: "Only true for node protection" },
      ],
      correctOptionId: "no",
      explanation: "This is exactly why the repair SID is globally routed — any transit router forwards on the outer IPv6 destination using ordinary reachability, with zero TI-LFA-specific knowledge required.",
    },
  },
  {
    id: "p4-endx-usd-execute",
    label: "P4: Local SID Match — End.X+USD",
    narrative: "P4 receives the packet with DA matching its own End.X+USD SID. Local SID Table match: behavior End.X, flavor USD, adjacency P2.",
    run: (state) => {
      const journey = [...state.journey, { router: "P4" as RouterId, input: "Repair outer IPv6, DA=P4 End.X+USD", lookup: "Local SID Table match", action: "LOCAL_SID_MATCH" as TiLfaAction, output: "End.X+USD selected" }];
      return { state: { ...state, journey }, events: [] };
    },
  },
  {
    id: "p4-usd-decap",
    label: "P4: USD Removes The Repair Outer",
    narrative: "USD strips the entire repair outer IPv6 header, exposing the original PE1→PE2 packet completely intact underneath — then forces it to adjacency J = P2, never rewriting the exposed packet's own destination.",
    // run() already executed End.X+USD — show its stored result (repair outer removed, forced toward P2).
    packet: (state) => (state.packet && !state.packet.repairOuter ? tiLfaPacket("p4-usd", "P4", "P2", "Repair outer removed — original packet restored", "USD DECAP", state.packet) : undefined),
    run: (state) => {
      const sid = state.linkRepair?.repairList.sids[0];
      if (!sid || !state.packet) return { state, events: [] };
      const outcome = executeEndXUsd(sid, state.packet);
      const journey = [...state.journey, { router: "P4" as RouterId, input: "Repair outer + original IPv6", lookup: "End.X+USD: remove repair outer, force adjacency P2", action: "USD_DECAP" as TiLfaAction, output: outcome.reason }];
      return { state: { ...state, packet: outcome.exposedPacket ?? state.packet, packetAt: "P2", journey }, events: [{ type: "SRV6_SERVICE_SID_RESOLVED", stepId: "p4-usd-decap", timestamp: Date.now(), message: "P4 executes End.X+USD" }] };
    },
    whatChanged: () => ["Packet: [Repair Outer][IPv6, DA=PE2] → [IPv6, DA=PE2] — repair outer fully removed, original packet unmodified, forced to P2"],
  },
  {
    id: "p2-normal-forward",
    label: "P2: Ordinary Forwarding",
    narrative: "P2 is completely healthy — only the P1-P2 LINK failed. P2 receives an ordinary IPv6 packet destined to itself... no, destined to PE2, and forwards it normally over its own direct link.",
    packet: (state) => (state.packet ? plainIpv6Packet("p2-fwd", "P2", "PE2", "Ordinary IPv6 forwarding", PE1_SR_SOURCE, INFRA_ADDRESS_TEXT.PE2) : undefined),
    run: (state) => {
      const journey = [...state.journey, { router: "P2" as RouterId, input: "IPv6, DA=PE2", lookup: "Ordinary IPv6 FIB → direct link to PE2", action: "IPV6_FIB_FORWARD" as TiLfaAction, output: "Forwarded to PE2" }];
      return { state: { ...state, packetAt: "PE2", journey }, events: [] };
    },
  },
  {
    id: "pe2-delivers",
    label: "PE2 Delivers",
    narrative: "PE2 receives its own original packet — completely ordinary IPv6 delivery. Delivered path: PE1 → P1 → P3 → P4 → P2 → PE2, entirely via local repair, with R1... with P1 never waiting for anyone else to converge.",
    run: (state) => ({ state: { ...state, journey: [...state.journey, { router: "PE2" as RouterId, input: "IPv6, DA=PE2", lookup: "Self is destination", action: "DELIVER" as TiLfaAction, output: "Delivered" }] }, events: [{ type: "VPN_PACKET_DELIVERED", stepId: "pe2-delivers", timestamp: Date.now(), message: "Delivered via TI-LFA local repair" }] }),
    whatChanged: () => ["Delivered PE1 → P1 → P3 → P4 → P2 → PE2 via local repair — P3 and P4 never learned of the failure and never needed to"],
  },

  // --- P. Loop-free recap --------------------------------------------------------
  {
    id: "loop-free-recap",
    label: "Why This Repair Is Loop-Free",
    narrative: "NAIVE: original DA=PE2 → P1 → P3 → P1 → … (P3's stale FIB sends it right back). TI-LFA: repair DA=P4 End.X+USD → P1 → P3 → P4 → P2 → PE2. The difference is entirely in what the outer destination IS — a destination P3's stale FIB can misinterpret, versus a repair SID it cannot.",
  },

  // --- Q. Convergence lifecycle --------------------------------------------------
  {
    id: "igp-converging",
    label: "IGP Converging",
    narrative: "Separately, IGP now floods the P1-P2 failure network-wide. Every router recomputes SPF — a distributed process running on its own timeline, independent of the local repair already carrying traffic.",
    run: (state) => ({ state: { ...state, phase: "IGP_CONVERGING", failureKnownAt: { ...state.failureKnownAt, P3: true, P4: true, P2: true } }, events: [{ type: "OSPF_SPF_COMPLETED", stepId: "igp-converging", timestamp: Date.now(), message: "P3, P4, P2 have now converged" }] }),
    whatChanged: () => ["P3: now knows the failure. P4: now knows. P2: now knows."],
  },
  {
    id: "plr-converged",
    label: "P1 Itself Converges",
    narrative: "P1's own ordinary FIB toward PE2 now directly reflects the post-convergence path — no repair encapsulation required any more.",
    run: (state) => ({ state: { ...state, phase: "PLR_CONVERGED" }, events: [] }),
  },
  {
    id: "repair-released",
    label: "Repair Released",
    narrative: "TI-LFA repair labels/SIDs are used only during the local-protection interval. Once P1 has converged, the repair encapsulation is no longer applied — TI-LFA is temporary, not a permanent replacement for IGP convergence.",
    run: (state) => ({ state: { ...state, phase: "POST_CONVERGENCE", activeMode: undefined, packet: undefined, packetAt: undefined, journey: [] }, events: [] }),
  },
  {
    id: "post-convergence-forwarding",
    label: "Normal Post-Convergence Forwarding",
    narrative: "A fresh packet now travels PE1 → P1 → P3 → P4 → P2 → PE2 via ordinary IPv6 FIB entries at every hop — no H.Encaps repair outer, no End.X+USD SID anywhere.",
    packet: (state) => (state.packet && state.packetAt === DESTINATION ? tiLfaPacket("post-conv", "P2", "PE2", "Stage shown: final post-convergence hop to PE2 — ordinary IPv6 forwarding, no TI-LFA repair outer", "FORWARD", state.packet) : undefined),
    run: (state) => {
      const post = computePostConvergencePath(state.links, PLR, DESTINATION, "LINK", PROTECTED_LINK);
      const journey: JourneyHop[] = (post?.path ?? []).slice(0, -1).map((r, i) => ({ router: r, input: "IPv6, DA=PE2", lookup: "Ordinary post-convergence IPv6 FIB", action: "IPV6_FIB_FORWARD" as TiLfaAction, output: `→ ${post!.path[i + 1]}` }));
      return { state: { ...state, packet: baselinePacket(), packetAt: DESTINATION, journey }, events: [{ type: "VPN_PACKET_DELIVERED", stepId: "post-convergence-forwarding", timestamp: Date.now(), message: "Delivered via ordinary post-convergence forwarding" }] };
    },
  },

  // --- R. Link vs node protection --------------------------------------------------
  {
    id: "node-protection-intro",
    label: "Node Protection: Protecting P2 Itself",
    narrative: "A stronger failure mode: P2 fails completely, not just the P1-P2 link. Node protection must behave as though P2 itself is gone — a repair that rejoins AT P2 is invalid.",
    run: (state) => ({ state: { ...state, failedLinkIds: [], failureKnownAt: {}, phase: "STEADY_STATE", activeMode: undefined, packet: undefined, packetAt: undefined, journey: [] }, events: [] }),
  },
  {
    id: "node-protection-compute",
    label: "Computed: Node-Protecting Repair",
    narrative: "P-Space and Q-Space recomputed with node P2 excluded ENTIRELY — not merely the one link into it. Q-Space(PE2, node P2) turns out EMPTY here: every node's own current best path to PE2 actually goes through P2. That's exactly why the repair forces an explicit adjacency rather than trusting any node's natural forwarding.",
    run: (state) => {
      const repair = precomputeTiLfaRepair(state.links, PLR, DESTINATION, "NODE", PROTECTED_NODE);
      return { state: { ...state, nodeRepair: repair }, events: [{ type: "OSPF_SPF_COMPLETED", stepId: "node-protection-compute", timestamp: Date.now(), message: `Node-protecting repair node: ${repair.repairNode}, merge target: ${repair.mergeTarget}` }] };
    },
    whatChanged: (_, next) => [`Post-convergence path (node P2 excluded): ${next.nodeRepair?.postConvergencePath?.join(" → ")}`, `Repair node: ${next.nodeRepair?.repairNode}, forced adjacency: ${next.nodeRepair?.mergeTarget}`],
  },
  {
    id: "node-protection-repair-list",
    label: "Node-Protecting Repair List",
    narrative: `Outgoing interface: P1 → P3 (unchanged — P4 is still safely reachable). Repair list: <P4 End.X+USD → PE2> — the adjacency target is now PE2 directly, using the existing P4-PE2 backup link, bypassing P2 entirely.`,
  },
  {
    id: "predict-node-vs-link",
    label: "Predict",
    narrative: "Compare the two labs.",
    question: {
      prompt: "Can node protection for P2 use P2 as part of its own repair path?",
      options: [
        { id: "no", label: "No — node protection must avoid P2 entirely" },
        { id: "yes", label: "Yes, as long as P2's interface toward PE2 still works" },
        { id: "sometimes", label: "Only if link protection already merges there" },
        { id: "irrelevant", label: "P2 is irrelevant to its own node protection" },
      ],
      correctOptionId: "no",
      explanation: "Node protection models P2 as entirely gone. A repair that rejoins through P2 would be invalid the instant P2 itself is actually down — the repair must reach PE2 through a genuinely P2-free path (P4-PE2).",
    },
  },
  {
    id: "protection-comparison",
    label: "Link Protection vs. Node Protection — Side By Side",
    narrative: "LINK PROTECTION (P1-P2): P2 itself is healthy, so the repair may merge back AT P2 (End.X adjacency → P2). NODE PROTECTION (P2): P2 is presumed gone, so the repair must bypass it entirely (End.X adjacency → PE2, via P4's separate direct link). Same repair NODE (P4), same mechanism (End.X+USD), different forced adjacency — because the two failure models make different assumptions about what's still alive.",
  },

  // --- S. SRLG preview -------------------------------------------------------------
  {
    id: "srlg-preview",
    label: "Preview: SRLG",
    narrative: "RFC 9855 also allows the protected resource to represent a configured SRLG (Shared Risk Link Group) — a set of links that could plausibly fail together (e.g. sharing the same fiber conduit). Preview only: this lesson never implements SRLG computation; the protected resource here is always exactly one link or one node.",
  },

  // --- T. Troubleshooting: wrong repair list ----------------------------------
  {
    id: "break-intro-ti-lfa",
    label: "Break The Network",
    narrative: "Everything above worked cleanly with the CORRECT repair. Now install an INCORRECT one deliberately, on an otherwise fully healthy protection stack.",
    run: (state) => ({ state: { ...state, failedLinkIds: [], failureKnownAt: {}, phase: "STEADY_STATE", activeMode: undefined, packet: undefined, packetAt: undefined, journey: [] }, events: [] }),
  },
  {
    id: "inject-wrong-repair",
    label: "Wrong Repair Installed",
    narrative: "The precomputed repair for link P1-P2 is (incorrectly) set to a directly-routed \"P2 End+USD\" SID — NOT the P4 End.X+USD adjacency SID. Outgoing interface is still correctly P1→P3.",
    run: (state) => {
      const correct = precomputeTiLfaRepair(state.links, PLR, DESTINATION, "LINK", PROTECTED_LINK);
      const wrongSid: RepairSid = { sidHextets: buildSrv6Sid(LOCATOR_HEXTETS4.P2, FUNCTION.END), sidText: fmtIpv6(buildSrv6Sid(LOCATOR_HEXTETS4.P2, FUNCTION.END)), owner: "P2", behavior: "END_X", flavors: ["USD"], adjacency: "P2" };
      const wrongRepair: TiLfaRepairPath = { ...correct, repairNode: "P2", mergeTarget: "P2", repairList: { sids: [wrongSid] } };
      return { state: { ...state, linkRepair: wrongRepair, troubleshooting: { ...state.troubleshooting, started: true } }, events: [{ type: "MPBGP_VPN_ROUTE_ADVERTISED", stepId: "inject-wrong-repair", timestamp: Date.now(), message: "Incorrect repair SID installed: P2 End+USD (directly routed, no P4 hop)" }] };
    },
    whatChanged: () => ["Repair list (WRONG): <P2 End+USD> — bypasses the documented P4-based strategy entirely"],
  },
  {
    id: "incident-tilfa",
    label: "INCIDENT",
    narrative: "P1 detected the P1-P2 failure. TI-LFA backup state was activated. Yet protected traffic does not reach PE2. Failure detected ✓ · Backup entry installed ✓ · Alternate P1-P3 link ✓ · P3-P4 link ✓ · P4-P2 link ✓ · Customer/infrastructure traffic delivery ✕.",
  },
  {
    id: "fail-for-incident",
    label: "P1-P2 DOWN (Wrong Repair Activates)",
    narrative: "P1-P2 fails. P1 activates the precomputed (wrong) repair immediately, exactly as designed — the repair itself is what's broken, not the activation mechanism.",
    run: (state) => ({ state: { ...state, failedLinkIds: [PROTECTED_LINK], failureKnownAt: { P1: true }, phase: "TI_LFA_ACTIVE", activeMode: "LINK" }, events: [{ type: "OSPF_COST_CHANGED", stepId: "fail-for-incident", timestamp: Date.now(), message: "P1-P2 down — wrong repair activates" }] }),
  },
  {
    id: "wrong-repair-forwards",
    label: "P1 Encapsulates With The Wrong SID",
    narrative: "P1 pushes the WRONG repair outer: DA = a directly-routed P2 SID. Outgoing interface is still P1→P3 — that part was never the problem.",
    packet: (state) => (state.packet?.repairOuter ? tiLfaPacket("wrong-encap", "P1", "P3", "Wrong repair SID (directly routed to P2)", "H.Encaps", state.packet) : undefined),
    run: (state) => {
      const sid = state.linkRepair?.repairList.sids[0];
      if (!sid) return { state, events: [] };
      const pkt = encapsulateRepairSingleSid(sid, baselinePacket(), PLR_REPAIR_SOURCE);
      const journey = [...state.journey, { router: "P1" as RouterId, input: "IPv6 (primary down)", lookup: `Repair OIF P1→P3; WRONG repair SID ${sid.sidText} (routes directly to P2)`, action: "REPAIR_ENCAPSULATE" as TiLfaAction, output: "Wrong repair outer added" }];
      return { state: { ...state, packet: pkt, packetAt: "P3", journey }, events: [] };
    },
  },
  {
    id: "wrong-repair-p3-stale",
    label: "P3: Still Has Its Pre-Convergence FIB",
    narrative: "P3 receives DA = a P2-routed SID. But P3's OWN pre-convergence FIB entry toward P2's address space still says \"via P1\" — the SID was never designed to force a specific adjacency past P3, so P3 just does ordinary (stale) destination-based forwarding.",
    run: (state) => {
      const fib = computePreConvergenceFib("P3", "P2", state.links, "LINK", "P1-P2", false);
      const journey = [...state.journey, { router: "P3" as RouterId, input: "Repair outer, DA=P2 SID", lookup: `Ordinary (stale) IPv6 FIB toward P2 → next hop ${fib.nextHop}`, action: "NAIVE_FORWARD" as TiLfaAction, output: `forwarded to ${fib.nextHop}` }];
      return { state: { ...state, packetAt: fib.nextHop, journey }, events: [] };
    },
  },
  {
    id: "wrong-repair-loop",
    label: "LOOP: P1 → P3 → P1",
    narrative: "Exactly like the earlier naive demonstration — because the installed repair SID does not force a specific adjacency, P3's stale FIB sends it right back to P1. This comes from REAL forwarding state (P3's actual pre-convergence FIB), not a hardcoded fault flag.",
    run: (state) => ({ state: { ...state, journey: [...state.journey, { router: "P1" as RouterId, input: "Repair outer, DA=P2 SID", lookup: "Received again — same repair, same outcome", action: "LOOP" as TiLfaAction, output: "Loop detected" }] }, events: [{ type: "PACKET_DROPPED", stepId: "wrong-repair-loop", timestamp: Date.now(), message: "Wrong repair SID loops between P1 and P3" }] }),
    whatChanged: () => ["Wrong repair SID (directly routed to P2, no forced P4 adjacency) → P1 → P3 → P1 → LOOP"],
  },
  {
    id: "diagnostic-ladder-ti-lfa",
    label: "Diagnose Before You Fix",
    narrative: "P1-P2 failure detected ✓ · PLR = P1 ✓ · P1-P3 backup interface ✓ · post-convergence path calculated ✓ · P-Space calculated ✓ · Q-Space calculated ✓ · correct P/Q relationship ✓ · installed repair OIF ✓ · installed repair SID = P2 (required: P4 End.X→P2) ✕ · P3 pre-convergence FIB to P2 = via P1 ✕ · repair path loop-free ✕ · protected traffic delivered ✕.",
  },
  {
    id: "predict-loop-usable",
    label: "Predict",
    narrative: "Before the repair options:",
    question: {
      prompt: "Given this evidence, what should engineers conclude about the installed repair?",
      options: [
        { id: "wrong-instruction", label: "The repair instruction itself doesn't encode a loop-free path through stale FIBs" },
        { id: "sid-missing", label: "No repair SID exists at all" },
        { id: "oif-wrong", label: "The outgoing interface is misconfigured" },
        { id: "p3-broken", label: "P3's hardware needs replacement" },
      ],
      correctOptionId: "wrong-instruction",
      explanation: "The SID exists and the OIF is correct — the problem is entirely which instruction was chosen. A directly-routed P2 SID lets P3's stale FIB reinterpret it; the P4 End.X+USD adjacency SID would not.",
    },
  },

  // --- Wrong repairs -----------------------------------------------------------
  {
    id: "wrong-repair-1",
    label: "Wrong Repair #1: Lower The P1-P3 Metric",
    narrative: "Rejected: P1 already sends repair traffic to P3 — the outgoing interface was never the problem. The problem is what P3 does with the repair destination afterward.",
  },
  {
    id: "wrong-repair-2",
    label: "Wrong Repair #2: Reinstall The Same P2 SID",
    narrative: "Rejected: SID existence isn't the issue. The selected repair instruction simply doesn't encode a loop-free path through P3's stale FIB — reinstalling the identical wrong instruction changes nothing.",
  },
  {
    id: "wrong-repair-3",
    label: "Wrong Repair #3: Wait For Every Router To Converge",
    narrative: "Rejected: eventual IGP convergence may restore traffic, but that defeats the entire purpose of local FRR and leaves the precomputed repair permanently incorrect. Do not mark this incident resolved by waiting.",
  },

  // --- Correct repair + mandatory resend ---------------------------------------
  {
    id: "repair-challenge",
    label: "Apply The Correct Fix",
    narrative: "Recompute from the actual topology: failure P1-P2 → post-convergence path → P/Q relationship → globally routed End.X possibility → correct repair.",
    action: (state, payload) => {
      const choice = typeof payload === "object" && payload !== null && "choice" in payload ? String((payload as { choice: string }).choice) : "";
      if (choice !== "recompute-correct") return { state: { ...state, repairAttempt: { choice, correct: false } }, events: [] };
      const correct = precomputeTiLfaRepair(LINKS, PLR, DESTINATION, "LINK", PROTECTED_LINK);
      return { state: { ...state, linkRepair: correct, repairAttempt: { choice, correct: true } }, events: [{ type: "SRV6_SERVICE_SID_RESOLVED", stepId: "repair-challenge", timestamp: Date.now(), message: `Recomputed: repair node ${correct.repairNode}, adjacency ${correct.mergeTarget}` }] };
    },
    requiresState: (state) => state.linkRepair?.repairNode === "P4" && state.linkRepair?.mergeTarget === "P2",
  },
  {
    id: "verify-resend",
    label: "Mandatory Resend",
    narrative: "Resend the same packet while P3 and P4 are STILL modeled as pre-convergence — prove the CORRECT repair (not eventual convergence) is what fixes this.",
    // run() executes the whole resend; the stored packet is the final exposed packet at PE2.
    packet: (state) => (state.packet && state.packetAt === "PE2" ? tiLfaPacket("verify-repair", "P2", "PE2", "Stage shown: final verified packet at PE2 after the repair outer has been removed; the journey records the full P1→P3→P4→P2→PE2 repair path", "VERIFIED", state.packet) : undefined),
    run: (state) => {
      const sid = state.linkRepair?.repairList.sids[0];
      if (!sid) return { state, events: [] };
      const pkt = encapsulateRepairSingleSid(sid, baselinePacket(), PLR_REPAIR_SOURCE);
      const outcome = executeEndXUsd(sid, pkt);
      const journey: JourneyHop[] = [
        { router: "P1", input: "IPv6 (primary down)", lookup: `Repair OIF P1→${state.linkRepair!.outgoingInterface}; repair SID ${sid.sidText}`, action: "REPAIR_ENCAPSULATE", output: "Correct repair outer added" },
        { router: "P3", input: "Repair outer", lookup: "Ordinary IPv6 FIB toward P4's locator", action: "IPV6_FIB_FORWARD", output: "Forwarded to P4" },
        { router: "P4", input: "Repair outer + original IPv6", lookup: "End.X+USD: remove repair outer, force adjacency P2", action: "USD_DECAP", output: outcome.reason },
        { router: "P2", input: "IPv6, DA=PE2", lookup: "Ordinary IPv6 FIB → direct link", action: "IPV6_FIB_FORWARD", output: "Forwarded to PE2" },
        { router: "PE2", input: "IPv6, DA=PE2", lookup: "Self is destination", action: "DELIVER", output: "Delivered" },
      ];
      return { state: { ...state, packet: outcome.exposedPacket ?? pkt, packetAt: "PE2", journey, troubleshooting: { ...state.troubleshooting, verified: true } }, events: [{ type: "VPN_PACKET_DELIVERED", stepId: "verify-resend", timestamp: Date.now(), message: "Verified: corrected repair delivers to PE2" }] };
    },
    whatChanged: () => ["Verified: P1 → P3 → P4 → P2 → PE2 via the corrected repair — recomputation alone was not enough, delivery had to be proven"],
  },

  // --- USD execution viewer step (narrative anchor for §44-45) ------------------
  {
    id: "usd-execution-recap",
    label: "USD Execution, Anatomy",
    narrative: "INPUT: repair outer IPv6 + original inner IPv6/IPv4. MATCH: P4 End.X+USD. USD: remove repair outer. END.X: adjacency J = P2. OUTPUT: original IPv6 → P2 — never a rewritten destination.",
  },

  // --- Transit vs endpoint PLR --------------------------------------------------
  {
    id: "endpoint-plr-experiment",
    label: "Small Experiment: SR Segment Endpoint PLR",
    narrative: "This lesson's main scenario has P1 acting as a TRANSIT PLR. RFC 9855 also covers the case where the PLR is itself processing the active SR segment (e.g. it's the target of an SRv6 Policy segment, not just an IGP transit hop). Rule: the PLR FIRST executes its own local segment behavior, THEN applies protection as transit traffic — never the reverse. This is a small, documented distinction, not a second simulated scenario.",
  },

  // --- Comparisons ---------------------------------------------------------------
  {
    id: "tilfa-vs-convergence",
    label: "TI-LFA vs. IGP Convergence",
    narrative: "TI-LFA: local, precomputed, immediate after local detection, temporary. IGP convergence: distributed, recomputes normal forwarding, eventually replaces the repair. These are complementary, not competing — TI-LFA buys time; convergence is what it hands off to.",
  },
  {
    id: "tilfa-vs-microloop",
    label: "TI-LFA vs. Micro-Loop Avoidance",
    narrative: "TI-LFA protects traffic AT THE PLR. It does not solve every distributed convergence micro-loop that can occur elsewhere in the network as other routers converge at different speeds. Preview only, never implemented here: ordered FIB updates, local convergence delay, and other micro-loop-avoidance mechanisms.",
  },
  {
    id: "tilfa-vs-sr-policy",
    label: "TI-LFA vs. SR Policy Protection",
    narrative: "TI-LFA = local protection computed from IGP/SR topology. SR Policy = end-to-end policy carrying explicit intent/constraints (latency, affinity, controller intent, SLA). Local TI-LFA does NOT automatically know any of that — it cannot guarantee an SR Policy's constraints survive a local repair. For strict policy compliance, end-to-end policy protection must be designed as part of the policy itself.",
  },
  {
    id: "predict-sr-policy-guarantee",
    label: "Predict",
    narrative: "Confirm this distinction.",
    question: {
      prompt: "Does local TI-LFA automatically guarantee that an SR Policy's original constraints remain satisfied after a repair?",
      options: [
        { id: "no", label: "No — the PLR generally cannot know the headend's policy constraints" },
        { id: "yes", label: "Yes — TI-LFA always preserves policy intent" },
        { id: "only-srv6", label: "Only for SRv6, not SR-MPLS" },
        { id: "only-link", label: "Only for link protection, not node protection" },
      ],
      correctOptionId: "no",
      explanation: "RFC 9855 explicitly notes the PLR generally cannot know all headend constraints. TI-LFA restores connectivity; it makes no promise about preserving an SR Policy's original latency/affinity/SLA intent.",
    },
  },
  {
    id: "sr-policy-caveat-experiment",
    label: "Educational Comparison: A Policy Constraint TI-LFA Can't See",
    narrative: "Suppose an SR Policy (from /demo/srv6-policy) deliberately avoids P4 due to a latency constraint on its active candidate. After P1-P2 fails, this lesson's local TI-LFA repair may use P4 anyway — its computation only sees the IGP/SR protection problem, never the policy's original constraint. Connectivity protected. Policy constraint not guaranteed. No second SR Policy engine is built here — this is a read-only comparison.",
  },
  {
    id: "flex-algo-preview",
    label: "Preview: Flex-Algo-Aware TI-LFA",
    narrative: "RFC 9855 describes TI-LFA interaction with SR algorithms/Flexible Algorithm — a constrained algorithm can be considered during protection computation when implemented consistently. Not implemented here: /demo/sr-flex-algo already teaches the algorithm concept, and SRv6 Flex-Algo protection deserves its own integration later.",
  },
  {
    id: "sr-mpls-vs-srv6-comparison",
    label: "SR-MPLS vs. SRv6 TI-LFA",
    narrative: "TI-LFA algorithm: same model. P/Q computation: same IGP topology. Repair path: OIF + RL in both. Segment: MPLS labels vs. IPv6 SIDs. Adjacency segment: Adj-SID label vs. End.X SID. Globally routed adjacency: usually no (SR-MPLS) vs. often possible (SRv6). Repair application: label push/pop vs. H.Encaps/SRv6. Repair decap: ordinary MPLS PHP-style behavior vs. the USD flavor. The computation model is shared; the data-plane encoding differs.",
  },

  // --- Repair-size lab + multi-SID SRH -------------------------------------------
  {
    id: "repair-size-lab",
    label: "Repair-Size Cases",
    narrative: "CASE A — direct post-convergence LFA: repair list empty, a plain alternate next hop already suffices (not this topology's main case). CASE B — remote PQ node: repair list is one End+USD SID. CASE C — this lesson's main case: P/Q adjacent enough that a single globally-routed End.X+USD SID suffices. CASE D — distant P/Q: multiple SIDs, and an SRH becomes necessary. No exact SID-count guarantee is claimed for topologies beyond these examples.",
  },
  {
    id: "multi-sid-example",
    label: "Multi-SID Example (SRH Education Only)",
    narrative: "A small, separate illustration: a repair needing <S1, S2> uses a real, full SRH. Outer DA = S1. Segment List[0] = S2 (final). Segment List[1] = S1. Segments Left = 1. Last Entry = 1. The primary topology's optimized single-SID repair stays completely unchanged — this is a distinct example, not a modification of it.",
    run: (state) => {
      const { srh } = buildMultiSidIllustration();
      return { state, events: [{ type: "SRV6_VPN_PACKET_ENCAPSULATED", stepId: "multi-sid-example", timestamp: Date.now(), message: `Multi-SID SRH: Segment List[0]=${srh.segmentList[0].sidText}, [1]=${srh.segmentList[1].sidText}` }] };
    },
  },
  {
    id: "no-fake-srh-contrast",
    label: "No Fake SRH — The Contrast",
    narrative: "Primary one-SID repair: NO SRH. Two-SID lab: a REAL, full SRH. SRv6 never means \"every packet always has an SRH\" — the SRH exists exactly when a genuine segment list needs one, never as decoration.",
  },

  // --- W. L3VPN nested repair integration -----------------------------------------
  {
    id: "l3vpn-integration-intro",
    label: "Advanced Integration: Protecting An SRv6 L3VPN Packet",
    narrative: `Reusing the packet concept from /demo/srv6-l3vpn: a customer IPv4 packet already riding inside an SRv6 VPN outer (DA = PE2 End.DT4 Service SID, ${PE2_DT4_SID.sidText}) arrives at P1 as ordinary transit traffic — P1 has no idea it's a VPN packet, only that its outer destination currently routes via P1-P2.`,
    run: (state) => ({ state: { ...state, packet: buildNestedVpnServicePacket({ kind: "IPV4", srcIp: "10.10.1.10", dstIp: "10.20.1.10" }, VPN_PE1_SOURCE), packetAt: "P1", journey: [], failedLinkIds: [], failureKnownAt: {}, phase: "STEADY_STATE" }, events: [] }),
  },
  {
    id: "l3vpn-fail-and-repair",
    label: "P1-P2 Fails — TI-LFA Wraps The ENTIRE Existing Packet",
    narrative: "On failure, H.Encaps wraps the whole existing SRv6 VPN packet inside a further repair outer: REPAIR OUTER IPv6 (DA = P4 End.X+USD) → SRv6 L3VPN OUTER (DA = PE2 End.DT4, untouched) → customer IPv4. Nested encapsulation, visibly.",
    packet: (state) => (state.packet?.repairOuter ? tiLfaPacket("l3vpn-repair", "P1", "P3", "TI-LFA wraps the entire existing SRv6 VPN packet", "H.Encaps", state.packet) : undefined),
    run: (state) => {
      const sid = state.linkRepair?.repairList.sids[0];
      if (!sid || !state.packet) return { state, events: [] };
      const failed = { ...state, failedLinkIds: [PROTECTED_LINK], failureKnownAt: { P1: true } };
      const wrapped = encapsulateRepairSingleSid(sid, state.packet, PLR_REPAIR_SOURCE);
      const journey = [...state.journey, { router: "P1" as RouterId, input: "SRv6 VPN packet (DA=PE2 End.DT4)", lookup: `Repair OIF P1→${state.linkRepair!.outgoingInterface}; repair SID ${sid.sidText}`, action: "REPAIR_ENCAPSULATE" as TiLfaAction, output: "Repair outer wraps the ENTIRE existing VPN packet" }];
      return { state: { ...failed, packet: wrapped, packetAt: state.linkRepair!.outgoingInterface, journey }, events: [{ type: "SRV6_VPN_PACKET_ENCAPSULATED", stepId: "l3vpn-fail-and-repair", timestamp: Date.now(), message: "TI-LFA nests around the existing SRv6 VPN packet" }] };
    },
    whatChanged: () => ["Packet: [VPN Outer DA=PE2 DT4][IPv4] → [Repair Outer DA=P4 End.X+USD][VPN Outer DA=PE2 DT4][IPv4] — nested encapsulation"],
  },
  {
    id: "l3vpn-p4-decap-repair-only",
    label: "P4: Removes ONLY The Repair Outer",
    narrative: "P4's End.X+USD removes exactly the TI-LFA repair outer — nothing else. The original SRv6 VPN packet (DA = PE2 End.DT4) is restored completely intact underneath, then forced to adjacency P2. P4 does NOT execute End.DT4 merely because it handled TI-LFA — that behavior belongs to PE2 alone.",
    // run() already removed ONLY the repair outer — the VPN outer and customer IPv4 are still nested in the stored packet.
    packet: (state) => (state.packet && !state.packet.repairOuter ? tiLfaPacket("l3vpn-usd", "P4", "P2", "Repair outer removed — original SRv6 VPN packet restored", "USD DECAP", state.packet) : undefined),
    run: (state) => {
      const sid = state.linkRepair?.repairList.sids[0];
      if (!sid || !state.packet) return { state, events: [] };
      const outcome = executeEndXUsd(sid, state.packet);
      const journey = [...state.journey, { router: "P4" as RouterId, input: "Repair outer + SRv6 VPN outer + IPv4", lookup: "End.X+USD removes ONLY the repair outer", action: "USD_DECAP" as TiLfaAction, output: "Original SRv6 VPN packet (DA=PE2 End.DT4) restored" }];
      return { state: { ...state, packet: outcome.exposedPacket ?? state.packet, packetAt: "P2", journey }, events: [{ type: "SRV6_SERVICE_SID_RESOLVED", stepId: "l3vpn-p4-decap-repair-only", timestamp: Date.now(), message: "P4 removes only the TI-LFA repair outer" }] };
    },
  },
  {
    id: "l3vpn-result",
    label: "P2 → PE2: The VPN Service Continues Normally",
    narrative: "P2 forwards the restored SRv6 VPN packet toward PE2 using ordinary IPv6 forwarding. At PE2, End.DT4 executes exactly as it would have without any failure ever happening: decap VPN outer → CUST-A lookup → CE. TI-LFA and the VPN service are two fully independent layers.",
    packet: (state) => (state.packet ? tiLfaPacket("l3vpn-deliver", "P2", "PE2", "Original SRv6 VPN packet, unaffected by the repair", "FORWARD", state.packet) : undefined),
    run: (state) => {
      const journey = [
        ...state.journey,
        { router: "P2" as RouterId, input: "SRv6 VPN outer, DA=PE2 End.DT4", lookup: "Ordinary IPv6 FIB → PE2", action: "IPV6_FIB_FORWARD" as TiLfaAction, output: "Forwarded to PE2" },
        { router: "PE2" as RouterId, input: "SRv6 VPN outer, DA=PE2 End.DT4", lookup: "Local SID match → End.DT4 → CUST-A IPv4 lookup", action: "DELIVER" as TiLfaAction, output: "Delivered to CE via CUST-A, exactly as in the SRv6 L3VPN lesson" },
      ];
      return { state: { ...state, packetAt: "PE2", journey }, events: [{ type: "VPN_PACKET_DELIVERED", stepId: "l3vpn-result", timestamp: Date.now(), message: "SRv6 VPN service packet delivered — TI-LFA repair released" }] };
    },
    whatChanged: () => ["PE2 executes End.DT4 exactly as usual — P4 never touched the VPN service layer, only the temporary repair outer around it"],
  },

  // --- Engineer challenge / complete -----------------------------------------------
  {
    id: "engineer-challenge-intro",
    label: "Engineer Challenge: Protect The IPv6 Core",
    narrative: "Recap and confirm: primary path identified ✓ · PLR identified ✓ · link protection chosen ✓ · failure topology computed ✓ · post-convergence path inspected ✓ · P-Space inspected ✓ · Q-Space inspected ✓ · repair OIF chosen ✓ · globally routed End.X repair SID derived ✓ · USD added ✓ · repair preinstalled ✓ · P1-P2 failed ✓ · repair activated ✓ · P3 stale FIB verified ✓ · loop-free proven ✓ · P4 End.X+USD verified ✓ · original packet restored ✓ · convergence advanced ✓ · repair released ✓ · normal post-convergence path verified ✓.",
    requiresState: (state) => state.troubleshooting.verified === true && !!state.nodeRepair?.repairNode,
  },
  {
    id: "complete",
    label: "Complete",
    narrative: "You built TI-LFA local repair on an SRv6 data plane from real topology: post-convergence SPF, P-Space, extended P-Space, Q-Space, a documented repair-node selection strategy, and a globally-routed End.X+USD repair SID — activated locally at the PLR, without waiting for P3, P4, or anyone else to converge first. You protected a link and a node, watched a naive redirect genuinely loop from real stale-FIB state, diagnosed and repaired a wrong precomputed repair, and protected a nested SRv6 L3VPN packet without either layer knowing about the other. +800 XP awarded.",
  },
];

// ---------------------------------------------------------------------------
// CLI (concept / Cisco IOS-XR / Junos)
// ---------------------------------------------------------------------------

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
export function buildSrv6TiLfaCliCommands(state: Srv6TiLfaState, router: RouterId): CliCommandEntry[] {
  const repair = state.activeMode === "NODE" ? state.nodeRepair : state.linkRepair;
  const readiness = repair ? (validateRepairPath(repair, state.links).valid ? "READY" : "STALE") : "NOT_CONFIGURED";
  const fibCisco: CliOutput = { cmd: "show ipv6 route", output: `${router} known-failure: ${state.failureKnownAt[router] ? "yes" : "no"}` };
  const fibJuniper: CliOutput = { cmd: "show route table inet6.0", output: fibCisco.output };
  const repairCisco: CliOutput = {
    cmd: "show segment-routing srv6 ti-lfa",
    output: repair
      ? `Protected: ${repair.protectedResource} (${repair.mode})\nRepair node: ${repair.repairNode ?? "none"}\nMerge target: ${repair.mergeTarget ?? "none"}\nOutgoing interface: ${router}→${repair.outgoingInterface ?? "?"}\nRepair SID: ${repair.repairList.sids[0]?.sidText ?? "(none)"}\nState: ${readiness}`
      : "No TI-LFA repair computed.",
  };
  const repairJuniper: CliOutput = { cmd: "show ti-lfa srv6 repair", output: repairCisco.output };
  const journeyCisco: CliOutput = { cmd: "show ipv6 cef", output: state.journey.filter((h) => h.router === router).map((h) => `In: ${h.input}  Lookup: ${h.lookup}  Action: ${h.action}  Out: ${h.output}`).join("\n") || "(no forwarding entry recorded yet)" };
  const journeyJuniper: CliOutput = { cmd: "show route forwarding-table", output: journeyCisco.output };
  return [
    { id: "fib", label: "ipv6 route", cisco: fibCisco, juniper: fibJuniper },
    { id: "ti-lfa", label: "ti-lfa state", cisco: repairCisco, juniper: repairJuniper },
    { id: "journey", label: "forwarding", cisco: journeyCisco, juniper: journeyJuniper },
  ];
}
