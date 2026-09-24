import type { PacketLayer, PacketVisual, ScenarioStep } from "../types";

/**
 * EVPN Single-Active Multihoming + EVPN-VPWS — the ninth lesson in
 * the EVPN track. Two clearly separated acts:
 *
 *   ACT 1 — Single-Active multihoming: CE-A is dual-homed to PE1/PE2,
 *   but unlike the All-Active Multihoming lesson, only ONE PE (the
 *   Primary) forwards traffic for this service at a time — the other
 *   (Backup) is healthy and ready, not merely idle-because-NDF.
 *
 *   ACT 2 — EVPN-VPWS: a point-to-point Ethernet service between
 *   CE-A and CE-B, signaled almost entirely through Ethernet A-D
 *   per-EVI routes (never ordinary Type-2 MAC learning), riding on
 *   top of the Single-Active redundancy built in Act 1.
 *
 * Reuses rather than reinvents: the Ethernet Segment/ESI model, A-D
 * per-EVI/per-ES route shapes, and the generic ElectionViewer /
 * RouteEvolutionViewer / NextHopSetViewer / BgpUpdateCard components
 * from the Multihoming and Aliasing/Mass-Withdrawal lessons. The
 * MPLS label-stack shape mirrors the one introduced in the MPLS/LDP
 * and L3VPN lessons (a generic `labels: MplsLabel[]` stack, never a
 * named-field "transportLabel"/"serviceLabel" pair) — LabelPurpose
 * here is "transport" | "service", never reusing "vpn" (an MPLS
 * L3VPN VPN label and a VPWS service label are deliberately kept
 * visually and conceptually distinct — brief §16).
 *
 * Explicitly DEFERRED: All-Active VPWS's full data plane, a second
 * full VXLAN-VPWS simulation, EVPN Type 5 / IRB / tenant VRFs, LDP
 * pseudowire signaling depth, complex multi-failure scenarios.
 *
 * Pure data + pure functions only — see /lib/sim-engine/types.ts.
 */

export type PeId = "PE1" | "PE2" | "PE3";
export type EvpnVpwsDeviceId = "CE-A" | PeId | "CORE" | "CE-B";
export const FABRIC_DEVICES: EvpnVpwsDeviceId[] = ["PE1", "CORE", "PE2", "PE3"];
export const CEA_PES: PeId[] = ["PE1", "PE2"];

export const ESI = "00:AA:00:AA:00:AA:00:AA:00:01";
export const VPWS_SERVICE_ID = 500;
export const LOCAL_AC_VLAN = 100; // CE-A side
export const REMOTE_AC_VLAN = 200; // CE-B side
export const CORRECT_L2_MTU = 9000;
export const FAULT_L2_MTU = 1500;

export const CE_A_MAC = "AA:BB:AA:BB:AA:01";
export const CE_B_MAC = "AA:BB:AA:BB:AA:02";
export const PE_LOOPBACK: Record<PeId, string> = { PE1: "10.255.1.1", PE2: "10.255.1.2", PE3: "10.255.1.3" };
const RD_BASE: Record<PeId, string> = { PE1: "10.255.1.1:500", PE2: "10.255.1.2:500", PE3: "10.255.1.3:500" };
const RT = "65000:500";

export const TERMS: { term: string; expansion: string; meaning: string }[] = [
  { term: "Single-Active", expansion: "One Primary, One Backup", meaning: "Only one attached PE forwards traffic for this service at a time. The other is healthy and standing by — not merely idle." },
  { term: "VPWS", expansion: "Virtual Private Wire Service", meaning: "A point-to-point Ethernet service between two endpoints — not a multipoint bridged domain." },
  { term: "A-D per-EVI", expansion: "Route Type 1, Per-Service Form", meaning: "The central signaling route for VPWS: service ID, remote endpoint discovery, and the service label all ride on it." },
  { term: "Service Label", expansion: "VPWS Context, Not a VRF", meaning: "Identifies the VPWS service endpoint/context at the disposition PE — never an MPLS L3VPN VPN label." },
  { term: "P / B Flags", expansion: "Primary / Backup Indicators", meaning: "Control-plane attributes carried on the A-D per-EVI route — never bits inside the customer's own packet." },
];

// ---------------------------------------------------------------------------
// Single-Active election
// ---------------------------------------------------------------------------

export type PbRole = "not-elected" | "primary" | "backup" | "ineligible";

export interface PbCandidate {
  pe: PeId;
  electionValue: string; // this lesson's basic/default algorithm: the candidate's own loopback
  available: boolean;
}

export interface SingleActiveElection {
  esi: string;
  algorithm: string;
  candidates: PbCandidate[];
  primaryPe?: PeId;
  backupPe?: PeId;
  reason: string;
  previousPrimary?: PeId;
}

function candidateSet(pe1Failed: boolean): PbCandidate[] {
  return CEA_PES.filter((p) => !(pe1Failed && p === "PE1")).map((p) => ({ pe: p, electionValue: PE_LOOPBACK[p], available: true }));
}

/** Standards-valid but deliberately BASIC default election: lowest candidate loopback wins Primary. Real deployments may weight preference/priority — never call this the universal algorithm. */
export function electSingleActivePrimary(candidates: PbCandidate[], _previousPrimary: PeId | undefined): { primaryPe?: PeId; backupPe?: PeId; reason: string } {
  const available = candidates.filter((c) => c.available);
  if (available.length === 0) return { reason: "No candidates available for this Ethernet Segment." };
  const sorted = [...available].sort((a, b) => a.electionValue.localeCompare(b.electionValue));
  const primaryPe = sorted[0].pe;
  const backupPe = sorted[1]?.pe;
  return {
    primaryPe,
    backupPe,
    reason: `${primaryPe} has the lowest candidate loopback (${sorted[0].electionValue}) among {${available.map((c) => c.pe).join(", ")}} — basic/default ordinal election.${backupPe ? ` ${backupPe} becomes Backup.` : " No surviving Backup candidate."}`,
  };
}

export function pbRoleFor(election: SingleActiveElection, pe: PeId): PbRole {
  if (!election.candidates.some((c) => c.pe === pe)) return "ineligible";
  if (!election.primaryPe) return "not-elected";
  if (election.primaryPe === pe) return "primary";
  if (election.backupPe === pe) return "backup";
  return "ineligible";
}

// ---------------------------------------------------------------------------
// Route + service models
// ---------------------------------------------------------------------------

export interface VpwsAdRoute {
  originPe: PeId;
  esi: string; // "" for PE3 — not multihomed in this lesson
  vpwsServiceId: number;
  serviceLabel: number;
  role: PbRole | "remote";
  l2Mtu: number;
  rd: string;
  rt: string;
  withdrawn: boolean;
}

export function buildVpwsAdRoute(originPe: PeId, esi: string, role: PbRole | "remote", l2Mtu: number, serviceLabel: number): VpwsAdRoute {
  return { originPe, esi, vpwsServiceId: VPWS_SERVICE_ID, serviceLabel, role, l2Mtu, rd: RD_BASE[originPe], rt: RT, withdrawn: false };
}

export function withdrawVpwsAdRoute(routes: Partial<Record<PeId, VpwsAdRoute>>, pe: PeId): Partial<Record<PeId, VpwsAdRoute>> {
  const route = routes[pe];
  if (!route) return routes;
  return { ...routes, [pe]: { ...route, withdrawn: true } };
}

/** For PE3: which CE-A-side PE is the current usable Primary? For PE1/PE2: the remote endpoint is always PE3. */
export function discoverVpwsEndpoint(routes: Partial<Record<PeId, VpwsAdRoute>>, forPe: PeId): PeId | undefined {
  if (forPe === "PE3") {
    const primary = CEA_PES.find((p) => routes[p] && !routes[p]!.withdrawn && routes[p]!.role === "primary");
    return primary;
  }
  return routes.PE3 && !routes.PE3.withdrawn ? "PE3" : undefined;
}

