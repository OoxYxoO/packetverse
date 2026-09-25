import type { PacketLayer, PacketVisual, ScenarioStep } from "../types";

/**
 * Traditional MPLS L2VPN / VPWS — attachment circuits, targeted LDP,
 * pseudowire labels, and two-label forwarding.
 *
 * This is the classic LDP-signaled point-to-point pseudowire model
 * (RFC 4447 / FEC 128), NOT EVPN-VPWS (/demo/evpn-vpws) — that lesson
 * uses BGP EVPN for service discovery and label signaling. Both are
 * "VPWS" in the sense of a point-to-point Ethernet virtual wire; they
 * signal it completely differently, and this lesson's mandatory
 * comparison step says so explicitly.
 *
 * Continues from MPLS + LDP (transport reachability, hop-by-hop label
 * distribution — recapped, not re-taught), MPLS L3VPN (the two-label
 * mental model, with a different inner-label meaning here), and
 * EVPN-VPWS (the point-to-point "no MAC lookup needed" property this
 * lesson also relies on).
 *
 *   CE1 ── PE1 ── P1 ── P2 ── PE2 ── CE2
 *
 * Same RouterId set and loopbacks as mplsLdp.ts, for continuity:
 * PE1=1.1.1.1, P1=2.2.2.2, P2=3.3.3.3, PE2=4.4.4.4.
 *
 * Central question: how can two customer Ethernet ports behave like
 * one virtual wire even though an MPLS provider network sits between
 * them?
 *
 * Explicitly deferred: VPLS (multipoint), BGP-signaled L2VPN, EVPN
 * signaling, PBB, hierarchical VPLS, generalized PW FEC 129 (named
 * once as advanced material, never built), RSVP-TE/SR-MPLS transport
 * (mentioned as conceptually substitutable, never simulated here).
 *
 * Pure data + pure functions only — see /lib/sim-engine/types.ts.
 */

export type RouterId = "CE1" | "PE1" | "P1" | "P2" | "PE2" | "CE2";
export const ALL_DEVICES: RouterId[] = ["CE1", "PE1", "P1", "P2", "PE2", "CE2"];
export const PROVIDER_ROUTERS: RouterId[] = ["PE1", "P1", "P2", "PE2"];
export const ROUTER_LOOPBACK: Partial<Record<RouterId, string>> = { PE1: "1.1.1.1", P1: "2.2.2.2", P2: "3.3.3.3", PE2: "4.4.4.4" };

export type LinkId = "CE1-PE1" | "PE1-P1" | "P1-P2" | "P2-PE2" | "PE2-CE2";
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
  { id: "P2-PE2", a: "P2", b: "PE2", igpMetric: 10 },
  { id: "PE2-CE2", a: "PE2", b: "CE2" },
];

export const CE1_IP = "192.168.100.1/24";
export const CE2_IP = "192.168.100.2/24";
export const CE1_MAC = "00:1a:2b:00:00:01";
export const CE2_MAC = "00:1a:2b:00:00:02";
export const SERVICE_NAME = "CUST-A-VPWS";
export const AC_VLAN = 100;
export const PW_ID = 5000;
export const PE1_INTERFACE = "ge-0/0/0.100";
export const PE2_INTERFACE = "ge-0/0/0.100";

export const TERMS: { term: string; expansion: string; meaning: string }[] = [
  { term: "AC", expansion: "Attachment Circuit", meaning: "The local customer-facing side of the pseudowire service at one PE — an interface/VLAN, not the pseudowire itself." },
  { term: "PW", expansion: "Pseudowire", meaning: "The emulated point-to-point circuit between two PEs, identified by a PW FEC (PW Type + PW ID) and forwarded using a directional service label." },
  { term: "Targeted LDP", expansion: "Targeted LDP Session", meaning: "An LDP session between two PE loopbacks that are not directly connected — used here to signal the pseudowire, separate from ordinary hop-by-hop transport LDP." },
  { term: "PW Label", expansion: "Pseudowire / VC Label", meaning: "The inner label that tells the egress PE which virtual wire a frame belongs to — directional, locally allocated, and advertised by the receiver." },
];

// ---------------------------------------------------------------------------
// MPLS label stack — same LabelPurpose convention as evpnVpws.ts
// ("transport" | "service", never "vpn" — VPWS is not an L3VPN).
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
  // Existing labels keep their S bits: only the label pushed onto an empty stack is bottom-of-stack.
  return { ...pkt, labels: [{ value, bottomOfStack: wasEmpty, purpose }, ...pkt.labels.map((l) => ({ ...l }))] };
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

/** Local copy of the IMPLICIT_NULL sentinel — same per-file convention as mplsLdp.ts. Never render numeric label 3 on wire. */
export type LabelBindingValue = number | "IMPLICIT_NULL";
export function fmtLabel(v: LabelBindingValue): string {
  return v === "IMPLICIT_NULL" ? "implicit-null" : String(v);
}

// ---------------------------------------------------------------------------
// Transport — recapped, not re-derived (MPLS + LDP already taught hop-by-
// hop label distribution in depth). Three simple stage flags, matching
// the brief's own "IGP UP / MPLS UP / transport LSP UP" framing.
// ---------------------------------------------------------------------------
export interface TransportState {
  igpUp: boolean;
  ldpUp: boolean;
  lspUp: boolean;
}
export function transportReachable(t: TransportState): boolean {
  return t.igpUp && t.ldpUp && t.lspUp;
}
/** Deterministic, LDP-style transport label per provider router — same convention as mplsLdp.ts's allocateLabel/LABEL_BASE (egress PE advertises implicit-null; upstream routers allocate real values). */
const TRANSPORT_LABEL_BASE: Partial<Record<RouterId, number>> = { P2: 203, P1: 102 };
export function transportLabelFor(router: RouterId): LabelBindingValue {
  if (router === "PE2") return "IMPLICIT_NULL";
  return TRANSPORT_LABEL_BASE[router] ?? 100;
}

// ---------------------------------------------------------------------------
// Targeted LDP — a real 5-state lifecycle (the brief explicitly wants
// more granularity than ordinary hop-by-hop LDP's 4-state model),
// documented as a PacketVerse simplification, not an exact protocol FSM.
// ---------------------------------------------------------------------------
export type TargetedLdpState = "DOWN" | "TARGETED_HELLO" | "TCP_SESSION" | "INITIALIZATION" | "OPERATIONAL";
export const TARGETED_LDP_ORDER: TargetedLdpState[] = ["DOWN", "TARGETED_HELLO", "TCP_SESSION", "INITIALIZATION", "OPERATIONAL"];
export const TARGETED_LDP_INFO: Record<TargetedLdpState, { meaning: string; why: string; next: string }> = {
  DOWN: { meaning: "No targeted LDP session exists between the PE loopbacks yet.", why: "Unlike ordinary LDP, targeted sessions must be explicitly configured — the PEs are not directly connected, so nothing discovers this adjacency automatically.", next: "A targeted Hello, sent as unicast (not the usual multicast Hello), starts discovery." },
  TARGETED_HELLO: { meaning: "PE1 and PE2 are exchanging unicast targeted Hellos across the MPLS core.", why: "Targeted Hellos work exactly like ordinary LDP Hellos conceptually, just unicast instead of link-local multicast, since the peer isn't on a shared link.", next: "Once both sides accept the Hello, they open a TCP connection." },
  TCP_SESSION: { meaning: "A TCP connection is established between the PE loopbacks.", why: "LDP session establishment uses TCP — same as ordinary LDP. TCP carries LDP signaling; it never carries customer data.", next: "LDP Initialization messages negotiate session parameters." },
  INITIALIZATION: { meaning: "LDP Initialization messages are negotiating session parameters over the TCP connection.", why: "Both peers must agree on protocol version and timers before the session is usable.", next: "Once negotiation completes, the session becomes OPERATIONAL." },
  OPERATIONAL: { meaning: "The targeted LDP session is up — PE1 and PE2 can now exchange pseudowire FEC/label bindings directly.", why: "This is what makes PW signaling possible at all — but it does not by itself mean any pseudowire is UP.", next: "PW FEC exchange and label mapping can now proceed." },
};

// ---------------------------------------------------------------------------
// Attachment Circuit
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
// Pseudowire FEC / PW signaling identity — traditional PWid FEC (FEC
// 128) style. Generalized PW FEC (FEC 129) is named once as advanced
// material and never built.
// ---------------------------------------------------------------------------
export type PwType = "Ethernet";
export interface PwFec {
  pwType: PwType;
  pwId: number;
}
export function buildPwFec(pwType: PwType, pwId: number): PwFec {
  return { pwType, pwId };
}
export function pwFecKey(fec: PwFec): string {
  return `PW-${fec.pwType.toUpperCase()}-${fec.pwId}`;
}
export function pwFecEquals(a: PwFec, b: PwFec): boolean {
  return a.pwType === b.pwType && a.pwId === b.pwId;
}

export interface PwEndpointConfig {
  router: RouterId;
  fec: PwFec;
  localReceiveLabel: number;
  controlWord: boolean;
  mtu: number;
}
/** Deterministic, scenario-generated receive labels — one per PE, matching the brief's example values (24001 / 25001), never hand-picked per call site. */
const PW_RECEIVE_LABEL_BASE: Partial<Record<RouterId, number>> = { PE1: 24001, PE2: 25001 };
export function allocatePwReceiveLabel(router: RouterId): number {
  return PW_RECEIVE_LABEL_BASE[router] ?? 24000;
}

