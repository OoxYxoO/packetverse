"use client";

import { useState, type ReactNode } from "react";
import { LessonPresentation } from "@/components/presentation/LessonPresentation";
import { Mover, StageHead, type DeckStep } from "@/components/presentation/ScrollyDeck";
import { Chain, Compare, MiniTable, ReplayButton, Token, Topo, nodeAt, short, type TopoLink, type TopoNode, type TopoView } from "@/components/presentation/Visuals";
import { useFitNodes } from "@/components/presentation/fitNarrow";

/**
 * MPLS RSVP-TE — the presentation before the lesson and the RSVP-TE Lab. Builds on IS-IS (link-state flooding, SPF) and
 * MPLS (labels, push / swap / pop). Same routers, loopbacks, bandwidths and labels as the lab (IOS XR numbering) and the
 * guided lesson's R1 → R6 500 Mbps tunnel. Presentation state only.
 */

type Id = "video" | "igp" | "busy" | "metrics" | "ted" | "prune" | "spf" | "ero" | "path" | "resv" | "fwd" | "autoroute" | "oneway" | "unres" | "explicit" | "affinity" | "priority" | "mbb" | "breaks" | "verify" | "recap";
type Step = DeckStep & { id: Id };
const B = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;

const STEPS: Step[] = [
  { id: "video", chapter: "The problem", title: "A 500 Mbps stream has to cross the core.", body: <p>CE1, behind R1, sends a <B>500 Mbps</B> video stream to CE6, behind R6. Two ways lead there: the top (R2, R4) and the bottom (R3, R5). Every link is 1 Gbps.</p> },
  { id: "igp", chapter: "The problem", title: "IS-IS picks the cheapest path.", body: <p>Top links cost 10, bottom links 15: R1–R2–R4–R6 costs 30, R1–R3–R5–R6 costs 45. IS-IS sends the stream over the top — and so does every other flow toward R6.</p> },
  { id: "busy", chapter: "The problem", title: "The cheapest path is already full.", body: <p>R2–R4 already carries <B>800 Mbps</B>. Add 500 and the link would need 1300 Mbps: a quarter of the video is dropped, while the bottom path sits half empty. IS-IS never looks at load.</p> },
  { id: "metrics", chapter: "The problem", title: "Changing metrics moves everything.", body: <p>Raise the top metric and <B>all</B> traffic toward R6 moves to the bottom — now that path overflows. A metric is one knob for every flow. What we want is a path for <B>this</B> flow, with room for it.</p> },
  { id: "ted", chapter: "The TED", title: "IS-IS floods what TE needs.", body: <p>With TE extensions every router also floods, per link: a <B>TE metric</B>, its <B>reservable bandwidth</B>, what is still <B>unreserved</B> at each of 8 priorities, and <B>colors</B>. R2–R4 offers only 200 Mbps reservable — the headroom it really has. Every router builds the same <B>Traffic Engineering Database</B>.</p> },
  { id: "prune", chapter: "CSPF", title: "Step 1: remove what can't carry it.", body: <p>R1, the <B>headend</B>, runs <B>Constrained SPF</B> for 500 Mbps. First it removes every link direction that can&apos;t carry the request: R2–R4 (200 Mbps reservable) is gone.</p> },
  { id: "spf", chapter: "CSPF", title: "Step 2: shortest path on what's left.", body: <p>An ordinary SPF on the remaining links, by TE metric: R1–R3–R5–R6. CSPF only computes a path — nothing has been reserved or labeled yet.</p> },
  { id: "ero", chapter: "Signaling", title: "The path becomes an ERO.", body: <p>R1 writes the result into an <B>Explicit Route Object</B>: 3.3.3.3, 5.5.5.5, 6.6.6.6, every hop strict. The ERO tells each router where to send the request next.</p> },
  { id: "path", chapter: "Signaling", title: "PATH goes downstream.", body: <p>R1 sends an RSVP <B>PATH</B> message along the ERO with the bandwidth (500 Mbps) and the priorities. Each hop checks it can admit the bandwidth on its outgoing interface and passes PATH on, down to R6, the <B>tail</B>.</p> },
  { id: "resv", chapter: "Signaling", title: "RESV comes back with labels.", body: <p>R6 answers with <B>RESV</B>, label implicit-null (&quot;pop before me&quot;). Going upstream, every hop <B>reserves</B> 500 Mbps on its outgoing interface and picks its own label: R5 asks for 24401, R3 for 24201. Now the LSP is up.</p> },
  { id: "fwd", chapter: "Forwarding", title: "Push, swap, pop — on the engineered path.", body: <p>R1 <B>pushes</B> 24201, R3 <B>swaps</B> it for 24401, R5 <B>pops</B> it (PHP) and R6 delivers plain IP. The labels are MPLS as you know it; only the path was chosen differently.</p> },
  { id: "autoroute", chapter: "Forwarding", title: "Up is not used.", body: <p>An LSP that is up carries nothing until routing points at it. <B>autoroute announce</B> (IOS XR) or <B>IS-IS shortcuts</B> (Junos) make IS-IS use the tunnel for R6 and everything behind it. Forget it, and the stream still crosses R2–R4.</p> },
  { id: "oneway", chapter: "Forwarding", title: "An LSP goes one way.", body: <p>CE6&apos;s traffic back to CE1 doesn&apos;t use tunnel-te1: PATH and RESV built one direction only. The way back follows IS-IS — over R4–R2 — unless R6 builds its own tunnel to R1.</p> },
  { id: "unres", chapter: "Bandwidth", title: "Reservations are flooded too.", body: <p>CUST-B already holds 400 Mbps from R3 to R5. With tunnel-te1&apos;s 500, R3–R5 has <B>100 Mbps</B> unreserved left — and IS-IS floods that, so the next CSPF anywhere in the network knows.</p> },
  { id: "explicit", chapter: "Constraints", title: "Explicit paths pin the route.", body: <p>An explicit path lists hops: <B>strict</B> (must be the very next router) or <B>loose</B> (reach it any way). A 150 Mbps tunnel pinned to 2.2.2.2, 4.4.4.4 fits the top — R2–R4 still offers 200. A strict hop that isn&apos;t adjacent makes the path impossible.</p> },
  { id: "affinity", chapter: "Constraints", title: "Colors include or exclude links.", body: <p>Links carry colors (affinity bits): here top links are BLUE, bottom links GOLD, R4–R5 RED. A tunnel that must <B>include GOLD</B> can only use GOLD links; one that <B>excludes RED</B> never crosses R4–R5.</p> },
  { id: "priority", chapter: "Priorities", title: "Better priority wins the bandwidth.", body: <p>Each LSP has a <B>setup</B> and a <B>hold</B> priority (0 best, 7 worst). An LSP with a better setup priority may take bandwidth from LSPs with a worse hold priority — they are <B>preempted</B>. But CUST-B&apos;s traffic doesn&apos;t vanish with its reservation: a reservation never adds capacity.</p> },
  { id: "mbb", chapter: "Priorities", title: "Make-before-break.", body: <p>Grow a tunnel and the headend signals a <B>new</B> LSP first, moving traffic only when it is up. If the new size can&apos;t be signaled, the old LSP simply stays — with its old bandwidth.</p> },
  { id: "breaks", chapter: "When it breaks", title: "Five ways an engineered path fails.", body: <p>No path with enough unreserved bandwidth, a link missing from the TED, an impossible explicit path, a color that no longer matches — or a perfect LSP that no traffic uses.</p> },
  { id: "verify", chapter: "Verify", title: "The questions engineers ask.", body: <p>Is the LSP up, and on which path? Is every link in the TED, both ways? Who holds the bandwidth? Is traffic routed into the tunnel? What does a fresh flow do?</p> },
  { id: "recap", chapter: "The whole idea", title: "Constrain, signal, reserve, route into it.", body: <p>Now watch it in the lesson, then break and fix it in the RSVP-TE Lab.</p> },
];
const VISUAL: Record<Id, string> = Object.fromEntries(STEPS.map((s) => [s.id, ["metrics", "breaks", "verify", "recap"].includes(s.id) ? s.id : "topo"])) as Record<Id, string>;

