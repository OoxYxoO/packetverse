"use client";

import { clsx } from "clsx";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { IP, type Fw, type FwState } from "@/lib/sim-engine/scenarios/troubleshootingFirewall";

const FWS: Fw[] = ["FW1", "FW2"];

/** Sessions, drop logs, return route and server capture at the SHOWN step. */
export function FirewallPanel({ s }: { s: FwState }) {
  return (
    <GlassPanel className="space-y-3 p-4 text-[11px]">
      {FWS.map((fw) => (
        <div key={fw} className={fw === "FW2" ? "border-t border-pv-border pt-2" : ""}>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">{fw} sessions · drops</p>
          {s.sessions[fw].length === 0 && s.drops[fw].length === 0 && <p className="text-pv-text-faint">no sessions, no drops</p>}
          {s.sessions[fw].map((x) => (
            <div key={x.flow} className="pv-mono text-[10.5px]">
              <span className="text-pv-text">:{x.tuple.split(":")[1].split(" ")[0]}</span>{" "}
              <span className={clsx(x.state === "ESTABLISHED" ? "text-pv-success" : "text-pv-warning")}>{x.state}</span>
              <span className="text-pv-text-faint">
                {" "}
                · c→s {x.c2s} / s→c {x.s2c}
              </span>
            </div>
          ))}
          {s.drops[fw].map((x, i) => (
            <p key={i} className="pv-mono text-[10px] break-words text-pv-danger">
              drop: {x.what} — {x.reason}
            </p>
          ))}
        </div>
      ))}
      <div className="border-t border-pv-border pt-2">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">Routes toward each side</p>
        <p className="pv-mono text-[10.5px] text-pv-text">EDGE-R1 10.20.20.0/24 → FW1</p>
        <p className="pv-mono text-[10.5px] text-pv-text">
          EDGE-R2 10.10.10.0/24 → {s.r2Return} ({s.r2Return === "FW1" ? IP.fw1Out : IP.fw2Out})
        </p>
      </div>
      <div className="border-t border-pv-border pt-2">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">SERVER capture</p>
        {s.serverRx.length === 0 ? (
          <p className="text-pv-text-faint">nothing yet</p>
        ) : (
          <p className="pv-mono text-[10px] break-words text-pv-text-muted">
            rx {s.serverRx.map((x) => `${x.flow}:${x.what}`).join(", ")} · tx {s.serverTx.map((x) => `${x.flow}:${x.what}`).join(", ")}
          </p>
        )}
      </div>
    </GlassPanel>
  );
}
