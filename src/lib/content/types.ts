/**
 * Structured lesson schema (project brief §37). Lessons are data, not
 * hard-coded UI — new topics are added by appending objects here, not
 * by writing new React components. LessonViewer (future work) will
 * render any lesson conforming to this shape; today the flagship demo
 * (/demo/first-connection) is the first hand-built simulation and
 * `tcp-three-way-handshake` / `arp-resolution` below show how a topic
 * maps onto this schema even before it has a bespoke 3D scene.
 */

export type Difficulty = "beginner" | "associate" | "professional" | "expert";

export type LessonCategory =
  | "fundamentals"
  | "enterprise"
  | "service-provider"
  | "security"
  | "troubleshooting"
  | "automation";

export interface LessonSection {
  id: string;
  heading: string;
  body: string;
}

export interface Lesson {
  id: string;
  title: string;
  tagline: string;
  category: LessonCategory;
  difficulty: Difficulty;
  prerequisites: string[];
  estimatedMinutes: number;
  /** Route to the interactive simulation for this lesson, if built */
  simulationPath?: string;
  sections: LessonSection[];
  tier: "free" | "pro";
}

export interface LearningPathNode {
  id: string;
  label: string;
  lessonId?: string;
  status: "locked" | "available" | "in-progress" | "complete";
}

export interface LearningPath {
  id: string;
  title: string;
  description: string;
  nodes: LearningPathNode[];
}
