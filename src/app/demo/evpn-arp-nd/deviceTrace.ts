import type { DeviceInterfaceData, DeviceProcessingTrace, LinkDetail, PacketStackFrame, ProcessingStage } from "@/components/network3d/types";
import type { EvpnRibRow } from "@/components/protocol/EvpnRouteTable";
import {
  GRAPH_EDGES,
  HOST_A_IP,
  HOST_B_IP,
  VLAN,
  VNI,
  VTEP_LOOPBACK,
  canSuppressNeighborDiscovery,
  evpnArpNdSteps,
  lookupMacIpBinding,
  type EvpnArpNdDeviceId,
  type EvpnArpNdState,
  type LeafId,
} from "@/lib/sim-engine/scenarios/evpnArpNdSuppression";

const stepIndex = (id: string) => evpnArpNdSteps.findIndex((s) => s.id === id);

const LEAF1_BUM_STAGES: ProcessingStage[] = [
  { id: "access-port", label: "Access Port" },
  { id: "dest-classification", label: "Destination Classification" },
  { id: "bum", label: "BUM" },
  { id: "vni-flood-list", label: "VNI Flood List" },
  { id: "vxlan-replication", label: "VXLAN Replication" },
  { id: "underlay", label: "Underlay Forwarding" },
];
const LEAF1_SUPPRESSION_STAGES: ProcessingStage[] = [
  { id: "access-ingress", label: "Access Ingress" },
  { id: "arp-request", label: "ARP Request" },
  { id: "target-ip", label: "Target IP Extracted" },
  { id: "evpn-lookup", label: "EVPN MAC/IP Database Lookup" },
  { id: "binding-branch", label: "Binding Found?" },
  { id: "build-reply", label: "Build Proxy ARP Reply" },
  { id: "access-egress", label: "Access Egress" },
];
const SPINE1_STAGES: ProcessingStage[] = [
  { id: "underlay-ingress", label: "Underlay Ingress" },
  { id: "outer-ip-lookup", label: "Outer IP Lookup" },
  { id: "forward", label: "Forward" },
];
const IDLE_STAGES: ProcessingStage[] = [
  { id: "access-port", label: "Access Port" },
  { id: "vlan10", label: `VLAN ${VLAN}` },
  { id: "l2-vni", label: `L2 VNI ${VNI}` },
];

function allIds(stages: ProcessingStage[]) {
  return stages.map((s) => s.id);
}

export function traceFor(device: "LEAF1" | "SPINE1" | "LEAF2" | "LEAF3", state: EvpnArpNdState, currentStepId: string): DeviceProcessingTrace {
  const i = stepIndex(currentStepId);

  if (device === "SPINE1") {
    const base: DeviceProcessingTrace = { deviceId: "SPINE1", stages: SPINE1_STAGES, completedStageIds: [] };
    if (state.replicaStage === "none" && i !== stepIndex("flood-delivered")) return base;
    return { ...base, activeStageId: "outer-ip-lookup", completedStageIds: ["underlay-ingress"] };
  }

  if (device === "LEAF1") {
    const bumIndex = stepIndex("leaf1-classify-bum");
    const flResIndex = stepIndex("flood-replicate");
    const suppressionIndex = stepIndex("enter-leaf1-suppression-pipeline");
    const proxyIndex = stepIndex("proxy-reply-built");
    const faultVisualizeIndex = stepIndex("visualize-fault");
    if (i === bumIndex || i === flResIndex) return { deviceId: "LEAF1", stages: LEAF1_BUM_STAGES, activeStageId: "vxlan-replication", completedStageIds: ["access-port", "dest-classification", "bum", "vni-flood-list"] };
    if (i === suppressionIndex || i === proxyIndex) {
      const binding = lookupMacIpBinding(state.macIpBindings.LEAF1, HOST_B_IP);
      const canSuppress = canSuppressNeighborDiscovery(binding);
      return { deviceId: "LEAF1", stages: LEAF1_SUPPRESSION_STAGES, activeStageId: i === proxyIndex ? "build-reply" : "binding-branch", completedStageIds: i === proxyIndex ? ["access-ingress", "arp-request", "target-ip", "evpn-lookup", "binding-branch"] : ["access-ingress", "arp-request", "target-ip", "evpn-lookup"], forwardingAction: canSuppress ? "YES → local reply" : "NO → normal BUM handling" };
    }
    if (i === faultVisualizeIndex) return { deviceId: "LEAF1", stages: LEAF1_BUM_STAGES, activeStageId: "vxlan-replication", completedStageIds: ["access-port", "dest-classification", "bum", "vni-flood-list"], forwardingAction: "Binding miss — fallback BUM" };
    return { deviceId: "LEAF1", stages: LEAF1_SUPPRESSION_STAGES, completedStageIds: state.suppressionEnabled ? allIds(LEAF1_SUPPRESSION_STAGES) : [] };
  }

  // LEAF2 / LEAF3
  const touched = state.replicas.some((r) => r.toLeaf === device) || state.hostBLocation === device;
  return { deviceId: device, stages: IDLE_STAGES, completedStageIds: touched ? allIds(IDLE_STAGES) : [], activeStageId: touched && state.replicaStage !== "none" ? "l2-vni" : undefined };
}

