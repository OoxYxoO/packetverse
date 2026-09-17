import { GlassPanel } from "@/components/ui/GlassPanel";
import { Badge } from "@/components/ui/Badge";

export interface ArchitectureComparisonRow {
  architecture: string;
  serviceType: string;
  discovery: string;
  signaling: string;
  macReachability: string;
  bum: string;
  splitHorizon: string;
  multihomingModel: string;
  accessHierarchy: string;
  highlighted?: boolean;
}

/**
 * Generic architecture-comparison table — plain rows in, plain table
 * out. Knows nothing about VPWS, VPLS, BGP-VPLS, H-VPLS, or EVPN; every
 * cell is handed in already computed by the scenario layer (per
 * ARCHITECTURE.md's rule: no comparison logic lives in this component
 * or anywhere under network3d/*). Reusable by any future lesson that
 * needs to compare N architectures/protocols side by side on a fixed
 * set of properties.
 */
export function ArchitectureComparisonViewer({ title = "Architecture Comparison", rows }: { title?: string; rows: ArchitectureComparisonRow[] }) {
  const columns: { key: keyof ArchitectureComparisonRow; label: string }[] = [
    { key: "serviceType", label: "Service Type" },
    { key: "discovery", label: "Discovery" },
    { key: "signaling", label: "Signaling" },
    { key: "macReachability", label: "MAC Reachability" },
    { key: "bum", label: "BUM" },
    { key: "splitHorizon", label: "Split Horizon" },
    { key: "multihomingModel", label: "Multihoming Model" },
    { key: "accessHierarchy", label: "Access Hierarchy" },
  ];
  return (
    <GlassPanel className="overflow-x-auto p-4">
      <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-pv-text-muted">{title}</h4>
      {rows.length === 0 ? (
        <p className="pv-mono text-xs text-pv-text-faint">No architectures to compare.</p>
      ) : (
        <table className="w-full min-w-[900px] border-collapse text-left text-[11px]">
          <thead>
            <tr className="border-b border-pv-border">
              <th className="sticky left-0 bg-transparent py-2 pr-3 text-pv-text-faint uppercase tracking-wide">Architecture</th>
              {columns.map((c) => (
                <th key={c.key} className="py-2 pr-3 text-pv-text-faint uppercase tracking-wide">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.architecture} className="border-b border-pv-border/60 align-top">
                <td className="py-2 pr-3">
                  <Badge tone={r.highlighted ? "cyan" : "muted"}>{r.architecture}</Badge>
                </td>
                {columns.map((c) => (
                  <td key={c.key} className="py-2 pr-3 pv-mono text-pv-text">
                    {String(r[c.key] ?? "")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </GlassPanel>
  );
}
