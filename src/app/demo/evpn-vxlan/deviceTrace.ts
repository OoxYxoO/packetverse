import type { DeviceInterfaceData, DeviceProcessingTrace, LinkDetail, PacketStackFrame, ProcessingStage } from "@/components/network3d/types";
import { EVPN_EXPORT_RT, evpnSteps, GRAPH_EDGES, HOST_B_IP, HOST_B_MAC, VLAN, VNI, VTEP_LOOPBACK, type EvpnDeviceId, type EvpnState, type LeafId } from "@/lib/sim-engine/scenarios/evpnVxlan";

/**
 * The "Scene Adapter" for EVPN + VXLAN's device-interior 3D view.
 * Every stage list, checkpoint, interface, and link-detail value below
 * is computed FROM EvpnState (the ScenarioEngine's own output) — this
 * file never makes a VXLAN/EVPN decision itself, it only re-describes
 * decisions the engine already made, in the generic
 * DeviceProcessingTrace/DeviceInterfaceData shape the 3D layer
 * understands. Nothing in components/network3d/ imports this file.
 *
 * Level 3 enrichment (mirrors mpls-l3vpn/deviceTrace.ts): the existing
 * per-stepIndex forwarding branches gained `lookupType`/`lookupKey`/
 * `lookupResult`/`nextHopId`/`nextHopLabel`/`reason`/
 * `packetBeforeFrames`/`packetAfterFrames`/`mutations` — every value
 * still derived from data the branch already had. New branches were
 * added ONLY for the EVPN control-plane steps (LEAF2 building/
 * advertising the Type 2 route; LEAF1 receiving/importing it), which
 * previously fell through to the generic "pipeline not active" base
 * with no inspectable detail at all — the control plane (BGP EVPN
 * route build/import) stays a completely separate branch set from the
 * data plane (VXLAN encap/underlay-forward/decap) throughout.
 */

const stepIndex = (id: string) => evpnSteps.findIndex((s) => s.id === id);

