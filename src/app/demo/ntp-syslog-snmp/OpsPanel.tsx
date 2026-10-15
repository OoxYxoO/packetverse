import { CliPanel } from "@/components/lesson/GuideCli";
import { SEVERITY, fmtTime, utilisation, type Dev, type OpsState } from "@/lib/sim-engine/scenarios/ccna/ntpSyslogSnmp";

export function syslogView(s: OpsState) {
  const sorted = [...s.logs].sort((a, b) => a.stamp - b.stamp);
  return { prompt: "syslog$ ", command: "sort -k1 /var/log/network.log", output: sorted.length ? sorted.map((l) => `${fmtTime(l.stamp)} ${l.dev.padEnd(4)} %${l.mnemonic}: ${l.text}`).join("\n") : "(no messages yet)" };
}

/** Side panel: every device's clock, the syslog server's sorted timeline and the SNMP utilisation result. */
export function OpsPanel({ s }: { s: OpsState }) {
  return (
    <div className="space-y-3 text-xs">
      <section className="rounded-xl border border-pv-border bg-pv-surface/60 p-3" aria-label="Clocks">
        <h3 className="font-semibold text-pv-text">Clocks (show ntp status)</h3>
        <ul className="mt-2 space-y-0.5 font-mono text-[10.5px]">
          {(Object.keys(s.clocks) as Dev[]).map((d) => {
            const c = s.clocks[d];
            return (
              <li key={d} className={`flex justify-between gap-2 ${c.synced ? "text-pv-text-muted" : "text-pv-danger"}`}>
                <span>
                  {d} → {c.server}
                </span>
                <span>{c.synced ? `stratum ${c.stratum} · ${c.offset >= 0 ? "+" : ""}${c.offset} s` : "unsynchronised · stratum 16"}</span>
              </li>
            );
          })}
        </ul>
        <p className="mt-2 text-[10.5px] text-pv-text-faint">
          logging trap {SEVERITY[s.trapLevel]} ({s.trapLevel}) — severities 0–{s.trapLevel} are sent
        </p>
      </section>
      <CliPanel run={syslogView(s)} caption="SYSLOG · timeline by device timestamp" />
      {s.snmp.length === 2 ? <p className="rounded-lg border border-pv-border px-3 py-2 text-pv-text-muted">SW1 uplink (two polls, 300 s apart): <span className="font-mono text-pv-text">{(utilisation(s.snmp[0], s.snmp[1]) * 100).toFixed(1)} %</span> of 1 Gb/s</p> : null}
    </div>
  );
}
