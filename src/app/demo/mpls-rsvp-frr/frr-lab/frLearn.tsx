import type { ReactNode } from "react";
import type { SpLevel } from "@/components/sp-lab/spKit";
import type { FrAction, FrCfg, FrR } from "@/lib/sim-engine/scenarios/frrNet";

/**
 * Fast Reroute Lab · Learn — six levels:
 *   1 Why local repair · 2 PLR, merge point, bypass · 3 A link fails · 4 A router fails · 5 Detection decides ·
 *   6 Read the evidence
 */

const B = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;
const M = ({ children }: { children: ReactNode }) => <span className="pv-mono text-pv-text">{children}</span>;
const set = (text: string, dev: FrR, f: (c: FrCfg) => void): FrAction => ({ type: "set", text, changes: [{ dev, f }] });
const drill = (what: string): FrAction => ({ type: "drill", what });
const noFrr = set("tunnel-te1 without fast reroute", "R1", (c) => void (c.tunnels[0].frr = "off"));
const nhopOnly = set("R3: automatic bypasses toward R5 are NHOP-only", "R3", (c) => void (c.ifs["ge-0/0/1"].nhopOnly = true));
const noBfd = set("R3: no BFD toward R5", "R3", (c) => void (c.ifs["ge-0/0/1"].bfd = false));

