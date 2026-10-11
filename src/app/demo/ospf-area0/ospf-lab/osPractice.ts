import { HOST_IP, LINK_ENDS, OS_LINKS, isRouter, osLookup, type OsLink, type OsState } from "@/lib/sim-engine/scenarios/ospfNet";

/**
 * Hands-on challenges of the OSPF Lab — each checked against the network itself (its runs, its adjacencies and routing
 * tables), never against what was clicked or typed.
 */
export interface OsChallenge {
  id: string;
  title: string;
  how: string;
  done: (s: OsState) => boolean;
  /** What is still missing, from the network's own state — shown while the challenge is open and something was tried. */
  next: (s: OsState) => string;
}
/** Did this router path cross that link? */
const usesLink = (path: string[], l: OsLink) => path.some((r, i) => i > 0 && ((path[i - 1] === LINK_ENDS[l][0] && r === LINK_ENDS[l][2]) || (path[i - 1] === LINK_ENDS[l][2] && r === LINK_ENDS[l][0])));
/** Links an H1 → H4 trace used while they were up. */
const pathLinks = (s: OsState) => OS_LINKS.filter((l) => s.runs.some((r) => r.kind === "traffic" && r.results.some((x) => x.replied && x.send.from === "H1" && x.send.to === HOST_IP.H4 && usesLink(x.path.filter(isRouter), l))));
const tracedVia = (s: OsState, pred: (path: string[]) => boolean) => s.runs.some((r) => r.kind === "traffic" && r.cfgSeq === s.cfgSeq && r.results.some((x) => x.replied && x.send.from === "H1" && x.send.to === HOST_IP.H4 && pred(x.path.filter(isRouter))));
export const OS_CHALLENGES: OsChallenge[] = [
  {
    id: "hello",
    title: "Read a neighbor's Hello",
    how: "Send Hellos and open a capture on a router interface: find the Router ID, the area and the neighbors it already hears.",
    done: (s) => s.captures.some((c) => c.pkt.kind === "hello"),
    next: () => "Send Hellos (Hellos ▶), then open a capture on a router's link interface and find the Hello.",
  },
  {
    id: "via3",
    title: "Send H1 → H4 through R3 — without cutting anything",
    how: "Change OSPF costs only (all links FULL) so that a traceroute from H1 to H4 goes R1 → R3 → R4.",
    done: (s) => OS_LINKS.every((l) => s.cfg.links[l] && s.view.adj[l].state === "FULL") && tracedVia(s, (p) => p.join() === "R1,R3,R4"),
    next: (s) => {
      if (!OS_LINKS.every((l) => s.cfg.links[l] && s.view.adj[l].state === "FULL")) return "Every link must be up and every neighbor FULL: change costs only.";
      const hops = osLookup(s.view, "R1", HOST_IP.H4)?.hops.length ?? 0;
      return hops === 2 ? "R1 now has two equal paths to H4: a tie isn't a win for R3. Make the R2 path strictly more expensive." : "Make R1 → R2 → R4 cost more than R1 → R3 → R4, then trace from H1 to H4 after your last change.";
    },
  },
  {
    id: "ecmp",
    title: "Make R1 load-share to R4",
    how: "Make both paths from R1 to H4's LAN cost the same, so R1 installs two next hops (check R1's route to 192.168.4.10).",
    done: (s) => (osLookup(s.view, "R1", HOST_IP.H4)?.hops.length ?? 0) === 2,
    next: (s) => {
      const r = osLookup(s.view, "R1", HOST_IP.H4);
      return r ? `R1's route to 192.168.4.10 has metric ${r.metric} and one next hop. Add up both paths from R1 (outgoing costs) and make the totals equal.` : "R1 has no route to 192.168.4.10. Get OSPF working first.";
    },
  },
  {
    id: "flood",
    title: "Watch an LSA reach every router",
    how: "Cause a change (a cost, a link), then show the flood: the changed router's LSA must reach all three other routers.",
    done: (s) => s.runs.some((r) => r.kind === "flood" && r.waves.flatMap((w) => w.rx).length >= 3),
    next: (s) => (s.runs.some((r) => r.kind === "flood") ? "A flood ran, but its LSA didn't reach all three other routers. Are all neighbors FULL?" : "Change something (a cost or a link), then press “Show the last LSA flood ▶”."),
  },
  {
    id: "survive",
    title: "Lose a link without losing H4",
    how: "Cut a link on the current H1 → H4 path, then show H1 still reaches H4 (on the other path).",
    done: (s) => OS_LINKS.some((l) => !s.cfg.links[l] && pathLinks(s).includes(l)) && tracedVia(s, () => true),
    next: (s) => {
      const used = pathLinks(s);
      if (!used.length) return "First trace from H1 to H4, to see which links the path uses.";
      if (!OS_LINKS.some((l) => !s.cfg.links[l] && used.includes(l))) return "Cut a link that your H1 → H4 trace used.";
      return "A link on the path is down. Now trace from H1 to H4 again: it must arrive on the other path.";
    },
  },
  {
    id: "dead",
    title: "Measure the dead interval",
    how: "Fail a link silently, show the ping lost while the neighbor is still FULL, then let the dead interval expire and show traffic recovering.",
    done: (s) => OS_LINKS.some((l) => s.silent[l] !== undefined && s.view.adj[l].state === "DOWN") && s.runs.some((r) => r.kind === "traffic" && r.results.some((x) => !x.replied && /silently failed/.test(x.fail ?? ""))) && s.runs.some((r) => r.kind === "traffic" && r.cfgSeq <= s.cfgSeq && r.results.length > 0 && r.results.every((x) => x.replied) && OS_LINKS.some((l) => s.silent[l] !== undefined && r.clock - s.silent[l]! >= 40)),
    next: (s) => {
      const l = OS_LINKS.find((x) => s.silent[x] !== undefined);
      if (!l) return "Fail a link silently first (the link stays up, packets are lost).";
      if (!s.runs.some((r) => r.kind === "traffic" && r.results.some((x) => !x.replied && /silently failed/.test(x.fail ?? "")))) return "The link is failing silently. Send traffic across it now: it is lost while the neighbor still looks FULL.";
      if (s.view.adj[l].state !== "DOWN") return "Now wait for the dead interval (40 s) to expire.";
      return "The neighbor is down. Send traffic again: it must take the other path.";
    },
  },
];
