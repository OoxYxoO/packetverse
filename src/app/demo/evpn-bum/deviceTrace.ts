import type { DeviceInterfaceData, DeviceProcessingTrace, LinkDetail, PacketStackFrame, ProcessingStage } from "@/components/network3d/types";
import { evpnBumSteps, GRAPH_EDGES, VNI, VTEP_LOOPBACK, type EvpnBumDeviceId, type EvpnBumState, type LeafId } from "@/lib/sim-engine/scenarios/evpnBum";

/**
 * Scene Adapter for EVPN BUM + Route Type 3 — mirrors the Foundations
 * lesson's deviceTrace.ts exactly in shape. Every value below is
 * computed FROM EvpnBumState; nothing here decides replication or
 * route-target policy, it only re-describes decisions the scenario
 * layer already made.
 *
 * Level 3 enrichment (mirrors evpn-vxlan/deviceTrace.ts): the existing
 * per-stepIndex forwarding branches (LEAF1 classify/replicate, SPINE1
 * underlay forward, LEAF2/LEAF3 decap/deliver) gained the Hop-Inspector-
 * contract fields. New branches were added ONLY for the Type 3 (IMET)
 * control-plane steps (every leaf originating/advertising its own Type
 * 3 route, importing its peers', and building its flood list) — those
 * previously fell through to the generic idle base with no inspectable
 * detail. Type 3 control-plane branches stay entirely separate from the
 * BUM replication data-plane branches throughout — a leaf's flood list
 * is control-plane state; the replicas it produces from it are data
 * plane, never the reverse.
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
/** Every leaf's control-plane side — originating its own Type 3 (IMET) route, advertising it, importing its peers', and building the resulting flood list. Shared across LEAF1/LEAF2/LEAF3, since all three do exactly the same thing symmetrically. */
const TYPE3_CONTROL_STAGES: ProcessingStage[] = [
  { id: "originate", label: "Originate Local Type 3 (IMET)" },
  { id: "attach-rd-rt", label: "Attach RD / RT" },
  { id: "advertise", label: "BGP EVPN Advertise" },
  { id: "receive-peers", label: "Receive Peer Type 3 Routes" },
  { id: "rt-import-check", label: "RT Import Check (Per Peer)" },
  { id: "flood-list-build", label: "Build Flood List" },
];

function allIds(stages: ProcessingStage[]) {
  return stages.map((s) => s.id);
}

function plainFrames(): PacketStackFrame[] {
  return [
    { id: "ethernet", text: "Ethernet (Broadcast)", tone: "generic" },
    { id: "ip", text: "IP", tone: "ip" },
  ];
}
function vxlanFrames(justChangedId?: string): PacketStackFrame[] {
  return [
    { id: "outer-eth", text: "Outer Ethernet", tone: "transport" },
    { id: "outer-ip", text: "Outer IP", tone: "transport" },
    { id: "udp", text: "UDP 4789", tone: "transport" },
    { id: "vxlan", text: `VXLAN VNI ${VNI}`, tone: "vpn", justChanged: justChangedId === "vxlan" },
    { id: "inner", text: "Original Broadcast Frame", tone: "generic" },
  ];
}

