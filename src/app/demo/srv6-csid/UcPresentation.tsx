"use client";

import { useState, type ReactNode } from "react";
import { LessonPresentation } from "@/components/presentation/LessonPresentation";
import { Mover, StageHead, type DeckStep } from "@/components/presentation/ScrollyDeck";
import { Chain, MiniTable, ReplayButton, Token, Topo, nodeAt, type TopoLink, type TopoNode, type TopoView } from "@/components/presentation/Visuals";
import { useFitNodes } from "@/components/presentation/fitNarrow";
import { createUNet } from "@/lib/sim-engine/scenarios/ucNet";

/**
 * SRv6 uSID / CSID — the presentation before the lesson and the lab. Every SID, carrier and byte count on the slides is
 * read from the lab model (ucNet.ts, IOS XR F3216). Presentation state only.
 */

type Id = "problem" | "path" | "classic" | "cost" | "common" | "block" | "idea" | "carrier" | "pack" | "active" | "shift" | "route" | "local" | "boundary" | "final" | "result" | "whatsaved" | "rfc" | "incident" | "compare" | "breaks" | "verify" | "recap";
type Step = DeckStep & { id: Id };
const B = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;
const M = ({ children }: { children: ReactNode }) => <span className="pv-mono text-pv-text">{children}</span>;
const G = createUNet(0).view.green;
const C1 = G.entries[0].text;
const C2 = G.entries[1].text;

