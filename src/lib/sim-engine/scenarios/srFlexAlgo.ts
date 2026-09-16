import type { PacketLayer, PacketVisual, ScenarioStep } from "../types";

/**
 * SR-MPLS Flex-Algo — algorithm-specific SPF, Flex-Algo Definitions
 * (FAD), affinities, metrics, and algorithm-specific Prefix-SIDs.
 *
 * Continues directly from /demo/sr-mpls-foundations (Node SID, SRGB),
 * /demo/sr-policy (candidate paths — explicitly NOT what this lesson
 * is about), and /demo/sr-ti-lfa (local repair — explicitly a
 * different, later-layered concern).
 *
 * Central question: what if we want the IGP to calculate ANOTHER
 * shortest-path topology, using different constraints, alongside the
 * normal one?
 *
 *                 R2 ─────── R4
 *                /             \
 *               /               \
 *             R1                 R6
 *               \               /
 *                \             /
 *                 R3 ─────── R5
 *
 * Required links: R1-R2, R2-R4, R4-R6 (top/BLUE), R1-R3, R3-R5, R5-R6
 * (bottom/GOLD). One optional cross-link, R3-R4 (affinity-neutral,
 * cheap), included specifically so the "same algorithm, changed link
 * attribute, different selected path" experiment (brief §24-25) has a
 * real third route to discover — reused ONLY in the read-only Flex-Algo
 * Lab, never mutating the main lesson's narrative state.
 *
 * Same base SRGB/Node-SID scheme as srMplsFoundations.ts (SRGB_START
 * 16000, per-router index 1..6), extended with a per-algorithm index
 * offset (Algorithm 0: +0, Algorithm 128: +100) so the SAME destination
 * prefix (10.0.0.6/32) carries two independently-derived, independently
 * forwarding-correct Prefix-SIDs — never a hand-picked pair of numbers.
 *
 * Explicitly deferred (do not build here): SRv6, PCEP, BGP SR Policy,
 * multi-area/inter-domain Flex-Algo, a full FAD-election simulation
 * (only ONE authoritative definition per algorithm is ever modeled in
 * this lesson; `selectFlexAlgoDefinition` exists as a real, documented
 * pure function for architectural completeness, but is never exercised
 * against a genuine conflict — the main fault is a participation fault,
 * per the brief's own "prefer accuracy over sophistication" guidance),
 * Flex-Algo-aware TI-LFA (mentioned once as a note, never simulated), a
 * second SR Policy simulator.
 *
 * Pure data + pure functions only — see /lib/sim-engine/types.ts.
 */

export type RouterId = "R1" | "R2" | "R3" | "R4" | "R5" | "R6";
export const ALL_ROUTERS: RouterId[] = ["R1", "R2", "R3", "R4", "R5", "R6"];
export const HEADEND: RouterId = "R1";
export const DESTINATION: RouterId = "R6";

export type LinkId = "R1-R2" | "R2-R4" | "R4-R6" | "R1-R3" | "R3-R5" | "R5-R6" | "R3-R4";
export type AffinityColor = "BLUE" | "GOLD";
export interface LinkDef {
  id: LinkId;
  a: RouterId;
  b: RouterId;
  igpMetric: number;
  teMetric: number;
  delayMetric: number;
  affinity?: AffinityColor;
}
export const BASE_LINKS: LinkDef[] = [
  { id: "R1-R2", a: "R1", b: "R2", igpMetric: 10, teMetric: 10, delayMetric: 30, affinity: "BLUE" },
  { id: "R2-R4", a: "R2", b: "R4", igpMetric: 10, teMetric: 10, delayMetric: 30, affinity: "BLUE" },
  { id: "R4-R6", a: "R4", b: "R6", igpMetric: 10, teMetric: 10, delayMetric: 30, affinity: "BLUE" },
  { id: "R1-R3", a: "R1", b: "R3", igpMetric: 20, teMetric: 20, delayMetric: 5, affinity: "GOLD" },
  { id: "R3-R5", a: "R3", b: "R5", igpMetric: 20, teMetric: 20, delayMetric: 5, affinity: "GOLD" },
  { id: "R5-R6", a: "R5", b: "R6", igpMetric: 20, teMetric: 20, delayMetric: 5, affinity: "GOLD" },
  { id: "R3-R4", a: "R3", b: "R4", igpMetric: 5, teMetric: 5, delayMetric: 3 },
];
export const TOP_PATH: RouterId[] = ["R1", "R2", "R4", "R6"];
export const BOTTOM_PATH: RouterId[] = ["R1", "R3", "R5", "R6"];

export const TERMS: { term: string; expansion: string; meaning: string }[] = [
  { term: "Algorithm 0", expansion: "Default SPF", meaning: "Ordinary IGP shortest-path calculation — not a user-defined Flex-Algo, just the standard algorithm every router already runs." },
  { term: "FAD", expansion: "Flex-Algo Definition", meaning: "The algorithm ID, metric type, and affinity constraints that define one algorithm-specific topology — distributed via the IGP, not configured as an SR Policy object." },
  { term: "Affinity", expansion: "Admin Group / Color", meaning: "A tag on a link (e.g. BLUE, GOLD) that a Flex-Algo Definition can require (include) or forbid (exclude) — a participation rule, not a cost." },
  { term: "Algo Prefix-SID", expansion: "Algorithm-Specific Prefix-SID", meaning: "The same prefix, advertised with a different SID per algorithm — each one means \"reach this prefix via THAT algorithm's own calculated topology,\" not a hardcoded path." },
];

// ---------------------------------------------------------------------------
// SRGB / algorithm-specific Node-SID model — same SRGB_START/per-router
// index scheme as srMplsFoundations.ts, extended with a per-algorithm
// index offset so Algorithm 0 and Algorithm 128 derive two genuinely
// different, independently-computed labels for the same router.
// ---------------------------------------------------------------------------
export type AlgorithmId = 0 | 128;
export const ALGORITHMS: AlgorithmId[] = [0, 128];
export const ALGORITHM_NAME: Record<AlgorithmId, string> = { 0: "Algorithm 0 (Default SPF)", 128: "Flex-Algo 128 (LOW-LATENCY)" };

export const SRGB_START = 16000;
export const NODE_SID_INDEX: Record<RouterId, number> = { R1: 1, R2: 2, R3: 3, R4: 4, R5: 5, R6: 6 };
export const ALGO_INDEX_OFFSET: Record<AlgorithmId, number> = { 0: 0, 128: 100 };
export function deriveAlgoNodeSidLabel(router: RouterId, algorithm: AlgorithmId): number {
  return SRGB_START + ALGO_INDEX_OFFSET[algorithm] + NODE_SID_INDEX[router];
}
export const R6_ALGO0_SID = deriveAlgoNodeSidLabel("R6", 0); // 16006
export const R6_ALGO128_SID = deriveAlgoNodeSidLabel("R6", 128); // 16106
/** Named to match the brief's function list exactly — same derivation as deriveAlgoNodeSidLabel, kept as a separate export so "algorithm-specific Prefix-SID" is discoverable by that name. */
export function deriveAlgorithmPrefixSid(router: RouterId, algorithm: AlgorithmId): number {
  return deriveAlgoNodeSidLabel(router, algorithm);
}

