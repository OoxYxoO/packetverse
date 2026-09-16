import type { DeviceInterfaceData, DeviceProcessingTrace, LinkDetail, PacketStackFrame, ProcessingStage } from "@/components/network3d/types";
import type { EvpnRibRow } from "@/components/protocol/EvpnRouteTable";
import {
  ESI,
  GRAPH_EDGES,
  SERVER_A_IP,
  VLAN,
  VNI,
  VTEP_LOOPBACK,
  evpnAliasingSteps,
  getEligibleEsPeers,
  type EvpnAliasingDeviceId,
  type EvpnAliasingState,
  type LeafId,
} from "@/lib/sim-engine/scenarios/evpnAliasingMassWithdrawal";

const stepIndex = (id: string) => evpnAliasingSteps.findIndex((s) => s.id === id);

const CONTROL_PIPELINE_STAGES: ProcessingStage[] = [
  { id: "type2-advertised", label: "Type-2 MAC Route Advertised" },
  { id: "ad-evi-advertised", label: "A-D Per-EVI Advertised" },
  { id: "ad-es-advertised", label: "A-D Per-ES Advertised" },
];
const DECAP_STAGES: ProcessingStage[] = [
  { id: "vxlan-decap", label: "VXLAN Decap" },
  { id: "vni-lookup", label: `VNI ${VNI} Lookup` },
  { id: "esi-local", label: "ESI Recognized Locally" },
  { id: "local-segment", label: "Local Ethernet Segment" },
  { id: "deliver", label: "Deliver To SERVER-A (no DF check)" },
];
const LEAF3_ALIAS_STAGES: ProcessingStage[] = [
  { id: "dest-mac-lookup", label: "Destination MAC Lookup" },
  { id: "type2-route", label: "Type-2 Route" },
  { id: "esi-identified", label: "ESI Identified" },
  { id: "adevi-lookup", label: "A-D Per-EVI Lookup" },
  { id: "eligible-set", label: "Eligible PE Set" },
  { id: "flow-select", label: "Flow / ECMP Selection" },
  { id: "remote-vtep", label: "Remote VTEP" },
  { id: "vxlan-encap", label: "VXLAN Encapsulation" },
];
const LEAF3_MASSWITHDRAW_STAGES: ProcessingStage[] = [
  { id: "bgp-withdraw", label: "BGP EVPN WITHDRAW Received" },
  { id: "route-type1-per-es", label: "Route Type 1, A-D Per-ES" },
  { id: "esi-x", label: "ESI Identified" },
  { id: "failed-pe", label: "Failed PE = LEAF1" },
  { id: "find-dependents", label: "Find Dependent ES Destinations" },
  { id: "remove-nexthop", label: "Remove LEAF1 From Eligible Sets" },
  { id: "retain-survivors", label: "Retain Surviving PE(s)" },
  { id: "update-forwarding", label: "Update Forwarding State" },
];
const SPINE1_STAGES: ProcessingStage[] = [
  { id: "underlay-ingress", label: "Underlay Ingress" },
  { id: "outer-ip-lookup", label: "Outer IP Lookup" },
  { id: "forward", label: "Forward" },
];

function allIds(stages: ProcessingStage[]) {
  return stages.map((s) => s.id);
}

