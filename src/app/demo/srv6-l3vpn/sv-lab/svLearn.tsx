import type { ReactNode } from "react";
import type { SpLevel } from "@/components/sp-lab/spKit";
import type { Src, SvAction, SvR, SvRtr } from "@/lib/sim-engine/scenarios/svNet";

/**
 * SRv6 L3VPN Lab · Learn — six levels on the lab network:
 *   1 Separate customers, shared core · 2 A customer route becomes a VPN route · 3 A packet crosses the core ·
 *   4 One SID, many destinations — and IPv6 · 5 Next hop up, service down · 6 When it breaks
 */

const B = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;
const M = ({ children }: { children: ReactNode }) => <span className="pv-mono text-pv-text">{children}</span>;
const ping = (src: Src, to: string): SvAction => ({ type: "ping", src, to });
const set = (text: string, changes: { dev: SvR; f: (c: SvRtr) => void }[]): SvAction => ({ type: "set", text, changes });
const CE1 = { ce: "CE1" } as const;
const noLoc = set("PE2: router isis CORE address-family ipv6 unicast — no segment-routing srv6", [{ dev: "PE2", f: (c) => void (c.isisLoc = false) }]);
const badRt = set("PE2: vrf CUST-A export route-target 65000:999", [{ dev: "PE2", f: (c) => void (["ipv4", "ipv6"] as const).forEach((f) => (c.vrfs["CUST-A"]![f]!.exp = ["65000:999"])) }]);

