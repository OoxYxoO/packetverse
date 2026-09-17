import { GlassPanel } from "@/components/ui/GlassPanel";

export interface StateOwnershipRow {
  node: string;
  customerFdb: string;
  pwOrNlriState: string;
  evpnRoutes: string;
}

/**
 * Generic "who knows what" ownership matrix — plain rows in, plain
 * table out. Knows nothing about VPLS, BGP-VPLS, or EVPN; every cell
 * (✓ / ✕ / a short factual note) is handed in already computed by the
 * scenario layer. Deliberately renders whatever string each cell is
 * given rather than forcing a binary ✓/✕, since some cells are
 * genuinely "N/A" or "model-dependent" and forcing a binary would
 * overgeneralize past what a real deployment guarantees.
 */
export function StateOwnershipViewer({ title = "State Ownership", rows }: { title?: string; rows: StateOwnershipRow[] }) {
  return (
    <GlassPanel className="overflow-x-auto p-4">
      <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-pv-text-muted">{title}</h4>
      {rows.length === 0 ? (
        <p className="pv-mono text-xs text-pv-text-faint">No nodes to show.</p>
      ) : (
        <table className="w-full min-w-[640px] border-collapse text-left text-[11px]">
          <thead>
            <tr className="border-b border-pv-border">
              <th className="py-2 pr-3 text-pv-text-faint uppercase tracking-wide">Node</th>
              <th className="py-2 pr-3 text-pv-text-faint uppercase tracking-wide">Customer FDB</th>
              <th className="py-2 pr-3 text-pv-text-faint uppercase tracking-wide">PW / NLRI State</th>
              <th className="py-2 pr-3 text-pv-text-faint uppercase tracking-wide">EVPN Routes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.node} className="border-b border-pv-border/60 align-top">
                <td className="py-2 pr-3 text-pv-text">{r.node}</td>
                <td className="py-2 pr-3 pv-mono text-pv-text">{r.customerFdb}</td>
                <td className="py-2 pr-3 pv-mono text-pv-text">{r.pwOrNlriState}</td>
                <td className="py-2 pr-3 pv-mono text-pv-text">{r.evpnRoutes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </GlassPanel>
  );
}