export function traceFor(device: "LEAF1" | "SPINE1" | "LEAF2" | "LEAF3", state: EvpnAliasingState, currentStepId: string): DeviceProcessingTrace {
  const i = stepIndex(currentStepId);

  if (device === "SPINE1") {
    const base: DeviceProcessingTrace = { deviceId: "SPINE1", stages: SPINE1_STAGES, completedStageIds: [] };
    if (!state.packetAt) return base;
    return { ...base, activeStageId: "outer-ip-lookup", completedStageIds: ["underlay-ingress"] };
  }

  if (device === "LEAF3") {
    const massWithdrawStart = stepIndex("withdraw-per-es");
    const massWithdrawEnd = stepIndex("next-hop-transformation");
    if (i >= massWithdrawStart && i < massWithdrawEnd) {
      const base: DeviceProcessingTrace = { deviceId: "LEAF3", stages: LEAF3_MASSWITHDRAW_STAGES, completedStageIds: [] };
      if (i === massWithdrawStart) return base;
      if (!state.massWithdrawalProcessed) return { ...base, activeStageId: "find-dependents", completedStageIds: ["bgp-withdraw", "route-type1-per-es", "esi-x", "failed-pe"] };
      return { ...base, completedStageIds: allIds(LEAF3_MASSWITHDRAW_STAGES) };
    }
    const base: DeviceProcessingTrace = { deviceId: "LEAF3", stages: LEAF3_ALIAS_STAGES, completedStageIds: [] };
    if (!state.macRoute) return base;
    if (!state.aliasing) return { ...base, activeStageId: "esi-identified", completedStageIds: ["dest-mac-lookup", "type2-route"] };
    if (!state.activeFlow) return { ...base, activeStageId: "eligible-set", completedStageIds: ["dest-mac-lookup", "type2-route", "esi-identified", "adevi-lookup"] };
    return { ...base, completedStageIds: allIds(LEAF3_ALIAS_STAGES) };
  }

  const leaf = device as "LEAF1" | "LEAF2";
  const buildEnd = stepIndex("aliasing-decision-chamber");
  if (i < buildEnd) {
    const base: DeviceProcessingTrace = { deviceId: leaf, stages: CONTROL_PIPELINE_STAGES, completedStageIds: [] };
    const evi = state.perEviAdRoutes[leaf];
    const es = state.perEsAdRoutes[leaf];
    if (!evi && !es) return base;
    if (evi && es) return { ...base, completedStageIds: allIds(CONTROL_PIPELINE_STAGES) };
    return { ...base, activeStageId: "ad-evi-advertised", completedStageIds: ["type2-advertised"] };
  }

  const base: DeviceProcessingTrace = { deviceId: leaf, stages: DECAP_STAGES, completedStageIds: [] };
  const delivered = state.journey.some((h) => h.device === leaf && h.action === "LOCAL_DELIVER");
  if (!delivered) return base;
  return { ...base, completedStageIds: allIds(DECAP_STAGES) };
}

export function packetFramesFor(state: EvpnAliasingState): PacketStackFrame[] | undefined {
  if (!state.activeFlow && state.journey.length === 0) return undefined;
  return [
    { id: "ethernet", text: "Ethernet", tone: "generic" },
    { id: "ip", text: "IP", tone: "ip" },
  ];
}

interface IfaceDef { id: string; name: string; ip?: string; neighborId: EvpnAliasingDeviceId; neighborLabel: string; linkType: string; mtu: number; protocols: string[]; extra?: { label: string; value: string }[]; }

