import type { DeviceInterfaceData, DeviceProcessingTrace, LinkDetail, PacketMutation, PacketStackFrame, ProcessingStage } from "@/components/network3d/types";
import type { EvpnRibRow } from "@/components/protocol/EvpnRouteTable";
import {
  HOST_A_IP,
  HOST_A_MAC,
  VLAN,
  VNI,
  VTEP_LOOPBACK,
  evpnMobilitySteps,
  physicalEdgesFor,
  type EvpnMobilityDeviceId,
  type EvpnMobilityState,
  type JourneyHop,
  type LeafId,
  type MobilityAction,
} from "@/lib/sim-engine/scenarios/evpnMacMobility";

/**
 * Scene Adapter for EVPN MAC Mobility — mirrors the shape of the
 * earlier EVPN lessons' deviceTrace.ts files (evpn-irb/evpn-bum). No
 * mobility-comparison rule lives here — every Level-3 field below is
 * re-described FROM EvpnMobilityState (mostly straight off the
 * scenario's own `JourneyHop`/`Type2Route` records), never invented.
 */

const stepIndex = (id: string) => evpnMobilitySteps.findIndex((s) => s.id === id);

/** Steps where a leaf's bridging/delivering JourneyHop is actually the thing happening RIGHT NOW — outside these, the last-recorded hop is history, not an active device. */
const JOURNEY_STEP_IDS = new Set(["send-before-move", "before-move-journey", "send-after-move", "after-move-journey", "verify-dataplane"]);

// ---------------------------------------------------------------------------
// Conceptual pipelines for the two signature device moments.
// ---------------------------------------------------------------------------

