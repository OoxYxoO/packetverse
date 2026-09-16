import { clsx } from "clsx";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { Badge } from "@/components/ui/Badge";

export type ReflectionRelationship = "client" | "non-client";

export interface ReflectionCandidateRow {
  id: string;
  label: string;
  relationship: ReflectionRelationship;
  decision: "reflect" | "withhold";
  reason: string;
}

interface ReflectionDecisionViewerProps {
  title?: string;
  receivedFromLabel: string;
  receivedFromRelationship: ReflectionRelationship;
  candidates: ReflectionCandidateRow[];
}

/**
 * Reusable Reflection Decision Viewer (brief §8) — entirely data-driven:
 * every row is a candidate outbound peer the caller computed from the
 * ACTUAL reflection-rule engine (see `evaluateReflection`/
 * `reflectionCandidatesFor` in the scenario file), never a router name
 * hardcoded into this component. Shows, for each candidate, whether it
 * is a client or non-client and why the RR does or doesn't reflect to
 * it — the same shape works for a single RR or an N-router design.
 */
export function ReflectionDecisionViewer({ title, receivedFromLabel, receivedFromRelationship, candidates }: ReflectionDecisionViewerProps) {
  return (
    <GlassPanel strong className="p-4">
      {title && <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-pv-text-muted">{title}</h4>}
      <div className="mb-3 flex items-center gap-2 text-xs">
        <span className="text-pv-text-faint">Received from:</span>
        <span className="pv-mono font-semibold text-pv-text">{receivedFromLabel}</span>
        <Badge tone={receivedFromRelationship === "client" ? "cyan" : "muted"}>{receivedFromRelationship === "client" ? "Client" : "Non-Client"}</Badge>
      </div>
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-pv-text-faint">Candidate Outbound Peers</p>
      <div className="space-y-1.5">
        {candidates.map((c) => (
          <div key={c.id} className={clsx("rounded-lg border p-2.5 text-xs", c.decision === "reflect" ? "border-pv-success/40 bg-pv-success/5" : "border-pv-border opacity-70")}>
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5">
                <span className="pv-mono font-semibold text-pv-text">{c.label}</span>
                <Badge tone={c.relationship === "client" ? "cyan" : "muted"}>{c.relationship === "client" ? "Client" : "Non-Client"}</Badge>
              </span>
              <Badge tone={c.decision === "reflect" ? "success" : "danger"}>{c.decision === "reflect" ? "REFLECT" : "WITHHOLD"}</Badge>
            </div>
            <p className="text-pv-text-faint">{c.reason}</p>
          </div>
        ))}
        {candidates.length === 0 && <p className="text-xs text-pv-text-faint">No other RR sessions to evaluate yet.</p>}
      </div>
    </GlassPanel>
  );
}
