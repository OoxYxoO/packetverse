"use client";

import { useState, type ReactNode } from "react";
import { LessonPresentation } from "@/components/presentation/LessonPresentation";
import { Mover, StageHead, type DeckStep } from "@/components/presentation/ScrollyDeck";
import { Chain, Compare, MiniTable, Pills, ReplayButton, Token, Topo, nodeAt, short, type TableRow, type TopoNode, type TopoView } from "@/components/presentation/Visuals";
import { INITIAL_TTL, OUTSIDE_DST, RT_ADDR } from "@/lib/sim-engine/scenarios/routingFundamentals";

/**
 * ROUTING FUNDAMENTALS — the presentation before the lesson, on the lesson's network (HOST-A — R1 — R2 —
 * SERVER-A / SERVER-B), R1's real table (connected, static /24, /16, default) and incident (a /25 discard route that
 * wins longest-prefix match for SERVER-A only). Presentation state only.
 */

const SA = RT_ADDR["SERVER-A"];
const SB = RT_ADDR["SERVER-B"];
const NH = RT_ADDR["R2:TRANSIT"];

type Id = "why" | "connected" | "static" | "table" | "lpm" | "nexthop" | "r2" | "return" | "default" | "decision" | "usable" | "drops" | "loop" | "incident" | "symptom" | "trouble" | "fix" | "dynamic" | "recap";
type Step = DeckStep & { id: Id };
const Bb = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;
const M = ({ children }: { children: ReactNode }) => <span className="pv-mono text-pv-text">{children}</span>;

