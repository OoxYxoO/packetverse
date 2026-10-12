import type { ReactNode } from "react";
import type { SpLevel } from "@/components/sp-lab/spKit";
import type { L3Action, L3Ce, L3Cfg, L3R } from "@/lib/sim-engine/scenarios/l3Net";

/**
 * MPLS L3VPN Lab · Learn — six levels:
 *   1 Two customers, one address plan · 2 RD and RT · 3 MP-BGP carries the VPN · 4 Two labels on the wire ·
 *   5 The core still needs its LSP · 6 Read the evidence
 */

const B = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;
const M = ({ children }: { children: ReactNode }) => <span className="pv-mono text-pv-text">{children}</span>;
const set = (text: string, dev: L3R, f: (c: L3Cfg) => void): L3Action => ({ type: "set", text, changes: [{ dev, f }] });
const ping = (from: L3Ce, dst: string): L3Action => ({ type: "test", from, dst });
const badImport = set("PE1: VRF CUST-A import route-target 65001:999", "PE1", (c) => void (c.vrfs["CUST-A"].imp = ["65001:999"]));

export const L3_LEVELS: SpLevel<L3Action>[] = [
  {
    n: 1,
    title: "Two customers, one address plan",
    idea: "A PE keeps a separate routing table (VRF) per customer, so customers can reuse the same addresses.",
    steps: [
      {
        title: "Same address, different customer",
        body: (
          <p>
            CUST-A and CUST-B both number their site 1 <M>10.1.1.0/24</M> and their site 2 <M>10.2.2.0/24</M> — even their links to the provider use the same addresses. Ping 10.2.2.20 from each site 1: both succeed, and each reaches <B>its own</B> site 2.
          </p>
        ),
        runs: [
          { label: "Ping 10.2.2.20 from CE1A (CUST-A)", actions: [ping("CE1A", "10.2.2.20")] },
          { label: "Ping 10.2.2.20 from CE1B (CUST-B)", actions: [ping("CE1B", "10.2.2.20")] },
        ],
        show: ["test", "vrfs"],
        check: { q: "PE1 has two routes for 10.2.2.0/24. How does it know which one CE1B's packet needs?", options: [{ id: "a", label: "From the interface it arrives on: that interface belongs to VRF CUST-B" }, { id: "b", label: "From the source address" }, { id: "c", label: "It picks the best one" }], answer: "a", why: "Each customer-facing interface is bound to a VRF. The lookup happens in that VRF's table only." },
      },
      {
        title: "The interface decides the table",
        body: <p>Take PE1&apos;s port toward CE1B out of its VRF. CE1B&apos;s packets now arrive in PE1&apos;s global table — the provider&apos;s own table, which knows the loopbacks and nothing about customers.</p>,
        runs: [{ label: "Remove VRF CUST-B from PE1's port, then ping", actions: [set("PE1: no vrf on the interface toward CE1B", "PE1", (c) => void (c.ifs["ge-0/0/2"]!.vrf = undefined)), ping("CE1B", "10.2.2.20")] }],
        show: ["test"],
      },
    ],
  },
  {
    n: 2,
    title: "RD and RT",
    idea: "The route distinguisher makes identical prefixes unique in BGP; the route target decides which VRFs import them.",
    steps: [
      {
        title: "RD: two prefixes become different routes",
        body: (
          <p>
            Between the PEs, both customers&apos; 10.2.2.0/24 travel in the same BGP session. Each PE prefixes them with the VRF&apos;s <B>route distinguisher</B>: <M>65001:102:10.2.2.0/24</M> and <M>65001:202:10.2.2.0/24</M> are two different VPNv4 routes. Each also carries <B>route targets</B> (extended communities): 65001:100 for CUST-A, 65001:200 for CUST-B.
          </p>
        ),
        show: ["vpnv4"],
      },
      {
        title: "RT decides where a route lands",
        body: <p>Point PE1&apos;s CUST-B import at CUST-A&apos;s route target (65001:100). PE1 now installs CUST-A&apos;s 10.2.2.0/24 in CUST-B&apos;s table — the RD didn&apos;t stop it. CE1B&apos;s ping is carried to the wrong customer, and the reply never finds its way back.</p>,
        runs: [{ label: "PE1: CUST-B imports 65001:100, then ping from CE1B", actions: [set("PE1: VRF CUST-B import route-target 65001:100 (instead of 65001:200)", "PE1", (c) => void (c.vrfs["CUST-B"].imp = ["65001:100"])), ping("CE1B", "10.2.2.20")] }],
        show: ["test", "vrfs"],
        check: { q: "What decides which VRF a VPNv4 route is installed in?", options: [{ id: "a", label: "The route targets it carries, compared with each VRF's import list" }, { id: "b", label: "Its route distinguisher" }, { id: "c", label: "The VPN label" }], answer: "a", why: "The RD only keeps routes apart in BGP. Import is decided by route targets alone." },
      },
    ],
  },
  {
    n: 3,
    title: "MP-BGP carries the VPN",
    idea: "One iBGP session between the PE loopbacks, with the VPNv4 family, carries every customer's routes — with a VPN label for each.",
    steps: [
      {
        title: "A VPNv4 route, field by field",
        body: (
          <p>
            PE2 advertises CUST-A&apos;s site 2 as: RD <M>65001:102</M>, prefix <M>10.2.2.0/24</M>, next hop <M>4.4.4.4</M> (PE2&apos;s loopback), RT <M>65001:100</M>, and a <B>VPN label</B> PE2 chose — the label that will tell PE2 later which VRF a packet belongs to.
          </p>
        ),
        show: ["vpnv4", "vrfs"],
      },
      {
        title: "No VPNv4, no VPN",
        body: <p>Remove the VPNv4 family from PE2&apos;s neighbor. The BGP session stays Established (IPv4), but VPNv4 isn&apos;t negotiated: every customer route disappears from the other PE.</p>,
        runs: [{ label: "PE2: no address-family vpnv4 unicast toward PE1, then ping", actions: [set("PE2: neighbor 1.1.1.1 without address-family vpnv4 unicast", "PE2", (c) => void (c.nbr!.vpnv4 = false)), ping("CE1A", "10.2.2.20")] }],
        show: ["test", "vpnv4"],
        check: { q: "The session is Established but no VPN route crosses. Why?", options: [{ id: "a", label: "Both sides must activate the VPNv4 family; it is negotiated per session" }, { id: "b", label: "The RDs differ" }, { id: "c", label: "LDP is down" }], answer: "a", why: "BGP capabilities are negotiated at OPEN. A family only one side offers isn't used." },
      },
    ],
  },
  {
    n: 4,
    title: "Two labels on the wire",
    idea: "The ingress PE pushes the VPN label, then the transport label on top; the core switches the top label only.",
    steps: [
      {
        title: "Push, swap, pop — with a VPN label underneath",
        body: <p>CE1A pings 10.2.2.20. PE1 finds the route in VRF CUST-A, pushes PE2&apos;s VPN label and then the transport label toward 4.4.4.4 (from LDP, as in the MPLS lesson). P1 swaps the top label, P2 pops it (PHP) — and PE2 receives a packet with just the VPN label, which picks VRF CUST-A.</p>,
        runs: [{ label: "Ping 10.2.2.20 from CE1A", actions: [ping("CE1A", "10.2.2.20")] }],
        show: ["path", "test"],
      },
      {
        title: "The core knows nothing about customers",
        body: <p>P1 and P2 run no BGP and have no VRFs: they only know the loopbacks and their labels. That is why the transport label has to be there — and why the VPN label sits <B>under</B> it, where the core never looks.</p>,
        show: ["lsp"],
        check: { q: "Why can't PE1 send the packet with only the VPN label?", options: [{ id: "a", label: "P1 would find a label it never allocated — only PE2 understands the VPN label" }, { id: "b", label: "Labels can't be sent alone" }, { id: "c", label: "PE2 needs two labels" }], answer: "a", why: "Labels are local to the router that allocated them. The VPN label belongs to PE2; the core needs its own transport label to reach PE2." },
      },
    ],
  },
  {
    n: 5,
    title: "The core still needs its LSP",
    idea: "If the transport LSP breaks, VPN traffic dies even though IP between the loopbacks and BGP still work.",
    steps: [
      {
        title: "LDP disappears on P1–P2",
        body: <p>P1 stops running LDP toward P2. IS-IS still reaches PE2, BGP stays up, every VRF keeps its routes. But P1 has no label from P2 for 4.4.4.4 (IOS XR: Unlabelled), so it removes the transport label — and P2 receives PE2&apos;s VPN label, which it has never seen.</p>,
        runs: [{ label: "P1: no LDP toward P2, then ping", actions: [set("P1: LDP removed from the interface toward P2", "P1", (c) => void (c.ifs["ge-0/0/1"]!.ldp = false)), ping("CE1A", "10.2.2.20")] }],
        show: ["path", "test"],
      },
      {
        title: "Repair the LSP, prove the VPN",
        body: <p>Put LDP back. The transport label returns, P2 pops it as before, and PE2 sees the VPN label it expects. On Junos the same fault looks different — PE1 hides the VPN route because there is no LSP to 4.4.4.4 in inet.3 — the cause is the same.</p>,
        pre: [set("P1: LDP removed from the interface toward P2", "P1", (c) => void (c.ifs["ge-0/0/1"]!.ldp = false))],
        runs: [{ label: "P1: LDP back toward P2, then ping", actions: [set("P1: LDP on the interface toward P2", "P1", (c) => void (c.ifs["ge-0/0/1"]!.ldp = true)), ping("CE1A", "10.2.2.20")] }],
        show: ["path", "test"],
      },
    ],
  },
  {
    n: 6,
    title: "Read the evidence",
    idea: "Test → is the CE port in its VRF → is VPNv4 up → does each VRF have the remote prefix → is the LSP complete.",
    steps: [
      {
        title: "The guided lesson's incident",
        body: <p>Overnight, PE1&apos;s CUST-A import route target became 65001:999. CUST-A&apos;s site 1 loses site 2; CUST-B, with the same addresses, is fine. Walk the ladder: the first rung that is wrong names the layer.</p>,
        pre: [badImport],
        runs: [{ label: "Ping 10.2.2.20 from CE1A", actions: [ping("CE1A", "10.2.2.20")] }],
        show: ["ladder", "test"],
      },
      {
        title: "Fix one thing, prove it",
        body: <p>Set the import back to 65001:100. PE1 accepts PE2&apos;s CUST-A route again, installs it in VRF CUST-A, and a fresh ping from CE1A proves it end to end.</p>,
        pre: [badImport],
        runs: [{ label: "PE1: import 65001:100 again, then ping", actions: [set("PE1: VRF CUST-A import route-target 65001:100", "PE1", (c) => void (c.vrfs["CUST-A"].imp = ["65001:100"])), ping("CE1A", "10.2.2.20")] }],
        show: ["ladder", "test"],
      },
    ],
  },
];
