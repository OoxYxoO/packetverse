import type { ReactNode } from "react";
import type { SpLevel } from "@/components/sp-lab/spKit";
import { TE_LO, type TeAction, type TeCfg, type TeR } from "@/lib/sim-engine/scenarios/teNet";

/**
 * RSVP-TE Lab · Learn — six levels:
 *   1 Why traffic engineering · 2 The TED and CSPF · 3 Signaling: PATH and RESV · 4 Into the tunnel ·
 *   5 Constraints and priorities · 6 Read the evidence
 */

const B = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;
const M = ({ children }: { children: ReactNode }) => <span className="pv-mono text-pv-text">{children}</span>;
const set = (text: string, dev: TeR, f: (c: TeCfg) => void): TeAction => ({ type: "set", text, changes: [{ dev, f }] });
const flow = (mbps: number, from: "CE1" | "CE6" = "CE1"): TeAction => ({ type: "test", from, mbps });
const noTunnel = set("Before traffic engineering: R1 has no tunnel", "R1", (c) => void (c.tunnels = []));
const shut1 = set("tunnel-te1 is configured but shut down", "R1", (c) => void (c.tunnels[0].shut = true));
const noAuto = set("tunnel-te1 without autoroute announce", "R1", (c) => void (c.tunnels[0].autoroute = false));

