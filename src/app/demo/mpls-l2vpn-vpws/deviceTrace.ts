import type { DeviceInterfaceData, DeviceProcessingTrace, LinkDetail, PacketStackFrame, ProcessingStage } from "@/components/network3d/types";
import { LINKS, resolveAttachmentCircuit, type LinkDef, type MplsL2vpnVpwsState, type RouterId } from "@/lib/sim-engine/scenarios/mplsL2vpnVpws";

/**
 * Scene Adapter for the traditional MPLS L2VPN/VPWS lesson's device-
 * interior 3D view. Every stage list and interface/link value below is
 * derived FROM MplsL2vpnVpwsState — this file makes no pseudowire
 * decision itself.
 */

const CE_PIPELINE: ProcessingStage[] = [
  { id: "ac", label: "Attachment Circuit" },
  { id: "deliver", label: "Deliver / Receive" },
];
const PE_INGRESS_PIPELINE: ProcessingStage[] = [
  { id: "ac-ingress", label: "AC Ingress" },
  { id: "service-lookup", label: "Resolve Service / Pseudowire" },
  { id: "push-pw", label: "Push PW Label (Remote Receive Label)" },
  { id: "push-transport", label: "Push Transport Label" },
  { id: "forward", label: "Forward Into Core" },
];
const PE_EGRESS_PIPELINE: ProcessingStage[] = [
  { id: "transport-terminated", label: "Transport Context Terminated" },
  { id: "pw-lookup", label: "PW Label Lookup" },
  { id: "identify-ac", label: "Identify Local AC" },
  { id: "pop-pw", label: "Pop PW Label" },
  { id: "deliver", label: "Deliver Ethernet Frame" },
];
const TRANSIT_PIPELINE: ProcessingStage[] = [
  { id: "ingress", label: "MPLS Ingress" },
  { id: "label-lookup", label: "Top (Transport) Label Lookup" },
  { id: "transport-forward", label: "Transport Forwarding" },
  { id: "forward", label: "Forward (Inner PW Label Untouched)" },
];

const allIds = (s: ProcessingStage[]) => s.map((x) => x.id);

function neighborLinks(router: RouterId): { neighbor: RouterId; link: LinkDef }[] {
  return LINKS.filter((l) => l.a === router || l.b === router).map((l) => ({ neighbor: l.a === router ? l.b : l.a, link: l }));
}

export function traceFor(router: RouterId, state: MplsL2vpnVpwsState): DeviceProcessingTrace | undefined {
  const nbrs = neighborLinks(router);
  const ingressIfaceId = nbrs[0] ? `${router}-${nbrs[0].neighbor}` : undefined;
  const egressIfaceId = nbrs[1] ? `${router}-${nbrs[1].neighbor}` : undefined;
  const hops = state.journey.filter((h) => h.device === router);
  const hop = hops[hops.length - 1];
  const isCurrent = state.journey.length > 0 && state.journey[state.journey.length - 1].device === router;

  if (router === "CE1" || router === "CE2") {
    const base: DeviceProcessingTrace = { deviceId: router, ingressInterfaceId: ingressIfaceId, stages: CE_PIPELINE, completedStageIds: [] };
    if (!hop) return base;
    if (isCurrent) return { ...base, activeStageId: hop.action === "AC_EGRESS" ? "deliver" : "ac", completedStageIds: hop.action === "AC_EGRESS" ? ["ac"] : [], packetBefore: hop.input, packetAfter: hop.output };
    return { ...base, completedStageIds: allIds(CE_PIPELINE), packetBefore: hop.input, packetAfter: hop.output };
  }

  if (router === "PE1" || router === "PE2") {
    const isIngress = hop?.action === "AC_INGRESS" || hop?.action === "PUSH_PW" || hop?.action === "PUSH_TRANSPORT";
    const stages = isIngress ? PE_INGRESS_PIPELINE : PE_EGRESS_PIPELINE;
    const base: DeviceProcessingTrace = { deviceId: router, ingressInterfaceId: ingressIfaceId, egressInterfaceId: egressIfaceId, stages, completedStageIds: [] };
    if (!hop) return base;
    if (isCurrent) {
      if (isIngress) {
        const activeStageId = hop.action === "AC_INGRESS" ? "service-lookup" : hop.action === "PUSH_PW" ? "push-transport" : "forward";
        const completed = hop.action === "AC_INGRESS" ? ["ac-ingress"] : hop.action === "PUSH_PW" ? ["ac-ingress", "service-lookup", "push-pw"] : ["ac-ingress", "service-lookup", "push-pw", "push-transport"];
        return { ...base, activeStageId, completedStageIds: completed, packetBefore: hop.input, packetAfter: hop.output };
      }
      const activeStageId = hop.action === "PW_LOOKUP" ? "identify-ac" : hop.action === "POP_PW" ? "deliver" : "deliver";
      const completed = hop.action === "PW_LOOKUP" ? ["transport-terminated", "pw-lookup"] : ["transport-terminated", "pw-lookup", "identify-ac", "pop-pw"];
      return { ...base, activeStageId, completedStageIds: completed, packetBefore: hop.input, packetAfter: hop.output };
    }
    return { ...base, completedStageIds: allIds(stages), packetBefore: hop.input, packetAfter: hop.output };
  }

  // P1, P2 — ordinary transport transit, no pseudowire knowledge.
  const base: DeviceProcessingTrace = { deviceId: router, ingressInterfaceId: ingressIfaceId, egressInterfaceId: egressIfaceId, stages: TRANSIT_PIPELINE, completedStageIds: [] };
  if (!hop) return base;
  if (isCurrent) return { ...base, activeStageId: "forward", completedStageIds: ["ingress", "label-lookup", "transport-forward"], packetBefore: hop.input, packetAfter: hop.output };
  return { ...base, completedStageIds: allIds(TRANSIT_PIPELINE), packetBefore: hop.input, packetAfter: hop.output };
}

