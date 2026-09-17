import type { PacketLayer, PacketVisual, ScenarioStep } from "../types";

/**
 * Traditional MPLS VPLS — multipoint Ethernet, MAC learning, flooding,
 * full-mesh pseudowires, and pseudowire split horizon.
 *
 * Builds directly on /demo/mpls-l2vpn-vpws (traditional VPWS): same
 * targeted-LDP / PW FEC / directional-receive-label model, extended
 * from one point-to-point pseudowire to a full mesh of them, with a
 * genuinely new question VPWS never had to answer — which of several
 * possible remote PEs should a frame go to?
 *
 * Central question: how does a provider turn multiple point-to-point
 * MPLS pseudowires into one multipoint virtual Ethernet LAN?
 *
 *   CE1 ─ PE1
 *          │
 *         P1
 *        ╱  ╲
 *      P2    P3
 *       │      │
 *      PE2    PE3
 *       │      │
 *      CE2    CE3
 *
 * PE1/PE2/PE3 are VPLS bridge members, full-meshed with pseudowires
 * (PE1-PE2, PE1-PE3, PE2-PE3). P1/P2/P3 are transport-only transit.
 *
 * Explicitly deferred: H-VPLS, BGP-signaled VPLS/auto-discovery, EVPN
 * (a genuinely different control-plane model, compared conceptually
 * only), PBB, VPLS inter-AS, VPLS multicast optimization, LDP MAC
 * Address Withdrawal (named once as an advanced convergence mechanism,
 * never simulated), EVPN-style sequence-numbered MAC mobility (VPLS
 * relearns on newest-observed-source, nothing more).
 *
 * Pure data + pure functions only — see /lib/sim-engine/types.ts.
 */

export type RouterId = "CE1" | "PE1" | "P1" | "P2" | "P3" | "PE2" | "PE3" | "CE2" | "CE3";
export const ALL_DEVICES: RouterId[] = ["CE1", "PE1", "P1", "P2", "P3", "PE2", "PE3", "CE2", "CE3"];
export const PE_ROUTERS: RouterId[] = ["PE1", "PE2", "PE3"];
export const CE_ROUTERS: RouterId[] = ["CE1", "CE2", "CE3"];
export const P_ROUTERS: RouterId[] = ["P1", "P2", "P3"];
export const ROUTER_LOOPBACK: Partial<Record<RouterId, string>> = { PE1: "1.1.1.1", P1: "10.10.10.1", P2: "10.10.10.2", P3: "10.10.10.3", PE2: "2.2.2.2", PE3: "3.3.3.3" };

export type LinkId = "CE1-PE1" | "PE1-P1" | "P1-P2" | "P1-P3" | "P2-PE2" | "P3-PE3" | "PE2-CE2" | "PE3-CE3";
export interface LinkDef {
  id: LinkId;
  a: RouterId;
  b: RouterId;
  igpMetric?: number;
}
export const LINKS: LinkDef[] = [
  { id: "CE1-PE1", a: "CE1", b: "PE1" },
  { id: "PE1-P1", a: "PE1", b: "P1", igpMetric: 10 },
  { id: "P1-P2", a: "P1", b: "P2", igpMetric: 10 },
  { id: "P1-P3", a: "P1", b: "P3", igpMetric: 10 },
  { id: "P2-PE2", a: "P2", b: "PE2", igpMetric: 10 },
  { id: "P3-PE3", a: "P3", b: "PE3", igpMetric: 10 },
  { id: "PE2-CE2", a: "PE2", b: "CE2" },
  { id: "PE3-CE3", a: "PE3", b: "CE3" },
];

export const CE_IP: Record<"CE1" | "CE2" | "CE3", string> = { CE1: "192.168.100.1/24", CE2: "192.168.100.2/24", CE3: "192.168.100.3/24" };
export const CE_MAC: Record<"CE1" | "CE2" | "CE3", string> = { CE1: "00:11:11:11:11:11", CE2: "00:22:22:22:22:22", CE3: "00:33:33:33:33:33" };
export const BROADCAST_MAC = "ff:ff:ff:ff:ff:ff";
export const SERVICE_NAME = "CUST-A-VPLS";
export const VLAN = 100;
export const VPLS_SERVICE_ID = 500;
export const VPLS_XP_AWARD = 650;
export const PE1_INTERFACE = "ge-0/0/0.100";
export const PE2_INTERFACE = "ge-0/0/0.100";
export const PE3_INTERFACE = "ge-0/0/0.100";
export const AC_INTERFACE: Record<RouterId, string> = { PE1: PE1_INTERFACE, PE2: PE2_INTERFACE, PE3: PE3_INTERFACE } as Record<RouterId, string>;

export const TERMS: { term: string; expansion: string; meaning: string }[] = [
  { term: "VSI", expansion: "Virtual Switching Instance", meaning: "PacketVerse says \"VPLS bridge context\" — each participating PE behaves like an Ethernet bridge for this one service, with local AC ports and PW-facing ports." },
  { term: "Full Mesh", expansion: "Full-Mesh Pseudowires", meaning: "Every pair of VPLS PEs signals its own direct pseudowire — required because a mesh PW must never relay onto another mesh PW (split horizon)." },
  { term: "Split Horizon", expansion: "PW Split Horizon", meaning: "A frame received from one classic VPLS mesh pseudowire is never forwarded out another mesh pseudowire — an Ethernet/VPLS loop-prevention rule, not IP split horizon." },
  { term: "BUM", expansion: "Broadcast / Unknown Unicast / Multicast", meaning: "Traffic classes that must be replicated within the VPLS bridge, subject to ingress-port suppression and split horizon." },
];

