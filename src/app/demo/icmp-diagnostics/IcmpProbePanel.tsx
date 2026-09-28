"use client";

import { useState } from "react";
import { clsx } from "clsx";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { ECHO_IDENTIFIER, FAULT_MTU, type IcmpState } from "@/lib/sim-engine/scenarios/icmpDiagnostics";

/** Probe + path facts from the SHOWN state (historical-aware): probe size/DF, transit MTU and traceroute results. */
export function IcmpProbePanel({ s }: { s: IcmpState }) {
  const total = 20 + 8 + s.probe.dataLength;
  return (
    <GlassPanel className="space-y-3 p-4">
      <div>
        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">Probe</p>
        <div className="space-y-0.5 text-[11px]">
          <Row k="Echo identifier" v={String(ECHO_IDENTIFIER)} />
          <Row k="Size" v={`20 + 8 + ${s.probe.dataLength} = ${total} B`} />
          <Row k="DF" v={s.probe.df ? "set" : "clear"} />
          <Row k="Transit IP MTU" v={`${s.transitMtu} B`} />
        </div>
      </div>
      <div>
        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">Traceroute (ICMP Echo)</p>
        {s.traceResults.length === 0 ? (
          <p className="text-[11px] text-pv-text-faint">no probes yet</p>
        ) : (
          <ol className="space-y-0.5 pv-mono text-[11px]">
            {s.traceResults.map((t) => (
              <li key={t.ttl} className="flex flex-wrap justify-between gap-x-3">
                <span className="text-pv-text">
                  {t.ttl} · {t.from}
                </span>
                <span className="text-pv-text-faint">{t.message}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </GlassPanel>
  );
}

function Row({ k, v, warn }: { k: string; v: string; warn?: boolean }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-3">
      <span className="text-pv-text-faint">{k}</span>
      <span className={clsx("pv-mono", warn ? "text-pv-danger" : "text-pv-text")}>{v}</span>
    </div>
  );
}

/** Interactive PMTU calculator: pick an ICMP data size and see whether a DF packet fits a given IP MTU. */
export function PmtuCalculator({ mtu = FAULT_MTU }: { mtu?: number }) {
  const [data, setData] = useState(1472);
  const total = 20 + 8 + data;
  const fits = total <= mtu;
  return (
    <GlassPanel className="space-y-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-pv-cyan-soft">DF packet size vs IP MTU</h3>
        <span className="pv-mono text-xs text-pv-text-muted">IP MTU {mtu}</span>
      </div>
      <label className="flex flex-wrap items-center gap-3 text-xs text-pv-text-muted">
        ICMP data
        <input type="range" min={56} max={1472} value={data} onChange={(e) => setData(Number(e.target.value))} className="min-w-0 flex-1 accent-cyan-400" aria-label="ICMP data bytes" />
        <span className="pv-mono w-12 text-right text-pv-text">{data}</span>
      </label>
      <div className="flex flex-wrap gap-1.5">
        {[56, 1372, 1400, 1472].map((d) => (
          <button key={d} type="button" aria-pressed={d === data} onClick={() => setData(d)} className={clsx("cursor-pointer rounded-full border px-2.5 py-0.5 pv-mono text-[11px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pv-cyan", d === data ? "border-pv-cyan/60 bg-pv-cyan/15 text-pv-cyan-soft" : "border-pv-border text-pv-text-muted")}>
            {d} B
          </button>
        ))}
      </div>
      <p className="pv-mono text-xs text-pv-text">
        20 (IPv4) + 8 (ICMP) + {data} = {total} B
      </p>
      <p className={clsx("rounded-lg border px-3 py-2 text-xs", fits ? "border-pv-success/40 bg-pv-success/5 text-pv-success" : "border-pv-danger/40 bg-pv-danger/5 text-pv-danger")}>
        {fits ? `✓ ${total} ≤ ${mtu}: forwarded unfragmented.` : `✕ ${total} > ${mtu} with DF set: dropped, ICMP Type 3 Code 4 (Next-Hop MTU ${mtu}) returned.`}
      </p>
    </GlassPanel>
  );
}
