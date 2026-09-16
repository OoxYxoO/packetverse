import { GlassPanel } from "@/components/ui/GlassPanel";
import { Badge } from "@/components/ui/Badge";

/**
 * Generic Flex-Algo Definition (FAD) viewer — plain fields in, plain
 * rows out. Knows nothing about SPF, affinities as a concept, or
 * participation logic; every value is handed in already computed. Not
 * an SR Policy object renderer — deliberately its own shape (algorithm
 * id, metric type, include/exclude affinity, participation, selection
 * source) so it never gets confused with PolicyViewer.
 */
export function FlexAlgoDefinitionViewer({
  title = "Flex-Algo Definition",
  algorithm,
  metricType,
  includeAffinity,
  excludeAffinity,
  participation,
  selected = true,
  source,
}: {
  title?: string;
  algorithm: number;
  metricType: string;
  includeAffinity?: string;
  excludeAffinity?: string;
  participation: { router: string; participating: boolean }[];
  selected?: boolean;
  source?: string;
}) {
  return (
    <GlassPanel strong className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-pv-violet">{title}</h4>
        <div className="flex gap-1.5">
          <Badge tone="cyan">ALGORITHM {algorithm}</Badge>
          {selected && <Badge tone="success">SELECTED DEFINITION</Badge>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-1 pv-mono text-[11px]">
        <span className="text-pv-text-faint">Metric Type</span>
        <span className="text-pv-text">{metricType}</span>
        <span className="text-pv-text-faint">Include Affinity</span>
        <span className="text-pv-text">{includeAffinity ?? "none"}</span>
        <span className="text-pv-text-faint">Exclude Affinity</span>
        <span className="text-pv-text">{excludeAffinity ?? "none"}</span>
        {source && (
          <>
            <span className="text-pv-text-faint">Definition Source</span>
            <span className="text-pv-text">{source}</span>
          </>
        )}
      </div>

      <div>
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-text-faint">Participation</p>
        <div className="flex flex-wrap gap-1.5">
          {participation.map((p) => (
            <Badge key={p.router} tone={p.participating ? "success" : "danger"}>
              {p.router} {p.participating ? "IN" : "OUT"}
            </Badge>
          ))}
        </div>
      </div>
    </GlassPanel>
  );
}
