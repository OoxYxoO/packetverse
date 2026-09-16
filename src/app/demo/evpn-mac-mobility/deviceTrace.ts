import type { DeviceInterfaceData, DeviceProcessingTrace, LinkDetail, PacketStackFrame, ProcessingStage } from "@/components/network3d/types";
import type { EvpnRibRow } from "@/components/protocol/EvpnRouteTable";
import {
  GRAPH_EDGES,
  HOST_A_IP,
  HOST_A_MAC,
  VLAN,
  VNI,
  VTEP_LOOPBACK,
  evpnMobilitySteps,
  type EvpnMobilityDeviceId,
  type EvpnMobilityState,
  type LeafId,
} from "@/lib/sim-engine/scenarios/evpnMacMobility";

const stepIndex = (id: string) => evpnMobilitySteps.findIndex((s) => s.id === id);

const LEAF_LOCAL_LEARN_STAGES: ProcessingStage[] = [
  { id: "access-event", label: "Access Port Event" },
  { id: "vlan10", label: `VLAN ${VLAN}` },
  { id: "src-mac", label: "Source MAC Learned" },
  { id: "src-ip", label: "Source IP Association" },
  { id: "existing-remote", label: "Existing Remote EVPN Entry Detected" },
  { id: "now-local", label: "Endpoint Now Local" },
  { id: "gen-route", label: "Generate Updated Type-2 Route" },
];
const LEAF_MOBILITY_UPDATE_STAGES: ProcessingStage[] = [
  { id: "bgp-update", label: "BGP EVPN UPDATE" },
  { id: "route-type-2", label: "Route Type 2" },
  { id: "mac-ip-identity", label: "MAC/IP Identity" },
  { id: "existing-route", label: "Existing Route Found" },
  { id: "compare-seq", label: "Compare Mobility Sequence" },
  { id: "newer-selected", label: "Newer Advertisement Selected" },
  { id: "vtep-changed", label: "Remote VTEP Changed" },
  { id: "state-updated", label: "MAC / EVPN State Updated" },
];
const SPINE1_STAGES: ProcessingStage[] = [
  { id: "underlay-ingress", label: "Underlay Ingress" },
  { id: "outer-ip-lookup", label: "Outer IP Lookup" },
  { id: "forward", label: "Forward" },
];
const IDLE_BRIDGE_STAGES: ProcessingStage[] = [
  { id: "access-port", label: "Access Port" },
  { id: "vlan10", label: `VLAN ${VLAN}` },
  { id: "l2-vni", label: `L2 VNI ${VNI}` },
];

function allIds(stages: ProcessingStage[]) {
  return stages.map((s) => s.id);
}

export function traceFor(device: "LEAF1" | "SPINE1" | "LEAF2" | "LEAF3", state: EvpnMobilityState, currentStepId: string): DeviceProcessingTrace {
  const i = stepIndex(currentStepId);

  if (device === "SPINE1") {
    const base: DeviceProcessingTrace = { deviceId: "SPINE1", stages: SPINE1_STAGES, completedStageIds: [] };
    const spineSteps = ["before-move-journey", "after-move-journey", "verify-dataplane"];
    if (!spineSteps.includes(currentStepId)) return base;
    return { ...base, activeStageId: "outer-ip-lookup", completedStageIds: ["underlay-ingress"] };
  }

  const localLearnIndex = stepIndex("enter-leaf2-local-learn");
  const mobilityUpdateIndex = stepIndex("enter-leaf3-mobility-update");

  if (device === "LEAF2" && i === localLearnIndex) {
    return { deviceId: "LEAF2", ingressInterfaceId: "LEAF2-hosta", stages: LEAF_LOCAL_LEARN_STAGES, activeStageId: "gen-route", completedStageIds: ["access-event", "vlan10", "src-mac", "src-ip", "existing-remote", "now-local"] };
  }
  if (device === "LEAF3" && i === mobilityUpdateIndex) {
    return { deviceId: "LEAF3", ingressInterfaceId: "LEAF3-spine1", stages: LEAF_MOBILITY_UPDATE_STAGES, activeStageId: "state-updated", completedStageIds: ["bgp-update", "route-type-2", "mac-ip-identity", "existing-route", "compare-seq", "newer-selected", "vtep-changed"] };
  }

  // Idle / bridging view for any leaf outside its own signature moment.
  const journeyHop = state.journey.find((h) => h.device === device);
  const base: DeviceProcessingTrace = { deviceId: device, stages: IDLE_BRIDGE_STAGES, completedStageIds: journeyHop ? allIds(IDLE_BRIDGE_STAGES) : [] };
  if (journeyHop && state.journey[state.journey.length - 1]?.device === device) return { ...base, activeStageId: "l2-vni" };
  return base;
}

