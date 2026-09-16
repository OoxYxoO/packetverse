"use client";

import { clsx } from "clsx";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { Badge } from "@/components/ui/Badge";
import type { PathCandidate, RouterId } from "@/lib/sim-engine/scenarios/ospfArea0";

interface SpfPathPanelProps {
  root: RouterId;
  destination: RouterId;
  paths: PathCandidate[];
}

/**
 * SPF path-comparison panel (brief §5) — shows every candidate path
 * from root to destination with its cumulative cost, and highlights
 * the winner. Reads `spfPaths` straight from the OSPF scenario state;
 * the cost arithmetic itself happens in enumeratePaths()/computeSpf()
 * in the scenario layer, not here.
 */
export function SpfPathPanel({ root, destination, paths }: SpfPathPanelProps) {
  if (paths.length === 0) {
    return (
      <GlassPanel className="p-4">
        <p className="text-xs text-pv-text-faint">SPF hasn&apos;t run yet — advance the scenario to compute {root}&apos;s paths to {destination}.</p>
      </GlassPanel>
    );
  }

  const bestCost = paths[0].cost;

  return (
    <GlassPanel className="p-4">
      <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-pv-text-muted">
        SPF: {root} → {destination}
      </h4>
      <div className="space-y-2">
        {paths.map((candidate, i) => {
          const isBest = candidate.cost === bestCost && i === 0;
          const segments = candidate.path.slice(0, -1).map((node, idx) => ({ from: node, to: candidate.path[idx + 1] }));
          return (
            <div
              key={candidate.path.join("-")}
              className={clsx(
                "rounded-lg border px-3 py-2.5 text-xs",
                isBest ? "pv-glow-success border-pv-success/50 bg-pv-success/5" : "border-pv-border opacity-70",
              )}
            >
              <div className="mb-1 flex items-center justify-between">
                <span className="pv-mono text-pv-text">{candidate.path.join(" → ")}</span>
                {isBest && <Badge tone="success">Best Path</Badge>}
              </div>
              <p className="pv-mono text-pv-text-faint">
                {segments.map((s, idx) => (
                  <span key={idx}>
                    {idx > 0 && " + "}
                    {s.from}→{s.to}
                  </span>
                ))}
                {" = "}
                <span className={isBest ? "text-pv-success" : "text-pv-text-muted"}>{candidate.cost}</span>
              </p>
            </div>
          );
        })}
      </div>
    </GlassPanel>
  );
}
