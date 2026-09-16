import { clsx } from "clsx";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { Badge } from "@/components/ui/Badge";

export interface PolicyCandidateRow {
  id: string;
  name: string;
  type: "EXPLICIT" | "DYNAMIC";
  preference: number;
  valid: boolean;
  reason: string;
  segmentSummary: string;
  active: boolean;
}

interface PolicyViewerProps {
  policyKey: string;
  headend: string;
  color: number | string;
  colorLabel?: string;
  endpoint: string;
  state: string;
  bindingSid?: number;
  activeCandidateName?: string;
  steeringState?: string;
  candidates: PolicyCandidateRow[];
}

const STATE_TONE: Record<string, "success" | "warning" | "danger" | "muted" | "cyan"> = {
  UP: "success",
  DOWN: "danger",
  NO_VALID_CANDIDATE: "danger",
  RESOLVING: "warning",
};

/**
 * Generic SR Policy viewer — identity tuple, state, BSID, and every
 * candidate path with its own preference/validity/segment summary.
 * Contains no SR protocol decisions itself: which candidate is active,
 * whether each is valid, and what its segment list looks like are all
 * handed in already computed by the domain layer.
 */
export function PolicyViewer({ policyKey, headend, color, colorLabel, endpoint, state, bindingSid, activeCandidateName, steeringState, candidates }: PolicyViewerProps) {
  return (
    <GlassPanel strong className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-pv-violet">SR Policy {policyKey}</h4>
          <p className="pv-mono text-[11px] text-pv-text-faint">
            Headend {headend} · Color {color}
            {colorLabel && ` (${colorLabel})`} · Endpoint {endpoint}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {bindingSid !== undefined && (
            <span className="pv-mono text-[10px] text-pv-text-faint">
              BSID <span className="text-pv-cyan-soft">{bindingSid}</span>
            </span>
          )}
          <Badge tone={STATE_TONE[state] ?? "muted"}>{state}</Badge>
        </div>
      </div>

      {(activeCandidateName || steeringState) && (
        <div className="flex flex-wrap gap-4 border-y border-pv-border py-2 text-[11px]">
          {activeCandidateName && (
            <span className="text-pv-text-muted">
              Active: <span className="pv-mono text-pv-cyan-soft">{activeCandidateName}</span>
            </span>
          )}
          {steeringState && (
            <span className="text-pv-text-muted">
              Steering: <span className="pv-mono text-pv-text">{steeringState}</span>
            </span>
          )}
        </div>
      )}

      <div className="space-y-2">
        {candidates.map((c) => (
          <div key={c.id} className={clsx("rounded-lg border px-3 py-2.5 text-xs transition-colors", c.active ? "border-pv-success/50 bg-pv-success/5 pv-glow-success" : c.valid ? "border-pv-border" : "border-pv-danger/40 bg-pv-danger/5 opacity-70")}>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={c.type === "EXPLICIT" ? "cyan" : "violet"}>{c.type}</Badge>
              <span className="pv-mono font-semibold text-pv-text">{c.name}</span>
              <span className="pv-mono text-[10px] text-pv-text-faint">pref {c.preference}</span>
              <Badge tone={c.valid ? "success" : "danger"}>{c.valid ? "VALID" : "INVALID"}</Badge>
              {c.active && <Badge tone="success">ACTIVE</Badge>}
              {!c.active && c.valid && <Badge tone="muted">STANDBY</Badge>}
            </div>
            <p className="mt-1 text-[11px] text-pv-text-muted">{c.reason}</p>
            <p className="mt-1 pv-mono text-[11px] text-pv-text-faint">{c.segmentSummary}</p>
          </div>
        ))}
      </div>
    </GlassPanel>
  );
}
