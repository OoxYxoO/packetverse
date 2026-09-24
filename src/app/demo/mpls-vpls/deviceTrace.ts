import type { DeviceInterfaceData, DeviceProcessingTrace, LinkDetail, PacketMutation, PacketStackFrame, ProcessingStage } from "@/components/network3d/types";
import type { PacketVisual } from "@/lib/sim-engine/types";
import { LINKS, PE_ROUTERS, resolveAttachmentCircuit, type JourneyAction, type JourneyHop, type LinkDef, type MplsVplsState, type RouterId } from "@/lib/sim-engine/scenarios/mplsVpls";

/**
 * Scene Adapter for the traditional MPLS VPLS lesson's device-interior
 * 3D view. Every stage list and interface/link value below is derived
 * FROM MplsVplsState — this file makes no bridging or split-horizon
 * decision itself.
 */

const CE_PIPELINE: ProcessingStage[] = [
  { id: "ac", label: "Attachment Circuit" },
  { id: "deliver", label: "Deliver / Receive" },
];
const PE_PIPELINE: ProcessingStage[] = [
  { id: "ingress", label: "Ingress (AC or PW)" },
  { id: "learn", label: "Learn Source MAC" },
  { id: "lookup", label: "Destination Lookup" },
  { id: "decide", label: "Forwarding Decision (Split Horizon)" },
  { id: "encap", label: "Label Push / Pop" },
  { id: "deliver", label: "Deliver / Forward" },
];
const TRANSIT_PIPELINE: ProcessingStage[] = [
  { id: "ingress", label: "MPLS Ingress" },
  { id: "label-lookup", label: "Top (Transport) Label Lookup" },
  { id: "transport-forward", label: "Transport Forwarding" },
  { id: "forward", label: "Forward (Inner PW Label Untouched)" },
];

const PE_STAGE_ORDER = PE_PIPELINE.map((s) => s.id);
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
  return LINKS.filter((l) => l.a === router || l.b === router).map((l) => ({ neighbor: l.a === router ? l.b : l.a, link: l }));
}
function ifaceId(router: RouterId, neighbor: RouterId): string {
  return `${router}-${neighbor}`;
}

// ---------------------------------------------------------------------------
// Hop enrichment (additive DeviceProcessingTrace fields feeding
// HopInspectorPanel/PacketDiffViewer) — every value below is derived from
// the JourneyHop the scenario's own step `run()` already wrote, never a
// second, competing decision made here.
// ---------------------------------------------------------------------------

const LOOKUP_TYPE_BY_ACTION: Partial<Record<JourneyAction, string>> = {
  AC_INGRESS: "Attachment Circuit — Source MAC Learning",
  PW_INGRESS: "Pseudowire Label Lookup — Source MAC Learning",
  LEARN_SOURCE: "Source MAC Learning + Destination Lookup",
  LOOKUP_DEST: "FDB Destination Lookup",
  REPLICATE: "Flood Egress Set (BUM)",
  PUSH_PW: "Remote PW Receive Label (learned via targeted LDP) + Transport LSP",
  PUSH_TRANSPORT: "Transport LSP",
  SWAP_TRANSPORT: "Transport Forwarding Table (outer label only)",
  POP_TRANSPORT: "Transport Forwarding Table — PHP / implicit-null",
  PW_LOOKUP: "PW Label Resolution → Service + AC Delivery",
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

/** Pulls real "label N (transport|service)" mentions straight out of the hop's own input/output text (the scenario's own authoritative description) — never a value not already written there. Same principle as mpls-l2vpn-vpws's `extractLabelFrames`. */
function extractLabelFrames(prefix: "before" | "after", text: string): PacketStackFrame[] {
  const frames: PacketStackFrame[] = [];
  const re = /label (\d+) \((transport|service)\)/g;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    frames.push({ id: `${prefix}-${m[2]}-${i}`, text: `${m[2] === "transport" ? "Transport" : "PW"} ${m[1]}`, tone: m[2] === "transport" ? "transport" : "vpn", justChanged: prefix === "after" });
    i++;
  }
  if (/Ethernet frame|Delivered/.test(text)) frames.push({ id: `${prefix}-eth`, text: "Ethernet", tone: "generic" });
  return frames;
}

