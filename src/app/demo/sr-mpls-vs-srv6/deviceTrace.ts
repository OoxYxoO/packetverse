import type { DeviceInterfaceData, DeviceProcessingTrace, LinkDetail, PacketStackFrame, ProcessingStage } from "@/components/network3d/types";
import {
  GRAPH_EDGES,
  INFRA_ADDRESS,
  endSidText,
  nodeSidLabel,
  type Architecture,
  type CapstoneState,
  type RouterId,
} from "@/lib/sim-engine/scenarios/srMplsVsSrv6";
import { fmtIpv6 } from "@/lib/sim-engine/scenarios/srv6Foundations";

/**
 * Scene Adapter for the SR-MPLS vs SRv6 capstone's device-interior 3D
 * view (ARCHITECTURE.md §4). Every stage/interface/link-detail value is
 * derived from CapstoneState + the currently active architecture — no
 * TI-LFA/VPN/policy decision is made here, only presentation of what
 * the scenario file already computed.
 */

const MPLS_TRANSIT_STAGES: ProcessingStage[] = [
  { id: "ingress", label: "Ingress" },
  { id: "lfib-lookup", label: "LFIB Lookup" },
  { id: "label-op", label: "Label Operation (SWAP/PHP)" },
  { id: "egress", label: "Egress" },
];
const SRV6_TRANSIT_STAGES: ProcessingStage[] = [
  { id: "ingress", label: "Ingress" },
  { id: "ipv6-fib", label: "Ordinary IPv6 FIB Lookup" },
  { id: "egress", label: "Egress" },
];
const MPLS_HEADEND_STAGES: ProcessingStage[] = [
  { id: "vrf-lookup", label: "VRF Route Lookup" },
  { id: "push-vpn", label: "Push VPN Label" },
  { id: "push-transport", label: "Push Transport Label" },
  { id: "egress", label: "Egress" },
];
const SRV6_HEADEND_STAGES: ProcessingStage[] = [
  { id: "vrf-lookup", label: "VRF Route Lookup" },
  { id: "set-da", label: "Set Outer IPv6 DA (Service/End SID)" },
  { id: "egress", label: "Egress" },
];
const MPLS_EGRESS_STAGES: ProcessingStage[] = [
  { id: "ingress", label: "Ingress" },
  { id: "php-or-pop", label: "PHP / Pop Transport Label" },
  { id: "vpn-label-lookup", label: "VPN Label → VRF Context" },
  { id: "deliver", label: "Deliver to CE" },
];
const SRV6_EGRESS_STAGES: ProcessingStage[] = [
  { id: "ingress", label: "Ingress" },
  { id: "local-sid-match", label: "Local SID Table Match" },
  { id: "end-dt4-decap", label: "End.DT4: Decapsulate + VRF Lookup" },
  { id: "deliver", label: "Deliver to CE" },
];
const MPLS_PLR_STAGES: ProcessingStage[] = [
  { id: "ingress", label: "Ingress" },
  { id: "failure-check", label: "Protected Resource Down" },
  { id: "repair-push", label: "Push Repair Label(s)" },
  { id: "egress", label: "Egress (Repair OIF)" },
];
const SRV6_PLR_STAGES: ProcessingStage[] = [
  { id: "ingress", label: "Ingress" },
  { id: "failure-check", label: "Protected Resource Down" },
  { id: "repair-encaps", label: "H.Encaps Repair SID (End.X+USD)" },
  { id: "egress", label: "Egress (Repair OIF)" },
];
const MPLS_REPAIR_NODE_STAGES: ProcessingStage[] = [
  { id: "ingress", label: "Ingress" },
  { id: "pop-node-sid", label: "Pop Node-SID Label" },
  { id: "forced-adjacency", label: "Local Adj-SID: Forced Adjacency" },
  { id: "egress", label: "Egress" },
];
const SRV6_REPAIR_NODE_STAGES: ProcessingStage[] = [
  { id: "ingress", label: "Ingress" },
  { id: "local-sid-match", label: "Local SID Match (End.X+USD)" },
  { id: "usd-decap", label: "USD: Remove Repair Outer" },
  { id: "forced-adjacency", label: "Forced Adjacency" },
  { id: "egress", label: "Egress" },
];

