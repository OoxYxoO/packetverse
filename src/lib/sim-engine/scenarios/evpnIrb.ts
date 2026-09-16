import type { PacketVisual, ScenarioStep } from "../types";
import { HOST_A_IP, HOST_A_MAC, HOST_C_IP, HOST_C_MAC, VTEP_LOOPBACK } from "./evpnBum";
import { HOST_B_MAC as SHARED_HOST_B_MAC } from "./evpnVxlan";

/**
 * EVPN IRB + Distributed Anycast Gateway — the third lesson in the
 * EVPN track, building on "EVPN + VXLAN Foundations" and "EVPN BUM +
 * Route Type 3" (see docs/ARCHITECTURE.md §4 for why this reuses
 * plain constants — host identities, VTEP loopbacks — from those
 * scenario files instead of re-deriving them, without importing
 * either one's own state type).
 *
 * The question this lesson answers: everything so far kept hosts in
 * the SAME subnet (same L2 VNI). What happens when HOST-A (VLAN 10)
 * needs to reach HOST-B (VLAN 20) — a different subnet entirely?
 * Bridging can't answer that; something has to ROUTE. Symmetric IRB
 * (Integrated Routing and Bridging) is that something: every leaf
 * that serves a subnet provides the SAME gateway identity locally
 * (Distributed Anycast Gateway), routes into a VRF, and the actual
 * inter-VTEP transport becomes a routed VNI (L3 VNI) rather than a
 * bridged one (L2 VNI).
 *
 * Explicitly DEFERRED: EVPN Route Type 5 (IP Prefix routes — this
 * lesson deliberately uses only the already-taught Type 2 host MAC/IP
 * reachability to resolve HOST-B), ARP suppression (ARP is shown
 * happening normally — suppression is flagged as "a later
 * optimization," not introduced), EVPN multihoming, ESI/DF election,
 * MAC mobility, asymmetric IRB as a second full simulation (compared
 * only via one static panel), and any second/third VRF (one tenant,
 * TENANT-A, is enough to teach the mechanism).
 *
 * Pure data + pure functions only — see /lib/sim-engine/types.ts.
 */

export type LeafId = "LEAF1" | "LEAF2" | "LEAF3";
export type EvpnIrbDeviceId = "HOST-A" | LeafId | "SPINE1" | "HOST-C" | "HOST-B";
export const FABRIC_DEVICES: EvpnIrbDeviceId[] = ["LEAF1", "SPINE1", "LEAF2", "LEAF3"];

export { VTEP_LOOPBACK, HOST_A_IP, HOST_A_MAC, HOST_C_IP, HOST_C_MAC };
export const HOST_B_IP = "10.20.20.22";
export const HOST_B_MAC = SHARED_HOST_B_MAC;

export const HOST_FOR_LEAF: Record<LeafId, "HOST-A" | "HOST-C" | "HOST-B"> = { LEAF1: "HOST-A", LEAF2: "HOST-C", LEAF3: "HOST-B" };
export const VLAN_FOR_LEAF: Record<LeafId, 10 | 20> = { LEAF1: 10, LEAF2: 10, LEAF3: 20 };

export const VLAN10 = 10;
export const VLAN20 = 20;
export const L2_VNI_10 = 10010;
export const L2_VNI_20 = 10020;
export const L3_VNI = 50000;
const BROKEN_L3_VNI = 50001;
export const VRF = "TENANT-A";

export const GATEWAY_IP: Record<10 | 20, string> = { 10: "10.10.10.1", 20: "10.20.20.1" };
/** One shared anycast MAC across both gateway subnets — a deliberate simplification for this lesson, NOT a universal vendor requirement (brief §2/§32). Real deployments commonly use a distinct anycast MAC per IRB/bridge-domain instance. */
export const GATEWAY_MAC = "02:00:00:00:00:01";
export const GATEWAY_LEAFS: Record<10 | 20, LeafId[]> = { 10: ["LEAF1", "LEAF2"], 20: ["LEAF3"] };

/** Router MACs — used ONLY on the inner Ethernet header while a routed frame transits the L3 VNI. Never a host's MAC (brief §13/§32). Advanced-inspector detail; a beginner never needs these to follow the lesson. */
export const ROUTER_MAC: Record<LeafId, string> = { LEAF1: "00:1B:0D:00:00:01", LEAF2: "00:1B:0D:00:00:02", LEAF3: "00:1B:0D:00:00:03" };

const EVPN_EXPORT_RT = "65000:50000";
function rdFor(leaf: LeafId): string {
  return `${VTEP_LOOPBACK[leaf]}:${L3_VNI}`;
}

export const TERMS: { term: string; expansion: string; meaning: string }[] = [
  { term: "IRB", expansion: "Integrated Routing and Bridging", meaning: "One device doing both Layer-2 bridging (within a VNI) and Layer-3 routing (between VNIs) — no separate router box." },
  { term: "Anycast GW", expansion: "Distributed Anycast Gateway", meaning: "The same gateway IP + MAC configured on every leaf serving a subnet — each host reaches its OWN local leaf, never a centralized router." },
  { term: "Symmetric IRB", expansion: "Routes At Both Ends", meaning: "The ingress VTEP routes into a shared L3 VNI; the egress VTEP routes back out. Neither needs the other's destination L2 segment locally provisioned." },
  { term: "L3 VNI", expansion: "Routed VXLAN Segment", meaning: "Carries already-routed inter-subnet traffic between VTEPs — a VRF's own transport identifier, not a VLAN's." },
  { term: "RMAC", expansion: "Router MAC", meaning: "The inner Ethernet address a routed frame actually carries in transit — the remote VTEP's routing identity, never the destination host's own MAC." },
];

// ---------------------------------------------------------------------------
// Anycast gateway + VRF/L3VNI + remote-host-route model
// ---------------------------------------------------------------------------

export interface AnycastGateway {
  vlan: 10 | 20;
  l2Vni: number;
  gatewayIp: string;
  gatewayMac: string;
  leafs: LeafId[];
  vrf: string;
}
export const ANYCAST_GATEWAYS: Record<10 | 20, AnycastGateway> = {
  10: { vlan: 10, l2Vni: L2_VNI_10, gatewayIp: GATEWAY_IP[10], gatewayMac: GATEWAY_MAC, leafs: GATEWAY_LEAFS[10], vrf: VRF },
  20: { vlan: 20, l2Vni: L2_VNI_20, gatewayIp: GATEWAY_IP[20], gatewayMac: GATEWAY_MAC, leafs: GATEWAY_LEAFS[20], vrf: VRF },
};

