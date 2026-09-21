import type { DeviceInterfaceData, DeviceProcessingTrace, LinkDetail, PacketMutation, PacketStackFrame, ProcessingStage } from "@/components/network3d/types";
import type { PacketVisual } from "@/lib/sim-engine/types";
import {
  CUST_A_RT,
  LINKS,
  PE_ROUTERS,
  RD_BY_PE,
  VE_ID_BY_PE,
  resolveAttachmentCircuit,
  type BgpVplsState,
  type LinkDef,
  type PeRouterId,
  type RouterId,
} from "@/lib/sim-engine/scenarios/bgpVpls";
import type { JourneyAction, JourneyHop } from "@/lib/sim-engine/scenarios/mplsVpls";

/**
 * Scene Adapter for BGP-Signaled VPLS's device-interior 3D view.
 *
 * Two genuinely distinct journeys share this one `traceFor` (mirrors
 * mpls-ldp's LDP-control-vs-MPLS-data pattern, and the same reasoning
 * mpls-vpls itself uses for its single Ethernet-only journey): a BGP
 * control-plane journey (`state.bgpJourney` — ADVERTISE/REFLECT/
 * RECEIVE/RT_IMPORT/RT_REJECT/WITHDRAW, membership + label-block
 * signaling only) and a customer Ethernet data-plane journey
 * (`state.journey` — AC/PW ingress, MAC learning, flooding, split
 * horizon, label push/swap/pop — reused byte-for-byte from
 * mplsVpls.ts, since changing how PWs are SIGNALED never changes how
 * Ethernet frames are switched once they exist). `BGP_STEP_HANDLERS`
 * below is keyed off the exact step id so a PE's trace never guesses
 * which journey is "current" — it reads the one the scenario's own
 * step actually populated. Every field is derived from state that
 * already exists; nothing here invents a route, a label, or a MAC.
 */

const CE_PIPELINE: ProcessingStage[] = [
  { id: "ac", label: "Attachment Circuit" },
  { id: "deliver", label: "Deliver / Receive" },
];
const PE_DATA_PIPELINE: ProcessingStage[] = [
  { id: "ingress", label: "Ingress (AC or PW)" },
  { id: "learn", label: "Learn Source MAC" },
  { id: "lookup", label: "Destination Lookup" },
  { id: "decide", label: "Forwarding Decision (Split Horizon)" },
  { id: "encap", label: "Label Push / Pop" },
  { id: "deliver", label: "Deliver / Forward" },
];
const PE_BGP_PIPELINE: ProcessingStage[] = [
  { id: "build-nlri", label: "Build VPLS NLRI" },
  { id: "advertise", label: "Advertise to RR1" },
  { id: "receive", label: "Receive Reflected NLRI" },
  { id: "rt-check", label: "RT Import Check" },
  { id: "discover", label: "Auto-Discovery / PW Ready" },
];
const RR_PIPELINE: ProcessingStage[] = [
  { id: "receive", label: "Receive VPLS NLRI" },
  { id: "reflect", label: "Reflect To Other Clients" },
];
const TRANSIT_PIPELINE: ProcessingStage[] = [
  { id: "ingress", label: "MPLS Ingress" },
  { id: "label-lookup", label: "Top (Transport) Label Lookup" },
  { id: "transport-forward", label: "Transport Forwarding" },
  { id: "forward", label: "Forward (Inner Service Label Untouched)" },
];

const PE_DATA_STAGE_ORDER = PE_DATA_PIPELINE.map((s) => s.id);
function stageForAction(action: JourneyAction): string {
  switch (action) {
    case "AC_INGRESS":
    case "PW_INGRESS":
      return "ingress";
    case "LEARN_SOURCE":
      return "learn";
    case "LOOKUP_DEST":
    case "PW_LOOKUP":
      return "lookup";
    case "REPLICATE":
    case "SPLIT_HORIZON_BLOCK":
      return "decide";
    case "PUSH_PW":
    case "PUSH_TRANSPORT":
    case "SWAP_TRANSPORT":
    case "POP_TRANSPORT":
      return "encap";
    default:
      return "deliver";
  }
}
const allIds = (s: ProcessingStage[]) => s.map((x) => x.id);

