/**
 * The interactive video's state machine — pure, so it can be tested without a browser.
 *
 * Positions: a MAIN line, a question's ASK clip (the narrator asks; the question is on screen), or one of an
 * answer's FEEDBACK lines. Modes:
 *   idle      the poster, before the first play
 *   playing   the clock runs (narration and animation)
 *   paused    the clock is stopped; picture and voice hold exactly where they are
 *   waiting   the question has been asked and the video waits for an answer
 *   ended     the closing screen
 *
 * Rules that keep the story honest:
 *   - a question can only be left by answering it (time, Next and seeking all stop at it)
 *   - going back is always possible; jumping forward only to lines already reached in this run, or anywhere once the
 *     video has been finished
 *   - a question answered in this run doesn't stop the video again when you rewind and rewatch
 *   - wrong answers are never punished: their explanation plays, then the story continues
 *   - Restart / Watch again is a fresh run; the previous run's answers are kept for the closing screen
 */

export type Pos = { track: "main"; i: number } | { track: "ask"; q: string } | { track: "fb"; q: string; opt: string; i: number };
export type Mode = "idle" | "playing" | "paused" | "waiting" | "ended";

export interface TrackInfo {
  main: { ms: number; q?: { id: string; answer: string } }[];
  ask: Record<string, number>;
  fb: Record<string, Record<string, number[]>>;
}
export interface AnswerRecord {
  choice: string;
  correct: boolean;
}
export interface VideoState {
  pos: Pos;
  t: number;
  mode: Mode;
  speed: number;
  /** The furthest main line reached in this run. */
  reached: number;
  answers: Record<string, AnswerRecord>;
  finished: boolean;
  run: number;
  previous?: Record<string, AnswerRecord>;
}
export type VideoAction =
  | { type: "tick"; dt: number }
  | { type: "play" }
  | { type: "pause" }
  | { type: "toggle" }
  | { type: "answer"; option: string }
  | { type: "seek"; line: number }
  | { type: "prev" }
  | { type: "next" }
  | { type: "restart" }
  | { type: "speed"; speed: number };

export const initialVideo = (): VideoState => ({ pos: { track: "main", i: 0 }, t: 0, mode: "idle", speed: 1, reached: 0, answers: {}, finished: false, run: 1 });

export const clipMs = (info: TrackInfo, p: Pos) => (p.track === "main" ? info.main[p.i].ms : p.track === "ask" ? info.ask[p.q] : info.fb[p.q][p.opt][p.i]);
const qAt = (info: TrackInfo, i: number) => info.main[i]?.q;
const pending = (s: VideoState, info: TrackInfo, i: number) => !!qAt(info, i) && !s.answers[qAt(info, i)!.id];
const lineOfQ = (info: TrackInfo, q: string) => info.main.findIndex((m) => m.q?.id === q);
/** The main line the viewer is "at" (for the progress bar). */
export const mainLine = (info: TrackInfo, p: Pos) => (p.track === "main" ? p.i : lineOfQ(info, p.q));

function enterMain(s: VideoState, info: TrackInfo, i: number): VideoState {
  if (i >= info.main.length) return { ...s, pos: { track: "main", i: info.main.length - 1 }, t: info.main[info.main.length - 1].ms, mode: "ended", finished: true };
  return { ...s, pos: { track: "main", i }, t: 0, mode: "playing", reached: Math.max(s.reached, i) };
}
const ask = (s: VideoState, q: string): VideoState => ({ ...s, pos: { track: "ask", q }, t: 0, mode: "playing" });

export function videoReducer(info: TrackInfo, s: VideoState, a: VideoAction): VideoState {
  switch (a.type) {
    case "tick": {
      if (s.mode !== "playing") return s;
      // a long frame (tab in the background) never jumps more than a quarter second
      const t = s.t + Math.min(Math.max(a.dt, 0), 250) * s.speed;
      const ms = clipMs(info, s.pos);
      if (t < ms) return { ...s, t };
      const p = s.pos;
      if (p.track === "ask") return { ...s, t: ms, mode: "waiting" };
      if (p.track === "fb") {
        const n = info.fb[p.q][p.opt].length;
        return p.i + 1 < n ? { ...s, pos: { ...p, i: p.i + 1 }, t: 0 } : enterMain(s, info, lineOfQ(info, p.q) + 1);
      }
      if (pending(s, info, p.i)) return ask(s, qAt(info, p.i)!.id);
      return enterMain(s, info, p.i + 1);
    }
    case "play":
      if (s.mode === "idle" || s.mode === "paused") return { ...s, mode: s.pos.track === "ask" && s.t >= clipMs(info, s.pos) ? "waiting" : "playing" };
      if (s.mode === "ended") return videoReducer(info, s, { type: "restart" });
      return s;
    case "pause":
      return s.mode === "playing" ? { ...s, mode: "paused" } : s;
    case "toggle":
      return s.mode === "playing" ? { ...s, mode: "paused" } : s.mode === "waiting" ? s : videoReducer(info, s, { type: "play" });
    case "answer": {
      if (s.pos.track !== "ask" || s.mode === "idle" || s.mode === "ended") return s;
      const q = s.pos.q;
      const m = info.main[lineOfQ(info, q)].q!;
      if (!info.fb[q][a.option]) return s;
      const rec: AnswerRecord = { choice: a.option, correct: a.option === m.answer };
      return { ...s, pos: { track: "fb", q, opt: a.option, i: 0 }, t: 0, mode: "playing", answers: { ...s.answers, [q]: rec } };
    }
    case "seek": {
      const i = Math.max(0, Math.min(info.main.length - 1, a.line));
      const here = mainLine(info, s.pos);
      if (s.pos.track === "ask" && i > here) return s;
      if (!s.finished && i > s.reached) return s;
      if (!s.finished) for (let k = Math.min(here, i); k < i; k++) if (pending(s, info, k)) return ask(s, qAt(info, k)!.id);
      return enterMain(s, info, i);
    }
    case "prev": {
      const p = s.pos;
      // replay the current explanation, or step back a line
      if (p.track === "fb") return { ...s, pos: { ...p, i: 0 }, t: 0, mode: "playing" };
      if (p.track === "ask") return enterMain(s, info, lineOfQ(info, p.q));
      return enterMain(s, info, s.t > 2500 ? p.i : Math.max(0, p.i - 1));
    }
    case "next": {
      const p = s.pos;
      if (s.mode === "idle" || s.mode === "ended" || p.track === "ask") return s;
      if (p.track === "fb") {
        const n = info.fb[p.q][p.opt].length;
        return p.i + 1 < n ? { ...s, pos: { ...p, i: p.i + 1 }, t: 0, mode: "playing" } : enterMain(s, info, lineOfQ(info, p.q) + 1);
      }
      if (pending(s, info, p.i)) return ask(s, qAt(info, p.i)!.id);
      return enterMain(s, info, p.i + 1);
    }
    case "restart":
      return { ...initialVideo(), mode: "playing", speed: s.speed, finished: s.finished, run: s.run + 1, previous: Object.keys(s.answers).length ? s.answers : s.previous };
    case "speed":
      return { ...s, speed: a.speed };
  }
}
