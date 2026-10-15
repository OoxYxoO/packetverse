import { BASE, FIT, SAMPLES, SPIKE_MS, WEEKS, weeksUntil, type AiState } from "@/lib/sim-engine/scenarios/ccna/aiOps";

const W = 260;
const H = 70;

/** Latency samples with the learned mean ± 3σ band, and the scored spike. */
function BaselineChart({ spike }: { spike: boolean }) {
  const lo = 15;
  const hi = 33;
  const y = (v: number) => H - ((v - lo) / (hi - lo)) * H;
  const x = (i: number) => (i / (SAMPLES.length - 1)) * (W - 12);
  const pts = SAMPLES.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 h-auto w-full" role="img" aria-label={`Latency over 24 hours around ${BASE.mean} ms; band mean ± 3σ; ${spike ? `spike ${SPIKE_MS} ms outside the band` : "no spike yet"}`}>
      <rect x={0} y={y(BASE.mean + 3 * BASE.sd)} width={W} height={y(BASE.mean - 3 * BASE.sd) - y(BASE.mean + 3 * BASE.sd)} fill="currentColor" className="text-pv-cyan-soft" opacity={0.12} />
      <polyline points={pts} fill="none" stroke="currentColor" className="text-pv-cyan-soft" strokeWidth={1} />
      {spike ? <circle cx={W - 6} cy={y(SPIKE_MS)} r={3.5} fill="currentColor" className="text-pv-danger" /> : null}
    </svg>
  );
}

/** Weekly peaks with the least-squares line extended to 80%. */
function ForecastChart() {
  const n = WEEKS.length + weeksUntil(80);
  const x = (w: number) => ((w - 1) / (n - 1)) * (W - 10) + 5;
  const y = (v: number) => H - ((v - 30) / 60) * H;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 h-auto w-full" role="img" aria-label={`Peak utilization ${WEEKS[0]}% to ${WEEKS[WEEKS.length - 1]}% over 12 weeks; trend reaches 80% in about ${weeksUntil(80)} weeks`}>
      <line x1={0} x2={W} y1={y(80)} y2={y(80)} stroke="currentColor" className="text-pv-warning" strokeDasharray="3 3" strokeWidth={1} />
      <line x1={x(1)} y1={y(FIT.intercept + FIT.slope)} x2={x(n)} y2={y(FIT.intercept + FIT.slope * n)} stroke="currentColor" className="text-pv-text-faint" strokeWidth={1} />
      {WEEKS.map((v, i) => (
        <circle key={i} cx={x(i + 1)} cy={y(v)} r={2.5} fill="currentColor" className="text-pv-cyan-soft" />
      ))}
    </svg>
  );
}

/** Side panel: what the analytics platform learned, and the AI draft's test results. */
export function AiPanel({ s }: { s: AiState }) {
  return (
    <div className="space-y-3 text-xs">
      {s.baseline ? (
        <section className="rounded-xl border border-pv-border bg-pv-surface/60 p-3" aria-label="Latency baseline">
          <h3 className="font-semibold text-pv-text">WAN latency · learned baseline</h3>
          <p className="mt-1 font-mono text-[10.5px] text-pv-text-muted">
            {BASE.mean} ± {BASE.sd} ms (band = ±3σ){s.anomaly ? ` · ${s.anomaly.x} ms → z ${s.anomaly.z}` : ""}
          </p>
          <BaselineChart spike={!!s.anomaly} />
        </section>
      ) : null}
      {s.forecast ? (
        <section className="rounded-xl border border-pv-border bg-pv-surface/60 p-3" aria-label="Capacity forecast">
          <h3 className="font-semibold text-pv-text">Internet link · peak utilization</h3>
          <p className="mt-1 font-mono text-[10.5px] text-pv-text-muted">
            +{FIT.slope}%/week · 80% in ~{weeksUntil(80)} weeks
          </p>
          <ForecastChart />
        </section>
      ) : null}
      {s.tests ? (
        <section className="rounded-xl border border-pv-border bg-pv-surface/60 p-3" aria-label="ACL tests">
          <h3 className="font-semibold text-pv-text">GUEST-IN · intended flows</h3>
          <ul className="mt-2 space-y-0.5 font-mono text-[10.5px]">
            {s.tests.map((t) => (
              <li key={t.flow.id} className={t.got === t.expect ? "text-pv-success" : "text-pv-danger"}>
                {t.flow.label}: {t.got} ({t.line === "implicit" ? "implicit deny" : `line ${t.line}`}) · expected {t.expect}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
