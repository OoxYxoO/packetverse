import type { ReactNode } from "react";
import type { SpLevel } from "@/components/sp-lab/spKit";
import type { DAction, DR, DRtr } from "@/lib/sim-engine/scenarios/dpNet";

/**
 * SR-MPLS vs SRv6 Lab · Learn — six levels on the lab network:
 *   1 One network, two data planes · 2 SR-MPLS: a label stack · 3 SRv6: one destination address · 4 What transit
 *   routers must know · 5 Protection in both planes · 6 When it breaks: the migration incident
 */

const B = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;
const M = ({ children }: { children: ReactNode }) => <span className="pv-mono text-pv-text">{children}</span>;
const set = (text: string, changes: { dev: DR; f: (c: DRtr) => void }[]): DAction => ({ type: "set", text, changes });
const p100: DAction = { type: "ping", size: 100 };
const d100: DAction = { type: "drill", size: 100 };
export const toSrv6 = set("PE2: VRF CUST-A → segment-routing srv6, alloc mode per-vrf (End.DT4)", [{ dev: "PE2", f: (c) => void (c.vrfSrv6 = true) }]);
const p2NoMpls = set("P2: no segment-routing mpls", [{ dev: "P2", f: (c) => void (c.mpls = false) }]);
const pe2NoLoc = set("PE2: IS-IS no longer advertises locator MAIN", [{ dev: "PE2", f: (c) => void (c.isisLoc = false) }]);

