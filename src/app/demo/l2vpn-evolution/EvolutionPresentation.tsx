"use client";

import { useState, type ReactNode } from "react";
import { LessonPresentation } from "@/components/presentation/LessonPresentation";
import { Mover, StageHead, type DeckStep } from "@/components/presentation/ScrollyDeck";
import { Chain, Compare, MiniTable, ReplayButton, Token, Topo, nodeAt, short, type TopoLink, type TopoNode, type TopoView } from "@/components/presentation/Visuals";
import { useFitNodes } from "@/components/presentation/fitNarrow";

/**
 * L2VPN Evolution — the presentation before the lesson and the L2VPN Evolution Lab. Retells LDP VPLS and BGP VPLS on the
 * CUST-A network, then builds EVPN-MPLS on the same routers: EVI 100, RT 65000:100, Type 3 and Type 2 routes, unicast and
 * inclusive-multicast labels (IOS XR numbering, as in the lab). Presentation state only.
 */

type Id = "same" | "ldp" | "bgpvpls" | "learn" | "limits" | "idea" | "evi" | "t3" | "flood" | "t2" | "cp" | "macip" | "labels" | "wire" | "noloop" | "withdraw" | "beyond" | "compare" | "breaks" | "verify" | "trouble" | "recap";
type Step = DeckStep & { id: Id };
const B = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;

