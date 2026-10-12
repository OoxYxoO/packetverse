import type { ReactNode } from "react";
import type { SpLevel } from "@/components/sp-lab/spKit";
import type { EvAction, EvCfg, EvHost, EvR } from "@/lib/sim-engine/scenarios/evNet";

/**
 * EVPN-VXLAN Lab · Learn — six levels:
 *   1 One LAN across a routed fabric · 2 VXLAN, the data plane · 3 EVPN routes · 4 Learning from BGP ·
 *   5 Build and break · 6 Read the evidence
 */

const B = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;
const M = ({ children }: { children: ReactNode }) => <span className="pv-mono text-pv-text">{children}</span>;
const set = (text: string, dev: EvR, f: (c: EvCfg) => void): EvAction => ({ type: "set", text, changes: [{ dev, f }] });
const ping = (from: EvHost, dst: string): EvAction => ({ type: "test", from, dst });
const clear: EvAction = { type: "clear" };
const rt999 = set("LEAF1: vni-options vni 10010 vrf-target target:65000:99999", "LEAF1", (c) => void (c.evpn!.targets[10010] = "65000:99999"));
const extend20: EvAction = {
  type: "set",
  text: "LEAF1 and LEAF2: vlans V20 vxlan vni 10020, extended-vni-list 10020, vni-options vni 10020 vrf-target target:65000:10020",
  changes: (["LEAF1", "LEAF2"] as EvR[]).map((dev) => ({
    dev,
    f: (c: EvCfg) => {
      c.vlans.V20.vni = 10020;
      c.evpn!.extended.push(10020);
      c.evpn!.targets[10020] = "65000:10020";
    },
  })),
};

