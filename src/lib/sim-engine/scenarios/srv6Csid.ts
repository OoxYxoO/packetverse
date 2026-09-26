import type { PacketLayer, PacketVisual, ScenarioStep } from "@/lib/sim-engine/types";
import { buildSrv6Sid, fmtIpv6, type Hextets } from "./srv6Foundations";
import { FUNCTION, BEHAVIOR_LABEL } from "./srv6EndpointBehaviors";
import { PE2_DT4_SID } from "./srv6L3vpn";
import { MULTI_SID_INTERMEDIATE, MULTI_SID_FINAL } from "./srv6TiLfa";

/**
 * SRv6 Compressed SID / CSID / uSID (RFC 9800 — Compressed SRv6 Segment
 * List Encoding). Follows SRv6 Protection / TI-LFA. Central question: a
 * long SRv6 program repeats the same Locator-Block, and unused padding,
 * across every 128-bit segment — why carry all of that weight eight
 * times when only the Locator-Node/Function actually varies per hop?
 *
 * Naming: the UI title says "CSID / uSID" because "uSID" is the widely
 * used historical/industry term associated with the NEXT-CSID style.
 * RFC 9800 is authoritative here and never says "uSID" — every
 * standards-facing explanation in this file uses CSID, NEXT-CSID,
 * REPLACE-CSID, Locator-Block, Locator-Node, Function, Argument, LBL,
 * LNL, FL, AL, LNFL.
 *
 * Topology (chain + two alternate links used only for the End.X
 * experiments — never part of the base compressed sequence's shortest
 * path):
 *
 *   R1 ─ R2 ─ R3 ─ R4 ─ R5 ─ R6 ─ R7 ─ R8
 *             └────(50)───┘         (alt, unused by default)
 *                          └───(50)──┘ R6-R8 (alt, used by the End.X lab)
 *
 * Reuse decisions (checked against the five completed SRv6 lessons
 * before writing anything new):
 *   - `buildSrv6Sid` / `fmtIpv6` — generic SID/format
 *     helpers from srv6Foundations.ts, reused directly.
 *   - `FUNCTION.END` / `FUNCTION.END_X` / `FUNCTION.END_DT4` and
 *     `BEHAVIOR_LABEL` from srv6EndpointBehaviors.ts — the SAME
 *     numeric function-id allocations every other SRv6 lesson uses.
 *     This lesson never redefines what those values mean; it only adds
 *     a compressed ENCODING on top of them.
 *   - `PE2_DT4_SID` from srv6L3vpn.ts, imported by literal value (not
 *     its RouterId/state types) for one small experiment (§NEXT-CSID
 *     End.DT4 integration) — exactly the pattern srv6TiLfa.ts already
 *     established for cross-lesson value reuse.
 *   - `MULTI_SID_INTERMEDIATE`/`MULTI_SID_FINAL` from srv6TiLfa.ts, for
 *     one read-only "what would this repair list weigh if compressed"
 *     comparison — their real byte cost is reused, TI-LFA's repair
 *     computation itself is never re-derived here.
 *   - RouterId is its own fresh 8-node chain, NOT a widened union of any
 *     prior lesson's RouterId — per the project's no-cross-lesson-
 *     type-coupling rule.
 *
 * Scope boundary (deliberate): this lesson fully teaches NEXT-CSID and
 * REPLACE-CSID compression/expansion, SID-structure validation for
 * compression, partial (mixed compressed/ordinary) segment lists, the
 * End vs End.X vs End.DT4 compression-flavor distinction, and one fault
 * (a single router's advertised SID structure is wrong) with a genuine
 * "reachable but not producing the expected compressed encoding"
 * incident. It explicitly PREVIEWS (never implements as a real control
 * plane) IS-IS/OSPF CSID advertisement (RFC 9352/RFC 9513), Global/
 * Local ID Block allocation policy, and multi-flavor mixed lists beyond
 * one small conceptual example. It does not implement SRLG computation,
 * a second SR Policy engine, or BGP CSID signaling. SR-MPLS vs SRv6
 * capstone comparison is the next, separate lesson.
 */

// ---------------------------------------------------------------------------
// Topology
// ---------------------------------------------------------------------------

export type RouterId = "R1" | "R2" | "R3" | "R4" | "R5" | "R6" | "R7" | "R8";
export const ALL_ROUTERS: RouterId[] = ["R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8"];
export const HEADEND: RouterId = "R1";

export type LinkId = "R1-R2" | "R2-R3" | "R3-R4" | "R4-R5" | "R5-R6" | "R6-R7" | "R7-R8" | "R3-R5" | "R6-R8";
export interface LinkDef {
  id: LinkId;
  a: RouterId;
  b: RouterId;
  metric: number;
}
export const LINKS: LinkDef[] = [
  { id: "R1-R2", a: "R1", b: "R2", metric: 10 },
  { id: "R2-R3", a: "R2", b: "R3", metric: 10 },
  { id: "R3-R4", a: "R3", b: "R4", metric: 10 },
  { id: "R4-R5", a: "R4", b: "R5", metric: 10 },
  { id: "R5-R6", a: "R5", b: "R6", metric: 10 },
  { id: "R6-R7", a: "R6", b: "R7", metric: 10 },
  { id: "R7-R8", a: "R7", b: "R8", metric: 10 },
  // Alternate physical links — deliberately HIGHER metric than the
  // chain they shortcut, so an End.X-forced adjacency is visibly
  // DIFFERENT from what ordinary IPv6 FIB would have chosen.
  { id: "R3-R5", a: "R3", b: "R5", metric: 50 },
  { id: "R6-R8", a: "R6", b: "R8", metric: 50 },
];

export const GRAPH_NODES = [
  { id: "R1", label: "R1", x: 4, y: 50, subLabel: "Headend" },
  { id: "R2", label: "R2", x: 16, y: 50 },
  { id: "R3", label: "R3", x: 28, y: 50 },
  { id: "R4", label: "R4", x: 40, y: 50 },
  { id: "R5", label: "R5", x: 52, y: 50 },
  { id: "R6", label: "R6", x: 64, y: 50 },
  { id: "R7", label: "R7", x: 76, y: 50 },
  { id: "R8", label: "R8", x: 92, y: 50, subLabel: "Destination" },
];
export const GRAPH_EDGES: { id: LinkId; a: RouterId; b: RouterId }[] = LINKS.map((l) => ({ id: l.id, a: l.a, b: l.b }));

function neighborsOf(router: RouterId, links: LinkDef[]): { to: RouterId; metric: number }[] {
  const out: { to: RouterId; metric: number }[] = [];
  for (const l of links) {
    if (l.a === router) out.push({ to: l.b, metric: l.metric });
    if (l.b === router) out.push({ to: l.a, metric: l.metric });
  }
  return out;
}
function allSimplePaths(links: LinkDef[], from: RouterId, to: RouterId): RouterId[][] {
  const results: RouterId[][] = [];
  const visit = (current: RouterId, path: RouterId[], visited: Set<RouterId>) => {
    if (current === to) {
      results.push(path);
      return;
    }
    for (const n of neighborsOf(current, links)) {
      if (visited.has(n.to)) continue;
      visited.add(n.to);
      visit(n.to, [...path, n.to], visited);
      visited.delete(n.to);
    }
  };
  visit(from, [from], new Set([from]));
  return results;
}
function pathCost(path: RouterId[], links: LinkDef[]): number {
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const link = links.find((l) => (l.a === path[i] && l.b === path[i + 1]) || (l.a === path[i + 1] && l.b === path[i]));
    total += link?.metric ?? Infinity;
  }
  return total;
}
export function computeIgpShortestPath(links: LinkDef[], from: RouterId, to: RouterId): { path: RouterId[]; cost: number } | undefined {
  if (from === to) return { path: [from], cost: 0 };
  const candidates = allSimplePaths(links, from, to).map((path) => ({ path, cost: pathCost(path, links) }));
  candidates.sort((a, b) => a.cost - b.cost);
  return candidates[0];
}

// ---------------------------------------------------------------------------
// SID structure (RFC 9800 §3/§6.1): LBL / LNL / FL / AL, AL = 128-LBL-LNL-FL
// ---------------------------------------------------------------------------

export interface SidStructure {
  lbl: number;
  lnl: number;
  fl: number;
  al: number;
}
export type StructureValidity = "VALID" | "UNKNOWN_STRUCTURE" | "INVALID_STRUCTURE";
export interface StructureValidation {
  validity: StructureValidity;
  reason?: string;
  expectedAl?: number;
}
/** RFC 9800 §6.1: LBL != 0, LNFL (LNL+FL) != 0, AL must equal 128-LBL-LNL-FL. An unadvertised structure is UNKNOWN, never assumed valid. */
export function validateSidStructureForCompression(structure: SidStructure | undefined): StructureValidation {
  if (!structure) return { validity: "UNKNOWN_STRUCTURE", reason: "No SID structure advertised — treated as unknown, never inferred." };
  if (structure.lbl === 0) return { validity: "INVALID_STRUCTURE", reason: "LBL must be non-zero." };
  if (structure.lnl + structure.fl === 0) return { validity: "INVALID_STRUCTURE", reason: "LNFL (LNL+FL) must be non-zero." };
  const expectedAl = 128 - structure.lbl - structure.lnl - structure.fl;
  if (structure.al !== expectedAl) return { validity: "INVALID_STRUCTURE", reason: `Advertised AL=${structure.al} does not equal 128-LBL-LNL-FL=${expectedAl}.`, expectedAl };
  return { validity: "VALID" };
}

/** This lesson's default advertised structure for every router: LBL=48, LNL=16, FL=0, AL=64 (48+16+0+64=128). */
export const DEFAULT_STRUCTURE: SidStructure = { lbl: 48, lnl: 16, fl: 0, al: 64 };
/** The fault: AL advertised as 48 instead of the correct 64 (128-48-16-0=64). */
export const FAULTY_STRUCTURE: SidStructure = { lbl: 48, lnl: 16, fl: 0, al: 48 };

export function computeLnfl(s: SidStructure): number {
  return s.lnl + s.fl;
}

// ---------------------------------------------------------------------------
// CSID layout / capacity (RFC 9800 §4.1/§5). Hextet-granular (16-bit
// units) — the same bit-oriented representation srv6Foundations.ts
// already uses, never formatted strings as the source of truth.
// ---------------------------------------------------------------------------

export interface CsidLayoutConfig {
  lblBits: number;
  lnflBits: number;
}
/** Main lab: LBL=48, LNFL=16 (readable). RFC 9800 additionally REQUIRES every NEXT-CSID implementation to support 32-bit LBL + 16-bit CSID length — the 48-bit block here is an additionally-allowed, easier-to-visualize choice, not a substitute for that mandatory floor. */
export const NEXT_CSID_LAYOUT: CsidLayoutConfig = { lblBits: 48, lnflBits: 16 };
/** REPLACE-CSID lab: intentionally a DIFFERENT CSID size (32-bit = Locator-Node 16 + Function 16) — RFC 9800 does not mandate one universal CSID size across flavors. */
export const REPLACE_CSID_LAYOUT: CsidLayoutConfig = { lblBits: 48, lnflBits: 32 };

export function computeNextCsidCapacity(layout: CsidLayoutConfig): number {
  return Math.floor((128 - layout.lblBits) / layout.lnflBits);
}
/** A packed REPLACE-CSID container carries no Locator-Block at all — full 128 bits divided into CSID-sized slots. */
export function computeReplaceCsidCapacity(layout: CsidLayoutConfig): number {
  return Math.floor(128 / layout.lnflBits);
}

export const LOCATOR_BLOCK_TEXT = "2001:db8:c5::/48";
export const LOCATOR_BLOCK_HEXTETS: Hextets = [0x2001, 0x0db8, 0x00c5];

/** Locator-Node value used as this lesson's 16-bit NEXT-CSID (FL=0 in DEFAULT_STRUCTURE — the compressed CSID here IS the Locator-Node; which local behavior it resolves to is a per-router local-SID-table matter, exactly like an ordinary SID's Function would be if FL were non-zero). */
export const NEXT_CSID_VALUE: Record<RouterId, number> = { R1: 0x0001, R2: 0x0002, R3: 0x0003, R4: 0x0004, R5: 0x0005, R6: 0x0006, R7: 0x0007, R8: 0x0008 };
export function csidHexText(value: number): string {
  return `0x${value.toString(16).padStart(4, "0")}`;
}

// ---------------------------------------------------------------------------
// Uncompressed SID model — the ordinary, non-compressed 128-bit SID a
// router would use with no compression in effect at all. LOC = LBL+LNL
// (64 bits total here), FUNCT = FL (0 in the main lab's structure —
// folded into the Locator-Node, per the note above), ARG = AL (64).
// ---------------------------------------------------------------------------

export function ordinarySidHextets(owner: RouterId, functionValue: number = FUNCTION.END): Hextets {
  return buildSrv6Sid([...LOCATOR_BLOCK_HEXTETS, NEXT_CSID_VALUE[owner]], functionValue);
}
export function ordinarySidText(owner: RouterId, functionValue: number = FUNCTION.END): string {
  return fmtIpv6(ordinarySidHextets(owner, functionValue));
}

// ---------------------------------------------------------------------------
// Logical program — the protocol-independent INTENT (S1 -> S2 -> ... ->
// Sn). Compression changes encoding only; it must never change this.
// ---------------------------------------------------------------------------