export const TE_LEVELS: SpLevel<TeAction>[] = [
  {
    n: 1,
    title: "Why traffic engineering",
    idea: "IS-IS sends everything down the shortest path — whether it fits or not.",
    steps: [
      {
        title: "The shortest path is the busy one",
        body: (
          <p>
            CE1 starts a <B>500 Mbps</B> video stream to CE6. IS-IS sends it the cheapest way: R1–R2–R4–R6 (cost 30). But R2–R4 already carries <B>800 Mbps</B> of other traffic on a 1 Gbps link. The bottom path (R1–R3–R5–R6, cost 45) has plenty of room — IS-IS doesn&apos;t know or care.
          </p>
        ),
        pre: [noTunnel],
        runs: [{ label: "Send 500 Mbps from CE1 to CE6", actions: [flow(500)] }],
        show: ["loads", "test"],
        check: { q: "R1–R3–R5–R6 has room. Why doesn't IS-IS use it?", options: [{ id: "a", label: "IS-IS compares metrics only; it knows nothing about load or bandwidth" }, { id: "b", label: "The bottom links are down" }, { id: "c", label: "IS-IS load-balances only over equal links" }], answer: "a", why: "A link-state IGP picks the lowest total metric. Load, free bandwidth and the size of the flow are not part of its decision." },
      },
      {
        title: "And the other direction",
        body: <p>CE6 answers with a 300 Mbps stream back to CE1. IS-IS chooses R6–R4–R2–R1 for it: the same busy link, the other way. Every direction of every link is its own capacity — and, as you will see, every tunnel is one-way too.</p>,
        pre: [noTunnel],
        runs: [{ label: "Send 300 Mbps from CE6 to CE1", actions: [flow(300, "CE6")] }],
        show: ["loads", "test"],
      },
    ],
  },
  {
    n: 2,
    title: "The TED and CSPF",
    idea: "IS-IS floods each link's TE metric, reservable bandwidth and colors; the headend prunes what can't fit, then runs SPF.",
    steps: [
      {
        title: "What IS-IS floods for TE",
        body: (
          <p>
            With TE extensions, every router floods its links with extra facts: the <B>TE metric</B>, the <B>maximum reservable bandwidth</B> (its RSVP bandwidth), the <B>unreserved bandwidth</B> at each of 8 priorities, and <B>colors</B> (affinity bits). Every router builds the same <B>Traffic Engineering Database</B>. R2–R4 is set to 200 Mbps reservable: the headroom that is really left on it. CUST-B&apos;s 400 Mbps LSP already holds part of R3–R5.
          </p>
        ),
        pre: [shut1],
        show: ["ted"],
      },
      {
        title: "CSPF for 500 Mbps",
        body: (
          <p>
            R1 must place tunnel-te1: 500 Mbps to <M>{TE_LO.R6}</M>. <B>Constrained SPF</B> first removes every link direction that can&apos;t carry it, then runs an ordinary shortest-path calculation on what is left — by TE metric. Nothing is signaled yet: this is the headend thinking.
          </p>
        ),
        pre: [shut1],
        runs: [{ label: "R1 runs CSPF for tunnel-te1", actions: [{ type: "cspf", dev: "R1", id: 1 }] }],
        show: ["ted"],
        check: { q: "Why is R2–R4 pruned although it is a 1 Gbps link?", options: [{ id: "a", label: "Its reservable bandwidth is 200 Mbps — less than the 500 Mbps requested" }, { id: "b", label: "It has a higher metric" }, { id: "c", label: "It isn't running IS-IS" }], answer: "a", why: "CSPF compares the request with the unreserved bandwidth in the TED, not with the physical speed. R2–R4 offers 200 Mbps." },
      },
    ],
  },
  {
    n: 3,
    title: "Signaling: PATH and RESV",
    idea: "PATH goes downstream with the ERO; RESV comes back upstream with the labels and reserves the bandwidth hop by hop.",
    steps: [
      {
        title: "Bring tunnel-te1 up",
        body: (
          <p>
            Unshut the tunnel. R1 turns the CSPF result into an <B>Explicit Route Object</B> and sends <B>PATH</B> along it: each hop checks it can admit 500 Mbps and passes it on. R6, the tail, answers with <B>RESV</B>: going back upstream, each hop reserves the bandwidth on its outgoing interface and hands its upstream neighbor a label.
          </p>
        ),
        pre: [shut1],
        runs: [{ label: "no shutdown on tunnel-te1", actions: [set("R1: tunnel-te1 no shutdown", "R1", (c) => void (c.tunnels[0].shut = false))] }],
        show: ["lsps", "resv"],
      },
      {
        title: "What every router now holds",
        body: <p>Each router on the path chose the label it wants to receive, and remembers what to do with it. R6 asked for implicit-null: R5 pops the label before the last hop (PHP). The reservation shows up in the TED as less unreserved bandwidth — R3–R5 now has 100 Mbps left at priority 7.</p>,
        show: ["labels", "resv", "ted"],
        check: { q: "Who chose the label R3 swaps to (the one R5 receives)?", options: [{ id: "a", label: "R5 — labels are chosen by the router that receives them, and sent upstream in RESV" }, { id: "b", label: "R1, the headend" }, { id: "c", label: "R3" }], answer: "a", why: "RSVP-TE uses downstream label allocation: each hop picks its own incoming label and advertises it upstream in the RESV." },
      },
    ],
  },
  {
    n: 4,
    title: "Into the tunnel",
    idea: "An LSP that is up carries nothing until routing points traffic into it — autoroute announce (IOS XR) or IS-IS shortcuts (Junos).",
    steps: [
      {
        title: "Up, reserved — and unused",
        body: <p>tunnel-te1 is up with 500 Mbps reserved, but nothing tells IS-IS about it. R1&apos;s route to 10.6.6.0/24 is still the IS-IS route via R2, and the stream still crosses R2–R4.</p>,
        pre: [noAuto],
        runs: [{ label: "Send 500 Mbps from CE1 to CE6", actions: [flow(500)] }],
        show: ["route", "test"],
      },
      {
        title: "Autoroute announce",
        body: (
          <p>
            <M>autoroute announce</M> (Junos: <M>protocols isis traffic-engineering shortcuts</M>) makes IS-IS use the tunnel for the tail&apos;s loopback and everything behind it. Now R1 <B>pushes</B> R3&apos;s label, R3 <B>swaps</B> it for R5&apos;s, R5 <B>pops</B> it, and R6 delivers plain IP to CE6.
          </p>
        ),
        pre: [noAuto],
        runs: [{ label: "autoroute announce, then send 500 Mbps again", actions: [set("R1: tunnel-te1 autoroute announce", "R1", (c) => void (c.tunnels[0].autoroute = true)), flow(500)] }],
        show: ["route", "test"],
        check: { q: "CE6's 300 Mbps back to CE1 — does tunnel-te1 carry it?", options: [{ id: "a", label: "No — an LSP is one-way; the return direction needs its own tunnel from R6" }, { id: "b", label: "Yes — RSVP reserves both directions" }, { id: "c", label: "Yes, through RESV" }], answer: "a", why: "PATH and RESV set up one direction only, from headend to tail. Traffic from R6 to R1 follows IS-IS unless R6 has its own LSP." },
      },
    ],
  },
  {
    n: 5,
    title: "Constraints and priorities",
    idea: "Explicit paths, colors and priorities decide which LSP gets which link — they never add capacity.",
    steps: [
      {
        title: "Pin a small tunnel to the top",
        body: (
          <p>
            A second tunnel, <B>150 Mbps</B>, pinned with an <B>explicit path</B>: strict 2.2.2.2, strict 4.4.4.4. CSPF checks that each strict hop is directly connected and that every link still has 150 Mbps unreserved — R2–R4 has 200, so it fits. Colors work the same way: <M>affinity include GOLD</M> would allow only GOLD links.
          </p>
        ),
        runs: [
          {
            label: "Configure tunnel-te2 (150 Mbps, explicit TOP)",
            actions: [
              set("R1: explicit-path TOP (2.2.2.2, 4.4.4.4 strict) and tunnel-te2 150 Mbps", "R1", (c) => {
                c.paths.TOP = [
                  { idx: 1, ip: TE_LO.R2, strict: true },
                  { idx: 2, ip: TE_LO.R4, strict: true },
                ];
                c.tunnels.push({ id: 2, name: "tunnel-te2", dst: TE_LO.R6, bw: 150000, setup: 7, hold: 7, opts: [{ idx: 10, kind: "explicit", path: "TOP" }], include: [], exclude: [], autoroute: false, shut: false });
              }),
            ],
          },
        ],
        show: ["lsps", "resv"],
      },
      {
        title: "Priority: who gets the bandwidth",
        body: (
          <p>
            Grow tunnel-te1 to 700 Mbps. CUST-B holds 400 Mbps on R3–R5 at the same priority, so the new size can&apos;t be signaled — <B>make-before-break</B> keeps the old LSP with 500 Mbps. Now give tunnel-te1 <B>setup and hold priority 3</B>: CUST-B&apos;s hold priority is 7 (worse), so R3–R5 gives its bandwidth to tunnel-te1 and CUST-B is <B>preempted</B>. Then send the 700 Mbps flow.
          </p>
        ),
        runs: [
          { label: "signalled-bandwidth 700000", actions: [set("R1: tunnel-te1 signalled-bandwidth 700000", "R1", (c) => void (c.tunnels[0].bw = 700000))] },
          { label: "priority 3 3, then send 700 Mbps", actions: [set("R1: tunnel-te1 priority 3 3", "R1", (c) => void Object.assign(c.tunnels[0], { setup: 3, hold: 3 })), flow(700)] },
        ],
        show: ["lsps", "test"],
        check: { q: "tunnel-te1 now holds 700 Mbps on R3–R5. Why does the flow still lose packets?", options: [{ id: "a", label: "A reservation moves no traffic: CUST-B's 400 Mbps still crosses R3–R5, now outside any LSP" }, { id: "b", label: "Preemption takes a few minutes" }, { id: "c", label: "700 Mbps is above the link speed" }], answer: "a", why: "RSVP-TE books capacity in the control plane. CUST-B's traffic still flows — over IS-IS now — so R3–R5 carries 50 + 400 + 700 Mbps. Priorities decide who gets the promise, not how much the link can carry." },
      },
    ],
  },
  {
    n: 6,
    title: "Read the evidence",
    idea: "Symptom → is the LSP up → is the link in the TED → where is the bandwidth reserved → is traffic routed into the tunnel.",
    steps: [
      {
        title: "The guided lesson's incident",
        body: (
          <p>
            The video is upgraded to 700 Mbps and R1 reloads in the same window. CUST-B was decommissioned last week — nobody removed its tunnel on R3. After the reload tunnel-te1 must be signaled from scratch, and CUST-B is the incumbent on R3–R5. Read the ladder: which question gives it away?
          </p>
        ),
        pre: [{ type: "custb", on: false }, set("R1: tunnel-te1 signalled-bandwidth 700000", "R1", (c) => void (c.tunnels[0].bw = 700000))],
        runs: [{ label: "R1 reloads, then send 700 Mbps", actions: [{ type: "reload", dev: "R1" }, flow(700)] }],
        show: ["ladder", "test"],
      },
      {
        title: "Fix one thing, prove it",
        body: <p>The stale reservation is the cause: shut down CUST-B&apos;s tunnel on R3. R3–R5 has all of its 1000 Mbps unreserved again, tunnel-te1 comes up with 700 Mbps, and a fresh test proves the stream is whole. Proof is always the network, not the command.</p>,
        pre: [{ type: "custb", on: false }, set("R1: tunnel-te1 signalled-bandwidth 700000", "R1", (c) => void (c.tunnels[0].bw = 700000)), { type: "reload", dev: "R1" }],
        runs: [{ label: "Shut CUST-B's tunnel on R3, then send 700 Mbps", actions: [set("R3: interface tunnel-te10 shutdown (CUST-B is gone)", "R3", (c) => void (c.tunnels[0].shut = true)), flow(700)] }],
        show: ["ladder", "test"],
      },
    ],
  },
];
