import { clsx } from "clsx";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { Badge } from "@/components/ui/Badge";

export interface JourneyHopRow {
  router: string;
  action: string;
  output: string;
}

/**
 * Persistent hop-by-hop packet journey (brief §15) — a vertical log
 * of every forwarding decision made so far. Purely a renderer over a
 * list the scenario layer appends to; holds no forwarding logic.
 */
export function PacketJourneyTimeline({ hops, emptyLabel = "No hops recorded yet." }: { hops: JourneyHopRow[]; emptyLabel?: string }) {
  if (hops.length === 0) {
    return (
      <GlassPanel className="p-4">
        <p className="text-xs text-pv-text-faint">{emptyLabel}</p>
      </GlassPanel>
    );
  }

  return (
    <GlassPanel className="p-4">
      <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-pv-text-muted">Packet Journey</h4>
      <div className="space-y-0">
        {hops.map((h, i) => (
          <div key={i} className="relative pl-4">
            {i < hops.length - 1 && <span className="absolute left-[7px] top-6 h-full w-px bg-pv-border" />}
            <div className="flex items-center gap-2 py-1.5">
              <span className={clsx("h-3.5 w-3.5 shrink-0 rounded-full border", i === hops.length - 1 ? "border-pv-cyan bg-pv-cyan/20" : "border-pv-success/50 bg-pv-success/10")} />
              <span className="pv-mono text-xs font-semibold text-pv-text">{h.router}</span>
              <Badge tone="cyan">{h.action}</Badge>
              <span className="pv-mono text-[11px] text-pv-text-faint">{h.output}</span>
            </div>
          </div>
        ))}
      </div>
    </GlassPanel>
  );
}
