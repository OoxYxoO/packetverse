import type { DeviceInterfaceData, DeviceProcessingTrace, LinkDetail, PacketStackFrame, ProcessingStage } from "@/components/network3d/types";
import { evpnBumSteps, GRAPH_EDGES, VNI, VTEP_LOOPBACK, type EvpnBumDeviceId, type EvpnBumState, type LeafId } from "@/lib/sim-engine/scenarios/evpnBum";

/**
 * Scene Adapter for EVPN BUM + Route Type 3 — mirrors the Foundations
 * lesson's deviceTrace.ts exactly in shape. Every value below is
 * computed FROM EvpnBumState; nothing here decides replication or
 * route-target policy, it only re-describes decisions the scenario
 * layer already made.
 */

const stepIndex = (id: string) => evpnBumSteps.findIndex((s) => s.id === id);

// ---------------------------------------------------------------------------
// Conceptual BUM Forwarding Pipeline (LEAF1) + simplified egress (LEAF2/LEAF3)
// ---------------------------------------------------------------------------

const LEAF1_BUM_STAGES: ProcessingStage[] = [
  { id: "access-frame", label: "Access Frame Arrives" },
  { id: "determine-vni", label: "Determine VNI" },
  { id: "dest-classification", label: "Destination Classification" },
  { id: "bum", label: "BUM" },
  { id: "vni-flood-list", label: "VNI Flood List" },
  { id: "remote-vteps", label: "Remote VTEPs" },
  { id: "vxlan-replication", label: "VXLAN Replication" },
  { id: "underlay-forwarding", label: "Underlay Forwarding" },
];
const SPINE1_STAGES: ProcessingStage[] = [
  { id: "underlay-ingress", label: "Underlay Ingress" },
  { id: "outer-ip-lookup", label: "Outer IP Lookup (ECMP), Per Packet" },
  { id: "forward", label: "Forward — Inner Frame Not Inspected" },
  { id: "uplinks", label: "Uplinks To LEAF2 + LEAF3" },
];
const LEAF_EGRESS_STAGES: ProcessingStage[] = [
  { id: "vxlan-decap", label: "VXLAN Decapsulation" },
  { id: "vni-lookup", label: "VNI 10010" },
  { id: "local-ports", label: "Local Eligible Ports" },
  { id: "eth-delivery", label: "Ethernet Delivery" },
];

function allIds(stages: ProcessingStage[]) {
  return stages.map((s) => s.id);
}

export function traceFor(device: "LEAF1" | "SPINE1" | "LEAF2" | "LEAF3", state: EvpnBumState, currentStepId: string): DeviceProcessingTrace {
  const i = stepIndex(currentStepId);
  const classifyIndex = stepIndex("leaf1-bum-classify");
  const spineIndex = stepIndex("spine-forward-bum");
  const decapIndex = stepIndex("leaves-decap-bum");
  const verifyIndex = stepIndex("verify-dataplane");

  if (device === "LEAF1") {
    const base: DeviceProcessingTrace = { deviceId: "LEAF1", ingressInterfaceId: "LEAF1-hosta", egressInterfaceId: "LEAF1-spine1", stages: LEAF1_BUM_STAGES, completedStageIds: [] };
    if (i !== classifyIndex && i !== verifyIndex) return { ...base, completedStageIds: i > classifyIndex ? allIds(LEAF1_BUM_STAGES) : [] };
    return { ...base, activeStageId: "vxlan-replication", completedStageIds: ["access-frame", "determine-vni", "dest-classification", "bum", "vni-flood-list", "remote-vteps"], packetBefore: "Broadcast Ethernet frame", packetAfter: `${state.floodList.LEAF1.length} VXLAN cop${state.floodList.LEAF1.length === 1 ? "y" : "ies"}` };
  }

  if (device === "SPINE1") {
    const base: DeviceProcessingTrace = { deviceId: "SPINE1", ingressInterfaceId: "SPINE1-leaf1", egressInterfaceId: "SPINE1-leaf2", stages: SPINE1_STAGES, completedStageIds: [] };
    if (i !== spineIndex && i !== verifyIndex) return base;
    return { ...base, activeStageId: "outer-ip-lookup", completedStageIds: ["underlay-ingress"], packetBefore: "2 underlay IP/UDP packets", packetAfter: "Forwarded independently, per outer dest IP" };
  }

  // LEAF2 / LEAF3
  const base: DeviceProcessingTrace = { deviceId: device, ingressInterfaceId: `${device}-spine1`, egressInterfaceId: `${device}-${device === "LEAF2" ? "hostb" : "hostc"}`, stages: LEAF_EGRESS_STAGES, completedStageIds: [] };
  if (i !== decapIndex && i !== verifyIndex) return { ...base, completedStageIds: i > decapIndex ? allIds(LEAF_EGRESS_STAGES) : [] };
  return { ...base, activeStageId: "vni-lookup", completedStageIds: ["vxlan-decap"], packetBefore: `VXLAN(VNI ${VNI})`, packetAfter: `Original broadcast frame → HOST-${device === "LEAF2" ? "B" : "C"}` };
}

