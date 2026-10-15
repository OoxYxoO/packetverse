import { CliPanel } from "@/components/lesson/GuideCli";
import type { NatState } from "@/lib/sim-engine/scenarios/ccna/natPat";

/** Cisco-style `show ip nat translations` from the model's table. */
export function showNat(s: NatState) {
  const pad = (x: string, n: number) => x.padEnd(n);
  return {
    prompt: "R1#",
    command: "show ip nat translations",
    output: [
      `${pad("Pro", 5)}${pad("Inside global", 22)}${pad("Inside local", 22)}${pad("Outside local", 22)}Outside global`,
      ...s.table.map((x) => `${pad(x.proto, 5)}${pad(x.insideGlobal, 22)}${pad(x.insideLocal, 22)}${pad(x.outsideGlobal, 22)}${x.outsideGlobal}`),
    ].join("\n"),
  };
}

/** Side panel: NAT mode, ACL 1 and the translation table. */
export function NatPanel({ s }: { s: NatState }) {
  return (
    <div className="space-y-3 text-xs">
      <section className="rounded-xl border border-pv-border bg-pv-surface/60 p-3" aria-label="NAT configuration">
        <h3 className="font-semibold text-pv-text">R1 NAT</h3>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono text-[10.5px] text-pv-text-muted">
          <dt>mode</dt>
          <dd className="text-pv-text">{s.mode === "none" ? "static only" : s.mode === "dynamic" ? "dynamic pool .3–.4" : "PAT overload Gi0/1"}</dd>
          <dt>ACL 1</dt>
          <dd className="text-pv-text">{s.acl.map(([p, l]) => `permit ${p}/${l}`).join(" · ")}</dd>
        </dl>
      </section>
      <CliPanel run={showNat(s)} caption="R1 · translations" />
      {s.results.length ? (
        <ul className="space-y-0.5 rounded-xl border border-pv-border p-3 font-mono text-[10.5px] text-pv-text-muted" aria-label="What happened to each flow">
          {s.results.map((r, i) => (
            <li key={i} className={/dropped|untranslated/.test(r) ? "text-pv-danger" : ""}>
              {r}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
