import type { DeviceInterfaceData, DeviceProcessingTrace, LinkDetail, PacketStackFrame, ProcessingStage } from "@/components/network3d/types";
import type { EvpnRibRow } from "@/components/protocol/EvpnRouteTable";
import {
  ESI,
  ETHERNET_SEGMENT,
  GRAPH_EDGES,
  SERVER_A_IP,
  VLAN,
  VNI,
  VTEP_LOOPBACK,
  dfRoleFor,
  evpnMultihomingSteps,
  shouldForwardBumToEs,
  type EvpnMultihomingDeviceId,
  type EvpnMultihomingState,
  type LeafId,
} from "@/lib/sim-engine/scenarios/evpnMultihoming";

const stepIndex = (id: string) => evpnMultihomingSteps.findIndex((s) => s.id === id);

const CONTROL_PIPELINE_STAGES: ProcessingStage[] = [
  { id: "es-configured", label: "Ethernet Segment Configured" },
  { id: "esi-recognized", label: "ESI Recognized" },
  { id: "type4-advertised", label: "Type 4 Advertised" },
  { id: "es-peers", label: "ES Peers Discovered" },
  { id: "type1-state", label: "Type 1 State / Signaling" },
  { id: "df-candidates", label: "DF Candidates Determined" },
  { id: "df-election", label: "DF Election" },
  { id: "role-installed", label: "Forwarding Role Installed" },
];
const BUM_PIPELINE_STAGES: ProcessingStage[] = [
  { id: "vxlan-decap", label: "VXLAN Decap" },
  { id: "vni", label: `VNI ${VNI}` },
  { id: "dest-bum", label: "Destination = BUM" },
  { id: "dest-es", label: "Destination Ethernet Segment" },
  { id: "df-status", label: "DF Status" },
  { id: "forward-or-suppress", label: "Forward / Suppress" },
];
const SPINE1_STAGES: ProcessingStage[] = [
  { id: "underlay-ingress", label: "Underlay Ingress" },
  { id: "outer-ip-lookup", label: "Outer IP Lookup" },
  { id: "forward", label: "Forward" },
];
const LEAF3_STAGES: ProcessingStage[] = [
  { id: "access-port", label: "Access Port" },
  { id: "bum-classify", label: "BUM Classification" },
  { id: "flood-list", label: "VNI Flood List" },
  { id: "replicate", label: "VXLAN Replication" },
];

function allIds(stages: ProcessingStage[]) {
  return stages.map((s) => s.id);
}

export function traceFor(device: "LEAF1" | "SPINE1" | "LEAF2" | "LEAF3", state: EvpnMultihomingState, currentStepId: string): DeviceProcessingTrace {
  const i = stepIndex(currentStepId);

  if (device === "SPINE1") {
    const base: DeviceProcessingTrace = { deviceId: "SPINE1", stages: SPINE1_STAGES, completedStageIds: [] };
    if (state.replicaStage === "none") return base;
    return { ...base, activeStageId: "outer-ip-lookup", completedStageIds: ["underlay-ingress"] };
  }

  if (device === "LEAF3") {
    const base: DeviceProcessingTrace = { deviceId: "LEAF3", stages: LEAF3_STAGES, completedStageIds: [] };
    if (state.replicaStage === "none") return base;
    return { ...base, activeStageId: "replicate", completedStageIds: ["access-port", "bum-classify", "flood-list"] };
  }

  const leaf = device as "LEAF1" | "LEAF2";
  const controlEnd = stepIndex("df-status-visual");
  const bumStart = stepIndex("hostb-sends-bum");

  if (i <= controlEnd) {
    const t4Index = stepIndex(leaf === "LEAF1" ? "type4-advertise-leaf1" : "type4-advertise-leaf2");
    const dfIndex = stepIndex("df-election-chamber");
    const base: DeviceProcessingTrace = { deviceId: leaf, stages: CONTROL_PIPELINE_STAGES, completedStageIds: [] };
    if (i < stepIndex("ethernet-segment-intro")) return base;
    if (i < t4Index) return { ...base, activeStageId: "esi-recognized", completedStageIds: ["es-configured"] };
    if (i >= t4Index && i < stepIndex("type1-intro")) return { ...base, activeStageId: "type4-advertised", completedStageIds: ["es-configured", "esi-recognized"] };
    if (i >= stepIndex("type1-intro") && i < dfIndex) return { ...base, activeStageId: "type1-state", completedStageIds: ["es-configured", "esi-recognized", "type4-advertised", "es-peers"] };
    if (i >= dfIndex) return { ...base, activeStageId: "role-installed", completedStageIds: allIds(CONTROL_PIPELINE_STAGES).filter((id) => id !== "role-installed") };
    return base;
  }

  if (i >= bumStart) {
    const base: DeviceProcessingTrace = { deviceId: leaf, stages: BUM_PIPELINE_STAGES, completedStageIds: [] };
    if (state.replicaStage === "none") return { ...base, completedStageIds: state.journey.some((h) => h.device === leaf) ? allIds(BUM_PIPELINE_STAGES) : [] };
    const isDf = shouldForwardBumToEs(leaf, state.dfState);
    return { ...base, activeStageId: "forward-or-suppress", completedStageIds: ["vxlan-decap", "vni", "dest-bum", "dest-es", "df-status"], forwardingAction: isDf ? "FORWARD TO ES" : "SUPPRESS ES DELIVERY" };
  }

  return { deviceId: leaf, stages: CONTROL_PIPELINE_STAGES, completedStageIds: allIds(CONTROL_PIPELINE_STAGES) };
}

