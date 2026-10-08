import type { ReactNode } from "react";
import { snCloneCfg, snHealthy, type SnAction, type SnHost, type SnSend } from "@/lib/sim-engine/scenarios/switchNet";

/**
 * Learn track of the Switching Lab: six levels, each a few steps on the same two-switch network. A step starts from
 * a known network (its `pre` actions are replayed silently through the model, so its tables are LEARNED, never typed),
 * then the learner runs the step's traffic and watches it. The question is always: what does EACH switch do, on its own?
 */

export type SnShow = "pipeline" | "journey" | "where" | "copies" | "load" | "flaps" | "uplinks" | "uplinkCounters";
export interface SnStepRun {
  label: string;
  actions: SnAction[];
  /** Continue from the current network instead of the step's starting point. */
  keep?: boolean;
}
export interface SnCheck {
  q: string;
  options: { id: string; label: string }[];
  answer: string;
  why: string;
}
export interface SnStep {
  title: string;
  body: ReactNode;
  pre?: SnAction[];
  runs?: SnStepRun[];
  show: SnShow[];
  check?: SnCheck;
}
export interface SnLevel {
  n: number;
  title: string;
  idea: string;
  steps: SnStep[];
}

const ping = (from: SnHost, to: SnHost): SnAction => ({ type: "traffic", sends: [{ from, to, reply: true }] });
const frame = (from: SnHost, to: SnHost): SnAction => ({ type: "traffic", sends: [{ from, to }] });
const bcast = (from: SnHost, arpFor: SnHost): SnAction => ({ type: "traffic", sends: [{ from, to: "broadcast", arpFor } as SnSend] });
const enable24 = (): SnAction => {
  const cfg = snHealthy();
  cfg.sw.SW1.shut = [];
  cfg.sw.SW2.shut = [];
  return { type: "cfg", cfg, text: "ge-0/0/24 enabled on SW1 and SW2 “for redundancy” (no loop prevention runs)" };
};
const third = (): SnAction => {
  const cfg = snHealthy();
  cfg.sw.SW1.shut = [];
  cfg.sw.SW2.shut = [];
  cfg.cables["ge-0/0/22"] = true;
  return { type: "cfg", cfg, text: "A third cable plugged between SW1 ge-0/0/22 and SW2 ge-0/0/22" };
};
const shut24 = (): SnAction => {
  const cfg = snCloneCfg(snHealthy());
  cfg.sw.SW1.shut = ["ge-0/0/24"];
  cfg.sw.SW2.shut = [];
  return { type: "cfg", cfg, text: "SW1: interface ge-0/0/24 disabled" };
};
const moveD: SnAction = { type: "move", host: "HOST-D", to: { sw: "SW2", port: "ge-0/0/3" }, text: "HOST-D unplugged from SW1 ge-0/0/2 and plugged into SW2 ge-0/0/3" };
const WARM: SnAction[] = [ping("HOST-A", "HOST-C"), ping("HOST-D", "HOST-B")];

const B = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;
const M = ({ children }: { children: ReactNode }) => <span className="pv-mono text-pv-text">{children}</span>;

