import { clsx } from "clsx";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { Badge } from "@/components/ui/Badge";

export interface LabelFlowNode {
  router: string;
  /** Action performed leaving this router toward the next one, if any. */
  action?: string;
  /** What's on the wire leaving this router (e.g. "102", "203", "IP"). */
  outputLabel: string;
}

/**
 * Simplified "Label Flow" view (brief §16) — collapses the full
 * topology into a bare router → action → label chain, giving the
 * learner a clean mental model after seeing the full packet journey.
 * Purely a renderer over data the scenario/page already computed.
 */
export function LabelFlowView({ nodes }: { nodes: LabelFlowNode[] }) {
  return (
    <GlassPanel className="overflow-x-auto p-6">
      <div className="flex min-w-max items-center gap-1">
        {nodes.map((n, i) => (
          <div key={n.router} className="flex items-center gap-1">
            <div className="flex flex-col items-center gap-2">
              <span className="pv-mono text-xs font-semibold text-pv-text">{n.router}</span>
              <span
                className={clsx(
                  "flex h-10 min-w-[3.5rem] items-center justify-center rounded-lg border px-2 pv-mono text-xs font-bold",
                  n.outputLabel === "IP" ? "border-pv-border text-pv-text-faint" : "border-pv-cyan/50 bg-pv-cyan/10 text-pv-cyan-soft",
                )}
              >
                {n.outputLabel}
              </span>
            </div>
            {i < nodes.length - 1 && (
              <div className="flex flex-col items-center gap-1 px-1">
                {n.action && <Badge tone="cyan">{n.action}</Badge>}
                <span className="text-pv-text-faint">─────►</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </GlassPanel>
  );
}
