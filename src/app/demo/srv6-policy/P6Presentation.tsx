"use client";

import { useState, type ReactNode } from "react";
import { LessonPresentation } from "@/components/presentation/LessonPresentation";
import { Mover, StageHead, type DeckStep } from "@/components/presentation/ScrollyDeck";
import { Chain, Compare, MiniTable, ReplayButton, Token, Topo, nodeAt, short, type TopoLink, type TopoNode, type TopoView } from "@/components/presentation/Visuals";
import { useFitNodes } from "@/components/presentation/fitNarrow";

/**
 * SRv6 Policy — the presentation before the lesson and the lab. Same network, delays, SIDs and policy as the lab
 * (IOS XR): LOW-LATENCY on R1, color 100 → R6, an explicit and a dynamic candidate. Presentation state only.
 */

type Id = "problem" | "igp" | "delay" | "intent" | "color" | "cands" | "explicit" | "direct" | "dynamic" | "select" | "bsid" | "steer" | "nocolor" | "wire" | "r3" | "r6" | "fail" | "recompute" | "nottilfa" | "stale" | "compare" | "breaks" | "verify" | "recap";
type Step = DeckStep & { id: Id };
const B = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;
const M = ({ children }: { children: ReactNode }) => <span className="pv-mono text-pv-text">{children}</span>;

