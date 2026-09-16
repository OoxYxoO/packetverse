import type { DeviceInterfaceData, DeviceProcessingTrace, LinkDetail, PacketStackFrame, ProcessingStage } from "@/components/network3d/types";
import { GRAPH_EDGES, l3vpnSteps, type L3VpnState, type RouterId } from "@/lib/sim-engine/scenarios/mplsL3vpn";

/**
 * The "Scene Adapter" (brief §15) for MPLS L3VPN's device-interior 3D
 * view. Every stage list, checkpoint, interface, and link-detail
 * value below is computed FROM L3VpnState (the ScenarioEngine's own
 * output) — this file never makes a VRF/BGP/label decision itself, it
 * only re-describes decisions the engine already made, in the generic
 * DeviceProcessingTrace/DeviceInterfaceData shape the 3D layer
 * understands. Nothing in components/network3d/ imports this file
 * directly — the page wires them together every render.
 */

const stepIndex = (id: string) => l3vpnSteps.findIndex((s) => s.id === id);

// ---------------------------------------------------------------------------
// Conceptual Forwarding Pipeline — stage lists per device role (brief §5-8).
// ---------------------------------------------------------------------------

const PE1_STAGES: ProcessingStage[] = [
  { id: "ingress", label: "Ingress Interface" },
  { id: "identify-vrf", label: "Identify VRF" },
  { id: "vrf-lookup", label: "VRF Route Lookup" },
  { id: "bgp-nexthop", label: "Resolve BGP Next-Hop" },
  { id: "vpn-label", label: "Obtain VPN Label" },
  { id: "transport-label", label: "Obtain Transport Label" },
  { id: "build-stack", label: "Build Label Stack" },
  { id: "egress", label: "Egress Interface" },
];
const P1_STAGES: ProcessingStage[] = [
  { id: "ingress", label: "Ingress" },
  { id: "read-label", label: "Read Top Label" },
  { id: "lfib-lookup", label: "LFIB Lookup" },
  { id: "swap", label: "Label Action: SWAP" },
  { id: "egress", label: "Egress" },
];
const P2_STAGES: ProcessingStage[] = [
  { id: "ingress", label: "Ingress" },
  { id: "read-label", label: "Read Top Label" },
  { id: "lfib-lookup", label: "LFIB Lookup" },
  { id: "pop", label: "Label Action: POP (PHP)" },
  { id: "egress", label: "Egress" },
];
const PE2_STAGES: ProcessingStage[] = [
  { id: "ingress", label: "Ingress" },
  { id: "vpn-lookup", label: "VPN Label Lookup" },
  { id: "vrf-context", label: "Select VRF Context (CUST-A)" },
  { id: "remove-label", label: "Remove VPN Label" },
  { id: "ip-forward", label: "IP Forward to CE" },
  { id: "egress", label: "Egress" },
];

function allIds(stages: ProcessingStage[]) {
  return stages.map((s) => s.id);
}

