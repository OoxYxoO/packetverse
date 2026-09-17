import type { DeviceInterfaceData, DeviceProcessingTrace, LinkDetail, PacketStackFrame, ProcessingStage } from "@/components/network3d/types";
import { LINKS, MTU_NODES, PE_ROUTERS, resolveAttachmentCircuits, spokePairFor, peSpokePair, spokeUp, pwUpBetween, type HvplsState, type LinkDef, type RouterId, type PeId, type MtuId } from "@/lib/sim-engine/scenarios/hVpls";

/**
 * Scene Adapter for H-VPLS's device-interior 3D view. Every stage list
 * and interface/link value below is derived FROM HvplsState — no
 * bridging, port-role, or split-horizon decision is made in this file.
 */

const CE_PIPELINE: ProcessingStage[] = [
  { id: "ac", label: "Attachment Circuit" },
  { id: "deliver", label: "Deliver / Receive" },
];
/** Shared by both MTU-s and PE-rs — the same conceptual bridge pipeline runs at both tiers, just over different port roles. */
const BRIDGE_PIPELINE: ProcessingStage[] = [
  { id: "ingress", label: "Ingress (AC / Spoke / Mesh)" },
  { id: "learn", label: "Learn Source MAC" },
  { id: "lookup", label: "Destination Lookup" },
  { id: "decide", label: "Forwarding Decision (Hierarchical Split Horizon)" },
  { id: "encap", label: "Label Push / Pop" },
  { id: "deliver", label: "Deliver / Forward" },
];
const BRIDGE_STAGE_ORDER = BRIDGE_PIPELINE.map((s) => s.id);

function stageForAction(action: string): string {
  switch (action) {
    case "AC_INGRESS":
    case "SPOKE_INGRESS":
    case "MESH_INGRESS":
      return "ingress";
    case "LEARN_SOURCE":
      return "learn";
    case "LOOKUP_DEST":
      return "lookup";
    case "LOCAL_SWITCH":
    case "REPLICATE":
    case "MESH_SPLIT_HORIZON_BLOCK":
      return "decide";
    case "PUSH_SPOKE":
    case "PUSH_MESH":
    case "POP_TRANSPORT":
      return "encap";
    default:
      return "deliver";
  }
}
const allIds = (s: ProcessingStage[]) => s.map((x) => x.id);

function neighborLinks(router: RouterId): { neighbor: RouterId; link: LinkDef }[] {
  return LINKS.filter((l) => l.a === router || l.b === router).map((l) => ({ neighbor: l.a === router ? l.b : l.a, link: l }));
}

export function traceFor(router: RouterId, state: HvplsState): DeviceProcessingTrace | undefined {
  const nbrs = neighborLinks(router);
  const ingressIfaceId = nbrs[0] ? `${router}-${nbrs[0].neighbor}` : undefined;
  const egressIfaceId = nbrs[1] ? `${router}-${nbrs[1].neighbor}` : undefined;
  const hops = state.journey.filter((h) => h.device === router);
  const hop = hops[hops.length - 1];
  const isCurrent = state.journey.length > 0 && state.journey[state.journey.length - 1].device === router;

  if (router.startsWith("CE")) {
    const base: DeviceProcessingTrace = { deviceId: router, ingressInterfaceId: ingressIfaceId, stages: CE_PIPELINE, completedStageIds: [] };
    if (!hop) return base;
    if (isCurrent) return { ...base, activeStageId: hop.action === "AC_EGRESS" ? "deliver" : "ac", completedStageIds: hop.action === "AC_EGRESS" ? ["ac"] : [], packetBefore: hop.input, packetAfter: hop.output };
    return { ...base, completedStageIds: allIds(CE_PIPELINE), packetBefore: hop.input, packetAfter: hop.output };
  }

  // MTU-s and PE-rs both run the same bridge pipeline shape.
  const base: DeviceProcessingTrace = { deviceId: router, ingressInterfaceId: ingressIfaceId, egressInterfaceId: egressIfaceId, stages: BRIDGE_PIPELINE, completedStageIds: [] };
  if (!hop) return base;
  const activeStageId = stageForAction(hop.action);
  const activeIdx = BRIDGE_STAGE_ORDER.indexOf(activeStageId);
  const completed = BRIDGE_STAGE_ORDER.slice(0, isCurrent ? activeIdx : activeIdx + 1);
  if (isCurrent) return { ...base, activeStageId, completedStageIds: completed, packetBefore: hop.input, packetAfter: hop.output };
  return { ...base, completedStageIds: allIds(BRIDGE_PIPELINE), packetBefore: hop.input, packetAfter: hop.output };
}

