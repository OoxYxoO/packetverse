"use client";

import { useState, type ReactNode } from "react";
import { LessonPresentation } from "@/components/presentation/LessonPresentation";
import { Mover, StageHead, type DeckStep } from "@/components/presentation/ScrollyDeck";
import { Chain, Compare, MiniTable, ReplayButton, Token, Topo, nodeAt, short, type TopoLink, type TopoNode, type TopoView } from "@/components/presentation/Visuals";
import { useFitNodes } from "@/components/presentation/fitNarrow";

/**
 * MPLS RSVP-TE FAST REROUTE — the presentation before the lesson and the Fast Reroute Lab. Builds on RSVP-TE (CSPF,
 * PATH / RESV, labels). Same routers, loopbacks, labels (IOS XR numbering) and detection times as the lab, and the guided
 * lesson's R1 → R6 LSP with its bypasses through R4. Presentation state only.
 */

type Id = "video" | "fail" | "slow" | "idea" | "roles" | "request" | "nhop" | "nnhop" | "facility" | "labels" | "repair" | "reopt" | "node" | "edges" | "detect" | "bw" | "breaks" | "verify" | "trouble" | "recap";
type Step = DeckStep & { id: Id };
const B = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;

const STEPS: Step[] = [
  { id: "video", chapter: "The problem", title: "An engineered LSP carries the video.", body: <p>tunnel-te1 runs from R1 to R6 over R3, R5 and R7 — an RSVP-TE LSP like the one from the previous lesson, with 500 Mbps reserved. R4 sits off to the side.</p> },
  { id: "fail", chapter: "The problem", title: "R3–R5 fails.", body: <p>The span between R3 and R5 breaks. R3 is the first to notice. Packets for the video keep arriving at R3 — and have nowhere to go.</p> },
  { id: "slow", chapter: "The problem", title: "Waiting for the headend takes seconds.", body: <p>Without preparation R3 can only report it. R1 hears about it (PathErr, IS-IS), runs CSPF again and signals a new LSP. Each step is quick; together they take <B>about one and a half seconds</B> — a frozen picture.</p> },
  { id: "idea", chapter: "Fast reroute", title: "Repair where it breaks.", body: <p><B>Fast reroute</B> lets the router next to the failure act on its own, using a path it prepared in advance. The headend fixes things properly afterwards, without hurry.</p> },
  { id: "roles", chapter: "Fast reroute", title: "PLR, bypass, merge point.", body: <p>R3 is the <B>Point of Local Repair</B> (PLR). Its <B>bypass</B> — a small LSP of its own, signaled before anything fails — goes around through R4 and rejoins the LSP at the <B>merge point</B> (MP).</p> },
  { id: "request", chapter: "Fast reroute", title: "The LSP asks for it.", body: <p>R1 sets flags in the LSP&apos;s PATH: <B>local protection desired</B>, and here also <B>node protection desired</B>. Routers on the path that can protect it build bypasses and report back in the RRO.</p> },
  { id: "nhop", chapter: "Two kinds of bypass", title: "NHOP: around the link.", body: <p>A bypass to the <B>next hop</B> (R5) that avoids the R3–R5 link: R3–R4–R5. It protects the link — and only the link.</p> },
  { id: "nnhop", chapter: "Two kinds of bypass", title: "NNHOP: around the next router.", body: <p>A bypass to the <B>next-next hop</B> (R7) that avoids R5 entirely: R3–R4–R7. It protects R5 <B>and</B> the R3–R5 link, because a path around R5 also avoids that link.</p> },
  { id: "facility", chapter: "Two kinds of bypass", title: "One bypass, many LSPs.", body: <p>This is <B>facility backup</B>: one bypass at R3 protects every LSP that leaves R3 toward R5. (The other method, one-to-one detours, builds a separate detour per LSP — rarely used.)</p> },
  { id: "labels", chapter: "The label trick", title: "The merge point gets its usual label.", body: <p>In a repair R3 swaps the video&apos;s label to <B>24401</B> — the label R7 expects from R5, learned from the Record Route — and pushes the bypass label on top. R4 pops the bypass label, and R7 receives 24401 as if nothing happened.</p> },
  { id: "repair", chapter: "A link fails", title: "Detected, switched, delivered.", body: <p>R3 detects the failure (BFD: 45 ms), switches to the bypass (~10 ms) and the video keeps flowing with a hiccup of about <B>55 ms</B>. Nobody notices.</p> },
  { id: "reopt", chapter: "A link fails", title: "Then the headend calms things down.", body: <p>R3 tells R1 the LSP was locally repaired. R1 computes a new path (R3–R4–R7), signals it make-before-break, and the bypass is free again for the next failure.</p> },
  { id: "node", chapter: "A router fails", title: "NHOP can't save you from R5.", body: <p>If R5 itself dies, a bypass that ends at R5 leads nowhere. Only an <B>NNHOP</B> bypass — merging at R7 — survives. &quot;FRR ready&quot; with link protection only is not node protection.</p> },
  { id: "edges", chapter: "A router fails", title: "Some failures can't be protected.", body: <p>R1 and R6 have a single link each: no way around R1–R3 or R7–R6. And R7 is the penultimate hop — there is no next-next hop to merge at. Protection needs a second way out.</p> },
  { id: "detect", chapter: "Detection", title: "Repair starts at detection.", body: <p>Cut a fiber and the router loses light in 10 ms. But R3–R5 crosses a DWDM system: when it fails, both routers keep their light. Only <B>BFD</B> notices in time — without it R3 waits for IS-IS to give up: 30 seconds.</p> },
  { id: "bw", chapter: "Detection", title: "Bypasses are temporary.", body: <p>Facility bypasses usually reserve no bandwidth of their own: they carry traffic for seconds, until the headend re-optimizes. That is why the headend&apos;s calm re-signaling matters as much as the fast switch.</p> },
  { id: "breaks", chapter: "When it breaks", title: "Five ways protection fails.", body: <p>Link protection where node protection was needed, an LSP that never asked, a bypass that can&apos;t be signaled, a PLR with no bypass, a failure nobody detects in time.</p> },
  { id: "verify", chapter: "Verify", title: "The questions engineers ask.", body: <p>Does the LSP ask for protection? Which router is the PLR for this failure, and what is it bound to? Is the bypass up? How fast would the PLR detect it?</p> },
  { id: "trouble", chapter: "Troubleshooting", title: "Prove it with a drill.", body: <p>&quot;Ready&quot; in a show command is a claim. A failure drill — or a maintenance window — is the proof.</p> },
  { id: "recap", chapter: "The whole idea", title: "Prepare, detect, switch locally, re-optimize.", body: <p>Now watch it in the lesson, then break and fix it in the Fast Reroute Lab.</p> },
];
const VISUAL: Record<Id, string> = Object.fromEntries(STEPS.map((s) => [s.id, ["slow", "breaks", "verify", "trouble", "recap"].includes(s.id) ? s.id : "topo"])) as Record<Id, string>;

