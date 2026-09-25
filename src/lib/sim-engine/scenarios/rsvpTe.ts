import type { PacketLayer, PacketVisual, ScenarioStep } from "../types";

/**
 * MPLS RSVP-TE — CSPF, PATH/RESV signaling, bandwidth reservation, and
 * traffic-engineered LSPs.
 *
 *                  R2 ────────── R4
 *                 /                \
 *                /                  \
 *              R1                    R6
 *                \                  /
 *                 \                /
 *                  R3 ── R5 ───────
 *
 * R1 = RSVP-TE ingress/headend, R6 = egress/tailend.
 * TOP PATH    R1 → R2 → R4 → R6   (IGP/TE metric 10 per hop, cost 30)
 * BOTTOM PATH R1 → R3 → R5 → R6   (IGP/TE metric 15 per hop, cost 45)
 *
 * Central question this lesson answers: what if the IGP shortest path
 * is not the path we want traffic to use? R2-R4's max reservable
 * bandwidth (200 Mbps) can never satisfy a 500 Mbps constraint, even
 * though the top path is the IGP shortest path — so Constrained SPF
 * (CSPF), not ordinary SPF, has to choose the bottom path instead.
 *
 * Scope: this lesson teaches RSVP-TE CSPF/signaling/bandwidth
 * reservation only. Explicitly deferred to the next lesson: Fast
 * Reroute, Segment Routing. LDP is a different, already-taught
 * technology — the "before" state here is plain IGP forwarding, not
 * LDP-switched traffic.
 *
 * Pure data + pure functions only — see /lib/sim-engine/types.ts for
 * why (no React, no DOM here; components only render what this file
 * computes).
 */

export type RouterId = "R1" | "R2" | "R3" | "R4" | "R5" | "R6";
export const ALL_ROUTERS: RouterId[] = ["R1", "R2", "R3", "R4", "R5", "R6"];
export const INGRESS: RouterId = "R1";
export const EGRESS: RouterId = "R6";
export const CORE_ROUTERS: RouterId[] = ["R2", "R3", "R4", "R5"];

export type LinkId = "R1-R2" | "R1-R3" | "R2-R4" | "R3-R5" | "R4-R6" | "R5-R6";
export type Affinity = "BLUE" | "GOLD";

export interface TeLinkDef {
  id: LinkId;
  a: RouterId;
  b: RouterId;
  igpMetric: number;
  teMetric: number;
  maxBandwidthMbps: number;
  maxReservableMbps: number;
  affinity: Affinity;
  rsvpEnabled: boolean;
}

// Brief §2's exact values. R2-R4's max reservable (200 Mbps) is an
// administrative TE policy ceiling below physical capacity (1000 Mbps)
// — this is the whole point: physical link speed is not the same as
// available reservable TE bandwidth (brief §49).
export const TE_LINKS: TeLinkDef[] = [
  { id: "R1-R2", a: "R1", b: "R2", igpMetric: 10, teMetric: 10, maxBandwidthMbps: 1000, maxReservableMbps: 1000, affinity: "BLUE", rsvpEnabled: true },
  { id: "R2-R4", a: "R2", b: "R4", igpMetric: 10, teMetric: 10, maxBandwidthMbps: 1000, maxReservableMbps: 200, affinity: "BLUE", rsvpEnabled: true },
  { id: "R4-R6", a: "R4", b: "R6", igpMetric: 10, teMetric: 10, maxBandwidthMbps: 1000, maxReservableMbps: 1000, affinity: "BLUE", rsvpEnabled: true },
  { id: "R1-R3", a: "R1", b: "R3", igpMetric: 15, teMetric: 15, maxBandwidthMbps: 1000, maxReservableMbps: 1000, affinity: "GOLD", rsvpEnabled: true },
  { id: "R3-R5", a: "R3", b: "R5", igpMetric: 15, teMetric: 15, maxBandwidthMbps: 1000, maxReservableMbps: 1000, affinity: "GOLD", rsvpEnabled: true },
  { id: "R5-R6", a: "R5", b: "R6", igpMetric: 15, teMetric: 15, maxBandwidthMbps: 1000, maxReservableMbps: 1000, affinity: "GOLD", rsvpEnabled: true },
];

export const TOP_PATH: RouterId[] = ["R1", "R2", "R4", "R6"];
export const BOTTOM_PATH: RouterId[] = ["R1", "R3", "R5", "R6"];

export const TERMS: { term: string; expansion: string; meaning: string }[] = [
  { term: "TED", expansion: "Traffic Engineering Database", meaning: "Every link's IGP metric, TE metric, and bandwidth attributes — the topology CSPF searches over." },
  { term: "CSPF", expansion: "Constrained Shortest Path First", meaning: "Prune links that violate a constraint first, then run shortest-path only on what's left." },
  { term: "ERO", expansion: "Explicit Route Object", meaning: "The intended downstream hop list RSVP signals with — it communicates the path, it doesn't forward traffic itself." },
  { term: "RRO", expansion: "Record Route Object", meaning: "The path actually recorded once signaling succeeds — not the same object as the ERO." },
  { term: "LSP", expansion: "Label Switched Path", meaning: "The end-to-end path this RSVP-TE tunnel installs and forwards labeled traffic over." },
];

// ---------------------------------------------------------------------------
// Generic path-finding over TeLinkDef edges — deliberately not
// protocol-specific (brief §50): the SAME function computes ordinary
// SPF (weight = igpMetric, no pruning) and the shortest-path portion
// of CSPF (weight = teMetric, over an already-pruned edge list).
// ---------------------------------------------------------------------------

function neighborsOf(edges: TeLinkDef[]): Partial<Record<RouterId, { to: RouterId; link: TeLinkDef }[]>> {
  const adj: Partial<Record<RouterId, { to: RouterId; link: TeLinkDef }[]>> = {};
  for (const link of edges) {
    (adj[link.a] ??= []).push({ to: link.b, link });
    (adj[link.b] ??= []).push({ to: link.a, link });
  }
  return adj;
}

/** Enumerates every simple (no-repeat-node) path — the graph here is tiny (6 nodes), so brute force is simpler to verify correct than a Dijkstra implementation. */
function allSimplePaths(edges: TeLinkDef[], from: RouterId, to: RouterId): RouterId[][] {
  const adj = neighborsOf(edges);
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

function linkBetween(edges: TeLinkDef[], x: RouterId, y: RouterId): TeLinkDef | undefined {
  return edges.find((l) => (l.a === x && l.b === y) || (l.b === x && l.a === y));
}

function pathWeight(path: RouterId[], edges: TeLinkDef[], metric: "igpMetric" | "teMetric"): number {
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const link = linkBetween(edges, path[i], path[i + 1]);
    total += link ? link[metric] : Number.POSITIVE_INFINITY;
  }
  return total;
}

export function linkIdsOnPath(path: RouterId[], edges: TeLinkDef[] = TE_LINKS): LinkId[] {
  const ids: LinkId[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const link = linkBetween(edges, path[i], path[i + 1]);
    if (link) ids.push(link.id);
  }
  return ids;
}

/** Ordinary SPF (brief §3/§7) — no constraint, IGP metric only. This is what forwards traffic before any RSVP-TE tunnel exists. */
export function computeIgpShortestPath(links: TeLinkDef[] = TE_LINKS, from: RouterId = INGRESS, to: RouterId = EGRESS): { path: RouterId[]; cost: number } | undefined {
  const candidates = allSimplePaths(links, from, to).map((path) => ({ path, cost: pathWeight(path, links, "igpMetric") }));
  candidates.sort((a, b) => a.cost - b.cost);
  return candidates[0];
}

// ---------------------------------------------------------------------------
// Traffic Engineering Database — bandwidth accounting (brief §5/§18)
// ---------------------------------------------------------------------------

export interface BackgroundReservation {
  id: string;
  linkId: LinkId;
  mbps: number;
  label: string;
}

export interface LspSnapshotForBandwidth {
  path?: RouterId[];
  reservedLinkIds: LinkId[];
  requestedBandwidthMbps: number;
}

/** Never confuse physical interface speed with currently-reservable TE bandwidth (brief §5/§49) — this reads maxReservableMbps, not maxBandwidthMbps. */
export function computeAvailableBandwidth(link: TeLinkDef, backgroundReservations: BackgroundReservation[], lsp?: LspSnapshotForBandwidth): number {
  const bg = backgroundReservations.filter((r) => r.linkId === link.id).reduce((sum, r) => sum + r.mbps, 0);
  const lspReserved = lsp && lsp.reservedLinkIds.includes(link.id) ? lsp.requestedBandwidthMbps : 0;
  return Math.max(0, link.maxReservableMbps - bg - lspReserved);
}

export interface TeDatabaseRow {
  linkId: LinkId;
  label: string;
  igpMetric: number;
  teMetric: number;
  maxBandwidthMbps: number;
  maxReservableMbps: number;
  reservedMbps: number;
  availableMbps: number;
  affinity: Affinity;
  rsvpEnabled: boolean;
}

export function buildTeDatabase(links: TeLinkDef[], backgroundReservations: BackgroundReservation[], lsp?: LspSnapshotForBandwidth): TeDatabaseRow[] {
  return links.map((link) => {
    const available = computeAvailableBandwidth(link, backgroundReservations, lsp);
    return {
      linkId: link.id,
      label: `${link.a}-${link.b}`,
      igpMetric: link.igpMetric,
      teMetric: link.teMetric,
      maxBandwidthMbps: link.maxBandwidthMbps,
      maxReservableMbps: link.maxReservableMbps,
      reservedMbps: link.maxReservableMbps - available,
      availableMbps: available,
      affinity: link.affinity,
      rsvpEnabled: link.rsvpEnabled,
    };
  });
}

// ---------------------------------------------------------------------------
// CSPF — Constrained Shortest Path First (brief §7/§8/§9). This is the
// actual pruning process, not "SPF but smarter": every link is
// evaluated against the constraint FIRST, and only surviving links
// ever reach the shortest-path calculation.
// ---------------------------------------------------------------------------

export interface TeConstraint {
  requiredBandwidthMbps: number;
  affinityInclude?: Affinity;
}

