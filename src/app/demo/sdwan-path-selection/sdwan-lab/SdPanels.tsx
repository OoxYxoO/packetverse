"use client";

import { clsx } from "clsx";
import type { ReactNode } from "react";
import { CLASS_MATCH, QUALITIES, SD_CLASSES, SD_TUNS, TUN, qualityText, selectPath, slaChecks, type Quality, type SdAction, type SdNet, type SdRun } from "@/lib/sim-engine/scenarios/sdNet";

/**
 * Evidence panels of the SD-WAN Lab — each reads the lab state (or one run) and nothing else:
 *   Paths      each overlay path: condition, last measurement, every SLA check, eligibility / recovery
 *   Policy     each application: SLA required?, preference, fallback — and the path it uses now, and why
 *   Journey    every decision of a run (classification, path choice, probes, verdicts)
 *   Composer   voice and backup traffic, measurement intervals, the ISPs' conditions
 *   ladder     the troubleshooting questions, each answered from evidence
 */
export const Card = ({ title, children, tone = "plain", right }: { title: string; children: ReactNode; tone?: "plain" | "ok" | "warn" | "bad"; right?: ReactNode }) => (
  <div className={clsx("space-y-1.5 rounded-2xl border p-3", tone === "ok" ? "border-pv-success/50 bg-pv-success/[0.06]" : tone === "warn" ? "border-pv-warning/50 bg-pv-warning/[0.06]" : tone === "bad" ? "border-pv-danger/50 bg-pv-danger/[0.05]" : "border-pv-border bg-pv-bg-elevated/30")}>
    <div className="flex items-center justify-between gap-2">
      <p className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-pv-text-faint">{title}</p>
      {right}
    </div>
    {children}
  </div>
);
export function Paths({ s }: { s: SdNet }) {
  return (
    <div className="space-y-2 text-[12px]">
      {SD_TUNS.map((t) => {
        const p = s.paths[t];
        const chk = slaChecks(s.cfg, p.last);
        return (
          <div key={t} className="rounded-lg border border-pv-border/60 p-2">
            <p className="flex flex-wrap items-baseline gap-x-2">
              <b className="text-pv-text">{t}</b>
              <span className="text-pv-text-faint">
                {TUN[t].isp} · {TUN[t].color}
              </span>
              <span className={clsx("pv-mono font-bold", p.quality === "down" ? "text-pv-danger" : p.eligible ? "text-pv-success" : "text-pv-warning")}>{p.quality === "down" ? "UNREACHABLE" : p.eligible ? "SLA-ELIGIBLE" : p.sla === "PASS" ? `RECOVERING ${p.streak}/${s.cfg.hold}` : "SLA ✗"}</span>
              <span className="text-pv-text-faint">condition: {p.quality} · interval {p.last.interval}</span>
            </p>
            <p className="pv-mono text-pv-text-muted">{qualityText(s, t)}</p>
            {chk.length > 0 && (
              <p className="pv-mono text-[11.5px]">
                {chk.map((c) => (
                  <span key={c.k} className={clsx("mr-2", c.ok ? "text-pv-success" : "text-pv-danger")}>
                    {c.ok ? "✓" : "✗"} {c.k} {c.v}
                    {c.unit} ≤ {c.max}
                    {c.unit}
                  </span>
                ))}
              </p>
            )}
          </div>
        );
      })}
      <p className="text-[11.5px] text-pv-text-muted">The edge only learns about a change at the next measurement interval. A path that failed must pass {s.cfg.hold} intervals in a row before voice trusts it again.</p>
    </div>
  );
}
export function Policy({ s }: { s: SdNet }) {
  return (
    <div className="space-y-1.5 text-[12px]">
      {SD_CLASSES.map((k) => {
        const sel = selectPath(s.cfg, s.paths, k);
        return (
          <div key={k} className="border-b border-pv-border/50 pb-1">
            <p className="flex flex-wrap gap-x-2">
              <b className={k === "VOICE" ? "text-[#fbbf24]" : "text-[#34d399]"}>{k}</b>
              <span className="text-pv-text-faint">{CLASS_MATCH[k]}</span>
            </p>
            <p className="pv-mono text-pv-text-muted">
              SLA {s.cfg.slaReq[k] ? `required (${s.cfg.sla.rtt} ms / ${s.cfg.sla.jitter} ms / ${s.cfg.sla.loss}%)` : "not required"} · preference {s.cfg.pref[k].join(" > ")}
              {s.cfg.slaReq[k] ? ` · no compliant path → ${s.cfg.fallback[k] ? "best path" : "drop"}` : ""}
            </p>
            <p className={clsx("pv-mono", sel.tun === "NONE" ? "text-pv-danger" : sel.fallback ? "text-pv-warning" : "text-pv-success")}>
              now: {sel.tun === "NONE" ? "DROP" : sel.tun} — {sel.why}
            </p>
          </div>
        );
      })}
    </div>
  );
}
export function Journey({ run, max = 40 }: { run: SdRun; max?: number }) {
  const rows: { hop: number; who: string; text: string; tone: "ok" | "bad" | "plain" | "learn" }[] = [];
  run.waves.forEach((w, i) => {
    for (const d of w.decisions) if (d.text || d.drop) rows.push({ hop: i + 1, who: d.dev, text: d.drop ? `${d.text ? `${d.text} · ` : ""}DROPPED — ${d.drop}` : d.text, tone: d.drop ? "bad" : /SLA FAIL|not eligible/.test(d.text) ? "bad" : /→ TUN-/.test(d.text) ? "learn" : "plain" });
    for (const r of w.rx) rows.push({ hop: i + 1, who: r.dev, text: r.why.replace(new RegExp(`^${r.dev}: `), ""), tone: r.ok ? "ok" : "bad" });
  });
  return (
    <div className="max-h-[360px] overflow-y-auto">
      <table className="w-full text-left text-[12px]">
        <tbody>
          {rows.slice(0, max).map((r, i) => (
            <tr key={i} className="border-t border-pv-border/40 align-top">
              <td className="pv-mono px-1.5 py-0.5 text-pv-text-faint">{r.hop}</td>
              <td className="whitespace-nowrap px-1.5 py-0.5 font-semibold text-pv-text">{r.who}</td>
              <td className={clsx("px-1.5 py-0.5", r.tone === "ok" ? "text-pv-success" : r.tone === "bad" ? "text-pv-danger" : r.tone === "learn" ? "text-pv-violet" : "text-pv-text-muted")}>{r.text}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function Composer({ s, act, busy }: { s: SdNet; act: (a: SdAction) => void; busy: boolean }) {
  const b = "rounded-full border border-pv-border px-2.5 py-0.5 text-[12px] font-semibold text-pv-text-muted hover:border-pv-cyan/60 hover:text-pv-text disabled:opacity-40";
  const sel = "rounded-md border border-pv-border bg-pv-bg px-1.5 py-0.5 text-[12px] text-pv-text";
  return (
    <Card title="Generate traffic · run the WAN">
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" className={clsx(b, "border-[#fbbf24]/60 text-pv-text")} disabled={busy} onClick={() => act({ type: "traffic", kinds: ["VOICE"] })}>
          Place a call ▶
        </button>
        <button type="button" className={clsx(b, "border-[#34d399]/60 text-pv-text")} disabled={busy} onClick={() => act({ type: "traffic", kinds: ["BULK"] })}>
          Run the backup ▶
        </button>
        <button type="button" className={b} disabled={busy} onClick={() => act({ type: "traffic", kinds: ["VOICE", "BULK"] })}>
          Call + backup together ▶
        </button>
        <button type="button" className={b} disabled={busy} onClick={() => act({ type: "measure" })}>
          Measure one interval ▶
        </button>
        <button type="button" className={b} disabled={busy} onClick={() => act({ type: "measure", count: 3 })}>
          Measure 3 intervals
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[12px] text-pv-text-muted">
        {SD_TUNS.map((t) => (
          <label key={t} className="flex items-center gap-1">
            {TUN[t].isp}:
            <select aria-label={`${TUN[t].isp} condition`} className={sel} value={s.paths[t].quality} disabled={busy} onChange={(e) => act({ type: "world", tun: t, q: e.target.value as Quality })}>
              {QUALITIES.map((q) => (
                <option key={q} value={q}>
                  {q}
                </option>
              ))}
            </select>
          </label>
        ))}
        <span className="text-[11.5px] text-pv-text-faint">(the internet&apos;s condition — not configuration)</span>
      </div>
    </Card>
  );
}
export function ladder(s: SdNet, run?: SdRun): { k: string; title: string; text: string }[] {
  const r0 = run?.results[0];
  const c = s.cfg;
  return [
    { k: "what", title: "What happens to the traffic — dropped, poor, or on the wrong path?", text: !run || !r0 ? "Reproduce the problem first." : r0.delivered ? `${r0.kind} via ${r0.tun}${r0.fallback ? " (fallback)" : ""} — quality ${r0.quality}` : `DROPPED: ${r0.fail}` },
    { k: "class", title: "Is it classified as the right application?", text: r0 ? `${r0.kind} (${CLASS_MATCH[r0.kind]})` : "—" },
    { k: "meas", title: "What did the edge measure on each path? (show sdwan app-route stats · show services rpm probe-results)", text: SD_TUNS.map((t) => `${t}: ${qualityText(s, t)}`).join(" · ") },
    { k: "sla", title: "Which paths meet the SLA class — and is the class itself sensible?", text: `VOICE class ${c.sla.rtt} ms / ${c.sla.jitter} ms / ${c.sla.loss}% → ${SD_TUNS.map((t) => `${t} ${s.paths[t].sla}${s.paths[t].eligible ? " (eligible)" : ""}`).join(", ")}` },
    { k: "pol", title: "What does the policy say for this class? (preference, SLA required, fallback)", text: SD_CLASSES.map((k) => `${k}: ${c.slaReq[k] ? "SLA" : "no SLA"}, ${c.pref[k].join(" > ")}${c.slaReq[k] ? `, ${c.fallback[k] ? "fallback" : "strict"}` : ""}`).join(" · ") },
    { k: "sel", title: "So which path should it use — and does it? (show sdwan policy app-route-policy-filter · show security advance-policy-based-routing)", text: SD_CLASSES.map((k) => { const x = selectPath(c, s.paths, k); return `${k} → ${x.tun}: ${x.why}`; }).join(" · ") },
  ];
}