const STEPS: Step[] = [
  { id: "problem", chapter: "The question", title: "Shortest isn't always best.", body: <p>CLIENT1 talks to two receivers behind R6. RX66 runs a latency-sensitive app; RX67 doesn&apos;t care. Both would follow the same IGP path — unless we tell R1 otherwise.</p> },
  { id: "igp", chapter: "Two metrics", title: "The IGP picks the top.", body: <p>IS-IS metrics: top 10 + 10 + 10 = <B>30</B>, bottom 15 + 15 + 15 = <B>45</B>. Every packet goes R1 → R2 → R4 → R6.</p> },
  { id: "delay", chapter: "Two metrics", title: "Delay picks the bottom.", body: <p>Each link advertises its measured delay: top 20 ms per link — <B>60 ms</B>; bottom 5 ms per link — <B>15 ms</B>. The cheapest path is the slowest one.</p> },
  { id: "intent", chapter: "The policy", title: "An SR policy is an intent.", body: <p>Policy <B>LOW-LATENCY</B> lives on the headend and is identified by three things: <M>⟨R1, color 100, end-point 2001:db8::6⟩</M>. Headend, what kind of path, toward whom.</p> },
  { id: "color", chapter: "The policy", title: "Color is a name for an intent.", body: <p>Color 100 means nothing on the wire. It is a number both sides agree on: “100 = low latency”. It never appears in a packet header.</p> },
  { id: "cands", chapter: "Candidate paths", title: "One policy, several ways to do it.", body: <p>The controller (PCE) gave LOW-LATENCY two <B>candidate paths</B>, each with a preference. A candidate is either a fixed list of SIDs (explicit) or a computation (dynamic).</p> },
  { id: "explicit", chapter: "Candidate paths", title: "Explicit: preference 200.", body: <p>One SID: <M>2001:db8:100:3:41::</M>, R3&apos;s <B>End.X toward R5</B>. Reach R3, then leave through the R3–R5 link. From R5 the service SID takes it on to R6.</p> },
  { id: "direct", chapter: "Candidate paths", title: "No need to visit R3's End first.", body: <p>End.X lives under R3&apos;s locator, and R1&apos;s shortest path to that locator is the direct R1–R3 link. The DA already gets the packet to R3 — an extra End SID would just make the header longer.</p> },
  { id: "dynamic", chapter: "Candidate paths", title: "Dynamic: preference 100.", body: <p>“Minimize delay to R6.” The PCE runs SPF on delay: R1 → R3 → R5 → R6, 15 ms. Encoded as <M>[2001:db8:100:5:1::]</M> — R5&apos;s End — because R1&apos;s ordinary route to R5 already passes R3.</p> },
  { id: "select", chapter: "Selection", title: "Valid first, then preference.", body: <p>Both candidates are valid: every SID exists and is reachable. Among valid candidates, the highest preference is active — <B>200, explicit</B>. The dynamic one waits.</p> },
  { id: "bsid", chapter: "Selection", title: "A handle for the policy.", body: <p>R1 also gives the policy a <B>binding SID</B>, <M>…:1:42::</M> (End.B6.Encaps). Any packet arriving with that SID is pushed into LOW-LATENCY — a way for other nodes, or other policies, to use it.</p> },
  { id: "steer", chapter: "Steering", title: "A policy carries nothing by itself.", body: <p>R6 advertises RX66&apos;s prefix with BGP <B>color 100</B>. R1 matches color 100 + next hop R6 to ⟨color 100, end-point R6⟩ — and installs the route into the policy.</p> },
  { id: "nocolor", chapter: "Steering", title: "No color, no policy.", body: <p>RX67&apos;s prefix has no color. Same next hop, same R1 — but it follows the IGP over the top: 60 ms.</p> },
  { id: "wire", chapter: "On the wire", title: "What R1 pushes.", body: <p>H.Encaps.Red with <M>[R3 End.X→R5, R6 End.DT6]</M>: the DA is the first SID, the SRH holds the rest. The last SID is R6&apos;s <B>service SID</B>, learned from BGP.</p> },
  { id: "r3", chapter: "On the wire", title: "R3 executes, R5 routes.", body: <p>R3 finds <M>…:3:41::</M> in its SID table: Segments Left 1 → 0, DA = <M>…:6:42::</M>, out to R5. R5 has no SID to run — it just routes toward R6&apos;s locator.</p> },
  { id: "r6", chapter: "On the wire", title: "R6 decapsulates.", body: <p><M>…:6:42::</M> is End.DT6: remove the outer header, look RX66 up in the global IPv6 table, deliver. 5 + 5 + 5 = <B>15 ms</B>.</p> },
  { id: "fail", chapter: "When a candidate fails", title: "R3–R5 fails.", body: <p>R3 withdraws its End.X toward R5. The explicit list names a SID nobody advertises: the candidate is <B>invalid</B>.</p> },
  { id: "recompute", chapter: "When a candidate fails", title: "The next valid candidate takes over.", body: <p>The PCE recomputes the dynamic one on the new topology: R1 → R3 → R4 → R6, 5 + 15 + 20 = <B>40 ms</B>, encoded <M>[…:3:1::]</M>. Preference 100 is active; the policy stays up.</p> },
  { id: "nottilfa", chapter: "When a candidate fails", title: "This is not fast reroute.", body: <p>The switch happens on the headend, after the IGP and the PCE learn about the failure. Sub-50-ms local repair at the point of failure is TI-LFA — a later lesson.</p> },
  { id: "stale", chapter: "The stale SID", title: "The link is back. The path isn't.", body: <p>R3–R5 flaps and returns — but R3 allocates its End.X toward R5 as <M>…:3:43::</M>. The explicit list still says <M>…:3:41::</M>: still invalid. Dynamic SIDs can change; hard-coded lists must follow.</p> },
  { id: "compare", chapter: "Where it fits", title: "Explicit vs dynamic.", body: <p>Two ways to say the same intent.</p> },
  { id: "breaks", chapter: "When it breaks", title: "Five ways it fails.", body: <p>A re-allocated End.X; a router without SRv6; a route without color; a policy pointing at the wrong end-point; a preference typo.</p> },
  { id: "verify", chapter: "Verify", title: "The questions engineers ask.", body: <p>Is the route colored and matched? Is the policy up — which candidate, why? Do the SIDs in the list exist? What does R1 actually push?</p> },
  { id: "recap", chapter: "The whole idea", title: "Intent, candidates, steering.", body: <p>Now watch it in the lesson, then break and fix it in the SRv6 Policy Lab.</p> },
];
const VISUAL: Record<Id, string> = Object.fromEntries(STEPS.map((s) => [s.id, ["compare", "breaks", "verify", "recap"].includes(s.id) ? s.id : "topo"])) as Record<Id, string>;

