"use client";

import { useMemo, useSyncExternalStore } from "react";
import { ScenarioEngine } from "./ScenarioEngine";
import type { ScenarioStep } from "./types";

/**
 * React binding for a ScenarioEngine. The engine instance is created
 * once (per mount) and exposed as a live, re-render-triggering
 * snapshot via useSyncExternalStore — no protocol logic lives in this
 * hook, it only relays engine state to components.
 */
export function useScenarioEngine<TState>(
  initialState: TState,
  steps: ScenarioStep<TState>[],
) {
  const engine = useMemo(
    () => new ScenarioEngine<TState>(initialState, steps),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const snapshot = useSyncExternalStore(engine.subscribe, engine.getSnapshot, engine.getSnapshot);

  return { engine, snapshot };
}
