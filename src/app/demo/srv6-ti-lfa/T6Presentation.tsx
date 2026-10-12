"use client";

import { useState, type ReactNode } from "react";
import { LessonPresentation } from "@/components/presentation/LessonPresentation";
import { Mover, StageHead, type DeckStep } from "@/components/presentation/ScrollyDeck";
import { Chain, Compare, MiniTable, ReplayButton, Token, Topo, nodeAt, type TopoLink, type TopoNode, type TopoView } from "@/components/presentation/Visuals";
import { useFitNodes } from "@/components/presentation/fitNarrow";

/**
 * SRv6 TI-LFA — the presentation before the lesson and the lab. Same network, metrics, SIDs and repairs as the lab
 * (IOS XR): PLR P1, protected link P1–P2, protection path P1–P3–P4. Presentation state only.
 */

type Id = "problem" | "path" | "converge" | "plr" | "naive" | "stale" | "post" | "pspace" | "qspace" | "repair" | "usd" | "walk" | "after" | "node" | "nodewalk" | "detect" | "bfd" | "reverse" | "incident" | "compare" | "breaks" | "verify" | "recap";
type Step = DeckStep & { id: Id };
const B = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;
const M = ({ children }: { children: ReactNode }) => <span className="pv-mono text-pv-text">{children}</span>;

