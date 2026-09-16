import type { ScenarioStep } from "@/lib/sim-engine/types";
import {
  ADJ_SID_BASE,
  NODE_SID_INDEX,
  ROUTER_LOOPBACK,
  SRGB_END,
  SRGB_START,
  buildPrefixSids,
  buildSegmentList,
  buildSidDatabase as buildFoundationsSidDatabase,
  computeAdjSidLabel,
  deriveNodeSidLabel,
  fmtLabel,
  validateSidScope,
  type AdjSid,
  type LabelValue,
  type PrefixSid,
  type RouterId,
  type SegmentListItem,
  type SegmentSpec,
  type SidRow,
} from "./srMplsFoundations";

export { fmtLabel };
export type { LabelValue, RouterId };

/**
 * SR Traffic Engineering / SR Policy — the operational layer built on
 * top of SR-MPLS Foundations' SIDs. Central question: how do we turn
 * individual SIDs into an operational TE policy with intent, candidate
 * paths, fallback behavior, and traffic steering?
 *
 * Scope boundary (deliberate): no TI-LFA, SRv6, PCEP, BGP SR Policy,
 * BGP Color steering, or Flex-Algo in this lesson — mentioned only as
 * deferred concepts where the narrative calls for it.
 *
 * RouterId is reused verbatim from srMplsFoundations (same six
 * routers, same SIDs) — this lesson is a direct continuation. LinkId
 * gets one addition (R3-R4, a TE fallback cross-link) that Foundations'
 * closed union doesn't have, so link-topology-typed helpers
 * (computeIgpPath, the SID database's next-hop column) are re-derived
 * here; everything that only depends on RouterId/SID identity
 * (PrefixSid/AdjSid, buildSegmentList, validateSidScope, the label/
 * packet plumbing) is imported and reused directly.
 */

export const HEADEND: RouterId = "R1";
export const DESTINATION: RouterId = "R6";
export const POLICY_COLOR = 100;
export const POLICY_COLOR_NAME = "GOLD";

export type Affinity = "BLUE" | "GOLD";
export type LinkId = "R1-R2" | "R2-R4" | "R4-R6" | "R1-R3" | "R3-R5" | "R5-R6" | "R3-R4";
export interface TeLinkDef {
  id: LinkId;
  a: RouterId;
  b: RouterId;
  metric: number;
  affinities: Affinity[];
}
export const LINKS: TeLinkDef[] = [
  { id: "R1-R2", a: "R1", b: "R2", metric: 10, affinities: ["BLUE"] },
  { id: "R2-R4", a: "R2", b: "R4", metric: 10, affinities: ["BLUE"] },
  { id: "R4-R6", a: "R4", b: "R6", metric: 10, affinities: ["BLUE", "GOLD"] },
  { id: "R1-R3", a: "R1", b: "R3", metric: 15, affinities: ["GOLD"] },
  { id: "R3-R5", a: "R3", b: "R5", metric: 15, affinities: ["GOLD"] },
  { id: "R5-R6", a: "R5", b: "R6", metric: 15, affinities: ["GOLD"] },
  { id: "R3-R4", a: "R3", b: "R4", metric: 30, affinities: ["GOLD"] },
];
export const TOP_PATH: RouterId[] = ["R1", "R2", "R4", "R6"];
export const GOLD_PATH: RouterId[] = ["R1", "R3", "R5", "R6"];
export const GOLD_FALLBACK_PATH: RouterId[] = ["R1", "R3", "R4", "R6"];

export const HOST_BEHIND_R1 = "192.168.1.10";
export const HOST_BEHIND_R6 = "192.168.6.20";

export const TERMS: { term: string; expansion: string; meaning: string }[] = [
  { term: "SR Policy", expansion: "Segment Routing Policy", meaning: "Traffic-engineering intent, identified by <Headend, Color, Endpoint> — not merely a static label stack." },
  { term: "Candidate Path", expansion: "One way to realize the policy", meaning: "Explicit (operator-specified segment list) or Dynamic (computed from TE constraints); the highest-preference VALID one is active." },
  { term: "BSID", expansion: "Binding SID", meaning: "A local forwarding handle at the headend bound to the policy — not a globally-meaningful Node SID." },
  { term: "Color", expansion: "Policy intent identifier", meaning: "An opaque integer identifying intent — not an MPLS label, VLAN, or DSCP value." },
];

// ---------------------------------------------------------------------------
// IGP / TE path computation (re-derived for this lesson's extra R3-R4 link)
// ---------------------------------------------------------------------------

function neighborsOf(router: RouterId, links: TeLinkDef[], requireAffinity?: Affinity): { to: RouterId; metric: number }[] {
  const out: { to: RouterId; metric: number }[] = [];
  for (const l of links) {
    if (requireAffinity && !l.affinities.includes(requireAffinity)) continue;
    if (l.a === router) out.push({ to: l.b, metric: l.metric });
    if (l.b === router) out.push({ to: l.a, metric: l.metric });
  }
  return out;
}

function allSimplePaths(links: TeLinkDef[], from: RouterId, to: RouterId, requireAffinity?: Affinity): RouterId[][] {
  const results: RouterId[][] = [];
  const visit = (current: RouterId, path: RouterId[], visited: Set<RouterId>) => {
    if (current === to) {
      results.push(path);
      return;
    }
    for (const n of neighborsOf(current, links, requireAffinity)) {
      if (visited.has(n.to)) continue;
      visited.add(n.to);
      visit(n.to, [...path, n.to], visited);
      visited.delete(n.to);
    }
  };
  visit(from, [from], new Set([from]));
  return results;
}

