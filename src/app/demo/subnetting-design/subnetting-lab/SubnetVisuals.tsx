"use client";

import { useState, type ReactNode } from "react";
import { clsx } from "clsx";
import { PARENT, SEGMENTS, blockSize, overlaps, rangeOf, type Range } from "@/lib/sim-engine/scenarios/subnettingDesign";
import { ipToNum, numToIp } from "@/lib/sim-engine/scenarios/fundamentalsPackets";
import {
  SL_STAGES,
  dotOct,
  equalSplit,
  freeSpace,
  lastOctet,
  octetBits,
  overlapMatrix,
  parseIPv4,
  rangeLabel,
  realBlock,
  slDescribe,
  slMinPrefix,
  slParentRange,
  slPrefixOk,
  slUsable,
  validateRow,
  type SlBoundaryTest,
  type SlCalc,
  type SlRow,
  type SlRowCheck,
  type SlSeg,
} from "@/lib/sim-engine/scenarios/subnettingLab";
import { SEG_COLOR, SEG_SHORT } from "./SubnetRuler";

/**
 * Subnet Design Studio — Learning View visuals. Every picture is drawn from the lab model (validateRow, freeSpace,
 * overlapMatrix, equalSplit, subnetCalc, octetBits …): positions are address offsets turned into percentages, colours
 * are semantic (green valid · amber advisory · red invalid/overlap · grey free · one colour per segment). Nothing here
 * computes subnet arithmetic of its own.
 */

const P0 = slParentRange.first;
const SIZE = blockSize(PARENT.prefix);
const HATCH_FREE = "repeating-linear-gradient(45deg, rgba(148,163,184,0.18) 0 3px, transparent 3px 8px)";
const HATCH_OVERLAP = "repeating-linear-gradient(135deg, rgba(248,113,113,0.9) 0 3px, rgba(248,113,113,0.2) 3px 7px)";
export const segName = (id: SlSeg) => (id === "TRANSIT" ? "Transit" : id);

// ---------------------------------------------------------------------------------------------------------------
// Stage header, human progress, coach, cards
// ---------------------------------------------------------------------------------------------------------------
const HUMAN = ["Requirements", "Size", "Boundaries", "Calculate", "FLSM", "VLSM", "Allocate", "Verify", "Troubleshoot"];

export function StageHeader({ stage, freePlay, title, concept, action }: { stage: number; freePlay: boolean; title: string; concept: ReactNode; action?: ReactNode }) {
  return (
    <header>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-pv-cyan-soft">{freePlay ? "Free play" : `T${stage} · ${SL_STAGES[stage]}`}</p>
          <h2 className="mt-0.5 text-xl font-semibold leading-tight text-pv-text sm:text-2xl">{title}</h2>
        </div>
        {action && <div className="hidden shrink-0 pt-1 lg:block">{action}</div>}
      </div>
      <p className="mt-1 max-w-3xl text-[14px] leading-snug text-pv-text-muted sm:text-[15px]">{concept}</p>
      <ol className="mt-2 flex flex-wrap items-center gap-x-1 gap-y-0.5 text-[11px]" aria-label="Lesson progress">
        {HUMAN.map((h, i) => (
          <li key={h} className="flex items-center gap-1" aria-current={!freePlay && i === stage ? "step" : undefined}>
            {i > 0 && <span aria-hidden className="text-pv-text-faint">→</span>}
            <span className={clsx("rounded-full px-1.5 py-0.5", !freePlay && i === stage ? "bg-pv-cyan/20 font-semibold text-pv-cyan-soft" : freePlay || i < stage ? "text-pv-success" : "text-pv-text-faint")}>
              {!freePlay && i === stage ? "● " : ""}
              {h}
            </span>
          </li>
        ))}
      </ol>
    </header>
  );
}

/** A learner-facing card. `tone` gives the semantic accent. */
export function Card({ title, tone = "neutral", children, id }: { title?: ReactNode; tone?: "neutral" | "concept" | "task" | "ok" | "warn" | "bad"; children: ReactNode; id?: string }) {
  const t = {
    neutral: "border-pv-border bg-pv-bg-elevated/40",
    concept: "border-pv-cyan/35 bg-pv-cyan/[0.05]",
    task: "border-pv-violet/40 bg-pv-violet/[0.06]",
    ok: "border-pv-success/45 bg-pv-success/[0.07]",
    warn: "border-pv-warning/45 bg-pv-warning/[0.07]",
    bad: "border-pv-danger/45 bg-pv-danger/[0.07]",
  }[tone];
  const head = { neutral: "text-pv-text-faint", concept: "text-pv-cyan-soft", task: "text-pv-violet", ok: "text-pv-success", warn: "text-pv-warning", bad: "text-pv-danger" }[tone];
  return (
    <section id={id} className={clsx("rounded-2xl border p-3.5 sm:p-4", t)}>
      {title && <p className={clsx("mb-2 text-[11px] font-bold uppercase tracking-[0.14em]", head)}>{title}</p>}
      {children}
    </section>
  );
}

