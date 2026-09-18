import { GlassPanel } from "@/components/ui/GlassPanel";

export interface Srv6CompressionMetricsData {
  originalSegmentCount: number;
  compressedContainerCount: number;
  originalSegmentBytes: number;
  compressedSegmentBytes: number;
  savedBytes: number;
  percentageReduction: number;
}

/**
 * Generic compression-metrics viewer — presentation only. Every number
 * is computed by the scenario layer's calculateCompressionMetrics();
 * this component never recomputes a byte count itself. Deliberately
 * labeled "segment-value storage" throughout, never "total packet
 * size" — outer IPv6/SRH-base/TLV overhead is a separate accounting.
 */
export function Srv6CompressionMetricsViewer({ title = "Segment-Value Storage Comparison", data }: { title?: string; data: Srv6CompressionMetricsData }) {
  return (
    <GlassPanel className="p-4">
      <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-pv-text-muted">{title}</h4>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-lg border border-pv-border p-2.5">
          <p className="text-[9px] uppercase tracking-wide text-pv-text-faint">Uncompressed</p>
          <p className="pv-mono text-sm font-semibold text-pv-text">{data.originalSegmentCount} SIDs</p>
          <p className="text-[10px] text-pv-text-faint">{data.originalSegmentBytes} bytes</p>
        </div>
        <div className="rounded-lg border border-pv-cyan/40 bg-pv-cyan/5 p-2.5">
          <p className="text-[9px] uppercase tracking-wide text-pv-cyan-soft">Compressed</p>
          <p className="pv-mono text-sm font-semibold text-pv-text">{data.compressedContainerCount} entries</p>
          <p className="text-[10px] text-pv-text-faint">{data.compressedSegmentBytes} bytes</p>
        </div>
        <div className="rounded-lg border border-pv-border p-2.5">
          <p className="text-[9px] uppercase tracking-wide text-pv-text-faint">Saved</p>
          <p className="pv-mono text-sm font-semibold text-pv-text">{data.savedBytes} bytes</p>
        </div>
        <div className="rounded-lg border border-pv-border p-2.5">
          <p className="text-[9px] uppercase tracking-wide text-pv-text-faint">Reduction</p>
          <p className="pv-mono text-sm font-semibold text-pv-text">{data.percentageReduction}%</p>
        </div>
      </div>
      <p className="mt-2 text-[10px] text-pv-text-faint">Segment-value storage only — outer IPv6 header, SRH base fields, and any TLVs are accounted separately.</p>
    </GlassPanel>
  );
}
