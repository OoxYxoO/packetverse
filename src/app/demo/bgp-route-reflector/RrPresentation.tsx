"use client";

import { useState, type ReactNode } from "react";
import { LessonPresentation } from "@/components/presentation/LessonPresentation";
import { Mover, StageHead, type DeckStep } from "@/components/presentation/ScrollyDeck";
import { Chain, Compare, MiniTable, ReplayButton, Token, Topo, nodeAt, short, type TopoLink, type TopoNode, type TopoView } from "@/components/presentation/Visuals";

/**
 * BGP ROUTE REFLECTION — the presentation before the lesson and the Route Reflector Lab. Builds on BGP (the PEs' customer
 * routes, best path) and the MPLS core (PE loopbacks reachable, labels to the next hop). Same AS, routers, loopbacks and
 * cluster IDs as the lab and the guided lesson. Presentation state only.
 */

type Id = "edge" | "ibgp" | "split" | "mesh" | "grow" | "rr" | "client" | "attrs" | "rule1" | "rule2" | "rule3" | "loop" | "cluster" | "nh" | "best" | "redundancy" | "breaks" | "verify" | "trouble" | "recap";
type Step = DeckStep & { id: Id };
const B = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;

const STEPS: Step[] = [
  { id: "edge", chapter: "The problem", title: "Every PE must learn every customer prefix.", body: <p>PE1 learns 10.1.1.0/24 from its customer by eBGP. PE2, PE3 and PE4 must all learn it too — with next hop <B>1.1.1.1</B> (PE1&apos;s loopback), so the MPLS core can carry the traffic there.</p> },
  { id: "ibgp", chapter: "The problem", title: "Inside the AS, that's iBGP.", body: <p>The PEs share their customer routes over <B>iBGP</B> sessions between loopbacks, all in AS 65000. iBGP has no AS path to detect loops inside the AS — so it needs another rule.</p> },
  { id: "split", chapter: "The problem", title: "iBGP split horizon: never pass it on.", body: <p>A router that learned a route from an iBGP peer <B>never advertises it to another iBGP peer</B>. PE2 hears 10.1.1.0/24 from PE1 but won&apos;t tell PE3. Loops become impossible — and every PE must hear every route first-hand.</p> },
  { id: "mesh", chapter: "The problem", title: "So every PE peers with every PE.", body: <p>Four PEs need six sessions: the <B>full mesh</B>. Every route is learned directly from the PE that originated it.</p> },
  { id: "grow", chapter: "The problem", title: "The mesh grows with the square.", body: <p>n PEs need n(n−1)/2 sessions: 10 PEs → 45, 50 PEs → 1225. Adding one PE means touching every existing PE. Real provider networks have hundreds.</p> },
  { id: "rr", chapter: "Route reflection", title: "A route reflector may pass routes on.", body: <p>A <B>route reflector</B> (RR) is an ordinary BGP router with one permission: it may re-advertise iBGP routes for its <B>clients</B>. Each PE now peers with its reflector only.</p> },
  { id: "client", chapter: "Route reflection", title: "Clients and clusters.", body: <p><B>RR1</B> serves PE1 and PE2 (cluster 100.100.100.100), <B>RR2</B> serves PE3 and PE4 (cluster 200.200.200.200). The two reflectors peer with each other as ordinary iBGP neighbors — <B>non-clients</B> of each other.</p> },
  { id: "attrs", chapter: "Route reflection", title: "Reflecting adds two marks.", body: <p>When RR1 reflects PE1&apos;s route it adds <B>ORIGINATOR_ID</B> 1.1.1.1 (who injected it) and starts a <B>CLUSTER_LIST</B> with 100.100.100.100. The next hop stays 1.1.1.1: the reflector never puts itself in the traffic path.</p> },
  { id: "rule1", chapter: "Who hears what", title: "From a client: to everyone.", body: <p>RR1 learned 10.1.1.0/24 from a client (PE1), so it reflects it to its other client (PE2) <B>and</B> to its non-client peer (RR2) — never back to PE1.</p> },
  { id: "rule2", chapter: "Who hears what", title: "From a non-client: to clients only.", body: <p>RR2 learned it from RR1 — a non-client. Non-client routes go to <B>clients only</B>: PE3 and PE4. That rule keeps two reflectors from bouncing routes between each other forever.</p> },
  { id: "rule3", chapter: "Who hears what", title: "Misclassify a client, lose its routes.", body: <p>If RR2 treats PE3 as a non-client, PE3 still has an Established session — but RR2 never sends it routes learned from RR1. The session looks perfect; half the network is missing.</p> },
  { id: "loop", chapter: "Loop prevention", title: "Coming back home? Dropped.", body: <p>A router that receives a route carrying <B>its own router ID as ORIGINATOR_ID</B> drops it. A reflector that sees <B>its own cluster ID</B> in the CLUSTER_LIST drops it too. Reflected routes can&apos;t loop.</p> },
  { id: "cluster", chapter: "Loop prevention", title: "Same cluster ID by mistake? Routes vanish.", body: <p>Give RR2 the cluster ID of RR1 and every route RR1 reflects looks like a loop to RR2 — dropped. Every session stays up; the clusters stop exchanging routes.</p> },
  { id: "nh", chapter: "Next hops", title: "The next hop must be reachable.", body: <p>PEs advertise customer routes with <B>next-hop-self</B> — their loopback. Without it, PE2 would advertise CE2&apos;s address, which nobody else can reach. RR1 can&apos;t use that path, so it never reflects it.</p> },
  { id: "best", chapter: "Next hops", title: "A reflector sends only its best path.", body: <p>CE1 and CE4 both announce 10.9.9.0/24. RR1 picks the path via PE1 (closer to RR1) and reflects only that — PE2 never sees the PE4 exit. Clients inherit their reflector&apos;s point of view.</p> },
  { id: "redundancy", chapter: "Design", title: "One reflector is a single point of failure.", body: <p>If RR1 fails, PE1 and PE2 lose every route learned through it. Real designs give each client <B>two reflectors</B> — often in the same cluster — so losing one changes nothing.</p> },
  { id: "breaks", chapter: "When it breaks", title: "Most reflection faults keep sessions up.", body: <p>A wrong client role, a duplicated cluster ID, a missing next-hop-self, an outbound policy — none of them drops a session. That&apos;s why &quot;all sessions Established&quot; proves very little.</p> },
  { id: "verify", chapter: "Verify", title: "The questions engineers ask.", body: <p>Is every session up? Which PE is missing which prefix? Does the path exist but unusable? Was it dropped as a loop? Did the reflector even send it?</p> },
  { id: "trouble", chapter: "Troubleshooting", title: "Follow one prefix from originator to receiver.", body: <p>Start at the PE that should have the route and walk back toward its originator, one session at a time.</p> },
  { id: "recap", chapter: "The whole idea", title: "Reflectors relax one rule — and mark what they do.", body: <p>Now watch it in the lesson, then break and fix it in the Route Reflector Lab.</p> },
];

