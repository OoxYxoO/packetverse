import type { DeviceInterfaceData, DeviceProcessingTrace, LinkDetail, PacketMutation, PacketStackFrame, ProcessingStage } from "@/components/network3d/types";
import type { PacketVisual } from "@/lib/sim-engine/types";
import { LINKS, resolveAttachmentCircuit, type JourneyAction, type JourneyHop, type LinkDef, type MplsL2vpnVpwsState, type RouterId } from "@/lib/sim-engine/scenarios/mplsL2vpnVpws";

/**
 * Scene Adapter for the traditional MPLS L2VPN/VPWS lesson's device-
 * interior 3D view. Every stage list and interface/link value below is
 * derived FROM MplsL2vpnVpwsState — this file makes no pseudowire
 * decision itself.
 */

const CE_PIPELINE: ProcessingStage[] = [
  { id: "ac", label: "Attachment Circuit" },
  { id: "deliver", label: "Deliver / Receive" },
];
const PE_INGRESS_PIPELINE: ProcessingStage[] = [
  { id: "ac-ingress", label: "AC Ingress" },
  { id: "service-lookup", label: "Resolve Service / Pseudowire" },
  { id: "push-pw", label: "Push PW Label (Remote Receive Label)" },
  { id: "push-transport", label: "Push Transport Label" },
  { id: "forward", label: "Forward Into Core" },
];
const PE_EGRESS_PIPELINE: ProcessingStage[] = [
  { id: "transport-terminated", label: "Transport Context Terminated" },
  { id: "pw-lookup", label: "PW Label Lookup" },
  { id: "identify-ac", label: "Identify Local AC" },
  { id: "pop-pw", label: "Pop PW Label" },
  { id: "deliver", label: "Deliver Ethernet Frame" },
];
const TRANSIT_PIPELINE: ProcessingStage[] = [
  { id: "ingress", label: "MPLS Ingress" },
  { id: "label-lookup", label: "Top (Transport) Label Lookup" },
  { id: "transport-forward", label: "Transport Forwarding" },
  { id: "forward", label: "Forward (Inner PW Label Untouched)" },
];

const allIds = (s: ProcessingStage[]) => s.map((x) => x.id);

function neighborLinks(router: RouterId): { neighbor: RouterId; link: LinkDef }[] {
  return LINKS.filter((l) => l.a === router || l.b === router).map((l) => ({ neighbor: l.a === router ? l.b : l.a, link: l }));
}

// ---------------------------------------------------------------------------
// Hop enrichment (additive DeviceProcessingTrace fields feeding
// HopInspectorPanel/PacketDiffViewer) — every value below is derived from
// the JourneyHop the scenario's own step `run()` already wrote, never a
// second, competing decision made here.
// ---------------------------------------------------------------------------

const LOOKUP_TYPE_BY_ACTION: Partial<Record<JourneyAction, string>> = {
  AC_INGRESS: "Attachment Circuit / Service Resolution",
  PUSH_PW: "Remote PW Receive Label (learned via targeted LDP)",
  PUSH_TRANSPORT: "Transport LSP",
  SWAP_TRANSPORT: "Transport Forwarding Table (outer label only)",
  POP_TRANSPORT: "Transport Forwarding Table — PHP / implicit-null",
  PW_LOOKUP: "PW / Service Label Lookup",
  POP_PW: "PW Label Removal",
  AC_EGRESS: "Attachment Circuit Delivery",
};

function mutationsForAction(hop: JourneyHop): PacketMutation[] {
  switch (hop.action) {
    case "PUSH_PW":
    case "PUSH_TRANSPORT":
      return [{ type: "PUSH", detail: hop.output }];
    case "SWAP_TRANSPORT":
      return [{ type: "SWAP", detail: hop.output }];
    case "POP_TRANSPORT":
    case "POP_PW":
      return [{ type: "POP", detail: hop.input }];
    default:
      return [];
  }
}

/** Pulls real "label N (transport|service)" mentions straight out of the hop's own input/output text (the scenario's own authoritative description) — never a value not already written there. Same principle as mpls-ldp's `stackFramesFor`/`extractLabel`. */
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
const AC_PEER: Partial<Record<RouterId, RouterId>> = { PE1: "CE1", PE2: "CE2" };

/**
 * Previous different-device journey entry — the router this hop's frame
 * actually arrived FROM. Walks backward past same-device entries (e.g.
 * AC_INGRESS → PUSH_PW → PUSH_TRANSPORT are all recorded against PE1
 * during a single visit) so the ingress interface reflects the true
 * prior hop, never the device's own fixed neighbor-array slot. Falls
 * back to the AC peer only when no earlier journey entry exists at all —
 * the packet's genuine origin (CE1 for PE1, CE2 for PE2), not a guess.
 */