export type CsidBehavior = "END" | "END_X" | "END_DT4";
export interface LogicalSegment {
  id: string;
  owner: RouterId;
  behavior: CsidBehavior;
  adjacency?: RouterId; // END_X only
}
function seg(id: string, owner: RouterId, behavior: CsidBehavior = "END", adjacency?: RouterId): LogicalSegment {
  return { id, owner, behavior, adjacency };
}

/** The flagship 7-segment logical program: R1 -> visit R2..R8 in order. */
export const BASE_PROGRAM: LogicalSegment[] = [seg("S1", "R2"), seg("S2", "R3"), seg("S3", "R4"), seg("S4", "R5"), seg("S5", "R6"), seg("S6", "R7"), seg("S7", "R8")];
/** End.X variant: R6's segment is bound to a forced adjacency toward R8, so the sequence itself no longer visits R7 as a segment (R7 may still exist physically as an unlisted transit router elsewhere in the network — it simply isn't part of THIS program). R8 still appears as its own final segment — Container A (R2..R6, capacity-full) then Container B (R8 alone) — so the End.X forcing is visible exactly at the container-boundary crossing, not folded away into a same-container shift. */
export const ENDX_PROGRAM: LogicalSegment[] = [seg("S1", "R2"), seg("S2", "R3"), seg("S3", "R4"), seg("S4", "R5"), seg("S5x", "R6", "END_X", "R8"), seg("S6", "R8")];
/** REPLACE-CSID lab program: R2, R3, R4 End, then R8's End.DT4 service SID as the final segment. */
export const REPLACE_PROGRAM: LogicalSegment[] = [seg("T1", "R2"), seg("T2", "R3"), seg("T3", "R4"), seg("T4", "R8", "END_DT4")];

export function logicalSegmentsEqual(a: LogicalSegment[], b: LogicalSegment[]): boolean {
  return a.length === b.length && a.every((s, i) => s.id === b[i].id && s.owner === b[i].owner && s.behavior === b[i].behavior && s.adjacency === b[i].adjacency);
}

// ---------------------------------------------------------------------------
// SRH domain model (RFC 8754) — one Segment List entry per compressed
// entry (container, packed container, or ordinary SID). Deliberately
// NOT srv6Foundations' SrhSegment/SegmentRoutingHeader — this file's
// `hextets` may represent a multi-CSID CONTAINER, which that shared
// type has no concept of; restated locally, same shape/spirit.
// ---------------------------------------------------------------------------

export interface SrhSegment {
  index: number;
  hextets: Hextets;
  label: string;
  /** For a NEXT-CSID container: the owners packed inside, forward order. Undefined for an ordinary SID entry. */
  csidOwners?: RouterId[];
  /** True only for a REPLACE-CSID packed container — NOT itself a valid SID, shown distinctly in the inspector. */
  isPackedContainer?: boolean;
}
export interface SegmentRoutingHeader {
  nextHeader: string;
  hdrExtLen: number;
  routingType: 4;
  segmentsLeft: number;
  lastEntry: number;
  flags: string;
  tag: number;
  segmentList: SrhSegment[];
}

// ---------------------------------------------------------------------------
// Compressibility + NEXT-CSID compression (RFC 9800 §6.2)
// ---------------------------------------------------------------------------

export type CompressibilityReason = "VALID" | "UNKNOWN_STRUCTURE" | "INVALID_STRUCTURE" | "NONZERO_ARGUMENT" | "LOCATOR_BLOCK_MISMATCH" | "INSUFFICIENT_CAPACITY" | "UNSUPPORTED_FLAVOR";

export type CsidFlavor = "NEXT_CSID" | "REPLACE_CSID";
/** RFC 9800 does not define a NEXT-CSID flavor for service (End.DX/End.DT family) behaviors — only REPLACE-CSID has that support. */
export const NEXT_CSID_SUPPORTED_BEHAVIORS: CsidBehavior[] = ["END", "END_X"];
export const REPLACE_CSID_SUPPORTED_BEHAVIORS: CsidBehavior[] = ["END", "END_X", "END_DT4"];
export function isFlavorSupportedForBehavior(behavior: CsidBehavior, flavor: CsidFlavor): boolean {
  return (flavor === "NEXT_CSID" ? NEXT_CSID_SUPPORTED_BEHAVIORS : REPLACE_CSID_SUPPORTED_BEHAVIORS).includes(behavior);
}

export interface CompressedListEntry {
  kind: "NEXT_CSID_CONTAINER" | "REPLACE_CSID_FIRST" | "REPLACE_CSID_PACKED" | "ORDINARY";
  hextets: Hextets;
  segments: LogicalSegment[];
  label: string;
}
export interface CompressionPlan {
  flavor: CsidFlavor;
  entries: CompressedListEntry[]; // travel order
  reasons: Record<string, CompressibilityReason>;
}

function buildNextCsidContainerHextets(run: LogicalSegment[], layout: CsidLayoutConfig): Hextets {
  const capacity = computeNextCsidCapacity(layout);
  const csids = run.map((s) => NEXT_CSID_VALUE[s.owner]);
  while (csids.length < capacity) csids.push(0);
  return [...LOCATOR_BLOCK_HEXTETS, ...csids];
}
function buildOrdinaryHextets(s: LogicalSegment): Hextets {
  const fv = s.behavior === "END_DT4" ? FUNCTION.END_DT4 : s.behavior === "END_X" ? FUNCTION.END_X : FUNCTION.END;
  return ordinarySidHextets(s.owner, fv);
}

/**
 * RFC 9800 §6.2: build a run of NEXT-CSID containers from a logical
 * program, given each owner's advertised structure. A segment whose
 * structure is unknown/invalid, or whose behavior has no NEXT-CSID
 * flavor, breaks the current run and is carried as its own ordinary
 * SID entry — compression resumes on the next eligible segment. This
 * is what makes partial compression (RFC 9800 §6.2, mixed lists) a
 * direct CONSEQUENCE of validation, never a separate all-or-nothing
 * switch.
 */
export function compressNextCsidRun(segments: LogicalSegment[], structures: Record<RouterId, SidStructure | undefined>, layout: CsidLayoutConfig = NEXT_CSID_LAYOUT): CompressionPlan {
  const capacity = computeNextCsidCapacity(layout);
  const entries: CompressedListEntry[] = [];
  const reasons: Record<string, CompressibilityReason> = {};
  const eligibility = (s: LogicalSegment): CompressibilityReason => {
    const v = validateSidStructureForCompression(structures[s.owner]);
    if (v.validity !== "VALID") return v.validity;
    if (!isFlavorSupportedForBehavior(s.behavior, "NEXT_CSID")) return "UNSUPPORTED_FLAVOR";
    return "VALID";
  };
  let i = 0;
  while (i < segments.length) {
    const reason = eligibility(segments[i]);
    if (reason !== "VALID") {
      reasons[segments[i].id] = reason;
      entries.push({ kind: "ORDINARY", hextets: buildOrdinaryHextets(segments[i]), segments: [segments[i]], label: `${segments[i].owner} (ordinary — ${reason})` });
      i++;
      continue;
    }
    const run: LogicalSegment[] = [];
    while (i < segments.length && run.length < capacity && eligibility(segments[i]) === "VALID") {
      reasons[segments[i].id] = "VALID";
      run.push(segments[i]);
      i++;
    }
    entries.push({ kind: "NEXT_CSID_CONTAINER", hextets: buildNextCsidContainerHextets(run, layout), segments: run, label: `Container [${run.map((r) => r.owner).join(",")}]` });
  }
  return { flavor: "NEXT_CSID", entries, reasons };
}

// ---------------------------------------------------------------------------
// REPLACE-CSID compression (RFC 9800 §4.2)
// ---------------------------------------------------------------------------

function replaceCsidPair(owner: RouterId, functionValue: number): [number, number] {
  return [NEXT_CSID_VALUE[owner], functionValue];
}
/** Hextets per packed CSID slot (LNFL / 16). */
function replaceSlotHextets(layout: CsidLayoutConfig): number {
  return layout.lnflBits / 16;
}
/**
 * RFC 9800 §4.2: the Index occupies the least-significant X bits of the
 * Argument, X = ceil(log2(K)) with K = floor(128/LNFL) packed positions.
 * Every LNFL this model allows is >= 16 bits, so K <= 8 and X <= 3 — the
 * Index always fits inside the DA's last hextet; the remaining Argument
 * bits stay zero.
 */
export function replaceIndexBits(layout: CsidLayoutConfig): number {
  return Math.max(1, Math.ceil(Math.log2(computeReplaceCsidCapacity(layout))));
}
export function readReplaceIndex(daHextets: Hextets, layout: CsidLayoutConfig = REPLACE_CSID_LAYOUT): number {
  return daHextets[7] & ((1 << replaceIndexBits(layout)) - 1);
}
export function writeReplaceIndex(daHextets: Hextets, index: number, layout: CsidLayoutConfig = REPLACE_CSID_LAYOUT): Hextets {
  const mask = (1 << replaceIndexBits(layout)) - 1;
  const out = [...daHextets];
  out[7] = (out[7] & ~mask & 0xffff) | (index & mask);
  return out;
}
/** The CSID stored at physical packed `position` (0 = most-significant slot, K-1 = least-significant). */
export function replacePackedSlot(container: Hextets, position: number, layout: CsidLayoutConfig = REPLACE_CSID_LAYOUT): number[] {
  const w = replaceSlotHextets(layout);
  return container.slice(position * w, position * w + w);
}
/** Physical packed position of the j-th CSID (travel order) inside one packed container: RFC 9800 fills from K-1 downward. */
export function replacePackedPositionForTravelIndex(j: number, layout: CsidLayoutConfig = REPLACE_CSID_LAYOUT): number {
  return computeReplaceCsidCapacity(layout) - 1 - j;
}
function functionValueForBehavior(s: LogicalSegment): number {
  return s.behavior === "END_DT4" ? FUNCTION.END_DT4 : s.behavior === "END_X" ? FUNCTION.END_X : FUNCTION.END;
}
function buildReplaceCsidFirstHextets(s: LogicalSegment): Hextets {
  const [node, fn] = replaceCsidPair(s.owner, functionValueForBehavior(s));
  return writeReplaceIndex([...LOCATOR_BLOCK_HEXTETS, node, fn, 0, 0, 0], 0); // first SID: Index = 0
}
/** RFC 9800 §4.2/§6.2: the second CSID of the sequence goes in the LEAST-significant position (K-1), the next in K-2, and so on; unused positions stay zero. */
function buildReplaceCsidPackedHextets(run: LogicalSegment[], layout: CsidLayoutConfig): Hextets {
  const capacity = computeReplaceCsidCapacity(layout);
  const w = replaceSlotHextets(layout);
  const out: number[] = new Array(capacity * w).fill(0);
  run.forEach((s, j) => {
    const position = replacePackedPositionForTravelIndex(j, layout);
    replaceCsidPair(s.owner, functionValueForBehavior(s)).forEach((v, o) => {
      out[position * w + o] = v;
    });
  });
  return out;
}

/** RFC 9800 §4.2: the first Segment List entry is a fully-formed SID (Locator-Block + first CSID + Index); every later entry is a PACKED container of CSID pairs, never itself a valid SID. */
export function compressReplaceCsidRun(segments: LogicalSegment[], structures: Record<RouterId, SidStructure | undefined>, layout: CsidLayoutConfig = REPLACE_CSID_LAYOUT): CompressionPlan {
  const capacity = computeReplaceCsidCapacity(layout);
  const entries: CompressedListEntry[] = [];
  const reasons: Record<string, CompressibilityReason> = {};
  const eligible = segments.every((s) => {
    const v = validateSidStructureForCompression(structures[s.owner]);
    return v.validity === "VALID" && isFlavorSupportedForBehavior(s.behavior, "REPLACE_CSID");
  });
  if (!eligible || segments.length === 0) {
    for (const s of segments) reasons[s.id] = "UNSUPPORTED_FLAVOR";
    return { flavor: "REPLACE_CSID", entries: segments.map((s) => ({ kind: "ORDINARY" as const, hextets: buildOrdinaryHextets(s), segments: [s], label: `${s.owner} (ordinary)` })), reasons };
  }
  for (const s of segments) reasons[s.id] = "VALID";
  entries.push({ kind: "REPLACE_CSID_FIRST", hextets: buildReplaceCsidFirstHextets(segments[0]), segments: [segments[0]], label: `${segments[0].owner} (first — fully formed SID)` });
  const rest = segments.slice(1);
  for (let i = 0; i < rest.length; i += capacity) {
    const chunk = rest.slice(i, i + capacity);
    entries.push({ kind: "REPLACE_CSID_PACKED", hextets: buildReplaceCsidPackedHextets(chunk, layout), segments: chunk, label: `Packed [${chunk.map((r) => r.owner).join(",")}]` });
  }
  return { flavor: "REPLACE_CSID", entries, reasons };
}

// ---------------------------------------------------------------------------
// Expansion / equivalence (RFC 9800's core invariant: compression must
// never change the logical program).
// ---------------------------------------------------------------------------

export function expandCompressedProgram(plan: CompressionPlan): LogicalSegment[] {
  return plan.entries.flatMap((e) => e.segments);
}
export function verifyCompressionEquivalence(original: LogicalSegment[], plan: CompressionPlan): boolean {
  return logicalSegmentsEqual(original, expandCompressedProgram(plan));
}