const STEPS: Step[] = [
  { id: "why", chapter: "Why routing exists", title: "Every router must decide: where does this packet go next?", body: <p>HOST-A (10.10.10.0/24) wants SERVER-A on 172.16.50.0/24, two routers away. R1 can&apos;t see the destination; it can only hand the packet to a neighbor. Its <Bb>routing table</Bb> tells it which one.</p> },
  { id: "connected", chapter: "Building the table", title: "Connected routes appear by themselves.", body: <p>When an interface is configured and up, the router knows the network on it: R1 gets <M>10.10.10.0/24</M> (ge-0/0/0) and <M>10.0.12.0/30</M> (ge-0/0/1, the link to R2).</p> },
  { id: "static", chapter: "Building the table", title: "Remote networks need someone to add a route.", body: <p>R1 can&apos;t know 172.16.50.0/24 exists. An operator adds <Bb>static routes</Bb> “via {NH}” (R2). Later lessons let routers learn routes automatically (OSPF, IS-IS, BGP).</p> },
  { id: "table", chapter: "Building the table", title: "R1's routing table.", body: <p>Two connected routes, three static ones: a /24, a broader /16 and the <Bb>default route</Bb> 0.0.0.0/0, which matches everything.</p> },
  { id: "lpm", chapter: "Longest prefix match", title: "Several routes match? The most specific one wins.", body: <p>For {SA}, the /24, the /16 and the /0 all contain it. R1 picks the <Bb>longest prefix</Bb>: /24. The others stay installed; they just lose this lookup. Try another destination.</p> },
  { id: "nexthop", chapter: "Forwarding", title: `“via ${NH}” → which interface? → new frame.`, body: <p>{NH} is inside the connected 10.0.12.0/30, so the packet leaves ge-0/0/1. R1 uses R2&apos;s MAC (ARP) for the new frame, decrements TTL and recomputes the checksum. <Bb>The next-hop address is never written into the packet.</Bb></p> },
  { id: "r2", chapter: "Forwarding", title: "R2: the destination is directly connected.", body: <p>R2 looks up {SA}: connected 172.16.50.0/24 on ge-0/0/0. It delivers the packet to SERVER-A in a new frame.</p> },
  { id: "return", chapter: "The way back", title: "Routing works in each direction separately.", body: <p>SERVER-A&apos;s reply goes to R2, and R2 needs <Bb>its own</Bb> route back to 10.10.10.0/24 (static via 10.0.12.1). A route on R1 does nothing for the reply.</p> },
  { id: "default", chapter: "The default route", title: `${OUTSIDE_DST}: only the default matches.`, body: <p>R1 forwards it to R2 via 0.0.0.0/0. But R2 has no route for it, so R2 drops it (normally replying ICMP Net Unreachable). A default route moves a packet <Bb>one hop</Bb>; it doesn&apos;t guarantee delivery.</p> },
  { id: "decision", chapter: "Table vs decision", title: "The table lists everything. Each lookup picks one.", body: <p>Reading a routing table isn&apos;t enough: ask “for <i>this</i> destination, which route wins?” That habit is what the incident tests.</p> },
  { id: "usable", chapter: "Table vs decision", title: "A route in the configuration isn't always a route in use.", body: <p>A static route is <Bb>installed</Bb> only while its next hop lies on a connected network that is up. Shut the link to R2 and “via {NH}” stays in the configuration — but leaves the table. And even an installed route fails if nobody answers ARP for its next hop.</p> },
  { id: "drops", chapter: "Table vs decision", title: "No route, discard, dead next hop: three different drops.", body: <p>No matching route → the router returns <Bb>Net Unreachable</Bb>. A winning discard route → <Bb>silence</Bb>. A next hop nobody owns → <Bb>Host Unreachable</Bb>. The evidence tells you which.</p> },
  { id: "loop", chapter: "Table vs decision", title: "Two routers pointing at each other: a loop.", body: <p>If R1 sends a destination to R2 and R2&apos;s only match points back at R1, the packet bounces. Each hop costs 1 TTL; at 0 a router drops it and sends <Bb>Time Exceeded</Bb> — the ICMP you used with traceroute.</p> },
  { id: "incident", chapter: "The incident", title: "After overnight maintenance, SERVER-A is unreachable. SERVER-B works.", body: <p>Both servers are on the same /24 behind R2. R2 and the servers didn&apos;t change. Something on R1 did.</p> },
  { id: "symptom", chapter: "The incident", title: "A new /25 discard route steals SERVER-A's lookup.", body: <p>Maintenance added <M>172.16.50.0/25 discard</M>. {SA} is inside .0–.127, and /25 is longer than /24, so it wins: R1 silently drops the packet. {SB} is outside the /25 and still matches the /24.</p> },
  { id: "trouble", chapter: "Troubleshooting", title: "Same subnet, different results → look at the lookup.", body: <p>The split between .50 and .200 rules out R2, the servers, cabling and ARP. Run the lookup on R1 for each destination: different winning routes.</p> },
  { id: "fix", chapter: "Troubleshooting", title: "Remove the discard route, then prove both work.", body: <p>The /24 wins again for {SA}; pings to both servers succeed and the replies come back. Check the table and the lookup result, not just the ping.</p> },
  { id: "dynamic", chapter: "What comes next", title: "Static routes don't react. Dynamic routing does.", body: <p>Every route here was typed by hand and stays even if a link dies. Routing protocols (OSPF, IS-IS, BGP) discover networks and react to changes; the lookup rule (longest prefix wins) stays the same.</p> },
  { id: "recap", chapter: "The whole idea", title: "Find every match, pick the longest, forward to the next hop.", body: <p>Now follow the packets through R1 and R2 in the lesson and find the discard route yourself.</p> },
];

const VISUAL: Record<Id, string> = { why: "net", connected: "rib", static: "rib", table: "rib", lpm: "rib", nexthop: "net", r2: "net", return: "net", default: "net", decision: "decision", usable: "usable", drops: "drops", loop: "loop", incident: "net", symptom: "rib", trouble: "trouble", fix: "net", dynamic: "dynamic", recap: "recap" };

const NODES: TopoNode[] = [
  { id: "a", label: "HOST-A", sub: RT_ADDR["HOST-A"], icon: "💻", x: 8, y: 50 },
  { id: "r1", label: "R1", sub: "10.10.10.1", icon: "R", x: 34, y: 50 },
  { id: "r2", label: "R2", sub: NH, icon: "R", x: 63, y: 50 },
  { id: "sa", label: "SERVER-A", sub: SA, icon: "🗄", x: 91, y: 20 },
  { id: "sb", label: "SERVER-B", sub: SB, icon: "🗄", x: 91, y: 82 },
];
const LINKS = [
  { a: "a", b: "r1", label: "10.10.10.0/24" },
  { a: "r1", b: "r2", label: "10.0.12.0/30" },
  { a: "r2", b: "sa" },
  { a: "r2", b: "sb" },
];
const at = (n: string) => nodeAt(NODES, n);

