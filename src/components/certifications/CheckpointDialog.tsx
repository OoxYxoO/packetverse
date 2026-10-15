"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { clsx } from "clsx";
import type { Certification } from "@/lib/content/certifications";
import type { DomainView } from "@/lib/content/certificationProgress";
import { getLessonById } from "@/lib/content/lessons";
import { useProgressStore } from "@/lib/state/useProgressStore";
import { DOMAIN_TONE } from "./certUi";

/**
 * A domain checkpoint: the domain's exam-style questions, one at a time. Each answer is explained at once (why it is
 * right, and why the tempting answer is wrong); the result is stored per domain (best score kept) and every missed
 * question names the lesson to revisit. No XP: checkpoints measure readiness, they don't pay for guessing.
 */
export function CheckpointDialog({ cert, domain, onClose }: { cert: Certification; domain: DomainView; onClose: () => void }) {
  const questions = cert.checkpoints[domain.domain.id] ?? [];
  const record = useProgressStore((s) => s.recordCheckpoint);
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const t = DOMAIN_TONE[domain.domain.number];
  const q = questions[i];

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      prev?.focus();
    };
  }, [onClose]);

  const choose = (id: string) => {
    if (picked) return;
    setPicked(id);
    setAnswers((a) => ({ ...a, [q.id]: id }));
  };
  const nextQ = () => {
    if (i + 1 < questions.length) {
      setI(i + 1);
      setPicked(null);
      return;
    }
    const all = { ...answers };
    const missed = questions.filter((x) => all[x.id] !== x.answer).map((x) => x.id);
    record(`${cert.id}:${domain.domain.id}`, { correct: questions.length - missed.length, total: questions.length, missed });
    setDone(true);
  };
  const missed = questions.filter((x) => answers[x.id] !== x.answer);
  const score = questions.length - missed.length;

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-6" onClick={onClose}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cp-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl border border-pv-border bg-pv-bg-elevated shadow-2xl outline-none sm:rounded-3xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-pv-border p-4 sm:p-5">
          <div>
            <p className={clsx("pv-mono text-xs font-semibold", t.text)}>
              {cert.title} · {domain.domain.number}.0 checkpoint
            </p>
            <h2 id="cp-title" className="text-lg font-semibold text-pv-text">
              {domain.domain.title}
            </h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close checkpoint" className="grid size-10 shrink-0 place-items-center rounded-full text-pv-text-muted hover:bg-white/10">
            ✕
          </button>
        </div>

        <div className="overflow-y-auto p-4 sm:p-5">
          {!done && q && (
            <div>
              <p className="mb-3 flex items-center justify-between text-[11px] text-pv-text-faint">
                <span>
                  Question {i + 1} of {questions.length} · objective {q.objective}
                </span>
                <span aria-hidden className="flex gap-1">
                  {questions.map((x, k) => (
                    <span key={x.id} className={clsx("h-1.5 w-4 rounded-full", k < i ? "bg-pv-text-faint" : k === i ? t.bar : "bg-white/10")} />
                  ))}
                </span>
              </p>
              <p className="whitespace-pre-line text-[15px] leading-relaxed text-pv-text">{q.prompt}</p>
              <div className="mt-4 grid gap-2" role="radiogroup" aria-label="Answers">
                {q.options.map((o) => {
                  const isPicked = picked === o.id;
                  const isRight = o.id === q.answer;
                  return (
                    <button
                      key={o.id}
                      type="button"
                      role="radio"
                      aria-checked={isPicked}
                      disabled={!!picked}
                      onClick={() => choose(o.id)}
                      className={clsx(
                        "min-h-11 rounded-xl border px-3 py-2 text-left text-sm transition-colors",
                        !picked && "border-pv-border hover:border-pv-border-strong hover:bg-white/[0.04]",
                        picked && isRight && "border-pv-success/60 bg-pv-success/10 text-pv-text",
                        picked && isPicked && !isRight && "border-pv-danger/60 bg-pv-danger/10 text-pv-text",
                        picked && !isPicked && !isRight && "border-pv-border text-pv-text-faint",
                      )}
                    >
                      {o.label}
                      {picked && isRight && <span className="ml-2 text-xs font-semibold text-pv-success">✓ correct</span>}
                      {picked && isPicked && !isRight && <span className="ml-2 text-xs font-semibold text-pv-danger">✕ your answer</span>}
                    </button>
                  );
                })}
              </div>
              {picked && (
                <div className="mt-4 rounded-xl border border-pv-border bg-white/[0.03] p-3 text-sm leading-relaxed text-pv-text-muted" aria-live="polite">
                  <p className="mb-1 font-semibold text-pv-text">{picked === q.answer ? "Right." : "Not quite."}</p>
                  {q.explanation}
                </div>
              )}
            </div>
          )}

          {done && (
            <div aria-live="polite">
              <p className="pv-mono text-4xl font-semibold text-pv-text">
                {score}/{questions.length}
              </p>
              <p className="mt-1 text-sm text-pv-text-muted">{score === questions.length ? "Every question right. This domain is ready." : score >= questions.length * 0.8 ? "Strong — review the few you missed." : "Worth another pass through the lessons below before retaking."}</p>
              {missed.length > 0 && (
                <ul className="mt-4 space-y-2">
                  {missed.map((m) => {
                    const lesson = getLessonById(m.lessonId);
                    return (
                      <li key={m.id} className="rounded-xl border border-pv-border p-3 text-xs text-pv-text-muted">
                        <span className="block text-pv-text">
                          {m.objective} · {m.prompt.split("\n")[0].slice(0, 120)}
                          {m.prompt.length > 120 ? "…" : ""}
                        </span>
                        {lesson?.simulationPath ? (
                          <Link href={lesson.simulationPath} className="mt-1 inline-block text-pv-cyan-soft hover:underline">
                            Revisit: {lesson.title} →
                          </Link>
                        ) : (
                          <span className="mt-1 block">Revisit: {lesson?.title ?? m.lessonId}</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-pv-border p-4">
          {!done ? (
            <button type="button" disabled={!picked} onClick={nextQ} className="min-h-11 rounded-full bg-pv-cyan px-5 text-sm font-semibold text-[#03131a] disabled:opacity-40">
              {i + 1 < questions.length ? "Next question" : "See my result"}
            </button>
          ) : (
            <button type="button" onClick={onClose} className="min-h-11 rounded-full bg-pv-cyan px-5 text-sm font-semibold text-[#03131a]">
              Back to the journey
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
