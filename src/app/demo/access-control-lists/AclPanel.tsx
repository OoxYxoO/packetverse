import { aceText, type AclState } from "@/lib/sim-engine/scenarios/ccna/acl";

/** Cisco-style `show access-lists <name>` from the applied ACL and the model's hit counters. */
export function showAcl(s: AclState) {
  const a = s.applied;
  if (!a) return { prompt: "R1#", command: "show access-lists", output: "(no ACL applied)" };
  const lines = [...a.acl.aces].sort((x, y) => x.seq - y.seq).map((e) => {
    const n = s.hits[`${a.acl.name}:${e.seq}`] ?? 0;
    return `    ${aceText(e)}${n ? ` (${n} match${n === 1 ? "" : "es"})` : ""}`;
  });
  return { prompt: "R1#", command: `show access-lists ${a.acl.name}`, output: [`${a.acl.kind === "standard" ? "Standard" : "Extended"} IP access list ${a.acl.name}`, ...lines].join("\n") };
}

/** Side panel: where the ACL is applied, its lines with hit counters, and the last flows' verdicts. */
export function AclPanel({ s }: { s: AclState }) {
  const a = s.applied;
  const run = showAcl(s);
  const implicit = a ? (s.hits[`${a.acl.name}:implicit`] ?? 0) : 0;
  return (
    <div className="space-y-3 text-xs">
      <section className="rounded-xl border border-pv-border bg-pv-surface/60 p-3" aria-label="Applied ACL">
        <h3 className="font-semibold text-pv-text">{a ? `ip access-group ${a.acl.name} ${a.dir} · ${a.iface}` : "No ACL applied yet"}</h3>
        <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-[10.5px] leading-relaxed text-pv-text-muted">
          <span className="text-pv-success">{run.prompt}</span>
          <span className="text-pv-text">{run.command}</span>
          {"\n"}
          {run.output}
        </pre>
        {a ? <p className="mt-1 font-mono text-[10.5px] text-pv-text-faint">(implicit) deny ip any any{implicit ? ` — ${implicit} dropped` : ""}</p> : null}
      </section>
      {s.results.length ? (
        <section className="rounded-xl border border-pv-border bg-pv-surface/60 p-3" aria-label="Flows tested">
          <h3 className="font-semibold text-pv-text">Flows tested</h3>
          <ul className="mt-2 space-y-0.5 font-mono text-[10.5px]">
            {s.results.slice(-6).map((r, i) => (
              <li key={i} className={r.verdict.action === "permit" ? "text-pv-success" : "text-pv-danger"}>
                {r.flow}: {r.verdict.action}
                <span className="text-pv-text-faint"> · {r.acl === "—" ? "no ACL on path" : r.verdict.seq === "implicit" ? "implicit deny" : `ACL ${r.acl} line ${r.verdict.seq}`}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
