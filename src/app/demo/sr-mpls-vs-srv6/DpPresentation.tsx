"use client";

import { useState, type ReactNode } from "react";
import { LessonPresentation } from "@/components/presentation/LessonPresentation";
import { Mover, StageHead, type DeckStep } from "@/components/presentation/ScrollyDeck";
import { Chain, MiniTable, ReplayButton, Token, Topo, nodeAt, type TopoLink, type TopoNode, type TopoView } from "@/components/presentation/Visuals";
import { useFitNodes } from "@/components/presentation/fitNarrow";
import { VPN_LABEL, adjLbl, createDNet, dApply, dt4Of, endXOf, locOf, nodeLbl, type DState } from "@/lib/sim-engine/scenarios/dpNet";

/**
 * SR-MPLS vs SRv6 — the presentation before the lesson and the lab. Every label, SID, header and byte count on the
 * slides is read from the lab model (dpNet.ts, IOS XR). Presentation state only.
 */

type Id = "question" | "net" | "same" | "mplsid" | "srv6id" | "service" | "mplspush" | "mplsswap" | "mplspop" | "srv6push" | "srv6route" | "srv6dt4" | "bytes" | "transit" | "transit6" | "tilfa" | "mplsrep" | "srv6rep" | "mtu" | "incident" | "why" | "fix" | "choose" | "verify" | "recap";
type Step = DeckStep & { id: Id };
const B = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;
const M = ({ children }: { children: ReactNode }) => <span className="pv-mono text-pv-text">{children}</span>;
const run = (s: DState, ...a: Parameters<typeof dApply>[1][]) => a.reduce((x, y) => dApply(x, y), s);
const S0 = createDNet(0);
const S6 = run(S0, { type: "set", text: "", changes: [{ dev: "PE2", f: (c) => void (c.vrfSrv6 = true) }] });
const WM = run(S0, { type: "ping", size: 100 }).tests[0].walk;
const W6 = run(S6, { type: "ping", size: 100 }).tests[0].walk;
const DM = run(S0, { type: "drill", size: 100 }).tests[0].walk;
const D6 = run(S6, { type: "drill", size: 100 }).tests[0].walk;
const N2 = nodeLbl("PE2");
const DT4 = dt4Of("PE2");
const ADJ = adjLbl("P4", "P2");
const EX = endXOf("P4", "P2");
const short = (x: string) => x.replace(/2001:db8:1[01]0:/, "…:");
const BIG = 1460;