export interface SidRow {
  prefix?: string;
  router?: string;
  sidType: "NODE";
  algorithm: string;
  sidIndex?: number;
  localLabel: number;
  scope: "GLOBAL";
  meaning?: string;
  installed?: boolean;
}
export function buildSidDatabase(participation: Record<RouterId, AlgorithmId[]>): SidRow[] {
  const rows: SidRow[] = [];
  for (const router of ALL_ROUTERS) {
    for (const algo of ALGORITHMS) {
      const participates = participation[router]?.includes(algo) ?? false;
      rows.push({
        prefix: `10.0.0.${NODE_SID_INDEX[router]}/32`,
        router,
        sidType: "NODE",
        algorithm: String(algo),
        sidIndex: ALGO_INDEX_OFFSET[algo] + NODE_SID_INDEX[router],
        localLabel: deriveAlgoNodeSidLabel(router, algo),
        scope: "GLOBAL",
        meaning: `Reach ${router} via ${ALGORITHM_NAME[algo]}'s own calculated topology.`,
        installed: participates,
      });
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Generic shortest-path helpers — brute force over simple paths (tiny
// topology), same technique as every other scenario file in this repo.
// ---------------------------------------------------------------------------
function neighborsOf(links: LinkDef[]): Partial<Record<RouterId, { to: RouterId; link: LinkDef }[]>> {
  const adj: Partial<Record<RouterId, { to: RouterId; link: LinkDef }[]>> = {};
  for (const l of links) {
    (adj[l.a] ??= []).push({ to: l.b, link: l });
    (adj[l.b] ??= []).push({ to: l.a, link: l });
  }
  return adj;
}
function allSimplePaths(links: LinkDef[], from: RouterId, to: RouterId): RouterId[][] {
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
      if (visited.has(next)) continue;
      visited.add(next);
      path.push(next);
      dfs(next);
      path.pop();
      visited.delete(next);
    }
  }
  dfs(from);
  return results;
}
function linkBetween(links: LinkDef[], x: RouterId, y: RouterId): LinkDef | undefined {
  return links.find((l) => (l.a === x && l.b === y) || (l.b === x && l.a === y));
}
export type MetricType = "IGP" | "TE" | "DELAY";
function metricOf(link: LinkDef, metricType: MetricType): number {
  return metricType === "IGP" ? link.igpMetric : metricType === "TE" ? link.teMetric : link.delayMetric;
}
/** Named to match the brief's function list — Algorithm 0 is always IGP; any other algorithm uses whatever metric type its own FAD specifies. Kept trivial and explicit rather than folded inline, so "which metric applies to which algorithm" is answerable by reading one function. */
export function selectAlgorithmMetric(def: Pick<FlexAlgoDefinition, "algorithm" | "metricType">): MetricType {
  return def.algorithm === 0 ? "IGP" : def.metricType;
}
function pathCost(path: RouterId[], links: LinkDef[], metricType: MetricType): number {
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const l = linkBetween(links, path[i], path[i + 1]);
    total += l ? metricOf(l, metricType) : Number.POSITIVE_INFINITY;
  }
  return total;
}
function shortestPath(links: LinkDef[], from: RouterId, to: RouterId, metricType: MetricType): { path: RouterId[]; cost: number } | undefined {
  if (from === to) return { path: [from], cost: 0 };
  const candidates = allSimplePaths(links, from, to).map((path) => ({ path, cost: pathCost(path, links, metricType) }));
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
// Flex-Algo Definition (FAD) — distributed via the IGP, not an SR
// Policy object. Algorithm 0 has none of this: it is the standard SPF
// algorithm every router already runs, always using IGP metric, with
// no affinity constraints and no participation opt-in.
// ---------------------------------------------------------------------------
export interface FlexAlgoDefinition {
  algorithm: AlgorithmId;
  metricType: MetricType;
  includeAffinity?: AffinityColor;
  excludeAffinity?: AffinityColor;
  priority: number;
  source: RouterId;
}
export const ALGO0_DEFINITION: FlexAlgoDefinition = { algorithm: 0, metricType: "IGP", priority: 0, source: HEADEND };
export const FAD_128: FlexAlgoDefinition = { algorithm: 128, metricType: "DELAY", excludeAffinity: "BLUE", priority: 100, source: "R1" };

/**
 * Deterministic FAD election (documented PacketVerse simplification of
 * RFC 9350 §11: highest priority wins; ties broken by highest
 * originating router id). This lesson never actually hands it a
 * genuine conflict — every participating router is always modeled as
 * advertising the SAME FAD_128 — but the function is real and pure,
 * not a stub, so a future lesson could exercise it against a real
 * multi-definition scenario without rewriting this one.
 */
export function selectFlexAlgoDefinition(definitions: FlexAlgoDefinition[], algorithm: AlgorithmId): FlexAlgoDefinition | undefined {
  const candidates = definitions.filter((d) => d.algorithm === algorithm);
  if (candidates.length === 0) return undefined;
  return [...candidates].sort((a, b) => b.priority - a.priority || b.source.localeCompare(a.source))[0];
}

/** Every router always participates in Algorithm 0 — it is not opt-in. Algorithm 128 participation is explicit per router. */
export function determineParticipatingRouters(participation: Record<RouterId, AlgorithmId[]>, algorithm: AlgorithmId): RouterId[] {
  if (algorithm === 0) return [...ALL_ROUTERS];
  return ALL_ROUTERS.filter((r) => participation[r]?.includes(algorithm));
}

/** Affinity filter — a participation rule for which LINKS may be used, entirely separate from metric type (which only decides cost, never eligibility). */
export function filterTopologyByAffinity(links: LinkDef[], def: Pick<FlexAlgoDefinition, "includeAffinity" | "excludeAffinity">): LinkDef[] {
  return links.filter((l) => {
    if (def.excludeAffinity && l.affinity === def.excludeAffinity) return false;
    if (def.includeAffinity && l.affinity !== def.includeAffinity) return false;
    return true;
  });
}

/** Non-participating routers (and every link touching one) are removed entirely from an algorithm's topology — real Flex-Algo semantics: a non-participating router neither computes nor is reachable within that algorithm's topology. */
export function buildAlgorithmTopology(links: LinkDef[], def: FlexAlgoDefinition, participatingRouters: RouterId[]): LinkDef[] {
  const byAffinity = def.algorithm === 0 ? links : filterTopologyByAffinity(links, def);
  const participants = new Set(participatingRouters);
  return byAffinity.filter((l) => participants.has(l.a) && participants.has(l.b));
}

export interface AlgorithmSpfResult {
  algorithm: AlgorithmId;
  metricType: MetricType;
  eligibleLinks: LinkId[];
  rejectedLinks: { id: LinkId; reason: string }[];
  path?: RouterId[];
  totalMetric?: number;
}
/** The pure algorithm-specific SPF: filter by participation + affinity, then shortest-path by the algorithm's own metric type. This is what "each participating router computes its own SPF for Algorithm 128" means — called once per router in principle, but the computation itself never depends on which router asked. */
export function computeAlgorithmSpf(links: LinkDef[], def: FlexAlgoDefinition, participatingRouters: RouterId[], from: RouterId, to: RouterId): AlgorithmSpfResult {
  const eligible = buildAlgorithmTopology(links, def, participatingRouters);
  const eligibleIds = new Set(eligible.map((l) => l.id));
  const rejectedLinks = links
    .filter((l) => !eligibleIds.has(l.id))
    .map((l) => {
      const participants = new Set(participatingRouters);
      if (!participants.has(l.a) || !participants.has(l.b)) return { id: l.id, reason: `${!participants.has(l.a) ? l.a : l.b} is not participating in ${ALGORITHM_NAME[def.algorithm]}` };
      if (def.excludeAffinity && l.affinity === def.excludeAffinity) return { id: l.id, reason: `Excluded — carries affinity ${l.affinity}` };
      if (def.includeAffinity && l.affinity !== def.includeAffinity) return { id: l.id, reason: `Excluded — does not carry required affinity ${def.includeAffinity}` };
      return { id: l.id, reason: "Excluded" };
    });
  const sp = shortestPath(eligible, from, to, selectAlgorithmMetric(def));
  return { algorithm: def.algorithm, metricType: def.metricType, eligibleLinks: eligible.map((l) => l.id), rejectedLinks, path: sp?.path, totalMetric: sp?.cost };
}

/** Validates that an ALREADY-SELECTED path stays fully inside the algorithm's current participating-router set — this is what "algorithm topology continuity" means, and what a participation fault breaks. */
export function validateAlgorithmContinuity(path: RouterId[] | undefined, participatingRouters: RouterId[]): { valid: boolean; reason: string } {
  if (!path) return { valid: false, reason: "No path computed for this algorithm." };
  const participants = new Set(participatingRouters);
  const nonParticipant = path.find((r) => !participants.has(r));
  if (nonParticipant) return { valid: false, reason: `${nonParticipant} is on the computed path but is not participating — algorithm topology continuity is broken.` };
  return { valid: true, reason: "Every router on the path participates in this algorithm." };
}

// ---------------------------------------------------------------------------
// LFIB / algorithm-specific SID forwarding install
// ---------------------------------------------------------------------------
export interface LfibEntry {
  label: number;
  algorithm: AlgorithmId;
  nextHop?: RouterId;
  valid: boolean;
}
/** "Installing" a SID's forwarding here just means recording, per algorithm, which neighbor the headend's own next hop is — used by the packet-journey builder and the LFIB device-explorer tab. `spf.path` is already participant/affinity-filtered by construction (computeAlgorithmSpf), so a present path is always currently valid; never re-run per packet. */
export function installAlgorithmSidForwarding(spf: AlgorithmSpfResult, router: RouterId): LfibEntry | undefined {
  if (spf.path?.[0] !== router) return undefined;
  const label = deriveAlgoNodeSidLabel(DESTINATION, spf.algorithm);
  return { label, algorithm: spf.algorithm, nextHop: spf.path[1], valid: spf.path.length > 1 };
}

// ---------------------------------------------------------------------------
// MPLS label stack — single label in the main example (brief §30),
// plain numeric labels (matches srPolicy.ts's convention).
// ---------------------------------------------------------------------------
export interface MplsLabel {
  value: number;
  bottomOfStack: boolean;
}
export interface MplsPacketState {
  srcIp: string;
  dstIp: string;
  labels: MplsLabel[];
}
function pushLabel(pkt: MplsPacketState, value: number): MplsPacketState {
  return { ...pkt, labels: [{ value, bottomOfStack: true }] };
}
function popLabel(pkt: MplsPacketState): MplsPacketState {
  return { ...pkt, labels: [] };
}

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
  repairAttempt?: { choice: string; correct: boolean };
  repaired: boolean;
  verified: boolean;
}

export interface SrFlexAlgoState {
  links: LinkDef[];
  flexAlgoDefinitions: FlexAlgoDefinition[];
  algorithmParticipation: Record<RouterId, AlgorithmId[]>;
  activeAlgorithm: AlgorithmId;
  packet?: MplsPacketState;
  packetAt?: RouterId;
  journey: JourneyHop[];
  troubleshooting: TroubleshootingState;
}

export function createSrFlexAlgoState(): SrFlexAlgoState {
  const participation: Record<RouterId, AlgorithmId[]> = {
    R1: [0, 128],
    R2: [0, 128],
    R3: [0, 128],
    R4: [0, 128],
    R5: [0, 128],
    R6: [0, 128],
  };
  return {
    links: BASE_LINKS,
    flexAlgoDefinitions: [ALGO0_DEFINITION, FAD_128],
    algorithmParticipation: participation,
    activeAlgorithm: 0,
    journey: [],
    troubleshooting: { started: false, repaired: false, verified: false },
  };
}

/** Convenience: the currently-selected FAD for a given algorithm, from this state's own definitions (never assumes FAD_128 directly — always goes through selectFlexAlgoDefinition, so a future multi-definition scenario needs no rewiring). */
export function activeDefinitionFor(state: Pick<SrFlexAlgoState, "flexAlgoDefinitions">, algorithm: AlgorithmId): FlexAlgoDefinition {
  if (algorithm === 0) return ALGO0_DEFINITION;
  return selectFlexAlgoDefinition(state.flexAlgoDefinitions, algorithm) ?? FAD_128;
}
export function spfFor(state: Pick<SrFlexAlgoState, "links" | "flexAlgoDefinitions" | "algorithmParticipation">, algorithm: AlgorithmId): AlgorithmSpfResult {
  const def = activeDefinitionFor(state, algorithm);
  const participants = determineParticipatingRouters(state.algorithmParticipation, algorithm);
  return computeAlgorithmSpf(state.links, def, participants, HEADEND, DESTINATION);
}
/** Named to match the brief's function list — the path a packet carrying that algorithm's Prefix-SID actually takes is simply that algorithm's own SPF result; there is no separate per-packet computation. */
export function computeAlgorithmPacketPath(state: Pick<SrFlexAlgoState, "links" | "flexAlgoDefinitions" | "algorithmParticipation">, algorithm: AlgorithmId): RouterId[] | undefined {
  return spfFor(state, algorithm).path;
}

// ---------------------------------------------------------------------------
// Graph layout
// ---------------------------------------------------------------------------
export const GRAPH_NODES = [
  { id: "R1", label: "R1", x: 5, y: 50, subLabel: "Headend" },
  { id: "R2", label: "R2", x: 40, y: 20 },
  { id: "R4", label: "R4", x: 70, y: 20 },
  { id: "R3", label: "R3", x: 40, y: 80 },
  { id: "R5", label: "R5", x: 70, y: 80 },
  { id: "R6", label: "R6", x: 96, y: 50, subLabel: "Destination" },
];
export const GRAPH_EDGES: { id: LinkId; a: RouterId; b: RouterId }[] = BASE_LINKS.map((l) => ({ id: l.id, a: l.a, b: l.b }));

// ---------------------------------------------------------------------------
// Packet builders
// ---------------------------------------------------------------------------
function ipLayer(src: string, dst: string): PacketLayer {
  return { name: "IPv4", color: "var(--pv-proto-ip)", fields: [{ label: "Source IP", value: src }, { label: "Destination IP", value: dst }] };
}
function shimLayer(label: MplsLabel, algorithm: AlgorithmId): PacketLayer {
  return {
    name: `MPLS Shim (Algorithm ${algorithm})`,
    color: "var(--pv-proto-mpls)",
    fields: [
      { label: "Label", value: String(label.value) },
      { label: "Algorithm", value: String(algorithm) },
      { label: "S (Bottom of Stack)", value: label.bottomOfStack ? "1" : "0" },
    ],
  };
}
export function buildPacketLayers(pkt: MplsPacketState, algorithm: AlgorithmId): PacketLayer[] {
  return [...pkt.labels.map((l) => shimLayer(l, algorithm)), ipLayer(pkt.srcIp, pkt.dstIp)];
}
function mplsPacket(id: string, from: RouterId, to: RouterId, summary: string, badge: string, pkt: MplsPacketState, algorithm: AlgorithmId): PacketVisual {
  return { id, protocol: "MPLS", from, to, summary, badge, layers: buildPacketLayers(pkt, algorithm) };
}
const HOST_BEHIND_R1 = "10.1.1.10";
const HOST_BEHIND_R6 = "10.6.6.20";

// ---------------------------------------------------------------------------
// Scenario steps
// ---------------------------------------------------------------------------

export const srFlexAlgoSteps: ScenarioStep<SrFlexAlgoState>[] = [
  {
    id: "intro",
    label: "The Central Question",
    narrative: "You already know that normal Node-SID forwarding follows the IGP shortest path. This lesson asks: what if we want the IGP to calculate ANOTHER shortest-path topology, using different constraints, alongside the normal one?",
  },
  {
    id: "recap-known",
    label: "Recap: What You Already Know",
    narrative: "SR-MPLS Foundations: a Node SID means \"reach this router via its own current shortest path.\" SR Policy: headend intent, candidate paths, preference — a completely different mechanism from what this lesson builds. TI-LFA: local repair around a failure — a later-layered concern, not what Flex-Algo is about.",
  },
  {
    id: "mental-model",
    label: "The Mental Model",
    narrative: "Physical topology → IGP link attributes → Flex-Algo Definition → constrained topology → algorithm-specific SPF → algorithm-specific Prefix-SID → a different forwarding path. Every arrow here is computed, distributed, and calculated — nothing is hardcoded.",
  },
  {
    id: "topology-intro",
    label: "Topology",
    narrative: "R1 is the headend, R6 the destination, with two direct branches: top via R2/R4 and bottom via R3/R5. IGP metrics: R1-R2=10, R2-R4=10, R4-R6=10 (top, total 30); R1-R3=20, R3-R5=20, R5-R6=20 (bottom, total 60). The ordinary IGP shortest path is the top branch.",
  },
  {
    id: "algo0-explain",
    label: "Algorithm 0",
    narrative: "Algorithm 0 = the ordinary, default IGP shortest-path calculation every router already runs. It is NOT \"just another Flex-Algo\" — it's the standard algorithm, with no Flex-Algo Definition, no affinity constraints, and no opt-in participation. Every Flex-Algo is defined in contrast to it.",
    run: (state) => ({ state, events: [{ type: "OSPF_SPF_COMPLETED", stepId: "algo0-explain", timestamp: Date.now(), message: "Algorithm 0 = default SPF, not a user-defined Flex-Algo" }] }),
  },
  {
    id: "predict-algo0-is-flexalgo",
    label: "Predict",
    narrative: "Before continuing:",
    question: {
      prompt: "Is Algorithm 0 just another user-defined Flex-Algo, like Algorithm 128?",
      options: [
        { id: "no", label: "No — Algorithm 0 is the standard default SPF algorithm every router already runs" },
        { id: "yes", label: "Yes — it's simply Flex-Algo number 0" },
        { id: "depends", label: "It depends on vendor configuration" },
        { id: "only-ospf", label: "Only in OSPF, not IS-IS" },
      ],
      correctOptionId: "no",
      explanation: "Algorithm 0 predates Flex-Algo entirely — it's the ordinary IGP SPF calculation. Flex-Algo IDs (like 128) are user-defined algorithms layered alongside it, never a replacement for it.",
    },
  },
  {
    id: "node-sid-recap",
    label: "R6's Algorithm-0 Prefix-SID",
    narrative: `R6's Algorithm-0 Prefix-SID is ${R6_ALGO0_SID} (SRGB 16000 + algorithm offset 0 + index ${NODE_SID_INDEX.R6}) — exactly the model from SR-MPLS Foundations. This is the baseline every algorithm-specific SID will be compared against.`,
    run: (state) => ({ state, events: [{ type: "MPLS_LABEL_INSTALLED", stepId: "node-sid-recap", timestamp: Date.now(), message: `R6 Algorithm-0 Prefix-SID installed: ${R6_ALGO0_SID}` }] }),
  },
  {
    id: "send-algo0-1",
    label: "Send Traffic (Algorithm 0)",
    narrative: `A host behind R1 (${HOST_BEHIND_R1}) sends traffic toward a host behind R6 (${HOST_BEHIND_R6}), using R6's Algorithm-0 Prefix-SID.`,
    packet: () => ({ id: "ip-algo0", protocol: "IP", from: "R1", to: "R1", summary: `Classified toward R6 Algorithm-0 SID ${R6_ALGO0_SID}`, layers: [ipLayer(HOST_BEHIND_R1, HOST_BEHIND_R6)] }),
    run: (state) => ({ state: { ...state, packet: { srcIp: HOST_BEHIND_R1, dstIp: HOST_BEHIND_R6, labels: [] }, packetAt: "R1", journey: [], activeAlgorithm: 0 }, events: [{ type: "PACKET_SENT", stepId: "send-algo0-1", timestamp: Date.now(), message: "Packet classified toward R6 Algorithm 0" }] }),
  },
  {
    id: "r1-push-algo0",
    label: "R1: PUSH (Algorithm 0)",
    narrative: "R1 imposes R6's Algorithm-0 Prefix-SID and forwards toward its own Algorithm-0 shortest-path next hop.",
    packet: (state) => (state.packet ? mplsPacket("push-a0", "R1", "R2", "PUSH", "PUSH", state.packet, 0) : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const packet = pushLabel(state.packet, R6_ALGO0_SID);
      const journey = [...state.journey, { router: "R1" as RouterId, input: "IP", lookup: "Impose R6 Algorithm-0 Prefix-SID", action: "PUSH", output: `label ${R6_ALGO0_SID}` }];
      return { state: { ...state, packet, packetAt: "R2", journey }, events: [{ type: "MPLS_LABEL_PUSHED", stepId: "r1-push-algo0", timestamp: Date.now(), message: "R1 pushes Algorithm-0 Prefix-SID" }] };
    },
  },
  {
    id: "r2-forward-algo0",
    label: "R2: Forward (Algorithm 0)",
    narrative: "R2 forwards using ordinary Algorithm-0 SPF — its own shortest path to R6, which goes via R4.",
    packet: (state) => (state.packet ? mplsPacket("fwd-a0-1", "R2", "R4", "FORWARD", "FORWARD", state.packet, 0) : undefined),
    run: (state) => {
      const journey = [...state.journey, { router: "R2" as RouterId, input: `label ${R6_ALGO0_SID}`, lookup: "Algorithm-0 SPF → own shortest path to R6 (via R4)", action: "FORWARD", output: `label ${R6_ALGO0_SID}` }];
      return { state: { ...state, packetAt: "R4", journey }, events: [] };
    },
  },
  {
    id: "r4-forward-algo0",
    label: "R4: Forward (Algorithm 0)",
    narrative: "R4 forwards toward R6 — the final hop.",
    packet: (state) => (state.packet ? mplsPacket("fwd-a0-2", "R4", "R6", "FORWARD", "FORWARD", state.packet, 0) : undefined),
    run: (state) => {
      const journey = [...state.journey, { router: "R4" as RouterId, input: `label ${R6_ALGO0_SID}`, lookup: "Algorithm-0 SPF → own shortest path to R6 (direct)", action: "FORWARD", output: `label ${R6_ALGO0_SID}` }];
      return { state: { ...state, packetAt: "R6", journey }, events: [] };
    },
  },
  {
    id: "r6-deliver-algo0",
    label: "R6 Delivers (Algorithm 0)",
    narrative: "R6 is the SID's target — pops and delivers. Ordinary, healthy Algorithm-0 forwarding: R1 → R2 → R4 → R6.",
    packet: (state) => (state.packet ? { id: "ip-delivered-a0", protocol: "IP", from: "R6", to: "R6", summary: "Delivered via Algorithm 0", layers: buildPacketLayers(state.packet, 0) } : undefined),
    run: (state) => ({ state: { ...state, packet: popLabel(state.packet ?? { srcIp: "", dstIp: "", labels: [] }), journey: [...state.journey, { router: "R6" as RouterId, input: `label ${R6_ALGO0_SID}`, lookup: "Self is SID target", action: "DELIVER", output: "Delivered" }] }, events: [{ type: "MPLS_PACKET_FORWARDED", stepId: "r6-deliver-algo0", timestamp: Date.now(), message: "R6 delivers via Algorithm 0" }] }),
    whatChanged: () => ["Delivered R1 → R2 → R4 → R6 — ordinary Algorithm-0 SR-MPLS forwarding"],
  },
  {
    id: "flex-algo-intro",
    label: "Introducing Flex-Algo",
    narrative: "Flex-Algo 128 — PacketVerse intent label \"LOW-LATENCY.\" 128 is the algorithm identifier; LOW-LATENCY is just a friendly name for what an operator is trying to achieve with it — not a protocol field.",
    run: (state) => ({ state, events: [{ type: "OSPF_SPF_COMPLETED", stepId: "flex-algo-intro", timestamp: Date.now(), message: "Flex-Algo 128 (LOW-LATENCY) introduced" }] }),
  },
  {
    id: "flex-algo-not-a-vlan",
    label: "What 128 Is NOT",
    narrative: "Algorithm 128 is not a VLAN, not an MPLS label, not an SR Policy color, and not a DSCP value. It's an algorithm identifier — a distributed IGP calculation, propagated and computed by every participating router.",
  },
  {
    id: "fad-intro",
    label: "The Flex-Algo Definition (FAD)",
    narrative: "A FAD models: Algorithm (identifier), Metric Type (IGP / TE / Delay), Include Affinity (optional), Exclude Affinity (optional), and Priority (definition-election priority). It's distributed via the IGP — never configured as an SR Policy object.",
  },
  {
    id: "fad-128-defined",
    label: "FAD: Algorithm 128",
    narrative: "For the first example: Algorithm 128, Metric Type DELAY. No affinity constraint yet — that comes later, once metric type alone has been understood on its own.",
    run: (state) => ({ state, events: [{ type: "OSPF_SPF_COMPLETED", stepId: "fad-128-defined", timestamp: Date.now(), message: `FAD 128 defined: metric ${FAD_128.metricType}` }] }),
  },
  {
    id: "link-metrics-separate",
    label: "Link Metrics Are Separate",
    narrative: "Every link carries its own IGP metric, TE metric, and Delay metric — independent numbers, not derived from one another. TOP PATH: low IGP, high delay. BOTTOM PATH: higher IGP, low delay.",
  },
  {
    id: "topology-metrics-table",
    label: "The Numbers",
    narrative: "R1-R2 / R2-R4 / R4-R6: IGP 10, Delay 30 each (top, total IGP 30 / total delay 90). R1-R3 / R3-R5 / R5-R6: IGP 20, Delay 5 each (bottom, total IGP 60 / total delay 15). Algorithm 0 (IGP) prefers the top. A delay-based Flex-Algo prefers the bottom.",
  },
  {
    id: "signature-comparison",
    label: "Same Destination, Different Algorithm, Different Path",
    narrative: "SAME destination R6. ALGORITHM 0, metric IGP: R1 → R2 → R4 → R6. FLEX-ALGO 128, metric DELAY: R1 → R3 → R5 → R6. Same physical network. Same destination. Different algorithm. Different path.",
    run: (state) => {
      const algo0 = spfFor(state, 0);
      const algo128 = spfFor(state, 128);
      return { state, events: [{ type: "OSPF_SPF_COMPLETED", stepId: "signature-comparison", timestamp: Date.now(), message: `Algorithm 0: ${algo0.path?.join(" → ")} (${algo0.totalMetric}). Flex-Algo 128: ${algo128.path?.join(" → ")} (${algo128.totalMetric}).` }] };
    },
  },
  {
    id: "algorithm-spf-intro",
    label: "Algorithm-Specific SPF, As Pure Functions",
    narrative: "computeAlgorithmTopology() and computeAlgorithmSpf() take the topology, a Flex-Algo Definition, and participation/affinity constraints, and return: eligible links, rejected links (with reasons), the selected path, and its total metric. Nothing here is hardcoded — every result below is computed.",
  },
  {
    id: "sr-policy-distinction",
    label: "Flex-Algo Is Not SR Policy",
    narrative: "SR POLICY: headend policy object → candidate path → segment list → traffic steering. FLEX-ALGO: distributed IGP definition → routers calculate their own algorithm topology → algorithm-specific shortest paths. Flex-Algo is not \"another SR Policy\" — it's a routing-layer concept SR Policy can later build on top of.",
  },
  {
    id: "predict-sr-policy-color",
    label: "Predict",
    narrative: "Before moving on:",
    question: {
      prompt: "Is SR Policy Color 128 the same thing as Flex-Algo 128?",
      options: [
        { id: "no", label: "No — an SR Policy color is a headend-side classification value; a Flex-Algo ID is a distributed IGP algorithm identifier" },
        { id: "yes", label: "Yes — they're the same numbering space" },
        { id: "sometimes", label: "Only when both happen to use the number 128" },
        { id: "flexalgo-is-color", label: "Flex-Algo IDs ARE SR Policy colors" },
      ],
      correctOptionId: "no",
      explanation: "They just happen to both be numbers an operator picks. An SR Policy color classifies traffic at a headend for candidate-path selection. A Flex-Algo ID identifies a distributed, IGP-computed topology/SPF that every participating router calculates independently. Numerically colliding (both \"128\") means nothing.",
    },
  },
  {
    id: "distributed-computation-explain",
    label: "Distributed, Not Headend-Only",
    narrative: "Participating routers receive the Flex-Algo Definition and relevant link attributes through the IGP. Each participating router then computes its OWN SPF for Algorithm 128. R1 never sends a computed route to every other router — every router does this math itself.",
  },
  {
    id: "fad-propagation",
    label: "FAD Propagation",
    narrative: "IGP → FAD + link attributes flooded → every router's own link-state database → local algorithm-specific SPF. Conceptually true for both OSPF and IS-IS — this lesson doesn't build two full protocol simulations, just the vendor-neutral concept.",
  },
  {
    id: "fad-consistency",
    label: "FAD Consistency",
    narrative: "Routers participating in the same Flex-Algo should operate from the same, consistent definition. PacketVerse models a simplified, documented election (highest priority, then highest advertising router ID) — this lesson never actually exercises a genuine conflict; every router always advertises the identical FAD 128.",
  },
  {
    id: "algo128-prefix-sid-intro",
    label: "Algorithm-Specific Prefix-SID",
    narrative: "R6 can advertise the SAME prefix (10.0.0.6/32) with different algorithm semantics. Algorithm 0 Prefix-SID: index 6. Algorithm 128 Prefix-SID: index 106 (offset 100 + index 6). Labels are derived from SRGB state, never hand-picked.",
  },
  {
    id: "algo128-sid-compute",
    label: "Computed: R6's Algorithm-128 Prefix-SID",
    narrative: `${R6_ALGO128_SID} (SRGB 16000 + algorithm offset 100 + index ${NODE_SID_INDEX.R6}).`,
    run: (state) => ({ state, events: [{ type: "MPLS_LABEL_INSTALLED", stepId: "algo128-sid-compute", timestamp: Date.now(), message: `R6 Algorithm-128 Prefix-SID installed: ${R6_ALGO128_SID}` }] }),
  },
  {
    id: "sid-table-enhanced",
    label: "SID Database — Algorithm Column",
    narrative: "The same SID database viewer, with an Algorithm column: R6 now shows two rows for the same prefix — one per algorithm, each with its own derived label.",
  },
  {
    id: "predict-same-prefix-diff-path",
    label: "Predict",
    narrative: "Before continuing:",
    question: {
      prompt: "Can Algorithm 0 and Algorithm 128 reach the same prefix using different paths?",
      options: [
        { id: "yes", label: "Yes — same prefix, two independently-calculated algorithm topologies, two different paths" },
        { id: "no", label: "No — a prefix can only ever be reached one way" },
        { id: "only-with-policy", label: "Only if an SR Policy is also configured" },
        { id: "only-adj-sid", label: "Only using Adjacency SIDs, never Node SIDs" },
      ],
      correctOptionId: "yes",
      explanation: "That's the entire point of Flex-Algo: the same destination prefix gets a different Prefix-SID per algorithm, and each algorithm calculates its own topology/path to it — independently, and possibly differently.",
    },
  },
  {
    id: "critical-sid-concept",
    label: "The Critical SID Concept",
    narrative: "The destination prefix may be the same, but the algorithm associated with the Prefix-SID changes the forwarding calculation. Algorithm 128's SID does NOT mean \"use this hardcoded path\" — it means \"reach this prefix according to Algorithm 128's calculated topology and metric,\" whatever that currently resolves to.",
  },
  {
    id: "send-algo128-1",
    label: "Send Traffic (Algorithm 128)",
    narrative: `Same host, same destination host — this time classified toward R6's Algorithm-128 Prefix-SID instead.`,
    packet: () => ({ id: "ip-algo128", protocol: "IP", from: "R1", to: "R1", summary: `Classified toward R6 Algorithm-128 SID ${R6_ALGO128_SID}`, layers: [ipLayer(HOST_BEHIND_R1, HOST_BEHIND_R6)] }),
    run: (state) => ({ state: { ...state, packet: { srcIp: HOST_BEHIND_R1, dstIp: HOST_BEHIND_R6, labels: [] }, packetAt: "R1", journey: [], activeAlgorithm: 128 }, events: [{ type: "PACKET_SENT", stepId: "send-algo128-1", timestamp: Date.now(), message: "Packet classified toward R6 Algorithm 128" }] }),
  },
  {
    id: "r1-push-algo128",
    label: "R1: PUSH (Algorithm 128)",
    narrative: "R1 imposes R6's Algorithm-128 Prefix-SID and forwards toward its own Algorithm-128 shortest-path next hop — a completely different lookup from Algorithm 0's.",
    packet: (state) => (state.packet ? mplsPacket("push-a128", "R1", "R3", "PUSH", "PUSH", state.packet, 128) : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const packet = pushLabel(state.packet, R6_ALGO128_SID);
      const journey = [...state.journey, { router: "R1" as RouterId, input: "IP", lookup: "Impose R6 Algorithm-128 Prefix-SID", action: "PUSH", output: `label ${R6_ALGO128_SID}` }];
      return { state: { ...state, packet, packetAt: "R3", journey }, events: [{ type: "MPLS_LABEL_PUSHED", stepId: "r1-push-algo128", timestamp: Date.now(), message: "R1 pushes Algorithm-128 Prefix-SID" }] };
    },
  },
  {
    id: "r3-forward-algo128",
    label: "R3: Forward (Algorithm 128)",
    narrative: "R3 forwards using Algorithm-128 SPF — its own shortest DELAY path to R6, which goes via R5.",
    packet: (state) => (state.packet ? mplsPacket("fwd-a128-1", "R3", "R5", "FORWARD", "FORWARD", state.packet, 128) : undefined),
    run: (state) => {
      const journey = [...state.journey, { router: "R3" as RouterId, input: `label ${R6_ALGO128_SID}`, lookup: "Algorithm-128 SPF → own DELAY-shortest path to R6 (via R5)", action: "FORWARD", output: `label ${R6_ALGO128_SID}` }];
      return { state: { ...state, packetAt: "R5", journey }, events: [] };
    },
  },
  {
    id: "r5-forward-algo128",
    label: "R5: Forward (Algorithm 128)",
    narrative: "R5 forwards toward R6 — the final hop, still using Algorithm 128's own DELAY-based calculation.",
    packet: (state) => (state.packet ? mplsPacket("fwd-a128-2", "R5", "R6", "FORWARD", "FORWARD", state.packet, 128) : undefined),
    run: (state) => {
      const journey = [...state.journey, { router: "R5" as RouterId, input: `label ${R6_ALGO128_SID}`, lookup: "Algorithm-128 SPF → own DELAY-shortest path to R6 (direct)", action: "FORWARD", output: `label ${R6_ALGO128_SID}` }];
      return { state: { ...state, packetAt: "R6", journey }, events: [] };
    },
  },
  {
    id: "r6-deliver-algo128",
    label: "R6 Delivers (Algorithm 128)",
    narrative: "R6 is the SID's target — pops and delivers. Same destination, same host, genuinely different path: R1 → R3 → R5 → R6.",
    packet: (state) => (state.packet ? { id: "ip-delivered-a128", protocol: "IP", from: "R6", to: "R6", summary: "Delivered via Flex-Algo 128", layers: buildPacketLayers(state.packet, 128) } : undefined),
    run: (state) => ({ state: { ...state, packet: popLabel(state.packet ?? { srcIp: "", dstIp: "", labels: [] }), journey: [...state.journey, { router: "R6" as RouterId, input: `label ${R6_ALGO128_SID}`, lookup: "Self is SID target", action: "DELIVER", output: "Delivered" }] }, events: [{ type: "MPLS_PACKET_FORWARDED", stepId: "r6-deliver-algo128", timestamp: Date.now(), message: "R6 delivers via Flex-Algo 128" }] }),
    whatChanged: () => ["Delivered R1 → R3 → R5 → R6 — same destination as Algorithm 0, genuinely different algorithm-calculated path"],
  },
  {
    id: "affinity-intro",
    label: "Link Affinity",
    narrative: "After metric type, the other FAD constraint: affinity. Top-path links carry BLUE; bottom-path links carry GOLD. Flex-Algo 128 can EXCLUDE BLUE or INCLUDE GOLD — either forbids or requires a tag on every link that may participate.",
  },
  {
    id: "fad128-exclude-blue",
    label: "FAD 128: Exclude BLUE",
    narrative: "FAD 128 now also excludes BLUE. Recomputing — every top-path link (already losing on delay anyway) is now formally ineligible, not just costlier.",
    run: (state) => ({ state, events: [{ type: "OSPF_SPF_COMPLETED", stepId: "fad128-exclude-blue", timestamp: Date.now(), message: `FAD 128 constraint added: exclude ${FAD_128.excludeAffinity}` }] }),
  },
  {
    id: "affinity-constraint-eval",
    label: "Computed: Eligible vs. Rejected Links",
    narrative: "Full topology → FAD 128 constraints → links rejected by affinity → remaining algorithm topology → SPF. Every rejection below carries its own reason.",
  },
  {
    id: "predict-affinity-vs-metric",
    label: "Predict",
    narrative: "Before continuing:",
    question: {
      prompt: "Is excluding an affinity (like BLUE) the same as changing that link's metric?",
      options: [
        { id: "no", label: "No — affinity decides which links may participate at all; metric only decides cost among links that already may" },
        { id: "yes", label: "Yes — both just make a link less attractive" },
        { id: "only-for-delay", label: "Only for delay-based Flex-Algos" },
        { id: "affinity-is-a-metric", label: "Affinity IS a fourth metric type" },
      ],
      correctOptionId: "no",
      explanation: "A link with a terrible metric can still be used if nothing better exists. An excluded-affinity link can NEVER be used by that algorithm, no matter how cheap it is. These are two different kinds of constraint, not the same concept measured differently.",
    },
  },
  {
    id: "metric-vs-affinity-explain",
    label: "Metric Type vs. Affinity Constraint",
    narrative: "METRIC TYPE determines the cost used for SPF among eligible links. AFFINITY CONSTRAINT determines which links may participate at all. Never merge these — a Flex-Algo can change one without touching the other.",
  },
  {
    id: "topology-view-intro",
    label: "Three Topology Views",
    narrative: "PHYSICAL: every link. ALGORITHM 0: the default SPF tree/path. FLEX-ALGO 128: the constrained, calculated topology after affinity filtering and DELAY-based SPF.",
  },
  {
    id: "algorithm-rib-intro",
    label: "Algorithm RIB",
    narrative: "A PacketVerse conceptual algorithm-specific routing view — not a claim about literal vendor RIB naming. Algorithm 0: R6 via R2. Algorithm 128: R6 via R3. Two separate route entries for the same prefix.",
  },
  {
    id: "lfib-intro",
    label: "LFIB — Two Labels, Two Next Hops",
    narrative: `Label ${R6_ALGO0_SID}, Algorithm 0, next hop R2. Label ${R6_ALGO128_SID}, Algorithm 128, next hop R3. Both installed on R1 right now, both state-derived, neither hardcoded.`,
  },
  {
    id: "flex-algo-lab-intro",
    label: "FLEX-ALGO LAB",
    narrative: "A read-only lab, computed against the real domain functions — nothing here mutates the lesson's own narrative state. Controls: Algorithm (0/128), Metric (IGP/TE/Delay), Include Affinity (NONE/GOLD), Exclude Affinity (NONE/BLUE).",
  },
  {
    id: "metric-experiment",
    label: "Lab: Algorithm 128 + IGP vs. Algorithm 128 + Delay",
    narrative: "Same algorithm ID, same affinity constraint, only the metric type changes. Watch the actual recomputed path and total — not a label swap.",
  },
  {
    id: "link-attribute-experiment",
    label: "Lab: Change R3-R5's Delay",
    narrative: "Change R3-R5's delay from 5 to 80 (lab-only, with the BLUE exclusion lifted so a genuine alternative exists) and recompute Algorithm 128. If a better valid path exists, the algorithm finds it — R1 → R3 → R4 → R6 via the cross-link, total delay 38.",
  },
  {
    id: "same-algo-changing-path",
    label: "Same Algorithm ID, Different Path",
    narrative: "Signature teaching point: Flex-Algo 128 is an algorithm DEFINITION, not a fixed physical path. Link metrics and attributes can change the selected route without changing the Algorithm ID at all.",
  },
  {
    id: "predict-fixed-path",
    label: "Predict",
    narrative: "Before continuing:",
    question: {
      prompt: "Does Flex-Algo 128 represent a permanently fixed physical path?",
      options: [
        { id: "no", label: "No — it's a definition that gets recalculated; the resulting path can change if link attributes change" },
        { id: "yes", label: "Yes — once defined, the path never changes" },
        { id: "only-if-te", label: "Only if the metric type is TE" },
        { id: "fixed-after-first-spf", label: "It's fixed after the first SPF run, like a cached route" },
      ],
      correctOptionId: "no",
      explanation: "You just watched the R3-R5 delay change move the selected Algorithm-128 path. The algorithm ID (128) stayed exactly the same — only the calculated result changed, because it's recalculated from current topology, not memorized.",
    },
  },
  {
    id: "predict-metric-change-path",
    label: "Predict",
    narrative: "One more, to make sure this is solid:",
    question: {
      prompt: "Does changing the delay metric potentially change the path a delay-based Flex-Algo calculates, without changing the algorithm ID?",
      options: [
        { id: "yes", label: "Yes — the algorithm ID names the DEFINITION; the path is a recalculated RESULT of current metrics" },
        { id: "no", label: "No — changing any metric requires defining a new algorithm ID" },
        { id: "only-igp", label: "Only IGP metric changes can do this" },
        { id: "requires-restart", label: "Only after a full router restart" },
      ],
      correctOptionId: "yes",
      explanation: "Exactly what the lab just demonstrated. The algorithm ID is stable; the calculated topology and path are not — they track current link attributes.",
    },
  },
  {
    id: "sr-policy-flexalgo-tiein",
    label: "Advanced Tie-In: SR Policy",
    narrative: "SR Policy and Flex-Algo can complement each other. Conceptually, an SR Policy's segment instructions can be based on an algorithm-specific Prefix-SID — steering intent still comes from the policy, but the underlying path it resolves to can already reflect a Flex-Algo's own constraints. Not simulated fully here — just the relationship.",
  },
  {
    id: "ti-lfa-flexalgo-tiein",
    label: "Advanced Tie-In: TI-LFA",
    narrative: "A Flex-Algo path may also need local protection. A correct implementation computes TI-LFA repair segments that respect the SAME topology/algorithm being protected — not just Algorithm 0's. Flex-Algo-aware TI-LFA is genuinely advanced material, deliberately deferred, not built in this lesson.",
  },
  {
    id: "troubleshooting-intro",
    label: "INCIDENT",
    narrative: "Default SR traffic to R6 works. Flex-Algo 128 traffic does not follow the expected low-delay topology. Physical interfaces are healthy. IGP neighbors are healthy. Algorithm-0 forwarding is healthy.",
    run: (state) => ({ state: { ...state, troubleshooting: { ...state.troubleshooting, started: true } }, events: [] }),
  },
  {
    id: "fault-injection",
    label: "R3 Loses Algorithm-128 Participation",
    narrative: "Somewhere, R3's Flex-Algo 128 participation was disabled — a real, deterministic operational fault, not a definition conflict. R3 still participates fully in Algorithm 0.",
    run: (state) => ({ state: { ...state, algorithmParticipation: { ...state.algorithmParticipation, R3: [0] } }, events: [{ type: "OSPF_COST_CHANGED", stepId: "fault-injection", timestamp: Date.now(), message: "R3: Algorithm 128 participation disabled" }] }),
    whatChanged: () => ["R3 Algorithm-128 participation: enabled → disabled (Algorithm 0 participation unaffected)"],
  },
  {
    id: "diagnostic-ladder",
    label: "Diagnose Before You Fix",
    narrative: "Something about Flex-Algo 128's distributed calculation is incomplete. Work the diagnostic ladder below before touching anything.",
  },
  {
    id: "repair-challenge",
    label: "Engineer Challenge: Fix Flex-Algo 128",
    narrative: "Choose the correct repair.",
    action: (state, payload) => {
      const choice = (payload as { choice?: string } | undefined)?.choice ?? "";
      if (choice !== "enable-r3-participation") {
        return { state: { ...state, troubleshooting: { ...state.troubleshooting, repairAttempt: { choice, correct: false } } }, events: [] };
      }
      return {
        state: { ...state, algorithmParticipation: { ...state.algorithmParticipation, R3: [0, 128] }, troubleshooting: { ...state.troubleshooting, repairAttempt: { choice, correct: true }, repaired: true } },
        events: [{ type: "OSPF_COST_CHANGED", stepId: "repair-challenge", timestamp: Date.now(), message: "R3: Algorithm 128 participation restored" }],
      };
    },
    requiresState: (state) => state.troubleshooting.repaired === true,
  },
  {
    id: "repaired-recompute",
    label: "Algorithm-128 Topology Recomputes",
    narrative: "With R3 participating again, Algorithm 128's topology, SPF, and Prefix-SID forwarding all recompute cleanly — R3 rejoins as a valid transit for this algorithm.",
    run: (state) => ({ state: { ...state, packet: undefined, packetAt: undefined, journey: [] }, events: [] }),
  },
  {
    id: "verify-send-algo128",
    label: "Mandatory Verification: Send Traffic Again",
    narrative: "Recomputation alone isn't proof. Send a real packet toward R6's Algorithm-128 Prefix-SID and follow it.",
    packet: () => ({ id: "verify-ip", protocol: "IP", from: "R1", to: "R1", summary: `Classified toward R6 Algorithm-128 SID ${R6_ALGO128_SID}`, layers: [ipLayer(HOST_BEHIND_R1, HOST_BEHIND_R6)] }),
    run: (state) => ({ state: { ...state, packet: { srcIp: HOST_BEHIND_R1, dstIp: HOST_BEHIND_R6, labels: [] }, packetAt: "R1", journey: [], activeAlgorithm: 128 }, events: [] }),
  },
  {
    id: "verify-push",
    label: "R1: PUSH (Verification)",
    narrative: "R1 imposes R6's Algorithm-128 Prefix-SID exactly as before.",
    packet: (state) => (state.packet ? mplsPacket("verify-push", "R1", "R3", "PUSH", "PUSH", state.packet, 128) : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const packet = pushLabel(state.packet, R6_ALGO128_SID);
      const journey = [...state.journey, { router: "R1" as RouterId, input: "IP", lookup: "Impose R6 Algorithm-128 Prefix-SID", action: "PUSH", output: `label ${R6_ALGO128_SID}` }];
      return { state: { ...state, packet, packetAt: "R3", journey }, events: [] };
    },
  },
  {
    id: "verify-r3-transit",
    label: "R3: Forward (Verification)",
    narrative: "R3 is participating in Algorithm 128 again — it correctly forwards using Algorithm-128 SPF.",
    packet: (state) => (state.packet ? mplsPacket("verify-r3", "R3", "R5", "FORWARD", "FORWARD", state.packet, 128) : undefined),
    run: (state) => {
      const journey = [...state.journey, { router: "R3" as RouterId, input: `label ${R6_ALGO128_SID}`, lookup: "Algorithm-128 SPF → own DELAY-shortest path to R6 (via R5)", action: "FORWARD", output: `label ${R6_ALGO128_SID}` }];
      return { state: { ...state, packetAt: "R5", journey }, events: [] };
    },
  },
  {
    id: "verify-deliver",
    label: "R5 Relays, R6 Delivers (Verified)",
    narrative: "R5 forwards, R6 delivers. Verified: the repair genuinely restores the expected low-delay path.",
    packet: (state) => (state.packet ? { id: "verify-delivered", protocol: "IP", from: "R6", to: "R6", summary: "Delivered via repaired Flex-Algo 128", layers: buildPacketLayers(popLabel(state.packet), 128) } : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const journey = [
        ...state.journey,
        { router: "R5" as RouterId, input: `label ${R6_ALGO128_SID}`, lookup: "Algorithm-128 SPF → own DELAY-shortest path to R6 (direct)", action: "FORWARD", output: `label ${R6_ALGO128_SID}` },
        { router: "R6" as RouterId, input: `label ${R6_ALGO128_SID}`, lookup: "Self is SID target", action: "DELIVER", output: "Delivered" },
      ];
      return { state: { ...state, packet: popLabel(state.packet), packetAt: "R6", journey, troubleshooting: { ...state.troubleshooting, verified: true } }, events: [{ type: "MPLS_PACKET_FORWARDED", stepId: "verify-deliver", timestamp: Date.now(), message: "Verified: repaired Flex-Algo 128 delivers to R6" }] };
    },
    whatChanged: () => ["Verified: R1 → R3 → R5 → R6 restored — recomputation alone was not enough, delivery had to be proven"],
  },
  {
    id: "engineer-challenge-intro",
    label: "Engineer Challenge: Define The Topology",
    narrative: "Recap and confirm: create/activate Flex-Algo 128 for LOW-LATENCY forwarding to R6 — DELAY metric, avoiding BLUE links, with all required routers participating, an Algo-128 Prefix-SID for R6, and a path genuinely different from Algorithm 0. Everything below was already demonstrated in this lesson — this is the checklist.",
  },
  {
    id: "engineer-challenge-confirm",
    label: "Confirm Full Flex-Algo Coverage",
    narrative: "Physical topology inspected ✓ · IGP and delay metrics compared ✓ · Affinities inspected ✓ · FAD 128 inspected (DELAY, exclude BLUE) ✓ · Eligible topology calculated ✓ · Participating routers verified ✓ · Algorithm-128 SPF run ✓ · Algorithm-128 Prefix-SID inspected ✓ · LFIB inspected ✓ · Packet sent and followed ✓ · Low-delay path verified (R1→R3→R5→R6) ✓ · Participation fault diagnosed and repaired ✓.",
    requiresState: (state) => state.troubleshooting.verified === true,
  },
  {
    id: "complete",
    label: "Complete",
    narrative: "You built Flex-Algo from real distributed IGP concepts: a Flex-Algo Definition (metric type + affinity), algorithm-specific SPF computed independently by each participating router, and an algorithm-specific Prefix-SID that gives the SAME destination prefix a genuinely different, recalculated path. You distinguished Flex-Algo from SR Policy, watched the same algorithm ID produce a different path after a link-attribute change, diagnosed a real participation fault, and verified the fix with an actual packet. +600 XP awarded.",
  },
];

function stepIdx(id: string): number {
  return srFlexAlgoSteps.findIndex((s) => s.id === id);
}
export const STEP_IDX = {
  topologyIntro: stepIdx("topology-intro"),
  algo0Complete: stepIdx("r6-deliver-algo0"),
  flexAlgoIntro: stepIdx("flex-algo-intro"),
  fadDefined: stepIdx("fad-128-defined"),
  topologyMetricsTable: stepIdx("topology-metrics-table"),
  signatureComparison: stepIdx("signature-comparison"),
  algo128PrefixSidIntro: stepIdx("algo128-prefix-sid-intro"),
  algo128SidCompute: stepIdx("algo128-sid-compute"),
  algo128Complete: stepIdx("r6-deliver-algo128"),
  affinityIntro: stepIdx("affinity-intro"),
  fad128ExcludeBlue: stepIdx("fad128-exclude-blue"),
  topologyViewIntro: stepIdx("topology-view-intro"),
  algorithmRibIntro: stepIdx("algorithm-rib-intro"),
  lfibIntro: stepIdx("lfib-intro"),
  flexAlgoLabIntro: stepIdx("flex-algo-lab-intro"),
  linkAttributeExperiment: stepIdx("link-attribute-experiment"),
  troubleshootingIntro: stepIdx("troubleshooting-intro"),
  diagnosticLadder: stepIdx("diagnostic-ladder"),
  repairChallenge: stepIdx("repair-challenge"),
  engineerChallengeIntro: stepIdx("engineer-challenge-intro"),
  complete: stepIdx("complete"),
};

// ---------------------------------------------------------------------------
// CLI perspectives — CONCEPT / Cisco IOS-XR / Junos.
// ---------------------------------------------------------------------------
export interface FlexAlgoCliVendorOutput {
  cmd: string;
  output: string;
}
export interface FlexAlgoCliEntry {
  id: string;
  label: string;
  concept: string;
  cisco: FlexAlgoCliVendorOutput;
  juniper: FlexAlgoCliVendorOutput;
}
export function buildFlexAlgoCliCommands(state: SrFlexAlgoState, router: RouterId): FlexAlgoCliEntry[] {
  const algo0 = spfFor(state, 0);
  const algo128 = spfFor(state, 128);
  const participants128 = determineParticipatingRouters(state.algorithmParticipation, 128);
  const continuity = validateAlgorithmContinuity(algo128.path, participants128);
  return [
    {
      id: "fad",
      label: "Flex-Algo Definitions",
      concept: "The distributed definition every participating router computes from — algorithm, metric type, and affinity constraints.",
      cisco: { cmd: `show flex-algo definition 128`, output: `Flex-Algorithm 128\n Metric-type: ${FAD_128.metricType}\n Exclude-affinity: ${FAD_128.excludeAffinity ?? "none"}\n Priority: ${FAD_128.priority}` },
      juniper: { cmd: `show flex-algorithm definition 128`, output: `algorithm 128 {\n  metric-type ${FAD_128.metricType.toLowerCase()};\n  exclude-affinity ${FAD_128.excludeAffinity ?? "none"};\n}` },
    },
    {
      id: "participation",
      label: "Algorithm-128 Participation",
      concept: "Which routers currently participate — a non-participant is removed from this algorithm's topology entirely, not merely deprioritized.",
      cisco: { cmd: `show flex-algo participation 128`, output: `Participating: ${participants128.join(", ") || "(none)"}\nNot participating: ${ALL_ROUTERS.filter((r) => !participants128.includes(r)).join(", ") || "(none)"}` },
      juniper: { cmd: `show flex-algorithm participation 128`, output: `participating [ ${participants128.join(" ")} ];` },
    },
    {
      id: "algo-rib",
      label: "Algorithm RIB",
      concept: "PacketVerse conceptual algorithm-specific routing view — not a literal claim about vendor RIB table naming.",
      cisco: { cmd: `show ip route algorithm 128`, output: `Algorithm 0: 10.0.0.6/32 via ${algo0.path?.[1] ?? "unreachable"}\nAlgorithm 128: 10.0.0.6/32 via ${algo128.path?.[1] ?? "unreachable"}` },
      juniper: { cmd: `show route algorithm 128`, output: `algorithm 0 -> 10.0.0.6/32 via ${algo0.path?.[1] ?? "unreachable"};\nalgorithm 128 -> 10.0.0.6/32 via ${algo128.path?.[1] ?? "unreachable"};` },
    },
    {
      id: "lfib",
      label: "LFIB / Forwarding",
      concept: "What this router is actually doing with the packet right now — reflects live journey state.",
      cisco: { cmd: `show mpls forwarding-table`, output: state.journey.filter((h) => h.router === router).map((h) => `In: ${h.input}  Action: ${h.action}  Out: ${h.output}`).join("\n") || "(no forwarding entry recorded at this router yet)" },
      juniper: { cmd: `show route forwarding-table`, output: state.journey.filter((h) => h.router === router).map((h) => `in ${h.input} -> ${h.action} -> out ${h.output}`).join("\n") || "(no forwarding entry recorded at this router yet)" },
    },
    {
      id: "continuity",
      label: "Algorithm-128 Continuity",
      concept: continuity.valid ? "Every router on the current Algorithm-128 path participates — continuity is intact." : "The current Algorithm-128 computation cannot reach the destination — a participating-router gap breaks continuity.",
      cisco: { cmd: `show flex-algo 128 topology`, output: `Path: ${algo128.path?.join(" -> ") ?? "NO PATH"}\nTotal metric: ${algo128.totalMetric ?? "n/a"}\nContinuity: ${continuity.valid ? "OK" : "BROKEN"}` },
      juniper: { cmd: `show flex-algorithm 128 topology`, output: `path ${algo128.path?.join(" -> ") ?? "none"};\ncontinuity ${continuity.valid ? "ok" : "broken"};` },
    },
  ];
}
