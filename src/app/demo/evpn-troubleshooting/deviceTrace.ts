import { layoutRegionsTo3D, layoutTo3D } from "@/components/network3d/layout";
import type { DeviceInterfaceData, DeviceProcessingTrace, Link3DData, LinkDetail, Node3DData, PacketStackFrame, Region3DData } from "@/components/network3d/types";
import type { EvpnRibRow } from "@/components/protocol/EvpnRouteTable";
import {
  L3_VNI,
  VLAN10,
  VLAN20,
  VNI10010,
  VNI10020,
  VTEP_LOOPBACK,
  type ArenaDeviceId,
  type ArenaLeafId,
  type ArenaState,
} from "@/lib/sim-engine/arena/faultTypes";
import { imetOk, suppressionPresent, type HopStage, type TraceHop } from "./evidence";

/**
 * Arena Scene Adapter (brief §33/§36) — converts ArenaState into
 * Device Explorer tab content. Every value here is an observable
 * fact read straight from ArenaState (routes present, sessions up,
 * MTU values, DF beliefs) — never a conclusion, a fault name, or a
 * root-cause sentence. That analysis only ever appears in the
 * post-incident report, generated separately after resolution.
 */

const ROLE_LABEL: Record<string, string> = { primary: "PRIMARY", backup: "BACKUP", ineligible: "Ineligible" };

export function interfacesFor(state: ArenaState, device: ArenaDeviceId): DeviceInterfaceData[] {
  if (device === "SPINE1") {
    return (["LEAF1", "LEAF2", "LEAF3"] as ArenaLeafId[]).map((l) => ({ id: `spine-${l}`, name: `et-0/0/${l.slice(-1)}`, status: "up", neighborId: l, neighborLabel: l, linkType: "Underlay", mtu: 9216, protocols: ["IGP"], role: "idle" }));
  }
  if (device === "LEAF1" || device === "LEAF2" || device === "LEAF3") {
    const uplink: DeviceInterfaceData = { id: `${device}-spine`, name: "et-0/1/0", status: "up", ip: undefined, neighborId: "SPINE1", neighborLabel: "SPINE1", linkType: "Underlay (Uplink)", mtu: 9216, protocols: ["IGP", "BGP EVPN"], role: "idle", extra: [{ label: "VTEP", value: VTEP_LOOPBACK[device] }, { label: "Session", value: state.bgpEvpnUp[device] ? "Established" : "Down" }] };
    const access: DeviceInterfaceData[] = [];
    if (device === "LEAF1") access.push({ id: "leaf1-hosta", name: "ge-0/0/0", status: "up", neighborId: "HOST-A", neighborLabel: "HOST-A", linkType: `Access (VLAN ${VLAN10})`, mtu: 1500, protocols: ["Ethernet"], role: "idle" });
    if (device === "LEAF1" || device === "LEAF2") access.push({ id: `${device}-servera`, name: "ge-0/0/1", status: state.es.esAttachmentDown === device ? "down" : "up", neighborId: "SERVER-A", neighborLabel: "SERVER-A", linkType: "Access (ESI)", mtu: 1500, protocols: ["Ethernet"], role: "idle" });
    if (device === "LEAF3") access.push({ id: "leaf3-hostb", name: "ge-0/0/0", status: "up", neighborId: "HOST-B", neighborLabel: "HOST-B", linkType: `Access (VLAN ${VLAN10})`, mtu: 1500, protocols: ["Ethernet"], role: "idle" });
    return [uplink, ...access];
  }
  return [];
}

export function esTabRowsFor(state: ArenaState, leaf: ArenaLeafId) {
  if (!state.es.leafs.includes(leaf)) return [{ label: "Ethernet Segment", value: "Not a member" }];
  return [
    { label: "ESI", value: state.es.esi },
    { label: "Leaves", value: state.es.leafs.join(", ") },
    { label: "This leaf believes DF", value: state.es.dualDfBelief[leaf] ? "yes" : "no" },
    { label: "Attachment to SERVER-A", value: state.es.esAttachmentDown === leaf ? "DOWN" : "up" },
  ];
}

