import { CliPanel } from "@/components/lesson/GuideCli";
import { duplicates, neighborState, present, routerId, type OdState } from "@/lib/sim-engine/scenarios/ccna/ospfDr";

const role = (s: OdState, id: string) => (s.dr === id ? "DR" : s.bdr === id ? "BDR" : "DROTHER");

/** `show ip ospf neighbor` as one router sees the segment, from the model state. */
export function showNeighbors(s: OdState, from: string) {
  return {
    prompt: `${from}#`,
    command: "show ip ospf neighbor",
    output: [
      "Neighbor ID     Pri   State           Address         Interface",
      ...present(s)
        .filter((r) => r.id !== from)
        .map((r) => {
          const st = neighborState(s, from, r.id);
          const state = st === "FULL" ? `FULL/${s.elected ? role(s, r.id) : "-"}` : st === "2-WAY" ? "2WAY/DROTHER" : "—";
          return st.startsWith("none") ? null : `${routerId(r).rid.padEnd(16)}${String(r.priority).padEnd(6)}${state.padEnd(16)}${r.ifaces[0].padEnd(16)}Gi0/0`;
        })
        .filter(Boolean),
    ].join("\n"),
  };
}

/** Side panel: router IDs and how each was chosen, the election result, and R3's view of its neighbours. */
export function OdPanel({ s }: { s: OdState }) {
  const dup = duplicates(s);
  return (
    <div className="space-y-3 text-xs">
      <section className="rounded-xl border border-pv-border bg-pv-surface/60 p-3" aria-label="Router IDs and roles">
        <h3 className="font-semibold text-pv-text">Segment 10.0.0.0/24</h3>
        <ul className="mt-2 space-y-0.5 font-mono text-[10.5px]">
          {present(s).map((r) => {
            const id = routerId(r);
            return (
              <li key={r.id} className={`flex justify-between gap-2 ${dup.has(r.id) ? "text-pv-danger" : "text-pv-text-muted"}`}>
                <span>
                  {r.id} · {s.ridsKnown ? <>RID {id.rid} <span className="text-pv-text-faint">({id.how})</span></> : r.ifaces.join(", ")}
                </span>
                <span className="text-pv-text">
                  p{r.priority} {s.elected ? role(s, r.id) : ""}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
      {s.adjShown ? <CliPanel run={showNeighbors(s, "R1")} caption="R1 · neighbours" /> : null}
      {s.adjShown ? <CliPanel run={showNeighbors(s, "R4")} caption="R4 · neighbours" /> : null}
    </div>
  );
}
