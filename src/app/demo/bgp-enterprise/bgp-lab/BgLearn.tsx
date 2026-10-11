import type { ReactNode } from "react";
import { HOST_IP, bgClone, bgHealthy, type BgAction, type BgCfg, type BgHost } from "@/lib/sim-engine/scenarios/bgpNet";

/**
 * Learn track of the BGP Lab: six levels on the lesson's network — our AS65001 (R1, R2) dual-homed to ISP-A (AS65010)
 * and ISP-B (AS65020), both reaching AS65030 where SRV lives. A step starts from a known network (its `pre` actions are
 * replayed silently through the model), then the learner runs its traffic or shows the UPDATEs. The questions: who
 * are my neighbors, what did each one announce, which path won and why — and which way does the internet come back?
 */
export type BgShow = "sess" | "paths" | "exits" | "adv" | "journey";
export interface BgStepRun {
  label: string;
  actions: BgAction[];
  keep?: boolean;
}
export interface BgCheck {
  q: string;
  options: { id: string; label: string }[];
  answer: string;
  why: string;
}
export interface BgStep {
  title: string;
  body: ReactNode;
  pre?: BgAction[];
  runs?: BgStepRun[];
  show: BgShow[];
  check?: BgCheck;
}
export interface BgLevel {
  n: number;
  title: string;
  idea: string;
  steps: BgStep[];
}
const ping = (from: BgHost, to: BgHost): BgAction => ({ type: "traffic", sends: [{ from, to: HOST_IP[to], kind: "ping" }] });
const trace = (from: BgHost, to: BgHost): BgAction => ({ type: "traffic", sends: [{ from, to: HOST_IP[to], kind: "trace" }] });
const cfg = (text: string, f: (c: BgCfg) => void, base: BgCfg = bgHealthy()): BgAction => {
  const c = bgClone(base);
  f(c);
  return { type: "cfg", cfg: c, text };
};
const B = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;
const M = ({ children }: { children: ReactNode }) => <span className="pv-mono text-pv-text">{children}</span>;

