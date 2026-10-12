"use client";

import { clsx } from "clsx";
import type { ReactNode } from "react";
import { DECK_CSS, Mover } from "@/components/presentation/ScrollyDeck";
import { Token, type TopoView } from "@/components/presentation/Visuals";
import type { SpMoment } from "./spKit";

/**
 * The Service Provider lab stage: routers placed in percent of the stage, links drawn between them (with a state and
 * a label), optional overlay paths (an LSP, a tunnel, a VPN route's journey) and the messages of the current moment
 * travelling link by link. Fills its parent's height. The lesson decides what is drawn; the stage only draws it.
 */

export interface SpStageNode {
  id: string;
  label: string;
  sub?: string;
  /** Short role mark shown in the node ("PE", "P", "CE", "RR"). */
  role?: string;
  x: number;
  y: number;
  /** Positions on phones (falls back to x / y). */
  cx?: number;
  cy?: number;
  tone?: string;
}
export type SpLinkState = "up" | "down" | "active" | "blocked" | "dim" | "standby" | "off";
export interface SpStageLink {
  id: string;
  a: string;
  b: string;
  label?: string;
  state?: SpLinkState;
  /** Where the label sits along a → b (0…1). */
  at?: number;
}
export interface SpPath {
  id: string;
  nodes: string[];
  color: string;
  label?: string;
  dashed?: boolean;
  /** Perpendicular offset in stage percent (so two paths over one link stay apart). */
  offset?: number;
}
export interface SpRegion {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  color?: string;
}

const LINK: Record<SpLinkState, { c: string; w: number; dash?: string }> = {
  up: { c: "rgba(148,163,184,0.55)", w: 2 },
  active: { c: "#22d3ee", w: 3.5 },
  down: { c: "#f87171", w: 2, dash: "5 4" },
  blocked: { c: "#fbbf24", w: 2, dash: "2 4" },
  dim: { c: "rgba(148,163,184,0.2)", w: 1.5 },
  standby: { c: "#a78bfa", w: 2, dash: "6 4" },
  off: { c: "rgba(148,163,184,0.25)", w: 1.5, dash: "1 4" },
};
const BUBBLE: Record<string, string> = {
  ask: "border-pv-warning/60 bg-[#2a2006] text-pv-warning",
  no: "border-pv-border bg-pv-bg text-pv-text-muted",
  yes: "border-pv-success/60 bg-[#062417] text-pv-success",
  info: "border-pv-cyan/60 bg-[#06222a] text-pv-cyan-soft",
  bad: "border-pv-danger/60 bg-[#2a0b0b] text-pv-danger",
  warn: "border-pv-violet/60 bg-[#160f2a] text-pv-violet",
};
export const SP_TRAVEL_MS = 1100;

