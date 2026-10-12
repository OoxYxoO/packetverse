import type { ReactNode } from "react";
import type { SpLevel } from "@/components/sp-lab/spKit";
import type { SpAction, SpR, SpRtr } from "@/lib/sim-engine/scenarios/srpNet";

/**
 * SR Policy Lab · Learn — six levels on the guided lesson's network:
 *   1 From segments to intent · 2 Candidate paths · 3 Steering by color · 4 When a candidate fails ·
 *   5 No valid candidate · 6 When it breaks
 */

const B = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;
const M = ({ children }: { children: ReactNode }) => <span className="pv-mono text-pv-text">{children}</span>;
const set = (text: string, dev: SpR, f: (c: SpRtr) => void): SpAction => ({ type: "set", text, changes: [{ dev, f }] });
const gold: SpAction = { type: "ping", to: "H6" };
const dflt: SpAction = { type: "ping", to: "H60" };
const down = (id: string): SpAction => ({ type: "link", id, up: false });
const noColor = set("R6: route-policy SET-COLOR removed from the session to R1", "R6", (c) => void (c.colorOut = false));
const pref80 = set("R1: GOLD's explicit candidate preference changed to 80", "R1", (c) => void (c.policies[0].cands.find((k) => k.kind === "explicit")!.pref = 80));

