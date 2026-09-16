"use client";

import { useState } from "react";
import { clsx } from "clsx";
import { GlassPanel } from "@/components/ui/GlassPanel";

export interface StateInfo {
  meaning: string;
  why: string;
  next: string;
}

interface ProtocolStateMachineProps {
  /** Canonical state order, e.g. ["DOWN","INIT",...,"FULL"] or TCP's CLOSED..ESTABLISHED. */
  states: string[];
  /** Human label per state, if different from the raw key (e.g. TWO_WAY -> "2-WAY"). */
  labels?: Record<string, string>;
  current: string;
  descriptions?: Record<string, StateInfo>;
  title?: string;
  /**
   * Explicit list of states actually traversed so far, current
   * included (e.g. BGP legitimately skips ACTIVE on a first-try TCP
   * connect). When omitted, "passed" is inferred from index order —
   * correct for state machines with no conditional skips (OSPF).
   */
  visited?: string[];
}

/**
 * Reusable protocol state-machine visualizer — deliberately generic
 * (not named after OSPF) so it can drive OSPF neighbor states today
 * and BGP, IS-IS, STP, LACP or TCP state machines later without
 * modification. Past states render as passed/success, the current
 * state glows, future states stay dim. Clicking any state (past,
 * current, or future) shows its meaning/why/next explanation — this
 * is pure presentation over data the caller supplies; it holds no
 * protocol logic itself.
 */
export function ProtocolStateMachine({ states, labels, current, descriptions, title, visited }: ProtocolStateMachineProps) {
  const [selected, setSelected] = useState<string>(current);
  // Follow the live state by default; a manual click still overrides
  // this until the next state change, so exploration never fights the
  // simulation, it just resets to "what's happening now" as it moves.
  // (Adjusting state during render, per React's own guidance, instead
  // of an effect — avoids the extra render pass a useEffect would add.)
  const [trackedCurrent, setTrackedCurrent] = useState(current);
  if (current !== trackedCurrent) {
    setTrackedCurrent(current);
    setSelected(current);
  }
  const currentIndex = states.indexOf(current);
  const visitedSet = visited ? new Set(visited) : null;
  const info = descriptions?.[selected];

  return (
    <GlassPanel className="p-4">
      {title && <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-pv-text-muted">{title}</h4>}
      <div className="flex flex-col gap-1.5">
        {states.map((state, i) => {
          const isCurrent = state === current;
          const isPast = visitedSet ? visitedSet.has(state) && !isCurrent : i < currentIndex;
          const isSelected = state === selected;
          return (
            <button
              key={state}
              type="button"
              onClick={() => setSelected(state)}
              className={clsx(
                "flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-xs pv-mono transition-colors",
                isCurrent && "border-pv-cyan/50 bg-pv-cyan/10 text-pv-cyan animate-glow",
                isPast && !isCurrent && "border-pv-success/40 bg-pv-success/5 text-pv-success",
                !isPast && !isCurrent && "border-pv-border text-pv-text-faint hover:border-pv-border-strong",
                isSelected && !isCurrent && "ring-1 ring-pv-cyan-soft/40",
              )}
            >
              <span className="w-4 text-center">{isPast || isCurrent ? "✓" : "○"}</span>
              {labels?.[state] ?? state}
            </button>
          );
        })}
      </div>

      {info && (
        <div className="mt-3 space-y-2 rounded-lg border border-pv-border bg-black/20 p-3 text-[11px]">
          <p>
            <span className="font-semibold text-pv-text">{labels?.[selected] ?? selected}: </span>
            <span className="text-pv-text-muted">{info.meaning}</span>
          </p>
          <p className="text-pv-text-faint">
            <span className="text-pv-cyan-soft">Why: </span>
            {info.why}
          </p>
          <p className="text-pv-text-faint">
            <span className="text-pv-cyan-soft">Next: </span>
            {info.next}
          </p>
        </div>
      )}
    </GlassPanel>
  );
}
