"use client";

import { clsx } from "clsx";
import { PARENT, blockSize, freeRanges, overlaps, rangeOf, type Range } from "@/lib/sim-engine/scenarios/subnettingDesign";
import { ipToNum } from "@/lib/sim-engine/scenarios/fundamentalsPackets";
import { freeSpace, overlapMatrix, parseIPv4, rangeLabel, realBlock, slParentRange, slPlaced, slPrefixOk, validateRow, type SlRow, type SlSeg } from "@/lib/sim-engine/scenarios/subnettingLab";

/**
 * Live address ruler for the Subnet Explorer. Every position is an address offset inside the parent /24 turned
 * into a percentage — nothing is hand-placed. Layers: boundary grid · allocated real blocks (overlaps in extra lanes,
 * shared range hatched red) · "as written" dashed ranges for misaligned rows · free space hatched · ghost preview.
 * While `conceal` is set (incident before the mask is applied) it draws the WRITTEN ranges only, with no verdicts.
 */

export const SEG_COLOR: Record<SlSeg, string> = { "LAN-A": "#22d3ee", "LAN-B": "#a78bfa", "LAN-C": "#34d399", TRANSIT: "#fbbf24", "LAN-D": "#f472b6" };
export const SEG_SHORT: Record<SlSeg, string> = { "LAN-A": "A", "LAN-B": "B", "LAN-C": "C", TRANSIT: "T", "LAN-D": "D" };
const SIZE = blockSize(PARENT.prefix);
const P0 = slParentRange.first;
const HATCH_FREE = "repeating-linear-gradient(45deg, rgba(148,163,184,0.22) 0 2px, transparent 2px 6px)";
const HATCH_OVERLAP = "repeating-linear-gradient(135deg, rgba(248,113,113,0.85) 0 2px, rgba(248,113,113,0.15) 2px 5px)";

export interface RulerGhost {
  seg: SlSeg;
  network: string;
  prefix: number;
}
interface Shown {
  id: SlSeg;
  range: Range;
  written?: Range;
  misaligned: boolean;
  outside: boolean;
  lane: number;
}

function shownBlocks(rows: SlRow[], conceal: boolean): Shown[] {
  const out: Shown[] = [];
  for (const r of rows) {
    const c = validateRow(rows, r.id);
    if (!c) continue;
    const range = conceal ? c.writtenRange : c.realRange;
    out.push({ id: r.id, range, written: !conceal && !c.aligned ? c.writtenRange : undefined, misaligned: !conceal && !c.aligned, outside: range.first < slParentRange.first || range.last > slParentRange.last, lane: 0 });
  }
  // Greedy lanes: a block that overlaps one already drawn in a lane moves down a lane.
  const lanes: Range[][] = [];
  for (const b of [...out].sort((x, y) => x.range.first - y.range.first || y.range.last - x.range.last)) {
    let i = 0;
    while (lanes[i]?.some((o) => overlaps(b.range, o))) i++;
    (lanes[i] ??= []).push(b.range);
    b.lane = i;
  }
  return out;
}

/** Shared address ranges, straight from the model's overlap matrix (real CIDR blocks). */
const sharedRanges = (rows: SlRow[]): Range[] => overlapMatrix(rows).cells.flatMap((c) => (c.shared ? [c.shared] : []));

const clip = (r: Range, w0: number, w1: number) => ({ first: Math.max(r.first, w0), last: Math.min(r.last, w1) });
const pos = (r: Range, w0: number, span: number) => ({ left: `${((r.first - w0) / span) * 100}%`, width: `${((r.last - r.first + 1) / span) * 100}%` });