export function packetFramesFor(state: MplsL2vpnVpwsState): PacketStackFrame[] | undefined {
  if (!state.packet) return undefined;
  const labelFrames: PacketStackFrame[] = state.packet.labels.map((l, idx) => ({
    id: `label-${idx}`,
    text: `${l.purpose === "transport" ? "Transport" : "PW"} ${l.value}`,
    tone: l.purpose === "transport" ? "transport" : "vpn",
    justChanged: idx === 0,
  }));
  return [...labelFrames, { id: "eth", text: "Ethernet", tone: "generic" }];
}

export function interfacesFor(router: RouterId, state: MplsL2vpnVpwsState): DeviceInterfaceData[] {
  const ac = resolveAttachmentCircuit(state.acs, router);
  const base = neighborLinks(router).map(({ neighbor, link }) => ({
    id: `${router}-${neighbor}`,
    name: `to-${neighbor}`,
    status: "up" as const,
    neighborId: neighbor,
    neighborLabel: neighbor,
    linkType: link.igpMetric !== undefined ? "Core" : "Access",
    mtu: 1500,
    protocols: link.igpMetric !== undefined ? ["IGP", "MPLS"] : ["Ethernet"],
    role: "idle" as const,
    extra: link.igpMetric !== undefined ? [{ label: "IGP Metric", value: String(link.igpMetric) }] : ac ? [{ label: "VLAN", value: String(ac.vlan) }, { label: "AC Status", value: ac.up ? "up" : "down" }] : undefined,
  }));
  return base;
}

export function linkDetailFor(linkId: string, state: MplsL2vpnVpwsState): LinkDetail | undefined {
  const link = LINKS.find((l) => l.id === linkId);
  if (!link) return undefined;
  const ac1 = link.a === "PE1" || link.b === "PE1" ? resolveAttachmentCircuit(state.acs, "PE1") : undefined;
  const ac2 = link.a === "PE2" || link.b === "PE2" ? resolveAttachmentCircuit(state.acs, "PE2") : undefined;
  const isAccessLink = link.igpMetric === undefined;
  const linkUp = isAccessLink ? (ac1?.up ?? ac2?.up ?? true) : true;
  return {
    aLabel: link.a,
    bLabel: link.b,
    aInterface: { id: `${link.a}-${link.b}`, name: `to-${link.b}`, status: linkUp ? "up" : "down", neighborId: link.b, neighborLabel: link.b, linkType: isAccessLink ? "Access" : "Core", mtu: 1500, protocols: isAccessLink ? ["Ethernet"] : ["IGP", "MPLS"], role: "idle" },
    bInterface: { id: `${link.b}-${link.a}`, name: `to-${link.a}`, status: linkUp ? "up" : "down", neighborId: link.a, neighborLabel: link.a, linkType: isAccessLink ? "Access" : "Core", mtu: 1500, protocols: isAccessLink ? ["Ethernet"] : ["IGP", "MPLS"], role: "idle" },
    status: linkUp ? "up" : "down",
    mtu: 1500,
    protocols: isAccessLink ? [{ label: "Type", value: "Attachment Circuit" }] : [{ label: "IGP Metric", value: String(link.igpMetric) }],
  };
}