// ---------------------------------------------------------------------------
// DA + SRH construction from a compression plan. Storage order is
// REVERSED relative to travel order (RFC 8754) even though CSIDs
// WITHIN one container/packed-container stay in forward order
// (RFC 9800 §4.1/§4.2) — the two ordering rules are independent.
// ---------------------------------------------------------------------------

export function buildDaAndSrh(plan: CompressionPlan): { daHextets: Hextets; srh?: SegmentRoutingHeader } {
  if (plan.entries.length === 0) return { daHextets: [0, 0, 0, 0, 0, 0, 0, 0] };
  if (plan.entries.length === 1) return { daHextets: plan.entries[0].hextets };
  const n = plan.entries.length;
  // Storage order is REVERSED relative to travel order (RFC 8754) — Segment
  // List[0] is the FINAL entry, Segment List[n-1] the FIRST (same convention
  // as srv6Foundations.ts's buildFullSrh: the Segment List carries every
  // entry, including the first, which is ALSO separately imposed as the DA).
  const storageOrder = [...plan.entries].reverse();
  const segmentList: SrhSegment[] = storageOrder.map((e, i) => ({
    index: i,
    hextets: e.hextets,
    label: e.label,
    csidOwners: e.kind === "NEXT_CSID_CONTAINER" || e.kind === "REPLACE_CSID_PACKED" ? e.segments.map((s) => s.owner) : undefined,
    isPackedContainer: e.kind === "REPLACE_CSID_PACKED",
  }));
  return {
    daHextets: plan.entries[0].hextets,
    srh: { nextHeader: "58 (ICMPv6 probe)", hdrExtLen: n * 2, routingType: 4, segmentsLeft: n - 1, lastEntry: n - 1, flags: "0x00", tag: 0, segmentList },
  };
}

// ---------------------------------------------------------------------------
// NEXT-CSID endpoint execution (RFC 9800 §4.1) — the flagship behavior.
// ---------------------------------------------------------------------------

export type NextCsidOutcome = "INTRA_CONTAINER_SHIFT" | "CONTAINER_BOUNDARY_CROSSED" | "FINAL";
export interface NextCsidAdvanceInput {
  daHextets: Hextets;
  layout: CsidLayoutConfig;
  hopLimit: number;
  srh?: SegmentRoutingHeader;
  endpointBehavior: "END" | "END_X";
  adjacency?: RouterId;
}
export interface NextCsidAdvanceResult {
  outcome: NextCsidOutcome;
  newDaHextets: Hextets;
  newSrh?: SegmentRoutingHeader;
  segmentsLeftChanged: boolean;
  newHopLimit: number;
  forwardVia?: RouterId;
  reason: string;
}
/**
 * Non-zero Argument -> shift Argument into the bits after the Locator-
 * Block, drop the consumed CSID, zero-pad the low CSID slot, decrement
 * Hop Limit, leave Segments Left UNCHANGED (no new 128-bit Segment
 * List entry has been consumed — this must never reuse ordinary RFC
 * 8986 End logic, which blindly decrements Segments Left on every
 * advance). Zero Argument -> the container is exhausted: load the next
 * 128-bit Segment List entry and let ordinary SRH advancement apply.
 */
export function executeNextCsidAdvance(input: NextCsidAdvanceInput): NextCsidAdvanceResult {
  const { daHextets, layout, hopLimit, srh, endpointBehavior, adjacency } = input;
  const lblHextets = layout.lblBits / 16;
  const argument = daHextets.slice(lblHextets + 1);
  const argumentIsZero = argument.every((h) => h === 0);

  if (argumentIsZero) {
    if (!srh || srh.segmentsLeft === 0) {
      return { outcome: "FINAL", newDaHextets: daHextets, newSrh: srh, segmentsLeftChanged: false, newHopLimit: hopLimit, forwardVia: endpointBehavior === "END_X" ? adjacency : undefined, reason: "Argument exhausted and no further Segment List entries — sequence complete." };
    }
    // Ordinary RFC 8986 End processing applies at the boundary — including its Hop Limit check and single decrement.
    if (hopLimit <= 1) {
      return { outcome: "FINAL", newDaHextets: daHextets, newSrh: srh, segmentsLeftChanged: false, newHopLimit: hopLimit, reason: "Hop Limit would reach zero on this advance — the packet must be discarded, not forwarded further." };
    }
    const segmentsLeft = srh.segmentsLeft - 1;
    const newDaHextets = srh.segmentList[segmentsLeft].hextets;
    return {
      outcome: "CONTAINER_BOUNDARY_CROSSED",
      newDaHextets,
      newSrh: { ...srh, segmentsLeft },
      segmentsLeftChanged: true,
      newHopLimit: hopLimit - 1,
      forwardVia: endpointBehavior === "END_X" ? adjacency : undefined,
      reason: "Argument exhausted — loaded the next 128-bit Segment List entry; ordinary RFC 8754 SRH advancement applies here (Segments Left −1, Hop Limit −1), not intra-container shifting.",
    };
  }
  if (hopLimit <= 1) {
    return { outcome: "FINAL", newDaHextets: daHextets, newSrh: srh, segmentsLeftChanged: false, newHopLimit: hopLimit, reason: "Hop Limit would reach zero on this advance — the packet must be discarded, not forwarded further." };
  }
  const lbl = daHextets.slice(0, lblHextets);
  const shifted = [...lbl, ...daHextets.slice(lblHextets + 1), 0];
  return {
    outcome: "INTRA_CONTAINER_SHIFT",
    newDaHextets: shifted,
    newSrh: srh,
    segmentsLeftChanged: false,
    newHopLimit: hopLimit - 1,
    forwardVia: endpointBehavior === "END_X" ? adjacency : undefined,
    reason: "Non-zero Argument — Argument shifted into the bits after the Locator-Block, consumed CSID dropped, Segments Left UNCHANGED, Hop Limit decremented by 1.",
  };
}

// ---------------------------------------------------------------------------
// REPLACE-CSID endpoint execution (RFC 9800 §4.2)
// ---------------------------------------------------------------------------

export type ReplaceCsidOutcome = "PACKED_ADVANCE" | "CONTAINER_BOUNDARY_CROSSED" | "FINAL";
export interface ReplaceCsidAdvanceInput {
  daHextets: Hextets;
  layout: CsidLayoutConfig;
  hopLimit: number;
  srh?: SegmentRoutingHeader;
}
export interface ReplaceCsidAdvanceResult {
  outcome: ReplaceCsidOutcome;
  newDaHextets: Hextets;
  newSrh?: SegmentRoutingHeader;
  segmentsLeftChanged: boolean;
  newHopLimit: number;
  indexBefore: number;
  indexAfter: number;
  /** Physical packed position the new active CSID was read from (undefined when no packed CSID was used). */
  packedPosition?: number;
  reason: string;
}
/**
 * RFC 9800 §4.2.1 (End with REPLACE-CSID). The Index names the physical
 * packed position of the CURRENT container (Segment List[Segments Left])
 * the next CSID is read from; it counts DOWN. A non-zero Index is
 * decremented and that position's CSID becomes active. Index 0 means the
 * current entry is exhausted: Segments Left decrements, the Index is reset
 * to K-1, and the next container's least-significant position is used.
 * Either way the DA is RECONSTRUCTED as a valid SID (Locator-Block +
 * that CSID + Index) — the packed container is never copied into the DA —
 * and Hop Limit decrements once.
 */
export function executeReplaceCsidAdvance(input: ReplaceCsidAdvanceInput): ReplaceCsidAdvanceResult {
  const { daHextets, layout, hopLimit, srh } = input;
  const capacity = computeReplaceCsidCapacity(layout);
  const lblHextets = layout.lblBits / 16;
  const argumentHextets = 8 - lblHextets - replaceSlotHextets(layout);
  const index = readReplaceIndex(daHextets, layout);
  const isZero = (v: number[]) => v.every((h) => h === 0);
  const reconstruct = (slot: number[], newIndex: number) => writeReplaceIndex([...daHextets.slice(0, lblHextets), ...slot, ...new Array(argumentHextets).fill(0)], newIndex, layout);
  const final = (reason: string): ReplaceCsidAdvanceResult => ({ outcome: "FINAL", newDaHextets: daHextets, newSrh: srh, segmentsLeftChanged: false, newHopLimit: hopLimit, indexBefore: index, indexAfter: index, reason });

  if (!srh || (srh.segmentsLeft === 0 && (index === 0 || isZero(replacePackedSlot(srh.segmentList[0].hextets, index - 1, layout))))) {
    return final("No further CSID remains (Segments Left 0, next packed position empty) — sequence complete.");
  }
  if (hopLimit <= 1) return final("Hop Limit would reach zero on this advance — the packet must be discarded, not forwarded further.");

  if (index !== 0) {
    const newIndex = index - 1;
    const slot = replacePackedSlot(srh.segmentList[srh.segmentsLeft].hextets, newIndex, layout);
    if (isZero(slot)) {
      // The rest of this container is padding: the next Segment List entry is a fully formed SID.
      const segmentsLeft = srh.segmentsLeft - 1;
      const next = srh.segmentList[segmentsLeft].hextets;
      return { outcome: "CONTAINER_BOUNDARY_CROSSED", newDaHextets: next, newSrh: { ...srh, segmentsLeft }, segmentsLeftChanged: true, newHopLimit: hopLimit - 1, indexBefore: index, indexAfter: readReplaceIndex(next, layout), reason: "Remaining packed positions are padding — loaded the next fully formed Segment List entry." };
    }
    return {
      outcome: "PACKED_ADVANCE",
      newDaHextets: reconstruct(slot, newIndex),
      newSrh: srh,
      segmentsLeftChanged: false,
      newHopLimit: hopLimit - 1,
      indexBefore: index,
      indexAfter: newIndex,
      packedPosition: newIndex,
      reason: `Index ${index} → ${newIndex}: reconstructed a valid SID from packed position ${newIndex} of the current container — Locator-Block unchanged, Segments Left unchanged, Hop Limit −1.`,
    };
  }
  const segmentsLeft = srh.segmentsLeft - 1;
  const newIndex = capacity - 1;
  const slot = replacePackedSlot(srh.segmentList[segmentsLeft].hextets, newIndex, layout);
  return {
    outcome: "CONTAINER_BOUNDARY_CROSSED",
    newDaHextets: reconstruct(slot, newIndex),
    newSrh: { ...srh, segmentsLeft },
    segmentsLeftChanged: true,
    newHopLimit: hopLimit - 1,
    indexBefore: index,
    indexAfter: newIndex,
    packedPosition: newIndex,
    reason: `Index 0 — loaded packed container Segment List[${segmentsLeft}] (Segments Left −1), Index reset to K-1 = ${newIndex}: reconstructed a valid SID from packed position ${newIndex}, Hop Limit −1.`,
  };
}

// ---------------------------------------------------------------------------
// End.DT4 — minimal restatement (decap + IPv4 VRF lookup), same
// algorithm as srv6EndpointBehaviors.ts's End.DT4, small and locally
// typed rather than widening that file's closed union.
// ---------------------------------------------------------------------------

export const CSID_CUST_PREFIX = "10.99.1.0/24";
export const CSID_CUST_HOST = "10.99.1.10";
export function executeEndDt4Decap(innerDstIp: string): { delivered: boolean; matchedRoute?: string } {
  const [net, host] = CSID_CUST_PREFIX.split("/");
  const prefixOctets = net.split(".").slice(0, 3).join(".");
  const dstOctets = innerDstIp.split(".").slice(0, 3).join(".");
  void host;
  return prefixOctets === dstOctets ? { delivered: true, matchedRoute: CSID_CUST_PREFIX } : { delivered: false };
}

// ---------------------------------------------------------------------------
// Metrics (RFC 9800's whole point, made concrete and labeled precisely)
// ---------------------------------------------------------------------------

export interface CompressionMetrics {
  originalSegmentCount: number;
  compressedContainerCount: number;
  originalSegmentBytes: number;
  compressedSegmentBytes: number;
  savedBytes: number;
  percentageReduction: number;
}
export function calculateCompressionMetrics(originalCount: number, plan: CompressionPlan): CompressionMetrics {
  const originalSegmentBytes = originalCount * 16;
  const compressedSegmentBytes = plan.entries.length * 16;
  const savedBytes = originalSegmentBytes - compressedSegmentBytes;
  return {
    originalSegmentCount: originalCount,
    compressedContainerCount: plan.entries.length,
    originalSegmentBytes,
    compressedSegmentBytes,
    savedBytes,
    percentageReduction: originalSegmentBytes === 0 ? 0 : Math.round((savedBytes / originalSegmentBytes) * 100),
  };
}
export interface ModeledPacketSize {
  outerIpv6Bytes: number;
  srhBytes: number;
  segmentValueBytes: number;
  payloadBytes: number;
  totalBytes: number;
}
const OUTER_IPV6_HEADER_BYTES = 40;
const SRH_BASE_BYTES = 8; // RFC 8754 fixed portion, excluding the Segment List itself
export function calculateModeledPacketSize(segmentValueBytes: number, hasSrh: boolean, payloadBytes: number): ModeledPacketSize {
  const srhBytes = hasSrh ? SRH_BASE_BYTES + segmentValueBytes : 0;
  return { outerIpv6Bytes: OUTER_IPV6_HEADER_BYTES, srhBytes, segmentValueBytes: hasSrh ? segmentValueBytes : 0, payloadBytes, totalBytes: OUTER_IPV6_HEADER_BYTES + srhBytes + payloadBytes };
}