export interface CspfEvaluationRow {
  linkId: LinkId;
  label: string;
  availableMbps: number;
  requiredMbps: number;
  bandwidthPass: boolean;
  affinityPass: boolean;
  pass: boolean;
  reason: string;
}

export interface CspfResult {
  constraint: TeConstraint;
  evaluations: CspfEvaluationRow[];
  prunedLinkIds: LinkId[];
  path?: RouterId[];
  teMetricTotal?: number;
}

export function pruneLinksByConstraint(links: TeLinkDef[], constraint: TeConstraint, backgroundReservations: BackgroundReservation[], lsp?: LspSnapshotForBandwidth): CspfEvaluationRow[] {
  return links.map((link) => {
    const available = computeAvailableBandwidth(link, backgroundReservations, lsp);
    const bandwidthPass = available >= constraint.requiredBandwidthMbps;
    const affinityPass = !constraint.affinityInclude || link.affinity === constraint.affinityInclude;
    const pass = bandwidthPass && affinityPass;
    const reason = !bandwidthPass
      ? `Available ${available} Mbps < required ${constraint.requiredBandwidthMbps} Mbps — insufficient`
      : !affinityPass
        ? `Affinity ${link.affinity} does not include required ${constraint.affinityInclude}`
        : "Meets bandwidth and affinity constraints";
    return { linkId: link.id, label: `${link.a}-${link.b}`, availableMbps: available, requiredMbps: constraint.requiredBandwidthMbps, bandwidthPass, affinityPass, pass, reason };
  });
}

/** The domain engine owns this calculation entirely (brief §9) — React/Three.js only ever render a CspfResult, never compute one. */
export function computeCspf(constraint: TeConstraint, backgroundReservations: BackgroundReservation[], links: TeLinkDef[] = TE_LINKS, from: RouterId = INGRESS, to: RouterId = EGRESS, lsp?: LspSnapshotForBandwidth): CspfResult {
  const evaluations = pruneLinksByConstraint(links, constraint, backgroundReservations, lsp);
  const candidateLinks = links.filter((l) => evaluations.find((e) => e.linkId === l.id)?.pass);
  const prunedLinkIds = links.filter((l) => !candidateLinks.includes(l)).map((l) => l.id);
  const candidates = allSimplePaths(candidateLinks, from, to).map((path) => ({ path, cost: pathWeight(path, candidateLinks, "teMetric") }));
  candidates.sort((a, b) => a.cost - b.cost);
  const best = candidates[0];
  return { constraint, evaluations, prunedLinkIds, path: best?.path, teMetricTotal: best?.cost };
}

/** Explicit-path validation (brief §32) — RSVP still needs a viable, signalable path; explicit path constraints/hops don't bypass admission control. */
export function validateExplicitPath(path: RouterId[], links: TeLinkDef[], constraint: TeConstraint, backgroundReservations: BackgroundReservation[], lsp?: LspSnapshotForBandwidth): CspfResult {
  const pathLinkIds = new Set(linkIdsOnPath(path, links));
  const evaluations = pruneLinksByConstraint(links, constraint, backgroundReservations, lsp).map((e) => (pathLinkIds.has(e.linkId) ? e : { ...e, pass: true, reason: "Not part of the explicit path — not evaluated" }));
  const allPass = links.filter((l) => pathLinkIds.has(l.id)).every((l) => evaluations.find((e) => e.linkId === l.id)?.pass);
  return { constraint, evaluations, prunedLinkIds: allPass ? [] : Array.from(pathLinkIds), path: allPass ? path : undefined, teMetricTotal: allPass ? pathWeight(path, links, "teMetric") : undefined };
}

// ---------------------------------------------------------------------------
// ERO / RRO (brief §10/§33)
// ---------------------------------------------------------------------------

/** The ERO communicates intended path during signaling — it never forwards a single data packet itself. */
export function buildEro(path: RouterId[]): RouterId[] {
  return path.slice(1);
}

// ---------------------------------------------------------------------------
// Label / stack model — same shape as the MPLS/LDP and MPLS L3VPN
// lessons (brief §49: reuse label-stack helpers, don't reinvent them).
// ---------------------------------------------------------------------------

export type LabelValue = number | "IMPLICIT_NULL";

export interface MplsLabel {
  value: number;
  tc: number;
  bottomOfStack: boolean;
  ttl: number;
  purpose: "transport";
}

export interface MplsPacketState {
  srcIp: string;
  dstIp: string;
  labels: MplsLabel[];
}

function pushLabel(pkt: MplsPacketState, value: number): MplsPacketState {
  const wasEmpty = pkt.labels.length === 0;
  const newTop: MplsLabel = { value, tc: 0, ttl: 255, bottomOfStack: wasEmpty, purpose: "transport" };
  // Existing labels keep their S bits: only the label pushed onto an empty stack is bottom-of-stack.
  return { ...pkt, labels: [newTop, ...pkt.labels.map((l) => ({ ...l }))] };
}
function swapTopLabel(pkt: MplsPacketState, value: number): MplsPacketState {
  if (pkt.labels.length === 0) return pkt;
  const [top, ...rest] = pkt.labels;
  return { ...pkt, labels: [{ ...top, value }, ...rest] };
}
function popTopLabel(pkt: MplsPacketState): MplsPacketState {
  // Remaining labels keep their S bits unchanged.
  const [, ...rest] = pkt.labels;
  return { ...pkt, labels: rest.map((l) => ({ ...l })) };
}

export function fmtLabel(v: LabelValue): string {
  return v === "IMPLICIT_NULL" ? "implicit-null" : String(v);
}

/** Downstream-assigned label allocation (brief §16) — position-from-egress is generic over whichever 4-node path (top or bottom) actually got signaled. Egress always signals implicit-null (PHP), never a real numeric label. Penultimate hop (position 1) allocates 300; the next hop upstream (position 2) allocates 200 — matching the brief's worked example exactly. */
export function allocateRsvpLabel(path: RouterId[], router: RouterId): LabelValue {
  const idx = path.indexOf(router);
  if (idx === -1) return "IMPLICIT_NULL";
  const positionFromEgress = path.length - 1 - idx;
  if (positionFromEgress === 0) return "IMPLICIT_NULL";
  return 400 - positionFromEgress * 100; // position 1 (penultimate) = 300, position 2 = 200, ...
}

// ---------------------------------------------------------------------------
// RSVP-TE tunnel / LSP state
// ---------------------------------------------------------------------------

export type LspLifecycleState = "DOWN" | "CSPF" | "SIGNALING" | "UP";
export const LSP_LIFECYCLE_ORDER: LspLifecycleState[] = ["DOWN", "CSPF", "SIGNALING", "UP"];
export const LSP_LIFECYCLE_INFO: Record<LspLifecycleState, { meaning: string; why: string; next: string }> = {
  DOWN: {
    meaning: "No RSVP-TE signaling has happened for this tunnel yet.",
    why: "A constraint (bandwidth, and optionally affinity) exists, but nothing has been computed or signaled.",
    next: "CSPF must find a path that satisfies the constraint before any RSVP message is sent.",
  },
  CSPF: {
    meaning: "CSPF has been run against the Traffic Engineering Database for this constraint.",
    why: "The headend must know a viable, constraint-satisfying path exists before it signals — RSVP never signals blind.",
    next: "If a candidate path was found, PATH signaling begins hop by hop toward the egress.",
  },
  SIGNALING: {
    meaning: "PATH has been sent downstream and/or RESV is returning upstream — labels and reservations are being installed hop by hop.",
    why: "Each hop along the path must record state and allocate a label before the LSP is usable.",
    next: "Once RESV reaches the ingress, the LSP becomes UP.",
  },
  UP: {
    meaning: "The LSP is fully signaled: every hop has installed forwarding state, and bandwidth is reserved end to end.",
    why: "PATH reached the egress, RESV returned to the ingress, and every hop's admission control passed.",
    next: "MPLS data-plane traffic can now be pushed onto this LSP and forwarded using installed label state — no further CSPF or signaling per packet.",
  },
};

export type PathType = "dynamic" | "explicit";

export interface HopSignalState {
  pathSent?: boolean;
  pathReceived?: boolean;
  resvSent?: boolean;
  resvReceived?: boolean;
  /** The label THIS router allocated and advertised upstream — also the label this router expects on ingress for this LSP. */
  label?: LabelValue;
}

export interface RsvpLsp {
  id: string;
  ingress: RouterId;
  egress: RouterId;
  state: LspLifecycleState;
  requestedBandwidthMbps: number;
  reservedBandwidthMbps?: number;
  pathType: PathType;
  affinityInclude?: Affinity;
  cspf?: CspfResult;
  path?: RouterId[];
  hops: Partial<Record<RouterId, HopSignalState>>;
  /** Links that have already had bandwidth admitted, hop by hop, as RESV propagates (brief §18 — progressive, not all-at-once). */
  reservedLinkIds: LinkId[];
}

export function createLsp(id: string, requestedBandwidthMbps: number): RsvpLsp {
  return { id, ingress: INGRESS, egress: EGRESS, state: "DOWN", requestedBandwidthMbps, pathType: "dynamic", hops: {}, reservedLinkIds: [] };
}

export function forSnapshot(lsp: RsvpLsp): LspSnapshotForBandwidth {
  return { path: lsp.path, reservedLinkIds: lsp.reservedLinkIds, requestedBandwidthMbps: lsp.requestedBandwidthMbps };
}

export function buildRro(lsp: RsvpLsp): RouterId[] {
  if (!lsp.path) return [];
  return lsp.path.filter((r) => r === lsp.ingress || lsp.hops[r]?.resvSent || lsp.hops[r]?.resvReceived);
}

// ---------------------------------------------------------------------------
// MPLS forwarding state built FROM signaling (brief §17/§25/§26) — the
// data plane never re-runs CSPF or RSVP; it only uses what signaling
// already installed.
// ---------------------------------------------------------------------------

