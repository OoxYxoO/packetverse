import type { SpChallenge } from "@/components/sp-lab/spKit";
import { L3 } from "@/lib/sim-engine/scenarios/troubleshootingLayer3";
import { hostRoutes, rtrRoutes, testText, type L3State } from "@/lib/sim-engine/scenarios/l3tsNet";

/** Layer 3 Lab challenges — checked from configuration, routing tables and test results, never from the commands typed. */
const fresh = (s: L3State) => s.tests.filter((t) => t.cfgSeq === s.cfgSeq);
const okTo = (s: L3State, dst: string) => fresh(s).some((t) => t.kind === "ping" && t.from === "CLIENT" && t.dst === dst && t.recv === t.sent);
const hint = (s: L3State) => {
  const t = s.tests[s.tests.length - 1];
  return t ? `last test: ${testText(t)}.` : "run a ping first.";
};
const clientOk = (s: L3State) => s.hosts.CLIENT.addrs.length === 1 && s.hosts.CLIENT.addrs[0].len === 24 && hostRoutes(s.hosts.CLIENT).some((r) => r.kind === "default" && r.nh === L3.gw);

export const L3_CHALLENGES: SpChallenge<L3State>[] = [
  {
    id: "nodefault",
    title: "Lose the default route, then restore it",
    how: "Remove CLIENT's default route and show that pinging SERVER now fails locally (Network is unreachable), then restore it and prove a fresh ping.",
    done: (s) => s.tests.some((t) => t.from === "CLIENT" && t.error === "Network is unreachable") && clientOk(s) && okTo(s, L3.server),
    next: (s) => (!s.tests.some((t) => t.error === "Network is unreachable") ? "no “Network is unreachable” yet — sudo ip route del default on CLIENT, then ping." : !clientOk(s) ? "CLIENT's default route via 10.10.10.1 isn't back." : hint(s)),
  },
  {
    id: "netunreach",
    title: "Make R1 say “no route”",
    how: "Delete one of R1's static routes so CLIENT receives Destination Net Unreachable from 10.10.10.1, then restore the route and prove a fresh ping to that server.",
    done: (s) => s.tests.some((t) => t.error === "Destination Net Unreachable" && t.errorFrom === L3.gw) && rtrRoutes(s.rtrs.R1).filter((r) => r.kind === "Static").length === 2 && okTo(s, L3.server) && okTo(s, L3.remote),
    next: (s) => (!s.tests.some((t) => t.error === "Destination Net Unreachable") ? "no net-unreachable from R1 yet." : rtrRoutes(s.rtrs.R1).filter((r) => r.kind === "Static").length < 2 ? "R1 is still missing a static route." : "ping both servers fresh."),
  },
  {
    id: "silent",
    title: "Break only the way back",
    how: "Change R2 so CLIENT's requests still reach SERVER but every reply is lost — silently, no error — then repair it and prove a fresh ping.",
    done: (s) => s.tests.some((t) => t.kind === "ping" && t.from === "CLIENT" && t.dst === L3.server && t.recv === 0 && !t.error) && okTo(s, L3.server),
    next: (s) => (!s.tests.some((t) => t.kind === "ping" && t.dst === L3.server && t.recv === 0 && !t.error) ? "no silent failure to SERVER yet — think about R2's route back to 10.10.10.0/24." : hint(s)),
  },
  {
    id: "loop",
    title: "Make a packet bounce",
    how: "Create a routing loop for REMOTE-SERVER's network so CLIENT receives Time to live exceeded, then remove it and prove a fresh ping to REMOTE-SERVER.",
    done: (s) => s.tests.some((t) => t.error === "Time to live exceeded") && rtrRoutes(s.rtrs.R2).some((r) => r.prefix === "10.10.20.0" && r.kind === "Direct") && okTo(s, L3.remote),
    next: (s) => (!s.tests.some((t) => t.error === "Time to live exceeded") ? "no TTL exceeded yet — what happens if R2 loses its connected route to 10.10.20.0/24?" : hint(s)),
  },
  {
    id: "mask",
    title: "One wrong number",
    how: "Give CLIENT a prefix length that makes REMOTE-SERVER look on-link (SERVER keeps working), show the failed ARP, then fix CLIENT and prove fresh pings to both servers.",
    done: (s) => s.tests.some((t) => t.from === "CLIENT" && t.dst === L3.remote && t.error === "Destination Host Unreachable" && t.errorFrom === L3.client) && clientOk(s) && okTo(s, L3.server) && okTo(s, L3.remote),
    next: (s) => (!s.tests.some((t) => t.dst === L3.remote && t.error === "Destination Host Unreachable") ? "REMOTE-SERVER hasn't failed with CLIENT's own Destination Host Unreachable yet." : !clientOk(s) ? "CLIENT isn't back to 10.10.10.10/24 with its default route." : "ping both servers fresh."),
  },
];
