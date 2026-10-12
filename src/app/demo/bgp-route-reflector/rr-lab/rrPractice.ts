import type { SpChallenge } from "@/components/sp-lab/spKit";
import { ALL_PFX, RR_LO, RR_PES, bestPath, candidates, clusterOf, established, hostOf, type RrDev, type RrState } from "@/lib/sim-engine/scenarios/rrNet";

/** Route Reflector Lab challenges — checked from sessions, Adj-RIBs-In, best paths and fresh customer traffic. */
const fresh = (s: RrState) => s.tests.filter((t) => t.cfgSeq === s.cfgSeq);
const clientOf = (s: RrState, rr: RrDev, pe: RrDev) => !!s.cfg[rr].nbrs.find((x) => x.ip === RR_LO[pe])?.client && established(s.view.sessions, rr, pe) && established(s.view.sessions, pe, rr);
const full = (s: RrState, pe: RrDev) => ALL_PFX.every((p) => !!bestPath(s.cfg, s.view, pe, p).best);

export const RR_CHALLENGES: SpChallenge<RrState>[] = [
  {
    id: "dual",
    title: "Give PE1 a second reflector",
    how: "Make PE1 a route-reflector client of RR2 as well as RR1: configure the session on both ends (and the client role on RR2) until PE1 receives routes from both reflectors.",
    done: (s) => clientOf(s, "RR2", "PE1") && candidates(s.cfg, s.view, "PE1", "10.3.3.0/24").length >= 2,
    next: (s) => (!s.cfg.PE1.nbrs.some((x) => x.ip === RR_LO.RR2) ? "PE1 has no neighbor 10.10.10.10 yet." : !s.cfg.RR2.nbrs.some((x) => x.ip === RR_LO.PE1) ? "RR2 has no neighbor 1.1.1.1 yet." : !established(s.view.sessions, "RR2", "PE1") ? "the PE1–RR2 session isn't Established." : "the session is up — is PE1 a client on RR2?"),
  },
  {
    id: "lose-rr1",
    title: "Lose RR1, keep every route",
    how: "Make PE1 and PE2 clients of both reflectors, then take RR1 out (remove its BGP process). PE1 and PE2 must still have every customer prefix, and a fresh ping from CE1 to CE4's network must succeed.",
    done: (s) => !s.cfg.RR1.on && full(s, "PE1") && full(s, "PE2") && fresh(s).some((t) => t.from === "CE1" && t.dst === hostOf("10.4.4.0/24") && t.ok),
    next: (s) => (s.cfg.RR1.on ? "RR1 is still running BGP." : !full(s, "PE1") || !full(s, "PE2") ? "PE1 or PE2 lost prefixes — they need RR2 as a second reflector." : "now ping CE4's network from CE1."),
  },
  {
    id: "one-cluster",
    title: "Two reflectors, one cluster",
    how: "Redesign: give RR1 and RR2 the same cluster ID and make every PE a client of both reflectors. Every PE must still have every prefix; prove it with a fresh ping from CE2 to CE3's network.",
    done: (s) => clusterOf(s.cfg, "RR1") === clusterOf(s.cfg, "RR2") && RR_PES.every((pe) => clientOf(s, "RR1", pe) && clientOf(s, "RR2", pe)) && RR_PES.every((pe) => full(s, pe)) && fresh(s).some((t) => t.from === "CE2" && t.dst === hostOf("10.3.3.0/24") && t.ok),
    next: (s) => (clusterOf(s.cfg, "RR1") !== clusterOf(s.cfg, "RR2") ? "the cluster IDs still differ." : !RR_PES.every((pe) => clientOf(s, "RR1", pe) && clientOf(s, "RR2", pe)) ? "not every PE is a client of both reflectors yet — with one cluster, the reflectors drop each other's reflections." : "the design is in place; now ping CE3's network from CE2."),
  },
  {
    id: "policy",
    title: "Keep one prefix inside cluster 1",
    how: "With an outbound policy on RR1 toward RR2, stop RR1 from sending 10.9.9.0/24 to RR2 while every other cluster-1 prefix still crosses.",
    done: (s) => !candidates(s.cfg, s.view, "RR2", "10.9.9.0/24").some((p) => p.from === "RR1") && ["10.1.1.0/24", "10.2.2.0/24"].every((p) => candidates(s.cfg, s.view, "RR2", p).some((x) => x.from === "RR1")),
    next: (s) => (candidates(s.cfg, s.view, "RR2", "10.9.9.0/24").some((p) => p.from === "RR1") ? "RR2 still receives 10.9.9.0/24 from RR1." : "RR1 now blocks too much: 10.1.1.0/24 and 10.2.2.0/24 must still reach RR2."),
  },
  {
    id: "rebuild",
    title: "Rebuild RR2 from nothing",
    how: "Press “Wipe RR2's BGP” (below), then configure RR2 again: its cluster ID, PE3 and PE4 as clients, RR1 as a non-client. Prove it: a fresh ping from CE3 to CE1's network.",
    done: (s) => !!s.wiped && clientOf(s, "RR2", "PE3") && clientOf(s, "RR2", "PE4") && established(s.view.sessions, "RR2", "RR1") && full(s, "PE3") && fresh(s).some((t) => t.from === "CE3" && t.dst === hostOf("10.1.1.0/24") && t.ok),
    next: (s) => (!s.wiped ? "wipe RR2's BGP first." : !clientOf(s, "RR2", "PE3") || !clientOf(s, "RR2", "PE4") ? "PE3 and PE4 must be Established clients of RR2." : !established(s.view.sessions, "RR2", "RR1") ? "RR2 has no session with RR1." : "now ping CE1's network from CE3."),
  },
];
