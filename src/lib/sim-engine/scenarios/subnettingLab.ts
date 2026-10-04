import type { LabModel } from "@/lib/practice-lab/types";
import { ipToNum, numToIp } from "./fundamentalsPackets";
import { PARENT, SEGMENTS, alignedBlocks, blockSize, containingNetwork, describe, freeRanges, isAligned, maskOf, overlaps, prefixFor, rangeOf, usableHosts, type Allocation, type Range, type SegId } from "./subnettingDesign";

/**
 * SUBNETTING LAB — a pure, deterministic model of the Subnet Design Studio (the Subnetting Design Practice Lab).
 * It shares every immutable value and every piece of CIDR arithmetic with the guided lesson (subnettingDesign.ts:
 * the 10.44.0.0/24 parent, the LAN-A 100 / LAN-B 50 / LAN-C 25 / transit 2 requirements, blockSize, prefixFor,
 * isAligned, containingNetwork, rangeOf, overlaps, freeRanges, alignedBlocks …) and has its own mutable state. The
 * guided lesson never reads it.
 *
 * Requirement counts already include R1's interface on each LAN; the transit 2 is exactly R1 + R2.
 *
 * What it adds (composition only — no new subnet arithmetic):
 *  - an all-violations validator: MISALIGNED, OUTSIDE_PARENT, TOO_SMALL and OVERLAP are reported together, overlap is
 *    judged on the REAL (normalised) CIDR block, and OVERSIZED is an advisory that never makes a plan invalid;
 *  - an overlap matrix, an equal-size (FLSM) split, first fit in the free space, a whole-plan report;
 *  - a lab-only LAN-D (14 hosts) and a lab-only flawed plan whose LAN-B (10.44.0.160/26) is not on a /26 boundary;
 *  - the own-mask LOCAL/REMOTE decision from IPv4 Basics, as the incident's symptom.
 *
 * Scope: ordinary LAN subnets only. Every prefix the lab accepts is /23–/30 — never /31 or /32 — and every call to
 * describe()/usableHosts() goes through a guard that throws outside that range. Pass/fail is decided by the rules,
 * never by comparing with CORRECT_PLAN. Every action is instant (hops = 0): nothing moves, so there is no replay.
 */

export type SlSeg = SegId | "LAN-D";
export const SL_PREFIX_MIN = 23;
export const SL_PREFIX_MAX = 30;
export const SL_HOSTS_MAX = 500;
export const SL_LAN_D = { id: "LAN-D" as const, hosts: 14 };
export const SL_STAGES = ["Requirements", "Size a subnet", "Boundaries", "One subnet", "Equal split", "VLSM sizing", "Allocate", "Verify the plan", "Incident"];
export const SL_FLSM_PREFIXES = [25, 26, 27];
export const SL_BOUNDARY_PREFIX = 27;
export const SL_BOUNDARY_CANDIDATES = ["10.44.0.160", "10.44.0.192", "10.44.0.200", "10.44.0.224"];
export const SL_CALC = { address: "10.44.0.200", prefix: 27 } as const;
/** The colleague's spreadsheet: written ranges look contiguous; LAN-B's start is not a /26 boundary. */
export const SL_INCIDENT_PLAN: { id: SegId; network: string; prefix: number }[] = [
  { id: "LAN-A", network: "10.44.0.0", prefix: 25 },
  { id: "LAN-C", network: "10.44.0.128", prefix: 27 },
  { id: "LAN-B", network: "10.44.0.160", prefix: 26 },
  { id: "TRANSIT", network: "10.44.0.224", prefix: 30 },
];
/** Symptom endpoints, as offsets from each segment's written network (so they follow a redesign). */
export const SL_SYMPTOM = { hostOffset: 10, serverOffset: 2, gatewayOffset: 1 } as const;
export const SL_SEG_ORDER: SlSeg[] = ["LAN-A", "LAN-B", "LAN-C", "TRANSIT", "LAN-D"];

