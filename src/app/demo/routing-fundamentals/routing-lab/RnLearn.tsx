import type { ReactNode } from "react";
import { rnClone, rnConnectedOnly, rnHealthy, rnTicketCfg, type RnAction, type RnCfg, type RnDev, type RnRouter } from "@/lib/sim-engine/scenarios/routeNet";

/**
 * Learn track of the Routing Lab: six levels on the same three-router network. A step starts from a known network
 * (its `start` configuration plus `pre` actions replayed silently through the model), then the learner runs the
 * step's traffic and watches every router decide. The question is always: for the packet THIS router holds, which
 * installed route contains the destination with the longest prefix — and can it be used?
 */

export type RnShow = "table-R1" | "table-R2" | "table-R3" | "resolution" | "explorer" | "explorer-predict" | "journey" | "verdict" | "outcomes" | "layers" | "capture-SERVER-A";
export interface RnStepRun {
  label: string;
  actions: RnAction[];
  keep?: boolean;
}
export interface RnCheck {
  q: string;
  options: { id: string; label: string }[];
  answer: string;
  why: string;
}
export interface RnStep {
  title: string;
  body: ReactNode;
  start?: () => RnCfg;
  pre?: RnAction[];
  runs?: RnStepRun[];
  show: RnShow[];
  check?: RnCheck;
  /** Which router/destination the explorer opens on. */
  explore?: { r: RnRouter; dst: string };
}
export interface RnLevel {
  n: number;
  title: string;
  idea: string;
  steps: RnStep[];
}

const ping = (from: RnDev, dst: string): RnAction => ({ type: "ping", from, dst });
const withCfg = (base: () => RnCfg, f: (c: RnCfg) => void, text: string): RnAction => {
  const c = rnClone(base());
  f(c);
  return { type: "cfg", cfg: c, text };
};
const r1to50 = (c: RnCfg) => c.r.R1.statics.push({ prefix: "172.16.50.0", len: 24, nh: "10.0.12.2" });
const r2back = (c: RnCfg) => c.r.R2.statics.push({ prefix: "10.10.10.0", len: 24, nh: "10.0.12.1" });
const ADD_R1 = withCfg(rnConnectedOnly, r1to50, "R1: ip route 172.16.50.0 255.255.255.0 10.0.12.2");
const ADD_BOTH = withCfg(rnConnectedOnly, (c) => (r1to50(c), r2back(c)), "R2: ip route 10.10.10.0 255.255.255.0 10.0.12.1");
const ticket = (id: Parameters<typeof rnTicketCfg>[0], text: string): RnAction => ({ type: "cfg", cfg: rnTicketCfg(id), text });

const B = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;
const M = ({ children }: { children: ReactNode }) => <span className="pv-mono text-pv-text">{children}</span>;

