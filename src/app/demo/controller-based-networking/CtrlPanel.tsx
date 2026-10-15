import { type CtrlState } from "@/lib/sim-engine/scenarios/ccna/controllerNetworking";

/** Side panel: the controller's view (inventory, intent, coverage) and the branch's cloud link. */
export function CtrlPanel({ s }: { s: CtrlState }) {
  const managed = s.switches.filter((w) => w.managed).reduce((n, w) => n + w.count, 0);
  return (
    <div className="space-y-3 text-xs">
      <section className="rounded-xl border border-pv-border bg-pv-surface/60 p-3" aria-label="Controller inventory">
        <h3 className="font-semibold text-pv-text">Controller inventory · site HQ</h3>
        <ul className="mt-2 space-y-0.5 font-mono text-[10.5px] text-pv-text-muted">
          {s.switches
            .filter((w) => w.managed)
            .map((w) => (
              <li key={w.id}>
                {w.id} ×{w.count} · VLANs {w.vlans.join(", ")}
              </li>
            ))}
        </ul>
        {s.intent ? (
          <p className="mt-2 font-mono text-[10.5px] text-pv-success">
            intent VLAN {s.intent.vlan} {s.intent.name}: task complete on {managed} switches
          </p>
        ) : null}
      </section>
      {s.newFloor ? (
        <section className="rounded-xl border border-pv-border bg-pv-surface/60 p-3" aria-label="Floor 9">
          <h3 className="font-semibold text-pv-text">Floor 9 · what is installed</h3>
          {s.switches
            .filter((w) => w.id === "SW-F9")
            .map((w) => (
              <p key={w.id} className={`mt-1 font-mono text-[10.5px] ${s.intent && !w.vlans.includes(s.intent.vlan) ? "text-pv-danger" : "text-pv-text-muted"}`}>
                {w.count} access switches · VLANs {w.vlans.join(", ")} · cameras {s.intent && w.vlans.includes(s.intent.vlan) ? "up" : "no address"}
              </p>
            ))}
        </section>
      ) : null}
      <section className="rounded-xl border border-pv-border bg-pv-surface/60 p-3" aria-label="Branch">
        <h3 className="font-semibold text-pv-text">Branch (cloud-managed)</h3>
        <p className="mt-1 font-mono text-[10.5px] text-pv-text-muted">
          dashboard link: <span className={s.cloudLink ? "text-pv-success" : "text-pv-warning"}>{s.cloudLink ? "connected" : "down"}</span> · user traffic: <span className="text-pv-success">{s.branchForwarding ? "forwarding" : "stopped"}</span>
        </p>
      </section>
      {s.log.length ? <p className="font-mono text-[10.5px] text-pv-text-faint">task log: {s.log.join(" · ")}</p> : null}
    </div>
  );
}