interface R {
  p: string;
  len: number;
  how: string;
  match: (ip: string) => boolean;
}
const ipNum = (ip: string) => ip.split(".").reduce((a, o) => a * 256 + Number(o), 0);
const inP = (ip: string, p: string, len: number) => len === 0 || Math.floor(ipNum(ip) / 2 ** (32 - len)) === Math.floor(ipNum(p) / 2 ** (32 - len));
const mk = (p: string, len: number, how: string): R => ({ p, len, how, match: (ip) => inP(ip, p, len) });
const R1_BASE: R[] = [mk("0.0.0.0", 0, `static via ${NH}`), mk("10.0.12.0", 30, "connected ge-0/0/1"), mk("10.10.10.0", 24, "connected ge-0/0/0"), mk("172.16.0.0", 16, `static via ${NH}`), mk("172.16.50.0", 24, `static via ${NH}`)];
const DISCARD = mk("172.16.50.0", 25, "static DISCARD");

function rib(dst: string | undefined, withDiscard: boolean, highlight?: "connected" | "static"): TableRow[] {
  const routes = withDiscard ? [...R1_BASE, DISCARD] : R1_BASE;
  const matches = dst ? routes.filter((r) => r.match(dst)) : [];
  const best = matches.sort((a, b) => b.len - a.len)[0];
  return routes.map((r) => ({
    key: `${r.p}/${r.len}`,
    cells: [`${r.p}/${r.len}`, r.how],
    state: highlight ? (r.how.startsWith(highlight) ? "new" : "dim") : dst ? (r === best ? (r.how.includes("DISCARD") ? "bad" : "best") : r.match(dst) ? "hit" : "dim") : r === DISCARD ? "bad" : undefined,
    note: dst && r === best ? `← wins for ${dst} (longest match /${r.len})` : dst && r.match(dst) ? "matches, but shorter" : undefined,
  }));
}

