import type { ReactNode } from "react";
import type { SpLevel } from "@/components/sp-lab/spKit";
import type { FaAction, FaR, FaRtr } from "@/lib/sim-engine/scenarios/faNet";

/**
 * SR Flex-Algo Lab · Learn — six levels on the guided lesson's network:
 *   1 One topology for everyone · 2 A second topology · 3 Algorithm-specific SIDs · 4 A definition, not a path ·
 *   5 Who decides the definition · 6 When it breaks
 */

const B = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;
const M = ({ children }: { children: ReactNode }) => <span className="pv-mono text-pv-text">{children}</span>;
const set = (text: string, changes: { dev: FaR; f: (c: FaRtr) => void }[]): FaAction => ({ type: "set", text, changes });
const pingH6: FaAction = { type: "ping", to: "H6" };
const pingH66: FaAction = { type: "ping", to: "H66" };
const detour = set("FAD 128 without the BLUE exclusion; R3–R5 advertises 80 ms on both ends", [
  { dev: "R1", f: (c) => void (c.fa[128].excl = []) },
  { dev: "R3", f: (c) => void (c.ifs["ge-0/0/1"]!.delay = 80000) },
  { dev: "R5", f: (c) => void (c.ifs["ge-0/0/0"]!.delay = 80000) },
]);
const r6fad = set("R6 advertises its own FAD 128: priority 200, IGP metric, no exclusion", [{ dev: "R6", f: (c) => void (c.fa[128] = { prio: 200, mt: "igp", excl: [], incl: [], adv: true }) }]);
const r3out = set("R3 stops participating in Flex-Algo 128", [{ dev: "R3", f: (c) => void delete c.fa[128] }]);

