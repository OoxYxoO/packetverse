"use client";

import { useCallback, useMemo, useReducer } from "react";
import { installDerived } from "@/lib/sim-engine/arena/faultRegistry";
import { generateScenario, type GeneratedScenario } from "@/lib/sim-engine/arena/scenarioGenerator";
import { computeScore, type ScoreBreakdown } from "@/lib/sim-engine/arena/scoring";
import { CATEGORY_TO_HYPOTHESIS, type ArenaDeviceId, type ArenaState, type Difficulty, type HypothesisCategory, type ScenarioMode } from "@/lib/sim-engine/arena/faultTypes";
import { runTest, type TestId, type TestResult } from "./evidence";

export interface Finding {
  id: string;
  text: string;
  kind: "healthy" | "suspicious";
  timeLabel: string;
}
export interface TestLogEntry {
  id: string;
  testId: TestId;
  params: Record<string, string>;
  result: TestResult;
  timeLabel: string;
  relevant: boolean;
}
export interface TimelineEntry {
  id: string;
  timeLabel: string;
  text: string;
}
export interface RepairAttemptLog {
  repairId: string;
  label: string;
  correct: boolean;
  timeLabel: string;
}
export interface Snapshot {
  label: string;
  timeLabel: string;
  timelineLength: number;
}

export interface ArenaSession {
  scenario: GeneratedScenario;
  hypothesis?: HypothesisCategory;
  hypothesisHistory: HypothesisCategory[];
  findings: Finding[];
  testLog: TestLogEntry[];
  timeline: TimelineEntry[];
  hintsRevealed: number;
  inspectedDevices: ArenaDeviceId[];
  mode: "investigate" | "repair";
  repairAttempts: RepairAttemptLog[];
  correctRepairApplied: boolean;
  verifyAttempts: number;
  verified: boolean;
  resolved: boolean;
  score?: ScoreBreakdown;
  instructorMode: boolean;
  snapshots: Snapshot[];
  startedAtMs: number;
  replayIndex?: number;
  /** Frozen ArenaState from the instant BEFORE the first correct repair was applied (brief §13/§37: "broken vs repaired comparison" needs two genuinely distinct, frozen snapshots — never a recomputation against live state, which would silently show the already-healed value for the "before" side once a repair lands). Undefined until a correct repair has actually been applied. */
  stateBeforeFix?: ArenaState;
}

type Action =
  | { type: "RUN_TEST"; testId: TestId; params: Record<string, string>; device?: ArenaDeviceId }
  | { type: "ADD_FINDING"; text: string; kind: "healthy" | "suspicious" }
  | { type: "SET_HYPOTHESIS"; hypothesis: HypothesisCategory }
  | { type: "REVEAL_HINT" }
  | { type: "ENTER_REPAIR_MODE" }
  | { type: "APPLY_REPAIR"; repairId: string }
  | { type: "VERIFY" }
  | { type: "TOGGLE_INSTRUCTOR" }
  | { type: "SET_REPLAY_INDEX"; index: number | undefined }
  | { type: "INSPECT_DEVICE"; device: ArenaDeviceId };