// ---------------------------------------------------------------------------
// Packet visual stack (3D floating frame stack)
// ---------------------------------------------------------------------------

export function packetFramesFor(state: EvpnBumState): PacketStackFrame[] | undefined {
  if (!state.packet) return undefined;
  if (!state.packet.encapsulated) {
    return [
      { id: "ethernet", text: "Ethernet (Broadcast)", tone: "generic" },
      { id: "ip", text: "IP", tone: "ip" },
    ];
  }
  return [
    { id: "outer-eth", text: "Outer Ethernet", tone: "transport" },
    { id: "outer-ip", text: "Outer IP", tone: "transport" },
    { id: "udp", text: "UDP 4789", tone: "transport" },
    { id: "vxlan", text: `VXLAN VNI ${VNI}`, tone: "vpn", justChanged: true },
    { id: "inner", text: "Original Broadcast Frame", tone: "generic" },
  ];
}

// ---------------------------------------------------------------------------
// Physical interfaces
// ---------------------------------------------------------------------------

interface IfaceDef {
  id: string;
  name: string;
  ip?: string;
  neighborId: EvpnBumDeviceId;
  neighborLabel: string;
  linkType: string;
  mtu: number;
  protocols: string[];
  extra?: { label: string; value: string }[];
}

const INTERFACES: Record<"LEAF1" | "SPINE1" | "LEAF2" | "LEAF3", IfaceDef[]> = {
  LEAF1: [
    { id: "LEAF1-hosta", name: "ge-0/0/0", neighborId: "HOST-A", neighborLabel: "HOST-A", linkType: "Access (VLAN 10)", mtu: 1500, protocols: ["Ethernet"], extra: [{ label: "VNI Mapping", value: `VLAN 10 → VNI ${VNI}` }] },
    { id: "LEAF1-spine1", name: "et-0/1/0", ip: "10.0.11.1/31", neighborId: "SPINE1", neighborLabel: "SPINE1", linkType: "Underlay (Uplink)", mtu: 9216, protocols: ["IGP", "BGP EVPN"], extra: [{ label: "VTEP Source", value: `${VTEP_LOOPBACK.LEAF1} (Loopback0)` }] },
  ],
  SPINE1: [
    { id: "SPINE1-leaf1", name: "et-0/0/0", ip: "10.0.11.0/31", neighborId: "LEAF1", neighborLabel: "LEAF1", linkType: "Underlay", mtu: 9216, protocols: ["IGP"] },
    { id: "SPINE1-leaf2", name: "et-0/0/1", ip: "10.0.12.0/31", neighborId: "LEAF2", neighborLabel: "LEAF2", linkType: "Underlay", mtu: 9216, protocols: ["IGP"] },
    { id: "SPINE1-leaf3", name: "et-0/0/2", ip: "10.0.13.0/31", neighborId: "LEAF3", neighborLabel: "LEAF3", linkType: "Underlay", mtu: 9216, protocols: ["IGP"] },
  ],
  LEAF2: [
    { id: "LEAF2-spine1", name: "et-0/1/0", ip: "10.0.12.1/31", neighborId: "SPINE1", neighborLabel: "SPINE1", linkType: "Underlay (Uplink)", mtu: 9216, protocols: ["IGP", "BGP EVPN"], extra: [{ label: "VTEP Source", value: `${VTEP_LOOPBACK.LEAF2} (Loopback0)` }] },
    { id: "LEAF2-hostb", name: "ge-0/0/0", neighborId: "HOST-B", neighborLabel: "HOST-B", linkType: "Access (VLAN 10)", mtu: 1500, protocols: ["Ethernet"], extra: [{ label: "VNI Mapping", value: `VLAN 10 → VNI ${VNI}` }] },
  ],
  LEAF3: [
    { id: "LEAF3-spine1", name: "et-0/1/0", ip: "10.0.13.1/31", neighborId: "SPINE1", neighborLabel: "SPINE1", linkType: "Underlay (Uplink)", mtu: 9216, protocols: ["IGP", "BGP EVPN"], extra: [{ label: "VTEP Source", value: `${VTEP_LOOPBACK.LEAF3} (Loopback0)` }] },
    { id: "LEAF3-hostc", name: "ge-0/0/0", neighborId: "HOST-C", neighborLabel: "HOST-C", linkType: "Access (VLAN 10)", mtu: 1500, protocols: ["Ethernet"], extra: [{ label: "VNI Mapping", value: `VLAN 10 → VNI ${VNI}` }] },
  ],
};