export function packetFramesFor(state: EvpnArpNdState): PacketStackFrame[] | undefined {
  if (state.replicaStage === "none" && !state.packetAt) return undefined;
  return [
    { id: "ethernet", text: "Ethernet (ARP)", tone: "generic" },
    { id: "arp", text: "ARP", tone: "ip" },
  ];
}

interface IfaceDef {
  id: string;
  name: string;
  ip?: string;
  neighborId: EvpnArpNdDeviceId;
  neighborLabel: string;
  linkType: string;
  mtu: number;
  protocols: string[];
  extra?: { label: string; value: string }[];
}

const INTERFACES: Record<"LEAF1" | "SPINE1" | "LEAF2" | "LEAF3", IfaceDef[]> = {
  LEAF1: [
    { id: "LEAF1-hosta", name: "ge-0/0/0", neighborId: "HOST-A", neighborLabel: "HOST-A", linkType: `Access (VLAN ${VLAN})`, mtu: 1500, protocols: ["Ethernet"] },
    { id: "LEAF1-spine1", name: "et-0/1/0", ip: "10.0.11.1/31", neighborId: "SPINE1", neighborLabel: "SPINE1", linkType: "Underlay (Uplink)", mtu: 9216, protocols: ["IGP", "BGP EVPN"], extra: [{ label: "VTEP Source", value: `${VTEP_LOOPBACK.LEAF1} (Loopback0)` }] },
  ],
  SPINE1: [
    { id: "SPINE1-leaf1", name: "et-0/0/0", ip: "10.0.11.0/31", neighborId: "LEAF1", neighborLabel: "LEAF1", linkType: "Underlay", mtu: 9216, protocols: ["IGP"] },
    { id: "SPINE1-leaf2", name: "et-0/0/1", ip: "10.0.12.0/31", neighborId: "LEAF2", neighborLabel: "LEAF2", linkType: "Underlay", mtu: 9216, protocols: ["IGP"] },
    { id: "SPINE1-leaf3", name: "et-0/0/2", ip: "10.0.13.0/31", neighborId: "LEAF3", neighborLabel: "LEAF3", linkType: "Underlay", mtu: 9216, protocols: ["IGP"] },
  ],
  LEAF2: [{ id: "LEAF2-spine1", name: "et-0/1/0", ip: "10.0.12.1/31", neighborId: "SPINE1", neighborLabel: "SPINE1", linkType: "Underlay (Uplink)", mtu: 9216, protocols: ["IGP", "BGP EVPN"], extra: [{ label: "VTEP Source", value: `${VTEP_LOOPBACK.LEAF2} (Loopback0)` }] }],
  LEAF3: [
    { id: "LEAF3-spine1", name: "et-0/1/0", ip: "10.0.13.1/31", neighborId: "SPINE1", neighborLabel: "SPINE1", linkType: "Underlay (Uplink)", mtu: 9216, protocols: ["IGP", "BGP EVPN"], extra: [{ label: "VTEP Source", value: `${VTEP_LOOPBACK.LEAF3} (Loopback0)` }] },
    { id: "LEAF3-hostb", name: "ge-0/0/0", neighborId: "HOST-B", neighborLabel: "HOST-B", linkType: `Access (VLAN ${VLAN})`, mtu: 1500, protocols: ["Ethernet"] },
  ],
};

export function interfacesFor(device: "LEAF1" | "SPINE1" | "LEAF2" | "LEAF3", state: EvpnArpNdState, currentStepId: string): DeviceInterfaceData[] {
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
    role: processing ? "ingress" : "idle",
    extra: def.extra,
  }));
}

export function evpnRibRowsFor(state: EvpnArpNdState, leaf: LeafId): EvpnRibRow[] {
  return state.macIpBindings[leaf].map((b) => ({
    routeType: "2",
    summary: `${b.mac} / ${b.ip}`,
    nextHop: b.origin === "local" ? "(local)" : b.vtep ?? "—",
    extra: b.origin === "remote" ? [{ label: "IP Info", value: b.hasIpInfo ? "present" : "MISSING" }] : undefined,
  }));
}

