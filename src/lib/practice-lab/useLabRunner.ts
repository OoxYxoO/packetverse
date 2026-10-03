"use client";

import { useEffect, useRef, useState } from "react";
import type { LabModel, LabReplayFrame } from "./types";

export type { LabModel, LabReplayFrame } from "./types";

export interface LabRunnerOptions {
  segmentMs?: number;
  /** Pause between chained actions in `runSequence`. */
  pauseMs?: number;
  /** How long the final replay frame lingers before clearing. */
  replayLingerMs?: number;
}

/**
 * Practice Lab runner — generic event/animation orchestration.
 *
 * The lesson owns a PURE lab model: its state, what an action does when it
 * starts, and what happens at each visual hop ("arrival"). The runner only
 * decides WHEN those pure functions are applied:
 *
 *   animated:  start → (segmentMs) → arrive → (segmentMs) → arrive …
 *   instant:   start + every arrive, synchronously
 *
 * State therefore changes exactly at the lesson-defined event boundaries,
 * never in between. Replay re-plays the visualization of the last action
 * (a hop counter only) and never calls the model, so it cannot mutate
 * state, re-learn anything or duplicate event-log entries. The runner has
 * no knowledge of any protocol and never touches lesson progress.
 */
export function useLabRunner<S, A>(model: LabModel<S, A>, { segmentMs = 1200, pauseMs = 900, replayLingerMs = 800 }: LabRunnerOptions = {}) {
  const [state, setState] = useState<S>(model.initial);
  const [animate, setAnimate] = useState(true);
  const [busy, setBusy] = useState(false);
  const [resetCount, setResetCount] = useState(0);
  const [steps, setSteps] = useState(0);
  const [replayFrame, setReplayFrame] = useState<LabReplayFrame | undefined>(undefined);
  const [replayCount, setReplayCount] = useState(0);
  const timers = useRef<number[]>([]);
  const replayTimers = useRef<number[]>([]);

  useEffect(
    () => () => {
      timers.current.forEach((t) => window.clearTimeout(t));
      replayTimers.current.forEach((t) => window.clearTimeout(t));
    },
    [],
  );

  function stopReplay() {
    replayTimers.current.forEach((t) => window.clearTimeout(t));
    replayTimers.current = [];
    setReplayFrame(undefined);
  }

  /** Run one action. `then` runs after the last arrival (plus `pauseMs` when animated). */
  function run(action: A, then?: () => void) {
    stopReplay();
    const hops = model.hops(state, action);
    if (!animate || hops === 0) {
      setState((s) => {
        let next = model.start(s, action);
        for (let h = 0; h < hops; h++) next = model.arrive(next);
        return next;
      });
      setSteps((n) => n + 1 + hops);
      then?.();
      return;
    }
    setState((s) => model.start(s, action));
    setSteps((n) => n + 1);
    for (let h = 1; h <= hops; h++)
      timers.current.push(
        window.setTimeout(() => {
          setState((s) => model.arrive(s));
          setSteps((n) => n + 1);
        }, h * segmentMs),
      );
    if (then) timers.current.push(window.setTimeout(then, hops * segmentMs + pauseMs));
  }

  /** Run several actions back to back (e.g. "run the full exchange"); `busy` is true until the last one finishes. */
  function runSequence(actions: A[]) {
    if (actions.length === 0) return;
    setBusy(true);
    const go = (i: number) => {
      if (i >= actions.length) {
        setBusy(false);
        return;
      }
      run(actions[i], () => go(i + 1));
    };
    go(0);
  }

  /** Re-play the visualization of a completed action with `hops` segments. Never touches lab state. */
  function replay(hops: number) {
    stopReplay();
    const id = -(replayCount + 1);
    setReplayCount((c) => c + 1);
    setReplayFrame({ id, hop: 0, done: hops === 0 });
    for (let h = 1; h <= hops; h++) replayTimers.current.push(window.setTimeout(() => setReplayFrame((r) => (r ? { ...r, hop: h, done: h === hops } : r)), h * segmentMs));
    replayTimers.current.push(window.setTimeout(() => setReplayFrame(undefined), hops * segmentMs + replayLingerMs));
  }

  /** Back to the lesson-defined initial state; cancels pending arrivals and replays. */
  function reset() {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
    stopReplay();
    setBusy(false);
    setState(model.initial());
    setSteps(0);
    setResetCount((c) => c + 1);
  }

  const revision = `${resetCount}:${model.revision ? model.revision(state) : steps}`;

  return { state, run, runSequence, replay, replayFrame, stopReplay, reset, busy, animate, setAnimate, revision, resetCount, segmentMs };
}

export type LabRunner<S, A> = ReturnType<typeof useLabRunner<S, A>>;
