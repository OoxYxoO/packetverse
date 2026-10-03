"use client";

import { clsx } from "clsx";

export interface LiveStateRow {
  key: string;
  primary: string;
  secondary?: string;
  /** Learned/changed by the latest event — highlighted with "+" and "Learned this step". */
  fresh?: boolean;
  /** Optional "Why?" explanation, owned by the lesson. */
  why?: string;
}

/**
 * One compact live-state table (an ARP cache, a MAC table, an LFIB, a
 * neighbor list, …) rendered from lab-engine rows. The card pulses once
 * when the latest event changed it; fresh rows are marked. The schema is
 * the lesson's — this only knows "rows with a key".
 */
export function LiveStateCard({
  title,
  caption,
  rows,
  pulseKey,
  openWhy,
  onWhy,
  empty = "EMPTY",
  whyHeading,
}: {
  title: string;
  /** Tiny type cue, e.g. "IP → MAC", "MAC → PORT". */
  caption?: string;
  rows: LiveStateRow[];
  /** Changes per event (e.g. the transmission id) so the pulse replays; undefined = no pulse. */
  pulseKey?: string | number;
  openWhy?: string;
  onWhy?: (id: string | undefined) => void;
  empty?: string;
  /** Heading above an opened explanation; defaults to "Why?". */
  whyHeading?: string;
}) {
  const changed = rows.some((r) => r.fresh);
  return (
    <section key={changed ? `pulse-${pulseKey}` : "steady"} className={clsx("min-w-0 rounded-xl border bg-white/[0.02] p-2.5 transition-colors", changed ? "pv-lab-card-pulse border-pv-success/50" : "border-pv-border")} aria-label={`${title} table`}>
      <style>{`@keyframes pv-lab-flash { 0%,100% { box-shadow: 0 0 0 0 rgba(16,185,129,0); } 30% { box-shadow: 0 0 0 4px rgba(16,185,129,.35); } } .pv-lab-flash { animation: pv-lab-flash 1.2s ease-out 2; } @keyframes pv-lab-card { 0% { box-shadow: 0 0 0 0 rgba(16,185,129,0); } 25% { box-shadow: 0 0 18px 2px rgba(16,185,129,.45); } 100% { box-shadow: 0 0 0 0 rgba(16,185,129,0); } } .pv-lab-card-pulse { animation: pv-lab-card 1.6s ease-out 1; } @media (prefers-reduced-motion: reduce) { .pv-lab-flash, .pv-lab-card-pulse { animation: none; } }`}</style>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <h4 className="text-[11px] font-bold text-pv-text">{title}</h4>
        {caption && <span className="pv-mono text-[9.5px] font-semibold tracking-wide text-pv-text-faint">{caption}</span>}
      </div>
      {rows.length === 0 ? (
        <p className="pv-mono text-[11px] text-pv-text-faint">{empty}</p>
      ) : (
        <ul className="space-y-1">
          {rows.map((r) => {
            const id = `${title}:${r.key}`;
            return (
              <li key={`${id}:${r.fresh ? pulseKey : "old"}`} className={clsx("rounded-md px-1.5 py-1", r.fresh ? "pv-lab-flash bg-pv-success/10 ring-1 ring-pv-success/40" : "bg-black/20")}>
                <div className="flex items-start justify-between gap-1">
                  <div className="min-w-0 pv-mono text-[10.5px] leading-tight">
                    <p className="truncate text-pv-text">
                      {r.fresh && <span className="text-pv-success">+ </span>}
                      {r.primary}
                    </p>
                    {r.secondary && <p className="truncate text-pv-cyan-soft">{r.secondary}</p>}
                  </div>
                  {r.why && onWhy && (
                    <button
                      type="button"
                      aria-expanded={openWhy === id}
                      aria-label={`Why does ${title} have ${r.primary}?`}
                      onClick={() => onWhy(openWhy === id ? undefined : id)}
                      className="shrink-0 rounded px-1 text-[10px] font-semibold text-pv-text-faint hover:text-pv-cyan-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-pv-cyan"
                    >
                      Why?
                    </button>
                  )}
                </div>
                {r.fresh && <p className="mt-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-pv-success">Learned this step</p>}
                {r.why && openWhy === id && (
                  <p className="mt-1 border-l-2 border-pv-cyan/40 pl-1.5 text-[10.5px] leading-snug text-pv-text-muted">
                    <span className="block font-semibold text-pv-cyan-soft">{whyHeading ?? "Why?"}</span>
                    {r.why}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
