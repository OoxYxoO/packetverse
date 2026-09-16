import { clsx } from "clsx";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { Badge } from "@/components/ui/Badge";

export interface NextHopSetStage {
  label: string;
  value: string;
}

export interface NextHopSetMember {
  id: string;
  label: string;
  eligible: boolean;
  reason?: string;
}

/**
 * Generic dependency-chain → candidate-set → eligible-members viewer.
 * Knows nothing about EVPN, aliasing, or ESIs — it renders whatever
 * chain of {label, value} stages led to a decision, then a set of
 * members each marked eligible or removed. Built for EVPN Aliasing,
 * but the same shape fits ECMP, BGP multipath, LAG membership, or any
 * future failover next-hop group.
 */
export function NextHopSetViewer({
  title,
  scope,
  chain,
  members,
  setLabel,
}: {
  title: string;
  scope?: string;
  chain: NextHopSetStage[];
  members: NextHopSetMember[];
  setLabel: string;
}) {
  const eligible = members.filter((m) => m.eligible);
  return (
    <GlassPanel strong className="space-y-3 p-4">
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-pv-violet">{title}</h4>
        {scope && <p className="pv-mono text-[11px] text-pv-text-faint">{scope}</p>}
      </div>
      <div className="flex flex-col items-center gap-1">
        {chain.map((stage, i) => (
          <div key={stage.label} className="flex w-full flex-col items-center">
            <div className="rounded-lg border border-pv-border px-3 py-1.5 text-center">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-pv-text-faint">{stage.label}</p>
              <p className="pv-mono text-xs text-pv-text">{stage.value}</p>
            </div>
            {i < chain.length - 1 && <span className="py-0.5 text-pv-text-faint">↓</span>}
          </div>
        ))}
      </div>
      <div className="flex justify-center gap-2 border-t border-pv-border pt-2.5">
        {members.map((m) => (
          <div key={m.id} className={clsx("flex flex-col items-center gap-1 rounded-lg border px-3 py-2", m.eligible ? "border-pv-success/50 bg-pv-success/5" : "border-pv-danger/40 bg-pv-danger/5 opacity-70")} title={m.reason}>
            <span className="pv-mono text-xs font-semibold text-pv-text">{m.label}</span>
            <span className={clsx("text-sm", m.eligible ? "text-pv-success" : "text-pv-danger")}>{m.eligible ? "✓" : "✕"}</span>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-center gap-2 pt-1">
        <Badge tone={eligible.length > 0 ? "success" : "danger"}>{setLabel}</Badge>
        <span className="pv-mono text-xs text-pv-text">{"{ " + (eligible.length ? eligible.map((m) => m.label).join(", ") : "—") + " }"}</span>
      </div>
    </GlassPanel>
  );
}
