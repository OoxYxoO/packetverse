import type { SpChallenge } from "@/components/sp-lab/spKit";
import { TL_ROUTERS, tlIfs, tlPfx, tlProt, type TlDrill, type TlState } from "@/lib/sim-engine/scenarios/tlNet";

/** SR TI-LFA Lab challenges — checked from the backups the routers computed and fresh failure drills. */
const freshDrill = (s: TlState, what: string): TlDrill | undefined => s.drills.filter((d) => d.cfgSeq === s.cfgSeq && d.what === what).at(-1);
const allLocal = (d?: TlDrill, ms = 1000) => !!d && d.results.some((r) => r.affected) && d.results.every((r) => !r.affected || (r.how === "local" && r.lossMs < ms));
const lastPing = (s: TlState) => s.tests.filter((t) => t.cfgSeq === s.cfgSeq).at(-1);
const L24 = "link R2–R4 fails";
const drillHint = (s: TlState, what: string, label: string) => {
  const d = freshDrill(s, what);
  if (!d) return `now run the drill: ${label}.`;
  const bad = d.results.find((r) => r.affected && !(r.how === "local" && r.lossMs < 1000));
  return bad ? `${bad.flow}: ${bad.why}.` : "done.";
};
const protectedIfs = (s: TlState) => TL_ROUTERS.flatMap((r) => tlIfs(r).filter((i) => tlProt(s.cfg, s.os, r, i.ifn).on).map((i) => `${r} ${i.ifn}`));

export const TL_CHALLENGES: SpChallenge<TlState>[] = [
  {
    id: "lfa",
    title: "Classic LFA where it works",
    how: "Run R2's interface toward R4 on classic LFA only — no TI-LFA (IOS XR: fast-reroute per-prefix without ti-lfa; Junos: link-protection instead of post-convergence-lfa). Its backup for 10.0.0.6 must be an LFA, and a fresh R2–R4 drill must still repair both directions in under 1 s.",
    done: (s) => tlPfx(s.view, "R2", "R6")?.backup?.kind === "lfa" && allLocal(freshDrill(s, L24)),
    next: (s) => {
      const b = tlPfx(s.view, "R2", "R6")?.backup;
      if (b?.kind !== "lfa") return b ? "R2's backup for 10.0.0.6 is still TI-LFA." : "R2 has no backup for 10.0.0.6 — classic LFA needs fast reroute on.";
      return drillHint(s, L24, "R2–R4 fails");
    },
  },
  {
    id: "pq3",
    title: "A new PQ node",
    how: "Raise the R2–R3 metric to 25 (on both ends). R2's backup for 10.0.0.6 must now repair with R3 as the only segment ([16003]); prove it with a fresh R2–R4 drill.",
    done: (s) => s.cfg.R2.ifs["ge-0/0/2"]!.metric === 25 && s.cfg.R3.ifs["ge-0/0/0"]!.metric === 25 && tlPfx(s.view, "R2", "R6")?.backup?.repair.join() === "16003" && allLocal(freshDrill(s, L24)),
    next: (s) => {
      if (s.cfg.R2.ifs["ge-0/0/2"]!.metric !== 25 || s.cfg.R3.ifs["ge-0/0/0"]!.metric !== 25) return "set metric 25 on R2's link to R3 and on R3's link to R2.";
      const b = tlPfx(s.view, "R2", "R6")?.backup;
      if (b?.repair.join() !== "16003") return `R2's repair is ${b ? `[${b.repair.join(", ")}]` : "missing"}.`;
      return drillHint(s, L24, "R2–R4 fails");
    },
  },
  {
    id: "move",
    title: "Move the PLR",
    how: "Make H1 ↔ H6 use the bottom path (R2 → R3 → R5 → R6) by changing IS-IS metrics only, prove it with a ping, then show that a failure of R3–R5 is repaired locally in both directions.",
    done: (s) => {
      const t = lastPing(s);
      return !!t?.ok && t.path.includes("R3") && t.path.includes("R5") && allLocal(freshDrill(s, "link R3–R5 fails"));
    },
    next: (s) => {
      const p = s.view.rib.R1.find((x) => x.dst === "R6")?.path ?? [];
      if (!p.includes("R3")) return `R1's shortest path to R6 is still ${p.join(" → ")}.`;
      const t = lastPing(s);
      if (!t?.ok) return "now ping 192.168.6.20 from H1.";
      return drillHint(s, "link R3–R5 fails", "R3–R5 fails");
    },
  },
  {
    id: "minimal",
    title: "Only where it matters",
    how: "Keep fast reroute on exactly the two interfaces that protect H1 ↔ H6 against an R2–R4 failure — remove it everywhere else — and prove both directions are still repaired locally.",
    done: (s) => {
      const p = protectedIfs(s);
      return p.length === 2 && p.includes("R2 ge-0/0/1") && p.includes("R4 ge-0/0/0") && allLocal(freshDrill(s, L24));
    },
    next: (s) => {
      const p = protectedIfs(s);
      if (p.length > 2) return `${p.length} interfaces still run fast reroute.`;
      if (!(p.includes("R2 ge-0/0/1") && p.includes("R4 ge-0/0/0"))) return "the two you kept are not the PLRs' interfaces toward the failure.";
      return drillHint(s, L24, "R2–R4 fails");
    },
  },
  {
    id: "rebuild",
    title: "Rebuild R4",
    how: "Press “Wipe R4's protection” below, then rebuild it from R4's console: TI-LFA with node protection on every interface and BFD toward R2. Prove it with a fresh R2–R4 drill.",
    done: (s) => !!s.wiped && tlIfs("R4").every((i) => tlProt(s.cfg, s.os, "R4", i.ifn).node) && s.cfg.R4.ifs["ge-0/0/0"]!.bfd && allLocal(freshDrill(s, L24)),
    next: (s) => {
      if (!s.wiped) return "press “Wipe R4's protection” first.";
      const miss = tlIfs("R4").filter((i) => !tlProt(s.cfg, s.os, "R4", i.ifn).node);
      if (miss.length) return `${miss.map((i) => i.ifn).join(", ")} still lack TI-LFA with node protection.`;
      if (!s.cfg.R4.ifs["ge-0/0/0"]!.bfd) return "BFD toward R2 is still missing.";
      return drillHint(s, L24, "R2–R4 fails");
    },
  },
];
