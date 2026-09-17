import { clsx } from "clsx";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { Badge } from "@/components/ui/Badge";

export interface LocalSidRow {
  sid: string;
  locator: string;
  functionText: string;
  behavior: string;
  owner: string;
  state: "ACTIVE" | "MISSING";
  parameters?: string;
}

/**
 * Generic SRv6 Local SID Table viewer — the per-node table that binds a
 * specific SID to a behavior (RFC 8986). Deliberately a different shape
 * from SidTableViewer (SR-MPLS's label-indexed SID database): there is
 * no MPLS label, no SRGB, no algorithm here — just SID, locator,
 * function, behavior, owner, state, and behavior-specific parameters.
 * No lookup/binding logic lives here; every row is handed in already
 * computed.
 */
export function LocalSidTableViewer({ title = "Local SID Table", rows }: { title?: string; rows: LocalSidRow[] }) {
  return (
    <GlassPanel className="p-4">
      <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-pv-text-muted">{title}</h4>
      {rows.length === 0 ? (
        <p className="text-xs text-pv-text-faint">No local SIDs instantiated at this router.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full pv-mono text-[11px]">
            <thead>
              <tr className="text-left text-[9px] uppercase tracking-wide text-pv-text-faint">
                <th className="pb-1.5 pr-3">SID</th>
                <th className="pb-1.5 pr-3">Locator</th>
                <th className="pb-1.5 pr-3">Function</th>
                <th className="pb-1.5 pr-3">Behavior</th>
                <th className="pb-1.5 pr-3">Owner</th>
                <th className="pb-1.5 pr-3">State</th>
                <th className="pb-1.5">Parameters</th>
              </tr>
            </thead>
            <tbody className="[&>tr]:border-t [&>tr]:border-pv-border">
              {rows.map((r) => (
                <tr key={r.sid} className={clsx(r.state === "MISSING" && "opacity-60")}>
                  <td className="py-1.5 pr-3 font-semibold text-pv-text">{r.sid}</td>
                  <td className="py-1.5 pr-3 text-pv-text-muted">{r.locator}</td>
                  <td className="py-1.5 pr-3 text-pv-cyan-soft">{r.functionText}</td>
                  <td className="py-1.5 pr-3">
                    <Badge tone="violet">{r.behavior}</Badge>
                  </td>
                  <td className="py-1.5 pr-3 text-pv-text-muted">{r.owner}</td>
                  <td className="py-1.5 pr-3">
                    <Badge tone={r.state === "ACTIVE" ? "success" : "danger"}>{r.state}</Badge>
                  </td>
                  <td className="py-1.5 text-pv-text-faint">{r.parameters ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </GlassPanel>
  );
}
