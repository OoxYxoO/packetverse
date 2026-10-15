import { FOOTPRINT, HOST_CAPACITY, VRF_TABLES, fits, type HostId, type VirtState } from "@/lib/sim-engine/scenarios/ccna/virtualization";

/** Side panel: each host's port groups and VMs, VM-vs-container density on one host, and R1's VRF tables. */
export function VirtPanel({ s }: { s: VirtState }) {
  return (
    <div className="space-y-3 text-xs">
      <section className="rounded-xl border border-pv-border bg-pv-surface/60 p-3" aria-label="Virtual switches">
        <h3 className="font-semibold text-pv-text">Virtual switches</h3>
        {(["HOST1", "HOST2"] as HostId[]).map((h) => (
          <div key={h} className="mt-2">
            <p className="text-pv-text-muted">{h}</p>
            <ul className="mt-0.5 space-y-0.5 font-mono text-[10.5px]">
              {Object.entries(s.portGroups[h]).map(([pg, vlan]) => (
                <li key={pg} className="flex justify-between gap-2 text-pv-text-muted">
                  <span>
                    port group {pg} → VLAN {vlan}
                  </span>
                  <span className="text-pv-text">
                    {(Object.keys(s.vmHost) as (keyof VirtState["vmHost"])[])
                      .filter((v) => s.vmHost[v] === h && s.vmPg[v] === pg)
                      .join(", ") || "—"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>
      <section className="rounded-xl border border-pv-border bg-pv-surface/60 p-3" aria-label="Density on one host">
        <h3 className="font-semibold text-pv-text">
          One {HOST_CAPACITY.ramGb} GB host fits…
        </h3>
        {(["vm", "container"] as const).map((k) => {
          const n = fits(k);
          return (
            <div key={k} className="mt-2">
              <div className="flex justify-between text-pv-text-muted">
                <span>{FOOTPRINT[k].label}</span>
                <span className="font-mono text-pv-text">{n}</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-black/30" aria-hidden="true">
                <div className={k === "vm" ? "h-full bg-pv-violet" : "h-full bg-pv-success"} style={{ width: `${Math.min(100, (n / fits("container")) * 100)}%` }} />
              </div>
              <p className="mt-0.5 text-[10.5px] text-pv-text-faint">
                {FOOTPRINT[k].note} · boots in ~{FOOTPRINT[k].bootSeconds} s
              </p>
            </div>
          );
        })}
      </section>
      <section className="rounded-xl border border-pv-border bg-pv-surface/60 p-3" aria-label="R1 VRF tables">
        <h3 className="font-semibold text-pv-text">R1 · one table per VRF</h3>
        {(["CUST-A", "CUST-B"] as const).map((v) => (
          <div key={v} className="mt-2">
            <p className="text-pv-text-muted">VRF {v}</p>
            <ul className="mt-0.5 space-y-0.5 font-mono text-[10.5px] text-pv-text-muted">
              {VRF_TABLES[v].map((r) => (
                <li key={r.prefix} className="flex justify-between gap-2">
                  <span>{r.prefix}</span>
                  <span>{r.via === "connected" ? r.iface : `via ${r.via}`}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>
    </div>
  );
}
