"use client";

import { clsx } from "clsx";

export type BriefingTone = "cyan" | "violet" | "success" | "arp" | "ethernet" | "ip" | "tcp";

export interface BriefingPhase {
  label: string;
  tone: BriefingTone;
}

const TONE_VAR: Record<BriefingTone, string> = {
  cyan: "var(--pv-cyan)",
  violet: "var(--pv-violet)",
  success: "var(--pv-success)",
  arp: "var(--pv-proto-arp)",
  ethernet: "var(--pv-proto-ethernet)",
  ip: "var(--pv-proto-ip)",
  tcp: "var(--pv-proto-tcp)",
};

interface MissionBriefingCardProps {
  stepNumber: number;
  totalSteps: number;
  title: string;
  phase: BriefingPhase;
  objective: string;
  /** The scenario narrative — the step's full context. */
  context: string;
  doingNow?: string;
  takeaway?: string;
  /** True while this step's prediction is still unanswered. */
  questionPending?: boolean;
}

/**
 * Step briefing card: step number and phase, a strong title, the
 * objective, the "right now" summary, the narrative as context and an
 * optional key takeaway. Pure presentation — the lesson supplies every
 * string.
 */
export function MissionBriefingCard({ stepNumber, totalSteps, title, phase, objective, context, doingNow, takeaway, questionPending }: MissionBriefingCardProps) {
  const accent = TONE_VAR[phase.tone];
  const pct = Math.round((stepNumber / totalSteps) * 100);

  return (
    <section
      aria-label={`Step ${stepNumber}: ${title}`}
      className="relative overflow-hidden rounded-2xl border bg-pv-bg-elevated"
      style={{ borderColor: `color-mix(in srgb, ${accent} 35%, transparent)` }}
    >
      <div className="absolute inset-y-0 left-0 w-1" style={{ background: accent }} />
      <div className="pointer-events-none absolute -right-24 -top-24 h-56 w-56 rounded-full opacity-20 blur-3xl" style={{ background: accent }} />

      <div className="relative p-5 pl-6 sm:p-6 sm:pl-7">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="pv-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-pv-text-faint">
            Step <span className="text-pv-text">{String(stepNumber).padStart(2, "0")}</span> / {String(totalSteps).padStart(2, "0")}
          </span>
          <span
            className="rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
            style={{ color: accent, borderColor: `color-mix(in srgb, ${accent} 45%, transparent)`, background: `color-mix(in srgb, ${accent} 10%, transparent)` }}
          >
            {phase.label}
          </span>
          {questionPending && (
            <span className="rounded-full border border-pv-warning/40 bg-pv-warning/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-pv-warning">Prediction pending</span>
          )}
          <div className="ml-auto hidden h-1 w-28 overflow-hidden rounded-full bg-white/10 sm:block" aria-hidden>
            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: accent }} />
          </div>
        </div>

        <h2 className="text-xl font-semibold leading-tight text-pv-text sm:text-2xl">{title}</h2>

        <div className="mt-4 flex gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3.5">
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg" style={{ background: `color-mix(in srgb, ${accent} 16%, transparent)`, color: accent }} aria-hidden>
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="9" />
              <circle cx="12" cy="12" r="5" />
              <circle cx="12" cy="12" r="1.5" fill="currentColor" />
            </svg>
          </span>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: accent }}>
              Objective
            </p>
            <p className="mt-0.5 text-sm font-medium text-pv-text">{objective}</p>
          </div>
        </div>

        {doingNow && (
          <div className="mt-3 flex items-start gap-2.5">
            <span className="relative mt-1.5 flex h-2 w-2 shrink-0" aria-hidden>
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ background: accent }} />
              <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: accent }} />
            </span>
            <p className="text-sm text-pv-text-muted">
              <span className="font-semibold text-pv-text">Right now: </span>
              {doingNow}
            </p>
          </div>
        )}

        <p className={clsx("mt-4 border-t border-white/5 pt-4 text-sm leading-relaxed text-pv-text-muted")}>{context}</p>

        {takeaway && (
          <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-pv-success/25 bg-pv-success/[0.06] px-3 py-2.5">
            <span className="text-sm leading-5 text-pv-success" aria-hidden>
              ★
            </span>
            <p className="text-xs leading-5 text-pv-text">
              <span className="font-semibold text-pv-success">Key takeaway: </span>
              {takeaway}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

/** One-line variant for the Focus Mode header strip. */
export function MissionBriefingStrip({ stepNumber, totalSteps, title, phase, objective, questionPending }: Pick<MissionBriefingCardProps, "stepNumber" | "totalSteps" | "title" | "phase" | "objective" | "questionPending">) {
  const accent = TONE_VAR[phase.tone];
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
      <span className="pv-mono text-[11px] font-semibold text-pv-text-faint">
        {String(stepNumber).padStart(2, "0")}/{String(totalSteps).padStart(2, "0")}
      </span>
      <span className="rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider" style={{ color: accent, borderColor: `color-mix(in srgb, ${accent} 45%, transparent)` }}>
        {phase.label}
      </span>
      <span className="text-sm font-semibold text-pv-text">{title}</span>
      {questionPending ? (
        <span className="rounded-full border border-pv-warning/40 bg-pv-warning/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-pv-warning">Prediction pending — answer in the panel to continue</span>
      ) : (
        <span className="min-w-0 flex-1 truncate text-xs text-pv-text-muted" title={objective}>
          <span className="font-semibold" style={{ color: accent }}>
            Objective:{" "}
          </span>
          {objective}
        </span>
      )}
    </div>
  );
}