const LEAF_INITIAL_LOCAL_LEARN_STAGES: ProcessingStage[] = [
  { id: "access-event", label: "Access Port Event" },
  { id: "vlan10", label: `VLAN ${VLAN}` },
  { id: "src-mac", label: "Source MAC Learned" },
  { id: "src-ip", label: "Source IP Association" },
  { id: "now-local", label: "Endpoint Now Local" },
  { id: "gen-route", label: "Generate Type-2 Route (Sequence 0)" },
];
const LEAF_MOVED_LOCAL_LEARN_STAGES: ProcessingStage[] = [
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

function plainFrames(): PacketStackFrame[] {
  return [
    { id: "ethernet", text: "Ethernet", tone: "generic" },
    { id: "ip", text: "IP", tone: "ip" },
  ];
}
function vxlanFrames(justChanged = false): PacketStackFrame[] {
  return [
    { id: "outer-eth", text: "Outer Ethernet", tone: "transport" },
    { id: "outer-ip", text: "Outer IP", tone: "transport" },
    { id: "udp", text: "UDP 4789", tone: "transport" },
    { id: "vxlan", text: `VXLAN VNI ${VNI}`, tone: "vpn", justChanged },
    { id: "inner", text: "Original Ethernet Frame", tone: "generic" },
  ];
}

// ---------------------------------------------------------------------------
// Generic journey-hop → Level-3 field mapping — every value below comes
// straight off the scenario's own JourneyHop (input/lookup/action/output),
// never a new domain decision (LESSON-BLUEPRINT.md "enrich an existing
// adapter" rule).
// ---------------------------------------------------------------------------

const ACTION_LOOKUP_TYPE: Record<MobilityAction, string> = {
  L2_BRIDGE: "MAC Table → Selected Remote VTEP",
  UNDERLAY_FORWARD: "Underlay Route Lookup",
  L2_DELIVER: "Local MAC → Access Port",
};
const ACTION_REASON: Record<MobilityAction, string> = {
  L2_BRIDGE: "No local entry for this MAC — it's reached via the currently SELECTED remote VTEP, so the frame is VXLAN-encapsulated toward it.",
  UNDERLAY_FORWARD: "The spine has no MAC table and no EVPN/mobility state at all — it forwards strictly on the outer underlay destination IP.",
  L2_DELIVER: "The destination MAC matches a locally-learned access-port entry — VXLAN is removed and the original frame is delivered.",
};

interface IfacePair {
  ingressInterfaceId?: string;
  egressInterfaceId?: string;
}
function ifacePairFor(device: "LEAF1" | "SPINE1" | "LEAF2" | "LEAF3", destLeaf: LeafId | undefined): IfacePair {
  if (device === "LEAF3") return { ingressInterfaceId: "LEAF3-hostb", egressInterfaceId: "LEAF3-spine1" };
  if (device === "SPINE1") return { ingressInterfaceId: "SPINE1-leaf3", egressInterfaceId: destLeaf === "LEAF2" ? "SPINE1-leaf2" : "SPINE1-leaf1" };
  if (device === "LEAF1") return { ingressInterfaceId: "LEAF1-spine1", egressInterfaceId: "LEAF1-hosta" };
  return { ingressInterfaceId: "LEAF2-spine1", egressInterfaceId: "LEAF2-hosta" };
}

function hopToTrace(device: "LEAF1" | "SPINE1" | "LEAF2" | "LEAF3", hop: JourneyHop, journey: JourneyHop[], stages: ProcessingStage[]): DeviceProcessingTrace {
  const idx = journey.indexOf(hop);
  const nextHop = journey[idx + 1];
  const destLeaf = journey.find((h) => h.device === "LEAF1" || h.device === "LEAF2")?.device as LeafId | undefined;
  const nextHopId = hop.action === "L2_DELIVER" ? "HOST-A" : nextHop?.device;
  const isEncap = hop.action === "L2_BRIDGE";
  const isDecap = hop.action === "L2_DELIVER";
  const mutations: PacketMutation[] | undefined = isEncap
    ? [{ type: "ENCAPSULATE", detail: `VXLAN VNI ${VNI}` }]
    : isDecap
      ? [{ type: "DECAPSULATE", detail: `VXLAN VNI ${VNI} removed` }]
      : undefined;
  return {
    deviceId: device,
    ...ifacePairFor(device, destLeaf),
    stages,
    activeStageId: "l2-vni",
    completedStageIds: allIds(stages),
    packetBefore: hop.input,
    packetAfter: hop.output,
    packetBeforeFrames: isEncap ? plainFrames() : vxlanFrames(),
    packetAfterFrames: isDecap ? plainFrames() : vxlanFrames(isEncap),
    lookupType: ACTION_LOOKUP_TYPE[hop.action],
    lookupKey: hop.lookup,
    lookupResult: hop.output,
    nextHopId,
    nextHopLabel: nextHopId,
    reason: ACTION_REASON[hop.action],
    mutations,
  };
}

export function traceFor(device: "LEAF1" | "SPINE1" | "LEAF2" | "LEAF3", state: EvpnMobilityState, currentStepId: string): DeviceProcessingTrace {
  const i = stepIndex(currentStepId);
  const journeyHop = state.journey.find((h) => h.device === device);
  const isCurrentActor = journeyHop === state.journey[state.journey.length - 1];

  if (device === "SPINE1") {
    if (JOURNEY_STEP_IDS.has(currentStepId) && journeyHop && isCurrentActor) return hopToTrace("SPINE1", journeyHop, state.journey, SPINE1_STAGES);
    return { deviceId: "SPINE1", stages: SPINE1_STAGES, completedStageIds: journeyHop ? allIds(SPINE1_STAGES) : [] };
  }

  const localLearnIndex = stepIndex("leaf1-local-learn");
  const type2Seq0Index = stepIndex("type2-seq0-advertised");
  const enterLeaf2Index = stepIndex("enter-leaf2-local-learn");
  const type2Seq1Index = stepIndex("type2-seq1-advertised");
  const mobilityUpdateIndex = stepIndex("enter-leaf3-mobility-update");
  const faultIndex = stepIndex("fault-injected");
  const repairIndex = stepIndex("repair-challenge");
  const secondMoveIndex = stepIndex("second-move-optional");

  // LEAF1's very first local learn (sequence 0) — no packet, a genuine access-port event.
  if (device === "LEAF1" && (i === localLearnIndex || i === type2Seq0Index)) {
    const route = state.hostARoutes[0];
    return {
      deviceId: "LEAF1",
      ingressInterfaceId: "LEAF1-hosta",
      stages: LEAF_INITIAL_LOCAL_LEARN_STAGES,
      activeStageId: "gen-route",
      completedStageIds: i === type2Seq0Index ? allIds(LEAF_INITIAL_LOCAL_LEARN_STAGES) : ["access-event", "vlan10", "src-mac", "src-ip", "now-local"],
      lookupType: "Local MAC Learning",
      lookupKey: HOST_A_MAC,
      lookupResult: i === type2Seq0Index && route ? `Type-2 route generated and advertised — MAC ${route.mac}, sequence ${route.mobilitySeq}` : "First time seen locally — no prior EVPN entry exists for this MAC",
      packetBefore: "No prior EVPN entry",
      packetAfter: route ? `Type-2 advertised — sequence ${route.mobilitySeq}` : undefined,
      reason: "The very first advertisement for any endpoint always starts at mobility sequence 0 — there's nothing to compare against yet.",
    };
  }

  // LEAF2's signature "moved-into" local learn.
  if (device === "LEAF2" && i === enterLeaf2Index) {
    return {
      deviceId: "LEAF2",
      ingressInterfaceId: "LEAF2-hosta",
      stages: LEAF_MOVED_LOCAL_LEARN_STAGES,
      activeStageId: "gen-route",
      completedStageIds: ["access-event", "vlan10", "src-mac", "src-ip", "existing-remote", "now-local"],
      lookupType: "Local MAC Learning + Existing Remote Check",
      lookupKey: HOST_A_MAC,
      lookupResult: "Existing remote EVPN entry found for this MAC (via LEAF1, sequence 0) — endpoint is now local here",
      packetBefore: "Remote entry: sequence 0 via LEAF1",
      packetAfter: "Local — will generate a newer Type-2 route",
      reason: "LEAF2 already has a remote entry for this exact MAC from the earlier Type-2 advertisement — seeing it locally now means the endpoint moved, not that it's a duplicate.",
    };
  }
  if (device === "LEAF2" && i === type2Seq1Index) {
    const route = state.hostARoutes[1];
    return {
      deviceId: "LEAF2",
      ingressInterfaceId: "LEAF2-hosta",
      stages: LEAF_MOVED_LOCAL_LEARN_STAGES,
      activeStageId: "gen-route",
      completedStageIds: allIds(LEAF_MOVED_LOCAL_LEARN_STAGES),
      lookupType: "Type-2 Advertisement",
      lookupKey: HOST_A_MAC,
      lookupResult: route ? `Advertised — MAC ${route.mac}, sequence ${route.mobilitySeq}, next-hop ${route.nextHop}` : undefined,
      packetBefore: "Local, not yet advertised",
      packetAfter: route ? `Advertised — sequence ${route.mobilitySeq}` : undefined,
      reason: "Same BGP UPDATE mechanism as the very first advertisement — only the mobility sequence and next-hop actually differ.",
    };
  }

  // LEAF3's signature mobility-update moment.
  if (device === "LEAF3" && i === mobilityUpdateIndex) {
    const oldRoute = state.hostARoutes[0];
    const newRoute = state.hostARoutes[1];
    return {
      deviceId: "LEAF3",
      ingressInterfaceId: "LEAF3-spine1",
      stages: LEAF_MOBILITY_UPDATE_STAGES,
      activeStageId: "state-updated",
      completedStageIds: ["bgp-update", "route-type-2", "mac-ip-identity", "existing-route", "compare-seq", "newer-selected", "vtep-changed"],
      lookupType: "Mobility Sequence Comparison",
      lookupKey: `${HOST_A_MAC} — existing sequence ${oldRoute?.mobilitySeq ?? 0} (${oldRoute?.originLeaf}) vs. received sequence ${newRoute?.mobilitySeq ?? 1} (${newRoute?.originLeaf})`,
      lookupResult: `Sequence ${newRoute?.mobilitySeq} > ${oldRoute?.mobilitySeq} — newer advertisement selected`,
      nextHopId: newRoute?.originLeaf,
      nextHopLabel: newRoute?.originLeaf,
      packetBefore: oldRoute ? `Selected: sequence ${oldRoute.mobilitySeq} via ${oldRoute.originLeaf}` : undefined,
      packetAfter: newRoute ? `Selected: sequence ${newRoute.mobilitySeq} via ${newRoute.originLeaf}` : undefined,
      reason: "MAC Mobility comparison: a strictly higher sequence number identifies the newer advertisement for the same MAC/IP identity — never a packet-hop count, never a timestamp.",
    };
  }

  // LEAF3's comparison FAILING (the fault) and being repaired.
  if (device === "LEAF3" && (i === faultIndex || i === repairIndex)) {
    const stale = state.selectedRouteByLeaf.LEAF3;
    const failed = i === faultIndex || (i === repairIndex && !state.challengeSucceeded);
    return {
      deviceId: "LEAF3",
      ingressInterfaceId: "LEAF3-spine1",
      stages: LEAF_MOBILITY_UPDATE_STAGES,
      activeStageId: failed ? "compare-seq" : "state-updated",
      completedStageIds: failed ? ["bgp-update", "route-type-2", "mac-ip-identity", "existing-route"] : allIds(LEAF_MOBILITY_UPDATE_STAGES),
      lookupType: failed ? "Mobility Sequence Comparison (NOT APPLIED)" : "Mobility Sequence Comparison (Repaired)",
      lookupKey: `${HOST_A_MAC} — received sequence 1 (LEAF2)`,
      lookupResult: failed ? "Comparison logic did not act on the newer route — kept sequence 0 / LEAF1" : "Comparison re-applied — sequence 1 / LEAF2 now selected",
      packetBefore: "Received: sequence 1 via LEAF2",
      packetAfter: failed ? `Still selected: sequence ${stale?.mobilitySeq ?? 0} via ${stale?.originLeaf ?? "LEAF1"} (STALE)` : `Selected: sequence ${stale?.mobilitySeq} via ${stale?.originLeaf}`,
      reason: failed ? "The newer route arrived and was received correctly; LEAF3's own selection logic simply failed to replace the older entry. Receiving a route is not the same as selecting it." : "LEAF3's mobility comparison was re-run against every route it has on file, correctly selecting the highest sequence.",
    };
  }

  // The optional second move — a compressed recap of local-learn + advertise + remote update.
  if (device === "LEAF1" && i === secondMoveIndex) {
    const route = state.hostARoutes[state.hostARoutes.length - 1];
    return {
      deviceId: "LEAF1",
      ingressInterfaceId: "LEAF1-hosta",
      stages: LEAF_MOVED_LOCAL_LEARN_STAGES,
      activeStageId: "gen-route",
      completedStageIds: allIds(LEAF_MOVED_LOCAL_LEARN_STAGES),
      lookupType: "Local MAC Learning + Mobility Advertisement",
      lookupKey: HOST_A_MAC,
      lookupResult: route ? `Advertised — sequence ${route.mobilitySeq}, same mechanism as every earlier move` : undefined,
      packetBefore: "Remote entry: sequence 1 via LEAF2",
      packetAfter: route ? `Local — advertised sequence ${route.mobilitySeq}` : undefined,
      reason: "The exact same local-learn → generate → advertise sequence as the very first move — proving this isn't a one-time special case.",
    };
  }

  // Any leaf mid-journey (bridging out or delivering in) — fields lifted straight off the real JourneyHop.
  // Restricted to the actual data-plane journey steps: a hop stays "the last one recorded" for many
  // steps afterward (e.g. LEAF2's own local-learn moment), and must NOT keep showing as "active" once
  // the narrative has moved on to a different device's own signature moment.
  const journeyActiveNow = JOURNEY_STEP_IDS.has(currentStepId) && journeyHop && isCurrentActor;
  if (journeyActiveNow && (device === "LEAF1" || device === "LEAF2" || device === "LEAF3")) {
    return hopToTrace(device, journeyHop, state.journey, IDLE_BRIDGE_STAGES);
  }

  // Idle.
  return { deviceId: device, stages: IDLE_BRIDGE_STAGES, completedStageIds: journeyHop ? allIds(IDLE_BRIDGE_STAGES) : [] };
}

export function packetFramesFor(state: EvpnMobilityState): PacketStackFrame[] | undefined {
  if (!state.packet) return undefined;
  if (!state.packet.encapsulated) return plainFrames();
  return vxlanFrames(true);
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
      role: processing && def.id === trace.ingressInterfaceId ? "ingress" : processing && def.id === trace.egressInterfaceId ? "egress" : "idle",
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
  const edge = physicalEdgesFor(state.hostALocation).find((e) => e.id === linkId);
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
