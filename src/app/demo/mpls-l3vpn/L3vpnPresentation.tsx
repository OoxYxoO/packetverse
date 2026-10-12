"use client";

import { useState, type ReactNode } from "react";
import { LessonPresentation } from "@/components/presentation/LessonPresentation";
import { Mover, StageHead, type DeckStep } from "@/components/presentation/ScrollyDeck";
import { Chain, Compare, MiniTable, ReplayButton, Token, Topo, nodeAt, short, type TopoLink, type TopoNode, type TopoView } from "@/components/presentation/Visuals";
import { useFitNodes } from "@/components/presentation/fitNarrow";

/**
 * MPLS L3VPN — the presentation before the lesson and the L3VPN Lab. Builds on MPLS/LDP (transport labels) and BGP.
 * Same routers, customers, RDs, route targets and labels (IOS XR numbering) as the lab. Presentation state only.
 */

type Id = "two" | "overlap" | "global" | "vrf" | "iface" | "between" | "mpbgp" | "rd" | "rt" | "rdrt" | "label" | "route" | "lookup" | "stack" | "core" | "bgpfree" | "extranet" | "breaks" | "verify" | "trouble" | "recap";
type Step = DeckStep & { id: Id };
const B = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;

const STEPS: Step[] = [
  { id: "two", chapter: "The problem", title: "One provider, two customers.", body: <p>CUST-A and CUST-B each have two sites. Site 1 connects to the provider&apos;s router PE1, site 2 to PE2. Between them sits the provider core you built in the MPLS lesson: P1 and P2, running IS-IS and LDP.</p> },
  { id: "overlap", chapter: "The problem", title: "They use the same addresses.", body: <p>Both customers number site 1 <B>10.1.1.0/24</B> and site 2 <B>10.2.2.0/24</B> — private addresses, chosen without asking anyone. The provider must carry both and never mix them.</p> },
  { id: "global", chapter: "The problem", title: "One table can't hold both.", body: <p>If PE1 put every customer route in one routing table, it would have two different 10.2.2.0/24 routes. Only one can win — and one customer&apos;s packets would land at the other customer&apos;s site.</p> },
  { id: "vrf", chapter: "VRFs", title: "A routing table per customer.", body: <p>A PE keeps a separate table for each customer: a <B>VRF</B> (VPN routing and forwarding instance). VRF CUST-A and VRF CUST-B each hold their own 10.2.2.0/24 — they never meet.</p> },
  { id: "iface", chapter: "VRFs", title: "The interface decides the table.", body: <p>Each customer-facing interface belongs to one VRF. A packet from CE1B arrives on PE1&apos;s ge-0/0/2, which is in VRF CUST-B — so PE1 looks it up in CUST-B&apos;s table and nowhere else.</p> },
  { id: "between", chapter: "Between the PEs", title: "PE1 must learn what PE2 knows.", body: <p>PE2 learns 10.2.2.0/24 from each customer&apos;s site 2. PE1 needs those routes in the right VRFs. The P routers shouldn&apos;t carry them: customer routes would multiply in the core, and they overlap anyway.</p> },
  { id: "mpbgp", chapter: "Between the PEs", title: "One BGP session carries every customer.", body: <p>PE1 and PE2 run iBGP between their loopbacks (1.1.1.1 and 4.4.4.4) with the <B>VPNv4</B> address family — multiprotocol BGP. One session carries every VRF&apos;s routes. P1 and P2 run no BGP at all.</p> },
  { id: "rd", chapter: "RD and RT", title: "The RD makes each route unique.", body: <p>Before advertising, PE2 puts the VRF&apos;s <B>route distinguisher</B> in front of the prefix: CUST-A&apos;s becomes 65001:102:10.2.2.0/24, CUST-B&apos;s 65001:202:10.2.2.0/24. Two different VPNv4 routes — BGP no longer sees a conflict.</p> },
  { id: "rt", chapter: "RD and RT", title: "The RT decides where a route lands.", body: <p>Each route also carries a <B>route target</B>, an extended community: CUST-A exports 65001:100, CUST-B 65001:200. PE1&apos;s VRF CUST-A imports routes tagged 65001:100 — so CUST-A&apos;s route lands in CUST-A&apos;s table.</p> },
  { id: "rdrt", chapter: "RD and RT", title: "Two different jobs.", body: <p>The RD only keeps routes apart inside BGP. The RT alone decides which VRFs import a route. Change an import RT and routes go to the wrong customer — the RD won&apos;t stop it.</p> },
  { id: "label", chapter: "The VPN label", title: "PE2 picks a label for the VRF.", body: <p>With each route PE2 advertises a <B>VPN label</B> it chose: 24002 for CUST-A&apos;s 10.2.2.0/24, 24012 for CUST-B&apos;s. When a packet arrives later with 24002, PE2 knows: CUST-A.</p> },
  { id: "route", chapter: "The VPN label", title: "A VPNv4 route, field by field.", body: <p>Everything PE1 needs is in one BGP update: the RD, the prefix, the next hop (PE2&apos;s loopback), the route target and the VPN label.</p> },
  { id: "lookup", chapter: "Forwarding", title: "PE1 looks in the customer's table.", body: <p>CE1A sends to 10.2.2.20. The packet arrives in VRF CUST-A, which says: 10.2.2.0/24 via <B>4.4.4.4</B>, VPN label <B>24002</B>. But 4.4.4.4 is across the core.</p> },
  { id: "stack", chapter: "Forwarding", title: "Two labels: the VPN label, then the transport label.", body: <p>PE1 pushes 24002 first, then the transport label toward 4.4.4.4 on top — <B>24102</B>, the label P1 gave it through LDP, as in the MPLS lesson.</p> },
  { id: "core", chapter: "Forwarding", title: "The core switches the top label only.", body: <p>P1 swaps 24102 → 24203. P2 is the penultimate hop and pops the transport label (PHP). PE2 receives just <B>24002</B>, picks VRF CUST-A and forwards to CE2A.</p> },
  { id: "bgpfree", chapter: "Forwarding", title: "The core knows nothing about customers.", body: <p>P1 and P2 only know loopbacks and their labels. The VPN label sits underneath, where they never look. That is why the transport LSP must be complete: if it breaks, every VPN breaks — even with BGP up.</p> },
  { id: "extranet", chapter: "Sharing on purpose", title: "Route targets can share routes too.", body: <p>CE2S offers a service in VRF SHARED (RT 65001:900). Make CUST-A&apos;s VRFs import 65001:900, and SHARED import 65001:100 so the replies can come back. CUST-B imports neither, and still can&apos;t reach it.</p> },
  { id: "breaks", chapter: "When it breaks", title: "Five ways an L3VPN fails.", body: <p>A wrong import RT, a neighbor without VPNv4, a static route to the wrong CE address, a broken transport LSP, a port left out of its VRF.</p> },
  { id: "verify", chapter: "Verify", title: "The questions engineers ask.", body: <p>Is the port in its VRF? Is VPNv4 up? Which VPNv4 routes arrived, with which RT and label? Did the VRF import them? Which labels does PE1 push?</p> },
  { id: "trouble", chapter: "Troubleshooting", title: "Walk the ladder.", body: <p>Start at the failing ping and climb: the first rung that is wrong names the layer. Fix one thing, then prove it with a fresh ping.</p> },
  { id: "recap", chapter: "The whole idea", title: "Separate tables, one BGP session, two labels.", body: <p>Now watch it in the lesson, then break and fix it in the L3VPN Lab.</p> },
];
const VISUAL: Record<Id, string> = Object.fromEntries(STEPS.map((s) => [s.id, ["rdrt", "route", "breaks", "verify", "trouble", "recap"].includes(s.id) ? s.id : "topo"])) as Record<Id, string>;

