import { loadPrefs, savePrefs } from "./prefs";
import { DEFAULT_TEACHER, isTeacher, type TeacherId } from "./teachers";
import { clipAt, teacherReady, timelineFor, type Clip, type Timeline } from "./timeline";
import { initialVideo, videoReducer, type Pos, type VideoAction, type VideoState } from "./videoMachine";

/**
 * THE ARP INTERACTIVE VIDEO — the playback engine (no React: the theater renders it, the audit drives it).
 *
 * Narration is the clock: while a clip's voice plays, the story time IS the audio's playback position, so picture,
 * captions and voice cannot drift apart; after the voice ends (or with no audio) the clock runs on frames. Questions
 * freeze the picture, the narrator asks, and the answer's own feedback plays before the story resumes.
 *
 * Teachers: one screenplay, one state machine, one stage — and a narration track per teacher, each with its own
 * timeline (natural durations, cues measured in that voice). Only the chosen teacher's clips are ever loaded. A new
 * teacher chosen while a sentence is being spoken takes over at the next line (never mid-word); otherwise at once.
 *
 * Speed: one rate for everything. The audio plays at the rate (pitch preserved where the browser supports it), the
 * story clock advances at the rate (it follows the audio, or frames × rate when nothing is spoken), and the CSS
 * motion on the stage is scaled by the same rate. A question still waits for the learner, whatever the speed.
 *
 * Isolation: owns only its own state. It never touches the progress store, the guided lesson or the ARP Lab — watching
 * changes no XP, completion, streak or lab progress. Teacher and speed are remembered as viewing preferences only.
 */

export const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2];
/** A line younger than this (ms) has barely started: a teacher change restarts it instead of waiting for the next. */
const JUST_BEGUN = 300;
const posKey = (p: Pos) => (p.track === "main" ? `m${p.i}` : p.track === "ask" ? `a:${p.q}` : `f:${p.q}:${p.opt}:${p.i}`);

export interface Snap {
  v: VideoState;
  muted: boolean;
  cc: boolean;
  audioOk: boolean;
  buffering: boolean;
  teacher: TeacherId;
  /** Chosen while a sentence was being spoken: takes over at the next line. */
  pending?: TeacherId;
  /** Whether this browser keeps the voice's pitch when the speed changes. */
  pitchKept: boolean;
}

/** Keep a voice's natural pitch when the speed changes (standard property, or an older prefixed one). */
export function keepPitch(a: HTMLAudioElement): boolean {
  const x = a as unknown as Record<string, unknown>;
  for (const k of ["preservesPitch", "webkitPreservesPitch", "mozPreservesPitch"])
    if (k in x) {
      x[k] = true;
      return true;
    }
  return false;
}

