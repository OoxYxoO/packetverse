import type { ReactNode } from "react";

/**
 * The engineering workspace's mission bar: at any moment, what you are doing, what to look at, and your next action.
 * It is the first thing in the task panel, so the student never has to scan the screen to find the current task.
 */
export function MissionBar({ station, task, look, next }: { station: string; task: ReactNode; look: ReactNode; next: ReactNode }) {
  return (
    <div className="rounded-xl border border-pv-violet/50 bg-pv-violet/[0.07] px-3 py-2" role="status" aria-label="Current task">
      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-pv-violet">{station} · your task</p>
      <p className="text-[14.5px] font-semibold leading-snug text-pv-text">{task}</p>
      <div className="mt-1 grid gap-x-4 gap-y-0.5 text-[12.5px] sm:grid-cols-2">
        <p className="text-pv-text-muted">
          <b className="text-pv-text">Look at:</b> {look}
        </p>
        <p className="text-pv-text-muted">
          <b className="text-pv-cyan-soft">Next:</b> {next}
        </p>
      </div>
    </div>
  );
}
