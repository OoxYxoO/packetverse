import type { PacketLayer, PacketVisual, ScenarioStep } from "../types";

/**
 * EVPN + VXLAN Foundations — the first lesson in the future EVPN
 * track (see project brief). Deliberately scoped to a single
 * teaching arc: the cross-fabric Layer-2 problem → VXLAN data plane
 * (VTEP/VNI, no control plane yet) → the "how did it know the remote
 * MAC?" question → BGP EVPN Route Type 2 (MAC/IP Advertisement) →
 * local vs. remote MAC → one RT-import-style fault.
 *
 *        HOST-A                                    HOST-B
 *      10.10.10.11                              10.10.10.22
 *      AA:AA:AA:AA:AA:11                         BB:BB:BB:BB:BB:22
 *           │                                          │
 *         LEAF1 ─────────── SPINE1 ─────────────── LEAF2
 *      VTEP 10.255.0.1   (IP underlay only —     VTEP 10.255.0.2
 *                         never learns tenant MACs)
 *
 *   VLAN 10 (locally significant per leaf) is mapped to VNI 10010
 *   (fabric-wide) at both leafs — the two numbers are independent by
 *   design, not the same thing wearing two names.
 *
 * Explicitly DEFERRED (see brief §22 / the user's own scope note):
 * Route Types 1/3/4/5, EVPN multihoming, Ethernet Segment/ESI, DF
 * election, aliasing, mass withdrawal, IRB (symmetric/asymmetric),
 * anycast gateway, MAC mobility, ARP/ND suppression, EVPN-MPLS,
 * EVPN-VPWS. Those are follow-on modules, not this one.
 *
 * Pure data + pure functions only — see /lib/sim-engine/types.ts.
 */

export type LeafId = "LEAF1" | "LEAF2";
export type EvpnDeviceId = "HOST-A" | LeafId | "SPINE1" | "HOST-B";
export const LEAF_IDS: LeafId[] = ["LEAF1", "LEAF2"];
export const FABRIC_DEVICES: EvpnDeviceId[] = ["LEAF1", "SPINE1", "LEAF2"];

export const VNI = 10010;
export const VLAN = 10;
export const VTEP_LOOPBACK: Record<LeafId, string> = { LEAF1: "10.255.0.1", LEAF2: "10.255.0.2" };
export const OTHER_LEAF: Record<LeafId, LeafId> = { LEAF1: "LEAF2", LEAF2: "LEAF1" };

export const HOST_A_IP = "10.10.10.11";
export const HOST_A_MAC = "AA:AA:AA:AA:AA:11";
export const HOST_B_IP = "10.10.10.22";
export const HOST_B_MAC = "BB:BB:BB:BB:BB:22";

export const EVPN_EXPORT_RT = "65000:10010";
const CORRECT_IMPORT_RT: Record<LeafId, string> = { LEAF1: "65000:10010", LEAF2: "65000:10010" };
const BROKEN_IMPORT_RT = "65000:99999";
export function rdFor(leaf: LeafId): string {
  return `${VTEP_LOOPBACK[leaf]}:${VNI}`;
}

export const TERMS: { term: string; expansion: string; meaning: string }[] = [
  { term: "VTEP", expansion: "VXLAN Tunnel Endpoint", meaning: "The device (here, a leaf switch) that encapsulates/decapsulates VXLAN — identified by its own loopback IP, not by any tenant address." },
  { term: "VNI", expansion: "VXLAN Network Identifier", meaning: "A 24-bit, fabric-wide overlay segment ID carried inside the VXLAN header. Independent of any single switch's local VLAN numbering." },
  { term: "EVPN", expansion: "Ethernet VPN", meaning: "A BGP-based control plane that distributes MAC/IP reachability between VTEPs — the alternative to pure flood-and-learn." },
  { term: "Type 2", expansion: "MAC/IP Advertisement Route", meaning: "The EVPN route that tells remote VTEPs \"this MAC (and optionally IP) lives behind me.\"" },
  { term: "RT", expansion: "Route Target", meaning: "Controls which VNI table a Type-2 route gets imported into — same job it does in MPLS L3VPN, just applied to a MAC/IP route instead of an IP prefix." },
];

// ---------------------------------------------------------------------------
// MAC/IP table + EVPN Type-2 route model
// ---------------------------------------------------------------------------

export type MacLearnedVia = "local" | "assumed" | "evpn";

export interface MacEntry {
  mac: string;
  ip: string;
  learnedVia: MacLearnedVia;
  /** Set once this MAC is reachable via a remote VTEP (i.e. not attached to this leaf's own access port). */
  remoteVtep?: string;
}

export interface EvpnType2Route {
  mac: string;
  ip: string;
  vni: number;
  rd: string;
  rt: string;
  nextHop: string; // the owning VTEP's loopback — never the host's own IP
  originLeaf: LeafId;
}

export interface ReceivedEvpnRoute {
  route: EvpnType2Route;
  rtChecked: boolean;
  rtMatched: boolean;
  imported: boolean;
}

export type DataPlaneAction = "ENCAP" | "UNDERLAY_FORWARD" | "DECAP" | "LOCAL_DELIVER";
export interface EvpnJourneyHop {
  device: EvpnDeviceId;
  input: string;
  lookup: string;
  action: DataPlaneAction;
  output: string;
}

/** The frame in flight — starts/ends as a plain inner Ethernet frame; carries the VXLAN stack only between the two VTEPs. */
export interface DataFrame {
  innerSrcMac: string;
  innerDstMac: string;
  innerSrcIp: string;
  innerDstIp: string;
  encapsulated: boolean;
  outerSrcVtep?: string;
  outerDstVtep?: string;
}

export interface EvpnState {
  importRt: Record<LeafId, string>;
  macTable: Record<LeafId, MacEntry[]>;
  evpnRoute?: EvpnType2Route; // the one Type-2 route this lesson builds live: LEAF2's route for Host-B
  received: Partial<Record<LeafId, ReceivedEvpnRoute>>;
  bgpSessionUp: boolean;

  packet?: DataFrame;
  packetAt?: EvpnDeviceId;
  journey: EvpnJourneyHop[];

