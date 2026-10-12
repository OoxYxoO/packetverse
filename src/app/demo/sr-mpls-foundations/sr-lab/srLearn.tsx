import type { ReactNode } from "react";
import type { SpLevel } from "@/components/sp-lab/spKit";
import type { SrAction, SrR, SrRtr } from "@/lib/sim-engine/scenarios/srNet";

/**
 * SR-MPLS Lab · Learn — six levels on the guided lesson's diamond:
 *   1 The IGP hands out the labels · 2 Following a Node SID · 3 A Node SID follows the IGP · 4 Adjacency SIDs ·
 *   5 Segment lists · 6 When it breaks
 */

const B = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;
const M = ({ children }: { children: ReactNode }) => <span className="pv-mono text-pv-text">{children}</span>;
const set = (text: string, dev: SrR, f: (c: SrRtr) => void): SrAction => ({ type: "set", text, changes: [{ dev, f }] });
const ping: SrAction = { type: "ping", from: "H1" };
const probe = (stack: number[]): SrAction => ({ type: "probe", stack, portable: true });
const r2r4metric50 = set("R2: metric 50 on the link to R4 (and R4 toward R2)", "R2", (c) => void (c.ifs["ge-0/0/1"]!.metric = 50));
const r4metric50 = set("R4: metric 50 toward R2", "R4", (c) => void (c.ifs["ge-0/0/0"]!.metric = 50));
const r4srgb17 = set("R4: SRGB moved to 17000–24999", "R4", (c) => void (c.srgb = { start: 17000, range: 8000 }));
const r4noSr = set("R4: segment routing disabled", "R4", (c) => void (c.sr = false));

