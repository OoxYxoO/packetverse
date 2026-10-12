import type { ReactNode } from "react";
import type { SpLevel } from "@/components/sp-lab/spKit";
import type { IfName, IsAction, IsIf, IsR, IsRtr } from "@/lib/sim-engine/scenarios/isisNet";

/**
 * IS-IS Lab · Learn — six levels, each a fresh copy of the six-router core:
 *   1 Neighbors first · 2 Every router describes itself · 3 One map, each router's own SPF · 4 Metrics move traffic ·
 *   5 What hellos must agree on · 6 Read the evidence
 * Every run is the model reacting (hellos, adjacencies, LSPs, flooding, SPF, traffic); the evidence under each step
 * is read from the same model.
 */

const B = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;
const M = ({ children }: { children: ReactNode }) => <span className="pv-mono text-pv-text">{children}</span>;
const setIf = (dev: IsR, ifn: IfName, patch: Partial<IsIf>) => ({ dev, f: (r: IsRtr) => void Object.assign(r.ifs[ifn]!, patch) });
const setR = (dev: IsR, patch: Partial<IsRtr>) => ({ dev, f: (r: IsRtr) => void Object.assign(r, patch) });
const rung: IsAction = { type: "set", text: "IS-IS enabled on both ends of P1–P3 (P1 ge-0/0/2, P3 ge-0/0/2)", changes: [setIf("P1", "ge-0/0/2", { isis: true }), setIf("P3", "ge-0/0/2", { isis: true })] };
const metric100: IsAction = { type: "set", text: "P1 ge-0/0/1 (toward P2): metric 10 → 100", changes: [setIf("P1", "ge-0/0/1", { metric: 100 })] };

