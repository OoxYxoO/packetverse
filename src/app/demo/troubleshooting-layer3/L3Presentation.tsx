"use client";

import { useState, type ReactNode } from "react";
import { LessonPresentation } from "@/components/presentation/LessonPresentation";
import { Mover, StageHead, type DeckStep } from "@/components/presentation/ScrollyDeck";
import { Chain, MiniTable, ReplayButton, Token, Topo, nodeAt, type TopoLink, type TopoNode, type TopoView } from "@/components/presentation/Visuals";
import { useFitNodes } from "@/components/presentation/fitNarrow";
import { L3 } from "@/lib/sim-engine/scenarios/troubleshootingLayer3";
import { createL3Net, hostRoutes, l3Apply, l3TicketState, lastTest, lpm, type L3Action, type L3State } from "@/lib/sim-engine/scenarios/l3tsNet";

/**
 * Layer 3 Troubleshooting — the presentation before the lesson and the lab. Routing decisions, ARP results, traceroute
 * hops and ping results on the slides are read from the lab model (l3tsNet.ts). Presentation state only.
 */

type Id = "problem" | "guess" | "net" | "decide" | "prefix" | "arp" | "frame" | "router" | "ttl" | "trace" | "incident" | "decision" | "arpfail" | "silent" | "serverok" | "cause" | "repair" | "proof" | "errors" | "others" | "workflow" | "recap";
type Step = DeckStep & { id: Id };
const B = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;
const M = ({ children }: { children: ReactNode }) => <span className="pv-mono text-pv-text">{children}</span>;
const run = (s: L3State, ...a: L3Action[]) => a.reduce((x, y) => l3Apply(x, y), s);
const pS: L3Action = { type: "ping", from: "CLIENT", dst: L3.server, count: 4 };
const pR: L3Action = { type: "ping", from: "CLIENT", dst: L3.remote, count: 4 };
const H = run(createL3Net(0), pS, { type: "trace", from: "CLIENT", dst: L3.server });
const TR = lastTest(H).hops ?? [];
const INC = run(l3TicketState("mask", 1), pS, pR);
const look = (s: L3State, dst: string) => {
  const r = lpm(hostRoutes(s.hosts.CLIENT), dst)!;
  return r.kind === "default" ? `via ${r.nh}` : `on-link (${r.prefix}/${r.len})`;
};
const FIX = run(INC, { type: "set", text: "fix", f: (s) => void (s.hosts.CLIENT = { addrs: [{ ip: L3.client, len: 24 }], gw: L3.gw }) }, pS, pR);

