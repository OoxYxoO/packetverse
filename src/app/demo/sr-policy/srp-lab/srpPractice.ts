import type { SpChallenge } from "@/components/sp-lab/spKit";
import { SP_HOSTS, goldPol, spEntry, type SpState } from "@/lib/sim-engine/scenarios/srpNet";

/** SR Policy Lab challenges — checked from the policy, its candidates, the forwarding table and fresh tests. */
const fresh = (s: SpState) => s.tests.filter((t) => t.cfgSeq === s.cfgSeq);
const goldPing = (s: SpState) => fresh(s).filter((t) => t.kind === "ping" && t.dst === SP_HOSTS.H6.ip).at(-1);

export const SRP_CHALLENGES: SpChallenge<SpState>[] = [
  {
    id: "fallback",
    title: "Survive a GOLD link failure",
    how: "Take R3–R5 down (the link buttons below). Prove with a fresh ping to H6 that GOLD traffic still arrives on a GOLD path, carried by the dynamic candidate.",
    done: (s) => !s.view.adj["R3-R5"] && goldPol(s)?.active?.cand.kind === "dynamic" && !!goldPing(s)?.ok && goldPing(s)!.steered === "GOLD",
    next: (s) => (s.view.adj["R3-R5"] ? "take R3–R5 down first." : goldPol(s)?.active?.cand.kind !== "dynamic" ? "the dynamic candidate isn't active." : "now ping 192.168.6.20."),
  },
  {
    id: "explicit2",
    title: "Re-engineer the explicit path",
    how: "Change GOLD-EXPLICIT so that it goes R1 → R3 → R4 → R6 (R3's link to R4, address 10.1.34.4). Keep it the active candidate and prove the path with a fresh ping to H6.",
    done: (s) => goldPol(s)?.active?.cand.kind === "explicit" && !!goldPing(s)?.ok && goldPing(s)!.path.join("-").includes("R1-R3-R4-R6"),
    next: (s) => {
      const t = goldPing(s);
      if (goldPol(s)?.active?.cand.kind !== "explicit") return "the explicit candidate isn't active.";
      if (!t) return "ping 192.168.6.20.";
      return t.path.join("-").includes("R1-R3-R4-R6") ? "done." : `the GOLD path is still ${t.path.join(" → ")}.`;
    },
  },
  {
    id: "blue",
    title: "A BLUE dynamic path, preferred",
    how: "Make the dynamic candidate use only BLUE links and make it the active one. Prove with a fresh ping that GOLD traffic is still steered into policy GOLD — over R2 and R4.",
    done: (s) => {
      const t = goldPing(s);
      return goldPol(s)?.active?.cand.kind === "dynamic" && !!goldPol(s)?.active?.cand.include?.includes("BLUE") && !!t?.ok && t.steered === "GOLD" && t.path.includes("R2");
    },
    next: (s) => {
      const k = goldPol(s)?.cands.find((x) => x.cand.kind === "dynamic");
      if (!k?.cand.include?.includes("BLUE")) return "the dynamic candidate doesn't include BLUE.";
      if (goldPol(s)?.active !== k) return "the dynamic candidate isn't active: compare the preferences.";
      return "now ping 192.168.6.20.";
    },
  },
  {
    id: "bsid",
    title: "A new binding SID",
    how: "Give policy GOLD binding SID 30100. Then send a packet from R1 with only that label (the segment-list tool) and prove it reaches R6.",
    done: (s) => !!spEntry(s.view, "R1", 30100) && fresh(s).some((t) => t.kind === "probe" && t.ok && t.stack?.join() === "30100"),
    next: (s) => (!spEntry(s.view, "R1", 30100) ? "R1 has no label 30100 yet." : "send [30100] from R1."),
  },
  {
    id: "down",
    title: "Policy down, traffic up",
    how: "Take both R3–R5 and R3–R4 down. Policy GOLD must be down — and a fresh ping to H6 must still succeed, unsteered, over R2 and R4.",
    done: (s) => !goldPol(s)?.up && !!goldPing(s)?.ok && !goldPing(s)!.steered,
    next: (s) => (goldPol(s)?.up ? "policy GOLD is still up: take both GOLD links down." : "now ping 192.168.6.20."),
  },
];
