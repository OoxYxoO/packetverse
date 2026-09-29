"use client";

import { GlassPanel } from "@/components/ui/GlassPanel";
import { L2_PORTS, L2_SWITCHES, USER_VLAN, allowedText, fdbText, stpState, type L2State } from "@/lib/sim-engine/scenarios/troubleshootingLayer2";

/** Trunk membership, RSTP state, VLAN 10 MAC tables and ping results at the SHOWN step. */
export function L2Panel({ s }: { s: L2State }) {
  return (
    <GlassPanel className="space-y-3 p-4 text-[11px]">
      <div>
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">Trunks · allowed VLANs · RSTP</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[300px] pv-mono text-[10px]">
            <tbody>
              {L2_PORTS.filter((p) => p.mode === "trunk").map((p) => (
                <tr key={`${p.sw}-${p.port}`} className="text-pv-text">
                  <td className="pr-2">
                    {p.sw} {p.port}
                  </td>
                  <td className="pr-2 text-pv-text-muted">→ {p.peer}</td>
                  <td className="pr-2">allowed {allowedText(s, p.sw, p.port)}</td>
                  <td className={stpState(p) === "Forwarding" ? "text-pv-success" : "text-pv-text-faint"}>
                    {p.role}/{stpState(p)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="border-t border-pv-border pt-2">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">MAC tables · VLAN {USER_VLAN}</p>
        {L2_SWITCHES.map((sw) => (
          <div key={sw} className="flex flex-wrap gap-x-2 pv-mono text-[10.5px]">
            <span className="text-pv-text">{sw}</span>
            <span className="min-w-0 break-words text-pv-text-muted">{fdbText(s, sw, USER_VLAN)}</span>
          </div>
        ))}
      </div>
      <div className="border-t border-pv-border pt-2">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">Pings</p>
        {s.pings.length === 0 ? (
          <p className="text-pv-text-faint">Not run yet.</p>
        ) : (
          s.pings.map((p) => (
            <div key={p.label} className="flex justify-between gap-2 pv-mono text-[10.5px]">
              <span className="text-pv-text">
                {p.label} · VLAN {p.vlan}
              </span>
              <span className={p.received === p.sent ? "text-pv-success" : "text-pv-warning"}>
                {p.received}/{p.sent}
              </span>
            </div>
          ))
        )}
      </div>
    </GlassPanel>
  );
}