export const SN_LEVELS: SnLevel[] = [
  {
    n: 1,
    title: "Two switches, two tables",
    idea: "Each switch learns and decides on its own, from the frames that reach its own ports.",
    steps: [
      {
        title: "One LAN, two switches",
        body: (
          <>
            <p>HOST-A and HOST-D are plugged into <B>SW1</B>; HOST-B and HOST-C into <B>SW2</B>. One cable, the <B>uplink</B>, joins the two switches. Together they are still one Ethernet LAN — one broadcast domain.</p>
            <p>Above each switch is <B>its own MAC table</B>. Both are empty: neither switch has seen a frame yet. Nothing will ever copy one table into the other.</p>
          </>
        ),
        show: [],
      },
      {
        title: "HOST-A sends a frame to HOST-C",
        body: (
          <>
            <p>Follow the frame from switch to switch. At <B>SW1</B>: it learns where the <i>sender</i> is (A → <M>ge-0/0/1</M>), then looks up C — unknown, so it floods: out to HOST-D <i>and</i> up the uplink.</p>
            <p>At <B>SW2</B> the same two steps happen again, in SW2&apos;s own table: A is learned behind <M>ge-0/0/23</M> — from SW2&apos;s position, HOST-A lives “up the uplink”. C is unknown to SW2 too, so SW2 floods again.</p>
          </>
        ),
        runs: [{ label: "HOST-A sends to HOST-C", actions: [frame("HOST-A", "HOST-C")] }],
        show: ["pipeline", "journey"],
      },
      {
        title: "HOST-C answers",
        body: (
          <>
            <p>C&apos;s reply carries C&apos;s MAC as its source. SW2 learns C on <M>ge-0/0/2</M>; it already knows A (behind the uplink) — <B>one port</B>. SW1 learns C behind its uplink and already knows A — <B>one port</B> again.</p>
            <p>Nobody else sees the reply. Forwarding became selective because traffic flowed.</p>
          </>
        ),
        pre: [frame("HOST-A", "HOST-C")],
        runs: [{ label: "HOST-C replies to HOST-A", actions: [frame("HOST-C", "HOST-A")] }],
        show: ["pipeline", "copies"],
      },
      {
        title: "Compare the two tables",
        body: (
          <>
            <p>The same two MACs, different ports. SW1 says A is on <M>ge-0/0/1</M> and C on its uplink; SW2 says the opposite. Both are right — each table describes direction <B>from its own position</B>.</p>
            <p>Many MACs can share one uplink port: every host of the other switch sits behind it.</p>
          </>
        ),
        pre: [frame("HOST-A", "HOST-C"), frame("HOST-C", "HOST-A")],
        show: ["where"],
        check: {
          q: "Where does SW1 think HOST-C is?",
          options: [
            { id: "uplink", label: "Behind its uplink ge-0/0/23" },
            { id: "sw2", label: "On SW2 ge-0/0/2" },
            { id: "ask", label: "It doesn't know; it asks SW2 for every frame" },
          ],
          answer: "uplink",
          why: "A switch only knows its own ports. C's frames arrived on SW1's ge-0/0/23, so that's where SW1 sends frames for C. SW1 has no idea which port of SW2 C is on — and doesn't need to.",
        },
      },
    ],
  },
  {
    n: 2,
    title: "Local stays local",
    idea: "A switch that knows the destination sends the frame out one port — the other switch may never see it.",
    steps: [
      {
        title: "HOST-D talks to HOST-A",
        body: (
          <>
            <p>Both are on SW1, and SW1 already knows A. The frame goes in <M>ge-0/0/2</M> and out <M>ge-0/0/1</M>: <B>it never touches the uplink</B>. Watch SW2&apos;s table: it doesn&apos;t change — SW2 never hears of HOST-D.</p>
            <p>Switching is not “send everything everywhere”.</p>
          </>
        ),
        pre: [frame("HOST-A", "HOST-C"), frame("HOST-C", "HOST-A")],
        runs: [{ label: "HOST-D sends to HOST-A", actions: [frame("HOST-D", "HOST-A")] }],
        show: ["pipeline", "uplinkCounters"],
      },
      {
        title: "Known at one switch, unknown at the next",
        body: (
          <>
            <p>Now HOST-B sends to HOST-D. <B>SW2</B> has never seen a frame from D: it floods (to C and up the uplink). <B>SW1</B> knows D on <M>ge-0/0/2</M>: it forwards out that one port. Two switches, two lookups, two different answers — for the same frame.</p>
          </>
        ),
        pre: [frame("HOST-A", "HOST-C"), frame("HOST-C", "HOST-A"), frame("HOST-D", "HOST-A")],
        runs: [{ label: "HOST-B sends to HOST-D", actions: [frame("HOST-B", "HOST-D")] }],
        show: ["journey", "where"],
        check: {
          q: "Why did SW2 flood a frame that SW1 then sent out a single port?",
          options: [
            { id: "own", label: "Each switch looks the destination up in its own table — SW2 had never seen D, SW1 had" },
            { id: "bcast", label: "SW2 turned it into a broadcast" },
            { id: "sw1", label: "SW1 told SW2 where D was" },
          ],
          answer: "own",
          why: "Every switch does its own lookup. SW2 learned D only when a frame FROM D reaches one of its ports — D's frame to A never did.",
        },
      },
      {
        title: "Once both sides have spoken",
        body: (
          <>
            <p>HOST-D answers HOST-B. That frame does cross the uplink, so now SW2 learns D behind <M>ge-0/0/23</M>. Every host has sent something that crossed both switches: both tables are complete, and every unicast takes one path.</p>
          </>
        ),
        pre: [frame("HOST-A", "HOST-C"), frame("HOST-C", "HOST-A"), frame("HOST-D", "HOST-A"), frame("HOST-B", "HOST-D")],
        runs: [{ label: "HOST-D replies to HOST-B", actions: [frame("HOST-D", "HOST-B")] }],
        show: ["where"],
      },
    ],
  },
  {
    n: 3,
    title: "Broadcast crosses every switch",
    idea: "FF:FF:FF:FF:FF:FF means everyone: every switch floods it, whatever its table says.",
    steps: [
      {
        title: "HOST-A asks: who has 192.168.50.30?",
        body: (
          <>
            <p>An ARP request goes to <M>FF:FF:FF:FF:FF:FF</M>. SW1 floods it out every other port — including the uplink. SW2 floods it out every other port. <B>Every host receives exactly one copy.</B></p>
            <p>The switches still learn the source as it passes: both now know where HOST-A is. HOST-C recognizes its IP and answers with a unicast — which follows those fresh entries.</p>
          </>
        ),
        runs: [{ label: "HOST-A broadcasts an ARP request", actions: [bcast("HOST-A", "HOST-C")] }],
        show: ["copies", "journey"],
      },
      {
        title: "Full tables don't stop a broadcast",
        body: (
          <>
            <p>Both tables are full now. HOST-D broadcasts anyway — and both switches flood it again, out every port. The table decides <B>unicast</B> only; a broadcast domain is everything a broadcast reaches, across every switch in it.</p>
          </>
        ),
        pre: WARM,
        runs: [{ label: "HOST-D broadcasts", actions: [bcast("HOST-D", "HOST-B")] }],
        show: ["copies", "pipeline"],
      },
    ],
  },
  {
    n: 4,
    title: "Learned state changes",
    idea: "Entries age out, can be cleared, and go stale when a host moves — then flooding (or wrong forwarding) returns.",
    steps: [
      {
        title: "Entries age out",
        body: (
          <>
            <p>A learned entry is kept <B>300 s</B> after the last frame <i>from</i> that MAC. Let five minutes pass without traffic: both tables empty, and the next frame is flooded again — until the replies teach the switches again.</p>
          </>
        ),
        pre: [ping("HOST-A", "HOST-C")],
        runs: [
          { label: "Wait 5 minutes", actions: [{ type: "wait", seconds: 300 }] },
          { label: "Then HOST-A pings HOST-C", actions: [ping("HOST-A", "HOST-C")], keep: true },
        ],
        show: ["where", "journey"],
      },
      {
        title: "Clear one switch only",
        body: (
          <>
            <p>Clear SW2&apos;s table and send again. SW1 still knows C — it forwards straight up the uplink. SW2 has forgotten everything — it floods. Clearing a table affects <B>that switch only</B>.</p>
          </>
        ),
        pre: [ping("HOST-A", "HOST-C")],
        runs: [{ label: "Clear SW2, then HOST-A sends to HOST-C", actions: [{ type: "clear", sw: "SW2" }, frame("HOST-A", "HOST-C")] }],
        show: ["journey", "where"],
      },
      {
        title: "HOST-D moves to the other switch",
        body: (
          <>
            <p>HOST-D (a printer: it answers but never starts a conversation) is re-cabled to <M>SW2 ge-0/0/3</M>. SW1&apos;s <M>ge-0/0/2</M> goes down, so SW1 <B>flushes</B> D. But SW2 still says D is behind its uplink — it learned that when D was on SW1. A cable coming up teaches nothing.</p>
          </>
        ),
        pre: [ping("HOST-D", "HOST-B")],
        runs: [{ label: "Move HOST-D to SW2 ge-0/0/3", actions: [moveD] }],
        show: ["where"],
      },
      {
        title: "Stale state sends frames the old way",
        body: (
          <>
            <p>HOST-B pings HOST-D. SW2 <i>knows</i> D — wrongly — and sends the frame up the uplink. SW1 doesn&apos;t know D any more, floods it… everywhere except back to SW2. HOST-D, one port away from HOST-B, never gets it.</p>
          </>
        ),
        pre: [ping("HOST-D", "HOST-B"), moveD],
        runs: [{ label: "HOST-B pings HOST-D", actions: [ping("HOST-B", "HOST-D")] }],
        show: ["journey", "where"],
      },
      {
        title: "HOST-D speaks: the switches correct themselves",
        body: (
          <>
            <p>The moment HOST-D sends anything, its source MAC arrives on SW2&apos;s <M>ge-0/0/3</M>: SW2 <B>moves</B> the entry. SW1 learns D behind its uplink. B&apos;s next ping works. (Clearing SW2&apos;s entry, or waiting 300 s for it to age out, would also have fixed it.)</p>
          </>
        ),
        pre: [ping("HOST-D", "HOST-B"), moveD, ping("HOST-B", "HOST-D")],
        runs: [
          { label: "HOST-D sends a broadcast", actions: [bcast("HOST-D", "HOST-B")] },
          { label: "Then HOST-B pings HOST-D", actions: [ping("HOST-B", "HOST-D")], keep: true },
        ],
        show: ["where", "flaps"],
      },
    ],
  },
  {
    n: 5,
    title: "A second link",
    idea: "Two active paths between switches and nothing to block one: a flooded frame comes back — and never stops.",
    steps: [
      {
        title: "Add “redundancy”",
        body: (
          <>
            <p>The second cable, <M>ge-0/0/24</M>, is enabled on both switches so the floors stay connected if one cable breaks. No loop-prevention protocol runs here (Spanning Tree is off).</p>
            <p>The links come up — and nothing else happens. A link coming up sends no frames.</p>
          </>
        ),
        pre: WARM,
        runs: [{ label: "Enable ge-0/0/24 on both switches", actions: [enable24()] }],
        show: ["uplinks"],
      },
      {
        title: "Known unicast still works",
        body: (
          <>
            <p>HOST-A pings HOST-C. Both switches know where C and A are, so each sends the frame out <B>one</B> port. The loop is there, but invisible: only frames that get <B>flooded</B> use every path.</p>
          </>
        ),
        pre: [...WARM, enable24()],
        runs: [{ label: "HOST-A pings HOST-C", actions: [ping("HOST-A", "HOST-C")] }],
        show: ["journey", "copies"],
      },
      {
        title: "One broadcast",
        body: (
          <>
            <p>HOST-A broadcasts. SW1 floods it out <B>both</B> uplinks. SW2 receives two copies; each is flooded out every other port — including the <i>other</i> uplink, back to SW1. SW1 floods each returning copy back up the other link…</p>
            <p>Every host receives the same broadcast again and again. Count them.</p>
          </>
        ),
        pre: [...WARM, enable24()],
        runs: [{ label: "HOST-A broadcasts", actions: [bcast("HOST-A", "HOST-C")] }],
        show: ["copies", "load", "journey"],
      },
      {
        title: "Why it never dies",
        body: (
          <>
            <p>A router <B>decrements the IP TTL</B> and drops a packet at 0 — you saw that in IPv4 and ICMP. A switch forwards an Ethernet frame <B>unchanged</B>: the Ethernet header has no TTL, no hop count. The copy after a thousand laps is identical to the first one.</p>
            <p>Let the network run: the counters keep climbing with nobody sending anything new. (The lab draws ten hops at a time; the real copies would lap the switches hundreds of thousands of times per second.)</p>
          </>
        ),
        pre: [...WARM, enable24(), bcast("HOST-A", "HOST-C")],
        runs: [{ label: "Let it run", actions: [{ type: "run" }] }],
        show: ["load", "uplinkCounters"],
        check: {
          q: "What would make these copies stop on their own?",
          options: [
            { id: "nothing", label: "Nothing in the frame — only removing a path (or a protocol that blocks one)" },
            { id: "ttl", label: "Their TTL reaching 0 after 64 hops" },
            { id: "age", label: "The MAC entries aging out" },
          ],
          answer: "nothing",
          why: "Ethernet has no TTL. Aging doesn't help either: every lap refreshes the entries. Only breaking the loop stops it.",
        },
      },
    ],
  },
  {
    n: 6,
    title: "Storm, flapping, recovery",
    idea: "A loop corrupts the tables (MACs flap between ports), multiplies with every extra path — and only removing the path stops it.",
    steps: [
      {
        title: "MAC flapping",
        body: (
          <>
            <p>Every circulating copy still carries HOST-A&apos;s MAC as its source. So SW1 keeps re-learning A — on <M>ge-0/0/23</M>, then <M>ge-0/0/24</M>, then back: the entry <B>flaps</B>. SW1 now believes HOST-A, plugged into its own <M>ge-0/0/1</M>, is somewhere behind the uplinks.</p>
            <p>So when HOST-D pings HOST-A, SW1 sends it the wrong way.</p>
          </>
        ),
        pre: [...WARM, enable24(), bcast("HOST-A", "HOST-C")],
        runs: [{ label: "HOST-D pings HOST-A", actions: [ping("HOST-D", "HOST-A")] }],
        show: ["flaps", "where", "journey"],
      },
      {
        title: "More paths, more copies",
        body: (
          <>
            <p>With two links, each broadcast becomes two copies that circulate forever — and every new broadcast adds two more. Now plug a <B>third</B> cable. A copy arriving on one link is flooded out the <i>two</i> others: 3, 6, 12, 24… every hop doubles it.</p>
            <p>That is a <B>broadcast storm</B>: in a real network it fills the links and the switches&apos; CPUs within milliseconds. The lab counts the copies exactly; it stops drawing them.</p>
          </>
        ),
        pre: [...WARM, third()],
        runs: [{ label: "HOST-A broadcasts", actions: [bcast("HOST-A", "HOST-C")] }],
        show: ["load", "copies"],
      },
      {
        title: "Remove the loop",
        body: (
          <>
            <p>Disable <M>ge-0/0/24</M> on SW1. The link goes down at both ends; the copies on it are lost and the entries learned on it are flushed. The copies left on <M>ge-0/0/23</M> are delivered and die at the hosts: with one path, a flood can&apos;t come back.</p>
          </>
        ),
        pre: [...WARM, enable24(), bcast("HOST-A", "HOST-C")],
        runs: [{ label: "Disable SW1 ge-0/0/24", actions: [shut24()] }],
        show: ["load", "uplinks"],
      },
      {
        title: "Prove the repair",
        body: (
          <>
            <p>“The cable is off” is not proof. Prove it with traffic: a new broadcast must reach every host <B>exactly once</B>, nothing may be left circulating, and no MAC may move. Then a unicast that failed during the loop must work.</p>
          </>
        ),
        pre: [...WARM, enable24(), bcast("HOST-A", "HOST-C"), shut24()],
        runs: [
          { label: "HOST-A broadcasts again", actions: [bcast("HOST-A", "HOST-C")] },
          { label: "Then HOST-D pings HOST-A", actions: [ping("HOST-D", "HOST-A")], keep: true },
        ],
        show: ["copies", "where", "flaps"],
      },
      {
        title: "Why STP exists",
        body: (
          <>
            <p>You wanted two cables, so that one can fail. But two <i>forwarding</i> paths make a loop that nothing in Ethernet can stop. <B>Spanning Tree</B> keeps both cables plugged in, <B>blocks</B> one port so only one path forwards, and unblocks it if the active path fails.</p>
            <p>That is the next lesson. Here, you&apos;ve seen the problem it solves.</p>
          </>
        ),
        show: ["uplinks"],
      },
    ],
  },
];