/**
 * EVPN-VPWS service labels are downstream-assigned: the sending PE pushes the label the
 * DISPOSITION PE advertised in its A-D per-EVI route, never its own. Pure — resolves only
 * from stored routes; undefined when no usable remote endpoint exists (no fallback label).
 */
export function remoteServiceLabelFor(routes: Partial<Record<PeId, VpwsAdRoute>>, ingressPe: PeId): number | undefined {
  const remote = discoverVpwsEndpoint(routes, ingressPe);
  const route = remote ? routes[remote] : undefined;
  return route && !route.withdrawn ? route.serviceLabel : undefined;
}

export interface VpwsParameterCheck {
  compatible: boolean;
  reason: string;
}

export function validateVpwsParameters(localMtu: number, remoteMtu: number): VpwsParameterCheck {
  if (localMtu !== remoteMtu) {
    return { compatible: false, reason: `L2 MTU mismatch — local expects ${localMtu}, remote advertised ${remoteMtu}. The remote endpoint cannot become usable until this matches.` };
  }
  return { compatible: true, reason: `L2 MTU compatible (${localMtu}) — remote endpoint usable.` };
}

export interface VpwsServiceState {
  serviceId: number;
  localAcVlan: number;
  remoteAcVlan: number;
  pe3ExpectedMtu: number;
  status: "down" | "up";
  reason: string;
}

export function installVpwsService(routes: Partial<Record<PeId, VpwsAdRoute>>, pe3ExpectedMtu: number): VpwsServiceState {
  const primaryPe = CEA_PES.find((p) => routes[p] && !routes[p]!.withdrawn && routes[p]!.role === "primary");
  const primaryRoute = primaryPe ? routes[primaryPe] : undefined;
  const remoteRoute = routes.PE3;
  if (!primaryRoute || !remoteRoute || remoteRoute.withdrawn) {
    return { serviceId: VPWS_SERVICE_ID, localAcVlan: LOCAL_AC_VLAN, remoteAcVlan: REMOTE_AC_VLAN, pe3ExpectedMtu, status: "down", reason: "No usable Primary/remote-endpoint pair yet." };
  }
  const check = validateVpwsParameters(pe3ExpectedMtu, primaryRoute.l2Mtu);
  return { serviceId: VPWS_SERVICE_ID, localAcVlan: LOCAL_AC_VLAN, remoteAcVlan: REMOTE_AC_VLAN, pe3ExpectedMtu, status: check.compatible ? "up" : "down", reason: check.reason };
}

// ---------------------------------------------------------------------------
// MPLS label-stack model — the SAME generic shape used in the MPLS/LDP
// and L3VPN lessons: a stack of {value,tc,bottomOfStack,ttl,purpose},
// never single named fields. "service" here is a VPWS service label —
// deliberately never called "vpn" (see file header, brief §16).
// ---------------------------------------------------------------------------

export type LabelPurpose = "transport" | "service";
export interface MplsLabel {
  value: number;
  tc: number;
  bottomOfStack: boolean;
  ttl: number;
  purpose: LabelPurpose;
}
export interface EthernetFrame {
  srcMac: string;
  dstMac: string;
}
export interface VpwsPacketState {
  frame: EthernetFrame;
  labels: MplsLabel[]; // index 0 = top/outermost
}

function pushLabel(pkt: VpwsPacketState, value: number, purpose: LabelPurpose): VpwsPacketState {
  const wasEmpty = pkt.labels.length === 0;
  // Only the first-pushed (innermost) label is Bottom-of-Stack; labels beneath the new top keep their S bit.
  const newTop: MplsLabel = { value, tc: 0, ttl: 255, bottomOfStack: wasEmpty, purpose };
  return { ...pkt, labels: [newTop, ...pkt.labels] };
}
function popTopLabel(pkt: VpwsPacketState): VpwsPacketState {
  const [, ...rest] = pkt.labels;
  return { ...pkt, labels: rest.map((l, i) => (i === 0 ? { ...l, bottomOfStack: true } : l)) };
}

export const TRANSPORT_LABEL = 16003;
/** Each PE's OWN locally-allocated VPWS service label — what it advertises for others to push toward it (allocation only, never a forwarding choice). */
export const LOCAL_SERVICE_LABEL: Record<PeId, number> = { PE1: 24500, PE2: 24501, PE3: 24502 };

/** `serviceLabel` must be the disposition PE's advertised label (see remoteServiceLabelFor). */
export function buildVpwsLabelStack(frame: EthernetFrame, serviceLabel: number): VpwsPacketState {
  let pkt: VpwsPacketState = { frame, labels: [] };
  pkt = pushLabel(pkt, serviceLabel, "service");
  pkt = pushLabel(pkt, TRANSPORT_LABEL, "transport");
  return pkt;
}
/** Encapsulate only when a real downstream label exists — never invents one. */
function labeledCustomerFrame(frame: EthernetFrame, serviceLabel: number | undefined): VpwsPacketState {
  return serviceLabel === undefined ? { frame, labels: [] } : buildVpwsLabelStack(frame, serviceLabel);
}
/** Stack text for a disposition hop — the transport label over the given downstream service label. */
function labeledStackText(serviceLabel: number | undefined): string {
  return vpwsStackText(labeledCustomerFrame({ srcMac: "", dstMac: "" }, serviceLabel));
}
/** Journey text rendered from an actual label stack, e.g. "[16003][24502][Ethernet]". */
function vpwsStackText(pkt: VpwsPacketState): string {
  return pkt.labels.length > 0 ? `${pkt.labels.map((l) => `[${l.value}]`).join("")}[Ethernet]` : "[Ethernet] (not encapsulated — no usable remote endpoint)";
}
export function popTransportLabel(pkt: VpwsPacketState): VpwsPacketState {
  return popTopLabel(pkt);
}
export function popServiceLabel(pkt: VpwsPacketState): VpwsPacketState {
  return popTopLabel(pkt);
}

function ethLayer(frame: EthernetFrame): PacketLayer {
  return { name: "Ethernet (Customer Frame)", color: "var(--pv-proto-ethernet)", fields: [{ label: "Source MAC", value: frame.srcMac }, { label: "Destination MAC", value: frame.dstMac }] };
}
function shimLayer(label: MplsLabel): PacketLayer {
  return {
    name: `MPLS Shim (${label.purpose})`,
    color: label.purpose === "service" ? "var(--pv-proto-udp)" : "var(--pv-proto-mpls)",
    fields: [
      { label: "Label", value: String(label.value) },
      { label: "TC (Traffic Class)", value: String(label.tc) },
      { label: "S (Bottom of Stack)", value: label.bottomOfStack ? "1" : "0" },
      { label: "TTL", value: String(label.ttl) },
    ],
  };
}
export function buildPacketLayers(pkt: VpwsPacketState): PacketLayer[] {
  return [...pkt.labels.map(shimLayer), ethLayer(pkt.frame)];
}
export function transportLayerIndex(pkt: VpwsPacketState | undefined): number[] {
  if (!pkt) return [];
  const i = pkt.labels.findIndex((l) => l.purpose === "transport");
  return i >= 0 ? [i] : [];
}
export function serviceLayerIndex(pkt: VpwsPacketState | undefined): number[] {
  if (!pkt) return [];
  const i = pkt.labels.findIndex((l) => l.purpose === "service");
  return i >= 0 ? [i] : [];
}
function vpwsPacket(id: string, from: EvpnVpwsDeviceId, to: EvpnVpwsDeviceId, summary: string, badge: string, pkt: VpwsPacketState): PacketVisual {
  return { id, protocol: "MPLS", from, to, summary, badge, layers: buildPacketLayers(pkt) };
}
function bgpAdPacket(id: string, from: EvpnVpwsDeviceId, to: EvpnVpwsDeviceId, summary: string, badge: string, route: VpwsAdRoute, action: "announce" | "withdraw"): PacketVisual {
  return {
    id,
    protocol: "BGP",
    from,
    to,
    summary,
    badge,
    layers: [{ name: "BGP UPDATE (EVPN)", color: "var(--pv-proto-bgp)", fields: [
      { label: "AFI/SAFI", value: "L2VPN EVPN" },
      { label: "Route Type", value: "1 (Ethernet Auto-Discovery — per EVI)" },
      { label: "Ethernet Tag ID (VPWS Service ID)", value: String(route.vpwsServiceId) },
      { label: "ESI", value: route.esi || "0 (not multihomed)" },
      { label: "Service Label", value: String(route.serviceLabel) },
      { label: "RD", value: route.rd },
      { label: "Route Target", value: route.rt },
      { label: "Action", value: action === "withdraw" ? "WITHDRAW" : "ANNOUNCE" },
    ] }],
  };
}
export { vpwsPacket, bgpAdPacket };

