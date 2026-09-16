import type { PacketLayer, PacketVisual, ScenarioStep } from "../types";

/**
 * MPLS TRANSPORT + LDP (label distribution, PUSH/SWAP/POP, PHP)
 *
 *   CE1 ── PE1 ── P1 ── P2 ── PE2 ── CE2
 *  10.1.1.0/24 |←──── MPLS domain ────→| 10.2.2.0/24
 *
 * PE1 1.1.1.1/32   P1 2.2.2.2/32   P2 3.3.3.3/32   PE2 4.4.4.4/32
 *
 * Scope: this lesson teaches MPLS TRANSPORT only — one FEC
 * (PE2's loopback, 4.4.4.4/32), a single transport label per packet,
 * LDP discovery/session/label-mapping, PUSH/SWAP/POP, penultimate hop
 * popping (PHP) via implicit-null, and one LDP-adjacency fault.
 * Explicitly deferred: MPLS L3VPN, MP-BGP VPNv4, VRFs, RD/RT, VPN
 * labels, L2VPN/VPLS, RSVP-TE, FRR, Segment Routing, SRv6, BGP-LU,
 * 6PE, explicit-null behavior, QoS/EXP handling — all later lessons.
 *
 * Pure data + pure functions only — see /lib/sim-engine/types.ts for
 * why (no React, no DOM here; components only render what this file
 * computes).
 */

export type RouterId = "CE1" | "PE1" | "P1" | "P2" | "PE2" | "CE2";
export const PROVIDER_ROUTERS: RouterId[] = ["PE1", "P1", "P2", "PE2"];
export const ALL_ROUTERS: RouterId[] = ["CE1", "PE1", "P1", "P2", "PE2", "CE2"];

export const ROUTER_LOOPBACK: Partial<Record<RouterId, string>> = { PE1: "1.1.1.1", P1: "2.2.2.2", P2: "3.3.3.3", PE2: "4.4.4.4" };
export const FEC = "4.4.4.4/32";
export const CE1_IP = "10.1.1.10";
export const CE2_IP = "10.2.2.20";

export const TERMS: { term: string; expansion: string; meaning: string }[] = [
  { term: "CE", expansion: "Customer Edge", meaning: "The customer's own router — not part of the provider's MPLS domain." },
  { term: "PE", expansion: "Provider Edge", meaning: "A provider router with at least one customer-facing interface. Ingress/egress point of the LSP." },
  { term: "P", expansion: "Provider (core)", meaning: "A provider router with no customer-facing interfaces — pure label switching." },
  { term: "LER", expansion: "Label Edge Router", meaning: "A router at the edge of the MPLS domain — pushes the first label or pops the last (PE1, PE2 here)." },
  { term: "LSR", expansion: "Label Switching Router", meaning: "A router inside the MPLS domain that swaps labels (P1, P2 here — PEs act as LSRs too, at the edge)." },
  { term: "LSP", expansion: "Label Switched Path", meaning: "The end-to-end path a labeled packet follows, hop by hop, through the domain." },
  { term: "FEC", expansion: "Forwarding Equivalence Class", meaning: "A group of packets forwarded the same way — here, everything destined for 4.4.4.4/32." },
];

// ---------------------------------------------------------------------------
// LDP session state machine
// ---------------------------------------------------------------------------

export type LdpLinkId = "PE1-P1" | "P1-P2" | "P2-PE2";
export const LDP_LINKS: { id: LdpLinkId; a: RouterId; b: RouterId }[] = [
  { id: "PE1-P1", a: "PE1", b: "P1" },
  { id: "P1-P2", a: "P1", b: "P2" },
  { id: "P2-PE2", a: "P2", b: "PE2" },
];

export type LdpSessionState = "DOWN" | "HELLO" | "SESSION" | "OPERATIONAL";
export const LDP_STATE_ORDER: LdpSessionState[] = ["DOWN", "HELLO", "SESSION", "OPERATIONAL"];
export const LDP_STATE_LABEL: Record<LdpSessionState, string> = { DOWN: "Down", HELLO: "Discovery (Hello)", SESSION: "TCP Session", OPERATIONAL: "Operational" };
export const LDP_STATE_INFO: Record<LdpSessionState, { meaning: string; why: string; next: string }> = {
  DOWN: {
    meaning: "No LDP relationship exists on this link.",
    why: "LDP hasn't been enabled, or no Hello has been seen yet.",
    next: "LDP Hello (UDP 646, multicast) must be sent and heard in both directions to move to Discovery.",
  },
  HELLO: {
    meaning: "Both routers have discovered each other via LDP Hello — but this is discovery only, not a session.",
    why: "Hello just announces \"I speak LDP on this link\" — it doesn't exchange any label information yet.",
    next: "One router opens a TCP connection to the other on port 646 to establish the actual LDP session.",
  },
  SESSION: {
    meaning: "A TCP session is up on port 646 and LDP session parameters (Initialization, Keepalive) have been negotiated.",
    why: "Label mappings are exchanged reliably over TCP, not over the unreliable Hello/UDP discovery mechanism.",
    next: "Each router advertises label bindings for the FECs it can reach — once received, the session is fully operational.",
  },
  OPERATIONAL: {
    meaning: "Label mappings have been exchanged — this link is contributing real forwarding state to the LSP.",
    why: "Both discovery and session establishment succeeded, and at least one label binding has been learned.",
    next: "Forwarding uses whatever LFIB entries this exchange installed.",
  },
};

// ---------------------------------------------------------------------------
// Label / stack model — generic, not single-label-shaped (brief §29)
// ---------------------------------------------------------------------------

export type LabelPurpose = "transport" | "vpn" | "service" | "segment";

export interface MplsLabel {
  value: number;
  tc: number;
  bottomOfStack: boolean;
  ttl: number;
  purpose: LabelPurpose;
}

export interface MplsPacketState {
  srcIp: string;
  dstIp: string;
  labels: MplsLabel[]; // index 0 = top/outermost (what an LSR reads first)
}

/** Generic stack operation — works for any label count, not just one (brief §29/§31). */
function pushLabel(pkt: MplsPacketState, value: number, purpose: LabelPurpose): MplsPacketState {
  const wasEmpty = pkt.labels.length === 0;
  const newTop: MplsLabel = { value, tc: 0, ttl: 255, bottomOfStack: wasEmpty, purpose };
  const rest = pkt.labels.map((l) => ({ ...l, bottomOfStack: false }));
  return { ...pkt, labels: [newTop, ...rest] };
}
function swapTopLabel(pkt: MplsPacketState, value: number): MplsPacketState {
  if (pkt.labels.length === 0) return pkt;
  const [top, ...rest] = pkt.labels;
  return { ...pkt, labels: [{ ...top, value }, ...rest] };
}
function popTopLabel(pkt: MplsPacketState): MplsPacketState {
  const [, ...rest] = pkt.labels;
  return { ...pkt, labels: rest.map((l, i) => (i === 0 ? { ...l, bottomOfStack: true } : l)) };
}

