"use client";

import { useState, type ReactNode } from "react";
import { LessonPresentation } from "@/components/presentation/LessonPresentation";
import { Mover, StageHead, type DeckStep } from "@/components/presentation/ScrollyDeck";
import { Chain, Compare, MiniTable, ReplayButton, Token, Topo, nodeAt, short, type TopoLink, type TopoNode, type TopoView } from "@/components/presentation/Visuals";
import { useFitNodes } from "@/components/presentation/fitNarrow";

/**
 * SRv6 L3VPN — the presentation before the lesson and the lab. Same network, VRFs, routes and SIDs as the lab
 * (IOS XR): CUST-A at CE1/CE2/CE3, CUST-B at CE4/CE5, PE1/PE2 over an IPv6 core, RR1. Presentation state only.
 */

type Id = "problem" | "overlap" | "roles" | "vrf" | "ingress" | "learn" | "vpnroute" | "rd" | "rt" | "sid" | "twoaddr" | "rr" | "install" | "send" | "encap" | "core" | "egress" | "deliver" | "samesid" | "v6" | "dx" | "incident" | "compare" | "breaks" | "verify" | "recap";
type Step = DeckStep & { id: Id };
const B = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;
const M = ({ children }: { children: ReactNode }) => <span className="pv-mono text-pv-text">{children}</span>;

