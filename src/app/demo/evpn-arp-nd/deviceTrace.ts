import type { DeviceInterfaceData, DeviceProcessingTrace, LinkDetail, PacketMutation, PacketStackFrame, ProcessingStage } from "@/components/network3d/types";
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

/**
 * Scene Adapter for EVPN ARP/ND Suppression — mirrors the shape of
 * evpn-bum's deviceTrace.ts (the closest reference: both lessons are
 * ingress-replication/BUM lessons). No suppression-lookup rule lives
 * here — every Level-3 field below is re-described FROM
 * EvpnArpNdState, never invented.
 */

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

function plainFrames(): PacketStackFrame[] {
  return [
    { id: "ethernet", text: "Ethernet (ARP)", tone: "generic" },
    { id: "arp", text: "ARP", tone: "ip" },
  ];
}
function vxlanFrames(justChanged = false): PacketStackFrame[] {
  return [
    { id: "outer-eth", text: "Outer Ethernet", tone: "transport" },
    { id: "outer-ip", text: "Outer IP", tone: "transport" },
    { id: "udp", text: "UDP 4789", tone: "transport" },
    { id: "vxlan", text: `VXLAN VNI ${VNI}`, tone: "vpn", justChanged },
    { id: "inner", text: "Original ARP Broadcast Frame", tone: "generic" },
  ];
}

