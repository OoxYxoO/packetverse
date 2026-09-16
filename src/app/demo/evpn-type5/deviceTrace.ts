import type { DeviceInterfaceData, DeviceProcessingTrace, LinkDetail, PacketStackFrame, ProcessingStage } from "@/components/network3d/types";
import type { EvpnRibRow } from "@/components/protocol/EvpnRouteTable";
import {
  ANYCAST_GATEWAYS,
  EXAMPLE_TYPE2_ROUTE,
  GATEWAY_MAC,
  GRAPH_EDGES,
  L3_VNI,
  ROUTER_MAC,
  TENANT_PREFIX,
  VRF,
  VTEP_LOOPBACK,
  evpnType5Steps,
  type EvpnType5DeviceId,
  type EvpnType5State,
  type LeafIdT5,
} from "@/lib/sim-engine/scenarios/evpnType5";

const stepIndex = (id: string) => evpnType5Steps.findIndex((s) => s.id === id);

// ---------------------------------------------------------------------------
// Two distinct LEAF1 pipelines (brief §7 import vs. §11 forwarding), a
// simple SPINE1 underlay pipeline, and LEAF3's decap/egress pipeline.
// ---------------------------------------------------------------------------

const LEAF1_IMPORT_STAGES: ProcessingStage[] = [
  { id: "bgp-update", label: "BGP EVPN UPDATE" },
  { id: "route-type-5", label: "Route Type = 5" },
  { id: "rd-prefix", label: "RD / Prefix" },
  { id: "rt-eval", label: "Route Target Evaluation" },
  { id: "tenant-import", label: "TENANT-A Import" },
  { id: "nexthop-resolve", label: "Next-Hop / VTEP Resolution" },
  { id: "vrf-install", label: "VRF Route Installation" },
];
const LEAF1_FORWARD_STAGES: ProcessingStage[] = [
  { id: "access-ingress", label: "Access Ingress" },
  { id: "anycast-gw", label: "Anycast Gateway" },
  { id: "vrf", label: `VRF ${VRF}` },
  { id: "destination", label: "Destination: 172.16.50.10" },
  { id: "lpm", label: "Longest-Prefix Match" },
  { id: "type5-candidate", label: `Type-5-Learned ${TENANT_PREFIX}` },
  { id: "remote-vtep", label: "Remote VTEP = LEAF3" },
  { id: "l3vni", label: `L3 VNI ${L3_VNI}` },
  { id: "vxlan-encap", label: "VXLAN Encapsulation" },
];
const SPINE1_STAGES: ProcessingStage[] = [
  { id: "vxlan-arrives", label: "VXLAN Packet Arrives" },
  { id: "read-outer-ip", label: "Read Outer Destination VTEP IP" },
  { id: "route-toward", label: "Route Toward LEAF3 VTEP" },
  { id: "forward", label: "Forward" },
];
const LEAF3_STAGES: ProcessingStage[] = [
  { id: "underlay-ingress", label: "Underlay Ingress" },
  { id: "vxlan-decap", label: "VXLAN Decap" },
  { id: "l3vni", label: `L3 VNI ${L3_VNI}` },
  { id: "vrf", label: `VRF ${VRF}` },
  { id: "dst-prefix", label: `Destination Prefix ${TENANT_PREFIX}` },
  { id: "deliver", label: "Deliver" },
];
const LEAF2_IDLE_STAGES: ProcessingStage[] = [
  { id: "access-port", label: "Access Port" },
  { id: "vlan10", label: "VLAN 10" },
  { id: "l2-vni", label: "L2 VNI 10010" },
];

function allIds(stages: ProcessingStage[]) {
  return stages.map((s) => s.id);
}

