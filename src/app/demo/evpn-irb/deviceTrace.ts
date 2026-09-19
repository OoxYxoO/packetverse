import type { DeviceInterfaceData, DeviceProcessingTrace, LinkDetail, PacketMutation, PacketStackFrame, ProcessingStage } from "@/components/network3d/types";
import {
  ANYCAST_GATEWAYS,
  evpnIrbSteps,
  GRAPH_EDGES,
  GATEWAY_IP,
  GATEWAY_MAC,
  HOST_FOR_LEAF,
  L2_VNI_10,
  L2_VNI_20,
  L3_VNI,
  ROUTER_MAC,
  VLAN_FOR_LEAF,
  VRF,
  VTEP_LOOPBACK,
  type EvpnIrbDeviceId,
  type EvpnIrbState,
  type LeafId,
} from "@/lib/sim-engine/scenarios/evpnIrb";

/**
 * Scene Adapter for EVPN IRB + Distributed Anycast Gateway — mirrors
 * the shape of the two earlier EVPN lessons' deviceTrace.ts files.
 * No IRB/VRF/routing logic lives here — every value is derived FROM
 * EvpnIrbState, re-described in the generic DeviceProcessingTrace /
 * DeviceInterfaceData shape the 3D layer understands.
 */

const stepIndex = (id: string) => evpnIrbSteps.findIndex((s) => s.id === id);

// ---------------------------------------------------------------------------
// Conceptual Symmetric IRB Ingress/Egress pipelines (brief §8/§14/§15)
// ---------------------------------------------------------------------------

const LEAF1_IRB_STAGES: ProcessingStage[] = [
  { id: "access-port", label: "Access Port" },
  { id: "vlan10", label: "VLAN 10" },
  { id: "dst-mac-gw", label: "Destination MAC = Anycast Gateway" },
  { id: "l3-irb", label: "L3 / IRB Processing" },
  { id: "vrf", label: "VRF TENANT-A" },
  { id: "dst-ip-lookup", label: "Destination IP Lookup" },
  { id: "remote-reachability", label: "Remote HOST-B Reachability" },
  { id: "remote-vtep", label: "Remote VTEP = LEAF3" },
  { id: "l3vni", label: `L3 VNI ${L3_VNI}` },
  { id: "vxlan-encap", label: "VXLAN Encapsulation" },
  { id: "underlay", label: "Underlay" },
];
const SPINE1_STAGES: ProcessingStage[] = [
  { id: "vxlan-arrives", label: "VXLAN Packet Arrives" },
  { id: "read-outer-ip", label: "Read Outer Destination IP" },
  { id: "route-toward", label: "Route Toward LEAF3 VTEP" },
  { id: "forward", label: "Forward" },
];
const LEAF3_IRB_STAGES: ProcessingStage[] = [
  { id: "underlay-ingress", label: "Underlay Ingress" },
  { id: "vxlan-decap", label: "VXLAN Decap" },
  { id: "l3vni", label: `L3 VNI ${L3_VNI}` },
  { id: "vrf", label: "VRF TENANT-A" },
  { id: "dst-route", label: "Destination Route" },
  { id: "vlan20", label: `VLAN 20 / L2 VNI ${L2_VNI_20}` },
  { id: "eth-rewrite", label: "Ethernet Rewrite" },
  { id: "hostb-access", label: "HOST-B Access Port" },
];
/** LEAF2 never sits on the routed HOST-A ↔ HOST-B path in this lesson — it only ever bridges HOST-A ↔ HOST-C locally, so it gets the same simple bridging shape every earlier EVPN lesson used, not the IRB pipeline. */
const LEAF2_BRIDGE_STAGES: ProcessingStage[] = [
  { id: "access-port", label: "Access Port" },
  { id: "vlan10", label: "VLAN 10" },
  { id: "mac-lookup", label: "MAC Lookup" },
  { id: "l2-vni", label: `L2 VNI ${L2_VNI_10}` },
  { id: "deliver", label: "Deliver" },
];

function allIds(stages: ProcessingStage[]) {
  return stages.map((s) => s.id);
}