export function traceFor(router: RouterId, state: L3VpnState, currentStepId: string): DeviceProcessingTrace | undefined {
  const i = stepIndex(currentStepId);

  if (router === "PE1") {
    const base: DeviceProcessingTrace = { deviceId: "PE1", ingressInterfaceId: "PE1-ce", egressInterfaceId: "PE1-p1", stages: PE1_STAGES, completedStageIds: [] };
    if (i < stepIndex("send-ce1")) return { ...base, packetBefore: undefined, packetAfter: undefined };
    if (i === stepIndex("send-ce1")) return { ...base, activeStageId: "ingress", packetBefore: "IP packet arrives from CE1" };
    if (i <= stepIndex("predict-stack-order")) return { ...base, activeStageId: "vrf-lookup", completedStageIds: ["ingress", "identify-vrf"], packetBefore: "IP packet (VRF CUST-A match)" };
    if (i === stepIndex("push-vpn-label")) return { ...base, activeStageId: "vpn-label", completedStageIds: ["ingress", "identify-vrf", "vrf-lookup", "bgp-nexthop"], packetBefore: "IP packet (VRF CUST-A match)", packetAfter: "[VPN 24002][IP]" };
    if (i === stepIndex("push-transport-label")) return { ...base, activeStageId: "build-stack", completedStageIds: ["ingress", "identify-vrf", "vrf-lookup", "bgp-nexthop", "vpn-label", "transport-label"], packetBefore: "[VPN 24002][IP]", packetAfter: "[Transport 102][VPN 24002][IP]" };
    return { ...base, completedStageIds: allIds(PE1_STAGES), packetBefore: "IP packet (VRF CUST-A match)", packetAfter: "[Transport 102][VPN 24002][IP]" };
  }

  if (router === "P1") {
    const base: DeviceProcessingTrace = { deviceId: "P1", ingressInterfaceId: "P1-pe1", egressInterfaceId: "P1-p2", stages: P1_STAGES, completedStageIds: [] };
    if (i < stepIndex("p1-swap")) return base;
    if (i <= stepIndex("predict-p-router")) return { ...base, activeStageId: "swap", completedStageIds: ["ingress", "read-label", "lfib-lookup"], packetBefore: "[Transport 102][VPN 24002][IP]", packetAfter: "[Transport 203][VPN 24002][IP]" };
    return { ...base, completedStageIds: allIds(P1_STAGES), packetBefore: "[Transport 102][VPN 24002][IP]", packetAfter: "[Transport 203][VPN 24002][IP]" };
  }

  if (router === "P2") {
    const base: DeviceProcessingTrace = { deviceId: "P2", ingressInterfaceId: "P2-p1", egressInterfaceId: "P2-pe2", stages: P2_STAGES, completedStageIds: [] };
    if (i < stepIndex("p2-php")) return base;
    if (i <= stepIndex("predict-remaining-label")) return { ...base, activeStageId: "pop", completedStageIds: ["ingress", "read-label", "lfib-lookup"], packetBefore: "[Transport 203][VPN 24002][IP]", packetAfter: "[VPN 24002][IP]" };
    return { ...base, completedStageIds: allIds(P2_STAGES), packetBefore: "[Transport 203][VPN 24002][IP]", packetAfter: "[VPN 24002][IP]" };
  }

  // PE2
  const base: DeviceProcessingTrace = { deviceId: "PE2", ingressInterfaceId: "PE2-p2", egressInterfaceId: "PE2-ce", stages: PE2_STAGES, completedStageIds: [] };
  if (i < stepIndex("pe2-vpn-lookup")) return base;
  if (i === stepIndex("pe2-vpn-lookup")) return { ...base, activeStageId: "vpn-lookup", completedStageIds: ["ingress"], packetBefore: "[VPN 24002][IP]" };
  if (i === stepIndex("pe2-deliver")) return { ...base, activeStageId: "ip-forward", completedStageIds: ["ingress", "vpn-lookup", "vrf-context", "remove-label"], packetBefore: "[VPN 24002][IP]", packetAfter: "IP packet → CE2" };
  return { ...base, completedStageIds: allIds(PE2_STAGES), packetBefore: "[VPN 24002][IP]", packetAfter: "IP packet → CE2" };
}

// ---------------------------------------------------------------------------
// Packet visual stack (brief §5-9) — derived straight from state.packet.
// ---------------------------------------------------------------------------

export function packetFramesFor(state: L3VpnState, activeStageId: string | undefined): PacketStackFrame[] | undefined {
  if (!state.packet) return undefined;
  const justChangedTone = activeStageId === "build-stack" || activeStageId === "swap" || activeStageId === "pop" || activeStageId === "remove-label" || activeStageId === "vpn-label" ? "top" : undefined;
  const labelFrames: PacketStackFrame[] = state.packet.labels.map((l, i) => ({
    id: `label-${i}`,
    text: `${l.purpose === "transport" ? "Transport" : "VPN"} ${l.value}`,
    tone: l.purpose === "transport" ? "transport" : "vpn",
    justChanged: justChangedTone === "top" && i === 0,
  }));
  return [...labelFrames, { id: "ip", text: "IP", tone: "ip" }];
}

// ---------------------------------------------------------------------------
// Physical interfaces (brief §2/§3) — generic naming, IPs are
// presentational device metadata, not something protocol logic reads.
// ---------------------------------------------------------------------------

interface IfaceDef {
  id: string;
  name: string;
  ip: string;
  neighborId: RouterId;
  neighborLabel: string;
  linkType: string;
  mtu: number;
  protocols: string[];
}