function pathCost(path: RouterId[], links: TeLinkDef[]): number {
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
/** Shared by ordinary (unconstrained) Node-SID forwarding AND TE-constrained dynamic-candidate computation — pass `requireAffinity` to prune non-matching links first, exactly like ConstraintEvaluationViewer's "prune, then shortest path" model. */
export function computeIgpPath(links: TeLinkDef[], from: RouterId, to: RouterId, requireAffinity?: Affinity): IgpPathResult | undefined {
  if (from === to) return { path: [from], cost: 0 };
  const candidates = allSimplePaths(links, from, to, requireAffinity).map((path) => ({ path, cost: pathCost(path, links) }));
  candidates.sort((a, b) => a.cost - b.cost);
  return candidates[0];
}

export function linkIdBetween(a: RouterId, b: RouterId, links: TeLinkDef[] = LINKS): LinkId | undefined {
  return links.find((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a))?.id;
}

// ---------------------------------------------------------------------------
// SID database (reuses Foundations' PrefixSid/AdjSid builders — only the
// per-link next-hop column needs this lesson's own path computation)
// ---------------------------------------------------------------------------

function buildAllAdjSids(links: TeLinkDef[]): AdjSid[] {
  const out: AdjSid[] = [];
  for (const l of links) {
    out.push({ id: `adj-${l.a}-${l.b}`, owner: l.a, neighbor: l.b, label: computeAdjSidLabel(NODE_SID_INDEX[l.a], NODE_SID_INDEX[l.b]), scope: "LOCAL" });
    out.push({ id: `adj-${l.b}-${l.a}`, owner: l.b, neighbor: l.a, label: computeAdjSidLabel(NODE_SID_INDEX[l.b], NODE_SID_INDEX[l.a]), scope: "LOCAL" });
  }
  return out;
}
export const ADJ_SIDS: AdjSid[] = buildAllAdjSids(LINKS);
export const R3_R5_ADJ_SID: AdjSid = ADJ_SIDS.find((a) => a.owner === "R3" && a.neighbor === "R5")!;
export const PREFIX_SIDS: PrefixSid[] = buildPrefixSids();

export function buildSidDatabase(links: TeLinkDef[], observer: RouterId = HEADEND): SidRow[] {
  const nodeRows: SidRow[] = PREFIX_SIDS.map((p) => ({
    prefix: p.prefix,
    router: p.router,
    sidType: "NODE" as const,
    sidIndex: p.index,
    localLabel: p.label,
    algorithm: p.algorithm,
    scope: p.scope,
    nextHop: p.router === observer ? undefined : computeIgpPath(links, observer, p.router)?.path[1],
    meaning: `Reach ${p.router}`,
    installed: true,
  }));
  const adjRows: SidRow[] = ADJ_SIDS.map((a) => ({
    sidType: "ADJ" as const,
    localLabel: a.label,
    scope: a.scope,
    owner: a.owner,
    nextHop: a.neighbor,
    meaning: `${a.owner}→${a.neighbor}`,
    installed: a.owner === observer,
  }));
  return [...nodeRows, ...adjRows];
}
void buildFoundationsSidDatabase; // kept imported for reference/parity, not used directly (this lesson's link set differs)

// ---------------------------------------------------------------------------
// Segment-list derivation (minimal-segment algorithm — matches a hop to a
// Node SID whenever the ORDINARY, unconstrained IGP shortest path already
// takes it there; only inserts an Adj-SID where the path genuinely diverges
// from ordinary Node-SID behavior)
// ---------------------------------------------------------------------------

function pathsEqual(a: RouterId[], b: RouterId[]): boolean {
  return a.length === b.length && a.every((r, i) => r === b[i]);
}

export function deriveSegmentListFromPath(path: RouterId[], links: TeLinkDef[]): SegmentSpec[] {
  const specs: SegmentSpec[] = [];
  let i = 0;
  while (i < path.length - 1) {
    let bestJ = i + 1;
    for (let j = i + 1; j < path.length; j++) {
      const spt = computeIgpPath(links, path[i], path[j]);
      if (spt && pathsEqual(spt.path, path.slice(i, j + 1))) bestJ = j;
      else break;
    }
    if (bestJ === i + 1 && !pathsEqual(computeIgpPath(links, path[i], path[i + 1])?.path ?? [], [path[i], path[i + 1]])) {
      const adjId = `adj-${path[i]}-${path[i + 1]}`;
      specs.push({ type: "ADJ", adjId });
      i += 1;
    } else {
      specs.push({ type: "NODE", target: path[bestJ] });
      i = bestJ;
    }
  }
  return specs;
}

// ---------------------------------------------------------------------------
// Candidate paths / policy
// ---------------------------------------------------------------------------

export type CandidateType = "EXPLICIT" | "DYNAMIC";
export interface CandidateDef {
  id: string;
  name: string;
  type: CandidateType;
  preference: number;
  explicitSpecs?: SegmentSpec[];
  requiredAffinity?: Affinity;
}
export const EXPLICIT_CANDIDATE: CandidateDef = {
  id: "gold-explicit",
  name: "GOLD-EXPLICIT",
  type: "EXPLICIT",
  preference: 200,
  explicitSpecs: [{ type: "NODE", target: "R3" }, { type: "ADJ", adjId: R3_R5_ADJ_SID.id }, { type: "NODE", target: "R6" }],
};
export const DYNAMIC_CANDIDATE: CandidateDef = {
  id: "gold-dynamic",
  name: "GOLD-DYNAMIC",
  type: "DYNAMIC",
  preference: 100,
  requiredAffinity: "GOLD",
};

export interface CandidateEvaluation {
  def: CandidateDef;
  valid: boolean;
  reason: string;
  segmentList: SegmentListItem[];
  computedPath?: RouterId[];
}

/** `upLinks` is the currently-up link set (already filtered by the caller), so an Adj-SID is usable iff its underlying link still appears in it. */
function adjSidUsable(adjId: string, upLinks: TeLinkDef[]): boolean {
  const adj = ADJ_SIDS.find((a) => a.id === adjId);
  if (!adj) return false;
  return linkIdBetween(adj.owner, adj.neighbor, upLinks) !== undefined;
}

/** Explicit candidates use Foundations' own scope/ownership rules; validity here also requires every referenced Adj-SID's physical link to currently be up. */
export function validateExplicitCandidate(def: CandidateDef, upLinks: TeLinkDef[], headend: RouterId): CandidateEvaluation {
  const specs = def.explicitSpecs!;
  const segmentList = buildSegmentList(specs, PREFIX_SIDS, ADJ_SIDS);
  for (const item of segmentList) {
    if (item.type === "ADJ" && !adjSidUsable(`adj-${item.owner}-${item.target}`, upLinks)) {
      return { def, valid: false, reason: `Adj-SID ${item.owner}→${item.target} is unusable — its underlying link is down.`, segmentList };
    }
  }
  const scopeOk = validateSidScope(segmentList[0], headend);
  if (!scopeOk) return { def, valid: false, reason: "First segment is not executable at the headend.", segmentList };
  return { def, valid: true, reason: "All segments valid and executable.", segmentList };
}

/** Dynamic candidates are computed fresh from current TE state every time — never stored, so they can never go stale relative to the live topology. */
export function computeDynamicCandidate(def: CandidateDef, upLinks: TeLinkDef[], headend: RouterId, destination: RouterId): CandidateEvaluation {
  const result = computeIgpPath(upLinks, headend, destination, def.requiredAffinity);
  if (!result) return { def, valid: false, reason: `No path satisfies affinity ${def.requiredAffinity ?? "NONE"} from ${headend} to ${destination}.`, segmentList: [] };
  const specs = deriveSegmentListFromPath(result.path, upLinks);
  const segmentList = buildSegmentList(specs, PREFIX_SIDS, ADJ_SIDS);
  return { def, valid: true, reason: `Computed via TE-constrained shortest path (cost ${result.cost}).`, segmentList, computedPath: result.path };
}

export function evaluateCandidate(def: CandidateDef, upLinks: TeLinkDef[], headend: RouterId, destination: RouterId): CandidateEvaluation {
  return def.type === "EXPLICIT" ? validateExplicitCandidate(def, upLinks, headend) : computeDynamicCandidate(def, upLinks, headend, destination);
}

/** Highest-PREFERENCE VALID candidate wins — an invalid higher-preference candidate never beats a valid lower-preference one. */
export function selectActiveCandidate(evaluations: CandidateEvaluation[]): CandidateEvaluation | undefined {
  const valid = evaluations.filter((e) => e.valid);
  if (valid.length === 0) return undefined;
  return valid.reduce((best, e) => (e.def.preference > best.def.preference ? e : best));
}

export type PolicyState = "DOWN" | "RESOLVING" | "UP" | "NO_VALID_CANDIDATE";
export function determinePolicyState(active: CandidateEvaluation | undefined, everConfigured: boolean): PolicyState {
  if (!everConfigured) return "DOWN";
  return active ? "UP" : "NO_VALID_CANDIDATE";
}

export const BSID_BASE = 30000;
export function allocateBindingSid(index = 1): number {
  return BSID_BASE + index;
}
export const BSID = allocateBindingSid(1);

// ---------------------------------------------------------------------------
// Steering
// ---------------------------------------------------------------------------

export type FlowName = "DEFAULT" | "GOLD";
export function classifyTraffic(flow: FlowName): number | undefined {
  return flow === "GOLD" ? POLICY_COLOR : undefined;
}

// ---------------------------------------------------------------------------
// MPLS packet / label plumbing (per-file convention: re-derived)
// ---------------------------------------------------------------------------

export interface MplsLabel {
  value: LabelValue;
  purpose: "segment";
  bottomOfStack: boolean;
}
export interface MplsPacketState {
  labels: MplsLabel[];
  srcIp: string;
  dstIp: string;
}
function pushLabel(pkt: MplsPacketState, value: LabelValue): MplsPacketState {
  const labels = pkt.labels.map((l) => ({ ...l, bottomOfStack: false }));
  return { ...pkt, labels: [{ value, purpose: "segment", bottomOfStack: labels.length === 0 }, ...labels] };
}
function popTopLabel(pkt: MplsPacketState): MplsPacketState {
  const [, ...rest] = pkt.labels;
  return { ...pkt, labels: rest.map((l, i) => ({ ...l, bottomOfStack: i === rest.length - 1 })) };
}

export type FwdAction = "PUSH" | "CONTINUE" | "POP" | "POP_AND_FORWARD_ADJ" | "IP_FORWARD" | "POLICY_SELECT" | "POLICY_UNAVAILABLE";
export interface JourneyHop {
  router: RouterId;
  input: string;
  lookup: string;
  action: FwdAction;
  output: string;
}

function ipLayer(src: string, dst: string) {
  return { name: "IPv4", color: "var(--pv-proto-ip)", fields: [{ label: "Source IP", value: src }, { label: "Destination IP", value: dst }] };
}
function shimLayer(label: MplsLabel, index: number) {
  return {
    name: `MPLS Shim (segment ${index + 1}${index === 0 ? ", active" : ""})`,
    color: "var(--pv-proto-mpls)",
    fields: [
      { label: "Label", value: fmtLabel(label.value) },
      { label: "S (Bottom of Stack)", value: label.bottomOfStack ? "1" : "0" },
    ],
  };
}
export function buildPacketLayers(pkt: MplsPacketState) {
  return [...pkt.labels.map((l, i) => shimLayer(l, i)), ipLayer(pkt.srcIp, pkt.dstIp)];
}

// ---------------------------------------------------------------------------
// Graph layout
// ---------------------------------------------------------------------------

export const GRAPH_NODES = [
  { id: "R1", label: "R1", x: 5, y: 50, subLabel: "Headend" },
  { id: "R2", label: "R2", x: 35, y: 20 },
  { id: "R4", label: "R4", x: 65, y: 20 },
  { id: "R3", label: "R3", x: 35, y: 80 },
  { id: "R5", label: "R5", x: 65, y: 80 },
  { id: "R6", label: "R6", x: 95, y: 50, subLabel: "Endpoint" },
];
export const GRAPH_EDGES: { id: LinkId; a: RouterId; b: RouterId }[] = LINKS.map((l) => ({ id: l.id, a: l.a, b: l.b }));

// ---------------------------------------------------------------------------
// Top-level scenario state
// ---------------------------------------------------------------------------

export interface TroubleshootingState {
  started: boolean;
  repairAttempt?: { choice: string; correct: boolean };
  verified: boolean;
}

export interface SrPolicyState {
  links: TeLinkDef[];
  policyConfigured: boolean;
  candidates: CandidateDef[];
  packet?: MplsPacketState;
  packetAt?: RouterId;
  journey: JourneyHop[];
  flow?: FlowName;
  fault?: { reason: string };
  troubleshooting: TroubleshootingState;
}

export function createSrPolicyState(): SrPolicyState {
  return {
    links: LINKS,
    policyConfigured: false,
    candidates: [],
    journey: [],
    troubleshooting: { started: false, verified: false },
  };
}

export function candidateEvaluations(state: SrPolicyState): CandidateEvaluation[] {
  return state.candidates.map((c) => evaluateCandidate(c, state.links, HEADEND, DESTINATION));
}
export function activeCandidateEvaluation(state: SrPolicyState): CandidateEvaluation | undefined {
  return selectActiveCandidate(candidateEvaluations(state));
}
export function policyState(state: SrPolicyState): PolicyState {
  return determinePolicyState(activeCandidateEvaluation(state), state.policyConfigured);
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

function mplsPacket(id: string, from: RouterId, to: RouterId, summary: string, action: string, pkt: MplsPacketState) {
  return { id, protocol: "MPLS" as const, from, to, summary: `${action}: ${summary}`, layers: buildPacketLayers(pkt) };
}

const R6_LABEL = deriveNodeSidLabel(NODE_SID_INDEX.R6);
const R5_LABEL = deriveNodeSidLabel(NODE_SID_INDEX.R5);
const R3_LABEL = deriveNodeSidLabel(NODE_SID_INDEX.R3);
void ADJ_SID_BASE;
void SRGB_START;
void SRGB_END;
void ROUTER_LOOPBACK;

export const srPolicySteps: ScenarioStep<SrPolicyState>[] = [
  {
    id: "intro",
    label: "The Central Question",
    narrative: "You already know how individual SIDs work — Node SID, Adjacency SID, SRGB. This lesson asks: how do we turn those SIDs into an operational traffic-engineering policy, with intent, candidate paths, fallback behavior, and traffic steering?",
  },
  {
    id: "baseline-intro",
    label: "Baseline — SR Without A Policy",
    narrative: "First, send traffic using only R6's Node SID — no policy involved.",
  },
  {
    id: "baseline-send",
    label: "Send: R6 Node SID Only",
    narrative: `Stack: [${R6_LABEL}]. This reaches R6 using ordinary Node-SID shortest-path behavior.`,
    packet: () => ({ id: "ip-baseline", protocol: "IP" as const, from: "R1", to: "R1", summary: "Packet classified for R6 Node SID", layers: [ipLayer(HOST_BEHIND_R1, HOST_BEHIND_R6)] }),
    run: (state) => ({ state: { ...state, packet: { labels: [], srcIp: HOST_BEHIND_R1, dstIp: HOST_BEHIND_R6 }, packetAt: "R1", journey: [] }, events: [] }),
  },
  {
    id: "baseline-r1-push",
    label: "R1: PUSH Node SID R6",
    narrative: "R1 imposes the Node SID for R6.",
    packet: (state) => (state.packet ? mplsPacket("push-baseline", "R1", "R2", "impose Node SID R6", "PUSH", pushLabel(state.packet, R6_LABEL)) : undefined),
    run: (state) => (state.packet ? { state: { ...state, packet: pushLabel(state.packet, R6_LABEL), packetAt: "R2", journey: [...state.journey, { router: "R1", input: "IP", lookup: "No policy configured — ordinary Node SID", action: "PUSH", output: fmtLabel(R6_LABEL) }] }, events: [] } : { state, events: [] }),
  },
  {
    id: "baseline-r2-continue",
    label: "R2: CONTINUE",
    narrative: "R2 forwards toward R6 via its own shortest path (through R4) — unchanged label.",
    packet: (state) => (state.packet ? mplsPacket("continue-baseline", "R2", "R4", "forward toward R6", "CONTINUE", state.packet) : undefined),
    run: (state) => ({ state: { ...state, packetAt: "R4", journey: [...state.journey, { router: "R2", input: fmtLabel(R6_LABEL), lookup: "Active SID = R6 Node SID; shortest path via R4", action: "CONTINUE", output: fmtLabel(R6_LABEL) }] }, events: [] }),
  },
  {
    id: "baseline-r4-pop",
    label: "R4: POP (PHP)",
    narrative: "R4 is the penultimate hop — pops before forwarding to R6.",
    packet: (state) => (state.packet ? mplsPacket("php-baseline", "R4", "R6", "penultimate-hop pop", "POP", popTopLabel(state.packet)) : undefined),
    run: (state) => (state.packet ? { state: { ...state, packet: popTopLabel(state.packet), packetAt: "R6", journey: [...state.journey, { router: "R4", input: fmtLabel(R6_LABEL), lookup: "PHP (implicit-null from R6)", action: "POP", output: "IP (unlabeled)" }] }, events: [] } : { state, events: [] }),
  },
  {
    id: "baseline-deliver",
    label: "R6 Delivers",
    narrative: "Delivered via R1 → R2 → R4 → R6 — the ordinary IGP shortest path. Now the operational requirement: GOLD traffic toward R6 must use R1 → R3 → R5 → R6, regardless of the ordinary shortest path.",
    packet: (state) => (state.packet ? { id: "delivered-baseline", protocol: "IP" as const, from: "R6", to: "R6", summary: "Delivered via Node SID", layers: buildPacketLayers(state.packet) } : undefined),
    run: (state) => ({ state: { ...state, journey: [...state.journey, { router: "R6", input: "IP", lookup: "IP delivery", action: "IP_FORWARD", output: "Delivered" }] }, events: [] }),
    whatChanged: () => ["Delivered R1 → R2 → R4 → R6 — no policy involved"],
  },
  {
    id: "sr-policy-intro",
    label: "Introduce: SR Policy",
    narrative: "An SR Policy represents traffic-engineering intent — not merely a list of labels. It contains enough information to determine where the policy starts, what intent it represents, where it ends, which candidate path is active, and which segment list should be imposed.",
  },
  {
    id: "policy-identity",
    label: "Policy Identity: <Headend, Color, Endpoint>",
    narrative: `Headend: R1. Color: ${POLICY_COLOR}. Endpoint: R6 / ${ROUTER_LOOPBACK.R6}. The policy is identified in this lesson by this tuple.`,
    run: (state) => ({ state: { ...state, policyConfigured: true }, events: [] }),
  },
  {
    id: "color-accuracy",
    label: "Color Is Not A Label",
    narrative: `Color ${POLICY_COLOR} is a policy/intent identifier — it is not an MPLS label, a VLAN, a DSCP value, or a literal path color. PacketVerse visually associates Color ${POLICY_COLOR} with "${POLICY_COLOR_NAME}" as an educational label for the intent — that name never appears on the wire.`,
  },
  {
    id: "endpoint-explain",
    label: "Endpoint",
    narrative: `Endpoint: R6 loopback ${ROUTER_LOOPBACK.R6} — this answers "where is this policy trying to deliver traffic?" It is not the same as every hop in the eventual segment list.`,
  },
  {
    id: "predict-color-label",
    label: "Predict",
    narrative: "Before continuing:",
    question: {
      prompt: `Does SR Policy Color ${POLICY_COLOR} become an MPLS label pushed onto every packet?`,
      options: [
        { id: "no", label: "No — Color is a policy identifier, never imposed on the wire" },
        { id: "yes", label: "Yes — the color value is pushed as an extra label" },
      ],
      correctOptionId: "no",
      explanation: "Color is part of the policy's identity, used to select which policy applies. It never appears as a label on the wire.",
    },
  },
  {
    id: "candidate-paths-intro",
    label: "Candidate Paths",
    narrative: "A policy can have multiple candidate paths. Candidate-path preference determines which valid candidate is preferred — higher preference wins, but only among VALID candidates.",
  },
  {
    id: "explicit-candidate-intro",
    label: "Explicit Candidate: GOLD-EXPLICIT",
    narrative: `GOLD-EXPLICIT — type EXPLICIT, preference 200. Its segment list is specified directly: [R3 Node SID, R3→R5 Adj-SID, R6 Node SID]. Conceptual stack: [${R3_LABEL}][${R3_R5_ADJ_SID.label}][${R6_LABEL}][IP].`,
  },
  {
    id: "explicit-candidate-validation",
    label: "Explicit Candidate Validation",
    narrative: "Validation checks: the SID exists, its type is known, its scope is valid, segment ordering is valid, the Adj-SID can execute at its owner, and the endpoint is ultimately reachable. This reuses SR Foundations' own scope rules rather than a new engine.",
    run: (state) => ({ state: { ...state, candidates: [EXPLICIT_CANDIDATE] }, events: [] }),
  },
  {
    id: "dynamic-candidate-intro",
    label: "Dynamic Candidate: GOLD-DYNAMIC",
    narrative: "GOLD-DYNAMIC — type DYNAMIC, preference 100. Instead of a fixed segment list, the headend computes it from the modeled TE topology using TE metric and affinity — not bandwidth reservation. SR Policy does not inherently create RSVP-style bandwidth reservations just because a path was TE-computed.",
  },
  {
    id: "te-attributes",
    label: "TE Attributes",
    narrative: "Top path (R1-R2, R2-R4, R4-R6) is tagged BLUE. Bottom path (R1-R3, R3-R5, R5-R6) is tagged GOLD; R4-R6 also carries GOLD (shared infrastructure). GOLD-DYNAMIC requires INCLUDE GOLD — therefore R1 → R3 → R5 → R6.",
    run: (state) => ({ state: { ...state, candidates: [EXPLICIT_CANDIDATE, DYNAMIC_CANDIDATE] }, events: [] }),
  },
  {
    id: "dynamic-computation",
    label: "Dynamic Computation",
    narrative: "Full TE topology → apply the GOLD constraint → remove non-matching links → shortest valid TE path → derive an SR segment list. Domain logic owns all of this — nothing is UI-hardcoded.",
  },
  {
    id: "dynamic-segment-list",
    label: "Dynamic Segment-List Generation",
    narrative: `R1's ordinary (unconstrained) shortest path to R5 already passes through R3 — so a plain R5 Node SID alone reaches R5 via R3→R5, no Adj-SID required. The computed dynamic segment list is simply [${R5_LABEL}, ${R6_LABEL}] — shorter than the explicit list, same physical path.`,
  },
  {
    id: "candidate-selection-fn",
    label: "selectActiveCandidate()",
    narrative: "Validate every candidate, discard invalid ones, compare preference among the survivors, and the highest-preference valid candidate becomes ACTIVE. An invalid higher-preference candidate never wins merely because its number is larger.",
  },
  {
    id: "policy-state-intro",
    label: "Policy State",
    narrative: "Modeled states: DOWN (no policy configured), NO_VALID_CANDIDATE, RESOLVING (mid re-selection), UP. Shown via the PacketVerse SR Policy Lifecycle — a teaching abstraction, not an official protocol FSM.",
  },
  {
    id: "predict-preference-both-valid",
    label: "Predict",
    narrative: "Two candidate paths are valid: Candidate A preference 200, Candidate B preference 100.",
    question: {
      prompt: "Which candidate should be active?",
      options: [
        { id: "a", label: "Candidate A — higher preference wins among valid candidates" },
        { id: "b", label: "Candidate B — lower preference is always safer" },
      ],
      correctOptionId: "a",
      explanation: "Among valid candidates, the highest preference wins. Candidate A (200) beats Candidate B (100).",
    },
  },
  {
    id: "active-candidate-shown",
    label: "Active Candidate",
    narrative: "Both candidates are VALID. GOLD-EXPLICIT (preference 200) beats GOLD-DYNAMIC (preference 100) — GOLD-EXPLICIT is ACTIVE.",
  },
  {
    id: "segment-list-viewer-intro",
    label: "Segment List — Active Candidate",
    narrative: "The Segment List Viewer renders whichever candidate is currently active — the same generic component used in SR-MPLS Foundations.",
  },
  {
    id: "bsid-intro",
    label: "Binding SID",
    narrative: `R1 allocates a Binding SID for this policy: ${BSID}. The BSID is a local forwarding handle bound to the SR Policy — not another globally-meaningful Node SID, and transit routers are not expected to understand it.`,
  },
  {
    id: "bsid-binding",
    label: "BSID → Policy → Candidate → Segment List",
    narrative: `BSID ${BSID} → Policy Color ${POLICY_COLOR} / Endpoint R6 → Active Candidate (GOLD-EXPLICIT) → Segment List. R1 owns BSID ${BSID}; no other router in this lesson is expected to interpret it.`,
  },
  {
    id: "predict-up-means-steered",
    label: "Predict",
    narrative: "The SR Policy is UP with an active candidate.",
    question: {
      prompt: "Does an UP SR Policy automatically mean every packet toward its endpoint uses it?",
      options: [
        { id: "no", label: "No — traffic must be steered into the policy" },
        { id: "yes", label: "Yes — an UP policy intercepts all matching traffic automatically" },
      ],
      correctOptionId: "no",
      explanation: "Constructing a policy and steering traffic into it are separate functions. A policy can be UP while ordinary IGP still carries traffic that was never classified into it.",
    },
  },
  {
    id: "steering-intro",
    label: "Steering Is Separate From Policy Construction",
    narrative: "Constructing an SR Policy and steering traffic into it are separate functions. A policy can exist and be UP without every packet automatically using it.",
  },
  {
    id: "steering-method",
    label: "Local Traffic Classification",
    narrative: `GOLD application flow, destination R6 → match Color ${POLICY_COLOR} intent → select the SR Policy → resolve BSID → impose the active segment list. (BGP Color Extended Community steering exists in real networks but is out of scope here — mentioned only as an advanced note.)`,
  },
  {
    id: "flows-intro",
    label: "Two Traffic Classes",
    narrative: "DEFAULT flow: ordinary IGP, R1 → R2 → R4 → R6. GOLD flow: steered into SR Policy Color 100, R1 → R3 → R5 → R6. Same destination, different intent.",
  },
  {
    id: "send-gold",
    label: "Send GOLD Traffic",
    narrative: "A GOLD-classified flow toward R6. R1 resolves the policy and imposes the active candidate's segment list.",
    packet: () => ({ id: "ip-gold-1", protocol: "IP" as const, from: "R1", to: "R1", summary: "GOLD flow classified — Color 100", layers: [ipLayer(HOST_BEHIND_R1, HOST_BEHIND_R6)] }),
    run: (state) => ({ state: { ...state, flow: "GOLD", packet: { labels: [], srcIp: HOST_BEHIND_R1, dstIp: HOST_BEHIND_R6 }, packetAt: "R1", journey: [] }, events: [] }),
  },
  {
    id: "gold-r1-classify",
    label: "R1: Classification / Policy Resolution",
    narrative: `Classification matches Color ${POLICY_COLOR} → SR Policy <R1,${POLICY_COLOR},R6> → BSID ${BSID} resolved → active candidate GOLD-EXPLICIT selected.`,
    run: (state) => ({ state: { ...state, journey: [...state.journey, { router: "R1", input: "IP", lookup: `Steering: Color ${POLICY_COLOR} → Policy <R1,${POLICY_COLOR},R6> → BSID ${BSID}`, action: "POLICY_SELECT", output: "GOLD-EXPLICIT selected" }] }, events: [] }),
  },
  {
    id: "gold-r1-push",
    label: "R1: PUSH Active Segment List",
    narrative: `R1 imposes the resolved segment list: [${R3_LABEL}, ${R3_R5_ADJ_SID.label}, ${R6_LABEL}]. The BSID itself resolves locally and is not pushed onto the wire.`,
    packet: (state) => {
      if (!state.packet) return undefined;
      let pkt = pushLabel(state.packet, R6_LABEL);
      pkt = pushLabel(pkt, R3_R5_ADJ_SID.label);
      pkt = pushLabel(pkt, R3_LABEL);
      return mplsPacket("gold-push", "R1", "R3", "impose active segment list", "PUSH", pkt);
    },
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      let pkt = pushLabel(state.packet, R6_LABEL);
      pkt = pushLabel(pkt, R3_R5_ADJ_SID.label);
      pkt = pushLabel(pkt, R3_LABEL);
      return { state: { ...state, packet: pkt, packetAt: "R3", journey: [...state.journey, { router: "R1", input: "policy-resolved", lookup: "Segment list imposed from active candidate", action: "PUSH", output: `${fmtLabel(R3_LABEL)} / ${fmtLabel(R3_R5_ADJ_SID.label)} / ${fmtLabel(R6_LABEL)}` }] }, events: [] };
    },
  },
  {
    id: "gold-r3-node-complete",
    label: "R3: Node SID R3 Completes",
    narrative: "R3 is the target of the active segment — completes on arrival (no PHP for this segment). R3 does not evaluate Color, candidate preference, or BSID — only the imposed SID stack.",
    packet: (state) => (state.packet ? mplsPacket("gold-r3-complete", "R3", "R3", "Node SID R3 self-completes", "POP", popTopLabel(state.packet)) : undefined),
    run: (state) => (state.packet ? { state: { ...state, packet: popTopLabel(state.packet), journey: [...state.journey, { router: "R3", input: fmtLabel(R3_LABEL), lookup: "Active SID = R3 Node SID; R3 is the target", action: "POP", output: fmtLabel(R3_R5_ADJ_SID.label) }] }, events: [] } : { state, events: [] }),
  },
  {
    id: "gold-r3-execute-adj",
    label: "R3: Execute Local Adjacency SID",
    narrative: "R3 owns the active Adj-SID — resolves R3→R5, pops its own label, forwards over that exact link.",
    packet: (state) => (state.packet ? mplsPacket("gold-r3-adj", "R3", "R5", "resolve R3→R5 adjacency", "POP_AND_FORWARD_ADJ", popTopLabel(state.packet)) : undefined),
    run: (state) => (state.packet ? { state: { ...state, packet: popTopLabel(state.packet), packetAt: "R5", journey: [...state.journey, { router: "R3", input: fmtLabel(R3_R5_ADJ_SID.label), lookup: "SID owner = R3 (local); type = adjacency; resolve R3→R5", action: "POP_AND_FORWARD_ADJ", output: `${fmtLabel(R6_LABEL)} → via R3→R5` }] }, events: [] } : { state, events: [] }),
  },
  {
    id: "gold-r5-continue",
    label: "R5: CONTINUE",
    narrative: "Next active segment: R6 Node SID. R5 → R6 follows the ordinary shortest path from R5 — one hop.",
    packet: (state) => (state.packet ? mplsPacket("gold-r5-continue", "R5", "R6", "forward toward R6", "CONTINUE", state.packet) : undefined),
    run: (state) => ({ state: { ...state, packetAt: "R6", journey: [...state.journey, { router: "R5", input: fmtLabel(R6_LABEL), lookup: "Active SID = R6 Node SID; directly connected", action: "CONTINUE", output: fmtLabel(R6_LABEL) }] }, events: [] }),
  },
  {
    id: "gold-r6-pop",
    label: "R6: Final Segment Completes",
    narrative: "R6 pops its own last label, exposing the IP packet.",
    packet: (state) => (state.packet ? mplsPacket("gold-r6-pop", "R6", "R6", "final segment self-completes", "POP", popTopLabel(state.packet)) : undefined),
    run: (state) => (state.packet ? { state: { ...state, packet: popTopLabel(state.packet), journey: [...state.journey, { router: "R6", input: fmtLabel(R6_LABEL), lookup: "Active SID = R6 Node SID; R6 is the target", action: "POP", output: "IP (unlabeled)" }] }, events: [] } : { state, events: [] }),
  },
  {
    id: "gold-deliver",
    label: "R6 Delivers — GOLD Path",
    narrative: "Delivered via R1 → R3 → R5 → R6 — the SR Policy's active candidate, not the ordinary IGP shortest path.",
    packet: (state) => (state.packet ? { id: "delivered-gold", protocol: "IP" as const, from: "R6", to: "R6", summary: "Delivered via SR Policy GOLD-EXPLICIT", layers: buildPacketLayers(state.packet) } : undefined),
    run: (state) => ({ state: { ...state, journey: [...state.journey, { router: "R6", input: "IP", lookup: "IP delivery", action: "IP_FORWARD", output: "Delivered" }] }, events: [] }),
    whatChanged: () => ["Delivered R1 → R3 → R5 → R6 via SR Policy Color 100"],
  },
  {
    id: "default-vs-gold",
    label: "Default vs. GOLD — Same Destination, Different Intent",
    narrative: "DEFAULT traffic: R1 → R2 → R4 → R6, ordinary IGP. GOLD traffic: R1 → R3 → R5 → R6, SR Policy Color 100. Both reach the same endpoint. The intent differs.",
  },
  {
    id: "views-intro",
    label: "Views: Control/Data/Both, Physical/IGP/SR Policy",
    narrative: "Control shows the policy tuple, candidate paths, preferences, TE constraints, validity, BSID binding, and steering rules. Data shows the actual SID stack, active SID, LFIB actions, and physical path.",
  },
  {
    id: "preference-experiment-intro",
    label: "Candidate Preference Experiment",
    narrative: "GOLD-EXPLICIT is preference 200, GOLD-DYNAMIC is preference 100. Lower GOLD-EXPLICIT's preference to 50.",
    run: (state) => ({ state: { ...state, candidates: state.candidates.map((c) => (c.id === "gold-explicit" ? { ...c, preference: 50 } : c)) }, events: [] }),
    whatChanged: () => ["GOLD-EXPLICIT preference: 200 → 50"],
  },
  {
    id: "preference-switch",
    label: "Active Candidate Switches",
    narrative: "Both candidates remain VALID. GOLD-DYNAMIC (preference 100) now beats GOLD-EXPLICIT (preference 50) — GOLD-DYNAMIC becomes ACTIVE. Policy identity did not change; the active candidate did.",
  },
  {
    id: "preference-restore",
    label: "Restore Preference",
    narrative: "Restore GOLD-EXPLICIT to preference 200.",
    run: (state) => ({ state: { ...state, candidates: state.candidates.map((c) => (c.id === "gold-explicit" ? { ...c, preference: 200 } : c)) }, events: [] }),
    whatChanged: () => ["GOLD-EXPLICIT preference: 50 → 200 (restored) — GOLD-EXPLICIT active again"],
  },
  {
    id: "invalidation-intro",
    label: "Candidate Invalidation",
    narrative: "GOLD-EXPLICIT (preference 200) is currently ACTIVE. Now fail the R3-R5 link.",
  },
  {
    id: "fail-r3-r5",
    label: "R3-R5 Link Down",
    narrative: "The explicit segment list's R3→R5 Adj-SID becomes unusable — its underlying link is down.",
    run: (state) => ({ state: { ...state, links: state.links.filter((l) => l.id !== "R3-R5"), packet: undefined, packetAt: undefined, journey: [] }, events: [] }),
    whatChanged: () => ["R3-R5: UP → DOWN", "GOLD-EXPLICIT: VALID → INVALID"],
  },
  {
    id: "predict-invalid-vs-valid",
    label: "Predict",
    narrative: "GOLD-EXPLICIT has preference 200 but is now INVALID. GOLD-DYNAMIC has preference 100 and is VALID.",
    question: {
      prompt: "Which candidate should be active?",
      options: [
        { id: "b", label: "Candidate B (GOLD-DYNAMIC) — the highest-preference VALID candidate wins" },
        { id: "a", label: "Candidate A (GOLD-EXPLICIT) — its preference number is still larger" },
      ],
      correctOptionId: "b",
      explanation: "An invalid higher-preference candidate never wins merely because its number is larger. Preference only compares among VALID candidates.",
    },
  },
  {
    id: "policy-resolving",
    label: "Policy Re-Evaluation",
    narrative: "The headend re-evaluates policy state: GOLD-EXPLICIT is removed as a candidate for selection. This is headend/control-plane policy re-selection — not TI-LFA local repair.",
  },
  {
    id: "dynamic-becomes-active",
    label: "GOLD-DYNAMIC Becomes Active",
    narrative: "GOLD-DYNAMIC recomputes: with R3-R5 down, the GOLD-constrained shortest path is now R1 → R3 → R4 → R6 via the R3-R4 cross-link. It remains VALID and becomes ACTIVE. Policy state remains UP throughout.",
  },
  {
    id: "predict-fallback-tilfa",
    label: "Predict",
    narrative: "GOLD-DYNAMIC just took over from GOLD-EXPLICIT after the failure.",
    question: {
      prompt: "Is candidate-path fallback the same mechanism as TI-LFA local repair?",
      options: [
        { id: "no", label: "No — candidate fallback is headend policy re-selection, not a local precomputed repair" },
        { id: "yes", label: "Yes — both are the same fast-reroute mechanism" },
      ],
      correctOptionId: "no",
      explanation: "Candidate-path fallback requires the headend to learn the topology changed and re-select among its own candidates. TI-LFA is a local, precomputed repair near the failure — a different mechanism, not built in this lesson.",
    },
  },
  {
    id: "not-tilfa",
    label: "This Is Not TI-LFA",
    narrative: "Candidate-path fallback is headend policy re-selection, reacting after the headend learns the topology changed — not a local, precomputed repair near the failure. Candidate fallback is not TI-LFA, and this lesson does not claim any universal sub-50ms repair time.",
  },
  {
    id: "restore-r3-r5",
    label: "Restore R3-R5",
    narrative: "R3-R5 recovers. GOLD-EXPLICIT becomes valid again and, at preference 200, resumes as the active candidate.",
    run: (state) => ({ state: { ...state, links: LINKS }, events: [] }),
    whatChanged: () => ["R3-R5: DOWN → UP", "GOLD-EXPLICIT: INVALID → VALID and ACTIVE"],
  },
  {
    id: "no-valid-candidate-intro",
    label: "No-Valid-Candidate Experiment",
    narrative: "Now fail both R3-R5 and the R3-R4 fallback link.",
  },
  {
    id: "fail-both-gold-links",
    label: "R3-R5 and R3-R4 Both Down",
    narrative: "No GOLD-tagged path remains from R1 to R6. Neither candidate is valid.",
    run: (state) => ({ state: { ...state, links: state.links.filter((l) => l.id !== "R3-R5" && l.id !== "R3-R4") }, events: [] }),
    whatChanged: () => ["R3-R5: UP → DOWN", "R3-R4: UP → DOWN", "GOLD-EXPLICIT: INVALID", "GOLD-DYNAMIC: INVALID"],
  },
  {
    id: "policy-down",
    label: "SR Policy DOWN",
    narrative: "No valid candidate exists. SR Policy Color 100 transitions to DOWN.",
  },
  {
    id: "strict-steering-send",
    label: "Send GOLD Traffic — Strict Steering",
    narrative: "GOLD traffic is strict: if SR Policy Color 100 is DOWN, it does not automatically fall back to default IGP.",
    packet: () => ({ id: "ip-gold-strict", protocol: "IP" as const, from: "R1", to: "R1", summary: "GOLD flow classified — Color 100", layers: [ipLayer(HOST_BEHIND_R1, HOST_BEHIND_R6)] }),
    run: (state) => ({ state: { ...state, flow: "GOLD", fault: { reason: "SR Policy Color 100 is DOWN — no valid candidate" }, packet: { labels: [], srcIp: HOST_BEHIND_R1, dstIp: HOST_BEHIND_R6 }, packetAt: "R1", journey: [] }, events: [] }),
  },
  {
    id: "gold-fails",
    label: "GOLD Flow: Policy Unavailable",
    narrative: "R1 finds no valid candidate for Color 100 — the flow is not steered, and per this lesson's strict rule, it is not silently forwarded via ordinary IGP either.",
    run: (state) => ({ state: { ...state, journey: [...state.journey, { router: "R1", input: "IP", lookup: `Steering: Color ${POLICY_COLOR} → Policy DOWN (no valid candidate)`, action: "POLICY_UNAVAILABLE", output: "FAILED" }] }, events: [] }),
    whatChanged: () => ["GOLD flow: FAILED / POLICY UNAVAILABLE"],
  },
  {
    id: "default-still-healthy",
    label: "DEFAULT Flow Remains Healthy",
    narrative: "Meanwhile, DEFAULT (unclassified) traffic still reaches R6 through ordinary IGP forwarding — reachability and policy intent are separate concerns.",
    packet: () => ({ id: "ip-default-check", protocol: "IP" as const, from: "R1", to: "R6", summary: "DEFAULT flow — ordinary IGP, unaffected", layers: [ipLayer(HOST_BEHIND_R1, HOST_BEHIND_R6)] }),
    run: (state) => ({ state: { ...state, flow: "DEFAULT" }, events: [] }),
  },
  {
    id: "restore-all-links",
    label: "Restore Topology",
    narrative: "Restore R3-R5 and R3-R4. Both candidates return to VALID; GOLD-EXPLICIT (preference 200) resumes as ACTIVE. SR Policy is UP again.",
    run: (state) => ({ state: { ...state, links: LINKS, fault: undefined, packet: undefined, packetAt: undefined, journey: [] }, events: [] }),
    whatChanged: () => ["R3-R5, R3-R4: DOWN → UP", "SR Policy: DOWN → UP", "GOLD-EXPLICIT: ACTIVE"],
  },
  {
    id: "segment-list-weights-note",
    label: "[ADVANCED] Segment-List Weights",
    narrative: "A candidate path can reference one or more segment lists and may use weights to distribute traffic across them (e.g. Segment List A weight 70, Segment List B weight 30). This lesson uses one active segment list per candidate for deterministic forwarding.",
  },
  {
    id: "preference-vs-weight",
    label: "Preference vs. Weight — Not The Same Thing",
    narrative: "Candidate preference chooses which candidate path is active. Segment-list weight (a separate, more advanced concept) can influence traffic distribution among multiple segment lists within one already-active candidate path. Do not conflate them.",
  },
  {
    id: "policy-lab-intro",
    label: "SR Policy Lab",
    narrative: "An interactive lab: adjust candidate preference and required affinity, and watch candidate validity and the active candidate recompute from real domain state.",
  },
  {
    id: "affinity-experiment",
    label: "Affinity Experiment",
    narrative: "Toggle GOLD-DYNAMIC's required affinity between GOLD and NONE. With GOLD, the dynamic candidate follows GOLD-tagged links. With NONE, it may collapse back toward the shorter, lower-TE-metric top path.",
  },
  {
    id: "troubleshooting-intro",
    label: "Incident",
    narrative: "GOLD application traffic reaches R6. No packet loss reported. IGP is healthy. SID forwarding is healthy. SR Policy 100 is UP. Traffic is not using the engineered explicit path operations expected.",
    run: (state) => ({
      state: {
        ...state,
        troubleshooting: { ...state.troubleshooting, started: true },
        candidates: [{ ...EXPLICIT_CANDIDATE, preference: 80 }, DYNAMIC_CANDIDATE],
        links: LINKS,
        fault: undefined,
        packet: undefined,
        packetAt: undefined,
        journey: [],
      },
      events: [{ type: "MPLS_LSP_CHANGED", stepId: "troubleshooting-intro", timestamp: Date.now(), message: "Incident: GOLD traffic using GOLD-DYNAMIC instead of expected GOLD-EXPLICIT" }],
    }),
  },
  {
    id: "incident-trace",
    label: "Trace The Packet",
    narrative: "Operations expected GOLD-EXPLICIT. The packet trace instead follows GOLD-DYNAMIC — reaching R6 via a different, still-valid path.",
    packet: () => ({ id: "ip-incident", protocol: "IP" as const, from: "R1", to: "R1", summary: "GOLD flow — tracing actual candidate in use", layers: [ipLayer(HOST_BEHIND_R1, HOST_BEHIND_R6)] }),
    run: (state) => ({ state: { ...state, flow: "GOLD", packet: { labels: [], srcIp: HOST_BEHIND_R1, dstIp: HOST_BEHIND_R6 }, packetAt: "R1", journey: [{ router: "R1", input: "IP", lookup: `Steering: Color ${POLICY_COLOR} → active candidate resolved`, action: "POLICY_SELECT", output: "GOLD-DYNAMIC selected (unexpected)" }] }, events: [] }),
  },
  {
    id: "diagnostic-ladder",
    label: "Diagnostic Ladder",
    narrative: "Physical topology, IGP, SR capability, the SID database, endpoint R6, policy existence, policy state, and both candidates' validity are all healthy. Candidate preference and the expected active candidate are wrong. Segment forwarding and endpoint delivery still succeed — connectivity is healthy while TE intent is wrong.",
  },
  {
    id: "repair-challenge",
    label: "Apply The Fix",
    narrative: "Choose the correct repair to restore GOLD-EXPLICIT as the active candidate.",
    action: (state, payload) => {
      const choice = typeof payload === "object" && payload !== null && "choice" in payload ? String((payload as { choice: string }).choice) : "";
      const correct = choice === "restore-explicit-preference";
      const candidates = correct ? state.candidates.map((c) => (c.id === "gold-explicit" ? { ...c, preference: 200 } : c)) : state.candidates;
      return { state: { ...state, candidates, troubleshooting: { ...state.troubleshooting, repairAttempt: { choice, correct } } }, events: [] };
    },
    requiresState: (state) => state.troubleshooting.repairAttempt?.correct === true,
  },
  {
    id: "verify-resend",
    label: "Verify: Resend GOLD Traffic",
    narrative: "The preference fix alone doesn't complete the incident — resend the GOLD test flow and confirm the physical path.",
    packet: () => ({ id: "ip-verify", protocol: "IP" as const, from: "R1", to: "R1", summary: "GOLD flow — verifying repair", layers: [ipLayer(HOST_BEHIND_R1, HOST_BEHIND_R6)] }),
    run: (state) => ({ state: { ...state, packet: { labels: [], srcIp: HOST_BEHIND_R1, dstIp: HOST_BEHIND_R6 }, packetAt: "R1", journey: [] }, events: [] }),
  },
  {
    id: "verify-r1-push",
    label: "R1: PUSH Restored Explicit Segment List",
    narrative: "GOLD-EXPLICIT (preference 200) is active again — R1 imposes its segment list.",
    packet: (state) => {
      if (!state.packet) return undefined;
      let pkt = pushLabel(state.packet, R6_LABEL);
      pkt = pushLabel(pkt, R3_R5_ADJ_SID.label);
      pkt = pushLabel(pkt, R3_LABEL);
      return mplsPacket("verify-push", "R1", "R3", "impose GOLD-EXPLICIT segment list", "PUSH", pkt);
    },
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      let pkt = pushLabel(state.packet, R6_LABEL);
      pkt = pushLabel(pkt, R3_R5_ADJ_SID.label);
      pkt = pushLabel(pkt, R3_LABEL);
      return { state: { ...state, packet: pkt, packetAt: "R3", journey: [...state.journey, { router: "R1", input: "policy-resolved", lookup: "GOLD-EXPLICIT active — segment list imposed", action: "PUSH", output: `${fmtLabel(R3_LABEL)} / ${fmtLabel(R3_R5_ADJ_SID.label)} / ${fmtLabel(R6_LABEL)}` }] }, events: [] };
    },
  },
  {
    id: "verify-transit",
    label: "R3 → R5 → R6",
    narrative: "R3 completes its Node SID, executes the local Adj-SID toward R5; R5 continues toward R6; R6 completes and delivers.",
    packet: (state) => (state.packet ? mplsPacket("verify-transit", "R3", "R5", "execute Adj-SID", "POP_AND_FORWARD_ADJ", popTopLabel(popTopLabel(state.packet))) : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const afterR3 = popTopLabel(popTopLabel(state.packet));
      return {
        state: {
          ...state,
          packet: afterR3,
          packetAt: "R6",
          journey: [
            ...state.journey,
            { router: "R3", input: fmtLabel(R3_LABEL), lookup: "Active SID = R3 Node SID; target", action: "POP", output: fmtLabel(R3_R5_ADJ_SID.label) },
            { router: "R3", input: fmtLabel(R3_R5_ADJ_SID.label), lookup: "Owner = R3; resolve R3→R5", action: "POP_AND_FORWARD_ADJ", output: `${fmtLabel(R6_LABEL)} → via R3→R5` },
            { router: "R5", input: fmtLabel(R6_LABEL), lookup: "Active SID = R6 Node SID; directly connected", action: "CONTINUE", output: fmtLabel(R6_LABEL) },
          ],
        },
        events: [],
      };
    },
  },
  {
    id: "verify-deliver",
    label: "R6 Delivers — Repair Verified",
    narrative: "Delivered via R1 → R3 → R5 → R6 — GOLD-EXPLICIT restored as the active, intended candidate.",
    packet: (state) => (state.packet ? { id: "delivered-verify", protocol: "IP" as const, from: "R6", to: "R6", summary: "Delivered via restored GOLD-EXPLICIT", layers: buildPacketLayers(popTopLabel(state.packet)) } : undefined),
    run: (state) =>
      state.packet
        ? {
            state: {
              ...state,
              packet: popTopLabel(state.packet),
              troubleshooting: { ...state.troubleshooting, verified: true },
              journey: [...state.journey, { router: "R6", input: fmtLabel(R6_LABEL), lookup: "Active SID = R6 Node SID; target", action: "POP", output: "IP (unlabeled)" }, { router: "R6", input: "IP", lookup: "IP delivery", action: "IP_FORWARD", output: "Delivered" }],
            },
            events: [],
          }
        : { state, events: [] },
    whatChanged: () => ["Delivered R1 → R3 → R5 → R6 — repair verified"],
  },
  {
    id: "engineer-challenge",
    label: "Engineer Challenge — Build The Intent",
    narrative: "GOLD traffic from R1 to R6 must use SR Policy Color 100, prefer an explicit candidate through R3 forcing R3→R5, terminate at R6, and retain a lower-preference valid dynamic fallback.",
  },
  {
    id: "complete",
    label: "Lesson Complete",
    narrative: "You built and steered a real SR Policy — identity, candidate paths, preference-based selection, a computed dynamic fallback, a Binding SID, and traffic steering distinct from IGP reachability.",
  },
];

