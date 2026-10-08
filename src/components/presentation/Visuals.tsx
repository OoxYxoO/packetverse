"use client";

import { type ReactNode } from "react";
import { clsx } from "clsx";

/**
 * Generic presentation visuals: a topology stage with links, travelling tokens and speech bubbles; packet cards;
 * tables; step chains; big statement lines; comparison cards. Lessons compose these into their own scenes — the
 * kit carries no protocol knowledge. Pair with <Mover/> from ScrollyDeck for motion.
 */

export const pct = (n: number) => `${n}%`;
const tint = (c: string, a: number) => `color-mix(in srgb, ${c} ${a}%, transparent)`;

// ---------------------------------------------------------------------------------------------------------------
// Topology
// ---------------------------------------------------------------------------------------------------------------
export interface TopoNode {
  id: string;
  label: string;
  /** e.g. an IP address. */
  sub?: string;
  /** e.g. a MAC / router-id (hidden on phones). */
  sub2?: string;
  icon?: string;
  x: number;
  y: number;
}
export interface TopoLink {
  a: string;
  b: string;
  label?: string;
  state?: "up" | "down" | "active" | "blocked" | "dim" | "standby";
  /** Where the label sits along a → b (0…1). Default 0.5, the middle; e.g. 0.3 keeps a port name near `a`. */
  at?: number;
}
export type Tone = "ask" | "no" | "yes" | "info" | "bad" | "warn";
export interface TopoView {
  ring?: "target" | "hit" | "dim" | "on" | "bad";
  bubble?: { text: string; tone: Tone; delay?: number };
  /** A small corner badge (state, role…). */
  badge?: { text: string; tone: Tone };
}
export interface TopoRegion {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  color?: string;
}

const BUBBLE: Record<Tone, string> = {
  ask: "border-pv-warning/60 bg-[#2a2006] text-pv-warning",
  no: "border-pv-border bg-pv-bg text-pv-text-muted",
  yes: "border-pv-success/60 bg-[#062417] text-pv-success",
  info: "border-pv-cyan/60 bg-[#06222a] text-pv-cyan-soft",
  bad: "border-pv-danger/60 bg-[#2a0b0b] text-pv-danger",
  warn: "border-pv-violet/60 bg-[#160f2a] text-pv-violet",
};
const LINK: Record<NonNullable<TopoLink["state"]>, { c: string; w: number; dash?: string }> = {
  up: { c: "rgba(148,163,184,0.5)", w: 2 },
  active: { c: "#22d3ee", w: 3.5 },
  down: { c: "#f87171", w: 2, dash: "5 4" },
  blocked: { c: "#fbbf24", w: 2, dash: "2 4" },
  dim: { c: "rgba(148,163,184,0.18)", w: 1.5 },
  standby: { c: "#a78bfa", w: 2, dash: "6 4" },
};

export const nodeAt = (nodes: TopoNode[], id: string): [number, number] => {
  const n = nodes.find((x) => x.id === id);
  return n ? [n.x, n.y] : [50, 50];
};
/** A point a little before `to` on the way from `from`, so a token that stops there doesn't hide the node. */
export function short(from: [number, number], to: [number, number], d = 16): [number, number] {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const len = Math.hypot(dx, dy) || 1;
  const k = Math.min(d, len / 2) / len;
  return [to[0] - dx * k, to[1] - dy * k];
}

/**
 * A topology in a responsive box (positions in % of width/height). `minH` keeps it legible on phones.
 * Children are typically <Mover/> tokens.
 */
