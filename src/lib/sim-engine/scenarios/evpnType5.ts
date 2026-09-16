import type { PacketVisual, ScenarioStep } from "../types";
import {
  ANYCAST_GATEWAYS,
  GATEWAY_MAC,
  HOST_A_IP,
  HOST_A_MAC,
  HOST_B_IP,
  HOST_B_MAC,
  L3_VNI,
  ROUTER_MAC,
  VRF,
  VTEP_LOOPBACK,
  buildPacketLayers,
  type IrbFrame,
  type LeafId,
} from "./evpnIrb";

/**
 * EVPN Route Type 5 — IP Prefix Advertisement. The fourth lesson in
 * the EVPN track, extending the SAME fabric "EVPN IRB + Distributed
 * Anycast Gateway" built (see docs/ARCHITECTURE.md §4 for why this
 * reuses plain constants and the parameterized `buildPacketLayers`/
 * `IrbFrame` shape from that lesson's own scenario file — Type 5
 * traffic still forwards over the exact same symmetric-IRB / L3 VNI
 * mechanism, so the wire format doesn't change, only the control
 * plane that populated the route does).
 *
 * The question this lesson answers: Type 2 (already taught) answers
 * "where is this ONE host's MAC/IP?" — but what about an entire IP
 * prefix (172.16.50.0/24) that was never individually learned as a
 * host at all? Something has to advertise "this whole prefix lives
 * behind this VTEP," not one address at a time. That's EVPN Route
 * Type 5 — an IP Prefix Route.
 *
 * Explicitly DEFERRED: MAC Mobility, ARP/ND Suppression, EVPN
 * multihoming, ESI, DF election (per the user's own stated sequence,
 * these come after Type 5). This lesson also does NOT build a full
 * external-BGP/VRF-Lite course — 172.16.50.0/24 is simply a
 * connected/static prefix already sitting in LEAF3's own VRF, exactly
 * as the brief specifies is acceptable for this introductory lesson.
 *
 * Pure data + pure functions only — see /lib/sim-engine/types.ts.
 */

export type LeafIdT5 = LeafId;
export type EvpnType5DeviceId = "HOST-A" | LeafIdT5 | "SPINE1" | "HOST-C" | "HOST-B" | "BORDER-SVR";
export const FABRIC_DEVICES: EvpnType5DeviceId[] = ["LEAF1", "SPINE1", "LEAF2", "LEAF3"];

export { ANYCAST_GATEWAYS, GATEWAY_MAC, HOST_A_IP, HOST_A_MAC, HOST_B_IP, HOST_B_MAC, L3_VNI, ROUTER_MAC, VRF, VTEP_LOOPBACK };
export const HOST_C_IP = "10.10.10.33";
export const HOST_C_MAC = "CC:CC:CC:CC:CC:33";

export const TENANT_PREFIX = "172.16.50.0/24";
export const TENANT_PREFIX_WIDE = "172.16.0.0/16";
export const DESTINATION_IP = "172.16.50.10";
const EVPN_EXPORT_RT = "65000:50000";

function rdFor(leaf: LeafIdT5): string {
  return `${VTEP_LOOPBACK[leaf]}:${L3_VNI}`;
}

export const TERMS: { term: string; expansion: string; meaning: string }[] = [
  { term: "Type 5", expansion: "IP Prefix Route", meaning: "Advertises an entire IP prefix's reachability through a remote VTEP — not one host's MAC/IP." },
  { term: "LPM", expansion: "Longest Prefix Match", meaning: "Ordinary routing behavior: the most specific matching prefix wins, chosen the same way with or without EVPN." },
  { term: "RD vs RT", expansion: "Uniqueness vs. Policy", meaning: "RD only makes a route unique in BGP. RT is what actually controls whether a VRF imports it — unchanged from every earlier EVPN/L3VPN lesson." },
  { term: "GW IP", expansion: "Type-5 Overlay Gateway IP", meaning: "An advanced NLRI field, usually 0.0.0.0 in this symmetric-IRB model — routing here happens via Router MAC, not an overlay gateway IP." },
  { term: "Route ≠ Forwarding", expansion: "Receiving ≠ Usable", meaning: "A route can be received and RT-imported yet still be unusable if its next-hop VTEP can't be resolved through the underlay." },
];

// ---------------------------------------------------------------------------
// Type 5 route model
// ---------------------------------------------------------------------------

export interface Type5Route {
  prefix: string;
  rd: string;
  rt: string;
  nextHop: string; // origin leaf's VTEP
  l3Vni: number;
  originLeaf: LeafIdT5;
  esi: string;
  ethernetTagId: number;
  gatewayIp: string;
}
function makeType5Route(prefix: string, originLeaf: LeafIdT5): Type5Route {
  return { prefix, rd: rdFor(originLeaf), rt: EVPN_EXPORT_RT, nextHop: VTEP_LOOPBACK[originLeaf], l3Vni: L3_VNI, originLeaf, esi: "0000.0000.0000.0000.0000 (none)", ethernetTagId: 0, gatewayIp: "0.0.0.0 (routed via RMAC, not an overlay GW IP)" };
}

