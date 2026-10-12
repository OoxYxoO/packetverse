"use client";

import { useState, type ReactNode } from "react";
import { LessonPresentation } from "@/components/presentation/LessonPresentation";
import { Mover, StageHead, type DeckStep } from "@/components/presentation/ScrollyDeck";
import { Chain, MiniTable, ReplayButton, Token, Topo, nodeAt, type TopoLink, type TopoNode, type TopoView } from "@/components/presentation/Visuals";
import { useFitNodes } from "@/components/presentation/fitNarrow";
import { PA } from "@/lib/sim-engine/scenarios/troubleshootingPacketAnalysis";
import { bracket, createPaNet, fmtS, lastTest, paApply, paTicketState, type PaAction, type PaState } from "@/lib/sim-engine/scenarios/paNet";

/**
 * Packet Analysis — the presentation before the lesson and the lab. Sequence numbers, timings and drop points on the
 * slides are read from the lab model (paNet.ts). Presentation state only.
 */

type Id = "problem" | "guess" | "net" | "points" | "changes" | "tuple" | "syn" | "synack" | "ack" | "data" | "close" | "relative" | "incident" | "retx" | "arrived" | "bracket" | "counter" | "refusal" | "silent" | "trust" | "repair" | "workflow" | "recap";
type Step = DeckStep & { id: Id };
const B = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;
const M = ({ children }: { children: ReactNode }) => <span className="pv-mono text-pv-text">{children}</span>;
const run = (s: PaState, ...a: PaAction[]) => a.reduce((x, y) => paApply(x, y), s);
const H = run(createPaNet(0), { type: "nc" });
const HF = bracket(H, lastTest(H)).map((b) => b.f).filter((f) => f.kind === "tcp");
const SYN = HF.find((f) => f.flags === "S")! as typeof HF[number] & { seq: number };
const SA = HF.find((f) => f.flags === "S.")! as typeof HF[number] & { seq: number; ack: number };
const INC = run(paTicketState("retdrop", 1), { type: "nc" });
const IT = lastTest(INC);
const CURL = run(createPaNet(0), { type: "curl" });
const CT = lastTest(CURL);