const STEPS: Step[] = [
  { id: "problem", chapter: "The question", title: "Many customers, one network.", body: <p>A provider connects the sites of many companies over one shared core. Each company wants what looks like its own private IP network — and must never see anyone else&apos;s traffic.</p> },
  { id: "overlap", chapter: "The question", title: "And they reuse the same addresses.", body: <p>CUST-A&apos;s headquarters uses <M>10.10.1.0/24</M>; so does CUST-B&apos;s. Both have a second site on <M>10.20.1.0/24</M>. Private addressing means overlap is normal — the provider has to keep them apart anyway.</p> },
  { id: "roles", chapter: "Who does what", title: "CE, PE, P.", body: <p><B>CE</B>: the customer&apos;s router — ordinary IP, a default route to the provider. <B>PE</B>: the provider edge, where all VPN work happens. <B>P</B>: the core — it only moves IPv6 packets between PEs and never learns a customer route.</p> },
  { id: "vrf", chapter: "Separation", title: "One table per customer.", body: <p>Each PE keeps a separate routing table per customer: a <B>VRF</B>. PE1 has CUST-A and CUST-B; in each, <M>10.20.1.0/24</M> points somewhere different.</p> },
  { id: "ingress", chapter: "Separation", title: "The interface picks the table.", body: <p>A packet from CE1 arrives on an interface in VRF CUST-A, so PE1 looks it up in CUST-A. The same destination from CE4 is looked up in CUST-B. Nothing in the packet says which customer it is — the port does.</p> },
  { id: "learn", chapter: "The control plane", title: "PE2 learns its customer's route.", body: <p>PE2 has a static route in CUST-A: <M>10.20.1.0/24</M> via CE2. Now PE1 must learn it too — without the core ever carrying customer routes.</p> },
  { id: "vpnroute", chapter: "The control plane", title: "It becomes a VPN route.", body: <p>PE2 redistributes it into BGP as a <B>VPNv4 route</B>, with the attributes the far side needs: a route distinguisher, a route target, a next hop — and a service SID.</p> },
  { id: "rd", chapter: "The control plane", title: "The RD keeps it unique.", body: <p>CUST-A&apos;s 10.20.1.0/24 travels as <M>65000:2:10.20.1.0/24</M>; CUST-B&apos;s as <M>65000:12:10.20.1.0/24</M>. Two different routes in BGP. The RD does nothing else.</p> },
  { id: "rt", chapter: "The control plane", title: "The RT decides who imports it.", body: <p>CUST-A&apos;s routes carry route target <M>65000:100</M>; CUST-B&apos;s <M>65000:200</M>. PE1&apos;s CUST-A imports 65000:100 only — that is what keeps customers apart across the network.</p> },
  { id: "sid", chapter: "The SRv6 part", title: "And a service SID.", body: <p>Instead of an MPLS VPN label, PE2 attaches an SRv6 <B>service SID</B> in the BGP Prefix-SID attribute: <M>2001:db8:100:2:41::</M>, <B>End.DT4</B> for VRF CUST-A. It means “send it here, and I will look it up in CUST-A.”</p> },
  { id: "twoaddr", chapter: "The SRv6 part", title: "Two addresses, two jobs.", body: <p>The <B>next hop</B> is PE2&apos;s loopback <M>2001:db8:ffff::2</M> — BGP checks it is reachable. The <B>SID</B> lives in PE2&apos;s locator <M>2001:db8:100:2::/64</M> — packets are routed toward it. Different prefixes, both carried by IS-IS.</p> },
  { id: "rr", chapter: "The control plane", title: "RR1 reflects it.", body: <p>The PEs don&apos;t peer with each other; both peer with route reflector RR1, which passes VPNv4 and VPNv6 routes along unchanged. RR1 is control plane only — customer packets never go through it.</p> },
  { id: "install", chapter: "The control plane", title: "PE1 checks three things.", body: <p>The RT matches CUST-A&apos;s import → <B>imported</B>. The next hop is reachable. The SID&apos;s locator is in the IPv6 table. Only then is <M>10.20.1.0/24</M> installed in CUST-A, pointing at the SID.</p> },
  { id: "send", chapter: "The data plane", title: "CE1 sends an ordinary packet.", body: <p>A host at CE1 pings <M>10.20.1.10</M>. CE1 knows nothing about VPNs: it sends a plain IPv4 packet to its default route, PE1.</p> },
  { id: "encap", chapter: "The data plane", title: "PE1 wraps it in IPv6.", body: <p>CUST-A lookup → via the SID. PE1 adds an outer IPv6 header with destination <M>2001:db8:100:2:41::</M> (H.Encaps.Red). One SID needs no routing header at all.</p> },
  { id: "core", chapter: "The data plane", title: "The core just routes IPv6.", body: <p>P1 and P2 see an IPv6 packet whose destination falls in <M>2001:db8:100:2::/64</M> — PE2&apos;s locator — and forward it. No VRFs, no labels, no customer routes.</p> },
  { id: "egress", chapter: "The data plane", title: "PE2 executes the SID.", body: <p>The destination is in PE2&apos;s local SID table: End.DT4, VRF CUST-A. PE2 removes the outer header and looks <M>10.20.1.10</M> up in CUST-A → CE2.</p> },
  { id: "deliver", chapter: "The data plane", title: "CE2 sees ordinary IP.", body: <p>The packet leaves PE2 exactly as CE1 sent it. To the customer the whole provider looks like one router hop. The reply makes the same trip back, to PE1&apos;s own End.DT4.</p> },
  { id: "samesid", chapter: "One SID, many prefixes", title: "One SID for the whole VRF.", body: <p>CE3&apos;s <M>10.20.2.0/24</M> is advertised with the same SID. PE2 decapsulates and the CUST-A lookup picks CE3. A per-VRF SID never names the CE — the table does.</p> },
  { id: "v6", chapter: "One SID, many prefixes", title: "IPv6 has its own family and SID.", body: <p>CUST-A is dual-stack. Its IPv6 routes travel as <B>VPNv6</B> with PE2&apos;s <B>End.DT6</B> <M>…:2:42::</M>. Each family can work — or break — on its own.</p> },
  { id: "dx", chapter: "One SID, many prefixes", title: "Or one SID per CE.", body: <p>With <M>alloc mode per-ce</M> PE2 allocates an <B>End.DX4</B> per CE: decapsulate and send straight to that CE, no lookup. More SIDs, no egress lookup.</p> },
  { id: "incident", chapter: "When it breaks", title: "Next hop up, service down.", body: <p>PE2&apos;s locator leaves IS-IS; its loopback stays. BGP stays up and PE1 still receives the route with its SID — but there is no route to the SID, so PE1 installs nothing. The guided lesson&apos;s incident.</p> },
  { id: "compare", chapter: "Where it fits", title: "MPLS L3VPN vs SRv6 L3VPN.", body: <p>Same service model, different data plane.</p> },
  { id: "breaks", chapter: "When it breaks", title: "Every rung can fail.", body: <p>The customer route, the VPN route and its SID, the session&apos;s families, the import, the SID&apos;s reachability, the way back.</p> },
  { id: "verify", chapter: "Verify", title: "The questions engineers ask.", body: <p>Is the route in the VRF? Is the VPN route there, with which RT and SID? Do the sessions carry the family? Is the locator reachable? What does CEF push?</p> },
  { id: "recap", chapter: "The whole idea", title: "VPN in BGP, service in the SID.", body: <p>Now follow it in the lesson, then break and fix it in the SRv6 L3VPN Lab.</p> },
];
const VISUAL: Record<Id, string> = Object.fromEntries(STEPS.map((s) => [s.id, ["compare", "breaks", "verify", "recap"].includes(s.id) ? s.id : "topo"])) as Record<Id, string>;