export const EV_LEVELS: SpLevel<EvAction>[] = [
  {
    n: 1,
    title: "One LAN across a routed fabric",
    idea: "Two hosts on different leaves share one subnet, while everything between the leaves is routed IP.",
    steps: [
      {
        title: "HOST-A and HOST-B, one subnet",
        body: (
          <p>
            HOST-A sits on LEAF1, HOST-B on LEAF2, both in <M>10.10.10.0/24</M>. Between the leaves there is no VLAN at all: the leaf–spine links are routed (OSPF). Ping HOST-B from HOST-A — it works, because the leaves carry the Ethernet frame inside a routed packet.
          </p>
        ),
        runs: [{ label: "Ping 10.10.10.22 from HOST-A", actions: [ping("HOST-A", "10.10.10.22")] }],
        show: ["test", "fabric"],
        check: { q: "What does SPINE1 need to know to carry HOST-A's frame?", options: [{ id: "a", label: "Only how to route to LEAF2's loopback (the outer IP destination)" }, { id: "b", label: "HOST-B's MAC address" }, { id: "c", label: "VLAN 10" }], answer: "a", why: "The spine routes the outer IP packet. Tenant MACs and VLANs never reach it." },
      },
      {
        title: "The pieces",
        body: <p>Each leaf is a <B>VTEP</B> (VXLAN tunnel endpoint) with its loopback as VTEP address: LEAF1 10.255.0.1, LEAF2 10.255.0.2. Each maps its local VLAN V10 to <B>VNI 10010</B>. And the two leaves talk BGP EVPN to each other — directly, loopback to loopback — to learn where every MAC lives.</p>,
        show: ["fabric"],
      },
    ],
  },
  {
    n: 2,
    title: "VXLAN, the data plane",
    idea: "The ingress leaf wraps the frame in UDP/IP with a VNI; the spine routes it; the egress leaf unwraps it.",
    steps: [
      {
        title: "CE frame in, VXLAN packet across",
        body: <p>Watch HOST-A&apos;s echo request: LEAF1 finds HOST-B behind VTEP 10.255.0.2, adds a VXLAN header (VNI 10010), a UDP header (port 4789) and an outer IP header 10.255.0.1 → 10.255.0.2. SPINE1 routes it like any packet. LEAF2 strips it all and delivers the original frame, unchanged.</p>,
        pre: [ping("HOST-A", "10.10.10.22")],
        runs: [{ label: "Ping 10.10.10.22 from HOST-A again", actions: [ping("HOST-A", "10.10.10.22")] }],
        show: ["path", "test"],
      },
      {
        title: "VLANs are local, the VNI is global",
        body: <p>LEAF2 renumbers its V10 to VLAN ID 110. HOST-B&apos;s port is untagged, so HOST-B notices nothing — and the fabric doesn&apos;t either: what both leaves must agree on is the VNI, 10010, not the VLAN number.</p>,
        runs: [{ label: "LEAF2: vlans V10 vlan-id 110, then ping HOST-B from HOST-A", actions: [set("LEAF2: vlans V10 vlan-id 110", "LEAF2", (c) => void (c.vlans.V10.id = 110)), ping("HOST-A", "10.10.10.22")] }],
        show: ["test", "fabric"],
        check: { q: "Why does the ping still work with VLAN 10 on LEAF1 and VLAN 110 on LEAF2?", options: [{ id: "a", label: "Both VLANs map to VNI 10010 — the VNI is what crosses the fabric" }, { id: "b", label: "The spine translates VLANs" }, { id: "c", label: "The hosts tag their frames" }], answer: "a", why: "A VLAN ID never leaves the leaf. The VXLAN header carries only the VNI." },
      },
    ],
  },
  {
    n: 3,
    title: "EVPN routes",
    idea: "Type 3 routes tell each leaf who else has the VNI (the flood list); Type 2 routes tell it where each MAC lives.",
    steps: [
      {
        title: "Before any traffic: Type 3 only",
        body: <p>No host has sent anything, so no MAC is known. Yet each leaf already knows the other is a VTEP for VNI 10010: each advertised a <B>Type 3</B> (inclusive multicast) route for it. That is LEAF1&apos;s flood list — where to send a copy of every broadcast (ingress replication).</p>,
        show: ["routes", "fabric"],
      },
      {
        title: "After one ping: Type 2",
        body: <p>HOST-A&apos;s ARP request taught LEAF1 HOST-A&apos;s MAC and IP; LEAF1 at once advertised a <B>Type 2</B> (MAC/IP) route for it — RD 10.255.0.1:10010, VNI 10010, route target 65000:10010, next hop 10.255.0.1. HOST-B&apos;s reply did the same on LEAF2. The leaves learn remote MACs from these routes, not from the tunnel.</p>,
        runs: [{ label: "Ping 10.10.10.22 from HOST-A (empty tables)", actions: [ping("HOST-A", "10.10.10.22")] }],
        show: ["routes", "macs"],
        check: { q: "Which field decides whether LEAF1 accepts LEAF2's Type 2 route?", options: [{ id: "a", label: "The route target" }, { id: "b", label: "The route distinguisher" }, { id: "c", label: "The next hop" }], answer: "a", why: "As in L3VPN and BGP VPLS: the RT is the import test; the RD only keeps the route unique." },
      },
    ],
  },
  {
    n: 4,
    title: "Learning from BGP",
    idea: "A leaf knows a remote MAC as soon as the other leaf has learned it locally — whether or not that host ever sent a frame across the fabric.",
    steps: [
      {
        title: "HOST-C never crosses, LEAF2 still knows it",
        body: <p>Clear the tables. HOST-A pings HOST-C, its neighbor on LEAF1. Only HOST-A&apos;s ARP broadcast crosses the fabric; HOST-C&apos;s replies stay on LEAF1. But LEAF1 learned HOST-C locally and advertised it — so LEAF2 knows HOST-C behind 10.255.0.1 anyway. In VPLS, LEAF2 would never have heard of it.</p>,
        pre: [clear],
        runs: [{ label: "Ping 10.10.10.33 from HOST-A (empty tables)", actions: [ping("HOST-A", "10.10.10.33")] }],
        show: ["macs", "path"],
        check: { q: "How did LEAF2 learn HOST-C's MAC?", options: [{ id: "a", label: "From LEAF1's Type 2 route" }, { id: "b", label: "From a frame HOST-C sent across the fabric" }, { id: "c", label: "From the spine" }], answer: "a", why: "EVPN distributes MACs in the control plane. Remote learning from the data plane is off." },
      },
      {
        title: "Known unicast: no flood",
        body: <p>Now HOST-A pings HOST-B a second time. Both MACs are known through EVPN, both ARP caches are warm: every frame is a single VXLAN packet to exactly one VTEP.</p>,
        pre: [ping("HOST-A", "10.10.10.22")],
        runs: [{ label: "Ping 10.10.10.22 from HOST-A again", actions: [ping("HOST-A", "10.10.10.22")] }],
        show: ["path", "test"],
      },
    ],
  },
  {
    n: 5,
    title: "Build and break",
    idea: "A VNI must exist, be extended and carry the same route target on both leaves; and nothing works without the underlay.",
    steps: [
      {
        title: "VLAN 20 isn't stretched — stretch it",
        body: <p>HOST-E (LEAF1) and HOST-F (LEAF2) share 10.20.20.0/24 in V20 — but V20 isn&apos;t mapped to a VNI, so its frames never leave their leaf. Map V20 to VNI 10020 on both leaves, extend it, give it route target 65000:10020: each leaf now advertises a Type 3 route for VNI 10020, and HOST-E reaches HOST-F.</p>,
        runs: [
          { label: "Ping 10.20.20.22 from HOST-E (before)", actions: [ping("HOST-E", "10.20.20.22")] },
          { label: "Both leaves: VNI 10020 for V20, then ping again", actions: [extend20, ping("HOST-E", "10.20.20.22")] },
        ],
        show: ["test", "routes"],
      },
      {
        title: "LEAF2's loopback leaves OSPF",
        body: <p>LEAF2 stops advertising lo0.0 in OSPF. Nobody can reach 10.255.0.2 any more — and that address is both LEAF2&apos;s BGP source and its VTEP. The session drops, every EVPN route goes with it, and HOST-B is cut off. The overlay is only as good as the underlay.</p>,
        runs: [{ label: "LEAF2: lo0.0 out of OSPF, then ping HOST-B from HOST-A", actions: [set("LEAF2: protocols ospf area 0.0.0.0 interface lo0.0 deleted", "LEAF2", (c) => void (c.ospfLo = false)), ping("HOST-A", "10.10.10.22")] }],
        show: ["fabric", "test"],
        check: { q: "Where do you start when the BGP EVPN session is down?", options: [{ id: "a", label: "The underlay: can each leaf reach the other's loopback?" }, { id: "b", label: "The route targets" }, { id: "c", label: "The MAC tables" }], answer: "a", why: "The session runs between loopbacks. No route to the loopback, no session, no EVPN." },
      },
    ],
  },
  {
    n: 6,
    title: "Read the evidence",
    idea: "Test → access ports → underlay → session and family → VNI mapping → route import.",
    steps: [
      {
        title: "The guided lesson's incident",
        body: <p>HOST-A can&apos;t reach HOST-B. The access port is up, OSPF is converged, LEAF1 reaches LEAF2&apos;s loopback, the BGP session is Established. But LEAF1&apos;s VNI 10010 now uses route target 65000:99999. Walk the ladder.</p>,
        pre: [rt999],
        runs: [{ label: "Ping 10.10.10.22 from HOST-A", actions: [ping("HOST-A", "10.10.10.22")] }],
        show: ["ladder", "test"],
      },
      {
        title: "Fix one thing, prove it",
        body: <p>Put LEAF1&apos;s route target for VNI 10010 back to 65000:10010. Each leaf imports the other&apos;s Type 3 route again — the flood list is back — and the Type 2 routes follow as the hosts talk. A fresh ping proves it.</p>,
        pre: [rt999],
        runs: [{ label: "LEAF1: vrf-target target:65000:10010, then ping", actions: [set("LEAF1: vni-options vni 10010 vrf-target target:65000:10010", "LEAF1", (c) => void (c.evpn!.targets[10010] = "65000:10010")), ping("HOST-A", "10.10.10.22")] }],
        show: ["ladder", "test"],
      },
    ],
  },
];
