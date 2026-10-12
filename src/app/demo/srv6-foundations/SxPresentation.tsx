"use client";

import { useState, type ReactNode } from "react";
import { LessonPresentation } from "@/components/presentation/LessonPresentation";
import { Mover, StageHead, type DeckStep } from "@/components/presentation/ScrollyDeck";
import { Chain, Compare, MiniTable, ReplayButton, Token, Topo, nodeAt, short, type TopoLink, type TopoNode, type TopoView } from "@/components/presentation/Visuals";
import { useFitNodes } from "@/components/presentation/fitNarrow";

/**
 * SRv6 Foundations — the presentation before the lesson and the SRv6 Foundations Lab. Same hexagon, locators, SIDs and
 * paths as the guided lesson and the lab (IOS XR). Presentation state only.
 */

type Id = "problem" | "idea" | "sid" | "locator" | "function" | "lsid" | "advertise" | "underlay" | "single" | "transit" | "usd" | "list" | "srh" | "active" | "end" | "psp" | "three" | "path" | "notmpls" | "breaks" | "verify" | "recap";
type Step = DeckStep & { id: Id };
const B = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;

const STEPS: Step[] = [
  { id: "problem", chapter: "The problem", title: "Segment routing without MPLS?", body: <p>SR-MPLS needs labels, an SRGB and MPLS forwarding on every router. Many networks already forward IPv6 everywhere. Could the segments themselves be IPv6 addresses?</p> },
  { id: "idea", chapter: "The idea", title: "A segment is an IPv6 address.", body: <p><B>SRv6</B> (RFC 8986): every segment is a 128-bit IPv6 address — a <B>SID</B>. Routers reach it by ordinary IPv6 routing; the router that owns it executes an instruction bound to it.</p> },
  { id: "sid", chapter: "The SID", title: "Two halves with two jobs.", body: <p><B>2001:db8:100:3:1::</B> is R3&apos;s End SID. The first half routes the packet to R3; the second half tells R3 what to do when it gets there.</p> },
  { id: "locator", chapter: "The SID", title: "The locator routes.", body: <p>R3&apos;s locator is <B>2001:db8:100:3::/64</B>: an ordinary IPv6 prefix advertised in IS-IS. Every SID under it is reached by longest match on that one route.</p> },
  { id: "function", chapter: "The SID", title: "The function instructs.", body: <p>The bits after the locator are the <B>function</B>. Here function 1 means <B>End</B>: “I am an endpoint — process the next segment.” Function 0x40 is End.X toward R2, 0x41 End.X toward R6.</p> },
  { id: "lsid", chapter: "The SID", title: "Only instantiated SIDs exist.", body: <p>The <B>local SID table</B> binds each SID to a behavior. 2001:db8:100:3:9:: is inside R3&apos;s locator but in no table: R3 would drop it. A locator route answers “how do I reach R3?”; a local SID answers “what does R3 do?”.</p> },
  { id: "advertise", chapter: "Building it", title: "IS-IS carries locators and SIDs.", body: <p>With the locator enabled in IS-IS, each router advertises an <B>SRv6 Locator TLV</B> with its End SID, and End.X SIDs on its adjacencies. No label distribution, no SRGB.</p> },
  { id: "underlay", chapter: "Building it", title: "The underlay first.", body: <p>IS-IS IPv6 chooses the bottom toward R6: R1 → R4 → R5 → R6, cost 15. SRv6 adds nothing to that: SIDs follow the same routes.</p> },
  { id: "single", chapter: "One SID", title: "Encapsulate toward R6's SID.", body: <p>R1 wraps H1&apos;s packet in an outer IPv6 header: source <B>2001:db8::1</B>, destination <B>R6&apos;s End SID</B>. One SID needs no extra header.</p> },
  { id: "transit", chapter: "One SID", title: "Transit is plain IPv6.", body: <p>R4 and R5 look only at the destination address: it matches R6&apos;s locator route. They don&apos;t need SRv6, a SID table, or anything new.</p> },
  { id: "usd", chapter: "One SID", title: "R6 executes End, removes the wrapper.", body: <p>R6 finds the DA in its local SID table: End, no segments left. It removes the outer header (<B>USD</B>, ultimate segment decapsulation) and forwards H1&apos;s original packet to H6.</p> },
  { id: "list", chapter: "A segment list", title: "Go through R3 first.", body: <p>To force the top path: <B>[R3&apos;s End, R6&apos;s End]</B>. More than one segment needs a place to keep the rest — the Segment Routing Header.</p> },
  { id: "srh", chapter: "A segment list", title: "The SRH, stored in reverse.", body: <p>The <B>SRH</B> (RFC 8754) holds the list with the last segment at index 0. <B>Segments Left</B> counts what is still to do. IOS XR keeps the first SID only in the destination address (reduced encapsulation): SRH = [0: R6&apos;s SID], Segments Left 1.</p> },
  { id: "active", chapter: "A segment list", title: "The active segment is the DA.", body: <p>Routers forward on the destination address — R3&apos;s SID — so R1 sends the packet up the top. The SRH rides along untouched by R2.</p> },
  { id: "end", chapter: "End", title: "R3: next segment.", body: <p>The DA matches R3&apos;s End SID. End: Segments Left 1 → 0, copy Segment List[0] — R6&apos;s SID — into the DA, forward. One instruction, executed by one node.</p> },
  { id: "psp", chapter: "End", title: "Nothing left: drop the SRH.", body: <p>With Segments Left at 0, R3 removes the SRH (<B>PSP</B>, penultimate segment pop). R6 receives a plain encapsulated packet to its own SID and does USD, as before.</p> },
  { id: "three", chapter: "End", title: "Three SIDs, and a detour.", body: <p>[R5, R3, R6]: after R5, the DA is R3&apos;s SID, whose best route from R5 runs through R6. R6 forwards it as transit — the DA isn&apos;t its SID yet — R3 executes End, and the packet returns to R6.</p> },
  { id: "path", chapter: "Behavior", title: "A SID is not a path.", body: <p>If R4–R5 becomes expensive, R6&apos;s locator route moves to the top — and the very same SID follows it. The SID names a node and an instruction; routing decides the way.</p> },
  { id: "notmpls", chapter: "Where it fits", title: "SR-MPLS vs SRv6.", body: <p>The same segment routing ideas, two data planes.</p> },
  { id: "breaks", chapter: "When it breaks", title: "Five ways it fails.", body: <p>A locator routed but no SID behind it; a locator with the wrong prefix; a locator not enabled in IS-IS; no encapsulation source on the headend; an MTU without room for the extra headers.</p> },
  { id: "verify", chapter: "Verify", title: "The questions engineers ask.", body: <p>Is the locator advertised? Does the SID exist in its owner&apos;s table? Is there a route to it from the headend? Can the headend encapsulate? Is there room for the headers? Ping the SID — an instantiated End SID answers.</p> },
  { id: "recap", chapter: "The whole idea", title: "Route to the locator, execute the function.", body: <p>Now watch it in the lesson, then break and fix it in the SRv6 Foundations Lab.</p> },
];
const VISUAL: Record<Id, string> = Object.fromEntries(STEPS.map((s) => [s.id, ["notmpls", "breaks", "verify", "recap"].includes(s.id) ? s.id : "topo"])) as Record<Id, string>;