const NODES: TopoNode[] = [
  { id: "CE1A", label: "CE1A", sub: "10.1.1.0/24", sub2: "CUST-A", icon: "CE", x: 9, y: 16 },
  { id: "CE1B", label: "CE1B", sub: "10.1.1.0/24", sub2: "CUST-B", icon: "CE", x: 9, y: 84 },
  { id: "PE1", label: "PE1", sub: "1.1.1.1", icon: "PE", x: 26, y: 50 },
  { id: "P1", label: "P1", sub: "2.2.2.2", icon: "P", x: 43, y: 50 },
  { id: "P2", label: "P2", sub: "3.3.3.3", icon: "P", x: 60, y: 50 },
  { id: "PE2", label: "PE2", sub: "4.4.4.4", icon: "PE", x: 77, y: 50 },
  { id: "CE2A", label: "CE2A", sub: "10.2.2.0/24", sub2: "CUST-A", icon: "CE", x: 91, y: 16 },
  { id: "CE2S", label: "CE2S", sub: "10.9.9.0/24", sub2: "SHARED", icon: "CE", x: 91, y: 50 },
  { id: "CE2B", label: "CE2B", sub: "10.2.2.0/24", sub2: "CUST-B", icon: "CE", x: 91, y: 84 },
];
const CORE = ["PE1", "P1", "P2", "PE2"];
const ALL: [string, string][] = [["CE1A", "PE1"], ["CE1B", "PE1"], ["PE1", "P1"], ["P1", "P2"], ["P2", "PE2"], ["PE2", "CE2A"], ["PE2", "CE2S"], ["PE2", "CE2B"]];
const pairs = (p: string[]) => p.slice(1).map((x, i) => [p[i], x] as [string, string]);
const onPath = (p: string[], a: string, b: string) => pairs(p).some(([x, y]) => (x === a && y === b) || (x === b && y === a));
const A_PATH = ["CE1A", "PE1", "P1", "P2", "PE2", "CE2A"];

