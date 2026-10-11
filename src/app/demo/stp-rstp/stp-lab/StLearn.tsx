import type { ReactNode } from "react";
import { stClone, stHealthy, type StAction, type StCfg, type StHost } from "@/lib/sim-engine/scenarios/stpNet";

/**
 * Learn track of the STP Lab: six levels on the triangle the lesson uses (SW1–SW3, one host each). A step starts from a
 * known network (its `pre` actions are replayed silently through the model), then the learner runs the step's traffic
 * or hello and watches it. The questions: who is root, which way does each switch point to it, which port blocks —
 * and what happens when something changes?
 */

export type StShow = "election" | "costs" | "segments" | "journey" | "copies" | "timers";
export interface StStepRun {
  label: string;
  actions: StAction[];
  keep?: boolean;
}
export interface StCheck {
  q: string;
  options: { id: string; label: string }[];
  answer: string;
  why: string;
}
export interface StStep {
  title: string;
  body: ReactNode;
  pre?: StAction[];
  runs?: StStepRun[];
  show: StShow[];
  check?: StCheck;
}
export interface StLevel {
  n: number;
  title: string;
  idea: string;
  steps: StStep[];
}

const ping = (from: StHost, to: StHost): StAction => ({ type: "traffic", sends: [{ from, to, kind: "ping" }] });
const arp = (from: StHost, to: StHost): StAction => ({ type: "traffic", sends: [{ from, to, kind: "arp" }] });
const cfg = (text: string, f: (c: StCfg) => void, base: StCfg = stHealthy()): StAction => {
  const c = stClone(base);
  f(c);
  return { type: "cfg", cfg: c, text };
};
const noStp = (c: StCfg) => {
  c.sw.SW1.proto = "none";
  c.sw.SW2.proto = "none";
  c.sw.SW3.proto = "none";
};
const hello: StAction = { type: "hello" };

const B = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;
const M = ({ children }: { children: ReactNode }) => <span className="pv-mono text-pv-text">{children}</span>;