const STEPS: Step[] = [
  { id: "problem", chapter: "The question", title: "Links fail. Customers notice.", body: <p>CUST-A&apos;s VPN runs from PE1 to PE2. When a link in the middle fails, every millisecond until traffic flows again is lost voice, video, transactions.</p> },
  { id: "path", chapter: "The question", title: "Today's path.", body: <p>PE1 → P1 → P2 → PE2, metric 10 per link: cost 30. The protection side — P1–P3–P4 and P4&apos;s links to P2 (50) and PE2 (70) — carries nothing.</p> },
  { id: "converge", chapter: "The question", title: "Convergence takes time.", body: <p>When P1–P2 fails, IS-IS floods the news, every router recomputes, every forwarding table is rewritten. Hundreds of milliseconds — and traffic is lost the whole time.</p> },
  { id: "plr", chapter: "Local repair", title: "One router knows first.", body: <p>P1 sits right in front of the failure: it is the <B>point of local repair</B> (PLR). If P1 had a plan ready, it could switch the moment it detects the failure — without waiting for anyone.</p> },
  { id: "naive", chapter: "Local repair", title: "Just send it to P3?", body: <p>The obvious plan: P1 sends PE2&apos;s traffic to P3 instead. P3 hasn&apos;t heard about the failure yet…</p> },
  { id: "stale", chapter: "Local repair", title: "P3 sends it straight back.", body: <p>P3&apos;s table still says PE2 is via P1 (30, versus 90 via P4). The packet bounces P1 ↔ P3 until P3 converges. A repair has to work with <B>stale tables</B>.</p> },
  { id: "post", chapter: "TI-LFA", title: "Aim for the path after convergence.", body: <p>TI-LFA computes, in advance, the path traffic will take once everyone has converged without P1–P2: <M>P1 → P3 → P4 → P2 → PE2</M> (cost 80). Then it works out how to force traffic onto it today.</p> },
  { id: "pspace", chapter: "TI-LFA", title: "Where P1 can safely send.", body: <p>The <B>P-space</B>: routers P1 reaches without crossing P1–P2 — P3 and P4. Sending to P4&apos;s locator via P3 is safe even with stale tables.</p> },
  { id: "qspace", chapter: "TI-LFA", title: "Where PE2 is safely reached.", body: <p>The <B>Q-space</B>: routers whose own path to PE2 avoids P1–P2 — P2 itself. P4 is not in it: its old path to PE2 goes back via P3 and P1. So P4 must be told exactly which link to use.</p> },
  { id: "repair", chapter: "TI-LFA", title: "The repair: one SID.", body: <p>P1 sends out its link to P3 with a new outer header: DA = P4&apos;s End.X toward P2, <M>2001:db8:110:14:41::</M>. P3 routes it on P4&apos;s locator; P4 executes it.</p> },
  { id: "usd", chapter: "TI-LFA", title: "End.X with USD.", body: <p>P4&apos;s End.X carries the <B>USD</B> flavor: remove the repair header, expose the original packet — still addressed to PE2&apos;s End.DT4 — and send it out of the P4–P2 link. No router needed a new table.</p> },
  { id: "walk", chapter: "TI-LFA", title: "The protected packet.", body: <p>PE1 → P1 → P3 → P4 → P2 → PE2. On P1→P3→P4 two headers: the repair outside, the VPN packet inside. From P4 on, just the VPN packet again.</p> },
  { id: "after", chapter: "TI-LFA", title: "Then convergence takes over.", body: <p>Seconds later IS-IS has converged: P1&apos;s new primary path is via P3 anyway and the repair is released. TI-LFA covers only the gap — but that gap is where the loss was.</p> },
  { id: "node", chapter: "Node protection", title: "What if P2 itself dies?", body: <p>The link repair merges back at P2 — into a dead router. <B>Node protection</B> computes the path that avoids P2: P1 → P3 → P4 → PE2, repair <M>…:14:42::</M> (P4&apos;s End.X toward PE2).</p> },
  { id: "nodewalk", chapter: "Node protection", title: "Around the router.", body: <p>Same repair node, same mechanism, different adjacency. IOS XR: <M>fast-reroute per-prefix tiebreaker node-protecting index 100</M>. The lab runs it by default.</p> },
  { id: "detect", chapter: "Detection", title: "A backup needs a trigger.", body: <p>A broken fiber is noticed in about 10 ms (loss of light). But P1–P2 runs over <B>DWDM</B>: if the span fails the interfaces stay up. Without help, P1 waits for the IS-IS hold time — 30 s.</p> },
  { id: "bfd", chapter: "Detection", title: "BFD makes it fast.", body: <p>BFD exchanges packets every 50 ms; three missed and the session is down: 150 ms. Then the 15 ms switch. Repair is only as fast as detection.</p> },
  { id: "reverse", chapter: "Detection", title: "Every direction, every PLR.", body: <p>The replies from CE2 cross P2 → P1. Their PLR is P2, with its own backup (out to P4 — P4&apos;s path to PE1 is already safe). Protection is per router and per direction.</p> },
  { id: "incident", chapter: "When it breaks", title: "A repair that doesn't force.", body: <p>The guided lesson&apos;s incident: a repair to P2&apos;s End instead of P4&apos;s End.X. P3 routes P2&apos;s locator with its stale table — back to P1. Loop.</p> },
  { id: "compare", chapter: "Where it fits", title: "LFA vs TI-LFA vs convergence.", body: <p>Three ways to survive a failure.</p> },
  { id: "breaks", chapter: "When it breaks", title: "Five ways protection fails.", body: <p>No TI-LFA; a repair node without SRv6; link protection when the router dies; no BFD on a silent link; no protection in the other direction.</p> },
  { id: "verify", chapter: "Verify", title: "The questions engineers ask.", body: <p>Does the PLR have a backup? Which SIDs? Is BFD up? And — the only real proof — what does a drill cost?</p> },
  { id: "recap", chapter: "The whole idea", title: "Precompute, force, release.", body: <p>Now follow it in the lesson, then drill it in the SRv6 TI-LFA Lab.</p> },
];
const VISUAL: Record<Id, string> = Object.fromEntries(STEPS.map((s) => [s.id, ["compare", "breaks", "verify", "recap"].includes(s.id) ? s.id : "topo"])) as Record<Id, string>;