export interface PwCompatibility {
  compatible: boolean;
  fecMatch: boolean;
  typeMatch: boolean;
  reasons: string[];
}
/** PW Type + PW ID must match exactly — this is the FEC. MTU/control-word mismatches are reported but, per this lesson's own deterministic model (brief explicitly permits this, real behavior is implementation-dependent), do NOT block PW UP on their own — only the optional MTU experiment treats MTU as a hard gate, and that's labeled explicitly as this lesson's own modeled choice, not a universal rule. */
export function validatePwCompatibility(local: PwEndpointConfig, remote: PwEndpointConfig, mtuIsHardGate = false): PwCompatibility {
  const fecMatch = pwFecEquals(local.fec, remote.fec);
  const typeMatch = local.fec.pwType === remote.fec.pwType;
  const reasons: string[] = [];
  if (!fecMatch) reasons.push(`PW ID mismatch: ${local.router} advertises ${local.fec.pwId}, ${remote.router} advertises ${remote.fec.pwId} — these describe two different pseudowires, not one.`);
  if (fecMatch && local.mtu !== remote.mtu) reasons.push(`MTU mismatch: ${local.router}=${local.mtu}, ${remote.router}=${remote.mtu}.`);
  if (fecMatch && local.controlWord !== remote.controlWord) reasons.push(`Control-word mismatch: ${local.router}=${local.controlWord ? "enabled" : "disabled"}, ${remote.router}=${remote.controlWord ? "enabled" : "disabled"}.`);
  const mtuBlocks = mtuIsHardGate && fecMatch && local.mtu !== remote.mtu;
  return { compatible: fecMatch && typeMatch && !mtuBlocks, fecMatch, typeMatch, reasons };
}

/** The receiver advertises the label the sender should use toward it — this is what "associating a remote label" means. Only succeeds once the PW FEC actually matches. */
export function associateRemotePwLabel(local: PwEndpointConfig, remote: PwEndpointConfig): number | undefined {
  return pwFecEquals(local.fec, remote.fec) ? remote.localReceiveLabel : undefined;
}

export type PwStateValue = "DOWN" | "UP";
/** PW UP requires: AC available, targeted LDP operational, PW FEC match, compatible type, remote label learned, and transport reachability. Not claimed exhaustive for every real implementation. */
export function determinePwState(params: { localAcUp: boolean; remoteAcUp: boolean; targetedLdp: TargetedLdpState; compatibility: PwCompatibility; remoteLabelKnown: boolean; transport: TransportState }): PwStateValue {
  if (!params.localAcUp || !params.remoteAcUp) return "DOWN";
  if (params.targetedLdp !== "OPERATIONAL") return "DOWN";
  if (!params.compatibility.compatible) return "DOWN";
  if (!params.remoteLabelKnown) return "DOWN";
  if (!transportReachable(params.transport)) return "DOWN";
  return "UP";
}

// ---------------------------------------------------------------------------
// Two-label forwarding — outer transport label gets the frame to the
// PE; inner PW label tells that PE which virtual wire it belongs to.
// ---------------------------------------------------------------------------
/** Builds the initial two-label stack at the ingress PE: PW label (the REMOTE PE's advertised receive label) underneath, transport label (toward the remote PE) on top. */
export function buildVpwsLabelStack(frame: EthernetFrame, remotePwReceiveLabel: number, firstHopTransportLabel: LabelBindingValue): MplsPacketState {
  const base: MplsPacketState = { frame, labels: [] };
  const withPw = pushLabel(base, remotePwReceiveLabel, "service");
  if (firstHopTransportLabel === "IMPLICIT_NULL") return withPw; // PHP at the very first hop would be unusual but stays representable
  return pushLabel(withPw, firstHopTransportLabel, "transport");
}
/** A P router's only job: act on the top (transport) label. The inner PW label is never inspected and passes through unchanged — this is structural (swapTopLabel only ever touches labels[0]), not a special case. */
export function processCoreTransportLabel(pkt: MplsPacketState, nextTransportLabel: LabelBindingValue): MplsPacketState {
  if (nextTransportLabel === "IMPLICIT_NULL") return popTopLabel(pkt);
  return swapTopLabel(pkt, nextTransportLabel);
}
/** At the egress PE: once the transport label is gone (via PHP or an explicit pop), the top label is the PW label — this is the lookup that identifies the service. */
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
export type JourneyAction = "AC_INGRESS" | "SERVICE_LOOKUP" | "PUSH_PW" | "PUSH_TRANSPORT" | "SWAP_TRANSPORT" | "POP_TRANSPORT" | "PW_LOOKUP" | "POP_PW" | "AC_EGRESS" | "AC_UNAVAILABLE";
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
export interface MplsL2vpnVpwsState {
  transport: TransportState;
  targetedLdp: TargetedLdpState;
  acs: AttachmentCircuit[];
  pe1Config: PwEndpointConfig;
  pe2Config: PwEndpointConfig;
  remoteLabelKnownAtPe1?: number;
  remoteLabelKnownAtPe2?: number;
  mtuHardGate: boolean;
  packet?: MplsPacketState;
  packetAt?: RouterId;
  journey: JourneyHop[];
  troubleshooting: TroubleshootingState;
}

export function createMplsL2vpnVpwsState(): MplsL2vpnVpwsState {
  return {
    transport: { igpUp: false, ldpUp: false, lspUp: false },
    targetedLdp: "DOWN",
    acs: [
      { peRouter: "PE1", ceRouter: "CE1", interfaceName: PE1_INTERFACE, vlan: AC_VLAN, up: true },
      { peRouter: "PE2", ceRouter: "CE2", interfaceName: PE2_INTERFACE, vlan: AC_VLAN, up: true },
    ],
    pe1Config: { router: "PE1", fec: buildPwFec("Ethernet", PW_ID), localReceiveLabel: allocatePwReceiveLabel("PE1"), controlWord: true, mtu: 1500 },
    pe2Config: { router: "PE2", fec: buildPwFec("Ethernet", PW_ID), localReceiveLabel: allocatePwReceiveLabel("PE2"), controlWord: true, mtu: 1500 },
    mtuHardGate: false,
    journey: [],
    troubleshooting: { started: false, repaired: false, verified: false },
  };
}

export function pwCompatibilityFor(state: Pick<MplsL2vpnVpwsState, "pe1Config" | "pe2Config" | "mtuHardGate">): PwCompatibility {
  return validatePwCompatibility(state.pe1Config, state.pe2Config, state.mtuHardGate);
}
export function pwStateFor(state: MplsL2vpnVpwsState): PwStateValue {
  const ac1 = resolveAttachmentCircuit(state.acs, "PE1");
  const ac2 = resolveAttachmentCircuit(state.acs, "PE2");
  return determinePwState({
    localAcUp: ac1?.up ?? false,
    remoteAcUp: ac2?.up ?? false,
    targetedLdp: state.targetedLdp,
    compatibility: pwCompatibilityFor(state),
    remoteLabelKnown: state.remoteLabelKnownAtPe1 !== undefined && state.remoteLabelKnownAtPe2 !== undefined,
    transport: state.transport,
  });
}

// ---------------------------------------------------------------------------
// Graph layout — same percent-space convention as mplsL3vpn.ts.
// ---------------------------------------------------------------------------
export const GRAPH_NODES = [
  { id: "CE1", label: "CE1", x: 4, y: 50, subLabel: CE1_IP },
  { id: "PE1", label: "PE1", x: 21.6, y: 50, subLabel: ROUTER_LOOPBACK.PE1 },
  { id: "P1", label: "P1", x: 39.2, y: 50, subLabel: ROUTER_LOOPBACK.P1 },
  { id: "P2", label: "P2", x: 56.8, y: 50, subLabel: ROUTER_LOOPBACK.P2 },
  { id: "PE2", label: "PE2", x: 74.4, y: 50, subLabel: ROUTER_LOOPBACK.PE2 },
  { id: "CE2", label: "CE2", x: 96, y: 50, subLabel: CE2_IP },
];
export const GRAPH_EDGES: { id: LinkId; a: RouterId; b: RouterId }[] = LINKS.map((l) => ({ id: l.id, a: l.a, b: l.b }));