function prevRouterFor(hop: JourneyHop, state: MplsL2vpnVpwsState): RouterId | undefined {
  const idx = state.journey.indexOf(hop);
  for (let i = idx - 1; i >= 0; i--) {
    if (state.journey[i].device !== hop.device) return state.journey[i].device;
  }
  return AC_PEER[hop.device];
}
/**
 * Next different-device journey entry — ONLY the immediately-following
 * entry, never skipping ahead over later hops. This means a hop that's
 * still internal to the same device (AC_INGRESS before PUSH_PW has run,
 * or PW_LOOKUP before POP_PW has run) correctly reports no egress yet,
 * rather than borrowing a later hop's destination. Falls back to
 * `state.packetAt` when this hop is the most-recently-recorded one and
 * the packet has already moved there (mirrors mpls-ldp's `nextHopFor`).
 */
function nextRouterFor(hop: JourneyHop, state: MplsL2vpnVpwsState): RouterId | undefined {
  const idx = state.journey.indexOf(hop);
  const next = state.journey[idx + 1];
  if (next) return next.device !== hop.device ? next.device : undefined;
  const isLast = idx === state.journey.length - 1;
  if (isLast && state.packetAt && state.packetAt !== hop.device) return state.packetAt;
  return undefined;
}
function ifaceId(router: RouterId, neighbor: RouterId): string {
  return `${router}-${neighbor}`;
}
function ingressIfaceFor(router: RouterId, hop: JourneyHop | undefined, state: MplsL2vpnVpwsState): string | undefined {
  if (!hop) return undefined;
  const prev = prevRouterFor(hop, state);
  return prev ? ifaceId(router, prev) : undefined;
}
function egressIfaceFor(router: RouterId, hop: JourneyHop | undefined, state: MplsL2vpnVpwsState): string | undefined {
  if (!hop) return undefined;
  const next = nextRouterFor(hop, state);
  return next ? ifaceId(router, next) : undefined;
}

/**
 * Which router is the primary inspection subject of a no-packet
 * control-plane step (targeted LDP session lifecycle, PW FEC/label
 * allocation, the AC/fault/repair steps) — these never touch
 * `state.journey`, so `deviceForStep` needs a fixed subject the way
 * mpls-ldp's `PRIMARY_TRANSITION_ROUTER` does. Every packet-carrying
 * step instead resolves from the packet's own `from`/`to`, exactly like
 * mpls-ldp.
 */
export const PRIMARY_TRANSITION_ROUTER: Partial<Record<string, RouterId>> = {
  "targeted-operational": "PE1",
  "pw-fec-defined": "PE1",
  "pe1-allocates-label": "PE1",
  "pe2-allocates-label": "PE2",
  "pw-up": "PE1",
  "troubleshooting-intro": "PE1",
  "fault-injection": "PE2",
  "repair-challenge": "PE2",
  "repaired-recompute": "PE2",
  "ac-down-experiment": "PE2",
  "restore-ac": "PE2",
  "engineer-challenge-confirm": "PE1",
};

export function deviceForStep(stepId: string, packet: PacketVisual | undefined): RouterId | undefined {
  if (packet) return (packet.from ?? packet.to) as RouterId;
  return PRIMARY_TRANSITION_ROUTER[stepId];
}