function allIds(stages: ProcessingStage[]): string[] {
  return stages.map((s) => s.id);
}

const PHASE = {
  te: new Set(["te-requirement", "predict-minimal-segments", "mpls-te-build", "srv6-te-build", "compare-te-encoding"]),
  vpnBuild: new Set(["mpls-vpn-build", "srv6-vpn-build"]),
  vpnPacket: new Set(["mpls-vpn-packet", "srv6-vpn-packet", "incident-resend"]),
  repairCompute: new Set(["shared-tilfa-compute", "predict-tilfa-shared", "link-fails"]),
  repairEncode: new Set(["mpls-repair-encoding", "srv6-repair-encoding"]),
  repairExecute: new Set(["repair-execution", "stale-fib-check", "compare-protection-encoding", "predict-endx-always-smaller"]),
};

/** True once a link/node failure has been injected AND the current step is at/after the repair phase — used to swap P1's role from "ordinary transit" to "PLR". */
function isPlrActive(currentStepId: string): boolean {
  return PHASE.repairCompute.has(currentStepId) || PHASE.repairEncode.has(currentStepId) || PHASE.repairExecute.has(currentStepId) || currentStepId === "incident-repair" || currentStepId === "incident-resend";
}

export function traceFor(router: RouterId, state: CapstoneState, architecture: Architecture, currentStepId: string): DeviceProcessingTrace | undefined {
  const isMpls = architecture === "SR_MPLS";

  if (router === "CE1" || router === "CE2") return undefined; // customer sites are not enterable devices

  if (router === "PE1") {
    const stages = isMpls ? MPLS_HEADEND_STAGES : SRV6_HEADEND_STAGES;
    const base: DeviceProcessingTrace = { deviceId: "PE1", ingressInterfaceId: "PE1-ce1", egressInterfaceId: "PE1-p1", stages, completedStageIds: [] };
    if (PHASE.vpnBuild.has(currentStepId) || PHASE.vpnPacket.has(currentStepId)) {
      return { ...base, activeStageId: isMpls ? "push-transport" : "set-da", completedStageIds: isMpls ? ["vrf-lookup", "push-vpn"] : ["vrf-lookup"], packetBefore: "Customer IPv4", packetAfter: isMpls ? "Transport + VPN label stack" : "Outer IPv6, DA=Service SID" };
    }
    if (currentStepId.startsWith("mpls-transport") || currentStepId.startsWith("srv6-transport") || PHASE.te.has(currentStepId)) {
      return { ...base, activeStageId: isMpls ? "push-transport" : "set-da", completedStageIds: [], packetBefore: "Plain packet", packetAfter: isMpls ? "Label imposed" : "DA set" };
    }
    return { ...base, completedStageIds: allIds(stages) };
  }

  if (router === "P1") {
    if (isPlrActive(currentStepId)) {
      const stages = isMpls ? MPLS_PLR_STAGES : SRV6_PLR_STAGES;
      const base: DeviceProcessingTrace = { deviceId: "P1", ingressInterfaceId: "P1-pe1", egressInterfaceId: "P1-p3", stages, completedStageIds: [] };
      if (PHASE.repairEncode.has(currentStepId)) return { ...base, activeStageId: isMpls ? "repair-push" : "repair-encaps", completedStageIds: ["ingress", "failure-check"], packetBefore: "Primary next hop down", packetAfter: "Repair encapsulation applied" };
      if (PHASE.repairExecute.has(currentStepId)) return { ...base, completedStageIds: allIds(stages) };
      return base;
    }
    const stages = isMpls ? MPLS_TRANSIT_STAGES : SRV6_TRANSIT_STAGES;
    const base: DeviceProcessingTrace = { deviceId: "P1", ingressInterfaceId: "P1-pe1", egressInterfaceId: "P1-p2", stages, completedStageIds: [] };
    const active = currentStepId.includes("transport-core") || currentStepId.includes("vpn-packet") || PHASE.te.has(currentStepId);
    return active ? { ...base, activeStageId: isMpls ? "label-op" : "ipv6-fib", completedStageIds: ["ingress"], packetBefore: "Incoming packet", packetAfter: "Forwarded" } : base;
  }

  if (router === "P3" || router === "P4") {
    const inRepairFlow = PHASE.repairEncode.has(currentStepId) || PHASE.repairExecute.has(currentStepId) || currentStepId === "incident-resend";
    if (router === "P4" && inRepairFlow) {
      const stages = isMpls ? MPLS_REPAIR_NODE_STAGES : SRV6_REPAIR_NODE_STAGES;
      const base: DeviceProcessingTrace = { deviceId: "P4", ingressInterfaceId: "P4-p3", egressInterfaceId: "P4-p2", stages, completedStageIds: [] };
      if (currentStepId === "repair-execution") return { ...base, activeStageId: isMpls ? "forced-adjacency" : "usd-decap", completedStageIds: isMpls ? ["ingress", "pop-node-sid"] : ["ingress", "local-sid-match"], packetBefore: "Repair encapsulation", packetAfter: "Forced onto repair-node→merge-target adjacency" };
      return base;
    }
    const stages = isMpls ? MPLS_TRANSIT_STAGES : SRV6_TRANSIT_STAGES;
    const base: DeviceProcessingTrace = { deviceId: router, ingressInterfaceId: router === "P3" ? "P3-p1" : "P4-p3", egressInterfaceId: router === "P3" ? "P3-p4" : "P4-p2", stages, completedStageIds: [] };
    const active = PHASE.te.has(currentStepId) || inRepairFlow;
    return active ? { ...base, activeStageId: isMpls ? "label-op" : "ipv6-fib", completedStageIds: ["ingress"], packetBefore: "TE / repair traffic", packetAfter: "Forwarded — no VRF, no repair decision here" } : base;
  }

  if (router === "P2") {
    const stages = isMpls ? MPLS_TRANSIT_STAGES : SRV6_TRANSIT_STAGES;
    const base: DeviceProcessingTrace = { deviceId: "P2", ingressInterfaceId: "P2-p1", egressInterfaceId: "P2-pe2", stages, completedStageIds: [] };
    const active = currentStepId.includes("transport-core") || currentStepId.includes("vpn-packet") || PHASE.te.has(currentStepId) || currentStepId === "repair-execution";
    return active ? { ...base, activeStageId: isMpls ? "label-op" : "ipv6-fib", completedStageIds: ["ingress"], packetBefore: "Incoming packet (possibly merged repair traffic)", packetAfter: "Forwarded toward PE2 — ordinary lookup either way" } : base;
  }

  // PE2
  const stages = isMpls ? MPLS_EGRESS_STAGES : SRV6_EGRESS_STAGES;
  const base: DeviceProcessingTrace = { deviceId: "PE2", ingressInterfaceId: "PE2-p2", egressInterfaceId: "PE2-ce2", stages, completedStageIds: [] };
  if (PHASE.vpnPacket.has(currentStepId) || currentStepId === "incident-fault-injected" || currentStepId === "incident-repair") {
    const locatorDown = !isMpls && currentStepId === "incident-fault-injected";
    return { ...base, activeStageId: locatorDown ? "local-sid-match" : isMpls ? "vpn-label-lookup" : "end-dt4-decap", completedStageIds: locatorDown ? ["ingress"] : ["ingress", isMpls ? "php-or-pop" : "local-sid-match"], packetBefore: isMpls ? "Transport-popped, VPN label exposed" : "Outer IPv6, DA=Service SID", packetAfter: locatorDown ? "DROPPED — Service SID unresolvable" : "Delivered to CE2" };
  }
  if (currentStepId.startsWith("mpls-transport") || currentStepId.startsWith("srv6-transport") || PHASE.te.has(currentStepId)) return { ...base, activeStageId: "deliver", completedStageIds: allIds(stages).slice(0, -1) };
  return base;
}

