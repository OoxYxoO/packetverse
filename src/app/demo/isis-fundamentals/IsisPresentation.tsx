"use client";

import { useState, type ReactNode } from "react";
import { LessonPresentation } from "@/components/presentation/LessonPresentation";
import { Mover, StageHead, type DeckStep } from "@/components/presentation/ScrollyDeck";
import { Chain, Compare, MiniTable, PacketCard, ReplayButton, Token, Topo, nodeAt, short, type TopoLink, type TopoNode, type TopoView } from "@/components/presentation/Visuals";
import { useFitNodes } from "@/components/presentation/fitNarrow";

/**
 * IS-IS — the presentation before the lesson and the IS-IS Lab. Builds on Routing and OSPF (routes, link-state,
 * SPF) and moves into the provider core: PE1, P1–P4 and PE2, one Level-2 backbone, the loopbacks every later SP
 * lesson depends on. Same routers, addresses and metrics as the lab. Presentation state only.
 */

type Id = "why" | "loopbacks" | "net-of-lesson" | "why-isis" | "net" | "wire" | "handshake" | "levels" | "lsp" | "flood" | "seq" | "sync" | "map" | "spf" | "ecmp" | "rib" | "metric" | "overload" | "match" | "verify" | "trouble" | "recap";
type Step = DeckStep & { id: Id };
const B = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;

