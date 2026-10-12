"use client";

import { useState, type ReactNode } from "react";
import { LessonPresentation } from "@/components/presentation/LessonPresentation";
import { Mover, StageHead, type DeckStep } from "@/components/presentation/ScrollyDeck";
import { Chain, Compare, MiniTable, ReplayButton, Token, Topo, nodeAt, short, type TopoLink, type TopoNode, type TopoView } from "@/components/presentation/Visuals";
import { useFitNodes } from "@/components/presentation/fitNarrow";

/**
 * SR Flex-Algo — the presentation before the lesson and the SR Flex-Algo Lab. Same routers, metrics, delays, affinities,
 * definition and labels as the guided lesson and the lab (IOS XR). Presentation state only.
 */

type Id = "problem" | "algo0" | "why" | "idea" | "fad" | "metric" | "affinity" | "topo" | "part" | "sid" | "two" | "steer" | "wire" | "r2" | "definition" | "detour" | "election" | "notpolicy" | "breaks" | "verify" | "trouble" | "recap";
type Step = DeckStep & { id: Id };
const B = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;

const STEPS: Step[] = [
  { id: "problem", chapter: "The problem", title: "One network, two kinds of traffic.", body: <p>Most traffic from H1 to R6 doesn&apos;t care how it gets there. One application — H66, a trading feed — needs the lowest latency the network can give.</p> },
  { id: "algo0", chapter: "The problem", title: "The IGP knows one answer.", body: <p>IS-IS computes one shortest-path tree on the <B>IGP metric</B>: R1 → R2 → R4 → R6, cost 30. Those links run over a long-haul route: 30 ms each, <B>90 ms</B> one way. The bottom path costs 60 but takes 15 ms.</p> },
  { id: "why", chapter: "The problem", title: "Change the metrics? Then everyone moves.", body: <p>Lowering the bottom metrics would move <i>all</i> traffic — and the bottom links might not have the capacity. An SR policy with an explicit list works, but it is headend state for every flow and every destination.</p> },
  { id: "idea", chapter: "The idea", title: "Let the IGP compute a second topology.", body: <p><B>Flexible Algorithm</B> (RFC 9350): alongside algorithm 0, routers compute extra topologies, each with its own rules — and its own labels. Traffic picks a topology by the label it carries.</p> },
  { id: "fad", chapter: "The definition", title: "A definition everyone agrees on.", body: <p>R1 advertises the <B>Flex-Algo Definition</B> (FAD) for algorithm 128 in IS-IS: metric type <B>delay</B>, <B>exclude-any BLUE</B>, priority 100. Every router reads the same definition from the IGP.</p> },
  { id: "metric", chapter: "The definition", title: "Metric type: what is minimized.", body: <p>Each router advertises its links&apos; measured delay (here a static 30 ms on top, 5 ms on the bottom, 3 ms across R3–R4). Algorithm 128 adds up <B>delay</B> instead of the IGP metric.</p> },
  { id: "affinity", chapter: "The definition", title: "Affinity: which links may be used at all.", body: <p>The top links are tagged <B>BLUE</B>, the bottom ones <B>GOLD</B>. Exclude-any BLUE removes the top links from algorithm 128&apos;s topology — not more expensive, simply absent.</p> },
  { id: "topo", chapter: "Computing it", title: "The algorithm-128 topology.", body: <p>What is left: R1–R3, R3–R5, R5–R6 and the R3–R4 cross-link. On delay, R1 → R3 → R5 → R6 wins: <B>15 ms</B>. R4 → R6 is BLUE, so the cross-link leads nowhere toward R6.</p> },
  { id: "part", chapter: "Computing it", title: "Only participants are in it.", body: <p>A router takes part by configuring <B>flex-algo 128</B>. Each participant runs the algorithm itself, with the same definition, and gets the same answer — distributed, like any IGP SPF. Non-participants are cut out of the topology.</p> },
  { id: "sid", chapter: "Labels", title: "One prefix, one SID per algorithm.", body: <p>R6&apos;s loopback carries two prefix SIDs: index 6 for algorithm 0 (<B>16006</B>) and index 106 for algorithm 128 (<B>16106</B>). The label says which tree to follow.</p> },
  { id: "two", chapter: "Labels", title: "Same destination, two paths.", body: <p>16006 follows algorithm 0 over the top. 16106 follows algorithm 128 over the bottom. No router keeps per-flow state — just one more label table per algorithm.</p> },
  { id: "steer", chapter: "Steering", title: "Putting the app on algorithm 128.", body: <p>R6 colors H66&apos;s prefix with <B>128</B>. R1&apos;s SR policy LOW-LATENCY (color 128) has a dynamic path with the constraint <B>sid-algorithm 128</B>: it resolves to a single label, 16106.</p> },
  { id: "wire", chapter: "Steering", title: "One label does the work.", body: <p>R1 pushes 16106 toward R3; R3 swaps it toward R5 on its own algorithm-128 tree; R5 pops it for R6. 15 ms, with a one-label stack.</p> },
  { id: "r2", chapter: "Steering", title: "R2 is cut off — and that is correct.", body: <p>R2 participates, but all its links are BLUE: in algorithm 128 it has no neighbors. It installs no algorithm-128 label for R6. Its algorithm-0 forwarding is untouched.</p> },
  { id: "definition", chapter: "A definition, not a path", title: "Change the network, the path follows.", body: <p>Algorithm 128 names a rule, not a route. If a link&apos;s delay changes or a constraint is lifted, every participant recomputes and 16106 may take a different path — with no change on R1.</p> },
  { id: "detour", chapter: "A definition, not a path", title: "R3–R5 slows down.", body: <p>Lift the BLUE exclusion and let R3–R5 advertise 80 ms. Algorithm 128 now picks R1 → R3 → R4 → R6: 5 + 3 + 30 = <B>38 ms</B>, the best path left. Same label.</p> },
  { id: "election", chapter: "Who decides", title: "The highest priority wins.", body: <p>If R6 also advertises a definition for 128 — priority 200, IGP metric, no exclusion — it wins, and everyone computes algorithm 128 R6&apos;s way: the top path. Nothing goes down; 16106 just means something else.</p> },
  { id: "notpolicy", chapter: "Where it fits", title: "Flex-Algo vs SR Policy.", body: <p>Both steer traffic off the default path. Where the path is computed is what differs.</p> },
  { id: "breaks", chapter: "When it breaks", title: "Five ways Flex-Algo fails.", body: <p>A router on the path stops participating; nobody advertises the definition; another definition wins; R6 has no algorithm-128 SID; a link on the path carries an excluded affinity.</p> },
  { id: "verify", chapter: "Verify", title: "The questions engineers ask.", body: <p>Which definition won, and from whom? Who participates? Does R6 advertise its algorithm SID? Does R1 have a label and a path for it? Which label does the app actually get — and what latency?</p> },
  { id: "trouble", chapter: "Troubleshooting", title: "Flex-Algo fails quietly.", body: <p>When algorithm 128 breaks, traffic usually falls back to algorithm 0 and keeps flowing — just slower. Read the definition, participation and labels, then measure.</p> },
  { id: "recap", chapter: "The whole idea", title: "A second topology, chosen by label.", body: <p>Now watch it in the lesson, then break and fix it in the SR Flex-Algo Lab.</p> },
];
const VISUAL: Record<Id, string> = Object.fromEntries(STEPS.map((s) => [s.id, ["notpolicy", "breaks", "verify", "trouble", "recap"].includes(s.id) ? s.id : "topo"])) as Record<Id, string>;

