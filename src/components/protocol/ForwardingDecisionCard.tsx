import { GlassPanel } from "@/components/ui/GlassPanel";
import { Badge } from "@/components/ui/Badge";

interface ForwardingDecisionCardProps {
  router: string;
  input: string;
  lookup: string;
  action: string;
  output: string;
}

/**
 * Reusable per-hop forwarding-decision card (brief §15): INPUT →
 * LOOKUP → ACTION → OUTPUT. Generic over any label-switching or
 * IP-forwarding hop — not MPLS-specific in shape, just fed MPLS data
 * here. No forwarding logic lives in this component.
 */
export function ForwardingDecisionCard({ router, input, lookup, action, output }: ForwardingDecisionCardProps) {
  return (
    <GlassPanel strong className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="pv-mono text-sm font-semibold text-pv-text">{router}</span>
        <Badge tone="cyan">{action}</Badge>
      </div>
      <div className="grid grid-cols-2 gap-3 text-[11px]">
        <div>
          <p className="mb-0.5 text-pv-text-faint uppercase tracking-wide">Input</p>
          <p className="pv-mono text-pv-text">{input}</p>
        </div>
        <div>
          <p className="mb-0.5 text-pv-text-faint uppercase tracking-wide">Lookup</p>
          <p className="pv-mono text-pv-text">{lookup}</p>
        </div>
        <div className="col-span-2">
          <p className="mb-0.5 text-pv-text-faint uppercase tracking-wide">Output</p>
          <p className="pv-mono text-pv-cyan-soft">{output}</p>
        </div>
      </div>
    </GlassPanel>
  );
}