export function packetFramesFor(state: EvpnMultihomingState): PacketStackFrame[] | undefined {
  if (state.replicaStage === "none" && !state.unicastDemoShown) return undefined;
  return [
    { id: "ethernet", text: "Ethernet", tone: "generic" },
    { id: "ip", text: "IP", tone: "ip" },
  ];
}

interface IfaceDef { id: string; name: string; ip?: string; neighborId: EvpnMultihomingDeviceId; neighborLabel: string; linkType: string; mtu: number; protocols: string[]; extra?: { label: string; value: string }[]; }

const INTERFACES: Record<"LEAF1" | "SPINE1" | "LEAF2" | "LEAF3", IfaceDef[]> = {
  LEAF1: [
    { id: "LEAF1-servera", name: "ge-0/0/0", neighborId: "SERVER-A", neighborLabel: "SERVER-A", linkType: `Access (VLAN ${VLAN}, ESI)`, mtu: 1500, protocols: ["Ethernet"], extra: [{ label: "ESI", value: ESI }, { label: "Mode", value: "All-Active" }] },
    { id: "LEAF1-spine1", name: "et-0/1/0", ip: "10.0.11.1/31", neighborId: "SPINE1", neighborLabel: "SPINE1", linkType: "Underlay (Uplink)", mtu: 9216, protocols: ["IGP", "BGP EVPN"], extra: [{ label: "VTEP Source", value: `${VTEP_LOOPBACK.LEAF1} (Loopback0)` }] },
  ],
  SPINE1: [
    { id: "SPINE1-leaf1", name: "et-0/0/0", ip: "10.0.11.0/31", neighborId: "LEAF1", neighborLabel: "LEAF1", linkType: "Underlay", mtu: 9216, protocols: ["IGP"] },
    { id: "SPINE1-leaf2", name: "et-0/0/1", ip: "10.0.12.0/31", neighborId: "LEAF2", neighborLabel: "LEAF2", linkType: "Underlay", mtu: 9216, protocols: ["IGP"] },
    { id: "SPINE1-leaf3", name: "et-0/0/2", ip: "10.0.13.0/31", neighborId: "LEAF3", neighborLabel: "LEAF3", linkType: "Underlay", mtu: 9216, protocols: ["IGP"] },
  ],
  LEAF2: [
    { id: "LEAF2-servera", name: "ge-0/0/0", neighborId: "SERVER-A", neighborLabel: "SERVER-A", linkType: `Access (VLAN ${VLAN}, ESI)`, mtu: 1500, protocols: ["Ethernet"], extra: [{ label: "ESI", value: ESI }, { label: "Mode", value: "All-Active" }] },
    { id: "LEAF2-spine1", name: "et-0/1/0", ip: "10.0.12.1/31", neighborId: "SPINE1", neighborLabel: "SPINE1", linkType: "Underlay (Uplink)", mtu: 9216, protocols: ["IGP", "BGP EVPN"], extra: [{ label: "VTEP Source", value: `${VTEP_LOOPBACK.LEAF2} (Loopback0)` }] },
  ],
  LEAF3: [
    { id: "LEAF3-spine1", name: "et-0/1/0", ip: "10.0.13.1/31", neighborId: "SPINE1", neighborLabel: "SPINE1", linkType: "Underlay (Uplink)", mtu: 9216, protocols: ["IGP", "BGP EVPN"], extra: [{ label: "VTEP Source", value: `${VTEP_LOOPBACK.LEAF3} (Loopback0)` }] },
    { id: "LEAF3-hostb", name: "ge-0/0/0", neighborId: "HOST-B", neighborLabel: "HOST-B", linkType: `Access (VLAN ${VLAN})`, mtu: 1500, protocols: ["Ethernet"] },
  ],
};

