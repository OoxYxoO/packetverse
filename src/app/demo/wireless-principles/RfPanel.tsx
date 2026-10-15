"use client";

import { useId, useState } from "react";
import { centreMHz, overlap, quality, rssi, servingQuality, type Ap, type WifiState } from "@/lib/sim-engine/scenarios/ccna/wireless";

const TONE: Record<string, string> = { AP1: "#22d3ee", AP2: "#34d399", AP3: "#fbbf24" };

/** Side panel: the 2.4 GHz spectrum as the laptop hears it, its link quality, and a what-if channel picker for AP3. */
export function RfPanel({ s }: { s: WifiState }) {
  const qy = servingQuality(s);
  return (
    <div className="space-y-3 text-xs">
      <section className="rounded-xl border border-pv-border bg-pv-surface/60 p-3" aria-label="2.4 GHz spectrum at the laptop">
        <h3 className="font-semibold text-pv-text">2.4 GHz at the laptop</h3>
        <Spectrum aps={s.aps} at={s.laptop} />
        <ul className="mt-1 space-y-0.5 font-mono text-[10.5px]">
          {s.aps.map((a) => (
            <li key={a.id} className="flex justify-between gap-2 text-pv-text-muted">
              <span style={{ color: TONE[a.id] }}>
                {a.id} · ch {a.channel} · {centreMHz(a.channel, a.band)} MHz
              </span>
              <span>{rssi(a, s.laptop)} dBm</span>
            </li>
          ))}
        </ul>
      </section>
      {qy ? (
        <section className={`rounded-xl border p-3 ${qy.sinr < 20 ? "border-pv-danger/40 bg-pv-danger/5" : "border-pv-success/30 bg-pv-success/5"}`} aria-label="Laptop link quality">
          <h3 className="font-semibold text-pv-text">Laptop ↔ {qy.ap}</h3>
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-pv-text-muted">
            <dt>Signal</dt>
            <dd className="text-right font-mono text-pv-text">{qy.signal} dBm</dd>
            <dt>Noise + interference</dt>
            <dd className="text-right font-mono text-pv-text">{qy.noisePlusI} dBm</dd>
            <dt>SINR</dt>
            <dd className={`text-right font-mono ${qy.sinr < 20 ? "text-pv-danger" : "text-pv-success"}`}>{qy.sinr} dB</dd>
            <dt>Rate · retries</dt>
            <dd className="text-right font-mono text-pv-text">
              {qy.rateMbps} Mb/s · {qy.retryPct}%
            </dd>
            <dt>Throughput</dt>
            <dd className="text-right font-mono text-pv-text">≈{qy.goodputMbps} Mb/s</dd>
          </dl>
        </section>
      ) : null}
      {s.repaired && s.associated ? <WhatIf s={s} /> : null}
    </div>
  );
}

function Spectrum({ aps, at }: { aps: Ap[]; at: { x: number; y: number } }) {
  const w = 260;
  const h = 70;
  const fx = (mhz: number) => ((mhz - 2400) / 84) * w;
  const fy = (dbm: number) => h - ((dbm + 95) / 60) * h;
  return (
    <svg viewBox={`0 0 ${w} ${h + 14}`} className="mt-2 w-full" role="img" aria-label={aps.map((a) => `${a.id} channel ${a.channel} at ${rssi(a, at)} dBm`).join(", ")}>
      <line x1={0} y1={h} x2={w} y2={h} stroke="#3a4460" />
      {[1, 6, 11].map((c) => (
        <text key={c} x={fx(centreMHz(c, "2.4"))} y={h + 11} textAnchor="middle" fill="#8b96ac" fontSize={8}>
          {c}
        </text>
      ))}
      {aps.map((a) => {
        const c = centreMHz(a.channel, a.band);
        const top = fy(rssi(a, at));
        return <path key={a.id} d={`M${fx(c - 11)},${h} Q${fx(c - 11)},${top} ${fx(c)},${top} Q${fx(c + 11)},${top} ${fx(c + 11)},${h}`} fill={TONE[a.id]} fillOpacity={0.18} stroke={TONE[a.id]} strokeWidth={1.4} />;
      })}
    </svg>
  );
}

function WhatIf({ s }: { s: WifiState }) {
  const id = useId();
  const ap3 = s.aps.find((a) => a.id === "AP3")!;
  const [ch, setCh] = useState(ap3.channel);
  const serving = s.aps.find((a) => a.id === s.associated)!;
  const trial = s.aps.map((a) => (a.id === "AP3" ? { ...a, channel: ch } : a));
  const qy = quality(trial, trial.find((a) => a.id === serving.id)!, s.laptop);
  const ov = overlap(serving, { ...ap3, channel: ch });
  return (
    <section className="rounded-xl border border-pv-ip/30 bg-pv-ip/5 p-3" aria-label="What if AP3 used another channel">
      <label htmlFor={id} className="font-semibold text-pv-text">
        What if AP3 used channel…
      </label>
      <select id={id} value={ch} onChange={(e) => setCh(Number(e.target.value))} className="mt-2 w-full rounded-lg border border-pv-border bg-pv-bg/60 px-2 py-1.5 text-pv-text focus-visible:ring-2 focus-visible:ring-pv-cyan/40">
        {Array.from({ length: 11 }, (_, i) => i + 1).map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <p className="mt-2 text-pv-text-muted" aria-live="polite">
        Overlap with {serving.id}: <span className="font-mono text-pv-text">{Math.round(ov * 100)}%</span>
        {ov === 1 ? " (same channel — shares airtime)" : ""} · SINR <span className="font-mono text-pv-text">{qy.sinr} dB</span> · ≈<span className="font-mono text-pv-text">{qy.goodputMbps} Mb/s</span>
      </p>
      <p className="mt-1 text-[10.5px] text-pv-text-faint">A what-if only — the lesson&apos;s network doesn&apos;t change.</p>
    </section>
  );
}
