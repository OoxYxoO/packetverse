import type { SpChallenge } from "@/components/sp-lab/spKit";
import { adjSidLabel, entry, sidOf, srgbOf, type SrState } from "@/lib/sim-engine/scenarios/srNet";

/** SR-MPLS Lab challenges — checked from the label tables, the IGP and fresh tests. */
const fresh = (s: SrState) => s.tests.filter((t) => t.cfgSeq === s.cfgSeq);
const lastPing = (s: SrState) => fresh(s).filter((t) => t.kind === "ping" && t.from === "H1").at(-1);
const viaBottom = (p: string[]) => p.includes("R3") && p.includes("R5") && !p.includes("R2");

export const SR_CHALLENGES: SpChallenge<SrState>[] = [
  {
    id: "steer",
    title: "Steer through R3 and R5",
    how: "Without changing any configuration, send a packet from R1 to R6 that takes R1 → R3 → R5 → R6 and uses R3's Adjacency SID toward R5. Use the segment-list tool below (or, on IOS XR, ping sr-mpls nil-fec from R1).",
    done: (s) => fresh(s).some((t) => t.ok && (t.kind === "probe" || t.kind === "nilfec") && viaBottom(t.path) && !!t.stack?.includes(adjSidLabel(s.os, "R3", "R5"))),
    next: (s) => {
      const t = fresh(s).filter((x) => x.kind === "probe" || x.kind === "nilfec").at(-1);
      if (!t) return "send a segment list from R1.";
      if (!t.ok) return `that list failed: ${t.why}`;
      if (!t.stack?.includes(adjSidLabel(s.os, "R3", "R5"))) return `use R3's Adjacency SID toward R5 (${adjSidLabel(s.os, "R3", "R5")}).`;
      return viaBottom(t.path) ? "done." : "the packet didn't take R3 and R5.";
    },
  },
  {
    id: "strict",
    title: "A path of links only",
    how: "Send a packet from R1 to R6 along the top path using Adjacency SIDs only — one per link, no Node SID at all.",
    done: (s) => fresh(s).some((t) => t.ok && t.kind === "probe" && t.path.join("-") === "R1-R2-R4-R6" && !!t.stack?.length && t.stack.every((l) => l >= 24000)),
    next: (s) => {
      const t = fresh(s).filter((x) => x.kind === "probe").at(-1);
      if (!t) return "send a segment list from R1.";
      if (!t.ok) return `that list failed: ${t.why}`;
      if (t.stack?.some((l) => l < 24000)) return "that list still contains a Node SID.";
      return "the list must follow R1 → R2 → R4 → R6.";
    },
  },
  {
    id: "index",
    title: "Renumber R6",
    how: "Give R6's loopback Prefix-SID index 60. Every router must recompute R6's label (16060) and a fresh ping from H1 to H6 must succeed.",
    done: (s) => sidOf(s.view, "R6")?.index === 60 && !!entry(s.view, "R1", 16060) && !!lastPing(s)?.ok,
    next: (s) => (sidOf(s.view, "R6")?.index !== 60 ? "R6's Prefix-SID index isn't 60 yet." : !entry(s.view, "R1", 16060) ? "R1 has no label 16060 yet." : "now ping 192.168.6.20 from H1."),
  },
  {
    id: "srgb",
    title: "A different SRGB on R4",
    how: "Move R4's SRGB to 17000–24999 (Junos: start-label 17000, index-range 8000). Prove with a fresh ping from H1 that everything still works — and find the label R2 now swaps 16006 to.",
    done: (s) => srgbOf(s.cfg.R4, s.os)?.start === 17000 && entry(s.view, "R2", 16006)?.out === 17006 && !!lastPing(s)?.ok,
    next: (s) => (srgbOf(s.cfg.R4, s.os)?.start !== 17000 ? "R4's SRGB doesn't start at 17000 yet." : !lastPing(s)?.ok ? "now ping 192.168.6.20 from H1." : "check R2's entry for 16006."),
  },
  {
    id: "bottom",
    title: "Move the traffic, not the label",
    how: "Make H1's traffic to H6 take the bottom path (R3, R5) by changing IS-IS metrics only — no segment list. Prove it with a fresh ping.",
    done: (s) => {
      const t = lastPing(s);
      return !!t?.ok && viaBottom(t.path);
    },
    next: (s) => {
      const p = s.view.rib.R1.find((x) => x.dst === "R6")?.path ?? [];
      return viaBottom(p) ? "now ping 192.168.6.20 from H1." : `R1's shortest path to R6 is still ${p.join(" → ")}.`;
    },
  },
];