// ---------------------------------------------------------------------------
// MPLS label stack — same LabelPurpose convention as mplsL2vpnVpws.ts.
// ---------------------------------------------------------------------------
export type LabelPurpose = "transport" | "service";
export interface MplsLabel {
  value: number;
  bottomOfStack: boolean;
  purpose: LabelPurpose;
}
export interface EthernetFrame {
  srcMac: string;
  dstMac: string;
  note: string;
}
export interface MplsPacketState {
  frame: EthernetFrame;
  labels: MplsLabel[];
}
function pushLabel(pkt: MplsPacketState, value: number, purpose: LabelPurpose): MplsPacketState {
  const wasEmpty = pkt.labels.length === 0;
  const rest = pkt.labels.map((l) => ({ ...l, bottomOfStack: false }));
  return { ...pkt, labels: [{ value, bottomOfStack: wasEmpty, purpose }, ...rest] };
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
export type LabelBindingValue = number | "IMPLICIT_NULL";
export function fmtLabel(v: LabelBindingValue): string {
  return v === "IMPLICIT_NULL" ? "implicit-null" : String(v);
}

// ---------------------------------------------------------------------------
// Transport — recapped exactly as in the VPWS lesson (three stage
// flags), never re-derived hop by hop.
// ---------------------------------------------------------------------------
export interface TransportState {
  igpUp: boolean;
  ldpUp: boolean;
  lspUp: boolean;
}
export function transportReachable(t: TransportState): boolean {
  return t.igpUp && t.ldpUp && t.lspUp;
}
// The core is a TREE that branches at P1 (P1-P2 toward PE2, P1-P3 toward
// PE3), not a single chain like VPWS's core — so a flat per-router label
// is not enough: P1 alone must hand PE1 two DISTINCT labels (one per
// ultimate egress PE) so it can tell which branch to continue down.
// transportLabelFor(router, egress) is "the label `router` advertised
// for reaching `egress`'s loopback" — always a real value. Penultimate-
// hop-popping (PHP) is not derived from this function; like VPWS, it is
// applied as a literal "IMPLICIT_NULL" at the one specific step where the
// P router directly attached to the egress PE forwards onto that PE.
const TRANSPORT_LABEL_BASE: Partial<Record<RouterId, number>> = { P1: 100, P2: 200, P3: 300 };
export function transportLabelFor(router: RouterId, egress: RouterId): number {
  return (TRANSPORT_LABEL_BASE[router] ?? 100) + (PE_INDEX[egress] ?? 0);
}

// ---------------------------------------------------------------------------
// Targeted LDP — modeled as ONE shared readiness state across the full
// PE mesh (a documented simplification: per-pair targeted-LDP session
// mechanics were already taught in depth in the VPWS lesson; VPLS PE
// membership is treated as already known/configured, per the brief).
// ---------------------------------------------------------------------------
export type TargetedLdpState = "DOWN" | "TARGETED_HELLO" | "TCP_SESSION" | "INITIALIZATION" | "OPERATIONAL";
export const TARGETED_LDP_INFO: Record<TargetedLdpState, { meaning: string; why: string }> = {
  DOWN: { meaning: "No targeted LDP sessions exist between the VPLS PE loopbacks yet.", why: "Just like VPWS, these sessions must be explicitly established — nothing discovers this mesh automatically." },
  TARGETED_HELLO: { meaning: "PE1, PE2, and PE3 are exchanging unicast targeted Hellos, pairwise, across the MPLS core.", why: "Same mechanism as VPWS's targeted LDP — just now happening for every pair in the mesh." },
  TCP_SESSION: { meaning: "TCP sessions are establishing between each PE pair.", why: "LDP session establishment uses TCP — carrying signaling, never customer data." },
  INITIALIZATION: { meaning: "LDP Initialization is negotiating session parameters for each pair.", why: "Every pair must agree on protocol version and timers." },
  OPERATIONAL: { meaning: "All targeted LDP sessions in the mesh are OPERATIONAL — PW FEC/label exchange can now proceed for every pair.", why: "This makes PW signaling possible — it does not by itself mean any pseudowire, or the VPLS service, is UP." },
};

// ---------------------------------------------------------------------------
// Attachment Circuits — same shape as VPWS.
// ---------------------------------------------------------------------------
export interface AttachmentCircuit {
  peRouter: RouterId;
  ceRouter: RouterId;
  interfaceName: string;
  vlan: number;
  up: boolean;
}
export function resolveAttachmentCircuit(acs: AttachmentCircuit[], peRouter: RouterId): AttachmentCircuit | undefined {
  return acs.find((a) => a.peRouter === peRouter);
}

// ---------------------------------------------------------------------------
// Full-mesh pseudowires — every PE pair signals its own direct PW.
// Directional receive labels are a real, deterministic formula (not
// hand-picked): base + own-index*10 + remote-index. This reproduces
// the brief's own example values exactly (PE1 from PE2 = 24012, PE1
// from PE3 = 24013, PE2 from PE1 = 25021, etc.) while remaining a
// genuine function of (router, remote), reusable for any pair.
// ---------------------------------------------------------------------------
export type PwPairId = "PE1-PE2" | "PE1-PE3" | "PE2-PE3";
export const PW_PAIRS: { id: PwPairId; a: RouterId; b: RouterId }[] = [
  { id: "PE1-PE2", a: "PE1", b: "PE2" },
  { id: "PE1-PE3", a: "PE1", b: "PE3" },
  { id: "PE2-PE3", a: "PE2", b: "PE3" },
];
export const PE_INDEX: Record<RouterId, number> = { PE1: 1, PE2: 2, PE3: 3 } as Record<RouterId, number>;
const PW_LABEL_BASE: Partial<Record<RouterId, number>> = { PE1: 24000, PE2: 25000, PE3: 26000 };
export function allocatePwReceiveLabel(router: RouterId, remote: RouterId): number {
  return (PW_LABEL_BASE[router] ?? 24000) + PE_INDEX[router] * 10 + PE_INDEX[remote];
}
export function pwPairFor(a: RouterId, b: RouterId): PwPairId | undefined {
  return PW_PAIRS.find((p) => (p.a === a && p.b === b) || (p.a === b && p.b === a))?.id;
}
export function remotePeerOn(pairId: PwPairId, self: RouterId): RouterId | undefined {
  const pair = PW_PAIRS.find((p) => p.id === pairId);
  if (!pair) return undefined;
  return pair.a === self ? pair.b : pair.b === self ? pair.a : undefined;
}
export function pwPeersOf(self: RouterId): RouterId[] {
  return PW_PAIRS.filter((p) => p.a === self || p.b === self).map((p) => (p.a === self ? p.b : p.a));
}
/** VPLS Service ID (FEC identity) is shared across the whole mesh — distinct from the per-hop MPLS label and from the customer's VLAN. */
export function buildVplsFecKey(): string {
  return `VPLS-${VPLS_SERVICE_ID}`;
}

export interface PwLinkState {
  id: PwPairId;
  up: boolean;
}
export function activePwPeers(pwLinks: PwLinkState[], self: RouterId): RouterId[] {
  return pwLinks.filter((l) => l.up).flatMap((l) => (remotePeerOn(l.id, self) ? [remotePeerOn(l.id, self)!] : []));
}
export function pwUpBetween(pwLinks: PwLinkState[], a: RouterId, b: RouterId): boolean {
  const id = pwPairFor(a, b);
  return !!id && !!pwLinks.find((l) => l.id === id)?.up;
}

// ---------------------------------------------------------------------------
// VPLS bridge ports — a PE's local AC plus its PW-facing "ports" to
// every other mesh member. PWs behave conceptually like remote
// bridge-facing ports — never described as ordinary physical Ethernet
// ports (brief §7).
// ---------------------------------------------------------------------------
export type FdbPort = { kind: "AC"; peer: RouterId } | { kind: "PW"; peer: RouterId };
export function portsEqual(a: FdbPort, b: FdbPort): boolean {
  return a.kind === b.kind && a.peer === b.peer;
}
export function portLabel(port: FdbPort): string {
  return port.kind === "AC" ? `AC: ${port.peer}` : `PW: ${port.peer}`;
}
export function bridgePortsFor(self: RouterId, ac: AttachmentCircuit | undefined, pwLinks: PwLinkState[]): FdbPort[] {
  const ports: FdbPort[] = [];
  if (ac) ports.push({ kind: "AC", peer: ac.ceRouter });
  for (const peer of activePwPeers(pwLinks, self)) ports.push({ kind: "PW", peer });
  return ports;
}

// ---------------------------------------------------------------------------
// MAC/FDB — traditional VPLS learns remote MAC locations by observing
// Ethernet frames arriving over pseudowires (data-plane learning), not
// through any control-plane MAC distribution. Deliberately NOT modeled
// like EVPN's sequence-numbered route-based mobility (evpnMacMobility.ts)
// — this is plain "newest observed source wins" relearning.
// ---------------------------------------------------------------------------
export interface FdbEntry {
  mac: string;
  port: FdbPort;
  age: number;
}
export type Fdb = FdbEntry[];
export type LearnChange = "NEW" | "REFRESH" | "MOVE";

/** Handles first learn, refresh (same port seen again), and move (a different port now sources this MAC) — the single entry point every ingress path uses. */
export function learnSourceMac(fdb: Fdb, mac: string, port: FdbPort): { fdb: Fdb; change: LearnChange; previousPort?: FdbPort } {
  const existing = fdb.find((e) => e.mac === mac);
  if (!existing) {
    return { fdb: [...fdb, { mac, port, age: 0 }], change: "NEW" };
  }
  if (portsEqual(existing.port, port)) {
    return { fdb: fdb.map((e) => (e.mac === mac ? { ...e, age: 0 } : e)), change: "REFRESH" };
  }
  return { fdb: fdb.map((e) => (e.mac === mac ? { ...e, port, age: 0 } : e)), change: "MOVE", previousPort: existing.port };
}
/** Thin semantic wrapper over learnSourceMac for the explicit "a host moved sites" teaching moment (brief §38-39) — same mechanism, named separately so the lesson can call out exactly when a MOVE happens. */
export function moveMacEntry(fdb: Fdb, mac: string, newPort: FdbPort): { fdb: Fdb; previousPort?: FdbPort } {
  const result = learnSourceMac(fdb, mac, newPort);
  return { fdb: result.fdb, previousPort: result.previousPort };
}
/** Simulates a full age-out in one step (brief §37's controlled lab) — the entry is removed entirely, returning that destination to unknown. */
export function ageMacEntry(fdb: Fdb, mac: string): Fdb {
  return fdb.filter((e) => e.mac !== mac);
}

export type MacClass = "BROADCAST" | "MULTICAST" | "UNICAST";
export function classifyDestinationMac(mac: string): MacClass {
  if (mac.toLowerCase() === BROADCAST_MAC) return "BROADCAST";
  const firstOctet = parseInt(mac.split(":")[0], 16);
  if (!Number.isNaN(firstOctet) && (firstOctet & 1) === 1) return "MULTICAST";
  return "UNICAST";
}
export type DestinationLookup =
  | { kind: "LOCAL_UNICAST"; port: FdbPort }
  | { kind: "REMOTE_UNICAST"; port: FdbPort }
  | { kind: "UNKNOWN_UNICAST" }
  | { kind: "BROADCAST" }
  | { kind: "MULTICAST" };
export function lookupDestinationMac(fdb: Fdb, mac: string): DestinationLookup {
  const cls = classifyDestinationMac(mac);
  if (cls === "BROADCAST") return { kind: "BROADCAST" };
  if (cls === "MULTICAST") return { kind: "MULTICAST" };
  const entry = fdb.find((e) => e.mac === mac);
  if (!entry) return { kind: "UNKNOWN_UNICAST" };
  return { kind: entry.port.kind === "AC" ? "LOCAL_UNICAST" : "REMOTE_UNICAST", port: entry.port };
}

export type ForwardingDecision = "LOCAL_UNICAST" | "REMOTE_UNICAST" | "UNKNOWN_UNICAST" | "BROADCAST" | "MULTICAST" | "SPLIT_HORIZON_BLOCKED";

/** Raw eligible egress ports before split horizon — known unicast goes to exactly one port (never the ingress port); BUM goes to every port except ingress. */
export function computeVplsEgressSet(allPorts: FdbPort[], ingressPort: FdbPort | undefined, lookup: DestinationLookup): FdbPort[] {
  if (lookup.kind === "LOCAL_UNICAST" || lookup.kind === "REMOTE_UNICAST") {
    if (ingressPort && portsEqual(lookup.port, ingressPort)) return [];
    return [lookup.port];
  }
  return allPorts.filter((p) => !ingressPort || !portsEqual(p, ingressPort));
}
/** The signature VPLS loop-prevention rule (brief §25): a frame that ingressed on a mesh PW must never egress on another mesh PW. AC ingress carries no such restriction. */
export function applySplitHorizon(egress: FdbPort[], ingressPort: FdbPort | undefined): FdbPort[] {
  if (!ingressPort || ingressPort.kind !== "PW") return egress;
  return egress.filter((p) => p.kind !== "PW");
}
/** Combines egress computation with split horizon and returns the semantic decision the lesson displays — including SPLIT_HORIZON_BLOCKED when the raw set and the filtered set differ down to nothing PW-bound. */
export function classifyForwardingDecision(lookup: DestinationLookup, rawEgress: FdbPort[], finalEgress: FdbPort[]): ForwardingDecision {
  const blockedSomePw = rawEgress.some((p) => p.kind === "PW") && !finalEgress.some((p) => p.kind === "PW") && rawEgress.length > finalEgress.length;
  if (blockedSomePw && (lookup.kind === "BROADCAST" || lookup.kind === "MULTICAST" || lookup.kind === "UNKNOWN_UNICAST")) return "SPLIT_HORIZON_BLOCKED";
  if (lookup.kind === "REMOTE_UNICAST" && rawEgress.length > 0 && finalEgress.length === 0) return "SPLIT_HORIZON_BLOCKED";
  return lookup.kind;
}

// ---------------------------------------------------------------------------
// Two-label forwarding — same shape as VPWS: outer transport label
// gets a copy to one specific remote PE; inner PW label (that PE's
// OWN advertised receive label) identifies the VPLS service there.
// ---------------------------------------------------------------------------
export function buildVplsLabelStack(frame: EthernetFrame, remotePwReceiveLabel: number, firstHopTransportLabel: LabelBindingValue): MplsPacketState {
  const base: MplsPacketState = { frame, labels: [] };
  const withPw = pushLabel(base, remotePwReceiveLabel, "service");
  if (firstHopTransportLabel === "IMPLICIT_NULL") return withPw;
  return pushLabel(withPw, firstHopTransportLabel, "transport");
}
export function processCoreTransportLabel(pkt: MplsPacketState, nextTransportLabel: LabelBindingValue): MplsPacketState {
  if (nextTransportLabel === "IMPLICIT_NULL") return popTopLabel(pkt);
  return swapTopLabel(pkt, nextTransportLabel);
}
export function resolveIncomingPwLabel(pkt: MplsPacketState): number | undefined {
  const top = pkt.labels[0];
  return top && top.purpose === "service" ? top.value : undefined;
}
export function deliverEthernetFrame(pkt: MplsPacketState): EthernetFrame {
  return pkt.frame;
}

// ---------------------------------------------------------------------------
// Top-level scenario state
// ---------------------------------------------------------------------------
export type JourneyAction =
  | "AC_INGRESS"
  | "PW_INGRESS"
  | "LEARN_SOURCE"
  | "LOOKUP_DEST"
  | "REPLICATE"
  | "PUSH_PW"
  | "PUSH_TRANSPORT"
  | "SWAP_TRANSPORT"
  | "POP_TRANSPORT"
  | "PW_LOOKUP"
  | "SPLIT_HORIZON_BLOCK"
  | "AC_EGRESS"
  | "AC_UNAVAILABLE";
export interface JourneyHop {
  device: RouterId;
  input: string;
  lookup: string;
  action: JourneyAction;
  output: string;
}
export interface TroubleshootingState {
  started: boolean;
  repairAttempt?: { choice: string; correct: boolean };
  repaired: boolean;
  verified: boolean;
}
export interface FloodCopyState {
  id: string;
  fromPe: RouterId;
  toPe: RouterId;
}
export interface MplsVplsState {
  transport: TransportState;
  targetedLdp: TargetedLdpState;
  acs: AttachmentCircuit[];
  pwLinks: PwLinkState[];
  fdb: Record<string, Fdb>;
  packet?: MplsPacketState;
  packetAt?: RouterId;
  journey: JourneyHop[];
  floodCopies?: FloodCopyState[];
  lastDecision?: ForwardingDecision;
  troubleshooting: TroubleshootingState;
}

export function createMplsVplsState(): MplsVplsState {
  return {
    transport: { igpUp: false, ldpUp: false, lspUp: false },
    targetedLdp: "DOWN",
    acs: [
      { peRouter: "PE1", ceRouter: "CE1", interfaceName: PE1_INTERFACE, vlan: VLAN, up: true },
      { peRouter: "PE2", ceRouter: "CE2", interfaceName: PE2_INTERFACE, vlan: VLAN, up: true },
      { peRouter: "PE3", ceRouter: "CE3", interfaceName: PE3_INTERFACE, vlan: VLAN, up: true },
    ],
    pwLinks: [
      { id: "PE1-PE2", up: false },
      { id: "PE1-PE3", up: false },
      { id: "PE2-PE3", up: false },
    ],
    fdb: { PE1: [], PE2: [], PE3: [] },
    journey: [],
    troubleshooting: { started: false, repaired: false, verified: false },
  };
}

export function fdbFor(state: Pick<MplsVplsState, "fdb">, router: RouterId): Fdb {
  return state.fdb[router] ?? [];
}
export function portsFor(state: Pick<MplsVplsState, "acs" | "pwLinks">, router: RouterId): FdbPort[] {
  return bridgePortsFor(router, resolveAttachmentCircuit(state.acs, router), state.pwLinks);
}

// ---------------------------------------------------------------------------
// Graph layout — a tree-shaped core (P1 branches to P2/P3), matching
// the brief's own suggested physical topology.
// ---------------------------------------------------------------------------
export const GRAPH_NODES = [
  { id: "CE1", label: "CE1", x: 4, y: 20, subLabel: CE_IP.CE1 },
  { id: "PE1", label: "PE1", x: 22, y: 20, subLabel: ROUTER_LOOPBACK.PE1 },
  { id: "P1", label: "P1", x: 40, y: 50, subLabel: ROUTER_LOOPBACK.P1 },
  { id: "P2", label: "P2", x: 60, y: 20, subLabel: ROUTER_LOOPBACK.P2 },
  { id: "P3", label: "P3", x: 60, y: 80, subLabel: ROUTER_LOOPBACK.P3 },
  { id: "PE2", label: "PE2", x: 80, y: 20, subLabel: ROUTER_LOOPBACK.PE2 },
  { id: "PE3", label: "PE3", x: 80, y: 80, subLabel: ROUTER_LOOPBACK.PE3 },
  { id: "CE2", label: "CE2", x: 96, y: 20, subLabel: CE_IP.CE2 },
  { id: "CE3", label: "CE3", x: 96, y: 80, subLabel: CE_IP.CE3 },
];
export const GRAPH_EDGES: { id: LinkId; a: RouterId; b: RouterId }[] = LINKS.map((l) => ({ id: l.id, a: l.a, b: l.b }));

/** Collapsed "service view" — the full-mesh logical VPLS bridge, with P routers hidden entirely (brief §50). */
export const SERVICE_GRAPH_NODES = [
  { id: "CE1", label: "CE1", x: 8, y: 10, subLabel: CE_IP.CE1 },
  { id: "PE1", label: "PE1", x: 8, y: 35, subLabel: "AC: " + PE1_INTERFACE },
  { id: "PE2", label: "PE2", x: 75, y: 15, subLabel: "AC: " + PE2_INTERFACE },
  { id: "PE3", label: "PE3", x: 75, y: 85, subLabel: "AC: " + PE3_INTERFACE },
  { id: "CE2", label: "CE2", x: 96, y: 15, subLabel: CE_IP.CE2 },
  { id: "CE3", label: "CE3", x: 96, y: 85, subLabel: CE_IP.CE3 },
];
export const SERVICE_GRAPH_EDGES: { id: string; a: RouterId; b: RouterId; label?: string }[] = [
  { id: "CE1-PE1", a: "CE1", b: "PE1" },
  { id: "PE1-PE2", a: "PE1", b: "PE2", label: "PW" },
  { id: "PE1-PE3", a: "PE1", b: "PE3", label: "PW" },
  { id: "PE2-PE3", a: "PE2", b: "PE3", label: "PW" },
  { id: "PE2-CE2", a: "PE2", b: "CE2" },
  { id: "PE3-CE3", a: "PE3", b: "CE3" },
];

// ---------------------------------------------------------------------------
// Packet / control-message builders
// ---------------------------------------------------------------------------
function ethLayer(frame: EthernetFrame): PacketLayer {
  return { name: "Ethernet", color: "var(--pv-proto-ip)", fields: [{ label: "Src MAC", value: frame.srcMac }, { label: "Dst MAC", value: frame.dstMac }, { label: "Note", value: frame.note }] };
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
  return [...pkt.labels.map(shimLayer), ethLayer(pkt.frame)];
}
function vplsPacket(id: string, from: RouterId, to: RouterId, summary: string, badge: string, pkt: MplsPacketState): PacketVisual {
  return { id, protocol: "MPLS", from, to, summary, badge, layers: buildPacketLayers(pkt) };
}
function ldpPacket(id: string, from: RouterId, to: RouterId, summary: string, badge: string, fields: { label: string; value: string }[]): PacketVisual {
  return { id, protocol: "MPLS", from, to, summary, badge, layers: [{ name: "Targeted LDP", color: "var(--pv-proto-mpls)", fields }] };
}
function ceFrame(src: "CE1" | "CE2" | "CE3", dst: "CE1" | "CE2" | "CE3" | "BROADCAST", note: string): EthernetFrame {
  return { srcMac: CE_MAC[src], dstMac: dst === "BROADCAST" ? BROADCAST_MAC : CE_MAC[dst], note };
}

// ---------------------------------------------------------------------------
// Scenario steps
// ---------------------------------------------------------------------------
export const mplsVplsSteps: ScenarioStep<MplsVplsState>[] = [
  {
    id: "intro",
    label: "Introduction",
    narrative: "Central question: how does a provider turn multiple point-to-point MPLS pseudowires into one multipoint virtual Ethernet LAN — where CE1, CE2, and CE3 all appear to sit on the same switch?",
  },
  {
    id: "recap-vpws",
    label: "Recap: Traditional VPWS",
    narrative: "You already built a single point-to-point pseudowire between PE1 and PE2: targeted LDP, a PW FEC both sides agreed on, and directional receive-label allocation. That model doesn't disappear here — it becomes the building block.",
  },
  {
    id: "multipoint-question",
    label: "Predict",
    narrative: "Before continuing:",
    question: {
      prompt: "CE3 joins the same customer LAN. Can you just reuse one VPWS pseudowire to connect all three sites?",
      options: [
        { id: "no-p2p", label: "No — a pseudowire is inherently point-to-point; a third site needs a genuinely different service model" },
        { id: "yes-add-third-leg", label: "Yes — just extend the same PW to a third endpoint" },
        { id: "yes-vlan-trunk", label: "Yes — trunk an extra VLAN across the same PW" },
        { id: "no-needs-bgp", label: "No — multipoint Ethernet is only possible with BGP EVPN" },
      ],
      correctOptionId: "no-p2p",
      explanation: "A pseudowire has exactly two endpoints. Multipoint Ethernet needs a different service model on top of pseudowires — a virtual bridge with several PW \"ports\" — which is exactly what VPLS is. (BGP EVPN is a different, later, control-plane approach to the same multipoint goal — not the only way to get there.)",
    },
  },
  {
    id: "vpls-mental-model",
    label: "The VPLS Mental Model",
    narrative: "Think of each participating PE as running a virtual Ethernet bridge for this customer — a VPLS bridge context. Its \"ports\" are the local attachment circuit (to the CE) and one logical port per remote PE, each riding a pseudowire. Ordinary Ethernet bridging rules — MAC learning, flooding, forwarding — apply inside that bridge, with one new loop-prevention rule for the PW ports.",
  },
  {
    id: "topology-intro",
    label: "Topology",
    narrative: `CE1 (${CE_IP.CE1}), CE2 (${CE_IP.CE2}), and CE3 (${CE_IP.CE3}) attach to PE1, PE2, and PE3. All three sit in the same customer VLAN ${VLAN} and the same Ethernet broadcast domain — ${SERVICE_NAME}. P1, P2, P3 are plain MPLS transit — they carry the core but never touch VPLS service state.`,
  },
  {
    id: "vpls-service-instance",
    label: "The VPLS Service Instance",
    narrative: `Every PE configures the same VPLS service: ${SERVICE_NAME}, FEC identity ${buildVplsFecKey()}. This service ID is shared mesh-wide — distinct from any one PW's own PW ID, and distinct from the customer's VLAN tag ${VLAN}.`,
  },
  {
    id: "vpls-bridge-context",
    label: "The Virtual Switching Instance (VSI)",
    narrative: "Some vendors call this a VSI — Virtual Switching Instance. PacketVerse calls it a \"VPLS bridge context.\" Whatever the name, it's the same idea: a per-PE, per-service virtual Ethernet bridge, instantiated independently at PE1, PE2, and PE3, that this VPLS service's traffic runs inside.",
  },
  {
    id: "bridge-ports-intro",
    label: "Bridge Ports: AC + PW",
    narrative: "A VPLS bridge context has two kinds of ports: one Attachment Circuit port (the local CE-facing interface) and one Pseudowire port per remote PE mesh member. Ordinary bridge forwarding logic — learn source, look up destination, flood if unknown — runs across all of them together.",
  },
  {
    id: "transport-recap-intro",
    label: "Transport Recap",
    narrative: "Exactly as in VPWS: IGP reachability, then LDP hop-by-hop label distribution, then a working label-switched path between every PE loopback. None of this is VPLS-specific — it's the same MPLS core VPWS already used.",
  },
  {
    id: "transport-lsp-up",
    label: "Transport: LSP UP",
    narrative: "IGP converged, LDP sessions up hop by hop, label-switched paths established between every PE loopback. The core is ready to carry labeled traffic — no VPLS state exists yet.",
    run: (state) => ({ state: { ...state, transport: { igpUp: true, ldpUp: true, lspUp: true } }, events: [] }),
    whatChanged: () => ["Transport: DOWN → UP (IGP + LDP + LSP)"],
  },
  {
    id: "targeted-ldp-intro",
    label: "Targeted LDP For The Mesh",
    narrative: "Just like VPWS, PW signaling rides targeted LDP sessions between PE loopbacks — except now every PE pair in the mesh needs one: PE1-PE2, PE1-PE3, PE2-PE3. PacketVerse models mesh-wide targeted-LDP readiness as one shared state, since the pairwise mechanics were already taught in full in the VPWS lesson.",
  },
  {
    id: "targeted-ldp-operational",
    label: "Targeted LDP: OPERATIONAL",
    narrative: TARGETED_LDP_INFO.OPERATIONAL.meaning,
    run: (state) => ({ state: { ...state, targetedLdp: "OPERATIONAL" }, events: [] }),
    whatChanged: () => ["Targeted LDP mesh: DOWN → OPERATIONAL"],
  },
  {
    id: "why-full-mesh-question",
    label: "Predict",
    narrative: "Before continuing:",
    question: {
      prompt: "Does VPLS need a pseudowire between every PE pair, or can one shared PW connect all three PEs?",
      options: [
        { id: "full-mesh", label: "A full mesh — a direct pseudowire between every PE pair" },
        { id: "one-shared-pw", label: "One shared multipoint PW linking all PEs" },
        { id: "hub-spoke", label: "One PW from a designated hub PE to each of the others is sufficient and behaves identically" },
        { id: "no-pw-needed", label: "No PW is needed once the service ID matches" },
      ],
      correctOptionId: "full-mesh",
      explanation: "A pseudowire is still fundamentally point-to-point. Traditional VPLS achieves multipoint connectivity by full-meshing PWs between every PE pair — and, as you'll see, needs a specific loop-prevention rule (split horizon) precisely because that mesh exists.",
    },
  },
  {
    id: "pw-id-vs-vpls-identity",
    label: "PW ID vs. VPLS Service Identity",
    narrative: `Two distinct identifiers, easy to conflate: ${buildVplsFecKey()} identifies the VPLS SERVICE — shared by all three PEs. Each individual pseudowire in the mesh still has its own PW FEC (PW Type + PW ID), exactly like VPWS — one per PE pair, not one for the whole service.`,
  },
  {
    id: "establish-pw-pe1-pe2",
    label: `Establish PW: PE1 ↔ PE2`,
    narrative: `PE1 allocates receive label ${allocatePwReceiveLabel("PE1", "PE2")} for traffic from PE2; PE2 allocates ${allocatePwReceiveLabel("PE2", "PE1")} for traffic from PE1. Both directions learned, transport reachable, ACs up — PW PE1-PE2 comes UP.`,
    packet: () => ldpPacket("map-pe1-pe2", "PE1", "PE2", "Label Mapping", "MAPPING", [{ label: "FEC", value: buildVplsFecKey() }, { label: "PE1→ label", value: String(allocatePwReceiveLabel("PE1", "PE2")) }, { label: "PE2→ label", value: String(allocatePwReceiveLabel("PE2", "PE1")) }]),
    run: (state) => ({ state: { ...state, pwLinks: state.pwLinks.map((l) => (l.id === "PE1-PE2" ? { ...l, up: true } : l)) }, events: [{ type: "VPN_ROUTE_INSTALLED", stepId: "establish-pw-pe1-pe2", timestamp: Date.now(), message: "PW PE1-PE2 UP" }] }),
    whatChanged: () => ["PW PE1-PE2: DOWN → UP"],
  },
  {
    id: "establish-pw-pe1-pe3",
    label: `Establish PW: PE1 ↔ PE3`,
    narrative: `PE1 allocates receive label ${allocatePwReceiveLabel("PE1", "PE3")} for traffic from PE3; PE3 allocates ${allocatePwReceiveLabel("PE3", "PE1")} for traffic from PE1. PW PE1-PE3 comes UP.`,
    packet: () => ldpPacket("map-pe1-pe3", "PE1", "PE3", "Label Mapping", "MAPPING", [{ label: "FEC", value: buildVplsFecKey() }, { label: "PE1→ label", value: String(allocatePwReceiveLabel("PE1", "PE3")) }, { label: "PE3→ label", value: String(allocatePwReceiveLabel("PE3", "PE1")) }]),
    run: (state) => ({ state: { ...state, pwLinks: state.pwLinks.map((l) => (l.id === "PE1-PE3" ? { ...l, up: true } : l)) }, events: [{ type: "VPN_ROUTE_INSTALLED", stepId: "establish-pw-pe1-pe3", timestamp: Date.now(), message: "PW PE1-PE3 UP" }] }),
    whatChanged: () => ["PW PE1-PE3: DOWN → UP"],
  },
  {
    id: "establish-pw-pe2-pe3",
    label: `Establish PW: PE2 ↔ PE3`,
    narrative: `PE2 allocates receive label ${allocatePwReceiveLabel("PE2", "PE3")} for traffic from PE3; PE3 allocates ${allocatePwReceiveLabel("PE3", "PE2")} for traffic from PE2. The mesh's third and final leg — PW PE2-PE3 — comes UP.`,
    packet: () => ldpPacket("map-pe2-pe3", "PE2", "PE3", "Label Mapping", "MAPPING", [{ label: "FEC", value: buildVplsFecKey() }, { label: "PE2→ label", value: String(allocatePwReceiveLabel("PE2", "PE3")) }, { label: "PE3→ label", value: String(allocatePwReceiveLabel("PE3", "PE2")) }]),
    run: (state) => ({ state: { ...state, pwLinks: state.pwLinks.map((l) => (l.id === "PE2-PE3" ? { ...l, up: true } : l)) }, events: [{ type: "VPN_ROUTE_INSTALLED", stepId: "establish-pw-pe2-pe3", timestamp: Date.now(), message: "PW PE2-PE3 UP" }] }),
    whatChanged: () => ["PW PE2-PE3: DOWN → UP"],
  },
  {
    id: "full-mesh-visual",
    label: "The Full Mesh, Complete",
    narrative: `Three PEs, three pseudowires: PE1-PE2, PE1-PE3, PE2-PE3 — every pair directly connected. Each PW carries its own pair of directional labels (PE1↔PE2: ${allocatePwReceiveLabel("PE1", "PE2")}/${allocatePwReceiveLabel("PE2", "PE1")}; PE1↔PE3: ${allocatePwReceiveLabel("PE1", "PE3")}/${allocatePwReceiveLabel("PE3", "PE1")}; PE2↔PE3: ${allocatePwReceiveLabel("PE2", "PE3")}/${allocatePwReceiveLabel("PE3", "PE2")}) — six independently-allocated labels in total for three PWs.`,
  },
  {
    id: "initial-state-recap",
    label: "Ready, But Empty",
    narrative: "Transport UP, targeted LDP OPERATIONAL, full PW mesh UP, all three ACs UP. But every PE's MAC/FDB table is completely empty — nothing has been learned yet. The bridge exists; it just doesn't know where anyone is.",
  },
  {
    id: "predict-p-router-vpls",
    label: "Predict",
    narrative: "Before continuing:",
    question: {
      prompt: "Do P1, P2, and P3 hold any VPLS bridge state — MAC tables, PW ports, split-horizon rules?",
      options: [
        { id: "no", label: "No — P routers only ever forward on the outer transport label, exactly like in VPWS" },
        { id: "yes-mac", label: "Yes — they need to learn MACs too, to avoid flooding unnecessarily" },
        { id: "yes-split-horizon", label: "Yes — split horizon must be enforced at every hop, including P routers" },
        { id: "only-p1", label: "Only P1, since it's the branch point of the core" },
      ],
      correctOptionId: "no",
      explanation: "This is VPLS's core scalability property, inherited straight from VPWS: the provider core stays completely unaware of customer MAC addresses or service state. All bridging intelligence — MAC learning, flooding, split horizon — lives only at the PEs.",
    },
  },
  {
    id: "mac-learning-intro",
    label: "MAC Learning: The New Idea",
    narrative: "Everything so far was VPWS with more pseudowires. Here's what's genuinely new: each PE now runs real Ethernet source-MAC learning on every frame it sees — from its AC, or from any pseudowire — building a table of \"this MAC lives behind that port.\"",
  },
  {
    id: "send-ce1-to-ce2-1",
    label: "CE1 Sends A Frame To CE2",
    narrative: `CE1 sends an ordinary Ethernet frame — Src ${CE_MAC.CE1}, Dst ${CE_MAC.CE2}. PE1 receives it, unlabeled, on its AC. Nobody has told PE1 where CE2 is yet.`,
    packet: () => ({ id: "ce1-frame-1", protocol: "IP", from: "CE1", to: "CE1", summary: "Ethernet frame toward CE2", layers: [ethLayer(ceFrame("CE1", "CE2", "First frame — CE1 to CE2"))] }),
    run: (state) => ({ state: { ...state, packet: { frame: ceFrame("CE1", "CE2", "First frame — CE1 to CE2"), labels: [] }, packetAt: "CE1", journey: [], floodCopies: undefined, lastDecision: undefined }, events: [{ type: "PACKET_SENT", stepId: "send-ce1-to-ce2-1", timestamp: Date.now(), message: "CE1 sends Ethernet frame toward CE2" }] }),
  },
  {
    id: "pe1-learn-ce1",
    label: "PE1: Learn Source MAC",
    narrative: `PE1 learns ${CE_MAC.CE1} on its AC port (AC: CE1) — the first entry in its FDB. Source learning happens on every ingress port, unconditionally, before any forwarding decision is made.`,
    packet: (state) => (state.packet ? vplsPacket("pe1-ac-in", "CE1", "PE1", "Ethernet frame", "AC", state.packet) : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const { fdb, change } = learnSourceMac(fdbFor(state, "PE1"), CE_MAC.CE1, { kind: "AC", peer: "CE1" });
      const journey = [...state.journey, { device: "PE1" as RouterId, input: "Ethernet frame (unlabeled)", lookup: `Learn source ${CE_MAC.CE1} on AC: CE1`, action: "AC_INGRESS" as JourneyAction, output: `FDB[PE1]: ${CE_MAC.CE1} → AC: CE1 (${change})` }];
      return { state: { ...state, packetAt: "PE1", journey, fdb: { ...state.fdb, PE1: fdb } }, events: [{ type: "MAC_LEARNED", stepId: "pe1-learn-ce1", timestamp: Date.now(), message: `PE1 learns ${CE_MAC.CE1} on AC: CE1` }] };
    },
    whatChanged: () => [`PE1 FDB: + ${CE_MAC.CE1} → AC: CE1`],
  },
  {
    id: "pe1-lookup-ce2-unknown",
    label: "PE1: Destination Lookup — Unknown",
    narrative: `PE1 looks up ${CE_MAC.CE2} in its FDB. Nothing matches — PE1 has never seen this MAC as a source. Classification: UNKNOWN_UNICAST.`,
    run: (state) => {
      const lookup = lookupDestinationMac(fdbFor(state, "PE1"), CE_MAC.CE2);
      const journey = [...state.journey, { device: "PE1" as RouterId, input: CE_MAC.CE2, lookup: "FDB lookup — no entry found", action: "LOOKUP_DEST" as JourneyAction, output: lookup.kind }];
      return { state: { ...state, journey, lastDecision: "UNKNOWN_UNICAST" }, events: [] };
    },
  },
  {
    id: "predict-unknown-unicast",
    label: "Predict",
    narrative: "Before continuing:",
    question: {
      prompt: "PE1 doesn't know where CE2's MAC is. What should it do with the frame?",
      options: [
        { id: "flood", label: "Flood it out every other eligible bridge port — every PW and every other AC (there are none here)" },
        { id: "drop", label: "Drop the frame — an unknown destination cannot be forwarded" },
        { id: "queue", label: "Buffer the frame until a control-plane MAC advertisement arrives" },
        { id: "send-pe2-only", label: "Guess CE2 is behind PE2 and send only there" },
      ],
      correctOptionId: "flood",
      explanation: "This is ordinary Ethernet flooding behavior, unchanged in VPLS: an unknown-unicast (or broadcast/multicast) frame is replicated out every bridge port except the one it arrived on. There is no control-plane MAC advertisement in traditional VPLS — flooding IS how the network discovers where CE2 actually is.",
    },
  },
  {
    id: "pe1-flood-decision",
    label: "PE1: Compute Flood Egress Set",
    narrative: `PE1's bridge ports: AC: CE1 (ingress — excluded), PW: PE2, PW: PE3. Ingress was the AC, so split horizon doesn't apply here (it only restricts PW-ingress traffic). Raw egress = final egress = [PW: PE2, PW: PE3].`,
    run: (state) => {
      const ports = portsFor(state, "PE1");
      const ingress: FdbPort = { kind: "AC", peer: "CE1" };
      const lookup = lookupDestinationMac(fdbFor(state, "PE1"), CE_MAC.CE2);
      const raw = computeVplsEgressSet(ports, ingress, lookup);
      const final = applySplitHorizon(raw, ingress);
      const decision = classifyForwardingDecision(lookup, raw, final);
      const journey = [...state.journey, { device: "PE1" as RouterId, input: CE_MAC.CE2, lookup: `Egress set: [${raw.map(portLabel).join(", ")}]`, action: "REPLICATE" as JourneyAction, output: `Flood to: ${final.map(portLabel).join(", ")}` }];
      return { state: { ...state, journey, lastDecision: decision }, events: [] };
    },
    whatChanged: () => ["PE1 decision: UNKNOWN_UNICAST → flood to PW: PE2 and PW: PE3"],
  },
  {
    id: "flood-copy-visual",
    label: "Two Replicas Leave PE1",
    narrative: "PE1 pushes a separate two-label stack for each replica — one addressed toward PE2, one toward PE3 — and sends both into the core simultaneously. This is what \"flooding\" concretely means at the data plane: real, independent packet replication, not a single shared multicast label in this traditional model.",
    packet: (state) => (state.packet ? vplsPacket("flood-both", "PE1", "PE1", "Replicate: 2 copies", "FLOOD", state.packet) : undefined),
    run: (state) => ({ state: { ...state, floodCopies: [{ id: "fc-pe2", fromPe: "PE1", toPe: "PE2" }, { id: "fc-pe3", fromPe: "PE1", toPe: "PE3" }] }, events: [] }),
  },
  {
    id: "pe1-push-copy-pe2",
    label: "PE1 → PE2: Push Two Labels",
    narrative: `Following the copy addressed to PE2: PE1 pushes PW label ${allocatePwReceiveLabel("PE2", "PE1")} (PE2's advertised receive label), then transport label ${transportLabelFor("P1", "PE2")} toward P1.`,
    packet: (state) => (state.packet ? vplsPacket("pe1-push-pe2", "PE1", "P1", "PUSH PW + transport", "PUSH", state.packet) : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const withPw = pushLabel(state.packet, allocatePwReceiveLabel("PE2", "PE1"), "service");
      const withTransport = pushLabel(withPw, transportLabelFor("P1", "PE2"), "transport");
      const journey = [...state.journey, { device: "PE1" as RouterId, input: "Ethernet frame", lookup: "Resolve PE2's advertised PW receive label + transport LSP to PE2", action: "PUSH_PW" as JourneyAction, output: `label ${transportLabelFor("P1", "PE2")} (transport) + label ${allocatePwReceiveLabel("PE2", "PE1")} (service)` }];
      return { state: { ...state, packetAt: "P1", packet: withTransport, journey }, events: [{ type: "VPN_LABEL_PUSHED", stepId: "pe1-push-copy-pe2", timestamp: Date.now(), message: "PE1 pushes PW + transport label toward PE2" }] };
    },
  },
  {
    id: "core-forward-to-pe2",
    label: "P1 → P2: Transport Forward + PHP",
    narrative: `P1 swaps the outer label to ${transportLabelFor("P2", "PE2")} toward P2, never touching the inner PW label. P2, directly attached to PE2, pops the transport label entirely (PHP) before forwarding.`,
    packet: (state) => (state.packet ? vplsPacket("core-to-pe2", "P1", "PE2", "Swap, then PHP", "SWAP/POP", state.packet) : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const afterP1 = processCoreTransportLabel(state.packet, transportLabelFor("P2", "PE2"));
      const afterP2 = processCoreTransportLabel(afterP1, "IMPLICIT_NULL");
      const journey = [
        ...state.journey,
        { device: "P1" as RouterId, input: `label ${transportLabelFor("P1", "PE2")}`, lookup: "Transport forwarding — outer label only", action: "SWAP_TRANSPORT" as JourneyAction, output: `label ${transportLabelFor("P2", "PE2")} (transport), inner PW label untouched` },
        { device: "P2" as RouterId, input: `label ${transportLabelFor("P2", "PE2")}`, lookup: "Transport forwarding — PHP toward PE2", action: "POP_TRANSPORT" as JourneyAction, output: "PW label only" },
      ];
      return { state: { ...state, packetAt: "PE2", packet: afterP2, journey }, events: [{ type: "TRANSPORT_LABEL_SWAPPED", stepId: "core-forward-to-pe2", timestamp: Date.now(), message: "Core forwards toward PE2, PHP at P2" }] };
    },
  },
  {
    id: "pe2-pw-lookup-learn-ce1",
    label: "PE2: PW Lookup + Learn CE1",
    narrative: `PE2 resolves incoming PW label ${allocatePwReceiveLabel("PE2", "PE1")} → ${SERVICE_NAME}, arriving on PW: PE1. It learns ${CE_MAC.CE1} → PW: PE1 in its own FDB — remote MAC locations are learned from the data plane, exactly like local ones.`,
    packet: (state) => (state.packet ? vplsPacket("pe2-pw-in", "P2", "PE2", "PW label lookup", "PW", state.packet) : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const { fdb, change } = learnSourceMac(fdbFor(state, "PE2"), CE_MAC.CE1, { kind: "PW", peer: "PE1" });
      const journey = [...state.journey, { device: "PE2" as RouterId, input: `label ${allocatePwReceiveLabel("PE2", "PE1")}`, lookup: `PW label → ${SERVICE_NAME}, ingress PW: PE1; learn source ${CE_MAC.CE1}`, action: "PW_INGRESS" as JourneyAction, output: `FDB[PE2]: ${CE_MAC.CE1} → PW: PE1 (${change})` }];
      return { state: { ...state, journey, fdb: { ...state.fdb, PE2: fdb } }, events: [{ type: "MAC_LEARNED", stepId: "pe2-pw-lookup-learn-ce1", timestamp: Date.now(), message: `PE2 learns ${CE_MAC.CE1} on PW: PE1` }] };
    },
    whatChanged: () => [`PE2 FDB: + ${CE_MAC.CE1} → PW: PE1`],
  },
  {
    id: "pe2-deliver-ce2",
    label: "PE2: Flood To Local AC — CE2 Receives",
    narrative: `PE2 doesn't know ${CE_MAC.CE2} either yet — but CE2 IS behind PE2's own AC. PE2's bridge ports: AC: CE2, PW: PE1 (ingress, excluded), PW: PE3. Raw egress = [AC: CE2, PW: PE3]; ingress was a PW, so split horizon strips PW: PE3 → final egress = [AC: CE2]. The frame reaches CE2 by ordinary flooding, not because PE2 "knew" where CE2 was.`,
    packet: (state) => (state.packet ? { id: "pe2-deliver", protocol: "IP", from: "PE2", to: "PE2", summary: "Delivered to CE2 via AC (flooded)", layers: [ethLayer(deliverEthernetFrame(state.packet))] } : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const ports = portsFor(state, "PE2");
      const ingress: FdbPort = { kind: "PW", peer: "PE1" };
      const lookup = lookupDestinationMac(fdbFor(state, "PE2"), CE_MAC.CE2);
      const raw = computeVplsEgressSet(ports, ingress, lookup);
      const final = applySplitHorizon(raw, ingress);
      const decision = classifyForwardingDecision(lookup, raw, final);
      const journey = [
        ...state.journey,
        { device: "PE2" as RouterId, input: CE_MAC.CE2, lookup: `Egress set: [${raw.map(portLabel).join(", ")}] → split horizon → [${final.map(portLabel).join(", ")}]`, action: "SPLIT_HORIZON_BLOCK" as JourneyAction, output: `Deliver to: ${final.map(portLabel).join(", ")}` },
        { device: "CE2" as RouterId, input: "Ethernet frame", lookup: "AC delivery — destination MAC matches CE2", action: "AC_EGRESS" as JourneyAction, output: "Delivered and accepted" },
      ];
      return { state: { ...state, packetAt: "CE2", packet: popTopLabel(state.packet), journey, lastDecision: decision }, events: [{ type: "VPN_PACKET_DELIVERED", stepId: "pe2-deliver-ce2", timestamp: Date.now(), message: "PE2 delivers flooded frame to CE2" }] };
    },
    whatChanged: () => ["CE2 receives the frame — its destination MAC matches, so it accepts it"],
  },
  {
    id: "pe3-parallel-copy",
    label: "Meanwhile, At PE3: The Other Replica",
    narrative: `PE3's copy takes the parallel path PE1 → P1 → P3 → PE3, pushed with PW label ${allocatePwReceiveLabel("PE3", "PE1")} and transport label ${transportLabelFor("P1", "PE3")}, PHP at P3. PE3 learns ${CE_MAC.CE1} → PW: PE1 in its own FDB, exactly like PE2 did. PE3's bridge ports: AC: CE3, PW: PE1 (ingress), PW: PE2. Raw egress = [AC: CE3, PW: PE2]; split horizon strips PW: PE2 (ingress was a PW) → final egress = [AC: CE3]. CE3 receives a copy too — but its NIC discards it, because the destination MAC (${CE_MAC.CE2}) isn't its own. That discard is ordinary Ethernet behavior, not a VPLS mechanism.`,
    run: (state) => {
      const { fdb } = learnSourceMac(fdbFor(state, "PE3"), CE_MAC.CE1, { kind: "PW", peer: "PE1" });
      return { state: { ...state, fdb: { ...state.fdb, PE3: fdb } }, events: [{ type: "MAC_LEARNED", stepId: "pe3-parallel-copy", timestamp: Date.now(), message: `PE3 learns ${CE_MAC.CE1} on PW: PE1` }] };
    },
    whatChanged: () => [`PE3 FDB: + ${CE_MAC.CE1} → PW: PE1`, "CE3 receives a copy of the flooded frame and discards it (wrong destination MAC)"],
  },
  {
    id: "split-horizon-intro",
    label: "Why Didn't PE2 Relay To PE3 (Or PE3 To PE2)?",
    narrative: "Notice what did NOT happen: PE2 never forwarded the flooded frame onward to PE3 over their PW, and PE3 never forwarded it onward to PE2. Both frames arrived on a mesh pseudowire, and pseudowire split horizon forbids relaying a mesh-PW-ingress frame out any OTHER mesh pseudowire.",
  },
  {
    id: "split-horizon-visual",
    label: "The Rule, Stated Plainly",
    narrative: "A local AC may send a flooded frame out to several pseudowires — that's how the mesh gets a frame to everyone in the first place. But a frame received FROM one classic-VPLS mesh pseudowire is never relayed out ANOTHER mesh pseudowire. This is the single most important rule in traditional VPLS.",
  },
  {
    id: "why-full-mesh-answer",
    label: "Why Full Mesh Is Required",
    narrative: "This is exactly why the PW mesh must be FULL: PE2 cannot rely on PE3 to relay traffic to it (split horizon forbids that PW-to-PW hop), so PE1 must have its own direct pseudowire to every other PE. Without a direct PE1-PE3 leg, PE1's floods could never reach CE3 at all — you'll see this exact failure in the troubleshooting incident later.",
  },
  {
    id: "predict-pw-to-pw-relay",
    label: "Predict",
    narrative: "Before continuing:",
    question: {
      prompt: "PE2 receives a broadcast frame on PW: PE1. Should PE2 ever forward it out PW: PE3?",
      options: [
        { id: "never", label: "Never — split horizon strictly forbids relaying mesh-PW-ingress traffic onto another mesh PW" },
        { id: "only-broadcast", label: "Yes, but only for broadcast/multicast, not unicast" },
        { id: "yes-if-pe3-down", label: "Yes, if PE1-PE3's direct PW happens to be down — PE2 should route around it" },
        { id: "yes-always", label: "Yes — PE2 should relay to keep the mesh converged" },
      ],
      correctOptionId: "never",
      explanation: "Split horizon applies uniformly to every traffic class arriving on a mesh PW — unicast, broadcast, multicast alike — and has no \"unless the direct path is down\" exception. That exception is exactly the trap the later troubleshooting incident sets, and exactly why disabling split horizon is never an acceptable fix.",
    },
  },
  {
    id: "split-horizon-terminology",
    label: "Not To Be Confused With...",
    narrative: "\"Split horizon\" here is an Ethernet/VPLS loop-prevention rule about pseudowire ports inside one bridge context — unrelated to distance-vector routing's split horizon (never re-advertising a route back out the interface it was learned on). Same name, unrelated mechanisms.",
  },
  {
    id: "broadcast-intro",
    label: "Broadcast And Multicast: Always Flooded",
    narrative: "Unknown unicast isn't the only traffic class that floods. Broadcast (destination ff:ff:ff:ff:ff:ff) and multicast destinations are ALWAYS flooded — VPLS never learns a broadcast/multicast destination into the FDB, because there's no single \"owning\" port to learn.",
  },
  {
    id: "ce1-arp-broadcast",
    label: "CE1 Sends An ARP Request (Broadcast)",
    narrative: "CE1 broadcasts an ARP request for CE2's MAC — ordinary LAN behavior on a shared subnet. PE1 receives it on its AC.",
    packet: () => ({ id: "arp-bcast", protocol: "IP", from: "CE1", to: "CE1", summary: "ARP request (broadcast)", layers: [ethLayer(ceFrame("CE1", "BROADCAST", "ARP request — who has 192.168.100.2?"))] }),
    run: (state) => ({ state: { ...state, packet: { frame: ceFrame("CE1", "BROADCAST", "ARP request — who has 192.168.100.2?"), labels: [] }, packetAt: "CE1", journey: [], floodCopies: undefined }, events: [{ type: "ARP_REQUEST_SENT", stepId: "ce1-arp-broadcast", timestamp: Date.now(), message: "CE1 broadcasts an ARP request" }] }),
  },
  {
    id: "pe1-flood-broadcast",
    label: "PE1: Broadcast Is Always Flooded",
    narrative: `Classification: BROADCAST — no FDB lookup even attempted. PE1 floods to every eligible port except ingress: [PW: PE2, PW: PE3]. PE2 and PE3 each further flood to their own local AC (split horizon still blocks PW-to-PW relay) — CE2 and CE3 both receive the ARP request.`,
    run: (state) => {
      const ports = portsFor(state, "PE1");
      const ingress: FdbPort = { kind: "AC", peer: "CE1" };
      const lookup = lookupDestinationMac(fdbFor(state, "PE1"), BROADCAST_MAC);
      const raw = computeVplsEgressSet(ports, ingress, lookup);
      const final = applySplitHorizon(raw, ingress);
      const journey = [{ device: "PE1" as RouterId, input: BROADCAST_MAC, lookup: "Classification: BROADCAST — always flooded, never learned as a destination", action: "REPLICATE" as JourneyAction, output: `Flood to: ${final.map(portLabel).join(", ")}` }];
      return { state: { ...state, journey, floodCopies: [{ id: "fc-bcast-pe2", fromPe: "PE1", toPe: "PE2" }, { id: "fc-bcast-pe3", fromPe: "PE1", toPe: "PE3" }], lastDecision: "BROADCAST" }, events: [] };
    },
    whatChanged: () => ["PE1: broadcast flooded to PW: PE2 and PW: PE3 — CE2 and CE3 both receive it"],
  },
  {
    id: "bum-comparison-panel",
    label: "BUM, Summarized",
    narrative: "Broadcast / Unknown-unicast / Multicast (BUM) all share the same VPLS treatment: replicate to every eligible bridge port except ingress, subject to split horizon on PW ingress. Known unicast is the one case that gets a single, direct copy — which is exactly what you'll see next.",
  },
  {
    id: "ce2-response-intro",
    label: "CE2 Responds",
    narrative: "CE2 answers CE1's ARP request directly — a unicast frame, destination MAC CE1's address. This return frame is the moment PE2 (and eventually PE1) get to prove out known-unicast forwarding.",
  },
  {
    id: "ce2-sends-to-ce1",
    label: "CE2 Sends A Unicast Frame To CE1",
    narrative: `CE2 sends Src ${CE_MAC.CE2}, Dst ${CE_MAC.CE1}. PE2 receives it on its AC.`,
    packet: () => ({ id: "ce2-frame", protocol: "IP", from: "CE2", to: "CE2", summary: "Ethernet frame toward CE1", layers: [ethLayer(ceFrame("CE2", "CE1", "ARP reply — CE2 to CE1"))] }),
    run: (state) => ({ state: { ...state, packet: { frame: ceFrame("CE2", "CE1", "ARP reply — CE2 to CE1"), labels: [] }, packetAt: "CE2", journey: [], floodCopies: undefined }, events: [{ type: "PACKET_SENT", stepId: "ce2-sends-to-ce1", timestamp: Date.now(), message: "CE2 sends Ethernet frame toward CE1" }] }),
  },
  {
    id: "pe2-learn-ce2-local",
    label: "PE2: Learn CE2, Look Up CE1",
    narrative: `PE2 learns ${CE_MAC.CE2} → AC: CE2. It then looks up ${CE_MAC.CE1} — already known from the earlier flood: → PW: PE1 (REMOTE_UNICAST). No flooding required this time.`,
    packet: (state) => (state.packet ? vplsPacket("pe2-ac-in", "CE2", "PE2", "Ethernet frame", "AC", state.packet) : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const { fdb } = learnSourceMac(fdbFor(state, "PE2"), CE_MAC.CE2, { kind: "AC", peer: "CE2" });
      const lookup = lookupDestinationMac(fdb, CE_MAC.CE1);
      const journey = [{ device: "PE2" as RouterId, input: "Ethernet frame (unlabeled)", lookup: `Learn ${CE_MAC.CE2} on AC: CE2; look up ${CE_MAC.CE1}`, action: "LEARN_SOURCE" as JourneyAction, output: `${lookup.kind} — ${lookup.kind !== "UNKNOWN_UNICAST" && lookup.kind !== "BROADCAST" && lookup.kind !== "MULTICAST" ? portLabel(lookup.port) : ""}` }];
      return { state: { ...state, packetAt: "PE2", journey, fdb: { ...state.fdb, PE2: fdb }, lastDecision: "REMOTE_UNICAST" }, events: [{ type: "MAC_LEARNED", stepId: "pe2-learn-ce2-local", timestamp: Date.now(), message: `PE2 learns ${CE_MAC.CE2} on AC: CE2` }] };
    },
    whatChanged: () => [`PE2 FDB: + ${CE_MAC.CE2} → AC: CE2`, `Lookup for ${CE_MAC.CE1}: REMOTE_UNICAST → PW: PE1 (already known)`],
  },
  {
    id: "pe2-direct-to-pe1",
    label: "PE2: Known Unicast — One Copy, Direct",
    narrative: `Unlike the earlier flood, this frame gets exactly ONE copy: PE2 pushes PE1's advertised PW label ${allocatePwReceiveLabel("PE1", "PE2")} and transport label ${transportLabelFor("P2", "PE1")}, sending it straight to PE1 over the reverse path. PE3 never sees this frame at all.`,
    packet: (state) => (state.packet ? vplsPacket("pe2-push", "PE2", "P2", "PUSH PW + transport (known unicast)", "PUSH", state.packet) : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const withPw = pushLabel(state.packet, allocatePwReceiveLabel("PE1", "PE2"), "service");
      const withTransport = pushLabel(withPw, transportLabelFor("P2", "PE1"), "transport");
      const journey = [...state.journey, { device: "PE2" as RouterId, input: "Ethernet frame", lookup: "Known unicast — single direct copy toward PW: PE1", action: "PUSH_PW" as JourneyAction, output: `label ${transportLabelFor("P2", "PE1")} (transport) + label ${allocatePwReceiveLabel("PE1", "PE2")} (service)` }];
      return { state: { ...state, packetAt: "P2", packet: withTransport, journey }, events: [{ type: "VPN_LABEL_PUSHED", stepId: "pe2-direct-to-pe1", timestamp: Date.now(), message: "PE2 pushes labels for known-unicast delivery to PE1" }] };
    },
    whatChanged: () => ["Exactly one copy leaves PE2 — no flooding, no replication"],
  },
  {
    id: "pe1-learn-ce2-remote",
    label: "PE1: Deliver, And Learn CE2",
    narrative: `The core forwards via P2 → P1 (PHP at P1), PE1 resolves the PW label, learns ${CE_MAC.CE2} → PW: PE2, and delivers to CE1 over its AC. Both directions are now fully learned at both PEs.`,
    packet: (state) => (state.packet ? { id: "pe1-deliver", protocol: "IP", from: "PE1", to: "PE1", summary: "Delivered to CE1", layers: [ethLayer(deliverEthernetFrame(state.packet))] } : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const afterP2 = processCoreTransportLabel(state.packet, transportLabelFor("P1", "PE1"));
      const afterP1 = processCoreTransportLabel(afterP2, "IMPLICIT_NULL");
      const { fdb } = learnSourceMac(fdbFor(state, "PE1"), CE_MAC.CE2, { kind: "PW", peer: "PE2" });
      const journey = [
        ...state.journey,
        { device: "P2" as RouterId, input: `label ${transportLabelFor("P2", "PE1")}`, lookup: "Transport forwarding — outer label only", action: "SWAP_TRANSPORT" as JourneyAction, output: `label ${transportLabelFor("P1", "PE1")} (transport)` },
        { device: "PE1" as RouterId, input: `label ${allocatePwReceiveLabel("PE1", "PE2")}`, lookup: `PW label → ${SERVICE_NAME}; learn ${CE_MAC.CE2} on PW: PE2; deliver to AC: CE1`, action: "PW_LOOKUP" as JourneyAction, output: "Delivered to CE1" },
      ];
      return { state: { ...state, packetAt: "CE1", packet: popTopLabel(afterP1), journey, fdb: { ...state.fdb, PE1: fdb } }, events: [{ type: "VPN_PACKET_DELIVERED", stepId: "pe1-learn-ce2-remote", timestamp: Date.now(), message: "PE1 delivers to CE1 and learns CE2 remotely" }] };
    },
    whatChanged: () => [`PE1 FDB: + ${CE_MAC.CE2} → PW: PE2`, "CE1 receives the reply — the round trip is complete"],
  },
  {
    id: "signature-mac-learning-sequence",
    label: "The Signature Sequence, Recapped",
    narrative: "FIRST FRAME: PE1 floods (unknown), PE2 and PE3 both learn CE1, only CE2 accepts. RETURN FRAME: PE2 already knows CE1 — a direct, single copy, no flooding. NEXT FRAME: with both directions learned, CE1 → CE2 traffic becomes known unicast too, end to end. Flooding is how the bridge discovers reachability; learning is what makes it efficient afterward.",
  },
  {
    id: "send-ce1-to-ce2-2-known",
    label: "CE1 Sends To CE2 Again — Now Known",
    narrative: `Same destination as the very first frame, ${CE_MAC.CE2} — but this time PE1's FDB already has it: → PW: PE2. Classification: REMOTE_UNICAST.`,
    packet: () => ({ id: "ce1-frame-2", protocol: "IP", from: "CE1", to: "CE1", summary: "Ethernet frame toward CE2 (known)", layers: [ethLayer(ceFrame("CE1", "CE2", "Second frame — CE1 to CE2, now known"))] }),
    run: (state) => ({ state: { ...state, packet: { frame: ceFrame("CE1", "CE2", "Second frame — CE1 to CE2, now known"), labels: [] }, packetAt: "CE1", journey: [], floodCopies: undefined }, events: [{ type: "PACKET_SENT", stepId: "send-ce1-to-ce2-2-known", timestamp: Date.now(), message: "CE1 sends a second frame toward CE2" }] }),
  },
  {
    id: "pe1-known-unicast-direct",
    label: "PE1: Known Unicast — No Flood, No PE3 Copy",
    narrative: `PE1 looks up ${CE_MAC.CE2}: REMOTE_UNICAST → PW: PE2. Exactly one copy is pushed toward PE2. PE3 receives nothing this time — the efficiency gain flooding's whole purpose was building toward.`,
    packet: (state) => (state.packet ? vplsPacket("known-push", "PE1", "P1", "PUSH PW + transport (known unicast)", "PUSH", state.packet) : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const lookup = lookupDestinationMac(fdbFor(state, "PE1"), CE_MAC.CE2);
      const withPw = pushLabel(state.packet, allocatePwReceiveLabel("PE2", "PE1"), "service");
      const withTransport = pushLabel(withPw, transportLabelFor("P1", "PE2"), "transport");
      const journey = [{ device: "PE1" as RouterId, input: CE_MAC.CE2, lookup: `FDB hit: ${lookup.kind}`, action: "PUSH_PW" as JourneyAction, output: `Single copy toward PW: PE2 — no PW: PE3 copy` }];
      return { state: { ...state, packetAt: "P1", packet: withTransport, journey, lastDecision: "REMOTE_UNICAST" }, events: [] };
    },
    whatChanged: () => ["No flood copy created for PE3 — known unicast is a single, direct delivery"],
  },
  {
    id: "mac-table-per-pe",
    label: "Three Independent MAC Tables",
    narrative: "PE1, PE2, and PE3 each maintain their OWN FDB — there is no shared or synchronized table. PE1 knows CE1 (local) and CE2 (remote via PE2). PE2 knows CE2 (local) and CE1 (remote via PE1). PE3 only knows CE1 so far — it has never seen a frame sourced from CE2, because split horizon has kept CE2's traffic from ever reaching it.",
  },
  {
    id: "data-plane-vs-control-plane",
    label: "Data-Plane Learning, Not Control-Plane",
    narrative: "Every entry you've seen was learned by observing real traffic — never by a control-plane MAC advertisement. This is traditional VPLS's defining characteristic, and exactly what later EVPN designs replace with BGP-advertised MAC/IP routes.",
  },
  {
    id: "mac-aging-intro",
    label: "MAC Aging",
    narrative: "FDB entries aren't permanent. If a MAC stops sourcing traffic for the aging interval, the entry is removed — the bridge \"forgets\" it, and the next frame to that destination becomes unknown-unicast again.",
  },
  {
    id: "age-ce2-entry",
    label: "Lab: Age Out CE2 At PE1",
    narrative: `Simulating a full aging timeout: PE1 removes its ${CE_MAC.CE2} → PW: PE2 entry entirely.`,
    run: (state) => ({ state: { ...state, fdb: { ...state.fdb, PE1: ageMacEntry(fdbFor(state, "PE1"), CE_MAC.CE2) } }, events: [] }),
    whatChanged: () => [`PE1 FDB: − ${CE_MAC.CE2} (aged out)`],
  },
  {
    id: "send-after-aging-unknown-again",
    label: "Send CE1 → CE2 Again — Unknown Once More",
    narrative: `With the entry gone, PE1's next frame toward ${CE_MAC.CE2} is UNKNOWN_UNICAST again — it floods to PW: PE2 AND PW: PE3, exactly like the very first frame did. Aging doesn't just clean up state — it directly changes forwarding behavior.`,
    run: (state) => {
      const lookup = lookupDestinationMac(fdbFor(state, "PE1"), CE_MAC.CE2);
      return { state: { ...state, lastDecision: lookup.kind === "UNKNOWN_UNICAST" ? "UNKNOWN_UNICAST" : state.lastDecision }, events: [] };
    },
    whatChanged: () => [`Lookup for ${CE_MAC.CE2} at PE1: UNKNOWN_UNICAST (relearning required)`],
  },
  {
    id: "relearn-after-flood",
    label: "Relearning Restores Efficiency",
    narrative: "The very next flood/response cycle relearns the entry (exactly as in the first-frame walkthrough), and known-unicast delivery resumes. Aging is a normal, continuous part of VPLS operation — not a fault.",
    run: (state) => {
      const { fdb } = learnSourceMac(fdbFor(state, "PE1"), CE_MAC.CE2, { kind: "PW", peer: "PE2" });
      return { state: { ...state, fdb: { ...state.fdb, PE1: fdb } }, events: [] };
    },
    whatChanged: () => [`PE1 FDB: + ${CE_MAC.CE2} → PW: PE2 (relearned)`],
  },
  {
    id: "mac-move-intro",
    label: "MAC Movement: A Host Relocates",
    narrative: "Now suppose CE2's host physically moves — reconnected behind PE3 instead of PE2 (a live migration, a reconfigured uplink, whatever the real cause). Traditional VPLS has no special mobility protocol for this: it just relearns, the same \"newest observed source wins\" mechanism you've already seen, with no sequence numbers involved.",
  },
  {
    id: "move-ce2-to-pe3",
    label: `CE2 Sends A Frame — Now Via PE3`,
    narrative: `A frame sourced from ${CE_MAC.CE2} arrives at PE3 on its AC (CE2 is now local there). PE3 had no entry for ${CE_MAC.CE2} before — this is a NEW learn from PE3's perspective, but a MOVE from the mesh's overall point of view.`,
    packet: () => ({ id: "ce2-moved", protocol: "IP", from: "CE2", to: "CE2", summary: "Ethernet frame from relocated CE2", layers: [ethLayer(ceFrame("CE2", "CE1", "CE2 has moved to PE3"))] }),
    run: (state) => {
      const { fdb, change } = learnSourceMac(fdbFor(state, "PE3"), CE_MAC.CE2, { kind: "AC", peer: "CE3" });
      return { state: { ...state, fdb: { ...state.fdb, PE3: fdb }, packet: { frame: ceFrame("CE2", "CE1", "CE2 has moved to PE3"), labels: [] }, packetAt: "PE3", journey: [{ device: "PE3" as RouterId, input: "Ethernet frame (unlabeled)", lookup: `Learn source ${CE_MAC.CE2} on AC: CE3`, action: "AC_INGRESS" as JourneyAction, output: `FDB[PE3]: ${CE_MAC.CE2} → AC: CE3 (${change})` }] }, events: [{ type: "MAC_LEARNED", stepId: "move-ce2-to-pe3", timestamp: Date.now(), message: `PE3 learns ${CE_MAC.CE2} on AC: CE3` }] };
    },
    whatChanged: () => [`PE3 FDB: + ${CE_MAC.CE2} → AC: CE3`],
  },
  {
    id: "mac-move-demonstrate",
    label: "PE1 Relearns The Move",
    narrative: `This frame reaches PE1 (flooded, since PE1 still thinks ${CE_MAC.CE2} is behind PE2 — but it's carried on the PW: PE3 ingress port now). PE1's learnSourceMac call sees a DIFFERENT port for an already-known MAC — a MOVE, not a fresh learn: ${CE_MAC.CE2} updates from PW: PE2 to PW: PE3, with no sequence-number comparison of any kind. Whichever port most recently sourced a MAC simply wins.`,
    run: (state) => {
      const { fdb, previousPort } = moveMacEntry(fdbFor(state, "PE1"), CE_MAC.CE2, { kind: "PW", peer: "PE3" });
      return { state: { ...state, fdb: { ...state.fdb, PE1: fdb } }, events: [{ type: "MAC_LEARNED", stepId: "mac-move-demonstrate", timestamp: Date.now(), message: `PE1 relearns ${CE_MAC.CE2} — moved from ${previousPort ? portLabel(previousPort) : "unknown"} to PW: PE3` }] };
    },
    whatChanged: () => [`PE1 FDB: ${CE_MAC.CE2} moved PW: PE2 → PW: PE3`],
  },
  {
    id: "mac-move-recap",
    label: "No Sequence Numbers Here",
    narrative: "Compare this to EVPN's MAC Mobility extended community, which uses an explicit sequence number specifically to resolve races between two PEs simultaneously claiming the same MAC. Traditional VPLS has no such protection — it purely trusts the most recently observed source, which is simpler but can flap under pathological conditions EVPN was partly designed to fix.",
  },
  {
    id: "mac-withdrawal-note",
    label: "Advanced: LDP MAC Address Withdrawal",
    narrative: "Real VPLS deployments can proactively flush stale FDB entries mesh-wide using LDP MAC Address Withdrawal messages — faster convergence than waiting for aging after a topology change. Named here as an advanced mechanism; this lesson does not simulate it.",
  },
  {
    id: "predict-remote-learn",
    label: "Predict",
    narrative: "Before continuing:",
    question: {
      prompt: "How does a PE learn that a remote MAC lives behind a specific pseudowire?",
      options: [
        { id: "observe-pw-traffic", label: "By observing the source MAC of frames arriving on that PW — the same learning logic used for local ACs" },
        { id: "ldp-advertisement", label: "Targeted LDP explicitly advertises which MACs are reachable over each PW" },
        { id: "arp-snooping", label: "By snooping ARP replies traversing the core" },
        { id: "manual-config", label: "An operator must manually configure each remote MAC-to-PW mapping" },
      ],
      correctOptionId: "observe-pw-traffic",
      explanation: "Traditional VPLS treats a pseudowire ingress exactly like any other bridge port for learning purposes — the source MAC of any arriving frame is learned against whichever port it arrived on, AC or PW alike. No separate signaling mechanism is involved.",
    },
  },
  {
    id: "predict-aging-behavior",
    label: "Predict",
    narrative: "Before continuing:",
    question: {
      prompt: "An FDB entry ages out. What happens to the NEXT frame sent to that MAC?",
      options: [
        { id: "flood-again", label: "It's treated as unknown-unicast and flooded again, exactly like the very first frame ever sent to that destination" },
        { id: "dropped", label: "It's dropped until manually relearned" },
        { id: "sent-last-known-port", label: "It's still sent to the last-known port, just without refreshing the timer" },
        { id: "control-plane-lookup", label: "PE queries a control-plane MAC directory before forwarding" },
      ],
      correctOptionId: "flood-again",
      explanation: "There is no memory of a MAC's last-known location once its FDB entry ages out — reachability information is purely data-plane and purely current. The bridge floods until it relearns, exactly as demonstrated.",
    },
  },
  {
    id: "vpls-vs-vpws-comparison",
    label: "Traditional VPLS vs. Traditional VPWS",
    narrative: "VPWS: one pseudowire, exactly two endpoints, no MAC learning at all — the PE just switches frames blindly between AC and PW. VPLS: full-mesh pseudowires, a per-PE virtual bridge, real MAC learning, flooding for unknown/broadcast/multicast, and split horizon to prevent PW-mesh loops. VPLS is built directly out of VPWS's PW primitives — but adds an entirely new bridging layer on top.",
  },
  {
    id: "vpls-vs-evpn-comparison",
    label: "Traditional VPLS vs. EVPN",
    narrative: "Traditional VPLS: LDP-signaled full mesh, data-plane MAC learning, flooding-based discovery, PW split horizon. EVPN: BGP-signaled, MAC/IP routes carried and withdrawn via control-plane advertisements, ARP suppression to reduce flooding, sequence-numbered MAC mobility, and (usually) VXLAN or MPLS with a very different, more scalable discovery model. Neither replaces the other conceptually — EVPN was built to solve real operational pain points in exactly this traditional VPLS design (flooding-dependent discovery, slow mobility convergence, N² PW scaling).",
  },
  {
    id: "why-evpn-developed",
    label: "Why EVPN Was Developed",
    narrative: "Three concrete pain points this lesson just demonstrated map directly to EVPN's design goals: (1) full-mesh PW signaling doesn't scale past a modest PE count — EVPN uses BGP route reflection instead; (2) discovery depends entirely on flooding — EVPN's Type 2 routes advertise MAC reachability directly; (3) MAC mobility has no protection against stale relearns — EVPN's sequence number fixes exactly that race.",
  },
  {
    id: "troubleshooting-intro",
    label: "INCIDENT",
    narrative: "CE1 can reach CE2 fine. CE2 can reach CE3 fine. But CE1 cannot reach CE3. Transport is UP everywhere, targeted LDP is OPERATIONAL, and all three ACs are UP.",
    run: (state) => ({ state: { ...state, troubleshooting: { ...state.troubleshooting, started: true } }, events: [] }),
  },
  {
    id: "fault-injection",
    label: "Fault: PW PE1-PE3 Goes Down",
    narrative: "The direct pseudowire between PE1 and PE3 has failed — a real, deterministic operational fault (could be a targeted-LDP session reset, an LSP failure, or a misconfiguration; the mesh model doesn't need to distinguish which). PW PE1-PE2 and PW PE2-PE3 remain healthy.",
    run: (state) => ({ state: { ...state, pwLinks: state.pwLinks.map((l) => (l.id === "PE1-PE3" ? { ...l, up: false } : l)), fdb: { PE1: [], PE2: [], PE3: [] }, journey: [], packet: undefined, packetAt: undefined, floodCopies: undefined }, events: [{ type: "LDP_SESSION_RESET", stepId: "fault-injection", timestamp: Date.now(), message: "PW PE1-PE3 goes DOWN" }] }),
    whatChanged: () => ["PW PE1-PE3: UP → DOWN", "FDB tables reset for a clean diagnostic run"],
  },
  {
    id: "incident-symptoms",
    label: "Why CE1 ↔ CE2 And CE2 ↔ CE3 Still Work",
    narrative: "PE1-PE2 and PE2-PE3 are both still UP — so any traffic that can transit VIA PE2 keeps working. Only traffic that would have needed the PE1-PE3 direct leg is affected. Since PE1 has no PW to PE3 at all, and split horizon forbids PE2 from relaying PE1's traffic onward, CE1 ↔ CE3 has no path left — even though PE2 sits right between them.",
  },
  {
    id: "diagnostic-ladder",
    label: "Diagnose Before You Fix",
    narrative: "Work the ladder: Is transport reachable? Is targeted LDP operational mesh-wide? Are all three ACs up? Is each individual PW's FEC match and label state healthy? Check every mesh leg individually — don't assume the whole mesh is one unit.",
  },
  {
    id: "demonstrate-fault",
    label: "Demonstrate: CE1 → CE3, Unknown Destination",
    narrative: `Send a fresh frame CE1 → CE3. PE1 floods (unknown) — but PE1's only bridge ports are AC: CE1 and PW: PE2 (PW: PE3 doesn't exist right now, it's down). The flood copy goes only to PE2.`,
    packet: () => ({ id: "fault-frame", protocol: "IP", from: "CE1", to: "CE1", summary: "Ethernet frame toward CE3", layers: [ethLayer(ceFrame("CE1", "CE3", "CE1 to CE3 — during the incident"))] }),
    run: (state) => {
      const ports = portsFor(state, "PE1");
      const ingress: FdbPort = { kind: "AC", peer: "CE1" };
      const { fdb } = learnSourceMac(fdbFor(state, "PE1"), CE_MAC.CE1, ingress);
      const lookup = lookupDestinationMac(fdb, CE_MAC.CE3);
      const raw = computeVplsEgressSet(ports, ingress, lookup);
      const final = applySplitHorizon(raw, ingress);
      const journey = [{ device: "PE1" as RouterId, input: "Ethernet frame", lookup: `Bridge ports: [${ports.map(portLabel).join(", ")}] — PW: PE3 absent (link down)`, action: "REPLICATE" as JourneyAction, output: `Flood to: ${final.map(portLabel).join(", ")}` }];
      return { state: { ...state, packet: { frame: ceFrame("CE1", "CE3", "CE1 to CE3 — during the incident"), labels: [] }, packetAt: "PE1", journey, fdb: { ...state.fdb, PE1: fdb }, floodCopies: [{ id: "fc-fault-pe2", fromPe: "PE1", toPe: "PE2" }], lastDecision: "UNKNOWN_UNICAST" }, events: [] };
    },
    whatChanged: () => ["PE1 floods to PW: PE2 only — no PW: PE3 exists to flood onto"],
  },
  {
    id: "signature-fault-visual",
    label: "PE2 Receives It — And Cannot Relay",
    narrative: `PE2 learns ${CE_MAC.CE1} → PW: PE1. It looks up ${CE_MAC.CE3}: UNKNOWN_UNICAST. Raw egress = [AC: CE2, PW: PE3]. But the frame ingressed on a mesh PW — split horizon strips PW: PE3 from the final egress set. Final egress = [AC: CE2] only. Decision: SPLIT_HORIZON_BLOCKED for the PW: PE3 leg. CE3 never receives this frame — not because PE2 doesn't know it exists, but because relaying PW-to-PW is categorically forbidden.`,
    packet: (state) => (state.packet ? vplsPacket("fault-pe2-in", "P2", "PE2", "PW label lookup", "PW", state.packet) : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const { fdb } = learnSourceMac(fdbFor(state, "PE2"), CE_MAC.CE1, { kind: "PW", peer: "PE1" });
      const ports = portsFor(state, "PE2");
      const ingress: FdbPort = { kind: "PW", peer: "PE1" };
      const lookup = lookupDestinationMac(fdb, CE_MAC.CE3);
      const raw = computeVplsEgressSet(ports, ingress, lookup);
      const final = applySplitHorizon(raw, ingress);
      const decision = classifyForwardingDecision(lookup, raw, final);
      const journey = [...state.journey, { device: "PE2" as RouterId, input: `label ${allocatePwReceiveLabel("PE2", "PE1")}`, lookup: `Egress set: [${raw.map(portLabel).join(", ")}] → split horizon strips PW ports → [${final.map(portLabel).join(", ")}]`, action: "SPLIT_HORIZON_BLOCK" as JourneyAction, output: `${CE_MAC.CE3} unreachable via PE2 — CE3 never sees this frame` }];
      return { state: { ...state, packetAt: "PE2", journey, fdb: { ...state.fdb, PE2: fdb }, lastDecision: decision }, events: [{ type: "PACKET_DROPPED", stepId: "signature-fault-visual", timestamp: Date.now(), message: "PE2 cannot relay PW-ingress frame onto PW: PE3 — split horizon" }] };
    },
    whatChanged: () => ["Decision: SPLIT_HORIZON_BLOCKED — CE3 does not receive the frame"],
  },
  {
    id: "repair-challenge",
    label: "Engineer Challenge: Restore CE1 ↔ CE3",
    narrative: "Choose the correct repair.",
    action: (state, payload) => {
      const choice = (payload as { choice?: string } | undefined)?.choice ?? "";
      if (choice !== "restore-pw-pe1-pe3") {
        return { state: { ...state, troubleshooting: { ...state.troubleshooting, repairAttempt: { choice, correct: false } } }, events: [] };
      }
      return {
        state: {
          ...state,
          pwLinks: state.pwLinks.map((l) => (l.id === "PE1-PE3" ? { ...l, up: true } : l)),
          troubleshooting: { ...state.troubleshooting, repairAttempt: { choice, correct: true }, repaired: true },
        },
        events: [{ type: "VPN_ROUTE_INSTALLED", stepId: "repair-challenge", timestamp: Date.now(), message: "PW PE1-PE3 restored to UP" }],
      };
    },
    requiresState: (state) => state.troubleshooting.repaired === true,
  },
  {
    id: "repaired-recompute",
    label: "PW PE1-PE3 Restored — Full Mesh Intact",
    narrative: "All three mesh legs are UP again. But recomputation alone isn't proof of a fix — verify with a real frame next.",
    run: (state) => ({ state: { ...state, packet: undefined, packetAt: undefined, journey: [], floodCopies: undefined, fdb: { PE1: [], PE2: [], PE3: [] } }, events: [] }),
    whatChanged: () => ["FDB cleared for a clean verification run"],
  },
  {
    id: "verify-send-ce1-ce3",
    label: "Mandatory Verification: Resend CE1 → CE3",
    narrative: "Send a real frame end to end and follow it through every hop — the same discipline used after the VPWS PW ID repair.",
    packet: () => ({ id: "verify-frame", protocol: "IP", from: "CE1", to: "CE1", summary: "Ethernet frame toward CE3 (verification)", layers: [ethLayer(ceFrame("CE1", "CE3", "Verification — CE1 to CE3"))] }),
    run: (state) => {
      const { fdb } = learnSourceMac(fdbFor(state, "PE1"), CE_MAC.CE1, { kind: "AC", peer: "CE1" });
      return { state: { ...state, packet: { frame: ceFrame("CE1", "CE3", "Verification — CE1 to CE3"), labels: [] }, packetAt: "PE1", journey: [], fdb: { ...state.fdb, PE1: fdb } }, events: [] };
    },
  },
  {
    id: "verify-push-deliver",
    label: "PE1: Flood To Both — Including PE3 Again",
    narrative: `${CE_MAC.CE3} is still unknown, so PE1 floods to BOTH PW: PE2 and PW: PE3 now that PW: PE3 genuinely exists again.`,
    packet: (state) => (state.packet ? vplsPacket("verify-flood", "PE1", "PE1", "Replicate: 2 copies", "FLOOD", state.packet) : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const withPw = pushLabel(state.packet, allocatePwReceiveLabel("PE3", "PE1"), "service");
      const withTransport = pushLabel(withPw, transportLabelFor("P1", "PE3"), "transport");
      const journey = [{ device: "PE1" as RouterId, input: "Ethernet frame", lookup: "Bridge ports restored: [AC: CE1, PW: PE2, PW: PE3]", action: "PUSH_PW" as JourneyAction, output: `Flood to PW: PE2 and PW: PE3 — label ${transportLabelFor("P1", "PE3")} + ${allocatePwReceiveLabel("PE3", "PE1")} toward PE3` }];
      return { state: { ...state, packetAt: "P1", packet: withTransport, journey, floodCopies: [{ id: "fc-verify-pe2", fromPe: "PE1", toPe: "PE2" }, { id: "fc-verify-pe3", fromPe: "PE1", toPe: "PE3" }] }, events: [] };
    },
  },
  {
    id: "verify-known-unicast-after-learning",
    label: "PE3 Delivers To CE3 — Verified",
    narrative: "P1 swaps toward P3, PHP pops at P3, PE3 resolves the PW label, learns CE1 on PW: PE1, and floods to its own AC — CE3 finally receives the frame. The repaired direct pseudowire, not split-horizon relaxation, is what fixed this.",
    packet: (state) => (state.packet ? { id: "verify-delivered", protocol: "IP", from: "PE3", to: "PE3", summary: "Delivered to CE3 (verified)", layers: [ethLayer(deliverEthernetFrame(state.packet))] } : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const afterP1 = processCoreTransportLabel(state.packet, transportLabelFor("P3", "PE3"));
      const afterP3 = processCoreTransportLabel(afterP1, "IMPLICIT_NULL");
      const { fdb } = learnSourceMac(fdbFor(state, "PE3"), CE_MAC.CE1, { kind: "PW", peer: "PE1" });
      const journey = [
        ...state.journey,
        { device: "P1" as RouterId, input: `label ${transportLabelFor("P1", "PE3")}`, lookup: "Transport forwarding", action: "SWAP_TRANSPORT" as JourneyAction, output: `label ${transportLabelFor("P3", "PE3")}` },
        { device: "PE3" as RouterId, input: `label ${allocatePwReceiveLabel("PE3", "PE1")}`, lookup: `PW label → ${SERVICE_NAME}; learn ${CE_MAC.CE1} on PW: PE1; flood to AC: CE3`, action: "AC_EGRESS" as JourneyAction, output: "Delivered to CE3" },
      ];
      return { state: { ...state, packetAt: "CE3", packet: popTopLabel(afterP3), journey, fdb: { ...state.fdb, PE3: fdb }, troubleshooting: { ...state.troubleshooting, verified: true } }, events: [{ type: "VPN_PACKET_DELIVERED", stepId: "verify-known-unicast-after-learning", timestamp: Date.now(), message: "Verified: repaired PW PE1-PE3 restores CE1 ↔ CE3" }] };
    },
    whatChanged: () => ["Verified: CE1 → PE1 → P1 → P3 → PE3 → CE3 restored end to end"],
  },
  {
    id: "engineer-challenge-intro",
    label: "Engineer Challenge: Build The Virtual LAN",
    narrative: `Recap and confirm: turn ${SERVICE_NAME} into a genuine multipoint Ethernet LAN across PE1, PE2, and PE3. Everything below was already demonstrated in this lesson — this is the checklist.`,
  },
  {
    id: "engineer-challenge-confirm",
    label: "Confirm Full Virtual-LAN Coverage",
    narrative: "Provider transport verified ✓ · Targeted LDP mesh OPERATIONAL ✓ · VPLS bridge context defined at every PE ✓ · Full-mesh pseudowires established (3 PWs, 6 directional labels) ✓ · Source MAC learning observed on AC and PW ingress alike ✓ · Unknown-unicast flooding with real replication demonstrated ✓ · Pseudowire split horizon demonstrated blocking a PW-to-PW relay ✓ · Known-unicast single-copy delivery demonstrated ✓ · MAC aging and relearning demonstrated ✓ · MAC movement relearned without any sequence-number mechanism ✓ · Missing PW-PE1-PE3 incident diagnosed and correctly repaired — never by disabling split horizon ✓ · Repair verified with a real end-to-end frame ✓.",
    requiresState: (state) => state.troubleshooting.verified === true,
  },
  {
    id: "complete",
    label: "Complete",
    narrative: `You turned VPWS's point-to-point pseudowires into a genuine multipoint VPLS bridge: a full mesh of pseudowires, per-PE virtual switching instances, real data-plane MAC learning, BUM flooding, and the pseudowire split-horizon rule that makes the whole mesh loop-free. You diagnosed a missing mesh leg by its exact symptom — one working direction, one categorically blocked — and repaired it the correct way, never by weakening split horizon. +${VPLS_XP_AWARD} XP awarded.`,
  },
];

function stepIdx(id: string): number {
  return mplsVplsSteps.findIndex((s) => s.id === id);
}
export const STEP_IDX = {
  topologyIntro: stepIdx("topology-intro"),
  vplsServiceInstance: stepIdx("vpls-service-instance"),
  transportRecapIntro: stepIdx("transport-recap-intro"),
  transportLspUp: stepIdx("transport-lsp-up"),
  targetedLdpIntro: stepIdx("targeted-ldp-intro"),
  targetedLdpOperational: stepIdx("targeted-ldp-operational"),
  establishPwPe1Pe2: stepIdx("establish-pw-pe1-pe2"),
  establishPwPe1Pe3: stepIdx("establish-pw-pe1-pe3"),
  establishPwPe2Pe3: stepIdx("establish-pw-pe2-pe3"),
  fullMeshVisual: stepIdx("full-mesh-visual"),
  macLearningIntro: stepIdx("mac-learning-intro"),
  sendCe1ToCe21: stepIdx("send-ce1-to-ce2-1"),
  pe1FloodDecision: stepIdx("pe1-flood-decision"),
  pe2DeliverCe2: stepIdx("pe2-deliver-ce2"),
  splitHorizonVisual: stepIdx("split-horizon-visual"),
  broadcastIntro: stepIdx("broadcast-intro"),
  sendCe1ToCe22Known: stepIdx("send-ce1-to-ce2-2-known"),
  macAgingIntro: stepIdx("mac-aging-intro"),
  macMoveIntro: stepIdx("mac-move-intro"),
  vplsVsVpwsComparison: stepIdx("vpls-vs-vpws-comparison"),
  vplsVsEvpnComparison: stepIdx("vpls-vs-evpn-comparison"),
  troubleshootingIntro: stepIdx("troubleshooting-intro"),
  faultInjection: stepIdx("fault-injection"),
  diagnosticLadder: stepIdx("diagnostic-ladder"),
  repairChallenge: stepIdx("repair-challenge"),
  engineerChallengeIntro: stepIdx("engineer-challenge-intro"),
  complete: stepIdx("complete"),
};

// ---------------------------------------------------------------------------
// CLI perspectives — CONCEPT / Cisco IOS-XR / Junos.
// ---------------------------------------------------------------------------
export interface VplsCliVendorOutput {
  cmd: string;
  output: string;
}
export interface VplsCliEntry {
  id: string;
  label: string;
  concept: string;
  cisco: VplsCliVendorOutput;
  juniper: VplsCliVendorOutput;
}
export function buildVplsCliCommands(state: MplsVplsState, router: RouterId): VplsCliEntry[] {
  const ac = resolveAttachmentCircuit(state.acs, router);
  const fdb = fdbFor(state, router);
  const peers = pwPeersOf(router);
  const pwLines = peers.map((peer) => `${router}-${peer}: ${pwUpBetween(state.pwLinks, router, peer) ? "UP" : "DOWN"} — local label ${allocatePwReceiveLabel(router, peer)}, remote label ${allocatePwReceiveLabel(peer, router)}`);
  return [
    {
      id: "targeted-ldp",
      label: "Targeted LDP Mesh",
      concept: "One targeted LDP session per PE pair, all sharing this lesson's simplified mesh-wide readiness state.",
      cisco: { cmd: `show mpls ldp neighbor detail`, output: `Mesh state: ${state.targetedLdp}\nPeers: ${peers.map((p) => ROUTER_LOOPBACK[p] ?? p).join(", ")}` },
      juniper: { cmd: `show ldp session`, output: `mesh-state ${state.targetedLdp.toLowerCase()};\npeers ${peers.map((p) => ROUTER_LOOPBACK[p] ?? p).join(", ")};` },
    },
    {
      id: "pw-mesh",
      label: "Pseudowire Mesh",
      concept: "Every mesh PW this router participates in, with its own directional labels — never a single shared label for the whole service.",
      cisco: { cmd: `show mpls l2transport vc`, output: pwLines.join("\n") || "(not a PE)" },
      juniper: { cmd: `show vpls connections`, output: pwLines.join("\n") || "(not a PE)" },
    },
    {
      id: "ac",
      label: "Attachment Circuit",
      concept: "The local customer-facing interface this VPLS bridge context binds to.",
      cisco: { cmd: `show interfaces ${ac?.interfaceName ?? "unknown"}`, output: ac ? `Interface: ${ac.interfaceName}\nVLAN: ${ac.vlan}\nStatus: ${ac.up ? "up" : "DOWN"}` : "(not a PE)" },
      juniper: { cmd: `show interfaces ${ac?.interfaceName ?? "unknown"} terse`, output: ac ? `${ac.interfaceName}  ${ac.up ? "up" : "down"}  vlan ${ac.vlan}` : "(not a PE)" },
    },
    {
      id: "fdb",
      label: "MAC / FDB Table",
      concept: "Learned purely from the data plane — no control-plane MAC advertisement exists in traditional VPLS.",
      cisco: { cmd: `show bridge-domain ${SERVICE_NAME} mac address-table`, output: fdb.length ? fdb.map((e) => `${e.mac}  ${portLabel(e.port)}  age ${e.age}`).join("\n") : "(empty)" },
      juniper: { cmd: `show vpls mac-table`, output: fdb.length ? fdb.map((e) => `${e.mac}  ${portLabel(e.port)}  age ${e.age}`).join("\n") : "(empty)" },
    },
    {
      id: "forwarding",
      label: "Forwarding Journey",
      concept: "This router's hops recorded for the packet currently in flight, if any.",
      cisco: { cmd: `show mpls forwarding-table`, output: state.journey.filter((h) => h.device === router).map((h) => `In: ${h.input}  Action: ${h.action}  Out: ${h.output}`).join("\n") || "(no forwarding entry recorded at this router yet)" },
      juniper: { cmd: `show route forwarding-table`, output: state.journey.filter((h) => h.device === router).map((h) => `in ${h.input} -> ${h.action} -> out ${h.output}`).join("\n") || "(no forwarding entry recorded at this router yet)" },
    },
  ];
}