  faultActive: boolean;
  repairAttempt?: { choice: string; correct: boolean };
  challengeSucceeded?: boolean;
}

export function createEvpnState(): EvpnState {
  return {
    importRt: { ...CORRECT_IMPORT_RT },
    macTable: {
      // LEAF1 already "knows" Host-B for the first (pre-EVPN) walkthrough — a deliberate,
      // explicitly-flagged assumption the lesson surfaces and replaces later, never a lie
      // the learner discovers on their own (brief: "expose the limitation").
      LEAF1: [
        { mac: HOST_A_MAC, ip: HOST_A_IP, learnedVia: "local" },
        { mac: HOST_B_MAC, ip: HOST_B_IP, learnedVia: "assumed", remoteVtep: VTEP_LOOPBACK.LEAF2 },
      ],
      LEAF2: [{ mac: HOST_B_MAC, ip: HOST_B_IP, learnedVia: "local" }],
    },
    received: {},
    bgpSessionUp: false,
    journey: [],
    faultActive: false,
  };
}

// ---------------------------------------------------------------------------
// Graph layout (brief §1) — physical chain vs. a flattened logical L2 segment.
// ---------------------------------------------------------------------------

export const GRAPH_NODES = [
  { id: "HOST-A", label: "HOST-A", x: 6, y: 62, subLabel: HOST_A_IP, kind: "server" as const },
  { id: "LEAF1", label: "LEAF1", x: 27, y: 62, subLabel: `VTEP ${VTEP_LOOPBACK.LEAF1}`, kind: "switch" as const },
  { id: "SPINE1", label: "SPINE1", x: 50, y: 22, subLabel: "Underlay only", kind: "switch" as const },
  { id: "LEAF2", label: "LEAF2", x: 73, y: 62, subLabel: `VTEP ${VTEP_LOOPBACK.LEAF2}`, kind: "switch" as const },
  { id: "HOST-B", label: "HOST-B", x: 94, y: 62, subLabel: HOST_B_IP, kind: "server" as const },
];
export const GRAPH_EDGES = [
  { id: "HOST-A-LEAF1", a: "HOST-A", b: "LEAF1" },
  { id: "LEAF1-SPINE1", a: "LEAF1", b: "SPINE1", label: "Underlay" },
  { id: "SPINE1-LEAF2", a: "SPINE1", b: "LEAF2", label: "Underlay" },
  { id: "LEAF2-HOST-B", a: "LEAF2", b: "HOST-B" },
];
export const GRAPH_REGIONS = [
  { id: "underlay", label: "IP Underlay Fabric (Spine-Leaf)", x: 18, y: 6, width: 64, height: 62, tone: "cyan" as const },
  { id: "vni-overlay", label: `VNI ${VNI} Overlay`, x: 2, y: 52, width: 96, height: 20, tone: "violet" as const },
];

/** The control-plane-only EVPN session — never a data-plane hop, exactly like the Route Reflector lesson's RR edges. Spliced in only once the lesson has introduced BGP EVPN. */
export function withEvpnSession<N extends { id: string; x: number; y: number }, E extends { id: string; a: string; b: string; label?: string }>(nodes: N[], edges: E[], active: boolean): { nodes: N[]; edges: E[] } {
  if (!active) return { nodes, edges };
  return { nodes, edges: [...edges, { id: "LEAF1-LEAF2-evpn", a: "LEAF1", b: "LEAF2", label: "BGP EVPN" } as E] };
}

/** Simplified logical view (brief §18) — the fabric collapsed into one flat L2 segment over VNI 10010, spine hidden underneath. */
export const LOGICAL_GRAPH_NODES = [
  { id: "HOST-A", label: "HOST-A", x: 6, y: 50, subLabel: HOST_A_IP, kind: "server" as const },
  { id: "LEAF1", label: "LEAF1", x: 26, y: 50, subLabel: `VTEP ${VTEP_LOOPBACK.LEAF1}`, kind: "switch" as const },
  { id: "VNI-10010", label: "VNI 10010", x: 50, y: 50, subLabel: "Logical L2 segment", kind: "cloud" as const },
  { id: "LEAF2", label: "LEAF2", x: 74, y: 50, subLabel: `VTEP ${VTEP_LOOPBACK.LEAF2}`, kind: "switch" as const },
  { id: "HOST-B", label: "HOST-B", x: 94, y: 50, subLabel: HOST_B_IP, kind: "server" as const },
];
export const LOGICAL_GRAPH_EDGES = [
  { id: "HOST-A-LEAF1", a: "HOST-A", b: "LEAF1" },
  { id: "LEAF1-VNI", a: "LEAF1", b: "VNI-10010", label: "VNI 10010" },
  { id: "VNI-LEAF2", a: "VNI-10010", b: "LEAF2", label: "VNI 10010" },
  { id: "LEAF2-HOST-B", a: "LEAF2", b: "HOST-B" },
];

// ---------------------------------------------------------------------------
// Packet builders (brief §3/§4/§11/§12/§15)
// ---------------------------------------------------------------------------

function ethernetLayers(frame: DataFrame): PacketLayer[] {
  return [
    { name: "Ethernet", color: "var(--pv-proto-ethernet)", fields: [{ label: "Src MAC", value: frame.innerSrcMac }, { label: "Dst MAC", value: frame.innerDstMac }] },
    { name: "IPv4", color: "var(--pv-proto-ip)", fields: [{ label: "Src IP", value: frame.innerSrcIp }, { label: "Dst IP", value: frame.innerDstIp }] },
  ];
}

