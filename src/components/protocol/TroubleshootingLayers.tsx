import { clsx } from "clsx";
import { GlassPanel } from "@/components/ui/GlassPanel";

export type LayerStatus = "healthy" | "failing" | "unknown";

export interface DiagnosticLayer {
  label: string;
  status: LayerStatus;
}

const STATUS_GLYPH: Record<LayerStatus, string> = { healthy: "✓", failing: "✕", unknown: "?" };
const STATUS_CLASS: Record<LayerStatus, string> = {
  healthy: "border-pv-success/40 bg-pv-success/5 text-pv-success",
  failing: "border-pv-danger/40 bg-pv-danger/5 text-pv-danger",
  unknown: "border-pv-border text-pv-text-faint",
};

/**
 * Reusable layered-diagnostic stack (brief §29) — bottom-up, matching
 * how an engineer actually isolates a fault: interface, then IGP,
 * then LDP, then transport, then control plane, then policy, then
 * the customer route itself. Generic over any ordered layer list;
 * holds no troubleshooting logic — the scenario layer decides each
 * layer's status.
 */
export function TroubleshootingLayers({ layers, title }: { layers: DiagnosticLayer[]; title?: string }) {
  // Rendered in the order given — pass foundation-first (Interface,
  // IGP, LDP, ...) up through policy/customer routing, matching how
  // an engineer actually isolates a fault layer by layer.
  return (
    <GlassPanel className="p-4">
      {title && <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-pv-text-muted">{title}</h4>}
      <div className="flex flex-col gap-1.5">
        {layers.map((l) => (
          <div key={l.label} className={clsx("flex items-center justify-between rounded-lg border px-3 py-1.5 pv-mono text-xs", STATUS_CLASS[l.status])}>
            <span>{l.label}</span>
            <span className="font-bold">{STATUS_GLYPH[l.status]}</span>
          </div>
        ))}
      </div>
    </GlassPanel>
  );
}
