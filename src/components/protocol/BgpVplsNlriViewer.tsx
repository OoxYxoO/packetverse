import { GlassPanel } from "@/components/ui/GlassPanel";
import { Badge } from "@/components/ui/Badge";

/**
 * Generic RFC 4761 VPLS NLRI inspector — plain fields in, plain rows
 * out. Knows nothing about BGP best-path, RT import policy, or label
 * math; every value (including whether it was imported) is handed in
 * already computed by domain logic. Distinct from BgpUpdateCard
 * (ANNOUNCE/WITHDRAW in-flight semantics) — this is a persistent,
 * inspectable snapshot of one NLRI's content, e.g. inside a Device
 * Explorer tab or a BGP VPLS RIB table.
 */
export interface BgpVplsNlriFields {
  rd: string;
  veId: number;
  veBlockOffset: number;
  veBlockSize: number;
  labelBase: number;
  routeTargets: string[];
  nextHop: string;
  layer2Info: string;
  sourcePeer: string;
  imported?: boolean;
}

export function BgpVplsNlriViewer({ title = "VPLS NLRI", fields }: { title?: string; fields: BgpVplsNlriFields }) {
  return (
    <GlassPanel strong className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-pv-violet">{title}</h4>
        <div className="flex gap-1.5">
          <Badge tone="cyan">FROM {fields.sourcePeer}</Badge>
          {fields.imported !== undefined && <Badge tone={fields.imported ? "success" : "danger"}>{fields.imported ? "IMPORTED" : "NOT IMPORTED"}</Badge>}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 pv-mono text-[11px]">
        <span className="text-pv-text-faint">RD</span>
        <span className="text-pv-text">{fields.rd}</span>
        <span className="text-pv-text-faint">VE ID</span>
        <span className="text-pv-text">{fields.veId}</span>
        <span className="text-pv-text-faint">VE Block Offset</span>
        <span className="text-pv-text">{fields.veBlockOffset}</span>
        <span className="text-pv-text-faint">VE Block Size</span>
        <span className="text-pv-text">{fields.veBlockSize}</span>
        <span className="text-pv-text-faint">Label Base</span>
        <span className="font-semibold text-pv-cyan-soft">{fields.labelBase}</span>
        <span className="text-pv-text-faint">Route Target(s)</span>
        <span className="text-pv-text">{fields.routeTargets.join(", ")}</span>
        <span className="text-pv-text-faint">BGP Next Hop</span>
        <span className="text-pv-text">{fields.nextHop}</span>
        <span className="text-pv-text-faint">Layer2 Info</span>
        <span className="text-pv-text">{fields.layer2Info}</span>
      </div>
    </GlassPanel>
  );
}
