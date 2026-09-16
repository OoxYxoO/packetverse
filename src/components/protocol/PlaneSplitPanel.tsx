import { clsx } from "clsx";
import { GlassPanel } from "@/components/ui/GlassPanel";

export interface PlaneRow {
  label: string;
  value: string;
}

interface PlaneSplitPanelProps {
  controlTitle: string;
  controlRows: PlaneRow[];
  dataTitle: string;
  dataRows: PlaneRow[];
  /** Which side(s) to render — lets a lesson offer a Control/Data/Both toggle without re-implementing the layout. Defaults to "both". */
  show?: "control" | "data" | "both";
}

/**
 * Control-plane vs. data-plane split view (brief §17/§21) —
 * deliberately generic key/value rows so any protocol pairing
 * (OSPF+LDP vs. MPLS forwarding; MP-BGP/VRF vs. label-stack
 * forwarding here) can reuse it.
 */
export function PlaneSplitPanel({ controlTitle, controlRows, dataTitle, dataRows, show = "both" }: PlaneSplitPanelProps) {
  return (
    <div className={clsx("grid gap-4", show === "both" && "sm:grid-cols-2")}>
      {show !== "data" && (
        <GlassPanel strong className="p-4">
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-pv-violet">{controlTitle}</h4>
          <div className="space-y-2">
            {controlRows.map((r) => (
              <div key={r.label} className="flex items-center justify-between text-[11px]">
                <span className="text-pv-text-faint">{r.label}</span>
                <span className="pv-mono text-pv-text">{r.value}</span>
              </div>
            ))}
          </div>
        </GlassPanel>
      )}
      {show !== "control" && (
        <GlassPanel strong className="p-4">
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-pv-cyan-soft">{dataTitle}</h4>
          <div className="space-y-2">
            {dataRows.map((r) => (
              <div key={r.label} className="flex items-center justify-between text-[11px]">
                <span className="text-pv-text-faint">{r.label}</span>
                <span className="pv-mono text-pv-text">{r.value}</span>
              </div>
            ))}
          </div>
        </GlassPanel>
      )}
    </div>
  );
}
