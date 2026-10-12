import type { ReactNode } from "react";
import type { SpLevel } from "@/components/sp-lab/spKit";
import type { T6Action, T6R, T6Rtr } from "@/lib/sim-engine/scenarios/s6tNet";

/**
 * SRv6 TI-LFA Lab · Learn — six levels on the guided lesson's network:
 *   1 The path and its weak spot · 2 Why not just reroute? · 3 The repair: post-convergence path in SIDs ·
 *   4 Protect the router too · 5 Detection is half the story · 6 When it breaks
 */

const B = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;
const M = ({ children }: { children: ReactNode }) => <span className="pv-mono text-pv-text">{children}</span>;
const set = (text: string, changes: { dev: T6R; f: (c: T6Rtr) => void }[]): T6Action => ({ type: "set", text, changes });
const cut: T6Action = { type: "drill", fail: { link: "P1-P2" } };
const linkOnly = set("P1 Gi0/0/0/1: no fast-reroute per-prefix tiebreaker node-protecting", [{ dev: "P1", f: (c) => void (c.ifs["ge-0/0/1"]!.node = false) }]);
const noBfd = set("P1 Gi0/0/0/1: no bfd fast-detect ipv6", [{ dev: "P1", f: (c) => void (c.ifs["ge-0/0/1"]!.bfd = false) }]);
const noP4 = set("P4: no segment-routing srv6 locator MAIN in IS-IS", [{ dev: "P4", f: (c) => void (c.isisLoc = false) }]);

