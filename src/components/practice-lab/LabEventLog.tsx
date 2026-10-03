"use client";

import { clsx } from "clsx";

export interface LabLogEntry {
  id: string | number;
  /** Stage/order tag, e.g. "T1" — event ORDER, never a fake wall-clock time. */
  tag: string;
  text: string;
  /** "learn" entries are emphasised (state was learned/changed). */
  kind?: "learn" | "info" | "warning";
}

/** Collapsible, ordered evidence of what happened in the lab. The lesson decides what is worth logging (no UI noise). */
export function LabEventLog({ entries, title = "Event Log" }: { entries: LabLogEntry[]; title?: string }) {
  return (
    <details className="rounded-xl border border-pv-border p-2.5">
      <summary className="cursor-pointer text-[11.5px] font-semibold text-pv-text-muted outline-none hover:text-pv-text focus-visible:text-pv-cyan-soft">
        {title} ({entries.length})
      </summary>
      <ol className="mt-2 space-y-1 pv-mono text-[10.5px]">
        {entries.map((ev) => (
          <li key={ev.id} className="flex gap-2">
            <span className="shrink-0 text-pv-cyan-soft">{ev.tag}</span>
            <span className={clsx("min-w-0", ev.kind === "learn" ? "text-pv-success" : ev.kind === "warning" ? "text-pv-warning" : "text-pv-text-muted")}>{ev.text}</span>
          </li>
        ))}
      </ol>
    </details>
  );
}
