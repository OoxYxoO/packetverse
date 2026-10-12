import type { ReactNode } from "react";
import type { SpLevel } from "@/components/sp-lab/spKit";
import { L3 } from "@/lib/sim-engine/scenarios/troubleshootingLayer3";
import type { L3Action, L3State } from "@/lib/sim-engine/scenarios/l3tsNet";

/**
 * Layer 3 Lab · Learn — six levels on the lab network:
 *   1 Local or remote? · 2 ARP finds the next hop · 3 Hop by hop · 4 The mask decides · 5 An error, or silence? ·
 *   6 When it breaks: the /16 client
 */

const B = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;
const M = ({ children }: { children: ReactNode }) => <span className="pv-mono text-pv-text">{children}</span>;
const set = (text: string, f: (s: L3State) => void): L3Action => ({ type: "set", text, f });
const pS: L3Action = { type: "ping", from: "CLIENT", dst: L3.server, count: 4 };
const pR: L3Action = { type: "ping", from: "CLIENT", dst: L3.remote, count: 4 };
const pGw: L3Action = { type: "ping", from: "CLIENT", dst: L3.gw, count: 2 };
const trS: L3Action = { type: "trace", from: "CLIENT", dst: L3.server };
const mask16 = set("CLIENT: 10.10.10.10/16 (re-installed with the wrong prefix length)", (s) => void (s.hosts.CLIENT.addrs = [{ ip: L3.client, len: 16 }]));
const noRoute = set("R1: static route 10.20.20.0/24 deleted", (s) => void (s.rtrs.R1.statics = s.rtrs.R1.statics.filter((r) => r.prefix !== "10.20.20.0")));
const noReturn = set("R2: route back to 10.10.10.0/24 and default route deleted", (s) => void (s.rtrs.R2.statics = s.rtrs.R2.statics.filter((r) => r.prefix !== "10.10.10.0" && r.len !== 0)));
const fixMask = set("CLIENT: ip addr del 10.10.10.10/16 · ip addr add 10.10.10.10/24 · ip route add default via 10.10.10.1", (s) => void (s.hosts.CLIENT = { addrs: [{ ip: L3.client, len: 24 }], gw: L3.gw }));

