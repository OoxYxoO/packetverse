import type { PacketVisual, ScenarioStep } from "../types";
import { HOST_A_IP, HOST_A_MAC, HOST_B_IP, HOST_B_MAC, VLAN, VNI, VTEP_LOOPBACK } from "./evpnMacMobility";

/**
 * EVPN ARP/ND Suppression — the sixth lesson in the EVPN track,
 * reusing the same fabric "EVPN + VXLAN Foundations" / "MAC Mobility"
 * built (see docs/ARCHITECTURE.md §4 — host identities and VTEP
 * loopbacks imported verbatim from `evpnMacMobility.ts`, which itself
 * reused them from `evpnBum.ts` / `evpnVxlan.ts`).
 *
 * The question this lesson answers: an EVPN fabric already knows
 * every locally-learned endpoint's MAC/IP binding (Type 2) and every
 * VNI's flood list (Type 3, from the BUM lesson) — so does an ingress
 * VTEP really need to flood an ARP/ND request across the whole fabric
 * just to answer a question it can already answer itself?
 *
 * Explicitly DEFERRED: EVPN multihoming, ESI, DF election, mass
 * withdrawal (per the user's own stated sequence). A second, fully
 * simulated IPv6/ND flow is deliberately NOT built — ND is introduced
 * as a short, explicit analogy to ARP, reusing the exact same
 * suppression mechanism conceptually rather than a parallel pipeline.
 * MAC Mobility itself is not re-simulated — HOST-B's location change
 * is a single state flip tying back into the previous lesson's own
 * mechanism, not a new movement simulation.
 *
 * Pure data + pure functions only — see /lib/sim-engine/types.ts.
 */

export type LeafId = "LEAF1" | "LEAF2" | "LEAF3";
export type EvpnArpNdDeviceId = "HOST-A" | LeafId | "SPINE1" | "HOST-B";
export const FABRIC_DEVICES: EvpnArpNdDeviceId[] = ["LEAF1", "SPINE1", "LEAF2", "LEAF3"];

export { HOST_A_IP, HOST_A_MAC, HOST_B_IP, HOST_B_MAC, VLAN, VNI, VTEP_LOOPBACK };

const UNKNOWN_TARGET_IP = "10.10.10.99";
export { UNKNOWN_TARGET_IP };

export const TERMS: { term: string; expansion: string; meaning: string }[] = [
  { term: "ARP Suppression", expansion: "Local Proxy Reply", meaning: "The ingress VTEP answers an ARP request itself, from its own EVPN-learned MAC/IP binding, instead of flooding the request across the fabric." },
  { term: "MAC/IP Binding", expansion: "Not The Same As...", meaning: "A specific IP-to-MAC-to-VTEP fact used for suppression — related to, but distinct from, the MAC table, the EVPN route, and a host's own ARP cache." },
  { term: "ND", expansion: "Neighbor Discovery (IPv6)", meaning: "IPv6's analog to ARP — Neighbor Solicitation / Neighbor Advertisement. Suppressed the same conceptual way; IPv6 never uses ARP itself." },
  { term: "Type 2 → Suppress", expansion: "Endpoint Knowledge", meaning: "\"I know the endpoint\" — the control-plane input that makes suppression possible." },
  { term: "Type 3 → Fallback", expansion: "Still Needed", meaning: "\"I know the VNI participants\" — still exactly how BUM traffic is handled whenever suppression can't answer." },
];

// ---------------------------------------------------------------------------
// MAC/IP binding model — deliberately distinct from a plain MAC table entry.
// ---------------------------------------------------------------------------

export interface MacIpBinding {
  ip: string;
  mac: string;
  origin: "local" | "remote";
  vtep?: string;
  /** The fault lives here: the underlying Type-2 MAC route can be perfectly healthy while this specific IP information is missing — suppression needs BOTH. */
  hasIpInfo: boolean;
}

export type ReplicaStage = "none" | "leaf1-to-spine" | "spine-to-leaves" | "delivered";
export interface Replica {
  id: string;
  toLeaf: LeafId;
}

export type ArpAction = "CLASSIFY_BUM" | "REPLICATE" | "UNDERLAY_FORWARD" | "SUPPRESSED_REPLY" | "DELIVER";
export interface JourneyHop {
  device: EvpnArpNdDeviceId;
  input: string;
  lookup: string;
  action: ArpAction;
  output: string;
}