export type FwdAction = "PUSH" | "SWAP" | "POP" | "IP_FORWARD";
export interface RsvpFwdEntry {
  incomingLabel: LabelValue | "UNLABELED";
  action: FwdAction;
  outgoingLabel?: LabelValue;
  outgoingInterface?: RouterId;
}

export function buildRsvpForwardingState(lsp: RsvpLsp): Partial<Record<RouterId, RsvpFwdEntry>> {
  const path = lsp.path;
  if (!path || lsp.state !== "UP") return {};
  const out: Partial<Record<RouterId, RsvpFwdEntry>> = {};
  path.forEach((r, i) => {
    if (i === 0) {
      const nextLabel = lsp.hops[path[1]]?.label;
      out[r] = { incomingLabel: "UNLABELED", action: "PUSH", outgoingLabel: nextLabel, outgoingInterface: path[1] };
      return;
    }
    if (i === path.length - 1) {
      out[r] = { incomingLabel: "UNLABELED", action: "IP_FORWARD" };
      return;
    }
    const myLabel: LabelValue | "UNLABELED" = lsp.hops[r]?.label ?? "UNLABELED";
    const nextR = path[i + 1];
    const nextLabel = lsp.hops[nextR]?.label;
    if (nextLabel === "IMPLICIT_NULL") out[r] = { incomingLabel: myLabel, action: "POP", outgoingInterface: nextR };
    else out[r] = { incomingLabel: myLabel, action: "SWAP", outgoingLabel: nextLabel, outgoingInterface: nextR };
  });
  return out;
}

// ---------------------------------------------------------------------------
// Journey (data-plane hop log) — same shape PacketJourneyTimeline expects.
// ---------------------------------------------------------------------------

export interface JourneyHop {
  router: RouterId;
  input: string;
  lookup: string;
  action: FwdAction | "IGP_FORWARD";
  output: string;
}

// ---------------------------------------------------------------------------
// Top-level scenario state
// ---------------------------------------------------------------------------

export interface RsvpTeState {
  teLinks: TeLinkDef[];
  backgroundReservations: BackgroundReservation[];
  lsp: RsvpLsp;
  packet?: MplsPacketState;
  packetAt?: RouterId;
  journey: JourneyHop[];
  faultActive: boolean;
  repairAttempt?: { choice: string; correct: boolean };
  challengeSucceeded?: boolean;
}

export function createRsvpTeState(): RsvpTeState {
  return {
    teLinks: TE_LINKS,
    backgroundReservations: [],
    lsp: createLsp("R1-to-R6", 500),
    journey: [],
    faultActive: false,
  };
}

// ---------------------------------------------------------------------------
// Graph layout (brief §1 diamond)
// ---------------------------------------------------------------------------

export const GRAPH_NODES = [
  { id: "R1", label: "R1", x: 8, y: 50, subLabel: "Ingress / Headend" },
  { id: "R2", label: "R2", x: 38, y: 18 },
  { id: "R3", label: "R3", x: 38, y: 82 },
  { id: "R4", label: "R4", x: 68, y: 18 },
  { id: "R5", label: "R5", x: 68, y: 82 },
  { id: "R6", label: "R6", x: 92, y: 50, subLabel: "Egress / Tailend" },
];

export const GRAPH_EDGES: { id: LinkId; a: RouterId; b: RouterId }[] = TE_LINKS.map((l) => ({ id: l.id, a: l.a, b: l.b }));

// ---------------------------------------------------------------------------
// Packet builders
// ---------------------------------------------------------------------------

function ipLayer(src: string, dst: string): PacketLayer {
  return { name: "IPv4", color: "var(--pv-proto-ip)", fields: [{ label: "Source IP", value: src }, { label: "Destination IP", value: dst }] };
}
function shimLayer(label: MplsLabel): PacketLayer {
  return {
    name: "MPLS Shim (transport)",
    color: "var(--pv-proto-mpls)",
    fields: [
      { label: "Label", value: label.value === undefined ? "—" : String(label.value) },
      { label: "TC (Traffic Class)", value: String(label.tc) },
      { label: "S (Bottom of Stack)", value: label.bottomOfStack ? "1" : "0" },
      { label: "TTL", value: String(label.ttl) },
    ],
  };
}
export function buildPacketLayers(pkt: MplsPacketState): PacketLayer[] {
  return [...pkt.labels.map(shimLayer), ipLayer(pkt.srcIp, pkt.dstIp)];
}
function mplsPacket(id: string, from: RouterId, to: RouterId, summary: string, badge: string, pkt: MplsPacketState): PacketVisual {
  return { id, protocol: "MPLS", from, to, summary, badge, layers: buildPacketLayers(pkt) };
}
function rsvpLayer(fields: { label: string; value: string }[]): PacketLayer {
  return { name: "RSVP", color: "var(--pv-proto-mpls)", fields };
}
function rsvpPacket(id: string, from: RouterId, to: RouterId, summary: string, badge: "PATH" | "RESV", fields: { label: string; value: string }[]): PacketVisual {
  return { id, protocol: "MPLS", from, to, summary, badge, layers: [rsvpLayer(fields)] };
}

const HOST_BEHIND_R1 = "10.1.1.10";
const HOST_BEHIND_R6 = "10.6.6.20";

// ---------------------------------------------------------------------------
// PATH / RESV field builders (brief §12) — only fields the model
// actually represents; no fabricated byte-level encoding.
// ---------------------------------------------------------------------------

function pathFields(lsp: RsvpLsp, advanced: boolean): { label: string; value: string }[] {
  const ero = lsp.path ? buildEro(lsp.path) : [];
  const basic = [
    { label: "Message", value: "PATH" },
    { label: "Tunnel", value: `${lsp.ingress} → ${lsp.egress}` },
    { label: "Requested Bandwidth", value: `${lsp.requestedBandwidthMbps} Mbps` },
    { label: "Explicit Path", value: ero.join(" → ") || "—" },
  ];
  if (!advanced) return basic;
  return [
    ...basic,
    { label: "SESSION", value: `${lsp.egress} / Tunnel-ID 1` },
    { label: "RSVP_HOP", value: "previous-hop address (per hop)" },
    { label: "TIME_VALUES", value: "refresh interval (soft state)" },
    { label: "EXPLICIT_ROUTE", value: ero.join(", ") || "—" },
    { label: "LABEL_REQUEST", value: "requested (label-switched path)" },
    { label: "SESSION_ATTRIBUTE", value: lsp.pathType === "explicit" ? "explicit path" : "dynamic (CSPF-computed)" },
    { label: "SENDER_TEMPLATE", value: `${lsp.ingress} / Tunnel-ID 1` },
    { label: "SENDER_TSPEC", value: `${lsp.requestedBandwidthMbps} Mbps` },
  ];
}
function resvFields(lsp: RsvpLsp, atRouter: RouterId, advanced: boolean): { label: string; value: string }[] {
  const label = lsp.hops[atRouter]?.label;
  const basic = [
    { label: "Message", value: "RESV" },
    { label: "Tunnel", value: `${lsp.ingress} → ${lsp.egress}` },
    { label: "Reserved Bandwidth", value: `${lsp.requestedBandwidthMbps} Mbps` },
    { label: "Label Advertised Upstream", value: label !== undefined ? fmtLabel(label) : "—" },
  ];
  if (!advanced) return basic;
  return [...basic, { label: "SESSION", value: `${lsp.egress} / Tunnel-ID 1` }, { label: "STYLE", value: "Fixed Filter" }, { label: "FLOWSPEC", value: `${lsp.requestedBandwidthMbps} Mbps` }, { label: "LABEL", value: label !== undefined ? fmtLabel(label) : "—" }];
}

// ---------------------------------------------------------------------------
// Scenario steps
// ---------------------------------------------------------------------------

const stepIdx = (steps: ScenarioStep<RsvpTeState>[], id: string) => steps.findIndex((s) => s.id === id);