export function traceFor(device: "LEAF1" | "SPINE1" | "LEAF2" | "LEAF3", state: EvpnArpNdState, currentStepId: string): DeviceProcessingTrace {
  const i = stepIndex(currentStepId);
  const bumIndex = stepIndex("leaf1-classify-bum");
  const floodReplicateIndex = stepIndex("flood-replicate");
  const floodDeliveredIndex = stepIndex("flood-delivered");
  const suppressionEnterIndex = stepIndex("enter-leaf1-suppression-pipeline");
  const proxyIndex = stepIndex("proxy-reply-built");
  const verifyIndex = stepIndex("verify-dataplane");
  const faultIndex = stepIndex("fault-injected");
  const faultVisualizeIndex = stepIndex("visualize-fault");
  const repairIndex = stepIndex("repair-challenge");

  if (device === "SPINE1") {
    const base: DeviceProcessingTrace = { deviceId: "SPINE1", stages: SPINE1_STAGES, completedStageIds: [] };
    if (i !== floodDeliveredIndex) return { ...base, completedStageIds: state.replicaStage === "delivered" || state.replicaStage === "spine-to-leaves" ? allIds(SPINE1_STAGES) : [] };
    return {
      ...base,
      ingressInterfaceId: "SPINE1-leaf1",
      activeStageId: "outer-ip-lookup",
      completedStageIds: ["underlay-ingress"],
      packetBefore: "2 underlay IP/UDP packets (from LEAF1)",
      packetAfter: "Forwarded independently toward LEAF2 and LEAF3",
      packetBeforeFrames: vxlanFrames(),
      packetAfterFrames: vxlanFrames(),
      lookupType: "Outer IP Lookup, Per Packet",
      lookupKey: "Outer dst IP — one lookup per replica",
      lookupResult: "Forwarded toward LEAF2 and LEAF3 independently",
      reason: "SPINE1 treats each replica as an unrelated underlay packet — it never knows they came from one ARP broadcast, and never inspects the ARP payload.",
    };
  }

  if (device === "LEAF1") {
    if (i === bumIndex || i === floodReplicateIndex || i === faultVisualizeIndex) {
      const fallback = i === faultVisualizeIndex;
      return {
        deviceId: "LEAF1",
        ingressInterfaceId: "LEAF1-hosta",
        egressInterfaceId: "LEAF1-spine1",
        stages: LEAF1_BUM_STAGES,
        activeStageId: "vxlan-replication",
        completedStageIds: ["access-port", "dest-classification", "bum", "vni-flood-list"],
        packetBefore: "ARP broadcast (FF:FF:FF:FF:FF:FF)",
        packetAfter: "2 VXLAN copies created",
        packetBeforeFrames: plainFrames(),
        packetAfterFrames: vxlanFrames(true),
        lookupType: fallback ? "EVPN Suppression Lookup (MISS) → Flood List" : "Destination Classification → Flood List",
        lookupKey: fallback ? `${HOST_B_IP} — no valid IP information` : "Dest MAC FF:FF:FF:FF:FF:FF",
        lookupResult: "BUM → flood list [LEAF2, LEAF3]",
        nextHopId: "SPINE1",
        nextHopLabel: "SPINE1",
        mutations: [{ type: "ENCAPSULATE", detail: `VXLAN VNI ${VNI} — one independent copy per flood-list entry` }],
        reason: fallback
          ? "Suppression tried its lookup first; only because the binding was incomplete does it fall back to ordinary flood-and-learn — never because flooding was disabled."
          : "Suppression doesn't exist yet at this point in the lesson — an unresolved broadcast destination always falls back to ordinary BUM replication.",
      };
    }
    if (i === suppressionEnterIndex || i === proxyIndex || i === verifyIndex) {
      const binding = lookupMacIpBinding(state.macIpBindings.LEAF1, HOST_B_IP);
      const canSuppress = canSuppressNeighborDiscovery(binding);
      const built = i === proxyIndex || i === verifyIndex;
      return {
        deviceId: "LEAF1",
        ingressInterfaceId: "LEAF1-hosta",
        egressInterfaceId: "LEAF1-hosta",
        stages: LEAF1_SUPPRESSION_STAGES,
        activeStageId: built ? "build-reply" : "binding-branch",
        completedStageIds: built ? ["access-ingress", "arp-request", "target-ip", "evpn-lookup", "binding-branch"] : ["access-ingress", "arp-request", "target-ip", "evpn-lookup"],
        packetBefore: `ARP Request — who has ${HOST_B_IP}?`,
        packetAfter: built ? `Proxy ARP Reply — ${HOST_B_IP} is at ${binding?.mac}` : undefined,
        lookupType: "EVPN MAC/IP Database Lookup",
        lookupKey: HOST_B_IP,
        lookupResult: canSuppress ? `Binding found — ${binding?.mac} via remote VTEP ${binding?.vtep} — suppress and reply locally` : "No valid binding — falling back to normal BUM handling",
        nextHopId: built ? "HOST-A" : undefined,
        nextHopLabel: built ? "HOST-A" : undefined,
        forwardingAction: canSuppress ? "YES → local reply" : "NO → normal BUM handling",
        reason: "A valid, complete MAC/IP binding was found locally — LEAF1 answers directly from its own EVPN-learned state instead of flooding the fabric.",
      };
    }
    if (i === faultIndex) {
      const binding = lookupMacIpBinding(state.macIpBindings.LEAF1, HOST_B_IP);
      return {
        deviceId: "LEAF1",
        stages: LEAF1_SUPPRESSION_STAGES,
        activeStageId: "evpn-lookup",
        completedStageIds: ["access-ingress", "arp-request", "target-ip"],
        lookupType: "EVPN MAC/IP Database Lookup (DEGRADED)",
        lookupKey: HOST_B_IP,
        lookupResult: binding ? `MAC known (${binding.mac}), but IP information missing — binding incomplete` : "No binding",
        packetBefore: "Binding: complete (MAC + IP)",
        packetAfter: "Binding: MAC known, IP information MISSING",
        reason: "The underlying Type-2 MAC route is untouched — only the IP portion of the binding that suppression actually needs has degraded.",
      };
    }
    if (i === repairIndex) {
      const binding = lookupMacIpBinding(state.macIpBindings.LEAF1, HOST_B_IP);
      const fixed = state.challengeSucceeded === true;
      return {
        deviceId: "LEAF1",
        stages: LEAF1_SUPPRESSION_STAGES,
        activeStageId: fixed ? "binding-branch" : "evpn-lookup",
        completedStageIds: fixed ? ["access-ingress", "arp-request", "target-ip", "evpn-lookup"] : ["access-ingress", "arp-request", "target-ip"],
        lookupType: "EVPN MAC/IP Database Lookup",
        lookupKey: HOST_B_IP,
        lookupResult: fixed ? `IP information restored — ${binding?.mac} via ${binding?.vtep}, binding complete again` : "IP information still missing",
        packetBefore: "Binding: MAC known, IP information MISSING",
        packetAfter: fixed ? "Binding: complete (MAC + IP) again" : undefined,
        reason: fixed ? "The repair restores the missing Type-2 IP information — suppression can use the binding again." : "Suppression stays correctly degraded to fallback flooding until the IP information is actually restored.",
      };
    }
    return { deviceId: "LEAF1", stages: LEAF1_SUPPRESSION_STAGES, completedStageIds: state.suppressionEnabled ? allIds(LEAF1_SUPPRESSION_STAGES) : [] };
  }

  // LEAF2 / LEAF3 — flood-copy recipients only; never do suppression lookups themselves in this lesson.
  if (i === floodDeliveredIndex) {
    const mutations: PacketMutation[] = [{ type: "DECAPSULATE", detail: `VXLAN VNI ${VNI} removed` }];
    return {
      deviceId: device,
      ingressInterfaceId: `${device}-spine1`,
      stages: IDLE_STAGES,
      activeStageId: "l2-vni",
      completedStageIds: allIds(IDLE_STAGES),
      packetBefore: `VXLAN(VNI ${VNI}) from LEAF1`,
      packetAfter: "ARP broadcast flooded onto local VLAN 10",
      packetBeforeFrames: vxlanFrames(),
      packetAfterFrames: plainFrames(),
      lookupType: "VNI → Local Eligible Ports",
      lookupKey: `VNI ${VNI}`,
      lookupResult: "Decapsulated and flooded onto every locally eligible VLAN 10 port",
      mutations,
      reason: "This leaf is on LEAF1's flood list for this VNI — it decapsulates its own copy and floods the now-plain ARP request locally, exactly like any other BUM delivery. Neither leaf performs a suppression lookup itself; only the ingress VTEP does.",
    };
  }
  const touched = state.replicas.some((r) => r.toLeaf === device) || state.hostBLocation === device;
  return { deviceId: device, stages: IDLE_STAGES, completedStageIds: touched ? allIds(IDLE_STAGES) : [], activeStageId: touched && state.replicaStage !== "none" ? "l2-vni" : undefined };
}

export function packetFramesFor(state: EvpnArpNdState): PacketStackFrame[] | undefined {
  if (state.replicaStage === "none" && !state.packetAt) return undefined;
  return plainFrames();
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
    role: processing && def.id === trace.ingressInterfaceId ? "ingress" : processing && def.id === trace.egressInterfaceId ? "egress" : "idle",
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