function Deck({ step: s, play, replay }: { step: Step; play: number; replay: () => void }) {
  const FIT = useFitNodes(NODES, 330);
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
  const along = (p: string[], label: (i: number) => string, color: string, start = 0, step = 650, key = "a") => pairs(p).map(([a, b], i) => go(a, b, { label: label(i), key: `${key}${i}`, delay: start + i * step, color }));

  if (VISUAL[id] === "topo") {
    const lit = ["lookup", "stack", "core"].includes(id) ? A_PATH : id === "iface" ? ["CE1B", "PE1"] : id === "mpbgp" || id === "bgpfree" ? CORE : [];
    const links: TopoLink[] = ALL.map(([a, b]) => {
      let state: TopoLink["state"] = onPath(lit, a, b) ? "active" : "up";
      if (id === "extranet" && (b === "CE2S" || a === "CE2S")) state = "active";
      if (id === "bgpfree" && a === "P1" && b === "P2") state = "standby";
      return { a, b, state };
    });
    const views: Record<string, TopoView> = {};
    let movers: ReactNode = null;
    if (id === "two") {
      views.P1 = { bubble: { text: "IS-IS + LDP", tone: "info" } };
    }
    if (id === "overlap") {
      views.CE2A = { ring: "on", bubble: { text: "10.2.2.0/24", tone: "warn" } };
      views.CE2B = { ring: "on", bubble: { text: "10.2.2.0/24 too", tone: "warn", delay: 400 } };
    }
    if (id === "global") {
      views.PE1 = { ring: "bad", bubble: { text: "10.2.2.0/24 → CUST-A or CUST-B?", tone: "bad" } };
      movers = <>{go("CE1B", "PE1", { label: "to 10.2.2.20", key: "1", color: "amber" })}</>;
    }
    if (id === "vrf") {
      views.PE1 = { ring: "on", bubble: { text: "VRF CUST-A · VRF CUST-B", tone: "yes" } };
      views.PE2 = { ring: "on", bubble: { text: "CUST-A · CUST-B · SHARED", tone: "yes", delay: 400 } };
    }
    if (id === "iface") {
      movers = <>{go("CE1B", "PE1", { label: "to 10.2.2.20", key: "1", color: "amber" })}</>;
      views.PE1 = { ring: "on", bubble: { text: "arrived on ge-0/0/2 → VRF CUST-B", tone: "yes", delay: 900 } };
    }
    if (id === "between") {
      views.PE2 = { bubble: { text: "knows both 10.2.2.0/24", tone: "info" } };
      views.PE1 = { bubble: { text: "needs them, per VRF", tone: "ask", delay: 400 } };
    }
    if (id === "mpbgp") {
      movers = <>{go("PE2", "PE1", { label: "VPNv4 update", key: "1", color: "violet" })}</>;
      views.PE1 = { bubble: { text: "iBGP VPNv4 with 4.4.4.4", tone: "info" } };
    }
    if (id === "rd") {
      movers = (
        <>
          {go("PE2", "PE1", { label: "65001:102:10.2.2.0/24", key: "1", color: "violet" })}
          {go("PE2", "PE1", { label: "65001:202:10.2.2.0/24", key: "2", delay: 900, color: "amber" })}
        </>
      );
    }
    if (id === "rt") {
      movers = <>{go("PE2", "PE1", { label: "RT 65001:100", key: "1", color: "violet" })}</>;
      views.PE1 = { bubble: { text: "CUST-A imports 65001:100 ✓ · CUST-B ✗", tone: "yes", delay: 900 } };
    }
    if (id === "label") {
      views.PE2 = { ring: "on", bubble: { text: "CUST-A 24002 · CUST-B 24012", tone: "info" } };
      movers = <>{go("PE2", "PE1", { label: "label 24002", key: "1", color: "violet" })}</>;
    }
    if (id === "lookup") {
      movers = <>{go("CE1A", "PE1", { label: "to 10.2.2.20", key: "1", color: "green" })}</>;
      views.PE1 = { ring: "on", bubble: { text: "VRF CUST-A: via 4.4.4.4, label 24002", tone: "info", delay: 900 } };
    }
    if (id === "stack") {
      movers = <>{go("CE1A", "PE1", { label: "IP", key: "1", color: "green" })}{go("PE1", "P1", { label: "24102 | 24002 | IP", key: "2", delay: 900, color: "violet" })}</>;
    }
    if (id === "core") {
      movers = <>{along(A_PATH, (i) => ["IP", "24102 | 24002", "24203 | 24002", "24002", "IP"][i], "violet")}</>;
      views.P2 = { badge: { text: "PHP", tone: "warn" } };
      views.PE2 = { bubble: { text: "24002 → VRF CUST-A", tone: "yes", delay: 2600 } };
    }
    if (id === "bgpfree") {
      views.P1 = { bubble: { text: "no BGP, no VRFs", tone: "info" } };
    }
    if (id === "extranet") {
      movers = <>{along(["CE1A", "PE1", "P1", "P2", "PE2", "CE2S"], () => "to 10.9.9.10", "green")}</>;
      views.CE2S = { bubble: { text: "SHARED · RT 65001:900", tone: "yes", delay: 3200 } };
      views.CE1B = { ring: "dim", bubble: { text: "CUST-B: no route", tone: "no" } };
    }
    return (
      <>
        {head}
        <Topo nodes={FIT.nodes} links={links} views={views} ratio={52} minH={FIT.minH} showSub2>
          {movers}
        </Topo>
        {movers && <ReplayButton onClick={replay} />}
      </>
    );
  }

  switch (id) {
    case "rdrt":
      return (
        <>
          {head}
          <Compare items={[{ title: "Route distinguisher", tone: "violet", body: "65001:102 — makes CUST-A's 10.2.2.0/24 a different BGP route from CUST-B's. Decides nothing about import." }, { title: "Route target", tone: "cyan", body: "65001:100 — an extended community. A VRF installs a route only if it imports one of the route's RTs." }]} />
        </>
      );
    case "route":
      return (
        <>
          {head}
          <MiniTable title="PE2 → PE1 · one VPNv4 route" cols={["Field", "Value", "Meaning"]} rows={[{ cells: ["RD", "65001:102", "keeps it apart from CUST-B's 10.2.2.0/24"] }, { cells: ["Prefix", "10.2.2.0/24", "CUST-A site 2"] }, { cells: ["Next hop", "4.4.4.4", "PE2's loopback — reached through the LSP"] }, { cells: ["Route target", "65001:100", "import into CUST-A's VRFs"], state: "hit" }, { cells: ["VPN label", "24002", "PE2's label for this route"] }]} />
        </>
      );
    case "breaks":
      return (
        <>
          {head}
          <MiniTable title="How an L3VPN fails" cols={["Fault", "What you see"]} rows={[{ cells: ["Wrong import RT", "VPNv4 route arrives, the VRF doesn't install it"], state: "hit" }, { cells: ["Neighbor without VPNv4", "BGP Established, no VPNv4 routes"] }, { cells: ["Static route to the wrong CE address", "route advertised, ARP fails at the PE"] }, { cells: ["Transport LSP broken", "routes everywhere, packets dropped in the core"] }, { cells: ["Port left out of the VRF", "the customer's packets reach the global table"] }]} />
        </>
      );
    case "verify":
      return (
        <>
          {head}
          <div className="grid gap-2 sm:grid-cols-2">
            <MiniTable title="IOS XR" cols={["Question", "Command"]} rows={[{ cells: ["VRFs, RDs, RTs?", "show vrf all"] }, { cells: ["VPNv4 up?", "show bgp vpnv4 unicast summary"] }, { cells: ["Routes in the VRF?", "show route vrf CUST-A"] }, { cells: ["Labels pushed?", "show cef vrf CUST-A 10.2.2.20"] }]} />
            <MiniTable title="Junos" cols={["Question", "Command"]} rows={[{ cells: ["VPN routes received?", "show route table bgp.l3vpn.0 detail"] }, { cells: ["VPNv4 up?", "show bgp summary"] }, { cells: ["Routes in the VRF?", "show route table CUST-A.inet.0"] }, { cells: ["LSP to PE2?", "show route table inet.3"] }]} />
          </div>
        </>
      );
    case "trouble":
      return (
        <>
          {head}
          <Chain k="trouble" items={[{ t: "Fresh ping: does it fail, and where?", tone: "plain" }, { t: "Is the CE port in its VRF?", tone: "cyan" }, { t: "Is the VPNv4 session up on both sides?", tone: "violet" }, { t: "Does each VRF have the remote prefix (RT import)?", tone: "violet" }, { t: "Is the transport LSP to the remote PE complete?", tone: "amber" }, { t: "Fix one thing, ping again", tone: "green" }]} />
        </>
      );
    case "recap":
      return (
        <>
          {head}
          <Chain k="recap" items={[{ t: "A VRF per customer; the interface picks the table" }, { t: "MP-BGP VPNv4 between the PE loopbacks carries every VRF's routes", tone: "cyan" }, { t: "The RD keeps routes unique; the RT decides import", tone: "violet" }, { t: "Two labels: the VPN label underneath, the transport label on top", tone: "amber" }, { t: "The core runs no BGP — but its LSP must be complete", tone: "green" }]} />
        </>
      );
  }
  return head;
}

export function L3vpnPresentation({ open, onClose, onFinish, finishLabel }: { open: boolean; onClose: () => void; onFinish: () => void; finishLabel: string }) {
  const [play, setPlay] = useState(0);
  return (
    <LessonPresentation
      open={open}
      onClose={onClose}
      title="MPLS L3VPN, from zero"
      kicker="Learn · the L3VPN presentation"
      steps={STEPS}
      visual={(s) => VISUAL[s.id as Id]}
      renderStage={(s) => <Deck step={s as Step} play={play} replay={() => setPlay((p) => p + 1)} />}
      finish={{ label: finishLabel, onClick: onFinish }}
      skip={{ label: "Skip →", onClick: onFinish }}
    />
  );
}
