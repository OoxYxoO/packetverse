import type { SpChallenge } from "@/components/sp-lab/spKit";
import { llPol, type PState } from "@/lib/sim-engine/scenarios/s6pNet";

/** SRv6 Policy Lab challenges — checked from the policy state on R1 and fresh tests. */
const fresh = (s: PState) => s.tests.filter((t) => t.cfgSeq === s.cfgSeq && t.to === "RX66");
const last = (s: PState) => fresh(s).at(-1);
const hint = (s: PState) => {
  const t = last(s);
  return !t ? "send to RX66." : t.ok ? `RX66: ${t.ms} ms via ${t.path.join(" → ")} — ${t.via}.` : `RX66 lost: ${t.why}`;
};
const active = (s: PState) => llPol(s.view)?.active;

export const P6_CHALLENGES: SpChallenge<PState>[] = [
  {
    id: "explicit2",
    title: "Engineer the cross-link",
    how: "On the controller, change the explicit candidate so that RX66's traffic goes R1 → R3 → R4 → R6 (use R3's End.X toward R4). Keep it the active candidate and prove it with a test.",
    done: (s) => active(s)?.cand.kind === "explicit" && fresh(s).some((t) => t.ok && t.path.join("-").includes("R1-R3-R4-R6") && /explicit/.test(t.via)),
    next: (s) => (active(s)?.cand.kind !== "explicit" ? `the active candidate is ${active(s) ? `the ${active(s)!.cand.kind} one` : "none"}.` : hint(s)),
  },
  {
    id: "dynonly",
    title: "No explicit path needed",
    how: "Remove the explicit candidate on the controller. Prove that RX66 still gets 15 ms through the dynamic candidate alone.",
    done: (s) => !llPol(s.view)?.pol.cands.some((c) => c.kind === "explicit") && fresh(s).some((t) => t.ok && t.ms === 15 && /dynamic/.test(t.via)),
    next: (s) => (llPol(s.view)?.pol.cands.some((c) => c.kind === "explicit") ? "the explicit candidate is still there." : hint(s)),
  },
  {
    id: "delayroute",
    title: "Let delay decide",
    how: "Make the dynamic candidate the active one and raise the advertised delay of R3–R5 to 50 ms (50000 µs) on both ends. RX66 must now take R1 → R3 → R4 → R6 through the dynamic candidate.",
    done: (s) => active(s)?.cand.kind === "dynamic" && fresh(s).some((t) => t.ok && t.path.join("-").includes("R3-R4-R6") && /dynamic/.test(t.via)),
    next: (s) => (active(s)?.cand.kind !== "dynamic" ? "the dynamic candidate isn't active yet." : s.cfg.R3.ifs["ge-0/0/1"]!.delay < 50000 || s.cfg.R5.ifs["ge-0/0/0"]!.delay < 50000 ? "R3–R5 still advertises a low delay on one end." : hint(s)),
  },
  {
    id: "recover",
    title: "After the flap",
    how: "Press “Flap R3–R5” below. R3 comes back with a new End.X SID toward R5. Make the explicit candidate active again — without changing preferences — and prove 15 ms through it.",
    done: (s) => Object.keys(s.cfg.R3.xfn).length > 0 && active(s)?.cand.kind === "explicit" && active(s)!.cand.pref === 200 && fresh(s).some((t) => t.ok && t.ms === 15 && /explicit/.test(t.via)),
    next: (s) => (!Object.keys(s.cfg.R3.xfn).length ? "press “Flap R3–R5” first." : active(s)?.cand.kind !== "explicit" ? `the explicit candidate is ${llPol(s.view)?.cands.find((c) => c.cand.kind === "explicit")?.why ?? "not active"}.` : hint(s)),
  },
  {
    id: "prefswap",
    title: "Dynamic first",
    how: "Without removing anything, make the dynamic candidate the active one while both stay valid, and prove RX66 still gets 15 ms.",
    done: (s) => llPol(s.view)?.cands.every((c) => c.valid) === true && active(s)?.cand.kind === "dynamic" && fresh(s).some((t) => t.ok && t.ms === 15 && /dynamic/.test(t.via)),
    next: (s) => (!llPol(s.view)?.cands.every((c) => c.valid) ? "one candidate is invalid." : active(s)?.cand.kind !== "dynamic" ? "the explicit candidate still wins." : hint(s)),
  },
];
