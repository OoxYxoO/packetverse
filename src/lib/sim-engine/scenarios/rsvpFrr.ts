import type { PacketLayer, PacketVisual, ScenarioStep } from "../types";
import { fmtLabel, type LabelValue } from "./rsvpTe";

export { fmtLabel };
export type { LabelValue };

/**
 * MPLS RSVP-TE Fast Reroute — local repair, PLR, Merge Point, link
 * protection, and node protection.
 *
 * Continues directly from the completed /demo/mpls-rsvp-te lesson.
 * The learner already understands the TE database, CSPF, ERO, PATH,
 * RESV, downstream-assigned labels, and bandwidth reservation — none
 * of that is re-taught here. The primary RSVP-TE LSP starts already
 * established (a recap fact, not something CSPF re-derives on screen).
 *
 * Central question: what happens when a link or transit router on an
 * active RSVP-TE LSP fails, and waiting for end-to-end convergence is
 * too slow?
 *
 *              R1 ── R3 ── R5 ── R7 ── R6      (primary LSP)
 *                     \      \    /
 *                      R4 ────┴──┘             (shared bypass transit)
 *
 * Required links: R1-R3, R3-R5, R5-R7, R7-R6 (primary), R3-R4, R4-R5,
 * R4-R7 (bypass segments). R2/global-alternate path deliberately
 * omitted — the brief explicitly allows this ("do not make the main
 * protection visualization unnecessarily cluttered") and this lesson's
 * pedagogy needs exactly one shared bypass-transit router (R4) serving
 * both a link-protecting and a node-protecting bypass, not a second
 * alternate topology to reason about.
 *
 * Explicitly deferred: Segment Routing, TI-LFA, LFA, SR-MPLS, RSVP
 * secondary/standby paths, BFD internals (mentioned once as a note,
 * never simulated), shared-backup-bandwidth optimization.
 *
 * Pure data + pure functions only — see /lib/sim-engine/types.ts.
 */

export type RouterId = "R1" | "R3" | "R4" | "R5" | "R6" | "R7";
export const HEADEND: RouterId = "R1";
export const TAILEND: RouterId = "R6";
export const ALL_ROUTERS: RouterId[] = ["R1", "R3", "R4", "R5", "R6", "R7"];

export type LinkId = "R1-R3" | "R3-R5" | "R5-R7" | "R7-R6" | "R3-R4" | "R4-R5" | "R4-R7";

export interface LinkDef {
  id: LinkId;
  a: RouterId;
  b: RouterId;
  igpMetric: number;
  teMetric: number;
  maxReservableMbps: number;
}

export const LINKS: LinkDef[] = [
  { id: "R1-R3", a: "R1", b: "R3", igpMetric: 10, teMetric: 10, maxReservableMbps: 1000 },
  { id: "R3-R5", a: "R3", b: "R5", igpMetric: 10, teMetric: 10, maxReservableMbps: 1000 },
  { id: "R5-R7", a: "R5", b: "R7", igpMetric: 10, teMetric: 10, maxReservableMbps: 1000 },
  { id: "R7-R6", a: "R7", b: "R6", igpMetric: 10, teMetric: 10, maxReservableMbps: 1000 },
  { id: "R3-R4", a: "R3", b: "R4", igpMetric: 15, teMetric: 15, maxReservableMbps: 1000 },
  { id: "R4-R5", a: "R4", b: "R5", igpMetric: 15, teMetric: 15, maxReservableMbps: 1000 },
  { id: "R4-R7", a: "R4", b: "R7", igpMetric: 20, teMetric: 20, maxReservableMbps: 1000 },
];

export const PRIMARY_PATH: RouterId[] = ["R1", "R3", "R5", "R7", "R6"];
export const LINK_BYPASS_PATH: RouterId[] = ["R3", "R4", "R5"];
export const NODE_BYPASS_PATH: RouterId[] = ["R3", "R4", "R7"];
export const PROTECTED_LINK: LinkId = "R3-R5";
export const PROTECTED_NODE: RouterId = "R5";

export const TERMS: { term: string; expansion: string; meaning: string }[] = [
  { term: "PLR", expansion: "Point of Local Repair", meaning: "The router that locally detects the protected resource is gone and activates prepared protection — not necessarily the headend." },
  { term: "MP", expansion: "Merge Point", meaning: "Where bypass traffic rejoins the protected LSP's own forwarding state — not necessarily the tailend." },
  { term: "Bypass", expansion: "Bypass Tunnel", meaning: "A backup LSP, pre-signaled before any failure, that detours traffic around one protected resource." },
  { term: "Facility Backup", expansion: "Facility Backup", meaning: "One bypass tunnel that can protect many LSPs traversing the same protected resource." },
];

// ---------------------------------------------------------------------------
// Generic path-finding (brief §56: computeReoptimizedLsp, etc.) — same
// brute-force technique as the RSVP-TE lesson (the topology is tiny;
// simplicity is easier to verify correct than a Dijkstra here too).
// ---------------------------------------------------------------------------

function neighborsOf(edges: LinkDef[]): Partial<Record<RouterId, { to: RouterId; link: LinkDef }[]>> {
  const adj: Partial<Record<RouterId, { to: RouterId; link: LinkDef }[]>> = {};
  for (const link of edges) {
    (adj[link.a] ??= []).push({ to: link.b, link });
    (adj[link.b] ??= []).push({ to: link.a, link });
  }
  return adj;
}

function allSimplePaths(edges: LinkDef[], from: RouterId, to: RouterId, avoidNode?: RouterId): RouterId[][] {
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
      if (visited.has(next) || next === avoidNode) continue;
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

function linkBetween(edges: LinkDef[], x: RouterId, y: RouterId): LinkDef | undefined {
  return edges.find((l) => (l.a === x && l.b === y) || (l.b === x && l.a === y));
}

function pathWeight(path: RouterId[], edges: LinkDef[]): number {
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const link = linkBetween(edges, path[i], path[i + 1]);
    total += link ? link.teMetric : Number.POSITIVE_INFINITY;
  }
  return total;
}

export function linkIdsOnPath(path: RouterId[], edges: LinkDef[] = LINKS): LinkId[] {
  const ids: LinkId[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const link = linkBetween(edges, path[i], path[i + 1]);
    if (link) ids.push(link.id);
  }
  return ids;
}

function shortestPath(edges: LinkDef[], from: RouterId, to: RouterId, avoidNode?: RouterId): { path: RouterId[]; cost: number } | undefined {
  const candidates = allSimplePaths(edges, from, to, avoidNode).map((path) => ({ path, cost: pathWeight(path, edges) }));
  candidates.sort((a, b) => a.cost - b.cost);
  return candidates[0];
}

// ---------------------------------------------------------------------------
// Label / stack model — reuses RSVP-TE's LabelValue/fmtLabel (no
// RouterId dependency, so genuinely shareable) but keeps its own small
// push/swap/pop helpers, matching the established per-lesson-file
// convention (mplsLdp.ts, mplsL3vpn.ts, rsvpTe.ts each define their own).
// ---------------------------------------------------------------------------