function neighborLinks(router: RouterId): { neighbor: RouterId; link: LinkDef }[] {
  return LINKS.filter((l) => l.a === router || l.b === router).map((l) => ({ neighbor: (l.a === router ? l.b : l.a) as RouterId, link: l }));
}
function ifaceId(router: RouterId, neighbor: RouterId): string {
  return `${router}-${neighbor}`;
}

// ---------------------------------------------------------------------------
// Data-plane hop enrichment — verbatim pattern from mpls-vpls/deviceTrace.ts
// (identical JourneyAction vocabulary, since bgp-vpls reuses mplsVpls.ts's
// data plane unmodified).
// ---------------------------------------------------------------------------

const LOOKUP_TYPE_BY_ACTION: Partial<Record<JourneyAction, string>> = {
  AC_INGRESS: "Attachment Circuit — Source MAC Learning",
  PW_INGRESS: "Pseudowire Label Lookup — Source MAC Learning",
  LEARN_SOURCE: "Source MAC Learning + Destination Lookup",
  LOOKUP_DEST: "FDB Destination Lookup",
  REPLICATE: "Flood Egress Set (BUM)",
  PUSH_PW: "BGP-Derived Remote PW Label + Transport LSP",
  PUSH_TRANSPORT: "Transport LSP",
  SWAP_TRANSPORT: "Transport Forwarding Table (outer label only)",
  POP_TRANSPORT: "Transport Forwarding Table — PHP / implicit-null",
  PW_LOOKUP: "Service Label Resolution → Service + AC Delivery",
  SPLIT_HORIZON_BLOCK: "Egress Set + Pseudowire Split-Horizon Filter",
  AC_EGRESS: "Attachment Circuit Delivery",
  AC_UNAVAILABLE: "Attachment Circuit — unavailable",
};

function mutationsForAction(hop: JourneyHop): PacketMutation[] {
  switch (hop.action) {
    case "PUSH_PW":
    case "PUSH_TRANSPORT":
      return [{ type: "PUSH", detail: hop.output }];
    case "SWAP_TRANSPORT":
      return [{ type: "SWAP", detail: hop.output }];
    case "POP_TRANSPORT":
    case "PW_LOOKUP":
      return [{ type: "POP", detail: hop.input }];
    default:
      return [];
  }
}

/** Pulls real "label N (transport|service)" mentions straight out of the hop's own input/output text — never a value not already written there. */
function extractLabelFrames(prefix: "before" | "after", text: string): PacketStackFrame[] {
  const frames: PacketStackFrame[] = [];
  const re = /label (\d+) \((transport|service)\)/g;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    frames.push({ id: `${prefix}-${m[2]}-${i}`, text: `${m[2] === "transport" ? "Transport" : "Service"} ${m[1]}`, tone: m[2] === "transport" ? "transport" : "vpn", justChanged: prefix === "after" });
    i++;
  }
  if (/Ethernet frame|Delivered/.test(text)) frames.push({ id: `${prefix}-eth`, text: "Ethernet", tone: "generic" });
  return frames;
}

const AC_PEER: Partial<Record<RouterId, RouterId>> = { PE1: "CE1", PE2: "CE2", PE3: "CE3" };

/** Previous different-device journey entry — walks backward past same-device entries, never a fixed neighbor-array slot. */
function prevRouterFor(hop: JourneyHop, state: BgpVplsState): RouterId | undefined {
  const idx = state.journey.indexOf(hop);
  for (let i = idx - 1; i >= 0; i--) {
    if (state.journey[i].device !== hop.device) return state.journey[i].device as RouterId;
  }
  return AC_PEER[hop.device as RouterId];
}
function nextRouterFor(hop: JourneyHop, state: BgpVplsState): RouterId | undefined {
  const idx = state.journey.indexOf(hop);
  const next = state.journey[idx + 1];
  if (next) return next.device !== hop.device ? (next.device as RouterId) : undefined;
  const isLast = idx === state.journey.length - 1;
  if (isLast && state.packetAt && state.packetAt !== hop.device) return state.packetAt;
  return undefined;
}
function ingressIfaceFor(router: RouterId, hop: JourneyHop | undefined, state: BgpVplsState): string | undefined {
  if (!hop) return undefined;
  const prev = prevRouterFor(hop, state);
  return prev ? ifaceId(router, prev) : undefined;
}
function egressIfaceFor(router: RouterId, hop: JourneyHop | undefined, state: BgpVplsState): string | undefined {
  if (!hop) return undefined;
  const next = nextRouterFor(hop, state);
  return next ? ifaceId(router, next) : undefined;
}

