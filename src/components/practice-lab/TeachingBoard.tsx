"use client";

import type { ReactNode } from "react";
import { clsx } from "clsx";

/**
 * Teaching Board primitives — small composable pieces, not a schema. A
 * lesson composes its own board per event from these, following the
 * pattern WHAT HAPPENED → WHAT CHANGED → WHY IT MATTERS → ENGINEER CHECK →
 * NEXT, with one optional "Deepen understanding". None of them knows any
 * protocol, table or vendor; none writes lesson progress.
 */

/** The board frame: phase label, big event title, one-line summary. */
export function TeachingBoard({ phase, title, summary, children }: { phase: string; title: string; summary: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby="lab-board-title" className="space-y-3.5 rounded-2xl border border-pv-cyan/30 bg-gradient-to-b from-pv-cyan/[0.06] to-transparent p-3.5 sm:p-4">
      <header>
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-pv-cyan-soft">{phase}</p>
        <h3 id="lab-board-title" className="mt-0.5 text-[17px] font-semibold leading-tight text-pv-text sm:text-lg">
          {title}
        </h3>
        <p className="mt-1 text-[13px] leading-snug text-pv-text-muted">{summary}</p>
      </header>
      {children}
    </section>
  );
}

export type BoardTone = "muted" | "cyan" | "violet" | "success";

/** A labelled board section ("What happened", "What changed", …). */
export function BoardSection({ label, tone = "muted", children }: { label: string; tone?: BoardTone; children: ReactNode }) {
  return (
    <div>
      <p className={clsx("mb-1.5 text-[10px] font-bold uppercase tracking-[0.12em]", tone === "cyan" ? "text-pv-cyan-soft" : tone === "violet" ? "text-pv-violet" : tone === "success" ? "text-pv-success" : "text-pv-text-faint")}>{label}</p>
      {children}
    </div>
  );
}

export type EventRowTone = "device" | "attention" | "result";
export interface TeachingEventRowDef {
  /** Who acted ("Access Switch", "Router", "Broadcast", …). */
  who: string;
  tone?: EventRowTone;
  body: ReactNode;
  /** Shorter text for phones; the full `body` shows from the sm breakpoint. */
  short?: ReactNode;
}

/** Numbered "what happened" rows — one per device/actor involved in the event. */
export function TeachingEventRows({ rows }: { rows: TeachingEventRowDef[] }) {
  return (
    <ol className="space-y-1.5">
      {rows.map((r, i) => (
        <li key={r.who} className="flex gap-2.5">
          <span
            aria-hidden
            className={clsx(
              "mt-0.5 flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full border px-1 pv-mono text-[10px] font-bold",
              r.tone === "attention" ? "border-pv-warning/60 text-pv-warning" : r.tone === "result" ? "border-pv-success/60 text-pv-success" : "border-pv-cyan/50 text-pv-cyan-soft",
            )}
          >
            {i + 1}
          </span>
          <div className="min-w-0 text-[12.5px] leading-snug text-pv-text-muted">
            <span className={clsx("mr-1.5 text-[11px] font-bold uppercase tracking-wide", r.tone === "attention" ? "text-pv-warning" : "text-pv-text")}>{r.who}</span>
            <span className="sm:hidden">{r.short ?? r.body}</span>
            <span className="hidden sm:inline">{r.body}</span>
          </div>
        </li>
      ))}
    </ol>
  );
}

export interface StateDelta {
  /** Which state ("SW1 MAC", "OSPF neighbors", "LFIB", …). */
  label: string;
  /** Number of new/changed entries; 0 = unchanged. */
  count: number;
  /** Override the default "+N ENTRY / UNCHANGED" wording (e.g. "FULL", "REMOVED"). */
  text?: string;
}

/** Compact state-delta chips: a summary only — the exact entries live in the live-state panels. */
export function StateDeltaChips({ deltas, label = "State changes from this event" }: { deltas: StateDelta[]; label?: string }) {
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label={label}>
      {deltas.map((d) => (
        <li key={d.label} className={clsx("rounded-lg border px-2 py-1 text-[11px]", d.count ? "border-pv-success/50 bg-pv-success/10 text-pv-success" : "border-pv-border text-pv-text-faint")}>
          <span className="font-semibold text-pv-text">{d.label}</span> <span className="pv-mono font-bold">{d.text ?? (d.count ? `+${d.count} ${d.count === 1 ? "ENTRY" : "ENTRIES"}` : "UNCHANGED")}</span>
        </li>
      ))}
    </ul>
  );
}