/** The exact 5-layer VXLAN stack (brief §3): [Outer Ethernet][Outer IP][UDP][VXLAN][Original Ethernet Frame]. */
function vxlanLayers(frame: DataFrame): PacketLayer[] {
  return [
    { name: "Outer Ethernet", color: "var(--pv-proto-ethernet)", fields: [{ label: "Src MAC", value: "(underlay next-hop, rewritten per hop)" }, { label: "Dst MAC", value: "(underlay next-hop, rewritten per hop)" }] },
    { name: "Outer IP", color: "var(--pv-proto-ip)", fields: [{ label: "Outer Src IP (VTEP)", value: frame.outerSrcVtep ?? "—" }, { label: "Outer Dst IP (VTEP)", value: frame.outerDstVtep ?? "—" }] },
    { name: "UDP", color: "var(--pv-proto-udp)", fields: [{ label: "Src Port", value: "(ephemeral, hashed for ECMP entropy)" }, { label: "Dst Port", value: "4789" }] },
    { name: "VXLAN Header", color: "var(--pv-proto-vxlan)", fields: [{ label: "VNI", value: String(VNI) }, { label: "Flags", value: "I-flag set (VNI valid)" }] },
    { name: "Original Ethernet Frame", color: "var(--pv-proto-ethernet)", fields: [{ label: "Inner Src MAC", value: frame.innerSrcMac }, { label: "Inner Dst MAC", value: frame.innerDstMac }, { label: "Inner Src IP", value: frame.innerSrcIp }, { label: "Inner Dst IP", value: frame.innerDstIp }] },
  ];
}

export function buildPacketLayers(frame: DataFrame): PacketLayer[] {
  return frame.encapsulated ? vxlanLayers(frame) : ethernetLayers(frame);
}

function framePacket(id: string, from: EvpnDeviceId, to: EvpnDeviceId, summary: string, frame: DataFrame): PacketVisual {
  return { id, protocol: frame.encapsulated ? "VXLAN" : "ETHERNET", from, to, summary, badge: frame.encapsulated ? "VXLAN" : "FRAME", layers: buildPacketLayers(frame) };
}

function evpnUpdatePacket(id: string, from: EvpnDeviceId, to: EvpnDeviceId, route: EvpnType2Route): PacketVisual {
  return {
    id,
    protocol: "BGP",
    from,
    to,
    summary: `EVPN Type 2 — ${route.mac} / ${route.ip}`,
    badge: "EVPN UPDATE",
    layers: [
      {
        name: "BGP UPDATE (EVPN)",
        color: "var(--pv-proto-bgp)",
        fields: [
          { label: "AFI/SAFI", value: "L2VPN EVPN" },
          { label: "Route Type", value: "2 (MAC/IP Advertisement)" },
          { label: "RD", value: route.rd },
          { label: "MAC Address", value: route.mac },
          { label: "IP Address", value: route.ip },
          { label: "VNI", value: String(route.vni) },
          { label: "Route Target", value: route.rt },
          { label: "Next Hop", value: route.nextHop },
        ],
      },
    ],
  };
}

/** X-ray focus indices (brief §15) — which layer(s) THIS device actually acts on. */
export function vniLayerIndex(packet: PacketVisual | undefined): number[] | undefined {
  const i = packet?.layers.findIndex((l) => l.name === "VXLAN Header") ?? -1;
  return i >= 0 ? [i] : undefined;
}
export function outerIpLayerIndex(packet: PacketVisual | undefined): number[] | undefined {
  const i = packet?.layers.findIndex((l) => l.name === "Outer IP") ?? -1;
  return i >= 0 ? [i] : undefined;
}
export function innerFrameLayerIndex(packet: PacketVisual | undefined): number[] | undefined {
  const i = packet?.layers.findIndex((l) => l.name === "Original Ethernet Frame") ?? -1;
  return i >= 0 ? [i] : undefined;
}
export function vniAndInnerLayerIndex(packet: PacketVisual | undefined): number[] | undefined {
  const vni = packet?.layers.findIndex((l) => l.name === "VXLAN Header") ?? -1;
  const inner = packet?.layers.findIndex((l) => l.name === "Original Ethernet Frame") ?? -1;
  const idx = [vni, inner].filter((n) => n >= 0);
  return idx.length ? idx : undefined;
}

function frame(overrides: Partial<DataFrame> = {}): DataFrame {
  return { innerSrcMac: HOST_A_MAC, innerDstMac: HOST_B_MAC, innerSrcIp: HOST_A_IP, innerDstIp: HOST_B_IP, encapsulated: false, ...overrides };
}

// ---------------------------------------------------------------------------
// Scenario steps
// ---------------------------------------------------------------------------

