import { clsx } from "clsx";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { Badge } from "@/components/ui/Badge";

export interface SidTableRow {
  prefix?: string;
  router?: string;
  sidType: "NODE" | "ADJ";
  sidIndex?: number;
  localLabel: number;
  algorithm?: string;
  scope: "GLOBAL" | "LOCAL";
  owner?: string;
  nextHop?: string;
  meaning?: string;
  installed?: boolean;
}

interface SidTableViewerProps {
  title?: string;
  rows: SidTableRow[];
  srgb?: { start: number; end: number };
}

/**
 * Generic SID database viewer — prefix/router, SID type, index, derived
 * local label, algorithm, scope, owner, next hop, installed. No SR
 * decision logic lives here; every field is handed in already computed.
 * Optionally shows the SRGB the labels were derived from (brief §44
 * permits folding SRGB display in here instead of a separate viewer).
 */
export function SidTableViewer({ title = "SID Database", rows, srgb }: SidTableViewerProps) {
  const showAlgorithm = rows.some((r) => r.algorithm !== undefined);
  return (
    <GlassPanel className="p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-pv-text-muted">{title}</h4>
        {srgb && (
          <span className="pv-mono text-[10px] text-pv-text-faint">
            SRGB: {srgb.start}-{srgb.end}
          </span>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full pv-mono text-[11px]">
          <thead>
            <tr className="text-left text-[9px] uppercase tracking-wide text-pv-text-faint">
              <th className="pb-1.5 pr-3">Prefix / Meaning</th>
              {showAlgorithm && <th className="pb-1.5 pr-3">Algorithm</th>}
              <th className="pb-1.5 pr-3">Type</th>
              <th className="pb-1.5 pr-3">Index</th>
              <th className="pb-1.5 pr-3">Label</th>
              <th className="pb-1.5 pr-3">Scope</th>
              <th className="pb-1.5 pr-3">Owner</th>
              <th className="pb-1.5">Next Hop</th>
            </tr>
          </thead>
          <tbody className="[&>tr]:border-t [&>tr]:border-pv-border">
            {rows.map((r, i) => (
              <tr key={i} className={clsx(r.installed === false && "opacity-50")}>
                <td className="py-1.5 pr-3 text-pv-text">{r.prefix ?? r.meaning ?? "—"}</td>
                {showAlgorithm && <td className="py-1.5 pr-3 text-pv-text-muted">{r.algorithm ?? "—"}</td>}
                <td className="py-1.5 pr-3">
                  <Badge tone={r.sidType === "NODE" ? "cyan" : "violet"}>{r.sidType}</Badge>
                </td>
                <td className="py-1.5 pr-3 text-pv-text-muted">{r.sidIndex ?? "—"}</td>
                <td className="py-1.5 pr-3 font-semibold text-pv-text">{r.localLabel}</td>
                <td className="py-1.5 pr-3">
                  <Badge tone={r.scope === "GLOBAL" ? "success" : "warning"}>{r.scope}</Badge>
                </td>
                <td className="py-1.5 pr-3 text-pv-text-muted">{r.owner ?? "—"}</td>
                <td className="py-1.5 text-pv-cyan-soft">{r.nextHop ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </GlassPanel>
  );
}