// ---------------------------------------------------------------------------
// Conceptual pipelines — exact stage names from the brief, plus the two
// control-plane stage lists (LEAF2 builds/advertises; LEAF1 imports).
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
/** LEAF1's control-plane side — importing the Type 2 route MP-BGP/EVPN delivers, distinct from the forwarding pipeline above. */
const LEAF1_CONTROL_STAGES: ProcessingStage[] = [
  { id: "bgp-receive", label: "BGP EVPN Receive" },
  { id: "rt-import-check", label: "RT Import Check" },
  { id: "install", label: "Install Remote MAC" },
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
/** LEAF2's control-plane side — originating and advertising the Type 2 route. */
const LEAF2_CONTROL_STAGES: ProcessingStage[] = [
  { id: "local-learn", label: "Local MAC/IP Learn" },
  { id: "build-route", label: "Build Type 2 Route" },
  { id: "attach-rd", label: "Attach RD" },
  { id: "attach-rt", label: "Attach RT" },
  { id: "set-nexthop", label: "Set Next Hop (VTEP)" },
  { id: "advertise", label: "BGP EVPN Advertise" },
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
function vxlanFrames(justChangedId?: string): PacketStackFrame[] {
  return [
    { id: "outer-eth", text: "Outer Ethernet", tone: "transport" },
    { id: "outer-ip", text: "Outer IP", tone: "transport" },
    { id: "udp", text: "UDP 4789", tone: "transport" },
    { id: "vxlan", text: `VXLAN VNI ${VNI}`, tone: "vpn", justChanged: justChangedId === "vxlan" },
    { id: "inner", text: "Original Ethernet Frame", tone: "generic" },
  ];
}

const LEAF1_STEP_IDS = ["leaf1-ingress", "leaf1-ingress-confirmed"];
const SPINE_STEP_IDS = ["spine-forward", "spine-forward-confirmed"];
const LEAF2_STEP_IDS = ["leaf2-egress", "leaf2-egress-confirmed"];

export function traceFor(device: "LEAF1" | "SPINE1" | "LEAF2", state: EvpnState, currentStepId: string): DeviceProcessingTrace | undefined {
  const i = stepIndex(currentStepId);
  const verifyIndex = stepIndex("verify-dataplane");

  if (device === "LEAF1") {
    // --- Control-plane branches — importing the Type 2 route ---
    if (currentStepId === "evpn-route-received") {
      const received = state.received.LEAF1;
      return {
        deviceId: "LEAF1",
        stages: LEAF1_CONTROL_STAGES,
        activeStageId: "rt-import-check",
        completedStageIds: ["bgp-receive"],
        lookupType: "RT Import Check",
        lookupKey: `Route RT ${state.evpnRoute?.rt ?? "—"} vs. VNI ${VNI} import RT ${state.importRt.LEAF1}`,
        lookupResult: received?.rtMatched ? "Match" : "No match",
        reason: "RT is the only thing that has to match — RD only guarantees uniqueness in BGP, and the route's VNI plays no role in the import decision either.",
        forwardingAction: "LEAF1 compares the route's RT against its own VNI import RT.",
      };
    }
    if (currentStepId === "remote-mac-installed") {
      return {
        deviceId: "LEAF1",
        stages: LEAF1_CONTROL_STAGES,
        activeStageId: "install",
        completedStageIds: ["bgp-receive", "rt-import-check"],
        lookupType: "Remote MAC Install",
        lookupKey: `${HOST_B_MAC} / ${HOST_B_IP}`,
        lookupResult: `Installed — remote VTEP ${VTEP_LOOPBACK.LEAF2}`,
        reason: "RT matched, so the route installs as a verified remote MAC/IP entry — no longer the assumption the first walkthrough started with.",
        forwardingAction: "LEAF1 installs HOST-B's remote MAC via EVPN.",
      };
    }
    if (currentStepId === "fault-injected") {
      return {
        deviceId: "LEAF1",
        stages: LEAF1_CONTROL_STAGES,
        activeStageId: "rt-import-check",
        completedStageIds: ["bgp-receive"],
        lookupType: "RT Import Check",
        lookupKey: `Route RT ${state.evpnRoute?.rt ?? EVPN_EXPORT_RT} vs. VNI ${VNI} import RT ${state.importRt.LEAF1}`,
        lookupResult: "No match — remote MAC withdrawn",
        reason: "An engineer changed LEAF1's VNI import RT — it no longer matches LEAF2's export RT, so the previously-installed remote MAC is withdrawn.",
        forwardingAction: "LEAF1's import RT no longer matches — HOST-B's remote MAC is withdrawn.",
      };
    }
    if (currentStepId === "repair-challenge" && state.repairAttempt?.correct) {
      return {
        deviceId: "LEAF1",
        stages: LEAF1_CONTROL_STAGES,
        activeStageId: "install",
        completedStageIds: ["bgp-receive", "rt-import-check"],
        lookupType: "RT Import Check",
        lookupKey: `Route RT ${EVPN_EXPORT_RT} vs. VNI ${VNI} import RT ${state.importRt.LEAF1}`,
        lookupResult: "Match — remote MAC reinstalled",
        reason: "LEAF1's import RT corrected back to match LEAF2's export RT — the route matches again and HOST-B's remote MAC is reinstalled.",
        forwardingAction: "LEAF1's import RT corrected — HOST-B's remote MAC reinstalled.",
      };
    }
    if (i > stepIndex("remote-mac-installed") && i < stepIndex("resend-host-a")) {
      return { deviceId: "LEAF1", stages: LEAF1_CONTROL_STAGES, activeStageId: "install", completedStageIds: allIds(LEAF1_CONTROL_STAGES), lookupResult: `${HOST_B_MAC} installed via EVPN` };
    }

    // --- Forwarding pipeline (existing branch structure, enriched) ---
    const base: DeviceProcessingTrace = { deviceId: "LEAF1", ingressInterfaceId: "LEAF1-hosta", egressInterfaceId: "LEAF1-spine1", stages: LEAF1_INGRESS_STAGES, completedStageIds: [] };
    const active = LEAF1_STEP_IDS.some((id) => stepIndex(id) === i) || i === verifyIndex;
    if (!active) return { ...base, completedStageIds: i > stepIndex("leaf2-egress-confirmed") ? allIds(LEAF1_INGRESS_STAGES) : [] };
    const macEntry = state.macTable.LEAF1.find((m) => m.mac === HOST_B_MAC);
    const viaEvpn = macEntry?.learnedVia === "evpn";
    return {
      ...base,
      activeStageId: "vxlan-encap",
      completedStageIds: ["access-port", "vlan-id", "mac-lookup", "vlan-vni-map", "remote-vtep"],
      packetBefore: "Ethernet frame (VLAN 10)",
      packetAfter: `VXLAN(VNI ${VNI})`,
      packetBeforeFrames: plainFrames(),
      packetAfterFrames: vxlanFrames("vxlan"),
      lookupType: "MAC Table / Remote VTEP Resolution",
      lookupKey: `MAC ${HOST_B_MAC}`,
      lookupResult: viaEvpn ? `${VTEP_LOOPBACK.LEAF2} — learned via EVPN Type 2` : `${VTEP_LOOPBACK.LEAF2} — assumed, not yet verified`,
      nextHopId: "SPINE1",
      nextHopLabel: "SPINE1",
      mutations: [{ type: "ENCAPSULATE", detail: `VXLAN VNI ${VNI}` }],
      reason: viaEvpn ? "The remote VTEP is now a real, BGP-distributed fact — no flooding required." : "This first walkthrough assumes LEAF1 already knows where HOST-B lives — flood-and-learn (or EVPN, taught next) is what would normally teach it that.",
    };
  }

  if (device === "SPINE1") {
    const base: DeviceProcessingTrace = { deviceId: "SPINE1", ingressInterfaceId: "SPINE1-leaf1", egressInterfaceId: "SPINE1-leaf2", stages: SPINE1_STAGES, completedStageIds: [] };
    const active = SPINE_STEP_IDS.some((id) => stepIndex(id) === i) || i === verifyIndex;
    if (!active) return base;
    return {
      ...base,
      activeStageId: "outer-ip-lookup",
      completedStageIds: ["underlay-ingress"],
      packetBefore: `Outer dst IP ${VTEP_LOOPBACK.LEAF2}`,
      packetAfter: `Forward toward ${VTEP_LOOPBACK.LEAF2}`,
      packetBeforeFrames: vxlanFrames(),
      packetAfterFrames: vxlanFrames(),
      lookupType: "Underlay IP Lookup (ECMP)",
      lookupKey: VTEP_LOOPBACK.LEAF2,
      lookupResult: `Forward toward ${VTEP_LOOPBACK.LEAF2}`,
      nextHopId: "LEAF2",
      nextHopLabel: "LEAF2",
      reason: "SPINE1 forwards strictly on the outer destination IP — it never reads the VXLAN header, the inner frame, or any tenant MAC.",
    };
  }

  // LEAF2
  // --- Control-plane branches — originating and advertising the Type 2 route ---
  if (currentStepId === "host-b-local-learn") {
    return { deviceId: "LEAF2", stages: LEAF2_CONTROL_STAGES, activeStageId: "local-learn", completedStageIds: [], lookupType: "Local MAC/IP Learn", lookupResult: `${HOST_B_MAC} / ${HOST_B_IP} — local access port`, reason: "HOST-B is directly attached — no advertisement is needed to learn it locally." };
  }
  if (currentStepId === "evpn-type2-created") {
    return { deviceId: "LEAF2", stages: LEAF2_CONTROL_STAGES, activeStageId: "build-route", completedStageIds: ["local-learn"], lookupType: "Build EVPN Type 2 Route", lookupResult: `MAC ${HOST_B_MAC}, IP ${HOST_B_IP}, VNI ${VNI}`, reason: "LEAF2 packages its local host entry into a BGP EVPN Type 2 (MAC/IP Advertisement) route." };
  }
  if (currentStepId === "route-builder-rd") {
    return { deviceId: "LEAF2", stages: LEAF2_CONTROL_STAGES, activeStageId: "attach-rd", completedStageIds: ["local-learn", "build-route"], lookupType: "Attach RD", lookupResult: state.evpnRoute?.rd ?? "—", reason: "RD only guarantees uniqueness in BGP — it plays no role in import policy." };
  }
  if (currentStepId === "route-builder-rt") {
    return { deviceId: "LEAF2", stages: LEAF2_CONTROL_STAGES, activeStageId: "attach-rt", completedStageIds: ["local-learn", "build-route", "attach-rd"], lookupType: "Attach RT", lookupResult: state.evpnRoute?.rt ?? "—", reason: "RT is what LEAF1 will actually compare against its own VNI import policy." };
  }
  if (currentStepId === "route-builder-nexthop") {
    return { deviceId: "LEAF2", stages: LEAF2_CONTROL_STAGES, activeStageId: "set-nexthop", completedStageIds: ["local-learn", "build-route", "attach-rd", "attach-rt"], lookupType: "Set Next Hop", lookupResult: state.evpnRoute?.nextHop ?? VTEP_LOOPBACK.LEAF2, nextHopId: "LEAF1", nextHopLabel: "LEAF1", reason: "The overlay next-hop names LEAF2's own VTEP — never HOST-B's own IP." };
  }
  if (currentStepId === "evpn-update-sent") {
    return { deviceId: "LEAF2", stages: LEAF2_CONTROL_STAGES, activeStageId: "advertise", completedStageIds: ["local-learn", "build-route", "attach-rd", "attach-rt", "set-nexthop"], lookupType: "BGP EVPN Advertise", lookupResult: "Advertised to LEAF1", nextHopId: "LEAF1", nextHopLabel: "LEAF1", reason: "The full route — RD, MAC/IP, RT, next-hop — travels in one BGP UPDATE, address family L2VPN EVPN." };
  }
  if (i > stepIndex("evpn-update-sent") && i < stepIndex("resend-host-a")) {
    return { deviceId: "LEAF2", stages: LEAF2_CONTROL_STAGES, activeStageId: "advertise", completedStageIds: allIds(LEAF2_CONTROL_STAGES), lookupResult: "Route advertised and active" };
  }

  // --- Forwarding pipeline (existing branch structure, enriched) ---
  const base: DeviceProcessingTrace = { deviceId: "LEAF2", ingressInterfaceId: "LEAF2-spine1", egressInterfaceId: "LEAF2-hostb", stages: LEAF2_EGRESS_STAGES, completedStageIds: [] };
  const active = LEAF2_STEP_IDS.some((id) => stepIndex(id) === i) || i === verifyIndex;
  if (!active) return { ...base, completedStageIds: i > stepIndex("leaf2-egress-confirmed") ? allIds(LEAF2_EGRESS_STAGES) : [] };
  return {
    ...base,
    activeStageId: "vni-lookup",
    completedStageIds: ["underlay-ingress", "vxlan-decap"],
    packetBefore: `VXLAN(VNI ${VNI})`,
    packetAfter: "Original Ethernet Frame → HOST-B",
    packetBeforeFrames: vxlanFrames(),
    packetAfterFrames: plainFrames(),
    lookupType: "VNI → VLAN / MAC Lookup",
    lookupKey: `VNI ${VNI}`,
    lookupResult: `VLAN ${VLAN} — MAC ${HOST_B_MAC} → access port`,
    nextHopId: "HOST-B",
    nextHopLabel: "HOST-B",
    mutations: [{ type: "DECAPSULATE", detail: `VXLAN VNI ${VNI} removed` }],
    reason: "LEAF2 strips the outer headers, reads the VNI to select the overlay context, then delivers the untouched inner frame locally.",
  };
}

// ---------------------------------------------------------------------------
// Packet visual stack (3D floating frame stack) — derived from state.packet.
// ---------------------------------------------------------------------------

export function packetFramesFor(state: EvpnState): PacketStackFrame[] | undefined {
  if (!state.packet) return undefined;
  if (!state.packet.encapsulated) return plainFrames();
  return vxlanFrames("vxlan");
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