export function Topo({ nodes, links = [], views = {}, regions = [], ratio = 46, minH = 220, showSub2, onNodeClick, selected, children }: { nodes: TopoNode[]; links?: TopoLink[]; views?: Record<string, TopoView>; regions?: TopoRegion[]; ratio?: number; minH?: number; showSub2?: boolean; /** Optional: makes nodes buttons (e.g. "inspect this device"). */ onNodeClick?: (id: string) => void; /** Optional: the node currently selected by onNodeClick. */ selected?: string; children?: ReactNode }) {
  return (
    <div className="relative w-full" style={{ paddingTop: `max(${ratio}%, ${minH}px)`, overflowX: "clip" }}>
      {regions.map((r) => (
        <div key={r.label} className="absolute rounded-2xl border border-dashed" style={{ left: pct(r.x), top: pct(r.y), width: pct(r.w), height: pct(r.h), borderColor: tint(r.color ?? "#22d3ee", 45), background: tint(r.color ?? "#22d3ee", 5) }}>
          <span className="absolute left-2 top-1 text-[10.5px] font-semibold sm:text-[12px]" style={{ color: r.color ?? "#67e8f9" }}>
            {r.label}
          </span>
        </div>
      ))}
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
        {links.map((l) => {
          const a = nodes.find((n) => n.id === l.a);
          const b = nodes.find((n) => n.id === l.b);
          if (!a || !b) return null;
          const st = LINK[l.state ?? "up"];
          return <line key={`${l.a}-${l.b}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={st.c} strokeWidth={st.w} strokeDasharray={st.dash} vectorEffect="non-scaling-stroke" className="transition-[stroke] duration-500" />;
        })}
      </svg>
      {links
        .filter((l) => l.label)
        .map((l) => {
          const a = nodes.find((n) => n.id === l.a);
          const b = nodes.find((n) => n.id === l.b);
          if (!a || !b) return null;
          return (
            <span key={`lbl-${l.a}-${l.b}`} className="absolute z-10 -translate-x-1/2 -translate-y-1/2 rounded bg-pv-bg/90 px-1 pv-mono text-[9.5px] text-pv-text-muted sm:text-[11px]" style={{ left: pct(a.x + (b.x - a.x) * (l.at ?? 0.5)), top: pct(a.y + (b.y - a.y) * (l.at ?? 0.5)) }}>
              {l.label}
            </span>
          );
        })}
      {nodes.map((n) => {
        const v = views[n.id] ?? {};
        return (
          <div key={n.id} className={clsx("absolute -translate-x-1/2 -translate-y-1/2 transition-opacity duration-500", v.bubble ? "z-30" : "z-10", v.ring === "dim" && "opacity-40")} style={{ left: `clamp(32px, ${n.x}%, calc(100% - 32px))`, top: pct(n.y) }}>
            <div
              role={onNodeClick ? "button" : undefined}
              tabIndex={onNodeClick ? 0 : undefined}
              aria-pressed={onNodeClick ? selected === n.id : undefined}
              aria-label={onNodeClick ? `Inspect ${n.label}` : undefined}
              onClick={onNodeClick ? () => onNodeClick(n.id) : undefined}
              onKeyDown={onNodeClick ? (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onNodeClick(n.id)) : undefined}
              className={clsx(
                onNodeClick && "cursor-pointer hover:border-pv-cyan/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-pv-cyan",
                onNodeClick && selected === n.id && "outline outline-2 outline-offset-2 outline-pv-violet",
                "relative flex min-w-[60px] flex-col items-center rounded-xl border-2 bg-pv-bg px-1.5 py-1 text-center leading-tight transition-[border-color,box-shadow] duration-500 sm:min-w-[88px] sm:px-2",
                v.ring === "target" ? "border-pv-success shadow-[0_0_18px_rgba(52,211,153,0.6)]" : v.ring === "hit" ? "border-pv-warning shadow-[0_0_14px_rgba(251,191,36,0.5)]" : v.ring === "on" ? "border-pv-cyan shadow-[0_0_14px_rgba(34,211,238,0.5)]" : v.ring === "bad" ? "border-pv-danger shadow-[0_0_14px_rgba(248,113,113,0.5)]" : "border-pv-border",
              )}
            >
              {n.icon && <span className="text-[14px] font-bold text-pv-cyan-soft sm:text-[18px]">{n.icon}</span>}
              <span className="text-[10.5px] font-bold text-pv-text sm:text-[12.5px]">{n.label}</span>
              {n.sub && <span className="pv-mono text-[9px] text-pv-text-muted sm:text-[11px]">{n.sub}</span>}
              {showSub2 && n.sub2 && <span className="hidden pv-mono text-[9.5px] text-pv-text-faint sm:block">{n.sub2}</span>}
              {v.badge && <span className={clsx("absolute -right-2 -top-2 rounded-full border px-1.5 text-[9.5px] font-bold sm:text-[10.5px]", BUBBLE[v.badge.tone])}>{v.badge.text}</span>}
            </div>
            {v.bubble && (
              <span className={clsx("pv-pop absolute bottom-full z-30 mb-1 w-max max-w-[44vw] rounded-lg border px-1.5 py-0.5 text-[10px] font-semibold leading-tight sm:max-w-none sm:whitespace-nowrap sm:text-[12px]", n.x > 70 ? "right-0" : n.x < 30 ? "left-0" : "left-1/2 -translate-x-1/2", BUBBLE[v.bubble.tone])} style={{ animationDelay: `${v.bubble.delay ?? 0}ms` }}>
                {v.bubble.text}
              </span>
            )}
          </div>
        );
      })}
      {children}
    </div>
  );
}

const TOKEN: Record<string, string> = {
  amber: "bg-pv-warning text-[#1a1200]",
  green: "bg-pv-success text-[#03140d]",
  cyan: "bg-pv-cyan text-[#03131a]",
  violet: "bg-pv-violet text-[#0d0820]",
  red: "bg-pv-danger text-[#1a0505]",
  white: "bg-white text-[#0a0e18]",
};
/** A packet/message token (put inside <Mover/>). */
export function Token({ color = "cyan", children }: { color?: keyof typeof TOKEN | string; children: ReactNode }) {
  return <span className={clsx("block whitespace-nowrap rounded-md px-1.5 py-0.5 pv-mono text-[10px] font-bold shadow-[0_0_14px_rgba(255,255,255,0.35)] sm:text-[12px]", TOKEN[color] ?? TOKEN.cyan)}>{children}</span>;
}

// ---------------------------------------------------------------------------------------------------------------
// Packets, tables, chains, statements, comparisons
// ---------------------------------------------------------------------------------------------------------------
export interface PacketLayer {
  name: string;
  /** Any CSS colour. */
  color: string;
  fields: { k: string; v: ReactNode; hi?: "new" | "bad" | "key" | "unknown" }[];
}
/** A packet as nested layers (outermost first), fields in a grid. */
export function PacketCard({ layers, compact }: { layers: PacketLayer[]; compact?: boolean }) {
  const render = (i: number): ReactNode => {
    const l = layers[i];
    if (!l) return null;
    return (
      <div className={clsx("rounded-xl border-2", compact ? "p-1.5" : "p-2")} style={{ borderColor: tint(l.color, 70), background: tint(l.color, 6) }}>
        <p className="text-[10.5px] font-bold uppercase tracking-[0.14em]" style={{ color: l.color }}>
          {l.name}
        </p>
        <div className="mt-1 grid grid-cols-2 gap-1 sm:grid-cols-3">
          {l.fields.map((f) => (
            <div key={f.k} className={clsx("rounded-md border px-1.5 py-0.5", f.hi === "new" ? "pv-pop border-pv-success bg-pv-success/15" : f.hi === "bad" ? "border-pv-danger bg-pv-danger/15" : f.hi === "key" ? "border-pv-cyan bg-pv-cyan/10" : f.hi === "unknown" ? "pv-pulse border-pv-danger bg-pv-danger/10" : "border-pv-border")}>
              <p className="text-[10px] text-pv-text-faint">{f.k}</p>
              <p className="pv-mono text-[11.5px] font-bold text-pv-text sm:text-[13px]">{f.v}</p>
            </div>
          ))}
        </div>
        {i + 1 < layers.length && <div className="mt-1.5">{render(i + 1)}</div>}
      </div>
    );
  };
  return render(0);
}

export interface TableRow {
  cells: ReactNode[];
  state?: "new" | "bad" | "hit" | "dim" | "searching" | "best";
  note?: ReactNode;
  key?: string;
}
/** A small device table (ARP cache, MAC table, routing table, LSDB…). */
export function MiniTable({ title, cols, rows, empty = "(empty)", onPick, pick }: { title: string; cols: string[]; rows: TableRow[]; empty?: string; onPick?: (k: string) => void; pick?: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-pv-border bg-pv-bg/70 p-2">
      <p className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-pv-text-faint">{title}</p>
      <div className="mt-1 grid gap-x-2 border-b border-pv-border pb-0.5 text-[10px] text-pv-text-faint" style={{ gridTemplateColumns: `repeat(${cols.length}, minmax(0,1fr))` }}>
        {cols.map((c) => (
          <span key={c}>{c}</span>
        ))}
      </div>
      {rows.length === 0 ? (
        <p className="py-1 text-center pv-mono text-[12px] text-pv-text-faint">{empty}</p>
      ) : (
        rows.map((r, i) => {
          const k = r.key ?? String(i);
          return (
            <button
              key={k}
              type="button"
              disabled={!onPick}
              onClick={() => onPick?.(k)}
              className={clsx(
                "pv-pop grid w-full gap-x-2 rounded py-0.5 text-left pv-mono text-[11px] sm:text-[12.5px]",
                r.state === "new" ? "bg-pv-success/15 text-pv-text" : r.state === "bad" ? "bg-pv-danger/10 text-pv-danger" : r.state === "hit" ? "bg-pv-cyan/15 text-pv-text" : r.state === "best" ? "bg-pv-success/10 font-bold text-pv-text" : r.state === "dim" ? "text-pv-text-faint line-through" : r.state === "searching" ? "pv-pulse text-pv-warning" : "text-pv-text",
                pick === k && "ring-2 ring-pv-cyan",
                onPick && "cursor-pointer hover:bg-white/[0.05]",
              )}
              style={{ gridTemplateColumns: `repeat(${cols.length}, minmax(0,1fr))` }}
            >
              {r.cells.map((c, j) => (
                <span key={j} className="min-w-0 break-words">
                  {c}
                </span>
              ))}
              {r.note && <span className="col-span-full font-sans text-[10.5px] text-pv-text-muted">{r.note}</span>}
            </button>
          );
        })
      )}
    </div>
  );
}

export type ChainTone = "amber" | "green" | "cyan" | "violet" | "red" | "plain";
const CHAIN: Record<ChainTone, string> = {
  amber: "border-pv-warning/60 bg-pv-warning/10",
  green: "border-pv-success/60 bg-pv-success/10",
  cyan: "border-pv-cyan/60 bg-pv-cyan/10",
  violet: "border-pv-violet/60 bg-pv-violet/10",
  red: "border-pv-danger/60 bg-pv-danger/10",
  plain: "border-pv-border bg-pv-bg/60",
};
/** A vertical chain of steps that appear one after another. */
export function Chain({ items, k, horizontal }: { items: { t: ReactNode; tone?: ChainTone }[]; k: string; horizontal?: boolean }) {
  return (
    <ol key={k} className={clsx("mx-auto w-full", horizontal ? "flex flex-wrap items-center justify-center gap-1" : "max-w-md space-y-0.5")}>
      {items.map((it, i) => (
        <li key={i} className={clsx("pv-pop", horizontal ? "flex items-center gap-1" : "text-center")} style={{ animationDelay: `${i * 200}ms` }}>
          {i > 0 && <span className={clsx("text-[11px] leading-none text-pv-text-faint", horizontal ? "" : "block")}>{horizontal ? "→" : "↓"}</span>}
          <span className={clsx("inline-block rounded-lg border px-3 py-0.5 text-[12.5px] font-semibold text-pv-text sm:text-[14px]", CHAIN[it.tone ?? "plain"])}>{it.t}</span>
        </li>
      ))}
    </ol>
  );
}

/** Big statement lines revealed one after another. */
export function Lines({ k, lines, mono = true }: { k: string; lines: ReactNode[]; mono?: boolean }) {
  return (
    <div key={k} className="space-y-1.5 text-center">
      {lines.map((l, i) => (
        <p key={i} className={clsx("pv-pop font-bold text-pv-text text-[16px] sm:text-[21px]", mono && "pv-mono")} style={{ animationDelay: `${i * 450}ms` }}>
          {l}
        </p>
      ))}
    </div>
  );
}

/** Two (or more) side-by-side cards for "this vs that". */
export function Compare({ items }: { items: { title: ReactNode; tone: ChainTone; body: ReactNode }[] }) {
  return (
    <div className="pv-pop grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(items.length, 3)}, minmax(0,1fr))` }}>
      {items.map((it, i) => (
        <div key={i} className={clsx("rounded-xl border-2 p-2 text-center", CHAIN[it.tone])}>
          <p className="text-[11.5px] font-bold uppercase tracking-wide text-pv-text">{it.title}</p>
          <div className="mt-0.5 text-[12.5px] text-pv-text-muted sm:text-[13.5px]">{it.body}</div>
        </div>
      ))}
    </div>
  );
}

/** Small round control button row (e.g. Replay / choices). */
export function Pills<T extends string | number>({ options, value, onPick, label }: { options: { v: T; label: ReactNode }[]; value?: T; onPick: (v: T) => void; label?: string }) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-1.5" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.v)} type="button" aria-pressed={value === o.v} onClick={() => onPick(o.v)} className={clsx("rounded-full border px-3 py-1 text-[13px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-pv-cyan", value === o.v ? "border-pv-cyan bg-pv-cyan/20 text-pv-text" : "border-pv-border text-pv-text-muted hover:text-pv-text")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ReplayButton({ onClick, label = "↻ Replay" }: { onClick: () => void; label?: string }) {
  return (
    <div className="flex justify-center">
      <button type="button" onClick={onClick} className="rounded-full border border-pv-border px-3 py-1 text-[12.5px] font-semibold text-pv-text-muted hover:text-pv-text">
        {label}
      </button>
    </div>
  );
}

/** A labelled box with a single big value (e.g. a state, a counter). */
export function Stat({ k, v, tone = "plain", sub }: { k: ReactNode; v: ReactNode; tone?: ChainTone; sub?: ReactNode }) {
  return (
    <div className={clsx("rounded-xl border-2 px-2 py-1.5 text-center", CHAIN[tone])}>
      <p className="text-[10.5px] text-pv-text-faint">{k}</p>
      <p className="pv-mono text-[16px] font-bold text-pv-text sm:text-[20px]">{v}</p>
      {sub && <p className="text-[11px] text-pv-text-muted">{sub}</p>}
    </div>
  );
}