function plainFrames(): PacketStackFrame[] {
  return [
    { id: "ethernet", text: "Ethernet", tone: "generic" },
    { id: "ip", text: "IP", tone: "ip" },
  ];
}
function routedFrames(justChangedId?: string): PacketStackFrame[] {
  return [
    { id: "outer-eth", text: "Outer Ethernet", tone: "transport" },
    { id: "outer-ip", text: "Outer IP", tone: "transport" },
    { id: "udp", text: "UDP 4789", tone: "transport" },
    { id: "vxlan", text: `VXLAN L3 VNI ${L3_VNI}`, tone: "vpn", justChanged: justChangedId === "vxlan" },
    { id: "inner-eth", text: "Inner Ethernet (RMAC)", tone: "generic", justChanged: justChangedId === "inner-eth" },
    { id: "inner-ip", text: "Inner IP", tone: "ip" },
  ];
}

export function traceFor(device: "LEAF1" | "SPINE1" | "LEAF2" | "LEAF3", state: EvpnIrbState, currentStepId: string): DeviceProcessingTrace {
  const i = stepIndex(currentStepId);
  const verifyIndex = stepIndex("verify-dataplane");

  if (device === "LEAF1") {
    const base: DeviceProcessingTrace = { deviceId: "LEAF1", ingressInterfaceId: "LEAF1-hosta", egressInterfaceId: "LEAF1-spine1", stages: LEAF1_IRB_STAGES, completedStageIds: [] };
    const enterIndex = stepIndex("enter-leaf1-irb");
    const encapIndex = stepIndex("packet-transformation");
    if (i < enterIndex) return base;
    if (i === enterIndex) {
      return {
        ...base,
        activeStageId: "dst-mac-gw",
        completedStageIds: ["access-port", "vlan10"],
        packetBefore: "Ethernet[HOST-A → Anycast GW]",
        packetBeforeFrames: plainFrames(),
        lookupType: "Destination MAC Check",
        lookupKey: `Dst MAC ${GATEWAY_MAC}`,
        lookupResult: "Matches the local Anycast Gateway — route, don't bridge",
        reason: "The destination MAC is LEAF1's own Anycast Gateway identity, not a locally-known host MAC — that alone is what turns this into an L3/IRB decision instead of a bridging one.",
      };
    }
    if (i > enterIndex && i < encapIndex) {
      const received = state.remoteHostRoutes.LEAF1?.[0];
      return {
        ...base,
        activeStageId: "remote-reachability",
        completedStageIds: ["access-port", "vlan10", "dst-mac-gw", "l3-irb", "vrf", "dst-ip-lookup"],
        packetBefore: "IP[HOST-A → HOST-B]",
        packetBeforeFrames: plainFrames(),
        lookupType: `VRF ${VRF} Destination Lookup`,
        lookupKey: received?.route.ip ?? "HOST-B",
        lookupResult: received?.imported ? `${received.route.ip} → remote VTEP ${VTEP_LOOPBACK[received.route.originLeaf]} (via EVPN Type 2)` : "Not yet resolved",
        nextHopId: received?.imported ? "LEAF3" : undefined,
        nextHopLabel: received?.imported ? "LEAF3" : undefined,
        reason: "This is an ordinary VRF IP lookup, resolved by the same EVPN Type 2 route the Foundations lesson taught — no Type 5 prefix route is involved for a single host like HOST-B.",
      };
    }
    if (i === encapIndex || i === verifyIndex) {
      const l3vni = state.l3VniByLeaf.LEAF1;
      return {
        ...base,
        activeStageId: "vxlan-encap",
        completedStageIds: ["access-port", "vlan10", "dst-mac-gw", "l3-irb", "vrf", "dst-ip-lookup", "remote-reachability", "remote-vtep", "l3vni"],
        packetBefore: "IP[HOST-A → HOST-B]",
        packetAfter: `VXLAN(L3 VNI ${l3vni})`,
        packetBeforeFrames: plainFrames(),
        packetAfterFrames: routedFrames("vxlan"),
        lookupType: "Routed VXLAN Encapsulation",
        lookupKey: `L3 VNI ${l3vni}`,
        lookupResult: `Inner Ethernet rewritten to Router MACs; wrapped in VXLAN toward ${VTEP_LOOPBACK.LEAF3}`,
        nextHopId: "SPINE1",
        nextHopLabel: "SPINE1",
        mutations: [{ type: "MAC_CHANGE", detail: "Inner Ethernet rewritten to Router MACs (LEAF1 → LEAF3), never the destination host's own MAC" }, { type: "ENCAPSULATE", detail: `VXLAN L3 VNI ${l3vni}` }] as PacketMutation[],
        reason: "The IP endpoints never change here — only the Ethernet header (now Router MACs) and the new VXLAN/L3-VNI wrapper.",
      };
    }
    return { ...base, completedStageIds: allIds(LEAF1_IRB_STAGES), packetAfter: `VXLAN(L3 VNI ${state.l3VniByLeaf.LEAF1})`, packetAfterFrames: routedFrames() };
  }

  if (device === "SPINE1") {
    const base: DeviceProcessingTrace = { deviceId: "SPINE1", ingressInterfaceId: "SPINE1-leaf1", egressInterfaceId: "SPINE1-leaf3", stages: SPINE1_STAGES, completedStageIds: [] };
    const spineIndex = stepIndex("spine-forward-irb");
    if (i !== spineIndex && i !== verifyIndex) return base;
    return {
      ...base,
      activeStageId: "read-outer-ip",
      completedStageIds: ["vxlan-arrives"],
      packetBefore: `Outer dst IP ${VTEP_LOOPBACK.LEAF3}`,
      packetAfter: `Forwarded toward ${VTEP_LOOPBACK.LEAF3}`,
      packetBeforeFrames: routedFrames(),
      packetAfterFrames: routedFrames(),
      lookupType: "Underlay Route Lookup",
      lookupKey: VTEP_LOOPBACK.LEAF3,
      lookupResult: `Forward toward ${VTEP_LOOPBACK.LEAF3}`,
      nextHopId: "LEAF3",
      nextHopLabel: "LEAF3",
      reason: "SPINE1 has no VRF, no Anycast Gateway, and no idea this traffic was ever routed between subnets — it forwards strictly on the outer destination IP.",
    };
  }

  if (device === "LEAF3") {
    const base: DeviceProcessingTrace = { deviceId: "LEAF3", ingressInterfaceId: "LEAF3-spine1", egressInterfaceId: "LEAF3-hostb", stages: LEAF3_IRB_STAGES, completedStageIds: [] };
    const egressIndex = stepIndex("leaf3-egress-irb");
    if (i !== egressIndex && i !== verifyIndex) return { ...base, completedStageIds: i > egressIndex ? allIds(LEAF3_IRB_STAGES) : [] };
    const mismatch = state.l3VniByLeaf.LEAF3 !== L3_VNI;
    if (mismatch) {
      return {
        ...base,
        activeStageId: "l3vni",
        completedStageIds: ["underlay-ingress", "vxlan-decap"],
        packetBefore: `VXLAN(L3 VNI ${L3_VNI})`,
        packetAfter: `DROPPED — VRF TENANT-A expects L3 VNI ${state.l3VniByLeaf.LEAF3}`,
        packetBeforeFrames: routedFrames(),
        lookupType: `VRF ${VRF} → L3 VNI Mapping`,
        lookupKey: `Received L3 VNI ${L3_VNI}`,
        lookupResult: `No match — this leaf's VRF ${VRF} is mapped to L3 VNI ${state.l3VniByLeaf.LEAF3}`,
        reason: "A routed VXLAN packet has to land in the VRF its L3 VNI actually maps to on THIS leaf — LEAF3's own mapping was changed, so it has nowhere to go.",
      };
    }
    return {
      ...base,
      activeStageId: "dst-route",
      completedStageIds: ["underlay-ingress", "vxlan-decap", "l3vni", "vrf"],
      packetBefore: `VXLAN(L3 VNI ${L3_VNI})`,
      packetAfter: "Ethernet[Anycast GW → HOST-B]",
      packetBeforeFrames: routedFrames(),
      packetAfterFrames: plainFrames(),
      lookupType: `VRF ${VRF} Destination Route`,
      lookupKey: "HOST-B",
      lookupResult: `VLAN 20 / L2 VNI ${L2_VNI_20} — local access port`,
      nextHopId: "HOST-B",
      nextHopLabel: "HOST-B",
      mutations: [{ type: "DECAPSULATE", detail: `VXLAN L3 VNI ${L3_VNI} removed` }, { type: "MAC_CHANGE", detail: "Ethernet rewritten: src = local Anycast Gateway (VLAN 20), dst = HOST-B's real MAC" }] as PacketMutation[],
      reason: "This is the second routing stage of symmetric IRB — LEAF3 routes back OUT of the L3 VNI into VLAN 20, exactly as LEAF1 routed in.",
    };
  }

  // LEAF2 — same-subnet bridging only, never active during the main routed journey.
  return { deviceId: "LEAF2", ingressInterfaceId: "LEAF2-hostc", egressInterfaceId: "LEAF2-spine1", stages: LEAF2_BRIDGE_STAGES, completedStageIds: [] };
}

