import type { ReactNode } from "react";
import type { SpLevel } from "@/components/sp-lab/spKit";
import { MP_ROUTERS, type IfName, type MpAction, type MpIf, type MpR, type MpRtr } from "@/lib/sim-engine/scenarios/mplsNet";

/**
 * MPLS + LDP Lab · Learn — six levels on a fresh copy of the core:
 *   1 Why labels: a BGP-free core · 2 LDP finds neighbors · 3 Labels flow upstream · 4 Push, swap, pop ·
 *   5 Labels follow the IGP · 6 Read the evidence
 */

const B = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;
const M = ({ children }: { children: ReactNode }) => <span className="pv-mono text-pv-text">{children}</span>;
const setIf = (dev: MpR, ifn: IfName, patch: Partial<MpIf>) => ({ dev, f: (r: MpRtr) => void Object.assign(r.ifs[ifn]!, patch) });
const setR = (dev: MpR, patch: Partial<MpRtr>) => ({ dev, f: (r: MpRtr) => void Object.assign(r, patch) });
const ldpOff: MpAction = { type: "set", text: "LDP switched off on every router", changes: MP_ROUTERS.map((r) => setR(r, { ldpOn: false })) };
const ce = (size = 100): MpAction => ({ type: "test", kind: "ce", from: "CE1", dst: "10.2.2.20", size });