// ---------------------------------------------------------------------------------------------------------------
// Guards and small helpers (no new arithmetic)
// ---------------------------------------------------------------------------------------------------------------
export const slPrefixOk = (p: number) => Number.isInteger(p) && p >= SL_PREFIX_MIN && p <= SL_PREFIX_MAX;
function guard(p: number) {
  if (!slPrefixOk(p)) throw new RangeError(`Subnetting Lab: /${p} is outside the ordinary-LAN range /${SL_PREFIX_MIN}–/${SL_PREFIX_MAX}`);
  return p;
}
/** describe()/usableHosts() for the lab — only ever with /23–/30 (they are not meant for /31 or /32). */
export const slDescribe = (network: string, prefix: number) => describe(network, guard(prefix));
export const slUsable = (prefix: number) => usableHosts(guard(prefix));
export const slMinPrefix = (hosts: number) => prefixFor(hosts).prefix;
export const slHostsOk = (h: number) => Number.isInteger(h) && h >= 1 && h <= SL_HOSTS_MAX;
const PARENT_RANGE = rangeOf(PARENT.network, PARENT.prefix);
export const slParentRange = PARENT_RANGE;
export const lastOctet = (ip: string) => ipToNum(ip) % 256;
export const dotOct = (ip: string) => `.${lastOctet(ip)}`;
/** Range label: last octets when inside the parent /24, full addresses otherwise. */
export function rangeLabel(r: Range) {
  const inside = r.first >= PARENT_RANGE.first && r.last <= PARENT_RANGE.last;
  return inside ? `.${r.first % 256}–.${r.last % 256}` : `${numToIp(r.first)}–${numToIp(r.last)}`;
}

/** Strict dotted-quad parser for the learner's free-text network field. Never normalises to a boundary. */
export function parseIPv4(text: string): string | undefined {
  const t = text.trim();
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(t)) return undefined;
  const o = t.split(".").map(Number);
  if (o.some((x) => x > 255)) return undefined;
  return o.join(".");
}
/** Step a written network by whole blocks (the ± block buttons) — keeps the learner's misalignment, never fixes it. */
export function stepNetwork(network: string, prefix: number, dir: 1 | -1): string {
  const n = ipToNum(network) + dir * blockSize(guard(prefix));
  return numToIp(Math.min(Math.max(n, 0), 0xffffffff));
}

// ---------------------------------------------------------------------------------------------------------------
// Sizing
// ---------------------------------------------------------------------------------------------------------------
export type SlFit = "FITS" | "TOO_SMALL" | "OVERSIZED";
export function fitStatus(hosts: number, prefix: number): SlFit {
  if (slUsable(prefix) < hosts) return "TOO_SMALL";
  return prefix < slMinPrefix(hosts) ? "OVERSIZED" : "FITS";
}
/** The capacity ladder around a requirement: each prefix with its ordinary usable count. */
export function capacityLadder(hosts: number) {
  const min = slMinPrefix(hosts);
  return [min - 1, min, min + 1]
    .filter(slPrefixOk)
    .map((p) => ({ prefix: p, hostBits: 32 - p, total: blockSize(p), usable: slUsable(p), fits: slUsable(p) >= hosts, minimum: p === min }));
}

// ---------------------------------------------------------------------------------------------------------------
// Rows and the all-violations validator
// ---------------------------------------------------------------------------------------------------------------
export interface SlRow {
  id: SlSeg;
  hosts: number;
  prefix?: number;
  /** As written by the learner (or the spreadsheet) — never normalised. */
  network?: string;
}
export type SlViolationCode = "MISALIGNED" | "OUTSIDE_PARENT" | "TOO_SMALL" | "OVERLAP";
export interface SlViolation {
  code: SlViolationCode;
  text: string;
  with?: SlSeg;
}
export interface SlRowCheck {
  id: SlSeg;
  hosts: number;
  prefix: number;
  written: string;
  /** The real CIDR network the written address + prefix describes (address AND mask). */
  real: string;
  realRange: Range;
  writtenRange: Range;
  aligned: boolean;
  violations: SlViolation[];
  /** Advisory only: valid, but bigger than the smallest prefix that fits. */
  oversized?: string;
  valid: boolean;
}
const placed = (r: SlRow): r is SlRow & { prefix: number; network: string } => r.prefix !== undefined && r.network !== undefined;
export const realBlock = (network: string, prefix: number) => containingNetwork(network, guard(prefix));
const realRangeOf = (r: SlRow & { prefix: number; network: string }) => rangeOf(realBlock(r.network, r.prefix), r.prefix);