const STEPS: Step[] = [
  { id: "problem", chapter: "The question", title: "Long paths, heavy headers.", body: <p>An SR policy that names many waypoints carries one 128-bit SID per waypoint. On a long path the header can outweigh a small packet — and big packets stop fitting the MTU.</p> },
  { id: "path", chapter: "The question", title: "GREEN's path.", body: <p>CUST&apos;s policy GREEN goes R1 → R2 → R3 → R4 → R5 → R6, then R6&apos;s express link to R8. Five SIDs in the list plus R8&apos;s VPN service SID: {G.sids.length} SIDs.</p> },
  { id: "classic", chapter: "Classic SRv6", title: "One SID, one 128-bit entry.", body: <p>Classically each SID is a full IPv6 address: the first goes in the destination address, the other {G.classicEntries - 1} in the SRH — 8 + {G.classicEntries - 1} × 16 = {G.classicSrhBytes} bytes.</p> },
  { id: "cost", chapter: "Classic SRv6", title: `${G.classicOverhead} bytes before the payload.`, body: <p>40 bytes of outer IPv6 plus the SRH. With a 1500-byte core MTU, a 1430-byte packet needs {1430 + G.classicOverhead} — it doesn&apos;t fit.</p> },
  { id: "common", chapter: "What repeats", title: "Look at the SIDs.", body: <p><M>fcbb:bb00:2::</M>, <M>fcbb:bb00:3::</M>, <M>fcbb:bb00:4::</M>… Every SID starts with the same 32 bits and ends in zeros. Only 16 bits per node differ.</p> },
  { id: "block", chapter: "What repeats", title: "One block, many nodes.", body: <p>The common part is the <B>block</B>, <M>fcbb:bb00::/32</M>. Each router&apos;s locator is the block plus its own 16 bits: R6&apos;s is <M>fcbb:bb00:6::/48</M>. Those 16 bits are R6&apos;s <B>uSID</B>.</p> },
  { id: "idea", chapter: "The idea", title: "Carry the block once.", body: <p>Put the block in once, then several 16-bit uSIDs one after another. 128 − 32 = 96 bits: <B>six uSIDs</B> per 128-bit <B>carrier</B> (IOS XR format F3216).</p> },
  { id: "carrier", chapter: "The idea", title: "A carrier is a real IPv6 address.", body: <p><M>{C1}</M> — block, then uSIDs 2, 3, 4, 5, 6, e002. It routes like any address: toward the owner of its first uSID.</p> },
  { id: "pack", chapter: "The idea", title: "R1 packs the list.", body: <p>With <M>sid-format usid-f3216</M>, R1 packs GREEN&apos;s SIDs and the service SID into {G.entries.length} carriers: <M>{C1}</M> and <M>{C2}</M>.</p> },
  { id: "active", chapter: "The packet", title: "The active uSID.", body: <p>The router reads bits 32–47 of the destination — right after the block. That 16-bit value is the <B>active uSID</B>. First: 2, R2.</p> },
  { id: "shift", chapter: "The packet", title: "Execute and shift.", body: <p>R2 owns uSID 2 (its <B>uN</B>). It shifts the rest left and pads with zeros: <M>fcbb:bb00:3:4:5:6:e002::</M>. Segments Left doesn&apos;t move — the SRH is untouched.</p> },
  { id: "route", chapter: "The packet", title: "Everyone else just routes.", body: <p>The new destination falls in R3&apos;s locator <M>fcbb:bb00:3::/48</M>, so R2 routes it there. R3, R4 and R5 repeat: execute, shift, route.</p> },
  { id: "local", chapter: "The packet", title: "A local uSID.", body: <p>At R6, after its uN, the active uSID is <M>e002</M>: a value from the <B>local ID block</B> — R6&apos;s <B>uA</B> toward R8. Local uSIDs mean something only at the node that just executed its uN.</p> },
  { id: "boundary", chapter: "The packet", title: "The carrier runs out.", body: <p>Nothing follows e002 in the carrier. R6 copies the next SRH entry, <M>{C2}</M>, into the destination (Segments Left 1 → 0) and sends it out of the express link, as the uA says.</p> },
  { id: "final", chapter: "The packet", title: "The service at the end.", body: <p>R8 executes uN 8, shifts, and finds <M>e002</M> — at R8 that&apos;s its <B>uDT4</B>: decapsulate, look up in VRF CUST, deliver to CE8.</p> },
  { id: "result", chapter: "The result", title: `${G.overhead} bytes instead of ${G.classicOverhead}.`, body: <p>40 + 8 + 16 × {G.entries.length - 1} = {G.overhead} bytes. The same path, the same behaviors, {G.classicOverhead - G.overhead} bytes less on every packet — and the 1430-byte packet fits.</p> },
  { id: "whatsaved", chapter: "The result", title: "What exactly was saved.", body: <p>Not routers, not behaviors: the block repeated in every SID and the padding behind each 16-bit value. Compression changes the <B>encoding</B>, never the <B>program</B>.</p> },
  { id: "rfc", chapter: "The result", title: "uSID, CSID, NEXT-CSID.", body: <p>RFC 9800 calls this <B>NEXT-CSID</B> (compressed SIDs); “uSID” is the industry name and IOS XR&apos;s. The RFC also defines REPLACE-CSID, which the guided lesson shows; IOS XR deploys NEXT-CSID.</p> },
  { id: "incident", chapter: "When it breaks", title: "One node can't join in.", body: <p>The guided lesson&apos;s incident: one router can&apos;t take part in compression. In the lab R4&apos;s locator loses its micro-segment behavior: its classic SID needs its own 128-bit entry — three entries, 80 bytes. R4 still works; big packets don&apos;t fit.</p> },
  { id: "compare", chapter: "Where it fits", title: "Classic vs compressed.", body: <p>Same program, two encodings.</p> },
  { id: "breaks", chapter: "When it breaks", title: "Five ways compression goes wrong.", body: <p>A classic node in the middle; uSIDs in the wrong order; a stale local uSID; an unreachable locator; a headend that doesn&apos;t pack.</p> },
  { id: "verify", chapter: "Verify", title: "The questions engineers ask.", body: <p>How many carriers does R1 push, and how many bytes? Is every locator micro-segment? Which uSID is active where? Do the local uSIDs still exist?</p> },
  { id: "recap", chapter: "The whole idea", title: "Block once, uSIDs in a row.", body: <p>Now follow it in the lesson, then pack and break it in the SRv6 uSID Lab.</p> },
];
const VISUAL: Record<Id, string> = Object.fromEntries(STEPS.map((s) => [s.id, ["compare", "breaks", "verify", "recap"].includes(s.id) ? s.id : "topo"])) as Record<Id, string>;

