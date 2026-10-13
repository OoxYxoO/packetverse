import { BASE_SHOT, LINES, QUESTIONS, type Line, type Question, type Shot, type ShotPatch } from "./screenplay";
import { DEFAULT_TEACHER, audioUrl, teacherById, type TeacherId, type VoiceManifest } from "./teachers";
import type { Pos, TrackInfo } from "./videoMachine";

/**
 * The timeline: turns the ONE screenplay into clips with durations, cue times inside each clip, and the exact shot on
 * screen at any moment. Each teacher's voice has its own natural timing, so there is one timeline per teacher, built
 * from that teacher's narration manifest: the same lines, shots, cues and questions — only the clock differs (a scene
 * lasts as long as its teacher takes to say it; cues land on the words they belong to). Pure — the player, the state
 * machine and the audit all use it.
 */

const MARK = /\[\[([a-z0-9-]+)\]\]/gi;
/** Caption text: markers and pause marks removed. */
export const cleanText = (s: string) => s.replace(MARK, "").replace(/\{p\}/g, " ").replace(/\s{2,}/g, " ").trim();
/** Spoken forms for things a voice would otherwise mangle (abbreviations, addresses). */
export function speechNormalize(s: string): string {
  return s
    .replace(/\bFF(?::FF){5}\b/gi, "all F's")
    .replace(/\b(?:[0-9A-F]{2}:){5}[0-9A-F]{2}\b/gi, "that MAC address")
    .replace(/\b(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\b/g, "$1 dot $2 dot $3 dot $4")
    // checked against the engine's phonemes: in capitals "ARP"/"MAC" get spelled out mid-sentence ("an A-R-P request",
    // "a M-A-C address"); lowercase gives the way engineers say them. IP, PC-B and TTL stay as written: the engine
    // reads them as one fused word, where spaced letters ("I P") made audible gaps.
    .replace(/\bARP\b/g, "arp")
    .replace(/\bMAC\b/g, "mac")
    .replace(/\bLaptop\b/g, "laptop")
    .replace(/\bServer\b/g, "server");
}
/**
 * The words the voice reads, with [[cue]] markers and {p} pauses kept (the renderer times cues and pauses from them).
 * Caption text unless the line gives its own spoken version.
 */
export const markedSpeech = (l: Pick<Line, "text" | "say">) => speechNormalize((l.say ?? l.text).replace(/\s{2,}/g, " ").trim());
/** The words alone (no markers), with pauses kept: what changes the audio. */
export const spokenText = (l: Pick<Line, "text" | "say">) => markedSpeech(l).replace(MARK, "").replace(/\s{2,}/g, " ").trim();
/** A stable hash of the spoken words, so stale audio can be detected. */
export function textHash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h.toString(16);
}

/** Where each [[cue]] falls in the sentence, as a fraction of the spoken text (speech is close to linear in letters). */
export function cueFractions(l: Pick<Line, "text" | "say">): Record<string, number> {
  let src = l.say ?? l.text;
  const total = cleanText(src).length || 1;
  src = src.replace(/\{p\}/g, " ");
  const out: Record<string, number> = {};
  let removed = 0;
  for (const m of src.matchAll(MARK)) {
    const at = (m.index ?? 0) - removed;
    removed += m[0].length;
    out[m[1]] = Math.max(0, Math.min(1, at / total));
  }
  return out;
}

/** Caption sentences of a line: split at sentence ends only (a dot inside "192.168.10.20" is not one). */
export const sentencesOf = (text: string) =>
  cleanText(text)
    .split(/(?<=[.!?]["”]?)\s+(?=[A-Z"“])/)
    .map((x) => x.trim())
    .filter(Boolean);

export interface Clip {
  id: string;
  line: Line;
  /** ms of narration (from the manifest; estimated when audio is missing). */
  voiceMs: number;
  /** ms the clip lasts on screen (narration + hold). */
  ms: number;
  audio?: string;
  /** Cue name → ms into the clip. */
  cueMs: Record<string, number>;
  /** When each caption sentence starts (ms), measured in this teacher's audio; absent → estimated from the letters. */
  sentMs?: number[];
  startShot: Shot;
}

