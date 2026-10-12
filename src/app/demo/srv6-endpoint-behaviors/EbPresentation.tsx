"use client";

import { useState, type ReactNode } from "react";
import { LessonPresentation } from "@/components/presentation/LessonPresentation";
import { Mover, StageHead, type DeckStep } from "@/components/presentation/ScrollyDeck";
import { Chain, Compare, MiniTable, ReplayButton, Token, Topo, nodeAt, short, type TopoLink, type TopoNode, type TopoView } from "@/components/presentation/Visuals";
import { useFitNodes } from "@/components/presentation/fitNarrow";

/**
 * SRv6 Endpoint Behaviors — the presentation before the lesson and the lab. Same network, SIDs and customers as the
 * guided lesson and the lab (IOS XR). Presentation state only.
 */

type Id = "problem" | "table" | "who" | "end" | "endx" | "endxpath" | "endt" | "decap" | "dt4" | "lookup" | "dt6" | "last" | "family" | "dx" | "dxsids" | "wrong" | "dynamic" | "dx2" | "compare" | "breaks" | "verify" | "recap";
type Step = DeckStep & { id: Id };
const B = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;

const STEPS: Step[] = [
  { id: "problem", chapter: "The question", title: "A SID is more than a waypoint.", body: <p>So far every SID said “come here, then go on”. But SRv6 SIDs are instructions — and a node can offer many different ones under the same locator.</p> },
  { id: "table", chapter: "The local SID table", title: "One locator, many behaviors.", body: <p>R6&apos;s table: <B>End</B> (…:6:1::), two <B>End.X</B> (…:40::, …:41::), and two service SIDs: <B>End.DT4</B> for VRF CUST4 (…:42::) and <B>End.DT6</B> for VRF CUST6 (…:43::). Same /64, five instructions.</p> },
  { id: "who", chapter: "The local SID table", title: "Who allocates what.", body: <p>IS-IS allocates End and End.X — they belong to the topology. BGP allocates the service SIDs — they belong to the VRFs. On IOS XR all are dynamic functions under locator MAIN.</p> },
  { id: "end", chapter: "Moving on", title: "End: next segment, route normally.", body: <p>[R3 End, CUST4 SID]: R3 moves to the next segment and routes toward R6&apos;s locator — the direct R3–R6 link.</p> },
  { id: "endx", chapter: "Moving on", title: "End.X: next segment, this link.", body: <p>[R3 End.X → R4, CUST4 SID]: same rewrite — Segments Left down, next SID into the DA — but out through the R3–R4 link, whatever routing prefers.</p> },
  { id: "endxpath", chapter: "Moving on", title: "Steering by adjacency.", body: <p>The packet goes R3 → R4 → R5 → R6: a path no shortest-path calculation picks. End.X is SRv6&apos;s Adjacency SID.</p> },
  { id: "endt", chapter: "Moving on", title: "End.T: next segment, another table.", body: <p>RFC 8986 also defines <B>End.T</B>: move on, but look the next SID up in a specific IPv6 table. Rarely deployed — the guided lesson shows it; IOS XR in the lab doesn&apos;t allocate it.</p> },
  { id: "decap", chapter: "Leaving SRv6", title: "Some SIDs end the journey.", body: <p>Service behaviors <B>decapsulate</B>: remove the outer IPv6 header (and SRH) and do something with the customer&apos;s packet inside.</p> },
  { id: "dt4", chapter: "Leaving SRv6", title: "End.DT4: look it up in a VRF.", body: <p>The CUST4 SID: decapsulate, then look the inner IPv4 packet up in VRF <B>CUST4</B>. For 10.10.2.8 that is CE4-B.</p> },
  { id: "lookup", chapter: "Leaving SRv6", title: "One SID, every customer of the VRF.", body: <p>The same SID with an inner packet for 10.10.1.8 reaches CE4-A. The SID chose the table; the lookup chose the customer.</p> },
  { id: "dt6", chapter: "Leaving SRv6", title: "End.DT6: the same, for IPv6.", body: <p>The CUST6 SID decapsulates and looks an inner <B>IPv6</B> packet up in VRF CUST6 — CE6. (End.DT46 would accept both families in one table.)</p> },
  { id: "last", chapter: "The rules", title: "Decapsulation is the last segment.", body: <p>[CUST4 SID, R3 End]: R6 receives its DT4 SID with a segment still left. Decapsulating would discard the rest of the program — so R6 drops it.</p> },
  { id: "family", chapter: "The rules", title: "And the family must match.", body: <p>An IPv4 packet behind the CUST6 SID: End.DT6 has only an IPv6 table to offer. Dropped.</p> },
  { id: "dx", chapter: "Cross-connect", title: "End.DX4: straight to one CE.", body: <p>With <B>alloc mode per-ce</B>, BGP allocates one <B>End.DX4</B> per CE: decapsulate and send to that CE — no lookup at all. Simple and fast.</p> },
  { id: "dxsids", chapter: "Cross-connect", title: "A SID per customer.", body: <p>CUST4 now has …:6:42:: → CE4-A and …:6:43:: → CE4-B. The headend picks the customer by picking the SID.</p> },
  { id: "wrong", chapter: "Cross-connect", title: "Wrong SID, wrong customer.", body: <p>Send 10.10.2.8 with CE4-A&apos;s DX SID and R6 hands it to CE4-A — it never looks. That is the guided lesson&apos;s incident: a DX binding where a DT was meant.</p> },
  { id: "dynamic", chapter: "Cross-connect", title: "Dynamic SIDs move.", body: <p>Switching CUST4 to per-CE renumbered R6&apos;s SIDs: the old CUST4 SID became CE4-A&apos;s DX, CUST6 moved to …:44::. Headends learn service SIDs from BGP, not from runbooks — next lessons.</p> },
  { id: "dx2", chapter: "More behaviors", title: "And for Layer 2.", body: <p><B>End.DX2</B> decapsulates and sends an Ethernet frame out an attachment circuit — SRv6 EVPN VPWS. The guided lesson shows it; it needs EVPN, a later lesson.</p> },
  { id: "compare", chapter: "Where it fits", title: "DT vs DX.", body: <p>Two ways to hand a packet to a customer.</p> },
  { id: "breaks", chapter: "When it breaks", title: "Five ways it fails.", body: <p>A VRF switched to per-CE; a VRF without SRv6; a CE interface out of its VRF; an End.X whose adjacency is gone; a VRF pointing at a locator that doesn&apos;t exist.</p> },
  { id: "verify", chapter: "Verify", title: "The questions engineers ask.", body: <p>Which SIDs does the node have, and what does each do? Who allocated them? What is in the VRF behind a DT? Is the service SID last, and the family right?</p> },
  { id: "recap", chapter: "The whole idea", title: "The SID says what to do.", body: <p>Now watch it in the lesson, then break and fix it in the SRv6 Endpoint Behaviors Lab.</p> },
];
const VISUAL: Record<Id, string> = Object.fromEntries(STEPS.map((s) => [s.id, ["compare", "breaks", "verify", "recap"].includes(s.id) ? s.id : "topo"])) as Record<Id, string>;