export interface EvpnArpNdState {
  bgpSessionUp: boolean;
  suppressionEnabled: boolean;
  hostBLocation: LeafId; // LEAF3 initially; the mobility tie-in (brief §14) flips this to LEAF2
  macIpBindings: Record<LeafId, MacIpBinding[]>;
  arpCacheHostA: { ip: string; mac: string }[]; // HOST-A's OWN neighbor cache — a genuinely separate table from any leaf's EVPN binding (brief §20)

  replicaStage: ReplicaStage;
  replicas: Replica[];
  packetAt?: EvpnArpNdDeviceId;
  journey: JourneyHop[];

  lastReplicaCount: number; // sticky, for the efficiency dashboard even once replicas clear back to []
  lastVtepsTouched: number;

  faultActive: boolean;
  repairAttempt?: { choice: string; correct: boolean };
  challengeSucceeded?: boolean;
}

function initialBindings(): Record<LeafId, MacIpBinding[]> {
  return {
    LEAF1: [
      { ip: HOST_A_IP, mac: HOST_A_MAC, origin: "local", hasIpInfo: true },
      { ip: HOST_B_IP, mac: HOST_B_MAC, origin: "remote", vtep: VTEP_LOOPBACK.LEAF3, hasIpInfo: true },
    ],
    LEAF2: [{ ip: HOST_B_IP, mac: HOST_B_MAC, origin: "remote", vtep: VTEP_LOOPBACK.LEAF3, hasIpInfo: true }],
    LEAF3: [{ ip: HOST_B_IP, mac: HOST_B_MAC, origin: "local", hasIpInfo: true }],
  };
}

export function createEvpnArpNdState(): EvpnArpNdState {
  return {
    bgpSessionUp: true,
    suppressionEnabled: false,
    hostBLocation: "LEAF3",
    macIpBindings: initialBindings(),
    arpCacheHostA: [],
    replicaStage: "none",
    replicas: [],
    journey: [],
    lastReplicaCount: 0,
    lastVtepsTouched: 0,
    faultActive: false,
  };
}

// ---------------------------------------------------------------------------
// Pure scenario functions (brief §29)
// ---------------------------------------------------------------------------

export function lookupMacIpBinding(bindings: MacIpBinding[], ip: string): MacIpBinding | undefined {
  return bindings.find((b) => b.ip === ip);
}

/** Suppression requires BOTH a binding AND that binding actually carrying IP information — a healthy Type-2 MAC route alone is not enough. */
export function canSuppressNeighborDiscovery(binding: MacIpBinding | undefined): boolean {
  return !!binding && binding.origin === "remote" && binding.hasIpInfo;
}

export function buildProxyArpReply(binding: MacIpBinding, from: EvpnArpNdDeviceId, to: EvpnArpNdDeviceId): PacketVisual {
  return {
    id: "arp-proxy-reply",
    protocol: "ARP",
    from,
    to,
    summary: `${binding.ip} is at ${binding.mac} (local proxy reply)`,
    badge: "PROXY ARP REPLY",
    layers: [{ name: "ARP Reply (Proxy)", color: "var(--pv-proto-arp)", fields: [
      { label: "Sender IP", value: binding.ip },
      { label: "Sender MAC", value: binding.mac },
      { label: "Answered By", value: "LEAF1, from its own EVPN MAC/IP database — not HOST-B itself" },
      { label: "Target MAC", value: HOST_A_MAC },
    ] }],
  };
}

export function fallbackToBum(floodList: LeafId[]): Replica[] {
  return floodList.map((toLeaf) => ({ id: `rep-${toLeaf}`, toLeaf }));
}

function arpRequestPacket(from: EvpnArpNdDeviceId, to: EvpnArpNdDeviceId, targetIp: string): PacketVisual {
  return {
    id: "arp-request",
    protocol: "ARP",
    from,
    to,
    summary: `Who has ${targetIp}? Tell ${HOST_A_IP}`,
    badge: "ARP REQUEST",
    broadcast: true,
    layers: [{ name: "ARP Request", color: "var(--pv-proto-arp)", fields: [
      { label: "Sender IP", value: HOST_A_IP },
      { label: "Sender MAC", value: HOST_A_MAC },
      { label: "Target IP", value: targetIp },
      { label: "Target MAC", value: "unknown" },
      { label: "Ethernet Destination", value: "FF:FF:FF:FF:FF:FF" },
    ] }],
  };
}