export function vpwsTabRowsFor(state: ArenaState, device: ArenaDeviceId) {
  return [
    { label: "Service", value: `VPWS-${state.vpws.serviceId}` },
    { label: "Local AC", value: `VLAN ${VLAN10} (SERVER-A)` },
    { label: "Remote AC / Endpoint", value: `VLAN ${VLAN20} (HOST-B via LEAF3)` },
    { label: "Redundancy Mode", value: "Single-Active" },
    { label: "Primary", value: state.vpws.primaryPe ?? "(none)" },
    { label: "Backup", value: state.vpws.backupPe ?? "(none)" },
    { label: "This device's advertised L2 MTU", value: state.vpws.l2MtuAdvertised[device as ArenaLeafId] !== undefined ? String(state.vpws.l2MtuAdvertised[device as ArenaLeafId]) : "—" },
    { label: "Remote expected L2 MTU", value: String(state.vpws.remoteExpectedMtu) },
    { label: "Status", value: state.vpws.status.toUpperCase() },
  ];
}

export function vrfTabRowsFor(state: ArenaState, leaf: ArenaLeafId) {
  return [
    { label: "VRF", value: "TENANT-A" },
    { label: "L3 VNI", value: String(state.l3VniByLeaf[leaf]) },
    { label: "Expected L3 VNI (fabric-wide)", value: String(L3_VNI) },
    { label: `VNI ${VNI10010} IMET`, value: imetOk(state, leaf, VNI10010) ? "member" : "not a member" },
    { label: `VNI ${VNI10020} IMET`, value: imetOk(state, leaf, VNI10020) ? "member" : "not a member" },
  ];
}

export function suppressionTabRowsFor(state: ArenaState, leaf: ArenaLeafId) {
  return [
    { label: "Target", value: `${state.suppression.targetIp} (${state.suppression.targetMac})` },
    { label: "Local binding present", value: suppressionPresent(state, leaf) ? "yes" : "no" },
  ];
}

// ---------------------------------------------------------------------------
// Shared-3D topology adapter (Level-3 migration) — Node3DData/Link3DData/
// Region3DData/LinkDetail/DeviceProcessingTrace, derived the same way every
// other lesson's deviceTrace.ts does: pure functions of ArenaState (+ here,
// of a learner-run TraceHop[] for Follow Packet — never invented data, and
// never anything the learner hasn't already been shown as plain text by the
// Toolbox/CLI/Packet Trace tools). The fixed fabric layout below is the same
// {x,y} percent space the legacy 2D GraphTopologyViewer already used.
// ---------------------------------------------------------------------------

export const ARENA_NODES: { id: ArenaDeviceId; label: string; x: number; y: number; subLabel?: string; kind: "switch" | "server" }[] = [
  { id: "SPINE1", label: "SPINE1", x: 50, y: 12, subLabel: "Underlay only", kind: "switch" },
  { id: "LEAF1", label: "LEAF1", x: 20, y: 45, subLabel: `VTEP ${VTEP_LOOPBACK.LEAF1}`, kind: "switch" },
  { id: "LEAF2", label: "LEAF2", x: 50, y: 45, subLabel: `VTEP ${VTEP_LOOPBACK.LEAF2}`, kind: "switch" },
  { id: "LEAF3", label: "LEAF3", x: 80, y: 45, subLabel: `VTEP ${VTEP_LOOPBACK.LEAF3}`, kind: "switch" },
  { id: "HOST-A", label: "HOST-A", x: 10, y: 80, kind: "server" },
  { id: "SERVER-A", label: "SERVER-A", x: 35, y: 80, subLabel: "Dual-Homed (ESI)", kind: "server" },
  { id: "HOST-B", label: "HOST-B", x: 80, y: 80, kind: "server" },
];

export const ARENA_EDGES: { id: string; a: ArenaDeviceId; b: ArenaDeviceId; label?: string }[] = [
  { id: "spine-leaf1", a: "SPINE1", b: "LEAF1" },
  { id: "spine-leaf2", a: "SPINE1", b: "LEAF2" },
  { id: "spine-leaf3", a: "SPINE1", b: "LEAF3" },
  { id: "leaf1-hosta", a: "LEAF1", b: "HOST-A" },
  { id: "leaf1-servera", a: "LEAF1", b: "SERVER-A", label: "ESI" },
  { id: "leaf2-servera", a: "LEAF2", b: "SERVER-A", label: "ESI" },
  { id: "leaf3-hostb", a: "LEAF3", b: "HOST-B" },
];

function isLeafDevice(id: ArenaDeviceId): id is ArenaLeafId {
  return id === "LEAF1" || id === "LEAF2" || id === "LEAF3";
}

/**
 * Node/link positions only — deliberately carries NO live fault state (no
 * "this leaf is broken" badge, no failed-link coloring). The legacy 2D view
 * never showed that either for anything except a since-removed ES-attachment
 * subLabel; this migration does not introduce an at-a-glance fault reveal in
 * either view (brief §4/§7: the topology is an evidence tool, not an
 * answer-reveal tool).
 */
