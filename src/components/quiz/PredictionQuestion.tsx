"use client";

import { useState } from "react";
import { clsx } from "clsx";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { Button } from "@/components/ui/Button";
import type { StepQuestion } from "@/lib/sim-engine/types";

interface PredictionQuestionProps {
  question: StepQuestion;
  selectedOptionId?: string;
  onAnswer: (optionId: string) => void;
}

export function PredictionQuestion({ question, selectedOptionId, onAnswer }: PredictionQuestionProps) {
  const answered = Boolean(selectedOptionId);
  const [hintsShown, setHintsShown] = useState(0);
  const hints = question.hints ?? [];

  return (
    <GlassPanel strong className="p-5">
      <p className="mb-4 text-sm font-medium text-pv-text">{question.prompt}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {question.options.map((opt) => {
          const isCorrect = opt.id === question.correctOptionId;
          const isSelected = opt.id === selectedOptionId;
          return (
            <button
              key={opt.id}
              type="button"
              disabled={answered}
              onClick={() => onAnswer(opt.id)}
              className={clsx(
                "rounded-xl border px-4 py-3 text-left text-sm transition-colors",
                !answered && "border-pv-border hover:border-pv-cyan/40 hover:bg-pv-cyan/5 cursor-pointer",
                answered && isCorrect && "border-pv-success/50 bg-pv-success/10 text-pv-success",
                answered && isSelected && !isCorrect && "border-pv-danger/50 bg-pv-danger/10 text-pv-danger",
                answered && !isSelected && !isCorrect && "border-pv-border opacity-50",
              )}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      {!answered && hints.length > 0 && (
        <div className="mt-4 space-y-2">
          {hints.slice(0, hintsShown).map((h, i) => (
            <p key={i} className="rounded-lg border border-pv-warning/30 bg-pv-warning/5 px-3 py-2 text-xs text-pv-text-muted">
              {h}
            </p>
          ))}
          <div className="flex flex-wrap gap-2">
            {hintsShown < hints.length && (
              <Button variant="secondary" size="sm" onClick={() => setHintsShown((n) => n + 1)}>
                Hint {hintsShown + 1}
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => onAnswer(question.correctOptionId)}>
              Show Answer
            </Button>
          </div>
        </div>
      )}

      {answered && (
        <div className="mt-4 rounded-xl border border-pv-border bg-black/20 p-4 text-sm text-pv-text-muted">
          <span className="mb-1 block font-semibold text-pv-text">
            {selectedOptionId === question.correctOptionId ? "Correct." : "Not quite."}
          </span>
          {question.explanation}
        </div>
      )}
    </GlassPanel>
  );
}
