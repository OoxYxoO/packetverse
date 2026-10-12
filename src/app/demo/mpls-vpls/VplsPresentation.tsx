"use client";

import { useState, type ReactNode } from "react";
import { LessonPresentation } from "@/components/presentation/LessonPresentation";
import { Mover, StageHead, type DeckStep } from "@/components/presentation/ScrollyDeck";
import { Chain, Compare, MiniTable, ReplayButton, Token, Topo, nodeAt, short, type TopoLink, type TopoNode, type TopoView } from "@/components/presentation/Visuals";
import { useFitNodes } from "@/components/presentation/fitNarrow";

/**
 * MPLS VPLS — the presentation before the lesson and the VPLS Lab. Builds on VPWS (pseudowires, targeted LDP,
 * directional labels). Same routers, VPLS ID, MACs and labels (IOS XR numbering) as the lab. Presentation state only.
 */

type Id = "three" | "vpws" | "switch" | "bridge" | "mesh" | "signal" | "learn" | "flood" | "unicast" | "split" | "full" | "broken" | "labels" | "aging" | "move" | "compare" | "breaks" | "verify" | "trouble" | "recap";
type Step = DeckStep & { id: Id };
const B = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;

const STEPS: Step[] = [
  { id: "three", chapter: "The problem", title: "Three sites, one LAN.", body: <p>CUST-A has sites behind PE1, PE2 and PE3. They want one Ethernet segment — 192.168.100.0/24 — as if all three routers were plugged into the same switch.</p> },
  { id: "vpws", chapter: "The problem", title: "A wire has only two ends.", body: <p>The VPWS of the last lesson connects exactly two attachment circuits. Three sites would need three separate wires — and every CE a port per wire. That isn&apos;t a LAN.</p> },
  { id: "switch", chapter: "The idea", title: "Stretch a switch across the provider.", body: <p><B>VPLS</B> (Virtual Private LAN Service) turns the PEs into one distributed Ethernet switch for the customer. Any site can reach any other; broadcasts reach everyone.</p> },
  { id: "bridge", chapter: "The idea", title: "Every PE is a bridge.", body: <p>Each PE runs a bridge for the service — IOS XR calls it a <B>bridge domain</B>, Junos a <B>VPLS instance</B>. Its ports: the local attachment circuit, and one pseudowire to each other PE.</p> },
  { id: "mesh", chapter: "The pseudowires", title: "A full mesh of pseudowires.", body: <p>Three PEs, three pseudowires: PE1–PE2, PE1–PE3, PE2–PE3. Each is exactly the pseudowire you know from VPWS, with the same PW ID — here the <B>VPLS ID 500</B>.</p> },
  { id: "signal", chapter: "The pseudowires", title: "Signaled pair by pair.", body: <p>Every pair opens its own targeted LDP session between loopbacks and exchanges labels. P1, P2 and P3 carry the LSPs underneath and know nothing about the customer.</p> },
  { id: "learn", chapter: "The bridge", title: "Learn where each MAC lives.", body: <p>When a frame enters a PE, the PE notes its source MAC and the port it came in on. CE1&apos;s first frame teaches PE1 that <B>00:11:11:11:11:11</B> lives on the attachment circuit — and teaches PE2 and PE3 that it lives behind their pseudowire to PE1.</p> },
  { id: "flood", chapter: "The bridge", title: "Unknown? Flood it.", body: <p>CE1 asks who has 192.168.100.3 — a broadcast. PE1 doesn&apos;t know where the answer lives, so it <B>floods</B>: a copy over every pseudowire. PE2 and PE3 deliver it to their CEs.</p> },
  { id: "unicast", chapter: "The bridge", title: "Known? Send it to one port.", body: <p>CE3 answers. PE3 already knows CE1 is behind PE1 and sends the reply over that one pseudowire; PE1 learns CE3 behind PE3. From now on, CE1 ↔ CE3 traffic is unicast — PE2 never sees it.</p> },
  { id: "split", chapter: "No loops", title: "Split horizon.", body: <p>The triangle of pseudowires is a loop, and Ethernet has no TTL. So VPLS has one rule: a frame that arrived on a pseudowire is <B>never</B> sent out another pseudowire — only to local attachment circuits.</p> },
  { id: "full", chapter: "No loops", title: "Which is why the mesh must be full.", body: <p>PE1 can&apos;t count on PE2 to pass its frames on to PE3 — split horizon forbids it. PE1 needs its own pseudowire to every other PE. N PEs need N(N−1)/2 pseudowires.</p> },
  { id: "broken", chapter: "No loops", title: "Lose one pseudowire, lose one pair.", body: <p>If PE3 drops PE1 from its neighbor list, the PE1–PE3 pseudowire goes down. CE1 ↔ CE2 and CE2 ↔ CE3 still work — and CE1 ↔ CE3 doesn&apos;t, although PE2 holds both other pseudowires.</p> },
  { id: "labels", chapter: "Forwarding", title: "Two labels, as in VPWS.", body: <p>To reach CE3, PE1 pushes <B>26031</B> — the label PE3 chose for its pseudowire with PE1 — then the transport label toward 3.3.3.3. P1 swaps, P3 pops, PE3 sees 26031: &quot;from PE1, VPLS-A&quot;. Each PE gives each neighbor its own label, so it knows which port a frame came from.</p> },
  { id: "aging", chapter: "Forwarding", title: "Tables forget.", body: <p>MAC entries age out (300 seconds by default) or are cleared. Nothing breaks: the next frame to an unknown MAC is flooded and the tables refill.</p> },
  { id: "move", chapter: "Forwarding", title: "When a host moves.", body: <p>If a host moves to another site, the PEs keep sending to the old place until they learn its MAC from a new port. Classic VPLS relearns from traffic (LDP MAC withdrawal can speed it up); EVPN, later in this path, signals it.</p> },
  { id: "compare", chapter: "Where it fits", title: "VPWS, VPLS, L3VPN.", body: <p>VPWS: two ends, no lookup. VPLS: many ends, MAC learning and flooding. L3VPN: the provider routes the customer&apos;s IP.</p> },
  { id: "breaks", chapter: "When it breaks", title: "Five ways a VPLS fails.", body: <p>A missing mesh neighbor, a different VPLS ID, a different MTU, an attachment circuit on the wrong VLAN, a broken transport LSP.</p> },
  { id: "verify", chapter: "Verify", title: "The questions engineers ask.", body: <p>Is every site&apos;s attachment circuit in the bridge? Does every PE list every other PE? Is every pseudowire up with a remote label? Where has each MAC been learned?</p> },
  { id: "trouble", chapter: "Troubleshooting", title: "Find the missing pair.", body: <p>Test site pairs, not just &quot;the VPLS&quot;: a VPLS can work for two pairs and fail for the third. Then climb the ladder for that pair.</p> },
  { id: "recap", chapter: "The whole idea", title: "Bridges, a full mesh, split horizon.", body: <p>Now watch it in the lesson, then break and fix it in the VPLS Lab.</p> },
];
const VISUAL: Record<Id, string> = Object.fromEntries(STEPS.map((s) => [s.id, ["compare", "breaks", "verify", "trouble", "recap"].includes(s.id) ? s.id : "topo"])) as Record<Id, string>;