const STEPS: Step[] = [
  { id: "question", chapter: "The question", title: "Two ways to steer a packet.", body: <p>Segment Routing lets the ingress put the path in the packet. It comes in two data planes: <B>SR-MPLS</B> (labels) and <B>SRv6</B> (IPv6 addresses). What really differs between them?</p> },
  { id: "net", chapter: "The network", title: "One network, both planes.", body: <p>PE1, P1–P4 and PE2 run IS-IS. Customer VPN CUST-A connects site 1 (behind PE1) to site 2 (behind PE2). Every router runs <B>both</B> data planes at once.</p> },
  { id: "same", chapter: "The network", title: "Same IGP, same paths.", body: <p>Both planes follow the same IS-IS shortest path: PE1 → P1 → P2 → PE2, cost 30. The difference is only how the instruction is written into the packet.</p> },
  { id: "mplsid", chapter: "Identifiers", title: "SR-MPLS: an index, a label.", body: <p>PE2&apos;s loopback has <B>prefix-SID index {nodeLbl("PE2") - 16000}</B>. With SRGB 16000 every router programs label <M>{N2}</M> for PE2. A 20-bit label inside a 4-byte entry.</p> },
  { id: "srv6id", chapter: "Identifiers", title: "SRv6: a locator, a function.", body: <p>PE2 owns locator <M>{locOf("PE2")}/64</M>. Its SIDs are addresses inside it: the locator part routes to PE2, the function part says what PE2 does.</p> },
  { id: "service", chapter: "Identifiers", title: "The egress decides.", body: <p>For CUST-A, PE2 advertises in BGP either an MPLS <B>VPN label</B> (<M>{VPN_LABEL}</M>) or an SRv6 <B>End.DT4</B> SID (<M>{DT4}</M>). PE1 encapsulates with whatever PE2 advertised.</p> },
  { id: "mplspush", chapter: "SR-MPLS packet", title: "PE1 pushes two labels.", body: <p>Transport on top, service below: <M>{WM.hops[1].hdr}</M> — {WM.overhead} bytes in front of the customer packet.</p> },
  { id: "mplsswap", chapter: "SR-MPLS packet", title: "P1 swaps.", body: <p>P1 looks at the top label only: <M>{N2}</M> → out to P2 with <M>{N2}</M> (same index, same SRGB). It never sees the VPN label.</p> },
  { id: "mplspop", chapter: "SR-MPLS packet", title: "P2 pops, PE2 pops.", body: <p>P2 is the penultimate hop and pops the transport label. PE2 receives <M>[{VPN_LABEL}]</M>, pops it and looks up CUST-A.</p> },
  { id: "srv6push", chapter: "SRv6 packet", title: "PE1 wraps it in IPv6.", body: <p>With SRv6, PE1 performs H.Encaps.Red: one outer IPv6 header, DA <M>{DT4}</M>. One SID, so no SRH — {W6.overhead} bytes.</p> },
  { id: "srv6route", chapter: "SRv6 packet", title: "P1 and P2 just route.", body: <p>The destination falls in PE2&apos;s locator. P1 and P2 do a normal IPv6 lookup — no SR instruction to execute, nothing to swap.</p> },
  { id: "srv6dt4", chapter: "SRv6 packet", title: "PE2 executes End.DT4.", body: <p>PE2 recognizes its own SID: decapsulate, look up the inner IPv4 destination in CUST-A, deliver to CE2.</p> },
  { id: "bytes", chapter: "Comparison", title: `${WM.overhead} bytes vs ${W6.overhead}.`, body: <p>A label costs 4 bytes; an IPv6 header 40, each further SID 16 in an SRH. SR-MPLS is compact. SRv6 pays for a single, routable, programmable address.</p> },
  { id: "transit", chapter: "Transit", title: "SR-MPLS needs every hop.", body: <p>Turn off SR-MPLS on P2. P1 has no label toward PE2 via P2 (<B>Unlabelled</B>): it pops the transport label, and P2 receives the bare VPN label {VPN_LABEL}. Dropped.</p> },
  { id: "transit6", chapter: "Transit", title: "SRv6 only needs IPv6.", body: <p>Same P2, CUST-A on SRv6: delivered. A transit router only needs an IPv6 route to the owner&apos;s locator. That is SRv6&apos;s big operational difference.</p> },
  { id: "tilfa", chapter: "Protection", title: "P1 protects the P1–P2 link.", body: <p>TI-LFA on P1: if P1–P2 fails, the post-convergence path is {S0.view.repair.path.join(" → ")}. But P4&apos;s own shortest path to P2 still runs back through P1 — the repair must force P4 → P2.</p> },
  { id: "mplsrep", chapter: "Protection", title: "SR-MPLS repair: two labels.", body: <p>P1 keeps {N2} and pushes P4&apos;s Node SID and P4&apos;s Adj-SID to P2 above it: <M>{DM.hops.find((h) => h.at === "P1")?.hdr}</M>. +{DM.peakOverhead - DM.overhead} bytes.</p> },
  { id: "srv6rep", chapter: "Protection", title: "SRv6 repair: one End.X.", body: <p>P1 adds an outer IPv6 header with DA = P4&apos;s End.X toward P2, <M>{EX}</M>. P4 executes it and removes it. +{D6.peakOverhead - D6.overhead} bytes.</p> },
  { id: "mtu", chapter: "Protection", title: "Mind the byte budget.", body: <p>A {BIG}-byte customer packet during the repair: SR-MPLS {BIG + DM.peakOverhead} bytes, SRv6 {BIG + D6.peakOverhead}. A link with a 1500-byte IP MTU carries one and drops the other.</p> },
  { id: "incident", chapter: "When it breaks", title: "Migrated to SRv6 — and it stopped.", body: <p>The guided incident: CUST-A moves to SRv6, but PE2&apos;s IS-IS doesn&apos;t advertise its locator. BGP is up, the route carries the SID, PE2&apos;s loopback pings. CE2 is unreachable.</p> },
  { id: "why", chapter: "When it breaks", title: "Each plane has its own reachability.", body: <p>SR-MPLS reached PE2 through the prefix-SID of its loopback. SRv6 needs a route to the <B>locator</B> that contains the service SID. Nobody has one, so PE1 can&apos;t use the route.</p> },
  { id: "fix", chapter: "When it breaks", title: "Restore the locator, then prove it.", body: <p>Changing the RT, restarting BGP or adding an MPLS label changes nothing. Advertise locator MAIN in PE2&apos;s IS-IS, check the route on PE1, then send fresh traffic.</p> },
  { id: "choose", chapter: "Choosing", title: "Which one, when?", body: <p>Neither plane is “better”. The choice is about what the network already has and what it needs.</p> },
  { id: "verify", chapter: "Verify", title: "The questions engineers ask.", body: <p>Which plane does the VPN use? Can the ingress reach the egress in that plane? Does every transit router support it? Is there a backup in that plane? Do the links carry the bytes?</p> },
  { id: "recap", chapter: "The whole idea", title: "Same paths, different instructions.", body: <p>Now follow the comparison in the lesson, then run, break and repair both planes in the SR-MPLS vs SRv6 Lab.</p> },
];
const VISUAL: Record<Id, string> = Object.fromEntries(STEPS.map((s) => [s.id, ["bytes", "choose", "verify", "recap"].includes(s.id) ? s.id : "topo"])) as Record<Id, string>;