export const DP_LEVELS: SpLevel<DAction>[] = [
  {
    n: 1,
    title: "One network, two data planes",
    idea: "The same six routers, the same IS-IS, the same shortest paths. Every router runs both: SR-MPLS (a label per node) and SRv6 (a locator per node). PE2's VRF decides which one CUST-A uses.",
    steps: [
      {
        title: "Labels and locators side by side",
        body: <p>IS-IS advertises each loopback with a <B>prefix-SID</B> — PE2 is index 6, label <M>16006</M> everywhere (SRGB 16000) — and each router&apos;s <B>SRv6 locator</B>, PE2&apos;s is <M>2001:db8:100:2::/64</M>. Two instruction sets, one topology. Today PE2 allocates the MPLS VPN label <M>9002</M> for CUST-A, so CUST-A rides SR-MPLS.</p>,
        runs: [{ label: "Ping 100 bytes", actions: [p100] }],
        show: ["planes", "test"],
        check: { q: "What decides whether CUST-A rides SR-MPLS or SRv6?", options: [{ id: "a", label: "What the egress PE advertises for the VRF: a VPN label or an SRv6 service SID" }, { id: "b", label: "Which IGP runs in the core" }, { id: "c", label: "The ingress PE picks at random" }], answer: "a", why: "The ingress encapsulates with whatever PE2 advertised in BGP." },
      },
    ],
  },
  {
    n: 2,
    title: "SR-MPLS: a label stack",
    idea: "PE1 pushes two labels: PE2's Node SID 16006 (transport) over the VPN label 9002 (service). Every router on the way acts on the top label only.",
    steps: [
      {
        title: "Swap, pop, pop",
        body: <p>PE1 sends <M>[16006, 9002]</M> to P1 — 8 bytes. P1 <B>swaps</B> 16006 for 16006 (same index, same SRGB, same label). P2 is the penultimate hop: it <B>pops</B> 16006 (PHP). PE2 receives the VPN label alone, pops it and looks up CUST-A. Every transit router needs a label entry — the label means nothing without it.</p>,
        runs: [{ label: "Ping 100 bytes", actions: [p100] }],
        show: ["hops", "path"],
      },
    ],
  },
  {
    n: 3,
    title: "SRv6: one destination address",
    idea: "Switch PE2's VRF to SRv6. PE2 allocates an End.DT4 SID from its locator; PE1 wraps the customer packet in IPv6 with that SID as the destination. Transport and service are one address.",
    steps: [
      {
        title: "40 bytes instead of 8",
        body: <p>PE1 performs <B>H.Encaps.Red</B>: outer IPv6, DA <M>2001:db8:100:2:13::</M>. No SRH is needed for a single SID. P1 and P2 simply route the DA toward PE2&apos;s locator; PE2 recognizes its End.DT4 and decapsulates into CUST-A. The cost: 40 bytes of IPv6 header against 8 bytes of labels.</p>,
        pre: [toSrv6],
        runs: [{ label: "Ping 100 bytes", actions: [p100] }],
        show: ["compare", "hops"],
        check: { q: "Where are CUST-A's transport and service encoded with SRv6?", options: [{ id: "a", label: "In one 128-bit SID: the locator part routes to PE2, the function part selects CUST-A" }, { id: "b", label: "In two labels" }, { id: "c", label: "In the SRH only" }], answer: "a", why: "Locator = where, function = what — one destination address." },
      },
    ],
  },
  {
    n: 4,
    title: "What transit routers must know",
    idea: "P2 loses “segment-routing mpls”. For SR-MPLS that is a hole in the LSP. For SRv6 it changes nothing: P2 only needs an IPv6 route to PE2's locator.",
    steps: [
      {
        title: "SR-MPLS through a router without labels",
        body: <p>P1 has no label for PE2 via P2 any more — its entry becomes <B>Unlabelled</B>. P1 pops 16006 and P2 receives a packet whose top label is the VPN label <M>9002</M>, which only PE2 understands. Dropped.</p>,
        pre: [p2NoMpls],
        runs: [{ label: "Ping 100 bytes (SR-MPLS)", actions: [p100] }],
        show: ["test", "hops", "planes"],
      },
      {
        title: "SRv6 through the same router",
        body: <p>Same P2, CUST-A on SRv6. P2 forwards on the IPv6 destination like any other packet. <B>SRv6 transit needs no SR state at all</B> — only plain IPv6 routing.</p>,
        pre: [p2NoMpls, toSrv6],
        runs: [{ label: "Ping 100 bytes (SRv6)", actions: [p100] }],
        show: ["test", "hops"],
        check: { q: "What does P2 need to forward SRv6 traffic to PE2?", options: [{ id: "a", label: "An IPv6 route covering PE2's locator" }, { id: "b", label: "A label for PE2" }, { id: "c", label: "PE2's End.DT4 SID in its own table" }], answer: "a", why: "Only the router that owns a SID executes it; everyone else just routes." },
      },
    ],
  },
  {
    n: 5,
    title: "Protection in both planes",
    idea: "P1 runs TI-LFA on its link to P2. If P1–P2 fails, the post-convergence path is P1 → P3 → P4 → P2 → PE2 — and P4 must not send it back toward P1. Both planes encode the same repair differently.",
    steps: [
      {
        title: "SR-MPLS repair: [16004, 24045]",
        body: <p>P4&apos;s own shortest path to P2 runs back through P3 and P1 (cost 30 against 50 direct), so P4&apos;s Node SID alone is not enough. P1 pushes P4&apos;s Node SID <M>16004</M> and P4&apos;s <B>Adj-SID</B> toward P2 <M>24045</M> above the transport label 16006: +8 bytes. P3 pops 16004 (PHP), P4 pops 24045 and sends to P2, P2 pops 16006 as usual.</p>,
        runs: [{ label: "Drill the P1–P2 cut", actions: [d100] }],
        show: ["repair", "hops"],
      },
      {
        title: "SRv6 repair: one End.X",
        body: <p>P1 adds an outer IPv6 header with DA = P4&apos;s <B>End.X</B> toward P2, <M>2001:db8:110:14:2::</M>: +40 bytes. P3 routes it to P4&apos;s locator; P4 executes End.X, removes the repair header (USD) and sends the original packet to P2, which routes it to PE2.</p>,
        pre: [toSrv6],
        runs: [{ label: "Drill the P1–P2 cut", actions: [d100] }],
        show: ["repair", "hops"],
        check: { q: "Why is the repair larger over SRv6?", options: [{ id: "a", label: "Each extra instruction costs a 40-byte IPv6 header (or a 16-byte SRH entry) instead of a 4-byte label" }, { id: "b", label: "SRv6 takes a longer path" }, { id: "c", label: "SRv6 needs two repairs" }], answer: "a", why: "Same path, same logic — different encoding size." },
      },
    ],
  },
  {
    n: 6,
    title: "When it breaks: the migration incident",
    idea: "The guided lesson's incident. CUST-A is moved to SRv6, but PE2's IS-IS doesn't advertise its locator. BGP is up, the route has a SID, PE2's loopback pings — and nothing reaches CE2. SR-MPLS never needed the locator.",
    steps: [
      {
        title: "Everything looks fine, except the traffic",
        body: <p>PE2 still owns End.DT4 <M>2001:db8:100:2:13::</M> locally, and BGP still advertises it. But no router has a route to <M>2001:db8:100:2::/64</M>. PE1 can&apos;t resolve the SID, so it doesn&apos;t install CUST-A&apos;s route. Changing the RT, restarting BGP or adding an MPLS label would change nothing — restore the locator in IS-IS, then send fresh traffic.</p>,
        pre: [toSrv6, pe2NoLoc],
        runs: [{ label: "Ping 100 bytes", actions: [p100] }],
        show: ["test", "ladder"],
        check: { q: "Why did SR-MPLS keep working before the migration?", options: [{ id: "a", label: "It reaches PE2 through the prefix-SID of 10.0.0.6/32, which never depended on the SRv6 locator" }, { id: "b", label: "SR-MPLS is more reliable" }, { id: "c", label: "BGP was different" }], answer: "a", why: "Each plane has its own reachability: labels for SR-MPLS, locators for SRv6." },
      },
    ],
  },
];
