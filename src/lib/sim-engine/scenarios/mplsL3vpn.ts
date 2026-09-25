import type { PacketLayer, PacketVisual, ScenarioStep } from "../types";

/**
 * MPLS L3VPN — the capstone lesson combining IGP + LDP/MPLS transport
 * + MP-BGP + VRF (see project brief for the L3VPN lesson).
 *
 *   CUSTOMER A / SITE 1                      CUSTOMER A / SITE 2
 *   10.1.1.0/24                              10.2.2.0/24
 *        CE1                                      CE2
 *         │                                         │
 *        PE1 ──────── P1 ──────── P2 ──────── PE2
 *      VRF CUST-A  <── MPLS provider core ──>  VRF CUST-A
 *
 * Prerequisites (from the OSPF and MPLS/LDP lessons) are presented
 * already converged, per the brief — this lesson does not re-teach
 * OSPF or basic LDP, it builds VRF/RD/RT/MP-BGP/VPN-label concepts on
 * top of them and reuses the exact same generic label-stack shape
 * (`labels: MplsLabel[]`) introduced there, now carrying two labels.
 *
 * Scope: one customer (CUST-A) fully simulated end to end, CUST-B
 * used only as a small secondary illustration of overlapping address
 * space, one fault (Route Target import mismatch). Explicitly
 * deferred: PE-CE routing protocol deep dives, sham links, Site of
 * Origin, extranet VPN, hub-and-spoke RT design, all Inter-AS
 * options, CSC, 6PE/6VPE, multicast VPN, L2VPN/VPLS, EVPN, route
 * reflectors, BGP PIC, SR-MPLS, RSVP-TE — future lessons.
 *
 * Pure data + pure functions only — see /lib/sim-engine/types.ts.
 */

export type RouterId = "CE1" | "PE1" | "P1" | "P2" | "PE2" | "CE2";
export const PROVIDER_ROUTERS: RouterId[] = ["PE1", "P1", "P2", "PE2"];
export const PE_ROUTERS: RouterId[] = ["PE1", "PE2"];

export const ROUTER_LOOPBACK: Partial<Record<RouterId, string>> = { PE1: "1.1.1.1", P1: "2.2.2.2", P2: "3.3.3.3", PE2: "4.4.4.4" };
export const CE1_PREFIX = "10.1.1.0/24";
export const CE2_PREFIX = "10.2.2.0/24";
export const CE1_IP = "10.1.1.10";
export const CE2_IP = "10.2.2.20";

export const TERMS: { term: string; expansion: string; meaning: string }[] = [
  { term: "VRF", expansion: "Virtual Routing & Forwarding", meaning: "A separate routing table per customer on the same PE — keeps customer routes isolated from the provider's global table and from each other." },
  { term: "RD", expansion: "Route Distinguisher", meaning: "Makes otherwise-identical VPNv4 prefixes unique in MP-BGP. Does not control import." },
  { term: "RT", expansion: "Route Target", meaning: "An extended community controlling which VRFs export/import a VPN route. This is what decides import." },
  { term: "MP-BGP", expansion: "Multiprotocol BGP", meaning: "Carries VPNv4 NLRI (RD+prefix), RT, next-hop and the VPN label between PEs." },
  { term: "VPNv4", expansion: "VPN-IPv4", meaning: "An IPv4 prefix prefixed with an RD, transported as one MP-BGP address family." },
];

// ---------------------------------------------------------------------------
// Route Distinguisher / Route Target scheme (deterministic, data-driven —
// not hardcoded per-FEC magic; see allocateVpnLabel below for the same
// treatment of VPN labels).
// ---------------------------------------------------------------------------

export const CUST_A_RT = "65001:100";
export const CUST_A_RD: Partial<Record<RouterId, string>> = { PE1: "65001:101", PE2: "65001:102" };
export const CUST_B_RT = "65001:200";
export const CUST_B_RD: Partial<Record<RouterId, string>> = { PE1: "65001:201" };

const VPN_LABEL_BASE: Partial<Record<RouterId, number>> = { PE1: 24001, PE2: 24002 };
function allocateVpnLabel(router: RouterId, index = 0): number {
  return (VPN_LABEL_BASE[router] ?? 24000) + index;
}

// ---------------------------------------------------------------------------
// Label stack model — the SAME shape introduced in the MPLS/LDP lesson
// (brief §37/§29 of that lesson): a generic stack, not single-label or
// named-field ("transportLabel"/"vpnLabel") state. PUSH/SWAP/POP work
// on whichever label is on top, regardless of how many are stacked.
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
  labels: MplsLabel[]; // index 0 = top/outermost
}

function pushLabel(pkt: MplsPacketState, value: number, purpose: LabelPurpose): MplsPacketState {
  const wasEmpty = pkt.labels.length === 0;
  const newTop: MplsLabel = { value, tc: 0, ttl: 255, bottomOfStack: wasEmpty, purpose };
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

// ---------------------------------------------------------------------------
// VRF / VPNv4 control-plane model
// ---------------------------------------------------------------------------

export type VrfName = "CUST-A" | "CUST-B";

export interface VrfRouteEntry {
  prefix: string;
  origin: "local" | "imported";
  rd?: string;
  viaPe?: RouterId;
}
export interface VrfInstance {
  name: VrfName;
  exportRt: string;
  importRt: string;
  routes: VrfRouteEntry[];
}

export interface VpnV4Route {
  vrf: VrfName;
  originPe: RouterId;
  prefix: string;
  rd?: string;
  rt?: string;
  nextHop?: string;
  vpnLabel?: number;
}

export interface ReceivedVpnRoute {
  route: VpnV4Route;
  rtChecked: boolean;
  rtMatched: boolean;
  imported: boolean;
}

interface TransportLfibEntry {
  incomingLabel: "UNLABELED" | number;
  action: "PUSH" | "SWAP" | "POP";
  outgoingLabel?: number;
  outgoingInterface?: RouterId;
}

export interface RouteEntry {
  destination: string;
  nextHop: string;
  cost: number;
  path: string[];
}

export type ForwardingAction = "PUSH" | "SWAP" | "POP" | "VPN_LOOKUP" | "IP_FORWARD" | "DROP";
export interface JourneyHop {
  router: RouterId;
  input: string;
  lookup: string;
  action: ForwardingAction;
  output: string;
}

export interface L3VpnState {
  // Prerequisites — already converged, inspectable but not resimulated.
  igpRoutes: Partial<Record<RouterId, RouteEntry>>;
  transportLfib: Partial<Record<RouterId, TransportLfibEntry>>;

  vrfs: Partial<Record<RouterId, VrfInstance[]>>;
  vpnRoute?: VpnV4Route; // the one route this lesson builds live: PE2's 10.2.2.0/24
  received: Partial<Record<RouterId, ReceivedVpnRoute>>;

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
    routes[router] = { destination: "4.4.4.4/32", nextHop: chain[i + 1], cost: (chain.length - 1 - i) * 10, path: chain.slice(i) };
  });
  // PE2's own converged view: its route to PE1's loopback, in the reverse direction.
  routes.PE2 = { destination: "1.1.1.1/32", nextHop: "P2", cost: 30, path: [...chain].reverse() };
  return routes;
}

