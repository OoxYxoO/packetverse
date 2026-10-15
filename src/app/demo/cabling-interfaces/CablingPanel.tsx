import { RUNS, chooseMedium, linkText, mediaCheck, mismatch, printerLink, type CablingState, type Counters } from "@/lib/sim-engine/scenarios/ccna/cabling";

/** Side panel: every chosen run checked against every medium, and the printer link's two ends with their counters. */
export function CablingPanel({ s }: { s: CablingState }) {
  const runs = RUNS.filter((r) => s.chosen.includes(r.id));
  return (
    <div className="space-y-3 text-xs">
      {runs.length ? (
        <section className="rounded-xl border border-pv-border bg-pv-surface/60 p-3" aria-label="Media checked against each run">
          <h3 className="font-semibold text-pv-text">Media selection</h3>
          {runs.map((r) => {
            const pick = chooseMedium(r);
            return (
              <div key={r.id} className="mt-2">
                <p className="text-pv-text-muted">
                  {r.from} → {r.to} · <span className="font-mono text-pv-text">{r.metres >= 1000 ? `${r.metres / 1000} km` : `${r.metres} m`}</span> at <span className="font-mono text-pv-text">{r.gbps} Gb/s</span>
                </p>
                <ul className="mt-1 space-y-0.5 font-mono text-[10.5px]">
                  {mediaCheck(r).map((c) => (
                    <li key={c.medium.id} className={`flex justify-between gap-2 ${c.medium.id === pick.id ? "text-pv-success" : c.ok ? "text-pv-text-muted" : "text-pv-text-faint line-through"}`}>
                      <span>
                        {c.medium.name}
                        {c.medium.legacy ? " (legacy)" : ""}
                      </span>
                      <span>{c.reach === undefined ? "n/a" : c.reach >= 1000 ? `${c.reach / 1000} km` : `${c.reach} m`}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </section>
      ) : null}
      <PrinterLink s={s} />
    </div>
  );
}

const rows = (c: Counters | undefined, keys: (keyof Counters)[]) => keys.map((k) => [k, c ? c[k] : 0] as const);
const LABEL: Record<keyof Counters, string> = { sent: "frames sent", delivered: "frames received", collisions: "collisions", lateCollisions: "late collisions", crc: "CRC errors", runts: "runts" };

function PrinterLink({ s }: { s: CablingState }) {
  const n = printerLink(s);
  const bad = mismatch(s);
  const delta = (side: "sw" | "pr", k: keyof Counters) => (s.counters ? s.counters[side][k] : 0);
  return (
    <section className={`rounded-xl border p-3 ${bad ? "border-pv-danger/40 bg-pv-danger/5" : "border-pv-border bg-pv-surface/60"}`} aria-label="Printer link, both ends">
      <h3 className="font-semibold text-pv-text">Printer link · Cat6 · 30 m</h3>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {(
          [
            ["ACC-SW1 Gi1/0/7", s.swPort, n.a, "sw", ["crc", "runts", "delivered"]],
            ["PRINTER", s.printer, n.b, "pr", ["collisions", "lateCollisions", "delivered"]],
          ] as const
        ).map(([name, cfg, res, side, keys]) => (
          <div key={name} className="min-w-0 rounded-lg bg-black/20 p-2">
            <p className="truncate font-semibold text-pv-text">{name}</p>
            <p className="text-pv-text-faint">
              set: {cfg.speed}/{cfg.duplex}
            </p>
            <p className={bad && res.duplex === "half" ? "text-pv-danger" : "text-pv-text-muted"}>{linkText(res)}</p>
            <ul className="mt-1 space-y-0.5 font-mono text-[10.5px]">
              {rows(s.counters?.[side], [...keys]).map(([k]) => (
                <li key={k} className={`flex justify-between gap-1 ${k !== "delivered" && delta(side, k) > 0 ? "text-pv-danger" : "text-pv-text-muted"}`}>
                  <span>{LABEL[k]}</span>
                  <span>{delta(side, k)}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      {!s.counters ? <p className="mt-2 text-pv-text-faint">No traffic counted yet.</p> : null}
    </section>
  );
}