function Track({ blocks, rows, conceal, w0, span, gridPrefix, ghost, selected, onSelect, laneH, labels }: { blocks: Shown[]; rows: SlRow[]; conceal: boolean; w0: number; span: number; gridPrefix?: number; ghost?: Range & { misaligned?: Range }; selected?: SlSeg; onSelect?: (s: SlSeg) => void; laneH: number; labels: "short" | "range" }) {
  const w1 = w0 + span - 1;
  const lanes = Math.max(1, ...blocks.map((b) => b.lane + 1));
  const free = conceal ? writtenFree(rows) : freeSpace(rows).ranges;
  const shared = conceal ? [] : sharedRanges(rows);
  const anyWritten = blocks.some((b) => b.written);
  const writtenH = anyWritten ? 14 : 0;
  const height = writtenH + lanes * laneH;
  const grid = gridPrefix && slPrefixOk(gridPrefix) ? blockSize(gridPrefix) : undefined;
  return (
    <div className="relative w-full overflow-hidden rounded-md border border-pv-border bg-pv-bg-elevated/40" style={{ height }}>
      {free.map((f) => {
        const c = clip(f, w0, w1);
        return c.first <= c.last ? <div key={`f${f.first}`} aria-hidden className="absolute bottom-0" style={{ ...pos(c, w0, span), top: writtenH, backgroundImage: HATCH_FREE }} /> : null;
      })}
      {grid &&
        Array.from({ length: Math.floor(span / grid) + 1 }, (_, i) => w0 - (w0 % grid) + i * grid)
          .filter((a) => a > w0 && a <= w1)
          .map((a) => <div key={`g${a}`} aria-hidden className="absolute inset-y-0 w-px bg-pv-cyan/50" style={{ left: `${((a - w0) / span) * 100}%` }} />)}
      {blocks.map((b) => {
        if (!b.written) return null;
        const c = clip(b.written, w0, w1);
        return c.first <= c.last ? <div key={`w${b.id}`} aria-hidden className="absolute top-0.5 h-[11px] rounded-sm border border-dashed" style={{ ...pos(c, w0, span), borderColor: SEG_COLOR[b.id] }} /> : null;
      })}
      {blocks.map((b) => {
        const c = clip(b.range, w0, w1);
        if (c.first > c.last) return null;
        const p = pos(c, w0, span);
        const frac = (c.last - c.first + 1) / span;
        const wide = labels === "range" && frac >= 0.2;
        const letter = !wide && frac >= (labels === "range" ? 0.04 : 0.07);
        return (
          <button
            key={b.id}
            type="button"
            onClick={() => onSelect?.(b.id)}
            aria-label={`${b.id} ${rangeLabel(b.range)}`}
            className={clsx("absolute flex items-center justify-center overflow-hidden rounded-sm border text-[10px] font-bold leading-none text-pv-text", selected === b.id && "ring-2 ring-pv-text/70", b.misaligned && "border-dashed")}
            style={{ ...p, top: writtenH + b.lane * laneH + 2, height: laneH - 4, background: `${SEG_COLOR[b.id]}${conceal ? "33" : "40"}`, borderColor: SEG_COLOR[b.id] }}
          >
            {(wide || letter) && <span className="truncate px-0.5">{wide ? `${SEG_SHORT[b.id]} ${rangeLabel(b.range)}` : SEG_SHORT[b.id]}</span>}
          </button>
        );
      })}
      {shared.map((s) => {
        const c = clip(s, w0, w1);
        return c.first <= c.last ? <div key={`o${s.first}-${s.last}`} aria-hidden className="pointer-events-none absolute bottom-0" style={{ ...pos(c, w0, span), top: writtenH, backgroundImage: HATCH_OVERLAP, opacity: 0.55 }} /> : null;
      })}
      {ghost &&
        [ghost, ghost.misaligned].map((g, i) => {
          if (!g) return null;
          const c = clip(g, w0, w1);
          return c.first <= c.last ? <div key={`gh${i}`} aria-hidden className={clsx("pointer-events-none absolute rounded-sm border-2 border-dashed border-pv-text/80", i === 1 && "opacity-50")} style={{ ...pos(c, w0, span), top: i === 1 ? 1 : writtenH + 1, bottom: i === 1 ? undefined : 1, height: i === 1 ? 12 : undefined }} /> : null;
        })}
    </div>
  );
}

/** Free space between the WRITTEN ranges (concealed incident view). freeRanges() reads a network as written. */
const writtenFree = (rows: SlRow[]): Range[] => freeRanges(rows.filter(slPlaced).map((r) => ({ id: "LAN-A", hosts: r.hosts, prefix: r.prefix, network: r.network })));

function ghostRange(g?: RulerGhost): (Range & { misaligned?: Range }) | undefined {
  const ip = g && parseIPv4(g.network);
  if (!g || !ip || !slPrefixOk(g.prefix)) return undefined;
  const n = ipToNum(ip);
  const real = rangeOf(realBlock(ip, g.prefix), g.prefix);
  return real.first === n ? real : { ...real, misaligned: { first: n, last: n + blockSize(g.prefix) - 1 } };
}

const Ticks = ({ w0, span, every }: { w0: number; span: number; every: number }) => (
  <div aria-hidden className="relative h-3.5 text-[9px] text-pv-text-faint pv-mono">
    {Array.from({ length: span / every + 1 }, (_, i) => w0 + i * every).map((a, i, arr) => (
      <span key={a} className="absolute -translate-x-1/2" style={{ left: `${((a - w0) / span) * 100}%`, transform: i === 0 ? "none" : i === arr.length - 1 ? "translateX(-100%)" : undefined }}>
        {a - P0 === SIZE ? ".255" : `.${(a - P0) % 256}`}
      </span>
    ))}
  </div>
);

