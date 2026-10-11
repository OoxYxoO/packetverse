import type { ReactNode } from "react";
import { HOST_IP, osClone, osHealthy, type OsAction, type OsCfg, type OsHost } from "@/lib/sim-engine/scenarios/ospfNet";

/**
 * Learn track of the OSPF Lab: six levels on the lesson's diamond (R1–R4, costs 10/10/20/5) with a LAN behind every
 * router. A step starts from a known network (its `pre` actions are replayed silently through the model), then the
 * learner runs its traffic, Hellos or flood. The questions: who are my neighbors, does everyone have the same map,
 * what did SPF choose — and what does the router actually use?
 */
export type OsShow = "adj" | "spf" | "path" | "journey";
export interface OsStepRun {
  label: string;
  actions: OsAction[];
  keep?: boolean;
}
export interface OsCheck {
  q: string;
  options: { id: string; label: string }[];
  answer: string;
  why: string;
}
export interface OsStep {
  title: string;
  body: ReactNode;
  pre?: OsAction[];
  runs?: OsStepRun[];
  show: OsShow[];
  check?: OsCheck;
}
export interface OsLevel {
  n: number;
  title: string;
  idea: string;
  steps: OsStep[];
}
const ping = (from: OsHost, to: OsHost): OsAction => ({ type: "traffic", sends: [{ from, to: HOST_IP[to], kind: "ping" }] });
const trace = (from: OsHost, to: OsHost): OsAction => ({ type: "traffic", sends: [{ from, to: HOST_IP[to], kind: "trace" }] });
const cfg = (text: string, f: (c: OsCfg) => void, base: OsCfg = osHealthy()): OsAction => {
  const c = osClone(base);
  f(c);
  return { type: "cfg", cfg: c, text };
};
const B = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;
const M = ({ children }: { children: ReactNode }) => <span className="pv-mono text-pv-text">{children}</span>;

