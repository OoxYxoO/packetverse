"use client";

import { useState, type ReactNode } from "react";
import { LessonPresentation } from "@/components/presentation/LessonPresentation";
import { Mover, StageHead, type DeckStep } from "@/components/presentation/ScrollyDeck";
import { Chain, Compare, MiniTable, ReplayButton, Token, Topo, nodeAt, short, type TopoLink, type TopoNode, type TopoView } from "@/components/presentation/Visuals";
import { useFitNodes } from "@/components/presentation/fitNarrow";

/**
 * SR-MPLS Foundations — the presentation before the lesson and the SR-MPLS Lab. Same diamond, loopbacks, SRGB, Node SIDs
 * (16001–16006) and Adjacency SID (R3→R5 = 24035, IOS XR numbering) as the guided lesson and the lab. Presentation state only.
 */

type Id = "same" | "idea" | "igp" | "srgb" | "index" | "nodesid" | "swap" | "php" | "follow" | "prefix" | "adj" | "adjlocal" | "list" | "execute" | "stateless" | "srgbdiff" | "bgpfree" | "compare" | "breaks" | "verify" | "trouble" | "recap";
type Step = DeckStep & { id: Id };
const B = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;

const STEPS: Step[] = [
  { id: "same", chapter: "The problem", title: "Steering traffic used to mean signaling it.", body: <p>With RSVP-TE, every engineered path is an LSP that each router along the way has to signal and remember. A thousand paths through a router means a thousand sets of state there. Can the headend steer traffic without asking the core for anything?</p> },
  { id: "idea", chapter: "The idea", title: "Put the path in the packet.", body: <p><B>Segment routing</B> (RFC 8402) lets the headend write a short list of instructions — <B>segments</B> — into the packet. Over MPLS (RFC 8660), each segment is simply a label. The core just executes the top instruction.</p> },
  { id: "igp", chapter: "The idea", title: "The IGP hands out the labels.", body: <p>No LDP, no RSVP. IS-IS (or OSPF) itself carries the segment information (RFC 8667): each router advertises its label range and the segments it owns. Every router already runs the IGP — so every router learns every segment.</p> },
  { id: "srgb", chapter: "Node SIDs", title: "A reserved block: the SRGB.", body: <p>Each router sets aside a label range for global segments, the <B>Segment Routing Global Block</B>. Here every router uses <B>16000–23999</B>, the IOS XR default, and advertises it in its IS-IS Router Capability.</p> },
  { id: "index", chapter: "Node SIDs", title: "An index, not a label.", body: <p>R6 advertises &quot;10.0.0.6/32 has Prefix-SID <B>index 6</B>&quot;. Every router computes the label itself: its SRGB start plus the index — <B>16006</B>. R1 owns index 1, R2 index 2, and so on.</p> },
  { id: "nodesid", chapter: "Following a Node SID", title: "16006 means: get to R6.", body: <p>A <B>Node SID</B> — the Prefix-SID of a router&apos;s loopback — is an instruction: reach this router along the IGP shortest path. R1 wants to reach R6: it pushes <B>16006</B> and sends it toward R2, its shortest path.</p> },
  { id: "swap", chapter: "Following a Node SID", title: "Swap to the same label.", body: <p>R2 looks up 16006: shortest path to R6 is via R4, and R4&apos;s label for index 6 is also 16006. R2 swaps 16006 → 16006 and forwards. With the same SRGB everywhere, the label never seems to change.</p> },
  { id: "php", chapter: "Following a Node SID", title: "The last hop before R6 pops it.", body: <p>R4&apos;s next hop for index 6 is R6 itself, the owner. R4 <B>pops</B> the label (penultimate-hop popping) and R6 receives a plain IP packet — the same behavior you saw with LDP.</p> },
  { id: "follow", chapter: "Following a Node SID", title: "Change a metric, keep the label.", body: <p>Raise the R2–R4 metric to 50. Every router reruns SPF; R1 still pushes <B>16006</B> but now sends it to R3, and R3 and R5 do the swapping. Nothing was signaled. A Node SID says <B>where</B>, the IGP decides <B>how</B>.</p> },
  { id: "prefix", chapter: "Prefix and node", title: "Every Node SID is a Prefix-SID.", body: <p>A <B>Prefix-SID</B> can be attached to any prefix the IGP advertises; a Node SID is just the Prefix-SID of a router&apos;s own loopback (the N-flag). This lesson only uses Node SIDs.</p> },
  { id: "adj", chapter: "Adjacency SIDs", title: "One label per link: the Adjacency SID.", body: <p>Each router also allocates a label for each of its IS-IS adjacencies: &quot;pop me, and send the packet out of <B>this</B> link&quot;. R3&apos;s Adjacency SID toward R5 is <B>24035</B> in this lesson.</p> },
  { id: "adjlocal", chapter: "Adjacency SIDs", title: "It only means something at R3.", body: <p>An Adjacency SID is <B>local</B>: only R3 has 24035 in its table. If R1 receives a packet whose top label is 24035, it has no idea what to do — and drops it.</p> },
  { id: "list", chapter: "Segment lists", title: "Stack them to steer.", body: <p>To force the bottom path, R1 sends <B>[16003, 24035, 16006]</B>: get to R3, take R3&apos;s link to R5, then get to R6. The headend wrote the whole path into one label stack.</p> },
  { id: "execute", chapter: "Segment lists", title: "Each router executes the top label.", body: <p>R1 executes 16003 itself (R3 is its neighbor: pop). R3 sees 24035 — its own Adjacency SID: pop, out to R5. R5 sees 16006, R6 is its neighbor: pop. R6 receives IP.</p> },
  { id: "stateless", chapter: "Segment lists", title: "The core keeps no per-path state.", body: <p>R3 and R5 didn&apos;t learn about this path, store it, or refresh it. They only have their normal label tables. A million different segment lists cost the core nothing.</p> },
  { id: "srgbdiff", chapter: "Details", title: "Different SRGBs still work.", body: <p>If R4 used 17000–24999, its label for index 6 would be <B>17006</B> — so R2 would swap 16006 → 17006. The index is global; the label is each router&apos;s arithmetic. Same SRGBs just make labels easy to read.</p> },
  { id: "bgpfree", chapter: "Details", title: "Customer traffic rides the Node SID.", body: <p>R1 and R6 exchange the customer prefixes by iBGP; R2–R5 don&apos;t run BGP. R1 resolves 192.168.6.0/24 to its BGP next hop 10.0.0.6 and pushes R6&apos;s Node SID. Without that label, the core would drop the packet.</p> },
  { id: "compare", chapter: "Where it fits", title: "LDP, RSVP-TE, SR-MPLS.", body: <p>Same MPLS data plane, three ways to fill the label tables.</p> },
  { id: "breaks", chapter: "When it breaks", title: "Five ways SR-MPLS fails.", body: <p>An SRGB too small for the indexes, a loopback without a Prefix-SID, a router without segment routing, two routers claiming one index, a metric that sends the Node SID the wrong way.</p> },
  { id: "verify", chapter: "Verify", title: "The questions engineers ask.", body: <p>Is every router SR-capable with a sensible SRGB? Does every loopback have its own index? Is the label for R6 programmed hop by hop? Does the headend push it for the customer route?</p> },
  { id: "trouble", chapter: "Troubleshooting", title: "Climb from the IGP to the label.", body: <p>No sessions to check: the evidence is in the IS-IS database and the label tables. Start at the IGP and climb.</p> },
  { id: "recap", chapter: "The whole idea", title: "Segments from the IGP, paths from the headend.", body: <p>Now watch it in the lesson, then break and fix it in the SR-MPLS Lab.</p> },
];
const VISUAL: Record<Id, string> = Object.fromEntries(STEPS.map((s) => [s.id, ["compare", "breaks", "verify", "trouble", "recap"].includes(s.id) ? s.id : "topo"])) as Record<Id, string>;