export interface RemoteHostRoute {
  mac: string;
  ip: string;
  originLeaf: LeafId;
  rd: string;
  rt: string;
}
export interface ReceivedHostRoute {
  route: RemoteHostRoute;
  rtChecked: boolean;
  rtMatched: boolean;
  imported: boolean;
}

export type IrbAction = "L2_BRIDGE" | "ARP_REPLY" | "IRB_ROUTE_AND_ENCAP" | "UNDERLAY_FORWARD" | "IRB_DECAP_AND_ROUTE" | "L2_DELIVER";
export interface IrbJourneyHop {
  device: EvpnIrbDeviceId;
  input: string;
  lookup: string;
  action: IrbAction;
  output: string;
}

/** The frame in flight. Before routing, the inner fields ARE the real Ethernet/IP header a host actually sent. Once `routed` is true, `innerSrcMac`/`innerDstMac` represent Router MACs (the advanced/RMAC detail), never a host's own MAC — see brief §13/§32. */
export interface IrbFrame {
  innerSrcMac: string;
  innerDstMac: string;
  innerSrcIp: string;
  innerDstIp: string;
  encapsulated: boolean;
  routed: boolean; // true once LEAF1's IRB has rewritten the inner Ethernet to router MACs
  l3Vni?: number;
  outerSrcVtep?: string;
  outerDstVtep?: string;
}

export interface EvpnIrbState {
  l3VniByLeaf: Record<LeafId, number>; // the fault lives here (LEAF3's)
  remoteHostRoutes: Partial<Record<LeafId, ReceivedHostRoute[]>>; // what each leaf learned via Type 2
  bgpSessionUp: boolean;

  arpResolved: boolean; // HOST-A has learned the anycast gateway MAC
  packet?: IrbFrame;
  packetAt?: EvpnIrbDeviceId;
  journey: IrbJourneyHop[];

  sameSubnetDemoRun: boolean; // whether the HOST-A → HOST-C bridging comparison has been shown at least once

  faultActive: boolean;
  repairAttempt?: { choice: string; correct: boolean };
  challengeSucceeded?: boolean;
}

export function createEvpnIrbState(): EvpnIrbState {
  return {
    l3VniByLeaf: { LEAF1: L3_VNI, LEAF2: L3_VNI, LEAF3: L3_VNI },
    remoteHostRoutes: {},
    bgpSessionUp: false,
    arpResolved: false,
    journey: [],
    sameSubnetDemoRun: false,
    faultActive: false,
  };
}

// ---------------------------------------------------------------------------
// Graph layout
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
  { id: "HOST-A", label: "HOST-A", x: 15, y: 88, subLabel: `${HOST_A_IP} · VLAN 10`, kind: "server" as const },
  { id: "LEAF1", label: "LEAF1", x: 15, y: 58, subLabel: `VTEP ${VTEP_LOOPBACK.LEAF1}`, kind: "switch" as const },
  { id: "SPINE1", label: "SPINE1", x: 50, y: 18, subLabel: "Underlay only", kind: "switch" as const },
  { id: "HOST-C", label: "HOST-C", x: 50, y: 88, subLabel: `${HOST_C_IP} · VLAN 10`, kind: "server" as const },
  { id: "LEAF2", label: "LEAF2", x: 50, y: 58, subLabel: `VTEP ${VTEP_LOOPBACK.LEAF2}`, kind: "switch" as const },
  { id: "HOST-B", label: "HOST-B", x: 85, y: 88, subLabel: `${HOST_B_IP} · VLAN 20`, kind: "server" as const },
  { id: "LEAF3", label: "LEAF3", x: 85, y: 58, subLabel: `VTEP ${VTEP_LOOPBACK.LEAF3}`, kind: "switch" as const },
];
export const GRAPH_EDGES: GEdge[] = [
  { id: "HOST-A-LEAF1", a: "HOST-A", b: "LEAF1" },
  { id: "HOST-C-LEAF2", a: "HOST-C", b: "LEAF2" },
  { id: "HOST-B-LEAF3", a: "HOST-B", b: "LEAF3" },
  { id: "LEAF1-SPINE1", a: "LEAF1", b: "SPINE1", label: "Underlay" },
  { id: "LEAF2-SPINE1", a: "LEAF2", b: "SPINE1", label: "Underlay" },
  { id: "LEAF3-SPINE1", a: "LEAF3", b: "SPINE1", label: "Underlay" },
];
export const GRAPH_REGIONS = [
  { id: "underlay", label: "IP Underlay Fabric (Spine-Leaf)", x: 4, y: 6, width: 92, height: 60, tone: "cyan" as const },
  { id: "gateway-vlan10", label: `Anycast Gateway ${GATEWAY_IP[10]} (VLAN 10)`, x: 4, y: 50, width: 60, height: 20, tone: "violet" as const },
  { id: "gateway-vlan20", label: `Anycast Gateway ${GATEWAY_IP[20]} (VLAN 20)`, x: 68, y: 50, width: 28, height: 20, tone: "violet" as const },
];

/** The control-plane-only BGP EVPN mesh, spliced in once the session's up (mirrors both earlier EVPN lessons' identical pattern). */
export function withEvpnMesh<N extends { id: string; x: number; y: number }, E extends { id: string; a: string; b: string; label?: string }>(nodes: N[], edges: E[], active: boolean): { nodes: N[]; edges: E[] } {
  if (!active) return { nodes, edges };
  return {
    nodes,
    edges: [
      ...edges,
      { id: "LEAF1-LEAF2-evpn", a: "LEAF1", b: "LEAF2", label: "BGP EVPN" } as E,
      { id: "LEAF2-LEAF3-evpn", a: "LEAF2", b: "LEAF3", label: "BGP EVPN" } as E,
      { id: "LEAF1-LEAF3-evpn", a: "LEAF1", b: "LEAF3", label: "BGP EVPN" } as E,
    ],
  };
}

