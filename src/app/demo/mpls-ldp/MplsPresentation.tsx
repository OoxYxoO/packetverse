"use client";

import { useState, type ReactNode } from "react";
import { LessonPresentation } from "@/components/presentation/LessonPresentation";
import { Mover, StageHead, type DeckStep } from "@/components/presentation/ScrollyDeck";
import { Chain, Compare, MiniTable, PacketCard, ReplayButton, Token, Topo, nodeAt, short, type TopoLink, type TopoNode, type TopoView } from "@/components/presentation/Visuals";
import { useFitNodes } from "@/components/presentation/fitNarrow";

/**
 * MPLS + LDP — the presentation before the lesson and the MPLS + LDP Lab. Builds on IS-IS (the core's IGP, previous
 * lesson) and BGP (the PEs' customer routes): a BGP-free core, labels as "toward this FEC", LDP discovery and sessions,
 * label mappings flowing upstream, push / swap / pop, PHP, the LIB and the LFIB, and what breaks when LDP and the IGP
 * disagree. Same routers, loopbacks and IOS XR labels as the lab. Presentation state only.
 */

type Id = "edge" | "core-routes" | "stuck" | "idea" | "fec" | "local" | "hello" | "session" | "mapping" | "impnull" | "push" | "swap" | "pop" | "shim" | "lib" | "follow" | "ipworks" | "sync" | "mtu" | "vendors" | "verify" | "trouble" | "recap";
type Step = DeckStep & { id: Id };
const B = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;

