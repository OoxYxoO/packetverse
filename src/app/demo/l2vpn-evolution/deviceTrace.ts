import type { DeviceInterfaceData, DeviceProcessingTrace, LinkDetail, PacketMutation, PacketStackFrame, ProcessingStage } from "@/components/network3d/types";
import type { PacketVisual } from "@/lib/sim-engine/types";
import type { JourneyHop, L2vpnEvolutionState, RouterId } from "@/lib/sim-engine/scenarios/l2vpnEvolution";

/**
 * Scene Adapter for the L2VPN Evolution capstone's device-interior 3D
 * view. This capstone's own steps are mostly comparison/narrative — the
 * only devices with a real, live processing trace are the CE/PE nodes
 * touched by the CE1→CE2/CE3 "same frame" experiments and the BGP-VPLS
 * mental-model incident. Every stage list below is derived from live
 * L2vpnEvolutionState — no forwarding/learning decision is made here.
 * RR1 and MTU1/MTU2 have real ROLE explanations (see explain.ts) but no
 * live per-step forwarding trace — this capstone's own steps never run
 * a frame through them — so their Hop Inspector honestly reports no
 * recorded activity rather than fabricating one (anti-fake-data rule,
 * ARCHITECTURE.md §18).
 */

const CE_PIPELINE: ProcessingStage[] = [
  { id: "ac", label: "Attachment Circuit" },
  { id: "deliver", label: "Deliver / Receive" },
];
const PE_PIPELINE: ProcessingStage[] = [
  { id: "ingress", label: "Ingress (AC / PW)" },
  { id: "learn", label: "Learn Source MAC" },
  { id: "lookup", label: "Destination Lookup" },
  { id: "decide", label: "Forwarding Decision" },
  { id: "deliver", label: "Deliver / Forward" },
];
const OTHER_PIPELINE: ProcessingStage[] = [{ id: "transport", label: "Transport Only — No Customer Service State" }];
const RR_PIPELINE: ProcessingStage[] = [{ id: "reflect", label: "Reflect VPLS / EVPN NLRI — Never Customer Data" }];

const PE_STAGE_ORDER = PE_PIPELINE.map((s) => s.id);
const allIds = (s: ProcessingStage[]) => s.map((x) => x.id);

function stageForAction(action: string): string {
  if (action.includes("AC_INGRESS") || action === "AC_INGRESS") return "ingress";
  if (action === "MAC_LEARNED") return "learn";
  if (action.includes("UNICAST") || action.includes("UNKNOWN") || action.includes("BROADCAST")) return "decide";
  return "deliver";
}

// ---------------------------------------------------------------------------
// Hop enrichment (additive DeviceProcessingTrace fields feeding
// HopInspectorPanel/PacketDiffViewer) — every value below is derived from
// the JourneyHop the scenario's own step `run()`/`action()` already wrote,
// never a second, competing decision made here.
// ---------------------------------------------------------------------------
const LOOKUP_TYPE_BY_ACTION: Record<string, string> = {
  AC_INGRESS: "Attachment Circuit Ingress",
  MAC_LEARNED: "Source MAC Learning",
  UNKNOWN_UNICAST: "FDB Destination Lookup — miss",
  REMOTE_UNICAST: "FDB Destination Lookup — hit",
  LOCAL_UNICAST: "FDB Destination Lookup — hit (local)",
  BROADCAST: "Flood Egress Set (BUM)",
  PUSH_PW_TRANSPORT: "Remote PW Receive Label (targeted LDP) + Transport LSP",
  "PUSH_PW+TRANSPORT": "Remote PW Receive Label (targeted LDP) + Transport LSP",
  POP_PW: "PW Label Resolution → Service + AC Delivery",
};
function lookupTypeFor(hop: JourneyHop): string | undefined {
  return LOOKUP_TYPE_BY_ACTION[hop.action] ?? (hop.action.includes("UNICAST") || hop.action === "BROADCAST" ? "FDB Destination Lookup" : undefined);
}
/** MAC_LEARNED is an FDB-table side effect, never a mutation of the packet itself — only PUSH/POP label operations count here. */
function mutationsForAction(hop: JourneyHop): PacketMutation[] {
  if (hop.action.startsWith("PUSH")) return [{ type: "PUSH", detail: hop.output }];
  if (hop.action === "POP_PW") return [{ type: "POP", detail: hop.input }];
  return [];
}