const NODES: TopoNode[] = [
  { id: "R1", label: "R1", sub: "headend", icon: "PE", x: 5, y: 62 },
  { id: "R2", label: "R2", sub: "uSID 2", icon: "P", x: 18, y: 62 },
  { id: "R3", label: "R3", sub: "uSID 3", icon: "P", x: 31, y: 62 },
  { id: "R4", label: "R4", sub: "uSID 4", icon: "P", x: 43, y: 24 },
  { id: "R5", label: "R5", sub: "uSID 5", icon: "P", x: 55, y: 62 },
  { id: "R6", label: "R6", sub: "uSID 6", icon: "P", x: 68, y: 62 },
  { id: "R7", label: "R7", sub: "uSID 7", icon: "P", x: 81, y: 24 },
  { id: "R8", label: "R8", sub: "uSID 8 · CUST", icon: "PE", x: 94, y: 62 },
];
const LINKS: [string, string][] = [["R1", "R2"], ["R2", "R3"], ["R3", "R4"], ["R4", "R5"], ["R5", "R6"], ["R6", "R7"], ["R7", "R8"], ["R3", "R5"], ["R6", "R8"]];
const GREEN = new Set(["R1-R2", "R2-R3", "R3-R4", "R4-R5", "R5-R6", "R6-R8"]);