export const BG_LEVELS: BgLevel[] = [
  {
    n: 1,
    title: "Between organizations",
    idea: "OSPF finds the shortest path inside one network. Between networks owned by different organizations, BGP carries reachability plus policy: who may reach what, and through whom.",
    steps: [
      {
        title: "Three autonomous systems",
        body: (
          <>
            <p>Our company is <B>AS65001</B>: R1 and R2, with H1 and H2 behind them. We buy internet access from two providers: <B>ISP-A</B> (AS65010, the primary contract) and <B>ISP-B</B> (AS65020, metered backup). The server SRV lives in <B>AS65030</B>.</p>
            <p>Nobody shares a link-state map across these borders — each AS keeps its inside private. BGP only tells neighbors “I can reach this prefix, through these ASes”.</p>
            <p>One difference from the guided lesson: here ISP-B reaches AS65030 directly, so both exits are equally long — the AS_PATH alone can&apos;t choose, policy has to.</p>
          </>
        ),
        show: ["sess", "exits"],
      },
      {
        title: "H1 reaches SRV",
        body: (
          <>
            <p>H1 → R1 → R3 (ISP-A) → R5 → SRV. Each router forwards on a <B>BGP route</B> for <M>203.0.113.0/24</M> — learned from a neighbor, not typed by hand.</p>
          </>
        ),
        runs: [{ label: "H1 traceroutes SRV", actions: [trace("H1", "SRV")] }],
        show: ["journey", "exits"],
      },
      {
        title: "The way back is someone else's choice",
        body: (
          <>
            <p>We decide how we <B>leave</B>. How traffic <B>comes back</B> is decided by the other ASes — from what we announce to them. Here AS65030 sends replies back through ISP-A as well. Level 6 shows how we influence that.</p>
          </>
        ),
        runs: [{ label: "SRV traceroutes H2", actions: [trace("SRV", "H2")] }],
        show: ["journey", "exits"],
        check: {
          q: "Who decides which ISP the replies from SRV use to reach us?",
          options: [
            { id: "them", label: "The other ASes, based on what we announce to them" },
            { id: "us", label: "Our routers R1 and R2, with LOCAL_PREF" },
            { id: "ospf", label: "OSPF, by comparing costs" },
          ],
          answer: "them",
          why: "Every AS chooses its own best path. We can only shape their choice through the routes we announce (AS_PATH prepending, for example) — LOCAL_PREF only affects our own exit.",
        },
      },
    ],
  },
  {
    n: 2,
    title: "Sessions between ASes",
    idea: "Two BGP routers become neighbors over TCP port 179. Each side configures the other's address and AS number; the OPEN messages must match, or the session never comes up.",
    steps: [
      {
        title: "Neighbors are configured, not discovered",
        body: (
          <>
            <p>Unlike OSPF Hellos, BGP never discovers anybody. R1 has <M>neighbor 192.0.2.2 remote-as 65010</M>; R3 has the mirror statement for R1. Both open a TCP session and send an <B>OPEN</B>: “I am AS65001, router ID 1.1.1.1”. When both agree, the session is <B>Established</B> and they exchange routes.</p>
            <p>Five sessions: three eBGP (between different ASes), the ISPs&apos; own to AS65030, and one <B>iBGP</B> between R1 and R2 (same AS).</p>
          </>
        ),
        show: ["sess"],
      },
      {
        title: "A wrong remote AS",
        body: (
          <>
            <p>Someone typed <M>neighbor 198.51.100.2 remote-as 65200</M> on R2 — ISP-B is <B>65020</B>. R4&apos;s OPEN says 65020, R2 expected 65200: R2 answers with a NOTIFICATION (bad peer AS) and the session sits in <B>Active</B>, retrying forever.</p>
            <p>Nobody notices: H2 still reaches SRV — through R1 and ISP-A, as designed.</p>
          </>
        ),
        pre: [cfg("R2: neighbor 198.51.100.2 remote-as 65200", (c) => (c.r.R2.nbrs["R2-R4"]!.remoteAs = 65200))],
        runs: [{ label: "H2 pings SRV", actions: [ping("H2", "SRV")] }],
        show: ["sess", "journey"],
      },
      {
        title: "…until the primary fails",
        body: (
          <>
            <p>Now ISP-A&apos;s link goes down. The backup should take over — but R2 never learned anything from ISP-B. No path to SRV anywhere in our AS: the whole office is offline.</p>
          </>
        ),
        pre: [cfg("R2: neighbor 198.51.100.2 remote-as 65200", (c) => (c.r.R2.nbrs["R2-R4"]!.remoteAs = 65200))],
        runs: [{ label: "Cut ISP-A's link, then H1 pings SRV", actions: [{ type: "link", link: "L13", up: false }, ping("H1", "SRV")] }],
        show: ["sess", "journey"],
        check: {
          q: "show ip bgp summary shows ISP-B's neighbor in state “Active”. What does that mean?",
          options: [
            { id: "down", label: "The session is NOT up: the router keeps trying to connect" },
            { id: "up", label: "The session is up and actively exchanging routes" },
            { id: "backup", label: "The session is the active backup" },
          ],
          answer: "down",
          why: "Despite its name, Active is a failure state: the router is actively trying to open the session. Up is shown as a number of prefixes (Cisco) or “Establ” (Junos).",
        },
      },
    ],
  },
  {
    n: 3,
    title: "Announcing prefixes",
    idea: "Over an Established session, routers send UPDATEs: a prefix plus attributes. AS_PATH records every AS the route crossed; a router that finds its own AS in it drops the route.",
    steps: [
      {
        title: "The UPDATEs",
        body: (
          <>
            <p>R5 announces <M>203.0.113.0/24</M> to both ISPs with an empty AS_PATH. ISP-A passes it to R1 as <M>65010 65030</M>: each eBGP hop <B>prepends its own AS</B>. In the other direction R1 announces our <M>192.0.2.128/26</M> to ISP-A as <M>65001</M>.</p>
          </>
        ),
        runs: [{ label: "Show the UPDATEs", actions: [{ type: "updates" }] }],
        show: ["journey", "adv"],
      },
      {
        title: "Loop prevention",
        body: (
          <>
            <p>ISP-A also offers 203.0.113.0/24 back to R5 — with AS_PATH <M>65010 65030</M>. R5 sees <B>its own AS</B> in the path and drops it. That simple rule is how BGP avoids loops between ASes, without any map.</p>
            <p>Look for the line “my own AS … is in the AS_PATH → dropped” in the last wave.</p>
          </>
        ),
        runs: [{ label: "Show the UPDATEs", actions: [{ type: "updates" }] }],
        show: ["journey"],
      },
      {
        title: "Several paths, one best",
        body: (
          <>
            <p>R2 now holds <B>two paths</B> to 203.0.113.0/24: one from ISP-B (eBGP), one from R1 over iBGP. BGP keeps both, but marks only one as <B>best</B> — and only the best goes into the routing table and gets announced onward.</p>
          </>
        ),
        show: ["paths"],
        check: {
          q: "R5 receives 203.0.113.0/24 from ISP-A with AS_PATH 65010 65030. Why does it drop it?",
          options: [
            { id: "loop", label: "Its own AS 65030 is in the AS_PATH: accepting it would create a loop" },
            { id: "long", label: "The path is longer than its own" },
            { id: "lp", label: "Its LOCAL_PREF is too low" },
          ],
          answer: "loop",
          why: "eBGP loop prevention: a route carrying the receiver's own AS has already been through it.",
        },
      },
    ],
  },
  {
    n: 4,
    title: "Choosing the best path",
    idea: "BGP compares paths in a fixed order: next hop reachable, highest LOCAL_PREF, shortest AS_PATH, … eBGP over iBGP, lowest router ID. The first difference decides.",
    steps: [
      {
        title: "LOCAL_PREF picks our exit",
        body: (
          <>
            <p>R1 applies <M>route-map LP200 in</M> on ISP-A: every route learned from ISP-A gets <B>LOCAL_PREF 200</B> (default 100). R1 passes it to R2 over iBGP with that value. R2 compares: via R1 LOCAL_PREF 200, via ISP-B LOCAL_PREF 100 — <B>200 wins</B> before anything else is looked at.</p>
          </>
        ),
        runs: [{ label: "H2 traceroutes SRV", actions: [trace("H2", "SRV")] }],
        show: ["paths", "journey"],
      },
      {
        title: "Without it",
        body: (
          <>
            <p>Remove LP200. Both paths now have LOCAL_PREF 100 and the same AS_PATH length (2). The next step that differs: <B>eBGP over iBGP</B> — R2 prefers its own ISP-B route. H2 leaves through the metered backup.</p>
          </>
        ),
        pre: [cfg("R1: no neighbor 192.0.2.2 route-map LP200 in", (c) => delete c.r.R1.nbrs["R1-R3"]!.lpIn)],
        runs: [{ label: "H2 traceroutes SRV", actions: [trace("H2", "SRV")] }],
        show: ["paths", "journey"],
      },
      {
        title: "Failover",
        body: (
          <>
            <p>With the design restored, cut ISP-A&apos;s link. R1 loses its ISP-A path and withdraws it; R2&apos;s ISP-B path becomes best, and R2 announces it to R1. H1 now leaves via R1 → R2 → ISP-B. Restore the link and ISP-A wins again.</p>
          </>
        ),
        runs: [
          { label: "Cut ISP-A's link, then H1 traceroutes SRV", actions: [{ type: "link", link: "L13", up: false }, trace("H1", "SRV")] },
          { label: "Restore it, then H1 traceroutes SRV", actions: [{ type: "link", link: "L13", up: true }, trace("H1", "SRV")], keep: true },
        ],
        show: ["exits", "journey"],
        check: {
          q: "R2 has two paths: via R1 (LOCAL_PREF 200, AS_PATH 65010 65030) and via ISP-B (LOCAL_PREF 100, AS_PATH 65020 65030). Which wins, and why?",
          options: [
            { id: "lp", label: "Via R1: highest LOCAL_PREF is compared before anything else" },
            { id: "ebgp", label: "Via ISP-B: eBGP is preferred over iBGP" },
            { id: "rid", label: "Via R1: it has the lower router ID" },
          ],
          answer: "lp",
          why: "LOCAL_PREF comes before AS_PATH length and long before eBGP-over-iBGP. Those only matter when LOCAL_PREF is equal.",
        },
      },
    ],
  },
  {
    n: 5,
    title: "Inside our AS: iBGP",
    idea: "iBGP carries the routes learned from ISPs between our own routers, with their attributes. It keeps the next hop unchanged — unless next-hop-self says otherwise.",
    steps: [
      {
        title: "What iBGP carries",
        body: (
          <>
            <p>R1 sends R2 the ISP-A route with LOCAL_PREF 200 and AS_PATH <M>65010 65030</M> — unchanged: iBGP adds no AS. Because R1 has <M>next-hop-self</M>, the next hop is <M>10.0.12.1</M> (R1 itself), an address R2 can reach.</p>
            <p>iBGP <B>split horizon</B>: R2 never passes an iBGP-learned route to another iBGP neighbor.</p>
          </>
        ),
        runs: [{ label: "Show the UPDATEs", actions: [{ type: "updates" }] }],
        show: ["adv", "journey"],
      },
      {
        title: "Without next-hop-self",
        body: (
          <>
            <p>Remove next-hop-self on R1. The route now reaches R2 with next hop <M>192.0.2.2</M> — ISP-A&apos;s address on the R1–R3 link. R2 has <B>no route</B> to that /30: the path is “inaccessible” and ignored. R2 falls back to ISP-B — the session is up, the route is there, and yet it isn&apos;t used.</p>
          </>
        ),
        pre: [cfg("R1: no neighbor 10.0.12.2 next-hop-self", (c) => (c.r.R1.nbrs["R1-R2"]!.nhs = false))],
        runs: [{ label: "H2 traceroutes SRV", actions: [trace("H2", "SRV")] }],
        show: ["paths", "journey"],
      },
      {
        title: "What the router uses",
        body: (
          <>
            <p>Only the <B>best, valid</B> BGP path goes into the routing table. On Cisco an eBGP route has administrative distance <B>20</B>, an iBGP route <B>200</B>; Junos gives BGP preference 170. Open R2 → Routes: <M>203.0.113.0/24</M> via 10.0.12.1, iBGP.</p>
          </>
        ),
        show: ["paths", "exits"],
        check: {
          q: "R2's path via R1 shows next hop 192.0.2.2 (inaccessible). What is the fix?",
          options: [
            { id: "nhs", label: "next-hop-self on R1 toward R2 (or carry the ISP link in the IGP)" },
            { id: "lp", label: "Raise LOCAL_PREF on R2" },
            { id: "as", label: "Change R2's remote-as for R1" },
          ],
          answer: "nhs",
          why: "BGP needs to resolve the next hop. With next-hop-self, R1 replaces the ISP's address with its own — which R2 reaches directly.",
        },
      },
    ],
  },
  {
    n: 6,
    title: "The way in, and what we announce",
    idea: "We can't set other ASes' LOCAL_PREF — but we can make a path look longer (AS-path prepending). And we must announce only what is ours: anything else turns us into transit.",
    steps: [
      {
        title: "Prepending on the backup",
        body: (
          <>
            <p>R2 announces our prefixes to ISP-B as <M>65001 65001 65001</M> (route-map PREPEND out). AS65030 sees our prefixes as 2 ASes away through ISP-A and 4 through ISP-B — and sends its traffic back through ISP-A.</p>
          </>
        ),
        runs: [{ label: "SRV traceroutes H2", actions: [trace("SRV", "H2")] }],
        show: ["exits", "journey"],
      },
      {
        title: "Prepending on the wrong router",
        body: (
          <>
            <p>Move the prepend to R1 (toward ISP-A). Now the path through ISP-A is the long one: replies come back through ISP-B — while our outbound traffic still uses ISP-A. <B>Asymmetric routing</B>, and the metered link carries the downloads.</p>
          </>
        ),
        pre: [
          cfg("PREPEND moved from R2 → ISP-B to R1 → ISP-A", (c) => {
            c.r.R2.nbrs["R2-R4"]!.prepend = 0;
            c.r.R1.nbrs["R1-R3"]!.prepend = 2;
          }),
        ],
        runs: [{ label: "SRV traceroutes H1", actions: [trace("SRV", "H1")] }],
        show: ["exits", "journey"],
      },
      {
        title: "Announce only what is ours",
        body: (
          <>
            <p>R2&apos;s filter <M>prefix-list OWN out</M> lets only our two /26s out to ISP-B. Remove it: R2 also offers ISP-B the 203.0.113.0/24 it learned from R1 — which came from ISP-A. We&apos;d be advertising a path <B>between our two ISPs</B> through our office: a route leak.</p>
          </>
        ),
        pre: [cfg("R2: no neighbor 198.51.100.2 prefix-list OWN out", (c) => (c.r.R2.nbrs["R2-R4"]!.ownOnly = false))],
        runs: [{ label: "Show the UPDATEs", actions: [{ type: "updates" }] }],
        show: ["adv", "journey"],
        check: {
          q: "Why must an enterprise filter what it announces to its ISPs?",
          options: [
            { id: "transit", label: "Without it, routes learned from one ISP go to the other: we offer transit between them" },
            { id: "speed", label: "Fewer prefixes make the session come up faster" },
            { id: "lp", label: "The ISP would otherwise ignore our LOCAL_PREF" },
          ],
          answer: "transit",
          why: "An enterprise is a stub: it announces its own prefixes only. A leaked route can pull other networks' traffic through a small office link.",
        },
      },
    ],
  },
];
