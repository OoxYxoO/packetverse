import { GlassPanel } from "@/components/ui/GlassPanel";
import { Badge } from "@/components/ui/Badge";
import { SegmentListViewer, type SegmentListRow } from "./SegmentListViewer";

/**
 * Thin, TI-LFA-specific wrapper around the generic SegmentListViewer —
 * adds the protected-resource/target/avoided header row the brief asks
 * for, but keeps all actual segment rendering in SegmentListViewer
 * itself (no duplicated rendering logic).
 */
export function RepairListViewer({
  title = "Repair Segment List",
  protectedResource,
  repairTarget,
  segments,
}: {
  title?: string;
  protectedResource: string;
  repairTarget?: string;
  segments: SegmentListRow[];
}) {
  return (
    <GlassPanel strong className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-pv-violet">{title}</h4>
        <div className="flex items-center gap-2 pv-mono text-[10px] text-pv-text-faint">
          <Badge tone="danger">AVOIDS {protectedResource}</Badge>
          {repairTarget && <span>target: {repairTarget}</span>}
        </div>
      </div>
      <SegmentListViewer title="Segment Rendering" segments={segments} />
    </GlassPanel>
  );
}
