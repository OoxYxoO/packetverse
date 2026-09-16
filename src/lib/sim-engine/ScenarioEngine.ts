import type {
  PVEvent,
  ScenarioSnapshot,
  ScenarioStep,
} from "./types";

/**
 * Generic, framework-agnostic step engine that drives every interactive
 * scenario in PacketVerse (ARP, TCP handshake, OSPF, MPLS, ...).
 *
 * It knows nothing about React, Three.js or DOM — it is pure state +
 * an event log, exposed through subscribe()/getSnapshot() so it can be
 * wired into React via useSyncExternalStore, or reused headlessly in
 * tests.
 */
export class ScenarioEngine<TState> {
  private state: TState;
  private readonly initialState: TState;
  private readonly steps: ScenarioStep<TState>[];
  private index = 0;
  private events: PVEvent[] = [];
  private lastAnswer?: { stepId: string; optionId: string; correct: boolean };
  /**
   * whatChanged is keyed by step index rather than a single "last"
   * value, so that a step's own run() effects are always displayed
   * alongside that same step's narrative (not the next one's), and so
   * goTo() can restore the right diff for a step already visited.
   */
  private whatChangedByIndex = new Map<number, string[]>();
  /**
   * State snapshot taken the moment each index is entered, so goTo()
   * can restore state exactly rather than just rewinding the index —
   * without this, going Previous past a step that mutated state (a
   * label push/swap/pop, say) left that mutation in place even though
   * the displayed step no longer claims it happened yet.
   */
  private stateByIndex = new Map<number, TState>();
  private listeners = new Set<() => void>();
  /**
   * useSyncExternalStore requires getSnapshot() to return a
   * referentially stable value when nothing has changed — otherwise
   * React (and the SSR pass in particular) can loop. We cache the
   * computed snapshot and only recompute it when notify() runs.
   */
  private cachedSnapshot: ScenarioSnapshot<TState> | null = null;

  constructor(initialState: TState, steps: ScenarioStep<TState>[]) {
    this.initialState = initialState;
    this.state = initialState;
    this.steps = steps;
    this.applyStepEffects(0);
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): ScenarioSnapshot<TState> => {
    if (this.cachedSnapshot) return this.cachedSnapshot;
    const currentStep = this.steps[this.index];
    const activePacket = currentStep?.packet?.(this.state);
    this.cachedSnapshot = {
      state: this.state,
      index: this.index,
      totalSteps: this.steps.length,
      currentStep,
      events: this.events,
      isComplete: this.index >= this.steps.length,
      lastAnswer: this.lastAnswer,
      whatChanged: this.whatChangedByIndex.get(this.index) ?? [],
      activePacket,
    };
    return this.cachedSnapshot;
  };

  /** Records the learner's answer to the current step's question. */
  answer(optionId: string) {
    const step = this.steps[this.index];
    if (!step?.question) return;
    const correct = optionId === step.question.correctOptionId;
    this.lastAnswer = { stepId: step.id, optionId, correct };
    this.push({
      type: "QUESTION_ANSWERED",
      stepId: step.id,
      timestamp: Date.now(),
      message: `Answered "${step.question.prompt}" — ${correct ? "correct" : "incorrect"}`,
      payload: { optionId, correct },
    });
    this.notify();
  }

  /**
   * Applies a learner action to the current step (e.g. "try this OSPF
   * cost") without advancing the step index, so a challenge step can
   * be retried until `requiresState` is satisfied.
   */
  act(payload: unknown) {
    const step = this.steps[this.index];
    if (!step?.action) return;
    const { state: next, events } = step.action(this.state, payload);
    this.state = next;
    this.stateByIndex.set(this.index, this.state);
    events.forEach((e) => this.push(e));
    this.notify();
  }

  /** A question (or a requiresState predicate) must be satisfied before the learner can move on. */
  canAdvance(): boolean {
    const step = this.steps[this.index];
    if (!step) return false;
    if (step.question && this.lastAnswer?.stepId !== step.id) return false;
    if (step.requiresState && !step.requiresState(this.state)) return false;
    return true;
  }

  advance() {
    if (this.index >= this.steps.length) return;

    this.index += 1;
    this.lastAnswer = undefined;

    if (this.index >= this.steps.length) {
      const lastStep = this.steps[this.steps.length - 1];
      this.push({
        type: "SCENARIO_COMPLETED",
        stepId: lastStep?.id ?? "",
        timestamp: Date.now(),
        message: "Scenario complete",
      });
    } else {
      this.applyStepEffects(this.index);
    }

    this.notify();
  }

  restart() {
    this.state = this.initialState;
    this.index = 0;
    this.events = [];
    this.lastAnswer = undefined;
    this.whatChangedByIndex = new Map();
    this.stateByIndex = new Map();
    this.applyStepEffects(0);
    this.notify();
  }

  goTo(index: number) {
    if (index < 0 || index > this.index) return;
    this.index = index;
    this.lastAnswer = undefined;
    const snapshot = this.stateByIndex.get(index);
    if (snapshot !== undefined) this.state = snapshot;
    this.notify();
  }

  /**
   * Runs a step's own run()/whatChanged() the moment it BECOMES the
   * current step (on construction, advance(), or restart()) — so a
   * step's data effects are always shown next to that same step's own
   * narrative, never next to the following step's.
   */
  private applyStepEffects(index: number) {
    const step = this.steps[index];
    if (!step) return;

    this.push({
      type: "STEP_ENTERED",
      stepId: step.id,
      timestamp: Date.now(),
      message: step.label,
    });

    if (step.run) {
      const prev = this.state;
      const { state: next, events } = step.run(prev);
      this.state = next;
      events.forEach((e) => this.push(e));
      this.whatChangedByIndex.set(index, step.whatChanged?.(prev, next) ?? []);
    } else {
      this.whatChangedByIndex.set(index, []);
    }
    this.stateByIndex.set(index, this.state);
  }

  private push(event: PVEvent) {
    this.events = [...this.events, event];
  }

  private notify() {
    this.cachedSnapshot = null;
    this.listeners.forEach((l) => l());
  }
}