const NODES: TopoNode[] = [
  { id: "CL1", label: "CLIENT1", sub: "", icon: "CE", x: 5, y: 50 },
  { id: "R1", label: "R1", sub: "headend", icon: "PE", x: 18, y: 50 },
  { id: "R2", label: "R2", sub: "", icon: "P", x: 38, y: 16 },
  { id: "R4", label: "R4", sub: "", icon: "P", x: 62, y: 16 },
  { id: "R3", label: "R3", sub: "", icon: "P", x: 38, y: 84 },
  { id: "R5", label: "R5", sub: "", icon: "P", x: 62, y: 84 },
  { id: "R6", label: "R6", sub: "egress", icon: "PE", x: 80, y: 50 },
  { id: "RX66", label: "RX66", sub: "color 100", icon: "CE", x: 95, y: 26 },
  { id: "RX67", label: "RX67", sub: "no color", icon: "CE", x: 95, y: 74 },
];
const LINKS: [string, string, string][] = [["CL1", "R1", ""], ["R1", "R2", "20 ms"], ["R2", "R4", "20 ms"], ["R4", "R6", "20 ms"], ["R1", "R3", "5 ms"], ["R3", "R5", "5 ms"], ["R5", "R6", "5 ms"], ["R3", "R4", "15 ms"], ["R6", "RX66", ""], ["R6", "RX67", ""]];
const TOP = new Set(["CL1-R1", "R1-R2", "R2-R4", "R4-R6"]);
const BOT = new Set(["CL1-R1", "R1-R3", "R3-R5", "R5-R6"]);
const CROSS = new Set(["CL1-R1", "R1-R3", "R3-R4", "R4-R6", "R6-RX66"]);

