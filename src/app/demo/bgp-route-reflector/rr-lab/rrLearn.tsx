import type { ReactNode } from "react";
import type { SpLevel } from "@/components/sp-lab/spKit";
import { RR_CLUSTER, RR_LO, type RrAction, type RrCfg, type RrDev } from "@/lib/sim-engine/scenarios/rrNet";

/**
 * Route Reflector Lab · Learn — six levels:
 *   1 Why iBGP needs a mesh · 2 A route reflector · 3 Who hears what · 4 Loop prevention · 5 Next hops and best paths ·
 *   6 Read the evidence
 */

const B = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;
const M = ({ children }: { children: ReactNode }) => <span className="pv-mono text-pv-text">{children}</span>;
const nb = (dev: RrDev, ip: string, f: (n: RrCfg["nbrs"][number]) => void) => ({ dev, f: (c: RrCfg) => void f(c.nbrs.find((x) => x.ip === ip)!) });
const mesh: RrAction = { type: "boot", design: "mesh" };
const ping = (from: "CE1" | "CE2" | "CE3" | "CE4", dst: string): RrAction => ({ type: "test", from, dst });
const noPe1Pe3: RrAction = {
  type: "set",
  text: "The PE1–PE3 session is removed (both ends)",
  changes: [
    { dev: "PE1", f: (c) => void (c.nbrs = c.nbrs.filter((x) => x.ip !== RR_LO.PE3)) },
    { dev: "PE3", f: (c) => void (c.nbrs = c.nbrs.filter((x) => x.ip !== RR_LO.PE1)) },
  ],
};

