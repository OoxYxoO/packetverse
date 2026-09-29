"use client";

import { clsx } from "clsx";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { L3, clientLookup, clientRoutes, routeText, type L3State } from "@/lib/sim-engine/scenarios/troubleshootingLayer3";

/** CLIENT's table and per-destination decision, ARP cache and ping results at the SHOWN step. */
export function L3Panel({ s }: { s: L3State }) {
  const dests = [L3.remote, L3.server];
  return (
    <GlassPanel className="space-y-3 p-4 text-[11px]">
      <div>
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">CLIENT routing table · {L3.client}/{s.clientPrefix}</p>
        {clientRoutes(s.clientPrefix).map((r) => (
          <p key={`${r.prefix}/${r.len}`} className="pv-mono text-[10.5px] text-pv-text">
            {routeText(r)}
          </p>
        ))}
      </div>
      <div className="border-t border-pv-border pt-2">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">Next-hop decision (longest match)</p>
        {dests.map((d) => {
          const x = clientLookup(s.clientPrefix, d);
          return (
            <div key={d} className="flex flex-wrap justify-between gap-x-2 pv-mono text-[10.5px]">
              <span className="text-pv-text">{d}</span>
              <span className="text-pv-text-muted">
                {x.onLink ? "on-link → ARP for" : "via gateway → ARP for"} {x.nextHop}
              </span>
            </div>
          );
        })}
      </div>
      <div className="border-t border-pv-border pt-2">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">CLIENT ARP cache</p>
        {Object.keys(s.clientArp).length === 0 && Object.keys(s.arpPending).length === 0 && <p className="text-pv-text-faint">empty</p>}
        {Object.entries(s.clientArp).map(([ip, mac]) => (
          <p key={ip} className="pv-mono text-[10.5px] text-pv-text">
            {ip} → {mac}
          </p>
        ))}
        {Object.entries(s.arpPending).map(([ip, n]) => (
          <p key={ip} className="pv-mono text-[10.5px] text-pv-warning">
            {ip} → INCOMPLETE ({n} request{n === 1 ? "" : "s"})
          </p>
        ))}
      </div>
      <div className="border-t border-pv-border pt-2">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">Pings</p>
        {s.pings.length === 0 ? (
          <p className="text-pv-text-faint">Not run yet.</p>
        ) : (
          s.pings.map((p, i) => (
            <div key={`${p.label}-${p.dst}-${i}`} className="flex justify-between gap-2 pv-mono text-[10.5px]">
              <span className="text-pv-text">
                {p.label} → {p.dst}
              </span>
              <span className={clsx(p.received === p.sent ? "text-pv-success" : "text-pv-warning")}>
                {p.received}/{p.sent}
              </span>
            </div>
          ))
        )}
      </div>
    </GlassPanel>
  );
}
