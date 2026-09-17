import { clsx } from "clsx";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { Badge } from "@/components/ui/Badge";

export interface CandidateSelectionRow {
  id: string;
  name: string;
  preference: number;
  valid: boolean;
  reason: string;
  active: boolean;
}

/**
 * Generic candidate-selection PIPELINE viewer — configured candidates
 * → validate → remove invalid → compare preference among survivors →
 * active candidate. Deliberately separate from PolicyViewer (which
 * shows the policy's current, already-decided snapshot): this
 * component visualizes the DECISION PROCESS itself. No domain logic
 * lives here — validity and preference are handed in already computed.
 */
export function CandidateSelectionViewer({ title = "Candidate Selection", candidates }: { title?: string; candidates: CandidateSelectionRow[] }) {
  const sorted = [...candidates].sort((a, b) => b.preference - a.preference);
  return (
    <GlassPanel strong className="space-y-3 p-4">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-pv-violet">{title}</h4>
      <div className="grid gap-2 sm:grid-cols-2">
        {sorted.map((c) => (
          <div key={c.id} className={clsx("rounded-xl border p-3 text-xs", c.valid ? "border-pv-border" : "border-pv-danger/40 bg-pv-danger/5 opacity-80")}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="pv-mono font-semibold text-pv-text">{c.name}</span>
              <span className="pv-mono text-[10px] text-pv-text-faint">pref {c.preference}</span>
              <Badge tone={c.valid ? "success" : "danger"}>{c.valid ? "VALID" : "INVALID"}</Badge>
              {c.valid ? <span className="pv-mono text-pv-text-faint">✓</span> : <span className="pv-mono text-pv-danger">✕</span>}
            </div>
            <p className="mt-1 text-[11px] text-pv-text-muted">{c.reason}</p>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-center gap-2 border-t border-pv-border pt-3 text-[11px] text-pv-text-faint">
        <span>highest preference among VALID</span>
        <span>→</span>
      </div>
      <div className="flex justify-center">
        {(() => {
          const active = sorted.find((c) => c.active);
          return active ? (
            <div className="rounded-xl border border-pv-success/50 bg-pv-success/10 px-4 py-2 text-center pv-glow-success">
              <p className="text-[9px] font-semibold uppercase tracking-wide text-pv-success">Active Candidate</p>
              <p className="pv-mono text-sm font-bold text-pv-text">{active.name}</p>
            </div>
          ) : (
            <div className="rounded-xl border border-pv-danger/50 bg-pv-danger/10 px-4 py-2 text-center">
              <p className="text-[9px] font-semibold uppercase tracking-wide text-pv-danger">No Valid Candidate</p>
            </div>
          );
        })()}
      </div>
    </GlassPanel>
  );
}
