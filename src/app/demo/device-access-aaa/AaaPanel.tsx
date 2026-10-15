import { listText, type AaaState } from "@/lib/sim-engine/scenarios/ccna/deviceAccess";

/** Side panel: each switch's login method list in order, the latest attempt walked method by method, and accounting. */
export function AaaPanel({ s }: { s: AaaState }) {
  const last = s.attempts[s.attempts.length - 1];
  return (
    <div className="space-y-3 text-xs">
      <section className="rounded-xl border border-pv-border bg-pv-surface/60 p-3" aria-label="Login method lists">
        <h3 className="font-semibold text-pv-text">Login method lists</h3>
        <dl className="mt-2 space-y-1 font-mono text-[10.5px] text-pv-text-muted">
          {Object.entries(s.lists)
            .filter(([dev]) => dev === "SW1" || s.faultActive || s.repaired)
            .map(([dev, l]) => (
            <div key={dev}>
              <dt className="text-pv-text">{dev}</dt>
              <dd className="break-words">{s.aaa || dev !== "SW1" ? listText(l) : "login local (no AAA yet)"}</dd>
              <dd className="text-pv-text-faint">local users: {(s.localUsers[dev] ?? []).join(", ") || "none"}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-2 text-[10.5px] text-pv-text-faint">TACACS+ server: {s.serverUp ? "reachable" : "no reply"}</p>
      </section>
      {last ? (
        <section className="rounded-xl border border-pv-border bg-pv-surface/60 p-3" aria-label="Latest login">
          <h3 className="font-semibold text-pv-text">
            Latest login · {last.user} → {last.device}
          </h3>
          <ol className="mt-2 space-y-1 font-mono text-[10.5px]">
            {last.trace.map((t, i) => (
              <li key={i} className={t.outcome === "ACCEPT" ? "text-pv-success" : t.outcome === "REJECT" ? "text-pv-danger" : "text-pv-warning"}>
                {i + 1}. {t.method === "tacacs" ? "TACACS+" : "local"} → {t.outcome} <span className="text-pv-text-faint">({t.why})</span>
              </li>
            ))}
          </ol>
          <p className={`mt-1 font-semibold ${last.result === "ACCEPT" ? "text-pv-success" : "text-pv-danger"}`}>{last.result === "ACCEPT" ? "Login accepted" : "Login rejected"}</p>
        </section>
      ) : null}
      {s.accounting.length ? (
        <section className="rounded-xl border border-pv-border bg-pv-surface/60 p-3" aria-label="Accounting log">
          <h3 className="font-semibold text-pv-text">Accounting (TACACS+ server)</h3>
          <ul className="mt-2 space-y-0.5 font-mono text-[10.5px] text-pv-text-muted">
            {s.accounting.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