export const STEP_IDX = {
  policyIdentity: stepIdx(srPolicySteps, "policy-identity"),
  explicitCandidateValidation: stepIdx(srPolicySteps, "explicit-candidate-validation"),
  teAttributes: stepIdx(srPolicySteps, "te-attributes"),
  bsidIntro: stepIdx(srPolicySteps, "bsid-intro"),
  viewsIntro: stepIdx(srPolicySteps, "views-intro"),
  preferenceExperimentIntro: stepIdx(srPolicySteps, "preference-experiment-intro"),
  invalidationIntro: stepIdx(srPolicySteps, "invalidation-intro"),
  noValidCandidateIntro: stepIdx(srPolicySteps, "no-valid-candidate-intro"),
  policyLabIntro: stepIdx(srPolicySteps, "policy-lab-intro"),
  troubleshootingIntro: stepIdx(srPolicySteps, "troubleshooting-intro"),
  diagnosticLadder: stepIdx(srPolicySteps, "diagnostic-ladder"),
  repairChallenge: stepIdx(srPolicySteps, "repair-challenge"),
  engineerChallenge: stepIdx(srPolicySteps, "engineer-challenge"),
};

function stepIdx(steps: ScenarioStep<SrPolicyState>[], id: string): number {
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
  cisco: CliOutput;
  juniper: CliOutput;
}