/** Logical view (brief §18) — the vertical "what actually happens" funnel: VLAN → Anycast GW → VRF → L3 VNI → VRF → Anycast GW → VLAN, HOST-C shown as the same-subnet peer off to the side rather than through the routed path at all. */
export const LOGICAL_GRAPH_NODES: GNode[] = [
  { id: "HOST-A", label: "HOST-A", x: 18, y: 4, subLabel: HOST_A_IP, kind: "server" as const },
  { id: "HOST-C", label: "HOST-C", x: 45, y: 4, subLabel: HOST_C_IP, kind: "server" as const },
  { id: "VLAN10", label: "VLAN 10 / L2 VNI 10010", x: 18, y: 20, subLabel: "Bridged segment", kind: "cloud" as const },
  { id: "GW10", label: `Anycast GW ${GATEWAY_IP[10]}`, x: 18, y: 36, subLabel: GATEWAY_MAC, kind: "cloud" as const },
  { id: "VRF-IN", label: `VRF ${VRF}`, x: 32, y: 52, subLabel: "Ingress routing", kind: "cloud" as const },
  { id: "L3VNI", label: `L3 VNI ${L3_VNI}`, x: 55, y: 66, subLabel: "Symmetric IRB", kind: "cloud" as const },
  { id: "VRF-OUT", label: `VRF ${VRF}`, x: 78, y: 52, subLabel: "Egress routing", kind: "cloud" as const },
  { id: "GW20", label: `Anycast GW ${GATEWAY_IP[20]}`, x: 88, y: 36, subLabel: GATEWAY_MAC, kind: "cloud" as const },
  { id: "VLAN20", label: "VLAN 20 / L2 VNI 10020", x: 88, y: 20, subLabel: "Bridged segment", kind: "cloud" as const },
  { id: "HOST-B", label: "HOST-B", x: 88, y: 4, subLabel: HOST_B_IP, kind: "server" as const },
];
export const LOGICAL_GRAPH_EDGES: GEdge[] = [
  { id: "HOST-A-VLAN10", a: "HOST-A", b: "VLAN10" },
  { id: "HOST-C-VLAN10", a: "HOST-C", b: "VLAN10" },
  { id: "VLAN10-GW10", a: "VLAN10", b: "GW10" },
  { id: "GW10-VRFIN", a: "GW10", b: "VRF-IN" },
  { id: "VRFIN-L3VNI", a: "VRF-IN", b: "L3VNI", label: `L3 VNI ${L3_VNI}` },
  { id: "L3VNI-VRFOUT", a: "L3VNI", b: "VRF-OUT", label: `L3 VNI ${L3_VNI}` },
  { id: "VRFOUT-GW20", a: "VRF-OUT", b: "GW20" },
  { id: "GW20-VLAN20", a: "GW20", b: "VLAN20" },
  { id: "VLAN20-HOSTB", a: "VLAN20", b: "HOST-B" },
];

// ---------------------------------------------------------------------------
// Packet builders — a 6-layer stack when routed/encapsulated (brief §12):
// Outer Ethernet / Outer IP / UDP / VXLAN(L3 VNI) / Inner Ethernet
// (routed context — RMACs) / Inner IP. A plain 2-layer stack otherwise.
// ---------------------------------------------------------------------------

function frame(overrides: Partial<IrbFrame> = {}): IrbFrame {
  return { innerSrcMac: HOST_A_MAC, innerDstMac: GATEWAY_MAC, innerSrcIp: HOST_A_IP, innerDstIp: HOST_B_IP, encapsulated: false, routed: false, ...overrides };
}

export function buildPacketLayers(f: IrbFrame) {
  if (!f.encapsulated) {
    return [
      { name: "Ethernet", color: "var(--pv-proto-ethernet)", fields: [{ label: "Src MAC", value: f.innerSrcMac }, { label: "Dst MAC", value: f.innerDstMac }] },
      { name: "IPv4", color: "var(--pv-proto-ip)", fields: [{ label: "Src IP", value: f.innerSrcIp }, { label: "Dst IP", value: f.innerDstIp }] },
    ];
  }
  return [
    { name: "Outer Ethernet", color: "var(--pv-proto-ethernet)", fields: [{ label: "Src MAC", value: "(underlay next-hop, rewritten per hop)" }, { label: "Dst MAC", value: "(underlay next-hop, rewritten per hop)" }] },
    { name: "Outer IP", color: "var(--pv-proto-ip)", fields: [{ label: "Outer Src IP (VTEP)", value: f.outerSrcVtep ?? "—" }, { label: "Outer Dst IP (VTEP)", value: f.outerDstVtep ?? "—" }] },
    { name: "UDP", color: "var(--pv-proto-udp)", fields: [{ label: "Dst Port", value: "4789" }] },
    { name: "VXLAN Header", color: "var(--pv-proto-vxlan)", fields: [{ label: "VNI", value: String(f.l3Vni ?? L3_VNI) }, { label: "Meaning", value: `Routed VRF ${VRF} context — an L3 VNI, not a VLAN's L2 VNI` }] },
    {
      name: "Inner Ethernet (routed context)",
      color: "var(--pv-proto-mpls)",
      fields: [
        { label: "Src MAC (Advanced — Router MAC)", value: f.innerSrcMac },
        { label: "Dst MAC (Advanced — Router MAC, NOT the destination host)", value: f.innerDstMac },
      ],
    },
    { name: "Inner IP", color: "var(--pv-proto-ip)", fields: [{ label: "Src IP", value: f.innerSrcIp }, { label: "Dst IP", value: f.innerDstIp }] },
  ];
}

function framePacket(id: string, from: EvpnIrbDeviceId, to: EvpnIrbDeviceId, summary: string, badge: string, f: IrbFrame): PacketVisual {
  return { id, protocol: f.encapsulated ? "VXLAN" : "ETHERNET", from, to, summary, badge, layers: buildPacketLayers(f) };
}