// ---------------------------------------------------------------------------
// Packet visuals
// ---------------------------------------------------------------------------

export interface CsidPacketState {
  daHextets: Hextets;
  hopLimit: number;
  srh?: SegmentRoutingHeader;
}
function ipv6Layer(pkt: CsidPacketState): PacketLayer {
  return {
    name: "IPv6 Header",
    color: "var(--pv-proto-ipv6)",
    fields: [
      { label: "Source Address", value: "2001:db8:100:1::a" },
      { label: "Destination Address (active segment)", value: fmtIpv6(pkt.daHextets) },
      { label: "Hop Limit", value: String(pkt.hopLimit) },
    ],
  };
}
function srhLayer(srh: SegmentRoutingHeader): PacketLayer {
  return {
    name: `Segment Routing Header (SL=${srh.segmentsLeft}, LE=${srh.lastEntry})`,
    color: "var(--pv-proto-srh)",
    fields: [
      { label: "Hdr Ext Len", value: String(srh.hdrExtLen) },
      { label: "Routing Type", value: `${srh.routingType} (SRH)` },
      { label: "Segments Left", value: String(srh.segmentsLeft) },
      { label: "Last Entry", value: String(srh.lastEntry) },
      ...srh.segmentList.map((s) => ({
        label: `Segment List[${s.index}]${s.isPackedContainer ? " (packed — NOT a valid SID)" : ""}`,
        value: s.isPackedContainer ? packedPositionsText(s.hextets) : `${fmtIpv6(s.hextets)}${s.csidOwners ? ` [${s.csidOwners.join(",")}]` : ""}`,
      })),
    ],
  };
}
function payloadLayer(): PacketLayer {
  return { name: "Payload", color: "var(--pv-border-strong)", fields: [{ label: "Conceptual destination", value: "Application endpoint behind R8" }] };
}
/** "[3] R3 End · [2] R4 End · [1] R8 End.DT4 · [0] 0" — physical positions, most-significant first. */
function packedPositionsText(hextets: Hextets): string {
  const k = computeReplaceCsidCapacity(REPLACE_CSID_LAYOUT);
  const out: string[] = [];
  for (let pos = k - 1; pos >= 0; pos--) {
    const [node, fn] = replacePackedSlot(hextets, pos);
    const owner = ALL_ROUTERS.find((r) => NEXT_CSID_VALUE[r] === node);
    const behavior = fn === FUNCTION.END_DT4 ? BEHAVIOR_LABEL.END_DT4 : fn === FUNCTION.END_X ? BEHAVIOR_LABEL.END_X : BEHAVIOR_LABEL.END;
    out.push(node === 0 && fn === 0 ? `[${pos}] 0` : `[${pos}] ${owner ?? csidHexText(node)} ${behavior}`);
  }
  return out.join(" · ");
}
export function buildCsidPacketLayers(pkt: CsidPacketState): PacketLayer[] {
  return [ipv6Layer(pkt), ...(pkt.srh ? [srhLayer(pkt.srh)] : []), payloadLayer()];
}
function csidPacket(id: string, from: RouterId, to: RouterId, summary: string, badge: string, pkt: CsidPacketState): PacketVisual {
  return { id, protocol: "IPV6", from, to, summary, badge, layers: buildCsidPacketLayers(pkt) };
}

// ---------------------------------------------------------------------------
// Top-level scenario state
// ---------------------------------------------------------------------------

export interface CsidJourneyHop {
  router: RouterId;
  input: string;
  lookup: string;
  action: string;
  output: string;
  /**
   * Structured facts copied from the SAME advance result that produced
   * the strings above — recorded once in run(), never recomputed by the
   * presentation layer. Segments Left is undefined when no SRH exists.
   */
  flavor: CsidFlavor;
  behavior: CsidBehavior;
  daBefore: Hextets;
  daAfter: Hextets;
  segmentsLeftBefore?: number;
  segmentsLeftAfter?: number;
  hopLimitBefore: number;
  hopLimitAfter: number;
  forwardVia?: RouterId;
  reason: string;
}
function nextCsidHop(router: RouterId, behavior: CsidBehavior, pkt: CsidPacketState, result: NextCsidAdvanceResult, lookup: string): CsidJourneyHop {
  return {
    router,
    input: fmtIpv6(pkt.daHextets),
    lookup,
    action: result.outcome,
    output: fmtIpv6(result.newDaHextets),
    flavor: "NEXT_CSID",
    behavior,
    daBefore: pkt.daHextets,
    daAfter: result.newDaHextets,
    segmentsLeftBefore: pkt.srh?.segmentsLeft,
    segmentsLeftAfter: result.newSrh?.segmentsLeft,
    hopLimitBefore: pkt.hopLimit,
    hopLimitAfter: result.newHopLimit,
    forwardVia: result.forwardVia,
    reason: result.reason,
  };
}
function replaceCsidHop(segment: LogicalSegment, pkt: CsidPacketState, result: ReplaceCsidAdvanceResult): CsidJourneyHop {
  return {
    router: segment.owner,
    input: fmtIpv6(pkt.daHextets),
    lookup: result.reason,
    action: result.outcome,
    output: fmtIpv6(result.newDaHextets),
    flavor: "REPLACE_CSID",
    behavior: segment.behavior,
    daBefore: pkt.daHextets,
    daAfter: result.newDaHextets,
    segmentsLeftBefore: pkt.srh?.segmentsLeft,
    segmentsLeftAfter: result.newSrh?.segmentsLeft,
    hopLimitBefore: pkt.hopLimit,
    hopLimitAfter: result.newHopLimit,
    reason: result.reason,
  };
}
export interface FaultState {
  targetRouter: RouterId;
  active: boolean;
  repaired: boolean;
}
export interface TroubleshootingState {
  started: boolean;
  repairAttempt?: { choice: string; correct: boolean };
  correctVerified: boolean;
}
export interface ChallengeState {
  started: boolean;
  repairAttempt?: { choice: string; correct: boolean };
  correctVerified: boolean;
}

export interface Srv6CsidState {
  links: LinkDef[];
  structures: Record<RouterId, SidStructure | undefined>;
  mainFault: FaultState;
  challengeFault: FaultState;
  packet?: CsidPacketState;
  packetAt?: RouterId;
  journey: CsidJourneyHop[];
  activeMode?: "END" | "END_X";
  replacePacket?: CsidPacketState;
  replaceJourney: CsidJourneyHop[];
  mainTroubleshooting: TroubleshootingState;
  challenge: ChallengeState;
}

export function createSrv6CsidState(): Srv6CsidState {
  const structures: Record<RouterId, SidStructure | undefined> = {} as Record<RouterId, SidStructure | undefined>;
  for (const r of ALL_ROUTERS) structures[r] = DEFAULT_STRUCTURE;
  return {
    links: LINKS,
    structures,
    mainFault: { targetRouter: "R4", active: false, repaired: false },
    challengeFault: { targetRouter: "R6", active: false, repaired: false },
    journey: [],
    replaceJourney: [],
    mainTroubleshooting: { started: false, correctVerified: false },
    challenge: { started: false, correctVerified: false },
  };
}