export const evpnSteps: ScenarioStep<EvpnState>[] = [
  {
    id: "intro",
    label: "The Cross-Fabric Problem",
    narrative:
      "HOST-A and HOST-B both sit in VLAN 10 — but they're behind different leaf switches (LEAF1, LEAF2), connected only through SPINE1, and the spine-leaf fabric is routed (Layer 3), not switched. A VLAN doesn't survive a Layer-3 hop by itself. HOST-A and HOST-B still need to talk as if they were on the same wire.",
  },
  {
    id: "predict-l2-problem",
    label: "Predict",
    narrative: "Before naming the fix:",
    question: {
      prompt: "SPINE1 only does IP forwarding between LEAF1 and LEAF2. Can a plain VLAN-10-tagged Ethernet frame from HOST-A reach HOST-B unmodified across that spine?",
      options: [
        { id: "yes", label: "Yes — routed cores forward any Ethernet frame" },
        { id: "no", label: "No — a Layer-3 hop doesn't carry a Layer-2 broadcast domain" },
        { id: "trunk", label: "Yes, as long as SPINE1 has a VLAN trunk configured" },
        { id: "static", label: "Yes, with a static route for VLAN 10" },
      ],
      correctOptionId: "no",
      explanation:
        "SPINE1 forwards on IP, hop by hop — it has no concept of VLAN 10 at all. To make LEAF1 and LEAF2 behave like one Layer-2 segment across a routed fabric, something has to re-encapsulate the original frame inside IP/UDP. That's exactly what VXLAN does.",
    },
  },
  {
    id: "vtep-vni-intro",
    label: "VTEP + VNI",
    narrative:
      `LEAF1 and LEAF2 are each a VTEP (VXLAN Tunnel Endpoint), identified by their own loopback — LEAF1 is ${VTEP_LOOPBACK.LEAF1}, LEAF2 is ${VTEP_LOOPBACK.LEAF2}. VNI ${VNI} is the fabric-wide overlay segment both leafs map VLAN ${VLAN} into. SPINE1 is not a VTEP at all — it never terminates or inspects VXLAN, it only routes IP packets between the two VTEPs' loopbacks.`,
  },
  {
    id: "vlan-vni-mapping",
    label: "VLAN ↔ VNI Mapping",
    narrative: `LEAF1: VLAN ${VLAN} → VNI ${VNI}. LEAF2: VLAN ${VLAN} → VNI ${VNI}. The mapping is what makes the two access ports part of the same overlay segment — not the numbers matching.`,
  },
  {
    id: "predict-vni-mapping",
    label: "Predict",
    narrative: "Before moving on:",
    question: {
      prompt: "Must a VNI numerically equal the local VLAN ID it's mapped from, at every switch in the fabric?",
      options: [
        { id: "yes", label: "Yes — they must always match numerically" },
        { id: "no", label: "No — VLAN ID is locally significant per switch; VNI is fabric-wide and independent" },
        { id: "vendor", label: "Only on some vendors' hardware" },
        { id: "single-switch", label: "Only if the whole fabric is a single switch" },
      ],
      correctOptionId: "no",
      explanation:
        "VLAN IDs are locally significant (0–4094, per switch). A VNI is a 24-bit, fabric-wide identifier carried inside the VXLAN header. LEAF1 could map local VLAN 10 and LEAF2 could map local VLAN 20 to the very same VNI, and they'd still be the same overlay segment — the VNI is what unifies them, not the VLAN numbering.",
    },
  },
  {
    id: "predict-udp-port",
    label: "Predict",
    narrative: "One more detail before the first packet moves:",
    question: {
      prompt: "What UDP destination port does VXLAN conventionally use?",
      options: [
        { id: "4789", label: "4789" },
        { id: "8472", label: "8472" },
        { id: "6081", label: "6081" },
        { id: "2152", label: "2152" },
      ],
      correctOptionId: "4789",
      explanation: "4789 is the IANA-assigned VXLAN port. (8472 was a pre-standard value some early implementations used; 6081 is Geneve; 2152 is GTP-U — a different tunneling protocol entirely.)",
    },
  },
  {
    id: "send-host-a",
    label: "HOST-A Sends",
    narrative: "HOST-A sends an ordinary Ethernet frame toward HOST-B — nothing about it looks any different from a same-switch conversation. For this first walkthrough, assume LEAF1 already somehow knows Host-B lives behind LEAF2 — we'll come back to exactly how in a moment.",
    packet: () => framePacket("f-host-a", "HOST-A", "LEAF1", "Ethernet frame — HOST-A → HOST-B", frame()),
    run: (state) => ({
      state: { ...state, packet: frame(), packetAt: "LEAF1" },
      events: [{ type: "PACKET_SENT", stepId: "send-host-a", timestamp: Date.now(), message: "HOST-A sends an Ethernet frame toward HOST-B" }],
    }),
  },
  {
    id: "leaf1-ingress",
    label: "LEAF1 — VXLAN Ingress",
    narrative:
      "Enter LEAF1's Conceptual VXLAN Ingress Pipeline: identify the VLAN on the access port, look up the destination MAC, map VLAN → VNI, resolve the remote VTEP for that MAC, encapsulate, look up the underlay route, and send it uplink toward SPINE1 as a normal IP/UDP packet.",
    packet: (state) => (state.packet ? framePacket("f-leaf1-out", "LEAF1", "SPINE1", "VXLAN-encapsulated — LEAF1 → LEAF2 via SPINE1", { ...state.packet, encapsulated: true, outerSrcVtep: VTEP_LOOPBACK.LEAF1, outerDstVtep: VTEP_LOOPBACK.LEAF2 }) : undefined),
    run: (state) => {
      const encapsulated: DataFrame = { ...(state.packet ?? frame()), encapsulated: true, outerSrcVtep: VTEP_LOOPBACK.LEAF1, outerDstVtep: VTEP_LOOPBACK.LEAF2 };
      const journey = [
        ...state.journey,
        { device: "LEAF1" as EvpnDeviceId, input: "Ethernet frame (VLAN 10)", lookup: `MAC ${HOST_B_MAC} → remote VTEP ${VTEP_LOOPBACK.LEAF2}`, action: "ENCAP" as DataPlaneAction, output: `VXLAN(VNI ${VNI}) → ${VTEP_LOOPBACK.LEAF2}` },
      ];
      return { state: { ...state, packet: encapsulated, packetAt: "SPINE1", journey }, events: [{ type: "PACKET_SENT", stepId: "leaf1-ingress", timestamp: Date.now(), message: "LEAF1 encapsulates the frame in VXLAN and forwards toward SPINE1" }] };
    },
    whatChanged: () => [`LEAF1: VLAN ${VLAN} → VNI ${VNI} mapping applied`, `LEAF1: remote VTEP resolved to ${VTEP_LOOPBACK.LEAF2}`, "LEAF1: VXLAN encapsulation complete"],
  },
  {
    id: "spine-forward",
    label: "SPINE1 — Underlay Only",
    narrative: `SPINE1 receives an ordinary IP/UDP packet. It looks at the outer destination IP (${VTEP_LOOPBACK.LEAF2}) and forwards it — that's all. SPINE1 never inspects the VXLAN header or the inner frame, and it never learns HOST-A's or HOST-B's MAC address. It doesn't need to.`,
    packet: (state) => (state.packet ? framePacket("f-spine-out", "SPINE1", "LEAF2", "VXLAN in flight — outer IP forwarding only", state.packet) : undefined),
    run: (state) => ({
      state: { ...state, packetAt: "LEAF2", journey: [...state.journey, { device: "SPINE1" as EvpnDeviceId, input: `Outer dst IP ${VTEP_LOOPBACK.LEAF2}`, lookup: "Underlay route lookup (ECMP)", action: "UNDERLAY_FORWARD" as DataPlaneAction, output: `Forward toward ${VTEP_LOOPBACK.LEAF2}` }] },
      events: [{ type: "PACKET_SENT", stepId: "spine-forward", timestamp: Date.now(), message: "SPINE1 forwards on outer IP alone" }],
    }),
  },
  {
    id: "leaf2-egress",
    label: "LEAF2 — VXLAN Egress",
    narrative:
      "Enter LEAF2's Conceptual VXLAN Egress Pipeline: receive the underlay packet, strip the outer IP/UDP/VXLAN headers, read the VNI to select the right overlay context, expose the original inner Ethernet frame, look up the inner destination MAC, and deliver out the access port to HOST-B — completely unmodified from what HOST-A sent.",
    packet: (state) => (state.packet ? framePacket("f-leaf2-out", "LEAF2", "HOST-B", "Decapsulated — original Ethernet frame delivered", { ...state.packet, encapsulated: false }) : undefined),
    run: (state) => {
      const decapsulated: DataFrame = { ...(state.packet ?? frame()), encapsulated: false };
      const journey = [...state.journey, { device: "LEAF2" as EvpnDeviceId, input: `VXLAN(VNI ${VNI}) from ${VTEP_LOOPBACK.LEAF1}`, lookup: `VNI ${VNI} → local VLAN ${VLAN}; MAC ${HOST_B_MAC} → access port`, action: "DECAP" as DataPlaneAction, output: "Original Ethernet frame" }];
      return { state: { ...state, packet: decapsulated, packetAt: "HOST-B", journey }, events: [{ type: "PACKET_RECEIVED", stepId: "leaf2-egress", timestamp: Date.now(), message: "LEAF2 decapsulates and delivers to HOST-B" }] };
    },
    whatChanged: () => ["LEAF2: VXLAN header removed", `LEAF2: VNI ${VNI} → local VLAN ${VLAN}`, "LEAF2: original frame delivered to HOST-B, byte for byte"],
  },
  {
    id: "delivered-host-b",
    label: "Delivered",
    narrative: "HOST-B receives exactly the frame HOST-A sent — same source/destination MAC, same payload. Everything about the VXLAN encapsulation happened entirely between the two VTEPs; neither host ever saw it.",
    run: (state) => ({ state: { ...state, journey: [...state.journey, { device: "HOST-B" as EvpnDeviceId, input: "Ethernet frame", lookup: "—", action: "LOCAL_DELIVER" as DataPlaneAction, output: "Delivered to application" }] }, events: [] }),
  },
  {
    id: "limitation-question",
    label: "The Unanswered Question",
    narrative:
      "Rewind: how did LEAF1 know, before any of this, that Host-B's MAC lives behind LEAF2 specifically? Traditional VXLAN answers this the same way ordinary Ethernet does — flood-and-learn. An unknown destination (or any broadcast/multicast/unknown-unicast, \"BUM\" traffic) gets head-end-replicated by the ingress VTEP to every other VTEP in that VNI, and whichever one responds teaches the ingress VTEP where that MAC really lives.",
  },
  {
    id: "predict-flood-limitation",
    label: "Predict",
    narrative: "Before introducing the alternative:",
    question: {
      prompt: "With only two leafs this flood-and-learn approach works fine. What does it mainly cost you as a VXLAN fabric grows to dozens or hundreds of leafs?",
      options: [
        { id: "nothing", label: "Nothing — it scales the same regardless of fabric size" },
        { id: "bum-cost", label: "Every BUM frame must be replicated to every VTEP in that VNI — more bandwidth, slower convergence, as the fabric grows" },
        { id: "security", label: "It's purely a security exposure, not a scaling one" },
        { id: "vlan-break", label: "It breaks VLAN tagging on the access ports" },
      ],
      correctOptionId: "bum-cost",
      explanation:
        "Head-end replication means the ingress VTEP itself must send a copy of every unknown/broadcast/multicast frame to every remote VTEP in the VNI. That cost grows with the fabric, and every learned MAC still has to age out and get re-flooded — there's no way to just ask \"where is this MAC\" and get a direct, verifiable answer.",
    },
  },
  {
    id: "evpn-intro",
    label: "Introducing BGP EVPN",
    narrative:
      "The alternative: let a control plane distribute MAC/IP reachability the same way BGP already distributes IP routes. LEAF1 and LEAF2 form a BGP EVPN session (drawn here as a control-plane-only link — it never carries a data packet). VXLAN stays exactly what it already is: the data-plane encapsulation. BGP EVPN is a separate thing layered on top: the control plane that tells a VTEP which remote VTEP owns which MAC/IP, instead of it having to flood and guess.",
    run: (state) => ({ state: { ...state, bgpSessionUp: true }, events: [{ type: "BGP_STATE_CHANGED", stepId: "evpn-intro", timestamp: Date.now(), message: "LEAF1 ↔ LEAF2 BGP EVPN session Established" }] }),
    whatChanged: () => ["LEAF1 ↔ LEAF2 BGP EVPN session: Established"],
  },
  {
    id: "host-b-local-learn",
    label: "LEAF2 Learns HOST-B Locally",
    narrative: `Set the flood-and-learn assumption aside — we're about to replace it with something real. HOST-B is attached to LEAF2's access port. LEAF2 learns MAC ${HOST_B_MAC} / IP ${HOST_B_IP} the ordinary local way: it's simply on that port.`,
  },
  {
    id: "evpn-type2-created",
    label: "EVPN Type 2 Route Created",
    narrative: `LEAF2 creates a BGP EVPN Type 2 (MAC/IP Advertisement) route for HOST-B: MAC ${HOST_B_MAC}, IP ${HOST_B_IP}, VNI ${VNI}, RD ${rdFor("LEAF2")} (so this route stays unique even if another VTEP reused these numbers), RT ${EVPN_EXPORT_RT} (controls import), Next Hop ${VTEP_LOOPBACK.LEAF2} — LEAF2's own VTEP, never HOST-B's own IP.`,
    run: (state) => {
      const route: EvpnType2Route = { mac: HOST_B_MAC, ip: HOST_B_IP, vni: VNI, rd: rdFor("LEAF2"), rt: EVPN_EXPORT_RT, nextHop: VTEP_LOOPBACK.LEAF2, originLeaf: "LEAF2" };
      return { state: { ...state, evpnRoute: route }, events: [{ type: "VPN_ROUTE_CREATED", stepId: "evpn-type2-created", timestamp: Date.now(), message: "LEAF2 creates an EVPN Type 2 route for HOST-B" }] };
    },
    whatChanged: () => [`LEAF2: EVPN Type 2 route built — MAC ${HOST_B_MAC}, IP ${HOST_B_IP}, VNI ${VNI}`],
  },
  {
    id: "route-builder-rd",
    label: "Build It Yourself — RD",
    narrative: "Which field keeps this route globally unique in BGP, even if some other VTEP pair reused the exact same VNI numbering?",
    question: {
      prompt: "Which field makes LEAF2's Type-2 route for HOST-B unique in BGP?",
      options: [
        { id: "rd", label: "RD (Route Distinguisher)" },
        { id: "rt", label: "RT (Route Target)" },
        { id: "nexthop", label: "Next Hop" },
        { id: "vni", label: "VNI" },
      ],
      correctOptionId: "rd",
      explanation: `Exactly like MPLS L3VPN: the RD (${rdFor("LEAF2")}) exists purely to make the route unique in BGP. It plays no role in import policy at all — that's the RT's job.`,
    },
  },
  {
    id: "route-builder-rt",
    label: "Build It Yourself — RT",
    narrative: "And which field actually controls whether LEAF1 imports this route?",
    question: {
      prompt: "Which field controls whether LEAF1 actually imports this Type-2 route into VNI 10010's table?",
      options: [
        { id: "rt", label: "RT (Route Target)" },
        { id: "rd", label: "RD (Route Distinguisher)" },
        { id: "vni", label: "The VNI number alone" },
        { id: "mac", label: "The MAC address alone" },
      ],
      correctOptionId: "rt",
      explanation: `LEAF1 compares the route's RT (${EVPN_EXPORT_RT}) against its own VNI 10010 import RT. Only on a match does the route enter LEAF1's table — the RD is just a uniqueness tag, not a policy control.`,
    },
  },
  {
    id: "route-builder-nexthop",
    label: "Build It Yourself — Next Hop",
    narrative: "One more field:",
    question: {
      prompt: "What should the BGP next-hop of this Type-2 route be?",
      options: [
        { id: "host-ip", label: "HOST-B's own IP address" },
        { id: "vtep", label: "LEAF2's VTEP loopback (10.255.0.2)" },
        { id: "spine", label: "SPINE1's loopback" },
        { id: "other-leaf", label: "LEAF1's loopback" },
      ],
      correctOptionId: "vtep",
      explanation: "The overlay next-hop always names the VTEP that will decapsulate traffic for this MAC/IP — never the end host itself. HOST-B never participates in VXLAN or BGP at all; it doesn't have a next-hop role here.",
    },
  },
  {
    id: "evpn-update-sent",
    label: "BGP UPDATE Sent",
    narrative: "LEAF2 advertises the Type 2 route to LEAF1 over the same BGP UPDATE mechanism the BGP lessons already introduced — just a new address family (L2VPN EVPN) instead of unicast IPv4.",
    packet: (state) => (state.evpnRoute ? evpnUpdatePacket("evpn-update", "LEAF2", "LEAF1", state.evpnRoute) : undefined),
    run: (state) => ({ state, events: [{ type: "MPBGP_VPN_ROUTE_ADVERTISED", stepId: "evpn-update-sent", timestamp: Date.now(), message: "LEAF2 advertises the Type 2 route to LEAF1" }] }),
  },
  {
    id: "evpn-route-received",
    label: "LEAF1 Receives The Route",
    narrative: `LEAF1 receives the Type 2 route and checks it: its VNI ${VNI} import RT is ${CORRECT_IMPORT_RT.LEAF1}, the route's RT is ${EVPN_EXPORT_RT} — a match.`,
    run: (state) => {
      if (!state.evpnRoute) return { state, events: [] };
      const rtMatched = state.importRt.LEAF1 === state.evpnRoute.rt;
      const received: ReceivedEvpnRoute = { route: state.evpnRoute, rtChecked: true, rtMatched, imported: rtMatched };
      return { state: { ...state, received: { ...state.received, LEAF1: received } }, events: [{ type: "RT_IMPORT_EVALUATED", stepId: "evpn-route-received", timestamp: Date.now(), message: `RT import check: ${rtMatched ? "match" : "no match"}` }] };
    },
    whatChanged: (prev, next) => [`LEAF1: EVPN route received — RT ${next.evpnRoute?.rt === next.importRt.LEAF1 ? "matched" : "did not match"}`],
  },
  {
    id: "remote-mac-installed",
    label: "Remote MAC Installed",
    narrative: `LEAF1 installs MAC ${HOST_B_MAC} / IP ${HOST_B_IP} into its table, pointing at remote VTEP ${VTEP_LOOPBACK.LEAF2} — this time as a verified, BGP-distributed fact instead of the assumption we started with.`,
    run: (state) => {
      const macTable = { ...state.macTable };
      macTable.LEAF1 = macTable.LEAF1.map((m) => (m.mac === HOST_B_MAC ? { ...m, learnedVia: "evpn" as MacLearnedVia, remoteVtep: VTEP_LOOPBACK.LEAF2 } : m));
      return { state: { ...state, macTable }, events: [{ type: "VPN_ROUTE_INSTALLED", stepId: "remote-mac-installed", timestamp: Date.now(), message: "LEAF1 installs the remote MAC/IP via EVPN" }] };
    },
    whatChanged: () => [`LEAF1: MAC ${HOST_B_MAC} now learned via EVPN (was: assumed)`],
  },
  {
    id: "before-after-recap",
    label: "Before / After",
    narrative:
      "Before: an unknown remote MAC meant every frame toward it had to be flooded to every VTEP and hope someone answered. After: LEAF1's table already has a verified entry — MAC, IP, VNI, and the exact remote VTEP — installed the moment LEAF2 advertised it, with no flooding required at all.",
  },
  {
    id: "resend-host-a",
    label: "Send It Again — Properly",
    narrative: "HOST-A sends the same frame toward HOST-B again — this time LEAF1's remote-MAC entry is a real, EVPN-distributed fact, not an assumption.",
    packet: () => framePacket("f-host-a-2", "HOST-A", "LEAF1", "Ethernet frame — HOST-A → HOST-B (again)", frame()),
    run: (state) => ({ state: { ...state, packet: frame(), packetAt: "LEAF1" }, events: [{ type: "PACKET_SENT", stepId: "resend-host-a", timestamp: Date.now(), message: "HOST-A sends toward HOST-B again" }] }),
  },
  {
    id: "leaf1-ingress-confirmed",
    label: "LEAF1 — Same Pipeline, Real Route",
    narrative: "The exact same Conceptual VXLAN Ingress Pipeline runs — but the remote-VTEP-resolution stage now reads a real EVPN-learned entry instead of an assumption.",
    packet: (state) => (state.packet ? framePacket("f-leaf1-out-2", "LEAF1", "SPINE1", "VXLAN-encapsulated (via EVPN-learned route)", { ...state.packet, encapsulated: true, outerSrcVtep: VTEP_LOOPBACK.LEAF1, outerDstVtep: VTEP_LOOPBACK.LEAF2 }) : undefined),
    run: (state) => {
      const encapsulated: DataFrame = { ...(state.packet ?? frame()), encapsulated: true, outerSrcVtep: VTEP_LOOPBACK.LEAF1, outerDstVtep: VTEP_LOOPBACK.LEAF2 };
      const journey = [...state.journey, { device: "LEAF1" as EvpnDeviceId, input: "Ethernet frame (VLAN 10)", lookup: `MAC ${HOST_B_MAC} → remote VTEP ${VTEP_LOOPBACK.LEAF2} (via EVPN)`, action: "ENCAP" as DataPlaneAction, output: `VXLAN(VNI ${VNI}) → ${VTEP_LOOPBACK.LEAF2}` }];
      return { state: { ...state, packet: encapsulated, packetAt: "SPINE1", journey }, events: [{ type: "PACKET_SENT", stepId: "leaf1-ingress-confirmed", timestamp: Date.now(), message: "LEAF1 encapsulates using the EVPN-learned entry" }] };
    },
  },
  {
    id: "spine-forward-confirmed",
    label: "SPINE1 — Still Just IP",
    narrative: "Same as before: SPINE1 forwards on outer IP alone. Nothing about EVPN changes what the spine does, because EVPN never touches the data plane.",
    packet: (state) => (state.packet ? framePacket("f-spine-out-2", "SPINE1", "LEAF2", "VXLAN in flight — outer IP forwarding only", state.packet) : undefined),
    run: (state) => ({ state: { ...state, packetAt: "LEAF2", journey: [...state.journey, { device: "SPINE1" as EvpnDeviceId, input: `Outer dst IP ${VTEP_LOOPBACK.LEAF2}`, lookup: "Underlay route lookup (ECMP)", action: "UNDERLAY_FORWARD" as DataPlaneAction, output: `Forward toward ${VTEP_LOOPBACK.LEAF2}` }] }, events: [] }),
  },
  {
    id: "leaf2-egress-confirmed",
    label: "LEAF2 — Delivered Again",
    narrative: "LEAF2 decapsulates and delivers to HOST-B — the same result as before, now resting on a verified control plane instead of an assumption.",
    packet: (state) => (state.packet ? framePacket("f-leaf2-out-2", "LEAF2", "HOST-B", "Decapsulated — delivered", { ...state.packet, encapsulated: false }) : undefined),
    run: (state) => {
      const decapsulated: DataFrame = { ...(state.packet ?? frame()), encapsulated: false };
      const journey = [...state.journey, { device: "LEAF2" as EvpnDeviceId, input: `VXLAN(VNI ${VNI}) from ${VTEP_LOOPBACK.LEAF1}`, lookup: `VNI ${VNI} → local VLAN ${VLAN}; MAC ${HOST_B_MAC} → access port`, action: "DECAP" as DataPlaneAction, output: "Original Ethernet frame" }];
      return { state: { ...state, packet: decapsulated, packetAt: "HOST-B", journey }, events: [{ type: "PACKET_RECEIVED", stepId: "leaf2-egress-confirmed", timestamp: Date.now(), message: "LEAF2 delivers to HOST-B" }] };
    },
  },
  {
    id: "journey-recap",
    label: "Full Journey, Twice",
    narrative: "The data-plane path never changed: HOST-A → LEAF1 (encap) → SPINE1 (IP forward) → LEAF2 (decap) → HOST-B. What changed is how LEAF1 knew where to send it — from an assumption, to a real, BGP-distributed EVPN Type 2 route.",
  },
  {
    id: "break-intro",
    label: "Break The Fabric",
    narrative: "Everything has worked cleanly so far. Time to break something specific and realistic: LEAF1's VNI 10010 import policy.",
  },
  {
    id: "fault-injected",
    label: "EVPN Route Target Misconfigured",
    narrative: `An engineer changes LEAF1's VNI ${VNI} import RT to ${BROKEN_IMPORT_RT}. It no longer matches LEAF2's export RT (${EVPN_EXPORT_RT}) — LEAF1's previously-imported remote MAC entry is withdrawn.`,
    run: (state) => {
      const importRt = { ...state.importRt, LEAF1: BROKEN_IMPORT_RT };
      const received = state.received.LEAF1 ? { ...state.received.LEAF1, rtChecked: true, rtMatched: false, imported: false } : undefined;
      const macTable = { ...state.macTable, LEAF1: state.macTable.LEAF1.filter((m) => m.mac !== HOST_B_MAC) };
      return {
        state: { ...state, importRt, received: received ? { ...state.received, LEAF1: received } : state.received, macTable, faultActive: true },
        events: [
          { type: "RT_IMPORT_EVALUATED", stepId: "fault-injected", timestamp: Date.now(), message: `LEAF1 import RT changed to ${BROKEN_IMPORT_RT} — no longer matches` },
          { type: "VPN_ROUTE_WITHDRAWN", stepId: "fault-injected", timestamp: Date.now(), message: `Remote MAC ${HOST_B_MAC} withdrawn from LEAF1` },
        ],
      };
    },
    whatChanged: () => [`LEAF1 VNI ${VNI} import RT: ${EVPN_EXPORT_RT} → ${BROKEN_IMPORT_RT}`, `LEAF1 table: MAC ${HOST_B_MAC} removed`],
  },
  {
    id: "trouble-intro",
    label: "Troubleshoot",
    narrative:
      "Complaint: \"HOST-A can't reach HOST-B. LEAF1's access port is up, the underlay IGP is converged, LEAF1 can ping LEAF2's VTEP loopback, and the LEAF1↔LEAF2 BGP EVPN session shows Established.\" Inspect the EVPN table, the received Type-2 route, its RD and RT, and LEAF1's MAC table before you answer.",
  },
  {
    id: "trouble-question",
    label: "Troubleshoot",
    narrative: "Every layer beneath EVPN policy is healthy.",
    question: {
      prompt: "Where is HOST-B's route disappearing?",
      options: [
        { id: "bgp-session", label: "The LEAF1↔LEAF2 EVPN BGP session itself" },
        { id: "underlay", label: "Underlay IGP reachability" },
        { id: "rt", label: "Route Target import policy on LEAF1" },
        { id: "vtep", label: "VTEP-to-VTEP IP reachability" },
      ],
      correctOptionId: "rt",
      explanation:
        "An Established EVPN session doesn't mean every route gets imported — that's a separate policy check. LEAF2's route is still advertised and received fine; LEAF1's VNI 10010 import RT simply no longer matches LEAF2's export RT, so the route is filtered out before it's ever installed.",
      hints: [
        "Hint 1: the BGP EVPN session is Established. Don't troubleshoot the session itself.",
        "Hint 2: the route still arrives — check whether it's actually imported, not just received.",
        "Hint 3: compare the route's RT against LEAF1's VNI 10010 import RT.",
      ],
    },
  },
  {
    id: "diagnostic-layers",
    label: "Layer By Layer",
    narrative: "An Established BGP session doesn't mean every route is correctly imported, and a healthy underlay doesn't mean control-plane policy is correct. Troubleshooting by layer shows exactly where this fault lives: everything below RT import is healthy.",
  },
  {
    id: "repair-challenge",
    label: "Apply The Fix",
    narrative: "Choose the correct repair for LEAF1's VNI 10010 import policy.",
    action: (state, payload) => {
      const choice = typeof payload === "object" && payload !== null && "choice" in payload ? String((payload as { choice: string }).choice) : "";
      if (choice !== "fix-rt") return { state: { ...state, repairAttempt: { choice, correct: false } }, events: [] };
      const importRt = { ...state.importRt, LEAF1: CORRECT_IMPORT_RT.LEAF1 };
      const route = state.evpnRoute;
      const received: ReceivedEvpnRoute | undefined = route ? { route, rtChecked: true, rtMatched: true, imported: true } : undefined;
      const macTable = { ...state.macTable, LEAF1: [...state.macTable.LEAF1.filter((m) => m.mac !== HOST_B_MAC), { mac: HOST_B_MAC, ip: HOST_B_IP, learnedVia: "evpn" as MacLearnedVia, remoteVtep: VTEP_LOOPBACK.LEAF2 }] };
      return {
        state: { ...state, importRt, received: received ? { ...state.received, LEAF1: received } : state.received, macTable, faultActive: false, repairAttempt: { choice, correct: true }, challengeSucceeded: true },
        events: [
          { type: "RT_IMPORT_EVALUATED", stepId: "repair-challenge", timestamp: Date.now(), message: `LEAF1 import RT corrected to ${EVPN_EXPORT_RT} — match` },
          { type: "VPN_ROUTE_IMPORTED", stepId: "repair-challenge", timestamp: Date.now(), message: "Remote MAC re-imported" },
          { type: "VPN_ROUTE_INSTALLED", stepId: "repair-challenge", timestamp: Date.now(), message: "Route installed" },
        ],
      };
    },
    requiresState: (state) => state.challengeSucceeded === true,
  },
  {
    id: "verify-dataplane",
    label: "Verify End To End",
    narrative: "Send a frame through again to prove the repair actually restored the data plane, not just the control-plane table.",
    packet: () => framePacket("f-verify", "HOST-A", "LEAF1", "Verification frame", frame()),
    run: (state) => {
      const encapsulated = { ...frame(), encapsulated: true, outerSrcVtep: VTEP_LOOPBACK.LEAF1, outerDstVtep: VTEP_LOOPBACK.LEAF2 };
      const journey: EvpnJourneyHop[] = [
        { device: "LEAF1", input: "Ethernet frame (VLAN 10)", lookup: `MAC ${HOST_B_MAC} → remote VTEP ${VTEP_LOOPBACK.LEAF2}`, action: "ENCAP", output: `VXLAN(VNI ${VNI}) → ${VTEP_LOOPBACK.LEAF2}` },
        { device: "SPINE1", input: `Outer dst IP ${VTEP_LOOPBACK.LEAF2}`, lookup: "Underlay route lookup", action: "UNDERLAY_FORWARD", output: `Forward toward ${VTEP_LOOPBACK.LEAF2}` },
        { device: "LEAF2", input: `VXLAN(VNI ${VNI})`, lookup: `VNI ${VNI} → VLAN ${VLAN}`, action: "DECAP", output: "Original Ethernet frame → HOST-B" },
      ];
      return {
        state: { ...state, packet: { ...encapsulated, encapsulated: false }, packetAt: "HOST-B", journey },
        events: [{ type: "VPN_PACKET_DELIVERED", stepId: "verify-dataplane", timestamp: Date.now(), message: "HOST-B receives the frame — EVPN + VXLAN fully restored" }],
      };
    },
    whatChanged: () => ["✓ EVPN route re-imported", "✓ Remote MAC table updated", "✓ VXLAN encap/decap unaffected throughout", "✓ Frame delivered to HOST-B"],
  },
  {
    id: "complete",
    label: "Lesson Complete",
    narrative: "HOST-A reaches HOST-B again — across a routed spine-leaf fabric, using VXLAN for the actual encapsulation and BGP EVPN Type 2 for the control plane that told LEAF1 where to send it, all rebuilt by the exact same mechanics you watched the first time.",
  },
];
