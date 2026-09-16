import { clsx } from "clsx";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { Badge } from "@/components/ui/Badge";

export interface BgpUpdateField {
  label: string;
  value: string;
}

/**
 * Generic BGP UPDATE presentation distinguishing ANNOUNCE from
 * WITHDRAW as a semantic action, never a color-only difference on an
 * otherwise-identical advertisement card. Knows nothing about EVPN —
 * any BGP-family lesson that needs to show a route being pulled
 * (graceful restart, route dampening, a session reset) can reuse it.
 */
export function BgpUpdateCard({ title, from, to, action, fields }: { title: string; from: string; to: string; action: "announce" | "withdraw"; fields: BgpUpdateField[] }) {
  const isWithdraw = action === "withdraw";
  return (
    <GlassPanel strong className={clsx("space-y-2.5 p-4", isWithdraw && "border-pv-danger/40")}>
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-pv-violet">{title}</h4>
        <Badge tone={isWithdraw ? "danger" : "success"}>{isWithdraw ? "ACTION: WITHDRAW" : "ACTION: ANNOUNCE"}</Badge>
      </div>
      <p className="pv-mono text-[11px] text-pv-text-faint">
        {from} → {to}
      </p>
      <div className={clsx("grid grid-cols-2 gap-x-3 gap-y-1 rounded-lg border p-2.5 pv-mono text-[11px]", isWithdraw ? "border-pv-danger/30 bg-pv-danger/5" : "border-pv-border")}>
        {fields.map((f) => (
          <span key={f.label} className="contents">
            <span className="text-pv-text-faint">{f.label}</span>
            <span className={isWithdraw ? "text-pv-danger" : "text-pv-text"}>{f.value}</span>
          </span>
        ))}
      </div>
    </GlassPanel>
  );
}
