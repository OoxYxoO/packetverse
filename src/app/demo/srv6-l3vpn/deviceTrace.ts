import type { DeviceInterfaceData, DeviceProcessingTrace, LinkDetail, PacketStackFrame, ProcessingStage } from "@/components/network3d/types";
import { fmtIpv6 } from "@/lib/sim-engine/scenarios/srv6Foundations";
import { GRAPH_EDGES, PE1_DT4_SID, PE2_DT4_SID, srv6L3vpnSteps, type RouterId, type Srv6L3vpnState } from "@/lib/sim-engine/scenarios/srv6L3vpn";

/**
 * Scene Adapter for SRv6 L3VPN's device-interior 3D view (ARCHITECTURE.md
 * §4). Every stage list/checkpoint/interface/link-detail value below is
 * derived FROM Srv6L3vpnState — no VRF/BGP/SRv6 decision is made here.
 */

const stepIndex = (id: string) => srv6L3vpnSteps.findIndex((s) => s.id === id);

const PE1_STAGES: ProcessingStage[] = [
  { id: "ingress", label: "Ingress Interface" },
  { id: "identify-vrf", label: "Identify VRF (CUST-A)" },
  { id: "vrf-lookup", label: "VRF Route Lookup" },
  { id: "select-sid", label: "Select Service SID" },
  { id: "encapsulate", label: "SRv6 Encapsulation" },
  { id: "egress", label: "Egress Interface" },
];
const P_STAGES: ProcessingStage[] = [
  { id: "ingress", label: "Ingress" },
  { id: "ipv6-fib", label: "IPv6 FIB Lookup" },
  { id: "forward", label: "Forward Toward Locator" },
  { id: "egress", label: "Egress" },
];
const PE2_STAGES: ProcessingStage[] = [
  { id: "ingress", label: "Ingress" },
  { id: "local-sid-match", label: "Local SID Match" },
  { id: "service-decap", label: "Decapsulate (End.DT4/DT6)" },
  { id: "egress-vrf-lookup", label: "Egress VRF Lookup" },
  { id: "deliver", label: "Deliver to CE" },
  { id: "egress", label: "Egress" },
];

function allIds(stages: ProcessingStage[]) {
  return stages.map((s) => s.id);
}

const PE1_DATA_STEPS = new Set(["send-ce1-ce2", "pe1-vrf-lookup", "pe1-encapsulate", "predict-no-srh", "send-ce1-ce3", "send-ce2-ce1", "send-ce1-ce2-ipv6", "verify-dataplane"]);
const PE2_DATA_STEPS = new Set(["pe2-local-sid-match", "pe2-dt4-execute", "pe2-dt4-execute-ce3", "send-ce2-ce1", "pe2-dt6-execute", "verify-dataplane"]);