export function bindingRowsFor(state: EvpnArpNdState, leaf: LeafId) {
  return state.macIpBindings[leaf].map((b) => ({
    label: `${b.ip} (${b.mac})`,
    value: b.origin === "local" ? "Local" : `Remote via ${b.vtep} — ${b.hasIpInfo ? "current" : "STALE / MISSING IP INFO"}`,
  }));
}

export function linkDetailFor(linkId: string, state: EvpnArpNdState): LinkDetail | undefined {
  const edge = GRAPH_EDGES.find((e) => e.id === linkId);
  if (!edge) return undefined;
  const a = edge.a as EvpnArpNdDeviceId;
  const b = edge.b as EvpnArpNdDeviceId;
  const allIfaces: Record<string, IfaceDef[]> = {
    "HOST-A": [{ id: "HOSTA-leaf1", name: "eth0", ip: `${HOST_A_IP}/24`, neighborId: "LEAF1", neighborLabel: "LEAF1", linkType: "Access", mtu: 1500, protocols: ["Ethernet"] }],
    ...INTERFACES,
    "HOST-B": [{ id: "HOSTB-leaf3", name: "eth0", ip: `${HOST_B_IP}/24`, neighborId: "LEAF3", neighborLabel: "LEAF3", linkType: "Access", mtu: 1500, protocols: ["Ethernet"] }],
  };
  const aIface = allIfaces[a]?.find((f) => f.neighborId === b);
  const bIface = allIfaces[b]?.find((f) => f.neighborId === a);
  if (!aIface || !bIface) return undefined;
  const isUnderlay = aIface.linkType.startsWith("Underlay");
  return {
    aLabel: a,
    bLabel: b,
    aInterface: { id: aIface.id, name: aIface.name, status: "up", ip: aIface.ip, neighborId: b, neighborLabel: b, linkType: aIface.linkType, mtu: aIface.mtu, protocols: aIface.protocols, role: "idle" },
    bInterface: { id: bIface.id, name: bIface.name, status: "up", ip: bIface.ip, neighborId: a, neighborLabel: a, linkType: bIface.linkType, mtu: bIface.mtu, protocols: bIface.protocols, role: "idle" },
    status: "up",
    mtu: aIface.mtu,
    protocols: isUnderlay ? [{ label: "IGP", value: "Converged" }, { label: "BGP EVPN", value: state.bgpSessionUp ? "Established" : "Not yet formed" }] : [{ label: "VLAN", value: String(VLAN) }],
  };
}

export interface CliOutput {
  cmd: string;
  output: string;
}
export interface CliCommandEntry {
  id: string;
  label: string;
  cisco: CliOutput;
  juniper: CliOutput;
}

export function buildArpNdCliCommands(state: EvpnArpNdState, leaf: LeafId): CliCommandEntry[] {
  const binding = lookupMacIpBinding(state.macIpBindings[leaf], HOST_B_IP);
  const evpnCisco: CliOutput = { cmd: "show l2route evpn mac-ip all", output: binding ? `MAC ${binding.mac}    IP ${binding.hasIpInfo ? binding.ip : "(missing)"}    Next-hop ${binding.vtep ?? "(local)"}` : "(no entry)" };
  const evpnJuniper: CliOutput = { cmd: "show evpn database extensive", output: binding ? `MAC+IP: ${binding.mac} / ${binding.hasIpInfo ? binding.ip : "<absent>"}    Remote PE: ${binding.vtep ?? "(local)"}` : "(no entry)" };
  const arpCisco: CliOutput = { cmd: "show ip arp suppression-cache", output: leaf === "LEAF1" && state.suppressionEnabled ? `${HOST_B_IP}    ${binding?.mac}    Suppressed: ${binding?.hasIpInfo ? "yes" : "no — fallback to flood"}` : "(suppression not active here)" };
  const arpJuniper: CliOutput = { cmd: "show evpn arp-suppression-table", output: leaf === "LEAF1" && state.suppressionEnabled ? `${HOST_B_IP}/${binding?.mac}    State: ${binding?.hasIpInfo ? "Active" : "Incomplete"}` : "(suppression not active here)" };
  return [
    { id: "evpn", label: "evpn mac-ip", cisco: evpnCisco, juniper: evpnJuniper },
    { id: "arp", label: "arp suppression", cisco: arpCisco, juniper: arpJuniper },
  ];
}

export function buildSpineCliCommands(): CliCommandEntry[] {
  return [{ id: "underlay", label: "underlay routes", cisco: { cmd: "show ip route ospf", output: "10.255.0.1/32, 10.255.0.2/32, 10.255.0.3/32 — all via OSPF" }, juniper: { cmd: "show route protocol ospf", output: "10.255.0.1/32, 10.255.0.2/32, 10.255.0.3/32 — all *[OSPF/10]" } }];
}