const NODES: TopoNode[] = [
  { id: "R1", label: "R1", sub: "1.1.1.1", icon: "PE", x: 8, y: 36 },
  { id: "R3", label: "R3", sub: "3.3.3.3", icon: "P", x: 30, y: 36 },
  { id: "R5", label: "R5", sub: "5.5.5.5", icon: "P", x: 54, y: 36 },
  { id: "R7", label: "R7", sub: "7.7.7.7", icon: "P", x: 76, y: 36 },
  { id: "R6", label: "R6", sub: "6.6.6.6", icon: "PE", x: 94, y: 36 },
  { id: "R4", label: "R4", sub: "4.4.4.4", icon: "P", x: 54, y: 84 },
];
const PRIMARY = ["R1", "R3", "R5", "R7", "R6"];
const NHOP = ["R3", "R4", "R5"];
const NNHOP = ["R3", "R4", "R7"];
const pairs = (p: string[]) => p.slice(1).map((x, i) => [p[i], x] as [string, string]);
const onPath = (p: string[], a: string, b: string) => pairs(p).some(([x, y]) => (x === a && y === b) || (x === b && y === a));

function Deck({ step: s, play, replay }: { step: Step; play: number; replay: () => void }) {
  const FIT = useFitNodes(NODES, 240);
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
    const all = ["R1-R3", "R3-R5", "R5-R7", "R7-R6", "R3-R4", "R4-R5", "R4-R7"];
    const failedLink = ["fail", "repair", "reopt", "detect"].includes(id) ? "R3-R5" : undefined;
    const failedNode = id === "node" ? "R5" : undefined;
    const bypass = ["roles", "nnhop", "labels", "repair", "node", "facility"].includes(id) ? NNHOP : id === "nhop" ? NHOP : undefined;
    const links: TopoLink[] = all.map((key) => {
      const [a, b] = key.split("-");
      let state: TopoLink["state"] = onPath(PRIMARY, a, b) ? "active" : "up";
      if (key === failedLink || (failedNode && (a === failedNode || b === failedNode))) state = "down";
      else if (bypass && onPath(bypass, a, b)) state = "standby";
      if (id === "reopt" && onPath(["R1", "R3", "R4", "R7", "R6"], a, b)) state = "active";
      if (id === "edges" && (key === "R1-R3" || key === "R7-R6")) state = "blocked";
      const label = key === "R3-R5" && (id === "detect" || id === "video") ? "DWDM" : key === "R3-R5" && failedLink ? "failed" : "";
      return { a, b, state, label };
    });
    const views: Record<string, TopoView> = {};
    let movers: ReactNode = null;
    if (id === "video") movers = <>{along(PRIMARY, (i) => ["24101", "24301", "24401", "IP"][i], "violet")}</>;
    if (id === "fail") {
      movers = <>{go("R1", "R3", { label: "video", key: "1", color: "green" })}{go("R3", "R5", { label: "✕ no way on", key: "2", delay: 800, color: "red", stay: true })}</>;
      views.R3 = { ring: "bad", bubble: { text: "first to notice — nothing prepared", tone: "bad", delay: 1500 } };
    }
    if (id === "idea") views.R3 = { ring: "on", bubble: { text: "repair here, now", tone: "yes" } };
    if (id === "roles") {
      views.R3 = { ring: "on", badge: { text: "PLR", tone: "warn" } };
      views.R7 = { badge: { text: "MP", tone: "yes" } };
      views.R4 = { bubble: { text: "bypass (pre-signaled)", tone: "info" } };
    }
    if (id === "request") {
      movers = <>{along(PRIMARY, () => "PATH · prot desired", "cyan")}</>;
      views.R1 = { bubble: { text: "local + node protection desired", tone: "info" } };
    }
    if (id === "nhop") {
      movers = <>{along(NHOP, () => "bypass PATH", "amber")}</>;
      views.R5 = { badge: { text: "NHOP", tone: "warn" } };
    }
    if (id === "nnhop") {
      movers = <>{along(NNHOP, () => "bypass PATH", "amber")}</>;
      views.R7 = { badge: { text: "NNHOP", tone: "warn" } };
    }
    if (id === "facility") views.R3 = { bubble: { text: "one bypass for every LSP toward R5", tone: "info" } };
    if (id === "labels") {
      movers = (
        <>
          {go("R1", "R3", { label: "24101", key: "1", color: "violet" })}
          {go("R3", "R4", { label: "bypass + 24401", key: "2", delay: 800, color: "amber" })}
          {go("R4", "R7", { label: "24401", key: "3", delay: 1600, color: "violet" })}
        </>
      );
      views.R7 = { bubble: { text: "my usual label: 24401", tone: "yes", delay: 2400 } };
    }
    if (id === "repair") {
      movers = <>{go("R1", "R3", { label: "video", key: "1", color: "green" })}{along(NNHOP, () => "via bypass", "amber", 800, 650, "b")}{go("R7", "R6", { label: "video", key: "3", delay: 2200, color: "green" })}</>;
      views.R3 = { ring: "on", bubble: { text: "BFD 45 ms + switch 10 ms", tone: "yes" } };
    }
    if (id === "reopt") {
      movers = <>{along(["R1", "R3", "R4", "R7", "R6"], () => "PATH (new LSP)", "cyan")}</>;
      views.R1 = { bubble: { text: "re-optimized, make-before-break", tone: "yes", delay: 2600 } };
    }
    if (id === "node") {
      views.R5 = { ring: "bad", badge: { text: "down", tone: "bad" } };
      views.R3 = { bubble: { text: "NHOP to R5: useless · NNHOP to R7: works", tone: "warn" } };
    }
    if (id === "edges") {
      views.R1 = { bubble: { text: "one link only", tone: "warn" } };
      views.R7 = { bubble: { text: "penultimate: no NNHOP", tone: "warn", delay: 400 } };
    }
    if (id === "detect") views.R3 = { ring: "bad", bubble: { text: "light still on · BFD 45 ms · without BFD 30 s", tone: "warn" } };
    if (id === "bw") views.R4 = { bubble: { text: "carries traffic for seconds", tone: "info" } };
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
    case "slow":
      return (
        <>
          {head}
          <Chain k="slow" items={[{ t: "R3 detects the failure", tone: "plain" }, { t: "PathErr to R1 · IS-IS floods the change", tone: "amber" }, { t: "R1 runs CSPF again", tone: "violet" }, { t: "PATH / RESV for a new LSP", tone: "violet" }, { t: "≈ 1.5 s of lost traffic", tone: "red" }]} />
        </>
      );
    case "breaks":
      return (
        <>
          {head}
          <MiniTable title="How protection fails" cols={["Fault", "What you see"]} rows={[{ cells: ["Only NHOP bypasses at the PLR", "link failures repaired, router failures not"] }, { cells: ["The LSP doesn't request FRR", "no bypass built for it, every failure waits for the headend"] }, { cells: ["Bypass can't be signaled", "bypass down, LSP falls back to NHOP"] }, { cells: ["No bypass at the PLR", "that hop shows as unprotected"] }, { cells: ["Silent failure, no BFD", "bypass ready, repair after 30 s"], state: "hit" }]} />
        </>
      );
    case "verify":
      return (
        <>
          {head}
          <div className="grid gap-2 sm:grid-cols-2">
            <MiniTable title="IOS XR" cols={["Question", "Command"]} rows={[{ cells: ["Protection asked?", "show mpls traffic-eng tunnels 1"] }, { cells: ["What is bound here?", "show mpls traffic-eng fast-reroute database"] }, { cells: ["Bypass up?", "show mpls traffic-eng tunnels backup"] }, { cells: ["Fast detection?", "show bfd session"] }]} />
            <MiniTable title="Junos" cols={["Question", "Command"]} rows={[{ cells: ["Protection asked?", "show mpls lsp extensive"] }, { cells: ["What is bound here?", "show rsvp session detail"] }, { cells: ["Bypass up?", "show mpls lsp bypass"] }, { cells: ["Fast detection?", "show bfd session"] }]} />
          </div>
        </>
      );
    case "trouble":
      return (
        <>
          {head}
          <Compare items={[{ title: "“FRR ready”", tone: "amber", body: "a bypass exists for some failure" }, { title: "A drill", tone: "green", body: "this failure, this PLR, this detection time — measured" }]} />
        </>
      );
    case "recap":
      return (
        <>
          {head}
          <Chain k="recap" items={[{ t: "Without protection the headend repairs: ≈ 1.5 s" }, { t: "The PLR keeps a pre-signaled bypass; the merge point gets its usual label", tone: "cyan" }, { t: "NHOP protects the link; only NNHOP protects the next router", tone: "violet" }, { t: "Repair starts at detection: light in 10 ms, silent failures need BFD", tone: "amber" }, { t: "Afterwards the headend re-optimizes and frees the bypass", tone: "green" }]} />
        </>
      );
  }
  return head;
}

export function FrrPresentation({ open, onClose, onFinish, finishLabel }: { open: boolean; onClose: () => void; onFinish: () => void; finishLabel: string }) {
  const [play, setPlay] = useState(0);
  return (
    <LessonPresentation
      open={open}
      onClose={onClose}
      title="Fast reroute, from zero"
      kicker="Learn · the fast reroute presentation"
      steps={STEPS}
      visual={(s) => VISUAL[s.id as Id]}
      renderStage={(s) => <Deck step={s as Step} play={play} replay={() => setPlay((p) => p + 1)} />}
      finish={{ label: finishLabel, onClick: onFinish }}
      skip={{ label: "Skip →", onClick: onFinish }}
    />
  );
}
