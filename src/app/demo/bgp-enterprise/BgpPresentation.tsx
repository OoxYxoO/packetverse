"use client";

import { useState, type ReactNode } from "react";
import { LessonPresentation } from "@/components/presentation/LessonPresentation";
import { Mover, StageHead, type DeckStep } from "@/components/presentation/ScrollyDeck";
import { Chain, Compare, MiniTable, PacketCard, ReplayButton, Token, Topo, nodeAt, short, type TopoLink, type TopoNode, type TopoView } from "@/components/presentation/Visuals";

/**
 * BGP — the presentation before the lesson/lab. Builds on OSPF (neighbors, a routing table that picks one source, next
 * hops that must be reachable) and on Routing (administrative distance): our AS65001 (R1, R2) dual-homed to ISP-A
 * (AS65010, primary) and ISP-B (AS65020, backup), both reaching AS65030 where SRV lives. Sessions, UPDATEs and
 * AS_PATH, best-path selection, iBGP and next-hop-self, the way back, leaks and failover.
 */
type Id = "why" | "as" | "design" | "session" | "open" | "states" | "update" | "aspath" | "loop" | "best" | "lp" | "tie" | "ibgp" | "nhs" | "rib" | "inbound" | "leak" | "fail" | "verify" | "trouble" | "recap";
type Step = DeckStep & { id: Id };
const Bb = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;
const STEPS: Step[] = [
  { id: "why", chapter: "Why BGP", title: "Inside one network, OSPF. Between networks, no shared map.", body: <p>OSPF works because every router trusts one map of the whole network. The internet is tens of thousands of organizations: none will publish its inside to the others, and none will let a stranger&apos;s costs decide where its traffic goes.</p> },
  { id: "as", chapter: "Why BGP", title: "Every organization is an autonomous system.", body: <p>An <Bb>AS</Bb> is a network under one administration, with a number: we are <Bb>AS65001</Bb>. BGP routers only tell their neighbors “I can reach this prefix, through these ASes” — reachability plus <Bb>policy</Bb>, no map.</p> },
  { id: "design", chapter: "Why BGP", title: "Our design: two ISPs, one preferred.", body: <p>R1 connects to <Bb>ISP-A</Bb> (AS65010, the primary contract), R2 to <Bb>ISP-B</Bb> (AS65020, metered backup). SRV is in AS65030. Goal: leave through ISP-A, come back through ISP-A, fail over to ISP-B — and never carry traffic between the two ISPs.</p> },
  { id: "session", chapter: "Sessions", title: "Neighbors are configured, not discovered.", body: <p>No Hellos to a multicast address: R1 is told <Bb>neighbor 192.0.2.2 remote-as 65010</Bb>, R3 the mirror statement. They open a TCP session on port <Bb>179</Bb> and exchange OPEN messages.</p> },
  { id: "open", chapter: "Sessions", title: "The OPEN must match what the other side expects.", body: <p>R4&apos;s OPEN says “AS 65020”. If R2 was configured with remote-as 65200, R2 answers with a <Bb>NOTIFICATION</Bb> (bad peer AS) and closes. The link is up, ping works — but no routes are exchanged.</p> },
  { id: "states", chapter: "Sessions", title: "Established — or not.", body: <p>Idle → Connect → Active → OpenSent → OpenConfirm → <Bb>Established</Bb>. Only Established exchanges routes. Despite its name, <Bb>Active</Bb> means the session is <Bb>not</Bb> up: the router keeps trying.</p> },
  { id: "update", chapter: "Announcing", title: "An UPDATE: a prefix plus attributes.", body: <p>Over an Established session, routers send <Bb>UPDATE</Bb> messages: the prefix (NLRI) and its path attributes — AS_PATH, NEXT_HOP, LOCAL_PREF inside an AS — and withdrawals when a route disappears.</p> },
  { id: "aspath", chapter: "Announcing", title: "Every AS adds itself to the AS_PATH.", body: <p>R5 announces 203.0.113.0/24 with an empty path; ISP-A passes it on as <Bb>65010 65030</Bb>. The AS_PATH is the route&apos;s travel history — and its length is a rough distance.</p> },
  { id: "loop", chapter: "Announcing", title: "Your own AS in the path? Drop it.", body: <p>ISP-A also offers 203.0.113.0/24 back to R5 — with 65030 in the AS_PATH. R5 drops it: the route has already been through AS65030. That single rule prevents loops between ASes.</p> },
  { id: "best", chapter: "Best path", title: "Many paths, one best.", body: <p>R2 knows two paths to 203.0.113.0/24. BGP compares them step by step; the <Bb>first difference</Bb> decides. Only the best is installed in the routing table and passed on.</p> },
  { id: "lp", chapter: "Best path", title: "LOCAL_PREF chooses our exit.", body: <p>R1 sets <Bb>LOCAL_PREF 200</Bb> on everything learned from ISP-A (default 100) and shares it over iBGP. R2 compares 200 with 100 before anything else: H2 leaves via R1 and ISP-A.</p> },
  { id: "tie", chapter: "Best path", title: "Equal LOCAL_PREF: the tie-breakers.", body: <p>Without LP200 both paths have LOCAL_PREF 100 and AS_PATH length 2. The next step that differs is <Bb>eBGP over iBGP</Bb>: R2 prefers its own ISP-B route — the backup becomes R2&apos;s exit.</p> },
  { id: "ibgp", chapter: "Inside our AS", title: "iBGP carries the ISP routes between R1 and R2.", body: <p>R1 and R2 run <Bb>iBGP</Bb> (same AS). Attributes travel unchanged: LOCAL_PREF 200, AS_PATH 65010 65030 — iBGP adds no AS. An iBGP-learned route is never passed to another iBGP neighbor (split horizon).</p> },
  { id: "nhs", chapter: "Inside our AS", title: "next-hop-self makes the route usable.", body: <p>By default iBGP keeps the next hop: ISP-A&apos;s 192.0.2.2. R2 has no route to that link, so the path is <Bb>inaccessible</Bb> and ignored. With <Bb>next-hop-self</Bb>, R1 advertises itself (10.0.12.1) as the next hop.</p> },
  { id: "rib", chapter: "Inside our AS", title: "Only the best valid path enters the routing table.", body: <p>Like any source, BGP offers routes with an administrative distance: eBGP <Bb>20</Bb>, iBGP <Bb>200</Bb> on Cisco; Junos uses preference 170 for both. The routing table then forwards — BGP itself never touches a packet.</p> },
  { id: "inbound", chapter: "The way back", title: "Others choose how they reach us — we can only influence them.", body: <p>LOCAL_PREF never leaves our AS. To make AS65030 prefer ISP-A for the way back, R2 <Bb>prepends</Bb> our AS toward ISP-B: 65001 65001 65001. Through ISP-B we now look further away.</p> },
  { id: "leak", chapter: "The way back", title: "Announce only what is ours.", body: <p>An enterprise is a stub. Without an outbound filter, R2 would pass the ISP-A route to ISP-B: a path between the two ISPs through our office — a <Bb>route leak</Bb>. Prefix-list OWN / policy OWN-ONLY lets only our /26s out.</p> },
  { id: "fail", chapter: "Failover", title: "The primary fails: the backup takes over.", body: <p>ISP-A&apos;s link goes down. R1 loses the session and withdraws its path; R2&apos;s ISP-B route becomes best and R2 tells R1. H1 now leaves via R1 → R2 → ISP-B — if, and only if, the backup session was Established all along.</p> },
  { id: "verify", chapter: "Verify on the devices", title: "Sessions, paths, announcements, routes.", body: <p>Read it in that order: is every session up? which paths does the router have, and why did the best win? what do we announce? what does the routing table use?</p> },
  { id: "trouble", chapter: "Troubleshooting", title: "Follow the chain: session → path → choice → announcement → table.", body: <p>Most BGP problems are a session that never came up, a path that is unusable or loses, or a policy on the wrong neighbor.</p> },
  { id: "recap", chapter: "The whole idea", title: "Neighbors by configuration, routes with history, choices by policy.", body: <p>Now watch the two ISPs in the lesson, then break and repair them in the BGP Lab.</p> },
];
const VISUAL: Record<Id, string> = { why: "net", as: "net", design: "net", session: "net", open: "net", states: "states", update: "update", aspath: "net", loop: "net", best: "best", lp: "net", tie: "tie", ibgp: "net", nhs: "net", rib: "rib", inbound: "net", leak: "net", fail: "net", verify: "verify", trouble: "trouble", recap: "recap" };
const NODES: TopoNode[] = [
  { id: "r5", label: "R5", sub: "AS65030", icon: "R", x: 50, y: 14 },
  { id: "srv", label: "SRV", icon: "🖥", x: 84, y: 10 },
  { id: "r3", label: "ISP-A", sub: "AS65010", icon: "R", x: 20, y: 46 },
  { id: "r4", label: "ISP-B", sub: "AS65020", icon: "R", x: 80, y: 46 },
  { id: "r1", label: "R1", sub: "AS65001", icon: "R", x: 26, y: 82 },
  { id: "r2", label: "R2", sub: "AS65001", icon: "R", x: 74, y: 82 },
  { id: "h1", label: "H1", icon: "💻", x: 5, y: 90 },
  { id: "h2", label: "H2", icon: "💻", x: 95, y: 90 },
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
    const down13 = id === "fail";
    const down24 = id === "open";
    const links: TopoLink[] = [
      { a: "r1", b: "r3", label: id === "design" ? "primary" : id === "lp" ? "LP 200 in" : undefined, state: down13 ? "down" : ["design", "lp", "aspath"].includes(id) ? "active" : "up" },
      { a: "r2", b: "r4", label: id === "design" ? "backup" : id === "inbound" ? "prepend ×2" : id === "open" ? "Active" : undefined, state: down24 ? "blocked" : id === "fail" ? "active" : "up" },
      { a: "r1", b: "r2", label: id === "ibgp" || id === "nhs" ? "iBGP" : undefined, state: ["lp", "ibgp", "nhs", "fail"].includes(id) ? "active" : "up" },
      { a: "r3", b: "r5", state: id === "aspath" || id === "loop" ? "active" : "up" },
      { a: "r4", b: "r5", state: id === "fail" ? "active" : "up" },
      { a: "h1", b: "r1" },
      { a: "h2", b: "r2" },
      { a: "r5", b: "srv" },
    ];
    const views: Record<string, TopoView> = {};
    let movers: ReactNode = null;
    if (id === "why") {
      views.r3 = { bubble: { text: "my inside is private", tone: "warn" } };
      views.r4 = { bubble: { text: "so is mine", tone: "warn", delay: 400 } };
    }
    if (id === "as") {
      views.r1 = { ring: "on", bubble: { text: "AS65001 — us", tone: "info" } };
      views.r5 = { bubble: { text: "AS65030", tone: "info", delay: 300 } };
    }
    if (id === "design")
      movers = (
        <>
          {go("h1", "r1", { label: "out", key: "1" })}
          {go("r1", "r3", { label: "out", key: "2", delay: 600 })}
          {go("r3", "r5", { label: "out", key: "3", delay: 1200 })}
        </>
      );
    if (id === "session")
      movers = (
        <>
          {go("r1", "r3", { label: "OPEN AS65001", key: "1", color: "violet" })}
          {go("r3", "r1", { label: "OPEN AS65010", key: "2", delay: 700, color: "violet" })}
        </>
      );
    if (id === "open") {
      movers = go("r4", "r2", { label: "OPEN AS65020", key: "1", stay: true, color: "violet" });
      views.r2 = { ring: "bad", bubble: { text: "expected 65200 → NOTIFICATION: bad peer AS", tone: "bad" } };
    }
    if (id === "aspath")
      movers = (
        <>
          {go("r5", "r3", { label: "203.0.113.0/24 · (empty)", key: "1", color: "amber" })}
          {go("r3", "r1", { label: "203.0.113.0/24 · 65010 65030", key: "2", delay: 800, color: "amber" })}
        </>
      );
    if (id === "loop") {
      movers = go("r3", "r5", { label: "203.0.113.0/24 · 65010 65030", key: "1", stay: true, color: "amber" });
      views.r5 = { ring: "bad", bubble: { text: "65030 is me → dropped", tone: "bad" } };
    }
    if (id === "lp") {
      views.r2 = { ring: "on", bubble: { text: "via R1: LP 200 · via ISP-B: LP 100 → R1", tone: "yes" } };
      movers = (
        <>
          {go("h2", "r2", { label: "to SRV", key: "1" })}
          {go("r2", "r1", { label: "to SRV", key: "2", delay: 600 })}
          {go("r1", "r3", { label: "to SRV", key: "3", delay: 1200 })}
        </>
      );
    }
    if (id === "ibgp") movers = go("r1", "r2", { label: "203.0.113.0/24 · LP 200 · NH 10.0.12.1", key: "1", color: "violet" });
    if (id === "nhs") {
      movers = go("r1", "r2", { label: "NH 192.0.2.2", key: "1", stay: true, color: "red" });
      views.r2 = { ring: "bad", bubble: { text: "no route to 192.0.2.2 → inaccessible", tone: "bad" } };
    }
    if (id === "inbound") {
      views.r4 = { bubble: { text: "us: 65020 65001 65001 65001", tone: "warn" } };
      views.r5 = { ring: "on", bubble: { text: "via ISP-A: 65010 65001 (shorter) ✓", tone: "yes", delay: 400 } };
      movers = (
        <>
          {go("srv", "r5", { label: "reply", key: "1", color: "green" })}
          {go("r5", "r3", { label: "reply", key: "2", delay: 600, color: "green" })}
          {go("r3", "r1", { label: "reply", key: "3", delay: 1200, color: "green" })}
        </>
      );
    }
    if (id === "leak") {
      movers = go("r2", "r4", { label: "203.0.113.0/24 · 65001… 65010 65030", key: "1", stay: true, color: "red" });
      views.r2 = { ring: "bad", bubble: { text: "not ours → filtered by OWN", tone: "bad" } };
    }
    if (id === "fail")
      movers = (
        <>
          {go("h1", "r1", { label: "to SRV", key: "1" })}
          {go("r1", "r2", { label: "to SRV", key: "2", delay: 600 })}
          {go("r2", "r4", { label: "to SRV", key: "3", delay: 1200 })}
          {go("r4", "r5", { label: "to SRV", key: "4", delay: 1800 })}
        </>
      );
    return (
      <>
        {head}
        <Topo nodes={NODES} links={links} views={views} ratio={50} minH={250}>
          {movers}
        </Topo>
        {["design", "session", "open", "aspath", "loop", "lp", "ibgp", "nhs", "inbound", "leak", "fail"].includes(id) && <ReplayButton onClick={replay} />}
      </>
    );
  }
  switch (id) {
    case "states":
      return (
        <>
          {head}
          <Chain k="st" horizontal items={[{ t: "Idle", tone: "plain" }, { t: "Connect (TCP 179)", tone: "plain" }, { t: "Active — NOT up", tone: "red" }, { t: "OpenSent", tone: "amber" }, { t: "OpenConfirm", tone: "amber" }, { t: "Established", tone: "green" }]} />
        </>
      );
    case "update":
      return (
        <>
          {head}
          <PacketCard layers={[{ name: "TCP 179 · BGP UPDATE from ISP-A to R1", color: "#a78bfa", fields: [{ k: "NLRI", v: "203.0.113.0/24", hi: "key" }, { k: "AS_PATH", v: "65010 65030", hi: "key" }, { k: "NEXT_HOP", v: "192.0.2.2" }, { k: "ORIGIN", v: "IGP" }, { k: "MED", v: "0" }] }]} />
        </>
      );
    case "best":
      return (
        <>
          {head}
          <MiniTable title="Best-path order (first difference wins)" cols={["Step", "Prefer"]} rows={[{ cells: ["1. next hop", "reachable (else the path is ignored)"] }, { cells: ["2. LOCAL_PREF", "highest"], state: "hit" }, { cells: ["3. AS_PATH", "shortest"] }, { cells: ["4. MED", "lowest — same neighbor AS only"] }, { cells: ["5. type", "eBGP over iBGP"] }, { cells: ["6. router ID", "lowest"] }]} />
        </>
      );
    case "tie":
      return (
        <>
          {head}
          <MiniTable title="R2's two paths to 203.0.113.0/24 without LP200" cols={["From", "LOCAL_PREF", "AS_PATH", "Type"]} rows={[{ cells: ["R1 (ISP-A)", "100", "65010 65030", "iBGP"] }, { cells: ["ISP-B", "100", "65020 65030", "eBGP"], state: "hit" }]} />
          <Compare items={[{ title: "Same LOCAL_PREF", tone: "cyan", body: "100 = 100 → next step" }, { title: "Same AS_PATH length", tone: "amber", body: "2 = 2 → next step: eBGP over iBGP → ISP-B wins" }]} />
        </>
      );
    case "rib":
      return (
        <>
          {head}
          <MiniTable title="Who wins for the same prefix" cols={["Source", "Cisco distance", "Junos preference"]} rows={[{ cells: ["connected", "0", "0"] }, { cells: ["static", "1", "5"] }, { cells: ["eBGP", "20", "170"], state: "hit" }, { cells: ["OSPF", "110", "10"] }, { cells: ["iBGP", "200", "170"] }]} />
        </>
      );
    case "verify":
      return (
        <>
          {head}
          <div className="grid gap-2 sm:grid-cols-2">
            <MiniTable title="Cisco IOS" cols={["Question", "Command"]} rows={[{ cells: ["Sessions up?", "show ip bgp summary"] }, { cells: ["Paths, best and why", "show ip bgp 203.0.113.0"] }, { cells: ["What we announce", "show ip bgp neighbors <ip> advertised-routes"] }, { cells: ["What is used", "show ip route 203.0.113.10"] }, { cells: ["Why a session failed", "show logging"] }]} />
            <MiniTable title="Junos" cols={["Question", "Command"]} rows={[{ cells: ["Sessions up?", "show bgp summary"] }, { cells: ["Paths, Inactive reason", "show route 203.0.113.0/24 detail"] }, { cells: ["What we announce", "show route advertising-protocol bgp <ip>"] }, { cells: ["What is used", "show route 203.0.113.10"] }, { cells: ["Why a session failed", "show bgp neighbor <ip>"] }]} />
          </div>
        </>
      );
    case "trouble":
      return (
        <>
          {head}
          <Chain k="ts" items={[{ t: "Symptom: no reply, or the wrong ISP (out or in)", tone: "red" }, { t: "Sessions: all Established? (remote AS, shutdown, link)", tone: "cyan" }, { t: "Paths: present, and usable (next hop reachable)?", tone: "violet" }, { t: "Choice: which attribute decided — LOCAL_PREF, AS_PATH, eBGP/iBGP?", tone: "amber" }, { t: "Announcements: only ours, prepended on the backup?", tone: "amber" }, { t: "Fix one policy, prove it with traceroute both ways", tone: "green" }]} />
        </>
      );
    case "recap":
      return (
        <>
          {head}
          <Chain k="recap" items={[{ t: "Sessions by configuration: remote AS must match; Active = not up" }, { t: "UPDATEs carry prefixes and AS_PATH; own AS in the path = dropped", tone: "amber" }, { t: "Best path: reachable NH → LOCAL_PREF → AS_PATH → … → eBGP over iBGP", tone: "cyan" }, { t: "iBGP keeps attributes; next-hop-self makes them usable", tone: "violet" }, { t: "We pick our exit; prepend steers the way back; announce only ours", tone: "green" }]} />
        </>
      );
  }
  return head;
}
export function BgpPresentation({ open, onClose, onFinish, finishLabel }: { open: boolean; onClose: () => void; onFinish: () => void; finishLabel: string }) {
  const [play, setPlay] = useState(0);
  return <LessonPresentation open={open} onClose={onClose} title="BGP, from zero" kicker="Learn · the BGP presentation" steps={STEPS} visual={(s) => VISUAL[s.id]} renderStage={(s) => <Deck step={s} play={play} replay={() => setPlay((p) => p + 1)} />} finish={{ label: finishLabel, onClick: onFinish }} skip={{ label: "Skip →", onClick: onFinish }} />;
}
