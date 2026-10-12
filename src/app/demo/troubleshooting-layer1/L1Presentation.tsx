"use client";

import { useState, type ReactNode } from "react";
import { LessonPresentation } from "@/components/presentation/LessonPresentation";
import { Mover, StageHead, type DeckStep } from "@/components/presentation/ScrollyDeck";
import { Chain, MiniTable, ReplayButton, Token, Topo, nodeAt, type TopoLink, type TopoNode, type TopoView } from "@/components/presentation/Visuals";
import { useFitNodes } from "@/components/presentation/fitNarrow";
import { HISTORIC_CRC, L1_IP, UPLINK, WINDOW_S } from "@/lib/sim-engine/scenarios/troubleshootingLayer1";
import { createL1Net, dbmText, l1Apply, l1TicketState, l1View, lastTest, snapDelta, type L1Action, type L1State } from "@/lib/sim-engine/scenarios/l1Net";

/**
 * Layer 1 Troubleshooting — the presentation before the lesson and the lab. Light levels, counter deltas, ping losses
 * and throughput on the slides are read from the lab model (l1Net.ts). Presentation state only.
 */

type Id = "problem" | "guess" | "net" | "states" | "admin" | "fiber" | "budget" | "whose" | "history" | "delta" | "incident" | "light" | "crc" | "oneside" | "download" | "negotiate" | "mismatch" | "downshift" | "los" | "repair" | "proof" | "workflow" | "recap";
type Step = DeckStep & { id: Id };
const B = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;
const M = ({ children }: { children: ReactNode }) => <span className="pv-mono text-pv-text">{children}</span>;
const run = (s: L1State, ...a: L1Action[]) => a.reduce((x, y) => l1Apply(x, y), s);
const H = createL1Net(0);
const HV = l1View(H);
const HD = run(H, { type: "snapshot" }, { type: "wait", secs: WINDOW_S }, { type: "snapshot" });
const INC = run(l1TicketState("dirty", 1), { type: "ping", count: 100 }, { type: "iperf", reverse: true }, { type: "iperf" }, { type: "snapshot" }, { type: "wait", secs: WINDOW_S }, { type: "snapshot" });
const IV = l1View(INC);
const IP = INC.tests.find((t) => t.kind === "ping")!;
const DOWN = INC.tests.find((t) => t.kind === "iperf" && t.reverse)!;
const UP = INC.tests.find((t) => t.kind === "iperf" && !t.reverse)!;
const ID = snapDelta(INC)!;
const DUP = lastTest(run(l1TicketState("duplex", 1), { type: "iperf" }), "iperf")!;
const DS = lastTest(run(l1TicketState("copper", 1), { type: "iperf", reverse: true }), "iperf")!;
const FIX = run(INC, { type: "phys", id: "clean-a" }, { type: "snapshot" }, { type: "wait", secs: WINDOW_S }, { type: "snapshot" }, { type: "ping", count: 100 });
const FD = snapDelta(FIX)!;
const A = `ACCESS-SW:${UPLINK}`;
const D = `DIST-SW:${UPLINK}`;