const STEPS: Step[] = [
  { id: "same", chapter: "The story", title: "One customer LAN, three generations.", body: <p>CUST-A wants one Ethernet segment across PE1, PE2 and PE3. You have built it twice already — with LDP VPLS and with BGP VPLS. This lesson builds it a third time, with <B>EVPN</B>, on the same routers, and asks what changed each time.</p> },
  { id: "ldp", chapter: "The story", title: "Generation 1: LDP VPLS.", body: <p>A bridge on every PE, a full mesh of pseudowires, and every PE listing every other PE as a neighbor. Targeted LDP signals one label per pseudowire. It works — until the list of PEs grows.</p> },
  { id: "bgpvpls", chapter: "The story", title: "Generation 2: BGP VPLS.", body: <p>BGP finds the members: each PE advertises one route with an RD, a route target, its VE ID and a label block. One session per PE to the route reflector, no neighbor statements. Still a pseudowire between every pair of PEs.</p> },
  { id: "learn", chapter: "The story", title: "Both still learn from frames.", body: <p>In both VPLS flavors, PE2 learns where CE3 is only when a frame from CE3 arrives on the pseudowire from PE3. Until then it floods. Discovery moved into BGP; <B>learning stayed in the data plane</B>.</p> },
  { id: "limits", chapter: "The story", title: "What flood-and-learn can't do well.", body: <p>A CE attached to two PEs at once, both forwarding (<B>all-active multihoming</B>): data-plane learning sees its MAC flap between them. A host that moves: the old entry lingers until it ages out. And every ARP is flooded to every site.</p> },
  { id: "idea", chapter: "Generation 3", title: "Put the MACs in BGP.", body: <p><B>EVPN</B> (RFC 7432) keeps the MPLS core and the route reflector, and moves MAC learning into the control plane: a PE learns its own CEs&apos; MACs from their frames, then advertises each one in BGP. The other PEs learn it from the route.</p> },
  { id: "evi", chapter: "Generation 3", title: "An EVI per customer LAN.", body: <p>Each PE runs <B>EVI 100</B>, the EVPN instance for CUST-A, with an RD (65000:1, :2, :3) and route target <B>65000:100</B>. Each PE&apos;s session to RR1 carries the <B>L2VPN EVPN</B> family. The P routers still know nothing about customers.</p> },
  { id: "t3", chapter: "Type 3", title: "“Flood to me, with this label.”", body: <p>Before any customer frame, every PE advertises an <B>inclusive-multicast route</B> (Type 3): its loopback, RD, RT and a label for broadcast and unknown frames. PE3&apos;s says 26011. RR1 reflects it; PE1 and PE2 import it.</p> },
  { id: "flood", chapter: "Type 3", title: "The flood list replaces the mesh.", body: <p>The PEs whose Type 3 route a PE keeps form its <B>flood list</B>. To flood, PE1 sends one copy to each — <B>ingress replication</B>. There are no pseudowires to bring up or keep up.</p> },
  { id: "t2", chapter: "Type 2", title: "“This MAC is behind me.”", body: <p>CE3 sends its first frame. PE3 learns 00:33:33:33:33:33 on its attachment circuit, like any bridge — and advertises a <B>MAC/IP route</B> (Type 2): MAC, RD, RT 65000:100, and its <B>unicast label</B> 26010.</p> },
  { id: "cp", chapter: "Type 2", title: "Everyone learns from BGP.", body: <p>RR1 reflects the route to PE1 and PE2. PE2 now knows CE3 is behind PE3 — though no frame from CE3 ever reached PE2. That is <B>control-plane learning</B>.</p> },
  { id: "macip", chapter: "Type 2", title: "MAC and IP, together.", body: <p>Once PE3 has seen CE3&apos;s ARP, it also advertises a Type 2 route with the IP: 00:33:33:33:33:33 = 192.168.100.3. A PE that knows that pair can answer ARP locally (<B>ARP suppression</B>) — a feature built on this route.</p> },
  { id: "labels", chapter: "Forwarding", title: "Two labels per PE.", body: <p>Each PE allocates a <B>unicast</B> label (in its Type 2 routes) and an <B>inclusive-multicast</B> label (in its Type 3 route). On IOS XR in this lab: PE1 24010/24011, PE2 25010/25011, PE3 26010/26011.</p> },
  { id: "wire", chapter: "Forwarding", title: "On the wire, it's still MPLS.", body: <p>CE1 pings CE3. PE1 finds CE3&apos;s MAC in its table — from PE3&apos;s Type 2 route — and pushes <B>26010</B>, then the LDP label toward 3.3.3.3. P1 swaps, P3 pops, PE3 sees its unicast label and switches the frame to CE3.</p> },
  { id: "noloop", chapter: "Forwarding", title: "Flooded frames never go back into the core.", body: <p>An ARP broadcast reaches PE2 and PE3 with their inclusive-multicast labels. That label tells them: this was flooded — deliver it to your own CEs only. VPLS needed split horizon for the same reason.</p> },
  { id: "withdraw", chapter: "Forwarding", title: "Withdrawn, not aged out.", body: <p>When PE3 forgets CE3&apos;s MAC, it <B>withdraws</B> the Type 2 route and the other PEs forget it at once. A VPLS PE would keep forwarding to the old pseudowire until the entry aged out.</p> },
  { id: "beyond", chapter: "Where it fits", title: "What this unlocks.", body: <p>Route types 1 and 4 and the <B>Ethernet Segment</B> make all-active multihoming work; sequence numbers on Type 2 handle <B>MAC mobility</B>. The same control plane carries VXLAN (the previous lesson) and point-to-point services (EVPN-VPWS). This lab stays with single-homed sites.</p> },
  { id: "compare", chapter: "Where it fits", title: "Three generations side by side.", body: <p>The core and the transport never changed. The edge did — twice.</p> },
  { id: "breaks", chapter: "When it breaks", title: "Five ways an EVPN service fails.", body: <p>A wrong route target, a missing EVPN family, a route reflector that doesn&apos;t reflect, a CE&apos;s VLAN that doesn&apos;t land in the EVI, a broken transport LSP.</p> },
  { id: "verify", chapter: "Verify", title: "The questions engineers ask.", body: <p>Does every PE exchange EVPN routes with RR1? Does every PE keep every other PE&apos;s Type 3 route? Are the remote MACs arriving as Type 2 routes? Is the LSP underneath complete?</p> },
  { id: "trouble", chapter: "Troubleshooting", title: "Follow the routes, then the frame.", body: <p>An Established session proves little, and there is no pseudowire to look at. Check the flood lists first, then the MAC routes, then follow the frame.</p> },
  { id: "recap", chapter: "The whole idea", title: "Advertise your segment, then your MACs.", body: <p>Now watch it in the lesson, then break and fix it in the L2VPN Evolution Lab.</p> },
];
const VISUAL: Record<Id, string> = Object.fromEntries(STEPS.map((s) => [s.id, ["compare", "breaks", "verify", "trouble", "recap"].includes(s.id) ? s.id : "topo"])) as Record<Id, string>;

