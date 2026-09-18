import type { DeviceInterfaceData, DeviceProcessingTrace, LinkDetail, PacketStackFrame, ProcessingStage } from "@/components/network3d/types";
import { fmtIpv6 } from "@/lib/sim-engine/scenarios/srv6Foundations";
import { GRAPH_EDGES, INFRA_ADDRESS_TEXT, srv6TiLfaSteps, type RouterId, type Srv6TiLfaState } from "@/lib/sim-engine/scenarios/srv6TiLfa";

/**
 * Scene Adapter for SRv6 TI-LFA's device-interior 3D view (ARCHITECTURE.md
 * §4). Every stage/interface/link-detail value is derived FROM
 * Srv6TiLfaState — no P-Space/Q-Space/repair decision is made here.
 */

const stepIndex = (id: string) => srv6TiLfaSteps.findIndex((s) => s.id === id);

const PLR_STAGES: ProcessingStage[] = [
  { id: "ingress", label: "Ingress Interface" },
  { id: "primary-lookup", label: "Primary Next-Hop Lookup" },
  { id: "failure-check", label: "Protected Resource Check" },
  { id: "repair-lookup", label: "Precomputed Repair Lookup" },
  { id: "encapsulate", label: "H.Encaps Repair Outer" },
  { id: "egress", label: "Egress (Repair OIF)" },
];
const TRANSIT_STAGES: ProcessingStage[] = [
  { id: "ingress", label: "Ingress" },
  { id: "ipv6-fib", label: "Ordinary IPv6 FIB Lookup" },
  { id: "egress", label: "Egress" },
];
const REPAIR_NODE_STAGES: ProcessingStage[] = [
  { id: "ingress", label: "Ingress" },
  { id: "local-sid-match", label: "Local SID Match (End.X+USD)" },
  { id: "usd-decap", label: "USD: Remove Repair Outer" },
  { id: "forced-adjacency", label: "Forced Adjacency" },
  { id: "egress", label: "Egress" },
];
const DEST_STAGES: ProcessingStage[] = [
  { id: "ingress", label: "Ingress" },
  { id: "deliver", label: "Deliver / Local Segment" },
];

function allIds(stages: ProcessingStage[]) {
  return stages.map((s) => s.id);
}

const P1_REPAIR_STEPS = new Set(["p1-encaps-packet", "wrong-repair-forwards", "verify-resend", "l3vpn-fail-and-repair"]);
const P3_TRANSIT_STEPS = new Set(["naive-forward-p1-p3", "naive-p3-stale-fib", "naive-loop-p3-p1", "p3-transit-repair", "wrong-repair-p3-stale", "wrong-repair-loop", "verify-resend", "l3vpn-fail-and-repair"]);
const P4_STEPS = new Set(["p4-endx-usd-execute", "p4-usd-decap", "verify-resend", "l3vpn-p4-decap-repair-only"]);
const P2_STEPS = new Set(["p2-normal-forward", "verify-resend", "l3vpn-result"]);
const PE2_STEPS = new Set(["pe2-delivers", "verify-resend", "l3vpn-result", "post-convergence-forwarding"]);

export function traceFor(router: RouterId, state: Srv6TiLfaState, currentStepId: string): DeviceProcessingTrace | undefined {
  const i = stepIndex(currentStepId);

  if (router === "P1") {
    const base: DeviceProcessingTrace = { deviceId: "P1", ingressInterfaceId: "P1-pe1", egressInterfaceId: "P1-p3", stages: PLR_STAGES, completedStageIds: [] };
    if (!P1_REPAIR_STEPS.has(currentStepId) && i < stepIndex("trigger-failure")) return base;
    if (P1_REPAIR_STEPS.has(currentStepId)) return { ...base, activeStageId: "encapsulate", completedStageIds: ["ingress", "primary-lookup", "failure-check", "repair-lookup"], packetBefore: "IPv6, DA=PE2", packetAfter: "Repair outer added" };
    return { ...base, completedStageIds: allIds(PLR_STAGES) };
  }

  if (router === "P3" || router === "P2") {
    const stepsForRouter = router === "P3" ? P3_TRANSIT_STEPS : P2_STEPS;
    const base: DeviceProcessingTrace = { deviceId: router, ingressInterfaceId: router === "P3" ? "P3-p1" : "P2-p1", egressInterfaceId: router === "P3" ? "P3-p4" : "P2-pe2", stages: TRANSIT_STAGES, completedStageIds: [] };
    if (!stepsForRouter.has(currentStepId)) return base;
    return { ...base, activeStageId: "ipv6-fib", completedStageIds: ["ingress"], packetBefore: "Ordinary IPv6 packet", packetAfter: "Forwarded on outer destination only" };
  }

  if (router === "P4") {
    const base: DeviceProcessingTrace = { deviceId: "P4", ingressInterfaceId: "P4-p3", egressInterfaceId: "P4-p2", stages: REPAIR_NODE_STAGES, completedStageIds: [] };
    if (!P4_STEPS.has(currentStepId)) return base;
    return { ...base, activeStageId: "usd-decap", completedStageIds: ["ingress", "local-sid-match"], packetBefore: "Repair outer + original packet", packetAfter: "Repair outer removed, forced to adjacency" };
  }

  // PE2
  const base: DeviceProcessingTrace = { deviceId: "PE2", ingressInterfaceId: "PE2-p2", egressInterfaceId: undefined, stages: DEST_STAGES, completedStageIds: [] };
  if (!PE2_STEPS.has(currentStepId)) return base;
  return { ...base, activeStageId: "deliver", completedStageIds: ["ingress"], packetBefore: "IPv6, DA=PE2", packetAfter: "Delivered" };
}

