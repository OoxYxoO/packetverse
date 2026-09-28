"use client";

import { clsx } from "clsx";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { APP_POLICY, HYSTERESIS_INTERVALS, SD, TUN_IDS, TUNNELS, metricText, slaChecks, tunStatus, type SdState } from "@/lib/sim-engine/scenarios/sdwanPathSelection";

/** Per-path underlay / overlay / monitor / SLA checks and the per-class selection — from the SHOWN state (historical-aware). */
export function SdwanPathPanel({ s }: { s: SdState }) {
  return (
    <GlassPanel className="space-y-3 p-4 text-[11px]">
      <p className="text-[10px] text-pv-text-faint">PacketVerse generic SD-WAN model · Voice SLA per interval of 500 ICMP probes</p>
      {TUN_IDS.map((t) => {
        const x = s.tun[t];
        const checks = slaChecks(x.last);
        return (
          <div key={t} className="min-w-0 border-t border-pv-border pt-2 first-of-type:border-t-0 first-of-type:pt-0">
            <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">
                {t} · over {TUNNELS[t].isp}
              </p>
              <span className={clsx("pv-mono text-[10px] font-semibold", x.eligible ? "text-pv-success" : "text-pv-warning")}>{tunStatus(x)}</span>
            </div>
            <Row k="Underlay · overlay" v={`${TUNNELS[t].isp} ${x.underlay} · ${x.overlay}`} />
            <Row k="Probe target" v={x.target} tone={x.target !== SD.hubLo ? "text-pv-warning" : undefined} />
            <Row k={`Interval #${x.last.interval}`} v={metricText(x.last)} />
            {checks.length > 0 ? (
              <div className="mt-1 grid grid-cols-[auto_1fr_auto_auto] gap-x-2 pv-mono text-[10.5px]">
                {checks.map((c) => (
                  <div key={c.metric} className="contents">
                    <span className="text-pv-text-faint">{c.metric}</span>
                    <span className="text-right text-pv-text">{c.value}</span>
                    <span className="text-pv-text-faint">{c.threshold}</span>
                    <span className={c.pass ? "text-pv-success" : "text-pv-danger"}>{c.pass ? "PASS" : "FAIL"}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-1 text-pv-danger">No valid replies — no SLA result</p>
            )}
            {!x.eligible && x.streak > 0 && <Row k="Recovery (modeled)" v={`${x.streak}/${HYSTERESIS_INTERVALS} passing intervals`} tone="text-pv-warning" />}
          </div>
        );
      })}
      <div className="border-t border-pv-border pt-2">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">Application steering (local)</p>
        {(["VOICE", "BULK"] as const).map((c) => (
          <Row key={c} k={`${c} · ${APP_POLICY[c].slaRequired ? "SLA required" : "no SLA"} · ${APP_POLICY[c].prefer.join("→")}`} v={s.selection[c] === "NONE" ? "no eligible path — dropped" : s.selection[c]} tone={s.selection[c] === "NONE" ? "text-pv-danger" : "text-pv-success"} />
        ))}
      </div>
    </GlassPanel>
  );
}

function Row({ k, v, tone }: { k: string; v: string; tone?: string }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-3">
      <span className="text-pv-text-faint">{k}</span>
      <span className={clsx("pv-mono break-all text-right", tone ?? "text-pv-text")}>{v}</span>
    </div>
  );
}
