import type { PacketLayer, PacketVisual, ScenarioStep } from "@/lib/sim-engine/types";
import { fmtLabel, type LabelValue } from "./rsvpTe";

export { fmtLabel };
export type { LabelValue };

/**
 * SR-MPLS Foundations — Node SID, Prefix SID, Adjacency SID, SRGB, and
 * segment stacks. Follows MPLS/LDP, RSVP-TE, and RSVP-TE FRR. Central
 * question: can we steer MPLS traffic using a list of instructions
 * without RSVP signaling every end-to-end LSP hop by hop?
 *
 * Scope boundary (deliberate, matching the brief): no SR Policy, SR-TE,
 * TI-LFA, PCEP, BGP SR Policy, Flex-Algo, or SRv6 in this lesson. The
 * topology omits R2-R3/R4-R5 — the brief permits them only "if useful,"
 * and the diamond shape alone is sufficient for every experiment here.
 */

export type RouterId = "R1" | "R2" | "R3" | "R4" | "R5" | "R6";
export const ALL_ROUTERS: RouterId[] = ["R1", "R2", "R3", "R4", "R5", "R6"];
export const HEADEND: RouterId = "R1";
export const DESTINATION: RouterId = "R6";

export type LinkId = "R1-R2" | "R2-R4" | "R4-R6" | "R1-R3" | "R3-R5" | "R5-R6";
export interface LinkDef {
  id: LinkId;
  a: RouterId;
  b: RouterId;
  metric: number;
}
export const LINKS: LinkDef[] = [
  { id: "R1-R2", a: "R1", b: "R2", metric: 10 },
  { id: "R2-R4", a: "R2", b: "R4", metric: 10 },
  { id: "R4-R6", a: "R4", b: "R6", metric: 10 },
  { id: "R1-R3", a: "R1", b: "R3", metric: 15 },
  { id: "R3-R5", a: "R3", b: "R5", metric: 15 },
  { id: "R5-R6", a: "R5", b: "R6", metric: 15 },
];
export const TOP_PATH: RouterId[] = ["R1", "R2", "R4", "R6"];
export const BOTTOM_PATH: RouterId[] = ["R1", "R3", "R5", "R6"];
export const CHANGED_METRIC_LINK: LinkId = "R2-R4";
export const CHANGED_METRIC_VALUE = 50;

export const ROUTER_LOOPBACK: Record<RouterId, string> = {
  R1: "10.0.0.1/32",
  R2: "10.0.0.2/32",
  R3: "10.0.0.3/32",
  R4: "10.0.0.4/32",
  R5: "10.0.0.5/32",
  R6: "10.0.0.6/32",
};
export const HOST_BEHIND_R1 = "192.168.1.10";
export const HOST_BEHIND_R6 = "192.168.6.20";

export const TERMS: { term: string; expansion: string; meaning: string }[] = [
  { term: "Node SID", expansion: "Node Segment Identifier", meaning: "Instruction: reach this router using the current IGP shortest path — commonly a Prefix-SID for the router's own loopback." },
  { term: "Prefix SID", expansion: "Prefix Segment Identifier", meaning: "The general SID type bound to a reachable prefix; a Node SID is simply the Prefix-SID for a router's loopback/node prefix." },
  { term: "Adjacency SID", expansion: "Adjacency Segment Identifier", meaning: "Instruction: at the router that owns it, use this one specific link — locally significant unless a segment list first steers traffic there." },
  { term: "SRGB", expansion: "Segment Routing Global Block", meaning: "The reserved label range a router derives its Prefix/Node SID labels from — index + SRGB start = local label." },
];

// ---------------------------------------------------------------------------
// SRGB / SID derivation
// ---------------------------------------------------------------------------

export const SRGB_START = 16000;
export const SRGB_END = 23999;
export const NODE_SID_INDEX: Record<RouterId, number> = { R1: 1, R2: 2, R3: 3, R4: 4, R5: 5, R6: 6 };
export const ADJ_SID_BASE = 24000;

/** SID index and derived label are distinct concepts — never conflate them. Do not assume every router shares an SRGB; this worked example does, for clarity. */
export function deriveNodeSidLabel(index: number, srgbStart: number = SRGB_START): number {
  return srgbStart + index;
}

export function computeAdjSidLabel(ownerIndex: number, neighborIndex: number): number {
  return ADJ_SID_BASE + ownerIndex * 10 + neighborIndex;
}

export interface PrefixSid {
  router: RouterId;
  prefix: string;
  index: number;
  label: number;
  algorithm: "SPF";
  scope: "GLOBAL";
}
export function buildPrefixSids(srgbStart: number = SRGB_START): PrefixSid[] {
  return ALL_ROUTERS.map((r) => ({
    router: r,
    prefix: ROUTER_LOOPBACK[r],
    index: NODE_SID_INDEX[r],
    label: deriveNodeSidLabel(NODE_SID_INDEX[r], srgbStart),
    algorithm: "SPF" as const,
    scope: "GLOBAL" as const,
  }));
}

export interface AdjSid {
  id: string;
  owner: RouterId;
  neighbor: RouterId;
  label: number;
  scope: "LOCAL";
}
function buildAllAdjSids(links: LinkDef[] = LINKS): AdjSid[] {
  const out: AdjSid[] = [];
  for (const l of links) {
    out.push({ id: `adj-${l.a}-${l.b}`, owner: l.a, neighbor: l.b, label: computeAdjSidLabel(NODE_SID_INDEX[l.a], NODE_SID_INDEX[l.b]), scope: "LOCAL" });
    out.push({ id: `adj-${l.b}-${l.a}`, owner: l.b, neighbor: l.a, label: computeAdjSidLabel(NODE_SID_INDEX[l.b], NODE_SID_INDEX[l.a]), scope: "LOCAL" });
  }
  return out;
}
export const ADJ_SIDS: AdjSid[] = buildAllAdjSids();
/** The one Adj-SID this lesson actually narrates: R3's local instruction for its R3-R5 adjacency. */
export const R3_R5_ADJ_SID: AdjSid = ADJ_SIDS.find((a) => a.owner === "R3" && a.neighbor === "R5")!;

// ---------------------------------------------------------------------------
// IGP shortest path (brute-force, same technique as rsvpTe.ts/rsvpFrr.ts —
// trivial to verify correct by inspection on a 6-node topology)
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
    const a = path[i];
    const b = path[i + 1];
    const link = links.find((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a));
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
// SID database (SidTableViewer feed)
// ---------------------------------------------------------------------------

export interface SidRow {
  prefix?: string;
  router?: RouterId;
  sidType: "NODE" | "ADJ";
  sidIndex?: number;
  localLabel: number;
  algorithm?: string;
  scope: "GLOBAL" | "LOCAL";
  owner?: RouterId;
  nextHop?: RouterId;
  meaning: string;
  installed: boolean;
}