const NODES: TopoNode[] = [
  { id: "R1", label: "R1", sub: "1.1.1.1", icon: "PE", x: 10, y: 50 },
  { id: "R2", label: "R2", sub: "2.2.2.2", icon: "P", x: 36, y: 16 },
  { id: "R4", label: "R4", sub: "4.4.4.4", icon: "P", x: 64, y: 16 },
  { id: "R3", label: "R3", sub: "3.3.3.3", icon: "P", x: 36, y: 84 },
  { id: "R5", label: "R5", sub: "5.5.5.5", icon: "P", x: 64, y: 84 },
  { id: "R6", label: "R6", sub: "6.6.6.6", icon: "PE", x: 90, y: 50 },
];
const TOP = ["R1", "R2", "R4", "R6"];
const BOT = ["R1", "R3", "R5", "R6"];
const pairs = (p: string[]) => p.slice(1).map((x, i) => [p[i], x] as [string, string]);
const onPath = (p: string[], a: string, b: string) => pairs(p).some(([x, y]) => (x === a && y === b) || (x === b && y === a));

function Deck({ step: s, play, replay }: { step: Step; play: number; replay: () => void }) {
  const FIT = useFitNodes(NODES, 300);
  const id = s.id;
  const k = `${id}-${play}`;
  const head = <StageHead chapter={s.chapter} title={s.title} />;
  const go = (f: string, t: string, o: { label: string; key: string; delay?: number; stay?: boolean; color?: string; dy?: number }) => {
    const a = nodeAt(FIT.nodes, f);
    const b = nodeAt(FIT.nodes, t);
    const from: [number, number] = [a[0], a[1] + (o.dy ?? 0)];
    const to: [number, number] = [b[0], b[1] + (o.dy ?? 0)];
    return (
      <Mover key={`${k}-${o.key}`} from={from} to={o.stay ? short(from, to) : to} delay={o.delay} duration={800} stay={o.stay}>
        <Token color={o.color ?? "cyan"}>{o.label}</Token>
      </Mover>
    );
  };
  const along = (p: string[], label: (i: number) => string, color: string, step = 700, key = "a", start = 0) => pairs(p).map(([a, b], i) => go(a, b, { label: label(i), key: `${key}${i}`, delay: start + i * step, color }));

  if (VISUAL[id] === "topo") {
    const lbl: Record<string, string> = { "R1-R2": "10", "R2-R4": "10", "R4-R6": "10", "R1-R3": "15", "R3-R5": "15", "R5-R6": "15", "R4-R5": "25" };
    const teLbl: Record<string, string> = { "R1-R2": "1000 res.", "R2-R4": "200 res.", "R4-R6": "1000 res.", "R1-R3": "1000 res.", "R3-R5": id === "unres" ? "100 left" : "1000 res.", "R5-R6": "1000 res.", "R4-R5": "1000 res." };
    const colorLbl: Record<string, string> = { "R1-R2": "BLUE", "R2-R4": "BLUE", "R4-R6": "BLUE", "R1-R3": "GOLD", "R3-R5": "GOLD", "R5-R6": "GOLD", "R4-R5": "RED" };
    const lsp = ["path", "resv", "fwd", "autoroute", "oneway", "unres", "priority", "mbb"].includes(id);
    const links: TopoLink[] = Object.keys(lbl).map((key) => {
      const [a, b] = key.split("-");
      let state: TopoLink["state"] = key === "R4-R5" ? "dim" : "up";
      if (id === "prune" && key === "R2-R4") state = "blocked";
      if ((id === "spf" || id === "ero") && onPath(BOT, a, b)) state = "active";
      if (lsp && onPath(BOT, a, b)) state = "active";
      if (id === "explicit" && onPath(TOP, a, b)) state = "active";
      if (id === "affinity" && onPath(BOT, a, b)) state = "active";
      if (id === "affinity" && key === "R4-R5") state = "blocked";
      const label = ["ted", "prune", "unres"].includes(id) ? teLbl[key] : id === "affinity" ? colorLbl[key] : ["video", "igp", "busy"].includes(id) ? lbl[key] : key === "R2-R4" && ["explicit"].includes(id) ? "200 res." : "";
      return { a, b, state, label };
    });
    const views: Record<string, TopoView> = {};
    let movers: ReactNode = null;
    if (id === "video") {
      views.R1 = { ring: "on", bubble: { text: "CE1: 500 Mbps to CE6", tone: "info" } };
      views.R6 = { bubble: { text: "CE6 10.6.6.0/24", tone: "info", delay: 400 } };
    }
    if (id === "igp") {
      movers = <>{along(TOP, () => "IS-IS: cost 30", "green")}</>;
      views.R3 = { bubble: { text: "cost 45 — not chosen", tone: "info", delay: 1400 } };
    }
    if (id === "busy") {
      movers = (
        <>
          {go("R1", "R2", { label: "500 Mbps", key: "1", color: "green" })}
          {go("R2", "R4", { label: "800 + 500 > 1000", key: "2", delay: 800, color: "red", stay: true })}
        </>
      );
      views.R2 = { ring: "bad", bubble: { text: "25% of the video dropped", tone: "bad", delay: 1600 } };
      views.R5 = { bubble: { text: "half empty", tone: "yes", delay: 1600 } };
    }
    if (id === "ted") {
      movers = (
        <>
          {go("R2", "R1", { label: "LSP + TE TLVs", key: "1", color: "amber" })}
          {go("R2", "R4", { label: "LSP + TE TLVs", key: "2", delay: 500, color: "amber" })}
          {go("R5", "R3", { label: "LSP + TE TLVs", key: "3", delay: 1000, color: "amber" })}
          {go("R5", "R6", { label: "LSP + TE TLVs", key: "4", delay: 1500, color: "amber" })}
        </>
      );
    }
    if (id === "prune") views.R1 = { ring: "on", bubble: { text: "need 500: R2–R4 offers 200 → pruned", tone: "warn" } };
    if (id === "spf") views.R1 = { ring: "on", bubble: { text: "best of what's left: TE cost 45", tone: "yes" } };
    if (id === "ero") views.R1 = { ring: "on", bubble: { text: "ERO: 3.3.3.3 S · 5.5.5.5 S · 6.6.6.6 S", tone: "info" } };
    if (id === "path") movers = <>{along(BOT, () => "PATH 500 Mbps", "cyan")}</>;
    if (id === "resv") {
      const back = [...BOT].reverse();
      const labs = ["imp-null", "24401", "24201"];
      movers = <>{along(back, (i) => `RESV ${labs[i]}`, "violet")}</>;
      views.R5 = { bubble: { text: "reserve 500", tone: "yes", delay: 800 } };
      views.R3 = { bubble: { text: "reserve 500", tone: "yes", delay: 1500 } };
      views.R1 = { bubble: { text: "tunnel-te1 up", tone: "yes", delay: 2200 } };
    }
    if (id === "fwd") {
      const labs = ["24201", "24401", "IP"];
      movers = <>{along(BOT, (i) => labs[i], "violet")}</>;
      views.R1 = { bubble: { text: "push 24201", tone: "info" } };
      views.R3 = { bubble: { text: "swap → 24401", tone: "info", delay: 700 } };
      views.R5 = { bubble: { text: "pop (PHP)", tone: "info", delay: 1400 } };
    }
    if (id === "autoroute") {
      movers = (
        <>
          {go("R1", "R2", { label: "✕ still via IS-IS", key: "1", color: "red", stay: true })}
          {along(BOT, () => "into tunnel-te1", "green", 700, "b", 1200)}
        </>
      );
      views.R1 = { bubble: { text: "autoroute announce", tone: "yes", delay: 1000 } };
    }
    if (id === "oneway") {
      movers = <>{along([...TOP].reverse(), () => "CE6 → CE1: IS-IS", "amber")}</>;
      views.R6 = { bubble: { text: "no tunnel from R6", tone: "warn" } };
    }
    if (id === "unres") views.R3 = { bubble: { text: "CUST-B 400 + tunnel-te1 500", tone: "info" } };
    if (id === "explicit") {
      movers = <>{along(TOP, () => "150 Mbps", "cyan")}</>;
      views.R1 = { bubble: { text: "strict 2.2.2.2, strict 4.4.4.4", tone: "info" } };
    }
    if (id === "affinity") views.R1 = { bubble: { text: "include GOLD", tone: "info" } };
    if (id === "priority") {
      views.R1 = { bubble: { text: "tunnel-te1: priority 3", tone: "yes" } };
      views.R3 = { ring: "bad", bubble: { text: "preempted", tone: "bad", delay: 800 } };
      views.R5 = { bubble: { text: "still flows", tone: "warn", delay: 1600 } };
    }
    if (id === "mbb") {
      views.R1 = { bubble: { text: "new 700 Mbps LSP: no path", tone: "warn" } };
      views.R3 = { bubble: { text: "old 500 Mbps LSP stays up", tone: "yes", delay: 800 } };
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
    case "metrics":
      return (
        <>
          {head}
          <Compare
            items={[
              { title: "Tune IS-IS metrics", tone: "red", body: "every flow toward R6 moves at once; the bottom overflows instead" },
              { title: "Engineer one LSP", tone: "green", body: "this 500 Mbps flow gets a path with room; everything else stays on IS-IS" },
            ]}
          />
        </>
      );
    case "breaks":
      return (
        <>
          {head}
          <MiniTable title="How an engineered path fails" cols={["Fault", "What you see"]} rows={[{ cells: ["Not enough unreserved bandwidth", "LSP down, CSPF: no path (bw)"] }, { cells: ["Link missing from the TED", "LSP down although the link is up"] }, { cells: ["Strict hop not adjacent", "LSP down: explicit path can't be followed"] }, { cells: ["Color changed", "LSP down: no path meets the affinity"] }, { cells: ["No autoroute / shortcuts", "LSP up, traffic still on the IS-IS path"], state: "hit" }]} />
        </>
      );
    case "verify":
      return (
        <>
          {head}
          <div className="grid gap-2 sm:grid-cols-2">
            <MiniTable title="IOS XR" cols={["Question", "Command"]} rows={[{ cells: ["LSP state, path", "show mpls traffic-eng tunnels 1"] }, { cells: ["The TED", "show mpls traffic-eng topology"] }, { cells: ["Reservations", "show rsvp interface"] }, { cells: ["Routed into it?", "show route 10.6.6.20"] }]} />
            <MiniTable title="Junos" cols={["Question", "Command"]} rows={[{ cells: ["LSP state, path", "show mpls lsp extensive"] }, { cells: ["The TED", "show ted database extensive"] }, { cells: ["Reservations", "show rsvp interface"] }, { cells: ["Routed into it?", "show route 10.6.6.20"] }]} />
          </div>
        </>
      );
    case "recap":
      return (
        <>
          {head}
          <Chain k="recap" items={[{ t: "IS-IS picks the cheapest path and ignores load" }, { t: "The TED: TE metric, reservable and unreserved bandwidth, colors — flooded by IS-IS", tone: "cyan" }, { t: "CSPF: prune what can't carry it, then SPF → the ERO", tone: "violet" }, { t: "PATH downstream, RESV upstream with labels and reservations", tone: "violet" }, { t: "autoroute announce / IS-IS shortcuts route traffic into the LSP", tone: "amber" }, { t: "Priorities decide who gets the bandwidth — a reservation never adds capacity", tone: "red" }]} />
        </>
      );
  }
  return head;
}

export function TePresentation({ open, onClose, onFinish, finishLabel }: { open: boolean; onClose: () => void; onFinish: () => void; finishLabel: string }) {
  const [play, setPlay] = useState(0);
  return (
    <LessonPresentation
      open={open}
      onClose={onClose}
      title="RSVP-TE, from zero"
      kicker="Learn · the RSVP-TE presentation"
      steps={STEPS}
      visual={(s) => VISUAL[s.id as Id]}
      renderStage={(s) => <Deck step={s as Step} play={play} replay={() => setPlay((p) => p + 1)} />}
      finish={{ label: finishLabel, onClick: onFinish }}
      skip={{ label: "Skip →", onClick: onFinish }}
    />
  );
}