export function packetFramesFor(state: Srv6TiLfaState, activeStageId: string | undefined): PacketStackFrame[] | undefined {
  if (!state.packet) return undefined;
  const frames: PacketStackFrame[] = [];
  if (state.packet.repairOuter) frames.push({ id: "repair", text: `Repair Outer (${fmtIpv6(state.packet.repairOuter.daHextets)})`, tone: "transport", justChanged: activeStageId === "encapsulate" || activeStageId === "usd-decap" });
  if (state.packet.vpnOuter) frames.push({ id: "vpn", text: `VPN Outer (${state.packet.vpnOuter.daText})`, tone: "vpn" });
  if (state.packet.inner) frames.push({ id: "inner", text: state.packet.inner.kind === "IPV4" ? "Inner IPv4" : state.packet.inner.kind === "IPV6" ? "Inner IPv6" : "Inner Ethernet", tone: "ip" });
  return frames;
}

interface IfaceDef {
  id: string;
  name: string;
  ip: string;
  neighborId: RouterId;
  neighborLabel: string;
  linkType: string;
  mtu: number;
  protocols: string[];
}
const INTERFACES: Record<RouterId, IfaceDef[]> = {
  PE1: [{ id: "PE1-p1", name: "ge-0/0/0", ip: INFRA_ADDRESS_TEXT.PE1, neighborId: "P1", neighborLabel: "P1", linkType: "Core (IPv6/SRv6)", mtu: 9192, protocols: ["IPv6 IGP"] }],
  P1: [
    { id: "P1-pe1", name: "xe-0/0/0", ip: INFRA_ADDRESS_TEXT.P1, neighborId: "PE1", neighborLabel: "PE1", linkType: "Core (IPv6/SRv6)", mtu: 9192, protocols: ["IPv6 IGP"] },
    { id: "P1-p2", name: "xe-0/1/0", ip: INFRA_ADDRESS_TEXT.P1, neighborId: "P2", neighborLabel: "P2", linkType: "Core (Primary, TI-LFA protected)", mtu: 9192, protocols: ["IPv6 IGP", "TI-LFA"] },
    { id: "P1-p3", name: "xe-0/2/0", ip: INFRA_ADDRESS_TEXT.P1, neighborId: "P3", neighborLabel: "P3", linkType: "Core (Repair OIF)", mtu: 9192, protocols: ["IPv6 IGP"] },
  ],
  P2: [
    { id: "P2-p1", name: "xe-0/0/0", ip: INFRA_ADDRESS_TEXT.P2, neighborId: "P1", neighborLabel: "P1", linkType: "Core (Primary, TI-LFA protected)", mtu: 9192, protocols: ["IPv6 IGP"] },
    { id: "P2-pe2", name: "xe-0/1/0", ip: INFRA_ADDRESS_TEXT.P2, neighborId: "PE2", neighborLabel: "PE2", linkType: "Core (IPv6/SRv6)", mtu: 9192, protocols: ["IPv6 IGP"] },
    { id: "P2-p4", name: "xe-0/2/0", ip: INFRA_ADDRESS_TEXT.P2, neighborId: "P4", neighborLabel: "P4", linkType: "Core (Merge Link)", mtu: 9192, protocols: ["IPv6 IGP"] },
  ],
  P3: [
    { id: "P3-p1", name: "xe-0/0/0", ip: INFRA_ADDRESS_TEXT.P3, neighborId: "P1", neighborLabel: "P1", linkType: "Core (Repair OIF)", mtu: 9192, protocols: ["IPv6 IGP"] },
    { id: "P3-p4", name: "xe-0/1/0", ip: INFRA_ADDRESS_TEXT.P3, neighborId: "P4", neighborLabel: "P4", linkType: "Core (IPv6/SRv6)", mtu: 9192, protocols: ["IPv6 IGP"] },
  ],
  P4: [
    { id: "P4-p3", name: "xe-0/0/0", ip: INFRA_ADDRESS_TEXT.P4, neighborId: "P3", neighborLabel: "P3", linkType: "Core (IPv6/SRv6)", mtu: 9192, protocols: ["IPv6 IGP", "SRv6"] },
    { id: "P4-p2", name: "xe-0/1/0", ip: INFRA_ADDRESS_TEXT.P4, neighborId: "P2", neighborLabel: "P2", linkType: "Core (Merge Link — link protection)", mtu: 9192, protocols: ["IPv6 IGP"] },
    { id: "P4-pe2", name: "xe-0/2/0", ip: INFRA_ADDRESS_TEXT.P4, neighborId: "PE2", neighborLabel: "PE2", linkType: "Core (Node-protection backup link)", mtu: 9192, protocols: ["IPv6 IGP"] },
  ],
  PE2: [{ id: "PE2-p2", name: "ge-0/0/0", ip: INFRA_ADDRESS_TEXT.PE2, neighborId: "P2", neighborLabel: "P2", linkType: "Core (IPv6/SRv6)", mtu: 9192, protocols: ["IPv6 IGP"] }],
};

