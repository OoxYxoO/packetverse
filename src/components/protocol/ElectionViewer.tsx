import { clsx } from "clsx";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { Badge } from "@/components/ui/Badge";

export interface ElectionCandidate {
  id: string;
  label: string;
  value: string;
  available?: boolean;
}

/**
 * Generic election-result viewer (brief §42) — candidates, the
 * criteria/algorithm used, a winner, and a plain-language reason. It
 * has no idea what a Designated Forwarder is; the same shape fits a
 * BGP best-path winner, an OSPF DR/BDR election, or any future
 * active/standby decision. Built for DF election here.
 */
export interface ElectionRoleOverride {
  label: string;
  tone?: "success" | "warning" | "muted";
}

export function ElectionViewer({
  title,
  scope,
  algorithm,
  candidates,
  winnerId,
  reason,
  roleFor,
}: {
  title: string;
  scope?: string;
  algorithm: string;
  candidates: ElectionCandidate[];
  winnerId?: string;
  reason: string;
  /** Override the default single-winner Winner/Not-Selected/Unavailable badge per candidate — for elections with more than one outcome role (e.g. Single-Active's Primary + Backup), rather than a plain winner-take-one result. Candidates with no override fall back to the default winner logic. */
  roleFor?: (candidate: ElectionCandidate) => ElectionRoleOverride | undefined;
}) {
  return (
    <GlassPanel strong className="space-y-3 p-4">
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-pv-violet">{title}</h4>
        {scope && <p className="pv-mono text-[11px] text-pv-text-faint">{scope}</p>}
      </div>
      <p className="pv-mono text-[11px] text-pv-text-muted">
        Election algorithm: <span className="text-pv-text">{algorithm}</span>
      </p>
      <div className="space-y-1.5">
        {candidates.map((c) => {
          const override = roleFor?.(c);
          const isWinner = c.id === winnerId;
          const unavailable = c.available === false;
          const highlighted = override ? override.tone === "success" : !unavailable && isWinner;
          return (
            <div key={c.id} className={clsx("flex items-center justify-between rounded-lg border px-3 py-1.5 pv-mono text-[11px]", unavailable ? "border-pv-border opacity-50" : highlighted ? "border-pv-success/50 bg-pv-success/5" : "border-pv-border")}>
              <span className={clsx("font-semibold", unavailable ? "text-pv-text-faint" : "text-pv-text")}>{c.label}</span>
              <span className="text-pv-text-faint">{c.value}</span>
              {override ? (
                <Badge tone={override.tone ?? "muted"}>{override.label}</Badge>
              ) : unavailable ? (
                <Badge tone="muted">Unavailable</Badge>
              ) : isWinner ? (
                <Badge tone="success">Winner</Badge>
              ) : (
                <Badge tone="muted">Not Selected</Badge>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-pv-text-muted">{reason}</p>
    </GlassPanel>
  );
}
