import { clsx } from "clsx";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { Badge } from "@/components/ui/Badge";

export interface FloodListRow {
  leaf: string;
  vtep: string;
  status: "member" | "missing" | "rejected";
}

const STATUS_TONE: Record<FloodListRow["status"], "success" | "warning" | "danger"> = {
  member: "success",
  missing: "warning",
  rejected: "danger",
};
const STATUS_LABEL: Record<FloodListRow["status"], string> = {
  member: "In Flood List",
  missing: "Missing",
  rejected: "Rejected (RT mismatch)",
};

/**
 * Generic VNI flood-list / replication-set viewer (brief: "reusable
 * FloodListViewer") — which remote VTEPs a given VTEP will replicate
 * BUM traffic toward, for one VNI. Purely a renderer over rows the
 * scenario layer computed from its own Type 3 (IMET) import state —
 * no route-target or replication logic lives here.
 */
export function FloodListViewer({ title, vni, rows }: { title: string; vni: number; rows: FloodListRow[] }) {
  return (
    <GlassPanel className="p-4">
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-pv-text-muted">
        {title} — VNI {vni} Flood List
      </h4>
      {rows.length === 0 ? (
        <p className="pv-mono text-xs text-pv-text-faint">EMPTY — no remote VTEPs learned yet.</p>
      ) : (
        <div className="space-y-1.5">
          {rows.map((r) => (
            <div
              key={r.leaf}
              className={clsx(
                "flex items-center justify-between rounded-lg border px-3 py-1.5 pv-mono text-[11px]",
                r.status === "member" ? "border-pv-success/30 bg-pv-success/5" : r.status === "missing" ? "border-pv-warning/30 bg-pv-warning/5" : "border-pv-danger/30 bg-pv-danger/5",
              )}
            >
              <span className="font-semibold text-pv-text">
                {r.leaf} <span className="text-pv-text-faint">({r.vtep})</span>
              </span>
              <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
            </div>
          ))}
        </div>
      )}
    </GlassPanel>
  );
}
