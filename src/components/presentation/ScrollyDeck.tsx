"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MutableRefObject, type ReactNode } from "react";
import { clsx } from "clsx";
import { Button } from "@/components/ui/Button";

/**
 * SCROLLY DECK — a generic "interactive presentation" layout for lessons: a sticky visual STAGE beside (desktop)
 * or above (phone) a column of short narrative STEPS. Scrolling activates steps; Prev/Next (DeckHeader / DeckNav),
 * clicking a step card and the keyboard (Space / PageDown / → / ↓ next, Shift+Space / PageUp / ← / ↑ back,
 * Home / End) move step by step too. A step moved to is always placed fully inside the area that is really visible:
 * below the pinned header (desktop) or below the sticky stage (phone) — never half under them.
 *
 * It is purely presentational: the caller owns `step`, renders the stage for it, and decides what (if anything)
 * a step does. It never touches lab state, progress, XP or lesson completion.
 *
 * Motion: CSS only, all of it behind prefers-reduced-motion: no-preference. `DECK_CSS` provides the classes:
 *   pv-pop (fade/slide in) · pv-grow (scale in) · pv-pulse (attention) · pv-move / pv-move-stay (a token travelling
 *   from --fx,--fy to --tx,--ty; see <Mover/>) · pv-bar (a draining timer bar).
 */

export interface DeckStep {
  id: string;
  chapter: string;
  title: string;
  body: ReactNode;
}

export const DECK_CSS = `
  @media (prefers-reduced-motion: no-preference) {
    .pv-pop { animation: pvPop .4s ease-out both; }
    .pv-grow { animation: pvGrow .6s cubic-bezier(.22,1,.36,1) both; }
    .pv-pulse { animation: pvPulse 1.4s ease-in-out infinite; }
    .pv-move { animation-name: pvMove; animation-timing-function: ease-in-out; animation-fill-mode: both; }
    .pv-move-stay { animation-name: pvMoveStay; animation-timing-function: ease-in-out; animation-fill-mode: both; }
    .pv-bar { animation: pvBar 6s linear infinite; }
  }
  @keyframes pvPop { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
  @keyframes pvGrow { from { opacity: 0; transform: scale(.85); } to { opacity: 1; transform: none; } }
  @keyframes pvPulse { 0%,100% { opacity: 1; } 50% { opacity: .45; } }
  @keyframes pvMove { 0% { left: var(--fx); top: var(--fy); opacity: 0; } 10% { opacity: 1; } 90% { opacity: 1; } 100% { left: var(--tx); top: var(--ty); opacity: 0; } }
  @keyframes pvMoveStay { 0% { left: var(--fx); top: var(--fy); opacity: 0; } 10% { opacity: 1; } 100% { left: var(--tx); top: var(--ty); opacity: 1; } }
  @keyframes pvBar { 0% { width: 100%; } 85% { width: 0%; opacity: 1; } 100% { width: 0%; opacity: .2; } }
`;

/** Height of the PracticeLabShell's pinned header (sticky on desktop only), so the stage can stick just below it. */
function usePinnedTop() {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [top, setTop] = useState(8);
  useLayoutEffect(() => {
    const pinned = el?.closest("section")?.firstElementChild as HTMLElement | null;
    if (!pinned) return;
    const update = () => setTop(window.matchMedia("(min-width: 1024px)").matches ? pinned.getBoundingClientRect().height + 8 : 8);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(pinned);
    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [el]);
  return [setEl, top] as const;
}

function scrollParent(el: HTMLElement | null): HTMLElement | null {
  let p = el?.parentElement ?? null;
  while (p) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight) return p;
    p = p.parentElement;
  }
  return null;
}