export function traceFor(device: "LEAF1" | "SPINE1" | "LEAF2" | "LEAF3", state: EvpnBumState, currentStepId: string): DeviceProcessingTrace {
  const i = stepIndex(currentStepId);
  const classifyIndex = stepIndex("leaf1-bum-classify");
  const spineIndex = stepIndex("spine-forward-bum");
  const decapIndex = stepIndex("leaves-decap-bum");
  const verifyIndex = stepIndex("verify-dataplane");

  if (device !== "SPINE1") {
    const leaf = device;
    // --- Control-plane branches — Type 3 (IMET) originate/advertise/import/flood-list ---
    if (currentStepId === "type3-advertised") {
      return {
        deviceId: leaf,
        stages: TYPE3_CONTROL_STAGES,
        activeStageId: "advertise",
        completedStageIds: ["originate", "attach-rd-rt"],
        lookupType: "BGP EVPN Advertise (Type 3 / IMET)",
        lookupKey: `VNI ${VNI}`,
        lookupResult: `${leaf} advertises its own Type 3 route`,
        reason: "Each leaf advertises its OWN Type 3 route for the VNI it participates in — never a MAC/IP, just VNI membership.",
        forwardingAction: `${leaf} advertises a Type 3 (IMET) route for VNI ${VNI}.`,
      };
    }
    if (currentStepId === "flood-list-built" || (i > stepIndex("type3-advertised") && i <= stepIndex("predict-type2-vs-type3"))) {
      return {
        deviceId: leaf,
        stages: TYPE3_CONTROL_STAGES,
        activeStageId: "flood-list-build",
        completedStageIds: ["originate", "attach-rd-rt", "advertise", "receive-peers", "rt-import-check"],
        lookupType: "Flood List",
        lookupKey: `VNI ${VNI}`,
        lookupResult: state.floodList[leaf].length ? state.floodList[leaf].join(", ") : "(empty)",
        reason: "The flood list is built entirely from imported Type 3 routes — never from a MAC/IP lookup.",
        forwardingAction: `${leaf}'s VNI ${VNI} flood list is ready.`,
      };
    }
    if (currentStepId === "fault-injected") {
      if (leaf === "LEAF3") {
        return {
          deviceId: leaf,
          stages: TYPE3_CONTROL_STAGES,
          activeStageId: "advertise",
          completedStageIds: ["originate", "attach-rd-rt"],
          lookupType: "BGP EVPN Advertise (Type 3 / IMET)",
          lookupKey: `VNI ${VNI}`,
          lookupResult: `Export RT misconfigured — now ${state.exportRt.LEAF3}`,
          reason: "LEAF3 still advertises a Type 3 route, but with the wrong export RT — LEAF1 and LEAF2 will filter it before import.",
          forwardingAction: `LEAF3's Type 3 export RT changed to ${state.exportRt.LEAF3}.`,
        };
      }
      return {
        deviceId: leaf,
        stages: TYPE3_CONTROL_STAGES,
        activeStageId: "rt-import-check",
        completedStageIds: ["originate", "attach-rd-rt", "advertise", "receive-peers"],
        lookupType: "RT Import Check (Per Peer)",
        lookupKey: `LEAF3's Type 3 RT ${state.exportRt.LEAF3} vs. ${leaf}'s import RT ${state.importRt[leaf]}`,
        lookupResult: "No match — LEAF3 dropped from flood list",
        reason: "LEAF3's own Type 3 export RT no longer matches — its route is filtered before import, so it disappears from this leaf's flood list. LEAF1's/LEAF2's already-learned Type 2 (unicast) routes are completely unaffected.",
        forwardingAction: `${leaf} drops LEAF3 from its VNI ${VNI} flood list.`,
      };
    }
    if (currentStepId === "repair-challenge" && state.repairAttempt?.correct) {
      if (leaf === "LEAF3") {
        return {
          deviceId: leaf,
          stages: TYPE3_CONTROL_STAGES,
          activeStageId: "advertise",
          completedStageIds: ["originate", "attach-rd-rt"],
          lookupType: "BGP EVPN Advertise (Type 3 / IMET)",
          lookupResult: `Export RT corrected to ${state.exportRt.LEAF3}`,
          reason: "LEAF3's export RT corrected back to match — LEAF1 and LEAF2 re-import it.",
          forwardingAction: "LEAF3's Type 3 export RT corrected.",
        };
      }
      return {
        deviceId: leaf,
        stages: TYPE3_CONTROL_STAGES,
        activeStageId: "flood-list-build",
        completedStageIds: ["originate", "attach-rd-rt", "advertise", "receive-peers", "rt-import-check"],
        lookupType: "RT Import Check (Per Peer)",
        lookupResult: `Match — LEAF3 re-added: ${state.floodList[leaf].join(", ")}`,
        reason: "RT matches again — LEAF3 is reinstated in the flood list.",
        forwardingAction: `${leaf} re-adds LEAF3 to its VNI ${VNI} flood list.`,
      };
    }
  }

  if (device === "LEAF1") {
    const base: DeviceProcessingTrace = { deviceId: "LEAF1", ingressInterfaceId: "LEAF1-hosta", egressInterfaceId: "LEAF1-spine1", stages: LEAF1_BUM_STAGES, completedStageIds: [] };
    if (i !== classifyIndex && i !== verifyIndex) return { ...base, completedStageIds: i > classifyIndex ? allIds(LEAF1_BUM_STAGES) : [] };
    return {
      ...base,
      activeStageId: "vxlan-replication",
      completedStageIds: ["access-frame", "determine-vni", "dest-classification", "bum", "vni-flood-list", "remote-vteps"],
      packetBefore: "Broadcast Ethernet frame",
      packetAfter: `${state.floodList.LEAF1.length} VXLAN cop${state.floodList.LEAF1.length === 1 ? "y" : "ies"}`,
      packetBeforeFrames: plainFrames(),
      packetAfterFrames: vxlanFrames("vxlan"),
      lookupType: "Destination Classification / Flood List",
      lookupKey: "Dest MAC FF:FF:FF:FF:FF:FF",
      lookupResult: `BUM → flood list [${state.floodList.LEAF1.join(", ")}]`,
      nextHopId: "SPINE1",
      nextHopLabel: "SPINE1",
      mutations: [{ type: "ENCAPSULATE", detail: `VXLAN VNI ${VNI} — one independent copy per flood-list entry` }],
      reason: "An unresolvable destination MAC means LEAF1 must consult its VNI flood list and replicate — never a single unicast decision. HOST-A still only ever sent one frame.",
    };
  }

  if (device === "SPINE1") {
    const base: DeviceProcessingTrace = { deviceId: "SPINE1", ingressInterfaceId: "SPINE1-leaf1", egressInterfaceId: "SPINE1-leaf2", stages: SPINE1_STAGES, completedStageIds: [] };
    if (i !== spineIndex && i !== verifyIndex) return base;
    return {
      ...base,
      activeStageId: "outer-ip-lookup",
      completedStageIds: ["underlay-ingress"],
      packetBefore: "2 underlay IP/UDP packets",
      packetAfter: "Forwarded independently, per outer dest IP",
      packetBeforeFrames: vxlanFrames(),
      packetAfterFrames: vxlanFrames(),
      lookupType: "Outer IP Lookup (ECMP), Per Packet",
      lookupResult: "Forwarded toward LEAF2 and LEAF3 independently",
      reason: "SPINE1 treats each replica as an unrelated underlay IP packet — it never knows they originated from one frame, and never inspects the inner payload or any tenant MAC.",
    };
  }

  // LEAF2 / LEAF3
  const base: DeviceProcessingTrace = { deviceId: device, ingressInterfaceId: `${device}-spine1`, egressInterfaceId: `${device}-${device === "LEAF2" ? "hostb" : "hostc"}`, stages: LEAF_EGRESS_STAGES, completedStageIds: [] };
  if (i !== decapIndex && i !== verifyIndex) return { ...base, completedStageIds: i > decapIndex ? allIds(LEAF_EGRESS_STAGES) : [] };
  return {
    ...base,
    activeStageId: "vni-lookup",
    completedStageIds: ["vxlan-decap"],
    packetBefore: `VXLAN(VNI ${VNI})`,
    packetAfter: `Original broadcast frame → HOST-${device === "LEAF2" ? "B" : "C"}`,
    packetBeforeFrames: vxlanFrames(),
    packetAfterFrames: plainFrames(),
    lookupType: "VNI → Local Eligible Ports",
    lookupKey: `VNI ${VNI}`,
    lookupResult: `Delivered to HOST-${device === "LEAF2" ? "B" : "C"}`,
    nextHopId: device === "LEAF2" ? "HOST-B" : "HOST-C",
    nextHopLabel: device === "LEAF2" ? "HOST-B" : "HOST-C",
    mutations: [{ type: "DECAPSULATE", detail: `VXLAN VNI ${VNI} removed` }],
    reason: "This copy was addressed specifically to this leaf's own VTEP — decapsulate and deliver locally, exactly like any other VXLAN egress.",
  };
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
