"use client";

import { useEffect, useRef } from "react";
import { clsx } from "clsx";

export interface HopTimelineEntry {
  id: string;
  label: string;
}

interface HopTimelineProps {
  hops: HopTimelineEntry[];
  /** Index of the hop currently being inspected — defaults to the last (most recent) hop. */
  currentIndex?: number;
  onSelectHop?: (index: number) => void;
}

/**
 * Bottom hop timeline for Focus Mode (brief §14/§22). Deliberately only
 * ever shown hops that have already happened (the lesson's own
 * `journey`/hop log) — there is no "upcoming" placeholder, since a
 * lesson has no future-hop data to hand it without leaking a
 * prediction question's answer (brief §47/§53's anti-spoiler rule is
 * satisfied structurally, not by a flag in this component).
 */
export function HopTimeline({ hops, currentIndex, onSelectHop }: HopTimelineProps) {
  const current = currentIndex ?? hops.length - 1;
  const scrollerRef = useRef<HTMLDivElement>(null);
  const currentRef = useRef<HTMLButtonElement>(null);

  // A long journey scrolls horizontally instead of compressing chips, so
  // keep the current chip visible as it advances. Only the timeline's own
  // scroller moves, and only when the chip is actually out of view — a
  // manual scroll is never fought on re-render.
  useEffect(() => {
    const scroller = scrollerRef.current;
    const chip = currentRef.current;
    if (!scroller || !chip) return;
    const s = scroller.getBoundingClientRect();
    const c = chip.getBoundingClientRect();
    if (c.left < s.left) scroller.scrollLeft -= s.left - c.left + 8;
    else if (c.right > s.right) scroller.scrollLeft += c.right - s.right + 8;
  }, [current, hops.length]);

  if (hops.length === 0) {
    return <p className="text-center text-[11px] text-pv-text-faint">No hops yet — advance the lesson to begin the packet journey.</p>;
  }

  return (
    <div ref={scrollerRef} className="flex items-center gap-1 overflow-x-auto px-1 py-1">
      {hops.map((h, i) => {
        const state = i < current ? "completed" : i === current ? "current" : "upcoming";
        return (
          <div key={h.id} className="flex shrink-0 items-center gap-1">
            {i > 0 && <span className={clsx("h-px w-4 shrink-0", state === "upcoming" ? "bg-pv-border" : "bg-pv-success/50")} />}
            <button
              ref={i === current ? currentRef : undefined}
              type="button"
              onClick={() => onSelectHop?.(i)}
              disabled={!onSelectHop}
              className={clsx(
                "shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 pv-mono text-[11px] font-semibold transition-colors",
                state === "current" && "border-pv-cyan bg-pv-cyan/15 text-pv-cyan-soft",
                state === "completed" && "border-pv-success/40 bg-pv-success/10 text-pv-success hover:border-pv-success/70",
                state === "upcoming" && "border-pv-border text-pv-text-faint",
                onSelectHop && state !== "current" && "cursor-pointer",
              )}
              aria-label={`Inspect hop ${i + 1}: ${h.label}`}
            >
              {i + 1} {h.label}
            </button>
          </div>
        );
      })}
    </div>
  );
}
