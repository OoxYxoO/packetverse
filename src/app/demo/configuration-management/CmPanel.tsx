import { SWITCHES, synced, type CmState } from "@/lib/sim-engine/scenarios/ccna/configManagement";

/** Side panel: the source of truth, each switch's actual state, the last PLAY RECAP and Terraform's plan/state. */
export function CmPanel({ s }: { s: CmState }) {
  const run = s.runs[s.runs.length - 1];
  return (
    <div className="space-y-3 text-xs">
      <section className="rounded-xl border border-pv-border bg-pv-surface/60 p-3" aria-label="Source of truth">
        <h3 className="font-semibold text-pv-text">Git · group_vars/access.yml</h3>
        <pre className="mt-2 whitespace-pre-wrap font-mono text-[10.5px] text-pv-text-muted">{`ntp_server: ${s.desired.ntp}\nbanner: "${s.desired.banner}"`}</pre>
      </section>
      <section className="rounded-xl border border-pv-border bg-pv-surface/60 p-3" aria-label="Switches">
        <h3 className="font-semibold text-pv-text">Access switches · actual</h3>
        <ul className="mt-2 space-y-0.5 font-mono text-[10.5px]">
          {SWITCHES.map((id) => {
            const a = s.actual[id];
            const drift = a.ntp !== s.desired.ntp || a.banner !== s.desired.banner;
            return (
              <li key={id} className={drift ? "text-pv-warning" : "text-pv-text-muted"}>
                {id} · ntp {a.ntp} {synced(s, id) ? "✓" : "✗ unsynchronized"}
                {a.banner !== s.desired.banner ? ` · banner "${a.banner}"` : ""}
              </li>
            );
          })}
        </ul>
      </section>
      {run ? (
        <p className="font-mono text-[10.5px] text-pv-text-muted">
          PLAY RECAP{run.mode === "check" ? " (check)" : ""}: ok={run.ok.length} {run.mode === "check" ? "would change" : "changed"}={run.changed.length}
        </p>
      ) : null}
      {s.tfPlan ? (
        <section className="rounded-xl border border-pv-border bg-pv-surface/60 p-3" aria-label="Terraform">
          <h3 className="font-semibold text-pv-text">Terraform</h3>
          <p className="mt-1 font-mono text-[10.5px] text-pv-text-muted">
            plan: {s.tfPlan.add} to add, {s.tfPlan.change} to change, {s.tfPlan.destroy} to destroy
          </p>
          <ul className="mt-1 font-mono text-[10.5px] text-pv-text-faint">
            {s.tfState.map((r) => (
              <li key={r.address}>
                state: {r.address} ({r.attrs})
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