export function interfacesFor(device: "LEAF1" | "SPINE1" | "LEAF2" | "LEAF3", state: EvpnBumState, currentStepId: string): DeviceInterfaceData[] {
  const trace = traceFor(device, state, currentStepId);
  const processing = trace.activeStageId !== undefined;
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
    packetCount: trace.completedStageIds.length > 0 || processing ? 1 : 0,
    role: processing && def.id === trace.ingressInterfaceId ? "ingress" : processing && def.id === trace.egressInterfaceId ? "egress" : "idle",
    extra: def.extra,
  }));
}

// ---------------------------------------------------------------------------
// Link detail
// ---------------------------------------------------------------------------

const ALL_INTERFACES: Record<EvpnBumDeviceId, IfaceDef[]> = {
  "HOST-A": [{ id: "HOSTA-leaf1", name: "eth0", ip: "10.10.10.11/24", neighborId: "LEAF1", neighborLabel: "LEAF1", linkType: "Access", mtu: 1500, protocols: ["Ethernet"] }],
  LEAF1: INTERFACES.LEAF1,
  SPINE1: INTERFACES.SPINE1,
  LEAF2: INTERFACES.LEAF2,
  LEAF3: INTERFACES.LEAF3,
  "HOST-B": [{ id: "HOSTB-leaf2", name: "eth0", ip: "10.10.10.22/24", neighborId: "LEAF2", neighborLabel: "LEAF2", linkType: "Access", mtu: 1500, protocols: ["Ethernet"] }],
  "HOST-C": [{ id: "HOSTC-leaf3", name: "eth0", ip: "10.10.10.33/24", neighborId: "LEAF3", neighborLabel: "LEAF3", linkType: "Access", mtu: 1500, protocols: ["Ethernet"] }],
};

export function linkDetailFor(linkId: string, state: EvpnBumState): LinkDetail | undefined {
  const edge = GRAPH_EDGES.find((e) => e.id === linkId);
  if (!edge) return undefined;
  const a = edge.a as EvpnBumDeviceId;
  const b = edge.b as EvpnBumDeviceId;
  const aIface = ALL_INTERFACES[a]?.find((f) => f.neighborId === b);
  const bIface = ALL_INTERFACES[b]?.find((f) => f.neighborId === a);
  if (!aIface || !bIface) return undefined;
  const isUnderlay = aIface.linkType.startsWith("Underlay");
  return {
    aLabel: a,
    bLabel: b,
    aInterface: { id: aIface.id, name: aIface.name, status: "up", ip: aIface.ip, neighborId: b, neighborLabel: b, linkType: aIface.linkType, mtu: aIface.mtu, protocols: aIface.protocols, role: "idle" },
    bInterface: { id: bIface.id, name: bIface.name, status: "up", ip: bIface.ip, neighborId: a, neighborLabel: a, linkType: bIface.linkType, mtu: bIface.mtu, protocols: bIface.protocols, role: "idle" },
    status: "up",
    mtu: aIface.mtu,
    protocols: isUnderlay ? [{ label: "IGP", value: "Converged" }, { label: "BGP EVPN", value: state.bgpSessionUp ? "Established" : "Not yet formed" }] : [{ label: "VLAN", value: "10" }],
  };
}

export function floodListRows(state: EvpnBumState, leaf: LeafId): { leaf: string; vtep: string; status: "member" | "missing" | "rejected" }[] {
  const others = (["LEAF1", "LEAF2", "LEAF3"] as LeafId[]).filter((l) => l !== leaf);
  return others.map((other) => {
    const isMember = state.floodList[leaf].includes(other);
    const received = state.received[leaf]?.find((r) => r.route.originLeaf === other);
    const status: "member" | "missing" | "rejected" = isMember ? "member" : received && received.rtChecked && !received.rtMatched ? "rejected" : "missing";
    return { leaf: other, vtep: VTEP_LOOPBACK[other], status };
  });
}
