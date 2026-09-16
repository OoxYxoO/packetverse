import type { DeviceInterfaceData, DeviceProcessingTrace, LinkDetail, PacketStackFrame, ProcessingStage } from "@/components/network3d/types";
import { evpnSteps, GRAPH_EDGES, HOST_B_IP, HOST_B_MAC, VNI, VTEP_LOOPBACK, type EvpnDeviceId, type EvpnState, type LeafId } from "@/lib/sim-engine/scenarios/evpnVxlan";

/**
 * The "Scene Adapter" for EVPN + VXLAN's device-interior 3D view.
 * Every stage list, checkpoint, interface, and link-detail value below
 * is computed FROM EvpnState (the ScenarioEngine's own output) — this
 * file never makes a VXLAN/EVPN decision itself, it only re-describes
 * decisions the engine already made, in the generic
 * DeviceProcessingTrace/DeviceInterfaceData shape the 3D layer
 * understands. Nothing in components/network3d/ imports this file.
 */

const stepIndex = (id: string) => evpnSteps.findIndex((s) => s.id === id);

// ---------------------------------------------------------------------------
// Conceptual pipelines (brief §6/§7/§8) — exact stage names from the brief.
// ---------------------------------------------------------------------------

const LEAF1_INGRESS_STAGES: ProcessingStage[] = [
  { id: "access-port", label: "Access Port" },
  { id: "vlan-id", label: "VLAN Identification" },
  { id: "mac-lookup", label: "MAC Lookup" },
  { id: "vlan-vni-map", label: "VLAN → VNI Mapping" },
  { id: "remote-vtep", label: "Remote VTEP Resolution" },
  { id: "vxlan-encap", label: "VXLAN Encapsulation" },
  { id: "underlay-lookup", label: "Underlay Route Lookup" },
  { id: "uplink", label: "Uplink" },
];
const SPINE1_STAGES: ProcessingStage[] = [
  { id: "underlay-ingress", label: "Underlay Ingress" },
  { id: "outer-ip-lookup", label: "Outer IP Lookup (ECMP)" },
  { id: "forward", label: "Forward — Inner Frame Not Inspected" },
  { id: "uplink-leaf2", label: "Uplink To LEAF2" },
];
const LEAF2_EGRESS_STAGES: ProcessingStage[] = [
  { id: "underlay-ingress", label: "Underlay Ingress" },
  { id: "vxlan-decap", label: "VXLAN Decapsulation" },
  { id: "vni-lookup", label: "VNI Lookup" },
  { id: "inner-frame", label: "Inner Ethernet Frame" },
  { id: "mac-lookup", label: "MAC Lookup" },
  { id: "access-port", label: "Access Port" },
  { id: "deliver", label: "Deliver To HOST-B" },
];

function allIds(stages: ProcessingStage[]) {
  return stages.map((s) => s.id);
}

const LEAF1_STEP_IDS = ["leaf1-ingress", "leaf1-ingress-confirmed"];
const SPINE_STEP_IDS = ["spine-forward", "spine-forward-confirmed"];
const LEAF2_STEP_IDS = ["leaf2-egress", "leaf2-egress-confirmed"];

