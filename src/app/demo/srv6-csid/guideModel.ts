import {
  ALL_ROUTERS,
  BASE_PROGRAM,
  buildDaAndSrh,
  compressNextCsidRun,
  compressReplaceCsidRun,
  computeNextCsidCapacity,
  computeReplaceCsidCapacity,
  DEFAULT_STRUCTURE,
  executeNextCsidAdvance,
  executeReplaceCsidAdvance,
  FAULTY_STRUCTURE,
  LOCATOR_BLOCK_TEXT,
  NEXT_CSID_LAYOUT,
  REPLACE_CSID_LAYOUT,
  REPLACE_PROGRAM,
  replaceIndexBits,
  replacePackedPositionForTravelIndex,
  replacePackedSlot,
  validateSidStructureForCompression,
  type SidStructure,
} from "@/lib/sim-engine/scenarios/srv6Csid";
import { fmtIpv6 } from "@/lib/sim-engine/scenarios/srv6Foundations";

/**
 * Values the CSID guides draw, produced by running the lesson's OWN
 * compression and advance functions once at load — the guide never
 * retypes a DA, Segments Left, Hop Limit, Index or packed position.
 */
const VALID = Object.fromEntries(ALL_ROUTERS.map((r) => [r, DEFAULT_STRUCTURE])) as Record<(typeof ALL_ROUTERS)[number], SidStructure>;
const hex4 = (n: number) => n.toString(16);

export const STRUCTURE = DEFAULT_STRUCTURE;
export const FAULTY = FAULTY_STRUCTURE;
export const FAULTY_VALIDATION = validateSidStructureForCompression(FAULTY_STRUCTURE);
export const UNKNOWN_VALIDATION = validateSidStructureForCompression(undefined);
export const BLOCK_TEXT = LOCATOR_BLOCK_TEXT;
export const NEXT_CAPACITY = computeNextCsidCapacity(NEXT_CSID_LAYOUT);
export const REPLACE_CAPACITY = computeReplaceCsidCapacity(REPLACE_CSID_LAYOUT);
export const REPLACE_INDEX_BITS = replaceIndexBits(REPLACE_CSID_LAYOUT);
export const NEXT_LAYOUT = NEXT_CSID_LAYOUT;
export const REPLACE_LAYOUT = REPLACE_CSID_LAYOUT;

// ---------------------------------------------------------------- NEXT-CSID
const nextPlan = compressNextCsidRun(BASE_PROGRAM, VALID);
const nextEncoded = buildDaAndSrh(nextPlan);
export const NEXT_CONTAINERS = nextPlan.entries.map((e) => ({ text: fmtIpv6(e.hextets), owners: e.segments.map((s) => s.owner) }));
export const NEXT_SRH_STORAGE = (nextEncoded.srh?.segmentList ?? []).map((s) => ({ index: s.index, text: fmtIpv6(s.hextets), owners: s.csidOwners ?? [] }));

export interface NextHop {
  router: string;
  daBefore: string;
  daAfter: string;
  slBefore: number;
  slAfter: number;
  hlBefore: number;
  hlAfter: number;
  boundary: boolean;
}
/** Each End + NEXT-CSID processing point of the main program (R2…R7), from the real advance function. */
export const NEXT_WALK: NextHop[] = (() => {
  const hops: NextHop[] = [];
  let da = nextEncoded.daHextets;
  let srh = nextEncoded.srh;
  let hl = 64;
  const order = BASE_PROGRAM.map((s) => s.owner);
  for (const router of order.slice(0, -1)) {
    const r = executeNextCsidAdvance({ daHextets: da, layout: NEXT_CSID_LAYOUT, hopLimit: hl, srh, endpointBehavior: "END" });
    hops.push({ router, daBefore: fmtIpv6(da), daAfter: fmtIpv6(r.newDaHextets), slBefore: srh?.segmentsLeft ?? 0, slAfter: r.newSrh?.segmentsLeft ?? srh?.segmentsLeft ?? 0, hlBefore: hl, hlAfter: r.newHopLimit, boundary: r.segmentsLeftChanged });
    da = r.newDaHextets;
    srh = r.newSrh ?? srh;
    hl = r.newHopLimit;
  }
  return hops;
})();

// ---------------------------------------------------------------- REPLACE-CSID
const replacePlan = compressReplaceCsidRun(REPLACE_PROGRAM, VALID);
const replaceEncoded = buildDaAndSrh(replacePlan);
const packed = replacePlan.entries.find((e) => e.kind === "REPLACE_CSID_PACKED");
/** Physical packed positions 0…K-1 exactly as stored (position 0 = most significant bits). */
export const REPLACE_SLOTS = Array.from({ length: REPLACE_CAPACITY }, (_, position) => {
  const bits = packed ? replacePackedSlot(packed.hextets, position) : [];
  // Owner = the packed segment whose travel index maps to this physical position (the scenario's own mapping).
  const owner = packed?.segments.find((_, j) => replacePackedPositionForTravelIndex(j) === position);
  return { position, text: bits.map(hex4).join(":"), owner: owner?.owner, behavior: owner?.behavior };
});
export const REPLACE_FIRST_DA = fmtIpv6(replaceEncoded.daHextets);

export interface ReplaceHop {
  router: string;
  indexBefore: number;
  indexAfter: number;
  position?: number;
  hlBefore: number;
  hlAfter: number;
  daAfter: string;
  slAfter: number;
}
/** R2, R3, R4 each advance once; the last DA is the R8 End.DT4 SID. */
export const REPLACE_WALK: ReplaceHop[] = (() => {
  const hops: ReplaceHop[] = [];
  let da = replaceEncoded.daHextets;
  let srh = replaceEncoded.srh;
  let hl = 64;
  for (const router of REPLACE_PROGRAM.slice(0, -1).map((s) => s.owner)) {
    const r = executeReplaceCsidAdvance({ daHextets: da, layout: REPLACE_CSID_LAYOUT, hopLimit: hl, srh });
    hops.push({ router, indexBefore: r.indexBefore, indexAfter: r.indexAfter, position: r.packedPosition, hlBefore: hl, hlAfter: r.newHopLimit, daAfter: fmtIpv6(r.newDaHextets), slAfter: r.newSrh?.segmentsLeft ?? srh?.segmentsLeft ?? 0 });
    da = r.newDaHextets;
    srh = r.newSrh ?? srh;
    hl = r.newHopLimit;
  }
  return hops;
})();
export const REPLACE_FINAL_DA = REPLACE_WALK.at(-1)?.daAfter ?? REPLACE_FIRST_DA;
