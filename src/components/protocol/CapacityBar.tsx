import { clsx } from "clsx";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { Badge } from "@/components/ui/Badge";

/**
 * Generic capacity/reservation "pipe" visual — knows nothing about
 * RSVP, EVPN, or QoS. Given a total, a reserved amount, and units, it
 * renders a filled/available bar plus a plain-language readout. Built
 * for RSVP-TE bandwidth reservation, but the same shape fits link
 * utilization, QoS queue depth, or a future SR policy's reserved
 * bandwidth — nothing here decides what "reserved" means.
 */
export function CapacityBar({
  title,
  total,
  reserved,
  units = "Mbps",
  itemCount,
  itemLabel = "reservations",
  className,
}: {
  title?: string;
  total: number;
  reserved: number;
  units?: string;
  /** e.g. "1 RSVP LSP using this link" — omit if not applicable. */
  itemCount?: number;
  itemLabel?: string;
  className?: string;
}) {
  const available = Math.max(0, total - reserved);
  const pct = total > 0 ? Math.min(100, (reserved / total) * 100) : 0;

  return (
    <GlassPanel strong className={clsx("space-y-3 p-4", className)}>
      {title && <h4 className="text-xs font-semibold uppercase tracking-wide text-pv-cyan-soft">{title}</h4>}
      <div className="h-4 w-full overflow-hidden rounded-full border border-pv-border bg-white/5">
        <div className="h-full rounded-full bg-pv-cyan/70 transition-[width] duration-500 ease-out" style={{ width: `${pct}%` }} />
      </div>
      <div className="grid grid-cols-3 gap-2 pv-mono text-[11px]">
        <div>
          <p className="text-pv-text-faint">Physical</p>
          <p className="text-pv-text">
            {total} {units}
          </p>
        </div>
        <div>
          <p className="text-pv-text-faint">Reserved</p>
          <p className="text-pv-cyan-soft">
            {reserved} {units}
          </p>
        </div>
        <div>
          <p className="text-pv-text-faint">Available</p>
          <p className={clsx(available > 0 ? "text-pv-success" : "text-pv-danger")}>
            {available} {units}
          </p>
        </div>
      </div>
      {itemCount !== undefined && (
        <div className="flex items-center gap-2 border-t border-pv-border pt-2">
          <Badge tone={itemCount > 0 ? "cyan" : "muted"}>
            {itemCount} {itemLabel}
          </Badge>
        </div>
      )}
    </GlassPanel>
  );
}