export const SV_LEVELS: SpLevel<SvAction>[] = [
  {
    n: 1,
    title: "Separate customers, shared core",
    idea: "Two customers use the same addresses. Each PE keeps one routing table per customer — a VRF — so the same destination means different hosts.",
    steps: [
      {
        title: "Same address, two answers",
        body: <p>CE1 (CUST-A) and CE4 (CUST-B) both ping <M>10.20.1.10</M>. CUST-A&apos;s 10.20.1.10 is behind CE2; CUST-B&apos;s is behind CE5. The PE puts each packet in the VRF of the interface it arrived on, and each VRF has its own route to 10.20.1.0/24.</p>,
        runs: [
          { label: "CE1 → 10.20.1.10", actions: [ping(CE1, "10.20.1.10")] },
          { label: "CE4 → 10.20.1.10", actions: [ping({ ce: "CE4" }, "10.20.1.10")] },
        ],
        show: ["test", "vrf"],
        check: { q: "Why do the two pings reach different CEs?", options: [{ id: "a", label: "Each arrives on an interface in a different VRF, with its own table" }, { id: "b", label: "CE4's packets are tagged with a VLAN" }, { id: "c", label: "The P routers know both customers" }], answer: "a", why: "The VRF is chosen by the ingress interface; the core never sees customer addresses." },
      },
      {
        title: "Isolation is the default",
        body: <p>CE4 pings <M>10.20.2.10</M> — CUST-A&apos;s CE3 subnet. CUST-B&apos;s VRF has no such route: nothing leaks between customers unless route targets say so.</p>,
        runs: [{ label: "CE4 → 10.20.2.10", actions: [ping({ ce: "CE4" }, "10.20.2.10")] }],
        show: ["test"],
      },
    ],
  },
  {
    n: 2,
    title: "A customer route becomes a VPN route",
    idea: "PE2 turns CE2's subnet into a VPNv4 route: RD to make it unique, RT to say who imports it, its loopback as next hop — and an SRv6 service SID that says what to do with packets for it.",
    steps: [
      {
        title: "PE2 advertises, RR1 reflects, PE1 imports",
        body: (
          <p>
            PE2 has a static route to 10.20.1.0/24 via CE2 and redistributes it into BGP as <M>65000:2:10.20.1.0/24</M>, RT <M>65000:100</M>, next hop <M>2001:db8:ffff::2</M> (Loopback0), with the Prefix-SID attribute carrying <B>End.DT4</B> <M>2001:db8:100:2:41::</M> for VRF CUST-A. RR1 reflects it; PE1&apos;s CUST-A imports RT 65000:100 and installs it.
          </p>
        ),
        show: ["routes", "sids"],
        check: { q: "Which field decides that PE1's CUST-A — and not CUST-B — imports the route?", options: [{ id: "a", label: "The route target" }, { id: "b", label: "The route distinguisher" }, { id: "c", label: "The service SID" }], answer: "a", why: "RDs only make prefixes unique; import is decided by RT." },
      },
    ],
  },
  {
    n: 3,
    title: "A packet crosses the core",
    idea: "PE1 looks the packet up in CUST-A, wraps it in IPv6 with the service SID as destination, and the core routes it like any IPv6 packet — to PE2's locator.",
    steps: [
      {
        title: "Encapsulate, route, decapsulate",
        body: <p>PE1: VRF lookup → H.Encaps.Red, outer DA <M>2001:db8:100:2:41::</M>, no SRH (one SID). P1 and P2 know nothing about customers: they match the DA against <M>2001:db8:100:2::/64</M>, PE2&apos;s locator. PE2 finds the SID in its table: End.DT4 → remove the outer header, look 10.20.1.10 up in CUST-A → CE2. The reply makes the same trip back to PE1&apos;s End.DT4.</p>,
        runs: [{ label: "CE1 → 10.20.1.10", actions: [ping(CE1, "10.20.1.10")] }],
        show: ["headers", "path"],
      },
    ],
  },
  {
    n: 4,
    title: "One SID, many destinations — and IPv6",
    idea: "A per-VRF SID serves every prefix of the VRF: the lookup after decapsulation picks the CE. IPv6 has its own address family, its own VPNv6 routes and its own End.DT6.",
    steps: [
      {
        title: "CE2 and CE3 behind one End.DT4",
        body: <p>Ping CE3&apos;s <M>10.20.2.10</M>: same SID <M>…:2:41::</M>, different result after the lookup. Then IPv6 to CE2: VPNv6 route, SID <M>…:2:42::</M> (End.DT6).</p>,
        runs: [
          { label: "CE1 → 10.20.2.10", actions: [ping(CE1, "10.20.2.10")] },
          { label: "CE1 → 2001:db8:ca:20::a", actions: [ping(CE1, "2001:db8:ca:20::a")] },
        ],
        show: ["test", "headers"],
        check: { q: "PE2 receives two packets with DA …:2:41::. What decides CE2 vs CE3?", options: [{ id: "a", label: "The CUST-A lookup of the inner destination after End.DT4 decapsulates" }, { id: "b", label: "An SRH segment naming the CE" }, { id: "c", label: "The BGP next hop" }], answer: "a", why: "DT = decapsulate, then look up in the VRF the SID is bound to." },
      },
    ],
  },
  {
    n: 5,
    title: "Next hop up, service down",
    idea: "The BGP next hop (loopback) and the service SID (locator) are different prefixes. Lose the locator from the IGP and BGP looks perfect — but PE1 cannot reach the SID, so it installs nothing.",
    steps: [
      {
        title: "PE2's locator leaves IS-IS",
        body: <p>PE2&apos;s IS-IS loses <M>segment-routing srv6 locator MAIN</M>. Its loopback <M>2001:db8:ffff::2</M> is still advertised: the session to RR1 stays up and PE1 still receives the VPN route with SID <M>…:2:41::</M>. But <M>2001:db8:100:2::/64</M> is gone from PE1&apos;s IPv6 table, so the SID is unreachable and the route never enters CUST-A. This is the guided lesson&apos;s incident.</p>,
        pre: [noLoc],
        runs: [{ label: "CE1 → 10.20.1.10", actions: [ping(CE1, "10.20.1.10")] }],
        show: ["test", "routes", "ladder"],
        check: { q: "What proves this is a locator problem and not a BGP problem?", options: [{ id: "a", label: "The VPN route is received with its SID, the next hop is reachable, but there is no route to the SID's locator" }, { id: "b", label: "The BGP session is down" }, { id: "c", label: "PE2's loopback doesn't answer" }], answer: "a", why: "Install needs three things: RT import, a reachable next hop, and a reachable SID." },
      },
    ],
  },
  {
    n: 6,
    title: "When it breaks",
    idea: "Every rung of the ladder can fail on its own: the customer route, the VPN route, the session family, the import, the SID, the way back.",
    steps: [
      {
        title: "A route target typo",
        body: <p>A template sets PE2&apos;s CUST-A export RT to <M>65000:999</M>. RR1 has the routes — with the wrong RT. PE1 imports only 65000:100 and, with RT filtering, keeps no copy at all. The SIDs and the core are perfect; the service is gone.</p>,
        pre: [badRt],
        runs: [{ label: "CE1 → 10.20.1.10", actions: [ping(CE1, "10.20.1.10")] }],
        show: ["test", "ladder"],
      },
      {
        title: "Read the ladder",
        body: <p>The ladder reads the network from the customer down: the egress customer route, the VPN route and its SID, the session families, the import, the SID&apos;s reachability, the way back. The first rung that fails is the place to fix.</p>,
        pre: [badRt],
        runs: [{ label: "CE1 → 10.20.1.10", actions: [ping(CE1, "10.20.1.10")] }],
        show: ["ladder"],
        check: { q: "Which rung shows the cause?", options: [{ id: "a", label: "Import: RR1 has the route but PE1 keeps no copy — the RT doesn't match" }, { id: "b", label: "The service SID" }, { id: "c", label: "The way back" }], answer: "a", why: "The route exists in the provider; it just isn't imported into the customer's VRF." },
      },
    ],
  },
];