const STEPS: Step[] = [
  { id: "problem", chapter: "The question", title: "“Downloads crawl.”", body: <p>Copying files from SERVER has been painfully slow since yesterday. Ping works — mostly. The uplink between the switches shows <B>UP</B>, and nobody touched a configuration.</p> },
  { id: "guess", chapter: "The question", title: "“It's up, so it's fine.”", body: <p>Many people stop at the link light. But UP only means the two ends hear each other. Whether the bits arrive <i>intact</i> is a different question — the physical layer has its own evidence.</p> },
  { id: "net", chapter: "The network", title: "One subnet, two switches.", body: <p>CLIENT <M>{L1_IP.CLIENT}</M> and SERVER <M>{L1_IP.SERVER}</M> share a subnet. Copper to the access switch, a <B>1000BASE-LX fiber</B> uplink on <M>{UPLINK}</M> between the switches, copper to SERVER.</p> },
  { id: "states", chapter: "Two kinds of down", title: "Admin and link.", body: <p>Every interface has an <B>admin</B> state (what the configuration asks for) and a <B>link</B> state (what the hardware achieved). <M>up / up</M> is healthy; <M>up / down</M> sends you to the cable or optics.</p> },
  { id: "admin", chapter: "Two kinds of down", title: "Down on purpose.", body: <p>A port with <M>disable</M> in its configuration is <M>down / down</M> — and the far end sees no link either. The cable is innocent; the fix is a commit.</p> },
  { id: "fiber", chapter: "Light", title: "Two strands, two directions.", body: <p>A fiber link is two strands. ACCESS-SW&apos;s laser lights one, DIST-SW&apos;s the other. Each optic reports what it sends (<B>Tx</B>) and what it receives (<B>Rx</B>).</p> },
  { id: "budget", chapter: "Light", title: "Rx = peer's Tx − loss.", body: <p>DIST-SW sends {dbmText(HV.uplink.txD)}, ACCESS-SW receives {dbmText(HV.uplink.rxA)}: the path costs about 1.2 dB. dBm is logarithmic — every 3 dB is half the light.</p> },
  { id: "whose", chapter: "Light", title: "Whose light is my Rx?", body: <p>ACCESS-SW&apos;s Rx tells you about <B>DIST-SW&apos;s</B> laser and the strand between them. To find the bad direction, read both ends.</p> },
  { id: "history", chapter: "Counters", title: `${HISTORIC_CRC.toLocaleString("en-US")} CRC errors.`, body: <p>ACCESS-SW <M>{UPLINK}</M> shows thousands of CRC errors. Alarming? Counters accumulate since the last clear — these could be weeks old.</p> },
  { id: "delta", chapter: "Counters", title: "Deltas are now.", body: <p>Snapshot, {WINDOW_S} s of traffic, snapshot: CRC <B>+{snapDelta(HD)!.d[A].crc}</B>. On the healthy network the old errors are history. Only a change over a known interval tells you what is happening now.</p> },
  { id: "incident", chapter: "The incident", title: "UP — and slow.", body: <p>Today: 100 pings, {IP.recv} replies. A download runs at {DOWN.mbps} Mbit/s with {DOWN.retr} retransmissions. The uplink is still <B>UP</B>.</p> },
  { id: "light", chapter: "The incident", title: "Too little light.", body: <p>ACCESS-SW now receives <B>{dbmText(IV.uplink.rxA)}</B> instead of {dbmText(HV.uplink.rxA)}, while DIST-SW still sends a normal {dbmText(IV.uplink.txD)}. The light is lost on the DIST → ACCESS path.</p> },
  { id: "crc", chapter: "The incident", title: "Misread bits, failed checks.", body: <p>Marginal light is enough to keep the link up but not to read every bit correctly. The frame&apos;s <B>CRC-32 (FCS)</B> no longer matches; ACCESS-SW discards it and counts a CRC error. Nothing is sent back.</p> },
  { id: "oneside", chapter: "The incident", title: "Errors on one side only.", body: <p>Over {ID.secs} s: ACCESS-SW <M>{UPLINK}</M> CRC <B>+{ID.d[A].crc}</B>, DIST-SW <M>{UPLINK}</M> CRC <B>+{ID.d[D].crc}</B>. The receiver with the low light is the one counting errors.</p> },
  { id: "download", chapter: "The incident", title: "Why only downloads?", body: <p>Download {DOWN.mbps} Mbit/s, upload {UP.mbps} Mbit/s. A download&apos;s data crosses the bad strand and must be retransmitted; an upload only sends small ACKs over it.</p> },
  { id: "negotiate", chapter: "Copper", title: "Copper negotiates.", body: <p>On copper, both ends advertise what they can do and pick the best common speed and duplex — <B>auto-negotiation</B>. Healthy here: 1000 Mb/s, full duplex, at both ends.</p> },
  { id: "mismatch", chapter: "Copper", title: "Force one end, break both.", body: <p>Force the switch port to 100/full with negotiation off: CLIENT detects 100 Mb/s but must assume <B>half</B> duplex. Late collisions on one side, CRC errors and runts on the other: {DUP.mbps} Mbit/s.</p> },
  { id: "downshift", chapter: "Copper", title: "A crushed cable.", body: <p>Gigabit needs all four pairs. With one pair open the PHYs <B>downshift</B> to 100 Mb/s — no errors at all, just a {DS.mbps} Mbit/s ceiling. A TDR test names the pair and the distance.</p> },
  { id: "los", chapter: "Copper", title: "No light at all.", body: <p>Break the strand instead and ACCESS-SW receives nothing: loss of signal. It signals a remote fault, so <B>both</B> ends go down although both are enabled.</p> },
  { id: "repair", chapter: "Proof", title: "Clean the right end.", body: <p>Clean and reseat the ACCESS-end connector. The link flaps twice while you work; afterwards ACCESS-SW receives {dbmText(l1View(FIX).uplink.rxA)}.</p> },
  { id: "proof", chapter: "Proof", title: "Prove it, fresh.", body: <p>A new snapshot pair over {FD.secs} s with traffic: CRC <B>+{FD.d[A].crc}</B>. The same 100 pings: {lastTest(FIX, "ping")!.recv}/100. A cleared counter would read 0 even if errors continued — fresh deltas don&apos;t lie.</p> },
  { id: "workflow", chapter: "Proof", title: "The workflow.", body: <p>Admin and link state of every hop, light at both ends, error deltas with traffic, speed and duplex at both ends — then one repair and fresh measurements.</p> },
  { id: "recap", chapter: "The whole idea", title: "UP is not healthy.", body: <p>Now follow it in the lesson, then measure, break and repair it yourself in the Layer 1 Lab.</p> },
];
const VISUAL: Record<Id, string> = Object.fromEntries(STEPS.map((s) => [s.id, ["budget", "delta", "oneside", "mismatch", "workflow", "recap"].includes(s.id) ? s.id : "topo"])) as Record<Id, string>;