const VISUAL: Record<Id, string> = Object.fromEntries(STEPS.map((s) => [s.id, ["grow", "verify", "trouble", "recap", "breaks"].includes(s.id) ? s.id : ["edge", "ibgp", "split", "mesh"].includes(s.id) ? "mesh" : "rr"])) as Record<Id, string>;

const MESH: TopoNode[] = [
  { id: "PE1", label: "PE1", sub: "1.1.1.1", icon: "PE", x: 18, y: 22 },
  { id: "PE2", label: "PE2", sub: "4.4.4.4", icon: "PE", x: 82, y: 22 },
  { id: "PE3", label: "PE3", sub: "5.5.5.5", icon: "PE", x: 18, y: 80 },
  { id: "PE4", label: "PE4", sub: "6.6.6.6", icon: "PE", x: 82, y: 80 },
];
const RRN: TopoNode[] = [
  { id: "RR1", label: "RR1", sub: "9.9.9.9", icon: "RR", x: 30, y: 16 },
  { id: "RR2", label: "RR2", sub: "10.10.10.10", icon: "RR", x: 70, y: 16 },
  { id: "PE1", label: "PE1", sub: "1.1.1.1", icon: "PE", x: 10, y: 70 },
  { id: "PE2", label: "PE2", sub: "4.4.4.4", icon: "PE", x: 38, y: 70 },
  { id: "PE3", label: "PE3", sub: "5.5.5.5", icon: "PE", x: 62, y: 70 },
  { id: "PE4", label: "PE4", sub: "6.6.6.6", icon: "PE", x: 90, y: 70 },
];