export interface ReceivedType5Route {
  route: Type5Route;
  rtChecked: boolean;
  rtMatched: boolean;
  imported: boolean;
  vtepResolved: boolean;
}

/** A static, non-simulated Type 2 host route — only for the "host route vs. prefix route" comparison (brief §13); Type 2 itself was already fully taught in the Foundations lesson. */
export const EXAMPLE_TYPE2_ROUTE = { mac: HOST_B_MAC, ip: HOST_B_IP, originLeaf: "LEAF3" as LeafIdT5, rd: rdFor("LEAF3"), rt: EVPN_EXPORT_RT };

export type IrbAction = "IRB_ROUTE_AND_ENCAP" | "UNDERLAY_FORWARD" | "IRB_DECAP_AND_ROUTE";
export interface JourneyHop {
  device: EvpnType5DeviceId;
  input: string;
  lookup: string;
  action: IrbAction;
  output: string;
}

export interface EvpnType5State {
  bgpSessionUp: boolean;
  type5Route?: Type5Route; // 172.16.50.0/24 via LEAF3 — the one route this lesson builds live
  type5RouteWide?: Type5Route; // 172.16.0.0/16 via LEAF2 — introduced later for the LPM experiment
  received: Partial<Record<LeafIdT5, ReceivedType5Route[]>>;
  vtepReachable: Record<LeafIdT5, boolean>; // underlay reachability to each leaf's own VTEP, as seen fabric-wide — the fault lives here (LEAF3's)

  packet?: IrbFrame;
  packetAt?: EvpnType5DeviceId;
  journey: JourneyHop[];

  faultActive: boolean;
  repairAttempt?: { choice: string; correct: boolean };
  challengeSucceeded?: boolean;
}

export function createEvpnType5State(): EvpnType5State {
  return {
    bgpSessionUp: false,
    received: {},
    vtepReachable: { LEAF1: true, LEAF2: true, LEAF3: true },
    journey: [],
    faultActive: false,
  };
}

// ---------------------------------------------------------------------------
// Graph layout — the same fabric the IRB lesson built, plus one visual-only
// node (BORDER-SVR) grounding where 172.16.50.0/24 actually originates.
// ---------------------------------------------------------------------------

interface GNode {
  id: string;
  label: string;
  x: number;
  y: number;
  subLabel?: string;
  kind?: "server" | "switch" | "cloud";
}
interface GEdge {
  id: string;
  a: string;
  b: string;
  label?: string;
}

export const GRAPH_NODES: GNode[] = [
  { id: "HOST-A", label: "HOST-A", x: 12, y: 88, subLabel: `${HOST_A_IP} · VLAN 10`, kind: "server" },
  { id: "LEAF1", label: "LEAF1", x: 12, y: 58, subLabel: `VTEP ${VTEP_LOOPBACK.LEAF1}`, kind: "switch" },
  { id: "SPINE1", label: "SPINE1", x: 50, y: 18, subLabel: "Underlay only", kind: "switch" },
  { id: "HOST-C", label: "HOST-C", x: 45, y: 88, subLabel: `${HOST_C_IP} · VLAN 10`, kind: "server" },
  { id: "LEAF2", label: "LEAF2", x: 45, y: 58, subLabel: `VTEP ${VTEP_LOOPBACK.LEAF2}`, kind: "switch" },
  { id: "HOST-B", label: "HOST-B", x: 78, y: 88, subLabel: `${HOST_B_IP} · VLAN 20`, kind: "server" },
  { id: "LEAF3", label: "LEAF3", x: 78, y: 58, subLabel: `VTEP ${VTEP_LOOPBACK.LEAF3}`, kind: "switch" },
  { id: "BORDER-SVR", label: "BORDER/SERVER", x: 95, y: 88, subLabel: `${TENANT_PREFIX} (external)`, kind: "server" },
];
export const GRAPH_EDGES: GEdge[] = [
  { id: "HOST-A-LEAF1", a: "HOST-A", b: "LEAF1" },
  { id: "HOST-C-LEAF2", a: "HOST-C", b: "LEAF2" },
  { id: "HOST-B-LEAF3", a: "HOST-B", b: "LEAF3" },
  { id: "BORDER-LEAF3", a: "BORDER-SVR", b: "LEAF3", label: "Connected/Static" },
  { id: "LEAF1-SPINE1", a: "LEAF1", b: "SPINE1", label: "Underlay" },
  { id: "LEAF2-SPINE1", a: "LEAF2", b: "SPINE1", label: "Underlay" },
  { id: "LEAF3-SPINE1", a: "LEAF3", b: "SPINE1", label: "Underlay" },
];
export const GRAPH_REGIONS = [{ id: "underlay", label: "IP Underlay Fabric (Spine-Leaf)", x: 4, y: 6, width: 92, height: 60, tone: "cyan" as const }];