const NODES: TopoNode[] = [
  { id: "CE1", label: "CE1", sub: "…100.1", icon: "CE", x: 7, y: 50 },
  { id: "PE1", label: "PE1", sub: "1.1.1.1", icon: "PE", x: 24, y: 50 },
  { id: "P1", label: "P1", sub: "10.10.10.1", icon: "P", x: 42, y: 50 },
  { id: "P2", label: "P2", sub: "10.10.10.2", icon: "P", x: 60, y: 22 },
  { id: "P3", label: "P3", sub: "10.10.10.3", icon: "P", x: 60, y: 78 },
  { id: "PE2", label: "PE2", sub: "2.2.2.2", icon: "PE", x: 78, y: 22 },
  { id: "PE3", label: "PE3", sub: "3.3.3.3", icon: "PE", x: 78, y: 78 },
  { id: "CE2", label: "CE2", sub: "…100.2", icon: "CE", x: 94, y: 22 },
  { id: "CE3", label: "CE3", sub: "…100.3", icon: "CE", x: 94, y: 78 },
];
const PHYS: [string, string][] = [["CE1", "PE1"], ["PE1", "P1"], ["P1", "P2"], ["P1", "P3"], ["P2", "PE2"], ["P3", "PE3"], ["PE2", "CE2"], ["PE3", "CE3"]];
const MESH: [string, string][] = [["PE1", "PE2"], ["PE1", "PE3"], ["PE2", "PE3"]];

