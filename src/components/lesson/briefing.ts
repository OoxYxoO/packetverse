import type { BriefingPhase } from "./MissionBriefingCard";

/** A run of consecutive lesson steps that share one phase and objective. */
export interface BriefingPhaseDef {
  phase: BriefingPhase;
  objective: string;
  steps: string[];
}

/** Optional per-step extras layered on top of the phase. Keep these spoiler-free on question/challenge steps. */
export interface BriefingStepNote {
  doingNow?: string;
  takeaway?: string;
}

export interface ResolvedBriefing extends BriefingStepNote {
  phase: BriefingPhase;
  objective: string;
}

/** Looks up the briefing for a step; steps not listed in any phase fall back to a neutral phase using the step label. */
export function resolveBriefing(stepId: string, label: string, phases: BriefingPhaseDef[], notes: Partial<Record<string, BriefingStepNote>>): ResolvedBriefing {
  const def = phases.find((p) => p.steps.includes(stepId));
  const note = notes[stepId] ?? {};
  return { phase: def?.phase ?? { label: "Step", tone: "cyan" }, objective: def?.objective ?? label, ...note };
}
