import { CATEGORY_TO_HYPOTHESIS, type ArenaFault, type HypothesisCategory } from "./faultTypes";

export interface ScoreInputs {
  faults: ArenaFault[];
  hypothesisHistory: HypothesisCategory[];
  finalHypothesis?: HypothesisCategory;
  /** One entry per distinct test invocation actually run, tagged with whether it targeted an object/category relevant to the active fault(s). */
  testRelevance: ("relevant" | "exploratory")[];
  wrongRepairAttempts: number;
  correctRepairApplied: boolean;
  hintsRevealed: number; // 0-3
  verified: boolean;
}

export interface ScoreBreakdown {
  diagnosis: number;
  investigation: number;
  repair: number;
  verification: number;
  efficiency: number;
  total: number;
}

const MAX = { diagnosis: 250, investigation: 200, repair: 250, verification: 150, efficiency: 150 };

function diagnosisScore(inputs: ScoreInputs): number {
  const correctHypotheses = new Set(inputs.faults.map((f) => CATEGORY_TO_HYPOTHESIS[f.category]));
  if (inputs.finalHypothesis && correctHypotheses.has(inputs.finalHypothesis)) return MAX.diagnosis;
  if (inputs.hypothesisHistory.some((h) => correctHypotheses.has(h))) return Math.round(MAX.diagnosis * 0.6);
  return Math.round(MAX.diagnosis * 0.25);
}

function investigationScore(inputs: ScoreInputs): number {
  const relevant = inputs.testRelevance.filter((r) => r === "relevant").length;
  const total = inputs.testRelevance.length;
  let score = Math.min(MAX.investigation, relevant * 42);
  // Mild penalty only for genuinely excessive thrashing — reasonable exploratory tests are never punished.
  if (total > 14) score -= Math.min(40, (total - 14) * 4);
  return Math.max(0, Math.round(score));
}

function repairScore(inputs: ScoreInputs): number {
  if (!inputs.correctRepairApplied) return 0;
  return Math.max(60, MAX.repair - inputs.wrongRepairAttempts * 50);
}

function verificationScore(inputs: ScoreInputs): number {
  return inputs.verified ? MAX.verification : 0;
}

function efficiencyScore(inputs: ScoreInputs): number {
  const hintPenalty = inputs.hintsRevealed * 35;
  const destructivePenalty = inputs.wrongRepairAttempts * 20;
  return Math.max(0, MAX.efficiency - hintPenalty - destructivePenalty);
}

export function computeScore(inputs: ScoreInputs): ScoreBreakdown {
  const diagnosis = diagnosisScore(inputs);
  const investigation = investigationScore(inputs);
  const repair = repairScore(inputs);
  const verification = verificationScore(inputs);
  const efficiency = efficiencyScore(inputs);
  const total = Math.max(0, Math.min(1000, diagnosis + investigation + repair + verification + efficiency));
  return { diagnosis, investigation, repair, verification, efficiency, total };
}

export interface RankInfo {
  label: string;
  range: string;
}

export function rankForScore(score: number): RankInfo {
  if (score >= 950) return { label: "Principal Troubleshooter", range: "950–1000" };
  if (score >= 850) return { label: "Senior Engineer", range: "850–949" };
  if (score >= 700) return { label: "Network Engineer", range: "700–849" };
  if (score >= 550) return { label: "Operations Engineer", range: "550–699" };
  return { label: "Needs Review", range: "< 550" };
}
