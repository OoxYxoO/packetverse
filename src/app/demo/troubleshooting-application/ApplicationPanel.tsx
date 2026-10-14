"use client";

import { clsx } from "clsx";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { NAME, RECORD_TTL, cached, remaining, type ApState } from "@/lib/sim-engine/scenarios/troubleshootingApplication";

/** Client cache, DNS answers, authoritative record and HTTP results at the SHOWN step. */
export function ApplicationPanel({ s }: { s: ApState }) {
  const c = cached(s);
  // The authoritative record is shown once it has been checked (design, dig @authoritative) — not before.
  const showAuth = !s.faultActive || s.hops.some((h) => h.stepId === "inc-authoritative");
  return (
    <GlassPanel className="space-y-3 p-4 text-[11px]">
      <div>
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">CLIENT DNS cache</p>
        <p className="pv-mono text-[10.5px] break-words text-pv-text">{c ? `${NAME} → ${c.address} · ${remaining(s)} s left` : `${NAME}: no fresh entry`}</p>
      </div>
      <div className="border-t border-pv-border pt-2">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">DNS answers received</p>
        {s.dnsLog.length === 0 ? (
          <p className="text-pv-text-faint">none yet</p>
        ) : (
          s.dnsLog.map((x, i) => (
            <p key={i} className="pv-mono text-[10.5px] break-words text-pv-text">
              {x.label}: A {x.answer} · TTL {x.ttl}
            </p>
          ))
        )}
        {showAuth && (
          <p className="pv-mono mt-1 text-[10.5px] break-words text-pv-text-muted">
            authoritative now: A {s.authA} · TTL {RECORD_TTL}
          </p>
        )}
      </div>
      <div className="border-t border-pv-border pt-2">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">HTTP results</p>
        {s.http.length === 0 ? (
          <p className="text-pv-text-faint">none yet</p>
        ) : (
          s.http.map((h, i) => (
            <p key={i} className="pv-mono text-[10.5px] break-words">
              <span className="text-pv-text-muted">{h.label}: </span>
              <span className="text-pv-text">
                {h.target}
                {h.resolved ? ` → ${h.resolved}` : ""} · TCP {h.tcp} ·{" "}
              </span>
              <span className={clsx(h.status.startsWith("200") ? "text-pv-success" : "text-pv-danger")}>{h.status}</span>
            </p>
          ))
        )}
      </div>
    </GlassPanel>
  );
}
