"use client";

import { useState, type ReactNode } from "react";
import { LessonPresentation } from "@/components/presentation/LessonPresentation";
import { Mover, StageHead, type DeckStep } from "@/components/presentation/ScrollyDeck";
import { Chain, Compare, MiniTable, ReplayButton, Token, Topo, nodeAt, short, type TopoLink, type TopoNode, type TopoView } from "@/components/presentation/Visuals";
import { useFitNodes } from "@/components/presentation/fitNarrow";

/**
 * BGP VPLS — the presentation before the lesson and the BGP VPLS Lab. Builds on LDP VPLS (bridges, full mesh, split
 * horizon) and on the route reflector. Same routers, RDs, RT, VE IDs and labels (IOS XR numbering) as the lab.
 * Presentation state only.
 */

type Id = "same" | "burden" | "idea" | "rr" | "route" | "rdrt" | "import" | "reflect" | "block" | "math" | "grow" | "unique" | "data" | "labels" | "variant" | "compare" | "breaks" | "verify" | "trouble" | "recap";
type Step = DeckStep & { id: Id };
const B = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;

const STEPS: Step[] = [
  { id: "same", chapter: "The problem", title: "The same three sites, the same LAN.", body: <p>CUST-A still wants one Ethernet segment across PE1, PE2 and PE3. The last lesson built it with LDP: a bridge on every PE and a full mesh of pseudowires.</p> },
  { id: "burden", chapter: "The problem", title: "Every PE lists every other PE.", body: <p>With LDP signaling, each PE names its neighbors by hand. Adding a fourth site means a new neighbor statement on <B>every</B> existing PE, plus targeted LDP sessions between every pair. At fifty PEs that is 1225 sessions and a lot of typing.</p> },
  { id: "idea", chapter: "The idea", title: "Let BGP find the members.", body: <p><B>BGP VPLS</B> (RFC 4761) uses BGP for both jobs: <B>auto-discovery</B> — who belongs to this VPLS — and <B>signaling</B> — which labels to use. The PEs configure only themselves.</p> },
  { id: "rr", chapter: "The idea", title: "One session per PE.", body: <p>Each PE peers with a route reflector, <B>RR1</B> (9.9.9.9), for the L2VPN VPLS address family. RR1 is pure control plane: no customer frame ever crosses it, and P1–P3 stay BGP-free.</p> },
  { id: "route", chapter: "Discovery", title: "Each PE advertises one route.", body: <p>PE1 announces: RD <B>65000:1</B>, VE ID <B>1</B>, a label block starting at <B>24000</B>, route target <B>65000:100</B>, MTU 1500. PE2 and PE3 announce the same kind of route with their own RD, VE ID and block.</p> },
  { id: "rdrt", chapter: "Discovery", title: "RD makes it unique, RT says which VPLS.", body: <p>The route distinguisher only keeps the three routes apart in BGP. The <B>route target</B> is what matters: a PE imports every VPLS route carrying an RT it is configured with.</p> },
  { id: "import", chapter: "Discovery", title: "Importing a route is discovering a PE.", body: <p>When PE1 imports PE3&apos;s route, it has learned three things at once: PE3 is a member (its next hop 3.3.3.3), PE3&apos;s VE ID is 3, and PE3&apos;s label block. That is enough to build the pseudowire — no neighbor statement, no targeted session.</p> },
  { id: "reflect", chapter: "Discovery", title: "The route reflector passes it on.", body: <p>iBGP normally forbids passing a route from one iBGP peer to another. A route reflector bends that rule for its <B>clients</B>: a client&apos;s route goes to every peer. Forget to mark the PEs as clients and RR1 holds every route and gives them to nobody.</p> },
  { id: "block", chapter: "Signaling", title: "Labels come in blocks.", body: <p>Instead of one label message per neighbor, each PE advertises a <B>label block</B>: a base, a size (IOS XR: 10, Junos: 8) and an offset — the first VE ID the block serves. PE1&apos;s block: labels 24000–24009 for VE IDs 1–10.</p> },
  { id: "math", chapter: "Signaling", title: "Label = base + VE ID − offset.", body: <p>PE1 (VE 1) sends to PE3 with <B>26000 + 1 − 1 = 26000</B>. PE2 (VE 2) sends to PE3 with 26001. PE3 receives each on a different label, so it still knows which neighbor — which bridge port — a frame came from.</p> },
  { id: "grow", chapter: "Signaling", title: "A VE ID outside the block? Add a block.", body: <p>Renumber PE3 to VE ID 12. PE1 and PE2 import its route, see 12, and each advertise a <B>second block</B> with offset 11 (Junos: 9). Nobody reconfigures anything — the blocks follow the VE IDs.</p> },
  { id: "unique", chapter: "Signaling", title: "VE IDs must be unique.", body: <p>Two PEs with the same VE ID would both claim the same label slot. PE1 and PE3 with VE 1 see a <B>collision</B> and bring nothing up between them; PE2 keeps only the one with the lower loopback.</p> },
  { id: "data", chapter: "Forwarding", title: "Then it's the VPLS you know.", body: <p>Once the pseudowires are up, nothing changes: each PE learns source MACs, floods broadcast and unknown unicast, and never sends a pseudowire&apos;s frame out another pseudowire (split horizon).</p> },
  { id: "labels", chapter: "Forwarding", title: "Two labels on the wire.", body: <p>To reach CE3, PE1 pushes <B>26000</B> — computed from PE3&apos;s block — then the LDP transport label toward 3.3.3.3. P1 swaps, P3 pops, PE3 sees 26000 and knows: VE 1, PE1.</p> },
  { id: "variant", chapter: "Where it fits", title: "A cousin: BGP discovery, LDP signaling.", body: <p>RFC 6074 keeps BGP for auto-discovery but signals the pseudowires with targeted LDP (on IOS XR: <B>signaling-protocol ldp</B>). This lesson uses BGP for both, as RFC 4761 does.</p> },
  { id: "compare", chapter: "Where it fits", title: "LDP VPLS vs BGP VPLS.", body: <p>Same data plane, different control plane. The difference shows when the network grows.</p> },
  { id: "breaks", chapter: "When it breaks", title: "Five ways a BGP VPLS fails.", body: <p>A wrong route target, a missing address family, a route reflector that doesn&apos;t reflect, a duplicated VE ID, a broken transport LSP.</p> },
  { id: "verify", chapter: "Verify", title: "The questions engineers ask.", body: <p>Does every PE exchange VPLS routes with RR1? Has every PE imported every other PE&apos;s route? Is every pseudowire up with labels both ways? Is the LSP underneath complete?</p> },
  { id: "trouble", chapter: "Troubleshooting", title: "Follow the route, then the frame.", body: <p>An Established session proves little. Follow the VPLS route from the PE that sends it, through RR1, to the PE that should import it — then follow the frame.</p> },
  { id: "recap", chapter: "The whole idea", title: "Advertise yourself, import the others.", body: <p>Now watch it in the lesson, then break and fix it in the BGP VPLS Lab.</p> },
];
const VISUAL: Record<Id, string> = Object.fromEntries(STEPS.map((s) => [s.id, ["compare", "breaks", "verify", "trouble", "recap"].includes(s.id) ? s.id : "topo"])) as Record<Id, string>;