function dataTraceFor(router: RouterId, state: BgpVplsState): DeviceProcessingTrace {
  const hops = state.journey.filter((h) => h.device === router);
  const hop = hops[hops.length - 1];
  const isCurrent = state.journey.length > 0 && state.journey[state.journey.length - 1] === hop;

  if (router === "CE1" || router === "CE2" || router === "CE3") {
    const nbrs = neighborLinks(router);
    const onlyIface = nbrs[0] ? ifaceId(router, nbrs[0].neighbor) : undefined;
    const base: DeviceProcessingTrace = { deviceId: router, ingressInterfaceId: onlyIface, egressInterfaceId: onlyIface, stages: CE_PIPELINE, completedStageIds: [] };
    if (!hop) return base;
    const enrichment = {
      lookupType: LOOKUP_TYPE_BY_ACTION[hop.action],
      lookupKey: hop.input,
      lookupResult: `${hop.action} → ${hop.output}`,
      reason: hop.lookup,
      packetBeforeFrames: extractLabelFrames("before", hop.input),
      packetAfterFrames: extractLabelFrames("after", hop.output),
      mutations: mutationsForAction(hop),
    };
    if (isCurrent) return { ...base, activeStageId: hop.action === "AC_EGRESS" ? "deliver" : "ac", completedStageIds: hop.action === "AC_EGRESS" ? ["ac"] : [], packetBefore: hop.input, packetAfter: hop.output, ...enrichment };
    return { ...base, completedStageIds: allIds(CE_PIPELINE), packetBefore: hop.input, packetAfter: hop.output, ...enrichment };
  }

  if (PE_ROUTERS.includes(router as PeRouterId)) {
    const ingressInterfaceId = ingressIfaceFor(router, hop, state);
    const egressInterfaceId = egressIfaceFor(router, hop, state);
    const base: DeviceProcessingTrace = { deviceId: router, ingressInterfaceId, egressInterfaceId, stages: PE_DATA_PIPELINE, completedStageIds: [] };
    if (!hop) return base;
    const activeStageId = stageForAction(hop.action);
    const activeIdx = PE_DATA_STAGE_ORDER.indexOf(activeStageId);
    const completed = PE_DATA_STAGE_ORDER.slice(0, isCurrent ? activeIdx : activeIdx + 1);
    const nextRouter = nextRouterFor(hop, state);
    const enrichment = {
      lookupType: LOOKUP_TYPE_BY_ACTION[hop.action],
      lookupKey: hop.input,
      lookupResult: `${hop.action} → ${hop.output}`,
      reason: hop.lookup,
      nextHopId: nextRouter,
      nextHopLabel: nextRouter,
      packetBeforeFrames: extractLabelFrames("before", hop.input),
      packetAfterFrames: extractLabelFrames("after", hop.output),
      mutations: mutationsForAction(hop),
    };
    if (isCurrent) return { ...base, activeStageId, completedStageIds: completed, packetBefore: hop.input, packetAfter: hop.output, ...enrichment };
    return { ...base, completedStageIds: allIds(PE_DATA_PIPELINE), packetBefore: hop.input, packetAfter: hop.output, ...enrichment };
  }

  // P1, P2, P3 — ordinary transport transit, no BGP/VPLS bridge state at all.
  const ingressInterfaceId = ingressIfaceFor(router, hop, state);
  const egressInterfaceId = egressIfaceFor(router, hop, state);
  const base: DeviceProcessingTrace = { deviceId: router, ingressInterfaceId, egressInterfaceId, stages: TRANSIT_PIPELINE, completedStageIds: [] };
  if (!hop) return base;
  const nextRouter = nextRouterFor(hop, state);
  const enrichment = {
    lookupType: LOOKUP_TYPE_BY_ACTION[hop.action],
    lookupKey: hop.input,
    lookupResult: `${hop.action} → ${hop.output}`,
    reason: hop.lookup,
    nextHopId: nextRouter,
    nextHopLabel: nextRouter,
    packetBeforeFrames: extractLabelFrames("before", hop.input),
    packetAfterFrames: extractLabelFrames("after", hop.output),
    mutations: mutationsForAction(hop),
  };
  if (isCurrent) return { ...base, activeStageId: "forward", completedStageIds: ["ingress", "label-lookup", "transport-forward"], packetBefore: hop.input, packetAfter: hop.output, ...enrichment };
  return { ...base, completedStageIds: allIds(TRANSIT_PIPELINE), packetBefore: hop.input, packetAfter: hop.output, ...enrichment };
}

