/**
 * Shared vocabulary for the Troubleshooting track (Packet Analysis, Layer 1, Layer 2, Layer 3). No protocol logic and
 * no scenario truth live here — only the method every lesson teaches and the shape of the lesson-local evidence
 * notebook. Each lesson appends notebook entries to its OWN state, so a historical step shows exactly the reasoning
 * that existed at that point (and never a later diagnosis).
 */

/** The disciplined workflow: never "guess → change something → hope". */
export const TS_WORKFLOW = ["Define", "Scope", "Gather Evidence", "Form Hypothesis", "Test", "Repair", "Verify"] as const;
export type TsWorkflowStage = (typeof TS_WORKFLOW)[number];

/** The evidence ladder used across the track. Start from observable facts and find the lowest broken dependency —
 *  but evidence may justify narrowing scope earlier; it is a ladder of dependencies, not a mandatory bottom-up ritual. */
export const TS_LADDER = ["Physical / interface", "Ethernet / VLAN", "ARP / neighbor", "IP addressing", "Routing / forwarding", "Transport", "Application", "Policy / service-specific"] as const;
export type TsLadderRung = (typeof TS_LADDER)[number];

/**
 * One line of reasoning. The kinds keep the distinctions the track insists on:
 * a symptom (what a user reports) is not an observation (a fact you measured), an inference (what a fact implies)
 * is not a hypothesis (a candidate cause you still have to test), and only a tested hypothesis becomes the
 * confirmed root cause.
 */
export type NoteKind = "symptom" | "observation" | "inference" | "hypothesis" | "ruled-out" | "root-cause" | "verified";
export interface NotebookEntry {
  stepId: string;
  kind: NoteKind;
  /** What was seen or reasoned, in neutral, evidence-first wording. */
  text: string;
  /** Where the fact came from (a capture point, a counter, a table). */
  source?: string;
  rung?: TsLadderRung;
}
export const NOTE_LABEL: Record<NoteKind, string> = { symptom: "Symptom", observation: "Observation", inference: "Inference", hypothesis: "Hypothesis", "ruled-out": "Ruled out", "root-cause": "Confirmed root cause", verified: "Verified" };

/** Append notebook entries to a state that carries a notebook (pure; returns a new state). */
export function withNotes<S extends { notebook: NotebookEntry[] }>(s: S, stepId: string, entries: Omit<NotebookEntry, "stepId">[]): S {
  return { ...s, notebook: [...s.notebook, ...entries.map((e) => ({ ...e, stepId }))] };
}