export function buildSrPolicyCliCommands(state: SrPolicyState, router: RouterId): CliCommandEntry[] {
  const evals = candidateEvaluations(state);
  const active = selectActiveCandidate(evals);
  const pState = determinePolicyState(active, state.policyConfigured);
  const policyTab: CliCommandEntry = {
    id: "policy",
    label: "sr policy",
    cisco: {
      cmd: "show segment-routing traffic-eng policy color 100 endpoint 10.0.0.6",
      output: state.policyConfigured
        ? `Name: srte_c_100_10.0.0.6\n  Color: ${POLICY_COLOR}  Endpoint: 10.0.0.6\n  Status: ${pState}\n  BSID: ${BSID}\n  Candidate Paths:\n${evals.map((e) => `    ${e.def.name} pref ${e.def.preference} ${e.valid ? "valid" : "invalid"}${e === active ? " (active)" : ""}`).join("\n")}`
        : "% Policy not configured",
    },
    juniper: {
      cmd: "show sr-te policy color 100 endpoint 10.0.0.6",
      output: state.policyConfigured ? `Color: ${POLICY_COLOR}, Endpoint: 10.0.0.6, State: ${pState}, BSID: ${BSID}` : "policy not found",
    },
  };
  const candidatesTab: CliCommandEntry = {
    id: "candidates",
    label: "candidate paths",
    cisco: {
      cmd: "show segment-routing traffic-eng policy color 100 endpoint 10.0.0.6 detail",
      output: evals.map((e) => `${e.def.name}: type ${e.def.type}, preference ${e.def.preference}, ${e.valid ? "VALID" : "INVALID"} (${e.reason})`).join("\n"),
    },
    juniper: {
      cmd: "show sr-te policy candidate-path",
      output: evals.map((e) => `${e.def.name} pref=${e.def.preference} ${e.valid ? "up" : "down"}`).join("\n"),
    },
  };
  const fwdTab: CliCommandEntry = {
    id: "forwarding",
    label: "forwarding",
    cisco: {
      cmd: "show mpls forwarding-table",
      output: state.packet && state.packet.labels.length ? `Local label: ${fmtLabel(state.packet.labels[0].value)}\nOutgoing: ${state.packet.labels[1] ? fmtLabel(state.packet.labels[1].value) : "pop"}` : "no active label",
    },
    juniper: {
      cmd: "show route table mpls.0",
      output: state.packet && state.packet.labels.length ? `${fmtLabel(state.packet.labels[0].value)}    Pop/Swap` : "empty",
    },
  };
  void router;
  return [policyTab, candidatesTab, fwdTab];
}