const INTERFACES: Record<"LEAF1" | "SPINE1" | "LEAF2" | "LEAF3", IfaceDef[]> = {
  LEAF1: [
    { id: "LEAF1-servera", name: "ge-0/0/0", neighborId: "SERVER-A", neighborLabel: "SERVER-A", linkType: `Access (VLAN ${VLAN}, ESI)`, mtu: 1500, protocols: ["Ethernet"], extra: [{ label: "ESI", value: ESI }] },
    { id: "LEAF1-spine1", name: "et-0/1/0", ip: "10.0.11.1/31", neighborId: "SPINE1", neighborLabel: "SPINE1", linkType: "Underlay (Uplink)", mtu: 9216, protocols: ["IGP", "BGP EVPN"], extra: [{ label: "VTEP Source", value: `${VTEP_LOOPBACK.LEAF1} (Loopback0)` }] },
  ],
  SPINE1: [
    { id: "SPINE1-leaf1", name: "et-0/0/0", ip: "10.0.11.0/31", neighborId: "LEAF1", neighborLabel: "LEAF1", linkType: "Underlay", mtu: 9216, protocols: ["IGP"] },
    { id: "SPINE1-leaf2", name: "et-0/0/1", ip: "10.0.12.0/31", neighborId: "LEAF2", neighborLabel: "LEAF2", linkType: "Underlay", mtu: 9216, protocols: ["IGP"] },
    { id: "SPINE1-leaf3", name: "et-0/0/2", ip: "10.0.13.0/31", neighborId: "LEAF3", neighborLabel: "LEAF3", linkType: "Underlay", mtu: 9216, protocols: ["IGP"] },
  ],
  LEAF2: [
    { id: "LEAF2-servera", name: "ge-0/0/0", neighborId: "SERVER-A", neighborLabel: "SERVER-A", linkType: `Access (VLAN ${VLAN}, ESI)`, mtu: 1500, protocols: ["Ethernet"], extra: [{ label: "ESI", value: ESI }] },
    { id: "LEAF2-spine1", name: "et-0/1/0", ip: "10.0.12.1/31", neighborId: "SPINE1", neighborLabel: "SPINE1", linkType: "Underlay (Uplink)", mtu: 9216, protocols: ["IGP", "BGP EVPN"], extra: [{ label: "VTEP Source", value: `${VTEP_LOOPBACK.LEAF2} (Loopback0)` }] },
  ],
  LEAF3: [
    { id: "LEAF3-spine1", name: "et-0/1/0", ip: "10.0.13.1/31", neighborId: "SPINE1", neighborLabel: "SPINE1", linkType: "Underlay (Uplink)", mtu: 9216, protocols: ["IGP", "BGP EVPN"], extra: [{ label: "VTEP Source", value: `${VTEP_LOOPBACK.LEAF3} (Loopback0)` }] },
    { id: "LEAF3-hostb", name: "ge-0/0/0", neighborId: "HOST-B", neighborLabel: "HOST-B", linkType: `Access (VLAN ${VLAN})`, mtu: 1500, protocols: ["Ethernet"] },
  ],
};

