import { DSCP_NAME, LINK_MBPS, POLICY, type QosState } from "@/lib/sim-engine/scenarios/ccna/qos";

/** Side panel: per-flow offered vs delivered, loss and queuing delay on the 10 Mb/s link, plus the active policy. */
export function QosPanel({ s }: { s: QosState }) {
  const res = s.results;
  return (
    <div className="space-y-3 text-xs">
      <section className="rounded-xl border border-pv-border bg-pv-surface/60 p-3" aria-label="WAN link results">
        <h3 className="font-semibold text-pv-text">
          R1 → WAN · {LINK_MBPS} Mb/s · {s.policy === "fifo" ? "FIFO" : "LLQ + CBWFQ"}
        </h3>
        {res ? (
          <ul className="mt-2 space-y-2">
            {res.map((r) => (
              <li key={r.name}>
                <div className="flex justify-between gap-2 text-pv-text-muted">
                  <span>
                    {r.name} <span className="font-mono text-pv-text-faint">DSCP {r.dscp} ({DSCP_NAME[r.dscp]}) → {r.queue}</span>
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-black/30" aria-hidden="true">
                  <div className={r.lossPct > 0 ? "h-full bg-pv-warning" : "h-full bg-pv-success"} style={{ width: `${(r.sentMbps / r.mbps) * 100}%` }} />
                </div>
                <p className={`mt-0.5 font-mono text-[10.5px] ${r.lossPct > 0 && r.dscp !== 0 ? "text-pv-danger" : r.name.startsWith("Voice") && r.lossPct > 0 ? "text-pv-danger" : "text-pv-text-muted"}`}>
                  {r.sentMbps}/{r.mbps} Mb/s · loss {r.lossPct}% · queuing {r.delayMs} ms
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-pv-text-faint">No measurement yet.</p>
        )}
      </section>
      {s.policy === "llq" ? (
        <section className="rounded-xl border border-pv-border bg-pv-surface/60 p-3 font-mono text-[10.5px] text-pv-text-muted" aria-label="Policy">
          <p>policy-map WAN-OUT</p>
          <p> class VOICE (DSCP EF) · priority {POLICY.priorityLimit} Mb/s</p>
          {POLICY.classes.map((c) => (
            <p key={c.name}>
              {" "}
              class {c.name}
              {c.dscp.length ? ` (DSCP ${c.dscp.map((d) => DSCP_NAME[d]).join(",")})` : ""} · {c.guarantee ? `bandwidth ${c.guarantee} Mb/s` : "fair share of the rest"}
            </p>
          ))}
          {s.shaping ? <p>shape average {s.shaping.cir} Mb/s · Bc {s.shaping.bc.toLocaleString()} bits</p> : null}
        </section>
      ) : null}
    </div>
  );
}