const STEPS: Step[] = [
  { id: "edge", chapter: "Why MPLS", title: "Only the edge knows the customers.", body: <p>PE1 and PE2 run BGP with each other: PE1 knows <B>10.2.2.0/24 is behind 4.4.4.4</B> (PE2&apos;s loopback). The core routers P1–P4 run IS-IS only — the previous lesson. They know every loopback and nothing else.</p> },
  { id: "core-routes", chapter: "Why MPLS", title: "A core with no customer routes is a feature.", body: <p>Providers keep customer routes out of the core on purpose: hundreds of thousands of prefixes, changing all the time, would make every core router bigger, slower to converge and exposed to every customer&apos;s churn. A <B>BGP-free core</B> stays small and stable.</p> },
  { id: "stuck", chapter: "Why MPLS", title: "But then the core can't forward customer traffic.", body: <p>CE1 sends to 10.2.2.20. PE1 knows the way (via 4.4.4.4) and passes a plain IP packet to P1. P1 looks up 10.2.2.20 — <B>no route</B>. Dropped, in the middle of a perfectly healthy network.</p> },
  { id: "idea", chapter: "The idea", title: "Tell the core where to take it, not who it's for.", body: <p>PE1 puts a small <B>label</B> in front of the packet that means “toward 4.4.4.4”. P1 and P2 forward on the label alone and never look at 10.2.2.20. The core only needs to know the way to PE2 — which IS-IS already gives it.</p> },
  { id: "fec", chapter: "The idea", title: "A label stands for a FEC.", body: <p>A <B>Forwarding Equivalence Class</B> is a group of packets that are forwarded the same way — here, “everything for 4.4.4.4/32”. Every customer packet whose BGP next hop is PE2 joins that one FEC, whatever its destination.</p> },
  { id: "local", chapter: "The idea", title: "Every router picks its own labels.", body: <p>A label only means something to the router that chose it. P1 says “for 4.4.4.4, send me <B>24102</B>”; P2 says “send me <B>24203</B>”. Each router tells its neighbors; nobody coordinates numbers across the network.</p> },
  { id: "hello", chapter: "LDP", title: "LDP Hellos find the neighbors.", body: <p>The <B>Label Distribution Protocol</B> sends Hellos on every LDP interface (UDP 646, to 224.0.0.2): “I speak LDP; my transport address is my loopback.” Two routers that hear each other are LDP neighbors — but they haven&apos;t exchanged a single label yet.</p> },
  { id: "session", chapter: "LDP", title: "Labels travel in a TCP session between loopbacks.", body: <p>Neighbors open <B>TCP 646</B> between their transport addresses — their loopbacks. That needs an IGP route to each other&apos;s loopback: LDP depends on IS-IS from the very first packet.</p> },
  { id: "mapping", chapter: "LDP", title: "Labels flow upstream, away from the destination.", body: <p>PE2 owns 4.4.4.4 and advertises it first; P2 then advertises its label, P1 its own, and so on. A label mapping always travels <B>against</B> the direction traffic will flow.</p> },
  { id: "impnull", chapter: "LDP", title: "The egress asks for no label at all.", body: <p>PE2 advertises <B>implicit-null</B> (label 3) for its own loopback: “don&apos;t give me a label, just hand me the IP packet.” That makes P2 remove the label one hop early — <B>penultimate-hop popping</B>.</p> },
  { id: "push", chapter: "Forwarding", title: "PE1 pushes.", body: <p>CE1&apos;s packet arrives at PE1 as plain IP. PE1 resolves 10.2.2.20 → BGP next hop 4.4.4.4 → the label P1 gave it, and <B>pushes 24102</B> in front of the IP header.</p> },
  { id: "swap", chapter: "Forwarding", title: "P1 swaps — on the label alone.", body: <p>P1 reads only the top label: 24102 is its own label for 4.4.4.4, so it <B>swaps</B> it for P2&apos;s label 24203 and sends it on. No IP lookup, no customer route.</p> },
  { id: "pop", chapter: "Forwarding", title: "P2 pops; PE2 routes plain IP.", body: <p>P2&apos;s outgoing label for 4.4.4.4 is implicit-null, so it <B>pops</B>. PE2 receives an ordinary IP packet and routes it to CE2 on its own connected network. CE2 never sees a label.</p> },
  { id: "shim", chapter: "Forwarding", title: "Four bytes between Ethernet and IP.", body: <p>The <B>shim header</B>: a 20-bit label, 3 bits of traffic class, the bottom-of-stack bit and a TTL. Labels can be stacked — later lessons put a VPN label under the transport label.</p> },
  { id: "lib", chapter: "Two tables", title: "The LIB keeps every label; the LFIB uses one.", body: <p>PE1 hears a label for 4.4.4.4 from P1 <B>and</B> from P3. The <B>LIB</B> keeps both (liberal retention). The <B>LFIB</B> uses only the one from the IS-IS next hop: P1.</p> },
  { id: "follow", chapter: "Two tables", title: "When IS-IS moves, the LFIB moves with it.", body: <p>The P1–P2 link fails. IS-IS now sends 4.4.4.4 via P3, and PE1 simply switches to the label P3 gave it long ago. No new signaling needed — it was waiting in the LIB.</p> },
  { id: "ipworks", chapter: "When it breaks", title: "IP works, customers don't.", body: <p>Take LDP off one core link. IS-IS is happy and every loopback answers pings. But P1 has no label from P2: on IOS XR it removes the label and hands P2 plain IP for 10.2.2.20, which P2 can&apos;t route. The classic MPLS outage.</p> },
  { id: "sync", chapter: "When it breaks", title: "LDP–IGP synchronization keeps them in step.", body: <p>The IGP doesn&apos;t know about LDP. With <B>LDP–IGP sync</B>, IS-IS advertises the maximum metric on a link until LDP is operational there, so traffic avoids a link that can&apos;t carry labels yet.</p> },
  { id: "mtu", chapter: "When it breaks", title: "Every label adds four bytes.", body: <p>A 1500-byte customer packet plus one label is 1504 bytes. A core link with a 1500-byte MTU drops it — while small packets pass. Providers run their core with a much larger MTU for exactly this reason.</p> },
  { id: "vendors", chapter: "Two vendors", title: "Same protocol, different defaults.", body: <p>IOS XR labels every FEC at once (<B>independent</B> control) and forwards unlabeled when it has no downstream label. Junos waits for a label from downstream (<B>ordered</B> control), and its BGP next hops must resolve through LDP — without an LSP, PE1 drops the traffic itself.</p> },
  { id: "verify", chapter: "Verify", title: "The questions engineers ask.", body: <p>Is there an LDP session on every link the IGP uses? Which label did each neighbor give? What will this router do with label X? Does the LSP work end to end — not just IP?</p> },
  { id: "trouble", chapter: "Troubleshooting", title: "Walk from the IGP to the label.", body: <p>Most MPLS tickets say “customers down, core fine”. The evidence tells you which layer gave up.</p> },
  { id: "recap", chapter: "The whole idea", title: "Classify once at the edge, switch on labels in the core.", body: <p>Now watch it in the lesson, then break and fix it in the MPLS + LDP Lab.</p> },
];