/** Previous different-device journey entry this hop's frame actually arrived FROM — walks backward past same-device entries, never a fixed neighbor-array slot (ARCHITECTURE.md §17's "known correctness fix"). */
function prevRouterFor(hop: JourneyHop, state: L2vpnEvolutionState): RouterId | undefined {
  const idx = state.journey.indexOf(hop);
  for (let i = idx - 1; i >= 0; i--) {
    if (state.journey[i].device !== hop.device) return state.journey[i].device;
  }
  return AC_PEER[hop.device];
}
/** Next different-device journey entry — only the immediately-following one, falling back to `state.packetAt` only for the most-recently-recorded hop. */
function nextRouterFor(hop: JourneyHop, state: L2vpnEvolutionState): RouterId | undefined {
  const idx = state.journey.indexOf(hop);
  const next = state.journey[idx + 1];
  if (next) return next.device !== hop.device ? next.device : undefined;
  const isLast = idx === state.journey.length - 1;
  if (isLast && state.packetAt && state.packetAt !== hop.device) return state.packetAt;
  return undefined;
}
const AC_PEER: Partial<Record<RouterId, RouterId>> = { PE1: "CE1", PE2: "CE2", PE3: "CE3", CE1: "PE1", CE2: "PE2", CE3: "PE3" };

function ifaceId(router: RouterId, neighbor: RouterId): string {
  return `${router}-${neighbor}`;
}
function ingressIfaceFor(router: RouterId, hop: JourneyHop | undefined, state: L2vpnEvolutionState): string | undefined {
  if (!hop) return undefined;
  const prev = prevRouterFor(hop, state);
  return prev ? ifaceId(router, prev) : undefined;
}
function egressIfaceFor(router: RouterId, hop: JourneyHop | undefined, state: L2vpnEvolutionState): string | undefined {
  if (!hop) return undefined;
  const next = nextRouterFor(hop, state);
  return next ? ifaceId(router, next) : undefined;
}

/**
 * `deviceForStep` needs a fixed subject for the handful of steps that
 * carry no `.packet` and record no journey hop at all (a pure
 * control-plane narration). Every packet-carrying or journey-recording
 * step instead resolves from the packet's own `from` (sender priority —
 * `state.journey` records each hop against the router that PERFORMED the
 * learn/forward, exactly like mplsVpls.ts, whose real functions this
 * lesson calls directly) — except `evpn-ce3-install`, a receiver-priority
 * BGP-style control message (the fact that matters is PE1 INSTALLING the
 * route, mirroring mpls-l3vpn/bgp-enterprise's own receiver-priority rule
 * for non-journey-array control messages).
 */
export const PRIMARY_TRANSITION_ROUTER: Partial<Record<string, RouterId>> = {
  "bgp-vpls-label-block-recap": "RR1",
  "evpn-mac-mobility-comparison": "PE2",
  "evpn-multihoming-comparison": "PE1",
};
const RECEIVER_PRIORITY_STEPS = new Set(["evpn-ce3-install"]);

export function deviceForStep(stepId: string, packet: PacketVisual | undefined): RouterId | undefined {
  if (packet) return (RECEIVER_PRIORITY_STEPS.has(stepId) ? (packet.to ?? packet.from) : (packet.from ?? packet.to)) as RouterId;
  return PRIMARY_TRANSITION_ROUTER[stepId];
}