/** The one concept the event teaches. */
export function KeyLesson({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-pv-violet/40 bg-pv-violet/[0.07] p-3">
      <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.12em] text-pv-violet">Key lesson</p>
      <div className="text-[13px] leading-snug text-pv-text">{children}</div>
    </div>
  );
}

export interface EngineerCheckFact {
  id: string;
  /** What to prove. */
  text: ReactNode;
  /** Shown once proven. */
  provenText: ReactNode;
  /** Decided by the LESSON (e.g. a successfully executed command, an inspected device) — the component only renders it. */
  proven: boolean;
  /** Optional shortcut for facts proven by an in-lab action rather than the CLI. */
  action?: { label: string; onClick: () => void };
}

/** Self-verifying evidence list. Reinforcement only — never a gate. */
export function EngineerCheck({ intro, facts, footnote = "Ticks itself when you gather the evidence. Optional — it never blocks the lab." }: { intro: ReactNode; facts: EngineerCheckFact[]; footnote?: ReactNode }) {
  const done = facts.filter((f) => f.proven).length;
  return (
    <BoardSection label={`Engineer check · ${done}/${facts.length} proven`} tone="success">
      <p className="mb-1.5 hidden text-[12px] text-pv-text-muted sm:block">{intro}</p>
      <ul className="space-y-1">
        {facts.map((f) => (
          <li key={f.id} className="flex items-start gap-2 text-[12px]">
            <span aria-hidden className={clsx("mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[10px]", f.proven ? "border-pv-success bg-pv-success/20 text-pv-success" : "border-pv-border text-transparent")}>
              ✓
            </span>
            <span className="min-w-0">
              <span className="sr-only">{f.proven ? "Proven: " : "Not yet proven: "}</span>
              <span className={f.proven ? "text-pv-text" : "text-pv-text-muted"}>{f.proven ? f.provenText : f.text}</span>
              {f.action && !f.proven && (
                <button type="button" onClick={f.action.onClick} className="ml-1.5 text-[11px] font-semibold text-pv-cyan-soft underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-pv-cyan">
                  {f.action.label}
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
      {done < facts.length && footnote && <p className="mt-1 hidden text-[10.5px] text-pv-text-faint sm:block">{footnote}</p>}
    </BoardSection>
  );
}

/** What the next step does, explained before the learner runs it: the idea first, then what to watch. */
export function StepPrimer({ idea, watch }: { idea: ReactNode; watch: ReactNode }) {
  return (
    <div className="rounded-lg border border-pv-cyan/35 bg-pv-cyan/[0.05] p-2.5">
      <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.12em] text-pv-cyan-soft">Before you run it: what this step does</p>
      <p className="text-[12.5px] leading-snug text-pv-text">{idea}</p>
      <p className="mt-1 text-[12px] leading-snug text-pv-text-muted">
        <span className="font-semibold text-pv-text">Watch for: </span>
        {watch}
      </p>
    </div>
  );
}

/** The explanation of a step's result when the learner skipped its optional check. */
export function StepWhy({ question, children }: { question: ReactNode; children: ReactNode }) {
  return (
    <p className="rounded-lg border border-white/10 bg-white/[0.02] p-2 text-[12px] leading-snug text-pv-text-muted">
      <span className="font-semibold text-pv-text">{question}</span> {children}
    </p>
  );
}

/** Correct / not-quite feedback after a prediction. */
export function Verdict({ correct, children }: { correct: boolean; children: ReactNode }) {
  return (
    <p className={clsx("rounded-lg border p-2 text-[12px] leading-snug text-pv-text-muted", correct ? "border-pv-success/40 bg-pv-success/5" : "border-pv-warning/40 bg-pv-warning/5")}>
      <span className={clsx("font-semibold", correct ? "text-pv-success" : "text-pv-warning")}>{correct ? "Correct. " : "Not quite. "}</span>
      {children}
    </p>
  );
}

export interface PredictionOption {
  id: string;
  label: string;
}

/**
 * Lab-local prediction (single or multiple choice). The lesson stores the
 * answer in its own lab state — this never writes lesson progress. Show
 * `verdict` only when the lesson decides the answer may be revealed.
 */
export function PredictionBlock({
  prompt,
  options,
  value,
  onChange,
  multiple,
  verdict,
  label = "Predict",
}: {
  prompt: ReactNode;
  options: PredictionOption[];
  value: string[];
  onChange: (value: string[]) => void;
  multiple?: boolean;
  verdict?: ReactNode;
  label?: string;
}) {
  return (
    <BoardSection label={label} tone="violet">
      <fieldset className="min-w-0">
        <legend className="mb-1.5 text-[13px] font-semibold text-pv-text">{prompt}</legend>
        <div className="grid grid-cols-2 gap-1.5" role={multiple ? "group" : "radiogroup"}>
          {options.map((o) => {
            const on = value.includes(o.id);
            return (
              <button
                key={o.id}
                type="button"
                role={multiple ? "checkbox" : "radio"}
                aria-checked={on}
                onClick={() => onChange(multiple ? (on ? value.filter((v) => v !== o.id) : [...value, o.id]) : [o.id])}
                className={clsx(
                  "rounded-lg border px-2.5 py-1.5 text-left text-[12px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-pv-cyan",
                  on ? "border-pv-violet/60 bg-pv-violet/10 text-pv-text" : "border-pv-border text-pv-text-muted hover:border-pv-violet/40 hover:text-pv-text",
                )}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      </fieldset>
      {verdict && <div className="mt-2">{verdict}</div>}
    </BoardSection>
  );
}

/** What the learner should do next. */
export function NextAction({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-pv-cyan/50 bg-pv-cyan/[0.04] px-3 py-2 text-[12.5px] font-semibold text-pv-cyan-soft">
      <span className="mr-1 text-[10px] font-bold uppercase tracking-[0.12em]">Next →</span>
      {children}
    </p>
  );
}

/** The ONE optional collapsed area: context-sensitive questions plus any extra the lesson adds (e.g. command help). */
export function DeepenUnderstanding({ qa, children }: { qa: { q: string; a: ReactNode }[]; children?: ReactNode }) {
  return (
    <details className="group rounded-lg border border-pv-border p-2.5">
      <summary className="cursor-pointer text-[12px] font-semibold text-pv-text-muted outline-none hover:text-pv-text focus-visible:text-pv-cyan-soft">Deepen understanding</summary>
      <div className="mt-2.5 space-y-3 text-[12px] leading-snug text-pv-text-muted">
        {qa.map((x) => (
          <div key={x.q}>
            <p className="font-semibold text-pv-text">{x.q}</p>
            <div className="mt-0.5">{x.a}</div>
          </div>
        ))}
        {children && <div className="border-t border-pv-border pt-2.5">{children}</div>}
      </div>
    </details>
  );
}

export interface CommandHelpItem {
  question: string;
  /** Per vendor/syntax: label + command. */
  commands: { label: string; command: string }[];
  /** Optional "Put in terminal" (fills, never runs). */
  onPut?: () => void;
  putLabel?: string;
}

/** "How do I inspect …?" — maps an engineering question to commands. Lesson supplies every command. */
export function CommandHelp({ items, note = "The command is only placed in the input. You still press Enter." }: { items: CommandHelpItem[]; note?: ReactNode }) {
  return (
    <div className="space-y-2">
      {items.map((it) => (
        <div key={it.question}>
          <p className="font-semibold text-pv-text">{it.question}</p>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
            {it.commands.map((c) => (
              <span key={c.label} className="flex items-center gap-1.5">
                <span className="text-pv-text-faint">{c.label}</span>
                <code className="rounded bg-black/40 px-1.5 py-0.5 pv-mono text-[11px] text-pv-text">{c.command}</code>
              </span>
            ))}
            {it.onPut && (
              <button type="button" onClick={it.onPut} aria-label={it.putLabel} className="rounded-md border border-pv-border px-1.5 py-0.5 text-[10.5px] font-semibold text-pv-text-faint hover:text-pv-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-pv-cyan">
                Put in terminal
              </button>
            )}
          </div>
        </div>
      ))}
      {note && <p className="text-[10.5px] text-pv-text-faint">{note}</p>}
    </div>
  );
}