export function packetFramesFor(state: HvplsState): PacketStackFrame[] | undefined {
  if (!state.packet) return undefined;
  const labelFrames: PacketStackFrame[] = state.packet.labels.map((l, idx) => ({
    id: `label-${idx}`,
    text: `${l.purpose === "transport" ? "Transport" : "PW"} ${l.value}`,
    tone: l.purpose === "transport" ? "transport" : "vpn",
    justChanged: idx === 0,
  }));
  return [...labelFrames, { id: "eth", text: "Ethernet", tone: "generic" }];
}

export function interfacesFor(router: RouterId, state: HvplsState): DeviceInterfaceData[] {
  const acs = router.startsWith("MTU") ? resolveAttachmentCircuits(state.acs, router as MtuId) : [];
  return neighborLinks(router).map(({ neighbor, link }) => {
    const ac = acs.find((a) => a.ceRouter === neighbor);
    const extra =
      link.tier === "mesh"
        ? [{ label: "Role", value: "MESH_PW" }]
        : link.tier === "spoke"
          ? [{ label: "Role", value: router.startsWith("PE") ? state.spokeRoleByPe[router as PeId] : "SPOKE_PW" }]
          : ac
            ? [{ label: "VLAN", value: String(ac.vlan) }, { label: "AC Status", value: ac.up ? "up" : "down" }]
            : undefined;
    return {
      id: `${router}-${neighbor}`,
      name: `to-${neighbor}`,
      status: "up" as const,
      neighborId: neighbor,
      neighborLabel: neighbor,
      linkType: link.tier === "mesh" ? "Core (Mesh PW)" : link.tier === "spoke" ? "Access (Spoke PW)" : "Access",
      mtu: 1500,
      protocols: link.tier === "access" ? ["Ethernet"] : ["MPLS"],
      role: "idle" as const,
      extra,
    };
  });
}

export function linkDetailFor(linkId: string, state: HvplsState): LinkDetail | undefined {
  const link = LINKS.find((l) => l.id === linkId);
  if (!link) return undefined;
  const linkUp =
    link.tier === "mesh"
      ? pwUpBetween(state.meshLinks, link.a as PeId, link.b as PeId)
      : link.tier === "spoke"
        ? spokeUp(state.spokeLinks, (link.a.startsWith("MTU") ? link.a : link.b) as MtuId)
        : true;
  return {
    aLabel: link.a,
    bLabel: link.b,
    aInterface: { id: `${link.a}-${link.b}`, name: `to-${link.b}`, status: linkUp ? "up" : "down", neighborId: link.b, neighborLabel: link.b, linkType: link.tier, mtu: 1500, protocols: link.tier === "access" ? ["Ethernet"] : ["MPLS"], role: "idle" },
    bInterface: { id: `${link.b}-${link.a}`, name: `to-${link.a}`, status: linkUp ? "up" : "down", neighborId: link.a, neighborLabel: link.a, linkType: link.tier, mtu: 1500, protocols: link.tier === "access" ? ["Ethernet"] : ["MPLS"], role: "idle" },
    status: linkUp ? "up" : "down",
    mtu: 1500,
    protocols: [{ label: "Tier", value: link.tier === "mesh" ? "Core Mesh PW" : link.tier === "spoke" ? "Spoke PW" : "Attachment Circuit" }],
  };
}

export const DEVICE_ROUTERS: RouterId[] = ["CE1", "CE2", "MTU1", "PE1", "CE3", "MTU2", "PE2", "PE3", "MTU3", "CE4"];
export { MTU_NODES, PE_ROUTERS, spokePairFor, peSpokePair };
