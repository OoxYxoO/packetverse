/**
 * Practice Lab model contract (pure, framework-agnostic — safe to import
 * from scenario files). A lesson implements LabModel with pure functions;
 * useLabRunner decides when they are applied. See useLabRunner.ts.
 */
export interface LabModel<S, A> {
  /** Fresh lab state (also used by Reset). */
  initial: () => S;
  /** Number of visual hops/segments the action takes from `state` (0 = an instantaneous event). */
  hops: (state: S, action: A) => number;
  /** Apply the start of an action (e.g. a frame leaves its sender). */
  start: (state: S, action: A) => S;
  /** Apply one hop's arrival — the moment a device processes the event. */
  arrive: (state: S) => S;
  /**
   * Meaningful-state revision (protocol-agnostic). CLI sessions compare it to
   * decide whether old output is stale; return something that changes only
   * when inspectable state changes. Defaults to "every start/arrive".
   */
  revision?: (state: S) => string | number;
}

/** What a replay draws: hop index on the replayed path, and whether it reached the end. Visualization only. */
export interface LabReplayFrame {
  id: number;
  hop: number;
  done: boolean;
}