function Deck({ step: s, play, replay }: { step: Step; play: number; replay: () => void }) {
  const FIT = useFitNodes(NODES, 340);
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
    const hot =
      id === "igp" || id === "nocolor"
        ? new Set([...TOP, ...(id === "nocolor" ? ["R6-RX67"] : [])])
        : ["delay", "explicit", "dynamic", "select", "steer", "wire", "r3", "r6"].includes(id)
          ? new Set([...BOT, ...(["steer", "r6"].includes(id) ? ["R6-RX66"] : [])])
          : id === "recompute"
            ? CROSS
            : new Set<string>();
    const down = id === "fail" || id === "recompute" || id === "nottilfa";
    const links: TopoLink[] = LINKS.map(([a, b, label]) => {
      const key = `${a}-${b}`;
      const state: TopoLink["state"] = down && key === "R3-R5" ? "down" : hot.has(key) ? "active" : hot.size ? "dim" : "up";
      return { a, b, state, label: ["igp"].includes(id) ? (key === "R1-R2" || key === "R2-R4" || key === "R4-R6" ? "10" : key === "R3-R4" ? "20" : label ? "15" : "") : label };
    });
    const views: Record<string, TopoView> = {};
    let movers: ReactNode = null;
    if (id === "problem") {
      views.RX66 = { bubble: { text: "needs low latency", tone: "ask" } };
      views.R1 = { bubble: { text: "which path?", tone: "ask", delay: 300 } };
    }
    if (id === "igp") views.R1 = { bubble: { text: "IGP: top, cost 30", tone: "info" } };
    if (id === "delay") views.R3 = { bubble: { text: "bottom: 15 ms", tone: "yes" } };
    if (id === "intent") views.R1 = { ring: "hit", bubble: { text: "⟨R1, 100, R6⟩", tone: "info" } };
    if (id === "color") views.RX66 = { badge: { text: "color 100", tone: "info" } };
    if (id === "cands") views.R1 = { bubble: { text: "200 explicit · 100 dynamic", tone: "info" } };
    if (id === "explicit") views.R3 = { bubble: { text: "End.X → R5", tone: "yes" } };
    if (id === "direct") views.R1 = { bubble: { text: "DA …:3:41:: → R3", tone: "info" } };
    if (id === "dynamic") views.R5 = { bubble: { text: "R5 End", tone: "yes" } };
    if (id === "select") views.R1 = { ring: "hit", bubble: { text: "active: 200", tone: "yes" } };
    if (id === "bsid") views.R1 = { bubble: { text: "BSID …:1:42::", tone: "info" } };
    if (id === "steer") views.R1 = { bubble: { text: "color 100 → policy", tone: "yes" } };
    if (id === "nocolor") views.RX67 = { bubble: { text: "60 ms", tone: "warn" } };
    if (id === "wire") movers = <>{go("R1", "R3", { label: "DA …:3:41:: SL1", key: "1", color: "violet" })}</>;
    if (id === "r3") movers = <>{go("R3", "R5", { label: "DA …:6:42::", key: "1" })}{go("R5", "R6", { label: "DA …:6:42::", key: "2", delay: 800 })}</>;
    if (id === "r6") {
      movers = <>{go("R6", "RX66", { label: "IPv6", key: "1", color: "green" })}</>;
      views.R6 = { bubble: { text: "End.DT6: decap", tone: "yes" } };
    }
    if (id === "fail") views.R1 = { ring: "bad", bubble: { text: "explicit: invalid", tone: "bad" } };
    if (id === "recompute") views.R4 = { bubble: { text: "dynamic: 40 ms", tone: "yes" } };
    if (id === "nottilfa") views.R1 = { bubble: { text: "headend re-selection", tone: "info" } };
    if (id === "stale") {
      views.R3 = { ring: "bad", badge: { text: "End.X →R5 :43", tone: "warn" } };
      views.R1 = { bubble: { text: "list says :41", tone: "bad" } };
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
          <Compare items={[{ title: "Explicit", tone: "cyan", body: "a fixed list of SIDs · exact control · invalid as soon as a SID disappears or changes" }, { title: "Dynamic", tone: "amber", body: "an objective (delay, IGP metric) · recomputed after every change · finds a path whenever one exists" }, { title: "Both", tone: "violet", body: "valid first, then the highest preference · used only when traffic is steered" }]} />
        </>
      );
    case "breaks":
      return (
        <>
          {head}
          <MiniTable title="How an SRv6 policy fails" cols={["Fault", "What you see"]} rows={[{ cells: ["End.X re-allocated", "explicit invalid, dynamic active"], state: "hit" }, { cells: ["SRv6 off on R3", "explicit invalid, R3 has no SIDs"] }, { cells: ["Color removed on R6", "policy up, traffic on the IGP"] }, { cells: ["Wrong end-point", "policy down, nothing steered"] }, { cells: ["Preference typo", "both valid, dynamic wins"] }]} />
        </>
      );
    case "verify":
      return (
        <>
          {head}
          <MiniTable title="IOS XR" cols={["Question", "Command"]} rows={[{ cells: ["Policy, candidates, BSID?", "show segment-routing traffic-eng policy"] }, { cells: ["Is the route colored?", "show bgp ipv6 unicast <prefix>"] }, { cells: ["What does R1 push?", "show cef ipv6 <prefix>"] }, { cells: ["Do the SIDs exist?", "show segment-routing srv6 sid"] }]} />
        </>
      );
    case "recap":
      return (
        <>
          {head}
          <Chain k="recap" items={[{ t: "A policy is ⟨headend, color, end-point⟩" }, { t: "Candidates: explicit SIDs or a dynamic computation", tone: "cyan" }, { t: "Valid first, then the highest preference", tone: "violet" }, { t: "Steering: the route's color brings traffic in", tone: "amber" }, { t: "On the wire: policy SIDs + the service SID", tone: "green" }]} />
        </>
      );
  }
  return head;
}

export function P6Presentation({ open, onClose, onFinish, finishLabel }: { open: boolean; onClose: () => void; onFinish: () => void; finishLabel: string }) {
  const [play, setPlay] = useState(0);
  return (
    <LessonPresentation
      open={open}
      onClose={onClose}
      title="SRv6 policies, from zero"
      kicker="Learn · the SRv6 Policy presentation"
      steps={STEPS}
      visual={(s) => VISUAL[s.id as Id]}
      renderStage={(s) => <Deck step={s as Step} play={play} replay={() => setPlay((p) => p + 1)} />}
      finish={{ label: finishLabel, onClick: onFinish }}
      skip={{ label: "Skip →", onClick: onFinish }}
    />
  );
}