export const OS_LEVELS: OsLevel[] = [
  {
    n: 1,
    title: "Routers that talk to each other",
    idea: "Static routes are typed by hand and never react. OSPF routers discover their neighbors, share a map, and compute their own routes.",
    steps: [
      {
        title: "Four routers, four LANs",
        body: (
          <>
            <p>In the Routing lesson, R1 only knew what an engineer typed. Here R1–R4 run <B>OSPF</B> in area 0. Each has a LAN with one host. Nobody typed a route to another LAN — yet every router has one.</p>
            <p>Start with the neighbors: every link shows <B>FULL</B> — the two routers on it are fully synchronized.</p>
          </>
        ),
        show: ["adj", "path"],
      },
      {
        title: "Hellos",
        body: (
          <>
            <p>Every 10 s each OSPF interface sends a <B>Hello</B> to <M>224.0.0.5</M>: “I am router 1.1.1.1, area 0, hello 10 s, dead 40 s — and I hear 2.2.2.2.” A neighbor that sees its own router ID in your Hello knows the link works both ways.</p>
          </>
        ),
        runs: [{ label: "Send Hellos", actions: [{ type: "hello" }] }],
        show: ["journey", "adj"],
      },
      {
        title: "H1 reaches H4",
        body: (
          <>
            <p>H1 sends to its gateway R1; R1 looks up <M>192.168.4.0/24</M> — an <B>OSPF</B> route — and forwards; so do R2 and R4. Three routers, TTL 64 → 61 on arrival.</p>
          </>
        ),
        runs: [{ label: "H1 traceroutes H4", actions: [trace("H1", "H4")] }],
        show: ["journey", "path"],
      },
    ],
  },
  {
    n: 2,
    title: "Becoming neighbors",
    idea: "Two routers become neighbors only if both run OSPF on the link, neither is passive, and they agree on area and timers.",
    steps: [
      {
        title: "An area mismatch",
        body: (
          <>
            <p>R2&apos;s interface toward R1 is put in <B>area 1</B>. Every Hello carries the area ID; each side discards the other&apos;s Hellos. R1–R2 never comes up — and H1 → H4 takes the only path left, through R3.</p>
          </>
        ),
        pre: [cfg("R2 ge-0/0/1 → area 1", (c) => (c.r.R2.ifs["ge-0/0/1"].area = 1))],
        runs: [
          { label: "Send Hellos", actions: [{ type: "hello" }] },
          { label: "H1 traceroutes H4", actions: [trace("H1", "H4")] },
        ],
        show: ["journey", "adj"],
      },
      {
        title: "Passive interfaces",
        body: (
          <>
            <p>The LAN interfaces are <B>passive</B>: their subnet is advertised, but no Hellos are sent there — no router lives on a LAN. Make an interface toward a router passive by mistake and that neighborship disappears: here R1&apos;s toward R2.</p>
          </>
        ),
        pre: [cfg("R1 ge-0/0/1 passive", (c) => (c.r.R1.ifs["ge-0/0/1"].passive = true))],
        runs: [{ label: "Send Hellos", actions: [{ type: "hello" }] }],
        show: ["adj", "journey"],
        check: {
          q: "Why are the LAN interfaces passive?",
          options: [
            { id: "adv", label: "To advertise the LAN's subnet without sending Hellos to hosts that never answer" },
            { id: "hide", label: "To hide the LAN from the other routers" },
            { id: "fast", label: "To make OSPF converge faster" },
          ],
          answer: "adv",
          why: "Passive keeps the subnet in the router's LSA (so others can reach it) but sends no OSPF packets where no neighbor should exist.",
        },
      },
    ],
  },
  {
    n: 3,
    title: "One map for everyone",
    idea: "Each router describes its own links in a Router-LSA and floods it. Every router in the area ends up with the same database — the map.",
    steps: [
      {
        title: "The link-state database",
        body: (
          <>
            <p>Each router originates one <B>Router-LSA</B>: its FULL neighbors (with its own cost toward each) and its networks (LAN, link subnets, loopback). R1 holds all four LSAs — and so do R2, R3 and R4: the same map everywhere.</p>
          </>
        ),
        show: ["spf", "adj"],
      },
      {
        title: "A change floods",
        body: (
          <>
            <p>The R2–R4 link is cut. R2 and R4 change their LSAs (new sequence numbers) and <B>flood</B> them: each router that gets a newer LSA installs it, acknowledges it, passes it on to its other neighbors — and runs SPF again.</p>
          </>
        ),
        pre: [{ type: "link", link: "L24", up: false }],
        runs: [{ label: "Show R4's LSA flooding", actions: [{ type: "flood", origin: "R4" }] }],
        show: ["journey", "spf"],
      },
    ],
  },
  {
    n: 4,
    title: "Each router computes its own paths",
    idea: "Every router runs SPF (Dijkstra) on the shared map from its own position: the cheapest total cost wins.",
    steps: [
      {
        title: "Costs add up",
        body: (
          <>
            <p>From R1 to R4: via R2 = 10 + 10 = <B>20</B>, via R3 = 20 + 5 = <B>25</B>. R1 picks R2. The cost that counts is the one of each interface the path <B>leaves</B> through.</p>
          </>
        ),
        runs: [{ label: "H1 traceroutes H4", actions: [trace("H1", "H4")] }],
        show: ["spf", "path"],
      },
      {
        title: "Change one cost",
        body: (
          <>
            <p>R1&apos;s interface toward R2 now costs <M>100</M>: via R2 = 110, via R3 = 25. SPF re-runs and R1 sends H4&apos;s traffic through R3. The way back is R4&apos;s own decision — it didn&apos;t change.</p>
          </>
        ),
        pre: [cfg("R1 ge-0/0/1 cost 100", (c) => (c.r.R1.ifs["ge-0/0/1"].cost = 100))],
        runs: [{ label: "H1 traceroutes H4, H4 traceroutes H1", actions: [{ type: "traffic", sends: [{ from: "H1", to: HOST_IP.H4, kind: "trace" }, { from: "H4", to: HOST_IP.H1, kind: "trace" }] }] }],
        show: ["journey", "spf"],
      },
      {
        title: "Equal costs: two paths",
        body: (
          <>
            <p>With R1&apos;s interface toward R3 at cost <M>15</M>, both paths to R4 cost 20. OSPF installs <B>both</B> next hops (ECMP) and flows are spread over them.</p>
          </>
        ),
        pre: [cfg("R1 ge-0/0/2 cost 15", (c) => (c.r.R1.ifs["ge-0/0/2"].cost = 15))],
        show: ["path", "spf"],
        check: {
          q: "R1's interface toward R2 costs 100, R2's toward R1 still 10. Which way does traffic from H2 to H1 go?",
          options: [
            { id: "direct", label: "R2 → R1 directly: R2's own cost toward R1 is still 10" },
            { id: "via3", label: "Through R4 and R3, like H1 → H4" },
            { id: "none", label: "It can't: the link is now too expensive" },
          ],
          answer: "direct",
          why: "Costs are per interface, so per direction. R2 computes its own paths with its own outgoing costs; asymmetric paths are normal in OSPF.",
        },
      },
    ],
  },
  {
    n: 5,
    title: "When something fails",
    idea: "A link that goes down is noticed at once. A neighbor that goes silent is only declared dead after the dead interval.",
    steps: [
      {
        title: "Cut a link",
        body: (
          <>
            <p>R2–R4 goes down. Both routers drop the neighbor immediately, flood new LSAs, and everyone runs SPF: H1 → H4 now goes through R3 — at once.</p>
          </>
        ),
        pre: [trace("H1", "H4")],
        runs: [{ label: "Cut R2–R4, then H1 traceroutes H4", actions: [{ type: "link", link: "L24", up: false }, trace("H1", "H4")] }],
        show: ["journey", "adj"],
      },
      {
        title: "A silent failure: the dead interval",
        body: (
          <>
            <p>This time the R2–R4 link stays <B>up</B> but packets stop getting through. The routers keep the neighbor until no Hello has arrived for <B>40 s</B> (the dead interval) — until then R1 keeps sending H4&apos;s traffic into the dead link.</p>
          </>
        ),
        runs: [
          { label: "Fail R2–R4 silently, H1 pings H4", actions: [{ type: "silent", link: "L24", on: true }, ping("H1", "H4")] },
          { label: "Wait 40 s, ping again", keep: true, actions: [{ type: "wait", seconds: 40 }, ping("H1", "H4")] },
        ],
        show: ["adj", "journey"],
        check: {
          q: "How could the network notice such a failure faster?",
          options: [
            { id: "timers", label: "Shorter hello/dead intervals (or BFD) on both ends" },
            { id: "cost", label: "A lower cost on the link" },
            { id: "area", label: "Putting the link in another area" },
          ],
          answer: "timers",
          why: "Detection of a silent neighbor is the dead interval. Shorter timers (matching on both ends) or BFD detect it in a second or less.",
        },
      },
    ],
  },
  {
    n: 6,
    title: "What the router actually uses",
    idea: "OSPF fills the routing table — but a LAN must be advertised, adjacencies must reach FULL, and a static route beats OSPF.",
    steps: [
      {
        title: "A LAN that isn't advertised",
        body: (
          <>
            <p>R4&apos;s LAN interface is taken out of OSPF. R4&apos;s neighbors are all FULL — but its LSA no longer lists <M>192.168.4.0/24</M>, so no router has a route to H4.</p>
          </>
        ),
        pre: [cfg("R4 ge-0/0/0 out of OSPF", (c) => (c.r.R4.ifs["ge-0/0/0"].ospf = false))],
        runs: [{ label: "H1 pings H4", actions: [ping("H1", "H4")] }],
        show: ["path", "journey"],
      },
      {
        title: "Stuck in EXSTART: the MTU",
        body: (
          <>
            <p>R4&apos;s interface toward R2 has MTU <M>1400</M>, R2&apos;s <M>1500</M>. Hellos pass (they don&apos;t check MTU), so they see each other — but each refuses the other&apos;s database description packets. Stuck in <B>EXSTART</B>, never FULL, never used.</p>
          </>
        ),
        pre: [cfg("R4 ge-0/0/1 MTU 1400", (c) => (c.r.R4.ifs["ge-0/0/1"].mtu = 1400))],
        runs: [{ label: "Send Hellos, then H1 traceroutes H4", actions: [{ type: "hello" }, trace("H1", "H4")] }],
        show: ["adj", "journey"],
      },
      {
        title: "A static route beats OSPF",
        body: (
          <>
            <p>A forgotten static route on R1 sends <M>192.168.4.0/24</M> to R3. Static has administrative distance <B>1</B>, OSPF <B>110</B>: R1 uses the static and keeps the OSPF route unused. When R3–R4 fails, R3 bounces the traffic back — a routing loop.</p>
          </>
        ),
        pre: [cfg("R1: ip route 192.168.4.0/24 via 10.0.13.2", (c) => c.r.R1.statics.push({ prefix: "192.168.4.0", len: 24, nh: "10.0.13.2" }))],
        runs: [
          { label: "H1 traceroutes H4", actions: [trace("H1", "H4")] },
          { label: "Cut R3–R4, then H1 pings H4", actions: [{ type: "link", link: "L34", up: false }, ping("H1", "H4")] },
        ],
        show: ["path", "journey"],
        check: {
          q: "OSPF has a perfectly good route to 192.168.4.0/24 via R2. Why doesn't R1 use it?",
          options: [
            { id: "ad", label: "A static route for the same prefix has a lower administrative distance (1 < 110)" },
            { id: "cost", label: "The static route is cheaper" },
            { id: "newer", label: "The static route was configured more recently" },
          ],
          answer: "ad",
          why: "Between sources for the same prefix, the router trusts the lowest administrative distance. Metrics only compare routes from the same source.",
        },
      },
    ],
  },
];
