import type { NodeExplanation } from "@/components/network3d/types";
import {
  PE_ROUTERS,
  MTU_NODES,
  SERVICE_NAME,
  fdbFor,
  bridgePortsFor,
  portLabel,
  pwPeersOf,
  pwUpBetween,
  allocatePwReceiveLabel,
  allocateSpokeReceiveLabel,
  spokePairFor,
  peSpokePair,
  resolveAttachmentCircuits,
  spokeUp,
  type HvplsState,
  type RouterId,
  type PeId,
  type MtuId,
} from "@/lib/sim-engine/scenarios/hVpls";

/**
 * All H-VPLS-specific reasoning for the 3D node inspector lives here,
 * not in network3d/*. Every sentence derives from live HvplsState —
 * never leaking a fault/repair before it has actually happened in the
 * journey, and never overstating what a given tier (MTU-s vs. PE-rs)
 * actually does.
 */

const DEVICE_TYPE: Partial<Record<RouterId, string>> = {
  CE1: "Customer Edge",
  CE2: "Customer Edge",
  CE3: "Customer Edge",
  CE4: "Customer Edge",
  MTU1: "MTU-s (Access Bridge)",
  MTU2: "MTU-s (Access Bridge)",
  MTU3: "MTU-s (Access Bridge)",
  PE1: "PE-rs (Core VPLS Hub)",
  PE2: "PE-rs (Core VPLS Hub)",
  PE3: "PE-rs (Core VPLS Hub)",
};
const ROLE: Partial<Record<RouterId, string>> = {
  CE1: "Customer Ethernet device — no idea a provider network exists",
  CE2: "Customer Ethernet device — no idea a provider network exists",
  CE3: "Customer Ethernet device — no idea a provider network exists",
  CE4: "Customer Ethernet device — no idea a provider network exists",
  MTU1: "Access-tier bridge — owns local ACs plus exactly one spoke pseudowire to its PE-rs hub. Never joins the core mesh.",
  MTU2: "Access-tier bridge — owns local ACs plus exactly one spoke pseudowire to its PE-rs hub. Never joins the core mesh.",
  MTU3: "Access-tier bridge — owns local ACs plus exactly one spoke pseudowire to its PE-rs hub. Never joins the core mesh.",
  PE1: "Core VPLS hub — full-meshed with other PE-rs nodes, and aggregates one spoke pseudowire from its attached MTU-s.",
  PE2: "Core VPLS hub — full-meshed with other PE-rs nodes, and aggregates one spoke pseudowire from its attached MTU-s.",
  PE3: "Core VPLS hub — full-meshed with other PE-rs nodes, and aggregates one spoke pseudowire from its attached MTU-s.",
};

export function explainNode(state: HvplsState, nodeId: RouterId): NodeExplanation {
  const hops = state.journey.filter((h) => h.device === nodeId);
  const hop = hops[hops.length - 1];
  const base: NodeExplanation = { id: nodeId, name: nodeId, deviceType: DEVICE_TYPE[nodeId] ?? nodeId, role: ROLE[nodeId] ?? "", currentAction: "" };

  if (MTU_NODES.includes(nodeId as MtuId)) {
    const mtu = nodeId as MtuId;
    const acs = resolveAttachmentCircuits(state.acs, mtu);
    const fdb = fdbFor(state, mtu);
    const pair = spokePairFor(mtu);
    const currentAction = hop ? `${hop.lookup} → ${hop.action}.` : `Idle. ${acs.length} local AC(s). Spoke ${pair.id}: ${spokeUp(state.spokeLinks, mtu) ? "UP" : "DOWN"}. FDB has ${fdb.length} entr${fdb.length === 1 ? "y" : "ies"}.`;
    const portsTable = { title: "Bridge Ports", rows: bridgePortsFor(state, mtu).map((p) => ({ label: p.kind, value: p.peer })) };
    const fdbTable = { title: "MAC / FDB Table", rows: fdb.length ? fdb.map((e) => ({ label: e.mac, value: portLabel(e.port) })) : [{ label: "(empty)", value: "no entries learned yet" }] };
    return {
      ...base,
      controlPlaneRole: `Signals exactly one spoke pseudowire — ${pair.id} — via the same LDP-style directional labeling every prior lesson used. No core-mesh membership.`,
      dataPlaneRole: "Learns source MACs on every ingress port (AC or its one spoke) and forwards using ordinary Ethernet bridging rules — including fully local delivery between two ACs once both are known.",
      currentAction,
      packetBefore: hop?.input,
      packetAfter: hop?.output,
      tables: [portsTable, fdbTable],
    };
  }

  if (PE_ROUTERS.includes(nodeId as PeId)) {
    const pe = nodeId as PeId;
    const fdb = fdbFor(state, pe);
    const meshPeers = pwPeersOf(pe);
    const pair = peSpokePair(pe);
    const currentAction = hop ? `${hop.lookup} → ${hop.action}.` : `Idle. Spoke ${pair.id} classified as ${state.spokeRoleByPe[pe]}. ${meshPeers.length} mesh peer(s). FDB has ${fdb.length} entr${fdb.length === 1 ? "y" : "ies"}.`;
    const meshTable = { title: "Core Mesh", rows: meshPeers.map((peer) => ({ label: `MESH_PW to ${peer}`, value: `${pwUpBetween(state.meshLinks, pe, peer) ? "UP" : "DOWN"} — local ${allocatePwReceiveLabel(pe, peer)} / remote ${allocatePwReceiveLabel(peer, pe)}` })) };
    const spokeTable = { title: "Spoke", rows: [{ label: `Toward ${pair.mtu}`, value: `classified ${state.spokeRoleByPe[pe]}, ${spokeUp(state.spokeLinks, pair.mtu) ? "UP" : "DOWN"} — local ${allocateSpokeReceiveLabel(pe, pair.mtu)} / remote ${allocateSpokeReceiveLabel(pair.mtu, pe)}` }] };
    const fdbTable = { title: "MAC / FDB Table", rows: fdb.length ? fdb.map((e) => ({ label: e.mac, value: portLabel(e.port) })) : [{ label: "(empty)", value: "no entries learned yet" }] };
    return {
      ...base,
      controlPlaneRole: `Signals ${meshPeers.length} core mesh pseudowire(s) (identical mechanism to flat VPLS) plus one spoke toward ${pair.mtu} — ${SERVICE_NAME} service, shared identity across the whole hierarchy.`,
      dataPlaneRole: "Learns source MACs on its spoke and mesh ports alike; replicates BUM traffic to every eligible port except ingress; blocks mesh-to-mesh relay only — spoke traffic may freely cross onto the mesh and back.",
      currentAction,
      packetBefore: hop?.input,
      packetAfter: hop?.output,
      tables: [spokeTable, meshTable, fdbTable],
    };
  }

  const currentAction = hop ? `${hop.lookup} → ${hop.action}.` : "Idle — an ordinary Ethernet device, unaware any MPLS provider network exists.";
  return { ...base, controlPlaneRole: "None — CE devices are outside the provider's MPLS control plane entirely.", dataPlaneRole: "Sends and receives ordinary Ethernet frames on its attachment circuit; silently discards frames not addressed to it.", currentAction, packetBefore: hop?.input, packetAfter: hop?.output };
}

export function bridgePortsSummary(state: HvplsState, router: RouterId): string {
  if (!MTU_NODES.includes(router as MtuId) && !PE_ROUTERS.includes(router as PeId)) return "—";
  return bridgePortsFor(state, router as MtuId | PeId).map(portLabel).join(", ") || "(no active ports)";
}