const estimate = (text: string) => 600 + cleanText(text).split(/\s+/).length * 360;
const fold = (s: Shot, p?: ShotPatch): Shot => (p ? { ...s, ...p } : s);

function makeClip(voice: VoiceManifest, teacher: TeacherId, id: string, line: Line, startShot: Shot): Clip {
  const n = voice.lines[id];
  const fresh = !!n && n.hash === textHash(markedSpeech(line));
  const voiceMs = fresh ? n.ms : estimate(line.say ?? line.text);
  const fr = cueFractions(line);
  // measured in the audio when available (exact), else estimated from the letters
  const cueMs = Object.fromEntries(Object.entries(fr).map(([k, f]) => [k, fresh && n.marks?.[k] !== undefined ? n.marks[k] : Math.round(f * voiceMs)]));
  const sentMs = fresh && n.sents?.length === sentencesOf(line.text).length ? n.sents : undefined;
  return { id, line, voiceMs, ms: voiceMs + (line.hold ?? 0) + 350, audio: fresh ? audioUrl(teacher, n.file) : undefined, cueMs, sentMs, startShot };
}

/** The shot at t ms into a clip: the start shot plus every cue already reached. */
export function shotAt(c: Clip, t: number): Shot {
  let s = c.startShot;
  const cues = Object.entries(c.cueMs).sort((a, b) => a[1] - b[1]);
  for (const [k, at] of cues) if (t >= at) s = fold(s, c.line.cues?.[k]);
  return s;
}
/** When the shot's frame flow started (ms into the clip): at the cue that set it, else 0. */
export function flowStart(c: Clip, t: number): number {
  let start = c.line.shot?.flow !== undefined ? 0 : -1;
  for (const [k, at] of Object.entries(c.cueMs).sort((a, b) => a[1] - b[1])) if (t >= at && c.line.cues?.[k]?.flow !== undefined) start = at;
  return start < 0 ? -Infinity : start;
}
export const endShot = (c: Clip) => shotAt(c, Infinity);

/**
 * The caption on screen at t ms into a clip. Short sentences are paired so a subtitle isn't a single word; each part
 * appears when its first sentence is spoken (measured in the teacher's audio, else estimated from the letters), and
 * the caption clears shortly after the voice ends.
 */
export function captionAt(c: Clip, t: number): string {
  if (t > c.voiceMs + 400) return "";
  const parts = sentencesOf(c.line.text);
  if (parts.length <= 1) return parts[0] ?? "";
  const chunks: { text: string; first: number }[] = [];
  parts.forEach((p, i) => {
    const last = chunks[chunks.length - 1];
    if (last && (last.text.length + p.length < 70 || p.length < 18)) last.text += ` ${p}`;
    else chunks.push({ text: p, first: i });
  });
  const total = parts.reduce((n, s) => n + s.length, 0);
  const startOf = (i: number) => (c.sentMs ? c.sentMs[i] : (parts.slice(0, i).reduce((n, s) => n + s.length, 0) / total) * c.voiceMs);
  let cur = chunks[0].text;
  for (const ch of chunks) if (t >= startOf(ch.first) - 60) cur = ch.text;
  return cur;
}

// ---------------------------------------------------------------------------------------------------------------
// The tracks: the main story, each question's prompt, and each answer's feedback lines — per teacher
// ---------------------------------------------------------------------------------------------------------------
export interface Timeline {
  teacher: TeacherId;
  MAIN: Clip[];
  PROMPT: Record<string, Clip>;
  FEEDBACK: Record<string, Record<string, Clip[]>>;
  MAIN_MS: number[];
  TOTAL_MS: number;
  /** Clip lengths for the state machine. */
  INFO: TrackInfo;
}

