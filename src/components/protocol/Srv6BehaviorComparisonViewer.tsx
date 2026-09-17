import { GlassPanel } from "@/components/ui/GlassPanel";
import { Badge } from "@/components/ui/Badge";

export interface BehaviorComparisonRow {
  behavior: string;
  family: "TOPOLOGICAL" | "SERVICE";
  advancesSegment: boolean;
  decapsulates: boolean;
  payload: string;
  forwardingAction: string;
  associatedParameter: string;
  mustBeFinal: boolean;
}

/**
 * Generic SRv6 endpoint-behavior comparison table (RFC 8986) — every
 * row is handed in already computed by the scenario layer. Holds no
 * dispatch/processing logic of its own; it never decides what a
 * behavior does, only renders the comparison it's given.
 */
export function Srv6BehaviorComparisonViewer({ title = "Endpoint Behavior Comparison", rows }: { title?: string; rows: BehaviorComparisonRow[] }) {
  return (
    <GlassPanel className="overflow-x-auto p-4">
      <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-pv-text-muted">{title}</h4>
      <table className="w-full min-w-[820px] pv-mono text-[11px]">
        <thead>
          <tr className="text-left text-[9px] uppercase tracking-wide text-pv-text-faint">
            <th className="pb-1.5 pr-3">Behavior</th>
            <th className="pb-1.5 pr-3">Family</th>
            <th className="pb-1.5 pr-3">Advances Segment?</th>
            <th className="pb-1.5 pr-3">Decapsulates?</th>
            <th className="pb-1.5 pr-3">Payload</th>
            <th className="pb-1.5 pr-3">Forwarding Action</th>
            <th className="pb-1.5 pr-3">Parameter</th>
            <th className="pb-1.5">Must Be Final?</th>
          </tr>
        </thead>
        <tbody className="[&>tr]:border-t [&>tr]:border-pv-border">
          {rows.map((r) => (
            <tr key={r.behavior}>
              <td className="py-1.5 pr-3 font-semibold text-pv-text">{r.behavior}</td>
              <td className="py-1.5 pr-3">
                <Badge tone={r.family === "TOPOLOGICAL" ? "cyan" : "violet"}>{r.family}</Badge>
              </td>
              <td className="py-1.5 pr-3 text-pv-text-muted">{r.advancesSegment ? "Yes" : "No"}</td>
              <td className="py-1.5 pr-3 text-pv-text-muted">{r.decapsulates ? "Yes" : "No"}</td>
              <td className="py-1.5 pr-3 text-pv-text-muted">{r.payload}</td>
              <td className="py-1.5 pr-3 text-pv-cyan-soft">{r.forwardingAction}</td>
              <td className="py-1.5 pr-3 text-pv-text-faint">{r.associatedParameter}</td>
              <td className="py-1.5">{r.mustBeFinal ? <Badge tone="warning">Final</Badge> : <span className="text-pv-text-faint">—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </GlassPanel>
  );
}
