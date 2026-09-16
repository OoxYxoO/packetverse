import { clsx } from "clsx";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { Badge } from "@/components/ui/Badge";

export interface DecisionCriterionValue {
  pathId: string;
  pathLabel: string;
  value: string;
  won: boolean;
}

export interface DecisionCriterion {
  id: string;
  label: string;
  values: DecisionCriterionValue[];
  /** False when this criterion was skipped entirely (e.g. MED between paths from different neighboring ASes). */
  applied: boolean;
  skippedReason?: string;
}

interface BestPathDecisionViewerProps {
  title?: string;
  criteria: DecisionCriterion[];
  decidedBy?: string;
  /** Plain-text caveat about vendor-specific extensions (e.g. Cisco Weight) — rendered as-is, not computed here. */
  vendorNote?: string;
}

/**
 * Ordered best-path attribute comparison (brief §10). The engine
 * decides the winner and which criterion decided it; this component
 * only lays out the criteria in order and highlights the deciding
 * one and the winning value at each step — no comparison logic here.
 */
export function BestPathDecisionViewer({ title, criteria, decidedBy, vendorNote }: BestPathDecisionViewerProps) {
  return (
    <GlassPanel strong className="p-4">
      {title && <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-pv-text-muted">{title}</h4>}
      <div className="space-y-2">
        {criteria.map((c, i) => {
          const isDecider = c.id === decidedBy;
          return (
            <div
              key={c.id}
              className={clsx(
                "rounded-lg border px-3 py-2.5 text-xs",
                isDecider ? "border-pv-cyan/50 bg-pv-cyan/5" : c.applied ? "border-pv-border" : "border-pv-border opacity-50",
              )}
            >
              <div className="mb-1 flex items-center justify-between">
                <span className="pv-mono text-[10px] font-semibold text-pv-text-faint">
                  {i + 1}. {c.label}
                </span>
                {isDecider && <Badge tone="cyan">Decided here</Badge>}
                {!c.applied && <Badge tone="muted">Skipped</Badge>}
              </div>
              {!c.applied && c.skippedReason ? (
                <p className="text-pv-text-faint">{c.skippedReason}</p>
              ) : (
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {c.values.map((v) => (
                    <span key={v.pathId} className={clsx("pv-mono", v.won ? "text-pv-success" : "text-pv-text-muted")}>
                      {v.won && "✓ "}
                      {v.pathLabel}: {v.value}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {vendorNote && <p className="mt-3 text-[10px] text-pv-text-faint">{vendorNote}</p>}
    </GlassPanel>
  );
}
