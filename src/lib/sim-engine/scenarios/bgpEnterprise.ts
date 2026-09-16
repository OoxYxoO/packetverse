import type { PacketLayer, PacketVisual, ScenarioStep } from "../types";

/**
 * BGP — ENTERPRISE MULTIHOMING (eBGP + iBGP)
 *
 *                        AS65030 (destination)
 *                        203.0.113.0/24
 *                         /            \
 *                    R3 (ISP-A)     R4 (ISP-B)
 *                    AS65010        AS65020
 *                        |              |
 *                      eBGP           eBGP
 *                        |              |
 *                       R1 ---------- R2
 *                            iBGP
 *                          AS65001 (enterprise)
 *
 * Scope (see brief §25 "Important scope rule"): TCP/179, the BGP FSM,
 * eBGP + iBGP, OPEN/KEEPALIVE/UPDATE, NLRI/NEXT_HOP/AS_PATH/LOCAL_PREF,
 * a basic MED explanation, a deliberately simplified best-path subset,
 * route installation, AS-path prepending, and one NEXT_HOP fault.
 * Explicitly deferred: route reflectors, confederations, MP-BGP/VPNv4,
 * communities, Add-Path, ORR, PIC, graceful restart, BFD, FlowSpec,
 * EVPN, large communities, RPKI.
 *
 * Pure data + pure functions only — see /lib/sim-engine/types.ts for
 * why (no React, no DOM here; components only render what this file
 * computes).
 */

export type RouterId = "R1" | "R2" | "R3" | "R4";
export type IspId = "ISP-A" | "ISP-B";

export const ROUTER_IDS: Record<RouterId, string> = { R1: "1.1.1.1", R2: "2.2.2.2", R3: "3.3.3.3", R4: "4.4.4.4" };
export const ROUTER_AS: Record<RouterId, number> = { R1: 65001, R2: 65001, R3: 65010, R4: 65020 };
export const ROUTER_LABEL: Record<RouterId, string> = { R1: "R1", R2: "R2", R3: "R3 (ISP-A)", R4: "R4 (ISP-B)" };
export const DEST_PREFIX = "203.0.113.0/24";
export const DEST_AS = 65030;

/** Directly-connected interface IPs, per router, toward each peer. */
export const IFACE_IP: Record<RouterId, Partial<Record<RouterId, string>>> = {
  R1: { R3: "192.0.2.1", R2: "10.0.12.1" },
  R3: { R1: "192.0.2.2" },
  R2: { R4: "198.51.100.1", R1: "10.0.12.2" },
  R4: { R2: "198.51.100.2" },
};

/** What each enterprise router can resolve directly (its own connected subnets only). */
const KNOWN_REACHABLE: Record<RouterId, string[]> = {
  R1: ["192.0.2.2", "10.0.12.1", "10.0.12.2"],
  R2: ["198.51.100.2", "10.0.12.1", "10.0.12.2"],
  R3: ["192.0.2.1"],
  R4: ["198.51.100.1"],
};

export type BgpSessionState = "IDLE" | "CONNECT" | "ACTIVE" | "OPENSENT" | "OPENCONFIRM" | "ESTABLISHED";
export const BGP_STATE_ORDER: BgpSessionState[] = ["IDLE", "CONNECT", "ACTIVE", "OPENSENT", "OPENCONFIRM", "ESTABLISHED"];
/** ACTIVE is legitimately skipped whenever the first TCP connection attempt succeeds — see brief §4. */
export const BGP_STATE_VISITED_ORDER: BgpSessionState[] = ["IDLE", "CONNECT", "OPENSENT", "OPENCONFIRM", "ESTABLISHED"];
export const BGP_STATE_LABEL: Record<BgpSessionState, string> = {
  IDLE: "Idle",
  CONNECT: "Connect",
  ACTIVE: "Active",
  OPENSENT: "OpenSent",
  OPENCONFIRM: "OpenConfirm",
  ESTABLISHED: "Established",
};
export const BGP_STATE_INFO: Record<BgpSessionState, { meaning: string; why: string; next: string }> = {
  IDLE: {
    meaning: "No session exists yet — BGP is refusing all incoming connections.",
    why: "This is the starting state before any peering has been configured or attempted.",
    next: "BGP initiates a TCP connection to the peer, moving to Connect.",
  },
  CONNECT: {
    meaning: "BGP is waiting for the underlying TCP connection to complete.",
    why: "OPEN messages can't be sent until TCP itself is established — BGP runs on top of TCP port 179.",
    next: "Once TCP completes the three-way handshake, BGP sends its OPEN message and moves to OpenSent.",
  },
  ACTIVE: {
    meaning: "The TCP connection attempt failed, and BGP is retrying.",
    why: "This state only appears when the initial TCP SYN doesn't succeed — a firewall block, wrong IP, or the peer not listening.",
    next: "On a successful retry, BGP proceeds to OpenSent — exactly as if it had gone straight there. In this lesson TCP connects on the first try, so Active is never entered.",
  },
  OPENSENT: {
    meaning: "This router has sent its OPEN message and is waiting for the peer's OPEN in return.",
    why: "Each side must exchange OPEN messages — AS number, BGP Identifier, and Hold Time — before either can trust the session.",
    next: "Once the peer's OPEN is received and accepted, BGP moves to OpenConfirm.",
  },
  OPENCONFIRM: {
    meaning: "Both OPEN messages have been exchanged and accepted; BGP is waiting for a KEEPALIVE to confirm the session is alive.",
    why: "Exchanging OPEN proves both sides agree on the basics — it doesn't yet prove the session will stay up.",
    next: "Receiving a KEEPALIVE (or any valid update) completes the transition to Established.",
  },
  ESTABLISHED: {
    meaning: "The BGP session is fully up — UPDATE messages can now be exchanged.",
    why: "Both peers have confirmed identity (OPEN) and liveness (KEEPALIVE).",
    next: "Routes are exchanged via UPDATE messages and processed through the best-path decision process.",
  },
};

export type TcpState = "CLOSED" | "SYN_SENT" | "SYN_RECEIVED" | "ESTABLISHED";

export type SessionId = "R1-R3" | "R2-R4" | "R1-R2";
export const SESSIONS: Record<SessionId, { a: RouterId; b: RouterId; type: "eBGP" | "iBGP" }> = {
  "R1-R3": { a: "R1", b: "R3", type: "eBGP" },
  "R2-R4": { a: "R2", b: "R4", type: "eBGP" },
  "R1-R2": { a: "R1", b: "R2", type: "iBGP" },
};

interface SessionState {
  tcp: TcpState;
  bgp: BgpSessionState;
}

export interface ExternalPathDef {
  isp: IspId;
  viaRouter: RouterId;
  peerAs: number;
  /** AS_PATH as advertised by the ISP, origin AS last (e.g. [65010, 65030]). */
  asPathTail: number[];
  nextHopIp: string;
  localPref: number;
  med: number;
  origin: "IGP";
}

export interface BgpPathAttrs {
  nextHop: string;
  localPref: number;
  asPath: number[];
  med: number;
  origin: "IGP";
  peerType: "eBGP" | "iBGP";
}

export interface BgpPath {
  id: string;
  isp: IspId;
  label: string;
  advertisedBy: RouterId;
  attrs: BgpPathAttrs;
  valid: boolean;
  best: boolean;
  installed: boolean;
  nextHopReachable: boolean;
}

export type BestPathCriterionId = "LOCAL_PREF" | "AS_PATH_LENGTH" | "MED" | "EBGP_OVER_IBGP" | "ROUTER_ID";
export const BEST_PATH_CRITERIA_ORDER: BestPathCriterionId[] = ["LOCAL_PREF", "AS_PATH_LENGTH", "MED", "EBGP_OVER_IBGP", "ROUTER_ID"];
export const BEST_PATH_CRITERION_LABEL: Record<BestPathCriterionId, string> = {
  LOCAL_PREF: "Highest Local Preference",
  AS_PATH_LENGTH: "Shortest AS Path",
  MED: "Lowest MED (same neighboring AS only)",
  EBGP_OVER_IBGP: "Prefer eBGP-learned over iBGP-learned",
  ROUTER_ID: "Lowest advertising Router ID (tiebreaker)",
};