function elapsedLabel(startedAtMs: number): string {
  const elapsed = Math.max(0, Date.now() - startedAtMs);
  const totalSeconds = Math.floor(elapsed / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function newSession(scenario: GeneratedScenario): ArenaSession {
  return {
    scenario,
    hypothesisHistory: [],
    findings: [],
    testLog: [],
    timeline: [{ id: crypto.randomUUID(), timeLabel: "00:00", text: "Incident opened." }],
    hintsRevealed: 0,
    inspectedDevices: [],
    mode: "investigate",
    repairAttempts: [],
    correctRepairApplied: false,
    verifyAttempts: 0,
    verified: false,
    resolved: false,
    instructorMode: false,
    snapshots: [{ label: "Incident opened", timeLabel: "00:00", timelineLength: 1 }],
    startedAtMs: Date.now(),
  };
}

// Pairs of TestIds that read the exact same underlying predicate (see
// evidence.ts) and so are equally valid diagnostic evidence for a fault,
// even though only one of them happens to be the fault's verificationTest.
// Without this, a learner who runs the OTHER member of the pair — an
// equally correct diagnostic choice — would score zero investigation
// credit purely because of which sibling test the fault author picked.
const EQUIVALENT_TEST_IDS: Partial<Record<TestId, TestId>> = {
  "df-state": "ethernet-segment",
  "ethernet-segment": "df-state",
};

function isRelevantTest(scenario: GeneratedScenario, testId: TestId, params: Record<string, string>, device?: ArenaDeviceId): boolean {
  const objectIds = new Set(scenario.faults.flatMap((f) => f.affectedObjects));
  if (device && objectIds.has(device)) return true;
  const paramDevices = Object.values(params).flatMap((v) => v.split(","));
  if (paramDevices.some((v) => objectIds.has(v as ArenaDeviceId))) return true;
  const wantedTestIds = new Set(scenario.faults.map((f) => f.verificationTest.testId));
  if (wantedTestIds.has(testId)) return true;
  const sibling = EQUIVALENT_TEST_IDS[testId];
  return sibling !== undefined && wantedTestIds.has(sibling);
}

function reducer(session: ArenaSession, action: Action): ArenaSession {
  const t = elapsedLabel(session.startedAtMs);
  switch (action.type) {
    case "RUN_TEST": {
      const result = runTest(session.scenario.state, action.testId, action.params);
      const relevant = isRelevantTest(session.scenario, action.testId, action.params, action.device);
      const entry: TestLogEntry = { id: crypto.randomUUID(), testId: action.testId, params: action.params, result, timeLabel: t, relevant };
      const inspectedDevices = action.device && !session.inspectedDevices.includes(action.device) ? [...session.inspectedDevices, action.device] : session.inspectedDevices;
      return {
        ...session,
        testLog: [...session.testLog, entry],
        timeline: [...session.timeline, { id: crypto.randomUUID(), timeLabel: t, text: `${result.title}${action.params.from ? ` (${action.params.from} → ${action.params.to ?? ""})` : ""}: ${result.success === undefined ? "checked" : result.success ? "passed" : "failed"}` }],
        inspectedDevices,
        snapshots: [...session.snapshots, { label: result.title, timeLabel: t, timelineLength: session.timeline.length + 1 }],
      };
    }
    case "INSPECT_DEVICE": {
      if (session.inspectedDevices.includes(action.device)) return session;
      return { ...session, inspectedDevices: [...session.inspectedDevices, action.device] };
    }
    case "ADD_FINDING": {
      const finding: Finding = { id: crypto.randomUUID(), text: action.text, kind: action.kind, timeLabel: t };
      return { ...session, findings: [...session.findings, finding], timeline: [...session.timeline, { id: crypto.randomUUID(), timeLabel: t, text: `Finding recorded: ${action.text}` }] };
    }
    case "SET_HYPOTHESIS": {
      return { ...session, hypothesis: action.hypothesis, hypothesisHistory: [...session.hypothesisHistory, action.hypothesis], timeline: [...session.timeline, { id: crypto.randomUUID(), timeLabel: t, text: `Hypothesis set: ${action.hypothesis}` }] };
    }
    case "REVEAL_HINT": {
      if (session.hintsRevealed >= 3) return session;
      return { ...session, hintsRevealed: session.hintsRevealed + 1, timeline: [...session.timeline, { id: crypto.randomUUID(), timeLabel: t, text: `Hint ${session.hintsRevealed + 1} requested.` }] };
    }
    case "ENTER_REPAIR_MODE": {
      return { ...session, mode: "repair", timeline: [...session.timeline, { id: crypto.randomUUID(), timeLabel: t, text: "Entered repair mode." }] };
    }
    case "APPLY_REPAIR": {
      const repair = session.scenario.faults.flatMap((f) => f.repairs).find((r) => r.id === action.repairId);
      if (!repair) return session;
      const correct = repair.correct;
      const nextState = correct ? installDerived(repair.apply(session.scenario.state)) : session.scenario.state;
      const log: RepairAttemptLog = { repairId: repair.id, label: repair.label, correct, timeLabel: t };
      const stateBeforeFix = correct && !session.stateBeforeFix ? session.scenario.state : session.stateBeforeFix;
      return {
        ...session,
        scenario: { ...session.scenario, state: nextState },
        stateBeforeFix,
        repairAttempts: [...session.repairAttempts, log],
        correctRepairApplied: session.correctRepairApplied || correct,
        timeline: [...session.timeline, { id: crypto.randomUUID(), timeLabel: t, text: correct ? `Repair applied: ${repair.label}` : `Repair attempted (no effect): ${repair.label}` }],
        snapshots: [...session.snapshots, { label: correct ? "Repair applied" : "Repair attempted", timeLabel: t, timelineLength: session.timeline.length + 1 }],
      };
    }
    case "VERIFY": {
      const test = session.scenario.faults[0].verificationTest;
      const allPass = session.scenario.faults.every((f) => runTest(session.scenario.state, f.verificationTest.testId as TestId, f.verificationTest.params).success !== false);
      const verified = allPass;
      return {
        ...session,
        verifyAttempts: session.verifyAttempts + 1,
        verified: session.verified || verified,
        resolved: session.resolved || verified,
        timeline: [...session.timeline, { id: crypto.randomUUID(), timeLabel: t, text: verified ? `Verification succeeded — ${test.description}` : `Verification failed — symptom still present` }],
        snapshots: [...session.snapshots, { label: verified ? "Verified" : "Verify failed", timeLabel: t, timelineLength: session.timeline.length + 1 }],
      };
    }
    case "TOGGLE_INSTRUCTOR":
      return { ...session, instructorMode: !session.instructorMode };
    case "SET_REPLAY_INDEX":
      return { ...session, replayIndex: action.index };
    default:
      return session;
  }
}

export function useArenaEngine(initial: { seed?: string; difficulty: Difficulty; mode: ScenarioMode; explicitFaultId?: import("@/lib/sim-engine/arena/faultTypes").FaultId }) {
  const [session, dispatch] = useReducer(reducer, undefined, () => newSession(generateScenario(initial)));

  const score: ScoreBreakdown | undefined = useMemo(() => {
    if (!session.resolved) return undefined;
    return computeScore({
      faults: session.scenario.faults,
      hypothesisHistory: session.hypothesisHistory,
      finalHypothesis: session.hypothesis,
      testRelevance: session.testLog.map((e) => (e.relevant ? "relevant" : "exploratory")),
      wrongRepairAttempts: session.repairAttempts.filter((r) => !r.correct).length,
      correctRepairApplied: session.correctRepairApplied,
      hintsRevealed: session.hintsRevealed,
      verified: session.verified,
    });
  }, [session]);

  const correctHypotheses = useMemo(() => new Set(session.scenario.faults.map((f) => CATEGORY_TO_HYPOTHESIS[f.category])), [session.scenario.faults]);

  const runTestAction = useCallback((testId: TestId, params: Record<string, string>, device?: ArenaDeviceId) => dispatch({ type: "RUN_TEST", testId, params, device }), []);
  const addFinding = useCallback((text: string, kind: "healthy" | "suspicious") => dispatch({ type: "ADD_FINDING", text, kind }), []);
  const setHypothesis = useCallback((hypothesis: HypothesisCategory) => dispatch({ type: "SET_HYPOTHESIS", hypothesis }), []);
  const revealHint = useCallback(() => dispatch({ type: "REVEAL_HINT" }), []);
  const enterRepairMode = useCallback(() => dispatch({ type: "ENTER_REPAIR_MODE" }), []);
  const applyRepair = useCallback((repairId: string) => dispatch({ type: "APPLY_REPAIR", repairId }), []);
  const verify = useCallback(() => dispatch({ type: "VERIFY" }), []);
  const toggleInstructor = useCallback(() => dispatch({ type: "TOGGLE_INSTRUCTOR" }), []);
  const inspectDevice = useCallback((device: ArenaDeviceId) => dispatch({ type: "INSPECT_DEVICE", device }), []);
  const setReplayIndex = useCallback((index: number | undefined) => dispatch({ type: "SET_REPLAY_INDEX", index }), []);

  return { session, score, correctHypotheses, runTest: runTestAction, addFinding, setHypothesis, revealHint, enterRepairMode, applyRepair, verify, toggleInstructor, inspectDevice, setReplayIndex };
}