export function interfacesFor(router: RouterId, state: Srv6TiLfaState, currentStepId: string): DeviceInterfaceData[] {
  const trace = traceFor(router, state, currentStepId);
  const processing = trace?.activeStageId !== undefined;
  return INTERFACES[router].map((def) => {
    const isFailedLink = state.failedLinkIds.some((id) => id.split("-").includes(router) || (def.neighborId && id.includes(def.neighborId) && id.includes(router)));
    return {
      id: def.id,
      name: def.name,
      status: isFailedLink && ((router === "P1" && def.neighborId === "P2") || (router === "P2" && def.neighborId === "P1")) ? "down" : "up",
      ip: def.ip,
      neighborId: def.neighborId,
      neighborLabel: def.neighborLabel,
      linkType: def.linkType,
      mtu: def.mtu,
      protocols: def.protocols,
      packetCount: trace && (trace.completedStageIds.length > 0 || processing) ? 1 : 0,
      role: processing && def.id === trace?.ingressInterfaceId ? "ingress" : processing && def.id === trace?.egressInterfaceId ? "egress" : "idle",
    };
  });
}

export function linkDetailFor(linkId: string, state: Srv6TiLfaState): LinkDetail | undefined {
  const edge = GRAPH_EDGES.find((e) => e.id === linkId);
  if (!edge) return undefined;
  const a = edge.a as RouterId;
  const b = edge.b as RouterId;
  const aIface = INTERFACES[a].find((f) => f.neighborId === b);
  const bIface = INTERFACES[b].find((f) => f.neighborId === a);
  if (!aIface || !bIface) return undefined;
  const down = state.failedLinkIds.includes(edge.id);
  return {
    aLabel: a,
    bLabel: b,
    aInterface: { id: aIface.id, name: aIface.name, status: down ? "down" : "up", ip: aIface.ip, neighborId: b, neighborLabel: b, linkType: aIface.linkType, mtu: aIface.mtu, protocols: aIface.protocols, role: "idle" },
    bInterface: { id: bIface.id, name: bIface.name, status: down ? "down" : "up", ip: bIface.ip, neighborId: a, neighborLabel: a, linkType: bIface.linkType, mtu: bIface.mtu, protocols: bIface.protocols, role: "idle" },
    status: down ? "down" : "up",
    mtu: aIface.mtu,
    protocols: [{ label: "IGP", value: "IPv6 (conceptual)" }, { label: "TI-LFA", value: edge.id === "P1-P2" ? "Protected resource" : "Protection topology" }],
  };
}