export function withEvpnMesh(nodes: GNode[], edges: GEdge[], active: boolean): { nodes: GNode[]; edges: GEdge[] } {
  if (!active) return { nodes, edges };
  return {
    nodes,
    edges: [
      ...edges,
      { id: "LEAF1-LEAF2-evpn", a: "LEAF1", b: "LEAF2", label: "BGP EVPN" },
      { id: "LEAF2-LEAF3-evpn", a: "LEAF2", b: "LEAF3", label: "BGP EVPN" },
      { id: "LEAF1-LEAF3-evpn", a: "LEAF1", b: "LEAF3", label: "BGP EVPN" },
    ],
  };
}

/** Logical view (brief §16) — TENANT-A's own routing view: HOST-A's subnet routes, underneath, to the tenant prefix — the EVPN Type 5 control plane is what made that routing information exist at all. */
export const LOGICAL_GRAPH_NODES: GNode[] = [
  { id: "HOST-A", label: "HOST-A", x: 20, y: 8, subLabel: HOST_A_IP, kind: "server" },
  { id: "VLAN10", label: "VLAN 10 / HOST-A Subnet", x: 20, y: 28, subLabel: "10.10.10.0/24", kind: "cloud" },
  { id: "VRF", label: `VRF ${VRF}`, x: 50, y: 48, subLabel: "Routing", kind: "cloud" },
  { id: "TYPE5", label: "EVPN Type 5 Control Plane", x: 50, y: 66, subLabel: "LEAF3 → LEAF1", kind: "cloud" },
  { id: "PREFIX", label: TENANT_PREFIX, x: 80, y: 88, subLabel: "via LEAF3", kind: "cloud" },
];
export const LOGICAL_GRAPH_EDGES: GEdge[] = [
  { id: "HOST-A-VLAN10", a: "HOST-A", b: "VLAN10" },
  { id: "VLAN10-VRF", a: "VLAN10", b: "VRF", label: "VRF routing" },
  { id: "VRF-PREFIX", a: "VRF", b: "PREFIX" },
  { id: "TYPE5-VRF", a: "TYPE5", b: "VRF", label: "installs route" },
];

// ---------------------------------------------------------------------------
// Packet builders
// ---------------------------------------------------------------------------

function frame(overrides: Partial<IrbFrame> = {}): IrbFrame {
  return { innerSrcMac: HOST_A_MAC, innerDstMac: GATEWAY_MAC, innerSrcIp: HOST_A_IP, innerDstIp: DESTINATION_IP, encapsulated: false, routed: false, ...overrides };
}
function framePacket(id: string, from: EvpnType5DeviceId, to: EvpnType5DeviceId, summary: string, badge: string, f: IrbFrame): PacketVisual {
  return { id, protocol: f.encapsulated ? "VXLAN" : "ETHERNET", from, to, summary, badge, layers: buildPacketLayers(f) };
}

function type5Packet(id: string, from: LeafIdT5, to: LeafIdT5, route: Type5Route): PacketVisual {
  return {
    id,
    protocol: "BGP",
    from,
    to,
    summary: `EVPN Type 5 — ${route.prefix}`,
    badge: "EVPN TYPE 5 UPDATE",
    layers: [
      {
        name: "BGP UPDATE (EVPN)",
        color: "var(--pv-proto-bgp)",
        fields: [
          { label: "AFI/SAFI", value: "L2VPN EVPN" },
          { label: "Route Type", value: "5 (IP Prefix Route)" },
          { label: "RD", value: route.rd },
          { label: "IP Prefix", value: route.prefix },
          { label: "Route Target", value: route.rt },
          { label: "Next Hop", value: route.nextHop },
          { label: "L3 VNI", value: String(route.l3Vni) },
          { label: "ESI (Advanced)", value: route.esi },
          { label: "Ethernet Tag ID (Advanced)", value: String(route.ethernetTagId) },
          { label: "GW IP (Advanced)", value: route.gatewayIp },
        ],
      },
    ],
  };
}

function layerIndex(packet: PacketVisual | undefined, name: string): number[] | undefined {
  const i = packet?.layers.findIndex((l) => l.name === name) ?? -1;
  return i >= 0 ? [i] : undefined;
}
export function outerIpLayerIndex(packet: PacketVisual | undefined): number[] | undefined {
  return layerIndex(packet, "Outer IP");
}
export function leaf1FocusIndices(packet: PacketVisual | undefined): number[] | undefined {
  const idx = [layerIndex(packet, "Inner IP")?.[0], layerIndex(packet, "VXLAN Header")?.[0], layerIndex(packet, "Outer IP")?.[0]].filter((n): n is number => n !== undefined);
  return idx.length ? idx : undefined;
}
export function leaf3FocusIndices(packet: PacketVisual | undefined): number[] | undefined {
  const idx = [layerIndex(packet, "VXLAN Header")?.[0], layerIndex(packet, "Inner IP")?.[0]].filter((n): n is number => n !== undefined);
  return idx.length ? idx : undefined;
}
export function ipv4LayerIndex(packet: PacketVisual | undefined): number[] | undefined {
  return layerIndex(packet, "IPv4");
}

