"use client";

import type { ReactNode } from "react";
import { clsx } from "clsx";

interface TopologyFrameProps {
  /** True while a prediction/question step is the current step and unanswered — drives the compact sticky "Question Context Mode" (brief §10/§11). */
  questionActive: boolean;
  onExpand?: () => void;
  children: ReactNode;
}

/**
 * Generic wrapper around a lesson's topology viewport (brief §9-§12).
 * It owns exactly two things: (1) making the viewport sticky-and-compact
 * on desktop while a prediction question is the current step, so the
 * learner never loses sight of the topology/packet while answering,
 * and (2) an "Expand" affordance into Focus Mode. It renders whatever
 * viewport (2D or 3D) is passed as `children` — no protocol knowledge,
 * no ScenarioEngine state of its own (brief §10: "Do not duplicate
 * ScenarioEngine state").
 */
export function TopologyFrame({ questionActive, onExpand, children }: TopologyFrameProps) {
  return (
    <div className={clsx("relative", questionActive && "lg:sticky lg:top-4 lg:z-20")}>
      <div className={clsx(questionActive && "lg:max-h-[46vh] lg:overflow-hidden lg:rounded-2xl lg:ring-1 lg:ring-pv-cyan/25")}>{children}</div>
      {onExpand && (
        <button
          type="button"
          onClick={onExpand}
          aria-label="Expand topology to Focus Mode"
          title="Expand"
          className="absolute right-3 top-3 z-30 flex items-center gap-1.5 rounded-full border border-pv-border bg-black/60 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-pv-text-faint backdrop-blur transition-colors hover:border-pv-cyan/50 hover:text-pv-cyan-soft"
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 3H3v6M15 3h6v6M9 21H3v-6M15 21h6v-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Expand
        </button>
      )}
    </div>
  );
}