// ---------------------------------------------------------------------------
// Packet visual stack (3D floating frame stack)
// ---------------------------------------------------------------------------

export function packetFramesFor(state: EvpnIrbState): PacketStackFrame[] | undefined {
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
    { id: "vxlan", text: `VXLAN L3 VNI ${state.packet.l3Vni ?? L3_VNI}`, tone: "vpn", justChanged: true },
    { id: "inner-eth", text: "Inner Ethernet (RMAC)", tone: "generic" },
    { id: "inner-ip", text: "Inner IP", tone: "ip" },
  ];
}

// ---------------------------------------------------------------------------
// Physical interfaces + Anycast Gateway / VLAN-VNI tab content
// ---------------------------------------------------------------------------

interface IfaceDef {
  id: string;
  name: string;
  ip?: string;
  neighborId: EvpnIrbDeviceId;
  neighborLabel: string;
  linkType: string;
  mtu: number;
  protocols: string[];
  extra?: { label: string; value: string }[];
}

const INTERFACES: Record<"LEAF1" | "SPINE1" | "LEAF2" | "LEAF3", IfaceDef[]> = {
  LEAF1: [
    { id: "LEAF1-hosta", name: "ge-0/0/0", neighborId: "HOST-A", neighborLabel: "HOST-A", linkType: "Access (VLAN 10)", mtu: 1500, protocols: ["Ethernet"], extra: [{ label: "IRB / Anycast GW", value: `${GATEWAY_IP[10]} / ${GATEWAY_MAC}` }, { label: "VNI Mapping", value: `VLAN 10 → L2 VNI ${L2_VNI_10}` }] },
    { id: "LEAF1-spine1", name: "et-0/1/0", ip: "10.0.11.1/31", neighborId: "SPINE1", neighborLabel: "SPINE1", linkType: "Underlay (Uplink)", mtu: 9216, protocols: ["IGP", "BGP EVPN"], extra: [{ label: "VTEP Source", value: `${VTEP_LOOPBACK.LEAF1} (Loopback0)` }, { label: "Router MAC", value: ROUTER_MAC.LEAF1 }] },
  ],
  SPINE1: [
    { id: "SPINE1-leaf1", name: "et-0/0/0", ip: "10.0.11.0/31", neighborId: "LEAF1", neighborLabel: "LEAF1", linkType: "Underlay", mtu: 9216, protocols: ["IGP"] },
    { id: "SPINE1-leaf2", name: "et-0/0/1", ip: "10.0.12.0/31", neighborId: "LEAF2", neighborLabel: "LEAF2", linkType: "Underlay", mtu: 9216, protocols: ["IGP"] },
    { id: "SPINE1-leaf3", name: "et-0/0/2", ip: "10.0.13.0/31", neighborId: "LEAF3", neighborLabel: "LEAF3", linkType: "Underlay", mtu: 9216, protocols: ["IGP"] },
  ],
  LEAF2: [
    { id: "LEAF2-hostc", name: "ge-0/0/0", neighborId: "HOST-C", neighborLabel: "HOST-C", linkType: "Access (VLAN 10)", mtu: 1500, protocols: ["Ethernet"], extra: [{ label: "IRB / Anycast GW", value: `${GATEWAY_IP[10]} / ${GATEWAY_MAC}` }, { label: "VNI Mapping", value: `VLAN 10 → L2 VNI ${L2_VNI_10}` }] },
    { id: "LEAF2-spine1", name: "et-0/1/0", ip: "10.0.12.1/31", neighborId: "SPINE1", neighborLabel: "SPINE1", linkType: "Underlay (Uplink)", mtu: 9216, protocols: ["IGP", "BGP EVPN"], extra: [{ label: "VTEP Source", value: `${VTEP_LOOPBACK.LEAF2} (Loopback0)` }, { label: "Router MAC", value: ROUTER_MAC.LEAF2 }] },
  ],
  LEAF3: [
    { id: "LEAF3-spine1", name: "et-0/1/0", ip: "10.0.13.1/31", neighborId: "SPINE1", neighborLabel: "SPINE1", linkType: "Underlay (Uplink)", mtu: 9216, protocols: ["IGP", "BGP EVPN"], extra: [{ label: "VTEP Source", value: `${VTEP_LOOPBACK.LEAF3} (Loopback0)` }, { label: "Router MAC", value: ROUTER_MAC.LEAF3 }] },
    { id: "LEAF3-hostb", name: "ge-0/0/0", neighborId: "HOST-B", neighborLabel: "HOST-B", linkType: "Access (VLAN 20)", mtu: 1500, protocols: ["Ethernet"], extra: [{ label: "IRB / Anycast GW", value: `${GATEWAY_IP[20]} / ${GATEWAY_MAC}` }, { label: "VNI Mapping", value: `VLAN 20 → L2 VNI ${L2_VNI_20}` }] },
  ],
};