export function createL3VpnState(): L3VpnState {
  return {
    igpRoutes: buildIgpRoutes(),
    transportLfib: {
      PE1: { incomingLabel: "UNLABELED", action: "PUSH", outgoingLabel: 102, outgoingInterface: "P1" },
      P1: { incomingLabel: 102, action: "SWAP", outgoingLabel: 203, outgoingInterface: "P2" },
      P2: { incomingLabel: 203, action: "POP", outgoingInterface: "PE2" },
    },
    vrfs: {
      PE1: [
        { name: "CUST-A", exportRt: CUST_A_RT, importRt: CUST_A_RT, routes: [{ prefix: CE1_PREFIX, origin: "local" }] },
        { name: "CUST-B", exportRt: CUST_B_RT, importRt: CUST_B_RT, routes: [{ prefix: CE1_PREFIX, origin: "local" }] },
      ],
      PE2: [
        {
          name: "CUST-A",
          exportRt: CUST_A_RT,
          importRt: CUST_A_RT,
          routes: [
            { prefix: CE2_PREFIX, origin: "local" },
            { prefix: CE1_PREFIX, origin: "imported", rd: CUST_A_RD.PE1, viaPe: "PE1" },
          ],
        },
      ],
    },
    received: {},
    journey: [],
    faultActive: false,
  };
}

// ---------------------------------------------------------------------------
// Graph layout
// ---------------------------------------------------------------------------

export const GRAPH_NODES = [
  { id: "CE1", label: "CE1", x: 4, y: 50, subLabel: CE1_IP },
  { id: "PE1", label: "PE1", x: 21.6, y: 50, subLabel: "VRF CUST-A" },
  { id: "P1", label: "P1", x: 39.2, y: 50, subLabel: "2.2.2.2" },
  { id: "P2", label: "P2", x: 56.8, y: 50, subLabel: "3.3.3.3" },
  { id: "PE2", label: "PE2", x: 74.4, y: 50, subLabel: "VRF CUST-A" },
  { id: "CE2", label: "CE2", x: 96, y: 50, subLabel: CE2_IP },
];
export const GRAPH_EDGES = [
  { id: "CE1-PE1", a: "CE1", b: "PE1" },
  { id: "PE1-P1", a: "PE1", b: "P1", label: "LSP" },
  { id: "P1-P2", a: "P1", b: "P2", label: "LSP" },
  { id: "P2-PE2", a: "P2", b: "PE2", label: "LSP" },
  { id: "PE2-CE2", a: "PE2", b: "CE2" },
];
export const GRAPH_REGIONS = [{ id: "mpls-domain", label: "MPLS Provider Core", x: 14, y: 30, width: 68, height: 40, tone: "cyan" as const }];

/** Simplified logical view (brief §40) — the sites as if directly connected, core hidden underneath. */
export const LOGICAL_GRAPH_NODES = [
  { id: "CE1", label: "CE1", x: 6, y: 50, subLabel: CE1_IP },
  { id: "PE1", label: "PE1", x: 27, y: 50, subLabel: "VRF CUST-A" },
  { id: "PE2", label: "PE2", x: 73, y: 50, subLabel: "VRF CUST-A" },
  { id: "CE2", label: "CE2", x: 94, y: 50, subLabel: CE2_IP },
];
export const LOGICAL_GRAPH_EDGES = [
  { id: "CE1-PE1", a: "CE1", b: "PE1" },
  { id: "PE1-PE2", a: "PE1", b: "PE2", label: "MP-BGP VPN" },
  { id: "PE2-CE2", a: "PE2", b: "CE2" },
];

// ---------------------------------------------------------------------------
// Packet / CLI builders
// ---------------------------------------------------------------------------