const NODES: TopoNode[] = [
  { id: "R1", label: "R1", sub: "headend", icon: "PE", x: 8, y: 50 },
  { id: "R2", label: "R2", sub: "16002", icon: "P", x: 36, y: 16 },
  { id: "R4", label: "R4", sub: "16004", icon: "P", x: 64, y: 16 },
  { id: "R3", label: "R3", sub: "16003", icon: "P", x: 36, y: 84 },
  { id: "R5", label: "R5", sub: "16005", icon: "P", x: 64, y: 84 },
  { id: "R6", label: "R6", sub: "16006 · 16106", icon: "PE", x: 92, y: 50 },
];
const LINKS: [string, string, string, string, string][] = [["R1", "R2", "10", "30 ms", "BLUE"], ["R2", "R4", "10", "30 ms", "BLUE"], ["R4", "R6", "10", "30 ms", "BLUE"], ["R1", "R3", "20", "5 ms", "GOLD"], ["R3", "R5", "20", "5 ms", "GOLD"], ["R5", "R6", "20", "5 ms", "GOLD"], ["R3", "R4", "5", "3 ms", ""]];
const TOP = new Set(["R1-R2", "R2-R4", "R4-R6"]);
const BOT = new Set(["R1-R3", "R3-R5", "R5-R6"]);
const CROSS = new Set(["R1-R3", "R3-R4", "R4-R6"]);

