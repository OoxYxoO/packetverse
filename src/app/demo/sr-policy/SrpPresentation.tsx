"use client";

import { useState, type ReactNode } from "react";
import { LessonPresentation } from "@/components/presentation/LessonPresentation";
import { Mover, StageHead, type DeckStep } from "@/components/presentation/ScrollyDeck";
import { Chain, Compare, MiniTable, ReplayButton, Token, Topo, nodeAt, short, type TopoLink, type TopoNode, type TopoView } from "@/components/presentation/Visuals";
import { useFitNodes } from "@/components/presentation/fitNarrow";

/**
 * SR Policy — the presentation before the lesson and the SR Policy Lab. Same routers, colors, candidates, labels and
 * BSID as the guided lesson and the lab (IOS XR). Presentation state only.
 */

type Id = "same" | "intent" | "color" | "headend" | "cands" | "explicit" | "dynamic" | "select" | "bsid" | "steer" | "twoflows" | "wire" | "fail" | "down" | "notfrr" | "validate" | "compare" | "breaks" | "verify" | "trouble" | "recap";
type Step = DeckStep & { id: Id };
const B = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;

const STEPS: Step[] = [
  { id: "same", chapter: "The problem", title: "A segment list is a path, not a plan.", body: <p>The last lesson steered a packet with <B>[16003, 24035, 16006]</B>. But who decides which traffic gets that list? What happens when R3–R5 fails? A list on its own has no intent, no fallback and no way to attract traffic.</p> },
  { id: "intent", chapter: "The idea", title: "An SR policy is intent.", body: <p>An <B>SR policy</B> (RFC 9256) wraps segment lists in an intent: on headend <B>R1</B>, traffic of color <B>100</B> toward end-point <B>R6</B>. Everything else — which path, which fallback — hangs off that identity.</p> },
  { id: "color", chapter: "The idea", title: "Color is just a number with meaning.", body: <p>Color 100 means &quot;GOLD&quot; because the operator says so. It is not a label, not a VLAN, not DSCP — an opaque 32-bit value that names an intent. (Color, end-point) identifies the policy on its headend.</p> },
  { id: "headend", chapter: "The idea", title: "Only the headend knows.", body: <p>The policy lives on R1 alone. R2–R6 never hear about it: they keep their ordinary Node and Adjacency SID tables, as in the last lesson. All path state is in R1 and in the packet.</p> },
  { id: "cands", chapter: "Candidate paths", title: "Several ways to satisfy one intent.", body: <p>A policy has <B>candidate paths</B>, each with a <B>preference</B>. GOLD has two: preference 200 and preference 100.</p> },
  { id: "explicit", chapter: "Candidate paths", title: "Preference 200: explicit.", body: <p>An operator-written segment list, GOLD-EXPLICIT: R3&apos;s loopback, R5&apos;s address on the R3–R5 link, R6&apos;s loopback. R1 resolves it to <B>[16003, 24035, 16006]</B> — the last lesson&apos;s steered path.</p> },
  { id: "dynamic", chapter: "Candidate paths", title: "Preference 100: dynamic.", body: <p>R1 computes this one itself: minimize <B>TE metric</B>, using only links with affinity <B>GOLD</B>. Today that is R1 → R3 → R5 → R6, encoded as the shortest stack: <B>[16005, 16006]</B>. No bandwidth is reserved — this isn&apos;t RSVP.</p> },
  { id: "select", chapter: "Candidate paths", title: "Highest preference among the valid.", body: <p>R1 validates every candidate and keeps the valid one with the highest preference: the explicit path is <B>active</B>, the dynamic one waits. An invalid candidate never wins because its number is bigger.</p> },
  { id: "bsid", chapter: "Candidate paths", title: "A label for the whole policy.", body: <p>R1 binds label <B>30001</B> to the policy — the <B>binding SID</B>. A packet reaching R1 with 30001 on top gets the active segment list. It is local to R1, a handle other routers or controllers can use to point at GOLD.</p> },
  { id: "steer", chapter: "Steering", title: "Traffic asks by color.", body: <p>R6 advertises 192.168.6.0/24 with the BGP extended community <B>color 100</B>. On R1, that route&apos;s color and next hop (10.0.0.6) match policy GOLD: R1 <B>steers</B> it into the policy. That is automated steering.</p> },
  { id: "twoflows", chapter: "Steering", title: "Same destination router, two paths.", body: <p>192.168.60.0/24 comes from R6 without a color: it follows R6&apos;s Node SID over R2 and R4. The GOLD prefix rides the policy over R3 and R5. The color made the difference.</p> },
  { id: "wire", chapter: "Steering", title: "The list is not the wire.", body: <p>R1 executes the first segment itself — R3 is its neighbor, so 16003 is popped right away. The packet leaves R1 with <B>24035 | 16006</B>; R3 executes its Adjacency SID, R5 pops 16006 for R6.</p> },
  { id: "fail", chapter: "When paths fail", title: "R3–R5 fails: the next candidate.", body: <p>The explicit list names R5&apos;s address on R3–R5; with the link down there is no adjacency to resolve it to. Preference 200 is <B>invalid</B>. R1 recomputes the dynamic path over the GOLD links left — R3 → R4 → R6, <B>[16003, 16006]</B> — and it becomes active.</p> },
  { id: "down", chapter: "When paths fail", title: "No valid candidate: policy down.", body: <p>Take R3–R4 down too: no GOLD path remains and the policy goes <B>down</B>. On IOS XR the steered route then falls back to R6&apos;s Node SID, over R2 and R4. (The guided lesson keeps GOLD strict to make the point — dropping is an operator&apos;s choice.)</p> },
  { id: "notfrr", chapter: "When paths fail", title: "This is not fast reroute.", body: <p>Candidate switchover happens at the headend, after the IGP has told it about the failure. Protecting traffic within 50 ms at the point of failure is a different mechanism: <B>TI-LFA</B>, two lessons from now.</p> },
  { id: "validate", chapter: "Details", title: "Addresses are checked, labels are trusted.", body: <p>A segment list written as <B>addresses</B> is resolved and validated hop by hop. Written as raw <B>MPLS labels</B>, IOS XR checks only the first one: a typo further down is found by traffic, not by the policy state.</p> },
  { id: "compare", chapter: "Where it fits", title: "RSVP-TE LSP vs SR policy.", body: <p>Both steer traffic away from the shortest path. Where the state lives is what differs.</p> },
  { id: "breaks", chapter: "When it breaks", title: "Five ways an SR policy fails.", body: <p>A preference that makes the wrong candidate active, a route without its color, a policy with the wrong end-point, a router on the path without segment routing, a wrong label in a label-based list.</p> },
  { id: "verify", chapter: "Verify", title: "The questions engineers ask.", body: <p>Is the policy up, and which candidate is active? Does the route carry the color, and is it steered? Which labels leave the headend? Does every label exist where it is executed?</p> },
  { id: "trouble", chapter: "Troubleshooting", title: "Up is not the same as right.", body: <p>Most SR policy faults leave the policy up. Read the policy, the candidates, the steering of the route and the labels — then follow the packet.</p> },
  { id: "recap", chapter: "The whole idea", title: "Intent on the headend, path in the packet.", body: <p>Now watch it in the lesson, then break and fix it in the SR Policy Lab.</p> },
];
const VISUAL: Record<Id, string> = Object.fromEntries(STEPS.map((s) => [s.id, ["compare", "breaks", "verify", "trouble", "recap"].includes(s.id) ? s.id : "topo"])) as Record<Id, string>;