export const rsvpTeSteps: ScenarioStep<RsvpTeState>[] = [
  {
    id: "intro",
    label: "The Central Question",
    narrative:
      "R1 needs to reach R6 across a fabric with two possible paths. Every routing protocol you've studied so far answers one question: \"what is the shortest reachable path?\" This lesson is about a different question entirely: what if the IGP shortest path is not the path we want traffic to use?",
  },
  {
    id: "topology-intro",
    label: "The Topology",
    narrative:
      "R1 is the RSVP-TE ingress (headend) — it originates the tunnel. R6 is the egress (tailend) — where the tunnel ends. Two candidate paths connect them: the TOP PATH (R1 → R2 → R4 → R6) and the BOTTOM PATH (R1 → R3 → R5 → R6). Both are real, usable paths through this fabric.",
  },
  {
    id: "igp-values",
    label: "IGP & TE Values",
    narrative:
      "Top path links (R1-R2, R2-R4, R4-R6) each carry IGP cost 10 and TE metric 10 — total cost 30. Bottom path links (R1-R3, R3-R5, R5-R6) each carry IGP cost 15 and TE metric 15 — total cost 45. By cost alone, the top path is clearly preferred.",
  },
  {
    id: "predict-igp-path",
    label: "Predict",
    narrative: "Before any RSVP-TE tunnel exists, R1 already has ordinary IGP reachability to R6.",
    question: {
      prompt: "Which path does plain IGP forwarding use to reach R6 from R1?",
      options: [
        { id: "top", label: "R1 → R2 → R4 → R6 (cost 30)" },
        { id: "bottom", label: "R1 → R3 → R5 → R6 (cost 45)" },
        { id: "both", label: "Both paths, load-balanced equally" },
        { id: "neither", label: "Neither — R6 isn't reachable yet" },
      ],
      correctOptionId: "top",
      explanation: "The IGP's SPF algorithm asks only one question — what is the shortest reachable path? — and answers it purely by cost. Cost 30 beats cost 45, so ordinary IGP forwarding uses R1 → R2 → R4 → R6, full stop.",
    },
  },
  {
    id: "igp-send",
    label: "Send A Test Flow",
    narrative: `A host behind R1 (${HOST_BEHIND_R1}) sends a packet toward a host behind R6 (${HOST_BEHIND_R6}). No RSVP-TE tunnel exists yet — this is ordinary IP forwarding, following whatever the IGP's shortest path says.`,
    packet: () => ({ id: "igp-ip", protocol: "IP", from: "R1", to: "R2", summary: "Plain IP packet, IGP-forwarded", layers: [ipLayer(HOST_BEHIND_R1, HOST_BEHIND_R6)] }),
    run: (state) => ({
      state: { ...state, packet: { srcIp: HOST_BEHIND_R1, dstIp: HOST_BEHIND_R6, labels: [] }, packetAt: "R2", journey: [{ router: "R1", input: "IP packet", lookup: "IGP route: R6 via R2 (cost 30)", action: "IGP_FORWARD", output: "IP packet → R2" }] },
      events: [{ type: "PACKET_SENT", stepId: "igp-send", timestamp: Date.now(), message: "R1 forwards the packet using its IGP route toward R6" }],
    }),
  },
  {
    id: "igp-hop-2",
    label: "R2 → R4 (IGP)",
    narrative: "R2 performs a normal IP lookup and forwards toward R4 — no labels, no traffic engineering, just the IGP shortest path.",
    packet: (state) => (state.packet ? { id: "igp-ip-2", protocol: "IP", from: "R2", to: "R4", summary: "Plain IP packet, IGP-forwarded", layers: buildPacketLayers(state.packet) } : undefined),
    run: (state) => ({
      state: { ...state, packetAt: "R4", journey: [...state.journey, { router: "R2", input: "IP packet", lookup: "IGP route: R6 via R4", action: "IGP_FORWARD", output: "IP packet → R4" }] },
      events: [{ type: "PACKET_SENT", stepId: "igp-hop-2", timestamp: Date.now(), message: "R2 forwards toward R4" }],
    }),
  },
  {
    id: "igp-hop-3",
    label: "R4 → R6 (IGP)",
    narrative: "R4 delivers the packet to R6 — the IGP shortest path, end to end, exactly as SPF computed it.",
    packet: (state) => (state.packet ? { id: "igp-ip-3", protocol: "IP", from: "R4", to: "R6", summary: "Plain IP packet, delivered via IGP shortest path", layers: buildPacketLayers(state.packet) } : undefined),
    run: (state) => ({
      state: { ...state, packetAt: "R6", journey: [...state.journey, { router: "R4", input: "IP packet", lookup: "IGP route: R6 directly connected", action: "IGP_FORWARD", output: "IP packet → R6" }] },
      events: [{ type: "PACKET_SENT", stepId: "igp-hop-3", timestamp: Date.now(), message: "R4 delivers the packet to R6" }],
    }),
    whatChanged: () => ["Packet delivered R1 → R2 → R4 → R6 — the IGP shortest path, cost 30"],
  },
  {
    id: "business-requirement",
    label: "A New Requirement",
    narrative:
      "The business now needs a guaranteed 500 Mbps traffic-engineered LSP from R1 to R6. Look again at the top path: R2-R4's maximum reservable bandwidth is only 200 Mbps. Even though the top path is the IGP shortest path, it can never satisfy a 500 Mbps constraint — that ceiling isn't about instantaneous congestion, it's a hard TE bandwidth limit.",
    run: (state) => ({ state: { ...state, packet: undefined, packetAt: undefined, journey: [] }, events: [] }),
  },
  {
    id: "predict-should-use-shortest",
    label: "Predict",
    narrative: "R2-R4's reservable bandwidth (200 Mbps) is a hard limit — not something that becomes available if nothing else is currently using it beyond that ceiling.",
    question: {
      prompt: "Should the new 500 Mbps tunnel still use the IGP shortest path (top path)?",
      options: [
        { id: "no", label: "No — the top path cannot satisfy the bandwidth constraint" },
        { id: "yes", label: "Yes — shortest path is always preferred" },
        { id: "yes-if-idle", label: "Yes, as long as no other traffic is using R2-R4 right now" },
        { id: "unknown", label: "Can't tell without knowing current utilization" },
      ],
      correctOptionId: "no",
      explanation: "R2-R4's maximum reservable bandwidth is 200 Mbps — a TE policy ceiling, not a measurement of current traffic. No matter how idle the link is right now, RSVP-TE can never admit a 500 Mbps reservation against a 200 Mbps ceiling. The top path is disqualified before any packet is ever sent.",
    },
  },
  {
    id: "te-intro",
    label: "Traffic Engineering, Not Just Reachability",
    narrative:
      "Ordinary IGP SPF asks: \"what is the shortest reachable path?\" Traffic Engineering asks a different question: \"what path satisfies my constraints?\" Constraints can include required bandwidth, TE metric, an explicit path, or administrative groups (affinities). This lesson starts with bandwidth — affinity comes later.",
  },
  {
    id: "te-db-intro",
    label: "The Traffic Engineering Database",
    narrative:
      "Every RSVP-TE-capable link publishes its attributes into a Traffic Engineering Database (TED): IGP metric, TE metric, maximum bandwidth, maximum reservable bandwidth, currently reserved bandwidth, and available reservable bandwidth. Open the TE DATABASE panel and find R2-R4 — its available reservable bandwidth (200 Mbps) is exactly what disqualifies the top path.",
  },
  {
    id: "te-source-intro",
    label: "Where TE Information Comes From",
    narrative:
      "Conceptually: IGP traffic-engineering extensions (OSPF or IS-IS) advertise additional link attributes beyond plain reachability — these populate the TED. This lesson stays protocol-neutral about which IGP is running; use the [OSPF TE] / [IS-IS TE] tabs on the TE Database panel to compare how each one conceptually sources the same attributes.",
  },
  {
    id: "cspf-intro",
    label: "CSPF",
    narrative: "Constrained Shortest Path First (CSPF) is not \"SPF but smarter.\" It's a two-stage process: first remove every link that violates a constraint, then run an ordinary shortest-path calculation — using the TE metric — on whatever topology remains.",
  },
  {
    id: "predict-cspf",
    label: "Predict",
    narrative: "Before CSPF runs for the 500 Mbps request:",
    question: {
      prompt: "What does CSPF actually do differently from ordinary SPF?",
      options: [
        { id: "prune-then-spf", label: "It removes constraint-violating links first, then runs shortest-path on what's left" },
        { id: "faster", label: "It's simply a faster implementation of the same SPF algorithm" },
        { id: "ignores-metric", label: "It ignores link metrics entirely and picks the path with the most hops" },
        { id: "same", label: "It's identical to SPF — CSPF is just RSVP's name for it" },
      ],
      correctOptionId: "prune-then-spf",
      explanation: "CSPF's defining step is pruning: every link that fails a constraint (here, bandwidth) is removed from the candidate topology BEFORE any shortest-path calculation runs. Only surviving links are ever considered for the path.",
    },
  },
  {
    id: "cspf-analysis-full",
    label: "CSPF Analysis — Full Topology",
    narrative: "Start with the complete topology: R1-R2-R4-R6 and R1-R3-R5-R6, both fully intact. The constraint for this tunnel: Required Bandwidth 500 Mbps.",
  },
  {
    id: "cspf-analysis-evaluate",
    label: "Evaluate Every Link",
    narrative: "CSPF inspects every link in the topology against the constraint — not just the links on one candidate path. R1-R2 (1000 Mbps available) passes. R2-R4 (200 Mbps available) fails outright. R4-R6, R1-R3, R3-R5, R5-R6 (1000 Mbps each) all pass.",
    run: (state) => {
      const cspf = computeCspf({ requiredBandwidthMbps: state.lsp.requestedBandwidthMbps }, state.backgroundReservations, state.teLinks, INGRESS, EGRESS, forSnapshot(state.lsp));
      return {
        state: { ...state, lsp: { ...state.lsp, state: "CSPF", cspf } },
        events: [{ type: "MPLS_LSP_CHANGED", stepId: "cspf-analysis-evaluate", timestamp: Date.now(), message: "CSPF evaluates every link against the 500 Mbps constraint" }],
      };
    },
    whatChanged: (_, next) => (next.lsp.cspf ? next.lsp.cspf.evaluations.map((e) => `${e.label}: available ${e.availableMbps} Mbps, required ${e.requiredMbps} Mbps → ${e.pass ? "PASS" : "FAIL"}`) : []),
  },
  {
    id: "cspf-analysis-prune",
    label: "Prune The Failing Link",
    narrative: "R2-R4 is removed from the CSPF candidate graph entirely — not just deprioritized, removed. Every other link survives the bandwidth test.",
    whatChanged: (_, next) => (next.lsp.cspf ? [`Pruned: ${next.lsp.cspf.prunedLinkIds.join(", ") || "(none)"}`] : []),
  },
  {
    id: "cspf-result",
    label: "Shortest Valid Path",
    narrative: "With R2-R4 removed, only the bottom path (R1 → R3 → R5 → R6) still connects R1 to R6. CSPF runs shortest-path on the surviving topology and selects it — TE metric total 45.",
    run: (state) => {
      const path = state.lsp.cspf?.path;
      return { state: { ...state, lsp: { ...state.lsp, path, affinityInclude: undefined } }, events: [{ type: "MPLS_LSP_CHANGED", stepId: "cspf-result", timestamp: Date.now(), message: `CSPF selects ${path?.join(" → ") ?? "no path"}` }] };
    },
    whatChanged: (_, next) => [`CSPF-selected path: ${next.lsp.path?.join(" → ") ?? "none found"} (TE metric ${next.lsp.cspf?.teMetricTotal ?? "—"})`],
  },
  {
    id: "predict-cspf-result",
    label: "Predict",
    narrative: "R2-R4 was pruned from the candidate graph before any shortest-path calculation ran.",
    question: {
      prompt: "Which path does CSPF select for the 500 Mbps tunnel?",
      options: [
        { id: "bottom", label: "R1 → R3 → R5 → R6 — the only surviving path" },
        { id: "top", label: "R1 → R2 → R4 → R6 — still the lowest metric" },
        { id: "none", label: "No path — CSPF gives up once any link is pruned" },
        { id: "both", label: "Both paths, since bandwidth can be split across them" },
      ],
      correctOptionId: "bottom",
      explanation: "Once R2-R4 is pruned, the top path no longer exists in the candidate graph at all — there's nothing left to compare it against. The bottom path is not just \"better\"; it's the ONLY path that survives constraint filtering, so CSPF selects it even though its TE metric (45) is worse than the top path's (30).",
    },
  },
  {
    id: "ero-intro",
    label: "Explicit Route Object (ERO)",
    narrative: "CSPF's chosen path becomes an Explicit Route Object: R3 → R5 → R6 (the ingress, R1, isn't listed — it's implicit as the sender). The ERO communicates the intended path during RSVP signaling — it does not itself forward a single data packet.",
  },
  {
    id: "rsvp-signaling-intro",
    label: "RSVP-TE Signaling Begins",
    narrative: "RSVP-TE now signals the path CSPF computed. PATH travels ingress → egress (R1 → R3 → R5 → R6). RESV travels the opposite direction, egress → ingress (R6 → R5 → R3 → R1). This directionality is the single most important thing to keep straight in this lesson.",
    run: (state) => ({ state: { ...state, lsp: { ...state.lsp, state: "SIGNALING" } }, events: [{ type: "MPLS_LSP_CHANGED", stepId: "rsvp-signaling-intro", timestamp: Date.now(), message: "RSVP-TE signaling begins" }] }),
  },
  {
    id: "path-hop-1",
    label: "PATH: R1 → R3",
    narrative: "R1 originates a PATH message carrying the ERO, the requested bandwidth, and its own sender information, and forwards it to the first ERO hop, R3.",
    packet: (state) => rsvpPacket("path-1", "R1", "R3", "PATH → R3", "PATH", pathFields(state.lsp, false)),
    run: (state) => ({
      state: { ...state, lsp: { ...state.lsp, hops: { ...state.lsp.hops, R1: { ...state.lsp.hops.R1, pathSent: true }, R3: { ...state.lsp.hops.R3, pathReceived: true } } } },
      events: [{ type: "MPLS_LSP_CHANGED", stepId: "path-hop-1", timestamp: Date.now(), message: "R1 sends PATH toward R3" }],
    }),
  },
  {
    id: "path-r3-pipeline",
    label: "R3 Processes PATH",
    narrative:
      "Enter R3 in the 3D device view to X-Ray this conceptual pipeline: IP/RSVP ingress → identify TE session → inspect ERO → verify local hop → check path state → record previous RSVP hop (R1) → forward PATH toward the next ERO hop (R5). R3 does NOT allocate a final forwarding label here — that only happens during RESV.",
  },
  {
    id: "path-hop-2",
    label: "PATH: R3 → R5",
    narrative: "R3 records R1 as its previous RSVP hop, then forwards PATH to the next ERO hop, R5.",
    packet: (state) => rsvpPacket("path-2", "R3", "R5", "PATH → R5", "PATH", pathFields(state.lsp, false)),
    run: (state) => ({
      state: { ...state, lsp: { ...state.lsp, hops: { ...state.lsp.hops, R3: { ...state.lsp.hops.R3, pathSent: true }, R5: { ...state.lsp.hops.R5, pathReceived: true } } } },
      events: [{ type: "MPLS_LSP_CHANGED", stepId: "path-hop-2", timestamp: Date.now(), message: "R3 forwards PATH toward R5" }],
    }),
  },
  {
    id: "path-hop-3",
    label: "PATH: R5 → R6",
    narrative: "R5 records R3 as its previous RSVP hop, then forwards PATH to the final ERO hop, R6 — the tailend.",
    packet: (state) => rsvpPacket("path-3", "R5", "R6", "PATH → R6", "PATH", pathFields(state.lsp, false)),
    run: (state) => ({
      state: { ...state, lsp: { ...state.lsp, hops: { ...state.lsp.hops, R5: { ...state.lsp.hops.R5, pathSent: true }, R6: { ...state.lsp.hops.R6, pathReceived: true } } } },
      events: [{ type: "MPLS_LSP_CHANGED", stepId: "path-hop-3", timestamp: Date.now(), message: "R5 forwards PATH toward R6" }],
    }),
    whatChanged: () => ["PATH has now reached the tailend: R1 → R3 → R5 → R6"],
  },
  {
    id: "path-tailend",
    label: "PATH Reaches R6",
    narrative: "R6 receives PATH, evaluates the requested 500 Mbps against its own local resources, and generates a reservation response. RESV now begins traveling upstream.",
  },
  {
    id: "predict-resv-direction",
    label: "Predict",
    narrative: "PATH just traveled R1 → R3 → R5 → R6.",
    question: {
      prompt: "Which direction does RESV travel?",
      options: [
        { id: "reverse", label: "R6 → R5 → R3 → R1 — the reverse of PATH" },
        { id: "same", label: "R1 → R3 → R5 → R6 — the same direction as PATH" },
        { id: "broadcast", label: "Flooded to every router simultaneously" },
        { id: "none", label: "RESV isn't needed if PATH succeeded" },
      ],
      correctOptionId: "reverse",
      explanation: "RESV always travels egress → ingress — the exact reverse of PATH. This is how downstream-assigned labels and reservation state reach the ingress: each hop advertises upstream, one hop at a time, back toward R1.",
    },
  },
  {
    id: "resv-hop-1",
    label: "RESV: R6 → R5",
    narrative: "R6 allocates implicit-null for this LSP (it's the egress — Penultimate Hop Popping applies) and sends RESV upstream to R5, admitting 500 Mbps on R5-R6.",
    packet: (state) => rsvpPacket("resv-1", "R6", "R5", "RESV → R5", "RESV", resvFields(state.lsp, "R6", false)),
    run: (state) => {
      const path = state.lsp.path ?? BOTTOM_PATH;
      const label = allocateRsvpLabel(path, "R6");
      const linkId = linkBetween(state.teLinks, "R5", "R6")!.id;
      return {
        state: { ...state, lsp: { ...state.lsp, hops: { ...state.lsp.hops, R6: { ...state.lsp.hops.R6, resvSent: true, label }, R5: { ...state.lsp.hops.R5, resvReceived: true } }, reservedLinkIds: [...state.lsp.reservedLinkIds, linkId] } },
        events: [
          { type: "MPLS_LABEL_INSTALLED", stepId: "resv-hop-1", timestamp: Date.now(), message: `R6 advertises ${fmtLabel(label)} upstream to R5` },
          { type: "MPLS_LSP_CHANGED", stepId: "resv-hop-1", timestamp: Date.now(), message: "500 Mbps admitted on R5-R6" },
        ],
      };
    },
    whatChanged: (_, next) => [`R6 advertises ${fmtLabel(next.lsp.hops.R6?.label ?? "IMPLICIT_NULL")} upstream (implicit-null — PHP)`, "R5-R6: 500 Mbps reserved"],
  },
  {
    id: "resv-r5-pipeline",
    label: "R5 Processes RESV",
    narrative:
      "Enter R5 in the 3D device view to X-Ray this conceptual pipeline: RESV received → identify TE session → reservation state → allocate/install label state → program forwarding entry → propagate RESV upstream. This is exactly where R5's MPLS forwarding state (distinct from its signaling state) gets programmed.",
  },
  {
    id: "resv-hop-2",
    label: "RESV: R5 → R3",
    narrative: "R5 allocates label 300 for this LSP, advertises it upstream to R3, and admits 500 Mbps on R3-R5.",
    packet: (state) => rsvpPacket("resv-2", "R5", "R3", "RESV → R3", "RESV", resvFields(state.lsp, "R5", false)),
    run: (state) => {
      const path = state.lsp.path ?? BOTTOM_PATH;
      const label = allocateRsvpLabel(path, "R5");
      const linkId = linkBetween(state.teLinks, "R3", "R5")!.id;
      return {
        state: { ...state, lsp: { ...state.lsp, hops: { ...state.lsp.hops, R5: { ...state.lsp.hops.R5, resvSent: true, label }, R3: { ...state.lsp.hops.R3, resvReceived: true } }, reservedLinkIds: [...state.lsp.reservedLinkIds, linkId] } },
        events: [
          { type: "MPLS_LABEL_INSTALLED", stepId: "resv-hop-2", timestamp: Date.now(), message: `R5 advertises label ${fmtLabel(label)} upstream to R3` },
          { type: "MPLS_LSP_CHANGED", stepId: "resv-hop-2", timestamp: Date.now(), message: "500 Mbps admitted on R3-R5" },
        ],
      };
    },
    whatChanged: (_, next) => [`R5 advertises label ${fmtLabel(next.lsp.hops.R5?.label ?? 300)} upstream to R3`, "R3-R5: 500 Mbps reserved"],
  },
  {
    id: "resv-hop-3",
    label: "RESV: R3 → R1",
    narrative: "R3 allocates label 200, advertises it upstream to R1, and admits 500 Mbps on R1-R3. RESV has now reached the ingress.",
    packet: (state) => rsvpPacket("resv-3", "R3", "R1", "RESV → R1", "RESV", resvFields(state.lsp, "R3", false)),
    run: (state) => {
      const path = state.lsp.path ?? BOTTOM_PATH;
      const label = allocateRsvpLabel(path, "R3");
      const linkId = linkBetween(state.teLinks, "R1", "R3")!.id;
      return {
        state: { ...state, lsp: { ...state.lsp, hops: { ...state.lsp.hops, R3: { ...state.lsp.hops.R3, resvSent: true, label }, R1: { ...state.lsp.hops.R1, resvReceived: true } }, reservedLinkIds: [...state.lsp.reservedLinkIds, linkId] } },
        events: [
          { type: "MPLS_LABEL_INSTALLED", stepId: "resv-hop-3", timestamp: Date.now(), message: `R3 advertises label ${fmtLabel(label)} upstream to R1` },
          { type: "MPLS_LSP_CHANGED", stepId: "resv-hop-3", timestamp: Date.now(), message: "500 Mbps admitted on R1-R3 — RESV reached the ingress" },
        ],
      };
    },
    whatChanged: (_, next) => [`R3 advertises label ${fmtLabel(next.lsp.hops.R3?.label ?? 200)} upstream to R1`, "R1-R3: 500 Mbps reserved", "Resulting LSP: R1 PUSH 200 · R3 SWAP 200→300 · R5 POP (egress toward R6)"],
  },
  {
    id: "lsp-up",
    label: "RSVP-TE LSP: UP",
    narrative: "Every hop has admitted 500 Mbps and installed label state. The LSP transitions from SIGNALING to UP.",
    run: (state) => ({
      state: { ...state, lsp: { ...state.lsp, state: "UP", reservedBandwidthMbps: state.lsp.requestedBandwidthMbps } },
      events: [{ type: "MPLS_LSP_CHANGED", stepId: "lsp-up", timestamp: Date.now(), message: "LSP R1-to-R6: UP" }],
    }),
    whatChanged: () => ["LSP R1-to-R6: SIGNALING → UP", "Reserved bandwidth: 500 Mbps end to end"],
  },
  {
    id: "lsp-lifecycle-intro",
    label: "PacketVerse LSP Lifecycle",
    narrative:
      "This DOWN → CSPF → SIGNALING → UP progression is a PacketVerse teaching abstraction, not an official RSVP protocol finite state machine — real implementations track substantially more internal state. It's a useful simplification for seeing where this tunnel is right now.",
  },
  {
    id: "session-tables-intro",
    label: "RSVP Session Tables",
    narrative: "Open Device Explorer on R1, R3, R5, or R6 and check the RSVP Sessions / RSVP LSPs tabs — PATH state, RESV state, previous/next hop, requested and reserved bandwidth, and incoming/outgoing labels are all inspectable per device. Not every field applies equally on every router (R1 has no previous hop; R6 has no next hop).",
  },
  {
    id: "dataplane-intro",
    label: "Now, Real Traffic",
    narrative: "CSPF and RSVP already established this LSP — a data packet does not run CSPF or RSVP signaling at each hop. It simply uses the forwarding state signaling already installed.",
  },
  {
    id: "send-data-packet",
    label: "Send An MPLS Packet",
    narrative: `A host behind R1 (${HOST_BEHIND_R1}) sends a packet toward the host behind R6 (${HOST_BEHIND_R6}) — this time, it's classified into the RSVP-TE tunnel.`,
    packet: () => ({ id: "data-ip", protocol: "IP", from: "R1", to: "R1", summary: "Packet classified into tunnel R1-to-R6", layers: [ipLayer(HOST_BEHIND_R1, HOST_BEHIND_R6)] }),
    run: (state) => ({
      state: { ...state, packet: { srcIp: HOST_BEHIND_R1, dstIp: HOST_BEHIND_R6, labels: [] }, packetAt: "R1", journey: [] },
      events: [{ type: "PACKET_SENT", stepId: "send-data-packet", timestamp: Date.now(), message: "Packet classified into LSP R1-to-R6" }],
    }),
  },
  {
    id: "r1-ingress-push",
    label: "R1: PUSH (Ingress)",
    narrative: "R1 classifies the packet into the tunnel, selects the installed LSP forwarding state, and pushes the transport label (200) — no CSPF, no PATH, no RESV, just the LFIB-equivalent state RSVP already built.",
    packet: (state) => (state.packet ? mplsPacket("push", "R1", "R3", "PUSH 200", "PUSH", state.packet) : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const fwd = buildRsvpForwardingState(state.lsp);
      const label = fwd.R1?.outgoingLabel;
      const packet = pushLabel(state.packet, typeof label === "number" ? label : 200);
      const journey = [...state.journey, { router: "R1" as RouterId, input: "IP packet (unlabeled)", lookup: "RSVP-TE forwarding state: LSP R1-to-R6", action: "PUSH" as FwdAction, output: `label ${fmtLabel(label ?? 200)} + IP packet` }];
      return { state: { ...state, packet, packetAt: "R3", journey }, events: [{ type: "MPLS_LABEL_PUSHED", stepId: "r1-ingress-push", timestamp: Date.now(), message: "R1 pushes the transport label" }] };
    },
    whatChanged: () => ["Packet: [IP] → [200][IP]"],
  },
  {
    id: "r3-transit-swap",
    label: "R3: SWAP (Transit)",
    narrative: "R3 reads the top label, matches it against RSVP-installed forwarding state, and swaps 200 → 300 toward R5 — a label-only decision, using only the state RESV programmed.",
    packet: (state) => (state.packet ? mplsPacket("swap", "R3", "R5", "SWAP 200 → 300", "SWAP", state.packet) : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const fwd = buildRsvpForwardingState(state.lsp);
      const outLabel = fwd.R3?.outgoingLabel;
      const packet = swapTopLabel(state.packet, typeof outLabel === "number" ? outLabel : 300);
      const journey = [...state.journey, { router: "R3" as RouterId, input: "label 200", lookup: "RSVP-installed forwarding entry: 200 → SWAP → 300", action: "SWAP" as FwdAction, output: "label 300" }];
      return { state: { ...state, packet, packetAt: "R5", journey }, events: [{ type: "MPLS_LABEL_SWAPPED", stepId: "r3-transit-swap", timestamp: Date.now(), message: "R3 swaps 200 → 300" }] };
    },
    whatChanged: () => ["Packet: [200][IP] → [300][IP]"],
  },
  {
    id: "r5-egress-pop",
    label: "R5: POP (PHP toward R6)",
    narrative: "R5 is the penultimate hop — R6 signaled implicit-null, so R5 pops the label before forwarding a plain IP packet to R6.",
    packet: (state) => (state.packet ? mplsPacket("pop", "R5", "R6", "POP — penultimate hop popping", "POP", state.packet) : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const packet = popTopLabel(state.packet);
      const journey = [...state.journey, { router: "R5" as RouterId, input: "label 300", lookup: "RSVP-installed forwarding entry: 300 → POP (implicit-null from R6)", action: "POP" as FwdAction, output: "IP packet (unlabeled)" }];
      return { state: { ...state, packet, packetAt: "R6", journey }, events: [{ type: "MPLS_LABEL_POPPED", stepId: "r5-egress-pop", timestamp: Date.now(), message: "R5 pops the label (PHP)" }] };
    },
    whatChanged: () => ["Packet: [300][IP] → [IP]"],
  },
  {
    id: "r6-deliver",
    label: "R6 Delivers",
    narrative: "R6 receives a plain IP packet — already exposed by R5's PHP — and delivers it. The MPLS traffic followed the engineered path, R1 → R3 → R5 → R6, exactly as RSVP-TE signaled it.",
    packet: (state) => (state.packet ? { id: "ip-r6", protocol: "IP", from: "R6", to: "R6", summary: "Delivered via the RSVP-TE LSP", layers: buildPacketLayers(state.packet) } : undefined),
    run: (state) => ({
      state: { ...state, journey: [...state.journey, { router: "R6" as RouterId, input: "IP packet (unlabeled)", lookup: "IP delivery", action: "IP_FORWARD" as FwdAction, output: "Delivered" }] },
      events: [{ type: "MPLS_PACKET_FORWARDED", stepId: "r6-deliver", timestamp: Date.now(), message: "R6 delivers the packet — RSVP-TE LSP carried real traffic end to end" }],
    }),
    whatChanged: () => ["Delivered via R1 → R3 → R5 → R6 (the RSVP-TE LSP), not R1 → R2 → R4 → R6 (the IGP shortest path)"],
  },
  {
    id: "views-intro",
    label: "Control / Data / Both, Physical / IGP / TE",
    narrative:
      "Two independent view toggles are now available. Control/Data/Both switches between the TE DB/CSPF/PATH/RESV/reservation/label side (control) and the MPLS packet following the installed LSP (data). Physical/IGP/TE switches which path the topology view emphasizes — IGP highlights R1→R2→R4→R6, TE highlights R1→R3→R5→R6.",
  },
  {
    id: "igp-vs-te-comparison",
    label: "IGP Path vs. RSVP-TE Path",
    narrative: "Side by side: the IGP shortest path (cost 30, but a 200 Mbps bottleneck) versus the RSVP-TE LSP (TE metric 45, but 500 Mbps reserved end to end). The TE path is not the IGP shortest path — it was never trying to be.",
  },
  {
    id: "interactive-lab-intro",
    label: "Try Your Own Bandwidth Request",
    narrative:
      "A separate CSPF Lab panel is now available below — pick 100 / 300 / 500 / 800 Mbps and watch CSPF recompute live against the real TE database. A 100 Mbps request can be satisfied by the top path; 500 Mbps or more cannot. This is the real domain engine recomputing, not a hardcoded lookup table.",
  },
  {
    id: "affinity-intro",
    label: "Affinity / Administrative Groups",
    narrative:
      "Beyond bandwidth, links can carry an administrative group (affinity) label. Here, the top path's links are tagged BLUE; the bottom path's links are tagged GOLD. An \"Include: GOLD\" constraint forces CSPF onto the bottom path even when both paths otherwise have sufficient bandwidth — try it in the CSPF Lab panel. Affinity is a constraint CSPF filters on, not a routing protocol in its own right.",
  },
  {
    id: "explicit-path-intro",
    label: "Dynamic CSPF vs. Explicit Path",
    narrative:
      "Dynamic: CSPF computes the path from constraints alone. Explicit: the operator specifies the hops directly. Try switching the CSPF Lab to Explicit Path — but note that RSVP still needs a viable, signalable path even when hops are specified explicitly; an explicit path through an insufficient link is still rejected.",
  },
  {
    id: "rro-reveal",
    label: "[ADVANCED] Record Route Object",
    narrative: "Once signaling succeeds, RSVP can optionally record the actual path taken — the Record Route Object (RRO): R1, R3, R5, R6. The ERO was the intended/requested path; the RRO is recorded path/state information after the fact. They are not the same object.",
  },
  {
    id: "soft-state-intro",
    label: "[ADVANCED] RSVP Soft State",
    narrative:
      "RSVP maintains soft state, not permanent static state — PATH and RESV are conceptually refreshed periodically rather than installed once and forgotten. This lesson doesn't simulate a real-time refresh timer; the conceptual point is enough: state that isn't refreshed eventually times out, unlike a statically configured entry.",
  },
  {
    id: "break-intro",
    label: "Now, Break It",
    narrative: "The 500 Mbps LSP is healthy and UP. Time to break something specific: the business now wants this same tunnel grown to 700 Mbps.",
  },
  {
    id: "fault-injected",
    label: "New Requirement: 700 Mbps",
    narrative: "An unrelated tunnel (CUST-B) already reserved 400 Mbps on R3-R5. Physical links, IGP, TE extensions, the TE database, RSVP, and destination reachability are all still fully healthy — but watch what CSPF does with 700 Mbps now.",
    run: (state) => ({
      state: {
        ...state,
        backgroundReservations: [{ id: "bg-custb", linkId: "R3-R5", mbps: 400, label: "CUST-B (existing LSP)" }],
        lsp: { ...state.lsp, requestedBandwidthMbps: 700, state: "DOWN", cspf: undefined, path: undefined, hops: {}, reservedLinkIds: [], reservedBandwidthMbps: undefined },
        faultActive: true,
        // The prior 500 Mbps LSP's data-plane journey no longer describes anything
        // current — the tunnel must be re-signaled from scratch for the new
        // requirement, so its packet/journey must not linger into this phase.
        packet: undefined,
        packetAt: undefined,
        journey: [],
      },
      events: [{ type: "MPLS_LSP_CHANGED", stepId: "fault-injected", timestamp: Date.now(), message: "New requirement: grow the tunnel to 700 Mbps; CUST-B already reserves 400 Mbps on R3-R5" }],
    }),
    whatChanged: () => ["Requested bandwidth: 500 Mbps → 700 Mbps", "R3-R5: 400 Mbps already reserved by CUST-B", "LSP R1-to-R6: UP → DOWN (must be re-signaled for the new requirement)"],
  },
  {
    id: "cspf-fails",
    label: "CSPF Finds No Path",
    narrative: "Top path bottleneck: 200 Mbps available. Bottom path bottleneck: R3-R5 now has only 600 Mbps available (1000 − 400 already reserved). Neither satisfies 700 Mbps.",
    run: (state) => {
      const cspf = computeCspf({ requiredBandwidthMbps: state.lsp.requestedBandwidthMbps }, state.backgroundReservations, state.teLinks, INGRESS, EGRESS, forSnapshot(state.lsp));
      return { state: { ...state, lsp: { ...state.lsp, state: "CSPF", cspf } }, events: [{ type: "MPLS_LSP_CHANGED", stepId: "cspf-fails", timestamp: Date.now(), message: "CSPF finds no path satisfying 700 Mbps" }] };
    },
    whatChanged: (_, next) => [`CSPF result: ${next.lsp.cspf?.path ? next.lsp.cspf.path.join(" → ") : "NO VALID PATH"}`, "Because no path was found, no PATH message is sent — RSVP never signals blind"],
  },
  {
    id: "diagnostic-ladder",
    label: "Diagnostic Ladder",
    narrative: "Physical links, IGP, TE extensions, the TE database, RSVP, and destination reachability are all healthy. The failure is specifically a bandwidth constraint — inspect the TE Database and compare required vs. available bandwidth on each candidate link before deciding on a repair.",
  },
  {
    id: "repair-challenge",
    label: "Apply The Fix",
    narrative: "Choose the correct repair to make a 700 Mbps LSP feasible.",
    action: (state, payload) => {
      const choice = typeof payload === "object" && payload !== null && "choice" in payload ? String((payload as { choice: string }).choice) : "";
      if (choice !== "release-custb") return { state: { ...state, repairAttempt: { choice, correct: false } }, events: [] };
      const backgroundReservations = state.backgroundReservations.filter((r) => r.id !== "bg-custb");
      const cspf = computeCspf({ requiredBandwidthMbps: state.lsp.requestedBandwidthMbps }, backgroundReservations, state.teLinks, INGRESS, EGRESS, forSnapshot(state.lsp));
      return {
        state: { ...state, backgroundReservations, lsp: { ...state.lsp, cspf }, faultActive: false, repairAttempt: { choice, correct: true }, challengeSucceeded: true },
        events: [
          { type: "MPLS_LSP_CHANGED", stepId: "repair-challenge", timestamp: Date.now(), message: "CUST-B's reservation on R3-R5 released" },
          { type: "MPLS_LSP_CHANGED", stepId: "repair-challenge", timestamp: Date.now(), message: `CSPF recomputed: ${cspf.path?.join(" → ") ?? "still no path"}` },
        ],
      };
    },
    requiresState: (state) => state.challengeSucceeded === true,
  },
  {
    id: "cspf-recompute-after-repair",
    label: "CSPF Recomputes",
    narrative: "With CUST-B's reservation released, R3-R5 is back to 1000 Mbps available. CSPF re-evaluates the topology: the bottom path now satisfies 700 Mbps end to end.",
    run: (state) => ({ state: { ...state, lsp: { ...state.lsp, path: state.lsp.cspf?.path } }, events: [{ type: "MPLS_LSP_CHANGED", stepId: "cspf-recompute-after-repair", timestamp: Date.now(), message: `CSPF selects ${state.lsp.cspf?.path?.join(" → ")}` }] }),
    whatChanged: (_, next) => [`CSPF-selected path: ${next.lsp.path?.join(" → ") ?? "none"} (TE metric ${next.lsp.cspf?.teMetricTotal ?? "—"})`],
  },
  {
    id: "resignal-path",
    label: "PATH Re-Signaled",
    narrative: "R1 signals PATH end to end again — R1 → R3 → R5 → R6 — this time requesting 700 Mbps.",
    packet: (state) => rsvpPacket("path-verify", "R1", "R6", "PATH → R3 → R5 → R6 (700 Mbps)", "PATH", pathFields(state.lsp, false)),
    run: (state) => ({
      state: {
        ...state,
        lsp: { ...state.lsp, state: "SIGNALING", hops: { R1: { pathSent: true }, R3: { pathReceived: true, pathSent: true }, R5: { pathReceived: true, pathSent: true }, R6: { pathReceived: true } } },
      },
      events: [{ type: "MPLS_LSP_CHANGED", stepId: "resignal-path", timestamp: Date.now(), message: "PATH re-signaled end to end for 700 Mbps" }],
    }),
  },
  {
    id: "resignal-resv",
    label: "RESV Re-Signaled",
    narrative: "RESV returns R6 → R5 → R3 → R1, re-admitting 700 Mbps hop by hop and re-installing the same label structure as before.",
    packet: (state) => rsvpPacket("resv-verify", "R6", "R1", "RESV → R5 → R3 → R1 (700 Mbps)", "RESV", resvFields(state.lsp, "R6", false)),
    run: (state) => {
      const path = state.lsp.path ?? BOTTOM_PATH;
      const hops = {
        R1: { ...state.lsp.hops.R1, resvReceived: true },
        R3: { ...state.lsp.hops.R3, resvSent: true, resvReceived: true, label: allocateRsvpLabel(path, "R3") },
        R5: { ...state.lsp.hops.R5, resvSent: true, resvReceived: true, label: allocateRsvpLabel(path, "R5") },
        R6: { ...state.lsp.hops.R6, resvSent: true, label: allocateRsvpLabel(path, "R6") },
      };
      const reservedLinkIds = linkIdsOnPath(path, state.teLinks);
      return { state: { ...state, lsp: { ...state.lsp, hops, reservedLinkIds } }, events: [{ type: "MPLS_LABEL_INSTALLED", stepId: "resignal-resv", timestamp: Date.now(), message: "Labels and 700 Mbps reservation re-installed end to end" }] };
    },
  },
  {
    id: "lsp-up-again",
    label: "LSP UP — Verified",
    narrative: "Every hop admitted 700 Mbps and installed label state. The LSP is UP again, this time carrying the larger reservation.",
    run: (state) => ({ state: { ...state, lsp: { ...state.lsp, state: "UP", reservedBandwidthMbps: state.lsp.requestedBandwidthMbps } }, events: [{ type: "MPLS_LSP_CHANGED", stepId: "lsp-up-again", timestamp: Date.now(), message: "LSP R1-to-R6: UP (700 Mbps)" }] }),
    whatChanged: () => ["LSP R1-to-R6: DOWN → UP", "Reserved bandwidth: 700 Mbps end to end"],
  },
  {
    id: "verify-data-packet",
    label: "Verify With Real Traffic",
    narrative: "Send a packet through again, end to end, to prove the repaired 700 Mbps LSP actually carries traffic over the engineered path.",
    packet: () => ({ id: "verify-ip", protocol: "IP", from: "R1", to: "R1", summary: "Verification packet", layers: [ipLayer(HOST_BEHIND_R1, HOST_BEHIND_R6)] }),
    run: (state) => ({ state: { ...state, packet: { srcIp: HOST_BEHIND_R1, dstIp: HOST_BEHIND_R6, labels: [] }, packetAt: "R1", journey: [] }, events: [{ type: "PACKET_SENT", stepId: "verify-data-packet", timestamp: Date.now(), message: "Verification packet classified into the repaired LSP" }] }),
  },
  {
    id: "verify-push",
    label: "R1: PUSH (verified)",
    narrative: "R1 pushes the transport label again — the repaired, larger-bandwidth LSP is carrying real traffic.",
    packet: (state) => (state.packet ? mplsPacket("verify-push", "R1", "R3", "PUSH 200", "PUSH", state.packet) : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const fwd = buildRsvpForwardingState(state.lsp);
      const label = fwd.R1?.outgoingLabel;
      const packet = pushLabel(state.packet, typeof label === "number" ? label : 200);
      const journey = [...state.journey, { router: "R1" as RouterId, input: "IP packet (unlabeled)", lookup: "RSVP-TE forwarding state: LSP R1-to-R6", action: "PUSH" as FwdAction, output: `label ${fmtLabel(label ?? 200)} + IP packet` }];
      return { state: { ...state, packet, packetAt: "R3", journey }, events: [{ type: "MPLS_LABEL_PUSHED", stepId: "verify-push", timestamp: Date.now(), message: "R1 pushes the transport label" }] };
    },
  },
  {
    id: "verify-swap",
    label: "R3: SWAP (verified)",
    narrative: "R3 swaps the label exactly as before, using the freshly re-installed forwarding state.",
    packet: (state) => (state.packet ? mplsPacket("verify-swap", "R3", "R5", "SWAP 200 → 300", "SWAP", state.packet) : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const fwd = buildRsvpForwardingState(state.lsp);
      const outLabel = fwd.R3?.outgoingLabel;
      const packet = swapTopLabel(state.packet, typeof outLabel === "number" ? outLabel : 300);
      const journey = [...state.journey, { router: "R3" as RouterId, input: "label 200", lookup: "RSVP-installed forwarding entry: 200 → SWAP → 300", action: "SWAP" as FwdAction, output: "label 300" }];
      return { state: { ...state, packet, packetAt: "R5", journey }, events: [{ type: "MPLS_LABEL_SWAPPED", stepId: "verify-swap", timestamp: Date.now(), message: "R3 swaps 200 → 300" }] };
    },
  },
  {
    id: "verify-pop",
    label: "R5 → R6 (verified)",
    narrative: "R5 pops the label (PHP) and R6 delivers the packet — the repaired LSP works end to end.",
    packet: (state) => (state.packet ? mplsPacket("verify-pop", "R5", "R6", "POP", "POP", state.packet) : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const packet = popTopLabel(state.packet);
      const journey = [
        ...state.journey,
        { router: "R5" as RouterId, input: "label 300", lookup: "RSVP-installed forwarding entry: 300 → POP", action: "POP" as FwdAction, output: "IP packet (unlabeled)" },
        { router: "R6" as RouterId, input: "IP packet (unlabeled)", lookup: "IP delivery", action: "IP_FORWARD" as FwdAction, output: "Delivered" },
      ];
      return {
        state: { ...state, packet, packetAt: "R6", journey },
        events: [
          { type: "MPLS_LABEL_POPPED", stepId: "verify-pop", timestamp: Date.now(), message: "R5 pops the label (PHP)" },
          { type: "MPLS_PACKET_FORWARDED", stepId: "verify-pop", timestamp: Date.now(), message: "R6 delivers the packet — LSP fully operational at 700 Mbps" },
        ],
      };
    },
    whatChanged: () => ["✓ CSPF found a valid path", "✓ PATH signaled", "✓ RESV signaled", "✓ Labels installed", "✓ 700 Mbps reserved end to end", "✓ Packet delivered via the engineered path"],
  },
  {
    id: "complete",
    label: "Lesson Complete",
    narrative:
      "You watched IGP pick the shortest path, watched a bandwidth constraint disqualify it anyway, watched CSPF prune and recompute a real constrained path, watched PATH and RESV signal in opposite directions with labels flowing upstream, watched bandwidth actually reserve on real links, and then repaired a bandwidth-constraint failure by releasing a competing reservation — never a Layer 1, IGP, or RSVP process fault. +450 XP awarded.",
    whatChanged: () => ["LSP R1-to-R6: UP — 700 Mbps reserved via R1 → R3 → R5 → R6"],
  },
];