function type2Packet(id: string, from: LeafId, to: LeafId, route: RemoteHostRoute): PacketVisual {
  return {
    id,
    protocol: "BGP",
    from,
    to,
    summary: `EVPN Type 2 — ${route.mac} / ${route.ip}`,
    badge: "EVPN UPDATE",
    layers: [{ name: "BGP UPDATE (EVPN)", color: "var(--pv-proto-bgp)", fields: [
      { label: "AFI/SAFI", value: "L2VPN EVPN" },
      { label: "Route Type", value: "2 (MAC/IP Advertisement)" },
      { label: "RD", value: route.rd },
      { label: "MAC Address", value: route.mac },
      { label: "IP Address", value: route.ip },
      { label: "Route Target", value: route.rt },
      { label: "Next Hop", value: VTEP_LOOPBACK[route.originLeaf] },
    ] }],
  };
}

/** The lightweight same-subnet comparison (brief §20/§24) — deliberately NOT a full second simulation, just one bridged frame reusing the same generic packet-stack renderer. Never touches VRF/IRB/L3VNI state at all. */
export function sameSubnetPacket(): PacketVisual {
  return framePacket("same-subnet", "HOST-A", "HOST-C", "HOST-A → HOST-C — same subnet, plain L2 VNI 10010 bridging", "FRAME", { innerSrcMac: HOST_A_MAC, innerDstMac: HOST_C_MAC, innerSrcIp: HOST_A_IP, innerDstIp: HOST_C_IP, encapsulated: false, routed: false });
}

function arpPacket(id: string, from: EvpnIrbDeviceId, to: EvpnIrbDeviceId, kind: "request" | "reply"): PacketVisual {
  return {
    id,
    protocol: "ARP",
    from,
    to,
    summary: kind === "request" ? `Who has ${GATEWAY_IP[10]}?` : `${GATEWAY_IP[10]} is at ${GATEWAY_MAC}`,
    badge: kind === "request" ? "ARP REQUEST" : "ARP REPLY",
    broadcast: kind === "request",
    layers: [
      kind === "request"
        ? { name: "ARP Request", color: "var(--pv-proto-arp)", fields: [{ label: "Sender MAC", value: HOST_A_MAC }, { label: "Sender IP", value: HOST_A_IP }, { label: "Target IP", value: GATEWAY_IP[10] }] }
        : { name: "ARP Reply", color: "var(--pv-proto-arp)", fields: [{ label: "Sender MAC (Anycast GW)", value: GATEWAY_MAC }, { label: "Sender IP", value: GATEWAY_IP[10] }, { label: "Target MAC", value: HOST_A_MAC }] },
    ],
  };
}

// X-ray focus indices (brief §31).
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

