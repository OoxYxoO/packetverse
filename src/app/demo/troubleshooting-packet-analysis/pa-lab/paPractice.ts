import type { SpChallenge } from "@/components/sp-lab/spKit";
import { GOOD_GW, bracket, ctr, outcomeText, type PaState, type TestResult } from "@/lib/sim-engine/scenarios/paNet";

/** Packet Analysis Lab challenges — checked from captures, counters and configuration, never from the commands typed. */
const fresh = (s: PaState) => s.tests.filter((t) => t.cfgSeq === s.cfgSeq);
const conn = (t: TestResult) => t.kind !== "ping";
const hint = (s: PaState) => {
  const t = s.tests[s.tests.length - 1];
  return t ? `last test: ${outcomeText(t)}.` : "run a test first.";
};
const synReachedServer = (s: PaState, t: TestResult) => bracket(s, t).some((b) => b.f.flags === "S" && b.seen.server);

export const PA_CHALLENGES: SpChallenge<PaState>[] = [
  {
    id: "refuse",
    title: "Make it refuse, then make it work",
    how: "Get SERVER to refuse a connection (a RST in the capture), then put the service back and prove a fresh connection succeeds.",
    done: (s) => s.tests.some((t) => conn(t) && t.outcome === "refused") && s.hosts.nginx && fresh(s).some((t) => conn(t) && t.outcome === "ok"),
    next: (s) => (!s.tests.some((t) => t.outcome === "refused") ? "no refused connection yet — what makes a host answer RST?" : !s.hosts.nginx ? "nginx is still stopped." : hint(s)),
  },
  {
    id: "silence",
    title: "Silence with the service running",
    how: "With nginx running, produce a connection that times out even though its SYNs reach SERVER's capture. Then undo the cause and prove a fresh connection succeeds.",
    done: (s) => s.tests.some((t) => conn(t) && t.outcome === "timeout" && synReachedServer(s, t)) && s.hosts.nginx && !s.hosts.drop443 && s.hosts.gw === GOOD_GW && fresh(s).some((t) => conn(t) && t.outcome === "ok"),
    next: (s) => (!s.hosts.nginx ? "keep nginx running for this one." : !s.tests.some((t) => conn(t) && t.outcome === "timeout" && synReachedServer(s, t)) ? "no timed-out connection whose SYN reached SERVER yet." : s.hosts.drop443 || s.hosts.gw !== GOOD_GW ? "the cause of the silence is still in place." : hint(s)),
  },
  {
    id: "catch",
    title: "Catch the drop, then prove it's gone",
    how: "Apply the 64k shaper on R1 ge-0/0/0, run connections until one needs a SYN retransmission, then remove the shaper and prove three clean connections in a row.",
    done: (s) => s.tests.some((t) => conn(t) && t.synRetx > 0 && bracket(s, t).some((b) => b.f.lostAt?.startsWith("R1"))) && !s.cfg.R1.shape && fresh(s).filter((t) => conn(t) && t.outcome === "ok" && t.synRetx === 0 && t.dataRetx === 0).length >= 3,
    next: (s) => (!s.tests.some((t) => t.synRetx > 0) ? (s.cfg.R1.shape ? "keep connecting — the shaper drops one frame in six." : "no shaper on R1 ge-0/0/0 yet.") : s.cfg.R1.shape ? "remove the shaper." : `${fresh(s).filter((t) => conn(t) && t.outcome === "ok" && t.synRetx === 0 && t.dataRetx === 0).length}/3 clean connections since the fix.`),
  },
  {
    id: "count",
    title: "Let the counter testify",
    how: "With the shaper on R1 ge-0/0/0, clear its interface statistics, then run traffic until `show interfaces ge-0/0/0 extensive` reports at least two output drops.",
    done: (s) => !!s.cfg.R1.shape && s.clearedOnce && ctr(s, "R1:ge-0/0/0").drops >= 2,
    next: (s) => (!s.cfg.R1.shape ? "no shaper on R1 ge-0/0/0." : !s.clearedOnce ? "clear R1's interface statistics first." : `${ctr(s, "R1:ge-0/0/0").drops} output drop(s) since the clear.`),
  },
  {
    id: "mirror",
    title: "Rebuild the mirror",
    how: "Press “Delete SW1 mirror” below, then rebuild SW1's analyzer session so the CAPTURE laptop sees both directions — prove it with a fresh connection whose SYN-ACK is in the SPAN capture.",
    done: (s) => !!s.wiped && !!s.cfg.SW1.analyzer?.ingress && !!s.cfg.SW1.analyzer?.egress && fresh(s).some((t) => conn(t) && t.outcome === "ok" && t.spanSawReply),
    next: (s) => (!s.wiped ? "press “Delete SW1 mirror” first." : !s.cfg.SW1.analyzer ? "SW1 has no analyzer session." : !s.cfg.SW1.analyzer.egress || !s.cfg.SW1.analyzer.ingress ? "the session doesn't mirror both directions yet." : hint(s)),
  },
];