const NODES: TopoNode[] = [
  { id: "CE1", label: "CE1", sub: "A · 10.10.1.0/24", icon: "CE", x: 6, y: 24 },
  { id: "CE4", label: "CE4", sub: "B · 10.10.1.0/24", icon: "CE", x: 6, y: 78 },
  { id: "PE1", label: "PE1", sub: "VRFs A, B", icon: "PE", x: 23, y: 50 },
  { id: "P1", label: "P1", sub: "IPv6 only", icon: "P", x: 42, y: 50 },
  { id: "RR1", label: "RR1", sub: "reflector", icon: "P", x: 52, y: 14 },
  { id: "P2", label: "P2", sub: "IPv6 only", icon: "P", x: 62, y: 50 },
  { id: "PE2", label: "PE2", sub: "VRFs A, B", icon: "PE", x: 79, y: 50 },
  { id: "CE2", label: "CE2", sub: "A · 10.20.1.0/24", icon: "CE", x: 95, y: 20 },
  { id: "CE3", label: "CE3", sub: "A · 10.20.2.0/24", icon: "CE", x: 95, y: 50 },
  { id: "CE5", label: "CE5", sub: "B · 10.20.1.0/24", icon: "CE", x: 95, y: 80 },
];
const LINKS: [string, string][] = [["CE1", "PE1"], ["CE4", "PE1"], ["PE1", "P1"], ["P1", "P2"], ["P2", "PE2"], ["P1", "RR1"], ["PE2", "CE2"], ["PE2", "CE3"], ["PE2", "CE5"]];
const FWD = new Set(["CE1-PE1", "PE1-P1", "P1-P2", "P2-PE2", "PE2-CE2"]);
const CORE = new Set(["PE1-P1", "P1-P2", "P2-PE2"]);
const CTRL = new Set(["P1-RR1"]);

