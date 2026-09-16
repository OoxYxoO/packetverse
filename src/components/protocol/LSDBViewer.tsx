"use client";

import { useState } from "react";
import { clsx } from "clsx";
import { GlassPanel } from "@/components/ui/GlassPanel";
import type { RouterLSA, RouterId } from "@/lib/sim-engine/scenarios/ospfArea0";
import { ROUTER_IDS } from "@/lib/sim-engine/scenarios/ospfArea0";

interface LSDBViewerProps {
  routers: RouterId[];
  lsdb: Record<RouterId, Partial<Record<RouterId, RouterLSA>>>;
  /** LSA keys installed most recently — get a highlight ring. */
  recentlyInstalled?: string[];
}

/**
 * Per-router Link-State Database viewer (brief §4). Focused on Type-1
 * Router-LSAs, matching this lesson's point-to-point scope. Purely a
 * renderer over the engine's `lsdb` state — no flooding/SPF logic
 * lives here.
 */
export function LSDBViewer({ routers, lsdb, recentlyInstalled = [] }: LSDBViewerProps) {
  const [focused, setFocused] = useState<RouterId>(routers[0]);
  const entries = Object.values(lsdb[focused]).filter((e): e is RouterLSA => Boolean(e));

  return (
    <GlassPanel className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-pv-text-muted">Link-State Database</h4>
        <div className="flex gap-1">
          {routers.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setFocused(r)}
              className={clsx(
                "rounded-md px-2 py-0.5 text-[10px] font-semibold pv-mono transition-colors",
                focused === r ? "bg-pv-cyan/15 text-pv-cyan-soft" : "text-pv-text-faint hover:text-pv-text",
              )}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <p className="mb-2 text-[10px] text-pv-text-faint">{focused}&apos;s LSDB — Router ID {ROUTER_IDS[focused]}</p>

      {entries.length === 0 ? (
        <p className="pv-mono text-xs text-pv-text-faint">EMPTY</p>
      ) : (
        <div className="space-y-1.5">
          {entries.map((lsa) => (
            <div
              key={lsa.originRouter}
              className={clsx(
                "rounded-lg border px-3 py-2 text-[11px]",
                recentlyInstalled.includes(`${focused}:${lsa.originRouter}`) ? "border-pv-cyan/50 bg-pv-cyan/5" : "border-pv-border",
              )}
            >
              <div className="mb-1 flex items-center justify-between">
                <span className="pv-mono font-semibold text-pv-text">Router-LSA {ROUTER_IDS[lsa.originRouter]}</span>
                <span className="pv-mono text-pv-text-faint">seq {lsa.sequence}</span>
              </div>
              <p className="text-pv-text-muted">{lsa.links.map((l) => `${l.neighbor} (cost ${l.cost})`).join(", ")}</p>
            </div>
          ))}
        </div>
      )}
    </GlassPanel>
  );
}