// ---------------------------------------------------------------------------
// Label bindings — LIB (control plane) and LFIB (forwarding plane)
// ---------------------------------------------------------------------------

export type LabelBindingValue = number | "IMPLICIT_NULL";

export interface LibRemoteBinding {
  neighbor: RouterId;
  label: LabelBindingValue;
}
export interface LibEntry {
  fec: string;
  localLabel?: LabelBindingValue;
  remoteBindings: LibRemoteBinding[];
}

export type ForwardingAction = "PUSH" | "SWAP" | "POP" | "POP_AND_LOOKUP" | "IP_FORWARD" | "DROP";

export interface LfibEntry {
  fec: string;
  incomingLabel: LabelBindingValue | "UNLABELED";
  action: ForwardingAction;
  outgoingLabel?: LabelBindingValue;
  outgoingInterface?: RouterId;
}

export interface JourneyHop {
  router: RouterId;
  input: string;
  lookup: string;
  action: ForwardingAction;
  output: string;
}

export interface RouteEntry {
  destination: string;
  nextHop: string;
  cost: number;
  path: string[];
}

const LABEL_BASE: Partial<Record<RouterId, number>> = { P2: 203, P1: 102 };
function allocateLabel(router: RouterId, fecIndex = 0): number {
  return (LABEL_BASE[router] ?? 100) + fecIndex;
}

export interface MplsState {
  ldp: Record<LdpLinkId, LdpSessionState>;
  igpRoutes: Partial<Record<RouterId, RouteEntry>>;
  lib: Record<RouterId, LibEntry[]>;
  lfib: Record<RouterId, LfibEntry[]>;
  packet?: MplsPacketState;
  packetAt?: RouterId;
  journey: JourneyHop[];
  faultActive: boolean;
  repairAttempt?: { choice: string; correct: boolean };
  challengeSucceeded?: boolean;
}

function buildIgpRoutes(): Partial<Record<RouterId, RouteEntry>> {
  const chain: RouterId[] = ["PE1", "P1", "P2", "PE2"];
  const routes: Partial<Record<RouterId, RouteEntry>> = {};
  chain.forEach((router, i) => {
    if (router === "PE2") return;
    const path = chain.slice(i);
    routes[router] = { destination: FEC, nextHop: chain[i + 1], cost: (chain.length - 1 - i) * 10, path };
  });
  return routes;
}

export function createMplsState(): MplsState {
  return {
    ldp: { "PE1-P1": "DOWN", "P1-P2": "DOWN", "P2-PE2": "DOWN" },
    // The provider IGP (OSPF) is already converged — see brief §1: don't
    // re-teach OSPF, just present the result as inspectable state.
    igpRoutes: buildIgpRoutes(),
    lib: { CE1: [], PE1: [], P1: [], P2: [], PE2: [], CE2: [] },
    lfib: { CE1: [], PE1: [], P1: [], P2: [], PE2: [], CE2: [] },
    journey: [],
    faultActive: false,
  };
}

// ---------------------------------------------------------------------------
// Graph layout
// ---------------------------------------------------------------------------

export const GRAPH_NODES = [
  { id: "CE1", label: "CE1", x: 4, y: 50, subLabel: CE1_IP },
  { id: "PE1", label: "PE1", x: 21.6, y: 50, subLabel: "1.1.1.1" },
  { id: "P1", label: "P1", x: 39.2, y: 50, subLabel: "2.2.2.2" },
  { id: "P2", label: "P2", x: 56.8, y: 50, subLabel: "3.3.3.3" },
  { id: "PE2", label: "PE2", x: 74.4, y: 50, subLabel: "4.4.4.4" },
  { id: "CE2", label: "CE2", x: 96, y: 50, subLabel: CE2_IP },
];

export const GRAPH_EDGES: { id: string; a: RouterId; b: RouterId; label?: string }[] = [
  { id: "CE1-PE1", a: "CE1", b: "PE1" },
  { id: "PE1-P1", a: "PE1", b: "P1", label: "LDP" },
  { id: "P1-P2", a: "P1", b: "P2", label: "LDP" },
  { id: "P2-PE2", a: "P2", b: "PE2", label: "LDP" },
  { id: "PE2-CE2", a: "PE2", b: "CE2" },
];

export const GRAPH_REGIONS = [{ id: "mpls-domain", label: "MPLS Domain — Provider Core", x: 14, y: 30, width: 68, height: 40, tone: "cyan" as const }];

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
      { label: "TC (Traffic Class)", value: String(label.tc) },
      { label: "S (Bottom of Stack)", value: label.bottomOfStack ? "1" : "0" },
      { label: "TTL", value: String(label.ttl) },
    ],
  };
}

export function buildPacketLayers(pkt: MplsPacketState): PacketLayer[] {
  return [...pkt.labels.map(shimLayer), ipLayer(pkt.srcIp, pkt.dstIp)];
}

function ldpLayer(fields: { label: string; value: string }[]): PacketLayer {
  return { name: "LDP", color: "var(--pv-proto-mpls)", fields };
}

function mplsPacket(id: string, from: RouterId, to: RouterId, summary: string, badge: string, pkt: MplsPacketState): PacketVisual {
  return { id, protocol: "MPLS", from, to, summary, badge, layers: buildPacketLayers(pkt) };
}

function ldpPacket(id: string, from: RouterId, to: RouterId, summary: string, badge: string, fields: { label: string; value: string }[]): PacketVisual {
  return { id, protocol: "MPLS", from, to, summary, badge, layers: [ldpLayer(fields)] };
}

export function fmtLabel(v: LabelBindingValue): string {
  return v === "IMPLICIT_NULL" ? "implicit-null" : String(v);
}

// ---------------------------------------------------------------------------
// Scenario steps
// ---------------------------------------------------------------------------

