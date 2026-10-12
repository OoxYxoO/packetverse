"use client";

import { useState, type ReactNode } from "react";
import { LessonPresentation } from "@/components/presentation/LessonPresentation";
import { Mover, StageHead, type DeckStep } from "@/components/presentation/ScrollyDeck";
import { Chain, Compare, MiniTable, ReplayButton, Token, Topo, nodeAt, short, type TopoLink, type TopoNode, type TopoView } from "@/components/presentation/Visuals";
import { useFitNodes } from "@/components/presentation/fitNarrow";

/**
 * H-VPLS — the presentation before the lesson and the H-VPLS Lab. Builds on VPLS (bridges, full mesh, split horizon).
 * Same devices, PW ID and labels (IOS XR numbering) as the lab. Presentation state only.
 */

type Id = "many" | "flat" | "idea" | "mtu" | "spoke" | "hubs" | "count" | "local" | "up" | "down" | "rule" | "full" | "xr" | "junos" | "labels" | "learn" | "cost" | "breaks" | "verify" | "trouble" | "recap";
type Step = DeckStep & { id: Id };
const B = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;

const STEPS: Step[] = [
  { id: "many", chapter: "The problem", title: "Many small sites.", body: <p>CUST-A&apos;s VPLS keeps growing: buildings, cabinets, branch offices — each with an access device in front of it. In flat VPLS, every one of them would be a PE in the full mesh.</p> },
  { id: "flat", chapter: "The problem", title: "A flat mesh doesn't scale.", body: <p>Six VPLS devices, full-meshed: <B>6 × 5 / 2 = 15</B> pseudowires and fifteen targeted LDP sessions. A hundred devices: 4950. And every new site means touching every existing PE.</p> },
  { id: "idea", chapter: "The idea", title: "Build a hierarchy.", body: <p><B>Hierarchical VPLS</B> (RFC 4762, section 10) splits the service into two tiers: small access bridges at the edge, a handful of hubs in the core.</p> },
  { id: "mtu", chapter: "The tiers", title: "MTU-s: a small bridge at the edge.", body: <p>An <B>MTU-s</B> (MTU1, MTU2, MTU3) is an ordinary Ethernet bridge for the customer: its attachment circuits face the CEs, and it learns and floods like any bridge.</p> },
  { id: "spoke", chapter: "The tiers", title: "One spoke per access device.", body: <p>Everything beyond its own ports, an MTU-s reaches through a single pseudowire — its <B>spoke</B> — to its hub. MTU1 to PE1, MTU2 to PE2, MTU3 to PE3. No MTU-s ever talks to another MTU-s directly.</p> },
  { id: "hubs", chapter: "The tiers", title: "PE-rs: the hubs, full-meshed.", body: <p>The <B>PE-rs</B> hubs (PE1, PE2, PE3) are full-meshed with each other — exactly the VPLS core you already know — and each terminates the spokes of its access devices.</p> },
  { id: "count", chapter: "The tiers", title: "Six pseudowires instead of fifteen.", body: <p>Three hubs need 3 mesh pseudowires; three access devices need 3 spokes: <B>6</B> in total. The hundredth access device costs one new spoke, nothing else.</p> },
  { id: "local", chapter: "Forwarding", title: "Neighbors stay local.", body: <p>CE1 and CE2 both sit behind MTU1. Once MTU1 has learned their MACs, their frames are switched on MTU1 — the spoke and the core never see them.</p> },
  { id: "up", chapter: "Forwarding", title: "Up the spoke, into the mesh.", body: <p>CE1 broadcasts. MTU1 floods it up its spoke. PE1 received it on a <B>spoke</B>, so it may flood it into the core: one copy to PE2, one to PE3.</p> },
  { id: "down", chapter: "Forwarding", title: "From the mesh, down the spokes.", body: <p>PE2 received its copy on a <B>mesh</B> pseudowire. It sends it down its spoke to MTU2 — and not on to PE3, which got its own copy from PE1. MTU2 and MTU3 deliver to their CEs.</p> },
  { id: "rule", chapter: "Split horizon", title: "Only mesh to mesh is forbidden.", body: <p>The core mesh is one <B>split-horizon group</B>: a frame from a mesh pseudowire never leaves on another mesh pseudowire. Spokes are outside that group — spoke to mesh, mesh to spoke and spoke to attachment circuit are all allowed.</p> },
  { id: "full", chapter: "Split horizon", title: "Which is why the core must stay full.", body: <p>If PE1 loses its mesh pseudowire to PE3, PE2 may not relay between them. CE1 and CE2 lose CE4, while CE1 ↔ CE3 and CE3 ↔ CE4 keep working.</p> },
  { id: "xr", chapter: "Configuring roles", title: "IOS XR: access pseudowires and the VFI.", body: <p>On a PE-rs, the mesh neighbors live in the <B>VFI</B> — the split-horizon group. A spoke is an <B>access pseudowire</B>: <span className="pv-mono">neighbor 10.0.0.1 pw-id 100</span> directly under the bridge domain. Put it inside the VFI and it becomes a mesh member.</p> },
  { id: "junos", chapter: "Configuring roles", title: "Junos: mesh groups.", body: <p>Neighbors directly under <span className="pv-mono">protocols vpls</span> form the default mesh group — the core. The spokes go in a mesh group of their own, with its own vpls-id (<span className="pv-mono">mesh-group SPOKES</span>); <span className="pv-mono">local-switching</span> lets its members talk to each other.</p> },
  { id: "labels", chapter: "Forwarding", title: "One label on the spoke, two across the core.", body: <p>MTU1 pushes <B>34011</B> — PE1&apos;s spoke label; PE1 is the next hop, so no transport label. PE1 pushes <B>25021</B> under P1&apos;s transport label; P1 pops it. PE2 pushes <B>44022</B>, MTU2&apos;s spoke label.</p> },
  { id: "learn", chapter: "Forwarding", title: "Every bridge learns for itself.", body: <p>After one exchange, CE1&apos;s MAC is known everywhere — on a different port at each device: an attachment circuit at MTU1, the spoke at PE1, the mesh pseudowire from PE1 at PE2 and PE3, the spoke at MTU2 and MTU3.</p> },
  { id: "cost", chapter: "Where it fits", title: "Hierarchy moves the work.", body: <p>The PE-rs still learn every remote MAC, replicate every broadcast and keep the core mesh. H-VPLS shrinks the number of pseudowires and the configuration at the edge — it doesn&apos;t make the hubs&apos; job smaller.</p> },
  { id: "breaks", chapter: "When it breaks", title: "Five ways an H-VPLS fails.", body: <p>A spoke configured as a mesh member, a spoke with the wrong PW ID, a missing mesh member, an attachment circuit on the wrong VLAN, a broken LSP between the hubs.</p> },
  { id: "verify", chapter: "Verify", title: "The questions engineers ask.", body: <p>Is every attachment circuit in its MTU-s bridge? Is every spoke up? Is the core mesh full? Does each PE-rs give each pseudowire the right role? Is the transport complete?</p> },
  { id: "trouble", chapter: "Troubleshooting", title: "When everything is up and nothing works.", body: <p>Every pseudowire can be up while frames still stop at a hub: a role is wrong, or the transport is. Test pairs of sites, then read which split-horizon group each pseudowire is in.</p> },
  { id: "recap", chapter: "The whole idea", title: "Spokes at the edge, a mesh in the core.", body: <p>Now watch it in the lesson, then break and fix it in the H-VPLS Lab.</p> },
];
const VISUAL: Record<Id, string> = Object.fromEntries(STEPS.map((s) => [s.id, ["breaks", "verify", "trouble", "recap", "cost"].includes(s.id) ? s.id : "topo"])) as Record<Id, string>;

