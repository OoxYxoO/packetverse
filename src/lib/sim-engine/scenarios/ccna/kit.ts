import type { PacketLayer, PacketVisual, PVEvent, PVEventType, ScenarioStep, StepQuestion, StepResult } from "../../types";
import type { PacketStackFrame, ProcessingStage } from "@/components/network3d/types";
import type { FundHop } from "@/components/lesson/fundamentalsTrace";

/**
 * Small, protocol-free helpers shared by the CCNA lessons' models. The models stay the single source of truth: every
 * hop, packet and table a lesson shows is produced by its own scenario functions; this file only removes the
 * boilerplate of building those records, so each model reads as networking logic rather than plumbing.
 */

/** The fields every CCNA lesson state carries for the shared lesson shell. Lessons add their own domain state. */
export interface KitBase {
  hops: FundHop[];
  packet?: PacketVisual;
  flood: { id: string; fromId: string; toId: string; packet: PacketVisual; edgeId?: string }[];
  /** The latest decision a device made (callouts / inspectors) — never part of a packet. */
  decision?: { device: string; text: string };
  faultActive: boolean;
  repairAttempt?: { choice: string; correct: boolean };
  repaired: boolean;
}
export const kitBase = (): KitBase => ({ hops: [], flood: [], faultActive: false, repaired: false });

export const ev = (type: PVEventType, stepId: string, message: string): PVEvent => ({ type, stepId, timestamp: Date.now(), message });

/** A packet layer from [label, value] pairs. */
export const layer = (name: string, color: string, fields: [string, string][]): PacketLayer => ({ name, color, fields: fields.map(([label, value]) => ({ label, value })) });

export function packet(id: string, protocol: PacketVisual["protocol"], from: string, to: string, badge: string, summary: string, layers: PacketLayer[], broadcast = false): PacketVisual {
  return { id, protocol, from, to, badge, summary, layers, broadcast };
}
/** The same packet, moved to another hop (id kept unique per hop). */
export const moved = (p: PacketVisual, id: string, from: string, to: string): PacketVisual => ({ ...p, id, from, to });

/** A wire-level stack for device traces, from a packet's own layers (first field of each layer as the summary). */
export const stackOf = (p: PacketVisual): PacketStackFrame[] =>
  p.layers.map((l, i) => ({ id: `${i}-${l.name}`, text: `${l.name} · ${l.fields.map((f) => `${f.label} ${f.value}`).join(" · ")}`, tone: (i === 0 ? "generic" : "ip") as PacketStackFrame["tone"] }));

export const withDetail = (base: ProcessingStage[], d: Partial<Record<string, string>>): ProcessingStage[] => base.map((s) => (d[s.id] ? { ...s, detail: d[s.id] } : s));

/** Build a hop record (what one device did at one step). */
export function hop(h: Omit<FundHop, "lookupType" | "lookupKey" | "lookupResult" | "input" | "output"> & Partial<Pick<FundHop, "lookupType" | "lookupKey" | "lookupResult" | "input" | "output">>): FundHop {
  return { lookupType: "", lookupKey: "", lookupResult: "", input: "", output: "", ...h };
}

/** Append a hop, set the packet and decision, clear floods: the common "a device acted" transition. */
export function acted<S extends KitBase>(s: S, h: FundHop, p: PacketVisual | undefined, decision?: string, flood: KitBase["flood"] = []): S {
  return { ...s, hops: [...s.hops, h], packet: p, flood, decision: decision ? { device: h.device, text: decision } : undefined };
}

/** The packet the shell animates at a step: the one the model left in flight. */
const shownPacket = <S extends KitBase>(s: S) => s.packet;

/** A plain teaching step (no state change beyond clearing the animated packet unless `keepPacket`). */
export function say<S extends KitBase>(id: string, label: string, narrative: string, opts: { keepPacket?: boolean; question?: StepQuestion; run?: (s: S) => S; events?: (s: S) => PVEvent[] } = {}): ScenarioStep<S> {
  return {
    id,
    label,
    narrative,
    question: opts.question,
    packet: shownPacket,
    run: (s: S): StepResult<S> => {
      const base = opts.keepPacket ? s : { ...s, packet: undefined, flood: [] };
      const next = opts.run ? opts.run(base) : base;
      return { state: next, events: opts.events ? opts.events(next) : [ev("STEP_ENTERED", id, label)] };
    },
  };
}

/** A step that runs a model transition and reports one event. */
export function act<S extends KitBase>(id: string, label: string, narrative: string, run: (s: S) => S, event: PVEventType = "PACKET_SENT", question?: StepQuestion): ScenarioStep<S> {
  return { id, label, narrative, question, packet: shownPacket, run: (s: S) => ({ state: run(s), events: [ev(event, id, label)] }) };
}

/** A prediction question (the answer is never in the prompt; the explanation says why each wrong option fails). */
export const q = (prompt: string, options: [string, string][], correctOptionId: string, explanation: string, hints?: string[]): StepQuestion => ({
  prompt,
  options: options.map(([id, label]) => ({ id, label })),
  correctOptionId,
  explanation,
  hints,
});

/** The repair-challenge step: retriable action until the correct repair is chosen. */
export function repairStep<S extends KitBase>(id: string, label: string, narrative: string, correctId: string, apply: (s: S) => S): ScenarioStep<S> {
  return {
    id,
    label,
    narrative,
    packet: shownPacket,
    run: (s: S) => ({ state: { ...s, packet: undefined, flood: [] }, events: [ev("STEP_ENTERED", id, label)] }),
    action: (s: S, payload: unknown) => {
      const choice = (payload as { choice: string }).choice;
      const correct = choice === correctId;
      const next = correct ? apply({ ...s, repairAttempt: { choice, correct }, repaired: true, faultActive: false }) : { ...s, repairAttempt: { choice, correct } };
      return { state: next, events: [ev("QUESTION_ANSWERED", id, correct ? "repair applied" : "repair rejected")] };
    },
    requiresState: (s: S) => s.repaired,
  };
}