const NODES: TopoNode[] = [
  { id: "R1", label: "R1", sub: "headend", icon: "PE", x: 8, y: 50 },
  { id: "R2", label: "R2", sub: "16002", icon: "P", x: 36, y: 18 },
  { id: "R4", label: "R4", sub: "16004", icon: "P", x: 64, y: 18 },
  { id: "R3", label: "R3", sub: "16003", icon: "P", x: 36, y: 82 },
  { id: "R5", label: "R5", sub: "16005", icon: "P", x: 64, y: 82 },
  { id: "R6", label: "R6", sub: "end-point", icon: "PE", x: 92, y: 50 },
];
const LINKS: [string, string, string, string][] = [["R1", "R2", "10", "BLUE"], ["R2", "R4", "10", "BLUE"], ["R4", "R6", "10", "BLUE+GOLD"], ["R1", "R3", "15", "GOLD"], ["R3", "R5", "15", "GOLD"], ["R5", "R6", "15", "GOLD"], ["R3", "R4", "30", "GOLD"]];
const GOLD_PATH = new Set(["R1-R3", "R3-R5", "R5-R6"]);
const FALLBACK = new Set(["R1-R3", "R3-R4", "R4-R6"]);
const TOP = new Set(["R1-R2", "R2-R4", "R4-R6"]);

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
    const downs = id === "fail" ? ["R3-R5"] : id === "down" ? ["R3-R5", "R3-R4"] : [];
    const hot = ["explicit", "select", "wire", "steer"].includes(id) ? GOLD_PATH : id === "fail" ? FALLBACK : id === "down" || id === "twoflows" ? TOP : id === "dynamic" ? GOLD_PATH : new Set<string>();
    const links: TopoLink[] = LINKS.map(([a, b, m, aff]) => {
      const key = `${a}-${b}`;
      return { a, b, state: (downs.includes(key) ? "down" : hot.has(key) ? "active" : hot.size ? "dim" : "up") as TopoLink["state"], label: ["dynamic", "cands"].includes(id) ? aff : id === "same" ? m : "" };
    });
    const views: Record<string, TopoView> = {};
    let movers: ReactNode = null;
    if (id === "same") views.R1 = { bubble: { text: "[16003, 24035, 16006] — for whom?", tone: "ask" } };
    if (id === "intent") views.R1 = { bubble: { text: "⟨R1, color 100, R6⟩", tone: "yes" } };
    if (id === "color") views.R1 = { badge: { text: "color 100 = GOLD", tone: "info" } };
    if (id === "headend") {
      views.R1 = { bubble: { text: "policy GOLD lives here", tone: "yes" } };
      views.R3 = { bubble: { text: "no policy state", tone: "info", delay: 300 } };
    }
    if (id === "cands") views.R1 = { bubble: { text: "pref 200 · pref 100", tone: "info" } };
    if (id === "explicit") views.R1 = { bubble: { text: "[16003, 24035, 16006]", tone: "yes" } };
    if (id === "dynamic") views.R1 = { bubble: { text: "CSPF: GOLD links, TE metric", tone: "info" } };
    if (id === "select") views.R1 = { badge: { text: "active: pref 200", tone: "info" } };
    if (id === "bsid") {
      movers = <>{go("R2", "R1", { label: "30001", key: "1", color: "violet" })}</>;
      views.R1 = { bubble: { text: "30001 → active list", tone: "yes", delay: 900 } };
    }
    if (id === "steer") {
      movers = <>{go("R6", "R1", { label: "192.168.6.0/24 · color 100", key: "1", color: "amber" })}</>;
      views.R1 = { bubble: { text: "steered into GOLD", tone: "yes", delay: 900 } };
    }
    if (id === "twoflows") {
      movers = <>{go("R1", "R2", { label: "16006", key: "1" })}{go("R2", "R4", { label: "16006", key: "2", delay: 800 })}</>;
      views.R1 = { bubble: { text: "no color → Node SID", tone: "info" } };
    }
    if (id === "wire") {
      movers = <>{go("R1", "R3", { label: "24035 | 16006", key: "1", color: "violet" })}{go("R3", "R5", { label: "16006", key: "2", delay: 900 })}{go("R5", "R6", { label: "IP", key: "3", delay: 1800, color: "green" })}</>;
    }
    if (id === "fail") views.R1 = { bubble: { text: "pref 100 active: [16003, 16006]", tone: "warn" } };
    if (id === "down") views.R1 = { ring: "bad", bubble: { text: "GOLD down → Node SID path", tone: "bad" } };
    if (id === "notfrr") views.R3 = { bubble: { text: "local repair = TI-LFA", tone: "info" } };
    if (id === "validate") {
      views.R1 = { bubble: { text: "addresses: every hop checked", tone: "yes" } };
      views.R3 = { bubble: { text: "labels: only the first", tone: "warn", delay: 400 } };
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
          <Compare items={[{ title: "RSVP-TE LSP", tone: "amber", body: "signaled hop by hop · state on every router of the path · bandwidth reservation" }, { title: "SR policy", tone: "cyan", body: "state on the headend only · path in the label stack · candidates and fallback built in" }, { title: "Both", tone: "violet", body: "steer chosen traffic off the shortest path · MPLS data plane" }]} />
        </>
      );
    case "breaks":
      return (
        <>
          {head}
          <MiniTable title="How an SR policy fails" cols={["Fault", "What you see"]} rows={[{ cells: ["Preferences swapped", "up, but the other candidate is active"], state: "hit" }, { cells: ["Route lost its color", "up, traffic not steered"] }, { cells: ["Wrong end-point", "up, nothing matches it"] }, { cells: ["Router without SR on the path", "up, GOLD dropped mid-path"] }, { cells: ["Wrong label in a label list", "up, GOLD dropped where it's executed"] }]} />
        </>
      );
    case "verify":
      return (
        <>
          {head}
          <MiniTable title="IOS XR on the headend" cols={["Question", "Command"]} rows={[{ cells: ["Policy up? Active candidate?", "show segment-routing traffic-eng policy"] }, { cells: ["Route colored and steered?", "show bgp ipv4 unicast 192.168.6.0/24"] }, { cells: ["Which labels leave R1?", "show cef 192.168.6.0/24"] }, { cells: ["The BSID?", "show mpls forwarding labels 30001"] }]} />
        </>
      );
    case "trouble":
      return (
        <>
          {head}
          <Chain k="trouble" items={[{ t: "Which traffic is affected — GOLD, default, or both?", tone: "plain" }, { t: "Is IS-IS up and every router SR-capable?", tone: "cyan" }, { t: "Is the policy up, with the right color and end-point?", tone: "violet" }, { t: "Which candidate is active, and why?", tone: "violet" }, { t: "Is the route colored and steered?", tone: "amber" }, { t: "Does every label exist where it is executed?", tone: "amber" }, { t: "Fix one thing, test again", tone: "green" }]} />
        </>
      );
    case "recap":
      return (
        <>
          {head}
          <Chain k="recap" items={[{ t: "Policy = ⟨headend, color, end-point⟩; the BSID is its local handle" }, { t: "Candidates: explicit or dynamic; highest valid preference is active", tone: "cyan" }, { t: "Color on the BGP route + matching end-point = steered", tone: "amber" }, { t: "Candidate fails → next one; none valid → policy down, fallback", tone: "violet" }, { t: "Up is not right: read candidates, steering and labels", tone: "green" }]} />
        </>
      );
  }
  return head;
}

export function SrpPresentation({ open, onClose, onFinish, finishLabel }: { open: boolean; onClose: () => void; onFinish: () => void; finishLabel: string }) {
  const [play, setPlay] = useState(0);
  return (
    <LessonPresentation
      open={open}
      onClose={onClose}
      title="SR Policy, from zero"
      kicker="Learn · the SR Policy presentation"
      steps={STEPS}
      visual={(s) => VISUAL[s.id as Id]}
      renderStage={(s) => <Deck step={s as Step} play={play} replay={() => setPlay((p) => p + 1)} />}
      finish={{ label: finishLabel, onClick: onFinish }}
      skip={{ label: "Skip →", onClick: onFinish }}
    />
  );
}
