"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { PracticeLabShell } from "@/components/practice-lab/PracticeLabShell";
import { DeckHeader, DeckNav, ScrollyDeck, type DeckStep } from "./ScrollyDeck";

/**
 * LESSON PRESENTATION — the "understand it first" overlay any lesson can put before its hands-on part.
 *
 * Generic: the lesson supplies the steps and a stage renderer; this owns the overlay (the same full-screen shell
 * the labs use), the current step, the header (progress, Prev/Next, Skip) and the finish action. It holds no lab,
 * lesson or progress state — opening, scrolling or finishing it cannot change progress, XP or completion.
 *
 * Also exported:
 *   usePresentationFlow   open/mounted/seen flags + "show the presentation before the lab the first time"
 *   PresentationOpenerContext / usePresentationOpener   lets Lesson Guide content link to the presentation
 *   PresentationButton / PresentationCard               entry points on the lesson page
 */

export interface LessonPresentationProps<S extends DeckStep> {
  open: boolean;
  onClose: () => void;
  /** Overlay title, e.g. "OSPF, from zero". */
  title: string;
  /** Header kicker, e.g. "Learn · the OSPF presentation". */
  kicker: string;
  steps: S[];
  /** Steps that share a key keep one stage instance (pictures animate between them). */
  visual: (step: S, index: number) => string;
  /** The stage for the current step. `replayKey` changes when the learner presses Replay in the stage. */
  renderStage: (step: S, index: number) => ReactNode;
  /** Final action (e.g. "Open the lab →" or "Back to the lesson →"). */
  finish: { label: string; onClick: () => void };
  /** Shown in the header; defaults to the finish action. */
  skip?: { label: string; onClick: () => void };
  /** Flow labels for the shell's loop strip, e.g. ["Learn", "Lesson", "Lab", "Troubleshoot"]. */
  flow?: string[];
}

export function LessonPresentation<S extends DeckStep>({ open, onClose, title, kicker, steps, visual, renderStage, finish, skip, flow = ["Learn", "Lesson", "Practice", "Troubleshoot"] }: LessonPresentationProps<S>) {
  const [step, setStep] = useState(0);
  const goRef = useRef<((i: number) => void) | undefined>(undefined);
  const onStep = useCallback((i: number) => setStep(i), []);
  const s = steps[step];
  return (
    <PracticeLabShell
      open={open}
      onClose={onClose}
      title={title}
      sandboxNote="A visual presentation · nothing here changes your progress"
      onReset={() => goRef.current?.(0)}
      stages={[]}
      currentStage={0}
      loop={{ labels: flow, current: 0 }}
      primaryAction={(compact) => (compact ? <DeckNav step={step} count={steps.length} goRef={goRef} compact final={finish} /> : null)}
      topology={<DeckHeader kicker={kicker} steps={steps} step={step} goRef={goRef} skip={skip ?? { label: "Skip →", onClick: finish.onClick }} final={finish} />}
      topologyClassName="h-auto max-w-6xl"
      board={
        <ScrollyDeck
          steps={steps}
          step={step}
          onStep={onStep}
          goRef={goRef}
          label={`${title} steps`}
          visualKey={visual(s, step)}
          stage={renderStage(s, step)}
          finalAction={
            <button type="button" onClick={finish.onClick} className="rounded-full bg-pv-cyan px-5 py-2 text-[15px] font-bold text-[#03131a] hover:brightness-110">
              {finish.label}
            </button>
          }
        />
      }
    />
  );
}

/**
 * Open/mounted/seen flags for a lesson presentation. `gate(next)` runs `next` directly once the presentation has
 * been seen in this visit, otherwise opens the presentation first and runs `next` when it finishes.
 */
export function usePresentationFlow(onBeforeOpen?: () => void) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [seen, setSeen] = useState(false);
  /** True while the presentation was opened on the way to something (the lab): its finish button continues there. */
  const [hasNext, setHasNext] = useState(false);
  const after = useRef<(() => void) | undefined>(undefined);
  const before = useRef(onBeforeOpen);
  useEffect(() => {
    before.current = onBeforeOpen;
  });
  const show = useCallback((then?: () => void) => {
    before.current?.();
    after.current = then;
    setHasNext(!!then);
    setMounted(true);
    setOpen(true);
  }, []);
  const close = useCallback(() => {
    setSeen(true);
    setOpen(false);
    after.current = undefined;
    setHasNext(false);
  }, []);
  const finish = useCallback(() => {
    setSeen(true);
    setOpen(false);
    const next = after.current;
    after.current = undefined;
    setHasNext(false);
    next?.();
  }, []);
  const gate = useCallback(
    (next: () => void) => {
      if (seen) next();
      else show(next);
    },
    [seen, show],
  );
  return { open, mounted, seen, hasNext, show, close, finish, gate };
}

/** Set around Lesson Guide content when the lesson has a presentation. */
export const PresentationOpenerContext = createContext<(() => void) | undefined>(undefined);
export function usePresentationOpener() {
  return useContext(PresentationOpenerContext);
}

export function PresentationButton({ onOpen, label = "Presentation" }: { onOpen: () => void; label?: string }) {
  return (
    <button type="button" onClick={onOpen} className="inline-flex items-center gap-1.5 rounded-lg border border-pv-cyan/50 bg-pv-cyan/10 px-3 py-1.5 text-xs font-semibold text-pv-cyan-soft transition-colors hover:bg-pv-cyan/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-pv-cyan">
      ▶ {label}
    </button>
  );
}

/** "New to X? Start here" — a slim card on the lesson page. */
export function PresentationCard({ topic, onOpen, seen }: { topic: string; onOpen: () => void; seen?: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-pv-cyan/35 bg-gradient-to-r from-pv-cyan/[0.08] to-transparent px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-pv-text">{seen ? `Watch the ${topic} presentation again` : `New to ${topic}? Start with the visual presentation`}</p>
        <p className="text-xs text-pv-text-muted">See why it exists and what every device does, step by step, before you work through the lesson.</p>
      </div>
      <button type="button" onClick={onOpen} className="shrink-0 rounded-full bg-pv-cyan px-4 py-1.5 text-xs font-bold text-[#03131a] hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">
        ▶ {seen ? "Replay" : "Start"}
      </button>
    </div>
  );
}

/** Lesson Guide bridge to the presentation (renders nothing when the lesson has none). */
export function PresentationBridge({ children, label = "Watch it as a presentation" }: { children?: ReactNode; label?: string }) {
  const open = usePresentationOpener();
  if (!open) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-pv-cyan/40 bg-pv-cyan/[0.04] px-4 py-3">
      <div className="min-w-0 text-xs text-pv-text-muted">{children}</div>
      <button type="button" onClick={open} className="shrink-0 rounded-full border border-pv-cyan/50 bg-pv-cyan/10 px-3.5 py-1.5 text-xs font-semibold text-pv-cyan-soft transition-colors hover:bg-pv-cyan/20">
        ▶ {label}
      </button>
    </div>
  );
}
