import type { SpChallenge } from "@/components/sp-lab/spKit";
import type { UState, UTest } from "@/lib/sim-engine/scenarios/ucNet";

/** SRv6 uSID Lab challenges — checked from the encoding R1 pushes and fresh pings, never from the commands typed. */
const fresh = (s: UState) => s.tests.filter((t) => t.cfgSeq === s.cfgSeq);
const ok = (s: UState, pred: (t: UTest) => boolean) => fresh(s).find((t) => t.walk.ok && pred(t));
const path = (t: UTest) => t.walk.path.join("-");
const HEALTHY_PATH = "CE1-R1-R2-R3-R4-R5-R6-R8-CE8";
const hint = (s: UState) => {
  const t = fresh(s).at(-1);
  return !t ? "send a ping." : t.walk.ok ? `${t.size} B: ${path(t)}, ${t.walk.ms} ms, ${t.entries} entr${t.entries > 1 ? "ies" : "y"}, ${t.overhead} B of overhead.` : `${t.size} B: ${t.walk.why}`;
};

export const UC_CHALLENGES: SpChallenge<UState>[] = [
  {
    id: "minimal",
    title: "Same path, one carrier",
    how: "Change PATH-A so GREEN still follows R1 → R2 → R3 → R4 → R5 → R6 → R8 (express), but R1 pushes a single 128-bit entry — no SRH at all. Prove it with a ping.",
    done: (s) => !!ok(s, (t) => path(t) === HEALTHY_PATH && t.entries === 1 && t.steered),
    next: (s) => (s.view.green.entries.length > 1 ? `R1 still pushes ${s.view.green.entries.length} entries — which uSIDs does the IGP make unnecessary?` : hint(s)),
  },
  {
    id: "avoidr4",
    title: "Avoid R4",
    how: "Make GREEN avoid R4 entirely by forcing the R3–R5 alternate link, and prove delivery with a ping.",
    done: (s) => !!ok(s, (t) => !t.walk.path.includes("R4") && t.walk.path.join("-").includes("R3-R5") && t.steered),
    next: (s) => (!s.view.policy.up ? `GREEN is down: ${s.view.policy.why}.` : hint(s)),
  },
  {
    id: "onecarrier",
    title: "Both shortcuts, one carrier",
    how: "Make GREEN use both the R3–R5 alternate link and the R6–R8 express link while R1 pushes exactly one carrier. Prove it with a 1430-byte ping.",
    done: (s) => !!ok(s, (t) => t.size === 1430 && t.entries === 1 && path(t).includes("R3-R5") && path(t).includes("R6-R8")),
    next: (s) => (s.view.green.entries.length > 1 ? `R1 pushes ${s.view.green.entries.length} entries; count the uSIDs — a carrier holds 6.` : hint(s)),
  },
  {
    id: "mtuproof",
    title: "Prove compression matters",
    how: "Remove R1's uSID SID format and show that a 1430-byte ping fails with the classic encoding; then restore it and show the same ping succeeding.",
    done: (s) => s.tests.some((t) => t.size === 1430 && !t.walk.ok && t.entries >= 6) && !!ok(s, (t) => t.size === 1430 && t.entries <= 2) && !!s.cfg.R1.fmt,
    next: (s) => (!s.tests.some((t) => t.size === 1430 && !t.walk.ok && t.entries >= 6) ? "no failed 1430-byte ping with the classic encoding yet." : !s.cfg.R1.fmt ? "restore sid-format usid-f3216." : hint(s)),
  },
  {
    id: "rebuild",
    title: "Rebuild PATH-A",
    how: "Press “Empty PATH-A” below, then rebuild the list so GREEN uses the express link R6–R8 again and a 1430-byte ping is delivered.",
    done: (s) => !!s.wiped && !!ok(s, (t) => t.size === 1430 && path(t).includes("R6-R8") && t.steered),
    next: (s) => (!s.wiped ? "press “Empty PATH-A” first." : !s.view.policy.up ? `GREEN is down: ${s.view.policy.why}.` : hint(s)),
  },
];