export function interfacesFor(device: "LEAF1" | "SPINE1" | "LEAF2" | "LEAF3", state: EvpnIrbState, currentStepId: string): DeviceInterfaceData[] {
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

export function anycastGatewayInfoFor(leaf: LeafId) {
  const vlan = VLAN_FOR_LEAF[leaf];
  return ANYCAST_GATEWAYS[vlan];
}

export function vlanVniRowsFor(leaf: LeafId) {
  const vlan = VLAN_FOR_LEAF[leaf];
  const l2vni = vlan === 10 ? L2_VNI_10 : L2_VNI_20;
  return [
    { label: "VLAN", value: String(vlan) },
    { label: "L2 VNI", value: String(l2vni) },
    { label: "Local Host", value: HOST_FOR_LEAF[leaf] },
  ];
}

export function vrfRoutesRowsFor(state: EvpnIrbState, leaf: LeafId) {
  const l3vni = state.l3VniByLeaf[leaf];
  const remote = state.remoteHostRoutes[leaf === "LEAF3" ? "LEAF1" : leaf]; // LEAF3 is the origin, not an importer, of HOST-B's route
  const rows = [{ label: "VRF", value: VRF }, { label: "L3 VNI", value: String(l3vni) }];
  if (leaf !== "LEAF3" && remote?.[0]) rows.push({ label: `Remote host route (${remote[0].route.ip})`, value: `via ${remote[0].route.originLeaf}${remote[0].imported ? "" : " — NOT imported"}` });
  return rows;
}

// ---------------------------------------------------------------------------
// Link detail
// ---------------------------------------------------------------------------

const ALL_INTERFACES: Record<EvpnIrbDeviceId, IfaceDef[]> = {
  "HOST-A": [{ id: "HOSTA-leaf1", name: "eth0", ip: "10.10.10.11/24", neighborId: "LEAF1", neighborLabel: "LEAF1", linkType: "Access", mtu: 1500, protocols: ["Ethernet"] }],
  LEAF1: INTERFACES.LEAF1,
  SPINE1: INTERFACES.SPINE1,
  LEAF2: INTERFACES.LEAF2,
  LEAF3: INTERFACES.LEAF3,
  "HOST-C": [{ id: "HOSTC-leaf2", name: "eth0", ip: "10.10.10.33/24", neighborId: "LEAF2", neighborLabel: "LEAF2", linkType: "Access", mtu: 1500, protocols: ["Ethernet"] }],
  "HOST-B": [{ id: "HOSTB-leaf3", name: "eth0", ip: "10.20.20.22/24", neighborId: "LEAF3", neighborLabel: "LEAF3", linkType: "Access", mtu: 1500, protocols: ["Ethernet"] }],
};

export function linkDetailFor(linkId: string, state: EvpnIrbState): LinkDetail | undefined {
  const edge = GRAPH_EDGES.find((e) => e.id === linkId);
  if (!edge) return undefined;
  const a = edge.a as EvpnIrbDeviceId;
  const b = edge.b as EvpnIrbDeviceId;
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
    protocols: isUnderlay ? [{ label: "IGP", value: "Converged" }, { label: "BGP EVPN", value: state.bgpSessionUp ? "Established" : "Not yet formed" }] : [{ label: "VLAN", value: String(a === "HOST-B" || b === "HOST-B" ? 20 : 10) }],
  };
}