// ---------------------------------------------------------------------------
// BGP control-plane hop enrichment — kept semantically separate from the
// data-plane trace above (§10/§20 of the migration brief): a lookup here is
// always an RT/membership/label-block fact, never a MAC/PW forwarding
// decision. Every value is read directly off BgpVplsState — no lookup
// result, label, or route is invented for a step that hasn't executed yet.
// ---------------------------------------------------------------------------

function rrTraceFor(state: BgpVplsState, currentStepId: string): DeviceProcessingTrace {
  const hop = state.bgpJourney[state.bgpJourney.length - 1];
  const base: DeviceProcessingTrace = { deviceId: "RR1", stages: RR_PIPELINE, completedStageIds: [] };
  if (!hop || hop.device !== "RR1" || currentStepId !== "rr1-reflects") {
    const anyReflected = state.bgpJourney.some((h) => h.device === "RR1");
    return { ...base, completedStageIds: anyReflected ? allIds(RR_PIPELINE) : [] };
  }
  return {
    ...base,
    activeStageId: "reflect",
    completedStageIds: ["receive"],
    lookupType: "Client-to-Client Reflection",
    lookupKey: hop.input,
    lookupResult: hop.output,
    reason: "RR1 reflects a client-learned VPLS NLRI to its other clients — the identical iBGP reflection rule from the BGP Route Reflector lesson, now carrying a VPLS NLRI instead of an IPv4 route.",
    nextHopId: undefined,
    packetBefore: "Received from PE1 only",
    packetAfter: hop.output,
  };
}

interface BgpStepHandler {
  router: PeRouterId;
  build: (state: BgpVplsState) => DeviceProcessingTrace;
}

function peAdvertiseTrace(pe: PeRouterId): (state: BgpVplsState) => DeviceProcessingTrace {
  return (state) => {
    const nlri = state.localAdvertisements[pe];
    return {
      deviceId: pe,
      stages: PE_BGP_PIPELINE,
      activeStageId: "advertise",
      completedStageIds: ["build-nlri"],
      lookupType: "Local VPLS Config → NLRI",
      lookupKey: `RD ${RD_BY_PE[pe]}, VE ID ${VE_ID_BY_PE[pe]}`,
      lookupResult: nlri ? `Sent to RR1 — RT ${nlri.routeTarget}` : "—",
      reason: `${pe} builds one VPLS NLRI carrying its RD, VE ID, label block, and Route Target, and sends it to RR1 — no PE-to-PE session is needed for this.`,
      nextHopId: "RR1",
      nextHopLabel: "RR1",
      packetBefore: "No local advertisement yet",
      packetAfter: nlri ? `RD ${nlri.rd}, VE ID ${nlri.veId}, Label Base ${nlri.block.labelBase}, RT ${nlri.routeTarget} → RR1` : undefined,
    };
  };
}

function peReceiveTrace(pe: PeRouterId, fromPe: PeRouterId): (state: BgpVplsState) => DeviceProcessingTrace {
  return (state) => {
    const nlri = state.localAdvertisements[fromPe];
    return {
      deviceId: pe,
      stages: PE_BGP_PIPELINE,
      activeStageId: "receive",
      completedStageIds: [],
      lookupType: "Adj-RIB-In",
      lookupKey: `NLRI from ${fromPe} (via RR1)`,
      lookupResult: "Stored — no RT import check applied yet",
      reason: "A BGP speaker stores everything it receives before any import policy decides whether to use it — RECEIVED and IMPORTED are two separate facts.",
      packetBefore: "No received NLRIs yet",
      packetAfter: nlri ? `Received: ${fromPe}'s NLRI (RD ${nlri.rd})` : undefined,
    };
  };
}