const INTERFACES: Record<RouterId, IfaceDef[]> = {
  CE1: [{ id: "CE1-pe1", name: "ge-0/0/0", ip: "10.1.1.10/24", neighborId: "PE1", neighborLabel: "PE1", linkType: "Access", mtu: 1500, protocols: ["Static"] }],
  PE1: [
    { id: "PE1-ce", name: "ge-0/0/0", ip: "10.1.1.1/24", neighborId: "CE1", neighborLabel: "CE1", linkType: "Access (VRF CUST-A)", mtu: 1500, protocols: ["Static"] },
    { id: "PE1-p1", name: "xe-0/1/0", ip: "10.0.12.1/30", neighborId: "P1", neighborLabel: "P1", linkType: "Core (LSP)", mtu: 9192, protocols: ["OSPF", "LDP"] },
  ],
  P1: [
    { id: "P1-pe1", name: "xe-0/0/0", ip: "10.0.12.2/30", neighborId: "PE1", neighborLabel: "PE1", linkType: "Core (LSP)", mtu: 9192, protocols: ["OSPF", "LDP"] },
    { id: "P1-p2", name: "xe-0/1/0", ip: "10.0.23.1/30", neighborId: "P2", neighborLabel: "P2", linkType: "Core (LSP)", mtu: 9192, protocols: ["OSPF", "LDP"] },
  ],
  P2: [
    { id: "P2-p1", name: "xe-0/0/0", ip: "10.0.23.2/30", neighborId: "P1", neighborLabel: "P1", linkType: "Core (LSP)", mtu: 9192, protocols: ["OSPF", "LDP"] },
    { id: "P2-pe2", name: "xe-0/1/0", ip: "10.0.24.1/30", neighborId: "PE2", neighborLabel: "PE2", linkType: "Core (LSP)", mtu: 9192, protocols: ["OSPF", "LDP"] },
  ],
  PE2: [
    { id: "PE2-p2", name: "xe-0/0/0", ip: "10.0.24.2/30", neighborId: "P2", neighborLabel: "P2", linkType: "Core (LSP)", mtu: 9192, protocols: ["OSPF", "LDP"] },
    { id: "PE2-ce", name: "ge-0/1/0", ip: "10.2.2.1/24", neighborId: "CE2", neighborLabel: "CE2", linkType: "Access (VRF CUST-A)", mtu: 1500, protocols: ["Static"] },
  ],
  CE2: [{ id: "CE2-pe2", name: "ge-0/0/0", ip: "10.2.2.20/24", neighborId: "PE2", neighborLabel: "PE2", linkType: "Access", mtu: 1500, protocols: ["Static"] }],
};

export function interfacesFor(router: RouterId, state: L3VpnState, currentStepId: string): DeviceInterfaceData[] {
  const trace = traceFor(router, state, currentStepId);
  const processing = trace?.activeStageId !== undefined;
  return INTERFACES[router].map((def) => ({
    id: def.id,
    name: def.name,
    status: "up",
    ip: def.ip,
    neighborId: def.neighborId,
    neighborLabel: def.neighborLabel,
    linkType: def.linkType,
    mtu: def.mtu,
    protocols: def.protocols,
    packetCount: trace && (trace.completedStageIds.length > 0 || processing) ? 1 : 0,
    role: processing && def.id === trace?.ingressInterfaceId ? "ingress" : processing && def.id === trace?.egressInterfaceId ? "egress" : "idle",
  }));
}

// ---------------------------------------------------------------------------
// Link detail (brief §10)
// ---------------------------------------------------------------------------

export function linkDetailFor(linkId: string, state: L3VpnState): LinkDetail | undefined {
  const edge = GRAPH_EDGES.find((e) => e.id === linkId);
  if (!edge) return undefined;
  const a = edge.a as RouterId;
  const b = edge.b as RouterId;
  const aIface = INTERFACES[a].find((f) => f.neighborId === b);
  const bIface = INTERFACES[b].find((f) => f.neighborId === a);
  if (!aIface || !bIface) return undefined;
  const isCore = aIface.linkType.startsWith("Core");
  const currentlyCarrying = state.packetAt && [a, b].includes(state.packetAt as RouterId) && state.packet ? state.packet.labels.map((l) => `[${l.purpose === "transport" ? "Transport" : "VPN"} ${l.value}]`).join("") + "[IP]" : undefined;
  return {
    aLabel: a,
    bLabel: b,
    aInterface: { id: aIface.id, name: aIface.name, status: "up", ip: aIface.ip, neighborId: b, neighborLabel: b, linkType: aIface.linkType, mtu: aIface.mtu, protocols: aIface.protocols, role: "idle" },
    bInterface: { id: bIface.id, name: bIface.name, status: "up", ip: bIface.ip, neighborId: a, neighborLabel: a, linkType: bIface.linkType, mtu: bIface.mtu, protocols: bIface.protocols, role: "idle" },
    status: "up",
    mtu: aIface.mtu,
    protocols: isCore ? [{ label: "IGP", value: "OSPF" }, { label: "LDP", value: "UP" }, { label: "MPLS", value: "Enabled" }] : [{ label: "VRF", value: "CUST-A" }],
    currentTraffic: currentlyCarrying,
  };
}
