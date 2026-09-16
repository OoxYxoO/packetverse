import { Fragment } from "react";
import { clsx } from "clsx";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { Badge } from "@/components/ui/Badge";

export interface RouteEvolutionField {
  label: string;
  oldValue: string;
  newValue: string;
  /** True when this specific field is WHY the new route won (e.g. a higher sequence, a higher local-pref, a lower DF priority) — highlighted distinctly from fields that merely stayed the same. */
  decisive?: boolean;
}

/**
 * Generic before/after route-comparison viewer (brief §29) — accepts
 * plain {label, oldValue, newValue} rows and a plain-language reason;
 * it has no idea what "mobility sequence" or "EVPN" mean. Built for
 * MAC Mobility here, but the same shape fits a BGP best-path change,
 * an OSPF route replacement, or a DF election outcome later — pass
 * whatever fields matter for that comparison.
 */
export function RouteEvolutionViewer({ title, oldLabel = "OLD", newLabel = "NEW", fields, winnerReason }: { title: string; oldLabel?: string; newLabel?: string; fields: RouteEvolutionField[]; winnerReason: string }) {
  return (
    <GlassPanel strong className="space-y-3 p-4">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-pv-violet">{title}</h4>
      <div className="grid grid-cols-[auto_1fr_1fr] gap-x-3 gap-y-1.5 pv-mono text-[11px]">
        <span />
        <span className="text-center text-[10px] font-semibold uppercase tracking-wide text-pv-text-faint">{oldLabel}</span>
        <span className="text-center text-[10px] font-semibold uppercase tracking-wide text-pv-success">{newLabel}</span>
        {fields.map((f) => (
          <Fragment key={f.label}>
            <span className="text-pv-text-faint">{f.label}</span>
            <span className={clsx("rounded px-1.5 py-0.5 text-center", f.decisive ? "bg-pv-danger/10 text-pv-danger" : "text-pv-text-muted")}>{f.oldValue}</span>
            <span className={clsx("rounded px-1.5 py-0.5 text-center", f.decisive ? "bg-pv-success/10 text-pv-success font-semibold" : "text-pv-text")}>{f.newValue}</span>
          </Fragment>
        ))}
      </div>
      <div className="flex items-center justify-center gap-2 border-t border-pv-border pt-2.5">
        <Badge tone="success">{newLabel} ROUTE WINS</Badge>
        <span className="text-[11px] text-pv-text-muted">{winnerReason}</span>
      </div>
    </GlassPanel>
  );
}