export const T6_LEVELS: SpLevel<T6Action>[] = [
  {
    n: 1,
    title: "The path and its weak spot",
    idea: "CUST-A's VPN traffic from CE1 to CE2 follows PE1 → P1 → P2 → PE2. P1 sits in front of the P1–P2 link: if it fails, P1 is the router that must act — the point of local repair.",
    steps: [
      {
        title: "Follow the VPN flow",
        body: <p>PE1 encapsulates CE1&apos;s packet to PE2&apos;s End.DT4 SID. P1 routes it on PE2&apos;s locator <M>2001:db8:110:2::/64</M> toward P2. P1 has already computed what it would do without P2: the backup in its table.</p>,
        runs: [{ label: "Ping CE1 → CE2", actions: [{ type: "ping", dir: "fwd" }] }],
        show: ["test", "frr"],
      },
    ],
  },
  {
    n: 2,
    title: "Why not just reroute?",
    idea: "When P1–P2 fails, only P1 knows at first. Every other router still forwards with its old table — and P3's old route to PE2 goes back through P1.",
    steps: [
      {
        title: "A hand-built reroute through P3",
        body: <p>Suppose P1 simply sent the packet to P3. P3&apos;s table — not yet updated — says PE2 is reached via P1 (30 &lt; 90 via P4). The packet bounces P1 ↔ P3 until IS-IS converges.</p>,
        runs: [{ label: "Drill: cut P1–P2 with a plain reroute", actions: [{ type: "drill", fail: { link: "P1-P2" }, naive: "plain" }] }],
        show: ["drill", "path"],
        check: { q: "Why does the packet loop?", options: [{ id: "a", label: "P3 still uses its pre-failure route to PE2, which goes back via P1" }, { id: "b", label: "P3's link to P4 is down" }, { id: "c", label: "IPv6 doesn't prevent loops" }], answer: "a", why: "A repair must force its way past routers whose tables are still stale." },
      },
    ],
  },
  {
    n: 3,
    title: "The repair: the post-convergence path in SIDs",
    idea: "TI-LFA computes where traffic will go after convergence (P1 → P3 → P4 → P2 → PE2) and writes it as SIDs the stale routers will obey: out to P3, then P4's End.X toward P2.",
    steps: [
      {
        title: "Link protection: [P4 End.X→P2]",
        body: (
          <p>
            With link protection, P1 encapsulates to <M>2001:db8:110:14:41::</M> — P4&apos;s End.X toward P2. P3 routes it on P4&apos;s locator (its old route to P4 is fine). P4 executes End.X with the <B>USD</B> flavor: removes the repair header and sends the original packet out of its link to P2, which forwards it to PE2. Nobody needed a new table.
          </p>
        ),
        pre: [linkOnly],
        runs: [{ label: "Drill: cut P1–P2", actions: [cut] }],
        show: ["frr", "headers", "drill"],
        check: { q: "Why P4's End.X and not P4's End?", options: [{ id: "a", label: "P4's own old route to P2 goes back via P1 — the End.X forces the P4→P2 link" }, { id: "b", label: "End SIDs can't be the last segment" }, { id: "c", label: "P4 has no End SID" }], answer: "a", why: "P4 is in P1's safe space, but its own path toward P2 is not safe yet — the adjacency SID forces it." },
      },
    ],
  },
  {
    n: 4,
    title: "Protect the router too",
    idea: "A link-protecting repair merges back at P2. If P2 itself dies, that repair delivers into a dead router. Node protection computes a path that avoids P2: [P4 End.X→PE2].",
    steps: [
      {
        title: "P2 fails",
        body: <p>The lab&apos;s default is node-protecting (<M>tiebreaker node-protecting index 100</M>). P1&apos;s backup for PE2 is <M>2001:db8:110:14:42::</M> — P4&apos;s End.X toward PE2, over the P4–PE2 link. The router failure is detected by loss of light: about 25 ms in total.</p>,
        runs: [{ label: "Drill: P2 fails", actions: [{ type: "drill", fail: { node: "P2" } }] }],
        show: ["drill", "headers"],
      },
    ],
  },
  {
    n: 5,
    title: "Detection is half the story",
    idea: "P1–P2 runs over DWDM: when the span fails, the interfaces stay up. Only BFD notices quickly; without it P1 waits for the IS-IS hold time — 30 s — before using its perfect backup.",
    steps: [
      {
        title: "No BFD on P1's side",
        body: <p>Same backup, same repair. But the BFD session is down (P1 doesn&apos;t run it), so detection takes the IS-IS hold time. Local repair is only as fast as failure detection.</p>,
        pre: [noBfd],
        runs: [{ label: "Drill: cut P1–P2", actions: [cut] }],
        show: ["drill"],
        check: { q: "What would a faster backup computation change here?", options: [{ id: "a", label: "Nothing — the time is spent detecting the failure" }, { id: "b", label: "Everything" }, { id: "c", label: "It would make the repair shorter" }], answer: "a", why: "30 s of detection + 15 ms of switching." },
      },
    ],
  },
  {
    n: 6,
    title: "When it breaks",
    idea: "A repair must force the right path, and every router it names needs the SID. The guided lesson's incident is a repair that doesn't force P4's link; its real-world cousin is a repair node without SRv6.",
    steps: [
      {
        title: "A repair to P2's End: the guided incident",
        body: <p>A hand-built repair to <M>2001:db8:110:12:1::</M> (P2&apos;s End) looks reasonable — the destination is P2. But P3 routes P2&apos;s locator with its stale table: back to P1. Loop.</p>,
        runs: [{ label: "Drill: cut P1–P2, repair to P2's End", actions: [{ type: "drill", fail: { link: "P1-P2" }, naive: "p2end" }] }],
        show: ["drill", "path"],
      },
      {
        title: "P4 without SRv6",
        body: <p>P4 lost <M>segment-routing srv6 locator MAIN</M>. Without P4&apos;s End.X there is no way to force the P4→P2 (or P4→PE2) link, so P1 installs no backup at all. Read the ladder.</p>,
        pre: [noP4],
        runs: [{ label: "Drill: cut P1–P2", actions: [cut] }],
        show: ["drill", "ladder"],
        check: { q: "Which rung shows the cause?", options: [{ id: "a", label: "The routers on the repair path: P4 has no locator" }, { id: "b", label: "BFD" }, { id: "c", label: "P1's interface config" }], answer: "a", why: "P1 asks for TI-LFA, but the repair needs a SID P4 doesn't have." },
      },
    ],
  },
];