export function traceFor(device: "LEAF1" | "SPINE1" | "LEAF2" | "LEAF3", state: EvpnType5State, currentStepId: string): DeviceProcessingTrace {
  const i = stepIndex(currentStepId);
  const verifyIndex = stepIndex("verify-dataplane");

  if (device === "LEAF1") {
    const importIndex = stepIndex("enter-leaf1-type5-import");
    const forwardIndex = stepIndex("enter-leaf1-forwarding");
    const lpmIndex = stepIndex("packet-transformation");
    if (i === importIndex) return { deviceId: "LEAF1", ingressInterfaceId: "LEAF1-spine1", stages: LEAF1_IMPORT_STAGES, activeStageId: "vrf-install", completedStageIds: ["bgp-update", "route-type-5", "rd-prefix", "rt-eval", "tenant-import", "nexthop-resolve"] };
    if (i === forwardIndex || i === lpmIndex || i === verifyIndex) {
      const base: DeviceProcessingTrace = { deviceId: "LEAF1", ingressInterfaceId: "LEAF1-hosta", egressInterfaceId: "LEAF1-spine1", stages: LEAF1_FORWARD_STAGES, completedStageIds: [] };
      if (i === forwardIndex) return { ...base, activeStageId: "type5-candidate", completedStageIds: ["access-ingress", "anycast-gw", "vrf", "destination", "lpm"] };
      return { ...base, activeStageId: "vxlan-encap", completedStageIds: allIds(LEAF1_FORWARD_STAGES).filter((id) => id !== "vxlan-encap") };
    }
    return { deviceId: "LEAF1", stages: LEAF1_FORWARD_STAGES, completedStageIds: i > forwardIndex ? allIds(LEAF1_FORWARD_STAGES) : [] };
  }

  if (device === "SPINE1") {
    const base: DeviceProcessingTrace = { deviceId: "SPINE1", ingressInterfaceId: "SPINE1-leaf1", egressInterfaceId: "SPINE1-leaf3", stages: SPINE1_STAGES, completedStageIds: [] };
    const spineIndex = stepIndex("spine-forward-type5");
    if (i !== spineIndex && i !== verifyIndex) return base;
    return { ...base, activeStageId: "read-outer-ip", completedStageIds: ["vxlan-arrives"], packetBefore: `Outer dst IP ${VTEP_LOOPBACK.LEAF3}`, packetAfter: `Forwarded toward ${VTEP_LOOPBACK.LEAF3}` };
  }

  if (device === "LEAF3") {
    const base: DeviceProcessingTrace = { deviceId: "LEAF3", ingressInterfaceId: "LEAF3-spine1", egressInterfaceId: "LEAF3-border", stages: LEAF3_STAGES, completedStageIds: [] };
    const egressIndex = stepIndex("leaf3-egress-type5");
    if (i !== egressIndex && i !== verifyIndex) return { ...base, completedStageIds: i > egressIndex ? allIds(LEAF3_STAGES) : [] };
    return { ...base, activeStageId: "dst-prefix", completedStageIds: ["underlay-ingress", "vxlan-decap", "l3vni", "vrf"], packetBefore: `VXLAN(L3 VNI ${L3_VNI})`, packetAfter: `Delivered toward ${TENANT_PREFIX}` };
  }

  return { deviceId: "LEAF2", ingressInterfaceId: "LEAF2-hostc", stages: LEAF2_IDLE_STAGES, completedStageIds: [] };
}

// ---------------------------------------------------------------------------
// Packet visual stack (3D floating frame stack)
// ---------------------------------------------------------------------------