export function traceFor(router: RouterId, state: L2vpnEvolutionState): DeviceProcessingTrace | undefined {
  const hops = state.journey.filter((h) => h.device === router);
  const hop = hops[hops.length - 1];
  const isCurrent = state.journey.length > 0 && state.journey[state.journey.length - 1] === hop;

  if (router.startsWith("CE") && router !== "CE-DUAL") {
    const ingressIfaceId = ingressIfaceFor(router, hop, state);
    const egressIfaceId = egressIfaceFor(router, hop, state);
    const base: DeviceProcessingTrace = { deviceId: router, ingressInterfaceId: ingressIfaceId, egressInterfaceId: egressIfaceId, stages: CE_PIPELINE, completedStageIds: [] };
    if (!hop) return base;
    const enrichment = { lookupType: lookupTypeFor(hop), lookupKey: hop.input, lookupResult: `${hop.action} → ${hop.output}`, reason: hop.lookup, mutations: mutationsForAction(hop) };
    if (isCurrent) return { ...base, activeStageId: "ac", completedStageIds: [], packetBefore: hop.input, packetAfter: hop.output, ...enrichment };
    return { ...base, completedStageIds: allIds(CE_PIPELINE), packetBefore: hop.input, packetAfter: hop.output, ...enrichment };
  }

  if (router.startsWith("PE")) {
    const ingressIfaceId = ingressIfaceFor(router, hop, state);
    const egressIfaceId = egressIfaceFor(router, hop, state);
    const base: DeviceProcessingTrace = { deviceId: router, ingressInterfaceId: ingressIfaceId, egressInterfaceId: egressIfaceId, stages: PE_PIPELINE, completedStageIds: [] };
    if (!hop) return base;
    const activeStageId = stageForAction(hop.action);
    const activeIdx = PE_STAGE_ORDER.indexOf(activeStageId);
    const completed = PE_STAGE_ORDER.slice(0, isCurrent ? activeIdx : activeIdx + 1);
    const nextRouter = nextRouterFor(hop, state);
    const enrichment = { lookupType: lookupTypeFor(hop), lookupKey: hop.input, lookupResult: `${hop.action} → ${hop.output}`, reason: hop.lookup, nextHopId: nextRouter, nextHopLabel: nextRouter, mutations: mutationsForAction(hop) };
    if (isCurrent) return { ...base, activeStageId, completedStageIds: completed, packetBefore: hop.input, packetAfter: hop.output, ...enrichment };
    return { ...base, completedStageIds: allIds(PE_PIPELINE), packetBefore: hop.input, packetAfter: hop.output, ...enrichment };
  }

  if (router === "RR1") {
    // BGP-VPLS/EVPN Route Reflector — reflects NLRI only, never a customer
    // data-plane hop; this capstone's own steps never run a frame through
    // it, so it is always idle rather than showing a fabricated forward.
    return { deviceId: router, stages: RR_PIPELINE, completedStageIds: [] };
  }

  // MTU1/MTU2 (H-VPLS access-tier bridges), P1/P2 (transport-only, not
  // rendered by this capstone's own topologies), CE-DUAL (multihoming
  // comparison stand-in) — real roles (see explain.ts), no live per-step
  // trace in this capstone's own scenario file.
  return { deviceId: router, stages: OTHER_PIPELINE, completedStageIds: allIds(OTHER_PIPELINE) };
}

export function packetFramesFor(state: L2vpnEvolutionState): PacketStackFrame[] | undefined {
  if (!state.packet) return undefined;
  return state.packet.layers.map((l, idx) => ({ id: `layer-${idx}`, text: l.name, tone: idx === 0 ? "vpn" : "generic", justChanged: idx === 0 }));
}

/**
 * Physical/logical ports this device owns ACROSS the whole capstone story
 * (a superset of what's active at any single architecture) — PE1's AC to
 * CE1 is real in the VPWS/VPLS/BGP-VPLS/EVPN phases, its spoke PW to MTU1
 * is real only once H-VPLS is selected; showing both, generically, avoids
 * a second architecture-conditioned interface model while never inventing
 * a port that doesn't exist in at least one of this lesson's own phases.
 * RR1 is deliberately absent here — a BGP session peer, not a bridge
 * port — and appears only in RR1's own dedicated "BGP Session" tab.
 */
