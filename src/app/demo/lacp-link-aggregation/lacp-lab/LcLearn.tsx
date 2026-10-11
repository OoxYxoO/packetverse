import type { ReactNode } from "react";
import { lcClone, lcHealthy, type LcAction, type LcCfg, type LcHost, type LcMember, type LcMode } from "@/lib/sim-engine/scenarios/lacpNet";

/**
 * Learn track of the LACP Lab: six levels on SW1 ═ SW2 with two (later three) parallel cables. A step starts from a
 * known network (its `pre` actions are replayed silently through the model), then the learner runs its traffic.
 * The questions: what does spanning tree see, which member does each flow take, and what must both ends agree on?
 */

export type LcShow = "bundle" | "flows" | "journey";
export interface LcStepRun {
  label: string;
  actions: LcAction[];
  keep?: boolean;
}
export interface LcCheck {
  q: string;
  options: { id: string; label: string }[];
  answer: string;
  why: string;
}
export interface LcStep {
  title: string;
  body: ReactNode;
  pre?: LcAction[];
  runs?: LcStepRun[];
  show: LcShow[];
  check?: LcCheck;
}
export interface LcLevel {
  n: number;
  title: string;
  idea: string;
  steps: LcStep[];
}
const UP: LcMember[] = ["ge-0/0/23", "ge-0/0/24"];
const two: LcAction = { type: "traffic", sends: [{ from: "HOST-A", to: "HOST-B", kind: "ping" }, { from: "HOST-A", to: "HOST-C", kind: "ping" }], cmd: "HOST-A pings HOST-B and HOST-C" };
const four: LcAction = { type: "traffic", sends: [{ from: "HOST-A", to: "HOST-B", kind: "ping" }, { from: "HOST-A", to: "HOST-C", kind: "ping" }, { from: "HOST-D", to: "HOST-B", kind: "ping" }, { from: "HOST-D", to: "HOST-C", kind: "ping" }], cmd: "Four flows across the uplink" };
const ping = (from: LcHost, to: LcHost): LcAction => ({ type: "traffic", sends: [{ from, to, kind: "ping" }] });
const cfg = (text: string, f: (c: LcCfg) => void, base: LcCfg = lcHealthy()): LcAction => {
  const c = lcClone(base);
  f(c);
  return { type: "cfg", cfg: c, text };
};
const modes = (a: LcMode, b: LcMode) => (c: LcCfg) => {
  for (const m of UP) {
    c.sw.SW1.members[m].mode = a;
    c.sw.SW2.members[m].mode = b;
  }
};
const B = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;
const M = ({ children }: { children: ReactNode }) => <span className="pv-mono text-pv-text">{children}</span>;