const NODES: TopoNode[] = [
  { id: "PE1", label: "PE1", sub: "headend", icon: "PE", x: 6, y: 52 },
  { id: "P1", label: "P1", sub: "PLR", icon: "P", x: 27, y: 52 },
  { id: "P2", label: "P2", sub: "", icon: "P", x: 60, y: 18 },
  { id: "PE2", label: "PE2", sub: "egress", icon: "PE", x: 92, y: 40 },
  { id: "P3", label: "P3", sub: "", icon: "P", x: 42, y: 86 },
  { id: "P4", label: "P4", sub: "repair node", icon: "P", x: 68, y: 86 },
];
const LINKS: [string, string, string][] = [["PE1", "P1", "10"], ["P1", "P2", "10 · DWDM"], ["P2", "PE2", "10"], ["P1", "P3", "10"], ["P3", "P4", "10"], ["P4", "P2", "50"], ["P4", "PE2", "70"]];
const PRIM = new Set(["PE1-P1", "P1-P2", "P2-PE2"]);
const LINKREP = new Set(["PE1-P1", "P1-P3", "P3-P4", "P4-P2", "P2-PE2"]);
const NODEREP = new Set(["PE1-P1", "P1-P3", "P3-P4", "P4-PE2"]);

function Deck({ step: s, play, replay }: { step: Step; play: number; replay: () => void }) {
  const FIT = useFitNodes(NODES, 340);
  const id = s.id;
  const k = `${id}-${play}`;
  const head = <StageHead chapter={s.chapter} title={s.title} />;
  const go = (f: string, t: string, o: { label: string; key: string; delay?: number; color?: string }) => (
    <Mover key={`${k}-${o.key}`} from={nodeAt(FIT.nodes, f)} to={nodeAt(FIT.nodes, t)} delay={o.delay} duration={800}>
      <Token color={o.color ?? "cyan"}>{o.label}</Token>
    </Mover>
  );

  if (VISUAL[id] === "topo") {
    const failLink = !["problem", "path", "converge", "plr", "node", "nodewalk"].includes(id) || id === "converge";
    const failNode = id === "node" || id === "nodewalk";
    const hot = ["path", "problem"].includes(id) ? PRIM : ["post", "repair", "usd", "walk", "after"].includes(id) ? LINKREP : failNode ? NODEREP : new Set<string>();
    const links: TopoLink[] = LINKS.map(([a, b, label]) => {
      const key = `${a}-${b}`;
      const down = (failLink && key === "P1-P2") || (failNode && (a === "P2" || b === "P2"));
      return { a, b, state: (down ? "down" : hot.has(key) ? "active" : hot.size ? "dim" : "up") as TopoLink["state"], label };
    });
    const views: Record<string, TopoView> = {};
    let movers: ReactNode = null;
    if (id === "problem") views.PE2 = { bubble: { text: "CUST-A site 2", tone: "info" } };
    if (id === "converge") views.P3 = { bubble: { text: "recomputing…", tone: "warn" } };
    if (id === "plr") views.P1 = { ring: "hit", bubble: { text: "I know first", tone: "info" } };
    if (id === "naive") movers = <>{go("P1", "P3", { label: "to PE2", key: "1", color: "green" })}</>;
    if (id === "stale") {
      movers = <>{go("P3", "P1", { label: "back!", key: "1", color: "amber" })}</>;
      views.P3 = { ring: "bad", bubble: { text: "PE2 via P1 (old)", tone: "bad" } };
    }
    if (id === "post") views.P1 = { bubble: { text: "after: via P3, P4, P2", tone: "info" } };
    if (id === "pspace") {
      views.P3 = { ring: "hit" };
      views.P4 = { ring: "hit", bubble: { text: "P-space", tone: "yes" } };
    }
    if (id === "qspace") {
      views.P2 = { ring: "hit", bubble: { text: "Q-space", tone: "yes" } };
      views.P4 = { bubble: { text: "not Q: path via P1", tone: "warn" } };
    }
    if (id === "repair") movers = <>{go("P1", "P3", { label: "DA …:14:41::", key: "1", color: "amber" })}{go("P3", "P4", { label: "DA …:14:41::", key: "2", delay: 800, color: "amber" })}</>;
    if (id === "usd") views.P4 = { ring: "hit", bubble: { text: "USD: strip, out to P2", tone: "yes" } };
    if (id === "walk") movers = <>{go("P4", "P2", { label: "DA PE2 DT4", key: "1", color: "violet" })}{go("P2", "PE2", { label: "DA PE2 DT4", key: "2", delay: 800, color: "violet" })}</>;
    if (id === "after") views.P1 = { bubble: { text: "repair released", tone: "info" } };
    if (id === "node") views.P2 = { ring: "bad", bubble: { text: "router down", tone: "bad" } };
    if (id === "nodewalk") movers = <>{go("P1", "P3", { label: "DA …:14:42::", key: "1", color: "amber" })}{go("P3", "P4", { label: "DA …:14:42::", key: "2", delay: 800, color: "amber" })}{go("P4", "PE2", { label: "DA PE2 DT4", key: "3", delay: 1600, color: "violet" })}</>;
    if (id === "detect") views.P1 = { bubble: { text: "interface still up", tone: "warn" } };
    if (id === "bfd") views.P1 = { bubble: { text: "BFD: 150 ms", tone: "yes" } };
    if (id === "reverse") views.P2 = { ring: "hit", bubble: { text: "PLR for the replies", tone: "info" } };
    if (id === "incident") {
      views.P3 = { ring: "bad", bubble: { text: "P2's locator via P1", tone: "bad" } };
      movers = <>{go("P1", "P3", { label: "DA P2 End", key: "1", color: "amber" })}{go("P3", "P1", { label: "back", key: "2", delay: 900, color: "amber" })}</>;
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
          <Compare items={[{ title: "Convergence", tone: "amber", body: "every router recomputes · hundreds of ms of loss · always the final state" }, { title: "Classic LFA", tone: "violet", body: "a neighbor whose own path is safe · no extra header · not always available (not here)" }, { title: "TI-LFA", tone: "cyan", body: "the post-convergence path in SIDs · always available if a path exists · local, ~15 ms after detection" }]} />
        </>
      );
    case "breaks":
      return (
        <>
          {head}
          <MiniTable title="How protection fails" cols={["Fault", "What a drill shows"]} rows={[{ cells: ["No TI-LFA on the PLR", "no backup, convergence"], state: "hit" }, { cells: ["Repair node without SRv6", "TI-LFA on, no backup"] }, { cells: ["Link-only protection", "fine for a cut, not a router failure"] }, { cells: ["No BFD on a silent link", "30 s before the switch"] }, { cells: ["Other direction unprotected", "one flow fast, one slow"] }]} />
        </>
      );
    case "verify":
      return (
        <>
          {head}
          <MiniTable title="IOS XR" cols={["Question", "Command"]} rows={[{ cells: ["Backup and repair SIDs?", "show isis fast-reroute <prefix> detail"] }, { cells: ["What is installed?", "show cef ipv6 <prefix>"] }, { cells: ["FRR on the interface?", "show isis interface <if>"] }, { cells: ["BFD up?", "show bfd session"] }]} />
        </>
      );
    case "recap":
      return (
        <>
          {head}
          <Chain k="recap" items={[{ t: "The PLR repairs locally, before convergence" }, { t: "Stale tables elsewhere: the repair must force its path", tone: "amber" }, { t: "TI-LFA = the post-convergence path as OIF + SIDs", tone: "cyan" }, { t: "End.X with USD strips the repair and forces the link", tone: "violet" }, { t: "Node protection, BFD, both directions", tone: "green" }]} />
        </>
      );
  }
  return head;
}

export function T6Presentation({ open, onClose, onFinish, finishLabel }: { open: boolean; onClose: () => void; onFinish: () => void; finishLabel: string }) {
  const [play, setPlay] = useState(0);
  return (
    <LessonPresentation
      open={open}
      onClose={onClose}
      title="SRv6 TI-LFA, from zero"
      kicker="Learn · the SRv6 TI-LFA presentation"
      steps={STEPS}
      visual={(s) => VISUAL[s.id as Id]}
      renderStage={(s) => <Deck step={s as Step} play={play} replay={() => setPlay((p) => p + 1)} />}
      finish={{ label: finishLabel, onClick: onFinish }}
      skip={{ label: "Skip →", onClick: onFinish }}
    />
  );
}
