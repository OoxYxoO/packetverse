import { useState } from "react";
import { clsx } from "clsx";
import { GlassPanel } from "@/components/ui/GlassPanel";

export interface RepairComputationStage {
  id: string;
  label: string;
  value: string;
  explanation: string;
}

/**
 * Generic clickable computation-pipeline viewer — an ordered list of
 * {label, value, explanation} stages. Knows nothing about P-Space,
 * Q-Space, or SR; built for TI-LFA's failure→post-convergence→P-Space→
 * Q-Space→PQ→repair-list pipeline, but the same shape fits any other
 * "here is the chain of derived values that produced this result"
 * concept later (CSPF's own constraint chain, a best-path decision
 * chain, ...). Holds no computation logic — every value is handed in
 * already derived.
 */
export function RepairComputationViewer({ title = "Repair Computation", stages }: { title?: string; stages: RepairComputationStage[] }) {
  const [activeId, setActiveId] = useState(stages[0]?.id);
  const active = stages.find((s) => s.id === activeId) ?? stages[0];

  return (
    <GlassPanel className="space-y-3 p-4">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-pv-text-muted">{title}</h4>
      <div className="flex flex-wrap items-center gap-1.5">
        {stages.map((s, i) => (
          <div key={s.id} className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setActiveId(s.id)}
              className={clsx(
                "rounded-lg border px-2.5 py-1.5 text-left transition-colors",
                s.id === active?.id ? "border-pv-cyan/50 bg-pv-cyan/10 pv-glow-cyan" : "border-pv-border hover:border-pv-cyan/30",
              )}
            >
              <p className="text-[10px] font-semibold uppercase tracking-wide text-pv-text-faint">{s.label}</p>
              <p className="pv-mono text-xs text-pv-text">{s.value}</p>
            </button>
            {i < stages.length - 1 && <span className="text-pv-text-faint">→</span>}
          </div>
        ))}
      </div>
      {active && (
        <div className="rounded-lg border border-pv-border bg-black/20 p-3">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">{active.label}</p>
          <p className="text-xs text-pv-text-muted">{active.explanation}</p>
        </div>
      )}
    </GlassPanel>
  );
}
