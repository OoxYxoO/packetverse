import type { DeviceInterfaceData, DeviceProcessingTrace, LinkDetail, PacketStackFrame, ProcessingStage } from "@/components/network3d/types";
import { LINKS, csidHexText, liveStructures, NEXT_CSID_VALUE, ordinarySidText, srv6CsidSteps, validateSidStructureForCompression, type RouterId, type Srv6CsidState } from "@/lib/sim-engine/scenarios/srv6Csid";

/**
 * All SRv6-CSID-specific reasoning for the 3D device interior lives
 * here (ARCHITECTURE.md §4/§7) — never inside network3d/*.
 */

const HEADEND_STAGES: ProcessingStage[] = [
  { id: "select-program", label: "Select Logical Program" },
  { id: "validate-structures", label: "Validate SID Structures" },
  { id: "compress", label: "Compress Eligible Runs" },
  { id: "construct-packet", label: "Construct DA + SRH" },
];
const NEXT_ENDPOINT_STAGES: ProcessingStage[] = [
  { id: "match", label: "Local SID Match" },
  { id: "check-argument", label: "Check Argument" },
  { id: "advance", label: "Shift or Cross Boundary" },
  { id: "forward", label: "Forward (FIB or Adjacency)" },
];
const REPLACE_ENDPOINT_STAGES: ProcessingStage[] = [
  { id: "match", label: "Local SID Match" },
  { id: "check-index", label: "Check Index / Packed Container" },
  { id: "reconstruct", label: "Reconstruct Valid SID" },
  { id: "forward", label: "Forward" },
];

const COMPRESS_STEP_IDS = new Set(["compress-first-container", "not-five-ipv6-addresses", "compress-second-container", "full-srh-two-containers", "fault-consequence", "apply-repair", "one-container-intro", "endx-setup", "final-service-sid-experiment", "replace-first-container", "replace-packed-containers"]);

export function traceFor(router: RouterId, state: Srv6CsidState, currentStepId: string): DeviceProcessingTrace | undefined {
  if (router === "R1") {
    const active = COMPRESS_STEP_IDS.has(currentStepId) ? (currentStepId.includes("second") ? "compress" : currentStepId.includes("full-srh") ? "construct-packet" : "validate-structures") : undefined;
    return { deviceId: router, stages: HEADEND_STAGES, activeStageId: active, completedStageIds: active ? HEADEND_STAGES.slice(0, HEADEND_STAGES.findIndex((s) => s.id === active)).map((s) => s.id) : [], forwardingAction: "Imposes DA + optional SRH toward the first compressed entry." };
  }

  const isReplaceLab = currentStepId.startsWith("replace-") || currentStepId === "predict-packed-not-copied" || currentStepId === "predict-replace-index-order" || currentStepId === "predict-replace-capacity";
  const journey = isReplaceLab ? state.replaceJourney : state.journey;
  const journeyIndex = journey.findIndex((h) => h.router === router);
  if (journeyIndex === -1) return undefined;
  const isCurrentActor = journeyIndex === journey.length - 1;
  const hop = journey[journeyIndex];
  const stages = isReplaceLab ? REPLACE_ENDPOINT_STAGES : NEXT_ENDPOINT_STAGES;
  const activeStageId = isCurrentActor ? (hop.action === "FINAL" ? "forward" : hop.action.includes("CROSS") ? "advance" : "advance") : undefined;
  const completedStageIds = isCurrentActor ? stages.slice(0, stages.findIndex((s) => s.id === activeStageId)).map((s) => s.id) : stages.map((s) => s.id);
  return {
    deviceId: router,
    stages,
    activeStageId,
    completedStageIds,
    packetBefore: hop.input,
    packetAfter: hop.output,
    forwardingAction: hop.action,
  };
}

export function interfacesFor(router: RouterId, state: Srv6CsidState, currentStepId: string): DeviceInterfaceData[] {
  void currentStepId;
  const structure = liveStructures(state)[router];
  const validation = validateSidStructureForCompression(structure);
  return LINKS.filter((l) => l.a === router || l.b === router).map((l) => {
    const neighbor = l.a === router ? l.b : l.a;
    return {
      id: l.id,
      name: `to ${neighbor}`,
      status: "up",
      neighborId: neighbor,
      neighborLabel: neighbor,
      linkType: "IPv6 core",
      role: "idle",
      extra: [
        { label: "Locator-Node", value: router === "R1" ? "—" : csidHexText(NEXT_CSID_VALUE[router]) },
        { label: "Structure", value: structure ? `LBL=${structure.lbl} LNL=${structure.lnl} FL=${structure.fl} AL=${structure.al}` : "unknown" },
        { label: "Compressibility", value: validation.validity },
      ],
    };
  });
}

export function packetFramesFor(state: Srv6CsidState, activeStageId?: string): PacketStackFrame[] | undefined {
  if (!activeStageId) return undefined;
  const pkt = state.packet ?? state.replacePacket;
  if (!pkt) return undefined;
  return [
    { id: "outer", text: "Outer IPv6 + SRH", tone: "ip" },
    ...(pkt.srh ? [{ id: "srh", text: `SRH (SL=${pkt.srh.segmentsLeft})`, tone: "vpn" as const }] : []),
  ];
}

function endpointInterface(router: RouterId, neighbor: RouterId): DeviceInterfaceData {
  return { id: `${router}-${neighbor}`, name: `to ${neighbor}`, status: "up", neighborId: neighbor, neighborLabel: neighbor, role: "idle" };
}

export function linkDetailFor(linkId: string, state: Srv6CsidState): LinkDetail | undefined {
  const link = LINKS.find((l) => l.id === linkId);
  if (!link) return undefined;
  return {
    aLabel: link.a,
    bLabel: link.b,
    aInterface: endpointInterface(link.a, link.b),
    bInterface: endpointInterface(link.b, link.a),
    status: "up",
    mtu: 1500,
    protocols: [{ label: "IGP Metric", value: String(link.metric) }],
    currentTraffic: state.packetAt === link.a || state.packetAt === link.b ? "Compressed SRv6 packet transiting" : undefined,
  };
}

export const ALL_STEP_IDS = srv6CsidSteps.map((s) => s.id);
export function ordinarySidTextFor(router: RouterId): string {
  return ordinarySidText(router);
}