function replicaPacket(replica: Replica, from: EvpnArpNdDeviceId, to: EvpnArpNdDeviceId, encapsulated: boolean): PacketVisual {
  return { id: `bum-${replica.id}`, protocol: encapsulated ? "VXLAN" : "ETHERNET", from, to, summary: `ARP broadcast copy toward ${replica.toLeaf}`, badge: encapsulated ? "VXLAN" : "BROADCAST", broadcast: !encapsulated, layers: [{ name: encapsulated ? "VXLAN Header" : "Ethernet", color: encapsulated ? "var(--pv-proto-vxlan)" : "var(--pv-proto-ethernet)", fields: [{ label: "VNI", value: String(VNI) }, { label: "Toward", value: `${replica.toLeaf} (${VTEP_LOOPBACK[replica.toLeaf]})` }] }] };
}

function layerIndex(packet: PacketVisual | undefined, name: string): number[] | undefined {
  const i = packet?.layers.findIndex((l) => l.name === name) ?? -1;
  return i >= 0 ? [i] : undefined;
}
export function outerIpLayerIndex(packet: PacketVisual | undefined): number[] | undefined {
  return layerIndex(packet, "Outer IP");
}

export { arpRequestPacket, replicaPacket };

// ---------------------------------------------------------------------------
// Graph layout
// ---------------------------------------------------------------------------

interface GNode { id: string; label: string; x: number; y: number; subLabel?: string; kind?: "server" | "switch" | "cloud"; }
interface GEdge { id: string; a: string; b: string; label?: string; }

