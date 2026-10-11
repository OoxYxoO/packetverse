import type { ReactNode } from "react";
import { RTR_PORT, TRUNK, vlClone, vlHealthy, type VlAction, type VlCfg, type VlHost } from "@/lib/sim-engine/scenarios/vlanNet";

/**
 * Learn track of the VLAN Lab: six levels on one network — two 802.1Q switches, four hosts in two VLANs, and (from
 * level 5) R1 on a trunk. A step starts from a known network (its `pre` actions are replayed silently through the
 * model, so every table is LEARNED, never typed), then the learner runs the step's traffic and watches it.
 * The question is always: which VLAN is this frame in, here — and who decided that?
 */

export type VlShow = "membership" | "reach" | "anatomy" | "anatomyEcho" | "journey" | "tables" | "router" | "ladder";
export interface VlStepRun {
  label: string;
  actions: VlAction[];
  keep?: boolean;
}
export interface VlCheck {
  q: string;
  options: { id: string; label: string }[];
  answer: string;
  why: string;
}
export interface VlStep {
  title: string;
  body: ReactNode;
  pre?: VlAction[];
  runs?: VlStepRun[];
  show: VlShow[];
  check?: VlCheck;
}
export interface VlLevel {
  n: number;
  title: string;
  idea: string;
  /** R1 is part of the picture from this level on. */
  router?: boolean;
  steps: VlStep[];
}

const IP: Record<VlHost, string> = { "HOST-A": "192.168.10.11", "HOST-B": "192.168.10.12", "HOST-C": "192.168.20.13", "HOST-D": "192.168.20.14" };
const ping = (from: VlHost, to: string): VlAction => ({ type: "traffic", sends: [{ from, to, kind: "ping" }] });
const arp = (from: VlHost, to: string): VlAction => ({ type: "traffic", sends: [{ from, to, kind: "arp" }] });
const cfg = (text: string, f: (c: VlCfg) => void, base: VlCfg = vlHealthy()): VlAction => {
  const c = vlClone(base);
  f(c);
  return { type: "cfg", cfg: c, text };
};
/** Levels 1–4 have no router yet. */
const noR1 = (f: (c: VlCfg) => void = () => {}): VlCfg => {
  const c = vlHealthy();
  c.r1.shut = true;
  f(c);
  return c;
};
const start = (f?: (c: VlCfg) => void): VlAction => ({ type: "cfg", cfg: noR1(f), text: "Two switches, two VLANs" });
const change = (text: string, f: (c: VlCfg) => void): VlAction => ({ type: "cfg", cfg: noR1(f), text });
const clearArp: VlAction[] = (["HOST-A", "HOST-B", "HOST-C", "HOST-D"] as VlHost[]).map((dev) => ({ type: "clear-arp", dev }));

const B = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;
const M = ({ children }: { children: ReactNode }) => <span className="pv-mono text-pv-text">{children}</span>;
const V10 = () => <b style={{ color: "#22d3ee" }}>VLAN 10</b>;
const V20 = () => <b style={{ color: "#a78bfa" }}>VLAN 20</b>;

