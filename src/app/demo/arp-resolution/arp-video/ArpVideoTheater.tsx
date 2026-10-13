"use client";

import { clsx } from "clsx";
import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { CardView } from "./Cards";
import { CHAPTERS, QUESTIONS, type Question } from "./screenplay";
import { Stage, useCamera } from "./Stage";
import { SPEEDS, VideoEngine, keepPitch } from "./engine";
import { PREVIEW_CLIPS, TEACHERS, teacherById, type TeacherId } from "./teachers";
import { captionAt, flowStart, shotAt, teacherReady, timelineFor, type Timeline } from "./timeline";
import { mainLine, type VideoAction, type VideoState } from "./videoMachine";
import { camRect, fitCamera, layoutFor, safeArea, type Spot } from "./world";

/**
 * THE ARP INTERACTIVE VIDEO — the player (prototype), shown as a theater over the ARP lesson page. It renders the
 * engine (./engine: clock, audio, teachers, speed) with the stage, the cards, the questions and the controls.
 */

/** Options in a fixed, mixed order (the script lists the right answer first): the answer's slot varies per question. */
const ANSWER_SLOT = [1, 2, 1, 2, 1, 2, 0, 1, 2, 1];
function orderOptions(q: Question) {
  const right = q.options.find((o) => o.id === q.answer)!;
  const rest = q.options.filter((o) => o !== right);
  const slot = Math.min(rest.length, ANSWER_SLOT[QUESTIONS.indexOf(q) % ANSWER_SLOT.length]);
  return [...rest.slice(0, slot), right, ...rest.slice(slot)];
}

const fmt = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;

function useStageSize() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 1280, h: 720 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