export const L3_LEVELS: SpLevel<L3Action>[] = [
  {
    n: 1,
    title: "Local or remote?",
    idea: "Before sending anything, a host consults its own routing table. Its address and prefix length create a connected route (on-link); the default gateway is the 0.0.0.0/0 route. The longest matching prefix wins.",
    steps: [
      {
        title: "CLIENT decides",
        body: <p>CLIENT is <M>10.10.10.10/24</M> with default gateway <M>10.10.10.1</M>. SERVER (<M>{L3.server}</M>) is outside 10.10.10.0/24, so only the default route matches: send it to the gateway.</p>,
        runs: [{ label: "ping SERVER ×4", actions: [pS] }],
        show: ["decision", "path"],
        check: { q: "Which IP address does CLIENT ARP for when it pings 10.20.20.20?", options: [{ id: "a", label: "10.10.10.1 — the gateway, because the destination is off-link" }, { id: "b", label: "10.20.20.20 — the destination" }, { id: "c", label: "None — routers handle ARP" }], answer: "a", why: "Off-link destinations are sent to the next hop; ARP resolves the next hop's MAC, never the remote host's." },
      },
    ],
  },
  {
    n: 2,
    title: "ARP finds the next hop",
    idea: "ARP asks “who has this IP?” on the local segment, as a broadcast. Only the owner of the address answers. The frame then goes to the gateway's MAC while the IP destination stays the final host.",
    steps: [
      {
        title: "Two addresses, two layers",
        body: <p>Ping the gateway, then SERVER again, and read the ARP caches: CLIENT knows <B>R1&apos;s MAC</B>, never SERVER&apos;s. R1 resolved R2 on the transit link, R2 resolved SERVER on its LAN — each hop resolves only its own next hop.</p>,
        runs: [{ label: "ping gateway · ping SERVER", actions: [pGw, pS] }],
        show: ["arp", "path"],
        check: { q: "The echo request to SERVER leaves CLIENT. What are its destination MAC and destination IP?", options: [{ id: "a", label: "MAC of R1 (the gateway), IP 10.20.20.20" }, { id: "b", label: "MAC of SERVER, IP 10.20.20.20" }, { id: "c", label: "MAC of R1, IP 10.10.10.1" }], answer: "a", why: "Layer 2 delivers to the next hop; Layer 3 keeps the final destination." },
      },
    ],
  },
  {
    n: 3,
    title: "Hop by hop",
    idea: "Every router looks up the destination in its own table (longest prefix), decrements TTL, and resolves its own next hop. traceroute exposes the path by sending probes with TTL 1, 2, 3… and collecting the routers' time-exceeded replies.",
    steps: [
      {
        title: "Follow the path",
        body: <p>R1 sends 10.20.20.0/24 to <M>192.0.2.1</M> (R2); R2 has SERVER&apos;s network directly connected. traceroute shows each router&apos;s address in turn.</p>,
        runs: [{ label: "traceroute SERVER", actions: [trS] }],
        show: ["routes", "trace"],
        check: { q: "Why does hop 2 show 192.0.2.1 and not 10.20.20.1?", options: [{ id: "a", label: "Routers answer from the interface the probe arrived on — R2's transit address" }, { id: "b", label: "R2 is misconfigured" }, { id: "c", label: "10.20.20.1 doesn't exist" }], answer: "a", why: "The time-exceeded message is sourced from the receiving interface, which is how traceroute maps the path." },
      },
    ],
  },
  {
    n: 4,
    title: "The mask decides",
    idea: "The prefix length draws the line between on-link and off-link. Too long, and real neighbours look remote; too short, and remote hosts look local — the host ARPs for them on its own segment, where nobody answers.",
    steps: [
      {
        title: "CLIENT is /16",
        body: <p>After a re-install CLIENT is <M>10.10.10.10/16</M>. Its connected route 10.10.0.0/16 now also matches REMOTE-SERVER (<M>{L3.remote}</M>) — and a /16 beats the default route.</p>,
        pre: [mask16],
        runs: [{ label: "ping SERVER · ping REMOTE-SERVER", actions: [pS, pR] }],
        show: ["decision", "arp", "path"],
        check: { q: "Why does SERVER still work while REMOTE-SERVER fails?", options: [{ id: "a", label: "10.20.20.20 is outside 10.10.0.0/16 and still uses the gateway; 10.10.20.20 is inside it, so CLIENT ARPs for it directly" }, { id: "b", label: "R1 lost its route to 10.10.20.0/24" }, { id: "c", label: "REMOTE-SERVER is down" }], answer: "a", why: "The longest matching prefix wins — for 10.10.20.20 that's CLIENT's own /16." },
      },
    ],
  },
  {
    n: 5,
    title: "An error, or silence?",
    idea: "When a router can't forward, it tells the source: ICMP destination net unreachable, or time exceeded. When a reply can't find its way back, nobody says anything — the ping just times out.",
    steps: [
      {
        title: "R1 has no route",
        body: <p>R1&apos;s static route to <M>10.20.20.0/24</M> was deleted. R1 receives CLIENT&apos;s packet, finds nothing in inet.0 and answers.</p>,
        pre: [noRoute],
        runs: [{ label: "ping SERVER · ping REMOTE-SERVER", actions: [pS, pR] }],
        show: ["routes", "path"],
        check: { q: "CLIENT gets “Destination Net Unreachable from 10.10.10.1”. What does that prove?", options: [{ id: "a", label: "The packet reached R1, and R1 has no route to the destination" }, { id: "b", label: "CLIENT's gateway is wrong" }, { id: "c", label: "SERVER is down" }], answer: "a", why: "Only a router that received the packet and found no route sends net unreachable." },
      },
      {
        title: "R2 can't route back",
        body: <p>R2 lost its route back to <M>10.10.10.0/24</M> (and its default). Requests arrive at SERVER; the replies die at R2.</p>,
        pre: [noReturn],
        runs: [{ label: "ping SERVER · traceroute", actions: [pS, trS] }],
        show: ["trace", "path"],
        check: { q: "Pings time out with no error; traceroute shows R1, then * * *. Where do you look?", options: [{ id: "a", label: "The return path: R2's route back to 10.10.10.0/24" }, { id: "b", label: "CLIENT's mask" }, { id: "c", label: "R1's route to 10.20.20.0/24" }], answer: "a", why: "R2 can't even send its time-exceeded reply back — no route to the source." },
      },
    ],
  },
  {
    n: 6,
    title: "When it breaks: the /16 client",
    idea: "The guided lesson's incident, measured and proven: one server unreachable, another fine, the routers innocent.",
    steps: [
      {
        title: "Measure and locate",
        body: <p>Reproduce it, then read CLIENT&apos;s decision for each destination, its ARP cache and R1&apos;s ARP counters.</p>,
        pre: [mask16],
        runs: [{ label: "ping SERVER · ping REMOTE-SERVER", actions: [pS, pR] }],
        show: ["decision", "arp", "routes"],
        check: { q: "Which repair?", options: [{ id: "a", label: "Give CLIENT 10.10.10.10/24 (and its default route via 10.10.10.1)" }, { id: "b", label: "Add a route for 10.10.20.0/24 on R1" }, { id: "c", label: "Enable proxy ARP on R1" }], answer: "a", why: "The fault is CLIENT's prefix length; proxy ARP would hide it instead of fixing it." },
      },
      {
        title: "Repair, then prove",
        body: <p>Remove the /16 address, add the /24, and put the default route back (deleting the address removed it). Then ping both servers fresh.</p>,
        pre: [mask16],
        runs: [{ label: "fix · ping SERVER · ping REMOTE-SERVER", actions: [fixMask, pS, pR] }],
        show: ["decision", "path"],
        check: { q: "Why did the default route need re-adding?", options: [{ id: "a", label: "Removing the address removed the connected network the gateway was reachable through, and the kernel flushed routes via it" }, { id: "b", label: "It didn't — it's optional" }, { id: "c", label: "Linux always forgets routes on ping" }], answer: "a", why: "A next hop must be on a connected network; without one, the route can't exist." },
      },
    ],
  },
];