export function ScrollyDeck({ steps, step, onStep, goRef, stage, visualKey, finalAction, label }: { steps: DeckStep[]; step: number; onStep: (i: number) => void; goRef: MutableRefObject<((i: number) => void) | undefined>; stage: ReactNode; /** Steps sharing a key keep the same stage instance, so pictures animate between them. */ visualKey: string; finalAction?: ReactNode; label: string }) {
  const [pinRef, pinTop] = usePinnedTop();
  const root = useRef<HTMLDivElement | null>(null);
  const stepEls = useRef<(HTMLElement | null)[]>([]);
  const travel = useRef<{ to: number; until: number } | undefined>(undefined);
  const stageEl = useRef<HTMLDivElement | null>(null);
  const stageInner = useRef<HTMLDivElement | null>(null);
  const pinTopRef = useRef(pinTop);
  useEffect(() => {
    pinTopRef.current = pinTop;
  }, [pinTop]);
  /** The part of the scroll area not covered by the pinned header (desktop) or the sticky stage (phone). */
  const visibleArea = () => {
    const sp = scrollParent(root.current);
    if (!sp) return undefined;
    const r = sp.getBoundingClientRect();
    const desktop = window.matchMedia("(min-width: 1024px)").matches;
    const top = desktop ? r.top + Math.max(0, pinTopRef.current - 8) : r.top + pinTopRef.current + (stageEl.current?.offsetHeight ?? 0);
    return { sp, top, bottom: r.bottom };
  };
  /** Bring step i's card fully into the visible area: centred when it fits, top-aligned (with a margin) when it doesn't. */
  const place = (i: number, smooth: boolean) => {
    const card = stepEls.current[i]?.firstElementChild as HTMLElement | null | undefined;
    const sp0 = scrollParent(root.current);
    // Phones: the stage sits above the text, so it gets what is left after this step's card (never less than 220px).
    if (card && sp0 && stageInner.current) {
      const desktop = window.matchMedia("(min-width: 1024px)").matches;
      stageInner.current.style.maxHeight = desktop ? "" : `${Math.max(220, Math.min(window.innerHeight * 0.58, sp0.clientHeight - pinTopRef.current - card.offsetHeight - 40))}px`;
    }
    const area = visibleArea();
    if (!card || !area) return;
    const c = card.getBoundingClientRect();
    const avail = area.bottom - area.top;
    const offset = c.height < avail ? (avail - c.height) / 2 : 6;
    const delta = c.top - (area.top + offset);
    if (Math.abs(delta) < 2) return;
    area.sp.scrollTo({ top: area.sp.scrollTop + delta, behavior: smooth ? "smooth" : "auto" });
  };
  /** After React has rendered the new step (the stage height can change), then place it. */
  const placeSoon = (i: number, smooth: boolean) => {
    let done = false;
    const run = () => {
      if (done) return;
      done = true;
      place(i, smooth);
    };
    requestAnimationFrame(() => requestAnimationFrame(run));
    window.setTimeout(run, 80);
  };

  // Scrolling: the active step is the last one whose top has passed 55% of the scroll area.
  useLayoutEffect(() => {
    const sp = scrollParent(root.current);
    if (!sp) return;
    const update = () => {
      const area = visibleArea();
      const line = area ? area.top + (area.bottom - area.top) * 0.5 : sp.getBoundingClientRect().top + sp.clientHeight * 0.55;
      let idx = 0;
      stepEls.current.forEach((el, i) => {
        if (el && el.getBoundingClientRect().top <= line) idx = i;
      });
      // While a Prev/Next scroll is travelling, don't flash through every step it passes.
      const lock = travel.current;
      if (lock && Date.now() < lock.until && idx !== lock.to) return;
      travel.current = undefined;
      onStep(idx);
    };
    sp.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      sp.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [onStep]);

  // Re-opening resumes at the step the learner left.
  const initial = useRef(step);
  useLayoutEffect(() => {
    const i = initial.current;
    // Desktop shows step 1 beside the stage already; on a phone it starts below the stage, so bring it up too.
    if (i > 0 || !window.matchMedia("(min-width: 1024px)").matches) {
      travel.current = { to: i, until: Date.now() + 800 };
      placeSoon(i, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    goRef.current = (i: number) => {
      const el = stepEls.current[i];
      if (!el) return;
      onStep(i);
      travel.current = { to: i, until: Date.now() + 1500 };
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      placeSoon(i, !reduce);
    };
    return () => {
      goRef.current = undefined;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goRef, onStep]);

  const stepRef = useRef(step);
  useEffect(() => {
    stepRef.current = step;
  }, [step]);
  // A deck can be mounted while hidden (some lessons mount the presentation before it is opened): when it becomes
  // visible on a phone, bring the current step up below the stage.
  useEffect(() => {
    const el = root.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    let shown = false;
    const io = new IntersectionObserver((es) => {
      const vis = es.some((e) => e.isIntersecting);
      if (vis && !shown && !window.matchMedia("(min-width: 1024px)").matches) placeSoon(stepRef.current, false);
      shown = vis;
    });
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keyboard: the presentation owns Space / PageUp / PageDown / arrows / Home / End while it is visible, so the
  // browser never scrolls the column by an arbitrary amount. Fields, buttons and links keep their own keys.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = root.current;
      if (!el || el.offsetParent === null || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const t = e.target instanceof Element ? e.target : null;
      if (t && (t.closest("input, textarea, select, [contenteditable='true']") || (e.key === " " && t.closest("button, a, [role='button']")))) return;
      const cur = stepRef.current;
      let to: number | undefined;
      if (e.key === " " || e.key === "PageDown" || e.key === "ArrowDown" || e.key === "ArrowRight") to = e.key === " " && e.shiftKey ? cur - 1 : cur + 1;
      else if (e.key === "PageUp" || e.key === "ArrowUp" || e.key === "ArrowLeft") to = cur - 1;
      else if (e.key === "Home") to = 0;
      else if (e.key === "End") to = steps.length - 1;
      if (to === undefined) return;
      e.preventDefault();
      if (e.repeat && Date.now() < (travel.current?.until ?? 0) - 1200) return;
      const next = Math.max(0, Math.min(steps.length - 1, to));
      if (next !== cur) goRef.current?.(next);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goRef, steps.length]);

  return (
    <div
      ref={(el) => {
        root.current = el;
        pinRef(el);
      }}
      className="mx-auto grid max-w-6xl gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.65fr)]"
    >
      <style>{DECK_CSS}</style>
      <div ref={stageEl} className="sticky z-10 -mx-1 min-w-0 self-start bg-pv-bg/95 px-1 pb-2 backdrop-blur lg:mx-0 lg:bg-transparent lg:px-0 lg:backdrop-blur-none" style={{ top: pinTop }}>
        <div
          ref={stageInner}
          className="flex max-h-[min(58dvh,calc(100dvh-390px))] flex-col gap-3 overflow-y-auto rounded-2xl border border-pv-cyan/25 bg-pv-bg-elevated/40 p-3 sm:p-4 lg:max-h-[var(--pv-stage-max)] lg:min-h-[min(560px,70dvh)] lg:justify-center"
          style={{ ["--pv-stage-max" as string]: `calc(100dvh - ${pinTop + 24}px)` }}
        >
          <div key={visualKey} className="pv-pop flex flex-col gap-3">
            {stage}
          </div>
        </div>
      </div>
      <ol className="min-w-0" aria-label={label}>
        {steps.map((s, i) => (
          <li
            key={s.id}
            ref={(el) => {
              stepEls.current[i] = el;
            }}
            className={clsx("flex items-center py-6", i === steps.length - 1 ? "min-h-[60dvh]" : "min-h-[75dvh] lg:min-h-[85dvh]")}
          >
            <div onClick={() => i !== step && goRef.current?.(i)} className={clsx("w-full rounded-2xl border p-4 transition-[opacity,border-color] duration-500", i === step ? "border-pv-cyan/60 bg-pv-bg-elevated/70 opacity-100" : "cursor-pointer border-pv-border bg-pv-bg-elevated/30 opacity-50 hover:opacity-80")}>
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-pv-cyan-soft">
                {i + 1} / {steps.length} · {s.chapter}
              </p>
              <h4 className="mt-1 text-balance text-[18px] font-semibold leading-snug text-pv-text">
                <Sentences text={s.title} />
              </h4>
              <div className="mt-1.5 space-y-1.5 text-pretty text-[15px] leading-relaxed text-pv-text-muted">{s.body}</div>
              {i === steps.length - 1 && finalAction && <div className="mt-3">{finalAction}</div>}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Prev / Next (or the final action on the last step). */
export function DeckNav({ step, count, goRef, compact, final }: { step: number; count: number; goRef: MutableRefObject<((i: number) => void) | undefined>; compact: boolean; final: { label: string; onClick: () => void } }) {
  const last = step === count - 1;
  return (
    <div className="flex items-center gap-2">
      <Button size={compact ? "sm" : "md"} variant="secondary" onClick={() => goRef.current?.(step - 1)} disabled={step === 0} aria-label="Previous step">
        ←
      </Button>
      {last ? (
        <Button size={compact ? "sm" : "md"} onClick={final.onClick}>
          {final.label}
        </Button>
      ) : (
        <Button size={compact ? "sm" : "md"} onClick={() => goRef.current?.(step + 1)}>
          Next →
        </Button>
      )}
    </div>
  );
}

/** Pinned header: where am I (kicker · chapter · progress), skip, and Prev/Next on desktop. */
export function DeckHeader({ kicker, steps, step, goRef, skip, final }: { kicker: string; steps: DeckStep[]; step: number; goRef: MutableRefObject<((i: number) => void) | undefined>; skip: { label: string; onClick: () => void }; final: { label: string; onClick: () => void } }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-pv-cyan-soft">
          {kicker}{" "}
          <span className="text-pv-text-faint">
            · {step + 1} / {steps.length}
          </span>
        </p>
        <h2 className="truncate text-[17px] font-semibold leading-tight text-pv-text sm:text-[19px]">{steps[step].chapter}</h2>
        <div className="mt-1.5 flex h-1.5 max-w-xl overflow-hidden rounded-full bg-pv-border" role="progressbar" aria-valuemin={1} aria-valuemax={steps.length} aria-valuenow={step + 1} aria-label="Presentation progress">
          <div className="h-full rounded-full bg-pv-cyan transition-[width] duration-500" style={{ width: `${((step + 1) / steps.length) * 100}%` }} />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button type="button" onClick={skip.onClick} className="text-[13px] font-semibold text-pv-text-muted underline-offset-2 hover:text-pv-text hover:underline">
          {skip.label}
        </button>
        <div className="hidden lg:block">
          <DeckNav step={step} count={steps.length} goRef={goRef} compact={false} final={final} />
        </div>
      </div>
    </div>
  );
}

/**
 * A headline of one or more short sentences ("A hub repeats everything. A switch delivers."): each sentence gets its
 * own line, and each line wraps balanced — so a line never ends with the first words of the next thought.
 */
export function Sentences({ text }: { text: string }) {
  const parts = text.split(/(?<=[.!?…][”"’]?)\s+(?=[A-Z0-9“"‘'(¿])/);
  if (parts.length < 2) return <span className="text-balance">{text}</span>;
  return (
    <>
      {parts.map((p, i) => (
        <span key={i} className="block text-balance">
          {/* The leading space collapses visually but keeps "work. Big" (not "work.Big") for copy and screen readers. */}
          {i > 0 && " "}
          {p}
        </span>
      ))}
    </>
  );
}

/** Slide headline at the top of the stage. */
export function StageHead({ chapter, title }: { chapter: string; title: string }) {
  return (
    <div className="text-center">
      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-pv-cyan-soft">{chapter}</p>
      <h3 className="mt-0.5 text-balance text-[18px] font-semibold leading-tight text-pv-text sm:text-[24px]">
        <Sentences text={title} />
      </h3>
    </div>
  );
}

/**
 * A token (packet) travelling from one point to another inside a relatively positioned box, in percent.
 * `stay` keeps it at the destination afterwards. Under reduced motion it simply sits at the destination (if `stay`)
 * or is hidden. Re-key it to replay.
 */
export function Mover({ from, to, delay = 0, duration = 900, stay, children }: { from: [number, number]; to: [number, number]; delay?: number; duration?: number; stay?: boolean; children: ReactNode }) {
  return (
    <span
      aria-hidden
      className={clsx("pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-1/2", stay ? "pv-move-stay" : "pv-move")}
      style={
        {
          left: `${to[0]}%`,
          top: `${to[1]}%`,
          opacity: stay ? 1 : 0,
          "--fx": `${from[0]}%`,
          "--fy": `${from[1]}%`,
          "--tx": `${to[0]}%`,
          "--ty": `${to[1]}%`,
          animationDuration: `${duration}ms`,
          animationDelay: `${delay}ms`,
        } as CSSProperties
      }
    >
      {children}
    </span>
  );
}