export function traceFor(router: RouterId, state: Srv6L3vpnState, currentStepId: string): DeviceProcessingTrace | undefined {
  const i = stepIndex(currentStepId);

  if (router === "PE1") {
    const base: DeviceProcessingTrace = { deviceId: "PE1", ingressInterfaceId: "PE1-ce1", egressInterfaceId: "PE1-p1", stages: PE1_STAGES, completedStageIds: [] };
    if (!PE1_DATA_STEPS.has(currentStepId) && i < stepIndex("send-ce1-ce2")) return base;
    if (currentStepId === "send-ce1-ce2") return { ...base, activeStageId: "ingress", packetBefore: "Plain IPv4 packet arrives from CE1" };
    if (currentStepId === "pe1-vrf-lookup") return { ...base, activeStageId: "vrf-lookup", completedStageIds: ["ingress", "identify-vrf"], packetBefore: "IPv4 packet (VRF CUST-A match)" };
    if (currentStepId === "pe1-encapsulate" || currentStepId === "predict-no-srh") return { ...base, activeStageId: "encapsulate", completedStageIds: ["ingress", "identify-vrf", "vrf-lookup", "select-sid"], packetBefore: "IPv4 packet", packetAfter: `[Outer IPv6 DA=${PE2_DT4_SID.sidText}][IPv4]` };
    if (currentStepId === "send-ce1-ce3" || currentStepId === "send-ce2-ce1" || currentStepId === "send-ce1-ce2-ipv6") return { ...base, completedStageIds: allIds(PE1_STAGES), packetBefore: "IPv4/IPv6 packet", packetAfter: "Outer IPv6 [Service SID][inner]" };
    if (currentStepId === "verify-dataplane") return { ...base, completedStageIds: allIds(PE1_STAGES), packetBefore: "IPv4 packet (verification)", packetAfter: `[Outer IPv6 DA=${PE2_DT4_SID.sidText}][IPv4]` };
    return { ...base, completedStageIds: allIds(PE1_STAGES) };
  }

  if (router === "P1" || router === "P2") {
    const base: DeviceProcessingTrace = { deviceId: router, ingressInterfaceId: router === "P1" ? "P1-pe1" : "P2-p1", egressInterfaceId: router === "P1" ? "P1-p2" : "P2-pe2", stages: P_STAGES, completedStageIds: [] };
    const transitStepsForRouter = router === "P1" ? new Set(["pe1-encapsulate", "predict-no-srh", "p1-transit", "predict-p-routers", "send-ce1-ce2-ipv6"]) : new Set(["p1-transit", "predict-p-routers", "p2-transit", "send-ce1-ce2-ipv6"]);
    if (!transitStepsForRouter.has(currentStepId) && i < stepIndex("pe1-encapsulate")) return base;
    if (transitStepsForRouter.has(currentStepId)) return { ...base, activeStageId: "forward", completedStageIds: ["ingress", "ipv6-fib"], packetBefore: "Outer IPv6 [Service SID][inner]", packetAfter: "Outer IPv6 [Service SID][inner] — unchanged" };
    return { ...base, completedStageIds: allIds(P_STAGES) };
  }

  // PE2
  const base: DeviceProcessingTrace = { deviceId: "PE2", ingressInterfaceId: "PE2-p2", egressInterfaceId: "PE2-ce2", stages: PE2_STAGES, completedStageIds: [] };
  if (!PE2_DATA_STEPS.has(currentStepId) && i < stepIndex("pe2-local-sid-match")) return base;
  if (currentStepId === "pe2-local-sid-match") return { ...base, activeStageId: "local-sid-match", completedStageIds: ["ingress"], packetBefore: `Outer IPv6 DA=${PE2_DT4_SID.sidText}` };
  if (currentStepId === "pe2-dt4-execute" || currentStepId === "pe2-dt4-execute-ce3" || currentStepId === "pe2-dt6-execute") return { ...base, activeStageId: "service-decap", completedStageIds: ["ingress", "local-sid-match"], packetBefore: "Outer IPv6 [Service SID][inner]", packetAfter: "inner payload exposed" };
  if (currentStepId === "send-ce2-ce1") return { ...base, activeStageId: "egress-vrf-lookup", completedStageIds: ["ingress"], packetBefore: `Outer IPv6 DA=${PE1_DT4_SID.sidText} (reverse — this is PE1's own SID, not PE2's)` };
  if (currentStepId === "verify-dataplane") return { ...base, completedStageIds: allIds(PE2_STAGES), packetBefore: "Outer IPv6 [Service SID][IPv4]", packetAfter: "IPv4 packet → CE3" };
  return { ...base, completedStageIds: allIds(PE2_STAGES) };
}