/** Built from the observing router's (default: headend) own IGP view — a SID database is a per-router table, not a single global list, even though Node SIDs are globally meaningful. */
export function buildSidDatabase(prefixSids: PrefixSid[], adjSids: AdjSid[], links: LinkDef[], observer: RouterId = HEADEND): SidRow[] {
  const nodeRows: SidRow[] = prefixSids.map((p) => ({
    prefix: p.prefix,
    router: p.router,
    sidType: "NODE" as const,
    sidIndex: p.index,
    localLabel: p.label,
    algorithm: p.algorithm,
    scope: p.scope,
    nextHop: p.router === observer ? undefined : nextHopToward(links, observer, p.router),
    meaning: `Reach ${p.router}`,
    installed: true,
  }));
  const adjRows: SidRow[] = adjSids.map((a) => ({
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

// ---------------------------------------------------------------------------
// Segment list model
// ---------------------------------------------------------------------------

export type SegmentType = "NODE" | "ADJ";
export type SegmentSpec = { type: "NODE"; target: RouterId } | { type: "ADJ"; adjId: string };

export interface SegmentListItem {
  order: number;
  sid: number;
  type: SegmentType;
  owner?: RouterId;
  target: RouterId;
  scope: "GLOBAL" | "LOCAL";
  active: boolean;
  completed: boolean;
  explanation: string;
}

export function buildSegmentList(specs: SegmentSpec[], prefixSids: PrefixSid[], adjSids: AdjSid[]): SegmentListItem[] {
  return specs.map((spec, i) => {
    if (spec.type === "NODE") {
      const p = prefixSids.find((x) => x.router === spec.target)!;
      return { order: i, sid: p.label, type: "NODE" as const, target: spec.target, scope: "GLOBAL" as const, active: i === 0, completed: false, explanation: `Reach ${spec.target} via the current IGP shortest path.` };
    }
    const a = adjSids.find((x) => x.id === spec.adjId)!;
    return { order: i, sid: a.label, type: "ADJ" as const, owner: a.owner, target: a.neighbor, scope: "LOCAL" as const, active: i === 0, completed: false, explanation: `At ${a.owner}, use the ${a.owner}→${a.neighbor} adjacency specifically.` };
  });
}

/** The only ownership rule that matters: an Adj-SID may only ever be the ACTIVE instruction at the router that owns it. Node SIDs are globally actionable by construction. */
export function validateSidScope(item: SegmentListItem, atRouter: RouterId): boolean {
  return item.type === "NODE" ? true : item.owner === atRouter;
}

export function validateSegmentList(items: SegmentListItem[], headend: RouterId): { valid: boolean; reason?: string } {
  if (items.length === 0) return { valid: false, reason: "Empty segment list." };
  const first = items[0];
  if (!validateSidScope(first, headend)) {
    return { valid: false, reason: `${first.type === "ADJ" ? `Adj-SID ${first.sid}` : `SID ${first.sid}`} is owned by ${first.owner}, not ${headend}. A locally-significant Adj-SID cannot be the active instruction anywhere but its owner.` };
  }
  return { valid: true };
}

export function resolveActiveSegment(items: SegmentListItem[]): SegmentListItem | undefined {
  return items.find((i) => i.active && !i.completed);
}

export function advanceSegmentList(items: SegmentListItem[]): SegmentListItem[] {
  const activeIdx = items.findIndex((i) => i.active && !i.completed);
  if (activeIdx === -1) return items;
  return items.map((item, i) => {
    if (i === activeIdx) return { ...item, active: false, completed: true };
    if (i === activeIdx + 1) return { ...item, active: true };
    return item;
  });
}

/** Top-first physical MPLS stack for every segment not yet completed. */
export function buildSrLabelStack(items: SegmentListItem[]): number[] {
  return items.filter((i) => !i.completed).map((i) => i.sid);
}

/** Generic path preview for the segment-list lab — resolves each segment's own IGP sub-path in turn and concatenates them. Contains no per-hop LFIB action detail; that lives in the scripted narrative steps below. */
export function computeSrPacketPath(items: SegmentListItem[], links: LinkDef[], headend: RouterId = HEADEND): RouterId[] {
  let current = headend;
  const path: RouterId[] = [current];
  for (const item of items) {
    if (item.type === "NODE") {
      const sub = computeIgpShortestPath(links, current, item.target);
      if (!sub) break;
      path.push(...sub.path.slice(1));
      current = item.target;
    } else {
      path.push(item.target);
      current = item.target;
    }
  }
  return path;
}

// ---------------------------------------------------------------------------
// MPLS packet / label plumbing (per-file convention: re-derived, not shared,
// because RouterId differs per lesson)
// ---------------------------------------------------------------------------

export interface MplsLabel {
  value: LabelValue;
  purpose: "segment" | "transport";
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

export type FwdAction = "PUSH" | "CONTINUE" | "POP" | "POP_AND_FORWARD_ADJ" | "IP_FORWARD" | "INVALID_SID";
export interface JourneyHop {
  router: RouterId;
  input: string;
  lookup: string;
  action: FwdAction;
  output: string;
}

function ipLayer(src: string, dst: string): PacketLayer {
  return { name: "IPv4", color: "var(--pv-proto-ip)", fields: [{ label: "Source IP", value: src }, { label: "Destination IP", value: dst }] };
}
function shimLayer(label: MplsLabel, index: number): PacketLayer {
  return {
    name: `MPLS Shim (segment ${index + 1}${index === 0 ? ", active" : ""})`,
    color: "var(--pv-proto-mpls)",
    fields: [
      { label: "Label", value: fmtLabel(label.value) },
      { label: "S (Bottom of Stack)", value: label.bottomOfStack ? "1" : "0" },
    ],
  };
}
export function buildPacketLayers(pkt: MplsPacketState): PacketLayer[] {
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
  { id: "R6", label: "R6", x: 95, y: 50, subLabel: "Destination" },
];
export const GRAPH_EDGES: { id: LinkId; a: RouterId; b: RouterId }[] = LINKS.map((l) => ({ id: l.id, a: l.a, b: l.b }));

// ---------------------------------------------------------------------------
// Top-level scenario state
// ---------------------------------------------------------------------------

export interface TroubleshootingState {
  started: boolean;
  repairAttempt?: { choice: string; correct: boolean };
  correctListVerified: boolean;
}

export interface SrMplsState {
  links: LinkDef[];
  prefixSids: PrefixSid[];
  adjSids: AdjSid[];
  segmentList?: SegmentListItem[];
  packet?: MplsPacketState;
  packetAt?: RouterId;
  journey: JourneyHop[];
  metricChanged: boolean;
  fault?: { reason: string };
  troubleshooting: TroubleshootingState;
}

export function createSrMplsState(): SrMplsState {
  return {
    links: LINKS,
    prefixSids: buildPrefixSids(),
    adjSids: ADJ_SIDS,
    journey: [],
    metricChanged: false,
    troubleshooting: { started: false, correctListVerified: false },
  };
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

function mplsPacket(id: string, from: RouterId, to: RouterId, summary: string, action: string, pkt: MplsPacketState): PacketVisual {
  return { id, protocol: "MPLS", from, to, summary: `${action}: ${summary}`, layers: buildPacketLayers(pkt) };
}

const R6_LABEL = deriveNodeSidLabel(NODE_SID_INDEX.R6);
const R3_LABEL = deriveNodeSidLabel(NODE_SID_INDEX.R3);

export const srMplsSteps: ScenarioStep<SrMplsState>[] = [
  {
    id: "intro",
    label: "The Central Question",
    narrative: "You've seen LDP (labels follow the IGP shortest path) and RSVP-TE (an engineered LSP signaled hop by hop with PATH/RESV). This lesson asks: can we steer MPLS traffic using a list of instructions, without RSVP signaling every end-to-end LSP?",
  },
  {
    id: "recap",
    label: "Recap: LDP and RSVP-TE",
    narrative: "LDP: IGP shortest path → labels distributed by LDP → the LSP generally follows the IGP. RSVP-TE: TE database → CSPF → PATH/RESV → per-LSP RSVP state → an engineered LSP. Segment Routing looks different: IGP topology + SID information → the headend selects instructions → an MPLS label/SID stack. The IGP is not replaced — it remains fundamental. SR just adds an ordered list of instructions on top of it.",
  },
  {
    id: "predict-sr-eliminates-igp",
    label: "Predict",
    narrative: "Before going further:",
    question: {
      prompt: "Does SR-MPLS eliminate the need for an IGP?",
      options: [
        { id: "no", label: "No — the IGP still computes reachability and shortest paths; SR adds segment instructions on top" },
        { id: "yes-fully", label: "Yes — SR replaces IGP shortest-path computation entirely" },
        { id: "yes-partial", label: "Yes, but only for adjacency SIDs" },
      ],
      correctOptionId: "no",
      explanation: "The IGP remains fundamental — it still floods topology and computes shortest paths. SR extensions ride on top of it to advertise SIDs; a Node SID's forwarding is literally defined as \"follow the current IGP shortest path.\"",
    },
  },
  {
    id: "topology-intro",
    label: "Topology and IGP Costs",
    narrative: "R1 (headend) and R6 (destination) are connected by two paths: a top path via R2, R4 (cost 10 each, total 30) and a bottom path via R3, R5 (cost 15 each, total 45). The top path is the IGP shortest path.",
  },
  {
    id: "predict-igp-forwarding",
    label: "Predict",
    narrative: "Send an ordinary IP packet from R1 toward R6 — no MPLS involved yet.",
    question: {
      prompt: "What determines which physical path this packet takes?",
      options: [
        { id: "igp", label: "IGP shortest-path calculation" },
        { id: "random", label: "Whichever link has more capacity right now" },
        { id: "manual", label: "A manually configured static route on every router" },
      ],
      correctOptionId: "igp",
      explanation: "Ordinary IP forwarding follows the IGP's shortest-path calculation — here, R1 → R2 → R4 → R6, cost 30.",
    },
  },
  {
    id: "send-ip-normal",
    label: "Send Ordinary IP Traffic",
    narrative: `A host behind R1 (${HOST_BEHIND_R1}) sends traffic toward a host behind R6 (${HOST_BEHIND_R6}). No MPLS is involved — plain IGP-routed IP.`,
    packet: () => ({ id: "ip-plain", protocol: "IP", from: "R1", to: "R1", summary: "Ordinary IP packet, IGP-routed", layers: [ipLayer(HOST_BEHIND_R1, HOST_BEHIND_R6)] }),
    run: (state) => ({ state: { ...state, packetAt: "R1", journey: [] }, events: [] }),
  },
  {
    id: "ip-r1",
    label: "R1: IGP Lookup",
    narrative: "R1 looks up the shortest path to R6's prefix and forwards toward R2.",
    run: (state) => ({ state: { ...state, packetAt: "R2", journey: [...state.journey, { router: "R1", input: "IP", lookup: "IGP RIB: shortest path to R6 via R2", action: "IP_FORWARD", output: "toward R2" }] }, events: [] }),
  },
  {
    id: "ip-r2",
    label: "R2: IGP Lookup",
    narrative: "R2 is an ordinary transit hop — it forwards using its own IGP shortest path toward R6.",
    run: (state) => ({ state: { ...state, packetAt: "R4", journey: [...state.journey, { router: "R2", input: "IP", lookup: "IGP RIB: shortest path to R6 via R4", action: "IP_FORWARD", output: "toward R4" }] }, events: [] }),
  },
  {
    id: "ip-r4",
    label: "R4: IGP Lookup",
    narrative: "R4 forwards directly to R6.",
    run: (state) => ({ state: { ...state, packetAt: "R6", journey: [...state.journey, { router: "R4", input: "IP", lookup: "IGP RIB: directly connected to R6", action: "IP_FORWARD", output: "toward R6" }] }, events: [] }),
  },
  {
    id: "ip-r6-deliver",
    label: "R6 Delivers",
    narrative: "R6 delivers the packet. Path taken: R1 → R2 → R4 → R6 — exactly the IGP shortest path, cost 30.",
    run: (state) => ({ state: { ...state, journey: [...state.journey, { router: "R6", input: "IP", lookup: "IP delivery", action: "IP_FORWARD", output: "Delivered" }] }, events: [] }),
    whatChanged: () => ["Delivered R1 → R2 → R4 → R6 — plain IGP forwarding, no MPLS involved"],
  },
  {
    id: "segment-intro",
    label: "Introduce: A Segment",
    narrative: "A segment represents an instruction, not just another MPLS label. A Node/Prefix SID means \"reach this prefix/node using the IGP shortest path.\" An Adjacency SID means \"at the router that owns this SID, use this specific adjacency.\" The MPLS label is the data-plane encoding; the SID is what the label means.",
  },
  {
    id: "srgb-intro",
    label: "SRGB — Segment Routing Global Block",
    narrative: `Each router reserves a Segment Routing Global Block — a label range it derives Prefix/Node SID labels from. This lesson uses SRGB ${SRGB_START}-${SRGB_END} network-wide for clarity (real deployments are not required to share identical SRGBs everywhere). Each router also gets a Prefix-SID index: R1=1, R2=2, R3=3, R4=4, R5=5, R6=6.`,
  },
  {
    id: "node-sid-terminology",
    label: "Node SID = Prefix-SID For A Loopback",
    narrative: `R6's loopback is ${ROUTER_LOOPBACK.R6}, with Prefix-SID index ${NODE_SID_INDEX.R6}. Its Node SID label in this SRGB is ${R6_LABEL} (${SRGB_START} + ${NODE_SID_INDEX.R6}). A Node SID is not a separate protocol object — it is simply the Prefix-SID for a router's own node/loopback prefix, representing the shortest path to that node.`,
  },
  {
    id: "sid-database-intro",
    label: "The SID Database",
    narrative: "Every SID a router has learned — Prefix/Node SIDs (global scope) and any locally-owned Adjacency SIDs (local scope) — lives in a SID database. Node SIDs show Scope: Global; ordinary Adjacency SIDs show Scope: Local.",
  },
  {
    id: "control-plane-distribution",
    label: "How SID Information Reaches Routers",
    narrative: "Conceptually: OSPF/IS-IS → Segment Routing extensions → Prefix-SID/Adj-SID advertisements → each router's SID database and MPLS forwarding state. This lesson stays protocol-neutral — the extensions carry SIDs the same way underneath either IGP.",
  },
  {
    id: "send-node-sid-r6",
    label: "Impose Node SID R6",
    narrative: `At R1, impose a single segment: [${R6_LABEL}] — \"reach R6 using the shortest path to R6.\" This is important: the SID does not encode every individual hop; the current IGP shortest path to the active Node SID determines transit forwarding.`,
    packet: () => ({ id: "ip-nodesid-1", protocol: "IP", from: "R1", to: "R1", summary: "Packet classified for R6 Node SID", layers: [ipLayer(HOST_BEHIND_R1, HOST_BEHIND_R6)] }),
    run: (state) => ({
      state: { ...state, segmentList: buildSegmentList([{ type: "NODE", target: "R6" }], state.prefixSids, state.adjSids), packet: { labels: [], srcIp: HOST_BEHIND_R1, dstIp: HOST_BEHIND_R6 }, packetAt: "R1", journey: [] },
      events: [],
    }),
  },
  {
    id: "r1-push-node-sid",
    label: "R1: PUSH Node SID R6",
    narrative: `R1 imposes the Node SID label ${R6_LABEL}.`,
    packet: (state) => (state.packet ? mplsPacket("push-node-1", "R1", "R2", "impose Node SID R6", "PUSH", pushLabel(state.packet, R6_LABEL)) : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const pkt = pushLabel(state.packet, R6_LABEL);
      return { state: { ...state, packet: pkt, packetAt: "R2", journey: [...state.journey, { router: "R1", input: "IP", lookup: "Segment list: [R6 Node SID]", action: "PUSH", output: fmtLabel(R6_LABEL) }] }, events: [] };
    },
  },
  {
    id: "r2-continue",
    label: "R2: CONTINUE (Transit)",
    narrative: `R2 is not the target and not the penultimate hop. It recognizes label ${R6_LABEL} as R6's Node SID, looks up its own shortest path toward R6 (via R4), and forwards — the label value is unchanged, because every router in this SRGB agrees on what ${R6_LABEL} means.`,
    packet: (state) => (state.packet ? mplsPacket("continue-1", "R2", "R4", "forward toward R6 (unchanged)", "CONTINUE", state.packet) : undefined),
    run: (state) => ({ state: { ...state, packetAt: "R4", journey: [...state.journey, { router: "R2", input: fmtLabel(R6_LABEL), lookup: "Active SID = R6 Node SID; shortest path via R4", action: "CONTINUE", output: fmtLabel(R6_LABEL) }] }, events: [] }),
  },
  {
    id: "r4-pop-php",
    label: "R4: POP (PHP)",
    narrative: "R4 is the penultimate hop toward R6 — R6 signaled implicit-null, so R4 pops before forwarding (standard penultimate-hop popping).",
    packet: (state) => (state.packet ? mplsPacket("php-1", "R4", "R6", "penultimate-hop pop", "POP", popTopLabel(state.packet)) : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      return { state: { ...state, packet: popTopLabel(state.packet), packetAt: "R6", journey: [...state.journey, { router: "R4", input: fmtLabel(R6_LABEL), lookup: "Primary LFIB: PHP (implicit-null from R6)", action: "POP", output: "IP (unlabeled)" }] }, events: [] };
    },
  },
  {
    id: "r6-deliver-node-sid",
    label: "R6 Delivers",
    narrative: "R6 delivers the packet. Path taken: R1 → R2 → R4 → R6 — the current IGP shortest path toward the active Node SID.",
    packet: (state) => (state.packet ? { id: "delivered-1", protocol: "IP", from: "R6", to: "R6", summary: "Delivered via Node SID R6", layers: buildPacketLayers(state.packet) } : undefined),
    run: (state) => ({ state: { ...state, journey: [...state.journey, { router: "R6", input: "IP", lookup: "IP delivery", action: "IP_FORWARD", output: "Delivered" }] }, events: [] }),
    whatChanged: () => [`Delivered via Node SID ${R6_LABEL} — path R1 → R2 → R4 → R6`],
  },
  {
    id: "metric-change-intro",
    label: "Change The IGP",
    narrative: "Now change an IGP metric — the R2-R4 link cost goes from 10 to 50 — so the shortest path toward R6 becomes the bottom path. The Node SID stays exactly the same: [R6].",
  },
  {
    id: "change-metric",
    label: "R2-R4 Metric: 10 → 50",
    narrative: `The R2-R4 metric changes to ${CHANGED_METRIC_VALUE}. Top path cost is now 10+${CHANGED_METRIC_VALUE}+10 = ${10 + CHANGED_METRIC_VALUE + 10}; bottom path cost is still 45. The bottom path is now shortest.`,
    run: (state) => ({ state: { ...state, links: state.links.map((l) => (l.id === CHANGED_METRIC_LINK ? { ...l, metric: CHANGED_METRIC_VALUE } : l)), metricChanged: true }, events: [] }),
    whatChanged: () => [`R2-R4: 10 → ${CHANGED_METRIC_VALUE}`, "Shortest path to R6 is now R1 → R3 → R5 → R6 (cost 45)"],
  },
  {
    id: "predict-node-sid-metric-change",
    label: "Predict",
    narrative: "The active segment is still [R6 Node SID] — nothing about the SID itself changed.",
    question: {
      prompt: "If R6's Node SID stays unchanged but the IGP shortest path changes, can the physical path to R6 change?",
      options: [
        { id: "yes", label: "Yes — a Node SID's physical path always follows the current IGP shortest path" },
        { id: "no", label: "No — a Node SID freezes the path it was first computed with" },
      ],
      correctOptionId: "yes",
      explanation: "A Node SID means \"reach this node via the current shortest path\" — it is re-evaluated by whatever the IGP believes right now, not frozen at some earlier moment.",
    },
  },
  {
    id: "send-node-sid-r6-again",
    label: "Send Again — Same Segment",
    narrative: `Send another packet with the identical segment list: [${R6_LABEL}].`,
    packet: () => ({ id: "ip-nodesid-2", protocol: "IP", from: "R1", to: "R1", summary: "Packet classified for R6 Node SID (unchanged)", layers: [ipLayer(HOST_BEHIND_R1, HOST_BEHIND_R6)] }),
    run: (state) => ({ state: { ...state, packet: { labels: [], srcIp: HOST_BEHIND_R1, dstIp: HOST_BEHIND_R6 }, packetAt: "R1", journey: [] }, events: [] }),
  },
  {
    id: "r1-push-node-sid-2",
    label: "R1: PUSH Node SID R6 (Unchanged Instruction)",
    narrative: `R1 imposes the exact same label, ${R6_LABEL}.`,
    packet: (state) => (state.packet ? mplsPacket("push-node-2", "R1", "R3", "impose Node SID R6", "PUSH", pushLabel(state.packet, R6_LABEL)) : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      return { state: { ...state, packet: pushLabel(state.packet, R6_LABEL), packetAt: "R3", journey: [...state.journey, { router: "R1", input: "IP", lookup: "Segment list: [R6 Node SID] (unchanged)", action: "PUSH", output: fmtLabel(R6_LABEL) }] }, events: [] };
    },
  },
  {
    id: "r3-continue-2",
    label: "R3: CONTINUE (New Transit Hop)",
    narrative: "R3 is now on the shortest path toward R6 — it wasn't before. Same label, different router doing the transit forwarding.",
    packet: (state) => (state.packet ? mplsPacket("continue-2", "R3", "R5", "forward toward R6 (unchanged)", "CONTINUE", state.packet) : undefined),
    run: (state) => ({ state: { ...state, packetAt: "R5", journey: [...state.journey, { router: "R3", input: fmtLabel(R6_LABEL), lookup: "Active SID = R6 Node SID; shortest path via R5", action: "CONTINUE", output: fmtLabel(R6_LABEL) }] }, events: [] }),
  },
  {
    id: "r5-pop-php-2",
    label: "R5: POP (PHP)",
    narrative: "R5 is now the penultimate hop toward R6.",
    packet: (state) => (state.packet ? mplsPacket("php-2", "R5", "R6", "penultimate-hop pop", "POP", popTopLabel(state.packet)) : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      return { state: { ...state, packet: popTopLabel(state.packet), packetAt: "R6", journey: [...state.journey, { router: "R5", input: fmtLabel(R6_LABEL), lookup: "Primary LFIB: PHP (implicit-null from R6)", action: "POP", output: "IP (unlabeled)" }] }, events: [] };
    },
  },
  {
    id: "r6-deliver-node-sid-2",
    label: "R6 Delivers — Different Physical Path",
    narrative: "R6 delivers the packet. Path taken this time: R1 → R3 → R5 → R6. Same Node SID + different IGP shortest path = different physical forwarding path. This is the core Node SID behavior.",
    packet: (state) => (state.packet ? { id: "delivered-2", protocol: "IP", from: "R6", to: "R6", summary: "Delivered via Node SID R6 (bottom path)", layers: buildPacketLayers(state.packet) } : undefined),
    run: (state) => ({ state: { ...state, journey: [...state.journey, { router: "R6", input: "IP", lookup: "IP delivery", action: "IP_FORWARD", output: "Delivered" }] }, events: [] }),
    whatChanged: () => ["Same Node SID, new physical path: R1 → R3 → R5 → R6"],
  },
  {
    id: "metric-restore",
    label: "Restore The IGP",
    narrative: "Restore the R2-R4 metric to 10. The top path (R1 → R2 → R4 → R6, cost 30) is shortest again.",
    run: (state) => ({ state: { ...state, links: state.links.map((l) => (l.id === CHANGED_METRIC_LINK ? { ...l, metric: 10 } : l)), metricChanged: false, packet: undefined, packetAt: undefined, journey: [] }, events: [] }),
    whatChanged: () => ["R2-R4: 50 → 10 (restored)"],
  },
  {
    id: "predict-node-sid-force",
    label: "Predict",
    narrative: "Operations wants traffic to use the R3→R5 link specifically, despite that not being the shortest route right now (top path is shortest again).",
    question: {
      prompt: "Can R6's Node SID alone force that particular link?",
      options: [
        { id: "no", label: "No — a Node SID means \"shortest path toward the node,\" not \"use this specific interface\"" },
        { id: "yes", label: "Yes — any Node SID can be configured to force a specific link" },
      ],
      correctOptionId: "no",
      explanation: "A Node SID is a shortest-path instruction. To force one particular link regardless of the IGP's opinion, you need an instruction that means exactly that — an Adjacency SID.",
    },
  },
  {
    id: "adjsid-intro",
    label: "Introduce: Adjacency SID",
    narrative: `R3 owns an Adjacency SID for its R3→R5 link: ${R3_R5_ADJ_SID.label}. This SID means: \"when active at R3, send the packet over the R3→R5 adjacency\" — nothing about shortest paths at all.`,
  },
  {
    id: "adjsid-local-significance",
    label: "Local Significance (Mandatory Concept)",
    narrative: `Adj-SID ${R3_R5_ADJ_SID.label} — Owner: R3, Scope: LOCAL, Meaning: R3→R5. At R1, ${R3_R5_ADJ_SID.label} does NOT mean \"go to R3→R5.\" It is not a globally meaningful node instruction by default — R1 has no idea what to do with it on its own.`,
  },
  {
    id: "predict-adjsid-type",
    label: "Predict",
    narrative: "Before building a segment list:",
    question: {
      prompt: "Which SID type can directly represent \"use this particular adjacency\"?",
      options: [
        { id: "adj", label: "Adjacency SID" },
        { id: "node", label: "Node SID" },
        { id: "prefix", label: "Prefix SID for a remote prefix" },
      ],
      correctOptionId: "adj",
      explanation: "Only an Adjacency SID carries \"use this one specific link\" semantics. Node/Prefix SIDs always mean \"reach this node/prefix via the shortest path.\"",
    },
  },
  {
    id: "sid-db-update",
    label: "SID Database, Updated",
    narrative: `SID ${R6_LABEL}: Node, Global, \"Reach R6.\" SID ${R3_LABEL}: Node, Global, \"Reach R3.\" SID ${R3_R5_ADJ_SID.label}: Adj, owner R3, Local, \"R3→R5.\" \"Global\" here means globally significant within the SR domain — not an Internet-global identifier.`,
  },
  {
    id: "build-segment-list-intro",
    label: "Build The First Real Segment List",
    narrative: `Requirement: reach R6, but force the R3→R5 adjacency. Correct segment list: 1) R3 Node SID, 2) R3→R5 Adj-SID, 3) R6 Node SID.`,
  },
  {
    id: "segment-list-viewer-intro",
    label: "Segment List",
    narrative: "The segment list renders top-first: the active instruction is what the packet executes right now; the rest are pending.",
    run: (state) => ({ state: { ...state, segmentList: buildSegmentList([{ type: "NODE", target: "R3" }, { type: "ADJ", adjId: R3_R5_ADJ_SID.id }, { type: "NODE", target: "R6" }], state.prefixSids, state.adjSids) }, events: [] }),
  },
  {
    id: "send-steered-packet",
    label: "Impose The Segment List",
    narrative: `R1 imposes all three labels in order: [${R3_LABEL}, ${R3_R5_ADJ_SID.label}, ${R6_LABEL}] — the active instruction (R3 Node SID) is on top.`,
    packet: () => ({ id: "ip-steer", protocol: "IP", from: "R1", to: "R1", summary: "Packet classified for the R3→R5-forcing segment list", layers: [ipLayer(HOST_BEHIND_R1, HOST_BEHIND_R6)] }),
    run: (state) => ({ state: { ...state, packet: { labels: [], srcIp: HOST_BEHIND_R1, dstIp: HOST_BEHIND_R6 }, packetAt: "R1", journey: [] }, events: [] }),
  },
  {
    id: "r1-push-segments",
    label: "R1: PUSH Full Segment Stack",
    narrative: "R1 imposes all three labels at once — this is what \"a segment list\" physically is: one MPLS label stack, imposed one time, encoding an ordered list of instructions.",
    packet: (state) => {
      if (!state.packet) return undefined;
      let pkt = pushLabel(state.packet, R6_LABEL);
      pkt = pushLabel(pkt, R3_R5_ADJ_SID.label);
      pkt = pushLabel(pkt, R3_LABEL);
      return mplsPacket("push-steer", "R1", "R3", "impose full segment stack", "PUSH", pkt);
    },
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      let pkt = pushLabel(state.packet, R6_LABEL);
      pkt = pushLabel(pkt, R3_R5_ADJ_SID.label);
      pkt = pushLabel(pkt, R3_LABEL);
      return { state: { ...state, packet: pkt, packetAt: "R3", journey: [...state.journey, { router: "R1", input: "IP", lookup: `Segment list: [${R3_LABEL}, ${R3_R5_ADJ_SID.label}, ${R6_LABEL}]`, action: "PUSH", output: `${fmtLabel(R3_LABEL)} / ${fmtLabel(R3_R5_ADJ_SID.label)} / ${fmtLabel(R6_LABEL)}` }] }, events: [] };
    },
  },
  {
    id: "r3-node-sid-complete",
    label: "R3: Node SID R3 Completes",
    narrative: `R3 recognizes itself as the target of the active segment (${R3_LABEL}). For this segment list, no PHP applies to the R3 Node SID — R3 pops its own label on arrival, completing the first segment. The Adj-SID is now the active instruction.`,
    packet: (state) => (state.packet ? mplsPacket("r3-node-complete", "R3", "R3", "Node SID R3 self-completes", "POP", popTopLabel(state.packet)) : undefined),
    run: (state) => {
      if (!state.packet || !state.segmentList) return { state, events: [] };
      return {
        state: { ...state, packet: popTopLabel(state.packet), segmentList: advanceSegmentList(state.segmentList), journey: [...state.journey, { router: "R3", input: fmtLabel(R3_LABEL), lookup: "Active SID = R3 Node SID; R3 is the target — segment completes on arrival", action: "POP", output: fmtLabel(R3_R5_ADJ_SID.label) }] },
        events: [],
      };
    },
    whatChanged: () => ["Segment 1 (R3 Node SID): completed", "Segment 2 (R3→R5 Adj-SID): now active"],
  },
  {
    id: "r3-execute-adjsid",
    label: "R3: Execute Local Adjacency SID",
    narrative: `The active SID's owner is R3 itself, and its type is adjacency — R3 resolves the specified adjacency (R3→R5), pops its own label, and sends over that exact link, not via any shortest-path lookup. The next segment (R6 Node SID) becomes active.`,
    packet: (state) => (state.packet ? mplsPacket("r3-adj-exec", "R3", "R5", "resolve R3→R5 adjacency", "POP_AND_FORWARD_ADJ", popTopLabel(state.packet)) : undefined),
    run: (state) => {
      if (!state.packet || !state.segmentList) return { state, events: [] };
      return {
        state: { ...state, packet: popTopLabel(state.packet), packetAt: "R5", segmentList: advanceSegmentList(state.segmentList), journey: [...state.journey, { router: "R3", input: fmtLabel(R3_R5_ADJ_SID.label), lookup: "SID owner = R3 (local); type = adjacency; resolve R3→R5", action: "POP_AND_FORWARD_ADJ", output: `${fmtLabel(R6_LABEL)} → via R3→R5` }] },
        events: [],
      };
    },
    whatChanged: () => ["Segment 2 (R3→R5 Adj-SID): completed", "Segment 3 (R6 Node SID): now active", "Physical link used: R3→R5"],
  },
  {
    id: "r5-continue",
    label: "R5: CONTINUE Toward R6",
    narrative: "Once the Adj-SID is completed, the next active segment is the R6 Node SID. R5 → R6 follows the ordinary IGP shortest path from R5 — which happens to be one hop.",
    packet: (state) => (state.packet ? mplsPacket("r5-continue", "R5", "R6", "forward toward R6 (unchanged)", "CONTINUE", state.packet) : undefined),
    run: (state) => ({ state: { ...state, packetAt: "R6", journey: [...state.journey, { router: "R5", input: fmtLabel(R6_LABEL), lookup: "Active SID = R6 Node SID; shortest path is directly connected", action: "CONTINUE", output: fmtLabel(R6_LABEL) }] }, events: [] }),
  },
  {
    id: "r6-pop-node-sid",
    label: "R6: Node SID R6 Completes",
    narrative: "R6 recognizes itself as the target and pops its own last remaining label (no-PHP for this segment list), exposing the IP packet.",
    packet: (state) => (state.packet ? mplsPacket("r6-pop", "R6", "R6", "final segment self-completes", "POP", popTopLabel(state.packet)) : undefined),
    run: (state) => {
      if (!state.packet || !state.segmentList) return { state, events: [] };
      return { state: { ...state, packet: popTopLabel(state.packet), segmentList: advanceSegmentList(state.segmentList), journey: [...state.journey, { router: "R6", input: fmtLabel(R6_LABEL), lookup: "Active SID = R6 Node SID; R6 is the target", action: "POP", output: "IP (unlabeled)" }] }, events: [] };
    },
    whatChanged: () => ["Segment 3 (R6 Node SID): completed — all segments executed"],
  },
  {
    id: "r6-deliver-steered",
    label: "R6 Delivers — Steered Path",
    narrative: "R6 delivers the packet. Path taken: R1 → R3 → R5 → R6. R1→R3: R3 Node SID. R3→R5: Adj-SID owned by R3. R5→R6: R6 Node SID.",
    packet: (state) => (state.packet ? { id: "delivered-steer", protocol: "IP", from: "R6", to: "R6", summary: "Delivered via steered segment list", layers: buildPacketLayers(state.packet) } : undefined),
    run: (state) => ({ state: { ...state, journey: [...state.journey, { router: "R6", input: "IP", lookup: "IP delivery", action: "IP_FORWARD", output: "Delivered" }] }, events: [] }),
    whatChanged: () => ["Delivered R1 → R3 → R5 → R6 — the R3→R5 link was used despite not being the IGP shortest path"],
  },
  {
    id: "segment-vs-label-stack",
    label: "Segment Stack vs. Ordinary Label Stack",
    narrative: "Physically, SR-MPLS uses the exact same MPLS label stack you already know. Logically, those labels encode an ordered list of segment instructions — the same mechanism, a different meaning layered on top.",
  },
  {
    id: "rsvp-vs-sr-comparison",
    label: "RSVP-TE vs. SR-MPLS Steering",
    narrative: "RSVP-TE: CSPF → PATH hop-by-hop → RESV hop-by-hop → per-LSP RSVP state → packet. SR-MPLS steering: SID information already distributed → headend chooses a segment list → packet carries the SID stack. Routers still hold real state — IGP state, SID information, MPLS forwarding state — the difference is avoiding RSVP-style per-LSP hop-by-hop signaling for this steering model.",
  },
  {
    id: "views-intro",
    label: "Views: Control/Data/Both, Physical/IGP/SR",
    narrative: "Control shows IGP topology, Prefix/Adj-SID advertisements, SRGB, and the SID database. Data shows the MPLS SID stack, active segment, and LFIB action. The SR view exposes Node SIDs, Adj-SIDs, the active segment list, and the current SID without cluttering the topology.",
  },
  {
    id: "segment-lab-intro",
    label: "Segment-List Lab",
    narrative: "Build a segment list from the available SIDs and preview its resulting physical path — read-only, computed against the real IGP and SID state.",
  },
  {
    id: "lab-compare-experiment",
    label: "Compare: [R3, R6] vs. [R3, Adj R3→R5, R6]",
    narrative: "[R3, R6] steers traffic via R3, then leaves R3 toward R6 using whatever shortest path currently exists from R3 — which may or may not be R3→R5. [R3, Adj R3→R5, R6] explicitly forces the R3→R5 link. This distinction is the whole point of Adjacency SIDs.",
  },
  {
    id: "troubleshooting-intro",
    label: "Incident",
    narrative: "IP reachability to R6 is healthy. IGP adjacency state is healthy. R6 Node SID forwarding works. A new segment list intended to force R3→R5 fails immediately from R1.",
    run: (state) => ({ state: { ...state, troubleshooting: { ...state.troubleshooting, started: true }, packet: undefined, packetAt: undefined, journey: [], segmentList: undefined, fault: undefined }, events: [] }),
  },
  {
    id: "predict-r1-interpret-adjsid",
    label: "Predict",
    narrative: "The incorrect stack at R1 is: [Adj-SID R3→R5, R6 Node SID] — skipping the R3 Node SID entirely.",
    question: {
      prompt: "Can R1 directly interpret R3's ordinary locally-significant Adj-SID as an instruction to first travel to R3?",
      options: [
        { id: "no", label: "No — a local Adj-SID has no meaning at a router that doesn't own it" },
        { id: "yes", label: "Yes — every SID in the domain is understood by every router" },
      ],
      correctOptionId: "no",
      explanation: "SID 24035 exists in the SR domain, but that doesn't make it globally interpretable. Its owner is R3 and its scope is local — R1 cannot reinterpret it as \"first go to R3.\"",
    },
  },
  {
    id: "fault-send",
    label: "Send The Incorrect Stack",
    narrative: `The incorrect stack: [${R3_R5_ADJ_SID.label}, ${R6_LABEL}] — someone skipped the R3 Node SID.`,
    packet: () => ({ id: "ip-fault", protocol: "IP", from: "R1", to: "R1", summary: "Packet classified for the incorrect (owner-mismatched) segment list", layers: [ipLayer(HOST_BEHIND_R1, HOST_BEHIND_R6)] }),
    run: (state) => ({
      state: { ...state, segmentList: buildSegmentList([{ type: "ADJ", adjId: R3_R5_ADJ_SID.id }, { type: "NODE", target: "R6" }], state.prefixSids, state.adjSids), packet: { labels: [], srcIp: HOST_BEHIND_R1, dstIp: HOST_BEHIND_R6 }, packetAt: "R1", journey: [] },
      events: [],
    }),
  },
  {
    id: "fault-r1-invalid",
    label: "R1: Active SID Not Owned Here",
    narrative: `R1 attempts to impose the active segment (${R3_R5_ADJ_SID.label}, owned by R3). Its own LFIB has no entry for executing a foreign local Adj-SID as an instruction — this SID exists in the domain, but not here.`,
    packet: (state) => {
      if (!state.packet) return undefined;
      const pkt = pushLabel(pushLabel(state.packet, R6_LABEL), R3_R5_ADJ_SID.label);
      return mplsPacket("fault-drop", "R1", "R1", "active SID not owned/valid here", "INVALID_SID", pkt);
    },
    run: (state) => {
      const validation = state.segmentList ? validateSegmentList(state.segmentList, "R1") : { valid: true };
      return {
        state: { ...state, fault: { reason: validation.reason ?? "Invalid segment list." }, journey: [...state.journey, { router: "R1", input: fmtLabel(R3_R5_ADJ_SID.label), lookup: `Local LFIB: no entry — owner=R3, scope=LOCAL, not valid at R1`, action: "INVALID_SID", output: "DROPPED" }] },
        events: [{ type: "MPLS_LSP_CHANGED", stepId: "fault-r1-invalid", timestamp: Date.now(), message: "Segment list rejected at R1 — active Adj-SID not owned here" }],
      };
    },
    whatChanged: () => ["Packet dropped at R1 — active SID owned by R3, not R1"],
  },
  {
    id: "diagnostic-ladder",
    label: "Diagnostic Ladder",
    narrative: "Physical links, IGP, SR capability, R6's Prefix-SID, and Node-SID forwarding are all healthy. The segment list was received and the active SID does exist in the domain — but it isn't owned by R1, so its scope isn't valid here, execution fails, and nothing is delivered.",
  },
  {
    id: "repair-challenge",
    label: "Apply The Fix",
    narrative: "Choose the correct repair to restore the R3→R5-forcing segment list.",
    action: (state, payload) => {
      const choice = typeof payload === "object" && payload !== null && "choice" in payload ? String((payload as { choice: string }).choice) : "";
      const correct = choice === "correct-segment-list";
      return { state: { ...state, troubleshooting: { ...state.troubleshooting, repairAttempt: { choice, correct } } }, events: [] };
    },
    requiresState: (state) => state.troubleshooting.repairAttempt?.correct === true,
  },
  {
    id: "repaired-send",
    label: "Send With The Correct Segment List",
    narrative: `Correct stack: [${R3_LABEL}, ${R3_R5_ADJ_SID.label}, ${R6_LABEL}].`,
    packet: () => ({ id: "ip-repaired", protocol: "IP", from: "R1", to: "R1", summary: "Packet classified for the corrected segment list", layers: [ipLayer(HOST_BEHIND_R1, HOST_BEHIND_R6)] }),
    run: (state) => ({
      state: { ...state, segmentList: buildSegmentList([{ type: "NODE", target: "R3" }, { type: "ADJ", adjId: R3_R5_ADJ_SID.id }, { type: "NODE", target: "R6" }], state.prefixSids, state.adjSids), packet: { labels: [], srcIp: HOST_BEHIND_R1, dstIp: HOST_BEHIND_R6 }, packetAt: "R1", journey: [], fault: undefined },
      events: [],
    }),
  },
  {
    id: "repaired-r1-push",
    label: "R1: PUSH Correct Stack",
    narrative: "R1 imposes the correct three labels, active segment on top.",
    packet: (state) => {
      if (!state.packet) return undefined;
      let pkt = pushLabel(state.packet, R6_LABEL);
      pkt = pushLabel(pkt, R3_R5_ADJ_SID.label);
      pkt = pushLabel(pkt, R3_LABEL);
      return mplsPacket("repaired-push", "R1", "R3", "impose corrected segment stack", "PUSH", pkt);
    },
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      let pkt = pushLabel(state.packet, R6_LABEL);
      pkt = pushLabel(pkt, R3_R5_ADJ_SID.label);
      pkt = pushLabel(pkt, R3_LABEL);
      return { state: { ...state, packet: pkt, packetAt: "R3", journey: [...state.journey, { router: "R1", input: "IP", lookup: `Segment list: [${R3_LABEL}, ${R3_R5_ADJ_SID.label}, ${R6_LABEL}]`, action: "PUSH", output: `${fmtLabel(R3_LABEL)} / ${fmtLabel(R3_R5_ADJ_SID.label)} / ${fmtLabel(R6_LABEL)}` }] }, events: [] };
    },
  },
  {
    id: "repaired-r3-complete",
    label: "R3: Node SID R3 Completes",
    narrative: "R3 is the target of the active segment and completes it on arrival.",
    packet: (state) => (state.packet ? mplsPacket("repaired-r3-complete", "R3", "R3", "Node SID R3 self-completes", "POP", popTopLabel(state.packet)) : undefined),
    run: (state) => {
      if (!state.packet || !state.segmentList) return { state, events: [] };
      return { state: { ...state, packet: popTopLabel(state.packet), segmentList: advanceSegmentList(state.segmentList), journey: [...state.journey, { router: "R3", input: fmtLabel(R3_LABEL), lookup: "Active SID = R3 Node SID; R3 is the target", action: "POP", output: fmtLabel(R3_R5_ADJ_SID.label) }] }, events: [] };
    },
  },
  {
    id: "repaired-r3-adj",
    label: "R3: Execute Local Adjacency SID",
    narrative: "This time, R3 legitimately owns the active Adj-SID — it resolves R3→R5 and forwards over that exact link.",
    packet: (state) => (state.packet ? mplsPacket("repaired-r3-adj", "R3", "R5", "resolve R3→R5 adjacency", "POP_AND_FORWARD_ADJ", popTopLabel(state.packet)) : undefined),
    run: (state) => {
      if (!state.packet || !state.segmentList) return { state, events: [] };
      return { state: { ...state, packet: popTopLabel(state.packet), packetAt: "R5", segmentList: advanceSegmentList(state.segmentList), journey: [...state.journey, { router: "R3", input: fmtLabel(R3_R5_ADJ_SID.label), lookup: "SID owner = R3 (local); type = adjacency; resolve R3→R5", action: "POP_AND_FORWARD_ADJ", output: `${fmtLabel(R6_LABEL)} → via R3→R5` }] }, events: [] };
    },
  },
  {
    id: "repaired-r5-continue",
    label: "R5: CONTINUE Toward R6",
    narrative: "R5 forwards the final segment toward R6.",
    packet: (state) => (state.packet ? mplsPacket("repaired-r5-continue", "R5", "R6", "forward toward R6 (unchanged)", "CONTINUE", state.packet) : undefined),
    run: (state) => ({ state: { ...state, packetAt: "R6", journey: [...state.journey, { router: "R5", input: fmtLabel(R6_LABEL), lookup: "Active SID = R6 Node SID; shortest path is directly connected", action: "CONTINUE", output: fmtLabel(R6_LABEL) }] }, events: [] }),
  },
  {
    id: "repaired-r6-pop",
    label: "R6: Final Segment Completes",
    narrative: "R6 pops its own last label, exposing the IP packet.",
    packet: (state) => (state.packet ? mplsPacket("repaired-r6-pop", "R6", "R6", "final segment self-completes", "POP", popTopLabel(state.packet)) : undefined),
    run: (state) => {
      if (!state.packet || !state.segmentList) return { state, events: [] };
      return { state: { ...state, packet: popTopLabel(state.packet), segmentList: advanceSegmentList(state.segmentList), journey: [...state.journey, { router: "R6", input: fmtLabel(R6_LABEL), lookup: "Active SID = R6 Node SID; R6 is the target", action: "POP", output: "IP (unlabeled)" }] }, events: [] };
    },
  },
  {
    id: "repaired-r6-deliver",
    label: "R6 Delivers — Fix Verified",
    narrative: "R6 delivers the packet. Path taken: R1 → R3 → R5 → R6 — the R3→R5 link was used, exactly as required.",
    packet: (state) => (state.packet ? { id: "delivered-repaired", protocol: "IP", from: "R6", to: "R6", summary: "Delivered via corrected segment list", layers: buildPacketLayers(state.packet) } : undefined),
    run: (state) => ({ state: { ...state, troubleshooting: { ...state.troubleshooting, correctListVerified: true }, journey: [...state.journey, { router: "R6", input: "IP", lookup: "IP delivery", action: "IP_FORWARD", output: "Delivered" }] }, events: [] }),
    whatChanged: () => ["Delivered R1 → R3 → R5 → R6 — repair verified"],
  },
  {
    id: "engineer-challenge",
    label: "Engineer Challenge — Program The Path",
    narrative: "Deliver traffic from R1 to R6. Traffic must pass through R3, specifically use the R3→R5 link, then reach R6.",
  },
  {
    id: "complete",
    label: "Lesson Complete",
    narrative: "You built and steered a real SR-MPLS segment list — Node SID, Adjacency SID, SRGB, scope, and the segment stack that ties them together.",
  },
];

export const STEP_IDX = {
  predictIgpForwarding: stepIdx(srMplsSteps, "predict-igp-forwarding"),
  segmentIntro: stepIdx(srMplsSteps, "segment-intro"),
  srgbIntro: stepIdx(srMplsSteps, "srgb-intro"),
  sidDatabaseIntro: stepIdx(srMplsSteps, "sid-database-intro"),
  sendNodeSidR6: stepIdx(srMplsSteps, "send-node-sid-r6"),
  metricChangeIntro: stepIdx(srMplsSteps, "metric-change-intro"),
  changeMetric: stepIdx(srMplsSteps, "change-metric"),
  metricRestore: stepIdx(srMplsSteps, "metric-restore"),
  adjsidIntro: stepIdx(srMplsSteps, "adjsid-intro"),
  buildSegmentListIntro: stepIdx(srMplsSteps, "build-segment-list-intro"),
  segmentListViewerIntro: stepIdx(srMplsSteps, "segment-list-viewer-intro"),
  viewsIntro: stepIdx(srMplsSteps, "views-intro"),
  segmentLabIntro: stepIdx(srMplsSteps, "segment-lab-intro"),
  troubleshootingIntro: stepIdx(srMplsSteps, "troubleshooting-intro"),
  diagnosticLadder: stepIdx(srMplsSteps, "diagnostic-ladder"),
  repairChallenge: stepIdx(srMplsSteps, "repair-challenge"),
  engineerChallenge: stepIdx(srMplsSteps, "engineer-challenge"),
};

function stepIdx(steps: ScenarioStep<SrMplsState>[], id: string): number {
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

export function buildSrCliCommands(state: SrMplsState, router: RouterId): CliCommandEntry[] {
  const prefixSid = state.prefixSids.find((p) => p.router === router);
  const ownedAdj = state.adjSids.filter((a) => a.owner === router);
  const sidDb: CliCommandEntry = {
    id: "sid-db",
    label: "sid database",
    cisco: {
      cmd: "show segment-routing mpls connected-prefix-sid-map",
      output: `Prefix ${ROUTER_LOOPBACK[router]}\n  SID Index: ${prefixSid?.index}\n  Local Label: ${prefixSid?.label}\n  Algorithm: SPF\n\nLocal Adjacency SIDs:\n${ownedAdj.length ? ownedAdj.map((a) => `  ${a.owner}->${a.neighbor}: ${a.label} (local)`).join("\n") : "  (none)"}`,
    },
    juniper: {
      cmd: "show route table inet.3 label-switched-path segment-routing",
      output: `Prefix-SID: ${prefixSid?.index}, Label: ${prefixSid?.label}\nAdjacency-SIDs: ${ownedAdj.length ? ownedAdj.map((a) => a.label).join(", ") : "none"}`,
    },
  };
  const segList: CliCommandEntry = {
    id: "segment-list",
    label: "segment list",
    cisco: {
      cmd: "show sr-te policy detail",
      output: state.segmentList ? `Segment List:\n${state.segmentList.map((s) => `  ${s.completed ? "[done]" : s.active ? "[active]" : "[pending]"} ${s.type} SID ${s.sid} — ${s.explanation}`).join("\n")}` : "No segment list active.",
    },
    juniper: {
      cmd: "show spring-traffic-engineering lsp",
      output: state.segmentList ? state.segmentList.map((s) => `${s.sid} ${s.type} ${s.active ? "(active)" : s.completed ? "(complete)" : ""}`).join("\n") : "no segment list",
    },
  };
  const fwd: CliCommandEntry = {
    id: "forwarding",
    label: "forwarding",
    cisco: {
      cmd: "show mpls forwarding-table",
      output: state.packet && state.packet.labels.length ? `Local label: ${fmtLabel(state.packet.labels[0].value)}\nOutgoing label: ${state.packet.labels[1] ? fmtLabel(state.packet.labels[1].value) : "pop"}` : "no active label",
    },
    juniper: {
      cmd: "show route table mpls.0",
      output: state.packet && state.packet.labels.length ? `${fmtLabel(state.packet.labels[0].value)}    Pop/Swap` : "empty",
    },
  };
  return [sidDb, segList, fwd];
}