export interface DecisionCriterionValue {
  pathId: string;
  pathLabel: string;
  value: string;
  won: boolean;
}
export interface DecisionCriterion {
  id: BestPathCriterionId;
  label: string;
  values: DecisionCriterionValue[];
  applied: boolean;
  skippedReason?: string;
}

export interface BgpState {
  sessions: Record<SessionId, SessionState>;
  externalPaths: Record<IspId, ExternalPathDef>;
  nextHopSelf: boolean;
  bgpTables: Record<RouterId, BgpPath[]>;
  decisionTrace: Partial<Record<RouterId, DecisionCriterion[]>>;
  decidedBy: Partial<Record<RouterId, BestPathCriterionId>>;
  highlightedAs: number | null;
  challengeLocalPref?: number;
  challengeSucceeded?: boolean;
}

export function createBgpState(): BgpState {
  return {
    sessions: {
      "R1-R3": { tcp: "CLOSED", bgp: "IDLE" },
      "R2-R4": { tcp: "CLOSED", bgp: "IDLE" },
      "R1-R2": { tcp: "CLOSED", bgp: "IDLE" },
    },
    externalPaths: {
      "ISP-A": { isp: "ISP-A", viaRouter: "R3", peerAs: 65010, asPathTail: [65010, DEST_AS], nextHopIp: "192.0.2.2", localPref: 100, med: 50, origin: "IGP" },
      "ISP-B": { isp: "ISP-B", viaRouter: "R4", peerAs: 65020, asPathTail: [65020, 65100, DEST_AS], nextHopIp: "198.51.100.2", localPref: 100, med: 20, origin: "IGP" },
    },
    nextHopSelf: false,
    bgpTables: { R1: [], R2: [], R3: [], R4: [] },
    decisionTrace: {},
    decidedBy: {},
    highlightedAs: null,
  };
}

// ---------------------------------------------------------------------------
// Graph layout (position-only data for <GraphTopologyViewer>)
// ---------------------------------------------------------------------------

export const GRAPH_NODES = [
  { id: "DEST", label: "AS65030", x: 50, y: 8, subLabel: DEST_PREFIX, kind: "cloud" as const },
  { id: "R3", label: "R3", x: 22, y: 34, subLabel: ROUTER_IDS.R3 },
  { id: "R4", label: "R4", x: 78, y: 34, subLabel: ROUTER_IDS.R4 },
  { id: "R1", label: "R1", x: 36, y: 70, subLabel: ROUTER_IDS.R1 },
  { id: "R2", label: "R2", x: 64, y: 70, subLabel: ROUTER_IDS.R2 },
];

export const GRAPH_EDGES = [
  { id: "DEST-R3", a: "DEST", b: "R3" },
  { id: "DEST-R4", a: "DEST", b: "R4" },
  { id: "R1-R3", a: "R1", b: "R3", label: "eBGP" },
  { id: "R2-R4", a: "R2", b: "R4", label: "eBGP" },
  { id: "R1-R2", a: "R1", b: "R2", label: "iBGP" },
];

export const GRAPH_REGIONS = [
  { id: "as-65001", label: "AS 65001 — Enterprise", x: 22, y: 60, width: 56, height: 24, tone: "cyan" as const },
  { id: "as-65010", label: "AS 65010 — ISP-A", x: 8, y: 22, width: 28, height: 24, tone: "violet" as const },
  { id: "as-65020", label: "AS 65020 — ISP-B", x: 64, y: 22, width: 28, height: 24, tone: "violet" as const },
];

// ---------------------------------------------------------------------------
// Pure helpers — best-path selection is fully data-driven (brief §23):
// given any BgpPath[], compute the winner from attributes. Nothing
// here hardcodes "ISP-A always wins".
// ---------------------------------------------------------------------------

function fmtAsPath(asPath: number[]): string {
  return asPath.join(" ");
}

export function computeBestPath(paths: BgpPath[]): { bestId: string; decidedBy: BestPathCriterionId; criteria: DecisionCriterion[] } {
  const valid = paths.filter((p) => p.valid);
  const criteria: DecisionCriterion[] = [];
  let candidates = valid;
  let decidedBy: BestPathCriterionId = "ROUTER_ID";
  const neighborAs = (p: BgpPath) => p.attrs.asPath[0];
  const sameNeighborAs = valid.length > 0 && valid.every((p) => neighborAs(p) === neighborAs(valid[0]));

  const stepDefs: Record<BestPathCriterionId, { getValue: (p: BgpPath) => number; display: (p: BgpPath) => string }> = {
    LOCAL_PREF: { getValue: (p) => p.attrs.localPref, display: (p) => String(p.attrs.localPref) },
    AS_PATH_LENGTH: { getValue: (p) => -p.attrs.asPath.length, display: (p) => `${p.attrs.asPath.length} hop${p.attrs.asPath.length === 1 ? "" : "s"} (${fmtAsPath(p.attrs.asPath)})` },
    MED: { getValue: (p) => -p.attrs.med, display: (p) => String(p.attrs.med) },
    EBGP_OVER_IBGP: { getValue: (p) => (p.attrs.peerType === "eBGP" ? 1 : 0), display: (p) => p.attrs.peerType },
    ROUTER_ID: { getValue: (p) => -ridToNumber(ROUTER_IDS[p.advertisedBy]), display: (p) => ROUTER_IDS[p.advertisedBy] },
  };

  for (const critId of BEST_PATH_CRITERIA_ORDER) {
    if (candidates.length <= 1) {
      criteria.push({ id: critId, label: BEST_PATH_CRITERION_LABEL[critId], applied: false, skippedReason: "Already narrowed to a single candidate.", values: [] });
      continue;
    }
    if (critId === "MED" && !sameNeighborAs) {
      criteria.push({
        id: critId,
        label: BEST_PATH_CRITERION_LABEL[critId],
        applied: false,
        skippedReason: "MED is only meaningful between paths learned from the same neighboring AS — these come from different neighbors, so this step is skipped.",
        values: candidates.map((c) => ({ pathId: c.id, pathLabel: c.label, value: String(c.attrs.med), won: false })),
      });
      continue;
    }
    const { getValue, display } = stepDefs[critId];
    const values = candidates.map(getValue);
    const best = Math.max(...values);
    const winners = candidates.filter((c, i) => values[i] === best);
    const applied = winners.length < candidates.length;
    criteria.push({
      id: critId,
      label: BEST_PATH_CRITERION_LABEL[critId],
      applied,
      values: candidates.map((c, i) => ({ pathId: c.id, pathLabel: c.label, value: display(c), won: values[i] === best })),
    });
    if (applied) decidedBy = critId;
    candidates = winners;
  }

  return { bestId: candidates[0]?.id ?? "", decidedBy, criteria };
}

function ridToNumber(rid: string): number {
  return rid.split(".").reduce((acc, octet) => acc * 256 + Number(octet), 0);
}

function isReachable(router: RouterId, ip: string): boolean {
  return KNOWN_REACHABLE[router].includes(ip);
}

