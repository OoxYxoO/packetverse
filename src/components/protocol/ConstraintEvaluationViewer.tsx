import { clsx } from "clsx";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { Badge } from "@/components/ui/Badge";

export interface ConstraintCandidateRow {
  id: string;
  label: string;
  /** Column values in display order, e.g. [{label:"Available", value:"1000 Mbps"}, {label:"Required", value:"500 Mbps"}]. */
  columns: { label: string; value: string }[];
  pass: boolean;
  reason?: string;
}

/**
 * Generic constraint-filtering table: candidates → per-candidate
 * column values → pass/fail → an optional final result. Knows nothing
 * about CSPF, bandwidth, or RSVP — built for CSPF's "prune, then
 * shortest-path" table here, but the same shape fits any other
 * constraint-based candidate filtering (affinity-only checks, a
 * future SR policy's segment-list validation, ACL rule evaluation).
 */
export function ConstraintEvaluationViewer({
  title,
  constraintSummary,
  candidates,
  resultLabel,
  resultValue,
  resultPass,
}: {
  title: string;
  constraintSummary?: string;
  candidates: ConstraintCandidateRow[];
  resultLabel?: string;
  resultValue?: string;
  resultPass?: boolean;
}) {
  const columnLabels = candidates[0]?.columns.map((c) => c.label) ?? [];

  return (
    <GlassPanel strong className="space-y-3 p-4">
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-pv-violet">{title}</h4>
        {constraintSummary && <p className="pv-mono text-[11px] text-pv-text-faint">{constraintSummary}</p>}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full pv-mono text-[11px]">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wide text-pv-text-faint">
              <th className="pb-1.5 pr-3">Candidate</th>
              {columnLabels.map((c) => (
                <th key={c} className="pb-1.5 pr-3">
                  {c}
                </th>
              ))}
              <th className="pb-1.5">Result</th>
            </tr>
          </thead>
          <tbody>
            {candidates.map((row) => (
              <tr key={row.id} className={clsx("border-t border-pv-border", !row.pass && "opacity-70")} title={row.reason}>
                <td className="py-1.5 pr-3 text-pv-text">{row.label}</td>
                {row.columns.map((c) => (
                  <td key={c.label} className="py-1.5 pr-3 text-pv-text-muted">
                    {c.value}
                  </td>
                ))}
                <td className="py-1.5">
                  <span className={clsx("font-bold", row.pass ? "text-pv-success" : "text-pv-danger")}>{row.pass ? "PASS" : "FAIL"}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {resultLabel && (
        <div className="flex flex-wrap items-center gap-2 border-t border-pv-border pt-2.5">
          <Badge tone={resultPass === false ? "danger" : resultPass === true ? "success" : "muted"}>{resultLabel}</Badge>
          {resultValue && <span className="pv-mono text-xs text-pv-text">{resultValue}</span>}
        </div>
      )}
    </GlassPanel>
  );
}
