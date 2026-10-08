"use client";

import type { ReactNode } from "react";
import { clsx } from "clsx";

/**
 * EXPERIMENT TRACK — the "Learn" stage of a lab: a short sequence of guided experiments that teach BEFORE the learner
 * is handed free controls. Each experiment says what the idea is, exactly what will be changed and where, runs it on
 * the lab's real model, then explains what happened, why (which device, which rule), what it teaches and how it shows
 * up when troubleshooting a real network. Generic: the lab supplies the content and the result explanation.
 */

export interface Experiment<A> {
  id: string;
  title: string;
  /** One line: the concept this experiment teaches. */
  concept: string;
  /** Teach first: the idea the learner needs before running anything. */
  idea: ReactNode;
  /** What will be changed, where, and what that means technically. */
  change: { what: ReactNode; where: string; meaning: ReactNode };
  /** The lab actions to run (including any setup/reset needed for a clean experiment). */
  actions: A[];
  doLabel: string;
  /** Topology nodes to highlight while this experiment is open. */
  focus?: string[];
}
export interface ExperimentResult {
  ok?: boolean;
  happened: ReactNode;
  why: ReactNode;
  teaches: ReactNode;
  real: ReactNode;
}

export function ExperimentTrack<A>({
  experiments,
  index,
  setIndex,
  ran,
  onRun,
  result,
  onFinish,
  finishLabel = "Now experiment freely →",
}: {
  experiments: Experiment<A>[];
  index: number;
  setIndex: (i: number) => void;
  ran: string[];
  onRun: (e: Experiment<A>) => void;
  /** The explanation for the current experiment, once it has been run. */
  result?: ExperimentResult;
  onFinish: () => void;
  finishLabel?: string;
}) {
  const e = experiments[index];
  const done = ran.includes(e.id);
  return (
    <section className="space-y-3 rounded-2xl border border-pv-cyan/40 bg-pv-cyan/[0.04] p-3.5" aria-label="Guided experiments">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-pv-cyan-soft">
          Learn · experiment {index + 1} of {experiments.length}
        </p>
        <ol className="flex flex-wrap gap-1" aria-label="Experiments">
          {experiments.map((x, i) => (
            <li key={x.id}>
              <button type="button" onClick={() => setIndex(i)} title={x.title} aria-current={i === index ? "step" : undefined} className={clsx("h-2.5 rounded-full transition-all", i === index ? "w-7 bg-pv-cyan" : ran.includes(x.id) ? "w-3 bg-pv-success" : "w-3 bg-pv-border hover:bg-pv-text-faint")}>
                <span className="sr-only">
                  {x.title}
                  {ran.includes(x.id) ? " (done)" : ""}
                </span>
              </button>
            </li>
          ))}
        </ol>
      </div>
      <div>
        <h3 className="text-[18px] font-semibold leading-snug text-pv-text">{e.title}</h3>
        <p className="text-[12.5px] text-pv-text-muted">You&apos;ll learn: {e.concept}</p>
      </div>

      <Block label="The idea" tone="violet">
        {e.idea}
      </Block>
      <Block label="What we'll change" tone="amber">
        <p className="text-pv-text">{e.change.what}</p>
        <p className="mt-0.5 text-[12.5px]">
          <span className="rounded bg-pv-warning/15 px-1.5 py-0.5 text-[11px] font-bold text-pv-warning">where: {e.change.where}</span>
        </p>
        <p className="mt-1">{e.change.meaning}</p>
      </Block>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => onRun(e)} className="rounded-full bg-pv-cyan px-5 py-2 text-[14px] font-bold text-[#03131a] hover:brightness-110">
          ▶ {done ? "Run it again" : e.doLabel}
        </button>
        {!done && <span className="text-[12px] text-pv-text-faint">Watch the topology above while it runs.</span>}
      </div>

      {done && result && (
        <div key={`${e.id}-res`} className="pv-pop grid gap-2 sm:grid-cols-2">
          <Block label="What happened" tone={result.ok === false ? "red" : "green"}>
            {result.happened}
          </Block>
          <Block label="Why" tone="cyan">
            {result.why}
          </Block>
          <Block label="What this teaches" tone="violet">
            {result.teaches}
          </Block>
          <Block label="In a real network" tone="plain">
            {result.real}
          </Block>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-2">
        <button type="button" disabled={index === 0} onClick={() => setIndex(index - 1)} className="rounded-full border border-pv-border px-3 py-1 text-[12.5px] text-pv-text-muted hover:text-pv-text disabled:opacity-40">
          ← Previous
        </button>
        {index < experiments.length - 1 ? (
          <button type="button" onClick={() => setIndex(index + 1)} className={clsx("rounded-full px-4 py-1.5 text-[13px] font-semibold", done ? "bg-pv-cyan/20 text-pv-text" : "border border-pv-border text-pv-text-muted hover:text-pv-text")}>
            Next experiment →
          </button>
        ) : (
          <button type="button" onClick={onFinish} className="rounded-full bg-pv-success/20 px-4 py-1.5 text-[13px] font-semibold text-pv-success">
            {finishLabel}
          </button>
        )}
      </div>
    </section>
  );
}

const TONE: Record<string, string> = {
  violet: "border-pv-violet/40 bg-pv-violet/[0.06] text-pv-violet",
  amber: "border-pv-warning/40 bg-pv-warning/[0.05] text-pv-warning",
  green: "border-pv-success/45 bg-pv-success/[0.07] text-pv-success",
  red: "border-pv-danger/45 bg-pv-danger/[0.07] text-pv-danger",
  cyan: "border-pv-cyan/40 bg-pv-cyan/[0.05] text-pv-cyan-soft",
  plain: "border-pv-border bg-pv-bg/50 text-pv-text-faint",
};
function Block({ label, tone, children }: { label: string; tone: keyof typeof TONE; children: ReactNode }) {
  return (
    <div className={clsx("rounded-xl border p-2.5", TONE[tone])}>
      <p className="text-[10.5px] font-bold uppercase tracking-[0.14em]">{label}</p>
      <div className="mt-0.5 space-y-1 text-[13.5px] leading-snug text-pv-text-muted">{children}</div>
    </div>
  );
}

/** The three stages of a lab: learn → experiment → troubleshoot. */
export type LabStageMode = "learn" | "explore" | "tickets";
export function LabStageBar({ mode, setMode, learnDone, labels = { learn: "Learn", explore: "Experiment freely", tickets: "Troubleshoot" } }: { mode: LabStageMode; setMode: (m: LabStageMode) => void; learnDone: boolean; labels?: Record<LabStageMode, string> }) {
  const items: { m: LabStageMode; n: number; hint: string }[] = [
    { m: "learn", n: 1, hint: "guided experiments" },
    { m: "explore", n: 2, hint: "change anything, every change explained" },
    { m: "tickets", n: 3, hint: "hidden faults, find them from evidence" },
  ];
  return (
    <nav aria-label="Lab stages" className="grid gap-1.5 sm:grid-cols-3">
      {items.map((it) => (
        <button key={it.m} type="button" aria-current={mode === it.m ? "step" : undefined} onClick={() => setMode(it.m)} className={clsx("rounded-xl border px-3 py-2 text-left transition-colors", mode === it.m ? "border-pv-cyan bg-pv-cyan/15" : "border-pv-border hover:border-pv-cyan/50")}>
          <p className="text-[13px] font-semibold text-pv-text">
            <span className="mr-1.5 rounded-full bg-pv-bg px-1.5 pv-mono text-[11px] text-pv-cyan-soft">{it.n}</span>
            {labels[it.m]}
            {it.m === "learn" && learnDone ? <span className="ml-1 text-pv-success">✓</span> : null}
          </p>
          <p className="text-[11.5px] text-pv-text-muted">{it.hint}</p>
        </button>
      ))}
    </nav>
  );
}