const NODES: TopoNode[] = [
  { id: "CE1", label: "CE1", sub: "…100.1", icon: "CE", x: 7, y: 56 },
  { id: "PE1", label: "PE1", sub: "1.1.1.1 · VE 1", icon: "PE", x: 24, y: 56 },
  { id: "P1", label: "P1", sub: "10.10.10.1", icon: "P", x: 42, y: 56 },
  { id: "RR1", label: "RR1", sub: "9.9.9.9", icon: "RR", x: 42, y: 14 },
  { id: "P2", label: "P2", sub: "10.10.10.2", icon: "P", x: 60, y: 32 },
  { id: "P3", label: "P3", sub: "10.10.10.3", icon: "P", x: 60, y: 84 },
  { id: "PE2", label: "PE2", sub: "2.2.2.2 · VE 2", icon: "PE", x: 78, y: 32 },
  { id: "PE3", label: "PE3", sub: "3.3.3.3 · VE 3", icon: "PE", x: 78, y: 84 },
  { id: "CE2", label: "CE2", sub: "…100.2", icon: "CE", x: 94, y: 32 },
  { id: "CE3", label: "CE3", sub: "…100.3", icon: "CE", x: 94, y: 84 },
];
const PHYS: [string, string][] = [["CE1", "PE1"], ["PE1", "P1"], ["P1", "P2"], ["P1", "P3"], ["P2", "PE2"], ["P3", "PE3"], ["PE2", "CE2"], ["PE3", "CE3"], ["P1", "RR1"]];
const MESH: [string, string][] = [["PE1", "PE2"], ["PE1", "PE3"], ["PE2", "PE3"]];
const BGP: [string, string][] = [["PE1", "RR1"], ["PE2", "RR1"], ["PE3", "RR1"]];
const BGP_STEPS: Id[] = ["rr", "route", "rdrt", "import", "reflect", "grow"];
const MESH_STEPS: Id[] = ["same", "burden", "import", "math", "unique", "data", "labels"];

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
    const showBgp = BGP_STEPS.includes(id) || ["idea", "block", "variant"].includes(id);
    const showMesh = MESH_STEPS.includes(id);
    const links: TopoLink[] = [
      ...PHYS.map(([a, b]) => ({ a, b, state: ((showMesh || showBgp) && !a.startsWith("CE") && !b.startsWith("CE") ? "dim" : "up") as TopoLink["state"] })),
      ...(showBgp ? BGP.map(([a, b]) => ({ a, b, state: (id === "reflect" ? "blocked" : "standby") as TopoLink["state"], label: id === "rr" ? "iBGP L2VPN" : "" })) : []),
      ...(showMesh ? MESH.map(([a, b]) => ({ a, b, state: (id === "unique" && (a === "PE1" && b === "PE3") ? "down" : id === "unique" && a === "PE2" && b === "PE3" ? "down" : "standby") as TopoLink["state"], label: id === "burden" ? "neighbor ×2" : "" })) : []),
    ];
    const views: Record<string, TopoView> = {};
    let movers: ReactNode = null;
    if (id === "same") {
      views.CE1 = { ring: "on" };
      views.CE2 = { ring: "on" };
      views.CE3 = { ring: "on", bubble: { text: "one subnet: 192.168.100.0/24", tone: "info" } };
    }
    if (id === "burden") {
      views.PE1 = { bubble: { text: "neighbors 2.2.2.2, 3.3.3.3", tone: "warn" } };
      views.PE3 = { bubble: { text: "edit every PE", tone: "warn", delay: 500 } };
    }
    if (id === "idea") views.RR1 = { bubble: { text: "discovery + signaling in BGP", tone: "yes" } };
    if (id === "rr") {
      views.RR1 = { badge: { text: "control plane only", tone: "info" } };
      views.P2 = { bubble: { text: "BGP-free core", tone: "info" } };
    }
    if (id === "route") {
      movers = <>{go("PE1", "RR1", { label: "65000:1 · VE 1 · 24000 · RT 65000:100", key: "1", color: "violet" })}</>;
      views.RR1 = { badge: { text: "3 routes", tone: "info" } };
    }
    if (id === "rdrt") {
      views.PE1 = { bubble: { text: "RD 65000:1", tone: "info" } };
      views.PE2 = { bubble: { text: "RD 65000:2", tone: "info" } };
      views.PE3 = { bubble: { text: "RT 65000:100", tone: "yes" } };
    }
    if (id === "import") {
      movers = <>{go("PE3", "RR1", { label: "VE 3 · 26000", key: "1", color: "violet" })}{go("RR1", "PE1", { label: "VE 3 · 26000", key: "2", delay: 900, color: "violet" })}</>;
      views.PE1 = { bubble: { text: "imported → PE3 is a member", tone: "yes", delay: 1800 } };
    }
    if (id === "reflect") {
      movers = <>{go("PE1", "RR1", { label: "route", key: "1", color: "violet" })}{go("RR1", "PE3", { label: "✕ not a client", key: "2", delay: 900, stay: true, color: "red" })}</>;
      views.RR1 = { bubble: { text: "only reflects for clients", tone: "warn", delay: 1200 } };
    }
    if (id === "block") {
      views.PE1 = { badge: { text: "24000–24009", tone: "info" } };
      views.PE2 = { badge: { text: "25000–25009", tone: "info" } };
      views.PE3 = { badge: { text: "26000–26009", tone: "info" } };
    }
    if (id === "math") {
      views.PE3 = { bubble: { text: "26000 · 26001", tone: "yes" } };
      views.PE1 = { bubble: { text: "26000 + 1 − 1", tone: "info" } };
    }
    if (id === "grow") {
      movers = <>{go("PE3", "RR1", { label: "VE 12", key: "1", color: "violet" })}{go("PE1", "RR1", { label: "new block @11: 24100", key: "2", delay: 1000, color: "amber" })}{go("PE2", "RR1", { label: "new block @11: 25100", key: "3", delay: 1200, color: "amber" })}</>;
    }
    if (id === "unique") {
      views.PE1 = { ring: "bad", bubble: { text: "VE 1", tone: "bad" } };
      views.PE3 = { ring: "bad", bubble: { text: "VE 1 — collision", tone: "bad" } };
      views.PE2 = { bubble: { text: "keeps PE1 (lower loopback)", tone: "warn", delay: 400 } };
    }
    if (id === "data") {
      movers = <>{go("CE1", "PE1", { label: "ARP broadcast", key: "1", color: "amber" })}{go("PE1", "PE2", { label: "copy", key: "2", delay: 900, color: "amber" })}{go("PE1", "PE3", { label: "copy", key: "3", delay: 900, color: "amber" })}</>;
      views.PE2 = { bubble: { text: "learn · flood · split horizon", tone: "info", delay: 1500 } };
    }
    if (id === "labels") {
      movers = <>{go("PE1", "P1", { label: "24104 | 26000", key: "1", color: "violet" })}{go("P1", "P3", { label: "24306 | 26000", key: "2", delay: 800, color: "violet" })}{go("P3", "PE3", { label: "26000", key: "3", delay: 1600, color: "violet" })}</>;
      views.P3 = { badge: { text: "PHP", tone: "warn" } };
    }
    if (id === "variant") views.RR1 = { bubble: { text: "BGP finds · LDP signals", tone: "info" } };
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
          <Compare items={[{ title: "LDP VPLS", tone: "violet", body: "neighbors listed on every PE · targeted LDP per pair · one label per neighbor" }, { title: "BGP VPLS", tone: "amber", body: "members found by RT import · one session to the RR · label blocks + VE IDs" }, { title: "Both", tone: "cyan", body: "bridges, full mesh, split horizon, PW label over transport label" }]} />
        </>
      );
    case "breaks":
      return (
        <>
          {head}
          <MiniTable title="How a BGP VPLS fails" cols={["Fault", "What you see"]} rows={[{ cells: ["Wrong route target on a PE", "RR1 holds its route; nobody imports it"], state: "hit" }, { cells: ["L2VPN family missing", "session Established, zero VPLS routes"] }, { cells: ["PEs not RR clients", "RR1 has every route, PEs have none"] }, { cells: ["Duplicate VE ID", "collision: that PE's pseudowires down"] }, { cells: ["Transport broken", "XR: PWs up, drops in the core · Junos: PWs down"] }]} />
        </>
      );
    case "verify":
      return (
        <>
          {head}
          <div className="grid gap-2 sm:grid-cols-2">
            <MiniTable title="IOS XR" cols={["Question", "Command"]} rows={[{ cells: ["Sessions, routes received?", "show bgp l2vpn vpls summary"] }, { cells: ["Which routes, which blocks?", "show bgp l2vpn vpls"] }, { cells: ["PWs, VE IDs, labels?", "show l2vpn bridge-domain detail"] }, { cells: ["MAC table?", "show l2vpn forwarding bridge-domain mac-address location 0/0/CPU0"] }]} />
            <MiniTable title="Junos" cols={["Question", "Command"]} rows={[{ cells: ["Sessions, routes received?", "show bgp summary"] }, { cells: ["Which routes, which blocks?", "show route table bgp.l2vpn.0 detail"] }, { cells: ["PWs, sites, labels?", "show vpls connections"] }, { cells: ["MAC table?", "show vpls mac-table"] }]} />
          </div>
        </>
      );
    case "trouble":
      return (
        <>
          {head}
          <Chain k="trouble" items={[{ t: "Ping each pair of sites: which pairs fail?", tone: "plain" }, { t: "Does every CE's VLAN land in the VPLS?", tone: "cyan" }, { t: "Does every PE exchange L2VPN VPLS routes with RR1?", tone: "violet" }, { t: "Has every PE imported every other PE's route?", tone: "violet" }, { t: "Is every pseudowire up — unique VE IDs, same MTU?", tone: "violet" }, { t: "Is the transport LSP complete?", tone: "amber" }, { t: "Fix one thing, ping the failing pair again", tone: "green" }]} />
        </>
      );
    case "recap":
      return (
        <>
          {head}
          <Chain k="recap" items={[{ t: "Each PE advertises one VPLS route: RD, VE ID, label block, RT" }, { t: "Importing the RT discovers the PE — one session each to the route reflector", tone: "cyan" }, { t: "Label = base + VE ID − offset; VE IDs unique, blocks grow on their own", tone: "violet" }, { t: "Then the same bridge: learn, flood, split horizon, two labels", tone: "amber" }, { t: "Follow the route through RR1, then follow the frame", tone: "green" }]} />
        </>
      );
  }
  return head;
}

export function BgpVplsPresentation({ open, onClose, onFinish, finishLabel }: { open: boolean; onClose: () => void; onFinish: () => void; finishLabel: string }) {
  const [play, setPlay] = useState(0);
  return (
    <LessonPresentation
      open={open}
      onClose={onClose}
      title="BGP VPLS, from zero"
      kicker="Learn · the BGP VPLS presentation"
      steps={STEPS}
      visual={(s) => VISUAL[s.id as Id]}
      renderStage={(s) => <Deck step={s as Step} play={play} replay={() => setPlay((p) => p + 1)} />}
      finish={{ label: finishLabel, onClick: onFinish }}
      skip={{ label: "Skip →", onClick: onFinish }}
    />
  );
}