export const ST_LEVELS: StLevel[] = [
  {
    n: 1,
    title: "Why spanning tree",
    idea: "Redundant links between switches form a loop. Spanning tree keeps every cable but blocks just enough ports to leave one path.",
    steps: [
      {
        title: "Three switches, three cables",
        body: (
          <>
            <p>SW1, SW2 and SW3 are cabled in a triangle so that any one cable can fail. HOST-A, HOST-B and HOST-C hang off them. You met the danger in Switching: two paths between switches = a loop, and Ethernet has no TTL.</p>
            <p>For now spanning tree is <B>off</B> on all three switches. Every port forwards.</p>
          </>
        ),
        pre: [cfg("Spanning tree off everywhere", noStp)],
        show: ["segments"],
      },
      {
        title: "One broadcast, no spanning tree",
        body: (
          <>
            <p>HOST-A sends one ARP request. SW1 floods it to SW2 and SW3; each floods it on to the other; each copy comes back to SW1, which floods it again… The copies never die, hosts receive the same frame again and again, and the switches&apos; MAC tables flap.</p>
          </>
        ),
        pre: [cfg("Spanning tree off everywhere", noStp)],
        runs: [{ label: "HOST-A broadcasts one ARP request", actions: [arp("HOST-A", "HOST-B")] }],
        show: ["copies", "journey"],
      },
      {
        title: "Turn RSTP on",
        body: (
          <>
            <p>Now the switches run <B>RSTP</B> (Rapid Spanning Tree). They exchange BPDUs, agree on a tree, and one port of the triangle — SW3 <M>ge-0/0/2</M> — goes <B>Alternate / Discarding</B>. All three cables stay up; one end of one of them simply refuses to forward data.</p>
            <p>The same broadcast now reaches every host exactly once.</p>
          </>
        ),
        pre: [],
        runs: [{ label: "HOST-A broadcasts one ARP request", actions: [arp("HOST-A", "HOST-B")] }],
        show: ["copies", "segments"],
        check: {
          q: "With RSTP running, what happened to the SW2–SW3 cable?",
          options: [
            { id: "blk", label: "It is still up; SW3's end is Discarding, so no data crosses it" },
            { id: "down", label: "RSTP shut the link down" },
            { id: "half", label: "It carries data in one direction only" },
          ],
          answer: "blk",
          why: "The link stays up (and BPDUs still cross it — that's how SW3 knows when to take over). Only data is discarded at SW3's end, in both directions.",
        },
      },
    ],
  },
  {
    n: 2,
    title: "Electing the root",
    idea: "All switches agree on one root bridge: the lowest Bridge ID (priority first, MAC as tie-break). Every decision after that is relative to the root.",
    steps: [
      {
        title: "BPDUs: switches talking about the tree",
        body: (
          <>
            <p>Every 2 seconds each switch sends a <B>BPDU</B> out of its Designated ports, to the multicast MAC <M>01:80:C2:00:00:00</M>. It says: “I believe the root is X, and it costs me Y to reach it.” Switches consume BPDUs; they never forward them as data, and they are not IP.</p>
            <p>Send one round of hellos and read what each port received.</p>
          </>
        ),
        pre: [],
        runs: [{ label: "Send a Hello", actions: [hello] }],
        show: ["election", "journey"],
      },
      {
        title: "Lowest Bridge ID wins",
        body: (
          <>
            <p>SW1 has priority <M>24576</M>; SW2 and SW3 have the default <M>32768</M>. SW1 is root. Between SW2 and SW3 the priorities tie, so the lower MAC (SW2&apos;s) would win — it decides who is “better” on the SW2–SW3 link.</p>
            <p>Now SW3&apos;s priority is set to <M>4096</M>. Send a hello again: every BPDU now names SW3 as root, and the whole tree re-forms around it.</p>
          </>
        ),
        pre: [cfg("SW3: bridge priority 4096", (c) => (c.sw.SW3.priority = 4096))],
        runs: [{ label: "Send a Hello", actions: [hello] }],
        show: ["election", "segments"],
        check: {
          q: "Two switches have the same priority 32768. Which one is better in the election?",
          options: [
            { id: "mac", label: "The one with the lower MAC address" },
            { id: "ports", label: "The one with more ports" },
            { id: "first", label: "The one that was switched on first" },
          ],
          answer: "mac",
          why: "Bridge ID = priority + MAC. When priorities tie, the MAC decides. That's why engineers set priorities on purpose instead of letting MAC addresses pick the root.",
        },
      },
    ],
  },
  {
    n: 3,
    title: "Root ports and costs",
    idea: "Every non-root switch picks one Root Port: its cheapest path to the root, where the cost is added on the port where BPDUs arrive.",
    steps: [
      {
        title: "Each switch adds up the cost",
        body: (
          <>
            <p>The root advertises cost 0. SW2 receives it on <M>ge-0/0/1</M>, adds that port&apos;s cost (20000 for 1 Gb/s): 20000. SW2 could also reach the root through SW3: 20000 + 20000 = 40000. The cheaper wins — <M>ge-0/0/1</M> is SW2&apos;s <B>Root Port</B>. SW3 does the same.</p>
          </>
        ),
        pre: [],
        runs: [{ label: "HOST-C pings HOST-B", actions: [ping("HOST-C", "HOST-B")] }],
        show: ["costs", "journey"],
      },
      {
        title: "Change one cost",
        body: (
          <>
            <p>SW3 <M>ge-0/0/1</M> (toward SW1) gets cost <M>200000</M>. SW3&apos;s direct path now costs 200000; via SW2 it costs 20000 + 20000 = 40000. SW3&apos;s Root Port moves to <M>ge-0/0/2</M>, and HOST-C&apos;s traffic to HOST-A now goes through SW2.</p>
            <p>Note who changed what: the cost is on <B>SW3&apos;s</B> port, and only SW3&apos;s choice changed.</p>
          </>
        ),
        pre: [cfg("SW3 ge-0/0/1: cost 200000", (c) => (c.sw.SW3.ports["ge-0/0/1"].cost = 200000))],
        runs: [{ label: "HOST-C pings HOST-A", actions: [ping("HOST-C", "HOST-A")] }],
        show: ["costs", "segments"],
        check: {
          q: "To make SW3 prefer the path through SW2, on which port do you raise the cost?",
          options: [
            { id: "sw3", label: "SW3's port toward SW1 (where SW3 receives the root's BPDUs directly)" },
            { id: "sw1", label: "SW1's port toward SW3" },
            { id: "sw2", label: "SW2's port toward SW3" },
          ],
          answer: "sw3",
          why: "Root path cost is accumulated on RECEIVING ports. SW1's port cost doesn't enter SW3's sum: SW1 advertises cost 0 out of every port.",
        },
      },
    ],
  },
  {
    n: 4,
    title: "Designated and Alternate",
    idea: "On every link one end is Designated (it forwards onto the link). An end that is neither Root nor Designated is Alternate: Discarding, a ready backup.",
    steps: [
      {
        title: "Who owns each link",
        body: (
          <>
            <p>On each link the switch with the better offer (lower root cost, then lower Bridge ID) owns the <B>Designated</B> port. The root&apos;s ports are always Designated. On SW2–SW3 both offer cost 20000; SW2&apos;s Bridge ID is lower, so SW2&apos;s end is Designated and SW3&apos;s end — not its Root Port — becomes <B>Alternate</B>.</p>
          </>
        ),
        pre: [],
        show: ["segments", "costs"],
      },
      {
        title: "An Alternate port drops data, but still listens",
        body: (
          <>
            <p>HOST-B broadcasts. SW2 floods it on its Designated port toward SW3 — and SW3 <B>discards</B> it at its Alternate port. A hello afterwards shows the same port still <B>receiving BPDUs</B>: SW3 keeps hearing SW2, which is how it knows an alternative path exists.</p>
          </>
        ),
        pre: [],
        runs: [
          { label: "HOST-B broadcasts an ARP request", actions: [arp("HOST-B", "HOST-C")] },
          { label: "Send a Hello", actions: [hello] },
        ],
        show: ["journey", "copies"],
      },
    ],
  },
  {
    n: 5,
    title: "Failure and timing",
    idea: "When the active path breaks, the tree repairs itself. RSTP does it at once with an Alternate port; legacy STP waits 30–50 s; host ports should be edge.",
    steps: [
      {
        title: "Cut SW3's Root Port (RSTP)",
        body: (
          <>
            <p>The SW1–SW3 cable is pulled. SW3 loses its Root Port, and its Alternate port <M>ge-0/0/2</M> becomes the new Root Port <B>immediately</B> — RSTP had it ready. HOST-C pings HOST-A at once: it works, now via SW2. A topology change also flushes the MAC tables so frames find the new path.</p>
          </>
        ),
        pre: [ping("HOST-C", "HOST-A")],
        runs: [{ label: "Unplug SW1↔SW3, then HOST-C pings HOST-A", actions: [{ type: "link", link: "L13", up: false }, ping("HOST-C", "HOST-A")] }],
        show: ["segments", "timers"],
      },
      {
        title: "The same failure with legacy STP",
        body: (
          <>
            <p>SW3 now runs legacy <B>802.1D STP</B>. Same failure: the Alternate port must go <B>Listening</B> (15 s) and <B>Learning</B> (15 s) before it forwards. The immediate ping fails; after 30 s it works. That gap is why RSTP replaced STP.</p>
          </>
        ),
        pre: [cfg("SW3: legacy STP", (c) => (c.sw.SW3.proto = "stp")), { type: "wait", seconds: 60 }],
        runs: [
          { label: "Unplug SW1↔SW3, then HOST-C pings HOST-A", actions: [{ type: "link", link: "L13", up: false }, ping("HOST-C", "HOST-A")] },
          { label: "Wait 31 s, then ping again", keep: true, actions: [{ type: "wait", seconds: 31 }, ping("HOST-C", "HOST-A")] },
        ],
        show: ["timers", "journey"],
      },
      {
        title: "Host ports: edge",
        body: (
          <>
            <p>A PC never sends BPDUs, so RSTP can&apos;t agree with it. A host port that is <B>not edge</B> falls back to the slow path every time its link comes up: 30 s without network after each reboot. Here HOST-B&apos;s port has lost its edge setting — reseat the cable and ping at once.</p>
            <p>An <B>edge</B> port (Cisco <M>spanning-tree portfast</M> · Junos <M>edge</M>) forwards immediately and doesn&apos;t trigger topology changes.</p>
          </>
        ),
        pre: [cfg("SW2 ge-0/0/10: not edge", (c) => (c.sw.SW2.ports["ge-0/0/10"].edge = false))],
        runs: [{ label: "Reseat HOST-B's cable, then HOST-B pings HOST-A", actions: [{ type: "reseat", host: "HOST-B" }, ping("HOST-B", "HOST-A")] }],
        show: ["timers", "journey"],
        check: {
          q: "Why does a non-edge RSTP port toward a PC wait 30 s, while a port toward another RSTP switch forwards at once?",
          options: [
            { id: "agree", label: "The switch neighbor answers RSTP's proposal with an agreement; a PC never does, so the port falls back to timers" },
            { id: "slow", label: "PCs negotiate their link speed more slowly" },
            { id: "dhcp", label: "The switch waits for the PC's DHCP request" },
          ],
          answer: "agree",
          why: "RSTP's speed comes from the proposal/agreement handshake between switches. With nobody to agree, the port uses 2 × forward delay. Edge tells the switch there is nobody to wait for.",
        },
      },
    ],
  },
  {
    n: 6,
    title: "Protecting the tree",
    idea: "Spanning tree trusts every BPDU. Guards stop a stray switch from taking over; taking a port out of spanning tree brings the loop back.",
    steps: [
      {
        title: "A small switch on a spare port",
        body: (
          <>
            <p>Someone plugs a small switch into SW3&apos;s spare port <M>ge-0/0/11</M>. Its bridge priority is <B>4096</B> — better than SW1&apos;s. The port was edge, but on hearing BPDUs it becomes an ordinary RSTP port, and the small switch wins the election. Every switch re-points toward SW3; HOST-A ↔ HOST-B now detours through SW3.</p>
          </>
        ),
        pre: [ping("HOST-A", "HOST-B")],
        runs: [{ label: "Plug it in, then HOST-A pings HOST-B", actions: [{ type: "rogue", up: true }, ping("HOST-A", "HOST-B")] }],
        show: ["election", "segments"],
      },
      {
        title: "BPDU guard and root guard",
        body: (
          <>
            <p><B>BPDU guard</B> on <M>ge-0/0/11</M> (Cisco <M>spanning-tree bpduguard enable</M> · Junos <M>layer2-control bpdu-block</M>): the first BPDU err-disables the port. The small switch is cut off and SW1 is root again. <B>Root guard</B> (Cisco <M>spanning-tree guard root</M> · Junos <M>no-root-port</M>) would instead keep the port up but block it as “root-inconsistent” while better BPDUs arrive.</p>
          </>
        ),
        pre: [{ type: "rogue", up: true }, cfg("SW3 ge-0/0/11: BPDU guard", (c) => ((c.rogue = true), (c.sw.SW3.ports["ge-0/0/11"].bpduGuard = true)))],
        runs: [{ label: "Send a Hello, then HOST-A pings HOST-B", actions: [hello, ping("HOST-A", "HOST-B")] }],
        show: ["election", "segments"],
      },
      {
        title: "A port taken out of spanning tree",
        body: (
          <>
            <p>The most dangerous change: SW3 <M>ge-0/0/2</M> is taken out of spanning tree (Cisco <M>spanning-tree bpdufilter enable</M> · Junos <M>rstp interface ge-0/0/2 disable</M>). It sends and hears no BPDUs, so nothing ever blocks it — and SW2, hearing nothing, forwards too. The triangle loops again.</p>
          </>
        ),
        pre: [cfg("SW3 ge-0/0/2: out of spanning tree", (c) => (c.sw.SW3.ports["ge-0/0/2"].stpOff = true))],
        runs: [{ label: "HOST-A broadcasts one ARP request", actions: [arp("HOST-A", "HOST-B")] }],
        show: ["copies", "segments"],
        check: {
          q: "A port with BPDU filter (or rstp … disable) faces another switch. What does spanning tree do with it?",
          options: [
            { id: "nothing", label: "Nothing: it never sees BPDUs there, so it can't block it — a loop if there is another path" },
            { id: "block", label: "It blocks it, to be safe" },
            { id: "errdis", label: "It err-disables it" },
          ],
          answer: "nothing",
          why: "Spanning tree only knows what BPDUs tell it. Silence on a port looks like ‘no switch here’: the port forwards. Only BPDU guard reacts to BPDUs by shutting a port.",
        },
      },
    ],
  },
];