export function interfacesFor(device: "LEAF1" | "SPINE1" | "LEAF2" | "LEAF3", state: EvpnMultihomingState, currentStepId: string): DeviceInterfaceData[] {
  const trace = traceFor(device, state, currentStepId);
  const processing = trace.activeStageId !== undefined;
  return INTERFACES[device]
    .filter((def) => !(def.neighborId === "SERVER-A" && device === "LEAF1" && state.leaf1Failed))
    .map((def) => ({
      id: def.id,
      name: def.name,
      status: def.neighborId === "SERVER-A" && device === "LEAF1" && state.leaf1Failed ? "down" : "up",
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

export function esTabRowsFor(state: EvpnMultihomingState, leaf: LeafId) {
  if (leaf === "LEAF3") return [{ label: "Ethernet Segment", value: "Not attached — LEAF3 is not part of this ES" }];
  const peers = state.esPeersDiscovered[leaf] ?? [];
  return [
    { label: "ESI", value: ESI },
    { label: "Mode", value: ETHERNET_SEGMENT.mode },
    { label: "Local Interface", value: leaf === "LEAF1" ? "ge-0/0/0" : "ge-0/0/0" },
    { label: "Attached CE/Server", value: `SERVER-A (${SERVER_A_IP})` },
    { label: "VNI / EVI", value: `VLAN ${VLAN} / VNI ${VNI}` },
    { label: "Local ES State", value: leaf === "LEAF1" && state.leaf1Failed ? "Unavailable" : "Up" },
    { label: "Discovered Remote ES Peers", value: peers.length ? peers.join(", ") : "(none yet)" },
    { label: "DF / NDF", value: { "not-elected": "Not yet elected", df: "DF", ndf: "NDF" }[dfRoleFor(state.dfState, leaf)] },
  ];
}

export function dfTabRowsFor(state: EvpnMultihomingState, leaf: LeafId) {
  if (leaf === "LEAF3") return [{ label: "DF Election", value: "Not applicable — LEAF3 is not attached to this Ethernet Segment" }];
  const s = state.dfState;
  return [
    { label: "Ethernet Segment", value: ESI },
    { label: "Ethernet Tag / EVI", value: s.evi },
    { label: "Election Algorithm", value: s.algorithm },
    { label: "Candidate PEs", value: s.candidates.map((c) => c.leaf).join(", ") || "(none)" },
    { label: "Candidate Values", value: s.candidates.map((c) => `${c.leaf}=${c.electionValue}`).join(", ") || "(none)" },
    { label: "Winner", value: s.winner ?? "(none)" },
    { label: "Local Role", value: { "not-elected": "Not elected", df: "DF", ndf: "NDF" }[dfRoleFor(s, leaf)] },
    { label: "Previous Winner", value: s.previousWinner ?? "(none)" },
    { label: "Election Reason", value: state.dualDfFault ? "INCONSISTENT — see fault" : s.reason },
  ];
}

export function evpnRibRowsFor(state: EvpnMultihomingState, leaf: LeafId): EvpnRibRow[] {
  const rows: EvpnRibRow[] = [];
  const t1 = state.type1Routes[leaf === "LEAF2" ? "LEAF1" : leaf] ?? state.type1Routes.LEAF1;
  if (leaf !== "LEAF3" && t1) t1.forEach((r) => rows.push({ routeType: "1", summary: `ESI ${r.esi.slice(-8)} (${r.scope})`, nextHop: VTEP_LOOPBACK[r.originLeaf] }));
  if (leaf !== "LEAF3") rows.push({ routeType: "2", summary: `${state.leaf1Failed && leaf === "LEAF1" ? "—" : "DD:DD:DD:DD:DD:33 / 10.10.10.33"}`, nextHop: "(local, via ES)" });
  rows.push({ routeType: "3", summary: `VNI ${VNI} membership`, nextHop: "(all participating leafs)" });
  if (leaf !== "LEAF3" && state.type4Routes[leaf]) rows.push({ routeType: "4", summary: `ESI ${ESI.slice(-8)}`, nextHop: VTEP_LOOPBACK[leaf], extra: [{ label: "DF", value: state.dfState.winner === leaf ? "Yes" : "No" }] });
  return rows;
}

export function linkDetailFor(linkId: string, state: EvpnMultihomingState): LinkDetail | undefined {
  const edge = GRAPH_EDGES.find((e) => e.id === linkId);
  if (!edge) return undefined;
  const a = edge.a as EvpnMultihomingDeviceId;
  const b = edge.b as EvpnMultihomingDeviceId;
  const allIfaces: Record<string, IfaceDef[]> = {
    "SERVER-A": [
      { id: "servera-leaf1", name: "eth0", ip: `${SERVER_A_IP}/24`, neighborId: "LEAF1", neighborLabel: "LEAF1", linkType: `Access (ESI, VLAN ${VLAN})`, mtu: 1500, protocols: ["Ethernet"], extra: [{ label: "ESI", value: ESI }, { label: "DF at LEAF1", value: state.dfState.winner === "LEAF1" ? "Yes" : "No" }] },
      { id: "servera-leaf2", name: "eth1", ip: `${SERVER_A_IP}/24`, neighborId: "LEAF2", neighborLabel: "LEAF2", linkType: `Access (ESI, VLAN ${VLAN})`, mtu: 1500, protocols: ["Ethernet"], extra: [{ label: "ESI", value: ESI }, { label: "DF at LEAF2", value: state.dfState.winner === "LEAF2" ? "Yes" : "No" }] },
    ],
    ...INTERFACES,
    "HOST-B": [{ id: "hostb-leaf3", name: "eth0", ip: `10.10.10.22/24`, neighborId: "LEAF3", neighborLabel: "LEAF3", linkType: "Access", mtu: 1500, protocols: ["Ethernet"] }],
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
    protocols: isUnderlay ? [{ label: "IGP", value: "Converged" }, { label: "BGP EVPN", value: state.bgpSessionUp ? "Established" : "Not yet formed" }] : [{ label: "ESI", value: a === "SERVER-A" || b === "SERVER-A" ? ESI : "—" }],
  };
}

export interface CliOutput { cmd: string; output: string; }
export interface CliCommandEntry { id: string; label: string; cisco: CliOutput; juniper: CliOutput; }

export function buildMultihomingCliCommands(state: EvpnMultihomingState, leaf: LeafId): CliCommandEntry[] {
  if (leaf === "LEAF3") return [{ id: "vni", label: "vni state", cisco: { cmd: "show nve vni", output: `VNI ${VNI}    State: Up    (not part of the ESI)` }, juniper: { cmd: "show interfaces vtep", output: `VNI ${VNI}: Up` } }];
  const esCisco: CliOutput = { cmd: "show evpn ethernet-segment esi " + ESI, output: `ESI: ${ESI}    Type: All-Active    Interface: ge-0/0/0` };
  const esJuniper: CliOutput = { cmd: "show evpn instance esi " + ESI, output: `ESI: ${ESI}    Mode: all-active    DF: ${state.dfState.winner}` };
  const t1Cisco: CliOutput = { cmd: "show bgp l2vpn evpn route-type 1", output: `RD ${VTEP_LOOPBACK[leaf]}:${VNI}    ESI ${ESI.slice(-8)}` };
  const t1Juniper: CliOutput = { cmd: "show route table bgp.evpn.0 match-prefix 1:*", output: `1:${VTEP_LOOPBACK[leaf]}:${VNI}:0:${ESI.slice(-8)}` };
  const t4Cisco: CliOutput = { cmd: "show bgp l2vpn evpn route-type 4", output: `ESI ${ESI.slice(-8)}    Originator ${VTEP_LOOPBACK[leaf]}` };
  const t4Juniper: CliOutput = { cmd: "show route table bgp.evpn.0 match-prefix 4:*", output: `4:${VTEP_LOOPBACK[leaf]}:${ESI.slice(-8)}` };
  const dfCisco: CliOutput = { cmd: "show evpn ethernet-segment esi " + ESI + " designated-forwarder", output: `DF: ${state.dfState.winner}    Algorithm: default (service-carving not modeled)` };
  const dfJuniper: CliOutput = { cmd: "show evpn designated-forwarder", output: `ESI ${ESI.slice(-8)}: DF=${state.dfState.winner}` };
  return [
    { id: "es", label: "ethernet-segment", cisco: esCisco, juniper: esJuniper },
    { id: "type1", label: "evpn type 1", cisco: t1Cisco, juniper: t1Juniper },
    { id: "type4", label: "evpn type 4", cisco: t4Cisco, juniper: t4Juniper },
    { id: "df", label: "df state", cisco: dfCisco, juniper: dfJuniper },
  ];
}

export function buildSpineCliCommands(): CliCommandEntry[] {
  return [{ id: "underlay", label: "underlay routes", cisco: { cmd: "show ip route ospf", output: "10.255.0.1/32, 10.255.0.2/32, 10.255.0.3/32 — all via OSPF" }, juniper: { cmd: "show route protocol ospf", output: "10.255.0.1/32, 10.255.0.2/32, 10.255.0.3/32 — all *[OSPF/10]" } }];
}