export function SubnetRuler({ rows, conceal = false, gridPrefix, ghost, selected, onSelect, windowStart, onWindow }: { rows: SlRow[]; conceal?: boolean; gridPrefix?: number; ghost?: RulerGhost; selected?: SlSeg; onSelect?: (s: SlSeg) => void; windowStart: number; onWindow: (start: number) => void }) {
  const blocks = shownBlocks(rows, conceal);
  const g = ghostRange(ghost);
  const outside = blocks.filter((b) => b.outside);
  const w0 = P0 + windowStart;
  const summary = blocks.length ? blocks.map((b) => `${b.id} ${rangeLabel(b.range)}`).join(", ") : "nothing allocated";
  return (
    <figure className="space-y-1.5" aria-label={`Address space ${PARENT.network}/${PARENT.prefix}: ${summary}`}>
      <div className="flex items-baseline justify-between gap-2 text-[10.5px]">
        <span className="font-semibold uppercase tracking-wide text-pv-text-faint">
          {PARENT.network}/{PARENT.prefix} · {SIZE} addresses{conceal ? " · as written" : ""}
        </span>
        {gridPrefix && <span className="pv-mono text-pv-cyan-soft">grid /{gridPrefix} = {blockSize(gridPrefix)}</span>}
      </div>
      <Track blocks={blocks} rows={rows} conceal={conceal} w0={P0} span={SIZE} gridPrefix={gridPrefix} ghost={g} selected={selected} onSelect={onSelect} laneH={22} labels="short" />
      <Ticks w0={P0} span={SIZE} every={64} />
      <div className="flex flex-wrap gap-x-2.5 gap-y-0.5 text-[10px] text-pv-text-faint" aria-hidden>
        {blocks.map((b) => (
          <span key={b.id} className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-sm" style={{ background: SEG_COLOR[b.id] }} />
            {SEG_SHORT[b.id]} = {b.id} <span className="pv-mono">{rangeLabel(b.range)}</span>
          </span>
        ))}
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-3 rounded-sm" style={{ backgroundImage: HATCH_FREE }} /> free
        </span>
        {!conceal && sharedRanges(rows).length > 0 && (
          <span className="flex items-center gap-1 text-pv-danger">
            <span className="inline-block h-2 w-3 rounded-sm" style={{ backgroundImage: HATCH_OVERLAP }} /> overlap
          </span>
        )}
        {blocks.some((b) => b.written) && <span>dashed = as written · solid = real CIDR block</span>}
      </div>
      {outside.length > 0 && <p className="text-[10.5px] text-pv-danger">Outside the parent: {outside.map((b) => `${b.id} ${rangeLabel(b.range)}`).join(", ")}</p>}
      <div className="rounded-md border border-pv-border/70 p-1.5">
        <div className="mb-1 flex items-center justify-between gap-2 text-[10px] text-pv-text-faint">
          <button type="button" aria-label="Previous 64 addresses" disabled={windowStart <= 0} onClick={() => onWindow(Math.max(0, windowStart - 64))} className="rounded border border-pv-border px-1.5 py-0.5 font-bold disabled:opacity-30">
            ‹
          </button>
          <span className="pv-mono">
            detail .{windowStart}–.{windowStart + 63} (64 addresses)
          </span>
          <button type="button" aria-label="Next 64 addresses" disabled={windowStart >= SIZE - 64} onClick={() => onWindow(Math.min(SIZE - 64, windowStart + 64))} className="rounded border border-pv-border px-1.5 py-0.5 font-bold disabled:opacity-30">
            ›
          </button>
        </div>
        <Track blocks={blocks} rows={rows} conceal={conceal} w0={w0} span={64} gridPrefix={gridPrefix} ghost={g} selected={selected} onSelect={onSelect} laneH={24} labels="range" />
        <Ticks w0={w0} span={64} every={16} />
      </div>
    </figure>
  );
}

/** A 64-address window only — repeated inline on the board next to placement controls (the phone ruler scrolls away). */
export function MiniRuler({ rows, conceal = false, ghost, windowStart, gridPrefix }: { rows: SlRow[]; conceal?: boolean; ghost?: RulerGhost; windowStart: number; gridPrefix?: number }) {
  const blocks = shownBlocks(rows, conceal);
  return (
    <div aria-hidden className="sm:hidden">
      <Track blocks={blocks} rows={rows} conceal={conceal} w0={P0 + windowStart} span={64} gridPrefix={gridPrefix} ghost={ghostRange(ghost)} laneH={18} labels="range" />
      <Ticks w0={P0 + windowStart} span={64} every={16} />
    </div>
  );
}

/** The 64-address window that holds a row's block (or a candidate placement). */
export function windowFor(rows: SlRow[], seg?: SlSeg, ghost?: RulerGhost): number {
  const g = ghostRange(ghost);
  const r = g ?? (seg ? rows.filter(slPlaced).map((x) => validateRow(rows, x.id)!).find((c) => c.id === seg)?.realRange : undefined);
  if (!r) return 0;
  const off = Math.min(Math.max(r.first - P0, 0), SIZE - 1);
  return Math.min(SIZE - 64, Math.floor(off / 64) * 64);
}
