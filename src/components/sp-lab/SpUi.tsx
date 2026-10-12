"use client";

import { clsx } from "clsx";
import type { ReactNode } from "react";

/** Small building blocks shared by every Service Provider lab (pills, cards, key/value rows, tabs, tables). */

export const Pill = ({ children, onClick, disabled, tone, title }: { children: ReactNode; onClick: () => void; disabled?: boolean; tone?: "primary" | "danger"; title?: string }) => (
  <button
    type="button"
    title={title}
    onClick={onClick}
    disabled={disabled}
    className={clsx(
      "rounded-full px-3 py-1 text-[12px] font-semibold disabled:opacity-40",
      tone === "primary" ? "bg-pv-cyan text-[#03131a] hover:bg-pv-cyan/90" : tone === "danger" ? "border border-pv-danger/60 text-pv-danger hover:bg-pv-danger/10" : "border border-pv-border text-pv-text-muted hover:text-pv-text",
    )}
  >
    {children}
  </button>
);

export function Card({ title, children, right }: { title: ReactNode; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="min-w-0 rounded-xl border border-pv-border bg-pv-bg/60 p-2">
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="text-[12px] font-semibold text-pv-text">{title}</p>
        {right}
      </div>
      {children}
    </section>
  );
}

export const Kv = ({ k, v, tone }: { k: ReactNode; v: ReactNode; tone?: "warn" | "bad" | "ok" }) => (
  <div className="flex justify-between gap-3 border-b border-pv-border/50 py-1 text-[12.5px]">
    <span className="text-pv-text-muted">{k}</span>
    <span className={clsx("pv-mono text-right", tone === "bad" ? "text-pv-danger" : tone === "warn" ? "text-pv-warning" : tone === "ok" ? "text-pv-success" : "text-pv-text")}>{v}</span>
  </div>
);

export function Tabs<T extends string>({ tabs, cur, set, small }: { tabs: [T, string][]; cur: T; set: (t: T) => void; small?: boolean }) {
  return (
    <div role="tablist" className={clsx("flex flex-wrap gap-1", small ? "" : "border-b border-pv-border px-3 py-1.5")}>
      {tabs.map(([t, label]) => (
        <button key={t} type="button" role="tab" aria-selected={cur === t} onClick={() => set(t)} className={clsx("rounded-md px-2.5 py-1 font-semibold", small ? "text-[12px]" : "text-[12.5px]", cur === t ? "bg-pv-cyan/15 text-pv-text" : "text-pv-text-muted hover:text-pv-text")}>
          {label}
        </button>
      ))}
    </div>
  );
}

export type CellTone = "ok" | "bad" | "warn" | "faint" | "hi" | undefined;
const CELL: Record<string, string> = { ok: "text-pv-success", bad: "text-pv-danger", warn: "text-pv-warning", faint: "text-pv-text-faint", hi: "text-pv-cyan-soft font-semibold" };
/** A compact table; a cell can be text or [text, tone]. Scrolls sideways inside itself, never the page. */
export function STable({ cols, rows, empty = "(none)", mono = true }: { cols: string[]; rows: (ReactNode | [ReactNode, CellTone])[][]; empty?: string; mono?: boolean }) {
  return (
    <div className="max-w-full overflow-x-auto">
      <table className="w-full min-w-max text-left text-[12px]">
        <thead>
          <tr className="text-pv-text-faint">
            {cols.map((c) => (
              <th key={c} className="px-1.5 py-0.5 font-semibold">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className={mono ? "pv-mono" : undefined}>
          {rows.length === 0 && (
            <tr>
              <td colSpan={cols.length} className="px-1.5 py-1 text-pv-text-faint">
                {empty}
              </td>
            </tr>
          )}
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-pv-border/40">
              {r.map((c, j) => {
                const [v, t] = Array.isArray(c) && c.length === 2 && (typeof c[1] === "string" || c[1] === undefined) ? (c as [ReactNode, CellTone]) : [c as ReactNode, undefined];
                return (
                  <td key={j} className={clsx("px-1.5 py-0.5 align-top", t ? CELL[t] : "text-pv-text")}>
                    {v}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A line of the moment panel (what a device decided in this step of a run). */
export function MomentLine({ text, tone, delay }: { text: string; tone?: string; delay: number }) {
  return (
    <p className={clsx("pv-pop rounded-lg border px-2 py-1 text-[12.5px] text-pv-text", tone === "bad" ? "border-pv-danger/40 bg-pv-danger/[0.06]" : tone === "ok" ? "border-pv-success/40 bg-pv-success/[0.06]" : tone === "learn" ? "border-pv-violet/40 bg-pv-violet/[0.06]" : tone === "warn" ? "border-pv-warning/40 bg-pv-warning/[0.06]" : "border-pv-cyan/30 bg-pv-cyan/[0.04]")} style={{ animationDelay: `${delay}ms` }}>
      {text}
    </p>
  );
}