export function traceFor(router: RouterId, state: MplsL2vpnVpwsState): DeviceProcessingTrace | undefined {
  const hops = state.journey.filter((h) => h.device === router);
  const hop = hops[hops.length - 1];

  if (router === "CE1" || router === "CE2") {
    const base: DeviceProcessingTrace = { deviceId: router, ingressInterfaceId: ingressIfaceFor(router, hop, state), stages: CE_PIPELINE, completedStageIds: [] };
    if (!hop) return base;
    const isCurrent = state.journey[state.journey.length - 1] === hop;
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

  if (router === "PE1" || router === "PE2") {
    const isIngress = hop?.action === "AC_INGRESS" || hop?.action === "PUSH_PW" || hop?.action === "PUSH_TRANSPORT";
    const stages = isIngress ? PE_INGRESS_PIPELINE : PE_EGRESS_PIPELINE;
    const base: DeviceProcessingTrace = { deviceId: router, ingressInterfaceId: ingressIfaceFor(router, hop, state), egressInterfaceId: egressIfaceFor(router, hop, state), stages, completedStageIds: [] };
    if (!hop) return base;
    const isCurrent = state.journey[state.journey.length - 1] === hop;
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
    if (isCurrent) {
      if (isIngress) {
        const activeStageId = hop.action === "AC_INGRESS" ? "service-lookup" : hop.action === "PUSH_PW" ? "push-transport" : "forward";
        const completed = hop.action === "AC_INGRESS" ? ["ac-ingress"] : hop.action === "PUSH_PW" ? ["ac-ingress", "service-lookup", "push-pw"] : ["ac-ingress", "service-lookup", "push-pw", "push-transport"];
        return { ...base, activeStageId, completedStageIds: completed, packetBefore: hop.input, packetAfter: hop.output, ...enrichment };
      }
      const activeStageId = hop.action === "PW_LOOKUP" ? "identify-ac" : "deliver";
      const completed = hop.action === "PW_LOOKUP" ? ["transport-terminated", "pw-lookup"] : ["transport-terminated", "pw-lookup", "identify-ac", "pop-pw"];
      return { ...base, activeStageId, completedStageIds: completed, packetBefore: hop.input, packetAfter: hop.output, ...enrichment };
    }
    return { ...base, completedStageIds: allIds(stages), packetBefore: hop.input, packetAfter: hop.output, ...enrichment };
  }

  // P1, P2 — ordinary transport transit, no pseudowire knowledge. lookupType/
  // reason below come straight from hop.lookup/hop.action for SWAP_TRANSPORT/
  // POP_TRANSPORT, which the scenario itself already writes in purely
  // transport terms ("Transport forwarding table — outer label only") — this
  // adapter never adds a PW/service field for a P router.
  const base: DeviceProcessingTrace = { deviceId: router, ingressInterfaceId: ingressIfaceFor(router, hop, state), egressInterfaceId: egressIfaceFor(router, hop, state), stages: TRANSIT_PIPELINE, completedStageIds: [] };
  if (!hop) return base;
  const isCurrent = state.journey[state.journey.length - 1] === hop;
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

export function packetFramesFor(state: MplsL2vpnVpwsState): PacketStackFrame[] | undefined {
  if (!state.packet) return undefined;
  const labelFrames: PacketStackFrame[] = state.packet.labels.map((l, idx) => ({
    id: `label-${idx}`,
    text: `${l.purpose === "transport" ? "Transport" : "PW"} ${l.value}`,
    tone: l.purpose === "transport" ? "transport" : "vpn",
    justChanged: idx === 0,
  }));
  return [...labelFrames, { id: "eth", text: "Ethernet", tone: "generic" }];
}

export function interfacesFor(router: RouterId, state: MplsL2vpnVpwsState): DeviceInterfaceData[] {
  const ac = resolveAttachmentCircuit(state.acs, router);
  const base = neighborLinks(router).map(({ neighbor, link }) => ({
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
  return base;
}

export function linkDetailFor(linkId: string, state: MplsL2vpnVpwsState): LinkDetail | undefined {
  const link = LINKS.find((l) => l.id === linkId);
  if (!link) return undefined;
  const ac1 = link.a === "PE1" || link.b === "PE1" ? resolveAttachmentCircuit(state.acs, "PE1") : undefined;
  const ac2 = link.a === "PE2" || link.b === "PE2" ? resolveAttachmentCircuit(state.acs, "PE2") : undefined;
  const isAccessLink = link.igpMetric === undefined;
  const linkUp = isAccessLink ? (ac1?.up ?? ac2?.up ?? true) : true;
  return {
    aLabel: link.a,
    bLabel: link.b,
    aInterface: { id: `${link.a}-${link.b}`, name: `to-${link.b}`, status: linkUp ? "up" : "down", neighborId: link.b, neighborLabel: link.b, linkType: isAccessLink ? "Access" : "Core", mtu: 1500, protocols: isAccessLink ? ["Ethernet"] : ["IGP", "MPLS"], role: "idle" },
    bInterface: { id: `${link.b}-${link.a}`, name: `to-${link.a}`, status: linkUp ? "up" : "down", neighborId: link.a, neighborLabel: link.a, linkType: isAccessLink ? "Access" : "Core", mtu: 1500, protocols: isAccessLink ? ["Ethernet"] : ["IGP", "MPLS"], role: "idle" },
    status: linkUp ? "up" : "down",
    mtu: 1500,
    protocols: isAccessLink ? [{ label: "Type", value: "Attachment Circuit — logical service overlay, not a physical wire" }] : [{ label: "IGP Metric", value: String(link.igpMetric) }],
  };
}