export function validateRow(rows: SlRow[], id: SlSeg): SlRowCheck | undefined {
  const row = rows.find((r) => r.id === id);
  if (!row || !placed(row)) return undefined;
  const { prefix, network, hosts } = row;
  const real = realBlock(network, prefix);
  const realRange = rangeOf(real, prefix);
  const writtenStart = ipToNum(network);
  const writtenRange = { first: writtenStart, last: writtenStart + blockSize(prefix) - 1 };
  const aligned = isAligned(network, prefix);
  const v: SlViolation[] = [];
  if (!aligned) v.push({ code: "MISALIGNED", text: `${network} is not a /${prefix} boundary (blocks of ${blockSize(prefix)}): ${lastOctet(network)} mod ${blockSize(prefix)} = ${lastOctet(network) % blockSize(prefix)}. The real block is ${real}/${prefix} (${rangeLabel(realRange)}).` });
  if (realRange.first < PARENT_RANGE.first || realRange.last > PARENT_RANGE.last) v.push({ code: "OUTSIDE_PARENT", text: `${real}/${prefix} (${rangeLabel(realRange)}) is not inside the parent ${PARENT.network}/${PARENT.prefix}.` });
  if (slUsable(prefix) < hosts) v.push({ code: "TOO_SMALL", text: `/${prefix} holds ${slUsable(prefix)} ordinary usable addresses; ${id} needs ${hosts}.` });
  for (const o of rows) {
    if (o.id === id || !placed(o)) continue;
    const or = realRangeOf(o);
    if (overlaps(realRange, or)) v.push({ code: "OVERLAP", with: o.id, text: `${id}'s real block ${real}/${prefix} (${rangeLabel(realRange)}) overlaps ${o.id} ${realBlock(o.network, o.prefix)}/${o.prefix} (${rangeLabel(or)}).` });
  }
  const min = slMinPrefix(hosts);
  const oversized = slUsable(prefix) >= hosts && prefix < min ? `/${min} (${slUsable(min)} usable) is the smallest that fits ${hosts}; /${prefix} takes ${blockSize(prefix) - blockSize(min)} more addresses than needed.` : undefined;
  return { id, hosts, prefix, written: network, real, realRange, writtenRange, aligned, violations: v, oversized, valid: v.length === 0 };
}

export interface SlOverlapCell {
  a: SlSeg;
  b: SlSeg;
  overlap: boolean;
  shared?: Range;
}
/** Pairwise overlap of every placed row's REAL block. */
export function overlapMatrix(rows: SlRow[]): { ids: SlSeg[]; cells: SlOverlapCell[] } {
  const ps = rows.filter(placed);
  const cells: SlOverlapCell[] = [];
  for (let i = 0; i < ps.length; i++)
    for (let j = i + 1; j < ps.length; j++) {
      const a = realRangeOf(ps[i]);
      const b = realRangeOf(ps[j]);
      const overlap = overlaps(a, b);
      cells.push({ a: ps[i].id, b: ps[j].id, overlap, shared: overlap ? { first: Math.max(a.first, b.first), last: Math.min(a.last, b.last) } : undefined });
    }
  return { ids: ps.map((p) => p.id), cells };
}

/** Free space inside the parent, from the real blocks (as ranges, then as the aligned blocks each range holds). */
export function freeSpace(rows: SlRow[]) {
  // freeRanges() only reads network/prefix; the id is not used.
  const used: Allocation[] = rows.filter(placed).map((r) => ({ id: "LAN-A", hosts: r.hosts, prefix: r.prefix, network: realBlock(r.network, r.prefix) }));
  const ranges = freeRanges(used);
  const free = ranges.reduce((n, f) => n + f.last - f.first + 1, 0);
  return { ranges: ranges.map((f) => ({ ...f, blocks: alignedBlocks(f) })), free, allocated: blockSize(PARENT.prefix) - free, total: blockSize(PARENT.prefix) };
}

