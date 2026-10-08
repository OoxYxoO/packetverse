"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { clsx } from "clsx";

/**
 * THE ADDRESS BOARD — 10.44.0.0/24 drawn as 16 rows of 16 addresses (256 squares).
 *
 * Why a square board instead of a ruler: every block size the lesson uses is a clean rectangle here — /30 = 4 squares,
 * /29 = half a row, /28 = one row, /27 = two rows, /26 = a quarter, /25 = half the board — and a valid block always
 * starts on its own grid line. Misalignment, overlap and free space become shapes you can see and tap, not numbers.
 *
 * Purely presentational: the caller turns lab-model state into CellViews. Cells are real buttons with a roving
 * tabindex (arrow keys move, Enter/Space taps), so the board is fully keyboard-usable. Motion is CSS only (color
 * fills, a sliding "snap" outline) and is switched off under prefers-reduced-motion.
 */

export interface CellView {
  /** Background (a CSS color). */
  fill?: string;
  /** Short text shown inside the square ("N", "B", "?"); numbers are shown separately when there is room. */
  tag?: string;
  /** Dashed border color — "as written" / preview squares. */
  dashed?: string;
  /** Red hatching — two networks claim this address. */
  clash?: boolean;
  /** Emphasis ring: a tested or tapped address. */
  ring?: "ok" | "bad" | "info";
  dim?: boolean;
  /** Squares with the same group key get one outline around the group. */
  group?: string;
  groupColor?: string;
  /** Stagger index for the fill animation (position inside its block). */
  pour?: number;
}
export interface SnapOverlay {
  key: string;
  /** Offsets inside the board (0–255), aligned block. */
  first: number;
  size: number;
  color: string;
  /** Start of the slide, in addresses relative to `first` (e.g. +32 = where the learner wrote it). */
  from: number;
  label?: string;
  /** Put the label in the top-right corner (keeps the block's first square visible). */
  labelRight?: boolean;
}

const CLASH = "repeating-linear-gradient(135deg, rgba(248,113,113,0.95) 0 3px, rgba(248,113,113,0.25) 3px 7px)";

/** Board geometry of an aligned block (rows/cols in squares). */
function rectOf(first: number, size: number, cols: number, start: number) {
  const o = first - start;
  if (size >= cols) return { row: Math.floor(o / cols), col: 0, rows: size / cols, cw: cols };
  return { row: Math.floor(o / cols), col: o % cols, rows: 1, cw: size };
}

function Snap({ s, cols, rows, start }: { s: SnapOverlay; cols: number; rows: number; start: number }) {
  const r = rectOf(s.first, s.size, cols, start);
  const dx = s.from % cols;
  const dy = Math.floor(s.from / cols);
  const [atStart, setAtStart] = useState(s.from !== 0);
  useEffect(() => {
    if (s.from === 0) return;
    const t = window.setTimeout(() => setAtStart(false), 450);
    return () => window.clearTimeout(t);
  }, [s.key, s.from]);
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute rounded-md border-[3px] transition-transform duration-700 ease-out motion-reduce:transition-none"
      style={{
        left: `${(r.col / cols) * 100}%`,
        top: `${(r.row / rows) * 100}%`,
        width: `${(r.cw / cols) * 100}%`,
        height: `${(r.rows / rows) * 100}%`,
        borderColor: s.color,
        boxShadow: `0 0 0 2px rgba(0,0,0,0.35), 0 0 18px ${s.color}`,
        transform: atStart ? `translate(${(dx / r.cw) * 100}%, ${(dy / r.rows) * 100}%)` : "translate(0, 0)",
      }}
    >
      {s.label && (
        <span className={clsx("absolute top-1 max-w-[calc(100%-0.5rem)] truncate rounded bg-pv-bg/90 px-1.5 text-[11.5px] font-bold sm:text-[12px]", s.labelRight ? "right-1" : "left-1")} style={{ color: s.color }}>
          {s.label}
        </span>
      )}
    </div>
  );
}