export function interfacesFor(device: "LEAF1" | "SPINE1" | "LEAF2" | "LEAF3", state: EvpnAliasingState, currentStepId: string): DeviceInterfaceData[] {
  const trace = traceFor(device, state, currentStepId);
  const processing = trace.activeStageId !== undefined;
  return INTERFACES[device]
    .filter((def) => !(def.neighborId === "SERVER-A" && device === "LEAF1" && state.esAttachmentFailed))
    .map((def) => ({
      id: def.id,
      name: def.name,
      status: def.neighborId === "SERVER-A" && device === "LEAF1" && state.esAttachmentFailed ? "down" : "up",
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

export function aliasingTabRowsFor(state: EvpnAliasingState) {
  if (!state.aliasing) return [{ label: "Aliasing", value: "Not yet built — waiting on A-D per-EVI routes from both leafs" }];
  const a = state.aliasing;
  const failed = ["LEAF1", "LEAF2"].filter((l) => !a.eligiblePEs.includes(l as LeafId)) as LeafId[];
  return [
    { label: "Destination", value: a.mac },
    { label: "ESI", value: a.esi },
    { label: "EVI / VNI", value: `VLAN ${VLAN} / VNI ${a.vni}` },
    { label: "Type-2 Source", value: "Type-2 + Ethernet A-D per-EVI" },
    { label: "A-D Peers", value: (["LEAF1", "LEAF2"] as LeafId[]).filter((l) => state.perEviAdRoutes[l]).join(", ") || "(none)" },
    { label: "Eligible PEs", value: a.eligiblePEs.join(", ") || "(none)" },
    { label: "Failed / Ineligible PEs", value: failed.length ? failed.join(", ") : "(none)" },
    { label: "Selected PE — Flow A", value: a.selectedPe.A ?? "(unselected)" },
    { label: "Selected PE — Flow B", value: a.selectedPe.B ?? "(unselected)" },
  ];
}

export function nextHopsTabRowsFor(state: EvpnAliasingState) {
  return (["LEAF1", "LEAF2"] as LeafId[]).map((l) => ({
    label: l,
    value: state.aliasing?.eligiblePEs.includes(l) ? `Eligible (${VTEP_LOOPBACK[l]})` : "Removed — not eligible",
  }));
}

export function macTableTabRowsFor(state: EvpnAliasingState) {
  if (!state.macRoute) return [{ label: "MAC Table", value: "Empty" }];
  return [
    { label: state.macRoute.mac, value: `ESI ${state.macRoute.esi.slice(-8)} (multihomed — see Aliasing tab)` },
  ];
}

export function esTabRowsFor(state: EvpnAliasingState, leaf: LeafId) {
  if (leaf === "LEAF3") return [{ label: "Ethernet Segment", value: "Not attached — LEAF3 is not part of this ES" }];
  const evi = state.perEviAdRoutes[leaf];
  const es = state.perEsAdRoutes[leaf];
  return [
    { label: "ESI", value: ESI },
    { label: "Mode", value: "all-active" },
    { label: "Attached CE/Server", value: `SERVER-A (${SERVER_A_IP})` },
    { label: "VNI / EVI", value: `VLAN ${VLAN} / VNI ${VNI}` },
    { label: "A-D Per-EVI Advertised", value: evi ? "Yes" : "No" },
    { label: "A-D Per-ES Advertised", value: es ? (es.withdrawn ? "Yes (WITHDRAWN)" : "Yes") : "No" },
  ];
}

export function adRoutesTabRowsFor(state: EvpnAliasingState, leaf: LeafId): EvpnRibRow[] {
  const rows: EvpnRibRow[] = [];
  const evi = state.perEviAdRoutes[leaf];
  const es = state.perEsAdRoutes[leaf];
  if (evi) rows.push({ routeType: "1", subKind: "PER EVI", summary: `ESI ${evi.esi.slice(-8)} / VNI ${evi.vni}`, nextHop: VTEP_LOOPBACK[leaf], rd: evi.rd, rt: evi.rt });
  if (es) rows.push({ routeType: "1", subKind: "PER ES", summary: `ESI ${es.esi.slice(-8)}${es.withdrawn ? " (WITHDRAWN)" : ""}`, nextHop: VTEP_LOOPBACK[leaf], rd: es.rd, rt: es.rt });
  return rows;
}

export function failureStateTabRowsFor(state: EvpnAliasingState, leaf: LeafId) {
  const failed = leaf === "LEAF1" && state.esAttachmentFailed;
  return [
    { label: "Device Status", value: "Up" },
    { label: "Underlay Status", value: "Up" },
    { label: "BGP EVPN Status", value: "Established" },
    { label: "Local ES Attachment (to SERVER-A)", value: failed ? "DOWN" : "Up" },
  ];
}

export function evpnRibRowsFor(state: EvpnAliasingState, device: EvpnAliasingDeviceId): EvpnRibRow[] {
  const rows: EvpnRibRow[] = [];
  if (device === "LEAF3") {
    if (state.macRoute) rows.push({ routeType: "2", summary: `${state.macRoute.mac} / ${state.macRoute.ip}`, nextHop: `ESI ${state.macRoute.esi.slice(-8)} (multihomed)`, rd: state.macRoute.rd, rt: state.macRoute.rt });
    (["LEAF1", "LEAF2"] as LeafId[]).forEach((l) => {
      const evi = state.perEviAdRoutes[l];
      if (evi) rows.push({ routeType: "1", subKind: "PER EVI", summary: `ESI ${evi.esi.slice(-8)} / VNI ${evi.vni}`, nextHop: VTEP_LOOPBACK[l], rd: evi.rd, rt: evi.rt });
      const es = state.perEsAdRoutes[l];
      if (es) rows.push({ routeType: "1", subKind: "PER ES", summary: `ESI ${es.esi.slice(-8)}${es.withdrawn ? " (WITHDRAWN)" : ""}`, nextHop: VTEP_LOOPBACK[l], rd: es.rd, rt: es.rt });
    });
    return rows;
  }
  if (device === "LEAF1" || device === "LEAF2") return adRoutesTabRowsFor(state, device);
  return rows;
}

export function linkDetailFor(linkId: string, state: EvpnAliasingState): LinkDetail | undefined {
  const edge = GRAPH_EDGES.find((e) => e.id === linkId);
  if (!edge) return undefined;
  const a = edge.a as EvpnAliasingDeviceId;
  const b = edge.b as EvpnAliasingDeviceId;
  const allIfaces: Record<string, IfaceDef[]> = {
    "SERVER-A": [
      { id: "servera-leaf1", name: "eth0", ip: `${SERVER_A_IP}/24`, neighborId: "LEAF1", neighborLabel: "LEAF1", linkType: `Access (ESI, VLAN ${VLAN})`, mtu: 1500, protocols: ["Ethernet"], extra: [{ label: "ESI", value: ESI }, { label: "Eligible (aliasing)", value: state.aliasing?.eligiblePEs.includes("LEAF1") ? "Yes" : "No" }] },
      { id: "servera-leaf2", name: "eth1", ip: `${SERVER_A_IP}/24`, neighborId: "LEAF2", neighborLabel: "LEAF2", linkType: `Access (ESI, VLAN ${VLAN})`, mtu: 1500, protocols: ["Ethernet"], extra: [{ label: "ESI", value: ESI }, { label: "Eligible (aliasing)", value: state.aliasing?.eligiblePEs.includes("LEAF2") ? "Yes" : "No" }] },
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

export function buildAliasingCliCommands(state: EvpnAliasingState, device: EvpnAliasingDeviceId): CliCommandEntry[] {
  if (device === "SPINE1") return [{ id: "underlay", label: "underlay routes", cisco: { cmd: "show ip route ospf", output: "10.255.0.1/32, 10.255.0.2/32, 10.255.0.3/32 — all via OSPF" }, juniper: { cmd: "show route protocol ospf", output: "10.255.0.1/32, 10.255.0.2/32, 10.255.0.3/32 — all *[OSPF/10]" } }];
  if (device === "LEAF3") {
    const eligible = getEligibleEsPeers(state.perEviAdRoutes, state.perEsAdRoutes, state.massWithdrawalProcessed);
    return [
      { id: "mac", label: "mac forwarding", cisco: { cmd: "show l2route evpn mac all", output: `MAC ${state.macRoute?.mac ?? "—"}  ESI ${ESI.slice(-8)}  Next-hops: ${eligible.join(",")}` }, juniper: { cmd: "show evpn instance extensive", output: `MAC/ESI ${ESI.slice(-8)}: next-hops ${eligible.join(", ")}` } },
      { id: "adroutes", label: "evpn type 1 routes", cisco: { cmd: "show bgp l2vpn evpn route-type 1", output: `ESI ${ESI.slice(-8)}: A-D per-EVI from LEAF1,LEAF2; A-D per-ES ${state.perEsAdRoutes.LEAF1?.withdrawn ? "LEAF1 WITHDRAWN" : "LEAF1,LEAF2 present"}` }, juniper: { cmd: "show route table bgp.evpn.0 match-prefix 1:*", output: `1:*:${ESI.slice(-8)} — per-EVI x2, per-ES ${state.perEsAdRoutes.LEAF1?.withdrawn ? "(LEAF1 withdrawn)" : "x2"}` } },
    ];
  }
  const leaf = device as LeafId;
  return [
    { id: "es", label: "ethernet-segment", cisco: { cmd: "show evpn ethernet-segment esi " + ESI, output: `ESI: ${ESI}    Type: All-Active    Local attachment: ${leaf === "LEAF1" && state.esAttachmentFailed ? "DOWN" : "Up"}` }, juniper: { cmd: "show evpn instance esi " + ESI, output: `ESI: ${ESI}    Mode: all-active    Local: ${leaf === "LEAF1" && state.esAttachmentFailed ? "down" : "up"}` } },
    { id: "adroutes", label: "a-d routes", cisco: { cmd: "show bgp l2vpn evpn route-type 1", output: `A-D per-EVI: advertised. A-D per-ES: ${state.perEsAdRoutes[leaf]?.withdrawn ? "WITHDRAWN" : "advertised"}` }, juniper: { cmd: "show route advertising-protocol bgp <rr> table bgp.evpn.0", output: `1:*:${ESI.slice(-8)} per-EVI/per-ES ${state.perEsAdRoutes[leaf]?.withdrawn ? "(per-ES withdrawn)" : ""}` } },
  ];
}