/** The engine: the state machine + one audio element (one element, so mobile browsers unlock it once). */
export class VideoEngine {
  snap: Snap = { v: initialVideo(), muted: false, cc: true, audioOk: true, buffering: false, teacher: DEFAULT_TEACHER, pitchKept: true };
  /** The chosen teacher's timeline: clip lengths, cue and caption times in that voice. */
  tl: Timeline = timelineFor(DEFAULT_TEACHER);
  clipOf = (p: Pos): Clip => clipAt(this.tl, p);
  private key = (v: VideoState) => `${this.snap.teacher}|${posKey(v.pos)}#${v.run}`;
  private listeners = new Set<() => void>();
  private audio: HTMLAudioElement | null = null;
  private raf = 0;
  private last = 0;
  private loadedKey = "";
  private warm = new Map<string, HTMLAudioElement>();
  /** Clips whose voice couldn't load in time: they play with captions only. */
  private silent = new Set<string>();
  private bufferingSince = 0;
  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  get = () => this.snap;
  private set(p: Partial<Snap>) {
    this.snap = { ...this.snap, ...p };
    this.listeners.forEach((l) => l());
  }
  dispatch = (a: VideoAction) => {
    const prev = this.snap.v;
    let v = videoReducer(this.tl.INFO, prev, a);
    if (v === prev) return;
    // a teacher chosen mid-sentence takes over when the next line starts (a new line, a replay, a restart)
    const pending = this.snap.pending;
    if (pending && (posKey(v.pos) !== posKey(prev.pos) || v.run !== prev.run || (v.t === 0 && prev.t > 0))) {
      this.tl = timelineFor(pending);
      this.set({ v, teacher: pending, pending: undefined });
    } else if (pending && v.mode === "waiting" && prev.mode !== "waiting") {
      // the question has been asked and the video waits: nothing is being said, so the new teacher takes over now
      this.tl = timelineFor(pending);
      v = { ...v, t: clipAt(this.tl, v.pos).ms };
      this.set({ v, teacher: pending, pending: undefined });
    } else this.set({ v });
    this.syncAudio(prev, v);
    if (v.mode === "playing" || (v.pos.track === "ask" && v.mode !== "paused")) this.loop();
  };
  /**
   * Change teacher without losing the place. While a sentence is being spoken, the new teacher takes over at the
   * next line. Otherwise at once: paused mid-sentence → that line starts again in the new voice; between lines, at a
   * question or at the end → the same moment, in the new teacher's timing.
   */
  setTeacher = (id: TeacherId, remember = true) => {
    // a teacher whose track isn't complete can't be chosen: no silence, no other teacher's voice standing in
    if (!teacherReady(id)) return;
    if (remember) savePrefs({ teacher: id });
    const { v, teacher } = this.snap;
    if (id === teacher) {
      if (this.snap.pending) this.set({ pending: undefined });
      return;
    }
    const clip = this.clipOf(v.pos);
    // mid-sentence: finish it first (a line that has only just begun simply starts again in the new voice)
    if (v.mode === "playing" && clip.audio && v.t >= JUST_BEGUN && v.t < clip.voiceMs) {
      this.set({ pending: id });
      return;
    }
    const tl = timelineFor(id);
    const next = clipAt(tl, v.pos);
    let t = v.t;
    if (v.mode === "waiting" || v.mode === "ended") t = next.ms;
    else if (t >= clip.voiceMs) t = Math.min(next.ms, next.voiceMs + (t - clip.voiceMs));
    else if (t > 0) t = 0;
    this.tl = tl;
    const nv = { ...v, t };
    this.set({ v: nv, teacher: id, pending: undefined });
    this.syncAudio(v, nv);
    if (nv.mode === "playing") this.loop();
  };
  /** One rate for voice, story clock and stage motion; the questions still wait for the learner. */
  setSpeed = (speed: number, remember = true) => {
    if (!SPEEDS.includes(speed)) return;
    if (remember) savePrefs({ speed });
    this.dispatch({ type: "speed", speed });
  };
  /** The learner's remembered teacher and speed (a viewing preference kept in this browser). */
  applyPrefs() {
    const p = loadPrefs();
    // a remembered teacher who isn't available (any more) is ignored; the picker shows who is actually teaching
    if (isTeacher(p.teacher) && teacherReady(p.teacher)) this.setTeacher(p.teacher, false);
    if (typeof p.speed === "number") this.setSpeed(p.speed, false);
    return isTeacher(p.teacher) && teacherReady(p.teacher);
  }
  setMuted = (m: boolean) => {
    if (this.audio) this.audio.muted = m;
    this.set({ muted: m });
  };
  setCc = (cc: boolean) => this.set({ cc });
  destroy() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.audio?.pause();
  }
  private el(): HTMLAudioElement | null {
    if (typeof window === "undefined") return null;
    if (!this.audio) {
      const a = new Audio();
      a.preload = "auto";
      a.muted = this.snap.muted;
      a.addEventListener("error", () => this.set({ audioOk: false }));
      // keep the teacher's natural pitch at other speeds (no chipmunk at 2×, no drawl at 0.75×)
      if (!keepPitch(a)) this.set({ pitchKept: false });
      this.audio = a;
    }
    return this.audio;
  }
  /** Keep the audio element on the right clip, at the right moment, playing exactly when the story plays. */
  private syncAudio(prev: VideoState, v: VideoState) {
    const a = this.el();
    if (!a) return;
    const clip = this.clipOf(v.pos);
    const key = this.key(v);
    const jumped = key !== this.loadedKey || v.t < prev.t - 50 || (v.t === 0 && prev.t > 0 && posKey(prev.pos) === posKey(v.pos));
    const shouldPlay = v.mode === "playing" && !!clip.audio && v.t < clip.voiceMs;
    if (jumped) {
      this.loadedKey = key;
      if (clip.audio) {
        if (!a.src.endsWith(clip.audio)) a.src = clip.audio;
        try {
          a.currentTime = Math.min(v.t, clip.voiceMs) / 1000;
        } catch {
          /* not loaded yet; it will start from 0 */
        }
      } else {
        // nothing to say on this clip: stop, and don't keep another clip loaded
        a.pause();
        if (a.getAttribute("src")) a.removeAttribute("src");
      }
      this.prefetch(v);
    }
    a.defaultPlaybackRate = v.speed;
    a.playbackRate = v.speed;
    if (shouldPlay && a.paused) {
      void a.play().catch(() => this.set({ audioOk: false }));
    } else if (!shouldPlay && !a.paused) a.pause();
  }
  /** Warm the browser cache with the clips that can come next. */
  private prefetch(v: VideoState) {
    const next: (string | undefined)[] = [];
    if (v.pos.track === "main") {
      next.push(this.tl.MAIN[v.pos.i + 1]?.audio);
      const q = this.tl.MAIN[v.pos.i].line.question;
      if (q) next.push(this.tl.PROMPT[q.id].audio, ...q.options.map((o) => this.tl.FEEDBACK[q.id][o.id][0]?.audio));
    }
    for (const u of next) {
      if (!u || this.warm.has(u)) continue;
      const w = new Audio();
      w.preload = "auto";
      w.src = u;
      this.warm.set(u, w);
    }
    // keep only the recent few warm (the browser's HTTP cache keeps the rest)
    for (const k of this.warm.keys()) {
      if (this.warm.size <= 12) break;
      this.warm.get(k)?.removeAttribute("src");
      this.warm.delete(k);
    }
  }
  /**
   * One frame of the clock. While a clip's voice should be playing, story time follows the audio position; if the
   * audio is still loading the story WAITS (like a video buffering) — after 2.5 s it gives up on that clip's voice and
   * continues with captions. If voice and picture ever drift more than 0.4 s apart, the voice is moved to the picture.
   */
  frame(dt: number, now: number) {
    const v = this.snap.v;
    if (v.mode !== "playing") return;
    const a = this.audio;
    const clip = this.clipOf(v.pos);
    const key = this.key(v);
    const voiced = !!a && !!clip.audio && v.t < clip.voiceMs && !this.silent.has(key) && this.snap.audioOk && this.loadedKey === key;
    if (!voiced) {
      this.setBuffering(false);
      this.dispatch({ type: "tick", dt });
      return;
    }
    // the voice has finished: carry the story clock past it (never play() an ended element: that restarts it)
    if (a.ended) {
      this.setBuffering(false);
      this.dispatch({ type: "tick", dt: Math.max(0, clip.voiceMs - v.t) / v.speed + 1 });
      return;
    }
    if (a.readyState >= 2 && !a.paused) {
      this.bufferingSince = 0;
      this.setBuffering(false);
      const at = a.currentTime * 1000;
      if (Math.abs(at - v.t) > 400) {
        a.currentTime = v.t / 1000;
        return;
      }
      this.dispatch({ type: "tick", dt: Math.max(0, (at - v.t) / v.speed) });
      // a hair from the end (the last frame before "ended"): finish the voice part of the clip exactly
      const w = this.snap.v;
      if (at >= clip.voiceMs - 30 && this.key(w) === key && w.t < clip.voiceMs) this.dispatch({ type: "tick", dt: (clip.voiceMs - w.t) / w.speed + 1 });
      return;
    }
    // buffering
    if (a.paused) void a.play().catch(() => this.set({ audioOk: false }));
    if (!this.bufferingSince) this.bufferingSince = now;
    if (now - this.bufferingSince > 400) this.setBuffering(true);
    if (now - this.bufferingSince > 2500) {
      this.silent.add(key);
      this.bufferingSince = 0;
      this.setBuffering(false);
    }
  }
  private setBuffering(b: boolean) {
    if (this.snap.buffering !== b) this.set({ buffering: b });
  }
  private loop() {
    if (this.raf || typeof window === "undefined") return;
    this.last = performance.now();
    const step = (now: number) => {
      this.raf = 0;
      if (this.snap.v.mode !== "playing") return;
      const dt = now - this.last;
      this.last = now;
      this.frame(dt, now);
      if (this.snap.v.mode === "playing" && !this.raf) this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }
}
