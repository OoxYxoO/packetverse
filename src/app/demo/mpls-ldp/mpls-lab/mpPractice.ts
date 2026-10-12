import type { SpChallenge } from "@/components/sp-lab/spKit";
import { lfib, sessionUp, igpAdj, linkOf, type MpState } from "@/lib/sim-engine/scenarios/mplsNet";

/** MPLS + LDP Lab challenges — each checked from the network: sessions, labels, LFIBs and traffic that ran afterwards. */
const fresh = (s: MpState) => s.tests.filter((t) => t.cfgSeq === s.cfgSeq);
const ceOk = (s: MpState) => fresh(s).some((t) => t.kind === "ce" && t.ok);

export const MP_CHALLENGES: SpChallenge<MpState>[] = [
  {
    id: "rung",
    title: "Bring up LDP on the P1–P3 rung",
    how: "The P1–P3 link is cabled and addressed but runs neither IS-IS nor LDP. Enable both on P1 ge-0/0/2 and P3 ge-0/0/2 until the LDP session P1–P3 is Operational.",
    done: (s) => sessionUp(s.view, "P1", "P3"),
    next: (s) => {
      const p1 = s.cfg.P1.ifs["ge-0/0/2"]!;
      const p3 = s.cfg.P3.ifs["ge-0/0/2"]!;
      if (!p1.isis || !p3.isis) return "IS-IS isn't running on both ends of the rung yet (LDP needs the IGP).";
      if (!igpAdj(s, linkOf("P1-P3"))) return "the IS-IS adjacency on the rung isn't up.";
      return "IS-IS is up on the rung; now enable LDP (and, on Junos, MPLS) on both ends.";
    },
  },
  {
    id: "lsp",
    title: "Prove the LSP, not just reachability",
    how: "Use an LSP ping from PE1 to PE2's FEC 4.4.4.4/32 (ping mpls ipv4 4.4.4.4/32 · ping mpls ldp 4.4.4.4, or the composer) and get a success.",
    done: (s) => fresh(s).some((t) => t.kind === "lsp" && t.from === "PE1" && t.dst === "4.4.4.4" && t.ok),
    next: () => "run an LSP ping (not an ordinary ping) from PE1 to 4.4.4.4/32.",
  },
  {
    id: "expnull",
    title: "Make PE2 receive labeled packets",
    how: "Configure PE2 to advertise explicit-null for its loopback, check that P2 now swaps to label 0 instead of popping, and prove customer traffic still works.",
    done: (s) => s.cfg.PE2.explicitNull && lfib(s.view, "P2").find((e) => e.fec === "4.4.4.4")?.outs.some((o) => o.out === 0) === true && ceOk(s),
    next: (s) => (!s.cfg.PE2.explicitNull ? "PE2 still advertises implicit-null." : "explicit-null is on; now ping CE2 from CE1."),
  },
  {
    id: "survive",
    title: "Lose a core link, keep the customers",
    how: "Fail P1–P2 and show that CE1 still reaches CE2 — on labels over the bottom path.",
    done: (s) => !s.phys["P1-P2"] && ceOk(s),
    next: (s) => (s.phys["P1-P2"] ? "P1–P2 is still up." : "the link is down; now test CE1 → CE2."),
  },
  {
    id: "sync",
    title: "Let IS-IS wait for LDP",
    how: "Turn on LDP–IGP synchronization on both ends of P1–P2. Then break only LDP on that link (leave IS-IS up) and show that customer traffic still gets through.",
    done: (s) => s.cfg.P1.ifs["ge-0/0/1"]!.sync && s.cfg.P2.ifs["ge-0/0/0"]!.sync && igpAdj(s, linkOf("P1-P2")) && !sessionUp(s.view, "P1", "P2") && ceOk(s),
    next: (s) => {
      if (!s.cfg.P1.ifs["ge-0/0/1"]!.sync || !s.cfg.P2.ifs["ge-0/0/0"]!.sync) return "synchronization isn't configured on both ends of P1–P2.";
      if (!igpAdj(s, linkOf("P1-P2"))) return "keep IS-IS up on P1–P2 — the point is a link the IGP could still use.";
      if (sessionUp(s.view, "P1", "P2")) return "LDP on P1–P2 is still up: break LDP only (e.g. remove it from one interface).";
      return "now ping CE2 from CE1.";
    },
  },
  {
    id: "build",
    title: "Rebuild PE1's MPLS from nothing",
    how: "Press “Wipe PE1's LDP” (below), then configure LDP again on both core interfaces (Junos: MPLS and family mpls too) and prove CE1 → CE2 works.",
    done: (s) => !!s.wiped && sessionUp(s.view, "PE1", "P1") && sessionUp(s.view, "PE1", "P3") && ceOk(s),
    next: (s) => (!s.wiped ? "wipe PE1's LDP first." : !sessionUp(s.view, "PE1", "P1") || !sessionUp(s.view, "PE1", "P3") ? "PE1 doesn't have both LDP sessions yet." : "sessions are up; now test CE1 → CE2."),
  },
];
