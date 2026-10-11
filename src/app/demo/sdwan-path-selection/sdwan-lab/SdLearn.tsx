import type { ReactNode } from "react";
import { sdClone, sdHealthy, type Quality, type SdAction, type SdCfg, type SdClass, type SdTun } from "@/lib/sim-engine/scenarios/sdNet";

/**
 * Learn track of the SD-WAN Lab: six levels on the lesson's branch (two ISPs, two overlay tunnels to the hub). A step
 * starts from a known network (its `pre` actions are replayed silently through the model), then the learner measures,
 * changes the WAN's condition or sends a call / the backup. The questions: what did the edge measure, which paths meet
 * the SLA, what does the policy say for this application — and which path does it really take?
 */
export type SdShow = "paths" | "policy" | "journey";
export interface SdStepRun {
  label: string;
  actions: SdAction[];
  keep?: boolean;
}
export interface SdCheck {
  q: string;
  options: { id: string; label: string }[];
  answer: string;
  why: string;
}
export interface SdStep {
  title: string;
  body: ReactNode;
  pre?: SdAction[];
  runs?: SdStepRun[];
  show: SdShow[];
  check?: SdCheck;
}
export interface SdLevel {
  n: number;
  title: string;
  idea: string;
  steps: SdStep[];
}
const send = (...kinds: SdClass[]): SdAction => ({ type: "traffic", kinds });
const M1: SdAction = { type: "measure" };
const world = (tun: SdTun, q: Quality): SdAction => ({ type: "world", tun, q });
const cfg = (text: string, f: (c: SdCfg) => void, base: SdCfg = sdHealthy()): SdAction => {
  const c = sdClone(base);
  f(c);
  return { type: "cfg", cfg: c, text };
};
const B = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;
const M = ({ children }: { children: ReactNode }) => <span className="pv-mono text-pv-text">{children}</span>;