// ---------------------------------------------------------------------------
// Attachment circuit / failover
// ---------------------------------------------------------------------------

export function failAttachmentCircuit(routes: Partial<Record<PeId, VpwsAdRoute>>, pe: PeId): Partial<Record<PeId, VpwsAdRoute>> {
  return withdrawVpwsAdRoute(routes, pe);
}

export function selectVpwsPrimary(election: SingleActiveElection, pe1Failed: boolean): SingleActiveElection {
  const candidates = candidateSet(pe1Failed);
  const { primaryPe, backupPe, reason } = electSingleActivePrimary(candidates, election.primaryPe);
  return { ...election, candidates, primaryPe, backupPe, reason, previousPrimary: election.primaryPe };
}

export function failoverVpwsService(state: { election: SingleActiveElection; perEviAdRoutes: Partial<Record<PeId, VpwsAdRoute>>; pe1AcFailed: boolean }): { election: SingleActiveElection; perEviAdRoutes: Partial<Record<PeId, VpwsAdRoute>> } {
  const withdrawn = withdrawVpwsAdRoute(state.perEviAdRoutes, "PE1");
  const election = selectVpwsPrimary(state.election, true);
  const newPrimary = election.primaryPe;
  const routes = { ...withdrawn };
  (CEA_PES as PeId[]).forEach((p) => {
    const r = routes[p];
    if (!r || r.withdrawn) return;
    routes[p] = { ...r, role: p === newPrimary ? "primary" : p === election.backupPe ? "backup" : "ineligible" };
  });
  return { election, perEviAdRoutes: routes };
}

// ---------------------------------------------------------------------------
// Scenario state
// ---------------------------------------------------------------------------

export type JourneyAction = "AC_INGRESS" | "SERVICE_LOOKUP" | "PUSH_LABELS" | "TRANSPORT_FORWARD" | "POP_TRANSPORT" | "POP_SERVICE" | "AC_EGRESS" | "AC_UNAVAILABLE";
export interface JourneyHop {
  device: EvpnVpwsDeviceId;
  input: string;
  lookup: string;
  action: JourneyAction;
  output: string;
}

export interface EvpnVpwsState {
  bgpSessionUp: boolean;
  election: SingleActiveElection;
  perEviAdRoutes: Partial<Record<PeId, VpwsAdRoute>>;
  vpwsService?: VpwsServiceState;

  pe1AcFailed: boolean;
  packetAt?: EvpnVpwsDeviceId;
  packet?: VpwsPacketState;
  journey: JourneyHop[];
  direction: "ce-a-to-ce-b" | "ce-b-to-ce-a";

  mtuFault: boolean;
  repairAttempt?: { choice: string; correct: boolean };
  challengeSucceeded?: boolean;
  challengeStage: "not-started" | "mtu-repaired" | "frame-sent" | "failover-verified" | "done";
}

export function createEvpnVpwsState(): EvpnVpwsState {
  const election: SingleActiveElection = { esi: ESI, algorithm: "Basic/default for this lesson (ordinal — lowest candidate loopback wins)", candidates: candidateSet(false), reason: "Not yet elected" };
  return {
    bgpSessionUp: true,
    election,
    perEviAdRoutes: {},
    pe1AcFailed: false,
    journey: [],
    direction: "ce-a-to-ce-b",
    mtuFault: false,
    challengeStage: "not-started",
  };
}

// ---------------------------------------------------------------------------
// Graph layout
// ---------------------------------------------------------------------------

interface GNode { id: string; label: string; x: number; y: number; subLabel?: string; kind?: "server" | "switch" | "cloud"; }
interface GEdge { id: string; a: string; b: string; label?: string; }

export const GRAPH_NODES: GNode[] = [
  { id: "CE-A", label: "CE-A", x: 12, y: 60, subLabel: "Dual-Homed", kind: "server" },
  { id: "PE1", label: "PE1", x: 32, y: 40, subLabel: "PRIMARY", kind: "switch" },
  { id: "PE2", label: "PE2", x: 32, y: 80, subLabel: "BACKUP", kind: "switch" },
  { id: "CORE", label: "CORE", x: 55, y: 60, subLabel: "MPLS/IP Provider Core", kind: "switch" },
  { id: "PE3", label: "PE3", x: 78, y: 60, subLabel: "Remote Endpoint", kind: "switch" },
  { id: "CE-B", label: "CE-B", x: 95, y: 60, subLabel: "Single-Homed", kind: "server" },
];
export const GRAPH_EDGES: GEdge[] = [
  { id: "CE-A-PE1", a: "CE-A", b: "PE1", label: `ESI ${ESI.slice(-8)}` },
  { id: "CE-A-PE2", a: "CE-A", b: "PE2", label: `ESI ${ESI.slice(-8)}` },
  { id: "PE1-CORE", a: "PE1", b: "CORE", label: "MPLS Core" },
  { id: "PE2-CORE", a: "PE2", b: "CORE", label: "MPLS Core" },
  { id: "CORE-PE3", a: "CORE", b: "PE3", label: "MPLS Core" },
  { id: "PE3-CE-B", a: "PE3", b: "CE-B" },
];
export const GRAPH_REGIONS = [
  { id: "provider-core", label: "MPLS/IP Provider Core", x: 24, y: 20, width: 62, height: 60, tone: "cyan" as const },
  { id: "ethernet-segment", label: `Ethernet Segment ${ESI.slice(-8)}`, x: 4, y: 30, width: 40, height: 60, tone: "violet" as const },
];

export function withEvpnMesh(nodes: GNode[], edges: GEdge[], active: boolean): { nodes: GNode[]; edges: GEdge[] } {
  if (!active) return { nodes, edges };
  return { nodes, edges: [...edges, { id: "PE1-PE3-evpn", a: "PE1", b: "PE3", label: "BGP EVPN" }, { id: "PE2-PE3-evpn", a: "PE2", b: "PE3", label: "BGP EVPN" }] };
}

