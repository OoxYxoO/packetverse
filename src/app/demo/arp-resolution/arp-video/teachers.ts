import t1 from "./voices/t1.json";
import t2 from "./voices/t2.json";
import t3 from "./voices/t3.json";

/**
 * The teachers: three narration tracks for the SAME screenplay. A teacher is only a voice — captions, questions,
 * feedback and the story never change. Every voice is synthetic (rendered offline; see scripts/arp-video), and the
 * learner is told so: they are presented as voices to choose from, not as people.
 */

export interface NarrationEntry {
  file: string;
  ms: number;
  hash: string;
  voice?: string;
  /** Exact cue times measured in the rendered audio (ms). */
  marks?: Record<string, number>;
  /** When each caption sentence starts in the audio (ms), measured like the cues. */
  sents?: number[];
}
export interface VoiceManifest {
  voice: string;
  lines: Record<string, NarrationEntry>;
}

export type TeacherId = "t1" | "t2" | "t3";
export interface Teacher {
  id: TeacherId;
  name: string;
  /** How the voice sounds, in a few words (shown to the learner). */
  style: string;
  manifest: VoiceManifest;
}

export const TEACHERS: Teacher[] = [
  { id: "t1", name: "Teacher 1", style: "Calm and steady", manifest: t1 as VoiceManifest },
  { id: "t2", name: "Teacher 2", style: "Warm and conversational", manifest: t2 as VoiceManifest },
  { id: "t3", name: "Teacher 3", style: "Clear and measured, British accent", manifest: t3 as VoiceManifest },
];
export const DEFAULT_TEACHER: TeacherId = "t1";
export const isTeacher = (id: unknown): id is TeacherId => TEACHERS.some((t) => t.id === id);
export const teacherById = (id: TeacherId): Teacher => TEACHERS.find((t) => t.id === id) ?? TEACHERS[0];
/** Where a teacher's clips are served from. Each teacher's clips load only when that teacher is chosen. */
export const audioUrl = (id: TeacherId, file: string) => `/arp-video/narration/${id}/${file}`;
/** The preview: the same opening lines for every teacher, from the real lesson. */
export const PREVIEW_CLIPS = ["o1", "o2"];