export const FA_LEVELS: SpLevel<FaAction>[] = [
  {
    n: 1,
    title: "One topology for everyone",
    idea: "Algorithm 0 is the ordinary IGP: one shortest-path tree per router, built on the IGP metric, used by every prefix SID you have met so far.",
    steps: [
      {
        title: "The default path",
        body: <p>H1 sends to H6. R1 pushes R6&apos;s Node SID <M>16006</M> and the packet takes the IGP shortest path: R1 → R2 → R4 → R6, cost 30. Those three links each add 30 ms of delay — the top crosses a long-haul route. One-way latency: <B>90 ms</B>.</p>,
        runs: [{ label: "Ping 192.168.6.20 from H1", actions: [pingH6] }],
        show: ["test", "paths"],
        check: { q: "Why does algorithm 0 take the 90 ms path when a 15 ms path exists?", options: [{ id: "a", label: "Its SPF uses the IGP metric (30 vs 60) and knows nothing about delay" }, { id: "b", label: "The bottom links are down" }, { id: "c", label: "R1 prefers BLUE links" }], answer: "a", why: "Algorithm 0 is one calculation with one metric. Delay is advertised, but algorithm 0 doesn't use it." },
      },
    ],
  },
  {
    n: 2,
    title: "A second topology",
    idea: "A Flex-Algo Definition (FAD) tells every participating router how to compute an extra topology: which metric, which links. Flex-Algo 128 here: delay metric, exclude BLUE.",
    steps: [
      {
        title: "The definition",
        body: (
          <p>
            R1 advertises the definition of Flex-Algo 128 in IS-IS: <B>metric-type delay</B>, <B>affinity exclude-any BLUE</B>, priority 100. Every router with <M>flex-algo 128</M> configured participates and runs a second SPF with those rules. The BLUE top links are not in that topology at all; the bottom links win on delay: 5 + 5 + 5 ms.
          </p>
        ),
        show: ["fad", "paths"],
      },
      {
        title: "The low-latency app",
        body: <p>H66 (<M>192.168.66.20</M>) is the low-latency app. R6 colors its prefix with 128, and R1&apos;s SR policy LOW-LATENCY (color 128, constraint <B>sid-algorithm 128</B>) resolves to one label: <M>16106</M>, R6&apos;s algorithm-128 prefix SID. Ping it: 15 ms over the bottom — same destination router, different algorithm, different path.</p>,
        runs: [{ label: "Ping 192.168.66.20 from H1", actions: [pingH66] }],
        show: ["test", "path"],
        check: { q: "Did R1 push a list of hops to force the bottom path?", options: [{ id: "a", label: "No — one label, 16106; every router forwards it on its own algorithm-128 tree" }, { id: "b", label: "Yes — [16003, 16005, 16106]" }, { id: "c", label: "Yes — Adjacency SIDs" }], answer: "a", why: "The path comes from the distributed algorithm, not from the headend's label stack." },
      },
    ],
  },
  {
    n: 3,
    title: "Algorithm-specific SIDs",
    idea: "Each router advertises one prefix SID per algorithm for the same loopback. The label says which tree to follow.",
    steps: [
      {
        title: "Two labels, one prefix",
        body: <p>R6&apos;s loopback 10.0.0.6/32 carries index 6 for algorithm 0 (<M>16006</M>) and index 106 for algorithm 128 (<M>16106</M>). On R1, 16006 goes to R2 and 16106 goes to R3. R3 swaps 16106 toward R5 — on its own algorithm-128 tree. R2 has no algorithm-128 label for R6 at all: every one of its links is BLUE.</p>,
        show: ["labels"],
        check: { q: "R2 receives a packet labeled 16106. What happens?", options: [{ id: "a", label: "Dropped: R2 has no algorithm-128 path to R6, so no entry for 16106" }, { id: "b", label: "R2 forwards it on algorithm 0" }, { id: "c", label: "R2 forwards it to R4" }], answer: "a", why: "R2 participates, but with all its links excluded it is cut off in algorithm 128's topology." },
      },
    ],
  },
  {
    n: 4,
    title: "A definition, not a path",
    idea: "Flex-Algo 128 names a rule. Change a link attribute or the rule and the same label takes another path.",
    steps: [
      {
        title: "The same algorithm finds another way",
        body: <p>Lift the BLUE exclusion on R1&apos;s definition and make R3–R5 advertise 80 ms (a long reroute in the transport network). Algorithm 128 now has three candidates: top 90 ms, bottom 5 + 80 + 5, and R1 → R3 → R4 → R6: 5 + 3 + 30 = <B>38 ms</B>. Same label 16106, new path.</p>,
        pre: [detour],
        runs: [{ label: "Ping 192.168.66.20 from H1", actions: [pingH66] }],
        show: ["test", "paths"],
        check: { q: "What did R1 have to change to move the traffic?", options: [{ id: "a", label: "Nothing in its forwarding config — the algorithm recomputed from the new attributes" }, { id: "b", label: "A new Flex-Algo number" }, { id: "c", label: "An explicit segment list" }], answer: "a", why: "The algorithm ID names the definition; the path is a result of the current topology." },
      },
    ],
  },
  {
    n: 5,
    title: "Who decides the definition",
    idea: "Several routers may advertise a definition for the same algorithm. Everyone uses the one with the highest priority (then the highest system-id) — so a stray definition can change the network.",
    steps: [
      {
        title: "A second definition wins",
        body: <p>R6 advertises a test definition for 128: priority <B>200</B>, IGP metric, no exclusion. It beats R1&apos;s priority 100, so every router recomputes algorithm 128 with the IGP metric over all links — the top path. Policy LOW-LATENCY stays up and still pushes 16106; the app gets 90 ms.</p>,
        pre: [r6fad],
        runs: [{ label: "Ping 192.168.66.20 from H1", actions: [pingH66] }],
        show: ["fad", "test"],
        check: { q: "Where do you see it first?", options: [{ id: "a", label: "show isis flex-algo 128: Definition Source R6.00, priority 200, Equal to Local: No" }, { id: "b", label: "The policy is down" }, { id: "c", label: "R6 lost its prefix SID" }], answer: "a", why: "The policy is fine — it faithfully follows a definition nobody intended." },
      },
    ],
  },
  {
    n: 6,
    title: "When it breaks",
    idea: "Flex-Algo needs every router on the path to participate. Take one out and the algorithm's topology tears — without anything else looking broken.",
    steps: [
      {
        title: "A router stops participating",
        body: <p>R3 loses <M>flex-algo 128</M>. IS-IS and algorithm 0 are untouched, but R3 leaves algorithm 128&apos;s topology — and every non-BLUE way from R1 to R6 goes through R3. R1 has no algorithm-128 path, policy LOW-LATENCY goes down, and the colored route falls back to 16006: 90 ms.</p>,
        pre: [r3out],
        runs: [{ label: "Ping 192.168.66.20 from H1", actions: [pingH66] }],
        show: ["test", "ladder"],
      },
      {
        title: "Read the ladder",
        body: <p>The ladder walks from the symptom down: the latency and the label pushed, the policy, the winning definition, participation, R6&apos;s algorithm SID, and R1&apos;s algorithm-128 path.</p>,
        pre: [r3out],
        runs: [{ label: "Ping 192.168.66.20 from H1", actions: [pingH66] }],
        show: ["ladder"],
        check: { q: "Which rung shows the cause?", options: [{ id: "a", label: "Participation: R3 is missing" }, { id: "b", label: "The definition" }, { id: "c", label: "R6's prefix SID" }], answer: "a", why: "Definition and SIDs are fine; the topology lost R3." },
      },
    ],
  },
];