/** Rebuilds both enterprise routers' candidate BgpPath sets from the current external paths + next-hop-self policy. Resets best/installed — a later step re-evaluates them. */
function rebuildCandidates(state: BgpState): Record<RouterId, BgpPath[]> {
  const a = state.externalPaths["ISP-A"];
  const b = state.externalPaths["ISP-B"];

  const r1Direct: BgpPath = {
    id: "R1:ISP-A",
    isp: "ISP-A",
    label: "via ISP-A (direct eBGP)",
    advertisedBy: "R3",
    attrs: { nextHop: a.nextHopIp, localPref: a.localPref, asPath: a.asPathTail, med: a.med, origin: a.origin, peerType: "eBGP" },
    valid: state.bgpTables.R1.length > 0,
    best: false,
    installed: false,
    nextHopReachable: isReachable("R1", a.nextHopIp),
  };
  const r1Relayed: BgpPath = {
    id: "R1:ISP-B",
    isp: "ISP-B",
    label: "via ISP-B (iBGP-relayed from R2)",
    advertisedBy: "R2",
    attrs: { nextHop: state.nextHopSelf ? IFACE_IP.R2.R1! : b.nextHopIp, localPref: b.localPref, asPath: b.asPathTail, med: b.med, origin: b.origin, peerType: "iBGP" },
    valid: state.bgpTables.R1.length > 0,
    best: false,
    installed: false,
    nextHopReachable: isReachable("R1", state.nextHopSelf ? IFACE_IP.R2.R1! : b.nextHopIp),
  };

  const r2Direct: BgpPath = {
    id: "R2:ISP-B",
    isp: "ISP-B",
    label: "via ISP-B (direct eBGP)",
    advertisedBy: "R4",
    attrs: { nextHop: b.nextHopIp, localPref: b.localPref, asPath: b.asPathTail, med: b.med, origin: b.origin, peerType: "eBGP" },
    valid: state.bgpTables.R2.length > 0,
    best: false,
    installed: false,
    nextHopReachable: isReachable("R2", b.nextHopIp),
  };
  const r2Relayed: BgpPath = {
    id: "R2:ISP-A",
    isp: "ISP-A",
    label: "via ISP-A (iBGP-relayed from R1)",
    advertisedBy: "R1",
    attrs: { nextHop: state.nextHopSelf ? IFACE_IP.R1.R2! : a.nextHopIp, localPref: a.localPref, asPath: a.asPathTail, med: a.med, origin: a.origin, peerType: "iBGP" },
    valid: state.bgpTables.R2.length > 0,
    best: false,
    installed: false,
    nextHopReachable: isReachable("R2", state.nextHopSelf ? IFACE_IP.R1.R2! : a.nextHopIp),
  };

  return {
    R1: state.bgpTables.R1.length > 0 ? [r1Direct, r1Relayed].filter((p) => state.bgpTables.R1.some((existing) => existing.id === p.id)) : [],
    R2: state.bgpTables.R2.length > 0 ? [r2Direct, r2Relayed].filter((p) => state.bgpTables.R2.some((existing) => existing.id === p.id)) : [],
    R3: [],
    R4: [],
  };
}

function evaluateAndInstall(state: BgpState, router: RouterId, install: boolean): BgpState {
  const comparison = computeBestPath(state.bgpTables[router]);
  const paths = state.bgpTables[router].map((p) => ({
    ...p,
    best: p.id === comparison.bestId,
    installed: install && p.id === comparison.bestId,
  }));
  return {
    ...state,
    bgpTables: { ...state.bgpTables, [router]: paths },
    decisionTrace: { ...state.decisionTrace, [router]: comparison.criteria },
    decidedBy: { ...state.decidedBy, [router]: comparison.decidedBy },
  };
}

// ---------------------------------------------------------------------------
// Packet builders
// ---------------------------------------------------------------------------

function ipLayer(src: string, dst: string, proto: string): PacketLayer {
  return {
    name: "IPv4",
    color: "var(--pv-proto-ip)",
    fields: [
      { label: "Source IP", value: src },
      { label: "Destination IP", value: dst },
      { label: "Protocol", value: proto },
    ],
  };
}

function tcpLayer(fields: { label: string; value: string }[]): PacketLayer {
  return { name: "TCP", color: "var(--pv-proto-tcp)", fields };
}

function bgpOpenLayer(as: number, rid: string): PacketLayer {
  return {
    name: "BGP OPEN",
    color: "var(--pv-proto-bgp)",
    fields: [
      { label: "BGP Message Type", value: "OPEN" },
      { label: "Version", value: "4" },
      { label: "My AS", value: String(as) },
      { label: "Hold Time", value: "90" },
      { label: "BGP Identifier", value: rid },
    ],
  };
}

function bgpKeepaliveLayer(rid: string): PacketLayer {
  return {
    name: "BGP KEEPALIVE",
    color: "var(--pv-proto-bgp)",
    fields: [
      { label: "BGP Message Type", value: "KEEPALIVE" },
      { label: "BGP Identifier", value: rid },
      { label: "Length", value: "19 bytes (header only)" },
    ],
  };
}

function bgpUpdateLayer(path: BgpPathAttrs): PacketLayer {
  return {
    name: "BGP UPDATE",
    color: "var(--pv-proto-bgp)",
    fields: [
      { label: "BGP Message Type", value: "UPDATE" },
      { label: "NLRI", value: DEST_PREFIX },
      { label: "AS_PATH", value: fmtAsPath(path.asPath) },
      { label: "NEXT_HOP", value: path.nextHop },
      { label: "LOCAL_PREF", value: String(path.localPref) },
      { label: "MED", value: String(path.med) },
      { label: "ORIGIN", value: path.origin },
    ],
  };
}

function bgpPacket(id: string, from: RouterId, to: RouterId, summary: string, badge: string, layer: PacketLayer, ipProto = "179 (BGP over TCP)"): PacketVisual {
  return { id, protocol: "BGP", from, to, summary, badge, layers: [ipLayer(IFACE_IP[from]?.[to] ?? "", IFACE_IP[to]?.[from] ?? "", ipProto), layer] };
}

function tcpPacket(id: string, from: RouterId, to: RouterId, summary: string, fields: { label: string; value: string }[]): PacketVisual {
  return { id, protocol: "TCP", from, to, summary, badge: fields.find((f) => f.label === "Flags")?.value, layers: [ipLayer(IFACE_IP[from]?.[to] ?? "", IFACE_IP[to]?.[from] ?? "", "6 (TCP)"), tcpLayer(fields)] };
}

// ---------------------------------------------------------------------------
// Scenario steps
// ---------------------------------------------------------------------------