function Deck({ step: s, play, replay }: { step: Step; play: number; replay: () => void }) {
  const FIT = useFitNodes(NODES, 270);
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
    const gone = ["affinity", "topo", "part", "wire", "r2", "two"].includes(id) ? TOP : new Set<string>();
    const hot = ["problem", "algo0", "election"].includes(id) ? TOP : ["topo", "wire", "steer"].includes(id) ? BOT : id === "detour" ? CROSS : new Set<string>();
    const links: TopoLink[] = LINKS.map(([a, b, m, d, aff]) => {
      const key = `${a}-${b}`;
      const label = id === "algo0" || id === "why" ? m : id === "metric" || id === "detour" ? (id === "detour" && key === "R3-R5" ? "80 ms" : d) : id === "affinity" || id === "fad" ? aff : "";
      return { a, b, state: (gone.has(key) ? "dim" : id === "two" ? (BOT.has(key) ? "active" : "up") : hot.has(key) ? "active" : hot.size ? "dim" : "up") as TopoLink["state"], label };
    });
    const views: Record<string, TopoView> = {};
    let movers: ReactNode = null;
    if (id === "problem") views.R6 = { bubble: { text: "H66 needs low latency", tone: "ask" } };
    if (id === "algo0") views.R1 = { bubble: { text: "IGP: cost 30, 90 ms", tone: "warn" } };
    if (id === "why") views.R1 = { bubble: { text: "metrics move everyone", tone: "warn" } };
    if (id === "idea") views.R1 = { bubble: { text: "algo 0 + algo 128", tone: "yes" } };
    if (id === "fad") views.R1 = { ring: "hit", bubble: { text: "FAD 128: delay, no BLUE", tone: "yes" } };
    if (id === "topo") views.R1 = { bubble: { text: "algo 128: 15 ms", tone: "yes" } };
    if (id === "part") for (const r of ["R1", "R2", "R3", "R4", "R5", "R6"]) views[r] = { badge: { text: "FA128", tone: "info" } };
    if (id === "sid") views.R6 = { bubble: { text: "16006 · 16106", tone: "info" } };
    if (id === "two") movers = <>{go("R1", "R2", { label: "16006", key: "1" })}{go("R1", "R3", { label: "16106", key: "2", color: "violet" })}</>;
    if (id === "steer") views.R1 = { bubble: { text: "color 128 → [16106]", tone: "yes" } };
    if (id === "wire") movers = <>{go("R1", "R3", { label: "16106", key: "1", color: "violet" })}{go("R3", "R5", { label: "16106", key: "2", delay: 800, color: "violet" })}{go("R5", "R6", { label: "IP", key: "3", delay: 1600, color: "green" })}</>;
    if (id === "r2") views.R2 = { ring: "bad", bubble: { text: "no algo-128 neighbors", tone: "warn" } };
    if (id === "definition") views.R1 = { bubble: { text: "128 = a rule", tone: "info" } };
    if (id === "detour") views.R1 = { bubble: { text: "16106: 38 ms now", tone: "yes" } };
    if (id === "election") views.R6 = { ring: "hit", bubble: { text: "FAD prio 200 wins", tone: "bad" } };
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
    case "notpolicy":
      return (
        <>
          {head}
          <Compare items={[{ title: "SR policy (explicit)", tone: "amber", body: "path computed on the headend · written into the label stack · per headend, per destination" }, { title: "Flex-Algo", tone: "cyan", body: "path computed by every participant · one label · per algorithm, for every prefix" }, { title: "Together", tone: "violet", body: "a policy with sid-algorithm 128 picks the algorithm; Flex-Algo provides the path" }]} />
        </>
      );
    case "breaks":
      return (
        <>
          {head}
          <MiniTable title="How Flex-Algo fails" cols={["Fault", "What you see"]} rows={[{ cells: ["A router on the path doesn't participate", "policy down, 90 ms"], state: "hit" }, { cells: ["No definition advertised", "algorithm unusable, 90 ms"] }, { cells: ["Another definition wins", "policy up, 16106, 90 ms"] }, { cells: ["No algorithm SID on R6", "policy down, 90 ms"] }, { cells: ["Excluded affinity on the path", "policy down, 90 ms"] }]} />
        </>
      );
    case "verify":
      return (
        <>
          {head}
          <MiniTable title="IOS XR" cols={["Question", "Command"]} rows={[{ cells: ["Which definition won?", "show isis flex-algo 128"] }, { cells: ["SIDs, delays, affinities?", "show isis database verbose"] }, { cells: ["Labels per algorithm?", "show mpls forwarding"] }, { cells: ["Is the app steered?", "show segment-routing traffic-eng policy"] }]} />
        </>
      );
    case "trouble":
      return (
        <>
          {head}
          <Chain k="trouble" items={[{ t: "Which label does the app get, and what latency?", tone: "plain" }, { t: "Is the policy up?", tone: "cyan" }, { t: "Which definition won, from whom?", tone: "violet" }, { t: "Who participates?", tone: "violet" }, { t: "Does R6 advertise its algorithm SID?", tone: "amber" }, { t: "Does R1 have a path and label for it?", tone: "amber" }, { t: "Fix one thing, measure again", tone: "green" }]} />
        </>
      );
    case "recap":
      return (
        <>
          {head}
          <Chain k="recap" items={[{ t: "FAD = metric type + affinity rules; highest priority wins" }, { t: "Participants compute the algorithm's topology themselves", tone: "cyan" }, { t: "One prefix SID per algorithm: the label picks the topology", tone: "violet" }, { t: "The path is a result: change the network, it follows", tone: "amber" }, { t: "Broken Flex-Algo is quiet: measure the latency", tone: "green" }]} />
        </>
      );
  }
  return head;
}

export function FaPresentation({ open, onClose, onFinish, finishLabel }: { open: boolean; onClose: () => void; onFinish: () => void; finishLabel: string }) {
  const [play, setPlay] = useState(0);
  return (
    <LessonPresentation
      open={open}
      onClose={onClose}
      title="Flex-Algo, from zero"
      kicker="Learn · the SR Flex-Algo presentation"
      steps={STEPS}
      visual={(s) => VISUAL[s.id as Id]}
      renderStage={(s) => <Deck step={s as Step} play={play} replay={() => setPlay((p) => p + 1)} />}
      finish={{ label: finishLabel, onClick: onFinish }}
      skip={{ label: "Skip →", onClick: onFinish }}
    />
  );
}