export function traceFor(device: "LEAF1" | "SPINE1" | "LEAF2", state: EvpnState, currentStepId: string): DeviceProcessingTrace | undefined {
  const i = stepIndex(currentStepId);
  const verifyIndex = stepIndex("verify-dataplane");

  if (device === "LEAF1") {
    const base: DeviceProcessingTrace = { deviceId: "LEAF1", ingressInterfaceId: "LEAF1-hosta", egressInterfaceId: "LEAF1-spine1", stages: LEAF1_INGRESS_STAGES, completedStageIds: [] };
    const active = LEAF1_STEP_IDS.some((id) => stepIndex(id) === i) || i === verifyIndex;
    if (!active) return { ...base, completedStageIds: i > stepIndex("leaf2-egress-confirmed") ? allIds(LEAF1_INGRESS_STAGES) : [] };
    return { ...base, activeStageId: "vxlan-encap", completedStageIds: ["access-port", "vlan-id", "mac-lookup", "vlan-vni-map", "remote-vtep"], packetBefore: "Ethernet frame (VLAN 10)", packetAfter: `VXLAN(VNI ${VNI})` };
  }

  if (device === "SPINE1") {
    const base: DeviceProcessingTrace = { deviceId: "SPINE1", ingressInterfaceId: "SPINE1-leaf1", egressInterfaceId: "SPINE1-leaf2", stages: SPINE1_STAGES, completedStageIds: [] };
    const active = SPINE_STEP_IDS.some((id) => stepIndex(id) === i) || i === verifyIndex;
    if (!active) return base;
    return { ...base, activeStageId: "outer-ip-lookup", completedStageIds: ["underlay-ingress"], packetBefore: `Outer dst IP ${VTEP_LOOPBACK.LEAF2}`, packetAfter: `Forward toward ${VTEP_LOOPBACK.LEAF2}` };
  }

  // LEAF2
  const base: DeviceProcessingTrace = { deviceId: "LEAF2", ingressInterfaceId: "LEAF2-spine1", egressInterfaceId: "LEAF2-hostb", stages: LEAF2_EGRESS_STAGES, completedStageIds: [] };
  const active = LEAF2_STEP_IDS.some((id) => stepIndex(id) === i) || i === verifyIndex;
  if (!active) return { ...base, completedStageIds: i > stepIndex("leaf2-egress-confirmed") ? allIds(LEAF2_EGRESS_STAGES) : [] };
  return { ...base, activeStageId: "vni-lookup", completedStageIds: ["underlay-ingress", "vxlan-decap"], packetBefore: `VXLAN(VNI ${VNI})`, packetAfter: "Original Ethernet Frame → HOST-B" };
}

// ---------------------------------------------------------------------------
// Packet visual stack (3D floating frame stack) — derived from state.packet.
// ---------------------------------------------------------------------------

export function packetFramesFor(state: EvpnState): PacketStackFrame[] | undefined {
  if (!state.packet) return undefined;
  if (!state.packet.encapsulated) {
    return [
      { id: "ethernet", text: "Ethernet", tone: "generic" },
      { id: "ip", text: "IP", tone: "ip" },
    ];
  }
  return [
    { id: "outer-eth", text: "Outer Ethernet", tone: "transport" },
    { id: "outer-ip", text: "Outer IP", tone: "transport" },
    { id: "udp", text: "UDP 4789", tone: "transport" },
    { id: "vxlan", text: `VXLAN VNI ${VNI}`, tone: "vpn", justChanged: true },
    { id: "inner", text: "Original Ethernet Frame", tone: "generic" },
  ];
}

// ---------------------------------------------------------------------------
// Physical interfaces (brief §1/§6)
// ---------------------------------------------------------------------------

interface IfaceDef {
  id: string;
  name: string;
  ip?: string;
  neighborId: EvpnDeviceId;
  neighborLabel: string;
  linkType: string;
  mtu: number;
  protocols: string[];
  extra?: { label: string; value: string }[];
}

const INTERFACES: Record<"LEAF1" | "SPINE1" | "LEAF2", IfaceDef[]> = {
  LEAF1: [
    { id: "LEAF1-hosta", name: "ge-0/0/0", neighborId: "HOST-A", neighborLabel: "HOST-A", linkType: "Access (VLAN 10)", mtu: 1500, protocols: ["Ethernet"], extra: [{ label: "VNI Mapping", value: `VLAN 10 → VNI ${VNI}` }] },
    { id: "LEAF1-spine1", name: "et-0/1/0", ip: "10.0.11.1/31", neighborId: "SPINE1", neighborLabel: "SPINE1", linkType: "Underlay (Uplink)", mtu: 9216, protocols: ["IGP", "BGP EVPN"], extra: [{ label: "VTEP Source", value: `${VTEP_LOOPBACK.LEAF1} (Loopback0)` }] },
  ],
  SPINE1: [
    { id: "SPINE1-leaf1", name: "et-0/0/0", ip: "10.0.11.0/31", neighborId: "LEAF1", neighborLabel: "LEAF1", linkType: "Underlay", mtu: 9216, protocols: ["IGP"] },
    { id: "SPINE1-leaf2", name: "et-0/0/1", ip: "10.0.12.0/31", neighborId: "LEAF2", neighborLabel: "LEAF2", linkType: "Underlay", mtu: 9216, protocols: ["IGP"] },
  ],
  LEAF2: [
    { id: "LEAF2-spine1", name: "et-0/1/0", ip: "10.0.12.1/31", neighborId: "SPINE1", neighborLabel: "SPINE1", linkType: "Underlay (Uplink)", mtu: 9216, protocols: ["IGP", "BGP EVPN"], extra: [{ label: "VTEP Source", value: `${VTEP_LOOPBACK.LEAF2} (Loopback0)` }] },
    { id: "LEAF2-hostb", name: "ge-0/0/0", neighborId: "HOST-B", neighborLabel: "HOST-B", linkType: "Access (VLAN 10)", mtu: 1500, protocols: ["Ethernet"], extra: [{ label: "VNI Mapping", value: `VLAN 10 → VNI ${VNI}` }] },
  ],
};