const NEIGHBORS: Partial<Record<RouterId, RouterId[]>> = {
  CE1: ["PE1"],
  CE2: ["PE2"],
  CE3: ["PE3"],
  MTU1: ["CE1", "PE1"],
  MTU2: ["CE2", "PE2"],
  PE1: ["CE1", "MTU1", "PE2", "PE3"],
  PE2: ["CE2", "MTU2", "PE1", "PE3"],
  PE3: ["CE3", "PE1", "PE2"],
};

export function interfacesFor(router: RouterId, state: L2vpnEvolutionState): DeviceInterfaceData[] {
  const neighbors = NEIGHBORS[router] ?? [];
  const ingressId = state.journey.filter((h) => h.device === router).slice(-1)[0] ? ingressIfaceFor(router, state.journey.filter((h) => h.device === router).slice(-1)[0], state) : undefined;
  const egressId = state.journey.filter((h) => h.device === router).slice(-1)[0] ? egressIfaceFor(router, state.journey.filter((h) => h.device === router).slice(-1)[0], state) : undefined;
  return neighbors.map((neighbor) => {
    const id = `${router}-${neighbor}`;
    const isAccess = router.startsWith("CE") || neighbor.startsWith("CE");
    const isSpoke = router.startsWith("MTU") || neighbor.startsWith("MTU");
    return {
      id,
      name: `to-${neighbor}`,
      status: "up" as const,
      neighborId: neighbor,
      neighborLabel: neighbor,
      linkType: isAccess ? "Access" : isSpoke ? "Spoke PW" : "Service PW",
      mtu: 1500,
      protocols: isAccess ? ["Ethernet"] : ["MPLS"],
      role: id === ingressId ? ("ingress" as const) : id === egressId ? ("egress" as const) : ("idle" as const),
      extra: router.startsWith("PE") && neighbor.startsWith("PE") ? [{ label: "FDB Entries", value: String(state.fdb[router as "PE1" | "PE2" | "PE3"]?.length ?? 0) }] : undefined,
    };
  });
}

export function linkDetailFor(linkId: string, state: L2vpnEvolutionState): LinkDetail | undefined {
  void state;
  const dashIdx = linkId.indexOf("-");
  if (dashIdx <= 0) return undefined;
  // Router ids themselves can contain a dash (CE-DUAL), so a link id is
  // only ever split at the FIRST dash for this capstone's own id set
  // (none of CE1/CE2/CE3/PE1/PE2/PE3/MTU1/MTU2/RR1 contain one).
  const a = linkId.slice(0, dashIdx) as RouterId;
  const b = linkId.slice(dashIdx + 1) as RouterId;
  if (!a || !b) return undefined;
  const isAccess = a.startsWith("CE") || b.startsWith("CE");
  const isSpoke = a.startsWith("MTU") || b.startsWith("MTU");
  const isControl = a === "RR1" || b === "RR1";
  return {
    aLabel: a,
    bLabel: b,
    aInterface: { id: `${a}-${b}`, name: `to-${b}`, status: "up", neighborId: b, neighborLabel: b, mtu: 1500, protocols: isAccess ? ["Ethernet"] : isControl ? ["MP-BGP"] : ["MPLS"], role: "idle" },
    bInterface: { id: `${b}-${a}`, name: `to-${a}`, status: "up", neighborId: a, neighborLabel: a, mtu: 1500, protocols: isAccess ? ["Ethernet"] : isControl ? ["MP-BGP"] : ["MPLS"], role: "idle" },
    status: "up",
    mtu: 1500,
    protocols: isControl ? [{ label: "Session", value: "MP-BGP (VPLS / EVPN NLRI)" }] : isSpoke ? [{ label: "Type", value: "H-VPLS Spoke Pseudowire" }] : [{ label: "Service", value: "CUST-A" }],
  };
}

export const DEVICE_ROUTERS: RouterId[] = ["CE1", "PE1", "MTU1", "CE2", "PE2", "MTU2", "CE3", "PE3", "RR1"];
