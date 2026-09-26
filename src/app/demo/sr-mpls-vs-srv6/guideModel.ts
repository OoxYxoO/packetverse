import {
  adjSidLabel,
  buildMplsRepairList,
  buildMplsTeSegments,
  buildRequirementMatrix,
  buildSrv6TeSegments,
  computeSharedTiLfaRepair,
  globalDt4SidText,
  HEADER_LAB_SEGMENT_COUNT,
  mplsStackBytes,
  nodeSidLabel,
  PE1_TRANSPORT_SOURCE,
  srv6TeSegmentName,
  srv6UncompressedBytes,
  testSrv6TeEndXUsdAlternative,
  VPN_LABEL,
} from "@/lib/sim-engine/scenarios/srMplsVsSrv6";
import { PLR_REPAIR_SOURCE } from "@/lib/sim-engine/scenarios/srv6TiLfa";
import { PE2_DT4_SID } from "@/lib/sim-engine/scenarios/srv6L3vpn";

/**
 * Values the capstone guides draw, read from the lesson's own builders —
 * the guide never retypes a label, S bit, SID or source address.
 */
export const TRANSPORT_LABEL = nodeSidLabel("PE2");
export const GLOBAL_DT4 = globalDt4SidText("PE2");
export const CUST_A_DT4 = PE2_DT4_SID.sidText;
export const VPN_LABEL_PE2 = VPN_LABEL.PE2;
export const TRANSPORT_SOURCE = PE1_TRANSPORT_SOURCE;
export const REPAIR_SOURCE = PLR_REPAIR_SOURCE;

const mplsTe = buildMplsTeSegments();
/** Top of stack first; S = 1 only on the bottom label. */
export const MPLS_TE_STACK = mplsTe.map((s, i) => ({
  label: s.type === "NODE" ? nodeSidLabel(s.owner) : adjSidLabel(s.owner, s.target!),
  meaning: s.type === "NODE" ? `Node-SID(${s.owner})` : `Adj-SID(${s.owner}→${s.target})`,
  s: i === mplsTe.length - 1 ? 1 : 0,
}));

const srv6Te = buildSrv6TeSegments();
/** Travel order. */
export const SRV6_TE_PROGRAM = srv6Te.map((s) => ({ name: srv6TeSegmentName(s), sid: s.sidText }));
/** SRH storage order: Segment List[0] = the final segment. */
export const SRV6_TE_SRH = [...SRV6_TE_PROGRAM].reverse().map((s, index) => ({ index, ...s }));
export const SRV6_TE_INITIAL_SL = SRV6_TE_PROGRAM.length - 1;

const repair = computeSharedTiLfaRepair();
export const SHARED_REPAIR = {
  repairNode: repair.repairNode,
  mergeTarget: repair.mergeTarget,
  oif: repair.outgoingInterface,
  srv6Sid: repair.repairList.sids[0]?.sidText,
  mplsLabels: buildMplsRepairList(repair).map((s) => s.label),
};

export const HEADER_SEGMENTS = HEADER_LAB_SEGMENT_COUNT;
export const HEADER_MPLS_BYTES = mplsStackBytes(HEADER_LAB_SEGMENT_COUNT);
export const HEADER_SRV6_BYTES = srv6UncompressedBytes(HEADER_LAB_SEGMENT_COUNT);

export const REQUIREMENT_MATRIX = buildRequirementMatrix();

const usd = testSrv6TeEndXUsdAlternative();
/** The advanced alternative: one ADDITIONAL steering SID around the existing transport packet. */
export const USD_ALTERNATIVE = {
  steeringSid: usd.steeringSid.sidText,
  steeringSource: usd.steeredPacket.repairOuter?.srcText,
  transportDa: usd.outcome.exposedPacket?.vpnOuter?.daText,
  forwardedTo: usd.outcome.forwardedTo,
  steeringSidCount: usd.steeringSidCount,
  transportSidCount: usd.transportSidCount,
};