const NODES: TopoNode[] = [
  { id: "R1", label: "R1", sub: "headend", icon: "PE", x: 8, y: 50 },
  { id: "R2", label: "R2", sub: "…:2::/64", icon: "P", x: 36, y: 16 },
  { id: "R3", label: "R3", sub: "…:3::/64", icon: "P", x: 64, y: 16 },
  { id: "R4", label: "R4", sub: "…:4::/64", icon: "P", x: 36, y: 84 },
  { id: "R5", label: "R5", sub: "…:5::/64", icon: "P", x: 64, y: 84 },
  { id: "R6", label: "R6", sub: "…:6::/64", icon: "PE", x: 92, y: 50 },
];
const LINKS: [string, string, string][] = [["R1", "R2", "10"], ["R2", "R3", "10"], ["R3", "R6", "10"], ["R1", "R4", "5"], ["R4", "R5", "5"], ["R5", "R6", "5"]];
const TOP = new Set(["R1-R2", "R2-R3", "R3-R6"]);
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
    const hot = ["underlay", "single", "transit", "usd"].includes(id) ? BOT : ["list", "srh", "active", "end", "psp", "path"].includes(id) ? TOP : new Set<string>();
    const links: TopoLink[] = LINKS.map(([a, b, m]) => {
      const key = `${a}-${b}`;
      return { a, b, state: (id === "path" && key === "R4-R5" ? "down" : hot.has(key) ? "active" : hot.size ? "dim" : "up") as TopoLink["state"], label: ["underlay", "path"].includes(id) ? (id === "path" && key === "R4-R5" ? "50" : m) : "" };
    });
    const views: Record<string, TopoView> = {};
    let movers: ReactNode = null;
    if (id === "problem") views.R1 = { bubble: { text: "IPv6 everywhere already", tone: "ask" } };
    if (id === "idea") views.R3 = { bubble: { text: "SID = IPv6 address", tone: "yes" } };
    if (id === "sid") views.R3 = { ring: "hit", bubble: { text: "…:3 | :1", tone: "info" } };
    if (id === "locator") views.R3 = { bubble: { text: "locator …:3::/64", tone: "info" } };
    if (id === "function") views.R3 = { bubble: { text: "function 1 = End", tone: "info" } };
    if (id === "lsid") views.R3 = { bubble: { text: "…:3:9:: → no entry", tone: "warn" } };
    if (id === "advertise") for (const r of ["R2", "R3", "R4", "R5", "R6"]) views[r] = { badge: { text: "End", tone: "info" } };
    if (id === "single") views.R1 = { bubble: { text: "DA = R6's End SID", tone: "yes" } };
    if (id === "transit") movers = <>{go("R1", "R4", { label: "DA …:6:1::", key: "1" })}{go("R4", "R5", { label: "DA …:6:1::", key: "2", delay: 800 })}{go("R5", "R6", { label: "DA …:6:1::", key: "3", delay: 1600 })}</>;
    if (id === "usd") views.R6 = { ring: "hit", bubble: { text: "End · USD", tone: "yes" } };
    if (id === "list") views.R1 = { bubble: { text: "[R3, R6]", tone: "info" } };
    if (id === "srh") views.R1 = { bubble: { text: "SRH [0]=R6 · SL 1", tone: "info" } };
    if (id === "active") movers = <>{go("R1", "R2", { label: "DA …:3:1:: SL1", key: "1", color: "violet" })}{go("R2", "R3", { label: "DA …:3:1:: SL1", key: "2", delay: 800, color: "violet" })}</>;
    if (id === "end") views.R3 = { ring: "hit", bubble: { text: "SL 1→0, DA = R6", tone: "yes" } };
    if (id === "psp") movers = <>{go("R3", "R6", { label: "DA …:6:1:: (no SRH)", key: "1" })}</>;
    if (id === "three") {
      views.R5 = { bubble: { text: "End: DA = R3", tone: "info" } };
      views.R6 = { bubble: { text: "transit first", tone: "warn", delay: 400 } };
    }
    if (id === "path") views.R1 = { bubble: { text: "same SID, top path", tone: "yes" } };
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
    case "notmpls":
      return (
        <>
          {head}
          <Compare items={[{ title: "SR-MPLS", tone: "amber", body: "segment = 20-bit label · SRGB + index · MPLS push/swap/pop on every router" }, { title: "SRv6", tone: "cyan", body: "segment = 128-bit IPv6 SID · locator + function · plain IPv6 transit, SRH for lists" }, { title: "Both", tone: "violet", body: "source routing · IGP-distributed segments · no per-flow state in the core" }]} />
        </>
      );
    case "breaks":
      return (
        <>
          {head}
          <MiniTable title="How SRv6 fails" cols={["Fault", "What you see"]} rows={[{ cells: ["Locator routed, no SID", "dropped at the owner"], state: "hit" }, { cells: ["Wrong locator prefix", "no route at the headend"] }, { cells: ["Locator not in IS-IS", "no route, no SID"] }, { cells: ["No encapsulation source", "nothing leaves the headend"] }, { cells: ["No MTU headroom", "big packets: Packet Too Big"] }]} />
        </>
      );
    case "verify":
      return (
        <>
          {head}
          <MiniTable title="IOS XR" cols={["Question", "Command"]} rows={[{ cells: ["Which SIDs does a router own?", "show segment-routing srv6 sid"] }, { cells: ["Is the locator advertised?", "show isis segment-routing srv6 locators"] }, { cells: ["Route to a SID?", "show route ipv6 <sid>"] }, { cells: ["Does the SID answer?", "ping <sid>"] }]} />
        </>
      );
    case "recap":
      return (
        <>
          {head}
          <Chain k="recap" items={[{ t: "SID = locator (routes) + function (instructs)" }, { t: "Only instantiated SIDs exist: the local SID table", tone: "cyan" }, { t: "Transit is plain IPv6 on the destination address", tone: "amber" }, { t: "SRH: list reversed, Segments Left, active SID in the DA", tone: "violet" }, { t: "End: next segment · PSP drops the SRH · USD drops the wrapper", tone: "green" }]} />
        </>
      );
  }
  return head;
}

export function SxPresentation({ open, onClose, onFinish, finishLabel }: { open: boolean; onClose: () => void; onFinish: () => void; finishLabel: string }) {
  const [play, setPlay] = useState(0);
  return (
    <LessonPresentation
      open={open}
      onClose={onClose}
      title="SRv6, from zero"
      kicker="Learn · the SRv6 Foundations presentation"
      steps={STEPS}
      visual={(s) => VISUAL[s.id as Id]}
      renderStage={(s) => <Deck step={s as Step} play={play} replay={() => setPlay((p) => p + 1)} />}
      finish={{ label: finishLabel, onClick: onFinish }}
      skip={{ label: "Skip →", onClick: onFinish }}
    />
  );
}
