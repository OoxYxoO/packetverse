"use client";

import { useState, type ReactNode } from "react";
import { clsx } from "clsx";

/**
 * Interactive lesson-guide primitives (lesson-agnostic). Answers are
 * local self-check state only — nothing here records progress or XP.
 */

export interface KnowledgeQuestion {
  id: string;
  prompt: ReactNode;
  options: { id: string; label: ReactNode }[];
  correctId: string;
  /** Shown after any answer — teach the reasoning, not just the letter. */
  explanation: ReactNode;
}

/** One prediction / self-check question. `label` distinguishes "Predict" (before the content) from "Check" (after it). */
export function KnowledgeCheck({ question, label = "Predict", onAnswered }: { question: KnowledgeQuestion; label?: string; onAnswered?: (correct: boolean) => void }) {
  const [picked, setPicked] = useState<string | undefined>(undefined);
  const correct = picked === question.correctId;
  return (
    <div className="rounded-xl border border-pv-violet/35 bg-pv-violet/[0.06] p-3.5">
      <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-pv-violet">{label}</p>
      <div className="mb-2 text-sm font-semibold text-pv-text">{question.prompt}</div>
      <div className="grid gap-1.5 sm:grid-cols-2" role="radiogroup">
        {question.options.map((o) => {
          const chosen = picked === o.id;
          const isAnswer = picked !== undefined && o.id === question.correctId;
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={chosen}
              onClick={() => {
                if (picked === undefined) onAnswered?.(o.id === question.correctId);
                setPicked(o.id);
              }}
              className={clsx(
                "rounded-lg border px-3 py-2 text-left text-xs transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-pv-cyan",
                isAnswer ? "border-pv-success/60 bg-pv-success/10 text-pv-text" : chosen ? "border-pv-warning/60 bg-pv-warning/10 text-pv-text" : "border-white/10 text-pv-text-muted hover:border-pv-violet/40 hover:text-pv-text",
              )}
            >
              {isAnswer && <span className="sr-only">Correct answer: </span>}
              {o.label}
            </button>
          );
        })}
      </div>
      {picked !== undefined && (
        <p role="status" className={clsx("mt-2 rounded-lg border p-2.5 text-xs leading-relaxed text-pv-text-muted", correct ? "border-pv-success/40 bg-pv-success/5" : "border-pv-warning/40 bg-pv-warning/5")}>
          <b className={correct ? "text-pv-success" : "text-pv-warning"}>{correct ? "Correct. " : "Not quite. "}</b>
          {question.explanation}
        </p>
      )}
    </div>
  );
}

/** A set of self-check questions with a running score. */
export function KnowledgeQuiz({ questions }: { questions: KnowledgeQuestion[] }) {
  const [score, setScore] = useState({ answered: 0, correct: 0 });
  return (
    <div className="space-y-3">
      <p className="text-xs text-pv-text-faint" aria-live="polite">
        {score.answered === 0 ? `${questions.length} questions · self-check only, nothing is graded` : `${score.correct}/${score.answered} correct so far · ${questions.length - score.answered} to go`}
      </p>
      {questions.map((q, i) => (
        <KnowledgeCheck key={q.id} label={`Question ${i + 1}`} question={q} onAnswered={(ok) => setScore((s) => ({ answered: s.answered + 1, correct: s.correct + (ok ? 1 : 0) }))} />
      ))}
    </div>
  );
}

/** Subtle "go practise this" bridge from a guide section into a lesson's hands-on surface. Renders nothing without a handler. */
export function PracticeBridge({ label, children, onPractice }: { label: string; children?: ReactNode; onPractice?: () => void }) {
  if (!onPractice) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-pv-cyan/40 bg-pv-cyan/[0.04] px-4 py-3">
      <div className="min-w-0 text-xs text-pv-text-muted">{children}</div>
      <button type="button" onClick={onPractice} className="shrink-0 rounded-full border border-pv-cyan/50 bg-pv-cyan/10 px-3.5 py-1.5 text-xs font-semibold text-pv-cyan-soft transition-colors hover:bg-pv-cyan/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-pv-cyan">
        {label} →
      </button>
    </div>
  );
}

/** "Can you explain it?" — a statement the learner should be able to explain, with a model answer behind a disclosure. */
export function ExplainIt({ items }: { items: { q: ReactNode; a: ReactNode }[] }) {
  return (
    <ol className="space-y-2">
      {items.map((it, i) => (
        <li key={i} className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
          <p className="text-sm font-semibold text-pv-text">
            <span className="pv-mono mr-2 text-xs text-pv-violet">{i + 1}.</span>
            {it.q}
          </p>
          <details className="mt-1.5">
            <summary className="cursor-pointer text-xs font-semibold text-pv-cyan-soft outline-none hover:underline focus-visible:underline">Show a model answer</summary>
            <div className="mt-1.5 text-xs leading-relaxed text-pv-text-muted">{it.a}</div>
          </details>
        </li>
      ))}
    </ol>
  );
}
