import { GlassPanel } from "@/components/ui/GlassPanel";

export interface BeforeAfterMetric {
  label: string;
  before: string | number;
  after: string | number;
  /** True when the after value is the desired/improved one — colors it success instead of a neutral tone. Defaults to true. */
  improved?: boolean;
}

/**
 * Generic before/after counter comparison (brief §30) — plain
 * {label, before, after} rows, no idea what a VXLAN replica or an
 * EVPN route is. Built for ARP suppression's replica-count dashboard
 * here; the same shape fits a full-mesh-vs-RR session count, a
 * convergence-time improvement, or any other "here's the number
 * before, here's the number after" comparison later.
 */
export function BeforeAfterMetrics({ title, beforeLabel = "BEFORE", afterLabel = "AFTER", metrics }: { title: string; beforeLabel?: string; afterLabel?: string; metrics: BeforeAfterMetric[] }) {
  return (
    <GlassPanel strong className="p-4">
      <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-pv-text-muted">{title}</h4>
      <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 gap-y-1.5 pv-mono text-[11px]">
        <span />
        <span className="text-center text-[10px] font-semibold uppercase tracking-wide text-pv-text-faint">{beforeLabel}</span>
        <span className="text-center text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">{afterLabel}</span>
        {metrics.map((m) => (
          <div key={m.label} className="contents">
            <span className="text-pv-text-faint">{m.label}</span>
            <span className="text-center text-pv-text-muted">{m.before}</span>
            <span className={`text-center font-semibold ${m.improved === false ? "text-pv-text" : "text-pv-success"}`}>{m.after}</span>
          </div>
        ))}
      </div>
    </GlassPanel>
  );
}