const NODES: TopoNode[] = [
  { id: "R1", label: "R1", sub: "10.0.0.1 · 16001", icon: "PE", x: 8, y: 50 },
  { id: "R2", label: "R2", sub: "10.0.0.2 · 16002", icon: "P", x: 36, y: 18 },
  { id: "R4", label: "R4", sub: "10.0.0.4 · 16004", icon: "P", x: 64, y: 18 },
  { id: "R3", label: "R3", sub: "10.0.0.3 · 16003", icon: "P", x: 36, y: 82 },
  { id: "R5", label: "R5", sub: "10.0.0.5 · 16005", icon: "P", x: 64, y: 82 },
  { id: "R6", label: "R6", sub: "10.0.0.6 · 16006", icon: "PE", x: 92, y: 50 },
];
const LINKS: [string, string, string][] = [["R1", "R2", "10"], ["R2", "R4", "10"], ["R4", "R6", "10"], ["R1", "R3", "15"], ["R3", "R5", "15"], ["R5", "R6", "15"]];

function Deck({ step: s, play, replay }: { step: Step; play: number; replay: () => void }) {
  const FIT = useFitNodes(NODES, 320);
  const id = s.id;
  const k = `${id}-${play}`;
  const head = <StageHead chapter={s.chapter} title={s.title} />;
  const go = (f: string, t: string, o: { label: string; key: string; delay?: number; stay?: boolean; color?: string }) => {
    const from = nodeAt(FIT.nodes, f);
    const to = nodeAt(FIT.nodes, t);
    return (
      <Mover key={`${k}-${o.key}`} from={from} to={o.stay ? short(from, to) : to} delay={o.delay} duration={800} stay={o.stay}>
        <Token color={o.color ?? "cyan"}>{o.label}</Token>
      </Mover>
    );
  };

  if (VISUAL[id] === "topo") {
    const metric = (a: string, b: string, m: string) => (id === "follow" && a === "R2" && b === "R4" ? "50" : m);
    const bottomHot = ["follow", "list", "execute", "stateless"].includes(id);
    const topHot = ["nodesid", "swap", "php", "bgpfree", "srgbdiff"].includes(id);
    const links: TopoLink[] = LINKS.map(([a, b, m]) => {
      const bottom = [a, b].some((x) => x === "R3" || x === "R5");
      const hot = (bottom && bottomHot) || (!bottom && topHot);
      return { a, b, state: (hot ? "active" : bottomHot || topHot ? "dim" : "up") as TopoLink["state"], label: ["igp", "follow", "same"].includes(id) ? metric(a, b, m) : id === "adj" && a === "R3" && b === "R5" ? "24035" : "" };
    });
    const views: Record<string, TopoView> = {};
    let movers: ReactNode = null;
    if (id === "same") {
      views.R2 = { bubble: { text: "state for every LSP", tone: "warn" } };
      views.R3 = { bubble: { text: "state for every LSP", tone: "warn", delay: 300 } };
    }
    if (id === "idea") views.R1 = { bubble: { text: "[instruction, instruction, …]", tone: "yes" } };
    if (id === "igp") {
      movers = <>{go("R6", "R4", { label: "LSP: SRGB · index 6", key: "1", color: "violet" })}{go("R4", "R2", { label: "LSP", key: "2", delay: 900, color: "violet" })}{go("R2", "R1", { label: "LSP", key: "3", delay: 1800, color: "violet" })}</>;
    }
    if (id === "srgb") for (const n of ["R1", "R2", "R3", "R4", "R5", "R6"]) views[n] = { badge: { text: "16000–23999", tone: "info" } };
    if (id === "index") {
      views.R6 = { bubble: { text: "10.0.0.6/32 → index 6", tone: "yes" } };
      views.R1 = { bubble: { text: "16000 + 6 = 16006", tone: "info", delay: 500 } };
    }
    if (id === "nodesid") movers = <>{go("R1", "R2", { label: "16006", key: "1" })}</>;
    if (id === "swap") {
      movers = <>{go("R2", "R4", { label: "16006", key: "1" })}</>;
      views.R2 = { bubble: { text: "swap 16006 → 16006", tone: "info" } };
    }
    if (id === "php") {
      movers = <>{go("R4", "R6", { label: "IP", key: "1", color: "green" })}</>;
      views.R4 = { bubble: { text: "next hop owns it: pop", tone: "info" } };
    }
    if (id === "follow") {
      movers = <>{go("R1", "R3", { label: "16006", key: "1" })}{go("R3", "R5", { label: "16006", key: "2", delay: 800 })}{go("R5", "R6", { label: "IP", key: "3", delay: 1600, color: "green" })}</>;
      views.R1 = { bubble: { text: "same label, new path", tone: "yes" } };
    }
    if (id === "prefix") views.R3 = { bubble: { text: "loopback Prefix-SID = Node SID", tone: "info" } };
    if (id === "adj") views.R3 = { bubble: { text: "24035: pop, out to R5", tone: "yes" } };
    if (id === "adjlocal") {
      movers = <>{go("R1", "R3", { label: "✕ 24035?", key: "1", stay: true, color: "red" })}</>;
      views.R1 = { ring: "bad", bubble: { text: "no entry for 24035", tone: "bad" } };
    }
    if (id === "list") {
      views.R1 = { bubble: { text: "[16003, 24035, 16006]", tone: "yes" } };
    }
    if (id === "execute") {
      movers = <>{go("R1", "R3", { label: "24035 | 16006", key: "1", color: "violet" })}{go("R3", "R5", { label: "16006", key: "2", delay: 900 })}{go("R5", "R6", { label: "IP", key: "3", delay: 1800, color: "green" })}</>;
      views.R3 = { bubble: { text: "my Adj-SID: pop, to R5", tone: "info", delay: 900 } };
    }
    if (id === "stateless") {
      views.R3 = { bubble: { text: "no path state", tone: "yes" } };
      views.R5 = { bubble: { text: "no path state", tone: "yes", delay: 300 } };
    }
    if (id === "srgbdiff") {
      views.R4 = { badge: { text: "17000–24999", tone: "warn" } };
      movers = <>{go("R2", "R4", { label: "17006", key: "1", color: "amber" })}</>;
      views.R2 = { bubble: { text: "swap 16006 → 17006", tone: "info" } };
    }
    if (id === "bgpfree") {
      views.R1 = { bubble: { text: "192.168.6.0/24 → push 16006", tone: "yes" } };
      views.R4 = { bubble: { text: "no BGP in the core", tone: "info", delay: 400 } };
    }
    return (
      <>
        {head}
        <Topo nodes={FIT.nodes} links={links} views={views} ratio={56} minH={FIT.minH}>
          {movers}
        </Topo>
        {movers && <ReplayButton onClick={replay} />}
      </>
    );
  }

  switch (id) {
    case "compare":
      return (
        <>
          {head}
          <Compare items={[{ title: "LDP", tone: "violet", body: "a protocol beside the IGP · labels per FEC per router · follows the IGP only" }, { title: "RSVP-TE", tone: "amber", body: "signals each engineered LSP · state on every router of every path" }, { title: "SR-MPLS", tone: "cyan", body: "segments in the IGP · Node SIDs follow the IGP · segment lists steer without core state" }]} />
        </>
      );
    case "breaks":
      return (
        <>
          {head}
          <MiniTable title="How SR-MPLS fails" cols={["Fault", "What you see"]} rows={[{ cells: ["SRGB too small on a router", "no label for the higher indexes there"], state: "hit" }, { cells: ["Loopback without a Prefix-SID", "IGP route, but no label to it"] }, { cells: ["Segment routing off on a router", "XR: Unlabelled upstream · Junos: no entry"] }, { cells: ["Two routers, one index", "conflict: the lower prefix keeps it"] }, { cells: ["Wrong metric", "works, but the Node SID takes the long way"] }]} />
        </>
      );
    case "verify":
      return (
        <>
          {head}
          <div className="grid gap-2 sm:grid-cols-2">
            <MiniTable title="IOS XR" cols={["Question", "Command"]} rows={[{ cells: ["Which Node SID labels?", "show isis segment-routing label table"] }, { cells: ["SRGB and Prefix-SIDs?", "show isis database verbose"] }, { cells: ["Swap, pop, Unlabelled?", "show mpls forwarding"] }, { cells: ["The labeled path?", "traceroute sr-mpls 10.0.0.6/32"] }]} />
            <MiniTable title="Junos" cols={["Question", "Command"]} rows={[{ cells: ["SR routes to loopbacks?", "show route table inet.3"] }, { cells: ["SRGB and Prefix SIDs?", "show isis database extensive"] }, { cells: ["Swap, pop?", "show route table mpls.0"] }, { cells: ["Customer route labeled?", "show route 192.168.6.20"] }]} />
          </div>
        </>
      );
    case "trouble":
      return (
        <>
          {head}
          <Chain k="trouble" items={[{ t: "Which test fails, and where does the packet stop?", tone: "plain" }, { t: "Is IS-IS up, and which path is shortest?", tone: "cyan" }, { t: "Is every router SR-capable, with an SRGB that fits?", tone: "violet" }, { t: "Does every loopback have its own Prefix-SID?", tone: "violet" }, { t: "Is the destination's label programmed hop by hop?", tone: "violet" }, { t: "Does the headend push it for the customer route?", tone: "amber" }, { t: "Fix one thing, test again", tone: "green" }]} />
        </>
      );
    case "recap":
      return (
        <>
          {head}
          <Chain k="recap" items={[{ t: "IS-IS carries the SRGB and a Prefix-SID index per loopback" }, { t: "Label = SRGB start + index, computed by every router", tone: "cyan" }, { t: "Node SID: shortest path to a router — swap, then PHP", tone: "violet" }, { t: "Adjacency SID: this link, at the router that owns it", tone: "amber" }, { t: "Segment list: the headend writes the path; the core keeps no state", tone: "green" }]} />
        </>
      );
  }
  return head;
}

export function SrPresentation({ open, onClose, onFinish, finishLabel }: { open: boolean; onClose: () => void; onFinish: () => void; finishLabel: string }) {
  const [play, setPlay] = useState(0);
  return (
    <LessonPresentation
      open={open}
      onClose={onClose}
      title="SR-MPLS, from zero"
      kicker="Learn · the SR-MPLS presentation"
      steps={STEPS}
      visual={(s) => VISUAL[s.id as Id]}
      renderStage={(s) => <Deck step={s as Step} play={play} replay={() => setPlay((p) => p + 1)} />}
      finish={{ label: finishLabel, onClick: onFinish }}
      skip={{ label: "Skip →", onClick: onFinish }}
    />
  );
}