/** The lowest aligned block of the right size that overlaps nothing — composed from the same primitives as planLargestFirst. */
export function firstFit(rows: SlRow[], seg: SlSeg, hosts: number): { network: string; prefix: number } | undefined {
  const prefix = slMinPrefix(hosts);
  const others = rows.filter((r) => r.id !== seg && placed(r)).map((r) => realRangeOf(r as SlRow & { prefix: number; network: string }));
  for (let n = PARENT_RANGE.first; n + blockSize(prefix) - 1 <= PARENT_RANGE.last; n += blockSize(prefix)) {
    const r = rangeOf(numToIp(n), prefix);
    if (!others.some((o) => overlaps(r, o))) return { network: numToIp(n), prefix };
  }
  return undefined;
}

export interface SlPlanReport {
  checks: SlRowCheck[];
  unplaced: SlSeg[];
  allPlaced: boolean;
  aligned: boolean;
  inside: boolean;
  capacity: boolean;
  noOverlap: boolean;
  allValid: boolean;
  oversized: SlSeg[];
  overlaps: SlOverlapCell[];
  space: ReturnType<typeof freeSpace>;
}
export function planReport(rows: SlRow[]): SlPlanReport {
  const checks = rows.map((r) => validateRow(rows, r.id)).filter((c): c is SlRowCheck => !!c);
  const has = (code: SlViolationCode) => checks.some((c) => c.violations.some((v) => v.code === code));
  const unplaced = rows.filter((r) => !placed(r)).map((r) => r.id);
  const m = overlapMatrix(rows);
  return {
    checks,
    unplaced,
    allPlaced: unplaced.length === 0,
    aligned: !has("MISALIGNED"),
    inside: !has("OUTSIDE_PARENT"),
    capacity: !has("TOO_SMALL"),
    noOverlap: !has("OVERLAP"),
    allValid: unplaced.length === 0 && checks.every((c) => c.valid),
    oversized: checks.filter((c) => c.oversized).map((c) => c.id),
    overlaps: m.cells.filter((c) => c.overlap),
    space: freeSpace(rows),
  };
}
/** True when some free space lies BELOW the highest allocation — a hole left by the placement order. */
export function holes(rows: SlRow[]): Range[] {
  const ps = rows.filter(placed).map((r) => realRangeOf(r));
  if (!ps.length) return [];
  const top = Math.max(...ps.map((r) => r.last));
  return freeSpace(rows).ranges.filter((f) => f.last < top).map(({ first, last }) => ({ first, last }));
}

// ---------------------------------------------------------------------------------------------------------------
// Calculations: one subnet, equal split, the own-mask decision
// ---------------------------------------------------------------------------------------------------------------
export interface SlCalc {
  address: string;
  prefix: number;
  mask: string;
  block: number;
  aligned: boolean;
  network: string;
  first: string;
  last: string;
  broadcast: string;
  next: string;
  usable: number;
}
export function subnetCalc(address: string, prefix: number): SlCalc {
  const network = realBlock(address, prefix);
  const d = slDescribe(network, prefix);
  return { address, prefix, mask: maskOf(prefix), block: blockSize(prefix), aligned: isAligned(address, prefix), network, first: d.firstHost, last: d.lastHost, broadcast: d.broadcast, next: numToIp(ipToNum(d.broadcast) + 1), usable: d.usable };
}
/** Bits of the last octet split at the prefix boundary (network | host). For prefixes ≥ /24 only — the lab's binary view. */
export function octetBits(ip: string, prefix: number) {
  const bits = lastOctet(ip).toString(2).padStart(8, "0");
  const netBits = Math.max(0, Math.min(8, prefix - 24));
  return { bits, net: bits.slice(0, netBits), host: bits.slice(netBits), maskOctet: Number(maskOf(prefix).split(".")[3]), anded: lastOctet(ip) & Number(maskOf(prefix).split(".")[3]) };
}