export function nodesFor(): Node3DData[] {
  return layoutTo3D(ARENA_NODES);
}

export function regionsFor(): Region3DData[] {
  return layoutRegionsTo3D([{ id: "underlay-fabric", label: "Underlay Fabric", x: 8, y: 2, width: 84, height: 55, tone: "cyan" }]).map((r) => ({ ...r, subLabel: "SPINE1 + LEAF1-3" }));
}

function edgeKey(a: string, b: string): string {
  return [a, b].sort().join("|");
}

/**
 * `flow` is the currently-inspected Follow-Packet run (brief §17/§18) — a
 * frozen `TraceHop[]` already produced by `runPacketTrace` for a test the
 * learner explicitly ran. `upToIndex` lets the timeline scrub without
 * revealing hops past whatever the learner has stepped to.
 */
export function linksFor(flow?: { from: string; hops: TraceHop[] }, upToIndex?: number): Link3DData[] {
  const seq: string[] = [];
  if (flow) {
    if (ARENA_NODES.some((n) => n.id === flow.from)) seq.push(flow.from);
    const upTo = upToIndex ?? flow.hops.length - 1;
    flow.hops.slice(0, upTo + 1).forEach((h) => {
      if (h.deviceId && seq[seq.length - 1] !== h.deviceId) seq.push(h.deviceId);
    });
  }
  const onPathKeys = new Set<string>();
  for (let i = 0; i < seq.length - 1; i++) onPathKeys.add(edgeKey(seq[i], seq[i + 1]));
  return ARENA_EDGES.map((e) => ({ id: e.id, a: e.a, b: e.b, label: e.label, onPath: onPathKeys.has(edgeKey(e.a, e.b)) }));
}

export function linkDetailFor(linkId: string, state: ArenaState): LinkDetail | undefined {
  const edge = ARENA_EDGES.find((e) => e.id === linkId);
  if (!edge) return undefined;
  const endHostIface = (deviceId: ArenaDeviceId, neighborId: ArenaDeviceId): DeviceInterfaceData => ({ id: `${deviceId}-nic`, name: "eth0", status: "up", neighborId, neighborLabel: neighborId, role: "idle" });
  const ifaceFor = (deviceId: ArenaDeviceId, neighborId: ArenaDeviceId): DeviceInterfaceData =>
    isLeafDevice(deviceId) || deviceId === "SPINE1" ? (interfacesFor(state, deviceId).find((i) => i.neighborId === neighborId) ?? endHostIface(deviceId, neighborId)) : endHostIface(deviceId, neighborId);
  const aInterface = ifaceFor(edge.a, edge.b);
  const bInterface = ifaceFor(edge.b, edge.a);
  const status: "up" | "down" = aInterface.status === "down" || bInterface.status === "down" ? "down" : "up";
  const protocols: { label: string; value: string }[] = [];
  if (edge.a === "SPINE1" || edge.b === "SPINE1") protocols.push({ label: "Underlay", value: "IGP" }, { label: "Overlay", value: "BGP EVPN" });
  if (edge.label === "ESI") protocols.push({ label: "Multihoming", value: `ESI ${state.es.esi.slice(-8)}` });
  if (protocols.length === 0) protocols.push({ label: "Access", value: "Ethernet" });
  return { aLabel: edge.a, bLabel: edge.b, aInterface, bInterface, status, mtu: aInterface.mtu ?? bInterface.mtu, protocols };
}

const LEAF_PIPELINE_STAGES: { id: HopStage; label: string; detail?: string }[] = [
  { id: "ingress", label: "Ingress", detail: "Frame received from a local host or ES-facing access port." },
  { id: "fwd-decision", label: "Forwarding Decision", detail: "EVPN RIB / MAC lookup, RT import check, aliasing/mobility next-hop selection." },
  { id: "encap-decap", label: "VXLAN Encap / Decap", detail: "Adds or removes the VXLAN + outer IP/UDP header." },
  { id: "egress", label: "Egress", detail: "Delivered to the local host, or forwarded toward the underlay." },
];
const SPINE_PIPELINE_STAGES: { id: HopStage; label: string; detail?: string }[] = [
  { id: "replicate", label: "Underlay Forward / Replicate", detail: "IP-forwards unicast VXLAN traffic, or replicates BUM traffic to every flood-list member." },
];

export function pipelineTitleFor(deviceId: ArenaDeviceId): string {
  return isLeafDevice(deviceId) ? "Conceptual EVPN/VXLAN Forwarding Pipeline" : "Conceptual Underlay Forwarding Pipeline";
}