export function AddressGrid({
  cells,
  start = 0,
  count = 256,
  cols = 16,
  onTap,
  onHover,
  numbers = "auto",
  overlays = [],
  label,
  size = "board",
  rowLines,
  footer,
  base = "10.44.0.",
}: {
  /** Indexed by offset inside the /24 (0–255). */
  cells: CellView[];
  start?: number;
  count?: number;
  cols?: number;
  onTap?: (offset: number) => void;
  /** Pointer/keyboard hover — used for a live "where would it land?" preview. */
  onHover?: (offset: number | undefined) => void;
  numbers?: "auto" | "all" | "none";
  overlays?: SnapOverlay[];
  label: string;
  size?: "board" | "zoom";
  /** Thick guide lines after these rows (e.g. every 4 rows for /26 starts). */
  rowLines?: number[];
  footer?: ReactNode;
  /** The parent /24's first three octets, for screen-reader labels ("192.168.40."). */
  base?: string;
}) {
  const rows = Math.ceil(count / cols);
  const [focus, setFocus] = useState(start);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (to: number) => {
    const t = Math.min(start + count - 1, Math.max(start, to));
    setFocus(t);
    refs.current[t - start]?.focus();
  };
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, o: number) => {
    const k = e.key;
    if (k === "ArrowRight") move(o + 1);
    else if (k === "ArrowLeft") move(o - 1);
    else if (k === "ArrowDown") move(o + cols);
    else if (k === "ArrowUp") move(o - cols);
    else if (k === "Home") move(start + Math.floor((o - start) / cols) * cols);
    else if (k === "End") move(start + Math.floor((o - start) / cols) * cols + cols - 1);
    else return;
    e.preventDefault();
  };
  const g = (o: number) => cells[o]?.group;
  return (
    <figure className="w-full" aria-label={label}>
      <div className="grid gap-x-1" style={{ gridTemplateColumns: size === "zoom" ? "minmax(0,1fr)" : "2.1rem minmax(0,1fr)" }}>
        {size === "board" && (
          <div className="grid" style={{ gridTemplateRows: `repeat(${rows}, minmax(0,1fr))` }} aria-hidden>
            {Array.from({ length: rows }, (_, r) => (
              <span key={r} className="flex items-center justify-end pr-1 pv-mono text-[10.5px] text-pv-text-faint sm:text-[11.5px]">
                .{start + r * cols}
              </span>
            ))}
          </div>
        )}
        <div className="relative">
          <div role="grid" aria-label={label} onMouseLeave={() => onHover?.(undefined)} className="grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))`, gap: size === "zoom" ? 6 : 2 }}>
            {Array.from({ length: count }, (_, i) => start + i).map((o) => {
              const c = cells[o] ?? {};
              const col = (o - start) % cols;
              const row = Math.floor((o - start) / cols);
              const edge = (n: number | undefined) => c.group !== undefined && (n === undefined || g(n) !== c.group);
              const left = edge(col > 0 ? o - 1 : undefined);
              const right = edge(col < cols - 1 ? o + 1 : undefined);
              const top = edge(row > 0 ? o - cols : undefined);
              const bottom = edge(row < rows - 1 ? o + cols : undefined);
              const gc = c.groupColor ?? "rgba(255,255,255,0.7)";
              const line = rowLines?.includes(row) ? "0 3px 0 -1px #22d3ee" : undefined;
              return (
                <button
                  key={o}
                  ref={(el) => {
                    refs.current[o - start] = el;
                  }}
                  type="button"
                  role="gridcell"
                  tabIndex={o === focus ? 0 : -1}
                  aria-label={`${base}${o}${c.tag ? ` (${c.tag})` : ""}`}
                  onFocus={() => {
                    setFocus(o);
                    onHover?.(o);
                  }}
                  onMouseEnter={() => onHover?.(o)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onTap?.(o);
                    } else onKey(e, o);
                  }}
                  onClick={() => onTap?.(o)}
                  className={clsx(
                    "relative flex aspect-square min-w-0 items-center justify-center overflow-hidden pv-mono leading-none transition-[background-color,opacity] duration-300 ease-out motion-reduce:transition-none focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white",
                    size === "zoom" ? "rounded-lg text-[13px] font-semibold sm:text-[15px]" : "rounded-[3px] text-[9px] sm:text-[10px]",
                    c.dim && "opacity-40",
                    onTap ? "cursor-pointer hover:brightness-150" : "cursor-default",
                  )}
                  style={{
                    background: c.fill ?? "rgba(148,163,184,0.10)",
                    transitionDelay: c.pour !== undefined ? `${Math.min(c.pour, 120) * 3}ms` : undefined,
                    borderLeft: left ? `2px solid ${gc}` : undefined,
                    borderRight: right ? `2px solid ${gc}` : undefined,
                    borderTop: top ? `2px solid ${gc}` : undefined,
                    borderBottom: bottom ? `2px solid ${gc}` : undefined,
                    outline: c.dashed ? `2px dashed ${c.dashed}` : undefined,
                    outlineOffset: c.dashed ? -2 : undefined,
                    boxShadow: c.ring ? `inset 0 0 0 2px ${c.ring === "ok" ? "#34d399" : c.ring === "bad" ? "#f87171" : "#e8edf9"}` : line,
                  }}
                >
                  {c.clash && <span aria-hidden className="absolute inset-0 opacity-70" style={{ backgroundImage: CLASH }} />}
                  <span className={clsx("relative", c.tag ? "font-bold text-pv-text" : "text-pv-text-faint", numbers === "none" && !c.tag && "sr-only", numbers === "auto" && !c.tag && size === "board" && "hidden lg:inline")}>{c.tag ?? o}</span>
                </button>
              );
            })}
          </div>
          {/* Clipped to the board so a sliding outline never spills over the page. */}
          <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden rounded-md">
            {overlays.map((s) => (
              <Snap key={s.key} s={s} cols={cols} rows={rows} start={start} />
            ))}
          </div>
        </div>
      </div>
      {footer}
    </figure>
  );
}

/** Legend chip row under the board. */
export function Legend({ items }: { items: { color: string; label: string; clash?: boolean; dashed?: boolean }[] }) {
  return (
    <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[12.5px] text-pv-text-muted">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-3.5 w-3.5 rounded-sm" style={{ background: i.clash ? CLASH : i.dashed ? "transparent" : i.color, outline: i.dashed ? `2px dashed ${i.color}` : undefined, outlineOffset: -2 }} />
          {i.label}
        </span>
      ))}
    </p>
  );
}