const STEPS: Step[] = [
  { id: "why", chapter: "Why a provider needs an IGP", title: "A provider core is many routers that must agree.", body: <p>Customer traffic enters at an <B>edge router (PE)</B>, crosses <B>core routers (P)</B> and leaves at another PE. Before any customer service can work, every router in the core must know how to reach every other router — and change its mind within a second when a link fails.</p> },
  { id: "loopbacks", chapter: "Why a provider needs an IGP", title: "What the core really needs to reach: loopbacks.", body: <p>Every router has a <B>loopback</B> address that never goes down with a single link. BGP sessions, MPLS labels and VPNs in later lessons are all built between loopbacks. The interior routing protocol&apos;s first job: make every loopback reachable, over the best path, everywhere.</p> },
  { id: "net-of-lesson", chapter: "The network", title: "Six routers, two ways across.", body: <p>PE1 and PE2 at the edges; P1–P2 across the top, P3–P4 across the bottom. Every link has metric 10, so PE1 → PE2 costs the same either way. P1 and P3 are cabled together too, but IS-IS isn&apos;t running on that link yet.</p> },
  { id: "why-isis", chapter: "Why IS-IS", title: "Why providers like IS-IS.", body: <p>You know OSPF from the Enterprise path. IS-IS solves the same problem with the same idea — flood a map, run SPF — but it runs <B>directly on the link</B>, not over IP, and carries everything in extensible <B>TLVs</B>. Many large provider backbones run it for exactly those reasons.</p> },
  { id: "net", chapter: "Naming routers", title: "A router's name is its NET.", body: <p>IS-IS comes from the OSI world. Each router has a <B>Network Entity Title</B>: an area, a six-byte <B>System ID</B> that must be unique, and a final <B>00</B>. The NET names the router, not an interface. IPv4 addresses are just prefixes IS-IS advertises.</p> },
  { id: "wire", chapter: "Neighbors", title: "Hellos ride straight on the wire.", body: <p>An IS-IS hello (an <B>IIH</B>) is an Ethernet frame with an LLC header and the IS-IS PDU right after — <B>no IP header at all</B>. That&apos;s why IS-IS can come up before any IP routing exists, and why ARP and IP addressing don&apos;t affect adjacencies.</p> },
  { id: "handshake", chapter: "Neighbors", title: "Up only when each side hears itself.", body: <p>P1 and P3 send hellos listing the neighbors they hear. First, nobody is listed: each side goes <B>Initializing</B>. Then each hello lists the other&apos;s System ID: both go <B>Up</B>. This <B>three-way handshake</B> guarantees the link works in both directions.</p> },
  { id: "levels", chapter: "Neighbors", title: "Two levels: inside an area, and between areas.", body: <p><B>Level 1</B> routers know their own area only. <B>Level 2</B> is the backbone that joins areas. Our whole core runs Level 2 only — one flat backbone. Two routers form an adjacency only at a level they share; Level 1 also needs the same area, Level 2 doesn&apos;t care.</p> },
  { id: "lsp", chapter: "One map", title: "Each router describes itself in one LSP.", body: <p>A <B>Link State PDU</B> lists the router&apos;s Up neighbors with its own outgoing metric to each, and the prefixes it owns: its loopback /32 and the /31 of every IS-IS link. P1&apos;s LSP is called <B>P1.00-00</B>.</p> },
  { id: "flood", chapter: "One map", title: "Flooding: every router gets every LSP.", body: <p>When P1&apos;s LSP changes, P1 sends it to each neighbor. Each neighbor installs it, acknowledges it and passes it on — never back where it came from. In a few hops, every router holds P1&apos;s newest LSP.</p> },
  { id: "seq", chapter: "One map", title: "Sequence numbers decide what's newer.", body: <p>Every new version of an LSP carries a higher <B>sequence number</B>. A router that receives an older copy than the one it holds keeps its own and sends that back. Nothing is overwritten by stale news.</p> },
  { id: "sync", chapter: "One map", title: "New neighbors compare databases first.", body: <p>When an adjacency comes up, both routers send a <B>CSNP</B>: a list of every LSP they hold, with sequence numbers. Anything missing or older on one side is sent; <B>PSNPs</B> acknowledge and request. Two neighbors are synchronized within moments.</p> },
  { id: "map", chapter: "One map", title: "The result: one map, six copies.", body: <p>Every router now holds the same six LSPs — the same <B>link-state database</B>. It&apos;s a complete map of the core: who connects to whom, at what cost, and which prefixes live where.</p> },
  { id: "spf", chapter: "Paths", title: "PE1 computes its own shortest paths.", body: <p>Each router runs <B>SPF</B> (Dijkstra) on its copy, with itself as the root. A link counts only if <B>both</B> ends list it. From PE1: P1 and P3 at 10, P2 and P4 at 20, PE2 at 30.</p> },
  { id: "ecmp", chapter: "Paths", title: "Two equal paths: both are kept.", body: <p>PE2 is 30 away over the top and 30 over the bottom. PE1 installs <B>both next hops</B> (ECMP). Each flow is hashed onto one path, so packets of one flow never arrive out of order while different flows spread over both.</p> },
  { id: "rib", chapter: "Paths", title: "SPF becomes ordinary IPv4 routes.", body: <p>For each prefix: the advertiser&apos;s distance plus the prefix metric. PE2&apos;s loopback: 30 + 10 = <B>40</B>, via P1 and via P3. IS-IS never carries user traffic — it fills the routing table, and forwarding just follows it.</p> },
  { id: "metric", chapter: "Changing paths", title: "A metric is a one-way cost.", body: <p>Raise P1&apos;s metric toward P2 to 100. P1&apos;s LSP changes and floods; PE1&apos;s SPF now prefers the bottom (30 vs 120). But P2&apos;s metric toward P1 is still 10, so PE2 → PE1 keeps both paths. <B>Metrics are per direction.</B></p> },
  { id: "overload", chapter: "Changing paths", title: "Overload: reachable, but never a transit.", body: <p>The <B>overload bit</B> in P1&apos;s LSP says “don&apos;t route through me”. Every SPF still reaches P1 itself but computes no path through it. Engineers set it before maintenance, so traffic leaves a router before they touch it.</p> },
  { id: "match", chapter: "When neighbors fail", title: "What hellos must agree on.", body: <p>A hello is checked before any adjacency forms. Most IS-IS outages are one of these checks failing — while the link itself stays perfectly up.</p> },
  { id: "verify", chapter: "Verify on the routers", title: "Two vendors, the same questions.", body: <p>Providers commonly run Cisco IOS XR and Juniper Junos side by side. The questions are always the same: are the adjacencies Up, does every LSDB hold the same LSPs, and what did SPF install?</p> },
  { id: "trouble", chapter: "Troubleshooting", title: "Walk up the chain.", body: <p>Users see “PE2 is unreachable” or “the top path is empty”. The evidence tells the causes apart, one layer at a time.</p> },
  { id: "recap", chapter: "The whole idea", title: "Hellos, one map, everyone's own SPF.", body: <p>Now watch it in the lesson, then break it and fix it in the IS-IS Lab.</p> },
];

