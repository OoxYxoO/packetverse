import type { SpChallenge } from "@/components/sp-lab/spKit";
import type { T6Drill, T6State } from "@/lib/sim-engine/scenarios/s6tNet";

/** SRv6 TI-LFA Lab challenges — checked from drills run on the current configuration, never from the commands typed. */
const fresh = (s: T6State) => s.drills.filter((d) => d.cfgSeq === s.cfgSeq);
const fwd = (d: T6Drill) => d.results.find((r) => r.flow === "CE1 → CE2")!;
const drillOf = (s: T6State, pred: (d: T6Drill) => boolean) => [...fresh(s)].reverse().find(pred);
const isCut = (d: T6Drill) => d.fail.link === "P1-P2" && !d.naive;
const localFast = (d?: T6Drill) => !!d && fwd(d).how === "local" && fwd(d).lossMs < 1000;
const hint = (s: T6State) => {
  const d = fresh(s).at(-1);
  if (!d) return "run a drill.";
  const r = fwd(d);
  return `${d.what}: CE1 → CE2 ${r.affected ? `${r.how}, ${r.lossMs === Infinity ? "lost" : `${r.lossMs} ms`} — ${r.why}` : "not affected"}.`;
};

export const T6_CHALLENGES: SpChallenge<T6State>[] = [
  {
    id: "naive",
    title: "Prove why the repair is shaped this way",
    how: "On the current configuration, run the hand-built repair to P2's End and a real drill of the same P1–P2 cut. The first must loop, the second must be repaired locally.",
    done: (s) => !!drillOf(s, (d) => d.naive === "p2end" && fwd(d).how === "loop") && localFast(drillOf(s, isCut)),
    next: (s) => (!drillOf(s, (d) => d.naive === "p2end") ? "run the hand-built repair to P2's End." : !drillOf(s, isCut) ? "run a real drill of the P1–P2 cut." : hint(s)),
  },
  {
    id: "nosid",
    title: "A repair without any SID",
    how: "Change metrics so that P1 still protects PE2 against the P1–P2 cut with TI-LFA, but the repair needs no SID at all — the outgoing interface alone is safe. Prove it with a drill.",
    done: (s) => {
      const d = drillOf(s, isCut);
      return localFast(d) && fwd(d!).backup?.kind === "ti-lfa" && fwd(d!).backup!.repair.length === 0;
    },
    next: (s) => {
      const d = drillOf(s, isCut);
      return !d ? "run a drill of the P1–P2 cut." : fwd(d).backup?.repair.length ? `the repair still needs [${fwd(d).backup!.repair.join(", ")}] — make P3's own path to PE2 avoid P1.` : hint(s);
    },
  },
  {
    id: "p2pe2",
    title: "Another link, another PLR",
    how: "Drill a cut of P2–PE2. CE1 → CE2 must be repaired locally — find out which router does it, and with which SID.",
    done: (s) => localFast(drillOf(s, (d) => d.fail.link === "P2-PE2" && !d.naive)) && fwd(drillOf(s, (d) => d.fail.link === "P2-PE2")!).plr === "P2",
    next: (s) => (!drillOf(s, (d) => d.fail.link === "P2-PE2") ? "drill the P2–PE2 cut." : hint(s)),
  },
  {
    id: "lfa",
    title: "Protection without TI-LFA",
    how: "Remove TI-LFA from P1's interface toward P2 (keep fast-reroute per-prefix) and change metrics so a classic LFA still repairs the P1–P2 cut locally. Prove it with a drill.",
    done: (s) => {
      const d = drillOf(s, isCut);
      return localFast(d) && fwd(d!).backup?.kind === "lfa" && !s.cfg.P1.ifs["ge-0/0/1"]!.tilfa;
    },
    next: (s) => (s.cfg.P1.ifs["ge-0/0/1"]!.tilfa ? "P1's Gi0/0/0/1 still runs TI-LFA." : !s.cfg.P1.ifs["ge-0/0/1"]!.frr ? "P1's Gi0/0/0/1 has no fast-reroute per-prefix at all." : hint(s)),
  },
  {
    id: "rebuild",
    title: "Rebuild P1's protection",
    how: "Press “Remove P1's FRR” below: P1 loses all fast reroute and BFD. Rebuild it so that both a P1–P2 cut and a P2 failure are repaired locally in under a second.",
    done: (s) => localFast(drillOf(s, isCut)) && localFast(drillOf(s, (d) => d.fail.node === "P2" && !d.naive)),
    next: (s) => {
      const f = s.cfg.P1.ifs["ge-0/0/1"]!;
      if (!f.frr || !f.tilfa) return "P1's Gi0/0/0/1 has no TI-LFA.";
      if (!f.node) return "P1's protection toward P2 is not node-protecting.";
      if (!f.bfd) return "P1's Gi0/0/0/1 runs no BFD — the DWDM link is silent.";
      return !drillOf(s, isCut) ? "drill the P1–P2 cut." : !drillOf(s, (d) => d.fail.node === "P2") ? "drill a P2 failure." : hint(s);
    },
  },
];