function Deck({ step: s, play, replay }: { step: Step; play: number; replay: () => void }) {
  const FIT = useFitNodes(NODES, 320);
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
    const showMesh = !["three", "vpws", "switch"].includes(id);
    const links: TopoLink[] = [
      ...PHYS.map(([a, b]) => ({ a, b, state: (showMesh && !a.startsWith("CE") && !b.startsWith("CE") ? "dim" : "up") as TopoLink["state"] })),
      ...(showMesh ? MESH.map(([a, b]) => ({ a, b, state: (id === "broken" && a === "PE1" && b === "PE3" ? "down" : id === "split" || id === "full" ? "blocked" : "standby") as TopoLink["state"], label: ["mesh", "signal"].includes(id) ? "PW 500" : "" })) : []),
    ];
    const views: Record<string, TopoView> = {};
    let movers: ReactNode = null;
    if (id === "three") {
      views.CE1 = { ring: "on" };
      views.CE2 = { ring: "on" };
      views.CE3 = { ring: "on", bubble: { text: "one subnet: 192.168.100.0/24", tone: "info" } };
    }
    if (id === "vpws") views.PE1 = { bubble: { text: "one wire = two ends", tone: "warn" } };
    if (id === "switch") views.P1 = { bubble: { text: "one distributed switch", tone: "yes" } };
    if (id === "bridge") {
      views.PE1 = { badge: { text: "bridge", tone: "info" } };
      views.PE2 = { badge: { text: "bridge", tone: "info" } };
      views.PE3 = { badge: { text: "bridge", tone: "info" } };
    }
    if (id === "signal") movers = <>{go("PE1", "PE2", { label: "targeted LDP", key: "1", color: "amber" })}{go("PE1", "PE3", { label: "targeted LDP", key: "2", delay: 300, color: "amber" })}{go("PE2", "PE3", { label: "targeted LDP", key: "3", delay: 600, color: "amber" })}</>;
    if (id === "learn") {
      movers = <>{go("CE1", "PE1", { label: "src 00:11…", key: "1", color: "green" })}</>;
      views.PE1 = { bubble: { text: "00:11… → AC", tone: "yes", delay: 900 } };
      views.PE2 = { bubble: { text: "00:11… → PW to PE1", tone: "info", delay: 1300 } };
    }
    if (id === "flood") {
      movers = <>{go("CE1", "PE1", { label: "ARP broadcast", key: "1", color: "amber" })}{go("PE1", "PE2", { label: "copy", key: "2", delay: 900, color: "amber" })}{go("PE1", "PE3", { label: "copy", key: "3", delay: 900, color: "amber" })}{go("PE2", "CE2", { label: "copy", key: "4", delay: 1800, color: "amber" })}{go("PE3", "CE3", { label: "copy", key: "5", delay: 1800, color: "amber" })}</>;
    }
    if (id === "unicast") {
      movers = <>{go("CE3", "PE3", { label: "ARP reply", key: "1", color: "green" })}{go("PE3", "PE1", { label: "to PE1 only", key: "2", delay: 900, color: "green" })}{go("PE1", "CE1", { label: "reply", key: "3", delay: 1800, color: "green" })}</>;
      views.PE2 = { ring: "dim", bubble: { text: "sees nothing", tone: "no", delay: 1200 } };
    }
    if (id === "split") {
      movers = <>{go("PE1", "PE2", { label: "broadcast", key: "1", color: "amber" })}{go("PE2", "PE3", { label: "✕ not relayed", key: "2", delay: 900, stay: true, color: "red" })}</>;
      views.PE2 = { bubble: { text: "from a PW → ACs only", tone: "warn", delay: 1200 } };
    }
    if (id === "full") views.PE1 = { bubble: { text: "needs its own PW to every PE", tone: "info" } };
    if (id === "broken") {
      views.PE1 = { ring: "bad", bubble: { text: "CE1 ↔ CE3 lost", tone: "bad" } };
      views.PE2 = { bubble: { text: "can't relay (split horizon)", tone: "warn", delay: 400 } };
    }
    if (id === "labels") {
      movers = <>{go("PE1", "P1", { label: "24104 | 26031", key: "1", color: "violet" })}{go("P1", "P3", { label: "24306 | 26031", key: "2", delay: 800, color: "violet" })}{go("P3", "PE3", { label: "26031", key: "3", delay: 1600, color: "violet" })}</>;
      views.P3 = { badge: { text: "PHP", tone: "warn" } };
    }
    if (id === "aging") views.PE1 = { bubble: { text: "entries age out after 300 s", tone: "info" } };
    if (id === "move") views.PE2 = { bubble: { text: "old entry until new traffic", tone: "warn" } };
    return (
      <>
        {head}
        <Topo nodes={FIT.nodes} links={links} views={views} ratio={54} minH={FIT.minH}>
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
          <Compare items={[{ title: "VPWS", tone: "violet", body: "two attachment circuits, one pseudowire, no lookup" }, { title: "VPLS", tone: "amber", body: "many sites, a full mesh, MAC learning, flooding, split horizon" }, { title: "L3VPN", tone: "cyan", body: "routes the customer's IP in a VRF per customer" }]} />
        </>
      );
    case "breaks":
      return (
        <>
          {head}
          <MiniTable title="How a VPLS fails" cols={["Fault", "What you see"]} rows={[{ cells: ["A PE misses a neighbor", "one pair of sites cut, the others fine"], state: "hit" }, { cells: ["Different VPLS ID", "one PE isolated"] }, { cells: ["Different MTU", "that PE's pseudowires down"] }, { cells: ["AC on the wrong VLAN", "pseudowires up, one site silent"] }, { cells: ["Transport broken", "XR: PWs up, drops in the core · Junos: PWs down"] }]} />
        </>
      );
    case "verify":
      return (
        <>
          {head}
          <div className="grid gap-2 sm:grid-cols-2">
            <MiniTable title="IOS XR" cols={["Question", "Command"]} rows={[{ cells: ["ACs and PWs up?", "show l2vpn bridge-domain"] }, { cells: ["Labels, MTU, VLAN?", "show l2vpn bridge-domain detail"] }, { cells: ["MAC table?", "show l2vpn forwarding bridge-domain mac-address location 0/0/CPU0"] }, { cells: ["Targeted sessions?", "show mpls ldp discovery"] }]} />
            <MiniTable title="Junos" cols={["Question", "Command"]} rows={[{ cells: ["PWs up? Labels?", "show vpls connections"] }, { cells: ["MAC table?", "show vpls mac-table"] }, { cells: ["Targeted sessions?", "show ldp neighbor"] }, { cells: ["LSPs?", "show route table inet.3"] }]} />
          </div>
        </>
      );
    case "trouble":
      return (
        <>
          {head}
          <Chain k="trouble" items={[{ t: "Ping each pair of sites: which pairs fail?", tone: "plain" }, { t: "Does every CE's VLAN land in the bridge?", tone: "cyan" }, { t: "Does every PE list every other PE?", tone: "violet" }, { t: "Is every pseudowire up — same VPLS ID and MTU?", tone: "violet" }, { t: "Is the transport LSP complete?", tone: "amber" }, { t: "Fix one thing, ping the failing pair again", tone: "green" }]} />
        </>
      );
    case "recap":
      return (
        <>
          {head}
          <Chain k="recap" items={[{ t: "Each PE is a bridge: attachment circuits + one pseudowire per other PE" }, { t: "Learn source MACs, unicast known destinations, flood the rest", tone: "cyan" }, { t: "Split horizon: never pseudowire to pseudowire — so the mesh must be full", tone: "violet" }, { t: "Same VPLS ID and MTU everywhere; PW label + transport label on the wire", tone: "amber" }, { t: "Test pairs of sites: a VPLS can half-work", tone: "green" }]} />
        </>
      );
  }
  return head;
}

export function VplsPresentation({ open, onClose, onFinish, finishLabel }: { open: boolean; onClose: () => void; onFinish: () => void; finishLabel: string }) {
  const [play, setPlay] = useState(0);
  return (
    <LessonPresentation
      open={open}
      onClose={onClose}
      title="MPLS VPLS, from zero"
      kicker="Learn · the VPLS presentation"
      steps={STEPS}
      visual={(s) => VISUAL[s.id as Id]}
      renderStage={(s) => <Deck step={s as Step} play={play} replay={() => setPlay((p) => p + 1)} />}
      finish={{ label: finishLabel, onClick: onFinish }}
      skip={{ label: "Skip →", onClick: onFinish }}
    />
  );
}