export const STEP_IDX = {
  igpSend: stepIdx(rsvpTeSteps, "igp-send"),
  teDbIntro: stepIdx(rsvpTeSteps, "te-db-intro"),
  cspfAnalysisFull: stepIdx(rsvpTeSteps, "cspf-analysis-full"),
  cspfResult: stepIdx(rsvpTeSteps, "cspf-result"),
  eroIntro: stepIdx(rsvpTeSteps, "ero-intro"),
  pathHop1: stepIdx(rsvpTeSteps, "path-hop-1"),
  resvHop1: stepIdx(rsvpTeSteps, "resv-hop-1"),
  lspUp: stepIdx(rsvpTeSteps, "lsp-up"),
  lspLifecycleIntro: stepIdx(rsvpTeSteps, "lsp-lifecycle-intro"),
  sendDataPacket: stepIdx(rsvpTeSteps, "send-data-packet"),
  viewsIntro: stepIdx(rsvpTeSteps, "views-intro"),
  interactiveLabIntro: stepIdx(rsvpTeSteps, "interactive-lab-intro"),
  rroReveal: stepIdx(rsvpTeSteps, "rro-reveal"),
  breakIntro: stepIdx(rsvpTeSteps, "break-intro"),
  faultInjected: stepIdx(rsvpTeSteps, "fault-injected"),
  diagnosticLadder: stepIdx(rsvpTeSteps, "diagnostic-ladder"),
  repairChallenge: stepIdx(rsvpTeSteps, "repair-challenge"),
};

