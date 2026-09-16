import { clsx } from "clsx";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { Badge } from "@/components/ui/Badge";

export interface SegmentListRow {
  order: number;
  sid: number;
  type: "NODE" | "ADJ";
  owner?: string;
  target: string;
  scope: "GLOBAL" | "LOCAL";
  active: boolean;
  completed: boolean;
  explanation: string;
}

/**
 * Generic segment-list viewer — order, SID, type, owner, target, scope,
 * active, completed, explanation. No path-computation logic lives here;
 * reusable later by SR-TE, SR Policy, or TI-LFA without change.
 */
export function SegmentListViewer({ title = "Segment List", segments }: { title?: string; segments: SegmentListRow[] }) {
  if (segments.length === 0) {
    return (
      <GlassPanel className="p-4">
        <p className="text-xs text-pv-text-faint">No segment list imposed yet.</p>
      </GlassPanel>
    );
  }
  return (
    <GlassPanel className="p-4">
      <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-pv-text-muted">{title}</h4>
      <div className="space-y-1.5">
        {segments.map((s) => (
          <div
            key={s.order}
            className={clsx(
              "rounded-lg border px-3 py-2 text-xs transition-colors",
              s.active ? "border-pv-cyan/50 bg-pv-cyan/10 pv-glow-cyan" : s.completed ? "border-pv-success/30 bg-pv-success/5 opacity-60" : "border-pv-border opacity-80",
            )}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="pv-mono text-[10px] text-pv-text-faint">#{s.order + 1}</span>
              <Badge tone={s.type === "NODE" ? "cyan" : "violet"}>{s.type} SID</Badge>
              <span className="pv-mono font-semibold text-pv-text">{s.sid}</span>
              <Badge tone={s.scope === "GLOBAL" ? "success" : "warning"}>{s.scope}</Badge>
              {s.owner && <span className="pv-mono text-[10px] text-pv-text-faint">owner: {s.owner}</span>}
              {s.active && <Badge tone="cyan">ACTIVE</Badge>}
              {s.completed && <Badge tone="success">DONE</Badge>}
            </div>
            <p className="mt-1 text-[11px] text-pv-text-muted">{s.explanation}</p>
          </div>
        ))}
      </div>
    </GlassPanel>
  );
}