export const mplsSteps: ScenarioStep<MplsState>[] = [
  {
    id: "intro",
    label: "Why MPLS?",
    narrative:
      "Without MPLS, every router along PE1 → P1 → P2 → PE2 performs a full IP destination lookup for every packet, on every hop. MPLS lets the provider classify traffic once, at the edge, into a Forwarding Equivalence Class (FEC), and forward it through the core using short labels instead. That's not fundamentally about a label lookup being \"faster\" than a modern IP lookup — it's about scalable forwarding, traffic engineering, and services (like VPNs) that labels make practical at provider scale.",
  },
  {
    id: "predict-problem",
    label: "Predict",
    narrative: "Before MPLS is enabled on this network:",
    question: {
      prompt: "Right now, how does each core router (P1, P2) forward a packet from CE1 toward CE2?",
      options: [
        { id: "label", label: "Using an MPLS label lookup" },
        { id: "ip-lookup", label: "Using a normal IP destination lookup, at every hop" },
        { id: "vpn", label: "Using a VPN routing table" },
        { id: "random", label: "Randomly, load-balanced across all interfaces" },
      ],
      correctOptionId: "ip-lookup",
      explanation:
        "With no MPLS yet, every router — PE1, P1, P2, PE2 — independently performs a full IP routing-table lookup for the packet's destination. That repeated per-hop lookup, and the inability to easily steer traffic or layer services on top of it, is what MPLS addresses.",
    },
  },
  {
    id: "terminology",
    label: "MPLS Domain & Terminology",
    narrative:
      "CE1 and CE2 are Customer Edge routers — outside the MPLS domain entirely. PE1 and PE2 are Provider Edge routers (Label Edge Routers, LERs) — they push the first label and pop the last. P1 and P2 are core Provider routers (Label Switching Routers, LSRs) — they only swap labels, never touching a customer IP header. Together, PE1 → P1 → P2 → PE2 form the domain a Label Switched Path (LSP) travels through.",
  },
  {
    id: "igp-converged",
    label: "IGP Already Converged",
    narrative:
      "The provider core already runs OSPF (covered in its own lesson) — it's fully converged. Every provider router already has an IP route to every other provider loopback, including PE2's 4.4.4.4/32. MPLS doesn't replace this: LDP will distribute labels for destinations the IGP already knows how to reach.",
  },
  {
    id: "fec-intro",
    label: "FEC",
    narrative:
      `A label isn't tied to a customer, a session, or a flow — it's tied to a Forwarding Equivalence Class: a group of packets that get forwarded identically. For this lesson, the FEC is simply "reach PE2's loopback, ${FEC}." Every packet destined anywhere reachable via that FEC gets the same label treatment. A label is also only locally significant — it means something between two directly connected routers, not as a global identifier for the destination.`,
  },
  {
    id: "predict-fec",
    label: "Predict",
    narrative: "Before LDP starts advertising anything:",
    question: {
      prompt: "What are MPLS labels associated with?",
      options: [
        { id: "interfaces", label: "Physical interfaces" },
        { id: "fec", label: "Forwarding Equivalence Classes (FECs)" },
        { id: "as", label: "Autonomous System numbers" },
        { id: "vlan", label: "VLAN IDs" },
      ],
      correctOptionId: "fec",
      explanation: "LDP binds a label to a FEC — a class of destinations forwarded the same way. Here, that FEC is reachability to PE2's loopback, 4.4.4.4/32.",
    },
  },
  {
    id: "ldp-discovery-intro",
    label: "LDP Discovery",
    narrative: "LDP neighbors: none yet. LDP starts with discovery — routers multicast Hello packets to find other LDP speakers on directly connected links.",
  },
  {
    id: "ldp-hello",
    label: "LDP Hello (PE1 ↔ P1)",
    narrative: "PE1 and P1 exchange LDP Hello packets and discover each other as LDP-capable neighbors. This is discovery only — no label information has been exchanged yet.",
    packet: () => ldpPacket("ldp-hello", "PE1", "P1", "LDP Hello — discovery", "HELLO", [
      { label: "Message Type", value: "Hello" },
      { label: "Transport", value: "UDP 646 (multicast)" },
      { label: "LDP Identifier", value: "1.1.1.1:0" },
    ]),
    run: (state) => ({
      state: { ...state, ldp: { ...state.ldp, "PE1-P1": "HELLO" } },
      events: [
        { type: "LDP_HELLO_SENT", stepId: "ldp-hello", timestamp: Date.now(), message: "PE1 → P1 LDP Hello" },
        { type: "LDP_HELLO_RECEIVED", stepId: "ldp-hello", timestamp: Date.now(), message: "P1 → PE1 LDP Hello" },
        { type: "LDP_NEIGHBOR_DISCOVERED", stepId: "ldp-hello", timestamp: Date.now(), message: "PE1 and P1 discover each other" },
      ],
    }),
    whatChanged: () => ["PE1↔P1 LDP: DOWN → Discovery (Hello)"],
  },
  {
    id: "ldp-session",
    label: "LDP Session (PE1 ↔ P1)",
    narrative: "P1 opens a TCP connection to PE1 on port 646. The LDP session establishes — this is a separate step from discovery, and it's what actually carries label mappings.",
    packet: () => ldpPacket("ldp-session", "P1", "PE1", "LDP Session Init — TCP 646", "SESSION", [
      { label: "Message Type", value: "Initialization" },
      { label: "Transport", value: "TCP 646" },
      { label: "Keepalive", value: "negotiated" },
    ]),
    run: (state) => ({
      state: { ...state, ldp: { ...state.ldp, "PE1-P1": "SESSION" } },
      events: [{ type: "LDP_SESSION_ESTABLISHED", stepId: "ldp-session", timestamp: Date.now(), message: "PE1↔P1 LDP session established over TCP 646" }],
    }),
    whatChanged: () => ["PE1↔P1 LDP: Discovery → TCP Session"],
  },
  {
    id: "ldp-other-sessions",
    label: "The Other Links Follow",
    narrative: "The identical Hello → TCP session sequence happens independently on P1↔P2 and P2↔PE2 — you've already seen exactly how it works.",
    run: (state) => ({
      state: { ...state, ldp: { ...state.ldp, "P1-P2": "SESSION", "P2-PE2": "SESSION" } },
      events: [
        { type: "LDP_SESSION_ESTABLISHED", stepId: "ldp-other-sessions", timestamp: Date.now(), message: "P1↔P2 LDP session established" },
        { type: "LDP_SESSION_ESTABLISHED", stepId: "ldp-other-sessions", timestamp: Date.now(), message: "P2↔PE2 LDP session established" },
      ],
    }),
    whatChanged: () => ["P1↔P2 and P2↔PE2 LDP: Discovery → TCP Session"],
  },
  {
    id: "label-dist-pe2",
    label: "PE2 Advertises implicit-null",
    narrative:
      "PE2 owns the FEC (4.4.4.4/32 is its own loopback). Since it's the final hop, PE2 advertises implicit-null upstream to P2 — \"don't send me a label at all, pop it before you send me the packet.\" implicit-null is a signaling value (numerically 3 in the LDP spec), but it is never actually written into a packet's label field.",
    packet: () => ldpPacket("ldp-map-pe2", "PE2", "P2", "Label Mapping — FEC 4.4.4.4/32 = implicit-null", "LABEL MAPPING", [
      { label: "Message Type", value: "Label Mapping" },
      { label: "FEC", value: FEC },
      { label: "Label", value: "implicit-null (3)" },
    ]),
    run: (state) => {
      const lib = { ...state.lib, P2: [{ fec: FEC, remoteBindings: [{ neighbor: "PE2" as RouterId, label: "IMPLICIT_NULL" as LabelBindingValue }] }] };
      return {
        state: { ...state, lib, ldp: { ...state.ldp, "P2-PE2": "OPERATIONAL" } },
        events: [
          { type: "LDP_LABEL_MAPPING_SENT", stepId: "label-dist-pe2", timestamp: Date.now(), message: "PE2 advertises implicit-null for 4.4.4.4/32" },
          { type: "LDP_LABEL_MAPPING_RECEIVED", stepId: "label-dist-pe2", timestamp: Date.now(), message: "P2 receives implicit-null from PE2" },
        ],
      };
    },
    whatChanged: () => ["P2 LIB: +FEC 4.4.4.4/32, remote binding from PE2 = implicit-null"],
  },
  {
    id: "label-dist-p2",
    label: "P2 Allocates & Advertises 203",
    narrative:
      "P2 allocates its own local label — 203 — for this FEC, and advertises it upstream to P1. P2 also now knows its own forwarding action: since PE2 said implicit-null, P2 must POP before forwarding to PE2.",
    packet: () => ldpPacket("ldp-map-p2", "P2", "P1", "Label Mapping — FEC 4.4.4.4/32 = 203", "LABEL MAPPING", [
      { label: "Message Type", value: "Label Mapping" },
      { label: "FEC", value: FEC },
      { label: "Label", value: "203" },
    ]),
    run: (state) => {
      const p2Local = allocateLabel("P2");
      const lib: MplsState["lib"] = {
        ...state.lib,
        P2: [{ fec: FEC, localLabel: p2Local, remoteBindings: state.lib.P2[0]?.remoteBindings ?? [] }],
        P1: [{ fec: FEC, remoteBindings: [{ neighbor: "P2", label: p2Local }] }],
      };
      const lfib: MplsState["lfib"] = { ...state.lfib, P2: [{ fec: FEC, incomingLabel: p2Local, action: "POP", outgoingInterface: "PE2" }] };
      return {
        state: { ...state, lib, lfib, ldp: { ...state.ldp, "P1-P2": "OPERATIONAL" } },
        events: [
          { type: "LDP_LABEL_MAPPING_SENT", stepId: "label-dist-p2", timestamp: Date.now(), message: "P2 advertises label 203 for 4.4.4.4/32" },
          { type: "LDP_LABEL_MAPPING_RECEIVED", stepId: "label-dist-p2", timestamp: Date.now(), message: "P1 receives label 203 from P2" },
          { type: "MPLS_LABEL_INSTALLED", stepId: "label-dist-p2", timestamp: Date.now(), message: "P2 LFIB: incoming 203 → POP → PE2" },
        ],
      };
    },
    whatChanged: () => ["P2 LIB: local label = 203", "P1 LIB: +remote binding from P2 = 203", "P2 LFIB: incoming 203 → POP → toward PE2"],
  },
  {
    id: "label-dist-p1",
    label: "P1 Allocates & Advertises 102",
    narrative: "P1 allocates its own local label — 102 — for the same FEC, and advertises it upstream to PE1. P1 now also knows its forwarding action: incoming 102 → swap to 203 → toward P2.",
    packet: () => ldpPacket("ldp-map-p1", "P1", "PE1", "Label Mapping — FEC 4.4.4.4/32 = 102", "LABEL MAPPING", [
      { label: "Message Type", value: "Label Mapping" },
      { label: "FEC", value: FEC },
      { label: "Label", value: "102" },
    ]),
    run: (state) => {
      const p1Local = allocateLabel("P1");
      const p2Local = state.lib.P2[0]?.localLabel ?? allocateLabel("P2");
      const lib: MplsState["lib"] = {
        ...state.lib,
        P1: [{ fec: FEC, localLabel: p1Local, remoteBindings: state.lib.P1[0]?.remoteBindings ?? [] }],
        PE1: [{ fec: FEC, remoteBindings: [{ neighbor: "P1", label: p1Local }] }],
      };
      const lfib: MplsState["lfib"] = { ...state.lfib, P1: [{ fec: FEC, incomingLabel: p1Local, action: "SWAP", outgoingLabel: p2Local, outgoingInterface: "P2" }] };
      return {
        state: { ...state, lib, lfib, ldp: { ...state.ldp, "PE1-P1": "OPERATIONAL" } },
        events: [
          { type: "LDP_LABEL_MAPPING_SENT", stepId: "label-dist-p1", timestamp: Date.now(), message: "P1 advertises label 102 for 4.4.4.4/32" },
          { type: "LDP_LABEL_MAPPING_RECEIVED", stepId: "label-dist-p1", timestamp: Date.now(), message: "PE1 receives label 102 from P1" },
          { type: "MPLS_LABEL_INSTALLED", stepId: "label-dist-p1", timestamp: Date.now(), message: "P1 LFIB: incoming 102 → SWAP → 203 → P2" },
        ],
      };
    },
    whatChanged: () => ["P1 LIB: local label = 102", "PE1 LIB: +remote binding from P1 = 102", "P1 LFIB: incoming 102 → SWAP → 203 → toward P2"],
  },
  {
    id: "lfib-pe1",
    label: "PE1 Builds Its LFIB",
    narrative: "PE1 now has everything it needs: the FEC is reachable (IGP), and P1 advertised label 102 for it. PE1's own LFIB entry: unlabeled IP in → PUSH 102 → toward P1.",
    run: (state) => ({
      state: { ...state, lfib: { ...state.lfib, PE1: [{ fec: FEC, incomingLabel: "UNLABELED", action: "PUSH", outgoingLabel: 102, outgoingInterface: "P1" }] } },
      events: [{ type: "MPLS_LABEL_INSTALLED", stepId: "lfib-pe1", timestamp: Date.now(), message: "PE1 LFIB: unlabeled → PUSH 102 → toward P1" }],
    }),
    whatChanged: () => ["PE1 LFIB: (empty) → unlabeled IP → PUSH 102 → toward P1"],
  },
  {
    id: "lib-vs-lfib",
    label: "LIB vs. LFIB",
    narrative:
      "The LIB (Label Information Base) is control-plane bookkeeping — every label binding heard from every LDP neighbor, whether or not it's used. The LFIB (Label Forwarding Information Base) is the forwarding plane — only the entries actually used to switch packets. And to be clear: LDP didn't discover that PE2 is reachable — OSPF did. LDP only distributes labels for FECs the IGP already knows how to reach.",
  },
  {
    id: "predict-ingress",
    label: "Predict",
    narrative: "A normal IP packet from CE1 is about to arrive at PE1, destined for 10.2.2.20 (behind PE2).",
    question: {
      prompt: "PE1 receives a normal IP packet that should enter the MPLS LSP. What MPLS operation occurs?",
      options: [
        { id: "push", label: "PUSH" },
        { id: "swap", label: "SWAP" },
        { id: "pop", label: "POP" },
        { id: "drop", label: "DROP" },
      ],
      correctOptionId: "push",
      explanation: "PE1 is the ingress LER — the packet arrives unlabeled. PE1 looks up the FEC and pushes the first transport label (102) onto an empty stack.",
    },
  },
  {
    id: "send-ce1",
    label: "CE1 Sends The Packet",
    narrative: `CE1 sends a plain IP packet: ${CE1_IP} → ${CE2_IP}.`,
    packet: () => ({ id: "ip-ce1", protocol: "IP", from: "CE1", to: "PE1", summary: "Plain IP packet, no labels", layers: [ipLayer(CE1_IP, CE2_IP)] }),
    run: (state) => ({
      state: { ...state, packet: { srcIp: CE1_IP, dstIp: CE2_IP, labels: [] }, packetAt: "PE1", journey: [] },
      events: [{ type: "PACKET_SENT", stepId: "send-ce1", timestamp: Date.now(), message: "CE1 sends an unlabeled IP packet toward PE1" }],
    }),
  },
  {
    id: "push-pe1",
    label: "PE1: PUSH 102",
    narrative: "PE1 looks up the FEC for 10.2.2.20 (matches 4.4.4.4/32, reachable via P1) and pushes label 102.",
    packet: (state) => (state.packet ? mplsPacket("push", "PE1", "P1", "PUSH 102", "PUSH", state.packet) : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const packet = pushLabel(state.packet, 102, "transport");
      const journey = [...state.journey, { router: "PE1" as RouterId, input: "IP packet (unlabeled)", lookup: `FEC lookup: ${FEC}`, action: "PUSH" as ForwardingAction, output: "label 102 + IP packet" }];
      return {
        state: { ...state, packet, packetAt: "P1", journey },
        events: [{ type: "MPLS_LABEL_PUSHED", stepId: "push-pe1", timestamp: Date.now(), message: "PE1 pushes label 102" }],
      };
    },
    whatChanged: () => ["Packet: [IP] → [102][IP]"],
  },
  {
    id: "inspect-shim",
    label: "Inspect The Shim Header",
    narrative: "Click the MPLS layer in the Packet Inspector. Label is the forwarding value. TC is Traffic Class (QoS marking — advanced behavior saved for a later lesson). S is the Bottom-of-Stack bit — 1 means this is the last label before the payload. TTL works like IP TTL, decremented hop by hop.",
  },
  {
    id: "predict-transit",
    label: "Predict",
    narrative: "P1 receives a packet labeled 102. P1's LFIB says: incoming 102 → SWAP → 203 → toward P2.",
    question: {
      prompt: "P1 receives MPLS label 102. What happens?",
      options: [
        { id: "swap", label: "P1 swaps 102 for 203 and forwards toward P2" },
        { id: "push", label: "P1 pushes a second label on top" },
        { id: "pop", label: "P1 pops the label and looks at the IP header" },
        { id: "drop", label: "P1 drops the packet — it doesn't recognize label 102" },
      ],
      correctOptionId: "swap",
      explanation: "P1 is a transit LSR for this FEC — its LFIB entry for incoming label 102 is a SWAP to 203, outgoing toward P2. This is a label-only decision.",
    },
  },
  {
    id: "swap-p1",
    label: "P1: SWAP 102 → 203",
    narrative: "P1 swaps the top label from 102 to 203 and forwards toward P2 — using only its LFIB, not the customer's IP header.",
    packet: (state) => (state.packet ? mplsPacket("swap", "P1", "P2", "SWAP 102 → 203", "SWAP", state.packet) : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const packet = swapTopLabel(state.packet, 203);
      const journey = [...state.journey, { router: "P1" as RouterId, input: "label 102", lookup: "LFIB: 102 → 203", action: "SWAP" as ForwardingAction, output: "label 203" }];
      return {
        state: { ...state, packet, packetAt: "P2", journey },
        events: [{ type: "MPLS_LABEL_SWAPPED", stepId: "swap-p1", timestamp: Date.now(), message: "P1 swaps 102 → 203" }],
      };
    },
    whatChanged: () => ["Packet: [102][IP] → [203][IP]"],
  },
  {
    id: "predict-inspect-ip",
    label: "Predict",
    narrative: "P1 just made a forwarding decision based entirely on its LFIB.",
    question: {
      prompt: "Does P1 need to inspect the customer's IP destination address to perform this MPLS forwarding action?",
      options: [
        { id: "yes", label: "Yes, it always re-checks the IP header" },
        { id: "no", label: "No — the decision is made entirely from the top label" },
        { id: "ttl-only", label: "Only to decrement the IP TTL" },
        { id: "ecmp", label: "Only when load-balancing across equal-cost paths" },
      ],
      correctOptionId: "no",
      explanation:
        "That's the core of label switching: P1's LFIB lookup uses only the incoming label (102). It never inspects the customer's IP header for this decision — which is also exactly why P routers in a future MPLS L3VPN never need to see customer routes.",
    },
  },
  {
    id: "implicit-null-intro",
    label: "implicit-null",
    narrative:
      "Recall: PE2 advertised implicit-null for this FEC. implicit-null signals \"pop before sending to me\" — it is a control-plane signaling value (numerically 3), never a label actually written into a packet on the wire.",
  },
  {
    id: "predict-php",
    label: "Predict",
    narrative: "The packet, labeled 203, is about to reach P2 — the penultimate hop before PE2.",
    question: {
      prompt: "PE2 advertised implicit-null upstream. What should the penultimate router (P2) do with this packet?",
      options: [
        { id: "swap", label: "Swap to a new label" },
        { id: "pop", label: "Pop the label before forwarding to PE2" },
        { id: "push", label: "Push an additional label" },
        { id: "forward-labeled", label: "Forward it to PE2 still labeled" },
      ],
      correctOptionId: "pop",
      explanation: "implicit-null told P2 not to send a label at all. P2 pops the label itself and forwards a plain IP packet to PE2 — this is Penultimate Hop Popping (PHP).",
    },
  },
  {
    id: "pop-p2",
    label: "P2: POP (PHP)",
    narrative: "P2 pops the label. PE2 will receive a plain IP packet — no label lookup required on PE2 at all.",
    packet: (state) => (state.packet ? mplsPacket("pop", "P2", "PE2", "POP — penultimate hop popping", "POP", state.packet) : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const packet = popTopLabel(state.packet);
      const journey = [...state.journey, { router: "P2" as RouterId, input: "label 203", lookup: "LFIB: 203 → POP (implicit-null from PE2)", action: "POP" as ForwardingAction, output: "IP packet (unlabeled)" }];
      return {
        state: { ...state, packet, packetAt: "PE2", journey },
        events: [{ type: "MPLS_LABEL_POPPED", stepId: "pop-p2", timestamp: Date.now(), message: "P2 pops the label (PHP)" }],
      };
    },
    whatChanged: () => ["Packet: [203][IP] → [IP]"],
  },
  {
    id: "why-php",
    label: "Why PHP Exists",
    narrative:
      "Without PHP: PE2 would receive an MPLS packet, remove the transport label itself, then perform a second lookup on the exposed payload — two lookups on the egress router. With PHP: P2 removes the label, so PE2 receives the already-exposed payload directly. Historically this mattered more for egress router load; treat it as an architectural convention here, not a claim that modern hardware couldn't do the extra pop. (Explicit-null — keeping a label of value 0 all the way to egress on purpose — exists for cases like preserving QoS markings; that's a topic for a later lesson.)",
  },
  {
    id: "egress-pe2",
    label: "PE2 → CE2",
    narrative: "PE2 receives a plain IP packet and forwards it to CE2 using a normal IP lookup — exactly like any router not running MPLS at all.",
    packet: (state) => (state.packet ? { id: "ip-pe2", protocol: "IP", from: "PE2", to: "CE2", summary: "Plain IP packet, delivered", layers: buildPacketLayers(state.packet) } : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const journey = [...state.journey, { router: "PE2" as RouterId, input: "IP packet (unlabeled)", lookup: "IP routing table", action: "IP_FORWARD" as ForwardingAction, output: "IP packet → CE2" }];
      return {
        state: { ...state, packetAt: "CE2", journey },
        events: [{ type: "MPLS_PACKET_FORWARDED", stepId: "egress-pe2", timestamp: Date.now(), message: "PE2 delivers the packet to CE2" }],
      };
    },
    whatChanged: () => ["Packet delivered to CE2 — label stack empty the entire time it was outside the MPLS domain"],
  },
  {
    id: "control-vs-data",
    label: "Control Plane vs. Data Plane",
    narrative:
      "OSPF (control plane) tells every router how to reach the FEC. LDP (control plane) tells every router which label is associated with that FEC. Neither of those touches a single customer packet. MPLS forwarding (data plane) is the mechanical PUSH → SWAP → POP you just watched, using only the LFIB those two control-plane protocols built.",
  },
  {
    id: "predict-igp-dependency",
    label: "Predict",
    narrative: "Suppose the OSPF route to PE2's loopback disappeared entirely.",
    question: {
      prompt: "If the OSPF route to PE2 (4.4.4.4/32) disappears, what should happen to the LDP/MPLS forwarding state for that FEC?",
      options: [
        { id: "nothing", label: "Nothing — MPLS forwarding is independent of the IGP" },
        { id: "withdraw", label: "The LFIB entries for that FEC become invalid and should be withdrawn" },
        { id: "auto-reroute", label: "LDP automatically finds a new path without any IGP route" },
        { id: "permanent", label: "The labels become permanent regardless of reachability" },
      ],
      correctOptionId: "withdraw",
      explanation:
        "LDP labels FECs the IGP says are reachable. If OSPF withdraws the route, the FEC is no longer valid, and LDP must withdraw the associated label bindings — the LFIB entries built from them are no longer usable. MPLS forwarding depends on IGP reachability; it doesn't replace it.",
    },
  },
  {
    id: "break-intro",
    label: "Break The Network",
    narrative: "You've watched one packet cross the whole LSP cleanly. Time to break something specific: the LDP adjacency between P1 and P2.",
  },
  {
    id: "fault-injected",
    label: "LDP Session Dropped (P1 ↔ P2)",
    narrative: "The LDP session between P1 and P2 goes down. OSPF is untouched — PE1 can still reach PE2's loopback by IP. But the label binding P1 needs for its LFIB is gone.",
    run: (state) => ({
      state: {
        ...state,
        ldp: { ...state.ldp, "P1-P2": "DOWN" },
        lib: { ...state.lib, P1: [{ fec: FEC, remoteBindings: [] }] },
        lfib: { ...state.lfib, P1: [] },
        faultActive: true,
      },
      events: [
        { type: "LDP_SESSION_RESET", stepId: "fault-injected", timestamp: Date.now(), message: "P1↔P2 LDP session reset to DOWN" },
        { type: "MPLS_LSP_CHANGED", stepId: "fault-injected", timestamp: Date.now(), message: "P1 LFIB entry for 4.4.4.4/32 withdrawn — no outgoing label available" },
      ],
    }),
    whatChanged: () => ["P1↔P2 LDP: Operational → Down", "P1 LIB: remote binding from P2 removed", "P1 LFIB: entry for 4.4.4.4/32 removed"],
  },
  {
    id: "trouble-intro",
    label: "Troubleshoot",
    narrative:
      "Complaint: \"IGP reachability is healthy — PE1 can reach PE2's loopback using IP routing. But the MPLS LSP is broken.\" Inspect the IGP routing table, the LDP neighbor table, the LIB, the LFIB, and interface state before you answer.",
  },
  {
    id: "trouble-question",
    label: "Troubleshoot",
    narrative: "OSPF is fine. Something in the MPLS control plane specifically is broken.",
    question: {
      prompt: "Where is the actual problem?",
      options: [
        { id: "l1", label: "Layer 1 — the physical link between P1 and P2 is down" },
        { id: "ospf", label: "OSPF — P1 and P2 have lost their IGP adjacency" },
        { id: "ldp", label: "LDP — the P1↔P2 LDP session is down" },
        { id: "customer", label: "Customer IP addressing behind CE1 or CE2" },
      ],
      correctOptionId: "ldp",
      explanation:
        "IGP reachability to 4.4.4.4/32 is confirmed healthy — this isn't Layer 1 or OSPF. The LDP session between P1 and P2 is down, so no label was ever advertised for this FEC on that link — P1 has no LFIB entry to swap into.",
      hints: [
        "Hint 1: First confirm IP reachability through the provider core.",
        "Hint 2: Compare the IGP adjacency state with the LDP adjacency state on the same link.",
        "Hint 3: P1 has no operational LDP neighbor toward P2.",
      ],
    },
  },
  {
    id: "repair-challenge",
    label: "Apply The Fix",
    narrative: "Choose the correct repair for the P1 ↔ P2 link.",
    action: (state, payload) => {
      const choice = typeof payload === "object" && payload !== null && "choice" in payload ? String((payload as { choice: string }).choice) : "";
      if (choice !== "enable-ldp") {
        return { state: { ...state, repairAttempt: { choice, correct: false } }, events: [] };
      }
      const p2Local = state.lib.P2[0]?.localLabel ?? allocateLabel("P2");
      const p1Local = allocateLabel("P1");
      const lib: MplsState["lib"] = {
        ...state.lib,
        P1: [{ fec: FEC, localLabel: p1Local, remoteBindings: [{ neighbor: "P2", label: p2Local }] }],
        PE1: [{ fec: FEC, remoteBindings: [{ neighbor: "P1", label: p1Local }] }],
      };
      const lfib: MplsState["lfib"] = { ...state.lfib, P1: [{ fec: FEC, incomingLabel: p1Local, action: "SWAP", outgoingLabel: p2Local, outgoingInterface: "P2" }] };
      return {
        state: { ...state, ldp: { ...state.ldp, "P1-P2": "OPERATIONAL" }, lib, lfib, faultActive: false, repairAttempt: { choice, correct: true }, challengeSucceeded: true },
        events: [
          { type: "LDP_HELLO_SENT", stepId: "repair-challenge", timestamp: Date.now(), message: "LDP Hello re-enabled on P1↔P2" },
          { type: "LDP_SESSION_ESTABLISHED", stepId: "repair-challenge", timestamp: Date.now(), message: "P1↔P2 LDP session re-established" },
          { type: "LDP_LABEL_MAPPING_RECEIVED", stepId: "repair-challenge", timestamp: Date.now(), message: "P1 receives label 203 from P2 again" },
          { type: "MPLS_LABEL_INSTALLED", stepId: "repair-challenge", timestamp: Date.now(), message: "P1 LFIB restored: 102 → SWAP → 203 → P2" },
          { type: "MPLS_LSP_CHANGED", stepId: "repair-challenge", timestamp: Date.now(), message: "LSP toward 4.4.4.4/32 operational again" },
        ],
      };
    },
    requiresState: (state) => state.challengeSucceeded === true,
  },
  {
    id: "verify-repair",
    label: "Verify The Repair",
    narrative: "Send a packet through again, end to end, to prove the fix actually restored the LSP.",
    packet: () => ({ id: "ip-verify", protocol: "IP", from: "CE1", to: "PE1", summary: "Verification packet, no labels", layers: [ipLayer(CE1_IP, CE2_IP)] }),
    run: (state) => ({
      state: { ...state, packet: { srcIp: CE1_IP, dstIp: CE2_IP, labels: [] }, packetAt: "PE1", journey: [] },
      events: [{ type: "PACKET_SENT", stepId: "verify-repair", timestamp: Date.now(), message: "CE1 sends a verification packet toward PE1" }],
    }),
  },
  {
    id: "verify-push",
    label: "PE1: PUSH (verified)",
    narrative: "PE1 pushes label 102 again — the repaired path is being used for real.",
    packet: (state) => (state.packet ? mplsPacket("verify-push", "PE1", "P1", "PUSH 102", "PUSH", state.packet) : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const packet = pushLabel(state.packet, 102, "transport");
      const journey = [...state.journey, { router: "PE1" as RouterId, input: "IP packet (unlabeled)", lookup: `FEC lookup: ${FEC}`, action: "PUSH" as ForwardingAction, output: "label 102 + IP packet" }];
      return { state: { ...state, packet, packetAt: "P1", journey }, events: [{ type: "MPLS_LABEL_PUSHED", stepId: "verify-push", timestamp: Date.now(), message: "PE1 pushes label 102" }] };
    },
  },
  {
    id: "verify-swap",
    label: "P1: SWAP (verified)",
    narrative: "P1's LFIB is restored — 102 swaps to 203 and continues toward P2, exactly like before the fault.",
    packet: (state) => (state.packet ? mplsPacket("verify-swap", "P1", "P2", "SWAP 102 → 203", "SWAP", state.packet) : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const packet = swapTopLabel(state.packet, 203);
      const journey = [...state.journey, { router: "P1" as RouterId, input: "label 102", lookup: "LFIB: 102 → 203", action: "SWAP" as ForwardingAction, output: "label 203" }];
      return { state: { ...state, packet, packetAt: "P2", journey }, events: [{ type: "MPLS_LABEL_SWAPPED", stepId: "verify-swap", timestamp: Date.now(), message: "P1 swaps 102 → 203" }] };
    },
  },
  {
    id: "verify-pop",
    label: "P2: POP (verified)",
    narrative: "P2 pops the label one more time — PHP, exactly as designed — and PE2 delivers to CE2.",
    packet: (state) => (state.packet ? mplsPacket("verify-pop", "P2", "PE2", "POP", "POP", state.packet) : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const packet = popTopLabel(state.packet);
      const journey = [
        ...state.journey,
        { router: "P2" as RouterId, input: "label 203", lookup: "LFIB: 203 → POP", action: "POP" as ForwardingAction, output: "IP packet (unlabeled)" },
        { router: "PE2" as RouterId, input: "IP packet (unlabeled)", lookup: "IP routing table", action: "IP_FORWARD" as ForwardingAction, output: "IP packet → CE2" },
      ];
      return {
        state: { ...state, packet, packetAt: "CE2", journey },
        events: [
          { type: "MPLS_LABEL_POPPED", stepId: "verify-pop", timestamp: Date.now(), message: "P2 pops the label (PHP)" },
          { type: "MPLS_PACKET_FORWARDED", stepId: "verify-pop", timestamp: Date.now(), message: "PE2 delivers the packet to CE2 — LSP fully operational" },
        ],
      };
    },
    whatChanged: () => ["✓ LDP neighbor established", "✓ Label bindings exchanged", "✓ LFIB restored", "✓ PUSH operation present", "✓ SWAP operation present", "✓ POP/PHP present", "✓ Packet reaches egress"],
  },
  {
    id: "complete",
    label: "Lesson Complete",
    narrative: "The LSP toward 4.4.4.4/32 is fully operational again — rebuilt by exactly the same LDP mechanics you watched the first time, not a shortcut.",
    whatChanged: () => ["LSP PE1 → P1 → P2 → PE2: operational"],
  },
];