export interface MplsLabel {
  value: number;
  bottomOfStack: boolean;
  purpose: "transport" | "bypass";
}
export interface MplsPacketState {
  srcIp: string;
  dstIp: string;
  labels: MplsLabel[];
}
function pushLabel(pkt: MplsPacketState, value: number, purpose: "transport" | "bypass"): MplsPacketState {
  const wasEmpty = pkt.labels.length === 0;
  const newTop: MplsLabel = { value, bottomOfStack: wasEmpty, purpose };
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

/** Downstream-assigned label allocation, generic over any path array (brief §19/§20). Position-from-egress: egress = implicit-null (PHP), position 1 = a real value, position 2 = a different real value, ... */
export function allocateLabel(path: RouterId[], router: RouterId, base = 100): LabelValue {
  const idx = path.indexOf(router);
  if (idx === -1) return "IMPLICIT_NULL";
  const positionFromEgress = path.length - 1 - idx;
  if (positionFromEgress === 0) return "IMPLICIT_NULL";
  return base + positionFromEgress * 100;
}

export function buildHopLabels(path: RouterId[], base = 100): Partial<Record<RouterId, LabelValue>> {
  return Object.fromEntries(path.map((r) => [r, allocateLabel(path, r, base)])) as Partial<Record<RouterId, LabelValue>>;
}

// ---------------------------------------------------------------------------
// Primary LSP + Bypass model
// ---------------------------------------------------------------------------

export interface PrimaryLsp {
  id: string;
  path: RouterId[];
  requestedBandwidthMbps: number;
  hopLabels: Partial<Record<RouterId, LabelValue>>;
}

export function createPrimaryLsp(): PrimaryLsp {
  return { id: "RSVP-PRIMARY", path: PRIMARY_PATH, requestedBandwidthMbps: 500, hopLabels: buildHopLabels(PRIMARY_PATH, 100) };
}

export type ProtectionType = "LINK" | "NODE";
export type FrrLifecycle = "UNPROTECTED" | "PROTECTION_SIGNALING" | "READY" | "FAILURE_DETECTED" | "LOCAL_REPAIR_ACTIVE" | "REOPTIMIZING" | "RECOVERED";
export const FRR_LIFECYCLE_ORDER: FrrLifecycle[] = ["UNPROTECTED", "PROTECTION_SIGNALING", "READY", "FAILURE_DETECTED", "LOCAL_REPAIR_ACTIVE", "REOPTIMIZING", "RECOVERED"];
export const FRR_LIFECYCLE_INFO: Record<FrrLifecycle, { meaning: string; why: string; next: string }> = {
  UNPROTECTED: { meaning: "No bypass has been requested for this resource yet.", why: "Protection has to be explicitly requested and signaled — it isn't automatic.", next: "Requesting protection begins bypass CSPF/path validation." },
  PROTECTION_SIGNALING: { meaning: "The bypass path has been validated and is being signaled.", why: "A bypass is a real (small) RSVP-TE LSP of its own — it needs its own path validation and label allocation before it can protect anything.", next: "Once labels are installed end to end, the bypass becomes READY." },
  READY: { meaning: "The bypass is fully signaled and pre-installed, but is not carrying any protected production traffic yet.", why: "Protection READY means the safety net exists — it says nothing about whether it's currently being used.", next: "It stays this way until (and unless) the protected resource actually fails." },
  FAILURE_DETECTED: { meaning: "The PLR has locally detected that the protected resource is gone.", why: "Detection has to happen before repair — and it happens locally, at the PLR, not at the headend.", next: "The PLR immediately activates the already-ready bypass." },
  LOCAL_REPAIR_ACTIVE: { meaning: "Protected traffic is now actively forwarding over the bypass.", why: "The bypass was pre-signaled specifically so this step requires no new signaling round-trip.", next: "Traffic stays here until the headend reoptimizes (or the resource recovers)." },
  REOPTIMIZING: { meaning: "The headend has now learned about the topology change and is computing a new end-to-end path.", why: "FRR is local and temporary — the headend still needs to re-converge for a proper steady state.", next: "Once the new end-to-end LSP is signaled, it becomes the new primary path." },
  RECOVERED: { meaning: "A new end-to-end LSP is in place; the temporary local bypass is no longer the reason traffic reaches R6.", why: "Local repair did its job (no interruption) and has now handed off to a proper, globally-optimal path.", next: "This is the new steady state, until the next failure." },
};

export interface Bypass {
  id: string;
  protectionType: ProtectionType;
  protectedResource: string;
  plr: RouterId;
  mergePoint: RouterId;
  path: RouterId[];
  reservedMbps: number;
  hopLabels: Partial<Record<RouterId, LabelValue>>;
  lifecycle: FrrLifecycle;
  /** The bypass's OWN health — independent of the primary/protected resource (brief §39/§40). */
  healthy: boolean;
}

/** Merge Point (brief §8/§28/§30) — link protection: the far end of the protected link on the primary path. Node protection: the primary hop immediately AFTER the protected node. */
export function determineMergePoint(primaryPath: RouterId[], protectionType: ProtectionType, protectedResource: string): RouterId | undefined {
  if (protectionType === "LINK") {
    const [a, b] = protectedResource.split("-") as RouterId[];
    const idxA = primaryPath.indexOf(a);
    if (idxA === -1 || primaryPath[idxA + 1] !== b) return undefined;
    return b;
  }
  const idx = primaryPath.indexOf(protectedResource as RouterId);
  if (idx === -1 || idx + 1 >= primaryPath.length) return undefined;
  return primaryPath[idx + 1];
}

export function computeLinkProtectingBypass(primaryLsp: PrimaryLsp, protectedLink: LinkId, links: LinkDef[] = LINKS): Bypass | undefined {
  const link = links.find((l) => l.id === protectedLink);
  if (!link) return undefined;
  const plr = link.a;
  const mp = determineMergePoint(primaryLsp.path, "LINK", protectedLink);
  if (!mp) return undefined;
  const candidateLinks = links.filter((l) => l.id !== protectedLink);
  const best = shortestPath(candidateLinks, plr, mp);
  if (!best) return undefined;
  return {
    id: `bypass-link-${protectedLink}`,
    protectionType: "LINK",
    protectedResource: protectedLink,
    plr,
    mergePoint: mp,
    path: best.path,
    reservedMbps: primaryLsp.requestedBandwidthMbps,
    hopLabels: buildHopLabels(best.path, 900),
    lifecycle: "UNPROTECTED",
    healthy: true,
  };
}

export function computeNodeProtectingBypass(primaryLsp: PrimaryLsp, protectedNode: RouterId, links: LinkDef[] = LINKS): Bypass | undefined {
  const idx = primaryLsp.path.indexOf(protectedNode);
  if (idx <= 0) return undefined;
  const plr = primaryLsp.path[idx - 1];
  const mp = determineMergePoint(primaryLsp.path, "NODE", protectedNode);
  if (!mp) return undefined;
  const best = shortestPath(links, plr, mp, protectedNode);
  if (!best) return undefined;
  return {
    id: `bypass-node-${protectedNode}`,
    protectionType: "NODE",
    protectedResource: protectedNode,
    plr,
    mergePoint: mp,
    path: best.path,
    reservedMbps: primaryLsp.requestedBandwidthMbps,
    hopLabels: buildHopLabels(best.path, 920),
    lifecycle: "UNPROTECTED",
    healthy: true,
  };
}

/** A bypass must avoid the exact resource it protects (brief §57 invariant). Pure sanity check, not trusted blindly by the two compute*Bypass functions above (which already guarantee it structurally), but exposed so the domain layer can assert it explicitly. */
export function validateProtectionPath(bypass: Bypass): boolean {
  if (bypass.protectionType === "LINK") {
    const ids = linkIdsOnPath(bypass.path);
    return !ids.includes(bypass.protectedResource as LinkId);
  }
  return !bypass.path.includes(bypass.protectedResource as RouterId);
}

/** READY requires: a structurally valid path, sufficient reservable bandwidth on every bypass-only link, and the bypass's own links currently healthy (brief §11/§40). */
export function determineProtectionReadiness(bypass: Bypass | undefined, links: LinkDef[], failedLinkIds: LinkId[], failedNode: RouterId | undefined): "READY" | "UNAVAILABLE" | "NOT_CONFIGURED" {
  if (!bypass) return "NOT_CONFIGURED";
  if (!validateProtectionPath(bypass)) return "UNAVAILABLE";
  const ids = linkIdsOnPath(bypass.path, links);
  const anyDown = ids.some((id) => failedLinkIds.includes(id));
  const nodeDown = failedNode && bypass.path.includes(failedNode);
  if (anyDown || nodeDown) return "UNAVAILABLE";
  const enoughBandwidth = ids.every((id) => (links.find((l) => l.id === id)?.maxReservableMbps ?? 0) >= bypass.reservedMbps);
  return enoughBandwidth ? "READY" : "UNAVAILABLE";
}

// ---------------------------------------------------------------------------
// Forwarding state (brief §19/§20/§56) — built FROM signaling, exactly
// like the RSVP-TE lesson's buildRsvpForwardingState. Data plane never
// re-runs CSPF or re-signals; it only uses installed state.
// ---------------------------------------------------------------------------

export type FwdAction = "PUSH" | "SWAP" | "POP" | "IP_FORWARD" | "SWAP_AND_PUSH_BYPASS" | "POP_BYPASS";
export interface FwdEntry {
  incomingLabel: LabelValue | "UNLABELED";
  action: FwdAction;
  outgoingLabels?: LabelValue[]; // outer-to-inner, when more than one
  outgoingInterface?: RouterId;
}

/** Normal (unprotected) primary forwarding state — identical shape/logic to the RSVP-TE lesson. */
export function buildPrimaryForwardingState(primaryLsp: PrimaryLsp): Partial<Record<RouterId, FwdEntry>> {
  const path = primaryLsp.path;
  const out: Partial<Record<RouterId, FwdEntry>> = {};
  path.forEach((r, i) => {
    if (i === 0) {
      out[r] = { incomingLabel: "UNLABELED", action: "PUSH", outgoingLabels: [primaryLsp.hopLabels[path[1]]!], outgoingInterface: path[1] };
      return;
    }
    if (i === path.length - 1) {
      out[r] = { incomingLabel: "UNLABELED", action: "IP_FORWARD" };
      return;
    }
    const myLabel = primaryLsp.hopLabels[r] ?? "UNLABELED";
    const nextR = path[i + 1];
    const nextLabel = primaryLsp.hopLabels[nextR];
    if (nextLabel === "IMPLICIT_NULL") out[r] = { incomingLabel: myLabel, action: "POP", outgoingInterface: nextR };
    else out[r] = { incomingLabel: myLabel, action: "SWAP", outgoingLabels: [nextLabel!], outgoingInterface: nextR };
  });
  return out;
}

/**
 * Facility-backup FRR forwarding state (brief §19/§20/§22/§23) — this
 * is the heart of the lesson. At the PLR, the packet's normal
 * SWAP target (whatever the Merge Point itself expects incoming for
 * the protected LSP — `primaryLsp.hopLabels[mp]`) becomes the INNER
 * label; the bypass's own downstream-assigned label for its first
 * transit hop becomes the OUTER label. Bypass-transit routers act
 * only on the outer label (PHP'd at the Merge Point's upstream bypass
 * neighbor, exactly like any RSVP-TE tailend). The Merge Point receives
 * exactly the label it always expected and resumes NORMAL protected-LSP
 * forwarding — it never re-runs CSPF.
 */
export function buildFrrForwardingState(primaryLsp: PrimaryLsp, bypass: Bypass): Partial<Record<RouterId, FwdEntry>> {
  const out: Partial<Record<RouterId, FwdEntry>> = {};
  const innerLabel = primaryLsp.hopLabels[bypass.mergePoint];
  if (innerLabel === undefined) return out;

  // PLR: normal incoming label unchanged; swap to the inner (MP-expected) label, then push the bypass's own outer label.
  const plrIncoming = primaryLsp.hopLabels[bypass.plr] ?? "UNLABELED";
  const bypassNextHop = bypass.path[1];
  const outerLabel = bypass.hopLabels[bypassNextHop];
  out[bypass.plr] = { incomingLabel: plrIncoming, action: "SWAP_AND_PUSH_BYPASS", outgoingLabels: outerLabel !== undefined ? [outerLabel, innerLabel] : [innerLabel], outgoingInterface: bypassNextHop };

  // Bypass transit routers (everything strictly between PLR and MP): act only on the outer bypass label.
  for (let i = 1; i < bypass.path.length - 1; i++) {
    const r = bypass.path[i];
    const myBypassLabel = bypass.hopLabels[r] ?? "UNLABELED";
    const nextR = bypass.path[i + 1];
    const nextBypassLabel = bypass.hopLabels[nextR];
    if (nextBypassLabel === "IMPLICIT_NULL") out[r] = { incomingLabel: myBypassLabel, action: "POP_BYPASS", outgoingLabels: [innerLabel], outgoingInterface: nextR };
    else out[r] = { incomingLabel: myBypassLabel, action: "SWAP", outgoingLabels: [nextBypassLabel!, innerLabel], outgoingInterface: nextR };
  }

  // Merge Point: receives exactly its normal incoming label and resumes ordinary protected-LSP forwarding.
  const mpIdx = primaryLsp.path.indexOf(bypass.mergePoint);
  const afterMp = primaryLsp.path[mpIdx + 1];
  const afterMpLabel = primaryLsp.hopLabels[afterMp];
  if (afterMpLabel === "IMPLICIT_NULL") out[bypass.mergePoint] = { incomingLabel: innerLabel, action: "POP", outgoingInterface: afterMp };
  else out[bypass.mergePoint] = { incomingLabel: innerLabel, action: "SWAP", outgoingLabels: [afterMpLabel!], outgoingInterface: afterMp };

  return out;
}

// ---------------------------------------------------------------------------
// Failure / active path / reoptimization
// ---------------------------------------------------------------------------

export interface FailureState {
  kind: "LINK" | "NODE";
  resource: string;
}

export function applyResourceFailure(kind: "LINK" | "NODE", resource: string): FailureState {
  return { kind, resource };
}

/** The path actually carrying traffic right now, given failure + protection state (brief §56). Never recomputed per packet — only when this function is explicitly called by a step's run(). */
export function computeActiveForwardingPath(primaryLsp: PrimaryLsp, failure: FailureState | undefined, activeBypass: Bypass | undefined): RouterId[] {
  if (!failure || !activeBypass) return primaryLsp.path;
  const mpIdx = primaryLsp.path.indexOf(activeBypass.mergePoint);
  return [...activeBypass.path, ...primaryLsp.path.slice(mpIdx + 1)];
}

/** Headend reoptimization (brief §38) — a genuine, separate end-to-end computation avoiding the failed resource, run only once (never per packet), well after local repair already restored traffic. */
export function computeReoptimizedLsp(failure: FailureState, links: LinkDef[] = LINKS): { path: RouterId[]; teMetricTotal: number } | undefined {
  const usable = failure.kind === "LINK" ? links.filter((l) => l.id !== failure.resource) : links;
  const avoidNode = failure.kind === "NODE" ? (failure.resource as RouterId) : undefined;
  const best = shortestPath(usable, HEADEND, TAILEND, avoidNode);
  return best ? { path: best.path, teMetricTotal: best.cost } : undefined;
}

/** Once the protected resource recovers, local repair stands down: the bypass returns to READY (still pre-signaled, no longer carrying traffic) and forwarding resumes over the ordinary primary LSP. */
export function deactivateLocalRepair(state: Pick<RsvpFrrState, "linkBypass" | "nodeBypass" | "activeBypassId">): Pick<RsvpFrrState, "linkBypass" | "nodeBypass" | "activeBypassId"> {
  return {
    linkBypass: state.linkBypass && state.activeBypassId === state.linkBypass.id ? { ...state.linkBypass, lifecycle: "READY" } : state.linkBypass,
    nodeBypass: state.nodeBypass && state.activeBypassId === state.nodeBypass.id ? { ...state.nodeBypass, lifecycle: "READY" } : state.nodeBypass,
    activeBypassId: undefined,
  };
}

// ---------------------------------------------------------------------------
// Top-level scenario state
// ---------------------------------------------------------------------------

export interface JourneyHop {
  router: RouterId;
  input: string;
  lookup: string;
  action: FwdAction | "IGP_FORWARD";
  output: string;
}

export interface TroubleshootingState {
  started: boolean;
  repairAttempt?: { choice: string; correct: boolean };
  nodeBypassEstablished: boolean;
}

export interface RsvpFrrState {
  links: LinkDef[];
  failedLinkIds: LinkId[];
  failedNode?: RouterId;
  primaryLsp: PrimaryLsp;
  linkBypass?: Bypass;
  nodeBypass?: Bypass;
  activeBypassId?: string;
  failure?: FailureState;
  reoptimized?: { path: RouterId[]; teMetricTotal: number };
  packet?: MplsPacketState;
  packetAt?: RouterId;
  journey: JourneyHop[];
  troubleshooting: TroubleshootingState;
}

export function createRsvpFrrState(): RsvpFrrState {
  return {
    links: LINKS,
    failedLinkIds: [],
    primaryLsp: createPrimaryLsp(),
    journey: [],
    troubleshooting: { started: false, nodeBypassEstablished: false },
  };
}

// ---------------------------------------------------------------------------
// Graph layout
// ---------------------------------------------------------------------------

export const GRAPH_NODES = [
  { id: "R1", label: "R1", x: 5, y: 50, subLabel: "Headend" },
  { id: "R3", label: "R3", x: 30, y: 50 },
  { id: "R4", label: "R4", x: 52, y: 82 },
  { id: "R5", label: "R5", x: 58, y: 50 },
  { id: "R7", label: "R7", x: 80, y: 50 },
  { id: "R6", label: "R6", x: 96, y: 50, subLabel: "Tailend" },
];
export const GRAPH_EDGES: { id: LinkId; a: RouterId; b: RouterId }[] = LINKS.map((l) => ({ id: l.id, a: l.a, b: l.b }));

// ---------------------------------------------------------------------------
// Packet builders
// ---------------------------------------------------------------------------

function ipLayer(src: string, dst: string): PacketLayer {
  return { name: "IPv4", color: "var(--pv-proto-ip)", fields: [{ label: "Source IP", value: src }, { label: "Destination IP", value: dst }] };
}
function shimLayer(label: MplsLabel): PacketLayer {
  return {
    name: `MPLS Shim (${label.purpose})`,
    color: "var(--pv-proto-mpls)",
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

const stepIdx = (steps: ScenarioStep<RsvpFrrState>[], id: string) => steps.findIndex((s) => s.id === id);

export const rsvpFrrSteps: ScenarioStep<RsvpFrrState>[] = [
  {
    id: "intro",
    label: "The Central Question",
    narrative:
      "You already understand RSVP-TE: the TE database, CSPF, ERO, PATH, RESV, downstream-assigned labels, and bandwidth reservation. This lesson asks a different question: what happens when a link or transit router on an active RSVP-TE LSP fails, and waiting for end-to-end convergence is too slow?",
  },
  {
    id: "recap",
    label: "Recap: What You Already Know",
    narrative:
      "Quick recap, not a re-teach: RSVP-TE signals a constrained path (PATH downstream, RESV upstream), installs downstream-assigned labels hop by hop, and reserves real bandwidth. A router forwards using that installed label state — it never re-runs CSPF per packet. Everything below builds directly on that.",
  },
  {
    id: "primary-lsp-up",
    label: "Primary LSP: Already UP",
    narrative: "RSVP-PRIMARY is already established: 500 Mbps, state UP, path R1 → R3 → R5 → R7 → R6. This lesson starts here — the CSPF/PATH/RESV walkthrough was the previous lesson.",
    run: (state) => ({ state, events: [{ type: "MPLS_LSP_CHANGED", stepId: "primary-lsp-up", timestamp: Date.now(), message: "RSVP-PRIMARY UP: R1 → R3 → R5 → R7 → R6, 500 Mbps" }] }),
  },
  {
    id: "predict-r3r5-fail",
    label: "Predict",
    narrative: "Traffic is flowing over RSVP-PRIMARY right now.",
    question: {
      prompt: "What happens if the R3-R5 link fails while traffic is flowing?",
      options: [
        { id: "nothing", label: "Nothing — MPLS reroutes automatically with zero configuration" },
        { id: "depends", label: "It depends entirely on whether local protection was pre-established" },
        { id: "headend-instant", label: "R1 instantly recomputes a new path with no interruption" },
        { id: "always-frr", label: "RSVP-TE always includes Fast Reroute by default" },
      ],
      correctOptionId: "depends",
      explanation: "Nothing about RSVP-TE automatically protects a failure. Without pre-established local protection, traffic is interrupted until the headend reconverges end to end. This lesson is about what changes when protection IS pre-established.",
    },
  },
  {
    id: "send-normal-1",
    label: "Send Traffic (Normal)",
    narrative: `A host behind R1 (${HOST_BEHIND_R1}) sends traffic toward a host behind R6 (${HOST_BEHIND_R6}) over RSVP-PRIMARY.`,
    packet: () => ({ id: "ip-normal", protocol: "IP", from: "R1", to: "R1", summary: "Packet classified into RSVP-PRIMARY", layers: [ipLayer(HOST_BEHIND_R1, HOST_BEHIND_R6)] }),
    run: (state) => ({ state: { ...state, packet: { srcIp: HOST_BEHIND_R1, dstIp: HOST_BEHIND_R6, labels: [] }, packetAt: "R1", journey: [] }, events: [{ type: "PACKET_SENT", stepId: "send-normal-1", timestamp: Date.now(), message: "Packet classified into RSVP-PRIMARY" }] }),
  },
  {
    id: "r1-push-normal",
    label: "R1: PUSH",
    narrative: "R1 pushes the transport label — ordinary RSVP-TE forwarding, exactly as covered in the previous lesson.",
    packet: (state) => (state.packet ? mplsPacket("push1", "R1", "R3", "PUSH", "PUSH", state.packet) : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const fwd = buildPrimaryForwardingState(state.primaryLsp);
      const label = fwd.R1?.outgoingLabels?.[0];
      const packet = pushLabel(state.packet, typeof label === "number" ? label : 100, "transport");
      const journey = [...state.journey, { router: "R1" as RouterId, input: "IP packet (unlabeled)", lookup: "RSVP-TE forwarding state: RSVP-PRIMARY", action: "PUSH" as FwdAction, output: `label ${fmtLabel(label ?? 100)} + IP` }];
      return { state: { ...state, packet, packetAt: "R3", journey }, events: [{ type: "MPLS_LABEL_PUSHED", stepId: "r1-push-normal", timestamp: Date.now(), message: "R1 pushes the transport label" }] };
    },
  },
  {
    id: "r3-swap-normal",
    label: "R3: SWAP (Normal)",
    narrative: "R3 swaps the label toward R5 — an ordinary transit hop, nothing FRR-related yet.",
    packet: (state) => (state.packet ? mplsPacket("swap1", "R3", "R5", "SWAP", "SWAP", state.packet) : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const fwd = buildPrimaryForwardingState(state.primaryLsp);
      const label = fwd.R3?.outgoingLabels?.[0];
      const packet = swapTopLabel(state.packet, typeof label === "number" ? label : 200);
      const journey = [...state.journey, { router: "R3" as RouterId, input: "label", lookup: "Primary LFIB: SWAP toward R5", action: "SWAP" as FwdAction, output: `label ${fmtLabel(label ?? 200)}` }];
      return { state: { ...state, packet, packetAt: "R5", journey }, events: [{ type: "MPLS_LABEL_SWAPPED", stepId: "r3-swap-normal", timestamp: Date.now(), message: "R3 swaps toward R5" }] };
    },
  },
  {
    id: "r5-swap-normal",
    label: "R5: SWAP (Normal)",
    narrative: "R5 swaps the label toward R7.",
    packet: (state) => (state.packet ? mplsPacket("swap2", "R5", "R7", "SWAP", "SWAP", state.packet) : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const fwd = buildPrimaryForwardingState(state.primaryLsp);
      const label = fwd.R5?.outgoingLabels?.[0];
      const packet = swapTopLabel(state.packet, typeof label === "number" ? label : 300);
      const journey = [...state.journey, { router: "R5" as RouterId, input: "label", lookup: "Primary LFIB: SWAP toward R7", action: "SWAP" as FwdAction, output: `label ${fmtLabel(label ?? 300)}` }];
      return { state: { ...state, packet, packetAt: "R7", journey }, events: [{ type: "MPLS_LABEL_SWAPPED", stepId: "r5-swap-normal", timestamp: Date.now(), message: "R5 swaps toward R7" }] };
    },
  },
  {
    id: "r7-pop-normal",
    label: "R7: POP (PHP)",
    narrative: "R7 is the penultimate hop — R6 signaled implicit-null, so R7 pops before forwarding to R6.",
    packet: (state) => (state.packet ? mplsPacket("pop1", "R7", "R6", "POP", "POP", state.packet) : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const packet = popTopLabel(state.packet);
      const journey = [...state.journey, { router: "R7" as RouterId, input: "label", lookup: "Primary LFIB: POP (implicit-null from R6)", action: "POP" as FwdAction, output: "IP (unlabeled)" }];
      return { state: { ...state, packet, packetAt: "R6", journey }, events: [{ type: "MPLS_LABEL_POPPED", stepId: "r7-pop-normal", timestamp: Date.now(), message: "R7 pops (PHP)" }] };
    },
  },
  {
    id: "r6-deliver-normal",
    label: "R6 Delivers",
    narrative: "R6 receives a plain IP packet and delivers it — ordinary, healthy RSVP-TE forwarding, exactly as before.",
    packet: (state) => (state.packet ? { id: "ip-delivered1", protocol: "IP", from: "R6", to: "R6", summary: "Delivered via RSVP-PRIMARY", layers: buildPacketLayers(state.packet) } : undefined),
    run: (state) => ({ state: { ...state, journey: [...state.journey, { router: "R6" as RouterId, input: "IP", lookup: "IP delivery", action: "IP_FORWARD" as FwdAction, output: "Delivered" }] }, events: [{ type: "MPLS_PACKET_FORWARDED", stepId: "r6-deliver-normal", timestamp: Date.now(), message: "R6 delivers — everything healthy" }] }),
    whatChanged: () => ["Delivered R1 → R3 → R5 → R7 → R6 — ordinary RSVP-TE forwarding, no protection involved yet"],
  },
  {
    id: "no-frr-intro",
    label: "Before FRR: Deliberately No Protection",
    narrative: "No bypass exists yet anywhere in this topology. Watch what happens to that same traffic if R3-R5 fails right now, with nothing pre-established.",
  },
  {
    id: "fail-no-frr",
    label: "R3-R5 LINK DOWN (No Protection)",
    narrative: "The R3-R5 link fails.",
    run: (state) => ({ state: { ...state, failedLinkIds: ["R3-R5"], failure: applyResourceFailure("LINK", "R3-R5") }, events: [{ type: "MPLS_LSP_CHANGED", stepId: "fail-no-frr", timestamp: Date.now(), message: "R3-R5 link down — no protection exists" }] }),
    whatChanged: () => ["R3-R5: UP → DOWN"],
  },
  {
    id: "r3-no-backup",
    label: "R3: No Local Backup",
    narrative: "R3's next protected hop (R5) is unavailable, and R3 has no prepared backup for it. Traffic already in flight toward R5 is simply interrupted — R3 has nothing to substitute.",
    whatChanged: () => ["R3: protected next-hop unavailable → no local backup → traffic interrupted"],
  },
  {
    id: "normal-recovery-concept",
    label: "Ordinary End-to-End Recovery",
    narrative:
      "Conceptually, without local protection: the failure changes routing/TE information → the headend (R1) eventually becomes aware → R1 re-runs CSPF for an end-to-end path → RSVP re-signals PATH/RESV → a new LSP becomes available. This is real recovery, but it is not instantaneous — PacketVerse does not claim a universal recovery time for this. This whole chain is exactly what Fast Reroute exists to avoid waiting for.",
  },
  {
    id: "restore-for-frr",
    label: "Reset: Time To Do This Right",
    narrative: "R3-R5 is restored. For the rest of this lesson, protection will be pre-established BEFORE any failure — that's the whole point of Fast Reroute.",
    run: (state) => ({ state: { ...state, failedLinkIds: [], failure: undefined }, events: [] }),
  },
  {
    id: "frr-intro",
    label: "Introducing Fast Reroute",
    narrative: "RSVP-TE Fast Reroute (FRR) prepares local protection BEFORE a failure happens. End-to-end repair means the headend reacts. Fast Reroute means a nearby router reacts locally — FRR is local repair, not simply a faster version of the same global CSPF recomputation.",
  },
  {
    id: "terminology-intro",
    label: "Four Core Terms",
    narrative: "Protected Resource — the specific link or router being protected. PLR (Point of Local Repair) — the router that detects the failure and activates protection. Merge Point (MP) — where bypass traffic rejoins the protected LSP. Bypass Tunnel — the pre-signaled backup path itself.",
  },
  {
    id: "predict-plr",
    label: "Predict",
    narrative: "For protecting the R3-R5 link specifically:",
    question: {
      prompt: "Who should activate the immediate local repair for a failure on R3-R5?",
      options: [
        { id: "r3-plr", label: "R3 — the PLR" },
        { id: "r1-headend", label: "R1 — the headend" },
        { id: "r6-tailend", label: "R6 — the tailend" },
        { id: "every-router", label: "Every router simultaneously" },
      ],
      correctOptionId: "r3-plr",
      explanation: "R3 is directly attached to the failed resource and detects it first. The whole point of local repair is that R3 acts immediately — it doesn't wait for R1, and R1 is not required to react first.",
    },
  },
  {
    id: "plr-explain",
    label: "PLR ≠ Headend",
    narrative: "R1 is the headend of RSVP-PRIMARY. R3 is the PLR for the R3-R5 protected link. These are different roles, held by different routers — the PLR is whichever router is adjacent to the protected resource, which is very often NOT the headend.",
  },
  {
    id: "mp-explain",
    label: "Merge Point: R5",
    narrative: "For link protection of R3-R5, the Merge Point is R5 — the far end of the protected link on the primary path. This is also not necessarily the tailend (R6).",
  },
  {
    id: "facility-backup-intro",
    label: "Facility Backup",
    narrative: "This lesson uses facility backup / bypass tunnel as the hands-on model: one bypass tunnel protects a resource, ready to carry any LSP that crosses it. The bypass exists before any failure — signaled, labeled, reserved, and UP — but it must not carry protected production traffic until it's actually activated.",
  },
  {
    id: "distinguish-lsps",
    label: "Two Different LSPs",
    narrative: "Keep these distinct: the PRIMARY RSVP LSP is R1 → R3 → R5 → R7 → R6 — the actual customer path. The FRR BYPASS LSP will be R3 → R4 → R5 — local protection around one resource, never a replacement end-to-end customer LSP.",
  },
  {
    id: "protection-lifecycle-intro",
    label: "PacketVerse FRR Recovery Lifecycle",
    narrative: "This is a PacketVerse teaching abstraction, not an official RSVP protocol FSM: UNPROTECTED → PROTECTION_SIGNALING → READY → FAILURE_DETECTED → LOCAL_REPAIR_ACTIVE → REOPTIMIZING → RECOVERED.",
  },
  {
    id: "establish-link-bypass",
    label: "Establish The Link-Protection Bypass",
    narrative: "R3 requests protection for the R3-R5 link. The bypass path is validated (it must avoid R3-R5 itself) and computed: R3 → R4 → R5.",
    run: (state) => {
      const bypass = computeLinkProtectingBypass(state.primaryLsp, "R3-R5", state.links);
      if (!bypass) return { state, events: [] };
      return { state: { ...state, linkBypass: { ...bypass, lifecycle: "PROTECTION_SIGNALING" } }, events: [{ type: "MPLS_LSP_CHANGED", stepId: "establish-link-bypass", timestamp: Date.now(), message: `Bypass path computed: ${bypass.path.join(" → ")}` }] };
    },
    whatChanged: (_, next) => [`Bypass path validated: ${next.linkBypass?.path.join(" → ")} (avoids protected link R3-R5)`],
  },
  {
    id: "bypass-labels",
    label: "Bypass Labels Installed",
    narrative: "The bypass is signaled like any small RSVP-TE LSP: R5 (its own egress, the Merge Point) advertises implicit-null upstream to R4; R4 allocates and advertises a real label to R3.",
    run: (state) => (state.linkBypass ? { state: { ...state, linkBypass: { ...state.linkBypass, lifecycle: "READY" } }, events: [{ type: "MPLS_LABEL_INSTALLED", stepId: "bypass-labels", timestamp: Date.now(), message: "Bypass labels installed end to end" }] } : { state, events: [] }),
    whatChanged: (_, next) => [`R4 bypass label: ${next.linkBypass?.hopLabels.R4 !== undefined ? fmtLabel(next.linkBypass.hopLabels.R4) : "—"}`, `R5 (MP) advertises: implicit-null (PHP)`],
  },
  {
    id: "bypass-bandwidth",
    label: "Bypass Reservation",
    narrative: "500 Mbps is reserved for protection on R3-R4 and R4-R5 — matching the primary LSP's own bandwidth. Reserved does not mean flowing: current protected traffic through the bypass is 0 Mbps until an actual failure activates it.",
  },
  {
    id: "protection-ready-state",
    label: "Protection READY",
    narrative: "Full readiness summary: RSVP-PRIMARY UP · Protection READY · PLR R3 · Protected R3-R5 · Type LINK · Bypass R3-R4-R5 · Bypass state UP · Active repair NO.",
  },
  {
    id: "send-normal-2",
    label: "Send Traffic (Protection READY, Still Normal)",
    narrative: "Send traffic again. Even with the bypass fully READY, primary traffic still flows over the ordinary primary path — protection existing changes nothing about normal forwarding.",
    packet: () => ({ id: "ip-normal2", protocol: "IP", from: "R1", to: "R1", summary: "Packet classified into RSVP-PRIMARY", layers: [ipLayer(HOST_BEHIND_R1, HOST_BEHIND_R6)] }),
    run: (state) => ({ state: { ...state, packet: { srcIp: HOST_BEHIND_R1, dstIp: HOST_BEHIND_R6, labels: [] }, packetAt: "R1", journey: [] }, events: [{ type: "PACKET_SENT", stepId: "send-normal-2", timestamp: Date.now(), message: "Packet classified into RSVP-PRIMARY" }] }),
  },
  {
    id: "r1-push-normal-2",
    label: "R1 → R3 (Normal, Protected)",
    narrative: "R1 pushes exactly as before — R1 has no idea a bypass even exists. Nothing about the primary's own forwarding changed by adding protection.",
    packet: (state) => (state.packet ? mplsPacket("push2", "R1", "R3", "PUSH", "PUSH", state.packet) : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const fwd = buildPrimaryForwardingState(state.primaryLsp);
      const label = fwd.R1?.outgoingLabels?.[0];
      const packet = pushLabel(state.packet, typeof label === "number" ? label : 100, "transport");
      const journey = [...state.journey, { router: "R1" as RouterId, input: "IP", lookup: "RSVP-TE forwarding state", action: "PUSH" as FwdAction, output: `label ${fmtLabel(label ?? 100)}` }];
      return { state: { ...state, packet, packetAt: "R3", journey }, events: [] };
    },
  },
  {
    id: "r3-swap-normal-2",
    label: "R3 → R5 (Normal, Protected)",
    narrative: "R3 forwards over the still-healthy primary link — R3-R5 hasn't failed yet, so the bypass stays on standby, not carrying anything.",
    packet: (state) => (state.packet ? mplsPacket("swap2b", "R3", "R5", "SWAP", "SWAP", state.packet) : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const fwd = buildPrimaryForwardingState(state.primaryLsp);
      const label = fwd.R3?.outgoingLabels?.[0];
      const packet = swapTopLabel(state.packet, typeof label === "number" ? label : 200);
      const journey = [...state.journey, { router: "R3" as RouterId, input: "label", lookup: "Primary LFIB", action: "SWAP" as FwdAction, output: `label ${fmtLabel(label ?? 200)}` }];
      return { state: { ...state, packet, packetAt: "R5", journey }, events: [] };
    },
    whatChanged: () => ["Traffic still uses the primary link — a READY bypass never preempts healthy primary forwarding"],
  },
  {
    id: "trigger-failure",
    label: "R3-R5 LINK DOWN",
    narrative: "Now the R3-R5 link fails — for real this time, with protection already in place.",
    run: (state) => ({ state: { ...state, failedLinkIds: ["R3-R5"], failure: applyResourceFailure("LINK", "R3-R5"), linkBypass: state.linkBypass ? { ...state.linkBypass, lifecycle: "FAILURE_DETECTED" } : undefined }, events: [{ type: "MPLS_LSP_CHANGED", stepId: "trigger-failure", timestamp: Date.now(), message: "R3-R5 link down" }] }),
    whatChanged: () => ["R3-R5: UP → DOWN", "FRR lifecycle: READY → FAILURE_DETECTED"],
  },
  {
    id: "detection-note",
    label: "Detection vs. Repair",
    narrative:
      "Failure detection and FRR repair are separate concepts. This lesson uses deterministic local interface/link-down detection at R3. (Faster failure detection may also be provided by mechanisms such as BFD, depending on design — that's a note, not a lesson of its own.)",
  },
  {
    id: "r3-detects",
    label: "R3 Detects The Failure",
    narrative: "R3 — directly attached to R3-R5 — detects locally that its protected resource is gone. No CSPF runs. No message goes to R1 first.",
  },
  {
    id: "r3-checks-backup",
    label: "R3 Finds A Matching Backup",
    narrative: "R3 looks up its prepared FRR state and finds a bypass already associated with exactly this protected resource — and it's already READY.",
  },
  {
    id: "activate-local-repair",
    label: "Local Repair Activates",
    narrative: "R3 activates the bypass immediately. This is the entire reason it was pre-signaled: zero new signaling round-trip is needed right now.",
    run: (state) => (state.linkBypass ? { state: { ...state, linkBypass: { ...state.linkBypass, lifecycle: "LOCAL_REPAIR_ACTIVE" }, activeBypassId: state.linkBypass.id }, events: [{ type: "MPLS_LSP_CHANGED", stepId: "activate-local-repair", timestamp: Date.now(), message: "Local repair active via R3 → R4 → R5" }] } : { state, events: [] }),
    whatChanged: () => ["FRR lifecycle: FAILURE_DETECTED → LOCAL_REPAIR_ACTIVE", "Active path: R1 → R3 → R4 → R5 → R7 → R6"],
  },
  {
    id: "send-repaired",
    label: "Send Traffic (Local Repair Active)",
    narrative: "A new packet is sent — R1 still knows nothing about the failure.",
    packet: () => ({ id: "ip-repaired", protocol: "IP", from: "R1", to: "R1", summary: "Packet classified into RSVP-PRIMARY (unaware of failure)", layers: [ipLayer(HOST_BEHIND_R1, HOST_BEHIND_R6)] }),
    run: (state) => ({ state: { ...state, packet: { srcIp: HOST_BEHIND_R1, dstIp: HOST_BEHIND_R6, labels: [] }, packetAt: "R1", journey: [] }, events: [] }),
  },
  {
    id: "r1-push-repaired",
    label: "R1: PUSH (Unaware)",
    narrative: "R1 pushes the exact same label as always — R1 never learns about the failure before this packet arrives at R3.",
    packet: (state) => (state.packet ? mplsPacket("push3", "R1", "R3", "PUSH", "PUSH", state.packet) : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const fwd = buildPrimaryForwardingState(state.primaryLsp);
      const label = fwd.R1?.outgoingLabels?.[0];
      const packet = pushLabel(state.packet, typeof label === "number" ? label : 100, "transport");
      const journey = [...state.journey, { router: "R1" as RouterId, input: "IP", lookup: "RSVP-TE forwarding state (unchanged)", action: "PUSH" as FwdAction, output: `label ${fmtLabel(label ?? 100)}` }];
      return { state: { ...state, packet, packetAt: "R3", journey }, events: [] };
    },
  },
  {
    id: "r3-push-bypass",
    label: "R3: SWAP + PUSH Bypass Label",
    narrative: "R3 (PLR) prepares the protected-LSP forwarding context — exactly the label R5 (MP) already expects — then pushes the bypass's own outer label on top. The inner label is not new: it's the same label R3 would have swapped to anyway.",
    packet: (state) => {
      if (!state.packet || !state.linkBypass) return undefined;
      return mplsPacket("frrpush", "R3", "R4", "SWAP + PUSH BYPASS", "SWAP+PUSH", state.packet);
    },
    run: (state) => {
      if (!state.packet || !state.linkBypass) return { state, events: [] };
      const fwd = buildFrrForwardingState(state.primaryLsp, state.linkBypass);
      const labels = fwd.R3?.outgoingLabels ?? [];
      let packet = swapTopLabel(state.packet, typeof labels[labels.length - 1] === "number" ? (labels[labels.length - 1] as number) : 200);
      if (labels.length > 1 && typeof labels[0] === "number") packet = pushLabel(packet, labels[0] as number, "bypass");
      const journey = [...state.journey, { router: "R3" as RouterId, input: "primary label", lookup: "FRR: inner=MP-expected label, outer=bypass label", action: "SWAP_AND_PUSH_BYPASS" as FwdAction, output: labels.map((l) => fmtLabel(l)).join(" / ") }];
      return { state: { ...state, packet, packetAt: "R4", journey }, events: [{ type: "MPLS_LABEL_PUSHED", stepId: "r3-push-bypass", timestamp: Date.now(), message: "R3 pushes bypass label over the preserved inner protected-LSP label" }] };
    },
    whatChanged: (_, next) => [`Packet now carries two labels: outer (bypass) + inner (protected LSP, preserved) — ${next.packet?.labels.map((l) => l.value).join(" / ")}`],
  },
  {
    id: "r4-transit-bypass",
    label: "R4: Bypass Transit",
    narrative: "R4 is not a normal primary-LSP hop. It acts only on the outer bypass label — the inner protected-LSP label rides along untouched. R5 (MP) signaled implicit-null for the bypass, so R4 pops the outer label (bypass PHP).",
    packet: (state) => (state.packet ? mplsPacket("bypasstransit", "R4", "R5", "POP BYPASS (outer only)", "POP", state.packet) : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const packet = popTopLabel(state.packet);
      const journey = [...state.journey, { router: "R4" as RouterId, input: "outer bypass label", lookup: "Bypass LFIB: outer only, PHP toward R5", action: "POP_BYPASS" as FwdAction, output: `inner label ${packet.labels[0]?.value ?? "—"} exposed` }];
      return { state: { ...state, packet, packetAt: "R5", journey }, events: [{ type: "MPLS_LABEL_POPPED", stepId: "r4-transit-bypass", timestamp: Date.now(), message: "R4 pops the outer bypass label — inner protected-LSP label untouched" }] };
    },
  },
  {
    id: "r5-merge",
    label: "R5: Merge Point — Resume Normal Forwarding",
    narrative: "R5 receives exactly the label it always expected for RSVP-PRIMARY. It does not know (and does not need to know) a bypass was involved — it performs its ordinary SWAP toward R7, exactly as in healthy operation.",
    packet: (state) => (state.packet ? mplsPacket("mpresume", "R5", "R7", "SWAP (normal, resumed)", "SWAP", state.packet) : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const fwd = buildPrimaryForwardingState(state.primaryLsp);
      const label = fwd.R5?.outgoingLabels?.[0];
      const packet = swapTopLabel(state.packet, typeof label === "number" ? label : 300);
      const journey = [...state.journey, { router: "R5" as RouterId, input: "protected-LSP label (preserved)", lookup: "Primary LFIB — resumed, unmodified by the detour", action: "SWAP" as FwdAction, output: `label ${fmtLabel(label ?? 300)}` }];
      return { state: { ...state, packet, packetAt: "R7", journey }, events: [{ type: "MPLS_LABEL_SWAPPED", stepId: "r5-merge", timestamp: Date.now(), message: "R5 (MP) resumes normal protected-LSP forwarding" }] };
    },
  },
  {
    id: "r7-pop-repaired",
    label: "R7: POP (Unaffected)",
    narrative: "R7 was never part of the failure or the detour — it pops for PHP exactly as always.",
    packet: (state) => (state.packet ? mplsPacket("pop2", "R7", "R6", "POP", "POP", state.packet) : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const packet = popTopLabel(state.packet);
      const journey = [...state.journey, { router: "R7" as RouterId, input: "label", lookup: "Primary LFIB: POP", action: "POP" as FwdAction, output: "IP (unlabeled)" }];
      return { state: { ...state, packet, packetAt: "R6", journey }, events: [] };
    },
  },
  {
    id: "r6-deliver-repaired",
    label: "R6 Delivers — Locally Repaired",
    narrative: "R6 delivers the packet. It traveled R1 → R3 → R4 → R5 → R7 → R6 — only the local segment around the failure changed. R1 and R6 saw nothing different.",
    packet: (state) => (state.packet ? { id: "ip-delivered2", protocol: "IP", from: "R6", to: "R6", summary: "Delivered via local repair", layers: buildPacketLayers(state.packet) } : undefined),
    run: (state) => ({ state: { ...state, journey: [...state.journey, { router: "R6" as RouterId, input: "IP", lookup: "IP delivery", action: "IP_FORWARD" as FwdAction, output: "Delivered" }] }, events: [{ type: "MPLS_PACKET_FORWARDED", stepId: "r6-deliver-repaired", timestamp: Date.now(), message: "Delivered via local repair — R1 → R3 → R4 → R5 → R7 → R6" }] }),
    whatChanged: () => ["✓ Local repair restored traffic without any headend involvement", "✓ Inner protected-LSP label preserved through the entire detour"],
  },
  {
    id: "views-intro",
    label: "Views: Control/Data/Both, Normal/Failure/Repair",
    narrative:
      "Two toggles are now available. Control/Data/Both switches between FRR signaling state (control) and the actual MPLS packet (data). Normal/Failure/Local Repair/Reoptimized switches which path the topology emphasizes.",
  },
  {
    id: "reoptimization-intro",
    label: "FRR Is Not Necessarily Final",
    narrative: "Local repair protects traffic immediately. Separately — and later — the headend may establish a new, proper end-to-end LSP. Traffic does not have to remain on the local bypass forever.",
  },
  {
    id: "reoptimization-compute",
    label: "R1 Reoptimizes",
    narrative: "R1 eventually learns the topology changed, updates its TE database, and runs CSPF for a new end-to-end path avoiding the failed R3-R5 link.",
    run: (state) => {
      if (!state.failure) return { state, events: [] };
      const reopt = computeReoptimizedLsp(state.failure, state.links);
      return { state: { ...state, reoptimized: reopt, linkBypass: state.linkBypass ? { ...state.linkBypass, lifecycle: "REOPTIMIZING" } : undefined }, events: [{ type: "MPLS_LSP_CHANGED", stepId: "reoptimization-compute", timestamp: Date.now(), message: `R1 computes a new end-to-end path: ${reopt?.path.join(" → ")}` }] };
    },
    whatChanged: (_, next) => [`New end-to-end path computed: ${next.reoptimized?.path.join(" → ")} (TE metric ${next.reoptimized?.teMetricTotal})`],
  },
  {
    id: "reoptimization-complete",
    label: "New End-to-End LSP UP",
    narrative: "Once RSVP re-signals this new path end to end, it becomes the new primary — the temporary local bypass is no longer why traffic reaches R6. The FRR lifecycle reaches RECOVERED.",
    run: (state) => ({ state: { ...state, linkBypass: state.linkBypass ? { ...state.linkBypass, lifecycle: "RECOVERED" } : undefined }, events: [{ type: "MPLS_LSP_CHANGED", stepId: "reoptimization-complete", timestamp: Date.now(), message: "New end-to-end LSP UP — steady state restored" }] }),
    whatChanged: () => ["FRR lifecycle: REOPTIMIZING → RECOVERED"],
  },
  {
    id: "node-protection-intro",
    label: "Link Protection vs. Node Protection",
    narrative: "You've now seen link protection end to end. There's a second, distinct kind: node protection — protecting an entire router, not just one link to it.",
  },
  {
    id: "why-link-insufficient",
    label: "Why Link Protection Isn't Enough",
    narrative: "The link-protecting bypass is R3 → R4 → R5. Its Merge Point is R5 itself. If R5 fails completely, the bypass still terminates at R5 — which is now unavailable. Link protection does not automatically imply node protection.",
  },
  {
    id: "predict-link-protects-node",
    label: "Predict",
    narrative: "The link-protection bypass R3 → R4 → R5 is UP.",
    question: {
      prompt: "If the entire R5 router fails, will this bypass protect the LSP?",
      options: [
        { id: "no", label: "No — its Merge Point is R5 itself" },
        { id: "yes", label: "Yes — any bypass around R3-R5 also covers R5" },
        { id: "partially", label: "Partially — only for traffic already in flight" },
        { id: "depends-bw", label: "Only if enough bandwidth was reserved" },
      ],
      correctOptionId: "no",
      explanation: "The Merge Point of the link-protecting bypass is R5 itself. A failed R5 cannot act as a Merge Point — the bypass has nowhere to hand traffic back to. Protecting a link to a router is not the same as protecting that router.",
    },
  },
  {
    id: "reset-for-node-demo",
    label: "Reset: Back To Steady State",
    narrative: "R3-R5 is restored, local repair deactivates, and only the link-protection bypass remains READY — no node protection exists yet.",
    run: (state) => ({
      state: { ...state, failedLinkIds: [], failedNode: undefined, failure: undefined, activeBypassId: undefined, reoptimized: undefined, linkBypass: state.linkBypass ? { ...state.linkBypass, lifecycle: "READY" } : undefined, packet: undefined, packetAt: undefined, journey: [] },
      events: [],
    }),
  },
  {
    id: "fail-r5-node",
    label: "R5 FAILS (Entire Router)",
    narrative: "This time, the entire R5 router fails — not just one link to it.",
    run: (state) => ({ state: { ...state, failedNode: "R5", failure: applyResourceFailure("NODE", "R5") }, events: [{ type: "MPLS_LSP_CHANGED", stepId: "fail-r5-node", timestamp: Date.now(), message: "R5 has failed completely" }] }),
    whatChanged: () => ["R5: UP → FAILED (entire node)"],
  },
  {
    id: "link-bypass-fails-too",
    label: "The Link-Protection Bypass Cannot Help",
    narrative: "R3 tries its prepared link-protection bypass — but its Merge Point, R5, is exactly the router that just failed. Traffic is interrupted despite protection having been READY moments ago.",
    whatChanged: () => ["Link-protection bypass: READY but UNUSABLE — Merge Point R5 is down"],
  },
  {
    id: "node-protection-explain",
    label: "Node-Protecting Bypass",
    narrative: "A node-protecting bypass must avoid the protected router entirely, not just the link to it: R3 → R4 → R7 — skipping R5 completely. Its Merge Point is R7, the primary hop immediately after the protected node.",
  },
  {
    id: "establish-node-bypass",
    label: "Establish The Node-Protection Bypass",
    narrative: "R3 requests node protection for R5. The path is validated (it must avoid router R5 itself, not just the R3-R5 link) and computed: R3 → R4 → R7.",
    run: (state) => {
      const bypass = computeNodeProtectingBypass(state.primaryLsp, "R5", state.links);
      if (!bypass) return { state, events: [] };
      return { state: { ...state, nodeBypass: { ...bypass, lifecycle: "READY" } }, events: [{ type: "MPLS_LSP_CHANGED", stepId: "establish-node-bypass", timestamp: Date.now(), message: `Node-protecting bypass computed and signaled: ${bypass.path.join(" → ")}` }] };
    },
    whatChanged: (_, next) => [`Node bypass path validated: ${next.nodeBypass?.path.join(" → ")} (avoids protected node R5)`, `Merge Point: ${next.nodeBypass?.mergePoint}`],
  },
  {
    id: "node-repair-activate",
    label: "Local Repair Activates (Node Protection)",
    narrative: "R3 activates the node-protecting bypass. R5 is still down from the previous step — this repair happens against that same live failure.",
    run: (state) => (state.nodeBypass ? { state: { ...state, nodeBypass: { ...state.nodeBypass, lifecycle: "LOCAL_REPAIR_ACTIVE" }, activeBypassId: state.nodeBypass.id }, events: [{ type: "MPLS_LSP_CHANGED", stepId: "node-repair-activate", timestamp: Date.now(), message: "Local repair active via R3 → R4 → R7" }] } : { state, events: [] }),
    whatChanged: () => ["Active path: R1 → R3 → R4 → R7 → R6 — R5 skipped entirely"],
  },
  {
    id: "send-node-repaired",
    label: "Send Traffic (Node Protection Active)",
    narrative: "Send a packet through the node-protected path.",
    packet: () => ({ id: "ip-node", protocol: "IP", from: "R1", to: "R1", summary: "Packet classified into RSVP-PRIMARY", layers: [ipLayer(HOST_BEHIND_R1, HOST_BEHIND_R6)] }),
    run: (state) => ({ state: { ...state, packet: { srcIp: HOST_BEHIND_R1, dstIp: HOST_BEHIND_R6, labels: [] }, packetAt: "R1", journey: [] }, events: [] }),
  },
  {
    id: "r1-push-node",
    label: "R1: PUSH (Unaware)",
    narrative: "R1 pushes exactly as always.",
    packet: (state) => (state.packet ? mplsPacket("pushnode", "R1", "R3", "PUSH", "PUSH", state.packet) : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const fwd = buildPrimaryForwardingState(state.primaryLsp);
      const label = fwd.R1?.outgoingLabels?.[0];
      const packet = pushLabel(state.packet, typeof label === "number" ? label : 100, "transport");
      const journey = [...state.journey, { router: "R1" as RouterId, input: "IP", lookup: "RSVP-TE forwarding state (unchanged)", action: "PUSH" as FwdAction, output: `label ${fmtLabel(label ?? 100)}` }];
      return { state: { ...state, packet, packetAt: "R3", journey }, events: [] };
    },
  },
  {
    id: "r3-push-node-bypass",
    label: "R3: SWAP + PUSH Node Bypass Label",
    narrative: "R3's inner label target changes: it's now whatever R7 (the new MP) expects — R5 is skipped entirely. R3 pushes the node bypass's own outer label on top.",
    packet: (state) => (state.packet ? mplsPacket("frrpushnode", "R3", "R4", "SWAP + PUSH BYPASS", "SWAP+PUSH", state.packet) : undefined),
    run: (state) => {
      if (!state.packet || !state.nodeBypass) return { state, events: [] };
      const fwd = buildFrrForwardingState(state.primaryLsp, state.nodeBypass);
      const labels = fwd.R3?.outgoingLabels ?? [];
      let packet = swapTopLabel(state.packet, typeof labels[labels.length - 1] === "number" ? (labels[labels.length - 1] as number) : 300);
      if (labels.length > 1 && typeof labels[0] === "number") packet = pushLabel(packet, labels[0] as number, "bypass");
      const journey = [...state.journey, { router: "R3" as RouterId, input: "primary label", lookup: "FRR (node): inner=R7-expected label, outer=node-bypass label", action: "SWAP_AND_PUSH_BYPASS" as FwdAction, output: labels.map((l) => fmtLabel(l)).join(" / ") }];
      return { state: { ...state, packet, packetAt: "R4", journey }, events: [] };
    },
    whatChanged: (_, next) => [`Inner label now targets R7 directly (${next.nodeBypass?.mergePoint}), not R5 — R5 is completely bypassed`],
  },
  {
    id: "r4-transit-node-bypass",
    label: "R4: Node Bypass Transit",
    narrative: "R4 again acts only on the outer label. This time the bypass's destination is R7, not R5 — R4 doesn't know or care why, it just forwards the outer label.",
    packet: (state) => (state.packet ? mplsPacket("nodebypasstransit", "R4", "R7", "POP BYPASS (outer only)", "POP", state.packet) : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const packet = popTopLabel(state.packet);
      const journey = [...state.journey, { router: "R4" as RouterId, input: "outer bypass label", lookup: "Bypass LFIB: outer only, PHP toward R7", action: "POP_BYPASS" as FwdAction, output: `inner label ${packet.labels[0]?.value ?? "—"} exposed` }];
      return { state: { ...state, packet, packetAt: "R7", journey }, events: [] };
    },
  },
  {
    id: "r7-merge-node",
    label: "R7: Merge Point — Resume Normal Forwarding",
    narrative: "R7 receives exactly the label it always expected for RSVP-PRIMARY (the same label R5 would have sent it, had R5 been healthy). R7 performs its ordinary PHP action toward R6 — it never recomputed the original CSPF path.",
    packet: (state) => (state.packet ? mplsPacket("mpresumenode", "R7", "R6", "POP (normal, resumed)", "POP", state.packet) : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const packet = popTopLabel(state.packet);
      const journey = [...state.journey, { router: "R7" as RouterId, input: "protected-LSP label (preserved)", lookup: "Primary LFIB — resumed, unmodified by the detour", action: "POP" as FwdAction, output: "IP (unlabeled)" }];
      return { state: { ...state, packet, packetAt: "R6", journey }, events: [] };
    },
  },
  {
    id: "r6-deliver-node",
    label: "R6 Delivers — Node-Protected",
    narrative: "R6 delivers the packet. It traveled R1 → R3 → R4 → R7 → R6 — R5 was skipped entirely, and the LSP survived a complete router failure via pre-established local protection.",
    packet: (state) => (state.packet ? { id: "ip-delivered3", protocol: "IP", from: "R6", to: "R6", summary: "Delivered via node protection", layers: buildPacketLayers(state.packet) } : undefined),
    run: (state) => ({ state: { ...state, journey: [...state.journey, { router: "R6" as RouterId, input: "IP", lookup: "IP delivery", action: "IP_FORWARD" as FwdAction, output: "Delivered" }] }, events: [{ type: "MPLS_PACKET_FORWARDED", stepId: "r6-deliver-node", timestamp: Date.now(), message: "Delivered via node protection — R1 → R3 → R4 → R7 → R6" }] }),
  },
  {
    id: "link-vs-node-table",
    label: "Link vs. Node — Side by Side",
    narrative: "Protected R3-R5 (link) vs. R5 (node). PLR is R3 in both cases. MP is R5 for link protection but R7 for node protection. Bypass is R3-R4-R5 vs. R3-R4-R7. Both survive an R3-R5 link failure; only node protection survives a complete R5 failure.",
  },
  {
    id: "backup-styles-intro",
    label: "[ADVANCED] One-to-One vs. Facility Backup",
    narrative: "One-to-one backup signals a separate detour per protected LSP. Facility backup — what this lesson actually implements — signals one bypass tunnel that can protect many LSPs crossing the same resource. Facility backup is what makes FRR scale in a real provider core.",
  },
  {
    id: "multiple-lsps-concept",
    label: "[ADVANCED] Why Facility Backup Scales",
    narrative: "Conceptually: if LSP-A, LSP-B, and LSP-C all traversed R3-R5, the SAME R3 → R4 → R5 bypass could protect all three — one bypass tunnel, not three separate detours. This is a conceptual illustration, not a full multi-LSP simulation.",
  },
  {
    id: "bypass-failure-intro",
    label: "What If The Bypass Itself Fails?",
    narrative: "R5 has since recovered and local repair has stood down — RSVP-PRIMARY is back to ordinary end-to-end forwarding, with node protection READY again in the background. One more important case: the protected primary resource is completely healthy, but the bypass itself develops a fault.",
    run: (state) => ({
      state: { ...state, failedLinkIds: [], failedNode: undefined, failure: undefined, ...deactivateLocalRepair(state), packet: undefined, packetAt: undefined, journey: [] },
      events: [],
    }),
    whatChanged: () => ["R5: recovered", "Local repair: deactivated — bypass returns to READY, not carrying traffic"],
  },
  {
    id: "fail-bypass-link",
    label: "R4-R7 Fails (Bypass-Only)",
    narrative: "R4-R7 — part of the node-protecting bypass, not the primary path — fails. R3-R5 and R5 itself remain perfectly healthy.",
    run: (state) => ({ state: { ...state, failedLinkIds: ["R4-R7"], failedNode: undefined, failure: undefined }, events: [{ type: "MPLS_LSP_CHANGED", stepId: "fail-bypass-link", timestamp: Date.now(), message: "R4-R7 down — this affects only the node-protecting bypass" }] }),
    whatChanged: () => ["R4-R7: UP → DOWN (bypass-only link)", "Primary RSVP-PRIMARY: still fully healthy — R3-R5 and R5 untouched"],
  },
  {
    id: "protection-unavailable",
    label: "Primary UP, Protection UNAVAILABLE",
    narrative: "This is an important operational distinction: the primary LSP is completely unaffected and continues forwarding normally. But node protection is no longer usable — its own bypass path is broken. This is a loss of protection, not a service outage.",
    whatChanged: () => ["PRIMARY: UP", "NODE PROTECTION: READY → UNAVAILABLE"],
  },
  {
    id: "restore-bypass-link",
    label: "Restore R4-R7",
    narrative: "R4-R7 recovers, and node protection returns to READY.",
    run: (state) => ({ state: { ...state, failedLinkIds: [] }, events: [] }),
  },
  {
    id: "troubleshooting-intro",
    label: "Incident",
    narrative:
      "RSVP-PRIMARY was UP. Fast Reroute was reported READY before the event. After loss of router R5, traffic did not recover locally. R3 remains reachable. R4 remains reachable. R7 remains reachable.",
    run: (state) => ({ state: { ...state, troubleshooting: { ...state.troubleshooting, started: true }, nodeBypass: undefined, failedLinkIds: [], failedNode: "R5", failure: applyResourceFailure("NODE", "R5"), activeBypassId: undefined, packet: undefined, packetAt: undefined, journey: [] }, events: [{ type: "MPLS_LSP_CHANGED", stepId: "troubleshooting-intro", timestamp: Date.now(), message: "Incident: R5 failed, traffic did not recover locally" }] }),
  },
  {
    id: "diagnostic-ladder",
    label: "Diagnostic Ladder",
    narrative: "Physical reachability, the primary RSVP state before the event, failure detection at the PLR, FRR configuration, and the existing (link-only) bypass are all healthy. Something about the protection TYPE doesn't match this failure.",
  },
  {
    id: "repair-challenge",
    label: "Apply The Fix",
    narrative: "Choose the correct repair to restore protection against this failure.",
    action: (state, payload) => {
      const choice = typeof payload === "object" && payload !== null && "choice" in payload ? String((payload as { choice: string }).choice) : "";
      if (choice !== "establish-node-protection") return { state: { ...state, troubleshooting: { ...state.troubleshooting, repairAttempt: { choice, correct: false } } }, events: [] };
      const bypass = computeNodeProtectingBypass(state.primaryLsp, "R5", state.links);
      if (!bypass) return { state, events: [] };
      return {
        state: { ...state, nodeBypass: { ...bypass, lifecycle: "READY" }, troubleshooting: { ...state.troubleshooting, repairAttempt: { choice, correct: true }, nodeBypassEstablished: true } },
        events: [{ type: "MPLS_LSP_CHANGED", stepId: "repair-challenge", timestamp: Date.now(), message: "Node-protecting bypass R3 → R4 → R7 established" }],
      };
    },
    requiresState: (state) => state.troubleshooting.nodeBypassEstablished === true,
  },
  {
    id: "repaired-activate",
    label: "Local Repair Activates (Repaired)",
    narrative: "R5 is still down from the incident. With node protection now READY, R3 activates it immediately.",
    run: (state) => (state.nodeBypass ? { state: { ...state, nodeBypass: { ...state.nodeBypass, lifecycle: "LOCAL_REPAIR_ACTIVE" }, activeBypassId: state.nodeBypass.id }, events: [{ type: "MPLS_LSP_CHANGED", stepId: "repaired-activate", timestamp: Date.now(), message: "Local repair active via R3 → R4 → R7" }] } : { state, events: [] }),
  },
  {
    id: "verify-data-packet",
    label: "Verify With Real Traffic",
    narrative: "Send a packet through again, end to end, to prove the repaired protection actually carries traffic around the failed R5.",
    packet: () => ({ id: "ip-verify", protocol: "IP", from: "R1", to: "R1", summary: "Verification packet", layers: [ipLayer(HOST_BEHIND_R1, HOST_BEHIND_R6)] }),
    run: (state) => ({ state: { ...state, packet: { srcIp: HOST_BEHIND_R1, dstIp: HOST_BEHIND_R6, labels: [] }, packetAt: "R1", journey: [] }, events: [] }),
  },
  {
    id: "verify-push",
    label: "R1: PUSH (verified)",
    narrative: "R1 pushes exactly as always.",
    packet: (state) => (state.packet ? mplsPacket("vpush", "R1", "R3", "PUSH", "PUSH", state.packet) : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const fwd = buildPrimaryForwardingState(state.primaryLsp);
      const label = fwd.R1?.outgoingLabels?.[0];
      const packet = pushLabel(state.packet, typeof label === "number" ? label : 100, "transport");
      return { state: { ...state, packet, packetAt: "R3", journey: [...state.journey, { router: "R1" as RouterId, input: "IP", lookup: "RSVP-TE forwarding state", action: "PUSH" as FwdAction, output: `label ${fmtLabel(label ?? 100)}` }] }, events: [] };
    },
  },
  {
    id: "verify-frr",
    label: "R3 → R4 → R7 (verified)",
    narrative: "R3 activates the repaired node protection; R4 forwards on the outer label only; R7 (MP) resumes normal forwarding.",
    packet: (state) => (state.packet ? mplsPacket("vfrr", "R3", "R7", "FRR via R4", "SWAP+PUSH", state.packet) : undefined),
    run: (state) => {
      if (!state.packet || !state.nodeBypass) return { state, events: [] };
      const fwd = buildFrrForwardingState(state.primaryLsp, state.nodeBypass);
      const labels = fwd.R3?.outgoingLabels ?? [];
      let packet = swapTopLabel(state.packet, typeof labels[labels.length - 1] === "number" ? (labels[labels.length - 1] as number) : 300);
      if (labels.length > 1 && typeof labels[0] === "number") packet = pushLabel(packet, labels[0] as number, "bypass");
      packet = popTopLabel(packet);
      const journey = [
        ...state.journey,
        { router: "R3" as RouterId, input: "primary label", lookup: "FRR (node): swap + push outer bypass label", action: "SWAP_AND_PUSH_BYPASS" as FwdAction, output: labels.map((l) => fmtLabel(l)).join(" / ") },
        { router: "R4" as RouterId, input: "outer bypass label", lookup: "Bypass LFIB: outer only, PHP toward R7", action: "POP_BYPASS" as FwdAction, output: `inner label ${packet.labels[0]?.value ?? "—"} exposed` },
      ];
      return { state: { ...state, packet, packetAt: "R7", journey }, events: [] };
    },
  },
  {
    id: "verify-deliver",
    label: "R6 Delivers (verified)",
    narrative: "R7 pops for PHP exactly as always; R6 delivers. The repaired protection survives the same R5 failure that defeated the original, link-only bypass.",
    packet: (state) => (state.packet ? mplsPacket("vdeliver", "R7", "R6", "POP", "POP", state.packet) : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const packet = popTopLabel(state.packet);
      const journey = [
        ...state.journey,
        { router: "R7" as RouterId, input: "protected-LSP label", lookup: "Primary LFIB — resumed", action: "POP" as FwdAction, output: "IP (unlabeled)" },
        { router: "R6" as RouterId, input: "IP", lookup: "IP delivery", action: "IP_FORWARD" as FwdAction, output: "Delivered" },
      ];
      return { state: { ...state, packet, packetAt: "R6", journey }, events: [{ type: "MPLS_PACKET_FORWARDED", stepId: "verify-deliver", timestamp: Date.now(), message: "Verified: node protection restored service through complete R5 failure" }] };
    },
    whatChanged: () => ["✓ Diagnostic ladder correctly isolated a protection-type mismatch, not a reachability or bandwidth fault", "✓ Node-protecting bypass established and verified", "✓ Traffic delivered via R1 → R3 → R4 → R7 → R6 despite R5 being completely down"],
  },
  {
    id: "complete",
    label: "Lesson Complete",
    narrative:
      "You watched local repair activate at the PLR — not the headend — using a bypass pre-signaled before any failure, with the inner protected-LSP label preserved underneath an outer bypass label the whole way through. You saw exactly why a link-protecting bypass cannot survive the failure of the node it terminates on, and repaired that mismatch with genuine node protection. +500 XP awarded.",
    whatChanged: () => ["RSVP-PRIMARY protected by node-protecting bypass R3 → R4 → R7 — survives both R3-R5 link failure and complete R5 failure"],
  },
];

export const STEP_IDX = {
  predictR3R5Fail: stepIdx(rsvpFrrSteps, "predict-r3r5-fail"),
  noFrrIntro: stepIdx(rsvpFrrSteps, "no-frr-intro"),
  frrIntro: stepIdx(rsvpFrrSteps, "frr-intro"),
  establishLinkBypass: stepIdx(rsvpFrrSteps, "establish-link-bypass"),
  protectionReadyState: stepIdx(rsvpFrrSteps, "protection-ready-state"),
  triggerFailure: stepIdx(rsvpFrrSteps, "trigger-failure"),
  r3PushBypass: stepIdx(rsvpFrrSteps, "r3-push-bypass"),
  viewsIntro: stepIdx(rsvpFrrSteps, "views-intro"),
  reoptimizationIntro: stepIdx(rsvpFrrSteps, "reoptimization-intro"),
  nodeProtectionIntro: stepIdx(rsvpFrrSteps, "node-protection-intro"),
  establishNodeBypass: stepIdx(rsvpFrrSteps, "establish-node-bypass"),
  linkVsNodeTable: stepIdx(rsvpFrrSteps, "link-vs-node-table"),
  bypassFailureIntro: stepIdx(rsvpFrrSteps, "bypass-failure-intro"),
  troubleshootingIntro: stepIdx(rsvpFrrSteps, "troubleshooting-intro"),
  diagnosticLadder: stepIdx(rsvpFrrSteps, "diagnostic-ladder"),
  repairChallenge: stepIdx(rsvpFrrSteps, "repair-challenge"),
};

// ---------------------------------------------------------------------------
// Read-only CLI panel (brief §44)
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

function activeBypassFor(state: RsvpFrrState): Bypass | undefined {
  if (state.activeBypassId === state.linkBypass?.id) return state.linkBypass;
  if (state.activeBypassId === state.nodeBypass?.id) return state.nodeBypass;
  return undefined;
}

export function buildFrrCliCommands(state: RsvpFrrState, router: RouterId): CliCommandEntry[] {
  const onPrimary = state.primaryLsp.path.includes(router);
  const active = activeBypassFor(state);
  const relevantBypass = state.linkBypass?.plr === router || state.linkBypass?.path.includes(router) ? state.linkBypass : state.nodeBypass?.plr === router || state.nodeBypass?.path.includes(router) ? state.nodeBypass : undefined;

  const lspCisco: CliOutput = {
    cmd: "show mpls traffic-eng tunnels",
    output: onPrimary
      ? `Name: ${state.primaryLsp.id}\n  Bandwidth: ${state.primaryLsp.requestedBandwidthMbps} Mbps\n  Path: ${state.primaryLsp.path.join(" ")}\n  FRR: ${relevantBypass ? (relevantBypass.lifecycle === "READY" || relevantBypass.lifecycle === "LOCAL_REPAIR_ACTIVE" ? "Protection Available" : relevantBypass.lifecycle) : "none configured"}`
      : "(this router is not on the primary path)",
  };
  const frrCisco: CliOutput = {
    cmd: "show mpls traffic-eng fast-reroute database",
    output: relevantBypass
      ? `Protected: ${relevantBypass.protectedResource} (${relevantBypass.protectionType})\n  PLR: ${relevantBypass.plr}, MP: ${relevantBypass.mergePoint}\n  Bypass path: ${relevantBypass.path.join(" ")}\n  Bypass state: ${relevantBypass.lifecycle}\n  Active: ${active?.id === relevantBypass.id ? "YES" : "NO"}`
      : "(no FRR backup associated with this router)",
  };
  const fwdCisco: CliOutput = {
    cmd: "show mpls forwarding-table",
    output: (() => {
      const fwd = active ? buildFrrForwardingState(state.primaryLsp, active) : buildPrimaryForwardingState(state.primaryLsp);
      const entry = fwd[router];
      if (!entry) return "(no forwarding entry for this router right now)";
      return `${entry.incomingLabel === "UNLABELED" ? "-" : fmtLabel(entry.incomingLabel as LabelValue)}   ${entry.outgoingLabels ? entry.outgoingLabels.map((l) => fmtLabel(l)).join("/") : entry.action === "POP" || entry.action === "POP_BYPASS" ? "Pop" : "Aggregate"}   ${entry.outgoingInterface ?? "-"}`;
    })(),
  };

  const lspJuniper: CliOutput = { cmd: "show mpls lsp extensive", output: onPrimary ? `${state.primaryLsp.id}\n  ActivePath: ${state.primaryLsp.path.join(" ")}\n  Bandwidth: ${state.primaryLsp.requestedBandwidthMbps}Mbps\n  LSPtype: Primary` : "(not on this LSP's path)" };
  const frrJuniper: CliOutput = {
    cmd: "show rsvp session detail",
    output: relevantBypass
      ? `Bypass->${relevantBypass.mergePoint}, Protection:${relevantBypass.protectionType}\n  Type: Bypass LSP\n  PLR: ${relevantBypass.plr} MergePoint: ${relevantBypass.mergePoint}\n  State: ${relevantBypass.lifecycle} Active:${active?.id === relevantBypass.id}`
      : "(no bypass session)",
  };
  const fwdJuniper: CliOutput = {
    cmd: "show route table mpls.0",
    output: (() => {
      const fwd = active ? buildFrrForwardingState(state.primaryLsp, active) : buildPrimaryForwardingState(state.primaryLsp);
      const entry = fwd[router];
      if (!entry) return "mpls.0: 0 destinations";
      return `${entry.incomingLabel === "UNLABELED" ? "(ingress)" : fmtLabel(entry.incomingLabel as LabelValue)}\n    *[RSVP/7] via ${entry.outgoingInterface ?? "-"}\n      > ${entry.outgoingLabels ? `Push ${entry.outgoingLabels.map((l) => fmtLabel(l)).join("/")}` : entry.action}`;
    })(),
  };

  return [
    { id: "lsp", label: "primary lsp", cisco: lspCisco, juniper: lspJuniper },
    { id: "frr", label: "frr / bypass", cisco: frrCisco, juniper: frrJuniper },
    { id: "fwd", label: "forwarding", cisco: fwdCisco, juniper: fwdJuniper },
  ];
}
