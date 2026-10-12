import type { SpChallenge } from "@/components/sp-lab/spKit";
import { TE_LO, autorouted, igpPaths, linkById, linkUp, lspOf, tedDirs, type TeR, type TeState, type TeTunnel } from "@/lib/sim-engine/scenarios/teNet";

/** RSVP-TE Lab challenges — checked from the LSPs, the TED, the routing table and fresh traffic. */
const fresh = (s: TeState) => s.tests.filter((t) => t.cfgSeq === s.cfgSeq);
const flowOk = (s: TeState, from: "CE1" | "CE6", mbps: number) => fresh(s).some((t) => t.from === from && t.mbps >= mbps && t.ok && t.via.includes("RSVP-TE"));
const upTo = (s: TeState, head: TeR, dst: string, f: (t: TeTunnel) => boolean = () => true) =>
  s.cfg[head].tunnels.filter((t) => t.dst === dst && f(t)).map((t) => ({ t, l: lspOf(s.view, head, t.id)! })).filter((x) => x.l?.state === "up");
const has = (path: TeR[] | undefined, a: TeR, b: TeR) => !!path && path.some((x, i) => i > 0 && ((path[i - 1] === a && x === b) || (path[i - 1] === b && x === a)));

export const TE_CHALLENGES: SpChallenge<TeState>[] = [
  {
    id: "top150",
    title: "Pin a 150 Mbps tunnel to the top",
    how: "On R1, build a second tunnel to 6.6.6.6 that reserves 150 Mbps and follows an explicit path over R2 and R4 (strict hops). It must be up on R1–R2–R4–R6.",
    done: (s) => upTo(s, "R1", TE_LO.R6, (t) => t.bw >= 150000 && t.bw <= 200000).some(({ t, l }) => l.path!.join() === "R1,R2,R4,R6" && t.opts.find((o) => o.idx === l.opt)?.kind === "explicit"),
    next: (s) => {
      const c = s.cfg.R1.tunnels.filter((t) => t.id !== 1);
      if (!c.length) return "R1 has no second tunnel yet.";
      const t = c[c.length - 1];
      const l = lspOf(s.view, "R1", t.id);
      if (!t.opts.some((o) => o.kind === "explicit")) return "the tunnel has no explicit path option.";
      if (t.bw < 150000 || t.bw > 200000) return `the tunnel asks for ${t.bw} kbps; it should be 150 Mbps (it must fit R2–R4's 200 Mbps).`;
      return l?.state === "up" ? `it is up, but on ${l.path!.join("→")}.` : `it is down: ${l?.why ?? "not signaled"}.`;
    },
  },
  {
    id: "fallback",
    title: "Survive the R5–R6 cut",
    how: "Give tunnel-te1 an explicit primary path option over R3, R5, R6 and a dynamic path option behind it. Then cut R5–R6 (below). tunnel-te1 must stay up on its dynamic option, and a fresh 500 Mbps flow from CE1 must get through.",
    done: (s) => {
      const t = s.cfg.R1.tunnels.find((x) => x.id === 1);
      const l = lspOf(s.view, "R1", 1);
      const sorted = t ? [...t.opts].sort((a, b) => a.idx - b.idx) : [];
      return !!t && sorted[0]?.kind === "explicit" && sorted.some((o) => o.kind === "dynamic") && !linkUp(s.cfg, linkById("R5-R6")) && l?.state === "up" && sorted.find((o) => o.idx === l.opt)?.kind === "dynamic" && flowOk(s, "CE1", 500);
    },
    next: (s) => {
      const t = s.cfg.R1.tunnels.find((x) => x.id === 1);
      const sorted = t ? [...t.opts].sort((a, b) => a.idx - b.idx) : [];
      if (!t) return "tunnel-te1 is gone.";
      if (sorted[0]?.kind !== "explicit") return "tunnel-te1's first path option isn't explicit yet.";
      if (!sorted.some((o) => o.kind === "dynamic")) return "there is no dynamic path option behind the explicit one.";
      if (linkUp(s.cfg, linkById("R5-R6"))) return "now cut R5–R6.";
      return lspOf(s.view, "R1", 1)?.state !== "up" ? "tunnel-te1 is down." : "now send 500 Mbps from CE1.";
    },
  },
  {
    id: "temetric",
    title: "Steer CSPF, not IS-IS",
    how: "Make a small tunnel from R1 to 6.6.6.6 (at most 200 Mbps, dynamic path) avoid R2–R4 by raising a TE metric — while R1's IS-IS shortest path to R6 still goes over R2.",
    done: (s) => {
      const igp = igpPaths(s.cfg, "R1").R6?.path ?? [];
      const teOverride = tedDirs(s.cfg).some((d) => d.teMetric !== d.link.metric);
      return teOverride && igp.includes("R2") && upTo(s, "R1", TE_LO.R6, (t) => t.bw > 0 && t.bw <= 200000).some(({ t, l }) => t.opts.find((o) => o.idx === l.opt)?.kind === "dynamic" && !has(l.path, "R2", "R4"));
    },
    next: (s) => {
      if (!s.cfg.R1.tunnels.some((t) => t.dst === TE_LO.R6 && t.bw > 0 && t.bw <= 200000)) return "R1 has no tunnel to 6.6.6.6 of 200 Mbps or less.";
      if (!tedDirs(s.cfg).some((d) => d.teMetric !== d.link.metric)) return "no link has a TE metric different from its IGP metric yet.";
      return "the small tunnel still crosses R2–R4 — which direction of which link carries the higher TE metric?";
    },
  },
  {
    id: "return",
    title: "Engineer the way back",
    how: "CE6 sends 300 Mbps back to CE1, and IS-IS puts it on R4→R2. Build an LSP from R6 to 1.1.1.1 that reserves 300 Mbps, route traffic into it, and prove it with a fresh 300 Mbps flow from CE6.",
    done: (s) => upTo(s, "R6", TE_LO.R1, (t) => t.bw >= 300000 && autorouted(s.cfg.R6, t)).length > 0 && flowOk(s, "CE6", 300),
    next: (s) => {
      const ts = s.cfg.R6.tunnels.filter((t) => t.dst === TE_LO.R1);
      if (!ts.length) return "R6 has no tunnel to 1.1.1.1.";
      const t = ts[0];
      const l = lspOf(s.view, "R6", t.id);
      if (t.bw < 300000) return "the tunnel reserves less than 300 Mbps.";
      if (l?.state !== "up") return `the tunnel is down: ${l?.why ?? ""}.`;
      if (!autorouted(s.cfg.R6, t)) return "the tunnel is up but nothing routes into it.";
      return "now send 300 Mbps from CE6.";
    },
  },
  {
    id: "rebuild",
    title: "Rebuild tunnel-te1 from nothing",
    how: "Press “Wipe R1's tunnels” (below), then configure the video tunnel again: to 6.6.6.6, 500 Mbps, a dynamic path, routed into by IS-IS. Prove it with a fresh 500 Mbps flow from CE1.",
    done: (s) => !!s.wiped && upTo(s, "R1", TE_LO.R6, (t) => t.bw >= 500000 && autorouted(s.cfg.R1, t)).length > 0 && flowOk(s, "CE1", 500),
    next: (s) => {
      if (!s.wiped) return "wipe R1's tunnels first.";
      const t = s.cfg.R1.tunnels.find((x) => x.dst === TE_LO.R6);
      if (!t) return "R1 has no tunnel to 6.6.6.6 yet.";
      if (t.bw < 500000) return "it reserves less than 500 Mbps.";
      if (!t.opts.length) return "it has no path option.";
      if (lspOf(s.view, "R1", t.id)?.state !== "up") return `it is down: ${lspOf(s.view, "R1", t.id)?.why ?? ""}.`;
      if (!autorouted(s.cfg.R1, t)) return "it is up, but nothing routes into it.";
      return "now send 500 Mbps from CE1.";
    },
  },
];