function build(teacher: TeacherId): Timeline {
  const voice = teacherById(teacher).manifest;
  const MAIN: Clip[] = [];
  let shot = BASE_SHOT;
  for (const l of LINES) {
    const c = makeClip(voice, teacher, l.id, l, fold(shot, l.shot));
    MAIN.push(c);
    shot = endShot(c);
  }
  const PROMPT: Record<string, Clip> = {};
  const FEEDBACK: Record<string, Record<string, Clip[]>> = {};
  MAIN.forEach((c) => {
    const q = c.line.question;
    if (!q) return;
    const at = endShot(c);
    PROMPT[q.id] = makeClip(voice, teacher, `${q.id}.ask`, { id: `${q.id}.ask`, text: q.prompt, say: q.say }, at);
    FEEDBACK[q.id] = {};
    for (const o of q.options) {
      let s = at;
      FEEDBACK[q.id][o.id] = o.lines.map((l) => {
        const clip = makeClip(voice, teacher, l.id, l, fold(s, l.shot));
        s = endShot(clip);
        return clip;
      });
    }
  });
  const MAIN_MS = MAIN.map((c) => c.ms);
  const INFO: TrackInfo = {
    main: MAIN.map((c) => ({ ms: c.ms, q: c.line.question && { id: c.line.question.id, answer: c.line.question.answer } })),
    ask: Object.fromEntries(Object.entries(PROMPT).map(([k, c]) => [k, c.ms])),
    fb: Object.fromEntries(Object.entries(FEEDBACK).map(([q, o]) => [q, Object.fromEntries(Object.entries(o).map(([k, cs]) => [k, cs.map((c) => c.ms)]))])),
  };
  return { teacher, MAIN, PROMPT, FEEDBACK, MAIN_MS, TOTAL_MS: MAIN_MS.reduce((a, b) => a + b, 0), INFO };
}

const built = new Map<TeacherId, Timeline>();
export function timelineFor(teacher: TeacherId): Timeline {
  let t = built.get(teacher);
  if (!t) built.set(teacher, (t = build(teacher)));
  return t;
}
export const clipAt = (tl: Timeline, p: Pos): Clip => (p.track === "main" ? tl.MAIN[p.i] : p.track === "ask" ? tl.PROMPT[p.q] : tl.FEEDBACK[p.q][p.opt][p.i]);
/** Every clip that needs a voice: main lines, question prompts, feedback lines. */
export const clipsOf = (tl: Timeline): Clip[] => [...tl.MAIN, ...Object.values(tl.PROMPT), ...Object.values(tl.FEEDBACK).flatMap((o) => Object.values(o).flat())];

/**
 * A teacher is selectable only when its track is complete: every clip the script needs has an up-to-date recording.
 * An incomplete teacher is never offered — the player has no silent or other-voice fallback for it. (The audit also
 * checks that every listed file exists, is non-empty and decodes to the recorded length.)
 */
const ready = new Map<TeacherId, boolean>();
export function teacherReady(teacher: TeacherId): boolean {
  let r = ready.get(teacher);
  if (r === undefined) ready.set(teacher, (r = clipsOf(timelineFor(teacher)).every((c) => !!c.audio)));
  return r;
}

// The default teacher's timeline, for tools that look at one track. The lines, texts and questions are the same for
// every teacher; only durations and cue times differ.
export const { MAIN, PROMPT, FEEDBACK, MAIN_MS, TOTAL_MS } = timelineFor(DEFAULT_TEACHER);
export const questionOf = (i: number): Question | undefined => MAIN[i]?.line.question;
export const QUESTION_LINE: Record<string, number> = Object.fromEntries(QUESTIONS.map((q) => [q.id, MAIN.findIndex((c) => c.line.question?.id === q.id)]));
/** Every clip of the default timeline. */
export const allClips = (): Clip[] => clipsOf(timelineFor(DEFAULT_TEACHER));