export const SR_LEVELS: SpLevel<SrAction>[] = [
  {
    n: 1,
    title: "The IGP hands out the labels",
    idea: "No LDP, no RSVP: IS-IS itself advertises each router's label range (SRGB) and an index for its loopback. Every router turns the same index into the same label.",
    steps: [
      {
        title: "An index, not a label",
        body: (
          <p>
            Each router advertises its <B>SRGB</B> — here 16000–23999 everywhere — and a <B>Prefix-SID index</B> for its loopback: R6 says &quot;10.0.0.6/32 is index 6&quot;. Every other router computes the label itself: SRGB start + index = <M>16006</M>. Look at the label table: six Node SIDs, the same numbers on every router.
          </p>
        ),
        show: ["sids", "labels"],
        check: { q: "R3 receives R6's advertisement: index 6. Which label does R3 install for 10.0.0.6?", options: [{ id: "a", label: "16006 — its own SRGB start (16000) plus the index" }, { id: "b", label: "Whatever label R6 chose to send it" }, { id: "c", label: "6" }], answer: "a", why: "The index is global; the label is local arithmetic. With identical SRGBs every router lands on 16006 — which is why SR labels look global." },
      },
      {
        title: "Customer traffic needs the labels",
        body: <p>R1 and R6 exchange the customer prefixes by iBGP; R2–R5 run no BGP and don&apos;t know 192.168.6.0/24. So R1 must send H1&apos;s packet <B>labeled</B> toward R6&apos;s loopback, the BGP next hop: it pushes 16006. Ping H6 from H1 and watch.</p>,
        runs: [{ label: "Ping 192.168.6.20 from H1", actions: [ping] }],
        show: ["test", "path"],
      },
    ],
  },
  {
    n: 2,
    title: "Following a Node SID",
    idea: "A Node SID means “take me to this router along the shortest path”. Every transit router swaps the label for the same value; the last hop before the owner pops it.",
    steps: [
      {
        title: "Swap to the same label, pop at the end",
        body: <p>R1 pushes 16006 toward R2 (its shortest path to R6). R2 looks up 16006, swaps it to 16006 — the label from R4&apos;s SRGB — and sends it to R4. R4&apos;s next hop is R6 itself, the owner: R4 pops the label (<B>penultimate-hop popping</B>), and R6 receives plain IP.</p>,
        runs: [{ label: "Ping 192.168.6.20 from H1", actions: [ping] }],
        show: ["path", "fwd"],
        check: { q: "Why does R2 swap 16006 to 16006 instead of to a different label?", options: [{ id: "a", label: "R4 uses the same SRGB, so R4's label for index 6 is also 16006" }, { id: "b", label: "SR labels can never change hop by hop" }, { id: "c", label: "R2 doesn't look at the label" }], answer: "a", why: "R2 swaps to the next hop's label for index 6. With a different SRGB on R4, R2 would swap to a different number — see the next step." },
      },
      {
        title: "A different SRGB on R4",
        body: <p>Move R4&apos;s SRGB to 17000–24999. R4&apos;s label for index 6 becomes 17006, so R2 now swaps 16006 → <B>17006</B>. Still the same segment, still delivered — the index is what&apos;s global, not the number.</p>,
        runs: [{ label: "R4: SRGB 17000–24999, then ping", actions: [r4srgb17, ping] }],
        show: ["path", "fwd"],
      },
    ],
  },
  {
    n: 3,
    title: "A Node SID follows the IGP",
    idea: "The Node SID says where to go, not how. Change a metric and the very same label takes another path — with no signaling at all.",
    steps: [
      {
        title: "Same label, new path",
        body: <p>Raise the R2–R4 metric to 50. The top path now costs 70, the bottom 45. Ping again: R1 still pushes <M>16006</M>, but sends it to R3, and R3 and R5 do the swapping. Nothing was re-signaled; every router just recomputed SPF.</p>,
        runs: [{ label: "R2–R4 metric 50, then ping", actions: [r2r4metric50, r4metric50, ping] }],
        show: ["path", "igp"],
        check: { q: "What changed in the packet R1 sends?", options: [{ id: "a", label: "Nothing: still 16006 — only the outgoing interface changed" }, { id: "b", label: "R1 now pushes R3's and R5's Node SIDs" }, { id: "c", label: "R1 now pushes an Adjacency SID" }], answer: "a", why: "A Node SID is “shortest path to R6”. Which path that is, the IGP decides, hop by hop." },
      },
    ],
  },
  {
    n: 4,
    title: "Adjacency SIDs",
    idea: "An Adjacency SID means “out of this one link” — but only at the router that owns it. It's a local instruction.",
    steps: [
      {
        title: "One label per link, per router",
        body: (
          <p>
            Each router also allocates a label per IS-IS adjacency. In this lab (as in the guided lesson) R3&apos;s Adjacency SID toward R5 is <M>24035</M> (Junos: 299811). Only R3 has it in its table. Look at R1&apos;s and R3&apos;s Adjacency SIDs — and notice R1 has no entry for 24035.
          </p>
        ),
        show: ["adj", "fwd"],
        check: { q: "R1 receives a packet whose top label is 24035. What happens?", options: [{ id: "a", label: "R1 drops it: 24035 is R3's local label, not R1's" }, { id: "b", label: "R1 sends it to R3, who owns it" }, { id: "c", label: "R1 sends it toward R5" }], answer: "a", why: "Adjacency SIDs aren't advertised as reachable destinations: a router acts only on the ones it allocated." },
      },
    ],
  },
  {
    n: 5,
    title: "Segment lists",
    idea: "Stack segments to steer: get to R3 (Node SID), take R3's link to R5 (Adjacency SID), then get to R6 (Node SID). The headend writes the whole path into the packet.",
    steps: [
      {
        title: "Steer through R3 and R5",
        body: <p>The top path is shortest, but this traffic must take R3–R5. R1 sends <M>[16003, 24035, 16006]</M>: R1 itself executes 16003 (R3 is its neighbor: pop), R3 executes its own Adjacency SID 24035 (pop, out to R5), R5 executes 16006 (R6 is its neighbor: pop). The core keeps no per-path state. On Junos the Adjacency SID is 299811.</p>,
        runs: [{ label: "Send [16003, R3→R5 Adj-SID, 16006] from R1", actions: [probe([16003, 24035, 16006])] }],
        show: ["test", "path"],
      },
      {
        title: "The guided lesson's mistake",
        body: <p>Now leave out the first segment: <M>[24035, 16006]</M>. R1 starts with 24035 — R3&apos;s local label — and has nothing for it. The packet dies at R1. A segment list must first bring the packet to the router that owns the Adjacency SID.</p>,
        runs: [{ label: "Send [R3→R5 Adj-SID, 16006] from R1", actions: [probe([24035, 16006])] }],
        show: ["test", "path"],
        check: { q: "How do you fix the list?", options: [{ id: "a", label: "Put R3's Node SID (16003) in front: [16003, 24035, 16006]" }, { id: "b", label: "Advertise 24035 in IS-IS from R1" }, { id: "c", label: "Replace 16006 with 24056" }], answer: "a", why: "The first segment gets the packet to R3; only then can R3 execute its Adjacency SID." },
      },
    ],
  },
  {
    n: 6,
    title: "When it breaks",
    idea: "No LDP sessions to check: the evidence is in the IS-IS database and the label tables. Read them in order.",
    steps: [
      {
        title: "A router without segment routing",
        body: <p>Disable segment routing on R4. IS-IS still runs and every loopback is still reachable — but R4 advertises no SRGB. R2 has no label to send toward R6 through R4. On IOS XR, R2 programs 16006 as <B>Unlabelled</B> and the customer packet reaches R4 as plain IP, where — no BGP in the core — it dies. Junos installs nothing at R2.</p>,
        runs: [{ label: "R4: no segment routing, then ping", actions: [r4noSr, ping] }],
        show: ["test", "ladder"],
      },
      {
        title: "Read the ladder",
        body: <p>The ladder walks the evidence from the IGP up: adjacencies and path, SR capability and SRGB, Prefix-SIDs and conflicts, the labels hop by hop, and finally whether R1 sends the customer traffic labeled at all.</p>,
        pre: [r4noSr],
        runs: [{ label: "Ping 192.168.6.20 from H1", actions: [ping] }],
        show: ["ladder"],
        check: { q: "Which rung fails first?", options: [{ id: "a", label: "SR capability: R4 is not SR-capable" }, { id: "b", label: "The IS-IS adjacencies" }, { id: "c", label: "The BGP route at R1" }], answer: "a", why: "IS-IS is fine; the first missing piece is R4's segment routing — everything after follows from it." },
      },
    ],
  },
];
