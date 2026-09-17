import type { DeviceInterfaceData, DeviceProcessingTrace, LinkDetail, PacketStackFrame, ProcessingStage } from "@/components/network3d/types";
import { LINKS, PE_ROUTERS, resolveAttachmentCircuit, type BgpVplsState, type LinkDef, type PeRouterId, type RouterId } from "@/lib/sim-engine/scenarios/bgpVpls";

/**
 * Scene Adapter for the BGP-Signaled VPLS lesson's device-interior 3D
 * view. Every stage list and interface/link value below is derived
 * FROM BgpVplsState — this file makes no BGP/RT/label-block or
 * bridging decision itself. RR1 gets its own minimal, control-plane-
 * only trace: it never processes a customer packet.
 */

const CE_PIPELINE: ProcessingStage[] = [
  { id: "ac", label: "Attachment Circuit" },
  { id: "deliver", label: "Deliver / Receive" },
];
const PE_PIPELINE: ProcessingStage[] = [
  { id: "ingress", label: "Ingress (AC or PW)" },
  { id: "learn", label: "Learn Source MAC" },
  { id: "lookup", label: "Destination Lookup" },
  { id: "decide", label: "Forwarding Decision (Split Horizon)" },
  { id: "encap", label: "Label Push / Pop" },
  { id: "deliver", label: "Deliver / Forward" },
];
const RR_PIPELINE: ProcessingStage[] = [
  { id: "receive", label: "Receive VPLS NLRI" },
  { id: "reflect", label: "Reflect To Other Clients" },
];
const TRANSIT_PIPELINE: ProcessingStage[] = [
  { id: "ingress", label: "MPLS Ingress" },
  { id: "label-lookup", label: "Top (Transport) Label Lookup" },
  { id: "transport-forward", label: "Transport Forwarding" },
  { id: "forward", label: "Forward (Inner Service Label Untouched)" },
];

const PE_STAGE_ORDER = PE_PIPELINE.map((s) => s.id);
function stageForAction(action: string): string {
  switch (action) {
    case "AC_INGRESS":
    case "PW_INGRESS":
      return "ingress";
    case "LEARN_SOURCE":
      return "learn";
    case "LOOKUP_DEST":
    case "PW_LOOKUP":
      return "lookup";
    case "REPLICATE":
    case "SPLIT_HORIZON_BLOCK":
      return "decide";
    case "PUSH_PW":
    case "PUSH_TRANSPORT":
    case "SWAP_TRANSPORT":
    case "POP_TRANSPORT":
      return "encap";
    default:
      return "deliver";
  }
}
const allIds = (s: ProcessingStage[]) => s.map((x) => x.id);

function neighborLinks(router: RouterId): { neighbor: RouterId; link: LinkDef }[] {
  return LINKS.filter((l) => l.a === router || l.b === router).map((l) => ({ neighbor: (l.a === router ? l.b : l.a) as RouterId, link: l }));
}