const NODES: TopoNode[] = [
  { id: "CLIENT", label: "CLIENT", sub: L1_IP.CLIENT, icon: "host", x: 9, y: 70 },
  { id: "ACCESS", label: "ACCESS-SW", sub: "access", icon: "SW", x: 31, y: 36 },
  { id: "DIST", label: "DIST-SW", sub: "distribution", icon: "SW", x: 69, y: 36 },
  { id: "SERVER", label: "SERVER", sub: L1_IP.SERVER, icon: "srv", x: 91, y: 70 },
];
const LINKS: [string, string, string?][] = [["CLIENT", "ACCESS", "copper"], ["ACCESS", "DIST", "fiber"], ["DIST", "SERVER", "copper"]];

function Deck({ step: s, play, replay }: { step: Step; play: number; replay: () => void }) {
  const FIT = useFitNodes(NODES, 250);
  const id = s.id;
  const k = `${id}-${play}`;
  const head = <StageHead chapter={s.chapter} title={s.title} />;
  const go = (f: string, t: string, o: { label: string; key: string; delay?: number; color?: string }) => (
    <Mover key={`${k}-${o.key}`} from={nodeAt(FIT.nodes, f)} to={nodeAt(FIT.nodes, t)} delay={o.delay} duration={700}>
      <Token color={o.color ?? "cyan"}>{o.label}</Token>
    </Mover>
  );
  if (VISUAL[id] === "topo") {
    const state = (a: string, b: string): TopoLink["state"] => {
      const up = a === "ACCESS" && b === "DIST";
      if (id === "admin" && b === "SERVER") return "down";
      if (id === "los" && up) return "down";
      if (["incident", "light", "crc", "download"].includes(id) && up) return "blocked";
      if ((id === "mismatch" || id === "downshift") && a === "CLIENT") return "blocked";
      if (["fiber", "whose"].includes(id)) return up ? "active" : "dim";
      return "up";
    };
    const links: TopoLink[] = LINKS.map(([a, b, l]) => ({ a, b, state: state(a, b), label: l ?? "" }));
    const views: Record<string, TopoView> = {};
    let movers: ReactNode = null;
    if (id === "problem") views.CLIENT = { bubble: { text: "downloads crawl", tone: "warn" } };
    if (id === "guess") views.ACCESS = { bubble: { text: "uplink UP", tone: "yes" } };
    if (id === "states") views.ACCESS = { ring: "on", bubble: { text: "admin up · link up", tone: "info" } };
    if (id === "admin") views.DIST = { ring: "bad", bubble: { text: "ge-0/0/2 disabled", tone: "bad" } };
    if (id === "fiber") movers = <>{go("ACCESS", "DIST", { label: "ACCESS laser", key: "1" })}{go("DIST", "ACCESS", { label: "DIST laser", key: "2", delay: 500, color: "violet" })}</>;
    if (id === "whose") views.ACCESS = { ring: "on", bubble: { text: `Rx ${dbmText(HV.uplink.rxA)} ← DIST's light`, tone: "info" } };
    if (id === "history") views.ACCESS = { bubble: { text: `CRC ${HISTORIC_CRC} (lifetime)`, tone: "ask" } };
    if (id === "incident") views.CLIENT = { ring: "bad", bubble: { text: `${IP.recv}/100 · ${DOWN.mbps} Mb/s`, tone: "warn" } };
    if (id === "light") {
      views.ACCESS = { ring: "bad", bubble: { text: `Rx ${dbmText(IV.uplink.rxA)}`, tone: "bad" } };
      views.DIST = { bubble: { text: `Tx ${dbmText(IV.uplink.txD)}`, tone: "yes" } };
    }
    if (id === "crc") {
      movers = go("DIST", "ACCESS", { label: "frame ✗ FCS", key: "1", color: "red" });
      views.ACCESS = { ring: "bad", bubble: { text: "CRC error +1", tone: "bad" } };
    }
    if (id === "download") movers = <>{go("DIST", "ACCESS", { label: "data ⟲", key: "1", color: "amber" })}{go("ACCESS", "DIST", { label: "ACKs", key: "2", delay: 500 })}</>;
    if (id === "negotiate") views.CLIENT = { bubble: { text: "1000 / full", tone: "yes" } };
    if (id === "mismatch") {
      views.ACCESS = { ring: "bad", bubble: { text: "forced 100 / full", tone: "warn" } };
      views.CLIENT = { ring: "bad", bubble: { text: "100 / half", tone: "bad" } };
    }
    if (id === "downshift") views.CLIENT = { ring: "hit", bubble: { text: `${DS.mbps} Mbit/s, no errors`, tone: "warn" } };
    if (id === "los") {
      views.ACCESS = { ring: "bad", bubble: { text: "Rx: no light", tone: "bad" } };
      views.DIST = { ring: "bad", bubble: { text: "remote fault → down", tone: "warn" } };
    }
    if (id === "repair") views.ACCESS = { ring: "hit", bubble: { text: "cleaned & reseated", tone: "yes" } };
    if (id === "proof") views.CLIENT = { ring: "hit", bubble: { text: "100/100 · CRC +0", tone: "yes" } };
    return (
      <>
        {head}
        <Topo nodes={FIT.nodes} links={links} views={views} ratio={48} minH={FIT.minH}>
          {movers}
        </Topo>
        {movers && <ReplayButton onClick={replay} />}
      </>
    );
  }
  switch (id) {
    case "budget":
      return (
        <>
          {head}
          <MiniTable title="The uplink's light, from the lab" cols={["direction", "Tx", "Rx", "loss"]} rows={[{ cells: ["ACCESS → DIST", dbmText(HV.uplink.txA), dbmText(HV.uplink.rxD), `${(HV.uplink.txA - HV.uplink.rxD).toFixed(1)} dB`] }, { cells: ["DIST → ACCESS", dbmText(HV.uplink.txD), dbmText(HV.uplink.rxA), `${(HV.uplink.txD - HV.uplink.rxA).toFixed(1)} dB`] }]} />
        </>
      );
    case "delta":
      return (
        <>
          {head}
          <MiniTable title={`ACCESS-SW ${UPLINK}, two snapshots ${WINDOW_S} s apart`} cols={["", "packets in", "CRC/align"]} rows={[{ cells: ["snapshot #1", HD.snaps[0].c[A].inPkts.toLocaleString("en-US"), String(HD.snaps[0].c[A].crc)] }, { cells: ["snapshot #2", HD.snaps[1].c[A].inPkts.toLocaleString("en-US"), String(HD.snaps[1].c[A].crc)] }, { cells: ["delta", `+${snapDelta(HD)!.d[A].inPkts.toLocaleString("en-US")}`, `+${snapDelta(HD)!.d[A].crc}`], state: "hit" }]} />
        </>
      );
    case "oneside":
      return (
        <>
          {head}
          <MiniTable title={`During the incident, over ${ID.secs} s`} cols={["receiver", "Rx", "CRC Δ"]} rows={[{ cells: [`ACCESS-SW ${UPLINK}`, dbmText(IV.uplink.rxA), `+${ID.d[A].crc}`], state: "bad" }, { cells: [`DIST-SW ${UPLINK}`, dbmText(IV.uplink.rxD), `+${ID.d[D].crc}`] }]} />
        </>
      );
    case "mismatch":
      return (
        <>
          {head}
          <MiniTable title="CLIENT's link, forced on one side" cols={["", "switch ge-0/0/1", "CLIENT eth0"]} rows={[{ cells: ["auto-negotiation", "off", "on"] }, { cells: ["speed", "100 Mb/s (forced)", "100 Mb/s (detected)"] }, { cells: ["duplex", "full (forced)", "half (assumed)"], state: "bad" }, { cells: ["counts", "CRC/align, runts", "late collisions"] }]} />
        </>
      );
    case "workflow":
      return (
        <>
          {head}
          <Chain k="wf" items={[{ t: "Admin and link state, every hop" }, { t: "Light at both ends of each fiber", tone: "cyan" }, { t: "Error deltas, with traffic", tone: "violet" }, { t: "Speed and duplex at both ends", tone: "amber" }, { t: "One repair", tone: "amber" }, { t: "Fresh measurements prove it", tone: "green" }]} />
        </>
      );
    case "recap":
      return (
        <>
          {head}
          <Chain k="recap" items={[{ t: "Admin = intent, link = achievement" }, { t: "My Rx is the peer's Tx minus the strand", tone: "cyan" }, { t: "Counters are history; deltas are now", tone: "violet" }, { t: "Marginal light → CRC errors on one side", tone: "amber" }, { t: "Speed and duplex must agree", tone: "green" }]} />
        </>
      );
  }
  return head;
}

export function L1Presentation({ open, onClose, onFinish, finishLabel }: { open: boolean; onClose: () => void; onFinish: () => void; finishLabel: string }) {
  const [play, setPlay] = useState(0);
  return (
    <LessonPresentation
      open={open}
      onClose={onClose}
      title="The physical layer, from zero"
      kicker="Learn · the Layer 1 presentation"
      steps={STEPS}
      visual={(s) => VISUAL[s.id as Id]}
      renderStage={(s) => <Deck step={s as Step} play={play} replay={() => setPlay((p) => p + 1)} />}
      finish={{ label: finishLabel, onClick: onFinish }}
      skip={{ label: "Skip →", onClick: onFinish }}
    />
  );
}