export function packetFramesFor(state: EvpnType5State): PacketStackFrame[] | undefined {
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
// Physical interfaces
// ---------------------------------------------------------------------------

interface IfaceDef {
  id: string;
  name: string;
  ip?: string;
  neighborId: EvpnType5DeviceId;
  neighborLabel: string;
  linkType: string;
  mtu: number;
  protocols: string[];
  extra?: { label: string; value: string }[];
}

const INTERFACES: Record<"LEAF1" | "SPINE1" | "LEAF2" | "LEAF3", IfaceDef[]> = {
  LEAF1: [
    { id: "LEAF1-hosta", name: "ge-0/0/0", neighborId: "HOST-A", neighborLabel: "HOST-A", linkType: "Access (VLAN 10)", mtu: 1500, protocols: ["Ethernet"], extra: [{ label: "IRB / Anycast GW", value: `${ANYCAST_GATEWAYS[10].gatewayIp} / ${GATEWAY_MAC}` }] },
    { id: "LEAF1-spine1", name: "et-0/1/0", ip: "10.0.11.1/31", neighborId: "SPINE1", neighborLabel: "SPINE1", linkType: "Underlay (Uplink)", mtu: 9216, protocols: ["IGP", "BGP EVPN"], extra: [{ label: "VTEP Source", value: `${VTEP_LOOPBACK.LEAF1} (Loopback0)` }, { label: "Router MAC", value: ROUTER_MAC.LEAF1 }] },
  ],
  SPINE1: [
    { id: "SPINE1-leaf1", name: "et-0/0/0", ip: "10.0.11.0/31", neighborId: "LEAF1", neighborLabel: "LEAF1", linkType: "Underlay", mtu: 9216, protocols: ["IGP"] },
    { id: "SPINE1-leaf2", name: "et-0/0/1", ip: "10.0.12.0/31", neighborId: "LEAF2", neighborLabel: "LEAF2", linkType: "Underlay", mtu: 9216, protocols: ["IGP"] },
    { id: "SPINE1-leaf3", name: "et-0/0/2", ip: "10.0.13.0/31", neighborId: "LEAF3", neighborLabel: "LEAF3", linkType: "Underlay", mtu: 9216, protocols: ["IGP"] },
  ],
  LEAF2: [
    { id: "LEAF2-hostc", name: "ge-0/0/0", neighborId: "HOST-C", neighborLabel: "HOST-C", linkType: "Access (VLAN 10)", mtu: 1500, protocols: ["Ethernet"] },
    { id: "LEAF2-spine1", name: "et-0/1/0", ip: "10.0.12.1/31", neighborId: "SPINE1", neighborLabel: "SPINE1", linkType: "Underlay (Uplink)", mtu: 9216, protocols: ["IGP", "BGP EVPN"], extra: [{ label: "VTEP Source", value: `${VTEP_LOOPBACK.LEAF2} (Loopback0)` }] },
  ],
  LEAF3: [
    { id: "LEAF3-spine1", name: "et-0/1/0", ip: "10.0.13.1/31", neighborId: "SPINE1", neighborLabel: "SPINE1", linkType: "Underlay (Uplink)", mtu: 9216, protocols: ["IGP", "BGP EVPN"], extra: [{ label: "VTEP Source", value: `${VTEP_LOOPBACK.LEAF3} (Loopback0)` }, { label: "Router MAC", value: ROUTER_MAC.LEAF3 }] },
    { id: "LEAF3-hostb", name: "ge-0/0/0", neighborId: "HOST-B", neighborLabel: "HOST-B", linkType: "Access (VLAN 20)", mtu: 1500, protocols: ["Ethernet"] },
    { id: "LEAF3-border", name: "ge-0/0/1", neighborId: "BORDER-SVR", neighborLabel: "BORDER-SVR", linkType: "Connected/Static", mtu: 1500, protocols: ["Static"], extra: [{ label: "Tenant Prefix", value: TENANT_PREFIX }] },
  ],
};

export function interfacesFor(device: "LEAF1" | "SPINE1" | "LEAF2" | "LEAF3", state: EvpnType5State, currentStepId: string): DeviceInterfaceData[] {
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
// EVPN RIB rows (Type 2 example + Type 3 membership hint + Type 5 routes)
// ---------------------------------------------------------------------------

export function evpnRibRowsFor(state: EvpnType5State, leaf: LeafIdT5): EvpnRibRow[] {
  const rows: EvpnRibRow[] = [];
  if (leaf !== "LEAF3") {
    rows.push({ routeType: "2", summary: `${EXAMPLE_TYPE2_ROUTE.mac} / ${EXAMPLE_TYPE2_ROUTE.ip}`, nextHop: VTEP_LOOPBACK.LEAF3, rd: EXAMPLE_TYPE2_ROUTE.rd, rt: EXAMPLE_TYPE2_ROUTE.rt });
  }
  rows.push({ routeType: "3", summary: `VNI 10010 membership`, nextHop: "(all participating leafs)" });
  const t5 = state.received[leaf]?.[0];
  if (t5) rows.push({ routeType: "5", summary: t5.route.prefix, nextHop: t5.route.nextHop, rd: t5.route.rd, rt: t5.route.rt, extra: [{ label: "Usable", value: t5.imported && t5.vtepResolved ? "Yes" : t5.imported ? "No — VTEP unresolved" : "No — not imported" }] });
  if (leaf === "LEAF1" && state.type5RouteWide) {
    const received = state.received.LEAF1?.find((r) => r.route.prefix === state.type5RouteWide!.prefix);
    rows.push({ routeType: "5", summary: state.type5RouteWide.prefix, nextHop: state.type5RouteWide.nextHop, rd: state.type5RouteWide.rd, rt: state.type5RouteWide.rt, extra: [{ label: "Usable", value: received ? "Yes" : "Pending" }, { label: "LPM", value: "Less specific than /24 — not used for 172.16.50.10" }] });
  }
  return rows;
}

export function vrfRoutesRowsFor(state: EvpnType5State, leaf: LeafIdT5) {
  const t5 = state.received[leaf]?.[0];
  const rows = [{ label: "VRF", value: VRF }, { label: "L3 VNI", value: String(L3_VNI) }];
  if (t5) rows.push({ label: t5.route.prefix, value: `via ${t5.route.originLeaf}${t5.imported ? (t5.vtepResolved ? " (usable)" : " (installed, VTEP unresolved)") : " (not imported)"}` });
  else if (leaf !== "LEAF3") rows.push({ label: TENANT_PREFIX, value: "no route yet" });
  else rows.push({ label: TENANT_PREFIX, value: "connected/static (local)" });
  return rows;
}

// ---------------------------------------------------------------------------
// Link detail
// ---------------------------------------------------------------------------

const ALL_INTERFACES: Record<EvpnType5DeviceId, IfaceDef[]> = {
  "HOST-A": [{ id: "HOSTA-leaf1", name: "eth0", ip: "10.10.10.11/24", neighborId: "LEAF1", neighborLabel: "LEAF1", linkType: "Access", mtu: 1500, protocols: ["Ethernet"] }],
  LEAF1: INTERFACES.LEAF1,
  SPINE1: INTERFACES.SPINE1,
  LEAF2: INTERFACES.LEAF2,
  LEAF3: INTERFACES.LEAF3,
  "HOST-C": [{ id: "HOSTC-leaf2", name: "eth0", ip: "10.10.10.33/24", neighborId: "LEAF2", neighborLabel: "LEAF2", linkType: "Access", mtu: 1500, protocols: ["Ethernet"] }],
  "HOST-B": [{ id: "HOSTB-leaf3", name: "eth0", ip: "10.20.20.22/24", neighborId: "LEAF3", neighborLabel: "LEAF3", linkType: "Access", mtu: 1500, protocols: ["Ethernet"] }],
  "BORDER-SVR": [{ id: "BORDER-leaf3", name: "eth0", ip: "172.16.50.1/24", neighborId: "LEAF3", neighborLabel: "LEAF3", linkType: "Connected/Static", mtu: 1500, protocols: ["Static"] }],
};

export function linkDetailFor(linkId: string, state: EvpnType5State): LinkDetail | undefined {
  const edge = GRAPH_EDGES.find((e) => e.id === linkId);
  if (!edge) return undefined;
  const a = edge.a as EvpnType5DeviceId;
  const b = edge.b as EvpnType5DeviceId;
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
    protocols: isUnderlay ? [{ label: "IGP", value: "Converged" }, { label: "BGP EVPN", value: state.bgpSessionUp ? "Established" : "Not yet formed" }] : [{ label: "Segment", value: a === "BORDER-SVR" || b === "BORDER-SVR" ? TENANT_PREFIX : "VLAN" }],
  };
}

// ---------------------------------------------------------------------------
// Read-only CLI panel — concept-first Cisco/Juniper perspectives.
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

export function buildType5CliCommands(state: EvpnType5State, leaf: LeafIdT5): CliCommandEntry[] {
  const t5 = state.received[leaf]?.[0];
  const vrfCisco: CliOutput = { cmd: `show vrf ${VRF}`, output: `VRF: ${VRF}    L3VNI: ${L3_VNI}` };
  const vrfJuniper: CliOutput = { cmd: `show route instance ${VRF}`, output: `${VRF}.inet.0` };
  const type5Cisco: CliOutput = { cmd: "show bgp l2vpn evpn route-type 5", output: t5 ? `RD ${t5.route.rd}    Prefix ${t5.route.prefix}    Next-hop ${t5.route.nextHop}    ${t5.vtepResolved ? "resolved" : "next-hop UNRESOLVED"}` : "(no Type 5 routes yet)" };
  const type5Juniper: CliOutput = { cmd: "show route table bgp.evpn.0 match-prefix 5:*", output: t5 ? `5:${t5.route.rd}:0:32:${t5.route.prefix}    ${t5.vtepResolved ? "Active" : "Inactive — next-hop unresolved"}` : "(no Type 5 routes yet)" };
  const vtepCisco: CliOutput = { cmd: "show nve peers", output: `Peer VTEP ${VTEP_LOOPBACK.LEAF3}: ${state.vtepReachable.LEAF3 ? "Up" : "Down — underlay unreachable"}` };
  const vtepJuniper: CliOutput = { cmd: "show interfaces vtep", output: `Remote VTEP ${VTEP_LOOPBACK.LEAF3}: ${state.vtepReachable.LEAF3 ? "reachable" : "unreachable via underlay"}` };
  return [
    { id: "vrf", label: "vrf / l3vni", cisco: vrfCisco, juniper: vrfJuniper },
    { id: "type5", label: "type 5 routes", cisco: type5Cisco, juniper: type5Juniper },
    { id: "vtep", label: "vtep state", cisco: vtepCisco, juniper: vtepJuniper },
  ];
}

export function buildSpineCliCommands(): CliCommandEntry[] {
  return [
    { id: "underlay", label: "underlay routes", cisco: { cmd: "show ip route ospf", output: "10.255.0.1/32, 10.255.0.2/32, 10.255.0.3/32 — all via OSPF" }, juniper: { cmd: "show route protocol ospf", output: "10.255.0.1/32, 10.255.0.2/32, 10.255.0.3/32 — all *[OSPF/10]" } },
    { id: "interfaces", label: "interfaces", cisco: { cmd: "show ip interface brief", output: "3 underlay-facing interfaces — no VRF, no VNI, no tenant state at all" }, juniper: { cmd: "show interfaces terse", output: "3 underlay-facing interfaces — no VRF, no VNI, no tenant state at all" } },
  ];
}