export const IS_LEVELS: SpLevel<IsAction>[] = [
  {
    n: 1,
    title: "Neighbors first",
    idea: "IS-IS routers find each other with hellos sent straight over each link — no IP involved.",
    steps: [
      {
        title: "Six routers, one Level-2 core",
        body: (
          <>
            <p>
              This is a small provider core: two edge routers (<B>PE1</B>, <B>PE2</B>) and four core routers (<B>P1</B>–<B>P4</B>) give two paths across. Every router has a <B>NET</B>: area <M>49.0001</M>, a six-byte <B>System ID</B> and <M>00</M>. The NET names the router, not an interface.
            </p>
            <p>All six run IS-IS at <B>Level 2</B> only — one flat backbone. Each has a loopback (10.0.0.x) that other routers must reach; that reachability is what IS-IS is here to build.</p>
          </>
        ),
        show: ["nets"],
      },
      {
        title: "Watch the core come up",
        body: (
          <>
            <p>
              Every link starts with nothing. Each router sends <B>IIHs</B> (IS-IS hellos) straight in Ethernet frames — LLC, no IPv4 header — and lists in a three-way field which neighbor it hears. A router that hears a neighbor goes <B>Initializing</B>; once it hears its <B>own</B> System ID in the neighbor&apos;s hello, the adjacency is <B>Up</B>.
            </p>
            <p>Then each router builds an LSP describing itself and floods it. Press play and follow it link by link.</p>
          </>
        ),
        runs: [{ label: "Power up the core", actions: [{ type: "boot" }] }],
        show: ["adj"],
      },
      {
        title: "A new link: P1–P3",
        body: (
          <>
            <p>
              P1 and P3 are cabled together and addressed (192.0.2.12/31), but IS-IS doesn&apos;t run on that link. Enable it on <B>both</B> ends and watch one handshake closely: hellos with no neighbor listed, then hellos that list each other.
            </p>
          </>
        ),
        runs: [{ label: "Enable IS-IS on P1–P3 (both ends)", actions: [rung] }],
        show: ["adj:P1", "iih"],
        check: { q: "Why doesn't P3 call the adjacency Up as soon as it hears P1's first hello?", options: [{ id: "a", label: "It must first prove P1 also hears P3: Up only when P3 sees its own System ID in P1's hello" }, { id: "b", label: "It waits for an LSP from P1 first" }, { id: "c", label: "It needs P1's IPv4 address from ARP" }], answer: "a", why: "The three-way handshake (RFC 5303) prevents one-way adjacencies: you're Up only when the neighbor lists you, which proves both directions work." },
      },
      {
        title: "Only one end is not enough",
        body: <p>Now enable IS-IS on P1&apos;s end only. P1 sends hellos into the link — but P3&apos;s interface isn&apos;t an IS-IS interface, so it ignores them and sends none. No adjacency at either end.</p>,
        runs: [{ label: "Enable IS-IS on P1's end only", actions: [{ type: "set", text: "IS-IS enabled on P1 ge-0/0/2 only", changes: [setIf("P1", "ge-0/0/2", { isis: true })] }] }],
        show: ["adj:P1", "match:P1-P3"],
      },
    ],
  },
  {
    n: 2,
    title: "Every router describes itself",
    idea: "Each router originates one LSP — its neighbors and prefixes — and flooding gives every router an identical copy.",
    steps: [
      {
        title: "What P1 says about itself",
        body: (
          <>
            <p>
              P1&apos;s LSP (<M>P1.00-00</M>) lists its <B>neighbors</B> with its own outgoing metric to each (TLV 22) and the <B>prefixes</B> it owns (TLV 135): its loopback /32 and the /31 of each IS-IS link. It has a <B>sequence number</B>: higher means newer.
            </p>
            <p>This is the copy PE2 holds, two hops away — identical to P1&apos;s own.</p>
          </>
        ),
        show: ["lsp:P1"],
      },
      {
        title: "A change floods everywhere",
        body: (
          <>
            <p>Bring up P1–P3 again. Two routers now have a new neighbor, so two LSPs change: P1 and P3 each re-originate with sequence + 1. Watch the new copies cross the core hop by hop — each router installs the newer copy and passes it on, never back where it came from.</p>
          </>
        ),
        runs: [{ label: "Enable IS-IS on P1–P3", actions: [rung] }],
        show: ["seq"],
      },
      {
        title: "One database, six copies",
        body: <p>After flooding, every router holds the same set of LSPs with the same sequence numbers and checksums. That shared map is the whole point: each router will compute its own routes from it, and they will agree.</p>,
        pre: [rung],
        show: ["lsdb:PE1", "lsdb:PE2"],
        check: { q: "PE2 holds P1's LSP with sequence 0x5. P1 sends a copy with 0x4. What does PE2 do?", options: [{ id: "a", label: "Keeps 0x5: an older copy is never installed (it sends its newer copy back)" }, { id: "b", label: "Replaces it — the most recent arrival wins" }, { id: "c", label: "Keeps both" }], answer: "a", why: "Sequence numbers decide recency. A router that receives an older copy keeps its newer one and floods that back toward the sender." },
      },
    ],
  },
  {
    n: 3,
    title: "One map, each router's SPF",
    idea: "Every router runs SPF on its own copy of the map and installs the best paths as IPv4 routes.",
    steps: [
      {
        title: "PE1's shortest-path tree",
        body: (
          <>
            <p>
              PE1 runs SPF with itself as the root: Dijkstra over the LSPs, adding metrics. A link counts only if <B>both</B> ends list each other (the two-way check). PE2 is 30 away over P1–P2 <B>and</B> 30 over P3–P4: two equal-cost paths, both kept.
            </p>
          </>
        ),
        show: ["spf:PE1"],
      },
      {
        title: "From the tree to the routing table",
        body: <p>For every prefix in an LSP, PE1 adds the advertiser&apos;s distance and the prefix&apos;s own metric (10 for a loopback). 10.0.0.4/32 → 30 + 10 = 40, via both first hops. These are ordinary IPv4 routes, marked i L2, distance 115 on IOS XR (18 on Junos).</p>,
        show: ["rib:PE1"],
      },
      {
        title: "Traffic follows the table",
        body: <p>IS-IS never carries user traffic: it only fills the routing table. Trace from PE1 to PE2&apos;s loopback and watch each router look up 10.0.0.4 in its own table. With two equal paths, PE1 hashes this flow onto one of them.</p>,
        runs: [{ label: "traceroute 10.0.0.4 from PE1", actions: [{ type: "trace", from: "PE1", dst: "10.0.0.4", src: "10.0.0.1" }] }],
        show: ["path"],
        check: { q: "Another flow from PE1 to 10.0.0.4 could take the other path. Why?", options: [{ id: "a", label: "Both next hops are installed (ECMP); each flow is hashed onto one" }, { id: "b", label: "SPF alternates between paths every 10 seconds" }, { id: "c", label: "P1 forwards half of its packets to P3" }], answer: "a", why: "Equal-cost paths are all installed. Per-flow hashing keeps one flow on one path (no reordering) while different flows spread across both." },
      },
    ],
  },
  {
    n: 4,
    title: "Metrics move traffic",
    idea: "A metric is the cost of leaving a router on one interface — change it and SPF moves traffic, one direction at a time.",
    steps: [
      {
        title: "Make the top path expensive",
        body: <p>Set P1&apos;s outgoing metric toward P2 to 100. Only P1&apos;s LSP changes (one neighbor&apos;s metric), it floods, and every router reruns SPF: PE1 → PE2 over the top now costs 120, the bottom still 30.</p>,
        runs: [{ label: "P1 → P2 metric 100", actions: [metric100] }],
        show: ["seq", "spf:PE1"],
      },
      {
        title: "Metrics are one-way",
        body: (
          <>
            <p>
              The metric you changed is P1&apos;s cost <B>toward</B> P2. P2&apos;s cost toward P1 is still 10. Trace both directions: PE1 → PE2 avoids the top path, PE2 → PE1 still uses it. Same links, two directions, two costs.
            </p>
          </>
        ),
        pre: [metric100],
        runs: [
          { label: "trace PE1 → PE2", actions: [{ type: "trace", from: "PE1", dst: "10.0.0.4", src: "10.0.0.1" }] },
          { label: "trace PE2 → PE1", actions: [{ type: "trace", from: "PE2", dst: "10.0.0.1", src: "10.0.0.4" }], keep: true },
        ],
        show: ["paths"],
      },
      {
        title: "Overload: reachable, never transit",
        body: <p>The <B>overload bit</B> in an LSP says “don&apos;t route through me”. Set it on P1: every SPF still reaches P1 itself but stops computing paths through it. Engineers set it before maintenance, then clear it.</p>,
        runs: [
          { label: "Set the overload bit on P1", actions: [{ type: "set", text: "P1: overload bit set", changes: [setR("P1", { overload: true })] }] },
          { label: "ping P1's loopback from PE1", actions: [{ type: "ping", from: "PE1", dst: "10.0.0.2", src: "10.0.0.1" }], keep: true },
        ],
        show: ["spf:PE1", "path"],
      },
    ],
  },
  {
    n: 5,
    title: "What hellos must agree on",
    idea: "Before any adjacency, each router checks the other's hellos: levels, area (Level 1 only), MTU padding, keys.",
    steps: [
      {
        title: "No common level",
        body: <p>Change P2&apos;s P1-facing circuit to <M>circuit-type level-1</M>. P2 is a Level-2-only router, so that interface now runs no level at all: no usable hellos either way, and P1 gives up after its 30-second hold time. The link stays up; IS-IS doesn&apos;t.</p>,
        runs: [{ label: "P2 ge-0/0/0 circuit-type level-1", actions: [{ type: "set", text: "P2 ge-0/0/0: circuit-type level-1", changes: [setIf("P2", "ge-0/0/0", { circuit: "level-1" })] }] }],
        show: ["match:P1-P2"],
      },
      {
        title: "Areas matter only at Level 1",
        body: (
          <>
            <p>Move P3 into area 49.0002. Its Level-2 adjacencies don&apos;t even blink: Level 2 is the backbone between areas, so it never compares area addresses.</p>
            <p>Then make PE1 and P3 Level-1-2 routers and run PE1–P3 at Level 1 only. Now the areas must match — and they don&apos;t.</p>
          </>
        ),
        runs: [
          { label: "Put P3 in area 49.0002", actions: [{ type: "set", text: "P3: NET 49.0002.0000.0000.0005.00", changes: [setR("P3", { net: "49.0002.0000.0000.0005.00" })] }] },
          {
            label: "…and run PE1–P3 at Level 1 only",
            keep: true,
            actions: [{ type: "set", text: "PE1 and P3: is-type level-1-2; PE1 ge-0/0/1 and P3 ge-0/0/0 circuit-type level-1", changes: [setR("PE1", { isType: "level-1-2" }), setR("P3", { isType: "level-1-2" }), setIf("PE1", "ge-0/0/1", { circuit: "level-1" }), setIf("P3", "ge-0/0/0", { circuit: "level-1" })] }],
          },
        ],
        show: ["match:PE1-P3"],
      },
      {
        title: "MTU and hello padding",
        body: <p>IS-IS pads every hello to the full interface MTU, so a hello also proves the link can carry full-size frames. Raise P4&apos;s MTU toward P3 to 9014: P4&apos;s hellos are now too big for P3, which drops them as giants. P4 still hears P3 (Initializing); P3 hears nothing.</p>,
        runs: [{ label: "P4 ge-0/0/0 MTU 9014", actions: [{ type: "set", text: "P4 ge-0/0/0: MTU 1514 → 9014", changes: [setIf("P4", "ge-0/0/0", { mtu: 9014 })] }] }],
        show: ["match:P3-P4"],
      },
      {
        title: "A key on one side",
        body: <p>Configure an HMAC-MD5 hello key on P2&apos;s PE2-facing interface only. P2 now drops PE2&apos;s unauthenticated hellos; PE2, with no key configured, accepts P2&apos;s. Another one-way adjacency — this time P2 logs the drops.</p>,
        runs: [{ label: "Hello key on P2 ge-0/0/1 only", actions: [{ type: "set", text: "P2 ge-0/0/1: hello-password set (PE2 has none)", changes: [setIf("P2", "ge-0/0/1", { key: "C0re-Key" })] }] }],
        show: ["match:P2-PE2"],
        check: { q: "PE2 shows P2 as Initializing, P2 shows no PE2 at all. Which router's hellos are being dropped?", options: [{ id: "a", label: "PE2's: P2 doesn't accept them, so P2 never lists PE2" }, { id: "b", label: "P2's: PE2 drops them" }, { id: "c", label: "Both directions" }], answer: "a", why: "PE2 hears P2 (that's why PE2 is Initializing) but P2 never lists PE2 in its hellos — because P2 drops PE2's hellos. Initializing on one side points at the OTHER side's receive check." },
      },
    ],
  },
  {
    n: 6,
    title: "Read the evidence",
    idea: "From a symptom to its cause: the test, the links, the adjacencies, the LSPs, SPF, the routes.",
    steps: [
      {
        title: "Everything is Up — and PE2 is unreachable",
        body: <p>PE2&apos;s loopback has been taken out of IS-IS. Every adjacency is Up, every LSDB synchronized — yet PE1 can&apos;t reach 10.0.0.4. Run the test, then walk the ladder: each rung is read from the network and rules things in or out.</p>,
        pre: [{ type: "set", text: "PE2: Loopback0 removed from IS-IS", changes: [setR("PE2", { lo: false })] }],
        runs: [{ label: "ping 10.0.0.4 from PE1", actions: [{ type: "ping", from: "PE1", dst: "10.0.0.4", src: "10.0.0.1" }] }],
        show: ["ladder"],
      },
      {
        title: "A link fails: the core heals itself",
        body: <p>Now fail the P1–P2 link for real. The adjacency drops at once (interface down, no hold time), P1 and P2 re-originate without each other, SPF reruns everywhere, and traffic moves to the bottom path. Then test again: the service survives, on a different path.</p>,
        runs: [
          { label: "Fail P1–P2", actions: [{ type: "link", link: "P1-P2", up: false }] },
          { label: "trace PE1 → PE2", actions: [{ type: "trace", from: "PE1", dst: "10.0.0.4", src: "10.0.0.1" }], keep: true },
        ],
        show: ["ladder"],
      },
    ],
  },
];
