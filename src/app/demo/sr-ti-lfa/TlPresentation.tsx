"use client";

import { useState, type ReactNode } from "react";
import { LessonPresentation } from "@/components/presentation/LessonPresentation";
import { Mover, StageHead, type DeckStep } from "@/components/presentation/ScrollyDeck";
import { Chain, Compare, MiniTable, ReplayButton, Token, Topo, nodeAt, short, type TopoLink, type TopoNode, type TopoView } from "@/components/presentation/Visuals";
import { useFitNodes } from "@/components/presentation/fitNarrow";

/**
 * SR TI-LFA — the presentation before the lesson and the SR TI-LFA Lab. Same routers, metrics, PLR, PQ node and labels
 * as the guided lesson and the lab. Presentation state only.
 */

type Id = "problem" | "converge" | "local" | "plr" | "post" | "pspace" | "qspace" | "pq" | "repair" | "wire" | "ready" | "fail" | "reverse" | "node" | "lfa" | "detect" | "bfd" | "rsvp" | "breaks" | "verify" | "trouble" | "recap";
type Step = DeckStep & { id: Id };
const B = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;

const STEPS: Step[] = [
  { id: "problem", chapter: "The problem", title: "Links fail. Traffic shouldn't notice.", body: <p>H1 talks to H6 over R1 → R2 → R4 → R6, pushing R6&apos;s Node SID <B>16006</B>. The R2–R4 link crosses a DWDM system. When it fails, how long is the traffic gone?</p> },
  { id: "converge", chapter: "The problem", title: "Waiting for the IGP costs time.", body: <p>Without protection: detect the failure, flood new LSPs, every router reruns SPF, every router reprograms its labels. In this lab that is about <B>a second</B> of loss — for every flow over R2–R4, in both directions.</p> },
  { id: "local", chapter: "The idea", title: "Repair where it breaks.", body: <p>The router next to the failure already knows the topology. If it computes a backup <B>before</B> anything fails and installs it in hardware, it can switch the moment it detects the failure — no flooding, no SPF, no headend.</p> },
  { id: "plr", chapter: "The idea", title: "The point of local repair.", body: <p>For H1 → H6 the failure is entered at <B>R2</B>: R2 is the <B>PLR</B>. It protects the link R2–R4 — and, with node protection, the router R4 behind it.</p> },
  { id: "post", chapter: "Computing the backup", title: "Where will traffic go after convergence?", body: <p>R2 removes R4 from its copy of the topology and reruns SPF: the <B>post-convergence path</B> to R6 is R2 → R3 → R5 → R6 (cost 45). TI-LFA repairs onto exactly that path, so traffic never moves twice.</p> },
  { id: "pspace", chapter: "Computing the backup", title: "P-space: where R2 can still send.", body: <p>Routers R2 reaches on its normal shortest path without crossing R2–R4: <B>R1, R3, R5</B>. R2 can send to any of them with their Node SID, today, unchanged.</p> },
  { id: "qspace", chapter: "Computing the backup", title: "Q-space: who still reaches R6.", body: <p>Routers whose normal shortest path to R6 avoids R2–R4: <B>R3, R4, R5</B>. Hand the packet to any of them with 16006 and it gets there.</p> },
  { id: "pq", chapter: "Computing the backup", title: "The PQ node joins the two.", body: <p>R3 and R5 are in both spaces; R5, the one closest to R6, is the repair point. R2 sends to R5; R5 sends to R6. Nothing in between has to know there was a failure — and since R5 never needed R4 either, the same repair protects against R4 failing.</p> },
  { id: "repair", chapter: "Computing the backup", title: "One extra label.", body: <p>The repair is <B>[16005]</B> above the destination&apos;s <B>16006</B>. Where no node is in both spaces, TI-LFA adds an <B>Adjacency SID</B> to bridge P to Q — it works in any topology, hence &quot;topology-independent&quot;.</p> },
  { id: "wire", chapter: "Computing the backup", title: "What leaves R2.", body: <p>Out of the R3 interface: <B>16005 | 16006</B>. R3 swaps 16005 toward R5; R5 pops it (it&apos;s its own SID) and sends 16006 to R6 — R6&apos;s neighbor, so the label is popped on the way and R6 receives IP.</p> },
  { id: "ready", chapter: "Computing the backup", title: "Installed before the failure.", body: <p>The backup sits in R2&apos;s forwarding table next to the primary — the (!) row of <B>show mpls forwarding</B>. Computing it took no signaling: only the IS-IS database R2 already had.</p> },
  { id: "fail", chapter: "The failure", title: "R2–R4 fails: switch in milliseconds.", body: <p>BFD on R2–R4 detects the silent failure in <B>150 ms</B>. R2 swaps to the backup in about <B>15 ms</B>. H1 → H6 loses ~165 ms instead of a second; IS-IS converges behind it onto the very same path.</p> },
  { id: "reverse", chapter: "The failure", title: "The other direction has its own PLR.", body: <p>H6 → H1 enters R2–R4 at <B>R4</B>. R4 pushes <B>[16005]</B> above 16001 back toward R6 — the packet turns around at R4 until R6 learns of the failure. Protect both ends, or one direction waits.</p> },
  { id: "node", chapter: "The failure", title: "When the router itself dies.", body: <p>Fail R4: its links lose light (10 ms). R2&apos;s node-protecting backup already avoids R4. For H6 → H1 the PLR is now <B>R6</B>, which pushes <B>[16003]</B> toward R5.</p> },
  { id: "lfa", chapter: "Why TI", title: "Classic LFA needs a loop-free neighbor.", body: <p>Classic LFA sends to a neighbor whose own path doesn&apos;t come back. R2 has one (R3). R4 doesn&apos;t: R6&apos;s shortest path to R1 goes back through R4. With TI-LFA, the repair label changes R6&apos;s question from &quot;go to R1&quot; to &quot;go to R5&quot;.</p> },
  { id: "detect", chapter: "Detection", title: "A backup waits for detection.", body: <p>Loss of light is seen at once. A failure inside a DWDM or a provider network leaves the light on: without BFD, only the <B>IS-IS hold time</B> — 30 s — finds it. TI-LFA ready, traffic gone.</p> },
  { id: "bfd", chapter: "Detection", title: "BFD turns 30 s into 150 ms.", body: <p>BFD runs on both ends of R2–R4: 50 ms × 3. IS-IS registers with BFD; when BFD goes down, the adjacency goes down — and the PLR switches.</p> },
  { id: "rsvp", chapter: "Where it fits", title: "RSVP FRR vs TI-LFA.", body: <p>Both repair locally in tens of milliseconds. How the backup comes to exist is what differs.</p> },
  { id: "breaks", chapter: "When it breaks", title: "Five ways protection fails.", body: <p>No fast reroute on the PLR&apos;s interface; protection on one end only; no BFD on a silent link; a router without SR on every way around; classic LFA where no loop-free neighbor exists.</p> },
  { id: "verify", chapter: "Verify", title: "The questions engineers ask.", body: <p>Which router is the PLR for each direction? Does it have a backup for the destination, and which labels? Does every router on the repair run SR? How fast is the failure detected? Then prove it: fail it and measure.</p> },
  { id: "trouble", chapter: "Troubleshooting", title: "A protected network looks the same as an unprotected one.", body: <p>Until something fails, traffic flows either way. Read the backups and BFD — then run the drill. A configured line is not a repair.</p> },
  { id: "recap", chapter: "The whole idea", title: "Precompute the post-convergence path; switch on detection.", body: <p>Now watch it in the lesson, then break and fix it in the SR TI-LFA Lab.</p> },
];
const VISUAL: Record<Id, string> = Object.fromEntries(STEPS.map((s) => [s.id, ["rsvp", "breaks", "verify", "trouble", "recap"].includes(s.id) ? s.id : "topo"])) as Record<Id, string>;

