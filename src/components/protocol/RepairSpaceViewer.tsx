import { clsx } from "clsx";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { Badge } from "@/components/ui/Badge";

export interface RepairSpaceNode {
  id: string;
  label: string;
}

/**
 * Generic P-Space / Q-Space / PQ-candidate viewer — plain node ids in,
 * plain badges out. Knows nothing about TI-LFA, IGP metrics, or SPF;
 * every set (pSpace, qSpace, pqCandidates) and the selected repair node
 * are handed in already computed by the scenario layer. The real
 * topology overlay (P-Space/Q-Space regions on the graph itself) is a
 * page-level composition using the existing generic node badge/status
 * mechanism — this component is the compact tabular companion to that,
 * reusable later by any other "two computed sets and their
 * intersection" concept (not only TI-LFA).
 */
export function RepairSpaceViewer({
  title = "P-Space / Q-Space",
  nodes,
  pSpace,
  qSpace,
  pqCandidates,
  selectedRepairNode,
  protectedResource,
  plr,
  destination,
}: {
  title?: string;
  nodes: RepairSpaceNode[];
  pSpace: string[];
  qSpace: string[];
  pqCandidates: string[];
  selectedRepairNode?: string;
  protectedResource: string;
  plr: string;
  destination: string;
}) {
  return (
    <GlassPanel strong className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-pv-violet">{title}</h4>
        <span className="pv-mono text-[10px] text-pv-text-faint">
          PLR {plr} · protecting {protectedResource} · destination {destination}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {nodes
          .filter((n) => n.id !== plr && n.id !== destination)
          .map((n) => {
            const inP = pSpace.includes(n.id);
            const inQ = qSpace.includes(n.id);
            const isPq = pqCandidates.includes(n.id);
            const isSelected = selectedRepairNode === n.id;
            return (
              <div
                key={n.id}
                className={clsx(
                  "flex items-center justify-between rounded-lg border px-3 py-1.5 pv-mono text-xs",
                  isSelected ? "border-pv-cyan/60 bg-pv-cyan/10 pv-glow-cyan" : isPq ? "border-pv-success/40 bg-pv-success/5" : "border-pv-border",
                )}
              >
                <span className="font-semibold text-pv-text">{n.label}</span>
                <span className="flex gap-1">
                  {inP && <Badge tone="cyan">P</Badge>}
                  {inQ && <Badge tone="violet">Q</Badge>}
                  {isPq && <Badge tone="success">PQ</Badge>}
                  {isSelected && <Badge tone="warning">SELECTED</Badge>}
                  {!inP && !inQ && <span className="text-pv-text-faint">unsafe</span>}
                </span>
              </div>
            );
          })}
      </div>

      <div className="grid grid-cols-3 gap-2 border-t border-pv-border pt-2.5 pv-mono text-[10px] text-pv-text-faint">
        <span>P-Space: {pSpace.join(", ") || "(empty)"}</span>
        <span>Q-Space: {qSpace.join(", ") || "(empty)"}</span>
        <span>PQ: {pqCandidates.join(", ") || "(none)"}</span>
      </div>
    </GlassPanel>
  );
}