const NODES: TopoNode[] = [
  { id: "CE1", label: "CE1", sub: "…100.1", icon: "CE", x: 7, y: 56 },
  { id: "PE1", label: "PE1", sub: "1.1.1.1", icon: "PE", x: 24, y: 56 },
  { id: "P1", label: "P1", sub: "10.10.10.1", icon: "P", x: 42, y: 56 },
  { id: "RR1", label: "RR1", sub: "9.9.9.9", icon: "RR", x: 42, y: 14 },
  { id: "P2", label: "P2", sub: "10.10.10.2", icon: "P", x: 60, y: 32 },
  { id: "P3", label: "P3", sub: "10.10.10.3", icon: "P", x: 60, y: 84 },
  { id: "PE2", label: "PE2", sub: "2.2.2.2", icon: "PE", x: 78, y: 32 },
  { id: "PE3", label: "PE3", sub: "3.3.3.3", icon: "PE", x: 78, y: 84 },
  { id: "CE2", label: "CE2", sub: "…100.2", icon: "CE", x: 94, y: 32 },
  { id: "CE3", label: "CE3", sub: "…100.3", icon: "CE", x: 94, y: 84 },
];
const PHYS: [string, string][] = [["CE1", "PE1"], ["PE1", "P1"], ["P1", "P2"], ["P1", "P3"], ["P2", "PE2"], ["P3", "PE3"], ["PE2", "CE2"], ["PE3", "CE3"], ["P1", "RR1"]];
const MESH: [string, string][] = [["PE1", "PE2"], ["PE1", "PE3"], ["PE2", "PE3"]];
const BGP: [string, string][] = [["PE1", "RR1"], ["PE2", "RR1"], ["PE3", "RR1"]];
const MESH_STEPS: Id[] = ["ldp", "bgpvpls", "learn", "limits"];
const BGP_STEPS: Id[] = ["bgpvpls", "idea", "evi", "t3", "t2", "cp", "macip", "withdraw"];