function peRtCheckTrace(pe: PeRouterId, fromPe: PeRouterId): (state: BgpVplsState) => DeviceProcessingTrace {
  return (state) => {
    const nlri = state.localAdvertisements[fromPe];
    const importRt = state.importRtByPe[pe];
    const matched = nlri?.routeTarget === importRt;
    return {
      deviceId: pe,
      stages: PE_BGP_PIPELINE,
      activeStageId: "discover",
      completedStageIds: ["receive", "rt-check"],
      lookupType: "Route Target Import Check",
      lookupKey: `RT ${nlri?.routeTarget ?? "—"} vs. ${pe} import RT ${importRt}`,
      lookupResult: matched ? "MATCH — imported" : "NO MATCH — rejected",
      reason: matched ? `The Route Target carried by ${fromPe}'s NLRI matches ${pe}'s own import RT, so ${fromPe} is imported as a CUST-A-VPLS member and its VE ID/label block become usable for PW signaling.` : `The Route Targets don't match, so ${fromPe}'s NLRI is received but never imported — no membership, no PW.`,
      nextHopId: matched ? fromPe : undefined,
      packetBefore: "RECEIVED (not yet imported)",
      packetAfter: matched ? `IMPORTED — ${fromPe} discovered as CUST-A-VPLS member` : "REJECTED — Route Target mismatch",
    };
  };
}

const PE3_WITHDRAW_REJOIN_HANDLERS: Record<string, BgpStepHandler> = {
  "pe3-rejoins": {
    router: "PE3",
    build: (state) => {
      const nlri = state.localAdvertisements.PE3;
      return {
        deviceId: "PE3",
        stages: PE_BGP_PIPELINE,
        activeStageId: "advertise",
        completedStageIds: ["build-nlri"],
        lookupType: "Local VPLS Config → NLRI",
        lookupKey: nlri ? `RD ${nlri.rd}, VE ID ${nlri.veId}` : "—",
        lookupResult: "Fresh BGP UPDATE sent to RR1",
        reason: "PE3 re-advertises its VPLS NLRI from scratch — a genuinely new BGP UPDATE, not a cached state restoration. Membership and PW state rebuild entirely from this new advertisement.",
        nextHopId: "RR1",
        nextHopLabel: "RR1",
        packetBefore: "No advertisement (withdrawn)",
        packetAfter: nlri ? `RD ${nlri.rd}, VE ID ${nlri.veId}, RT ${nlri.routeTarget} → RR1 (again)` : undefined,
      };
    },
  },
  "veid-reset-rejoin": {
    router: "PE3",
    build: (state) => ({
      deviceId: "PE3",
      stages: PE_BGP_PIPELINE,
      activeStageId: "build-nlri",
      completedStageIds: [],
      lookupType: "VE ID Change",
      lookupKey: "PE3 local VE ID",
      lookupResult: `${state.veIdByPe.PE3} (reset from 7)`,
      reason: "PE3 returns to its original VE ID 3 — a clean baseline before the next incident — and re-advertises with the new value.",
      packetBefore: "VE ID 7",
      packetAfter: `VE ID ${state.veIdByPe.PE3}; NLRI re-advertised`,
    }),
  },
  "fault-injection": {
    router: "PE3",
    build: (state) => ({
      deviceId: "PE3",
      stages: PE_BGP_PIPELINE,
      activeStageId: "build-nlri",
      completedStageIds: [],
      lookupType: "Route Target Policy Change",
      lookupKey: "PE3 import/export RT",
      lookupResult: `${CUST_A_RT} → ${state.importRtByPe.PE3}`,
      reason: "A deterministic policy fault: PE3's import/export RT no longer matches CUST-A-VPLS. Physical interfaces, IGP, MPLS transport, and PE3's BGP session to RR1 all remain healthy — this is a service-membership policy fault, not a session or transport fault.",
      packetBefore: `RT ${CUST_A_RT} (member)`,
      packetAfter: `RT ${state.importRtByPe.PE3} (no longer matches CUST-A-VPLS)`,
    }),
  },
  "diagnostic-ladder": {
    router: "PE3",
    build: (state) => {
      const healthy = state.importRtByPe.PE3 === CUST_A_RT;
      return {
        deviceId: "PE3",
        stages: PE_BGP_PIPELINE,
        activeStageId: healthy ? "discover" : "rt-check",
        completedStageIds: healthy ? ["build-nlri", "advertise", "receive", "rt-check"] : ["build-nlri", "advertise", "receive"],
        lookupType: "Route Target Import Check",
        lookupKey: `PE3 RT ${state.importRtByPe.PE3} vs. required ${CUST_A_RT}`,
        lookupResult: healthy ? "MATCH" : "NO MATCH — rejected both directions",
        reason: "Physical, IGP, MPLS transport, and BGP session state are all already healthy at this point in the ladder — the fault is proven to live specifically in RT policy, one rung at a time.",
        packetBefore: undefined,
        packetAfter: undefined,
      };
    },
  },
  "repair-challenge": {
    router: "PE3",
    build: (state) => {
      const repaired = state.troubleshooting.repaired === true;
      return {
        deviceId: "PE3",
        stages: PE_BGP_PIPELINE,
        activeStageId: repaired ? "discover" : "build-nlri",
        completedStageIds: repaired ? ["build-nlri", "advertise", "receive", "rt-check"] : [],
        lookupType: "Route Target Policy",
        lookupKey: "PE3 import/export RT",
        lookupResult: repaired ? `Corrected → ${CUST_A_RT}` : `Still ${state.importRtByPe.PE3}`,
        reason: repaired ? "The Route Target is corrected back to the service's real value — membership and PW state can now rebuild." : "Choose the repair that fixes the actual fault: PE3's Route Target policy, not the session, transport, or FDB.",
        packetBefore: "RT 65000:999",
        packetAfter: repaired ? `RT ${CUST_A_RT}` : undefined,
      };
    },
  },
  "repaired-recompute": {
    router: "PE3",
    build: (state) => {
      const nlri = state.localAdvertisements.PE3;
      return {
        deviceId: "PE3",
        stages: PE_BGP_PIPELINE,
        activeStageId: "discover",
        completedStageIds: ["build-nlri", "advertise", "receive", "rt-check"],
        lookupType: "Membership Recompute",
        lookupKey: nlri ? `RT ${nlri.routeTarget}` : "—",
        lookupResult: "PE1 and PE2 now import PE3; PE3 now imports theirs",
        reason: "PE3 re-advertises with the corrected RT — recomputation alone isn't proof of repair; a real frame is verified next.",
        packetBefore: "RT mismatch — no membership",
        packetAfter: "RT corrected — membership and PW mesh rebuilt",
      };
    },
  },
};