const STEPS: Step[] = [
  { id: "problem", chapter: "The question", title: "“REMOTE-SERVER is unreachable.”", body: <p>Since CLIENT was re-installed it can&apos;t reach REMOTE-SERVER (<M>{L3.remote}</M>). SERVER (<M>{L3.server}</M>), behind the same router, works perfectly. Nothing changed on the routers.</p> },
  { id: "guess", chapter: "The question", title: "“Must be the router.”", body: <p>Two servers behind the same router, one works: the router seems the obvious suspect. But a router only forwards what it receives — first find out whether the packet ever got there.</p> },
  { id: "net", chapter: "The network", title: "Two routers, three LANs.", body: <p>CLIENT <M>10.10.10.10/24</M> sits on a LAN with R1 (<M>10.10.10.1</M>). R1 reaches R2 over a /31 transit link; behind R2 are SERVER (10.20.20.0/24) and REMOTE-SERVER (10.10.20.0/24).</p> },
  { id: "decide", chapter: "The host decides", title: "Local or remote?", body: <p>Before sending, CLIENT looks at its <B>own</B> routing table: a connected route from its address and prefix, and a default route via the gateway. For 10.20.20.20 only the default matches: <M>{look(H, L3.server)}</M>.</p> },
  { id: "prefix", chapter: "The host decides", title: "The prefix draws the line.", body: <p>/24 means “the first 24 bits are the network”: 10.10.10.0–10.10.10.255 is on-link, everything else goes to the gateway. The longest matching prefix always wins.</p> },
  { id: "arp", chapter: "ARP", title: "Who has 10.10.10.1?", body: <p>To send to the gateway CLIENT needs its MAC: an ARP broadcast on the LAN. Only R1 owns 10.10.10.1, so only R1 answers.</p> },
  { id: "frame", chapter: "ARP", title: "Two destinations, two layers.", body: <p>The echo request leaves CLIENT addressed to <B>R1&apos;s MAC</B> but <B>SERVER&apos;s IP</B>. Layer 2 reaches the next hop; Layer 3 keeps the final destination.</p> },
  { id: "router", chapter: "Routers", title: "Look up, decrement, resolve.", body: <p>R1 finds 10.20.20.0/24 via 192.0.2.1 (longest prefix), decrements TTL 64 → 63, ARPs for R2 on the transit link and sends it on. R2 has SERVER&apos;s network directly connected.</p> },
  { id: "ttl", chapter: "Routers", title: "TTL counts routers.", body: <p>Every router subtracts one; at zero the packet is dropped and the router sends <B>time exceeded</B> back. Switches never touch TTL.</p> },
  { id: "trace", chapter: "Routers", title: "traceroute maps the path.", body: <p>Probes with TTL 1, 2, 3… make each router reveal itself: {TR.map((h, i) => `${i + 1} ${h ?? "*"}`).join(" · ")}.</p> },
  { id: "incident", chapter: "The incident", title: "One works, one doesn't.", body: <p>Today: SERVER {INC.tests[0].recv}/4, REMOTE-SERVER {INC.tests[1].recv}/4 — “{INC.tests[1].error}”, reported by CLIENT itself, not by a router.</p> },
  { id: "decision", chapter: "The incident", title: "CLIENT is /16.", body: <p>CLIENT was re-installed as <M>10.10.10.10/16</M>. Now 10.10.20.20 matches its connected route 10.10.0.0/16: <M>{look(INC, L3.remote)}</M>. 10.20.20.20 still: <M>{look(INC, L3.server)}</M>.</p> },
  { id: "arpfail", chapter: "The incident", title: "ARP for a host that isn't there.", body: <p>CLIENT ARPs for 10.10.20.20 <B>on its own LAN</B>. Nobody there owns it; after three tries CLIENT gives up — no IPv4 packet is ever sent.</p> },
  { id: "silent", chapter: "The incident", title: "R1 stays silent — correctly.", body: <p>R1 hears the request but 10.10.20.20 isn&apos;t its address, so it doesn&apos;t answer (no proxy ARP). Its counters record a request “not for me”. The router is innocent.</p> },
  { id: "serverok", chapter: "The incident", title: "Why SERVER still works.", body: <p>10.20.20.20 is outside 10.10.0.0/16, so CLIENT still uses the default route and the gateway. The fault only bites destinations inside the too-short prefix.</p> },
  { id: "cause", chapter: "The incident", title: "One wrong number.", body: <p>The prefix length — /16 instead of /24 — moved the line between on-link and off-link. Everything else is fine.</p> },
  { id: "repair", chapter: "Proof", title: "Fix the prefix.", body: <p>Replace 10.10.10.10/16 with 10.10.10.10/24 — and re-add the default route: deleting the address removed the network the gateway lived on, and the kernel flushed the route with it.</p> },
  { id: "proof", chapter: "Proof", title: "Prove it with fresh pings.", body: <p>SERVER {FIX.tests[FIX.tests.length - 2].recv}/4, REMOTE-SERVER {lastTest(FIX).recv}/4 — and CLIENT now ARPs only for its gateway.</p> },
  { id: "errors", chapter: "Signatures", title: "Who tells you what?", body: <p>The error message is evidence: who sent it, and how fast. Silence is evidence too.</p> },
  { id: "others", chapter: "Signatures", title: "Other ways Layer 3 breaks.", body: <p>A wrong default gateway, a router without a route, a missing route back, a loop between routers. Each has its own fingerprint in ping and traceroute.</p> },
  { id: "workflow", chapter: "Signatures", title: "The workflow.", body: <p>What does the host decide? Did ARP succeed? Does each router have a route onward — and back? Which device sent the error? Then fix one thing and ping fresh.</p> },
  { id: "recap", chapter: "The whole idea", title: "Follow the decisions.", body: <p>Now follow it in the lesson, then break and repair addressing and routing yourself in the Layer 3 Lab.</p> },
];
const VISUAL: Record<Id, string> = Object.fromEntries(STEPS.map((s) => [s.id, ["prefix", "errors", "others", "workflow", "recap"].includes(s.id) ? s.id : "topo"])) as Record<Id, string>;

