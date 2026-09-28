import type { LearningPath, LearningPathNode, Lesson } from "./types";
import { getLessonById, lessons as catalog } from "./lessons";
import { learningPaths } from "./learningPaths";

/**
 * Pure, deterministic derivations for the Learning Map (/learn) and Lesson Catalog (/lessons). No React, no store:
 * callers pass the learner's `completedLessons`. Lesson metadata always comes from `lessons`, track structure from
 * `learningPaths` — nothing here copies either.
 *
 * Availability rule (preserves current access behaviour): a lesson is PLAYABLE when it has a real `simulationPath`.
 * A roadmap node's design-time `status` never hides a lesson that has a route (e.g. BGP is `locked` in the map
 * data but has a working simulation), and never makes a node without a route clickable.
 */

export type PlayableLesson = Lesson & { simulationPath: string };
export type RoadmapNodeState = "completed" | "available" | "soon" | "locked";
export type LessonAvailability = "available" | "coming-soon";

export interface RoadmapNode {
  node: LearningPathNode;
  lesson?: Lesson;
  /** Only set for playable nodes — never a route that does not exist. */
  href?: string;
  state: RoadmapNodeState;
}

export interface TrackProgress {
  path: LearningPath;
  nodes: RoadmapNode[];
  /** Distinct playable lessons in this track — the progress denominator. */
  playable: number;
  completed: number;
  /** Roadmap topics in this track that are not playable yet (Soon or locked). */
  comingLater: number;
  /** completed / playable, 0–100; 0 when the track has nothing playable. */
  percent: number;
}

export const isPlayable = (lesson: Lesson | undefined): lesson is PlayableLesson => !!lesson?.simulationPath;

export const getLessonAvailability = (lesson: Lesson): LessonAvailability => (isPlayable(lesson) ? "available" : "coming-soon");

export function resolveNode(node: LearningPathNode, completedLessons: readonly string[], lookup: (id: string) => Lesson | undefined = getLessonById): RoadmapNode {
  const lesson = node.lessonId ? lookup(node.lessonId) : undefined;
  if (isPlayable(lesson)) {
    return { node, lesson, href: lesson.simulationPath, state: completedLessons.includes(lesson.id) ? "completed" : "available" };
  }
  // Not playable: "available" in the map data but unbuilt → Soon; anything else → locked.
  return { node, lesson, state: node.status === "available" ? "soon" : "locked" };
}

export function getTrackProgress(path: LearningPath, completedLessons: readonly string[], lookup: (id: string) => Lesson | undefined = getLessonById): TrackProgress {
  const nodes = path.nodes.map((n) => resolveNode(n, completedLessons, lookup));
  const playableIds = new Set(nodes.filter((n) => n.href && n.lesson).map((n) => n.lesson!.id));
  const completed = [...playableIds].filter((id) => completedLessons.includes(id)).length;
  const comingLater = nodes.filter((n) => !n.href).length;
  const playable = playableIds.size;
  return { path, nodes, playable, completed, comingLater, percent: playable ? (completed / playable) * 100 : 0 };
}

/** First unfinished playable lesson in roadmap order (tracks in order, nodes in order). */
export function getNextPlayableLesson(completedLessons: readonly string[], paths: readonly LearningPath[] = learningPaths, lookup: (id: string) => Lesson | undefined = getLessonById): { lesson: PlayableLesson; trackId: string } | undefined {
  for (const path of paths) {
    for (const node of path.nodes) {
      const r = resolveNode(node, completedLessons, lookup);
      if (r.state === "available" && isPlayable(r.lesson)) return { lesson: r.lesson, trackId: path.id };
    }
  }
  return undefined;
}

/** Default active track: the first with unfinished playable content, otherwise the first track. */
export function getDefaultTrackId(completedLessons: readonly string[], paths: readonly LearningPath[] = learningPaths, lookup: (id: string) => Lesson | undefined = getLessonById): string {
  const open = paths.find((p) => {
    const t = getTrackProgress(p, completedLessons, lookup);
    return t.playable > t.completed;
  });
  return (open ?? paths[0])?.id ?? "";
}

export interface LearningSummary {
  /** Playable catalog lessons the learner has completed. */
  completed: number;
  /** Playable catalog lessons. */
  available: number;
  /** Distinct future topics: non-playable roadmap nodes plus catalog lessons without a route. */
  comingLater: number;
  /** Tracks with at least one completed lesson and unfinished playable lessons left. */
  tracksInProgress: number;
}

export function getLearningSummary(completedLessons: readonly string[], paths: readonly LearningPath[] = learningPaths, lessons: readonly Lesson[] = catalog): LearningSummary {
  const lookup = (id: string) => lessons.find((l) => l.id === id);
  const playable = lessons.filter(isPlayable);
  const future = new Set<string>();
  for (const path of paths) for (const n of path.nodes) if (!isPlayable(n.lessonId ? lookup(n.lessonId) : undefined)) future.add(n.lessonId ?? `node:${n.id}`);
  for (const l of lessons) if (!isPlayable(l)) future.add(l.id);
  const tracksInProgress = paths.filter((p) => {
    const t = getTrackProgress(p, completedLessons, lookup);
    return t.completed > 0 && t.completed < t.playable;
  }).length;
  return { completed: playable.filter((l) => completedLessons.includes(l.id)).length, available: playable.length, comingLater: future.size, tracksInProgress };
}