const BGP_STEP_HANDLERS: Record<string, BgpStepHandler> = {
  "pe1-advertises": { router: "PE1", build: peAdvertiseTrace("PE1") },
  "pe2-advertises": { router: "PE2", build: peAdvertiseTrace("PE2") },
  "pe3-advertises": { router: "PE3", build: peAdvertiseTrace("PE3") },
  "pe2-receives": { router: "PE2", build: peReceiveTrace("PE2", "PE1") },
  "pe2-rt-import-check": { router: "PE2", build: peRtCheckTrace("PE2", "PE1") },
  "pe3-receives-imports": { router: "PE3", build: peRtCheckTrace("PE3", "PE1") },
  ...PE3_WITHDRAW_REJOIN_HANDLERS,
};

/** Which router is the primary inspection subject of a no-packet DATA-plane step (mirrors mpls-vpls's `PRIMARY_TRANSITION_ROUTER` — every packet-carrying step instead resolves from the packet's own `from`/`to`, sender priority). */
export const PRIMARY_TRANSITION_ROUTER: Partial<Record<string, RouterId>> = {
  "pe1-lookup-ce2-unknown": "PE1",
  "pe1-flood-decision": "PE1",
  "pe3-parallel-copy": "PE3",
  "troubleshooting-intro": "PE3",
  "incident-symptoms": "PE3",
  "received-vs-imported-evidence": "PE3",
  "engineer-challenge-confirm": "PE1",
};

/** Merges BGP-phase and data-phase step→router maps so HopTimeline/historical selection resolves every inspectable no-packet step, BGP or data alike. */
export function deviceForStep(stepId: string, packet: PacketVisual | undefined): RouterId | undefined {
  if (packet) return (packet.from ?? packet.to) as RouterId;
  return BGP_STEP_HANDLERS[stepId]?.router ?? PRIMARY_TRANSITION_ROUTER[stepId];
}