export function interfacesFor(device: "LEAF1" | "SPINE1" | "LEAF2", state: EvpnState, currentStepId: string): DeviceInterfaceData[] {
  const trace = traceFor(device, state, currentStepId);
  const processing = trace?.activeStageId !== undefined;
  return INTERFACES[device].map((def) => ({
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
    extra: def.extra,
  }));
}

// ---------------------------------------------------------------------------
// Link detail (brief §10)
// ---------------------------------------------------------------------------

const ALL_INTERFACES: Record<EvpnDeviceId, IfaceDef[]> = {
  "HOST-A": [{ id: "HOSTA-leaf1", name: "eth0", ip: "10.10.10.11/24", neighborId: "LEAF1", neighborLabel: "LEAF1", linkType: "Access", mtu: 1500, protocols: ["Ethernet"] }],
  LEAF1: INTERFACES.LEAF1,
  SPINE1: INTERFACES.SPINE1,
  LEAF2: INTERFACES.LEAF2,
  "HOST-B": [{ id: "HOSTB-leaf2", name: "eth0", ip: "10.10.10.22/24", neighborId: "LEAF2", neighborLabel: "LEAF2", linkType: "Access", mtu: 1500, protocols: ["Ethernet"] }],
};

export function linkDetailFor(linkId: string, state: EvpnState): LinkDetail | undefined {
  const edge = GRAPH_EDGES.find((e) => e.id === linkId);
  if (!edge) return undefined;
  const a = edge.a as EvpnDeviceId;
  const b = edge.b as EvpnDeviceId;
  const aIface = ALL_INTERFACES[a]?.find((f) => f.neighborId === b);
  const bIface = ALL_INTERFACES[b]?.find((f) => f.neighborId === a);
  if (!aIface || !bIface) return undefined;
  const isUnderlay = aIface.linkType.startsWith("Underlay");
  const currentlyCarrying = state.packetAt && [a, b].includes(state.packetAt) && state.packet ? (state.packet.encapsulated ? `VXLAN(VNI ${VNI})[${state.packet.innerSrcMac}→${state.packet.innerDstMac}]` : `Ethernet[${state.packet.innerSrcMac}→${state.packet.innerDstMac}]`) : undefined;
  return {
    aLabel: a,
    bLabel: b,
    aInterface: { id: aIface.id, name: aIface.name, status: "up", ip: aIface.ip, neighborId: b, neighborLabel: b, linkType: aIface.linkType, mtu: aIface.mtu, protocols: aIface.protocols, role: "idle" },
    bInterface: { id: bIface.id, name: bIface.name, status: "up", ip: bIface.ip, neighborId: a, neighborLabel: a, linkType: bIface.linkType, mtu: bIface.mtu, protocols: bIface.protocols, role: "idle" },
    status: "up",
    mtu: aIface.mtu,
    protocols: isUnderlay ? [{ label: "IGP", value: "Converged" }, { label: "BGP EVPN", value: state.bgpSessionUp ? "Established" : "Not yet formed" }] : [{ label: "VLAN", value: "10" }],
    currentTraffic: currentlyCarrying,
  };
}

export function macTableRows(state: EvpnState, leaf: LeafId) {
  return state.macTable[leaf];
}

export { HOST_B_IP, HOST_B_MAC };
