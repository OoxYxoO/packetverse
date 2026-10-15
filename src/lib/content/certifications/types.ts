/**
 * Certifications are a LENS over the one lesson catalog (src/lib/content/lessons): they reference lessons by id and
 * add what a certification student needs — the exam's domains and weights, which objectives each lesson covers, a
 * teaching order across domains, and checkpoint questions. They never copy lesson content. See docs/CCNA-PATH.md.
 */

/** How a lesson serves a certification. Only `core` lessons count toward certification progress. */
export type CertLessonRole = "core" | "practice" | "further";

export interface CertObjective {
  /** The exam outline's own number, e.g. "2.1". */
  id: string;
  /** A short, plain-language paraphrase of the objective. */
  title: string;
  /** What the objective includes, as the student would search for it. */
  topics: string[];
}

export interface CertModule {
  lessonId: string;
  role: CertLessonRole;
  /** Objective ids this lesson teaches (core) or exercises (practice/further). */
  covers: string[];
  /** Why this lesson is here, in the student's terms (shown on the journey). */
  why: string;
  /** Used only while a planned lesson is not in the catalog yet. */
  plannedTitle?: string;
}

export interface CertDomain {
  id: string;
  number: number;
  title: string;
  /** Share of the exam, in percent (the outline's published weights). */
  weight: number;
  summary: string;
  objectives: CertObjective[];
  modules: CertModule[];
}

/** One stage of the study plan: lessons in teaching order, possibly from several domains. */
export interface CertStage {
  id: string;
  title: string;
  summary: string;
  lessons: string[];
}

export interface CheckpointQuestion {
  id: string;
  /** Objective this question tests. */
  objective: string;
  prompt: string;
  options: { id: string; label: string }[];
  answer: string;
  /** Why the answer is right — and, where useful, why the tempting wrong answer is wrong. */
  explanation: string;
  /** The lesson to revisit if this is missed. */
  lessonId: string;
}

export interface Certification {
  id: string;
  /** Short name, e.g. "CCNA". */
  title: string;
  fullName: string;
  vendor: string;
  examCode: string;
  status: "available" | "next" | "planned";
  summary: string;
  domains: CertDomain[];
  stages: CertStage[];
  /** Exam-style questions per domain id. */
  checkpoints: Record<string, CheckpointQuestion[]>;
}