const NODES: TopoNode[] = [
  { id: "PE1", label: "PE1", sub: `site 1 · ${nodeLbl("PE1")}`, icon: "PE", x: 6, y: 50 },
  { id: "P1", label: "P1", sub: `${nodeLbl("P1")}`, icon: "P", x: 28, y: 50 },
  { id: "P2", label: "P2", sub: `${nodeLbl("P2")}`, icon: "P", x: 56, y: 18 },
  { id: "PE2", label: "PE2", sub: `site 2 · ${N2}`, icon: "PE", x: 92, y: 50 },
  { id: "P3", label: "P3", sub: `${nodeLbl("P3")}`, icon: "P", x: 42, y: 84 },
  { id: "P4", label: "P4", sub: `${nodeLbl("P4")}`, icon: "P", x: 70, y: 84 },
];
const LINKS: [string, string, string?][] = [["PE1", "P1"], ["P1", "P2"], ["P2", "PE2"], ["P1", "P3"], ["P3", "P4"], ["P4", "P2", "50"], ["P4", "PE2", "70"]];
const PRIMARY = new Set(["PE1-P1", "P1-P2", "P2-PE2"]);
const REPAIR = new Set(["PE1-P1", "P1-P3", "P3-P4", "P4-P2", "P2-PE2"]);