/** Collapsed "service view" — the virtual wire abstraction crosses P1/P2, so the service topology de-emphasizes them entirely. */
export const SERVICE_GRAPH_NODES = [
  { id: "CE1", label: "CE1", x: 6, y: 50, subLabel: CE1_IP },
  { id: "PE1", label: "PE1", x: 27, y: 50, subLabel: "AC: " + PE1_INTERFACE },
  { id: "PE2", label: "PE2", x: 73, y: 50, subLabel: "AC: " + PE2_INTERFACE },
  { id: "CE2", label: "CE2", x: 94, y: 50, subLabel: CE2_IP },
];
export const SERVICE_GRAPH_EDGES: { id: string; a: RouterId; b: RouterId; label?: string }[] = [
  { id: "CE1-PE1", a: "CE1", b: "PE1" },
  { id: "PE1-PE2", a: "PE1", b: "PE2", label: "VPWS — virtual wire" },
  { id: "PE2-CE2", a: "PE2", b: "CE2" },
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
function vpwsPacket(id: string, from: RouterId, to: RouterId, summary: string, badge: string, pkt: MplsPacketState): PacketVisual {
  return { id, protocol: "MPLS", from, to, summary, badge, layers: buildPacketLayers(pkt) };
}
function ldpPacket(id: string, from: RouterId, to: RouterId, summary: string, badge: string, fields: { label: string; value: string }[]): PacketVisual {
  return { id, protocol: "MPLS", from, to, summary, badge, layers: [{ name: "Targeted LDP", color: "var(--pv-proto-mpls)", fields }] };
}
const CE1_FRAME: EthernetFrame = { srcMac: CE1_MAC, dstMac: CE2_MAC, note: "192.168.100.1 → 192.168.100.2" };
const CE2_FRAME: EthernetFrame = { srcMac: CE2_MAC, dstMac: CE1_MAC, note: "192.168.100.2 → 192.168.100.1" };

// ---------------------------------------------------------------------------
// Scenario steps
// ---------------------------------------------------------------------------

export const mplsL2vpnVpwsSteps: ScenarioStep<MplsL2vpnVpwsState>[] = [
  {
    id: "intro",
    label: "The Central Question",
    narrative: "How can two customer Ethernet ports behave like one virtual wire even though an MPLS provider network sits between them? You already know MPLS + LDP (transport), MPLS L3VPN (the two-label mental model), and EVPN-VPWS (BGP-signaled point-to-point service). This lesson builds the traditional, LDP-signaled pseudowire — a different signaling mechanism for a similar-sounding service.",
  },
  {
    id: "recap-known",
    label: "Recap: What You Already Know",
    narrative: "MPLS + LDP: hop-by-hop transport label distribution, already covered — recapped here, not re-taught. MPLS L3VPN: an outer transport label plus an inner label identifying context — reused here with a different inner-label meaning. EVPN-VPWS: a point-to-point Ethernet service needs no destination-MAC lookup, since there's exactly one remote site — true here too, signaled completely differently.",
  },
  {
    id: "mental-model",
    label: "The Mental Model",
    narrative: "Customer Ethernet frame → Attachment Circuit → PE service lookup → Pseudowire/VC label → Transport label → MPLS core → transport removed → PW label identifies service → remote Attachment Circuit → original Ethernet frame. Signature stack: [TRANSPORT LABEL] over [PW/VC LABEL] over [ETHERNET FRAME].",
  },
  {
    id: "topology-intro",
    label: "Topology",
    narrative: "CE1 ── PE1 ── P1 ── P2 ── PE2 ── CE2. CE1/CE2 are customer Ethernet devices. PE1/PE2 are the pseudowire endpoints. P1/P2 are provider core transit — they carry the frame but never touch the pseudowire signaling.",
  },
  {
    id: "customer-requirement",
    label: "The Customer Requirement",
    narrative: `CE1 (${CE1_IP}) and CE2 (${CE2_IP}) should appear to share a single point-to-point Ethernet service — Layer 2, point to point. The provider does not route this traffic; it never looks at the customer's IP addressing at all.`,
  },
  {
    id: "attachment-circuit-intro",
    label: "Attachment Circuit (AC)",
    narrative: `The AC is the local customer-facing side of the pseudowire service — PE1's ${PE1_INTERFACE} toward CE1, PE2's ${PE2_INTERFACE} toward CE2. The AC is not the pseudowire itself — it's where the service begins and ends locally.`,
  },
  {
    id: "service-instance-intro",
    label: "Service Instance",
    narrative: `Service ${SERVICE_NAME}, type Ethernet VPWS, PE1 AC ${PE1_INTERFACE}, PE2 AC ${PE2_INTERFACE}, PW ID ${PW_ID}. State: DOWN — nothing has been signaled yet.`,
  },
  {
    id: "vlan-vs-pwid",
    label: "VLAN vs. PW ID",
    narrative: `VLAN ${AC_VLAN} delimits the customer's traffic on the AC — a purely local, per-interface concept. PW ID ${PW_ID} identifies the pseudowire service in signaling between PE1 and PE2 — a completely different number, deliberately different here so they're never confused.`,
  },
  {
    id: "transport-recap-intro",
    label: "Provider Transport, First",
    narrative: "Before any pseudowire signaling can happen, PE1 must be able to reach PE2's loopback across the MPLS core. This reuses the transport model from MPLS + LDP — recapped quickly, not re-derived hop by hop.",
  },
  {
    id: "igp-up",
    label: "IGP: UP",
    narrative: "The provider core's IGP has converged — PE1, P1, P2, and PE2 all have loopback reachability to each other.",
    run: (state) => ({ state: { ...state, transport: { ...state.transport, igpUp: true } }, events: [{ type: "OSPF_SPF_COMPLETED", stepId: "igp-up", timestamp: Date.now(), message: "Provider IGP converged" }] }),
  },
  {
    id: "ldp-transport-up",
    label: "LDP Transport: UP",
    narrative: `Hop-by-hop LDP has distributed transport labels along the path. PE2 advertises implicit-null (PHP) toward P2; P2 allocates label ${transportLabelFor("P2")}; P1 allocates label ${transportLabelFor("P1")}. This is exactly the MPLS + LDP model — nothing new here.`,
    run: (state) => ({ state: { ...state, transport: { ...state.transport, ldpUp: true } }, events: [{ type: "LDP_SESSION_ESTABLISHED", stepId: "ldp-transport-up", timestamp: Date.now(), message: "Hop-by-hop LDP transport labels distributed" }] }),
  },
  {
    id: "transport-lsp-up",
    label: "Transport LSP: UP",
    narrative: "PE1 can now reach PE2's loopback across the MPLS core using label switching alone — the transport LSP is up.",
    run: (state) => ({ state: { ...state, transport: { ...state.transport, lspUp: true } }, events: [{ type: "MPLS_LSP_CHANGED", stepId: "transport-lsp-up", timestamp: Date.now(), message: "PE1 ↔ PE2 transport LSP UP" }] }),
  },
  {
    id: "predict-transport-implies-pw",
    label: "Predict",
    narrative: "Before continuing:",
    question: {
      prompt: "If PE1 can reach PE2's loopback through MPLS, does that automatically mean the VPWS service is UP?",
      options: [
        { id: "no", label: "No — transport reachability and pseudowire service state are separate" },
        { id: "yes", label: "Yes — reachability is all a pseudowire needs" },
        { id: "only-ldp", label: "Only if LDP (not RSVP-TE) provides the transport" },
        { id: "only-same-vlan", label: "Only if the VLAN IDs happen to match" },
      ],
      correctOptionId: "no",
      explanation: "Transport gets a labeled packet from PE1 to PE2 — nothing more. The egress PE still needs to know WHICH local customer service should receive the frame. That's an entirely separate signaling question, answered by the pseudowire itself, not by transport.",
    },
  },
  {
    id: "pw-still-down",
    label: "PW: Still DOWN",
    narrative: "IGP UP. MPLS UP. Transport LSP UP. PW: DOWN. This distinction is the whole point of the next several steps.",
  },
  {
    id: "transport-lsp-vs-pw",
    label: "Transport LSP vs. Pseudowire",
    narrative: "TRANSPORT LSP — purpose: get a packet across the provider core; expressed as the outer label. PSEUDOWIRE — purpose: identify/forward the customer's L2 service; expressed as the inner label. They are not the same LSP, and not the same service.",
  },
  {
    id: "why-ldp-not-enough",
    label: "Why Isn't The Service Just... Working?",
    narrative: "If PE1 can already reach PE2's loopback using MPLS, why isn't the Ethernet service automatically working? Because the egress PE must also know which local customer service/AC should receive the Ethernet frame — that's what the PW label identifies, and nothing has signaled it yet.",
  },
  {
    id: "targeted-ldp-intro",
    label: "Targeted LDP",
    narrative: "The answer: a targeted LDP session between PE1 and PE2. The PEs do not need to be directly connected — this session runs between their loopbacks, across the routed/MPLS core. P1 and P2 do not participate in it at all.",
  },
  {
    id: "targeted-ldp-visual",
    label: "Control Plane vs. Data Path",
    narrative: "PE1 ═══ (targeted LDP) ═══ PE2 — a direct logical adjacency. PE1 ── P1 ── P2 ── PE2 — the actual physical/data path. These are visually and conceptually distinct: one is a control-plane session, the other is where packets actually travel.",
  },
  {
    id: "targeted-ldp-lifecycle-intro",
    label: "PacketVerse Targeted LDP Session Lifecycle",
    narrative: "A simplified, documented lifecycle — not an exact protocol FSM: DOWN → TARGETED HELLO → TCP SESSION → LDP INITIALIZATION → OPERATIONAL.",
  },
  {
    id: "targeted-hello",
    label: "Targeted Hello",
    narrative: TARGETED_LDP_INFO.TARGETED_HELLO.meaning + " " + TARGETED_LDP_INFO.TARGETED_HELLO.why,
    packet: () => ldpPacket("thello", "PE1", "PE2", "Targeted Hello (unicast)", "HELLO", [{ label: "Type", value: "Targeted Hello" }, { label: "Transport addr", value: ROUTER_LOOPBACK.PE1! }]),
    run: (state) => ({ state: { ...state, targetedLdp: "TARGETED_HELLO" }, events: [{ type: "LDP_HELLO_SENT", stepId: "targeted-hello", timestamp: Date.now(), message: "PE1 → PE2 targeted Hello" }] }),
  },
  {
    id: "targeted-tcp",
    label: "TCP Session",
    narrative: TARGETED_LDP_INFO.TCP_SESSION.meaning + " " + TARGETED_LDP_INFO.TCP_SESSION.why + " TCP carries LDP signaling — never the customer data plane.",
    packet: () => ldpPacket("ttcp", "PE1", "PE2", "TCP SYN/SYN-ACK/ACK", "TCP", [{ label: "Src", value: ROUTER_LOOPBACK.PE1! }, { label: "Dst", value: ROUTER_LOOPBACK.PE2! }]),
    run: (state) => ({ state: { ...state, targetedLdp: "TCP_SESSION" }, events: [{ type: "TCP_STATE_CHANGED", stepId: "targeted-tcp", timestamp: Date.now(), message: "PE1 ↔ PE2 TCP session established" }] }),
  },
  {
    id: "targeted-init",
    label: "LDP Initialization",
    narrative: TARGETED_LDP_INFO.INITIALIZATION.meaning + " " + TARGETED_LDP_INFO.INITIALIZATION.why,
    packet: () => ldpPacket("tinit", "PE1", "PE2", "LDP Initialization", "INIT", [{ label: "Protocol Version", value: "1" }]),
    run: (state) => ({ state: { ...state, targetedLdp: "INITIALIZATION" }, events: [{ type: "LDP_SESSION_ESTABLISHED", stepId: "targeted-init", timestamp: Date.now(), message: "LDP Initialization negotiated" }] }),
  },
  {
    id: "targeted-operational",
    label: "Targeted LDP: OPERATIONAL",
    narrative: TARGETED_LDP_INFO.OPERATIONAL.meaning + " " + TARGETED_LDP_INFO.OPERATIONAL.why,
    run: (state) => ({ state: { ...state, targetedLdp: "OPERATIONAL" }, events: [{ type: "LDP_SESSION_ESTABLISHED", stepId: "targeted-operational", timestamp: Date.now(), message: "Targeted LDP session OPERATIONAL" }] }),
    whatChanged: () => ["Targeted LDP: DOWN → OPERATIONAL — PW FEC/label exchange can now proceed"],
  },
  {
    id: "tcp-distinction",
    label: "TCP Carries Signaling, Not Customer Data",
    narrative: "As with ordinary LDP: session establishment uses TCP, and targeted discovery/Hellos conceptually precede it. The customer's Ethernet frames never travel inside this TCP session — they travel as MPLS-labeled packets, entirely separately.",
  },
  {
    id: "pw-fec-intro",
    label: "Pseudowire FEC",
    narrative: "The traditional PW signaling identity: a PWid FEC (FEC 128 style) — PW Type, PW ID, and interface parameters. Both PEs must refer to the same logical pseudowire service. (Generalized PW FEC / FEC 129 exists in real deployments — advanced material only, not built here.)",
  },
  {
    id: "pw-fec-defined",
    label: `PW Type Ethernet, PW ID ${PW_ID}`,
    narrative: `PE1 and PE2 are both configured with PW Type Ethernet, PW ID ${PW_ID} — the FEC that identifies ${SERVICE_NAME} in signaling.`,
    run: (state) => ({ state, events: [{ type: "LDP_LABEL_MAPPING_SENT", stepId: "pw-fec-defined", timestamp: Date.now(), message: `PW FEC defined: ${pwFecKey(buildPwFec("Ethernet", PW_ID))}` }] }),
  },
  {
    id: "pw-id-vs-label",
    label: "PW ID ≠ MPLS Label",
    narrative: "PW ID identifies the service in signaling — it's never itself imposed on a packet. A PE allocates a real MPLS label for RECEIVING traffic for that PW; that label, not the PW ID, is what actually travels on the wire.",
  },
  {
    id: "predict-pwid-is-label",
    label: "Predict",
    narrative: "Before continuing:",
    question: {
      prompt: `Is PW ID ${PW_ID} itself the MPLS label placed on every customer packet?`,
      options: [
        { id: "no", label: "No — PW ID identifies the service in signaling; a separately-allocated MPLS label is what's actually imposed" },
        { id: "yes", label: "Yes — the PW ID is pushed directly as the label value" },
        { id: "sometimes", label: "Only for Ethernet PW types" },
        { id: "only-reverse", label: "Only in the reverse direction" },
      ],
      correctOptionId: "no",
      explanation: `PW ID ${PW_ID} never appears as a label. It's the FEC both PEs use to agree they're talking about the same pseudowire. Each PE then separately allocates a real MPLS label (like ${allocatePwReceiveLabel("PE1")}) for its own receive direction.`,
    },
  },
  {
    id: "directional-label-alloc-intro",
    label: "Directional Label Allocation",
    narrative: "Each PE allocates its OWN local label for traffic it will receive — these are independent, one-way allocations, not a shared value.",
  },
  {
    id: "pe1-allocates-label",
    label: `PE1 Allocates ${allocatePwReceiveLabel("PE1")}`,
    narrative: `PE1 allocates local PW label ${allocatePwReceiveLabel("PE1")} for traffic it will receive for ${pwFecKey(buildPwFec("Ethernet", PW_ID))}.`,
    run: (state) => ({ state, events: [{ type: "VPN_LABEL_ALLOCATED", stepId: "pe1-allocates-label", timestamp: Date.now(), message: `PE1 allocates local PW receive label ${allocatePwReceiveLabel("PE1")}` }] }),
  },
  {
    id: "pe2-allocates-label",
    label: `PE2 Allocates ${allocatePwReceiveLabel("PE2")}`,
    narrative: `PE2 allocates local PW label ${allocatePwReceiveLabel("PE2")} for traffic it will receive for the same FEC.`,
    run: (state) => ({ state, events: [{ type: "VPN_LABEL_ALLOCATED", stepId: "pe2-allocates-label", timestamp: Date.now(), message: `PE2 allocates local PW receive label ${allocatePwReceiveLabel("PE2")}` }] }),
  },
  {
    id: "label-mapping-pe1-to-pe2",
    label: "Label Mapping: PE1 → PE2",
    narrative: `PE1 advertises ${pwFecKey(buildPwFec("Ethernet", PW_ID))} / label ${allocatePwReceiveLabel("PE1")} to PE2 — meaning "when sending this PW toward me, use label ${allocatePwReceiveLabel("PE1")}."`,
    packet: () => ldpPacket("map1", "PE1", "PE2", "Label Mapping", "MAPPING", [{ label: "FEC", value: pwFecKey(buildPwFec("Ethernet", PW_ID)) }, { label: "Label", value: String(allocatePwReceiveLabel("PE1")) }]),
    run: (state) => {
      const remote = associateRemotePwLabel(state.pe2Config, state.pe1Config);
      return { state: { ...state, remoteLabelKnownAtPe2: remote }, events: [{ type: "LDP_LABEL_MAPPING_SENT", stepId: "label-mapping-pe1-to-pe2", timestamp: Date.now(), message: `PE1 advertises label ${allocatePwReceiveLabel("PE1")} to PE2` }] };
    },
  },
  {
    id: "label-mapping-pe2-to-pe1",
    label: "Label Mapping: PE2 → PE1",
    narrative: `PE2 advertises the same FEC / label ${allocatePwReceiveLabel("PE2")} to PE1 — "when sending this PW toward me, use label ${allocatePwReceiveLabel("PE2")}."`,
    packet: () => ldpPacket("map2", "PE2", "PE1", "Label Mapping", "MAPPING", [{ label: "FEC", value: pwFecKey(buildPwFec("Ethernet", PW_ID)) }, { label: "Label", value: String(allocatePwReceiveLabel("PE2")) }]),
    run: (state) => {
      const remote = associateRemotePwLabel(state.pe1Config, state.pe2Config);
      return { state: { ...state, remoteLabelKnownAtPe1: remote }, events: [{ type: "LDP_LABEL_MAPPING_SENT", stepId: "label-mapping-pe2-to-pe1", timestamp: Date.now(), message: `PE2 advertises label ${allocatePwReceiveLabel("PE2")} to PE1` }] };
    },
  },
  {
    id: "predict-same-pw-label",
    label: "Predict",
    narrative: "Before continuing:",
    question: {
      prompt: "Must CE1→CE2 and CE2→CE1 traffic use the same PW label?",
      options: [
        { id: "no", label: "No — each direction uses whichever PE's OWN advertised receive label applies to that direction" },
        { id: "yes", label: "Yes — a pseudowire has one shared bidirectional VC label" },
        { id: "only-ethernet", label: "Only for Ethernet-type pseudowires" },
        { id: "only-with-control-word", label: "Only when a control word is used" },
      ],
      correctOptionId: "no",
      explanation: "The forward and reverse service labels can differ, and normally do — they're two independent, directional allocations. CE1→CE2 uses PE2's advertised label; CE2→CE1 uses PE1's advertised label.",
    },
  },
  {
    id: "pw-up-criteria-intro",
    label: "PW UP Criteria",
    narrative: "This lesson's deterministic model (not claimed exhaustive for every implementation): AC available, targeted LDP operational, PW FEC match, compatible PW type, compatible required parameters, local/remote label learned, transport reachability. All satisfied — the PW should come up.",
  },
  {
    id: "pw-up",
    label: "Pseudowire: UP",
    narrative: `${SERVICE_NAME} is UP. Every criterion is satisfied: matching FEC, operational targeted LDP, both receive labels learned, transport reachable, both ACs up.`,
    run: (state) => ({ state, events: [{ type: "VPN_ROUTE_INSTALLED", stepId: "pw-up", timestamp: Date.now(), message: `${SERVICE_NAME} pseudowire UP` }] }),
    whatChanged: () => [`${SERVICE_NAME}: DOWN → UP`],
  },
  {
    id: "predict-p-router-pwid",
    label: "Predict",
    narrative: "Before continuing:",
    question: {
      prompt: "Do P routers (P1, P2) need to understand the PW ID?",
      options: [
        { id: "no", label: "No — P routers only ever forward using the outer transport label" },
        { id: "yes", label: "Yes — every router in the path must recognize the PW FEC" },
        { id: "only-p1", label: "Only the P router directly attached to PE1" },
        { id: "only-if-ethernet", label: "Only for Ethernet-type pseudowires" },
      ],
      correctOptionId: "no",
      explanation: "P routers do not need pseudowire service state at all — only transport forwarding state. This is one of the most important scalability properties of the whole model: the core doesn't grow with the number of services.",
    },
  },
  {
    id: "packet-before-encap",
    label: "CE1 Sends An Ethernet Frame",
    narrative: `CE1 sends an ordinary Ethernet frame — Src MAC ${CE1_MAC}, Dst MAC ${CE2_MAC}, IP payload 192.168.100.1 → 192.168.100.2. PE1 receives it on the AC, unlabeled.`,
    packet: () => ({ id: "ce1-frame", protocol: "IP", from: "CE1", to: "CE1", summary: "Ethernet frame toward CE2", layers: [ethLayer(CE1_FRAME)] }),
    run: (state) => ({ state: { ...state, packet: { frame: CE1_FRAME, labels: [] }, packetAt: "CE1", journey: [] }, events: [{ type: "PACKET_SENT", stepId: "packet-before-encap", timestamp: Date.now(), message: "CE1 sends Ethernet frame" }] }),
  },
  {
    id: "pe1-ac-ingress",
    label: "PE1: AC Ingress",
    narrative: "Conceptual VPWS Ingress Pipeline: Ethernet frame received → identify attachment circuit → resolve local service instance → resolve pseudowire.",
    packet: (state) => (state.packet ? vpwsPacket("ac-in", "CE1", "PE1", "Ethernet frame", "AC", state.packet) : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const journey = [...state.journey, { device: "PE1" as RouterId, input: "Ethernet frame (unlabeled)", lookup: `Identify AC ${PE1_INTERFACE} → resolve ${SERVICE_NAME} → resolve pseudowire`, action: "AC_INGRESS" as JourneyAction, output: "PW state UP — proceed to label imposition" }];
      return { state: { ...state, packetAt: "PE1", journey }, events: [] };
    },
  },
  {
    id: "pe1-push-pw",
    label: "PE1: Push PW Label",
    narrative: `PW state is UP. PE1 pushes the label PE2 advertised (${allocatePwReceiveLabel("PE2")}) — this is the inner label, identifying the service at PE2.`,
    packet: (state) => (state.packet ? vpwsPacket("push-pw", "PE1", "PE1", "PUSH PW label", "PUSH", state.packet) : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const packet = pushLabel(state.packet, allocatePwReceiveLabel("PE2"), "service");
      const journey = [...state.journey, { device: "PE1" as RouterId, input: "Ethernet frame", lookup: "Resolve remote PW receive label (PE2 advertised)", action: "PUSH_PW" as JourneyAction, output: `label ${allocatePwReceiveLabel("PE2")} (service)` }];
      return { state: { ...state, packet, journey }, events: [{ type: "VPN_LABEL_PUSHED", stepId: "pe1-push-pw", timestamp: Date.now(), message: "PE1 pushes PW label" }] };
    },
  },
  {
    id: "pe1-push-transport",
    label: "PE1: Push Transport Label",
    narrative: `PE1 resolves the transport LSP to PE2 and pushes the outer transport label (${transportLabelFor("P1")}) — the label that actually gets this packet across the core.`,
    packet: (state) => (state.packet ? vpwsPacket("push-t", "PE1", "P1", "PUSH transport label", "PUSH", state.packet) : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const packet = pushLabel(state.packet, transportLabelFor("P1") as number, "transport");
      const journey = [...state.journey, { device: "PE1" as RouterId, input: `label ${allocatePwReceiveLabel("PE2")}`, lookup: "Resolve transport LSP to PE2", action: "PUSH_TRANSPORT" as JourneyAction, output: `label ${transportLabelFor("P1")} (transport) + label ${allocatePwReceiveLabel("PE2")} (service)` }];
      return { state: { ...state, packetAt: "P1", packet, journey }, events: [{ type: "TRANSPORT_LABEL_PUSHED", stepId: "pe1-push-transport", timestamp: Date.now(), message: "PE1 pushes transport label" }] };
    },
  },
  {
    id: "two-label-stack-signature",
    label: "The Two-Label Stack",
    narrative: `TOP: [TRANSPORT LABEL ${transportLabelFor("P1")}]. Then: [PW LABEL ${allocatePwReceiveLabel("PE2")}]. BOTTOM: [Ethernet frame]. Outer label = transport toward PE2. Inner label = identifies the pseudowire/service at PE2 — the same two-label mental model as L3VPN, with a different inner-label meaning.`,
  },
  {
    id: "p1-transport-forward",
    label: "P1: Transport Forward",
    narrative: `MPLS packet arrives at P1. Top-label lookup → transport forwarding → swap outer label to ${transportLabelFor("P2")}. The inner PW label is never inspected — it passes through untouched.`,
    packet: (state) => (state.packet ? vpwsPacket("p1-swap", "P1", "P2", "SWAP transport label", "SWAP", state.packet) : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const packet = processCoreTransportLabel(state.packet, transportLabelFor("P2"));
      const journey = [...state.journey, { device: "P1" as RouterId, input: `label ${transportLabelFor("P1")}`, lookup: "Transport forwarding table — outer label only", action: "SWAP_TRANSPORT" as JourneyAction, output: `label ${transportLabelFor("P2")} (transport), inner PW label untouched` }];
      return { state: { ...state, packetAt: "P2", packet, journey }, events: [{ type: "TRANSPORT_LABEL_SWAPPED", stepId: "p1-transport-forward", timestamp: Date.now(), message: "P1 swaps transport label" }] };
    },
  },
  {
    id: "p2-transport-forward-php",
    label: "P2: Transport Forward (PHP)",
    narrative: "P2 is the penultimate hop — PE2 signaled implicit-null, so P2 pops the transport label entirely (PHP) rather than swapping it. Only the PW label remains for PE2.",
    packet: (state) => (state.packet ? vpwsPacket("p2-pop", "P2", "PE2", "POP transport label (PHP)", "POP", state.packet) : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const packet = processCoreTransportLabel(state.packet, "IMPLICIT_NULL");
      const journey = [...state.journey, { device: "P2" as RouterId, input: `label ${transportLabelFor("P2")}`, lookup: "Transport forwarding table — PE2 signaled implicit-null", action: "POP_TRANSPORT" as JourneyAction, output: "PW label only" }];
      return { state: { ...state, packetAt: "PE2", packet, journey }, events: [{ type: "TRANSPORT_LABEL_POPPED", stepId: "p2-transport-forward-php", timestamp: Date.now(), message: "P2 pops transport label (PHP)" }] };
    },
  },
  {
    id: "p-router-knowledge-boundary",
    label: "What P Routers Never Needed",
    narrative: "P1 and P2 never inspected the PW ID, never selected a CE interface, and never learned any customer MAC address for this service. They only needed transport forwarding state — this is one of the most important scalability concepts in the whole model.",
  },
  {
    id: "pe2-egress-intro",
    label: "PE2: Egress Pipeline",
    narrative: "Conceptual VPWS Egress Pipeline: MPLS packet arrives → transport context terminated → PW label lookup → identify VPWS service → identify local AC → pop PW label → restore/deliver Ethernet frame.",
  },
  {
    id: "predict-egress-label",
    label: "Predict",
    narrative: "Before continuing:",
    question: {
      prompt: "Which label identifies the customer pseudowire at the egress PE?",
      options: [
        { id: "pw", label: "The PW / VC label — the inner label" },
        { id: "transport", label: "The transport label — the outer label" },
        { id: "vlan", label: "The customer's own VLAN tag" },
        { id: "pwid", label: "The PW ID itself" },
      ],
      correctOptionId: "pw",
      explanation: "The transport (outer) label is already gone by the time this lookup happens — PHP removed it in the core. What remains, and what PE2 actually looks up, is the PW/VC label: its own advertised receive label.",
    },
  },
  {
    id: "pe2-pw-lookup",
    label: `PE2: PW Label ${allocatePwReceiveLabel("PE2")} Lookup`,
    narrative: `PW label ${allocatePwReceiveLabel("PE2")} → ${SERVICE_NAME} → local AC ${PE2_INTERFACE} → CE2. This is the key reason the inner label exists — it's PE2's OWN receive label, so the lookup is unambiguous.`,
    packet: (state) => (state.packet ? vpwsPacket("pe2-lookup", "PE2", "PE2", "PW label lookup", "LOOKUP", state.packet) : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const label = resolveIncomingPwLabel(state.packet);
      const journey = [...state.journey, { device: "PE2" as RouterId, input: `label ${label}`, lookup: `PW label ${label} → ${SERVICE_NAME} → local AC ${PE2_INTERFACE}`, action: "PW_LOOKUP" as JourneyAction, output: "Local AC identified" }];
      return { state: { ...state, journey }, events: [{ type: "VPN_LABEL_LOOKUP", stepId: "pe2-pw-lookup", timestamp: Date.now(), message: "PE2 resolves PW label to local AC" }] };
    },
  },
  {
    id: "pe2-deliver",
    label: "PE2 Delivers To CE2",
    narrative: "PE2 pops the PW label and delivers the original Ethernet frame out the local AC to CE2 — preserved according to this lesson's modeled service behavior (not claiming every bit is untouched under every control-word/tagging configuration).",
    packet: (state) => (state.packet ? { id: "ce2-frame", protocol: "IP", from: "PE2", to: "PE2", summary: "Delivered to CE2", layers: [ethLayer(deliverEthernetFrame(state.packet))] } : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const journey = [...state.journey, { device: "PE2" as RouterId, input: "PW label", lookup: "Pop PW label, restore Ethernet frame", action: "POP_PW" as JourneyAction, output: "Ethernet frame" }, { device: "CE2" as RouterId, input: "Ethernet frame", lookup: "AC delivery", action: "AC_EGRESS" as JourneyAction, output: "Delivered" }];
      return { state: { ...state, packetAt: "CE2", packet: popTopLabel(state.packet), journey }, events: [{ type: "VPN_PACKET_DELIVERED", stepId: "pe2-deliver", timestamp: Date.now(), message: "CE2 receives the original Ethernet frame" }] };
    },
    whatChanged: () => ["Delivered CE1 → PE1 → P1 → P2 → PE2 → CE2 — outer transport label got the frame to PE2; the inner PW label told PE2 which virtual wire it belonged to"],
  },
  {
    id: "reverse-direction-intro",
    label: "Reverse Direction",
    narrative: "Now CE2 sends toward CE1. This is mandatory to show explicitly: PE2 must use PE1's advertised PW label — not reuse PE2's own local receive label.",
  },
  {
    id: "ce2-sends",
    label: "CE2 Sends An Ethernet Frame",
    narrative: `CE2 sends an Ethernet frame — Src MAC ${CE2_MAC}, Dst MAC ${CE1_MAC}, 192.168.100.2 → 192.168.100.1.`,
    packet: () => ({ id: "ce2-frame-send", protocol: "IP", from: "CE2", to: "CE2", summary: "Ethernet frame toward CE1", layers: [ethLayer(CE2_FRAME)] }),
    run: (state) => ({ state: { ...state, packet: { frame: CE2_FRAME, labels: [] }, packetAt: "CE2", journey: [] }, events: [{ type: "PACKET_SENT", stepId: "ce2-sends", timestamp: Date.now(), message: "CE2 sends Ethernet frame" }] }),
  },
  {
    id: "pe2-push-reverse",
    label: "PE2: Push PW + Transport (Reverse)",
    narrative: `PE2 pushes the label PE1 advertised (${allocatePwReceiveLabel("PE1")}) — NOT PE2's own local receive label (${allocatePwReceiveLabel("PE2")}) — then pushes the transport label toward PE1.`,
    packet: (state) => (state.packet ? vpwsPacket("push-rev", "PE2", "P2", "PUSH PW + transport", "PUSH", state.packet) : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const withPw = pushLabel(state.packet, allocatePwReceiveLabel("PE1"), "service");
      const withTransport = pushLabel(withPw, 100, "transport");
      const journey = [...state.journey, { device: "PE2" as RouterId, input: "Ethernet frame", lookup: `Resolve remote PW receive label (PE1 advertised, ${allocatePwReceiveLabel("PE1")}) + transport LSP to PE1`, action: "PUSH_PW" as JourneyAction, output: `label 100 (transport) + label ${allocatePwReceiveLabel("PE1")} (service)` }];
      return { state: { ...state, packetAt: "P2", packet: withTransport, journey }, events: [{ type: "VPN_LABEL_PUSHED", stepId: "pe2-push-reverse", timestamp: Date.now(), message: "PE2 pushes PE1's advertised PW label" }] };
    },
  },
  {
    id: "core-reverse-forward",
    label: "P2 → P1: Transport Forward (Reverse)",
    narrative: "The core forwards using only the outer transport label, exactly as before — direction doesn't change what P routers need to know.",
    packet: (state) => (state.packet ? vpwsPacket("p2-p1-rev", "P2", "P1", "SWAP transport label", "SWAP", state.packet) : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const packet = swapTopLabel(state.packet, 101);
      const journey = [...state.journey, { device: "P2" as RouterId, input: "label 100", lookup: "Transport forwarding table — outer label only", action: "SWAP_TRANSPORT" as JourneyAction, output: "label 101 (transport), inner PW label untouched" }];
      return { state: { ...state, packetAt: "P1", packet, journey }, events: [] };
    },
  },
  {
    id: "core-reverse-php",
    label: "P1 → PE1: PHP (Reverse)",
    narrative: "P1 is the penultimate hop toward PE1 — pops the transport label (PHP), leaving only the PW label for PE1.",
    packet: (state) => (state.packet ? vpwsPacket("p1-pe1-rev", "P1", "PE1", "POP transport label (PHP)", "POP", state.packet) : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const packet = popTopLabel(state.packet);
      const journey = [...state.journey, { device: "P1" as RouterId, input: "label 101", lookup: "Transport forwarding table — PE1 signaled implicit-null", action: "POP_TRANSPORT" as JourneyAction, output: "PW label only" }];
      return { state: { ...state, packetAt: "PE1", packet, journey }, events: [] };
    },
  },
  {
    id: "pe1-reverse-lookup-deliver",
    label: `PE1: PW Label ${allocatePwReceiveLabel("PE1")} Lookup → CE1`,
    narrative: `PW label ${allocatePwReceiveLabel("PE1")} → ${SERVICE_NAME} → local AC ${PE1_INTERFACE} → CE1. This is PE1's OWN receive label — the one it advertised at the very start.`,
    packet: (state) => (state.packet ? { id: "ce1-deliver", protocol: "IP", from: "PE1", to: "PE1", summary: "Delivered to CE1", layers: [ethLayer(deliverEthernetFrame(state.packet))] } : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const label = resolveIncomingPwLabel(state.packet);
      const journey = [
        ...state.journey,
        { device: "PE1" as RouterId, input: `label ${label}`, lookup: `PW label ${label} → ${SERVICE_NAME} → local AC ${PE1_INTERFACE}`, action: "PW_LOOKUP" as JourneyAction, output: "Local AC identified" },
        { device: "PE1" as RouterId, input: "PW label", lookup: "Pop PW label, restore Ethernet frame", action: "POP_PW" as JourneyAction, output: "Ethernet frame" },
        { device: "CE1" as RouterId, input: "Ethernet frame", lookup: "AC delivery", action: "AC_EGRESS" as JourneyAction, output: "Delivered" },
      ];
      return { state: { ...state, packetAt: "CE1", packet: popTopLabel(state.packet), journey }, events: [{ type: "VPN_PACKET_DELIVERED", stepId: "pe1-reverse-lookup-deliver", timestamp: Date.now(), message: "CE1 receives the original Ethernet frame" }] };
    },
    whatChanged: () => [`Verified: CE2 → CE1 used PE1's advertised label (${allocatePwReceiveLabel("PE1")}) — NOT PE2's own local receive label (${allocatePwReceiveLabel("PE2")})`],
  },
  {
    id: "forward-reverse-comparison",
    label: "Forward vs. Reverse",
    narrative: `CE1 → CE2: inner PW label = PE2's receive label (${allocatePwReceiveLabel("PE2")}). CE2 → CE1: inner PW label = PE1's receive label (${allocatePwReceiveLabel("PE1")}). Transport labels may also differ by direction — only the receiver's own advertised label is ever correct for traffic addressed to it.`,
  },
  {
    id: "control-word-intro",
    label: "Advanced: Control Word",
    narrative: "Some pseudowire types/configurations may use a pseudowire control word. Conceptual stack when present: [Transport] [PW] [Control Word] [Ethernet]. Not every Ethernet PW requires one — this is optional/negotiated, not a universal rule.",
  },
  {
    id: "control-word-negotiation",
    label: "Control-Word Negotiation",
    narrative: "PE1 control word: enabled. PE2 control word: enabled. Compatible. (A mismatch is reported by validatePwCompatibility as informational in this lesson's model — real behavior is implementation-dependent, and this lesson does not build complex sequencing logic around it.)",
  },
  {
    id: "pw-status-intro",
    label: "Pseudowire Status Signaling",
    narrative: "Conceptually: a local AC goes down → the local PW/service status changes → the remote PE may be informed through PW status signaling. Exact support/behavior is implementation-dependent — kept informational here.",
  },
  {
    id: "ac-down-experiment",
    label: "Experiment: PE2 ↔ CE2 AC Fails",
    narrative: "Fail the PE2 ↔ CE2 attachment circuit. IGP: UP. MPLS transport: UP. Targeted LDP: UP. But service delivery becomes unavailable — this demonstrates that a healthy control session does not guarantee a healthy end-to-end service.",
    run: (state) => ({ state: { ...state, acs: state.acs.map((a) => (a.peRouter === "PE2" ? { ...a, up: false } : a)) }, events: [{ type: "MPLS_LSP_CHANGED", stepId: "ac-down-experiment", timestamp: Date.now(), message: "PE2 ↔ CE2 AC DOWN" }] }),
    whatChanged: () => ["PE2 AC: UP → DOWN", `${SERVICE_NAME}: UP → DOWN (targeted LDP session itself remains OPERATIONAL)`],
  },
  {
    id: "ac-down-result",
    label: "Control Session Healthy ≠ Service Healthy",
    narrative: "Targeted LDP OPERATIONAL, transport UP, PW FEC still matches — yet the pseudowire itself is DOWN, because one of its two ACs isn't there to deliver to. Control-plane health and end-to-end service health are two different questions.",
  },
  {
    id: "restore-ac",
    label: "Restore The AC",
    narrative: "PE2 ↔ CE2 AC is restored, and the pseudowire recomputes back to UP.",
    run: (state) => ({ state: { ...state, acs: state.acs.map((a) => (a.peRouter === "PE2" ? { ...a, up: true } : a)) }, events: [] }),
  },
  {
    id: "transport-independence",
    label: "Transport Independence",
    narrative: "The pseudowire service label is logically separate from how the provider transports the packet between PEs. Conceptual transport options: LDP, RSVP-TE, SR-MPLS — this lesson only simulates LDP transport, but the PW service model above it would look identical either way.",
  },
  {
    id: "traditional-vs-evpn-vpws",
    label: "Traditional VPWS vs. EVPN-VPWS",
    narrative: "TRADITIONAL LDP-SIGNALED VPWS — service signaling: targeted LDP. Service identity: PW FEC / PW ID. Service label: exchanged through LDP. EVPN-VPWS — service signaling: BGP EVPN. Primary route: Ethernet A-D per-EVI. Service identity/forwarding: EVPN VPWS service state. Neither is universally superior — they solve the same point-to-point problem with different control planes.",
  },
  {
    id: "traditional-vs-l3vpn",
    label: "Traditional VPWS vs. L3VPN",
    narrative: "L3VPN: the inner label identifies a VPN forwarding context / route context — a routed service. VPWS: the inner label identifies a point-to-point pseudowire service — a Layer 2 service, never routed by the provider. Core transport mechanics stay similar in both: the outer label just gets the packet to the egress PE.",
  },
  {
    id: "vpws-vs-vpls-preview",
    label: "VPWS vs. VPLS (Preview Only)",
    narrative: "VPWS = virtual wire = point to point. VPLS = virtual LAN = multipoint. This lesson does not build VPLS — that's a genuinely different, multipoint service model for a later lesson.",
  },
  {
    id: "mtu-lab-note",
    label: "Advanced Experiment: MTU",
    narrative: "An optional lab below lets you compare PE1/PE2 MTU (1500 vs. 1400). Behavior can depend on service type/signaling/vendor implementation — if modeled as a hard PW-compatibility failure here, that's explicitly this lesson's own deterministic model, not a universal rule.",
  },
  {
    id: "troubleshooting-intro",
    label: "INCIDENT",
    narrative: "CE1 cannot reach CE2. PE1 and PE2 loopbacks are reachable. MPLS transport is operational. Targeted LDP session is UP. Both attachment circuits are UP. Pseudowire remains DOWN.",
    run: (state) => ({ state: { ...state, troubleshooting: { ...state.troubleshooting, started: true } }, events: [] }),
  },
  {
    id: "fault-injection",
    label: "PE2 Signals A Different PW ID",
    narrative: "Somewhere, PE2's pseudowire configuration was defined with PW ID 6000 instead of 5000 — a real, deterministic operational fault. Everything else stays compatible.",
    run: (state) => {
      const pe2Config = { ...state.pe2Config, fec: buildPwFec("Ethernet", 6000) };
      return {
        state: { ...state, pe2Config, remoteLabelKnownAtPe1: associateRemotePwLabel(state.pe1Config, pe2Config), remoteLabelKnownAtPe2: associateRemotePwLabel(pe2Config, state.pe1Config) },
        events: [{ type: "LDP_LABEL_MAPPING_SENT", stepId: "fault-injection", timestamp: Date.now(), message: "PE2 advertises PW FEC PW-ETHERNET-6000" }],
      };
    },
    whatChanged: () => ["PE2 PW ID: 5000 → 6000 (targeted LDP session itself remains OPERATIONAL)"],
  },
  {
    id: "diagnostic-ladder",
    label: "Diagnose Before You Fix",
    narrative: "Targeted LDP is UP, transport is UP, both ACs are UP — but the pseudowire is DOWN. Work the diagnostic ladder below before touching anything.",
  },
  {
    id: "repair-challenge",
    label: "Engineer Challenge: Fix The Pseudowire",
    narrative: "Choose the correct repair.",
    action: (state, payload) => {
      const choice = (payload as { choice?: string } | undefined)?.choice ?? "";
      if (choice !== "fix-pw-id") {
        return { state: { ...state, troubleshooting: { ...state.troubleshooting, repairAttempt: { choice, correct: false } } }, events: [] };
      }
      const pe2Config = { ...state.pe2Config, fec: buildPwFec("Ethernet", PW_ID) };
      return {
        state: {
          ...state,
          pe2Config,
          remoteLabelKnownAtPe1: associateRemotePwLabel(state.pe1Config, pe2Config),
          remoteLabelKnownAtPe2: associateRemotePwLabel(pe2Config, state.pe1Config),
          troubleshooting: { ...state.troubleshooting, repairAttempt: { choice, correct: true }, repaired: true },
        },
        events: [{ type: "LDP_LABEL_MAPPING_SENT", stepId: "repair-challenge", timestamp: Date.now(), message: `PE2 reconfigured with PW ID ${PW_ID}` }],
      };
    },
    requiresState: (state) => state.troubleshooting.repaired === true,
  },
  {
    id: "repaired-recompute",
    label: "PW FEC Matches — Labels Re-Associate",
    narrative: `Both PEs now describe ${pwFecKey(buildPwFec("Ethernet", PW_ID))}. Remote labels associate, and the pseudowire recomputes to UP.`,
    run: (state) => ({ state: { ...state, packet: undefined, packetAt: undefined, journey: [] }, events: [] }),
  },
  {
    id: "verify-send",
    label: "Mandatory Verification: Send Traffic Again",
    narrative: "Recomputation alone isn't proof. Send a real CE1 → CE2 frame and follow it end to end.",
    packet: () => ({ id: "verify-ce1", protocol: "IP", from: "CE1", to: "CE1", summary: "Ethernet frame toward CE2", layers: [ethLayer(CE1_FRAME)] }),
    run: (state) => ({ state: { ...state, packet: { frame: CE1_FRAME, labels: [] }, packetAt: "CE1", journey: [] }, events: [] }),
  },
  {
    id: "verify-push",
    label: "PE1: Push Two Labels (Verification)",
    narrative: "PE1 imposes the PW label and transport label exactly as before.",
    packet: (state) => (state.packet ? vpwsPacket("verify-push", "PE1", "P1", "PUSH PW + transport", "PUSH", state.packet) : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const withPw = pushLabel(state.packet, allocatePwReceiveLabel("PE2"), "service");
      const withTransport = pushLabel(withPw, transportLabelFor("P1") as number, "transport");
      const journey = [{ device: "PE1" as RouterId, input: "Ethernet frame", lookup: "AC → service → PW → transport", action: "PUSH_PW" as JourneyAction, output: `label ${transportLabelFor("P1")} + label ${allocatePwReceiveLabel("PE2")}` }];
      return { state: { ...state, packetAt: "P1", packet: withTransport, journey }, events: [] };
    },
  },
  {
    id: "verify-core",
    label: "P1 → P2 → PE2: Transport Forward (Verification)",
    narrative: "The core forwards using only the outer label, PHP at P2, exactly as before.",
    packet: (state) => (state.packet ? vpwsPacket("verify-core", "P1", "PE2", "Transport forward + PHP", "SWAP/POP", state.packet) : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const afterP1 = processCoreTransportLabel(state.packet, transportLabelFor("P2"));
      const afterP2 = processCoreTransportLabel(afterP1, "IMPLICIT_NULL");
      const journey = [...state.journey, { device: "P1" as RouterId, input: `label ${transportLabelFor("P1")}`, lookup: "Transport forwarding — outer label only", action: "SWAP_TRANSPORT" as JourneyAction, output: `label ${transportLabelFor("P2")}` }, { device: "P2" as RouterId, input: `label ${transportLabelFor("P2")}`, lookup: "Transport forwarding — PHP toward PE2", action: "POP_TRANSPORT" as JourneyAction, output: "PW label only" }];
      return { state: { ...state, packetAt: "PE2", packet: afterP2, journey }, events: [] };
    },
  },
  {
    id: "verify-deliver",
    label: "PE2 Delivers To CE2 (Verified)",
    narrative: "PE2 resolves the PW label, identifies the local AC, and delivers to CE2. Verified: the corrected PW ID genuinely restores the service.",
    packet: (state) => (state.packet ? { id: "verify-delivered", protocol: "IP", from: "PE2", to: "PE2", summary: "Delivered via repaired pseudowire", layers: [ethLayer(deliverEthernetFrame(state.packet))] } : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const label = resolveIncomingPwLabel(state.packet);
      const journey = [
        ...state.journey,
        { device: "PE2" as RouterId, input: `label ${label}`, lookup: `PW label ${label} → ${SERVICE_NAME} → local AC ${PE2_INTERFACE}`, action: "PW_LOOKUP" as JourneyAction, output: "Local AC identified" },
        { device: "CE2" as RouterId, input: "Ethernet frame", lookup: "AC delivery", action: "AC_EGRESS" as JourneyAction, output: "Delivered" },
      ];
      return { state: { ...state, packetAt: "CE2", packet: popTopLabel(state.packet), journey, troubleshooting: { ...state.troubleshooting, verified: true } }, events: [{ type: "VPN_PACKET_DELIVERED", stepId: "verify-deliver", timestamp: Date.now(), message: "Verified: repaired pseudowire delivers to CE2" }] };
    },
    whatChanged: () => ["Verified: CE1 → PE1 → P1 → P2 → PE2 → CE2 restored — recomputation alone was not enough, delivery had to be proven"],
  },
  {
    id: "engineer-challenge-intro",
    label: "Engineer Challenge: Build The Virtual Wire",
    narrative: `Recap and confirm: extend VLAN ${AC_VLAN} point-to-point between CE1 and CE2 across the MPLS core. Everything below was already demonstrated in this lesson — this is the checklist.`,
  },
  {
    id: "engineer-challenge-confirm",
    label: "Confirm Full Virtual-Wire Coverage",
    narrative: "Provider transport verified ✓ · PE loopbacks identified ✓ · Targeted LDP established ✓ · Matching Ethernet PW FEC defined ✓ · Matching PW ID configured ✓ · Local/remote service labels inspected ✓ · PW UP verified ✓ · CE1 Ethernet frame sent ✓ · PE1 two-label push inspected ✓ · P-router outer-label swap inspected ✓ · PE2 PW-label lookup inspected ✓ · Frame delivered to CE2 ✓ · Reverse direction verified with a different PW label ✓.",
    requiresState: (state) => state.troubleshooting.verified === true,
  },
  {
    id: "complete",
    label: "Complete",
    narrative: `You built a traditional LDP-signaled pseudowire from real distributed concepts: attachment circuits, a targeted LDP session, a PW FEC both PEs had to agree on, directional receive-label allocation, and two-label forwarding where the core only ever touches the outer label. You verified forward and reverse traffic use different PW labels, diagnosed a PW ID mismatch, and confirmed the fix with a real frame. +550 XP awarded.`,
  },
];

function stepIdx(id: string): number {
  return mplsL2vpnVpwsSteps.findIndex((s) => s.id === id);
}
export const STEP_IDX = {
  topologyIntro: stepIdx("topology-intro"),
  serviceInstanceIntro: stepIdx("service-instance-intro"),
  transportRecapIntro: stepIdx("transport-recap-intro"),
  transportLspUp: stepIdx("transport-lsp-up"),
  targetedLdpIntro: stepIdx("targeted-ldp-intro"),
  targetedOperational: stepIdx("targeted-operational"),
  pwFecIntro: stepIdx("pw-fec-intro"),
  directionalAllocIntro: stepIdx("directional-label-alloc-intro"),
  pwUp: stepIdx("pw-up"),
  packetBeforeEncap: stepIdx("packet-before-encap"),
  twoLabelStackSignature: stepIdx("two-label-stack-signature"),
  pe2Deliver: stepIdx("pe2-deliver"),
  reverseDirectionIntro: stepIdx("reverse-direction-intro"),
  forwardReverseComparison: stepIdx("forward-reverse-comparison"),
  controlWordIntro: stepIdx("control-word-intro"),
  acDownExperiment: stepIdx("ac-down-experiment"),
  restoreAc: stepIdx("restore-ac"),
  mtuLabNote: stepIdx("mtu-lab-note"),
  troubleshootingIntro: stepIdx("troubleshooting-intro"),
  diagnosticLadder: stepIdx("diagnostic-ladder"),
  repairChallenge: stepIdx("repair-challenge"),
  engineerChallengeIntro: stepIdx("engineer-challenge-intro"),
  complete: stepIdx("complete"),
};

// ---------------------------------------------------------------------------
// CLI perspectives — CONCEPT / Cisco IOS-XR / Junos.
// ---------------------------------------------------------------------------
export interface VpwsCliVendorOutput {
  cmd: string;
  output: string;
}
export interface VpwsCliEntry {
  id: string;
  label: string;
  concept: string;
  cisco: VpwsCliVendorOutput;
  juniper: VpwsCliVendorOutput;
}
export function buildVpwsCliCommands(state: MplsL2vpnVpwsState, router: RouterId): VpwsCliEntry[] {
  const pwState = pwStateFor(state);
  const compat = pwCompatibilityFor(state);
  const ac = resolveAttachmentCircuit(state.acs, router as RouterId);
  return [
    {
      id: "targeted-ldp",
      label: "Targeted LDP Peer",
      concept: "The direct logical session between PE loopbacks that signals this pseudowire — separate from ordinary hop-by-hop transport LDP.",
      cisco: { cmd: `show mpls ldp neighbor ${ROUTER_LOOPBACK.PE2 ?? ""} detail`, output: `Peer: ${ROUTER_LOOPBACK.PE2}\nState: ${state.targetedLdp}\nType: Targeted` },
      juniper: { cmd: `show ldp session ${ROUTER_LOOPBACK.PE2} extensive`, output: `peer ${ROUTER_LOOPBACK.PE2};\nstate ${state.targetedLdp.toLowerCase()};\ntargeted true;` },
    },
    {
      id: "pw",
      label: "Pseudowire ID / Service Type",
      concept: "The FEC both PEs must agree on — PW Type + PW ID identify the service, never the label itself.",
      cisco: { cmd: `show mpls l2transport vc ${state.pe1Config.fec.pwId}`, output: `VC ID: ${state.pe1Config.fec.pwId} (local) / ${state.pe2Config.fec.pwId} (remote)\nType: ${state.pe1Config.fec.pwType}\nStatus: ${pwState}` },
      juniper: { cmd: `show l2circuit connections`, output: `neighbor ${ROUTER_LOOPBACK.PE2} pw-id ${state.pe1Config.fec.pwId};\nremote pw-id ${state.pe2Config.fec.pwId};\nstatus ${pwState.toLowerCase()};` },
    },
    {
      id: "labels",
      label: "Local / Remote Labels",
      concept: "Directional, locally-allocated receive labels — the receiver advertises the label the sender should use toward it.",
      cisco: { cmd: `show mpls l2transport vc detail`, output: `Local label: ${state.pe1Config.localReceiveLabel} (PE1) / ${state.pe2Config.localReceiveLabel} (PE2)\nRemote label learned at PE1: ${state.remoteLabelKnownAtPe1 ?? "none"}\nRemote label learned at PE2: ${state.remoteLabelKnownAtPe2 ?? "none"}` },
      juniper: { cmd: `show l2circuit connections extensive`, output: `local-label ${state.pe1Config.localReceiveLabel};\nremote-label-pe1 ${state.remoteLabelKnownAtPe1 ?? "none"};\nremote-label-pe2 ${state.remoteLabelKnownAtPe2 ?? "none"};` },
    },
    {
      id: "ac",
      label: "Attachment Circuit State",
      concept: "The local customer-facing interface — a healthy PW still requires both ACs to be up.",
      cisco: { cmd: `show interfaces ${ac?.interfaceName ?? "unknown"}`, output: `Interface: ${ac?.interfaceName ?? "n/a"}\nVLAN: ${ac?.vlan ?? "n/a"}\nStatus: ${ac?.up ? "up" : "DOWN"}` },
      juniper: { cmd: `show interfaces ${ac?.interfaceName ?? "unknown"} terse`, output: `${ac?.interfaceName ?? "n/a"}  ${ac?.up ? "up" : "down"}  vlan ${ac?.vlan ?? "n/a"}` },
    },
    {
      id: "transport",
      label: "Transport LSP",
      concept: "The outer label's job — get the packet to the far-end PE. Independent of the pseudowire signaling above it.",
      cisco: { cmd: `show mpls forwarding-table`, output: state.journey.filter((h) => h.device === router).map((h) => `In: ${h.input}  Action: ${h.action}  Out: ${h.output}`).join("\n") || "(no forwarding entry recorded at this router yet)" },
      juniper: { cmd: `show route forwarding-table`, output: state.journey.filter((h) => h.device === router).map((h) => `in ${h.input} -> ${h.action} -> out ${h.output}`).join("\n") || "(no forwarding entry recorded at this router yet)" },
    },
    {
      id: "pw-status",
      label: "Pseudowire Status",
      concept: pwState === "UP" ? "All PW UP criteria are currently satisfied." : `Not UP — ${compat.reasons.join(" ") || "check AC/targeted-LDP/transport state."}`,
      cisco: { cmd: `show mpls l2transport vc ${state.pe1Config.fec.pwId} status`, output: `Status: ${pwState}\nFEC match: ${compat.fecMatch ? "yes" : "no"}` },
      juniper: { cmd: `show l2circuit connections up`, output: `status ${pwState.toLowerCase()};\nfec-match ${compat.fecMatch};` },
    },
  ];
}
