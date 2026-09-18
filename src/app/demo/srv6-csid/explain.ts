import type { NodeExplanation } from "@/components/network3d/types";
import { csidHexText, liveStructures, LOCATOR_BLOCK_TEXT, NEXT_CSID_VALUE, ordinarySidText, validateSidStructureForCompression, type RouterId, type Srv6CsidState } from "@/lib/sim-engine/scenarios/srv6Csid";

const DEVICE_TYPE: Record<RouterId, string> = { R1: "Headend Router", R2: "Router", R3: "Router", R4: "Router", R5: "Router", R6: "Router", R7: "Router", R8: "Destination Router" };
const ROLE: Record<RouterId, string> = { R1: "Compresses the logical program", R2: "NEXT-CSID / REPLACE-CSID endpoint", R3: "NEXT-CSID / REPLACE-CSID endpoint", R4: "NEXT-CSID endpoint (fault target)", R5: "NEXT-CSID endpoint", R6: "NEXT-CSID endpoint (challenge fault target)", R7: "NEXT-CSID endpoint", R8: "Final segment / service SID owner" };

export function explainNode(state: Srv6CsidState, nodeId: RouterId): NodeExplanation {
  const base: NodeExplanation = { id: nodeId, name: nodeId, deviceType: DEVICE_TYPE[nodeId], role: ROLE[nodeId], currentAction: "" };

  if (nodeId === "R1") {
    return {
      ...base,
      controlPlaneRole: "Learns every router's advertised SID structure and selects the logical segment program.",
      dataPlaneRole: "Validates structures, compresses eligible runs into NEXT-CSID/REPLACE-CSID containers, and imposes DA + optional SRH.",
      currentAction: state.packet ? "Imposed a compressed packet — see the Packet tab." : "Idle — no compressed packet built yet.",
      tables: [{ title: "R1 — Locator-Block", rows: [{ label: "Shared Block", value: LOCATOR_BLOCK_TEXT }] }],
    };
  }

  const structures = liveStructures(state);
  const structure = structures[nodeId];
  const validation = validateSidStructureForCompression(structure);
  const journey = [...state.journey, ...state.replaceJourney];
  const journeyIndex = journey.map((h) => h.router).lastIndexOf(nodeId);
  const hop = journeyIndex !== -1 ? journey[journeyIndex] : undefined;
  const isCurrentActor = journeyIndex !== -1 && journeyIndex === journey.length - 1;

  let currentAction = `Idle — owns Locator-Node ${csidHexText(NEXT_CSID_VALUE[nodeId])}, structure ${validation.validity}.`;
  if (isCurrentActor && hop) currentAction = `${hop.lookup} → ${hop.action}`;
  else if (hop) currentAction = `Already processed: ${hop.lookup} → ${hop.action}`;

  return {
    ...base,
    controlPlaneRole: `Advertises Locator-Node ${csidHexText(NEXT_CSID_VALUE[nodeId])} under ${LOCATOR_BLOCK_TEXT}, plus its SID structure (LBL/LNL/FL/AL) for compression eligibility.`,
    dataPlaneRole: nodeId === "R8" ? "Final segment — may execute NEXT-CSID/REPLACE-CSID advancement itself, or an ordinary service behavior (End.DT4) if it's the unflavored final SID." : "Matches the active CSID against its own Locator-Node, then executes NEXT-CSID or REPLACE-CSID advancement per the active lab.",
    currentAction,
    packetBefore: hop?.input,
    packetAfter: hop?.output,
    tables: [
      { title: `${nodeId} — SID Structure`, rows: [{ label: "Ordinary SID", value: ordinarySidText(nodeId) }, { label: "Structure", value: structure ? `LBL=${structure.lbl} LNL=${structure.lnl} FL=${structure.fl} AL=${structure.al}` : "unknown" }, { label: "Compressibility", value: validation.validity }] },
    ],
    note: validation.validity !== "VALID" ? `This router's structure is currently ${validation.validity} — it will NOT be compressed, but it remains a fully reachable ordinary SID.` : undefined,
  };
}
