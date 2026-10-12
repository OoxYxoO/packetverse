import type { ReactNode } from "react";
import type { SpLevel } from "@/components/sp-lab/spKit";
import type { PAction, PR, PRtr } from "@/lib/sim-engine/scenarios/s6pNet";

/**
 * SRv6 Policy Lab · Learn — six levels on the guided lesson's network:
 *   1 Intent and steering · 2 Two candidate paths · 3 What goes on the wire · 4 When a candidate fails ·
 *   5 The stale SID · 6 When it breaks
 */

const B = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;
const M = ({ children }: { children: ReactNode }) => <span className="pv-mono text-pv-text">{children}</span>;
const set = (text: string, changes: { dev: PR; f: (c: PRtr) => void }[]): PAction => ({ type: "set", text, changes });
const rx66: PAction = { type: "send", to: "RX66" };
const rx67: PAction = { type: "send", to: "RX67" };
const fail35: PAction = { type: "link", id: "R3-R5", up: false };
const noColor = set("R6: route-policy SET-COLOR-100 removed", [{ dev: "R6", f: (c) => void (c.colorOut = false) }]);

export const P6_LEVELS: SpLevel<PAction>[] = [
  {
    n: 1,
    title: "Intent and steering",
    idea: "An SR policy is an intent on the headend — ⟨R1, color 100, R6⟩. Traffic uses it only when it is steered: here by the color of its BGP route.",
    steps: [
      {
        title: "Two receivers behind R6",
        body: <p>R6 advertises two prefixes: <M>2001:db8:66::/64</M> (RX66, the low-latency app) with BGP color <B>100</B>, and <M>2001:db8:67::/64</M> (RX67) without. Send to both. RX66 is steered into policy LOW-LATENCY and takes the bottom: 15 ms. RX67 follows the IGP over the top: 60 ms.</p>,
        runs: [
          { label: "Send to RX66", actions: [rx66] },
          { label: "Send to RX67", actions: [rx67] },
        ],
        show: ["test", "policy"],
        check: { q: "Why does RX66 use the policy and RX67 not?", options: [{ id: "a", label: "Only RX66's route carries color 100, matching ⟨color 100, end-point R6⟩" }, { id: "b", label: "RX67 is too far away" }, { id: "c", label: "The policy only allows one prefix" }], answer: "a", why: "Color + BGP next hop = which policy. No color, no steering." },
      },
    ],
  },
  {
    n: 2,
    title: "Two candidate paths",
    idea: "The controller gave LOW-LATENCY two candidates: an explicit list (preference 200) and a dynamic minimum-delay path (preference 100). The valid one with the highest preference is active.",
    steps: [
      {
        title: "Explicit and dynamic",
        body: (
          <p>
            <B>Preference 200 — explicit:</B> <M>[2001:db8:100:3:41::]</M>, R3&apos;s End.X toward R5 — reachable directly under R3&apos;s locator, no need to visit R3&apos;s End first. <B>Preference 100 — dynamic:</B> the PCE computes the lowest-delay path R1 → R3 → R5 → R6 and encodes it as <M>[2001:db8:100:5:1::]</M>: R1&apos;s ordinary path to R5 already goes through R3. Both valid; 200 is active.
          </p>
        ),
        show: ["policy"],
        check: { q: "Both are valid. Which one wins, and why?", options: [{ id: "a", label: "The explicit one — validity first, then the highest preference" }, { id: "b", label: "The dynamic one — it is computed fresh" }, { id: "c", label: "Both, with load sharing" }], answer: "a", why: "RFC 9256: among valid candidates, the highest preference is active." },
      },
    ],
  },
  {
    n: 3,
    title: "What goes on the wire",
    idea: "R1 encapsulates: the policy's SIDs, then R6's service SID (End.DT6) learned from BGP. Endpoints execute; transit routers just route.",
    steps: [
      {
        title: "The SID list",
        body: <p>For RX66 R1 pushes <M>[R3 End.X→R5, R6 End.DT6]</M> (reduced encapsulation: DA = the first SID, SRH = the rest). R3 executes End.X — Segments Left 1 → 0, DA = R6&apos;s service SID, out to R5. R5 routes it; R6 decapsulates and looks the packet up in its global IPv6 table. The policy also has a <B>binding SID</B> on R1 (End.B6.Encaps): a handle another node could use to send traffic into the policy.</p>,
        runs: [{ label: "Send to RX66", actions: [rx66] }],
        show: ["headers", "sids"],
      },
    ],
  },
  {
    n: 4,
    title: "When a candidate fails",
    idea: "Fail R3–R5: R3 withdraws its End.X toward R5, the explicit candidate becomes invalid, and the PCE recomputes the dynamic one — the next valid candidate takes over.",
    steps: [
      {
        title: "R3–R5 fails",
        body: <p>The explicit list names a SID that no longer exists: <B>invalid</B>. The dynamic candidate is recomputed on the new topology: lowest delay is now R1 → R3 → R4 → R6 (5 + 15 + 20 = 40 ms), encoded <M>[2001:db8:100:3:1::]</M> — R3&apos;s End, then R3&apos;s own shortest path. Preference 100 becomes active.</p>,
        pre: [fail35],
        runs: [{ label: "Send to RX66", actions: [rx66] }],
        show: ["policy", "test"],
        check: { q: "Is this fast reroute?", options: [{ id: "a", label: "No — headend re-selection after the topology change; local protection is TI-LFA" }, { id: "b", label: "Yes — it switched in under 50 ms" }, { id: "c", label: "Yes — End.X is a protection SID" }], answer: "a", why: "Candidate switchover happens at the headend, after the IGP and PCE learn about the failure." },
      },
    ],
  },
  {
    n: 5,
    title: "The stale SID",
    idea: "Dynamic SIDs can come back with a different value. An explicit list that hard-codes a SID stays invalid until someone updates it.",
    steps: [
      {
        title: "R3–R5 is back, the explicit path isn't",
        body: <p>R3–R5 flaps and comes back — but R3 allocates its End.X toward R5 as <M>2001:db8:100:3:43::</M>. IPv6 is healthy, R3 shows its End.X SIDs, and still the explicit candidate is invalid: it names <M>…:3:41::</M>, which nobody advertises. A cousin of the guided lesson&apos;s incident: there R1&apos;s database had not re-verified the SID; here the SID itself changed.</p>,
        pre: [{ type: "flap" }],
        runs: [{ label: "Send to RX66", actions: [rx66] }],
        show: ["test", "policy", "sids"],
        check: { q: "What is the right repair?", options: [{ id: "a", label: "Update the explicit segment list with R3's current End.X SID" }, { id: "b", label: "Restart R3" }, { id: "c", label: "Raise the explicit preference" }], answer: "a", why: "The candidate is invalid, not low-preference: give it a SID that exists (or have the PCE build it from the adjacency)." },
      },
    ],
  },
  {
    n: 6,
    title: "When it breaks",
    idea: "A policy can be perfect and carry nothing: steering is a separate step.",
    steps: [
      {
        title: "The color is gone",
        body: <p>R6&apos;s export policy loses <M>route-policy SET-COLOR-100 out</M>. Policy LOW-LATENCY stays up with its explicit candidate active — and RX66&apos;s traffic follows the IGP at 60 ms, because nothing tells R1 to use the policy.</p>,
        pre: [noColor],
        runs: [{ label: "Send to RX66", actions: [rx66] }],
        show: ["test", "ladder"],
      },
      {
        title: "Read the ladder",
        body: <p>The ladder: what the app sees, whether the route is colored and matched, whether the policy is up and which candidate is active, why each candidate is valid or not, the explicit SIDs, and R3&apos;s current End.X SIDs.</p>,
        pre: [noColor],
        runs: [{ label: "Send to RX66", actions: [rx66] }],
        show: ["ladder"],
        check: { q: "Which rung shows the cause?", options: [{ id: "a", label: "Steering: the route has no color" }, { id: "b", label: "The candidates" }, { id: "c", label: "R3's SIDs" }], answer: "a", why: "The policy is fine; the traffic never reaches it." },
      },
    ],
  },
];