/** Logical VPWS view (brief §20) — the provider network fades away; CE-A's AC and CE-B's AC are joined directly by the service, drawn as a virtual Ethernet wire. */
export const LOGICAL_GRAPH_NODES: GNode[] = [
  { id: "CE-A", label: "CE-A AC", x: 15, y: 50, subLabel: `VLAN ${LOCAL_AC_VLAN}`, kind: "server" },
  { id: "VPWS-500", label: `VPWS-${VPWS_SERVICE_ID}`, x: 50, y: 50, kind: "cloud" },
  { id: "CE-B", label: "CE-B AC", x: 85, y: 50, subLabel: `VLAN ${REMOTE_AC_VLAN}`, kind: "server" },
];
export const LOGICAL_GRAPH_EDGES: GEdge[] = [
  { id: "cea-vpws", a: "CE-A", b: "VPWS-500", label: "point-to-point" },
  { id: "vpws-ceb", a: "VPWS-500", b: "CE-B", label: "point-to-point" },
];

// ---------------------------------------------------------------------------
// Scenario steps
// ---------------------------------------------------------------------------

export const evpnVpwsSteps: ScenarioStep<EvpnVpwsState>[] = [
  // ---------------------------- ACT 1 ----------------------------
  {
    id: "act1-intro",
    label: "ACT 1 — Single-Active Multihoming",
    narrative: "Recall All-Active from the Multihoming lesson: SERVER-A ├── LEAF1, └── LEAF2 — multiple eligible PEs could forward ordinary traffic at once. Now meet a different redundancy mode.",
  },
  {
    id: "single-active-intro",
    label: "Single-Active",
    narrative: "CE-A ├── PE1 — PRIMARY, └── PE2 — BACKUP. Only one PE forwards traffic to/from the multihomed attachment for this service context — not multiple eligible paths at once.",
  },
  {
    id: "predict-backup-down",
    label: "Predict",
    narrative: "PE2 is the Backup for this service.",
    question: {
      prompt: "Is the backup link physically down?",
      options: [
        { id: "yes-down", label: "Yes — a backup link is inherently non-operational until needed" },
        { id: "no-not-down", label: "No — the backup may be fully operational but simply isn't the active forwarding PE for this service" },
      ],
      correctOptionId: "no-not-down",
      explanation: "Single-Active is a control-plane role, not a physical link state. PE2 can be completely healthy while simply not being the currently-active forwarding PE for this service context.",
    },
  },
  {
    id: "topology-intro",
    label: "The Topology",
    narrative: `CE-A is dual-homed to PE1 and PE2 (ESI ${ESI.slice(-8)}). CE-B remains single-homed to PE3 for this introductory lesson. PE1/PE2 connect through a shared MPLS/IP provider core to PE3.`,
    run: (state) => ({ state: { ...state, bgpSessionUp: true }, events: [{ type: "BGP_STATE_CHANGED", stepId: "topology-intro", timestamp: Date.now(), message: "PE1 ↔ PE3, PE2 ↔ PE3 BGP EVPN sessions Established" }] }),
  },
  {
    id: "es-inspector",
    label: "Ethernet Segment Inspector",
    narrative: `Redundancy Mode: SINGLE-ACTIVE. Primary: (not yet elected). Backup: (not yet elected). ESI: ${ESI}. Service: VPWS-${VPWS_SERVICE_ID} (built in Act 2). States stay explicit: NOT ELECTED, PRIMARY, BACKUP, INELIGIBLE — never a blind reuse of DF/NDF here.`,
  },
  {
    id: "single-active-election",
    label: "Single-Active Election",
    narrative: `Candidates: PE1 (${PE_LOOPBACK.PE1}), PE2 (${PE_LOOPBACK.PE2}). Election algorithm: basic/default for this lesson — lowest candidate loopback wins Primary. Other algorithms (priority/preference-based) exist and are not the only universal mechanism.`,
    run: (state) => ({ state: { ...state, election: selectVpwsPrimary(state.election, false) }, events: [{ type: "ROUTE_SELECTED", stepId: "single-active-election", timestamp: Date.now(), message: "Single-Active election computed — PE1 Primary, PE2 Backup" }] }),
  },
  {
    id: "all-active-vs-single-active",
    label: "All-Active vs. Single-Active",
    narrative: "ALL-ACTIVE: multiple forwarding PEs, flow-based use of eligible paths. SINGLE-ACTIVE: one active forwarding PE, backup prepared to take over. Now use Single-Active redundancy to protect a point-to-point EVPN service.",
  },

  // ---------------------------- ACT 2 ----------------------------
  {
    id: "act2-intro",
    label: "ACT 2 — EVPN-VPWS",
    narrative: "CE-A and CE-B need a point-to-point Ethernet service — a logical Ethernet wire — over a physical path of CE-A → PE1/PE2 → MPLS/IP core → PE3 → CE-B.",
  },
  {
    id: "predict-vpws-mechanism",
    label: "Predict",
    narrative: "Ordinary EVPN bridging uses MAC learning and Type-2 routes for multipoint delivery.",
    question: {
      prompt: "How can EVPN signal a point-to-point Ethernet service without normal MAC-learning-based multipoint bridging?",
      options: [
        { id: "type2-only", label: "It still just relies on Type-2 MAC routes, with only two hosts" },
        { id: "vpws-adevi", label: "A dedicated point-to-point service model — EVPN-VPWS — built around Ethernet A-D per-EVI signaling" },
      ],
      correctOptionId: "vpws-adevi",
      explanation: "EVPN-VPWS is a distinct point-to-point service model. Ethernet A-D per-EVI routes — not Type-2 — carry service discovery and label signaling between the two endpoints.",
    },
  },
  {
    id: "vpws-mental-model",
    label: "The VPWS Mental Model",
    narrative: "Attachment Circuit → VPWS Service Instance → Ethernet A-D per-EVI → remote service endpoint discovered → service label / encapsulation information → point-to-point forwarding.",
  },
  {
    id: "vpws-service-instance",
    label: "Defining The Service Instance",
    narrative: `VPWS Service: VPWS-${VPWS_SERVICE_ID}. Local AC at CE-A: VLAN ${LOCAL_AC_VLAN}. Remote AC at CE-B: VLAN ${REMOTE_AC_VLAN}. Customer AC identity ≠ EVPN VPWS service identity — the two VLAN numbers are intentionally different, and do not need to match.`,
  },
  {
    id: "pe1-advertises-adevi",
    label: "PE1 Advertises Ethernet A-D Per-EVI",
    narrative: "PE1 advertises its A-D per-EVI route: VPWS Service ID 500, ESI (CE-A's Ethernet Segment), Service Label, Role: Primary.",
    packet: (state) => (state.perEviAdRoutes.PE1 ? bgpAdPacket("ad-pe1", "PE1", "PE3", "EVPN Type 1 — A-D per-EVI from PE1 (Primary)", "EVPN TYPE 1 · A-D PER-EVI", state.perEviAdRoutes.PE1, "announce") : undefined),
    run: (state) => {
      const role = pbRoleFor(state.election, "PE1");
      const route = buildVpwsAdRoute("PE1", ESI, role === "ineligible" || role === "not-elected" ? "primary" : role, CORRECT_L2_MTU, LOCAL_SERVICE_LABEL.PE1);
      return { state: { ...state, perEviAdRoutes: { ...state.perEviAdRoutes, PE1: route } }, events: [{ type: "MPBGP_VPN_ROUTE_ADVERTISED", stepId: "pe1-advertises-adevi", timestamp: Date.now(), message: "PE1 advertises A-D per-EVI for VPWS-500 (Primary)" }] };
    },
  },
  {
    id: "pe2-advertises-adevi",
    label: "PE2 Advertises Ethernet A-D Per-EVI",
    narrative: "PE2 advertises its corresponding route: Role: Backup.",
    packet: (state) => (state.perEviAdRoutes.PE2 ? bgpAdPacket("ad-pe2", "PE2", "PE3", "EVPN Type 1 — A-D per-EVI from PE2 (Backup)", "EVPN TYPE 1 · A-D PER-EVI", state.perEviAdRoutes.PE2, "announce") : undefined),
    run: (state) => {
      const role = pbRoleFor(state.election, "PE2");
      const route = buildVpwsAdRoute("PE2", ESI, role === "ineligible" || role === "not-elected" ? "backup" : role, CORRECT_L2_MTU, LOCAL_SERVICE_LABEL.PE2);
      return { state: { ...state, perEviAdRoutes: { ...state.perEviAdRoutes, PE2: route } }, events: [{ type: "MPBGP_VPN_ROUTE_ADVERTISED", stepId: "pe2-advertises-adevi", timestamp: Date.now(), message: "PE2 advertises A-D per-EVI for VPWS-500 (Backup)" }] };
    },
  },
  {
    id: "pe3-advertises-adevi",
    label: "PE3 Advertises Ethernet A-D Per-EVI",
    narrative: "PE3 advertises its own route: VPWS Service ID 500, Remote endpoint: CE-B, Service Label.",
    packet: (state) => (state.perEviAdRoutes.PE3 ? bgpAdPacket("ad-pe3", "PE3", "PE1", "EVPN Type 1 — A-D per-EVI from PE3 (remote endpoint)", "EVPN TYPE 1 · A-D PER-EVI", state.perEviAdRoutes.PE3, "announce") : undefined),
    run: (state) => {
      const route = buildVpwsAdRoute("PE3", "", "remote", CORRECT_L2_MTU, LOCAL_SERVICE_LABEL.PE3);
      const perEviAdRoutes = { ...state.perEviAdRoutes, PE3: route };
      return { state: { ...state, perEviAdRoutes, vpwsService: installVpwsService(perEviAdRoutes, CORRECT_L2_MTU) }, events: [{ type: "MPBGP_VPN_ROUTE_ADVERTISED", stepId: "pe3-advertises-adevi", timestamp: Date.now(), message: "PE3 advertises A-D per-EVI for VPWS-500 — remote endpoint CE-B" }] };
    },
    whatChanged: () => ["Both sides now hold each other's A-D per-EVI route", "VPWS-500 establishes purely from A-D per-EVI signaling — no Type-2 route was needed"],
  },
  {
    id: "vpws-route-discovery",
    label: "VPWS-500 ESTABLISHED",
    narrative: "PE1's Type-1 per-EVI and PE3's Type-1 per-EVI meet over EVPN BGP. Once each side has the required remote service information, VPWS-500 comes up. BGP EVPN performs service endpoint discovery AND forwarding-label signaling together.",
  },
  {
    id: "vpws-service-viewer",
    label: "VPWS Service Instance",
    narrative: `VPWS Service Instance: ID 500, Endpoint A: CE-A / PE1-PE2, Endpoint B: CE-B / PE3, Local AC: VLAN ${LOCAL_AC_VLAN}, Remote AC: VLAN ${REMOTE_AC_VLAN}, Redundancy: Single-Active, Primary: PE1, Backup: PE2, Status: UP.`,
  },
  {
    id: "primary-backup-signaling",
    label: "Primary / Backup Signaling",
    narrative: "PE1: P=1, B=0 → PRIMARY. PE2: P=0, B=1 → BACKUP. Beginner view shows Primary/Backup; [ADVANCED] shows the raw P/B flags, L2 MTU, and control-word indicator.",
  },
  {
    id: "not-all-active-note",
    label: "Accuracy Note",
    narrative: "This lesson is SINGLE-ACTIVE VPWS. Do not reuse the previous All-Active DF/BUM model as if VPWS behaved identically — the Single-Active Primary/Backup state is owned entirely by this new scenario.",
  },
  {
    id: "cea-sends-frame",
    label: "CE-A Sends A Customer Ethernet Frame",
    narrative: "An ordinary customer Ethernet frame, CE-A → CE-B.",
    packet: () => vpwsPacket("frame-in", "CE-A", "PE1", "Customer Ethernet frame — CE-A → CE-B", "FRAME", { frame: { srcMac: CE_A_MAC, dstMac: CE_B_MAC }, labels: [] }),
    run: (state) => ({ state: { ...state, direction: "ce-a-to-ce-b", packetAt: "PE1", journey: [...state.journey, { device: "CE-A", input: "Customer Ethernet frame", lookup: `AC for VPWS-${VPWS_SERVICE_ID}`, action: "AC_INGRESS", output: "Sent toward PE1 (Primary)" }] }, events: [{ type: "PACKET_SENT", stepId: "cea-sends-frame", timestamp: Date.now(), message: "CE-A sends a frame toward CE-B" }] }),
  },
  {
    id: "pe1-service-lookup",
    label: "PE1 — Service Lookup, Not MAC Lookup",
    narrative: "Access Circuit → Service lookup → VPWS-500 → remote endpoint = PE3 → remote service label → encapsulate. No destination-MAC lookup is required to select among multiple remote Ethernet sites — VPWS-500 has exactly one remote service endpoint. The frame still has ordinary MAC addresses; the provider forwarding decision is simply service/AC based, not multipoint MAC lookup.",
    run: (state) => ({ state: { ...state, journey: [...state.journey, { device: "PE1", input: "Customer Ethernet frame on AC", lookup: `Service lookup → VPWS-${VPWS_SERVICE_ID} → remote endpoint PE3`, action: "SERVICE_LOOKUP", output: "Remote service label resolved" }] }, events: [] }),
  },
  {
    id: "mpls-data-plane",
    label: "MPLS Data Plane — Two-Label Stack",
    narrative: `Packet leaving PE1: [TRANSPORT LABEL ${TRANSPORT_LABEL}] [VPWS SERVICE LABEL ${LOCAL_SERVICE_LABEL.PE3} — the label PE3 advertised, not PE1's own] [CUSTOMER ETHERNET FRAME].`,
    packet: (state) => vpwsPacket("frame-labeled", "PE1", "CORE", "MPLS-encapsulated — two-label stack", "MPLS", labeledCustomerFrame({ srcMac: CE_A_MAC, dstMac: CE_B_MAC }, remoteServiceLabelFor(state.perEviAdRoutes, "PE1"))),
    run: (state) => {
      const serviceLabel = remoteServiceLabelFor(state.perEviAdRoutes, "PE1");
      const packet = labeledCustomerFrame({ srcMac: CE_A_MAC, dstMac: CE_B_MAC }, serviceLabel);
      return {
        state: { ...state, packetAt: "CORE", packet, journey: [...state.journey, { device: "PE1", input: serviceLabel === undefined ? "No usable remote endpoint" : `Remote service label ${serviceLabel} resolved (advertised by PE3)`, lookup: "Push VPWS service label, then transport label", action: "PUSH_LABELS", output: vpwsStackText(packet) }] },
        events: [{ type: "PACKET_SENT", stepId: "mpls-data-plane", timestamp: Date.now(), message: "PE1 encapsulates with a two-label MPLS stack" }],
      };
    },
  },
  {
    id: "vpws-service-label-explain",
    label: "The VPWS Service Label",
    narrative: "Click the service label: it identifies the VPWS service endpoint/context at the disposition PE. This is never a VPN label for an MPLS L3VPN VRF — the two are kept visually and conceptually distinct.",
  },
  {
    id: "core-transport-only",
    label: "CORE — Transport Forwarding Only",
    narrative: "[Transport][VPWS Service][Ethernet]. X-Ray highlights only the top transport label. CORE performs swap/transport forwarding — it never inspects customer MACs or selects a VPWS AC.",
    run: (state) => ({ state: { ...state, packetAt: "PE3", journey: [...state.journey, { device: "CORE", input: `Top label ${TRANSPORT_LABEL}`, lookup: "Transport forwarding (swap) — service label untouched", action: "TRANSPORT_FORWARD", output: `Forwarded toward PE3` }] }, events: [] }),
  },
  {
    id: "pe3-disposition",
    label: "PE3 — Conceptual EVPN-VPWS Egress Pipeline",
    narrative: "MPLS ingress → transport processing → VPWS service label → identify VPWS-500 → identify CE-B AC → optional VLAN/tag translation → forward customer Ethernet frame → CE-B.",
    packet: () => vpwsPacket("frame-decap", "PE3", "CE-B", "Decapsulated — delivered to CE-B", "FRAME", { frame: { srcMac: CE_A_MAC, dstMac: CE_B_MAC }, labels: [] }),
    run: (state) => {
      // The arriving packet carries PE3's own downstream-assigned label (what PE1 pushed).
      const serviceLabel = state.packet?.labels.find((l) => l.purpose === "service")?.value ?? state.perEviAdRoutes.PE3?.serviceLabel;
      return {
        state: { ...state, packetAt: "CE-B", journey: [...state.journey, { device: "PE3", input: labeledStackText(serviceLabel), lookup: `Pop transport → read service label ${serviceLabel ?? "(none)"} → VPWS-${VPWS_SERVICE_ID} → CE-B AC (VLAN ${REMOTE_AC_VLAN})`, action: "POP_SERVICE", output: "Customer frame forwarded to CE-B" }] },
        events: [{ type: "PACKET_RECEIVED", stepId: "pe3-disposition", timestamp: Date.now(), message: "CE-B receives the customer frame" }],
      };
    },
  },
  {
    id: "full-journey-recap",
    label: "Full Packet Journey",
    narrative: "CE-A → PE1 (Primary) → [Transport][VPWS Service][Ethernet] → Provider Core → PE3 → CE-B.",
  },
  {
    id: "return-direction",
    label: "Return Direction",
    narrative: "CE-B → PE3 → selected remote PRIMARY = PE1 → provider core → PE1 → CE-A.",
    packet: () => vpwsPacket("frame-return", "CE-B", "PE3", "Customer Ethernet frame — CE-B → CE-A", "FRAME", { frame: { srcMac: CE_B_MAC, dstMac: CE_A_MAC }, labels: [] }),
    run: (state) => {
      // PE3 pushes the label its remote endpoint (current Primary PE1) advertised.
      const serviceLabel = remoteServiceLabelFor(state.perEviAdRoutes, "PE3");
      return {
        state: {
          ...state,
          direction: "ce-b-to-ce-a",
          packetAt: "CE-A",
          journey: [
            ...state.journey,
            { device: "PE3", input: "Customer Ethernet frame on AC", lookup: `Service lookup → VPWS-${VPWS_SERVICE_ID} → remote endpoint = current Primary (PE1)`, action: "SERVICE_LOOKUP", output: `Encapsulated toward PE1 with service label ${serviceLabel ?? "(none)"}` },
            { device: "CORE", input: `Top label ${TRANSPORT_LABEL}`, lookup: "Transport forwarding (swap)", action: "TRANSPORT_FORWARD", output: "Forwarded toward PE1" },
            { device: "PE1", input: labeledStackText(serviceLabel), lookup: `Pop transport → read service label ${serviceLabel ?? "(none)"} → VPWS-${VPWS_SERVICE_ID} → CE-A AC`, action: "POP_SERVICE", output: "Customer frame forwarded to CE-A" },
          ],
        },
        events: [{ type: "PACKET_RECEIVED", stepId: "return-direction", timestamp: Date.now(), message: "CE-A receives the return frame via PE1 (Primary)" }],
      };
    },
  },
  {
    id: "logical-vpws-view",
    label: "Logical View — A Virtual Ethernet Wire",
    narrative: "Switch to the logical view: the provider network fades away. CE-A AC ═══ VPWS-500 ═══ CE-B AC — a point-to-point virtual Ethernet wire.",
  },
  {
    id: "control-data-both-recap",
    label: "Control Signals The Wire, MPLS Carries It",
    narrative: "Control: Type-1 per-EVI + P/B signaling + service discovery + labels. Data: customer Ethernet → service lookup → MPLS → remote AC. Both: EVPN signaled the wire; MPLS carries the frame.",
  },
  {
    id: "compare-vpws-vs-bridging",
    label: "EVPN-VPWS vs. EVPN Bridging",
    narrative: "EVPN BRIDGING: multipoint service, MAC/IP routes matter, MAC lookup participates. EVPN-VPWS: point-to-point service, two service endpoints, Type-1 per-EVI is central, no ordinary multipoint MAC lookup required. Customer Ethernet frames still contain normal Ethernet headers in both.",
  },
  {
    id: "compare-traditional-pw",
    label: "Compared With Traditional Pseudowire",
    narrative: "Traditional VPWS/PW: service endpoint/label signaling commonly associated with LDP-based pseudowire mechanisms. EVPN-VPWS: BGP EVPN provides service discovery and service-label signaling instead. This comparison stays conceptual — this lesson does not build LDP PW signaling.",
  },
  {
    id: "failure-intro",
    label: "Now Fail PE1 ↔ CE-A's Attachment Circuit",
    narrative: "Fail only PE1's AC to CE-A. PE1 device, underlay, BGP EVPN, and VTEP/transport all stay UP. Only the CE-A AC goes DOWN — the Primary forwarding path becomes unavailable.",
    run: (state) => ({ state: { ...state, pe1AcFailed: true }, events: [{ type: "BGP_STATE_CHANGED", stepId: "failure-intro", timestamp: Date.now(), message: "PE1's AC to CE-A becomes unavailable (PE1 itself remains healthy)" }] }),
  },
  {
    id: "control-plane-response",
    label: "BGP WITHDRAW — Ethernet A-D Per-EVI",
    narrative: "The failed Primary withdraws its Ethernet A-D per-EVI route. This is visually and semantically a WITHDRAW, not merely a red advertisement. PE3 updates: Primary PE1 unavailable, Backup PE2 available.",
    packet: (state) => (state.perEviAdRoutes.PE1 ? bgpAdPacket("ad-pe1-withdraw", "PE1", "PE3", "EVPN Type 1 — A-D per-EVI WITHDRAW from PE1", "EVPN TYPE 1 · A-D PER-EVI · WITHDRAW", { ...state.perEviAdRoutes.PE1, withdrawn: true }, "withdraw") : undefined),
    run: (state) => ({ state: { ...state, perEviAdRoutes: withdrawVpwsAdRoute(state.perEviAdRoutes, "PE1") }, events: [{ type: "VPN_ROUTE_WITHDRAWN", stepId: "control-plane-response", timestamp: Date.now(), message: "PE1 withdraws its A-D per-EVI route for VPWS-500" }] }),
  },
  {
    id: "primary-backup-failover",
    label: "Primary / Backup Failover",
    narrative: "BEFORE: Primary = PE1, Backup = PE2. FAILURE: PE1 AC DOWN. AFTER: Primary = PE2. With only two PEs in this Ethernet Segment, there is no third candidate to become a newly elected Backup.",
    run: (state) => {
      const result = failoverVpwsService({ election: state.election, perEviAdRoutes: state.perEviAdRoutes, pe1AcFailed: true });
      const vpwsService = installVpwsService(result.perEviAdRoutes, state.vpwsService?.pe3ExpectedMtu ?? CORRECT_L2_MTU);
      return { state: { ...state, election: result.election, perEviAdRoutes: result.perEviAdRoutes, vpwsService }, events: [{ type: "ROUTE_SELECTED", stepId: "primary-backup-failover", timestamp: Date.now(), message: "PE2 becomes the new Primary for VPWS-500" }] };
    },
    whatChanged: (prev, next) => [`Primary for ESI ${ESI.slice(-8)}: ${prev.election.primaryPe} → ${next.election.primaryPe}`],
  },
  {
    id: "pb-route-transition",
    label: "P/B Route Transition",
    narrative: "These are VPWS control-plane roles, not packet-header bits.",
  },
  {
    id: "pe3-failover-pipeline",
    label: "PE3 — Conceptual VPWS Failover Pipeline",
    narrative: "A-D route withdrawal/update → identify VPWS-500 → primary endpoint state changes → backup PE becomes usable primary → service next hop updated → service label updated if required → forwarding state changed.",
  },
  {
    id: "data-path-failover",
    label: "Data-Path Failover",
    narrative: "BEFORE: CE-B → PE3 → PE1 → CE-A. AFTER: CE-B → PE3 → PE2 → CE-A.",
    packet: () => vpwsPacket("frame-after-failover", "CE-B", "PE3", "Customer Ethernet frame — CE-B → CE-A (after failover)", "FRAME", { frame: { srcMac: CE_B_MAC, dstMac: CE_A_MAC }, labels: [] }),
    run: (state) => {
      // PE1's route is withdrawn — PE3 now pushes the label the new Primary PE2 advertised.
      const serviceLabel = remoteServiceLabelFor(state.perEviAdRoutes, "PE3");
      return {
        state: {
          ...state,
          direction: "ce-b-to-ce-a",
          packetAt: "CE-A",
          journey: [
            ...state.journey,
            { device: "PE3", input: "Customer Ethernet frame on AC", lookup: `Service lookup → VPWS-${VPWS_SERVICE_ID} → remote endpoint = new Primary (PE2)`, action: "SERVICE_LOOKUP", output: `Encapsulated toward PE2 with service label ${serviceLabel ?? "(none)"}` },
            { device: "CORE", input: `Top label ${TRANSPORT_LABEL}`, lookup: "Transport forwarding (swap)", action: "TRANSPORT_FORWARD", output: "Forwarded toward PE2" },
            { device: "PE2", input: labeledStackText(serviceLabel), lookup: `Pop transport → read service label ${serviceLabel ?? "(none)"} → VPWS-${VPWS_SERVICE_ID} → CE-A AC`, action: "POP_SERVICE", output: "Customer frame forwarded to CE-A" },
          ],
        },
        events: [{ type: "PACKET_RECEIVED", stepId: "data-path-failover", timestamp: Date.now(), message: "CE-A receives the frame via the new Primary, PE2" }],
      };
    },
  },
  {
    id: "failure-distinction-note",
    label: "An Important Distinction",
    narrative: "PE1 did not necessarily fail completely — its CE-A attachment for VPWS-500 failed. BGP may still be established, provider-core reachability may still work, and other services on PE1 may still work.",
  },
  {
    id: "restore-pe1-ac",
    label: "PE1's Attachment Circuit Is Restored",
    narrative: "PE1's AC to CE-A comes back up and re-advertises its A-D per-EVI route. This lesson's deterministic election always prefers PE1 when both are healthy — Primary reverts to PE1, and PE2 returns to Backup.",
    run: (state) => {
      const election = selectVpwsPrimary(state.election, false);
      const restoredPe1: VpwsAdRoute = { ...(state.perEviAdRoutes.PE1 ?? buildVpwsAdRoute("PE1", ESI, "primary", CORRECT_L2_MTU, LOCAL_SERVICE_LABEL.PE1)), withdrawn: false };
      let routes: Partial<Record<PeId, VpwsAdRoute>> = { ...state.perEviAdRoutes, PE1: restoredPe1 };
      (CEA_PES as PeId[]).forEach((p) => {
        const r = routes[p];
        if (!r) return;
        routes = { ...routes, [p]: { ...r, role: p === election.primaryPe ? "primary" : p === election.backupPe ? "backup" : "ineligible" } };
      });
      const vpwsService = installVpwsService(routes, state.vpwsService?.pe3ExpectedMtu ?? CORRECT_L2_MTU);
      return { state: { ...state, pe1AcFailed: false, election, perEviAdRoutes: routes, vpwsService }, events: [{ type: "MPBGP_VPN_ROUTE_ADVERTISED", stepId: "restore-pe1-ac", timestamp: Date.now(), message: "PE1 re-advertises its A-D per-EVI route — Primary reverts to PE1" }] };
    },
    whatChanged: (prev, next) => [`Primary for ESI ${ESI.slice(-8)}: ${prev.election.primaryPe} → ${next.election.primaryPe}`],
  },
  {
    id: "mass-withdrawal-tie-in",
    label: "Tie-In: Mass Withdrawal",
    narrative: "For a multihomed VPWS site, per-ES A-D withdrawal can provide faster signaling: one ES-level failure signal can update the failed-PE state for every associated VPWS service instance on that segment at once — this lesson does not rebuild that entire mechanism, only connects to it.",
  },
  {
    id: "multiple-vpws-scaling",
    label: "Multiple VPWS Service Instances",
    narrative: "VPWS-500, VPWS-501, VPWS-502 may all share the same physical multihomed Ethernet Segment but represent distinct point-to-point service instances — each with its own per-EVI Type-1 route, service ID, and service label. One service label never automatically identifies all services on the ES.",
  },
  {
    id: "service-instance-id-note",
    label: "Accuracy Note — Service Instance ID",
    narrative: "EVPN-VPWS carries the service-instance identifier in the Ethernet Tag ID field of the Ethernet A-D per-EVI route. This is not a universal rule that \"Ethernet Tag ID = customer VLAN.\"",
  },
  {
    id: "transport-independence-note",
    label: "Standards Note — Transport Independence",
    narrative: "EVPN-VPWS control-plane procedures are not limited to this MPLS visualization — VXLAN encapsulation is also conceptually supported. This lesson keeps MPLS as the actual simulated data plane and does not add a second full VXLAN-VPWS simulation.",
  },
  {
    id: "break-intro",
    label: "Break The Service",
    narrative: "Everything converged and forwarded cleanly so far. Time for one controlled, educational fault: a service-parameter incompatibility, not a routing or election fault.",
  },
  {
    id: "fault-injected",
    label: "VPWS-500 Remains DOWN",
    narrative: "BGP EVPN is Established. The Type-1 per-EVI route is received. The remote endpoint exists. But VPWS-500 remains DOWN: PE1/PE2 advertise L2 MTU 9000; PE3 expects L2 MTU 1500. The remote endpoint must not become usable when the advertised non-zero MTU does not match the locally expected MTU.",
    run: (state) => {
      const vpwsService = installVpwsService(state.perEviAdRoutes, FAULT_L2_MTU);
      return { state: { ...state, mtuFault: true, vpwsService }, events: [{ type: "BGP_STATE_CHANGED", stepId: "fault-injected", timestamp: Date.now(), message: "PE3's expected L2 MTU set to 1500 — mismatch with PE2's advertised 9000 (deliberate fault)" }] };
    },
    whatChanged: () => ["PE3 expected L2 MTU: 9000 → 1500", "VPWS-500 status: UP → DOWN (remote endpoint received but not usable)"],
  },
  {
    id: "trouble-intro",
    label: "Troubleshoot",
    narrative: "Complaint: \"CE-A and CE-B can no longer exchange traffic.\" BGP EVPN is Established. The Type-1 per-EVI route is received. The remote endpoint exists.",
  },
  {
    id: "trouble-question",
    label: "Troubleshoot",
    narrative: "Every control-plane signaling layer up through remote-endpoint discovery looks healthy.",
    question: {
      prompt: "What's actually keeping VPWS-500 down?",
      options: [
        { id: "esi-mismatch", label: "PE1 and PE2 have different ESIs configured" },
        { id: "no-route", label: "The Type-1 per-EVI route was never received" },
        { id: "mtu-mismatch", label: "A service-parameter incompatibility — the advertised and locally expected L2 MTU don't match" },
        { id: "df-issue", label: "PE2 isn't the DF" },
      ],
      correctOptionId: "mtu-mismatch",
      explanation: "The route exists, the remote endpoint is discovered — but the service parameters (L2 MTU) don't match, so the remote endpoint cannot become usable. This is a service-compatibility failure, not a routing or DF/election failure.",
      hints: [
        "Hint 1: BGP EVPN, the Type-1 per-EVI route, and remote-endpoint discovery are all confirmed healthy.",
        "Hint 2: compare the L2 MTU PE1/PE2 advertise against the L2 MTU PE3 locally expects.",
        "Hint 3: this has nothing to do with Primary/Backup election.",
      ],
    },
  },
  {
    id: "diagnostic-layers",
    label: "Layer By Layer",
    narrative: "The failure is narrowly scoped to L2 MTU compatibility and everything downstream of it — every layer beneath remote-endpoint discovery is healthy.",
  },
  {
    id: "repair-challenge",
    label: "Apply The Fix",
    narrative: "Make the VPWS L2 MTU compatible — change PE3's expected L2 MTU from 1500 to 9000.",
    action: (state, payload) => {
      const choice = typeof payload === "object" && payload !== null && "choice" in payload ? String((payload as { choice: string }).choice) : "";
      if (choice !== "fix-mtu") return { state: { ...state, repairAttempt: { choice, correct: false } }, events: [] };
      const vpwsService = installVpwsService(state.perEviAdRoutes, CORRECT_L2_MTU);
      return { state: { ...state, mtuFault: false, vpwsService, repairAttempt: { choice, correct: true }, challengeSucceeded: true, challengeStage: "mtu-repaired" }, events: [{ type: "ROUTE_SELECTED", stepId: "repair-challenge", timestamp: Date.now(), message: "PE3's expected L2 MTU corrected to 9000 — VPWS-500 usable again" }] };
    },
    requiresState: (state) => state.challengeSucceeded === true,
  },
  {
    id: "verify-repair",
    label: "Verify — VPWS-500 UP",
    narrative: "Type-1 route usable ✓. VPWS-500 UP ✓. Service label installed ✓. Forwarding ✓. Send customer traffic again.",
    packet: (state) => vpwsPacket("frame-verify", "CE-A", state.election.primaryPe ?? "PE1", "Verification frame — CE-A → CE-B", "FRAME", { frame: { srcMac: CE_A_MAC, dstMac: CE_B_MAC }, labels: [] }),
    run: (state) => {
      const via = state.election.primaryPe ?? "PE1";
      // The ingress Primary pushes the label the disposition PE (PE3) advertised.
      const serviceLabel = remoteServiceLabelFor(state.perEviAdRoutes, via);
      return {
        state: {
          ...state,
          direction: "ce-a-to-ce-b",
          packetAt: "CE-B",
          challengeStage: "frame-sent",
          journey: [
            ...state.journey,
            { device: via, input: "Customer Ethernet frame on AC", lookup: `Service lookup → VPWS-${VPWS_SERVICE_ID} → remote endpoint PE3`, action: "SERVICE_LOOKUP", output: `Encapsulated toward PE3 with service label ${serviceLabel ?? "(none)"}` },
            { device: "CORE", input: `Top label ${TRANSPORT_LABEL}`, lookup: "Transport forwarding (swap)", action: "TRANSPORT_FORWARD", output: "Forwarded toward PE3" },
            { device: "PE3", input: labeledStackText(serviceLabel), lookup: `Pop transport → read service label ${serviceLabel ?? "(none)"} → VPWS-${VPWS_SERVICE_ID} → CE-B AC`, action: "POP_SERVICE", output: "Customer frame forwarded to CE-B" },
          ],
        },
        events: [{ type: "PACKET_RECEIVED", stepId: "verify-repair", timestamp: Date.now(), message: `CE-B receives the verification frame via ${via} — VPWS-500 fully restored` }],
      };
    },
  },
  {
    id: "challenge-refail-pe1",
    label: "Engineer Challenge — Protect The Virtual Wire",
    narrative: "Now prove the redundancy still works: fail PE1's AC again and verify PE2 takes over.",
    run: (state) => {
      const result = failoverVpwsService({ election: state.election, perEviAdRoutes: state.perEviAdRoutes, pe1AcFailed: true });
      const vpwsService = installVpwsService(result.perEviAdRoutes, state.vpwsService?.pe3ExpectedMtu ?? CORRECT_L2_MTU);
      return { state: { ...state, pe1AcFailed: true, election: result.election, perEviAdRoutes: result.perEviAdRoutes, vpwsService, challengeStage: "failover-verified" }, events: [{ type: "BGP_STATE_CHANGED", stepId: "challenge-refail-pe1", timestamp: Date.now(), message: "PE1's AC fails again — PE2 takes over as Primary" }] };
    },
    whatChanged: (prev, next) => [`Primary: ${prev.election.primaryPe} → ${next.election.primaryPe}`, "VPWS-500 remains UP throughout the takeover"],
  },
  {
    id: "challenge-resend",
    label: "Resend Traffic Through PE2",
    narrative: "Send CE-A → CE-B traffic once more, now through the new Primary.",
    packet: () => vpwsPacket("frame-challenge", "CE-A", "PE2", "Customer Ethernet frame — CE-A → CE-B (via PE2)", "FRAME", { frame: { srcMac: CE_A_MAC, dstMac: CE_B_MAC }, labels: [] }),
    run: (state) => {
      // PE2 is the ingress here — it pushes PE3's advertised label, not its own.
      const serviceLabel = remoteServiceLabelFor(state.perEviAdRoutes, "PE2");
      return {
        state: {
          ...state,
          direction: "ce-a-to-ce-b",
          packetAt: "CE-B",
          challengeStage: "done",
          journey: [
            ...state.journey,
            { device: "PE2", input: "Customer Ethernet frame on AC", lookup: `Service lookup → VPWS-${VPWS_SERVICE_ID} → remote endpoint PE3`, action: "SERVICE_LOOKUP", output: `Encapsulated toward PE3 with service label ${serviceLabel ?? "(none)"}` },
            { device: "CORE", input: `Top label ${TRANSPORT_LABEL}`, lookup: "Transport forwarding (swap)", action: "TRANSPORT_FORWARD", output: "Forwarded toward PE3" },
            { device: "PE3", input: labeledStackText(serviceLabel), lookup: `Pop transport → read service label ${serviceLabel ?? "(none)"} → VPWS-${VPWS_SERVICE_ID} → CE-B AC`, action: "POP_SERVICE", output: "Customer frame forwarded to CE-B" },
          ],
        },
        events: [{ type: "PACKET_RECEIVED", stepId: "challenge-resend", timestamp: Date.now(), message: "CE-B receives traffic through PE2 — the virtual wire survived the failover" }],
      };
    },
  },
  {
    id: "single-active-vs-all-active-vpws",
    label: "Single-Active vs. All-Active VPWS",
    narrative: "SINGLE-ACTIVE VPWS: one Primary, one Backup, remote traffic uses Primary — this lesson's simulation. ALL-ACTIVE VPWS: multiple active PEs may participate in per-flow forwarding — not built here.",
  },
  {
    id: "complete",
    label: "Lesson Complete",
    narrative: "CE-A and CE-B stayed connected over a point-to-point virtual Ethernet wire, signaled almost entirely by Ethernet A-D per-EVI routes — surviving both a Primary/Backup failover and a service-parameter repair, never touching Type-2 MAC learning.",
  },
];
