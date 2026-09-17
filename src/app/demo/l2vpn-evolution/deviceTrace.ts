import type { DeviceInterfaceData, DeviceProcessingTrace, LinkDetail, PacketStackFrame, ProcessingStage } from "@/components/network3d/types";
import type { L2vpnEvolutionState, RouterId } from "@/lib/sim-engine/scenarios/l2vpnEvolution";

/**
 * Scene Adapter for the L2VPN Evolution capstone's device-interior 3D
 * view. This capstone's own steps are mostly comparison/narrative — the
 * only devices with a real, live processing trace are the CE/PE nodes
 * touched by the CE1→CE2/CE3 "same frame" experiments and the BGP-VPLS
 * mental-model incident. Every stage list below is derived from live
 * L2vpnEvolutionState — no forwarding/learning decision is made here.
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

const allIds = (s: ProcessingStage[]) => s.map((x) => x.id);

function stageForAction(action: string): string {
  if (action.includes("AC_INGRESS") || action === "AC_INGRESS") return "ingress";
  if (action === "MAC_LEARNED") return "learn";
  if (action.includes("UNICAST") || action.includes("UNKNOWN") || action.includes("BROADCAST")) return "decide";
  return "deliver";
}

export function traceFor(router: RouterId, state: L2vpnEvolutionState): DeviceProcessingTrace | undefined {
  const hops = state.journey.filter((h) => h.device === router);
  const hop = hops[hops.length - 1];
  const isCurrent = state.journey.length > 0 && state.journey[state.journey.length - 1].device === router;

  if (router.startsWith("CE")) {
    const base: DeviceProcessingTrace = { deviceId: router, stages: CE_PIPELINE, completedStageIds: [] };
    if (!hop) return base;
    if (isCurrent) return { ...base, activeStageId: "ac", completedStageIds: [], packetBefore: hop.input, packetAfter: hop.output };
    return { ...base, completedStageIds: allIds(CE_PIPELINE), packetBefore: hop.input, packetAfter: hop.output };
  }

  if (router.startsWith("PE")) {
    const base: DeviceProcessingTrace = { deviceId: router, stages: PE_PIPELINE, completedStageIds: [] };
    if (!hop) return base;
    const activeStageId = stageForAction(hop.action);
    const activeIdx = PE_PIPELINE.findIndex((s) => s.id === activeStageId);
    const completed = PE_PIPELINE.slice(0, isCurrent ? activeIdx : activeIdx + 1).map((s) => s.id);
    if (isCurrent) return { ...base, activeStageId, completedStageIds: completed, packetBefore: hop.input, packetAfter: hop.output };
    return { ...base, completedStageIds: allIds(PE_PIPELINE), packetBefore: hop.input, packetAfter: hop.output };
  }

  // P routers, MTU-s, RR1, CE-DUAL: transport/control-plane only in this
  // capstone's own steps — never a customer-FDB pipeline.
  return { deviceId: router, stages: OTHER_PIPELINE, completedStageIds: allIds(OTHER_PIPELINE) };
}

export function packetFramesFor(state: L2vpnEvolutionState): PacketStackFrame[] | undefined {
  if (!state.packet) return undefined;
  return state.packet.layers.map((l, idx) => ({ id: `layer-${idx}`, text: l.name, tone: idx === 0 ? "vpn" : "generic", justChanged: idx === 0 }));
}

const NEIGHBORS: Partial<Record<RouterId, RouterId[]>> = {
  CE1: ["PE1"],
  CE2: ["PE2"],
  CE3: ["PE3"],
  PE1: ["CE1", "PE2", "PE3"],
  PE2: ["CE2", "PE1", "PE3"],
  PE3: ["CE3", "PE1", "PE2"],
};

export function interfacesFor(router: RouterId, state: L2vpnEvolutionState): DeviceInterfaceData[] {
  const neighbors = NEIGHBORS[router] ?? [];
  return neighbors.map((neighbor) => ({
    id: `${router}-${neighbor}`,
    name: `to-${neighbor}`,
    status: "up" as const,
    neighborId: neighbor,
    neighborLabel: neighbor,
    linkType: router.startsWith("CE") || neighbor.startsWith("CE") ? "Access" : "Service PW",
    mtu: 1500,
    protocols: router.startsWith("CE") || neighbor.startsWith("CE") ? ["Ethernet"] : ["MPLS"],
    role: "idle" as const,
    extra: router.startsWith("PE") && router.startsWith("PE") && neighbor.startsWith("PE") ? [{ label: "FDB Entries", value: String(state.fdb[router as "PE1" | "PE2" | "PE3"]?.length ?? 0) }] : undefined,
  }));
}

export function linkDetailFor(linkId: string, state: L2vpnEvolutionState): LinkDetail | undefined {
  const [a, b] = linkId.split("-") as [RouterId, RouterId];
  if (!a || !b) return undefined;
  void state;
  return {
    aLabel: a,
    bLabel: b,
    aInterface: { id: `${a}-${b}`, name: `to-${b}`, status: "up", neighborId: b, neighborLabel: b, mtu: 1500, protocols: ["Ethernet"], role: "idle" },
    bInterface: { id: `${b}-${a}`, name: `to-${a}`, status: "up", neighborId: a, neighborLabel: a, mtu: 1500, protocols: ["Ethernet"], role: "idle" },
    status: "up",
    mtu: 1500,
    protocols: [{ label: "Service", value: "CUST-A" }],
  };
}

export const DEVICE_ROUTERS: RouterId[] = ["CE1", "PE1", "CE2", "PE2", "CE3", "PE3"];