export const LC_LEVELS: LcLevel[] = [
  {
    n: 1,
    title: "Two cables, one path",
    idea: "Two separate cables between the same two switches are a loop — spanning tree blocks one of them. Redundancy, but no extra bandwidth.",
    steps: [
      {
        title: "Two cables, no bundle",
        body: (
          <>
            <p>SW1 and SW2 are joined by two cables, <M>ge-0/0/23</M> and <M>ge-0/0/24</M>, configured as two ordinary switch ports. You know from the STP lesson what that is: two paths between the same switches, a loop. Spanning tree keeps <M>ge-0/0/23</M> and blocks <M>ge-0/0/24</M> (Alternate on SW2).</p>
          </>
        ),
        pre: [cfg("No bundle: two separate links", modes("off", "off"))],
        runs: [{ label: "HOST-A pings HOST-B and HOST-C", actions: [two] }],
        show: ["bundle", "flows"],
      },
      {
        title: "All flows squeeze through one cable",
        body: (
          <>
            <p>Four conversations cross the uplink — and all four take <M>ge-0/0/23</M>. <M>ge-0/0/24</M> carries nothing: it is a backup that waits for <M>ge-0/0/23</M> to fail. You paid for 2 Gb/s and get 1.</p>
          </>
        ),
        pre: [cfg("No bundle: two separate links", modes("off", "off"))],
        runs: [{ label: "Four flows across the uplink", actions: [four] }],
        show: ["flows", "journey"],
      },
    ],
  },
  {
    n: 2,
    title: "One logical link",
    idea: "Bundle the cables into a Port-channel: spanning tree sees ONE link, and every member carries traffic.",
    steps: [
      {
        title: "Bundle them",
        body: (
          <>
            <p>Both switches now put <M>ge-0/0/23</M> and <M>ge-0/0/24</M> into channel group 1 with LACP (Cisco <M>Port-channel1</M> · Junos <M>ae0</M>). Spanning tree no longer sees two ports: it sees <B>one</B> logical port, <M>Po1</M>, with cost 10000 (20000 shared by two members). Nothing is blocked.</p>
          </>
        ),
        pre: [],
        runs: [{ label: "Four flows across the uplink", actions: [four] }],
        show: ["bundle", "flows"],
      },
      {
        title: "One flow, one member",
        body: (
          <>
            <p>The switch spreads <B>flows</B>, not frames: a hash of the source and destination picks one member per flow, and every frame of that flow stays on it (so frames never arrive out of order). HOST-A → HOST-B takes one member, HOST-A → HOST-C the other. One flow can never go faster than one cable.</p>
          </>
        ),
        pre: [],
        runs: [{ label: "HOST-A pings HOST-B and HOST-C", actions: [two] }],
        show: ["flows", "journey"],
        check: {
          q: "HOST-A copies one big file to HOST-B over the 2 × 1 Gb/s Port-channel. How fast can that one transfer go?",
          options: [
            { id: "1g", label: "1 Gb/s: one flow stays on one member" },
            { id: "2g", label: "2 Gb/s: its frames are spread over both members" },
            { id: "half", label: "500 Mb/s: the bandwidth is shared out" },
          ],
          answer: "1g",
          why: "The hash keeps a flow on one member. A Port-channel adds capacity for MANY flows; a single flow still has the speed of one link.",
        },
      },
    ],
  },
  {
    n: 3,
    title: "LACP: agreeing on a bundle",
    idea: "LACP lets both ends check, cable by cable, that the other end is bundling the same cables into the same group.",
    steps: [
      {
        title: "LACPDUs",
        body: (
          <>
            <p>On every member LACP exchanges <B>LACPDUs</B> (to <M>01:80:C2:00:00:02</M>, EtherType <M>0x8809</M>, never IP): “I am system X, this port is in my group K, I&apos;m ready to collect and distribute.” A member is used only when <B>both</B> ends say so.</p>
          </>
        ),
        pre: [],
        runs: [{ label: "One round of LACPDUs", actions: [{ type: "lacp" }] }],
        show: ["journey", "bundle"],
      },
      {
        title: "Active and passive",
        body: (
          <>
            <p>An <B>active</B> port starts sending LACPDUs; a <B>passive</B> one only answers. Active ↔ passive works. But here both ends are passive: nobody speaks first, no LACPDU is ever sent, and every member stays suspended — the Port-channel is down.</p>
          </>
        ),
        pre: [cfg("Both ends LACP passive", modes("passive", "passive"))],
        runs: [{ label: "HOST-A pings HOST-B", actions: [{ type: "lacp" }, ping("HOST-A", "HOST-B")] }],
        show: ["bundle", "journey"],
        check: {
          q: "Which combination never forms a bundle?",
          options: [
            { id: "pp", label: "passive + passive" },
            { id: "ap", label: "active + passive" },
            { id: "aa", label: "active + active" },
          ],
          answer: "pp",
          why: "Passive ports only answer LACPDUs. With both ends waiting, LACP never starts. Most designs make both ends active.",
        },
      },
    ],
  },
  {
    n: 4,
    title: "What both ends must agree on",
    idea: "Static and LACP don't mix, and every member of one Port-channel must lead to the same Port-channel on the other side.",
    steps: [
      {
        title: "Static on one side, LACP on the other",
        body: (
          <>
            <p>SW2&apos;s ports were set to <B>static</B> (<M>channel-group 1 mode on</M>): they bundle without LACP and send no LACPDUs. SW1 runs LACP, hears nothing, and <B>suspends</B> both members. SW2 forwards into its bundle; SW1 drops everything. The cables are up; the floors are cut off.</p>
          </>
        ),
        pre: [cfg("SW2: static bundle (on), SW1: LACP active", modes("active", "on"))],
        runs: [{ label: "HOST-A pings HOST-B", actions: [ping("HOST-A", "HOST-B")] }],
        show: ["bundle", "journey"],
      },
      {
        title: "A member in the wrong group",
        body: (
          <>
            <p>On SW2, <M>ge-0/0/24</M> was put in channel group 2 by mistake. LACP tells SW1: “partner key 1” on <M>ge-0/0/23</M>, “partner key 2” on <M>ge-0/0/24</M>. One Port-channel can lead to only one partner Port-channel, so SW1 keeps <M>ge-0/0/23</M> and suspends <M>ge-0/0/24</M>. Everything works — on half the bandwidth.</p>
          </>
        ),
        pre: [cfg("SW2 ge-0/0/24: channel group 2", (c) => (c.sw.SW2.members["ge-0/0/24"].group = 2))],
        runs: [{ label: "HOST-A pings HOST-B and HOST-C", actions: [two] }],
        show: ["bundle", "flows"],
        check: {
          q: "Why is LACP better than static “on”, even when both ends are configured right?",
          options: [
            { id: "check", label: "It checks every cable with the partner: a miswired or misconfigured member is suspended instead of blackholing traffic" },
            { id: "speed", label: "It makes the bundle faster" },
            { id: "stp", label: "It replaces spanning tree" },
          ],
          answer: "check",
          why: "A static bundle trusts the cabling and the far end blindly. LACP verifies, member by member, that the other end is the same switch and the same group — and keeps checking.",
        },
      },
    ],
  },
  {
    n: 5,
    title: "More members, more flows",
    idea: "Add a member and the hash spreads flows over three cables; the bundle's cost drops, spanning tree still sees one link.",
    steps: [
      {
        title: "A third cable",
        body: (
          <>
            <p>A third cable is plugged in between the <M>ge-0/0/22</M> ports and added to channel group 1 at both ends. LACP agrees, the bundle has three members (3 Gb/s, STP cost 6667), and four flows now use all three cables.</p>
          </>
        ),
        pre: [{ type: "cable", member: "ge-0/0/22", up: true }, cfg("ge-0/0/22 joins Po1 at both ends", (c) => { c.cables["ge-0/0/22"] = true; c.sw.SW1.members["ge-0/0/22"].mode = "active"; c.sw.SW2.members["ge-0/0/22"].mode = "active"; })],
        runs: [{ label: "Four flows across the uplink", actions: [four] }],
        show: ["bundle", "flows"],
      },
    ],
  },
  {
    n: 6,
    title: "When a member fails",
    idea: "A member whose link goes down leaves at once. A member that fails silently is only noticed when LACPDUs stop: 90 s slow, 3 s fast.",
    steps: [
      {
        title: "Unplug a member",
        body: (
          <>
            <p><M>ge-0/0/24</M> is unplugged. Its link goes down at both ends, it leaves the bundle immediately, and the hash spreads every flow over what is left. Nothing else changes: the Port-channel stays up, spanning tree doesn&apos;t even notice.</p>
          </>
        ),
        pre: [two],
        runs: [{ label: "Unplug ge-0/0/24, then the same two flows", actions: [{ type: "cable", member: "ge-0/0/24", up: false }, two] }],
        show: ["flows", "bundle"],
      },
      {
        title: "A silent failure",
        body: (
          <>
            <p>Worse: <M>ge-0/0/24</M>&apos;s media converter dies. The link LED stays green, so the switches keep the member — and the flows hashed onto it disappear. Only LACP can notice, when its LACPDUs stop arriving: with the default <B>slow</B> rate (every 30 s) that takes <B>90 s</B>.</p>
          </>
        ),
        pre: [],
        runs: [
          { label: "Fail ge-0/0/24 silently, wait 5 s, HOST-A pings HOST-C", actions: [{ type: "silent", member: "ge-0/0/24", on: true }, { type: "wait", seconds: 5 }, ping("HOST-A", "HOST-C")] },
          { label: "Wait 90 s, ping again", keep: true, actions: [{ type: "wait", seconds: 90 }, ping("HOST-A", "HOST-C")] },
        ],
        show: ["bundle", "journey"],
      },
      {
        title: "The fast rate",
        body: (
          <>
            <p>With the <B>fast</B> rate (Cisco <M>lacp rate fast</M> · Junos <M>lacp periodic fast</M>) at both ends, LACPDUs come every second and a silent member is removed after <B>3 s</B>. The same test now works.</p>
          </>
        ),
        pre: [cfg("Fast LACP rate at both ends", (c) => { for (const m of UP) { c.sw.SW1.members[m].fast = true; c.sw.SW2.members[m].fast = true; } })],
        runs: [{ label: "Fail ge-0/0/24 silently, wait 5 s, HOST-A pings HOST-C", actions: [{ type: "silent", member: "ge-0/0/24", on: true }, { type: "wait", seconds: 5 }, ping("HOST-A", "HOST-C")] }],
        show: ["bundle", "flows"],
        check: {
          q: "Why can't the switch see a silent failure without LACP?",
          options: [
            { id: "link", label: "The link stays up: only the missing LACPDUs reveal that nothing gets through" },
            { id: "stp", label: "Spanning tree hides it" },
            { id: "hash", label: "The hash keeps choosing the same member" },
          ],
          answer: "link",
          why: "Link state only tells the switch that a signal is present. LACPDUs are the heartbeat that proves frames really cross — static bundles have no heartbeat at all.",
        },
      },
    ],
  },
];
