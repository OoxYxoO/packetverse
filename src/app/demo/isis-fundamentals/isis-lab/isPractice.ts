import type { SpChallenge } from "@/components/sp-lab/spKit";
import { IS_LO, adjKey, isIfTo, isRib, linkUp, lookup, IS_LINKS, type IsR, type IsState, type IsTest } from "@/lib/sim-engine/scenarios/isisNet";

/**
 * IS-IS Lab challenges — each one is checked from the network itself: adjacencies both ways, what the LSDBs say, what
 * SPF installed, and traffic that actually ran after the change. Nothing is awarded for clicking.
 */

const up2 = (s: IsState, a: IsR, b: IsR) => {
  const i = isIfTo(a, b);
  return !!i && s.adj[adjKey(a, i.ifn)]?.state === "UP" && s.adj[adjKey(b, i.peerIf)]?.state === "UP";
};
const route = (s: IsState, r: IsR, ip: string) => lookup(isRib(s.cfg, s.phys, s.adj, s.db, r), ip);
const freshTests = (s: IsState) => s.tests.filter((t) => t.cfgSeq === s.cfgSeq);
const pathOf = (t: IsTest) => t.fwd.hops.map((h) => h.r).join(">");

export const IS_CHALLENGES: SpChallenge<IsState>[] = [
  {
    id: "rung",
    title: "Bring up the P1–P3 adjacency",
    how: "The P1–P3 link is cabled and addressed, but neither end runs IS-IS on it. Put both ends into IS-IS (point-to-point) and make the adjacency come Up — on both routers.",
    done: (s) => up2(s, "P1", "P3"),
    next: (s) => {
      const p1 = s.cfg.P1.ifs["ge-0/0/2"]!.isis;
      const p3 = s.cfg.P3.ifs["ge-0/0/2"]!.isis;
      if (!p1 && !p3) return "neither P1 ge-0/0/2 nor P3 ge-0/0/2 is an IS-IS interface yet.";
      if (!p1 || !p3) return `${p1 ? "P3" : "P1"} ge-0/0/2 still isn't in IS-IS: an adjacency needs both ends.`;
      return "both ends are in IS-IS but the adjacency isn't Up — compare the two ends (levels, MTU, keys).";
    },
  },
  {
    id: "top",
    title: "Send PE1 → PE2 over the top path only",
    how: "Today PE1 load-shares to PE2's loopback over P1 and P3. Change one metric so PE1's only best path is PE1 → P1 → P2 → PE2, then prove it with a traceroute from PE1 to 10.0.0.4.",
    done: (s) => {
      const rt = route(s, "PE1", "10.0.0.4");
      return !!rt && rt.nh.length === 1 && rt.nh[0].nbr === "P1" && freshTests(s).some((t) => t.kind === "trace" && t.from === "PE1" && t.dst === "10.0.0.4" && t.ok && pathOf(t) === "PE1>P1>P2>PE2");
    },
    next: (s) => {
      const rt = route(s, "PE1", "10.0.0.4");
      if (!rt || rt.nh.length !== 1 || rt.nh[0].nbr !== "P1") return `PE1's route to 10.0.0.4 is via ${rt?.nh.map((h) => h.nbr).join(" + ") ?? "nothing"}. Which outgoing metric on the bottom path would make it longer?`;
      return "the route is right; now run a traceroute from PE1 to 10.0.0.4 to prove it.";
    },
  },
  {
    id: "drain",
    title: "Drain P3 for maintenance — without losing P3",
    how: "Make every router stop using P3 for transit, keep PE1 → PE2 working, and show that P3 itself is still reachable. Prove both with pings from PE1 (to 10.0.0.4 and to 10.0.0.5) after the change.",
    done: (s) => {
      const t = freshTests(s);
      return !!s.db.PE1[2].P3?.ol && t.some((x) => x.from === "PE1" && x.dst === "10.0.0.4" && x.ok && !x.fwd.hops.some((h) => h.r === "P3")) && t.some((x) => x.from === "PE1" && x.dst === "10.0.0.5" && x.ok);
    },
    next: (s) => (!s.db.PE1[2].P3?.ol ? "P3's LSP doesn't announce that it should be avoided yet." : "P3 is drained; now ping 10.0.0.4 and 10.0.0.5 from PE1."),
  },
  {
    id: "survive",
    title: "Lose a link, keep the service",
    how: "Fail the P1–P2 link (Links, below). Show that PE1 still reaches PE2's loopback — and on which path — with a ping or traceroute run after the failure.",
    done: (s) => !linkUp(s, IS_LINKS.find((l) => l.id === "P1-P2")!) && freshTests(s).some((t) => t.from === "PE1" && t.dst === "10.0.0.4" && t.ok),
    next: (s) => (linkUp(s, IS_LINKS.find((l) => l.id === "P1-P2")!) ? "the P1–P2 link is still up." : "the link is down; now test PE1 → 10.0.0.4."),
  },
  {
    id: "auth",
    title: "Protect P1–P2 with hello authentication",
    how: "Configure the same HMAC-MD5 hello key on both ends of P1–P2 (P1 ge-0/0/1, P2 ge-0/0/0) and keep the adjacency Up.",
    done: (s) => !!s.cfg.P1.ifs["ge-0/0/1"]!.key && s.cfg.P1.ifs["ge-0/0/1"]!.key === s.cfg.P2.ifs["ge-0/0/0"]!.key && up2(s, "P1", "P2"),
    next: (s) => {
      const a = s.cfg.P1.ifs["ge-0/0/1"]!.key;
      const b = s.cfg.P2.ifs["ge-0/0/0"]!.key;
      if (!a && !b) return "no key on either end yet.";
      if (!a || !b) return `only ${a ? "P1" : "P2"} has a key — look at the adjacency on each side now.`;
      if (a !== b) return "both ends have a key, but not the same one.";
      return "keys match; the adjacency must be Up on both routers.";
    },
  },
  {
    id: "build",
    title: "Rebuild PE1's IS-IS from nothing",
    how: "Press “Wipe PE1's IS-IS” (below), then configure it again yourself: the process with its NET, Level-2-only, Loopback0 passive, both core interfaces point-to-point. Prove it with a ping from PE1 to 10.0.0.4 sourced from PE1's loopback.",
    done: (s) => !!s.wiped && s.cfg.PE1.isType === "level-2-only" && up2(s, "PE1", "P1") && up2(s, "PE1", "P3") && !!s.db.PE2[2].PE1?.pfx.some((p) => p.p === IS_LO.PE1) && freshTests(s).some((t) => t.from === "PE1" && t.dst === "10.0.0.4" && t.src === IS_LO.PE1 && t.ok),
    next: (s) => {
      if (!s.wiped) return "wipe PE1's IS-IS first.";
      if (!s.cfg.PE1.on || !s.cfg.PE1.net) return "PE1 has no running IS-IS process with a NET.";
      if (!up2(s, "PE1", "P1") || !up2(s, "PE1", "P3")) return "PE1 doesn't have both core adjacencies Up yet.";
      if (s.cfg.PE1.isType !== "level-2-only") return "PE1 runs Level 1 as well: this core is Level-2-only.";
      if (!s.db.PE2[2].PE1?.pfx.some((p) => p.p === IS_LO.PE1)) return "the rest of the core doesn't learn 10.0.0.1/32 from PE1's LSP.";
      return "now ping 10.0.0.4 from PE1 with its loopback as the source.";
    },
  },
];