export const RN_LEVELS: RnLevel[] = [
  {
    n: 1,
    title: "Connected networks",
    idea: "A router knows, by itself, only the networks on its own interfaces that are up.",
    steps: [
      {
        title: "Three routers, six networks",
        body: (
          <>
            <p>HOST-A is on 10.10.10.0/24 behind <B>R1</B>. The servers are on 172.16.50.0/24 behind <B>R2</B>; SERVER-C on 172.16.60.0/24 behind <B>R3</B>. Three small /30 networks join the routers to each other.</p>
            <p>Each interface that is configured and <B>up</B> gives its router a <B>connected route</B> (C) to the network it sits on — R1 has three, one per interface. Nobody typed them. That is all R1 knows: nothing about 172.16.x.x yet.</p>
          </>
        ),
        start: rnConnectedOnly,
        show: ["table-R1"],
      },
      {
        title: "A neighbor: connected is enough",
        body: (
          <>
            <p>R1 pings R2&apos;s address on their shared link, <M>10.0.12.2</M>. R1&apos;s lookup: the connected <M>10.0.12.0/30</M> contains it — out <M>ge-0/0/1</M>, straight to R2. R2 answers to <M>10.0.12.1</M>: also inside one of R2&apos;s connected networks. No route was typed, and it works both ways.</p>
          </>
        ),
        start: rnConnectedOnly,
        runs: [{ label: "R1 pings 10.0.12.2", actions: [ping("R1", "10.0.12.2")] }],
        show: ["journey", "verdict"],
      },
      {
        title: "A remote network: no route",
        body: (
          <>
            <p>HOST-A pings SERVER-A. HOST-A sends it to its gateway, R1. R1 looks up <M>172.16.50.50</M> in its table: none of its three connected routes contains it. <B>No route → R1 drops it</B> and tells HOST-A so with ICMP <i>Destination Net Unreachable</i>. Watch the strip under the topology: every route is checked, none matches.</p>
          </>
        ),
        start: rnConnectedOnly,
        runs: [{ label: "HOST-A pings SERVER-A", actions: [ping("HOST-A", "172.16.50.50")] }],
        show: ["verdict", "table-R1"],
      },
    ],
  },
  {
    n: 2,
    title: "Static route and next hop",
    idea: "A static route says: for this prefix, hand the packet to that neighbor — who must be reachable on a connected network.",
    steps: [
      {
        title: "Tell R1 where 172.16.50.0/24 is",
        body: (
          <>
            <p>An operator adds a <B>static route</B> on R1: destination <M>172.16.50.0/24</M>, next hop <M>10.0.12.2</M> (R2). In Cisco syntax: <M>ip route 172.16.50.0 255.255.255.0 10.0.12.2</M>. It appears as S in R1&apos;s table.</p>
          </>
        ),
        start: rnConnectedOnly,
        runs: [{ label: "Add the route on R1", actions: [ADD_R1] }],
        show: ["table-R1"],
      },
      {
        title: "“via 10.0.12.2” isn't the end of the decision",
        body: (
          <>
            <p>HOST-A pings SERVER-A again. R1&apos;s winner is the new static route — but a next hop is just an address. R1 must find <B>how to reach it</B>: 10.0.12.2 is inside its connected 10.0.12.0/30 → out ge-0/0/1 → ARP for 10.0.12.2 → R2&apos;s MAC → a new frame. The next-hop address is never written into the packet; the IP destination stays 172.16.50.50.</p>
            <p>Watch the request reach SERVER-A… then watch the reply.</p>
          </>
        ),
        start: rnConnectedOnly,
        pre: [ADD_R1],
        runs: [{ label: "HOST-A pings SERVER-A", actions: [ping("HOST-A", "172.16.50.50")] }],
        show: ["resolution", "verdict"],
      },
      {
        title: "A route in one direction is not enough",
        body: (
          <>
            <p>SERVER-A did receive the Echo Request and answered. The reply is a <B>new packet</B> to 10.10.10.10, and R2 looks it up in <B>its own</B> table — which has only its connected networks. No route: R2 drops the reply and sends Net Unreachable to SERVER-A. R1&apos;s route does nothing for packets R2 holds.</p>
          </>
        ),
        start: rnConnectedOnly,
        pre: [ADD_R1],
        runs: [{ label: "HOST-A pings SERVER-A", actions: [ping("HOST-A", "172.16.50.50")] }],
        show: ["journey"],
        check: { q: "Which router needs a route for the reply?", options: [{ id: "r2", label: "R2 — it holds the reply and must find 10.10.10.0/24" }, { id: "r1", label: "R1 — it should remember the request and send the reply back" }, { id: "srv", label: "SERVER-A — it needs a route to R1" }], answer: "r2", why: "Every router looks up the packet it has now. R2 receives the reply from SERVER-A and needs its own route to 10.10.10.0/24. Routers don't remember requests." },
      },
      {
        title: "Add the return route on R2",
        body: (
          <>
            <p>On R2: <M>10.10.10.0/24</M> via <M>10.0.12.1</M> (R1). Now each direction has its own route, on the router that holds the packet. Ping again: request and reply both make it.</p>
          </>
        ),
        start: rnConnectedOnly,
        pre: [ADD_R1],
        runs: [{ label: "Add the route on R2, then ping", actions: [ADD_BOTH, ping("HOST-A", "172.16.50.50")] }],
        show: ["verdict", "table-R2"],
      },
      {
        title: "A route that can't be used",
        body: (
          <>
            <p>Someone adds <M>172.16.60.0/24 via 10.0.23.2</M> on R1. But 10.0.23.2 is on the R2–R3 link — not inside any network R1 is connected to. R1 can&apos;t reach that next hop, so the route is <B>configured but not installed</B>: it shows grayed, with the reason, and is never used. A route existing is not a route working.</p>
          </>
        ),
        start: rnConnectedOnly,
        pre: [ADD_BOTH],
        runs: [{ label: "Add 172.16.60.0/24 via 10.0.23.2 on R1", actions: [withCfg(rnConnectedOnly, (c) => (r1to50(c), r2back(c), c.r.R1.statics.push({ prefix: "172.16.60.0", len: 24, nh: "10.0.23.2" })), "R1: ip route 172.16.60.0 255.255.255.0 10.0.23.2")] }],
        show: ["table-R1"],
      },
    ],
  },
  {
    n: 3,
    title: "Longest prefix match",
    idea: "Of all installed routes containing the destination, the router uses the most specific one — never “the first in the list”.",
    steps: [
      {
        title: "R1's real table",
        body: (
          <>
            <p>The finished network: R1 has <M>172.16.50.0/24</M> via R2, <M>172.16.0.0/16</M> via R3, and a default <M>0.0.0.0/0</M> via R3. These <B>overlap</B>: 172.16.50.50 is inside the /24, inside the /16, and inside the /0 — which contains everything.</p>
          </>
        ),
        show: ["table-R1"],
      },
      {
        title: "Predict R1's choice",
        body: <p>Pick a destination, then pick the route you think R1 will use. Then check the proof: the destination&apos;s bits against each prefix&apos;s bits.</p>,
        show: ["explorer-predict"],
        explore: { r: "R1", dst: "172.16.50.50" },
      },
      {
        title: "Same table, different destinations",
        body: (
          <>
            <p>SERVER-A (172.16.50.50): the /24 is the longest match → <B>via R2</B>. SERVER-C (172.16.60.10): the /24 doesn&apos;t contain it; the /16 does → <B>via R3</B>. One table, two paths — decided per destination, per packet.</p>
          </>
        ),
        runs: [
          { label: "HOST-A pings SERVER-A", actions: [ping("HOST-A", "172.16.50.50")] },
          { label: "HOST-A pings SERVER-C", actions: [ping("HOST-A", "172.16.60.10")] },
        ],
        show: ["journey", "verdict"],
      },
      {
        title: "The list order is not the rule",
        body: (
          <>
            <p>R1 lists <M>0.0.0.0/0</M> first — by address. It still loses to any longer match. Try destinations in the explorer: 10.0.12.2 (connected /30 beats the default), 203.0.113.80 (only the default contains it).</p>
          </>
        ),
        show: ["explorer"],
        explore: { r: "R1", dst: "10.0.12.2" },
        check: { q: "R1's table shows 0.0.0.0/0 at the top. Why doesn't it win for 172.16.50.50?", options: [{ id: "lpm", label: "It matches, but with 0 bits — the /24 (24 matching bits) is longer" }, { id: "order", label: "Routers read the table bottom-up" }, { id: "static", label: "Default routes only work for Internet addresses" }], answer: "lpm", why: "Order on screen is just sorting. The rule is the longest matching prefix; /0 matches everything with zero bits, so it wins only when nothing else matches." },
      },
    ],
  },
  {
    n: 4,
    title: "Every router decides",
    idea: "No router chooses the whole path: each one looks up the packet it holds, in its own table.",
    steps: [
      {
        title: "Two lookups, two tables",
        body: (
          <>
            <p>HOST-A → SERVER-C. R1&apos;s lookup picks the /16 via R3. R3 then does <B>its own</B> lookup: 172.16.60.0/24 is connected → deliver. The reply: R3 looks up 10.10.10.10 (its static via R1), then R1 (connected). Four lookups, three tables.</p>
          </>
        ),
        runs: [{ label: "HOST-A pings SERVER-C", actions: [ping("HOST-A", "172.16.60.10")] }],
        show: ["journey", "table-R3"],
      },
      {
        title: "The default route: “if nothing better matches”",
        body: (
          <>
            <p>HOST-A pings <M>203.0.113.80</M>. On R1 only the default contains it → to R3. R3 has no default and no route for it → R3 drops it and returns Net Unreachable. A default route moves a packet <B>one router further</B>; it doesn&apos;t guarantee anything beyond.</p>
          </>
        ),
        runs: [{ label: "HOST-A pings 203.0.113.80", actions: [ping("HOST-A", "203.0.113.80")] }],
        show: ["verdict", "journey"],
      },
      {
        title: "Routing, switching, ARP — three different jobs",
        body: <p>A switch maps a MAC to a port. A router maps an IP prefix to a next hop and interface. ARP turns that next-hop IP into the MAC for the new frame. Each router hop: lookup → next hop → ARP → new frame, TTL − 1.</p>,
        show: ["layers"],
      },
    ],
  },
  {
    n: 5,
    title: "The return path",
    idea: "The request and the reply are routed separately. Proving one direction proves nothing about the other.",
    steps: [
      {
        title: "Request arrives, reply dies",
        body: (
          <>
            <p>R2 has lost its route to 10.10.10.0/24. HOST-A pings SERVER-A: the request crosses R1 and R2 and <B>arrives</B>. SERVER-A answers. R2 looks the reply up — no route — and drops it. From HOST-A it looks exactly like “the server is down”.</p>
          </>
        ),
        start: () => rnTicketCfg("return"),
        runs: [{ label: "HOST-A pings SERVER-A", actions: [ping("HOST-A", "172.16.50.50")] }],
        show: ["verdict", "journey"],
      },
      {
        title: "Prove which leg failed",
        body: <p>Evidence beats guessing. SERVER-A&apos;s capture shows the Echo Request coming IN and the Echo Reply going OUT — so the server did its job. The Net Unreachable it then received comes from R2&apos;s address: that names the router that has no route back.</p>,
        start: () => rnTicketCfg("return"),
        runs: [{ label: "HOST-A pings SERVER-A", actions: [ping("HOST-A", "172.16.50.50")] }],
        show: ["capture-SERVER-A"],
      },
      {
        title: "Asymmetric: the reply takes another way",
        body: (
          <>
            <p>Now R2&apos;s route to 10.10.10.0/24 points at R3 (10.0.23.2) instead of R1. The request goes R1 → R2; the reply goes R2 → R3 → R1. It works — each router simply follows its own table. Different paths in each direction is called <B>asymmetric routing</B>: not wrong by itself, but a traceroute only shows you the outbound half.</p>
          </>
        ),
        start: () => {
          const c = rnHealthy();
          c.r.R2.statics = c.r.R2.statics.map((x) => (x.prefix === "10.10.10.0" ? { ...x, nh: "10.0.23.2" } : x));
          return c;
        },
        runs: [{ label: "HOST-A pings SERVER-A", actions: [ping("HOST-A", "172.16.50.50")] }],
        show: ["journey", "table-R2"],
      },
    ],
  },
  {
    n: 6,
    title: "When routes can't be used",
    idea: "No route, a discard, an unresolvable next hop, and a loop all drop packets — each in a different place, with different evidence.",
    steps: [
      {
        title: "A link goes down",
        body: (
          <>
            <p>R1&apos;s ge-0/0/1 (to R2) is disabled. Its connected 10.0.12.0/30 disappears — and with it the <B>/24 via 10.0.12.2</B>: its next hop is no longer reachable, so it is no longer installed. For SERVER-A, R1&apos;s longest <i>usable</i> match is now the /16 via R3: the request still gets there. But R2&apos;s return route via 10.0.12.1 died the same way — the reply is dropped at R2.</p>
          </>
        ),
        runs: [{ label: "Disable R1 ge-0/0/1, then ping SERVER-A", actions: [withCfg(rnHealthy, (c) => (c.r.R1.ifs["ge-0/0/1"].shut = true), "R1: interface ge-0/0/1 shutdown"), ping("HOST-A", "172.16.50.50")] }],
        show: ["table-R1", "verdict"],
      },
      {
        title: "A next hop nobody owns",
        body: (
          <>
            <p>R1&apos;s /24 was retyped with next hop <M>10.0.12.3</M>. That address is inside the connected /30, so the route <B>is installed</B> and wins. But R1&apos;s ARP request for 10.0.12.3 gets no answer — nobody has that address. No MAC, no frame: R1 drops the packet and returns Host Unreachable.</p>
          </>
        ),
        pre: [ticket("typo", "R1: 172.16.50.0/24 now via 10.0.12.3")],
        runs: [{ label: "HOST-A pings SERVER-B", actions: [ping("HOST-A", "172.16.50.200")] }],
        show: ["resolution", "verdict"],
      },
      {
        title: "A more specific route steals half a network",
        body: (
          <>
            <p>Someone added <M>172.16.50.0/25 discard</M> on R1. SERVER-A (.50) is inside the /25 — 25 matching bits beat the /24&apos;s 24 — so R1 drops it, <B>silently</B>. SERVER-B (.200) is in the other half: only the /24 matches, and it works. Same LAN, different results: that split points straight at a lookup.</p>
          </>
        ),
        pre: [ticket("discard", "R1: 172.16.50.0/25 discard added")],
        runs: [
          { label: "HOST-A pings SERVER-A", actions: [ping("HOST-A", "172.16.50.50")] },
          { label: "HOST-A pings SERVER-B", actions: [ping("HOST-A", "172.16.50.200")] },
        ],
        show: ["verdict", "explorer"],
        explore: { r: "R1", dst: "172.16.50.50" },
      },
      {
        title: "A loop: two routers pointing at each other",
        body: (
          <>
            <p>R2&apos;s server interface is down, and R2 has a default route back to R1. For 172.16.50.50, R1 says “R2” (/24) and R2 says “R1” (its /0 — the only match left). The packet bounces, losing 1 TTL per hop, until a router drops it and returns <B>Time Exceeded</B> — the ICMP message you met with traceroute.</p>
          </>
        ),
        pre: [ticket("loop", "R2: ge-0/0/0 down, default via 10.0.12.1")],
        runs: [{ label: "HOST-A pings SERVER-A", actions: [ping("HOST-A", "172.16.50.50")] }],
        show: ["journey", "verdict"],
      },
      {
        title: "Four failures, four kinds of evidence",
        body: <p>Each one stops the packet at a router. Telling them apart is most of routing troubleshooting.</p>,
        show: ["outcomes"],
      },
    ],
  },
];
