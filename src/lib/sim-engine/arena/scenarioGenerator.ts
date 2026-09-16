import { buildBaselineState, faultsForDifficulty, getFault, installDerived } from "./faultRegistry";
import type { ArenaFault, ArenaState, Difficulty, FaultId, IncidentReport, ScenarioMode } from "./faultTypes";

/** Deterministic string hash → seed for a small PRNG (xmur3 + mulberry32) — no external dependency, fully reproducible across sessions/machines. */
function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}
function mulberry32(seedInt: number): () => number {
  let a = seedInt;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rngFromSeed(seed: string): () => number {
  const seedFn = xmur3(seed);
  return mulberry32(seedFn());
}

function randomHex(rng: () => number, len: number): string {
  let out = "";
  for (let i = 0; i < len; i++) out += Math.floor(rng() * 16).toString(16).toUpperCase();
  return out;
}

export interface GeneratedScenario {
  seed: string;
  difficulty: Difficulty;
  faultIds: FaultId[];
  faults: ArenaFault[];
  state: ArenaState;
  incident: IncidentReport;
}

const EXPLICIT_SEED_RE = /^EVPN-([A-L](?:\+[A-L])?)-([0-9A-F]+)$/;

/** Choose up to two faults for `difficulty` from `rng`, honoring the compatibility matrix (brief §29): a second fault is only ever added if neither conflicts with the other, and only at Expert. */
function pickFaults(rng: () => number, difficulty: Difficulty): FaultId[] {
  const pool = faultsForDifficulty(difficulty);
  const first = pool[Math.floor(rng() * pool.length)];
  if (difficulty !== "expert" || rng() < 0.6) return [first.id];
  const compatible = pool.filter((f) => f.id !== first.id && !f.conflictsWith.includes(first.id) && !first.conflictsWith.includes(f.id));
  if (compatible.length === 0) return [first.id];
  const second = compatible[Math.floor(rng() * compatible.length)];
  return [first.id, second.id];
}

function applyFaults(seed: string, difficulty: Difficulty, faultIds: FaultId[]): ArenaState {
  let state = buildBaselineState(seed, difficulty);
  state = { ...state, activeFaultIds: faultIds };
  for (const id of faultIds) state = getFault(id).apply(state);
  // Faults mutate only raw facts (e.g. remoteExpectedMtu); derived fields
  // (vpws.status, aliasing.eligiblePEs) must be recomputed once after the
  // loop, the same way every repair recomputes them — otherwise a fault
  // whose symptom lives in a derived field wouldn't show as broken until
  // the first repair happened to recompute it for the first time.
  return installDerived(state);
}

function buildIncidentText(rng: () => number, faults: ArenaFault[]): IncidentReport {
  const primary = faults[0].buildIncident(rng);
  if (faults.length === 1) return primary;
  const secondary = faults[1].buildIncident(rng);
  return { ...primary, report: `${primary.report} Separately: ${secondary.report[0].toLowerCase()}${secondary.report.slice(1)}` };
}

/**
 * Generates a fully deterministic scenario from a seed string alone —
 * the same seed always yields the same fault(s), topology state, and
 * incident text (brief §6). `mode`/`explicitFaultId` only affect HOW
 * a seed is minted when the caller doesn't supply one; once a seed
 * exists, everything is a pure function of that string.
 */
export function generateScenario(opts: { seed?: string; difficulty: Difficulty; mode: ScenarioMode; explicitFaultId?: FaultId }): GeneratedScenario {
  let seed = opts.seed;
  if (!seed) {
    const mintRng = opts.mode === "daily" ? rngFromSeed(`daily-${new Date().toISOString().slice(0, 10)}-${opts.difficulty}`) : rngFromSeed(`${Date.now()}-${Math.random()}`);
    if (opts.explicitFaultId) {
      seed = `EVPN-${opts.explicitFaultId}-${randomHex(mintRng, 5)}`;
    } else if (opts.mode === "daily") {
      const pool = faultsForDifficulty(opts.difficulty);
      const pick = pool[Math.floor(mintRng() * pool.length)];
      seed = `EVPN-${pick.id}-${randomHex(mintRng, 5)}`;
    } else {
      seed = `EVPN-${randomHex(mintRng, 5)}`;
    }
  }

  const explicit = seed.match(EXPLICIT_SEED_RE);
  let faultIds: FaultId[];
  const rng = rngFromSeed(seed);
  if (explicit) {
    faultIds = explicit[1].split("+") as FaultId[];
  } else {
    faultIds = pickFaults(rng, opts.difficulty);
  }

  const faults = faultIds.map(getFault);
  const state = applyFaults(seed, opts.difficulty, faultIds);
  const incident = buildIncidentText(rng, faults);
  return { seed, difficulty: opts.difficulty, faultIds, faults, state, incident };
}

export function regenerateFromSeed(seed: string, difficulty: Difficulty): GeneratedScenario {
  return generateScenario({ seed, difficulty, mode: "select" });
}
