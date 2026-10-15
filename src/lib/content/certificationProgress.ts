import type { Lesson, LessonFeatures } from "./types";
import { getLessonById } from "./lessons";
import { isPlayable } from "./learningProgress";
import type { CertDomain, CertModule, CertStage, Certification } from "./certifications/types";

/**
 * Pure derivations for a certification journey. Like learningProgress.ts, nothing here stores anything: callers pass
 * the learner's `completedLessons` (and checkpoint results), lessons come from the one catalog. A certification
 * module whose lesson is not playable yet is "in development" — counted in the certification's size so the
 * percentage never overstates readiness, never clickable.
 */

export type ModuleStatus = "completed" | "available" | "in-development";

export interface ModuleView {
  module: CertModule;
  domain: CertDomain;
  lesson?: Lesson;
  status: ModuleStatus;
  href?: string;
  title: string;
  minutes?: number;
  features?: LessonFeatures;
}

export interface CheckpointView {
  correct: number;
  total: number;
  best: number;
  missed: string[];
  at: number;
}

export interface DomainView {
  domain: CertDomain;
  core: ModuleView[];
  practice: ModuleView[];
  further: ModuleView[];
  completed: number;
  total: number;
  percent: number;
  objectivesCovered: number;
  objectivesTotal: number;
  /** Per objective: covered when every core lesson that teaches it is completed. */
  objectives: { id: string; title: string; topics: string[]; covered: boolean; lessons: ModuleView[] }[];
  checkpoint?: CheckpointView;
  /** 0–100: completion, averaged with the latest checkpoint score once one exists. */
  readiness: number;
}

export interface CertView {
  cert: Certification;
  domains: DomainView[];
  completed: number;
  total: number;
  percent: number;
  objectivesCovered: number;
  objectivesTotal: number;
  /** First unfinished, playable core lesson in study-plan order. */
  next?: ModuleView & { stage: CertStage };
  /** Minutes of core lessons still to do (estimated). */
  minutesLeft: number;
  /** The domain with the most exam weight still ahead of the learner (weight × remaining readiness). */
  focus?: DomainView;
  stages: { stage: CertStage; modules: ModuleView[]; completed: number; total: number }[];
}

const viewOf = (module: CertModule, domain: CertDomain, completed: readonly string[], lookup: (id: string) => Lesson | undefined): ModuleView => {
  const lesson = lookup(module.lessonId);
  const playable = isPlayable(lesson);
  return {
    module,
    domain,
    lesson,
    status: !playable ? "in-development" : completed.includes(module.lessonId) ? "completed" : "available",
    href: playable ? lesson.simulationPath : undefined,
    title: lesson?.title ?? module.plannedTitle ?? module.lessonId,
    minutes: lesson?.estimatedMinutes,
    features: lesson?.features,
  };
};

export function getCertView(cert: Certification, completedLessons: readonly string[], checkpoints: Record<string, CheckpointView> = {}, lookup: (id: string) => Lesson | undefined = getLessonById): CertView {
  const domains: DomainView[] = cert.domains.map((domain) => {
    const views = domain.modules.map((m) => viewOf(m, domain, completedLessons, lookup));
    const core = views.filter((v) => v.module.role === "core");
    const completed = core.filter((v) => v.status === "completed").length;
    const objectives = domain.objectives.map((o) => {
      const lessons = views.filter((v) => v.module.covers.includes(o.id));
      const teaching = lessons.filter((v) => v.module.role === "core");
      return { ...o, lessons, covered: teaching.length > 0 && teaching.every((v) => v.status === "completed") };
    });
    const percent = core.length ? (completed / core.length) * 100 : 0;
    const cp = checkpoints[`${cert.id}:${domain.id}`];
    const cpPct = cp && cp.total ? (cp.correct / cp.total) * 100 : undefined;
    return {
      domain,
      core,
      practice: views.filter((v) => v.module.role === "practice"),
      further: views.filter((v) => v.module.role === "further"),
      completed,
      total: core.length,
      percent,
      objectives,
      objectivesCovered: objectives.filter((o) => o.covered).length,
      objectivesTotal: objectives.length,
      checkpoint: cp,
      readiness: cpPct === undefined ? percent : (percent + cpPct) / 2,
    };
  });

  const allCore = domains.flatMap((d) => d.core);
  const byLesson = new Map(domains.flatMap((d) => [...d.core, ...d.practice, ...d.further]).map((v) => [v.module.lessonId, v]));
  const stages = cert.stages.map((stage) => {
    const modules = stage.lessons.map((id) => byLesson.get(id)).filter((v): v is ModuleView => !!v);
    const core = modules.filter((m) => m.module.role === "core");
    return { stage, modules, completed: core.filter((m) => m.status === "completed").length, total: core.length };
  });
  let next: CertView["next"];
  for (const s of stages) {
    const m = s.modules.find((x) => x.module.role === "core" && x.status === "available");
    if (m) {
      next = { ...m, stage: s.stage };
      break;
    }
  }
  const completed = allCore.filter((v) => v.status === "completed").length;
  const focus = [...domains].filter((d) => d.readiness < 100).sort((a, b) => b.domain.weight * (100 - b.readiness) - a.domain.weight * (100 - a.readiness))[0];
  return {
    cert,
    domains,
    completed,
    total: allCore.length,
    percent: allCore.length ? (completed / allCore.length) * 100 : 0,
    objectivesCovered: domains.reduce((a, d) => a + d.objectivesCovered, 0),
    objectivesTotal: domains.reduce((a, d) => a + d.objectivesTotal, 0),
    next,
    minutesLeft: allCore.filter((v) => v.status !== "completed").reduce((a, v) => a + (v.minutes ?? 30), 0),
    focus,
    stages,
  };
}
