import { ARCH, poeTable, shortest, switchLinks, type CompState, type PoeSwitch } from "@/lib/sim-engine/scenarios/ccna/componentsArch";

const NAMES = { soho: "SOHO", "two-tier": "2-tier collapsed core", "three-tier": "3-tier", "spine-leaf": "Spine-leaf" } as const;

/** Side panel: the current design's measured paths (BFS over the drawn graph) and each access switch's PoE budget. */
export function CompPanel({ s }: { s: CompState }) {
  return (
    <div className="space-y-3 text-xs">
      {s.view !== "campus" && s.measured.includes(s.view) ? <ArchFacts view={s.view} /> : null}
      {(["ACC-SW1", "ACC-SW2"] as PoeSwitch[]).map((sw) => (
        <PoeCard key={sw} s={s} sw={sw} />
      ))}
    </div>
  );
}

function ArchFacts({ view }: { view: keyof typeof ARCH }) {
  const g = ARCH[view];
  const r = shortest(g);
  return (
    <section className="rounded-xl border border-pv-ip/30 bg-pv-ip/5 p-3" aria-label={`${NAMES[view]} measured paths`}>
      <h3 className="font-semibold text-pv-text">{NAMES[view]}</h3>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-pv-text-muted">
        <dt>Shortest path</dt>
        <dd className="text-right font-mono text-pv-text">{r.links} links</dd>
        <dt>Equal shortest paths</dt>
        <dd className="text-right font-mono text-pv-text">{r.paths}</dd>
        <dt>Switch-to-switch links</dt>
        <dd className="text-right font-mono text-pv-text">{switchLinks(g)}</dd>
      </dl>
      <p className="mt-2 break-words font-mono text-[10.5px] text-pv-text-faint">{r.example.join(" → ")}</p>
    </section>
  );
}

function PoeCard({ s, sw }: { s: CompState; sw: PoeSwitch }) {
  const t = poeTable(s, sw);
  const pct = Math.min(100, Math.round((t.used / t.budget) * 100));
  const denied = t.grants.filter((g) => !g.powered);
  return (
    <section className={`rounded-xl border p-3 ${denied.length ? "border-pv-danger/40 bg-pv-danger/5" : "border-pv-border bg-pv-surface/60"}`} aria-label={`${sw} PoE budget`}>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-semibold text-pv-text">{sw} · PoE</h3>
        <span className="font-mono text-pv-text-muted">
          {t.used} / {t.budget} W
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/30" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${sw} power reserved`}>
        <div className={`h-full ${pct > 90 ? "bg-pv-warning" : "bg-pv-success"}`} style={{ width: `${pct}%` }} />
      </div>
      <ul className="mt-2 space-y-0.5 font-mono text-[10.5px]">
        {t.grants.map((g) => (
          <li key={g.device} className={`flex justify-between gap-2 ${g.powered ? "text-pv-text-muted" : "text-pv-danger"}`}>
            <span>
              {g.port} {g.device}
            </span>
            <span>{g.powered ? `${g.watts} W` : `denied (${g.watts} W)`}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