export function packetFramesFor(architecture: Architecture, state: CapstoneState): PacketStackFrame[] | undefined {
  const isMpls = architecture === "SR_MPLS";
  if (isMpls) {
    const pkt = state.mplsVpnPacket ?? state.mplsRepairPacket ?? state.mplsTePacket ?? state.mplsTransportPacket;
    if (!pkt) return undefined;
    return pkt.labels.map((l, i) => ({ id: `label-${i}`, text: `${l.purpose === "vpn" ? "VPN" : "Transport"} label ${l.value}`, tone: l.purpose === "vpn" ? ("vpn" as const) : ("transport" as const), justChanged: i === 0 }));
  }
  const l3vpnPkt = state.srv6VpnPacket;
  if (l3vpnPkt) return [{ id: "outer", text: `Outer IPv6 DA=${fmtIpv6(l3vpnPkt.outer.daHextets)}`, tone: "transport" as const, justChanged: true }, ...(l3vpnPkt.inner ? [{ id: "inner", text: "Inner customer IPv4", tone: "ip" as const }] : [])];
  const repairPkt = state.srv6RepairPacket;
  if (repairPkt?.repairOuter) return [{ id: "repair", text: `Repair Outer DA=${fmtIpv6(repairPkt.repairOuter.daHextets)}`, tone: "transport" as const, justChanged: true }, ...(repairPkt.inner ? [{ id: "inner", text: "Inner customer IPv4", tone: "ip" as const }] : [])];
  const tePkt = state.srv6TePacket ?? state.srv6TransportPacket;
  if (tePkt) return [{ id: "outer", text: `DA=${fmtIpv6(tePkt.daHextets)}`, tone: "transport" as const, justChanged: true }];
  return undefined;
}

