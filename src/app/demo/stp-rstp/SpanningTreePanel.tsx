"use client";

import { clsx } from "clsx";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { STP_SWITCHES, bidName, bidText, bridgeIdOf, bridgeInfo, portSummary, roleShort, type StpState } from "@/lib/sim-engine/scenarios/stpRstp";

/** Each bridge's root view and every port's link / RSTP / role / state — from the SHOWN state (historical-aware). */
export function SpanningTreePanel({ s }: { s: StpState }) {
  return (
    <GlassPanel className="space-y-3 p-4">
      {STP_SWITCHES.map((sw) => {
        const b = bridgeInfo(s, sw);
        const isRoot = !b.rootPort;
        return (
          <div key={sw} className="min-w-0">
            <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">
                {sw} · {bidText(bridgeIdOf(sw))}
              </p>
              <p className="pv-mono text-[10px] text-pv-text-muted">{isRoot ? `root: itself` : `root ${bidName(b.rootId)} · cost ${b.cost} · RP ${b.rootPort}`}</p>
            </div>
            <div className="space-y-0.5 pv-mono text-[11px]">
              {portSummary(s, sw).map((p) => (
                <div key={p.port} className="flex flex-wrap justify-between gap-x-2">
                  <span className="text-pv-text">
                    {p.port} <span className="text-pv-text-faint">→ {p.peer}</span>
                  </span>
                  <span className={clsx(!p.up ? "text-pv-danger" : !p.rstp && p.link !== "edge" ? "text-pv-warning" : p.state === "Forwarding" ? "text-pv-success" : "text-pv-violet")}>
                    {!p.up ? "LINK DOWN" : `${p.link === "edge" ? "EDGE" : p.rstp ? roleShort(p.role) : "RSTP OFF"} · ${p.state === "Forwarding" ? "FWD" : "DISC"}`}
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
      <p className="border-t border-pv-border pt-2 text-[10px] text-pv-text-faint">RP Root · DP Designated · ALT Alternate · FWD Forwarding · DISC Discarding (link still up)</p>
      {s.loop && (
        <div className="space-y-0.5 border-t border-pv-border pt-2 text-[11px]">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-warning">Broadcast monitor · wave {s.loop.wave}</p>
          <Row k="Copies sent by switches" v={String(s.loop.framesSent)} />
          <Row k="Copies still circulating" v={String(s.loop.circulating)} />
          <Row k="HOST-A / B / C received" v={`${s.loop.received["HOST-A"]}× / ${s.loop.received["HOST-B"]}× / ${s.loop.received["HOST-C"]}×`} />
          <Row k="HOST-A MAC moves" v={String(s.loop.moves.length)} />
        </div>
      )}
    </GlassPanel>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-3">
      <span className="text-pv-text-faint">{k}</span>
      <span className="pv-mono text-pv-text">{v}</span>
    </div>
  );
}
