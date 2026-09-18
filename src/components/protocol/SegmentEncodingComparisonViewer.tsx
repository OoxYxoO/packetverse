import { GlassPanel } from "@/components/ui/GlassPanel";
import { Badge } from "@/components/ui/Badge";

export interface SegmentEncodingComparisonRow {
  architecture: string;
  instructionCount: number;
  instructionBytes: number;
  outerHeaderBytes: number;
  extensionHeaderBytes: number;
  modeledTotalOverhead: number;
  notes: string;
}

/**
 * Generic segment-instruction-storage comparison table — presentation
 * only. Every number is computed by the calling scenario layer (e.g.
 * srMplsVsSrv6.ts's compareArchitectures()/computeCsidLab()); this
 * component never recomputes a byte count itself. Reusable by any
 * future lesson comparing N segment-routing encodings on instruction
 * count/bytes and modeled overhead, not specific to SR-MPLS or SRv6.
 */
export function SegmentEncodingComparisonViewer({ title = "Segment Encoding Comparison", rows }: { title?: string; rows: SegmentEncodingComparisonRow[] }) {
  return (
    <GlassPanel className="p-4">
      <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-pv-text-muted">{title}</h4>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-[11px]">
          <thead>
            <tr className="border-b border-pv-border text-pv-text-faint">
              <th className="py-1.5 pr-3 font-medium uppercase tracking-wide">Architecture</th>
              <th className="py-1.5 pr-3 font-medium uppercase tracking-wide">Instructions</th>
              <th className="py-1.5 pr-3 font-medium uppercase tracking-wide">Instruction Bytes</th>
              <th className="py-1.5 pr-3 font-medium uppercase tracking-wide">Outer Header</th>
              <th className="py-1.5 pr-3 font-medium uppercase tracking-wide">Extension Header</th>
              <th className="py-1.5 pr-3 font-medium uppercase tracking-wide">Modeled Total</th>
              <th className="py-1.5 font-medium uppercase tracking-wide">Notes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.architecture} className="border-b border-pv-border/50 align-top">
                <td className="py-1.5 pr-3">
                  <Badge tone="cyan">{r.architecture}</Badge>
                </td>
                <td className="py-1.5 pr-3 pv-mono text-pv-text">{r.instructionCount}</td>
                <td className="py-1.5 pr-3 pv-mono text-pv-text">{r.instructionBytes} B</td>
                <td className="py-1.5 pr-3 pv-mono text-pv-text-muted">{r.outerHeaderBytes} B</td>
                <td className="py-1.5 pr-3 pv-mono text-pv-text-muted">{r.extensionHeaderBytes} B</td>
                <td className="py-1.5 pr-3 pv-mono font-semibold text-pv-text">{r.modeledTotalOverhead} B</td>
                <td className="py-1.5 text-pv-text-faint">{r.notes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[10px] text-pv-text-faint">Instruction bytes only cover the segment list/label stack itself — modeled total additionally includes outer encapsulation and extension-header overhead, never conflated into one number.</p>
    </GlassPanel>
  );
}