function Deck({ step: s, play, replay }: { step: Step; play: number; replay: () => void }) {
  const FIT = useFitNodes(NODES, 270);
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
    const showMesh = MESH_STEPS.includes(id);
    const showBgp = BGP_STEPS.includes(id);
    const showFlood = ["flood", "labels", "noloop"].includes(id);
    const links: TopoLink[] = [
      ...PHYS.map(([a, b]) => ({ a, b, state: ((showMesh || showBgp || showFlood) && !a.startsWith("CE") && !b.startsWith("CE") ? "dim" : "up") as TopoLink["state"] })),
      ...(showBgp ? BGP.map(([a, b]) => ({ a, b, state: "standby" as TopoLink["state"], label: id === "evi" ? "iBGP EVPN" : id === "bgpvpls" ? "iBGP VPLS" : "" })) : []),
      ...(showMesh ? MESH.map(([a, b]) => ({ a, b, state: "standby" as TopoLink["state"], label: id === "ldp" ? "PW" : "" })) : []),
    ];
    const views: Record<string, TopoView> = {};
    let movers: ReactNode = null;
    if (id === "same") {
      views.CE1 = { ring: "on" };
      views.CE2 = { ring: "on" };
      views.CE3 = { ring: "on", bubble: { text: "one subnet: 192.168.100.0/24", tone: "info" } };
    }
    if (id === "ldp") {
      views.PE1 = { bubble: { text: "lists PE2 and PE3", tone: "warn" } };
      views.PE3 = { badge: { text: "3 PWs = 6 ends", tone: "info" } };
    }
    if (id === "bgpvpls") {
      views.RR1 = { badge: { text: "VPLS routes", tone: "info" } };
      views.PE1 = { bubble: { text: "RD · RT · VE ID · block", tone: "yes" } };
    }
    if (id === "learn") {
      movers = <>{go("CE3", "PE3", { label: "frame from CE3", key: "1", color: "green" })}{go("PE3", "PE2", { label: "on the PW", key: "2", delay: 900, color: "green" })}</>;
      views.PE2 = { bubble: { text: "learns CE3 here", tone: "info", delay: 1800 } };
    }
    if (id === "limits") {
      views.CE2 = { ring: "bad", bubble: { text: "dual-homed? MAC flaps", tone: "bad" } };
      views.CE3 = { bubble: { text: "moved? stale until aged out", tone: "warn", delay: 400 } };
      views.CE1 = { bubble: { text: "every ARP flooded", tone: "warn", delay: 800 } };
    }
    if (id === "idea") views.RR1 = { bubble: { text: "MACs as BGP routes", tone: "yes" } };
    if (id === "evi") {
      views.PE1 = { badge: { text: "EVI 100 · RD 65000:1", tone: "info" } };
      views.PE2 = { badge: { text: "EVI 100 · RD 65000:2", tone: "info" } };
      views.PE3 = { badge: { text: "EVI 100 · RD 65000:3", tone: "info" } };
      views.RR1 = { bubble: { text: "RT 65000:100", tone: "yes" } };
    }
    if (id === "t3") {
      movers = <>{go("PE3", "RR1", { label: "Type 3 · 3.3.3.3 · label 26011", key: "1", color: "violet" })}{go("RR1", "PE1", { label: "Type 3", key: "2", delay: 1000, color: "violet" })}{go("RR1", "PE2", { label: "Type 3", key: "3", delay: 1000, color: "violet" })}</>;
      views.PE1 = { bubble: { text: "flood list +PE3", tone: "yes", delay: 1900 } };
    }
    if (id === "flood") {
      movers = <>{go("CE1", "PE1", { label: "broadcast", key: "1", color: "amber" })}{go("PE1", "PE2", { label: "copy · 25011", key: "2", delay: 900, color: "amber" })}{go("PE1", "PE3", { label: "copy · 26011", key: "3", delay: 900, color: "amber" })}</>;
      views.PE1 = { badge: { text: "flood list: PE2, PE3", tone: "info" } };
      views.P3 = { bubble: { text: "no pseudowires", tone: "info" } };
    }
    if (id === "t2") {
      movers = <>{go("CE3", "PE3", { label: "first frame", key: "1", color: "green" })}{go("PE3", "RR1", { label: "Type 2 · 00:33:… · 26010", key: "2", delay: 1000, color: "violet" })}</>;
      views.PE3 = { bubble: { text: "learned locally", tone: "info", delay: 800 } };
    }
    if (id === "cp") {
      movers = <>{go("RR1", "PE2", { label: "Type 2 · 00:33:…", key: "1", color: "violet" })}{go("RR1", "PE1", { label: "Type 2 · 00:33:…", key: "2", color: "violet" })}</>;
      views.PE2 = { bubble: { text: "CE3 → PE3, via BGP", tone: "yes", delay: 900 } };
    }
    if (id === "macip") {
      views.PE3 = { bubble: { text: "MAC + IP .3", tone: "yes" } };
      views.PE1 = { bubble: { text: "answers ARP", tone: "info", delay: 500 } };
    }
    if (id === "labels") {
      views.PE1 = { badge: { text: "24010 / 24011", tone: "info" } };
      views.PE2 = { badge: { text: "25010 / 25011", tone: "info" } };
      views.PE3 = { badge: { text: "26010 / 26011", tone: "info" } };
      views.RR1 = { bubble: { text: "unicast / inclusive-multicast", tone: "info" } };
    }
    if (id === "wire") {
      movers = <>{go("PE1", "P1", { label: "24104 | 26010", key: "1", color: "violet" })}{go("P1", "P3", { label: "24306 | 26010", key: "2", delay: 800, color: "violet" })}{go("P3", "PE3", { label: "26010", key: "3", delay: 1600, color: "violet" })}</>;
      views.P3 = { badge: { text: "PHP", tone: "warn" } };
      views.PE3 = { bubble: { text: "unicast label → CE3", tone: "yes", delay: 2400 } };
    }
    if (id === "noloop") {
      movers = <>{go("PE1", "PE3", { label: "26011", key: "1", color: "amber" })}{go("PE3", "CE3", { label: "to CE3 only", key: "2", delay: 900, color: "amber" })}{go("PE3", "PE2", { label: "✕ never", key: "3", delay: 900, stay: true, color: "red" })}</>;
    }
    if (id === "withdraw") {
      movers = <>{go("PE3", "RR1", { label: "withdraw 00:33:…", key: "1", color: "red" })}{go("RR1", "PE1", { label: "withdraw", key: "2", delay: 1000, color: "red" })}</>;
      views.PE1 = { bubble: { text: "forgets CE3 at once", tone: "info", delay: 1900 } };
    }
    if (id === "beyond") {
      views.CE2 = { bubble: { text: "multihoming: ES, Types 1 + 4", tone: "info" } };
      views.CE3 = { bubble: { text: "mobility: sequence numbers", tone: "info", delay: 400 } };
      views.RR1 = { bubble: { text: "same BGP: MPLS, VXLAN, VPWS", tone: "yes", delay: 800 } };
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
          <Compare items={[{ title: "LDP VPLS", tone: "violet", body: "neighbors listed on every PE · pseudowire per pair · learning from frames" }, { title: "BGP VPLS", tone: "amber", body: "members from BGP routes (RT) · pseudowire per pair · learning from frames" }, { title: "EVPN-MPLS", tone: "cyan", body: "Type 3: flood list · Type 2: MACs in BGP · no pseudowires · two labels per PE" }]} />
        </>
      );
    case "breaks":
      return (
        <>
          {head}
          <MiniTable title="How an EVPN-MPLS service fails" cols={["Fault", "What you see"]} rows={[{ cells: ["Wrong route target on a PE", "RR1 holds its routes; nobody imports them"], state: "hit" }, { cells: ["EVPN family missing", "session Established, zero EVPN routes"] }, { cells: ["PEs not RR clients", "RR1 has every route, flood lists empty"] }, { cells: ["CE's VLAN not in the EVI", "control plane perfect, that CE cut off"] }, { cells: ["Transport broken", "XR: routes fine, drops in the core · Junos: routes unusable"] }]} />
        </>
      );
    case "verify":
      return (
        <>
          {head}
          <div className="grid gap-2 sm:grid-cols-2">
            <MiniTable title="IOS XR" cols={["Question", "Command"]} rows={[{ cells: ["Sessions, routes received?", "show bgp l2vpn evpn summary"] }, { cells: ["Which Type 2 / Type 3 routes?", "show bgp l2vpn evpn"] }, { cells: ["Flood list?", "show evpn evi vpn-id 100 inclusive-multicast"] }, { cells: ["MACs and labels?", "show evpn evi vpn-id 100 mac"] }]} />
            <MiniTable title="Junos" cols={["Question", "Command"]} rows={[{ cells: ["Sessions, routes received?", "show bgp summary"] }, { cells: ["Which Type 2 / Type 3 routes?", "show route table bgp.evpn.0"] }, { cells: ["Neighbors, labels?", "show evpn instance EVPN-A extensive"] }, { cells: ["MACs?", "show evpn database instance EVPN-A"] }]} />
          </div>
        </>
      );
    case "trouble":
      return (
        <>
          {head}
          <Chain k="trouble" items={[{ t: "Ping each pair of sites: which pairs fail?", tone: "plain" }, { t: "Does every CE's VLAN land in the EVI?", tone: "cyan" }, { t: "Does every PE exchange EVPN routes with RR1?", tone: "violet" }, { t: "Does every PE keep every other PE's Type 3 route?", tone: "violet" }, { t: "Are the remote MACs arriving as Type 2 routes?", tone: "violet" }, { t: "Is the transport LSP complete?", tone: "amber" }, { t: "Fix one thing, ping the failing pair again", tone: "green" }]} />
        </>
      );
    case "recap":
      return (
        <>
          {head}
          <Chain k="recap" items={[{ t: "LDP VPLS → BGP VPLS: discovery moved into BGP" }, { t: "BGP VPLS → EVPN: learning moved into BGP too", tone: "cyan" }, { t: "Type 3 builds the flood list; Type 2 carries each MAC with its unicast label", tone: "violet" }, { t: "Same MPLS core: EVPN label under the transport label", tone: "amber" }, { t: "Check the flood lists, then the MAC routes, then the frame", tone: "green" }]} />
        </>
      );
  }
  return head;
}

export function EvolutionPresentation({ open, onClose, onFinish, finishLabel }: { open: boolean; onClose: () => void; onFinish: () => void; finishLabel: string }) {
  const [play, setPlay] = useState(0);
  return (
    <LessonPresentation
      open={open}
      onClose={onClose}
      title="L2VPN evolution, from zero"
      kicker="Learn · the L2VPN Evolution presentation"
      steps={STEPS}
      visual={(s) => VISUAL[s.id as Id]}
      renderStage={(s) => <Deck step={s as Step} play={play} replay={() => setPlay((p) => p + 1)} />}
      finish={{ label: finishLabel, onClick: onFinish }}
      skip={{ label: "Skip →", onClick: onFinish }}
    />
  );
}