export function Coach({ title, lines, remember }: { title: string; lines: ReactNode[]; remember?: ReactNode }) {
  return (
    <aside className="rounded-2xl border border-pv-cyan/30 bg-pv-cyan/[0.04] p-3.5" aria-label="Current idea">
      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-pv-cyan-soft">Current idea</p>
      <p className="mt-1 text-[17px] font-semibold text-pv-text">{title}</p>
      <ul className="mt-1.5 space-y-0.5 text-[13px] text-pv-text-muted">
        {lines.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>
      {remember && (
        <p className="mt-2 rounded-lg bg-pv-bg/60 px-2.5 py-1.5 text-[12.5px] text-pv-text">
          <span className="font-semibold text-pv-cyan-soft">Remember · </span>
          {remember}
        </p>
      )}
    </aside>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Plain-language validation
// ---------------------------------------------------------------------------------------------------------------
export function startsText(prefix: number) {
  const b = blockSize(prefix);
  const n = SIZE / b;
  const list = Array.from({ length: Math.min(n, 8) }, (_, i) => `.${i * b}`);
  return n <= 8 ? list.join(" · ") : `${list.slice(0, 4).join(" · ")} … (every ${b})`;
}
export interface Plain {
  tone: "bad" | "warn";
  title: string;
  body: string;
}
/** The validator's verdicts, said in plain words (the technical code stays in Engineer Details). */
export function plainViolations(c: SlRowCheck, rows: SlRow[]): Plain[] {
  const out: Plain[] = [];
  for (const v of c.violations) {
    if (v.code === "MISALIGNED") out.push({ tone: "bad", title: `Not a valid /${c.prefix} starting address`, body: `A /${c.prefix} begins every ${blockSize(c.prefix)} addresses: ${startsText(c.prefix)}. ${dotOct(c.written)} sits inside the ${rangeLabel(c.realRange)} block — that is the block hosts will actually use.` });
    if (v.code === "OVERLAP" && v.with) {
      const cell = overlapMatrix(rows).cells.find((x) => (x.a === c.id && x.b === v.with) || (x.b === c.id && x.a === v.with));
      out.push({ tone: "bad", title: `${segName(c.id)} and ${segName(v.with)} claim some of the same addresses`, body: `Both use ${cell?.shared ? rangeLabel(cell.shared) : "the same range"} (shaded red on the board). An address can belong to only one network.` });
    }
    if (v.code === "OUTSIDE_PARENT") out.push({ tone: "bad", title: `Outside your ${PARENT.network}/${PARENT.prefix}`, body: `${rangeLabel(c.realRange)} is not part of the address space you own.` });
    if (v.code === "TOO_SMALL") out.push({ tone: "bad", title: "Too small", body: `/${c.prefix} gives ${slUsable(c.prefix)} usable addresses; ${segName(c.id)} needs ${c.hosts}.` });
  }
  if (c.oversized) out.push({ tone: "warn", title: "Fits — but bigger than needed", body: `/${slMinPrefix(c.hosts)} (${slUsable(slMinPrefix(c.hosts))} usable) would already hold ${c.hosts}. Still valid; it just uses more space.` });
  return out;
}
export function PlainList({ items }: { items: Plain[] }) {
  return (
    <ul className="space-y-1.5">
      {items.map((p) => (
        <li key={p.title} className={clsx("rounded-xl border p-2.5", p.tone === "bad" ? "border-pv-danger/40 bg-pv-danger/[0.06]" : "border-pv-warning/40 bg-pv-warning/[0.06]")}>
          <p className={clsx("text-[13.5px] font-semibold", p.tone === "bad" ? "text-pv-danger" : "text-pv-warning")}>⚠ {p.title}</p>
          <p className="mt-0.5 text-[13px] leading-snug text-pv-text-muted">{p.body}</p>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Address space board (VLSM puzzle, dashboard, incident)
// ---------------------------------------------------------------------------------------------------------------
interface Drawn {
  id: SlSeg;
  range: Range;
  written?: Range;
  lane: number;
}
function drawn(rows: SlRow[], mode: "real" | "written"): Drawn[] {
  const out: Drawn[] = [];
  for (const r of rows) {
    const c = validateRow(rows, r.id);
    if (!c) continue;
    out.push({ id: r.id, range: mode === "written" ? c.writtenRange : c.realRange, written: mode === "real" && !c.aligned ? c.writtenRange : undefined, lane: 0 });
  }
  const lanes: Range[][] = [];
  for (const b of [...out].sort((x, y) => x.range.first - y.range.first || y.range.last - x.range.last)) {
    let i = 0;
    while (lanes[i]?.some((o) => overlaps(b.range, o))) i++;
    (lanes[i] ??= []).push(b.range);
    b.lane = i;
  }
  return out;
}
export interface BoardGhost {
  seg: SlSeg;
  network: string;
  prefix: number;
}
function ghostRanges(g?: BoardGhost) {
  const ip = g && parseIPv4(g.network);
  if (!g || !ip || !slPrefixOk(g.prefix)) return undefined;
  const real = rangeOf(realBlock(ip, g.prefix), g.prefix);
  const n = ipToNum(ip);
  return { seg: g.seg, real, typed: real.first === n ? undefined : { first: n, last: n + blockSize(g.prefix) - 1 } };
}

/** One track of the board over [w0, w0 + span) addresses (offsets inside the parent). */
export function BoardTrack({ rows, mode = "real", w0 = 0, span = SIZE, ghost, selected, onSelect, showFree = true, overlapBands = true, laneH = 56, dimOutside }: { rows: SlRow[]; mode?: "real" | "written"; w0?: number; span?: number; ghost?: BoardGhost; selected?: SlSeg; onSelect?: (s: SlSeg) => void; showFree?: boolean; overlapBands?: boolean; laneH?: number; dimOutside?: SlSeg[] }) {
  const a0 = P0 + w0;
  const a1 = a0 + span - 1;
  const blocks = drawn(rows, mode);
  const g = ghostRanges(ghost);
  const lanes = Math.max(1, ...blocks.map((b) => b.lane + 1));
  const topH = blocks.some((b) => b.written) || g?.typed ? 24 : 0;
  const height = topH + lanes * laneH;
  const clip = (r: Range) => ({ first: Math.max(r.first, a0), last: Math.min(r.last, a1) });
  const pos = (r: Range) => ({ left: `${((r.first - a0) / span) * 100}%`, width: `${((r.last - r.first + 1) / span) * 100}%` });
  const vis = (r: Range) => r.first <= a1 && r.last >= a0;
  const free = mode === "real" ? freeSpace(rows).ranges : [];
  const shared = mode === "real" && overlapBands ? overlapMatrix(rows).cells.flatMap((c) => (c.shared ? [{ ...c.shared, a: c.a, b: c.b }] : [])) : [];
  const ticks = [0, 1, 2, 3, 4].map((i) => w0 + (span / 4) * i);
  const narrow = blocks.filter((b) => vis(b.range) && (clip(b.range).last - clip(b.range).first + 1) / span < 0.08);
  return (
    <div>
      <div className="relative w-full overflow-hidden rounded-xl border border-pv-border bg-pv-bg-elevated/50" style={{ height }}>
        {showFree &&
          free.filter(vis).map((f) => {
            const c = clip(f);
            const wide = (c.last - c.first + 1) / span >= 0.1;
            return (
              <div key={`f${f.first}`} className="absolute bottom-0 flex items-center justify-center text-[11px] text-pv-text-faint" style={{ ...pos(c), top: topH, backgroundImage: HATCH_FREE }}>
                {wide && <span className="rounded bg-pv-bg/80 px-1">free {rangeLabel(f)}</span>}
              </div>
            );
          })}
        {blocks.map((b) => {
          if (!b.written || !vis(b.written)) return null;
          const c = clip(b.written);
          return (
            <div key={`w${b.id}`} className="absolute top-1 flex h-[18px] items-center overflow-hidden rounded border-2 border-dashed px-1 text-[10.5px] text-pv-text-muted" style={{ ...pos(c), borderColor: SEG_COLOR[b.id] }}>
              <span className="truncate">you wrote {dotOct(numToIp(b.written.first))}</span>
            </div>
          );
        })}
        {blocks.map((b) => {
          if (!vis(b.range)) return null;
          const c = clip(b.range);
          const frac = (c.last - c.first + 1) / span;
          const dim = dimOutside && !dimOutside.includes(b.id);
          return (
            <button
              key={b.id}
              type="button"
              onClick={() => onSelect?.(b.id)}
              aria-label={`${segName(b.id)} ${rangeLabel(b.range)}`}
              className={clsx("absolute flex flex-col items-center justify-center overflow-hidden rounded-lg border-2 px-1 text-center leading-tight", selected === b.id && "ring-2 ring-pv-text/80", dim && "opacity-35")}
              style={{ ...pos(c), top: topH + b.lane * laneH + 3, height: laneH - 6, background: `${SEG_COLOR[b.id]}38`, borderColor: SEG_COLOR[b.id] }}
            >
              {frac >= 0.16 ? (
                <>
                  <span className="truncate text-[13px] font-bold text-pv-text">
                    {segName(b.id)} /{validateRow(rows, b.id)!.prefix}
                  </span>
                  <span className="truncate pv-mono text-[11.5px] text-pv-text-muted">{rangeLabel(b.range)}</span>
                </>
              ) : frac >= 0.035 ? (
                <span className="text-[13px] font-bold text-pv-text">{SEG_SHORT[b.id]}</span>
              ) : null}
            </button>
          );
        })}
        {shared.filter(vis).map((s) => {
          const c = clip(s);
          return (
            <div key={`o${s.a}${s.b}`} className="pointer-events-none absolute bottom-0 flex items-end justify-center" style={{ ...pos(c), top: topH }}>
              <div className="absolute inset-0 opacity-50" style={{ backgroundImage: HATCH_OVERLAP }} />
            </div>
          );
        })}
        {g && vis(g.real) && <div className="pointer-events-none absolute rounded-lg border-2 border-dashed border-white/85" style={{ ...pos(clip(g.real)), top: topH + 1, bottom: 1 }} />}
        {g?.typed && vis(g.typed) && <div className="pointer-events-none absolute top-1 h-[18px] rounded border-2 border-dashed border-white/60" style={pos(clip(g.typed))} />}
      </div>
      <div aria-hidden className="relative mt-0.5 h-4 pv-mono text-[11px] text-pv-text-faint">
        {ticks.map((t, i) => (
          <span key={t} className="absolute" style={{ left: `${((t - w0) / span) * 100}%`, transform: i === 0 ? "none" : i === 4 ? "translateX(-100%)" : "translateX(-50%)" }}>
            {t === SIZE ? ".255" : `.${t}`}
          </span>
        ))}
      </div>
      {shared.filter(vis).length > 0 && (
        <p className="mt-0.5 text-[12.5px] font-semibold text-pv-danger">
          {shared.filter(vis).map((x) => `Overlap ${rangeLabel(x)}: ${segName(x.a)} and ${segName(x.b)} both claim it`).join(" · ")}
        </p>
      )}
      {narrow.length > 0 && (
        <p className="mt-0.5 flex flex-wrap gap-x-3 text-[11.5px] text-pv-text-muted">
          {narrow.map((b) => (
            <span key={b.id}>
              <b style={{ color: SEG_COLOR[b.id] }}>{SEG_SHORT[b.id]}</b> = {segName(b.id)} {rangeLabel(b.range)}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

/** The VLSM address-space board: the whole /24, with a 64-address zoom that follows the selected block. */
export function AddressBoard({ rows, mode = "real", ghost, selected, onSelect, title, zoomStart, zoomed, onZoom }: { rows: SlRow[]; mode?: "real" | "written"; ghost?: BoardGhost; selected?: SlSeg; onSelect?: (s: SlSeg) => void; title?: ReactNode; zoomStart?: number; zoomed?: boolean; onZoom?: (z: boolean) => void }) {
  const [own, setOwn] = useState(false);
  const zoom = zoomed ?? own;
  const setZoom = (z: boolean) => (onZoom ? onZoom(z) : setOwn(z));
  const w = zoomStart ?? 0;
  return (
    <figure className="space-y-1.5" aria-label={`Address space ${PARENT.network}/${PARENT.prefix}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <figcaption className="text-[13px] font-semibold text-pv-text">
          {title ?? (
            <>
              {PARENT.network}/{PARENT.prefix} <span className="font-normal text-pv-text-faint">· {SIZE} addresses</span>
            </>
          )}
        </figcaption>
        <div className="flex gap-1 text-[11.5px]" role="group" aria-label="Board zoom">
          <button type="button" aria-pressed={!zoom} onClick={() => setZoom(false)} className={clsx("rounded-full border px-2 py-0.5", !zoom ? "border-pv-cyan/60 bg-pv-cyan/15 text-pv-cyan-soft" : "border-pv-border text-pv-text-faint")}>
            Whole /24
          </button>
          <button type="button" aria-pressed={zoom} onClick={() => setZoom(true)} className={clsx("rounded-full border px-2 py-0.5", zoom ? "border-pv-cyan/60 bg-pv-cyan/15 text-pv-cyan-soft" : "border-pv-border text-pv-text-faint")}>
            Zoom .{w}–.{w + 63}
          </button>
        </div>
      </div>
      <BoardTrack rows={rows} mode={mode} ghost={ghost} selected={selected} onSelect={onSelect} w0={zoom ? w : 0} span={zoom ? 64 : SIZE} />
    </figure>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Equal blocks (T2 boundaries, T4 FLSM)
// ---------------------------------------------------------------------------------------------------------------
export function BlockGrid({ prefix, tests = [], sub, starts = false, height = 72 }: { prefix: number; tests?: SlBoundaryTest[]; sub?: (network: string) => ReactNode; starts?: boolean; height?: number }) {
  const b = blockSize(prefix);
  const cells = Array.from({ length: SIZE / b }, (_, i) => i * b);
  const lastTest = tests[tests.length - 1];
  // One pin per address (latest result); pins closer than ~7 % of the width go on a second row.
  const pins = [...new Map(tests.map((t) => [t.address, t])).values()]
    .sort((a, b) => lastOctet(a.address) - lastOctet(b.address))
    .reduce<{ t: SlBoundaryTest; row: number }[]>((acc, t) => {
      const prev = acc[acc.length - 1];
      const close = prev && (lastOctet(t.address) - lastOctet(prev.t.address)) / SIZE < 0.07;
      return [...acc, { t, row: close ? 1 - prev.row : 0 }];
    }, []);
  const hot = lastTest ? lastOctet(realBlock(lastTest.address, prefix)) : undefined;
  return (
    <div className="w-full">
      {pins.length > 0 && (
        <div className="relative h-14" aria-hidden>
          {pins.map(({ t, row }) => {
            const o = lastOctet(t.address);
            return (
              <span key={t.address} className={clsx("absolute flex -translate-x-1/2 flex-col items-center text-[11.5px] font-bold leading-none", t.aligned ? "text-pv-success" : "text-pv-danger")} style={{ left: `${(o / SIZE) * 100}%`, bottom: row ? 26 : 0 }}>
                <span className="rounded bg-pv-bg px-0.5">
                  {t.aligned ? "✓" : "✕"} .{o}
                </span>
                <span className="text-[12px]">▼</span>
              </span>
            );
          })}
        </div>
      )}
      <div className="flex w-full overflow-hidden rounded-xl border border-pv-border" style={{ height }}>
        {cells.map((s) => (
          <div key={s} className={clsx("flex min-w-0 flex-1 flex-col items-center justify-center border-r border-pv-border/70 px-0.5 text-center last:border-r-0", hot === s ? (lastTest?.aligned ? "bg-pv-success/15" : "bg-pv-danger/15") : "bg-pv-cyan/[0.06]")}>
            <span className="pv-mono text-[13px] font-bold text-pv-text sm:text-[15px]">{s}</span>
            <span className="pv-mono text-[10.5px] text-pv-text-faint sm:text-[11.5px]">–{s + b - 1}</span>
            {sub && <span className="mt-0.5 truncate text-[10.5px] text-pv-text-muted sm:text-[11.5px]">{sub(numToIp(P0 + s))}</span>}
          </div>
        ))}
      </div>
      {starts && (
        <div className="flex w-full" aria-hidden>
          {cells.map((s) => (
            <span key={s} className="flex-1 text-left text-[11px] font-semibold text-pv-success">
              ▲<span className="hidden sm:inline"> start</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Address tiles (T3) and the subnet card
// ---------------------------------------------------------------------------------------------------------------
export function AddressTiles({ network, prefix, entered, reveal = true }: { network: string; prefix: number; entered?: string; reveal?: boolean }) {
  const n = blockSize(prefix);
  const first = lastOctet(network);
  const ent = entered ? lastOctet(entered) : undefined;
  const cols = Math.min(8, n);
  return (
    <div>
      <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {Array.from({ length: n }, (_, i) => first + i).map((o, i) => {
          const kind = !reveal ? "plain" : i === 0 ? "net" : i === n - 1 ? "bc" : "use";
          return (
            <span
              key={o}
              className={clsx(
                "flex h-9 items-center justify-center rounded-md border pv-mono text-[12.5px] font-semibold sm:h-10 sm:text-[13.5px]",
                kind === "net" && "border-pv-violet/60 bg-pv-violet/20 text-pv-violet",
                kind === "bc" && "border-pv-warning/60 bg-pv-warning/20 text-pv-warning",
                kind === "use" && "border-pv-success/35 bg-pv-success/10 text-pv-text",
                kind === "plain" && "border-pv-border bg-pv-bg-elevated/50 text-pv-text-muted",
                ent === o && "ring-2 ring-pv-cyan",
              )}
            >
              {o}
            </span>
          );
        })}
      </div>
      {reveal && (
        <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-pv-text-muted">
          <span>
            <b className="text-pv-violet">■</b> network (all host bits 0)
          </span>
          <span>
            <b className="text-pv-success">■</b> usable hosts
          </span>
          <span>
            <b className="text-pv-warning">■</b> broadcast (all host bits 1)
          </span>
          {ent !== undefined && (
            <span>
              <b className="text-pv-cyan-soft">◯</b> you entered .{ent}
            </span>
          )}
        </p>
      )}
    </div>
  );
}

export function SubnetCard({ c }: { c: SlCalc }) {
  const row = (k: string, v: string, cls: string) => (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[12px] font-semibold uppercase tracking-wide text-pv-text-faint">{k}</span>
      <span className={clsx("pv-mono text-[15px] font-bold", cls)}>{dotOct(v)}</span>
    </div>
  );
  return (
    <div className="mx-auto w-full max-w-sm space-y-2 text-center">
      <p className="text-[12px] font-semibold uppercase tracking-wide text-pv-text-faint">You entered</p>
      <p className="pv-mono text-[17px] font-bold text-pv-text">
        {c.address}/{c.prefix}
      </p>
      <p className="text-[12.5px] text-pv-cyan-soft">↓ belongs to ↓</p>
      <div className="space-y-1.5 rounded-2xl border-2 border-pv-cyan/50 bg-pv-cyan/[0.05] p-3 text-left">
        <p className="text-center pv-mono text-[17px] font-bold text-pv-text">
          {c.network}/{c.prefix}
        </p>
        {row("Network", c.network, "text-pv-violet")}
        {row("First host", c.first, "text-pv-success")}
        <p className="py-0.5 text-center text-[13px] text-pv-text-muted">{c.usable} usable hosts</p>
        {row("Last host", c.last, "text-pv-success")}
        {row("Broadcast", c.broadcast, "text-pv-warning")}
      </div>
      <p className="text-[13px] text-pv-text-muted">
        Next subnet → <span className="pv-mono font-semibold text-pv-text">{dotOct(c.next)}/{c.prefix}</span>
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Bits as supporting evidence (with a "snap back" to the network)
// ---------------------------------------------------------------------------------------------------------------
function BitRow({ label, net, host, tone }: { label: string; net: string; host: string; tone: "in" | "net" }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-14 pv-mono text-[14px] font-bold text-pv-text">{label}</span>
      <span className="flex items-center gap-0.5">
        {net.split("").map((x, i) => (
          <span key={`n${i}`} className="flex h-8 w-7 items-center justify-center rounded border border-pv-violet/50 bg-pv-violet/15 pv-mono text-[14px] font-bold text-pv-violet">
            {x}
          </span>
        ))}
        <span className="mx-1 text-pv-text-faint">|</span>
        {host.split("").map((x, i) => (
          <span key={`h${i}`} className={clsx("flex h-8 w-7 items-center justify-center rounded border pv-mono text-[14px] font-bold transition-colors duration-500", tone === "net" ? "border-pv-success/50 bg-pv-success/15 text-pv-success" : x === "1" ? "border-pv-danger/50 bg-pv-danger/15 text-pv-danger" : "border-pv-success/40 bg-pv-success/10 text-pv-success")}>
            {x}
          </span>
        ))}
      </span>
    </div>
  );
}

export function BitsSnap({ ip, prefix }: { ip: string; prefix: number }) {
  const [snap, setSnap] = useState(false);
  const b = octetBits(ip, prefix);
  const aligned = /^0*$/.test(b.host);
  return (
    <div className="space-y-1.5">
      <p className="text-[12px] text-pv-text-muted">
        Last octet under /{prefix}: <span className="text-pv-violet">network bits</span> | <span className="text-pv-success">host bits</span>
      </p>
      <BitRow label={`.${lastOctet(ip)}`} net={b.net} host={b.host} tone="in" />
      {aligned ? (
        <p className="text-[13px] text-pv-success">Host bits all 0 → a valid network boundary.</p>
      ) : (
        <>
          <p className="text-[13px] text-pv-danger">Host bits aren&apos;t all 0 → this is a host address, not a network start.</p>
          {!snap ? (
            <button type="button" onClick={() => setSnap(true)} className="rounded-full border border-pv-cyan/50 px-3 py-1 text-[12.5px] font-semibold text-pv-cyan-soft hover:bg-pv-cyan/10">
              Clear the host bits →
            </button>
          ) : (
            <div className="space-y-1 transition-opacity duration-500">
              <BitRow label={`.${b.anded}`} net={b.net} host={"0".repeat(b.host.length)} tone="net" />
              <p className="text-[13px] text-pv-text-muted">
                .{lastOctet(ip)} AND .{b.maskOctet} = <b className="text-pv-text">.{b.anded}</b> — the network it really belongs to.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Host requirement → container (T1)
// ---------------------------------------------------------------------------------------------------------------
export function CapacityBars({ hosts, prefixes, highlight }: { hosts: number; prefixes: number[]; highlight?: number }) {
  const min = slMinPrefix(hosts);
  // One scale for every view: always wide enough for the ladder around the need, so the need line stays put.
  const max = Math.max(...prefixes.map((p) => blockSize(p)), blockSize(Math.max(23, min - 1)), hosts);
  return (
    <div className="space-y-2.5">
      {prefixes.map((p) => {
        const total = blockSize(p);
        const usable = slUsable(p);
        const fits = usable >= hosts;
        const verdict = !fits ? "✕ too small" : p === min ? "✓ fits — the smallest that does" : "✓ fits, but larger than needed";
        return (
          <div key={p} className={clsx("rounded-xl p-2", highlight === p && "bg-pv-cyan/[0.06] ring-1 ring-pv-cyan/40")}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <span className="text-[14px] font-bold text-pv-text">
                /{p} <span className="font-normal text-pv-text-muted">· {total} total · {usable} usable</span>
              </span>
              <span className={clsx("text-[13px] font-semibold", !fits ? "text-pv-danger" : p === min ? "text-pv-success" : "text-pv-warning")}>{verdict}</span>
            </div>
            <div className="relative mt-1 h-6 w-full overflow-hidden">
              <div className="absolute inset-y-0 left-0 rounded-md border border-pv-border bg-pv-bg-elevated/60" style={{ width: `${(total / max) * 100}%` }}>
                <div className={clsx("h-full rounded-md", fits ? "bg-pv-success/35" : "bg-pv-danger/30")} style={{ width: `${(usable / total) * 100}%` }} />
              </div>
              <div className="absolute inset-y-0 w-0.5 bg-pv-cyan" style={{ left: `${Math.min(99.5, (hosts / max) * 100)}%` }} aria-hidden />
            </div>
          </div>
        );
      })}
      <p className="text-[12px] text-pv-cyan-soft">▏cyan line = {hosts} addresses needed</p>
    </div>
  );
}

/** A tiny worked example of a container (used before the learner predicts). */
export function ExampleContainer({ prefix }: { prefix: number }) {
  const n = blockSize(prefix);
  return (
    <div>
      <div className="flex gap-1">
        {Array.from({ length: n }, (_, i) => (
          <span key={i} className={clsx("flex h-9 flex-1 items-center justify-center rounded-md border text-[11px] font-bold", i === 0 ? "border-pv-violet/60 bg-pv-violet/20 text-pv-violet" : i === n - 1 ? "border-pv-warning/60 bg-pv-warning/20 text-pv-warning" : "border-pv-success/40 bg-pv-success/10 text-pv-success")}>
            {i === 0 ? "net" : i === n - 1 ? "bc" : "host"}
          </span>
        ))}
      </div>
      <p className="mt-1 text-[12.5px] text-pv-text-muted">
        A /{prefix} holds {n} addresses: 1 network + {n - 2} usable + 1 broadcast (ordinary LAN subnet).
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// FLSM (T4): cutting the /24 into equal pieces
// ---------------------------------------------------------------------------------------------------------------
export function FlsmSplit({ prefix }: { prefix?: number }) {
  if (!prefix)
    return (
      <div className="flex h-[72px] w-full items-center justify-center rounded-xl border-2 border-pv-cyan/40 bg-pv-cyan/[0.05] text-[14px] font-semibold text-pv-text">
        {PARENT.network}/{PARENT.prefix} · {SIZE} addresses
      </div>
    );
  const f = equalSplit(prefix);
  return (
    <div className="space-y-2">
      <BlockGrid prefix={prefix} sub={() => `${f.usable} usable`} />
      <div className="grid gap-1.5 sm:grid-cols-2">
        <p className={clsx("rounded-lg border px-2.5 py-1.5 text-[13px]", f.enoughSubnets ? "border-pv-success/40 text-pv-success" : "border-pv-danger/40 text-pv-danger")}>
          {f.enoughSubnets ? "✓" : "✕"} 4 networks need 4 blocks — {f.count} available
        </p>
        {f.fits.map((r) => (
          <p key={r.id} className={clsx("rounded-lg border px-2.5 py-1.5 text-[13px]", r.fits ? "border-pv-success/40 text-pv-success" : "border-pv-danger/40 text-pv-danger")}>
            {r.fits ? "✓" : "✕"} {segName(r.id)} needs {r.hosts} — a /{prefix} gives {f.usable}
          </p>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// VLSM pieces (T5)
// ---------------------------------------------------------------------------------------------------------------
export function RequirementPieces({ rows }: { rows: SlRow[] }) {
  const sized = rows.filter((r) => r.prefix !== undefined);
  const total = sized.reduce((n, r) => n + blockSize(r.prefix!), 0);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-stretch gap-1.5">
        {rows.map((r) => {
          const b = r.prefix !== undefined ? blockSize(r.prefix) : undefined;
          return (
            <div key={r.id} className="flex min-w-[96px] flex-col justify-center rounded-xl border-2 p-2 text-center" style={{ flexGrow: b ?? 8, flexBasis: 0, borderColor: SEG_COLOR[r.id], background: `${SEG_COLOR[r.id]}22` }}>
              <span className="text-[14px] font-bold text-pv-text">{segName(r.id)}</span>
              <span className="text-[12px] text-pv-text-muted">{r.hosts} needed</span>
              <span className="pv-mono text-[15px] font-bold" style={{ color: SEG_COLOR[r.id] }}>
                {r.prefix !== undefined ? `/${r.prefix}` : "/?"}
              </span>
              <span className="text-[12px] text-pv-text-muted">{b !== undefined ? `${b} addresses` : "not sized"}</span>
            </div>
          );
        })}
      </div>
      <div>
        <div className="flex h-4 w-full overflow-hidden rounded-full border border-pv-border bg-pv-bg-elevated/60">
          {sized.map((r) => (
            <div key={r.id} style={{ width: `${(blockSize(r.prefix!) / SIZE) * 100}%`, background: SEG_COLOR[r.id] }} />
          ))}
        </div>
        <p className={clsx("mt-1 text-[13px]", total > SIZE ? "text-pv-danger" : "text-pv-text-muted")}>
          {total} of {SIZE} addresses {total > SIZE ? "— more than the /24 holds" : "used by the blocks so far"}
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Incident (T8): what the spreadsheet claims vs what the CIDR math means
// ---------------------------------------------------------------------------------------------------------------
export function ClaimsVsReality({ rows, real, onPick }: { rows: SlRow[]; real: boolean; onPick?: (s: SlSeg) => void }) {
  const focus: SlSeg[] = ["LAN-B", "LAN-C"];
  return (
    <div className="space-y-3">
      <div>
        <p className="mb-1 text-[13px] font-semibold text-pv-text">What the spreadsheet claims</p>
        <BoardTrack rows={rows} mode="written" w0={128} span={128} showFree={false} onSelect={onPick} dimOutside={focus} laneH={52} />
        <p className="mt-0.5 text-[12px] text-pv-text-faint">Showing .128–.255 · LAN-A is .0–.127 (left half, unchanged).</p>
      </div>
      {real ? (
        <div>
          <p className="mb-1 text-[13px] font-semibold text-pv-text">What the CIDR math actually means</p>
          <BoardTrack rows={rows} mode="real" w0={128} span={128} onSelect={onPick} dimOutside={focus} laneH={52} />
        </div>
      ) : (
        <p className="rounded-xl border border-dashed border-pv-border p-3 text-center text-[13px] text-pv-text-muted">The real CIDR blocks appear here once you calculate them.</p>
      )}
    </div>
  );
}

/** Every requirement's segment, for "used/total" rows in the dashboard. */
export function planRows(rows: SlRow[]) {
  return rows
    .map((r) => ({ r, c: validateRow(rows, r.id) }))
    .filter((x): x is { r: SlRow; c: SlRowCheck } => !!x.c)
    .map(({ r, c }) => ({ id: r.id, network: `${dotOct(c.real)}/${c.prefix}`, range: rangeLabel(c.realRange), need: r.hosts, usable: slUsable(c.prefix), valid: c.valid, broadcast: dotOct(slDescribe(c.real, c.prefix).broadcast) }));
}
export const SEG_IDS = SEGMENTS.map((s) => s.id);