// ---------------------------------------------------------------------------
// Read-only CLI panel (brief §22/§23)
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

export function buildMplsCliCommands(state: MplsState, router: RouterId): CliCommandEntry[] {
  const links = LDP_LINKS.filter((l) => l.a === router || l.b === router);
  const lib = state.lib[router] ?? [];
  const lfib = state.lfib[router] ?? [];

  const neighborRowsCisco = links
    .map((l) => {
      const peer = l.a === router ? l.b : l.a;
      const st = state.ldp[l.id];
      return `Peer LDP Ident: ${ROUTER_LOOPBACK[peer]}:0; Local LDP Ident ${ROUTER_LOOPBACK[router]}:0\n    TCP connection: ${ROUTER_LOOPBACK[peer]}.646 - ${ROUTER_LOOPBACK[router]}.646\n    State: ${st === "OPERATIONAL" ? "Oper" : st}; ${st === "OPERATIONAL" ? "Msgs sent/rcvd: 112/109" : "No session"}`;
    })
    .join("\n");
  const neighborCisco: CliOutput = { cmd: "show mpls ldp neighbor", output: neighborRowsCisco || "(no LDP neighbors)" };

  const bindingsRowsCisco = lib
    .map((e) => `  ${e.fec}\n${e.localLabel !== undefined ? `        local binding:  label: ${fmtLabel(e.localLabel)}\n` : ""}${e.remoteBindings.map((b) => `        remote binding: lsr: ${ROUTER_LOOPBACK[b.neighbor]}:0, label: ${fmtLabel(b.label)}`).join("\n")}`)
    .join("\n");
  const bindingsCisco: CliOutput = { cmd: "show mpls ldp bindings", output: bindingsRowsCisco || "(no bindings)" };

  const forwardingRowsCisco = lfib
    .map((e) => `${pad(e.incomingLabel === "UNLABELED" ? "-" : fmtLabel(e.incomingLabel), 10)}${pad(e.outgoingLabel !== undefined ? fmtLabel(e.outgoingLabel) : e.action === "POP" ? "Pop Label" : "-", 14)}${pad(e.fec, 18)}${e.outgoingInterface ?? "-"}`)
    .join("\n");
  const forwardingCisco: CliOutput = {
    cmd: "show mpls forwarding-table",
    output: `${pad("Local", 10)}${pad("Outgoing", 14)}${pad("Prefix", 18)}Outgoing\n${pad("Label", 10)}${pad("Label", 14)}${pad("or Tunnel Id", 18)}interface\n${forwardingRowsCisco || "(empty — note: IOS-XR uses 'show mpls forwarding', a differently laid-out table)"}`,
  };

  const igp = state.igpRoutes[router];
  const routeCisco: CliOutput = {
    cmd: `show ip route ${FEC.split("/")[0]}`,
    output: igp ? `Routing entry for ${FEC}\n  Known via "ospf", metric ${igp.cost}\n  Routing Descriptor Blocks:\n  * via ${igp.nextHop}` : "% Network not in table",
  };

  const neighborRowsJunos = links
    .map((l) => {
      const peer = l.a === router ? l.b : l.a;
      const st = state.ldp[l.id];
      return `Address: ${ROUTER_LOOPBACK[peer]}, Interface: to-${peer}.0\n  Label space ID: ${ROUTER_LOOPBACK[peer]}:0, State: ${st === "OPERATIONAL" ? "Operational" : st}\n  Connection: ${st === "OPERATIONAL" || st === "SESSION" ? "Open" : "Closed"}`;
    })
    .join("\n");
  const neighborJuniper: CliOutput = { cmd: "show ldp neighbor", output: neighborRowsJunos || "(no LDP neighbors)" };

  const databaseRowsJunos = lib
    .map((e) => `${e.fec}\n${e.localLabel !== undefined ? `  Advertised labels:\n    ${fmtLabel(e.localLabel)}\n` : ""}${e.remoteBindings.length ? `  Received labels:\n${e.remoteBindings.map((b) => `    ${fmtLabel(b.label)}: from ${ROUTER_LOOPBACK[b.neighbor]}:0`).join("\n")}` : ""}`)
    .join("\n");
  const databaseJuniper: CliOutput = { cmd: "show ldp database", output: databaseRowsJunos || "(empty)" };

  const inet3Juniper: CliOutput = {
    cmd: "show route table inet.3",
    output: igp
      ? `${FEC} (1 entry, 1 announced)\n        *[LDP/9] via ${igp.nextHop}, label-switched-path to-${igp.path[igp.path.length - 1]}`
      : "inet.3: 0 destinations",
  };

  const mpls0Rows = lfib
    .map((e) => `${e.incomingLabel === "UNLABELED" ? "(unlabeled, PE ingress)" : fmtLabel(e.incomingLabel)}\n    *[LDP/9] via ${e.outgoingInterface ?? "-"}\n      > to ${e.outgoingInterface ?? "-"}, ${e.action === "POP" ? "Pop" : e.action === "SWAP" ? `Swap ${e.outgoingLabel !== undefined ? fmtLabel(e.outgoingLabel) : ""}` : e.action === "PUSH" ? `Push ${e.outgoingLabel !== undefined ? fmtLabel(e.outgoingLabel) : ""}` : e.action}`)
    .join("\n");
  const mpls0Juniper: CliOutput = { cmd: "show route table mpls.0", output: mpls0Rows || "mpls.0: 0 destinations" };

  return [
    { id: "neighbor", label: "ldp neighbor", cisco: neighborCisco, juniper: neighborJuniper },
    { id: "bindings", label: "ldp bindings", cisco: bindingsCisco, juniper: databaseJuniper },
    { id: "igp-route", label: "ip route", cisco: routeCisco, juniper: inet3Juniper },
    { id: "forwarding", label: "forwarding table", cisco: forwardingCisco, juniper: mpls0Juniper },
  ];
}