function Deck({ step: s, play, replay }: { step: Step; play: number; replay: () => void }) {
  const FIT = useFitNodes(NODES, 300);
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
    const hot = ["send", "encap", "core", "egress", "deliver"].includes(id) ? FWD : id === "samesid" ? new Set([...CORE, "CE1-PE1", "PE2-CE3"]) : id === "rr" ? new Set(["P1-RR1", ...CORE]) : id === "core" || id === "twoaddr" ? CORE : id === "incident" ? CORE : new Set<string>();
    const links: TopoLink[] = LINKS.map(([a, b]) => {
      const key = `${a}-${b}`;
      return { a, b, state: (hot.has(key) ? "active" : hot.size ? "dim" : "up") as TopoLink["state"], label: CTRL.has(key) ? "BGP" : "" };
    });
    const views: Record<string, TopoView> = {};
    let movers: ReactNode = null;
    if (id === "problem") views.P1 = { bubble: { text: "one shared core", tone: "info" } };
    if (id === "overlap") {
      views.CE1 = { ring: "hit" };
      views.CE4 = { ring: "hit", bubble: { text: "same 10.10.1.0/24", tone: "warn" } };
    }
    if (id === "roles") {
      views.PE1 = { bubble: { text: "VPN work here", tone: "info" } };
      views.P2 = { bubble: { text: "IPv6 only", tone: "info", delay: 300 } };
    }
    if (id === "vrf") views.PE1 = { ring: "hit", bubble: { text: "CUST-A · CUST-B", tone: "info" } };
    if (id === "ingress") views.CE4 = { bubble: { text: "port → CUST-B", tone: "yes" } };
    if (id === "learn") views.PE2 = { bubble: { text: "static → CE2", tone: "info" } };
    if (id === "vpnroute") movers = <>{go("PE2", "P2", { label: "VPNv4 route", key: "1", color: "amber" })}</>;
    if (id === "rd") views.PE2 = { bubble: { text: "65000:2 vs 65000:12", tone: "info" } };
    if (id === "rt") views.PE1 = { bubble: { text: "CUST-A imports 65000:100", tone: "yes" } };
    if (id === "sid") views.PE2 = { ring: "hit", bubble: { text: "End.DT4 …:2:41::", tone: "yes" } };
    if (id === "twoaddr") views.PE2 = { bubble: { text: "loopback ≠ locator", tone: "info" } };
    if (id === "rr") movers = <>{go("PE2", "RR1", { label: "update", key: "1", color: "amber" })}{go("RR1", "PE1", { label: "reflected", key: "2", delay: 900, color: "amber" })}</>;
    if (id === "install") views.PE1 = { ring: "hit", bubble: { text: "RT ✓ next hop ✓ SID ✓", tone: "yes" } };
    if (id === "send") movers = <>{go("CE1", "PE1", { label: "IPv4 → 10.20.1.10", key: "1", color: "green" })}</>;
    if (id === "encap") movers = <>{go("PE1", "P1", { label: "DA …:2:41::", key: "1", color: "violet" })}</>;
    if (id === "core") movers = <>{go("P1", "P2", { label: "DA …:2:41::", key: "1", color: "violet" })}{go("P2", "PE2", { label: "DA …:2:41::", key: "2", delay: 800, color: "violet" })}</>;
    if (id === "egress") views.PE2 = { bubble: { text: "End.DT4 → CUST-A", tone: "yes" } };
    if (id === "deliver") movers = <>{go("PE2", "CE2", { label: "IPv4", key: "1", color: "green" })}</>;
    if (id === "samesid") views.CE3 = { bubble: { text: "same SID", tone: "yes" } };
    if (id === "v6") views.PE2 = { bubble: { text: "End.DT6 …:2:42::", tone: "info" } };
    if (id === "dx") views.PE2 = { bubble: { text: "End.DX4 per CE", tone: "info" } };
    if (id === "incident") {
      views.P2 = { ring: "bad", bubble: { text: "no route to …:2::/64", tone: "bad" } };
      views.RR1 = { bubble: { text: "BGP up", tone: "yes" } };
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
          <Compare items={[{ title: "Same", tone: "violet", body: "VRFs · RD · RT · MP-BGP VPNv4/VPNv6 · route reflectors" }, { title: "MPLS L3VPN", tone: "amber", body: "VPN label + transport label · LDP/SR-MPLS in the core · LFIB on every P router" }, { title: "SRv6 L3VPN", tone: "cyan", body: "one service SID (End.DT4/DT6) · plain IPv6 in the core · P routers carry only locators" }]} />
        </>
      );
    case "breaks":
      return (
        <>
          {head}
          <MiniTable title="How an SRv6 L3VPN fails" cols={["Fault", "What you see"]} rows={[{ cells: ["Locator not in the IGP", "route received, not installed"], state: "hit" }, { cells: ["Wrong export RT", "on RR1, not on the other PE"] }, { cells: ["No SRv6 for one family", "route without a SID"] }, { cells: ["Customer route not redistributed", "request arrives, reply lost"] }, { cells: ["Family not negotiated", "one family dead, the other fine"] }]} />
        </>
      );
    case "verify":
      return (
        <>
          {head}
          <MiniTable title="IOS XR" cols={["Question", "Command"]} rows={[{ cells: ["In the VRF?", "show route vrf CUST-A"] }, { cells: ["RT, next hop, SID?", "show bgp vpnv4 unicast rd <rd> <prefix>"] }, { cells: ["Families negotiated?", "show bgp vpnv4 unicast summary"] }, { cells: ["SID reachable?", "show route ipv6 <sid>"] }, { cells: ["What is pushed?", "show cef vrf CUST-A <ip>"] }]} />
        </>
      );
    case "recap":
      return (
        <>
          {head}
          <Chain k="recap" items={[{ t: "A VRF per customer; the ingress interface picks it" }, { t: "BGP carries VPN routes: RD, RT, next hop, service SID", tone: "amber" }, { t: "Install needs RT import + reachable next hop + reachable SID", tone: "violet" }, { t: "The core routes on the egress PE's locator", tone: "cyan" }, { t: "End.DT4/DT6 decapsulates and looks up in the VRF", tone: "green" }]} />
        </>
      );
  }
  return head;
}

export function SvPresentation({ open, onClose, onFinish, finishLabel }: { open: boolean; onClose: () => void; onFinish: () => void; finishLabel: string }) {
  const [play, setPlay] = useState(0);
  return (
    <LessonPresentation
      open={open}
      onClose={onClose}
      title="SRv6 L3VPN, from zero"
      kicker="Learn · the SRv6 L3VPN presentation"
      steps={STEPS}
      visual={(s) => VISUAL[s.id as Id]}
      renderStage={(s) => <Deck step={s as Step} play={play} replay={() => setPlay((p) => p + 1)} />}
      finish={{ label: finishLabel, onClick: onFinish }}
      skip={{ label: "Skip →", onClick: onFinish }}
    />
  );
}