export const bgpSteps: ScenarioStep<BgpState>[] = [
  {
    id: "intro",
    label: "Mission Briefing",
    narrative:
      "R1 and R2 each know only their own connected networks — neither has any idea how to reach 203.0.113.0/24, a prefix that lives in a completely different autonomous system. An IGP like OSPF can't help here: it only runs inside AS65001. Reaching another AS's networks needs a protocol designed to exchange routes BETWEEN autonomous systems — that's BGP. R1 peers externally with ISP-A (eBGP), R2 peers externally with ISP-B (eBGP), and R1↔R2 run an internal session between themselves (iBGP) so each learns what the other knows.",
  },
  {
    id: "predict-need-bgp",
    label: "Predict",
    narrative: "Before introducing BGP by name:",
    question: {
      prompt: "How can an enterprise exchange Internet routes with another autonomous system?",
      options: [
        { id: "static", label: "Configure a static route to every possible destination" },
        { id: "bgp", label: "Run BGP with each external AS" },
        { id: "ospf", label: "Extend OSPF directly to ISP-A and ISP-B" },
        { id: "manual", label: "Manually coordinate updates by email" },
      ],
      correctOptionId: "bgp",
      explanation:
        "BGP (Border Gateway Protocol) is the protocol the Internet's autonomous systems use to exchange reachability with each other. An IGP like OSPF is built to run inside one AS — it has no concept of AS boundaries or inter-AS policy, which is exactly what BGP adds.",
    },
  },
  {
    id: "tcp-intro",
    label: "TCP Before BGP",
    narrative:
      "BGP doesn't run its own transport — it rides on top of a normal TCP connection, destination port 179. Right now: BGP session state is IDLE, and there's no TCP connection at all between R1 and R3.",
  },
  {
    id: "predict-tcp-first",
    label: "Predict",
    narrative: "Before any BGP message can be exchanged:",
    question: {
      prompt: "What must exist before BGP OPEN messages can be exchanged?",
      options: [
        { id: "udp", label: "A UDP session" },
        { id: "tcp", label: "A TCP session" },
        { id: "ospf-adj", label: "An OSPF adjacency" },
        { id: "cable", label: "Just a physical cable, nothing else" },
      ],
      correctOptionId: "tcp",
      explanation:
        "BGP messages (OPEN, KEEPALIVE, UPDATE, NOTIFICATION) are all carried inside a TCP connection on port 179. Without TCP up first, there's nothing for BGP to send its messages over.",
    },
  },
  {
    id: "tcp-syn",
    label: "TCP SYN",
    narrative: "R1 opens a TCP connection toward R3 on port 179.",
    packet: () => tcpPacket("tcp-syn", "R1", "R3", "SYN → port 179", [
      { label: "Source Port", value: "52001" },
      { label: "Destination Port", value: "179" },
      { label: "Flags", value: "SYN" },
    ]),
    run: (state) => ({
      state: { ...state, sessions: { ...state.sessions, "R1-R3": { ...state.sessions["R1-R3"], tcp: "SYN_SENT" } } },
      events: [{ type: "PACKET_SENT", stepId: "tcp-syn", timestamp: Date.now(), message: "R1 → R3 TCP SYN, port 179" }],
    }),
  },
  {
    id: "tcp-synack",
    label: "TCP SYN-ACK",
    narrative: "R3 replies, acknowledging the connection.",
    packet: () => tcpPacket("tcp-synack", "R3", "R1", "SYN-ACK", [
      { label: "Source Port", value: "179" },
      { label: "Destination Port", value: "52001" },
      { label: "Flags", value: "SYN, ACK" },
    ]),
    run: (state) => ({
      state: { ...state, sessions: { ...state.sessions, "R1-R3": { ...state.sessions["R1-R3"], tcp: "SYN_RECEIVED" } } },
      events: [{ type: "PACKET_RECEIVED", stepId: "tcp-synack", timestamp: Date.now(), message: "R1 receives SYN-ACK from R3" }],
    }),
  },
  {
    id: "tcp-ack",
    label: "TCP ACK",
    narrative: "R1 completes the handshake. TCP is now ESTABLISHED — BGP has a transport to run on.",
    packet: () => tcpPacket("tcp-ack", "R1", "R3", "ACK", [
      { label: "Source Port", value: "52001" },
      { label: "Destination Port", value: "179" },
      { label: "Flags", value: "ACK" },
    ]),
    run: (state) => ({
      state: { ...state, sessions: { ...state.sessions, "R1-R3": { ...state.sessions["R1-R3"], tcp: "ESTABLISHED" } } },
      events: [{ type: "PACKET_SENT", stepId: "tcp-ack", timestamp: Date.now(), message: "TCP session R1↔R3 established on port 179" }],
    }),
    whatChanged: () => ["R1↔R3 TCP: CLOSED → ESTABLISHED"],
  },
  {
    id: "bgp-connect",
    label: "BGP: IDLE → CONNECT",
    narrative:
      "With TCP up, BGP moves from Idle to Connect. (BGP also defines an Active state — used only if the initial TCP attempt fails and BGP has to retry. Since our TCP connected on the first try, Active is never entered.)",
    run: (state) => ({
      state: { ...state, sessions: { ...state.sessions, "R1-R3": { ...state.sessions["R1-R3"], bgp: "CONNECT" } } },
      events: [
        { type: "BGP_TCP_CONNECT_STARTED", stepId: "bgp-connect", timestamp: Date.now(), message: "R1 initiates TCP toward R3" },
        { type: "BGP_TCP_CONNECTED", stepId: "bgp-connect", timestamp: Date.now(), message: "TCP connected — BGP state IDLE → CONNECT" },
        { type: "BGP_STATE_CHANGED", stepId: "bgp-connect", timestamp: Date.now(), message: "R1↔R3 BGP: IDLE → CONNECT" },
      ],
    }),
  },
  {
    id: "bgp-open-r1",
    label: "OPEN (R1 → R3)",
    narrative: "R1 sends its OPEN message: its AS number, Hold Time, and BGP Identifier.",
    packet: () => bgpPacket("open-r1", "R1", "R3", "OPEN — AS65001, RID 1.1.1.1", "OPEN", bgpOpenLayer(ROUTER_AS.R1, ROUTER_IDS.R1)),
    run: (state) => ({
      state: { ...state, sessions: { ...state.sessions, "R1-R3": { ...state.sessions["R1-R3"], bgp: "OPENSENT" } } },
      events: [
        { type: "BGP_OPEN_SENT", stepId: "bgp-open-r1", timestamp: Date.now(), message: "R1 sends OPEN to R3" },
        { type: "BGP_STATE_CHANGED", stepId: "bgp-open-r1", timestamp: Date.now(), message: "R1↔R3 BGP: CONNECT → OPENSENT" },
      ],
    }),
  },
  {
    id: "predict-verify",
    label: "Predict",
    narrative: "R3 receives R1's OPEN message.",
    question: {
      prompt: "What information allows each peer to verify who it is establishing a BGP session with?",
      options: [
        { id: "ip-only", label: "Only the source IP address" },
        { id: "as-rid", label: "The AS number and BGP Identifier inside OPEN" },
        { id: "mac", label: "The physical MAC address" },
        { id: "password", label: "A shared password — always required" },
      ],
      correctOptionId: "as-rid",
      explanation:
        "OPEN carries the sender's AS number and BGP Identifier (a router-id), which the receiving router checks against its configured neighbor statement. Authentication (e.g. MD5) is optional and not required for a session to form — it isn't part of what identifies the peer here.",
    },
  },
  {
    id: "bgp-open-r3",
    label: "OPEN (R3 → R1)",
    narrative: "R3 replies with its own OPEN. Both sides have now exchanged identity — BGP moves to OpenConfirm.",
    packet: () => bgpPacket("open-r3", "R3", "R1", "OPEN — AS65010, RID 3.3.3.3", "OPEN", bgpOpenLayer(ROUTER_AS.R3, ROUTER_IDS.R3)),
    run: (state) => ({
      state: { ...state, sessions: { ...state.sessions, "R1-R3": { ...state.sessions["R1-R3"], bgp: "OPENCONFIRM" } } },
      events: [
        { type: "BGP_OPEN_RECEIVED", stepId: "bgp-open-r3", timestamp: Date.now(), message: "R1 receives R3's OPEN" },
        { type: "BGP_STATE_CHANGED", stepId: "bgp-open-r3", timestamp: Date.now(), message: "R1↔R3 BGP: OPENSENT → OPENCONFIRM" },
      ],
    }),
    whatChanged: () => ["R1↔R3 BGP state: OPENSENT → OPENCONFIRM"],
  },
  {
    id: "predict-keepalive",
    label: "Predict",
    narrative: "BGP is currently in OpenConfirm.",
    question: {
      prompt: "What message should complete the transition to Established?",
      options: [
        { id: "update", label: "UPDATE" },
        { id: "notification", label: "NOTIFICATION" },
        { id: "keepalive", label: "KEEPALIVE" },
        { id: "ack", label: "A plain TCP ACK" },
      ],
      correctOptionId: "keepalive",
      explanation:
        "KEEPALIVE confirms the session is alive and the peer accepted the OPEN. Once both sides have sent and received KEEPALIVE, the session moves to Established and UPDATE messages can flow.",
    },
  },
  {
    id: "bgp-keepalive",
    label: "KEEPALIVE — Established",
    narrative: "Both routers exchange KEEPALIVE. BGP SESSION ESTABLISHED.",
    packet: () => bgpPacket("keepalive-r1r3", "R1", "R3", "KEEPALIVE", "KEEPALIVE", bgpKeepaliveLayer(ROUTER_IDS.R1)),
    run: (state) => ({
      state: { ...state, sessions: { ...state.sessions, "R1-R3": { ...state.sessions["R1-R3"], bgp: "ESTABLISHED" } } },
      events: [
        { type: "BGP_KEEPALIVE_SENT", stepId: "bgp-keepalive", timestamp: Date.now(), message: "R1 → R3 KEEPALIVE" },
        { type: "BGP_KEEPALIVE_RECEIVED", stepId: "bgp-keepalive", timestamp: Date.now(), message: "R3 → R1 KEEPALIVE" },
        { type: "BGP_STATE_CHANGED", stepId: "bgp-keepalive", timestamp: Date.now(), message: "R1↔R3 BGP: OPENCONFIRM → ESTABLISHED" },
      ],
    }),
    whatChanged: () => ["R1↔R3 BGP session: ESTABLISHED"],
  },
  {
    id: "secondary-sessions",
    label: "The Other Sessions Form",
    narrative:
      "The identical TCP → OPEN → KEEPALIVE sequence happens independently on R2↔R4 (eBGP to ISP-B) and R1↔R2 (iBGP, inside AS65001) — you've already seen exactly how it works.",
    run: (state) => ({
      state: {
        ...state,
        sessions: {
          ...state.sessions,
          "R2-R4": { tcp: "ESTABLISHED", bgp: "ESTABLISHED" },
          "R1-R2": { tcp: "ESTABLISHED", bgp: "ESTABLISHED" },
        },
      },
      events: [
        { type: "BGP_STATE_CHANGED", stepId: "secondary-sessions", timestamp: Date.now(), message: "R2↔R4 BGP: IDLE → ESTABLISHED" },
        { type: "BGP_STATE_CHANGED", stepId: "secondary-sessions", timestamp: Date.now(), message: "R1↔R2 BGP: IDLE → ESTABLISHED (iBGP)" },
      ],
    }),
    whatChanged: () => ["R2↔R4 (eBGP) and R1↔R2 (iBGP) sessions: ESTABLISHED"],
  },
  {
    id: "update-r3",
    label: "UPDATE (R3 → R1)",
    narrative: "R3 has learned 203.0.113.0/24 from AS65030 and advertises it to R1.",
    packet: (state) => bgpPacket("update-r3", "R3", "R1", "UPDATE — 203.0.113.0/24", "UPDATE", bgpUpdateLayer({ nextHop: state.externalPaths["ISP-A"].nextHopIp, localPref: state.externalPaths["ISP-A"].localPref, asPath: state.externalPaths["ISP-A"].asPathTail, med: state.externalPaths["ISP-A"].med, origin: "IGP", peerType: "eBGP" })),
    run: (state) => {
      const a = state.externalPaths["ISP-A"];
      const path: BgpPath = {
        id: "R1:ISP-A",
        isp: "ISP-A",
        label: "via ISP-A (direct eBGP)",
        advertisedBy: "R3",
        attrs: { nextHop: a.nextHopIp, localPref: a.localPref, asPath: a.asPathTail, med: a.med, origin: a.origin, peerType: "eBGP" },
        valid: true,
        best: false,
        installed: false,
        nextHopReachable: isReachable("R1", a.nextHopIp),
      };
      return {
        state: { ...state, bgpTables: { ...state.bgpTables, R1: [path] } },
        events: [
          { type: "BGP_UPDATE_SENT", stepId: "update-r3", timestamp: Date.now(), message: "R3 advertises 203.0.113.0/24 to R1" },
          { type: "BGP_ROUTE_RECEIVED", stepId: "update-r3", timestamp: Date.now(), message: "R1 receives 203.0.113.0/24 via ISP-A" },
        ],
      };
    },
    whatChanged: () => ["R1 BGP table: +203.0.113.0/24 via ISP-A (received)"],
  },
  {
    id: "update-r4",
    label: "UPDATE (R4 → R2)",
    narrative: "R4 (ISP-B) advertises the same prefix to R2 — but its AS_PATH is one hop longer: it transits AS65100 on the way to AS65030.",
    packet: (state) => bgpPacket("update-r4", "R4", "R2", "UPDATE — 203.0.113.0/24", "UPDATE", bgpUpdateLayer({ nextHop: state.externalPaths["ISP-B"].nextHopIp, localPref: state.externalPaths["ISP-B"].localPref, asPath: state.externalPaths["ISP-B"].asPathTail, med: state.externalPaths["ISP-B"].med, origin: "IGP", peerType: "eBGP" })),
    run: (state) => {
      const b = state.externalPaths["ISP-B"];
      const path: BgpPath = {
        id: "R2:ISP-B",
        isp: "ISP-B",
        label: "via ISP-B (direct eBGP)",
        advertisedBy: "R4",
        attrs: { nextHop: b.nextHopIp, localPref: b.localPref, asPath: b.asPathTail, med: b.med, origin: b.origin, peerType: "eBGP" },
        valid: true,
        best: false,
        installed: false,
        nextHopReachable: isReachable("R2", b.nextHopIp),
      };
      return {
        state: { ...state, bgpTables: { ...state.bgpTables, R2: [path] } },
        events: [
          { type: "BGP_UPDATE_SENT", stepId: "update-r4", timestamp: Date.now(), message: "R4 advertises 203.0.113.0/24 to R2" },
          { type: "BGP_ROUTE_RECEIVED", stepId: "update-r4", timestamp: Date.now(), message: "R2 receives 203.0.113.0/24 via ISP-B" },
        ],
      };
    },
    whatChanged: () => ["R2 BGP table: +203.0.113.0/24 via ISP-B (received)"],
  },
  {
    id: "ibgp-share",
    label: "iBGP: R1 ↔ R2 Share Routes",
    narrative:
      "R1 and R2 advertise what they each learned externally to one another over their iBGP session — so both now have two candidate paths to the same prefix: their own direct eBGP path, and the other router's path relayed over iBGP.",
    run: (state) => {
      // rebuildCandidates() only refreshes ids that already exist in
      // bgpTables — since the relayed entries don't exist yet, build
      // them directly here instead.
      const a = state.externalPaths["ISP-A"];
      const b = state.externalPaths["ISP-B"];
      const r1Relayed: BgpPath = {
        id: "R1:ISP-B",
        isp: "ISP-B",
        label: "via ISP-B (iBGP-relayed from R2)",
        advertisedBy: "R2",
        attrs: { nextHop: state.nextHopSelf ? IFACE_IP.R2.R1! : b.nextHopIp, localPref: b.localPref, asPath: b.asPathTail, med: b.med, origin: b.origin, peerType: "iBGP" },
        valid: true,
        best: false,
        installed: false,
        nextHopReachable: isReachable("R1", state.nextHopSelf ? IFACE_IP.R2.R1! : b.nextHopIp),
      };
      const r2Relayed: BgpPath = {
        id: "R2:ISP-A",
        isp: "ISP-A",
        label: "via ISP-A (iBGP-relayed from R1)",
        advertisedBy: "R1",
        attrs: { nextHop: state.nextHopSelf ? IFACE_IP.R1.R2! : a.nextHopIp, localPref: a.localPref, asPath: a.asPathTail, med: a.med, origin: a.origin, peerType: "iBGP" },
        valid: true,
        best: false,
        installed: false,
        nextHopReachable: isReachable("R2", state.nextHopSelf ? IFACE_IP.R1.R2! : a.nextHopIp),
      };
      return {
        state: { ...state, bgpTables: { ...state.bgpTables, R1: [...state.bgpTables.R1, r1Relayed], R2: [...state.bgpTables.R2, r2Relayed] } },
        events: [
          { type: "BGP_UPDATE_SENT", stepId: "ibgp-share", timestamp: Date.now(), message: "R1 → R2 iBGP UPDATE: ISP-A path" },
          { type: "BGP_UPDATE_RECEIVED", stepId: "ibgp-share", timestamp: Date.now(), message: "R2 → R1 iBGP UPDATE: ISP-B path" },
          { type: "BGP_ROUTE_RECEIVED", stepId: "ibgp-share", timestamp: Date.now(), message: "R1 and R2 each now hold 2 candidate paths" },
        ],
      };
    },
    whatChanged: () => ["R1 gains ISP-B's path (relayed via R2)", "R2 gains ISP-A's path (relayed via R1)"],
  },
  {
    id: "predict-bestpath-r1",
    label: "Predict",
    narrative: "R1 now has two valid paths to 203.0.113.0/24: via ISP-A (LOCAL_PREF 100, AS_PATH 65010 65030) and via ISP-B (LOCAL_PREF 100, AS_PATH 65020 65100 65030).",
    question: {
      prompt: "With Local Preference tied at 100, which path should R1 select as best?",
      options: [
        { id: "isp-a", label: "Via ISP-A — its AS_PATH is 2 hops vs. ISP-B's 3" },
        { id: "isp-b", label: "Via ISP-B" },
        { id: "tie", label: "Both — install them as a tie" },
        { id: "neither", label: "Neither — wait for a tiebreaker attribute" },
      ],
      correctOptionId: "isp-a",
      explanation: "With LOCAL_PREF tied, BGP moves to the next criterion: AS_PATH length. ISP-A's path is shorter (2 AS hops vs. 3), so it wins.",
    },
  },
  {
    id: "bestpath-r1",
    label: "R1 Evaluates Paths",
    narrative: "R1 runs its best-path process over both candidates.",
    run: (state) => ({
      state: evaluateAndInstall(state, "R1", false),
      events: [
        { type: "BGP_PATH_EVALUATED", stepId: "bestpath-r1", timestamp: Date.now(), message: "R1 compares LOCAL_PREF, then AS_PATH length" },
        { type: "BGP_BEST_PATH_CHANGED", stepId: "bestpath-r1", timestamp: Date.now(), message: "R1 best path: via ISP-A" },
      ],
    }),
  },
  {
    id: "install-r1",
    label: "R1 Installs The Route",
    narrative: "R1's best path — via ISP-A — is installed into its routing table.",
    run: (state) => ({
      state: evaluateAndInstall(state, "R1", true),
      events: [{ type: "BGP_ROUTE_INSTALLED", stepId: "install-r1", timestamp: Date.now(), message: "R1 installs 203.0.113.0/24 via ISP-A" }],
    }),
    whatChanged: () => ["R1 installs 203.0.113.0/24 via ISP-A (NEXT_HOP 192.0.2.2, directly reachable)"],
  },
  {
    id: "bestpath-r2",
    label: "R2 Evaluates Paths",
    narrative: "R2 faces the exact same kind of decision — its own direct path (ISP-B, 3 hops) vs. the relayed path (ISP-A, 2 hops) — and reaches the same conclusion, for the same reason: shorter AS_PATH.",
    run: (state) => ({
      state: evaluateAndInstall(state, "R2", false),
      events: [
        { type: "BGP_PATH_EVALUATED", stepId: "bestpath-r2", timestamp: Date.now(), message: "R2 compares LOCAL_PREF, then AS_PATH length" },
        { type: "BGP_BEST_PATH_CHANGED", stepId: "bestpath-r2", timestamp: Date.now(), message: "R2 best path: via ISP-A (relayed)" },
      ],
    }),
  },
  {
    id: "install-r2",
    label: "R2 Installs — But Watch NEXT_HOP",
    narrative:
      "R2 installs its best path — via ISP-A, relayed over iBGP from R1. But iBGP doesn't change NEXT_HOP by default: the route still points at 192.0.2.2, ISP-A's own interface. R2 has no connection to that subnet at all.",
    run: (state) => ({
      state: evaluateAndInstall(state, "R2", true),
      events: [{ type: "BGP_ROUTE_INSTALLED", stepId: "install-r2", timestamp: Date.now(), message: "R2 installs 203.0.113.0/24 via ISP-A (relayed) — NEXT_HOP unreachable" }],
    }),
    whatChanged: () => ["R2 installs 203.0.113.0/24 via ISP-A (relayed) — NEXT_HOP 192.0.2.2 is NOT reachable from R2"],
  },
  {
    id: "trouble-intro",
    label: "Troubleshoot",
    narrative:
      "Complaint: \"R2 can see 203.0.113.0/24 in BGP, but traffic cannot use the route correctly.\" Inspect the BGP table, the routing table, neighbor status, and the NEXT_HOP value before you answer.",
  },
  {
    id: "trouble-question",
    label: "Troubleshoot",
    narrative: "The BGP session is healthy and the prefix is present — something else is wrong.",
    question: {
      prompt: "What is preventing R2 from correctly using this route?",
      options: [
        { id: "session-down", label: "The BGP session to R1 is down" },
        { id: "nexthop", label: "The route's NEXT_HOP is unreachable from R2" },
        { id: "aspath-invalid", label: "The AS_PATH contains an invalid AS number" },
        { id: "localpref", label: "Local Preference is misconfigured" },
      ],
      correctOptionId: "nexthop",
      explanation:
        "Knowing a BGP prefix is not enough — the router also has to be able to resolve the route's NEXT_HOP to a directly reachable path. Here, R1 relayed the ISP-A path to R2 over iBGP without rewriting NEXT_HOP, so R2 is holding a route that points at an address it has no connectivity to.",
      hints: [
        "Hint 1: Check whether the BGP session itself is healthy.",
        "Hint 2: Compare the prefix with its NEXT_HOP value.",
        "Hint 3: Can R2 actually resolve/reach that NEXT_HOP?",
      ],
    },
  },
  {
    id: "trouble-fix",
    label: "Apply next-hop-self",
    narrative: "The fix: configure next-hop-self on R1 and R2's iBGP session, so each rewrites NEXT_HOP to itself before relaying an externally-learned route to the other.",
    run: (state) => {
      const withPolicy = { ...state, nextHopSelf: true };
      const rebuilt = rebuildCandidates({ ...withPolicy, bgpTables: { R1: withPolicy.bgpTables.R1, R2: withPolicy.bgpTables.R2, R3: [], R4: [] } });
      const merged: BgpState = {
        ...withPolicy,
        bgpTables: {
          R1: withPolicy.bgpTables.R1.map((p) => (rebuilt.R1.find((r) => r.id === p.id) ? { ...rebuilt.R1.find((r) => r.id === p.id)!, best: p.best, installed: p.installed } : p)),
          R2: withPolicy.bgpTables.R2.map((p) => (rebuilt.R2.find((r) => r.id === p.id) ? { ...rebuilt.R2.find((r) => r.id === p.id)!, best: p.best, installed: p.installed } : p)),
          R3: [],
          R4: [],
        },
      };
      return {
        state: merged,
        events: [{ type: "BGP_ATTRIBUTE_CHANGED", stepId: "trouble-fix", timestamp: Date.now(), message: "next-hop-self applied on R1 and R2's iBGP session" }],
      };
    },
    whatChanged: (prev, next) => {
      const before = prev.bgpTables.R2.find((p) => p.id === "R2:ISP-A");
      const after = next.bgpTables.R2.find((p) => p.id === "R2:ISP-A");
      return [`R2's route NEXT_HOP: ${before?.attrs.nextHop} (unreachable) → ${after?.attrs.nextHop} (R1, directly connected)`, "Route usable."];
    },
  },
  {
    id: "prepend-intro",
    label: "AS-Path Prepending",
    narrative:
      "AS-path prepending is a way a network makes its own advertised path look artificially longer — commonly used to influence how OTHER networks prefer paths back toward it (an inbound-influence tool). It doesn't guarantee traffic behavior globally; it just makes one path look less attractive by the AS_PATH-length metric.",
  },
  {
    id: "prepend-apply",
    label: "ISP-B Prepends",
    narrative: "Watch what happens if the path from ISP-B arrives with its AS number prepended twice more.",
    run: (state) => {
      const b = state.externalPaths["ISP-B"];
      const prepended = { ...b, asPathTail: [b.peerAs, b.peerAs, ...b.asPathTail] };
      const withPaths = { ...state, externalPaths: { ...state.externalPaths, "ISP-B": prepended } };
      const rebuilt = rebuildCandidates(withPaths);
      const merged: BgpState = {
        ...withPaths,
        bgpTables: {
          R1: withPaths.bgpTables.R1.map((p) => rebuilt.R1.find((r) => r.id === p.id) ?? p),
          R2: withPaths.bgpTables.R2.map((p) => rebuilt.R2.find((r) => r.id === p.id) ?? p),
          R3: [],
          R4: [],
        },
      };
      let afterR1 = evaluateAndInstall(merged, "R1", true);
      afterR1 = evaluateAndInstall(afterR1, "R2", true);
      return {
        state: afterR1,
        events: [
          { type: "BGP_ATTRIBUTE_CHANGED", stepId: "prepend-apply", timestamp: Date.now(), message: "ISP-B's AS_PATH prepended: 65020 added twice more" },
          { type: "BGP_PATH_EVALUATED", stepId: "prepend-apply", timestamp: Date.now(), message: "Best path re-evaluated on R1 and R2" },
        ],
      };
    },
    whatChanged: (prev, next) => [
      `ISP-B AS_PATH: ${fmtAsPath(prev.externalPaths["ISP-B"].asPathTail)} → ${fmtAsPath(next.externalPaths["ISP-B"].asPathTail)}`,
      "Best path unchanged — ISP-A was already shorter, and now the gap is wider.",
    ],
  },
  {
    id: "localpref-intro",
    label: "Local Preference",
    narrative:
      "Local Preference is different from prepending: it's an attribute exchanged only inside the AS via iBGP, generally used to influence which path the AS as a whole prefers OUTBOUND. It's compared before AS_PATH — a high enough LOCAL_PREF can override a shorter path.",
  },
  {
    id: "localpref-change",
    label: "Policy Changed: ISP-B Local Pref → 200",
    narrative: "Set ISP-B's Local Preference to 200. Watch the whole decision — and the routing table — change.",
    run: (state) => {
      const withPolicy = { ...state, externalPaths: { ...state.externalPaths, "ISP-B": { ...state.externalPaths["ISP-B"], localPref: 200 } } };
      const rebuilt = rebuildCandidates(withPolicy);
      const merged: BgpState = {
        ...withPolicy,
        bgpTables: {
          R1: withPolicy.bgpTables.R1.map((p) => rebuilt.R1.find((r) => r.id === p.id) ?? p),
          R2: withPolicy.bgpTables.R2.map((p) => rebuilt.R2.find((r) => r.id === p.id) ?? p),
          R3: [],
          R4: [],
        },
      };
      let after = evaluateAndInstall(merged, "R1", true);
      after = evaluateAndInstall(after, "R2", true);
      return {
        state: after,
        events: [
          { type: "BGP_POLICY_APPLIED", stepId: "localpref-change", timestamp: Date.now(), message: "Local Preference policy applied: ISP-B → 200" },
          { type: "BGP_ATTRIBUTE_CHANGED", stepId: "localpref-change", timestamp: Date.now(), message: "ISP-B LOCAL_PREF: 100 → 200" },
          { type: "BGP_PATH_EVALUATED", stepId: "localpref-change", timestamp: Date.now(), message: "Best-path process reruns, LOCAL_PREF compared first" },
          { type: "BGP_BEST_PATH_CHANGED", stepId: "localpref-change", timestamp: Date.now(), message: "New best path: via ISP-B" },
          { type: "BGP_ROUTE_INSTALLED", stepId: "localpref-change", timestamp: Date.now(), message: "Routing table updated" },
        ],
      };
    },
    whatChanged: (prev, next) => {
      const prevBest = prev.bgpTables.R1.find((p) => p.best);
      const nextBest = next.bgpTables.R1.find((p) => p.best);
      return [
        `BEFORE — Best Path: R1 → ${prevBest?.isp}, Local Preference ${prevBest?.attrs.localPref}`,
        `AFTER — Best Path: R1 → ${nextBest?.isp}, Local Preference ${nextBest?.attrs.localPref}`,
        "Why: LOCAL_PREF is considered before AS_PATH in this decision process — a higher-priority attribute overrides a shorter AS path.",
      ];
    },
  },
  {
    id: "challenge-intro",
    label: "Engineer Challenge",
    narrative:
      "Traffic Engineering Challenge — Local Preference resets to 100/100 and the AS_PATH prepend is cleared, so ISP-A is the best path again. Your task: make AS65001 prefer ISP-B for 203.0.113.0/24 — without shutting any interface.",
    run: (state) => {
      const reset = {
        ...state,
        externalPaths: {
          "ISP-A": { ...state.externalPaths["ISP-A"], localPref: 100 },
          "ISP-B": { ...state.externalPaths["ISP-B"], localPref: 100, asPathTail: [65020, 65100, DEST_AS] },
        },
        challengeLocalPref: 100,
        challengeSucceeded: false,
      };
      const rebuilt = rebuildCandidates(reset);
      const merged: BgpState = {
        ...reset,
        bgpTables: {
          R1: reset.bgpTables.R1.map((p) => rebuilt.R1.find((r) => r.id === p.id) ?? p),
          R2: reset.bgpTables.R2.map((p) => rebuilt.R2.find((r) => r.id === p.id) ?? p),
          R3: [],
          R4: [],
        },
      };
      let after = evaluateAndInstall(merged, "R1", true);
      after = evaluateAndInstall(after, "R2", true);
      return { state: after, events: [{ type: "BGP_POLICY_APPLIED", stepId: "challenge-intro", timestamp: Date.now(), message: "Baseline restored: LOCAL_PREF 100/100, no prepend" }] };
    },
  },
  {
    id: "challenge",
    label: "Set ISP-B's Local Preference",
    narrative: "Pick a Local Preference for ISP-B. The engine re-evaluates immediately — try again if ISP-A still wins.",
    action: (state, payload) => {
      const localPref = typeof payload === "object" && payload !== null && "localPref" in payload ? Number((payload as { localPref: number }).localPref) : 100;
      const withPolicy = { ...state, externalPaths: { ...state.externalPaths, "ISP-B": { ...state.externalPaths["ISP-B"], localPref } } };
      const rebuilt = rebuildCandidates(withPolicy);
      const merged: BgpState = {
        ...withPolicy,
        bgpTables: {
          R1: withPolicy.bgpTables.R1.map((p) => rebuilt.R1.find((r) => r.id === p.id) ?? p),
          R2: withPolicy.bgpTables.R2.map((p) => rebuilt.R2.find((r) => r.id === p.id) ?? p),
          R3: [],
          R4: [],
        },
      };
      let after = evaluateAndInstall(merged, "R1", true);
      after = evaluateAndInstall(after, "R2", true);
      const bestIsp = after.bgpTables.R1.find((p) => p.best)?.isp;
      const succeeded = bestIsp === "ISP-B";
      return {
        state: { ...after, challengeLocalPref: localPref, challengeSucceeded: succeeded },
        events: [
          { type: "BGP_POLICY_APPLIED", stepId: "challenge", timestamp: Date.now(), message: `ISP-B Local Preference set to ${localPref}` },
          { type: "BGP_PATH_EVALUATED", stepId: "challenge", timestamp: Date.now(), message: "Best path re-evaluated" },
          { type: "BGP_ROUTE_INSTALLED", stepId: "challenge", timestamp: Date.now(), message: `R1 best path: ${bestIsp}` },
        ],
      };
    },
    requiresState: (state) => state.challengeSucceeded === true,
  },
  {
    id: "complete",
    label: "Challenge Complete",
    narrative: "ISP-B is now the installed best path for 203.0.113.0/24 across AS65001 — purely because Local Preference made it so.",
    whatChanged: () => ["✓ BGP policy applied", "✓ Best path recalculated", "✓ ISP-B selected", "✓ Route installed"],
  },
];

