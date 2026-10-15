/**
 * Spanning-tree protection features the CCNA lists beyond BPDU Guard and Root Guard (2.5): Loop Guard and BPDU filter.
 * A small, pure model used by the STP lesson's Deep Dive.
 *
 * Loop Guard scenario: SW3's Alternate port (blocking) normally hears SW2's superior BPDUs every 2 s (hello). A
 * unidirectional fiber fault stops those BPDUs arriving while SW3 can still transmit. RSTP ages the stored information
 * after 3 missed hellos (6 s); the port then believes it is Designated and moves to forwarding — a loop. With Loop
 * Guard, the same timeout puts the port into loop-inconsistent (blocking) instead, and it recovers by itself when
 * BPDUs return.
 */
export type GuardMode = "none" | "loop-guard";
export interface PortSecond {
  t: number;
  bpdu: boolean;
  role: string;
  state: "discarding" | "forwarding" | "loop-inconsistent";
}
export const HELLO = 2;
export const MAX_MISSED = 3;

/** Second-by-second state of SW3's Alternate port; BPDUs stop at `faultAt` and return at `healAt` (if given). */
export function alternatePortTimeline(mode: GuardMode, seconds = 12, faultAt = 1, healAt?: number): PortSecond[] {
  let lastBpdu = 0;
  const out: PortSecond[] = [];
  for (let t = 0; t <= seconds; t++) {
    const sending = t < faultAt || (healAt !== undefined && t >= healAt);
    const bpdu = sending && t % HELLO === 0;
    if (bpdu) lastBpdu = t;
    const aged = t - lastBpdu >= HELLO * MAX_MISSED;
    if (!aged) out.push({ t, bpdu, role: "Alternate", state: "discarding" });
    else if (mode === "loop-guard") out.push({ t, bpdu, role: "Alternate (Loop Guard)", state: "loop-inconsistent" });
    else out.push({ t, bpdu, role: "Designated", state: "forwarding" });
  }
  return out;
}

export type Guard = "PortFast" | "BPDU Guard" | "BPDU filter" | "Root Guard" | "Loop Guard";
export type Event = "BPDU arrives on an edge port" | "Superior BPDU arrives" | "BPDUs stop arriving on a blocking port";
/** What each feature does when each event happens on the port where it is configured. */
export function reaction(g: Guard, e: Event): string {
  switch (g) {
    case "PortFast":
      return e === "BPDU arrives on an edge port" ? "loses edge status, runs normal STP" : "—";
    case "BPDU Guard":
      return e === "BPDU arrives on an edge port" ? "err-disables the port" : "—";
    case "BPDU filter":
      return e === "BPDU arrives on an edge port" ? "(interface-level) ignores it — no STP, a loop is possible" : "—";
    case "Root Guard":
      return e === "Superior BPDU arrives" ? "root-inconsistent (blocking) until the superior BPDUs stop" : "—";
    case "Loop Guard":
      return e === "BPDUs stop arriving on a blocking port" ? "loop-inconsistent (blocking) instead of forwarding" : "—";
  }
}
export const GUARD_WHERE: Record<Guard, string> = {
  PortFast: "Access ports to hosts",
  "BPDU Guard": "Access ports to hosts (with PortFast)",
  "BPDU filter": "Rarely — ports where STP must be silent (e.g. a provider handoff)",
  "Root Guard": "Distribution ports facing access switches that must never become root",
  "Loop Guard": "Root and Alternate ports on switch-to-switch links (especially fiber)",
};