/** The physical neighbor a PE's Attachment Circuit connects to — a structural fact about that specific PE (PE1's only non-core neighbor is always CE1), never a positional/neighbor-array guess. Used ONLY as the fallback when a hop has no earlier journey entry to derive ingress from at all. */
const AC_PEER: Partial<Record<RouterId, RouterId>> = { PE1: "CE1", PE2: "CE2", PE3: "CE3" };

/**
 * Previous different-device journey entry — the router this hop's frame
 * actually arrived FROM. Walks backward past same-device entries so the
 * ingress interface reflects the true prior hop, never a device's own
 * fixed neighbor-array slot (§17's "Known correctness fix" — P1 alone
 * has three neighbors, so a fixed nbrs[0]/nbrs[1] pick is actively wrong
 * here, not just imprecise). Falls back to the AC peer only when no
 * earlier journey entry exists at all.
 */
function prevRouterFor(hop: JourneyHop, state: MplsVplsState): RouterId | undefined {
  const idx = state.journey.indexOf(hop);
  for (let i = idx - 1; i >= 0; i--) {
    if (state.journey[i].device !== hop.device) return state.journey[i].device;
  }
  return AC_PEER[hop.device];
}
/**
 * Next different-device journey entry — ONLY the immediately-following
 * entry, never skipping ahead over later hops. Falls back to
 * `state.packetAt` when this hop is the most-recently-recorded one and
 * the packet has already moved there (mirrors mpls-ldp's `nextHopFor`).
 */
function nextRouterFor(hop: JourneyHop, state: MplsVplsState): RouterId | undefined {
  const idx = state.journey.indexOf(hop);
  const next = state.journey[idx + 1];
  if (next) return next.device !== hop.device ? next.device : undefined;
  const isLast = idx === state.journey.length - 1;
  if (isLast && state.packetAt && state.packetAt !== hop.device) return state.packetAt;
  return undefined;
}
function ingressIfaceFor(router: RouterId, hop: JourneyHop | undefined, state: MplsVplsState): string | undefined {
  if (!hop) return undefined;
  const prev = prevRouterFor(hop, state);
  return prev ? ifaceId(router, prev) : undefined;
}
function egressIfaceFor(router: RouterId, hop: JourneyHop | undefined, state: MplsVplsState): string | undefined {
  if (!hop) return undefined;
  const next = nextRouterFor(hop, state);
  return next ? ifaceId(router, next) : undefined;
}

/**
 * Which router is the primary inspection subject of a no-packet
 * control-plane/lab step (targeted LDP mesh readiness, a flood/lookup
 * decision recorded only via `run()` with no `.packet`, the MAC-aging
 * lab, the fault/repair sequence) — these never touch `state.packet`, so
 * `deviceForStep` needs a fixed subject the way mpls-ldp's
 * `PRIMARY_TRANSITION_ROUTER` does. A packet-carrying step otherwise
 * resolves from the packet's own `from`/`to` (sender priority): for PUSH /
 * core-forwarding visuals the sender is the router whose JourneyHop the
 * step records. That is NOT true for ingress visuals — see
 * `PACKET_INSPECTION_DEVICE` below.
 *
 * `pe3-parallel-copy` is deliberately included even though that step
 * pushes no journey hop for PE3 (it only updates PE3's FDB) — clicking
 * that timeline entry still points the learner at PE3 so its live FDB
 * update is visible via Device Explorer, honestly showing "no hop
 * recorded yet" in the Hop Inspector rather than fabricating one.
 */
export const PRIMARY_TRANSITION_ROUTER: Partial<Record<string, RouterId>> = {
  "targeted-ldp-operational": "PE1",
  "pe1-lookup-ce2-unknown": "PE1",
  "pe1-flood-decision": "PE1",
  "pe3-parallel-copy": "PE3",
  "pe1-flood-broadcast": "PE1",
  "age-ce2-entry": "PE1",
  "send-after-aging-unknown-again": "PE1",
  "relearn-after-flood": "PE1",
  "mac-move-demonstrate": "PE1",
  "troubleshooting-intro": "PE1",
  "fault-injection": "PE1",
  "diagnostic-ladder": "PE1",
  "repair-challenge": "PE1",
  "repaired-recompute": "PE1",
  "engineer-challenge-confirm": "PE1",
};

