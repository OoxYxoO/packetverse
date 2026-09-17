import { clsx } from "clsx";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { Badge } from "@/components/ui/Badge";

export interface Srv6PolicySegmentRow {
  ordinal: number;
  sid: string;
  owner: string;
  behavior: string;
  purpose: string;
  verified?: boolean;
}

/**
 * Generic SRv6 segment-list viewer for SR Policy — ordinal, SID, owner,
 * behavior, purpose, and (optional) SR-Database verification, in
 * TRAVEL order. Deliberately a different shape from the MPLS-centric
 * SegmentListViewer (numeric label, NODE/ADJ type, GLOBAL/LOCAL scope
 * — none of which apply to an SRv6 SID). Holds no candidate-selection
 * or path-computation logic; every row is handed in already resolved.
 */
export function Srv6PolicySegmentListViewer({ title = "Segment List (Travel Order)", segments }: { title?: string; segments: Srv6PolicySegmentRow[] }) {
  if (segments.length === 0) {
    return (
      <GlassPanel className="p-4">
        <p className="text-xs text-pv-text-faint">No segment list resolved yet.</p>
      </GlassPanel>
    );
  }
  return (
    <GlassPanel className="p-4">
      <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-pv-text-muted">{title}</h4>
      <div className="space-y-1.5">
        {segments.map((s) => (
          <div key={s.ordinal} className="rounded-lg border border-pv-border px-3 py-2 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="pv-mono text-[10px] text-pv-text-faint">#{s.ordinal + 1}</span>
              <span className="pv-mono break-all font-semibold text-pv-text">{s.sid}</span>
              <Badge tone="violet">{s.behavior}</Badge>
              <span className="pv-mono text-[10px] text-pv-text-faint">owner: {s.owner}</span>
              {s.verified !== undefined && <Badge tone={s.verified ? "success" : "danger"}>{s.verified ? "VERIFIED" : "NOT VERIFIED"}</Badge>}
            </div>
            <p className={clsx("mt-1 text-[11px] text-pv-text-muted")}>{s.purpose}</p>
          </div>
        ))}
      </div>
    </GlassPanel>
  );
}