const VISUAL: Record<Id, string> = { why: "core", loopbacks: "core", "net-of-lesson": "core", "why-isis": "why-isis", net: "net", wire: "wire", handshake: "core", levels: "levels", lsp: "lsp", flood: "core", seq: "seq", sync: "sync", map: "core", spf: "core", ecmp: "core", rib: "rib", metric: "core", overload: "core", match: "match", verify: "verify", trouble: "trouble", recap: "recap" };

const NODES: TopoNode[] = [
  { id: "PE1", label: "PE1", sub: "10.0.0.1", icon: "PE", x: 8, y: 50 },
  { id: "P1", label: "P1", sub: "10.0.0.2", icon: "P", x: 34, y: 16 },
  { id: "P2", label: "P2", sub: "10.0.0.3", icon: "P", x: 66, y: 16 },
  { id: "PE2", label: "PE2", sub: "10.0.0.4", icon: "PE", x: 92, y: 50 },
  { id: "P3", label: "P3", sub: "10.0.0.5", icon: "P", x: 34, y: 84 },
  { id: "P4", label: "P4", sub: "10.0.0.6", icon: "P", x: 66, y: 84 },
];

function Deck({ step: s, play, replay }: { step: Step; play: number; replay: () => void }) {
  const FIT = useFitNodes(NODES, 250);
  const at = (n: string) => nodeAt(FIT.nodes, n);
  const id = s.id;
  const k = `${id}-${play}`;
  const head = <StageHead chapter={s.chapter} title={s.title} />;
  const go = (f: string, t: string, o: { label: string; key: string; delay?: number; stay?: boolean; color?: string; d?: number; dx?: number; dy?: number }) => {
    const off = (p: [number, number]): [number, number] => [p[0] + (o.dx ?? 0), p[1] + (o.dy ?? 0)];
    const from = off(at(f));
    const to = off(at(t));
    return (
      <Mover key={`${k}-${o.key}`} from={from} to={o.stay ? short(from, to) : to} delay={o.delay} duration={o.d ?? 800} stay={o.stay}>
        <Token color={o.color ?? "cyan"}>{o.label}</Token>
      </Mover>
    );
  };

  if (VISUAL[id] === "core") {
    const m = (a: string, b: string) => (id === "metric" && a === "P1" && b === "P2" ? "100 → · ← 10" : "10");
    const links: TopoLink[] = [
      { a: "PE1", b: "P1", label: m("PE1", "P1"), state: "up" },
      { a: "P1", b: "P2", label: m("P1", "P2"), state: id === "metric" ? "standby" : "up" },
      { a: "P2", b: "PE2", label: "10", state: "up" },
      { a: "PE1", b: "P3", label: "10", state: "up" },
      { a: "P3", b: "P4", label: "10", state: "up" },
      { a: "P4", b: "PE2", label: "10", state: "up" },
      { a: "P1", b: "P3", label: ["handshake"].includes(id) ? "IS-IS enabled" : ["why", "loopbacks", "net-of-lesson"].includes(id) ? "no IS-IS yet" : "", state: id === "handshake" ? "active" : "dim" },
    ];
    const views: Record<string, TopoView> = {};
    let movers: ReactNode = null;
    if (id === "why") {
      movers = (
        <>
          {go("PE1", "P1", { label: "customer", key: "1", color: "green" })}
          {go("P1", "P2", { label: "customer", key: "2", delay: 800, color: "green" })}
          {go("P2", "PE2", { label: "customer", key: "3", delay: 1600, color: "green", stay: true })}
        </>
      );
      views.PE1 = { badge: { text: "edge", tone: "yes" } };
      views.PE2 = { badge: { text: "edge", tone: "yes" } };
      views.P1 = { badge: { text: "core", tone: "info" } };
      views.P3 = { badge: { text: "core", tone: "info" } };
    }
    if (id === "loopbacks") {
      for (const n of NODES) views[n.id] = { ring: "on" };
      views.PE1 = { ring: "on", bubble: { text: "best path to 10.0.0.4?", tone: "ask" } };
    }
    if (id === "net-of-lesson") {
      views.PE1 = { bubble: { text: "PE2 is 30 away — either way", tone: "info" } };
    }
    if (id === "handshake") {
      movers = (
        <>
          {go("P1", "P3", { label: "IIH (sees —)", key: "1", dx: -1.5, d: 900 })}
          {go("P3", "P1", { label: "IIH (sees —)", key: "2", dx: 1.5, d: 900 })}
          {go("P1", "P3", { label: "IIH (sees P3)", key: "3", dx: -1.5, delay: 1500, d: 900, color: "green" })}
          {go("P3", "P1", { label: "IIH (sees P1)", key: "4", dx: 1.5, delay: 1500, d: 900, color: "green" })}
        </>
      );
      views.P1 = { ring: "on", bubble: { text: "Initializing → Up", tone: "yes", delay: 2400 } };
      views.P3 = { ring: "on", bubble: { text: "Initializing → Up", tone: "yes", delay: 2400 } };
    }
    if (id === "flood") {
      movers = (
        <>
          {go("P1", "PE1", { label: "LSP P1 #5", key: "1", color: "violet" })}
          {go("P1", "P2", { label: "LSP P1 #5", key: "2", color: "violet" })}
          {go("PE1", "P3", { label: "LSP P1 #5", key: "3", delay: 900, color: "violet" })}
          {go("P2", "PE2", { label: "LSP P1 #5", key: "4", delay: 900, color: "violet" })}
          {go("P3", "P4", { label: "LSP P1 #5", key: "5", delay: 1800, color: "violet" })}
        </>
      );
      views.P1 = { ring: "on", badge: { text: "seq 5", tone: "warn" } };
      views.P4 = { bubble: { text: "got it from P3 (and PE2)", tone: "info", delay: 2600 } };
    }
    if (id === "map") for (const n of NODES) views[n.id] = { badge: { text: "6 LSPs", tone: "yes" } };
    if (id === "spf") {
      const d: Record<string, string> = { PE1: "0", P1: "10", P3: "10", P2: "20", P4: "20", PE2: "30" };
      for (const n of NODES) views[n.id] = { badge: { text: d[n.id], tone: n.id === "PE1" ? "yes" : "info" } };
      views.PE1 = { ring: "on", badge: { text: "root", tone: "yes" } };
    }
    if (id === "ecmp") {
      movers = (
        <>
          {go("PE1", "P1", { label: "flow A", key: "1", color: "green" })}
          {go("P1", "P2", { label: "flow A", key: "2", delay: 800, color: "green" })}
          {go("P2", "PE2", { label: "flow A", key: "3", delay: 1600, color: "green", stay: true })}
          {go("PE1", "P3", { label: "flow B", key: "4", delay: 300, color: "amber" })}
          {go("P3", "P4", { label: "flow B", key: "5", delay: 1100, color: "amber" })}
          {go("P4", "PE2", { label: "flow B", key: "6", delay: 1900, color: "amber", stay: true })}
        </>
      );
      views.PE1 = { ring: "on", bubble: { text: "2 equal next hops", tone: "info" } };
    }
    if (id === "metric") {
      movers = (
        <>
          {go("PE1", "P3", { label: "PE1 → PE2", key: "1", color: "green" })}
          {go("P3", "P4", { label: "PE1 → PE2", key: "2", delay: 800, color: "green" })}
          {go("P4", "PE2", { label: "PE1 → PE2", key: "3", delay: 1600, color: "green", stay: true })}
          {go("P2", "P1", { label: "PE2 → PE1", key: "4", delay: 400, color: "amber", dy: 3 })}
        </>
      );
      views.P1 = { ring: "hit", bubble: { text: "my cost to P2: 100", tone: "warn" } };
      views.PE1 = { bubble: { text: "top 120 · bottom 30", tone: "info", delay: 600 } };
      views.PE2 = { bubble: { text: "still 40 both ways", tone: "yes", delay: 1200 } };
    }
    if (id === "overload") {
      movers = (
        <>
          {go("PE1", "P3", { label: "transit", key: "1", color: "green" })}
          {go("P3", "P4", { label: "transit", key: "2", delay: 800, color: "green" })}
          {go("P4", "PE2", { label: "transit", key: "3", delay: 1600, color: "green", stay: true })}
          {go("PE1", "P1", { label: "ping P1", key: "4", delay: 400, color: "amber", stay: true })}
        </>
      );
      views.P1 = { ring: "hit", badge: { text: "OL", tone: "bad" }, bubble: { text: "reachable · no transit", tone: "warn", delay: 900 } };
    }
    return (
      <>
        {head}
        <Topo nodes={FIT.nodes} links={links} views={views} ratio={50} minH={FIT.minH}>
          {movers}
        </Topo>
        {["why", "handshake", "flood", "ecmp", "metric", "overload"].includes(id) && <ReplayButton onClick={replay} />}
      </>
    );
  }

  switch (id) {
    case "why-isis":
      return (
        <>
          {head}
          <Compare
            items={[
              { title: "OSPF (Enterprise path)", tone: "cyan", body: "runs over IP (protocol 89) · areas around a backbone area 0 · LSA types per purpose" },
              { title: "IS-IS (this path)", tone: "violet", body: "runs directly on the link (no IP) · Level 1 / Level 2 · one LSP per router, extended with TLVs" },
            ]}
          />
          <Chain k="same" items={[{ t: "Same idea: describe yourself, flood it, everyone runs SPF", tone: "green" }, { t: "Same result: loop-free shortest paths, installed as IPv4 routes", tone: "plain" }]} />
        </>
      );
    case "net":
      return (
        <>
          {head}
          <PacketCard
            layers={[
              {
                name: "P1's NET: 49.0001.0000.0000.0002.00",
                color: "#22d3ee",
                fields: [
                  { k: "Area", v: "49.0001", hi: "new" },
                  { k: "System ID", v: "0000.0000.0002", hi: "new" },
                  { k: "NSEL", v: "00 (the router itself)" },
                ],
              },
            ]}
          />
          <MiniTable title="The six routers" cols={["Router", "System ID", "Loopback"]} rows={[{ cells: ["PE1", "0000.0000.0001", "10.0.0.1"] }, { cells: ["P1", "0000.0000.0002", "10.0.0.2"] }, { cells: ["P2", "0000.0000.0003", "10.0.0.3"] }, { cells: ["PE2", "0000.0000.0004", "10.0.0.4"] }, { cells: ["P3", "0000.0000.0005", "10.0.0.5"] }, { cells: ["P4", "0000.0000.0006", "10.0.0.6"] }]} />
        </>
      );
    case "wire":
      return (
        <>
          {head}
          <PacketCard
            layers={[
              { name: "802.3 Ethernet", color: "#94a3b8", fields: [{ k: "Destination", v: "09:00:2B:00:00:05 (AllISs)" }, { k: "Source", v: "P1's interface MAC" }] },
              { name: "LLC", color: "#94a3b8", fields: [{ k: "DSAP · SSAP · control", v: "0xFE · 0xFE · 0x03", hi: "new" }] },
              { name: "IS-IS (no IP header!)", color: "#22d3ee", fields: [{ k: "Discriminator", v: "0x83" }, { k: "PDU type", v: "17 · point-to-point hello" }, { k: "Circuit type", v: "Level 2" }, { k: "Three-way TLV 240", v: "state + neighbor's System ID", hi: "new" }, { k: "Padding TLV 8", v: "up to the interface MTU" }] },
            ]}
          />
        </>
      );
    case "levels":
      return (
        <>
          {head}
          <Compare
            items={[
              { title: "Level 1", tone: "cyan", body: "inside one area · needs the same area · L1 LSDB" },
              { title: "Level 2", tone: "violet", body: "the backbone between areas · area doesn't matter · L2 LSDB" },
              { title: "This core", tone: "green", body: "every router Level-2-only (is-type level-2-only)" },
            ]}
          />
          <Chain k="lv" items={[{ t: "Router's is-type ∩ interface's circuit-type = the levels that interface runs", tone: "plain" }, { t: "Two ends must share a level — or no adjacency, even with the link up", tone: "amber" }]} />
        </>
      );
    case "lsp":
      return (
        <>
          {head}
          <MiniTable title="P1.00-00 · sequence 0x00000004" cols={["TLV", "Entry", "Metric"]} rows={[{ cells: ["22 · IS reach", "PE1", "10"] }, { cells: ["22 · IS reach", "P2", "10"] }, { cells: ["135 · IP reach", "10.0.0.2/32 (loopback)", "10"], state: "hit" }, { cells: ["135 · IP reach", "192.0.2.0/31 (to PE1)", "10"] }, { cells: ["135 · IP reach", "192.0.2.2/31 (to P2)", "10"] }]} />
          <Compare items={[{ title: "IS reach", tone: "cyan", body: "who I'm Up with, and MY cost to them" }, { title: "IP reach", tone: "violet", body: "the prefixes I own" }]} />
        </>
      );
    case "seq":
      return (
        <>
          {head}
          <Chain
            k="seq"
            items={[
              { t: "PE2 holds P1.00-00 with sequence 0x5", tone: "plain" },
              { t: "A copy with 0x6 arrives → newer: install it, acknowledge, flood on", tone: "green" },
              { t: "A copy with 0x4 arrives → older: keep 0x6, send 0x6 back", tone: "amber" },
              { t: "Same sequence → same LSP: just acknowledge", tone: "cyan" },
            ]}
          />
        </>
      );
    case "sync":
      return (
        <>
          {head}
          <Chain
            k="sync"
            items={[
              { t: "P1–P3 adjacency comes Up", tone: "green" },
              { t: "P1 → P3: CSNP (every LSP I hold, with sequence numbers)", tone: "amber" },
              { t: "P3 → P1: CSNP (mine)", tone: "amber" },
              { t: "Each sends the LSPs the other lacks or holds older", tone: "violet" },
              { t: "PSNPs acknowledge (and request what's missing)", tone: "cyan" },
              { t: "Both databases identical", tone: "green" },
            ]}
          />
        </>
      );
    case "rib":
      return (
        <>
          {head}
          <MiniTable title="PE1 · IS-IS routes to the loopbacks" cols={["Prefix", "Metric", "Next hop(s)"]} rows={[{ cells: ["10.0.0.2/32 (P1)", "20", "P1"] }, { cells: ["10.0.0.3/32 (P2)", "30", "P1"] }, { cells: ["10.0.0.4/32 (PE2)", "40", "P1 + P3"], state: "hit" }, { cells: ["10.0.0.5/32 (P3)", "20", "P3"] }, { cells: ["10.0.0.6/32 (P4)", "30", "P3"] }]} />
          <Compare items={[{ title: "IOS XR", tone: "cyan", body: "i L2 10.0.0.4/32 [115/40] via 192.0.2.1 … via 192.0.2.7" }, { title: "Junos", tone: "violet", body: "10.0.0.4/32 *[IS-IS/18] metric 40 > to 192.0.2.1 > to 192.0.2.7" }]} />
        </>
      );
    case "match":
      return (
        <>
          {head}
          <Chain
            k="match"
            items={[
              { t: "Both ends run IS-IS on the interface (Junos also needs family iso on the unit)", tone: "plain" },
              { t: "A common level (is-type ∩ circuit-type on each side)", tone: "cyan" },
              { t: "Level 1 only: the same area", tone: "cyan" },
              { t: "MTU: hellos are padded to the MTU — a smaller neighbor drops them as giants", tone: "amber" },
              { t: "Authentication: the same key on both ends", tone: "amber" },
              { t: "One side Initializing, the other nothing → the problem is on the receive side of the router that shows nothing", tone: "red" },
            ]}
          />
        </>
      );
    case "verify":
      return (
        <>
          {head}
          <div className="grid gap-2 sm:grid-cols-2">
            <MiniTable title="Cisco IOS XR" cols={["Question", "Command"]} rows={[{ cells: ["Neighbors Up?", "show isis adjacency"] }, { cells: ["Same LSPs everywhere?", "show isis database"] }, { cells: ["What one LSP says", "show isis database detail P1"] }, { cells: ["Interfaces, MTU", "show isis interface brief"] }, { cells: ["What SPF chose", "show isis topology · show route isis"] }]} />
            <MiniTable title="Junos" cols={["Question", "Command"]} rows={[{ cells: ["Neighbors Up?", "show isis adjacency"] }, { cells: ["Same LSPs everywhere?", "show isis database"] }, { cells: ["What one LSP says", "show isis database P1.00-00 detail"] }, { cells: ["Interfaces, levels", "show isis interface"] }, { cells: ["What SPF chose", "show route protocol isis"] }]} />
          </div>
          <Compare items={[{ title: "Both", tone: "green", body: "configuration is a candidate until you commit" }, { title: "Junos", tone: "violet", body: "the NET lives on lo0 (family iso address) and every IS-IS unit needs family iso" }]} />
        </>
      );
    case "trouble":
      return (
        <>
          {head}
          <Chain
            k="ts"
            items={[
              { t: "What did the test show — unreachable, or reachable on an unexpected path?", tone: "plain" },
              { t: "Links up underneath? (show interfaces)", tone: "cyan" },
              { t: "Adjacencies Up on BOTH ends? Compare levels, MTU, keys", tone: "cyan" },
              { t: "What does each LSP say? Loopback present? Overload bit?", tone: "violet" },
              { t: "Metrics the same in both directions?", tone: "amber" },
              { t: "What did SPF install? Fix one thing, then prove it with fresh traffic", tone: "green" },
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
              { t: "Hellos on the wire (no IP) · three-way handshake → adjacency Up" },
              { t: "One LSP per router: neighbors + own metrics, prefixes · sequence numbers", tone: "violet" },
              { t: "Flooding + CSNP/PSNP → the same LSDB on every router", tone: "cyan" },
              { t: "Each router's own SPF (two-way check, overload = no transit) → IPv4 routes, ECMP", tone: "green" },
              { t: "Metrics are outgoing and per direction", tone: "amber" },
              { t: "Adjacencies need a common level, (L1) the same area, a fitting MTU, the same key", tone: "red" },
            ]}
          />
        </>
      );
  }
  return head;
}

export function IsisPresentation({ open, onClose, onFinish, finishLabel }: { open: boolean; onClose: () => void; onFinish: () => void; finishLabel: string }) {
  const [play, setPlay] = useState(0);
  return (
    <LessonPresentation
      open={open}
      onClose={onClose}
      title="IS-IS in a provider core, from zero"
      kicker="Learn · the IS-IS presentation"
      steps={STEPS}
      visual={(s) => VISUAL[s.id]}
      renderStage={(s) => <Deck step={s} play={play} replay={() => setPlay((p) => p + 1)} />}
      finish={{ label: finishLabel, onClick: onFinish }}
      skip={{ label: "Skip →", onClick: onFinish }}
    />
  );
}