// ---------------------------------------------------------------------------
// Scenario steps
// ---------------------------------------------------------------------------

export const evpnType5Steps: ScenarioStep<EvpnType5State>[] = [
  {
    id: "intro",
    label: "Beyond One Host At A Time",
    narrative: `Type 2 already taught you HOST-B: MAC ${HOST_B_MAC}, IP ${HOST_B_IP} — one host, individually learned. But LEAF3 also has an entire external prefix behind it, ${TENANT_PREFIX}, that was never an individually-learned host at all.`,
  },
  {
    id: "predict-prefix-vs-host",
    label: "Predict",
    narrative: "Before naming the mechanism:",
    question: {
      prompt: `Can an EVPN Type 2 route efficiently advertise an entire prefix like ${TENANT_PREFIX}, the same way it advertises one host's MAC/IP?`,
      options: [
        { id: "yes", label: "Yes — Type 2 already generalizes to any prefix length" },
        { id: "no", label: "No — Type 2 is scoped to individual MAC/IP endpoints, not prefixes" },
        { id: "vlan-only", label: "Only if the prefix is a single VLAN" },
        { id: "ipv6-only", label: "Only for IPv6 prefixes" },
      ],
      correctOptionId: "no",
      explanation: "Type 2 carries one MAC (optionally with one IP) at a time — it has no concept of prefix length at all. An entire subnet's worth of reachability needs a different route type.",
    },
  },
  {
    id: "type5-intro",
    label: "EVPN Route Type 5 — IP Prefix Route",
    narrative: `That route is EVPN Route Type 5 — an IP Prefix Route. It advertises "this entire prefix (${TENANT_PREFIX}) is reachable through this VTEP," never one host at a time.`,
    run: (state) => ({ state: { ...state, bgpSessionUp: true }, events: [{ type: "BGP_STATE_CHANGED", stepId: "type5-intro", timestamp: Date.now(), message: "LEAF1 ↔ LEAF2 ↔ LEAF3 BGP EVPN mesh Established" }] }),
  },
  {
    id: "type2-vs-type3-vs-type5",
    label: "Three Routes, Three Questions",
    narrative: 'Type 2: "Where is this MAC/IP endpoint?" Type 3: "Who participates in this VNI/BUM domain?" Type 5: "Where is this IP prefix?" All three are ordinary EVPN routes carried the same way — they just answer different questions.',
  },
  {
    id: "prefix-on-leaf3",
    label: "The Prefix, Only On LEAF3 So Far",
    narrative: `LEAF3's VRF ${VRF} already has ${TENANT_PREFIX} — a connected/static tenant route (the exact origin doesn't matter for this lesson). Inspect LEAF1's own VRF ${VRF}: no route for ${TENANT_PREFIX} exists there yet.`,
  },
  {
    id: "create-type5-route",
    label: "Building The Type 5 Route",
    narrative: `LEAF3 takes its own VRF prefix, attaches an RD (uniqueness) and RT (import policy), and creates an EVPN Type 5 route: prefix ${TENANT_PREFIX}, next-hop = LEAF3's own VTEP, L3 VNI ${L3_VNI}.`,
    run: (state) => ({ state: { ...state, type5Route: makeType5Route(TENANT_PREFIX, "LEAF3") }, events: [{ type: "VPN_ROUTE_CREATED", stepId: "create-type5-route", timestamp: Date.now(), message: `LEAF3 creates a Type 5 route for ${TENANT_PREFIX}` }] }),
    whatChanged: () => [`LEAF3: EVPN Type 5 route built — ${TENANT_PREFIX} via ${VTEP_LOOPBACK.LEAF3}`],
  },
  {
    id: "type5-route-object",
    label: "The Route, As One Object",
    narrative: "Click the Type 5 route object: prefix, RD, RT, next-hop, and L3 VNI up front. An [Advanced] section behind that carries ESI, Ethernet Tag ID, and GW IP — standard Type-5 NLRI fields a beginner doesn't need yet.",
  },
  {
    id: "type5-bgp-update",
    label: "BGP EVPN UPDATE",
    narrative: "LEAF3 advertises the Type 5 route to LEAF1 over the exact same BGP UPDATE mechanism every earlier EVPN route type reused.",
    packet: (state) => (state.type5Route ? type5Packet("t5-update", "LEAF3", "LEAF1", state.type5Route) : undefined),
    run: (state) => ({ state, events: [{ type: "MPBGP_VPN_ROUTE_ADVERTISED", stepId: "type5-bgp-update", timestamp: Date.now(), message: "LEAF3 advertises the Type 5 route" }] }),
  },
  {
    id: "enter-leaf1-type5-import",
    label: "LEAF1 — Conceptual EVPN Type-5 Import Pipeline",
    narrative: "Enter LEAF1: the BGP EVPN UPDATE arrives, its Route Type is 5, LEAF1 reads the RD/prefix, evaluates the Route Target, and — on a match — resolves the next-hop VTEP and installs the route into VRF TENANT-A.",
    run: (state) => ({ state, events: [{ type: "VRF_ROUTE_SELECTED", stepId: "enter-leaf1-type5-import", timestamp: Date.now(), message: "LEAF1 begins Type 5 import processing" }] }),
  },
  {
    id: "predict-rt-import",
    label: "Predict",
    narrative: `LEAF1's VRF ${VRF} import RT is ${EVPN_EXPORT_RT}. The Type 5 route's RT is ${EVPN_EXPORT_RT}.`,
    question: {
      prompt: `Does VRF ${VRF} import this Type 5 route?`,
      options: [
        { id: "yes", label: "Yes — the RT matches" },
        { id: "no", label: "No — RD and RT are being confused here" },
        { id: "depends", label: "Depends on the prefix length" },
      ],
      correctOptionId: "yes",
      explanation: "Same rule as every earlier route type: RT policy decides import, RD only guarantees uniqueness. The RTs match, so it's imported.",
    },
  },
  {
    id: "vrf-route-installed",
    label: "Installed",
    narrative: `Before: VRF ${VRF} on LEAF1 had no route for ${TENANT_PREFIX}. After: ${TENANT_PREFIX} is installed, reachable via remote EVPN/VTEP reachability — LEAF3, L3 VNI ${L3_VNI}.`,
    run: (state) => {
      if (!state.type5Route) return { state, events: [] };
      const route = state.type5Route;
      const received: ReceivedType5Route = { route, rtChecked: true, rtMatched: true, imported: true, vtepResolved: state.vtepReachable.LEAF3 };
      return { state: { ...state, received: { ...state.received, LEAF1: [received], LEAF2: [received] } }, events: [{ type: "VPN_ROUTE_IMPORTED", stepId: "vrf-route-installed", timestamp: Date.now(), message: `LEAF1 installs ${route.prefix} into VRF ${VRF}` }] };
    },
    whatChanged: () => [`LEAF1 VRF ${VRF}: BEFORE — no route for ${TENANT_PREFIX}`, `LEAF1 VRF ${VRF}: AFTER — ${TENANT_PREFIX} via LEAF3 (remote EVPN/VTEP reachability)`],
  },
  {
    id: "evpn-table-recap",
    label: "One Table, Three Route Types",
    narrative: "Open the EVPN Routes tab on any leaf: Type 2 (MAC/IP), Type 3 (IMET), and now Type 5 (IP Prefix) all sit in the same table, filterable by type — the same generic view every future EVPN route type will reuse.",
  },
  {
    id: "host-a-sends",
    label: `HOST-A Sends Toward ${DESTINATION_IP}`,
    narrative: `HOST-A sends toward its local Anycast Gateway first — exactly like every earlier inter-subnet frame. Ethernet destination is still the gateway; IP destination is ${DESTINATION_IP}.`,
    packet: () => framePacket("f-before", "HOST-A", "LEAF1", "Ethernet dst = Anycast Gateway, IP dst = tenant prefix", "FRAME", frame()),
    run: (state) => ({ state: { ...state, packet: frame(), packetAt: "LEAF1" }, events: [{ type: "PACKET_SENT", stepId: "host-a-sends", timestamp: Date.now(), message: "HOST-A sends toward its gateway" }] }),
  },
  {
    id: "enter-leaf1-forwarding",
    label: "LEAF1 — Longest-Prefix Match",
    narrative: `LEAF1 routes into VRF ${VRF}: destination ${DESTINATION_IP}. A longest-prefix match against every candidate route selects the Type-5-learned ${TENANT_PREFIX} — remote VTEP LEAF3, L3 VNI ${L3_VNI}.`,
    packet: (state) => (state.packet ? framePacket("f-lpm", "HOST-A", "LEAF1", `${DESTINATION_IP} matches ${TENANT_PREFIX}`, "FRAME", state.packet) : undefined),
  },
  {
    id: "packet-transformation",
    label: "Routed VXLAN Encapsulation",
    narrative: `LEAF1 rewrites the inner Ethernet header to router MACs (advanced, symmetric-IRB detail), keeps the inner IP exactly HOST-A → ${DESTINATION_IP}, and wraps it in VXLAN — L3 VNI ${L3_VNI}, the exact same routed transport every earlier inter-subnet frame used.`,
    packet: (state) => (state.packet ? framePacket("f-encap", "LEAF1", "SPINE1", `Routed + VXLAN-encapsulated — L3 VNI ${L3_VNI}`, "VXLAN", { ...state.packet, encapsulated: true, routed: true, l3Vni: L3_VNI, innerSrcMac: ROUTER_MAC.LEAF1, innerDstMac: ROUTER_MAC.LEAF3, outerSrcVtep: VTEP_LOOPBACK.LEAF1, outerDstVtep: VTEP_LOOPBACK.LEAF3 }) : undefined),
    run: (state) => {
      const encapsulated: IrbFrame = { ...(state.packet ?? frame()), encapsulated: true, routed: true, l3Vni: L3_VNI, innerSrcMac: ROUTER_MAC.LEAF1, innerDstMac: ROUTER_MAC.LEAF3, outerSrcVtep: VTEP_LOOPBACK.LEAF1, outerDstVtep: VTEP_LOOPBACK.LEAF3 };
      const received = state.received.LEAF1?.[0];
      const usable = !!received?.imported && received.vtepResolved;
      const journey: JourneyHop[] = [...state.journey, { device: "LEAF1", input: `IP[HOST-A → ${DESTINATION_IP}]`, lookup: `VRF ${VRF} LPM: ${TENANT_PREFIX} via LEAF3, L3 VNI ${L3_VNI}`, action: "IRB_ROUTE_AND_ENCAP", output: usable ? `VXLAN(L3 VNI ${L3_VNI}) → ${VTEP_LOOPBACK.LEAF3}` : "DROPPED — remote VTEP not resolvable through the underlay" }];
      if (!usable) return { state: { ...state, journey }, events: [{ type: "L3VNI_MAPPING_MISMATCH", stepId: "packet-transformation", timestamp: Date.now(), message: "Route imported but next-hop VTEP is unreachable — packet dropped" }] };
      return { state: { ...state, packet: encapsulated, packetAt: "SPINE1", journey }, events: [{ type: "ROUTED_VXLAN_ENCAPSULATED", stepId: "packet-transformation", timestamp: Date.now(), message: "LEAF1 completes routed VXLAN encapsulation" }] };
    },
  },
  {
    id: "spine-forward-type5",
    label: "SPINE1 — Outer IP Only",
    narrative: "SPINE1 reads only the outer destination VTEP IP and forwards. It has no idea a tenant prefix, a VRF, or a Type 5 route exist at all — that's true regardless of which route type populated the forwarding decision upstream.",
    packet: (state) => (state.packet ? framePacket("f-spine", "SPINE1", "LEAF3", "VXLAN in flight — outer IP forwarding only", "VXLAN", state.packet) : undefined),
    run: (state) => ({ state: { ...state, packetAt: "LEAF3", journey: [...state.journey, { device: "SPINE1", input: `Outer dst IP ${VTEP_LOOPBACK.LEAF3}`, lookup: "Underlay route lookup", action: "UNDERLAY_FORWARD", output: `Forward toward ${VTEP_LOOPBACK.LEAF3}` }] }, events: [] }),
  },
  {
    id: "leaf3-egress-type5",
    label: "LEAF3 — Decapsulate And Deliver",
    narrative: `LEAF3 decapsulates, reads L3 VNI ${L3_VNI}, hands the packet to VRF ${VRF}, and delivers it toward the destination prefix segment (${TENANT_PREFIX}) — the second routing stage of symmetric IRB, unchanged from the previous lesson.`,
    packet: (state) => (state.packet ? framePacket("f-decap", "LEAF3", "BORDER-SVR", "Decapsulated, delivered toward the tenant prefix", "FRAME", { ...state.packet, encapsulated: false, routed: false, innerSrcMac: GATEWAY_MAC, innerDstMac: "(tenant prefix segment)" }) : undefined),
    run: (state) => {
      const delivered: IrbFrame = { ...(state.packet ?? frame()), encapsulated: false, routed: false, innerSrcMac: GATEWAY_MAC, innerDstMac: "(tenant prefix segment)" };
      return { state: { ...state, packet: delivered, packetAt: "BORDER-SVR", journey: [...state.journey, { device: "LEAF3", input: `VXLAN(L3 VNI ${L3_VNI})`, lookup: `VRF ${VRF}: destination prefix ${TENANT_PREFIX}`, action: "IRB_DECAP_AND_ROUTE", output: `Delivered toward ${DESTINATION_IP}` }] }, events: [{ type: "ROUTED_VXLAN_DECAPSULATED", stepId: "leaf3-egress-type5", timestamp: Date.now(), message: "LEAF3 decapsulates and delivers toward the tenant prefix" }, { type: "EGRESS_IRB_COMPLETED", stepId: "leaf3-egress-type5", timestamp: Date.now(), message: "Delivery complete" }] };
    },
    whatChanged: () => [`LEAF3: VXLAN decapsulated`, `LEAF3: delivered toward ${DESTINATION_IP} inside ${TENANT_PREFIX}`],
  },
  {
    id: "control-data-recap",
    label: "Control Plane Taught LEAF1; Data Plane Used It",
    narrative: `Control plane: 172.16.50.0/24 exists on LEAF3 → EVPN Type 5 → LEAF1's VRF ${VRF} RIB. Data plane: HOST-A → LEAF1 → L3 VNI/VXLAN → LEAF3 → destination prefix. Type 5 taught LEAF1 WHERE the prefix lives; the data packet only used that routing information — it never carried the routing decision itself.`,
  },
  {
    id: "lpm-intro",
    label: "A Second, Less-Specific Route Appears",
    narrative: `LEAF2 also advertises a Type 5 route — but for ${TENANT_PREFIX_WIDE}, a much wider supernet. Both routes are now in LEAF1's VRF ${VRF}: one via LEAF3 (${TENANT_PREFIX}), one via LEAF2 (${TENANT_PREFIX_WIDE}).`,
    run: (state) => ({ state: { ...state, type5RouteWide: makeType5Route(TENANT_PREFIX_WIDE, "LEAF2") }, events: [{ type: "MPBGP_VPN_ROUTE_ADVERTISED", stepId: "lpm-intro", timestamp: Date.now(), message: `LEAF2 advertises a Type 5 route for ${TENANT_PREFIX_WIDE}` }] }),
    whatChanged: () => [`LEAF1 VRF ${VRF}: ${TENANT_PREFIX_WIDE} via LEAF2 also installed`],
  },
  {
    id: "predict-lpm",
    label: "Predict",
    narrative: `LEAF1's VRF ${VRF} now has BOTH ${TENANT_PREFIX_WIDE} (via LEAF2) and ${TENANT_PREFIX} (via LEAF3).`,
    question: {
      prompt: `Which route does LEAF1 actually use for traffic to ${DESTINATION_IP}?`,
      options: [
        { id: "wide", label: `${TENANT_PREFIX_WIDE} via LEAF2` },
        { id: "specific", label: `${TENANT_PREFIX} via LEAF3` },
        { id: "both", label: "Both — traffic is load-balanced across them" },
        { id: "neither", label: "Neither — this is ambiguous and fails" },
      ],
      correctOptionId: "specific",
      explanation: `Longest prefix match — completely ordinary routing behavior, nothing EVPN-specific about it. ${TENANT_PREFIX} (/24) is more specific than ${TENANT_PREFIX_WIDE} (/16), so it wins regardless of which route type installed either one.`,
    },
  },
  {
    id: "lpm-recap",
    label: "The More Specific Prefix Wins",
    narrative: `${DESTINATION_IP} matches ${TENANT_PREFIX} — the longer, more specific match — so traffic continues to route via LEAF3, exactly as it already did. This is ordinary routing table behavior; EVPN Type 5 only supplied the candidate routes, it didn't change how they're compared.`,
  },
  {
    id: "break-intro",
    label: "Break The Fabric",
    narrative: "Everything has worked cleanly so far. Time to break something specific: LEAF3's own VTEP reachability through the underlay — not the Type 5 route itself.",
  },
  {
    id: "fault-injected",
    label: "Remote VTEP Becomes Unreachable",
    narrative: `An engineer breaks the underlay route to LEAF3's VTEP (${VTEP_LOOPBACK.LEAF3}). The Type 5 route is still present in BGP EVPN, still RT-imported, VRF ${VRF} policy is untouched — but the next-hop VTEP itself can no longer be resolved through the underlay.`,
    run: (state) => {
      const vtepReachable = { ...state.vtepReachable, LEAF3: false };
      const received = { ...state.received };
      for (const self of (["LEAF1", "LEAF2"] as LeafIdT5[])) {
        received[self] = (received[self] ?? []).map((r) => ({ ...r, vtepResolved: false }));
      }
      return { state: { ...state, vtepReachable, received, faultActive: true }, events: [{ type: "L3VNI_MAPPING_MISMATCH", stepId: "fault-injected", timestamp: Date.now(), message: `Underlay route to ${VTEP_LOOPBACK.LEAF3} withdrawn — next-hop unresolvable` }] };
    },
    whatChanged: () => [`Underlay route to LEAF3's VTEP (${VTEP_LOOPBACK.LEAF3}): withdrawn`, `${TENANT_PREFIX} via LEAF3: received, RT-imported, but NOT usable`],
  },
  {
    id: "trouble-intro",
    label: "Troubleshoot",
    narrative: `Complaint: "HOST-A can't reach ${DESTINATION_IP}." Physical, BGP EVPN, the Type 5 UPDATE itself, RT import, and VRF ${VRF} policy all check out. Inspect the route's next-hop VTEP specifically.`,
  },
  {
    id: "trouble-question",
    label: "Troubleshoot",
    narrative: "Every control-plane layer up through RT import is healthy.",
    question: {
      prompt: "Where does forwarding actually break?",
      options: [
        { id: "rt", label: "Route Target import policy" },
        { id: "type5-update", label: "The Type 5 UPDATE itself never arrived" },
        { id: "vtep", label: "The route's next-hop VTEP can't be resolved through the underlay" },
        { id: "lpm", label: "Longest-prefix match chose the wrong route" },
      ],
      correctOptionId: "vtep",
      explanation: "Receiving a route and RT-importing it is not the same as being able to forward to it. The Type 5 route for 172.16.50.0/24 is fully installed — its next-hop VTEP simply isn't reachable through the underlay right now, so the installed route can't actually be used.",
      hints: [
        "Hint 1: BGP EVPN, the Type 5 UPDATE, and RT import are all confirmed healthy.",
        "Hint 2: This is the same principle as ordinary BGP: a route being known is not the same as its next hop being usable.",
        "Hint 3: Check whether LEAF1 can actually reach LEAF3's VTEP loopback through the underlay.",
      ],
    },
  },
  {
    id: "diagnostic-layers",
    label: "Layer By Layer",
    narrative: "A route can be received, RT-imported, and even installed in the VRF — and still be completely unusable if its next-hop VTEP isn't reachable. Route known ≠ next hop usable — the same principle from ordinary BGP, now inside EVPN/VXLAN.",
  },
  {
    id: "repair-challenge",
    label: "Apply The Fix",
    narrative: "Restore prefix reachability.",
    action: (state, payload) => {
      const choice = typeof payload === "object" && payload !== null && "choice" in payload ? String((payload as { choice: string }).choice) : "";
      if (choice !== "restore-underlay") return { state: { ...state, repairAttempt: { choice, correct: false } }, events: [] };
      const vtepReachable = { ...state.vtepReachable, LEAF3: true };
      const received = { ...state.received };
      for (const self of (["LEAF1", "LEAF2"] as LeafIdT5[])) {
        received[self] = (received[self] ?? []).map((r) => ({ ...r, vtepResolved: true }));
      }
      return { state: { ...state, vtepReachable, received, faultActive: false, repairAttempt: { choice, correct: true }, challengeSucceeded: true }, events: [{ type: "L3VNI_SELECTED", stepId: "repair-challenge", timestamp: Date.now(), message: `Underlay route to ${VTEP_LOOPBACK.LEAF3} restored` }] };
    },
    requiresState: (state) => state.challengeSucceeded === true,
  },
  {
    id: "verify-dataplane",
    label: "Verify End To End",
    narrative: `Send HOST-A → ${DESTINATION_IP} through again to prove the repair actually restored forwarding.`,
    packet: () => framePacket("f-verify", "HOST-A", "LEAF1", "Verification frame", "FRAME", frame()),
    run: (state) => {
      const encapsulated: IrbFrame = { ...frame(), encapsulated: true, routed: true, l3Vni: L3_VNI, innerSrcMac: ROUTER_MAC.LEAF1, innerDstMac: ROUTER_MAC.LEAF3, outerSrcVtep: VTEP_LOOPBACK.LEAF1, outerDstVtep: VTEP_LOOPBACK.LEAF3 };
      const journey: JourneyHop[] = [
        { device: "LEAF1", input: `IP[HOST-A → ${DESTINATION_IP}]`, lookup: `VRF ${VRF} LPM: ${TENANT_PREFIX} via LEAF3`, action: "IRB_ROUTE_AND_ENCAP", output: `VXLAN(L3 VNI ${L3_VNI}) → ${VTEP_LOOPBACK.LEAF3}` },
        { device: "SPINE1", input: `Outer dst IP ${VTEP_LOOPBACK.LEAF3}`, lookup: "Underlay route lookup", action: "UNDERLAY_FORWARD", output: `Forward toward ${VTEP_LOOPBACK.LEAF3}` },
        { device: "LEAF3", input: `VXLAN(L3 VNI ${L3_VNI})`, lookup: `VRF ${VRF}: destination prefix ${TENANT_PREFIX}`, action: "IRB_DECAP_AND_ROUTE", output: `Delivered toward ${DESTINATION_IP}` },
      ];
      return { state: { ...state, packet: { ...encapsulated, encapsulated: false, routed: false, innerSrcMac: GATEWAY_MAC, innerDstMac: "(tenant prefix segment)" }, packetAt: "BORDER-SVR", journey }, events: [{ type: "EGRESS_IRB_COMPLETED", stepId: "verify-dataplane", timestamp: Date.now(), message: "Destination prefix delivered — Type 5 forwarding fully restored" }] };
    },
    whatChanged: () => ["✓ Underlay route to LEAF3's VTEP restored", "✓ Type 5 route now usable", "✓ Routed VXLAN encapsulation succeeds", "✓ Destination prefix delivered"],
  },
  {
    id: "complete",
    label: "Lesson Complete",
    narrative: `HOST-A reaches ${DESTINATION_IP} again — an entire external prefix, advertised by a single EVPN Type 5 route rather than one host at a time, forwarded over the exact same symmetric-IRB / L3 VNI mechanism the previous lesson built.`,
  },
];