const VISUAL: Record<Id, string> = Object.fromEntries(STEPS.map((s) => [s.id, ["shim", "fec", "verify", "trouble", "recap", "vendors", "lib"].includes(s.id) ? s.id : "net"])) as Record<Id, string>;

const NODES: TopoNode[] = [
  { id: "CE1", label: "CE1", sub: "10.1.1.10", icon: "CE", x: 5, y: 50 },
  { id: "PE1", label: "PE1", sub: "1.1.1.1", icon: "PE", x: 21, y: 50 },
  { id: "P1", label: "P1", sub: "2.2.2.2", icon: "P", x: 41, y: 18 },
  { id: "P2", label: "P2", sub: "3.3.3.3", icon: "P", x: 61, y: 18 },
  { id: "PE2", label: "PE2", sub: "4.4.4.4", icon: "PE", x: 79, y: 50 },
  { id: "CE2", label: "CE2", sub: "10.2.2.20", icon: "CE", x: 95, y: 50 },
  { id: "P3", label: "P3", sub: "5.5.5.5", icon: "P", x: 41, y: 82 },
  { id: "P4", label: "P4", sub: "6.6.6.6", icon: "P", x: 61, y: 82 },
];

function Deck({ step: s, play, replay }: { step: Step; play: number; replay: () => void }) {
  const FIT = useFitNodes(NODES, 250);
  const at = (n: string) => nodeAt(FIT.nodes, n);
  const id = s.id;
  const k = `${id}-${play}`;
  const head = <StageHead chapter={s.chapter} title={s.title} />;
  const go = (f: string, t: string, o: { label: string; key: string; delay?: number; stay?: boolean; color?: string; d?: number; dy?: number }) => {
    const from: [number, number] = [at(f)[0], at(f)[1] + (o.dy ?? 0)];
    const to: [number, number] = [at(t)[0], at(t)[1] + (o.dy ?? 0)];
    return (
      <Mover key={`${k}-${o.key}`} from={from} to={o.stay ? short(from, to) : to} delay={o.delay} duration={o.d ?? 800} stay={o.stay}>
        <Token color={o.color ?? "cyan"}>{o.label}</Token>
      </Mover>
    );
  };

  if (VISUAL[id] === "net") {
    const failTop = id === "follow";
    const noLdpTop = id === "ipworks";
    const links: TopoLink[] = [
      { a: "CE1", b: "PE1", label: "", state: "up" },
      { a: "PE1", b: "P1", label: "", state: "up" },
      { a: "P1", b: "P2", label: noLdpTop ? "IS-IS only" : id === "sync" ? "max metric" : "", state: failTop ? "down" : noLdpTop || id === "sync" ? "blocked" : id === "mtu" ? "standby" : "up" },
      { a: "P2", b: "PE2", label: "", state: "up" },
      { a: "PE2", b: "CE2", label: "", state: "up" },
      { a: "PE1", b: "P3", label: "", state: ["follow", "sync"].includes(id) ? "active" : "dim" },
      { a: "P3", b: "P4", label: "", state: ["follow", "sync"].includes(id) ? "active" : "dim" },
      { a: "P4", b: "PE2", label: "", state: ["follow", "sync"].includes(id) ? "active" : "dim" },
    ];
    const views: Record<string, TopoView> = {};
    let movers: ReactNode = null;
    if (id === "edge") {
      views.PE1 = { badge: { text: "BGP: 10.2.2.0/24 via 4.4.4.4", tone: "info" } };
      views.P1 = { badge: { text: "IS-IS only", tone: "no" } };
      views.P2 = { badge: { text: "IS-IS only", tone: "no" } };
    }
    if (id === "core-routes") for (const n of ["P1", "P2", "P3", "P4"]) views[n] = { ring: "on", badge: { text: "loopbacks only", tone: "yes" } };
    if (id === "stuck") {
      movers = (
        <>
          {go("CE1", "PE1", { label: "IP → 10.2.2.20", key: "1", color: "green" })}
          {go("PE1", "P1", { label: "IP → 10.2.2.20", key: "2", delay: 800, color: "green", stay: true })}
        </>
      );
      views.P1 = { ring: "bad", bubble: { text: "10.2.2.20? no route", tone: "bad", delay: 1500 } };
    }
    if (id === "idea") {
      movers = (
        <>
          {go("PE1", "P1", { label: "[toward 4.4.4.4] IP", key: "1", color: "violet" })}
          {go("P1", "P2", { label: "[toward 4.4.4.4] IP", key: "2", delay: 800, color: "violet" })}
          {go("P2", "PE2", { label: "IP", key: "3", delay: 1600, color: "green", stay: true })}
        </>
      );
      views.P1 = { bubble: { text: "I know the way to 4.4.4.4", tone: "yes", delay: 800 } };
    }
    if (id === "local") {
      views.P1 = { badge: { text: "4.4.4.4 → my 24102", tone: "warn" } };
      views.P2 = { badge: { text: "4.4.4.4 → my 24203", tone: "warn" } };
      views.PE1 = { badge: { text: "my 24001", tone: "warn" } };
      views.PE2 = { badge: { text: "it's me: imp-null", tone: "yes" } };
    }
    if (id === "hello") {
      movers = (
        <>
          {go("PE1", "P1", { label: "Hello", key: "1", dy: -2 })}
          {go("P1", "PE1", { label: "Hello", key: "2", dy: 2 })}
          {go("P1", "P2", { label: "Hello", key: "3", dy: -2, delay: 300 })}
          {go("P2", "P1", { label: "Hello", key: "4", dy: 2, delay: 300 })}
          {go("P2", "PE2", { label: "Hello", key: "5", dy: -2, delay: 600 })}
          {go("PE2", "P2", { label: "Hello", key: "6", dy: 2, delay: 600 })}
        </>
      );
    }
    if (id === "session") {
      movers = (
        <>
          {go("P2", "P1", { label: "TCP 646 → 2.2.2.2", key: "1", color: "amber" })}
          {go("P1", "P2", { label: "Init · Keepalive", key: "2", delay: 900, color: "amber", dy: 3 })}
        </>
      );
      views.P1 = { bubble: { text: "route to 3.3.3.3? IS-IS: yes", tone: "yes", delay: 300 } };
    }
    if (id === "mapping") {
      movers = (
        <>
          {go("PE2", "P2", { label: "4.4.4.4 = imp-null", key: "1", color: "violet" })}
          {go("P2", "P1", { label: "4.4.4.4 = 24203", key: "2", delay: 900, color: "violet" })}
          {go("P1", "PE1", { label: "4.4.4.4 = 24102", key: "3", delay: 1800, color: "violet" })}
        </>
      );
      views.PE1 = { bubble: { text: "traffic will flow this way →", tone: "info", delay: 2600 } };
    }
    if (id === "impnull") {
      movers = go("PE2", "P2", { label: "4.4.4.4 = label 3 (implicit-null)", key: "1", color: "violet", stay: true });
      views.P2 = { bubble: { text: "→ I'll pop before PE2", tone: "yes", delay: 900 } };
    }
    if (id === "push") {
      movers = (
        <>
          {go("CE1", "PE1", { label: "IP", key: "1", color: "green" })}
          {go("PE1", "P1", { label: "[24102] IP", key: "2", delay: 800, color: "violet", stay: true })}
        </>
      );
      views.PE1 = { ring: "on", bubble: { text: "via 4.4.4.4: push 24102", tone: "info", delay: 400 } };
    }
    if (id === "swap") {
      movers = go("P1", "P2", { label: "[24203] IP", key: "1", color: "violet", stay: true });
      views.P1 = { ring: "on", bubble: { text: "in 24102 → out 24203", tone: "info" } };
    }
    if (id === "pop") {
      movers = (
        <>
          {go("P2", "PE2", { label: "IP", key: "1", color: "green" })}
          {go("PE2", "CE2", { label: "IP", key: "2", delay: 800, color: "green", stay: true })}
        </>
      );
      views.P2 = { ring: "on", bubble: { text: "in 24203 → Pop", tone: "info" } };
      views.CE2 = { ring: "target" };
    }
    if (id === "follow") {
      movers = (
        <>
          {go("PE1", "P3", { label: "[24405] IP", key: "1", color: "violet" })}
          {go("P3", "P4", { label: "[24506] IP", key: "2", delay: 800, color: "violet" })}
          {go("P4", "PE2", { label: "IP", key: "3", delay: 1600, color: "green", stay: true })}
        </>
      );
      views.PE1 = { bubble: { text: "next hop now P3 → P3's label", tone: "yes" } };
    }
    if (id === "ipworks") {
      movers = (
        <>
          {go("PE1", "P1", { label: "[24102] IP", key: "1", color: "violet" })}
          {go("P1", "P2", { label: "IP → 10.2.2.20", key: "2", delay: 800, color: "red", stay: true })}
        </>
      );
      views.P1 = { bubble: { text: "Unlabelled", tone: "warn", delay: 600 } };
      views.P2 = { ring: "bad", bubble: { text: "no route", tone: "bad", delay: 1600 } };
    }
    if (id === "sync") {
      movers = (
        <>
          {go("PE1", "P3", { label: "[24405] IP", key: "1", color: "violet" })}
          {go("P3", "P4", { label: "[24506] IP", key: "2", delay: 800, color: "violet" })}
          {go("P4", "PE2", { label: "IP", key: "3", delay: 1600, color: "green", stay: true })}
        </>
      );
      views.P1 = { bubble: { text: "LDP down → IS-IS metric max", tone: "warn" } };
    }
    if (id === "mtu") {
      movers = (
        <>
          {go("PE1", "P1", { label: "[24102] 1500 B", key: "1", color: "violet" })}
          {go("P1", "P2", { label: "1504 B", key: "2", delay: 800, color: "red", stay: true })}
        </>
      );
      views.P1 = { ring: "bad", bubble: { text: "1504 > MTU 1500", tone: "bad", delay: 1200 } };
    }
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
    case "fec":
      return (
        <>
          {head}
          <MiniTable title="PE1: which FEC does each packet join?" cols={["Destination", "BGP next hop", "FEC"]} rows={[{ cells: ["10.2.2.20 (CE2)", "4.4.4.4", "4.4.4.4/32"], state: "hit" }, { cells: ["10.2.2.77", "4.4.4.4", "4.4.4.4/32"], state: "hit" }, { cells: ["any customer behind PE2", "4.4.4.4", "4.4.4.4/32"] }]} />
          <Compare items={[{ title: "IP routing", tone: "cyan", body: "every router decides per destination address" }, { title: "MPLS", tone: "violet", body: "the ingress decides once (the FEC); the core follows the label" }]} />
        </>
      );
    case "shim":
      return (
        <>
          {head}
          <PacketCard
            layers={[
              { name: "Ethernet", color: "#94a3b8", fields: [{ k: "EtherType", v: "0x8847 (MPLS unicast)", hi: "new" }] },
              { name: "MPLS shim (4 bytes)", color: "#a78bfa", fields: [{ k: "Label (20 bits)", v: "24102", hi: "new" }, { k: "TC (3 bits)", v: "0" }, { k: "S — bottom of stack (1 bit)", v: "1" }, { k: "TTL (8 bits)", v: "63" }] },
              { name: "IP (unchanged)", color: "#22d3ee", fields: [{ k: "Destination", v: "10.2.2.20" }, { k: "TTL", v: "copied back at the pop" }] },
            ]}
          />
        </>
      );
    case "lib":
      return (
        <>
          {head}
          <div className="grid gap-2 sm:grid-cols-2">
            <MiniTable title="PE1 LIB · 4.4.4.4/32" cols={["From", "Label"]} rows={[{ cells: ["P1", "24102"], state: "hit" }, { cells: ["P3", "24405"] }]} />
            <MiniTable title="PE1 LFIB · 4.4.4.4/32" cols={["Out label", "Next hop"]} rows={[{ cells: ["24102", "P1 (IS-IS next hop)"], state: "hit" }]} />
          </div>
          <Compare items={[{ title: "LIB", tone: "violet", body: "control plane: every label heard from every LDP neighbor" }, { title: "LFIB", tone: "green", body: "data plane: only the label from the IGP next hop" }]} />
        </>
      );
    case "vendors":
      return (
        <>
          {head}
          <div className="grid gap-2 sm:grid-cols-2">
            <MiniTable title="IOS XR" cols={["Aspect", "Behavior"]} rows={[{ cells: ["Label control", "independent"] }, { cells: ["No downstream label", "Unlabelled: forward plain IP"] }, { cells: ["Dynamic labels", "24000 and up"] }, { cells: ["The LFIB", "show mpls forwarding"] }]} />
            <MiniTable title="Junos" cols={["Aspect", "Behavior"]} rows={[{ cells: ["Label control", "ordered"] }, { cells: ["No downstream label", "no label, no entry"] }, { cells: ["Dynamic labels", "299776 and up"] }, { cells: ["The LFIB", "show route table mpls.0"] }]} />
          </div>
          <Chain k="vd" items={[{ t: "Same broken link: XR drops in the core (unlabeled IP), Junos drops at the ingress PE (BGP next hop has no LSP in inet.3)", tone: "amber" }]} />
        </>
      );
    case "verify":
      return (
        <>
          {head}
          <div className="grid gap-2 sm:grid-cols-2">
            <MiniTable title="IOS XR" cols={["Question", "Command"]} rows={[{ cells: ["LDP sessions", "show mpls ldp neighbor brief"] }, { cells: ["Labels heard", "show mpls ldp bindings 4.4.4.4/32"] }, { cells: ["What I do with a label", "show mpls forwarding"] }, { cells: ["What PE1 pushes", "show cef 10.2.2.20"] }, { cells: ["The LSP end to end", "ping mpls ipv4 4.4.4.4/32"] }]} />
            <MiniTable title="Junos" cols={["Question", "Command"]} rows={[{ cells: ["LDP sessions", "show ldp session"] }, { cells: ["Labels heard", "show ldp database"] }, { cells: ["What I do with a label", "show route table mpls.0"] }, { cells: ["What PE1 pushes", "show route 10.2.2.20"] }, { cells: ["The LSP end to end", "ping mpls ldp 4.4.4.4"] }]} />
          </div>
        </>
      );
    case "trouble":
      return (
        <>
          {head}
          <Chain
            k="ts"
            items={[
              { t: "Customer traffic fails — do loopback pings work? (separates IGP from MPLS)", tone: "plain" },
              { t: "LDP session on every link the IGP uses? Discovery only → check the route to the transport address", tone: "cyan" },
              { t: "Which label did the IGP next hop give? (LIB) What does the LFIB do with it?", tone: "violet" },
              { t: "LSP ping / traceroute: where does it stop being labeled?", tone: "amber" },
              { t: "Big packets only? Check core MTUs: +4 bytes per label", tone: "red" },
              { t: "Fix one thing, then prove it with fresh customer traffic", tone: "green" },
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
              { t: "BGP-free core: only the PEs know customers; labels carry traffic to the BGP next hop" },
              { t: "LDP: Hellos discover, TCP between loopbacks carries labels — it rides on the IGP", tone: "cyan" },
              { t: "Each router picks its own label per FEC; mappings flow upstream; the egress asks for implicit-null", tone: "violet" },
              { t: "PUSH at the ingress, SWAP in the core, POP at the penultimate hop", tone: "green" },
              { t: "The LFIB follows the IGP next hop; the LIB keeps the rest", tone: "plain" },
              { t: "IP fine, customers down → LDP and the IGP disagree (sync), or the MTU has no room for labels", tone: "amber" },
            ]}
          />
        </>
      );
  }
  return head;
}

export function MplsPresentation({ open, onClose, onFinish, finishLabel }: { open: boolean; onClose: () => void; onFinish: () => void; finishLabel: string }) {
  const [play, setPlay] = useState(0);
  return (
    <LessonPresentation
      open={open}
      onClose={onClose}
      title="MPLS and LDP, from zero"
      kicker="Learn · the MPLS presentation"
      steps={STEPS}
      visual={(s) => VISUAL[s.id]}
      renderStage={(s) => <Deck step={s} play={play} replay={() => setPlay((p) => p + 1)} />}
      finish={{ label: finishLabel, onClick: onFinish }}
      skip={{ label: "Skip →", onClick: onFinish }}
    />
  );
}