export const RR_LEVELS: SpLevel<RrAction>[] = [
  {
    n: 1,
    title: "Why iBGP needs a mesh",
    idea: "A router never passes an iBGP-learned route to another iBGP peer — so every PE must talk to every other PE.",
    steps: [
      {
        title: "Four PEs, one AS, a full mesh",
        body: (
          <>
            <p>
              PE1–PE4 each learn a customer prefix from their CE by eBGP. Inside AS 65000 they exchange those routes by <B>iBGP</B>, between loopbacks. Watch the classic design come up: every PE peers with every other PE.
            </p>
          </>
        ),
        pre: [{ type: "down" }],
        runs: [{ label: "Start BGP as a full mesh", actions: [mesh] }],
        show: ["sessions", "count"],
      },
      {
        title: "The rule that forces the mesh",
        body: <p>Remove one session — PE1–PE3. PE2 still hears 10.1.1.0/24 from PE1 and still peers with PE3, yet PE3 loses the route: an iBGP speaker <B>never re-advertises an iBGP-learned route to another iBGP peer</B> (iBGP split horizon). It&apos;s how iBGP avoids loops without an AS path to check.</p>,
        pre: [mesh],
        runs: [{ label: "Remove PE1–PE3, then ping CE1's network from CE3", actions: [noPe1Pe3, ping("CE3", "10.1.1.10")] }],
        show: ["rib:PE3", "test"],
        check: { q: "With 50 PEs in a full mesh, how many iBGP sessions are there?", options: [{ id: "a", label: "1225 — n(n−1)/2" }, { id: "b", label: "50" }, { id: "c", label: "100" }], answer: "a", why: "Every pair needs its own session: 50 × 49 / 2 = 1225. Every new PE adds a session on every existing PE." },
      },
    ],
  },
  {
    n: 2,
    title: "A route reflector",
    idea: "A reflector is allowed to pass routes between its clients — and marks every reflected route.",
    steps: [
      {
        title: "Two reflectors, two clusters",
        body: (
          <>
            <p>
              Now the design of this lab: <B>RR1</B> serves PE1 and PE2, <B>RR2</B> serves PE3 and PE4, and the two reflectors peer with each other as ordinary (non-client) iBGP neighbors. Each PE has one session instead of three; the reflectors have three each.
            </p>
          </>
        ),
        pre: [{ type: "down" }],
        runs: [{ label: "Start BGP with route reflectors", actions: [{ type: "boot", design: "rr" }] }],
        show: ["sessions", "count"],
      },
      {
        title: "What a reflected route carries",
        body: (
          <>
            <p>
              PE2 receives 10.1.1.0/24 from RR1. RR1 added two attributes: <B>ORIGINATOR_ID</B> <M>1.1.1.1</M> (who injected the route into the AS) and a <B>CLUSTER_LIST</B> with RR1&apos;s cluster ID <M>{RR_CLUSTER.RR1}</M>. The next hop is still PE1 (1.1.1.1): a reflector forwards no traffic and never puts itself in the path.
            </p>
          </>
        ),
        show: ["path:PE2:10.1.1.0/24", "path:PE4:10.1.1.0/24"],
      },
    ],
  },
  {
    n: 3,
    title: "Who hears what",
    idea: "From a client → to everyone. From a non-client → to clients only. Never back to the sender.",
    steps: [
      {
        title: "The reflection rules, on this network",
        body: <p>Follow 10.1.1.0/24: PE1 (client) → RR1 reflects to PE2 (client) and RR2 (non-client). RR2 learned it from a <B>non-client</B>, so it reflects to its <B>clients</B> PE3 and PE4 only. Nobody sends it back to PE1.</p>,
        show: ["rules"],
      },
      {
        title: "Downgrade PE3 to a non-client",
        body: <p>This is the guided lesson&apos;s fault: on RR2, PE3 stays a neighbor but is no longer a client. The session stays Established — and PE3 stops receiving everything RR2 learned from RR1, because non-client routes are reflected to clients only.</p>,
        runs: [{ label: "PE3 becomes a non-client of RR2", actions: [{ type: "set", text: "RR2: PE3 is no longer a route-reflector client", changes: [nb("RR2", RR_LO.PE3, (x) => (x.client = false))] }, ping("CE3", "10.1.1.10")] }],
        show: ["rib:PE3", "test"],
        check: { q: "PE3's session to RR2 is Established, yet 10.1.1.0/24 is missing. What decides it?", options: [{ id: "a", label: "RR2 learned the route from a non-client (RR1) and reflects such routes to clients only" }, { id: "b", label: "PE3's session is too new" }, { id: "c", label: "RR1 filters it" }], answer: "a", why: "Session state says nothing about which routes a reflector may send. Client vs non-client decides." },
      },
    ],
  },
  {
    n: 4,
    title: "Loop prevention",
    idea: "ORIGINATOR_ID and CLUSTER_LIST stop reflected routes from coming back.",
    steps: [
      {
        title: "Two marks on every reflected route",
        body: <p>A router drops a route carrying its <B>own router ID as ORIGINATOR_ID</B>; a reflector drops a route whose <B>CLUSTER_LIST already contains its own cluster ID</B>. PE4&apos;s copy of 10.1.1.0/24 has passed two clusters: its list is 200.200.200.200, 100.100.100.100.</p>,
        show: ["path:PE4:10.1.1.0/24"],
      },
      {
        title: "Same cluster ID on both reflectors",
        body: <p>Give RR2 RR1&apos;s cluster ID by mistake. Every route RR1 reflects now arrives at RR2 with a CLUSTER_LIST that already contains RR2&apos;s &quot;own&quot; cluster ID — and RR2 drops it as a loop. Sessions stay up; routes vanish.</p>,
        runs: [{ label: "RR2 cluster-id 100.100.100.100", actions: [{ type: "set", text: "RR2: cluster-id 100.100.100.100 (RR1's)", changes: [{ dev: "RR2", f: (c) => void (c.cluster = RR_CLUSTER.RR1) }] }] }],
        show: ["drops", "rib:PE4"],
      },
    ],
  },
  {
    n: 5,
    title: "Next hops and best paths",
    idea: "A reflector reflects only its own best path — and only one it can use.",
    steps: [
      {
        title: "A next hop nobody can reach",
        body: <p>PE2 stops setting <M>next-hop-self</M>: 10.2.2.0/24 reaches RR1 with next hop 172.16.2.2, CE2&apos;s address on a link that isn&apos;t in the IGP. RR1 can&apos;t resolve it, so the path is never best — and a reflector only reflects its best path. Nobody else receives it.</p>,
        runs: [{ label: "PE2 without next-hop-self", actions: [{ type: "set", text: "PE2: next-hop-self removed toward RR1", changes: [nb("PE2", RR_LO.RR1, (x) => (x.nhs = false))] }] }],
        show: ["path:RR1:10.2.2.0/24", "rib:PE1"],
      },
      {
        title: "One prefix, two exits",
        body: <p>CE1 and CE4 both announce 10.9.9.0/24. Each router picks one best path; each reflector reflects only <B>its</B> best. RR1 is closer to PE1, RR2 to PE4 — so PE2 exits via PE1 and PE3 via PE4, chosen from the reflector&apos;s position, not the client&apos;s. That is the price of reflection: clients only see what their reflector chose.</p>,
        show: ["best:10.9.9.0/24"],
      },
    ],
  },
  {
    n: 6,
    title: "Read the evidence",
    idea: "Sessions → who is missing what → unusable paths → loop drops → policies.",
    steps: [
      {
        title: "An island",
        body: <p>A neighbor address was mistyped on RR2. Run the test, then walk the ladder.</p>,
        pre: [{ type: "set", text: "RR2: neighbor 6.6.6.6 typed as 6.6.6.7", changes: [nb("RR2", RR_LO.PE4, (x) => (x.ip = "6.6.6.7"))] }],
        runs: [{ label: "ping CE4's network from CE3", actions: [ping("CE3", "10.4.4.10")] }],
        show: ["ladder"],
      },
      {
        title: "One prefix missing",
        body: <p>RR1 now has an outbound policy toward RR2 that permits only two prefixes. Sessions are fine; one prefix never crosses.</p>,
        pre: [{ type: "set", text: "RR1: outbound policy toward RR2 permits 10.1.1.0/24 and 10.9.9.0/24", changes: [{ dev: "RR1", f: (c) => void ((c.sets["RR1-TO-RR2"] = ["10.1.1.0/24", "10.9.9.0/24"]), (c.nbrs.find((x) => x.ip === RR_LO.RR2)!.policy = "RR1-TO-RR2")) }] }],
        runs: [{ label: "ping CE2's network from CE3", actions: [ping("CE3", "10.2.2.10")] }],
        show: ["ladder"],
      },
    ],
  },
];