function Deck({ step: s, play, replay, dst, setDst }: { step: Step; play: number; replay: () => void; dst: string; setDst: (d: string) => void }) {
  const id = s.id;
  const k = `${id}-${play}`;
  const head = <StageHead chapter={s.chapter} title={s.title} />;
  const go = (f: string, t: string, o: { label: string; key: string; delay?: number; stay?: boolean; color?: string; d?: number }) => (
    <Mover key={`${k}-${o.key}`} from={at(f)} to={o.stay ? short(at(f), at(t)) : at(t)} delay={o.delay} duration={o.d ?? 750} stay={o.stay}>
      <Token color={o.color ?? "cyan"}>{o.label}</Token>
    </Mover>
  );

  if (VISUAL[id] === "net") {
    const views: Record<string, TopoView> = {};
    let movers: ReactNode = null;
    if (id === "why") {
      views.a = { ring: "on", bubble: { text: `to ${SA}`, tone: "info" } };
      views.r1 = { ring: "hit", bubble: { text: "which neighbor?", tone: "ask" } };
    }
    if (id === "nexthop") {
      movers = (
        <>
          {go("a", "r1", { label: `dst ${SA} · TTL ${INITIAL_TTL}`, key: "1" })}
          {go("r1", "r2", { label: `TTL ${INITIAL_TTL - 1} · new frame`, key: "2", delay: 900, stay: true })}
        </>
      );
      views.r1 = { ring: "on", bubble: { text: `/24 via ${NH} → ge-0/0/1`, tone: "yes", delay: 600 } };
    }
    if (id === "r2") {
      movers = go("r2", "sa", { label: `dst ${SA} · TTL ${INITIAL_TTL - 2}`, key: "1", stay: true });
      views.r2 = { ring: "on", bubble: { text: "connected 172.16.50.0/24", tone: "yes" } };
      views.sa = { ring: "target", bubble: { text: "received ✓", tone: "yes", delay: 800 } };
    }
    if (id === "return") {
      movers = (
        <>
          {go("sa", "r2", { label: "reply → 10.10.10.10", key: "1", color: "green" })}
          {go("r2", "r1", { label: "reply", key: "2", delay: 800, color: "green" })}
          {go("r1", "a", { label: "reply", key: "3", delay: 1600, stay: true, color: "green" })}
        </>
      );
      views.r2 = { ring: "on", bubble: { text: "needs ITS route: 10.10.10.0/24 via 10.0.12.1", tone: "info", delay: 400 } };
    }
    if (id === "default") {
      movers = (
        <>
          {go("a", "r1", { label: `dst ${OUTSIDE_DST}`, key: "1" })}
          {go("r1", "r2", { label: `dst ${OUTSIDE_DST}`, key: "2", delay: 800, stay: true, color: "red" })}
        </>
      );
      views.r1 = { ring: "on", bubble: { text: "only 0.0.0.0/0 matches → R2", tone: "info", delay: 500 } };
      views.r2 = { ring: "bad", bubble: { text: "no route → drop (ICMP 3/0)", tone: "bad", delay: 1600 } };
    }
    if (id === "incident") {
      movers = (
        <>
          {go("a", "r1", { label: `to ${SA}`, key: "1", color: "red" })}
          {go("a", "r1", { label: `to ${SB}`, key: "2", delay: 1300 })}
          {go("r1", "r2", { label: `to ${SB}`, key: "3", delay: 2100 })}
          {go("r2", "sb", { label: `to ${SB}`, key: "4", delay: 2900, stay: true, color: "green" })}
        </>
      );
      views.r1 = { ring: "bad", bubble: { text: `${SA}: dropped here, silently`, tone: "bad", delay: 700 } };
      views.sb = { ring: "target", bubble: { text: "works ✓", tone: "yes", delay: 3600 } };
      views.sa = { ring: "dim", bubble: { text: "nothing arrives", tone: "no", delay: 1200 } };
    }
    if (id === "fix") {
      movers = (
        <>
          {go("a", "r1", { label: `to ${SA}`, key: "1" })}
          {go("r1", "r2", { label: `to ${SA}`, key: "2", delay: 800 })}
          {go("r2", "sa", { label: `to ${SA}`, key: "3", delay: 1600, stay: true, color: "green" })}
        </>
      );
      views.r1 = { ring: "on", bubble: { text: "/25 discard removed → /24 wins", tone: "yes", delay: 400 } };
      views.sa = { ring: "target", bubble: { text: "reply ✓", tone: "yes", delay: 2400 } };
    }
    return (
      <>
        {head}
        <Topo nodes={NODES} links={LINKS} views={views} ratio={40} minH={220}>
          {movers}
        </Topo>
        {id !== "why" && <ReplayButton onClick={replay} />}
      </>
    );
  }

  switch (id) {
    case "connected":
    case "static":
    case "table":
      return (
        <>
          {head}
          <MiniTable title="R1 routing table" cols={["Prefix", "Source"]} rows={rib(undefined, false, id === "table" ? undefined : id)} />
          <Compare
            items={[
              { title: "Connected", tone: id === "connected" ? "green" : "plain", body: "from interface address + mask; disappears if the interface goes down" },
              { title: "Static", tone: id === "static" ? "green" : "plain", body: "typed by an operator; points at a next hop (or discards)" },
              { title: "Default 0.0.0.0/0", tone: id === "table" ? "amber" : "plain", body: "matches every destination; the last resort" },
            ]}
          />
        </>
      );
    case "lpm":
    case "symptom": {
      const disc = id === "symptom";
      const d = disc ? (dst === OUTSIDE_DST ? SA : dst) : dst;
      return (
        <>
          {head}
          <Pills label="Destination" options={(disc ? [SA, SB] : [SA, SB, OUTSIDE_DST, "10.10.10.10"]).map((v) => ({ v, label: v }))} value={d} onPick={setDst} />
          <MiniTable title={disc ? "R1 routing table after maintenance" : "R1 routing table"} cols={["Prefix", "Source"]} rows={rib(d, disc)} />
        </>
      );
    }
    case "decision":
      return (
        <>
          {head}
          <Chain k="dec" items={[{ t: "Destination IP from the packet", tone: "plain" }, { t: "Collect every route that contains it", tone: "cyan" }, { t: "Pick the longest prefix", tone: "green" }, { t: "Resolve the next hop → egress interface", tone: "violet" }, { t: "New frame · TTL −1 · checksum", tone: "amber" }]} />
        </>
      );
    case "usable":
      return (
        <>
          {head}
          <Chain k="use" items={[{ t: `Configured: 172.16.50.0/24 via ${NH}`, tone: "plain" }, { t: `Is ${NH} inside an UP connected network? (10.0.12.0/30 on ge-0/0/1)`, tone: "cyan" }, { t: "Yes → installed, takes part in lookups · No → not installed, never used", tone: "amber" }, { t: "Wins the lookup → ARP for the next hop", tone: "violet" }, { t: "ARP answered → frame sent · no answer → dropped", tone: "green" }]} />
        </>
      );
    case "drops":
      return (
        <>
          {head}
          <Compare
            items={[
              { title: "No route", tone: "amber", body: "nothing contains the destination · ICMP Net Unreachable · traceroute !N" },
              { title: "Discard route", tone: "red", body: "a route matched, and says drop · no reply at all" },
              { title: "Next hop unresolved", tone: "violet", body: "route wins, ARP gets no answer · Host Unreachable · ARP: Incomplete" },
            ]}
          />
        </>
      );
    case "loop":
      return (
        <>
          {head}
          <Chain k="loop" items={[{ t: `R1: ${SA} → /24 via R2`, tone: "cyan" }, { t: `R2 (server LAN down): only 0.0.0.0/0 via R1 matches`, tone: "amber" }, { t: "R1 → R2 → R1 → R2 … TTL 64, 63, 62 …", tone: "red" }, { t: "TTL reaches 0 → dropped → ICMP Time Exceeded to HOST-A", tone: "red" }, { t: "traceroute alternates between the two routers", tone: "violet" }]} />
        </>
      );
    case "trouble":
      return (
        <>
          {head}
          <Chain
            k="ts"
            items={[
              { t: `Symptom: ${SA} fails, ${SB} works`, tone: "red" },
              { t: "Same /24, same R2 → not R2, cabling or the servers", tone: "plain" },
              { t: `Test: lookup ${SA} on R1 → 172.16.50.0/25 DISCARD`, tone: "amber" },
              { t: `Test: lookup ${SB} on R1 → 172.16.50.0/24 via ${NH}`, tone: "amber" },
              { t: "Compare with yesterday's table: the /25 is new", tone: "violet" },
              { t: "Root cause: a more specific discard route", tone: "violet" },
              { t: "Remove it → verify both servers", tone: "green" },
            ]}
          />
        </>
      );
    case "dynamic":
      return (
        <>
          {head}
          <Compare
            items={[
              { title: "Static routing", tone: "plain", body: "typed by hand · predictable · doesn't react to failures" },
              { title: "Dynamic routing", tone: "cyan", body: "routers exchange routes · react to failures · same longest-prefix rule" },
            ]}
          />
        </>
      );
    case "recap":
      return (
        <>
          {head}
          <Chain
            k="recap"
            items={[
              { t: "Connected routes come from interfaces", tone: "green" },
              { t: "Remote networks need static (or dynamic) routes", tone: "cyan" },
              { t: "Every matching route is a candidate; longest prefix wins", tone: "amber" },
              { t: "Next hop → egress interface → new frame, TTL −1", tone: "violet" },
              { t: "Each direction needs its own routes", tone: "plain" },
              { t: "A more specific route can silently steal traffic", tone: "red" },
            ]}
          />
        </>
      );
  }
  return head;
}

export function RoutingPresentation({ open, onClose, onFinish, finishLabel }: { open: boolean; onClose: () => void; onFinish: () => void; finishLabel: string }) {
  const [play, setPlay] = useState(0);
  const [dst, setDst] = useState<string>(SA);
  return (
    <LessonPresentation
      open={open}
      onClose={onClose}
      title="Routing, from zero"
      kicker="Learn · the Routing presentation"
      steps={STEPS}
      visual={(s) => VISUAL[s.id]}
      renderStage={(s) => <Deck step={s} play={play} replay={() => setPlay((p) => p + 1)} dst={dst} setDst={setDst} />}
      finish={{ label: finishLabel, onClick: onFinish }}
      skip={{ label: "Skip →", onClick: onFinish }}
    />
  );
}