export const FR_LEVELS: SpLevel<FrAction>[] = [
  {
    n: 1,
    title: "Why local repair",
    idea: "When a link or router on an LSP fails, waiting for the headend costs seconds; the router next to the failure can repair in milliseconds.",
    steps: [
      {
        title: "The video on its engineered path",
        body: <p>tunnel-te1 carries CE1&apos;s 500 Mbps video from R1 to R6 over R3, R5 and R7 — the RSVP-TE LSP from the previous lesson. Send it once: push at R1, swap at R3 and R5, pop at R7.</p>,
        pre: [noFrr],
        runs: [{ label: "Send traffic from CE1", actions: [{ type: "test", from: "CE1" }] }],
        show: ["lsps", "test"],
      },
      {
        title: "R3–R5 fails, nothing prepared",
        body: (
          <p>
            The R3–R5 span fails. R3 notices first — but R3 has nothing prepared. It tells R1 (PathErr), IS-IS floods the change, R1 runs CSPF again and signals a new LSP over R4. Every step is fast; together they take <B>about one and a half seconds</B>, and the video freezes for all of it.
          </p>
        ),
        pre: [noFrr],
        runs: [{ label: "Drill: R3–R5 fails", actions: [drill("link:R3-R5")] }],
        show: ["drill"],
        check: { q: "Which router learns about the failure first?", options: [{ id: "a", label: "R3 — the router directly attached to the failed link" }, { id: "b", label: "R1, the headend" }, { id: "c", label: "R6, the tail" }], answer: "a", why: "The neighbors of the failure see it first. Fast reroute lets that router act on its own instead of waiting for the headend." },
      },
    ],
  },
  {
    n: 2,
    title: "PLR, merge point, bypass",
    idea: "The router before the failure (PLR) keeps a pre-signaled bypass; it rejoins the LSP at the merge point (MP), which receives exactly the label it always expected.",
    steps: [
      {
        title: "Ask for protection",
        body: (
          <p>
            R1 asks for protection in the LSP&apos;s PATH (<M>fast-reroute protect node</M> on IOS XR, <M>node-link-protection</M> on Junos). Every router on the path that can, builds a <B>bypass</B> in advance: R3 one to R5 around the link (<B>NHOP</B>) and one to R7 around R5 (<B>NNHOP</B>); R5 one to R7 around R5–R7. R1 and R7 have no second way out, so they can&apos;t.
          </p>
        ),
        pre: [noFrr],
        runs: [{ label: "Request node protection on tunnel-te1", actions: [set("R1: tunnel-te1 fast-reroute protect node", "R1", (c) => void (c.tunnels[0].frr = "node"))] }],
        show: ["bypasses", "frrdb"],
      },
      {
        title: "The label trick",
        body: <p>R3 is the <B>point of local repair</B> (PLR) for R3–R5 and for R5. Its NNHOP bypass ends at R7, the <B>merge point</B>. During a repair R3 swaps the video&apos;s label to the one R7 expects from R5 (learned from the RSVP Record Route), then pushes the bypass label on top. R4 only sees the bypass label; R7 receives its normal label and carries on as if nothing happened.</p>,
        show: ["frrdb", "labels"],
        check: { q: "During a repair through R4, which label does R7 receive for the video?", options: [{ id: "a", label: "The same label it always receives from R5" }, { id: "b", label: "The bypass label" }, { id: "c", label: "No label, plain IP" }], answer: "a", why: "R4 pops the bypass label (PHP toward R7), leaving the inner label R3 put there: R7's own label for the video." },
      },
    ],
  },
  {
    n: 3,
    title: "A link fails",
    idea: "Detection plus a ~10 ms switch: the PLR moves traffic onto the bypass; the headend then re-optimizes calmly and the bypass is released.",
    steps: [
      {
        title: "R3–R5 fails, protected",
        body: <p>Same failure, now protected. R3 detects it (BFD on the DWDM span: 45 ms), switches the video onto its NNHOP bypass in ~10 ms, and R7 receives its usual label. The headend gets a PathErr saying the LSP was locally repaired and moves it to a new path — make-before-break.</p>,
        runs: [{ label: "Drill: R3–R5 fails", actions: [drill("link:R3-R5")] }],
        show: ["drill"],
      },
      {
        title: "Back to the best path",
        body: <p>After the repair the LSP runs over R4 even when R3–R5 is fixed: an LSP keeps a valid path. Re-optimization (<M>mpls traffic-eng reoptimize</M> / <M>clear mpls lsp optimize</M>, or the periodic timer) moves it back.</p>,
        pre: [drill("link:R3-R5")],
        runs: [{ label: "Repair the span, then re-optimize", actions: [{ type: "restore" }, { type: "reopt" }] }],
        show: ["lsps", "bypasses"],
      },
    ],
  },
  {
    n: 4,
    title: "A router fails",
    idea: "A bypass to the next hop (NHOP) can't save you when the next hop itself dies: node protection needs a bypass to the next-next hop (NNHOP).",
    steps: [
      {
        title: "Link protection only",
        body: <p>R3 is set to build <B>NHOP</B> bypasses only. Its bypass goes R3–R4–R5 — and ends at R5. Now R5 loses power.</p>,
        pre: [nhopOnly],
        runs: [{ label: "Drill: R5 fails", actions: [drill("node:R5")] }],
        show: ["bypasses", "drill"],
      },
      {
        title: "Node protection",
        body: <p>Let R3 build NNHOP bypasses again: R3–R4–R7, around R5. The same failure is now repaired locally, and R7 merges the video back.</p>,
        pre: [nhopOnly],
        runs: [{ label: "Allow NNHOP bypasses, then drill: R5 fails", actions: [set("R3: automatic bypasses toward R5 — NHOP and NNHOP", "R3", (c) => void (c.ifs["ge-0/0/1"].nhopOnly = false)), drill("node:R5")] }],
        show: ["bypasses", "drill"],
        check: { q: "Why does node protection also protect against the R3–R5 link failing?", options: [{ id: "a", label: "A path that avoids R5 also avoids the R3–R5 link" }, { id: "b", label: "It doesn't — you need both" }, { id: "c", label: "BFD switches to the NHOP bypass" }], answer: "a", why: "The NNHOP bypass avoids the whole next router, links included, so it covers both failures." },
      },
    ],
  },
  {
    n: 5,
    title: "Detection decides",
    idea: "Local repair is only as fast as the PLR's detection: loss of light is instant, a silent failure needs BFD.",
    steps: [
      {
        title: "A silent span without BFD",
        body: <p>R3–R5 crosses a DWDM system. When the span inside it fails, both routers keep their light — the interfaces stay up. Without BFD, R3 only finds out when IS-IS gives up on its neighbor: <B>30 seconds</B>. The bypass is ready the whole time and useless.</p>,
        pre: [noBfd],
        runs: [{ label: "Drill: R3–R5 fails", actions: [drill("link:R3-R5")] }],
        show: ["drill"],
      },
      {
        title: "Loss of light needs nothing",
        body: <p>R5–R7 is a plain fiber: when it is cut, R5 loses light at once (10 ms) and repairs locally over R4. BFD matters where the failure is silent.</p>,
        runs: [{ label: "Drill: R5–R7 fails", actions: [drill("link:R5-R7")] }],
        show: ["drill"],
        check: { q: "The bypass was up and bound. Why did the video still freeze for 30 seconds on R3–R5?", options: [{ id: "a", label: "R3 didn't know the span had failed until IS-IS timed out" }, { id: "b", label: "The bypass was too slow" }, { id: "c", label: "R1 had to re-signal" }], answer: "a", why: "Repair starts at detection. On a silent failure, only BFD (45 ms here) gives the PLR that information in time." },
      },
    ],
  },
  {
    n: 6,
    title: "Read the evidence",
    idea: "Drill result → does the LSP request protection → which router is the PLR and what is bound → are the bypasses up → how fast was detection.",
    steps: [
      {
        title: "The guided lesson's incident",
        body: <p>&quot;FRR was ready&quot; — and R5&apos;s power loss still froze the video for more than a second. Read the ladder: the LSP asks for node protection, R3 is the PLR, and the only bypass bound is NHOP.</p>,
        pre: [nhopOnly],
        runs: [{ label: "Drill: R5 fails", actions: [drill("node:R5")] }],
        show: ["ladder", "drill"],
      },
      {
        title: "Fix one thing, prove it",
        body: <p>Allow R3 to build NNHOP bypasses again (remove <M>nhop-only</M> / <M>no-node-protection</M>), check that tunnel-te1 is now bound to the NNHOP bypass, and prove it with the same drill.</p>,
        pre: [nhopOnly],
        runs: [{ label: "Fix R3, then drill: R5 fails", actions: [set("R3: auto-tunnel backup without nhop-only", "R3", (c) => void (c.ifs["ge-0/0/1"].nhopOnly = false)), drill("node:R5")] }],
        show: ["ladder", "drill"],
      },
    ],
  },
];