export function packetFramesFor(state: EvpnMobilityState): PacketStackFrame[] | undefined {
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

interface IfaceDef {
  id: string;
  name: string;
  ip?: string;
  neighborId: EvpnMobilityDeviceId;
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
  LEAF2: [
    { id: "LEAF2-hosta", name: "ge-0/0/0", neighborId: "HOST-A", neighborLabel: "HOST-A", linkType: `Access (VLAN ${VLAN})`, mtu: 1500, protocols: ["Ethernet"] },
    { id: "LEAF2-spine1", name: "et-0/1/0", ip: "10.0.12.1/31", neighborId: "SPINE1", neighborLabel: "SPINE1", linkType: "Underlay (Uplink)", mtu: 9216, protocols: ["IGP", "BGP EVPN"], extra: [{ label: "VTEP Source", value: `${VTEP_LOOPBACK.LEAF2} (Loopback0)` }] },
  ],
  LEAF3: [
    { id: "LEAF3-spine1", name: "et-0/1/0", ip: "10.0.13.1/31", neighborId: "SPINE1", neighborLabel: "SPINE1", linkType: "Underlay (Uplink)", mtu: 9216, protocols: ["IGP", "BGP EVPN"], extra: [{ label: "VTEP Source", value: `${VTEP_LOOPBACK.LEAF3} (Loopback0)` }] },
    { id: "LEAF3-hostb", name: "ge-0/0/0", neighborId: "HOST-B", neighborLabel: "HOST-B", linkType: `Access (VLAN ${VLAN})`, mtu: 1500, protocols: ["Ethernet"] },
  ],
};

export function interfacesFor(device: "LEAF1" | "SPINE1" | "LEAF2" | "LEAF3", state: EvpnMobilityState, currentStepId: string): DeviceInterfaceData[] {
  const trace = traceFor(device, state, currentStepId);
  const processing = trace.activeStageId !== undefined;
  return INTERFACES[device]
    .filter((def) => !(def.neighborId === "HOST-A" && ((device === "LEAF1" && state.hostALocation !== "LEAF1") || (device === "LEAF2" && state.hostALocation !== "LEAF2"))))
    .map((def) => ({
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

export function evpnRibRowsFor(state: EvpnMobilityState, leaf: LeafId): EvpnRibRow[] {
  const rows: EvpnRibRow[] = [];
  const selected = leaf === state.hostALocation ? state.hostARoutes[state.hostARoutes.length - 1] : state.selectedRouteByLeaf[leaf];
  if (selected) {
    rows.push({
      routeType: "2",
      summary: `${selected.mac} / ${selected.ip}`,
      nextHop: selected.nextHop,
      rd: selected.rd,
      rt: selected.rt,
      extra: leaf === state.hostALocation ? [{ label: "Source", value: "Local" }] : [{ label: "Mobility", value: `Seq ${selected.mobilitySeq}` }],
    });
  }
  const hostBEntry = state.macTables[leaf]?.find((e) => e.ip !== HOST_A_IP);
  if (hostBEntry) rows.push({ routeType: "2", summary: `${hostBEntry.mac} / ${hostBEntry.ip}`, nextHop: hostBEntry.source === "local" ? "(local)" : hostBEntry.remoteVtep ?? "—" });
  return rows;
}

export function mobilityTabRowsFor(state: EvpnMobilityState, leaf: LeafId) {
  const isLocal = leaf === state.hostALocation;
  const selected = isLocal ? state.hostARoutes[state.hostARoutes.length - 1] : state.selectedRouteByLeaf[leaf];
  const previous = state.hostARoutes.length > 1 ? state.hostARoutes[state.hostARoutes.length - 2] : undefined;
  return [
    { label: "MAC", value: HOST_A_MAC },
    { label: "IP", value: HOST_A_IP },
    { label: "Current Location", value: isLocal ? `${leaf} (local)` : (selected?.originLeaf ?? "unknown") },
    { label: "Previous Location", value: previous ? previous.originLeaf : "—" },
    { label: "Mobility Sequence", value: selected ? String(selected.mobilitySeq) : "—" },
    { label: "Last Change", value: state.moveCount > 0 ? `Move #${state.moveCount}` : "none yet" },
    { label: "Selected EVPN Route", value: selected ? `seq ${selected.mobilitySeq} via ${selected.originLeaf}` : "none" },
  ];
}

export function linkDetailFor(linkId: string, state: EvpnMobilityState): LinkDetail | undefined {
  const edge = GRAPH_EDGES.find((e) => e.id === linkId);
  if (!edge) return undefined;
  const a = edge.a as EvpnMobilityDeviceId;
  const b = edge.b as EvpnMobilityDeviceId;
  const allIfaces: Record<string, IfaceDef[]> = {
    "HOST-A": [{ id: "HOSTA-any", name: "eth0", ip: `${HOST_A_IP}/24`, neighborId: state.hostALocation, neighborLabel: state.hostALocation, linkType: "Access", mtu: 1500, protocols: ["Ethernet"] }],
    ...INTERFACES,
    "HOST-B": [{ id: "HOSTB-leaf3", name: "eth0", ip: "10.10.10.22/24", neighborId: "LEAF3", neighborLabel: "LEAF3", linkType: "Access", mtu: 1500, protocols: ["Ethernet"] }],
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

export function buildMobilityCliCommands(state: EvpnMobilityState, leaf: LeafId): CliCommandEntry[] {
  const isLocal = leaf === state.hostALocation;
  const selected = isLocal ? state.hostARoutes[state.hostARoutes.length - 1] : state.selectedRouteByLeaf[leaf];
  const macCisco: CliOutput = { cmd: "show mac address-table", output: isLocal ? `${HOST_A_MAC}    dynamic    Vlan${VLAN}    (local)` : `(no local entry — see l2route for remote reachability)` };
  const macJuniper: CliOutput = { cmd: "show bridge mac-table", output: isLocal ? `${HOST_A_MAC}    vlan.${VLAN}    Local` : `(no local entry)` };
  const evpnCisco: CliOutput = { cmd: "show l2route evpn mac-ip all", output: selected ? `MAC ${HOST_A_MAC}    Seq ${selected.mobilitySeq}    Next-hop ${selected.nextHop}` : "(no route yet)" };
  const evpnJuniper: CliOutput = { cmd: "show evpn database", output: selected ? `MAC/IP: ${HOST_A_MAC}    Seq num: ${selected.mobilitySeq}    Remote PE: ${selected.nextHop}` : "(no route yet)" };
  return [
    { id: "mac", label: "mac table", cisco: macCisco, juniper: macJuniper },
    { id: "evpn", label: "evpn / mobility", cisco: evpnCisco, juniper: evpnJuniper },
  ];
}

export function buildSpineCliCommands(): CliCommandEntry[] {
  return [{ id: "underlay", label: "underlay routes", cisco: { cmd: "show ip route ospf", output: "10.255.0.1/32, 10.255.0.2/32, 10.255.0.3/32 — all via OSPF" }, juniper: { cmd: "show route protocol ospf", output: "10.255.0.1/32, 10.255.0.2/32, 10.255.0.3/32 — all *[OSPF/10]" } }];
}
