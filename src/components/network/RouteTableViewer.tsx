import { clsx } from "clsx";
import { GlassPanel } from "@/components/ui/GlassPanel";

interface Route {
  network: string;
  iface: string;
  note: string;
  matched?: boolean;
}

export function RouteTableViewer({ title, routes }: { title: string; routes: Route[] }) {
  return (
    <GlassPanel className="p-4">
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-pv-text-muted">{title} — Routing Table</h4>
      <table className="w-full text-left text-[11px]">
        <thead>
          <tr className="text-pv-text-faint">
            <th className="pb-1 font-normal">Network</th>
            <th className="pb-1 font-normal">Interface</th>
          </tr>
        </thead>
        <tbody className="pv-mono text-pv-text">
          {routes.map((r) => (
            <tr key={r.network} className={clsx("border-t border-pv-border", r.matched && "bg-pv-cyan/10")}>
              <td className="py-1.5">
                {r.matched && <span className="mr-1 text-pv-cyan">▶</span>}
                {r.network}
              </td>
              <td className="py-1.5 text-pv-cyan-soft">{r.iface}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </GlassPanel>
  );
}