/** Idle trace shown for an entered device with no hop currently selected — every stage present, none active/completed (brief: never fabricate an active stage). */
export function idleTraceFor(deviceId: ArenaDeviceId): DeviceProcessingTrace | undefined {
  if (!isLeafDevice(deviceId) && deviceId !== "SPINE1") return undefined;
  return { deviceId, stages: isLeafDevice(deviceId) ? LEAF_PIPELINE_STAGES : SPINE_PIPELINE_STAGES, completedStageIds: [] };
}

/**
 * A specific hop's DeviceProcessingTrace, for the Hop Inspector (brief §17
 * "Processing Inspection"). Every field is read straight off the hop object
 * `runPacketTrace` already produced — this function performs no new
 * networking decision, it only reshapes an already-computed, already-frozen
 * fact into the generic `DeviceProcessingTrace` contract shared components
 * expect.
 */
export function traceForHop(hops: TraceHop[], index: number): DeviceProcessingTrace | undefined {
  const hop = hops[index];
  if (!hop?.deviceId) return undefined;
  const stageDefs = isLeafDevice(hop.deviceId) ? LEAF_PIPELINE_STAGES : SPINE_PIPELINE_STAGES;
  const completedStageIds = Array.from(new Set(hops.slice(0, index).filter((h) => h.deviceId === hop.deviceId && h.stage).map((h) => h.stage as string)));
  return {
    deviceId: hop.deviceId,
    stages: stageDefs,
    activeStageId: hop.stage,
    completedStageIds,
    lookupType: hop.lookupType,
    lookupKey: hop.lookupKey,
    lookupResult: hop.lookupResult,
    reason: hop.reason,
    forwardingAction: hop.ok ? undefined : "Dropped / not delivered",
  };
}

/**
 * Before/after packet-stack frames for a hop's own VXLAN encap/decap stage
 * only (brief §26/§43 anti-fake-data — every other hop has no packet
 * mutation to show, so this returns undefined rather than an invented
 * diff). Reuses the same VNI the rest of the scenario already computed.
 */
export function packetFramesForHop(hop: TraceHop): { before: PacketStackFrame[]; after: PacketStackFrame[] } | undefined {
  if (hop.stage !== "encap-decap") return undefined;
  const inner: PacketStackFrame = { id: "inner", text: "Inner Ethernet + IP (original frame)", tone: "ip" };
  const vxlan: PacketStackFrame = { id: "vxlan", text: `VXLAN Header — VNI ${VNI10010}`, tone: "vpn", justChanged: true };
  const outer: PacketStackFrame = { id: "outer", text: "Outer IP/UDP (VTEP → VTEP)", tone: "transport", justChanged: true };
  const isEncap = hop.label.toLowerCase().includes("encapsulation");
  if (isEncap) return { before: [inner], after: [{ ...outer }, { ...vxlan }, { ...inner, justChanged: false }] };
  return { before: [{ ...outer }, { ...vxlan }, { ...inner, justChanged: false }], after: [{ ...inner, justChanged: true }] };
}

export function evpnRibRowsFor(state: ArenaState, device: ArenaDeviceId): EvpnRibRow[] {
  const rows: EvpnRibRow[] = [];
  state.type2Routes.forEach((r) => rows.push({ routeType: "2", summary: `${r.mac} / ${r.ip}`, nextHop: r.originLeaf, rd: r.rd, rt: r.rt, extra: r.rtMatchesLocally ? undefined : [{ label: "Import", value: "NOT MATCHED" }] }));
  if (device === "LEAF1" || device === "LEAF2" || device === "LEAF3") {
    rows.push({ routeType: "3", summary: `VNI ${VNI10010} membership`, nextHop: imetOk(state, device, VNI10010) ? "member" : "not a member" });
  }
  rows.push({ routeType: "5", summary: state.type5.prefix, nextHop: state.type5.nextHopVtep, extra: [{ label: "Next hop", value: state.type5.nextHopReachable ? "resolved" : "UNRESOLVED" }] });
  if (device === "LEAF1" || device === "LEAF2") {
    rows.push({ routeType: "1", subKind: "PER EVI", summary: `VPWS-${state.vpws.serviceId}`, nextHop: device, extra: [{ label: "Role", value: ROLE_LABEL[state.vpws.primaryPe === device ? "primary" : state.vpws.backupPe === device ? "backup" : "ineligible"] }] });
    rows.push({ routeType: "4", summary: `ESI ${state.es.esi.slice(-8)}`, nextHop: device });
  }
  return rows;
}