// ---------------------------------------------------------------------------
// Read-only CLI panel (brief §22/§23/§48)
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

export function buildRsvpTeCliCommands(state: RsvpTeState, router: RouterId): CliCommandEntry[] {
  const { lsp } = state;
  const onPath = lsp.path?.includes(router) ?? false;
  const fwd = buildRsvpForwardingState(lsp);
  const entry = fwd[router];

  const tedRowsCisco = state.teLinks
    .map((l) => `${l.a}-${l.b}: TE metric ${l.teMetric}, max reservable ${l.maxReservableMbps}Mbps, available ${computeAvailableBandwidth(l, state.backgroundReservations, forSnapshot(lsp))}Mbps, affinity ${l.affinity}`)
    .join("\n");
  const tedCisco: CliOutput = { cmd: "show mpls traffic-eng topology", output: tedRowsCisco };

  const cspfCisco: CliOutput = {
    cmd: "show mpls traffic-eng tunnels",
    output: lsp.state === "UP"
      ? `Name: ${lsp.id}\n  Signaling Summary:\n    Path Option: ${lsp.pathType === "explicit" ? "explicit" : "dynamic"}\n    Bandwidth Requested: ${lsp.requestedBandwidthMbps} Mbps, Reserved: ${lsp.reservedBandwidthMbps} Mbps\n    Explicit Path: ${lsp.path?.slice(1).join(" ") ?? "-"}\n  RSVP Signalling Info:\n    Tun ID: 1, LSP state: Up`
      : `Name: ${lsp.id}\n  Path Option: ${lsp.pathType}\n  Bandwidth Requested: ${lsp.requestedBandwidthMbps} Mbps\n  ${lsp.cspf?.path ? `Path Computed: ${lsp.cspf.path.join(" ")}` : "path option 1: not found (CSPF: no path meeting constraints)"}`,
  };

  const rsvpNeighCisco: CliOutput = {
    cmd: "show ip rsvp neighbor",
    output: onPath ? `Neighbor            RSVP    UDP     Nbr recovery` + `\n(TE-adjacent routers on the signaled path)` : "(no RSVP neighbors on the signaled path for this router)",
  };

  const mplsForwardingCisco: CliOutput = {
    cmd: "show mpls forwarding-table",
    output: entry
      ? `${entry.incomingLabel === "UNLABELED" ? "-" : fmtLabel(entry.incomingLabel as LabelValue)}   ${entry.outgoingLabel !== undefined ? fmtLabel(entry.outgoingLabel) : entry.action === "POP" ? "Pop Label" : entry.action === "IP_FORWARD" ? "Aggregate" : "-"}   ${lsp.egress}/32   ${entry.outgoingInterface ?? "-"} (Tunnel: ${lsp.id})`
      : "(no forwarding entry — LSP not UP, or this router isn't on the signaled path)",
  };

  const tedRowsJunos = state.teLinks
    .map((l) => `${l.a}-${l.b}\n  TEMetric: ${l.teMetric}, MaxReservableBW: ${l.maxReservableMbps}Mbps, AvailBW: ${computeAvailableBandwidth(l, state.backgroundReservations, forSnapshot(lsp))}Mbps\n  Color: ${l.affinity}`)
    .join("\n");
  const tedJuniper: CliOutput = { cmd: "show ted database extensive", output: tedRowsJunos };

  const lspJuniper: CliOutput = {
    cmd: "show mpls lsp extensive",
    output: lsp.state === "UP"
      ? `${lsp.id}\n  From: ${lsp.ingress}, To: ${lsp.egress}\n  State: Up\n  Bandwidth: ${lsp.reservedBandwidthMbps}Mbps\n  Explicit route: ${lsp.path?.slice(1).join(" ") ?? "-"}\n  Record route: ${lsp.path?.join(" ") ?? "-"}`
      : `${lsp.id}\n  From: ${lsp.ingress}, To: ${lsp.egress}\n  State: Down\n  ${lsp.cspf?.path ? `Computed path: ${lsp.cspf.path.join(" ")}` : "CSPF: no path found meeting constraints"}`,
  };

  const rsvpSessionJuniper: CliOutput = {
    cmd: "show rsvp session",
    output: onPath ? `${lsp.ingress} ${lsp.egress}   ${lsp.state === "UP" ? "Up" : "Down"}   ${lsp.requestedBandwidthMbps}Mbps` : "(this router is not on the currently signaled path)",
  };

  const routeMplsJuniper: CliOutput = {
    cmd: "show route table mpls.0",
    output: entry ? `${entry.incomingLabel === "UNLABELED" ? "(ingress, unlabeled in)" : fmtLabel(entry.incomingLabel as LabelValue)}\n    *[RSVP/7] via ${entry.outgoingInterface ?? "-"}\n      > ${entry.action === "POP" ? "Pop" : entry.action === "PUSH" ? `Push ${entry.outgoingLabel !== undefined ? fmtLabel(entry.outgoingLabel) : ""}` : entry.action === "SWAP" ? `Swap ${entry.outgoingLabel !== undefined ? fmtLabel(entry.outgoingLabel) : ""}` : entry.action}` : "mpls.0: 0 destinations",
  };

  return [
    { id: "ted", label: "TE database", cisco: tedCisco, juniper: tedJuniper },
    { id: "tunnel", label: "tunnel / lsp", cisco: cspfCisco, juniper: lspJuniper },
    { id: "rsvp", label: "rsvp neighbor / session", cisco: rsvpNeighCisco, juniper: rsvpSessionJuniper },
    { id: "forwarding", label: "mpls forwarding", cisco: mplsForwardingCisco, juniper: routeMplsJuniper },
  ];
}