const Icon = ({ d, className = "size-5" }: { d: string; className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden fill="currentColor">
    <path d={d} fillRule="evenodd" />
  </svg>
);
const I = {
  play: "M8 5.5v13l11-6.5z",
  pause: "M7 5h3.5v14H7zM13.5 5H17v14h-3.5z",
  back: "M12 5V2L7 6l5 4V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z",
  restart: "M6 6h2v12H6zM9.5 12 18 6v12z",
  vol: "M4 9h4l5-4v14l-5-4H4zM16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12",
  mute: "M4 9h4l5-4v14l-5-4H4zM16 9l5 6M21 9l-5 6",
  close: "M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12 19 17.6 17.6 19 12 13.4 6.4 19 5 17.6 10.6 12 5 6.4z",
  gear: "M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6-2-3.4-2.5 1a7.4 7.4 0 0 0-1.7-1L15 3.4h-4L10.7 6a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.4L6.6 11a7.6 7.6 0 0 0 0 2l-2.1 1.6 2 3.4 2.5-1a7.4 7.4 0 0 0 1.7 1l.3 2.6h4l.3-2.6a7.4 7.4 0 0 0 1.7-1l2.5 1 2-3.4zM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z",
  stop: "M7 7h10v10H7z",
  list: "M4 6h2v2H4zM8 6h12v2H8zM4 11h2v2H4zM8 11h12v2H8zM4 16h2v2H4zM8 16h12v2H8z",
};

// ---------------------------------------------------------------------------------------------------------------
// The theater
// ---------------------------------------------------------------------------------------------------------------
export function ArpVideoTheater({ open, onClose, onOpenLab }: { open: boolean; onClose: () => void; onOpenLab?: () => void }) {
  const [engine] = useState(() => new VideoEngine());
  const { v, muted, cc, audioOk, buffering, teacher, pending } = useSyncExternalStore(engine.subscribe, engine.get, engine.get);
  const [stageRef, size] = useStageSize();
  const [openMenu, setMenu] = useState<"chapters" | "settings" | null>(null);
  // menus belong to an open theater: closing it closes them
  const menu = open ? openMenu : null;
  const [notice, setNotice] = useState("");
  const preview = usePreview();
  const dispatch = engine.dispatch;
  const tl = engine.tl;

  useEffect(() => () => engine.destroy(), [engine]);
  // the learner's remembered teacher and speed
  useEffect(() => void engine.applyPrefs(), [engine]);
  // closing pauses; a hidden tab pauses (voice and picture stop together)
  useEffect(() => {
    if (!open) {
      dispatch({ type: "pause" });
      preview.stop();
    }
  }, [open, dispatch]); // eslint-disable-line react-hooks/exhaustive-deps
  // a preview never talks over the lesson
  useEffect(() => {
    if (v.mode === "playing") preview.stop();
  }, [v.mode]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(""), 3200);
    return () => clearTimeout(id);
  }, [notice]);
  const chooseTeacher = (id: TeacherId) => {
    engine.setTeacher(id);
    const t = teacherById(id);
    setNotice(engine.get().pending === id ? `${t.name} takes over after this sentence` : `${t.name} is teaching now`);
  };
  const close = () => {
    setMenu(null);
    onClose();
  };
  const changeSpeed = (s: number) => {
    engine.setSpeed(s);
    setNotice(`Speed ${s}×`);
  };
  useEffect(() => {
    const onVis = () => document.hidden && dispatch({ type: "pause" });
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [dispatch]);
  // the lesson page stays put underneath
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);
  // test hook (development only): lets an automated check drive the clock when the tab isn't painting
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    (window as unknown as { __arpVideo?: VideoEngine }).__arpVideo = engine;
    return () => void delete (window as unknown as { __arpVideo?: VideoEngine }).__arpVideo;
  }, [engine]);

  const clip = engine.clipOf(v.pos);
  const shot = shotAt(clip, v.t);
  const layout = layoutFor(size.w, size.h);
  const tall = layout === "tall";
  const q: Question | undefined = v.pos.track === "ask" ? QUESTIONS.find((x) => x.id === (v.pos as { q: string }).q) : undefined;
  const fbQ = v.pos.track === "fb" ? QUESTIONS.find((x) => x.id === (v.pos as { q: string }).q) : undefined;
  const asking = !!q && v.mode !== "ended";
  const cards = shot.cards;
  // what the camera must leave room for: cards, the question, the captions band
  const safe = safeArea(layout, { cards: cards.length > 0, asking, needsCard: q?.needs === "card" });
  const target = fitCamera(camRect(shot.cam, layout), size.w, size.h, safe);
  const vb = useCamera(target, `${layout}:${size.w}x${size.h}`, v.speed);
  const ppu = size.w / Math.max(1, vb.w);
  const here = mainLine(tl.INFO, v.pos);
  const elapsed = tl.MAIN_MS.slice(0, Math.max(0, here)).reduce((a, b) => a + b, 0) + (v.pos.track === "main" ? Math.min(v.t, tl.MAIN_MS[here]) : tl.MAIN_MS[here]);
  const playing = v.mode === "playing";
  const idle = v.mode === "idle";
  const ended = v.mode === "ended";
  const caption = idle || ended || asking ? "" : captionAt(clip, v.t);
  const tried = q && v.answers[q.id] ? [v.answers[q.id].choice] : [];
  const fbRec = fbQ ? v.answers[fbQ.id] : undefined;
  const chapterIdx = CHAPTERS.reduce((k, c, i) => (here >= c.line ? i : k), 0);

  const onKey = (e: React.KeyboardEvent) => {
    // speed works from anywhere in the player, like other video players: < slower, > faster
    if (e.key === ">" || e.key === "<") {
      const i = SPEEDS.indexOf(v.speed) + (e.key === ">" ? 1 : -1);
      if (i >= 0 && i < SPEEDS.length) changeSpeed(SPEEDS[i]);
      return;
    }
    if (e.key === "Escape") {
      if (menu) setMenu(null);
      else close();
      return;
    }
    if ((e.target as HTMLElement).closest("button")) return;
    if (e.key === " " || e.key === "k") {
      e.preventDefault();
      dispatch({ type: "toggle" });
    } else if (e.key === "ArrowLeft") dispatch({ type: "prev" });
  };

  return (
    <div
      className={clsx("pv-v-root fixed inset-0 z-[90] flex flex-col bg-[#03060c]", !open && "hidden", !playing && "pv-v-held")}
      style={{ "--pv-rate": v.speed } as React.CSSProperties}
      role="dialog"
      aria-modal="true"
      aria-label="ARP interactive video"
      onKeyDown={onKey}
      tabIndex={-1}
    >
      <style>{CSS}</style>
      {/* top bar */}
      <div className="flex shrink-0 items-center gap-3 px-3 py-2 sm:px-5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-100 sm:text-base">How does a computer find a MAC address?</p>
          <p className="truncate text-[11px] text-slate-400 sm:text-xs">
            ARP · interactive video <span className="ml-1 rounded-full border border-amber-400/50 px-1.5 text-amber-300">prototype</span>
          </p>
        </div>
        <button type="button" onClick={close} aria-label="Close the video and return to the lesson" className="grid size-10 place-items-center rounded-full text-slate-300 hover:bg-white/10">
          <Icon d={I.close} />
        </button>
      </div>

      {/* the stage */}
      <div ref={stageRef} className="relative min-h-0 flex-1 overflow-hidden">
        <Stage
          shot={shot}
          layout={layout}
          viewBox={vb}
          ppu={ppu}
          t={v.t}
          flowStart={flowStart(clip, v.t)}
          pickable={asking && q?.kind === "device" ? (q.options.map((o) => o.id) as Spot[]) : []}
          onPick={(s) => dispatch({ type: "answer", option: s })}
          tried={tried}
        />

        {/* cards dock: right column on wide screens, top on phones */}
        {!idle && !ended && cards.length > 0 && (!asking || !tall || q?.needs === "card") && (
          <div className={clsx("pointer-events-none absolute z-10 grid gap-3", tall ? "inset-x-3 top-3" : "right-4 top-4 w-[min(440px,38%)]")}>
            {cards.map((c) => (
              <CardView key={`${c.k}`} c={c} />
            ))}
          </div>
        )}

        {/* the question, over the frozen picture */}
        {asking && q && (
          <QuestionOverlay q={q} v={v} tall={tall} withCard={cards.length > 0} onAnswer={(o) => dispatch({ type: "answer", option: o })} previous={v.previous?.[q.id]?.choice} />
        )}

        {/* the answer's result, while its explanation plays */}
        {fbQ && fbRec && !ended && (
          <div className={clsx("pv-v-pop absolute left-3 z-20 max-w-[80%] truncate rounded-full border px-4 py-1.5 text-sm font-semibold shadow-lg sm:left-4", audioOk ? "top-3" : "top-11", fbRec.correct ? "border-emerald-400/60 bg-emerald-950/90 text-emerald-200" : "border-amber-400/60 bg-amber-950/90 text-amber-200")}>
            {fbRec.correct ? "✓ " : "↻ "}
            {fbQ.options.find((o) => o.id === fbRec.choice)?.label}
          </div>
        )}

        {/* subtitles */}
        {cc && caption && (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center px-3 sm:bottom-6">
            <p key={caption} className="pv-v-sub max-w-3xl rounded-xl bg-black/75 px-4 py-2 text-center text-[16px] leading-snug text-white sm:text-[19px]">
              {caption}
            </p>
          </div>
        )}

        {/* poster: choose a teacher (with a preview), then start */}
        {idle && (
          <div className="absolute inset-0 z-30 flex overflow-y-auto bg-black/55 px-3 py-4 backdrop-blur-[2px]">
            <div className="pv-v-card m-auto w-full max-w-md rounded-3xl border border-white/10 bg-[#060b16]/95 p-4 text-center shadow-2xl shadow-black/70 sm:p-6">
              <p className="text-2xl font-semibold text-white sm:text-3xl">How does a computer find a MAC address?</p>
              <p className="mt-2 text-sm text-slate-300 sm:text-base">
                About {Math.max(1, Math.round(tl.TOTAL_MS / v.speed / 60000))} minutes, with sound. Every now and then the video stops and asks what happens next.
              </p>
              <TeacherPicker className="mt-4 text-left" teacher={teacher} pending={pending} preview={preview} speed={v.speed} onChoose={chooseTeacher} heading="Choose your teacher" chosenLabel="selected" />
              <button type="button" onClick={() => dispatch({ type: "play" })} className="mx-auto mt-4 flex min-h-12 items-center gap-2 rounded-full bg-cyan-400 px-6 text-base font-semibold text-[#03131a] shadow-[0_0_50px_rgba(34,211,238,.35)]">
                <Icon d={I.play} className="size-5" />
                Start with {teacherById(teacher).name}
              </button>
              <p className="mt-2 text-xs text-slate-400">You can change teacher or speed any time from the player. Watching doesn&apos;t change your lesson progress.</p>
            </div>
          </div>
        )}

        {notice && (
          <p className="pv-v-pop pointer-events-none absolute left-1/2 top-3 z-40 -translate-x-1/2 whitespace-nowrap rounded-full bg-black/80 px-4 py-1.5 text-sm text-slate-100" role="status">
            {notice}
          </p>
        )}

        {ended && <EndScreen v={v} onRestart={() => dispatch({ type: "restart" })} onClose={onClose} onOpenLab={onOpenLab} />}

        {buffering && (
          <p className="absolute right-3 top-3 z-20 rounded-full bg-black/70 px-3 py-1 text-xs text-slate-200">Loading…</p>
        )}
        {!audioOk && !idle && (
          <p className="absolute left-3 top-3 z-20 rounded-full bg-black/70 px-3 py-1 text-xs text-amber-200">Sound unavailable here: captions only</p>
        )}
      </div>

      {/* controls */}
      <div className="shrink-0 px-3 pb-3 pt-2 sm:px-5">
        <Progress tl={tl} v={v} here={here} elapsed={elapsed} dispatch={dispatch} />
        <div className="mt-2 flex items-center gap-1 sm:gap-2">
          <button type="button" onClick={() => dispatch({ type: "toggle" })} disabled={v.mode === "waiting"} aria-label={playing ? "Pause" : ended ? "Watch again" : "Play"} className="grid size-11 shrink-0 place-items-center rounded-full bg-cyan-400 text-[#03131a] disabled:opacity-40">
            <Icon d={playing ? I.pause : I.play} />
          </button>
          <button type="button" onClick={() => dispatch({ type: "prev" })} aria-label={v.pos.track === "fb" ? "Replay this explanation" : "Replay the last sentence"} title="Replay" className="grid size-10 shrink-0 place-items-center rounded-full text-slate-200 hover:bg-white/10">
            <Icon d={I.back} />
          </button>
          <button type="button" onClick={() => dispatch({ type: "restart" })} aria-label="Restart from the beginning" title="Restart" className="grid size-10 shrink-0 place-items-center rounded-full text-slate-200 hover:bg-white/10">
            <Icon d={I.restart} />
          </button>
          <span className="ml-1 hidden shrink-0 pv-mono text-xs text-slate-400 sm:inline">
            {fmt(elapsed)} / {fmt(tl.TOTAL_MS)}
          </span>
          <span className="ml-auto" />
          <div className="relative">
            <button type="button" onClick={() => setMenu((m) => (m === "chapters" ? null : "chapters"))} aria-expanded={menu === "chapters"} aria-label={`Chapters: ${CHAPTERS[chapterIdx]?.name ?? ""}`} className="grid h-10 shrink-0 place-items-center rounded-full px-2.5 text-sm text-slate-200 hover:bg-white/10 sm:px-3">
              <span className="hidden sm:inline">{CHAPTERS[chapterIdx]?.name ?? "Chapters"}</span>
              <Icon d={I.list} className="size-5 sm:hidden" />
            </button>
            {menu === "chapters" && (
              <div className="fixed inset-x-3 bottom-[4.5rem] z-40 max-h-[70vh] overflow-y-auto rounded-xl border border-white/10 bg-[#0b1120] p-1.5 shadow-2xl sm:absolute sm:inset-x-auto sm:bottom-12 sm:right-0 sm:w-64">
                {CHAPTERS.map((c, i) => {
                  const ok = v.finished || c.line <= v.reached;
                  return (
                    <button
                      key={c.name}
                      type="button"
                      disabled={!ok}
                      onClick={() => {
                        dispatch({ type: "seek", line: c.line });
                        setMenu(null);
                      }}
                      className={clsx("block w-full rounded-lg px-3 py-2 text-left text-sm", i === chapterIdx ? "bg-cyan-400/10 text-cyan-200" : ok ? "text-slate-200 hover:bg-white/5" : "text-slate-600")}
                    >
                      {c.name}
                    </button>
                  );
                })}
                {!v.finished && <p className="px-3 pb-1 pt-1.5 text-[11px] text-slate-500">Later chapters open as you reach them.</p>}
              </div>
            )}
          </div>
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenu((m) => (m === "settings" ? null : "settings"))}
              aria-expanded={menu === "settings"}
              aria-label={`Teacher and speed: ${teacherById(teacher).name}, ${v.speed}×`}
              className="flex h-10 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-sm text-slate-200 hover:bg-white/10"
            >
              <Icon d={I.gear} className="size-5" />
              <span className="pv-mono text-xs">{v.speed}×</span>
            </button>
            {menu === "settings" && (
              <div className="fixed inset-x-3 bottom-[4.5rem] z-40 max-h-[70vh] overflow-y-auto rounded-xl border border-white/10 bg-[#0b1120] p-2 shadow-2xl sm:absolute sm:inset-x-auto sm:bottom-12 sm:right-0 sm:w-80">
                <TeacherPicker teacher={teacher} pending={pending} preview={preview} speed={v.speed} onChoose={chooseTeacher} heading="Teacher" chosenLabel="teaching" />
                <p className="mt-3 px-1 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400" id="pv-speed-label">
                  Speed
                </p>
                <div className="mt-1.5 grid grid-cols-3 gap-1.5" role="radiogroup" aria-labelledby="pv-speed-label">
                  {SPEEDS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      role="radio"
                      aria-checked={v.speed === s}
                      onClick={() => changeSpeed(s)}
                      className={clsx("min-h-10 rounded-lg border text-sm pv-mono", v.speed === s ? "border-cyan-300/70 bg-cyan-400/15 text-cyan-100" : "border-white/10 text-slate-200 hover:bg-white/5")}
                    >
                      {s === 1 ? "1× normal" : `${s}×`}
                    </button>
                  ))}
                </div>
                <p className="mt-2 px-1 text-[11px] text-slate-500">Voice, picture and captions change speed together. Questions always wait for you. Shortcut: &lt; and &gt;.</p>
              </div>
            )}
          </div>
          <button type="button" onClick={() => engine.setCc(!cc)} aria-pressed={cc} aria-label="Captions" className={clsx("h-10 shrink-0 rounded-full px-2.5 text-xs font-bold", cc ? "text-white" : "text-slate-500")}>
            <span className={clsx("rounded border px-1 py-0.5", cc ? "border-white" : "border-slate-600")}>CC</span>
          </button>
          <button type="button" onClick={() => engine.setMuted(!muted)} aria-label={muted ? "Unmute" : "Mute"} className="grid size-10 shrink-0 place-items-center rounded-full text-slate-200 hover:bg-white/10">
            <Icon d={muted ? I.mute : I.vol} />
          </button>
        </div>
      </div>
    </div>
  );
}