export const MP_LEVELS: SpLevel<MpAction>[] = [
  {
    n: 1,
    title: "Why labels",
    idea: "The core routers run no BGP, so they can't route customer traffic — labels carry it for them.",
    steps: [
      {
        title: "A BGP-free core",
        body: (
          <>
            <p>
              CE1 (10.1.1.10) wants to reach CE2 (10.2.2.20). <B>PE1</B> knows where 10.2.2.0/24 is: it learned it by iBGP from PE2, with next hop <M>4.4.4.4</M> — PE2&apos;s loopback. The core routers <B>P1–P4</B> run only IS-IS. They know every loopback, but no customer prefix at all.
            </p>
            <p>That&apos;s deliberate: a core that carries no customer routes stays small and stable, whatever the customers do.</p>
          </>
        ),
        show: ["routes"],
      },
      {
        title: "Without labels, the core is stuck",
        body: <p>With LDP switched off everywhere, PE1 forwards CE1&apos;s packet as plain IP toward 4.4.4.4&apos;s next hop, P1. P1 looks up <M>10.2.2.20</M> — and has no route. The packet dies in the middle of a perfectly healthy core.</p>,
        pre: [ldpOff],
        runs: [{ label: "ping CE2 from CE1", actions: [ce()] }],
        show: ["path"],
      },
      {
        title: "…while every loopback answers",
        body: <p>Same core, same moment: PE1 pings PE2&apos;s loopback, and it works — P1 and P2 have IS-IS routes to 4.4.4.4. The core can reach the PEs; it just can&apos;t route on the customer&apos;s address. What PE1 needs is a way to say “take this to 4.4.4.4” that the core understands.</p>,
        pre: [ldpOff],
        runs: [{ label: "ping 4.4.4.4 from PE1", actions: [{ type: "test", kind: "ping", from: "PE1", dst: "4.4.4.4" }] }],
        show: ["path"],
        check: { q: "Why can P1 forward the loopback ping but not CE1's packet?", options: [{ id: "a", label: "P1 has an IS-IS route to 4.4.4.4 but no route to 10.2.2.0/24 — only the PEs have BGP routes" }, { id: "b", label: "P1 blocks customer traffic with a filter" }, { id: "c", label: "CE1's packet is too large" }], answer: "a", why: "The core only knows loopbacks. MPLS lets PE1 put the packet in a label that means “toward 4.4.4.4”, so the core never needs the customer route." },
      },
    ],
  },
  {
    n: 2,
    title: "LDP finds neighbors",
    idea: "Hellos on each link discover neighbors; a TCP session between loopbacks carries the labels.",
    steps: [
      {
        title: "Switch LDP on",
        body: (
          <>
            <p>
              Each LDP interface sends <B>Hellos</B> (UDP 646 to 224.0.0.2): “I speak LDP, and my transport address is my loopback”. Two routers that hear each other then open <B>TCP 646</B> between their loopbacks — the session. Only then do they exchange labels.
            </p>
            <p>Watch Hellos, then sessions, then label mappings spreading upstream from PE2.</p>
          </>
        ),
        pre: [ldpOff],
        runs: [{ label: "Start LDP on every router", actions: [{ type: "ldp-boot" }] }],
        show: ["sessions"],
      },
      {
        title: "The session rides on the IGP",
        body: <p>The session is TCP between loopbacks, so it needs an IGP route to the neighbor&apos;s loopback. Remove P2&apos;s loopback from IS-IS: P1 still hears P2&apos;s Hellos on the link, but it can&apos;t reach 3.3.3.3, so no session ever forms.</p>,
        runs: [{ label: "Remove P2's loopback from IS-IS", actions: [{ type: "set", text: "P2: Loopback0 removed from IS-IS", changes: [setR("P2", { lo: false })] }] }],
        show: ["sessions", "disc:P1"],
        check: { q: "P1 lists P2 as an LDP discovery source, yet there is no session. What does P1 need?", options: [{ id: "a", label: "An IGP route to P2's transport address 3.3.3.3" }, { id: "b", label: "A second link to P2" }, { id: "c", label: "A label from P2" }], answer: "a", why: "Hellos only prove the link. The session is a TCP connection to the neighbor's transport address — no route, no session." },
      },
    ],
  },
  {
    n: 3,
    title: "Labels flow upstream",
    idea: "Each router picks its own label for each FEC and advertises it to its neighbors; the egress asks for a pop.",
    steps: [
      {
        title: "One FEC, one label per router",
        body: (
          <>
            <p>
              A <B>FEC</B> (forwarding equivalence class) is “everything going to 4.4.4.4/32”. PE2 owns it and advertises <B>implicit-null</B> (label 3): “don&apos;t give me a label, just IP”. P2 picks its own label for it and advertises that; P1 does the same, and so on upstream. Labels are <B>local</B>: each router&apos;s number only means something to that router.
            </p>
          </>
        ),
        show: ["chain"],
      },
      {
        title: "Every binding is kept",
        body: <p>PE1 hears a label for 4.4.4.4 from <B>both</B> neighbors — P1 and P3. It uses P1&apos;s, because IS-IS says P1 is the next hop, but it keeps P3&apos;s too (<B>liberal retention</B>). If the path ever moves to P3, the label is already there.</p>,
        show: ["bindings:PE1"],
        check: { q: "PE1's LIB has labels from P1 and P3 for 4.4.4.4/32. Which one goes in the LFIB?", options: [{ id: "a", label: "The one from the IS-IS next hop (P1)" }, { id: "b", label: "The lower label number" }, { id: "c", label: "Both, alternating" }], answer: "a", why: "LDP follows the IGP: the outgoing label is the one learned from the IGP next hop. The others wait in the LIB." },
      },
    ],
  },
  {
    n: 4,
    title: "Push, swap, pop",
    idea: "PUSH at the ingress PE, SWAP in the core, POP one hop before the egress.",
    steps: [
      {
        title: "A customer packet crosses the core",
        body: <p>PE1 finds 10.2.2.20 behind BGP next hop 4.4.4.4 and <B>pushes</B> the label P1 gave it. P1 looks only at the label and <B>swaps</B> it for P2&apos;s. P2&apos;s outgoing label is implicit-null, so it <B>pops</B> and hands PE2 a plain IP packet, which PE2 routes to CE2. No core router ever looks at 10.2.2.20.</p>,
        runs: [{ label: "ping CE2 from CE1", actions: [ce()] }],
        show: ["path", "shim"],
      },
      {
        title: "Explicit-null: keep the label to the end",
        body: <p>Penultimate-hop popping saves PE2 a lookup. Some networks prefer the egress to receive a label (for example to keep the traffic-class bits): PE2 can advertise <B>explicit-null</B> (label 0) instead. Now P2 swaps to 0 and PE2 pops it.</p>,
        runs: [
          { label: "PE2 advertises explicit-null", actions: [{ type: "set", text: "PE2: advertise explicit-null", changes: [setR("PE2", { explicitNull: true })] }] },
          { label: "ping CE2 from CE1", actions: [ce()], keep: true },
        ],
        show: ["path"],
      },
      {
        title: "LSP ping: test the label path itself",
        body: <p>An ordinary ping to a loopback may not even use labels. <M>ping mpls</M> sends an MPLS echo request down the LSP for one FEC and fails if any hop has to forward it without a label. It&apos;s how engineers prove an LSP, not just reachability.</p>,
        runs: [{ label: "ping mpls 4.4.4.4/32 from PE1", actions: [{ type: "test", kind: "lsp", from: "PE1", dst: "4.4.4.4" }] }],
        show: ["path"],
      },
    ],
  },
  {
    n: 5,
    title: "Labels follow the IGP",
    idea: "When IS-IS moves the path, the LFIB moves with it — using labels already learned.",
    steps: [
      {
        title: "A link fails",
        body: <p>Fail P1–P2. IS-IS moves 4.4.4.4 to the bottom path; PE1&apos;s outgoing label for it switches to the one P3 had already given it. Then send customer traffic again.</p>,
        runs: [
          { label: "Fail P1–P2", actions: [{ type: "link", link: "P1-P2", up: false }] },
          { label: "ping CE2 from CE1", actions: [ce()], keep: true },
        ],
        show: ["lfib:PE1", "path"],
      },
      {
        title: "A path where LDP never ran",
        body: <p>Now the same failure in a network where nobody enabled LDP on P3–P4. IS-IS happily uses the bottom path — it doesn&apos;t know about LDP — but P3 has no label from P4. The customer packet loses its label at P3 and P4 can&apos;t route it.</p>,
        pre: [{ type: "set", text: "LDP not enabled on P3–P4", changes: [setIf("P3", "ge-0/0/1", { ldp: false }), setIf("P4", "ge-0/0/0", { ldp: false })] }, { type: "link", link: "P1-P2", up: false }],
        runs: [{ label: "ping CE2 from CE1", actions: [ce()] }],
        show: ["path"],
      },
      {
        title: "LDP–IGP synchronization",
        body: <p>The fix for “the IGP uses a link LDP isn&apos;t ready on” is <B>LDP–IGP synchronization</B>: on a link where LDP isn&apos;t operational, IS-IS advertises the maximum metric, so traffic avoids it until labels are there. Enable it on P1–P2, then break LDP there (IS-IS stays up).</p>,
        pre: [{ type: "set", text: "LDP-IGP sync on P1–P2 (both ends)", changes: [setIf("P1", "ge-0/0/1", { sync: true }), setIf("P2", "ge-0/0/0", { sync: true })] }],
        runs: [
          { label: "Disable LDP on P1's P2-facing interface", actions: [{ type: "set", text: "P1: LDP removed from ge-0/0/1", changes: [setIf("P1", "ge-0/0/1", { ldp: false })] }] },
          { label: "ping CE2 from CE1", actions: [ce()], keep: true },
        ],
        show: ["igp:PE1", "path"],
      },
    ],
  },
  {
    n: 6,
    title: "Read the evidence",
    idea: "Customers down but loopbacks fine? Walk: the IGP, LDP sessions, bindings, LFIB, LSP ping.",
    steps: [
      {
        title: "IP works, labels don't",
        body: <p>Someone removed LDP from P1&apos;s P2-facing interface. Run the user&apos;s test and an LSP ping, then walk the ladder — each rung is read from the network.</p>,
        pre: [{ type: "set", text: "P1: LDP removed from ge-0/0/1", changes: [setIf("P1", "ge-0/0/1", { ldp: false })] }],
        runs: [
          { label: "ping CE2 from CE1", actions: [ce()] },
          { label: "ping mpls 4.4.4.4/32 from PE1", actions: [{ type: "test", kind: "lsp", from: "PE1", dst: "4.4.4.4" }], keep: true },
        ],
        show: ["ladder"],
      },
      {
        title: "Small works, big doesn't",
        body: <p>A label adds 4 bytes. P1–P2 now has a 1514-byte MTU (1500 bytes of IP): small packets fit, a 1500-byte customer packet plus its label doesn&apos;t. Run both sizes.</p>,
        pre: [{ type: "set", text: "P1–P2 MTU 1514 (both ends)", changes: [setIf("P1", "ge-0/0/1", { mtu: 1514 }), setIf("P2", "ge-0/0/0", { mtu: 1514 })] }],
        runs: [
          { label: "ping CE2 (100 bytes)", actions: [ce(100)] },
          { label: "ping CE2 (1500 bytes, DF)", actions: [ce(1500)], keep: true },
        ],
        show: ["ladder"],
      },
    ],
  },
];
