import { GlassPanel } from "@/components/ui/GlassPanel";
import { Badge } from "@/components/ui/Badge";

export interface ServiceInstanceField {
  label: string;
  value: string;
}

/**
 * Generic point-to-point (or any) service-instance summary card — a
 * plain {label, value} grid plus an optional status badge. Knows
 * nothing about EVPN or VPWS; built for the VPWS Service Instance
 * viewer here, reusable later for any other service-instance summary
 * (an L3VPN VRF instance, a pseudowire, a tunnel).
 */
export function ServiceInstanceViewer({ title, subtitle, fields, status }: { title: string; subtitle?: string; fields: ServiceInstanceField[]; status?: "up" | "down" }) {
  return (
    <GlassPanel strong className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-pv-violet">{title}</h4>
          {subtitle && <p className="pv-mono text-[11px] text-pv-text-faint">{subtitle}</p>}
        </div>
        {status && <Badge tone={status === "up" ? "success" : "danger"}>{status.toUpperCase()}</Badge>}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 pv-mono text-[11px]">
        {fields.map((f) => (
          <span key={f.label} className="contents">
            <span className="text-pv-text-faint">{f.label}</span>
            <span className="text-pv-text">{f.value}</span>
          </span>
        ))}
      </div>
    </GlassPanel>
  );
}