/** Every step id that should appear as its own HopTimeline entry — packet-carrying steps (BGP UPDATE or customer frame alike) plus every no-packet step tracked above. */
export function isHopStep(stepId: string): boolean {
  return BGP_STEP_HANDLERS[stepId] !== undefined || PRIMARY_TRANSITION_ROUTER[stepId] !== undefined;
}

export function traceFor(router: RouterId, state: BgpVplsState, currentStepId: string): DeviceProcessingTrace {
  if (router === "RR1") return rrTraceFor(state, currentStepId);
  const handler = BGP_STEP_HANDLERS[currentStepId];
  if (handler && handler.router === router) return handler.build(state);
  return dataTraceFor(router, state);
}

export function packetFramesFor(state: BgpVplsState): PacketStackFrame[] | undefined {
  if (!state.packet) return undefined;
  const labelFrames: PacketStackFrame[] = state.packet.labels.map((l, idx) => ({
    id: `label-${idx}`,
    text: `${l.purpose === "transport" ? "Transport" : "Service"} ${l.value}`,
    tone: l.purpose === "transport" ? "transport" : "vpn",
    justChanged: idx === 0,
  }));
  return [...labelFrames, { id: "eth", text: "Ethernet", tone: "generic" }];
}

export function interfacesFor(router: RouterId, state: BgpVplsState): DeviceInterfaceData[] {
  if (router === "RR1") {
    return PE_ROUTERS.map((pe) => ({ id: `RR1-${pe}`, name: `to-${pe}`, status: state.mpBgpUp ? "up" : "down", neighborId: pe, neighborLabel: pe, linkType: "Internal (iBGP)", mtu: 1500, protocols: ["BGP"], role: "idle" as const, extra: [{ label: "AFI/SAFI", value: "L2VPN / VPLS" }, { label: "RR Relationship", value: "Client" }] }));
  }
  const ac = resolveAttachmentCircuit(state.acs, router);
  return neighborLinks(router).map(({ neighbor, link }) => ({
    id: `${router}-${neighbor}`,
    name: `to-${neighbor}`,
    status: "up" as const,
    neighborId: neighbor,
    neighborLabel: neighbor,
    linkType: link.igpMetric !== undefined ? "Core" : "Access",
    mtu: 1500,
    protocols: link.igpMetric !== undefined ? ["IGP", "MPLS"] : ["Ethernet"],
    role: "idle" as const,
    extra: link.igpMetric !== undefined ? [{ label: "IGP Metric", value: String(link.igpMetric) }] : ac ? [{ label: "VLAN", value: String(ac.vlan) }, { label: "AC Status", value: ac.up ? "up" : "down" }] : undefined,
  }));
}

export function linkDetailFor(linkId: string, state: BgpVplsState): LinkDetail | undefined {
  const link = LINKS.find((l) => l.id === linkId);
  if (!link) return undefined;
  const isAccessLink = link.igpMetric === undefined;
  const acA = PE_ROUTERS.includes(link.a as PeRouterId) ? resolveAttachmentCircuit(state.acs, link.a) : undefined;
  const acB = PE_ROUTERS.includes(link.b as PeRouterId) ? resolveAttachmentCircuit(state.acs, link.b) : undefined;
  const linkUp = isAccessLink ? (acA?.up ?? acB?.up ?? true) : true;
  return {
    aLabel: link.a,
    bLabel: link.b,
    aInterface: { id: `${link.a}-${link.b}`, name: `to-${link.b}`, status: linkUp ? "up" : "down", neighborId: link.b, neighborLabel: link.b, linkType: isAccessLink ? "Access" : "Core", mtu: 1500, protocols: isAccessLink ? ["Ethernet"] : ["IGP", "MPLS"], role: "idle" },
    bInterface: { id: `${link.b}-${link.a}`, name: `to-${link.a}`, status: linkUp ? "up" : "down", neighborId: link.a, neighborLabel: link.a, linkType: isAccessLink ? "Access" : "Core", mtu: 1500, protocols: isAccessLink ? ["Ethernet"] : ["IGP", "MPLS"], role: "idle" },
    status: linkUp ? "up" : "down",
    mtu: 1500,
    protocols: isAccessLink ? [{ label: "Type", value: "Attachment Circuit" }] : [{ label: "IGP Metric", value: String(link.igpMetric) }],
  };
}
