import type { PacketVisual } from "@/lib/sim-engine/types";
import type { PacketCallout3D } from "@/components/network3d/types";
import { PROTOCOL_HEX } from "./packetCallout";
import { shimStack, type ShimView } from "./mplsStack";

/**
 * Readable callouts for the SR-MPLS family (Foundations, SR Policy, TI-LFA,
 * Flex-Algo). Labels, S bits and the active (top) SID are read back from the
 * PacketVisual the scenario built from post-run state — never recomputed —
 * so a label removed by PHP or a completed segment can never reappear here.
 */

/** Meaning of one SR label value, supplied by each lesson from its own SID tables (e.g. "R6 Node SID"). */
export type SidMeaning = (label: string) => string | undefined;

const ACTION_TITLE: Record<string, string> = {
  PUSH: "PUSH",
  CONTINUE: "Forward, label unchanged",
  FORWARD: "Forward, label unchanged",
  POP: "POP",
  POP_AND_FORWARD_ADJ: "Execute local Adj-SID",
  ARRIVED: "Segment complete (PHP)",
  REPAIR: "TI-LFA repair PUSH",
  "REPAIR COMPLETE": "Repair segment complete",
  "REPAIR FAILED": "Stale repair",
  INVALID_SID: "Invalid SID",
};

/** Actions whose packet visual is the stack AFTER a label was removed. */
const POPPED_ACTIONS = new Set(["POP_AND_FORWARD_ADJ", "REPAIR COMPLETE", "POP"]);

/** Splits "PUSH: impose Node SID R6" into its action token and the rest; a badge (TI-LFA / Flex-Algo) wins when present. */
function actionOf(packet: PacketVisual): { action?: string; rest: string } {
  const m = /^([A-Z_ ]+):\s*(.*)$/.exec(packet.summary);
  if (packet.badge) return { action: packet.badge, rest: m ? m[2] : packet.summary };
  return m ? { action: m[1], rest: m[2] } : { rest: packet.summary };
}

/** Role tag from the scenario's own shim layer name, e.g. "MPLS Shim (TI-LFA repair)". */
function roleOf(shim: ShimView, stack: ShimView[]): string | undefined {
  if (!shim.purpose) return undefined;
  if (/repair/i.test(shim.purpose)) return "repair";
  if (/SR segment/i.test(shim.purpose) && stack.some((s) => /repair/i.test(s.purpose ?? ""))) return "original";
  const algo = /Algorithm (\d+)/.exec(shim.purpose);
  return algo ? `Algo ${algo[1]}` : undefined;
}

/** "24035 S0 (R3→R5 Adj-SID, local to R3) / 16006 S1 (R6 Node SID)" — top of stack first. */
export function srStackText(stack: ShimView[], meaning: SidMeaning): string {
  if (stack.length === 0) return "no MPLS labels (plain IP)";
  return stack
    .map((s) => {
      const m = meaning(s.label);
      const role = roleOf(s, stack);
      const tags = [m, role && !m?.includes(role) ? role : undefined].filter(Boolean).join(" · ");
      return `${s.label} S${s.s}${tags ? ` (${tags})` : ""}`;
    })
    .join(" / ");
}

export function srCallout(packet: PacketVisual, meaning: SidMeaning, opts: { logicalList?: string } = {}): PacketCallout3D {
  const color = PROTOCOL_HEX[packet.protocol];
  const stack = shimStack(packet);
  const { action, rest } = actionOf(packet);
  const logical = opts.logicalList ? ` · logical list ${opts.logicalList}` : "";

  if (stack.length === 0) {
    if (action === "POP") return { title: `PHP · ${packet.from} → ${packet.to}`, detail: `Data plane · ${rest} — this hop carries plain IP, no MPLS labels${logical}`, color };
    const [head, tail] = rest.split(" — ");
    const title = action ? `${ACTION_TITLE[action] ?? action} · ${head}` : head;
    return { title, detail: `Data plane · no MPLS labels (plain IP)${tail ? ` · ${tail}` : ""}${logical}`, color };
  }

  const top = stack[0];
  const topMeaning = meaning(top.label);
  const verb = action ? (ACTION_TITLE[action] ?? action) : "MPLS";
  // After a pop (Adj-SID executed, repair segment completed) the top label is the NEXT instruction, not the one just executed.
  const joiner = action && POPPED_ACTIONS.has(action) ? " → next active" : " · active";
  return {
    title: `${verb}${joiner} ${top.label}${topMeaning ? ` (${topMeaning})` : ""}`,
    detail: `Data plane · ${srStackText(stack, meaning)} · IP${logical}`,
    color,
  };
}

/** "16003 ✓ → 24035 ● → 16006" — ✓ completed, ● active; the logical segment list, not the wire stack. */
export function logicalListText(items: { sid: number; active?: boolean; completed?: boolean }[]): string {
  return items.map((i) => `${i.sid}${i.completed ? " ✓" : i.active ? " ●" : ""}`).join(" → ");
}