const NODES: TopoNode[] = [
  { id: "R1", label: "R1", sub: "headend", icon: "PE", x: 6, y: 50 },
  { id: "R2", label: "R2", sub: "", icon: "P", x: 28, y: 16 },
  { id: "R3", label: "R3", sub: "End · End.X", icon: "P", x: 52, y: 16 },
  { id: "R4", label: "R4", sub: "", icon: "P", x: 28, y: 84 },
  { id: "R5", label: "R5", sub: "", icon: "P", x: 52, y: 84 },
  { id: "R6", label: "R6", sub: "services", icon: "PE", x: 68, y: 50 },
  { id: "CE6", label: "CE6", sub: "IPv6", icon: "CE", x: 94, y: 16 },
  { id: "CE4A", label: "CE4-A", sub: "10.10.1.8", icon: "CE", x: 94, y: 50 },
  { id: "CE4B", label: "CE4-B", sub: "10.10.2.8", icon: "CE", x: 94, y: 84 },
];
const LINKS: [string, string][] = [["R1", "R2"], ["R2", "R3"], ["R3", "R6"], ["R1", "R4"], ["R4", "R5"], ["R5", "R6"], ["R3", "R4"], ["R6", "CE6"], ["R6", "CE4A"], ["R6", "CE4B"]];
const ENDP = new Set(["R1-R2", "R2-R3", "R3-R6", "R6-CE4B"]);
const XP = new Set(["R1-R2", "R2-R3", "R3-R4", "R4-R5", "R5-R6", "R6-CE4B"]);
const BOT = new Set(["R1-R4", "R4-R5", "R5-R6"]);

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
    const hot = id === "end" ? ENDP : id === "endx" || id === "endxpath" ? XP : ["dt4", "wrong"].includes(id) ? new Set([...BOT, id === "wrong" ? "R6-CE4A" : "R6-CE4B"]) : id === "lookup" ? new Set([...BOT, "R6-CE4A"]) : id === "dt6" ? new Set([...BOT, "R6-CE6"]) : new Set<string>();
    const links: TopoLink[] = LINKS.map(([a, b]) => {
      const key = `${a}-${b}`;
      return { a, b, state: (hot.has(key) ? "active" : hot.size ? "dim" : "up") as TopoLink["state"], label: key === "R3-R4" ? "20" : "" };
    });
    const views: Record<string, TopoView> = {};
    let movers: ReactNode = null;
    if (id === "problem") views.R6 = { bubble: { text: "which instruction?", tone: "ask" } };
    if (id === "table") views.R6 = { ring: "hit", bubble: { text: "End · End.X · DT4 · DT6", tone: "info" } };
    if (id === "who") {
      views.R3 = { bubble: { text: "IS-IS: End, End.X", tone: "info" } };
      views.R6 = { bubble: { text: "BGP: DT4, DT6", tone: "info", delay: 300 } };
    }
    if (id === "end") views.R3 = { bubble: { text: "End: route on", tone: "yes" } };
    if (id === "endx") views.R3 = { bubble: { text: "End.X: out to R4", tone: "yes" } };
    if (id === "endxpath") movers = <>{go("R3", "R4", { label: "DA …:6:42::", key: "1", color: "violet" })}{go("R4", "R5", { label: "DA …:6:42::", key: "2", delay: 800, color: "violet" })}{go("R5", "R6", { label: "DA …:6:42::", key: "3", delay: 1600, color: "violet" })}</>;
    if (id === "endt") views.R3 = { bubble: { text: "End.T: other table", tone: "info" } };
    if (id === "decap") views.R6 = { bubble: { text: "remove outer header", tone: "info" } };
    if (id === "dt4") movers = <>{go("R6", "CE4B", { label: "IPv4 10.10.2.8", key: "1", color: "green" })}</>;
    if (id === "dt4") views.R6 = { bubble: { text: "DT4: look up in CUST4", tone: "yes" } };
    if (id === "lookup") views.R6 = { bubble: { text: "10.10.1.8 → CE4-A", tone: "yes" } };
    if (id === "dt6") views.R6 = { bubble: { text: "DT6: look up in CUST6", tone: "yes" } };
    if (id === "last") views.R6 = { ring: "bad", bubble: { text: "SL 1 at a DT SID", tone: "bad" } };
    if (id === "family") views.R6 = { ring: "bad", bubble: { text: "IPv4 into DT6", tone: "bad" } };
    if (id === "dx") views.R6 = { bubble: { text: "DX4: to one CE", tone: "info" } };
    if (id === "dxsids") {
      views.CE4A = { badge: { text: "…:42::", tone: "info" } };
      views.CE4B = { badge: { text: "…:43::", tone: "info" } };
    }
    if (id === "wrong") {
      movers = <>{go("R6", "CE4A", { label: "for 10.10.2.8!", key: "1", color: "amber" })}</>;
      views.CE4A = { ring: "bad", bubble: { text: "not mine", tone: "bad", delay: 900 } };
    }
    if (id === "dynamic") views.R6 = { bubble: { text: "SIDs renumbered", tone: "warn" } };
    if (id === "dx2") views.R6 = { bubble: { text: "DX2: L2 frame out", tone: "info" } };
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
          <Compare items={[{ title: "End.DT4 / DT6", tone: "cyan", body: "one SID per VRF · decapsulate and look up · the lookup picks the customer" }, { title: "End.DX4 / DX6", tone: "amber", body: "one SID per CE · decapsulate and send · the SID picks the customer" }, { title: "Both", tone: "violet", body: "last segment only · inner family must match · allocated by BGP" }]} />
        </>
      );
    case "breaks":
      return (
        <>
          {head}
          <MiniTable title="How endpoint behaviors fail" cols={["Fault", "What you see"]} rows={[{ cells: ["VRF switched to per-CE", "old SID now a DX: wrong customer"], state: "hit" }, { cells: ["VRF without SRv6", "no service SID"] }, { cells: ["CE out of its VRF", "DT runs, lookup fails"] }, { cells: ["End.X adjacency down", "End.X SID gone"] }, { cells: ["VRF on a missing locator", "no service SID, others shift"] }]} />
        </>
      );
    case "verify":
      return (
        <>
          {head}
          <MiniTable title="IOS XR" cols={["Question", "Command"]} rows={[{ cells: ["Which SIDs, which behaviors?", "show segment-routing srv6 sid"] }, { cells: ["What is behind a SID?", "show segment-routing srv6 sid <sid> detail"] }, { cells: ["What does the VRF allocate?", "show bgp vrf CUST4 ipv4 unicast"] }, { cells: ["What is in the VRF?", "show route vrf CUST4"] }]} />
        </>
      );
    case "recap":
      return (
        <>
          {head}
          <Chain k="recap" items={[{ t: "The local SID table binds each SID to a behavior" }, { t: "End / End.X: move on — route, or use a chosen link", tone: "cyan" }, { t: "End.DT: decapsulate and look up in a VRF", tone: "violet" }, { t: "End.DX: decapsulate and send to one CE", tone: "amber" }, { t: "Service SIDs: last segment, right family, read the live table", tone: "green" }]} />
        </>
      );
  }
  return head;
}

export function EbPresentation({ open, onClose, onFinish, finishLabel }: { open: boolean; onClose: () => void; onFinish: () => void; finishLabel: string }) {
  const [play, setPlay] = useState(0);
  return (
    <LessonPresentation
      open={open}
      onClose={onClose}
      title="Endpoint behaviors, from zero"
      kicker="Learn · the SRv6 Endpoint Behaviors presentation"
      steps={STEPS}
      visual={(s) => VISUAL[s.id as Id]}
      renderStage={(s) => <Deck step={s as Step} play={play} replay={() => setPlay((p) => p + 1)} />}
      finish={{ label: finishLabel, onClick: onFinish }}
      skip={{ label: "Skip →", onClick: onFinish }}
    />
  );
}