export const GRAPH_NODES: GNode[] = [
  { id: "HOST-A", label: "HOST-A", x: 15, y: 88, subLabel: `${HOST_A_IP} · VLAN ${VLAN}`, kind: "server" },
  { id: "LEAF1", label: "LEAF1", x: 15, y: 58, subLabel: `VTEP ${VTEP_LOOPBACK.LEAF1}`, kind: "switch" },
  { id: "SPINE1", label: "SPINE1", x: 50, y: 18, subLabel: "Underlay only", kind: "switch" },
  { id: "LEAF2", label: "LEAF2", x: 50, y: 58, subLabel: `VTEP ${VTEP_LOOPBACK.LEAF2}`, kind: "switch" },
  { id: "HOST-B", label: "HOST-B", x: 85, y: 88, subLabel: `${HOST_B_IP} · VLAN ${VLAN}`, kind: "server" },
  { id: "LEAF3", label: "LEAF3", x: 85, y: 58, subLabel: `VTEP ${VTEP_LOOPBACK.LEAF3}`, kind: "switch" },
];
export const GRAPH_EDGES: GEdge[] = [
  { id: "HOST-A-LEAF1", a: "HOST-A", b: "LEAF1" },
  { id: "HOST-B-LEAF3", a: "HOST-B", b: "LEAF3" },
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

export const LOGICAL_GRAPH_NODES: GNode[] = [
  { id: "HOST-A", label: "HOST-A", x: 15, y: 15, subLabel: HOST_A_IP, kind: "server" },
  { id: "CONTROL", label: "Type 2: I Know The Endpoint", x: 50, y: 35, kind: "cloud" },
  { id: "DISCOVERY", label: "Local Suppression", x: 50, y: 60, kind: "cloud" },
  { id: "DATA", label: "VXLAN Unicast → HOST-B", x: 85, y: 85, subLabel: HOST_B_IP, kind: "cloud" },
];
export const LOGICAL_GRAPH_EDGES: GEdge[] = [
  { id: "hosta-control", a: "HOST-A", b: "CONTROL", label: "enables" },
  { id: "control-discovery", a: "CONTROL", b: "DISCOVERY", label: "enables" },
  { id: "discovery-data", a: "DISCOVERY", b: "DATA", label: "enables" },
];

// ---------------------------------------------------------------------------
// Scenario steps
// ---------------------------------------------------------------------------

export const evpnArpNdSteps: ScenarioStep<EvpnArpNdState>[] = [
  {
    id: "intro",
    label: "One Request, Many Copies?",
    narrative: `HOST-A (${HOST_A_MAC}) wants HOST-B's MAC (${HOST_B_IP}). Before anything is optimized, let's watch what ARP normally does across a VXLAN fabric.`,
  },
  {
    id: "arp-broadcast",
    label: "HOST-A Broadcasts",
    narrative: `"Who has ${HOST_B_IP}? Tell ${HOST_A_IP}." Ethernet destination: FF:FF:FF:FF:FF:FF — an ordinary ARP broadcast, exactly as any host would send.`,
    packet: () => arpRequestPacket("HOST-A", "LEAF1", HOST_B_IP),
    run: (state) => ({ state: { ...state, packetAt: "LEAF1" }, events: [{ type: "ARP_REQUEST_SENT", stepId: "arp-broadcast", timestamp: Date.now(), message: "HOST-A broadcasts an ARP request" }] }),
  },
  {
    id: "leaf1-classify-bum",
    label: "LEAF1 Classifies This As BUM",
    narrative: `LEAF1 sees destination FF:FF:FF:FF:FF:FF — classified as BUM, exactly like any other broadcast. It consults VNI ${VNI}'s flood list: LEAF2, LEAF3.`,
    run: (state) => ({ state, events: [{ type: "MAC_LEARNED", stepId: "leaf1-classify-bum", timestamp: Date.now(), message: "LEAF1 classifies the ARP request as BUM" }] }),
  },
  {
    id: "flood-replicate",
    label: "Ingress Replication — Two Copies",
    narrative: "LEAF1 creates one independent VXLAN copy per flood-list entry — the exact same ingress replication mechanism the BUM lesson built.",
    run: (state) => {
      const replicas: Replica[] = [{ id: "rep-LEAF2", toLeaf: "LEAF2" }, { id: "rep-LEAF3", toLeaf: "LEAF3" }];
      return { state: { ...state, replicaStage: "leaf1-to-spine", replicas, journey: [...state.journey, { device: "LEAF1", input: "ARP broadcast", lookup: `Destination FF:FF:FF:FF:FF:FF → BUM → flood list [LEAF2, LEAF3]`, action: "REPLICATE", output: "2 VXLAN copies created" }] }, events: [{ type: "PACKET_SENT", stepId: "flood-replicate", timestamp: Date.now(), message: "LEAF1 replicates the ARP broadcast toward LEAF2 and LEAF3" }] };
    },
  },
  {
    id: "flood-delivered",
    label: "Both Remote Leafs Receive It",
    narrative: "SPINE1 forwards each copy on outer IP alone; LEAF2 and LEAF3 each decapsulate and flood the ARP request onto their own local VLAN 10 segments.",
    run: (state) => ({ state: { ...state, replicaStage: "delivered", lastReplicaCount: 2, lastVtepsTouched: 2, journey: [...state.journey, { device: "SPINE1", input: "2 underlay packets", lookup: "Outer IP lookup, per packet", action: "UNDERLAY_FORWARD", output: "Forwarded to LEAF2 and LEAF3" }] }, events: [] }),
  },
  {
    id: "cost-visible",
    label: "The Cost, Made Visible",
    narrative: "Original ARP frames: 1. VXLAN replicas: 2. Remote VTEPs touched: 2 — for a single host asking a single question.",
  },
  {
    id: "predict-at-scale",
    label: "Predict",
    narrative: "This fabric only has three leafs.",
    question: {
      prompt: "What happens to this cost as a fabric grows to dozens or hundreds of leafs, with thousands of endpoints repeatedly generating ARP/ND?",
      options: [
        { id: "same", label: "Nothing changes — ARP traffic doesn't scale with fabric size" },
        { id: "grows", label: "The replication cost grows with the fabric — every leaf in the VNI gets a copy of every such request" },
        { id: "shrinks", label: "It actually shrinks as more leafs join" },
        { id: "irrelevant", label: "It's irrelevant because ARP is rare" },
      ],
      correctOptionId: "grows",
      explanation: "Every additional leaf in the VNI is one more copy the ingress VTEP has to create for every BUM frame — including ordinary ARP/ND traffic. This doesn't mean the fabric collapses, but it's real, avoidable cost worth reducing.",
    },
  },
  {
    id: "type2-recap",
    label: "LEAF3 Already Told Everyone",
    narrative: `LEAF3 already advertised HOST-B — MAC ${HOST_B_MAC}, IP ${HOST_B_IP} — via ordinary EVPN Type 2. LEAF1's own EVPN database already contains: ${HOST_B_IP} → ${HOST_B_MAC} → remote VTEP LEAF3.`,
  },
  {
    id: "predict-need-to-flood",
    label: "Predict",
    narrative: "LEAF1 already has this exact binding on file.",
    question: {
      prompt: "Does LEAF1 really need to flood the ARP request across the fabric to answer it?",
      options: [
        { id: "yes", label: "Yes — ARP must always be flooded" },
        { id: "no", label: "No — LEAF1 already knows the answer and can reply locally" },
      ],
      correctOptionId: "no",
      explanation: "If the binding is already known, flooding the fabric just to re-discover it is unnecessary work. This is exactly the gap EVPN ARP/ND Suppression closes.",
    },
  },
  {
    id: "suppression-intro",
    label: "Introducing ARP Suppression",
    narrative: "LEAF1 can use its own EVPN MAC/IP database to answer HOST-A's ARP request directly — a local proxy reply, no fabric-wide flood required.",
    run: (state) => ({ state: { ...state, suppressionEnabled: true, replicaStage: "none", replicas: [] }, events: [] }),
  },
  {
    id: "mac-ip-binding-table",
    label: "The EVPN MAC/IP Binding Table",
    narrative: `Look at LEAF1's own table: ${HOST_B_IP} → ${HOST_B_MAC} → Remote → LEAF3. This is a specific concept — related to, but distinct from, a plain MAC table, an EVPN route, and HOST-A's own ARP cache.`,
  },
  {
    id: "suppressed-arp-request",
    label: "The Same Request, Again",
    narrative: `HOST-A asks the exact same question: "Who has ${HOST_B_IP}?"`,
    packet: () => arpRequestPacket("HOST-A", "LEAF1", HOST_B_IP),
    run: (state) => ({ state: { ...state, packetAt: "LEAF1" }, events: [{ type: "ARP_REQUEST_SENT", stepId: "suppressed-arp-request", timestamp: Date.now(), message: "HOST-A broadcasts the same ARP request again" }] }),
  },
  {
    id: "enter-leaf1-suppression-pipeline",
    label: "LEAF1 — Conceptual ARP Suppression Pipeline",
    narrative: "Access ingress, ARP request recognized, target IP extracted, EVPN MAC/IP database consulted — binding found. Branch: YES → build a local proxy reply. (NO would fall back to normal BUM handling — see the unknown-target case shortly.)",
    run: (state) => {
      const binding = lookupMacIpBinding(state.macIpBindings.LEAF1, HOST_B_IP);
      const canSuppress = canSuppressNeighborDiscovery(binding);
      return { state, events: [{ type: "ROUTE_LOOKUP", stepId: "enter-leaf1-suppression-pipeline", timestamp: Date.now(), message: canSuppress ? "Binding found — suppressing" : "No valid binding — falling back to BUM" }] };
    },
  },
  {
    id: "proxy-reply-built",
    label: "Proxy ARP Reply",
    narrative: `LEAF1 builds the reply itself: "${HOST_B_IP} is at ${HOST_B_MAC}." Click either packet — the original request and the proxy reply are both fully inspectable.`,
    packet: (state) => {
      const binding = lookupMacIpBinding(state.macIpBindings.LEAF1, HOST_B_IP);
      return binding ? buildProxyArpReply(binding, "LEAF1", "HOST-A") : undefined;
    },
    run: (state) => ({
      state: { ...state, arpCacheHostA: [{ ip: HOST_B_IP, mac: HOST_B_MAC }], journey: [...state.journey, { device: "LEAF1", input: "ARP request", lookup: `EVPN MAC/IP database: ${HOST_B_IP} → ${HOST_B_MAC} (remote, LEAF3)`, action: "SUPPRESSED_REPLY", output: "Local proxy ARP reply — zero remote VXLAN copies" }] },
      events: [{ type: "ARP_ENTRY_CREATED", stepId: "proxy-reply-built", timestamp: Date.now(), message: "HOST-A's ARP cache updated from LEAF1's local proxy reply" }],
    }),
  },
  {
    id: "accuracy-note",
    label: "LEAF1 Is Not Pretending To Be HOST-B",
    narrative: "LEAF1 answered from EVPN control-plane knowledge — it never claimed HOST-B physically lives on LEAF1. The actual data traffic that follows still goes HOST-A → LEAF1 → VXLAN → LEAF3 → HOST-B. Suppression only avoided the unnecessary discovery flood, nothing about the real data path changed.",
  },
  {
    id: "before-after-comparison",
    label: "Before / After — The Signature Comparison",
    narrative: "WITHOUT suppression: ARP → LEAF1 → floods to LEAF2 and LEAF3 (2 remote copies). WITH suppression: ARP → LEAF1 → EVPN DB → local reply (0 remote copies). Same question, same answer, radically different fabric cost.",
  },
  {
    id: "control-discovery-data-recap",
    label: "Control → Discovery → Data",
    narrative: "CONTROL: LEAF3 advertises Type 2 → LEAF1 learns the binding. DISCOVERY: HOST-A's ARP is suppressed locally, using that binding. DATA: the eventual HOST-A → HOST-B traffic still VXLAN-unicasts to LEAF3. Each phase enables the next — EVPN control plane enables local discovery optimization, which then enables ordinary unicast forwarding.",
  },
  {
    id: "unknown-binding-case",
    label: "An Unknown Target",
    narrative: `Now HOST-A asks about ${UNKNOWN_TARGET_IP} — an address LEAF1 has no EVPN MAC/IP binding for at all.`,
  },
  {
    id: "predict-unknown-binding",
    label: "Predict",
    narrative: "LEAF1 has no valid binding for this address.",
    question: {
      prompt: "Can LEAF1 safely invent a proxy response anyway?",
      options: [
        { id: "yes", label: "Yes — any plausible-looking reply is fine" },
        { id: "no", label: "No — without a valid binding, it must not fabricate a reply" },
      ],
      correctOptionId: "no",
      explanation: "Suppression only ever answers from real, current EVPN-learned information. With no valid binding, LEAF1 falls back to normal discovery/BUM behavior — exactly like the un-suppressed case earlier. Suppression is never a license to guess.",
    },
  },
  {
    id: "unknown-binding-fallback",
    label: "Binding Absent → Normal BUM",
    narrative: "No proxy reply is generated. The request falls back to ordinary flood-and-learn discovery, precisely as it would if suppression didn't exist at all for this address.",
  },
  {
    id: "stale-binding-warning",
    label: "What If The Binding Were Stale?",
    narrative: "If LEAF1 kept an outdated binding — say, after HOST-B physically moved — a locally-generated proxy reply could point HOST-A at the WRONG remote VTEP. Suppression is only as good as the binding backing it; a stale binding makes proxy behavior actively wrong, not just unhelpful.",
  },
  {
    id: "mobility-tie-in",
    label: "MAC Mobility, Tied In",
    narrative: `BEFORE MOVE: ${HOST_B_IP} → ${HOST_B_MAC} → LEAF3. HOST-B moves (the previous lesson's own mechanism — not re-simulated here). AFTER MOVE: ${HOST_B_IP} → ${HOST_B_MAC} → LEAF2. As long as EVPN updates the binding correctly, ARP suppression remains completely valid — it simply now points at the new, correct VTEP.`,
    run: (state) => {
      const macIpBindings = { ...state.macIpBindings, LEAF1: state.macIpBindings.LEAF1.map((b) => (b.ip === HOST_B_IP ? { ...b, vtep: VTEP_LOOPBACK.LEAF2 } : b)) };
      return { state: { ...state, hostBLocation: "LEAF2", macIpBindings }, events: [{ type: "MAC_LEARNED", stepId: "mobility-tie-in", timestamp: Date.now(), message: "HOST-B's binding updated: LEAF3 → LEAF2" }] };
    },
    whatChanged: () => [`LEAF1 binding: ${HOST_B_IP} → LEAF3 → LEAF2`],
  },
  {
    id: "nd-intro",
    label: "IPv6: Neighbor Discovery",
    narrative: "IPv4 uses ARP Request/Reply. IPv6 never uses ARP at all — its analog is Neighbor Solicitation / Neighbor Advertisement (ND). The same EVPN MAC/IP information suppresses ND requests the same conceptual way: a local proxy Neighbor Advertisement instead of a fabric-wide flood.",
  },
  {
    id: "arp-vs-nd-comparison",
    label: "ARP vs. ND, Side By Side",
    narrative: `IPv4 — ARP: "Who has ${HOST_B_IP}?" IPv6 — Neighbor Solicitation: "Who owns 2001:db8:10::22?" Different protocols, same underlying idea, same EVPN-driven suppression mechanism.`,
  },
  {
    id: "predict-type2-dependency",
    label: "Predict",
    narrative: "Before connecting this back to earlier lessons:",
    question: {
      prompt: "Which EVPN information actually enables ARP suppression for HOST-B?",
      options: [
        { id: "type3", label: "Type 3 only" },
        { id: "type5", label: "Type 5 only" },
        { id: "type2", label: "Type 2 MAC/IP binding" },
        { id: "vxlan-header", label: "The VXLAN header" },
      ],
      correctOptionId: "type2",
      explanation: "Type 2 is what actually carries the MAC/IP binding suppression is built on. Type 3 still matters — but only for handling BUM traffic suppression can't answer, never as the suppression mechanism itself.",
    },
  },
  {
    id: "type2-type3-relationship",
    label: "Type 2 and Type 3, Connected",
    narrative: '"I know the endpoint" (Type 2) → suppress discovery. "I know the VNI participants" (Type 3) → handle BUM when suppression can\'t answer. Both routes, working together — never the same mechanism.',
  },
  {
    id: "break-intro",
    label: "Break The Fabric",
    narrative: "Everything has worked cleanly so far. Time for one controlled, educational fault: HOST-B's Type 2 route still exists and is still imported — but its IP information is missing from the binding LEAF1 actually uses for suppression.",
  },
  {
    id: "fault-injected",
    label: "IP Information Missing From The Binding",
    narrative: "Physical, underlay, BGP EVPN, the MAC route, and the remote MAC entry are all still healthy — HOST-B's MAC is still known. Its IP information specifically has dropped out of the binding LEAF1 uses for suppression.",
    run: (state) => {
      const macIpBindings = { ...state.macIpBindings, LEAF1: state.macIpBindings.LEAF1.map((b) => (b.ip === HOST_B_IP ? { ...b, hasIpInfo: false } : b)) };
      return { state: { ...state, macIpBindings, faultActive: true }, events: [{ type: "MAC_LEARNED", stepId: "fault-injected", timestamp: Date.now(), message: "HOST-B's MAC/IP binding is missing its IP information" }] };
    },
    whatChanged: () => [`LEAF1 binding for ${HOST_B_IP}: IP information missing — MAC route itself unaffected`],
  },
  {
    id: "trouble-intro",
    label: "Troubleshoot",
    narrative: "Complaint: \"HOST-A can still eventually reach HOST-B — but every single ARP request is crossing the whole fabric again.\" Physical, underlay, BGP EVPN, the MAC route, and remote MAC are all healthy. Inspect LEAF1's actual MAC/IP binding.",
  },
  {
    id: "trouble-question",
    label: "Troubleshoot",
    narrative: "Every layer up through the MAC route itself is healthy.",
    question: {
      prompt: "Where does ARP suppression actually break?",
      options: [
        { id: "bgp-evpn", label: "The BGP EVPN session itself" },
        { id: "mac-route", label: "The Type 2 MAC route" },
        { id: "ip-info", label: "The IP information in the MAC/IP binding used for suppression" },
        { id: "vxlan", label: "VXLAN unicast forwarding" },
      ],
      correctOptionId: "ip-info",
      explanation: "The MAC route is fine — HOST-B's MAC is still known and reachable. Suppression specifically needs a complete MAC/IP binding, and the IP portion is what's missing here, so LEAF1 correctly falls back to flooding rather than guessing.",
      hints: [
        "Hint 1: the underlying MAC route and remote MAC entry are both healthy — this isn't a reachability problem.",
        "Hint 2: HOST-A can still eventually reach HOST-B — final connectivity isn't broken.",
        "Hint 3: suppression needs a complete IP+MAC binding, not just a MAC route.",
      ],
    },
  },
  {
    id: "diagnostic-layers",
    label: "Layer By Layer",
    narrative: "This is intentionally different from earlier faults: an optimization can break while connectivity itself keeps working through legitimate fallback behavior. Suppression failing is not the same thing as the fabric failing.",
  },
  {
    id: "visualize-fault",
    label: "Fallback In Action",
    narrative: "Resend the ARP request: LEAF1's binding lookup misses (no valid IP information), so it correctly falls back to BUM replication — the exact same flooding mechanism from the very start of this lesson, working as designed.",
    packet: () => arpRequestPacket("HOST-A", "LEAF1", HOST_B_IP),
    run: (state) => {
      const binding = lookupMacIpBinding(state.macIpBindings.LEAF1, HOST_B_IP);
      const canSuppress = canSuppressNeighborDiscovery(binding);
      if (canSuppress) return { state: { ...state, packetAt: "LEAF1" }, events: [] };
      const replicas = fallbackToBum(["LEAF2", "LEAF3"]);
      return { state: { ...state, packetAt: "LEAF1", replicaStage: "leaf1-to-spine", replicas, lastReplicaCount: 2, lastVtepsTouched: 2, journey: [...state.journey, { device: "LEAF1", input: "ARP request", lookup: "Binding miss (no IP information) — falling back to BUM", action: "REPLICATE", output: "2 VXLAN copies created (fallback)" }] }, events: [{ type: "PACKET_DROPPED", stepId: "visualize-fault", timestamp: Date.now(), message: "Suppression lookup missed — falling back to BUM replication" }] };
    },
  },
  {
    id: "repair-challenge",
    label: "Apply The Fix",
    narrative: "Restore the missing Type-2 IP information — do not simply disable flooding. Flooding is legitimate fallback behavior; the fix is repairing the control-plane information that makes suppression possible again.",
    action: (state, payload) => {
      const choice = typeof payload === "object" && payload !== null && "choice" in payload ? String((payload as { choice: string }).choice) : "";
      if (choice !== "repair-binding") return { state: { ...state, repairAttempt: { choice, correct: false } }, events: [] };
      const macIpBindings = { ...state.macIpBindings, LEAF1: state.macIpBindings.LEAF1.map((b) => (b.ip === HOST_B_IP ? { ...b, hasIpInfo: true } : b)) };
      return { state: { ...state, macIpBindings, faultActive: false, replicaStage: "none", replicas: [], repairAttempt: { choice, correct: true }, challengeSucceeded: true }, events: [{ type: "MAC_LEARNED", stepId: "repair-challenge", timestamp: Date.now(), message: "HOST-B's MAC/IP binding IP information restored" }] };
    },
    requiresState: (state) => state.challengeSucceeded === true,
  },
  {
    id: "verify-dataplane",
    label: "Verify — Zero Remote Copies Again",
    narrative: "Resend the ARP request one more time to prove suppression actually works again — not just that the binding table looks right.",
    packet: () => arpRequestPacket("HOST-A", "LEAF1", HOST_B_IP),
    run: (state) => {
      const binding = lookupMacIpBinding(state.macIpBindings.LEAF1, HOST_B_IP);
      return { state: { ...state, packetAt: "LEAF1", replicaStage: "none", replicas: [], lastReplicaCount: 0, lastVtepsTouched: 0, arpCacheHostA: [{ ip: HOST_B_IP, mac: HOST_B_MAC }], journey: [...state.journey, { device: "LEAF1", input: "ARP request", lookup: `EVPN MAC/IP database: ${HOST_B_IP} → ${binding?.mac} (remote, ${state.hostBLocation})`, action: "SUPPRESSED_REPLY", output: "Local proxy ARP reply — zero remote VXLAN copies" }] }, events: [{ type: "ARP_ENTRY_CREATED", stepId: "verify-dataplane", timestamp: Date.now(), message: "Suppression restored — zero remote copies" }] };
    },
    whatChanged: () => ["✓ MAC/IP binding IP information restored", "✓ ARP suppression active again", "✓ Remote VXLAN copies: 2 → 0"],
  },
  {
    id: "concept-summary",
    label: "Concept Summary",
    narrative: "Type 2 provides MAC/IP knowledge. Type 3 provides BUM participation. ARP/ND Suppression uses endpoint knowledge to avoid unnecessary discovery flooding. VXLAN still carries the actual remote unicast data traffic — none of that changed.",
  },
  {
    id: "complete",
    label: "Lesson Complete",
    narrative: "The exact same ARP question now costs zero remote VXLAN copies instead of two — not because flooding was disabled, but because LEAF1 already had a real, current answer and used it.",
  },
];
