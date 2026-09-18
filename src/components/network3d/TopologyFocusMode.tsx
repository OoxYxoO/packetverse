"use client";

import { useEffect, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";

interface TopologyFocusModeProps {
  onClose: () => void;
  /** Top toolbar: view switch, camera presets, X-ray, etc. — supplied by the page, since capability varies per lesson (brief §15). */
  toolbar?: ReactNode;
  /** Thin strip below the toolbar for "what's happening right now" context (current step label/narrative, question-pending notice) — so the learner never has to leave Focus Mode to know what they're looking at (brief §8). Purely optional; a lesson with nothing to say here can omit it. */
  header?: ReactNode;
  /** The large 2D/3D canvas itself. */
  canvas: ReactNode;
  /** <HopInspectorPanel>/<PacketDiffViewer>/Device Explorer — whatever the lesson has ready. */
  inspector?: ReactNode;
  /** <HopTimeline> + <PacketFlowControls>. */
  timeline?: ReactNode;
}

/**
 * Large in-app topology workspace (brief §13/§14) — an in-app
 * modal/workspace (~95vw × ~90vh), not a hard requirement on the
 * browser Fullscreen API. Opening/closing never touches ScenarioEngine
 * state, camera state, or selection state — it is purely a layout
 * change over the same page (brief §13/§40: "Do not lose lesson step,
 * ScenarioEngine snapshot, packet state, camera target, selected node
 * on open/close"). Escape closes it (brief §34).
 *
 * The whole point of this component (per the UX correction brief) is
 * that it must be a SELF-CONTAINED packet-learning workspace: topology
 * + context header + traffic controls + hop inspector + before/after +
 * timeline all live inside here, so a learner never needs to close it
 * to understand what just happened at the current hop.
 */
export function TopologyFocusMode({ onClose, toolbar, header, canvas, inspector, timeline }: TopologyFocusModeProps) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-2 sm:p-4" role="dialog" aria-modal="true" aria-label="Topology Focus Mode">
      <div className="flex h-[92vh] w-full max-w-[96vw] flex-col overflow-hidden rounded-2xl border border-pv-border bg-pv-bg-elevated shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-pv-border px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-2">{toolbar}</div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close Focus Mode">
            ✕ Close
          </Button>
        </div>

        {header && <div className="shrink-0 border-b border-pv-border bg-white/[0.02] px-4 py-2">{header}</div>}

        {/* Desktop target ~70-78% topology / ~22-30% inspector (brief §18). */}
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <div className="min-h-0 flex-1 lg:basis-[72%]">{canvas}</div>
          {inspector && <div className="w-full shrink-0 overflow-y-auto border-t border-pv-border p-3 lg:w-[28%] lg:min-w-[320px] lg:max-w-[440px] lg:border-l lg:border-t-0">{inspector}</div>}
        </div>

        {timeline && <div className="shrink-0 border-t border-pv-border px-3 py-2">{timeline}</div>}
      </div>
    </div>
  );
}
