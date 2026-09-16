import { clsx } from "clsx";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { Badge } from "@/components/ui/Badge";

export type RecoveryEventStatus = "healthy" | "failure" | "repair" | "info";

export interface RecoveryEvent {
  id: string;
  timeLabel: string;
  event: string;
  actor?: string;
  stage?: string;
  path?: string;
  status: RecoveryEventStatus;
  explanation?: string;
}

const STATUS_DOT: Record<RecoveryEventStatus, string> = {
  healthy: "border-pv-success bg-pv-success/20",
  failure: "border-pv-danger bg-pv-danger/20",
  repair: "border-pv-warning bg-pv-warning/20",
  info: "border-pv-cyan bg-pv-cyan/20",
};

/**
 * Generic simulated event timeline — {event, actor, stage, path,
 * status, explanation} rows, no idea what FRR, BGP, or HA mean. Built
 * for this lesson's local-repair recovery sequence, but the same
 * schema fits an IGP convergence timeline, a BGP failover sequence, or
 * an SR protection event log later. Always labeled by the caller as a
 * "PacketVerse simulated event timeline" — never implying a claimed
 * real-world timing guarantee.
 */
export function RecoveryTimelineViewer({ title = "PacketVerse Simulated Event Timeline", events }: { title?: string; events: RecoveryEvent[] }) {
  return (
    <GlassPanel className="p-4">
      <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-pv-text-muted">{title}</h4>
      <div className="space-y-0">
        {events.map((e, i) => (
          <div key={e.id} className="relative pl-4">
            {i < events.length - 1 && <span className="absolute left-[7px] top-6 h-full w-px bg-pv-border" />}
            <div className="flex flex-wrap items-center gap-2 py-1.5">
              <span className={clsx("h-3.5 w-3.5 shrink-0 rounded-full border", STATUS_DOT[e.status])} />
              <span className="pv-mono text-[10px] font-semibold text-pv-text-faint">{e.timeLabel}</span>
              <span className="text-xs text-pv-text">{e.event}</span>
              {e.actor && <Badge tone="cyan">{e.actor}</Badge>}
              {e.stage && <span className="pv-mono text-[10px] text-pv-text-faint">{e.stage}</span>}
            </div>
            {(e.path || e.explanation) && (
              <div className="mb-1.5 ml-6 space-y-0.5">
                {e.path && <p className="pv-mono text-[11px] text-pv-cyan-soft">{e.path}</p>}
                {e.explanation && <p className="text-[11px] text-pv-text-muted">{e.explanation}</p>}
              </div>
            )}
          </div>
        ))}
      </div>
    </GlassPanel>
  );
}
