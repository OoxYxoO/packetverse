"use client";

import { useState } from "react";
import { clsx } from "clsx";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { CAPTURES, FLOW, secs, type CapId, type FlowId, type PaState } from "@/lib/sim-engine/scenarios/troubleshootingPacketAnalysis";

type Filter = "all" | FlowId;
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "healthy", label: `:${FLOW.healthy.sport}` },
  { id: "incident", label: `:${FLOW.incident.sport}` },
  { id: "verify", label: `:${FLOW.verify.sport}` },
];

/**
 * Three logical capture points, rendered from the SHOWN state's own capture rows. The analysis column is what each
 * capture can infer from its own earlier rows — the same packet can be a retransmission at one point and not another.
 */
export function CapturePanel({ s }: { s: PaState }) {
  const [cap, setCap] = useState<CapId>("client");
  const [filter, setFilter] = useState<Filter>("all");
  const meta = CAPTURES.find((c) => c.id === cap)!;
  const rows = s.captures[cap].filter((r) => filter === "all" || r.flow === filter);
  return (
    <GlassPanel className="space-y-2 p-4 text-[11px]">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">Captures</p>
        <p className="text-[10px] text-pv-text-faint">clocks synchronized · absolute seq numbers</p>
      </div>
      <div className="flex flex-wrap gap-1" role="tablist" aria-label="Capture point">
        {CAPTURES.map((c) => (
          <button key={c.id} type="button" role="tab" aria-selected={cap === c.id} onClick={() => setCap(c.id)} className={clsx("rounded-md border px-2 py-1 text-[10.5px] font-semibold", cap === c.id ? "border-pv-cyan/60 bg-pv-cyan/10 text-pv-cyan-soft" : "border-pv-border text-pv-text-muted hover:text-pv-text")}>
            {c.label} <span className="font-normal text-pv-text-faint">({s.captures[c.id].length})</span>
          </button>
        ))}
      </div>
      <p className="text-[10px] text-pv-text-faint">{meta.where}</p>
      <div className="flex flex-wrap gap-1" aria-label="Flow filter">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" onClick={() => setFilter(f.id)} aria-pressed={filter === f.id} className={clsx("pv-mono rounded border px-1.5 py-px text-[10px]", filter === f.id ? "border-pv-violet/60 text-pv-violet" : "border-pv-border text-pv-text-faint hover:text-pv-text")}>
            {f.label}
          </button>
        ))}
      </div>
      {rows.length === 0 ? (
        <p className="text-pv-text-faint">No frames recorded at this point{filter !== "all" ? " for this flow" : ""} yet.</p>
      ) : (
        <ol className="max-h-80 divide-y divide-pv-border/60 overflow-y-auto rounded-lg border border-pv-border pv-mono text-[10px]" aria-label={`${meta.label} capture`}>
          {rows.map((r) => (
            <li key={r.no} className={clsx("px-2 py-1", r.analysis ? "bg-pv-warning/5 text-pv-warning" : r.proto === "ARP" ? "text-pv-text-muted" : "text-pv-text")}>
              <div className="flex flex-wrap gap-x-2">
                <span className="text-pv-text-faint">#{r.no}</span>
                <span>{secs(r.us)} s</span>
                <span className="min-w-0 break-all">
                  {r.src} → {r.dst}
                </span>
                {r.ttl !== undefined && <span className="text-pv-text-faint">TTL {r.ttl}</span>}
              </div>
              <div className="break-words">
                {r.analysis && <span className="font-semibold">[{r.analysis}] </span>}
                {r.info}
              </div>
            </li>
          ))}
        </ol>
      )}
    </GlassPanel>
  );
}
