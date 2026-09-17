import { GlassPanel } from "@/components/ui/GlassPanel";
import { Badge } from "@/components/ui/Badge";

export interface BridgePortRow {
  role: string;
  peer: string;
  state?: string;
}

const ROLE_TONE: Record<string, "cyan" | "warning" | "violet" | "muted"> = { AC: "cyan", SPOKE_PW: "warning", MESH_PW: "violet" };

/**
 * Generic bridge-port role summary — plain rows in, plain table out.
 * Knows nothing about VPLS, H-VPLS, or split horizon; every row is
 * handed in already computed. Built for H-VPLS's three-role model
 * (AC / SPOKE_PW / MESH_PW) but not named after it, since any future
 * lesson with more than two port roles at one bridge can reuse it.
 */
export function BridgePortsViewer({ title, rows }: { title: string; rows: BridgePortRow[] }) {
  return (
    <GlassPanel className="p-4">
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-pv-text-muted">{title} — Bridge Ports</h4>
      {rows.length === 0 ? (
        <p className="pv-mono text-xs text-pv-text-faint">No active bridge ports.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {rows.map((r, i) => (
            <div key={`${r.role}-${r.peer}-${i}`} className="flex items-center justify-between gap-2 rounded-lg border border-pv-border px-3 py-1.5 text-[11px]">
              <Badge tone={ROLE_TONE[r.role] ?? "muted"}>{r.role}</Badge>
              <span className="pv-mono text-pv-text">{r.peer}</span>
              {r.state && <span className="pv-mono text-pv-text-faint">{r.state}</span>}
            </div>
          ))}
        </div>
      )}
    </GlassPanel>
  );
}
