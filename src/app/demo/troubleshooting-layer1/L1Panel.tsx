"use client";

import { clsx } from "clsx";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { PV_THRESH, UPLINK, dbm, rxBand, snapshotsOf, type L1State, type Sw } from "@/lib/sim-engine/scenarios/troubleshootingLayer1";

const fmt = (n: number) => n.toLocaleString("en-US");
const SWS: Sw[] = ["ACCESS-SW", "DIST-SW"];

/** Evidence the lesson has actually collected at the SHOWN step: link state, optical readings taken, counter snapshots, ping series. */
export function L1Panel({ s }: { s: L1State }) {
  const reading = s.opticsLog.at(-1);
  return (
    <GlassPanel className="space-y-3 p-4 text-[11px]">
      <div>
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">{UPLINK} link state</p>
        {SWS.map((sw) => (
          <div key={sw} className="flex flex-wrap justify-between gap-x-2 pv-mono text-[10.5px]">
            <span className="text-pv-text">{sw}</span>
            <span className="text-pv-text-muted">
              admin {s.admin[sw]} · oper <span className={s.oper[sw] === "up" ? "text-pv-success" : "text-pv-danger"}>{s.oper[sw]}</span> · 1000/full · transitions {s.counters[sw].carrierTransitions}
            </span>
          </div>
        ))}
      </div>
      <div className="border-t border-pv-border pt-2">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">Optical readings taken {reading ? `· ${reading.label}` : ""}</p>
        {reading ? (
          SWS.map((sw) => {
            const band = rxBand(reading.optics[sw].rx);
            return (
              <div key={sw} className="flex flex-wrap justify-between gap-x-2 pv-mono text-[10.5px]">
                <span className="text-pv-text">{sw}</span>
                <span className={clsx(band === "normal" ? "text-pv-text-muted" : "text-pv-warning")}>
                  Tx {dbm(reading.optics[sw].tx)} · Rx {dbm(reading.optics[sw].rx)} · {band}
                </span>
              </div>
            );
          })
        ) : (
          <p className="text-pv-text-faint">None taken yet.</p>
        )}
        <p className="mt-1 text-[10px] text-pv-text-faint">
          PacketVerse lesson thresholds: normal ≥ {PV_THRESH.normalMin.toFixed(1)} dBm · marginal to {PV_THRESH.marginalMin.toFixed(1)} dBm · below = loss of signal. Real limits come from the optic&apos;s own DOM thresholds.
        </p>
      </div>
      <div className="border-t border-pv-border pt-2">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">Counter snapshots · ACCESS-SW {UPLINK}</p>
        {snapshotsOf(s, "ACCESS-SW").length === 0 ? (
          <p className="text-pv-text-faint">None taken yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[300px] pv-mono text-[10px]">
              <thead className="text-pv-text-faint">
                <tr>
                  <th className="pr-2 text-left font-semibold">Snapshot</th>
                  <th className="pr-2 text-right font-semibold">t (s)</th>
                  <th className="pr-2 text-right font-semibold">CRC</th>
                  <th className="text-right font-semibold">Δ CRC</th>
                </tr>
              </thead>
              <tbody>
                {snapshotsOf(s, "ACCESS-SW").map((x, i, all) => {
                  const d = i > 0 ? x.c.crc - all[i - 1].c.crc : undefined;
                  const sameWindow = i > 0 && all[i - 1].label.split(" ")[0] === x.label.split(" ")[0];
                  return (
                    <tr key={`${x.label}-${i}`} className="text-pv-text">
                      <td className="pr-2">{x.label}</td>
                      <td className="pr-2 text-right">{x.t}</td>
                      <td className="pr-2 text-right">{fmt(x.c.crc)}</td>
                      <td className={clsx("text-right", sameWindow && d ? "text-pv-warning" : "text-pv-text-faint")}>{sameWindow && d !== undefined ? `+${d}` : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className="border-t border-pv-border pt-2">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">Ping CLIENT → SERVER (×100)</p>
        {s.pings.length === 0 ? (
          <p className="text-pv-text-faint">Not run yet.</p>
        ) : (
          s.pings.map((p) => (
            <div key={p.series} className="flex justify-between gap-2 pv-mono text-[10.5px]">
              <span className="text-pv-text">{p.series}</span>
              <span className={p.lost.length ? "text-pv-warning" : "text-pv-success"}>
                {p.received}/{p.sent} · {p.sent - p.received}% loss
              </span>
            </div>
          ))
        )}
      </div>
    </GlassPanel>
  );
}