/**
 * Packet steps whose visual shows the frame ARRIVING at a PE (CE → PE,
 * P2 → PE2) or originating at a CE, while the step's run() records the
 * modeled action — source learning, PW lookup, flood/split-horizon decision
 * — as a JourneyHop on the receiving PE. Sender priority would point
 * Historical at the CE/P router instead (an empty CE trace, or a P router's
 * older transit hop).
 */
const PACKET_INSPECTION_DEVICE: Partial<Record<string, RouterId>> = {
  "pe1-learn-ce1": "PE1",
  "pe2-pw-lookup-learn-ce1": "PE2",
  "pe2-learn-ce2-local": "PE2",
  "move-ce2-to-pe3": "PE3",
  "demonstrate-fault": "PE1",
  "signature-fault-visual": "PE2",
};

export function deviceForStep(stepId: string, packet: PacketVisual | undefined): RouterId | undefined {
  const processingDevice = PACKET_INSPECTION_DEVICE[stepId];
  if (processingDevice) return processingDevice;
  if (packet) return (packet.from ?? packet.to) as RouterId;
  return PRIMARY_TRANSITION_ROUTER[stepId];
}

export function traceFor(router: RouterId, state: MplsVplsState): DeviceProcessingTrace | undefined {
  const nbrs = neighborLinks(router);
  const hops = state.journey.filter((h) => h.device === router);
  const hop = hops[hops.length - 1];
  const isCurrent = state.journey.length > 0 && state.journey[state.journey.length - 1] === hop;

  if (router === "CE1" || router === "CE2" || router === "CE3") {
    // A CE has exactly one physical neighbor — its own PE — so this is a
    // structural fact, not a positional guess, unlike the multi-neighbor
    // PE/P case below.
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

  if (PE_ROUTERS.includes(router)) {
    const ingressIfaceId = ingressIfaceFor(router, hop, state);
    const egressIfaceId = egressIfaceFor(router, hop, state);
    const base: DeviceProcessingTrace = { deviceId: router, ingressInterfaceId: ingressIfaceId, egressInterfaceId: egressIfaceId, stages: PE_PIPELINE, completedStageIds: [] };
    if (!hop) return base;
    const activeStageId = stageForAction(hop.action);
    const activeIdx = PE_STAGE_ORDER.indexOf(activeStageId);
    const completed = PE_STAGE_ORDER.slice(0, isCurrent ? activeIdx : activeIdx + 1);
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
    return { ...base, completedStageIds: allIds(PE_PIPELINE), packetBefore: hop.input, packetAfter: hop.output, ...enrichment };
  }

  // P1, P2, P3 — ordinary transport transit, no VPLS bridge state. P1 has
  // THREE neighbors (PE1, P2, P3) — exactly the case the directional-
  // interface fix exists for; a fixed nbrs[0]/nbrs[1] pick would silently
  // report the wrong ingress/egress pair for at least one of P1's two
  // possible core branches.
  const ingressIfaceId = ingressIfaceFor(router, hop, state);
  const egressIfaceId = egressIfaceFor(router, hop, state);
  const base: DeviceProcessingTrace = { deviceId: router, ingressInterfaceId: ingressIfaceId, egressInterfaceId: egressIfaceId, stages: TRANSIT_PIPELINE, completedStageIds: [] };
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

export function packetFramesFor(state: MplsVplsState): PacketStackFrame[] | undefined {
  if (!state.packet) return undefined;
  const labelFrames: PacketStackFrame[] = state.packet.labels.map((l, idx) => ({
    id: `label-${idx}`,
    text: `${l.purpose === "transport" ? "Transport" : "PW"} ${l.value}`,
    tone: l.purpose === "transport" ? "transport" : "vpn",
    justChanged: idx === 0,
  }));
  return [...labelFrames, { id: "eth", text: "Ethernet", tone: "generic" }];
}

export function interfacesFor(router: RouterId, state: MplsVplsState): DeviceInterfaceData[] {
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

export function linkDetailFor(linkId: string, state: MplsVplsState): LinkDetail | undefined {
  const link = LINKS.find((l) => l.id === linkId);
  if (!link) return undefined;
  const isAccessLink = link.igpMetric === undefined;
  const acA = PE_ROUTERS.includes(link.a) ? resolveAttachmentCircuit(state.acs, link.a) : undefined;
  const acB = PE_ROUTERS.includes(link.b) ? resolveAttachmentCircuit(state.acs, link.b) : undefined;
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