const NODES: TopoNode[] = [
  { id: "CLIENT", label: "CLIENT", sub: L3.client, icon: "host", x: 8, y: 72 },
  { id: "R1", label: "R1", sub: L3.gw, icon: "R", x: 36, y: 40 },
  { id: "R2", label: "R2", sub: "192.0.2.1", icon: "R", x: 62, y: 40 },
  { id: "SERVER", label: "SERVER", sub: L3.server, icon: "srv", x: 90, y: 16 },
  { id: "REMOTE", label: "REMOTE", sub: L3.remote, icon: "srv", x: 90, y: 74 },
];
const LINKS: [string, string][] = [["CLIENT", "R1"], ["R1", "R2"], ["R2", "SERVER"], ["R2", "REMOTE"]];

function Deck({ step: s, play, replay }: { step: Step; play: number; replay: () => void }) {
  const FIT = useFitNodes(NODES, 270);
  const id = s.id;
  const k = `${id}-${play}`;
  const head = <StageHead chapter={s.chapter} title={s.title} />;
  const go = (f: string, t: string, o: { label: string; key: string; delay?: number; color?: string }) => (
    <Mover key={`${k}-${o.key}`} from={nodeAt(FIT.nodes, f)} to={nodeAt(FIT.nodes, t)} delay={o.delay} duration={700}>
      <Token color={o.color ?? "cyan"}>{o.label}</Token>
    </Mover>
  );
  if (VISUAL[id] === "topo") {
    const links: TopoLink[] = LINKS.map(([a, b]) => ({ a, b, state: id === "proof" || (["router", "trace", "serverok"].includes(id) && b !== "REMOTE") ? "active" : "up", label: "" }));
    const views: Record<string, TopoView> = {};
    let movers: ReactNode = null;
    if (id === "problem") views.CLIENT = { bubble: { text: "REMOTE unreachable", tone: "warn" } };
    if (id === "guess") views.R2 = { bubble: { text: "the router?", tone: "ask" } };
    if (id === "net") views.R1 = { bubble: { text: "gateway 10.10.10.1", tone: "info" } };
    if (id === "decide") views.CLIENT = { ring: "on", bubble: { text: `10.20.20.20 ${look(H, L3.server)}`, tone: "info" } };
    if (id === "arp") movers = <>{go("CLIENT", "R1", { label: "who has .1?", key: "1", color: "amber" })}{go("R1", "CLIENT", { label: "I do", key: "2", delay: 800, color: "violet" })}</>;
    if (id === "frame") views.CLIENT = { bubble: { text: "MAC → R1 · IP → SERVER", tone: "info" } };
    if (id === "router") movers = <>{go("CLIENT", "R1", { label: "TTL 64", key: "1" })}{go("R1", "R2", { label: "TTL 63", key: "2", delay: 700 })}{go("R2", "SERVER", { label: "TTL 62", key: "3", delay: 1400 })}</>;
    if (id === "ttl") views.R2 = { bubble: { text: "TTL − 1", tone: "info" } };
    if (id === "trace") {
      views.R1 = { bubble: { text: `hop 1 ${TR[0] ?? "*"}`, tone: "info" } };
      views.R2 = { bubble: { text: `hop 2 ${TR[1] ?? "*"}`, tone: "info" } };
    }
    if (id === "incident") {
      views.SERVER = { ring: "hit", bubble: { text: "4/4", tone: "yes" } };
      views.REMOTE = { ring: "bad", bubble: { text: "unreachable", tone: "bad" } };
    }
    if (id === "decision") views.CLIENT = { ring: "bad", bubble: { text: "10.10.20.20 on-link?!", tone: "bad" } };
    if (id === "arpfail") movers = go("CLIENT", "R1", { label: "who has 10.10.20.20?", key: "1", color: "amber" });
    if (id === "silent") views.R1 = { ring: "hit", bubble: { text: "not for me", tone: "info" } };
    if (id === "serverok") movers = <>{go("CLIENT", "R1", { label: "to SERVER", key: "1" })}{go("R1", "R2", { label: "to SERVER", key: "2", delay: 700 })}{go("R2", "SERVER", { label: "to SERVER", key: "3", delay: 1400 })}</>;
    if (id === "cause") views.CLIENT = { ring: "bad", bubble: { text: "/16 → /24", tone: "warn" } };
    if (id === "repair") views.CLIENT = { ring: "hit", bubble: { text: "10.10.10.10/24 + default", tone: "yes" } };
    if (id === "proof") views.REMOTE = { ring: "hit", bubble: { text: `${lastTest(FIX).recv}/4`, tone: "yes" } };
    return (
      <>
        {head}
        <Topo nodes={FIT.nodes} links={links} views={views} ratio={50} minH={FIT.minH}>
          {movers}
        </Topo>
        {movers && <ReplayButton onClick={replay} />}
      </>
    );
  }
  switch (id) {
    case "prefix":
      return (
        <>
          {head}
          <MiniTable title="CLIENT's table, /24 vs /16" cols={["destination", "with /24", "with /16"]} rows={[{ cells: [L3.gw, "on-link", "on-link"] }, { cells: [L3.server, "via 10.10.10.1", "via 10.10.10.1"] }, { cells: [L3.remote, "via 10.10.10.1", "on-link ✗"], state: "bad" }]} />
        </>
      );
    case "errors":
      return (
        <>
          {head}
          <MiniTable title="What the sender sees" cols={["message", "sent by", "means"]} rows={[{ cells: ["Destination Host Unreachable", "the sender itself", "ARP for the next hop failed"], state: "hit" }, { cells: ["Destination Net Unreachable", "a router", "no route there"] }, { cells: ["Time to live exceeded", "a router", "a loop (or too far)"] }, { cells: ["silence", "nobody", "the reply can't get back"], state: "bad" }]} />
        </>
      );
    case "others":
      return (
        <>
          {head}
          <MiniTable title="Fingerprints" cols={["fault", "ping / traceroute"]} rows={[{ cells: ["wrong prefix length", "one destination: Host Unreachable from CLIENT"], state: "hit" }, { cells: ["wrong default gateway", "everything off-LAN: Host Unreachable from CLIENT"] }, { cells: ["router without a route", "Net Unreachable from the router; !N"] }, { cells: ["no route back", "silence; traceroute stops after hop 1"] }, { cells: ["routing loop", "TTL exceeded; R1, R2, R1, R2…"], state: "bad" }]} />
        </>
      );
    case "workflow":
      return (
        <>
          {head}
          <Chain k="wf" items={[{ t: "What does the host decide? (ip route get)" }, { t: "Did ARP for the next hop succeed?", tone: "cyan" }, { t: "Route onward on every router?", tone: "violet" }, { t: "Route back?", tone: "amber" }, { t: "Who sent the error?", tone: "amber" }, { t: "One fix, fresh pings", tone: "green" }]} />
        </>
      );
    case "recap":
      return (
        <>
          {head}
          <Chain k="recap" items={[{ t: "The host decides with its own table" }, { t: "Longest prefix wins", tone: "cyan" }, { t: "ARP resolves the next hop, not the destination", tone: "violet" }, { t: "Routers report what they can't forward", tone: "amber" }, { t: "The way back needs a route too", tone: "green" }]} />
        </>
      );
  }
  return head;
}

export function L3Presentation({ open, onClose, onFinish, finishLabel }: { open: boolean; onClose: () => void; onFinish: () => void; finishLabel: string }) {
  const [play, setPlay] = useState(0);
  return (
    <LessonPresentation
      open={open}
      onClose={onClose}
      title="Addressing and forwarding, from zero"
      kicker="Learn · the Layer 3 presentation"
      steps={STEPS}
      visual={(s) => VISUAL[s.id as Id]}
      renderStage={(s) => <Deck step={s as Step} play={play} replay={() => setPlay((p) => p + 1)} />}
      finish={{ label: finishLabel, onClick: onFinish }}
      skip={{ label: "Skip →", onClick: onFinish }}
    />
  );
}