function Deck({ step: s, play, replay }: { step: Step; play: number; replay: () => void }) {
  const id = s.id;
  const k = `${id}-${play}`;
  const head = <StageHead chapter={s.chapter} title={s.title} />;
  const mk = (nodes: TopoNode[]) =>
    function move(f: string, t: string, o: { label: string; key: string; delay?: number; stay?: boolean; color?: string; dy?: number }) {
    const a = nodeAt(nodes, f);
    const b = nodeAt(nodes, t);
    const from: [number, number] = [a[0], a[1] + (o.dy ?? 0)];
    const to: [number, number] = [b[0], b[1] + (o.dy ?? 0)];
    return (
      <Mover key={`${k}-${o.key}`} from={from} to={o.stay ? short(from, to) : to} delay={o.delay} duration={800} stay={o.stay}>
        <Token color={o.color ?? "cyan"}>{o.label}</Token>
      </Mover>
    );
  };

  if (VISUAL[id] === "mesh") {
    const go = mk(MESH);
    const all: [string, string][] = [["PE1", "PE2"], ["PE1", "PE3"], ["PE1", "PE4"], ["PE2", "PE3"], ["PE2", "PE4"], ["PE3", "PE4"]];
    const shown = id === "edge" ? [] : id === "ibgp" ? [["PE1", "PE2"], ["PE2", "PE3"]] : id === "split" ? [["PE1", "PE2"], ["PE2", "PE3"]] : all;
    const links: TopoLink[] = shown.map(([a, b]) => ({ a, b, state: "up" as const, label: id === "mesh" && !((a === "PE1" && b === "PE4") || (a === "PE2" && b === "PE3")) ? "iBGP" : "" }));
    const views: Record<string, TopoView> = {};
    let movers: ReactNode = null;
    if (id === "edge") {
      views.PE1 = { ring: "on", bubble: { text: "10.1.1.0/24 from CE1 (eBGP)", tone: "info" } };
      for (const p of ["PE2", "PE3", "PE4"]) views[p] = { badge: { text: "needs it", tone: "ask" } };
    }
    if (id === "ibgp") movers = go("PE1", "PE2", { label: "UPDATE 10.1.1.0/24 · NH 1.1.1.1", key: "1" });
    if (id === "split") {
      movers = (
        <>
          {go("PE1", "PE2", { label: "10.1.1.0/24", key: "1" })}
          {go("PE2", "PE3", { label: "✕ not re-advertised", key: "2", delay: 900, color: "red", stay: true })}
        </>
      );
      views.PE3 = { ring: "bad", bubble: { text: "never hears it", tone: "bad", delay: 1600 } };
    }
    if (id === "mesh") {
      movers = (
        <>
          {go("PE1", "PE2", { label: "10.1.1.0/24", key: "1" })}
          {go("PE1", "PE3", { label: "10.1.1.0/24", key: "2" })}
          {go("PE1", "PE4", { label: "10.1.1.0/24", key: "3" })}
        </>
      );
      views.PE1 = { badge: { text: "3 sessions", tone: "warn" } };
    }
    return (
      <>
        {head}
        <Topo nodes={MESH} links={links} views={views} ratio={50} minH={240}>
          {movers}
        </Topo>
        {movers && <ReplayButton onClick={replay} />}
      </>
    );
  }

  if (VISUAL[id] === "rr") {
    const go = mk(RRN);
    const nonClientPe3 = id === "rule3";
    const links: TopoLink[] = [
      { a: "RR1", b: "PE1", label: "client", state: "up" },
      { a: "RR1", b: "PE2", label: "client", state: "up" },
      { a: "RR1", b: "RR2", label: id === "cluster" ? "" : "non-client", state: id === "cluster" ? "blocked" : "up" },
      { a: "RR2", b: "PE3", label: nonClientPe3 ? "non-client (!)" : "client", state: nonClientPe3 ? "blocked" : "up" },
      { a: "RR2", b: "PE4", label: "client", state: "up" },
      ...(id === "redundancy" ? [{ a: "RR2", b: "PE1", label: "client", state: "standby" as const }, { a: "RR2", b: "PE2", label: "client", state: "standby" as const }] : []),
    ];
    const views: Record<string, TopoView> = {};
    let movers: ReactNode = null;
    if (id === "rr") views.RR1 = { ring: "on", bubble: { text: "may reflect for its clients", tone: "yes" } };
    if (id === "client") {
      views.RR1 = { bubble: { text: "cluster 100.100.100.100", tone: "info" } };
      views.RR2 = { bubble: { text: "cluster 200.200.200.200", tone: "info" } };
    }
    if (id === "attrs") {
      movers = (
        <>
          {go("PE1", "RR1", { label: "10.1.1.0/24 · NH 1.1.1.1", key: "1" })}
          {go("RR1", "PE2", { label: "+ OID 1.1.1.1 · CL 100.100.100.100", key: "2", delay: 900, color: "violet", stay: true })}
        </>
      );
    }
    if (id === "rule1") {
      movers = (
        <>
          {go("PE1", "RR1", { label: "from a client", key: "1" })}
          {go("RR1", "PE2", { label: "reflect", key: "2", delay: 900, color: "violet" })}
          {go("RR1", "RR2", { label: "reflect", key: "3", delay: 900, color: "violet" })}
        </>
      );
    }
    if (id === "rule2") {
      movers = (
        <>
          {go("RR1", "RR2", { label: "from a non-client", key: "1", color: "violet" })}
          {go("RR2", "PE3", { label: "to clients", key: "2", delay: 900, color: "violet" })}
          {go("RR2", "PE4", { label: "to clients", key: "3", delay: 900, color: "violet" })}
        </>
      );
      views.RR1 = { bubble: { text: "not sent back to RR1", tone: "no", delay: 1700 } };
    }
    if (id === "rule3") {
      movers = (
        <>
          {go("RR1", "RR2", { label: "10.1.1.0/24", key: "1", color: "violet" })}
          {go("RR2", "PE4", { label: "to client PE4", key: "2", delay: 900, color: "violet" })}
          {go("RR2", "PE3", { label: "✕ PE3 is a non-client", key: "3", delay: 900, color: "red", stay: true })}
        </>
      );
      views.PE3 = { ring: "bad", bubble: { text: "session Up, route missing", tone: "bad", delay: 1600 } };
    }
    if (id === "loop") {
      movers = go("RR2", "RR1", { label: "CL 200.200.200.200, 100.100.100.100", key: "1", color: "red", stay: true });
      views.RR1 = { ring: "bad", bubble: { text: "my cluster ID → drop", tone: "bad", delay: 900 } };
    }
    if (id === "cluster") {
      movers = go("RR1", "RR2", { label: "CL 100.100.100.100", key: "1", color: "red", stay: true });
      views.RR2 = { ring: "bad", bubble: { text: "that's my cluster ID! drop", tone: "bad", delay: 900 } };
    }
    if (id === "nh") {
      movers = go("PE2", "RR1", { label: "10.2.2.0/24 · NH 172.16.2.2", key: "1", color: "red", stay: true });
      views.RR1 = { ring: "bad", bubble: { text: "can't reach 172.16.2.2 → not best → not reflected", tone: "bad", delay: 900 } };
    }
    if (id === "best") {
      views.PE1 = { badge: { text: "10.9.9.0/24", tone: "info" } };
      views.PE4 = { badge: { text: "10.9.9.0/24", tone: "info" } };
      views.RR1 = { bubble: { text: "best: via PE1 (closer to me)", tone: "yes" } };
      views.RR2 = { bubble: { text: "best: via PE4", tone: "yes", delay: 400 } };
      views.PE2 = { bubble: { text: "only sees the PE1 exit", tone: "info", delay: 800 } };
    }
    if (id === "redundancy") {
      views.RR1 = { ring: "bad", badge: { text: "fails", tone: "bad" } };
      views.PE1 = { bubble: { text: "RR2 still serves me", tone: "yes" } };
    }
    return (
      <>
        {head}
        <Topo nodes={RRN} links={links} views={views} ratio={50} minH={240}>
          {movers}
        </Topo>
        {movers && <ReplayButton onClick={replay} />}
      </>
    );
  }

  switch (id) {
    case "grow":
      return (
        <>
          {head}
          <MiniTable title="iBGP sessions" cols={["PEs", "Full mesh n(n−1)/2", "Two reflectors"]} rows={[{ cells: ["4", "6", "5"] }, { cells: ["10", "45", "11"] }, { cells: ["50", "1 225", "51"], state: "hit" }, { cells: ["100", "4 950", "101"] }]} />
          <Compare items={[{ title: "Full mesh", tone: "red", body: "adding a PE touches every PE" }, { title: "Reflectors", tone: "green", body: "adding a PE touches its reflectors only" }]} />
        </>
      );
    case "breaks":
      return (
        <>
          {head}
          <MiniTable title="Faults that keep every session Established" cols={["Fault", "What disappears"]} rows={[{ cells: ["PE configured as a non-client", "routes from other clusters at that PE"] }, { cells: ["Duplicated cluster ID", "everything one reflector reflects to the other"] }, { cells: ["No next-hop-self", "that PE's routes everywhere else"] }, { cells: ["Outbound policy", "the filtered prefixes beyond that reflector"] }]} />
        </>
      );
    case "verify":
      return (
        <>
          {head}
          <div className="grid gap-2 sm:grid-cols-2">
            <MiniTable title="IOS XR" cols={["Question", "Command"]} rows={[{ cells: ["Sessions", "show bgp summary"] }, { cells: ["All paths, attributes", "show bgp 10.1.1.0/24"] }, { cells: ["Client? policy?", "show bgp neighbors 5.5.5.5"] }, { cells: ["What I sent", "show bgp neighbors … advertised-routes"] }]} />
            <MiniTable title="Junos" cols={["Question", "Command"]} rows={[{ cells: ["Sessions", "show bgp summary"] }, { cells: ["All paths, attributes", "show route 10.1.1.10 detail"] }, { cells: ["Group, cluster", "show bgp neighbor 5.5.5.5"] }, { cells: ["What I sent", "show route advertising-protocol bgp …"] }]} />
          </div>
          <Compare items={[{ title: "IOS XR", tone: "cyan", body: "route-reflector-client per neighbor; bgp cluster-id per router" }, { title: "Junos", tone: "violet", body: "a BGP group with a cluster statement makes all its neighbors clients" }]} />
        </>
      );
    case "trouble":
      return (
        <>
          {head}
          <Chain k="ts" items={[{ t: "Which PE is missing which prefix?", tone: "plain" }, { t: "Is every session on the way Established?", tone: "cyan" }, { t: "Does the path exist but is unusable (next hop)?", tone: "amber" }, { t: "Did a router drop it as a loop (ORIGINATOR_ID / CLUSTER_LIST)?", tone: "violet" }, { t: "Did the reflector send it — client role, policy?", tone: "red" }, { t: "Fix one thing; prove it with the PE's table and a fresh ping", tone: "green" }]} />
        </>
      );
    case "recap":
      return (
        <>
          {head}
          <Chain k="recap" items={[{ t: "iBGP split horizon forces a full mesh: n(n−1)/2 sessions" }, { t: "A reflector re-advertises for its clients: client → all · non-client → clients only · never back", tone: "violet" }, { t: "ORIGINATOR_ID and CLUSTER_LIST stop reflected routes from looping", tone: "cyan" }, { t: "Next hops are never changed: next-hop-self on the PEs", tone: "amber" }, { t: "A reflector sends only its best path; give clients two reflectors", tone: "green" }, { t: "Sessions Established proves little: check roles, cluster IDs, next hops, policies", tone: "red" }]} />
        </>
      );
  }
  return head;
}

export function RrPresentation({ open, onClose, onFinish, finishLabel }: { open: boolean; onClose: () => void; onFinish: () => void; finishLabel: string }) {
  const [play, setPlay] = useState(0);
  return (
    <LessonPresentation
      open={open}
      onClose={onClose}
      title="BGP route reflection, from zero"
      kicker="Learn · the route reflector presentation"
      steps={STEPS}
      visual={(s) => VISUAL[s.id]}
      renderStage={(s) => <Deck step={s} play={play} replay={() => setPlay((p) => p + 1)} />}
      finish={{ label: finishLabel, onClick: onFinish }}
      skip={{ label: "Skip →", onClick: onFinish }}
    />
  );
}
