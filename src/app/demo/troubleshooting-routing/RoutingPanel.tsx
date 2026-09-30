"use client";

import { clsx } from "clsx";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { IP, fibLookup, routeKey, routeText, type RtState } from "@/lib/sim-engine/scenarios/troubleshootingRouting";

/** R1's RIB, per-destination lookups, OSPF summary, pings and traceroutes at the SHOWN step. */
export function RoutingPanel({ s }: { s: RtState }) {
  return (
    <GlassPanel className="space-y-3 p-4 text-[11px]">
      <div>
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">R1 routing table</p>
        {s.r1Rib.map((r) => (
          <p key={routeKey(r)} className={clsx("pv-mono text-[10.5px] break-words", r.action === "discard" ? "text-pv-warning" : "text-pv-text")}>
            {routeText(r)}
          </p>
        ))}
      </div>
      <div className="border-t border-pv-border pt-2">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">R1 lookup (longest prefix)</p>
        {[IP.srvA, IP.srvB].map((d) => {
          const { matches, chosen } = fibLookup(s.r1Rib, d);
          return (
            <div key={d} className="pv-mono text-[10.5px]">
              <span className="text-pv-text">{d}</span>
              <span className="text-pv-text-faint"> · matches {matches.map(routeKey).join(", ")}</span>
              <span className={clsx(" block", chosen?.action === "discard" ? "text-pv-warning" : "text-pv-success")}>→ {chosen ? `${routeKey(chosen)} ${chosen.action === "discard" ? "discard" : `via ${chosen.nextHop}`}` : "none"}</span>
            </div>
          );
        })}
      </div>
      <div className="border-t border-pv-border pt-2">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">OSPF</p>
        <p className="pv-mono text-[10.5px] text-pv-text">
          {s.ospf.neighbors
            .filter((n) => n.router < n.peer)
            .map((n) => `${n.router}–${n.peer} ${n.state}`)
            .join(" · ")}{" "}
          · LSAs {s.ospf.lsas.length}
        </p>
      </div>
      <div className="border-t border-pv-border pt-2">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">Pings · traceroutes</p>
        {s.pings.length === 0 && s.traces.length === 0 && <p className="text-pv-text-faint">Not run yet.</p>}
        {s.pings.map((p, i) => (
          <div key={`p${i}`} className="flex justify-between gap-2 pv-mono text-[10.5px]">
            <span className="text-pv-text">
              {p.label} → {p.dst}
            </span>
            <span className={p.received === p.sent ? "text-pv-success" : "text-pv-warning"}>
              {p.received}/{p.sent}
            </span>
          </div>
        ))}
        {s.traces.map((t, i) => (
          <p key={`t${i}`} className="pv-mono text-[10px] break-words text-pv-text-muted">
            trace {t.label} → {t.dst}: {t.hops.join(" → ")}
          </p>
        ))}
      </div>
    </GlassPanel>
  );
}