export function traceFor(router: RouterId, state: BgpVplsState): DeviceProcessingTrace | undefined {
  if (router === "RR1") {
    const hop = state.bgpJourney[state.bgpJourney.length - 1];
    const base: DeviceProcessingTrace = { deviceId: "RR1", stages: RR_PIPELINE, completedStageIds: [] };
    if (!hop || hop.device !== "RR1") return base;
    const activeStageId = hop.action === "REFLECT" ? "reflect" : "receive";
    return { ...base, activeStageId, completedStageIds: activeStageId === "reflect" ? ["receive"] : [], packetBefore: hop.input, packetAfter: hop.output };
  }

  const nbrs = neighborLinks(router);
  const ingressIfaceId = nbrs[0] ? `${router}-${nbrs[0].neighbor}` : undefined;
  const egressIfaceId = nbrs[1] ? `${router}-${nbrs[1].neighbor}` : undefined;
  const hops = state.journey.filter((h) => h.device === router);
  const hop = hops[hops.length - 1];
  const isCurrent = state.journey.length > 0 && state.journey[state.journey.length - 1].device === router;

  if (router === "CE1" || router === "CE2" || router === "CE3") {
    const base: DeviceProcessingTrace = { deviceId: router, ingressInterfaceId: ingressIfaceId, stages: CE_PIPELINE, completedStageIds: [] };
    if (!hop) return base;
    if (isCurrent) return { ...base, activeStageId: hop.action === "AC_EGRESS" ? "deliver" : "ac", completedStageIds: hop.action === "AC_EGRESS" ? ["ac"] : [], packetBefore: hop.input, packetAfter: hop.output };
    return { ...base, completedStageIds: allIds(CE_PIPELINE), packetBefore: hop.input, packetAfter: hop.output };
  }

  if (PE_ROUTERS.includes(router as PeRouterId)) {
    const base: DeviceProcessingTrace = { deviceId: router, ingressInterfaceId: ingressIfaceId, egressInterfaceId: egressIfaceId, stages: PE_PIPELINE, completedStageIds: [] };
    if (!hop) return base;
    const activeStageId = stageForAction(hop.action);
    const activeIdx = PE_STAGE_ORDER.indexOf(activeStageId);
    const completed = PE_STAGE_ORDER.slice(0, isCurrent ? activeIdx : activeIdx + 1);
    if (isCurrent) return { ...base, activeStageId, completedStageIds: completed, packetBefore: hop.input, packetAfter: hop.output };
    return { ...base, completedStageIds: allIds(PE_PIPELINE), packetBefore: hop.input, packetAfter: hop.output };
  }

  // P1, P2, P3 — ordinary transport transit, no BGP/VPLS bridge state.
  const base: DeviceProcessingTrace = { deviceId: router, ingressInterfaceId: ingressIfaceId, egressInterfaceId: egressIfaceId, stages: TRANSIT_PIPELINE, completedStageIds: [] };
  if (!hop) return base;
  if (isCurrent) return { ...base, activeStageId: "forward", completedStageIds: ["ingress", "label-lookup", "transport-forward"], packetBefore: hop.input, packetAfter: hop.output };
  return { ...base, completedStageIds: allIds(TRANSIT_PIPELINE), packetBefore: hop.input, packetAfter: hop.output };
}

export function packetFramesFor(state: BgpVplsState): PacketStackFrame[] | undefined {
  if (!state.packet) return undefined;
  const labelFrames: PacketStackFrame[] = state.packet.labels.map((l, idx) => ({
    id: `label-${idx}`,
    text: `${l.purpose === "transport" ? "Transport" : "Service"} ${l.value}`,
    tone: l.purpose === "transport" ? "transport" : "vpn",
    justChanged: idx === 0,
  }));
  return [...labelFrames, { id: "eth", text: "Ethernet", tone: "generic" }];
}

export function interfacesFor(router: RouterId, state: BgpVplsState): DeviceInterfaceData[] {
  if (router === "RR1") {
    return PE_ROUTERS.map((pe) => ({ id: `RR1-${pe}`, name: `to-${pe}`, status: state.mpBgpUp ? "up" : "down", neighborId: pe, neighborLabel: pe, linkType: "Internal (iBGP)", mtu: 1500, protocols: ["BGP"], role: "idle" as const, extra: [{ label: "AFI/SAFI", value: "L2VPN / VPLS" }, { label: "RR Relationship", value: "Client" }] }));
  }
  const ac = resolveAttachmentCircuit(state.acs, router);
  return neighborLinks(router).map(({ neighbor, link }) => ({
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
}

export function linkDetailFor(linkId: string, state: BgpVplsState): LinkDetail | undefined {
  const link = LINKS.find((l) => l.id === linkId);
  if (!link) return undefined;
  const isAccessLink = link.igpMetric === undefined;
  const acA = PE_ROUTERS.includes(link.a as PeRouterId) ? resolveAttachmentCircuit(state.acs, link.a) : undefined;
  const acB = PE_ROUTERS.includes(link.b as PeRouterId) ? resolveAttachmentCircuit(state.acs, link.b) : undefined;
  const linkUp = isAccessLink ? (acA?.up ?? acB?.up ?? true) : true;
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
