import type { SpChallenge } from "@/components/sp-lab/spKit";
import { FR_LO, commitCount, frLspOf, type FrState } from "@/lib/sim-engine/scenarios/frrNet";

/** Fast Reroute Lab challenges — checked from the bypasses, the bindings and failure drills run after the last commit. */
const freshDrills = (s: FrState) => s.drills.filter((d) => d.commits === commitCount(s));
const drillRes = (s: FrState, what: string, lsp = "R1:1") => {
  const d = freshDrills(s).filter((x) => x.what === what);
  return d[d.length - 1]?.results.find((r) => r.lsp === lsp);
};

export const FR_CHALLENGES: SpChallenge<FrState>[] = [
  {
    id: "manual",
    title: "A bypass you built yourself",
    how: "On R3, turn off the automatic bypasses toward R5 and configure your own bypass to 7.7.7.7 that avoids R5 (an explicit path over R4, or exclude 5.5.5.5), bound to the interface toward R5. Prove it: a drill of R5 failing is repaired locally by your bypass.",
    done: (s) => {
      const r = drillRes(s, "node:R5");
      return !s.cfg.R3.ifs["ge-0/0/1"].auto && s.cfg.R3.tunnels.some((t) => t.bypassFor === "ge-0/0/1" && t.dst === FR_LO.R7) && r?.how === "local" && !!r.bypass?.includes(":m");
    },
    next: (s) => {
      if (s.cfg.R3.ifs["ge-0/0/1"].auto) return "R3 still builds automatic bypasses toward R5.";
      if (!s.cfg.R3.tunnels.some((t) => t.bypassFor === "ge-0/0/1" && t.dst === FR_LO.R7)) return "R3 has no manual bypass to 7.7.7.7 bound to its interface toward R5.";
      return "now run the drill: R5 fails.";
    },
  },
  {
    id: "linkonly",
    title: "Link protection is not node protection",
    how: "Make tunnel-te1 request link protection only. Prove both halves with fresh drills: R3–R5 failing is still repaired locally, but R5 failing is not.",
    done: (s) => s.cfg.R1.tunnels.find((t) => t.id === 1)?.frr === "link" && drillRes(s, "link:R3-R5")?.how === "local" && !!drillRes(s, "node:R5") && drillRes(s, "node:R5")!.how !== "local",
    next: (s) => (s.cfg.R1.tunnels.find((t) => t.id === 1)?.frr !== "link" ? "tunnel-te1 doesn't request link protection only yet." : !drillRes(s, "link:R3-R5") ? "run the drill: R3–R5 fails." : "now run the drill: R5 fails."),
  },
  {
    id: "wayback",
    title: "Protect the way back",
    how: "Build an LSP from R6 to 1.1.1.1 (300 Mbps) that requests node protection. Prove it: in a drill of R5 failing, your LSP is repaired locally — by which PLR?",
    done: (s) => {
      const t = s.cfg.R6.tunnels.find((x) => x.dst === FR_LO.R1 && x.frr === "node" && !x.bypassFor);
      return !!t && frLspOf(s.view, "R6", t.id) !== undefined && drillRes(s, "node:R5", `R6:${t.id}`)?.how === "local";
    },
    next: (s) => {
      const t = s.cfg.R6.tunnels.find((x) => x.dst === FR_LO.R1 && !x.bypassFor);
      if (!t) return "R6 has no LSP to 1.1.1.1 yet.";
      if (t.frr !== "node") return "the LSP doesn't request node protection.";
      return "now run the drill: R5 fails.";
    },
  },
  {
    id: "all",
    title: "Every protectable failure in milliseconds",
    how: "With the configuration as it is now, run three drills — R3–R5 fails, R5 fails, R5–R7 fails — and have every one of them repaired locally for tunnel-te1.",
    done: (s) => ["link:R3-R5", "node:R5", "link:R5-R7"].every((w) => drillRes(s, w)?.how === "local"),
    next: (s) => {
      const missing = ["link:R3-R5", "node:R5", "link:R5-R7"].filter((w) => drillRes(s, w)?.how !== "local");
      return `still to prove (since your last commit): ${missing.map((w) => w.replace("link:", "").replace("node:", "").replace("-", "–")).join(", ")}.`;
    },
  },
  {
    id: "rebuild",
    title: "Rebuild the protection from nothing",
    how: "Press “Wipe R3's protection” (below): R3 loses its bypasses and tunnel-te1 stops asking for protection. Configure both again and prove it with a drill of R5 failing.",
    done: (s) => !!s.wiped && s.cfg.R1.tunnels.find((t) => t.id === 1)?.frr === "node" && drillRes(s, "node:R5")?.how === "local",
    next: (s) => (!s.wiped ? "wipe R3's protection first." : s.cfg.R1.tunnels.find((t) => t.id === 1)?.frr !== "node" ? "tunnel-te1 doesn't request node protection." : !s.cfg.R3.ifs["ge-0/0/1"].auto && !s.cfg.R3.tunnels.some((t) => t.bypassFor === "ge-0/0/1") ? "R3 has no bypass toward R5." : "now run the drill: R5 fails."),
  },
];