const NODES: TopoNode[] = [
  { id: "R1", label: "R1", sub: "16001", icon: "PE", x: 6, y: 50 },
  { id: "R2", label: "R2", sub: "PLR", icon: "P", x: 30, y: 50 },
  { id: "R4", label: "R4", sub: "16004", icon: "P", x: 62, y: 16 },
  { id: "R3", label: "R3", sub: "16003", icon: "P", x: 46, y: 84 },
  { id: "R5", label: "R5", sub: "16005", icon: "P", x: 74, y: 84 },
  { id: "R6", label: "R6", sub: "16006", icon: "PE", x: 94, y: 50 },
];
const LINKS: [string, string, string][] = [["R1", "R2", "10"], ["R2", "R4", "10 · DWDM"], ["R4", "R6", "10"], ["R2", "R3", "15"], ["R3", "R5", "15"], ["R5", "R6", "15"]];
const TOP = new Set(["R1-R2", "R2-R4", "R4-R6"]);
const REPAIR = new Set(["R1-R2", "R2-R3", "R3-R5", "R5-R6"]);
const REV = new Set(["R4-R6", "R5-R6", "R3-R5", "R2-R3", "R1-R2"]);

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
    const downs = ["converge", "fail", "reverse", "detect", "bfd"].includes(id) ? ["R2-R4"] : id === "node" ? ["R2-R4", "R4-R6"] : [];
    const hot = ["problem", "plr", "local"].includes(id) ? TOP : ["post", "pq", "repair", "wire", "fail", "ready"].includes(id) ? REPAIR : id === "reverse" || id === "node" || id === "lfa" ? REV : new Set<string>();
    const links: TopoLink[] = LINKS.map(([a, b, m]) => {
      const key = `${a}-${b}`;
      return { a, b, state: (downs.includes(key) ? "down" : hot.has(key) ? "active" : hot.size ? "dim" : "up") as TopoLink["state"], label: ["problem", "post", "detect"].includes(id) ? m : "" };
    });
    const views: Record<string, TopoView> = {};
    let movers: ReactNode = null;
    if (id === "problem") movers = <>{go("R1", "R2", { label: "16006", key: "1" })}{go("R2", "R4", { label: "16006", key: "2", delay: 800 })}{go("R4", "R6", { label: "IP", key: "3", delay: 1600, color: "green" })}</>;
    if (id === "converge") {
      views.R2 = { ring: "bad", bubble: { text: "nothing ready: wait", tone: "bad" } };
      views.R5 = { bubble: { text: "SPF… reprogram…", tone: "warn", delay: 400 } };
    }
    if (id === "local") views.R2 = { bubble: { text: "backup computed in advance", tone: "yes" } };
    if (id === "plr") {
      views.R2 = { ring: "hit", bubble: { text: "PLR for H1 → H6", tone: "info" } };
      views.R4 = { badge: { text: "protected node", tone: "warn" } };
    }
    if (id === "post") views.R2 = { bubble: { text: "without R4: R3, R5, R6", tone: "info" } };
    if (id === "pspace") {
      for (const r of ["R1", "R3", "R5"]) views[r] = { badge: { text: "P", tone: "info" } };
      views.R2 = { bubble: { text: "reachable without R2–R4", tone: "info" } };
    }
    if (id === "qspace") {
      for (const r of ["R3", "R4", "R5"]) views[r] = { badge: { text: "Q", tone: "info" } };
      views.R6 = { bubble: { text: "reach me without R2–R4", tone: "info" } };
    }
    if (id === "pq") {
      views.R3 = { badge: { text: "P+Q", tone: "info" } };
      views.R5 = { ring: "hit", badge: { text: "PQ", tone: "info" }, bubble: { text: "repair point", tone: "yes" } };
    }
    if (id === "repair") views.R2 = { bubble: { text: "repair [16005] + 16006", tone: "yes" } };
    if (id === "wire") movers = <>{go("R1", "R2", { label: "16006", key: "1" })}{go("R2", "R3", { label: "16005 | 16006", key: "2", delay: 800, color: "amber" })}{go("R3", "R5", { label: "16005 | 16006", key: "3", delay: 1600, color: "amber" })}{go("R5", "R6", { label: "IP", key: "4", delay: 2400, color: "green" })}</>;
    if (id === "ready") views.R2 = { badge: { text: "(!) backup installed", tone: "info" } };
    if (id === "fail") {
      movers = <>{go("R2", "R3", { label: "16005 | 16006", key: "1", color: "amber" })}{go("R3", "R5", { label: "16005 | 16006", key: "2", delay: 800, color: "amber" })}{go("R5", "R6", { label: "IP", key: "3", delay: 1600, color: "green" })}</>;
      views.R2 = { ring: "hit", bubble: { text: "150 + 15 ms", tone: "yes" } };
    }
    if (id === "reverse") {
      movers = <>{go("R6", "R4", { label: "16001", key: "1" })}{go("R4", "R6", { label: "16005 | 16001", key: "2", delay: 800, color: "amber" })}</>;
      views.R4 = { ring: "hit", bubble: { text: "PLR for H6 → H1", tone: "info" } };
    }
    if (id === "node") {
      views.R4 = { ring: "bad", badge: { text: "failed", tone: "warn" } };
      views.R6 = { ring: "hit", bubble: { text: "PLR: push [16003]", tone: "yes" } };
      views.R2 = { bubble: { text: "already avoids R4", tone: "yes", delay: 400 } };
    }
    if (id === "lfa") {
      views.R4 = { bubble: { text: "no loop-free neighbor", tone: "bad" } };
      views.R6 = { bubble: { text: "to R1? back via R4", tone: "warn", delay: 400 } };
    }
    if (id === "detect") views.R2 = { ring: "bad", bubble: { text: "light still on · 30 s", tone: "bad" } };
    if (id === "bfd") {
      views.R2 = { bubble: { text: "BFD 50 ms × 3", tone: "yes" } };
      views.R4 = { bubble: { text: "BFD 50 ms × 3", tone: "yes", delay: 300 } };
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
    case "rsvp":
      return (
        <>
          {head}
          <Compare items={[{ title: "RSVP-TE FRR", tone: "amber", body: "bypass tunnels signaled in advance · state on every router of the bypass · protects RSVP LSPs" }, { title: "TI-LFA", tone: "cyan", body: "computed from IS-IS on the PLR alone · no signaling, no extra state · protects every SR prefix" }, { title: "Both", tone: "violet", body: "local repair at the PLR · ~50 ms class switchover · need fast detection" }]} />
        </>
      );
    case "breaks":
      return (
        <>
          {head}
          <MiniTable title="How TI-LFA protection fails" cols={["Fault", "What you see"]} rows={[{ cells: ["No fast reroute on the PLR's interface", "one direction waits ~1 s"], state: "hit" }, { cells: ["Protection on one end only", "only the replies (or requests) wait"] }, { cells: ["No BFD on a silent link", "~30 s, backup never used"] }, { cells: ["A router without SR on the way around", "no backup; lost until repaired"] }, { cells: ["Classic LFA only", "backup missing where no loop-free neighbor exists"] }]} />
        </>
      );
    case "verify":
      return (
        <>
          {head}
          <MiniTable title="On the PLR" cols={["Question", "IOS XR · Junos"]} rows={[{ cells: ["A backup for 10.0.0.6? Which labels?", "show isis fast-reroute 10.0.0.6/32 detail · show isis backup spf results"] }, { cells: ["Installed in forwarding?", "show mpls forwarding labels 16006 detail · show route table mpls.0"] }, { cells: ["Fast detection?", "show bfd session"] }, { cells: ["How much is protected?", "show isis fast-reroute summary · show isis backup coverage"] }]} />
        </>
      );
    case "trouble":
      return (
        <>
          {head}
          <Chain k="trouble" items={[{ t: "Which direction lost traffic, and for how long?", tone: "plain" }, { t: "Which router is the PLR for that direction?", tone: "cyan" }, { t: "How fast did it detect the failure?", tone: "violet" }, { t: "Does it have a backup for the destination?", tone: "violet" }, { t: "Can every router on the repair execute it?", tone: "amber" }, { t: "Fix one thing, run the drill again", tone: "green" }]} />
        </>
      );
    case "recap":
      return (
        <>
          {head}
          <Chain k="recap" items={[{ t: "The PLR precomputes the post-convergence path, without the failed link or node" }, { t: "P-space ∩ Q-space → PQ node; Node SIDs, plus Adjacency SIDs where needed", tone: "cyan" }, { t: "Installed as a backup: switch in ~15 ms once the failure is detected", tone: "amber" }, { t: "Each direction has its own PLR; every router on the repair must run SR", tone: "violet" }, { t: "Silent links need BFD — prove it with a drill", tone: "green" }]} />
        </>
      );
  }
  return head;
}

export function TlPresentation({ open, onClose, onFinish, finishLabel }: { open: boolean; onClose: () => void; onFinish: () => void; finishLabel: string }) {
  const [play, setPlay] = useState(0);
  return (
    <LessonPresentation
      open={open}
      onClose={onClose}
      title="TI-LFA, from zero"
      kicker="Learn · the SR TI-LFA presentation"
      steps={STEPS}
      visual={(s) => VISUAL[s.id as Id]}
      renderStage={(s) => <Deck step={s as Step} play={play} replay={() => setPlay((p) => p + 1)} />}
      finish={{ label: finishLabel, onClick: onFinish }}
      skip={{ label: "Skip →", onClick: onFinish }}
    />
  );
}