function Deck({ step: s, play, replay }: { step: Step; play: number; replay: () => void }) {
  const FIT = useFitNodes(NODES, 330);
  const id = s.id;
  const k = `${id}-${play}`;
  const head = <StageHead chapter={s.chapter} title={s.title} />;
  const go = (f: string, t: string, o: { label: string; key: string; delay?: number; color?: string }) => (
    <Mover key={`${k}-${o.key}`} from={nodeAt(FIT.nodes, f)} to={nodeAt(FIT.nodes, t)} delay={o.delay} duration={800}>
      <Token color={o.color ?? "violet"}>{o.label}</Token>
    </Mover>
  );
  if (VISUAL[id] === "topo") {
    const hot = ["path", "result", "whatsaved"].includes(id) ? GREEN : new Set<string>();
    const links: TopoLink[] = LINKS.map(([a, b]) => {
      const key = `${a}-${b}`;
      return { a, b, state: (hot.has(key) ? "active" : hot.size ? "dim" : "up") as TopoLink["state"], label: key === "R6-R8" ? "express" : key === "R3-R5" ? "alt" : "" };
    });
    const views: Record<string, TopoView> = {};
    let movers: ReactNode = null;
    if (id === "problem") views.R1 = { bubble: { text: "128 bits per waypoint", tone: "warn" } };
    if (id === "classic") views.R1 = { bubble: { text: `${G.classicEntries} × 128-bit SIDs`, tone: "warn" } };
    if (id === "cost") views.R1 = { ring: "bad", bubble: { text: `${G.classicOverhead} B overhead`, tone: "bad" } };
    if (id === "common") views.R4 = { bubble: { text: "fcbb:bb00:4::", tone: "info" } };
    if (id === "block") views.R6 = { ring: "hit", bubble: { text: "fcbb:bb00:6::/48", tone: "info" } };
    if (id === "idea") views.R1 = { bubble: { text: "block + 6 uSIDs", tone: "yes" } };
    if (id === "carrier") views.R2 = { bubble: { text: "first uSID: 2", tone: "info" } };
    if (id === "pack") views.R1 = { ring: "hit", bubble: { text: `${G.entries.length} carriers`, tone: "yes" } };
    if (id === "active") movers = <>{go("R1", "R2", { label: "…:2:3:4:5:6:e002", key: "1" })}</>;
    if (id === "shift") views.R2 = { ring: "hit", bubble: { text: "uN → shift", tone: "yes" } };
    if (id === "route") movers = <>{go("R2", "R3", { label: "…:3:4:5:6:e002::", key: "1" })}{go("R3", "R4", { label: "…:4:5:6:e002::", key: "2", delay: 800 })}{go("R4", "R5", { label: "…:5:6:e002::", key: "3", delay: 1600 })}</>;
    if (id === "local") views.R6 = { ring: "hit", bubble: { text: "e002 = my uA → R8", tone: "info" } };
    if (id === "boundary") movers = <>{go("R6", "R8", { label: `DA ${C2.replace("fcbb:bb00:", "…:")}`, key: "1" })}</>;
    if (id === "final") views.R8 = { ring: "hit", bubble: { text: "e002 = my uDT4", tone: "yes" } };
    if (id === "result") views.R1 = { bubble: { text: `${G.overhead} B overhead`, tone: "yes" } };
    if (id === "incident") views.R4 = { ring: "bad", bubble: { text: "classic SID: own entry", tone: "warn" } };
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
    case "compare":
      return (
        <>
          {head}
          <MiniTable title="GREEN, computed by the lab" cols={["", "Classic", "uSID"]} rows={[{ cells: ["128-bit entries", String(G.classicEntries), String(G.entries.length)] }, { cells: ["SRH", `${G.classicSrhBytes} B`, `${G.srhBytes} B`] }, { cells: ["Overhead", `${G.classicOverhead} B`, `${G.overhead} B`], state: "hit" }, { cells: ["1430-byte packet", 1430 + G.classicOverhead > 1500 ? "doesn't fit" : "fits", 1430 + G.overhead > 1500 ? "doesn't fit" : "fits"] }]} />
        </>
      );
    case "breaks":
      return (
        <>
          {head}
          <MiniTable title="How compression fails" cols={["Fault", "What you see"]} rows={[{ cells: ["Classic node in the list", "an extra 128-bit entry"], state: "hit" }, { cells: ["uSIDs out of order", "a longer path"] }, { cells: ["Stale local uSID", "drop at that node"] }, { cells: ["Locator not advertised", "policy down"] }, { cells: ["Headend doesn't pack", "one entry per SID"] }]} />
        </>
      );
    case "verify":
      return (
        <>
          {head}
          <MiniTable title="IOS XR" cols={["Question", "Command"]} rows={[{ cells: ["Carriers, SIDs?", "show segment-routing traffic-eng policy"] }, { cells: ["What is pushed, bytes?", "show cef vrf CUST <ip>"] }, { cells: ["Micro-segment locator?", "show segment-routing srv6 locator"] }, { cells: ["Local uSIDs?", "show segment-routing srv6 sid"] }]} />
        </>
      );
    case "recap":
      return (
        <>
          {head}
          <Chain k="recap" items={[{ t: "uSIDs share one block; 16 bits per node" }, { t: "A carrier holds the block once and six uSIDs", tone: "cyan" }, { t: "Owner of the active uSID executes and shifts", tone: "violet" }, { t: "Next SRH entry only when a carrier runs out", tone: "amber" }, { t: "Local uSIDs only mean something at their node", tone: "green" }]} />
        </>
      );
  }
  return head;
}

export function UcPresentation({ open, onClose, onFinish, finishLabel }: { open: boolean; onClose: () => void; onFinish: () => void; finishLabel: string }) {
  const [play, setPlay] = useState(0);
  return (
    <LessonPresentation
      open={open}
      onClose={onClose}
      title="SRv6 uSID, from zero"
      kicker="Learn · the SRv6 uSID / CSID presentation"
      steps={STEPS}
      visual={(s) => VISUAL[s.id as Id]}
      renderStage={(s) => <Deck step={s as Step} play={play} replay={() => setPlay((p) => p + 1)} />}
      finish={{ label: finishLabel, onClick: onFinish }}
      skip={{ label: "Skip →", onClick: onFinish }}
    />
  );
}
