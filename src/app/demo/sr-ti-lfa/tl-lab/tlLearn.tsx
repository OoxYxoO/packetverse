import type { ReactNode } from "react";
import type { SpLevel } from "@/components/sp-lab/spKit";
import { TL_ROUTERS, tlIfs, type TlAction, type TlR, type TlRtr } from "@/lib/sim-engine/scenarios/tlNet";

/**
 * SR TI-LFA Lab · Learn — six levels on the guided lesson's network:
 *   1 The cost of waiting · 2 The post-convergence path · 3 Why classic LFA isn't enough · 4 Switching in milliseconds ·
 *   5 Detection is half the outage · 6 When it breaks
 */

const B = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;
const M = ({ children }: { children: ReactNode }) => <span className="pv-mono text-pv-text">{children}</span>;
const set = (text: string, changes: { dev: TlR; f: (c: TlRtr) => void }[]): TlAction => ({ type: "set", text, changes });
const ping: TlAction = { type: "ping" };
const drillLink: TlAction = { type: "drill", fail: { link: "R2-R4" } };
const drillR4: TlAction = { type: "drill", fail: { node: "R4" } };
const noFrr = set("Fast reroute removed from every interface", TL_ROUTERS.map((dev) => ({ dev, f: (c: TlRtr) => void tlIfs(dev).forEach((i) => Object.assign(c.ifs[i.ifn]!, { frr: false, lp: false, tilfa: false, node: false })) })));
const r4lfa = set("R4: classic LFA only toward R2 (no TI-LFA)", [{ dev: "R4", f: (c) => void Object.assign(c.ifs["ge-0/0/0"]!, { frr: true, lp: true, tilfa: false, node: false }) }]);
const noBfd = set("BFD removed from R2–R4 (both ends)", [
  { dev: "R2", f: (c) => void (c.ifs["ge-0/0/1"]!.bfd = false) },
  { dev: "R4", f: (c) => void (c.ifs["ge-0/0/0"]!.bfd = false) },
]);
const r3noSr = set("R3: segment routing disabled", [{ dev: "R3", f: (c) => void (c.sr = false) }]);