function ipLayer(src: string, dst: string): PacketLayer {
  return { name: "IPv4", color: "var(--pv-proto-ip)", fields: [{ label: "Source IP", value: src }, { label: "Destination IP", value: dst }] };
}
function shimLayer(label: MplsLabel): PacketLayer {
  return {
    name: `MPLS Shim (${label.purpose})`,
    color: label.purpose === "vpn" ? "var(--pv-proto-udp)" : "var(--pv-proto-mpls)",
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
function mplsPacket(id: string, from: RouterId, to: RouterId, summary: string, badge: string, pkt: MplsPacketState): PacketVisual {
  return { id, protocol: "MPLS", from, to, summary, badge, layers: buildPacketLayers(pkt) };
}
function bgpLayer(fields: { label: string; value: string }[]): PacketLayer {
  return { name: "MP-BGP VPNv4 UPDATE", color: "var(--pv-proto-bgp)", fields };
}
function bgpPacket(id: string, from: RouterId, to: RouterId, summary: string, fields: { label: string; value: string }[]): PacketVisual {
  return { id, protocol: "BGP", from, to, summary, badge: "VPNv4 UPDATE", layers: [bgpLayer(fields)] };
}

/** Index of the packet's current outermost transport label, if any — used to drive the Packet Inspector's X-ray focus. */
export function transportLayerIndex(pkt: MplsPacketState | undefined): number[] {
  if (!pkt) return [];
  const i = pkt.labels.findIndex((l) => l.purpose === "transport");
  return i >= 0 ? [i] : [];
}
export function vpnLayerIndex(pkt: MplsPacketState | undefined): number[] {
  if (!pkt) return [];
  const i = pkt.labels.findIndex((l) => l.purpose === "vpn");
  return i >= 0 ? [i] : [];
}

// ---------------------------------------------------------------------------
// Scenario steps
// ---------------------------------------------------------------------------

export const l3vpnSteps: ScenarioStep<L3VpnState>[] = [
  {
    id: "intro",
    label: "The Customer Problem",
    narrative:
      "Customer A's Site 1 (10.1.1.0/24, behind CE1) wants private Layer-3 connectivity to Site 2 (10.2.2.0/24, behind CE2) — across a provider network that also carries hundreds of other customers. The provider core cannot afford to carry every customer's IPv4 routes in its own global table.",
  },
  {
    id: "predict-problem",
    label: "Predict",
    narrative: "Before naming the solution:",
    question: {
      prompt: "How can a provider carry thousands of customers while keeping their routing information separated?",
      options: [
        { id: "one-table", label: "Put every customer route in one shared global table" },
        { id: "vrf-bgp-mpls", label: "Give each customer a separate VRF, exchange VPN routes over MP-BGP, transport them over MPLS" },
        { id: "separate-cables", label: "Run a separate physical cable per customer" },
        { id: "renumber", label: "Force every customer onto non-overlapping address space" },
      ],
      correctOptionId: "vrf-bgp-mpls",
      explanation:
        "MPLS L3VPN combines three pieces: a VRF on each PE to keep customer routing separate, MP-BGP to exchange VPN routes between PEs without touching the provider core, and MPLS to actually forward customer traffic across that core.",
    },
  },
  {
    id: "prerequisites",
    label: "Already In Place",
    narrative:
      "From the previous lessons: the provider IGP (OSPF) is converged, LDP is operational, and the MPLS transport LSP between PE1 and PE2 already works — PE1 can push a label, P1 and P2 switch it, PE2 receives plain IP. None of that is re-taught here; it's just available to inspect.",
  },
  {
    id: "vrf-intro",
    label: "VRF",
    narrative:
      "PE1 keeps two separate routing tables: the provider's global table (loopbacks: 1.1.1.1, 2.2.2.2, 3.3.3.3, 4.4.4.4) and VRF CUST-A, which holds only Customer A's routes (10.1.1.0/24 so far). They never mix.",
  },
  {
    id: "predict-vrf",
    label: "Predict",
    narrative: "Before moving on:",
    question: {
      prompt: "Does the customer route 10.1.1.0/24 belong in the provider's global routing table?",
      options: [
        { id: "yes", label: "Yes — the provider needs it to forward customer traffic" },
        { id: "no", label: "No — it belongs only in VRF CUST-A" },
        { id: "both", label: "Yes, in both the global table and the VRF" },
        { id: "neither", label: "No — it doesn't belong anywhere on PE1" },
      ],
      correctOptionId: "no",
      explanation: "The whole point of a VRF is to keep this route out of the global table. The provider core only ever needs to reach PE loopbacks — never a single customer prefix.",
    },
  },
  {
    id: "overlap-intro",
    label: "Overlapping Address Space",
    narrative:
      "PE1 also serves Customer B — who happens to use the exact same prefix, 10.1.1.0/24. That's completely legal: VRF CUST-A and VRF CUST-B are independent routing tables, so identical prefixes in different VRFs don't conflict at all.",
  },
  {
    id: "predict-overlap",
    label: "Predict",
    narrative: "Both customers' routes will eventually need to travel over the same MP-BGP sessions between PEs.",
    question: {
      prompt: "How can MP-BGP distinguish two identical IPv4 prefixes (10.1.1.0/24) belonging to different VPNs?",
      options: [
        { id: "vrf-name", label: "By comparing VRF names between PEs" },
        { id: "rd", label: "By prefixing each route with a Route Distinguisher (RD), making it unique" },
        { id: "interface", label: "By remembering which interface it arrived on" },
        { id: "cant", label: "It can't — overlapping prefixes are not actually possible" },
      ],
      correctOptionId: "rd",
      explanation: "MP-BGP doesn't carry plain IPv4 for VPNs — it carries VPNv4: an RD prepended to the prefix. Two otherwise-identical prefixes with different RDs are different routes as far as BGP is concerned.",
    },
  },
  {
    id: "rd-intro",
    label: "Route Distinguisher",
    narrative:
      "Customer A's prefix on PE1 becomes 65001:101:10.1.1.0/24. Customer B's identical prefix becomes 65001:201:10.1.1.0/24. Same IPv4 prefix, completely distinct VPNv4 routes — the RD is what makes that possible.",
  },
  {
    id: "predict-rd",
    label: "Predict",
    narrative: "Be precise about what RD actually does.",
    question: {
      prompt: "What does the Route Distinguisher (RD) do?",
      options: [
        { id: "unique", label: "Makes otherwise-identical VPNv4 prefixes unique in MP-BGP" },
        { id: "import", label: "Determines which VRF a route is imported into" },
        { id: "label", label: "Selects the MPLS transport label" },
        { id: "session", label: "Establishes the MP-BGP session" },
      ],
      correctOptionId: "unique",
      explanation:
        "RD's only job is uniqueness in the control plane. It is easy to assume RD also controls which VRF imports a route — it does not. That's the Route Target's job, coming up next.",
    },
  },
  {
    id: "rt-intro",
    label: "Route Target",
    narrative:
      "When PE2 advertises Customer A's route, it attaches an extended community: Export RT 65001:100. When PE1 receives it, PE1 checks: \"does CUST-A's Import RT (65001:100) match?\" Only on a match does the route enter the VRF.",
  },
  {
    id: "rd-vs-rt-table",
    label: "RD vs. RT",
    narrative: "VRF separates customer routing tables. RD makes VPN routes unique in MP-BGP. RT controls import/export policy — three different jobs, easy to conflate.",
  },
  {
    id: "predict-rd-vs-rt",
    label: "Predict",
    narrative: "This is one of the most important distinctions in the whole lesson.",
    question: {
      prompt: "Which one decides whether a remote VPN route is imported into CUST-A?",
      options: [
        { id: "vrf-name", label: "The VRF name" },
        { id: "rd", label: "The RD" },
        { id: "rt", label: "The RT" },
        { id: "label", label: "The transport label" },
      ],
      correctOptionId: "rt",
      explanation: "Route Target — not RD, and not the VRF name (nothing requires VRF names to even match between PEs; only RT policy matters).",
    },
  },
  {
    id: "mpbgp-intro",
    label: "MP-BGP for VPNv4",
    narrative:
      "PE1 and PE2 already have an MP-BGP session established for the VPNv4 address family (the underlying TCP/BGP FSM works exactly like the BGP lesson — not repeated here). Ordinary IPv4 BGP NLRI can't carry an RD or a VPN label; MP-BGP's VPNv4 AFI/SAFI can.",
  },
  {
    id: "remote-route-learned",
    label: "PE2 Learns The Customer Route",
    narrative: "CE2 advertises 10.2.2.0/24 to PE2 (over whatever PE-CE mechanism — not this lesson's focus). PE2 installs it into VRF CUST-A as a local route.",
    run: (state) => ({
      state: { ...state, vpnRoute: { vrf: "CUST-A", originPe: "PE2", prefix: CE2_PREFIX } },
      events: [{ type: "VRF_ROUTE_LEARNED", stepId: "remote-route-learned", timestamp: Date.now(), message: "PE2 learns 10.2.2.0/24 into VRF CUST-A" }],
    }),
    whatChanged: () => ["PE2 VRF CUST-A: +10.2.2.0/24 (local)"],
  },
  {
    id: "add-rd",
    label: "Add RD",
    narrative: `PE2 prepends its RD for this VRF, ${CUST_A_RD.PE2}, turning the plain IPv4 route into a VPNv4 route.`,
    run: (state) => ({
      state: { ...state, vpnRoute: state.vpnRoute ? { ...state.vpnRoute, rd: CUST_A_RD.PE2 } : state.vpnRoute },
      events: [{ type: "RD_APPLIED", stepId: "add-rd", timestamp: Date.now(), message: `PE2 applies RD ${CUST_A_RD.PE2}` }],
    }),
    whatChanged: (_prev, next) => [`Route: 10.2.2.0/24 → ${next.vpnRoute?.rd}:10.2.2.0/24 (VPNv4)`],
  },
  {
    id: "rt-attach",
    label: "Attach Export RT",
    narrative: `PE2 attaches its export Route Target, ${CUST_A_RT}, as an extended community on the route.`,
    run: (state) => ({
      state: { ...state, vpnRoute: state.vpnRoute ? { ...state.vpnRoute, rt: CUST_A_RT, nextHop: ROUTER_LOOPBACK.PE2 } : state.vpnRoute },
      events: [{ type: "RT_ATTACHED", stepId: "rt-attach", timestamp: Date.now(), message: `PE2 attaches export RT ${CUST_A_RT}` }],
    }),
    whatChanged: () => [`Route Target attached: ${CUST_A_RT}`, "BGP next-hop set: PE2's loopback (4.4.4.4)"],
  },
  {
    id: "vpn-label-alloc",
    label: "Allocate VPN Label",
    narrative: "PE2 allocates a VPN (service) label for this route — 24002. This is NOT the transport label. It identifies Customer A's forwarding context at PE2, for whenever a labeled packet arrives back at PE2.",
    run: (state) => {
      const label = allocateVpnLabel("PE2");
      return {
        state: { ...state, vpnRoute: state.vpnRoute ? { ...state.vpnRoute, vpnLabel: label } : state.vpnRoute },
        events: [{ type: "VPN_LABEL_ALLOCATED", stepId: "vpn-label-alloc", timestamp: Date.now(), message: `PE2 allocates VPN label ${label}` }],
      };
    },
    whatChanged: (_prev, next) => [`VPN label allocated: ${next.vpnRoute?.vpnLabel}`],
  },
  {
    id: "mpbgp-advertise",
    label: "MP-BGP Advertisement",
    narrative: "PE2 advertises the complete VPNv4 route to PE1 over MP-BGP: RD, prefix, RT, next-hop, and VPN label all in one UPDATE.",
    packet: (state) =>
      state.vpnRoute
        ? bgpPacket("vpnv4-advertise", "PE2", "PE1", "VPNv4 UPDATE — 10.2.2.0/24", [
            { label: "NLRI (RD:Prefix)", value: `${state.vpnRoute.rd}:${state.vpnRoute.prefix}` },
            { label: "Extended Community (RT)", value: state.vpnRoute.rt ?? "" },
            { label: "NEXT_HOP", value: state.vpnRoute.nextHop ?? "" },
            { label: "VPN Label", value: String(state.vpnRoute.vpnLabel) },
          ])
        : undefined,
    run: (state) => {
      if (!state.vpnRoute) return { state, events: [] };
      return {
        state: { ...state, received: { ...state.received, PE1: { route: { ...state.vpnRoute }, rtChecked: false, rtMatched: false, imported: false } } },
        events: [
          { type: "MPBGP_VPN_ROUTE_ADVERTISED", stepId: "mpbgp-advertise", timestamp: Date.now(), message: "PE2 advertises the VPNv4 route" },
          { type: "MPBGP_VPN_ROUTE_RECEIVED", stepId: "mpbgp-advertise", timestamp: Date.now(), message: "PE1 receives the VPNv4 route" },
        ],
      };
    },
    whatChanged: () => ["PE1 receives 10.2.2.0/24 via MP-BGP — not yet imported into any VRF"],
  },
  {
    id: "predict-rt-import",
    label: "Predict",
    narrative: `PE1's VRF CUST-A has import RT ${CUST_A_RT}. The received route's RT is ${CUST_A_RT}.`,
    question: {
      prompt: "With the import and export RT matching, what should happen to this route?",
      options: [
        { id: "reject", label: "It's rejected — RD differs from PE1's own RD" },
        { id: "import", label: "It's imported into VRF CUST-A" },
        { id: "global", label: "It's installed in the global table instead" },
        { id: "wait", label: "Nothing yet — it needs a matching VRF name too" },
      ],
      correctOptionId: "import",
      explanation: "RT is the only thing that has to match. RD is expected to differ between PE1 and PE2 (each PE can use its own RD) — that's normal, not a problem.",
    },
  },
  {
    id: "rt-import-check",
    label: "RT Import Check",
    narrative: "PE1 compares the route's RT against CUST-A's import RT — a match.",
    run: (state) => {
      const received = state.received.PE1;
      if (!received) return { state, events: [] };
      const matched = received.route.rt === CUST_A_RT;
      return {
        state: { ...state, received: { ...state.received, PE1: { ...received, rtChecked: true, rtMatched: matched } } },
        events: [{ type: "RT_IMPORT_EVALUATED", stepId: "rt-import-check", timestamp: Date.now(), message: `RT import check: ${matched ? "match" : "no match"}` }],
      };
    },
  },
  {
    id: "vrf-install",
    label: "Route Installed Into CUST-A",
    narrative: "The RT matched — PE1 imports the route into VRF CUST-A.",
    run: (state) => {
      const received = state.received.PE1;
      if (!received || !received.rtMatched) return { state, events: [] };
      const vrfs = { ...state.vrfs };
      const pe1Vrfs = (vrfs.PE1 ?? []).map((v) =>
        v.name === "CUST-A" ? { ...v, routes: [...v.routes, { prefix: received.route.prefix, origin: "imported" as const, rd: received.route.rd, viaPe: "PE2" as RouterId }] } : v,
      );
      vrfs.PE1 = pe1Vrfs;
      return {
        state: { ...state, vrfs, received: { ...state.received, PE1: { ...received, imported: true } } },
        events: [
          { type: "VPN_ROUTE_IMPORTED", stepId: "vrf-install", timestamp: Date.now(), message: "PE1 imports 10.2.2.0/24 into CUST-A" },
          { type: "VPN_ROUTE_INSTALLED", stepId: "vrf-install", timestamp: Date.now(), message: "Route installed" },
        ],
      };
    },
    whatChanged: () => ["CUST-A routes: 10.1.1.0/24 → 10.1.1.0/24, 10.2.2.0/24 (NEW)"],
  },
  {
    id: "control-recap",
    label: "Who Provides What",
    narrative:
      "IGP → reaches the remote PE loopback. LDP → the transport label. MP-BGP → the VPN route itself, its RD, its RT, its next-hop, and its VPN label. VRF → keeps it all separated per customer. Four different jobs, four different pieces.",
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
    id: "vrf-lookup",
    label: "PE1: VRF Lookup",
    narrative: `PE1 looks up ${CE2_IP} in VRF CUST-A — not the global table. It matches 10.2.2.0/24: BGP next-hop 4.4.4.4, VPN label 24002. PE1 still needs to figure out how to reach 4.4.4.4 itself — that's the transport LSP.`,
  },
  {
    id: "predict-two-labels",
    label: "Predict",
    narrative: "PE1 is about to build a two-label stack.",
    question: {
      prompt: "Why does PE1 need two labels, not one?",
      options: [
        { id: "redundancy", label: "Just for redundancy in case one is dropped" },
        { id: "two-jobs", label: "The outer label answers \"how do I reach PE2?\"; the inner label answers \"what should PE2 do with this packet?\"" },
        { id: "encryption", label: "The second label encrypts the customer payload" },
        { id: "qos", label: "One label is for QoS marking only" },
      ],
      correctOptionId: "two-jobs",
      explanation: "Transport label → gets the packet across the core to the right PE. VPN label → tells that PE which customer/VRF context to forward the exposed packet into. Two different jobs.",
    },
  },
  {
    id: "predict-stack-order",
    label: "Predict",
    narrative: "Available pieces: Transport label 102, VPN label 24002, the IP packet.",
    question: {
      prompt: "What is the correct label stack order for forwarding through the core?",
      options: [
        { id: "correct", label: "[Transport 102] [VPN 24002] [IP] — transport outermost" },
        { id: "reversed", label: "[VPN 24002] [Transport 102] [IP] — VPN outermost" },
        { id: "ip-first", label: "[IP] [Transport 102] [VPN 24002]" },
        { id: "no-ip", label: "[Transport 102] [VPN 24002] — no IP header needed" },
      ],
      correctOptionId: "correct",
      explanation: "The transport label must be outermost — that's the only label P routers ever look at. If it were buried under the VPN label, no P router could forward the packet at all.",
    },
  },
  {
    id: "push-vpn-label",
    label: "PE1: PUSH VPN Label",
    narrative: "PE1 pushes the VPN label first — 24002, from the VRF lookup. It becomes the bottom of the stack.",
    packet: (state) => (state.packet ? mplsPacket("push-vpn", "PE1", "PE1", "PUSH VPN 24002", "PUSH VPN", state.packet) : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const packet = pushLabel(state.packet, 24002, "vpn");
      return { state: { ...state, packet }, events: [{ type: "VPN_LABEL_PUSHED", stepId: "push-vpn-label", timestamp: Date.now(), message: "PE1 pushes VPN label 24002" }] };
    },
    whatChanged: () => ["Packet: [IP] → [VPN 24002][IP]"],
  },
  {
    id: "push-transport-label",
    label: "PE1: PUSH Transport Label",
    narrative: "PE1 pushes the transport label on top — 102, from the LDP-built LFIB toward P1. The VPN label is now underneath and remains the bottom of the stack (S=1); the new transport label on top has S=0.",
    packet: (state) => (state.packet ? mplsPacket("push-transport", "PE1", "P1", "PUSH Transport 102", "PUSH", state.packet) : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const packet = pushLabel(state.packet, 102, "transport");
      const journey = [
        ...state.journey,
        { router: "PE1" as RouterId, input: "IP packet (VRF CUST-A match)", lookup: "VRF lookup → nexthop 4.4.4.4, VPN label 24002; LFIB → 102 via P1", action: "PUSH" as ForwardingAction, output: "[102][24002][IP]" },
      ];
      return { state: { ...state, packet, packetAt: "P1", journey }, events: [{ type: "TRANSPORT_LABEL_PUSHED", stepId: "push-transport-label", timestamp: Date.now(), message: "PE1 pushes transport label 102" }] };
    },
    whatChanged: () => ["Packet: [VPN 24002][IP] → [Transport 102][VPN 24002][IP]"],
  },
  {
    id: "p1-swap",
    label: "P1: SWAP Transport Only",
    narrative: "P1 receives [Transport 102][VPN 24002][IP] and acts on the outer transport label only — 102 → 203, exactly like a transport-only LSP. The inner VPN label rides along in the stack, unchanged, but P1 never inspects or uses it for this forwarding decision.",
    packet: (state) => (state.packet ? mplsPacket("p1-swap", "P1", "P2", "SWAP transport 102 → 203", "SWAP", state.packet) : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const packet = swapTopLabel(state.packet, 203);
      const journey = [...state.journey, { router: "P1" as RouterId, input: "[102][24002][IP]", lookup: "LFIB: 102 → 203 (outer label only)", action: "SWAP" as ForwardingAction, output: "[203][24002][IP]" }];
      return { state: { ...state, packet, packetAt: "P2", journey }, events: [{ type: "TRANSPORT_LABEL_SWAPPED", stepId: "p1-swap", timestamp: Date.now(), message: "P1 swaps 102 → 203; VPN label 24002 unchanged" }] };
    },
    whatChanged: () => ["Outer (transport) label: 102 → 203", "Inner (VPN) label: 24002 — unchanged"],
  },
  {
    id: "predict-p-router",
    label: "Predict",
    narrative: "P1 just forwarded this packet with the VPN label still sitting in the stack underneath — but it never inspected or used that label for the forwarding decision.",
    question: {
      prompt: "Does P1 need 10.2.2.0/24 — the customer's route — anywhere in its routing table?",
      options: [
        { id: "yes", label: "Yes, every core router needs every customer route" },
        { id: "no", label: "No — P1 only ever acts on the outer transport label" },
        { id: "sometimes", label: "Only if the VRF names match" },
        { id: "only-vpnv4", label: "Only in a VPNv4-specific table, not the main one" },
      ],
      correctOptionId: "no",
      explanation:
        "This is one of the most important scalability properties of MPLS L3VPN: P routers never hold customer routes at all — not thousands of them, not one. The VPN label is physically present in every packet's label stack as it transits P1 and P2, but they forward using only the outer transport label; the inner VPN label just rides along, unread, for the egress PE to use.",
    },
  },
  {
    id: "p2-php",
    label: "P2: PHP — Pop Outer Label Only",
    narrative: "P2 is the penultimate hop. PHP removes the outer transport label — and only the outer one. The VPN label must survive; PE2 needs it.",
    packet: (state) => (state.packet ? mplsPacket("p2-pop", "P2", "PE2", "POP outer (transport) label", "POP", state.packet) : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const packet = popTopLabel(state.packet);
      const journey = [...state.journey, { router: "P2" as RouterId, input: "[203][24002][IP]", lookup: "LFIB: 203 → POP (PHP, outer only)", action: "POP" as ForwardingAction, output: "[24002][IP]" }];
      return { state: { ...state, packet, packetAt: "PE2", journey }, events: [{ type: "TRANSPORT_LABEL_POPPED", stepId: "p2-php", timestamp: Date.now(), message: "P2 pops the outer transport label only" }] };
    },
    whatChanged: () => ["Packet: [Transport 203][VPN 24002][IP] → [VPN 24002][IP]"],
  },
  {
    id: "predict-remaining-label",
    label: "Predict",
    narrative: "After PHP, one label remains on the stack.",
    question: {
      prompt: "Which label should remain after P2's PHP?",
      options: [
        { id: "transport", label: "The transport label" },
        { id: "vpn", label: "The VPN label" },
        { id: "both", label: "Both — PHP only decrements TTL" },
        { id: "neither", label: "Neither — the packet is fully unlabeled" },
      ],
      correctOptionId: "vpn",
      explanation: "PHP only ever removes the outer (transport) label. The VPN label is the bottom of the stack (S=1) — it's meant to survive all the way to PE2.",
    },
  },
  {
    id: "pe2-vpn-lookup",
    label: "PE2: VPN Label Lookup",
    narrative: "PE2 receives [VPN 24002][IP]. It looks up label 24002 in its own label space — this identifies the VRF CUST-A forwarding context, not a generic routing decision.",
    run: (state) => ({
      state,
      events: [
        { type: "VPN_LABEL_LOOKUP", stepId: "pe2-vpn-lookup", timestamp: Date.now(), message: "PE2 looks up VPN label 24002" },
        { type: "VPN_CONTEXT_SELECTED", stepId: "pe2-vpn-lookup", timestamp: Date.now(), message: "PE2 selects VRF CUST-A forwarding context" },
      ],
    }),
  },
  {
    id: "pe2-deliver",
    label: "PE2 → CE2",
    narrative: "PE2 removes the VPN label and forwards the exposed IP packet into VRF CUST-A, out toward CE2.",
    packet: (state) => (state.packet ? { id: "ip-pe2", protocol: "IP", from: "PE2", to: "CE2", summary: "Plain IP packet, delivered via VRF CUST-A", layers: [ipLayer(state.packet.srcIp, state.packet.dstIp)] } : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const journey = [
        ...state.journey,
        { router: "PE2" as RouterId, input: "[24002][IP]", lookup: "VPN label 24002 → VRF CUST-A", action: "VPN_LOOKUP" as ForwardingAction, output: "IP packet → CE2 (via CUST-A)" },
      ];
      return { state: { ...state, packet: { ...state.packet, labels: [] }, packetAt: "CE2", journey }, events: [{ type: "VPN_PACKET_DELIVERED", stepId: "pe2-deliver", timestamp: Date.now(), message: "PE2 delivers the packet to CE2" }] };
    },
    whatChanged: () => ["Packet: [VPN 24002][IP] → [IP] — delivered to CE2 via VRF CUST-A"],
  },
  {
    id: "journey-recap",
    label: "Control Plane Built It, Data Plane Used It",
    narrative:
      "Every field the data plane just used — the VPN label, the transport label, the next-hop — was created entirely by the control plane you walked through first: VRF → RD → RT → VPN label → MP-BGP → import. The data plane never negotiates anything; it only executes what the control plane already decided.",
  },
  {
    id: "route-builder-rd",
    label: "Build The Route: RD",
    narrative: "Let's rebuild PE2's VPNv4 route from scratch, one field at a time.",
    question: {
      prompt: `For PE2's 10.2.2.0/24 route, which RD should be used?`,
      options: [
        { id: "correct", label: CUST_A_RD.PE2 ?? "" },
        { id: "pe1-rd", label: CUST_A_RD.PE1 ?? "" },
        { id: "custb-rd", label: CUST_B_RD.PE1 ?? "" },
        { id: "rt-as-rd", label: CUST_A_RT },
      ],
      correctOptionId: "correct",
      explanation: `${CUST_A_RD.PE2} is PE2's own RD for VRF CUST-A. ${CUST_A_RD.PE1} is PE1's RD for the same VRF — a different PE can (and often does) use a different RD for the same customer.`,
    },
  },
  {
    id: "route-builder-rt",
    label: "Build The Route: RT",
    narrative: "Now the Route Target.",
    question: {
      prompt: "Which RT should PE2 attach so PE1's CUST-A VRF will import this route?",
      options: [
        { id: "correct", label: CUST_A_RT },
        { id: "custb-rt", label: CUST_B_RT },
        { id: "rd-as-rt", label: CUST_A_RD.PE2 ?? "" },
        { id: "made-up", label: "65001:999" },
      ],
      correctOptionId: "correct",
      explanation: `It must match PE1 CUST-A's import RT exactly: ${CUST_A_RT}.`,
    },
  },
  {
    id: "route-builder-nexthop",
    label: "Build The Route: Next Hop",
    narrative: "Now the BGP next-hop.",
    question: {
      prompt: "What should the BGP next-hop be for a route PE2 originates?",
      options: [
        { id: "correct", label: "PE2's own loopback, 4.4.4.4" },
        { id: "pe1", label: "PE1's loopback, 1.1.1.1" },
        { id: "ce2", label: "CE2's address, 10.2.2.20" },
        { id: "p2", label: "P2's loopback, 3.3.3.3" },
      ],
      correctOptionId: "correct",
      explanation: "The originating PE sets itself as next-hop — that's the address the ingress PE (PE1) will need to reach through the MPLS transport LSP.",
    },
  },
  {
    id: "route-builder-label",
    label: "Build The Route: VPN Label",
    narrative: "Finally, the VPN label.",
    question: {
      prompt: "Which label should PE2 allocate for this VRF CUST-A route?",
      options: [
        { id: "correct", label: "24002 — a label PE2 itself allocates" },
        { id: "transport", label: "102 — the transport label" },
        { id: "pe1-label", label: "24001 — PE1's own VPN label" },
        { id: "implicit-null", label: "implicit-null" },
      ],
      correctOptionId: "correct",
      explanation: "The VPN label is allocated by the egress PE (PE2) for its own forwarding context — it's unrelated to the transport label (which comes from LDP) and unrelated to any other router's label space.",
    },
  },
  {
    id: "break-intro",
    label: "Break The Network",
    narrative: "Everything has worked cleanly so far. Time to break something specific: PE1's CUST-A import policy.",
  },
  {
    id: "fault-injected",
    label: "RT Import Misconfigured",
    narrative: "An engineer changes PE1's CUST-A import RT to 65001:999. It no longer matches PE2's export RT (65001:100) — the previously imported route is withdrawn from the VRF.",
    run: (state) => {
      const vrfs = { ...state.vrfs };
      vrfs.PE1 = (vrfs.PE1 ?? []).map((v) => (v.name === "CUST-A" ? { ...v, importRt: "65001:999", routes: v.routes.filter((r) => r.prefix !== CE2_PREFIX) } : v));
      const received = state.received.PE1 ? { ...state.received.PE1, rtChecked: true, rtMatched: false, imported: false } : undefined;
      return {
        state: { ...state, vrfs, received: received ? { ...state.received, PE1: received } : state.received, faultActive: true },
        events: [
          { type: "RT_IMPORT_EVALUATED", stepId: "fault-injected", timestamp: Date.now(), message: "PE1 import RT changed to 65001:999 — no longer matches" },
          { type: "VPN_ROUTE_WITHDRAWN", stepId: "fault-injected", timestamp: Date.now(), message: "10.2.2.0/24 withdrawn from CUST-A" },
        ],
      };
    },
    whatChanged: () => ["PE1 CUST-A import RT: 65001:100 → 65001:999", "CUST-A routes: 10.1.1.0/24, 10.2.2.0/24 → 10.1.1.0/24 (10.2.2.0/24 removed)"],
  },
  {
    id: "trouble-intro",
    label: "Troubleshoot",
    narrative:
      "Complaint: \"MP-BGP is Established. PE1 can reach PE2's loopback. MPLS transport is operational. PE1 receives the VPN route through MP-BGP. But 10.2.2.0/24 does not appear in CUST-A.\" Inspect the MP-BGP session, the received VPNv4 route, its RD and RT, the VRF route table, LDP, and MPLS forwarding before you answer.",
  },
  {
    id: "trouble-question",
    label: "Troubleshoot",
    narrative: "Every layer beneath VPN policy is healthy.",
    question: {
      prompt: "Where is the route disappearing?",
      options: [
        { id: "mpbgp", label: "The MP-BGP session itself" },
        { id: "transport", label: "The MPLS transport LSP" },
        { id: "rt", label: "Route Target import policy on PE1" },
        { id: "rd", label: "A Route Distinguisher mismatch" },
      ],
      correctOptionId: "rt",
      explanation:
        "MP-BGP Established does not mean every VPN route is correctly imported — that's a separate policy check. The route is received (MP-BGP is fine) but PE1's import RT no longer matches PE2's export RT, so it's never installed into CUST-A.",
      hints: [
        "Hint 1: MP-BGP is Established. Do not troubleshoot TCP first.",
        "Hint 2: The route does appear in PE1's received VPNv4 table.",
        "Hint 3: Compare the route's export RT with CUST-A's import RT.",
      ],
    },
  },
  {
    id: "diagnostic-layers",
    label: "Layer By Layer",
    narrative:
      "MP-BGP Established doesn't mean every VPN route is correctly imported. MPLS transport working doesn't mean VPN control-plane policy is correct. Troubleshooting by layer shows exactly where this fault actually lives: everything below RT import is healthy.",
  },
  {
    id: "repair-challenge",
    label: "Apply The Fix",
    narrative: "Choose the correct repair for PE1's VRF CUST-A.",
    action: (state, payload) => {
      const choice = typeof payload === "object" && payload !== null && "choice" in payload ? String((payload as { choice: string }).choice) : "";
      if (choice !== "fix-rt") {
        return { state: { ...state, repairAttempt: { choice, correct: false } }, events: [] };
      }
      const vrfs = { ...state.vrfs };
      vrfs.PE1 = (vrfs.PE1 ?? []).map((v) => (v.name === "CUST-A" ? { ...v, importRt: CUST_A_RT, routes: [...v.routes.filter((r) => r.prefix !== CE2_PREFIX), { prefix: CE2_PREFIX, origin: "imported" as const, rd: CUST_A_RD.PE2, viaPe: "PE2" as RouterId }] } : v));
      const received = state.received.PE1 ? { ...state.received.PE1, rtChecked: true, rtMatched: true, imported: true } : undefined;
      return {
        state: { ...state, vrfs, received: received ? { ...state.received, PE1: received } : state.received, faultActive: false, repairAttempt: { choice, correct: true }, challengeSucceeded: true },
        events: [
          { type: "RT_IMPORT_EVALUATED", stepId: "repair-challenge", timestamp: Date.now(), message: "PE1 import RT corrected to 65001:100 — match" },
          { type: "VPN_ROUTE_IMPORTED", stepId: "repair-challenge", timestamp: Date.now(), message: "10.2.2.0/24 re-imported into CUST-A" },
          { type: "VPN_ROUTE_INSTALLED", stepId: "repair-challenge", timestamp: Date.now(), message: "Route installed" },
        ],
      };
    },
    requiresState: (state) => state.challengeSucceeded === true,
  },
  {
    id: "verify-dataplane",
    label: "Verify End To End",
    narrative: "Send a packet through again to prove the repair actually restored the data plane, not just the control plane.",
    packet: () => ({ id: "ip-verify", protocol: "IP", from: "CE1", to: "PE1", summary: "Verification packet, no labels", layers: [ipLayer(CE1_IP, CE2_IP)] }),
    run: (state) => {
      const pushVpn = pushLabel({ srcIp: CE1_IP, dstIp: CE2_IP, labels: [] }, 24002, "vpn");
      const pushBoth = pushLabel(pushVpn, 102, "transport");
      const swapped = swapTopLabel(pushBoth, 203);
      const popped = popTopLabel(swapped);
      const journey = [
        { router: "PE1" as RouterId, input: "IP packet (VRF CUST-A match)", lookup: "VRF lookup + LFIB", action: "PUSH" as ForwardingAction, output: "[102][24002][IP]" },
        { router: "P1" as RouterId, input: "[102][24002][IP]", lookup: "LFIB: 102 → 203", action: "SWAP" as ForwardingAction, output: "[203][24002][IP]" },
        { router: "P2" as RouterId, input: "[203][24002][IP]", lookup: "LFIB: 203 → POP", action: "POP" as ForwardingAction, output: "[24002][IP]" },
        { router: "PE2" as RouterId, input: "[24002][IP]", lookup: "VPN label 24002 → VRF CUST-A", action: "VPN_LOOKUP" as ForwardingAction, output: "IP packet → CE2" },
      ];
      return {
        state: { ...state, packet: { ...popped, labels: [] }, packetAt: "CE2", journey },
        events: [
          { type: "TRANSPORT_LABEL_PUSHED", stepId: "verify-dataplane", timestamp: Date.now(), message: "PE1 pushes VPN + transport labels" },
          { type: "TRANSPORT_LABEL_SWAPPED", stepId: "verify-dataplane", timestamp: Date.now(), message: "P1 swaps the transport label" },
          { type: "TRANSPORT_LABEL_POPPED", stepId: "verify-dataplane", timestamp: Date.now(), message: "P2 pops the transport label (PHP)" },
          { type: "VPN_PACKET_DELIVERED", stepId: "verify-dataplane", timestamp: Date.now(), message: "PE2 delivers to CE2 via CUST-A — LSP + VPN fully restored" },
        ],
      };
    },
    whatChanged: () => [
      "✓ VPN route imported",
      "✓ Customer VRF updated",
      "✓ VPN label installed",
      "✓ Transport LSP resolved",
      "✓ Two-label stack created",
      "✓ Packet delivered to CE2",
    ],
  },
  {
    id: "complete",
    label: "Lesson Complete",
    narrative: "CE1 can reach CE2 again — end to end, through a real VRF, a real RD/RT policy, real MP-BGP-advertised state, and a real two-label stack, all rebuilt by the exact same mechanics you watched the first time.",
  },
];

// ---------------------------------------------------------------------------
// Read-only CLI panel (brief §23/§24)
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

export function buildL3vpnCliCommands(state: L3VpnState, router: RouterId): CliCommandEntry[] {
  const vrfs = state.vrfs[router] ?? [];
  const custA = vrfs.find((v) => v.name === "CUST-A");

  const vrfSummaryCisco: CliOutput = {
    cmd: "show vrf",
    output: vrfs.length
      ? `${pad("Name", 12)}${pad("Default RD", 16)}${pad("Protocols", 12)}Interfaces\n${vrfs.map((v) => `${pad(v.name, 12)}${pad(v.name === "CUST-A" ? (CUST_A_RD[router] ?? "-") : (CUST_B_RD[router] ?? "-"), 16)}${pad("ipv4", 12)}Gi0/1`).join("\n")}`
      : "(no VRFs configured)",
  };
  const vrfSummaryJuniper: CliOutput = {
    cmd: `show route table ${custA ? "CUST-A.inet.0" : "<vrf>.inet.0"}`,
    output: custA ? custA.routes.map((r) => `${r.prefix} ${r.origin === "local" ? "(1 entry)" : `*[BGP/170] via ${r.viaPe}`}`).join("\n") : "(no such table)",
  };

  const routeRowsCisco = custA
    ? custA.routes.map((r) => `${r.origin === "local" ? "C" : "B"}    ${r.prefix} ${r.origin === "local" ? "is directly connected" : `[200/0] via ${r.viaPe} (rd ${r.rd})`}`).join("\n")
    : "% VRF CUST-A not found";
  const vrfRouteCisco: CliOutput = { cmd: "show ip route vrf CUST-A", output: routeRowsCisco };
  const vrfRouteJuniper: CliOutput = vrfSummaryJuniper;

  const receivedAtRouter = state.received[router];
  const bgpVpnv4Rows: string[] = [];
  if (custA) {
    for (const r of custA.routes) {
      if (r.origin === "local") continue;
      bgpVpnv4Rows.push(`*  ${r.rd}:${r.prefix}    ${receivedAtRouter?.route.nextHop ?? "-"}    0    ${CUST_A_RT}    ?`);
    }
  }
  const bgpVpnv4Cisco: CliOutput = {
    cmd: "show bgp vpnv4 unicast vrf CUST-A",
    output: `${pad("Network", 24)}${pad("Next Hop", 16)}${pad("Metric", 8)}${pad("RT", 12)}Path\n${bgpVpnv4Rows.join("\n") || "(no VPNv4 routes)"}`,
  };
  const bgpVpnv4Juniper: CliOutput = {
    cmd: "show route table bgp.l3vpn.0",
    output: bgpVpnv4Rows.length
      ? bgpVpnv4Rows.map((r) => r.replace("*  ", "")).map((r) => r.split("    ")).map(([nlri, nh]) => `${nlri}\n    *[BGP/170] via ${nh}, label-switched-path`).join("\n")
      : "bgp.l3vpn.0: 0 destinations",
  };

  const lfibRowsCisco = PROVIDER_ROUTERS.map((r) => state.transportLfib[r]).filter((e): e is NonNullable<typeof e> => Boolean(e));
  const entry = state.transportLfib[router];
  const mplsCisco: CliOutput = {
    cmd: "show mpls forwarding-table",
    output: entry
      ? `${pad("Local", 10)}${pad("Outgoing", 14)}${pad("Prefix", 18)}Outgoing\n${pad("Label", 10)}${pad("Label", 14)}${pad("or VC", 18)}interface\n${pad(entry.incomingLabel === "UNLABELED" ? "-" : String(entry.incomingLabel), 10)}${pad(entry.action === "POP" ? "Pop Label" : String(entry.outgoingLabel), 14)}${pad("4.4.4.4/32", 18)}${entry.outgoingInterface ?? "-"}`
      : "(no entries)",
  };
  const mplsJuniper: CliOutput = {
    cmd: "show route table mpls.0",
    output: entry ? `${entry.incomingLabel === "UNLABELED" ? "(PE ingress)" : entry.incomingLabel}\n    *[LDP/9] via ${entry.outgoingInterface ?? "-"}, ${entry.action === "POP" ? "Pop" : `Swap ${entry.outgoingLabel}`}` : "mpls.0: 0 destinations",
  };
  void lfibRowsCisco;

  const ldpCisco: CliOutput = { cmd: "show mpls ldp neighbor", output: "All provider-facing LDP sessions: Operational (see the MPLS/LDP lesson)" };
  const ldpJuniper: CliOutput = { cmd: "show ldp neighbor", output: "State: Operational (see the MPLS/LDP lesson)" };

  return [
    { id: "vrf", label: "vrf summary", cisco: vrfSummaryCisco, juniper: vrfSummaryJuniper },
    { id: "vrf-route", label: "vrf route", cisco: vrfRouteCisco, juniper: vrfRouteJuniper },
    { id: "bgp-vpnv4", label: "bgp vpnv4", cisco: bgpVpnv4Cisco, juniper: bgpVpnv4Juniper },
    { id: "mpls", label: "mpls forwarding", cisco: mplsCisco, juniper: mplsJuniper },
    { id: "ldp", label: "ldp neighbor", cisco: ldpCisco, juniper: ldpJuniper },
  ];
}
