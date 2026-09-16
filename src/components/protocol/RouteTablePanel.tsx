import { GlassPanel } from "@/components/ui/GlassPanel";

interface RouteRow {
  destination: string;
  nextHop: string;
  cost: number;
  path: string[];
}

interface RouteTablePanelProps {
  title: string;
  routes: RouteRow[];
}

/** Generic link-state routing table viewer — cost + full path, not just next-hop. */
export function RouteTablePanel({ title, routes }: RouteTablePanelProps) {
  return (
    <GlassPanel className="p-4">
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-pv-text-muted">{title} — Routing Table</h4>
      {routes.length === 0 ? (
        <p className="pv-mono text-xs text-pv-text-faint">EMPTY</p>
      ) : (
        <table className="w-full text-left text-[11px]">
          <thead>
            <tr className="text-pv-text-faint">
              <th className="pb-1 font-normal">Dest</th>
              <th className="pb-1 font-normal">Next Hop</th>
              <th className="pb-1 font-normal">Cost</th>
              <th className="pb-1 font-normal">Path</th>
            </tr>
          </thead>
          <tbody className="pv-mono text-pv-text">
            {routes.map((r) => (
              <tr key={r.destination} className="border-t border-pv-border">
                <td className="py-1.5">{r.destination}</td>
                <td className="py-1.5 text-pv-cyan-soft">{r.nextHop}</td>
                <td className="py-1.5">{r.cost}</td>
                <td className="py-1.5 text-pv-text-faint">{r.path.join("→")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </GlassPanel>
  );
}
