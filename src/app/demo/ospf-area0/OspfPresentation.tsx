"use client";

import { useState, type ReactNode } from "react";
import { LessonPresentation } from "@/components/presentation/LessonPresentation";
import { Mover, StageHead, type DeckStep } from "@/components/presentation/ScrollyDeck";
import { Chain, Compare, MiniTable, PacketCard, ReplayButton, Token, Topo, nodeAt, short, type TopoLink, type TopoNode, type TopoView } from "@/components/presentation/Visuals";

/**
 * OSPF — the presentation before the lesson/lab. Builds on Routing (routing tables, static routes, next hops) and on STP
 * (an election, a tree, failover): the Area 0 diamond R1–R4 (costs R1–R2 10, R2–R4 10, R1–R3 20, R3–R4 5) with a LAN
 * behind every router. Neighbors, LSAs and flooding, SPF and costs, failure, and what the router actually uses.
 */
type Id = "why" | "idea" | "hello" | "params" | "states" | "lsa" | "flood" | "same" | "spf" | "cost" | "dir" | "ecmp" | "fail" | "dead" | "rib" | "static" | "mtu" | "verify" | "trouble" | "recap";
type Step = DeckStep & { id: Id };
const Bb = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;
const STEPS: Step[] = [
  { id: "why", chapter: "Why OSPF", title: "Static routes don't scale — and don't react.", body: <p>In the Routing lesson every route was typed by hand. Four routers, four LANs: twelve static routes to type, and when a link fails, none of them change. Traffic is lost until someone edits every router.</p> },
  { id: "idea", chapter: "Why OSPF", title: "Share a map; let every router compute its own routes.", body: <p><Bb>OSPF</Bb> is a link-state protocol: each router tells all the others what its own links are. Every router builds the same map, then computes the best path to everywhere from its own position.</p> },
  { id: "hello", chapter: "Neighbors", title: "Hellos find the neighbors.", body: <p>Every 10 s each OSPF interface sends a <Bb>Hello</Bb> to 224.0.0.5 (IP protocol 89): its router ID, area, timers — and the neighbors it already hears. Seeing your own ID in a neighbor&apos;s Hello proves the link works both ways.</p> },
  { id: "params", chapter: "Neighbors", title: "Neighbors must agree.", body: <p>Same <Bb>area</Bb>, same <Bb>hello/dead</Bb> intervals, neither end <Bb>passive</Bb>. If any differ, Hellos are discarded and the neighborship never forms — the link stays up but OSPF can&apos;t use it.</p> },
  { id: "states", chapter: "Neighbors", title: "From Hello to FULL.", body: <p>2-Way (we hear each other) → ExStart/Exchange (compare databases; the MTU must match here) → Loading (fetch what&apos;s missing) → <Bb>FULL</Bb>: both databases identical. Only FULL neighbors count for routing.</p> },
  { id: "lsa", chapter: "One map", title: "Each router describes itself: the Router-LSA.", body: <p>R1&apos;s LSA says: “neighbor R2 at cost 10, neighbor R3 at cost 20; networks 192.168.1.0/24, 10.0.12.0/30, 10.0.13.0/30, 1.1.1.1/32.” One LSA per router, with a sequence number that grows with every change.</p> },
  { id: "flood", chapter: "One map", title: "LSAs flood to every router.", body: <p>A router that receives a newer LSA installs it, acknowledges it, and passes it on to its other neighbors. Within a second every router has it.</p> },
  { id: "same", chapter: "One map", title: "Every router holds the same database.", body: <p>Four LSAs, identical on R1, R2, R3 and R4. That shared <Bb>link-state database</Bb> is the map — the opposite of distance-vector rumours.</p> },
  { id: "spf", chapter: "Shortest paths", title: "SPF: each router computes from its own position.", body: <p>Each router runs <Bb>Dijkstra</Bb> on the map, with itself as the root: the cheapest total cost to every router, and through which neighbor. Like spanning tree, a tree — but every router builds its own.</p> },
  { id: "cost", chapter: "Shortest paths", title: "Costs add up along the path.", body: <p>R1 to R4: via R2 = 10 + 10 = <Bb>20</Bb>; via R3 = 20 + 5 = 25. R1 uses R2. The cost of an interface counts when traffic <Bb>leaves</Bb> through it.</p> },
  { id: "dir", chapter: "Shortest paths", title: "Each direction is a separate decision.", body: <p>Raise R1&apos;s cost toward R2 to 100 and R1 sends H4&apos;s traffic via R3 — but R4 still answers via R2: R4 uses its own outgoing costs. Asymmetric paths are normal.</p> },
  { id: "ecmp", chapter: "Shortest paths", title: "Equal costs: both paths.", body: <p>When two paths cost the same, OSPF installs both next hops (<Bb>ECMP</Bb>) and spreads flows over them — like LACP, flow by flow.</p> },
  { id: "fail", chapter: "Failure", title: "A link goes down: everyone recomputes at once.", body: <p>R2–R4 fails. R2 and R4 drop the neighbor, flood new LSAs, and every router re-runs SPF: H1 → H4 goes via R3 within a second.</p> },
  { id: "dead", chapter: "Failure", title: "A silent neighbor: the dead interval.", body: <p>If the link stays up but packets stop, the neighbor is only declared down when no Hello has arrived for the <Bb>dead interval</Bb> (40 s). Until then traffic goes into the dead link.</p> },
  { id: "rib", chapter: "What the router uses", title: "The routing table: longest match, then distance.", body: <p>OSPF offers its routes to the routing table with <Bb>administrative distance</Bb> 110 (Junos: preference 10). For each prefix the router uses the source it trusts most: connected 0, static 1 (Junos 5), OSPF 110.</p> },
  { id: "static", chapter: "What the router uses", title: "A leftover static route beats OSPF.", body: <p>A static route for 192.168.4.0/24 via R3 wins over OSPF&apos;s route via R2 — and when R3–R4 fails, R3 sends the traffic back to R1: a loop until the TTL runs out.</p> },
  { id: "mtu", chapter: "What the router uses", title: "No LSA, no route.", body: <p>A LAN that isn&apos;t in OSPF is in nobody&apos;s map: no route anywhere. Two routers with different MTUs stay stuck in ExStart: neighbors, but never FULL — the link is never used.</p> },
  { id: "verify", chapter: "Verify on the devices", title: "Neighbors, database, routes.", body: <p>Read it in that order: neighbors FULL? database complete? routing table using what you expect?</p> },
  { id: "trouble", chapter: "Troubleshooting", title: "Follow the chain: neighbor → LSA → SPF → table.", body: <p>Most OSPF problems are a missing piece in that chain.</p> },
  { id: "recap", chapter: "The whole idea", title: "Find neighbors, share the map, compute, use.", body: <p>Now watch the diamond converge in the lesson, then break and repair it in the OSPF Lab.</p> },
];
const VISUAL: Record<Id, string> = { why: "net", idea: "net", hello: "net", params: "net", states: "states", lsa: "lsa", flood: "net", same: "lsdb", spf: "net", cost: "net", dir: "net", ecmp: "net", fail: "net", dead: "net", rib: "rib", static: "net", mtu: "net", verify: "verify", trouble: "trouble", recap: "recap" };
const NODES: TopoNode[] = [
  { id: "r1", label: "R1", sub: "1.1.1.1", icon: "R", x: 22, y: 50 },
  { id: "r2", label: "R2", sub: "2.2.2.2", icon: "R", x: 50, y: 18 },
  { id: "r3", label: "R3", sub: "3.3.3.3", icon: "R", x: 50, y: 82 },
  { id: "r4", label: "R4", sub: "4.4.4.4", icon: "R", x: 78, y: 50 },
  { id: "h1", label: "H1", icon: "💻", x: 4, y: 50 },
  { id: "h4", label: "H4", icon: "💻", x: 96, y: 50 },
];
const at = (n: string) => nodeAt(NODES, n);
function Deck({ step: s, play, replay }: { step: Step; play: number; replay: () => void }) {
  const id = s.id;
  const k = `${id}-${play}`;
  const head = <StageHead chapter={s.chapter} title={s.title} />;
  const go = (f: string, t: string, o: { label: string; key: string; delay?: number; stay?: boolean; color?: string }) => (
    <Mover key={`${k}-${o.key}`} from={at(f)} to={o.stay ? short(at(f), at(t)) : at(t)} delay={o.delay} duration={650} stay={o.stay}>
      <Token color={o.color ?? "cyan"}>{o.label}</Token>
    </Mover>
  );
  if (VISUAL[id] === "net") {
    const cut = id === "fail" || id === "dead";
    const params = id === "params";
    const links: TopoLink[] = [
      { a: "r1", b: "r2", label: id === "dir" ? "100 · 10" : id === "static" ? "10" : "10", state: params ? "down" : id === "cost" || id === "idea" ? "active" : "up" },
      { a: "r2", b: "r4", label: "10", state: cut ? (id === "dead" ? "blocked" : "down") : id === "cost" ? "active" : "up" },
      { a: "r1", b: "r3", label: id === "ecmp" ? "15" : "20", state: id === "dir" || id === "fail" || id === "static" ? "active" : "up" },
      { a: "r3", b: "r4", label: "5", state: id === "static" ? "down" : id === "dir" || id === "fail" ? "active" : "up" },
      { a: "h1", b: "r1" },
      { a: "r4", b: "h4" },
    ];
    const views: Record<string, TopoView> = {};
    let movers: ReactNode = null;
    if (id === "why") views.r1 = { bubble: { text: "only what was typed by hand", tone: "warn" } };
    if (id === "hello")
      movers = (
        <>
          {go("r1", "r2", { label: "Hello 1.1.1.1", key: "1", color: "violet" })}
          {go("r2", "r1", { label: "Hello 2.2.2.2 · seen 1.1.1.1", key: "2", delay: 700, color: "violet" })}
        </>
      );
    if (params) {
      views.r2 = { ring: "bad", bubble: { text: "area 1 ≠ area 0 → Hello discarded", tone: "bad" } };
      movers = go("r1", "r2", { label: "Hello area 0", key: "1", stay: true, color: "violet" });
    }
    if (id === "flood")
      movers = (
        <>
          {go("r4", "r2", { label: "LSU R4", key: "1", color: "amber" })}
          {go("r4", "r3", { label: "LSU R4", key: "2", color: "amber" })}
          {go("r2", "r1", { label: "LSU R4", key: "3", delay: 700, color: "amber" })}
        </>
      );
    if (id === "spf") {
      views.r1 = { ring: "on", bubble: { text: "root of MY tree: R2 10 · R3 20 · R4 20", tone: "info" } };
    }
    if (id === "cost" || id === "idea")
      movers = (
        <>
          {go("h1", "r1", { label: "to H4", key: "1" })}
          {go("r1", "r2", { label: "to H4", key: "2", delay: 600 })}
          {go("r2", "r4", { label: "to H4", key: "3", delay: 1200 })}
          {go("r4", "h4", { label: "to H4", key: "4", delay: 1800, stay: true })}
        </>
      );
    if (id === "dir") {
      movers = (
        <>
          {go("r1", "r3", { label: "H1→H4", key: "1" })}
          {go("r3", "r4", { label: "H1→H4", key: "2", delay: 600 })}
          {go("r4", "r2", { label: "reply", key: "3", delay: 1300, color: "green" })}
          {go("r2", "r1", { label: "reply", key: "4", delay: 1900, color: "green" })}
        </>
      );
    }
    if (id === "ecmp") views.r1 = { bubble: { text: "via R2 = 20 · via R3 = 15 + 5 = 20 → both", tone: "yes" } };
    if (id === "fail")
      movers = (
        <>
          {go("r1", "r3", { label: "to H4", key: "1" })}
          {go("r3", "r4", { label: "to H4", key: "2", delay: 600 })}
        </>
      );
    if (id === "dead") {
      movers = go("r2", "r4", { label: "to H4", key: "1", stay: true, color: "red" });
      views.r2 = { ring: "bad", bubble: { text: "R4 still FULL… until 40 s without a Hello", tone: "bad" } };
    }
    if (id === "static") {
      movers = (
        <>
          {go("r1", "r3", { label: "static!", key: "1", color: "red" })}
          {go("r3", "r1", { label: "back (OSPF)", key: "2", delay: 700, color: "red" })}
        </>
      );
      views.r1 = { ring: "bad", bubble: { text: "S 192.168.4.0/24 [1/0] beats O [110/21]", tone: "bad" } };
    }
    if (id === "mtu") {
      views.r4 = { ring: "bad", bubble: { text: "LAN not in OSPF → nobody has a route", tone: "bad" } };
      views.r2 = { bubble: { text: "R4: MTU 1400 ≠ 1500 → stuck in ExStart", tone: "warn", delay: 500 } };
    }
    return (
      <>
        {head}
        <Topo nodes={NODES} links={links} views={views} ratio={46} minH={240}>
          {movers}
        </Topo>
        {["hello", "params", "flood", "cost", "idea", "dir", "fail", "dead", "static"].includes(id) && <ReplayButton onClick={replay} />}
      </>
    );
  }
  switch (id) {
    case "states":
      return (
        <>
          {head}
          <Chain k="st" horizontal items={[{ t: "Down", tone: "plain" }, { t: "Init", tone: "plain" }, { t: "2-Way", tone: "cyan" }, { t: "ExStart (MTU!)", tone: "amber" }, { t: "Exchange", tone: "amber" }, { t: "Loading", tone: "violet" }, { t: "FULL", tone: "green" }]} />
        </>
      );
    case "lsa":
      return (
        <>
          {head}
          <PacketCard layers={[{ name: "Router-LSA of R1 (seq 0x80000001)", color: "#f59e0b", fields: [{ k: "p2p link", v: "R2 · cost 10", hi: "key" }, { k: "p2p link", v: "R3 · cost 20", hi: "key" }, { k: "stub", v: "192.168.1.0/24 · 1" }, { k: "stub", v: "10.0.12.0/30 · 10" }, { k: "stub", v: "10.0.13.0/30 · 20" }, { k: "stub", v: "1.1.1.1/32 · 1" }] }]} />
        </>
      );
    case "same":
      return (
        <>
          {head}
          <MiniTable title="LSDB — on R1, R2, R3 and R4 alike" cols={["LSA", "Links", "Networks"]} rows={[{ cells: ["R1", "R2·10, R3·20", "192.168.1.0/24 …"] }, { cells: ["R2", "R1·10, R4·10", "192.168.2.0/24 …"] }, { cells: ["R3", "R1·20, R4·5", "192.168.3.0/24 …"] }, { cells: ["R4", "R2·10, R3·5", "192.168.4.0/24 …"] }]} />
        </>
      );
    case "rib":
      return (
        <>
          {head}
          <MiniTable title="Who wins for the same prefix" cols={["Source", "Cisco distance", "Junos preference"]} rows={[{ cells: ["connected", "0", "0"] }, { cells: ["static", "1", "5"], state: "hit" }, { cells: ["OSPF (intra-area)", "110", "10"] }]} />
          <Compare items={[{ title: "Longest match first", tone: "cyan", body: "a /24 beats a /16, whatever the source" }, { title: "Then distance", tone: "amber", body: "same prefix: the lowest administrative distance wins; metrics only compare routes of one source" }]} />
        </>
      );
    case "verify":
      return (
        <>
          {head}
          <div className="grid gap-2 sm:grid-cols-2">
            <MiniTable title="Cisco IOS" cols={["Question", "Command"]} rows={[{ cells: ["Neighbors FULL?", "show ip ospf neighbor"] }, { cells: ["Interfaces, area, cost", "show ip ospf interface brief"] }, { cells: ["The map", "show ip ospf database"] }, { cells: ["What is used", "show ip route 192.168.4.10"] }, { cells: ["Path", "traceroute 192.168.4.10"] }]} />
            <MiniTable title="Junos" cols={["Question", "Command"]} rows={[{ cells: ["Neighbors Full?", "show ospf neighbor"] }, { cells: ["Interfaces", "show ospf interface detail"] }, { cells: ["The map", "show ospf database"] }, { cells: ["What is used", "show route 192.168.4.10"] }, { cells: ["Path", "traceroute 192.168.4.10"] }]} />
          </div>
        </>
      );
    case "trouble":
      return (
        <>
          {head}
          <Chain k="ts" items={[{ t: "Symptom: no route, or a longer path than designed", tone: "red" }, { t: "Neighbors: all FULL? (area, timers, passive, MTU)", tone: "cyan" }, { t: "Database: every LSA present, every LAN advertised?", tone: "violet" }, { t: "SPF: costs as designed, per direction?", tone: "amber" }, { t: "Table: is OSPF's route the one used (static?)", tone: "amber" }, { t: "Fix one thing, prove it with traceroute", tone: "green" }]} />
        </>
      );
    case "recap":
      return (
        <>
          {head}
          <Chain k="recap" items={[{ t: "Hellos make neighbors: same area and timers, FULL needs equal MTU" }, { t: "Router-LSAs flood: one identical map everywhere", tone: "amber" }, { t: "SPF from each router: lowest total outgoing cost; ECMP on ties", tone: "cyan" }, { t: "Link down: instant; silent neighbor: dead interval", tone: "violet" }, { t: "The table: longest match, then distance — static beats OSPF", tone: "green" }]} />
        </>
      );
  }
  return head;
}
export function OspfPresentation({ open, onClose, onFinish, finishLabel }: { open: boolean; onClose: () => void; onFinish: () => void; finishLabel: string }) {
  const [play, setPlay] = useState(0);
  return <LessonPresentation open={open} onClose={onClose} title="OSPF, from zero" kicker="Learn · the OSPF presentation" steps={STEPS} visual={(s) => VISUAL[s.id]} renderStage={(s) => <Deck step={s} play={play} replay={() => setPlay((p) => p + 1)} />} finish={{ label: finishLabel, onClick: onFinish }} skip={{ label: "Skip →", onClick: onFinish }} />;
}