const STEPS: Step[] = [
  { id: "problem", chapter: "The question", title: "“It's slow sometimes.”", body: <p>Users say the portal on <M>{PA.server}</M> sometimes takes a second to open. The symptom points everywhere at once: the server, the port, the network, the client.</p> },
  { id: "guess", chapter: "The question", title: "Guessing costs hours.", body: <p>Restarting the server, moving the port or clearing caches might even seem to help — once. Packet analysis replaces guesses with <B>evidence</B>: what was sent, what arrived, and where something stopped.</p> },
  { id: "net", chapter: "The network", title: "Four devices, one service.", body: <p>CLIENT <M>{PA.client}</M> reaches SERVER <M>{PA.server}:443</M> through switch SW1 and router R1. SW1 also mirrors CLIENT&apos;s port to a capture laptop.</p> },
  { id: "points", chapter: "The network", title: "Five places to look.", body: <p>CLIENT&apos;s own NIC, SW1&apos;s mirror, both R1 interfaces, SERVER&apos;s NIC. Each capture is a witness: it can only report what passed in front of it.</p> },
  { id: "changes", chapter: "Reading captures", title: "Same packet, different frame.", body: <p>The SYN leaves CLIENT with TTL <B>64</B> and reaches SERVER with TTL <B>63</B> and new Ethernet addresses — R1 routed it. IP addresses, ports and TCP numbers do not change.</p> },
  { id: "tuple", chapter: "Reading captures", title: "One flow, one five-tuple.", body: <p>Protocol, source IP and port, destination IP and port: <M>TCP {PA.client}:{SYN.sport} ↔ {PA.server}:443</M>. That is how you find the same conversation in every capture.</p> },
  { id: "syn", chapter: "The handshake", title: "SYN: “I want to talk.”", body: <p>CLIENT picks an initial sequence number — here <M>{SYN.seq}</M> — and sends a SYN. Nothing is acknowledged yet.</p> },
  { id: "synack", chapter: "The handshake", title: "SYN-ACK: “Heard you.”", body: <p>SERVER answers with its own sequence number <M>{SA.seq}</M> and acknowledges <M>{SA.ack}</M>: CLIENT&apos;s ISN + 1. A SYN-ACK proves the port is listening.</p> },
  { id: "ack", chapter: "The handshake", title: "ACK: established.", body: <p>CLIENT acknowledges <M>{SA.seq + 1}</M>. Round trip in this lab: {fmtS(lastTest(H).connect!)}.</p> },
  { id: "data", chapter: "The handshake", title: "Sequence numbers count bytes.", body: <p>A 120-byte request moves CLIENT&apos;s sequence from 1001 to 1121; SERVER&apos;s 380-byte answer is acknowledged as 5381. The ACK always names the next byte expected.</p> },
  { id: "close", chapter: "The handshake", title: "FIN, FIN, ACK.", body: <p>Each side sends a FIN (each consumes one number) and acknowledges the other&apos;s. Complete conversation: {fmtS(CT.total!)}.</p> },
  { id: "relative", chapter: "Reading captures", title: "Relative or absolute?", body: <p>tcpdump shows <B>relative</B> numbers after the handshake (<M>seq 1:121</M>); add <M>-S</M> for absolute ones (<M>seq 1001:1121</M>). Same packets, different arithmetic.</p> },
  { id: "incident", chapter: "The incident", title: "This time it hangs.", body: <p>A new connection takes {fmtS(IT.connect!)} to open. Nothing was refused. Where did that second go?</p> },
  { id: "retx", chapter: "The incident", title: "A retransmitted SYN.", body: <p>Same five-tuple, same sequence number, one retransmission timeout (<B>1 s</B>) later: CLIENT got no SYN-ACK and tried again. It does <i>not</i> say which packet was lost.</p> },
  { id: "arrived", chapter: "The incident", title: "Did the first SYN arrive?", body: <p>SERVER&apos;s own capture answers it: yes, and SERVER answered with a SYN-ACK. So the <B>answer</B> went missing on the way back.</p> },
  { id: "bracket", chapter: "Bracketing", title: "Last seen, first missing.", body: <p>The first SYN-ACK is in R1&apos;s <M>ge-0/0/1</M> capture and absent from <M>ge-0/0/0</M>, SPAN and CLIENT. It disappeared <B>inside R1</B>, on the way out of <M>ge-0/0/0</M>.</p> },
  { id: "counter", chapter: "Bracketing", title: "A second witness.", body: <p>R1&apos;s <M>ge-0/0/0</M> output drops went up by exactly one. Two independent sources agree — captures and a counter — before anyone changes anything.</p> },
  { id: "refusal", chapter: "Signatures", title: "Refusal is loud.", body: <p>A closed port answers <B>RST</B> at once — no waiting, no retransmission. A drop answers nothing and costs timeouts: 1 s, then 2 s more.</p> },
  { id: "silent", chapter: "Signatures", title: "Silence has causes.", body: <p>SYN in SERVER&apos;s capture, no answer: a host firewall drop (no half-open socket) — or SERVER ARPing for a gateway that doesn&apos;t exist (half-open socket, ARP requests).</p> },
  { id: "trust", chapter: "Signatures", title: "Is the capture complete?", body: <p>A mirror that copies only one direction makes every reply look ‘lost’ while users notice nothing. Check how a capture was taken before trusting its silence.</p> },
  { id: "repair", chapter: "Proof", title: "Fix one thing, then prove it.", body: <p>Remove the cause (here a shaper on R1&apos;s egress), then repeat the same test: three fresh connections, no retransmissions, counters flat.</p> },
  { id: "workflow", chapter: "Proof", title: "The workflow.", body: <p>Define the symptom, capture at several points, follow one flow, bracket the loss, confirm with a second source, repair, prove with fresh traffic.</p> },
  { id: "recap", chapter: "The whole idea", title: "Evidence before changes.", body: <p>Now follow it in the lesson, then capture, compare and repair it yourself in the Packet Analysis Lab.</p> },
];
const VISUAL: Record<Id, string> = Object.fromEntries(STEPS.map((s) => [s.id, ["refusal", "workflow", "recap", "data"].includes(s.id) ? s.id : "topo"])) as Record<Id, string>;