function Deck({ step: s, play, replay }: { step: Step; play: number; replay: () => void }) {
  const FIT = useFitNodes(NODES, 250);
  const id = s.id;
  const k = `${id}-${play}`;
  const head = <StageHead chapter={s.chapter} title={s.title} />;
  const go = (f: string, t: string, o: { label: string; key: string; delay?: number; color?: string }) => (
    <Mover key={`${k}-${o.key}`} from={nodeAt(FIT.nodes, f)} to={nodeAt(FIT.nodes, t)} delay={o.delay} duration={800}>
      <Token color={o.color ?? "cyan"}>{o.label}</Token>
    </Mover>
  );
  if (VISUAL[id] === "topo") {
    const hot = ["same", "mplspush", "mplsswap", "mplspop", "srv6push", "srv6route", "srv6dt4", "transit", "transit6"].includes(id) ? PRIMARY : ["tilfa", "mplsrep", "srv6rep", "mtu"].includes(id) ? REPAIR : new Set<string>();
    const cut = ["tilfa", "mplsrep", "srv6rep", "mtu"].includes(id);
    const links: TopoLink[] = LINKS.map(([a, b, m]) => {
      const key = `${a}-${b}`;
      return { a, b, state: (cut && key === "P1-P2" ? "down" : hot.has(key) ? "active" : hot.size ? "dim" : "up") as TopoLink["state"], label: m ? `metric ${m}` : "" };
    });
    const views: Record<string, TopoView> = {};
    let movers: ReactNode = null;
    if (id === "question") views.PE1 = { bubble: { text: "labels or IPv6?", tone: "info" } };
    if (id === "net") views.PE2 = { bubble: { text: "SR-MPLS + SRv6", tone: "info" } };
    if (id === "mplsid") views.PE2 = { ring: "hit", bubble: { text: `index 2 → ${N2}`, tone: "info" } };
    if (id === "srv6id") views.PE2 = { ring: "hit", bubble: { text: `${locOf("PE2")}/64`, tone: "info" } };
    if (id === "service") views.PE2 = { bubble: { text: `${VPN_LABEL} or End.DT4`, tone: "yes" } };
    if (id === "mplspush") movers = go("PE1", "P1", { label: WM.hops[1].hdr, key: "1" });
    if (id === "mplsswap") movers = go("P1", "P2", { label: WM.hops[2].hdr, key: "1" });
    if (id === "mplspop") movers = <>{go("P2", "PE2", { label: `[${VPN_LABEL}]`, key: "1" })}</>;
    if (id === "srv6push") movers = go("PE1", "P1", { label: `DA ${short(DT4)}`, key: "1", color: "violet" });
    if (id === "srv6route") movers = <>{go("P1", "P2", { label: `DA ${short(DT4)}`, key: "1", color: "violet" })}{go("P2", "PE2", { label: `DA ${short(DT4)}`, key: "2", delay: 800, color: "violet" })}</>;
    if (id === "srv6dt4") views.PE2 = { ring: "hit", bubble: { text: "End.DT4 → CUST-A", tone: "yes" } };
    if (id === "transit") views.P2 = { ring: "bad", bubble: { text: `no SR-MPLS: ${VPN_LABEL}?`, tone: "bad" } };
    if (id === "transit6") views.P2 = { ring: "hit", bubble: { text: "IPv6 route → PE2", tone: "yes" } };
    if (id === "tilfa") views.P4 = { bubble: { text: "my path to P2: via P1!", tone: "warn" } };
    if (id === "mplsrep") movers = <>{go("P1", "P3", { label: `[${nodeLbl("P4")}, ${ADJ}, ${N2}, ${VPN_LABEL}]`, key: "1", color: "amber" })}{go("P4", "P2", { label: `[${N2}, ${VPN_LABEL}]`, key: "2", delay: 900 })}</>;
    if (id === "srv6rep") movers = <>{go("P1", "P3", { label: `DA ${short(EX)} › ${short(DT4)}`, key: "1", color: "amber" })}{go("P4", "P2", { label: `DA ${short(DT4)}`, key: "2", delay: 900, color: "violet" })}</>;
    if (id === "mtu") views.P1 = { ring: "bad", bubble: { text: `${BIG + D6.peakOverhead} B > 1500`, tone: "bad" } };
    if (id === "incident") views.PE2 = { ring: "bad", bubble: { text: "locator not in IS-IS", tone: "bad" } };
    if (id === "why") views.PE1 = { ring: "bad", bubble: { text: "no route to …:2::/64", tone: "bad" } };
    if (id === "fix") views.PE2 = { ring: "hit", bubble: { text: "locator MAIN advertised", tone: "yes" } };
    return (
      <>
        {head}
        <Topo nodes={FIT.nodes} links={links} views={views} ratio={52} minH={FIT.minH}>
          {movers}
        </Topo>
        {movers && <ReplayButton onClick={replay} />}
      </>
    );
  }
  switch (id) {
    case "bytes":
      return (
        <>
          {head}
          <MiniTable title="CUST-A, computed by the lab" cols={["", "SR-MPLS", "SRv6"]} rows={[{ cells: ["Encapsulation", `${WM.overhead} B`, `${W6.overhead} B`], state: "hit" }, { cells: ["During P1's repair", `${DM.peakOverhead} B`, `${D6.peakOverhead} B`] }, { cells: [`${BIG}-byte packet, repaired`, `${BIG + DM.peakOverhead} B`, `${BIG + D6.peakOverhead} B`] }, { cells: ["Transit needs", "a label entry", "an IPv6 route"] }]} />
        </>
      );
    case "choose":
      return (
        <>
          {head}
          <MiniTable title="Typical drivers" cols={["Favors SR-MPLS", "Favors SRv6"]} rows={[{ cells: ["Existing MPLS hardware and operations", "IPv6-native core, no MPLS anywhere"] }, { cells: ["Smallest header, tight MTU", "Transit that knows nothing about SR"] }, { cells: ["Mature LDP interworking", "Service + transport in one address"], state: "hit" }, { cells: ["", "Compression (uSID) to cut the overhead"] }]} />
        </>
      );
    case "verify":
      return (
        <>
          {head}
          <MiniTable title="IOS XR" cols={["Question", "Command"]} rows={[{ cells: ["Label or SID for the VPN?", "show bgp vpnv4 unicast vrf CUST-A <pfx>"] }, { cells: ["What does PE1 push?", "show cef vrf CUST-A <ip>"] }, { cells: ["Label path, backup?", "show mpls forwarding labels <n>"] }, { cells: ["Locator advertised?", "show isis segment-routing srv6 locators"] }, { cells: ["SRv6 backup?", "show isis fast-reroute <locator> detail"] }]} />
        </>
      );
    case "recap":
      return (
        <>
          {head}
          <Chain k="recap" items={[{ t: "One IGP, two instruction sets" }, { t: "SR-MPLS: 4-byte labels, every hop programs them", tone: "cyan" }, { t: "SRv6: one IPv6 address, transit just routes", tone: "violet" }, { t: "The egress PE picks the plane for a VPN", tone: "amber" }, { t: "Each plane needs its own reachability", tone: "green" }]} />
        </>
      );
  }
  return head;
}

export function DpPresentation({ open, onClose, onFinish, finishLabel }: { open: boolean; onClose: () => void; onFinish: () => void; finishLabel: string }) {
  const [play, setPlay] = useState(0);
  return (
    <LessonPresentation
      open={open}
      onClose={onClose}
      title="SR-MPLS vs SRv6, from zero"
      kicker="Learn · the SR-MPLS vs SRv6 presentation"
      steps={STEPS}
      visual={(s) => VISUAL[s.id as Id]}
      renderStage={(s) => <Deck step={s as Step} play={play} replay={() => setPlay((p) => p + 1)} />}
      finish={{ label: finishLabel, onClick: onFinish }}
      skip={{ label: "Skip →", onClick: onFinish }}
    />
  );
}