/** Where each question sits on the progress bar (fractions). */
const qMarks = (tl: Timeline): { at: number; id: string }[] =>
  tl.MAIN.flatMap((c, i) => (c.line.question ? [{ at: tl.MAIN_MS.slice(0, i + 1).reduce((a, b) => a + b, 0) / tl.TOTAL_MS, id: c.line.question.id }] : []));

function Progress({ tl, v, here, elapsed, dispatch }: { tl: Timeline; v: VideoState; here: number; elapsed: number; dispatch: (a: VideoAction) => void }) {
  const { MAIN_MS, TOTAL_MS } = tl;
  const ref = useRef<HTMLDivElement>(null);
  const seekTo = (clientX: number) => {
    const el = ref.current;
    if (!el) return;
    const b = el.getBoundingClientRect();
    const target = ((clientX - b.left) / b.width) * TOTAL_MS;
    let acc = 0;
    let line = 0;
    for (let i = 0; i < MAIN_MS.length; i++) {
      if (acc + MAIN_MS[i] > target) {
        line = i;
        break;
      }
      acc += MAIN_MS[i];
      line = i;
    }
    dispatch({ type: "seek", line });
  };
  const reachedMs = v.finished ? TOTAL_MS : MAIN_MS.slice(0, v.reached + 1).reduce((a, b) => a + b, 0);
  return (
    <div ref={ref} className="group relative h-5 cursor-pointer" onClick={(e) => seekTo(e.clientX)} role="slider" aria-label="Progress" aria-valuemin={0} aria-valuemax={Math.round(TOTAL_MS / 1000)} aria-valuenow={Math.round(elapsed / 1000)} aria-valuetext={`${fmt(elapsed)} of ${fmt(TOTAL_MS)}, line ${here + 1}`} tabIndex={0}>
      <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-white/10 group-hover:h-2">
        <div className="absolute inset-y-0 left-0 rounded-full bg-white/15" style={{ width: `${(reachedMs / TOTAL_MS) * 100}%` }} />
        <div className="absolute inset-y-0 left-0 rounded-full bg-cyan-400" style={{ width: `${(elapsed / TOTAL_MS) * 100}%` }} />
      </div>
      {qMarks(tl).map((m) => {
        const a = v.answers[m.id];
        return <span key={m.id} className={clsx("absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border", a ? (a.correct ? "border-emerald-300 bg-emerald-400" : "border-amber-300 bg-amber-400") : "border-white/60 bg-[#03060c]")} style={{ left: `${m.at * 100}%` }} />;
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Teacher choice: the same short preview for every teacher (the lesson's opening lines), in its own voice
// ---------------------------------------------------------------------------------------------------------------
interface Preview {
  playing: TeacherId | null;
  play: (id: TeacherId, speed: number) => void;
  stop: () => void;
}
function usePreview(): Preview {
  const ref = useRef<{ a: HTMLAudioElement | null; token: number }>({ a: null, token: 0 });
  const [playing, setPlaying] = useState<TeacherId | null>(null);
  const stop = useCallback(() => {
    ref.current.token++;
    ref.current.a?.pause();
    setPlaying(null);
  }, []);
  const play = useCallback((id: TeacherId, speed: number) => {
    if (!teacherReady(id)) return;
    const r = ref.current;
    const token = ++r.token;
    if (!r.a) {
      r.a = new Audio();
      keepPitch(r.a);
    }
    const a = r.a;
    const tl = timelineFor(id);
    const urls = PREVIEW_CLIPS.map((c) => tl.MAIN.find((m) => m.id === c)?.audio).filter((u): u is string => !!u);
    let k = 0;
    const next = () => {
      if (r.token !== token) return;
      if (k >= urls.length) return setPlaying(null);
      a.src = urls[k++];
      a.defaultPlaybackRate = speed;
      a.playbackRate = speed;
      void a.play().catch(() => setPlaying(null));
    };
    a.onended = next;
    setPlaying(urls.length ? id : null);
    next();
  }, []);
  useEffect(() => () => void ref.current.a?.pause(), []);
  return useMemo(() => ({ playing, play, stop }), [playing, play, stop]);
}

function TeacherPicker({ teacher, pending, preview, speed, onChoose, heading, chosenLabel, className }: { teacher: TeacherId; pending?: TeacherId; preview: Preview; speed: number; onChoose: (id: TeacherId) => void; heading: string; chosenLabel: string; className?: string }) {
  const id = useId();
  return (
    <div className={className}>
      <p className="px-1 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400" id={id}>
        {heading}
      </p>
      <div className="mt-1.5 grid gap-1.5" role="radiogroup" aria-labelledby={id}>
        {TEACHERS.map((t) => {
          const on = t.id === teacher;
          const hearing = preview.playing === t.id;
          // only a teacher with a complete recording can be heard or chosen
          const ok = teacherReady(t.id);
          return (
            <div key={t.id} className={clsx("flex items-center gap-2 rounded-xl border p-1.5", on ? "border-cyan-300/70 bg-cyan-400/10" : "border-white/10 bg-white/[0.03]", !ok && "opacity-50")}>
              <button
                type="button"
                disabled={!ok}
                onClick={() => (hearing ? preview.stop() : preview.play(t.id, speed))}
                aria-label={!ok ? `${t.name} is not available yet` : hearing ? `Stop the preview of ${t.name}` : `Hear a preview of ${t.name}`}
                className={clsx("grid size-10 shrink-0 place-items-center rounded-full border text-slate-100 enabled:hover:bg-white/10 disabled:cursor-not-allowed", hearing ? "border-cyan-300/70" : "border-white/15")}
              >
                <Icon d={hearing ? I.stop : I.play} className="size-4" />
              </button>
              <button type="button" role="radio" aria-checked={on} disabled={!ok} onClick={() => onChoose(t.id)} className="min-w-0 flex-1 rounded-lg px-1.5 py-1 text-left disabled:cursor-not-allowed">
                <span className="block text-sm font-semibold text-white">
                  {t.name}
                  {on && !pending && <span className="ml-2 text-xs font-normal text-cyan-300">{chosenLabel}</span>}
                  {t.id === pending && <span className="ml-2 text-xs font-normal text-amber-200">from the next sentence</span>}
                  {!ok && <span className="ml-2 text-xs font-normal text-slate-400">not available yet</span>}
                </span>
                <span className="block truncate text-xs text-slate-400">{t.style}</span>
              </button>
            </div>
          );
        })}
      </div>
      <p className="mt-1.5 px-1 text-[11px] text-slate-500">AI-generated voices. Same lesson, same words; only the voice changes.</p>
    </div>
  );
}

function QuestionOverlay({ q, v, tall, withCard, onAnswer, previous }: { q: Question; v: VideoState; tall: boolean; withCard: boolean; onAnswer: (o: string) => void; previous?: string }) {
  const waiting = v.mode === "waiting";
  return (
    <div className={clsx("pv-v-q absolute z-30", tall ? "inset-x-0 bottom-0" : withCard ? "bottom-6 right-4 w-[min(440px,38%)]" : "right-4 top-1/2 w-[min(440px,38%)] -translate-y-1/2")}>
      <div className={clsx("border border-cyan-300/40 bg-[#06101e]/95 p-4 shadow-2xl shadow-black/70 backdrop-blur-sm", tall ? "rounded-t-3xl" : "rounded-2xl")}>
        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-cyan-300">The video is paused · what happens next?</p>
        <p className="mt-1.5 text-[18px] font-semibold leading-snug text-white sm:text-xl">{q.prompt}</p>
        {q.kind === "device" && <p className="mt-1 text-sm text-slate-300">Tap it in the picture, or choose here.</p>}
        <div className="mt-3 grid gap-2">
          {orderOptions(q).map((o, i) => (
            <button key={o.id} type="button" onClick={() => onAnswer(o.id)} className="pv-v-opt flex min-h-12 items-center gap-3 rounded-xl border border-white/15 bg-white/[0.04] px-3 py-2.5 text-left text-[15px] leading-snug text-white hover:border-cyan-300/70 hover:bg-cyan-300/10 sm:text-base" style={{ animationDelay: `${120 + i * 70}ms` }}>
              <span className="grid size-7 shrink-0 place-items-center rounded-full border border-white/25 text-xs font-bold text-slate-300">{String.fromCharCode(65 + i)}</span>
              {o.label}
            </button>
          ))}
        </div>
        {previous && <p className="mt-2 text-xs text-slate-400">Last time you chose: {q.options.find((o) => o.id === previous)?.label}</p>}
        {!waiting && <p className="mt-2 text-xs text-slate-500">Listening to the question… you can answer any time.</p>}
      </div>
    </div>
  );
}

function EndScreen({ v, onRestart, onClose, onOpenLab }: { v: VideoState; onRestart: () => void; onClose: () => void; onOpenLab?: () => void }) {
  const right = QUESTIONS.filter((q) => v.answers[q.id]?.correct).length;
  const prev = v.previous ? QUESTIONS.filter((q) => v.previous![q.id]?.correct).length : undefined;
  return (
    <div className="absolute inset-0 z-30 grid place-items-center overflow-y-auto bg-black/70 p-4">
      <div className="pv-v-card w-full max-w-2xl rounded-3xl border border-emerald-400/30 bg-[#06120e]/95 p-5 sm:p-7">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-300">That&apos;s ARP</p>
        <p className="mt-1 text-xl font-semibold text-white sm:text-2xl">
          You predicted {right} of {QUESTIONS.length} moments right first time.
          {prev !== undefined && <span className="text-base font-normal text-slate-400"> Last time: {prev}.</span>}
        </p>
        <p className="mt-1 text-sm text-slate-300">Wrong guesses are part of it: each one came with its explanation. The ones marked ↻ are worth another look.</p>
        <ul className="mt-4 grid gap-1.5 sm:grid-cols-2">
          {QUESTIONS.map((q) => {
            const a = v.answers[q.id];
            return (
              <li key={q.id} className="flex items-start gap-2 text-sm">
                <span className={clsx("mt-0.5 w-4 shrink-0 text-center font-bold", !a ? "text-slate-600" : a.correct ? "text-emerald-300" : "text-amber-300")}>{!a ? "–" : a.correct ? "✓" : "↻"}</span>
                <span className="text-slate-200">{q.topic}</span>
              </li>
            );
          })}
        </ul>
        <div className="mt-5 flex flex-wrap gap-2">
          <button type="button" onClick={onRestart} className="min-h-11 rounded-full bg-cyan-400 px-5 text-sm font-semibold text-[#03131a]">
            Watch again
          </button>
          {onOpenLab && (
            <button type="button" onClick={onOpenLab} className="min-h-11 rounded-full border border-white/20 px-5 text-sm text-slate-100 hover:bg-white/5">
              Try it in the ARP Lab
            </button>
          )}
          <button type="button" onClick={onClose} className="min-h-11 rounded-full border border-white/20 px-5 text-sm text-slate-100 hover:bg-white/5">
            Back to the lesson
          </button>
        </div>
        <p className="mt-3 text-xs text-slate-500">All chapters are open now.</p>
      </div>
    </div>
  );
}

const CSS = `
@keyframes pvVIn { from { opacity: 0 } to { opacity: 1 } }
.pv-v-in { animation: pvVIn calc(.6s / var(--pv-rate, 1)) ease-out both }
@keyframes pvVPop { from { opacity: 0; transform: translateY(6px) scale(.96) } to { opacity: 1; transform: none } }
.pv-v-pop { animation: pvVPop calc(.4s / var(--pv-rate, 1)) cubic-bezier(.2,.8,.2,1) both; transform-box: fill-box; transform-origin: center }
@keyframes pvVCard { from { opacity: 0; transform: translateY(10px) } to { opacity: 1; transform: none } }
.pv-v-card { animation: pvVCard calc(.5s / var(--pv-rate, 1)) cubic-bezier(.2,.8,.2,1) both }
@keyframes pvVSub { from { opacity: 0 } to { opacity: 1 } }
.pv-v-sub { animation: pvVSub calc(.25s / var(--pv-rate, 1)) ease-out both }
@keyframes pvVQ { from { opacity: 0; transform: translateY(16px) } to { opacity: 1; transform: none } }
.pv-v-q { animation: pvVQ .45s cubic-bezier(.2,.8,.2,1) both }
.pv-v-opt { animation: pvVCard calc(.4s / var(--pv-rate, 1)) ease-out both }
@keyframes pvVBreathe { 0%,100% { opacity: .1 } 50% { opacity: .26 } }
.pv-v-breathe { animation: pvVBreathe calc(2.6s / var(--pv-rate, 1)) ease-in-out infinite }
@keyframes pvVPulse { 0%,100% { opacity: .12 } 50% { opacity: .4 } }
.pv-v-pulse { animation: pvVPulse calc(1.1s / var(--pv-rate, 1)) ease-in-out infinite }
@keyframes pvVBlink { 0%,100% { opacity: 1 } 50% { opacity: .3 } }
.pv-v-blink { animation: pvVBlink calc(1.6s / var(--pv-rate, 1)) ease-in-out infinite }
@keyframes pvVWrite { from { clip-path: inset(0 100% 0 0) } to { clip-path: inset(0 0 0 0) } }
.pv-v-write { animation: pvVWrite calc(1.6s / var(--pv-rate, 1)) steps(14, end) both }
@keyframes pvVPen { 0% { transform: translate(-150px,-40px) } 50% { transform: translate(-40px,-40px) } 100% { transform: translate(0,0) } }
.pv-v-pen { animation: pvVPen calc(1.6s / var(--pv-rate, 1)) ease-in-out both; transform-box: fill-box }
/* stage motion follows the playback rate (one clock for voice, story and picture); story actions hold while paused */
.pv-v-root .duration-500 { transition-duration: calc(500ms / var(--pv-rate, 1)) }
.pv-v-root .duration-700 { transition-duration: calc(700ms / var(--pv-rate, 1)) }
.pv-v-held .pv-v-write, .pv-v-held .pv-v-pen { animation-play-state: paused }
@media (prefers-reduced-motion: reduce) { .pv-v-write,.pv-v-pen { animation: none }
 .pv-v-in,.pv-v-pop,.pv-v-card,.pv-v-sub,.pv-v-q,.pv-v-opt,.pv-v-breathe,.pv-v-pulse,.pv-v-blink { animation: none } }
`;