export const SD_LEVELS: SdLevel[] = [
  {
    n: 1,
    title: "Two circuits, two overlays",
    idea: "The branch has two internet circuits (the underlay) and an encrypted tunnel to the hub over each (the overlay). SD-WAN decides, per application, which tunnel to use.",
    steps: [
      {
        title: "The branch",
        body: (
          <>
            <p>ISP-A is the business line (<M>biz-internet</M>), ISP-B the cheaper public internet. Over each, the edge keeps a tunnel to the hub — like the VPN lesson, twice. Two applications: <B>VOICE</B> (calls, DSCP EF) and <B>BULK</B> (the nightly backup).</p>
          </>
        ),
        show: ["paths", "policy"],
      },
      {
        title: "A call",
        body: (
          <>
            <p>The edge classifies the packet as VOICE, looks at its policy (SLA required, prefer TUN-A) and its live path states, and sends it into <M>TUN-A</M>. The ISP only routes the outer header.</p>
          </>
        ),
        runs: [{ label: "Place a call", actions: [send("VOICE")] }],
        show: ["journey", "policy"],
      },
      {
        title: "The backup takes the other path",
        body: (
          <>
            <p>BULK prefers <M>TUN-B</M> and needs no SLA: it goes over the cheap line, keeping the business line free for voice. Same branch, same moment — different paths per application.</p>
          </>
        ),
        runs: [{ label: "Run the backup", actions: [send("BULK")] }],
        show: ["journey", "policy"],
        check: {
          q: "Who chooses the path for each packet?",
          options: [
            { id: "edge", label: "The branch edge, from its installed policy and its own live measurements" },
            { id: "ctrl", label: "The controller, packet by packet" },
            { id: "isp", label: "The ISPs" },
          ],
          answer: "edge",
          why: "Policy can be written centrally, but the decision is local: the edge applies it with what it measures right now.",
        },
      },
    ],
  },
  {
    n: 2,
    title: "Measuring the paths",
    idea: "Every interval the edge probes each tunnel and averages latency, jitter and loss. Reachable is not the same as good: a path can be up and still unfit for voice.",
    steps: [
      {
        title: "One measurement interval",
        body: (
          <>
            <p>Probes go over each tunnel to the hub and back (Cisco: BFD on every tunnel; Junos: RPM). Their averages are compared with the VOICE SLA class: <M>≤ 100 ms latency, ≤ 30 ms jitter, ≤ 1 % loss</M>.</p>
          </>
        ),
        runs: [{ label: "Measure one interval", actions: [M1] }],
        show: ["journey", "paths"],
      },
      {
        title: "Up is not good",
        body: (
          <>
            <p>ISP-A browns out: the circuit is UP, the tunnel reachable — but at the next interval the edge measures 160 ms, 40 ms jitter, 2 % loss. TUN-A <B>fails the SLA</B>: still usable, but not for voice.</p>
          </>
        ),
        pre: [world("TUN-A", "brownout")],
        runs: [{ label: "Measure one interval", actions: [M1] }],
        show: ["paths", "journey"],
      },
      {
        title: "Down is different",
        body: (
          <>
            <p>ISP-B fails completely: no probe comes back, the tunnel is <B>unreachable</B> — unusable for every application, not only voice.</p>
          </>
        ),
        pre: [world("TUN-B", "down")],
        runs: [{ label: "Measure one interval", actions: [M1] }],
        show: ["paths"],
        check: {
          q: "ISP-A browns out at 10:00:03. When does the edge react?",
          options: [
            { id: "next", label: "At the end of its next measurement interval" },
            { id: "now", label: "Immediately, on the next packet" },
            { id: "never", label: "Never: the circuit is still up" },
          ],
          answer: "next",
          why: "The edge only knows what it measured. A brownout is seen when the interval closes — calls in between suffer.",
        },
      },
    ],
  },
  {
    n: 3,
    title: "Application policy",
    idea: "Each application has its own rules: does it need an SLA, which paths in which order, and what if none qualifies. The same path state gives different answers per application.",
    steps: [
      {
        title: "Voice moves, the backup doesn't care",
        body: (
          <>
            <p>With TUN-A browned out and measured, VOICE (SLA required) skips it and takes <M>TUN-B</M>. BULK (no SLA) still takes its first reachable path, TUN-B, as always.</p>
          </>
        ),
        pre: [world("TUN-A", "brownout"), M1],
        runs: [{ label: "Place a call and run the backup", actions: [send("VOICE", "BULK")] }],
        show: ["journey", "policy"],
      },
      {
        title: "A degraded path is fine for backups",
        body: (
          <>
            <p>Now ISP-B browns out instead. The backup stays on TUN-B — slower, but backups need no SLA — while voice keeps the healthy TUN-A. Nothing is wasted.</p>
          </>
        ),
        pre: [world("TUN-B", "brownout"), M1],
        runs: [{ label: "Place a call and run the backup", actions: [send("VOICE", "BULK")] }],
        show: ["journey", "paths"],
      },
      {
        title: "Order is policy",
        body: (
          <>
            <p>Someone swapped VOICE&apos;s preference to <M>TUN-B &gt; TUN-A</M>. Both paths meet the SLA, so the edge takes the first eligible one: calls run over the cheap line although the business line is healthy.</p>
          </>
        ),
        pre: [cfg("VOICE preference → TUN-B > TUN-A", (c) => (c.pref.VOICE = ["TUN-B", "TUN-A"]))],
        runs: [{ label: "Place a call", actions: [send("VOICE")] }],
        show: ["journey", "policy"],
        check: {
          q: "Both paths meet the voice SLA. Which one does voice use?",
          options: [
            { id: "first", label: "The first eligible path in its preference order" },
            { id: "best", label: "Always the one with the lowest latency" },
            { id: "random", label: "Either, at random" },
          ],
          answer: "first",
          why: "The SLA decides which paths are allowed; the preference decides among them.",
        },
      },
    ],
  },
  {
    n: 4,
    title: "Failover and recovery",
    idea: "When a path fails the SLA, voice moves at the next interval. When it recovers, voice waits for several good intervals in a row before trusting it again — so a flapping link doesn't flap calls.",
    steps: [
      {
        title: "Failover",
        body: (
          <>
            <p>ISP-A browns out, the interval closes, TUN-A leaves the voice paths: the next call goes over TUN-B — good quality, more expensive.</p>
          </>
        ),
        runs: [{ label: "Brownout, measure, call", actions: [world("TUN-A", "brownout"), M1, send("VOICE")] }],
        show: ["journey", "paths"],
      },
      {
        title: "Recovery takes patience",
        body: (
          <>
            <p>ISP-A is healthy again. One good interval: TUN-A is <B>recovering 1/3</B> — voice stays on TUN-B. After three good intervals in a row it is eligible again and voice moves back.</p>
          </>
        ),
        pre: [world("TUN-A", "brownout"), M1],
        runs: [
          { label: "ISP-A recovers, measure once, call", actions: [world("TUN-A", "healthy"), M1, send("VOICE")] },
          { label: "Measure twice more, call", actions: [{ type: "measure", count: 2 }, send("VOICE")], keep: true },
        ],
        show: ["paths", "journey"],
      },
      {
        title: "Why wait?",
        body: (
          <>
            <p>Without hysteresis, a circuit that alternates good and bad intervals would move every call back and forth every few seconds — each move risks a glitch. Cisco: <M>bfd app-route multiplier</M>; Junos: <M>switch-idle-time</M>.</p>
          </>
        ),
        show: ["paths"],
        check: {
          q: "TUN-A passed one interval after a brownout. Where do calls go?",
          options: [
            { id: "b", label: "Still TUN-B: TUN-A must pass the configured number of intervals first" },
            { id: "a", label: "Back to TUN-A immediately" },
            { id: "drop", label: "Nowhere until both paths are healthy" },
          ],
          answer: "b",
          why: "Recovery is deliberate: a path is trusted again only after it has stayed good for the hold period.",
        },
      },
    ],
  },
  {
    n: 5,
    title: "When no path is good",
    idea: "If no path meets the SLA, the policy decides: fall back to the least bad reachable path, or drop (strict). And an SLA nothing can meet turns every call into a fallback.",
    steps: [
      {
        title: "Both brown out: fallback",
        body: (
          <>
            <p>Both ISPs brown out. No path meets the voice SLA, so voice uses <B>the best reachable path</B> (lowest loss, then latency) — poor quality, but calls connect.</p>
          </>
        ),
        runs: [{ label: "Both brown out, measure, call", actions: [world("TUN-A", "brownout"), world("TUN-B", "brownout"), M1, send("VOICE")] }],
        show: ["journey", "policy"],
      },
      {
        title: "Strict: silence",
        body: (
          <>
            <p>With <M>strict</M> instead of fallback, the same day means no call at all: voice is dropped at the branch.</p>
          </>
        ),
        pre: [cfg("VOICE strict (no fallback)", (c) => (c.fallback.VOICE = false))],
        runs: [{ label: "Both brown out, measure, call", actions: [world("TUN-A", "brownout"), world("TUN-B", "brownout"), M1, send("VOICE")] }],
        show: ["journey", "policy"],
      },
      {
        title: "An SLA nothing can meet",
        body: (
          <>
            <p>A voice SLA of <M>20 ms</M> latency fails even healthy internet paths (25 ms, 55 ms). Every call becomes a fallback — the SLA has stopped telling good paths from bad ones.</p>
          </>
        ),
        pre: [cfg("VOICE SLA latency → 20 ms", (c) => (c.sla.rtt = 20))],
        runs: [{ label: "Place a call", actions: [send("VOICE")] }],
        show: ["paths", "journey"],
        check: {
          q: "The business prefers poor calls to no calls on a bad day. What should the voice policy do when no path meets its SLA?",
          options: [
            { id: "fb", label: "Fall back to the best reachable path" },
            { id: "strict", label: "Drop the calls (strict)" },
            { id: "nosla", label: "Stop requiring an SLA" },
          ],
          answer: "fb",
          why: "Fallback keeps the SLA working on normal days and still connects calls on bad ones. Removing the SLA would also keep calls on a bad path when a good one exists.",
        },
      },
    ],
  },
  {
    n: 6,
    title: "Reading the policy",
    idea: "Same symptom, different causes: separate what was measured, what the SLA class allows, what the policy says, and which path was actually used.",
    steps: [
      {
        title: "Choppy calls — no SLA",
        body: (
          <>
            <p>VOICE no longer requires an SLA. ISP-A browns out: TUN-A is measured as bad — and voice stays on it, because without an SLA any reachable path in the preference will do.</p>
          </>
        ),
        pre: [cfg("VOICE: SLA not required", (c) => (c.slaReq.VOICE = false)), world("TUN-A", "brownout"), M1],
        runs: [{ label: "Place a call", actions: [send("VOICE")] }],
        show: ["policy", "paths"],
      },
      {
        title: "Choppy calls — a loose SLA",
        body: (
          <>
            <p>Now the SLA is required, but someone relaxed it to <M>250 ms / 60 ms / 3 %</M>. The brownout PASSES that: TUN-A stays eligible, voice stays on it. Same symptom; the evidence is in the SLA class, not in the policy rule.</p>
          </>
        ),
        pre: [cfg("VOICE SLA → 250 ms / 60 ms / 3 %", (c) => (c.sla = { rtt: 250, jitter: 60, loss: 3 })), world("TUN-A", "brownout"), M1],
        runs: [{ label: "Place a call", actions: [send("VOICE")] }],
        show: ["paths", "policy"],
      },
      {
        title: "The method",
        body: (
          <>
            <p>Ask in order: what happened to the traffic? which class was it? what did each path measure? which paths meet the SLA — and is the SLA sensible? what does the policy say (preference, SLA, fallback)? which path should it use — and does it?</p>
          </>
        ),
        show: ["paths", "policy"],
        check: {
          q: "Calls are choppy during brownouts; the measurements show TUN-A at 160 ms and SLA PASS. What's wrong?",
          options: [
            { id: "loose", label: "The SLA class is too loose to catch the brownout" },
            { id: "nosla", label: "Voice doesn't require an SLA" },
            { id: "pref", label: "Voice prefers the wrong path" },
          ],
          answer: "loose",
          why: "A 160 ms path passing the SLA means the thresholds, not the policy rule, are wrong.",
        },
      },
    ],
  },
];