function structuresWithFault(base: Record<RouterId, SidStructure | undefined>, fault: FaultState): Record<RouterId, SidStructure | undefined> {
  if (!fault.active || fault.repaired) return base;
  return { ...base, [fault.targetRouter]: FAULTY_STRUCTURE };
}
export function liveStructures(state: Srv6CsidState): Record<RouterId, SidStructure | undefined> {
  return structuresWithFault(structuresWithFault(state.structures, state.mainFault), state.challengeFault);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export interface CliVendorOutput {
  cmd: string;
  output: string;
}
export interface CliCommandEntry {
  id: string;
  label: string;
  cisco: CliVendorOutput;
  juniper: CliVendorOutput;
}
export function buildCsidCliCommands(state: Srv6CsidState, router: RouterId): CliCommandEntry[] {
  const structure = liveStructures(state)[router];
  const validation = validateSidStructureForCompression(structure);
  const structureText = structure ? `LBL=${structure.lbl} LNL=${structure.lnl} FL=${structure.fl} AL=${structure.al}\nValidation: ${validation.validity}${validation.reason ? " — " + validation.reason : ""}` : "No structure advertised (UNKNOWN_STRUCTURE)";
  return [
    {
      id: "sid",
      label: "show sid",
      cisco: { cmd: "show segment-routing srv6 sid", output: `Locator-Block ${LOCATOR_BLOCK_TEXT}\nLocator-Node ${csidHexText(NEXT_CSID_VALUE[router])}\nOrdinary SID  ${ordinarySidText(router)}` },
      juniper: { cmd: "show srv6 sid", output: `Locator-Block ${LOCATOR_BLOCK_TEXT}\nLocator-Node ${csidHexText(NEXT_CSID_VALUE[router])}\nOrdinary SID  ${ordinarySidText(router)}` },
    },
    {
      id: "structure",
      label: "show sid-structure",
      cisco: { cmd: "show segment-routing srv6 sid-structure", output: structureText },
      juniper: { cmd: "show srv6 sid-structure", output: structureText },
    },
  ];
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

const R2_SID = ordinarySidText("R2");
const R4_SID = ordinarySidText("R4");
const CAPACITY = computeNextCsidCapacity(NEXT_CSID_LAYOUT);
const REPLACE_CAPACITY = computeReplaceCsidCapacity(REPLACE_CSID_LAYOUT);

function findJourneyRouter(hop: CsidJourneyHop | undefined): RouterId | undefined {
  return hop?.router;
}
void findJourneyRouter;

export const srv6CsidSteps: ScenarioStep<Srv6CsidState>[] = [
  // --- 1. The problem ---------------------------------------------------
  {
    id: "intro",
    label: "The Problem",
    narrative: `A real SRv6 policy might need <S1, S2, S3, S4, S5, S6, S7, S8> — eight segments, each a full 128-bit IPv6 SID. If most of every SID repeats the same Locator-Block, and low-order bits sit unused, why carry all 128 bits eight separate times?`,
  },
  {
    id: "problem-answer",
    label: "Compressed SRv6",
    narrative: "Compressed SRv6 avoids repeatedly encoding common locator information and unused padding. This lesson is RFC 9800 — Compressed SRv6 Segment List Encoding.",
  },
  {
    id: "usid-naming-note",
    label: "\"uSID\" vs. RFC 9800",
    narrative: "\"uSID\" is a widely used historical/industry term associated with the NEXT-CSID style. RFC 9800 standardizes compressed SRv6 using the formal NEXT-CSID and REPLACE-CSID flavors — this lesson's standards-facing explanations always use CSID / NEXT-CSID / REPLACE-CSID, never an old Internet-Draft's terminology as if it were the current standard.",
  },
  {
    id: "predict-usid-normative",
    label: "Predict",
    narrative: "Before going further:",
    question: {
      prompt: "Is \"uSID\" the normative RFC 9800 name for this compression mechanism?",
      options: [
        { id: "no", label: "No — RFC 9800 uses CSID, NEXT-CSID, and REPLACE-CSID terminology" },
        { id: "yes", label: "Yes — uSID is RFC 9800's own defined term" },
      ],
      correctOptionId: "no",
      explanation: "\"uSID\" is industry shorthand associated with the NEXT-CSID style, not an RFC 9800 term. This lesson uses RFC 9800's own vocabulary throughout.",
    },
  },

  // --- 2. Critical concept ------------------------------------------------
  {
    id: "compression-changes-encoding",
    label: "Mandatory Rule",
    narrative: "COMPRESSION CHANGES ENCODING. IT DOES NOT CHANGE THE NETWORK PROGRAM'S INTENT. The same conceptual program S1 -> S2 -> ... -> Sn can be represented uncompressed or compressed while preserving identical segment semantics. RFC 9800 changes how the NEXT SID is determined — never what the active/next segment MEANS.",
  },
  {
    id: "predict-changes-endx-semantics",
    label: "Predict",
    narrative: "Before touching a single behavior:",
    question: {
      prompt: "Does compressed SRv6 change the semantics of an End.X segment?",
      options: [
        { id: "no", label: "No — End.X remains End.X; compression only changes how the next SID is encoded/determined" },
        { id: "yes", label: "Yes — a compressed End.X becomes a new kind of forwarding instruction" },
      ],
      correctOptionId: "no",
      explanation: "End remains End, End.X remains End.X, End.T remains End.T, End.DT4 remains End.DT4. Compression flavors modify how the next SID is encoded/determined, never the forwarding intent itself.",
    },
  },

  // --- 3. SID anatomy / CSID terminology ----------------------------------
  {
    id: "sid-anatomy-refresher",
    label: "SID Anatomy Refresher",
    narrative: "Ordinary 128-bit SID: Locator | Function | Argument. RFC 9800 refines this: Locator = Locator-Block + Locator-Node. CSID = Locator-Node + Function. The common Locator-Block can be shared across several compressed segments — that shared portion is exactly what compression stops repeating.",
  },
  {
    id: "terminology-table",
    label: "RFC 9800 Terminology",
    narrative: "LBL = Locator-Block Length. LNL = Locator-Node Length. FL = Function Length. AL = Argument Length. LNFL = Locator-Node-Function Length (LNL+FL) — the width of one compressed CSID slot inside a container.",
  },

  // --- 4. Main educational layout ------------------------------------------
  {
    id: "layout-intro",
    label: "This Lesson's NEXT-CSID Layout",
    narrative: `LBL = ${NEXT_CSID_LAYOUT.lblBits} bits. LNFL = ${NEXT_CSID_LAYOUT.lnflBits} bits. Deliberately readable, not the theoretical minimum. RFC 9800 additionally REQUIRES every NEXT-CSID implementation to support 32-bit LBL + 16-bit CSID length — the 48-bit block here is an ADDITIONALLY allowed choice, used because it is easier to visualize, not a replacement for that mandatory floor.`,
  },
  {
    id: "capacity-calc",
    label: "Compute Capacity",
    narrative: `K = floor((128 - LBL) / LNFL) = floor((128-${NEXT_CSID_LAYOUT.lblBits})/${NEXT_CSID_LAYOUT.lnflBits}) = floor(${128 - NEXT_CSID_LAYOUT.lblBits}/${NEXT_CSID_LAYOUT.lnflBits}) = ${CAPACITY} CSIDs per container.`,
  },
  {
    id: "predict-capacity-check",
    label: "Predict",
    narrative: "Before building any container:",
    question: {
      prompt: `With LBL=${NEXT_CSID_LAYOUT.lblBits} and LNFL=${NEXT_CSID_LAYOUT.lnflBits}, how many CSIDs fit in one 128-bit container?`,
      options: [
        { id: "5", label: "5" },
        { id: "8", label: "8" },
        { id: "4", label: "4" },
      ],
      correctOptionId: "5",
      explanation: `floor((128-48)/16) = floor(80/16) = 5.`,
    },
  },

  // --- 5. Topology ----------------------------------------------------------
  {
    id: "topology-intro",
    label: "Topology",
    narrative: "R1 (headend) through R8 (destination), a simple chain. Two alternate physical links exist — R3-R5 and R6-R8 — both deliberately more expensive by IGP metric than the chain they shortcut, reserved for the End.X experiments later.",
  },
  {
    id: "locator-block-intro",
    label: "Common Locator-Block",
    narrative: `Every router in this domain shares one Locator-Block: ${LOCATOR_BLOCK_TEXT}. R2..R8 each own a Locator-Node value under it: ${ALL_ROUTERS.filter((r) => r !== "R1")
      .map((r) => `${r}=${csidHexText(NEXT_CSID_VALUE[r])}`)
      .join(", ")}. A Locator-Node value is never presented as a standalone globally routable IPv6 address by itself — it only means something combined with the shared Locator-Block.`,
  },
  {
    id: "logical-program-intro",
    label: "The Logical Program",
    narrative: `High-level intent: R1 sends toward S1..S7 = R2 End, R3 End, R4 End, R5 End, R6 End, R7 End, R8 End — visit every router in the chain, in order. This intent is what compression must preserve exactly.`,
  },

  // --- 6. Structure validation ---------------------------------------------
  {
    id: "structure-model-intro",
    label: "SID Structure Advertisement",
    narrative: `Every router advertises its structure: LBL=${DEFAULT_STRUCTURE.lbl}, LNL=${DEFAULT_STRUCTURE.lnl}, FL=${DEFAULT_STRUCTURE.fl}, AL=${DEFAULT_STRUCTURE.al} (sums to 128). A headend needs more than "here's a SID address" — it must know the behavior, the flavor, and this structure to compress correctly.`,
  },
  {
    id: "validate-all-structures",
    label: "Validate Every Structure",
    narrative: "Before compressing anything: validateSidStructureForCompression() checks LBL != 0, LNFL != 0, and AL == 128-LBL-LNL-FL for every router. All eight currently pass — VALID.",
  },
  {
    id: "predict-not-every-sid-compressible",
    label: "Predict",
    narrative: "Before assuming every SID is eligible:",
    question: {
      prompt: "Must every SID in a logical program be compressible?",
      options: [
        { id: "no", label: "No — RFC 9800 allows a mix of compressed runs and ordinary uncompressed SIDs" },
        { id: "yes", label: "Yes — a program is either fully compressed or not compressed at all" },
      ],
      correctOptionId: "no",
      explanation: "Compression is never all-or-nothing. A segment with unknown/invalid structure, or a behavior with no support for the chosen flavor, simply travels as an ordinary uncompressed SID while the rest of the program still compresses.",
    },
  },

  // --- 7. Build the flagship uncompressed vs. compressed comparison --------
  {
    id: "uncompressed-program",
    label: "Uncompressed: 7 Full SIDs",
    narrative: `Uncompressed, this program is 7 independent 128-bit SIDs: ${R2_SID} (R2), ... through R8's own End SID — 7 x 16 = 112 bytes of segment-value storage alone.`,
  },
  {
    id: "compress-first-container",
    label: "Compress: Container A",
    narrative: `Compressing S1..S5 (R2..R6) into one NEXT-CSID container: Locator-Block | C1=${csidHexText(2)} | C2=${csidHexText(3)} | C3=${csidHexText(4)} | C4=${csidHexText(5)} | C5=${csidHexText(6)}. C1 occupies the Locator-Node/Function position; C2..C5 occupy the Argument.`,
    run: (state) => {
      const plan = compressNextCsidRun(BASE_PROGRAM, liveStructures(state));
      const { daHextets, srh } = buildDaAndSrh(plan);
      return { state: { ...state, packet: { daHextets, hopLimit: 64, srh }, packetAt: "R1", journey: [], activeMode: "END" }, events: [{ type: "SRV6_CSID_COMPRESSED", stepId: "compress-first-container", timestamp: Date.now(), message: "Compressed BASE_PROGRAM into NEXT-CSID containers" }] };
    },
  },
  {
    id: "not-five-ipv6-addresses",
    label: "Mandatory: Not Five IPv6 Addresses",
    narrative: "One 128-bit IPv6 Destination Address/container can carry multiple CSIDs. Do not picture five independent 128-bit IPv6 SIDs riding in the packet after compression — there is exactly ONE address here, holding five compressed identifiers.",
  },
  {
    id: "compress-second-container",
    label: "Compress: Container B",
    narrative: `S6, S7 (R7, R8) don't fit in Container A (capacity ${CAPACITY} already used) — they form Container B: Locator-Block | C6=${csidHexText(7)} | C7=${csidHexText(8)} | 0000 | 0000 | 0000. Two containers total, not seven SIDs.`,
  },
  {
    id: "full-srh-two-containers",
    label: "Outer DA + SRH (Two Containers)",
    narrative: "Outer DA = Container A. SRH: Segment List[0] = Container B, Segment List[1] = Container A. Last Entry = 1, Segments Left = 1 — exactly two 128-bit entries, regardless of how many CSIDs ride inside each one.",
  },
  {
    id: "predict-forward-vs-reverse",
    label: "Predict",
    narrative: "Before sending:",
    question: {
      prompt: "Within ONE NEXT-CSID container, are the CSIDs encoded in forward or reverse processing order?",
      options: [
        { id: "forward", label: "Forward — C1, C2, C3, ... in the exact order they'll be processed" },
        { id: "reverse", label: "Reverse — like the SRH's own Segment List entries" },
      ],
      correctOptionId: "forward",
      explanation: "Inside one container, CSIDs sit in forward processing order. It's only the 128-bit Segment List ENTRIES (whole containers) that RFC 8754 stores in reverse — two independent ordering rules.",
    },
  },
  {
    id: "predict-srh-entries-reverse",
    label: "Predict",
    narrative: "And the containers themselves:",
    question: {
      prompt: "Are 128-bit SRH Segment List entries still stored in reverse processing order, even when each entry is a compressed container?",
      options: [
        { id: "yes", label: "Yes — RFC 8754's reversed storage order is unchanged by compression" },
        { id: "no", label: "No — compression also reverses which container is Segment List[0]" },
      ],
      correctOptionId: "yes",
      explanation: "Segment List[0] is still the FINAL 128-bit entry (Container B here), Segment List[1] the first (Container A) — exactly RFC 8754's rule, applied one level up from individual SIDs to whole containers.",
    },
  },

  // --- 8. Interactive walk through the flagship program --------------------
  {
    id: "r1-imposes",
    label: "R1: Impose DA + SRH",
    narrative: `R1 imposes DA = Container A, SRH with Segment List[0]=Container B, [1]=Container A. Hop Limit = 64.`,
    packet: (state) => (state.packet ? csidPacket("r1-impose", "R1", "R1", "Imposed compressed DA + SRH", "H.Encaps", state.packet) : undefined),
    run: (state) => ({ state: { ...state, packetAt: "R1" }, events: [{ type: "PACKET_SENT", stepId: "r1-imposes", timestamp: Date.now(), message: "Imposed NEXT-CSID compressed packet" }] }),
  },
  {
    id: "r1-forward",
    label: "R1: Ordinary IPv6 FIB",
    narrative: "R1 forwards toward the Locator-Block using ordinary IPv6 FIB lookup — R2, the owner of the active CSID, is next.",
    packet: (state) => (state.packet ? csidPacket("r1-fib", "R1", "R2", "IPv6 FIB toward Locator-Block", "FIB", state.packet) : undefined),
    run: (state) => ({ state: { ...state, packetAt: "R2" }, events: [] }),
  },
  {
    id: "r2-match-execute",
    label: "R2: Local SID Match — NEXT-CSID Advance",
    narrative: `R2's Local SID Table matches the active CSID (${csidHexText(2)}). Behavior: End + NEXT-CSID. Argument (C2..C5) is non-zero -> INTRA-CONTAINER SHIFT.`,
    packet: (state) => (state.packet ? csidPacket("r2-after", "R2", "R2", "Stage shown: after R2's NEXT-CSID shift — R3's CSID is now active, Segments Left unchanged, Hop Limit decremented", "SHIFT", state.packet) : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const result = executeNextCsidAdvance({ daHextets: state.packet.daHextets, layout: NEXT_CSID_LAYOUT, hopLimit: state.packet.hopLimit, srh: state.packet.srh, endpointBehavior: "END" });
      const hop = nextCsidHop("R2", "END", state.packet, result, `Local SID: MATCH (End+NEXT-CSID). ${result.reason}`);
      return { state: { ...state, packet: { ...state.packet, daHextets: result.newDaHextets, hopLimit: result.newHopLimit, srh: result.newSrh }, journey: [...state.journey, hop] }, events: [{ type: "SRV6_CSID_CONTAINER_ADVANCED", stepId: "r2-match-execute", timestamp: Date.now(), message: "R2 intra-container NEXT-CSID shift" }] };
    },
    whatChanged: (prev, next) => [`R2: DA ${fmtIpv6(prev.packet!.daHextets)} -> ${fmtIpv6(next.packet!.daHextets)}. Segments Left unchanged. Hop Limit ${prev.packet!.hopLimit} -> ${next.packet!.hopLimit}.`],
  },
  {
    id: "predict-sl-during-shift",
    label: "Predict",
    narrative: "R2 just executed an intra-container NEXT-CSID advance.",
    question: {
      prompt: "Did Segments Left decrement during that advance?",
      options: [
        { id: "no", label: "No — no new 128-bit Segment List entry was consumed" },
        { id: "yes", label: "Yes — every SID advance decrements Segments Left" },
      ],
      correctOptionId: "no",
      explanation: "Segments Left counts 128-bit Segment List entries consumed. An intra-container shift only rearranges CSIDs already sitting inside the CURRENT DA — it never touches the SRH's Segment List, so Segments Left cannot change.",
    },
  },
  {
    id: "predict-why-sl-unchanged",
    label: "Predict",
    narrative: "One more, to make sure this isn't memorized rather than understood:",
    question: {
      prompt: "Why doesn't an intra-container shift decrement Segments Left?",
      options: [
        { id: "correct", label: "No new 128-bit Segment List entry has been consumed — the packet hasn't moved to another SRH row" },
        { id: "wrong", label: "Because NEXT-CSID containers don't use Segments Left at all" },
      ],
      correctOptionId: "correct",
      explanation: "Segments Left tracks position within the Segment List, one 128-bit entry at a time. NEXT-CSID containers absolutely use it — it just doesn't move until a container boundary is actually crossed.",
    },
  },
  {
    id: "predict-hop-limit-behavior",
    label: "Predict",
    narrative: "About the SAME advance at R2:",
    question: {
      prompt: "Does IPv6 Hop Limit decrement during a non-zero-Argument NEXT-CSID advance?",
      options: [
        { id: "yes", label: "Yes — RFC 9800 requires it, since the packet is conceptually taking a forwarding step" },
        { id: "no", label: "No — Hop Limit is untouched until a container boundary is crossed" },
      ],
      correctOptionId: "yes",
      explanation: "Hop Limit decrements by 1 on this advance even though Segments Left doesn't — the two counters answer different questions (loop protection vs. Segment List position) and change independently.",
    },
  },
  {
    id: "r2-forward",
    label: "R2: Ordinary FIB Toward New DA",
    narrative: "Behavior is End (not End.X) — R2 forwards using ordinary IPv6 FIB lookup toward the NEW active CSID's owner, R3.",
    packet: (state) => (state.packet ? csidPacket("r2-fwd", "R2", "R3", "IPv6 FIB toward new active CSID", "FIB", state.packet) : undefined),
    run: (state) => ({ state: { ...state, packetAt: "R3" }, events: [] }),
  },
  {
    id: "r3-r5-shift",
    label: "R3, R4, R5: Continue Shifting",
    narrative: "R3, then R4, then R5 each repeat the identical pattern: match, non-zero Argument, shift, Segments Left unchanged, Hop Limit -1, ordinary FIB forward. Fast-forwarded here — the mechanism never changes.",
    packet: (state) => (state.packet ? csidPacket("r3-r5", "R5", "R6", "Stage shown: after R3, R4 and R5 shifted — R6's CSID is now active, heading to R6", "SHIFT", state.packet) : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      let pkt = state.packet;
      const hops: CsidJourneyHop[] = [];
      for (const router of ["R3", "R4", "R5"] as RouterId[]) {
        const result = executeNextCsidAdvance({ daHextets: pkt.daHextets, layout: NEXT_CSID_LAYOUT, hopLimit: pkt.hopLimit, srh: pkt.srh, endpointBehavior: "END" });
        hops.push(nextCsidHop(router, "END", pkt, result, `Local SID: MATCH. ${result.reason}`));
        pkt = { ...pkt, daHextets: result.newDaHextets, hopLimit: result.newHopLimit, srh: result.newSrh };
      }
      return { state: { ...state, packet: pkt, packetAt: "R6", journey: [...state.journey, ...hops] }, events: [] };
    },
  },
  {
    id: "r6-boundary-cross",
    label: "R6: Container Boundary Crossed",
    narrative: `R6's Argument is now all zero — the container is exhausted. Instead of another shift: the NEXT 128-bit Segment List entry (Container B) is copied into the IPv6 DA, and ordinary SRH advancement applies (Segments Left DOES decrement here, and Hop Limit decrements once, as for any End).`,
    packet: (state) => (state.packet ? csidPacket("r6-after", "R6", "R6", "Stage shown: after R6 crossed the container boundary — Container B is active, SL 0, Hop Limit decremented", "BOUNDARY", state.packet) : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const result = executeNextCsidAdvance({ daHextets: state.packet.daHextets, layout: NEXT_CSID_LAYOUT, hopLimit: state.packet.hopLimit, srh: state.packet.srh, endpointBehavior: "END" });
      const hop = nextCsidHop("R6", "END", state.packet, result, `Local SID: MATCH. ${result.reason}`);
      return { state: { ...state, packet: { ...state.packet, daHextets: result.newDaHextets, hopLimit: result.newHopLimit, srh: result.newSrh }, journey: [...state.journey, hop] }, events: [{ type: "SRV6_CSID_CONTAINER_CROSSED", stepId: "r6-boundary-cross", timestamp: Date.now(), message: "R6 crossed from Container A to Container B" }] };
    },
    whatChanged: (prev, next) => [`R6: CONTAINER BOUNDARY CROSSED. Segments Left ${prev.packet!.srh?.segmentsLeft} -> ${next.packet!.srh?.segmentsLeft}. This is the ONLY point in the whole run where Segments Left changes.`],
  },
  {
    id: "predict-sl-at-boundary",
    label: "Predict",
    narrative: "Contrast this with every earlier hop:",
    question: {
      prompt: "At the container boundary R6 just crossed, does Segments Left change?",
      options: [
        { id: "yes", label: "Yes — a new 128-bit Segment List entry (Container B) was just consumed" },
        { id: "no", label: "No — Segments Left only ever changes for ordinary, non-compressed SIDs" },
      ],
      correctOptionId: "yes",
      explanation: "This is the one moment in the entire sequence where Segments Left actually decrements — precisely because, and only because, a new 128-bit Segment List entry was consumed.",
    },
  },
  {
    id: "r7-r8-finish",
    label: "R7, R8: Finish Container B",
    narrative: "R7 shifts within Container B (Segments Left unchanged again). R8's Argument is then all-zero with no further Segment List entries — FINAL. Delivered.",
    packet: (state) => (state.packet ? csidPacket("r7-r8", "R7", "R8", "Stage shown: after R7's shift — R8's CSID is active; R8 is the final segment", "SHIFT", state.packet) : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      let pkt = state.packet;
      const hops: CsidJourneyHop[] = [];
      for (const router of ["R7", "R8"] as RouterId[]) {
        const result = executeNextCsidAdvance({ daHextets: pkt.daHextets, layout: NEXT_CSID_LAYOUT, hopLimit: pkt.hopLimit, srh: pkt.srh, endpointBehavior: "END" });
        hops.push(nextCsidHop(router, "END", pkt, result, `Local SID: MATCH. ${result.reason}`));
        pkt = { ...pkt, daHextets: result.newDaHextets, hopLimit: result.newHopLimit, srh: result.newSrh };
      }
      return { state: { ...state, packet: pkt, packetAt: "R8", journey: [...state.journey, ...hops] }, events: [{ type: "PACKET_RECEIVED", stepId: "r7-r8-finish", timestamp: Date.now(), message: "Delivered at R8 via compressed NEXT-CSID encoding" }] };
    },
    whatChanged: () => ["Delivered R1 -> R2..R8 via exactly TWO 128-bit Segment List entries, not seven."],
  },

  // --- 9. One-container / no-SRH lab ---------------------------------------
  {
    id: "one-container-intro",
    label: "One Container, No SRH",
    narrative: `A shorter program — R2..R5 (4 segments) — fits entirely in one NEXT-CSID container (capacity ${CAPACITY}). If no SRH-specific information is needed, no SRH is required at all — exactly the lesson SRv6 Foundations, L3VPN, and TI-LFA already taught for single-SID policies.`,
    run: (state) => {
      const shortProgram = BASE_PROGRAM.slice(0, 4);
      const plan = compressNextCsidRun(shortProgram, liveStructures(state));
      const { daHextets, srh } = buildDaAndSrh(plan);
      return { state: { ...state, packet: { daHextets, hopLimit: 64, srh }, packetAt: "R1", journey: [] }, events: [] };
    },
  },
  {
    id: "predict-one-container-no-srh",
    label: "Predict",
    narrative: "Before inspecting the packet:",
    question: {
      prompt: "Does this 4-segment compressed program need an SRH?",
      options: [
        { id: "no", label: "No — one container, one 128-bit DA, nothing left for an SRH to carry" },
        { id: "yes", label: "Yes — SRv6 always requires an SRH" },
      ],
      correctOptionId: "no",
      explanation: "One container is one 128-bit value — it fits entirely in the IPv6 Destination Address. There's no second Segment List entry, so there's nothing for an SRH to carry.",
    },
  },
  {
    id: "one-container-no-fake-srh",
    label: "No Fake SRH",
    narrative: "The Packet Inspector never renders an empty SRH for this packet — exactly like every prior SRv6 lesson in this track, SRv6 does not mean every packet carries the extension header.",
  },

  // --- 10. End vs End.X ------------------------------------------------------
  {
    id: "endx-intro",
    label: "Base Behavior Still Matters",
    narrative: "NEXT-CSID is a flavor, not a replacement for the endpoint semantic. End determines the next compressed SID and forwards via ordinary IPv6 FIB. End.X determines the SAME next compressed SID — but forwards via one specific, pre-bound adjacency instead.",
  },
  {
    id: "endx-setup",
    label: "R6 End.X + NEXT-CSID -> R8",
    narrative: `A shorter program skips R7 as a segment entirely: R2, R3, R4, R5, R6(End.X, adjacency=R8). Ordinary IPv6 FIB from R6 toward R8's locator would prefer the R6-R7-R8 chain (cost 20). R6's End.X SID instead forces the direct R6-R8 link (cost 50) — a real, different, physical path.`,
    run: (state) => {
      const plan = compressNextCsidRun(ENDX_PROGRAM, liveStructures(state));
      const { daHextets, srh } = buildDaAndSrh(plan);
      return { state: { ...state, packet: { daHextets, hopLimit: 64, srh }, packetAt: "R1", journey: [], activeMode: "END_X" }, events: [] };
    },
  },
  {
    id: "predict-endx-forwarding",
    label: "Predict",
    narrative: "Before R6 processes this packet:",
    question: {
      prompt: "Once R6 constructs the next compressed SID via NEXT-CSID, how does it choose where to send the packet?",
      options: [
        { id: "adjacency", label: "Via its pre-bound End.X adjacency (R8 directly) — regardless of what ordinary FIB would prefer" },
        { id: "fib", label: "Via an ordinary IPv6 FIB lookup toward the new active SID's owner" },
      ],
      correctOptionId: "adjacency",
      explanation: "End.X's whole point is bypassing the FIB lookup in favor of one specific, pre-configured adjacency — even when, as here, that adjacency is the more expensive physical path.",
    },
  },
  {
    id: "endx-walk",
    label: "Walk To R6, Cross, Forward via Adjacency",
    narrative: "R2..R5 shift normally. At R6: Argument is zero (R6 is the last CSID in its container) -> container boundary crossed, loading the single-CSID Container B (R8 only). R6 then forwards via its End.X adjacency directly to R8, never touching R7.",
    packet: (state) => (state.packet ? csidPacket("endx-walk", "R6", "R8", "Stage shown: after R6 End.X + NEXT-CSID — Container B active, forced over adjacency R6→R8 (R7 bypassed)", "END.X", state.packet) : undefined),
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      let pkt = state.packet;
      const hops: CsidJourneyHop[] = [];
      for (const router of ["R2", "R3", "R4", "R5"] as RouterId[]) {
        const result = executeNextCsidAdvance({ daHextets: pkt.daHextets, layout: NEXT_CSID_LAYOUT, hopLimit: pkt.hopLimit, srh: pkt.srh, endpointBehavior: "END" });
        hops.push(nextCsidHop(router, "END", pkt, result, `Local SID: MATCH. ${result.reason}`));
        pkt = { ...pkt, daHextets: result.newDaHextets, hopLimit: result.newHopLimit, srh: result.newSrh };
      }
      const r6 = executeNextCsidAdvance({ daHextets: pkt.daHextets, layout: NEXT_CSID_LAYOUT, hopLimit: pkt.hopLimit, srh: pkt.srh, endpointBehavior: "END_X", adjacency: "R8" });
      hops.push(nextCsidHop("R6", "END_X", pkt, r6, `Local SID: MATCH (End.X+NEXT-CSID). ${r6.reason} Forwards via adjacency ${r6.forwardVia}, not FIB.`));
      pkt = { ...pkt, daHextets: r6.newDaHextets, hopLimit: r6.newHopLimit, srh: r6.newSrh };
      return { state: { ...state, packet: pkt, packetAt: "R8", journey: [...state.journey, ...hops] }, events: [{ type: "SRV6_CSID_CONTAINER_CROSSED", stepId: "endx-walk", timestamp: Date.now(), message: "R6 End.X forced adjacency to R8, bypassing R7" }] };
    },
    whatChanged: () => ["R6 forwarded directly to R8 over the (more expensive) direct link — R7 never saw this packet, even though it's a valid physical transit router."],
  },
  {
    id: "endx-r8-final",
    label: "R8: Final",
    narrative: "R8's Argument is zero with no further Segment List entries — FINAL. Delivered, having skipped R7 entirely, exactly as End.X's forced adjacency demanded.",
    run: (state) => {
      if (!state.packet) return { state, events: [] };
      const result = executeNextCsidAdvance({ daHextets: state.packet.daHextets, layout: NEXT_CSID_LAYOUT, hopLimit: state.packet.hopLimit, srh: state.packet.srh, endpointBehavior: "END" });
      const hop = nextCsidHop("R8", "END", state.packet, result, `Local SID: MATCH. ${result.reason}`);
      return { state: { ...state, packet: { ...state.packet, daHextets: result.newDaHextets }, journey: [...state.journey, hop] }, events: [{ type: "PACKET_RECEIVED", stepId: "endx-r8-final", timestamp: Date.now(), message: "Delivered via End.X-forced path" }] };
    },
  },

  // --- 11. Final ordinary service SID (NEXT-CSID + PE2_DT4_SID reuse) ------
  {
    id: "next-csid-restriction",
    label: "RFC 9800 Restriction",
    narrative: "RFC 9800 does not define a NEXT-CSID flavor for End.DX6, End.DX4, End.DT6, End.DT4, End.DT46, End.DX2, End.DX2V, End.DT2U, or End.DT2M. Do not invent \"End.DT4 + NEXT-CSID\" as an RFC-defined behavior. These service behaviors can still be the FINAL SID after a NEXT-CSID sequence.",
  },
  {
    id: "predict-dt4-next-defined",
    label: "Predict",
    narrative: "To make sure this restriction is concrete, not just quoted:",
    question: {
      prompt: "Does RFC 9800 define an End.DT4 + NEXT-CSID flavor?",
      options: [
        { id: "no", label: "No — NEXT-CSID has no defined flavor for End.DT4 or any other service behavior" },
        { id: "yes", label: "Yes — End.DT4 can carry the NEXT-CSID flavor like End or End.X" },
      ],
      correctOptionId: "no",
      explanation: "Only End and End.X (and other topological behaviors) get a NEXT-CSID flavor. End.DT4 can still appear — just as an ordinary, uncompressed final SID after a NEXT-CSID run, never itself flavored NEXT-CSID.",
    },
  },
  {
    id: "final-service-sid-experiment",
    label: "Small Experiment: Compressed Transport + Real Service SID",
    narrative: `Reusing SRv6 L3VPN's real PE2 End.DT4 Service SID (${PE2_DT4_SID.sidText}) directly — this lesson never rebuilds the L3VPN control plane, it only shows the SID appended, unflavored, as the LAST Segment List entry after a NEXT-CSID transport run (R2, R3 compressed).`,
    run: (state) => {
      const transport = BASE_PROGRAM.slice(0, 2); // R2, R3
      const plan = compressNextCsidRun(transport, liveStructures(state));
      const { daHextets: containerDa } = buildDaAndSrh(plan);
      const entries = [...plan.entries, { kind: "ORDINARY" as const, hextets: PE2_DT4_SID.sidHextets, segments: [], label: "PE2 End.DT4 (ordinary — real L3VPN Service SID)" }];
      const { daHextets, srh } = buildDaAndSrh({ ...plan, entries });
      void containerDa;
      return { state: { ...state, packet: { daHextets, hopLimit: 64, srh }, packetAt: "R1", journey: [] }, events: [] };
    },
    whatChanged: () => [`Final Segment List entry is ${PE2_DT4_SID.sidText} — an ordinary SID, no NEXT-CSID flavor, exactly as RFC 9800 requires.`],
  },
  {
    id: "predict-last-sid-no-flavor-required",
    label: "Predict",
    narrative: "One more, generalizing the point:",
    question: {
      prompt: "Must the LAST SID in a NEXT-CSID sequence itself carry the NEXT-CSID flavor?",
      options: [
        { id: "no", label: "No — it may execute any valid SRv6 behavior if the constructed DA is a valid form for that SID" },
        { id: "yes", label: "Yes — every SID in the sequence must share the same flavor" },
      ],
      correctOptionId: "no",
      explanation: "The final SID in a compressed sequence is free to be an ordinary, unflavored SID — including a service behavior like End.DT4 — as long as the DA that reaches it is a valid representation of that SID.",
    },
  },

  // --- 12. Structure validation invariants + fault --------------------------
  {
    id: "structure-invariants",
    label: "Structure Validation Rules",
    narrative: "LBL=0 -> invalid. LNFL=0 -> invalid. AL != 128-LBL-LNL-FL -> invalid structure. An invalid structure is treated exactly like an UNKNOWN one for compression purposes: not compressible, full stop.",
  },
  {
    id: "mixed-flavor-preview",
    label: "Mixed Flavors (Conceptual)",
    narrative: "RFC 9800 allows NEXT-CSID runs, REPLACE-CSID runs, and ordinary SIDs to coexist in one compressed segment list where conditions permit — a full mixed-flavor lab isn't built here, but nothing in this lesson's model prevents it: compressNextCsidRun/compressReplaceCsidRun both already fall back to ordinary SID entries whenever a segment isn't eligible.",
  },
  {
    id: "troubleshooting-intro",
    label: "INCIDENT",
    narrative: "The SR Policy is valid. All individual SIDs are reachable. Packet delivery is possible. But the expected compressed encoding is not being produced.",
    run: (state) => ({ state: { ...state, mainFault: { ...state.mainFault, active: true }, mainTroubleshooting: { ...state.mainTroubleshooting, started: true } }, events: [{ type: "SRV6_CSID_STRUCTURE_INVALID", stepId: "troubleshooting-intro", timestamp: Date.now(), message: `${state.mainFault.targetRouter} structure corrupted: AL advertised as ${FAULTY_STRUCTURE.al}` }] }),
  },
  {
    id: "diagnostic-ladder",
    label: "Diagnostic Ladder",
    narrative: `SR Policy valid (yes). SID semantic list valid (yes). R4 SID reachable (yes — ordinary SID ${R4_SID} responds fine). NEXT-CSID capability (yes). R4 SID structure advertised (yes). LBL non-zero (yes). LNFL non-zero (yes). Advertised AL = 48. Calculated AL = 128-48-16-0 = 64. SID structure VALID? NO.`,
  },
  {
    id: "trouble-question",
    label: "Diagnose",
    narrative: "Given everything above:",
    question: {
      prompt: "Why isn't R4's SID compressing, even though it's fully reachable and the SR Policy is valid?",
      options: [
        { id: "correct", label: "Its advertised structure is internally inconsistent (AL doesn't equal 128-LBL-LNL-FL), so it's treated as unknown and excluded from compression" },
        { id: "reach", label: "R4 is unreachable" },
        { id: "policy", label: "The SR Policy itself is invalid" },
      ],
      correctOptionId: "correct",
      explanation: "Reachability and policy validity are both fine — this is purely a structure-validation failure, which is why it's easy to miss: nothing about the DATA PLANE looks broken.",
      hints: ["Check R4's own advertised LBL/LNL/FL/AL against the AL formula.", "128 - 48 - 16 - 0 = 64, not 48."],
    },
  },
  {
    id: "fault-consequence",
    label: "Consequence",
    narrative: "R4's structure is treated as unknown -> R4 is NOT compressible. This does not drop the whole policy — a valid mixed compressed/uncompressed encoding still represents the exact same program.",
    packet: (state) => (state.packet ? csidPacket("fault-mixed", "R1", "R1", "Mixed compressed/ordinary encoding — R4 broken out", "MIXED", state.packet) : undefined),
    run: (state) => {
      const plan = compressNextCsidRun(BASE_PROGRAM, liveStructures(state));
      const { daHextets, srh } = buildDaAndSrh(plan);
      return { state: { ...state, packet: { daHextets, hopLimit: 64, srh }, packetAt: "R1", journey: [] }, events: [] };
    },
    whatChanged: () => ["Compression plan is now THREE entries instead of two: Container(R2,R3), ordinary R4, Container(R5,R6,R7,R8) — R4 never disappears from the program."],
  },
  {
    id: "wrong-repair-metric",
    label: "Wrong Repair #1",
    narrative: "\"Change the IGP metric.\" Rejected before it's even tried: reachability is healthy. This was never a routing problem.",
    action: (state, payload) => {
      const choice = payload as string;
      return { state: { ...state, mainTroubleshooting: { ...state.mainTroubleshooting, repairAttempt: { choice, correct: false } } }, events: [] };
    },
  },
  {
    id: "wrong-repair-preference",
    label: "Wrong Repair #2",
    narrative: "\"Increase SR Policy preference.\" Rejected: the selected policy is already valid and active — preference isn't the axis this fault lives on.",
  },
  {
    id: "wrong-repair-ignore-structure",
    label: "Wrong Repair #3",
    narrative: "\"Force the compressor to ignore the advertised structure.\" Rejected: RFC 9800 requires validation — an invalid/unknown structure is not compressible, and pretending otherwise risks constructing a DA that isn't actually a valid SID.",
  },
  {
    id: "repair-challenge",
    label: "Correct Repair",
    narrative: "Fix R4's structure advertisement: AL = 64.",
    question: {
      prompt: "What actually resolves this incident?",
      options: [
        { id: "fix-al", label: "Correct R4's advertised AL to 64 (128-48-16-0)" },
        { id: "metric", label: "Raise the IGP metric on R4's links" },
        { id: "preference", label: "Increase the SR Policy's preference value" },
        { id: "ignore", label: "Configure the headend to ignore structure validation for R4" },
      ],
      correctOptionId: "fix-al",
      explanation: "Only correcting the structure itself restores compressibility — everything else either targets the wrong layer or asks the headend to skip a validation RFC 9800 requires.",
    },
  },
  {
    id: "apply-repair",
    label: "Repair Applied — Recompute",
    narrative: "AL corrected to 64. Structure now VALID. Recompute: R4 rejoins the compressible run. Containers rebuilt: Container A = R2,R3,R4,R5,R6 (full, capacity 5). Container B = R7,R8 + padding. Packet encoding shrinks back to two entries.",
    action: (state) => {
      const repaired = { ...state.mainFault, repaired: true };
      const plan = compressNextCsidRun(BASE_PROGRAM, structuresWithFault(state.structures, state.challengeFault));
      const { daHextets, srh } = buildDaAndSrh(plan);
      return { state: { ...state, mainFault: repaired, packet: { daHextets, hopLimit: 64, srh }, packetAt: "R1", journey: [], mainTroubleshooting: { ...state.mainTroubleshooting, correctVerified: true } }, events: [{ type: "SRV6_CSID_STRUCTURE_REPAIRED", stepId: "apply-repair", timestamp: Date.now(), message: "R4 structure corrected — full compression restored" }] };
    },
    requiresState: (state) => state.mainTroubleshooting.correctVerified,
  },
  {
    id: "mandatory-resend",
    label: "Mandatory Resend",
    narrative: "A NEW packet, built from the recomputed plan, is required to verify the repair — the pre-repair mixed encoding and the post-repair two-container encoding both represent the exact same logical program, verified via expandCompressedProgram(), never assumed.",
    packet: (state) => (state.packet ? csidPacket("resend", "R1", "R1", "Post-repair packet, fully compressed", "VERIFY", state.packet) : undefined),
    run: (state) => {
      const plan = compressNextCsidRun(BASE_PROGRAM, liveStructures(state));
      const equivalent = verifyCompressionEquivalence(BASE_PROGRAM, plan);
      return { state, events: [{ type: "QUESTION_ANSWERED", stepId: "mandatory-resend", timestamp: Date.now(), message: `Equivalence verified: ${equivalent}` }] };
    },
    whatChanged: () => ["Incident resolved. Packet encoding: 2 Segment List entries (down from 3 during the fault) — same logical program throughout."],
  },

  // --- 13. Compression comparison + metrics ---------------------------------
  {
    id: "compression-comparison",
    label: "Uncompressed vs. NEXT-CSID",
    narrative: `Segment-value storage comparison (not total packet size — outer IPv6/SRH-base/TLV overhead is separate): uncompressed 7 x 16 = 112 bytes. Compressed 2 x 16 = 32 bytes. Saved: 80 bytes.`,
  },
  {
    id: "compression-metrics-viewer",
    label: "Compression Metrics",
    narrative: "calculateCompressionMetrics() computes originalSegmentCount, compressedContainerCount, originalSegmentBytes, compressedSegmentBytes, savedBytes, and percentageReduction from the REAL plan — never hardcoded percentages.",
  },
  {
    id: "mtu-lab",
    label: "MTU Experiment",
    narrative: "A packet near MTU with a long SRH: calculateModeledPacketSize() shows outer IPv6 + SRH + segment-value bytes + payload for both encodings. Compression can materially reduce SRv6 HEADER OVERHEAD for long programs — it does not increase the physical path MTU itself.",
  },
  {
    id: "header-efficiency-lab",
    label: "Header-Efficiency Table",
    narrative: "Varying logical-segment counts (1, 2, 3, 5, 6, 8, 10, 15) against this lesson's own capacity (5): every count maps deterministically to a container count via ceil(n/5) — computed live from the same compressNextCsidRun(), not a separate formula.",
  },

  // --- 14. REPLACE-CSID ------------------------------------------------------
  {
    id: "replace-csid-intro",
    label: "Introduce REPLACE-CSID",
    narrative: "NEXT-CSID: each container is itself a fully formed SID, carrying subsequent CSIDs in its Argument. REPLACE-CSID: only the FIRST container of the sequence is a fully formed SID — later Segment List entries are packed CSID containers that never repeat the Locator-Block.",
  },
  {
    id: "replace-layout",
    label: "REPLACE-CSID Lab Parameters",
    narrative: `LBL=${REPLACE_CSID_LAYOUT.lblBits}, LNFL=${REPLACE_CSID_LAYOUT.lnflBits} — a DIFFERENT CSID size from the NEXT-CSID lab, on purpose. K = floor(128/${REPLACE_CSID_LAYOUT.lnflBits}) = ${REPLACE_CAPACITY} CSID positions per packed container.`,
  },
  {
    id: "predict-replace-capacity",
    label: "Predict",
    narrative: "Before building anything:",
    question: {
      prompt: `With LNFL=${REPLACE_CSID_LAYOUT.lnflBits} bits, how many CSIDs fit in one packed REPLACE-CSID container?`,
      options: [
        { id: "4", label: "4" },
        { id: "5", label: "5 (the NEXT-CSID lab's number)" },
      ],
      correctOptionId: "4",
      explanation: "floor(128/32) = 4. A packed container carries no Locator-Block at all, so the full 128 bits divides purely into CSID-sized slots.",
    },
  },
  {
    id: "replace-first-container",
    label: "First Container: A Fully Formed SID",
    narrative: "The first item is a fully formed 128-bit SID: Locator-Block + first CSID (Locator-Node + Function) + Index. Initially Index = 0.",
    run: (state) => {
      const plan = compressReplaceCsidRun(REPLACE_PROGRAM, liveStructures(state));
      const { daHextets, srh } = buildDaAndSrh(plan);
      return { state: { ...state, replacePacket: { daHextets, hopLimit: 64, srh }, replaceJourney: [] }, events: [] };
    },
  },
  {
    id: "replace-packed-containers",
    label: "Packed Containers",
    narrative: `Subsequent Segment List entries pack C2, C3, C4 without repeating the Locator-Block. RFC 9800 fills a packed container from its LEAST-significant position: C2 (R3) sits in position ${REPLACE_CAPACITY - 1}, C3 (R4) in ${REPLACE_CAPACITY - 2}, C4 (R8 End.DT4) in ${REPLACE_CAPACITY - 3}, and position 0 is padding — physical position is NOT processing order. A packed container is NOT copied verbatim into the IPv6 DA — RFC 9800 processing always CONSTRUCTS a valid SRv6 SID before it becomes the active DA.`,
  },
  {
    id: "predict-packed-not-copied",
    label: "Predict",
    narrative: "Before R2 processes the first advance:",
    question: {
      prompt: "May a packed REPLACE-CSID container ever appear directly as the IPv6 Destination Address?",
      options: [
        { id: "no", label: "No — the DA must always be reconstructed into a valid SID (Locator-Block + one CSID + Index)" },
        { id: "yes", label: "Yes — packed containers are copied straight into the DA to save a step" },
      ],
      correctOptionId: "no",
      explanation: "A packed container has no Locator-Block and isn't a valid SID by itself. Processing always builds a fresh valid SID from it — never a direct copy.",
    },
  },
  {
    id: "replace-advance-walk",
    label: "Walk The REPLACE-CSID Sequence",
    narrative: `R2 (Index 0, fully formed) -> Index 0 means its entry is exhausted: Segments Left decrements, the Index resets to K-1 = ${REPLACE_CAPACITY - 1}, and R3's SID is reconstructed from packed position ${REPLACE_CAPACITY - 1}. R3 -> Index ${REPLACE_CAPACITY - 1} → ${REPLACE_CAPACITY - 2}, R4's SID from position ${REPLACE_CAPACITY - 2}. R4 -> Index ${REPLACE_CAPACITY - 2} → ${REPLACE_CAPACITY - 3}, R8's End.DT4 SID from position ${REPLACE_CAPACITY - 3}. The Index counts DOWN, and every advance decrements Hop Limit.`,
    packet: (state) => (state.replacePacket ? csidPacket("replace-walk", "R8", "R8", "Stage shown: REPLACE-CSID walk complete — R8 End.DT4 is active", "REPLACE", state.replacePacket) : undefined),
    run: (state) => {
      if (!state.replacePacket) return { state, events: [] };
      let pkt = state.replacePacket;
      const hops: CsidJourneyHop[] = [];
      for (const segment of REPLACE_PROGRAM) {
        const result = executeReplaceCsidAdvance({ daHextets: pkt.daHextets, layout: REPLACE_CSID_LAYOUT, hopLimit: pkt.hopLimit, srh: pkt.srh });
        hops.push(replaceCsidHop(segment, pkt, result));
        pkt = { ...pkt, daHextets: result.newDaHextets, hopLimit: result.newHopLimit, srh: result.newSrh };
      }
      return { state: { ...state, replacePacket: pkt, packetAt: "R8", replaceJourney: [...state.replaceJourney, ...hops] }, events: [{ type: "SRV6_CSID_REPLACE_ADVANCED", stepId: "replace-advance-walk", timestamp: Date.now(), message: "Walked full REPLACE-CSID sequence to R8 End.DT4" }] };
    },
  },
  {
    id: "predict-replace-index-order",
    label: "Predict",
    narrative: "About storage, not processing:",
    question: {
      prompt: "Across SRH Segment List entries, is storage order still reversed relative to processing order in REPLACE-CSID, exactly like NEXT-CSID?",
      options: [
        { id: "yes", label: "Yes — RFC 8754's reversed 128-bit-entry storage order is unaffected by which CSID flavor is used" },
        { id: "no", label: "No — REPLACE-CSID stores entries in forward order because of the Index field" },
      ],
      correctOptionId: "yes",
      explanation: "The Index field changes how a SINGLE entry advances internally — it has no effect on RFC 8754's independent rule that 128-bit Segment List entries themselves are stored in reverse.",
    },
  },
  {
    id: "replace-dt4-execute",
    label: "R8: End.DT4 + REPLACE-CSID",
    narrative: `The reconstructed SID at R8 matches its own local ${BEHAVIOR_LABEL.END_DT4} SID exactly. Unlike NEXT-CSID, RFC 9800 DOES define REPLACE-CSID flavors for End.DX4/End.DX6/End.DT4/End.DT6/End.DT46/End.DX2/End.DX2V/End.DT2U/End.DT2M. R8 decapsulates and does an ordinary IPv4 VRF lookup for ${CSID_CUST_HOST} — the compression flavor changed how the SID list advanced/encoded, never the underlying ${BEHAVIOR_LABEL.END_DT4} service meaning.`,
    run: (state) => {
      const result = executeEndDt4Decap(CSID_CUST_HOST);
      return { state, events: [{ type: "VPN_PACKET_DELIVERED", stepId: "replace-dt4-execute", timestamp: Date.now(), message: `End.DT4 delivered via ${result.matchedRoute}` }] };
    },
  },
  {
    id: "predict-dt4-replace-defined",
    label: "Predict",
    narrative: "The mirror image of the earlier NEXT-CSID question:",
    question: {
      prompt: "Does RFC 9800 define an End.DT4 + REPLACE-CSID flavor?",
      options: [
        { id: "yes", label: "Yes — REPLACE-CSID has a defined flavor for End.DT4 and the other listed service behaviors" },
        { id: "no", label: "No — service behaviors never get a compression flavor of any kind" },
      ],
      correctOptionId: "yes",
      explanation: "REPLACE-CSID, unlike NEXT-CSID, explicitly covers End.DX4/DX6/DT4/DT6/DT46/DX2/DX2V/DT2U/DT2M — that's exactly why this lesson built the End.DT4+REPLACE-CSID example but never an End.DT4+NEXT-CSID one.",
    },
  },

  // --- 15. NEXT vs. REPLACE comparison + mixed flavors ----------------------
  {
    id: "flavor-comparison",
    label: "NEXT-CSID vs. REPLACE-CSID",
    narrative: "First container: NEXT-CSID's is fully formed AND holds every remaining CSID's argument; REPLACE-CSID's is fully formed but holds only the first CSID + an Index. Later containers: NEXT-CSID's are also fully formed SIDs; REPLACE-CSID's are packed, non-SID containers. Locator-Block repetition: NEXT-CSID repeats it in every container; REPLACE-CSID only in the first. Active advancement: NEXT-CSID shifts an Argument; REPLACE-CSID reconstructs from an Index. Service behavior support: NEXT-CSID none; REPLACE-CSID yes (listed behaviors). IPv6 DA validity: both always construct a valid SID as the active DA.",
  },
  {
    id: "mixed-experiment",
    label: "Small Mixed-Flavor Experiment",
    narrative: "Conceptually: a segment list could carry a NEXT-CSID run, then an ordinary SID, then a REPLACE-CSID run, provided each segment's structure/flavor eligibility is independently valid — the SAME compressibility rules already built, just not chained together as a dedicated lab here to keep this lesson's main arc focused.",
  },

  // --- 16. GIB/LIB, control plane, SR Policy + TI-LFA integration ----------
  {
    id: "gib-lib-intro",
    label: "GIB / LIB",
    narrative: "GIB = Global ID Block, LIB = Local ID Block. Global CSIDs suit node/global segments (like this lesson's R2..R8 Locator-Nodes). Local CSIDs suit services, adjacencies, and cross-connects with meaning only within one node's own local context.",
  },
  {
    id: "global-plus-local",
    label: "Global + Local Example",
    narrative: `A global node CSID (${csidHexText(NEXT_CSID_VALUE.R6)}, R6) combined with a local End.X function CSID conceptually forms one combined FIB entry — Global + Local — enabling efficient longest-prefix matching of the pair. This lesson previews the concept; it does not implement a full GIB/LIB allocation engine.`,
  },
  {
    id: "operational-guidance",
    label: "Operational Guidance",
    narrative: "Consistent Locator-Block and CSID lengths inside a routing domain generally improve compression efficiency. Tradeoff: a smaller CSID compresses better but shrinks the per-CSID numbering space; a larger CSID gives more numbering flexibility but compresses less. There is no universally best size.",
  },
  {
    id: "control-plane-preview",
    label: "Control Plane (Preview Only)",
    narrative: "A headend needs more than a bare SID address to compress correctly — it needs the behavior, the flavor, and the structure, learned via control plane, configuration, or management. RFC 9352 and RFC 9513 define IGP signaling for this; this lesson previews the requirement without implementing IS-IS/OSPF CSID advertisement.",
  },
  {
    id: "compression-source",
    label: "Where Compression Happens",
    narrative: "The SR source/headend performs SID-list compression. Endpoint routers process the resulting compressed encoding according to their own flavor. Transit routers do ordinary IPv6 forwarding — they have no idea compression is even in effect.",
  },
  {
    id: "sr-policy-integration",
    label: "SR Policy Integration",
    narrative: "Pipeline: SR Policy selects a logical segment list -> headend validates SID structures/flavors -> compresses eligible runs -> constructs the actual packet encoding. Candidate-path selection happens conceptually BEFORE packet encoding/compression — compression never changes policy preference or candidate validity, except where packet construction itself becomes impossible.",
  },
  {
    id: "tilfa-integration",
    label: "TI-LFA Integration",
    narrative: `Reusing SRv6 TI-LFA's real multi-SID repair list (${MULTI_SID_INTERMEDIATE.owner} End.X -> ${MULTI_SID_FINAL.owner} End.X, 2 x 16 = 32 bytes uncompressed): if both repair SIDs shared one common Locator-Block, this lesson's own NEXT-CSID mechanics could fold them into a single 16-byte container — same repair intent and path, smaller encoding. TI-LFA's own repair COMPUTATION is reused as-is, never rebuilt here.`,
  },

  // --- 17. Engineer Challenge (independent fault at R6) ---------------------
  {
    id: "challenge-intro",
    label: "Engineer Challenge: Compress The Network Program",
    narrative: "Inspect the 8-router chain, identify the common Locator-Block, validate every structure, compute capacity, build both containers, construct DA + SRH, and step through the full lifecycle end to end — this time with a FRESH, independent fault to diagnose and repair.",
    run: (state) => ({ state: { ...state, challenge: { ...state.challenge, started: true } }, events: [] }),
  },
  {
    id: "challenge-inject-fault",
    label: "A New Fault: R6",
    narrative: "R6's advertised structure is now corrupted the same way R4's was — AL advertised as 48 instead of 64.",
    run: (state) => ({ state: { ...state, challengeFault: { ...state.challengeFault, active: true } }, events: [{ type: "SRV6_CSID_STRUCTURE_INVALID", stepId: "challenge-inject-fault", timestamp: Date.now(), message: "R6 structure corrupted" }] }),
  },
  {
    id: "challenge-diagnose",
    label: "Challenge: Diagnose",
    narrative: "Same diagnostic ladder as before, applied independently to R6.",
    question: {
      prompt: "R6 is reachable, the SR Policy is valid, but R6 isn't compressing. What's wrong?",
      options: [
        { id: "correct", label: "R6's advertised AL doesn't equal 128-LBL-LNL-FL, so its structure is invalid and it's excluded from compression" },
        { id: "wrong", label: "R6's locator route was withdrawn" },
      ],
      correctOptionId: "correct",
      explanation: "Same fault class as R4 earlier — a structure-validation failure, not a reachability failure.",
    },
  },
  {
    id: "challenge-repair",
    label: "Challenge: Repair",
    narrative: "Fix R6's structure.",
    question: {
      prompt: "What resolves it?",
      options: [
        { id: "fix-al", label: "Correct R6's advertised AL to 64" },
        { id: "restart-bgp", label: "Reset R6's BGP session" },
        { id: "policy", label: "Recompute the SR Policy from scratch" },
      ],
      correctOptionId: "fix-al",
      explanation: "Exactly the same repair shape as R4's — this is deliberate: the fault CLASS matters, not the specific router.",
    },
  },
  {
    id: "challenge-verify",
    label: "Challenge: Verify Equivalence",
    narrative: "expandCompressedProgram() on the recomputed plan must still equal BASE_PROGRAM exactly — repairing a structure never changes the logical program, only its encoding.",
    action: (state) => {
      const repaired = { ...state.challengeFault, repaired: true };
      const plan = compressNextCsidRun(BASE_PROGRAM, structuresWithFault(state.structures, { ...state.mainFault, repaired: true }));
      const equivalent = verifyCompressionEquivalence(BASE_PROGRAM, plan);
      return { state: { ...state, challengeFault: repaired, challenge: { ...state.challenge, correctVerified: equivalent } }, events: [{ type: "SRV6_CSID_STRUCTURE_REPAIRED", stepId: "challenge-verify", timestamp: Date.now(), message: `R6 repaired, equivalence=${equivalent}` }] };
    },
    requiresState: (state) => state.challenge.correctVerified,
  },
  {
    id: "challenge-replace-confirm",
    label: "Challenge: Confirm REPLACE-CSID Understanding",
    narrative: "One last check before completing:",
    question: {
      prompt: "In this lesson's REPLACE-CSID lab, which SID was the final one, and did it need the REPLACE-CSID flavor itself?",
      options: [
        { id: "correct", label: "R8's End.DT4 — and yes, RFC 9800 defines a REPLACE-CSID flavor for End.DT4, unlike NEXT-CSID" },
        { id: "wrong", label: "R8's End.DT4 — but it never carries any compression flavor at all" },
      ],
      correctOptionId: "correct",
      explanation: "This is the one place NEXT-CSID and REPLACE-CSID genuinely diverge for service behaviors: REPLACE-CSID supports them, NEXT-CSID does not.",
    },
  },
  {
    id: "complete",
    label: "Complete",
    narrative: "SRv6 Compressed SID / CSID (RFC 9800) complete: NEXT-CSID and REPLACE-CSID, structure validation, partial compression, the End/End.X/End.DT4 flavor distinction, one fault fully diagnosed and repaired twice independently, and the equivalence invariant verified throughout.",
  },
];
