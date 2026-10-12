import type { SpChallenge } from "@/components/sp-lab/spKit";
import { FA_HOSTS, faEntry, type FaState } from "@/lib/sim-engine/scenarios/faNet";

/** SR Flex-Algo Lab challenges — checked from the definitions, the algorithm topologies, labels and fresh tests. */
const fresh = (s: FaState) => s.tests.filter((t) => t.cfgSeq === s.cfgSeq);
const lastLL = (s: FaState) => fresh(s).filter((t) => t.kind === "ping" && t.dst === FA_HOSTS.H66.ip).at(-1);
const llHint = (s: FaState, path: string) => {
  const t = lastLL(s);
  if (!t) return "now ping 192.168.66.20 from H1.";
  if (!t.ok) return `the ping failed: ${t.why}`;
  return t.path.join("-").includes(path) ? "done." : `H66 went ${t.path.join(" → ")} (${t.ms} ms).`;
};

export const FA_CHALLENGES: SpChallenge<FaState>[] = [
  {
    id: "detour",
    title: "Same algorithm, another path",
    how: "Make the low-latency app take R1 → R3 → R4 → R6 without touching policy LOW-LATENCY: lift the BLUE exclusion from the Flex-Algo 128 definition and make R3–R5 advertise 80 ms (80000 µs) on both ends. Prove it with a fresh ping to H66 — still [16106].",
    done: (s) => {
      const t = lastLL(s);
      return !!t?.ok && t.stack.join() === "16106" && t.path.join("-").includes("R3-R4-R6");
    },
    next: (s) => (s.view.fad[128]?.def.excl.length ? "the winning definition still excludes BLUE." : s.cfg.R3.ifs["ge-0/0/1"]!.delay !== 80000 || s.cfg.R5.ifs["ge-0/0/0"]!.delay !== 80000 ? "R3–R5 must advertise 80000 µs from both R3 and R5." : llHint(s, "R3-R4-R6")),
  },
  {
    id: "priority",
    title: "Move the definition to R6",
    how: "Make R6 the source of the Flex-Algo 128 definition (same rules: delay, exclude BLUE) by giving it a higher priority than R1's, without changing any path. Prove the app still gets 15 ms.",
    done: (s) => {
      const t = lastLL(s);
      const f = s.view.fad[128];
      return f?.src === "R6" && f.def.mt === "delay" && f.def.excl.join() === "BLUE" && !!t?.ok && t.ms === 15;
    },
    next: (s) => {
      const f = s.view.fad[128];
      if (f?.src !== "R6") return `the definition still comes from ${f?.src ?? "nobody"}.`;
      if (f.def.mt !== "delay" || f.def.excl.join() !== "BLUE") return "R6's definition must keep delay and exclude-any BLUE.";
      return llHint(s, "R3-R5-R6");
    },
  },
  {
    id: "prune",
    title: "Only where it matters",
    how: "Remove Flex-Algo 128 from the routers that don't need it — R2 and R4 — and prove the low-latency app still gets 15 ms over [16106].",
    done: (s) => {
      const t = lastLL(s);
      return !s.cfg.R2.fa[128] && !s.cfg.R4.fa[128] && !!t?.ok && t.ms === 15 && t.stack.join() === "16106";
    },
    next: (s) => (s.cfg.R2.fa[128] || s.cfg.R4.fa[128] ? "R2 and R4 still participate." : llHint(s, "R3-R5-R6")),
  },
  {
    id: "algo129",
    title: "A topology through R4",
    how: "Create Flex-Algo 129 (IGP metric, no constraints) on R1, R3, R4 and R6 only, advertised by R1; give R6's loopback algorithm-129 index 206. Then send [16206] from R1 (label probe below): it must take R1 → R3 → R4 → R6.",
    done: (s) => fresh(s).some((t) => t.kind === "probe" && t.ok && t.stack.join() === "16206" && t.path.join("-") === "R1-R3-R4-R6"),
    next: (s) => {
      if (!s.view.fad[129]) return "no definition for 129 is advertised yet.";
      if (s.cfg.R6.algoSid[129] !== 206) return "R6 needs prefix-sid algorithm 129 index 206.";
      if (!faEntry(s.view, "R1", 16206)) return `R1 has no label 16206 yet (${s.view.missing.R1.find((m) => m.algo === 129 && m.dst === "R6")?.why ?? "?"}).`;
      const t = fresh(s).filter((x) => x.kind === "probe").at(-1);
      return !t ? "send [16206] from R1." : t.ok ? `the probe took ${t.path.join(" → ")}.` : `the probe failed: ${t.why}`;
    },
  },
  {
    id: "rebuild",
    title: "Rebuild R6",
    how: "Press “Wipe R6's Flex-Algo” below, then rebuild it from R6's console: participate in 128 again and advertise its algorithm-128 prefix SID (index 106). Prove it with a ping to H66 over [16106].",
    done: (s) => {
      const t = lastLL(s);
      return !!s.wiped && !!s.cfg.R6.fa[128] && s.cfg.R6.algoSid[128] === 106 && !!t?.ok && t.stack.join() === "16106";
    },
    next: (s) => (!s.wiped ? "press “Wipe R6's Flex-Algo” first." : !s.cfg.R6.fa[128] ? "R6 doesn't participate in 128 yet." : s.cfg.R6.algoSid[128] !== 106 ? "R6 has no algorithm-128 prefix SID 106 yet." : llHint(s, "R6")),
  },
];