// ---------------------------------------------------------------------------
// Read-only CLI panel (brief §17) — output derived live from state,
// hand-formatted to look like each vendor's conventions rather than
// copied from real documentation.
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

export function buildBgpCliCommands(state: BgpState, router: RouterId): CliCommandEntry[] {
  const peerSessions = (Object.entries(SESSIONS) as [SessionId, (typeof SESSIONS)[SessionId]][]).filter(([, s]) => s.a === router || s.b === router);
  const paths = state.bgpTables[router] ?? [];

  const summaryRowsCisco = peerSessions
    .map(([sid, s]) => {
      const peer = s.a === router ? s.b : s.a;
      const sess = state.sessions[sid];
      const upDown = sess.bgp === "ESTABLISHED" ? "01:04:22" : "never";
      const stateOrPfx = sess.bgp === "ESTABLISHED" ? String(paths.filter((p) => p.advertisedBy === peer).length) : sess.bgp;
      return `${pad(IFACE_IP[router]?.[peer] ?? peer, 16)}${pad("4", 4)}${pad(String(ROUTER_AS[peer]), 8)}${pad("112", 8)}${pad("109", 8)}${pad(upDown, 12)}${stateOrPfx}`;
    })
    .join("\n");
  const summaryCisco: CliOutput = {
    cmd: "show ip bgp summary",
    output: `BGP router identifier ${ROUTER_IDS[router]}, local AS number ${ROUTER_AS[router]}\n${pad("Neighbor", 16)}${pad("V", 4)}${pad("AS", 8)}${pad("MsgRcvd", 8)}${pad("MsgSent", 8)}${pad("Up/Down", 12)}State/PfxRcd\n${summaryRowsCisco}`,
  };

  const summaryRowsJunos = peerSessions
    .map(([sid, s]) => {
      const peer = s.a === router ? s.b : s.a;
      const sess = state.sessions[sid];
      const st = sess.bgp === "ESTABLISHED" ? `Establ  ${paths.filter((p) => p.advertisedBy === peer).length}/${paths.filter((p) => p.advertisedBy === peer).length}/${paths.filter((p) => p.advertisedBy === peer).length}/0` : sess.bgp;
      return `${pad(IFACE_IP[router]?.[peer] ?? peer, 18)}${pad(String(ROUTER_AS[peer]), 10)}${pad("112", 8)}${pad("109", 8)}${pad("0", 6)}${pad("0", 6)}${pad("1:04:22", 12)}${st}`;
    })
    .join("\n");
  const summaryJuniper: CliOutput = {
    cmd: "show bgp summary",
    output: `Peer${" ".repeat(15)}AS${" ".repeat(8)}InPkt${" ".repeat(3)}OutPkt${" ".repeat(3)}OutQ${" ".repeat(2)}Flaps${" ".repeat(1)}Last Up/Dwn State|#Active/Received/Accepted/Damped\n${summaryRowsJunos}`,
  };

  const tableRowsCisco = paths
    .map((p) => `${p.best ? "*>" : "* "}${pad(DEST_PREFIX, 18)}${pad(p.attrs.nextHop, 16)}${pad(String(p.attrs.med), 8)}${pad(String(p.attrs.localPref), 8)}${pad("0", 8)}${fmtAsPath(p.attrs.asPath)} i`)
    .join("\n");
  const tableCisco: CliOutput = {
    cmd: "show ip bgp",
    output: `BGP table version is 4, local router ID is ${ROUTER_IDS[router]}\nStatus codes: * valid, > best, i - IGP\n${pad("   Network", 20)}${pad("Next Hop", 16)}${pad("Metric", 8)}${pad("LocPrf", 8)}${pad("Weight", 8)}Path\n${tableRowsCisco || "(no entries)"}`,
  };

  const prefixCisco: CliOutput = {
    cmd: `show ip bgp ${DEST_PREFIX.split("/")[0]}`,
    output:
      paths.length === 0
        ? "% Network not in table"
        : `BGP routing table entry for ${DEST_PREFIX}\nPaths: (${paths.length} available)\n${paths
            .map(
              (p) =>
                `  ${fmtAsPath(p.attrs.asPath)}\n    ${p.attrs.nextHop} from ${IFACE_IP[router]?.[p.advertisedBy] ?? p.advertisedBy}\n      Origin ${p.attrs.origin}, metric ${p.attrs.med}, localpref ${p.attrs.localPref}, ${p.attrs.peerType === "eBGP" ? "external" : "internal"}${p.best ? ", best" : ""}${!p.nextHopReachable ? "\n      % next hop not directly reachable" : ""}`,
            )
            .join("\n")}`,
  };

  const routeRowsCisco = paths
    .filter((p) => p.installed)
    .map((p) => `B    ${DEST_PREFIX} [200/${p.attrs.med}] via ${p.attrs.nextHop}, ${p.nextHopReachable ? "01:04:22" : "inaccessible"}`)
    .join("\n");
  const routeCisco: CliOutput = { cmd: `show ip route ${DEST_PREFIX.split("/")[0]}`, output: routeRowsCisco || "% Network not in table" };

  const routeRowsJunos = paths
    .filter((p) => p.installed)
    .map((p) => `${DEST_PREFIX}${p.best ? "  *[BGP/170]" : "   [BGP/170]"} 01:04:22, localpref ${p.attrs.localPref}${p.attrs.peerType === "eBGP" ? ", from " + (IFACE_IP[router]?.[p.advertisedBy] ?? "") : ""}\n                    AS path: ${fmtAsPath(p.attrs.asPath)} I\n                  ${p.nextHopReachable ? "> to " + p.attrs.nextHop : "  Next hop not resolved: " + p.attrs.nextHop}`)
    .join("\n");
  const routeJuniper: CliOutput = { cmd: "show route protocol bgp", output: routeRowsJunos || "(no BGP routes)" };

  const prefixJuniper: CliOutput = {
    cmd: `show route ${DEST_PREFIX.split("/")[0]} extensive`,
    output:
      paths.length === 0
        ? "(no matching routes)"
        : `${DEST_PREFIX} (${paths.length} entries, ${paths.filter((p) => p.best).length} announced)\n${paths
            .map(
              (p) =>
                `        ${p.best ? "*" : " "}BGP    Preference: 170/-${p.attrs.localPref}\n                Next hop: ${p.attrs.nextHop}${p.nextHopReachable ? "" : " (unusable)"}\n                AS path: ${fmtAsPath(p.attrs.asPath)} I\n                Localpref: ${p.attrs.localPref}  Metric: ${p.attrs.med}`,
            )
            .join("\n")}`,
  };

  const neighborRowsCisco = peerSessions
    .map(([sid, s]) => {
      const peer = s.a === router ? s.b : s.a;
      const sess = state.sessions[sid];
      return `BGP neighbor is ${IFACE_IP[router]?.[peer] ?? peer}, remote AS ${ROUTER_AS[peer]}, ${s.type === "eBGP" ? "external" : "internal"} link\n  BGP state = ${BGP_STATE_LABEL[sess.bgp]}${sess.bgp === "ESTABLISHED" ? ", up for 01:04:22" : ""}\n  Neighbor capabilities: route refresh, 4-byte AS`;
    })
    .join("\n\n");
  const neighborCisco: CliOutput = { cmd: "show ip bgp neighbors", output: neighborRowsCisco };

  const neighborRowsJunos = peerSessions
    .map(([sid, s]) => {
      const peer = s.a === router ? s.b : s.a;
      const sess = state.sessions[sid];
      return `Peer: ${IFACE_IP[router]?.[peer] ?? peer}+179 AS ${ROUTER_AS[peer]}  Type: ${s.type === "eBGP" ? "External" : "Internal"}\n  State: ${BGP_STATE_LABEL[sess.bgp]}${sess.bgp === "ESTABLISHED" ? "   Flags: Sync" : ""}\n  Local: ${IFACE_IP[peer]?.[router] ?? router}+179 AS ${ROUTER_AS[router]}`;
    })
    .join("\n\n");
  const neighborJuniper: CliOutput = { cmd: "show bgp neighbor", output: neighborRowsJunos };

  return [
    { id: "summary", label: "summary", cisco: summaryCisco, juniper: summaryJuniper },
    { id: "table", label: "bgp table", cisco: tableCisco, juniper: routeJuniper },
    { id: "prefix", label: `bgp ${DEST_PREFIX.split("/")[0]}`, cisco: prefixCisco, juniper: prefixJuniper },
    { id: "route", label: "ip route", cisco: routeCisco, juniper: routeJuniper },
    { id: "neighbor", label: "neighbors", cisco: neighborCisco, juniper: neighborJuniper },
  ];
}