export function packetFramesFor(state: Srv6L3vpnState, activeStageId: string | undefined): PacketStackFrame[] | undefined {
  if (!state.packet) return undefined;
  const frames: PacketStackFrame[] = [{ id: "outer", text: `Outer IPv6 (${fmtIpv6(state.packet.outer.daHextets)})`, tone: "transport", justChanged: activeStageId === "encapsulate" || activeStageId === "service-decap" }];
  if (state.packet.outer.srh) frames.push({ id: "srh", text: `SRH (SL=${state.packet.outer.srh.segmentsLeft})`, tone: "vpn" });
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
  CE1: [{ id: "CE1-pe1", name: "ge-0/0/0", ip: "10.10.1.1/24", neighborId: "PE1", neighborLabel: "PE1", linkType: "Access", mtu: 1500, protocols: ["Static"] }],
  PE1: [
    { id: "PE1-ce1", name: "ge-0/0/0", ip: "10.10.1.254/24", neighborId: "CE1", neighborLabel: "CE1", linkType: "Access (VRF CUST-A)", mtu: 1500, protocols: ["Static"] },
    { id: "PE1-p1", name: "xe-0/1/0", ip: "2001:db8:ffff:12::1/126", neighborId: "P1", neighborLabel: "P1", linkType: "Core (IPv6/SRv6)", mtu: 9192, protocols: ["IPv6 IGP", "SRv6"] },
  ],
  P1: [
    { id: "P1-pe1", name: "xe-0/0/0", ip: "2001:db8:ffff:12::2/126", neighborId: "PE1", neighborLabel: "PE1", linkType: "Core (IPv6/SRv6)", mtu: 9192, protocols: ["IPv6 IGP"] },
    { id: "P1-p2", name: "xe-0/1/0", ip: "2001:db8:ffff:23::1/126", neighborId: "P2", neighborLabel: "P2", linkType: "Core (IPv6/SRv6)", mtu: 9192, protocols: ["IPv6 IGP"] },
  ],
  P2: [
    { id: "P2-p1", name: "xe-0/0/0", ip: "2001:db8:ffff:23::2/126", neighborId: "P1", neighborLabel: "P1", linkType: "Core (IPv6/SRv6)", mtu: 9192, protocols: ["IPv6 IGP"] },
    { id: "P2-pe2", name: "xe-0/1/0", ip: "2001:db8:ffff:24::1/126", neighborId: "PE2", neighborLabel: "PE2", linkType: "Core (IPv6/SRv6)", mtu: 9192, protocols: ["IPv6 IGP"] },
  ],
  PE2: [
    { id: "PE2-p2", name: "xe-0/0/0", ip: "2001:db8:ffff:24::2/126", neighborId: "P2", neighborLabel: "P2", linkType: "Core (IPv6/SRv6)", mtu: 9192, protocols: ["IPv6 IGP", "SRv6"] },
    { id: "PE2-ce2", name: "ge-0/1/0", ip: "10.20.1.254/24", neighborId: "CE2", neighborLabel: "CE2", linkType: "Access (VRF CUST-A)", mtu: 1500, protocols: ["Static"] },
    { id: "PE2-ce3", name: "ge-0/2/0", ip: "10.20.2.254/24", neighborId: "CE3", neighborLabel: "CE3", linkType: "Access (VRF CUST-A)", mtu: 1500, protocols: ["Static"] },
  ],
  CE2: [{ id: "CE2-pe2", name: "ge-0/0/0", ip: "10.20.1.10/24", neighborId: "PE2", neighborLabel: "PE2", linkType: "Access", mtu: 1500, protocols: ["Static"] }],
  CE3: [{ id: "CE3-pe2", name: "ge-0/0/0", ip: "10.20.2.10/24", neighborId: "PE2", neighborLabel: "PE2", linkType: "Access", mtu: 1500, protocols: ["Static"] }],
};

export function interfacesFor(router: RouterId, state: Srv6L3vpnState, currentStepId: string): DeviceInterfaceData[] {
  const trace = traceFor(router, state, currentStepId);
  const processing = trace?.activeStageId !== undefined;
  return INTERFACES[router].map((def) => ({
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
  }));
}

export function linkDetailFor(linkId: string, state: Srv6L3vpnState): LinkDetail | undefined {
  const edge = GRAPH_EDGES.find((e) => e.id === linkId);
  if (!edge) return undefined;
  const a = edge.a as RouterId;
  const b = edge.b as RouterId;
  const aIface = INTERFACES[a].find((f) => f.neighborId === b);
  const bIface = INTERFACES[b].find((f) => f.neighborId === a);
  if (!aIface || !bIface) return undefined;
  const isCore = aIface.linkType.startsWith("Core");
  const currentlyCarrying = state.packetAt && [a, b].includes(state.packetAt) && state.packet ? `[Service SID ${fmtIpv6(state.packet.outer.daHextets)}]${state.packet.inner ? "[inner]" : ""}` : undefined;
  return {
    aLabel: a,
    bLabel: b,
    aInterface: { id: aIface.id, name: aIface.name, status: "up", ip: aIface.ip, neighborId: b, neighborLabel: b, linkType: aIface.linkType, mtu: aIface.mtu, protocols: aIface.protocols, role: "idle" },
    bInterface: { id: bIface.id, name: bIface.name, status: "up", ip: bIface.ip, neighborId: a, neighborLabel: a, linkType: bIface.linkType, mtu: bIface.mtu, protocols: bIface.protocols, role: "idle" },
    status: "up",
    mtu: aIface.mtu,
    protocols: isCore ? [{ label: "IGP", value: "IPv6 (conceptual)" }, { label: "SRv6", value: "Enabled" }] : [{ label: "VRF", value: "CUST-A" }],
    currentTraffic: currentlyCarrying,
  };
}