export const evpnIrbSteps: ScenarioStep<EvpnIrbState>[] = [
  {
    id: "intro",
    label: "Two Subnets, One Fabric",
    narrative:
      "HOST-A (VLAN 10, behind LEAF1) and HOST-C (VLAN 10, behind LEAF2) already know how to reach each other — same subnet, same L2 VNI 10010, ordinary bridging. HOST-B (VLAN 20, behind LEAF3) is a different subnet entirely. Bridging can't get a frame there — something has to route it.",
  },
  {
    id: "predict-different-subnet",
    label: "Predict",
    narrative: "HOST-A's own subnet is 10.10.10.0/24.",
    question: {
      prompt: "Is 10.20.20.22 (HOST-B) inside that subnet?",
      options: [
        { id: "yes", label: "Yes — same fabric means same subnet" },
        { id: "no", label: "No — it's a completely different IP subnet" },
        { id: "depends-vlan", label: "Depends which VLAN LEAF1 happens to be in" },
        { id: "depends-leaf", label: "Depends which leaf HOST-A is attached to" },
      ],
      correctOptionId: "no",
      explanation: "10.10.10.0/24 and 10.20.20.0/24 share nothing — being on the same physical fabric has no bearing on IP subnet membership.",
    },
  },
  {
    id: "predict-gateway-target",
    label: "Predict",
    narrative: "Since the destination is outside HOST-A's own subnet:",
    question: {
      prompt: "What does HOST-A actually send the frame toward?",
      options: [
        { id: "direct", label: "Directly to HOST-B's IP, same as always" },
        { id: "gateway", label: "Its own default gateway, 10.10.10.1" },
        { id: "spine", label: "SPINE1 directly" },
        { id: "broadcast", label: "A broadcast, and lets the fabric sort it out" },
      ],
      correctOptionId: "gateway",
      explanation: "Ordinary IP behavior: a host that can't reach a destination on its own subnet sends the frame to its default gateway instead — that hasn't changed just because the gateway happens to live inside a VXLAN fabric.",
    },
  },
  {
    id: "predict-gateway-location",
    label: "Predict",
    narrative: "Before revealing where 10.10.10.1 actually lives:",
    question: {
      prompt: "Where is HOST-A's default gateway, 10.10.10.1, physically located?",
      options: [
        { id: "centralized", label: "A centralized router somewhere in the fabric" },
        { id: "local", label: "Every leaf serving VLAN 10 provides it locally" },
        { id: "spine-only", label: "Only on SPINE1" },
        { id: "nowhere", label: "It doesn't physically exist anywhere" },
      ],
      correctOptionId: "local",
      explanation: "This is exactly what a Distributed Anycast Gateway means: there is no single router to hairpin traffic through. LEAF1 itself provides 10.10.10.1 for HOST-A, and LEAF2 provides the very same identity for HOST-C.",
    },
  },
  {
    id: "anycast-gateway-intro",
    label: "Distributed Anycast Gateway",
    narrative: `HOST-A's default gateway is ${GATEWAY_IP[10]}, MAC ${GATEWAY_MAC} — configured on LEAF1. HOST-C, also VLAN 10 but behind LEAF2, is configured with the exact same gateway IP and MAC — on LEAF2. Both hosts use an identical gateway identity; each one simply reaches whichever leaf is physically local to it.`,
    run: (state) => ({ state: { ...state, bgpSessionUp: true }, events: [{ type: "BGP_STATE_CHANGED", stepId: "anycast-gateway-intro", timestamp: Date.now(), message: "LEAF1 ↔ LEAF2 ↔ LEAF3 BGP EVPN mesh Established" }] }),
    whatChanged: () => ["LEAF1 ↔ LEAF2 ↔ LEAF3 BGP EVPN session: Established", `LEAF1 and LEAF2 both provide ${GATEWAY_IP[10]} / ${GATEWAY_MAC} for VLAN 10`],
  },
  {
    id: "anycast-gateway-object",
    label: "The Anycast Gateway, As One Object",
    narrative: `Click the "Anycast Gateway ${GATEWAY_IP[10]}" region in the 3D view: it spans LEAF1 and LEAF2 together, on purpose — it's one logical gateway identity, provided in two physical places. VLAN 20's gateway (${GATEWAY_IP[20]}) is a separate object entirely, provided only by LEAF3.`,
  },
  {
    id: "predict-gateway-mac-design",
    label: "Predict",
    narrative: "One design detail worth being precise about:",
    question: {
      prompt: `This lesson uses the same anycast MAC (${GATEWAY_MAC}) for both VLAN 10's and VLAN 20's gateways. Is sharing one MAC across every gateway subnet a universal EVPN requirement?`,
      options: [
        { id: "universal", label: "Yes — every vendor requires exactly one shared anycast MAC fabric-wide" },
        { id: "design-choice", label: "No — this is a simplification for this lesson; the gateway IP is what's always subnet-specific" },
        { id: "cisco-only", label: "Only on Cisco platforms" },
        { id: "single-vlan-only", label: "Only when there's just one VLAN" },
      ],
      correctOptionId: "design-choice",
      explanation: `The gateway IP (${GATEWAY_IP[10]} vs. ${GATEWAY_IP[20]}) is always subnet-specific — that's fundamental, never optional. Whether every IRB interface shares one anycast MAC or each gets its own is an implementation/design choice, not a rule this lesson should present as universal.`,
    },
  },
  {
    id: "arp-intro",
    label: "HOST-A Needs A MAC",
    narrative: "HOST-A knows the gateway's IP but needs its MAC before it can send an Ethernet frame at all.",
  },
  {
    id: "arp-request",
    label: "ARP Request",
    narrative: `HOST-A broadcasts: "Who has ${GATEWAY_IP[10]}?"`,
    packet: () => arpPacket("arp-req", "HOST-A", "LEAF1", "request"),
    run: (state) => ({ state, events: [{ type: "ARP_REQUEST_SENT", stepId: "arp-request", timestamp: Date.now(), message: "HOST-A ARPs for its gateway" }] }),
  },
  {
    id: "arp-reply",
    label: "ARP Reply — From The Local Gateway Instance",
    narrative: `LEAF1 replies using the Anycast Gateway MAC (${GATEWAY_MAC}) — the exact same reply HOST-C would get from LEAF2 for the exact same IP. Note: this is ordinary ARP, answered locally. EVPN ARP suppression (suppressing this exchange fabric-wide) is a later optimization — not introduced yet.`,
    packet: () => arpPacket("arp-rep", "LEAF1", "HOST-A", "reply"),
    run: (state) => ({ state: { ...state, arpResolved: true }, events: [{ type: "ARP_ENTRY_CREATED", stepId: "arp-reply", timestamp: Date.now(), message: "HOST-A learns the Anycast Gateway MAC" }] }),
  },
  {
    id: "packet-before-routing",
    label: "The Frame HOST-A Actually Sends",
    narrative:
      "HOST-A wants HOST-B (10.20.20.22) — but the Ethernet destination is the gateway, not HOST-B. This distinction is the whole lesson in miniature: Ethernet destination = gateway; IP destination = HOST-B. Click either header.",
    packet: () => framePacket("f-before", "HOST-A", "LEAF1", "Ethernet dst = Anycast Gateway, IP dst = HOST-B", "FRAME", frame()),
    run: (state) => ({ state: { ...state, packet: frame(), packetAt: "LEAF1" }, events: [{ type: "PACKET_SENT", stepId: "packet-before-routing", timestamp: Date.now(), message: "HOST-A sends toward its gateway" }] }),
  },
  {
    id: "enter-leaf1-irb",
    label: "LEAF1 — Conceptual Symmetric IRB Ingress Pipeline",
    narrative:
      "Enter LEAF1: the frame arrives on the VLAN 10 access port. Its destination MAC is the Anycast Gateway — not a bridging decision anymore, an L3/IRB one. LEAF1 hands it to VRF TENANT-A for a destination IP lookup.",
    run: (state) => ({ state, events: [{ type: "ANYCAST_GATEWAY_RESOLVED", stepId: "enter-leaf1-irb", timestamp: Date.now(), message: "Destination MAC matched the Anycast Gateway — routing, not bridging" }, { type: "IRB_LOOKUP_STARTED", stepId: "enter-leaf1-irb", timestamp: Date.now(), message: "VRF TENANT-A destination IP lookup begins" }] }),
  },
  {
    id: "predict-l2-vs-l3-vni",
    label: "Predict",
    narrative: "Before the routing decision resolves:",
    question: {
      prompt: "Which VNI actually carries this routed, inter-subnet traffic between LEAF1 and LEAF3?",
      options: [
        { id: "l2-10010", label: "L2 VNI 10010" },
        { id: "l2-10020", label: "L2 VNI 10020" },
        { id: "l3-50000", label: `L3 VNI ${L3_VNI}` },
        { id: "none", label: "None — it stays untagged across the underlay" },
      ],
      correctOptionId: "l3-50000",
      explanation: `L2 VNI 10010 and 10020 are each one VLAN's own bridged segment — neither carries traffic that's already been routed between subnets. L3 VNI ${L3_VNI} is VRF ${VRF}'s own routed transport identifier, entirely separate from either VLAN's L2 VNI.`,
    },
  },
  {
    id: "type2-hostb-reachability",
    label: "HOST-B's Reachability, Via Type 2",
    narrative: `LEAF3 already advertised an ordinary EVPN Type 2 route for HOST-B (MAC ${HOST_B_MAC}, IP ${HOST_B_IP}) — exactly the mechanism the first EVPN lesson taught. LEAF1 already imported it. No Type 5 IP-prefix route is needed for this first host-route example; that's a dedicated future lesson.`,
    packet: (state) => (state.remoteHostRoutes.LEAF1?.[0] ? type2Packet("t2-hostb", "LEAF3", "LEAF1", state.remoteHostRoutes.LEAF1[0].route) : undefined),
    run: (state) => {
      const route: RemoteHostRoute = { mac: HOST_B_MAC, ip: HOST_B_IP, originLeaf: "LEAF3", rd: rdFor("LEAF3"), rt: EVPN_EXPORT_RT };
      const received: ReceivedHostRoute = { route, rtChecked: true, rtMatched: true, imported: true };
      return { state: { ...state, remoteHostRoutes: { ...state.remoteHostRoutes, LEAF1: [received], LEAF2: [received] } }, events: [{ type: "MPBGP_VPN_ROUTE_ADVERTISED", stepId: "type2-hostb-reachability", timestamp: Date.now(), message: "LEAF3 advertises HOST-B's Type 2 route" }] };
    },
    whatChanged: () => [`LEAF1: learned ${HOST_B_IP} → remote VTEP LEAF3 (via Type 2)`],
  },
  {
    id: "vrf-routing-decision",
    label: "The Routing Decision, Inside LEAF1",
    narrative: `LEAF1's VRF ${VRF} table now says it plainly: destination ${HOST_B_IP} → remote host route via LEAF3 → L3 VNI ${L3_VNI}. The L2 lookup ended the moment the frame targeted the local gateway — everything from here is a Layer-3 forwarding decision.`,
    run: (state) => ({ state, events: [{ type: "VRF_ROUTE_SELECTED", stepId: "vrf-routing-decision", timestamp: Date.now(), message: `VRF ${VRF} selects remote host route via LEAF3` }, { type: "L3VNI_SELECTED", stepId: "vrf-routing-decision", timestamp: Date.now(), message: `L3 VNI ${L3_VNI} selected for the routed transport` }] }),
  },
  {
    id: "packet-transformation",
    label: "Encapsulation — Before / After",
    narrative: `LEAF1 rewrites the frame entirely: the inner Ethernet header now carries router MACs (an advanced, symmetric-IRB-specific detail — never HOST-B's own MAC), the inner IP stays exactly HOST-A → HOST-B, and the whole thing is wrapped in VXLAN with VNI ${L3_VNI} — a routed L3 VNI, not either VLAN's L2 VNI.`,
    packet: (state) => (state.packet ? framePacket("f-encap", "LEAF1", "SPINE1", `Routed + VXLAN-encapsulated — L3 VNI ${L3_VNI}`, "VXLAN", { ...state.packet, encapsulated: true, routed: true, l3Vni: L3_VNI, innerSrcMac: ROUTER_MAC.LEAF1, innerDstMac: ROUTER_MAC.LEAF3, outerSrcVtep: VTEP_LOOPBACK.LEAF1, outerDstVtep: VTEP_LOOPBACK.LEAF3 }) : undefined),
    run: (state) => {
      const l3Vni = state.l3VniByLeaf.LEAF1;
      const encapsulated: IrbFrame = { ...(state.packet ?? frame()), encapsulated: true, routed: true, l3Vni, innerSrcMac: ROUTER_MAC.LEAF1, innerDstMac: ROUTER_MAC.LEAF3, outerSrcVtep: VTEP_LOOPBACK.LEAF1, outerDstVtep: VTEP_LOOPBACK.LEAF3 };
      const journey = [...state.journey, { device: "LEAF1" as EvpnIrbDeviceId, input: "Ethernet[HOST-A → Anycast GW], IP[HOST-A → HOST-B]", lookup: `VRF ${VRF}: ${HOST_B_IP} → LEAF3, L3 VNI ${l3Vni}`, action: "IRB_ROUTE_AND_ENCAP" as IrbAction, output: `VXLAN(L3 VNI ${l3Vni}) → ${VTEP_LOOPBACK.LEAF3}` }];
      return { state: { ...state, packet: encapsulated, packetAt: "SPINE1", journey }, events: [{ type: "ROUTED_VXLAN_ENCAPSULATED", stepId: "packet-transformation", timestamp: Date.now(), message: "LEAF1 completes routed VXLAN encapsulation" }] };
    },
    whatChanged: () => ["LEAF1: Ethernet header rewritten to router MACs (inner, routed context)", `LEAF1: VXLAN encapsulation with L3 VNI ${L3_VNI}`, "LEAF1: inner IP unchanged — still HOST-A → HOST-B"],
  },
  {
    id: "rmac-advanced",
    label: "Advanced Symmetric-IRB Detail — Router MAC (RMAC)",
    narrative:
      "Not required to follow the rest of the lesson: while this frame transits the L3 VNI, its inner Ethernet header carries LEAF1's and LEAF3's own Router MACs — identities tied to each VTEP's routing context, never HOST-B's actual MAC. HOST-B's real MAC only reappears once LEAF3 rewrites the frame for final, local delivery.",
  },
  {
    id: "spine-forward-irb",
    label: "SPINE1 — Routing The Underlay Packet Only",
    narrative: "SPINE1 reads the outer destination IP alone and forwards. It has no idea this packet is routed, no idea about VRF TENANT-A, no idea a gateway or an L3 VNI exist — none of that is the underlay's concern.",
    packet: (state) => (state.packet ? framePacket("f-spine", "SPINE1", "LEAF3", "VXLAN in flight — outer IP forwarding only", "VXLAN", state.packet) : undefined),
    run: (state) => ({ state: { ...state, packetAt: "LEAF3", journey: [...state.journey, { device: "SPINE1" as EvpnIrbDeviceId, input: `Outer dst IP ${VTEP_LOOPBACK.LEAF3}`, lookup: "Underlay route lookup", action: "UNDERLAY_FORWARD" as IrbAction, output: `Forward toward ${VTEP_LOOPBACK.LEAF3}` }] }, events: [] }),
  },
  {
    id: "leaf3-egress-irb",
    label: "LEAF3 — Conceptual Symmetric IRB Egress Pipeline",
    narrative: `LEAF3 decapsulates, reads L3 VNI ${L3_VNI}, hands the packet to its own VRF ${VRF} instance, looks up the destination route, resolves it to VLAN 20 / L2 VNI ${L2_VNI_20}, rewrites the Ethernet header for local delivery, and sends it out HOST-B's access port. This is the second routing stage — symmetric IRB routes at BOTH ends.`,
    packet: (state) => (state.packet ? framePacket("f-decap", "LEAF3", "HOST-B", "Decapsulated, egress-routed, rewritten for delivery", "FRAME", { ...state.packet, encapsulated: false, routed: false, innerSrcMac: GATEWAY_MAC, innerDstMac: HOST_B_MAC }) : undefined),
    run: (state) => {
      const l3VniHere = state.l3VniByLeaf.LEAF3;
      const mismatch = l3VniHere !== L3_VNI;
      if (mismatch) {
        return {
          state: { ...state, journey: [...state.journey, { device: "LEAF3" as EvpnIrbDeviceId, input: `VXLAN(L3 VNI ${L3_VNI} received)`, lookup: `LEAF3's own VRF ${VRF} is mapped to L3 VNI ${l3VniHere} — no match`, action: "IRB_DECAP_AND_ROUTE" as IrbAction, output: "DROPPED — no matching VRF for this L3 VNI" }] },
          events: [{ type: "L3VNI_MAPPING_MISMATCH", stepId: "leaf3-egress-irb", timestamp: Date.now(), message: `LEAF3 VRF ${VRF} expects L3 VNI ${l3VniHere}, packet carries ${L3_VNI} — dropped` }],
        };
      }
      const delivered: IrbFrame = { ...(state.packet ?? frame()), encapsulated: false, routed: false, innerSrcMac: GATEWAY_MAC, innerDstMac: HOST_B_MAC };
      const journey = [...state.journey, { device: "LEAF3" as EvpnIrbDeviceId, input: `VXLAN(L3 VNI ${L3_VNI})`, lookup: `VRF ${VRF} destination route → VLAN 20 / L2 VNI ${L2_VNI_20}`, action: "IRB_DECAP_AND_ROUTE" as IrbAction, output: "Ethernet rewritten → HOST-B" }];
      return { state: { ...state, packet: delivered, packetAt: "HOST-B", journey }, events: [{ type: "ROUTED_VXLAN_DECAPSULATED", stepId: "leaf3-egress-irb", timestamp: Date.now(), message: "LEAF3 decapsulates and completes egress IRB" }, { type: "EGRESS_IRB_COMPLETED", stepId: "leaf3-egress-irb", timestamp: Date.now(), message: "Frame rewritten and delivered toward HOST-B" }] };
    },
    whatChanged: (_prev, next) => (next.l3VniByLeaf.LEAF3 === L3_VNI ? ["LEAF3: VXLAN decapsulated", `LEAF3: VRF ${VRF} routed to VLAN 20 / L2 VNI ${L2_VNI_20}`, "LEAF3: Ethernet rewritten — src = Anycast Gateway, dst = HOST-B"] : [`LEAF3: L3 VNI mismatch (${L3_VNI} received, ${next.l3VniByLeaf.LEAF3} configured) — packet dropped`]),
  },
  {
    id: "packet-after-leaf3",
    label: "The Frame HOST-B Actually Receives",
    narrative:
      "Ethernet source is now the Anycast Gateway MAC (VLAN 20's own local instance, on LEAF3) and destination is HOST-B's real MAC. IP endpoints never changed at all: still HOST-A → HOST-B. Ethernet headers changed at every routed boundary; the IP conversation stayed exactly the same the whole way.",
  },
  {
    id: "delivered-hostb",
    label: "Delivered",
    narrative: "HOST-B receives the frame. Three different destination identifiers existed for one conversation: the gateway MAC HOST-A actually addressed, the remote VTEP IP the fabric routed toward, and HOST-B's own final IP/MAC — each answering a different question, at a different layer.",
  },
  {
    id: "control-data-recap",
    label: "Control Plane Provided Reachability; Data Plane Used It",
    narrative: "Control plane: HOST-B learned on LEAF3 → EVPN Type 2 → LEAF1 learns remote host reachability. Data plane: HOST-A → Anycast Gateway → L3 VNI VXLAN → HOST-B. EVPN never forwards a data packet itself, and VXLAN never makes a routing decision itself — the VTEP's own VRF/L3 function routes; VXLAN only carries the result.",
  },
  {
    id: "same-subnet-vs-intersubnet",
    label: "Same Subnet vs. Inter-Subnet",
    narrative: `HOST-A → HOST-C (both VLAN 10) never needed any of this — plain L2 VNI ${L2_VNI_10} bridging, the same mechanism the very first EVPN lesson taught. HOST-A → HOST-B needed a local gateway, a VRF lookup, and a routed L3 VNI. Use the toggle to compare both side by side.`,
    run: (state) => ({ state: { ...state, sameSubnetDemoRun: true }, events: [] }),
  },
  {
    id: "asymmetric-vs-symmetric",
    label: "Symmetric vs. Asymmetric IRB",
    narrative:
      "Asymmetric IRB routes only at the ingress VTEP, then bridges the destination's own L2 VNI the rest of the way — meaning every leaf needs the destination segment locally instantiated just to route toward it. Symmetric IRB (this lesson) routes at BOTH ends over a shared L3 VNI, so a leaf never needs a remote subnet provisioned at all merely to reach it — this is why symmetric IRB scales better on larger fabrics. Neither is \"wrong\" — they're different tradeoffs.",
  },
  {
    id: "break-intro",
    label: "Break The Fabric",
    narrative: "Everything has worked cleanly so far. Time to break something specific: LEAF3's own L3 VNI association for VRF TENANT-A.",
  },
  {
    id: "fault-injected",
    label: "LEAF3's L3 VNI Misconfigured",
    narrative: `An engineer changes LEAF3's VRF ${VRF} association to L3 VNI ${BROKEN_L3_VNI}. Physical links, underlay, VTEP reachability, BGP EVPN, HOST-B's Type 2 route, VLAN 20/L2 VNI, and the Anycast Gateway itself are all still perfectly healthy. Only the routed L3 VNI mapping is wrong.`,
    run: (state) => ({
      state: { ...state, l3VniByLeaf: { ...state.l3VniByLeaf, LEAF3: BROKEN_L3_VNI }, faultActive: true },
      events: [{ type: "L3VNI_MAPPING_MISMATCH", stepId: "fault-injected", timestamp: Date.now(), message: `LEAF3 VRF ${VRF} changed to L3 VNI ${BROKEN_L3_VNI}` }],
    }),
    whatChanged: () => [`LEAF3 VRF ${VRF}: L3 VNI ${L3_VNI} → ${BROKEN_L3_VNI}`],
  },
  {
    id: "same-subnet-still-works",
    label: "HOST-A → HOST-C Still Works",
    narrative: "Send HOST-A → HOST-C again: still fine. That traffic never touches VRF TENANT-A or any L3 VNI at all — it's pure L2 VNI 10010 bridging. L2 EVPN/VXLAN health is not the same thing as L3 IRB health.",
  },
  {
    id: "trouble-intro",
    label: "Troubleshoot",
    narrative:
      "Complaint: \"HOST-A can reach HOST-C fine. HOST-A can resolve its gateway fine. HOST-A can NOT reach HOST-B.\" Physical, underlay, VTEP reachability, BGP EVPN, HOST-B's Type 2 route, VLAN 20/L2 VNI, and the Anycast Gateway all check out healthy. Inspect LEAF1's VRF routing decision, then follow the packet to LEAF3.",
  },
  {
    id: "trouble-question",
    label: "Troubleshoot",
    narrative: "Every layer beneath the routed L3 VNI mapping is healthy.",
    question: {
      prompt: "Where does inter-subnet traffic actually break?",
      options: [
        { id: "bgp-evpn", label: "The BGP EVPN session itself" },
        { id: "type2", label: "HOST-B's Type 2 route" },
        { id: "l3vni", label: "LEAF3's L3 VNI / VRF association" },
        { id: "gateway", label: "The Anycast Gateway configuration" },
      ],
      correctOptionId: "l3vni",
      explanation: "Every layer up through the Anycast Gateway and Type 2 reachability is healthy — LEAF1 correctly routes and encapsulates with L3 VNI 50000. LEAF3 simply isn't listening for that VNI anymore; its own VRF TENANT-A association was changed, so the routed VXLAN packet arrives and is dropped.",
      hints: [
        "Hint 1: HOST-A ↔ HOST-C (same subnet) still works — this isn't an L2/EVPN/underlay problem.",
        "Hint 2: HOST-B's Type 2 route and the Anycast Gateway are both confirmed healthy.",
        "Hint 3: compare the L3 VNI LEAF1 encapsulates with vs. the one LEAF3's own VRF is actually mapped to.",
      ],
    },
  },
  {
    id: "diagnostic-layers",
    label: "Layer By Layer",
    narrative: "L2 EVPN/VXLAN health, EVPN Type-2 host reachability, and the Anycast Gateway itself can all be perfectly healthy while the L3 IRB/VRF mapping underneath inter-subnet traffic is still broken — they are genuinely independent layers.",
  },
  {
    id: "repair-challenge",
    label: "Apply The Fix",
    narrative: "Restore inter-subnet connectivity.",
    action: (state, payload) => {
      const choice = typeof payload === "object" && payload !== null && "choice" in payload ? String((payload as { choice: string }).choice) : "";
      if (choice !== "fix-l3vni") return { state: { ...state, repairAttempt: { choice, correct: false } }, events: [] };
      return {
        state: { ...state, l3VniByLeaf: { ...state.l3VniByLeaf, LEAF3: L3_VNI }, faultActive: false, repairAttempt: { choice, correct: true }, challengeSucceeded: true },
        events: [{ type: "L3VNI_SELECTED", stepId: "repair-challenge", timestamp: Date.now(), message: `LEAF3 VRF ${VRF} corrected back to L3 VNI ${L3_VNI}` }],
      };
    },
    requiresState: (state) => state.challengeSucceeded === true,
  },
  {
    id: "verify-dataplane",
    label: "Verify End To End",
    narrative: "Send HOST-A → HOST-B through again to prove the repair actually restored routed delivery, not just the configuration table.",
    packet: () => framePacket("f-verify", "HOST-A", "LEAF1", "Verification frame", "FRAME", frame()),
    run: (state) => {
      const encapsulated: IrbFrame = { ...frame(), encapsulated: true, routed: true, l3Vni: L3_VNI, innerSrcMac: ROUTER_MAC.LEAF1, innerDstMac: ROUTER_MAC.LEAF3, outerSrcVtep: VTEP_LOOPBACK.LEAF1, outerDstVtep: VTEP_LOOPBACK.LEAF3 };
      const journey: IrbJourneyHop[] = [
        { device: "LEAF1", input: "Ethernet[HOST-A → Anycast GW], IP[HOST-A → HOST-B]", lookup: `VRF ${VRF}: ${HOST_B_IP} → LEAF3, L3 VNI ${L3_VNI}`, action: "IRB_ROUTE_AND_ENCAP", output: `VXLAN(L3 VNI ${L3_VNI}) → ${VTEP_LOOPBACK.LEAF3}` },
        { device: "SPINE1", input: `Outer dst IP ${VTEP_LOOPBACK.LEAF3}`, lookup: "Underlay route lookup", action: "UNDERLAY_FORWARD", output: `Forward toward ${VTEP_LOOPBACK.LEAF3}` },
        { device: "LEAF3", input: `VXLAN(L3 VNI ${L3_VNI})`, lookup: `VRF ${VRF} destination route → VLAN 20 / L2 VNI ${L2_VNI_20}`, action: "IRB_DECAP_AND_ROUTE", output: "Ethernet rewritten → HOST-B" },
      ];
      return { state: { ...state, packet: { ...encapsulated, encapsulated: false, routed: false, innerSrcMac: GATEWAY_MAC, innerDstMac: HOST_B_MAC }, packetAt: "HOST-B", journey }, events: [{ type: "EGRESS_IRB_COMPLETED", stepId: "verify-dataplane", timestamp: Date.now(), message: "HOST-B receives the frame — symmetric IRB fully restored" }] };
    },
    whatChanged: () => ["✓ LEAF3 L3 VNI corrected", "✓ Routed VXLAN decapsulation succeeds", "✓ Egress IRB completes", "✓ HOST-B receives the frame"],
  },
  {
    id: "complete",
    label: "Lesson Complete",
    narrative: "HOST-A reaches HOST-B again — across two different subnets, through a Distributed Anycast Gateway local to each host, routed symmetrically at both LEAF1 and LEAF3 over a shared L3 VNI, all rebuilt by the exact same mechanics you watched the first time.",
  },
];