export const TL_LEVELS: SpLevel<TlAction>[] = [
  {
    n: 1,
    title: "The cost of waiting",
    idea: "Without a precomputed backup, a failure costs detection plus a full IS-IS convergence — hundreds of milliseconds at best, with every router recomputing and reprogramming.",
    steps: [
      {
        title: "The normal path",
        body: <p>H1 sends to H6. R1 pushes R6&apos;s Node SID <M>16006</M> and the packet follows the shortest path R1 → R2 → R4 → R6 (cost 30). The R2–R4 link crosses a DWDM system: when it fails, the light stays on at both routers.</p>,
        runs: [{ label: "Ping 192.168.6.20 from H1", actions: [ping] }],
        show: ["test", "path"],
      },
      {
        title: "A failure with no protection",
        body: <p>Take fast reroute off every interface and fail R2–R4. BFD notices the silent failure in 150 ms — and then nothing is ready: R2 and R4 have to wait for IS-IS to flood, every router to rerun SPF and the new labels to be programmed. Both directions lose traffic for the whole time.</p>,
        pre: [noFrr],
        runs: [{ label: "Drill: R2–R4 fails", actions: [drillLink] }],
        show: ["drill"],
        check: { q: "What is the loss made of here?", options: [{ id: "a", label: "Detection (150 ms) plus IS-IS convergence (~800 ms)" }, { id: "b", label: "Only detection" }, { id: "c", label: "The headend recomputing an SR policy" }], answer: "a", why: "With nothing precomputed, the router that sees the failure has no choice but to wait for the network to converge." },
      },
    ],
  },
  {
    n: 2,
    title: "The post-convergence path",
    idea: "TI-LFA computes, before anything fails, the path traffic will take after convergence — and encodes it from the PLR's point of view as a few segments.",
    steps: [
      {
        title: "The PLR and its backup",
        body: (
          <p>
            For H1 → H6 the failure enters at <B>R2</B>: R2 is the point of local repair (PLR). Remove R4 (node protection) and R2&apos;s path to R6 becomes R2 → R3 → R5 → R6 — the <B>post-convergence path</B>. R2 already knows it: look at its backup for 10.0.0.6.
          </p>
        ),
        show: ["backups"],
      },
      {
        title: "P-space, Q-space and the PQ node",
        body: (
          <p>
            Routers R2 reaches without crossing R2–R4 form its <B>P-space</B> (R1, R3, R5); routers that reach R6 without crossing it form R6&apos;s <B>Q-space</B> (R3, R4, R5). R3 and R5 are in both; R5, closest to R6, is the <B>PQ node</B> — and it doesn&apos;t depend on R4 either. So the repair is one segment: <M>[16005]</M> above <M>16006</M>. R2&apos;s own shortest path takes 16005 to R5; R5&apos;s shortest path takes 16006 to R6.
          </p>
        ),
        show: ["backups"],
        check: { q: "Why is 16005 enough — why not list every hop R3, R5, R6?", options: [{ id: "a", label: "R2's normal shortest path to R5 already goes via R3, and R5's to R6 is direct" }, { id: "b", label: "TI-LFA can only push one label" }, { id: "c", label: "R3 doesn't run segment routing" }], answer: "a", why: "A Node SID means “shortest path to that router”. TI-LFA only adds a segment where the pre-failure shortest path would leave the post-convergence path." },
      },
    ],
  },
  {
    n: 3,
    title: "Why classic LFA isn't enough",
    idea: "A classic loop-free alternate is a neighbor that wouldn't send the packet back. Some PLRs have none. TI-LFA always has a repair, because the labels steer around the loop.",
    steps: [
      {
        title: "R4 has no loop-free neighbor",
        body: (
          <p>
            For H6 → H1 the PLR is R4. Switch R4&apos;s interface toward R2 to classic LFA only. R4&apos;s only other neighbor is R6 — and R6&apos;s shortest path to R1 is back through R4 (30 vs 10 + 20). No loop-free alternate: R4 has <B>no backup</B> for R1.
          </p>
        ),
        pre: [r4lfa],
        show: ["backups"],
      },
      {
        title: "See what it costs",
        body: <p>Fail R2–R4 again. R2 still repairs H1 → H6 with TI-LFA; R4 can&apos;t, and H6 → H1 waits for convergence.</p>,
        pre: [r4lfa],
        runs: [{ label: "Drill: R2–R4 fails", actions: [drillLink] }],
        show: ["drill"],
        check: { q: "With TI-LFA, how does R4 avoid the loop through R6?", options: [{ id: "a", label: "It pushes 16005: R6 forwards toward R5, not back to R4" }, { id: "b", label: "It asks R6 to recompute first" }, { id: "c", label: "It can't — R4 is unprotectable" }], answer: "a", why: "The repair segment changes the question R6 asks: not “shortest path to R1” (back via R4) but “shortest path to R5” (direct)." },
      },
    ],
  },
  {
    n: 4,
    title: "Switching in milliseconds",
    idea: "With TI-LFA on both PLRs, a failure costs detection plus a ~15 ms switch to the precomputed backup — both directions, link or node.",
    steps: [
      {
        title: "The link fails",
        body: <p>Every interface runs TI-LFA again. Fail R2–R4: BFD detects it in 150 ms, R2 pushes <M>[16005, 16006]</M> toward R3, R4 pushes <M>[16005, 16001]</M> back toward R6. Look at H6 → H1: the packet goes R6 → R4 → R6 → R5 … — R6 still sends to R4 until IS-IS converges, and R4 repairs.</p>,
        runs: [{ label: "Drill: R2–R4 fails", actions: [drillLink] }],
        show: ["drill", "path"],
        check: { q: "Where does the ~165 ms come from?", options: [{ id: "a", label: "150 ms BFD detection + ~15 ms switch to the backup" }, { id: "b", label: "IS-IS convergence" }, { id: "c", label: "The R2–R4 metric" }], answer: "a", why: "The backup was installed in the forwarding table already: once the failure is detected, only the switch remains." },
      },
      {
        title: "The router fails",
        body: <p>Now fail R4 itself. Its links lose light, so detection takes 10 ms. R2 protects H1 → H6 with its node-protecting backup; for H6 → H1 the PLR is now <B>R6</B> (its next hop R4 is gone), which pushes <M>[16003]</M> toward R5.</p>,
        runs: [{ label: "Drill: R4 fails", actions: [drillR4] }],
        show: ["drill"],
      },
    ],
  },
  {
    n: 5,
    title: "Detection is half the outage",
    idea: "A backup only helps once the failure is detected. A silent failure without BFD is found by the IS-IS hold time — 30 s.",
    steps: [
      {
        title: "Take BFD away",
        body: <p>Remove BFD from both ends of R2–R4 and fail the link. The DWDM system keeps the light on, so neither router sees the failure until IS-IS hellos stop for the full hold time. TI-LFA is ready the whole time — and does nothing.</p>,
        pre: [noBfd],
        runs: [{ label: "Drill: R2–R4 fails", actions: [drillLink] }],
        show: ["drill", "bfd"],
        check: { q: "What would you check first on a link that “failed but never went down”?", options: [{ id: "a", label: "show bfd session on both ends" }, { id: "b", label: "The repair labels" }, { id: "c", label: "The BGP routes" }], answer: "a", why: "If nothing detects the failure, no backup is ever used. BFD is what turns a silent failure into a 150 ms one." },
      },
    ],
  },
  {
    n: 6,
    title: "When it breaks",
    idea: "A repair is only as good as the routers on it: every router on the post-convergence path must execute the labels.",
    steps: [
      {
        title: "A router without segment routing",
        body: <p>Disable segment routing on R3. Every path around R2–R4 goes through R3, so R2 and R4 can build no repair — the interfaces ask for TI-LFA, the backup column stays empty. After convergence R3 receives the traffic unlabelled and, with no BGP in the core, drops it.</p>,
        pre: [r3noSr],
        runs: [{ label: "Drill: R2–R4 fails", actions: [drillLink] }],
        show: ["drill", "backups"],
      },
      {
        title: "Read the ladder",
        body: <p>The ladder walks the evidence in order: what the drill showed, which router is the PLR, how fast it detects, whether it has a backup, whether every router on the repair can execute it, and whether the post-convergence path works at all.</p>,
        pre: [r3noSr],
        runs: [{ label: "Drill: R2–R4 fails", actions: [drillLink] }],
        show: ["ladder"],
        check: { q: "Which rung fails first?", options: [{ id: "a", label: "The backup: R2 and R4 have none, because R3 isn't SR-capable" }, { id: "b", label: "Detection" }, { id: "c", label: "The IS-IS adjacencies" }], answer: "a", why: "Detection is fine (BFD); the PLRs simply have nothing to switch to — and the reason is R3." },
      },
    ],
  },
];