// ---------------------------------------------------------------------------
// Read-only CLI panel (brief §35) — concept-first Cisco/Juniper perspectives.
// ---------------------------------------------------------------------------

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

export function buildIrbCliCommands(state: EvpnIrbState, leaf: LeafId): CliCommandEntry[] {
  const vlan = VLAN_FOR_LEAF[leaf];
  const gw = ANYCAST_GATEWAYS[vlan];
  const l3vni = state.l3VniByLeaf[leaf];

  const vlanCisco: CliOutput = { cmd: "show vlan vn-segment", output: `VLAN: ${vlan}    VNI: ${vlan === 10 ? L2_VNI_10 : L2_VNI_20}    State: Active` };
  const vlanJuniper: CliOutput = { cmd: "show bridge-domain", output: `Bridge-domain: vlan-${vlan}    VXLAN VNI: ${vlan === 10 ? L2_VNI_10 : L2_VNI_20}` };

  const irbCisco: CliOutput = { cmd: "show interface vlan " + vlan, output: `Vlan${vlan}, Anycast GW: ${gw.gatewayIp}/24 (${gw.gatewayMac})    VRF: ${VRF}` };
  const irbJuniper: CliOutput = { cmd: `show interfaces irb.${vlan}`, output: `irb.${vlan}: ${gw.gatewayIp}/24, virtual-gateway-address ${gw.gatewayIp}, mac ${gw.gatewayMac}    routing-instance: ${VRF}` };

  const vrfCisco: CliOutput = { cmd: `show vrf ${VRF}`, output: `VRF: ${VRF}    L3VNI: ${l3vni}    RD: ${VTEP_LOOPBACK[leaf]}:${l3vni}` };
  const vrfJuniper: CliOutput = { cmd: `show route instance ${VRF}`, output: `${VRF}.inet.0    vrf-target target:65000:${l3vni}    vtep-source-interface lo0.0` };

  const macCisco: CliOutput = { cmd: "show l2route evpn mac-ip all", output: leaf === "LEAF3" ? "(this leaf originates HOST-B's own route)" : `MAC: ${state.remoteHostRoutes[leaf]?.[0]?.route.mac ?? "—"}    IP: ${state.remoteHostRoutes[leaf]?.[0]?.route.ip ?? "—"}    Next-hop: ${state.remoteHostRoutes[leaf]?.[0]?.route.originLeaf ?? "—"}` };
  const macJuniper: CliOutput = { cmd: "show evpn database", output: leaf === "LEAF3" ? "(this leaf originates HOST-B's own route)" : `MAC/IP: ${state.remoteHostRoutes[leaf]?.[0]?.route.mac ?? "—"} / ${state.remoteHostRoutes[leaf]?.[0]?.route.ip ?? "—"}    Remote VTEP: ${state.remoteHostRoutes[leaf]?.[0] ? VTEP_LOOPBACK[state.remoteHostRoutes[leaf]![0].route.originLeaf] : "—"}` };

  const vtepCisco: CliOutput = { cmd: "show nve peers", output: `NVE1, Peer VTEPs healthy, Local VTEP: ${VTEP_LOOPBACK[leaf]}` };
  const vtepJuniper: CliOutput = { cmd: "show interfaces vtep", output: `vtep.32768    Local VTEP: ${VTEP_LOOPBACK[leaf]}    State: Up` };

  return [
    { id: "vlan", label: "vlan / vni", cisco: vlanCisco, juniper: vlanJuniper },
    { id: "irb", label: "irb / anycast gw", cisco: irbCisco, juniper: irbJuniper },
    { id: "vrf", label: "vrf / l3vni", cisco: vrfCisco, juniper: vrfJuniper },
    { id: "mac", label: "mac / evpn", cisco: macCisco, juniper: macJuniper },
    { id: "vtep", label: "vtep state", cisco: vtepCisco, juniper: vtepJuniper },
  ];
}

export function buildSpineCliCommands(): CliCommandEntry[] {
  return [
    { id: "underlay", label: "underlay routes", cisco: { cmd: "show ip route ospf", output: "10.255.0.1/32 [110/20] via LEAF1\n10.255.0.2/32 [110/20] via LEAF2\n10.255.0.3/32 [110/20] via LEAF3" }, juniper: { cmd: "show route protocol ospf", output: "10.255.0.1/32 *[OSPF/10] via LEAF1\n10.255.0.2/32 *[OSPF/10] via LEAF2\n10.255.0.3/32 *[OSPF/10] via LEAF3" } },
    { id: "interfaces", label: "interfaces", cisco: { cmd: "show ip interface brief", output: "3 underlay-facing interfaces, all up — no VRF, no VNI, no tenant state at all" }, juniper: { cmd: "show interfaces terse", output: "3 underlay-facing interfaces, all up — no VRF, no VNI, no tenant state at all" } },
  ];
}