const NODES: TopoNode[] = [
  { id: "CE1", label: "CE1", sub: "…100.1", icon: "CE", x: 6, y: 14 },
  { id: "CE2", label: "CE2", sub: "…100.2", icon: "CE", x: 6, y: 40 },
  { id: "MTU1", label: "MTU1", sub: "10.0.0.1", icon: "MTU-s", x: 21, y: 27 },
  { id: "PE1", label: "PE1", sub: "1.1.1.1", icon: "PE-rs", x: 40, y: 27 },
  { id: "P1", label: "P1", sub: "10.10.10.1", icon: "P", x: 55, y: 52 },
  { id: "PE2", label: "PE2", sub: "2.2.2.2", icon: "PE-rs", x: 40, y: 78 },
  { id: "MTU2", label: "MTU2", sub: "10.0.0.2", icon: "MTU-s", x: 21, y: 78 },
  { id: "CE3", label: "CE3", sub: "…100.3", icon: "CE", x: 6, y: 78 },
  { id: "PE3", label: "PE3", sub: "3.3.3.3", icon: "PE-rs", x: 71, y: 52 },
  { id: "MTU3", label: "MTU3", sub: "10.0.0.3", icon: "MTU-s", x: 85, y: 52 },
  { id: "CE4", label: "CE4", sub: "…100.4", icon: "CE", x: 96, y: 30 },
];
const ACC: [string, string][] = [["CE1", "MTU1"], ["CE2", "MTU1"], ["CE3", "MTU2"], ["MTU3", "CE4"]];
const PHYS: [string, string][] = [["PE1", "P1"], ["PE2", "P1"], ["PE3", "P1"]];
const SPOKES: [string, string][] = [["MTU1", "PE1"], ["MTU2", "PE2"], ["PE3", "MTU3"]];
const MESH: [string, string][] = [["PE1", "PE2"], ["PE1", "PE3"], ["PE2", "PE3"]];
const FLAT: [string, string][] = [["MTU1", "MTU2"], ["MTU1", "MTU3"], ["MTU1", "PE2"], ["MTU1", "PE3"], ["MTU2", "PE1"], ["MTU2", "MTU3"], ["MTU2", "PE3"], ["MTU3", "PE1"], ["MTU3", "PE2"]];

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
    const hier = !["many", "flat"].includes(id);
    const links: TopoLink[] = [
      ...ACC.map(([a, b]) => ({ a, b, state: "up" as TopoLink["state"] })),
      ...PHYS.map(([a, b]) => ({ a, b, state: "dim" as TopoLink["state"] })),
      ...(id === "many" ? SPOKES.map(([a, b]) => ({ a, b, state: "dim" as TopoLink["state"] })) : []),
      ...(id === "flat" ? [...SPOKES, ...MESH, ...FLAT].map(([a, b]) => ({ a, b, state: "blocked" as TopoLink["state"] })) : []),
      ...(hier && id !== "idea" && id !== "mtu" ? SPOKES.map(([a, b]) => ({ a, b, state: (id === "xr" || id === "junos") && a === "MTU1" ? "up" : "standby" as TopoLink["state"], label: ["spoke", "xr", "junos"].includes(id) ? "spoke" : "" })) : []),
      ...(hier && !["idea", "mtu", "spoke"].includes(id) ? MESH.map(([a, b]) => ({ a, b, state: (id === "full" && a === "PE1" && b === "PE3" ? "down" : "standby") as TopoLink["state"], label: id === "hubs" ? "mesh" : "" })) : []),
    ];
    const views: Record<string, TopoView> = {};
    let movers: ReactNode = null;
    if (id === "many") {
      for (const m of ["MTU1", "MTU2", "MTU3"]) views[m] = { ring: "on" };
      views.P1 = { bubble: { text: "every access device a PE?", tone: "warn" } };
    }
    if (id === "flat") views.P1 = { bubble: { text: "15 pseudowires", tone: "bad" } };
    if (id === "idea") {
      views.MTU1 = { badge: { text: "access", tone: "info" } };
      views.PE1 = { badge: { text: "core", tone: "info" } };
    }
    if (id === "mtu") views.MTU1 = { bubble: { text: "a bridge: learns, floods", tone: "yes" } };
    if (id === "spoke") views.MTU2 = { bubble: { text: "one pseudowire", tone: "yes" } };
    if (id === "hubs") views.P1 = { bubble: { text: "3 hubs, full mesh", tone: "yes" } };
    if (id === "count") views.P1 = { bubble: { text: "3 mesh + 3 spokes = 6", tone: "yes" } };
    if (id === "local") {
      movers = <>{go("CE1", "MTU1", { label: "to CE2", key: "1", color: "green" })}{go("MTU1", "CE2", { label: "local", key: "2", delay: 900, color: "green" })}</>;
      views.PE1 = { ring: "dim", bubble: { text: "sees nothing", tone: "no", delay: 1200 } };
    }
    if (id === "up") {
      movers = <>{go("CE1", "MTU1", { label: "broadcast", key: "1", color: "amber" })}{go("MTU1", "PE1", { label: "spoke", key: "2", delay: 800, color: "amber" })}{go("PE1", "PE2", { label: "copy", key: "3", delay: 1600, color: "amber" })}{go("PE1", "PE3", { label: "copy", key: "4", delay: 1600, color: "amber" })}</>;
      views.PE1 = { bubble: { text: "from a spoke → into the mesh", tone: "yes", delay: 1300 } };
    }
    if (id === "down") {
      movers = <>{go("PE2", "MTU2", { label: "down the spoke", key: "1", color: "amber" })}{go("PE3", "MTU3", { label: "down the spoke", key: "2", color: "amber" })}{go("PE2", "PE3", { label: "✕", key: "3", delay: 300, stay: true, color: "red" })}{go("MTU2", "CE3", { label: "copy", key: "4", delay: 900, color: "amber" })}{go("MTU3", "CE4", { label: "copy", key: "5", delay: 900, color: "amber" })}</>;
    }
    if (id === "rule") {
      views.PE2 = { bubble: { text: "mesh → mesh ✕", tone: "warn" } };
    }
    if (id === "full") {
      views.PE2 = { bubble: { text: "can't relay (same group)", tone: "warn" } };
      views.CE4 = { ring: "bad", bubble: { text: "lost from CE1, CE2", tone: "bad", delay: 400 } };
    }
    if (id === "xr") {
      views.PE1 = { bubble: { text: "neighbor 10.0.0.1 = access PW", tone: "info" } };
      views.P1 = { bubble: { text: "VFI: 2.2.2.2, 3.3.3.3", tone: "info", delay: 400 } };
    }
    if (id === "junos") {
      views.PE1 = { bubble: { text: "mesh-group SPOKES: 10.0.0.1", tone: "info" } };
      views.P1 = { bubble: { text: "default group: 2.2.2.2, 3.3.3.3", tone: "info", delay: 400 } };
    }
    if (id === "labels") {
      movers = <>{go("MTU1", "PE1", { label: "34011", key: "1", color: "cyan" })}{go("PE1", "P1", { label: "24702 | 25021", key: "2", delay: 800, color: "violet" })}{go("P1", "PE2", { label: "25021", key: "3", delay: 1600, color: "cyan" })}{go("PE2", "MTU2", { label: "44022", key: "4", delay: 2400, color: "cyan" })}</>;
      views.P1 = { badge: { text: "PHP", tone: "warn" } };
    }
    if (id === "learn") {
      views.MTU1 = { bubble: { text: "CE1 → AC", tone: "info" } };
      views.PE1 = { bubble: { text: "CE1 → spoke MTU1", tone: "info", delay: 200 } };
      views.PE2 = { bubble: { text: "CE1 → mesh PE1", tone: "info", delay: 400 } };
      views.MTU2 = { bubble: { text: "CE1 → PE2", tone: "info", delay: 600 } };
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
    case "cost":
      return (
        <>
          {head}
          <Compare items={[{ title: "MTU-s", tone: "violet", body: "its own sites and one spoke — small table, simple configuration" }, { title: "PE-rs", tone: "amber", body: "every remote MAC, every flooded copy, the core mesh and all its spokes" }, { title: "Flat VPLS", tone: "cyan", body: "every device carries the whole mesh" }]} />
        </>
      );
    case "breaks":
      return (
        <>
          {head}
          <MiniTable title="How an H-VPLS fails" cols={["Fault", "What you see"]} rows={[{ cells: ["Spoke configured as a mesh member", "every PW up; that access site reaches only itself"], state: "hit" }, { cells: ["Spoke PW ID mismatch", "that spoke down; site isolated"] }, { cells: ["Missing mesh member", "one pair of hubs' sites cut"] }, { cells: ["AC on the wrong VLAN", "one site silent, even locally"] }, { cells: ["Transport broken", "XR: PWs up, drops in the core · Junos: PWs down"] }]} />
        </>
      );
    case "verify":
      return (
        <>
          {head}
          <div className="grid gap-2 sm:grid-cols-2">
            <MiniTable title="IOS XR" cols={["Question", "Command"]} rows={[{ cells: ["Access PWs vs VFI?", "show l2vpn bridge-domain"] }, { cells: ["Labels, MTU, split horizon?", "show l2vpn bridge-domain detail"] }, { cells: ["MAC table?", "show l2vpn forwarding bridge-domain mac-address location 0/0/CPU0"] }, { cells: ["Targeted sessions?", "show mpls ldp discovery"] }]} />
            <MiniTable title="Junos" cols={["Question", "Command"]} rows={[{ cells: ["PWs by mesh group?", "show vpls connections"] }, { cells: ["MAC table?", "show vpls mac-table"] }, { cells: ["Targeted sessions?", "show ldp neighbor"] }, { cells: ["LSPs?", "show route table inet.3"] }]} />
          </div>
        </>
      );
    case "trouble":
      return (
        <>
          {head}
          <Chain k="trouble" items={[{ t: "Ping pairs of sites: one site, one pair, or one access device?", tone: "plain" }, { t: "Is each CE's VLAN in its MTU-s bridge?", tone: "cyan" }, { t: "Is every spoke up — same PW ID and MTU?", tone: "violet" }, { t: "Is the core mesh full?", tone: "violet" }, { t: "Is every pseudowire in the right group — spokes outside the VFI / default group?", tone: "amber" }, { t: "Is the transport complete?", tone: "amber" }, { t: "Fix one thing, ping the failing pair again", tone: "green" }]} />
        </>
      );
    case "recap":
      return (
        <>
          {head}
          <Chain k="recap" items={[{ t: "MTU-s: a bridge with its sites and one spoke to its hub" }, { t: "PE-rs: a full mesh among the hubs, plus their spokes", tone: "cyan" }, { t: "Only mesh to mesh is forbidden — so the core mesh must be full", tone: "violet" }, { t: "Roles live in the configuration: access PW vs VFI, mesh group vs default group", tone: "amber" }, { t: "Every PW can be up while a wrong role stops the frames", tone: "green" }]} />
        </>
      );
  }
  return head;
}

export function HvplsPresentation({ open, onClose, onFinish, finishLabel }: { open: boolean; onClose: () => void; onFinish: () => void; finishLabel: string }) {
  const [play, setPlay] = useState(0);
  return (
    <LessonPresentation
      open={open}
      onClose={onClose}
      title="H-VPLS, from zero"
      kicker="Learn · the H-VPLS presentation"
      steps={STEPS}
      visual={(s) => VISUAL[s.id as Id]}
      renderStage={(s) => <Deck step={s as Step} play={play} replay={() => setPlay((p) => p + 1)} />}
      finish={{ label: finishLabel, onClick: onFinish }}
      skip={{ label: "Skip →", onClick: onFinish }}
    />
  );
}