export function SpStage({
  nodes,
  links,
  paths = [],
  regions = [],
  views = {},
  moment,
  momentKey,
  compact,
  onNode,
  selected,
  children,
}: {
  nodes: SpStageNode[];
  links: SpStageLink[];
  paths?: SpPath[];
  regions?: SpRegion[];
  views?: Record<string, TopoView>;
  moment?: SpMoment<unknown>;
  /** Changes for every moment shown, so the moment's messages animate again. */
  momentKey: string;
  compact?: boolean;
  onNode?: (id: string) => void;
  selected?: string;
  children?: ReactNode;
}) {
  const pos = (id: string): [number, number] => {
    const n = nodes.find((x) => x.id === id);
    if (!n) return [50, 50];
    return compact ? [n.cx ?? n.x, n.cy ?? n.y] : [n.x, n.y];
  };
  const hot = new Set(moment?.hot ?? []);
  const bad = new Set(moment?.bad ?? []);
  const allViews: Record<string, TopoView> = { ...views, ...(moment?.views ?? {}) };
  const offsetPt = (a: [number, number], b: [number, number], off: number): [[number, number], [number, number]] => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const ox = (-dy / len) * off;
    const oy = (dx / len) * off;
    return [
      [a[0] + ox, a[1] + oy],
      [b[0] + ox, b[1] + oy],
    ];
  };
  return (
    <div className="relative h-full w-full overflow-hidden">
      <style>{DECK_CSS}</style>
      {regions.map((r) => (
        <div key={r.label} className="absolute rounded-2xl border border-dashed" style={{ left: `${r.x}%`, top: `${r.y}%`, width: `${r.w}%`, height: `${r.h}%`, borderColor: `color-mix(in srgb, ${r.color ?? "#22d3ee"} 45%, transparent)`, background: `color-mix(in srgb, ${r.color ?? "#22d3ee"} 5%, transparent)` }}>
          <span className="absolute left-2 top-1 text-[10px] font-semibold sm:text-[11.5px]" style={{ color: r.color ?? "#67e8f9" }}>
            {r.label}
          </span>
        </div>
      ))}
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
        {links.map((l) => {
          const st = LINK[bad.has(l.id) ? "down" : hot.has(l.id) ? "active" : (l.state ?? "up")];
          const [x1, y1] = pos(l.a);
          const [x2, y2] = pos(l.b);
          return <line key={l.id} x1={x1} y1={y1} x2={x2} y2={y2} stroke={st.c} strokeWidth={st.w} strokeDasharray={st.dash} vectorEffect="non-scaling-stroke" className="transition-[stroke] duration-500" />;
        })}
        {paths.map((p) =>
          p.nodes.slice(1).map((n, i) => {
            const [a, b] = offsetPt(pos(p.nodes[i]), pos(n), p.offset ?? 0);
            return <line key={`${p.id}-${i}`} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={p.color} strokeWidth={4} strokeOpacity={0.75} strokeDasharray={p.dashed ? "6 4" : undefined} strokeLinecap="round" vectorEffect="non-scaling-stroke" />;
          }),
        )}
      </svg>
      {links
        .filter((l) => l.label && !compact)
        .map((l) => {
          const [x1, y1] = pos(l.a);
          const [x2, y2] = pos(l.b);
          const t = l.at ?? 0.5;
          return (
            <span key={`lbl-${l.id}`} className={clsx("absolute z-10 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded bg-pv-bg/90 px-1 pv-mono text-[10px] sm:text-[10.5px]", l.state === "down" || bad.has(l.id) ? "text-pv-danger" : "text-pv-text-muted")} style={{ left: `${x1 + (x2 - x1) * t}%`, top: `${y1 + (y2 - y1) * t}%` }}>
              {l.label}
            </span>
          );
        })}
      {paths
        .filter((p) => p.label)
        .map((p) => {
          const a = pos(p.nodes[0]);
          return (
            <span key={`pl-${p.id}`} className="absolute z-10 -translate-y-1/2 whitespace-nowrap rounded px-1 text-[10px] font-bold" style={{ left: `${Math.min(80, a[0] + 2)}%`, top: `${a[1] + (p.offset ?? 0) * 2 + 7}%`, color: p.color }}>
              {p.label}
            </span>
          );
        })}
      {nodes.map((n) => {
        const v = allViews[n.id] ?? {};
        const [x, y] = pos(n.id);
        return (
          <div key={n.id} className={clsx("absolute -translate-x-1/2 -translate-y-1/2 transition-opacity duration-500", v.bubble ? "z-30" : "z-10", v.ring === "dim" && "opacity-40")} style={{ left: `clamp(30px, ${x}%, calc(100% - 30px))`, top: `${y}%` }}>
            <div
              role={onNode ? "button" : undefined}
              tabIndex={onNode ? 0 : undefined}
              aria-label={onNode ? `Open ${n.label}` : undefined}
              aria-pressed={onNode ? selected === n.id : undefined}
              onClick={onNode ? () => onNode(n.id) : undefined}
              onKeyDown={onNode ? (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onNode(n.id)) : undefined}
              className={clsx(
                "relative flex min-w-[54px] flex-col items-center rounded-xl border-2 bg-pv-bg px-1.5 py-0.5 text-center leading-tight transition-[border-color,box-shadow] duration-500 sm:min-w-[80px] sm:px-2 sm:py-1",
                onNode && "cursor-pointer hover:border-pv-cyan/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-pv-cyan",
                onNode && selected === n.id && "outline outline-2 outline-offset-2 outline-pv-violet",
                v.ring === "target" ? "border-pv-success shadow-[0_0_18px_rgba(52,211,153,0.6)]" : v.ring === "hit" ? "border-pv-warning shadow-[0_0_14px_rgba(251,191,36,0.5)]" : v.ring === "on" ? "border-pv-cyan shadow-[0_0_14px_rgba(34,211,238,0.5)]" : v.ring === "bad" ? "border-pv-danger shadow-[0_0_14px_rgba(248,113,113,0.5)]" : "border-pv-border",
              )}
            >
              {n.role && (
                <span className="text-[9px] font-bold uppercase tracking-wide sm:text-[10px]" style={{ color: n.tone ?? "#67e8f9" }}>
                  {n.role}
                </span>
              )}
              <span className="text-[11px] font-bold text-pv-text sm:text-[12.5px]">{n.label}</span>
              {n.sub && <span className="pv-mono text-[9px] text-pv-text-muted sm:text-[10.5px]">{n.sub}</span>}
              {v.badge && <span className={clsx("absolute -right-2 -top-2 whitespace-nowrap rounded-full border px-1.5 text-[9.5px] font-bold sm:text-[10.5px]", BUBBLE[v.badge.tone])}>{v.badge.text}</span>}
            </div>
            {v.bubble && (
              <span className={clsx("pv-pop absolute bottom-full z-30 mb-1 w-max max-w-[40vw] rounded-lg border px-1.5 py-0.5 text-[10px] font-semibold leading-tight sm:max-w-[260px] sm:text-[11.5px]", x > 70 ? "right-0" : x < 30 ? "left-0" : "left-1/2 -translate-x-1/2", BUBBLE[v.bubble.tone])} style={{ animationDelay: `${v.bubble.delay ?? 0}ms` }}>
                {v.bubble.text}
              </span>
            )}
          </div>
        );
      })}
      {moment?.tokens.map((t, i) => {
        const [fa, fb] = offsetPt(pos(t.from), pos(t.to), t.lane ?? 0);
        const dx = fb[0] - fa[0];
        const dy = fb[1] - fa[1];
        const len = Math.hypot(dx, dy) || 1;
        const k = Math.min(9, len / 2) / len;
        const stop: [number, number] = t.stay ? [fb[0] - dx * k, fb[1] - dy * k] : fb;
        return (
          <Mover key={`${momentKey}-${i}`} from={fa} to={stop} delay={t.delay} duration={SP_TRAVEL_MS} stay={t.stay}>
            <Token color={t.color ?? "cyan"}>{t.label}</Token>
          </Mover>
        );
      })}
      {children}
    </div>
  );
}