interface IfaceDef {
  id: string;
  name: string;
  neighborId: RouterId;
  neighborLabel: string;
  linkType: string;
  mtu: number;
}
const CORE_ROUTERS_FOR_IFACE: Exclude<RouterId, "CE1" | "CE2">[] = ["PE1", "P1", "P3", "P4", "P2", "PE2"];
function infraIp(router: RouterId): string {
  if (router === "CE1" || router === "CE2") return "";
  return fmtIpv6(INFRA_ADDRESS[router]);
}
const INTERFACES: Record<RouterId, IfaceDef[]> = {
  CE1: [{ id: "CE1-pe1", name: "eth0", neighborId: "PE1", neighborLabel: "PE1", linkType: "Customer access", mtu: 1500 }],
  PE1: [
    { id: "PE1-ce1", name: "ge-0/0/0", neighborId: "CE1", neighborLabel: "CE1", linkType: "Customer access", mtu: 1500 },
    { id: "PE1-p1", name: "xe-0/1/0", neighborId: "P1", neighborLabel: "P1", linkType: "Core (headend uplink)", mtu: 9192 },
  ],
  P1: [
    { id: "P1-pe1", name: "xe-0/0/0", neighborId: "PE1", neighborLabel: "PE1", linkType: "Core", mtu: 9192 },
    { id: "P1-p2", name: "xe-0/1/0", neighborId: "P2", neighborLabel: "P2", linkType: "Core (Primary, TI-LFA protected)", mtu: 9192 },
    { id: "P1-p3", name: "xe-0/2/0", neighborId: "P3", neighborLabel: "P3", linkType: "Core (Repair OIF)", mtu: 9192 },
  ],
  P3: [
    { id: "P3-p1", name: "xe-0/0/0", neighborId: "P1", neighborLabel: "P1", linkType: "Core (Repair OIF)", mtu: 9192 },
    { id: "P3-p4", name: "xe-0/1/0", neighborId: "P4", neighborLabel: "P4", linkType: "Core", mtu: 9192 },
  ],
  P4: [
    { id: "P4-p3", name: "xe-0/0/0", neighborId: "P3", neighborLabel: "P3", linkType: "Core", mtu: 9192 },
    { id: "P4-p2", name: "xe-0/1/0", neighborId: "P2", neighborLabel: "P2", linkType: "Core (Merge link — repair node)", mtu: 9192 },
    { id: "P4-pe2", name: "xe-0/2/0", neighborId: "PE2", neighborLabel: "PE2", linkType: "Core (alternate)", mtu: 9192 },
  ],
  P2: [
    { id: "P2-p1", name: "xe-0/0/0", neighborId: "P1", neighborLabel: "P1", linkType: "Core (Primary, TI-LFA protected)", mtu: 9192 },
    { id: "P2-p4", name: "xe-0/1/0", neighborId: "P4", neighborLabel: "P4", linkType: "Core (Merge link)", mtu: 9192 },
    { id: "P2-pe2", name: "xe-0/2/0", neighborId: "PE2", neighborLabel: "PE2", linkType: "Core", mtu: 9192 },
  ],
  PE2: [
    { id: "PE2-p2", name: "xe-0/0/0", neighborId: "P2", neighborLabel: "P2", linkType: "Core", mtu: 9192 },
    { id: "PE2-ce2", name: "ge-0/1/0", neighborId: "CE2", neighborLabel: "CE2", linkType: "Customer access", mtu: 1500 },
  ],
  CE2: [{ id: "CE2-pe2", name: "eth0", neighborId: "PE2", neighborLabel: "PE2", linkType: "Customer access", mtu: 1500 }],
};