export const SRP_LEVELS: SpLevel<SpAction>[] = [
  {
    n: 1,
    title: "From segments to intent",
    idea: "An SR policy turns segment lists into an intent: a color, an end-point, and the paths that can satisfy it. The headend owns it; the core never hears about it.",
    steps: [
      {
        title: "Two applications, one destination router",
        body: <p>H6 (<M>192.168.6.20</M>) runs the GOLD application; H60 (<M>192.168.60.20</M>) is ordinary traffic. Both sit behind R6. Ping both from H1: the GOLD traffic takes R3 and R5, the default traffic takes the shortest path through R2 and R4.</p>,
        runs: [
          { label: "Ping H6 (GOLD) from H1", actions: [gold] },
          { label: "Ping H60 (default) from H1", actions: [dflt], keep: true },
        ],
        show: ["test", "path"],
      },
      {
        title: "The policy behind it",
        body: <p>R1 runs SR policy <B>GOLD</B>: color <M>100</M>, end-point <M>10.0.0.6</M> (R6), binding SID <M>30001</M>. Color is an opaque number meaning &quot;this intent&quot; — not a label, not a DSCP value. (Color, end-point) is the policy&apos;s identity.</p>,
        show: ["pol"],
        check: { q: "What identifies an SR policy on its headend?", options: [{ id: "a", label: "Its color and its end-point" }, { id: "b", label: "Its first label" }, { id: "c", label: "The DSCP value of the traffic" }], answer: "a", why: "RFC 9256: an SR policy is identified by <headend, color, end-point>. The name is just a convenience." },
      },
    ],
  },
  {
    n: 2,
    title: "Candidate paths",
    idea: "A policy has candidate paths, each with a preference. The valid one with the highest preference is active; the others wait.",
    steps: [
      {
        title: "Explicit and dynamic",
        body: (
          <p>
            Preference <B>200</B> is explicit: segment-list GOLD-EXPLICIT, given as addresses — R3&apos;s loopback, R5&apos;s address on the R3–R5 link, R6&apos;s loopback — which R1 resolves to <M>[16003, 24035, 16006]</M>. Preference <B>100</B> is dynamic: R1 computes it, minimizing TE metric over links with affinity GOLD — today R1 → R3 → R5 → R6, encoded as <M>[16005, 16006]</M>.
          </p>
        ),
        show: ["cands"],
        check: { q: "Both candidates are valid. Which is active?", options: [{ id: "a", label: "Preference 200, the explicit one" }, { id: "b", label: "The dynamic one — computed paths always win" }, { id: "c", label: "Both, sharing the traffic" }], answer: "a", why: "Among valid candidates, the highest preference wins. Load sharing happens between segment lists of one candidate (weights), not between candidates." },
      },
      {
        title: "The binding SID",
        body: <p>R1 also allocated <M>30001</M> for the policy: a <B>binding SID</B>. Any packet that reaches R1 with 30001 on top gets the active segment list instead. It is a local label at R1 — a handle for the whole policy.</p>,
        runs: [{ label: "Send [30001] from R1", actions: [{ type: "probe", stack: [30001] }] }],
        show: ["fwd", "path"],
      },
    ],
  },
  {
    n: 3,
    title: "Steering by color",
    idea: "Traffic enters a policy because its BGP route carries the policy's color and its next hop is the policy's end-point. No color, no policy.",
    steps: [
      {
        title: "R6 colors one prefix",
        body: <p>R6 exports 192.168.6.0/24 with the extended community <B>color 100</B>; 192.168.60.0/24 goes out plain. On R1, the colored route&apos;s next hop 10.0.0.6 and color 100 match policy GOLD: the route is <B>steered</B> — its packets get the active segment list. That is automated steering.</p>,
        show: ["steer"],
        check: { q: "Which routes does R1 steer into GOLD?", options: [{ id: "a", label: "BGP routes with color 100 and next hop 10.0.0.6" }, { id: "b", label: "Every route via R6" }, { id: "c", label: "Every packet from H1" }], answer: "a", why: "Color and next hop must match the policy's color and end-point." },
      },
      {
        title: "Lose the color",
        body: <p>Remove the route-policy that sets the color on R6. Policy GOLD is still up — but no route asks for color 100 any more. The GOLD prefix now resolves over R6&apos;s Node SID like everything else.</p>,
        runs: [{ label: "R6: no color, then ping H6", actions: [noColor, gold] }],
        show: ["steer", "test"],
      },
    ],
  },
  {
    n: 4,
    title: "When a candidate fails",
    idea: "Every candidate is re-validated when the topology changes. If the active one becomes invalid, the next valid one takes over.",
    steps: [
      {
        title: "R3–R5 fails",
        body: <p>Take the R3–R5 link down. The explicit list names R5&apos;s address on that link — there is no adjacency to resolve it to any more, so preference 200 is <B>invalid</B>. R1 recomputes the dynamic candidate over the GOLD links that remain: R3 → R4 → R6, encoded <M>[16003, 16006]</M>. It becomes active.</p>,
        runs: [{ label: "R3–R5 down, then ping H6", actions: [down("R3-R5"), gold] }],
        show: ["cands", "path"],
        check: { q: "Is this fast reroute?", options: [{ id: "a", label: "No — the headend reacts after IS-IS converges; local protection is TI-LFA's job (a later lesson)" }, { id: "b", label: "Yes, it is TI-LFA" }, { id: "c", label: "Yes, R3 repairs it locally" }], answer: "a", why: "Candidate switchover is headend reoptimization. TI-LFA protects locally, at the point of failure, within 50 ms." },
      },
    ],
  },
  {
    n: 5,
    title: "No valid candidate",
    idea: "With every candidate invalid, the policy goes down. On IOS XR the steered routes then fall back to their ordinary path.",
    steps: [
      {
        title: "Both GOLD links gone",
        body: <p>Take R3–R5 and R3–R4 down. No GOLD path remains: both candidates are invalid and policy GOLD is <B>down</B>. The colored route no longer has a policy to use, so IOS XR resolves it over R6&apos;s Node SID — GOLD traffic still arrives, over R2 and R4. (The guided lesson keeps GOLD strict to make the point; an operator can choose either behavior.)</p>,
        runs: [{ label: "R3–R5 and R3–R4 down, then ping H6", actions: [down("R3-R5"), down("R3-R4"), gold] }],
        show: ["pol", "test"],
      },
    ],
  },
  {
    n: 6,
    title: "When it breaks",
    idea: "A policy can be up and still not do what was intended. Read the policy, its candidates, the steering and the labels — in that order.",
    steps: [
      {
        title: "Up, but the wrong candidate",
        body: <p>The guided lesson&apos;s incident: someone set the explicit candidate&apos;s preference to 80. Both candidates are valid, so the dynamic one (100) is active. Traffic flows — over the same routers, but with <M>[16005, 16006]</M>, not the engineered list.</p>,
        runs: [{ label: "Explicit preference 80, then ping H6", actions: [pref80, gold] }],
        show: ["cands", "path"],
      },
      {
        title: "The ladder",
        body: <p>The ladder reads the network: IS-IS and SR, the policy&apos;s state, color and end-point, each candidate&apos;s validity, the steering of the GOLD route, and whether every label of the active list exists where it is executed.</p>,
        pre: [pref80],
        runs: [{ label: "Ping H6", actions: [gold] }],
        show: ["ladder"],
        check: { q: "Which rung shows the problem?", options: [{ id: "a", label: "Candidates: preference 100 dynamic is active, the explicit one has 80" }, { id: "b", label: "Steering" }, { id: "c", label: "IS-IS" }], answer: "a", why: "Everything is up and steered; only the preferences don't match the intent." },
      },
    ],
  },
];