const NODES: TopoNode[] = [
  { id: "CLIENT", label: "CLIENT", sub: PA.client, icon: "host", x: 8, y: 62 },
  { id: "SW1", label: "SW1", sub: "switch · SPAN", icon: "SW", x: 34, y: 34 },
  { id: "R1", label: "R1", sub: "router", icon: "R", x: 64, y: 34 },
  { id: "SERVER", label: "SERVER", sub: PA.server, icon: "srv", x: 90, y: 62 },
  { id: "CAPTURE", label: "CAPTURE", sub: "laptop", icon: "cap", x: 34, y: 84 },
];
const LINKS: [string, string, string?][] = [["CLIENT", "SW1"], ["SW1", "R1"], ["R1", "SERVER"], ["SW1", "CAPTURE", "mirror"]];
const PATH = new Set(["CLIENT-SW1", "SW1-R1", "R1-SERVER"]);

function Deck({ step: s, play, replay }: { step: Step; play: number; replay: () => void }) {
  const FIT = useFitNodes(NODES, 260);
  const id = s.id;
  const k = `${id}-${play}`;
  const head = <StageHead chapter={s.chapter} title={s.title} />;
  const go = (f: string, t: string, o: { label: string; key: string; delay?: number; color?: string }) => (
    <Mover key={`${k}-${o.key}`} from={nodeAt(FIT.nodes, f)} to={nodeAt(FIT.nodes, t)} delay={o.delay} duration={700}>
      <Token color={o.color ?? "cyan"}>{o.label}</Token>
    </Mover>
  );
  if (VISUAL[id] === "topo") {
    const hot = ["tuple", "syn", "synack", "ack", "close", "incident", "retx", "arrived", "bracket", "repair"].includes(id) ? PATH : new Set<string>();
    const links: TopoLink[] = LINKS.map(([a, b, l]) => ({ a, b, state: (hot.has(`${a}-${b}`) ? "active" : hot.size ? "dim" : "up") as TopoLink["state"], label: l ?? "" }));
    const views: Record<string, TopoView> = {};
    let movers: ReactNode = null;
    if (id === "problem") views.CLIENT = { bubble: { text: "slow… sometimes", tone: "warn" } };
    if (id === "guess") views.SERVER = { bubble: { text: "restart it?", tone: "ask" } };
    if (id === "net") views.R1 = { bubble: { text: "routes between subnets", tone: "info" } };
    if (id === "points") {
      for (const d of ["CLIENT", "SERVER", "CAPTURE", "R1"]) views[d] = { ring: "on" };
      views.CAPTURE = { ring: "on", bubble: { text: "SPAN copy", tone: "info" } };
    }
    if (id === "changes") {
      views.CLIENT = { bubble: { text: "TTL 64", tone: "info" } };
      views.SERVER = { bubble: { text: "TTL 63", tone: "info" } };
    }
    if (id === "syn") movers = <>{go("CLIENT", "SW1", { label: `SYN ${SYN.seq}`, key: "1" })}{go("SW1", "R1", { label: `SYN ${SYN.seq}`, key: "2", delay: 700 })}{go("R1", "SERVER", { label: `SYN ${SYN.seq}`, key: "3", delay: 1400 })}</>;
    if (id === "synack") movers = <>{go("SERVER", "R1", { label: `SYN-ACK ack ${SA.ack}`, key: "1", color: "violet" })}{go("R1", "SW1", { label: "SYN-ACK", key: "2", delay: 700, color: "violet" })}{go("SW1", "CLIENT", { label: "SYN-ACK", key: "3", delay: 1400, color: "violet" })}</>;
    if (id === "ack") views.CLIENT = { ring: "hit", bubble: { text: "ESTABLISHED", tone: "yes" } };
    if (id === "close") views.CLIENT = { bubble: { text: "TIME-WAIT", tone: "info" } };
    if (id === "relative") views.CAPTURE = { bubble: { text: "-nn vs -nnS", tone: "info" } };
    if (id === "incident") views.CLIENT = { ring: "bad", bubble: { text: `opened after ${fmtS(IT.connect!)}`, tone: "warn" } };
    if (id === "retx") movers = <>{go("CLIENT", "SW1", { label: `SYN ${SYN.seq + 1000} ⟲`, key: "1", color: "amber" })}{go("SW1", "R1", { label: "SYN ⟲", key: "2", delay: 700, color: "amber" })}</>;
    if (id === "arrived") views.SERVER = { ring: "hit", bubble: { text: "got it, answered", tone: "yes" } };
    if (id === "bracket") {
      movers = go("SERVER", "R1", { label: "SYN-ACK", key: "1", color: "violet" });
      views.R1 = { ring: "bad", bubble: { text: "in on ge-0/0/1, never out", tone: "bad" } };
    }
    if (id === "counter") views.R1 = { ring: "bad", bubble: { text: "ge-0/0/0 output drops +1", tone: "bad" } };
    if (id === "silent") views.SERVER = { ring: "bad", bubble: { text: "SYN in, nothing out", tone: "warn" } };
    if (id === "trust") views.CAPTURE = { ring: "bad", bubble: { text: "only one direction?", tone: "warn" } };
    if (id === "repair") views.R1 = { ring: "hit", bubble: { text: "shaper removed", tone: "yes" } };
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
    case "data":
      return (
        <>
          {head}
          <MiniTable title="One curl, computed by the lab (absolute numbers)" cols={["segment", "seq", "ack", "len"]} rows={bracket(CURL, CT).map((b) => b.f).filter((f) => f.kind === "tcp").map((f) => ({ cells: [`${f.dir === "c2s" ? "→" : "←"} ${f.flags}`, String(f.seq), f.flags === "S" ? "—" : String(f.ack), String(f.len)], state: f.len ? "hit" : undefined }))} />
        </>
      );
    case "refusal":
      return (
        <>
          {head}
          <MiniTable title="What the first second shows" cols={["cause", "answer", "client waits?"]} rows={[{ cells: ["port closed", "RST,ACK", "no"], state: "hit" }, { cells: ["host firewall drop", "nothing", "1 s, 2 s, timeout"] }, { cells: ["wrong server gateway", "nothing (ARP fails)", "1 s, 2 s, timeout"] }, { cells: ["egress drop on the way back", "late SYN-ACK", "1 s, then opens"] }]} />
        </>
      );
    case "workflow":
      return (
        <>
          {head}
          <Chain k="wf" items={[{ t: "Define the symptom precisely" }, { t: "Capture at several points", tone: "cyan" }, { t: "Follow one five-tuple", tone: "violet" }, { t: "Bracket: last seen, first missing", tone: "amber" }, { t: "Confirm with a second source", tone: "amber" }, { t: "Repair one thing, prove with fresh traffic", tone: "green" }]} />
        </>
      );
    case "recap":
      return (
        <>
          {head}
          <Chain k="recap" items={[{ t: "A capture is a witness at one point" }, { t: "TTL and MACs change; tuple and seq/ack don't", tone: "cyan" }, { t: "RST is refusal; silence is loss", tone: "violet" }, { t: "Bracket the loss, then check a counter", tone: "amber" }, { t: "Trust only complete captures", tone: "green" }]} />
        </>
      );
  }
  return head;
}

export function PaPresentation({ open, onClose, onFinish, finishLabel }: { open: boolean; onClose: () => void; onFinish: () => void; finishLabel: string }) {
  const [play, setPlay] = useState(0);
  return (
    <LessonPresentation
      open={open}
      onClose={onClose}
      title="Packet analysis, from zero"
      kicker="Learn · the Packet Analysis presentation"
      steps={STEPS}
      visual={(s) => VISUAL[s.id as Id]}
      renderStage={(s) => <Deck step={s as Step} play={play} replay={() => setPlay((p) => p + 1)} />}
      finish={{ label: finishLabel, onClick: onFinish }}
      skip={{ label: "Skip →", onClick: onFinish }}
    />
  );
}