export const VL_LEVELS: VlLevel[] = [
  {
    n: 1,
    title: "Two LANs on one set of switches",
    idea: "A VLAN is a broadcast domain the switches create: ports in different VLANs behave as if they were on different switches.",
    steps: [
      {
        title: "Four hosts, two switches, two VLANs",
        body: (
          <>
            <p>The same two switches as in Switching — but now every access port has a <B>VLAN</B>. HOST-A and HOST-B (Sales, <M>192.168.10.0/24</M>) are in <V10 />; HOST-C and HOST-D (Engineering, <M>192.168.20.0/24</M>) are in <V20 />. Each access link is drawn in its VLAN&apos;s color.</p>
            <p>The hosts were not told anything: they have an IP address and a gateway, nothing else. The <B>switch port</B> decides the VLAN.</p>
          </>
        ),
        pre: [start()],
        show: ["membership"],
      },
      {
        title: "HOST-A broadcasts — who hears it?",
        body: (
          <>
            <p>HOST-A asks “who has <M>192.168.10.12</M>?” — an ARP request to the broadcast MAC. Without VLANs, every host would get a copy. Watch what SW1 does: the frame came in on a <V10 /> port, so SW1 floods it to <B>VLAN 10 ports only</B> — and up the link to SW2, which does the same.</p>
            <p>HOST-C is plugged into the same switch, one port away. It never sees the frame.</p>
          </>
        ),
        pre: [start()],
        runs: [{ label: "HOST-A asks who has 192.168.10.12", actions: [arp("HOST-A", IP["HOST-B"])] }],
        show: ["reach", "journey"],
      },
      {
        title: "Engineering does the same, separately",
        body: (
          <>
            <p>HOST-C pings HOST-D: its broadcast stays in <V20 />, its reply goes straight back. Now look at the tables: each switch keeps entries <B>per VLAN</B> — the same switch, two separate address lists.</p>
          </>
        ),
        pre: [start(), ping("HOST-A", IP["HOST-B"])],
        runs: [{ label: "HOST-C pings HOST-D", actions: [ping("HOST-C", IP["HOST-D"])] }],
        show: ["reach", "tables"],
      },
      {
        title: "Can HOST-A reach HOST-C?",
        body: (
          <>
            <p>HOST-C is in another subnet, so HOST-A doesn&apos;t even try to reach it directly: it ARPs for its <B>gateway</B> <M>192.168.10.1</M>. Nobody in <V10 /> owns that address yet — there is no router. The ping fails.</p>
            <p>That is the point of a VLAN: two separate LANs. Getting between them needs a router (level 5).</p>
          </>
        ),
        pre: [start(), ping("HOST-A", IP["HOST-B"]), ping("HOST-C", IP["HOST-D"])],
        runs: [{ label: "HOST-A pings HOST-C", actions: [ping("HOST-A", IP["HOST-C"])] }],
        show: ["journey"],
        check: {
          q: "Why did HOST-A's ping to HOST-C fail?",
          options: [
            { id: "gw", label: "HOST-C is in another subnet and VLAN; HOST-A needs a gateway, and none answers in VLAN 10" },
            { id: "block", label: "SW1 blocked the ping because VLAN 10 and 20 have a firewall" },
            { id: "tag", label: "HOST-A forgot to put a VLAN tag on the frame" },
          ],
          answer: "gw",
          why: "Nothing blocked anything: HOST-A's ARP for its gateway flooded VLAN 10 and nobody owns 192.168.10.1. A VLAN is simply a separate LAN; leaving it means a router. Hosts never tag.",
        },
      },
    ],
  },
  {
    n: 2,
    title: "One cable, many VLANs: the trunk",
    idea: "Between switches, a trunk carries every VLAN on one link, marking each frame with a 4-byte 802.1Q tag that names its VLAN.",
    steps: [
      {
        title: "How does SW2 know?",
        body: (
          <>
            <p>When HOST-A&apos;s frame crossed to SW2, SW2 flooded it to <V10 /> — but SW2&apos;s port <M>ge-0/0/24</M> leads to a switch, not a host, so the port alone can&apos;t say which VLAN the frame is in. Both VLANs share that cable.</p>
            <p>The answer is in the frame itself. Run the ping and read the frame <B>link by link</B>.</p>
          </>
        ),
        pre: [start()],
        runs: [{ label: "HOST-A pings HOST-B", actions: [ping("HOST-A", IP["HOST-B"])] }],
        show: ["anatomy"],
      },
      {
        title: "Two VLANs on the same cable",
        body: (
          <>
            <p>Same thing for Engineering: on the trunk the frame carries <B>VID 20</B>. The cable is shared; the tag keeps the two VLANs apart. Each VLAN is a lane of its own on the trunk in the drawing.</p>
            <p>The tag is added by the switch that sends onto the trunk and removed by the switch that delivers to the access port. <B>Hosts never see a tag.</B></p>
          </>
        ),
        pre: [start(), ping("HOST-A", IP["HOST-B"])],
        runs: [{ label: "HOST-C pings HOST-D", actions: [ping("HOST-C", IP["HOST-D"])] }],
        show: ["anatomy", "membership"],
      },
      {
        title: "Inside the switch: classify first",
        body: (
          <>
            <p>Every switch decision now starts with one more question: <B>which VLAN?</B> Untagged on an access port → that port&apos;s VLAN. Tagged on a trunk → the VID in the tag. Only then does it learn the source and look up the destination — <B>in that VLAN&apos;s table only</B>.</p>
          </>
        ),
        pre: [start()],
        runs: [{ label: "HOST-D pings HOST-C", actions: [ping("HOST-D", IP["HOST-C"])] }],
        show: ["journey"],
        check: {
          q: "SW2 receives a frame on its trunk tagged VID 20, for a MAC it has only learned in VLAN 10. What does it do?",
          options: [
            { id: "flood20", label: "Floods it in VLAN 20 — it looks only at VLAN 20's entries, where the MAC is unknown" },
            { id: "fwd10", label: "Sends it to the VLAN 10 port where it learned that MAC" },
            { id: "retag", label: "Changes the tag to 10 and forwards it" },
          ],
          answer: "flood20",
          why: "The lookup happens inside the frame's VLAN. A switch never moves a frame from one VLAN to another — only a router does, by building a new frame.",
        },
      },
    ],
  },
  {
    n: 3,
    title: "The port decides the VLAN",
    idea: "A host is in whatever VLAN its switch port is in. Change the port, and the same host is in another broadcast domain — with the wrong subnet.",
    steps: [
      {
        title: "HOST-B's port is moved to VLAN 20",
        body: (
          <>
            <p>Someone sets SW2 <M>ge-0/0/1</M> to access <V20 />. HOST-B didn&apos;t change at all: same cable, same address <M>192.168.10.12</M>. Now HOST-A pings it.</p>
            <p>HOST-A&apos;s ARP floods <V10 /> on both switches — and HOST-B&apos;s port isn&apos;t in VLAN 10 any more. Nobody answers.</p>
          </>
        ),
        pre: [start(), change("SW2 ge-0/0/1 → access VLAN 20", (c) => (c.sw.SW2.ports["ge-0/0/1"].access = 20))],
        runs: [{ label: "HOST-A pings HOST-B", actions: [ping("HOST-A", IP["HOST-B"])] }],
        show: ["reach", "membership"],
      },
      {
        title: "Where did HOST-B land?",
        body: (
          <>
            <p>HOST-B now asks for HOST-A. Its broadcast reaches <B>HOST-C and HOST-D</B> — Engineering. They hear a Sales address asking for another Sales address and ignore it. SW2&apos;s table shows HOST-B&apos;s MAC <B>in VLAN 20</B>.</p>
            <p>One wrong access VLAN: the host is isolated from its own subnet, and sitting inside another one.</p>
          </>
        ),
        pre: [start(), change("SW2 ge-0/0/1 → access VLAN 20", (c) => (c.sw.SW2.ports["ge-0/0/1"].access = 20))],
        runs: [{ label: "HOST-B asks who has 192.168.10.11", actions: [arp("HOST-B", IP["HOST-A"])] }],
        show: ["reach", "tables"],
      },
      {
        title: "Put it back",
        body: (
          <>
            <p>Back to access <V10 />. One change on one port, and HOST-B is a Sales host again — the next frame it sends is learned in VLAN 10.</p>
          </>
        ),
        pre: [start(), change("SW2 ge-0/0/1 → access VLAN 20", (c) => (c.sw.SW2.ports["ge-0/0/1"].access = 20)), arp("HOST-B", IP["HOST-A"])],
        runs: [{ label: "Fix the port, then HOST-A pings HOST-B", actions: [change("SW2 ge-0/0/1 → access VLAN 10", () => {}), ping("HOST-A", IP["HOST-B"])] }],
        show: ["tables", "reach"],
        check: {
          q: "To move a laptop from Engineering to Sales on the same desk, what must change?",
          options: [
            { id: "both", label: "Its switch port's access VLAN AND its IP settings (a Sales address and gateway)" },
            { id: "port", label: "Only its switch port's VLAN" },
            { id: "nic", label: "A VLAN setting on the laptop's network card" },
          ],
          answer: "both",
          why: "The port puts the laptop in VLAN 10; but VLAN 10 is the 192.168.10.0/24 subnet, so the laptop also needs an address (and gateway) from that subnet. The laptop has no VLAN setting.",
        },
      },
    ],
  },
  {
    n: 4,
    title: "What a trunk carries",
    idea: "A trunk carries only the VLANs it allows, and sends one — the native VLAN — untagged. Both ends must agree.",
    steps: [
      {
        title: "Remove VLAN 10 from one end",
        body: (
          <>
            <p>On SW1 the trunk&apos;s allowed list is cut to <M>1,20</M>. The link stays up, and Engineering keeps working — but SW1 no longer sends <V10 /> frames onto it. HOST-A&apos;s flood stops at SW1&apos;s border.</p>
            <p>A trunk filters <B>VLAN by VLAN</B>: “link up” doesn&apos;t mean “your VLAN crosses it”. The VLAN 10 lane of the trunk is broken in the drawing.</p>
          </>
        ),
        pre: [start((c) => (c.sw.SW1.ports[TRUNK].allowed = [1, 20]))],
        runs: [
          { label: "HOST-A pings HOST-B", actions: [ping("HOST-A", IP["HOST-B"])] },
          { label: "HOST-C pings HOST-D", actions: [ping("HOST-C", IP["HOST-D"])] },
        ],
        show: ["journey", "membership"],
      },
      {
        title: "The native VLAN: the one without a tag",
        body: (
          <>
            <p>One VLAN per trunk is sent <B>untagged</B>: the <B>native VLAN</B> (VLAN 1 unless changed). An untagged frame arriving on a trunk is put into it. Here both ends make <V10 /> native: Sales frames now cross the trunk with no tag at all — and still arrive in VLAN 10, because both ends agree.</p>
          </>
        ),
        pre: [start((c) => ((c.sw.SW1.ports[TRUNK].native = 10), (c.sw.SW2.ports[TRUNK].native = 10)))],
        runs: [{ label: "HOST-A pings HOST-B", actions: [ping("HOST-A", IP["HOST-B"])] }],
        show: ["anatomy", "membership"],
      },
      {
        title: "When the ends disagree",
        body: (
          <>
            <p>Now only SW1 uses native <V10 />; SW2 still uses VLAN 1. SW1 sends HOST-A&apos;s frame untagged; SW2 puts untagged frames into <B>its</B> native VLAN — VLAN 1. HOST-A has leaked into the wrong VLAN, and HOST-B never hears it. SW2&apos;s table shows HOST-A in VLAN 1.</p>
            <p>The frame is not dropped and nothing looks “down”. On Cisco, CDP notices and logs <M>NATIVE_VLAN_MISMATCH</M>; Junos has no such warning.</p>
          </>
        ),
        pre: [start((c) => (c.sw.SW1.ports[TRUNK].native = 10))],
        runs: [{ label: "HOST-A pings HOST-B", actions: [ping("HOST-A", IP["HOST-B"])] }],
        show: ["anatomy", "tables"],
        check: {
          q: "With native VLAN 10 on SW1 and native VLAN 1 on SW2, does HOST-B → HOST-A work?",
          options: [
            { id: "half", label: "Its frames reach SW1 tagged VID 10 and arrive — but HOST-A's answers go untagged into SW2's VLAN 1, so the exchange still fails" },
            { id: "yes", label: "Yes, fully — only SW1 → SW2 is affected" },
            { id: "dropped", label: "No: SW2 drops every frame on a mismatched trunk" },
          ],
          answer: "half",
          why: "SW2 → SW1 is fine: VLAN 10 isn't SW2's native VLAN, so SW2 tags it and SW1 reads the tag. SW1 → SW2 lands in VLAN 1. A ping needs both directions.",
        },
      },
    ],
  },
  {
    n: 5,
    title: "Joining VLANs: a router on a trunk",
    idea: "Traffic between VLANs goes through a router. One trunk to the router is enough: one subinterface per VLAN, each the gateway of its VLAN.",
    router: true,
    steps: [
      {
        title: "Meet R1",
        body: (
          <>
            <p>R1 is plugged into SW2 <M>ge-0/0/23</M>, a trunk carrying VLANs 10 and 20. R1 has <B>one subinterface per VLAN</B>: <M>.10</M> accepts frames tagged VID 10 and owns <M>192.168.10.1</M>; <M>.20</M> accepts VID 20 and owns <M>192.168.20.1</M>. Each is its VLAN&apos;s default gateway. This design is called <B>router on a stick</B>.</p>
            <p>(R1 is a lab device for this lesson. How a router chooses where to send a packet is the Routing lessons&apos; subject.)</p>
          </>
        ),
        pre: [],
        show: ["router", "membership"],
      },
      {
        title: "HOST-A pings HOST-C",
        body: (
          <>
            <p>HOST-A ARPs for its gateway; R1&apos;s <M>.10</M> answers. The ping goes to R1 tagged <B>VID 10</B> — across SW1↔SW2, then down to R1. R1 routes it to <M>.20</M>, lowers the TTL, and sends a <B>new frame</B> back up the <B>same cable</B> tagged <B>VID 20</B>, which SW2 floods/forwards in VLAN 20 — back across the trunk to HOST-C on SW1.</p>
            <p>HOST-C is one port away from HOST-A, yet the packet traveled to R1 and back: the <B>hairpin</B>.</p>
          </>
        ),
        pre: [...clearArp],
        runs: [{ label: "HOST-A pings HOST-C", actions: [ping("HOST-A", IP["HOST-C"])] }],
        show: ["anatomyEcho", "journey"],
      },
      {
        title: "The proof is in the TTL and the tags",
        body: (
          <>
            <p>Read the echo link by link: VID 10 going to R1, VID 20 coming from R1, TTL 64 → 63, and the MAC addresses changed at R1. Two switches can only ever keep a frame inside its VLAN; R1 is the only device here that moves traffic between VLANs.</p>
          </>
        ),
        pre: [ping("HOST-A", IP["HOST-C"])],
        runs: [{ label: "HOST-D pings HOST-B", actions: [ping("HOST-D", IP["HOST-B"])] }],
        show: ["anatomyEcho", "tables"],
        check: {
          q: "HOST-A pings HOST-C (another VLAN). How many times does the echo request cross the SW1↔SW2 trunk?",
          options: [
            { id: "two", label: "Twice: to R1 tagged VID 10, then back toward HOST-C tagged VID 20" },
            { id: "zero", label: "Never: SW1 sends it straight to HOST-C, they are on the same switch" },
            { id: "one", label: "Once, tagged with both VIDs" },
          ],
          answer: "two",
          why: "SW1 can't forward a VLAN 10 frame to a VLAN 20 port. The frame must reach R1 (behind SW2), and R1's new frame — in VLAN 20 — must come all the way back.",
        },
      },
    ],
  },
  {
    n: 6,
    title: "Reading the evidence",
    idea: "Same symptom, different causes: the tables, the trunk settings, the captures and the counters say which VLAN went where — and where it stopped.",
    router: true,
    steps: [
      {
        title: "Engineering can't reach Sales (1)",
        body: (
          <>
            <p>HOST-D can&apos;t reach HOST-B, nor its gateway. Run the test, then walk the questions below in order. The key one: <B>does VID 20 leave SW2 toward R1 at all?</B></p>
          </>
        ),
        pre: [cfg("SW2 ge-0/0/23 allows 1,10", (c) => (c.sw.SW2.ports[RTR_PORT].allowed = [1, 10])), ...clearArp],
        runs: [{ label: "HOST-D pings HOST-B", actions: [ping("HOST-D", IP["HOST-B"])] }],
        show: ["ladder", "journey"],
      },
      {
        title: "Engineering can't reach Sales (2)",
        body: (
          <>
            <p>The same complaint, a different network. This time VID 20 frames <B>do</B> leave SW2 toward R1 — and R1 drops them: its <M>.20</M> subinterface expects VID 30. Same symptom, opposite side of the cable: the capture on SW2 <M>ge-0/0/23</M> tells the two apart.</p>
          </>
        ),
        pre: [cfg("R1 .20 → VID 30", (c) => (c.r1.subs = c.r1.subs.map((x) => (x.unit === 20 ? { ...x, vid: 30 } : x)))), ...clearArp],
        runs: [{ label: "HOST-D pings HOST-B", actions: [ping("HOST-D", IP["HOST-B"])] }],
        show: ["ladder", "journey"],
        check: {
          q: "In both cases HOST-D can't reach its gateway. Which evidence separates “SW2's trunk to R1 doesn't carry VLAN 20” from “R1's .20 expects the wrong VID”?",
          options: [
            { id: "cap", label: "A capture on SW2 ge-0/0/23: VID 20 frames leaving (R1's problem) or none at all (SW2's allowed list)" },
            { id: "ping", label: "Pinging from HOST-C instead of HOST-D" },
            { id: "mac", label: "HOST-D's ARP cache" },
          ],
          answer: "cap",
          why: "Both look identical from the hosts. The link between them is where the stories differ: either the VLAN never reaches the router, or it reaches it with a tag no subinterface accepts (R1 also counts those drops).",
        },
      },
    ],
  },
];