export interface SlFlsm {
  prefix: number;
  borrowed: number;
  count: number;
  block: number;
  usable: number;
  subnets: string[];
  fits: { id: SegId; hosts: number; fits: boolean }[];
  enoughSubnets: boolean;
  satisfiesAll: boolean;
}
export function equalSplit(prefix: number): SlFlsm {
  const count = blockSize(PARENT.prefix) / blockSize(prefix);
  const usable = slUsable(prefix);
  const fits = SEGMENTS.map((s) => ({ id: s.id, hosts: s.hosts, fits: usable >= s.hosts }));
  return {
    prefix,
    borrowed: prefix - PARENT.prefix,
    count,
    block: blockSize(prefix),
    usable,
    subnets: Array.from({ length: count }, (_, i) => numToIp(PARENT_RANGE.first + i * blockSize(prefix))),
    fits,
    enoughSubnets: count >= SEGMENTS.length,
    satisfiesAll: count >= SEGMENTS.length && fits.every((f) => f.fits),
  };
}

export interface SlDecision {
  src: string;
  dst: string;
  prefix: number;
  srcNet: string;
  dstNet: string;
  local: boolean;
}
/** IPv4 Basics' own-mask test: the SOURCE's mask decides whether a destination is on-link. */
export function hostDecision(src: string, prefix: number, dst: string): SlDecision {
  const srcNet = realBlock(src, prefix);
  const dstNet = realBlock(dst, prefix);
  return { src, dst, prefix, srcNet, dstNet, local: srcNet === dstNet };
}
export interface SlSymptom {
  host: string;
  gateway: string;
  server: string;
  decision: SlDecision;
}
/** A LAN-B host and a LAN-C host, numbered from each segment's WRITTEN network (what an admin would hand out). */
export function incidentSymptom(rows: SlRow[]): SlSymptom | undefined {
  const b = rows.find((r) => r.id === "LAN-B");
  const c = rows.find((r) => r.id === "LAN-C");
  if (!b || !c || !placed(b) || !placed(c)) return undefined;
  const host = numToIp(ipToNum(b.network) + SL_SYMPTOM.hostOffset);
  const server = numToIp(ipToNum(c.network) + SL_SYMPTOM.serverOffset);
  return { host, gateway: numToIp(ipToNum(b.network) + SL_SYMPTOM.gatewayOffset), server, decision: hostDecision(host, b.prefix, server) };
}

// ---------------------------------------------------------------------------------------------------------------
// State and actions
// ---------------------------------------------------------------------------------------------------------------
export type SlRule = "alignment" | "capacity" | "containment" | "overlap";
export const SL_RULES: SlRule[] = ["alignment", "capacity", "containment", "overlap"];
export interface SlBoundaryTest {
  address: string;
  prefix: number;
  aligned: boolean;
  real: string;
}
export interface SlRecord {
  seq: number;
  stage: number;
  kind: SlAction["type"] | "noop";
  text: string;
  tone: "learn" | "info" | "warning";
  seg?: SlSeg;
}
export interface SlIncident {
  active: boolean;
  rulesRun: SlRule[];
  maskApplied: boolean;
  resolved: boolean;
}
export interface SlState {
  /** Increments on every action — the event boundary that inspections are compared against. */
  seq: number;
  stage: number;
  freePlay: boolean;
  requirementsRead: boolean;
  rows: SlRow[];
  boundaryTests: SlBoundaryTest[];
  calc?: SlCalc;
  flsmTried: number[];
  flsm?: number;
  /** Snapshot of the last "Run plan checks". */
  report?: SlPlanReport;
  reportSeq?: number;
  incident: SlIncident;
  records: readonly SlRecord[];
  last?: SlRecord;
}
export type SlAction =
  | { type: "read" }
  | { type: "size"; seg: SlSeg; prefix: number }
  | { type: "boundary"; address: string; prefix: number }
  | { type: "calc"; address: string; prefix: number }
  | { type: "flsm"; prefix: number }
  | { type: "place"; seg: SlSeg; network: string }
  | { type: "clear"; seg: SlSeg }
  | { type: "verify" }
  | { type: "add-lan-d" }
  | { type: "remove-lan-d" }
  | { type: "stage"; stage: number }
  | { type: "check"; rule: SlRule }
  | { type: "apply-mask" }
  | { type: "free-play" }
  | { type: "set-hosts"; seg: SlSeg; hosts: number };

export const createSlState = (): SlState => ({
  seq: 0,
  stage: 0,
  freePlay: false,
  requirementsRead: false,
  rows: SEGMENTS.map((s) => ({ id: s.id, hosts: s.hosts })),
  boundaryTests: [],
  flsmTried: [],
  incident: { active: false, rulesRun: [], maskApplied: false, resolved: false },
  records: Object.freeze([]),
});