export function interfacesFor(router: RouterId, state: CapstoneState, architecture: Architecture, currentStepId: string): DeviceInterfaceData[] {
  const trace = traceFor(router, state, architecture, currentStepId);
  const processing = trace?.activeStageId !== undefined;
  const extraFor = (def: IfaceDef): { label: string; value: string }[] => {
    if (router === "CE1" || router === "CE2" || def.neighborId === "CE1" || def.neighborId === "CE2") return [];
    return architecture === "SR_MPLS" ? [{ label: "Node-SID", value: String(nodeSidLabel(router)) }] : [{ label: "End SID", value: endSidText(router) }];
  };
  return INTERFACES[router].map((def) => {
    const down = state.linkFailed && ((router === "P1" && def.neighborId === "P2") || (router === "P2" && def.neighborId === "P1"));
    return {
      id: def.id,
      name: def.name,
      status: down ? "down" : "up",
      ip: infraIp(router),
      neighborId: def.neighborId,
      neighborLabel: def.neighborLabel,
      linkType: def.linkType,
      mtu: def.mtu,
      protocols: architecture === "SR_MPLS" ? ["IGP", "SR-MPLS"] : ["IGP", "SRv6"],
      packetCount: trace && (trace.completedStageIds.length > 0 || processing) ? 1 : 0,
      role: processing && def.id === trace?.ingressInterfaceId ? "ingress" : processing && def.id === trace?.egressInterfaceId ? "egress" : "idle",
      extra: extraFor(def),
    };
  });
}

export function linkDetailFor(linkId: string, state: CapstoneState, architecture: Architecture): LinkDetail | undefined {
  const edge = GRAPH_EDGES.find((e) => e.id === linkId);
  if (!edge) return undefined;
  const a = edge.a;
  const b = edge.b;
  const aIface = INTERFACES[a].find((f) => f.neighborId === b);
  const bIface = INTERFACES[b].find((f) => f.neighborId === a);
  if (!aIface || !bIface) return undefined;
  const down = state.linkFailed && ((a === "P1" && b === "P2") || (a === "P2" && b === "P1"));
  return {
    aLabel: a,
    bLabel: b,
    aInterface: { id: aIface.id, name: aIface.name, status: down ? "down" : "up", ip: infraIp(a), neighborId: b, neighborLabel: b, linkType: aIface.linkType, mtu: aIface.mtu, protocols: architecture === "SR_MPLS" ? ["SR-MPLS"] : ["SRv6"], role: "idle" },
    bInterface: { id: bIface.id, name: bIface.name, status: down ? "down" : "up", ip: infraIp(b), neighborId: a, neighborLabel: a, linkType: bIface.linkType, mtu: bIface.mtu, protocols: architecture === "SR_MPLS" ? ["SR-MPLS"] : ["SRv6"], role: "idle" },
    status: down ? "down" : "up",
    mtu: aIface.mtu,
    protocols: [{ label: "IGP", value: "shared, architecture-independent" }, { label: "Protected resource", value: linkId === "P1-P2" ? "Yes — this is the protected link" : "No" }],
  };
}

export const DEVICE_ROUTERS = CORE_ROUTERS_FOR_IFACE;
