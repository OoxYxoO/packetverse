import { GlassPanel } from "@/components/ui/GlassPanel";

export interface CsidFlavorComparisonRow {
  property: string;
  nextCsid: string;
  replaceCsid: string;
}

/**
 * Generic property-comparison table (property / NEXT-CSID / REPLACE-
 * CSID) — plain rows in, plain table out. No compression logic lives
 * here; every cell is handed in already computed by the scenario layer.
 */
export function CsidFlavorComparisonViewer({ title = "NEXT-CSID vs. REPLACE-CSID", rows }: { title?: string; rows: CsidFlavorComparisonRow[] }) {
  return (
    <GlassPanel className="overflow-x-auto p-4">
      <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-pv-text-muted">{title}</h4>
      <table className="w-full min-w-[560px] border-collapse text-left text-[11px]">
        <thead>
          <tr className="border-b border-pv-border">
            <th className="py-2 pr-3 text-pv-text-faint uppercase tracking-wide">Property</th>
            <th className="py-2 pr-3 text-pv-text-faint uppercase tracking-wide">NEXT-CSID</th>
            <th className="py-2 pr-3 text-pv-text-faint uppercase tracking-wide">REPLACE-CSID</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.property} className="border-b border-pv-border/60 align-top">
              <td className="py-2 pr-3 pv-mono text-pv-text-faint">{r.property}</td>
              <td className="py-2 pr-3 pv-mono text-pv-text">{r.nextCsid}</td>
              <td className="py-2 pr-3 pv-mono text-pv-text">{r.replaceCsid}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </GlassPanel>
  );
}
