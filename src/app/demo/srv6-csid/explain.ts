import type { NodeExplanation } from "@/components/network3d/types";
import { csidHexText, HEADEND, liveStructures, LOCATOR_BLOCK_TEXT, NEXT_CSID_VALUE, ordinarySidText, validateSidStructureForCompression, type RouterId, type Srv6CsidState } from "@/lib/sim-engine/scenarios/srv6Csid";
import { phasePacketFor, physicalPathFor, walkFor } from "./deviceTrace";

const DEVICE_TYPE: Record<RouterId, string> = { R1: "Headend Router", R2: "Router", R3: "Router", R4: "Router", R5: "Router", R6: "Router", R7: "Router", R8: "Destination Router" };

function roleFor(state: Srv6CsidState, nodeId: RouterId): string {
  if (nodeId === HEADEND) return "Compresses the logical program";
  if (nodeId === "R8") return "Final segment / service SID owner";
  const faultNote = state.mainFault.active && state.mainFault.targetRouter === nodeId ? " (fault target)" : state.challengeFault.active && state.challengeFault.targetRouter === nodeId ? " (challenge fault target)" : "";
  return `CSID owner (NEXT-CSID / REPLACE-CSID endpoint)${faultNote}`;
}

/** Tense is derived from the CURRENT walk only (deviceTrace.walkFor) — a hop recorded in an earlier lab is never presented as this router's current action. */
export function explainNode(state: Srv6CsidState, nodeId: RouterId, stepId: string): NodeExplanation {
  const base: NodeExplanation = { id: nodeId, name: nodeId, deviceType: DEVICE_TYPE[nodeId], role: roleFor(state, nodeId), currentAction: "" };

  if (nodeId === HEADEND) {
    const pkt = phasePacketFor(state, stepId);
    return {
      ...base,
      controlPlaneRole: "Learns every router's advertised SID structure and selects the logical segment program.",
      dataPlaneRole: "Validates structures, compresses eligible runs into NEXT-CSID/REPLACE-CSID containers, and imposes DA + optional SRH.",
      currentAction: pkt ? "Built a compressed packet for the current lab — see the Packet tab." : "Idle — no compressed packet built yet.",
      tables: [{ title: "R1 — Locator-Block", rows: [{ label: "Shared Block", value: LOCATOR_BLOCK_TEXT }] }],
    };
  }

  const structures = liveStructures(state);
  const structure = structures[nodeId];
  const validation = validateSidStructureForCompression(structure);
  const walk = walkFor(state, stepId);
  const hops = walk?.hops ?? [];
  const idx = hops.map((h) => h.router).lastIndexOf(nodeId);
  const hop = idx !== -1 ? hops[idx] : undefined;
  const onPath = physicalPathFor(state, stepId).includes(nodeId);

  let currentAction = `Idle — owns Locator-Node ${csidHexText(NEXT_CSID_VALUE[nodeId])}, structure ${validation.validity}.`;
  if (hop) currentAction = `${idx === hops.length - 1 ? "" : "Already processed: "}${hop.lookup} → ${hop.action}`;
  else if (onPath) currentAction = walk?.at === nodeId ? "Packet has arrived; local processing is the next step." : "Ordinary IPv6 transit for this packet — no local CSID processing.";

  return {
    ...base,
    controlPlaneRole: `Advertises Locator-Node ${csidHexText(NEXT_CSID_VALUE[nodeId])} under ${LOCATOR_BLOCK_TEXT}, plus its SID structure (LBL/LNL/FL/AL) for compression eligibility.`,
    dataPlaneRole: nodeId === "R8" ? "Final segment — executes NEXT-CSID/REPLACE-CSID advancement itself, or End.DT4 as the final SID in the REPLACE-CSID lab." : "Matches the active CSID against its own Locator-Node, then executes NEXT-CSID or REPLACE-CSID advancement; forwards ordinary IPv6 when it is not the active CSID's owner.",
    currentAction,
    packetBefore: hop?.input,
    packetAfter: hop?.output,
    tables: [
      { title: `${nodeId} — SID Structure`, rows: [{ label: "Ordinary SID", value: ordinarySidText(nodeId) }, { label: "Structure", value: structure ? `LBL=${structure.lbl} LNL=${structure.lnl} FL=${structure.fl} AL=${structure.al}` : "unknown" }, { label: "Compressibility", value: validation.validity }] },
    ],
    note: validation.validity !== "VALID" ? `This router's structure is currently ${validation.validity} — it will NOT be compressed, but it remains a fully reachable ordinary SID.` : undefined,
  };
}