const tag = (s: SlState) => (s.freePlay ? "Free" : `T${s.stage}`);
export const slTag = tag;
function commit(s: SlState, patch: Partial<SlState>, rec: Omit<SlRecord, "seq" | "stage">): SlState {
  const seq = s.seq + 1;
  const stage = patch.stage ?? s.stage;
  const record: SlRecord = Object.freeze({ ...rec, seq, stage });
  return { ...s, ...patch, seq, records: Object.freeze([...s.records, record]), last: record };
}
const noop = (s: SlState, text: string) => commit(s, {}, { kind: "noop", text, tone: "warning" });
const rowsWith = (s: SlState, seg: SlSeg, patch: Partial<SlRow>) => s.rows.map((r) => (r.id === seg ? { ...r, ...patch } : r));
const STATUS_TEXT = (c: SlRowCheck) => (c.valid ? "VALID" : c.violations.map((v) => (v.code === "OVERLAP" ? `OVERLAP (${v.with})` : v.code === "MISALIGNED" ? `MISALIGNED (real ${dotOct(c.real)}/${c.prefix})` : v.code)).join(" + ")) + (c.oversized ? " · OVERSIZED (advisory)" : "");
export const slStatusText = STATUS_TEXT;

function apply(s: SlState, a: SlAction): SlState {
  switch (a.type) {
    case "read":
      return commit(s, { requirementsRead: true }, { kind: a.type, tone: "learn", text: `Requirements read: parent ${PARENT.network}/${PARENT.prefix} (${blockSize(PARENT.prefix)} addresses); ${SEGMENTS.map((x) => `${x.id} ${x.hosts}`).join(", ")} (counts include R1).` });
    case "size": {
      const row = s.rows.find((r) => r.id === a.seg);
      if (!row) return noop(s, `${a.seg} is not in this plan.`);
      if (!slPrefixOk(a.prefix)) return noop(s, `/${a.prefix} is outside this lab's ordinary-LAN range (/${SL_PREFIX_MIN}–/${SL_PREFIX_MAX}).`);
      const fit = fitStatus(row.hosts, a.prefix);
      return commit(s, { rows: rowsWith(s, a.seg, { prefix: a.prefix }) }, { kind: a.type, seg: a.seg, tone: fit === "TOO_SMALL" ? "warning" : "learn", text: `${a.seg} sized /${a.prefix}: ${blockSize(a.prefix)} addresses, ${slUsable(a.prefix)} usable for ${row.hosts} → ${fit === "TOO_SMALL" ? "TOO SMALL" : fit === "OVERSIZED" ? "fits, OVERSIZED (advisory)" : "FITS"}.` });
    }
    case "boundary": {
      const ip = parseIPv4(a.address);
      if (!ip || !slPrefixOk(a.prefix)) return noop(s, "Not a valid IPv4 address.");
      const t: SlBoundaryTest = { address: ip, prefix: a.prefix, aligned: isAligned(ip, a.prefix), real: realBlock(ip, a.prefix) };
      return commit(s, { boundaryTests: [...s.boundaryTests, t] }, { kind: a.type, tone: t.aligned ? "learn" : "warning", text: t.aligned ? `${ip}/${a.prefix}: a valid /${a.prefix} network address (${lastOctet(ip)} = ${lastOctet(ip) / blockSize(a.prefix)} × ${blockSize(a.prefix)}).` : `${ip}/${a.prefix}: MISALIGNED — a host inside ${t.real}/${a.prefix}.` });
    }
    case "calc": {
      const ip = parseIPv4(a.address);
      if (!ip || !slPrefixOk(a.prefix)) return noop(s, "Not a valid IPv4 address.");
      const c = subnetCalc(ip, a.prefix);
      return commit(s, { calc: c }, { kind: a.type, tone: "learn", text: `${ip}/${a.prefix} → network ${c.network}, usable ${c.first}–${c.last}, broadcast ${c.broadcast}, next subnet ${c.next}.` });
    }
    case "flsm": {
      if (!SL_FLSM_PREFIXES.includes(a.prefix)) return noop(s, "Pick /25, /26 or /27.");
      const f = equalSplit(a.prefix);
      const tried = s.flsmTried.includes(a.prefix) ? s.flsmTried : [...s.flsmTried, a.prefix];
      const tooSmall = f.fits.filter((x) => !x.fits).map((x) => x.id);
      return commit(s, { flsm: a.prefix, flsmTried: tried }, { kind: a.type, tone: f.satisfiesAll ? "learn" : "warning", text: `Equal split /${a.prefix}: ${f.count} subnets × ${f.block} (${f.usable} usable) — ${!f.enoughSubnets ? `only ${f.count} subnets for ${SEGMENTS.length} networks` : tooSmall.length ? `${tooSmall.join(", ")} too small` : "everything fits"}.` });
    }
    case "place": {
      const row = s.rows.find((r) => r.id === a.seg);
      const ip = parseIPv4(a.network);
      if (!row) return noop(s, `${a.seg} is not in this plan.`);
      if (row.prefix === undefined) return noop(s, `Size ${a.seg} before placing it.`);
      if (!ip) return noop(s, `"${a.network}" is not an IPv4 address.`);
      const rows = rowsWith(s, a.seg, { network: ip });
      const c = validateRow(rows, a.seg)!;
      return commit(s, { rows }, { kind: a.type, seg: a.seg, tone: c.valid ? "learn" : "warning", text: `${a.seg} written as ${ip}/${row.prefix}: ${STATUS_TEXT(c)}.` });
    }
    case "clear":
      if (!s.rows.some((r) => r.id === a.seg && r.network)) return noop(s, `${a.seg} is not placed.`);
      return commit(s, { rows: rowsWith(s, a.seg, { network: undefined }) }, { kind: a.type, seg: a.seg, tone: "info", text: `${a.seg} placement cleared.` });
    case "verify": {
      const report = planReport(s.rows);
      let incident = s.incident;
      if (incident.active && incident.maskApplied && !incident.resolved) {
        const sym = incidentSymptom(s.rows);
        if (report.allValid && sym && !sym.decision.local) incident = { ...incident, resolved: true };
      }
      const fails = [!report.allPlaced && `${report.unplaced.join(", ")} not placed`, !report.aligned && "misaligned", !report.inside && "outside the parent", !report.capacity && "too small", !report.noOverlap && "overlap"].filter(Boolean);
      return commit(s, { report, reportSeq: s.seq + 1, incident }, { kind: a.type, tone: report.allValid ? "learn" : "warning", text: report.allValid ? `Plan checks: all rules pass · ${report.space.allocated}/${report.space.total} allocated · free ${report.space.ranges.map((f) => rangeLabel(f)).join(", ") || "none"}.` : `Plan checks: FAIL — ${fails.join(", ")}.` });
    }
    case "add-lan-d":
      if (s.rows.some((r) => r.id === "LAN-D")) return noop(s, "LAN-D is already in the plan.");
      return commit(s, { rows: [...s.rows, { id: "LAN-D", hosts: SL_LAN_D.hosts }] }, { kind: a.type, seg: "LAN-D", tone: "info", text: `New requirement: LAN-D, ${SL_LAN_D.hosts} addresses (including R1).` });
    case "remove-lan-d":
      if (!s.rows.some((r) => r.id === "LAN-D")) return noop(s, "LAN-D is not in the plan.");
      return commit(s, { rows: s.rows.filter((r) => r.id !== "LAN-D") }, { kind: a.type, seg: "LAN-D", tone: "info", text: "LAN-D removed." });
    case "stage": {
      if (!Number.isInteger(a.stage) || a.stage < 0 || a.stage >= SL_STAGES.length) return noop(s, "No such stage.");
      if (a.stage === 8) {
        const rows: SlRow[] = SL_INCIDENT_PLAN.map((p) => ({ id: p.id, hosts: SEGMENTS.find((x) => x.id === p.id)!.hosts, prefix: p.prefix, network: p.network }));
        return commit(s, { stage: 8, rows, report: undefined, reportSeq: undefined, incident: { active: true, rulesRun: [], maskApplied: false, resolved: false } }, { kind: a.type, tone: "warning", text: `Incident: a colleague's spreadsheet plan arrives — ${SL_INCIDENT_PLAN.map((p) => `${p.id} ${p.network}/${p.prefix}`).join(", ")}. LAN-D removed.` });
      }
      return commit(s, { stage: a.stage, report: undefined, reportSeq: undefined }, { kind: a.type, tone: "info", text: `Stage T${a.stage} · ${SL_STAGES[a.stage]}.` });
    }
    case "check": {
      if (!s.incident.active) return noop(s, "Rule checks belong to the incident.");
      const r = planReport(s.rows);
      const rulesRun = s.incident.rulesRun.includes(a.rule) ? s.incident.rulesRun : [...s.incident.rulesRun, a.rule];
      const text =
        a.rule === "alignment"
          ? r.aligned
            ? "Alignment check: every written network is on its own block boundary."
            : `Alignment check: ${r.checks.filter((c) => !c.aligned).map((c) => `${c.id} ${c.written} is not a multiple of ${blockSize(c.prefix)} (${lastOctet(c.written)} mod ${blockSize(c.prefix)} = ${lastOctet(c.written) % blockSize(c.prefix)})`).join("; ")}.`
          : a.rule === "capacity"
            ? r.capacity
              ? "Capacity check: every prefix holds its requirement."
              : `Capacity check: ${r.checks.filter((c) => c.violations.some((v) => v.code === "TOO_SMALL")).map((c) => c.id).join(", ")} too small.`
            : a.rule === "containment"
              ? r.inside
                ? `Containment check: every block is inside ${PARENT.network}/${PARENT.prefix}.`
                : `Containment check: ${r.checks.filter((c) => c.violations.some((v) => v.code === "OUTSIDE_PARENT")).map((c) => c.id).join(", ")} outside the parent.`
              : r.noOverlap
                ? "Overlap check (real CIDR blocks): no two blocks share an address."
                : `Overlap check (real CIDR blocks): ${r.overlaps.map((o) => `${o.a} and ${o.b}`).join("; ")} share addresses.`;
      const ok = a.rule === "alignment" ? r.aligned : a.rule === "capacity" ? r.capacity : a.rule === "containment" ? r.inside : r.noOverlap;
      return commit(s, { incident: { ...s.incident, rulesRun } }, { kind: a.type, tone: ok ? "learn" : "warning", text });
    }
    case "apply-mask": {
      if (!s.incident.active) return noop(s, "Nothing to test.");
      const b = validateRow(s.rows, "LAN-B");
      return commit(s, { incident: { ...s.incident, maskApplied: true } }, { kind: a.type, tone: "learn", text: b ? `Mask applied: ${b.written} AND ${maskOf(b.prefix)} = ${b.real} → LAN-B's real block is ${b.real}/${b.prefix} (${rangeLabel(b.realRange)}), not ${rangeLabel(b.writtenRange)}.` : "Mask applied." });
    }
    case "free-play":
      return commit(s, { freePlay: true, incident: { ...s.incident, active: false } }, { kind: a.type, tone: "info", text: "Free play: edit requirements, prefixes and placements; run the checks any time." });
    case "set-hosts": {
      if (!slHostsOk(a.hosts)) return noop(s, `Hosts must be 1–${SL_HOSTS_MAX}.`);
      if (!s.rows.some((r) => r.id === a.seg)) return noop(s, `${a.seg} is not in this plan.`);
      return commit(s, { rows: rowsWith(s, a.seg, { hosts: a.hosts }) }, { kind: a.type, seg: a.seg, tone: "info", text: `${a.seg} now needs ${a.hosts} addresses (smallest fit /${slMinPrefix(a.hosts)}).` });
    }
  }
}

export const SL_LAB_MODEL: LabModel<SlState, SlAction> = {
  initial: createSlState,
  hops: () => 0,
  start: apply,
  arrive: (s) => s,
  revision: (s) => s.seq,
};

/** The pure result of an action — used to freeze prediction answers at the moment the learner acts. */
export const slDryRun = (s: SlState, a: SlAction) => apply(s, a);
export const slRow = (s: SlState, id: SlSeg) => s.rows.find((r) => r.id === id);
export const slRowRange = (r: SlRow) => (placed(r) ? realRangeOf(r) : undefined);
export { placed as slPlaced };
